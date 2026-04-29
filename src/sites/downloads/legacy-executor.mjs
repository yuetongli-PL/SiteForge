// @ts-check

import { spawn } from 'node:child_process';
import process from 'node:process';

import {
  writeJsonFile,
  writeJsonLines,
  writeTextFile,
} from '../../infra/io.mjs';
import { normalizeText } from '../../shared/normalize.mjs';
import {
  normalizeDownloadRunManifest,
  normalizeDownloadRunReason,
  normalizeDownloadRunStatus,
  resolveDownloadRunStatus,
} from './contracts.mjs';
import { buildDownloadRunLayout } from './artifacts.mjs';
import { renderSessionTraceabilityLines } from './session-report.mjs';
import { buildLegacyDownloadCommand } from './modules.mjs';
import {
  isSuccessfulQueueStatus,
  loadDownloadRecoveryState,
  queueKey,
} from './recovery.mjs';

export async function spawnJsonCommand(command, args = [], options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    ...(options.env ?? {}),
  };
  const spawnImpl = options.spawnImpl ?? spawn;
  return await new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding?.('utf8');
    child.stderr?.setEncoding?.('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: code ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

function parseJsonFromStdout(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    const firstObject = text.indexOf('{');
    const lastObject = text.lastIndexOf('}');
    if (firstObject >= 0 && lastObject > firstObject) {
      try {
        return JSON.parse(text.slice(firstObject, lastObject + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function objectAtPath(value, pathParts) {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== 'object') {
      return null;
    }
    current = current[part];
  }
  return current && typeof current === 'object' ? current : null;
}

function firstObjectAtPaths(value, paths) {
  for (const pathParts of paths) {
    const object = objectAtPath(value, pathParts);
    if (object) {
      return object;
    }
  }
  return null;
}

function numberValue(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function extractSummary(payload = {}) {
  return firstObjectAtPaths(payload, [
    ['counts'],
    ['summary'],
    ['actionSummary'],
    ['artifacts', 'counts'],
    ['downloadResult', 'manifest', 'summary'],
    ['downloadResult', 'summary'],
    ['downloadResult', 'artifacts', 'counts'],
    ['download', 'summary'],
    ['download', 'summaryView'],
    ['download', 'artifacts', 'counts'],
    ['result', 'artifacts', 'counts'],
    ['result', 'download', 'summary'],
  ]) ?? {};
}

function extractCounts(payload = {}, exitCode = 0) {
  const summary = extractSummary(payload);
  const downloaded = numberValue(
    summary.downloaded,
    summary.downloadedCount,
    summary.downloadedMedia,
    summary.successfulCount,
    summary.successful,
    summary.success,
    summary.completed,
    summary.items,
    summary.rows,
  );
  const failed = numberValue(summary.failed, summary.failedCount, summary.errors);
  const skipped = numberValue(summary.skipped, summary.skippedCount, summary.skippedMedia);
  const planned = numberValue(summary.planned, summary.plannedCount);
  const partial = numberValue(summary.partial, summary.partialCount, summary.incompleteItemCount);
  const total = numberValue(
    summary.expected,
    summary.expectedCount,
    summary.expectedMedia,
    summary.expectedMediaCount,
    summary.total,
    summary.count,
    summary.itemCount,
    summary.rows,
    downloaded + failed + skipped + planned + partial,
  );
  const expected = total || downloaded + failed + skipped + planned + partial;
  return {
    expected,
    attempted: Math.max(downloaded + failed + partial, exitCode === 0 && expected === 0 ? 0 : downloaded + failed),
    downloaded,
    skipped: skipped + planned,
    failed: failed + partial,
  };
}

function looksBlocked(reason) {
  return /(?:auth|login|session|captcha|challenge|risk|blocked|forbidden|manual|required|expired|quarantine)/iu
    .test(String(reason ?? ''));
}

function looksSkipped(reason) {
  return /(?:dry-run|skipped|no-downloadable|nothing-to-download|empty|not-found|not\s+found)/iu
    .test(String(reason ?? ''));
}

function extractReason(payload = {}, stderr = '') {
  return normalizeText(
    payload.reason
      ?? payload.reasonCode
      ?? payload.error
      ?? payload.status
      ?? payload.outcome?.reason
      ?? payload.outcome?.reasonCode
      ?? payload.artifactSummary?.reason
      ?? payload.result?.artifactSummary?.reason
      ?? payload.completeness?.reason
      ?? payload.completeness?.boundedReasons?.[0]
      ?? payload.completeness?.driftReasons?.[0]
      ?? stderr,
  ) || undefined;
}

function normalizeExplicitLegacyStatus(value, counts = {}) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return null;
  }
  const statusLikeValues = [
    'passed',
    'partial',
    'failed',
    'blocked',
    'skipped',
    'ok',
    'success',
    'successful',
    'complete',
    'completed',
    'done',
    'warning',
    'warnings',
    'degraded',
    'bounded',
    'incomplete',
    'error',
    'failure',
    'auth',
    'blocked-auth',
    'blocked-risk',
    'manual',
    'pending',
    'planned',
    'dry-run',
    'noop',
  ];
  return statusLikeValues.includes(normalized) ? normalizeDownloadRunStatus(normalized, counts) : null;
}

function resolveLegacyStatus(payload = {}, exitCode = 0, counts = {}, stderr = '') {
  const reason = extractReason(payload, stderr);
  const statusCandidate = payload.status
    ?? payload.outcome?.status
    ?? payload.result?.status
    ?? payload.artifactSummary?.verdict
    ?? payload.result?.artifactSummary?.verdict;
  const explicitStatus = normalizeExplicitLegacyStatus(statusCandidate, counts);
  if (explicitStatus) {
    return explicitStatus;
  }
  if (payload.ok === false || exitCode !== 0) {
    if (looksBlocked(reason)) {
      return 'blocked';
    }
    if (looksSkipped(reason)) {
      return 'skipped';
    }
    return counts.downloaded > 0 ? 'partial' : 'failed';
  }
  if (looksSkipped(reason) && counts.downloaded === 0 && counts.failed === 0) {
    return 'skipped';
  }
  return resolveDownloadRunStatus(counts);
}

function resultStatus(value) {
  return normalizeText(value?.status ?? value?.state).toLowerCase();
}

function filePathFromResult(value = {}) {
  return normalizeText(
    value.filePath
      ?? value.outputPath
      ?? value.downloadFile
      ?? value.path
      ?? value.localPath
      ?? value.targetPath,
  );
}

function collectResultRows(payload = {}) {
  const candidates = [
    payload.results,
    payload.files,
    payload.downloadedFiles,
    payload.downloadResult?.manifest?.results,
    payload.downloadResult?.manifest?.files,
    payload.downloadResult?.manifest?.downloads,
    payload.downloadResult?.results,
    payload.download?.results,
    payload.download?.files,
    payload.download?.downloads,
    payload.result?.download?.results,
    payload.result?.download?.files,
    payload.result?.download?.downloads,
  ];
  return candidates.find((value) => Array.isArray(value)) ?? [];
}

function extractFiles(payload = {}) {
  const files = [];
  const directFile = filePathFromResult(payload);
  if (directFile) {
    files.push({
      resourceId: normalizeText(payload.id ?? payload.bookTitle ?? payload.finalUrl) || 'legacy-output',
      url: normalizeText(payload.finalUrl ?? payload.url ?? payload.sourceUrl) || undefined,
      filePath: directFile,
      bytes: numberValue(payload.bytes, payload.size),
      mediaType: normalizeText(payload.mediaType) || 'binary',
      sha256: normalizeText(payload.sha256) || null,
      skipped: false,
    });
  }
  for (const row of collectResultRows(payload)) {
    const filePath = filePathFromResult(row);
    if (!filePath) {
      continue;
    }
    const status = resultStatus(row);
    if (status && !['success', 'downloaded', 'passed', 'skipped'].includes(status)) {
      continue;
    }
    files.push({
      resourceId: normalizeText(row.id ?? row.resourceId ?? row.finalUrl ?? row.source) || 'legacy-resource',
      url: normalizeText(row.finalUrl ?? row.url ?? row.sourceUrl ?? row.source) || undefined,
      filePath,
      bytes: numberValue(row.bytes, row.size, row.fileSize),
      mediaType: normalizeText(row.mediaType) || 'binary',
      sha256: normalizeText(row.sha256) || null,
      skipped: status === 'skipped',
    });
  }
  return files;
}

function extractFailures(payload = {}) {
  const rows = collectResultRows(payload);
  const failures = rows
    .filter((row) => ['failed', 'error'].includes(resultStatus(row)))
    .map((row) => ({
      resourceId: normalizeText(row.id ?? row.resourceId ?? row.finalUrl ?? row.source) || 'legacy-resource',
      url: normalizeText(row.finalUrl ?? row.url ?? row.sourceUrl ?? row.source) || undefined,
      filePath: filePathFromResult(row) || undefined,
      reason: normalizeText(row.reason ?? row.error ?? row.note) || 'legacy-download-failed',
      error: normalizeText(row.error) || null,
    }));
  if (!failures.length && Array.isArray(payload.failedResources)) {
    return payload.failedResources;
  }
  return failures;
}

function extractLegacyRunDir(payload = {}) {
  return normalizeText(
    payload.runDir
      ?? payload.actionSummary?.runDir
      ?? payload.artifacts?.runDir
      ?? payload.download?.runDir
      ?? payload.download?.artifacts?.runDir
      ?? payload.downloadResult?.manifest?.runDir
      ?? payload.downloadResult?.runDir
      ?? payload.downloadResult?.artifacts?.runDir
      ?? payload.manifest?.runDir,
  ) || undefined;
}

function extractLegacyManifestPath(payload = {}) {
  return normalizeText(
    payload.manifestPath
      ?? payload.artifacts?.manifest
      ?? payload.artifacts?.manifestPath
      ?? payload.downloadResult?.manifestPath
      ?? payload.downloadResult?.manifest?.manifestPath
      ?? payload.downloadResult?.manifest?.artifacts?.manifest
      ?? payload.downloadResult?.manifest?.artifacts?.manifestPath
      ?? payload.downloadResult?.artifacts?.manifest
      ?? payload.downloadResult?.artifacts?.manifestPath
      ?? payload.download?.manifestPath
      ?? payload.download?.artifacts?.manifest
      ?? payload.download?.artifacts?.manifestPath
      ?? payload.result?.artifacts?.manifest
      ?? payload.result?.artifacts?.manifestPath
      ?? payload.result?.download?.artifacts?.manifest
      ?? payload.result?.download?.artifacts?.manifestPath,
  ) || undefined;
}

function artifactString(value, ...keys) {
  for (const key of keys) {
    const entry = value?.[key];
    if (entry !== undefined && entry !== null && entry !== '') {
      return normalizeText(entry) || undefined;
    }
  }
  return undefined;
}

function mergeArtifactObject(target, value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }
  const mappings = [
    ['runDir', ['runDir']],
    ['manifest', ['manifest', 'manifestPath']],
    ['itemsJsonl', ['items', 'itemsJsonl', 'itemsJsonlPath']],
    ['downloadsJsonl', ['downloadsJsonl', 'downloadsJsonlPath', 'downloads']],
    ['mediaManifest', ['mediaManifest', 'mediaHashManifest', 'mediaHashManifestPath']],
    ['mediaQueue', ['mediaQueue', 'mediaQueuePath']],
    ['queue', ['queue', 'queuePath']],
    ['state', ['state', 'statePath']],
    ['reportMarkdown', ['reportMarkdown', 'report', 'reportPath']],
    ['apiCapture', ['apiCapture', 'apiCapturePath']],
    ['apiDriftSamples', ['apiDriftSamples', 'apiDriftSamplesPath']],
    ['indexCsv', ['indexCsv', 'indexCsvPath']],
    ['indexHtml', ['indexHtml', 'indexHtmlPath']],
  ];
  for (const [targetKey, sourceKeys] of mappings) {
    const artifactValue = artifactString(value, ...sourceKeys);
    if (artifactValue) {
      target[targetKey] = artifactValue;
    }
  }
}

function extractLegacySourceArtifacts(payload = {}) {
  const source = {};
  mergeArtifactObject(source, payload.artifacts);
  mergeArtifactObject(source, payload.download?.artifacts);
  mergeArtifactObject(source, payload.downloadResult?.artifacts);
  mergeArtifactObject(source, payload.downloadResult?.manifest?.artifacts);
  mergeArtifactObject(source, payload.result?.artifacts);
  mergeArtifactObject(source, payload.result?.download?.artifacts);
  const runDir = extractLegacyRunDir(payload);
  if (runDir) {
    source.runDir = runDir;
  }
  const manifest = extractLegacyManifestPath(payload);
  if (manifest) {
    source.manifest = manifest;
  }
  return Object.keys(source).length ? source : undefined;
}

function previewText(value, limit = 2_000) {
  const text = String(value ?? '').trim();
  if (!text) {
    return undefined;
  }
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function normalizeNativeFallbackTrace(value = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const resolver = value.resolver && typeof value.resolver === 'object' && !Array.isArray(value.resolver)
    ? {
      adapterId: normalizeText(value.resolver.adapterId) || undefined,
      method: normalizeText(value.resolver.method) || undefined,
    }
    : undefined;
  const sourceCompleteness = value.completeness
    && typeof value.completeness === 'object'
    && !Array.isArray(value.completeness)
    ? value.completeness
    : {};
  const reason = normalizeText(value.reason ?? sourceCompleteness.reason);
  const expectedCount = Number(sourceCompleteness.expectedCount ?? 0);
  const resolvedCount = Number(sourceCompleteness.resolvedCount ?? 0);
  const trace = {
    reason: reason || undefined,
    resolver,
    completeness: {
      expectedCount: Number.isFinite(expectedCount) ? expectedCount : 0,
      resolvedCount: Number.isFinite(resolvedCount) ? resolvedCount : 0,
      complete: sourceCompleteness.complete === true,
      reason: normalizeText(sourceCompleteness.reason ?? reason) || undefined,
    },
  };
  if (!trace.reason && !trace.resolver?.adapterId && !trace.resolver?.method) {
    return null;
  }
  return trace;
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

function explainLegacyManifest(manifest) {
  if (manifest.status === 'blocked') {
    return 'Legacy downloader reported an authentication, session, challenge, or risk block.';
  }
  if (manifest.legacy?.recovery) {
    return 'Legacy recovery preflight returned a stable wrapper result before spawning the legacy downloader.';
  }
  if (manifest.status === 'passed') {
    return 'Legacy downloader completed successfully and its output was normalized into the unified manifest.';
  }
  if (manifest.status === 'partial' || manifest.status === 'failed') {
    return 'Legacy downloader did not complete cleanly; inspect source artifacts and retry after fixing the cause.';
  }
  return 'Legacy downloader produced a skipped or no-op result.';
}

function flattenArtifactLines(prefix, value, lines) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }
  for (const [key, artifactValue] of Object.entries(value)) {
    if (artifactValue && typeof artifactValue === 'object' && !Array.isArray(artifactValue)) {
      flattenArtifactLines(`${prefix}${key}.`, artifactValue, lines);
    } else if (artifactValue !== undefined && artifactValue !== null && artifactValue !== '') {
      lines.push(`- Source artifact ${prefix}${key}: ${artifactValue}`);
    }
  }
}

function renderLegacyReport(manifest, { plan = null, layout = null } = {}) {
  const lines = [
    '# Download Run',
    '',
    `- Status: ${manifest.status}`,
    `- Status explanation: ${explainLegacyManifest(manifest)}`,
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
  lines.push(...renderSessionTraceabilityLines(manifest, { plan }));
  if (manifest.resumeCommand) {
    lines.push(`- Next resume command: ${manifest.resumeCommand}`);
  }
  if (plan && layout) {
    lines.push(`- Next retry-failed command: ${buildRetryFailedCommand(plan, layout)}`);
  }
  if (manifest.legacy?.runDir) {
    lines.push(`- Legacy run dir: ${manifest.legacy.runDir}`);
  }
  if (manifest.legacy?.manifestPath) {
    lines.push(`- Legacy manifest: ${manifest.legacy.manifestPath}`);
  }
  if (manifest.legacy?.nativeFallback?.reason) {
    lines.push(`- Native fallback reason: ${manifest.legacy.nativeFallback.reason}`);
  }
  flattenArtifactLines('', manifest.artifacts?.source, lines);
  lines.push(
    `- Manifest: ${manifest.artifacts.manifest}`,
    `- Queue: ${manifest.artifacts.queue}`,
    `- Downloads JSONL: ${manifest.artifacts.downloadsJsonl}`,
  );
  return `${lines.join('\n')}\n`;
}

function isLegacyRecoveryRequested(request = {}, options = {}) {
  return Boolean(
    request.retryFailedOnly
      ?? options.retryFailedOnly
      ?? request.resume
      ?? options.resume
      ?? false,
  );
}

function legacyRecoveryMode(request = {}, options = {}) {
  return (request.retryFailedOnly ?? options.retryFailedOnly) ? 'retry-failed' : 'resume';
}

function commandSupportsRecovery(commandSpec, mode) {
  const args = Array.isArray(commandSpec?.args) ? commandSpec.args.map((arg) => String(arg)) : [];
  if (mode === 'retry-failed') {
    return args.includes('--retry-failed') || args.includes('--retry-failed-only');
  }
  return args.includes('--resume');
}

function recoveryCounts(recoveryState = {}) {
  const queue = Array.isArray(recoveryState.queue) ? recoveryState.queue : [];
  const failed = queue.filter((entry) => String(entry?.status ?? '').toLowerCase() === 'failed').length;
  const skipped = queue.filter((entry) => String(entry?.status ?? '').toLowerCase() === 'skipped').length;
  const downloaded = queue.filter((entry) => isSuccessfulQueueStatus(entry?.status) && String(entry?.status ?? '').toLowerCase() !== 'skipped').length;
  return {
    expected: queue.length,
    attempted: downloaded + failed,
    downloaded,
    skipped,
    failed,
  };
}

function failedResourcesFromRecoveryProblems(recoveryState = {}, reason, detail) {
  const failedEntries = Array.isArray(recoveryState.failedQueueEntries) ? recoveryState.failedQueueEntries : [];
  if (failedEntries.length) {
    return failedEntries.map((entry) => ({
      resourceId: entry.resourceId ?? entry.id ?? entry.key ?? queueKey(entry) ?? 'legacy-resource',
      url: entry.url ?? entry.result?.url ?? undefined,
      filePath: entry.filePath ?? entry.result?.filePath ?? undefined,
      reason: entry.reason ?? entry.result?.reason ?? reason,
      error: entry.error ?? entry.result?.error ?? null,
    }));
  }
  const problems = Array.isArray(recoveryState.problems) ? recoveryState.problems : [];
  if (problems.length) {
    return problems.map((problem) => ({
      resourceId: problem.resourceId ?? 'legacy-recovery',
      url: problem.url ?? undefined,
      filePath: problem.path ?? problem.filePath ?? undefined,
      reason: problem.reason ?? reason,
      error: problem.error ?? problem.detail ?? null,
    }));
  }
  return reason && reason !== 'retry-failed-none' && reason !== 'resume-state-missing'
    ? [{
      resourceId: 'legacy-recovery',
      reason,
      error: detail ?? null,
    }]
    : [];
}

async function writeLegacyRecoveryManifest({
  layout,
  plan,
  sessionLease,
  commandSpec,
  recoveryState,
  status,
  reason,
  detail,
  nativeFallback = null,
}) {
  const counts = recoveryCounts(recoveryState);
  const failedResources = failedResourcesFromRecoveryProblems(recoveryState, reason, detail);
  if (failedResources.length > counts.failed) {
    counts.failed = failedResources.length;
  }
  const manifest = normalizeDownloadRunManifest({
    runId: layout.runId,
    planId: plan.id,
    siteKey: plan.siteKey,
    status,
    reason,
    counts,
    files: [],
    failedResources,
    resumeCommand: buildResumeCommand(plan, layout),
    artifacts: {
      manifest: layout.manifestPath,
      queue: layout.queuePath,
      downloadsJsonl: layout.downloadsJsonlPath,
      reportMarkdown: layout.reportMarkdownPath,
      plan: layout.planPath,
      resolvedTask: layout.resolvedTaskPath,
      runDir: layout.runDir,
      filesDir: layout.filesDir,
      source: recoveryState.manifest?.artifacts?.source,
    },
    session: sessionLease,
    legacy: {
      entrypoint: plan.legacy.entrypoint,
      executorKind: commandSpec.executorKind,
      command: commandSpec.command,
      args: commandSpec.args,
      exitCode: null,
      reasonCode: reason,
      artifacts: recoveryState.manifest?.artifacts?.source,
      recovery: {
        mode: recoveryState.mode,
        queueKind: recoveryState.queueKind,
        recognizedArtifacts: recoveryState.recognizedArtifacts ?? [],
        problems: recoveryState.problems ?? [],
        detail,
      },
      stdoutJson: false,
      ...(nativeFallback ? { nativeFallback } : {}),
    },
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  });
  await writeJsonFile(layout.queuePath, Array.isArray(recoveryState.queue) ? recoveryState.queue : []);
  await writeJsonLines(layout.downloadsJsonlPath, [{
    legacy: true,
    recovery: true,
    status,
    reason,
    detail,
    counts,
    failedResources,
  }]);
  await writeJsonFile(layout.manifestPath, manifest);
  await writeTextFile(layout.reportMarkdownPath, renderLegacyReport(manifest, {
    plan,
    layout,
  }));
  return manifest;
}

function legacyRecoveryPreflightResult(commandSpec, recoveryState, mode) {
  if (recoveryState.terminal) {
    return recoveryState.terminal;
  }
  if (mode === 'resume' && !recoveryState.oldStateExists) {
    return {
      status: 'skipped',
      reason: 'resume-state-missing',
      detail: 'No previous manifest, queue, media queue, or source artifact exists for this legacy run directory.',
    };
  }
  if (!commandSupportsRecovery(commandSpec, mode)) {
    return {
      status: 'skipped',
      reason: mode === 'retry-failed' ? 'legacy-retry-failed-unsupported' : 'legacy-resume-unsupported',
      detail: `The legacy command does not expose ${mode === 'retry-failed' ? '--retry-failed-only' : '--resume'}, so the wrapper cannot guarantee this recovery mode without rerunning normal legacy work.`,
    };
  }
  return null;
}

export async function executeLegacyDownloadTask(plan, sessionLease = null, request = {}, options = {}, deps = {}) {
  if (!plan.legacy?.entrypoint) {
    throw new Error('executeLegacyDownloadTask requires plan.legacy.entrypoint.');
  }

  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const layout = await buildDownloadRunLayout(plan, {
    ...options,
    workspaceRoot,
  });
  const nativeFallback = normalizeNativeFallbackTrace(options.nativeFallback ?? request.nativeFallback);
  const commandSpec = buildLegacyDownloadCommand(plan, sessionLease, request, {
    ...options,
    workspaceRoot,
    layout,
  });

  await writeJsonFile(layout.planPath, plan);
  await writeJsonFile(layout.resolvedTaskPath, {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [],
    groups: [],
    metadata: {
      legacy: plan.legacy,
      ...(nativeFallback ? { nativeFallback } : {}),
    },
    completeness: {
      expectedCount: 0,
      resolvedCount: 0,
      complete: false,
      reason: 'legacy-downloader-required',
    },
  });

  if (isLegacyRecoveryRequested(request, options)) {
    const mode = legacyRecoveryMode(request, options);
    const recoveryState = await loadDownloadRecoveryState(layout, [], mode);
    const preflight = legacyRecoveryPreflightResult(commandSpec, recoveryState, mode);
    if (preflight) {
      return await writeLegacyRecoveryManifest({
        layout,
        plan,
        sessionLease,
        commandSpec,
        recoveryState,
        status: preflight.status,
        reason: preflight.reason,
        detail: preflight.detail,
        nativeFallback,
      });
    }
  }

  await writeJsonFile(layout.queuePath, []);

  let processResult;
  try {
    processResult = await (deps.spawnJsonCommand ?? spawnJsonCommand)(
      commandSpec.command,
      commandSpec.args,
      {
        cwd: workspaceRoot,
        env: options.env,
        spawnImpl: deps.spawnImpl,
      },
    );
  } catch (error) {
    processResult = {
      code: 1,
      stdout: '',
      stderr: error?.message ?? String(error),
    };
  }
  const payload = parseJsonFromStdout(processResult.stdout) ?? {};
  const reason = extractReason(payload, processResult.stderr);
  const counts = extractCounts(payload, processResult.code);
  const files = extractFiles(payload);
  const failedResources = extractFailures(payload);
  const sourceArtifacts = extractLegacySourceArtifacts(payload);
  if (failedResources.length > counts.failed) {
    counts.failed = failedResources.length;
  }
  if (files.length > counts.downloaded + counts.skipped) {
    counts.downloaded = files.filter((file) => !file.skipped).length;
    counts.skipped = Math.max(counts.skipped, files.filter((file) => file.skipped).length);
  }
  if (counts.expected === 0) {
    counts.expected = counts.downloaded + counts.skipped + counts.failed;
  }
  const status = resolveLegacyStatus(payload, processResult.code, counts, processResult.stderr);
  const manifest = normalizeDownloadRunManifest({
    runId: layout.runId,
    planId: plan.id,
    siteKey: plan.siteKey,
    status,
    reason: status === 'passed' ? undefined : reason,
    counts,
    files,
    failedResources,
    resumeCommand: status === 'failed' || status === 'partial' || status === 'blocked'
      ? buildResumeCommand(plan, layout)
      : undefined,
    artifacts: {
      manifest: layout.manifestPath,
      queue: layout.queuePath,
      downloadsJsonl: layout.downloadsJsonlPath,
      reportMarkdown: layout.reportMarkdownPath,
      plan: layout.planPath,
      resolvedTask: layout.resolvedTaskPath,
      runDir: layout.runDir,
      filesDir: layout.filesDir,
      source: sourceArtifacts,
    },
    session: sessionLease,
    legacy: {
      entrypoint: plan.legacy.entrypoint,
      executorKind: commandSpec.executorKind,
      command: commandSpec.command,
      args: commandSpec.args,
      exitCode: processResult.code,
      ok: payload.ok,
      reasonCode: payload.reasonCode,
      runDir: extractLegacyRunDir(payload),
      manifestPath: extractLegacyManifestPath(payload),
      artifacts: sourceArtifacts,
      stdoutJson: Object.keys(payload).length > 0,
      stderr: previewText(processResult.stderr),
      ...(nativeFallback ? { nativeFallback } : {}),
    },
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  });

  await writeJsonLines(layout.downloadsJsonlPath, [{
    legacy: true,
    status,
    reason: normalizeDownloadRunReason(reason, status),
    counts,
    files,
    failedResources,
    exitCode: processResult.code,
  }]);
  await writeJsonFile(layout.manifestPath, manifest);
  await writeTextFile(layout.reportMarkdownPath, renderLegacyReport(manifest, {
    plan,
    layout,
  }));
  return manifest;
}
