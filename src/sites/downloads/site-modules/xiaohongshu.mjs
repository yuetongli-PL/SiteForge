// @ts-check

import {
  addCommonProfileFlags,
  addLoginFlags,
  createNativeResolutionMiss,
  legacyItems,
  normalizeText,
  normalizePositiveInteger,
  pushFlag,
  resolveNativeResourceSeeds,
  toArray,
} from './common.mjs';
import {
  normalizeDownloadResourceConsumerHeaders,
  normalizeSessionLeasePageFetchHeaders,
  normalizeSessionLeaseConsumerHeaders,
} from '../contracts.mjs';

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
    video.media?.stream?.h265?.[0]?.url,
    video.media?.stream?.av1?.[0]?.masterUrl,
    video.media?.stream?.av1?.[0]?.master_url,
    video.media?.stream?.av1?.[0]?.url,
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

function metadataObject(request = {}) {
  return isObject(request.metadata) ? request.metadata : {};
}

function headerFreshnessEvidence(request = {}, sessionLease = null) {
  const requestHeaderNames = Object.keys(normalizeDownloadResourceConsumerHeaders(request.headers)).sort();
  const sessionHeaderNames = Object.keys(normalizeSessionLeasePageFetchHeaders(sessionLease)).sort();
  const resolverHeaderNames = ['User-Agent'];
  const allHeaderNames = [...new Set([...requestHeaderNames, ...sessionHeaderNames, ...resolverHeaderNames])].sort();
  const requiredHeaderNames = [...new Set([
    'User-Agent',
    ...toArray(request.requiredHeaderNames ?? request.headerFreshnessRequiredHeaders).map((value) => firstText(value)).filter(Boolean),
  ])].sort();
  const presentLower = new Set(allHeaderNames.map((name) => name.toLowerCase()));
  const missingRequiredHeaders = requiredHeaderNames.filter((name) => !presentLower.has(name.toLowerCase()));
  const freshnessStatus = missingRequiredHeaders.length
    ? 'missing-required'
    : request.headersFresh === true || request.headerFreshness === 'fresh'
      ? 'claimed-fresh'
      : 'unknown';
  return {
    contractVersion: 'xiaohongshu-header-freshness-v1',
    headerNames: allHeaderNames,
    requestHeaderNames,
    sessionHeaderNames,
    resolverHeaderNames,
    requiredHeaderNames,
    missingRequiredHeaders,
    freshnessStatus,
    riskCauseCode: missingRequiredHeaders.length ? 'header-evidence-incomplete' : undefined,
    cookieEvidence: allHeaderNames.some((name) => name.toLowerCase() === 'cookie') || undefined,
    freshnessClaimed: request.headersFresh === true || request.headerFreshness === 'fresh' || undefined,
  };
}

function pageFactCandidates(request = {}) {
  const metadata = metadataObject(request);
  return [
    request.xiaohongshuPageFacts,
    request.pageFacts,
    request.fixturePageFacts,
    metadata.xiaohongshuPageFacts,
    metadata.pageFacts,
    metadata.fixturePageFacts,
  ].filter(isObject);
}

function htmlCandidates(request = {}) {
  const metadata = metadataObject(request);
  return [
    request.fixtureHtml,
    request.pageHtml,
    request.html,
    request.rawHtml,
    metadata.fixtureHtml,
    metadata.pageHtml,
    metadata.html,
    metadata.rawHtml,
  ].map((value) => (typeof value === 'string' ? value : '')).filter((value) => value.trim());
}

function noteMetadataFromFacts(facts = {}, request = {}, plan = {}) {
  const note = facts.note ?? facts.detailNote ?? facts.currentNote ?? facts;
  return {
    noteId: firstText(request.noteId, facts.noteId, note.noteId, note.note_id, note.id),
    noteTitle: firstText(request.title, facts.title, note.title, note.displayTitle, note.display_title, note.desc, plan.source?.title),
    authorName: firstText(facts.authorName, note.authorName, note.user?.nickname, note.user?.name),
    authorUserId: firstText(facts.authorUserId, facts.userId, note.user?.userId, note.user?.user_id, note.user?.id),
    authorUrl: firstText(facts.authorUrl, note.authorUrl),
    publishedAt: firstText(facts.publishedAt, facts.createTime, note.time, note.createTime, note.create_time),
    tagNames: Array.isArray(facts.tagNames) ? facts.tagNames : Array.isArray(note.tagNames) ? note.tagNames : undefined,
    sourceUrl: firstText(request.inputUrl, request.url, request.input, facts.url, note.url, plan.source?.canonicalUrl, plan.source?.input),
  };
}

export function createXiaohongshuAssetResourceSeed(asset = {}, mediaType = 'image', index = 0, note = {}, sourceType = 'page-facts') {
  const url = mediaType === 'video' ? videoUrl(asset) : imageUrl(asset);
  if (!url) {
    return null;
  }
  const assetId = firstText(asset.id, asset.assetId, asset.fileId, asset.file_id, asset.traceId, asset.trace_id, `${mediaType}-${index + 1}`);
  return {
    id: assetId,
    url,
    mediaType,
    title: firstText(note.noteTitle, note.noteId, `xiaohongshu-${mediaType}-${index + 1}`),
    noteId: note.noteId,
    sourceUrl: note.sourceUrl,
    referer: note.sourceUrl,
    groupId: firstText(note.noteId, note.noteTitle),
    headers: normalizeDownloadResourceConsumerHeaders(asset.headers ?? asset.downloadHeaders),
    metadata: {
      noteId: note.noteId || undefined,
      noteTitle: note.noteTitle || undefined,
      authorName: note.authorName || undefined,
      authorUserId: note.authorUserId || undefined,
      authorUrl: note.authorUrl || undefined,
      publishedAt: note.publishedAt || undefined,
      tagNames: note.tagNames,
      assetType: mediaType,
      assetId: assetId || undefined,
      previewUrl: firstText(asset.previewUrl, asset.preview, asset.thumbnailUrl, asset.urlPre, asset.url_pre) || undefined,
      width: asset.width,
      height: asset.height,
      sourceUrls: Array.isArray(asset.sourceUrls) ? asset.sourceUrls : undefined,
      sourceType,
    },
  };
}

function seedsFromPageFacts(facts = {}, request = {}, plan = {}, sourceType = 'page-facts') {
  const note = noteMetadataFromFacts(facts, request, plan);
  const images = [
    ...toArray(facts.contentImages),
    ...toArray(facts.images),
    ...toArray(facts.note?.images),
    ...toArray(facts.note?.imageList),
    ...toArray(facts.note?.image_list),
  ];
  const videos = [
    ...toArray(facts.contentVideos),
    ...toArray(facts.contentVideoUrls),
    ...toArray(facts.primaryVideoUrl),
    ...toArray(facts.videos),
    ...toArray(facts.video),
    ...toArray(facts.note?.videos),
    ...toArray(facts.note?.video),
  ];
  return [
    ...images.map((asset, index) => createXiaohongshuAssetResourceSeed(asset, 'image', index, note, sourceType)),
    ...videos.map((asset, index) => createXiaohongshuAssetResourceSeed(asset, 'video', index, note, sourceType)),
  ].filter(Boolean);
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&amp;/giu, '&')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, '\'')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>');
}

function mediaUrlsFromHtml(html, tagPattern) {
  const urls = [];
  let match = tagPattern.exec(html);
  while (match) {
    const url = decodeHtmlEntities(match[1] ?? '');
    if (url) {
      urls.push(url);
    }
    match = tagPattern.exec(html);
  }
  return [...new Set(urls)];
}

function seedsFromFixtureHtml(html, request = {}, plan = {}, sourceType = 'fixture-html') {
  const note = noteMetadataFromFacts({}, request, plan);
  const imageUrls = mediaUrlsFromHtml(html, /<(?:img|meta)\b[^>]*(?:src|content)=["']([^"']+\.(?:jpg|jpeg|png|webp|gif)(?:\?[^"']*)?)["'][^>]*>/giu);
  const videoUrls = mediaUrlsFromHtml(html, /<(?:video|source|meta)\b[^>]*(?:src|content)=["']([^"']+\.(?:mp4|m3u8|mov|webm)(?:\?[^"']*)?)["'][^>]*>/giu);
  return [
    ...imageUrls.map((url, index) => createXiaohongshuAssetResourceSeed({ url, id: `html-image-${index + 1}` }, 'image', index, note, sourceType)),
    ...videoUrls.map((url, index) => createXiaohongshuAssetResourceSeed({ url, id: `html-video-${index + 1}` }, 'video', index, note, sourceType)),
  ].filter(Boolean);
}

function inputUrl(request = {}, plan = {}) {
  return firstText(request.inputUrl, request.url, request.input, plan.source?.input);
}

function isXiaohongshuPageUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.hostname === 'www.xiaohongshu.com'
      && (/^\/explore\//u.test(parsed.pathname) || /^\/user\/profile\//u.test(parsed.pathname) || parsed.pathname === '/search_result');
  } catch {
    return false;
  }
}

function injectedFetchImpl(request = {}, context = {}) {
  for (const candidate of [
    request.fetchImpl,
    request.mockFetchImpl,
    context.fetchImpl,
    context.mockFetchImpl,
    context.deps?.fetchImpl,
    context.deps?.mockFetchImpl,
    context.options?.fetchImpl,
    context.options?.mockFetchImpl,
  ]) {
    if (typeof candidate === 'function') {
      return candidate;
    }
  }
  return null;
}

function pageFetchState(request = {}, context = {}) {
  const fetchImpl = injectedFetchImpl(request, context);
  if (fetchImpl) {
    return {
      fetchImpl,
      source: 'fetchImpl',
    };
  }
  if (context.allowNetworkResolve === true && typeof globalThis.fetch === 'function') {
    return {
      fetchImpl: globalThis.fetch,
      source: 'network-fetch',
    };
  }
  return null;
}

async function responseToText(response) {
  if (typeof response === 'string') {
    return response;
  }
  if (!response || response.ok === false) {
    return '';
  }
  if (typeof response.text === 'function') {
    return await response.text();
  }
  return firstText(response.body, response.data);
}

function isXiaohongshuErrorOrRiskPage(response = null, html = '', requestedUrl = '') {
  const finalUrl = firstText(response?.url, requestedUrl);
  try {
    const parsed = new URL(finalUrl);
    if (
      parsed.hostname === 'www.xiaohongshu.com'
      && (
        parsed.pathname === '/404'
        || parsed.pathname.startsWith('/404/')
        || parsed.searchParams.has('error_code')
        || parsed.searchParams.has('verifyMsg')
      )
    ) {
      return true;
    }
  } catch {
    // Non-URL test fixtures fall through to HTML markers.
  }
  const loweredHtml = String(html ?? '').toLowerCase();
  return loweredHtml.includes("this page isn't available right now")
    || loweredHtml.includes('sorry, this page is not available right now')
    || loweredHtml.includes('error_code=300031')
    || loweredHtml.includes('verifymsg=');
}

async function fetchedHtmlEvidence(request = {}, plan = {}, sessionLease = null, context = {}) {
  const url = inputUrl(request, plan);
  const fetchState = pageFetchState(request, context);
  if (!url || !isXiaohongshuPageUrl(url) || !fetchState) {
    return { seeds: [] };
  }
  try {
    const response = await fetchState.fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 SiteForge native resolver',
        ...normalizeSessionLeasePageFetchHeaders(sessionLease),
        ...normalizeDownloadResourceConsumerHeaders(request.headers),
      },
      redirect: 'follow',
    });
    const html = await responseToText(response);
    if (!html) {
      return {
        seeds: [],
        fetchSource: fetchState.source === 'network-fetch' ? 'network-fetch' : 'injected-fetch',
        networkGateUsed: fetchState.source === 'network-fetch',
        fetchedUrlPresent: Boolean(firstText(response?.url, url)),
      };
    }
    if (isXiaohongshuErrorOrRiskPage(response, html, url)) {
      return {
        seeds: [],
        fetchSource: fetchState.source === 'network-fetch' ? 'network-fetch' : 'injected-fetch',
        networkGateUsed: fetchState.source === 'network-fetch',
        fetchedUrlPresent: Boolean(firstText(response?.url, url)),
        blockedReason: 'xiaohongshu-risk-or-error-page',
      };
    }
    return {
      seeds: seedsFromFixtureHtml(html, {
        ...request,
        input: firstText(response?.url, url),
        inputUrl: firstText(response?.url, url),
        url: firstText(response?.url, url),
      }, plan, 'fetched-html'),
      fetchSource: fetchState.source === 'network-fetch' ? 'network-fetch' : 'injected-fetch',
      networkGateUsed: fetchState.source === 'network-fetch',
      fetchedUrlPresent: Boolean(firstText(response?.url, url)),
    };
  } catch {
    return {
      seeds: [],
      fetchSource: fetchState.source === 'network-fetch' ? 'network-fetch' : 'injected-fetch',
      networkGateUsed: fetchState.source === 'network-fetch',
      fetchedUrlPresent: false,
    };
  }
}

function noteListCandidates(request = {}) {
  const metadata = metadataObject(request);
  return [
    { sourceType: 'search', notes: request.xiaohongshuSearchNotes },
    { sourceType: 'search', notes: request.searchNotes },
    { sourceType: 'author', notes: request.xiaohongshuAuthorNotes },
    { sourceType: 'author', notes: request.authorNotes },
    { sourceType: 'followed-users', notes: request.xiaohongshuFollowedNotes },
    { sourceType: 'followed-users', notes: request.followedNotes },
    { sourceType: 'search', notes: metadata.xiaohongshuSearchNotes },
    { sourceType: 'search', notes: metadata.searchNotes },
    { sourceType: 'author', notes: metadata.xiaohongshuAuthorNotes },
    { sourceType: 'author', notes: metadata.authorNotes },
    { sourceType: 'followed-users', notes: metadata.xiaohongshuFollowedNotes },
    { sourceType: 'followed-users', notes: metadata.followedNotes },
  ].flatMap((entry) => toArray(entry.notes).map((note) => ({
    sourceType: entry.sourceType,
    note,
  }))).filter((entry) => isObject(entry.note));
}

function seedsFromNoteList(entries = [], request = {}, plan = {}) {
  return entries.flatMap((entry) => seedsFromPayload({
    note: entry.note,
  }, {
    ...request,
    title: firstText(entry.note.title, entry.note.displayTitle, entry.note.display_title, request.title),
  }, plan).map((seed) => ({
    ...seed,
    metadata: {
      ...(seed.metadata ?? {}),
      noteTitle: firstText(entry.note.title, entry.note.displayTitle, entry.note.display_title) || undefined,
      authorName: firstText(entry.note.authorName, entry.note.user?.nickname, entry.note.user?.name) || undefined,
      authorUserId: firstText(entry.note.authorUserId, entry.note.user?.userId, entry.note.user?.id) || undefined,
      authorUrl: firstText(entry.note.authorUrl) || undefined,
      queryText: firstText(request.query, request.keyword) || undefined,
      sourceType: entry.sourceType,
    },
  })));
}

function callableFromContext(context = {}, name) {
  return [
    context[name],
    context.deps?.[name],
    context.options?.[name],
  ].find((candidate) => typeof candidate === 'function') ?? null;
}

function freshEvidenceProducer(context = {}) {
  return callableFromContext(context, 'resolveXiaohongshuFreshEvidence');
}

function resourceSeedsFromFreshEvidence(evidence = {}) {
  return toArray(evidence.resourceSeeds ?? evidence.resources)
    .filter((seed) => isObject(seed) || typeof seed === 'string');
}

function pageFactsFromFreshEvidence(evidence = {}) {
  return [
    evidence.pageFacts,
    ...toArray(evidence.pageFactsList),
  ].filter(isObject);
}

async function freshEvidenceFromProducer(request = {}, plan = {}, sessionLease = null, context = {}) {
  const producer = freshEvidenceProducer(context);
  const url = inputUrl(request, plan);
  if (!producer || !url || !isXiaohongshuPageUrl(url)) {
    return null;
  }
  const evidence = await producer(url, {
    request,
    plan,
    sessionLease,
    allowNetworkResolve: context.allowNetworkResolve === true,
    profilePath: request.profilePath ?? context.profilePath ?? context.options?.profilePath,
    browserPath: request.browserPath ?? context.browserPath ?? context.options?.browserPath,
    browserProfileRoot: request.browserProfileRoot ?? context.browserProfileRoot ?? context.options?.browserProfileRoot,
    userDataDir: request.userDataDir ?? context.userDataDir ?? context.options?.userDataDir,
    timeoutMs: request.timeoutMs ?? context.timeoutMs ?? context.options?.timeoutMs,
    headless: request.headless ?? context.headless ?? context.options?.headless,
    reuseLoginState: request.reuseLoginState,
    maxItems: request.maxItems ?? request.limit ?? plan.policy?.maxItems ?? 1,
  }, context);
  if (!isObject(evidence)) {
    return null;
  }
  const seeds = resourceSeedsFromFreshEvidence(evidence);
  if (seeds.length > 0) {
    return {
      seeds,
      resolvedNotes: Number(evidence.resolution?.resolvedNotes ?? evidence.pageFactsList?.length ?? 1) || 1,
      headerFreshness: evidence.headerFreshness,
      status: firstText(evidence.status),
    };
  }
  const factSeeds = pageFactsFromFreshEvidence(evidence)
    .flatMap((facts) => seedsFromPageFacts(facts, request, plan, 'fresh-page-evidence'));
  if (factSeeds.length > 0) {
    return {
      seeds: factSeeds,
      resolvedNotes: Number(evidence.resolution?.resolvedNotes ?? evidence.pageFactsList?.length ?? 1) || 1,
      headerFreshness: evidence.headerFreshness,
      status: firstText(evidence.status),
    };
  }
  return null;
}

function resultNotes(value = {}) {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isObject(value)) {
    return [];
  }
  return [
    value.notes,
    value.items,
    value.results,
    value.videos,
  ].flatMap(toArray).filter(isObject);
}

async function followedNotesFromInjectedQuery(request = {}, plan = {}, sessionLease = null, context = {}) {
  if (!request.followedUsers && !request.followedUpdates && !request.followedNotes) {
    return [];
  }
  const query = callableFromContext(context, 'queryXiaohongshuFollow');
  if (!query) {
    return [];
  }
  const result = await query({
    contractVersion: 'xiaohongshu-native-resolver-deps-v1',
    intent: 'list-followed-users',
    sourceType: 'followed-users',
    request,
    plan,
    sessionLease,
    allowNetworkResolve: context.allowNetworkResolve === true,
    headerFreshness: headerFreshnessEvidence(request, sessionLease),
    limit: request.followedUserLimit ?? request.maxItems ?? plan.policy?.maxItems,
  });
  return resultNotes(result).map((note) => ({ sourceType: 'followed-users', note }));
}

function requestWithSeeds(request = {}, seeds = [], resolution = {}) {
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
        resolvedSeeds: seeds.length,
        ...resolution,
      },
    },
  };
}

async function requestWithPageResolverSeeds(request = {}, plan = {}, sessionLease = null, context = {}) {
  const headerFreshness = headerFreshnessEvidence(request, sessionLease);
  const pageFactSeeds = pageFactCandidates(request)
    .flatMap((facts) => seedsFromPageFacts(facts, request, plan));
  if (pageFactSeeds.length > 0) {
    return requestWithSeeds(request, pageFactSeeds, {
      sourceType: 'page-facts',
      resolvedNotes: pageFactCandidates(request).length,
      headerFreshness,
    });
  }

  const freshEvidence = await freshEvidenceFromProducer(request, plan, sessionLease, context);
  if (freshEvidence?.seeds?.length > 0) {
    return requestWithSeeds(request, freshEvidence.seeds, {
      sourceType: 'fresh-page-evidence',
      resolvedNotes: freshEvidence.resolvedNotes,
      headerFreshness: isObject(freshEvidence.headerFreshness) ? freshEvidence.headerFreshness : headerFreshness,
      freshEvidenceStatus: freshEvidence.status || undefined,
    });
  }

  const htmlSeeds = htmlCandidates(request).flatMap((html) => seedsFromFixtureHtml(html, request, plan));
  if (htmlSeeds.length > 0) {
    return requestWithSeeds(request, htmlSeeds, {
      sourceType: 'fixture-html',
      resolvedNotes: 1,
      headerFreshness,
    });
  }

  const fetchEvidence = await fetchedHtmlEvidence(request, plan, sessionLease, context);
  if (fetchEvidence.seeds.length > 0) {
    return requestWithSeeds(request, fetchEvidence.seeds, {
      sourceType: 'fetched-html',
      resolvedNotes: 1,
      headerFreshness,
      fetchSource: fetchEvidence.fetchSource,
      networkGateUsed: fetchEvidence.networkGateUsed,
      fetchedUrlPresent: fetchEvidence.fetchedUrlPresent,
    });
  }

  const noteEntries = [
    ...noteListCandidates(request),
    ...await followedNotesFromInjectedQuery(request, plan, sessionLease, context),
  ];
  const noteSeeds = seedsFromNoteList(noteEntries, request, plan);
  if (noteSeeds.length > 0) {
    return requestWithSeeds(request, noteSeeds, {
      sourceType: 'note-list',
      attemptedNotes: noteEntries.length,
      resolvedNotes: new Set(noteEntries.map((entry) => firstText(entry.note.noteId, entry.note.id, entry.note.note_id))).size || noteEntries.length,
      headerFreshness,
    });
  }
  return null;
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

function hasExplicitNativeSeeds(request = {}) {
  const metadata = metadataObject(request);
  return Boolean(
    request.resources
      || request.resourceUrls
      || request.resourceUrl
      || request.resourceSeeds
      || request.resolvedResources
      || request.downloadResources
      || request.mediaResources
      || request.directMedia
      || request.downloadBundle
      || request.download?.resources
      || request.download?.resourceSeeds
      || request.download?.directMedia
      || metadata.resourceSeeds
      || metadata.resolvedResources
      || metadata.downloadResources
      || metadata.mediaResources
      || metadata.directMedia
      || metadata.downloadBundle
      || metadata.download?.resources
      || metadata.download?.resourceSeeds
      || metadata.download?.directMedia
  );
}

export async function resolveResources(plan, sessionLease = null, context = {}) {
  if (hasExplicitNativeSeeds(context.request ?? {})) {
    const resolved = resolveNativeResourceSeeds(siteKey, plan, sessionLease, context, nativeSeedResolverOptions);
    if (resolved) {
      return resolved;
    }
  }
  const seededRequest = requestWithPayloadSeeds(context.request ?? {}, plan)
    ?? await requestWithPageResolverSeeds(context.request ?? {}, plan, sessionLease, context);
  if (!seededRequest) {
    const request = context.request ?? {};
    const url = inputUrl(request, plan);
    if (context.allowNetworkResolve === true && isXiaohongshuPageUrl(url)) {
      const headerFreshness = headerFreshnessEvidence(request, sessionLease);
      return createNativeResolutionMiss(siteKey, plan, {
        method: nativeSeedResolverOptions.method,
        reason: headerFreshness.cookieEvidence
          ? 'xiaohongshu-native-page-unresolved'
          : 'xiaohongshu-session-or-header-evidence-required',
        expectedCount: 1,
        resolution: {
          sourceType: 'page-fetch',
          headerFreshness,
          networkGateUsed: true,
        },
      });
    }
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
