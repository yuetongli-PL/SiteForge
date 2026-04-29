// @ts-check

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
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
import {
  isSuccessfulQueueStatus,
  loadDownloadRecoveryState,
  queueKey,
  recoverCompletedResource,
} from './recovery.mjs';

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

function buildQueue(resources, layout, recoveryState = null) {
  const previousQueue = Array.isArray(recoveryState) ? recoveryState : recoveryState?.queue;
  const previousByKey = recoveryState?.previousByKey instanceof Map
    ? recoveryState.previousByKey
    : new Map((Array.isArray(previousQueue) ? previousQueue : [])
      .map((entry) => [queueKey(entry), entry])
      .filter(([key]) => key));
  return resources.map((resource, index) => {
    const previous = previousByKey.get(queueKey(resource)) ?? previousByKey.get(resource.url);
    return {
      id: resource.id,
      key: previous?.key ?? previous?.downloadKey ?? null,
      index,
      status: previous?.status ?? 'pending',
      url: resource.url,
      mediaType: resource.mediaType,
      filePath: previous?.filePath ?? resourceFilePath(layout.filesDir, resource, index),
      sourceUrl: resource.sourceUrl ?? previous?.sourceUrl ?? null,
      reason: previous?.reason ?? null,
      bytes: previous?.bytes ?? null,
      result: previous?.result ?? null,
    };
  });
}

function cliQuote(value) {
  return `"${String(value).replace(/"/gu, '\\"')}"`;
}

function buildResumeCommand(plan, layout) {
  const siteArg = plan.siteKey ? ` --site ${plan.siteKey}` : '';
  const inputArg = plan.source?.input ? ` --input ${cliQuote(plan.source.input)}` : '';
  return `node src/entrypoints/sites/download.mjs${siteArg}${inputArg} --execute --run-dir ${cliQuote(layout.runDir)} --resume`;
}

function buildRetryFailedCommand(plan, layout) {
  const siteArg = plan.siteKey ? ` --site ${plan.siteKey}` : '';
  const inputArg = plan.source?.input ? ` --input ${cliQuote(plan.source.input)}` : '';
  return `node src/entrypoints/sites/download.mjs${siteArg}${inputArg} --execute --run-dir ${cliQuote(layout.runDir)} --retry-failed`;
}

function explainManifestStatus(manifest) {
  if (manifest.reason === 'dry-run') {
    return 'Dry run only wrote planned artifacts; no resource download was attempted.';
  }
  if (manifest.reason === 'retry-state-missing') {
    return 'retry-failed found no previous run state in this run directory, so nothing was retried.';
  }
  if (manifest.reason === 'retry-failed-none') {
    return 'retry-failed found no failed resources in the previous queue, so the run was skipped.';
  }
  if (manifest.reason === 'manifest-queue-count-mismatch') {
    return 'Previous recovery artifacts disagree: manifest expected count does not match queue length.';
  }
  if (manifest.reason?.startsWith('recovery-artifact-')) {
    return 'A previously successful resource could not be reused because its recorded artifact is inconsistent.';
  }
  if (manifest.failedResources.length > 0) {
    return 'One or more resources failed; use resume or retry-failed after fixing the cause.';
  }
  if (manifest.status === 'passed') {
    return 'All expected resources are downloaded or intentionally reused/skipped.';
  }
  if (manifest.status === 'skipped') {
    return 'No download was attempted for this run.';
  }
  return 'See reason and failed resources for the recovery outcome.';
}

function formatRecoveryProblem(problem) {
  const target = problem.resourceId ?? problem.url ?? problem.path ?? 'run';
  const detail = problem.detail ?? problem.error;
  return detail ? `${target}: ${problem.reason} (${detail})` : `${target}: ${problem.reason}`;
}

function renderReport(manifest, resolvedTask, { plan = null, layout = null, recoveryProblems = [] } = {}) {
  const lines = [
    '# Download Run',
    '',
    `- Status: ${manifest.status}`,
    `- Status explanation: ${explainManifestStatus(manifest)}`,
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
  if (plan && layout) {
    lines.push(
      `- Next resume command: ${buildResumeCommand(plan, layout)}`,
      `- Next retry-failed command: ${buildRetryFailedCommand(plan, layout)}`,
    );
  } else if (manifest.resumeCommand) {
    lines.push(`- Next resume command: ${manifest.resumeCommand}`);
  }
  if (resolvedTask?.completeness?.reason) {
    lines.push(`- Resolution: ${resolvedTask.completeness.reason}`);
  }
  lines.push(
    `- Manifest: ${manifest.artifacts.manifest}`,
    `- Queue: ${manifest.artifacts.queue}`,
    `- Downloads JSONL: ${manifest.artifacts.downloadsJsonl}`,
  );
  if (recoveryProblems.length) {
    lines.push('', '## Recovery Diagnostics');
    for (const problem of recoveryProblems) {
      lines.push(`- ${formatRecoveryProblem(problem)}`);
    }
  }
  if (manifest.failedResources.length) {
    lines.push('', '## Failed Resources');
    for (const failure of manifest.failedResources) {
      lines.push(`- ${failure.resourceId}: ${failure.reason}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function resultHasArtifact(result) {
  return result?.ok === true && result.hasFile !== false;
}

function filesFromResults(results) {
  return results.filter(resultHasArtifact).map((result) => ({
    resourceId: result.resourceId,
    url: result.url,
    filePath: result.filePath,
    bytes: result.bytes ?? 0,
    mediaType: result.mediaType ?? 'binary',
    sha256: result.sha256 ?? null,
    skipped: result.skipped === true,
    derived: result.derived === true || undefined,
    groupId: result.groupId ?? undefined,
  }));
}

function failedResourcesFromResults(results) {
  return results.filter((result) => !result?.ok).map((result) => ({
    resourceId: result.resourceId,
    url: result.url,
    filePath: result.filePath,
    reason: result.reason ?? 'download-failed',
    error: result.error ?? null,
    verificationFailures: result.verificationFailures ?? [],
  }));
}

function countsFromResults(resources, results, failedResources) {
  const primaryResults = results.filter((result) => result?.derived !== true);
  return {
    expected: resources.length,
    attempted: primaryResults.filter((result) => result && result.skipped !== true && result.attempted !== false).length,
    downloaded: primaryResults.filter((result) => result?.ok && result.skipped !== true).length,
    skipped: primaryResults.filter((result) => result?.ok && result.skipped === true).length,
    failed: failedResources.length,
  };
}

function queueStatusFromResult(result) {
  if (!result?.ok) {
    return 'failed';
  }
  return result.skipped ? 'skipped' : 'downloaded';
}

function applyResultToQueue(queueEntry, result) {
  return {
    ...queueEntry,
    status: queueStatusFromResult(result),
    reason: result.reason ?? null,
    bytes: result.bytes ?? null,
  };
}

function skippedControlResult(resource, queueEntry, reason) {
  return {
    ok: true,
    skipped: true,
    hasFile: false,
    reason,
    resourceId: resource.id,
    url: resource.url,
    filePath: queueEntry?.filePath ?? null,
    bytes: 0,
    mediaType: resource.mediaType,
  };
}

function failedControlResult(resource, queueEntry, reason, detail) {
  return {
    ok: false,
    attempted: false,
    reason,
    error: detail ?? null,
    resourceId: resource.id,
    url: resource.url,
    filePath: queueEntry?.filePath ?? null,
    mediaType: resource.mediaType,
  };
}

async function buildRetryFailedNoopResults(resources, queue, recoveryState, recoveryProblems, fallbackReason) {
  const results = [];
  for (let index = 0; index < resources.length; index += 1) {
    const resource = resources[index];
    const queueEntry = queue[index];
    if (isSuccessfulQueueStatus(queueEntry?.status)) {
      const recovered = await recoverCompletedResource(resource, queueEntry, recoveryState, 'retry-failed-reused-download');
      if (recovered.result) {
        results.push(recovered.result);
        continue;
      }
      if (recovered.problem) {
        recoveryProblems.push(recovered.problem);
        results.push(failedControlResult(resource, queueEntry, recovered.problem.reason, recovered.problem.detail));
        continue;
      }
    }
    results.push(skippedControlResult(resource, queueEntry, fallbackReason));
  }
  return results;
}

function isMuxableStream(resource = {}) {
  return ['video', 'audio'].includes(resource.metadata?.muxRole)
    && resource.metadata?.muxKind
    && resource.groupId;
}

function buildMuxPlans(resources = [], queue = [], results = [], layout = {}) {
  const groups = new Map();
  for (let index = 0; index < resources.length; index += 1) {
    const resource = resources[index];
    const result = results[index];
    if (!isMuxableStream(resource) || !result?.ok || !result.filePath) {
      continue;
    }
    const groupId = resource.groupId;
    const entry = groups.get(groupId) ?? {
      groupId,
      resources: [],
      video: null,
      audio: null,
    };
    const streamEntry = {
      resource,
      result,
      queueEntry: queue[index],
      index,
    };
    entry.resources.push(streamEntry);
    if (resource.metadata.muxRole === 'video' && !entry.video) {
      entry.video = streamEntry;
    }
    if (resource.metadata.muxRole === 'audio' && !entry.audio) {
      entry.audio = streamEntry;
    }
    groups.set(groupId, entry);
  }

  return [...groups.values()]
    .filter((entry) => entry.video && entry.audio)
    .map((entry) => {
      const outputName = `mux-${safeFileName(entry.video.resource.fileName ?? entry.groupId, 'merged-media')}.mp4`;
      return {
        ...entry,
        outputPath: path.join(layout.filesDir, outputName),
      };
    });
}

async function runProcess(command, args = [], options = {}) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      ...options,
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      resolve({
        code: 1,
        stderr: error?.message ?? String(error),
      });
    });
    child.on('close', (code) => {
      resolve({
        code: code ?? 0,
        stderr,
      });
    });
  });
}

async function muxWithFfmpeg(muxPlan, { ffmpegPath = 'ffmpeg', spawnProcess = runProcess } = {}) {
  const result = await spawnProcess(ffmpegPath, [
    '-y',
    '-i',
    muxPlan.video.result.filePath,
    '-i',
    muxPlan.audio.result.filePath,
    '-c',
    'copy',
    muxPlan.outputPath,
  ]);
  if (result?.code !== 0) {
    return {
      ok: false,
      reason: 'mux-failed',
      error: result?.stderr ?? `ffmpeg exited ${result?.code}`,
    };
  }
  return {
    ok: true,
  };
}

async function derivedMuxResult(muxPlan, options = {}, deps = {}) {
  const existing = await existingFileResult({
    id: `mux:${muxPlan.groupId}`,
    url: `mux:${muxPlan.groupId}`,
    mediaType: 'video',
  }, muxPlan.outputPath);
  if (existing) {
    return {
      ...existing,
      derived: true,
      groupId: muxPlan.groupId,
      reason: 'existing-mux-file',
    };
  }

  const muxer = deps.muxMediaPair
    ?? (async (plan) => await muxWithFfmpeg(plan, {
      ffmpegPath: deps.ffmpegPath ?? options.ffmpegPath,
      spawnProcess: deps.spawnProcess,
    }));
  try {
    const muxed = await muxer({
      groupId: muxPlan.groupId,
      videoFile: muxPlan.video.result.filePath,
      audioFile: muxPlan.audio.result.filePath,
      outputFile: muxPlan.outputPath,
      videoResource: muxPlan.video.resource,
      audioResource: muxPlan.audio.resource,
      resources: muxPlan.resources.map((entry) => entry.resource),
    });
    if (muxed?.ok === false) {
      return {
        ok: false,
        derived: true,
        reason: muxed.reason ?? 'mux-failed',
        error: muxed.error ?? null,
        resourceId: `mux:${muxPlan.groupId}`,
        url: `mux:${muxPlan.groupId}`,
        filePath: muxPlan.outputPath,
        mediaType: 'video',
        groupId: muxPlan.groupId,
      };
    }
    const fileStat = await stat(muxPlan.outputPath);
    return {
      ok: true,
      skipped: false,
      derived: true,
      resourceId: `mux:${muxPlan.groupId}`,
      url: `mux:${muxPlan.groupId}`,
      filePath: muxPlan.outputPath,
      bytes: fileStat.size,
      mediaType: 'video',
      groupId: muxPlan.groupId,
      reason: 'dash-mux',
    };
  } catch (error) {
    return {
      ok: false,
      derived: true,
      reason: 'mux-error',
      error: error?.message ?? String(error),
      resourceId: `mux:${muxPlan.groupId}`,
      url: `mux:${muxPlan.groupId}`,
      filePath: muxPlan.outputPath,
      mediaType: 'video',
      groupId: muxPlan.groupId,
    };
  }
}

async function buildDerivedMuxResults(resources, queue, results, layout, options, deps) {
  const enabled = Boolean(options.enableDerivedMux ?? options.muxDerivedMedia ?? false)
    || Boolean(deps.muxMediaPair);
  if (!enabled) {
    return [];
  }
  const muxPlans = buildMuxPlans(resources, queue, results, layout);
  const muxResults = [];
  for (const muxPlan of muxPlans) {
    muxResults.push(await derivedMuxResult(muxPlan, options, deps));
  }
  return muxResults;
}

async function writeRunArtifactsFromResults({
  layout,
  plan,
  resolvedTask,
  sessionLease,
  resources,
  queue,
  results,
  status,
  reason,
  recoveryProblems = [],
}) {
  const files = filesFromResults(results);
  const failedResources = failedResourcesFromResults(results);
  const counts = countsFromResults(resources, results, failedResources);
  const manifest = normalizeDownloadRunManifest({
    runId: layout.runId,
    planId: plan.id,
    siteKey: plan.siteKey,
    status: status ?? resolveDownloadRunStatus(counts),
    reason: reason ?? (failedResources.length ? 'download-failures' : undefined),
    counts,
    files,
    failedResources,
    resumeCommand: failedResources.length || status === 'skipped' ? buildResumeCommand(plan, layout) : undefined,
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
  await writeTextFile(layout.reportMarkdownPath, renderReport(manifest, resolvedTask, {
    plan,
    layout,
    recoveryProblems,
  }));
  return manifest;
}

export async function executeResolvedDownloadTask(resolvedTaskInput, plan, sessionLease = null, options = {}, deps = {}) {
  const resolvedTask = normalizeResolvedDownloadTask(resolvedTaskInput, plan);
  const layout = await buildDownloadRunLayout(plan, options);
  const dryRun = Boolean(options.dryRun ?? plan.policy?.dryRun ?? false);
  const skipExisting = Boolean(options.skipExisting ?? plan.policy?.skipExisting ?? true);
  const verify = Boolean(options.verify ?? plan.policy?.verify ?? true);
  const resume = Boolean(options.resume ?? plan.resume ?? false);
  const retryFailedOnly = Boolean(options.retryFailedOnly ?? plan.policy?.retryFailedOnly ?? false);
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const resources = resolvedTask.resources;
  const recoveryMode = retryFailedOnly ? 'retry-failed' : resume ? 'resume' : 'none';
  const recoveryState = await loadDownloadRecoveryState(layout, resources, recoveryMode);
  const recoveryProblems = [...(recoveryState.problems ?? [])];
  const queue = buildQueue(resources, layout, recoveryState);

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
    await writeTextFile(layout.reportMarkdownPath, renderReport(manifest, resolvedTask, {
      plan,
      layout,
      recoveryProblems,
    }));
    return manifest;
  }

  if (recoveryState.terminal) {
    let results;
    let status = recoveryState.terminal.status;
    let reason = recoveryState.terminal.reason;
    if (reason === 'retry-failed-none') {
      results = await buildRetryFailedNoopResults(resources, queue, recoveryState, recoveryProblems, reason);
      for (let index = 0; index < results.length; index += 1) {
        queue[index] = applyResultToQueue(queue[index], results[index]);
      }
      const failedResources = failedResourcesFromResults(results);
      if (failedResources.length > 0) {
        status = 'failed';
        reason = failedResources[0].reason;
      }
    } else {
      results = resources.map((resource, index) => (
        status === 'failed'
          ? failedControlResult(resource, queue[index], reason, recoveryState.terminal.detail)
          : skippedControlResult(resource, queue[index], reason)
      ));
      for (let index = 0; index < results.length; index += 1) {
        queue[index] = applyResultToQueue(queue[index], results[index]);
      }
    }
    return await writeRunArtifactsFromResults({
      layout,
      plan,
      resolvedTask,
      sessionLease,
      resources,
      queue,
      results,
      status,
      reason,
      recoveryProblems,
    });
  }

  if (typeof fetchImpl !== 'function' && resources.length > 0) {
    throw new Error('Download executor requires a fetch implementation for resolved resources.');
  }

  const results = await mapWithConcurrency(resources, plan.policy?.concurrency ?? options.concurrency ?? 4, async (resource, index) => {
    const filePath = queue[index].filePath;
    const previousStatus = queue[index].status;
    if (resume || retryFailedOnly) {
      const recovered = await recoverCompletedResource(
        resource,
        queue[index],
        recoveryState,
        retryFailedOnly ? 'retry-failed-reused-download' : 'resume-existing-download',
      );
      if (recovered.result) {
        queue[index] = applyResultToQueue(queue[index], recovered.result);
        await writeJsonFile(layout.queuePath, queue);
        return recovered.result;
      }
      if (recovered.problem) {
        recoveryProblems.push(recovered.problem);
        if (retryFailedOnly && isSuccessfulQueueStatus(previousStatus)) {
          const failed = failedControlResult(resource, queue[index], recovered.problem.reason, recovered.problem.detail);
          queue[index] = applyResultToQueue(queue[index], failed);
          await writeJsonFile(layout.queuePath, queue);
          return failed;
        }
      }
      if (retryFailedOnly && previousStatus !== 'failed') {
        const skipped = skippedControlResult(resource, queue[index], 'retry-failed-not-failed');
        queue[index] = applyResultToQueue(queue[index], skipped);
        await writeJsonFile(layout.queuePath, queue);
        return skipped;
      }
    }
    if (skipExisting) {
      const existing = await existingFileResult(resource, filePath);
      if (existing) {
        queue[index] = applyResultToQueue(queue[index], existing);
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
    queue[index] = applyResultToQueue(queue[index], result);
    await writeJsonFile(layout.queuePath, queue);
    return result;
  });
  const derivedResults = await buildDerivedMuxResults(resources, queue, results, layout, options, deps);

  return await writeRunArtifactsFromResults({
    layout,
    plan,
    resolvedTask,
    sessionLease,
    resources,
    queue,
    results: [...results, ...derivedResults],
    recoveryProblems,
  });
}
