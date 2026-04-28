// @ts-check

import {
  addCommonProfileFlags,
  addDownloadPolicyFlags,
  addLoginFlags,
  legacyItems,
  normalizeText,
  pushFlag,
  resolveNativeResourceSeeds,
  toArray,
} from './common.mjs';

export const siteKey = 'douyin';

export const nativeSeedResolverOptions = Object.freeze({
  defaultMediaType: 'video',
  method: 'native-douyin-resource-seeds',
  completeReason: 'douyin-resource-seeds-provided',
  incompleteReason: 'douyin-resource-seeds-incomplete',
});

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
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

function metadataObject(request = {}) {
  return isObject(request.metadata) ? request.metadata : {};
}

function isTrue(value) {
  return value === true || value === 'true' || value === '1' || value === 'yes' || value === 'on';
}

function videoIdFromValue(value) {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }
  const direct = text.match(/\b(\d{16,22})\b/u)?.[1];
  if (direct) {
    return direct;
  }
  try {
    const parsed = new URL(text);
    return parsed.pathname.match(/\/(?:video|shipin)\/(\d{16,22})/u)?.[1] ?? '';
  } catch {
    return '';
  }
}

function isDouyinVideoInput(value) {
  const text = normalizeText(value);
  if (!text) {
    return false;
  }
  if (/^\d{16,22}$/u.test(text)) {
    return true;
  }
  try {
    const parsed = new URL(text);
    return parsed.hostname.includes('douyin.com') && /^\/(?:video|shipin)\//u.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isDouyinAuthorInput(value) {
  const text = normalizeText(value);
  if (!text) {
    return false;
  }
  try {
    const parsed = new URL(text);
    return parsed.hostname.includes('douyin.com') && /^\/(?:user|share\/user)\//u.test(parsed.pathname);
  } catch {
    return false;
  }
}

function douyinVideoUrl(videoId) {
  return videoId ? `https://www.douyin.com/video/${videoId}` : '';
}

function resultEntries(value = {}) {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isObject(value)) {
    return [];
  }
  return [
    value.results,
    value.mediaResults,
    value.media,
    value.videos,
    value.items,
    value.awemeList,
    value.aweme_list,
  ].flatMap(toArray).filter((entry) => entry !== undefined && entry !== null);
}

function requestMediaEntries(request = {}) {
  const metadata = metadataObject(request);
  return [
    request.douyinMediaResults,
    request.mediaResults,
    request.videoResults,
    request.resolvedVideos,
    request.douyinVideos,
    request.videos,
    metadata.douyinMediaResults,
    metadata.mediaResults,
    metadata.videoResults,
    metadata.resolvedVideos,
    metadata.douyinVideos,
    metadata.videos,
  ].flatMap(resultEntries);
}

function requestAuthorEntries(request = {}) {
  const metadata = metadataObject(request);
  return [
    request.douyinAuthorVideos,
    request.authorVideos,
    request.authorItems,
    metadata.douyinAuthorVideos,
    metadata.authorVideos,
    metadata.authorItems,
  ].flatMap(resultEntries);
}

function requestFollowEntries(request = {}) {
  const metadata = metadataObject(request);
  return [
    request.douyinFollowVideos,
    request.followVideos,
    request.followedVideos,
    request.followUpdates,
    metadata.douyinFollowVideos,
    metadata.followVideos,
    metadata.followedVideos,
    metadata.followUpdates,
  ].flatMap(resultEntries);
}

function callableFromContext(context = {}, name) {
  return [
    context[name],
    context.deps?.[name],
    context.options?.[name],
  ].find((candidate) => typeof candidate === 'function') ?? null;
}

function bestFormat(entry = {}) {
  return entry.bestFormat
    ?? entry.resolvedFormat
    ?? entry.format
    ?? entry.formats?.[0]
    ?? entry.resolvedFormats?.[0]
    ?? {};
}

function mediaUrl(entry = {}) {
  const format = bestFormat(entry);
  return firstText(
    entry.resolvedMediaUrl,
    entry.bestUrl,
    entry.url && !isDouyinVideoInput(entry.url) && !isDouyinAuthorInput(entry.url) ? entry.url : '',
    entry.downloadUrl,
    entry.mediaUrl,
    entry.video?.play_addr?.url_list?.[0],
    entry.awemeData?.video?.play_addr?.url_list?.[0],
    format.url,
    format.downloadUrl,
    format.playUrl,
  );
}

function coverUrl(entry = {}) {
  return firstText(
    entry.coverUrl,
    entry.cover,
    entry.posterUrl,
    entry.video?.cover?.url_list?.[0],
    entry.awemeData?.video?.cover?.url_list?.[0],
  );
}

function seedFromDouyinEntry(entry = {}, index = 0, overrides = {}) {
  if (!isObject(entry)) {
    return null;
  }
  const url = mediaUrl(entry);
  if (!url) {
    return null;
  }
  const format = bestFormat(entry);
  const videoId = firstText(
    overrides.videoId,
    entry.videoId,
    entry.awemeId,
    entry.aweme_id,
    entry.awemeData?.aweme_id,
    videoIdFromValue(entry.url),
    videoIdFromValue(entry.requestedUrl),
    videoIdFromValue(entry.finalUrl),
  );
  const title = firstText(
    entry.resolvedTitle,
    entry.title,
    entry.desc,
    entry.awemeData?.desc,
    overrides.title,
    videoId,
    `douyin-${index + 1}`,
  );
  const sourceUrl = firstText(
    entry.requestedUrl,
    entry.finalUrl,
    entry.sourceUrl,
    entry.url && !entry.url.includes('/play') ? entry.url : '',
    overrides.sourceUrl,
    douyinVideoUrl(videoId),
  );
  return {
    id: firstText(entry.id, videoId, `video-${index + 1}`),
    url,
    fileName: entry.fileName,
    mediaType: 'video',
    contentType: firstText(entry.contentType, format.mimeType, format.mime_type, 'video/mp4'),
    title,
    sourceUrl,
    referer: firstText(entry.referer, sourceUrl),
    headers: isObject(entry.headers)
      ? entry.headers
      : isObject(entry.downloadHeaders)
        ? entry.downloadHeaders
        : {},
    expectedBytes: entry.expectedBytes ?? entry.size ?? format.size,
    groupId: firstText(entry.groupId, videoId, title),
    metadata: {
      videoId: videoId || undefined,
      title,
      authorName: firstText(entry.authorName, entry.author?.name, entry.awemeData?.author?.nickname) || undefined,
      authorUrl: firstText(entry.authorUrl, overrides.authorUrl) || undefined,
      createTime: entry.createTime ?? entry.create_time ?? entry.awemeData?.create_time,
      resolutionPathway: firstText(entry.resolutionPathway, entry.resolutionPath, entry.pathway) || undefined,
      formatId: firstText(format.formatId, format.format_id, format.id, entry.resolvedFormat?.formatId) || undefined,
      codec: firstText(format.codec, format.vcodec, format.acodec) || undefined,
      width: format.width ?? entry.width,
      height: format.height ?? entry.height,
      bitRate: format.bitRate ?? format.bitrate ?? entry.bitRate,
      sourceType: firstText(overrides.sourceType, entry.sourceType) || undefined,
    },
  };
}

function coverSeedFromDouyinEntry(entry = {}, index = 0, overrides = {}) {
  const url = isObject(entry) ? coverUrl(entry) : '';
  if (!url) {
    return null;
  }
  const videoId = firstText(entry.videoId, entry.awemeId, entry.aweme_id, entry.awemeData?.aweme_id);
  const title = firstText(entry.title, entry.desc, entry.resolvedTitle, videoId, `douyin-cover-${index + 1}`);
  const sourceUrl = firstText(entry.requestedUrl, entry.finalUrl, entry.sourceUrl, overrides.sourceUrl, douyinVideoUrl(videoId));
  return {
    id: firstText(videoId ? `${videoId}-cover` : '', `cover-${index + 1}`),
    url,
    mediaType: 'image',
    title,
    sourceUrl,
    referer: firstText(entry.referer, sourceUrl),
    groupId: firstText(videoId, title),
    metadata: {
      videoId: videoId || undefined,
      assetType: 'cover',
      sourceType: firstText(overrides.sourceType, entry.sourceType) || undefined,
    },
  };
}

function dedupeSeeds(seeds = []) {
  const seen = new Set();
  const result = [];
  for (const seed of seeds) {
    const key = firstText(seed?.id, seed?.url);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(seed);
  }
  return result;
}

function seedsFromEntries(entries = [], overrides = {}) {
  return dedupeSeeds(entries.flatMap((entry, index) => [
    seedFromDouyinEntry(entry, index, overrides),
    coverSeedFromDouyinEntry(entry, index, overrides),
  ].filter(Boolean)));
}

async function callMediaBatchResolver(context, items, request, plan, sessionLease) {
  const resolver = callableFromContext(context, 'resolveDouyinMediaBatch');
  if (!resolver || items.length === 0) {
    return [];
  }
  const result = await resolver(items, {
    request,
    plan,
    sessionLease,
    allowNetworkResolve: context.allowNetworkResolve === true,
  });
  return resultEntries(result);
}

async function callAuthorEnumerator(context, request, plan, sessionLease) {
  const enumerator = callableFromContext(context, 'enumerateDouyinAuthorVideos');
  if (!enumerator) {
    return [];
  }
  const result = await enumerator({
    request,
    plan,
    sessionLease,
    limit: request.maxItems ?? plan.policy?.maxItems,
  });
  return resultEntries(result);
}

async function callFollowQuery(context, request, plan, sessionLease) {
  const query = callableFromContext(context, 'queryDouyinFollow');
  if (!query) {
    return [];
  }
  const result = await query({
    intent: 'list-followed-updates',
    window: request.followUpdatesWindow ?? request.window,
    userFilter: request.userFilter ?? request.user ?? request.author,
    titleKeyword: request.titleKeyword ?? request.keyword,
    updatedOnly: request.updatedOnly,
    limit: request.maxItems ?? plan.policy?.maxItems,
    request,
    plan,
    sessionLease,
  });
  return resultEntries(result);
}

function ordinaryVideoTargets(request = {}, plan = {}) {
  return [...new Set([
    ...toArray(request.items),
    request.input,
    request.inputUrl,
    request.url,
    plan.source?.input,
  ].map((item) => normalizeText(item)).filter(isDouyinVideoInput))];
}

async function requestWithInjectedSeeds(request = {}, plan = {}, sessionLease = null, context = {}) {
  const directSeeds = seedsFromEntries(requestMediaEntries(request), { sourceType: 'media-results' });
  if (directSeeds.length > 0) {
    return {
      ...request,
      metadata: {
        ...metadataObject(request),
        resourceSeeds: directSeeds,
        resolution: {
          siteResolver: siteKey,
          sourceType: 'media-results',
          resolvedSeeds: directSeeds.length,
        },
      },
    };
  }

  const ordinaryTargets = ordinaryVideoTargets(request, plan);
  const ordinaryMedia = await callMediaBatchResolver(context, ordinaryTargets, request, plan, sessionLease);
  const ordinarySeeds = seedsFromEntries(ordinaryMedia, { sourceType: 'ordinary-video' });
  if (ordinarySeeds.length > 0) {
    return {
      ...request,
      metadata: {
        ...metadataObject(request),
        resourceSeeds: ordinarySeeds,
        resolution: {
          siteResolver: siteKey,
          sourceType: 'ordinary-video',
          attemptedVideos: ordinaryTargets.length,
          resolvedSeeds: ordinarySeeds.length,
        },
      },
    };
  }

  const authorEntries = requestAuthorEntries(request);
  const enumeratedAuthorEntries = authorEntries.length > 0
    ? authorEntries
    : isDouyinAuthorInput(request.input ?? request.url ?? request.inputUrl ?? plan.source?.input)
      ? await callAuthorEnumerator(context, request, plan, sessionLease)
      : [];
  const unresolvedAuthorTargets = enumeratedAuthorEntries
    .filter((entry) => isObject(entry) && !mediaUrl(entry))
    .map((entry) => firstText(entry.url, entry.finalUrl, douyinVideoUrl(firstText(entry.videoId, entry.awemeId, entry.aweme_id))))
    .filter(Boolean);
  const resolvedAuthorEntries = unresolvedAuthorTargets.length > 0
    ? await callMediaBatchResolver(context, unresolvedAuthorTargets, request, plan, sessionLease)
    : [];
  const authorSeeds = seedsFromEntries([
    ...enumeratedAuthorEntries.filter((entry) => !isObject(entry) || mediaUrl(entry)),
    ...resolvedAuthorEntries,
  ], { sourceType: 'author' });
  if (authorSeeds.length > 0) {
    return {
      ...request,
      metadata: {
        ...metadataObject(request),
        resourceSeeds: authorSeeds,
        resolution: {
          siteResolver: siteKey,
          sourceType: 'author',
          attemptedVideos: enumeratedAuthorEntries.length,
          resolvedSeeds: authorSeeds.length,
        },
      },
    };
  }

  const requestedFollowUpdates = isTrue(request.followedUpdates)
    || normalizeText(request.followUpdatesWindow ?? request.window)
    || request.updatedOnly;
  const followEntries = requestFollowEntries(request);
  const queriedFollowEntries = followEntries.length > 0
    ? followEntries
    : requestedFollowUpdates
      ? await callFollowQuery(context, request, plan, sessionLease)
      : [];
  const followSeeds = seedsFromEntries(queriedFollowEntries, { sourceType: 'followed-updates' });
  if (followSeeds.length > 0) {
    return {
      ...request,
      metadata: {
        ...metadataObject(request),
        resourceSeeds: followSeeds,
        resolution: {
          siteResolver: siteKey,
          sourceType: 'followed-updates',
          attemptedVideos: queriedFollowEntries.length,
          resolvedSeeds: followSeeds.length,
        },
      },
    };
  }

  return null;
}

export async function resolveResources(plan, sessionLease = null, context = {}) {
  const resolved = resolveNativeResourceSeeds(siteKey, plan, sessionLease, context, nativeSeedResolverOptions);
  if (resolved) {
    return resolved;
  }
  const seededRequest = await requestWithInjectedSeeds(context.request ?? {}, plan, sessionLease, context);
  if (!seededRequest) {
    return null;
  }
  const seededResolved = resolveNativeResourceSeeds(siteKey, plan, sessionLease, {
    ...context,
    request: seededRequest,
  }, nativeSeedResolverOptions);
  if (!seededResolved) {
    return null;
  }
  return {
    ...seededResolved,
    metadata: {
      ...seededResolved.metadata,
      resolution: seededRequest.metadata?.resolution,
    },
  };
}

export function buildLegacyArgs(entrypointPath, plan, request = {}, sessionLease = {}, options = {}, layout) {
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

export default Object.freeze({
  siteKey,
  resolveResources,
  buildLegacyArgs,
});
