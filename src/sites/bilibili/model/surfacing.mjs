import {
  cleanText,
  firstNonEmpty,
  normalizeUrlNoFragment,
  toArray,
  uniqueSortedStrings,
} from '../../../shared/normalize.mjs';

function tryParseUrl(input) {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function normalizeDisplayText(value) {
  const text = cleanText(value ?? '');
  return text || null;
}

function normalizeBilibiliAuthorName(value) {
  const text = normalizeDisplayText(value);
  if (!text) {
    return null;
  }
  const match = text.match(/^(.+?)的个人空间(?:-.+)?$/u);
  if (match?.[1]) {
    return normalizeDisplayText(match[1]);
  }
  return normalizeDisplayText(
    text
      .replace(/-哔哩哔哩视频$/u, '')
      .replace(/个人主页$/u, '')
  );
}

export function isBilibiliUrl(input) {
  const parsed = tryParseUrl(input);
  if (!parsed) {
    return false;
  }
  return /(^|\.)bilibili\.com$/iu.test(parsed.hostname);
}

export function extractBilibiliVideoCode(input) {
  const text = String(input ?? '');
  const directMatch = text.match(/\/video\/(BV[0-9A-Za-z]+)/u);
  if (directMatch?.[1]) {
    return directMatch[1];
  }
  const genericMatch = text.match(/\b(BV[0-9A-Za-z]{10})\b/u);
  return genericMatch?.[1] ?? null;
}

export function extractBilibiliAuthorMid(input) {
  const parsed = tryParseUrl(input);
  if (!parsed) {
    return null;
  }
  const match = `${parsed.hostname}${parsed.pathname}`.match(/space\.bilibili\.com\/(\d+)/u);
  return match?.[1] ?? null;
}

export function inferBilibiliSearchFamily(input) {
  const parsed = tryParseUrl(input);
  if (!parsed) {
    return null;
  }
  if (parsed.hostname === 'search.bilibili.com') {
    const family = parsed.pathname.replace(/^\/+|\/+$/gu, '').split('/')[0] ?? '';
    return family || 'all';
  }
  if (parsed.hostname === 'www.bilibili.com' && /^\/ss\/?$/u.test(parsed.pathname)) {
    return 'bangumi';
  }
  return null;
}

function deriveQueryTextFromUrl(input) {
  const parsed = tryParseUrl(input);
  if (!parsed) {
    return null;
  }
  return normalizeDisplayText(parsed.searchParams.get('searchkey'));
}

function deriveContentTypeFromUrl(input) {
  const parsed = tryParseUrl(input);
  if (!parsed) {
    return null;
  }
  if (/\/video\/BV/u.test(parsed.pathname)) {
    return 'video';
  }
  if (/\/bangumi\/play\//u.test(parsed.pathname)) {
    return 'bangumi';
  }
  return null;
}

function dedupeCards(cards) {
  const seen = new Set();
  const result = [];
  for (const card of cards) {
    const title = normalizeDisplayText(card?.title);
    const url = normalizeUrlNoFragment(card?.url);
    const bvid = normalizeDisplayText(card?.bvid);
    const authorMid = normalizeDisplayText(card?.authorMid);
    const contentType = normalizeDisplayText(card?.contentType);
    if (!title && !url && !bvid) {
      continue;
    }
    const key = bvid
      ? `bvid::${bvid}`
      : url
        ? `url::${url}`
        : `title::${title}`;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({
      title,
      url,
      bvid,
      authorMid,
      contentType,
    });
  }
  return result;
}

function dedupeAuthors(authors) {
  const seen = new Set();
  const result = [];
  for (const author of authors) {
    const name = normalizeDisplayText(author?.name);
    const url = normalizeUrlNoFragment(author?.url);
    const mid = normalizeDisplayText(author?.mid);
    if (!name && !url && !mid) {
      continue;
    }
    const key = mid
      ? `mid::${mid}`
      : url
        ? `url::${url}`
        : `name::${name}`;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ name, url, mid });
  }
  return result;
}

function cardsFromOutgoingEdges(state, outgoingEdges, statesById) {
  const cards = [];
  for (const edge of outgoingEdges ?? []) {
    const triggerKind = edge?.trigger?.kind ?? null;
    const semanticRole = edge?.trigger?.semanticRole ?? null;
    if (!['content-link', 'safe-nav-link'].includes(triggerKind) && semanticRole !== 'content') {
      continue;
    }
    const targetState = statesById.get(edge.toState ?? edge.observedStateId) ?? null;
    const url = normalizeUrlNoFragment(edge?.trigger?.href ?? targetState?.finalUrl);
    const title = firstNonEmpty([
      targetState?.pageFacts?.contentTitle,
      targetState?.pageFacts?.bookTitle,
      edge?.trigger?.label,
      targetState?.title,
    ]);
    cards.push({
      title,
      url,
      bvid: firstNonEmpty([
        targetState?.pageFacts?.bvid,
        targetState?.pageFacts?.bv,
        extractBilibiliVideoCode(url),
      ]),
      authorMid: firstNonEmpty([
        targetState?.pageFacts?.authorMid,
        extractBilibiliAuthorMid(targetState?.pageFacts?.authorUrl),
      ]),
      contentType: firstNonEmpty([
        targetState?.pageFacts?.contentType,
        deriveContentTypeFromUrl(url),
      ]),
    });
  }
  return cards;
}

function cardsFromPageFacts(pageFacts) {
  const cards = [];
  for (const entry of toArray(pageFacts?.featuredContentCards)) {
    cards.push({
      title: entry?.title,
      url: entry?.url,
      bvid: entry?.bvid,
      authorMid: entry?.authorMid,
      contentType: entry?.contentType,
    });
  }
  for (const entry of toArray(pageFacts?.resultEntries)) {
    cards.push({
      title: entry?.title,
      url: entry?.url,
      bvid: entry?.bvid,
      authorMid: entry?.authorMid,
      contentType: entry?.contentType,
    });
  }
  const titles = toArray(pageFacts?.featuredContentTitles);
  const urls = toArray(pageFacts?.featuredContentUrls);
  const bvids = toArray(pageFacts?.featuredContentBvids);
  const mids = toArray(pageFacts?.featuredContentAuthorMids);
  const types = toArray(pageFacts?.featuredContentTypes);
  const length = Math.max(titles.length, urls.length, bvids.length, mids.length, types.length);
  for (let index = 0; index < length; index += 1) {
    cards.push({
      title: titles[index],
      url: urls[index],
      bvid: bvids[index],
      authorMid: mids[index],
      contentType: types[index],
    });
  }
  return cards;
}

function authorsFromPageFacts(pageFacts) {
  const explicitCards = toArray(pageFacts?.featuredAuthorCards)
    .map((author) => ({
      name: author?.name,
      url: author?.url,
      mid: author?.mid,
    }))
    .filter((author) => author.name || author.url || author.mid);
  if (explicitCards.length > 0) {
    return explicitCards;
  }
  const explicitAuthors = toArray(pageFacts?.featuredAuthors)
    .map((author) => ({
      name: author?.name,
      url: author?.url,
      mid: author?.mid,
    }))
    .filter((author) => author.name || author.url || author.mid);
  if (explicitAuthors.length > 0) {
    return explicitAuthors;
  }
  const names = toArray(pageFacts?.featuredAuthorNames);
  const urls = toArray(pageFacts?.featuredAuthorUrls);
  const mids = toArray(pageFacts?.featuredAuthorMids);
  const length = Math.max(names.length, urls.length, mids.length);
  const authors = [];
  for (let index = 0; index < length; index += 1) {
    authors.push({
      name: names[index],
      url: urls[index],
      mid: mids[index],
    });
  }
  return authors;
}

export function enrichBilibiliPageFactsForState(state, context = {}) {
  const finalUrl = state?.finalUrl ?? null;
  const rawPageFacts = state?.pageFacts ?? null;
  if (!rawPageFacts && !isBilibiliUrl(finalUrl)) {
    return rawPageFacts;
  }

  const outgoingEdges = context.outgoingEdges ?? [];
  const statesById = context.statesById ?? new Map();
  const pageFacts = {
    ...(rawPageFacts ?? {}),
  };

  const bvid = firstNonEmpty([
    pageFacts.bvid,
    pageFacts.bv,
    extractBilibiliVideoCode(finalUrl),
    extractBilibiliVideoCode(pageFacts.firstResultUrl),
  ]);
  if (bvid) {
    pageFacts.bvid = bvid;
    pageFacts.bv = bvid;
  }

  const authorMid = firstNonEmpty([
    pageFacts.authorMid,
    extractBilibiliAuthorMid(finalUrl),
    extractBilibiliAuthorMid(pageFacts.authorUrl),
  ]);
  if (authorMid) {
    pageFacts.authorMid = authorMid;
  }

  const authorName = firstNonEmpty([
    pageFacts.authorName,
    normalizeBilibiliAuthorName(state?.title),
  ]);
  if (authorName) {
    pageFacts.authorName = authorName;
  }

  const queryText = firstNonEmpty([
    pageFacts.queryText,
    deriveQueryTextFromUrl(finalUrl),
    state?.trigger?.queryText,
  ]);
  if (queryText) {
    pageFacts.queryText = queryText;
  }

  const searchFamily = firstNonEmpty([
    pageFacts.searchFamily,
    pageFacts.searchSection,
    inferBilibiliSearchFamily(finalUrl),
  ]);
  if (searchFamily) {
    pageFacts.searchFamily = searchFamily;
  }

  const contentTitle = firstNonEmpty([
    pageFacts.contentTitle,
    pageFacts.bookTitle,
  ]);
  if (contentTitle) {
    pageFacts.contentTitle = contentTitle;
  }

  const featuredContentCards = dedupeCards([
    ...cardsFromPageFacts(pageFacts),
    ...cardsFromOutgoingEdges(state, outgoingEdges, statesById),
  ]);
  if (featuredContentCards.length > 0) {
    pageFacts.featuredContentCards = featuredContentCards;
    pageFacts.featuredContentCount = featuredContentCards.length;
    pageFacts.featuredContentTitles = featuredContentCards.map((card) => card.title).filter(Boolean);
    pageFacts.featuredContentBvids = featuredContentCards.map((card) => card.bvid).filter(Boolean);
    pageFacts.featuredContentAuthorMids = featuredContentCards.map((card) => card.authorMid).filter(Boolean);
    pageFacts.featuredContentTypes = featuredContentCards.map((card) => card.contentType).filter(Boolean);
  }

  const featuredAuthors = dedupeAuthors(authorsFromPageFacts(pageFacts));
  if (featuredAuthors.length > 0) {
    pageFacts.featuredAuthorCards = featuredAuthors.map((author) => ({
      ...author,
      authorSubpage: pageFacts.authorSubpage ?? null,
      cardKind: 'author',
    }));
    pageFacts.featuredAuthors = featuredAuthors;
    pageFacts.featuredAuthorCount = featuredAuthors.length;
    pageFacts.featuredAuthorNames = featuredAuthors.map((author) => author.name).filter(Boolean);
    pageFacts.featuredAuthorUrls = featuredAuthors.map((author) => author.url).filter(Boolean);
    pageFacts.featuredAuthorMids = featuredAuthors.map((author) => author.mid).filter(Boolean);
  }

  if (['dynamic', 'follow', 'fans'].includes(normalizeDisplayText(pageFacts.authorSubpage)?.toLowerCase() ?? '')) {
    pageFacts.authenticatedReadOnlySurface = true;
  }

  return pageFacts;
}

export function summarizeBilibiliKnowledgeFacts(states) {
  const normalizedStates = toArray(states);
  const pageFactsList = normalizedStates.map((state) => state?.pageFacts ?? null).filter(Boolean);
  const videoCodes = uniqueSortedStrings(pageFactsList.flatMap((pageFacts) => [
    pageFacts.bvid,
    pageFacts.bv,
    ...toArray(pageFacts.featuredContentBvids),
  ]).filter(Boolean));
  const authorMids = uniqueSortedStrings(pageFactsList.flatMap((pageFacts) => [
    pageFacts.authorMid,
    ...toArray(pageFacts.featuredAuthorMids),
    ...toArray(pageFacts.featuredContentAuthorMids),
  ]).filter(Boolean));
  const searchFamilies = uniqueSortedStrings(pageFactsList.map((pageFacts) => pageFacts.searchFamily).filter(Boolean));
  const featuredContentCards = dedupeCards(pageFactsList.flatMap((pageFacts) => toArray(pageFacts.featuredContentCards)));
  const featuredAuthors = dedupeAuthors(pageFactsList.flatMap((pageFacts) => toArray(pageFacts.featuredAuthors)));
  const authenticatedSurfaceKinds = uniqueSortedStrings(pageFactsList
    .filter((pageFacts) => pageFacts.authenticatedReadOnlySurface)
    .map((pageFacts) => normalizeDisplayText(pageFacts.authorSubpage))
    .filter(Boolean));
  const authenticatedSessionObserved = pageFactsList.some((pageFacts) => (
    pageFacts.authenticatedReadOnlySurface
      && (pageFacts.loginStateDetected === true
        || pageFacts.identityConfirmed === true
        || pageFacts.authenticatedSessionConfirmed === true)
  ));
  const authenticatedSurfaceSummaries = normalizedStates
    .filter((state) => state?.pageFacts?.authenticatedReadOnlySurface)
    .map((state) => ({
      authorSubpage: normalizeDisplayText(state.pageFacts?.authorSubpage),
      featuredAuthorCount: Number(state.pageFacts?.featuredAuthorCount ?? 0),
      featuredContentCount: Number(state.pageFacts?.featuredContentCount ?? 0),
      antiCrawlSignals: uniqueSortedStrings(toArray(state.pageFacts?.antiCrawlSignals).filter(Boolean)),
      finalUrl: normalizeUrlNoFragment(state.finalUrl),
      stateId: state.state_id ?? state.stateId ?? null,
    }));
  return {
    videoCodes,
    authorMids,
    searchFamilies,
    featuredContentCards,
    featuredAuthors,
    authenticatedSurfaceKinds,
    authenticatedSessionObserved,
    authenticatedSurfaceSummaries,
  };
}
