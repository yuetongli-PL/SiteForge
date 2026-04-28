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

function metadataObject(request = {}) {
  return isObject(request.metadata) ? request.metadata : {};
}

function payloadValuesFrom(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter(isObject);
  }
  if (!isObject(value)) {
    return [];
  }
  if (
    isObject(value.payload)
    || value.bvid
    || value.cid
    || value.page
    || value.pageIndex
    || value.index
  ) {
    return [value];
  }
  return Object.entries(value)
    .filter(([, entry]) => isObject(entry))
    .map(([key, entry]) => ({
      key,
      ...(isObject(entry) ? entry : {}),
    }));
}

function playUrlPayloadCandidates(request = {}) {
  const metadata = metadataObject(request);
  return [
    request.playUrlPayload,
    request.bilibiliPlayUrlPayload,
    request.playUrlPayloads,
    request.bilibiliPlayUrlPayloads,
    metadata.playUrlPayload,
    metadata.bilibiliPlayUrlPayload,
    metadata.playUrlPayloads,
    metadata.bilibiliPlayUrlPayloads,
  ].flatMap(payloadValuesFrom);
}

function viewPayloadCandidates(request = {}) {
  const metadata = metadataObject(request);
  return [
    request.bilibiliViewPayload,
    request.viewPayload,
    request.videoViewPayload,
    metadata.bilibiliViewPayload,
    metadata.viewPayload,
    metadata.videoViewPayload,
  ].filter(isObject);
}

function listPayloadCandidates(request = {}) {
  const metadata = metadataObject(request);
  return [
    { kind: 'collection', payload: request.bilibiliCollectionPayload },
    { kind: 'collection', payload: request.collectionPayload },
    { kind: 'series', payload: request.bilibiliSeriesPayload },
    { kind: 'series', payload: request.seriesPayload },
    { kind: 'space-archives', payload: request.bilibiliSpaceArchivesPayload },
    { kind: 'space-archives', payload: request.spaceArchivesPayload },
    { kind: 'collection', payload: metadata.bilibiliCollectionPayload },
    { kind: 'collection', payload: metadata.collectionPayload },
    { kind: 'series', payload: metadata.bilibiliSeriesPayload },
    { kind: 'series', payload: metadata.seriesPayload },
    { kind: 'space-archives', payload: metadata.bilibiliSpaceArchivesPayload },
    { kind: 'space-archives', payload: metadata.spaceArchivesPayload },
  ].filter((entry) => isObject(entry.payload));
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
    id: firstText(
      inherited.streamIdPrefix && firstText(stream.id, stream.quality, stream.qn, stream.bandwidth)
        ? `${inherited.streamIdPrefix}-${firstText(stream.id, stream.quality, stream.qn, stream.bandwidth)}`
        : '',
      stream.id,
      stream.quality,
      stream.qn,
      stream.bandwidth,
      `${mediaType}-${index + 1}`,
    ),
    url,
    mediaType,
    contentType: firstText(stream.mimeType, stream.mime_type, stream.contentType),
    title: firstText(inherited.title && titleSuffix ? `${inherited.title}-${titleSuffix}` : '', inherited.title, titleSuffix),
    sourceUrl: inherited.sourceUrl,
    referer: inherited.sourceUrl,
    expectedBytes: stream.size,
    priority: stream.priority ?? index,
    groupId: inherited.groupId,
    metadata: {
      streamType: mediaType,
      quality: quality || undefined,
      bandwidth: stream.bandwidth,
      codecs: firstText(stream.codecs, stream.codec) || undefined,
      ...(isObject(inherited.metadata) ? inherited.metadata : {}),
    },
  };
}

function seedsFromPayload(payload = {}, request = {}, plan = {}, inheritedOverrides = {}) {
  const data = payloadData(payload);
  const title = firstText(request.title, data.title, payload.title, payload.videoData?.title, plan.source?.title);
  const sourceUrl = firstText(request.inputUrl, request.url, request.input, data.pageUrl, payload.pageUrl, plan.source?.canonicalUrl, plan.source?.input);
  const inherited = {
    title,
    sourceUrl,
    ...inheritedOverrides,
    metadata: {
      ...(isObject(inheritedOverrides.metadata) ? inheritedOverrides.metadata : {}),
    },
  };
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

function bvidFromValue(value) {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }
  const direct = text.match(/\b(BV[0-9A-Za-z]+)\b/u)?.[1];
  if (direct) {
    return direct;
  }
  try {
    const parsed = new URL(text);
    return parsed.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/u)?.[1] ?? '';
  } catch {
    return '';
  }
}

function bilibiliVideoUrl(bvid) {
  return bvid ? `https://www.bilibili.com/video/${bvid}/` : '';
}

function normalizeCid(value) {
  const text = firstText(value);
  return text ? String(text) : '';
}

function pageEntriesFromViewPayload(payload = {}, request = {}, plan = {}) {
  const data = payloadData(payload);
  const bvid = firstText(data.bvid, data.bv_id, payload.bvid, request.bvid, bvidFromValue(request.input), bvidFromValue(plan.source?.input));
  const aid = firstText(data.aid, data.av, payload.aid, request.aid);
  const title = firstText(request.title, data.title, payload.title, plan.source?.title);
  const sourceUrl = firstText(
    request.inputUrl,
    request.url,
    request.input,
    data.short_link_v2,
    data.short_link,
    payload.pageUrl,
    plan.source?.canonicalUrl,
    plan.source?.input,
    bilibiliVideoUrl(bvid),
  );
  const pages = toArray(data.pages?.length ? data.pages : payload.pages?.length ? payload.pages : [{
    cid: data.cid ?? payload.cid,
    page: data.page ?? payload.page ?? 1,
    part: data.part ?? payload.part ?? title,
  }]);
  return pages
    .map((page, index) => {
      const cid = normalizeCid(page.cid ?? page.pageCid ?? page.page_cid);
      return {
        bvid,
        aid,
        cid,
        page: Number(page.page ?? page.index ?? index + 1) || index + 1,
        title,
        partTitle: firstText(page.part, page.title, page.name, title),
        sourceUrl,
        playlistKind: 'video-detail',
      };
    })
    .filter((entry) => entry.bvid || entry.cid);
}

function listItemsFromPayload(payload = {}) {
  const data = payloadData(payload);
  return [
    data.archives,
    data.items,
    data.videos,
    data.medias,
    data.list?.vlist,
    data.list?.archives,
    data.result?.items,
    data.result?.archives,
    payload.archives,
    payload.items,
    payload.videos,
    payload.medias,
  ].flatMap(toArray).filter(isObject);
}

function pageEntriesFromListPayload(payload = {}, kind = 'playlist', request = {}, plan = {}) {
  const data = payloadData(payload);
  const playlistId = firstText(
    payload.sid,
    payload.seasonId,
    payload.seriesId,
    data.sid,
    data.season_id,
    data.meta?.id,
    request.playlistId,
  );
  const playlistTitle = firstText(
    payload.title,
    data.title,
    data.meta?.name,
    data.meta?.title,
    request.title,
    plan.source?.title,
  );
  const limit = normalizePositiveInteger(request.maxItems ?? request.maxPlaylistItems ?? plan.policy?.maxItems, 0);
  return listItemsFromPayload(payload)
    .slice(0, limit || undefined)
    .map((item, index) => {
      const bvid = firstText(item.bvid, item.bv_id, item.bvid_str, bvidFromValue(item.arcurl), bvidFromValue(item.url));
      const sourceUrl = firstText(
        item.arcurl,
        item.url,
        item.link,
        item.uri,
        bvid ? bilibiliVideoUrl(bvid) : '',
        request.inputUrl,
        request.url,
        request.input,
        plan.source?.input,
      );
      return {
        bvid,
        aid: firstText(item.aid, item.id, item.archive_id),
        cid: normalizeCid(item.cid),
        page: Number(item.page ?? 1) || 1,
        title: firstText(item.title, item.name, playlistTitle),
        partTitle: firstText(item.part, item.title, item.name),
        sourceUrl,
        playlistKind: kind,
        playlistId,
        playlistTitle,
        playlistIndex: index + 1,
      };
    })
    .filter((entry) => entry.bvid || entry.cid || entry.sourceUrl);
}

function candidatePayload(candidate = {}) {
  return isObject(candidate.payload) ? candidate.payload : candidate;
}

function candidateIdentity(candidate = {}) {
  const payload = candidatePayload(candidate);
  const data = payloadData(payload);
  return {
    key: firstText(candidate.key),
    bvid: firstText(candidate.bvid, payload.bvid, data.bvid, bvidFromValue(candidate.key)),
    cid: normalizeCid(candidate.cid ?? payload.cid ?? data.cid),
    page: Number(candidate.page ?? candidate.pageIndex ?? payload.page ?? data.page) || null,
  };
}

function identityMatches(candidate, identity = {}) {
  const candidateId = candidateIdentity(candidate);
  if (candidateId.bvid && identity.bvid && candidateId.bvid === identity.bvid) {
    return true;
  }
  if (candidateId.cid && identity.cid && candidateId.cid === identity.cid) {
    return true;
  }
  if (candidateId.page && identity.page && candidateId.page === identity.page && !candidateId.bvid && !candidateId.cid) {
    return true;
  }
  if (candidateId.key && identity.bvid && candidateId.key === identity.bvid) {
    return true;
  }
  if (candidateId.key && identity.cid && candidateId.key === identity.cid) {
    return true;
  }
  return false;
}

function playUrlPayloadForIdentity(identity, candidates = [], index = 0) {
  if (candidates.length === 0) {
    return null;
  }
  return candidates.find((candidate) => identityMatches(candidate, identity))
    ?? candidates[index]
    ?? (candidates.length === 1 ? candidates[0] : null);
}

function decoratedSeedsFromPlayUrlPayload(playUrlPayload, identity = {}, request = {}, plan = {}) {
  const title = firstText(identity.partTitle, identity.title, request.title, plan.source?.title);
  const sourceUrl = firstText(identity.sourceUrl, request.inputUrl, request.url, request.input, plan.source?.input, bilibiliVideoUrl(identity.bvid));
  const groupId = firstText(
    identity.groupId,
    identity.bvid && identity.page ? `bilibili:${identity.bvid}:p${identity.page}` : '',
    identity.bvid ? `bilibili:${identity.bvid}` : '',
    identity.cid ? `bilibili:cid:${identity.cid}` : '',
  );
  return seedsFromPayload(candidatePayload(playUrlPayload), {
    ...request,
    title,
    input: sourceUrl,
    inputUrl: sourceUrl,
    url: sourceUrl,
  }, plan, {
    title,
    sourceUrl,
    groupId,
    streamIdPrefix: firstText(identity.bvid, identity.cid, identity.playlistIndex),
    metadata: {
      bvid: identity.bvid || undefined,
      aid: identity.aid || undefined,
      cid: identity.cid || undefined,
      page: identity.page || undefined,
      pageTitle: identity.partTitle || undefined,
      partTitle: identity.partTitle || undefined,
      playlistKind: identity.playlistKind || undefined,
      playlistId: identity.playlistId || undefined,
      playlistTitle: identity.playlistTitle || undefined,
      playlistIndex: identity.playlistIndex || undefined,
    },
  });
}

function requestWithBilibiliPageSeeds(request = {}, plan = {}) {
  const playUrlCandidates = playUrlPayloadCandidates(request);
  if (playUrlCandidates.length === 0) {
    return null;
  }

  const entries = [
    ...viewPayloadCandidates(request).flatMap((payload) => pageEntriesFromViewPayload(payload, request, plan)),
    ...listPayloadCandidates(request).flatMap((entry) => pageEntriesFromListPayload(entry.payload, entry.kind, request, plan)),
  ];
  if (entries.length === 0) {
    return null;
  }

  const seeds = [];
  for (const [index, identity] of entries.entries()) {
    const playUrlPayload = playUrlPayloadForIdentity(identity, playUrlCandidates, index);
    if (!playUrlPayload) {
      continue;
    }
    seeds.push(...decoratedSeedsFromPlayUrlPayload(playUrlPayload, identity, request, plan));
  }
  if (seeds.length === 0) {
    return null;
  }
  return {
    ...request,
    metadata: {
      ...metadataObject(request),
      resourceSeeds: seeds,
      resolution: {
        siteResolver: siteKey,
        inputKind: entries.some((entry) => entry.playlistKind !== 'video-detail') ? 'playlist' : 'video-detail',
        expectedVideos: entries.length,
        resolvedSeeds: seeds.length,
      },
    },
  };
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
  const seededRequest = requestWithBilibiliPageSeeds(context.request ?? {}, plan)
    ?? requestWithPayloadSeeds(context.request ?? {}, plan);
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
