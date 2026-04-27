// @ts-check

import { createHash } from 'node:crypto';
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  writeJsonFile,
  writeJsonLines,
  writeTextFile,
} from '../../infra/io.mjs';
import {
  normalizeDownloadRunManifest,
  normalizeResolvedDownloadTask,
  resolveDownloadRunStatus,
} from './contracts.mjs';
import { buildDownloadRunLayout } from './artifacts.mjs';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function safeFileName(value, fallback = 'download.bin') {
  const normalized = String(value ?? fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^\.+/gu, '')
    .trim();
  return normalized || fallback;
}

function resourceFilePath(filesDir, resource, index) {
  const prefix = String(index + 1).padStart(4, '0');
  return path.join(filesDir, `${prefix}-${safeFileName(resource.fileName, `${resource.id}.bin`)}`);
}

async function existingFileResult(resource, filePath) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return null;
    }
    return {
      ok: true,
      skipped: true,
      reason: 'existing-file',
      resourceId: resource.id,
      url: resource.url,
      filePath,
      bytes: fileStat.size,
      mediaType: resource.mediaType,
    };
  } catch {
    return null;
  }
}

function normalizeExpectedHash(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }
  const match = text.match(/^(?:sha256:)?([a-f0-9]{64})$/iu);
  return match ? match[1].toLowerCase() : text.toLowerCase();
}

function verifyPayload(resource, bytes, payload) {
  const failures = [];
  if (resource.expectedBytes !== undefined && Number(resource.expectedBytes) !== bytes) {
    failures.push(`expected ${resource.expectedBytes} bytes, got ${bytes}`);
  }
  const expectedHash = normalizeExpectedHash(resource.expectedHash);
  if (expectedHash) {
    const actual = createHash('sha256').update(payload).digest('hex');
    if (actual !== expectedHash) {
      failures.push(`expected sha256 ${expectedHash}, got ${actual}`);
    }
  }
  return failures;
}

async function fetchResource(resource, filePath, { fetchImpl, verify, sessionLease }) {
  const headers = {
    ...(sessionLease?.headers ?? {}),
    ...(resource.headers ?? {}),
  };
  if (resource.referer && !headers.referer && !headers.Referer) {
    headers.referer = resource.referer;
  }
  const response = await fetchImpl(resource.url, {
    method: resource.method ?? 'GET',
    headers,
    body: resource.method === 'POST' ? resource.body : undefined,
  });
  if (!response?.ok) {
    return {
      ok: false,
      reason: `http-${response?.status ?? 'error'}`,
      status: response?.status ?? null,
      resourceId: resource.id,
      url: resource.url,
      filePath,
      mediaType: resource.mediaType,
    };
  }

  const arrayBuffer = await response.arrayBuffer();
  const payload = Buffer.from(arrayBuffer);
  const verificationFailures = verify ? verifyPayload(resource, payload.length, payload) : [];
  if (verificationFailures.length) {
    return {
      ok: false,
      reason: 'verification-failed',
      verificationFailures,
      resourceId: resource.id,
      url: resource.url,
      filePath,
      bytes: payload.length,
      mediaType: resource.mediaType,
    };
  }
  await writeFile(filePath, payload);
  return {
    ok: true,
    skipped: false,
    resourceId: resource.id,
    url: resource.url,
    filePath,
    bytes: payload.length,
    mediaType: resource.mediaType,
    sha256: createHash('sha256').update(payload).digest('hex'),
  };
}

async function downloadWithRetry(resource, filePath, options) {
  const attempts = normalizeNonNegativeInteger(options.retries, 2) + 1;
  let lastResult = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await fetchResource(resource, filePath, options);
      if (result.ok) {
        return { ...result, attempts: attempt };
      }
      lastResult = result;
    } catch (error) {
      lastResult = {
        ok: false,
        reason: 'fetch-error',
        error: error?.message ?? String(error),
        resourceId: resource.id,
        url: resource.url,
        filePath,
      };
    }
    if (attempt < attempts) {
      await delay(normalizeNonNegativeInteger(options.retryBackoffMs, 1_000));
    }
  }
  return { ...lastResult, attempts };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  const workerCount = Math.min(items.length, normalizePositiveInteger(concurrency, 4));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

function buildQueue(resources, layout) {
  return resources.map((resource, index) => ({
    id: resource.id,
    index,
    status: 'pending',
    url: resource.url,
    mediaType: resource.mediaType,
    filePath: resourceFilePath(layout.filesDir, resource, index),
    sourceUrl: resource.sourceUrl ?? null,
  }));
}

function renderReport(manifest, resolvedTask) {
  const lines = [
    '# Download Run',
    '',
    `- Status: ${manifest.status}`,
    `- Site: ${manifest.siteKey}`,
    `- Plan: ${manifest.planId}`,
    `- Expected: ${manifest.counts.expected}`,
    `- Downloaded: ${manifest.counts.downloaded}`,
    `- Skipped: ${manifest.counts.skipped}`,
    `- Failed: ${manifest.counts.failed}`,
  ];
  if (manifest.reason) {
    lines.push(`- Reason: ${manifest.reason}`);
  }
  if (resolvedTask?.completeness?.reason) {
    lines.push(`- Resolution: ${resolvedTask.completeness.reason}`);
  }
  if (manifest.failedResources.length) {
    lines.push('', '## Failed Resources');
    for (const failure of manifest.failedResources) {
      lines.push(`- ${failure.resourceId}: ${failure.reason}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function buildResumeCommand(plan, layout) {
  const siteArg = plan.siteKey ? ` --site ${plan.siteKey}` : '';
  const inputArg = plan.source?.input ? ` --input "${String(plan.source.input).replace(/"/gu, '\\"')}"` : '';
  return `node src/entrypoints/sites/download.mjs${siteArg}${inputArg} --execute --run-dir "${layout.runDir}" --resume`;
}

export async function executeResolvedDownloadTask(resolvedTaskInput, plan, sessionLease = null, options = {}, deps = {}) {
  const resolvedTask = normalizeResolvedDownloadTask(resolvedTaskInput, plan);
  const layout = await buildDownloadRunLayout(plan, options);
  const dryRun = Boolean(options.dryRun ?? plan.policy?.dryRun ?? false);
  const skipExisting = Boolean(options.skipExisting ?? plan.policy?.skipExisting ?? true);
  const verify = Boolean(options.verify ?? plan.policy?.verify ?? true);
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const resources = resolvedTask.resources;
  const queue = buildQueue(resources, layout);

  await writeJsonFile(layout.planPath, plan);
  await writeJsonFile(layout.resolvedTaskPath, resolvedTask);

  if (dryRun) {
    await writeJsonFile(layout.queuePath, queue);
    await writeJsonLines(layout.downloadsJsonlPath, []);
    const manifest = normalizeDownloadRunManifest({
      runId: layout.runId,
      planId: plan.id,
      siteKey: plan.siteKey,
      status: 'skipped',
      reason: 'dry-run',
      dryRun: true,
      counts: {
        expected: resources.length,
        attempted: 0,
        downloaded: 0,
        skipped: resources.length,
        failed: 0,
      },
      files: [],
      failedResources: [],
      resumeCommand: buildResumeCommand(plan, layout),
      artifacts: {
        manifest: layout.manifestPath,
        queue: layout.queuePath,
        downloadsJsonl: layout.downloadsJsonlPath,
        reportMarkdown: layout.reportMarkdownPath,
      },
      session: sessionLease,
      createdAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
    await writeJsonFile(layout.manifestPath, manifest);
    await writeTextFile(layout.reportMarkdownPath, renderReport(manifest, resolvedTask));
    return manifest;
  }

  if (typeof fetchImpl !== 'function' && resources.length > 0) {
    throw new Error('Download executor requires a fetch implementation for resolved resources.');
  }

  const results = await mapWithConcurrency(resources, plan.policy?.concurrency ?? options.concurrency ?? 4, async (resource, index) => {
    const filePath = queue[index].filePath;
    if (skipExisting) {
      const existing = await existingFileResult(resource, filePath);
      if (existing) {
        queue[index] = { ...queue[index], status: 'skipped', reason: existing.reason };
        await writeJsonFile(layout.queuePath, queue);
        return existing;
      }
    }
    queue[index] = { ...queue[index], status: 'running' };
    await writeJsonFile(layout.queuePath, queue);
    const result = await downloadWithRetry(resource, filePath, {
      fetchImpl,
      verify,
      retries: plan.policy?.retries ?? options.retries,
      retryBackoffMs: plan.policy?.retryBackoffMs ?? options.retryBackoffMs,
      sessionLease,
    });
    queue[index] = {
      ...queue[index],
      status: result.ok ? (result.skipped ? 'skipped' : 'downloaded') : 'failed',
      reason: result.reason ?? null,
      bytes: result.bytes ?? null,
    };
    await writeJsonFile(layout.queuePath, queue);
    return result;
  });

  const files = results.filter((result) => result?.ok).map((result) => ({
    resourceId: result.resourceId,
    url: result.url,
    filePath: result.filePath,
    bytes: result.bytes ?? 0,
    mediaType: result.mediaType ?? 'binary',
    sha256: result.sha256 ?? null,
    skipped: result.skipped === true,
  }));
  const failedResources = results.filter((result) => !result?.ok).map((result) => ({
    resourceId: result.resourceId,
    url: result.url,
    filePath: result.filePath,
    reason: result.reason ?? 'download-failed',
    error: result.error ?? null,
    verificationFailures: result.verificationFailures ?? [],
  }));
  const counts = {
    expected: resources.length,
    attempted: results.filter((result) => result && result.skipped !== true).length,
    downloaded: results.filter((result) => result?.ok && result.skipped !== true).length,
    skipped: results.filter((result) => result?.ok && result.skipped === true).length,
    failed: failedResources.length,
  };
  const manifest = normalizeDownloadRunManifest({
    runId: layout.runId,
    planId: plan.id,
    siteKey: plan.siteKey,
    status: resolveDownloadRunStatus(counts),
    reason: failedResources.length ? 'download-failures' : undefined,
    counts,
    files,
    failedResources,
    resumeCommand: failedResources.length ? buildResumeCommand(plan, layout) : undefined,
    artifacts: {
      manifest: layout.manifestPath,
      queue: layout.queuePath,
      downloadsJsonl: layout.downloadsJsonlPath,
      reportMarkdown: layout.reportMarkdownPath,
    },
    session: sessionLease,
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  });

  await writeJsonFile(layout.queuePath, queue);
  await writeJsonLines(layout.downloadsJsonlPath, results);
  await writeJsonFile(layout.manifestPath, manifest);
  await writeTextFile(layout.reportMarkdownPath, renderReport(manifest, resolvedTask));
  return manifest;
}
