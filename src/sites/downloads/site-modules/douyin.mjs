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
export const DOUYIN_NATIVE_EVIDENCE_CONTRACT_VERSION = 'douyin-native-evidence-v1';

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

function signedApiEvidenceFrom(request = {}) {
  const apiUrl = firstText(request.douyinApiUrl, request.apiUrl, request.detailApiUrl, request.fetchUrl);
  const urlFlags = {};
  try {
    const parsed = new URL(apiUrl);
    for (const key of ['a_bogus', 'msToken', 'verifyFp']) {
      if (parsed.searchParams.has(key)) {
        urlFlags[key] = true;
      }
    }
  } catch {
    // Non-URL fixture inputs simply have no query signature evidence.
  }
  const fetchHeaders = isObject(request.fetchHeaders) ? Object.keys(request.fetchHeaders) : [];
  const signatureParamsPresent = Object.keys(urlFlags).sort();
  const requiredSignatureParams = ['a_bogus', 'msToken'];
  const missingSignatureParams = apiUrl
    ? requiredSignatureParams.filter((key) => !urlFlags[key])
    : [];
  const signatureCompleteness = (() => {
    if (!apiUrl) {
      return 'none';
    }
    if (missingSignatureParams.length === 0) {
      return 'complete';
    }
    return signatureParamsPresent.length > 0 ? 'partial' : 'none';
  })();
  const fixturePayloadProvided = requestPayloadEntries(request).length > 0
    || Boolean(firstText(request.fixtureHtml, request.html, metadataObject(request).fixtureHtml));
  const apiEvidenceMode = (() => {
    if (apiUrl && signatureCompleteness === 'complete') {
      return 'signed-api-url';
    }
    if (apiUrl) {
      return 'injected-fetch';
    }
    if (fixturePayloadProvided) {
      return 'fixture-payload';
    }
    return 'none';
  })();
  return {
    signedApiProvided: Boolean(apiUrl && Object.keys(urlFlags).length > 0) || undefined,
    apiEvidenceMode,
    requiredSignatureParams,
    signatureParamsPresent,
    missingSignatureParams,
    signatureCompleteness,
    headersPresent: fetchHeaders.sort(),
    headerNamesPresent: fetchHeaders.sort(),
    cookieEvidence: fetchHeaders.some((header) => header.toLowerCase() === 'cookie') || undefined,
  };
}

function sessionEvidenceFrom(sessionLease = null) {
  const headerNames = Object.keys(sessionLease?.headers ?? {}).sort();
  return {
    leaseStatus: sessionLease?.status,
    authStatus: sessionLease?.mode,
    userDataDirPresent: Boolean(sessionLease?.userDataDir) || undefined,
    profilePathPresent: Boolean(sessionLease?.browserProfileRoot) || undefined,
    headerNames,
    cookieEvidence: Array.isArray(sessionLease?.cookies) && sessionLease.cookies.length > 0 || undefined,
  };
}

function cacheEvidenceFrom(request = {}, context = {}) {
  const refreshRequested = request.refreshCache === true;
  const refreshAllowed = context.allowNetworkResolve === true && refreshRequested;
  return {
    mode: refreshRequested ? 'refresh-requested' : 'cache-only',
    refreshRequested: refreshRequested || undefined,
    refreshAllowed,
    refreshBlockedReason: refreshRequested && !refreshAllowed ? 'resolve-network-required' : undefined,
    refreshed: false,
    reason: refreshRequested && context.allowNetworkResolve !== true ? 'resolve-network-required' : undefined,
  };
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

function requestPayloadEntries(request = {}) {
  const metadata = metadataObject(request);
  return [
    request.douyinDetailPayload,
    request.awemeDetailPayload,
    request.douyinPostPayload,
    request.douyinApiPayload,
    metadata.douyinDetailPayload,
    metadata.awemeDetailPayload,
    metadata.douyinPostPayload,
    metadata.douyinApiPayload,
  ].filter((entry) => entry !== undefined && entry !== null);
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
    entry.video?.play_addr?.url_list?.find?.(Boolean),
    entry.video?.download_addr?.url_list?.find?.(Boolean),
    entry.video?.play_addr?.url_list?.[0],
    entry.awemeData?.video?.play_addr?.url_list?.[0],
    entry.awemeData?.video?.download_addr?.url_list?.[0],
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
      evidenceId: firstText(overrides.evidenceId) || undefined,
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
      evidenceId: firstText(overrides.evidenceId) || undefined,
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

function videoIdFromEntry(entry = {}, index = 0) {
  return firstText(
    entry.videoId,
    entry.awemeId,
    entry.aweme_id,
    entry.awemeData?.aweme_id,
    videoIdFromValue(entry.url),
    videoIdFromValue(entry.requestedUrl),
    videoIdFromValue(entry.finalUrl),
    `entry-${index + 1}`,
  );
}

function buildEvidence({ sourceType, intent = 'resolve-media', entries = [], seeds = [], request = {}, sessionLease = null, context = {}, fallbackReason = undefined } = {}) {
  const videoSeeds = seeds.filter((seed) => seed.mediaType === 'video');
  const coverSeeds = seeds.filter((seed) => seed.mediaType === 'image');
  const unresolvedVideoIds = entries
    .map((entry, index) => ({ entry, videoId: videoIdFromEntry(entry, index) }))
    .filter(({ entry }) => isObject(entry) && !mediaUrl(entry))
    .map(({ videoId }) => videoId)
    .filter(Boolean);
  const expectedVideos = entries.filter(isObject).length;
  const complete = expectedVideos > 0 && unresolvedVideoIds.length === 0 && videoSeeds.length >= expectedVideos;
  return {
    contractVersion: DOUYIN_NATIVE_EVIDENCE_CONTRACT_VERSION,
    sourceType,
    intent,
    input: {
      targetCount: expectedVideos,
    },
    payload: {
      expectedVideos,
      parsedEntries: entries.length,
      videoSeeds: videoSeeds.length,
      coverSeeds: coverSeeds.length,
      unresolvedVideoIds,
      complete,
    },
    request: signedApiEvidenceFrom(request),
    session: sessionEvidenceFrom(sessionLease),
    cache: cacheEvidenceFrom(request, context),
    fallback: fallbackReason ? { reason: fallbackReason } : undefined,
  };
}

function extractDouyinPayloadEntries(payload = {}) {
  if (Array.isArray(payload)) {
    return payload.flatMap(extractDouyinPayloadEntries);
  }
  if (!isObject(payload)) {
    return [];
  }
  return [
    payload.aweme_detail,
    payload.awemeDetail,
    payload.aweme,
    payload.item,
    payload.video,
    payload.data?.aweme_detail,
    payload.data?.awemeDetail,
    payload.data?.aweme,
    payload.data?.item,
    payload.data?.video,
    payload.aweme_list,
    payload.awemeList,
    payload.item_list,
    payload.itemList,
    payload.data?.aweme_list,
    payload.data?.awemeList,
    payload.data?.item_list,
    payload.data?.itemList,
    resultEntries(payload),
  ].flatMap((entry) => {
    if (Array.isArray(entry)) {
      return entry.flatMap(extractDouyinPayloadEntries);
    }
    return isObject(entry) ? [entry] : [];
  });
}

function parseJsonPayload(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function payloadEntriesFromHtml(html = '') {
  const text = normalizeText(html);
  if (!text) {
    return [];
  }
  const entries = [];
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/giu;
  for (const match of text.matchAll(scriptPattern)) {
    const body = match[1].trim();
    const parsed = parseJsonPayload(body);
    if (parsed) {
      entries.push(...extractDouyinPayloadEntries(parsed));
      continue;
    }
    const jsonMatch = body.match(/(\{[\s\S]*"(?:aweme_detail|aweme_list|item_list)"[\s\S]*\})/u);
    const nested = jsonMatch ? parseJsonPayload(jsonMatch[1]) : null;
    if (nested) {
      entries.push(...extractDouyinPayloadEntries(nested));
    }
  }
  return entries;
}

async function responsePayload(response) {
  if (!response) {
    return null;
  }
  if (typeof response.json === 'function') {
    try {
      return await response.json();
    } catch {
      // Fall through to text parsing.
    }
  }
  if (typeof response.text === 'function') {
    const text = await response.text();
    return parseJsonPayload(text) ?? { fixtureHtml: text };
  }
  return response;
}

async function fetchedPayloadEntries(request = {}, context = {}) {
  const fetchImpl = callableFromContext(context, 'fetchImpl')
    ?? callableFromContext(context, 'mockFetchImpl')
    ?? (typeof request.mockFetchImpl === 'function' ? request.mockFetchImpl : null);
  if (!fetchImpl) {
    return [];
  }
  const url = firstText(
    request.douyinApiUrl,
    request.apiUrl,
    request.detailApiUrl,
    request.fetchUrl,
  );
  if (!url) {
    return [];
  }
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: isObject(request.fetchHeaders) ? request.fetchHeaders : undefined,
  });
  const payload = await responsePayload(response);
  if (isObject(payload) && payload.fixtureHtml) {
    return payloadEntriesFromHtml(payload.fixtureHtml);
  }
  return extractDouyinPayloadEntries(payload);
}

async function requestWithFixtureSeeds(request = {}, plan = {}, sessionLease = null, context = {}) {
  const fixtureHtml = firstText(request.fixtureHtml, request.html, metadataObject(request).fixtureHtml);
  const entries = [
    ...extractDouyinPayloadEntries(requestPayloadEntries(request)),
    ...payloadEntriesFromHtml(fixtureHtml),
    ...await fetchedPayloadEntries(request, context),
  ];
  const evidenceId = `${DOUYIN_NATIVE_EVIDENCE_CONTRACT_VERSION}:fixture-api`;
  const seeds = seedsFromEntries(entries, {
    sourceType: 'fixture-api',
    evidenceId,
    sourceUrl: firstText(request.input, request.inputUrl, request.url, plan.source?.input),
  });
  if (seeds.length === 0) {
    return null;
  }
  const evidence = buildEvidence({
    sourceType: 'fixture-api',
    intent: 'fixture-api-payload',
    entries,
    seeds,
    request,
    sessionLease,
    context,
  });
  return {
    ...request,
    metadata: {
      ...metadataObject(request),
      resourceSeeds: seeds,
      resolution: {
        siteResolver: siteKey,
        sourceType: 'fixture-api',
        expectedVideos: entries.length,
        resolvedSeeds: seeds.length,
        evidence,
      },
    },
  };
}

function evidenceInput(request = {}, sessionLease = null, context = {}) {
  return {
    contractVersion: DOUYIN_NATIVE_EVIDENCE_CONTRACT_VERSION,
    request: signedApiEvidenceFrom(request),
    session: sessionEvidenceFrom(sessionLease),
    cache: cacheEvidenceFrom(request, context),
  };
}

async function callMediaBatchResolver(context, items, request, plan, sessionLease) {
  const resolver = callableFromContext(context, 'resolveDouyinMediaBatch');
  if (!resolver || items.length === 0) {
    return [];
  }
  const result = await resolver(items, {
    contractVersion: 'douyin-native-resolver-deps-v1',
    intent: 'resolve-media-batch',
    sourceType: 'media-batch',
    request,
    plan,
    sessionLease,
    allowNetworkResolve: context.allowNetworkResolve === true,
    evidenceInput: evidenceInput(request, sessionLease, context),
  });
  return resultEntries(result);
}

async function callAuthorEnumerator(context, request, plan, sessionLease) {
  const enumerator = callableFromContext(context, 'enumerateDouyinAuthorVideos');
  if (!enumerator) {
    return [];
  }
  const result = await enumerator({
    contractVersion: 'douyin-native-resolver-deps-v1',
    intent: 'enumerate-author-videos',
    sourceType: 'author',
    request,
    plan,
    sessionLease,
    allowNetworkResolve: context.allowNetworkResolve === true,
    evidenceInput: evidenceInput(request, sessionLease, context),
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
    contractVersion: 'douyin-native-resolver-deps-v1',
    intent: 'list-followed-updates',
    sourceType: 'followed-updates',
    window: request.followUpdatesWindow ?? request.window,
    userFilter: request.userFilter ?? request.user ?? request.author,
    titleKeyword: request.titleKeyword ?? request.keyword,
    updatedOnly: request.updatedOnly,
    limit: request.maxItems ?? plan.policy?.maxItems,
    request,
    plan,
    sessionLease,
    allowNetworkResolve: context.allowNetworkResolve === true,
    refreshAllowed: context.allowNetworkResolve === true && request.refreshCache === true,
    evidenceInput: evidenceInput(request, sessionLease, context),
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
  const fixtureSeeded = await requestWithFixtureSeeds(request, plan, sessionLease, context);
  if (fixtureSeeded) {
    return fixtureSeeded;
  }

  const mediaEntries = requestMediaEntries(request);
  const directSeeds = seedsFromEntries(mediaEntries, {
    sourceType: 'media-results',
    evidenceId: `${DOUYIN_NATIVE_EVIDENCE_CONTRACT_VERSION}:media-results`,
  });
  if (directSeeds.length > 0) {
    const evidence = buildEvidence({
      sourceType: 'media-results',
      entries: mediaEntries,
      seeds: directSeeds,
      request,
      sessionLease,
      context,
    });
    return {
      ...request,
      metadata: {
        ...metadataObject(request),
        resourceSeeds: directSeeds,
        resolution: {
          siteResolver: siteKey,
          sourceType: 'media-results',
          resolvedSeeds: directSeeds.length,
          evidence,
        },
      },
    };
  }

  const ordinaryTargets = ordinaryVideoTargets(request, plan);
  const ordinaryMedia = await callMediaBatchResolver(context, ordinaryTargets, request, plan, sessionLease);
  const ordinarySeeds = seedsFromEntries(ordinaryMedia, {
    sourceType: 'ordinary-video',
    evidenceId: `${DOUYIN_NATIVE_EVIDENCE_CONTRACT_VERSION}:ordinary-video`,
  });
  if (ordinarySeeds.length > 0) {
    const evidence = buildEvidence({
      sourceType: 'ordinary-video',
      entries: ordinaryMedia,
      seeds: ordinarySeeds,
      request,
      sessionLease,
      context,
    });
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
          evidence,
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
  ], {
    sourceType: 'author',
    evidenceId: `${DOUYIN_NATIVE_EVIDENCE_CONTRACT_VERSION}:author`,
  });
  if (authorSeeds.length > 0) {
    const evidence = buildEvidence({
      sourceType: 'author',
      entries: enumeratedAuthorEntries,
      seeds: authorSeeds,
      request,
      sessionLease,
      context,
    });
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
          evidence,
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
  const followSeeds = seedsFromEntries(queriedFollowEntries, {
    sourceType: 'followed-updates',
    evidenceId: `${DOUYIN_NATIVE_EVIDENCE_CONTRACT_VERSION}:followed-updates`,
  });
  if (followSeeds.length > 0) {
    const evidence = buildEvidence({
      sourceType: 'followed-updates',
      entries: queriedFollowEntries,
      seeds: followSeeds,
      request,
      sessionLease,
      context,
    });
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
          evidence,
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
    completeness: seededRequest.metadata?.resolution?.evidence?.payload?.complete === false
      ? {
        ...seededResolved.completeness,
        complete: false,
        reason: 'douyin-native-payload-incomplete',
      }
      : {
        ...seededResolved.completeness,
        reason: 'douyin-native-complete',
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
