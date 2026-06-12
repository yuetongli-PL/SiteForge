// @ts-check

import {
  assertNoExecutionSensitiveMaterial,
} from '../../../domain/policies/execution/index.mjs';
import {
  inferRuntimeCapabilityKind,
} from '../provider-registry.mjs';

const WEIBO_READONLY_PROVIDER_ID = 'weibo_readonly_provider';
const WEIBO_SEARCH_URL = 'https://s.weibo.com/weibo';
const WEIBO_ORIGIN = 'https://weibo.com';
const WEIBO_HOT_SEARCH_URL = 'https://weibo.com/ajax/side/hotSearch';
const WEIBO_HOT_BAND_URL = 'https://weibo.com/ajax/statuses/hot_band';
const WEIBO_HOT_TIMELINE_URL = 'https://weibo.com/ajax/feed/hottimeline';
const WEIBO_FOLLOWED_USERS_URL = 'https://weibo.com/ajax/friendships/friends';
const WEIBO_USER_POSTS_URL = 'https://weibo.com/ajax/statuses/mymblog';
const WEIBO_USER_ALBUMS_URL = 'https://photo.weibo.com/photos/get_all';
const WEIBO_USER_AUDIO_URL = 'https://weibo.com/ajax/profile/getAudioList';
const WEIBO_HOT_RANK_SPLIT_MODES = Object.freeze([
  Object.freeze({
    mode: 'day-before-yesterday',
    capabilityId: 'weibo.hot-rank-day-before-yesterday',
    params: Object.freeze({ ranking_type: 'day-before-yesterday' }),
    pathTemplate: '/ajax/feed/hottimeline?group_id=102803&containerid=102803&count=10&ranking_type=day-before-yesterday',
    outcome: 'weibo_hot_rank_day_before_yesterday_api_read_completed',
    runtimeMode: 'weibo_hot_rank_day_before_yesterday_api_read_v1',
    patterns: Object.freeze([
      /\bhot-rank-day-before-yesterday\b/u,
      /\bday-before-yesterday\b/u,
      /\bday\s+before\s+yesterday\b/u,
      /\bprevious\s+day\s+hot\s+rank\b/u,
      /\branking_type=day-before-yesterday\b/u,
    ]),
  }),
  Object.freeze({
    mode: 'yesterday',
    capabilityId: 'weibo.hot-rank-yesterday',
    params: Object.freeze({ ranking_type: 'yesterday' }),
    pathTemplate: '/ajax/feed/hottimeline?group_id=102803&containerid=102803&count=10&ranking_type=yesterday',
    outcome: 'weibo_hot_rank_yesterday_api_read_completed',
    runtimeMode: 'weibo_hot_rank_yesterday_api_read_v1',
    patterns: Object.freeze([
      /\bhot-rank-yesterday\b/u,
      /\byesterday\s+hot\s+rank\b/u,
      /\branking_type=yesterday\b/u,
    ]),
  }),
  Object.freeze({
    mode: 'week',
    capabilityId: 'weibo.hot-rank-week',
    params: Object.freeze({ ranking_type: 'week' }),
    pathTemplate: '/ajax/feed/hottimeline?group_id=102803&containerid=102803&count=10&ranking_type=week',
    outcome: 'weibo_hot_rank_week_api_read_completed',
    runtimeMode: 'weibo_hot_rank_week_api_read_v1',
    patterns: Object.freeze([
      /\bhot-rank-week\b/u,
      /\bweekly?\s+hot\s+rank\b/u,
      /\bweek\s+hot\s+rank\b/u,
      /\branking_type=week\b/u,
    ]),
  }),
  Object.freeze({
    mode: 'female',
    capabilityId: 'weibo.hot-rank-female',
    params: Object.freeze({ gender: 'female' }),
    pathTemplate: '/ajax/feed/hottimeline?group_id=102803&containerid=102803&count=10&gender=female',
    outcome: 'weibo_hot_rank_female_api_read_completed',
    runtimeMode: 'weibo_hot_rank_female_api_read_v1',
    patterns: Object.freeze([
      /\bhot-rank-female\b/u,
      /\bfemale\s+hot\s+rank\b/u,
      /\bgender=female\b/u,
    ]),
  }),
  Object.freeze({
    mode: 'male',
    capabilityId: 'weibo.hot-rank-male',
    params: Object.freeze({ gender: 'male' }),
    pathTemplate: '/ajax/feed/hottimeline?group_id=102803&containerid=102803&count=10&gender=male',
    outcome: 'weibo_hot_rank_male_api_read_completed',
    runtimeMode: 'weibo_hot_rank_male_api_read_v1',
    patterns: Object.freeze([
      /\bhot-rank-male\b/u,
      /\bmale\s+hot\s+rank\b/u,
      /\bgender=male\b/u,
    ]),
  }),
]);
const READ_KINDS = Object.freeze(new Set(['api', 'read', 'query', 'search', 'navigate', 'public_http']));
const BLOCKED_PATTERN = /\b(?:delete|destroy|clear|reset|cancel|revoke|pay|payment|purchase|checkout|billing|download|export|write|submit|update|create|publish|follow|unfollow|like|repost|send|upload)\b/iu;

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeKind(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

function descriptorKind(descriptor = {}) {
  const kind = inferRuntimeCapabilityKind(descriptor);
  if (kind !== 'generic') return kind;
  for (const value of [
    descriptor.runtimeContext?.capabilityKind,
    descriptor.runtimeContext?.operationKind,
    descriptor.runtimeContext?.runtimeBindingKind,
    descriptor.executionContract?.capabilityKind,
    descriptor.executionContract?.operationKind,
    descriptor.executionContract?.runtimeBinding?.kind,
  ]) {
    const direct = normalizeKind(value);
    if (direct) return direct;
  }
  return kind;
}

function descriptorText(descriptor = {}) {
  return [
    descriptor.invocationRequest?.capabilityId,
    descriptor.executionContract?.capabilityId,
    descriptor.executionContract?.operationKind,
    descriptor.executionContract?.contractKind,
    descriptor.executionContract?.runtimeBinding?.kind,
    descriptor.capability?.id,
    descriptor.capability?.name,
    descriptor.capability?.action,
  ].map((value) => String(value ?? '')).join(' ');
}

function isWeiboSearchDescriptor(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  const siteKey = normalizeText(descriptor.runtimeContext?.siteKey).toLowerCase();
  const siteHost = normalizeText(descriptor.runtimeContext?.siteHost).toLowerCase();
  const weiboSite = siteKey === 'weibo'
    || siteHost === 'weibo.com'
    || siteHost.endsWith('.weibo.com')
    || text.includes('weibo.com');
  return weiboSite
    && (text.includes('search-posts') || /\bsearch\b/u.test(text))
    && !BLOCKED_PATTERN.test(text);
}

function isWeiboFollowedUsersDescriptor(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  const siteKey = normalizeText(descriptor.runtimeContext?.siteKey).toLowerCase();
  const siteHost = normalizeText(descriptor.runtimeContext?.siteHost).toLowerCase();
  const weiboSite = siteKey === 'weibo'
    || siteHost === 'weibo.com'
    || siteHost.endsWith('.weibo.com')
    || text.includes('weibo.com');
  return weiboSite
    && /\b(?:list|read|show)\b/u.test(text)
    && /\b(?:followed-users|followed\s+users|following\s+(?:accounts|list)|who\s+do\s+i\s+follow)\b/u.test(text)
    && !BLOCKED_PATTERN.test(text);
}

function isWeiboHotSearchDescriptor(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  const siteKey = normalizeText(descriptor.runtimeContext?.siteKey).toLowerCase();
  const siteHost = normalizeText(descriptor.runtimeContext?.siteHost).toLowerCase();
  const weiboSite = siteKey === 'weibo'
    || siteHost === 'weibo.com'
    || siteHost.endsWith('.weibo.com')
    || text.includes('weibo.com');
  return weiboSite
    && (text.includes('hot-search') || /\bhot\s+search(?:es)?\b/u.test(text))
    && !BLOCKED_PATTERN.test(text);
}

function isWeiboHotRankHourDescriptor(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  const siteKey = normalizeText(descriptor.runtimeContext?.siteKey).toLowerCase();
  const siteHost = normalizeText(descriptor.runtimeContext?.siteHost).toLowerCase();
  const weiboSite = siteKey === 'weibo'
    || siteHost === 'weibo.com'
    || siteHost.endsWith('.weibo.com')
    || text.includes('weibo.com');
  return weiboSite
    && (text.includes('hot-rank-hour') || /\bhourly\s+hot\s+rank\b/u.test(text) || text.includes('hot_band'))
    && !BLOCKED_PATTERN.test(text);
}

function isWeiboHotTimelineDescriptor(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  const siteKey = normalizeText(descriptor.runtimeContext?.siteKey).toLowerCase();
  const siteHost = normalizeText(descriptor.runtimeContext?.siteHost).toLowerCase();
  const weiboSite = siteKey === 'weibo'
    || siteHost === 'weibo.com'
    || siteHost.endsWith('.weibo.com')
    || text.includes('weibo.com');
  return weiboSite
    && (text.includes('hot-timeline') || text.includes('hottimeline') || /\b(?:hot|popular)\s+(?:weibo\s+)?(?:timeline|posts?)\b/u.test(text))
    && !BLOCKED_PATTERN.test(text);
}

function weiboHotRankSplitMode(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  const siteKey = normalizeText(descriptor.runtimeContext?.siteKey).toLowerCase();
  const siteHost = normalizeText(descriptor.runtimeContext?.siteHost).toLowerCase();
  const weiboSite = siteKey === 'weibo'
    || siteHost === 'weibo.com'
    || siteHost.endsWith('.weibo.com')
    || text.includes('weibo.com');
  if (!weiboSite || BLOCKED_PATTERN.test(text)) return null;
  return WEIBO_HOT_RANK_SPLIT_MODES.find((entry) => entry.patterns.some((pattern) => pattern.test(text))) ?? null;
}

function isWeiboHotRankSplitDescriptor(descriptor = {}) {
  return Boolean(weiboHotRankSplitMode(descriptor));
}

function isWeiboUserPostsDescriptor(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  const siteKey = normalizeText(descriptor.runtimeContext?.siteKey).toLowerCase();
  const siteHost = normalizeText(descriptor.runtimeContext?.siteHost).toLowerCase();
  const weiboSite = siteKey === 'weibo'
    || siteHost === 'weibo.com'
    || siteHost.endsWith('.weibo.com')
    || text.includes('weibo.com');
  return weiboSite
    && (text.includes('user-posts') || /\bread\s+user\s+posts\b/u.test(text) || text.includes('mymblog'))
    && !text.includes('user-articles')
    && !text.includes('feature=7')
    && !BLOCKED_PATTERN.test(text);
}

function isWeiboUserArticlesDescriptor(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  const siteKey = normalizeText(descriptor.runtimeContext?.siteKey).toLowerCase();
  const siteHost = normalizeText(descriptor.runtimeContext?.siteHost).toLowerCase();
  const weiboSite = siteKey === 'weibo'
    || siteHost === 'weibo.com'
    || siteHost.endsWith('.weibo.com')
    || text.includes('weibo.com');
  return weiboSite
    && (text.includes('user-articles') || /\bread\s+user\s+articles\b/u.test(text) || text.includes('feature=7'))
    && !BLOCKED_PATTERN.test(text);
}

function isWeiboUserAlbumsDescriptor(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  const siteKey = normalizeText(descriptor.runtimeContext?.siteKey).toLowerCase();
  const siteHost = normalizeText(descriptor.runtimeContext?.siteHost).toLowerCase();
  const weiboSite = siteKey === 'weibo'
    || siteHost === 'weibo.com'
    || siteHost.endsWith('.weibo.com')
    || siteHost === 'photo.weibo.com'
    || text.includes('weibo.com');
  return weiboSite
    && (text.includes('user-albums') || text.includes('user-photos') || /\bread\s+user\s+(?:albums|photos)\b/u.test(text) || text.includes('photos/get_all'))
    && !BLOCKED_PATTERN.test(text);
}

function isWeiboUserVideosDescriptor(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  const siteKey = normalizeText(descriptor.runtimeContext?.siteKey).toLowerCase();
  const siteHost = normalizeText(descriptor.runtimeContext?.siteHost).toLowerCase();
  const weiboSite = siteKey === 'weibo'
    || siteHost === 'weibo.com'
    || siteHost.endsWith('.weibo.com')
    || text.includes('weibo.com');
  return weiboSite
    && (text.includes('user-videos') || /\bread\s+user\s+videos\b/u.test(text) || text.includes('feature=3'))
    && !BLOCKED_PATTERN.test(text);
}

function isWeiboUserAudioDescriptor(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  const siteKey = normalizeText(descriptor.runtimeContext?.siteKey).toLowerCase();
  const siteHost = normalizeText(descriptor.runtimeContext?.siteHost).toLowerCase();
  const weiboSite = siteKey === 'weibo'
    || siteHost === 'weibo.com'
    || siteHost.endsWith('.weibo.com')
    || text.includes('weibo.com');
  return weiboSite
    && (text.includes('user-audio') || /\bread\s+user\s+audio\b/u.test(text) || text.includes('getaudiolist') || text.includes('tabtype=audio'))
    && !BLOCKED_PATTERN.test(text);
}

function supportsWeiboReadonly(descriptor = {}) {
  const contract = descriptor.executionContract ?? {};
  const capability = descriptor.capability ?? {};
  if (
    contract.destructiveAction === true
    || contract.paymentOrFundsAction === true
    || capability.destructiveAction === true
    || capability.paymentOrFundsAction === true
  ) {
    return false;
  }
  return (
    isWeiboSearchDescriptor(descriptor)
    || isWeiboFollowedUsersDescriptor(descriptor)
    || isWeiboHotSearchDescriptor(descriptor)
    || isWeiboHotRankHourDescriptor(descriptor)
    || isWeiboHotRankSplitDescriptor(descriptor)
    || isWeiboHotTimelineDescriptor(descriptor)
    || isWeiboUserPostsDescriptor(descriptor)
    || isWeiboUserArticlesDescriptor(descriptor)
    || isWeiboUserAlbumsDescriptor(descriptor)
    || isWeiboUserVideosDescriptor(descriptor)
    || isWeiboUserAudioDescriptor(descriptor)
  )
    && READ_KINDS.has(descriptorKind(descriptor));
}

function runtimeSlotValues(runtimeContext = null) {
  const values = runtimeContext?.slotValues ?? runtimeContext?.fixtureSlotValues ?? null;
  return values && typeof values === 'object' && !Array.isArray(values) ? values : {};
}

function searchQueryFrom(options = {}) {
  const values = runtimeSlotValues(options.runtimeContext);
  return normalizeText(values.query ?? values.keyword ?? values.q);
}

function uidFrom(options = {}) {
  const values = runtimeSlotValues(options.runtimeContext);
  const uid = normalizeText(values.uid ?? values.profileUserId ?? values.userId ?? values.accountId);
  return /^\d{4,32}$/u.test(uid) ? uid : '';
}

function pageFrom(options = {}) {
  const values = runtimeSlotValues(options.runtimeContext);
  const page = Number(values.page ?? 1);
  return Number.isInteger(page) && page >= 1 && page <= 20 ? page : 1;
}

function cursorFrom(options = {}) {
  const values = runtimeSlotValues(options.runtimeContext);
  const cursor = normalizeText(values.cursor ?? 0);
  return /^\d{1,32}$/u.test(cursor) ? cursor : '0';
}

function hotTimelineUrl(extraParams = {}) {
  const url = new URL(WEIBO_HOT_TIMELINE_URL);
  url.searchParams.set('since_id', '0');
  url.searchParams.set('refresh', '0');
  url.searchParams.set('group_id', '102803');
  url.searchParams.set('containerid', '102803');
  url.searchParams.set('extparam', 'discover|new_feed');
  url.searchParams.set('max_id', '0');
  url.searchParams.set('count', '10');
  for (const [key, value] of Object.entries(extraParams)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function responseContentType(response = null) {
  try {
    return String(response?.headers?.get?.('content-type') ?? '').trim() || null;
  } catch {
    return null;
  }
}

function weiboAuthOrChallengeSignals(bodyText) {
  return [
    /\bpassport\.weibo\.com\b/iu,
    /\b(?:login|signin|captcha|verify|verification|challenge)\b/iu,
    /(?:请先登录|登录后|验证码|安全验证|访问异常|系统繁忙|身份验证)/u,
  ].filter((pattern) => pattern.test(String(bodyText ?? ''))).length;
}

function summarizeSearchHtml(text) {
  const bodyText = String(text ?? '');
  const cardMatches = bodyText.match(/\b(?:card-wrap|card-feed|search_feed|vue-recycle-scroller__item-view)\b/giu) ?? [];
  const emptyStatePresent = /\b(?:pl_noresult|noresult|not\s+found|暂无|没有找到|无结果)\b/iu.test(bodyText);
  const authOrChallengeSignals = weiboAuthOrChallengeSignals(bodyText);
  return {
    kind: 'html',
    byteLength: Buffer.byteLength(bodyText),
    resultContainerSignals: Math.min(cardMatches.length, 200),
    emptyStatePresent,
    authOrChallengeSignals,
    resultStateVerified: cardMatches.length > 0 || emptyStatePresent,
  };
}

function summarizeFollowedUsersHtml(text, uid) {
  const bodyText = String(text ?? '');
  const uidMatches = bodyText.match(/\buid=(\d{4,32})\b/giu) ?? [];
  const ids = [...new Set(uidMatches
    .map((value) => value.match(/\d{4,32}/u)?.[0])
    .filter(Boolean)
    .filter((value) => value !== uid))].slice(0, 200);
  const emptyStatePresent = /(?:暂无关注|还没有关注|没有关注|no\s+following|empty)/iu.test(bodyText);
  return {
    kind: 'html',
    byteLength: Buffer.byteLength(bodyText),
    followedUserIdCount: ids.length,
    followedUserIds: ids,
    emptyStatePresent,
    authOrChallengeSignals: weiboAuthOrChallengeSignals(bodyText),
    resultStateVerified: ids.length > 0 || emptyStatePresent,
  };
}

function valueAtPath(value, parts = []) {
  let current = value;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function compactSummaryText(value, maxLength = 120) {
  return normalizeText(value)
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/https?:\/\/\S+/giu, '[url]')
    .replace(/\b(?:t\.cn|weibo\.com|m\.weibo\.cn|photo\.weibo\.com)\/\S+/giu, '[url]')
    .replace(/[\u200b-\u200f\ufeff]+/gu, '')
    .replace(/\s+/gu, ' ')
    .slice(0, maxLength);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function summaryTextCandidate(value) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (!value || typeof value !== 'object') return '';
  return value.text
    ?? value.content
    ?? value.longTextContent
    ?? value.raw_text
    ?? value.value
    ?? '';
}

function hotItemSummary(item, index) {
  const source = item && typeof item === 'object' ? item : {};
  return {
    rank: numberOrNull(source.rank ?? source.realpos ?? source.star_word_rank ?? index + 1),
    label: compactSummaryText(
      summaryTextCandidate(source.note)
        || summaryTextCandidate(source.word)
        || summaryTextCandidate(source.word_scheme)
        || summaryTextCandidate(source.title)
        || summaryTextCandidate(source.name)
        || summaryTextCandidate(source.desc)
        || summaryTextCandidate(source.text_raw)
        || summaryTextCandidate(source.text),
      160,
    ),
    score: numberOrNull(source.num ?? source.raw_hot ?? source.hot_num ?? source.hot ?? source.read ?? source.discuss),
    category: compactSummaryText(source.category ?? source.channel_type ?? source.label_name ?? source.word_type, 40) || null,
  };
}

function summarizeHotApiJson(value, expectedPaths = []) {
  const matches = expectedPaths
    .map((parts) => {
      const candidate = valueAtPath(value, parts);
      return {
        path: parts.join('.'),
        items: Array.isArray(candidate) ? candidate : null,
      };
    })
    .filter((entry) => entry.items);
  const best = matches.reduce((current, entry) => {
    if (!current || entry.items.length > current.items.length) return entry;
    return current;
  }, null);
  const itemCount = best?.items?.length ?? 0;
  const items = (best?.items ?? [])
    .slice(0, 100)
    .map((item, index) => hotItemSummary(item, index))
    .filter((item) => item.label);
  return {
    kind: 'json',
    topLevelKeys: value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort().slice(0, 30) : [],
    matchedArrayPath: best?.path ?? null,
    itemCount,
    sampleCount: items.length,
    items,
    resultStateVerified: itemCount > 0,
  };
}

function summarizeFollowedUsersJson(value) {
  const users = Array.isArray(value?.users)
    ? value.users
    : Array.isArray(value?.data?.users)
      ? value.data.users
      : Array.isArray(value?.data?.list)
        ? value.data.list
        : [];
  const ids = [...new Set(users
    .map((user) => normalizeText(user?.idstr ?? user?.id ?? user?.uid))
    .filter((id) => /^\d{4,32}$/u.test(id)))].slice(0, 200);
  return {
    kind: 'json',
    matchedArrayPath: Array.isArray(value?.users) ? 'users' : Array.isArray(value?.data?.users) ? 'data.users' : Array.isArray(value?.data?.list) ? 'data.list' : null,
    followedUserIdCount: ids.length,
    followedUserIds: ids,
    totalNumber: numberOrNull(value?.total_number ?? value?.data?.total_number),
    nextCursor: numberOrNull(value?.next_cursor ?? value?.data?.next_cursor),
    emptyStatePresent: ids.length === 0 && (Number(value?.total_number ?? value?.data?.total_number ?? 0) === 0),
    authOrChallengeSignals: 0,
    resultStateVerified: ids.length > 0 || Number(value?.total_number ?? value?.data?.total_number ?? 0) === 0,
  };
}

function postItemSummary(item) {
  const source = item && typeof item === 'object' ? item : {};
  return {
    id: compactSummaryText(source.idstr ?? source.id ?? source.mid, 48) || null,
    createdAt: compactSummaryText(source.created_at ?? source.createdAt ?? source.time, 64) || null,
    textSummary: compactSummaryText(source.text_raw ?? source.text ?? source.content ?? '', 160) || null,
    reposts: numberOrNull(source.reposts_count ?? source.repost_count),
    comments: numberOrNull(source.comments_count ?? source.comment_count),
    attitudes: numberOrNull(source.attitudes_count ?? source.like_count),
  };
}

function summarizeUserPostsJson(value) {
  const list = Array.isArray(value?.data?.list)
    ? value.data.list
    : Array.isArray(value?.list)
      ? value.list
      : Array.isArray(value?.statuses)
        ? value.statuses
        : [];
  const items = list
    .slice(0, 100)
    .map(postItemSummary)
    .filter((item) => item.id || item.textSummary);
  return {
    kind: 'json',
    matchedArrayPath: Array.isArray(value?.data?.list) ? 'data.list' : Array.isArray(value?.list) ? 'list' : Array.isArray(value?.statuses) ? 'statuses' : null,
    itemCount: list.length,
    sampleCount: items.length,
    items,
    nextPage: numberOrNull(value?.data?.since_id ?? value?.data?.next_cursor ?? value?.since_id),
    resultStateVerified: list.length > 0,
  };
}

function articleItemSummary(item) {
  const source = item && typeof item === 'object' ? item : {};
  const pageInfo = source.page_info && typeof source.page_info === 'object' ? source.page_info : {};
  return {
    id: compactSummaryText(source.idstr ?? source.id ?? source.mid, 48) || null,
    createdAt: compactSummaryText(source.created_at ?? source.createdAt ?? source.time, 64) || null,
    textSummary: compactSummaryText(source.text_raw ?? source.text ?? source.content ?? '', 160) || null,
    articleObjectId: compactSummaryText(pageInfo.object_id ?? pageInfo.page_id ?? pageInfo.id, 80) || null,
    titleSummary: compactSummaryText(pageInfo.page_title ?? pageInfo.title ?? pageInfo.content1 ?? '', 120) || null,
    pageInfoType: compactSummaryText(pageInfo.type ?? pageInfo.object_type, 32) || null,
    reposts: numberOrNull(source.reposts_count ?? source.repost_count),
    comments: numberOrNull(source.comments_count ?? source.comment_count),
    attitudes: numberOrNull(source.attitudes_count ?? source.like_count),
  };
}

function summarizeUserArticlesJson(value) {
  const list = Array.isArray(value?.data?.list)
    ? value.data.list
    : Array.isArray(value?.list)
      ? value.list
      : Array.isArray(value?.statuses)
        ? value.statuses
        : [];
  const articleLikeItems = list.filter((item) => {
    const pageInfo = item?.page_info && typeof item.page_info === 'object' ? item.page_info : {};
    return String(pageInfo.object_type ?? pageInfo.type ?? '').toLowerCase() === 'article';
  });
  const items = articleLikeItems
    .slice(0, 100)
    .map(articleItemSummary)
    .filter((item) => item.id || item.articleObjectId || item.titleSummary);
  return {
    kind: 'json',
    matchedArrayPath: Array.isArray(value?.data?.list) ? 'data.list' : Array.isArray(value?.list) ? 'list' : Array.isArray(value?.statuses) ? 'statuses' : null,
    itemCount: list.length,
    articleItemCount: articleLikeItems.length,
    sampleCount: items.length,
    items,
    nextPage: numberOrNull(value?.data?.since_id ?? value?.data?.next_cursor ?? value?.since_id),
    resultStateVerified: list.length > 0 && articleLikeItems.length > 0,
  };
}

function albumPhotoSummary(item) {
  const source = item && typeof item === 'object' ? item : {};
  return {
    id: compactSummaryText(source.photo_id ?? source.pid ?? source.pic_pid ?? source.mid, 64) || null,
    albumId: compactSummaryText(source.album_id, 64) || null,
    feedId: compactSummaryText(source.feed_id ?? source.mid, 64) || null,
    createdAt: compactSummaryText(source.created_at ?? source.original_time ?? source.ctime ?? source.timestamp, 64) || null,
    captionSummary: compactSummaryText(source.caption_render ?? source.caption ?? '', 120) || null,
    pictureType: compactSummaryText(source.pic_type ?? source.type, 32) || null,
  };
}

function summarizeUserAlbumsJson(value) {
  const list = Array.isArray(value?.data?.photo_list)
    ? value.data.photo_list
    : Array.isArray(value?.photo_list)
      ? value.photo_list
      : Array.isArray(value?.data?.list)
        ? value.data.list
        : [];
  const items = list
    .slice(0, 100)
    .map(albumPhotoSummary)
    .filter((item) => item.id || item.feedId);
  return {
    kind: 'json',
    matchedArrayPath: Array.isArray(value?.data?.photo_list) ? 'data.photo_list' : Array.isArray(value?.photo_list) ? 'photo_list' : Array.isArray(value?.data?.list) ? 'data.list' : null,
    itemCount: list.length,
    sampleCount: items.length,
    items,
    resultStateVerified: list.length > 0,
  };
}

function videoItemSummary(item) {
  const source = item && typeof item === 'object' ? item : {};
  const pageInfo = source.page_info && typeof source.page_info === 'object' ? source.page_info : {};
  const mediaInfo = pageInfo.media_info && typeof pageInfo.media_info === 'object'
    ? pageInfo.media_info
    : source.media_info && typeof source.media_info === 'object'
      ? source.media_info
      : {};
  return {
    id: compactSummaryText(source.idstr ?? source.id ?? source.mid, 48) || null,
    createdAt: compactSummaryText(source.created_at ?? source.createdAt ?? source.time, 64) || null,
    textSummary: compactSummaryText(source.text_raw ?? source.text ?? source.content ?? '', 160) || null,
    pageInfoType: compactSummaryText(pageInfo.type ?? pageInfo.object_type, 32) || null,
    mediaInfoPresent: Object.keys(mediaInfo).length > 0,
    durationSeconds: numberOrNull(mediaInfo.duration ?? mediaInfo.duration_time),
    reposts: numberOrNull(source.reposts_count ?? source.repost_count),
    comments: numberOrNull(source.comments_count ?? source.comment_count),
    attitudes: numberOrNull(source.attitudes_count ?? source.like_count),
  };
}

function summarizeUserVideosJson(value) {
  const list = Array.isArray(value?.data?.list)
    ? value.data.list
    : Array.isArray(value?.list)
      ? value.list
      : Array.isArray(value?.statuses)
        ? value.statuses
        : [];
  const videoLikeItems = list.filter((item) => {
    const pageInfo = item?.page_info && typeof item.page_info === 'object' ? item.page_info : {};
    return Boolean(pageInfo.media_info) || String(pageInfo.type ?? pageInfo.object_type ?? '').trim() === '11';
  });
  const items = videoLikeItems
    .slice(0, 100)
    .map(videoItemSummary)
    .filter((item) => item.id || item.textSummary || item.mediaInfoPresent);
  return {
    kind: 'json',
    matchedArrayPath: Array.isArray(value?.data?.list) ? 'data.list' : Array.isArray(value?.list) ? 'list' : Array.isArray(value?.statuses) ? 'statuses' : null,
    itemCount: list.length,
    videoItemCount: videoLikeItems.length,
    sampleCount: items.length,
    items,
    nextPage: numberOrNull(value?.data?.since_id ?? value?.data?.next_cursor ?? value?.since_id),
    resultStateVerified: list.length > 0 && videoLikeItems.length > 0,
  };
}

function audioItemSummary(item) {
  const source = item && typeof item === 'object' ? item : {};
  const pageInfo = source.page_info && typeof source.page_info === 'object' ? source.page_info : {};
  const mediaInfo = pageInfo.media_info && typeof pageInfo.media_info === 'object'
    ? pageInfo.media_info
    : source.media_info && typeof source.media_info === 'object'
      ? source.media_info
      : {};
  return {
    id: compactSummaryText(source.idstr ?? source.id ?? source.mid ?? source.audio_id ?? pageInfo.object_id ?? mediaInfo.media_id, 64) || null,
    createdAt: compactSummaryText(source.created_at ?? source.createdAt ?? source.time, 64) || null,
    titleSummary: compactSummaryText(source.title ?? source.text_raw ?? source.text ?? pageInfo.page_title ?? pageInfo.title ?? mediaInfo.name ?? '', 120) || null,
    pageInfoType: compactSummaryText(pageInfo.type ?? pageInfo.object_type, 32) || null,
    audioInfoPresent: Object.keys(mediaInfo).length > 0 || /audio|voice|music|sound/iu.test(String(pageInfo.type ?? pageInfo.object_type ?? source.type ?? '')),
    durationSeconds: numberOrNull(source.duration ?? source.duration_time ?? mediaInfo.duration ?? mediaInfo.duration_time),
  };
}

function summarizeUserAudioJson(value) {
  const hasDataList = Array.isArray(value?.data?.list);
  const hasList = Array.isArray(value?.list);
  const list = hasDataList ? value.data.list : hasList ? value.list : [];
  const items = list
    .slice(0, 100)
    .map(audioItemSummary)
    .filter((item) => item.id || item.titleSummary || item.audioInfoPresent);
  return {
    kind: 'json',
    matchedArrayPath: hasDataList ? 'data.list' : hasList ? 'list' : null,
    itemCount: list.length,
    audioItemCount: list.length,
    sampleCount: items.length,
    items,
    nextCursor: numberOrNull(value?.data?.next_cursor ?? value?.next_cursor),
    emptyStatePresent: list.length === 0 && (hasDataList || hasList),
    resultStateVerified: hasDataList || hasList,
  };
}

function failedWeiboReadonly(reasonCode, options = {}, runtimeMode = 'weibo_search_http_read_v1') {
  const resultSummary = {
    outcome: 'weibo_readonly_failed',
    providerId: WEIBO_READONLY_PROVIDER_ID,
    reasonCode,
    runtimeMode,
    responseMaterial: 'sanitized_summary_only',
    queryProvided: Boolean(searchQueryFrom(options)),
    uidProvided: Boolean(uidFrom(options)),
    artifactRefs: [],
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(resultSummary);
  return {
    providerId: WEIBO_READONLY_PROVIDER_ID,
    providerKind: 'weibo_readonly_provider',
    status: 'failed',
    reasonCode,
    runtimeExecuted: true,
    sideEffectAttempted: false,
    sideEffectSucceeded: false,
    sideEffectFailed: true,
    resultSummary,
  };
}

function failedWeiboHttpRead(reasonCode, response = null, bodyText = '', authSummary = null, bodySummary = null, runtimeMode = 'weibo_search_http_read_v1') {
  const resultSummary = {
    outcome: 'weibo_readonly_failed',
    providerId: WEIBO_READONLY_PROVIDER_ID,
    reasonCode,
    runtimeMode,
    responseMaterial: 'sanitized_summary_only',
    response: {
      status: Number(response?.status ?? 0) || null,
      ok: response?.ok === true,
      contentType: responseContentType(response),
      bodySummary: bodySummary ?? summarizeSearchHtml(bodyText),
    },
    authSummary,
    artifactRefs: [],
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(resultSummary);
  return {
    providerId: WEIBO_READONLY_PROVIDER_ID,
    providerKind: 'weibo_readonly_provider',
    status: 'failed',
    reasonCode,
    runtimeExecuted: true,
    sideEffectAttempted: true,
    sideEffectSucceeded: false,
    sideEffectFailed: true,
    authSummary,
    resultSummary,
  };
}

async function applyOptionalHttpAuth(options, request) {
  if (options.authAdapter?.isRequired?.() !== true) {
    return { ok: true, request, authSummary: null };
  }
  const applied = await options.authAdapter.applyHttpAuth({
    url: request.url,
    method: request.method,
  });
  if (applied.ok !== true) {
    return {
      ok: false,
      reasonCode: applied.reasonCode ?? 'runtime.auth_required',
      authSummary: applied.authSummary ?? null,
    };
  }
  return {
    ok: true,
    authSummary: applied.authSummary ?? null,
    request: {
      url: applied.request.url,
      method: applied.request.method,
      headers: applied.request.headers,
    },
  };
}

async function fetchReadonly(request, fetchImpl) {
  return fetchImpl(request.url, {
    method: request.method,
    headers: request.headers,
    redirect: 'manual',
  });
}

async function responseJson(response = null) {
  if (typeof response?.json === 'function') return response.json();
  const text = typeof response?.text === 'function' ? await response.text() : '';
  return JSON.parse(text);
}

async function runHotApi(options = {}, config = {}) {
  const fetchImpl = options.runtimeContext?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return failedWeiboReadonly('runtime.provider_failed', options, config.runtimeMode);
  }
  let request = {
    url: config.url,
    method: 'GET',
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: config.referer,
    },
  };
  const auth = await applyOptionalHttpAuth(options, request);
  if (auth.ok !== true) {
    return failedWeiboReadonly(auth.reasonCode, options, config.runtimeMode);
  }
  request = auth.request;
  let response;
  try {
    response = await fetchReadonly(request, fetchImpl);
  } catch {
    return failedWeiboReadonly('runtime.provider_failed', options, config.runtimeMode);
  }
  const contentType = responseContentType(response);
  const status = Number(response?.status ?? 0) || null;
  if (status !== null && (status < 200 || status >= 300)) {
    return failedWeiboHttpRead(
      status >= 300 && status < 400
        ? 'runtime.weibo_readonly_auth_or_redirect_required'
        : 'runtime.weibo_readonly_http_failed',
      response,
      '',
      auth.authSummary,
      {
        kind: 'json',
        itemCount: 0,
        resultStateVerified: false,
      },
      config.runtimeMode,
    );
  }
  let bodySummary;
  try {
    const parsed = await responseJson(response);
    bodySummary = summarizeHotApiJson(parsed, config.expectedArrays);
  } catch {
    return failedWeiboHttpRead(
      'runtime.weibo_readonly_json_parse_failed',
      response,
      '',
      auth.authSummary,
      {
        kind: 'json',
        itemCount: 0,
        resultStateVerified: false,
      },
      config.runtimeMode,
    );
  }
  if (bodySummary.resultStateVerified !== true) {
    return failedWeiboHttpRead(
      'runtime.weibo_readonly_unverified_result_state',
      response,
      '',
      auth.authSummary,
      bodySummary,
      config.runtimeMode,
    );
  }
  const resultSummary = {
    outcome: config.outcome,
    providerId: WEIBO_READONLY_PROVIDER_ID,
    runtimeMode: config.runtimeMode,
    responseMaterial: 'sanitized_summary_only',
    request: {
      origin: WEIBO_ORIGIN,
      pathTemplate: config.pathTemplate,
      method: 'GET',
    },
    response: {
      status,
      ok: response?.ok === true,
      contentType,
      bodySummary,
    },
    authSummary: auth.authSummary,
    artifactRefs: [],
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(resultSummary);
  return {
    providerId: WEIBO_READONLY_PROVIDER_ID,
    providerKind: 'weibo_readonly_provider',
    status: 'completed',
    runtimeExecuted: true,
    sideEffectAttempted: true,
    sideEffectSucceeded: true,
    sideEffectFailed: false,
    authSummary: auth.authSummary,
    resultSummary,
  };
}

async function runFollowedUsers(options = {}) {
  const uid = uidFrom(options);
  if (!uid) {
    return failedWeiboReadonly('runtime.missing_required_uid_slot', options, 'weibo_followed_users_api_read_v1');
  }
  const fetchImpl = options.runtimeContext?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return failedWeiboReadonly('runtime.provider_failed', options, 'weibo_followed_users_api_read_v1');
  }
  const page = pageFrom(options);
  const url = new URL(WEIBO_FOLLOWED_USERS_URL);
  url.searchParams.set('uid', uid);
  url.searchParams.set('page', String(page));
  let request = {
    url: url.toString(),
    method: 'GET',
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: `${WEIBO_ORIGIN}/u/${uid}`,
    },
  };
  const auth = await applyOptionalHttpAuth(options, request);
  if (auth.ok !== true) {
    return failedWeiboReadonly(auth.reasonCode, options, 'weibo_followed_users_http_read_v1');
  }
  request = auth.request;
  let response;
  try {
    response = await fetchReadonly(request, fetchImpl);
  } catch {
    return failedWeiboReadonly('runtime.provider_failed', options, 'weibo_followed_users_api_read_v1');
  }
  const contentType = responseContentType(response);
  const status = Number(response?.status ?? 0) || null;
  if (status !== null && (status < 200 || status >= 300)) {
    return failedWeiboHttpRead(
      status >= 300 && status < 400
        ? 'runtime.weibo_readonly_auth_or_redirect_required'
        : 'runtime.weibo_readonly_http_failed',
      response,
      '',
      auth.authSummary,
      {
        kind: 'json',
        followedUserIdCount: 0,
        followedUserIds: [],
        resultStateVerified: false,
      },
      'weibo_followed_users_api_read_v1',
    );
  }
  let bodySummary;
  try {
    bodySummary = summarizeFollowedUsersJson(await responseJson(response));
  } catch {
    return failedWeiboHttpRead(
      'runtime.weibo_readonly_json_parse_failed',
      response,
      '',
      auth.authSummary,
      {
        kind: 'json',
        followedUserIdCount: 0,
        followedUserIds: [],
        resultStateVerified: false,
      },
      'weibo_followed_users_api_read_v1',
    );
  }
  if (bodySummary.resultStateVerified !== true) {
    return failedWeiboHttpRead(
      'runtime.weibo_readonly_unverified_result_state',
      response,
      '',
      auth.authSummary,
      bodySummary,
      'weibo_followed_users_api_read_v1',
    );
  }
  const resultSummary = {
    outcome: 'weibo_followed_users_read_completed',
    providerId: WEIBO_READONLY_PROVIDER_ID,
    runtimeMode: 'weibo_followed_users_api_read_v1',
    responseMaterial: 'sanitized_summary_only',
    request: {
      origin: WEIBO_ORIGIN,
      pathTemplate: '/ajax/friendships/friends?uid={uid}&page={page}',
      method: 'GET',
      uidSlotUsed: true,
      pageSlotUsed: true,
    },
    response: {
      status,
      ok: response?.ok === true,
      contentType,
      bodySummary,
    },
    authSummary: auth.authSummary,
    artifactRefs: [],
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(resultSummary);
  return {
    providerId: WEIBO_READONLY_PROVIDER_ID,
    providerKind: 'weibo_readonly_provider',
    status: 'completed',
    runtimeExecuted: true,
    sideEffectAttempted: true,
    sideEffectSucceeded: true,
    sideEffectFailed: false,
    authSummary: auth.authSummary,
    resultSummary,
  };
}

async function runUserPosts(options = {}) {
  const uid = uidFrom(options);
  if (!uid) {
    return failedWeiboReadonly('runtime.missing_required_uid_slot', options, 'weibo_user_posts_api_read_v1');
  }
  const fetchImpl = options.runtimeContext?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return failedWeiboReadonly('runtime.provider_failed', options, 'weibo_user_posts_api_read_v1');
  }
  const page = pageFrom(options);
  const url = new URL(WEIBO_USER_POSTS_URL);
  url.searchParams.set('uid', uid);
  url.searchParams.set('page', String(page));
  url.searchParams.set('feature', '0');
  let request = {
    url: url.toString(),
    method: 'GET',
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: `${WEIBO_ORIGIN}/u/${uid}`,
    },
  };
  const auth = await applyOptionalHttpAuth(options, request);
  if (auth.ok !== true) {
    return failedWeiboReadonly(auth.reasonCode, options, 'weibo_user_posts_api_read_v1');
  }
  request = auth.request;
  let response;
  try {
    response = await fetchReadonly(request, fetchImpl);
  } catch {
    return failedWeiboReadonly('runtime.provider_failed', options, 'weibo_user_posts_api_read_v1');
  }
  const contentType = responseContentType(response);
  const status = Number(response?.status ?? 0) || null;
  if (status !== null && (status < 200 || status >= 300)) {
    return failedWeiboHttpRead(
      status >= 300 && status < 400
        ? 'runtime.weibo_readonly_auth_or_redirect_required'
        : 'runtime.weibo_readonly_http_failed',
      response,
      '',
      auth.authSummary,
      {
        kind: 'json',
        itemCount: 0,
        resultStateVerified: false,
      },
      'weibo_user_posts_api_read_v1',
    );
  }
  let bodySummary;
  try {
    bodySummary = summarizeUserPostsJson(await responseJson(response));
  } catch {
    return failedWeiboHttpRead(
      'runtime.weibo_readonly_json_parse_failed',
      response,
      '',
      auth.authSummary,
      {
        kind: 'json',
        itemCount: 0,
        resultStateVerified: false,
      },
      'weibo_user_posts_api_read_v1',
    );
  }
  if (bodySummary.resultStateVerified !== true) {
    return failedWeiboHttpRead(
      'runtime.weibo_readonly_unverified_result_state',
      response,
      '',
      auth.authSummary,
      bodySummary,
      'weibo_user_posts_api_read_v1',
    );
  }
  const resultSummary = {
    outcome: 'weibo_user_posts_api_read_completed',
    providerId: WEIBO_READONLY_PROVIDER_ID,
    runtimeMode: 'weibo_user_posts_api_read_v1',
    responseMaterial: 'sanitized_summary_only',
    request: {
      origin: WEIBO_ORIGIN,
      pathTemplate: '/ajax/statuses/mymblog?uid={uid}&page={page}&feature=0',
      method: 'GET',
      uidSlotUsed: true,
      pageSlotUsed: true,
    },
    response: {
      status,
      ok: response?.ok === true,
      contentType,
      bodySummary,
    },
    authSummary: auth.authSummary,
    artifactRefs: [],
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(resultSummary);
  return {
    providerId: WEIBO_READONLY_PROVIDER_ID,
    providerKind: 'weibo_readonly_provider',
    status: 'completed',
    runtimeExecuted: true,
    sideEffectAttempted: true,
    sideEffectSucceeded: true,
    sideEffectFailed: false,
    authSummary: auth.authSummary,
    resultSummary,
  };
}

async function runUserArticles(options = {}) {
  const uid = uidFrom(options);
  if (!uid) {
    return failedWeiboReadonly('runtime.missing_required_uid_slot', options, 'weibo_user_articles_api_read_v1');
  }
  const fetchImpl = options.runtimeContext?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return failedWeiboReadonly('runtime.provider_failed', options, 'weibo_user_articles_api_read_v1');
  }
  const page = pageFrom(options);
  const url = new URL(WEIBO_USER_POSTS_URL);
  url.searchParams.set('uid', uid);
  url.searchParams.set('page', String(page));
  url.searchParams.set('feature', '7');
  let request = {
    url: url.toString(),
    method: 'GET',
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: `${WEIBO_ORIGIN}/u/${uid}?tabtype=article`,
    },
  };
  const auth = await applyOptionalHttpAuth(options, request);
  if (auth.ok !== true) {
    return failedWeiboReadonly(auth.reasonCode, options, 'weibo_user_articles_api_read_v1');
  }
  request = auth.request;
  let response;
  try {
    response = await fetchReadonly(request, fetchImpl);
  } catch {
    return failedWeiboReadonly('runtime.provider_failed', options, 'weibo_user_articles_api_read_v1');
  }
  const contentType = responseContentType(response);
  const status = Number(response?.status ?? 0) || null;
  if (status !== null && (status < 200 || status >= 300)) {
    return failedWeiboHttpRead(
      status >= 300 && status < 400
        ? 'runtime.weibo_readonly_auth_or_redirect_required'
        : 'runtime.weibo_readonly_http_failed',
      response,
      '',
      auth.authSummary,
      {
        kind: 'json',
        itemCount: 0,
        articleItemCount: 0,
        resultStateVerified: false,
      },
      'weibo_user_articles_api_read_v1',
    );
  }
  let bodySummary;
  try {
    bodySummary = summarizeUserArticlesJson(await responseJson(response));
  } catch {
    return failedWeiboHttpRead(
      'runtime.weibo_readonly_json_parse_failed',
      response,
      '',
      auth.authSummary,
      {
        kind: 'json',
        itemCount: 0,
        articleItemCount: 0,
        resultStateVerified: false,
      },
      'weibo_user_articles_api_read_v1',
    );
  }
  if (bodySummary.resultStateVerified !== true) {
    return failedWeiboHttpRead(
      'runtime.weibo_readonly_unverified_result_state',
      response,
      '',
      auth.authSummary,
      bodySummary,
      'weibo_user_articles_api_read_v1',
    );
  }
  const resultSummary = {
    outcome: 'weibo_user_articles_api_read_completed',
    providerId: WEIBO_READONLY_PROVIDER_ID,
    runtimeMode: 'weibo_user_articles_api_read_v1',
    responseMaterial: 'sanitized_summary_only',
    request: {
      origin: WEIBO_ORIGIN,
      pathTemplate: '/ajax/statuses/mymblog?uid={uid}&page={page}&feature=7',
      method: 'GET',
      uidSlotUsed: true,
      pageSlotUsed: true,
    },
    response: {
      status,
      ok: response?.ok === true,
      contentType,
      bodySummary,
    },
    authSummary: auth.authSummary,
    artifactRefs: [],
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(resultSummary);
  return {
    providerId: WEIBO_READONLY_PROVIDER_ID,
    providerKind: 'weibo_readonly_provider',
    status: 'completed',
    runtimeExecuted: true,
    sideEffectAttempted: true,
    sideEffectSucceeded: true,
    sideEffectFailed: false,
    authSummary: auth.authSummary,
    resultSummary,
  };
}

async function runUserAlbums(options = {}) {
  const uid = uidFrom(options);
  if (!uid) {
    return failedWeiboReadonly('runtime.missing_required_uid_slot', options, 'weibo_user_albums_api_read_v1');
  }
  const fetchImpl = options.runtimeContext?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return failedWeiboReadonly('runtime.provider_failed', options, 'weibo_user_albums_api_read_v1');
  }
  const page = pageFrom(options);
  const url = new URL(WEIBO_USER_ALBUMS_URL);
  url.searchParams.set('uid', uid);
  url.searchParams.set('page', String(page));
  url.searchParams.set('count', '30');
  let request = {
    url: url.toString(),
    method: 'GET',
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: `${WEIBO_ORIGIN}/u/${uid}?tabtype=album`,
    },
  };
  const auth = await applyOptionalHttpAuth(options, request);
  if (auth.ok !== true) {
    return failedWeiboReadonly(auth.reasonCode, options, 'weibo_user_albums_api_read_v1');
  }
  request = auth.request;
  let response;
  try {
    response = await fetchReadonly(request, fetchImpl);
  } catch {
    return failedWeiboReadonly('runtime.provider_failed', options, 'weibo_user_albums_api_read_v1');
  }
  const contentType = responseContentType(response);
  const status = Number(response?.status ?? 0) || null;
  if (status !== null && (status < 200 || status >= 300)) {
    return failedWeiboHttpRead(
      status >= 300 && status < 400
        ? 'runtime.weibo_readonly_auth_or_redirect_required'
        : 'runtime.weibo_readonly_http_failed',
      response,
      '',
      auth.authSummary,
      {
        kind: 'json',
        itemCount: 0,
        resultStateVerified: false,
      },
      'weibo_user_albums_api_read_v1',
    );
  }
  let bodySummary;
  try {
    bodySummary = summarizeUserAlbumsJson(await responseJson(response));
  } catch {
    return failedWeiboHttpRead(
      'runtime.weibo_readonly_json_parse_failed',
      response,
      '',
      auth.authSummary,
      {
        kind: 'json',
        itemCount: 0,
        resultStateVerified: false,
      },
      'weibo_user_albums_api_read_v1',
    );
  }
  if (bodySummary.resultStateVerified !== true) {
    return failedWeiboHttpRead(
      'runtime.weibo_readonly_unverified_result_state',
      response,
      '',
      auth.authSummary,
      bodySummary,
      'weibo_user_albums_api_read_v1',
    );
  }
  const resultSummary = {
    outcome: 'weibo_user_albums_api_read_completed',
    providerId: WEIBO_READONLY_PROVIDER_ID,
    runtimeMode: 'weibo_user_albums_api_read_v1',
    responseMaterial: 'sanitized_summary_only',
    request: {
      origin: 'https://photo.weibo.com',
      pathTemplate: '/photos/get_all?uid={uid}&page={page}&count=30',
      method: 'GET',
      uidSlotUsed: true,
      pageSlotUsed: true,
    },
    response: {
      status,
      ok: response?.ok === true,
      contentType,
      bodySummary,
    },
    authSummary: auth.authSummary,
    artifactRefs: [],
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(resultSummary);
  return {
    providerId: WEIBO_READONLY_PROVIDER_ID,
    providerKind: 'weibo_readonly_provider',
    status: 'completed',
    runtimeExecuted: true,
    sideEffectAttempted: true,
    sideEffectSucceeded: true,
    sideEffectFailed: false,
    authSummary: auth.authSummary,
    resultSummary,
  };
}

async function runUserVideos(options = {}) {
  const uid = uidFrom(options);
  if (!uid) {
    return failedWeiboReadonly('runtime.missing_required_uid_slot', options, 'weibo_user_videos_api_read_v1');
  }
  const fetchImpl = options.runtimeContext?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return failedWeiboReadonly('runtime.provider_failed', options, 'weibo_user_videos_api_read_v1');
  }
  const page = pageFrom(options);
  const url = new URL(WEIBO_USER_POSTS_URL);
  url.searchParams.set('uid', uid);
  url.searchParams.set('page', String(page));
  url.searchParams.set('feature', '3');
  let request = {
    url: url.toString(),
    method: 'GET',
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: `${WEIBO_ORIGIN}/u/${uid}?tabtype=video`,
    },
  };
  const auth = await applyOptionalHttpAuth(options, request);
  if (auth.ok !== true) {
    return failedWeiboReadonly(auth.reasonCode, options, 'weibo_user_videos_api_read_v1');
  }
  request = auth.request;
  let response;
  try {
    response = await fetchReadonly(request, fetchImpl);
  } catch {
    return failedWeiboReadonly('runtime.provider_failed', options, 'weibo_user_videos_api_read_v1');
  }
  const contentType = responseContentType(response);
  const status = Number(response?.status ?? 0) || null;
  if (status !== null && (status < 200 || status >= 300)) {
    return failedWeiboHttpRead(
      status >= 300 && status < 400
        ? 'runtime.weibo_readonly_auth_or_redirect_required'
        : 'runtime.weibo_readonly_http_failed',
      response,
      '',
      auth.authSummary,
      {
        kind: 'json',
        itemCount: 0,
        videoItemCount: 0,
        resultStateVerified: false,
      },
      'weibo_user_videos_api_read_v1',
    );
  }
  let bodySummary;
  try {
    bodySummary = summarizeUserVideosJson(await responseJson(response));
  } catch {
    return failedWeiboHttpRead(
      'runtime.weibo_readonly_json_parse_failed',
      response,
      '',
      auth.authSummary,
      {
        kind: 'json',
        itemCount: 0,
        videoItemCount: 0,
        resultStateVerified: false,
      },
      'weibo_user_videos_api_read_v1',
    );
  }
  if (bodySummary.resultStateVerified !== true) {
    return failedWeiboHttpRead(
      'runtime.weibo_readonly_unverified_result_state',
      response,
      '',
      auth.authSummary,
      bodySummary,
      'weibo_user_videos_api_read_v1',
    );
  }
  const resultSummary = {
    outcome: 'weibo_user_videos_api_read_completed',
    providerId: WEIBO_READONLY_PROVIDER_ID,
    runtimeMode: 'weibo_user_videos_api_read_v1',
    responseMaterial: 'sanitized_summary_only',
    request: {
      origin: WEIBO_ORIGIN,
      pathTemplate: '/ajax/statuses/mymblog?uid={uid}&page={page}&feature=3',
      method: 'GET',
      uidSlotUsed: true,
      pageSlotUsed: true,
    },
    response: {
      status,
      ok: response?.ok === true,
      contentType,
      bodySummary,
    },
    authSummary: auth.authSummary,
    artifactRefs: [],
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(resultSummary);
  return {
    providerId: WEIBO_READONLY_PROVIDER_ID,
    providerKind: 'weibo_readonly_provider',
    status: 'completed',
    runtimeExecuted: true,
    sideEffectAttempted: true,
    sideEffectSucceeded: true,
    sideEffectFailed: false,
    authSummary: auth.authSummary,
    resultSummary,
  };
}

async function runUserAudio(options = {}) {
  const uid = uidFrom(options);
  if (!uid) {
    return failedWeiboReadonly('runtime.missing_required_uid_slot', options, 'weibo_user_audio_api_read_v1');
  }
  const fetchImpl = options.runtimeContext?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return failedWeiboReadonly('runtime.provider_failed', options, 'weibo_user_audio_api_read_v1');
  }
  const cursor = cursorFrom(options);
  const url = new URL(WEIBO_USER_AUDIO_URL);
  url.searchParams.set('profile_uid', uid);
  url.searchParams.set('cursor', cursor);
  let request = {
    url: url.toString(),
    method: 'GET',
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: `${WEIBO_ORIGIN}/u/${uid}?tabtype=audio`,
    },
  };
  const auth = await applyOptionalHttpAuth(options, request);
  if (auth.ok !== true) {
    return failedWeiboReadonly(auth.reasonCode, options, 'weibo_user_audio_api_read_v1');
  }
  request = auth.request;
  let response;
  try {
    response = await fetchReadonly(request, fetchImpl);
  } catch {
    return failedWeiboReadonly('runtime.provider_failed', options, 'weibo_user_audio_api_read_v1');
  }
  const contentType = responseContentType(response);
  const status = Number(response?.status ?? 0) || null;
  if (status !== null && (status < 200 || status >= 300)) {
    return failedWeiboHttpRead(
      status >= 300 && status < 400
        ? 'runtime.weibo_readonly_auth_or_redirect_required'
        : 'runtime.weibo_readonly_http_failed',
      response,
      '',
      auth.authSummary,
      {
        kind: 'json',
        itemCount: 0,
        audioItemCount: 0,
        resultStateVerified: false,
      },
      'weibo_user_audio_api_read_v1',
    );
  }
  let bodySummary;
  try {
    bodySummary = summarizeUserAudioJson(await responseJson(response));
  } catch {
    return failedWeiboHttpRead(
      'runtime.weibo_readonly_json_parse_failed',
      response,
      '',
      auth.authSummary,
      {
        kind: 'json',
        itemCount: 0,
        audioItemCount: 0,
        resultStateVerified: false,
      },
      'weibo_user_audio_api_read_v1',
    );
  }
  if (bodySummary.resultStateVerified !== true) {
    return failedWeiboHttpRead(
      'runtime.weibo_readonly_unverified_result_state',
      response,
      '',
      auth.authSummary,
      bodySummary,
      'weibo_user_audio_api_read_v1',
    );
  }
  const resultSummary = {
    outcome: 'weibo_user_audio_api_read_completed',
    providerId: WEIBO_READONLY_PROVIDER_ID,
    runtimeMode: 'weibo_user_audio_api_read_v1',
    responseMaterial: 'sanitized_summary_only',
    request: {
      origin: WEIBO_ORIGIN,
      pathTemplate: '/ajax/profile/getAudioList?profile_uid={uid}&cursor={cursor}',
      method: 'GET',
      uidSlotUsed: true,
      cursorSlotUsed: true,
    },
    response: {
      status,
      ok: response?.ok === true,
      contentType,
      bodySummary,
    },
    authSummary: auth.authSummary,
    artifactRefs: [],
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(resultSummary);
  return {
    providerId: WEIBO_READONLY_PROVIDER_ID,
    providerKind: 'weibo_readonly_provider',
    status: 'completed',
    runtimeExecuted: true,
    sideEffectAttempted: true,
    sideEffectSucceeded: true,
    sideEffectFailed: false,
    authSummary: auth.authSummary,
    resultSummary,
  };
}

export function createWeiboReadonlyProvider() {
  return {
    id: WEIBO_READONLY_PROVIDER_ID,
    providerKind: 'weibo_readonly_provider',
    capabilityKinds: ['api', 'read', 'query', 'search'],
    supports(descriptor = {}) {
      return supportsWeiboReadonly(descriptor);
    },
    canExecute(options = {}) {
      if (!supportsWeiboReadonly(options)) {
        return {
          allowed: false,
          reasonCode: 'runtime.weibo_readonly_provider_unsupported',
        };
      }
      if (isWeiboHotSearchDescriptor(options) || isWeiboHotRankHourDescriptor(options) || isWeiboHotRankSplitDescriptor(options) || isWeiboHotTimelineDescriptor(options)) {
        return { allowed: true };
      }
      if (
        isWeiboUserPostsDescriptor(options)
        || isWeiboUserArticlesDescriptor(options)
        || isWeiboUserAlbumsDescriptor(options)
        || isWeiboUserVideosDescriptor(options)
        || isWeiboUserAudioDescriptor(options)
      ) {
        if (!uidFrom(options)) {
          return {
            allowed: false,
            reasonCode: 'runtime.missing_required_uid_slot',
          };
        }
        return { allowed: true };
      }
      if (isWeiboFollowedUsersDescriptor(options)) {
        if (!uidFrom(options)) {
          return {
            allowed: false,
            reasonCode: 'runtime.missing_required_uid_slot',
          };
        }
      } else if (!searchQueryFrom(options)) {
        return {
          allowed: false,
          reasonCode: 'runtime.missing_required_slot',
        };
      }
      return { allowed: true };
    },
    async run(options = {}) {
      const query = searchQueryFrom(options);
      if (isWeiboHotSearchDescriptor(options)) {
        return runHotApi(options, {
          url: WEIBO_HOT_SEARCH_URL,
          referer: `${WEIBO_ORIGIN}/`,
          pathTemplate: '/ajax/side/hotSearch',
          expectedArrays: [['data', 'realtime'], ['realtime'], ['data', 'list'], ['list']],
          outcome: 'weibo_hot_search_api_read_completed',
          runtimeMode: 'weibo_hot_search_api_read_v1',
        });
      }
      if (isWeiboHotRankHourDescriptor(options)) {
        return runHotApi(options, {
          url: WEIBO_HOT_BAND_URL,
          referer: `${WEIBO_ORIGIN}/hot/hotband`,
          pathTemplate: '/ajax/statuses/hot_band',
          expectedArrays: [['data', 'band_list'], ['band_list'], ['data', 'list'], ['list']],
          outcome: 'weibo_hot_rank_hour_api_read_completed',
          runtimeMode: 'weibo_hot_rank_hour_api_read_v1',
        });
      }
      const hotRankSplit = weiboHotRankSplitMode(options);
      if (hotRankSplit) {
        return runHotApi(options, {
          url: hotTimelineUrl(hotRankSplit.params),
          referer: `${WEIBO_ORIGIN}/hot/hottimeline`,
          pathTemplate: hotRankSplit.pathTemplate,
          expectedArrays: [['statuses'], ['data', 'statuses'], ['data', 'list'], ['list']],
          outcome: hotRankSplit.outcome,
          runtimeMode: hotRankSplit.runtimeMode,
        });
      }
      if (isWeiboHotTimelineDescriptor(options)) {
        return runHotApi(options, {
          url: hotTimelineUrl(),
          referer: `${WEIBO_ORIGIN}/hot/hottimeline`,
          pathTemplate: '/ajax/feed/hottimeline?group_id=102803&containerid=102803&count=10',
          expectedArrays: [['statuses'], ['data', 'statuses'], ['data', 'list'], ['list']],
          outcome: 'weibo_hot_timeline_api_read_completed',
          runtimeMode: 'weibo_hot_timeline_api_read_v1',
        });
      }
      if (isWeiboUserArticlesDescriptor(options)) {
        return runUserArticles(options);
      }
      if (isWeiboUserPostsDescriptor(options)) {
        return runUserPosts(options);
      }
      if (isWeiboUserAlbumsDescriptor(options)) {
        return runUserAlbums(options);
      }
      if (isWeiboUserVideosDescriptor(options)) {
        return runUserVideos(options);
      }
      if (isWeiboUserAudioDescriptor(options)) {
        return runUserAudio(options);
      }
      if (isWeiboFollowedUsersDescriptor(options)) {
        return runFollowedUsers(options);
      }
      if (!query) {
        return failedWeiboReadonly('runtime.missing_required_slot', options);
      }
      const fetchImpl = options.runtimeContext?.fetchImpl ?? globalThis.fetch;
      if (typeof fetchImpl !== 'function') {
        return failedWeiboReadonly('runtime.provider_failed', options);
      }
      const url = new URL(WEIBO_SEARCH_URL);
      url.searchParams.set('q', query);
      let request = {
        url: url.toString(),
        method: 'GET',
        headers: {},
      };
      const auth = await applyOptionalHttpAuth(options, request);
      if (auth.ok !== true) {
        return failedWeiboReadonly(auth.reasonCode, options);
      }
      request = auth.request;
      let response;
      try {
        response = await fetchReadonly(request, fetchImpl);
      } catch {
        return failedWeiboReadonly('runtime.provider_failed', options);
      }
      const contentType = responseContentType(response);
      const bodyText = typeof response?.text === 'function' ? await response.text() : '';
      const status = Number(response?.status ?? 0) || null;
      const bodySummary = summarizeSearchHtml(bodyText);
      if (status !== null && (status < 200 || status >= 300)) {
        return failedWeiboHttpRead(
          status >= 300 && status < 400
            ? 'runtime.weibo_readonly_auth_or_redirect_required'
            : 'runtime.weibo_readonly_http_failed',
          response,
          bodyText,
          auth.authSummary,
          bodySummary,
        );
      }
      if (bodySummary.authOrChallengeSignals > 0) {
        return failedWeiboHttpRead(
          'runtime.weibo_readonly_auth_or_challenge_required',
          response,
          bodyText,
          auth.authSummary,
          bodySummary,
        );
      }
      if (bodySummary.resultStateVerified !== true) {
        return failedWeiboHttpRead(
          'runtime.weibo_readonly_unverified_result_state',
          response,
          bodyText,
          auth.authSummary,
          bodySummary,
        );
      }
      const resultSummary = {
        outcome: 'weibo_search_read_completed',
        providerId: WEIBO_READONLY_PROVIDER_ID,
        runtimeMode: 'weibo_search_http_read_v1',
        responseMaterial: 'sanitized_summary_only',
        request: {
          origin: 'https://s.weibo.com',
          pathTemplate: '/weibo?q={query}',
          method: 'GET',
          querySlotUsed: true,
        },
        response: {
          status,
          ok: response?.ok === true,
          contentType,
          bodySummary,
        },
        authSummary: auth.authSummary,
        artifactRefs: [],
        redactionRequired: true,
      };
      assertNoExecutionSensitiveMaterial(resultSummary);
      return {
        providerId: WEIBO_READONLY_PROVIDER_ID,
        providerKind: 'weibo_readonly_provider',
        status: 'completed',
        runtimeExecuted: true,
        sideEffectAttempted: true,
        sideEffectSucceeded: true,
        sideEffectFailed: false,
        authSummary: auth.authSummary,
        resultSummary,
      };
    },
  };
}

export { WEIBO_READONLY_PROVIDER_ID };
