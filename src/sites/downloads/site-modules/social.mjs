// @ts-check

import {
  addCommonProfileFlags,
  addLoginFlags,
  isHttpUrl,
  normalizeText,
  pushFlag,
  resolveNativeResourceSeeds,
  toArray,
} from './common.mjs';

export const siteKeys = Object.freeze(['x', 'instagram']);

function firstText(...values) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function normalizeActionToken(value) {
  return normalizeText(value).toLowerCase().replace(/_/gu, '-');
}

function isTrue(value) {
  return value === true || value === 'true' || value === '1' || value === 'yes' || value === 'on';
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function actionNeedsQuery(action) {
  return ['search', 'followed-posts-by-date'].includes(normalizeActionToken(action));
}

function relationActionFromRequest(request = {}) {
  const relation = normalizeActionToken(firstText(
    request.relation,
    request.relationType,
    request.socialRelation,
    request.followType,
  ));
  if (['followers', 'profile-followers', 'follower'].includes(relation) || isTrue(request.followers)) {
    return 'profile-followers';
  }
  if (['following', 'profile-following', 'followings'].includes(relation) || isTrue(request.following)) {
    return 'profile-following';
  }
  if (['followed-users', 'followed', 'current-following'].includes(relation) || isTrue(request.followedUsers)) {
    return 'followed-users';
  }
  return '';
}

function hasDateWindow(request = {}) {
  return Boolean(firstText(request.date, request.fromDate, request.from, request.toDate, request.to));
}

function queryFromSocialInput(plan, request = {}) {
  const explicit = firstText(
    request.query,
    request.keyword,
    request.q,
    request.searchQuery,
    request.search,
  );
  if (explicit && explicit !== 'true') {
    return explicit;
  }
  const input = firstText(request.input, request.url, request.inputUrl, plan.source?.input);
  if (!input) {
    return '';
  }
  if (!isHttpUrl(input)) {
    return input;
  }
  try {
    const parsed = new URL(input);
    return firstText(
      parsed.searchParams.get('q'),
      parsed.searchParams.get('query'),
      parsed.searchParams.get('keyword'),
    );
  } catch {
    return '';
  }
}

function hasExplicitSearchIntent(plan, request = {}) {
  if (isTrue(request.search)) {
    return true;
  }
  const explicit = firstText(request.query, request.keyword, request.q, request.searchQuery);
  if (explicit) {
    return true;
  }
  const input = firstText(request.input, request.url, request.inputUrl, plan.source?.input);
  if (!isHttpUrl(input)) {
    return false;
  }
  try {
    const parsed = new URL(input);
    return parsed.pathname.split('/').filter(Boolean)[0]?.toLowerCase() === 'search'
      || parsed.searchParams.has('q')
      || parsed.searchParams.has('query')
      || parsed.searchParams.has('keyword');
  } catch {
    return false;
  }
}

export function accountFromSocialInput(plan, request = {}) {
  const explicit = firstText(
    request.account,
    request.handle,
    request.user,
    request.profile,
    request.target,
    plan.source?.account,
  );
  if (explicit) {
    return explicit;
  }
  const input = firstText(request.input, request.url, request.inputUrl, plan.source?.input);
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

export function inferSocialAction(plan, request = {}) {
  const explicit = normalizeActionToken(firstText(
    request.action,
    request.socialAction,
    request.downloadAction,
  ));
  if (explicit) {
    return explicit;
  }
  const relationAction = relationActionFromRequest(request);
  if (relationAction) {
    return relationAction;
  }
  if (
    isTrue(request.followedPostsByDate)
    || isTrue(request.followedUpdates)
    || normalizeActionToken(request.dateMode) === 'followed'
    || (hasDateWindow(request) && !accountFromSocialInput(plan, request) && !queryFromSocialInput(plan, request))
  ) {
    return 'followed-posts-by-date';
  }
  if (hasExplicitSearchIntent(plan, request)) {
    return 'search';
  }
  if (plan.taskType === 'media-bundle') {
    return 'profile-content';
  }
  if (isTrue(request.fullArchive) || isTrue(request.allHistory) || isTrue(request.archive)) {
    return 'full-archive';
  }
  return 'full-archive';
}

function inferSocialContentType(plan, request = {}) {
  const explicit = firstText(request.contentType, request.tab);
  if (explicit) {
    return explicit;
  }
  if (plan.taskType === 'media-bundle' || isTrue(request.mediaOnly)) {
    return 'media';
  }
  return '';
}

function metadataObject(request = {}) {
  return isObject(request.metadata) ? request.metadata : {};
}

function nativeResolverEnabled(request = {}) {
  const metadata = metadataObject(request);
  return isTrue(request.nativeResolver)
    || isTrue(request.nativeSocialResolver)
    || isTrue(metadata.nativeResolver)
    || isTrue(metadata.nativeSocialResolver);
}

function socialNativeSupported(plan, request = {}) {
  if (!nativeResolverEnabled(request)) {
    return false;
  }
  const action = inferSocialAction(plan, request);
  if (['profile-followers', 'profile-following', 'followed-users', 'followed-posts-by-date'].includes(action)) {
    return false;
  }
  if (plan.siteKey === 'instagram') {
    return ['profile-content', 'full-archive'].includes(action);
  }
  if (plan.siteKey === 'x') {
    return ['profile-content', 'full-archive', 'search'].includes(action);
  }
  return false;
}

function socialMediaContainers(request = {}, siteKey = '') {
  const metadata = metadataObject(request);
  return [
    request.socialMediaResources,
    request.mediaResources,
    request.mediaItems,
    request.archiveItems,
    request.items,
    request.resources,
    siteKey === 'x' ? request.xMediaItems : undefined,
    siteKey === 'x' ? request.xArchiveItems : undefined,
    siteKey === 'instagram' ? request.instagramMediaItems : undefined,
    siteKey === 'instagram' ? request.instagramFeedUserPayload : undefined,
    siteKey === 'instagram' ? request.feedUserPayload : undefined,
    metadata.socialMediaResources,
    metadata.mediaResources,
    metadata.mediaItems,
    metadata.archiveItems,
    metadata.items,
    siteKey === 'x' ? metadata.xMediaItems : undefined,
    siteKey === 'x' ? metadata.xArchiveItems : undefined,
    siteKey === 'instagram' ? metadata.instagramMediaItems : undefined,
    siteKey === 'instagram' ? metadata.instagramFeedUserPayload : undefined,
    siteKey === 'instagram' ? metadata.feedUserPayload : undefined,
  ].filter(Boolean);
}

function inferMediaTypeFromUrl(url) {
  const normalized = normalizeText(url).toLowerCase();
  if (/\.(?:jpg|jpeg|png|webp|gif|avif)(?:[?#]|$)/u.test(normalized)) {
    return 'image';
  }
  if (/\.(?:mp4|m4v|mov|webm|m3u8)(?:[?#]|$)/u.test(normalized)) {
    return 'video';
  }
  return '';
}

function selectBestXVideoVariant(variants = []) {
  return toArray(variants)
    .filter(isObject)
    .filter((variant) => firstText(variant.url, variant.src) && firstText(variant.contentType, variant.content_type, variant.type).includes('mp4'))
    .sort((left, right) => Number(right.bitrate ?? right.bit_rate ?? 0) - Number(left.bitrate ?? left.bit_rate ?? 0))[0]
    ?? toArray(variants).find((variant) => isObject(variant) && firstText(variant.url, variant.src));
}

function directUrlFromSocialMedia(entry = {}) {
  if (typeof entry === 'string') {
    return entry;
  }
  const variant = selectBestXVideoVariant(entry.variants ?? entry.videoVariants ?? entry.video_variants);
  return firstText(
    entry.url,
    entry.downloadUrl,
    entry.mediaUrl,
    entry.bestUrl,
    entry.imageUrl,
    entry.videoUrl,
    entry.src,
    entry.href,
    entry.image_versions2?.candidates?.[0]?.url,
    entry.video_versions?.[0]?.url,
    entry.videoVersion?.url,
    variant?.url,
    variant?.src,
  );
}

function mediaTypeFromSocialMedia(entry = {}, url = '') {
  const explicit = firstText(entry.mediaType, entry.kind, entry.type, entry.media_type).toLowerCase();
  if (explicit === 'photo') {
    return 'image';
  }
  if (['image', 'video', 'audio', 'json', 'binary'].includes(explicit)) {
    return explicit;
  }
  const contentType = firstText(entry.contentType, entry.content_type, entry.mimeType, entry.mime_type).toLowerCase();
  if (contentType.includes('image/')) {
    return 'image';
  }
  if (contentType.includes('video/')) {
    return 'video';
  }
  if (entry.video_versions || entry.videoVariants || entry.variants) {
    return 'video';
  }
  if (entry.image_versions2 || entry.imageUrl) {
    return 'image';
  }
  return inferMediaTypeFromUrl(url) || 'binary';
}

function captionText(value = {}) {
  if (typeof value === 'string') {
    return value;
  }
  return firstText(value?.text, value?.caption?.text, value?.edge_media_to_caption?.edges?.[0]?.node?.text);
}

function socialMediaChildValues(value = {}) {
  return [
    value.media,
    value.mediaItems,
    value.media_items,
    value.assets,
    value.images,
    value.videos,
    value.carousel_media,
    value.carouselMedia,
    value.items,
    value.data?.items,
    value.data?.user?.edge_owner_to_timeline_media?.edges?.map((edge) => edge.node),
  ].filter((entry) => entry !== undefined && entry !== null && entry !== value);
}

function socialMediaEntries(value = {}, inherited = {}) {
  const entries = [];
  const seen = new WeakSet();
  const stack = [{ value, inherited, depth: 0 }];

  while (stack.length > 0 && entries.length < 2000) {
    const current = stack.pop();
    const currentValue = current?.value;
    if (currentValue == null || current.depth > 8) {
      continue;
    }
    if (typeof currentValue === 'string') {
      entries.push({ ...current.inherited, url: currentValue });
      continue;
    }
    if (Array.isArray(currentValue)) {
      if (seen.has(currentValue)) {
        continue;
      }
      seen.add(currentValue);
      for (let index = currentValue.length - 1; index >= 0; index -= 1) {
        stack.push({ value: currentValue[index], inherited: current.inherited, depth: current.depth + 1 });
      }
      continue;
    }
    if (!isObject(currentValue) || seen.has(currentValue)) {
      continue;
    }
    seen.add(currentValue);

    const nextInherited = {
      ...current.inherited,
      postId: firstText(currentValue.postId, currentValue.id, currentValue.pk, currentValue.tweetId, currentValue.rest_id, current.inherited.postId),
      shortcode: firstText(currentValue.shortcode, currentValue.code, current.inherited.shortcode),
      permalink: firstText(currentValue.permalink, currentValue.url, currentValue.link, current.inherited.permalink),
      title: firstText(currentValue.title, currentValue.full_text, currentValue.text, captionText(currentValue.caption), current.inherited.title),
      author: firstText(currentValue.author, currentValue.user?.username, currentValue.user?.screen_name, currentValue.owner?.username, current.inherited.author),
    };

    if (directUrlFromSocialMedia(currentValue)) {
      entries.push({ ...nextInherited, ...currentValue });
    }
    const children = socialMediaChildValues(currentValue);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ value: children[index], inherited: nextInherited, depth: current.depth + 1 });
    }
  }
  return entries;
}

function seedFromSocialMediaEntry(entry = {}, siteKey, plan, request = {}, index = 0) {
  const url = directUrlFromSocialMedia(entry);
  if (!url) {
    return null;
  }
  const mediaType = mediaTypeFromSocialMedia(entry, url);
  const postId = firstText(entry.postId, entry.id, entry.pk, entry.tweetId, entry.rest_id, entry.shortcode, entry.code);
  const title = firstText(entry.title, entry.text, entry.full_text, captionText(entry), postId, `${siteKey}-media-${index + 1}`);
  const sourceUrl = firstText(
    entry.permalink,
    entry.sourceUrl,
    entry.postUrl,
    entry.url && isHttpUrl(entry.url) && entry.url !== url ? entry.url : '',
    request.inputUrl,
    request.url,
    request.input,
    plan.source?.input,
  );
  return {
    id: firstText(entry.mediaId, entry.media_id, entry.id, postId, `media-${index + 1}`),
    url,
    mediaType,
    contentType: firstText(entry.contentType, entry.content_type, entry.mimeType, entry.mime_type),
    title,
    sourceUrl,
    referer: firstText(entry.referer, sourceUrl),
    headers: isObject(entry.headers) ? entry.headers : {},
    expectedBytes: entry.expectedBytes ?? entry.size,
    groupId: firstText(entry.groupId, postId, sourceUrl, title),
    metadata: {
      postId: postId || undefined,
      shortcode: firstText(entry.shortcode, entry.code) || undefined,
      author: firstText(entry.author, entry.user?.username, entry.user?.screen_name, entry.owner?.username) || undefined,
      assetType: mediaType,
      archiveStrategy: firstText(entry.archiveStrategy, siteKey === 'instagram' ? 'instagram-feed-user' : 'social-media-candidates'),
      posterOnlyVideoFallback: entry.posterOnlyVideoFallback === true || entry.reason === 'poster-only-video-fallback' || undefined,
    },
  };
}

function requestWithSocialNativeSeeds(siteKey, plan, request = {}) {
  if (!socialNativeSupported(plan, request)) {
    return null;
  }
  const mediaEntries = socialMediaContainers(request, siteKey)
    .flatMap((container) => socialMediaEntries(container));
  const seeds = mediaEntries
    .map((entry, index) => seedFromSocialMediaEntry(entry, siteKey, plan, request, index))
    .filter(Boolean);
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
        action: inferSocialAction(plan, request),
        archiveStrategy: siteKey === 'instagram' ? 'instagram-feed-user' : 'social-media-candidates',
        expectedMedia: mediaEntries.length,
        resolvedSeeds: seeds.length,
      },
    },
  };
}

export function resolveResourcesForSocialSite(siteKey, plan, sessionLease = null, context = {}) {
  const request = context.request ?? {};
  const seededRequest = requestWithSocialNativeSeeds(siteKey, plan, request);
  if (!seededRequest) {
    return null;
  }
  const resolved = resolveNativeResourceSeeds(siteKey, plan, sessionLease, {
    ...context,
    request: seededRequest,
  }, {
    defaultMediaType: 'binary',
    method: `native-${siteKey}-social-resource-seeds`,
    completeReason: `${siteKey}-social-resource-seeds-provided`,
    incompleteReason: `${siteKey}-social-resource-seeds-incomplete`,
  });
  if (!resolved) {
    return null;
  }
  return {
    ...resolved,
    metadata: {
      ...resolved.metadata,
      resolution: seededRequest.metadata?.resolution,
    },
  };
}

export function buildLegacyArgs(entrypointPath, plan, request = {}, sessionLease = {}, options = {}, layout) {
  const action = inferSocialAction(plan, request);
  const query = actionNeedsQuery(action) ? queryFromSocialInput(plan, request) : '';
  const account = actionNeedsQuery(action) ? '' : accountFromSocialInput(plan, request);
  const contentType = inferSocialContentType(plan, request);
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
  pushFlag(args, '--from', request.fromDate ?? request.from);
  pushFlag(args, '--to', request.toDate ?? request.to);
  pushFlag(args, '--query', query);
  pushFlag(args, '--content-type', contentType);
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

export function createSocialSiteModule(siteKey) {
  return Object.freeze({
    siteKey,
    resolveResources(plan, sessionLease = null, context = {}) {
      return resolveResourcesForSocialSite(siteKey, plan, sessionLease, context);
    },
    buildLegacyArgs,
  });
}
