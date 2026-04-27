// @ts-check

import path from 'node:path';
import process from 'node:process';

import { normalizeText } from '../../shared/normalize.mjs';
import {
  createDownloadPlan as createRegistryDownloadPlan,
  resolveDownloadResources as resolveRegistryDownloadResources,
} from './registry.mjs';

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

function buildGenericLegacyCommand(entrypointPath, plan, request, layout) {
  return [entrypointPath, 'download', ...legacyItems(plan, request), '--out-dir', layout.runDir];
}

function buildLegacyCommandForSite(plan, sessionLease = null, request = {}, options = {}) {
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
  const builders = {
    bilibili: buildBilibiliArgs,
    douyin: buildDouyinArgs,
    xiaohongshu: buildXiaohongshuArgs,
    x: buildSocialArgs,
    instagram: buildSocialArgs,
  };
  const args = builders[plan.siteKey]
    ? builders[plan.siteKey](entrypointPath, plan, request, sessionLease ?? {}, options, layout)
    : buildGenericLegacyCommand(entrypointPath, plan, request, layout);
  return { command, args, executorKind };
}

function createLegacyOnlySiteModule(siteKey) {
  return {
    siteKey,
    async createPlan(request = {}, context = {}) {
      return await createRegistryDownloadPlan(request, context);
    },
    async resolveResources(plan, sessionLease = null, context = {}) {
      return await resolveRegistryDownloadResources(plan, sessionLease, context);
    },
    buildLegacyCommand: buildLegacyCommandForSite,
  };
}

const SITE_MODULES = Object.freeze({
  '22biqu': createLegacyOnlySiteModule('22biqu'),
  bilibili: createLegacyOnlySiteModule('bilibili'),
  douyin: createLegacyOnlySiteModule('douyin'),
  xiaohongshu: createLegacyOnlySiteModule('xiaohongshu'),
  x: createLegacyOnlySiteModule('x'),
  instagram: createLegacyOnlySiteModule('instagram'),
});

export function getDownloadSiteModule(siteKey) {
  return SITE_MODULES[normalizeText(siteKey).toLowerCase()] ?? null;
}

export function listDownloadSiteModules() {
  return Object.values(SITE_MODULES);
}

export async function createDownloadPlan(request = {}, context = {}) {
  const module = getDownloadSiteModule(context.definition?.siteKey ?? request.siteKey ?? request.site);
  if (module?.createPlan) {
    return await module.createPlan(request, context);
  }
  return await createRegistryDownloadPlan(request, context);
}

export async function resolveDownloadResources(plan, sessionLease = null, context = {}) {
  const module = getDownloadSiteModule(plan.siteKey);
  if (module?.resolveResources) {
    return await module.resolveResources(plan, sessionLease, context);
  }
  return await resolveRegistryDownloadResources(plan, sessionLease, context);
}

export function buildLegacyDownloadCommand(plan, sessionLease = null, request = {}, options = {}) {
  const module = getDownloadSiteModule(plan.siteKey);
  if (module?.buildLegacyCommand) {
    return module.buildLegacyCommand(plan, sessionLease, request, options);
  }
  return buildLegacyCommandForSite(plan, sessionLease, request, options);
}
