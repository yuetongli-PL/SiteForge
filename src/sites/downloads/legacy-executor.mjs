// @ts-check

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import {
  writeJsonFile,
  writeJsonLines,
  writeTextFile,
} from '../../infra/io.mjs';
import { normalizeText } from '../../shared/normalize.mjs';
import {
  normalizeDownloadRunManifest,
  resolveDownloadRunStatus,
} from './contracts.mjs';
import { buildDownloadRunLayout } from './artifacts.mjs';

function toArray(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function normalizePositiveInteger(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function isHttpUrl(value) {
  return /^https?:\/\//iu.test(String(value ?? '').trim());
}

function resolveEntrypoint(entrypoint, workspaceRoot) {
  const normalized = normalizeText(entrypoint);
  if (!normalized) {
    throw new Error('Legacy download plan is missing legacy.entrypoint.');
  }
  return path.isAbsolute(normalized) ? normalized : path.resolve(workspaceRoot, normalized);
}

function resolveExecutorKind(plan, entrypointPath) {
  const explicit = normalizeText(plan.legacy?.executorKind).toLowerCase();
  if (explicit) {
    return explicit;
  }
  return entrypointPath.endsWith('.mjs') || entrypointPath.endsWith('.js') ? 'node' : 'python';
}

function legacyItems(plan, request = {}) {
  const items = [
    ...toArray(request.items),
    request.input,
    request.inputUrl,
    request.url,
    request.account,
    plan.source?.input,
  ].map((item) => normalizeText(item)).filter(Boolean);
  return [...new Set(items)];
}

function pushFlag(args, flag, value) {
  if (value === undefined || value === null || value === '') {
    return;
  }
  args.push(flag, String(value));
}

function pushBooleanFlag(args, condition, trueFlag, falseFlag = null) {
  if (condition === undefined || condition === null) {
    return;
  }
  if (condition) {
    args.push(trueFlag);
  } else if (falseFlag) {
    args.push(falseFlag);
  }
}

function resolveReuseLoginState(request = {}, options = {}) {
  if (request.reuseLoginState !== undefined) {
    return request.reuseLoginState !== false;
  }
  if (options.reuseLoginState !== undefined) {
    return options.reuseLoginState !== false;
  }
  return true;
}

function addCommonProfileFlags(args, request = {}, sessionLease = {}) {
  pushFlag(args, '--profile-path', request.profilePath);
  pushFlag(args, '--browser-path', request.browserPath);
  pushFlag(args, '--browser-profile-root', request.browserProfileRoot ?? sessionLease.browserProfileRoot);
  pushFlag(args, '--user-data-dir', request.userDataDir ?? sessionLease.userDataDir);
  pushFlag(args, '--timeout', request.timeoutMs ?? request.timeout);
}

function addLoginFlags(args, request = {}, options = {}, siteKey) {
  const reuseLoginState = resolveReuseLoginState(request, options);
  pushBooleanFlag(args, reuseLoginState, '--reuse-login-state', '--no-reuse-login-state');
  if (siteKey === 'xiaohongshu') {
    pushBooleanFlag(args, request.autoLogin ?? options.autoLogin, '--auto-login', '--no-auto-login');
  } else {
    pushBooleanFlag(
      args,
      request.allowAutoLoginBootstrap ?? options.allowAutoLoginBootstrap,
      '--auto-login-bootstrap',
      '--no-auto-login-bootstrap',
    );
  }
  if (request.headless === false || options.headless === false) {
    args.push('--no-headless');
  } else if (request.headless === true || options.headless === true) {
    args.push('--headless');
  }
}

function addDownloadPolicyFlags(args, plan, request = {}) {
  const policy = plan.policy ?? {};
  pushFlag(args, '--concurrency', request.concurrency ?? policy.concurrency);
  const maxItems = normalizePositiveInteger(request.maxItems ?? request.limit ?? policy.maxItems, null);
  if (maxItems) {
    args.push('--max-items', String(maxItems));
  }
  if (request.concurrentFragments) {
    args.push('--concurrent-fragments', String(request.concurrentFragments));
  }
  if (request.maxHeight) {
    args.push('--max-height', String(request.maxHeight));
  }
  if (request.container) {
    args.push('--container', String(request.container));
  }
}

function buildBilibiliArgs(entrypointPath, plan, request, sessionLease, options, layout) {
  const args = [entrypointPath, 'download', ...legacyItems(plan, request)];
  addCommonProfileFlags(args, request, sessionLease);
  addLoginFlags(args, request, options, plan.siteKey);
  pushFlag(args, '--out-dir', layout.runDir);
  pushFlag(args, '--concurrency', request.concurrency ?? plan.policy?.concurrency);
  const playlistLimit = request.maxPlaylistItems ?? request.maxItems ?? plan.policy?.maxItems;
  if (normalizePositiveInteger(playlistLimit, null)) {
    args.push('--max-playlist-items', String(playlistLimit));
  }
  if (request.skipExisting ?? plan.policy?.skipExisting) {
    args.push('--skip-existing');
  }
  if (request.retryFailedOnly) {
    args.push('--retry-failed-only');
  }
  if (request.resume === false) {
    args.push('--no-resume');
  } else if (request.resume === true) {
    args.push('--resume');
  }
  pushFlag(args, '--download-archive', request.downloadArchivePath);
  return args;
}

function buildDouyinArgs(entrypointPath, plan, request, sessionLease, options, layout) {
  const args = [entrypointPath, 'download', ...legacyItems(plan, request)];
  addCommonProfileFlags(args, request, sessionLease);
  addLoginFlags(args, request, options, plan.siteKey);
  pushFlag(args, '--python-path', request.pythonPath ?? options.pythonPath);
  pushFlag(args, '--out-dir', layout.runDir);
  pushFlag(args, '--window', request.followUpdatesWindow ?? request.window);
  for (const user of toArray(request.userFilter ?? request.user ?? request.author)) {
    pushFlag(args, '--user', user);
  }
  for (const keyword of toArray(request.titleKeyword ?? request.keyword)) {
    pushFlag(args, '--keyword', keyword);
  }
  if (request.updatedOnly) {
    args.push('--updated-only');
  }
  addDownloadPolicyFlags(args, plan, request);
  args.push('--output', 'full', '--format', 'json');
  return args;
}

function buildXiaohongshuArgs(entrypointPath, plan, request, sessionLease, options, layout) {
  const args = [entrypointPath, 'download', ...legacyItems(plan, request)];
  addCommonProfileFlags(args, request, sessionLease);
  addLoginFlags(args, request, options, plan.siteKey);
  pushFlag(args, '--python-path', request.pythonPath ?? options.pythonPath);
  pushFlag(args, '--out-dir', layout.runDir);
  const maxItems = normalizePositiveInteger(request.maxItems ?? request.limit ?? plan.policy?.maxItems, null);
  if (maxItems) {
    args.push('--max-items', String(maxItems));
  }
  pushFlag(args, '--author-page-limit', request.authorPageLimit);
  if (request.followedUsers) {
    args.push('--followed-users');
  }
  pushFlag(args, '--followed-user-limit', request.followedUserLimit);
  for (const query of toArray(request.query ?? request.queries)) {
    pushFlag(args, '--query', query);
  }
  pushFlag(args, '--author-resume-state', request.authorResumeState);
  args.push('--output', 'full', '--format', 'json');
  return args;
}

function accountFromSocialInput(plan, request = {}) {
  const explicit = normalizeText(request.account ?? plan.source?.account);
  if (explicit) {
    return explicit;
  }
  const input = normalizeText(request.input ?? request.url ?? request.inputUrl ?? plan.source?.input);
  if (!isHttpUrl(input)) {
    return input;
  }
  try {
    const parsed = new URL(input);
    const segment = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
    if (!segment || ['home', 'explore', 'search', 'notifications'].includes(segment.toLowerCase())) {
      return '';
    }
    return segment.replace(/^@/u, '');
  } catch {
    return input;
  }
}

function inferSocialAction(plan, request = {}) {
  const explicit = normalizeText(request.action ?? request.downloadAction);
  if (explicit) {
    return explicit;
  }
  if (plan.taskType === 'media-bundle') {
    return 'media';
  }
  return 'full-archive';
}

function buildSocialArgs(entrypointPath, plan, request, sessionLease, options, layout) {
  const action = inferSocialAction(plan, request);
  const account = accountFromSocialInput(plan, request);
  const args = [entrypointPath, action];
  if (account) {
    args.push(account);
  }
  addCommonProfileFlags(args, request, sessionLease);
  addLoginFlags(args, request, options, plan.siteKey);
  pushFlag(args, '--out-dir', request.outDir);
  pushFlag(args, '--run-dir', layout.runDir);
  pushFlag(args, '--max-items', request.maxItems ?? plan.policy?.maxItems);
  pushFlag(args, '--max-scrolls', request.maxScrolls);
  pushFlag(args, '--max-api-pages', request.maxApiPages);
  pushFlag(args, '--max-users', request.maxUsers);
  pushFlag(args, '--max-detail-pages', request.maxDetailPages);
  pushFlag(args, '--per-user-max-items', request.perUserMaxItems);
  pushFlag(args, '--date', request.date);
  pushFlag(args, '--from', request.fromDate);
  pushFlag(args, '--to', request.toDate);
  pushFlag(args, '--content-type', request.contentType);
  if (request.downloadMedia || request.download === true || plan.taskType === 'media-bundle') {
    args.push('--download-media');
  }
  pushFlag(args, '--max-media-downloads', request.maxMediaDownloads);
  pushFlag(args, '--media-download-concurrency', request.mediaDownloadConcurrency ?? plan.policy?.concurrency);
  pushFlag(args, '--media-download-retries', request.mediaDownloadRetries ?? plan.policy?.retries);
  pushFlag(args, '--media-download-backoff-ms', request.mediaDownloadBackoffMs ?? plan.policy?.retryBackoffMs);
  if (request.skipExistingDownloads === false) {
    args.push('--no-skip-existing-downloads');
  } else if (request.skipExistingDownloads === true || plan.policy?.skipExisting) {
    args.push('--skip-existing-downloads');
  }
  if (request.apiCursor === false) {
    args.push('--no-api-cursor');
  } else if (request.apiCursor !== undefined) {
    pushFlag(args, '--api-cursor', request.apiCursor);
  }
  args.push('--format', 'json');
  return args;
}

function build22BiquCommand(entrypointPath, plan, request, options, layout) {
  const input = normalizeText(request.input ?? request.url ?? request.inputUrl ?? plan.source?.input);
  const command = request.pythonPath ?? options.pythonPath ?? plan.legacy?.pythonPath ?? 'python';
  const baseUrl = normalizeText(request.siteUrl ?? request.baseUrl ?? plan.source?.canonicalUrl) || 'https://www.22biqu.com/';
  const args = [entrypointPath, baseUrl, '--out-dir', layout.runDir];
  if (isHttpUrl(input)) {
    args.push('--book-url', input);
  } else if (input) {
    args.push('--book-title', input);
  }
  if (request.metadataOnly) {
    args.push('--metadata-only');
  }
  if (request.forceRecrawl) {
    args.push('--force-recrawl');
  }
  pushFlag(args, '--profile-path', request.profilePath);
  pushFlag(args, '--crawler-scripts-dir', request.crawlerScriptsDir);
  pushFlag(args, '--knowledge-base-dir', request.knowledgeBaseDir);
  pushFlag(args, '--node-executable', request.nodeExecutable ?? options.nodeExecutable);
  return { command, args, executorKind: 'python' };
}

export function buildLegacyDownloadCommand(plan, sessionLease = null, request = {}, options = {}) {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const layout = options.layout;
  if (!layout) {
    throw new Error('buildLegacyDownloadCommand requires options.layout.');
  }
  const entrypointPath = resolveEntrypoint(plan.legacy?.entrypoint, workspaceRoot);
  const executorKind = resolveExecutorKind(plan, entrypointPath);

  if (plan.siteKey === '22biqu') {
    return build22BiquCommand(entrypointPath, plan, request, options, layout);
  }

  const command = executorKind === 'node'
    ? (options.nodePath ?? request.nodePath ?? process.execPath)
    : (options.pythonPath ?? request.pythonPath ?? 'python');
  let args;
  switch (plan.siteKey) {
    case 'bilibili':
      args = buildBilibiliArgs(entrypointPath, plan, request, sessionLease ?? {}, options, layout);
      break;
    case 'douyin':
      args = buildDouyinArgs(entrypointPath, plan, request, sessionLease ?? {}, options, layout);
      break;
    case 'xiaohongshu':
      args = buildXiaohongshuArgs(entrypointPath, plan, request, sessionLease ?? {}, options, layout);
      break;
    case 'x':
    case 'instagram':
      args = buildSocialArgs(entrypointPath, plan, request, sessionLease ?? {}, options, layout);
      break;
    default:
      args = [entrypointPath, 'download', ...legacyItems(plan, request), '--out-dir', layout.runDir];
      break;
  }
  return { command, args, executorKind };
}

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
    ['downloadResult', 'manifest', 'summary'],
    ['downloadResult', 'summary'],
    ['download', 'summary'],
    ['download', 'summaryView'],
    ['result', 'download', 'summary'],
  ]) ?? {};
}

function extractCounts(payload = {}, exitCode = 0) {
  const summary = extractSummary(payload);
  const downloaded = numberValue(
    summary.downloaded,
    summary.successful,
    summary.success,
    summary.completed,
  );
  const failed = numberValue(summary.failed, summary.errors);
  const skipped = numberValue(summary.skipped);
  const planned = numberValue(summary.planned);
  const partial = numberValue(summary.partial);
  const total = numberValue(
    summary.expected,
    summary.total,
    summary.count,
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
      ?? stderr,
  ) || undefined;
}

function resolveLegacyStatus(payload = {}, exitCode = 0, counts = {}, stderr = '') {
  const reason = extractReason(payload, stderr);
  if (payload.status && ['passed', 'partial', 'failed', 'blocked', 'skipped'].includes(payload.status)) {
    return payload.status;
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
    payload.downloadResult?.results,
    payload.download?.results,
    payload.download?.files,
    payload.result?.download?.results,
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
      ?? payload.download?.runDir
      ?? payload.downloadResult?.manifest?.runDir
      ?? payload.downloadResult?.runDir
      ?? payload.manifest?.runDir,
  ) || undefined;
}

function extractLegacyManifestPath(payload = {}) {
  return normalizeText(
    payload.manifestPath
      ?? payload.downloadResult?.manifestPath
      ?? payload.downloadResult?.manifest?.manifestPath
      ?? payload.download?.manifestPath,
  ) || undefined;
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
  if (manifest.legacy?.runDir) {
    lines.push(`- Legacy run dir: ${manifest.legacy.runDir}`);
  }
  if (manifest.legacy?.manifestPath) {
    lines.push(`- Legacy manifest: ${manifest.legacy.manifestPath}`);
  }
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
      stdoutJson: Object.keys(payload).length > 0,
      stderr: previewText(processResult.stderr),
    },
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  });

  await writeJsonLines(layout.downloadsJsonlPath, [{
    legacy: true,
    status,
    reason,
    counts,
    files,
    failedResources,
    exitCode: processResult.code,
  }]);
  await writeJsonFile(layout.manifestPath, manifest);
  await writeTextFile(layout.reportMarkdownPath, renderLegacyReport(manifest));
  return manifest;
}
