// @ts-check

import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { derivePageFacts } from '../../../shared/page-state-runtime.mjs';
import { openBrowserSession } from '../../../infra/browser/session.mjs';
import { detectXiaohongshuRestrictionPage } from '../../../shared/xiaohongshu-risk.mjs';
import { inferPageTypeFromUrl } from '../../core/page-types.mjs';
import { readJsonFile } from '../../../infra/io.mjs';
import { inspectRequestReusableSiteSession } from '../../../infra/auth/site-login-service.mjs';
import { queryXiaohongshuFollow } from '../queries/follow-query.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..', '..');
const XIAOHONGSHU_DOWNLOAD_PYTHON_ENTRY = path.join(REPO_ROOT, 'src', 'sites', 'xiaohongshu', 'download', 'python', 'xiaohongshu.py');
const XIAOHONGSHU_HOME_URL = 'https://www.xiaohongshu.com/explore';
const DEFAULT_PROFILE_PATH = path.join(REPO_ROOT, 'profiles', 'www.xiaohongshu.com.json');
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SIDE_CAR_MAX_AGE_MS = 30 * 60_000;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36';
const DEFAULT_ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en;q=0.8';

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeStringList(value) {
  return (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
    .flatMap((entry) => String(entry ?? '').split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniqueStrings(values) {
  return [...new Set(normalizeStringList(values))];
}

function toArray(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function dedupeBy(items, keyBuilder) {
  const result = [];
  const seen = new Set();
  for (const item of items) {
    const key = normalizeText(keyBuilder(item));
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function buildXiaohongshuSearchUrl(queryText) {
  const url = new URL('https://www.xiaohongshu.com/search_result');
  url.searchParams.set('keyword', normalizeText(queryText));
  return url.toString();
}

function buildXiaohongshuNoteUrl(noteId) {
  const normalizedNoteId = normalizeText(noteId);
  return normalizedNoteId ? `https://www.xiaohongshu.com/explore/${normalizedNoteId}` : null;
}

function readUrlSearchParam(value, paramName) {
  const normalizedValue = normalizeText(value);
  const normalizedParamName = normalizeText(paramName);
  if (!normalizedValue || !normalizedParamName) {
    return null;
  }
  try {
    const parsed = new URL(normalizedValue);
    return normalizeText(parsed.searchParams.get(normalizedParamName)) || null;
  } catch {
    return null;
  }
}

function inferXiaohongshuXsecSource(candidate = {}) {
  const explicitSource = normalizeText(
    candidate.xsecSource
    || readUrlSearchParam(candidate.navigationUrl, 'xsec_source')
    || readUrlSearchParam(candidate.url, 'xsec_source')
    || '',
  ) || null;
  if (explicitSource) {
    return explicitSource;
  }
  const sourceType = normalizeText(candidate.sourceType).toLowerCase();
  if (sourceType.startsWith('author-')) {
    return 'pc_user';
  }
  if (sourceType.startsWith('search-')) {
    return 'pc_search';
  }
  if (sourceType.startsWith('direct-note')) {
    return 'pc_note';
  }
  return null;
}

function buildXiaohongshuNavigableNoteUrl(candidate = {}) {
  const noteId = normalizeText(candidate.noteId) || extractXiaohongshuNoteId(candidate.navigationUrl) || extractXiaohongshuNoteId(candidate.url);
  const fallbackUrl = normalizeUrl(candidate.navigationUrl || candidate.url || '');
  const xsecToken = normalizeText(
    candidate.xsecToken
    || readUrlSearchParam(candidate.navigationUrl, 'xsec_token')
    || readUrlSearchParam(candidate.url, 'xsec_token')
    || '',
  ) || null;
  if (!noteId) {
    return fallbackUrl;
  }
  const baseUrl = buildXiaohongshuNoteUrl(noteId) || fallbackUrl;
  if (!baseUrl) {
    return null;
  }
  if (!xsecToken) {
    return normalizeUrl(baseUrl);
  }
  try {
    const parsed = new URL(baseUrl);
    parsed.searchParams.set('xsec_token', xsecToken);
    const xsecSource = inferXiaohongshuXsecSource(candidate);
    if (xsecSource) {
      parsed.searchParams.set('xsec_source', xsecSource);
    }
    return parsed.toString();
  } catch {
    return normalizeUrl(baseUrl);
  }
}

function buildXiaohongshuCandidateDetailTargets(candidate = {}) {
  return dedupeBy([
    buildXiaohongshuNavigableNoteUrl(candidate),
    normalizeUrl(candidate.navigationUrl || ''),
    normalizeUrl(candidate.url || ''),
    buildXiaohongshuNoteUrl(candidate.noteId),
  ].filter(Boolean), (value) => value);
}

function buildXiaohongshuAuthorUrl(userId) {
  const normalizedUserId = normalizeText(userId);
  return normalizedUserId ? `https://www.xiaohongshu.com/user/profile/${normalizedUserId}` : null;
}

function resolveXiaohongshuFollowQueryInputUrl(profile = {}) {
  return normalizeUrl(
    profile?.authSession?.verificationUrl
    || profile?.authSession?.keepaliveUrl
    || profile?.authValidationSamples?.notificationUrl
    || XIAOHONGSHU_HOME_URL,
  ) || XIAOHONGSHU_HOME_URL;
}

function extractXiaohongshuNoteId(value) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return null;
  }
  const directMatch = normalizedValue.match(/^([0-9a-z]{6,})$/iu);
  if (directMatch) {
    return normalizeText(directMatch[1]) || null;
  }
  try {
    const parsed = new URL(normalizedValue);
    const matched = parsed.pathname.match(/^\/explore\/([^/?#]+)/iu);
    return normalizeText(matched?.[1]) || null;
  } catch {
    return null;
  }
}

function extractXiaohongshuAuthorUserId(value) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return null;
  }
  try {
    const parsed = new URL(normalizedValue);
    const matched = parsed.pathname.match(/^\/user\/profile\/([^/?#]+)/iu);
    return normalizeText(matched?.[1]) || null;
  } catch {
    return null;
  }
}

function normalizeUrl(value, baseUrl = undefined) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return null;
  }
  try {
    return new URL(normalizedValue, baseUrl).toString();
  } catch {
    return null;
  }
}

function normalizePositiveInteger(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? Math.floor(numericValue) : fallback;
}

function normalizeSessionStatus(value) {
  const normalizedValue = normalizeText(value);
  return ['ready', 'blocked', 'manual-required', 'expired', 'quarantine'].includes(normalizedValue)
    ? normalizedValue
    : null;
}

function resolveRequestSessionStatus(request = {}) {
  return normalizeSessionStatus(
    request.sessionStatus
    ?? request.sessionHealthManifest?.healthStatus
    ?? request.sessionHealthManifest?.status
    ?? request.sessionHealth?.healthStatus
    ?? request.sessionHealth?.status,
  );
}

function buildAuthRequiredSessionBlock(plan, request = {}) {
  if (plan.authRequired !== true) {
    return null;
  }
  const status = resolveRequestSessionStatus(request);
  if (!status || status === 'ready') {
    return null;
  }
  const summary = request.sessionHealthManifest ?? request.sessionHealth ?? {};
  const reason = normalizeText(
    request.sessionReason
    ?? summary.reason
    ?? summary.riskCauseCode
    ?? status,
  ) || status;
  return {
    status,
    reason,
    provider: normalizeText(request.sessionProvider) || 'unified-session-runner',
    healthManifest: normalizeText(request.sessionManifestPath ?? request.sessionManifest) || null,
    repairPlan: summary.repairPlan ?? null,
  };
}

function normalizePositiveDurationMs(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? Math.floor(numericValue) : fallback;
}

function parseTimestampMs(value) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return null;
  }
  const parsed = Date.parse(normalizedValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveXiaohongshuDownloadSessionMaxAgeMs(request = {}, profile = {}) {
  const explicitValue = normalizePositiveDurationMs(
    request.download?.sessionMaxAgeMs
    ?? request.download?.sidecarMaxAgeMs
    ?? request.sessionMaxAgeMs
    ?? profile?.downloader?.sessionMaxAgeMs
    ?? profile?.downloader?.sidecarMaxAgeMs
    ?? 0,
    0,
  );
  if (explicitValue > 0) {
    return explicitValue;
  }
  const keepaliveMs = normalizePositiveInteger(profile?.authSession?.keepaliveIntervalMinutes, 0) * 60_000;
  if (keepaliveMs > 0) {
    return Math.min(DEFAULT_SIDE_CAR_MAX_AGE_MS, keepaliveMs);
  }
  return DEFAULT_SIDE_CAR_MAX_AGE_MS;
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalizedValue = normalizeText(value).toLowerCase();
  if (normalizedValue === 'true') {
    return true;
  }
  if (normalizedValue === 'false') {
    return false;
  }
  return null;
}

function normalizeStringRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [normalizeText(key), normalizeText(entry)])
      .filter(([key, entry]) => key && entry),
  );
}

function resolveFirstValue(sources = [], reader) {
  for (const source of sources) {
    const value = reader(source);
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
}

function decodeEmbeddedJsonString(value = '') {
  return normalizeText(
    String(value ?? '')
      .replace(/\\"/gu, '"')
      .replace(/\\\//gu, '/')
      .replace(/\\\\/gu, '\\'),
  );
}

function extractEmbeddedJsonString(source = '', keys = []) {
  const text = String(source ?? '');
  for (const key of toArray(keys).map((entry) => normalizeText(entry)).filter(Boolean)) {
    const matched = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"])*)"`, 'iu'));
    if (matched?.[1]) {
      return decodeEmbeddedJsonString(matched[1]);
    }
  }
  return null;
}

function extractEmbeddedJsonBoolean(source = '', keys = []) {
  const text = String(source ?? '');
  for (const key of toArray(keys).map((entry) => normalizeText(entry)).filter(Boolean)) {
    const matched = text.match(new RegExp(`"${key}"\\s*:\\s*(true|false)`, 'iu'));
    if (matched?.[1]) {
      return normalizeBoolean(matched[1]);
    }
  }
  return null;
}

function extractEmbeddedJsonNumber(source = '', keys = []) {
  const text = String(source ?? '');
  for (const key of toArray(keys).map((entry) => normalizeText(entry)).filter(Boolean)) {
    const matched = text.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`, 'iu'));
    if (matched?.[1]) {
      return normalizePositiveInteger(matched[1], 0);
    }
  }
  return 0;
}

function findMatchingRecordKey(record = {}, pattern) {
  return Object.keys(normalizeStringRecord(record)).find((key) => pattern.test(key)) || null;
}

function applyQueryEntriesToUrl(url, queryEntries = {}) {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) {
    return null;
  }
  const normalizedQueryEntries = normalizeStringRecord(queryEntries);
  try {
    const parsed = new URL(normalizedUrl);
    for (const [key, value] of Object.entries(normalizedQueryEntries)) {
      parsed.searchParams.set(key, value);
    }
    return parsed.toString();
  } catch {
    return normalizedUrl;
  }
}

function buildBrowserWaitPolicy(timeoutMs = DEFAULT_TIMEOUT_MS) {
  return {
    useLoadEvent: false,
    useNetworkIdle: false,
    documentReadyTimeoutMs: timeoutMs,
    domQuietTimeoutMs: timeoutMs,
    domQuietMs: 400,
  };
}

function canonicalizeHeaderName(value) {
  const normalizedValue = normalizeText(value).toLowerCase();
  if (!normalizedValue) {
    return '';
  }
  const known = {
    cookie: 'Cookie',
    referer: 'Referer',
    origin: 'Origin',
    'user-agent': 'User-Agent',
    'accept-language': 'Accept-Language',
    'cache-control': 'Cache-Control',
  };
  if (known[normalizedValue]) {
    return known[normalizedValue];
  }
  return normalizedValue
    .split('-')
    .map((entry) => entry ? `${entry[0].toUpperCase()}${entry.slice(1)}` : '')
    .join('-');
}

function normalizeHeaderEntries(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers ?? {})
      .map(([key, value]) => [canonicalizeHeaderName(key), normalizeText(value)])
      .filter(([key, value]) => key && value),
  );
}

function mergeHeaderMaps(...maps) {
  return Object.assign({}, ...maps.map((entry) => normalizeHeaderEntries(entry)));
}

function filterCookiesForHost(cookies, host) {
  const normalizedHost = normalizeText(host).replace(/^\./u, '').toLowerCase();
  return toArray(cookies).filter((cookie) => {
    const domain = normalizeText(cookie?.domain).replace(/^\./u, '').toLowerCase();
    return domain && (domain === normalizedHost || domain.endsWith(`.${normalizedHost}`));
  });
}

function buildCookieHeader(cookies) {
  return filterCookiesForHost(cookies, 'xiaohongshu.com')
    .map((cookie) => {
      const name = normalizeText(cookie?.name);
      const value = String(cookie?.value ?? '').trim();
      return name ? `${name}=${value}` : null;
    })
    .filter(Boolean)
    .join('; ');
}

function mergeResolvedDownloadHeaders(baseHeaders, sessionHeaders, finalUrl) {
  return mergeHeaderMaps(
    baseHeaders,
    sessionHeaders,
    {
      Referer: normalizeUrl(finalUrl) || normalizeText(finalUrl),
      Origin: 'https://www.xiaohongshu.com',
    },
  );
}

function preferText(...values) {
  const normalizedValues = values
    .map((value) => normalizeText(value))
    .filter(Boolean);
  if (!normalizedValues.length) {
    return null;
  }
  return normalizedValues.sort((left, right) => right.length - left.length)[0] ?? null;
}

function extractXiaohongshuInitialState(html = '') {
  const source = String(html ?? '');
  const matched = source.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/iu);
  if (!matched?.[1]) {
    return null;
  }
  try {
    return JSON.parse(matched[1]);
  } catch {
    return null;
  }
}

function extractXiaohongshuImageCount(candidate = {}) {
  const sources = [
    candidate,
    candidate.noteCard,
    candidate.card,
    candidate.item,
  ].filter(Boolean);
  for (const source of sources) {
    for (const key of ['imageCount', 'imagesCount', 'imgCount', 'coverCount', 'mediaCount', 'photoCount']) {
      const value = normalizePositiveInteger(source?.[key]);
      if (value > 0) {
        return value;
      }
    }
    for (const key of ['imageList', 'images', 'imgList', 'imageInfoList', 'noteImageList', 'medias']) {
      if (Array.isArray(source?.[key]) && source[key].length > 0) {
        return source[key].length;
      }
    }
  }
  return 0;
}

function normalizeXiaohongshuAuthorFields(author = {}, fallback = {}) {
  const source = author && typeof author === 'object' ? author : {};
  const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
  const authorUserId = normalizeText(
    source.userId
    || source.userid
    || source.id
    || source.user_id
    || fallbackSource.authorUserId
    || fallbackSource.userId
    || extractXiaohongshuAuthorUserId(fallbackSource.authorUrl)
    || '',
  ) || null;
  const authorUrl = normalizeUrl(
    source.authorUrl
    || source.url
    || source.href
    || fallbackSource.authorUrl
    || buildXiaohongshuAuthorUrl(authorUserId)
    || '',
  ) || null;
  return {
    authorName: normalizeText(
      source.nickname
      || source.name
      || source.userName
      || source.username
      || fallbackSource.authorName
      || '',
    ) || null,
    authorUrl,
    authorUserId: authorUserId || extractXiaohongshuAuthorUserId(authorUrl),
    userId: authorUserId || extractXiaohongshuAuthorUserId(authorUrl),
  };
}

function normalizeXiaohongshuCandidate(rawCandidate = {}, {
  fallbackAuthor = {},
  queryText = null,
  sourceType = null,
  sourceOrder = Number.MAX_SAFE_INTEGER,
  baseUrl = undefined,
} = {}) {
  const wrapper = rawCandidate && typeof rawCandidate === 'object' ? rawCandidate : {};
  const noteCard = wrapper.noteCard && typeof wrapper.noteCard === 'object' ? wrapper.noteCard : wrapper;
  const xsecToken = normalizeText(
    noteCard.xsecToken
    || noteCard.xsec_token
    || wrapper.xsecToken
    || wrapper.xsec_token
    || readUrlSearchParam(noteCard.navigationUrl, 'xsec_token')
    || readUrlSearchParam(noteCard.url, 'xsec_token')
    || readUrlSearchParam(wrapper.navigationUrl, 'xsec_token')
    || readUrlSearchParam(wrapper.url, 'xsec_token')
    || '',
  ) || null;
  const xsecSource = normalizeText(
    noteCard.xsecSource
    || noteCard.xsec_source
    || wrapper.xsecSource
    || wrapper.xsec_source
    || readUrlSearchParam(noteCard.navigationUrl, 'xsec_source')
    || readUrlSearchParam(noteCard.url, 'xsec_source')
    || readUrlSearchParam(wrapper.navigationUrl, 'xsec_source')
    || readUrlSearchParam(wrapper.url, 'xsec_source')
    || '',
  ) || null;
  const noteId = normalizeText(
    noteCard.noteId
    || noteCard.id
    || noteCard.note_id
    || wrapper.noteId
    || wrapper.id
    || extractXiaohongshuNoteId(noteCard.url)
    || extractXiaohongshuNoteId(noteCard.navigationUrl)
    || extractXiaohongshuNoteId(wrapper.url)
    || '',
  ) || null;
  const url = normalizeUrl(
    noteCard.url
    || noteCard.navigationUrl
    || noteCard.href
    || wrapper.url
    || wrapper.navigationUrl
    || wrapper.href
    || buildXiaohongshuNoteUrl(noteId)
    || '',
    baseUrl,
  ) || buildXiaohongshuNoteUrl(noteId);
  const authorFields = normalizeXiaohongshuAuthorFields(
    noteCard.user ?? noteCard.author ?? wrapper.user ?? wrapper.author ?? {},
    fallbackAuthor,
  );
  const candidate = {
    noteId: noteId || extractXiaohongshuNoteId(url),
    title: normalizeText(
      noteCard.displayTitle
      || noteCard.title
      || noteCard.noteTitle
      || wrapper.displayTitle
      || wrapper.title
      || noteCard.desc
      || wrapper.desc
      || '',
    ) || null,
    excerpt: normalizeText(
      noteCard.desc
      || noteCard.summary
      || noteCard.content
      || wrapper.desc
      || wrapper.summary
      || '',
    ) || null,
    url,
    navigationUrl: normalizeUrl(
      noteCard.navigationUrl
      || noteCard.url
      || noteCard.href
      || wrapper.navigationUrl
      || wrapper.url
      || wrapper.href
      || url
      || '',
      baseUrl,
    ) || url,
    contentType: normalizeText(
      noteCard.type
      || noteCard.noteType
      || noteCard.cardType
      || wrapper.type
      || wrapper.contentType
      || '',
    ) || null,
    imageCount: extractXiaohongshuImageCount(noteCard) || extractXiaohongshuImageCount(wrapper),
    tagNames: uniqueStrings([
      ...toArray(noteCard.tagList).map((entry) => entry?.name ?? entry?.text ?? entry),
      ...toArray(wrapper.tagList).map((entry) => entry?.name ?? entry?.text ?? entry),
    ]),
    queryText: normalizeText(queryText) || null,
    sourceType: normalizeText(sourceType) || null,
    sourceOrder: Number.isFinite(Number(sourceOrder)) ? Number(sourceOrder) : Number.MAX_SAFE_INTEGER,
    xsecToken,
    xsecSource,
    ...authorFields,
  };
  return candidate.noteId || candidate.url || candidate.title ? candidate : null;
}

function mergeXiaohongshuCandidates(...lists) {
  const mergedCandidates = [];
  const keyToIndex = new Map();
  const buildKeys = (candidate) => dedupeBy([
    candidate.noteId ? `note:${candidate.noteId}` : null,
    candidate.url ? `url:${candidate.url}` : null,
    candidate.navigationUrl ? `nav:${candidate.navigationUrl}` : null,
    candidate.title && candidate.authorUserId ? `title-author:${candidate.title}::${candidate.authorUserId}` : null,
    candidate.title ? `title:${candidate.title}` : null,
  ].filter(Boolean), (value) => value);
  for (const rawCandidate of toArray(lists).flat()) {
    if (!rawCandidate) {
      continue;
    }
    const candidate = rawCandidate;
    const keys = buildKeys(candidate);
    const matchedIndex = keys
      .map((key) => keyToIndex.get(key))
      .find((value) => Number.isInteger(value));
    if (!Number.isInteger(matchedIndex)) {
      mergedCandidates.push(candidate);
      for (const key of keys) {
        keyToIndex.set(key, mergedCandidates.length - 1);
      }
      continue;
    }
    const existing = mergedCandidates[matchedIndex];
    const merged = {
      ...existing,
      ...candidate,
      noteId: normalizeText(existing.noteId || candidate.noteId) || null,
      title: preferText(existing.title, candidate.title),
      excerpt: preferText(existing.excerpt, candidate.excerpt),
      url: normalizeText(existing.url || candidate.url) || null,
      navigationUrl: normalizeText(existing.navigationUrl || candidate.navigationUrl || existing.url || candidate.url) || null,
      contentType: normalizeText(existing.contentType || candidate.contentType) || null,
      imageCount: Math.max(
        normalizePositiveInteger(existing.imageCount),
        normalizePositiveInteger(candidate.imageCount),
      ),
      tagNames: uniqueStrings([...(existing.tagNames ?? []), ...(candidate.tagNames ?? [])]),
      authorName: preferText(existing.authorName, candidate.authorName),
      authorUrl: normalizeText(existing.authorUrl || candidate.authorUrl) || null,
      authorUserId: normalizeText(existing.authorUserId || candidate.authorUserId) || null,
      userId: normalizeText(existing.userId || candidate.userId || existing.authorUserId || candidate.authorUserId) || null,
      queryText: preferText(existing.queryText, candidate.queryText),
      sourceType: preferText(existing.sourceType, candidate.sourceType),
      sourceOrder: Math.min(
        Number.isFinite(Number(existing.sourceOrder)) ? Number(existing.sourceOrder) : Number.MAX_SAFE_INTEGER,
        Number.isFinite(Number(candidate.sourceOrder)) ? Number(candidate.sourceOrder) : Number.MAX_SAFE_INTEGER,
      ),
    };
    mergedCandidates[matchedIndex] = merged;
    for (const key of buildKeys(merged)) {
      keyToIndex.set(key, matchedIndex);
    }
  }
  return mergedCandidates;
}

function buildCandidateSearchText(candidate = {}) {
  return [
    candidate.title,
    candidate.excerpt,
    candidate.authorName,
    ...(Array.isArray(candidate.tagNames) ? candidate.tagNames : []),
    candidate.contentType,
  ]
    .map((value) => normalizeText(value).toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function scoreQueryMatch(candidate = {}, queryText = null) {
  const normalizedQuery = normalizeText(queryText).toLowerCase();
  if (!normalizedQuery) {
    return 0;
  }
  const haystack = buildCandidateSearchText(candidate);
  if (!haystack) {
    return 0;
  }
  const tokens = dedupeBy(
    normalizedQuery.split(/[\s,/|]+/u).map((value) => normalizeText(value).toLowerCase()).filter(Boolean),
    (value) => value,
  );
  let score = haystack.includes(normalizedQuery) ? 30 : 0;
  if (!tokens.length) {
    return score;
  }
  const matchedTokens = tokens.filter((token) => haystack.includes(token));
  score += matchedTokens.length * 9;
  if (tokens.length > 1 && matchedTokens.length === tokens.length) {
    score += 8;
  }
  return score;
}

function scoreXiaohongshuCandidate(candidate = {}, { queryText = null } = {}) {
  const contentType = normalizeText(candidate.contentType).toLowerCase();
  let score = 0;
  if (contentType === 'normal') {
    score += 40;
  } else if (contentType) {
    score -= 25;
  }
  score += Math.min(normalizePositiveInteger(candidate.imageCount), 12) * 6;
  score += scoreQueryMatch(candidate, queryText || candidate.queryText);
  if (candidate.url) {
    score += 4;
  }
  if (candidate.noteId) {
    score += 3;
  }
  if (candidate.authorUserId) {
    score += 1;
  }
  return score;
}

function sortXiaohongshuCandidates(candidates, { queryText = null } = {}) {
  return [...candidates]
    .map((candidate, index) => ({
      ...candidate,
      score: scoreXiaohongshuCandidate(candidate, { queryText }),
      sourceOrder: Number.isFinite(Number(candidate.sourceOrder)) ? Number(candidate.sourceOrder) : index,
    }))
    .sort((left, right) => (
      (right.score - left.score)
      || (normalizePositiveInteger(right.imageCount) - normalizePositiveInteger(left.imageCount))
      || (normalizeText(right.contentType) === 'normal' ? 1 : 0) - (normalizeText(left.contentType) === 'normal' ? 1 : 0)
      || (left.sourceOrder - right.sourceOrder)
    ));
}

function classifyXiaohongshuCandidatePrefilterPhase(candidate = {}) {
  const contentType = normalizeText(candidate.contentType).toLowerCase();
  const imageCount = normalizePositiveInteger(candidate.imageCount, 0);
  const hasResolvableTarget = Boolean(candidate.url || candidate.noteId);
  if (!hasResolvableTarget) {
    return { phase: 'dropped', reason: 'missing-target' };
  }
  if (contentType && contentType !== 'normal') {
    return { phase: 'dropped', reason: `content-type:${contentType}` };
  }
  if (contentType === 'normal' && imageCount > 0) {
    return { phase: 'primary', reason: 'normal-with-images' };
  }
  if (contentType === 'normal') {
    return { phase: 'primary', reason: 'normal-type' };
  }
  if (imageCount > 0) {
    return { phase: 'secondary', reason: 'images-without-type' };
  }
  return { phase: 'fallback', reason: 'detail-required' };
}

function buildCandidateResolutionPlan(candidates, request) {
  const limit = getRequestedDownloadLimit(request);
  const rankedCandidates = sortXiaohongshuCandidates(mergeXiaohongshuCandidates(candidates));
  const grouped = {
    primary: [],
    secondary: [],
    fallback: [],
    dropped: [],
  };
  for (const candidate of rankedCandidates) {
    const prefilter = classifyXiaohongshuCandidatePrefilterPhase(candidate);
    const annotatedCandidate = {
      ...candidate,
      prefilterPhase: prefilter.phase,
      prefilterReason: prefilter.reason,
    };
    grouped[prefilter.phase].push(annotatedCandidate);
  }
  const detailBudget = Math.min(
    rankedCandidates.length,
    Math.max(limit * 3, limit + 4, 8),
  );
  const orderedCandidates = [];
  const seen = new Set();
  const appendCandidates = (entries, budget = entries.length) => {
    let remaining = Math.max(0, normalizePositiveInteger(budget, 0) || 0);
    for (const candidate of entries) {
      if (orderedCandidates.length >= detailBudget || remaining <= 0) {
        return;
      }
      const candidateKey = normalizeText(candidate.noteId || candidate.url || `${candidate.title || ''}::${candidate.authorUserId || ''}`);
      if (!candidateKey || seen.has(candidateKey)) {
        continue;
      }
      seen.add(candidateKey);
      orderedCandidates.push(candidate);
      remaining -= 1;
    }
  };
  appendCandidates(grouped.primary, Math.max(limit * 2, limit + 1, 3));
  appendCandidates(grouped.secondary, Math.max(limit + 2, 3));
  appendCandidates(grouped.fallback, Math.max(limit, 2));
  appendCandidates(grouped.primary);
  appendCandidates(grouped.secondary);
  appendCandidates(grouped.fallback);
  return {
    orderedCandidates,
    diagnostics: {
      candidatePoolSize: rankedCandidates.length,
      shortlistedCandidates: orderedCandidates.length,
      droppedCandidates: grouped.dropped.length,
      phaseCounts: {
        primary: grouped.primary.length,
        secondary: grouped.secondary.length,
        fallback: grouped.fallback.length,
        dropped: grouped.dropped.length,
      },
      detailBudget,
    },
  };
}

function buildSearchCandidates(signature = {}) {
  const pageFacts = signature?.pageFacts ?? {};
  const initialState = extractXiaohongshuInitialState(signature?.html);
  const queryText = normalizeText(
    pageFacts.queryText
    || initialState?.search?.searchContext?.keyword
    || initialState?.search?.searchValue
    || '',
  ) || null;
  const pageFactCandidates = Array.isArray(pageFacts.resultEntries)
    ? pageFacts.resultEntries.map((entry, index) => normalizeXiaohongshuCandidate(entry, {
      queryText,
      sourceType: 'search-page-facts',
      sourceOrder: index,
      baseUrl: signature?.finalUrl,
    })).filter(Boolean)
    : [];
  const stateCandidates = Array.isArray(initialState?.search?.feeds)
    ? initialState.search.feeds.map((entry, index) => normalizeXiaohongshuCandidate(entry, {
      queryText,
      sourceType: 'search-initial-state',
      sourceOrder: index,
      baseUrl: signature?.finalUrl,
    })).filter(Boolean)
    : [];
  return sortXiaohongshuCandidates(
    mergeXiaohongshuCandidates(pageFactCandidates, stateCandidates),
    { queryText },
  );
}

function buildAuthorCandidates(signature = {}, { queryText = null } = {}) {
  const pageFacts = signature?.pageFacts ?? {};
  const initialState = extractXiaohongshuInitialState(signature?.html);
  const fallbackAuthor = {
    authorName: pageFacts.authorName,
    authorUrl: pageFacts.authorUrl,
    authorUserId: pageFacts.authorUserId || pageFacts.userId,
  };
  const pageFactCandidates = Array.isArray(pageFacts.featuredContentCards)
    ? pageFacts.featuredContentCards.map((entry, index) => normalizeXiaohongshuCandidate(entry, {
      fallbackAuthor,
      queryText,
      sourceType: 'author-page-facts',
      sourceOrder: index,
      baseUrl: signature?.finalUrl,
    })).filter(Boolean)
    : [];
  const stateCandidates = toArray(initialState?.user?.notes)
    .flatMap((group) => toArray(group))
    .map((entry, index) => normalizeXiaohongshuCandidate(entry, {
      fallbackAuthor,
      queryText,
      sourceType: 'author-initial-state',
      sourceOrder: index,
      baseUrl: signature?.finalUrl,
    }))
    .filter(Boolean);
  return sortXiaohongshuCandidates(
    mergeXiaohongshuCandidates(pageFactCandidates, stateCandidates),
    { queryText },
  );
}

function extractAuthorPageNumber(authorUrl) {
  try {
    const parsed = new URL(authorUrl);
    return normalizePositiveInteger(parsed.searchParams.get('page'), 1) || 1;
  } catch {
    return 1;
  }
}

function buildAuthorPageUrl(authorUrl, pageNumber) {
  const normalizedAuthorUrl = normalizeUrl(authorUrl);
  if (!normalizedAuthorUrl) {
    return null;
  }
  try {
    const parsed = new URL(normalizedAuthorUrl);
    const normalizedPageNumber = Math.max(1, normalizePositiveInteger(pageNumber, 1));
    if (normalizedPageNumber <= 1) {
      parsed.searchParams.delete('page');
    } else {
      parsed.searchParams.set('page', String(normalizedPageNumber));
    }
    return parsed.toString();
  } catch {
    return normalizedAuthorUrl;
  }
}

function normalizeAuthorResumeState(rawState, fallbackAuthorUrl = null) {
  if (!rawState) {
    return null;
  }
  let source = rawState;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      source = { nextPageUrl: source };
    }
  }
  if (!source || typeof source !== 'object') {
    return null;
  }
  if (source.nextResumeState && typeof source.nextResumeState === 'object') {
    source = source.nextResumeState;
  } else if (
    source.resumeState
    && typeof source.resumeState === 'object'
    && !source.nextPageUrl
    && !source.cursor
    && !source.continuation
  ) {
    source = source.resumeState;
  }
  const query = normalizeStringRecord(source.query ?? source.queryParams ?? source.params);
  const authorUrl = normalizeUrl(
    source.authorUrl
    || source.profileUrl
    || source.userUrl
    || source.url
    || fallbackAuthorUrl
    || '',
    fallbackAuthorUrl,
  ) || normalizeUrl(fallbackAuthorUrl);
  const cursorParamKey = normalizeText(
    source.cursorParamKey
    || source.cursorKey
    || findMatchingRecordKey(query, /cursor/iu)
    || '',
  ) || null;
  const continuationParamKey = normalizeText(
    source.continuationParamKey
    || source.continuationKey
    || findMatchingRecordKey(query, /continuation|token/iu)
    || '',
  ) || null;
  return {
    authorUrl,
    authorUserId: normalizeText(
      source.authorUserId
      || source.userId
      || extractXiaohongshuAuthorUserId(authorUrl)
      || '',
    ) || null,
    nextPageUrl: normalizeUrl(
      source.nextPageUrl
      || source.pageUrl
      || source.resumeUrl
      || '',
      authorUrl || fallbackAuthorUrl,
    ) || null,
    page: Math.max(
      normalizePositiveInteger(
        source.page
        || source.pageNum
        || source.pageIndex
        || source.nextPage
        || 0,
        0,
      ),
      extractAuthorPageNumber(source.nextPageUrl || source.pageUrl || authorUrl || ''),
    ),
    hasMore: normalizeBoolean(source.hasMore),
    cursor: normalizeText(
      source.cursor
      || source.nextCursor
      || source.pageCursor
      || source.noteCursor
      || (cursorParamKey ? query[cursorParamKey] : '')
      || '',
    ) || null,
    continuation: normalizeText(
      source.continuation
      || source.continuationToken
      || source.nextContinuation
      || source.pageToken
      || (continuationParamKey ? query[continuationParamKey] : '')
      || '',
    ) || null,
    pageSize: normalizePositiveInteger(
      source.pageSize
      || source.page_size
      || source.num
      || source.limit
      || 0,
      0,
    ),
    cursorParamKey,
    continuationParamKey,
    query,
    strategy: normalizeText(source.strategy || source.source || '') || null,
  };
}

function normalizeAuthorResumeStates(request = {}) {
  return toArray(request.download?.authorResumeState ?? request.authorResumeState ?? request.download?.resumeState ?? [])
    .map((entry) => normalizeAuthorResumeState(entry))
    .filter(Boolean);
}

function resolveMatchingAuthorResumeState(authorUrl, resumeStates = [], { allowSingleFallback = false } = {}) {
  const normalizedAuthorUrl = normalizeUrl(authorUrl);
  const authorUserId = extractXiaohongshuAuthorUserId(normalizedAuthorUrl);
  for (const resumeState of resumeStates) {
    if (!resumeState) {
      continue;
    }
    if (resumeState.authorUrl && normalizedAuthorUrl && resumeState.authorUrl === normalizedAuthorUrl) {
      return resumeState;
    }
    if (resumeState.authorUserId && authorUserId && resumeState.authorUserId === authorUserId) {
      return resumeState;
    }
  }
  if (allowSingleFallback && resumeStates.length === 1) {
    return resumeStates[0];
  }
  return null;
}

function readXiaohongshuContinuationState(html = '', {
  authorUrl = null,
  finalUrl = null,
} = {}) {
  const initialState = extractXiaohongshuInitialState(html);
  const userState = initialState?.user ?? {};
  const userPageData = userState?.userPageData ?? initialState?.userPageData ?? {};
  const stateSources = [
    userState?.notesPageInfo,
    userState?.notePageInfo,
    userState?.pageInfo,
    userState?.pagination,
    userState?.continuation,
    userPageData?.notesPageInfo,
    userPageData?.notePageInfo,
    userPageData?.pageInfo,
    userPageData?.pagination,
    userPageData?.continuation,
    userState,
    userPageData,
  ].filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
  const stateQuery = Object.assign(
    {},
    ...stateSources.map((entry) => normalizeStringRecord(entry?.query ?? entry?.queryParams ?? entry?.params)),
  );
  const nextPageUrl = resolveFirstValue(stateSources, (entry) => normalizeUrl(
    entry?.nextPageUrl
    || entry?.nextUrl
    || entry?.nextPagePath
    || entry?.continuationUrl
    || '',
    finalUrl || authorUrl,
  )) || normalizeUrl(
    extractEmbeddedJsonString(html, ['nextPageUrl', 'nextUrl', 'nextPagePath', 'continuationUrl']) || '',
    finalUrl || authorUrl,
  );
  let nextPageQuery = {};
  if (nextPageUrl) {
    try {
      nextPageQuery = normalizeStringRecord(Object.fromEntries(new URL(nextPageUrl).searchParams.entries()));
    } catch {
      nextPageQuery = {};
    }
  }
  const combinedQuery = {
    ...stateQuery,
    ...nextPageQuery,
  };
  const cursorParamKey = findMatchingRecordKey(combinedQuery, /cursor/iu);
  const continuationParamKey = findMatchingRecordKey(combinedQuery, /continuation|token/iu);
  return {
    authorUrl: normalizeUrl(authorUrl || finalUrl || '') || null,
    authorUserId: extractXiaohongshuAuthorUserId(authorUrl || finalUrl || ''),
    hasMore: resolveFirstValue(stateSources, (entry) => normalizeBoolean(
      entry?.hasMore
      ?? entry?.hasNext
      ?? entry?.more,
    )) ?? extractEmbeddedJsonBoolean(html, ['hasMore', 'hasNext', 'more']),
    nextPageUrl,
    currentPage: Math.max(
      extractAuthorPageNumber(finalUrl || authorUrl || ''),
      resolveFirstValue(stateSources, (entry) => normalizePositiveInteger(
        entry?.page
        || entry?.pageNum
        || entry?.pageIndex
        || entry?.currentPage
        || 0,
        0,
      )) || 0,
      extractEmbeddedJsonNumber(html, ['page', 'pageNum', 'pageIndex', 'currentPage']),
    ),
    pageSize: resolveFirstValue(stateSources, (entry) => normalizePositiveInteger(
      entry?.pageSize
      || entry?.page_size
      || entry?.num
      || entry?.limit
      || 0,
      0,
    )) || extractEmbeddedJsonNumber(html, ['pageSize', 'page_size', 'num', 'limit']),
    cursor: resolveFirstValue(stateSources, (entry) => normalizeText(
      entry?.nextCursor
      || entry?.cursor
      || entry?.pageCursor
      || entry?.noteCursor
      || entry?.loadMoreCursor
      || '',
    )) || (cursorParamKey ? normalizeText(combinedQuery[cursorParamKey]) || null : null)
      || extractEmbeddedJsonString(html, ['nextCursor', 'cursor', 'pageCursor', 'noteCursor', 'loadMoreCursor']),
    continuation: resolveFirstValue(stateSources, (entry) => normalizeText(
      entry?.continuation
      || entry?.continuationToken
      || entry?.nextContinuation
      || entry?.pageToken
      || entry?.loadMoreToken
      || '',
    )) || (continuationParamKey ? normalizeText(combinedQuery[continuationParamKey]) || null : null)
      || extractEmbeddedJsonString(html, ['continuation', 'continuationToken', 'nextContinuation', 'pageToken', 'loadMoreToken']),
    cursorParamKey,
    continuationParamKey,
    query: combinedQuery,
  };
}

function hasXiaohongshuCursorHint(state = {}) {
  const query = normalizeStringRecord(state?.query);
  return Boolean(
    normalizeText(state?.cursor)
    || normalizeText(state?.continuation)
    || Object.keys(query).some((key) => /cursor|continuation|token/iu.test(key)),
  );
}

function createAuthorContinuationTarget(authorUrl, continuationState = {}, {
  baseUrl = undefined,
  strategy = null,
} = {}) {
  const canonicalAuthorUrl = normalizeUrl(
    continuationState.authorUrl
    || authorUrl
    || '',
    baseUrl,
  );
  if (!canonicalAuthorUrl) {
    return null;
  }
  const cursorParamKey = normalizeText(
    continuationState.cursorParamKey
    || findMatchingRecordKey(continuationState.query, /cursor/iu)
    || '',
  ) || null;
  const continuationParamKey = normalizeText(
    continuationState.continuationParamKey
    || findMatchingRecordKey(continuationState.query, /continuation|token/iu)
    || '',
  ) || null;
  const normalizedPage = Math.max(
    normalizePositiveInteger(continuationState.page, 0),
    extractAuthorPageNumber(continuationState.nextPageUrl || canonicalAuthorUrl),
  );
  const query = {
    ...normalizeStringRecord(continuationState.query),
  };
  if (cursorParamKey && continuationState.cursor) {
    query[cursorParamKey] = normalizeText(continuationState.cursor);
  } else if (continuationState.cursor) {
    query.cursor = normalizeText(continuationState.cursor);
  }
  if (continuationParamKey && continuationState.continuation) {
    query[continuationParamKey] = normalizeText(continuationState.continuation);
  } else if (continuationState.continuation) {
    query.continuation = normalizeText(continuationState.continuation);
  }
  const pageParamKey = findMatchingRecordKey(query, /^page$/iu) || findMatchingRecordKey(query, /page/iu);
  if (normalizedPage > 1) {
    query[pageParamKey || 'page'] = String(normalizedPage);
  } else if (pageParamKey) {
    delete query[pageParamKey];
  }
  const targetUrl = applyQueryEntriesToUrl(
    normalizeUrl(continuationState.nextPageUrl || canonicalAuthorUrl, baseUrl) || canonicalAuthorUrl,
    query,
  );
  return targetUrl ? {
    url: targetUrl,
    authorUrl: canonicalAuthorUrl,
    authorUserId: normalizeText(
      continuationState.authorUserId
      || extractXiaohongshuAuthorUserId(canonicalAuthorUrl)
      || '',
    ) || null,
    page: normalizedPage || 1,
    cursor: normalizeText(continuationState.cursor) || null,
    continuation: normalizeText(continuationState.continuation) || null,
    pageSize: normalizePositiveInteger(continuationState.pageSize, 0),
    cursorParamKey,
    continuationParamKey,
    query,
    strategy: normalizeText(strategy || continuationState.strategy || '') || null,
  } : null;
}

function buildAuthorContinuationTargetKey(target = {}) {
  return dedupeBy([
    normalizeText(target.url),
    normalizeText(target.cursor),
    normalizeText(target.continuation),
    normalizePositiveInteger(target.page, 0) > 0 ? String(normalizePositiveInteger(target.page, 0)) : null,
  ].filter(Boolean), (value) => value).join('|');
}

function buildAuthorResumeStateFromTarget(target = {}, fallback = {}) {
  if (!target?.url) {
    return null;
  }
  return {
    authorUrl: normalizeUrl(target.authorUrl || fallback.authorUrl || '') || null,
    authorUserId: normalizeText(
      target.authorUserId
      || fallback.authorUserId
      || extractXiaohongshuAuthorUserId(target.authorUrl || fallback.authorUrl || '')
      || '',
    ) || null,
    nextPageUrl: normalizeUrl(target.url, target.authorUrl || fallback.authorUrl) || null,
    page: normalizePositiveInteger(target.page, 0) || null,
    hasMore: true,
    cursor: normalizeText(target.cursor) || null,
    continuation: normalizeText(target.continuation) || null,
    pageSize: normalizePositiveInteger(target.pageSize, 0) || null,
    cursorParamKey: normalizeText(target.cursorParamKey) || null,
    continuationParamKey: normalizeText(target.continuationParamKey) || null,
    query: normalizeStringRecord(target.query),
    strategy: normalizeText(target.strategy) || null,
  };
}

function buildAuthorPageFingerprint(signature = {}, candidates = []) {
  const pageFacts = signature?.pageFacts ?? {};
  const noteIds = Array.isArray(pageFacts.featuredContentNoteIds) ? pageFacts.featuredContentNoteIds : [];
  const urls = Array.isArray(pageFacts.featuredContentUrls) ? pageFacts.featuredContentUrls : [];
  const fingerprintParts = [
    normalizeText(signature?.finalUrl),
    ...noteIds.map((value) => `note:${normalizeText(value)}`).filter(Boolean),
    ...urls.map((value) => `url:${normalizeText(value)}`).filter(Boolean),
    ...candidates.map((candidate) => candidate.noteId ? `candidate:${candidate.noteId}` : `candidate-url:${candidate.url}`).filter(Boolean),
  ];
  return fingerprintParts.length ? fingerprintParts.join('|') : null;
}

function getRequestedDownloadLimit(request) {
  return Math.max(1, normalizePositiveInteger(request.download?.maxItems ?? request.limit ?? 10, 10));
}

function getAuthorPageLimit(request) {
  const downloadLimit = getRequestedDownloadLimit(request);
  const fallbackLimit = Math.max(2, Math.min(downloadLimit * 2, 8));
  return Math.max(1, normalizePositiveInteger(request.download?.authorPageLimit ?? request.authorPageLimit ?? fallbackLimit, fallbackLimit));
}

function buildAuthorContinuationTargets(authorUrl, signature, request) {
  const normalizedAuthorUrl = normalizeUrl(authorUrl);
  if (!normalizedAuthorUrl) {
    return {
      continuationState: null,
      targets: [],
    };
  }
  const continuationState = readXiaohongshuContinuationState(signature?.html, {
    authorUrl: normalizedAuthorUrl,
    finalUrl: signature?.finalUrl,
  });
  const targets = [];
  const currentPage = Math.max(
    extractAuthorPageNumber(signature?.finalUrl || normalizedAuthorUrl),
    continuationState.currentPage || 0,
    1,
  );
  const nextPage = currentPage + 1;
  if (continuationState.hasMore !== false && continuationState.nextPageUrl) {
    targets.push(createAuthorContinuationTarget(normalizedAuthorUrl, {
      ...continuationState,
      page: nextPage,
    }, {
      baseUrl: signature?.finalUrl,
      strategy: 'next-page-url',
    }));
  }
  if (continuationState.hasMore !== false && hasXiaohongshuCursorHint(continuationState)) {
    targets.push(createAuthorContinuationTarget(normalizedAuthorUrl, {
      ...continuationState,
      nextPageUrl: null,
      page: nextPage,
    }, {
      baseUrl: signature?.finalUrl,
      strategy: 'cursor',
    }));
  }
  if (continuationState.hasMore !== false) {
    targets.push(createAuthorContinuationTarget(normalizedAuthorUrl, {
      authorUrl: normalizedAuthorUrl,
      page: nextPage,
    }, {
      baseUrl: signature?.finalUrl,
      strategy: 'page',
    }));
  }
  return {
    continuationState,
    targets: dedupeBy(
      targets.filter(Boolean),
      (target) => buildAuthorContinuationTargetKey(target),
    ),
  };
}

function filterAuthorCandidatesByResumeState(candidates, resumeState = null) {
  const seenNoteIds = new Set(uniqueStrings(resumeState?.seenNoteIds ?? resumeState?.resolvedNoteIds ?? []));
  const seenNoteUrls = new Set(
    uniqueStrings(resumeState?.seenNoteUrls ?? resumeState?.resolvedInputs ?? [])
      .map((value) => normalizeUrl(value) || normalizeText(value))
      .filter(Boolean),
  );
  if (!seenNoteIds.size && !seenNoteUrls.size) {
    return candidates;
  }
  return candidates.filter((candidate) => {
    const normalizedUrl = normalizeUrl(candidate.url) || normalizeText(candidate.url);
    return !seenNoteIds.has(candidate.noteId) && !seenNoteUrls.has(normalizedUrl);
  });
}

async function collectAuthorCandidates(authorUrl, request, profile, deps = {}) {
  const startUrl = normalizeUrl(authorUrl);
  if (!startUrl) {
    return {
      candidates: [],
      diagnostics: {
        attemptedPages: 0,
      },
    };
  }
  const resumeState = normalizeAuthorResumeState(deps.authorResumeState, startUrl);
  const initialTarget = createAuthorContinuationTarget(startUrl, resumeState || {
    authorUrl: startUrl,
    nextPageUrl: startUrl,
    page: extractAuthorPageNumber(startUrl),
  }, {
    baseUrl: startUrl,
    strategy: resumeState ? 'resume' : 'start',
  });
  const seenPageTargets = new Set();
  const seenPageFingerprints = new Set();
  const queuedPageTargets = new Set();
  const pendingPageTargets = [];
  const pageLimit = getAuthorPageLimit(request);
  const fetchSignature = deps.fetchPageSignature ?? (async (url) => await fetchPageSignature(url, request, profile, deps));
  let mergedCandidates = [];
  let firstError = null;
  let attemptedPages = 0;
  let failedTarget = null;
  let authorMeta = {
    authorUrl: startUrl,
    authorUserId: extractXiaohongshuAuthorUserId(startUrl),
  };
  let lastVisitedUrl = null;
  let lastVisitedPage = null;
  let deferredResumeTarget = null;
  const continuationStrategies = [];
  const enqueueTarget = (target) => {
    const key = buildAuthorContinuationTargetKey(target);
    if (!target?.url || !key || seenPageTargets.has(key) || queuedPageTargets.has(key)) {
      return;
    }
    if (normalizePositiveInteger(target.page, 0) > pageLimit) {
      deferredResumeTarget = deferredResumeTarget ?? target;
      return;
    }
    pendingPageTargets.push(target);
    queuedPageTargets.add(key);
  };
  enqueueTarget(initialTarget);
  while (pendingPageTargets.length && attemptedPages < pageLimit) {
    const pageTarget = pendingPageTargets.shift();
    const pageTargetKey = buildAuthorContinuationTargetKey(pageTarget);
    queuedPageTargets.delete(pageTargetKey);
    if (!pageTarget?.url || !pageTargetKey || seenPageTargets.has(pageTargetKey)) {
      continue;
    }
    seenPageTargets.add(pageTargetKey);
    attemptedPages += 1;
    continuationStrategies.push(normalizeText(pageTarget.strategy) || 'page');
    let signature = null;
    try {
      signature = await fetchSignature(pageTarget.url);
    } catch (error) {
      if (!firstError) {
        firstError = error;
      }
      failedTarget = pageTarget;
      break;
    }
    const pageFacts = signature?.pageFacts ?? {};
    authorMeta = {
      authorUrl: normalizeUrl(pageFacts.authorUrl || authorMeta.authorUrl || startUrl) || startUrl,
      authorUserId: normalizeText(
        pageFacts.authorUserId
        || pageFacts.userId
        || authorMeta.authorUserId
        || extractXiaohongshuAuthorUserId(authorMeta.authorUrl || startUrl)
        || '',
      ) || null,
    };
    lastVisitedUrl = normalizeUrl(signature.finalUrl || pageTarget.url) || pageTarget.url;
    lastVisitedPage = Math.max(
      normalizePositiveInteger(pageTarget.page, 0),
      extractAuthorPageNumber(signature.finalUrl || pageTarget.url),
      1,
    );
    const pageCandidates = buildAuthorCandidates(signature);
    const fingerprint = buildAuthorPageFingerprint(signature, pageCandidates);
    if (fingerprint && seenPageFingerprints.has(fingerprint)) {
      break;
    }
    if (fingerprint) {
      seenPageFingerprints.add(fingerprint);
    }
    mergedCandidates = mergeXiaohongshuCandidates(mergedCandidates, pageCandidates);
    const continuation = buildAuthorContinuationTargets(startUrl, signature, request);
    if (!pageCandidates.length && continuation.targets.length === 0) {
      break;
    }
    for (const nextTarget of continuation.targets) {
      enqueueTarget(nextTarget);
    }
  }
  if (!mergedCandidates.length && firstError) {
    throw firstError;
  }
  const nextResumeState = buildAuthorResumeStateFromTarget(
    failedTarget || pendingPageTargets[0] || deferredResumeTarget,
    authorMeta,
  );
  const seenNoteIds = uniqueStrings([
    ...(resumeState?.seenNoteIds ?? resumeState?.resolvedNoteIds ?? []),
    ...mergedCandidates.map((candidate) => candidate.noteId),
  ]);
  const seenNoteUrls = uniqueStrings([
    ...(resumeState?.seenNoteUrls ?? resumeState?.resolvedInputs ?? []),
    ...mergedCandidates.map((candidate) => candidate.url),
  ]);
  if (nextResumeState) {
    nextResumeState.seenNoteIds = seenNoteIds;
    nextResumeState.seenNoteUrls = seenNoteUrls;
    nextResumeState.resolvedNoteIds = seenNoteIds;
    nextResumeState.resolvedInputs = seenNoteUrls;
  }
  return {
    candidates: sortXiaohongshuCandidates(
      filterAuthorCandidatesByResumeState(mergedCandidates, resumeState),
    ),
    diagnostics: {
      attemptedPages,
      pageLimit,
      authorUrl: authorMeta.authorUrl,
      authorUserId: authorMeta.authorUserId,
      resumeApplied: Boolean(resumeState),
      exhausted: !nextResumeState,
      lastVisitedUrl,
      lastVisitedPage,
      seenNoteIds,
      seenNoteUrls,
      continuationStrategies: dedupeBy(
        continuationStrategies.filter(Boolean),
        (value) => value,
      ),
      nextResumeState,
    },
  };
}

async function resolveXiaohongshuPassthroughSidecarContext(deps = {}, options = {}) {
  const env = deps.env ?? process.env;
  const sidecarPath = normalizeText(env?.BWS_XIAOHONGSHU_DOWNLOAD_AUTH_SIDECAR);
  if (!sidecarPath) {
    return null;
  }
  const maxAgeMs = normalizePositiveDurationMs(options.maxAgeMs, DEFAULT_SIDE_CAR_MAX_AGE_MS);
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  try {
    const sidecar = await (deps.readJsonFile ?? readJsonFile)(path.resolve(sidecarPath));
    const headers = mergeHeaderMaps(sidecar?.headers);
    const generatedAtMs = parseTimestampMs(sidecar?.generatedAt);
    const sidecarAgeMs = generatedAtMs === null ? null : Math.max(0, nowMs - generatedAtMs);
    const expired = maxAgeMs > 0 && (generatedAtMs === null || (sidecarAgeMs !== null && sidecarAgeMs > maxAgeMs));
    const validSidecar = sidecar?.ok === true && Object.keys(headers).length > 0 && !expired;
    return {
      requestHeaders: validSidecar ? headers : {},
      downloadHeaders: validSidecar ? headers : {},
      summary: {
        attempted: false,
        status: validSidecar
          ? 'sidecar-reused'
          : generatedAtMs === null
            ? 'sidecar-missing-generated-at'
            : 'sidecar-expired',
        authAvailable: sidecar?.ok === true,
        cookieCount: normalizePositiveInteger(sidecar?.cookieCount, 0),
        userDataDir: normalizeText(sidecar?.userDataDir) || null,
        finalUrl: normalizeUrl(sidecar?.page?.url || sidecar?.inputUrl || '') || null,
        sidecarPath: path.resolve(sidecarPath),
        sidecarGeneratedAt: normalizeText(sidecar?.generatedAt) || null,
        sidecarAgeMs,
        sidecarMaxAgeMs: maxAgeMs,
        expired,
      },
    };
  } catch (error) {
    return {
      requestHeaders: {},
      downloadHeaders: {},
      summary: {
        attempted: false,
        status: 'sidecar-invalid',
        authAvailable: false,
        sidecarPath: path.resolve(sidecarPath),
        error: error?.message ?? String(error),
      },
    };
  }
}

async function resolveXiaohongshuDownloadSessionContext(request, profile, deps = {}) {
  if (request.reuseLoginState === false) {
    return {
      requestHeaders: {},
      downloadHeaders: {},
      summary: {
        attempted: false,
        status: 'reuse-disabled',
        authAvailable: false,
      },
    };
  }
  const forceRefresh = request.forceDownloadSessionRefresh === true;
  const sidecarContext = forceRefresh
    ? null
    : await resolveXiaohongshuPassthroughSidecarContext(deps, {
      maxAgeMs: resolveXiaohongshuDownloadSessionMaxAgeMs(request, profile),
    });
  if (sidecarContext?.summary?.status === 'sidecar-reused') {
    return sidecarContext;
  }
  const previousSidecarSummary = sidecarContext?.summary ?? null;

  const sessionInputUrl = normalizeUrl(
    profile?.authSession?.keepaliveUrl
    || profile?.authSession?.verificationUrl
    || profile?.authSession?.postLoginUrl
    || profile?.authValidationSamples?.notificationUrl
    || XIAOHONGSHU_HOME_URL,
  ) || XIAOHONGSHU_HOME_URL;
  const inspectReusableSession = deps.inspectRequestReusableSiteSession ?? inspectRequestReusableSiteSession;
  let inspection;
  try {
    inspection = await inspectReusableSession(
      sessionInputUrl,
      request,
      deps,
      {},
      {
        siteProfile: profile,
        profilePath: request.profilePath ? path.resolve(request.profilePath) : DEFAULT_PROFILE_PATH,
      },
    );
  } catch (error) {
    return {
      requestHeaders: {},
      downloadHeaders: {},
      summary: {
        attempted: true,
        status: 'inspection-failed',
        authAvailable: false,
        error: error?.message ?? String(error),
      },
    };
  }

  if (!inspection?.authAvailable || !inspection?.userDataDir) {
    return {
      requestHeaders: {},
      downloadHeaders: {},
      summary: {
        attempted: true,
        status: 'session-unavailable',
        authAvailable: false,
        userDataDir: inspection?.userDataDir ?? null,
        profileHealth: inspection?.profileHealth ?? null,
      },
    };
  }

  const authConfig = inspection.authConfig ?? {};
  const headless = typeof request.headless === 'boolean'
    ? request.headless
    : authConfig.preferVisibleBrowserForAuthenticatedFlows === true
      ? false
      : true;
  const browserSettings = {
    browserPath: request.browserPath,
    userDataDir: inspection.userDataDir,
    cleanupUserDataDirOnShutdown: false,
    timeoutMs: Math.min(request.timeoutMs ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    headless,
    startupUrl: sessionInputUrl,
    viewport: {
      width: 1440,
      height: 1024,
      deviceScaleFactor: 1,
    },
    fullPage: false,
  };
  const openSession = deps.openBrowserSession ?? openBrowserSession;
  let session = null;
  try {
    session = await openSession(browserSettings, { startupUrl: sessionInputUrl });
    await session.navigateAndWait(sessionInputUrl, buildBrowserWaitPolicy(browserSettings.timeoutMs));
    const [pageMetadata, userAgent, acceptLanguage, referrer] = await Promise.all([
      session.getPageMetadata(sessionInputUrl),
      session.evaluateValue('navigator.userAgent'),
      session.evaluateValue('(navigator.languages && navigator.languages.join(", ")) || navigator.language || ""'),
      session.evaluateValue('document.referrer'),
    ]);
    const cookieResult = await session.client.send('Storage.getCookies');
    const cookies = filterCookiesForHost(cookieResult?.cookies, 'xiaohongshu.com');
    const cookieHeader = buildCookieHeader(cookies);
    const finalUrl = normalizeUrl(pageMetadata?.finalUrl || sessionInputUrl) || sessionInputUrl;
    const requestHeaders = mergeHeaderMaps(
      {
        Cookie: cookieHeader || null,
        'User-Agent': normalizeText(userAgent) || DEFAULT_USER_AGENT,
        'Accept-Language': normalizeText(acceptLanguage) || DEFAULT_ACCEPT_LANGUAGE,
      },
      {
        Referer: normalizeUrl(referrer || finalUrl) || finalUrl,
        Origin: 'https://www.xiaohongshu.com',
      },
    );
    return {
      requestHeaders,
      downloadHeaders: requestHeaders,
      summary: {
        attempted: true,
        status: cookieHeader ? 'session-exported' : 'session-exported-without-cookies',
        authAvailable: true,
        cookieCount: cookies.length,
        userDataDir: inspection.userDataDir ?? null,
        finalUrl,
        browserAttachedVia: session.browserAttachedVia ?? null,
        reusedBrowserInstance: session.reusedBrowserInstance === true,
        headless,
        previousSidecarStatus: previousSidecarSummary?.status ?? null,
        previousSidecarAgeMs: previousSidecarSummary?.sidecarAgeMs ?? null,
        previousSidecarPath: previousSidecarSummary?.sidecarPath ?? null,
      },
    };
  } catch (error) {
    return {
      requestHeaders: {},
      downloadHeaders: {},
      summary: {
        attempted: true,
        status: 'session-export-failed',
        authAvailable: true,
        userDataDir: inspection.userDataDir ?? null,
        error: error?.message ?? String(error),
        previousSidecarStatus: previousSidecarSummary?.status ?? null,
        previousSidecarAgeMs: previousSidecarSummary?.sidecarAgeMs ?? null,
        previousSidecarPath: previousSidecarSummary?.sidecarPath ?? null,
      },
    };
  } finally {
    await session?.close?.();
  }
}

export function classifyXiaohongshuDownloadInput(raw) {
  const value = normalizeText(raw);
  if (!value) {
    return { source: value, inputKind: 'unknown', authRequired: false };
  }
  try {
    const parsed = new URL(value);
    const host = normalizeText(parsed.hostname).toLowerCase();
    const pathname = normalizeText(parsed.pathname) || '/';
    if (host !== 'www.xiaohongshu.com' && host !== 'xiaohongshu.com') {
      return { source: value, inputKind: 'unknown', authRequired: false };
    }
    if (pathname.startsWith('/explore/')) {
      return { source: value, inputKind: 'note-detail', authRequired: false };
    }
    if (pathname.startsWith('/user/profile/')) {
      return { source: value, inputKind: 'author-note-list', authRequired: false };
    }
    if (pathname === '/search_result') {
      return { source: value, inputKind: 'search-results', authRequired: false };
    }
    if (pathname === '/explore') {
      return { source: value, inputKind: 'discover', authRequired: false };
    }
    return { source: value, inputKind: 'unknown', authRequired: false };
  } catch {
    return { source: value, inputKind: 'search-query', authRequired: false };
  }
}

async function readXiaohongshuProfile(request, deps = {}) {
  if (deps.siteProfile) {
    return deps.siteProfile;
  }
  const profilePath = request.profilePath ? path.resolve(request.profilePath) : DEFAULT_PROFILE_PATH;
  return await (deps.readJsonFile ?? readJsonFile)(profilePath);
}

function extractHtmlTitle(html = '') {
  const matched = String(html ?? '').match(/<title>([\s\S]*?)<\/title>/iu);
  return normalizeText(matched?.[1] ?? '');
}

function stripHtml(value = '') {
  return String(value ?? '')
    .replace(/<script[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style[\s\S]*?<\/style>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

async function fetchHtml(url, request, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is unavailable; pass fetchImpl in deps.');
  }
  const requestHeaders = mergeHeaderMaps(
    {
      'user-agent': DEFAULT_USER_AGENT,
      'accept-language': DEFAULT_ACCEPT_LANGUAGE,
      'cache-control': 'no-cache',
    },
    deps.requestHeaders,
    request.requestHeaders,
  );
  const response = await fetchImpl(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    headers: requestHeaders,
  });
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: ${response.status} ${response.statusText}`);
  }
  const html = await response.text();
  return {
    requestedUrl: url,
    finalUrl: response.url || url,
    html,
    title: extractHtmlTitle(html),
    documentText: stripHtml(html),
  };
}

async function fetchPageSignature(url, request, profile, deps = {}) {
  const page = await fetchHtml(url, request, deps);
  const pageType = inferPageTypeFromUrl(page.finalUrl, profile);
  const pageFacts = derivePageFacts({
    pageType,
    siteProfile: profile,
    finalUrl: page.finalUrl,
    title: page.title,
    rawHtml: page.html,
    documentText: page.documentText,
  });
  return {
    ...page,
    pageType,
    pageFacts,
  };
}

function detectRecoverableSessionMiss(signature = {}) {
  const restriction = detectXiaohongshuRestrictionPage({
    inputUrl: signature?.requestedUrl,
    finalUrl: signature?.finalUrl,
    title: signature?.title,
    pageType: signature?.pageType,
    pageFacts: signature?.pageFacts,
  });
  return {
    recoverable: signature?.pageType === 'auth-page' || Boolean(restriction),
    restriction,
  };
}

function buildDownloadSessionSummary(currentSummary = {}, recovery = {}) {
  return {
    ...currentSummary,
    initialStatus: recovery.initialStatus ?? currentSummary.previousSidecarStatus ?? currentSummary.status ?? null,
    refreshAttempted: recovery.refreshAttempted === true,
    refreshSucceeded: recovery.refreshSucceeded === true,
    refreshReason: recovery.refreshReason ?? null,
    refreshCount: recovery.refreshCount ?? 0,
    recoveryStatus: recovery.recoveryStatus ?? null,
    lastMissedUrl: recovery.lastMissedUrl ?? null,
    lastMissedStatus: recovery.lastMissedStatus ?? null,
  };
}

function createResolvedNoteItem(signature, candidate = {}, sessionHeaders = {}) {
  const pageFacts = signature?.pageFacts ?? {};
  const contentImages = Array.isArray(pageFacts.contentImages) ? pageFacts.contentImages : [];
  const resolvedAssets = contentImages
    .map((entry) => ({
      assetId: normalizeText(entry?.assetId) || null,
      kind: normalizeText(entry?.kind) || 'image',
      url: normalizeText(entry?.url) || null,
      previewUrl: normalizeText(entry?.previewUrl) || null,
      width: Number.isFinite(Number(entry?.width)) ? Number(entry.width) : null,
      height: Number.isFinite(Number(entry?.height)) ? Number(entry.height) : null,
      headers: mergeResolvedDownloadHeaders({}, sessionHeaders, signature.finalUrl),
      sourceUrls: Array.isArray(entry?.sourceUrls) ? entry.sourceUrls.filter(Boolean) : [],
    }))
    .filter((entry) => entry.url);
  const contentType = normalizeText(pageFacts.contentType).toLowerCase();
  const imageOnly = resolvedAssets.length > 0;
  if (!imageOnly) {
    const restriction = detectXiaohongshuRestrictionPage({
      inputUrl: signature?.requestedUrl,
      finalUrl: signature?.finalUrl,
      title: signature?.title,
      pageType: signature?.pageType,
      pageFacts,
    });
    const finalNoteId = normalizeText(pageFacts.noteId) || extractXiaohongshuNoteId(signature?.finalUrl || '');
    const requestedNoteId = normalizeText(candidate.noteId) || extractXiaohongshuNoteId(signature?.requestedUrl || '');
    const finalPathname = (() => {
      try {
        return new URL(signature?.finalUrl || '').pathname;
      } catch {
        return '';
      }
    })();
    const navigationMiss = Boolean(
      requestedNoteId
      && (
        restriction
        || signature?.pageType === 'auth-page'
        || /^\/404(?:[/?#]|$)/u.test(finalPathname)
        || (signature?.pageType !== 'book-detail-page' && finalNoteId !== requestedNoteId)
      )
    );
    return {
      ok: false,
      reasonCode: navigationMiss
        ? 'navigation-miss'
        : contentType === 'video'
          ? 'video-note'
          : 'no-images',
      finalUrl: signature.finalUrl,
      noteId: finalNoteId || null,
      title: normalizeText(pageFacts.contentTitle || pageFacts.bookTitle) || null,
    };
  }
  const canonicalFinalUrl = buildXiaohongshuNoteUrl(
    normalizeText(pageFacts.noteId) || normalizeText(candidate.noteId) || extractXiaohongshuNoteId(signature.finalUrl || ''),
  ) || normalizeUrl(signature.finalUrl) || signature.finalUrl;
  return {
    ok: true,
    noteId: normalizeText(pageFacts.noteId) || null,
    finalUrl: canonicalFinalUrl,
    title: normalizeText(pageFacts.contentTitle || pageFacts.bookTitle) || 'Untitled note',
    authorName: normalizeText(pageFacts.authorName || candidate.authorName) || null,
    authorUrl: normalizeText(pageFacts.authorUrl || candidate.authorUrl) || null,
    authorUserId: normalizeText(pageFacts.authorUserId || pageFacts.userId || candidate.authorUserId || candidate.userId) || null,
    publishedAt: normalizeText(pageFacts.publishedDateLocal || pageFacts.publishedAt || pageFacts.publishedTimeText) || null,
    tagNames: Array.isArray(pageFacts.tagNames) && pageFacts.tagNames.length > 0
      ? pageFacts.tagNames.filter(Boolean)
      : Array.isArray(candidate.tagNames)
        ? candidate.tagNames.filter(Boolean)
        : [],
    bodyText: pageFacts.bodyText || pageFacts.contentBodyText || pageFacts.bodyExcerpt || pageFacts.contentExcerpt || '',
    queryText: normalizeText(candidate.queryText) || null,
    sourceType: normalizeText(candidate.sourceType) || null,
    sourceUrl: signature.requestedUrl,
    downloadBundle: {
      textBody: pageFacts.bodyText || pageFacts.contentBodyText || pageFacts.bodyExcerpt || pageFacts.contentExcerpt || '',
      headers: mergeResolvedDownloadHeaders({}, sessionHeaders, signature.finalUrl),
      assets: resolvedAssets,
    },
  };
}

async function resolveCandidateNotes(candidates, request, profile, deps = {}) {
  const limit = getRequestedDownloadLimit(request);
  const candidateBudget = Math.min(
    candidates.length,
    Math.max(limit * 6, limit + 6, 12),
  );
  const resolvedItems = [];
  const diagnostics = {
    attemptedNotes: 0,
    resolvedNotes: 0,
    skippedVideoNotes: 0,
    skippedNoImageNotes: 0,
    failedNotes: 0,
  };
  const fetchSignature = deps.fetchPageSignature ?? (async (url) => await fetchPageSignature(url, request, profile, deps));
  for (const candidate of candidates.slice(0, candidateBudget)) {
    if (resolvedItems.length >= limit) {
      break;
    }
    diagnostics.attemptedNotes += 1;
    try {
      const detailTargets = buildXiaohongshuCandidateDetailTargets(candidate);
      let resolved = null;
      for (const detailTarget of detailTargets) {
        const signature = await fetchSignature(detailTarget);
        resolved = createResolvedNoteItem(signature, candidate, deps.downloadHeaders);
        if (resolved.ok || resolved.reasonCode !== 'navigation-miss') {
          break;
        }
      }
      if (!resolved?.ok) {
        if (resolved?.reasonCode === 'video-note') {
          diagnostics.skippedVideoNotes += 1;
        } else if (resolved?.reasonCode === 'navigation-miss') {
          diagnostics.failedNotes += 1;
        } else {
          diagnostics.skippedNoImageNotes += 1;
        }
        continue;
      }
      resolvedItems.push(resolved);
      diagnostics.resolvedNotes += 1;
    } catch {
      diagnostics.failedNotes += 1;
    }
  }
  return {
    items: dedupeBy(resolvedItems, (entry) => entry.noteId || entry.finalUrl),
    diagnostics,
  };
}

async function resolveConcreteDownloadInputs(request, deps = {}) {
  const profile = await readXiaohongshuProfile(request, deps);
  const authorResumeStates = normalizeAuthorResumeStates(request);
  let sessionContext = await resolveXiaohongshuDownloadSessionContext(request, profile, deps);
  const sessionRecovery = {
    initialStatus: sessionContext.summary?.previousSidecarStatus ?? sessionContext.summary?.status ?? null,
    refreshAttempted: false,
    refreshSucceeded: false,
    refreshReason: null,
    refreshCount: 0,
    recoveryStatus: null,
    lastMissedUrl: null,
    lastMissedStatus: null,
  };
  const requestDeps = { ...deps };
  const applySessionContext = (nextSessionContext) => {
    sessionContext = nextSessionContext;
    requestDeps.requestHeaders = mergeHeaderMaps(deps.requestHeaders, sessionContext.requestHeaders);
    requestDeps.downloadHeaders = mergeHeaderMaps(deps.downloadHeaders, sessionContext.downloadHeaders);
  };
  applySessionContext(sessionContext);
  const refreshDownloadSession = async (reason, signature = null) => {
    if (sessionRecovery.refreshCount >= 1 || request.reuseLoginState === false) {
      return false;
    }
    sessionRecovery.refreshAttempted = true;
    sessionRecovery.refreshReason = normalizeText(reason) || 'session-refresh';
    sessionRecovery.refreshCount += 1;
    sessionRecovery.lastMissedUrl = normalizeUrl(signature?.finalUrl || signature?.requestedUrl || '') || null;
    sessionRecovery.lastMissedStatus = sessionContext.summary?.status ?? null;
    const refreshedSessionContext = await resolveXiaohongshuDownloadSessionContext(
      {
        ...request,
        forceDownloadSessionRefresh: true,
      },
      profile,
      deps,
    );
    sessionRecovery.recoveryStatus = refreshedSessionContext.summary?.status ?? null;
    const refreshSucceeded = Object.keys(refreshedSessionContext.requestHeaders ?? {}).length > 0
      || Object.keys(refreshedSessionContext.downloadHeaders ?? {}).length > 0;
    if (refreshSucceeded) {
      sessionRecovery.refreshSucceeded = true;
      applySessionContext(refreshedSessionContext);
      return true;
    }
    return false;
  };
  const fetchPageSignatureWithRecovery = async (url) => {
    let signature = await fetchPageSignature(url, request, profile, requestDeps);
    const miss = detectRecoverableSessionMiss(signature);
    if (!miss.recoverable) {
      return signature;
    }
    const refreshed = await refreshDownloadSession(
      miss.restriction ? 'restriction-page' : 'auth-page',
      signature,
    );
    if (!refreshed) {
      return signature;
    }
    signature = await fetchPageSignature(url, request, profile, requestDeps);
    return signature;
  };
  requestDeps.fetchPageSignature = fetchPageSignatureWithRecovery;
  const classifications = (Array.isArray(request.items) ? request.items : [])
    .map((item) => ({
      input: normalizeText(item),
      ...classifyXiaohongshuDownloadInput(item),
    }));
  const effectiveClassifications = [...classifications];
  const candidateNotes = [];
  const authorContinuations = [];
  const resolution = {
    inputKinds: {},
    searchQueries: [],
    attemptedPages: 0,
    attemptedNotes: 0,
    resolvedNotes: 0,
    skippedVideoNotes: 0,
    skippedNoImageNotes: 0,
    failedNotes: 0,
    authorResumeStates: [],
    authorContinuations: [],
    followedUsersRequested: request.followedUsers === true,
    followedUsersQueryType: request.followedUsers === true ? 'list-followed-users' : null,
    followedUsersInputUrl: request.followedUsers === true ? resolveXiaohongshuFollowQueryInputUrl(profile) : null,
    followedUsersStatus: null,
    followedUsersReasonCode: null,
    followedUsersSource: null,
    followedUsersTotal: 0,
    followedUsersScanned: 0,
    followedUsersMatched: 0,
    followedUsersExpanded: 0,
    followedUsersErrors: [],
    followedUsersWarnings: [],
    followedUserUrls: [],
    followedUserNames: [],
  };
  const bump = (bucket) => {
    resolution.inputKinds[bucket] = (resolution.inputKinds[bucket] ?? 0) + 1;
  };
  if (request.followedUsers === true) {
    const followQuery = deps.queryXiaohongshuFollow ?? queryXiaohongshuFollow;
    const followReport = await followQuery(
      resolution.followedUsersInputUrl,
      {
        intent: 'list-followed-users',
        profilePath: request.profilePath ? path.resolve(request.profilePath) : DEFAULT_PROFILE_PATH,
        browserPath: request.browserPath,
        browserProfileRoot: request.browserProfileRoot,
        userDataDir: request.userDataDir,
        timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        headless: typeof request.headless === 'boolean'
          ? request.headless
          : profile?.authSession?.preferVisibleBrowserForAuthenticatedFlows === true
            ? false
            : false,
        autoLogin: request.autoLogin === true,
        reuseLoginState: request.reuseLoginState !== false,
        limit: request.followedUserLimit,
      },
      {
        ...deps,
        siteProfile: profile,
      },
    );
    const followedUsers = Array.isArray(followReport?.result?.users)
      ? followReport.result.users
      : [];
    const existingAuthorInputs = new Set(
      effectiveClassifications
        .filter((classification) => classification.inputKind === 'author-note-list')
        .map((classification) => normalizeUrl(classification.source) || normalizeText(classification.source))
        .filter(Boolean),
    );
    resolution.followedUsersStatus = normalizeText(followReport?.result?.status) || 'unknown';
    resolution.followedUsersReasonCode = normalizeText(followReport?.result?.reasonCode) || null;
    resolution.followedUsersSource = normalizeText(followReport?.result?.followedUsersSource) || null;
    resolution.followedUsersTotal = normalizePositiveInteger(
      followReport?.result?.totalFollowedUsers ?? followedUsers.length,
      followedUsers.length,
    );
    resolution.followedUsersScanned = normalizePositiveInteger(
      followReport?.result?.scannedUsers ?? followedUsers.length,
      followedUsers.length,
    );
    resolution.followedUsersMatched = normalizePositiveInteger(
      followReport?.result?.matchedUsers ?? followedUsers.length,
      followedUsers.length,
    );
    resolution.followedUsersErrors = Array.isArray(followReport?.result?.errors)
      ? followReport.result.errors
      : [];
    resolution.followedUsersWarnings = Array.isArray(followReport?.warnings)
      ? followReport.warnings
      : [];
    resolution.followedUserUrls = uniqueStrings(followedUsers.map((user) => user?.url));
    resolution.followedUserNames = uniqueStrings(followedUsers.map((user) => user?.name));
    for (const user of followedUsers) {
      const authorUrl = normalizeUrl(user?.url);
      const authorInputKey = authorUrl || normalizeText(user?.userId);
      if (!authorUrl || !authorInputKey || existingAuthorInputs.has(authorInputKey)) {
        continue;
      }
      existingAuthorInputs.add(authorInputKey);
      effectiveClassifications.push({
        input: authorUrl,
        source: authorUrl,
        inputKind: 'author-note-list',
        authRequired: false,
        followedUser: true,
        userId: normalizeText(user?.userId) || null,
        userName: normalizeText(user?.name) || null,
        redId: normalizeText(user?.redId) || null,
      });
    }
    resolution.followedUsersExpanded = effectiveClassifications.length - classifications.length;
  }
  const authorInputCount = effectiveClassifications.filter((classification) => classification.inputKind === 'author-note-list').length;

  for (const classification of effectiveClassifications) {
    bump(classification.inputKind || 'unknown');
    if (classification.inputKind === 'note-detail') {
      candidateNotes.push(normalizeXiaohongshuCandidate({
        url: classification.source,
      }, {
        sourceType: 'direct-note-input',
        sourceOrder: candidateNotes.length,
      }));
      continue;
    }
    if (classification.inputKind === 'search-query') {
      resolution.searchQueries.push(classification.source);
      const searchUrl = buildXiaohongshuSearchUrl(classification.source);
      resolution.attemptedPages += 1;
      const signature = await fetchPageSignatureWithRecovery(searchUrl);
      candidateNotes.push(...buildSearchCandidates(signature));
      continue;
    }
    if (classification.inputKind === 'search-results') {
      resolution.attemptedPages += 1;
      const signature = await fetchPageSignatureWithRecovery(classification.source);
      candidateNotes.push(...buildSearchCandidates(signature));
      continue;
    }
    if (classification.inputKind === 'author-note-list') {
      const authorResumeState = resolveMatchingAuthorResumeState(
        classification.source,
        authorResumeStates,
        { allowSingleFallback: authorInputCount === 1 },
      );
      const expandedAuthor = await collectAuthorCandidates(classification.source, request, profile, {
        ...requestDeps,
        authorResumeState,
      });
      resolution.attemptedPages += expandedAuthor.diagnostics.attemptedPages;
      candidateNotes.push(...expandedAuthor.candidates);
      authorContinuations.push({
        input: classification.source,
        authorUrl: expandedAuthor.diagnostics.authorUrl ?? classification.source,
        authorUserId: expandedAuthor.diagnostics.authorUserId ?? null,
        attemptedPages: expandedAuthor.diagnostics.attemptedPages ?? 0,
        pageLimit: expandedAuthor.diagnostics.pageLimit ?? getAuthorPageLimit(request),
        resumeApplied: expandedAuthor.diagnostics.resumeApplied === true,
        exhausted: expandedAuthor.diagnostics.exhausted === true,
        lastVisitedUrl: expandedAuthor.diagnostics.lastVisitedUrl ?? null,
        lastVisitedPage: expandedAuthor.diagnostics.lastVisitedPage ?? null,
        continuationStrategies: expandedAuthor.diagnostics.continuationStrategies ?? [],
        seenNoteIds: expandedAuthor.diagnostics.seenNoteIds ?? [],
        seenNoteUrls: expandedAuthor.diagnostics.seenNoteUrls ?? [],
        nextResumeState: expandedAuthor.diagnostics.nextResumeState ?? null,
      });
      continue;
    }
  }

  const resolved = await resolveCandidateNotes(
    mergeXiaohongshuCandidates(candidateNotes),
    request,
    profile,
    requestDeps,
  );
  resolution.attemptedNotes = resolved.diagnostics.attemptedNotes;
  resolution.resolvedNotes = resolved.diagnostics.resolvedNotes;
  resolution.skippedVideoNotes = resolved.diagnostics.skippedVideoNotes;
  resolution.skippedNoImageNotes = resolved.diagnostics.skippedNoImageNotes;
  resolution.failedNotes = resolved.diagnostics.failedNotes;
  resolution.authorContinuations = authorContinuations;
  resolution.authorResumeStates = authorContinuations
    .map((entry) => entry.nextResumeState)
    .filter(Boolean);

  return {
    profile,
    items: resolved.items,
    classifications: effectiveClassifications,
    resolution,
    downloadSession: buildDownloadSessionSummary(sessionContext.summary, sessionRecovery),
  };
}

async function spawnJsonCommand(command, args, { cwd = REPO_ROOT } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        PYTHONIOENCODING: process.env.PYTHONIOENCODING || 'utf-8',
        PYTHONUTF8: process.env.PYTHONUTF8 || '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      resolve({ code: Number(code ?? 1), stdout, stderr });
    });
  });
}

async function invokeDownloadCli(request, resolvedItems, deps = {}) {
  const pythonPath = request.pythonPath || 'python';
  const scriptPath = XIAOHONGSHU_DOWNLOAD_PYTHON_ENTRY;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'xiaohongshu-download-inputs-'));
  const inputFile = path.join(tempDir, 'inputs.json');
  await writeFile(inputFile, `${JSON.stringify(resolvedItems, null, 2)}\n`, 'utf8');
  try {
    const args = [scriptPath, '--input-file', inputFile];
    if (request.profilePath) {
      args.push('--profile-path', request.profilePath);
    }
    if (request.outDir) {
      args.push('--out-dir', request.outDir);
    }
    if (request.download?.dryRun) {
      args.push('--dry-run');
    }
    if (request.download?.maxItems) {
      args.push('--max-items', String(request.download.maxItems));
    }
    if (request.timeoutMs) {
      args.push('--timeout', String(Math.max(1, Math.ceil(request.timeoutMs / 1000))));
    }
    args.push('--output', 'full', '--output-format', 'json');
    const processResult = await (deps.spawnJsonCommand ?? spawnJsonCommand)(pythonPath, args);
    return {
      process: processResult,
      payload: processResult.stdout ? JSON.parse(processResult.stdout) : null,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function buildDownloadActionSummary(download = null, resolution = null) {
  const summary = download?.summary || {};
  return {
    total: Number(summary.total || 0),
    successful: Number(summary.successful || 0),
    partial: Number(summary.partial || 0),
    failed: Number(summary.failed || 0),
    planned: Number(summary.planned || 0),
    runDir: normalizeText(download?.runDir) || null,
    resolution: resolution || null,
  };
}

function buildDownloadActionMarkdown(download = null, resolution = null) {
  const summary = buildDownloadActionSummary(download, resolution);
  const lines = [
    '# Xiaohongshu Download Action',
    '',
    `- Total: ${summary.total}`,
    `- Successful: ${summary.successful}`,
    `- Partial: ${summary.partial}`,
    `- Failed: ${summary.failed}`,
    `- Planned: ${summary.planned}`,
  ];
  if (summary.runDir) {
    lines.push(`- Run Dir: \`${summary.runDir}\``);
  }
  if (summary.resolution) {
    lines.push('', '## Resolution');
    lines.push(`- Attempted pages: ${summary.resolution.attemptedPages}`);
    lines.push(`- Attempted notes: ${summary.resolution.attemptedNotes}`);
    lines.push(`- Resolved image notes: ${summary.resolution.resolvedNotes}`);
    lines.push(`- Skipped video-like notes: ${summary.resolution.skippedVideoNotes}`);
    lines.push(`- Skipped no-image notes: ${summary.resolution.skippedNoImageNotes}`);
  }
  return `${lines.join('\n')}\n`;
}

export async function planXiaohongshuAction(request) {
  const action = normalizeText(request?.action) || 'download';
  if (action !== 'download') {
    throw new Error(`Unsupported Xiaohongshu action: ${action}`);
  }
  const items = Array.isArray(request.items) ? request.items.map((item) => normalizeText(item)).filter(Boolean) : [];
  const usesFollowedUsers = request?.followedUsers === true;
  const classifications = items.map(classifyXiaohongshuDownloadInput);
  if (!items.length && !usesFollowedUsers) {
    throw new Error('Xiaohongshu download requires either concrete items or --followed-users.');
  }
  return {
    action,
    items,
    classifications,
    followedUsers: usesFollowedUsers,
    authRequired: usesFollowedUsers,
    route: 'download-direct',
    reason: usesFollowedUsers
      ? 'Xiaohongshu followed-user downloads first resolve the authenticated follow list, then expand each followed user into author-page image-note downloads.'
      : 'Xiaohongshu image-note downloads resolve public note data first, then hand off to the shared media downloader.',
  };
}

export async function runXiaohongshuAction(request, deps = {}) {
  const plan = await planXiaohongshuAction(request);
  const sessionGate = buildAuthRequiredSessionBlock(plan, request);
  if (sessionGate) {
    const resolution = {
      attemptedPages: 0,
      attemptedNotes: 0,
      resolvedNotes: 0,
      skippedVideoNotes: 0,
      skippedNoImageNotes: 0,
      failedNotes: 0,
      followedUsersRequested: request?.followedUsers === true,
      followedUsersStatus: 'blocked',
      sessionGate,
    };
    return {
      ok: false,
      action: 'download',
      plan,
      reasonCode: 'session-unhealthy',
      resolution,
      resolvedInputs: [],
      downloadSession: {
        attempted: false,
        status: 'blocked',
        reason: sessionGate.reason,
        sessionGate,
      },
      download: null,
      sessionGate,
      actionSummary: buildDownloadActionSummary(null, resolution),
      markdown: buildDownloadActionMarkdown(null, resolution),
    };
  }
  const resolved = await resolveConcreteDownloadInputs(request, deps);
  if (!resolved.items.length) {
    const followedUsersReasonCode = resolved.resolution.followedUsersRequested === true
      ? (
        resolved.resolution.followedUsersStatus !== 'success'
          ? 'followed-users-unavailable'
          : resolved.resolution.followedUsersMatched === 0
            ? 'no-followed-users'
            : 'no-downloadable-image-notes'
      )
      : 'no-downloadable-image-notes';
    return {
      ok: false,
      action: 'download',
      plan,
      reasonCode: followedUsersReasonCode,
      resolution: resolved.resolution,
      resolvedInputs: [],
      downloadSession: resolved.downloadSession,
      download: null,
      actionSummary: buildDownloadActionSummary(null, resolved.resolution),
      markdown: buildDownloadActionMarkdown(null, resolved.resolution),
    };
  }
  const invoked = await invokeDownloadCli(request, resolved.items, deps);
  if (invoked.process.code !== 0) {
    return {
      ok: false,
      action: 'download',
      plan,
      reasonCode: 'download-failed',
      resolution: resolved.resolution,
      resolvedInputs: resolved.items.map((item) => item.finalUrl),
      downloadSession: resolved.downloadSession,
      error: invoked.process.stderr.trim() || invoked.process.stdout.trim() || 'xiaohongshu downloader failed',
      download: invoked.payload,
      actionSummary: buildDownloadActionSummary(invoked.payload, resolved.resolution),
      markdown: buildDownloadActionMarkdown(invoked.payload, resolved.resolution),
    };
  }
  return {
    ok: true,
    action: 'download',
    plan,
    reasonCode: 'download-started',
    resolution: resolved.resolution,
    resolvedInputs: resolved.items.map((item) => item.finalUrl),
    downloadSession: resolved.downloadSession,
    download: invoked.payload,
    actionSummary: buildDownloadActionSummary(invoked.payload, resolved.resolution),
    markdown: invoked.payload?.reportMarkdown || buildDownloadActionMarkdown(invoked.payload, resolved.resolution),
  };
}
