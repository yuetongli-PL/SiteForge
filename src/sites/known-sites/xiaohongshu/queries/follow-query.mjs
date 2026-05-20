// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { openBrowserSession } from '../../../../infra/browser/session.mjs';
import { initializeCliUtf8, writeJsonStdout } from '../../../../infra/cli.mjs';
import {
  ensureAuthenticatedSession,
  resolveSiteAuthProfile,
  resolveSiteBrowserSessionOptions,
} from '../../../../infra/auth/site-auth.mjs';
import {
  finalizeSiteSessionGovernance,
  prepareSiteSessionGovernance,
  releaseSessionLease,
} from '../../../../infra/auth/site-session-governance.mjs';
import { cleanText } from '../../../../shared/normalize.mjs';
import { normalizeRiskTransition } from '../../../../domain/risks/risk-state.mjs';
import { resolveProfilePathForUrl } from '../../../registry/core/profiles.mjs';

const DEFAULT_INPUT_URL = 'https://www.xiaohongshu.com/notification';
const DEFAULT_TIMEOUT_MS = 30_000;

const MODULE_DIR = import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..', '..');

const HELP = `Internal script usage:
  node src/sites/known-sites/xiaohongshu/queries/follow-query.mjs [url] [options]

Public command:
  siteforge build <url>

Notes:
  - The default URL is ${DEFAULT_INPUT_URL}
  - This command only performs authenticated read-only queries.
  - If Xiaohongshu returns a guest session or captcha-gated self profile, the report will say so explicitly.
`;

function createWaitPolicy(timeoutMs = DEFAULT_TIMEOUT_MS) {
  return {
    useLoadEvent: false,
    useNetworkIdle: false,
    documentReadyTimeoutMs: timeoutMs,
    domQuietTimeoutMs: timeoutMs,
    domQuietMs: 400,
    idleMs: 250,
  };
}

function normalizeText(value) {
  return cleanText(String(value ?? '').replace(/\s+/gu, ' '));
}

function normalizeBoolean(value, flagName) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  throw new Error(`Invalid boolean for ${flagName}: ${value}`);
}

function normalizeNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid number for ${flagName}: ${value}`);
  }
  return parsed;
}

function normalizePositiveInteger(value, flagName, fallback = null) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = normalizeNumber(value, flagName);
  if (parsed < 1) {
    throw new Error(`Invalid positive integer for ${flagName}: ${value}`);
  }
  return Math.trunc(parsed);
}

function runtimeRiskForFollowQueryResult(result, settings) {
  if (result?.status !== 'captcha-gated' || result?.captchaDetected !== true) {
    return null;
  }
  return normalizeRiskTransition({
    from: 'normal',
    state: 'captcha_required',
    reasonCode: result.reasonCode,
    siteKey: 'xiaohongshu',
    taskId: `xiaohongshu-follow-query:${settings.intent}`,
    scope: 'profile',
  });
}

function normalizeHost(inputUrl) {
  return new URL(String(inputUrl)).hostname;
}

function normalizeNodeUser(user = {}) {
  const rawUser = user && typeof user === 'object' ? user : {};
  const compositeUserId = normalizeText(rawUser.userid || rawUser.userid_str || '');
  const userId = normalizeText(rawUser.userId || rawUser.user_id || rawUser.rid || rawUser.id || (compositeUserId ? compositeUserId.split('_')[0] : ''));
  const url = normalizeText(
    rawUser.url
    || rawUser.userPageUrl
    || rawUser.profileUrl
    || (userId ? `https://www.xiaohongshu.com/user/profile/${userId}` : ''),
  );
  return {
    name: normalizeText(rawUser.name || rawUser.nickname || rawUser.user_name || rawUser.username) || userId || url || null,
    userId: userId || null,
    redId: normalizeText(rawUser.redId || rawUser.red_id) || null,
    url: url || null,
    source: normalizeText(rawUser.source) || null,
  };
}

function extractXiaohongshuNoteId(value) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return null;
  }
  const directMatch = normalizedValue.match(/^([0-9a-z]{6,})$/iu);
  if (directMatch?.[1]) {
    return normalizeText(directMatch[1]) || null;
  }
  try {
    const parsed = new URL(normalizedValue, 'https://www.xiaohongshu.com/');
    const matched = parsed.pathname.match(/^\/explore\/([^/?#]+)/iu);
    return normalizeText(matched?.[1]) || null;
  } catch {
    return null;
  }
}

function normalizeNodeNote(note = {}, fallbackAuthor = {}) {
  const rawNote = note && typeof note === 'object' ? note : {};
  const rawAuthor = fallbackAuthor && typeof fallbackAuthor === 'object' ? fallbackAuthor : {};
  const noteId = normalizeText(
    rawNote.noteId
    || rawNote.id
    || rawNote.note_id
    || extractXiaohongshuNoteId(rawNote.url)
    || extractXiaohongshuNoteId(rawNote.navigationUrl)
    || '',
  ) || null;
  const canonicalUrl = noteId ? `https://www.xiaohongshu.com/explore/${noteId}` : null;
  const navigationUrl = normalizeText(rawNote.navigationUrl || rawNote.url || canonicalUrl || '') || null;
  const url = canonicalUrl || navigationUrl;
  const publishedAt = normalizeText(rawNote.publishedAt) || null;
  const imageCountValue = Number(
    rawNote.imageCount
    ?? rawNote.imagesCount
    ?? rawNote.imgCount
    ?? rawNote.photoCount
    ?? (Array.isArray(rawNote.imageList) ? rawNote.imageList.length : null)
    ?? (Array.isArray(rawNote.images) ? rawNote.images.length : null)
    ?? 0,
  );
  return {
    title: normalizeText(rawNote.title || rawNote.displayTitle || rawNote.noteTitle || rawNote.desc) || null,
    excerpt: normalizeText(rawNote.excerpt || rawNote.desc || rawNote.summary || rawNote.content) || null,
    noteId,
    url,
    navigationUrl,
    xsecToken: normalizeText(rawNote.xsecToken || rawNote.xsec_token) || null,
    xsecSource: normalizeText(rawNote.xsecSource || rawNote.xsec_source) || null,
    contentType: normalizeText(rawNote.contentType || rawNote.type || rawNote.noteType || rawNote.cardType) || null,
    imageCount: Number.isFinite(imageCountValue) && imageCountValue > 0 ? Math.trunc(imageCountValue) : 0,
    publishedAt,
    publishedDateLocal: normalizeText(rawNote.publishedDateLocal) || publishedAt || null,
    publishedTimeText: normalizeText(rawNote.publishedTimeText || rawNote.timeText || rawNote.publishText) || null,
    tagNames: Array.isArray(rawNote.tagNames)
      ? rawNote.tagNames.map((value) => normalizeText(value)).filter(Boolean)
      : [],
    authorName: normalizeText(rawNote.authorName || rawAuthor.name || rawAuthor.authorName) || null,
    authorUserId: normalizeText(rawNote.authorUserId || rawNote.userId || rawAuthor.userId || rawAuthor.authorUserId) || null,
    authorUrl: normalizeText(rawNote.authorUrl || rawAuthor.url || rawAuthor.authorUrl) || null,
  };
}

function dedupeNotes(notes = []) {
  const seen = new Set();
  const ordered = [];
  for (const rawNote of Array.isArray(notes) ? notes : []) {
    if (!rawNote || typeof rawNote !== 'object') {
      continue;
    }
    const note = normalizeNodeNote(rawNote, rawNote);
    const key = note.noteId || note.url || `${note.title || ''}::${note.authorUserId || note.authorUrl || ''}`;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    ordered.push(note);
  }
  return ordered.sort((left, right) => (
    String(right.publishedAt || right.publishedDateLocal || '').localeCompare(String(left.publishedAt || left.publishedDateLocal || ''))
    || String(left.authorName || '').localeCompare(String(right.authorName || ''), 'zh-Hans-CN')
    || String(left.title || '').localeCompare(String(right.title || ''), 'zh-Hans-CN')
  ));
}

function dedupeUsers(users = []) {
  const seen = new Set();
  const ordered = [];
  for (const rawUser of Array.isArray(users) ? users : []) {
    if (!rawUser || typeof rawUser !== 'object') {
      continue;
    }
    const user = normalizeNodeUser(rawUser);
    const key = user.userId || user.url || user.name;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    ordered.push(user);
  }
  return ordered.sort((left, right) => (left.name || '').localeCompare(right.name || '', 'zh-Hans-CN'));
}

function mergeOptions(inputUrl, options = {}) {
  const merged = {
    intent: 'list-followed-users',
    format: 'json',
    profilePath: null,
    browserPath: undefined,
    browserProfileRoot: undefined,
    userDataDir: undefined,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    limit: undefined,
    perUserLimit: undefined,
    headless: false,
    autoLogin: false,
    reuseLoginState: true,
    ...options,
  };

  merged.inputUrl = String(inputUrl || DEFAULT_INPUT_URL).trim() || DEFAULT_INPUT_URL;
  merged.intent = normalizeText(merged.intent) || 'list-followed-users';
  if (!['list-followed-users', 'list-followed-updates'].includes(merged.intent)) {
    throw new Error(`Unsupported Xiaohongshu follow intent: ${merged.intent}`);
  }
  merged.format = normalizeText(merged.format).toLowerCase() || 'json';
  if (!['json', 'markdown'].includes(merged.format)) {
    throw new Error(`Unsupported output format: ${merged.format}`);
  }
  merged.timeoutMs = normalizeNumber(merged.timeoutMs, 'timeoutMs');
  merged.limit = normalizePositiveInteger(merged.limit, 'limit');
  merged.perUserLimit = normalizePositiveInteger(
    merged.perUserLimit,
    'perUserLimit',
    merged.intent === 'list-followed-updates' ? 3 : null,
  );
  merged.headless = normalizeBoolean(merged.headless, 'headless');
  merged.autoLogin = normalizeBoolean(merged.autoLogin, 'autoLogin');
  merged.reuseLoginState = normalizeBoolean(merged.reuseLoginState, 'reuseLoginState');
  merged.profilePath = merged.profilePath
    ? path.resolve(merged.profilePath)
    : resolveProfilePathForUrl(merged.inputUrl, {
      profilesDir: path.join(REPO_ROOT, 'profiles'),
    });
  merged.browserProfileRoot = merged.browserProfileRoot ? path.resolve(merged.browserProfileRoot) : undefined;
  merged.userDataDir = merged.userDataDir ? path.resolve(merged.userDataDir) : undefined;
  return merged;
}

export function parseXiaohongshuFollowQueryArgs(argv = []) {
  const args = [...argv];
  if (!args.length || args[0] === '--help' || args[0] === '-h') {
    return { help: true, inputUrl: DEFAULT_INPUT_URL, options: {} };
  }

  const positionals = [];
  const options = {};
  const readValue = (index) => {
    if (index + 1 >= args.length) {
      throw new Error(`Missing value for ${args[index]}`);
    }
    return { value: args[index + 1], nextIndex: index + 1 };
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    switch (token) {
      case '--intent': {
        const { value, nextIndex } = readValue(index);
        options.intent = value;
        index = nextIndex;
        break;
      }
      case '--format': {
        const { value, nextIndex } = readValue(index);
        options.format = value;
        index = nextIndex;
        break;
      }
      case '--profile-path': {
        const { value, nextIndex } = readValue(index);
        options.profilePath = value;
        index = nextIndex;
        break;
      }
      case '--browser-path': {
        const { value, nextIndex } = readValue(index);
        options.browserPath = value;
        index = nextIndex;
        break;
      }
      case '--browser-profile-root': {
        const { value, nextIndex } = readValue(index);
        options.browserProfileRoot = value;
        index = nextIndex;
        break;
      }
      case '--user-data-dir': {
        const { value, nextIndex } = readValue(index);
        options.userDataDir = value;
        index = nextIndex;
        break;
      }
      case '--timeout': {
        const { value, nextIndex } = readValue(index);
        options.timeoutMs = value;
        index = nextIndex;
        break;
      }
      case '--limit': {
        const { value, nextIndex } = readValue(index);
        options.limit = value;
        index = nextIndex;
        break;
      }
      case '--per-user-limit': {
        const { value, nextIndex } = readValue(index);
        options.perUserLimit = value;
        index = nextIndex;
        break;
      }
      case '--headless':
        options.headless = true;
        break;
      case '--no-headless':
        options.headless = false;
        break;
      case '--auto-login':
        options.autoLogin = true;
        break;
      case '--no-auto-login':
        options.autoLogin = false;
        break;
      case '--reuse-login-state':
        options.reuseLoginState = true;
        break;
      case '--no-reuse-login-state':
        options.reuseLoginState = false;
        break;
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  return {
    help: false,
    inputUrl: positionals[0] || DEFAULT_INPUT_URL,
    options,
  };
}

function renderUserListMarkdown(users = []) {
  if (!Array.isArray(users) || users.length === 0) {
    return ['- none'];
  }
  return users.map((user) => {
    const details = [
      user.name || 'unknown',
      user.redId ? `小红书号 ${user.redId}` : null,
      user.userId ? `userId ${user.userId}` : null,
      user.url || null,
    ].filter(Boolean);
    return `- ${details.join(' | ')}`;
  });
}

function renderFollowUpdateGroupsMarkdown(groups = []) {
  if (!Array.isArray(groups) || groups.length === 0) {
    return ['- none'];
  }
  const lines = [];
  for (const group of groups) {
    lines.push(`### ${group?.authorName || group?.authorUrl || 'unknown user'}`);
    const notes = Array.isArray(group?.notes) ? group.notes : [];
    if (!notes.length) {
      lines.push('- none');
      continue;
    }
    for (const note of notes) {
      const detail = [
        note.title || 'Untitled note',
        note.publishedDateLocal || note.publishedAt || null,
        note.imageCount ? `${note.imageCount} images` : null,
        note.url || null,
      ].filter(Boolean);
      lines.push(`- ${detail.join(' | ')}`);
    }
  }
  return lines;
}

export function renderXiaohongshuFollowResultMarkdown(report = {}) {
  const lines = [
    '# Xiaohongshu Follow Query',
    '',
    `- Site: ${report?.site?.url ?? DEFAULT_INPUT_URL}`,
    `- Profile path: ${report?.site?.profilePath ?? 'unknown'}`,
    `- User data dir: ${report?.site?.userDataDir ?? 'none'}`,
    '',
    '## Auth',
    '',
    `- Status: ${report?.auth?.status ?? 'unknown'}`,
    `- Guest: ${report?.auth?.guest === true ? 'yes' : 'no'}`,
    `- Current URL: ${report?.auth?.currentUrl ?? 'unknown'}`,
    `- Title: ${report?.auth?.title ?? 'unknown'}`,
    `- User: ${report?.auth?.nickname ?? 'unknown'}`,
    `- User ID: ${report?.auth?.userId ?? 'unknown'}`,
    `- Red ID: ${report?.auth?.redId ?? 'unknown'}`,
    '',
    '## Result',
    '',
    `- Query type: ${report?.result?.queryType ?? 'list-followed-users'}`,
    `- Status: ${report?.result?.status ?? 'unknown'}`,
    `- Reason: ${report?.result?.reasonCode ?? 'none'}`,
    `- Matched users: ${report?.result?.matchedUsers ?? 0}`,
    `- Matched notes: ${report?.result?.matchedNotes ?? 0}`,
    `- Total followed users: ${report?.result?.totalFollowedUsers ?? report?.result?.matchedUsers ?? 0}`,
    `- Scanned users: ${report?.result?.scannedUsers ?? report?.result?.matchedUsers ?? 0}`,
    `- Source: ${report?.result?.followedUsersSource ?? 'none'}`,
    `- Self profile attempted: ${report?.result?.selfProfileAttempted ? 'yes' : 'no'}`,
    `- Self profile final URL: ${report?.result?.selfProfileFinalUrl ?? 'none'}`,
    `- Captcha detected: ${report?.result?.captchaDetected ? 'yes' : 'no'}`,
    '',
    '## Users',
    '',
    ...renderUserListMarkdown(report?.result?.users),
  ];
  if (report?.result?.queryType === 'list-followed-updates') {
    lines.push('', '## Updates', '', ...renderFollowUpdateGroupsMarkdown(report?.result?.groups));
  }
  if (Array.isArray(report?.warnings) && report.warnings.length > 0) {
    lines.push('', '## Warnings', '', ...report.warnings.map((warning) => `- ${warning}`));
  }
  return `${lines.join('\n')}\n`;
}

export async function pageFetchXiaohongshuAuthSnapshot() {
  const unwrap = (value) => {
    if (value && typeof value === 'object' && '_value' in value) {
      return value._value;
    }
    return value;
  };
  const normalizeLocalText = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
  const normalizeLocalUserUrl = (rawUrl) => {
    try {
      const parsed = new URL(String(rawUrl ?? ''), 'https://www.xiaohongshu.com/');
      if (parsed.hostname !== 'www.xiaohongshu.com') {
        return null;
      }
      return parsed.toString();
    } catch {
      return null;
    }
  };
  const normalizeUser = (rawUser, source) => {
    if (!rawUser || typeof rawUser !== 'object') {
      return null;
    }
    const userId = normalizeLocalText(rawUser.user_id || rawUser.userId || rawUser.id || '');
    const redId = normalizeLocalText(rawUser.red_id || rawUser.redId || '');
    const name = normalizeLocalText(rawUser.nickname || rawUser.name || rawUser.user_name || rawUser.username || '');
    const url = normalizeLocalUserUrl(
      rawUser.url
      || rawUser.userPageUrl
      || rawUser.profileUrl
      || (userId ? `/user/profile/${userId}` : ''),
    );
    if (!userId && !name && !url) {
      return null;
    }
    return {
      name: name || userId || url,
      userId: userId || null,
      redId: redId || null,
      url: url || null,
      source,
    };
  };

  const state = window.__INITIAL_STATE__ || {};
  const fromState = unwrap(state?.user?.follow);
  const notificationCount = unwrap(state?.notification?.notificationCount);

  /** @type {Array<any>} */
  const followedUsers = [];
  if (Array.isArray(fromState)) {
    for (const item of fromState) {
      const user = normalizeUser(item, 'state-user-follow');
      if (user) {
        followedUsers.push(user);
      }
    }
  }

  let meStatus = null;
  let meError = null;
  let meBody = null;
  try {
    const response = await fetch('https://edith.xiaohongshu.com/api/sns/web/v2/user/me', {
      credentials: 'include',
    });
    meStatus = response.status;
    const text = await response.text();
    try {
      meBody = JSON.parse(text);
    } catch {
      meBody = text;
    }
  } catch (error) {
    meError = error?.message ?? String(error);
  }

  return {
    currentUrl: String(window.location.href || ''),
    title: String(document.title || ''),
    guest: Boolean(meBody?.data?.guest),
    meStatus,
    meError,
    rawLoggedIn: unwrap(state?.user?.loggedIn) === true,
    currentUser: normalizeUser(meBody?.data, 'v2-user-me'),
    followedUsers,
    notificationCount: notificationCount && typeof notificationCount === 'object'
      ? {
        unreadCount: Number(notificationCount.unreadCount ?? 0) || 0,
        mentions: Number(notificationCount.mentions ?? 0) || 0,
        likes: Number(notificationCount.likes ?? 0) || 0,
        connections: Number(notificationCount.connections ?? 0) || 0,
      }
      : null,
  };
}

export async function pageFetchXiaohongshuOfficialFollowList() {
  const normalizeLocalText = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
  const normalizeUser = (rawUser, source) => {
    if (!rawUser || typeof rawUser !== 'object') {
      return null;
    }
    const compositeUserId = normalizeLocalText(rawUser.userid || rawUser.userid_str || '');
    const userId = normalizeLocalText(rawUser.rid || rawUser.userId || rawUser.user_id || rawUser.id || (compositeUserId ? compositeUserId.split('_')[0] : ''));
    const name = normalizeLocalText(rawUser.nickname || rawUser.name || rawUser.user_name || rawUser.username || '');
    const redId = normalizeLocalText(rawUser.redId || rawUser.red_id || '');
    const url = userId ? `https://www.xiaohongshu.com/user/profile/${userId}` : null;
    if (!userId && !name && !url) {
      return null;
    }
    return {
      name: name || userId || url,
      userId: userId || null,
      redId: redId || null,
      url: url || null,
      source,
    };
  };

  if (!Array.isArray(self.webpackChunkxhs_pc_web) || typeof self.webpackChunkxhs_pc_web.push !== 'function') {
    return {
      status: 'unavailable',
      users: [],
      matchedUsers: 0,
      errorMessage: 'missing-webpack-runtime',
    };
  }

  let webpackRequire = null;
  const chunkId = `xhs-follow-query-${Date.now()}-${Math.random()}`;
  self.webpackChunkxhs_pc_web.push([[chunkId], {}, (runtimeRequire) => {
    webpackRequire = runtimeRequire;
  }]);

  if (typeof webpackRequire !== 'function') {
    return {
      status: 'unavailable',
      users: [],
      matchedUsers: 0,
      errorMessage: 'missing-webpack-require',
    };
  }

  let apiModule = null;
  try {
    apiModule = webpackRequire(40122);
  } catch (error) {
    return {
      status: 'error',
      users: [],
      matchedUsers: 0,
      errorMessage: error?.message ?? String(error),
    };
  }

  if (!apiModule || typeof apiModule.tF !== 'function') {
    return {
      status: 'unavailable',
      users: [],
      matchedUsers: 0,
      errorMessage: 'missing-official-follow-api',
    };
  }

  try {
    const response = await apiModule.tF();
    const items = Array.isArray(response?.items) ? response.items : [];
    const users = [];
    for (const item of items) {
      const user = normalizeUser(item, 'official-follow-api');
      if (user) {
        users.push(user);
      }
    }
    return {
      status: 'success',
      users,
      matchedUsers: users.length,
    };
  } catch (error) {
    return {
      status: 'error',
      users: [],
      matchedUsers: 0,
      errorMessage: error?.message ?? String(error),
    };
  }
}

export async function pageExtractXiaohongshuAuthorPageNotes(options = {}) {
  const normalizeLocalText = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
  const toArray = (value) => Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const normalizeLocalUserUrl = (rawUrl) => {
    try {
      const parsed = new URL(String(rawUrl ?? ''), 'https://www.xiaohongshu.com/');
      if (parsed.hostname !== 'www.xiaohongshu.com') {
        return null;
      }
      return parsed.toString();
    } catch {
      return null;
    }
  };
  const extractNoteId = (value) => {
    const normalizedValue = normalizeLocalText(value);
    if (!normalizedValue) {
      return null;
    }
    const directMatch = normalizedValue.match(/^([0-9a-z]{6,})$/iu);
    if (directMatch?.[1]) {
      return normalizeLocalText(directMatch[1]) || null;
    }
    try {
      const parsed = new URL(normalizedValue, 'https://www.xiaohongshu.com/');
      const matched = parsed.pathname.match(/^\/explore\/([^/?#]+)/iu);
      return normalizeLocalText(matched?.[1]) || null;
    } catch {
      return null;
    }
  };
  const readUrlParam = (value, paramName) => {
    try {
      const parsed = new URL(String(value ?? ''), 'https://www.xiaohongshu.com/');
      return normalizeLocalText(parsed.searchParams.get(paramName)) || null;
    } catch {
      return null;
    }
  };
  const canonicalNoteUrl = (noteId, rawUrl = '') => {
    const finalNoteId = normalizeLocalText(noteId) || extractNoteId(rawUrl);
    return finalNoteId ? `https://www.xiaohongshu.com/explore/${finalNoteId}` : null;
  };
  const nonNegativeInteger = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
  };
  const toDate = (value) => {
    if (value === undefined || value === null || value === '') {
      return null;
    }
    if (value instanceof Date && !Number.isNaN(value.valueOf())) {
      return value;
    }
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue > 0) {
      const epochValue = numericValue > 1_000_000_000_000 ? numericValue : numericValue * 1000;
      const date = new Date(epochValue);
      return Number.isNaN(date.valueOf()) ? null : date;
    }
    const date = new Date(String(value));
    return Number.isNaN(date.valueOf()) ? null : date;
  };
  const formatShanghaiDateTime = (value) => {
    const date = toDate(value);
    if (!date) {
      return null;
    }
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    return formatter.format(date).replace(/\//gu, '-');
  };
  const uniqueStrings = (values) => [...new Set(toArray(values).map((value) => normalizeLocalText(value)).filter(Boolean))];
  const dedupeNotes = (notes) => {
    const seen = new Set();
    const ordered = [];
    for (const note of toArray(notes)) {
      if (!note || typeof note !== 'object') {
        continue;
      }
      const key = normalizeLocalText(note.noteId || note.url || `${note.title || ''}::${note.authorUserId || ''}`);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      ordered.push(note);
    }
    return ordered;
  };
  const normalizeNote = (rawNote = {}, fallback = {}) => {
    const noteId = normalizeLocalText(
      rawNote.noteId
      || rawNote.id
      || rawNote.note_id
      || fallback.noteId
      || fallback.id
      || extractNoteId(rawNote.url)
      || extractNoteId(rawNote.navigationUrl)
      || extractNoteId(fallback.url)
      || extractNoteId(fallback.navigationUrl)
      || '',
    ) || null;
    const navigationUrl = normalizeLocalUserUrl(
      rawNote.navigationUrl
      || rawNote.url
      || rawNote.href
      || fallback.navigationUrl
      || fallback.url
      || fallback.href
      || canonicalNoteUrl(noteId)
      || '',
    );
    const canonicalUrl = canonicalNoteUrl(noteId, navigationUrl || '');
    const publishedAt = toDate(
      rawNote.publishedAt
      || rawNote.time
      || rawNote.publishTime
      || rawNote.publishTimestamp
      || rawNote.lastUpdateTime
      || rawNote.publishTimeMs
      || fallback.publishedAt
      || fallback.time
      || null,
    );
    const authorUserId = normalizeLocalText(
      rawNote.authorUserId
      || rawNote.userId
      || rawNote.user_id
      || rawNote.user?.userId
      || fallback.authorUserId
      || fallback.userId
      || options.authorUserId
      || '',
    ) || null;
    const authorUrl = normalizeLocalUserUrl(
      rawNote.authorUrl
      || rawNote.user?.url
      || fallback.authorUrl
      || options.authorUrl
      || (authorUserId ? `/user/profile/${authorUserId}` : '')
      || '',
    );
    return {
      title: normalizeLocalText(
        rawNote.title
        || rawNote.displayTitle
        || rawNote.noteTitle
        || fallback.title
        || fallback.displayTitle
        || rawNote.desc
        || '',
      ) || null,
      excerpt: normalizeLocalText(
        rawNote.excerpt
        || rawNote.desc
        || rawNote.summary
        || rawNote.content
        || fallback.excerpt
        || fallback.desc
        || '',
      ) || null,
      noteId,
      url: canonicalUrl,
      navigationUrl: navigationUrl || canonicalUrl,
      xsecToken: normalizeLocalText(
        rawNote.xsecToken
        || rawNote.xsec_token
        || fallback.xsecToken
        || fallback.xsec_token
        || readUrlParam(navigationUrl, 'xsec_token')
        || '',
      ) || null,
      xsecSource: normalizeLocalText(
        rawNote.xsecSource
        || rawNote.xsec_source
        || fallback.xsecSource
        || fallback.xsec_source
        || readUrlParam(navigationUrl, 'xsec_source')
        || '',
      ) || null,
      contentType: normalizeLocalText(
        rawNote.contentType
        || rawNote.type
        || rawNote.noteType
        || rawNote.cardType
        || fallback.contentType
        || fallback.type
        || '',
      ) || null,
      imageCount: nonNegativeInteger(
        rawNote.imageCount
        || rawNote.imagesCount
        || rawNote.imgCount
        || rawNote.photoCount
        || (Array.isArray(rawNote.imageList) ? rawNote.imageList.length : null)
        || (Array.isArray(rawNote.images) ? rawNote.images.length : null)
        || (rawNote.cover ? 1 : null)
        || (fallback.cover ? 1 : null)
        || 0,
        0,
      ),
      publishedAt: publishedAt ? publishedAt.toISOString() : null,
      publishedDateLocal: formatShanghaiDateTime(publishedAt),
      publishedTimeText: normalizeLocalText(
        rawNote.publishedTimeText
        || rawNote.timeText
        || rawNote.publishText
        || fallback.publishedTimeText
        || fallback.timeText
        || '',
      ) || null,
      tagNames: uniqueStrings([
        ...toArray(rawNote.tagNames),
        ...toArray(rawNote.tagList).map((entry) => entry?.name ?? entry?.text ?? entry),
      ]),
      authorName: normalizeLocalText(
        rawNote.authorName
        || rawNote.user?.nickname
        || rawNote.user?.name
        || fallback.authorName
        || options.authorName
        || '',
      ) || null,
      authorUserId,
      authorUrl,
    };
  };
  const state = window.__INITIAL_STATE__ || {};
  const bodyText = normalizeLocalText(document.body?.innerText || '');
  if (
    String(window.location.href || '').includes('/website-login/captcha')
    || normalizeLocalText(document.title).includes('安全验证')
    || bodyText.includes('安全验证')
    || bodyText.includes('IP存在风险')
    || bodyText.includes('请切换可靠网络环境后重试')
  ) {
    return {
      status: 'captcha',
      currentUrl: String(window.location.href || ''),
      title: String(document.title || ''),
      notes: [],
      hasMore: false,
    };
  }
  const stateNotes = toArray(state?.user?.notes)
    .flatMap((group) => toArray(group))
    .map((entry) => normalizeNote(entry?.noteCard ?? entry, entry))
    .filter((entry) => entry.title || entry.noteId || entry.url);
  const domSections = Array.from(document.querySelectorAll('section.note-item'));
  const domNotes = (domSections.length ? domSections : Array.from(document.querySelectorAll('a[href*="/explore/"]')))
    .map((node) => {
      const scope = node instanceof Element ? node : null;
      const link = scope?.matches?.('a[href*="/explore/"]')
        ? scope
        : scope?.querySelector?.('a[href*="/explore/"]')
          || null;
      const href = link?.getAttribute('href') || '';
      if (!href) {
        return null;
      }
      const titleNode = scope?.querySelector?.('.footer .title')
        || scope?.querySelector?.('.title')
        || link;
      const authorLink = scope?.querySelector?.('.author-wrapper a[href*="/user/profile/"]')
        || document.querySelector('.author-wrapper a[href*="/user/profile/"]');
      return normalizeNote({
        url: href,
        title: titleNode?.textContent || '',
        authorName: scope?.querySelector?.('.author-wrapper .name')?.textContent || '',
        authorUrl: authorLink?.getAttribute?.('href') || '',
      });
    })
    .filter(Boolean);
  const mergedNotes = [];
  const mergedCount = Math.max(stateNotes.length, domNotes.length);
  for (let index = 0; index < mergedCount; index += 1) {
    const merged = normalizeNote({
      ...(stateNotes[index] ?? {}),
      ...(domNotes[index] ?? {}),
    }, stateNotes[index] ?? domNotes[index] ?? {});
    if (merged.title || merged.noteId || merged.url) {
      mergedNotes.push(merged);
    }
  }
  return {
    status: 'success',
    currentUrl: String(window.location.href || ''),
    title: String(document.title || ''),
    hasMore: Boolean(state?.user?.notesPageInfo?.hasMore),
    notes: dedupeNotes(mergedNotes).slice(0, nonNegativeInteger(options.limit, 20) || 20),
  };
}

export async function pageExtractXiaohongshuSelfProfileFollowState(selfUserId = '') {
  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const normalizeLocalText = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
  const normalizeLocalUserUrl = (rawUrl) => {
    try {
      const parsed = new URL(String(rawUrl ?? ''), 'https://www.xiaohongshu.com/');
      if (parsed.hostname !== 'www.xiaohongshu.com') {
        return null;
      }
      return parsed.toString();
    } catch {
      return null;
    }
  };
  const unwrap = (value) => {
    if (value && typeof value === 'object' && '_value' in value) {
      return value._value;
    }
    return value;
  };
  const normalizeUser = (rawUser, source) => {
    if (!rawUser || typeof rawUser !== 'object') {
      return null;
    }
    const userId = normalizeLocalText(rawUser.userId || rawUser.user_id || rawUser.id || '');
    const redId = normalizeLocalText(rawUser.redId || rawUser.red_id || '');
    const name = normalizeLocalText(rawUser.name || rawUser.nickname || rawUser.username || rawUser.user_name || '');
    let url = normalizeLocalUserUrl(
      rawUser.url
      || rawUser.profileUrl
      || rawUser.href
      || (userId ? `/user/profile/${userId}` : ''),
    );
    if (userId && normalizeLocalText(selfUserId) && userId === normalizeLocalText(selfUserId)) {
      url = normalizeLocalUserUrl(`/user/profile/${userId}`);
    }
    if (!userId && !name && !url) {
      return null;
    }
    return {
      name: name || userId || url,
      userId: userId || null,
      redId: redId || null,
      url: url || null,
      source,
    };
  };
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
  const detectCaptcha = () => {
    const url = window.location.href;
    const title = normalizeLocalText(document.title);
    const bodyText = normalizeLocalText(document.body?.innerText || '');
    return url.includes('/website-login/captcha')
      || title.includes('安全验证')
      || bodyText.includes('安全验证')
      || bodyText.includes('IP存在风险')
      || bodyText.includes('请切换可靠网络环境后重试');
  };
  const collectUsersFromState = () => {
    const state = window.__INITIAL_STATE__ || {};
    const users = [];
    const fromFollowState = unwrap(state?.user?.follow);
    if (Array.isArray(fromFollowState)) {
      for (const item of fromFollowState) {
        const user = normalizeUser(item, 'self-profile-state');
        if (user) {
          users.push(user);
        }
      }
    }
    const pageData = unwrap(state?.user?.userPageData);
    const candidateLists = [
      pageData?.follows,
      pageData?.followings,
      pageData?.followingUsers,
      pageData?.users,
    ];
    for (const list of candidateLists) {
      if (!Array.isArray(list)) {
        continue;
      }
      for (const item of list) {
        const user = normalizeUser(item, 'self-profile-state');
        if (user) {
          users.push(user);
        }
      }
    }
    return users;
  };
  const collectUsersFromDom = () => {
    const users = [];
    for (const anchor of document.querySelectorAll('a[href*="/user/profile/"]')) {
      if (!isVisible(anchor)) {
        continue;
      }
      const url = normalizeLocalUserUrl(anchor.getAttribute('href') || '');
      if (!url) {
        continue;
      }
      const matched = url.match(/\/user\/profile\/([^/?#]+)/u);
      const userId = matched?.[1] ? normalizeLocalText(matched[1]) : null;
      if (userId && normalizeLocalText(selfUserId) && userId === normalizeLocalText(selfUserId)) {
        continue;
      }
      const label = normalizeLocalText(anchor.textContent)
        || normalizeLocalText(anchor.getAttribute('title'))
        || normalizeLocalText(anchor.closest('[class]')?.textContent || '');
      users.push({
        name: label || userId || url,
        userId,
        redId: null,
        url,
        source: 'self-profile-dom',
      });
    }
    return users;
  };
  const parseFollowCount = () => {
    const bodyText = normalizeLocalText(document.body?.innerText || '');
    const match = bodyText.match(/(\d+)\s*关注/u);
    return match ? Number(match[1]) : null;
  };
  const tryOpenFollowSurface = async () => {
    const candidates = [...document.querySelectorAll('button,a,div,span')]
      .filter(isVisible)
      .map((node) => ({
        node,
        text: normalizeLocalText(node.textContent),
      }))
      .filter((entry) => entry.text && entry.text.length <= 16 && /关注/u.test(entry.text));
    const preferred = candidates.find((entry) => /^\d+\s*关注$/u.test(entry.text))
      || candidates.find((entry) => entry.text === '关注')
      || candidates[0];
    if (!preferred) {
      return false;
    }
    preferred.node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    if (typeof preferred.node.click === 'function') {
      preferred.node.click();
    }
    await wait(900);
    return true;
  };

  const firstPassUsers = collectUsersFromState().concat(collectUsersFromDom());
  if (detectCaptcha()) {
    return {
      status: 'captcha',
      currentUrl: window.location.href,
      title: document.title,
      followCount: parseFollowCount(),
      users: firstPassUsers,
      openedFollowSurface: false,
    };
  }

  let users = firstPassUsers;
  let openedFollowSurface = false;
  if (!users.length) {
    openedFollowSurface = await tryOpenFollowSurface();
    if (openedFollowSurface) {
      users = collectUsersFromState().concat(collectUsersFromDom());
    }
  }

  return {
    status: detectCaptcha() ? 'captcha' : 'profile-loaded',
    currentUrl: window.location.href,
    title: document.title,
    followCount: parseFollowCount(),
    users,
    openedFollowSurface,
  };
}

async function collectXiaohongshuFollowedUserUpdates(session, users, settings) {
  const limitedUsers = Array.isArray(users)
    ? users.slice(0, settings.limit ?? users.length)
    : [];
  const groups = [];
  const notes = [];
  const errors = [];
  let scannedUsers = 0;
  for (const user of limitedUsers) {
    scannedUsers += 1;
    if (!user?.url) {
      errors.push({
        reason: 'missing-author-url',
        message: `Missing author URL for followed user ${user?.name || user?.userId || 'unknown'}.`,
        userId: user?.userId ?? null,
      });
      continue;
    }
    try {
      await session.navigateAndWait(user.url, createWaitPolicy(settings.timeoutMs));
      const authorPage = await session.callPageFunction(pageExtractXiaohongshuAuthorPageNotes, {
        authorName: user.name,
        authorUserId: user.userId,
        authorUrl: user.url,
        limit: settings.perUserLimit,
      });
      if (authorPage?.status === 'captcha') {
        errors.push({
          reason: 'author-page-captcha',
          message: `Xiaohongshu redirected ${user.name || user.userId || user.url} to a captcha page.`,
          userId: user.userId ?? null,
          authorUrl: user.url,
        });
        continue;
      }
      const authorNotes = dedupeNotes(authorPage?.notes ?? [])
        .slice(0, settings.perUserLimit ?? authorPage?.notes?.length ?? 0)
        .map((note) => ({
          ...note,
          authorName: note.authorName || user.name || null,
          authorUserId: note.authorUserId || user.userId || null,
          authorUrl: note.authorUrl || user.url || null,
        }));
      if (!authorNotes.length) {
        continue;
      }
      groups.push({
        authorName: user.name || authorNotes[0]?.authorName || user.url || 'unknown',
        authorUrl: user.url,
        userId: user.userId || null,
        redId: user.redId || null,
        notes: authorNotes,
      });
      notes.push(...authorNotes);
    } catch (error) {
      errors.push({
        reason: 'author-page-fetch-failed',
        message: error?.message ?? String(error),
        userId: user?.userId ?? null,
        authorUrl: user?.url ?? null,
      });
    }
  }
  return {
    groups: groups.sort((left, right) => String(left.authorName || '').localeCompare(String(right.authorName || ''), 'zh-Hans-CN')),
    notes: dedupeNotes(notes),
    scannedUsers,
    totalFollowedUsers: Array.isArray(users) ? users.length : 0,
    partial: errors.length > 0,
    errors,
  };
}

export async function queryXiaohongshuFollow(inputUrl = DEFAULT_INPUT_URL, options = {}, deps = {}) {
  const settings = mergeOptions(inputUrl, options);
  const runtime = {
    openBrowserSession,
    resolveSiteAuthProfile,
    resolveSiteBrowserSessionOptions,
    ensureAuthenticatedSession,
    prepareSiteSessionGovernance,
    finalizeSiteSessionGovernance,
    releaseSessionLease,
    ...deps,
  };

  const authProfile = await runtime.resolveSiteAuthProfile(settings.inputUrl, {
    profilePath: settings.profilePath,
  });
  const authContext = await runtime.resolveSiteBrowserSessionOptions(settings.inputUrl, settings, {
    profilePath: settings.profilePath,
    authProfile,
  });
  const warnings = [...(authProfile?.warnings ?? [])];
  const governance = await runtime.prepareSiteSessionGovernance(
    settings.inputUrl,
    authContext,
    settings,
    {
      operation: 'xiaohongshu-query-follow',
      networkOptions: {
        disableExternalLookup: true,
      },
    },
    deps.siteSessionGovernanceDeps ?? {},
  );

  if (!governance.policyDecision.allowed) {
    const blockedError = new Error(`Xiaohongshu follow query blocked by runtime governance: ${governance.policyDecision.riskCauseCode ?? 'unknown-risk'}.`);
    blockedError.code = governance.policyDecision.riskCauseCode ?? 'XIAOHONGSHU_FOLLOW_QUERY_BLOCKED';
    if (governance.lease) {
      await runtime.releaseSessionLease(governance.lease);
    }
    throw blockedError;
  }

  const runtimeUrl = String(authContext?.authConfig?.verificationUrl || settings.inputUrl).trim() || settings.inputUrl;
  /** @type {any} */
  let session = null;
  let governanceSummary = null;
  let governanceFinalized = false;
  try {
    session = await runtime.openBrowserSession({
      browserPath: settings.browserPath,
      headless: settings.headless,
      timeoutMs: settings.timeoutMs,
      fullPage: false,
      viewport: {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
      },
      userDataDir: authContext.userDataDir,
      cleanupUserDataDirOnShutdown: authContext.cleanupUserDataDirOnShutdown,
      startupUrl: runtimeUrl,
    }, {
      userDataDirPrefix: 'xiaohongshu-follow-browser-',
    });

    await session.navigateAndWait(runtimeUrl, createWaitPolicy(settings.timeoutMs));
    const authResult = await runtime.ensureAuthenticatedSession(session, settings.inputUrl, settings, {
      authContext,
    });
    const authSnapshot = await session.callPageFunction(pageFetchXiaohongshuAuthSnapshot);
    const currentUser = authSnapshot?.guest === true
      ? normalizeNodeUser(null)
      : normalizeNodeUser(authSnapshot?.currentUser);
    const usersFromAuthSnapshot = dedupeUsers(authSnapshot?.followedUsers);
    const officialFollowProbe = usersFromAuthSnapshot.length === 0 && currentUser.userId
      ? await session.callPageFunction(pageFetchXiaohongshuOfficialFollowList)
      : null;
    const usersFromOfficialApi = dedupeUsers(officialFollowProbe?.users);

    let result = {
      queryType: settings.intent,
      status: 'unknown',
      reasonCode: null,
      users: [],
      groups: [],
      notes: [],
      errors: [],
      partial: false,
      totalFollowedUsers: 0,
      scannedUsers: 0,
      matchedUsers: 0,
      matchedNotes: 0,
      followedUsersSource: null,
      selfProfileAttempted: false,
      selfProfileUrl: currentUser.userId ? `https://www.xiaohongshu.com/user/profile/${currentUser.userId}` : null,
      selfProfileFinalUrl: null,
      captchaDetected: false,
      notificationCount: authSnapshot?.notificationCount ?? null,
    };

    if (authSnapshot?.guest === true || !currentUser.userId) {
      result = {
        ...result,
        status: 'unauthenticated',
        reasonCode: authSnapshot?.guest === true ? 'guest-session' : 'missing-current-user',
      };
    } else if (usersFromOfficialApi.length > 0) {
      result = {
        ...result,
        status: 'success',
        users: usersFromOfficialApi,
        totalFollowedUsers: usersFromOfficialApi.length,
        scannedUsers: usersFromOfficialApi.length,
        matchedUsers: usersFromOfficialApi.length,
        followedUsersSource: 'official-api-intimacy-list',
      };
    } else if (usersFromAuthSnapshot.length > 0) {
      result = {
        ...result,
        status: 'success',
        users: usersFromAuthSnapshot,
        totalFollowedUsers: usersFromAuthSnapshot.length,
        scannedUsers: usersFromAuthSnapshot.length,
        matchedUsers: usersFromAuthSnapshot.length,
        followedUsersSource: 'state-user-follow',
      };
    } else if (result.selfProfileUrl) {
      result.selfProfileAttempted = true;
      await session.navigateAndWait(result.selfProfileUrl, createWaitPolicy(settings.timeoutMs));
      const selfProfileFinalUrl = typeof session.evaluateValue === 'function'
        ? await session.evaluateValue('window.location.href')
        : result.selfProfileUrl;
      const profileState = await session.callPageFunction(
        pageExtractXiaohongshuSelfProfileFollowState,
        currentUser.userId,
      );
      const profileUsers = dedupeUsers(profileState?.users);
      if (profileState?.status === 'captcha') {
        result = {
          ...result,
          status: 'captcha-gated',
          reasonCode: 'self-profile-captcha',
          selfProfileFinalUrl: selfProfileFinalUrl ?? profileState?.currentUrl ?? null,
          captchaDetected: true,
        };
      } else if (profileUsers.length > 0) {
        result = {
          ...result,
          status: 'success',
          users: profileUsers,
          totalFollowedUsers: profileUsers.length,
          scannedUsers: profileUsers.length,
          matchedUsers: profileUsers.length,
          followedUsersSource: profileState?.openedFollowSurface ? 'self-profile-overlay' : 'self-profile-dom',
          selfProfileFinalUrl: selfProfileFinalUrl ?? profileState?.currentUrl ?? null,
        };
      } else if (Number.isFinite(profileState?.followCount) && profileState.followCount === 0) {
        result = {
          ...result,
          status: 'success',
          reasonCode: 'zero-follow-count',
          totalFollowedUsers: 0,
          scannedUsers: 0,
          selfProfileFinalUrl: selfProfileFinalUrl ?? profileState?.currentUrl ?? null,
        };
      } else {
        result = {
          ...result,
          status: 'partial',
          reasonCode: 'no-follow-data',
          selfProfileFinalUrl: selfProfileFinalUrl ?? profileState?.currentUrl ?? null,
        };
      }
    } else {
      result = {
        ...result,
        status: 'partial',
        reasonCode: 'missing-self-profile-url',
      };
    }

    if (settings.intent === 'list-followed-updates' && result.status === 'success') {
      const updates = await collectXiaohongshuFollowedUserUpdates(session, result.users, settings);
      result = {
        ...result,
        queryType: 'list-followed-updates',
        groups: updates.groups,
        notes: updates.notes,
        errors: updates.errors,
        partial: updates.partial,
        totalFollowedUsers: updates.totalFollowedUsers,
        scannedUsers: updates.scannedUsers,
        matchedUsers: updates.groups.length,
        matchedNotes: updates.notes.length,
        status: updates.partial ? 'partial' : 'success',
        reasonCode: updates.notes.length > 0
          ? (updates.partial ? 'author-page-partial' : null)
          : (updates.partial ? 'no-followed-updates' : 'no-public-notes'),
      };
    }

    if (result.status === 'partial') {
      warnings.push(
        settings.intent === 'list-followed-updates'
          ? 'Authenticated session was detected, but some followed-user update pages failed or returned no stable note list.'
          : 'Authenticated session was detected, but no stable followed-user list could be extracted from the current Xiaohongshu surfaces.',
      );
    }
    if (result.status === 'captcha-gated') {
      warnings.push('Xiaohongshu redirected the self profile follow probe to a captcha page.');
    }
    if (result.status === 'unauthenticated') {
      warnings.push('Xiaohongshu returned a guest session on the authenticated surface, so the follow list is unavailable until login state is restored.');
    }

    governanceSummary = await runtime.finalizeSiteSessionGovernance(governance, {
      antiCrawlSignals: result.captchaDetected ? ['verify'] : [],
      authRequired: true,
      authAvailable: result.status !== 'unauthenticated',
      identityConfirmed: authSnapshot?.guest === false && Boolean(currentUser.userId),
      loginStateDetected: authResult?.loginState?.loginStateDetected === true || authSnapshot?.rawLoggedIn === true,
      note: result.reasonCode,
    });
    governanceFinalized = true;
    const runtimeRisk = runtimeRiskForFollowQueryResult(result, settings);

    return {
      site: {
        url: settings.inputUrl,
        host: normalizeHost(settings.inputUrl),
        profilePath: settings.profilePath,
        userDataDir: authContext.userDataDir,
        runtimeUrl,
        sessionLeaseId: governanceSummary?.sessionLeaseId ?? governance.lease?.leaseId ?? null,
      },
      auth: {
        status: result.status === 'unauthenticated'
          ? 'guest'
          : result.status === 'captcha-gated'
            ? 'captcha-gated'
            : 'authenticated',
        guest: authSnapshot?.guest === true,
        currentUrl: authSnapshot?.currentUrl ?? runtimeUrl,
        title: authSnapshot?.title ?? null,
        nickname: currentUser.name,
        userId: currentUser.userId,
        redId: currentUser.redId,
        loginStateDetected: authResult?.loginState?.loginStateDetected === true || authSnapshot?.rawLoggedIn === true,
      },
      result,
      runtimeRisk,
      warnings,
    };
  } finally {
    if (session && typeof session.close === 'function') {
      await session.close();
    }
    if (!governanceFinalized && governance.lease) {
      await runtime.releaseSessionLease(governance.lease);
    }
  }
}

export async function runXiaohongshuFollowQueryCli(argv = process.argv.slice(2)) {
  initializeCliUtf8();
  const parsed = parseXiaohongshuFollowQueryArgs(argv);
  if (parsed.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const report = await queryXiaohongshuFollow(parsed.inputUrl, parsed.options);
  if ((normalizeText(parsed.options.format) || 'json').toLowerCase() === 'markdown') {
    process.stdout.write(renderXiaohongshuFollowResultMarkdown(report));
  } else {
    writeJsonStdout(report);
  }
  if (
    report?.result?.status === 'partial'
    || report?.result?.status === 'captcha-gated'
    || report?.result?.status === 'unauthenticated'
  ) {
    process.exitCode = 1;
  }
}
