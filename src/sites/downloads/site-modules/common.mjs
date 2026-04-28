// @ts-check

import path from 'node:path';

import { normalizeText } from '../../../shared/normalize.mjs';
import {
  normalizeDownloadResource,
  normalizeResolvedDownloadTask,
} from '../contracts.mjs';

export { normalizeText };

export function toArray(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

export function normalizePositiveInteger(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function isHttpUrl(value) {
  return /^https?:\/\//iu.test(String(value ?? '').trim());
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function mergeHeaders(...sources) {
  const result = {};
  for (const source of sources) {
    if (!isObject(source)) {
      continue;
    }
    for (const [key, value] of Object.entries(source)) {
      const normalizedKey = normalizeText(key);
      if (!normalizedKey || value === undefined || value === null || value === '') {
        continue;
      }
      result[normalizedKey] = String(value);
    }
  }
  return result;
}

function firstText(...values) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function absoluteUrl(value, baseUrl) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }
  try {
    if (normalized.startsWith('//')) {
      return new URL(`https:${normalized}`).toString();
    }
    return new URL(normalized, baseUrl).toString();
  } catch {
    return '';
  }
}

function compactTitle(value, fallback) {
  const normalized = firstText(value, fallback, 'download');
  return normalized.replace(/[<>:"/\\|?*\x00-\x1F]+/gu, '-').replace(/-+/gu, '-').trim() || 'download';
}

function extensionFromContentType(contentType) {
  const normalized = normalizeText(contentType).toLowerCase();
  if (normalized.includes('jpeg')) {
    return 'jpg';
  }
  if (normalized.includes('png')) {
    return 'png';
  }
  if (normalized.includes('webp')) {
    return 'webp';
  }
  if (normalized.includes('gif')) {
    return 'gif';
  }
  if (normalized.includes('mp4')) {
    return 'mp4';
  }
  if (normalized.includes('mpegurl') || normalized.includes('m3u8')) {
    return 'm3u8';
  }
  if (normalized.includes('mpeg') || normalized.includes('mp3')) {
    return 'mp3';
  }
  if (normalized.includes('json')) {
    return 'json';
  }
  return '';
}

function extensionFromUrl(url) {
  try {
    const ext = path.extname(new URL(url).pathname).replace(/^\./u, '').toLowerCase();
    return /^[a-z0-9]{1,8}$/u.test(ext) ? ext : '';
  } catch {
    return '';
  }
}

function extensionForResource(seed, url, mediaType) {
  return firstText(
    normalizeText(seed.extension).replace(/^\./u, ''),
    extensionFromContentType(seed.contentType ?? seed.mimeType ?? seed.headers?.['content-type'] ?? seed.headers?.['Content-Type']),
    extensionFromUrl(url),
    mediaType === 'video' ? 'mp4' : '',
    mediaType === 'image' ? 'jpg' : '',
    mediaType === 'audio' ? 'mp3' : '',
    mediaType === 'json' ? 'json' : '',
    'bin',
  );
}

function inferMediaType(seed, fallbackMediaType) {
  const explicit = firstText(seed.mediaType, seed.kind, seed.type).toLowerCase();
  if (['text', 'image', 'video', 'audio', 'json', 'binary'].includes(explicit)) {
    return explicit;
  }
  const contentType = normalizeText(seed.contentType ?? seed.mimeType ?? seed.headers?.['content-type'] ?? seed.headers?.['Content-Type']).toLowerCase();
  if (contentType.includes('image/')) {
    return 'image';
  }
  if (contentType.includes('video/')) {
    return 'video';
  }
  if (contentType.includes('audio/')) {
    return 'audio';
  }
  if (contentType.includes('json')) {
    return 'json';
  }
  const url = normalizeText(seed.url ?? seed.resourceUrl ?? seed.downloadUrl ?? seed.mediaUrl ?? seed.directUrl ?? seed.resolvedMediaUrl ?? seed.bestUrl ?? seed.src ?? seed.href);
  const ext = extensionFromUrl(url);
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(ext)) {
    return 'image';
  }
  if (['mp4', 'm4v', 'm4s', 'flv', 'webm', 'mov', 'm3u8'].includes(ext)) {
    return 'video';
  }
  if (['mp3', 'm4a', 'aac', 'wav', 'ogg'].includes(ext)) {
    return 'audio';
  }
  if (ext === 'json') {
    return 'json';
  }
  return fallbackMediaType ?? 'binary';
}

function directUrlFromSeed(seed, baseUrl) {
  for (const key of ['url', 'resourceUrl', 'downloadUrl', 'mediaUrl', 'directUrl', 'resolvedMediaUrl', 'bestUrl', 'src', 'href']) {
    const url = absoluteUrl(seed[key], baseUrl);
    if (url) {
      return url;
    }
  }
  return '';
}

function urlListFromSeed(seed, baseUrl) {
  const urls = [];
  for (const key of ['urls', 'urlList', 'url_list']) {
    for (const value of toArray(seed[key])) {
      const url = typeof value === 'string'
        ? absoluteUrl(value, baseUrl)
        : isObject(value)
          ? directUrlFromSeed(value, baseUrl)
          : '';
      if (url) {
        urls.push(url);
      }
    }
  }
  return urls;
}

function flattenSeedValue(value, inherited = {}, baseUrl = '') {
  const entries = [];
  const append = (entry, extra = {}) => {
    if (isObject(entry)) {
      entries.push({
        ...inherited,
        ...extra,
        ...entry,
        headers: mergeHeaders(inherited.headers, extra.headers, entry.headers),
      });
    } else if (typeof entry === 'string') {
      entries.push({ ...inherited, ...extra, url: entry });
    }
  };

  if (typeof value === 'string') {
    append(value);
    return entries;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      entries.push(...flattenSeedValue(item, inherited, baseUrl));
    }
    return entries;
  }
  if (!isObject(value)) {
    return entries;
  }

  const nextInherited = {
    ...inherited,
    title: firstText(value.title, value.resolvedTitle, value.name, inherited.title),
    sourceUrl: firstText(value.sourceUrl, value.requestedUrl, value.pageUrl, value.finalUrl, inherited.sourceUrl),
    referer: firstText(value.referer, value.sourceUrl, value.requestedUrl, value.pageUrl, value.finalUrl, inherited.referer),
    headers: mergeHeaders(inherited.headers, value.headers),
    groupId: firstText(value.groupId, value.noteId, value.videoId, value.id, inherited.groupId),
  };

  if (directUrlFromSeed(value, baseUrl)) {
    append(value);
  } else {
    for (const url of urlListFromSeed(value, baseUrl)) {
      append({ url });
    }
  }

  for (const key of [
    'resources',
    'resourceSeeds',
    'resolvedResources',
    'downloadResources',
    'mediaResources',
    'directMedia',
    'media',
    'assets',
    'videos',
    'images',
    'contentImages',
  ]) {
    entries.push(...flattenSeedValue(value[key], nextInherited, baseUrl));
  }
  entries.push(...flattenSeedValue(value.download?.resources, nextInherited, baseUrl));
  entries.push(...flattenSeedValue(value.download?.resourceSeeds, nextInherited, baseUrl));
  entries.push(...flattenSeedValue(value.download?.directMedia, nextInherited, baseUrl));
  entries.push(...flattenSeedValue(value.downloadBundle?.assets, nextInherited, baseUrl));
  return entries;
}

function nativeSeedContainers(request = {}, plan = {}) {
  const metadata = request.metadata ?? {};
  const planMetadata = plan.metadata ?? {};
  return [
    request.resources,
    Array.isArray(request.resourceUrls) ? request.resourceUrls.map((url) => ({ url })) : undefined,
    request.resourceUrl ? [{ url: request.resourceUrl }] : undefined,
    request.resourceSeeds,
    request.resolvedResources,
    request.downloadResources,
    request.mediaResources,
    request.directMedia,
    request.download?.resources,
    request.download?.resourceSeeds,
    request.download?.directMedia,
    request.downloadBundle,
    metadata.resourceSeeds,
    metadata.resolvedResources,
    metadata.downloadResources,
    metadata.mediaResources,
    metadata.directMedia,
    metadata.download?.resources,
    metadata.download?.resourceSeeds,
    metadata.download?.directMedia,
    metadata.downloadBundle,
    planMetadata.resourceSeeds,
    planMetadata.resolvedResources,
    planMetadata.downloadResources,
    planMetadata.mediaResources,
    planMetadata.directMedia,
    planMetadata.download?.resources,
    planMetadata.download?.resourceSeeds,
    planMetadata.download?.directMedia,
    planMetadata.downloadBundle,
  ];
}

function sourceUrlForSeed(seed, request, plan) {
  return firstText(
    seed.sourceUrl,
    seed.requestedUrl,
    seed.pageUrl,
    seed.finalUrl,
    request.sourceUrl,
    request.inputUrl,
    request.url,
    request.input,
    plan.source?.canonicalUrl,
    plan.source?.input,
  );
}

function fileNameForSeed(seed, title, mediaType, url, index) {
  const explicit = firstText(seed.fileName, seed.filename);
  if (explicit) {
    return explicit;
  }
  const ext = extensionForResource(seed, url, mediaType);
  const prefix = String(index + 1).padStart(4, '0');
  return `${prefix}-${compactTitle(title, seed.id ?? 'download')}.${ext}`;
}

export function resolveNativeResourceSeeds(siteKey, plan, sessionLease = null, context = {}, options = {}) {
  const request = context.request ?? {};
  const baseUrl = firstText(
    request.baseUrl,
    request.inputUrl,
    request.url,
    plan.source?.canonicalUrl,
    plan.source?.input,
    plan.host ? `https://${plan.host}/` : '',
  );
  const inherited = {
    title: firstText(request.title, request.resolvedTitle, plan.source?.title),
    sourceUrl: firstText(request.sourceUrl, request.inputUrl, request.url, request.input, plan.source?.canonicalUrl, plan.source?.input),
    referer: firstText(request.referer, request.sourceUrl, request.inputUrl, request.url, request.input, plan.source?.canonicalUrl, plan.source?.input),
    headers: mergeHeaders(sessionLease?.headers, request.headers, request.downloadHeaders),
  };
  const seedEntries = nativeSeedContainers(request, plan)
    .flatMap((value) => flattenSeedValue(value, inherited, baseUrl));
  if (seedEntries.length === 0) {
    return null;
  }

  const resources = seedEntries
    .map((seed, index) => {
      const url = directUrlFromSeed(seed, baseUrl) || urlListFromSeed(seed, baseUrl)[0] || '';
      if (!url) {
        return null;
      }
      const sourceUrl = sourceUrlForSeed(seed, request, plan);
      const title = firstText(seed.title, seed.resolvedTitle, seed.name, request.title, plan.source?.title, seed.id);
      const mediaType = inferMediaType(seed, options.defaultMediaType);
      return normalizeDownloadResource({
        id: firstText(seed.id, seed.assetId, seed.videoId, seed.noteId) || undefined,
        url,
        method: seed.method,
        headers: mergeHeaders(inherited.headers, seed.headers),
        body: seed.body,
        fileName: fileNameForSeed(seed, title, mediaType, url, index),
        mediaType,
        sourceUrl,
        referer: firstText(seed.referer, sourceUrl, inherited.referer) || undefined,
        expectedBytes: seed.expectedBytes ?? seed.size ?? seed.dataSize,
        expectedHash: seed.expectedHash ?? seed.hash ?? seed.sha256,
        priority: seed.priority ?? index,
        groupId: firstText(seed.groupId, seed.noteId, seed.videoId, request.groupId, request.title, plan.id) || undefined,
        metadata: {
          ...(isObject(seed.metadata) ? seed.metadata : {}),
          siteResolver: siteKey,
          title: title || undefined,
          sourceTitle: firstText(request.title, plan.source?.title) || undefined,
        },
      }, index);
    })
    .filter(Boolean);

  return normalizeResolvedDownloadTask({
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources,
    metadata: {
      resolver: {
        ...(plan.resolver ?? {}),
        method: options.method ?? `native-${siteKey}-resource-seeds`,
      },
      legacy: plan.legacy,
    },
    completeness: {
      expectedCount: seedEntries.length,
      resolvedCount: resources.length,
      complete: resources.length === seedEntries.length && resources.length > 0,
      reason: resources.length === seedEntries.length && resources.length > 0
        ? (options.completeReason ?? `${siteKey}-resource-seeds-provided`)
        : (options.incompleteReason ?? `${siteKey}-resource-seeds-incomplete`),
    },
  }, plan);
}

export function resolveEntrypoint(entrypoint, workspaceRoot) {
  const normalized = normalizeText(entrypoint);
  if (!normalized) {
    throw new Error('Legacy download plan is missing legacy.entrypoint.');
  }
  return path.isAbsolute(normalized) ? normalized : path.resolve(workspaceRoot, normalized);
}

export function resolveExecutorKind(plan, entrypointPath) {
  const explicit = normalizeText(plan.legacy?.executorKind).toLowerCase();
  if (explicit) {
    return explicit;
  }
  return entrypointPath.endsWith('.mjs') || entrypointPath.endsWith('.js') ? 'node' : 'python';
}

export function legacyItems(plan, request = {}) {
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

export function pushFlag(args, flag, value) {
  if (value === undefined || value === null || value === '') {
    return;
  }
  args.push(flag, String(value));
}

export function pushBooleanFlag(args, condition, trueFlag, falseFlag = null) {
  if (condition === undefined || condition === null) {
    return;
  }
  if (condition) {
    args.push(trueFlag);
  } else if (falseFlag) {
    args.push(falseFlag);
  }
}

export function resolveReuseLoginState(request = {}, options = {}) {
  if (request.reuseLoginState !== undefined) {
    return request.reuseLoginState !== false;
  }
  if (options.reuseLoginState !== undefined) {
    return options.reuseLoginState !== false;
  }
  return true;
}

export function addCommonProfileFlags(args, request = {}, sessionLease = {}) {
  pushFlag(args, '--profile-path', request.profilePath);
  pushFlag(args, '--browser-path', request.browserPath);
  pushFlag(args, '--browser-profile-root', request.browserProfileRoot ?? sessionLease.browserProfileRoot);
  pushFlag(args, '--user-data-dir', request.userDataDir ?? sessionLease.userDataDir);
  pushFlag(args, '--timeout', request.timeoutMs ?? request.timeout);
}

export function addLoginFlags(args, request = {}, options = {}, siteKey) {
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

export function addDownloadPolicyFlags(args, plan, request = {}) {
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

export function buildGenericLegacyArgs(entrypointPath, plan, request = {}, layout) {
  return [entrypointPath, 'download', ...legacyItems(plan, request), '--out-dir', layout.runDir];
}
