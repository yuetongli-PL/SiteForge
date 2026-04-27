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
import { buildLegacyDownloadCommand } from './modules.mjs';

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

function buildResumeCommand(plan, layout) {
  const siteArg = plan.siteKey ? ` --site ${plan.siteKey}` : '';
  const inputArg = plan.source?.input ? ` --input "${String(plan.source.input).replace(/"/gu, '\\"')}"` : '';
  return `node src/entrypoints/sites/download.mjs${siteArg}${inputArg} --execute --run-dir "${layout.runDir}" --resume`;
}

function renderLegacyReport(manifest) {
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
  if (manifest.resumeCommand) {
    lines.push(`- Resume: ${manifest.resumeCommand}`);
  }
  if (manifest.legacy?.runDir) {
    lines.push(`- Legacy run dir: ${manifest.legacy.runDir}`);
  }
  if (manifest.legacy?.manifestPath) {
    lines.push(`- Legacy manifest: ${manifest.legacy.manifestPath}`);
  }
  lines.push(
    `- Manifest: ${manifest.artifacts.manifest}`,
    `- Queue: ${manifest.artifacts.queue}`,
    `- Downloads JSONL: ${manifest.artifacts.downloadsJsonl}`,
  );
  return `${lines.join('\n')}\n`;
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
    },
    completeness: {
      expectedCount: 0,
      resolvedCount: 0,
      complete: false,
      reason: 'legacy-downloader-required',
    },
  });
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
  await writeTextFile(layout.reportMarkdownPath, renderLegacyReport(manifest));
  return manifest;
}
