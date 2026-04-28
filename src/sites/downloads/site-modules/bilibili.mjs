// @ts-check

import {
  addCommonProfileFlags,
  addLoginFlags,
  legacyItems,
  normalizeText,
  normalizePositiveInteger,
  pushFlag,
  resolveNativeResourceSeeds,
  toArray,
} from './common.mjs';

export const siteKey = 'bilibili';

export const nativeSeedResolverOptions = Object.freeze({
  defaultMediaType: 'video',
  method: 'native-bilibili-resource-seeds',
  completeReason: 'bilibili-resource-seeds-provided',
  incompleteReason: 'bilibili-resource-seeds-incomplete',
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

function payloadCandidates(request = {}) {
  const metadata = isObject(request.metadata) ? request.metadata : {};
  return [
    request.bilibiliVideoPayload,
    request.videoPayload,
    request.playUrlPayload,
    request.apiPayload,
    request.pagePayload,
    metadata.bilibiliVideoPayload,
    metadata.videoPayload,
    metadata.playUrlPayload,
    metadata.apiPayload,
    metadata.pagePayload,
  ].filter(isObject);
}

function payloadData(payload = {}) {
  return payload.data?.data
    ?? payload.data?.result
    ?? payload.data
    ?? payload.result
    ?? payload;
}

function streamUrl(stream = {}) {
  return firstText(
    stream.url,
    stream.baseUrl,
    stream.base_url,
    stream.downloadUrl,
    stream.download_url,
    stream.backupUrl?.[0],
    stream.backup_url?.[0],
    stream.backupUrls?.[0],
  );
}

function streamSeed(stream = {}, inherited = {}, mediaType = 'video', index = 0) {
  const url = streamUrl(stream);
  if (!url) {
    return null;
  }
  const quality = firstText(stream.quality, stream.qn, stream.id, stream.audioQuality, stream.bandwidth);
  const titleSuffix = mediaType === 'audio' ? 'audio' : firstText(stream.width && stream.height ? `${stream.width}x${stream.height}` : '', quality, 'video');
  return {
    id: firstText(stream.id, stream.quality, stream.qn, stream.bandwidth, `${mediaType}-${index + 1}`),
    url,
    mediaType,
    contentType: firstText(stream.mimeType, stream.mime_type, stream.contentType),
    title: firstText(inherited.title && titleSuffix ? `${inherited.title}-${titleSuffix}` : '', inherited.title, titleSuffix),
    sourceUrl: inherited.sourceUrl,
    referer: inherited.sourceUrl,
    expectedBytes: stream.size,
    priority: stream.priority ?? index,
    metadata: {
      streamType: mediaType,
      quality: quality || undefined,
      bandwidth: stream.bandwidth,
      codecs: firstText(stream.codecs, stream.codec) || undefined,
    },
  };
}

function seedsFromPayload(payload = {}, request = {}, plan = {}) {
  const data = payloadData(payload);
  const title = firstText(request.title, data.title, payload.title, payload.videoData?.title, plan.source?.title);
  const sourceUrl = firstText(request.inputUrl, request.url, request.input, data.pageUrl, payload.pageUrl, plan.source?.canonicalUrl, plan.source?.input);
  const inherited = { title, sourceUrl };
  const seeds = [];

  const dash = data.dash ?? data.videoInfo?.dash ?? data.playInfo?.dash;
  for (const stream of toArray(dash?.video)) {
    const seed = streamSeed(stream, inherited, 'video', seeds.length);
    if (seed) {
      seeds.push(seed);
    }
  }
  for (const stream of toArray(dash?.audio)) {
    const seed = streamSeed(stream, inherited, 'audio', seeds.length);
    if (seed) {
      seeds.push(seed);
    }
  }
  for (const stream of toArray(data.durl ?? data.videoInfo?.durl ?? data.playInfo?.durl)) {
    const seed = streamSeed(stream, inherited, 'video', seeds.length);
    if (seed) {
      seeds.push(seed);
    }
  }

  return seeds;
}

function requestWithPayloadSeeds(request = {}, plan = {}) {
  for (const payload of payloadCandidates(request)) {
    const seeds = seedsFromPayload(payload, request, plan);
    if (seeds.length > 0) {
      return {
        ...request,
        metadata: {
          ...(isObject(request.metadata) ? request.metadata : {}),
          resourceSeeds: seeds,
        },
      };
    }
  }
  return null;
}

export function resolveResources(plan, sessionLease = null, context = {}) {
  const resolved = resolveNativeResourceSeeds(siteKey, plan, sessionLease, context, nativeSeedResolverOptions);
  if (resolved) {
    return resolved;
  }
  const seededRequest = requestWithPayloadSeeds(context.request ?? {}, plan);
  if (!seededRequest) {
    return null;
  }
  return resolveNativeResourceSeeds(siteKey, plan, sessionLease, {
    ...context,
    request: seededRequest,
  }, nativeSeedResolverOptions);
}

export function buildLegacyArgs(entrypointPath, plan, request = {}, sessionLease = {}, options = {}, layout) {
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

export default Object.freeze({
  siteKey,
  resolveResources,
  buildLegacyArgs,
});
