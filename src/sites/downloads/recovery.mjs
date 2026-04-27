// @ts-check

import { stat } from 'node:fs/promises';

import {
  pathExists,
  readJsonFile,
  readTextFile,
} from '../../infra/io.mjs';

const SUCCESS_QUEUE_STATUSES = new Set([
  'completed',
  'downloaded',
  'passed',
  'skipped',
  'success',
]);

function normalizeError(error) {
  return error?.message ?? String(error);
}

export function queueKey(entry = {}) {
  return entry.id ?? entry.resourceId ?? entry.url ?? null;
}

export function isSuccessfulQueueStatus(status) {
  return SUCCESS_QUEUE_STATUSES.has(String(status ?? '').toLowerCase());
}

async function readJsonArtifact(filePath, label) {
  if (!await pathExists(filePath)) {
    return {
      label,
      path: filePath,
      exists: false,
      ok: false,
      reason: `${label}-missing`,
    };
  }
  try {
    return {
      label,
      path: filePath,
      exists: true,
      ok: true,
      value: await readJsonFile(filePath),
    };
  } catch (error) {
    return {
      label,
      path: filePath,
      exists: true,
      ok: false,
      reason: `${label}-invalid-json`,
      error: normalizeError(error),
    };
  }
}

async function readJsonLinesArtifact(filePath, label) {
  if (!await pathExists(filePath)) {
    return {
      label,
      path: filePath,
      exists: false,
      ok: false,
      reason: `${label}-missing`,
      value: [],
    };
  }
  try {
    const text = await readTextFile(filePath);
    const rows = [];
    const lines = text.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) {
        continue;
      }
      try {
        rows.push(JSON.parse(line));
      } catch (error) {
        return {
          label,
          path: filePath,
          exists: true,
          ok: false,
          reason: `${label}-invalid-jsonl`,
          error: `line ${index + 1}: ${normalizeError(error)}`,
          value: [],
        };
      }
    }
    return {
      label,
      path: filePath,
      exists: true,
      ok: true,
      value: rows,
    };
  } catch (error) {
    return {
      label,
      path: filePath,
      exists: true,
      ok: false,
      reason: `${label}-read-failed`,
      error: normalizeError(error),
      value: [],
    };
  }
}

function normalizeQueueArtifact(raw) {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (Array.isArray(raw?.queue)) {
    return raw.queue;
  }
  return null;
}

function buildEntryMap(entries) {
  const mapped = new Map();
  for (const entry of entries ?? []) {
    const key = queueKey(entry);
    if (key && !mapped.has(key)) {
      mapped.set(key, entry);
    }
  }
  return mapped;
}

function pushProblem(problems, problem) {
  if (!problems.some((entry) => entry.reason === problem.reason && entry.path === problem.path)) {
    problems.push(problem);
  }
}

function validateManifestQueueConsistency(manifest, queue, problems) {
  if (!manifest || !Array.isArray(queue)) {
    return;
  }
  const expected = Number(manifest.counts?.expected);
  if (Number.isFinite(expected) && expected !== queue.length) {
    pushProblem(problems, {
      reason: 'manifest-queue-count-mismatch',
      detail: `manifest expected ${expected}, queue has ${queue.length}`,
    });
  }

  const queueKeys = new Set(queue.map((entry) => queueKey(entry)).filter(Boolean));
  for (const file of Array.isArray(manifest.files) ? manifest.files : []) {
    const key = queueKey(file);
    if (key && !queueKeys.has(key)) {
      pushProblem(problems, {
        reason: 'manifest-queue-resource-mismatch',
        resourceId: file.resourceId ?? file.id ?? null,
        url: file.url ?? null,
        detail: `manifest file ${key} is not present in queue`,
      });
      return;
    }
  }
}

function validateDownloadsQueueConsistency(downloads, queue, problems) {
  if (!Array.isArray(downloads) || !Array.isArray(queue)) {
    return;
  }
  const queueKeys = new Set(queue.map((entry) => queueKey(entry)).filter(Boolean));
  for (const row of downloads) {
    const key = queueKey(row);
    if (key && !queueKeys.has(key)) {
      pushProblem(problems, {
        reason: 'queue-downloads-resource-mismatch',
        resourceId: row.resourceId ?? row.id ?? null,
        url: row.url ?? null,
        detail: `download record ${key} is not present in queue`,
      });
      return;
    }
  }
}

function resolveTerminalRecoveryState({ mode, oldStateExists, manifestArtifact, queueArtifact, downloadsArtifact, queue, failedQueueEntries, problems }) {
  const blockingProblem = problems.find((problem) => [
    'downloads-invalid-jsonl',
    'downloads-read-failed',
    'manifest-invalid-json',
    'manifest-queue-count-mismatch',
    'manifest-queue-resource-mismatch',
    'queue-downloads-resource-mismatch',
    'queue-invalid-json',
    'queue-invalid-shape',
  ].includes(problem.reason));

  if (blockingProblem) {
    return {
      status: 'failed',
      reason: blockingProblem.reason,
      detail: blockingProblem.detail ?? blockingProblem.error,
    };
  }

  if (mode !== 'retry-failed') {
    return null;
  }

  if (!oldStateExists) {
    return {
      status: 'skipped',
      reason: 'retry-state-missing',
      detail: 'No previous manifest, queue, or downloads artifact exists for this run directory.',
    };
  }

  if (!queueArtifact.exists) {
    return {
      status: 'failed',
      reason: 'retry-queue-missing',
      detail: 'retry-failed requires the previous queue.json artifact.',
    };
  }

  if (!Array.isArray(queue)) {
    return {
      status: 'failed',
      reason: 'queue-invalid-shape',
      detail: 'queue.json must be an array or an object with a queue array.',
    };
  }

  if (downloadsArtifact.exists && !downloadsArtifact.ok) {
    return {
      status: 'failed',
      reason: downloadsArtifact.reason,
      detail: downloadsArtifact.error,
    };
  }

  if (manifestArtifact.exists && !manifestArtifact.ok) {
    return {
      status: 'failed',
      reason: manifestArtifact.reason,
      detail: manifestArtifact.error,
    };
  }

  if (failedQueueEntries.length === 0) {
    return {
      status: 'skipped',
      reason: 'retry-failed-none',
      detail: 'The previous queue has no failed resources to retry.',
    };
  }

  return null;
}

export async function loadDownloadRecoveryState(layout, resources = [], mode = 'none') {
  if (mode === 'none') {
    return {
      enabled: false,
      mode,
      queue: [],
      downloads: [],
      previousByKey: new Map(),
      downloadsByKey: new Map(),
      manifestFilesByKey: new Map(),
      failedQueueEntries: [],
      failedQueueKeys: new Set(),
      problems: [],
      terminal: null,
    };
  }

  const [manifestArtifact, queueArtifact, downloadsArtifact] = await Promise.all([
    readJsonArtifact(layout.manifestPath, 'manifest'),
    readJsonArtifact(layout.queuePath, 'queue'),
    readJsonLinesArtifact(layout.downloadsJsonlPath, 'downloads'),
  ]);

  const problems = [];
  if (manifestArtifact.exists && !manifestArtifact.ok) {
    pushProblem(problems, {
      reason: manifestArtifact.reason,
      path: manifestArtifact.path,
      error: manifestArtifact.error,
    });
  }
  if (queueArtifact.exists && !queueArtifact.ok) {
    pushProblem(problems, {
      reason: queueArtifact.reason,
      path: queueArtifact.path,
      error: queueArtifact.error,
    });
  }
  if (downloadsArtifact.exists && !downloadsArtifact.ok) {
    pushProblem(problems, {
      reason: downloadsArtifact.reason,
      path: downloadsArtifact.path,
      error: downloadsArtifact.error,
    });
  }

  const queue = queueArtifact.ok ? normalizeQueueArtifact(queueArtifact.value) : [];
  if (queueArtifact.ok && !Array.isArray(queue)) {
    pushProblem(problems, {
      reason: 'queue-invalid-shape',
      path: queueArtifact.path,
      detail: 'queue.json must be an array or an object with a queue array.',
    });
  }
  const normalizedQueue = Array.isArray(queue) ? queue : [];
  const downloads = downloadsArtifact.ok ? downloadsArtifact.value : [];
  const manifest = manifestArtifact.ok ? manifestArtifact.value : null;

  validateManifestQueueConsistency(manifest, normalizedQueue, problems);
  validateDownloadsQueueConsistency(downloads, normalizedQueue, problems);

  const previousByKey = buildEntryMap(normalizedQueue);
  const downloadsByKey = buildEntryMap((downloads ?? []).filter((entry) => entry?.ok === true));
  const manifestFilesByKey = buildEntryMap(Array.isArray(manifest?.files) ? manifest.files : []);
  const failedQueueEntries = normalizedQueue.filter((entry) => String(entry?.status ?? '').toLowerCase() === 'failed');
  const failedQueueKeys = new Set(failedQueueEntries.map((entry) => queueKey(entry)).filter(Boolean));
  const oldStateExists = manifestArtifact.exists || queueArtifact.exists || downloadsArtifact.exists;

  return {
    enabled: true,
    mode,
    oldStateExists,
    artifacts: {
      manifest: manifestArtifact,
      queue: queueArtifact,
      downloads: downloadsArtifact,
    },
    manifest,
    queue: normalizedQueue,
    downloads,
    previousByKey,
    downloadsByKey,
    manifestFilesByKey,
    failedQueueEntries,
    failedQueueKeys,
    resourceCount: resources.length,
    problems,
    terminal: resolveTerminalRecoveryState({
      mode,
      oldStateExists,
      manifestArtifact,
      queueArtifact,
      downloadsArtifact,
      queue,
      failedQueueEntries,
      problems,
    }),
  };
}

function buildArtifactCandidates(resource, queueEntry, recoveryState) {
  const key = queueKey(resource);
  return [
    recoveryState.downloadsByKey?.get(key),
    recoveryState.manifestFilesByKey?.get(key),
    isSuccessfulQueueStatus(queueEntry?.status) ? queueEntry : null,
  ].filter(Boolean);
}

async function validateArtifactCandidate(candidate) {
  const filePath = candidate?.filePath;
  if (!filePath) {
    return {
      ok: false,
      reason: 'recovery-artifact-missing',
      detail: 'No filePath was recorded for the recovered resource.',
    };
  }
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return {
        ok: false,
        reason: 'recovery-artifact-not-file',
        filePath,
        detail: 'Recovered filePath exists but is not a file.',
      };
    }
    const expectedBytes = Number(candidate.bytes);
    if (Number.isFinite(expectedBytes) && expectedBytes >= 0 && fileStat.size !== expectedBytes) {
      return {
        ok: false,
        reason: 'recovery-artifact-size-mismatch',
        filePath,
        detail: `recorded ${expectedBytes} bytes, found ${fileStat.size}`,
      };
    }
    return {
      ok: true,
      filePath,
      bytes: fileStat.size,
    };
  } catch {
    return {
      ok: false,
      reason: 'recovery-artifact-missing',
      filePath,
      detail: 'Recovered filePath does not exist.',
    };
  }
}

export async function recoverCompletedResource(resource, queueEntry, recoveryState, reason = 'resume-existing-download') {
  const candidates = buildArtifactCandidates(resource, queueEntry, recoveryState);
  const problems = [];
  for (const candidate of candidates) {
    const checked = await validateArtifactCandidate(candidate);
    if (!checked.ok) {
      problems.push({
        ...checked,
        resourceId: resource.id,
        url: resource.url,
      });
      continue;
    }
    return {
      result: {
        ok: true,
        skipped: true,
        reason,
        resourceId: resource.id,
        url: resource.url,
        filePath: checked.filePath,
        bytes: checked.bytes,
        mediaType: candidate.mediaType ?? resource.mediaType,
        sha256: candidate.sha256 ?? null,
      },
      problem: null,
    };
  }

  if (isSuccessfulQueueStatus(queueEntry?.status) || candidates.length > 0) {
    return {
      result: null,
      problem: problems[0] ?? {
        reason: 'recovery-artifact-missing',
        resourceId: resource.id,
        url: resource.url,
        filePath: queueEntry?.filePath ?? null,
        detail: 'The previous successful resource has no reusable artifact.',
      },
    };
  }

  return {
    result: null,
    problem: null,
  };
}
