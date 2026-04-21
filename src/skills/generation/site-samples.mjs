// @ts-check

import { cleanText, firstNonEmpty, toArray, uniqueSortedStrings } from '../../shared/normalize.mjs';
import { isContentDetailPageType } from '../../sites/core/page-types.mjs';
import { normalizeDisplayLabel } from '../../sites/core/terminology.mjs';

const JABLE_MODEL_ID_REGEX = /^[^0-9a-f]*[0-9a-f]{16,}$/iu;

export function pickRecordText(record, candidateKeys) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  for (const key of candidateKeys) {
    const value = key.split('.').reduce((current, part) => current?.[part], record);
    const text = firstNonEmpty([value]);
    if (text) {
      return text;
    }
  }
  return null;
}

export function collectNamedSamples(records, candidateKeys, limit = 6) {
  const values = [];
  for (const record of toArray(records)) {
    const text = pickRecordText(record, candidateKeys);
    if (text) {
      values.push(text);
    }
  }
  return uniqueSortedStrings(values).slice(0, limit);
}

export function collectSearchQueries(records, limit = 6) {
  const values = [];
  for (const record of toArray(records)) {
    const text = pickRecordText(record, ['queryText', 'query', 'keyword', 'title', 'name']);
    if (text) {
      values.push(text);
    }
  }
  return uniqueSortedStrings(values).slice(0, limit);
}

export function collectStateDisplayTitles(context, pageTypes, limit = 8) {
  const allowedPageTypes = new Set(toArray(pageTypes));
  const values = [];
  for (const state of toArray(context.statesDocument?.states)) {
    const statePageType = String(state?.pageType ?? '');
    const matchesAllowedPageType = allowedPageTypes.has(statePageType)
      || (allowedPageTypes.has('content-detail-page') && isContentDetailPageType(statePageType))
      || (allowedPageTypes.has('book-detail-page') && statePageType === 'content-detail-page');
    if (!matchesAllowedPageType) {
      continue;
    }
    const normalized = normalizeDisplayLabel(state?.title, {
      siteContext: context.siteContext,
      inputUrl: context.url,
      url: state?.finalUrl,
      pageType: state?.pageType,
      queryText: state?.pageFacts?.queryText,
    });
    if (normalized) {
      values.push(normalized);
    }
  }
  return uniqueSortedStrings(values).slice(0, limit);
}

export function collectIntentTargetLabels(context, intentTypes, limit = 8) {
  const allowed = new Set(toArray(intentTypes));
  const values = [];
  for (const intent of toArray(context.intentsDocument?.intents)) {
    if (!allowed.has(intent.intentType)) {
      continue;
    }
    for (const candidate of toArray(intent.targetDomain?.actionableValues)) {
      if (candidate?.label) {
        values.push(candidate.label);
      }
    }
    for (const candidate of toArray(intent.targetDomain?.candidateValues)) {
      if (candidate?.label) {
        values.push(candidate.label);
      }
    }
  }
  return uniqueSortedStrings(values.map((value) => normalizeDisplayLabel(value, {
    siteContext: context.siteContext,
    inputUrl: context.url,
  }) || cleanText(value))).slice(0, limit);
}

export function getIntentTypes(context) {
  return new Set(toArray(context.intentsDocument?.intents).map((intent) => intent.intentType));
}

function normalizeDouyinSubpage(value) {
  const normalized = cleanText(value);
  if (!normalized) {
    return null;
  }
  switch (normalized) {
    case 'favorite':
      return 'collect';
    case 'record':
    case 'watch_history':
      return 'history';
    default:
      return normalized;
  }
}

export function collectDouyinSamples(context) {
  const validationSamples = {
    ...(context.siteProfileDocument?.validationSamples ?? {}),
    ...(context.siteProfileDocument?.authValidationSamples ?? {}),
    ...(context.liveSiteProfileDocument?.validationSamples ?? {}),
    ...(context.liveSiteProfileDocument?.authValidationSamples ?? {}),
  };
  const states = toArray(context.statesDocument?.states);
  const videos = uniqueSortedStrings([
    ...collectIntentTargetLabels(context, ['open-video', 'open-book', 'open-work'], 12),
    ...collectStateDisplayTitles(context, ['content-detail-page', 'book-detail-page'], 12),
  ]).slice(0, 10);
  const users = uniqueSortedStrings([
    ...collectIntentTargetLabels(context, ['open-author', 'open-up', 'open-model', 'open-actress'], 12),
    ...collectStateDisplayTitles(context, ['author-page'], 12),
    cleanText(validationSamples.authorUrl),
  ]).filter(Boolean).slice(0, 10);
  const defaultQueries = toArray(context.siteProfileDocument?.search?.defaultQueries)
    .map((item) => cleanText(item))
    .filter(Boolean);
  const searchQueries = uniqueSortedStrings([
    cleanText(validationSamples.videoSearchQuery),
    ...defaultQueries,
    ...collectSearchQueries(context.searchResultsDocument, 10),
    ...collectIntentTargetLabels(context, ['search-video', 'search-book', 'search-work'], 10),
    ...states
      .map((state) => cleanText(state?.pageFacts?.queryText))
      .filter(Boolean),
  ]).slice(0, 10);
  const categoryEntries = uniqueSortedStrings([
    ...collectIntentTargetLabels(context, ['open-category'], 12),
    ...collectStateDisplayTitles(context, ['category-page'], 12),
    ...states
      .map((state) => cleanText(state?.pageFacts?.categoryPath ?? state?.pageFacts?.categoryName))
      .filter(Boolean),
  ]).slice(0, 12);
  const publicAuthorSubpages = uniqueSortedStrings(states
    .filter((state) => String(state?.pageType ?? '') === 'author-page')
    .map((state) => normalizeDouyinSubpage(state?.pageFacts?.authorSubpage))
    .filter(Boolean))
    .slice(0, 8);
  const authenticatedSubpages = uniqueSortedStrings(states
    .filter((state) => String(state?.pageType ?? '') === 'author-list-page')
    .map((state) => normalizeDouyinSubpage(state?.pageFacts?.authorSubpage))
    .filter(Boolean))
    .slice(0, 8);
  return {
    videos,
    users,
    searchQueries,
    categoryEntries,
    publicAuthorSubpages,
    authenticatedSubpages,
  };
}

export function collectMoodyzSamples(context) {
  const works = collectIntentTargetLabels(context, ['open-work', 'open-book'], 8);
  const actresses = collectIntentTargetLabels(context, ['open-actress', 'open-author'], 8);
  const searchQueries = uniqueSortedStrings([
    ...collectIntentTargetLabels(context, ['search-work', 'search-book'], 8),
    ...collectSearchQueries(context.searchResultsDocument, 8),
  ]).slice(0, 8);
  return {
    works,
    actresses,
    searchQueries,
  };
}

export function collectJableSamples(context) {
  const taxonomyGroups = collectJableCategoryTaxonomy(context);
  const videos = uniqueSortedStrings([
    ...collectIntentTargetLabels(context, ['open-video', 'open-book', 'open-work'], 10),
    ...collectStateDisplayTitles(context, ['book-detail-page'], 12),
  ]).slice(0, 10);
  const models = uniqueSortedStrings([
    ...collectIntentTargetLabels(context, ['open-model', 'open-author', 'open-actress'], 20),
    ...collectStateDisplayTitles(context, ['author-page'], 20),
  ]).filter((value) => value && value !== '婕斿憳鍒楄〃' && !JABLE_MODEL_ID_REGEX.test(value)).slice(0, 10);
  const categories = uniqueSortedStrings([
    ...taxonomyGroups.flatMap((group) => group.tags),
    ...collectIntentTargetLabels(context, ['open-category'], 10),
    ...collectStateDisplayTitles(context, ['category-page', 'author-list-page'], 10),
  ]).filter(Boolean).slice(0, 16);
  const defaultQueries = toArray(context.siteProfileDocument?.search?.defaultQueries)
    .map((item) => cleanText(item))
    .filter(Boolean);
  const searchQueries = uniqueSortedStrings([
    ...defaultQueries,
    ...collectIntentTargetLabels(context, ['search-video', 'search-book', 'search-work'], 10),
    ...collectSearchQueries(context.searchResultsDocument, 10),
  ]).slice(0, 10);
  return {
    videos,
    models,
    categories,
    categoryGroups: taxonomyGroups,
    searchQueries,
  };
}

export function collectBilibiliSamples(context) {
  const validationSamples = {
    ...(context.siteProfileDocument?.validationSamples ?? {}),
    ...(context.liveSiteProfileDocument?.validationSamples ?? {}),
  };
  const categoryPathPrefixes = uniqueSortedStrings([
    ...toArray(context.siteProfileDocument?.navigation?.categoryPathPrefixes),
    ...toArray(context.siteProfileDocument?.pageTypes?.categoryPrefixes),
    ...toArray(context.liveSiteProfileDocument?.navigation?.categoryPathPrefixes),
    ...toArray(context.liveSiteProfileDocument?.pageTypes?.categoryPrefixes),
  ]);
  const states = toArray(context.statesDocument?.states);
  const detailUrls = states
    .map((state) => cleanText(state?.finalUrl))
    .filter(Boolean);
  const videoCodes = uniqueOrderedStrings([
    bilibiliBvidFromValue(validationSamples.videoDetailUrl),
    bilibiliBvidFromValue(validationSamples.videoSearchQuery),
    ...toArray(context.siteProfileDocument?.search?.defaultQueries).map(bilibiliBvidFromValue),
    ...collectIntentTargetLabels(context, ['open-video', 'open-book', 'open-work'], 10).map(bilibiliBvidFromValue),
    ...detailUrls.map(bilibiliBvidFromValue),
    ...states.map((state) => bilibiliBvidFromValue(state?.pageFacts?.bvid)),
  ]).slice(0, 8);
  const videoTitles = uniqueSortedStrings([
    ...collectIntentTargetLabels(context, ['open-video', 'open-book', 'open-work'], 10),
    ...collectStateDisplayTitles(context, ['book-detail-page', 'content-detail-page'], 12),
  ]).filter(Boolean).slice(0, 8);
  const videos = (videoCodes.length ? videoCodes : videoTitles).slice(0, 8);
  const upProfileIds = uniqueOrderedStrings([
    formatBilibiliUpSample(validationSamples.authorUrl),
    formatBilibiliUpSample(validationSamples.authorVideosUrl),
    ...collectIntentTargetLabels(context, ['open-author', 'open-up', 'open-model', 'open-actress'], 10).map(formatBilibiliUpSample),
    ...states.map((state) => formatBilibiliUpSample(state?.pageFacts?.authorUrl)),
    ...states.map((state) => formatBilibiliUpSample(state?.pageFacts?.authorMid)),
    ...detailUrls.map(formatBilibiliUpSample),
  ]).slice(0, 8);
  const upProfileTitles = uniqueSortedStrings([
    ...collectIntentTargetLabels(context, ['open-author', 'open-up', 'open-model', 'open-actress'], 10),
    ...collectStateDisplayTitles(context, ['author-page'], 12),
  ]).filter(Boolean).slice(0, 8);
  const upProfiles = (upProfileIds.length ? upProfileIds : upProfileTitles).slice(0, 8);
  const defaultQueries = toArray(context.siteProfileDocument?.search?.defaultQueries)
    .map((item) => cleanText(item))
    .filter(Boolean);
  const searchQueries = uniqueOrderedStrings([
    cleanText(validationSamples.videoSearchQuery),
    ...defaultQueries,
    ...collectIntentTargetLabels(context, ['search-video', 'search-book', 'search-work'], 10)
      .map((value) => (bilibiliBvidFromValue(value) ? cleanText(value) : null)),
  ]).slice(0, 4);
  const categoryEntries = uniqueSortedStrings([
    ...categoryPathPrefixes.map(formatBilibiliCategoryPrefix),
  ]).filter(Boolean);
  const allowedHosts = uniqueSortedStrings([
    ...toArray(context.siteProfileDocument?.navigation?.allowedHosts),
    ...toArray(context.siteContext?.profile?.navigation?.allowedHosts),
  ]);
  const bangumiEntries = uniqueSortedStrings([
    cleanText(validationSamples.bangumiDetailUrl),
    ...states
      .filter((state) => String(state?.pageFacts?.contentType ?? '') === 'bangumi' || String(state?.finalUrl ?? '').includes('/bangumi/play/'))
      .map((state) => cleanText(state?.finalUrl)),
  ]).filter(Boolean).slice(0, 4);
  const authorSubpages = uniqueSortedStrings([
    cleanText(validationSamples.authorVideosUrl),
    ...states
      .map((state) => cleanText(state?.finalUrl))
      .filter((value) => /space\.bilibili\.com\/\d+\/video/iu.test(String(value || ''))),
  ]).filter(Boolean).slice(0, 4);
  const validatedCategoryUrls = uniqueSortedStrings([
    cleanText(validationSamples.categoryPopularUrl),
    cleanText(validationSamples.categoryAnimeUrl),
  ]).filter(Boolean).slice(0, 6);
  return {
    videos,
    upProfiles,
    searchQueries,
    categoryEntries: (categoryEntries.length ? categoryEntries : [
      '鐑棬 (/v/popular/)',
      '鐣墽 (/anime/)',
      '鐢靛奖 (/movie/)',
      '鍥藉垱 (/guochuang/)',
    ]).slice(0, 8),
    allowedHosts: (allowedHosts.length ? allowedHosts : [
      'www.bilibili.com',
      'search.bilibili.com',
      'space.bilibili.com',
    ]).slice(0, 8),
    bangumiEntries,
    authorSubpages,
    validatedCategoryUrls,
  };
}

export function collect22biquKnownBooks() {
  return ['\u7384\u9274\u4ed9\u65cf'];
}

export function collect22biquKnownAuthors() {
  return ['\u5b63\u8d8a\u4eba'];
}

export function collect22biquCategoryLabels() {
  return [
    '\u7384\u5e7b\u5c0f\u8bf4',
    '\u6b66\u4fa0\u5c0f\u8bf4',
    '\u90fd\u5e02\u5c0f\u8bf4',
    '\u5386\u53f2\u5c0f\u8bf4',
  ];
}

export function collect22biquUtilityLabels() {
  return ['\u9605\u8bfb\u8bb0\u5f55'];
}

export function collect22biquAuthLabels() {
  return ['\u7528\u6237\u767b\u5f55', '\u7528\u6237\u6ce8\u518c'];
}

function collectJableCategoryTaxonomy(context) {
  const groupMap = new Map();
  for (const state of toArray(context.statesDocument?.states)) {
    for (const group of toArray(state.pageFacts?.categoryTaxonomy)) {
      const groupLabel = cleanText(group.groupLabel);
      if (!groupLabel) {
        continue;
      }
      const entry = groupMap.get(groupLabel) ?? { groupLabel, tags: [] };
      for (const tag of toArray(group.tags)) {
        const tagLabel = cleanText(tag.label);
        if (!tagLabel || entry.tags.includes(tagLabel)) {
          continue;
        }
        entry.tags.push(tagLabel);
      }
      groupMap.set(groupLabel, entry);
    }
  }
  return [...groupMap.values()]
    .map((entry) => ({ groupLabel: entry.groupLabel, tags: uniqueSortedStrings(entry.tags) }))
    .sort((left, right) => String(left.groupLabel).localeCompare(String(right.groupLabel), 'zh-Hans-CN'));
}

function formatBilibiliCategoryPrefix(prefix) {
  const value = cleanText(prefix);
  switch (value) {
    case '/v/popular/':
      return '鐑棬 (/v/popular/)';
    case '/anime/':
      return '鐣墽 (/anime/)';
    case '/movie/':
      return '鐢靛奖 (/movie/)';
    case '/guochuang/':
      return '鍥藉垱 (/guochuang/)';
    case '/tv/':
      return '鐢佃鍓?(/tv/)';
    case '/variety/':
      return '缁艰壓 (/variety/)';
    case '/documentary/':
      return '绾綍鐗?(/documentary/)';
    case '/c/':
      return '鍒嗗尯绱㈠紩 (/c/)';
    default:
      return value;
  }
}

function uniqueOrderedStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values ?? []) {
    const normalized = cleanText(value);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function bilibiliBvidFromValue(value) {
  const raw = cleanText(value);
  if (!raw) {
    return null;
  }
  const matched = raw.match(/\b(BV[0-9A-Za-z]{10,})\b/u)
    || raw.match(/\/video\/(BV[0-9A-Za-z]{10,})/iu);
  return cleanText(matched?.[1]);
}

function bilibiliMidFromValue(value) {
  const raw = cleanText(value);
  if (!raw) {
    return null;
  }
  const matched = raw.match(/space\.bilibili\.com\/(\d+)/iu)
    || raw.match(/(?:^|\/)(\d{6,})(?:\/video)?$/u);
  return cleanText(matched?.[1]);
}

function formatBilibiliUpSample(value) {
  const mid = bilibiliMidFromValue(value);
  return mid ? `UP ${mid}` : null;
}
