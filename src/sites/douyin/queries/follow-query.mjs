// @ts-check

import path from 'node:path';

import process from 'node:process';

import { openBrowserSession } from '../../../infra/browser/session.mjs';
import { initializeCliUtf8, writeJsonStdout } from '../../../infra/cli.mjs';
import {
  ensureDir,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from '../../../infra/io.mjs';
import { cleanText, toArray, uniqueSortedStrings } from '../../../shared/normalize.mjs';
import {
  ensureAuthenticatedSession,
  resolveAuthKeepaliveUrl,
  resolveSiteAuthProfile,
  resolveSiteBrowserSessionOptions,
} from '../../../infra/auth/site-auth.mjs';
import {
  finalizeSiteSessionGovernance,
  prepareSiteSessionGovernance,
  releaseSessionLease,
} from '../../../infra/auth/site-session-governance.mjs';
import {
  inferDouyinPageTypeFromUrl,
  resolveDouyinHeadlessDefault,
} from '../model/site.mjs';
import { resolveDouyinReadySelectors } from '../model/diagnosis.mjs';
import { buildDouyinDownloadTaskSeed } from './media-resolver.mjs';
import { resolveProfilePathForUrl } from '../../core/profiles.mjs';

export const DOUYIN_FOLLOW_CACHE_FILE_NAME = 'douyin-follow-cache.json';
export const DOUYIN_FOLLOW_CACHE_VERSION = 1;
export const DEFAULT_DOUYIN_TIMEZONE = 'Asia/Shanghai';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const FOLLOW_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FOLLOW_VIDEO_RETENTION_DAYS = 35;

function normalizeText(value) {
  return cleanText(String(value ?? '').replace(/\s+/gu, ' '));
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toDate(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  }
  if (typeof value === 'number') {
    const numeric = value > 1e12 ? value : value * 1_000;
    const date = new Date(numeric);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

function getShanghaiParts(value) {
  const date = toDate(value);
  if (!date) {
    return null;
  }
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    millisecond: shifted.getUTCMilliseconds(),
    weekday: shifted.getUTCDay(),
  };
}

function createShanghaiDate(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second, millisecond));
}

function startOfShanghaiDay(value) {
  const parts = getShanghaiParts(value);
  if (!parts) {
    return null;
  }
  return createShanghaiDate(parts.year, parts.month, parts.day, 0, 0, 0, 0);
}

function addShanghaiDays(value, days) {
  const start = startOfShanghaiDay(value);
  if (!start) {
    return null;
  }
  return new Date(start.getTime() + (Number(days) || 0) * DAY_MS);
}

function formatShanghaiDayKey(value) {
  const parts = getShanghaiParts(value);
  if (!parts) {
    return null;
  }
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function formatShanghaiDateTime(value) {
  const parts = getShanghaiParts(value);
  if (!parts) {
    return null;
  }
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
}

function parseIsoDateParts(value) {
  const matched = String(value ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!matched) {
    return null;
  }
  return {
    year: Number(matched[1]),
    month: Number(matched[2]),
    day: Number(matched[3]),
  };
}

function buildDayKeys(startAt, endAt) {
  const start = startOfShanghaiDay(startAt);
  const end = toDate(endAt);
  if (!start || !end || end.getTime() <= start.getTime()) {
    return [];
  }
  const keys = [];
  for (let cursor = start.getTime(); cursor < end.getTime(); cursor += DAY_MS) {
    keys.push(formatShanghaiDayKey(new Date(cursor)));
  }
  return keys;
}

function normalizeWindowLabel(value) {
  const normalized = normalizeText(value);
  return normalized || '今天';
}

function normalizeStringList(value) {
  return uniqueSortedStrings(
    (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
      .flatMap((item) => String(item ?? '').split(','))
      .map((item) => normalizeText(item))
      .filter(Boolean),
  );
}

function normalizePositiveInteger(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function resolveTodayWindow(now) {
  const startAt = startOfShanghaiDay(now);
  return {
    startAt,
    endAt: toDate(now),
    label: '今天',
    includesToday: true,
  };
}

function resolveYesterdayWindow(now) {
  const todayStart = startOfShanghaiDay(now);
  const startAt = addShanghaiDays(now, -1);
  return {
    startAt,
    endAt: todayStart,
    label: '昨天',
    includesToday: false,
  };
}

function resolveWeekWindow(now, previous = false) {
  const todayStart = startOfShanghaiDay(now);
  const todayParts = getShanghaiParts(now);
  const mondayOffset = (todayParts?.weekday ?? 1) === 0 ? 6 : (todayParts.weekday - 1);
  const currentWeekStart = new Date(todayStart.getTime() - mondayOffset * DAY_MS);
  if (previous) {
    return {
      startAt: new Date(currentWeekStart.getTime() - 7 * DAY_MS),
      endAt: currentWeekStart,
      label: '上周',
      includesToday: false,
    };
  }
  return {
    startAt: currentWeekStart,
    endAt: toDate(now),
    label: '本周',
    includesToday: true,
  };
}

function resolveMonthWindow(now, previous = false) {
  const parts = getShanghaiParts(now);
  if (!parts) {
    return null;
  }
  const currentMonthStart = createShanghaiDate(parts.year, parts.month, 1, 0, 0, 0, 0);
  if (previous) {
    const previousMonthStart = createShanghaiDate(
      parts.month === 1 ? parts.year - 1 : parts.year,
      parts.month === 1 ? 12 : parts.month - 1,
      1,
      0,
      0,
      0,
      0,
    );
    return {
      startAt: previousMonthStart,
      endAt: currentMonthStart,
      label: '上月',
      includesToday: false,
    };
  }
  return {
    startAt: currentMonthStart,
    endAt: toDate(now),
    label: '本月',
    includesToday: true,
  };
}

export function normalizeDouyinTimeWindow(input, options = {}) {
  const now = toDate(options.now) ?? new Date();
  const rawInput = normalizeWindowLabel(input);

  /** @type {{startAt: Date, endAt: Date, label: string, includesToday: boolean}|null} */
  let resolved = null;

  if (rawInput === '今天') {
    resolved = resolveTodayWindow(now);
  } else if (rawInput === '昨天') {
    resolved = resolveYesterdayWindow(now);
  } else if (rawInput === '本周') {
    resolved = resolveWeekWindow(now, false);
  } else if (rawInput === '上周') {
    resolved = resolveWeekWindow(now, true);
  } else if (rawInput === '本月') {
    resolved = resolveMonthWindow(now, false);
  } else if (rawInput === '上月') {
    resolved = resolveMonthWindow(now, true);
  } else {
    const recentDays = rawInput.match(/^最近\s*(\d{1,3})\s*天$/u);
    if (recentDays) {
      const dayCount = Math.max(1, Number(recentDays[1]) || 1);
      resolved = {
        startAt: addShanghaiDays(now, -(dayCount - 1)),
        endAt: toDate(now),
        label: `最近${dayCount}天`,
        includesToday: true,
      };
    }
  }

  if (!resolved) {
    const singleDay = parseIsoDateParts(rawInput);
    if (singleDay) {
      const startAt = createShanghaiDate(singleDay.year, singleDay.month, singleDay.day, 0, 0, 0, 0);
      const todayKey = formatShanghaiDayKey(now);
      const singleKey = formatShanghaiDayKey(startAt);
      resolved = {
        startAt,
        endAt: singleKey === todayKey ? toDate(now) : addShanghaiDays(startAt, 1),
        label: rawInput,
        includesToday: singleKey === todayKey,
      };
    }
  }

  if (!resolved) {
    const range = rawInput.match(/^(\d{4}-\d{2}-\d{2})\s*(?:到|至|~|—|-)\s*(\d{4}-\d{2}-\d{2})$/u);
    if (range) {
      const left = parseIsoDateParts(range[1]);
      const right = parseIsoDateParts(range[2]);
      if (left && right) {
        const startAt = createShanghaiDate(left.year, left.month, left.day, 0, 0, 0, 0);
        const endDay = createShanghaiDate(right.year, right.month, right.day, 0, 0, 0, 0);
        const todayKey = formatShanghaiDayKey(now);
        const rightKey = formatShanghaiDayKey(endDay);
        resolved = {
          startAt,
          endAt: rightKey === todayKey ? toDate(now) : addShanghaiDays(endDay, 1),
          label: `${range[1]} 到 ${range[2]}`,
          includesToday: rightKey === todayKey,
        };
      }
    }
  }

  if (!resolved) {
    resolved = resolveTodayWindow(now);
  }

  return {
    input: rawInput,
    label: resolved.label,
    timezone: DEFAULT_DOUYIN_TIMEZONE,
    startAt: resolved.startAt.toISOString(),
    endAt: resolved.endAt.toISOString(),
    startDayKey: formatShanghaiDayKey(resolved.startAt),
    endDayKey: formatShanghaiDayKey(new Date(resolved.endAt.getTime() - 1)),
    includesToday: resolved.includesToday,
    dayKeys: buildDayKeys(resolved.startAt, resolved.endAt),
  };
}

function parseRelativeDouyinTimeText(value, now) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  if (normalized === '刚刚') {
    return {
      publishedAt: toDate(now),
      precision: 'exact',
      timeSource: 'relative-time-text',
    };
  }
  const minuteMatch = normalized.match(/^(\d{1,4})\s*分钟前$/u);
  if (minuteMatch) {
    return {
      publishedAt: new Date(now.getTime() - Number(minuteMatch[1]) * 60_000),
      precision: 'exact',
      timeSource: 'relative-time-text',
    };
  }
  const hourMatch = normalized.match(/^(\d{1,3})\s*小时前$/u);
  if (hourMatch) {
    return {
      publishedAt: new Date(now.getTime() - Number(hourMatch[1]) * 3_600_000),
      precision: 'exact',
      timeSource: 'relative-time-text',
    };
  }
  const dayAgoMatch = normalized.match(/^(\d{1,3})\s*天前$/u);
  if (dayAgoMatch) {
    return {
      publishedAt: addShanghaiDays(now, -Number(dayAgoMatch[1])),
      precision: 'day',
      timeSource: 'relative-time-text',
    };
  }
  const todayTimeMatch = normalized.match(/^今天(?:\s+)?(\d{1,2}):(\d{2})$/u);
  if (todayTimeMatch) {
    const today = getShanghaiParts(now);
    return {
      publishedAt: createShanghaiDate(today.year, today.month, today.day, Number(todayTimeMatch[1]), Number(todayTimeMatch[2]), 0, 0),
      precision: 'exact',
      timeSource: 'relative-time-text',
    };
  }
  const yesterdayTimeMatch = normalized.match(/^昨天(?:\s+)?(\d{1,2}):(\d{2})$/u);
  if (yesterdayTimeMatch) {
    const previousDay = getShanghaiParts(addShanghaiDays(now, -1));
    return {
      publishedAt: createShanghaiDate(previousDay.year, previousDay.month, previousDay.day, Number(yesterdayTimeMatch[1]), Number(yesterdayTimeMatch[2]), 0, 0),
      precision: 'exact',
      timeSource: 'relative-time-text',
    };
  }
  if (normalized === '昨天') {
    return {
      publishedAt: addShanghaiDays(now, -1),
      precision: 'day',
      timeSource: 'relative-time-text',
    };
  }
  if (normalized === '前天') {
    return {
      publishedAt: addShanghaiDays(now, -2),
      precision: 'day',
      timeSource: 'relative-time-text',
    };
  }
  const mdMatch = normalized.match(/^(\d{1,2})月(\d{1,2})日(?:\s+(\d{1,2}):(\d{2}))?$/u);
  if (mdMatch) {
    const nowParts = getShanghaiParts(now);
    let year = nowParts.year;
    const month = Number(mdMatch[1]);
    const day = Number(mdMatch[2]);
    const thisYearCandidate = createShanghaiDate(year, month, day, 0, 0, 0, 0);
    if (thisYearCandidate.getTime() > now.getTime() + DAY_MS) {
      year -= 1;
    }
    return {
      publishedAt: createShanghaiDate(
        year,
        month,
        day,
        mdMatch[3] ? Number(mdMatch[3]) : 0,
        mdMatch[4] ? Number(mdMatch[4]) : 0,
        0,
        0,
      ),
      precision: mdMatch[3] ? 'exact' : 'day',
      timeSource: 'relative-time-text',
    };
  }
  const ymdMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/u);
  if (ymdMatch) {
    return {
      publishedAt: createShanghaiDate(
        Number(ymdMatch[1]),
        Number(ymdMatch[2]),
        Number(ymdMatch[3]),
        ymdMatch[4] ? Number(ymdMatch[4]) : 0,
        ymdMatch[5] ? Number(ymdMatch[5]) : 0,
        0,
        0,
      ),
      precision: ymdMatch[4] ? 'exact' : 'day',
      timeSource: 'relative-time-text',
    };
  }
  return null;
}

function deriveDouyinTimeConfidence(precision, timeSource) {
  if (!precision) {
    return null;
  }
  if (timeSource === 'detail-fallback' || timeSource === 'create-time' || timeSource === 'published-at') {
    return 'high';
  }
  if (precision === 'exact') {
    return 'medium';
  }
  if (precision === 'day') {
    return 'low';
  }
  return 'low';
}

export function normalizeDouyinPublishFields(card = {}, options = {}) {
  const now = toDate(options.now) ?? new Date();
  const timeText = normalizeText(card.timeText ?? card.publishTimeText ?? card.publishText ?? '');
  const existingPublishedAt = toDate(card.publishedAt);
  const createTime = toDate(card.createTime ?? card.create_time ?? card.publishTimestamp ?? null);
  const derived = createTime
    ? { publishedAt: createTime, precision: 'exact', timeSource: 'create-time' }
    : existingPublishedAt
      ? { publishedAt: existingPublishedAt, precision: 'exact', timeSource: normalizeText(card.timeSource) || 'published-at' }
      : parseRelativeDouyinTimeText(timeText, now);
  const publishedAt = derived?.publishedAt ?? null;
  const timeSource = derived?.timeSource ?? (normalizeText(card.timeSource) || null);
  const timePrecision = derived?.precision ?? null;
  return {
    publishedAt: publishedAt ? publishedAt.toISOString() : null,
    publishedDateLocal: publishedAt ? formatShanghaiDateTime(publishedAt) : null,
    publishedDayKey: publishedAt ? formatShanghaiDayKey(publishedAt) : null,
    timeText: timeText || null,
    timePrecision,
    timeSource,
    timeConfidence: deriveDouyinTimeConfidence(timePrecision, timeSource),
  };
}

function escapeRegExp(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function parseDouyinCreateTimeMapFromHtml(html, videoIds = []) {
  const source = String(html ?? '');
  if (!source) {
    return new Map();
  }
  const results = new Map();
  const tryRecord = (videoId, rawTimestamp) => {
    const normalizedVideoId = normalizeText(videoId);
    const numeric = Number(rawTimestamp);
    if (!normalizedVideoId || !Number.isFinite(numeric) || numeric <= 0 || results.has(normalizedVideoId)) {
      return;
    }
    results.set(normalizedVideoId, numeric > 1e12 ? Math.trunc(numeric / 1_000) : Math.trunc(numeric));
  };

  const broadPatterns = [
    /"awemeId"\s*:\s*"(\d{10,20})"[\s\S]{0,1200}?"createTime"\s*:\s*(\d{10,13})/gu,
    /"awemeId"\s*:\s*"(\d{10,20})"[\s\S]{0,1200}?"create_time"\s*:\s*(\d{10,13})/gu,
    /"group_id"\s*:\s*"(\d{10,20})"[\s\S]{0,1200}?"create_time"\s*:\s*(\d{10,13})/gu,
    /"video_id"\s*:\s*"(\d{10,20})"[\s\S]{0,1200}?"createTime"\s*:\s*(\d{10,13})/gu,
  ];
  for (const pattern of broadPatterns) {
    let matched = pattern.exec(source);
    while (matched) {
      tryRecord(matched[1], matched[2]);
      matched = pattern.exec(source);
    }
  }

  for (const rawVideoId of videoIds) {
    const videoId = normalizeText(rawVideoId);
    if (!videoId || results.has(videoId)) {
      continue;
    }
    const targetedPatterns = [
      new RegExp(`"awemeId"\\s*:\\s*"${escapeRegExp(videoId)}"[\\s\\S]{0,1500}?"createTime"\\s*:\\s*(\\d{10,13})`, 'u'),
      new RegExp(`"awemeId"\\s*:\\s*"${escapeRegExp(videoId)}"[\\s\\S]{0,1500}?"create_time"\\s*:\\s*(\\d{10,13})`, 'u'),
      new RegExp(`"group_id"\\s*:\\s*"${escapeRegExp(videoId)}"[\\s\\S]{0,1500}?"create_time"\\s*:\\s*(\\d{10,13})`, 'u'),
    ];
    for (const pattern of targetedPatterns) {
      const matched = source.match(pattern);
      if (matched?.[1]) {
        tryRecord(videoId, matched[1]);
        break;
      }
    }
  }

  return results;
}

export function normalizeDouyinFollowUser(user = {}) {
  const name = normalizeText(user.name ?? user.nickname);
  const url = normalizeText(user.url ?? user.homeUrl);
  const urlUserId = normalizeText(url.match(/\/user\/([^/?#]+)/u)?.[1] ?? '');
  const secUid = normalizeText(user.secUid ?? user.sec_uid ?? urlUserId);
  const uid = normalizeText(user.uid);
  const uniqueId = normalizeText(user.uniqueId ?? user.unique_id);
  const userId = normalizeText(user.userId) || secUid || uid || urlUserId;
  if (!name && !url && !userId && !uid && !secUid) {
    return null;
  }
  return {
    name: name || userId || url || null,
    url: url || (secUid ? `https://www.douyin.com/user/${secUid}` : (userId ? `https://www.douyin.com/user/${userId}` : null)),
    userId: userId || null,
    uid: uid || null,
    secUid: secUid || null,
    uniqueId: uniqueId || null,
  };
}

export function sortDouyinFollowUsers(users = []) {
  return [...users]
    .map((user) => normalizeDouyinFollowUser(user))
    .filter(Boolean)
    .sort((left, right) => String(left.name ?? '').localeCompare(String(right.name ?? ''), 'zh-Hans-CN')
      || String(left.userId ?? '').localeCompare(String(right.userId ?? ''), 'en')
      || String(left.url ?? '').localeCompare(String(right.url ?? ''), 'en'));
}

export function sortDouyinFollowVideos(videos = []) {
  return [...videos]
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = Date.parse(String(left?.publishedAt ?? '')) || 0;
      const rightTime = Date.parse(String(right?.publishedAt ?? '')) || 0;
      return rightTime - leftTime
        || String(left?.authorName ?? '').localeCompare(String(right?.authorName ?? ''), 'zh-Hans-CN')
        || String(left?.videoId ?? '').localeCompare(String(right?.videoId ?? ''), 'en')
        || String(left?.url ?? '').localeCompare(String(right?.url ?? ''), 'en');
    });
}

function matchesAnyFilter(textValues, needles) {
  const normalizedValues = textValues.map((value) => normalizeText(value).toLowerCase()).filter(Boolean);
  const normalizedNeedles = normalizeStringList(needles).map((value) => value.toLowerCase());
  if (!normalizedNeedles.length) {
    return true;
  }
  return normalizedNeedles.some((needle) => normalizedValues.some((value) => value.includes(needle)));
}

function filterDouyinFollowUsers(users = [], userFilter = []) {
  const normalizedUsers = sortDouyinFollowUsers(users);
  if (!normalizeStringList(userFilter).length) {
    return normalizedUsers;
  }
  return normalizedUsers.filter((user) => matchesAnyFilter([
    user?.name,
    user?.userId,
    user?.uid,
    user?.secUid,
    user?.uniqueId,
    user?.url,
  ], userFilter));
}

function filterDouyinVideosByTitle(videos = [], titleKeyword = []) {
  const keywords = normalizeStringList(titleKeyword);
  if (!keywords.length) {
    return sortDouyinFollowVideos(videos);
  }
  return sortDouyinFollowVideos(videos.filter((video) => matchesAnyFilter([
    video?.title,
    video?.timeText,
  ], keywords)));
}

function rebuildVideoGroupsFromFlatVideos(videos = []) {
  const groups = new Map();
  for (const video of sortDouyinFollowVideos(videos)) {
    const key = normalizeText(video?.userId) || normalizeText(video?.authorUrl) || normalizeText(video?.authorName) || normalizeText(video?.videoId);
    if (!key) {
      continue;
    }
    if (!groups.has(key)) {
      groups.set(key, {
        authorName: video?.authorName ?? null,
        authorUrl: video?.authorUrl ?? null,
        userId: video?.userId ?? null,
        videos: [],
      });
    }
    groups.get(key).videos.push(video);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      videos: sortDouyinFollowVideos(group.videos),
    }))
    .sort((left, right) => String(left.authorName ?? '').localeCompare(String(right.authorName ?? ''), 'zh-Hans-CN'));
}

function buildFollowResultMeta(result = {}) {
  return {
    queryType: result.queryType ?? null,
    window: result.window ?? null,
    totalFollowedUsers: Number(result.totalFollowedUsers ?? 0),
    scannedUsers: Number(result.scannedUsers ?? 0),
    matchedUsers: Number(result.matchedUsers ?? 0),
    matchedVideos: Number(result.matchedVideos ?? 0),
    partial: result.partial === true,
    errors: Array.isArray(result.errors) ? result.errors : [],
  };
}

export function projectDouyinFollowResult(result = {}, outputMode = 'full') {
  const normalizedMode = normalizeText(outputMode) || 'full';
  const meta = buildFollowResultMeta(result);
  if (normalizedMode === 'summary') {
    return meta;
  }
  if (normalizedMode === 'users') {
    return {
      ...meta,
      users: Array.isArray(result.users) ? result.users : [],
    };
  }
  if (normalizedMode === 'groups') {
    return {
      ...meta,
      groups: Array.isArray(result.groups) ? result.groups : [],
    };
  }
  if (normalizedMode === 'videos') {
    return {
      ...meta,
      videos: Array.isArray(result.videos) ? result.videos : [],
    };
  }
  return result;
}

export function renderDouyinFollowResultMarkdown(report = {}, projected = {}) {
  const lines = [];
  const siteUrl = normalizeText(report?.site?.url);
  const queryType = projected?.queryType ?? report?.result?.queryType ?? 'query';
  const windowLabel = projected?.window?.label ?? projected?.window?.input ?? null;
  lines.push(`# Douyin ${queryType}`);
  if (siteUrl) {
    lines.push('');
    lines.push(`- Site: ${siteUrl}`);
  }
  if (windowLabel) {
    lines.push(`- Window: ${windowLabel}`);
  }
  lines.push(`- Total followed users: ${projected?.totalFollowedUsers ?? 0}`);
  lines.push(`- Scanned users: ${projected?.scannedUsers ?? 0}`);
  lines.push(`- Matched users: ${projected?.matchedUsers ?? 0}`);
  lines.push(`- Matched videos: ${projected?.matchedVideos ?? 0}`);
  lines.push(`- Partial: ${projected?.partial === true ? 'true' : 'false'}`);
  const errors = Array.isArray(projected?.errors) ? projected.errors : [];
  if (errors.length) {
    lines.push('');
    lines.push('## Errors');
    for (const error of errors) {
      lines.push(`- ${normalizeText(error?.message || error?.reason || 'unknown-error')}`);
    }
  }
  if (Array.isArray(projected?.users)) {
    lines.push('');
    lines.push('## Users');
    for (const user of projected.users) {
      lines.push(`- ${normalizeText(user?.name) || normalizeText(user?.userId) || 'Unknown user'}${user?.uniqueId ? ` (${user.uniqueId})` : ''}`);
    }
  }
  if (Array.isArray(projected?.groups)) {
    lines.push('');
    lines.push('## Groups');
    for (const group of projected.groups) {
      lines.push(`- ${normalizeText(group?.authorName) || normalizeText(group?.userId) || 'Unknown user'}: ${toArray(group?.videos).length} videos`);
      for (const video of toArray(group?.videos)) {
        lines.push(`  - ${normalizeText(video?.publishedDateLocal) || normalizeText(video?.publishedAt) || 'unknown-time'} | ${normalizeText(video?.title) || normalizeText(video?.videoId) || 'untitled'} | ${normalizeText(video?.source) || 'unknown-source'} | ${normalizeText(video?.timeConfidence) || 'unknown-confidence'}`);
      }
    }
  }
  if (Array.isArray(projected?.videos)) {
    lines.push('');
    lines.push('## Videos');
    for (const video of projected.videos) {
      lines.push(`- ${normalizeText(video?.publishedDateLocal) || normalizeText(video?.publishedAt) || 'unknown-time'} | ${normalizeText(video?.authorName) || normalizeText(video?.userId) || 'unknown-user'} | ${normalizeText(video?.title) || normalizeText(video?.videoId) || 'untitled'} | ${normalizeText(video?.source) || 'unknown-source'} | ${normalizeText(video?.timeConfidence) || 'unknown-confidence'}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function resolveDouyinFollowCachePath(userDataDir) {
  if (!userDataDir) {
    return null;
  }
  return path.join(path.resolve(userDataDir), '.bws', DOUYIN_FOLLOW_CACHE_FILE_NAME);
}

function createEmptyFollowCache(now = new Date()) {
  return {
    version: DOUYIN_FOLLOW_CACHE_VERSION,
    timezone: DEFAULT_DOUYIN_TIMEZONE,
    followIndex: {
      lastFollowSyncAt: null,
      users: [],
    },
    queryState: {
      lastCheckpointAt: null,
      lastIntent: null,
      lastWindow: null,
      lastProcessedUserId: null,
      completedUsersCount: 0,
      totalUsers: 0,
    },
    prewarm: {
      lastFollowIndexWarmupAt: null,
      lastActiveUsersWarmupAt: null,
      lastRefreshReason: null,
      nextSuggestedFollowSyncAt: null,
      nextSuggestedActiveUsersWarmupAt: null,
    },
    users: {},
    updatedAt: toDate(now)?.toISOString() ?? new Date().toISOString(),
  };
}

export async function readDouyinFollowCache(userDataDir) {
  const cachePath = resolveDouyinFollowCachePath(userDataDir);
  if (!cachePath || !await pathExists(cachePath)) {
    return createEmptyFollowCache();
  }
  try {
    const payload = await readJsonFile(cachePath);
    return {
      ...createEmptyFollowCache(),
      ...payload,
      followIndex: {
        ...createEmptyFollowCache().followIndex,
        ...(payload?.followIndex ?? {}),
      },
      queryState: {
        ...createEmptyFollowCache().queryState,
        ...(payload?.queryState ?? {}),
      },
      prewarm: {
        ...createEmptyFollowCache().prewarm,
        ...(payload?.prewarm ?? {}),
      },
      users: payload?.users && typeof payload.users === 'object' ? payload.users : {},
    };
  } catch {
    return createEmptyFollowCache();
  }
}

export async function writeDouyinFollowCache(userDataDir, cache) {
  const cachePath = resolveDouyinFollowCachePath(userDataDir);
  if (!cachePath) {
    return null;
  }
  await ensureDir(path.dirname(cachePath));
  await writeJsonFile(cachePath, {
    ...createEmptyFollowCache(),
    ...(cache ?? {}),
  });
  return cachePath;
}

export function isDouyinFollowIndexFresh(cache, options = {}) {
  const now = toDate(options.now) ?? new Date();
  const lastFollowSyncAt = toDate(cache?.followIndex?.lastFollowSyncAt);
  if (!lastFollowSyncAt) {
    return false;
  }
  return (now.getTime() - lastFollowSyncAt.getTime()) <= FOLLOW_CACHE_MAX_AGE_MS;
}

export function pruneDouyinFollowCache(cache, options = {}) {
  const now = toDate(options.now) ?? new Date();
  const cutoff = new Date(now.getTime() - FOLLOW_VIDEO_RETENTION_DAYS * DAY_MS);
  const nextCache = {
    ...createEmptyFollowCache(now),
    ...(cache ?? {}),
    followIndex: {
      ...createEmptyFollowCache(now).followIndex,
      ...(cache?.followIndex ?? {}),
    },
    users: {},
    updatedAt: now.toISOString(),
  };

  for (const [userId, entry] of Object.entries(cache?.users ?? {})) {
    const videos = toArray(entry?.videos)
      .filter(Boolean)
      .filter((video) => {
        const publishedAt = toDate(video?.publishedAt);
        if (!publishedAt) {
          return true;
        }
        return publishedAt.getTime() >= cutoff.getTime();
      });
    nextCache.users[userId] = {
      ...(entry ?? {}),
      videos,
    };
  }

  return nextCache;
}

function dedupeVideoRows(videos = []) {
  const rows = [];
  const seen = new Map();
  const scoreVideoRow = (video) => {
    let total = 0;
    const source = normalizeText(video?.source);
    const timeSource = normalizeText(video?.timeSource);
    const precision = normalizeText(video?.timePrecision);
    if (source === 'detail-fallback') {
      total += 60;
    } else if (source === 'posts-api') {
      total += 50;
    } else if (source === 'dom-fallback') {
      total += 40;
    }
    if (timeSource === 'detail-fallback') {
      total += 30;
    } else if (timeSource === 'create-time' || timeSource === 'published-at') {
      total += 24;
    } else if (timeSource === 'relative-time-text') {
      total += 12;
    }
    if (precision === 'exact') {
      total += 10;
    } else if (precision === 'day') {
      total += 4;
    }
    if (normalizeText(video?.publishedAt)) {
      total += 3;
    }
    if (normalizeText(video?.title)) {
      total += 2;
    }
    if (normalizeText(video?.authorName)) {
      total += 1;
    }
    return total;
  };
  for (const video of videos) {
    if (!video) {
      continue;
    }
    const normalized = {
      ...video,
      videoId: normalizeText(video.videoId),
      url: normalizeText(video.url),
      title: normalizeText(video.title),
      authorName: normalizeText(video.authorName),
      authorUrl: normalizeText(video.authorUrl),
      userId: normalizeText(video.userId),
      timeText: normalizeText(video.timeText),
      source: normalizeText(video.source),
      timeSource: normalizeText(video.timeSource),
      timeConfidence: normalizeText(video.timeConfidence),
    };
    const publishFields = normalizeDouyinPublishFields(normalized);
    const row = {
      ...normalized,
      ...publishFields,
      lastObservedAt: normalizeText(video.lastObservedAt) || new Date().toISOString(),
    };
    const key = row.userId && row.videoId
      ? `${row.userId}::${row.videoId}`
      : row.videoId
        ? `video::${row.videoId}`
        : row.url
          ? `url::${row.url}`
          : row.title;
    if (!key) {
      continue;
    }
    const existingIndex = seen.get(key);
    if (existingIndex === undefined) {
      seen.set(key, rows.length);
      rows.push(row);
      continue;
    }
    if (scoreVideoRow(row) > scoreVideoRow(rows[existingIndex])) {
      rows[existingIndex] = row;
    }
  }
  return rows;
}

export function updateDouyinFollowIndexCache(cache, users, options = {}) {
  const now = toDate(options.now) ?? new Date();
  const nextCache = pruneDouyinFollowCache(cache, { now });
  nextCache.followIndex = {
    lastFollowSyncAt: now.toISOString(),
    users: sortDouyinFollowUsers(users),
  };
  nextCache.updatedAt = now.toISOString();
  return nextCache;
}

export function updateDouyinUserVideoCache(cache, user, videos, options = {}) {
  const now = toDate(options.now) ?? new Date();
  const normalizedUser = normalizeDouyinFollowUser(user);
  if (!normalizedUser?.userId) {
    return pruneDouyinFollowCache(cache, { now });
  }
  const nextCache = pruneDouyinFollowCache(cache, { now });
  const existing = nextCache.users[normalizedUser.userId] ?? {};
  const mergedVideos = dedupeVideoRows([
    ...toArray(existing.videos),
    ...toArray(videos).map((video) => ({
      ...video,
      authorName: normalizeText(video.authorName) || normalizedUser.name,
      authorUrl: normalizeText(video.authorUrl) || normalizedUser.url,
      userId: normalizeText(video.userId) || normalizedUser.userId,
      lastObservedAt: now.toISOString(),
    })),
  ]);
  const sortedMergedVideos = sortDouyinFollowVideos(mergedVideos);
  const latestObservedPublishedAt = sortedMergedVideos[0]?.publishedAt ?? null;
  nextCache.users[normalizedUser.userId] = {
    ...existing,
    ...normalizedUser,
    lastScannedAt: now.toISOString(),
    latestObservedPublishedAt,
    headVideoId: sortedMergedVideos[0]?.videoId ?? existing.headVideoId ?? null,
    videos: sortedMergedVideos,
  };
  nextCache.updatedAt = now.toISOString();
  return nextCache;
}

function mergeDouyinUserCacheEntry(cache, userId, entry, options = {}) {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId || !entry || typeof entry !== 'object') {
    return pruneDouyinFollowCache(cache, options);
  }
  const nextCache = pruneDouyinFollowCache(cache, options);
  const videos = sortDouyinFollowVideos(dedupeVideoRows(toArray(entry?.videos ?? [])));
  nextCache.users[normalizedUserId] = {
    ...(nextCache.users?.[normalizedUserId] ?? {}),
    ...(entry ?? {}),
    latestObservedPublishedAt: entry?.latestObservedPublishedAt ?? videos[0]?.publishedAt ?? null,
    headVideoId: entry?.headVideoId ?? videos[0]?.videoId ?? null,
    videos,
  };
  nextCache.updatedAt = (toDate(options.now) ?? new Date()).toISOString();
  return nextCache;
}

function selectCacheCoveredUsers(cache, users = [], window, options = {}) {
  return users.filter((user) => {
    if (!user?.userId || options.forceRefreshUserCache === true) {
      return false;
    }
    return isDouyinUserCacheWindowCovered(cache, user.userId, window, options);
  });
}

export function isDouyinUserCacheWindowCovered(cache, userId, window, options = {}) {
  const now = toDate(options.now) ?? new Date();
  const entry = cache?.users?.[String(userId ?? '')];
  const lastScannedAt = toDate(entry?.lastScannedAt);
  if (!entry || !lastScannedAt) {
    return false;
  }
  if (formatShanghaiDayKey(lastScannedAt) !== formatShanghaiDayKey(now)) {
    return false;
  }
  const startAt = toDate(window?.startAt);
  const endAt = toDate(window?.endAt);
  if (!startAt || !endAt) {
    return false;
  }
  const coverageStart = new Date(now.getTime() - FOLLOW_VIDEO_RETENTION_DAYS * DAY_MS);
  return startAt.getTime() >= coverageStart.getTime() && endAt.getTime() <= now.getTime();
}

function buildDouyinWindowKey(window = null) {
  if (!window) {
    return null;
  }
  return [window.startAt ?? '', window.endAt ?? '', window.label ?? ''].join('::');
}

function canReuseCachedVideosAfterHeadCheck(cache, userId, window, firstPageHeadVideoId, options = {}) {
  const entry = cache?.users?.[String(userId ?? '')];
  if (!entry || !firstPageHeadVideoId) {
    return false;
  }
  if (normalizeText(entry.headVideoId) !== normalizeText(firstPageHeadVideoId)) {
    return false;
  }
  if (isDouyinUserCacheWindowCovered(cache, userId, window, options)) {
    return true;
  }
  const lastScannedAt = toDate(entry?.lastScannedAt);
  const startAt = toDate(window?.startAt);
  if (!lastScannedAt || !startAt) {
    return false;
  }
  const coverageStart = new Date((toDate(options.now) ?? new Date()).getTime() - FOLLOW_VIDEO_RETENTION_DAYS * DAY_MS);
  return startAt.getTime() >= coverageStart.getTime();
}

function resolveDouyinFollowResumeState(cache, intent, window, targetUsers, options = {}) {
  if (options.forceRefreshUserCache === true) {
    return { resumed: false, resumeIndex: 0 };
  }
  const queryState = cache?.queryState ?? {};
  if (normalizeText(queryState.lastIntent) !== normalizeText(intent)) {
    return { resumed: false, resumeIndex: 0 };
  }
  if (buildDouyinWindowKey(window) !== normalizeText(queryState.lastWindow)) {
    return { resumed: false, resumeIndex: 0 };
  }
  const completedUsersCount = Math.max(0, Number(queryState.completedUsersCount ?? 0));
  if (!completedUsersCount || completedUsersCount >= targetUsers.length) {
    return { resumed: false, resumeIndex: 0 };
  }
  const totalUsers = Math.max(0, Number(queryState.totalUsers ?? 0));
  if (totalUsers && totalUsers !== targetUsers.length) {
    return { resumed: false, resumeIndex: 0 };
  }
  const lastProcessedUserId = normalizeText(queryState.lastProcessedUserId);
  if (!lastProcessedUserId) {
    return { resumed: false, resumeIndex: 0 };
  }
  const checkpointIndex = targetUsers.findIndex((user) => normalizeText(user?.userId) === lastProcessedUserId);
  if (checkpointIndex < 0) {
    return { resumed: false, resumeIndex: 0 };
  }
  const resumeIndex = Math.max(checkpointIndex + 1, completedUsersCount);
  if (resumeIndex <= 0 || resumeIndex >= targetUsers.length) {
    return { resumed: false, resumeIndex: 0 };
  }
  return {
    resumed: true,
    resumeIndex,
  };
}

function updateDouyinFollowQueryCheckpoint(cache, intent, window, processedUserId, completedUsersCount, totalUsers, options = {}) {
  const now = toDate(options.now) ?? new Date();
  return {
    ...cache,
    queryState: {
      ...(cache?.queryState ?? {}),
      lastCheckpointAt: now.toISOString(),
      lastIntent: intent ?? null,
      lastWindow: buildDouyinWindowKey(window),
      lastProcessedUserId: normalizeText(processedUserId) || null,
      completedUsersCount: Number(completedUsersCount ?? 0),
      totalUsers: Number(totalUsers ?? 0),
    },
    updatedAt: now.toISOString(),
  };
}

function updateDouyinPrewarmState(cache, summary = {}, options = {}) {
  const now = toDate(options.now) ?? new Date();
  const nextFollowSyncAt = new Date(now.getTime() + FOLLOW_CACHE_MAX_AGE_MS).toISOString();
  const nextActiveUsersWarmupAt = new Date(now.getTime() + (2 * 60 * 60 * 1000)).toISOString();
  return {
    ...cache,
    prewarm: {
      ...(cache?.prewarm ?? {}),
      lastFollowIndexWarmupAt: summary.followIndexRefreshed ? now.toISOString() : (cache?.prewarm?.lastFollowIndexWarmupAt ?? null),
      lastActiveUsersWarmupAt: summary.activeUsersRefreshed ? now.toISOString() : (cache?.prewarm?.lastActiveUsersWarmupAt ?? null),
      lastRefreshReason: normalizeText(summary.reason) || null,
      nextSuggestedFollowSyncAt: nextFollowSyncAt,
      nextSuggestedActiveUsersWarmupAt: nextActiveUsersWarmupAt,
    },
    updatedAt: now.toISOString(),
  };
}

function selectRecentActiveUsersFromCache(cache, options = {}) {
  const now = toDate(options.now) ?? new Date();
  const recentActiveDays = normalizePositiveInteger(options.recentActiveDays, DEFAULT_OPTIONS.recentActiveDays);
  const recentActiveUsersLimit = normalizePositiveInteger(options.recentActiveUsersLimit, DEFAULT_OPTIONS.recentActiveUsersLimit);
  const threshold = new Date(now.getTime() - recentActiveDays * DAY_MS);
  return Object.values(cache?.users ?? {})
    .map((entry) => {
      const normalized = normalizeDouyinFollowUser(entry);
      if (!normalized?.userId) {
        return null;
      }
      const cachedEntry = cache?.users?.[String(normalized.userId ?? '')] ?? {};
      const lastScannedAt = toDate(cachedEntry?.lastScannedAt);
      const latestObservedPublishedAt = toDate(cachedEntry?.latestObservedPublishedAt);
      return {
        normalized,
        lastActivityAt: latestObservedPublishedAt ?? lastScannedAt ?? null,
      };
    })
    .filter(Boolean)
    .filter((entry) => entry.lastActivityAt && entry.lastActivityAt.getTime() >= threshold.getTime())
    .sort((left, right) => {
      return (right.lastActivityAt?.getTime() ?? 0) - (left.lastActivityAt?.getTime() ?? 0)
        || String(left.normalized.name ?? '').localeCompare(String(right.normalized.name ?? ''), 'zh-Hans-CN');
    })
    .slice(0, recentActiveUsersLimit)
    .map((entry) => entry.normalized);
}

const DEFAULT_TIMEOUT_MS = 30_000;
const QUERY_WAIT_POLL_MS = 350;
const QUERY_WAIT_IDLE_MS = 250;
const DETAIL_FALLBACK_LIMIT = 4;
const FOLLOW_USER_SCROLL_MAX_ROUNDS = 30;
const FOLLOW_POST_SCROLL_MAX_ROUNDS = 32;
const FOLLOW_SCROLL_DELAY_MS = 450;
const DEFAULT_SCAN_CONCURRENCY = 3;
const DEFAULT_SESSION_LEASE_WAIT_MS = 15_000;
const DEFAULT_SESSION_LEASE_POLL_INTERVAL_MS = 250;
const DEFAULT_SESSION_OPEN_RETRIES = 3;
const DEFAULT_USER_SCAN_RETRIES = 2;
const DEFAULT_POSTS_API_PAGE_SIZE = 35;

const DEFAULT_OPTIONS = Object.freeze({
  profilePath: null,
  browserPath: undefined,
  browserProfileRoot: undefined,
  userDataDir: undefined,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  headless: undefined,
  reuseLoginState: true,
  autoLogin: true,
  intent: 'list-followed-updates',
  timeWindow: '今天',
  output: 'full',
  format: 'json',
  userFilter: [],
  titleKeyword: [],
  limit: null,
  updatedOnly: false,
  checkpointEveryUsers: 12,
  scanConcurrency: DEFAULT_SCAN_CONCURRENCY,
  recentActiveDays: 3,
  recentActiveUsersLimit: 48,
  forceRefreshFollowIndex: false,
  forceRefreshUserCache: false,
  sessionLeaseWaitMs: DEFAULT_SESSION_LEASE_WAIT_MS,
  sessionLeasePollIntervalMs: DEFAULT_SESSION_LEASE_POLL_INTERVAL_MS,
  sessionOpenRetries: DEFAULT_SESSION_OPEN_RETRIES,
  userScanRetries: DEFAULT_USER_SCAN_RETRIES,
  workspaceRoot: process.cwd(),
  viewport: {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
  },
});

function matchesWindow(video, window) {
  const publishedAt = toDate(video?.publishedAt);
  if (!publishedAt) {
    return false;
  }
  const startAt = toDate(window?.startAt);
  const endAt = toDate(window?.endAt);
  if (!startAt || !endAt) {
    return false;
  }
  return publishedAt.getTime() >= startAt.getTime() && publishedAt.getTime() < endAt.getTime();
}

function shouldResolveDetailTimestamp(video, window) {
  if (!video?.url || !video?.videoId) {
    return false;
  }
  if (video?.publishedAt && video?.timePrecision === 'exact') {
    return false;
  }
  if (!video?.publishedDayKey) {
    return true;
  }
  const boundaryKeys = uniqueSortedStrings([window?.startDayKey, window?.endDayKey]);
  return boundaryKeys.includes(video.publishedDayKey);
}

function buildQueryWaitPolicy(timeoutMs) {
  return {
    useLoadEvent: false,
    useNetworkIdle: false,
    documentReadyTimeoutMs: timeoutMs,
    domQuietTimeoutMs: Math.min(timeoutMs, 5_000),
    domQuietMs: 200,
    idleMs: QUERY_WAIT_IDLE_MS,
  };
}

function normalizeObservedVideo(video, fallbackUser = {}, options = {}) {
  const normalized = {
    title: normalizeText(video?.title),
    url: normalizeText(video?.url),
    videoId: normalizeText(video?.videoId),
    authorName: normalizeText(video?.authorName) || normalizeText(fallbackUser?.name),
    authorUrl: normalizeText(video?.authorUrl) || normalizeText(fallbackUser?.url),
    userId: normalizeText(video?.userId) || normalizeText(fallbackUser?.userId),
    timeText: normalizeText(video?.timeText),
    createTime: video?.createTime ?? video?.create_time ?? null,
    source: normalizeText(video?.source),
    timeSource: normalizeText(video?.timeSource),
    timeConfidence: normalizeText(video?.timeConfidence),
    resolvedMediaUrl: normalizeText(video?.resolvedMediaUrl),
    resolvedTitle: normalizeText(video?.resolvedTitle),
    resolvedFormat: video?.resolvedFormat ?? null,
    resolvedFormats: Array.isArray(video?.resolvedFormats) ? video.resolvedFormats : [],
  };
  return {
    ...normalized,
    ...normalizeDouyinPublishFields(normalized, options),
  };
}

function finalizePostsApiVideo(video = {}) {
  const { awemeData, ...rest } = video ?? {};
  const seed = buildDouyinDownloadTaskSeed(video?.awemeData ?? null, {
    requestedUrl: normalizeText(video?.url) || (normalizeText(video?.videoId) ? `https://www.douyin.com/video/${video.videoId}` : null),
  });
  return {
    ...rest,
    resolvedMediaUrl: normalizeText(video?.resolvedMediaUrl) || seed?.resolvedMediaUrl || null,
    resolvedTitle: normalizeText(video?.resolvedTitle) || seed?.resolvedTitle || null,
    resolvedFormat: video?.resolvedFormat ?? seed?.resolvedFormat ?? null,
    resolvedFormats: [],
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAnySelector(session, selectors, timeoutMs = 10_000) {
  const normalizedSelectors = toArray(selectors).map((value) => String(value ?? '').trim()).filter(Boolean);
  if (!normalizedSelectors.length) {
    return false;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const matched = await session.callPageFunction((selectorList) => {
        const isVisible = (node) => {
          if (!(node instanceof Element)) {
            return false;
          }
          const style = window.getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) {
            return false;
          }
          const rect = node.getBoundingClientRect();
          return rect.width >= 4 && rect.height >= 4;
        };
        for (const selector of selectorList) {
          try {
            const node = document.querySelector(selector);
            if (isVisible(node)) {
              return true;
            }
          } catch {
            // Ignore invalid selectors.
          }
        }
        return false;
      }, normalizedSelectors);
      if (matched) {
        return true;
      }
    } catch {
      // Ignore transient navigation-time runtime errors.
    }
    await new Promise((resolve) => setTimeout(resolve, QUERY_WAIT_POLL_MS));
  }
  return false;
}

async function navigateDouyinPage(session, url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const pageType = inferDouyinPageTypeFromUrl(url);
  await session.navigateAndWait(url, buildQueryWaitPolicy(timeoutMs));
  await waitForAnySelector(
    session,
    resolveDouyinReadySelectors(pageType) ?? ['a[href*="/video/"]', 'a[href*="/user/"]'],
    Math.min(timeoutMs, 12_000),
  );
  return {
    url,
    pageType,
  };
}

async function pageCollectDouyinFollowUsers(session) {
  return await session.callPageFunction(async () => {
    const normalizeTextLocal = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
    const normalizeUrlLocal = (value) => {
      try {
        return new URL(String(value ?? ''), window.location.href).toString();
      } catch {
        return normalizeTextLocal(value);
      }
    };
    const userIdFromUrl = (value) => normalizeTextLocal(String(value ?? '').match(/\/user\/([^/?#]+)/u)?.[1] || '') || null;
    const isVisible = (node) => {
      if (!(node instanceof Element)) {
        return false;
      }
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) {
        return false;
      }
      const rect = node.getBoundingClientRect();
      return rect.width >= 8 && rect.height >= 8;
    };
    const terminalPatterns = [/没有更多/u, /已经到底了/u, /暂无关注/u];
    const users = [];
    const seen = new Set();
    let terminalReached = false;

    const collectVisibleUsers = () => {
      for (const anchor of Array.from(document.querySelectorAll('a[href*="/user/"]'))) {
        if (!(anchor instanceof HTMLAnchorElement) || !isVisible(anchor)) {
          continue;
        }
        const href = normalizeUrlLocal(anchor.getAttribute('href') || '');
        if (!href || /\/user\/self(?:[/?#]|$)/iu.test(href)) {
          continue;
        }
        const container = anchor.closest('li, article, [data-e2e*="follow"], [class*="user"], div');
        const name = normalizeTextLocal(
          anchor.getAttribute('title')
          || anchor.textContent
          || container?.querySelector?.('[title]')?.getAttribute?.('title')
          || container?.textContent
          || '',
        ).split(/\n+/u)[0];
        const userId = userIdFromUrl(href);
        const key = userId ? `user::${userId}` : `url::${href}`;
        if (!key || seen.has(key)) {
          continue;
        }
        seen.add(key);
        users.push({
          name: name || userId || href,
          url: href,
          userId: userId || null,
        });
      }
      const source = normalizeTextLocal(document.body?.innerText || document.documentElement?.innerText || '');
      terminalReached = terminalReached || terminalPatterns.some((pattern) => pattern.test(source));
    };
    collectVisibleUsers();

    return {
      users,
      terminalReached,
    };
  });
}

async function pageCollectDouyinUserPosts(session) {
  return await session.callPageFunction(async () => {
    const normalizeTextLocal = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
    const normalizeUrlLocal = (value) => {
      try {
        return new URL(String(value ?? ''), window.location.href).toString();
      } catch {
        return normalizeTextLocal(value);
      }
    };
    const userIdFromUrl = (value) => normalizeTextLocal(String(value ?? '').match(/\/user\/([^/?#]+)/u)?.[1] || '') || null;
    const videoIdFromUrl = (value) => normalizeTextLocal(String(value ?? '').match(/\/(?:video|shipin)\/([^/?#]+)/u)?.[1] || '') || null;
    const isVisible = (node) => {
      if (!(node instanceof Element)) {
        return false;
      }
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) {
        return false;
      }
      const rect = node.getBoundingClientRect();
      return rect.width >= 8 && rect.height >= 8;
    };
    const timePattern = /(刚刚|今天(?:\s+\d{1,2}:\d{2})?|昨天(?:\s+\d{1,2}:\d{2})?|前天|\d+\s*(?:分钟前|小时前|天前)|\d{4}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{2})?|\d{1,2}月\d{1,2}日(?:\s+\d{1,2}:\d{2})?)/u;
    const terminalPatterns = [/没有更多/u, /已经到底了/u, /暂无内容/u, /暂无作品/u];
    const posts = [];
    const seen = new Set();
    let terminalReached = false;

    const pickTimeText = (container) => {
      const candidates = [];
      for (const selector of ['[data-e2e*="time"]', '[class*="time"]', '[class*="date"]', 'time']) {
        try {
          for (const node of Array.from(container?.querySelectorAll?.(selector) ?? [])) {
            const text = normalizeTextLocal(node?.textContent || node?.getAttribute?.('datetime') || '');
            if (text) {
              candidates.push(text);
            }
          }
        } catch {
          // Ignore selector failures.
        }
      }
      const allText = normalizeTextLocal(container?.innerText || container?.textContent || '');
      if (allText) {
        candidates.push(...allText.split(/\n+/u).map((line) => normalizeTextLocal(line)));
      }
      for (const candidate of candidates) {
        const matched = candidate.match(timePattern);
        if (matched?.[1]) {
          return matched[1];
        }
      }
      return null;
    };

    const collectVisiblePosts = () => {
      for (const anchor of Array.from(document.querySelectorAll('a[href*="/video/"], a[href*="/shipin/"]'))) {
        if (!(anchor instanceof HTMLAnchorElement) || !isVisible(anchor)) {
          continue;
        }
        const url = normalizeUrlLocal(anchor.getAttribute('href') || '');
        const videoId = videoIdFromUrl(url);
        if (!url || !videoId) {
          continue;
        }
        const container = anchor.closest('[data-e2e*="user-post-item"], [data-e2e*="video-feed-item"], li, article, div');
        const title = normalizeTextLocal(
          anchor.getAttribute('title')
          || anchor.textContent
          || container?.querySelector?.('[title]')?.getAttribute?.('title')
          || container?.querySelector?.('img[alt]')?.getAttribute?.('alt')
          || '',
        );
        const timeText = pickTimeText(container);
        const key = `video::${videoId}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        posts.push({
          title: title || videoId,
          url,
          videoId,
          timeText,
        });
      }
      const source = normalizeTextLocal(document.body?.innerText || document.documentElement?.innerText || '');
      terminalReached = terminalReached || terminalPatterns.some((pattern) => pattern.test(source));
    };
    collectVisiblePosts();

    const pathname = String(window.location.pathname || '');
    const finalUrl = window.location.href;
    return {
      finalUrl,
      authorUrl: finalUrl,
      userId: userIdFromUrl(pathname ? `https://www.douyin.com${pathname}` : finalUrl),
      authorName: normalizeTextLocal(document.querySelector('h1')?.textContent || document.title.replace(/\s*-\s*抖音.*$/u, '')),
      posts,
      terminalReached,
    };
  });
}

async function resolveDouyinDetailTimestamp(session, videoUrl, videoId, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!videoUrl || !videoId) {
    return null;
  }
  await navigateDouyinPage(session, videoUrl, Math.min(timeoutMs, 15_000));
  const html = await session.captureHtml();
  const createTimeMap = parseDouyinCreateTimeMapFromHtml(html, [videoId]);
  const createTime = createTimeMap.get(videoId);
  if (!createTime) {
    return null;
  }
  return {
    ...normalizeDouyinPublishFields({ createTime, timeSource: 'detail-fallback' }, { now: new Date() }),
    source: 'detail-fallback',
    timeSource: 'detail-fallback',
    timeConfidence: 'high',
  };
}

async function scrollDouyinPage(session) {
  await session.callPageFunction(() => {
    window.scrollTo(0, document.documentElement.scrollHeight || document.body.scrollHeight || 0);
    return true;
  });
  await sleep(FOLLOW_SCROLL_DELAY_MS);
}

async function pageFetchDouyinFollowingPage(session, input = {}) {
  return await session.callPageFunction(async (request = {}) => {
    const normalizeTextLocal = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
    const renderNode = document.getElementById('RENDER_DATA');
    let renderData = null;
    try {
      renderData = renderNode?.textContent ? JSON.parse(decodeURIComponent(renderNode.textContent)) : null;
    } catch {
      renderData = null;
    }
    const selfInfo = renderData?.app?.user?.info ?? null;
    const userId = normalizeTextLocal(request.userId || selfInfo?.uid || '');
    const secUid = normalizeTextLocal(request.secUid || selfInfo?.secUid || selfInfo?.sec_uid || '');
    if (!userId && !secUid) {
      return {
        users: [],
        hasMore: false,
        nextOffset: Number(request.offset) || 0,
        total: 0,
        error: 'missing-self-user-info',
      };
    }
    const params = new URLSearchParams({
      device_platform: 'webapp',
      aid: '6383',
      channel: 'channel_pc_web',
      offset: String(Number(request.offset) || 0),
      min_time: '0',
      max_time: '0',
      count: String(Math.max(1, Number(request.count) || 20)),
      source_type: '4',
      gps_access: '0',
      address_book_access: '0',
      is_top: '1',
    });
    if (userId) {
      params.set('user_id', userId);
    }
    if (secUid) {
      params.set('sec_user_id', secUid);
    }
    const response = await fetch(`/aweme/v1/web/user/following/list/?${params.toString()}`, {
      credentials: 'include',
    });
    const json = await response.json();
    const users = Array.isArray(json?.followings)
      ? json.followings.map((following) => ({
        name: normalizeTextLocal(following?.nickname || following?.remark_name || following?.unique_id || following?.uid || ''),
        url: normalizeTextLocal(
          following?.sec_uid
            ? `https://www.douyin.com/user/${following.sec_uid}`
            : following?.uid
              ? `https://www.douyin.com/user/${following.uid}`
              : '',
        ) || null,
        userId: normalizeTextLocal(following?.sec_uid || following?.uid || ''),
        uid: normalizeTextLocal(following?.uid || ''),
        secUid: normalizeTextLocal(following?.sec_uid || ''),
        uniqueId: normalizeTextLocal(following?.unique_id || ''),
      }))
      : [];
    return {
      users,
      hasMore: json?.has_more === true || Number(json?.has_more) === 1,
      nextOffset: Number(json?.offset) || ((Number(request.offset) || 0) + users.length),
      total: Number(json?.total) || 0,
      error: response.ok ? null : `http-${response.status}`,
    };
  }, input);
}

async function pageFetchDouyinUserPostsPage(session, input = {}) {
  const page = await session.callPageFunction(async (request = {}) => {
    const normalizeTextLocal = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
    const compactVideo = (video) => {
      if (!video || typeof video !== 'object') {
        return null;
      }
      return {
        width: Number(video?.width) || 0,
        height: Number(video?.height) || 0,
        duration: Number(video?.duration) || 0,
        format: normalizeTextLocal(video?.format || ''),
        play_addr: video?.play_addr ?? null,
        play_addr_h264: video?.play_addr_h264 ?? video?.playAddrH264 ?? null,
        play_addr_265: video?.play_addr_265 ?? video?.playAddr265 ?? null,
        download_addr: video?.download_addr ?? null,
        bit_rate: Array.isArray(video?.bit_rate)
          ? video.bit_rate.map((entry) => ({
            gear_name: normalizeTextLocal(entry?.gear_name || entry?.gearName || ''),
            quality_type: Number(entry?.quality_type ?? entry?.qualityType) || 0,
            bit_rate: Number(entry?.bit_rate ?? entry?.bitRate) || 0,
            width: Number(entry?.width) || 0,
            height: Number(entry?.height) || 0,
            format: normalizeTextLocal(entry?.format || ''),
            is_h265: entry?.is_h265 ?? entry?.isH265 ?? 0,
            play_addr: entry?.play_addr ?? null,
            play_addr_h264: entry?.play_addr_h264 ?? entry?.playAddrH264 ?? null,
            play_addr_265: entry?.play_addr_265 ?? entry?.playAddr265 ?? null,
          }))
          : [],
      };
    };
    const params = new URLSearchParams({
      device_platform: 'webapp',
      aid: '6383',
      channel: 'channel_pc_web',
      max_cursor: String(Number(request.maxCursor) || 0),
      count: String(Math.max(1, Number(request.count) || 18)),
    });
    const userId = normalizeTextLocal(request.uid || '');
    const secUid = normalizeTextLocal(request.secUid || request.userId || '');
    if (userId) {
      params.set('user_id', userId);
    }
    if (secUid) {
      params.set('sec_user_id', secUid);
    }
    const response = await fetch(`/aweme/v1/web/aweme/post/?${params.toString()}`, {
      credentials: 'include',
    });
    const json = await response.json();
    const videos = Array.isArray(json?.aweme_list)
      ? json.aweme_list
        .filter((aweme) => aweme && typeof aweme === 'object' && aweme.aweme_id)
        .map((aweme) => ({
          title: normalizeTextLocal(aweme?.desc || aweme?.share_info?.share_title || aweme?.aweme_id || ''),
          url: normalizeTextLocal(aweme?.share_url || (aweme?.aweme_id ? `https://www.douyin.com/video/${aweme.aweme_id}` : '')) || null,
          videoId: normalizeTextLocal(aweme?.aweme_id || ''),
          authorName: normalizeTextLocal(aweme?.author?.nickname || ''),
          authorUrl: normalizeTextLocal(
            aweme?.author?.sec_uid
              ? `https://www.douyin.com/user/${aweme.author.sec_uid}`
              : aweme?.author?.uid
                ? `https://www.douyin.com/user/${aweme.author.uid}`
                : '',
          ) || null,
          userId: normalizeTextLocal(aweme?.author?.sec_uid || aweme?.author?.uid || ''),
          uid: normalizeTextLocal(aweme?.author?.uid || ''),
          secUid: normalizeTextLocal(aweme?.author?.sec_uid || ''),
          createTime: aweme?.create_time ?? null,
          source: 'posts-api',
          timeSource: aweme?.create_time ? 'create-time' : null,
          awemeData: {
            aweme_id: normalizeTextLocal(aweme?.aweme_id || ''),
            desc: normalizeTextLocal(aweme?.desc || ''),
            create_time: aweme?.create_time ?? null,
            share_info: aweme?.share_info
              ? {
                share_title: normalizeTextLocal(aweme?.share_info?.share_title || ''),
              }
              : null,
            author: {
              uid: normalizeTextLocal(aweme?.author?.uid || ''),
              sec_uid: normalizeTextLocal(aweme?.author?.sec_uid || ''),
              nickname: normalizeTextLocal(aweme?.author?.nickname || ''),
            },
            video: compactVideo(aweme?.video),
          },
        }))
      : [];
    return {
      videos,
      hasMore: json?.has_more === true || Number(json?.has_more) === 1,
      nextCursor: Number(json?.max_cursor) || 0,
      error: response.ok ? null : `http-${response.status}`,
    };
  }, input);
  return {
    ...page,
    videos: toArray(page?.videos).map((video) => finalizePostsApiVideo(video)),
  };
}

async function collectFollowUsersWithCache(session, authContext, cache, options = {}) {
  const cachedUsers = sortDouyinFollowUsers(cache?.followIndex?.users ?? []);
  if (options.forceRefreshFollowIndex !== true && isDouyinFollowIndexFresh(cache, options) && cachedUsers.length > 0) {
    return {
      users: cachedUsers,
      cache,
      cacheHit: true,
      partial: false,
    };
  }

  const followUsersUrl = normalizeText(authContext?.siteProfile?.authValidationSamples?.followUsersUrl)
    || 'https://www.douyin.com/follow?tab=user';
  await navigateDouyinPage(session, followUsersUrl, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const apiUsers = [];
  const seenApiUsers = new Set();
  let apiOffset = 0;
  let apiHasMore = true;
  let apiTotal = 0;
  let apiError = null;
  while (apiHasMore && apiOffset < 10_000) {
    const page = await pageFetchDouyinFollowingPage(session, {
      offset: apiOffset,
      count: 60,
    });
    if (page?.error) {
      apiError = page.error;
      break;
    }
    const pageUsers = sortDouyinFollowUsers(page?.users ?? []);
    if (!pageUsers.length) {
      apiHasMore = false;
      break;
    }
    let newCount = 0;
    for (const user of pageUsers) {
      const key = user?.userId ? `user::${user.userId}` : user?.uid ? `uid::${user.uid}` : user?.url ? `url::${user.url}` : null;
      if (!key || seenApiUsers.has(key)) {
        continue;
      }
      seenApiUsers.add(key);
      apiUsers.push(user);
      newCount += 1;
    }
    apiTotal = Math.max(apiTotal, Number(page?.total) || 0);
    apiHasMore = page?.hasMore === true;
    apiOffset = Number(page?.nextOffset) || (apiOffset + pageUsers.length);
    if (newCount === 0) {
      break;
    }
    if (apiTotal > 0 && apiUsers.length >= apiTotal) {
      apiHasMore = false;
    }
  }
  if (apiUsers.length > 0) {
    const users = sortDouyinFollowUsers(apiUsers);
    const nextCache = updateDouyinFollowIndexCache(cache, users, options);
    return {
      users,
      cache: nextCache,
      cacheHit: false,
      partial: apiHasMore || Boolean(apiError),
    };
  }
  let users = sortDouyinFollowUsers([]);
  let stableRounds = 0;
  let previousCount = 0;
  let terminalReached = false;
  for (let round = 0; round < FOLLOW_USER_SCROLL_MAX_ROUNDS; round += 1) {
    const sampled = await pageCollectDouyinFollowUsers(session);
    users = sortDouyinFollowUsers(sampled.users);
    terminalReached = sampled.terminalReached === true;
    if (users.length === previousCount) {
      stableRounds += 1;
    } else {
      previousCount = users.length;
      stableRounds = 0;
    }
    if (terminalReached || stableRounds >= 3) {
      break;
    }
    await scrollDouyinPage(session);
  }
  const nextCache = updateDouyinFollowIndexCache(cache, users, options);
  return {
    users,
    cache: nextCache,
    cacheHit: false,
    partial: terminalReached !== true && stableRounds < 3,
  };
}

function isTransientFollowQueryError(error) {
  const message = normalizeText(error?.message ?? error);
  return /CDP socket closed/iu.test(message)
    || /CDP timeout/iu.test(message)
    || /Runtime\.evaluate/iu.test(message)
    || /Browser exited before DevTools became ready/iu.test(message)
    || /WebSocket is not open/iu.test(message)
    || /Target closed|Inspector\.detached/iu.test(message);
}

async function collectUserUpdatesWithRetry(session, user, window, cache, options = {}) {
  const maxRetries = Math.max(0, normalizePositiveInteger(options.userScanRetries, DEFAULT_USER_SCAN_RETRIES) ?? DEFAULT_USER_SCAN_RETRIES);
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await collectUserUpdates(session, user, window, cache, options);
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !isTransientFollowQueryError(error)) {
        break;
      }
    }
  }
  return {
    user,
    videos: [],
    cache,
    cacheHit: false,
    error: normalizeText(lastError?.message ?? lastError) || 'transient-follow-query-failure',
  };
}

async function collectUserUpdates(session, user, window, cache, options = {}) {
  const entry = cache?.users?.[String(user?.userId ?? '')] ?? null;
  if (options.forceRefreshUserCache !== true && user?.userId && isDouyinUserCacheWindowCovered(cache, user.userId, window, options)) {
    const cachedVideos = toArray(entry?.videos).map((video) => normalizeObservedVideo(video, user, options));
    return {
      user,
      videos: sortDouyinFollowVideos(cachedVideos.filter((video) => matchesWindow(video, window))),
      cache,
      cacheHit: true,
      error: null,
    };
  }

  const postsUrl = normalizeText(user?.url)
    ? `${normalizeText(user.url).split('?')[0]}?showTab=post`
    : user?.userId
      ? `https://www.douyin.com/user/${user.userId}?showTab=post`
      : null;
  if (!postsUrl) {
    return {
      user,
      videos: [],
      cache,
      cacheHit: false,
      error: 'missing-user-url',
    };
  }

  const apiVideos = [];
  const seenApiVideos = new Set();
  let apiCursor = 0;
  let apiHasMore = true;
  let apiError = null;
  let apiCoverageConfirmed = false;
  while (apiHasMore) {
    const page = await pageFetchDouyinUserPostsPage(session, {
      userId: user?.userId,
      uid: user?.uid,
      secUid: user?.secUid ?? user?.userId,
      maxCursor: apiCursor,
      count: DEFAULT_POSTS_API_PAGE_SIZE,
    });
    if (page?.error) {
      apiError = page.error;
      break;
    }
    const pageVideos = sortDouyinFollowVideos(
      toArray(page?.videos).map((video) => normalizeObservedVideo(video, user, options)),
    );
    if (!pageVideos.length) {
      apiHasMore = false;
      apiCoverageConfirmed = true;
      break;
    }
    if (
      apiCursor === 0
      && options.forceRefreshUserCache !== true
      && user?.userId
      && canReuseCachedVideosAfterHeadCheck(cache, user.userId, window, pageVideos[0]?.videoId, options)
    ) {
      const cachedVideos = toArray(entry?.videos).map((video) => normalizeObservedVideo(video, user, options));
      const nextCache = updateDouyinUserVideoCache(cache, user, cachedVideos, options);
      return {
        user,
        videos: sortDouyinFollowVideos(cachedVideos.filter((video) => matchesWindow(video, window))),
        cache: nextCache,
        cacheHit: true,
        error: null,
      };
    }
    for (const video of pageVideos) {
      const key = video?.videoId ? `video::${video.videoId}` : video?.url ? `url::${video.url}` : null;
      if (!key || seenApiVideos.has(key)) {
        continue;
      }
      seenApiVideos.add(key);
      apiVideos.push(video);
    }
    const oldestVideo = pageVideos[pageVideos.length - 1];
    const oldestPublishedAt = toDate(oldestVideo?.publishedAt);
    if (oldestPublishedAt && oldestPublishedAt.getTime() < Date.parse(window.startAt)) {
      apiHasMore = false;
      apiCoverageConfirmed = true;
      break;
    }
    apiHasMore = page?.hasMore === true;
    apiCursor = Number(page?.nextCursor) || 0;
    if (!apiHasMore || apiCursor <= 0) {
      apiCoverageConfirmed = true;
      break;
    }
  }
  if ((!apiError && (apiVideos.length > 0 || apiCoverageConfirmed)) || (apiError && apiCoverageConfirmed)) {
    const nextCache = updateDouyinUserVideoCache(cache, user, apiVideos, options);
    return {
      user,
      videos: sortDouyinFollowVideos(apiVideos.filter((video) => matchesWindow(video, window))),
      cache: nextCache,
      cacheHit: false,
      error: null,
    };
  }

  await navigateDouyinPage(session, postsUrl, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let observed = null;
  let normalizedVideos = [];
  let stableRounds = 0;
  let previousCount = 0;
  let olderStreak = 0;
  for (let round = 0; round < FOLLOW_POST_SCROLL_MAX_ROUNDS; round += 1) {
    const sampled = await pageCollectDouyinUserPosts(session);
    observed = sampled;
    normalizedVideos = sortDouyinFollowVideos(
      toArray(sampled?.posts).map((video) => normalizeObservedVideo({
        ...video,
        authorName: sampled?.authorName || user?.name,
        authorUrl: sampled?.authorUrl || user?.url,
        userId: sampled?.userId || user?.userId,
        source: video?.source || 'dom-fallback',
      }, user, options)),
    );
    if (normalizedVideos.length === previousCount) {
      stableRounds += 1;
    } else {
      previousCount = normalizedVideos.length;
      stableRounds = 0;
    }
    olderStreak = normalizedVideos
      .slice(0, 8)
      .filter((video) => video?.publishedAt && !matchesWindow(video, window))
      .length;
    if (sampled?.terminalReached === true || stableRounds >= 3 || olderStreak >= 6) {
      break;
    }
    await scrollDouyinPage(session);
  }
  const html = await session.captureHtml();
  const createTimeMap = parseDouyinCreateTimeMapFromHtml(
    html,
    normalizedVideos.map((video) => video?.videoId).filter(Boolean),
  );
  normalizedVideos = normalizedVideos.map((video) => normalizeObservedVideo({
    ...video,
    createTime: createTimeMap.get(String(video?.videoId ?? '')) ?? video?.createTime ?? null,
  }, user, options));

  const fallbackCandidates = normalizedVideos
    .filter((video) => shouldResolveDetailTimestamp(video, window))
    .slice(0, DETAIL_FALLBACK_LIMIT);
  for (const candidate of fallbackCandidates) {
    try {
      const precise = await resolveDouyinDetailTimestamp(
        session,
        candidate.url,
        candidate.videoId,
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      if (precise?.publishedAt) {
        normalizedVideos = normalizedVideos.map((video) => (
          video.videoId === candidate.videoId
            ? { ...video, ...precise }
            : video
        ));
      }
    } catch {
      // Keep less precise timing if the detail fallback fails.
    }
  }

  const nextCache = updateDouyinUserVideoCache(cache, {
    ...user,
    name: observed?.authorName || user?.name,
    url: observed?.authorUrl || user?.url,
    userId: observed?.userId || user?.userId,
  }, normalizedVideos, options);

  return {
    user: {
      ...user,
      name: observed?.authorName || user?.name,
      url: observed?.authorUrl || user?.url,
      userId: observed?.userId || user?.userId,
    },
    videos: sortDouyinFollowVideos(normalizedVideos.filter((video) => matchesWindow(video, window))),
    cache: nextCache,
    cacheHit: false,
    error: null,
  };
}

function buildFollowUsersResult(users, partial = false, errors = [], totalFollowedUsers = users.length) {
  return {
    queryType: 'list-followed-users',
    window: null,
    totalFollowedUsers,
    scannedUsers: users.length,
    matchedUsers: users.length,
    matchedVideos: 0,
    partial,
    errors,
    users: sortDouyinFollowUsers(users),
    groups: [],
    videos: [],
  };
}

function buildFollowUpdatesResult(window, users, groups, videos, partial = false, errors = [], scannedUsers = users.length, totalFollowedUsers = users.length) {
  return {
    queryType: 'list-followed-updates',
    window,
    totalFollowedUsers,
    scannedUsers,
    matchedUsers: groups.length,
    matchedVideos: videos.length,
    partial,
    errors,
    users: sortDouyinFollowUsers(users),
    groups: groups
      .map((group) => ({
        authorName: group.authorName,
        authorUrl: group.authorUrl,
        userId: group.userId,
        videos: sortDouyinFollowVideos(group.videos),
      }))
      .sort((left, right) => String(left.authorName ?? '').localeCompare(String(right.authorName ?? ''), 'zh-Hans-CN')),
    videos: sortDouyinFollowVideos(videos),
  };
}

function buildPrewarmFollowCacheResult(users, summary = {}, partial = false, errors = []) {
  return {
    queryType: 'prewarm-follow-cache',
    window: null,
    totalFollowedUsers: users.length,
    scannedUsers: Number(summary.scannedUsers ?? 0),
    matchedUsers: 0,
    matchedVideos: Number(summary.refreshedVideos ?? 0),
    partial,
    errors,
    users: sortDouyinFollowUsers(users),
    groups: [],
    videos: [],
    prewarm: {
      followIndexRefreshed: summary.followIndexRefreshed === true,
      activeUsersRefreshed: Number(summary.activeUsersRefreshed ?? 0),
      refreshedVideos: Number(summary.refreshedVideos ?? 0),
      refreshedUserIds: normalizeStringList(summary.refreshedUserIds),
      reason: normalizeText(summary.reason) || null,
      nextSuggestedFollowSyncAt: normalizeText(summary.nextSuggestedFollowSyncAt) || null,
      nextSuggestedActiveUsersWarmupAt: normalizeText(summary.nextSuggestedActiveUsersWarmupAt) || null,
    },
  };
}

function deriveAuthMissingResult(intent, window) {
  return {
    queryType: intent,
    window: intent === 'list-followed-updates' ? window : null,
    totalFollowedUsers: 0,
    scannedUsers: 0,
    matchedUsers: 0,
    matchedVideos: 0,
    partial: true,
    errors: [
      {
        reason: 'not-authenticated',
        message: 'Douyin authenticated follow queries require a reusable local logged-in profile.',
      },
    ],
    users: [],
    groups: [],
    videos: [],
  };
}

async function openDouyinWorkerSession(inputUrl, authContext, settings, deps = {}) {
  const workerSession = await (deps.openBrowserSession ?? openBrowserSession)({
    ...settings,
    userDataDir: authContext.userDataDir,
    cleanupUserDataDirOnShutdown: authContext.cleanupUserDataDirOnShutdown,
    startupUrl: resolveAuthKeepaliveUrl(inputUrl, null, authContext.authConfig) ?? inputUrl,
  });
  await navigateDouyinPage(
    workerSession,
    resolveAuthKeepaliveUrl(inputUrl, null, authContext.authConfig) ?? inputUrl,
    settings.timeoutMs,
  );
  return workerSession;
}

async function openDouyinWorkerPool(baseSession, inputUrl, authContext, settings, desiredCount, deps = {}) {
  const workers = [{ session: baseSession, reusable: false }];
  const targetCount = Math.max(1, Math.min(
    normalizePositiveInteger(desiredCount, 1) ?? 1,
    normalizePositiveInteger(settings.scanConcurrency, DEFAULT_SCAN_CONCURRENCY) ?? DEFAULT_SCAN_CONCURRENCY,
  ));
  for (let index = 1; index < targetCount; index += 1) {
    try {
      const session = await openDouyinWorkerSession(inputUrl, authContext, settings, deps);
      workers.push({ session, reusable: true });
    } catch {
      break;
    }
  }
  return workers;
}

async function closeDouyinWorkerPool(workers = []) {
  for (const worker of workers.slice(1)) {
    try {
      await worker?.session?.close?.();
    } catch {
      // Best effort only.
    }
  }
}

async function reopenDouyinWorker(worker, inputUrl, authContext, settings, deps = {}) {
  if (!worker?.reusable) {
    return worker;
  }
  try {
    await worker.session?.close?.();
  } catch {
    // Best effort only.
  }
  worker.session = await openDouyinWorkerSession(inputUrl, authContext, settings, deps);
  return worker;
}

function mergeOptions(inputUrl, options = {}) {
  const merged = { ...DEFAULT_OPTIONS, ...options };
  merged.profilePath = merged.profilePath
    ? path.resolve(merged.profilePath)
    : resolveProfilePathForUrl(inputUrl, { profilesDir: path.resolve(process.cwd(), 'profiles') });
  merged.timeoutMs = Number.isFinite(Number(merged.timeoutMs)) ? Number(merged.timeoutMs) : DEFAULT_TIMEOUT_MS;
  merged.headless = typeof merged.headless === 'boolean'
    ? merged.headless
    : resolveDouyinHeadlessDefault(inputUrl, false, null);
  merged.intent = normalizeText(merged.intent) || DEFAULT_OPTIONS.intent;
  merged.timeWindow = normalizeWindowLabel(merged.timeWindow);
  merged.output = normalizeText(merged.output) || DEFAULT_OPTIONS.output;
  merged.format = normalizeText(merged.format) || DEFAULT_OPTIONS.format;
  merged.userFilter = normalizeStringList(merged.userFilter);
  merged.titleKeyword = normalizeStringList(merged.titleKeyword);
  merged.limit = normalizePositiveInteger(merged.limit, null);
  merged.updatedOnly = merged.updatedOnly === true;
  merged.checkpointEveryUsers = normalizePositiveInteger(merged.checkpointEveryUsers, DEFAULT_OPTIONS.checkpointEveryUsers);
  merged.scanConcurrency = normalizePositiveInteger(merged.scanConcurrency, DEFAULT_OPTIONS.scanConcurrency);
  merged.recentActiveDays = normalizePositiveInteger(merged.recentActiveDays, DEFAULT_OPTIONS.recentActiveDays);
  merged.recentActiveUsersLimit = normalizePositiveInteger(merged.recentActiveUsersLimit, DEFAULT_OPTIONS.recentActiveUsersLimit);
  merged.forceRefreshFollowIndex = merged.forceRefreshFollowIndex === true;
  merged.forceRefreshUserCache = merged.forceRefreshUserCache === true;
  merged.sessionLeaseWaitMs = normalizePositiveInteger(merged.sessionLeaseWaitMs, DEFAULT_OPTIONS.sessionLeaseWaitMs);
  merged.sessionLeasePollIntervalMs = normalizePositiveInteger(merged.sessionLeasePollIntervalMs, DEFAULT_OPTIONS.sessionLeasePollIntervalMs);
  merged.sessionOpenRetries = normalizePositiveInteger(merged.sessionOpenRetries, DEFAULT_OPTIONS.sessionOpenRetries);
  merged.userScanRetries = normalizePositiveInteger(merged.userScanRetries, DEFAULT_OPTIONS.userScanRetries);
  merged.workspaceRoot = path.resolve(merged.workspaceRoot ?? process.cwd());
  merged.viewport = {
    ...DEFAULT_OPTIONS.viewport,
    ...(merged.viewport ?? {}),
  };
  return merged;
}

async function queryDouyinFollowOnce(inputUrl, options = {}, deps = {}) {
  const settings = mergeOptions(inputUrl, options);
  const authProfile = await (deps.resolveSiteAuthProfile ?? resolveSiteAuthProfile)(inputUrl, {
    profilePath: settings.profilePath,
  });
  const authContext = await (deps.resolveSiteBrowserSessionOptions ?? resolveSiteBrowserSessionOptions)(inputUrl, settings, {
    profilePath: settings.profilePath,
    authProfile,
  });
  const governance = await (deps.prepareSiteSessionGovernance ?? prepareSiteSessionGovernance)(
    inputUrl,
    authContext,
    settings,
    {
      operation: 'query-douyin-follow',
      networkOptions: {
        disableExternalLookup: true,
      },
    },
  );
  if (!governance.policyDecision.allowed) {
    const blockedError = new Error(`Douyin follow query blocked by runtime governance: ${governance.policyDecision.riskCauseCode ?? 'unknown-risk'}.`);
    blockedError.code = governance.policyDecision.riskCauseCode ?? 'DOUYIN_QUERY_BLOCKED';
    if (governance.lease) {
      await (deps.releaseSessionLease ?? releaseSessionLease)(governance.lease);
    }
    throw blockedError;
  }

  let governanceFinalized = false;
  let session = null;
  try {
    session = await (deps.openBrowserSession ?? openBrowserSession)({
      ...settings,
      userDataDir: authContext.userDataDir,
      cleanupUserDataDirOnShutdown: authContext.cleanupUserDataDirOnShutdown,
      startupUrl: resolveAuthKeepaliveUrl(inputUrl, authProfile, authContext.authConfig) ?? inputUrl,
    });

    const authResult = await (deps.ensureAuthenticatedSession ?? ensureAuthenticatedSession)(session, inputUrl, settings, {
      authContext,
    });
    const authenticated = ['already-authenticated', 'authenticated'].includes(String(authResult?.status ?? ''))
      && (authResult?.loginState?.identityConfirmed === true || authResult?.loginState?.loginStateDetected === true || authResult?.loginState?.loggedIn === true);
    const requestedWindow = settings.intent === 'list-followed-updates'
      ? normalizeDouyinTimeWindow(settings.timeWindow, { now: options.now })
      : null;

    if (!authenticated) {
      const result = deriveAuthMissingResult(settings.intent, requestedWindow);
      const governanceSummary = await (deps.finalizeSiteSessionGovernance ?? finalizeSiteSessionGovernance)(governance, {
        antiCrawlSignals: [],
        authRequired: true,
        authAvailable: false,
        loginStateDetected: authResult?.loginState?.loginStateDetected === true || authResult?.loginState?.loggedIn === true,
        identityConfirmed: authResult?.loginState?.identityConfirmed === true,
        note: authResult?.status ?? 'unauthenticated',
      });
      governanceFinalized = true;
      return {
        site: {
          url: inputUrl,
          host: authProfile?.profile?.host ?? null,
        },
        auth: {
          status: authResult?.status ?? 'unauthenticated',
          verificationUrl: resolveAuthKeepaliveUrl(inputUrl, authProfile, authContext.authConfig) ?? null,
          userDataDir: authContext.userDataDir ?? null,
        },
        runtimeGovernance: governanceSummary,
        result,
      };
    }

    await navigateDouyinPage(
      session,
      resolveAuthKeepaliveUrl(inputUrl, authProfile, authContext.authConfig) ?? inputUrl,
      settings.timeoutMs,
    );

    const now = toDate(options.now) ?? new Date();
    const window = requestedWindow ?? null;
    let cache = await readDouyinFollowCache(authContext.userDataDir);
    const followUsers = await collectFollowUsersWithCache(session, authContext, cache, {
      ...settings,
      now,
    });
    cache = followUsers.cache;
    const allFollowUsers = sortDouyinFollowUsers(followUsers.users);
    const targetUsers = filterDouyinFollowUsers(allFollowUsers, settings.userFilter);
    /** @type {Array<{reason: string, userId?: string|null, authorName?: string|null, url?: string|null, message?: string|null}>} */
    const errors = [];
    let partial = followUsers.partial === true;

    let result;
    if (settings.intent === 'list-followed-users') {
      result = buildFollowUsersResult(targetUsers, partial, errors, allFollowUsers.length);
    } else if (settings.intent === 'prewarm-follow-cache') {
      const prewarmWindowStart = startOfShanghaiDay(new Date(now.getTime() - Math.max(1, settings.recentActiveDays) * DAY_MS)) ?? now;
      const prewarmWindow = {
        input: `recent-${settings.recentActiveDays}`,
        label: `recent-${settings.recentActiveDays}`,
        timezone: DEFAULT_DOUYIN_TIMEZONE,
        startAt: prewarmWindowStart.toISOString(),
        endAt: now.toISOString(),
        startDayKey: formatShanghaiDayKey(prewarmWindowStart),
        endDayKey: formatShanghaiDayKey(now),
        includesToday: true,
        dayKeys: buildDayKeys(prewarmWindowStart, now),
      };
      const activeSeedUsers = selectRecentActiveUsersFromCache(cache, { ...settings, now });
      const prewarmTargets = filterDouyinFollowUsers(
        activeSeedUsers.length ? activeSeedUsers : allFollowUsers,
        settings.userFilter,
      ).slice(0, settings.recentActiveUsersLimit);
      let refreshedVideos = 0;
      let activeUsersRefreshed = 0;
      const prewarmWorkers = await openDouyinWorkerPool(
        session,
        inputUrl,
        authContext,
        settings,
        Math.min(prewarmTargets.length, settings.scanConcurrency),
        deps,
      );
      try {
        let nextPrewarmIndex = 0;
        await Promise.all(prewarmWorkers.map(async (worker) => {
          while (nextPrewarmIndex < prewarmTargets.length) {
            const currentIndex = nextPrewarmIndex;
            nextPrewarmIndex += 1;
            const user = prewarmTargets[currentIndex];
            let collected = await collectUserUpdatesWithRetry(worker.session, user, prewarmWindow, cache, {
              ...settings,
              now,
              forceRefreshUserCache: true,
            });
            if (collected.error && isTransientFollowQueryError(collected.error) && worker.reusable) {
              worker = await reopenDouyinWorker(worker, inputUrl, authContext, settings, deps);
              collected = await collectUserUpdatesWithRetry(worker.session, user, prewarmWindow, cache, {
                ...settings,
                now,
                forceRefreshUserCache: true,
              });
            }
            const mergedEntry = collected?.cache?.users?.[String(user?.userId ?? '')];
            if (mergedEntry) {
              cache = mergeDouyinUserCacheEntry(cache, user?.userId, mergedEntry, { now });
            } else if (!user?.userId) {
              cache = collected.cache;
            }
            if (collected.error) {
              partial = true;
              errors.push({
                reason: collected.error,
                userId: user.userId ?? null,
                authorName: user.name ?? null,
                url: user.url ?? null,
                message: `Failed to prewarm ${user.name ?? user.userId ?? 'user'}: ${collected.error}.`,
              });
              continue;
            }
            activeUsersRefreshed += 1;
            refreshedVideos += toArray(collected.videos).length;
          }
        }));
      } finally {
        await closeDouyinWorkerPool(prewarmWorkers);
      }
      cache = updateDouyinPrewarmState(cache, {
        followIndexRefreshed: followUsers.cacheHit !== true || settings.forceRefreshFollowIndex === true,
        activeUsersRefreshed,
        refreshedVideos,
        refreshedUserIds: prewarmTargets.map((user) => user.userId).filter(Boolean),
        reason: followUsers.cacheHit === true ? 'active-users-prewarm' : 'follow-index-refresh-and-active-users-prewarm',
      }, { now });
      result = buildPrewarmFollowCacheResult(allFollowUsers, {
        followIndexRefreshed: followUsers.cacheHit !== true || settings.forceRefreshFollowIndex === true,
        activeUsersRefreshed,
        refreshedVideos,
        refreshedUserIds: prewarmTargets.map((user) => user.userId).filter(Boolean),
        reason: followUsers.cacheHit === true ? 'active-users-prewarm' : 'follow-index-refresh-and-active-users-prewarm',
        nextSuggestedFollowSyncAt: cache?.prewarm?.nextSuggestedFollowSyncAt ?? null,
        nextSuggestedActiveUsersWarmupAt: cache?.prewarm?.nextSuggestedActiveUsersWarmupAt ?? null,
      }, partial, errors);
    } else {
      const flatVideos = [];
      const resumeState = resolveDouyinFollowResumeState(cache, settings.intent, window, targetUsers, settings);
      let scannedUsers = resumeState.resumeIndex;
      const pendingUsers = resumeState.resumed ? targetUsers.slice(resumeState.resumeIndex) : targetUsers;
      const completedIndexes = new Set();
      let contiguousCompletedUsers = resumeState.resumeIndex;
      const workers = await openDouyinWorkerPool(
        session,
        inputUrl,
        authContext,
        settings,
        Math.min(pendingUsers.length || 1, settings.scanConcurrency),
        deps,
      );
      try {
        let nextPendingIndex = 0;
        await Promise.all(workers.map(async (worker) => {
          while (nextPendingIndex < pendingUsers.length) {
            const pendingIndex = nextPendingIndex;
            nextPendingIndex += 1;
            const absoluteIndex = resumeState.resumeIndex + pendingIndex;
            const user = pendingUsers[pendingIndex];
            let collected = await collectUserUpdatesWithRetry(worker.session, user, window, cache, {
              ...settings,
              now,
            });
            if (collected.error && isTransientFollowQueryError(collected.error) && worker.reusable) {
              worker = await reopenDouyinWorker(worker, inputUrl, authContext, settings, deps);
              collected = await collectUserUpdatesWithRetry(worker.session, user, window, cache, {
                ...settings,
                now,
              });
            }

            scannedUsers += 1;
            const mergedEntry = collected?.cache?.users?.[String(user?.userId ?? '')];
            if (mergedEntry) {
              cache = mergeDouyinUserCacheEntry(cache, user?.userId, mergedEntry, { now });
            } else if (!user?.userId) {
              cache = collected.cache;
            }
            completedIndexes.add(absoluteIndex);
            while (completedIndexes.has(contiguousCompletedUsers)) {
              completedIndexes.delete(contiguousCompletedUsers);
              contiguousCompletedUsers += 1;
            }
            cache = updateDouyinFollowQueryCheckpoint(
              cache,
              settings.intent,
              window,
              contiguousCompletedUsers > 0 ? targetUsers[contiguousCompletedUsers - 1]?.userId ?? null : null,
              contiguousCompletedUsers,
              targetUsers.length,
              { now },
            );
            if (
              authContext.userDataDir
              && (
                scannedUsers % settings.checkpointEveryUsers === 0
                || contiguousCompletedUsers === targetUsers.length
              )
            ) {
              await writeDouyinFollowCache(authContext.userDataDir, cache);
            }
            if (collected.error) {
              partial = true;
              errors.push({
                reason: collected.error,
                userId: user.userId ?? null,
                authorName: user.name ?? null,
                url: user.url ?? null,
                message: `Failed to scan ${user.name ?? user.userId ?? 'user'}: ${collected.error}.`,
              });
              continue;
            }
            const filteredVideos = filterDouyinVideosByTitle(collected.videos, settings.titleKeyword);
            if (filteredVideos.length > 0) {
              flatVideos.push(...filteredVideos);
            }
          }
        }));
      } finally {
        await closeDouyinWorkerPool(workers);
      }
      let finalVideos = sortDouyinFollowVideos(flatVideos);
      if (Number.isFinite(settings.limit) && settings.limit > 0) {
        finalVideos = finalVideos.slice(0, settings.limit);
      }
      const finalGroups = rebuildVideoGroupsFromFlatVideos(finalVideos);
      const resultUsers = settings.updatedOnly === true
        ? finalGroups.map((group) => normalizeDouyinFollowUser({
          name: group.authorName,
          url: group.authorUrl,
          userId: group.userId,
        })).filter(Boolean)
        : targetUsers;
      result = buildFollowUpdatesResult(window, resultUsers, finalGroups, finalVideos, partial, errors, scannedUsers, allFollowUsers.length);
    }

    await writeDouyinFollowCache(authContext.userDataDir, cache);
    const governanceSummary = await (deps.finalizeSiteSessionGovernance ?? finalizeSiteSessionGovernance)(governance, {
      antiCrawlSignals: [],
      authRequired: true,
      authAvailable: true,
      loginStateDetected: true,
      identityConfirmed: true,
      persistedHealthySession: true,
      note: settings.intent,
    });
    governanceFinalized = true;

    return {
      site: {
        url: inputUrl,
        host: authProfile?.profile?.host ?? null,
      },
      auth: {
        status: authResult?.status ?? 'authenticated',
        verificationUrl: resolveAuthKeepaliveUrl(inputUrl, authProfile, authContext.authConfig) ?? null,
        userDataDir: authContext.userDataDir ?? null,
      },
      cache: {
        path: resolveDouyinFollowCachePath(authContext.userDataDir),
        followIndexFresh: isDouyinFollowIndexFresh(cache, { now: options.now }),
        queryState: cache?.queryState ?? null,
        prewarm: cache?.prewarm ?? null,
      },
      runtimeGovernance: governanceSummary,
      result,
    };
  } finally {
    await session?.close?.();
    if (!governanceFinalized && governance?.lease) {
      await (deps.releaseSessionLease ?? releaseSessionLease)(governance.lease);
    }
  }
}

export async function queryDouyinFollow(inputUrl, options = {}, deps = {}) {
  let lastError = null;
  const maxAttempts = 2;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await queryDouyinFollowOnce(inputUrl, options, deps);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts - 1 || !isTransientFollowQueryError(error)) {
        throw error;
      }
    }
  }
  throw lastError ?? new Error('Douyin follow query failed');
}

export function parseDouyinFollowQueryArgs(argv) {
  const args = [...argv];
  const positionals = [];
  const flags = {};
  const appendFlag = (key, value) => {
    if (!(key in flags)) {
      flags[key] = value;
      return;
    }
    if (Array.isArray(flags[key])) {
      flags[key].push(value);
      return;
    }
    flags[key] = [flags[key], value];
  };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const [key, inlineValue] = token.split('=', 2);
    const normalizedKey = key.replace(/^--/, '');
    if (inlineValue !== undefined) {
      appendFlag(normalizedKey, inlineValue);
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      appendFlag(normalizedKey, next);
      index += 1;
    } else {
      appendFlag(normalizedKey, true);
    }
  }

  return {
    inputUrl: positionals[0] ?? 'https://www.douyin.com/?recommend=1',
    options: {
      intent: flags.intent ? String(flags.intent) : DEFAULT_OPTIONS.intent,
      timeWindow: flags.window ? String(flags.window) : DEFAULT_OPTIONS.timeWindow,
      profilePath: flags['profile-path'] ? String(flags['profile-path']) : null,
      browserPath: flags['browser-path'] ? String(flags['browser-path']) : undefined,
      browserProfileRoot: flags['browser-profile-root'] ? String(flags['browser-profile-root']) : undefined,
      userDataDir: flags['user-data-dir'] ? String(flags['user-data-dir']) : undefined,
      timeoutMs: flags.timeout ? Number(flags.timeout) : DEFAULT_TIMEOUT_MS,
      headless: flags.headless === true ? true : flags['no-headless'] === true ? false : undefined,
      reuseLoginState: flags['no-reuse-login-state'] === true ? false : true,
      autoLogin: flags['no-auto-login'] === true ? false : true,
      output: flags.output ? String(flags.output) : DEFAULT_OPTIONS.output,
      format: flags.format ? String(flags.format) : DEFAULT_OPTIONS.format,
      userFilter: normalizeStringList(flags.user ?? flags.author ?? flags['user-filter'] ?? []),
      titleKeyword: normalizeStringList(flags.keyword ?? flags['title-keyword'] ?? []),
      limit: flags.limit ? Number(flags.limit) : null,
      updatedOnly: flags['updated-only'] === true || flags['only-updated-users'] === true,
      checkpointEveryUsers: flags['checkpoint-every-users'] ? Number(flags['checkpoint-every-users']) : DEFAULT_OPTIONS.checkpointEveryUsers,
      scanConcurrency: flags['scan-concurrency'] ? Number(flags['scan-concurrency']) : DEFAULT_OPTIONS.scanConcurrency,
      recentActiveDays: flags['recent-active-days'] ? Number(flags['recent-active-days']) : DEFAULT_OPTIONS.recentActiveDays,
      recentActiveUsersLimit: flags['recent-active-users-limit'] ? Number(flags['recent-active-users-limit']) : DEFAULT_OPTIONS.recentActiveUsersLimit,
      forceRefreshFollowIndex: flags['refresh-follow-index'] === true,
      forceRefreshUserCache: flags['refresh-user-cache'] === true,
      sessionLeaseWaitMs: flags['session-lease-wait-ms'] ? Number(flags['session-lease-wait-ms']) : DEFAULT_OPTIONS.sessionLeaseWaitMs,
      sessionLeasePollIntervalMs: flags['session-lease-poll-interval-ms'] ? Number(flags['session-lease-poll-interval-ms']) : DEFAULT_OPTIONS.sessionLeasePollIntervalMs,
      sessionOpenRetries: flags['session-open-retries'] ? Number(flags['session-open-retries']) : DEFAULT_OPTIONS.sessionOpenRetries,
      userScanRetries: flags['user-scan-retries'] ? Number(flags['user-scan-retries']) : DEFAULT_OPTIONS.userScanRetries,
      workspaceRoot: flags['workspace-root'] ? String(flags['workspace-root']) : process.cwd(),
    },
  };
}

export async function runDouyinFollowQueryCli(argv = process.argv.slice(2)) {
  initializeCliUtf8();
  const parsed = parseDouyinFollowQueryArgs(argv);
  const report = await queryDouyinFollow(parsed.inputUrl, parsed.options);
  const projectedResult = projectDouyinFollowResult(report?.result ?? {}, parsed.options.output);
  if ((normalizeText(parsed.options.format) || 'json') === 'markdown') {
    process.stdout.write(renderDouyinFollowResultMarkdown(report, projectedResult));
  } else {
    writeJsonStdout({
      ...report,
      result: projectedResult,
    });
  }
  if (report?.result?.partial === true) {
    process.exitCode = 1;
  }
}
