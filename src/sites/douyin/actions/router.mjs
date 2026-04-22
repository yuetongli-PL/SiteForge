// @ts-check

import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { enumerateDouyinAuthorVideos } from '../download/enumerator.mjs';
import { queryDouyinFollow } from '../queries/follow-query.mjs';
import { resolveDouyinMediaBatch } from '../queries/media-resolver.mjs';
import {
  bootstrapReusableSiteSession,
  inspectRequestReusableSiteSession,
} from '../../../infra/auth/site-login-service.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..', '..');
const DOUYIN_DOWNLOAD_PYTHON_ENTRY = path.join(REPO_ROOT, 'src', 'sites', 'douyin', 'download', 'python', 'douyin.py');
const DOUYIN_HOME_URL = 'https://www.douyin.com/';
const VIDEO_ID_PATTERN = /^\d{10,20}$/u;

function normalizeBoolean(value, defaultValue = false) {
  return typeof value === 'boolean' ? value : defaultValue;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeDouyinDownloadSpec(value) {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    const finalUrl = normalizeText(value);
    return finalUrl ? {
      finalUrl,
      resolutionPathway: inferInitialDouyinResolutionPathway(finalUrl),
    } : null;
  }
  const finalUrl = normalizeText(value.finalUrl || value.url || value.normalizedUrl || value.source);
  if (!finalUrl) {
    return null;
  }
  return {
    finalUrl,
    videoId: normalizeText(value.videoId) || null,
    source: normalizeText(value.source) || null,
    resolutionPathway: inferResolutionPathway(value.resolutionPathway || value.resolvedVia || value.source)
      || inferInitialDouyinResolutionPathway(finalUrl),
    resolvedMediaUrl: normalizeText(value.resolvedMediaUrl) || null,
    resolvedTitle: normalizeText(value.resolvedTitle) || normalizeText(value.title) || null,
    resolvedFormat: value.resolvedFormat ?? null,
    resolvedFormats: Array.isArray(value.resolvedFormats) ? value.resolvedFormats : [],
    downloadHeaders: value.downloadHeaders && typeof value.downloadHeaders === 'object' ? value.downloadHeaders : null,
  };
}

function looksLikeDirectDouyinMediaUrl(value) {
  const text = normalizeText(value);
  if (!text) {
    return false;
  }
  try {
    const parsed = new URL(text);
    const hostname = normalizeText(parsed.hostname).toLowerCase();
    const pathname = normalizeText(parsed.pathname).toLowerCase();
    if (hostname.endsWith('douyinvod.com') || hostname.endsWith('douyinstatic.com')) {
      return true;
    }
    if (pathname.endsWith('.mp4') || pathname.endsWith('.m3u8')) {
      return true;
    }
    if (pathname.includes('.mp4') || pathname.includes('.m3u8')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function isTransientDouyinResolverError(error) {
  const text = normalizeText(error?.message || error);
  if (!text) {
    return false;
  }
  return /CDP timeout for Runtime\.evaluate|CDP socket closed|Target closed|Session closed|Execution context was destroyed|Browser exited before DevTools became ready/iu.test(text);
}

function buildResolvedMediaLookupItem(item = {}) {
  const requestedUrl = normalizeText(item?.requestedUrl);
  if (!requestedUrl) {
    return null;
  }
  return [requestedUrl, item];
}

function mergeDownloadHeaders(...values) {
  const merged = {};
  for (const value of values) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    for (const [key, headerValue] of Object.entries(value)) {
      const headerName = normalizeText(key);
      const headerText = normalizeText(headerValue);
      if (!headerName || !headerText) {
        continue;
      }
      merged[headerName] = headerText;
    }
  }
  return Object.keys(merged).length ? merged : null;
}

function incrementCount(map, key, amount = 1) {
  const normalizedKey = normalizeText(key);
  if (!normalizedKey) {
    return;
  }
  map[normalizedKey] = (map[normalizedKey] ?? 0) + amount;
}

function inferResolutionPathway(value) {
  const source = normalizeText(value).toLowerCase();
  if (!source) {
    return null;
  }
  if (source.includes('cache')) {
    return 'cache';
  }
  if (source.includes('api')) {
    return 'api';
  }
  if (source.includes('detail') || source.includes('browser')) {
    return 'detail';
  }
  if (source.includes('direct')) {
    return 'direct-media';
  }
  return source;
}

function inferInitialDouyinResolutionPathway(finalUrl) {
  const text = normalizeText(finalUrl);
  if (!text) {
    return null;
  }
  if (looksLikeDirectDouyinMediaUrl(text)) {
    return 'direct-media';
  }
  try {
    const parsed = new URL(text);
    if (parsed.hostname.toLowerCase() !== 'www.douyin.com') {
      return null;
    }
    if (parsed.pathname.startsWith('/video/') || parsed.pathname.startsWith('/shipin/')) {
      return 'detail';
    }
    return null;
  } catch {
    return null;
  }
}

function buildResolvedDownloadSpec(spec, media = null) {
  const normalized = normalizeDouyinDownloadSpec(spec);
  if (!normalized) {
    return null;
  }
  if (!(media?.resolved === true) || !looksLikeDirectDouyinMediaUrl(media?.bestUrl)) {
    return normalized;
  }
  return normalizeDouyinDownloadSpec({
    ...normalized,
    videoId: normalizeText(media?.videoId) || normalized.videoId || null,
    resolutionPathway: inferResolutionPathway(media?.resolutionPathway || media?.source || normalized.resolutionPathway || 'detail'),
    resolvedMediaUrl: normalizeText(media?.bestUrl) || normalized.resolvedMediaUrl || null,
    resolvedTitle: normalizeText(media?.title) || normalized.resolvedTitle || null,
    resolvedFormat: media?.bestFormat ?? normalized.resolvedFormat ?? null,
    resolvedFormats: Array.isArray(media?.formats) && media.formats.length ? media.formats : normalized.resolvedFormats,
    downloadHeaders: mergeDownloadHeaders(normalized.downloadHeaders, media?.headers),
  });
}

async function preResolveDouyinDownloadSpecs(inputs, request, deps = {}) {
  const startedAt = Date.now();
  const normalizedInputs = (Array.isArray(inputs) ? inputs : [])
    .map((item) => normalizeDouyinDownloadSpec(item))
    .filter(Boolean);
  const pathStats = {};
  for (const item of normalizedInputs) {
    incrementCount(pathStats, item?.resolutionPathway);
  }
  const unresolvedUrls = normalizedInputs
    .filter((item) => !looksLikeDirectDouyinMediaUrl(item?.resolvedMediaUrl))
    .map((item) => normalizeText(item?.finalUrl))
    .filter(Boolean);

  if (!unresolvedUrls.length) {
    return {
      items: normalizedInputs,
      mediaResolution: {
        ok: true,
        skipped: false,
        attemptedCount: 0,
        resolvedCount: normalizedInputs.length,
        preResolvedCount: normalizedInputs.length,
        fallbackCount: 0,
        retryCount: 0,
        pathStats,
        timingsMs: {
          total: Date.now() - startedAt,
        },
        error: null,
      },
    };
  }

  if (request?.download?.dryRun === true) {
    return {
      items: normalizedInputs,
      mediaResolution: {
        ok: true,
        skipped: true,
        attemptedCount: 0,
        resolvedCount: normalizedInputs.length - unresolvedUrls.length,
        preResolvedCount: normalizedInputs.length - unresolvedUrls.length,
        fallbackCount: 0,
        retryCount: 0,
        pathStats,
        timingsMs: {
          total: Date.now() - startedAt,
        },
        error: null,
      },
    };
  }

  let mediaReport = null;
  let lastResolverError = null;
  let retryCount = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mediaReport = await (deps.resolveDouyinMediaBatch ?? resolveDouyinMediaBatch)(unresolvedUrls, {
        profilePath: request.profilePath,
        browserPath: request.browserPath,
        browserProfileRoot: request.browserProfileRoot,
        userDataDir: request.userDataDir,
        reuseLoginState: request.reuseLoginState !== false,
        autoLogin: request.allowAutoLoginBootstrap !== false,
        headless: request.headless,
        timeoutMs: request.timeoutMs,
      });
      lastResolverError = null;
      break;
    } catch (error) {
      lastResolverError = error;
      if (!isTransientDouyinResolverError(error) || attempt >= 1) {
        break;
      }
      retryCount += 1;
    }
  }

  const resultMap = new Map(
    (mediaReport?.results || [])
      .map((item) => buildResolvedMediaLookupItem(item))
      .filter(Boolean),
  );
  const enrichedItems = normalizedInputs
    .map((item) => buildResolvedDownloadSpec(item, resultMap.get(normalizeText(item?.finalUrl))))
    .filter(Boolean);
  const resolvedCount = enrichedItems.filter((item) => looksLikeDirectDouyinMediaUrl(item?.resolvedMediaUrl)).length;
  const preResolvedCount = normalizedInputs.length - unresolvedUrls.length;

  return {
    items: enrichedItems,
    mediaResolution: {
      ok: Boolean(mediaReport) && !lastResolverError,
      skipped: false,
      attemptedCount: unresolvedUrls.length,
      resolvedCount,
      preResolvedCount,
      fallbackCount: Math.max(0, unresolvedUrls.length - Math.max(0, resolvedCount - preResolvedCount)),
      retryCount,
      pathStats: (() => {
        const merged = { ...pathStats };
        for (const item of enrichedItems) {
          incrementCount(merged, item?.resolutionPathway);
        }
        return merged;
      })(),
      timingsMs: {
        total: Date.now() - startedAt,
      },
      error: lastResolverError ? normalizeText(lastResolverError?.message || lastResolverError) : null,
    },
  };
}

export function classifyDouyinDownloadInput(raw) {
  const value = normalizeText(raw);
  if (!value) {
    return { source: value, inputKind: 'unknown', authRequired: true };
  }
  if (VIDEO_ID_PATTERN.test(value)) {
    return { source: value, inputKind: 'video-detail', authRequired: true };
  }
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname || '/';
    if (host !== 'www.douyin.com') {
      return { source: value, inputKind: 'unknown', authRequired: true };
    }
    if (pathname.startsWith('/video/') || pathname.startsWith('/shipin/')) {
      return { source: value, inputKind: 'video-detail', authRequired: true };
    }
    if (pathname.startsWith('/user/')) {
      return { source: value, inputKind: 'author-video-list', authRequired: true };
    }
    return { source: value, inputKind: 'unknown', authRequired: true };
  } catch {
    return { source: value, inputKind: 'unknown', authRequired: true };
  }
}

function buildLoginFailureResult(plan, report) {
  return {
    ok: false,
    action: plan.action,
    plan,
    reasonCode: 'login-bootstrap-failed',
    loginReport: report,
  };
}

export async function planDouyinAction(request, deps = {}) {
  const action = normalizeText(request?.action) || 'download';
  const reuseLoginState = request?.reuseLoginState !== false;
  if (action === 'download') {
    const items = Array.isArray(request.items) ? request.items.map((item) => normalizeText(item)).filter(Boolean) : [];
    const classifications = items.map(classifyDouyinDownloadInput);
    const usesFollowUpdates = normalizeText(request.followUpdatesWindow).length > 0;
    if (!items.length && !usesFollowUpdates) {
      throw new Error('Douyin download requires either concrete items or --window for followed updates.');
    }
    if (classifications.some((item) => item.inputKind === 'unknown')) {
      const firstUnknown = classifications.find((item) => item.inputKind === 'unknown');
      throw new Error(`Unsupported Douyin download input: ${firstUnknown?.source ?? 'unknown'}`);
    }
    const sessionState = await (deps.inspectRequestReusableSiteSession ?? inspectRequestReusableSiteSession)(
      DOUYIN_HOME_URL,
      request,
      deps,
      { reuseLoginState },
    );
    return {
      action,
      items,
      classifications,
      followUpdatesWindow: usesFollowUpdates ? normalizeText(request.followUpdatesWindow) : null,
      authRequired: true,
      route: reuseLoginState && !sessionState.authAvailable ? 'download-after-login' : 'download-direct',
      reason: reuseLoginState && !sessionState.authAvailable
        ? 'Douyin downloads need a reusable local session because yt-dlp requires fresh cookies.'
        : 'Douyin downloads can reuse the local persistent profile for fresh cookies.',
      authAvailable: sessionState.authAvailable,
      userDataDir: sessionState.userDataDir,
      profileHealth: sessionState.profileHealth,
      profilePath: sessionState.profilePath,
    };
  }
  if (action === 'login') {
    const sessionState = await (deps.inspectRequestReusableSiteSession ?? inspectRequestReusableSiteSession)(
      request.targetUrl || DOUYIN_HOME_URL,
      request,
      deps,
      { reuseLoginState },
    );
    return {
      action,
      targetUrl: request.targetUrl || DOUYIN_HOME_URL,
      route: 'site-login',
      reason: 'Login bootstrap always runs through the local site-login helper.',
      authRequired: true,
      authAvailable: sessionState.authAvailable,
      userDataDir: sessionState.userDataDir,
      profileHealth: sessionState.profileHealth,
      profilePath: sessionState.profilePath,
    };
  }
  throw new Error(`Unsupported Douyin action: ${action}`);
}

async function spawnJsonCommand(command, args, { cwd = REPO_ROOT } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        PYTHONIOENCODING: process.env.PYTHONIOENCODING || 'utf-8',
        PYTHONUTF8: process.env.PYTHONUTF8 || '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      resolve({ code: Number(code ?? 1), stdout, stderr });
    });
  });
}

async function resolveConcreteDownloadInputs(request, deps = {}) {
  const resolved = [];
  const seen = new Set();
  const addItem = (value) => {
    const normalized = normalizeDouyinDownloadSpec(value);
    const dedupeKey = normalizeText(normalized?.finalUrl);
    if (!normalized || !dedupeKey || seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    resolved.push(normalized);
  };

  for (const item of request.items || []) {
    const classification = classifyDouyinDownloadInput(item);
    if (classification.inputKind === 'video-detail') {
      addItem({
        finalUrl: VIDEO_ID_PATTERN.test(item) ? `https://www.douyin.com/video/${item}` : item,
        videoId: VIDEO_ID_PATTERN.test(item) ? normalizeText(item) : null,
      });
      continue;
    }
    if (classification.inputKind === 'author-video-list') {
      let authorReport = null;
      let lastAuthorError = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          authorReport = await (deps.enumerateDouyinAuthorVideos ?? enumerateDouyinAuthorVideos)(item, {
            profilePath: request.profilePath,
            browserPath: request.browserPath,
            browserProfileRoot: request.browserProfileRoot,
            userDataDir: request.userDataDir,
            reuseLoginState: request.reuseLoginState,
            autoLogin: request.allowAutoLoginBootstrap !== false,
            headless: request.headless,
            timeoutMs: request.timeoutMs,
            limit: request.download?.maxItems ?? request.limit ?? null,
          });
          lastAuthorError = null;
          break;
        } catch (error) {
          lastAuthorError = error;
          if (!isTransientDouyinResolverError(error) || attempt >= 1) {
            throw error;
          }
        }
      }
      if (!authorReport && lastAuthorError) {
        throw lastAuthorError;
      }
      for (const video of authorReport?.result?.videos || []) {
        addItem(video);
      }
    }
  }

  if (normalizeText(request.followUpdatesWindow)) {
    let followReport = null;
    let lastFollowError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        followReport = await (deps.queryDouyinFollow ?? queryDouyinFollow)(DOUYIN_HOME_URL, {
          intent: 'list-followed-updates',
          timeWindow: request.followUpdatesWindow,
          profilePath: request.profilePath,
          browserPath: request.browserPath,
          browserProfileRoot: request.browserProfileRoot,
          userDataDir: request.userDataDir,
          reuseLoginState: request.reuseLoginState !== false,
          autoLogin: request.allowAutoLoginBootstrap !== false,
          headless: request.headless,
          timeoutMs: request.timeoutMs,
          userFilter: request.userFilter,
          titleKeyword: request.titleKeyword,
          limit: request.download?.maxItems ?? request.limit ?? null,
          updatedOnly: normalizeBoolean(request.updatedOnly, true),
        });
        lastFollowError = null;
        break;
      } catch (error) {
        lastFollowError = error;
        if (!isTransientDouyinResolverError(error) || attempt >= 1) {
          throw error;
        }
      }
    }
    if (!followReport && lastFollowError) {
      throw lastFollowError;
    }
    for (const video of followReport?.result?.videos || []) {
      addItem(video);
    }
  }

  return await preResolveDouyinDownloadSpecs(resolved, request, deps);
}

async function invokeDownloadCli(request, inputs, deps = {}) {
  const pythonPath = request.pythonPath || 'python';
  const scriptPath = DOUYIN_DOWNLOAD_PYTHON_ENTRY;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'douyin-download-inputs-'));
  const inputFile = path.join(tempDir, 'inputs.txt');
  await writeFile(
    inputFile,
    `${inputs
      .map((item) => {
        const normalized = normalizeDouyinDownloadSpec(item);
        if (!normalized) {
          return null;
        }
        const hasResolvedPayload = Boolean(
          normalized.resolvedMediaUrl
          || (Array.isArray(normalized.resolvedFormats) && normalized.resolvedFormats.length)
          || normalized.downloadHeaders,
        );
        return hasResolvedPayload ? JSON.stringify(normalized) : normalized.finalUrl;
      })
      .filter(Boolean)
      .join(os.EOL)}${os.EOL}`,
    'utf8',
  );
  try {
    const args = [scriptPath, '--input-file', inputFile];
    if (request.reuseLoginState !== false) {
      args.push('--reuse-login-state');
    } else {
      args.push('--no-reuse-login-state');
    }
    if (request.profilePath) {
      args.push('--profile-path', request.profilePath);
    }
    if (request.browserProfileRoot) {
      args.push('--profile-root', request.browserProfileRoot);
    }
    if (request.browserPath) {
      args.push('--browser-path', request.browserPath);
    }
    if (request.outDir) {
      args.push('--out-dir', request.outDir);
    }
    if (request.timeoutMs) {
      args.push('--browser-timeout', String(request.timeoutMs));
    }
    const download = request.download || {};
    if (download.dryRun) {
      args.push('--dry-run');
    }
    if (download.concurrency) {
      args.push('--concurrency', String(download.concurrency));
    }
    if (download.concurrentFragments) {
      args.push('--concurrent-fragments', String(download.concurrentFragments));
    }
    if (download.maxItems) {
      args.push('--max-items', String(download.maxItems));
    }
    if (download.maxHeight) {
      args.push('--max-height', String(download.maxHeight));
    }
    if (download.container) {
      args.push('--container', String(download.container));
    }
    if (request.headless === false) {
      args.push('--no-headless');
    } else if (request.headless === true) {
      args.push('--headless');
    }

    const result = await (deps.spawnJsonCommand ?? spawnJsonCommand)(pythonPath, args);
    const payload = result.stdout ? JSON.parse(result.stdout) : null;
    return {
      process: result,
      payload,
      inputFile,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function buildDownloadActionSummary(download = null, mediaResolution = null) {
  const summary = download?.summary || {};
  const statistics = download?.statistics || {};
  return {
    total: Number(summary.total || 0),
    successful: Number(summary.successful || 0),
    failed: Number(summary.failed || 0),
    skipped: Number(summary.skipped || 0),
    planned: Number(summary.planned || 0),
    runDir: normalizeText(download?.runDir) || null,
    pathStats: statistics.pathStats || {},
    mediaResolution: mediaResolution || download?.mediaResolution || null,
  };
}

function buildDownloadActionMarkdown(download = null, mediaResolution = null) {
  const summary = buildDownloadActionSummary(download, mediaResolution);
  const lines = [
    '# Douyin Download Action',
    '',
    `- Total: ${summary.total}`,
    `- Successful: ${summary.successful}`,
    `- Failed: ${summary.failed}`,
    `- Skipped: ${summary.skipped}`,
    `- Planned: ${summary.planned}`,
  ];
  if (summary.runDir) {
    lines.push(`- Run Dir: \`${summary.runDir}\``);
  }
  if (Object.keys(summary.pathStats || {}).length) {
    lines.push('', '## Download Paths');
    for (const key of Object.keys(summary.pathStats).sort()) {
      lines.push(`- \`${key}\`: ${summary.pathStats[key]}`);
    }
  }
  if (Object.keys(summary.mediaResolution?.pathStats || {}).length) {
    lines.push('', '## Media Resolution Paths');
    for (const key of Object.keys(summary.mediaResolution.pathStats).sort()) {
      lines.push(`- \`${key}\`: ${summary.mediaResolution.pathStats[key]}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export async function runDouyinAction(request, deps = {}) {
  const plan = await planDouyinAction(request, deps);
  const normalizedHeadless = request.headless ?? false;
  if (plan.action === 'login') {
    const loginBootstrap = await (deps.bootstrapReusableSiteSession ?? bootstrapReusableSiteSession)(
      plan.targetUrl,
      request,
      deps,
      {
        headless: normalizedHeadless,
      },
    );
    const report = loginBootstrap.report;
    return {
      ok: loginBootstrap.ok,
      action: 'login',
      reasonCode: 'login-finished',
      plan,
      loginReport: report,
    };
  }

  let loginReport = null;
  if (plan.route === 'download-after-login') {
    const loginBootstrap = await (deps.bootstrapReusableSiteSession ?? bootstrapReusableSiteSession)(
      DOUYIN_HOME_URL,
      request,
      deps,
      {
        headless: normalizedHeadless,
      },
    );
    loginReport = loginBootstrap.report;
    if (!loginBootstrap.ok) {
      return buildLoginFailureResult(plan, loginReport);
    }
  }

  const concreteDownloadPlan = await resolveConcreteDownloadInputs(request, deps);
  const concreteInputs = concreteDownloadPlan?.items || [];
  if (!concreteInputs.length) {
    return {
      ok: false,
      action: 'download',
      reasonCode: 'no-downloadable-videos',
      plan,
      loginReport,
      mediaResolution: concreteDownloadPlan?.mediaResolution ?? null,
      resolvedInputs: [],
    };
  }

  const invoked = await invokeDownloadCli(request, concreteInputs, deps);
  return {
    ok: invoked.process.code === 0,
    action: 'download',
    reasonCode: invoked.process.code === 0 ? 'download-started' : 'download-failed',
    plan,
    loginReport,
    mediaResolution: concreteDownloadPlan?.mediaResolution ?? null,
    resolvedInputs: concreteInputs.map((item) => item.finalUrl),
    download: invoked.payload,
    actionSummary: buildDownloadActionSummary(invoked.payload, concreteDownloadPlan?.mediaResolution ?? null),
    markdown: buildDownloadActionMarkdown(invoked.payload, concreteDownloadPlan?.mediaResolution ?? null),
    stderr: invoked.process.stderr,
  };
}
