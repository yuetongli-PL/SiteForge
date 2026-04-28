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

export const siteKey = 'xiaohongshu';

export const nativeSeedResolverOptions = Object.freeze({
  defaultMediaType: 'image',
  method: 'native-xiaohongshu-resource-seeds',
  completeReason: 'xiaohongshu-resource-seeds-provided',
  incompleteReason: 'xiaohongshu-resource-seeds-incomplete',
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
    request.xiaohongshuNotePayload,
    request.notePayload,
    request.pagePayload,
    request.apiPayload,
    metadata.xiaohongshuNotePayload,
    metadata.notePayload,
    metadata.pagePayload,
    metadata.apiPayload,
  ].filter(isObject);
}

function noteFromPayload(payload = {}) {
  return payload.note
    ?? payload.noteCard
    ?? payload.note_card
    ?? payload.data?.note
    ?? payload.data?.noteCard
    ?? payload.data?.note_card
    ?? payload.data?.items?.[0]?.note
    ?? payload.data?.items?.[0]?.note_card
    ?? payload.items?.[0]?.note
    ?? payload.items?.[0]?.note_card
    ?? payload;
}

function imageUrl(image = {}) {
  if (typeof image === 'string') {
    return image;
  }
  return firstText(
    image.url,
    image.src,
    image.originUrl,
    image.originalUrl,
    image.urlDefault,
    image.url_default,
    image.urlPre,
    image.url_pre,
    image.infoList?.[0]?.url,
    image.info_list?.[0]?.url,
  );
}

function videoUrl(video = {}) {
  if (typeof video === 'string') {
    return video;
  }
  return firstText(
    video.url,
    video.src,
    video.masterUrl,
    video.master_url,
    video.originUrl,
    video.originalUrl,
    video.media?.stream?.h264?.[0]?.masterUrl,
    video.media?.stream?.h264?.[0]?.master_url,
    video.media?.stream?.h264?.[0]?.url,
    video.media?.stream?.h265?.[0]?.masterUrl,
    video.media?.stream?.h265?.[0]?.master_url,
    video.video?.url,
  );
}

function noteTitle(note = {}, request = {}, plan = {}) {
  return firstText(
    request.title,
    note.title,
    note.displayTitle,
    note.display_title,
    note.desc,
    note.description,
    plan.source?.title,
  );
}

function seedsFromPayload(payload = {}, request = {}, plan = {}) {
  const note = noteFromPayload(payload);
  const title = noteTitle(note, request, plan);
  const noteId = firstText(request.noteId, note.noteId, note.note_id, note.id, payload.noteId, payload.note_id);
  const sourceUrl = firstText(request.inputUrl, request.url, request.input, note.url, note.link, payload.url, plan.source?.canonicalUrl, plan.source?.input);
  const seeds = [];
  for (const image of [
    ...toArray(note.images),
    ...toArray(note.imageList),
    ...toArray(note.image_list),
    ...toArray(note.imageListInfo),
    ...toArray(note.image_list_info),
    ...toArray(payload.images),
  ]) {
    const url = imageUrl(image);
    if (!url) {
      continue;
    }
    seeds.push({
      id: firstText(image.id, image.fileId, image.file_id, image.traceId, image.trace_id, `image-${seeds.length + 1}`),
      url,
      mediaType: 'image',
      title,
      noteId,
      sourceUrl,
      referer: sourceUrl,
      metadata: {
        noteId: noteId || undefined,
        assetType: 'image',
      },
    });
  }

  for (const video of [
    ...toArray(note.videos),
    ...toArray(note.video),
    ...toArray(payload.video),
    ...toArray(payload.videos),
  ]) {
    const url = videoUrl(video);
    if (!url) {
      continue;
    }
    seeds.push({
      id: firstText(video.id, video.fileId, video.file_id, video.traceId, video.trace_id, `video-${seeds.length + 1}`),
      url,
      mediaType: 'video',
      title,
      noteId,
      sourceUrl,
      referer: sourceUrl,
      metadata: {
        noteId: noteId || undefined,
        assetType: 'video',
      },
    });
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

export default Object.freeze({
  siteKey,
  resolveResources,
  buildLegacyArgs,
});
