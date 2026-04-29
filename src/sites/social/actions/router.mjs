// @ts-check

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

import { openBrowserSession } from '../../../infra/browser/session.mjs';
import { initializeCliUtf8, writeJsonStdout } from '../../../infra/cli.mjs';
import {
  ensureAuthenticatedSession,
  exportDownloadSessionPassthrough,
  resolveSiteBrowserSessionOptions,
} from '../../../infra/auth/site-auth.mjs';
import { ensureDir, readJsonFile, readTextFile, writeJsonFile, writeJsonLines, writeTextFile } from '../../../infra/io.mjs';
import { cleanText, compactSlug, normalizeText } from '../../../shared/normalize.mjs';
import { downloadMediaFiles as executeMediaDownloads } from '../../downloads/media-executor.mjs';
import {
  actionSessionMetadataFromOptions,
  summarizeSessionRunManifest,
} from '../../sessions/manifest-bridge.mjs';
import { evaluateAuthenticatedSessionReleaseGate } from '../../sessions/release-gate.mjs';
import { buildSessionRepairPlanCommand } from '../../sessions/repair-command.mjs';
import { runSessionTask } from '../../sessions/runner.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..', '..');

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ITEMS = 100;
const DEFAULT_MAX_RELATION_ITEMS = 500;
const DEFAULT_MAX_SCROLLS = 8;
const DEFAULT_SCROLL_WAIT_MS = 700;
const DEFAULT_FULL_ARCHIVE_MAX_SCROLLS = 250;
const DEFAULT_MAX_API_PAGES = 25;
const DEFAULT_MAX_USERS = 25;
const DEFAULT_MAX_DETAIL_PAGES = 60;
const DEFAULT_MAX_MEDIA_DOWNLOADS = 500;
const DEFAULT_MEDIA_DOWNLOAD_CONCURRENCY = 6;
const DEFAULT_MEDIA_DOWNLOAD_RETRIES = 2;
const DEFAULT_MEDIA_DOWNLOAD_BACKOFF_MS = 2_000;
const DEFAULT_RISK_BACKOFF_MS = 10_000;
const DEFAULT_RISK_RETRIES = 2;
const DEFAULT_API_RETRIES = 2;
const ARTIFACT_SCHEMA_VERSION = 1;
const API_CAPTURE_SAMPLE_LIMIT = 8;
const API_CAPTURE_SHAPE_PATH_LIMIT = 80;
const API_CAPTURE_PAYLOAD_SAMPLE_LIMIT = 12_000;

const SOCIAL_SITES = Object.freeze({
  x: {
    siteKey: 'x',
    host: 'x.com',
    baseUrl: 'https://x.com',
    homeUrl: 'https://x.com/home',
    defaultProfilePath: path.join(REPO_ROOT, 'profiles', 'x.com.json'),
    reservedSegments: [
      'compose',
      'explore',
      'home',
      'i',
      'jobs',
      'login',
      'messages',
      'notifications',
      'search',
      'settings',
      'signup',
    ],
    routes: {
      profile: '/{account}',
      posts: '/{account}',
      replies: '/{account}/with_replies',
      media: '/{account}/media',
      highlights: '/{account}/highlights',
      following: '/{account}/following',
      followers: '/{account}/followers',
      search: '/search',
    },
    searchMode: 'url-query',
    contentSelectors: {
      item: 'article[role="article"]',
      text: 'div[data-testid="tweetText"]',
      link: 'a[href*="/status/"]',
      timestamp: 'time[datetime]',
      media: 'img, video, source',
    },
    accountSelectors: {
      currentProfileLink: 'a[data-testid="AppTabBar_Profile_Link"][href^="/"]',
      displayName: 'div[data-testid="UserName"], h1',
      bio: 'div[data-testid="UserDescription"]',
      statLinks: 'a[href$="/following"], a[href$="/followers"]',
      relationLink: 'a[href^="/"][role="link"]',
    },
  },
  instagram: {
    siteKey: 'instagram',
    host: 'www.instagram.com',
    baseUrl: 'https://www.instagram.com',
    homeUrl: 'https://www.instagram.com/',
    defaultProfilePath: path.join(REPO_ROOT, 'profiles', 'www.instagram.com.json'),
    reservedSegments: [
      'about',
      'accounts',
      'api',
      'challenge',
      'direct',
      'explore',
      'graphql',
      'legal',
      'p',
      'popular',
      'privacy',
      'reel',
      'reels',
      'stories',
      'tv',
      'web',
    ],
    routes: {
      profile: '/{account}/',
      posts: '/{account}/',
      reels: '/{account}/reels/',
      media: '/{account}/',
      highlights: '/{account}/',
      following: '/{account}/following/',
      followers: '/{account}/followers/',
      search: '/explore/search/',
    },
    searchMode: 'explore-search',
    contentSelectors: {
      item: 'article, a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]',
      text: 'h1, span, div',
      link: 'a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]',
      timestamp: 'time[datetime]',
      media: 'img, video, source',
    },
    accountSelectors: {
      currentProfileLink: 'a[href^="/"][role="link"]',
      displayName: 'header h1, header h2, h1',
      bio: 'header section, header',
      statLinks: 'a[href$="/following/"], a[href$="/followers/"]',
      relationLink: 'a[href^="/"][role="link"]',
    },
  },
});

const ACTION_ALIASES = Object.freeze({
  'account': 'account-info',
  'account-info': 'account-info',
  'author-info': 'account-info',
  'profile': 'account-info',
  'profile-info': 'account-info',
  'user-info': 'account-info',
  'content': 'profile-content',
  'download': 'profile-content',
  'download-user-content': 'profile-content',
  'export-user-content': 'profile-content',
  'history': 'profile-content',
  'list-author-posts': 'profile-content',
  'list-profile-content': 'profile-content',
  'posts': 'profile-content',
  'profile-content': 'profile-content',
  'user-content': 'profile-content',
  'archive': 'profile-content',
  'archive-user-content': 'profile-content',
  'export-all': 'profile-content',
  'full-archive': 'profile-content',
  'full-history': 'profile-content',
  'replies': 'profile-content',
  'list-author-replies': 'profile-content',
  'media': 'profile-content',
  'photos': 'profile-content',
  'videos': 'profile-content',
  'list-author-media': 'profile-content',
  'highlights': 'profile-content',
  'list-author-highlights': 'profile-content',
  'following': 'profile-following',
  'list-author-following': 'profile-following',
  'list-profile-following': 'profile-following',
  'profile-following': 'profile-following',
  'followers': 'profile-followers',
  'profile-followers': 'profile-followers',
  'followed': 'followed-users',
  'followed-users': 'followed-users',
  'list-followed-users': 'followed-users',
  'followed-updates': 'followed-posts-by-date',
  'followed-posts-by-date': 'followed-posts-by-date',
  'list-followed-updates': 'followed-posts-by-date',
  'search': 'search',
  'search-content': 'search',
  'search-posts': 'search',
  'search-book': 'search',
});

const CONTENT_TYPE_ALIASES = Object.freeze({
  post: 'posts',
  posts: 'posts',
  timeline: 'posts',
  reply: 'replies',
  replies: 'replies',
  with_replies: 'replies',
  media: 'media',
  photo: 'media',
  photos: 'media',
  video: 'media',
  videos: 'media',
  reel: 'reels',
  reels: 'reels',
  highlight: 'highlights',
  highlights: 'highlights',
});

function toBoolean(value, defaultValue = false) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function toNumber(value, defaultValue) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

function normalizeSiteId(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'twitter' || normalized === 'twitter.com' || normalized === 'x.com') {
    return 'x';
  }
  if (normalized === 'ig' || normalized === 'instagram' || normalized === 'instagram.com' || normalized === 'www.instagram.com') {
    return 'instagram';
  }
  if (SOCIAL_SITES[normalized]) {
    return normalized;
  }
  return null;
}

export function resolveSocialSiteConfig(site) {
  const siteId = normalizeSiteId(site);
  if (!siteId || !SOCIAL_SITES[siteId]) {
    throw new Error(`Unsupported social site ${JSON.stringify(site)}. Expected x or instagram.`);
  }
  return SOCIAL_SITES[siteId];
}

function normalizeAction(action, contentType = null) {
  const normalized = String(action ?? '').trim().toLowerCase().replace(/_/gu, '-');
  const mapped = ACTION_ALIASES[normalized] ?? normalized;
  if (mapped === 'profile-content') {
    return 'profile-content';
  }
  if (contentType && CONTENT_TYPE_ALIASES[String(contentType).trim().toLowerCase()]) {
    return 'profile-content';
  }
  if (!Object.values(ACTION_ALIASES).includes(mapped) && ![
    'account-info',
    'profile-content',
    'profile-following',
    'profile-followers',
    'followed-users',
    'followed-posts-by-date',
    'search',
  ].includes(mapped)) {
    throw new Error(`Unsupported social action ${JSON.stringify(action)}.`);
  }
  return mapped;
}

function normalizeContentType(action, contentType = null, siteId = null) {
  const explicit = String(contentType ?? '').trim().toLowerCase();
  if (explicit && CONTENT_TYPE_ALIASES[explicit]) {
    return CONTENT_TYPE_ALIASES[explicit];
  }
  const actionText = String(action ?? '').trim().toLowerCase().replace(/_/gu, '-');
  if (actionText.includes('reply') || actionText.includes('replie')) {
    return 'replies';
  }
  if (actionText.includes('media') || actionText.includes('photo') || actionText.includes('video')) {
    return 'media';
  }
  if (actionText.includes('highlight')) {
    return 'highlights';
  }
  if (actionText.includes('reel') && siteId === 'instagram') {
    return 'reels';
  }
  return 'posts';
}

function isReservedAccountSegment(segment, config) {
  return config.reservedSegments.includes(String(segment ?? '').toLowerCase());
}

export function normalizeSocialAccount(value, site = 'x') {
  const config = resolveSocialSiteConfig(site);
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (host === config.host || host === config.host.replace(/^www\./u, '') || `www.${host}` === config.host) {
      const parts = parsed.pathname.split('/').filter(Boolean);
      const candidate = parts[0] ?? '';
      if (candidate && !isReservedAccountSegment(candidate, config)) {
        return candidate.replace(/^@/u, '');
      }
    }
  } catch {
    // Treat as handle below.
  }

  const withoutAt = raw.replace(/^@/u, '').replace(/^\/+|\/+$/gu, '');
  const firstSegment = withoutAt.split('/').filter(Boolean)[0] ?? withoutAt;
  if (!firstSegment || isReservedAccountSegment(firstSegment, config)) {
    return null;
  }
  return firstSegment;
}

function buildUrlFromTemplate(config, template, account = null) {
  const accountValue = account ? encodeURIComponent(account) : '';
  const pathValue = template.replace('{account}', accountValue);
  return new URL(pathValue, `${config.baseUrl}/`).toString();
}

function buildSearchUrl(config, { query, date, fromDate, toDate } = {}) {
  const parsed = new URL(config.routes.search, `${config.baseUrl}/`);
  const normalizedQuery = normalizeText(query || '');
  if (config.siteKey === 'x') {
    const searchTerms = [];
    if (normalizedQuery) {
      searchTerms.push(normalizedQuery);
    }
    if (date) {
      const until = nextDateString(date);
      searchTerms.push(`since:${date}`, `until:${until}`);
    } else {
      if (fromDate) {
        searchTerms.push(`since:${fromDate}`);
      }
      if (toDate) {
        searchTerms.push(`until:${toDate}`);
      }
    }
    parsed.searchParams.set('q', searchTerms.join(' ').trim());
    parsed.searchParams.set('src', 'typed_query');
    parsed.searchParams.set('f', 'live');
    return parsed.toString();
  }
  if (normalizedQuery) {
    parsed.searchParams.set('q', normalizedQuery);
  }
  return parsed.toString();
}

function nextDateString(dateText) {
  const parsed = new Date(`${dateText}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) {
    return dateText;
  }
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function isDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(String(value ?? '').trim());
}

function normalizeDateWindow({ date, fromDate, toDate } = {}) {
  const normalizedDate = String(date ?? '').trim();
  const normalizedFrom = String(fromDate ?? '').trim();
  const normalizedTo = String(toDate ?? '').trim();
  return {
    date: isDateString(normalizedDate) ? normalizedDate : null,
    fromDate: isDateString(normalizedFrom) ? normalizedFrom : null,
    toDate: isDateString(normalizedTo) ? normalizedTo : null,
  };
}

function firstNonEmpty(values = []) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

export function buildSocialActionPlan(input = {}) {
  const config = resolveSocialSiteConfig(input.site ?? input.siteKey ?? input.host);
  const action = normalizeAction(input.action ?? 'account-info', input.contentType);
  const contentType = normalizeContentType(input.action, input.contentType, config.siteKey);
  const account = normalizeSocialAccount(input.account ?? input.handle ?? input.user ?? input.profile ?? input.target, config.siteKey);
  const query = firstNonEmpty([input.query, input.keyword, input.q]);
  const dateWindow = normalizeDateWindow({
    date: input.date,
    fromDate: input.fromDate ?? input.from,
    toDate: input.toDate ?? input.to,
  });

  let url = config.homeUrl;
  let requiresAccount = false;
  let requiresAuth = true;
  let plannerNotes = [];

  if (action === 'account-info') {
    requiresAccount = true;
    url = account ? buildUrlFromTemplate(config, config.routes.profile, account) : config.homeUrl;
  } else if (action === 'profile-content') {
    requiresAccount = true;
    const routeKey = config.routes[contentType] ? contentType : 'posts';
    url = account ? buildUrlFromTemplate(config, config.routes[routeKey], account) : config.homeUrl;
  } else if (action === 'profile-following') {
    requiresAccount = true;
    url = account ? buildUrlFromTemplate(config, config.routes.following, account) : config.homeUrl;
  } else if (action === 'profile-followers') {
    requiresAccount = true;
    url = account ? buildUrlFromTemplate(config, config.routes.followers, account) : config.homeUrl;
  } else if (action === 'followed-users') {
    url = account ? buildUrlFromTemplate(config, config.routes.following, account) : config.homeUrl;
    plannerNotes.push(account ? 'Using the provided account following route.' : 'Current account handle will be inferred from the authenticated page when possible.');
  } else if (action === 'followed-posts-by-date') {
    if (config.siteKey === 'x') {
      url = buildSearchUrl(config, {
        query: query ? `${query} filter:follows` : 'filter:follows',
        ...dateWindow,
      });
      plannerNotes.push('X supports the followed-account search operator, so date filtering is encoded in the search URL.');
    } else {
      url = config.homeUrl;
      plannerNotes.push('Instagram has no stable followed-feed date URL; the runner expands the authenticated following list, scans followed profiles, then verifies visible post details by date.');
    }
  } else if (action === 'search') {
    url = buildSearchUrl(config, {
      query,
      ...dateWindow,
    });
    requiresAuth = config.siteKey === 'instagram';
  }

  return {
    siteKey: config.siteKey,
    host: config.host,
    action,
    contentType,
    account,
    query,
    ...dateWindow,
    url,
    requiresAccount,
    requiresAuth,
    canRunWithoutAccount: ['followed-users', 'followed-posts-by-date', 'search'].includes(action),
    plannerNotes,
  };
}

function createWaitPolicy(timeoutMs) {
  return {
    useLoadEvent: false,
    useNetworkIdle: false,
    documentReadyTimeoutMs: timeoutMs,
    domQuietTimeoutMs: timeoutMs,
    domQuietMs: 500,
    idleMs: 300,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pageExtractSocialState(config, request) {
  const normalize = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
  const absoluteUrl = (value) => {
    try {
      return new URL(value, window.location.origin).toString();
    } catch {
      return null;
    }
  };
  const all = (selector, root = document) => {
    try {
      return [...root.querySelectorAll(selector)];
    } catch {
      return [];
    }
  };
  const allIncludingRoot = (selector, root = document) => {
    const nodes = all(selector, root);
    try {
      if (root !== document && typeof root?.matches === 'function' && root.matches(selector)) {
        return [root, ...nodes];
      }
    } catch {
      // Selector support varies across sites; fall back to child matches only.
    }
    return nodes;
  };
  const oneText = (selectors, root = document) => {
    for (const selector of selectors) {
      const node = all(selector, root)[0];
      const text = normalize(node?.textContent || node?.getAttribute?.('aria-label') || '');
      if (text) {
        return text;
      }
    }
    return null;
  };
  const pathnameHandle = (href) => {
    try {
      const parsed = new URL(href, window.location.origin);
      const parts = parsed.pathname.split('/').filter(Boolean);
      const first = parts[0] || '';
      if (!first || config.reservedSegments.includes(first.toLowerCase())) {
        return null;
      }
      return first.replace(/^@/u, '');
    } catch {
      return null;
    }
  };
  const mediaFrom = (root) => {
    const nodes = allIncludingRoot(config.contentSelectors.media, root);
    return nodes.map((node) => {
      const src = node.currentSrc || node.src || node.getAttribute('src') || node.getAttribute('poster') || '';
      const poster = node.getAttribute('poster') || '';
      const closestLink = typeof node.closest === 'function'
        ? node.closest(config.contentSelectors.link)
        : null;
      const url = absoluteUrl(src);
      return {
        type: node.tagName.toLowerCase() === 'video' || node.tagName.toLowerCase() === 'source' ? 'video' : 'image',
        url,
        pageUrl: closestLink ? absoluteUrl(closestLink.getAttribute('href') || closestLink.href || '') : null,
        posterUrl: poster ? absoluteUrl(poster) : null,
        alt: normalize(node.getAttribute('alt') || ''),
      };
    }).filter((entry) => entry.url);
  };
  const mediaFromPerformance = () => {
    const entries = typeof performance?.getEntriesByType === 'function'
      ? performance.getEntriesByType('resource')
      : [];
    return entries.map((entry) => {
      const url = absoluteUrl(entry?.name || '');
      if (!url) {
        return null;
      }
      const lowerUrl = url.toLowerCase();
      const initiatorType = normalize(entry?.initiatorType || '');
      const isVideo = initiatorType === 'video'
        || /(^|\.)video\.twimg\.com$/iu.test(new URL(url).hostname)
        || /(?:\.mp4|\.m3u8)(?:[?#]|$)/iu.test(url)
        || /\/(?:ext_tw_video|amplify_video|tweet_video)\//iu.test(url);
      const isImage = initiatorType === 'img'
        || /(?:pbs\.twimg\.com|cdninstagram\.com|fbcdn\.net)/iu.test(url)
        || /\.(?:jpg|jpeg|png|webp|gif)(?:[?#]|$)/iu.test(lowerUrl);
      if (!isVideo && !isImage) {
        return null;
      }
      return {
        type: isVideo ? 'video' : 'image',
        url,
        pageUrl: null,
        posterUrl: null,
        alt: initiatorType ? `resource:${initiatorType}` : 'resource',
      };
    }).filter(Boolean);
  };
  const isDecorativeMedia = (entry = {}) => {
    const url = String(entry.url ?? '').toLowerCase();
    const alt = String(entry.alt ?? '').toLowerCase();
    return /(?:\/profile_images\/|\/profile_banners\/|\/emoji\/)/iu.test(url)
      || /(?:profile picture|square profile picture|avatar|highlight cover|story highlight|头像|个人资料图片|精选快拍)/iu.test(alt);
  };
  const findLink = (root) => {
    const candidates = allIncludingRoot(config.contentSelectors.link, root)
      .map((node) => absoluteUrl(node.getAttribute('href') || node.href || ''))
      .filter(Boolean);
    return candidates[0] || null;
  };
  const findTimestamp = (root) => {
    const node = allIncludingRoot(config.contentSelectors.timestamp, root)[0];
    const datetime = node?.getAttribute?.('datetime') || '';
    return normalize(datetime || node?.textContent || '');
  };
  const itemText = (root) => {
    const specific = allIncludingRoot(config.contentSelectors.text, root)
      .map((node) => normalize(node.textContent || ''))
      .filter(Boolean)
      .sort((left, right) => right.length - left.length)[0];
    return specific || normalize(root.textContent || '');
  };
  const dateMatches = (timestamp) => {
    if (!request.date && !request.fromDate && !request.toDate) {
      return true;
    }
    const text = normalize(timestamp);
    if (!text) {
      return false;
    }
    const isoDate = text.slice(0, 10);
    if (request.date) {
      return isoDate === request.date;
    }
    if (request.fromDate && isoDate < request.fromDate) {
      return false;
    }
    if (request.toDate && isoDate > request.toDate) {
      return false;
    }
    return true;
  };

  const currentProfileLink = all(config.accountSelectors.currentProfileLink)
    .map((node) => node.getAttribute('href') || node.href || '')
    .map(pathnameHandle)
    .find(Boolean) || null;
  const displayName = oneText([config.accountSelectors.displayName]);
  const bio = oneText([config.accountSelectors.bio]);
  const statLinks = all(config.accountSelectors.statLinks).map((node) => ({
    text: normalize(node.textContent || node.getAttribute('aria-label') || ''),
    url: absoluteUrl(node.getAttribute('href') || node.href || ''),
  })).filter((entry) => entry.text || entry.url);
  const parseCompactCount = (text) => {
    const raw = normalize(text);
    const match = raw.match(/([\d,.]+)\s*([KMB万萬千]?)/iu);
    if (!match) {
      return null;
    }
    const numeric = Number(match[1].replace(/,/gu, ''));
    if (!Number.isFinite(numeric)) {
      return null;
    }
    const suffix = match[2]?.toLowerCase?.() || '';
    const multiplier = suffix === 'k' || suffix === '千'
      ? 1_000
      : suffix === 'm'
        ? 1_000_000
        : suffix === 'b'
          ? 1_000_000_000
          : suffix === '万' || suffix === '萬'
            ? 10_000
            : 1;
    return Math.round(numeric * multiplier);
  };
  const relationExpectedCount = (() => {
    if (!['profile-following', 'profile-followers', 'followed-users'].includes(request.action)) {
      return null;
    }
    const relation = request.action === 'profile-followers' ? 'followers' : 'following';
    const relationPatterns = relation === 'followers'
      ? [/followers/iu, /粉丝|粉絲|绮変笣/iu]
      : [/following/iu, /关注|關注|鍏虫敞/iu];
    const candidate = statLinks.find((entry) => {
      const href = String(entry.url || '');
      const text = String(entry.text || '');
      return href.includes(`/${relation}/`) || relationPatterns.some((pattern) => pattern.test(text));
    });
    return candidate ? parseCompactCount(candidate.text) : null;
  })();

  const pageMedia = [...mediaFrom(document), ...mediaFromPerformance()]
    .filter((entry) => !isDecorativeMedia(entry));
  const bodyText = normalize(document.body?.innerText || '').slice(0, 12_000);
  const normalizedPath = String(window.location?.pathname ?? '').toLowerCase();
  const visibilitySignals = [];
  const riskSignals = [];
  if (/private account|this account is private|account is private/iu.test(bodyText)) {
    visibilitySignals.push('private-account');
  }
  if (/sorry, this page isn't available|page doesn't exist|content isn't available|post unavailable|tweet unavailable|this post is unavailable|this account doesn.?t exist/iu.test(bodyText)) {
    visibilitySignals.push('deleted-or-unavailable');
  }
  if (/age[- ]restricted|sensitive content|this media may contain|adult content|restricted content/iu.test(bodyText)) {
    visibilitySignals.push('age-or-region-restricted');
  }
  if (/log in|sign in|login|登入|登录/iu.test(bodyText) && (normalizedPath.includes('/login') || document.querySelector('input[type="password"], input[name="password"]'))) {
    riskSignals.push('login-wall');
  }
  if (/challenge|captcha|verification required|verify (?:it'?s you|your account|your identity)|unusual activity|suspicious activity|机器人|需要验证|安全验证/iu.test(bodyText) || normalizedPath.includes('/challenge')) {
    riskSignals.push('challenge');
  }
  if (/rate limit|too many requests|try again later|temporarily restricted|temporarily unavailable|稍后再试|请求过多/iu.test(bodyText)) {
    riskSignals.push('rate-limited');
  }

  const shouldDeferDateFiltering = config.siteKey === 'instagram'
    && request.action === 'profile-content'
    && (request.date || request.fromDate || request.toDate);

  let rawItems = all(config.contentSelectors.item)
    .map((root) => {
      const url = findLink(root);
      const timestamp = findTimestamp(root);
      return {
        url,
        text: itemText(root),
        timestamp,
        author: request.account || currentProfileLink ? { handle: request.account || currentProfileLink } : null,
        sourceAccount: request.account || currentProfileLink || null,
        media: mediaFrom(root),
      };
    })
    .filter((entry) => {
      if (!(entry.url || entry.text || entry.media.length)) {
        return false;
      }
      return dateMatches(entry.timestamp) || (shouldDeferDateFiltering && entry.url && !entry.timestamp);
    });
  if (
    rawItems.length === 0
    && config.siteKey === 'instagram'
    && request.action === 'profile-content'
    && !request.date
    && !request.fromDate
    && !request.toDate
  ) {
    rawItems = pageMedia
      .filter((entry) => entry.url && !/^resource:/iu.test(entry.alt || ''))
      .map((entry) => ({
        url: entry.pageUrl || entry.url,
        text: entry.alt || '',
        timestamp: '',
        author: request.account || currentProfileLink ? { handle: request.account || currentProfileLink } : null,
        sourceAccount: request.account || currentProfileLink || null,
        media: [entry],
        source: 'media-fallback',
      }))
      .filter((entry) => entry.url || entry.text || entry.media.length);
  }

  const isRelationRequest = ['profile-following', 'profile-followers', 'followed-users'].includes(request.action);
  const relationSelector = config.siteKey === 'instagram' && isRelationRequest
    ? `div[role="dialog"] ${config.accountSelectors.relationLink}`
    : config.siteKey === 'x' && isRelationRequest
      ? `main [data-testid="cellInnerDiv"] ${config.accountSelectors.relationLink}`
      : config.accountSelectors.relationLink;
  const relationAccounts = all(relationSelector)
    .map((node) => {
      const href = node.getAttribute('href') || node.href || '';
      const handle = pathnameHandle(href);
      if (!handle) {
        return null;
      }
      return {
        handle,
        url: absoluteUrl(href),
        label: normalize(node.textContent || node.getAttribute('aria-label') || ''),
      };
    })
    .filter(Boolean);

  return {
    url: window.location.href,
    title: document.title || '',
    currentAccount: currentProfileLink,
    account: {
      handle: request.account || currentProfileLink,
      displayName,
      bio,
      stats: statLinks,
    },
    relationExpectedCount,
    items: rawItems,
    relations: relationAccounts,
    media: pageMedia,
    visibilitySignals: [...new Set(visibilitySignals)],
    riskSignals: [...new Set(riskSignals)],
  };
}

function pageOpenSocialRelationSurface(request) {
  const relation = request.action === 'profile-followers' ? 'followers' : 'following';
  const account = String(request.account || '').replace(/^@/u, '').toLowerCase();
  if (!account) {
    return { clicked: false, relation, reason: 'missing-account' };
  }
  const normalizePath = (href) => {
    try {
      return new URL(href, window.location.origin).pathname.replace(/\/+$/u, '').toLowerCase();
    } catch {
      return '';
    }
  };
  const expectedPath = `/${account}/${relation}`;
  const links = [...document.querySelectorAll('a[href]')];
  const target = links.find((link) => normalizePath(link.getAttribute('href') || link.href || '') === expectedPath)
    || links.find((link) => normalizePath(link.getAttribute('href') || link.href || '').endsWith(`/${relation}`));
  if (!target) {
    return { clicked: false, relation, reason: 'relation-link-not-found', linkCount: links.length };
  }
  target.click();
  return {
    clicked: true,
    relation,
    href: target.getAttribute('href') || target.href || '',
    text: target.textContent || '',
  };
}

function pageScrollToBottom(config = {}, request = {}) {
  const findDialogScroller = () => {
    if (
      config.siteKey !== 'instagram'
      || !['profile-following', 'profile-followers', 'followed-users'].includes(request.action)
    ) {
      return null;
    }
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) {
      return null;
    }
    const candidates = [dialog, ...dialog.querySelectorAll('*')]
      .filter((node) => node.scrollHeight > node.clientHeight + 8)
      .sort((left, right) => (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight));
    return candidates[0] || null;
  };
  const scroller = findDialogScroller();
  if (scroller) {
    const dialog = document.querySelector('div[role="dialog"]');
    const linkCountBefore = dialog ? dialog.querySelectorAll(config.accountSelectors.relationLink).length : 0;
    const candidates = dialog
      ? [dialog, ...dialog.querySelectorAll('*')]
        .filter((node) => node.scrollHeight > node.clientHeight + 8)
        .sort((left, right) => {
          const leftLinks = left.querySelectorAll?.(config.accountSelectors.relationLink).length ?? 0;
          const rightLinks = right.querySelectorAll?.(config.accountSelectors.relationLink).length ?? 0;
          if (leftLinks !== rightLinks) {
            return rightLinks - leftLinks;
          }
          return (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight);
        })
      : [scroller];
    const attempts = candidates.slice(0, 6).map((node, index) => {
      const before = node.scrollTop || 0;
      const step = Math.max(160, Math.round((node.clientHeight || 400) * 0.85));
      const top = Math.min(node.scrollHeight, before + step);
      if (typeof node.scrollTo === 'function') {
        node.scrollTo({ top });
      } else {
        node.scrollTop = top;
      }
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
      node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: step, deltaMode: 0 }));
      return {
        index,
        before,
        after: node.scrollTop || 0,
        height: node.scrollHeight,
        clientHeight: node.clientHeight,
        linkCount: node.querySelectorAll?.(config.accountSelectors.relationLink).length ?? 0,
      };
    });
    const lastRelationLink = dialog ? [...dialog.querySelectorAll(config.accountSelectors.relationLink)].at(-1) : null;
    lastRelationLink?.scrollIntoView?.({ block: 'end', inline: 'nearest' });
    const linkCountAfter = dialog ? dialog.querySelectorAll(config.accountSelectors.relationLink).length : linkCountBefore;
    return {
      target: 'dialog',
      before: attempts[0]?.before ?? scroller.scrollTop,
      after: attempts[0]?.after ?? scroller.scrollTop,
      height: attempts[0]?.height ?? scroller.scrollHeight,
      changed: attempts.some((attempt) => attempt.after !== attempt.before),
      linkCountBefore,
      linkCountAfter,
      attempts,
    };
  }
  const before = window.scrollY;
  window.scrollTo(0, document.documentElement.scrollHeight || document.body.scrollHeight || 0);
  return {
    target: 'window',
    before,
    after: window.scrollY,
    height: document.documentElement.scrollHeight || document.body.scrollHeight || 0,
  };
}

function mergeByKey(items, keyFn, maxItems) {
  const seen = new Set();
  const merged = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
    if (merged.length >= maxItems) {
      break;
    }
  }
  return merged;
}

function dedupeSortedStrings(values = []) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function isSocialRelationAction(action) {
  return ['profile-following', 'profile-followers', 'followed-users'].includes(String(action ?? ''));
}

function pickRuntimeRiskSignal(signals = []) {
  const normalized = new Set((Array.isArray(signals) ? signals : []).map((signal) => String(signal ?? '').trim()).filter(Boolean));
  if (normalized.has('challenge')) {
    return 'challenge';
  }
  if (normalized.has('login-wall')) {
    return 'login-wall';
  }
  if (normalized.has('rate-limited')) {
    return 'rate-limited';
  }
  return null;
}

function runtimeRiskToStopReason(signal) {
  if (signal === 'challenge') {
    return 'challenge';
  }
  if (signal === 'login-wall') {
    return 'login-wall';
  }
  if (signal === 'rate-limited') {
    return 'rate-limited';
  }
  return null;
}

function isRetryableRuntimeRisk(signal) {
  return signal === 'rate-limited';
}

function riskBackoffDelayMs(settings, retryIndex) {
  const baseMs = Math.max(0, Number(settings?.riskBackoffMs) || 0);
  if (baseMs <= 0) {
    return 0;
  }
  return Math.min(120_000, baseMs * (2 ** Math.max(0, retryIndex)));
}

function adaptiveRiskBackoffDelayMs(settings, retryIndex, consecutiveRateLimits = 0, retryAfterMs = null) {
  const baseMs = riskBackoffDelayMs(settings, retryIndex);
  const throttleLevel = Math.max(0, Number(consecutiveRateLimits) || 0);
  const adaptiveMs = baseMs > 0 ? Math.min(120_000, baseMs * (2 ** Math.max(0, throttleLevel - 1))) : 0;
  return Math.min(120_000, Math.max(adaptiveMs, retryAfterMs ?? 0));
}

function hasItemAuthor(item = {}) {
  return Boolean(
    item.sourceAccount
    || item.author?.handle
    || item.author?.url
    || item.authorName
    || item.username
    || item.owner?.username
    || item.user?.username,
  );
}

function summarizeJsonShape(value, prefix = '$', paths = [], depth = 0) {
  if (paths.length >= API_CAPTURE_SHAPE_PATH_LIMIT || depth > 5) {
    return paths;
  }
  if (Array.isArray(value)) {
    paths.push(`${prefix}:array(${value.length})`);
    if (value.length > 0) {
      summarizeJsonShape(value[0], `${prefix}[]`, paths, depth + 1);
    }
    return paths;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).slice(0, 40).sort();
    paths.push(`${prefix}:object(${keys.join(',')})`);
    for (const key of keys) {
      if (paths.length >= API_CAPTURE_SHAPE_PATH_LIMIT) {
        break;
      }
      summarizeJsonShape(value[key], `${prefix}.${key}`, paths, depth + 1);
    }
    return paths;
  }
  paths.push(`${prefix}:${value === null ? 'null' : typeof value}`);
  return paths;
}

function redactApiPayload(value, depth = 0) {
  if (depth > 6) {
    return '<truncated-depth>';
  }
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((entry) => redactApiPayload(entry, depth + 1));
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      return value.length > 500 ? `${value.slice(0, 500)}...<truncated>` : value;
    }
    return value;
  }
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 80)) {
    if (/(?:token|cookie|authorization|csrf|password|email|phone|bearer|session|claim)/iu.test(key)) {
      output[key] = '<redacted>';
      continue;
    }
    output[key] = redactApiPayload(item, depth + 1);
  }
  return output;
}

function apiPayloadSample(json) {
  const redacted = redactApiPayload(json);
  const serialized = JSON.stringify(redacted);
  if (serialized.length <= API_CAPTURE_PAYLOAD_SAMPLE_LIMIT) {
    return redacted;
  }
  return {
    truncated: true,
    json: serialized.slice(0, API_CAPTURE_PAYLOAD_SAMPLE_LIMIT),
  };
}

function summarizeParsedApiResponse(response, parsed, config, plan) {
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const media = items.flatMap((item) => item.media || []);
  const missingTimestampCount = items.filter((item) => !item.timestamp).length;
  const missingAuthorCount = items.filter((item) => !hasItemAuthor(item)).length;
  const riskSignals = dedupeSortedStrings([
    ...(parsed?.riskSignals ?? []),
    ...detectApiPayloadRisk(response.json, response.status),
  ]);
  return {
    url: response.url,
    status: response.status ?? null,
    responseHeaders: response.responseHeaders ?? {},
    mimeType: response.mimeType || null,
    type: response.type || null,
    operationName: response.request?.operationName ?? null,
    itemCount: items.length,
    mediaCount: media.length,
    hasNextCursor: Boolean(parsed?.nextCursor),
    riskSignals,
    reason: apiRiskReasonFromSignals(riskSignals, response.status),
    missingTimestampCount,
    missingAuthorCount,
    score: scoreSocialApiSeed({ response, parsed }, config, plan),
    jsonShape: summarizeJsonShape(response.json).slice(0, API_CAPTURE_SHAPE_PATH_LIMIT),
  };
}

async function collectSocialPage(session, config, plan, settings) {
  const maxItems = settings.maxItems;
  const maxScrolls = settings.maxScrolls;
  const collectedStates = [];
  let stagnantRounds = 0;
  let previousItemCount = 0;
  let previousRelationCount = 0;
  let scrollSummary = [];
  const visibilitySignals = [];
  const riskSignals = [];
  const riskEvents = [];
  let riskRetryCount = 0;
  let stopReason = null;
  let relationExpectedCount = null;

  for (let round = 0; round <= maxScrolls; round += 1) {
    const state = await session.callPageFunction(pageExtractSocialState, config, {
      account: plan.account,
      action: plan.action,
      contentType: plan.contentType,
      date: plan.date,
      fromDate: plan.fromDate,
      toDate: plan.toDate,
    });
    collectedStates.push(state);
    if (state?.relationExpectedCount !== null && state?.relationExpectedCount !== undefined && Number.isFinite(Number(state.relationExpectedCount)) && Number(state.relationExpectedCount) >= 0) {
      relationExpectedCount = Math.max(relationExpectedCount ?? 0, Number(state.relationExpectedCount));
    }
    visibilitySignals.push(...(Array.isArray(state?.visibilitySignals) ? state.visibilitySignals : []));
    riskSignals.push(...(Array.isArray(state?.riskSignals) ? state.riskSignals : []));
    const runtimeRiskSignal = pickRuntimeRiskSignal(state?.riskSignals || []);
    if (runtimeRiskSignal) {
      const retryable = isRetryableRuntimeRisk(runtimeRiskSignal) && riskRetryCount < settings.riskRetries;
      const waitMs = retryable ? riskBackoffDelayMs(settings, riskRetryCount) : 0;
      riskEvents.push({
        round,
        signal: runtimeRiskSignal,
        retryable,
        retry: retryable ? riskRetryCount + 1 : riskRetryCount,
        waitMs,
        finalUrl: state?.url ?? null,
      });
      if (retryable) {
        riskRetryCount += 1;
        if (waitMs > 0) {
          await sleep(waitMs);
        }
        continue;
      }
      stopReason = runtimeRiskToStopReason(runtimeRiskSignal);
      break;
    }

    const items = mergeByKey(collectedStates.flatMap((entry) => entry.items || []), (entry) => entry.url || entry.text, maxItems);
    const relations = mergeByKey(collectedStates.flatMap((entry) => entry.relations || []), (entry) => entry.handle || entry.url, maxItems);
    const relationTargetReached = Number.isFinite(relationExpectedCount)
      && relations.length >= relationExpectedCount;
    if (items.length >= maxItems || relations.length >= maxItems || relationTargetReached) {
      break;
    }
    if (round === maxScrolls) {
      break;
    }
    if (items.length === previousItemCount && relations.length === previousRelationCount) {
      stagnantRounds += 1;
    } else {
      stagnantRounds = 0;
    }
    const stagnantLimit = isSocialRelationAction(plan.action) && Number.isFinite(relationExpectedCount) && relations.length < relationExpectedCount
      ? 8
      : 3;
    if (stagnantRounds >= stagnantLimit) {
      break;
    }
    previousItemCount = items.length;
    previousRelationCount = relations.length;
    const scrollResult = await session.callPageFunction(pageScrollToBottom, config, {
      account: plan.account,
      action: plan.action,
      contentType: plan.contentType,
      date: plan.date,
      fromDate: plan.fromDate,
      toDate: plan.toDate,
    });
    if (config.siteKey === 'instagram' && isSocialRelationAction(plan.action) && typeof session?.send === 'function') {
      try {
        await session.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: 720,
          y: 520,
          deltaX: 0,
          deltaY: 720,
        });
        scrollResult.cdpWheel = true;
      } catch {
        scrollResult.cdpWheel = false;
      }
    }
    scrollSummary.push(scrollResult);
    await sleep(settings.scrollWaitMs);
  }

  const latest = collectedStates[collectedStates.length - 1] || {};
  const allItems = collectedStates.flatMap((entry) => entry.items || []);
  const allRelations = collectedStates.flatMap((entry) => entry.relations || []);
  const allMedia = collectedStates.flatMap((entry) => entry.media || []);
  const mergedRelations = mergeByKey(allRelations, (entry) => entry.handle || entry.url, maxItems);
  const hasRelationExpectedCount = Number.isFinite(relationExpectedCount);
  const relationArchive = isSocialRelationAction(plan.action)
    ? {
      strategy: 'dom-relation-scroll',
      complete: hasRelationExpectedCount
        ? mergedRelations.length >= relationExpectedCount
        : mergedRelations.length > 0
          ? null
          : false,
      reason: hasRelationExpectedCount
        ? mergedRelations.length >= relationExpectedCount
          ? null
          : 'relation-expected-count-mismatch'
        : mergedRelations.length > 0
          ? 'relation-count-unverified'
          : 'relation-surface-empty',
      pages: 0,
      expectedRelationCount: hasRelationExpectedCount ? relationExpectedCount : null,
      domRelationCount: mergedRelations.length,
      domItemCount: 0,
      apiItemCount: 0,
      dedupedItemCount: mergedRelations.length,
      boundarySignals: [],
    }
    : null;
  return {
    finalUrl: latest.url || null,
    title: latest.title || null,
    currentAccount: latest.currentAccount || null,
    account: latest.account || null,
    items: mergeByKey(allItems, (entry) => entry.url || entry.text, maxItems),
    relations: mergedRelations,
    media: mergeByKey(allMedia, (entry) => `${entry.type}:${entry.url}`, maxItems * 5),
    relationExpectedCount: Number.isFinite(relationExpectedCount) ? relationExpectedCount : null,
    archive: relationArchive,
    scrollSummary,
    visibilitySignals: dedupeSortedStrings(visibilitySignals),
    riskSignals: dedupeSortedStrings(riskSignals),
    riskEvents,
    stopReason,
  };
}

function isSocialApiUrl(config, url) {
  const value = String(url ?? '');
  if (config.siteKey === 'x') {
    return /(?:\/i\/api\/(?:graphql|2\/search)\/|\/graphql\/)/iu.test(value);
  }
  if (config.siteKey === 'instagram') {
    return /(?:\/graphql\/query|\/api\/v1\/(?:feed|friendships|media|users|clips)|\/api\/graphql)/iu.test(value);
  }
  return false;
}

const SENSITIVE_API_HEADER_RE = /^(?:authorization|cookie|set-cookie|x-csrf-token|x-ig-www-claim|x-instagram-ajax)$/iu;
const FORBIDDEN_FETCH_HEADER_RE = /^(?:accept-encoding|connection|content-length|cookie|host|origin|referer|sec-|user-agent|priority)$/iu;
const REPLAY_FETCH_HEADER_RE = /^(?:accept|authorization|content-type|x-[a-z0-9-]+)$/iu;
const API_DEBUG_HEADER_RE = /^(?:retry-after|x-rate-limit-|x-app-limit|x-business-use-case-usage|x-ig-|x-fb-|x-twitter-|cf-|content-type|date)$/iu;

function normalizeHeaderEntries(headers = {}) {
  return Object.entries(headers || {})
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => [String(name).toLowerCase(), String(value)]);
}

function truncateHeaderValue(value) {
  const text = String(value ?? '');
  return text.length > 240 ? `${text.slice(0, 240)}...<truncated>` : text;
}

function sanitizeApiDebugHeaders(headers = {}) {
  const result = {};
  for (const [name, value] of normalizeHeaderEntries(headers)) {
    if (!API_DEBUG_HEADER_RE.test(name)) {
      continue;
    }
    result[name] = truncateHeaderValue(value);
  }
  return result;
}

function parseJsonSearchParam(params, name) {
  const value = params.get(name);
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseApiRequestDetails(url, postData = '') {
  const details = {
    operationName: null,
    queryParams: {},
    variables: null,
    features: null,
    fieldToggles: null,
    body: null,
  };
  try {
    const parsed = new URL(String(url ?? ''));
    const segments = parsed.pathname.split('/').filter(Boolean);
    details.operationName = segments[segments.length - 1] || null;
    for (const key of ['q', 'query_hash', 'doc_id', 'cursor', 'after', 'max_id', 'count']) {
      if (parsed.searchParams.has(key)) {
        details.queryParams[key] = parsed.searchParams.get(key);
      }
    }
    details.variables = parseJsonSearchParam(parsed.searchParams, 'variables');
    details.features = parseJsonSearchParam(parsed.searchParams, 'features');
    details.fieldToggles = parseJsonSearchParam(parsed.searchParams, 'fieldToggles');
  } catch {
    // Keep the partial template; malformed URLs are not expected from CDP.
  }
  if (postData) {
    try {
      details.body = JSON.parse(postData);
    } catch {
      details.body = String(postData).slice(0, 4_096);
    }
  }
  return details;
}

export function sanitizeSocialApiRequestTemplate(request = {}) {
  const headerEntries = normalizeHeaderEntries(request.headers);
  const headers = Object.fromEntries(headerEntries.map(([name, value]) => [
    name,
    SENSITIVE_API_HEADER_RE.test(name) ? '<redacted>' : truncateHeaderValue(value),
  ]));
  return {
    url: request.url || null,
    method: request.method || 'GET',
    resourceType: request.resourceType || null,
    headers,
    headerNames: headerEntries.map(([name]) => name).sort(),
    ...parseApiRequestDetails(request.url, request.postData),
  };
}

function buildBrowserReplayHeaders(request = {}) {
  const headers = {};
  for (const [name, value] of normalizeHeaderEntries(request.headers)) {
    if (FORBIDDEN_FETCH_HEADER_RE.test(name) || !REPLAY_FETCH_HEADER_RE.test(name)) {
      continue;
    }
    headers[name] = value;
  }
  if (!headers.accept) {
    headers.accept = 'application/json, text/plain, */*';
  }
  return headers;
}

function buildSocialApiReplayRequest(request = {}) {
  return {
    url: request.url || null,
    method: request.method || 'GET',
    headers: buildBrowserReplayHeaders(request),
    body: request.postData || null,
  };
}

async function createSocialApiCapture(session, config, settings) {
  if (typeof session?.send !== 'function' || !session?.client?.on) {
    return null;
  }
  const responses = [];
  const candidates = new Map();
  const requests = new Map();
  const pendingBodies = new Set();
  const errors = [];
  const stats = {
    requests: 0,
    responses: 0,
    capturedBodies: 0,
    bodyErrors: 0,
  };
  await session.send('Network.enable', {
    maxTotalBufferSize: 50_000_000,
    maxResourceBufferSize: 10_000_000,
  }, settings.timeoutMs);
  try {
    await session.send('Network.setCacheDisabled', { cacheDisabled: true }, settings.timeoutMs);
    await session.send('Network.setBypassServiceWorker', { bypass: true }, settings.timeoutMs);
  } catch {
    // Cache and service-worker bypass are best-effort; capture still works without them.
  }
  const offRequest = session.client.on('Network.requestWillBeSent', ({ params }) => {
    const request = params?.request;
    const url = request?.url || '';
    if (!params?.requestId || !isSocialApiUrl(config, url)) {
      return;
    }
    stats.requests += 1;
    requests.set(params.requestId, {
      url,
      method: request?.method || 'GET',
      headers: request?.headers || {},
      postData: request?.postData || '',
      resourceType: params?.type || '',
    });
  }, { sessionId: session.sessionId });
  const offRequestExtra = session.client.on('Network.requestWillBeSentExtraInfo', ({ params }) => {
    if (!params?.requestId || !requests.has(params.requestId)) {
      return;
    }
    const request = requests.get(params.requestId);
    requests.set(params.requestId, {
      ...request,
      headers: {
        ...(request.headers || {}),
        ...(params.headers || {}),
      },
    });
  }, { sessionId: session.sessionId });
  const offResponse = session.client.on('Network.responseReceived', ({ params }) => {
    const url = params?.response?.url || '';
    if (!params?.requestId || !isSocialApiUrl(config, url)) {
      return;
    }
    stats.responses += 1;
    const request = requests.get(params.requestId) || { url };
    candidates.set(params.requestId, {
      url,
      status: params.response?.status ?? null,
      statusText: params.response?.statusText ?? '',
      mimeType: params.response?.mimeType ?? '',
      type: params.type ?? '',
      responseHeaders: sanitizeApiDebugHeaders(params.response?.headers || {}),
      request: sanitizeSocialApiRequestTemplate(request),
      replayHeaders: buildBrowserReplayHeaders(request),
      replayRequest: buildSocialApiReplayRequest(request),
    });
  }, { sessionId: session.sessionId });
  const offFinished = session.client.on('Network.loadingFinished', ({ params }) => {
    const candidate = candidates.get(params?.requestId);
    if (!candidate) {
      return;
    }
    candidates.delete(params.requestId);
    const readBodyPromise = (async () => {
      try {
        const body = await session.send('Network.getResponseBody', { requestId: params.requestId }, Math.min(settings.timeoutMs, 30_000));
        const text = body?.base64Encoded
          ? Buffer.from(body.body || '', 'base64').toString('utf8')
          : String(body?.body ?? '');
        if (!text.trim()) {
          return;
        }
        const json = JSON.parse(text);
        responses.push({
          ...candidate,
          capturedAt: new Date().toISOString(),
          json,
        });
        stats.capturedBodies += 1;
      } catch (error) {
        stats.bodyErrors += 1;
        errors.push({
          url: candidate.url,
          status: candidate.status,
          mimeType: candidate.mimeType || null,
          responseHeaders: candidate.responseHeaders || {},
          operationName: candidate.request?.operationName ?? null,
          capturedAt: new Date().toISOString(),
          error: error?.message ?? String(error),
        });
        // API capture is opportunistic; page extraction remains the fallback.
      } finally {
        requests.delete(params.requestId);
      }
    })();
    pendingBodies.add(readBodyPromise);
    readBodyPromise.finally(() => {
      pendingBodies.delete(readBodyPromise);
    });
  }, { sessionId: session.sessionId });
  return {
    responses,
    errors,
    stats,
    mark() {
      return responses.length;
    },
    async flush(timeoutMs = 1_500) {
      if (pendingBodies.size === 0) {
        return {
          pending: 0,
          responses: responses.length,
          errors: errors.length,
        };
      }
      const pending = [...pendingBodies];
      await Promise.race([
        Promise.allSettled(pending),
        sleep(Math.max(0, timeoutMs)),
      ]);
      return {
        pending: pendingBodies.size,
        responses: responses.length,
        errors: errors.length,
      };
    },
    dispose() {
      offRequest();
      offRequestExtra();
      offResponse();
      offFinished();
    },
  };
}

function collectRecursive(value, visitor, seen = new Set()) {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);
  visitor(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRecursive(item, visitor, seen);
    }
    return;
  }
  for (const item of Object.values(value)) {
    collectRecursive(item, visitor, seen);
  }
}

function normalizeXCreatedAt(value) {
  const parsed = new Date(String(value ?? ''));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dimensionsScore(entry = {}) {
  return finiteNumber(entry.width) * finiteNumber(entry.height);
}

function selectBestImageCandidate(candidates = []) {
  return (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate?.url)
    .sort((left, right) => dimensionsScore(right) - dimensionsScore(left))[0] ?? null;
}

function selectBestVideoCandidate(candidates = []) {
  return (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate?.url)
    .sort((left, right) => {
      const bitrateDelta = finiteNumber(right?.bitrate) - finiteNumber(left?.bitrate);
      if (bitrateDelta !== 0) {
        return bitrateDelta;
      }
      return dimensionsScore(right) - dimensionsScore(left);
    })[0] ?? null;
}

function dedupeMediaEntries(media = []) {
  return mergeByKey(
    (Array.isArray(media) ? media : []).filter((entry) => entry?.url),
    (entry) => `${entry.type}:${entry.url}`,
    Number.MAX_SAFE_INTEGER,
  );
}

function normalizeXImageUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }
  try {
    const parsed = new URL(raw);
    if (/pbs\.twimg\.com$/iu.test(parsed.hostname) && !parsed.searchParams.has('name')) {
      const ext = path.extname(parsed.pathname).replace(/^\./u, '').toLowerCase();
      if (ext && !parsed.searchParams.has('format')) {
        parsed.searchParams.set('format', ext === 'jpeg' ? 'jpg' : ext);
      }
      parsed.searchParams.set('name', 'orig');
      return parsed.toString();
    }
  } catch {
    // Keep the original URL if it cannot be parsed.
  }
  return raw;
}

function parseDimensionsFromUrl(value) {
  const match = String(value ?? '').match(/\/(\d{2,5})x(\d{2,5})\//u);
  if (!match) {
    return {
      width: null,
      height: null,
    };
  }
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function parseXMedia(legacy = {}) {
  const media = legacy.extended_entities?.media || legacy.entities?.media || [];
  return (Array.isArray(media) ? media : []).flatMap((entry) => {
    const imageUrl = normalizeXImageUrl(entry?.media_url_https || entry?.media_url || '');
    const variants = entry?.video_info?.variants || [];
    const video = Array.isArray(variants)
      ? selectBestVideoCandidate(variants.filter((variant) => /video\/mp4/iu.test(String(variant?.content_type ?? ''))))
      : null;
    if (video?.url) {
      const dimensions = parseDimensionsFromUrl(video.url);
      return [{
        type: 'video',
        url: video.url,
        posterUrl: imageUrl || null,
        alt: entry?.ext_alt_text || '',
        bitrate: finiteNumber(video.bitrate, null),
        width: dimensions.width,
        height: dimensions.height,
        durationMillis: finiteNumber(entry?.video_info?.duration_millis, null),
        variants: variants
          .filter((variant) => /video\/mp4/iu.test(String(variant?.content_type ?? '')) && variant?.url)
          .map((variant) => ({
            ...parseDimensionsFromUrl(variant.url),
            url: variant.url,
            bitrate: finiteNumber(variant.bitrate, null),
            contentType: variant.content_type || null,
          }))
          .sort((left, right) => {
            const bitrateDelta = finiteNumber(right.bitrate) - finiteNumber(left.bitrate);
            if (bitrateDelta !== 0) {
              return bitrateDelta;
            }
            return dimensionsScore(right) - dimensionsScore(left);
          }),
      }];
    }
    if (imageUrl) {
      return [{
        type: 'image',
        url: imageUrl,
        posterUrl: null,
        alt: entry?.ext_alt_text || '',
      }];
    }
    return [];
  });
}

function normalizeXTweetResult(result) {
  const tweet = result?.tweet || result;
  const legacy = tweet?.legacy;
  const restId = tweet?.rest_id || legacy?.id_str;
  if (!legacy || !restId) {
    return null;
  }
  const screenName = tweet?.core?.user_results?.result?.legacy?.screen_name
    || tweet?.core?.user_results?.result?.core?.screen_name
    || tweet?.core?.user_results?.result?.screen_name
    || null;
  return {
    id: restId,
    url: screenName ? `https://x.com/${screenName}/status/${restId}` : `https://x.com/i/status/${restId}`,
    text: cleanText(legacy.full_text || legacy.text || ''),
    timestamp: normalizeXCreatedAt(legacy.created_at),
    author: screenName ? { handle: screenName, url: `https://x.com/${screenName}` } : null,
    sourceAccount: screenName || null,
    isRetweet: Boolean(legacy.retweeted_status_result || legacy.retweeted_status_id_str || legacy.retweeted_status_id),
    media: parseXMedia(legacy),
    source: 'api-cursor',
  };
}

function normalizeXUserResult(result) {
  const user = result?.user || result;
  const legacy = user?.legacy;
  const handle = cleanText(
    legacy?.screen_name
    || user?.core?.screen_name
    || user?.screen_name
    || '',
  );
  if (!handle) {
    return null;
  }
  return {
    handle,
    id: user?.rest_id || legacy?.id_str || null,
    url: `https://x.com/${handle}`,
    label: cleanText(legacy?.name || user?.core?.name || ''),
    displayName: cleanText(legacy?.name || user?.core?.name || '') || null,
    bio: cleanText(legacy?.description || ''),
    followers: finiteNumber(legacy?.followers_count, null),
    following: finiteNumber(legacy?.friends_count, null),
    verified: Boolean(legacy?.verified || user?.is_blue_verified),
    source: 'api-relation',
  };
}

function collectXRelationEntries(json) {
  const users = [];
  const cursors = [];
  collectRecursive(json, (node) => {
    const cursor = xCursorFromTimelineContent(node, node?.entryId || node?.entry_id);
    if (cursor) {
      cursors.push(cursor);
    }
    const candidates = [
      node?.itemContent?.user_results?.result,
      node?.user_results?.result,
      node?.userResult?.result,
      node?.__typename === 'User' || node?.legacy?.screen_name ? node : null,
    ].filter(Boolean);
    for (const candidate of candidates) {
      const user = normalizeXUserResult(candidate);
      if (user) {
        users.push(user);
      }
    }
  });
  return {
    users: mergeByKey(users, (entry) => entry.handle?.toLowerCase() || entry.url, Number.MAX_SAFE_INTEGER),
    nextCursor: cursors[cursors.length - 1] || null,
  };
}

function isXRelationApiUrl(url, action) {
  const value = String(url ?? '');
  return action === 'profile-followers'
    ? /\/i\/api\/graphql\/[^/]+\/Followers\?/u.test(value)
    : /\/i\/api\/graphql\/[^/]+\/Following\?/u.test(value);
}

function xCursorFromTimelineContent(content = {}, entryId = '') {
  const cursorType = String(content?.cursorType ?? content?.cursor_type ?? '').toLowerCase();
  const value = content?.value;
  if (!value) {
    return null;
  }
  const normalizedEntryId = String(entryId || content?.entryId || '').toLowerCase();
  if (cursorType === 'bottom' || cursorType === 'showmorethreads' || /cursor-bottom|cursor-showmorethreads/iu.test(normalizedEntryId)) {
    return String(value);
  }
  return null;
}

function xTweetResultFromItemContent(itemContent = {}) {
  return itemContent?.tweet_results?.result
    || itemContent?.tweetResult?.result
    || itemContent?.tweet?.result
    || null;
}

function collectXTimelineEntries(json) {
  const items = [];
  const cursors = [];
  collectRecursive(json, (node) => {
    if (!Array.isArray(node?.instructions)) {
      return;
    }
    for (const instruction of node.instructions) {
      const entries = [
        ...(Array.isArray(instruction?.entries) ? instruction.entries : []),
        instruction?.entry ? instruction.entry : null,
      ].filter(Boolean);
      for (const entry of entries) {
        const entryId = String(entry?.entryId ?? entry?.entry_id ?? '');
        const content = entry?.content || {};
        const cursor = xCursorFromTimelineContent(content, entryId);
        if (cursor) {
          cursors.push(cursor);
        }
        const directItem = normalizeXTweetResult(xTweetResultFromItemContent(content?.itemContent || content));
        if (directItem) {
          items.push(directItem);
          continue;
        }
        const moduleItems = Array.isArray(content?.items) ? content.items : [];
        for (const moduleItem of moduleItems) {
          const item = moduleItem?.item || moduleItem;
          const moduleCursor = xCursorFromTimelineContent(item?.content || {}, item?.entryId || item?.entry_id || entryId);
          if (moduleCursor) {
            cursors.push(moduleCursor);
          }
          const moduleTweet = normalizeXTweetResult(xTweetResultFromItemContent(item?.itemContent || item?.content?.itemContent || item?.content || item));
          if (moduleTweet) {
            items.push(moduleTweet);
          }
        }
      }
    }
  });
  return {
    items,
    cursors,
  };
}

function instagramTimestampFromNode(node = {}) {
  const value = node?.taken_at_timestamp ?? node?.taken_at ?? node?.caption?.created_at ?? node?.device_timestamp ?? null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '';
  }
  const millis = numeric > 100_000_000_000_000
    ? numeric / 1000
    : numeric > 10_000_000_000
      ? numeric
      : numeric * 1000;
  const parsed = new Date(millis);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
}

function instagramDurationMillisFromNode(node = {}) {
  const candidates = [
    node?.video_duration,
    node?.videoDuration,
    node?.clips_metadata?.original_sound_info?.duration_in_ms,
    node?.clips_metadata?.music_info?.music_asset_info?.duration_in_ms,
  ];
  for (const value of candidates) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      continue;
    }
    return numeric > 10_000 ? Math.round(numeric) : Math.round(numeric * 1000);
  }
  return null;
}

function instagramAuthorFromNode(node = {}) {
  const user = node?.owner || node?.user || node?.caption?.user || node?.user_info || {};
  const handle = cleanText(user?.username || user?.handle || node?.owner_username || '');
  const id = user?.id ?? user?.pk ?? node?.owner_id ?? null;
  if (!handle && !id) {
    return null;
  }
  return {
    handle: handle || null,
    id: id !== null && id !== undefined ? String(id) : null,
    displayName: cleanText(user?.full_name || user?.fullName || user?.name || '') || null,
    url: handle ? `https://www.instagram.com/${handle}/` : null,
  };
}

function instagramPermalinkPath(node = {}) {
  const productType = String(node?.product_type ?? node?.media_product_type ?? '').toLowerCase();
  if (productType === 'clips' || node?.clips_metadata || node?.is_dash_eligible === true) {
    return 'reel';
  }
  return 'p';
}

function appendInstagramNodeMedia(media, node, captionText, mediaIndex = null) {
  const image = node?.display_url
    || node?.thumbnail_src
    || selectBestImageCandidate(node?.image_versions2?.candidates)?.url
    || selectBestImageCandidate(node?.image_versions?.candidates)?.url
    || '';
  const imageCandidate = selectBestImageCandidate([
    ...(Array.isArray(node?.image_versions2?.candidates) ? node.image_versions2.candidates : []),
    ...(Array.isArray(node?.image_versions?.candidates) ? node.image_versions.candidates : []),
    image ? { url: image } : null,
  ].filter(Boolean));
  const videoVariants = [
    ...(Array.isArray(node?.video_versions) ? node.video_versions : []),
    node?.video_url ? { url: node.video_url } : null,
  ].filter(Boolean)
    .filter((candidate) => candidate?.url)
    .map((candidate) => ({
      url: candidate.url,
      width: finiteNumber(candidate.width, null),
      height: finiteNumber(candidate.height, null),
      bitrate: finiteNumber(candidate.bitrate, null),
      contentType: candidate.type || candidate.content_type || 'video/mp4',
    }))
    .sort((left, right) => {
      const bitrateDelta = finiteNumber(right.bitrate) - finiteNumber(left.bitrate);
      if (bitrateDelta !== 0) {
        return bitrateDelta;
      }
      return dimensionsScore(right) - dimensionsScore(left);
    });
  const videoCandidate = selectBestVideoCandidate(videoVariants);

  if (videoCandidate?.url) {
    media.push({
      type: 'video',
      url: videoCandidate.url,
      posterUrl: imageCandidate?.url || image || null,
      alt: cleanText(captionText),
      width: finiteNumber(videoCandidate.width, null),
      height: finiteNumber(videoCandidate.height, null),
      bitrate: finiteNumber(videoCandidate.bitrate, null),
      durationMillis: instagramDurationMillisFromNode(node),
      variants: videoVariants,
      mediaIndex,
    });
    return;
  }
  if (imageCandidate?.url) {
    media.push({
      type: 'image',
      url: imageCandidate.url,
      posterUrl: null,
      alt: cleanText(captionText),
      width: finiteNumber(imageCandidate.width, null),
      height: finiteNumber(imageCandidate.height, null),
      mediaIndex,
    });
  }
}

function parseInstagramMediaNode(node) {
  const wrapped = node?.media || node?.media_or_ad || node?.clip?.media || null;
  if (wrapped && typeof wrapped === 'object' && wrapped !== node) {
    const wrappedItem = parseInstagramMediaNode({
      ...wrapped,
      user: wrapped.user || node.user,
      owner: wrapped.owner || node.owner,
      caption: wrapped.caption || node.caption,
    });
    if (wrappedItem) {
      return wrappedItem;
    }
  }
  const code = node?.shortcode || node?.code;
  const id = node?.id || node?.pk;
  const hasStandaloneMediaShape = Boolean(
    code
    || node?.caption
    || node?.edge_media_to_caption
    || node?.taken_at_timestamp
    || node?.taken_at
    || node?.carousel_media
    || node?.edge_sidecar_to_children
    || node?.media_type
    || node?.product_type
  );
  if ((!code && !id) || !hasStandaloneMediaShape) {
    return null;
  }
  const captionText = node?.edge_media_to_caption?.edges?.[0]?.node?.text
    || (node?.caption && typeof node.caption === 'object' ? node.caption.text : node?.caption)
    || '';
  const timestamp = instagramTimestampFromNode(node);
  const media = [];
  const children = node?.edge_sidecar_to_children?.edges || node?.carousel_media || [];
  const childNodes = Array.isArray(children) ? children : [];
  if (childNodes.length === 0) {
    appendInstagramNodeMedia(media, node, captionText, 0);
  }
  for (const [index, child] of childNodes.entries()) {
    const childNode = child?.node || child;
    appendInstagramNodeMedia(media, childNode, captionText, index + 1);
  }
  const author = instagramAuthorFromNode(node);
  return {
    id: id || code,
    url: code ? `https://www.instagram.com/${instagramPermalinkPath(node)}/${code}/` : null,
    text: cleanText(captionText),
    timestamp,
    author,
    sourceAccount: author?.handle ?? null,
    productType: node?.product_type ?? node?.media_product_type ?? null,
    media: dedupeMediaEntries(media),
    source: 'api-cursor',
  };
}

function isInstagramFeedUserPayload(json) {
  return Boolean(json && typeof json === 'object' && Array.isArray(json.items) && (
    Object.prototype.hasOwnProperty.call(json, 'more_available')
    || Object.prototype.hasOwnProperty.call(json, 'next_max_id')
    || Object.prototype.hasOwnProperty.call(json, 'num_results')
    || Object.prototype.hasOwnProperty.call(json, 'paging_info')
    || Object.prototype.hasOwnProperty.call(json, 'pagination')
  ));
}

function collectInstagramPaginationCursors(json, cursors) {
  collectRecursive(json, (node) => {
    const pageInfo = node?.page_info || node?.pageInfo;
    if (pageInfo?.has_next_page && pageInfo?.end_cursor) {
      cursors.push(String(pageInfo.end_cursor));
    }
    if (node?.more_available && node?.next_max_id) {
      cursors.push(String(node.next_max_id));
    }
    if (node?.more_available && node?.paging_info?.max_id) {
      cursors.push(String(node.paging_info.max_id));
    }
    if (node?.paging_info?.max_id) {
      cursors.push(String(node.paging_info.max_id));
    }
    if (node?.pagination?.next_max_id) {
      cursors.push(String(node.pagination.next_max_id));
    }
  });
}

export function parseSocialApiPayload(site, json) {
  const config = resolveSocialSiteConfig(site);
  const items = [];
  const cursors = [];
  if (config.siteKey === 'x') {
    const timeline = collectXTimelineEntries(json);
    items.push(...timeline.items);
    cursors.push(...timeline.cursors);
    if (items.length === 0) {
      collectRecursive(json, (node) => {
        if (node?.tweet_results?.result) {
          const item = normalizeXTweetResult(node.tweet_results.result);
          if (item) {
            items.push(item);
          }
        } else if (node?.tweetResult?.result) {
          const item = normalizeXTweetResult(node.tweetResult.result);
          if (item) {
            items.push(item);
          }
        } else if (node?.legacy?.full_text && (node?.rest_id || node?.legacy?.id_str)) {
          const item = normalizeXTweetResult(node);
          if (item) {
            items.push(item);
          }
        }
        const cursor = xCursorFromTimelineContent(node, node?.entryId);
        if (cursor) {
          cursors.push(cursor);
        }
      });
    }
  } else if (config.siteKey === 'instagram') {
    if (isInstagramFeedUserPayload(json)) {
      for (const node of json.items) {
        const candidate = parseInstagramMediaNode(node);
        if (candidate) {
          items.push(candidate);
        }
      }
      collectInstagramPaginationCursors(json, cursors);
    } else {
      collectRecursive(json, (node) => {
        const candidate = parseInstagramMediaNode(node);
        if (candidate) {
          items.push(candidate);
        }
      });
      collectInstagramPaginationCursors(json, cursors);
    }
  }
  return {
    items: mergeByKey(items, (entry) => entry.id || entry.url, Number.MAX_SAFE_INTEGER),
    nextCursor: cursors[cursors.length - 1] || null,
    riskSignals: detectApiPayloadRisk(json),
  };
}

function apiErrorTexts(json) {
  const texts = [];
  collectRecursive(json, (node) => {
    for (const key of ['message', 'msg', 'error', 'error_message', 'errorSummary', 'errorDescription', 'title', 'detail']) {
      if (node?.[key] !== undefined && node?.[key] !== null && typeof node[key] !== 'object') {
        texts.push(String(node[key]));
      }
    }
    if (node?.code !== undefined && typeof node.code !== 'object') {
      texts.push(String(node.code));
    }
    if (node?.error_code !== undefined && typeof node.error_code !== 'object') {
      texts.push(String(node.error_code));
    }
  });
  return texts;
}

function detectApiPayloadRisk(json, status = null) {
  const texts = apiErrorTexts(json).join(' ').toLowerCase();
  const signals = [];
  if (status === 401 || status === 403 || /login_required|login required|not logged in|auth(?:entication)? required|unauthorized|forbidden|checkpoint_required|consent_required/iu.test(texts)) {
    signals.push('login-wall');
  }
  if (/challenge_required|challenge|captcha|verification required|verify your account|suspicious|unusual activity/iu.test(texts)) {
    signals.push('challenge');
  }
  if (status === 429 || /rate limit|too many requests|throttle|temporarily restricted|try again later|wait a few minutes/iu.test(texts)) {
    signals.push('rate-limited');
  }
  return dedupeSortedStrings(signals);
}

function parseRetryAfterMs(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    return Math.max(0, parsed - Date.now());
  }
  return null;
}

function retryAfterMsFromHeaders(headers = {}) {
  const normalized = Object.fromEntries(normalizeHeaderEntries(headers));
  return parseRetryAfterMs(normalized['retry-after']);
}

function apiRiskReasonFromSignals(signals = [], status = null) {
  const runtimeSignal = pickRuntimeRiskSignal(signals);
  if (runtimeSignal === 'rate-limited') {
    return 'api-rate-limited';
  }
  if (runtimeSignal === 'challenge') {
    return 'api-challenge';
  }
  if (runtimeSignal === 'login-wall') {
    return status === 403 ? 'api-forbidden-login-required' : 'api-auth-required';
  }
  if (status && status >= 400) {
    return `api-http-${status}`;
  }
  return null;
}

function boundedReasonFromArchiveReason(reason) {
  const normalized = String(reason ?? '');
  if (normalized === 'max-items-from-resume') {
    return 'max-items';
  }
  return ['max-items', 'max-api-pages', 'max-users', 'max-detail-pages', 'max-media-downloads'].includes(normalized)
    ? normalized
    : null;
}

function isSoftCursorReplayExhaustion(fetchResult = {}, context = {}) {
  const status = Number(fetchResult.status);
  if (!(status === 404 || status === 410)) {
    return false;
  }
  if (!['x', 'twitter'].includes(String(context.config?.siteKey ?? '').toLowerCase())) {
    return false;
  }
  if (!['profile-content', 'search', 'followed-posts-by-date'].includes(String(context.plan?.action ?? ''))) {
    return false;
  }
  if (!Number.isFinite(Number(context.pages)) || Number(context.pages) < 1 || !Number(context.itemCount)) {
    return false;
  }
  const riskSignals = dedupeSortedStrings(fetchResult.riskSignals ?? []);
  return !riskSignals.some((signal) => ['challenge', 'login-wall', 'rate-limited'].includes(signal));
}

function normalizeApiFetchResult(value) {
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'ok') && Object.prototype.hasOwnProperty.call(value, 'json')) {
    return value;
  }
  return {
    ok: true,
    status: 200,
    headers: {},
    json: value,
    text: '',
  };
}

function updateNestedCursor(value, cursor) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  let updated = false;
  if (Object.prototype.hasOwnProperty.call(value, 'cursor')) {
    value.cursor = cursor;
    updated = true;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'after')) {
    value.after = cursor;
    updated = true;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'max_id')) {
    value.max_id = cursor;
    updated = true;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'maxId')) {
    value.maxId = cursor;
    updated = true;
  }
  for (const item of Object.values(value)) {
    if (item && typeof item === 'object') {
      updated = updateNestedCursor(item, cursor) || updated;
    }
  }
  return updated;
}

function updateCursorFields(value, cursor) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const updated = updateNestedCursor(value, cursor);
  if (!updated) {
    value.cursor = cursor;
    value.after = cursor;
    return true;
  }
  return true;
}

function isInstagramRestCursorUrl(parsedUrl) {
  return /(^|\.)instagram\.com$/iu.test(parsedUrl.hostname)
    && /^\/api\/v1\/(?:feed|friendships|media|users|clips)\//iu.test(parsedUrl.pathname);
}

export function buildCursorPageUrl(seedUrl, cursor) {
  const parsed = new URL(seedUrl);
  if (parsed.searchParams.has('variables')) {
    const variables = JSON.parse(parsed.searchParams.get('variables') || '{}');
    updateCursorFields(variables, cursor);
    parsed.searchParams.set('variables', JSON.stringify(variables));
    return parsed.toString();
  }
  if (parsed.searchParams.has('max_id') || isInstagramRestCursorUrl(parsed)) {
    parsed.searchParams.set('max_id', cursor);
    return parsed.toString();
  }
  if (parsed.searchParams.has('after')) {
    parsed.searchParams.set('after', cursor);
    return parsed.toString();
  }
  parsed.searchParams.set('cursor', cursor);
  return parsed.toString();
}

function updateFormCursorBody(body, cursor) {
  const params = new URLSearchParams(String(body ?? ''));
  if (params.has('variables')) {
    try {
      const variables = JSON.parse(params.get('variables') || '{}');
      updateCursorFields(variables, cursor);
      params.set('variables', JSON.stringify(variables));
      return params.toString();
    } catch {
      // Continue with simple cursor fields below.
    }
  }
  if (params.has('max_id')) {
    params.set('max_id', cursor);
  } else if (params.has('after')) {
    params.set('after', cursor);
  } else if (params.has('cursor')) {
    params.set('cursor', cursor);
  } else {
    params.set('max_id', cursor);
  }
  return params.toString();
}

function updateJsonCursorBody(body, cursor) {
  const payload = JSON.parse(String(body ?? '{}') || '{}');
  if (!updateCursorFields(payload?.variables && typeof payload.variables === 'object' ? payload.variables : payload, cursor)) {
    payload.cursor = cursor;
    payload.after = cursor;
  }
  return JSON.stringify(payload);
}

export function buildCursorReplayRequest(seedRequest, cursor) {
  const method = String(seedRequest?.method || 'GET').toUpperCase();
  const headers = { ...(seedRequest?.headers || {}) };
  for (const name of Object.keys(headers)) {
    if (FORBIDDEN_FETCH_HEADER_RE.test(name) || name.toLowerCase() === 'content-length') {
      delete headers[name];
    }
  }
  const request = {
    url: buildCursorPageUrl(seedRequest?.url, cursor),
    method,
    headers,
  };
  if (method === 'GET' || method === 'HEAD' || !seedRequest?.body) {
    return request;
  }
  const contentType = String(headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
  try {
    request.body = contentType.includes('application/x-www-form-urlencoded')
      ? updateFormCursorBody(seedRequest.body, cursor)
      : updateJsonCursorBody(seedRequest.body, cursor);
  } catch {
    request.body = seedRequest.body;
  }
  return request;
}

function pageFetchJson(requestOrUrl, replayHeaders = {}) {
  const request = typeof requestOrUrl === 'string'
    ? { url: requestOrUrl, method: 'GET', headers: replayHeaders }
    : requestOrUrl;
  const method = String(request?.method || 'GET').toUpperCase();
  const init = {
    method,
    credentials: 'include',
    headers: {
      accept: 'application/json, text/plain, */*',
      ...(request?.headers || {}),
    },
  };
  if (request?.body && method !== 'GET' && method !== 'HEAD') {
    init.body = request.body;
  }
  return fetch(request.url, init).then(async (response) => {
    const text = await response.text();
    let json = null;
    try {
      json = text.trim() ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const headers = {};
    if (typeof response.headers?.forEach === 'function') {
      response.headers.forEach((value, name) => {
        headers[name] = value;
      });
    }
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText || '',
      headers,
      json,
      text: json ? '' : text.slice(0, 2_000),
    };
  });
}

function operationNameFromApiEntry(entry = {}) {
  return String(entry.response?.request?.operationName ?? entry.response?.requestTemplate?.operationName ?? '').toLowerCase();
}

function urlFromApiEntry(entry = {}) {
  return String(entry.response?.url ?? '').toLowerCase();
}

function scoreSocialApiSeed(entry, config, plan) {
  const operationName = operationNameFromApiEntry(entry);
  const url = urlFromApiEntry(entry);
  let score = 0;
  if (entry.parsed.nextCursor) {
    score += 100;
  }
  score += Math.min(entry.parsed.items.length, 50);
  if (config.siteKey === 'x') {
    if (plan.action === 'search' || plan.action === 'followed-posts-by-date') {
      if (/search|searchtimeline/iu.test(operationName) || /\/2\/search\//iu.test(url)) {
        score += 80;
      }
    } else if (plan.action === 'profile-following' || plan.action === 'followed-users') {
      if (/following/iu.test(operationName)) {
        score += 80;
      }
    } else if (plan.action === 'profile-followers') {
      if (/followers/iu.test(operationName)) {
        score += 80;
      }
    } else if (plan.contentType === 'replies') {
      if (/tweetsandreplies|withreplies/iu.test(operationName)) {
        score += 80;
      }
    } else if (plan.contentType === 'media') {
      if (/media/iu.test(operationName)) {
        score += 80;
      }
    } else if (plan.contentType === 'highlights') {
      if (/highlights/iu.test(operationName)) {
        score += 80;
      }
    } else if (/usertweets|profiletimeline/iu.test(operationName)) {
      score += 60;
    }
  } else if (config.siteKey === 'instagram') {
    if (/\/api\/v1\/feed\/user\//iu.test(url) || /edge_owner_to_timeline_media|profileposts|timeline/iu.test(operationName)) {
      score += 80;
    }
    if (plan.contentType === 'reels' && /clips|reels/iu.test(url + operationName)) {
      score += 40;
    }
  }
  return score;
}

function isTargetTimelineApiSummary(summary, config = {}, plan = {}) {
  const operationName = String(summary?.operationName ?? '').toLowerCase();
  const url = String(summary?.url ?? '').toLowerCase();
  if (config.siteKey === 'x') {
    if (plan.action === 'search' || plan.action === 'followed-posts-by-date') {
      return /search|searchtimeline/iu.test(operationName) || /\/2\/search\//iu.test(url);
    }
    if (plan.action === 'profile-content') {
      if (plan.contentType === 'replies') {
        return /tweetsandreplies|withreplies/iu.test(operationName);
      }
      if (plan.contentType === 'media') {
        return /media/iu.test(operationName);
      }
      if (plan.contentType === 'highlights') {
        return /highlights/iu.test(operationName);
      }
      return /usertweets|profiletimeline/iu.test(operationName);
    }
    return false;
  }
  if (config.siteKey === 'instagram') {
    if (plan.action !== 'profile-content' && plan.action !== 'followed-posts-by-date') {
      return false;
    }
    if (plan.contentType === 'reels') {
      return /clips|reels/iu.test(url + operationName);
    }
    return /\/api\/v1\/feed\/user\//iu.test(url) || /edge_owner_to_timeline_media|profileposts|timeline/iu.test(operationName);
  }
  return false;
}

function requiresTargetTimelineApiSeed(config = {}, plan = {}) {
  if (config.siteKey === 'x') {
    return ['profile-content', 'search', 'followed-posts-by-date'].includes(plan.action);
  }
  if (config.siteKey === 'instagram') {
    return ['profile-content', 'followed-posts-by-date'].includes(plan.action);
  }
  return false;
}

function isTargetTimelineApiEntry(entry, config = {}, plan = {}) {
  return isTargetTimelineApiSummary(
    summarizeParsedApiResponse(entry.response, entry.parsed, config, plan),
    config,
    plan,
  );
}

function isSchemaDriftApiSummary(summary, config = {}, plan = {}) {
  return isTargetTimelineApiSummary(summary, config, plan)
    && (
      summary.itemCount === 0
      || !summary.hasNextCursor
      || summary.missingTimestampCount > 0
      || summary.missingAuthorCount > 0
    );
}

function classifyApiSchemaDrift(summary = {}) {
  if (summary.riskSignals?.length || summary.reason) {
    return {
      category: 'parse-risk',
      reason: summary.reason || summary.riskSignals.join(','),
    };
  }
  if (summary.itemCount === 0) {
    return {
      category: 'target-empty',
      reason: summary.hasNextCursor ? 'target timeline parsed no items despite cursor' : 'target timeline parsed no items',
    };
  }
  if (!summary.hasNextCursor) {
    return {
      category: 'missing-cursor',
      reason: 'target timeline items parsed without a next cursor',
    };
  }
  if (summary.missingTimestampCount > 0) {
    return {
      category: 'missing-time',
      reason: `${summary.missingTimestampCount} parsed item(s) missing timestamp`,
    };
  }
  if (summary.missingAuthorCount > 0) {
    return {
      category: 'missing-author',
      reason: `${summary.missingAuthorCount} parsed item(s) missing author`,
    };
  }
  return {
    category: 'parse-risk',
    reason: 'target timeline shape differs from parser expectations',
  };
}

function annotateApiSchemaDriftSummary(summary) {
  const classification = classifyApiSchemaDrift(summary);
  return {
    ...summary,
    category: classification.category,
    driftCategory: classification.category,
    reason: summary.reason || classification.reason,
    driftReason: classification.reason,
  };
}

function selectSocialApiSeed(parsedResponses, config, plan) {
  const parseableResponses = parsedResponses
    .filter((entry) => entry.parsed.items.length || entry.parsed.nextCursor);
  const targetResponses = parseableResponses
    .filter((entry) => isTargetTimelineApiEntry(entry, config, plan));
  const candidates = requiresTargetTimelineApiSeed(config, plan)
    ? targetResponses
    : targetResponses.length
      ? targetResponses
      : parseableResponses;
  return [...candidates]
    .sort((left, right) => {
      const scoreDelta = scoreSocialApiSeed(right, config, plan) - scoreSocialApiSeed(left, config, plan);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      const cursorDelta = Number(Boolean(right.parsed.nextCursor)) - Number(Boolean(left.parsed.nextCursor));
      if (cursorDelta !== 0) {
        return cursorDelta;
      }
      return right.parsed.items.length - left.parsed.items.length;
    })[0] ?? null;
}

function summarizeSocialApiCapture(apiCapture, parsedResponses = [], config = null, plan = null) {
  if (!apiCapture) {
    return null;
  }
  const responses = Array.isArray(apiCapture.responses) ? apiCapture.responses : [];
  const operations = dedupeSortedStrings(responses.map((response) => response.request?.operationName));
  const parsedSummaries = parsedResponses.map((entry) => summarizeParsedApiResponse(entry.response, entry.parsed, config || {}, plan || {}));
  const driftSamples = parsedSummaries
    .filter((entry) => isSchemaDriftApiSummary(entry, config || {}, plan || {}))
    .map(annotateApiSchemaDriftSummary)
    .slice(-API_CAPTURE_SAMPLE_LIMIT);
  const rawDriftSamples = parsedResponses
    .map((entry) => ({
      summary: summarizeParsedApiResponse(entry.response, entry.parsed, config || {}, plan || {}),
      payloadSample: apiPayloadSample(entry.response.json),
    }))
    .filter((entry) => isSchemaDriftApiSummary(entry.summary, config || {}, plan || {}))
    .map((entry) => ({
      ...entry,
      summary: annotateApiSchemaDriftSummary(entry.summary),
    }))
    .slice(-API_CAPTURE_SAMPLE_LIMIT);
  return {
    requestCount: apiCapture.stats?.requests ?? null,
    networkResponseCount: apiCapture.stats?.responses ?? null,
    responseCount: responses.length,
    capturedBodyCount: apiCapture.stats?.capturedBodies ?? null,
    bodyErrorCount: apiCapture.stats?.bodyErrors ?? null,
    parsedResponseCount: parsedResponses.length,
    parsedSeedCandidateCount: parsedResponses.filter((entry) => entry.parsed.items.length || entry.parsed.nextCursor).length,
    operations: operations.slice(0, API_CAPTURE_SAMPLE_LIMIT),
    samples: parsedSummaries.slice(-API_CAPTURE_SAMPLE_LIMIT),
    driftSamples,
    rawDriftSampleCount: rawDriftSamples.length,
    rawDriftSamples,
    errors: (apiCapture.errors || []).slice(-API_CAPTURE_SAMPLE_LIMIT),
  };
}

function normalizeHandleForCompare(value) {
  return String(value ?? '').trim().replace(/^@/u, '').toLowerCase();
}

function itemAuthorHandle(item = {}) {
  const explicit = item?.author?.handle ?? item?.sourceAccount ?? null;
  if (explicit) {
    return normalizeHandleForCompare(explicit);
  }
  try {
    const parsed = new URL(String(item?.url ?? ''));
    const segment = parsed.pathname.split('/').filter(Boolean)[0] || '';
    return normalizeHandleForCompare(segment);
  } catch {
    return '';
  }
}

function itemMatchesRequestedAccount(item = {}, plan = {}) {
  const requested = normalizeHandleForCompare(plan.account);
  if (!requested) {
    return true;
  }
  if (item.isRetweet === true) {
    return false;
  }
  const author = itemAuthorHandle(item);
  return !author || author === requested;
}

function filterApiArchiveItemsForPlan(items, config, plan) {
  if (config?.siteKey !== 'x' || plan?.action !== 'profile-content' || !plan?.account) {
    return Array.isArray(items) ? items : [];
  }
  return (Array.isArray(items) ? items : []).filter((item) => itemMatchesRequestedAccount(item, plan));
}

function annotateApiArchiveItems(items, plan) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    sourceAccount: item.sourceAccount ?? item.author?.handle ?? plan.account ?? null,
  }));
}

function statusFromFetchError(error) {
  const match = String(error?.message ?? error ?? '').match(/HTTP\s+(\d{3})/iu);
  return match ? Number(match[1]) : null;
}

async function fetchCursorReplayJson(session, request, settings) {
  const maxAttempts = Math.max(1, (settings.apiRetries ?? DEFAULT_API_RETRIES) + 1);
  const attempts = [];
  let consecutiveRateLimitEvents = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let result;
    try {
      result = normalizeApiFetchResult(await session.callPageFunction(pageFetchJson, request));
    } catch (error) {
      const status = statusFromFetchError(error);
      if (status === 429) {
        consecutiveRateLimitEvents += 1;
      } else {
        consecutiveRateLimitEvents = 0;
      }
      const retryable = (status === 429 || (status !== null && status >= 500)) && attempt < maxAttempts - 1;
      const waitMs = retryable ? adaptiveRiskBackoffDelayMs(settings, attempt, consecutiveRateLimitEvents) : 0;
      attempts.push({
        attempt: attempt + 1,
        ok: false,
        status,
        retryable,
        waitMs,
        adaptiveThrottleLevel: consecutiveRateLimitEvents,
        adaptiveBackoffMs: waitMs,
        error: error?.message ?? String(error),
      });
      if (retryable && waitMs > 0) {
        await sleep(waitMs);
        continue;
      }
      return {
        ok: false,
        status,
        headers: {},
        json: null,
        text: '',
        riskSignals: status === 429 ? ['rate-limited'] : [],
        reason: status === 429 ? 'api-rate-limited' : `cursor-fetch-failed: ${error?.message ?? String(error)}`,
        attempts,
      };
    }

    const riskSignals = detectApiPayloadRisk(result.json, result.status);
    const retryAfterMs = retryAfterMsFromHeaders(result.headers);
    const retryableStatus = result.status === 429 || result.status >= 500;
    const retryableRisk = riskSignals.includes('rate-limited');
    if (result.status === 429 || retryableRisk) {
      consecutiveRateLimitEvents += 1;
    } else {
      consecutiveRateLimitEvents = 0;
    }
    const retryable = (retryableStatus || retryableRisk) && attempt < maxAttempts - 1;
    const waitMs = retryable ? adaptiveRiskBackoffDelayMs(settings, attempt, consecutiveRateLimitEvents, retryAfterMs) : 0;
    attempts.push({
      attempt: attempt + 1,
      ok: result.ok,
      status: result.status,
      retryable,
      waitMs,
      adaptiveThrottleLevel: consecutiveRateLimitEvents,
      adaptiveBackoffMs: waitMs,
      riskSignals,
    });
    if ((!result.ok || retryableRisk) && retryable) {
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      continue;
    }
    if (!result.ok || riskSignals.length) {
      return {
        ok: false,
        status: result.status,
        headers: sanitizeApiDebugHeaders(result.headers || {}),
        json: result.json,
        text: result.text || '',
        riskSignals,
        reason: apiRiskReasonFromSignals(riskSignals, result.status) || `api-http-${result.status}`,
        attempts,
      };
    }
    return {
      ok: true,
      status: result.status,
      headers: sanitizeApiDebugHeaders(result.headers || {}),
      json: result.json,
      text: result.text || '',
      riskSignals,
      attempts,
    };
  }
  return {
    ok: false,
    status: null,
    headers: {},
    json: null,
    text: '',
    riskSignals: [],
    reason: 'api-retry-exhausted',
    attempts,
  };
}

async function collectSocialApiArchive(session, config, plan, settings, apiCapture, checkpoint = null, options = {}) {
  const seedOnly = options.seedOnly === true || settings.apiCursor !== true;
  if (!apiCapture || (!settings.apiCursor && !seedOnly)) {
    return null;
  }
  await sleep(Math.max(settings.scrollWaitMs, 500));
  await apiCapture.flush?.(Math.max(settings.scrollWaitMs, 1_500));
  const previousArchive = settings.resume && options.includeCheckpointItems !== false ? checkpoint?.previousState?.archive : null;
  const previousItems = settings.resume && options.includeCheckpointItems !== false ? (checkpoint?.previousItems || []) : [];
  const captureStartIndex = Math.max(0, Number(options.captureStartIndex ?? 0) || 0);
  const capturedResponses = apiCapture.responses.slice(captureStartIndex);
  const parsedResponses = capturedResponses
    .map((response) => ({
      response,
      parsed: parseSocialApiPayload(config.siteKey, response.json),
    }));
  const capturedRiskSignals = dedupeSortedStrings(parsedResponses.flatMap((entry) => [
    ...(entry.parsed?.riskSignals ?? []),
    ...detectApiPayloadRisk(entry.response.json, entry.response.status),
  ]));
  const seed = selectSocialApiSeed(parsedResponses, config, plan);
  const capture = summarizeSocialApiCapture(apiCapture, parsedResponses, config, plan);
  if (!seed) {
    if (previousArchive?.nextCursor && previousArchive?.seedUrl) {
      const allItems = filterApiArchiveItemsForPlan(
        mergeByKey(previousItems, (entry) => entry.id || entry.url || entry.text, settings.maxItems),
        config,
        plan,
      );
      const boundedBy = boundedReasonFromArchiveReason(allItems.length >= settings.maxItems ? 'max-items' : null);
      return {
        strategy: 'api-cursor',
        complete: allItems.length >= settings.maxItems ? false : null,
        reason: allItems.length >= settings.maxItems ? 'max-items-from-resume' : 'resume-seed-without-live-capture',
        bounded: Boolean(boundedBy),
        boundedBy,
        pages: Number(previousArchive.pages ?? 0),
        items: allItems,
        media: mergeByKey(allItems.flatMap((item) => item.media || []), (entry) => `${entry.type}:${entry.url}`, settings.maxItems * 5),
        nextCursor: previousArchive.nextCursor,
        seedUrl: previousArchive.seedUrl,
        requestTemplate: previousArchive.requestTemplate ?? null,
        capture,
        resumed: true,
      };
    }
    return {
      strategy: 'api-cursor',
      complete: false,
      reason: capturedRiskSignals.length ? apiRiskReasonFromSignals(capturedRiskSignals) : capturedResponses.length ? 'no-parseable-api-seed' : 'no-api-seed-captured',
      pages: 0,
      items: [],
      media: [],
      nextCursor: null,
      capture,
      riskSignals: capturedRiskSignals,
      boundarySignals: capturedRiskSignals,
    };
  }
  let allItems = filterApiArchiveItemsForPlan(mergeByKey([
    ...previousItems,
    ...annotateApiArchiveItems(seed.parsed.items, plan),
  ], (entry) => entry.id || entry.url || entry.text, settings.maxItems), config, plan);
  let cursor = previousArchive?.nextCursor || seed.parsed.nextCursor;
  let seedUrl = previousArchive?.seedUrl || seed.response.url;
  let replayRequest = {
    ...(seed.response.replayRequest || {
      url: seed.response.url,
      method: 'GET',
      headers: seed.response.replayHeaders || {},
    }),
    url: seedUrl,
  };
  const requestTemplate = seed.response.request || previousArchive?.requestTemplate || null;
  let pages = Math.max(Number(previousArchive?.pages ?? 0), 0) + 1;
  let reason = cursor ? 'max-api-pages' : 'no-next-cursor';
  const apiRiskSignals = [...capturedRiskSignals, ...(seed.parsed?.riskSignals ?? [])];
  const apiRiskEvents = [];
  if (allItems.length >= settings.maxItems) {
    reason = 'max-items';
  }
  if (seedOnly) {
    const windowedItems = (plan.date || plan.fromDate || plan.toDate)
      ? allItems.filter((entry) => itemMatchesDateWindow(entry, plan))
      : allItems;
    const items = mergeByKey(windowedItems, (entry) => entry.id || entry.url || entry.text, settings.maxItems);
    return {
      strategy: 'api-seed',
      complete: null,
      reason: 'api-seed-only',
      bounded: false,
      boundedBy: null,
      pages: 1,
      items,
      media: mergeByKey(items.flatMap((item) => item.media || []), (entry) => `${entry.type}:${entry.url}`, settings.maxItems * 5),
      nextCursor: null,
      seedUrl,
      requestTemplate,
      capture,
      riskSignals: dedupeSortedStrings(apiRiskSignals),
      riskEvents: apiRiskEvents,
      boundarySignals: dedupeSortedStrings(apiRiskSignals),
      resumed: Boolean(previousItems.length || previousArchive?.nextCursor),
    };
  }
  let softCursorFailure = false;
  while (cursor && pages < settings.maxApiPages && allItems.length < settings.maxItems) {
    const nextRequest = buildCursorReplayRequest(replayRequest, cursor);
    const fetchResult = await fetchCursorReplayJson(session, nextRequest, settings);
    apiRiskEvents.push(...(fetchResult.attempts || []).map((attempt) => ({
      ...attempt,
      url: nextRequest.url,
    })));
    apiRiskSignals.push(...(fetchResult.riskSignals ?? []));
    if (!fetchResult.ok) {
      reason = fetchResult.reason || 'cursor-fetch-failed';
      softCursorFailure = isSoftCursorReplayExhaustion(fetchResult, {
        config,
        plan,
        pages,
        itemCount: allItems.length,
      });
      const riskSignals = dedupeSortedStrings(apiRiskSignals);
      await checkpoint?.write?.({
        status: riskSignals.includes('rate-limited') ? 'paused' : 'running',
        pausedAt: riskSignals.includes('rate-limited') ? new Date().toISOString() : undefined,
        archive: {
          strategy: 'api-cursor',
          complete: false,
          reason,
          pages,
          nextCursor: cursor || null,
          seedUrl,
          requestTemplate,
          capture,
          riskSignals,
          riskEvents: apiRiskEvents,
        },
        counts: {
          items: allItems.length,
          media: allItems.flatMap((item) => item.media || []).length,
        },
      });
      break;
    }
    const parsed = parseSocialApiPayload(config.siteKey, fetchResult.json);
    apiRiskSignals.push(...(parsed.riskSignals ?? []));
    if (parsed.riskSignals?.length) {
      reason = apiRiskReasonFromSignals(parsed.riskSignals) || 'api-risk-signal';
      break;
    }
    pages += 1;
    allItems = filterApiArchiveItemsForPlan(mergeByKey([
      ...allItems,
      ...annotateApiArchiveItems(parsed.items, plan),
    ], (entry) => entry.id || entry.url || entry.text, settings.maxItems), config, plan);
    cursor = parsed.nextCursor;
    replayRequest = nextRequest;
    seedUrl = nextRequest.url;
    if (!cursor) {
      reason = 'no-next-cursor';
      break;
    }
    if (allItems.length >= settings.maxItems) {
      reason = 'max-items';
      break;
    }
    await checkpoint?.write?.({
      status: 'running',
      archive: {
        strategy: 'api-cursor',
        complete: false,
        reason,
        pages,
        nextCursor: cursor || null,
        seedUrl,
        requestTemplate,
        capture,
        riskSignals: dedupeSortedStrings(apiRiskSignals),
        riskEvents: apiRiskEvents,
      },
      counts: {
        items: allItems.length,
        media: allItems.flatMap((item) => item.media || []).length,
      },
    });
  }
  const windowedItems = (plan.date || plan.fromDate || plan.toDate)
    ? allItems.filter((entry) => itemMatchesDateWindow(entry, plan))
    : allItems;
  const items = mergeByKey(windowedItems, (entry) => entry.id || entry.url || entry.text, settings.maxItems);
  const boundedBy = boundedReasonFromArchiveReason(reason);
  const archiveReason = softCursorFailure ? 'soft-cursor-exhausted' : reason;
  return {
    strategy: 'api-cursor',
    complete: softCursorFailure ? null : !cursor,
    reason: archiveReason,
    confidence: softCursorFailure ? 'partial' : null,
    partial: softCursorFailure,
    bounded: Boolean(boundedBy),
    boundedBy,
    pages,
    items,
    media: mergeByKey(items.flatMap((item) => item.media || []), (entry) => `${entry.type}:${entry.url}`, settings.maxItems * 5),
    nextCursor: softCursorFailure ? null : cursor || null,
    diagnosticCursor: softCursorFailure ? cursor || null : null,
    seedUrl,
    requestTemplate,
    capture,
    riskSignals: dedupeSortedStrings(apiRiskSignals),
    riskEvents: apiRiskEvents,
    boundarySignals: dedupeSortedStrings(apiRiskSignals),
    resumed: Boolean(previousItems.length || previousArchive?.nextCursor),
  };
}

const INSTAGRAM_WEB_APP_ID = '936619743392459';

function isInstagramFeedUserArchivePlan(config, plan, settings) {
  if (config?.siteKey !== 'instagram' || plan?.action !== 'profile-content' || !plan?.account) {
    return false;
  }
  if (!settings?.fullArchive && !settings?.apiCursor) {
    return false;
  }
  return ['posts', 'media', 'reels'].includes(String(plan.contentType || 'posts'));
}

function instagramApiV1Headers() {
  return {
    accept: 'application/json, text/plain, */*',
    'x-ig-app-id': INSTAGRAM_WEB_APP_ID,
    'x-requested-with': 'XMLHttpRequest',
  };
}

function instagramWebProfileInfoUrl(account) {
  const url = new URL('https://www.instagram.com/api/v1/users/web_profile_info/');
  url.searchParams.set('username', account);
  return url.toString();
}

function instagramFeedUserPageUrl(userId) {
  const url = new URL(`https://www.instagram.com/api/v1/feed/user/${encodeURIComponent(userId)}/`);
  url.searchParams.set('count', '12');
  return url.toString();
}

function extractInstagramProfileInfoUser(json, requestedAccount = null) {
  const user = json?.data?.user || json?.user || null;
  if (!user || typeof user !== 'object') {
    return null;
  }
  const id = user.id ?? user.pk ?? user.pk_id ?? null;
  const handle = cleanText(user.username || user.handle || requestedAccount || '');
  if (!id) {
    return null;
  }
  const rawPostCount = user.edge_owner_to_timeline_media?.count
    ?? user.media_count
    ?? user.posts_count
    ?? null;
  const parsedPostCount = Number(rawPostCount);
  const postCount = rawPostCount !== null && rawPostCount !== undefined && Number.isFinite(parsedPostCount)
    ? parsedPostCount
    : null;
  return {
    id: String(id),
    handle: handle || null,
    displayName: cleanText(user.full_name || user.fullName || user.name || '') || null,
    url: handle ? `https://www.instagram.com/${handle}/` : null,
    postCount,
  };
}

function instagramFeedItemMatchesPlan(item, plan) {
  const contentType = String(plan?.contentType || 'posts').toLowerCase();
  if (contentType === 'reels') {
    return /\/reel\//iu.test(String(item?.url || ''))
      || String(item?.productType || '').toLowerCase() === 'clips';
  }
  if (contentType === 'highlights') {
    return false;
  }
  return true;
}

function filterInstagramFeedItemsForPlan(items, plan) {
  return (Array.isArray(items) ? items : []).filter((item) => instagramFeedItemMatchesPlan(item, plan));
}

function instagramDirectArchiveCapture(profileUrl, feedUrl, events = []) {
  return {
    requestCount: null,
    networkResponseCount: null,
    responseCount: events.filter((entry) => entry?.status).length,
    capturedBodyCount: null,
    bodyErrorCount: null,
    parsedResponseCount: events.filter((entry) => entry?.itemCount !== undefined).length,
    parsedSeedCandidateCount: events.some((entry) => Number(entry?.itemCount) > 0 || entry?.nextCursor) ? 1 : 0,
    operations: [
      { operationName: 'instagram-web-profile-info', url: profileUrl, method: 'GET' },
      { operationName: 'instagram-feed-user', url: feedUrl, method: 'GET' },
    ],
    samples: events.slice(-API_CAPTURE_SAMPLE_LIMIT),
    driftSamples: [],
    rawDriftSampleCount: 0,
    rawDriftSamples: [],
    errors: [],
  };
}

function shouldPreferInstagramDirectArchive(currentArchive, candidateArchive) {
  if (!candidateArchive) {
    return false;
  }
  if (!currentArchive) {
    return true;
  }
  const currentItems = currentArchive.items?.length ?? 0;
  const candidateItems = candidateArchive.items?.length ?? 0;
  if (candidateItems > currentItems) {
    return true;
  }
  if (currentItems === 0 && ['no-api-seed-captured', 'no-parseable-api-seed'].includes(String(currentArchive.reason))) {
    return true;
  }
  if (candidateItems === currentItems && candidateArchive.complete === true && currentArchive.complete !== true) {
    return true;
  }
  return false;
}

async function collectInstagramFeedUserArchive(session, config, plan, settings, checkpoint = null) {
  if (!isInstagramFeedUserArchivePlan(config, plan, settings)) {
    return null;
  }
  const previousArchive = settings.resume ? checkpoint?.previousState?.archive : null;
  const previousItems = settings.resume ? (checkpoint?.previousItems || []) : [];
  const headers = instagramApiV1Headers();
  const profileUrl = instagramWebProfileInfoUrl(plan.account);
  const profileResult = await fetchCursorReplayJson(session, {
    url: profileUrl,
    method: 'GET',
    headers,
  }, settings);
  const profileUser = profileResult.ok ? extractInstagramProfileInfoUser(profileResult.json, plan.account) : null;
  const fallbackUserId = previousArchive?.strategy === 'instagram-feed-user' ? previousArchive.userId : null;
  const userId = profileUser?.id || fallbackUserId || null;
  const feedUrl = userId ? instagramFeedUserPageUrl(userId) : null;
  const riskSignals = [...(profileResult.riskSignals ?? [])];
  const riskEvents = (profileResult.attempts || []).map((attempt) => ({
    ...attempt,
    url: profileUrl,
  }));
  if (!userId || !feedUrl) {
    const reason = profileResult.ok ? 'instagram-profile-user-id-missing' : profileResult.reason || 'instagram-profile-info-fetch-failed';
    const items = filterInstagramFeedItemsForPlan(
      mergeByKey(previousItems, (entry) => entry.id || entry.url || entry.text, settings.maxItems),
      plan,
    );
    return {
      strategy: 'instagram-feed-user',
      complete: false,
      reason,
      pages: 0,
      userId,
      expectedItemCount: profileUser?.postCount ?? previousArchive?.expectedItemCount ?? null,
      items,
      media: mergeByKey(items.flatMap((item) => item.media || []), (entry) => `${entry.type}:${entry.url}`, settings.maxItems * 5),
      nextCursor: null,
      seedUrl: feedUrl,
      requestTemplate: feedUrl ? sanitizeSocialApiRequestTemplate({ url: feedUrl, method: 'GET', headers }) : null,
      capture: instagramDirectArchiveCapture(profileUrl, feedUrl, []),
      riskSignals: dedupeSortedStrings(riskSignals),
      riskEvents,
      boundarySignals: dedupeSortedStrings(riskSignals),
      resumed: Boolean(previousItems.length || previousArchive?.nextCursor),
    };
  }

  const maxPages = Math.max(0, Number(settings.maxApiPages) || 0);
  const requestTemplate = sanitizeSocialApiRequestTemplate({ url: feedUrl, method: 'GET', headers });
  let allItems = filterInstagramFeedItemsForPlan(
    mergeByKey(previousItems, (entry) => entry.id || entry.url || entry.text, settings.maxItems),
    plan,
  );
  let cursor = null;
  let pages = 0;
  let reason = maxPages < 1 ? 'max-api-pages' : 'max-api-pages';
  let lastUrl = feedUrl;
  const samples = [];
  while (pages < maxPages && allItems.length < settings.maxItems) {
    const request = cursor
      ? buildCursorReplayRequest({ url: feedUrl, method: 'GET', headers }, cursor)
      : { url: feedUrl, method: 'GET', headers };
    lastUrl = request.url;
    const fetchResult = await fetchCursorReplayJson(session, request, settings);
    riskEvents.push(...(fetchResult.attempts || []).map((attempt) => ({
      ...attempt,
      url: request.url,
    })));
    riskSignals.push(...(fetchResult.riskSignals ?? []));
    if (!fetchResult.ok) {
      reason = fetchResult.reason || 'instagram-feed-user-fetch-failed';
      await checkpoint?.write?.({
        status: riskSignals.includes('rate-limited') ? 'paused' : 'running',
        archive: {
          strategy: 'instagram-feed-user',
          complete: false,
          reason,
          pages,
          userId,
          expectedItemCount: profileUser?.postCount ?? previousArchive?.expectedItemCount ?? null,
          nextCursor: cursor || null,
          seedUrl: feedUrl,
          requestTemplate,
          riskSignals: dedupeSortedStrings(riskSignals),
          riskEvents,
        },
        counts: {
          items: allItems.length,
          media: allItems.flatMap((item) => item.media || []).length,
        },
      });
      break;
    }
    const parsed = parseSocialApiPayload(config.siteKey, fetchResult.json);
    riskSignals.push(...(parsed.riskSignals ?? []));
    pages += 1;
    samples.push({
      url: request.url,
      status: fetchResult.status,
      itemCount: parsed.items.length,
      mediaCount: parsed.items.flatMap((item) => item.media || []).length,
      nextCursor: parsed.nextCursor ?? null,
    });
    allItems = filterInstagramFeedItemsForPlan(mergeByKey([
      ...allItems,
      ...annotateApiArchiveItems(parsed.items, plan),
    ], (entry) => entry.id || entry.url || entry.text, settings.maxItems), plan);
    cursor = parsed.nextCursor;
    if (parsed.riskSignals?.length) {
      reason = apiRiskReasonFromSignals(parsed.riskSignals) || 'api-risk-signal';
      break;
    }
    if (allItems.length >= settings.maxItems) {
      reason = 'max-items';
      break;
    }
    const expectedCount = profileUser?.postCount ?? previousArchive?.expectedItemCount ?? null;
    if (expectedCount !== null && allItems.length >= expectedCount) {
      cursor = null;
      reason = null;
      break;
    }
    if (!cursor) {
      reason = null;
      break;
    }
    await checkpoint?.write?.({
      status: 'running',
      archive: {
        strategy: 'instagram-feed-user',
        complete: false,
        reason,
        pages,
        userId,
        expectedItemCount: expectedCount,
        nextCursor: cursor || null,
        seedUrl: feedUrl,
        requestTemplate,
        riskSignals: dedupeSortedStrings(riskSignals),
        riskEvents,
      },
      counts: {
        items: allItems.length,
        media: allItems.flatMap((item) => item.media || []).length,
      },
    });
  }

  if (cursor && reason === 'max-api-pages' && pages < maxPages) {
    reason = 'cursor-stopped';
  }
  const windowedItems = (plan.date || plan.fromDate || plan.toDate)
    ? allItems.filter((entry) => itemMatchesDateWindow(entry, plan))
    : allItems;
  const items = mergeByKey(windowedItems, (entry) => entry.id || entry.url || entry.text, settings.maxItems);
  const boundedBy = boundedReasonFromArchiveReason(reason);
  const complete = reason === null;
  return {
    strategy: 'instagram-feed-user',
    complete,
    reason,
    bounded: Boolean(boundedBy),
    boundedBy,
    pages,
    userId,
    profile: profileUser,
    expectedItemCount: profileUser?.postCount ?? previousArchive?.expectedItemCount ?? null,
    items,
    media: mergeByKey(items.flatMap((item) => item.media || []), (entry) => `${entry.type}:${entry.url}`, settings.maxItems * 5),
    nextCursor: complete ? null : cursor || null,
    seedUrl: feedUrl,
    lastUrl,
    requestTemplate,
    capture: instagramDirectArchiveCapture(profileUrl, feedUrl, samples),
    riskSignals: dedupeSortedStrings(riskSignals),
    riskEvents,
    boundarySignals: dedupeSortedStrings(riskSignals),
    resumed: Boolean(previousItems.length || previousArchive?.nextCursor),
  };
}

function xRelationOperationNameForAction(action) {
  return action === 'profile-followers' ? 'followers' : 'following';
}

function isXRelationApiResponse(entry, plan) {
  const operation = operationNameFromApiEntry(entry);
  if (operation === xRelationOperationNameForAction(plan.action)) {
    return true;
  }
  return isXRelationApiUrl(entry.response?.url, plan.action);
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function captureXRelationSeedRequest(session, plan, settings) {
  if (typeof session?.send !== 'function' || !session?.client?.on) {
    return null;
  }
  const requests = new Map();
  const deferred = createDeferred();
  let settled = false;
  const finish = (requestId) => {
    if (settled || !requestId || !requests.has(requestId)) {
      return;
    }
    settled = true;
    const request = requests.get(requestId);
    deferred.resolve({
      url: request.url,
      method: request.method || 'GET',
      headers: buildBrowserReplayHeaders(request),
      body: request.postData || null,
      requestTemplate: sanitizeSocialApiRequestTemplate(request),
    });
  };
  await session.send('Network.enable', {
    maxTotalBufferSize: 10_000_000,
    maxResourceBufferSize: 5_000_000,
  }, settings.timeoutMs);
  const offRequest = session.client.on('Network.requestWillBeSent', ({ params }) => {
    const request = params?.request;
    const url = request?.url || '';
    if (!params?.requestId || !isXRelationApiUrl(url, plan.action)) {
      return;
    }
    requests.set(params.requestId, {
      url,
      method: request?.method || 'GET',
      headers: request?.headers || {},
      postData: request?.postData || '',
      resourceType: params?.type || '',
    });
    setTimeout(() => finish(params.requestId), 500).unref?.();
  }, { sessionId: session.sessionId });
  const offRequestExtra = session.client.on('Network.requestWillBeSentExtraInfo', ({ params }) => {
    if (!params?.requestId || !requests.has(params.requestId)) {
      return;
    }
    const request = requests.get(params.requestId);
    requests.set(params.requestId, {
      ...request,
      headers: {
        ...(request.headers || {}),
        ...(params.headers || {}),
      },
    });
    setTimeout(() => finish(params.requestId), 150).unref?.();
  }, { sessionId: session.sessionId });
  try {
    await session.navigateAndWait(plan.url, createWaitPolicy(settings.timeoutMs));
    return await Promise.race([
      deferred.promise,
      sleep(Math.min(settings.timeoutMs, 15_000)).then(() => null),
    ]);
  } finally {
    settled = true;
    offRequest();
    offRequestExtra();
  }
}

async function collectXRelationUsersFromReplayRequest(session, seedRequest, settings) {
  let replayRequest = seedRequest;
  let cursor = null;
  let pages = 0;
  let users = [];
  let reason = 'no-next-cursor';
  const riskSignals = [];
  const riskEvents = [];

  while (replayRequest?.url && pages < settings.maxApiPages && users.length < settings.maxItems) {
    const fetchResult = await fetchCursorReplayJson(session, replayRequest, settings);
    riskEvents.push(...(fetchResult.attempts || []).map((attempt) => ({
      ...attempt,
      url: replayRequest.url,
    })));
    riskSignals.push(...(fetchResult.riskSignals ?? []));
    if (!fetchResult.ok) {
      reason = fetchResult.reason || 'relation-page-fetch-failed';
      break;
    }
    const parsed = collectXRelationEntries(fetchResult.json);
    pages += 1;
    const before = users.length;
    users = mergeByKey([
      ...users,
      ...parsed.users,
    ], (entry) => entry.handle?.toLowerCase() || entry.url, settings.maxItems);
    cursor = parsed.nextCursor;
    if (users.length === before && pages > 1) {
      reason = 'no-new-users';
      break;
    }
    if (!cursor) {
      reason = 'no-next-cursor';
      break;
    }
    if (users.length >= settings.maxItems) {
      reason = 'max-items';
      break;
    }
    replayRequest = buildCursorReplayRequest(replayRequest, cursor);
    reason = 'max-api-pages';
  }

  if (pages >= settings.maxApiPages && cursor && users.length < settings.maxItems) {
    reason = 'max-api-pages';
  }
  const boundedBy = boundedReasonFromArchiveReason(reason);
  return {
    strategy: 'api-relation',
    complete: !boundedBy && !riskSignals.length,
    reason,
    bounded: Boolean(boundedBy),
    boundedBy,
    pages,
    users,
    nextCursor: cursor || null,
    riskSignals: dedupeSortedStrings(riskSignals),
    riskEvents,
  };
}

async function collectXRelationApiUsers(session, plan, settings, apiCapture) {
  if (!apiCapture || !isSocialRelationAction(plan.action)) {
    return null;
  }
  await sleep(Math.max(settings.scrollWaitMs, 500));
  await apiCapture.flush?.(Math.max(settings.scrollWaitMs, 1_500));
  const parsedResponses = apiCapture.responses
    .map((response) => ({
      response,
      parsed: collectXRelationEntries(response.json),
    }))
    .filter((entry) => isXRelationApiResponse(entry, plan));
  const seed = parsedResponses
    .sort((left, right) => right.parsed.users.length - left.parsed.users.length)[0];
  const seedRequest = seed?.parsed?.users?.length
    ? (seed.response.replayRequest || {
      url: seed.response.url,
      method: 'GET',
      headers: seed.response.replayHeaders || {},
    })
    : await captureXRelationSeedRequest(session, plan, settings);
  if (!seedRequest?.url) {
    return {
      strategy: 'api-relation',
      complete: false,
      reason: apiCapture.responses.length ? 'no-relation-api-seed' : 'no-relation-api-captured',
      pages: 0,
      users: [],
      nextCursor: null,
      capture: summarizeSocialApiCapture(apiCapture, parsedResponses, resolveSocialSiteConfig('x'), plan),
    };
  }

  const archive = await collectXRelationUsersFromReplayRequest(session, seedRequest, settings);
  return {
    ...archive,
    seedUrl: seedRequest.url,
    requestTemplate: seedRequest.requestTemplate || seed?.response?.request || null,
    capture: summarizeSocialApiCapture(apiCapture, parsedResponses, resolveSocialSiteConfig('x'), plan),
  };
}

function mergePageResultWithArchive(pageResult, archive, settings) {
  if (!archive?.items?.length) {
    const fallbackArchive = archive ?? pageResult.archive ?? {
      strategy: 'dom-scroll',
      complete: false,
      reason: pageResult.stopReason || 'api-cursor-disabled-or-unavailable',
      pages: 0,
    };
    const domDedupedCount = fallbackArchive.dedupedItemCount
      ?? (fallbackArchive.strategy === 'dom-relation-scroll'
        ? pageResult.relations?.length ?? 0
        : pageResult.items?.length ?? 0);
    return {
      ...pageResult,
      riskSignals: dedupeSortedStrings([
        ...(pageResult.riskSignals ?? []),
        ...(archive?.riskSignals ?? []),
      ]),
      riskEvents: [
        ...(pageResult.riskEvents ?? []),
        ...(archive?.riskEvents ?? []),
      ],
      stopReason: pageResult.stopReason || runtimeRiskToStopReason(pickRuntimeRiskSignal(archive?.riskSignals ?? [])),
      archive: {
        ...fallbackArchive,
        domItemCount: pageResult.items?.length ?? 0,
        domRelationCount: pageResult.relations?.length ?? fallbackArchive.domRelationCount ?? null,
        apiItemCount: archive?.items?.length ?? 0,
        dedupedItemCount: domDedupedCount,
        boundarySignals: dedupeSortedStrings([
          ...(fallbackArchive.boundarySignals ?? []),
          ...(archive?.boundarySignals ?? []),
          ...(archive?.riskSignals ?? []),
          ...(pageResult.visibilitySignals ?? []),
          ...(pageResult.riskSignals ?? []),
        ]),
      },
    };
  }
  const archiveMediaByItem = new Map();
  for (const item of archive.items || []) {
    const key = item.id || item.url || null;
    if (key && Array.isArray(item.media) && item.media.length) {
      archiveMediaByItem.set(String(key), item.media);
    }
    if (item.url && Array.isArray(item.media) && item.media.length) {
      archiveMediaByItem.set(String(item.url), item.media);
    }
  }
  const pageItems = (pageResult.items || []).map((item) => {
    const key = item.id || item.url || null;
    const apiMedia = key ? archiveMediaByItem.get(String(key)) : null;
    return apiMedia?.length ? { ...item, media: apiMedia } : item;
  });
  const items = mergeByKey([
    ...archive.items,
    ...pageItems,
  ], (entry) => entry.id || entry.url || entry.text, settings.maxItems);
  const media = mergeByKey([
    ...(archive.media || []),
    ...items.flatMap((item) => item.media || []),
    ...(pageResult.media || []),
  ], (entry) => `${entry.type}:${entry.url}`, settings.maxItems * 5);
  return {
    ...pageResult,
    items,
    media,
    archive: {
      ...archive,
      domItemCount: pageResult.items?.length ?? 0,
      apiItemCount: archive.items?.length ?? 0,
      dedupedItemCount: items.length,
      boundarySignals: dedupeSortedStrings([
        ...(archive.boundarySignals ?? []),
        ...(pageResult.visibilitySignals ?? []),
        ...(pageResult.riskSignals ?? []),
      ]),
    },
    riskSignals: dedupeSortedStrings([
      ...(pageResult.riskSignals ?? []),
      ...(archive.riskSignals ?? []),
    ]),
    riskEvents: [
      ...(pageResult.riskEvents ?? []),
      ...(archive.riskEvents ?? []),
    ],
    stopReason: pageResult.stopReason || runtimeRiskToStopReason(pickRuntimeRiskSignal(archive.riskSignals ?? [])),
  };
}

function itemMatchesDateWindow(item, plan) {
  const timestamp = String(item?.timestamp ?? '');
  if (!timestamp) {
    return false;
  }
  const date = timestamp.slice(0, 10);
  if (plan.date) {
    return date === plan.date;
  }
  if (plan.fromDate && date < plan.fromDate) {
    return false;
  }
  if (plan.toDate && date > plan.toDate) {
    return false;
  }
  return true;
}

async function inferCurrentAccountFromPage(session, config, plan) {
  const state = await session.callPageFunction(pageExtractSocialState, config, {
    account: plan.account,
    action: plan.action,
    contentType: plan.contentType,
    date: plan.date,
    fromDate: plan.fromDate,
    toDate: plan.toDate,
  });
  return cleanText(state?.currentAccount || '');
}

async function enrichInstagramItemsFromDetails(session, config, plan, settings, account, items) {
  const enriched = [];
  const candidates = mergeByKey(items, (entry) => entry.url, settings.maxDetailPages)
    .filter((entry) => /^https:\/\/www\.instagram\.com\/(?:p|reel|tv)\//iu.test(String(entry.url ?? '')));
  for (const item of candidates) {
    if (enriched.length >= settings.maxItems) {
      break;
    }
    await session.navigateAndWait(item.url, createWaitPolicy(settings.timeoutMs));
    const detail = await collectSocialPage(session, config, {
      ...plan,
      account,
      action: 'profile-content',
    }, {
      ...settings,
      maxScrolls: 0,
      maxItems: 1,
    });
    const detailItem = (detail.items || []).find((entry) => itemMatchesDateWindow(entry, plan));
    if (detailItem) {
      enriched.push({
        ...item,
        ...detailItem,
        url: detailItem.url || item.url,
        timestamp: detailItem.timestamp || item.timestamp || null,
        author: detailItem.author ?? item.author ?? (account ? { handle: account } : null),
        sourceAccount: account,
        source: detailItem.source || 'detail-date-scan',
      });
    }
  }
  return enriched;
}

async function collectInstagramFollowedPostsByProfiles(session, config, plan, settings, checkpoint = null, apiCapture = null) {
  const currentAccount = plan.account || await inferCurrentAccountFromPage(session, config, plan);
  if (!currentAccount) {
    return {
      finalUrl: plan.url,
      title: null,
      currentAccount: null,
      account: null,
      items: [],
      relations: [],
      media: [],
      archive: {
        strategy: 'followed-profile-date-scan',
        complete: false,
        reason: 'current-account-not-detected',
        scannedUsers: 0,
      },
    };
  }
  const relationPlan = {
    ...plan,
    action: 'followed-users',
    account: currentAccount,
    url: buildUrlFromTemplate(config, config.routes.following, currentAccount),
  };
  await session.navigateAndWait(relationPlan.url, createWaitPolicy(settings.timeoutMs));
  const surfacePreparation = await prepareSocialRelationSurface(session, config, relationPlan, settings);
  const relationResult = await collectSocialPage(session, config, relationPlan, {
    ...settings,
    maxItems: settings.maxUsers,
  });
  const users = relationResult.relations || [];
  const previousArchive = settings.resume ? checkpoint?.previousState?.archive : null;
  const collectedItems = settings.resume ? [...(checkpoint?.previousItems || [])] : [];
  const collectedMedia = collectedItems.flatMap((entry) => entry.media || []);
  const scannedUsers = settings.resume && Array.isArray(previousArchive?.scannedUsers)
    ? [...previousArchive.scannedUsers]
    : [];
  const scannedHandles = new Set(scannedUsers.map((entry) => cleanText(entry?.handle || '').toLowerCase()).filter(Boolean));
  let scanStopReason = relationResult.stopReason || runtimeRiskToStopReason(pickRuntimeRiskSignal(relationResult.riskSignals ?? []));
  for (const user of users.slice(0, settings.maxUsers)) {
    if (scanStopReason || collectedItems.length >= settings.maxItems) {
      break;
    }
    const account = user.handle;
    if (!account) {
      continue;
    }
    if (scannedHandles.has(cleanText(account || '').toLowerCase())) {
      continue;
    }
    const profilePlan = {
      ...plan,
      action: 'profile-content',
      account,
      url: buildUrlFromTemplate(config, config.routes.posts, account),
    };
    const apiCaptureStartIndex = apiCapture?.mark?.() ?? 0;
    await session.navigateAndWait(profilePlan.url, createWaitPolicy(settings.timeoutMs));
    const profileResult = await collectSocialPage(session, config, profilePlan, {
      ...settings,
      maxItems: Math.min(settings.perUserMaxItems, settings.maxItems),
    });
    let profileStopReason = profileResult.stopReason || runtimeRiskToStopReason(pickRuntimeRiskSignal(profileResult.riskSignals ?? []));
    const apiProfileArchive = settings.apiCursor
      ? await collectSocialApiArchive(session, config, profilePlan, {
        ...settings,
        maxItems: Math.min(settings.perUserMaxItems, settings.maxItems),
      }, apiCapture, null, {
        captureStartIndex: apiCaptureStartIndex,
        includeCheckpointItems: false,
      })
      : null;
    profileStopReason = profileStopReason || runtimeRiskToStopReason(pickRuntimeRiskSignal(apiProfileArchive?.riskSignals ?? []));
    const apiMatchedItems = (apiProfileArchive?.items || [])
      .filter((entry) => itemMatchesDateWindow(entry, plan))
      .map((entry) => ({
        ...entry,
        sourceAccount: account,
        source: entry.source || 'api-profile-date-scan',
      }));
    let matchedItems = [
      ...apiMatchedItems,
      ...(profileResult.items || [])
        .filter((entry) => itemMatchesDateWindow(entry, plan))
        .map((entry) => ({
          ...entry,
          sourceAccount: account,
        })),
    ];
    matchedItems = mergeByKey(matchedItems, (entry) => entry.id || entry.url || `${entry.sourceAccount}:${entry.text}`, settings.perUserMaxItems);
    if (matchedItems.length === 0 && (profileResult.items || []).some((entry) => entry.url && !entry.timestamp)) {
      matchedItems = await enrichInstagramItemsFromDetails(session, config, plan, settings, account, profileResult.items || []);
    }
    collectedItems.push(...matchedItems);
    collectedMedia.push(...matchedItems.flatMap((entry) => entry.media || []));
    scannedUsers.push({
      handle: account,
      url: user.url,
      finalUrl: profileResult.finalUrl ?? profilePlan.url,
      visibleItems: profileResult.items?.length ?? 0,
      apiItems: apiProfileArchive?.items?.length ?? 0,
      apiReason: apiProfileArchive?.reason ?? null,
      matchedItems: matchedItems.length,
      visibilitySignals: profileResult.visibilitySignals ?? [],
      riskSignals: dedupeSortedStrings([
        ...(profileResult.riskSignals ?? []),
        ...(apiProfileArchive?.riskSignals ?? []),
      ]),
      stopReason: profileStopReason ?? null,
    });
    if (profileStopReason) {
      scanStopReason = profileStopReason;
    }
    scannedHandles.add(cleanText(account || '').toLowerCase());
    const runningItems = mergeByKey(collectedItems, (entry) => entry.url || `${entry.sourceAccount}:${entry.text}`, settings.maxItems);
    await checkpoint?.write?.({
      status: 'running',
      archive: {
        strategy: 'followed-profile-date-scan',
        complete: false,
        reason: scanStopReason || 'running',
        scannedUsers,
        boundarySignals: dedupeSortedStrings([
          ...(relationResult.visibilitySignals ?? []),
          ...(relationResult.riskSignals ?? []),
          ...scannedUsers.flatMap((entry) => [...(entry.visibilitySignals ?? []), ...(entry.riskSignals ?? [])]),
        ]),
      },
      counts: {
        items: runningItems.length,
        media: runningItems.flatMap((entry) => entry.media || []).length,
      },
    });
  }
  const items = mergeByKey(collectedItems, (entry) => entry.url || `${entry.sourceAccount}:${entry.text}`, settings.maxItems);
  const boundarySignals = dedupeSortedStrings([
    ...(relationResult.visibilitySignals ?? []),
    ...(relationResult.riskSignals ?? []),
    ...scannedUsers.flatMap((entry) => [...(entry.visibilitySignals ?? []), ...(entry.riskSignals ?? [])]),
  ]);
  const boundaryCounts = {
    privateOrUnavailable: scannedUsers.filter((entry) => (entry.visibilitySignals ?? []).some((signal) => ['private-account', 'deleted-or-unavailable', 'age-or-region-restricted'].includes(signal))).length,
    riskBlocked: scannedUsers.filter((entry) => (entry.riskSignals ?? []).length || entry.stopReason).length,
    noVisibleItems: scannedUsers.filter((entry) => entry.visibleItems === 0 && entry.apiItems === 0).length,
    missingMatchedItems: scannedUsers.filter((entry) => entry.matchedItems === 0).length,
  };
  const archiveReason = scanStopReason
    ? scanStopReason
    : users.length >= settings.maxUsers
      ? 'max-users'
      : items.length >= settings.maxItems
        ? 'max-items'
        : boundarySignals.length > 0
          ? 'platform-boundary-signals'
          : 'unverified-following-pagination';
  const confidence = scanStopReason || boundaryCounts.riskBlocked > 0
    ? 'risk-blocked'
    : boundaryCounts.privateOrUnavailable > 0
      ? 'private-or-unavailable'
      : items.some((entry) => !entry.timestamp) || boundaryCounts.missingMatchedItems > 0
        ? 'missing-detail-time'
        : users.length >= settings.maxUsers
          ? 'bounded-by-max-users'
          : 'verified-complete';
  return {
    finalUrl: relationResult.finalUrl,
    title: relationResult.title,
    currentAccount,
    account: {
      handle: currentAccount,
      displayName: relationResult.account?.displayName ?? null,
      bio: relationResult.account?.bio ?? null,
      stats: relationResult.account?.stats ?? [],
    },
    items,
    relations: users,
    media: mergeByKey(collectedMedia, (entry) => `${entry.type}:${entry.url}`, settings.maxItems * 5),
    surfacePreparation,
    visibilitySignals: dedupeSortedStrings([
      ...(relationResult.visibilitySignals ?? []),
      ...scannedUsers.flatMap((entry) => entry.visibilitySignals ?? []),
    ]),
    riskSignals: dedupeSortedStrings([
      ...(relationResult.riskSignals ?? []),
      ...scannedUsers.flatMap((entry) => entry.riskSignals ?? []),
    ]),
    riskEvents: [
      ...(relationResult.riskEvents ?? []),
    ],
    stopReason: scanStopReason,
    archive: {
      strategy: 'followed-profile-date-scan',
      complete: false,
      reason: archiveReason,
      confidence,
      boundarySignals,
      boundaryCounts,
      scannedUsers,
    },
  };
}

function selectResultPayload(plan, pageResult) {
  const runtimeFields = {
    visibilitySignals: pageResult.visibilitySignals ?? [],
    riskSignals: pageResult.riskSignals ?? [],
    riskEvents: pageResult.riskEvents ?? [],
    stopReason: pageResult.stopReason ?? null,
  };
  if (plan.action === 'account-info') {
    return {
      queryType: 'account-info',
      account: pageResult.account,
      currentAccount: pageResult.currentAccount,
      finalUrl: pageResult.finalUrl,
      title: pageResult.title,
      ...runtimeFields,
    };
  }
  if (plan.action === 'profile-following' || plan.action === 'profile-followers' || plan.action === 'followed-users') {
    return {
      queryType: plan.action,
      account: pageResult.account,
      users: pageResult.relations,
      finalUrl: pageResult.finalUrl,
      title: pageResult.title,
      archive: pageResult.archive ?? null,
      ...runtimeFields,
    };
  }
  return {
    queryType: plan.action,
    contentType: plan.contentType,
    account: pageResult.account,
    items: pageResult.items,
    media: pageResult.media,
    finalUrl: pageResult.finalUrl,
    title: pageResult.title,
    archive: pageResult.archive ?? null,
    ...runtimeFields,
  };
}

function mergeCheckpointItemsIntoPayload(payload, checkpoint, settings) {
  const previousItems = settings.resume ? (checkpoint?.previousItems || []) : [];
  if (!previousItems.length || !Array.isArray(payload?.items)) {
    return payload;
  }
  const items = mergeByKey([
    ...previousItems,
    ...payload.items,
  ], (entry) => entry.id || entry.url || entry.text, settings.maxItems);
  return {
    ...payload,
    items,
    media: mergeByKey([
      ...(Array.isArray(payload.media) ? payload.media : []),
      ...items.flatMap((item) => item.media || []),
    ], (entry) => `${entry.type}:${entry.url}`, settings.maxItems * 5),
  };
}

function summarizeRuntimeRisk(pageResult = {}, settings = {}) {
  const riskSignals = dedupeSortedStrings([
    ...(pageResult.riskSignals ?? []),
    ...(pageResult.archive?.boundarySignals ?? []).filter((signal) => ['challenge', 'login-wall', 'rate-limited'].includes(signal)),
  ]);
  const stopReason = pageResult.stopReason || pageResult.archive?.reason || null;
  const riskEvents = Array.isArray(pageResult.riskEvents) ? pageResult.riskEvents : [];
  const authExpired = stopReason === 'login-wall' || stopReason === 'challenge' || riskSignals.includes('login-wall') || riskSignals.includes('challenge');
  const rateLimited = stopReason === 'rate-limited' || riskSignals.includes('rate-limited');
  const hardStop = authExpired || rateLimited;
  const rateLimitEvents = riskEvents.filter((entry) => entry.status === 429 || entry.signal === 'rate-limited' || (entry.riskSignals ?? []).includes('rate-limited'));
  const adaptiveThrottleLevel = Math.max(0, ...rateLimitEvents.map((entry) => Number(entry.adaptiveThrottleLevel) || 0), rateLimited ? 1 : 0);
  const adaptiveBackoffMs = Math.max(0, ...rateLimitEvents.map((entry) => Number(entry.adaptiveBackoffMs ?? entry.waitMs) || 0));
  const suggestedAction = authExpired
    ? 'refresh-login-session'
    : rateLimited
      ? 'pause-and-retry-later'
      : null;
  return {
    riskSignals,
    stopReason,
    riskEvents,
    riskRetries: settings.riskRetries ?? 0,
    riskBackoffMs: settings.riskBackoffMs ?? 0,
    adaptiveBackoffMs,
    adaptiveThrottleLevel,
    authExpired,
    rateLimited,
    hardStop,
    suggestedAction,
  };
}

function summarizeSocialAuthHealth(plan, settings, authContext = {}, authResult = null, runtimeRisk = null) {
  if (!plan.requiresAuth) {
    return {
      required: false,
      status: 'not-required',
      identityConfirmed: false,
      needsRecovery: runtimeRisk?.authExpired === true,
      recoveryReason: runtimeRisk?.authExpired ? runtimeRisk.stopReason : null,
    };
  }
  const status = String(authResult?.status ?? 'not-checked');
  const identityConfirmed = authResult?.loginState?.identityConfirmed === true;
  const loggedIn = authResult?.loginState?.loggedIn === true || authResult?.loggedIn === true;
  const challengeRequired = authResult?.challengeRequired === true || authResult?.loginState?.hasChallenge === true;
  const healthy = identityConfirmed || loggedIn || status === 'already-authenticated' || status === 'authenticated';
  const runtimeAuthExpired = runtimeRisk?.authExpired === true;
  const profilePath = settings.profilePath ? path.resolve(settings.profilePath) : SOCIAL_SITES[plan.siteKey].defaultProfilePath;
  const recoveryCommand = `node .\\src\\entrypoints\\sites\\site-login.mjs ${SOCIAL_SITES[plan.siteKey].homeUrl} --profile-path ${profilePath} --no-headless --reuse-login-state`;
  const recoveryReason = runtimeAuthExpired
    ? `session-${runtimeRisk.stopReason || 'expired'}`
    : healthy
      ? null
      : challengeRequired
        ? 'challenge-required'
        : status;
  return {
    required: true,
    status,
    loggedIn,
    identityConfirmed,
    identitySource: authResult?.loginState?.identitySource ?? null,
    challengeRequired,
    challengeText: authResult?.challengeText ?? authResult?.loginState?.challengeText ?? null,
    reuseLoginState: authContext?.reuseLoginState === true,
    userDataDir: authContext?.userDataDir ?? null,
    profilePath,
    runtimeAuthExpired,
    runtimeStopReason: runtimeRisk?.stopReason ?? null,
    needsRecovery: runtimeAuthExpired || !healthy,
    recoveryCommand,
    recoveryReason,
    recoverySteps: recoveryReason ? [
      'Stop this collection run and keep the artifact directory for --resume.',
      recoveryCommand,
      'Re-run the same social action with --resume after the browser profile is healthy.',
    ] : [],
  };
}

async function readPassthroughHeaders(passthrough) {
  if (!passthrough?.sidecarPath) {
    return {};
  }
  try {
    const sidecar = await readJsonFile(passthrough.sidecarPath);
    return sidecar?.headers && typeof sidecar.headers === 'object' ? sidecar.headers : {};
  } catch {
    return {};
  }
}

function renderMarkdownReport(result) {
  const lines = [
    `# ${result.siteKey} ${result.plan.action}`,
    '',
    `- URL: ${result.plan.url}`,
    `- Status: ${result.ok ? 'ok' : 'failed'}`,
    `- Items: ${result.result?.items?.length ?? 0}`,
    `- Users: ${result.result?.users?.length ?? 0}`,
    `- Media: ${result.result?.media?.length ?? 0}`,
  ];
  if (result.outcome) {
    lines.push(`- Outcome: ${result.outcome.status}${result.outcome.reason ? ` (${result.outcome.reason})` : ''}`);
  }
  if (result.download?.downloads?.length) {
    lines.push(`- Downloaded files: ${result.download.downloads.filter((entry) => entry.ok).length}/${result.download.downloads.length}`);
  }
  if (result.runtimeRisk?.riskSignals?.length || result.runtimeRisk?.stopReason) {
    lines.push(`- Runtime risk: ${result.runtimeRisk.stopReason || result.runtimeRisk.riskSignals.join(', ')}`);
    if (result.runtimeRisk.suggestedAction) {
      lines.push(`- Runtime action: ${result.runtimeRisk.suggestedAction}`);
    }
    if (result.runtimeRisk.riskEvents?.length) {
      lines.push(`- Runtime risk retries: ${result.runtimeRisk.riskEvents.filter((entry) => entry.retryable).length}/${result.runtimeRisk.riskRetries}`);
    }
  }
  if (result.authHealth?.required) {
    lines.push(`- Auth status: ${result.authHealth.status}${result.authHealth.identityConfirmed ? ' (identity confirmed)' : ''}`);
    if (result.authHealth.needsRecovery && result.authHealth.recoveryCommand) {
      lines.push(`- Auth recovery: ${result.authHealth.recoveryCommand}`);
    }
  }
  if (result.sessionProvider || result.sessionHealth || result.sessionGate) {
    const gate = result.sessionGate ?? buildSocialSessionGate(result, {
      requiresAuth: result.authHealth?.required === true,
    });
    lines.push(`- Session provider: ${result.sessionProvider ?? 'unknown'}`);
    lines.push(`- Session traceability gate: ${gate.status} (${gate.reason})`);
    if (result.sessionHealth?.artifacts?.manifest) {
      lines.push(`- Session health manifest: ${result.sessionHealth.artifacts.manifest}`);
    }
    const repairCommand = buildSocialSessionRepairCommand(result, gate);
    if (repairCommand) {
      lines.push(`- Next session repair command: ${repairCommand}`);
    }
  }
  if (result.result?.archive) {
    lines.push(`- Archive strategy: ${result.result.archive.strategy || 'unknown'}`);
    lines.push(`- Archive complete: ${formatArchiveComplete(result.result.archive.complete)}`);
    if (result.result.archive.reason) {
      lines.push(`- Archive stop reason: ${result.result.archive.reason}`);
    }
  }
  if (result.completeness) {
    lines.push(`- Completeness status: ${result.completeness.status}`);
    if (result.completeness.boundedReasons?.length) {
      lines.push(`- Bounded by: ${result.completeness.boundedReasons.join(', ')}`);
    }
    if (result.completeness.driftReasons?.length) {
      lines.push(`- Parser/API drift: ${result.completeness.driftReasons.join(', ')}`);
    }
    lines.push(`- API pages: ${result.completeness.apiPages ?? 0}`);
    if (result.completeness.domItemCount !== null || result.completeness.apiItemCount !== null) {
      lines.push(`- DOM/API/deduped items: ${result.completeness.domItemCount ?? 'unknown'}/${result.completeness.apiItemCount ?? 'unknown'}/${result.completeness.dedupedItemCount ?? 'unknown'}`);
    }
    lines.push(`- Missing time/author: ${result.completeness.missingTimestampCount}/${result.completeness.missingAuthorCount}`);
    if (result.completeness.platformBoundarySignals?.length) {
      lines.push(`- Platform boundaries: ${result.completeness.platformBoundarySignals.join(', ')}`);
    }
    if (result.completeness.download) {
      lines.push(`- Media expected/attempted/ok: ${result.completeness.download.expectedMediaCount}/${result.completeness.download.attemptedCount}/${result.completeness.download.okCount}`);
      lines.push(`- Media skipped/incomplete items: ${result.completeness.download.skippedMediaCount}/${result.completeness.download.incompleteItemCount}`);
      if (result.completeness.download.highestVideoBitrate || result.completeness.download.largestMediaArea) {
        lines.push(`- Media quality max bitrate/area: ${result.completeness.download.highestVideoBitrate}/${result.completeness.download.largestMediaArea}`);
      }
    }
  }
  if (result.recoveryRunbook?.commands?.length) {
    lines.push('- Recovery runbook: actionable');
    for (const command of result.recoveryRunbook.commands) {
      lines.push(`  - ${command.id}: ${command.command}`);
    }
  }
  lines.push('');
  for (const item of result.result?.items ?? []) {
    lines.push(`## ${item.url || 'item'}`);
    if (item.timestamp) {
      lines.push(`- Time: ${item.timestamp}`);
    }
    if (item.text) {
      lines.push('');
      lines.push(item.text);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

function buildSocialSessionGate(result = {}, { requiresAuth = false } = {}) {
  return evaluateAuthenticatedSessionReleaseGate({
    authHealth: { required: requiresAuth },
    sessionProvider: result.sessionProvider,
    sessionHealth: result.sessionHealth,
  }, {
    requiresAuth,
  });
}

function buildSocialSessionRepairCommand(result = {}, gate = {}) {
  if (gate.status !== 'blocked') {
    return null;
  }
  const site = result.siteKey ?? result.plan?.siteKey ?? result.plan?.site;
  if (!site) {
    return null;
  }
  return buildSessionRepairPlanCommand({ site, reason: gate.reason })?.commandText ?? null;
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  return `"${text.replace(/"/gu, '""')}"`;
}

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function relativeIndexHref(filePath, layout) {
  if (!filePath) {
    return '';
  }
  const relative = path.relative(layout.runDir, filePath);
  const parts = relative.split(path.sep).filter(Boolean).map((part) => encodeURIComponent(part));
  return parts.join('/');
}

function collectDownloadsForIndex(downloads = []) {
  const byKey = new Map();
  const add = (key, entry) => {
    if (!key) {
      return;
    }
    const normalized = String(key);
    if (!byKey.has(normalized)) {
      byKey.set(normalized, []);
    }
    byKey.get(normalized).push(entry);
  };
  for (const download of Array.isArray(downloads) ? downloads : []) {
    if (download?.ok !== true) {
      continue;
    }
    add(download.itemId, download);
    add(download.pageUrl, download);
    for (const reference of download.references || []) {
      add(reference.itemId, download);
      add(reference.pageUrl, download);
    }
  }
  return byKey;
}

function socialIndexRows(result, layout) {
  const items = Array.isArray(result?.result?.items) ? result.result.items : [];
  const downloadsByKey = collectDownloadsForIndex(result?.download?.downloads || []);
  return items.map((item, index) => {
    const media = Array.isArray(item.media) ? item.media : [];
    const keys = [item.id, item.url].filter(Boolean).map(String);
    const downloads = mergeByKey(
      keys.flatMap((key) => downloadsByKey.get(key) || []),
      (entry) => entry.filePath || entry.url,
      Number.MAX_SAFE_INTEGER,
    );
    const files = downloads.map((entry) => entry.filePath).filter(Boolean);
    return {
      index: index + 1,
      id: item.id ?? '',
      url: item.url ?? '',
      timestamp: item.timestamp ?? '',
      author: item.author?.handle ?? item.sourceAccount ?? '',
      caption: item.text ?? '',
      mediaCount: media.length,
      imageCount: media.filter((entry) => entry.type === 'image').length,
      videoCount: media.filter((entry) => entry.type === 'video').length,
      downloadedCount: files.length,
      localFiles: files,
      localHrefs: files.map((filePath) => relativeIndexHref(filePath, layout)),
    };
  });
}

function renderSocialIndexCsv(result, layout) {
  const header = [
    'index',
    'id',
    'url',
    'timestamp',
    'author',
    'caption',
    'media_count',
    'image_count',
    'video_count',
    'downloaded_count',
    'local_files',
  ];
  const rows = socialIndexRows(result, layout).map((row) => [
    row.index,
    row.id,
    row.url,
    row.timestamp,
    row.author,
    row.caption,
    row.mediaCount,
    row.imageCount,
    row.videoCount,
    row.downloadedCount,
    row.localFiles,
  ].map(csvCell).join(','));
  return `${header.map(csvCell).join(',')}\n${rows.join('\n')}${rows.length ? '\n' : ''}`;
}

function renderSocialIndexHtml(result, layout) {
  const rows = socialIndexRows(result, layout);
  const title = `${result.siteKey} ${result.plan?.account || result.plan?.query || result.plan?.action || 'archive'}`;
  const bodyRows = rows.map((row) => {
    const links = row.localFiles.length
      ? row.localFiles.map((filePath, index) => {
        const href = row.localHrefs[index];
        return `<a href="${htmlEscape(href)}">${htmlEscape(path.basename(filePath))}</a>`;
      }).join('<br>')
      : '';
    return `<tr>
      <td>${row.index}</td>
      <td><a href="${htmlEscape(row.url)}">${htmlEscape(row.url || row.id)}</a></td>
      <td>${htmlEscape(row.timestamp)}</td>
      <td>${htmlEscape(row.author)}</td>
      <td class="caption">${htmlEscape(row.caption)}</td>
      <td>${row.mediaCount}</td>
      <td>${row.imageCount}</td>
      <td>${row.videoCount}</td>
      <td>${row.downloadedCount}</td>
      <td class="files">${links}</td>
    </tr>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 24px; color: #1f2933; background: #f8fafc; }
    h1 { font-size: 22px; margin: 0 0 16px; }
    table { width: 100%; border-collapse: collapse; background: white; }
    th, td { border: 1px solid #d9e2ec; padding: 8px; font-size: 13px; vertical-align: top; }
    th { text-align: left; background: #eef2f6; position: sticky; top: 0; }
    .caption { max-width: 420px; white-space: pre-wrap; }
    .files { min-width: 180px; }
    a { color: #1d4ed8; }
  </style>
</head>
<body>
  <h1>${htmlEscape(title)}</h1>
  <table>
    <thead>
      <tr><th>#</th><th>Post</th><th>Time</th><th>Author</th><th>Caption</th><th>Media</th><th>Images</th><th>Videos</th><th>Downloaded</th><th>Files</th></tr>
    </thead>
    <tbody>
${bodyRows}
    </tbody>
  </table>
</body>
</html>
`;
}

function createArtifactSlug(plan) {
  return compactSlug([
    plan.action,
    plan.account || plan.query || 'current',
    plan.contentType || '',
    plan.date || plan.fromDate || '',
  ].filter(Boolean).join('-'), 'social-run');
}

function artifactPathSummary(layout) {
  return {
    runDir: layout.runDir,
    manifest: layout.manifestPath,
    items: layout.itemsJsonlPath,
    mediaDir: layout.mediaDir,
    state: layout.statePath,
    report: layout.reportPath,
    apiCapture: layout.apiCapturePath,
    apiDriftSamples: layout.apiDriftSamplesPath,
    downloads: layout.downloadsJsonlPath,
    mediaManifest: layout.mediaHashManifestPath,
    mediaQueue: layout.mediaQueuePath,
    indexCsv: layout.indexCsvPath,
    indexHtml: layout.indexHtmlPath,
  };
}

function buildSocialArtifactLayout(plan, settings) {
  const runDir = settings.runDir
    ? path.resolve(settings.runDir)
    : path.join(settings.outputRoot, `${settings.artifactRunId}-${createArtifactSlug(plan)}`);
  return {
    runDir,
    manifestPath: path.join(runDir, 'manifest.json'),
    itemsJsonlPath: path.join(runDir, 'items.jsonl'),
    mediaDir: path.join(runDir, 'media'),
    statePath: path.join(runDir, 'state.json'),
    reportPath: path.join(runDir, 'report.md'),
    apiCapturePath: path.join(runDir, 'api-capture-debug.json'),
    apiDriftSamplesPath: path.join(runDir, 'api-drift-samples.json'),
    downloadsJsonlPath: path.join(runDir, 'downloads.jsonl'),
    mediaHashManifestPath: path.join(runDir, 'media-manifest.json'),
    mediaQueuePath: path.join(runDir, 'media-queue.json'),
    indexCsvPath: path.join(runDir, 'index.csv'),
    indexHtmlPath: path.join(runDir, 'index.html'),
  };
}

function safePlanForArtifact(plan) {
  return {
    siteKey: plan.siteKey,
    host: plan.host,
    action: plan.action,
    contentType: plan.contentType,
    account: plan.account,
    query: plan.query,
    date: plan.date,
    fromDate: plan.fromDate,
    toDate: plan.toDate,
    url: plan.url,
    plannerNotes: plan.plannerNotes,
  };
}

function safeSettingsForArtifact(settings) {
  return {
    maxItems: settings.maxItems,
    maxScrolls: settings.maxScrolls,
    scrollWaitMs: settings.scrollWaitMs,
    fullArchive: settings.fullArchive,
    apiCursor: settings.apiCursor,
    apiCursorSuppressed: settings.apiCursorSuppressed,
    maxApiPages: settings.maxApiPages,
    maxUsers: settings.maxUsers,
    maxDetailPages: settings.maxDetailPages,
    perUserMaxItems: settings.perUserMaxItems,
    maxMediaDownloads: settings.maxMediaDownloads,
    mediaDownloadConcurrency: settings.mediaDownloadConcurrency,
    mediaDownloadRetries: settings.mediaDownloadRetries,
    mediaDownloadBackoffMs: settings.mediaDownloadBackoffMs,
    skipExistingDownloads: settings.skipExistingDownloads,
    riskBackoffMs: settings.riskBackoffMs,
    riskRetries: settings.riskRetries,
    apiRetries: settings.apiRetries,
    followedDateMode: settings.followedDateMode,
    downloadMedia: settings.downloadMedia,
    resume: settings.resume,
    outputRoot: settings.outputRoot,
    runDir: settings.runDir,
  };
}

function extractArtifactRows(result) {
  const payload = result?.result || {};
  if (Array.isArray(payload.items) && payload.items.length) {
    return payload.items.map((entry) => ({ kind: 'item', ...entry }));
  }
  if (Array.isArray(payload.users) && payload.users.length) {
    return payload.users.map((entry) => ({ kind: 'user', ...entry }));
  }
  if (payload.queryType === 'account-info' && payload.account) {
    return [{ kind: 'account', ...payload.account }];
  }
  if (Array.isArray(payload.media) && payload.media.length) {
    return payload.media.map((entry) => ({ kind: 'media', ...entry }));
  }
  return [];
}

function artifactCounts(result, rows = extractArtifactRows(result)) {
  return {
    rows: rows.length,
    items: result?.result?.items?.length ?? 0,
    users: result?.result?.users?.length ?? 0,
    media: result?.result?.media?.length ?? 0,
    downloads: result?.download?.downloads?.length ?? 0,
    downloaded: result?.download?.downloads?.filter((entry) => entry.ok).length ?? 0,
  };
}

function formatArchiveComplete(value) {
  if (value === true) {
    return 'yes';
  }
  if (value === false) {
    return 'no';
  }
  return 'unknown';
}

function quoteCommandArg(value) {
  const text = String(value ?? '');
  if (/^[A-Za-z0-9_./:@=\\-]+$/u.test(text)) {
    return text;
  }
  return `"${text.replace(/"/gu, '\\"')}"`;
}

function buildSocialActionRecoveryCommand(result, layout, extraArgs = []) {
  const plan = result.plan || {};
  const settings = result.settings || result._settings || {};
  const script = path.join('src', 'entrypoints', 'sites', `${plan.siteKey || result.siteKey}-action.mjs`);
  const action = settings.fullArchive && plan.action === 'profile-content' ? 'full-archive' : (plan.action || 'profile-content');
  const args = [script, action];
  if (plan.account && !['followed-users', 'followed-posts-by-date', 'search'].includes(plan.action)) {
    args.push(plan.account);
  }
  if (plan.action === 'profile-content' && plan.contentType && action !== 'full-archive') {
    args.push('--content-type', plan.contentType);
  }
  if (plan.date) {
    args.push('--date', plan.date);
  }
  if (plan.query) {
    args.push('--query', plan.query);
  }
  args.push(
    '--run-dir',
    layout.runDir,
    '--resume',
    '--reuse-login-state',
    settings.headless ? '--headless' : '--no-headless',
    '--max-items',
    String(settings.maxItems ?? DEFAULT_MAX_ITEMS),
    '--timeout',
    String(settings.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  );
  if (settings.apiCursor === false) {
    args.push('--no-api-cursor');
  }
  if (settings.maxApiPages !== undefined) {
    args.push('--max-api-pages', String(settings.maxApiPages));
  }
  if (settings.downloadMedia) {
    args.push('--download-media', '--max-media-downloads', String(settings.maxMediaDownloads ?? DEFAULT_MAX_MEDIA_DOWNLOADS));
  }
  if (settings.riskBackoffMs !== undefined) {
    args.push('--risk-backoff-ms', String(settings.riskBackoffMs));
  }
  if (settings.riskRetries !== undefined) {
    args.push('--risk-retries', String(settings.riskRetries));
  }
  args.push(...extraArgs);
  return ['node', ...args].map(quoteCommandArg).join(' ');
}

function buildRecoveryRunbook(result, layout) {
  const commands = [];
  const addCommand = (id, reason, command, explanation) => {
    if (!command || commands.some((entry) => entry.id === id && entry.command === command)) {
      return;
    }
    commands.push({ id, reason, command, explanation });
  };
  const site = result.plan?.siteKey || result.siteKey || 'x';
  const resumeCommand = buildSocialActionRecoveryCommand(result, layout);
  if (result.authHealth?.needsRecovery) {
    addCommand(
      'recover-auth-session',
      result.authHealth.recoveryReason || 'auth-recovery-needed',
      result.authHealth.recoveryCommand,
      'Open a visible login recovery flow before resuming this artifact directory.',
    );
    addCommand(
      'resume-after-auth',
      'auth-recovery-needed',
      resumeCommand,
      'Resume the same action after the reusable browser profile is healthy.',
    );
  }
  if (result.runtimeRisk?.rateLimited || result.outcome?.reason === 'api-rate-limited') {
    addCommand(
      'resume-after-cooldown',
      'rate-limited',
      ['node', path.join('scripts', 'social-live-resume.mjs'), '--state', layout.manifestPath, '--site', site, '--execute', '--cooldown-minutes', '30', '--max-attempts', '3'].map(quoteCommandArg).join(' '),
      'Let the cooldown expire, then let the resume runner continue from the saved cursor/state.',
    );
  }
  if (result.completeness?.driftReasons?.length) {
    addCommand(
      'inspect-api-drift',
      result.completeness.driftReasons[0],
      ['node', path.join('scripts', 'social-live-report.mjs'), '--runs-root', layout.runDir, '--site', site].map(quoteCommandArg).join(' '),
      `Inspect ${path.basename(layout.apiCapturePath)} and ${path.basename(layout.apiDriftSamplesPath)} before changing API parsing rules.`,
    );
  }
  const downloadSummary = result.completeness?.download;
  if (
    result.download
    && (
      result.outcome?.reason === 'media-download-incomplete'
      || result.outcome?.reason === 'media-content-type-mismatch'
      || Number(downloadSummary?.failedCount) > 0
      || Number(downloadSummary?.contentTypeMismatchCount) > 0
    )
  ) {
    addCommand(
      'resume-media-downloads',
      result.outcome?.reason || 'media-download-incomplete',
      buildSocialActionRecoveryCommand(result, layout, ['--download-media']),
      'Retry only the missing or failed media by reusing downloads.jsonl and media-queue.json.',
    );
  }
  if (result.result?.archive?.complete === false && result.outcome?.resumable && commands.length === 0) {
    addCommand(
      'resume-archive',
      result.result.archive.reason || 'archive-incomplete',
      resumeCommand,
      'Continue the archive from the saved cursor/state in this artifact directory.',
    );
  }
  return {
    status: commands.length ? 'actionable' : 'none',
    generatedAt: new Date().toISOString(),
    commands,
  };
}

function spawnJsonCommand(command, args, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      if (!settled) {
        child.kill('SIGTERM');
      }
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.on('data', (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-1_000_000);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-20_000);
    });
    child.once('error', (error) => {
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: error?.message ?? String(error), stdout, stderr });
    });
    child.once('exit', (code, signal) => {
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ ok: false, code, signal, error: stderr.trim() || `${command} exited with code ${code}`, stdout, stderr });
        return;
      }
      try {
        resolve({ ok: true, json: JSON.parse(stdout), stdout, stderr });
      } catch (error) {
        resolve({ ok: false, code, signal, error: error?.message ?? String(error), stdout, stderr });
      }
    });
  });
}

async function probeVideoFile(filePath) {
  const result = await spawnJsonCommand('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  if (!result.ok) {
    const unavailable = /not recognized|not found|ENOENT|spawn ffprobe ENOENT/iu.test(String(result.error));
    return {
      status: unavailable ? 'skipped' : 'failed',
      reason: unavailable ? 'ffprobe-unavailable' : 'ffprobe-failed',
      error: result.error,
    };
  }
  const streams = Array.isArray(result.json?.streams) ? result.json.streams : [];
  const video = streams.find((stream) => String(stream.codec_type).toLowerCase() === 'video') || null;
  return {
    status: video ? 'passed' : 'failed',
    reason: video ? null : 'video-stream-missing',
    codec: video?.codec_name ?? null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    durationSeconds: Number(video?.duration ?? result.json?.format?.duration) || null,
    bitRate: Number(video?.bit_rate ?? result.json?.format?.bit_rate) || null,
  };
}

async function hashFileSha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

function expectedMinimumBytes(entry = {}) {
  if (entry.type === 'video') {
    return 1024;
  }
  if (entry.type === 'image') {
    return 16;
  }
  return 1;
}

async function buildMediaValidationManifest(result, layout) {
  const downloads = Array.isArray(result.download?.downloads) ? result.download.downloads : [];
  const entries = [];
  for (const download of downloads) {
    const entry = {
      ok: download.ok === true,
      url: download.url ?? null,
      type: download.type ?? null,
      fallbackFrom: download.fallbackFrom ?? null,
      expectedType: download.expectedType ?? null,
      itemId: download.itemId ?? null,
      pageUrl: download.pageUrl ?? null,
      filePath: download.filePath ?? null,
      transport: download.transport ?? null,
      bytes: download.bytes ?? null,
      contentType: download.contentType ?? null,
      contentTypeMatchesExpected: download.contentTypeMatchesExpected ?? null,
      declaredHash: download.contentHash ?? null,
      sha256: null,
      hashMatchesDeclared: null,
      anomalies: [],
      probe: null,
    };
    if (!entry.ok || !entry.filePath) {
      entry.anomalies.push('download-failed');
      entries.push(entry);
      continue;
    }
    try {
      const fileStat = await stat(entry.filePath);
      entry.bytes = fileStat.size;
      entry.sha256 = await hashFileSha256(entry.filePath);
      entry.hashMatchesDeclared = entry.declaredHash ? entry.declaredHash === entry.sha256 : null;
      if (entry.declaredHash && !entry.hashMatchesDeclared) {
        entry.anomalies.push('hash-mismatch');
      }
      if (fileStat.size < expectedMinimumBytes(entry)) {
        entry.anomalies.push('small-file');
      }
      if (entry.contentTypeMatchesExpected === false) {
        entry.anomalies.push('content-type-mismatch');
      }
      if (entry.type === 'video') {
        entry.probe = await probeVideoFile(entry.filePath);
        if (entry.probe.status !== 'passed') {
          entry.anomalies.push(entry.probe.reason || 'ffprobe-failed');
        }
      }
    } catch (error) {
      entry.anomalies.push('file-missing');
      entry.error = error?.message ?? String(error);
    }
    entries.push(entry);
  }
  const summary = {
    total: entries.length,
    ok: entries.filter((entry) => entry.ok).length,
    hashed: entries.filter((entry) => entry.sha256).length,
    missingFiles: entries.filter((entry) => entry.anomalies.includes('file-missing')).length,
    smallFiles: entries.filter((entry) => entry.anomalies.includes('small-file')).length,
    hashMismatches: entries.filter((entry) => entry.anomalies.includes('hash-mismatch')).length,
    contentTypeMismatches: entries.filter((entry) => entry.anomalies.includes('content-type-mismatch')).length,
    videoProbed: entries.filter((entry) => entry.probe?.status === 'passed').length,
    videoProbeFailed: entries.filter((entry) => entry.probe && entry.probe.status !== 'passed').length,
    ffprobeUnavailable: entries.filter((entry) => entry.probe?.reason === 'ffprobe-unavailable').length,
    posterOnlyVideoFallbacks: entries.filter((entry) => entry.fallbackFrom === 'poster-only-video-fallback').length,
    anomalyCount: entries.filter((entry) => entry.anomalies.length).length,
  };
  return {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    siteKey: result.siteKey,
    path: layout.mediaHashManifestPath,
    summary,
    entries,
  };
}

function summarizeCompleteness(result) {
  const payload = result?.result || {};
  const archive = payload.archive || null;
  const items = Array.isArray(payload.items) ? payload.items : [];
  const users = Array.isArray(payload.users) ? payload.users : Array.isArray(payload.relations) ? payload.relations : [];
  const media = Array.isArray(payload.media) && payload.media.length
    ? payload.media
    : items.flatMap((item) => item.media || []);
  const scannedUsers = Array.isArray(archive?.scannedUsers) ? archive.scannedUsers : [];
  const downloads = Array.isArray(result?.download?.downloads) ? result.download.downloads : [];
  const expectedMedia = Array.isArray(result?.download?.expectedMedia) ? result.download.expectedMedia : [];
  const expectedByItem = new Map();
  for (const entry of expectedMedia) {
    const itemId = String(entry.itemId ?? entry.pageUrl ?? 'unknown');
    expectedByItem.set(itemId, (expectedByItem.get(itemId) ?? 0) + 1);
  }
  const downloadedByItem = new Map();
  for (const entry of downloads.filter((download) => download.ok)) {
    const references = Array.isArray(entry.references) && entry.references.length ? entry.references : [entry];
    for (const reference of references) {
      const itemId = String(reference.itemId ?? reference.pageUrl ?? entry.itemId ?? entry.pageUrl ?? 'unknown');
      downloadedByItem.set(itemId, (downloadedByItem.get(itemId) ?? 0) + 1);
    }
  }
  const itemDownloadCompleteness = [...expectedByItem.entries()].map(([itemId, expected]) => ({
    itemId,
    expected,
    downloaded: downloadedByItem.get(itemId) ?? 0,
    complete: (downloadedByItem.get(itemId) ?? 0) >= expected,
  }));
  const okDownloadsByReferenceKey = new Set();
  for (const download of downloads.filter((entry) => entry.ok)) {
    const references = Array.isArray(download.references) && download.references.length ? download.references : [download];
    for (const reference of references) {
      okDownloadsByReferenceKey.add(`${reference.itemId ?? download.itemId ?? ''}|${reference.pageUrl ?? download.pageUrl ?? ''}|${reference.mediaIndex ?? download.mediaIndex ?? ''}|${reference.url ?? download.url ?? ''}|${reference.type ?? download.type ?? ''}`);
    }
  }
  const expectedByItemEntries = new Map();
  for (const entry of expectedMedia) {
    const itemId = String(entry.itemId ?? entry.pageUrl ?? 'unknown');
    if (!expectedByItemEntries.has(itemId)) {
      expectedByItemEntries.set(itemId, []);
    }
    expectedByItemEntries.get(itemId).push(entry);
  }
  const itemQuality = [...expectedByItemEntries.entries()].map(([itemId, entries]) => {
    const downloadedEntries = entries.filter((entry) => okDownloadsByReferenceKey.has(`${entry.itemId ?? ''}|${entry.pageUrl ?? ''}|${entry.mediaIndex ?? ''}|${entry.url ?? ''}|${entry.type ?? ''}`));
    const highestVariantExpected = entries.some((entry) => Number(entry.variantCount) > 0 || Number(entry.bitrate) > 0 || ((Number(entry.width) || 0) * (Number(entry.height) || 0)) > 0);
    const highestVariantHit = !highestVariantExpected || downloadedEntries.some((entry) => Number(entry.variantCount) > 0 || Number(entry.bitrate) > 0 || ((Number(entry.width) || 0) * (Number(entry.height) || 0)) > 0);
    const expectedCount = entries.length;
    const downloadedCount = downloadedEntries.length;
    const completenessScore = expectedCount > 0 ? downloadedCount / expectedCount : 1;
    return {
      itemId,
      expected: expectedCount,
      downloaded: downloadedCount,
      complete: downloadedCount >= expectedCount,
      highestVariantHit,
      quality: downloadedCount >= expectedCount && highestVariantHit ? 'complete' : downloadedCount > 0 ? 'partial' : 'missing',
      qualityScore: Math.round(Math.max(0, Math.min(1, completenessScore * (highestVariantHit ? 1 : 0.75))) * 100) / 100,
    };
  });
  const aggregateQualityScore = itemQuality.length
    ? Math.round((itemQuality.reduce((sum, entry) => sum + entry.qualityScore, 0) / itemQuality.length) * 100) / 100
    : null;
  const boundarySignals = dedupeSortedStrings([
    ...(archive?.boundarySignals ?? []),
    ...(payload.visibilitySignals ?? []),
    ...(payload.riskSignals ?? []),
    ...scannedUsers.flatMap((entry) => [...(entry.visibilitySignals ?? []), ...(entry.riskSignals ?? [])]),
  ]);
  const archiveReason = archive?.reason ?? null;
  const softArchiveReasons = new Set([
    'api-seed-only',
    'soft-cursor-exhausted',
  ]);
  const archiveBoundedBy = archive?.boundedBy || boundedReasonFromArchiveReason(archiveReason);
  const boundedReasons = [
    archiveBoundedBy,
    result?.download?.skippedMedia ? 'max-media-downloads' : null,
  ].filter(Boolean);
  const driftReasons = [
    archiveReason,
    ...(archive?.capture?.driftSamples?.length ? ['api-schema-drift-samples'] : []),
  ].filter((reason) => ['no-api-seed-captured', 'no-parseable-api-seed', 'api-schema-drift-samples'].includes(String(reason)));
  const blockedReasons = [
    ...(result?.runtimeRisk?.hardStop ? [result.runtimeRisk.stopReason || 'runtime-risk'] : []),
    ...boundarySignals.filter((signal) => ['challenge', 'login-wall', 'rate-limited'].includes(signal)),
  ];
  const completenessStatus = blockedReasons.length
    ? 'blocked'
    : boundedReasons.length
      ? 'bounded'
      : softArchiveReasons.has(String(archiveReason))
        ? 'degraded'
      : driftReasons.length || boundarySignals.length
        ? 'degraded'
        : archive && archive.complete === false
          ? 'incomplete'
          : 'complete';
  return {
    status: completenessStatus,
    boundedReasons: dedupeSortedStrings(boundedReasons),
    driftReasons: dedupeSortedStrings(driftReasons),
    blockedReasons: dedupeSortedStrings(blockedReasons),
    archiveStatus: archive ? formatArchiveComplete(archive.complete) : 'unknown',
    archiveReason: archive?.reason ?? null,
    confidence: archive?.confidence ?? null,
    apiPages: archive?.pages ?? 0,
    domItemCount: archive?.domItemCount ?? null,
    apiItemCount: archive?.apiItemCount ?? null,
    dedupedItemCount: archive?.dedupedItemCount ?? items.length,
    itemCount: items.length,
    userCount: users.length,
    mediaCount: media.length,
    missingTimestampCount: items.filter((item) => !item.timestamp).length,
    missingAuthorCount: items.filter((item) => !hasItemAuthor(item)).length,
    platformBoundarySignals: boundarySignals,
    platformBoundaryCounts: archive?.boundaryCounts ?? {
      privateOrUnavailable: scannedUsers.filter((entry) => (entry.visibilitySignals ?? []).some((signal) => ['private-account', 'deleted-or-unavailable', 'age-or-region-restricted'].includes(signal))).length,
      riskBlocked: scannedUsers.filter((entry) => (entry.riskSignals ?? []).length || entry.stopReason).length,
    },
    download: result?.download ? {
      expectedMediaCount: expectedMedia.length,
      attemptedCount: downloads.length,
      okCount: downloads.filter((entry) => entry.ok).length,
      failedCount: downloads.filter((entry) => !entry.ok).length,
      skippedMediaCount: result.download.skippedMedia ?? 0,
      physicalCandidateCount: result.download.downloadCandidates?.length ?? downloads.length,
      skippedPhysicalCandidateCount: result.download.skippedDownloadCandidates ?? 0,
      itemCompleteness: itemDownloadCompleteness,
      itemQuality,
      highestVariantHit: itemQuality.every((entry) => entry.highestVariantHit),
      qualityScore: aggregateQualityScore,
      incompleteItemCount: itemDownloadCompleteness.filter((entry) => !entry.complete).length,
      contentTypeMismatchCount: downloads.filter((entry) => entry.ok && entry.contentTypeMatchesExpected === false).length,
      highestBitrate: Math.max(0, ...expectedMedia.map((entry) => Number(entry.bitrate) || 0)),
      highestVideoBitrate: Math.max(0, ...expectedMedia.filter((entry) => entry.type === 'video').map((entry) => Number(entry.bitrate) || 0)),
      largestImageArea: Math.max(0, ...expectedMedia.filter((entry) => entry.type !== 'video').map((entry) => (Number(entry.width) || 0) * (Number(entry.height) || 0))),
      largestVideoArea: Math.max(0, ...expectedMedia.filter((entry) => entry.type === 'video').map((entry) => (Number(entry.width) || 0) * (Number(entry.height) || 0))),
      largestMediaArea: Math.max(0, ...expectedMedia.map((entry) => (Number(entry.width) || 0) * (Number(entry.height) || 0))),
    } : null,
  };
}

function summarizeRunOutcome(result, settings) {
  if (result.runtimeRisk?.hardStop) {
    return {
      ok: false,
      status: result.runtimeRisk.authExpired ? 'blocked-auth' : 'blocked-risk',
      reason: result.runtimeRisk.stopReason || 'runtime-risk',
      resumable: result.runtimeRisk.authExpired === true
        || (result.runtimeRisk.rateLimited === true && Boolean(result.result?.archive?.nextCursor)),
    };
  }
  if (result.authHealth?.needsRecovery) {
    return {
      ok: false,
      status: 'blocked-auth',
      reason: result.authHealth.recoveryReason || 'auth-recovery-needed',
      resumable: true,
    };
  }
  const archive = result.result?.archive ?? null;
  if (result.download) {
    const downloadSummary = result.completeness?.download;
    if (!downloadSummary || downloadSummary.expectedMediaCount === 0) {
      return {
        ok: false,
        status: 'incomplete',
        reason: 'no-media-candidates',
        resumable: false,
      };
    }
    if (downloadSummary.failedCount > 0 || (downloadSummary.incompleteItemCount > 0 && downloadSummary.skippedMediaCount === 0)) {
      return {
        ok: false,
        status: 'incomplete',
        reason: 'media-download-incomplete',
        resumable: true,
      };
    }
    if (downloadSummary.contentTypeMismatchCount > 0) {
      return {
        ok: false,
        status: 'incomplete',
        reason: 'media-content-type-mismatch',
        resumable: true,
      };
    }
  }
  if (result.completeness?.status === 'bounded') {
    return {
      ok: true,
      status: 'bounded',
      reason: result.completeness.boundedReasons?.[0] ?? null,
      resumable: Boolean(archive?.nextCursor),
    };
  }
  if (archive?.reason === 'soft-cursor-exhausted' && result.completeness?.itemCount > 0) {
    return {
      ok: true,
      status: 'degraded',
      reason: 'soft-cursor-exhausted',
      resumable: false,
    };
  }
  if ((settings.fullArchive || result.plan?.action === 'followed-posts-by-date') && archive && archive.complete !== true) {
    return {
      ok: false,
      status: 'incomplete',
      reason: archive.reason || 'archive-incomplete',
      resumable: Boolean(archive.nextCursor),
    };
  }
  if (isSocialRelationAction(result.plan?.action) && archive?.complete === false) {
    return {
      ok: false,
      status: 'incomplete',
      reason: archive.reason || 'relation-incomplete',
      resumable: Boolean(archive.nextCursor),
    };
  }
  if (result.completeness?.status === 'degraded') {
    return {
      ok: true,
      status: 'degraded',
      reason: result.completeness.driftReasons?.[0] || result.completeness.platformBoundarySignals?.[0] || null,
      resumable: Boolean(archive?.nextCursor),
    };
  }
  return {
    ok: true,
    status: 'passed',
    reason: null,
    resumable: false,
  };
}

async function readJsonLinesFile(filePath) {
  try {
    const text = await readTextFile(filePath);
    return text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function isRestorableArtifactItem(entry) {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  if (entry.kind && entry.kind !== 'item') {
    return false;
  }
  return Boolean(entry.id || entry.url || entry.text || entry.timestamp || entry.sourceAccount);
}

async function loadSocialCheckpoint(layout, settings) {
  if (!settings.resume) {
    return {
      previousState: null,
      previousItems: [],
      previousDownloads: [],
      previousDownloadQueue: [],
    };
  }
  let previousState = null;
  try {
    previousState = await readJsonFile(layout.statePath);
  } catch {
    previousState = null;
  }
  const previousItems = (await readJsonLinesFile(layout.itemsJsonlPath))
    .filter((entry) => isRestorableArtifactItem(entry))
    .map((entry) => {
      const { kind, ...rest } = entry || {};
      return rest;
    });
  const previousDownloads = await readJsonLinesFile(layout.downloadsJsonlPath);
  let previousDownloadQueue = [];
  try {
    const queueArtifact = await readJsonFile(layout.mediaQueuePath);
    previousDownloadQueue = Array.isArray(queueArtifact?.queue) ? queueArtifact.queue : [];
  } catch {
    previousDownloadQueue = [];
  }
  return {
    previousState,
    previousItems,
    previousDownloads,
    previousDownloadQueue,
  };
}

function createCheckpointWriter(layout, plan, settings, checkpoint) {
  let currentState = checkpoint.previousState || {};
  return {
    previousState: checkpoint.previousState,
    previousItems: checkpoint.previousItems,
    async write(patch = {}) {
      currentState = {
        ...currentState,
        ...patch,
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        updatedAt: new Date().toISOString(),
        siteKey: plan.siteKey,
        plan: safePlanForArtifact(patch.plan || plan),
        settings: safeSettingsForArtifact(settings),
        artifacts: artifactPathSummary(layout),
      };
      await writeJsonFile(layout.statePath, currentState);
      return currentState;
    },
  };
}

async function writeSocialArtifacts(finalResult, layout, checkpointWriter) {
  await ensureDir(layout.runDir);
  await ensureDir(layout.mediaDir);
  const rows = extractArtifactRows(finalResult);
  const counts = artifactCounts(finalResult, rows);
  const recoveryRunbook = finalResult.recoveryRunbook ?? buildRecoveryRunbook(finalResult, layout);
  const mediaValidation = finalResult.download ? await buildMediaValidationManifest(finalResult, layout) : null;
  await writeJsonLines(layout.itemsJsonlPath, rows);
  if (finalResult.download) {
    await writeJsonLines(layout.downloadsJsonlPath, finalResult.download.downloads ?? []);
    await writeJsonFile(layout.mediaHashManifestPath, mediaValidation);
  }
  await writeTextFile(layout.reportPath, finalResult.markdown || renderMarkdownReport(finalResult));
  await writeTextFile(layout.indexCsvPath, renderSocialIndexCsv(finalResult, layout));
  await writeTextFile(layout.indexHtmlPath, renderSocialIndexHtml(finalResult, layout));
  if (finalResult.result?.archive?.capture) {
    await writeJsonFile(layout.apiCapturePath, {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      generatedAt: finalResult.generatedAt,
      siteKey: finalResult.siteKey,
      plan: safePlanForArtifact(finalResult.plan),
      archiveReason: finalResult.result.archive.reason ?? null,
      capture: finalResult.result.archive.capture,
    });
    if (finalResult.result.archive.capture.rawDriftSamples?.length) {
      await writeJsonFile(layout.apiDriftSamplesPath, {
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        generatedAt: finalResult.generatedAt,
        siteKey: finalResult.siteKey,
        plan: safePlanForArtifact(finalResult.plan),
        archiveReason: finalResult.result.archive.reason ?? null,
        samples: finalResult.result.archive.capture.rawDriftSamples,
      });
    }
  }
  const stateStatus = finalResult.ok
    ? 'completed'
    : finalResult.runtimeRisk?.rateLimited === true && finalResult.outcome?.resumable
      ? 'paused'
      : 'failed';
  const state = await checkpointWriter.write({
    status: stateStatus,
    completedAt: new Date().toISOString(),
    plan: finalResult.plan,
    archive: finalResult.result?.archive ?? null,
    completeness: finalResult.completeness ?? null,
    runtimeRisk: finalResult.runtimeRisk ?? null,
    outcome: finalResult.outcome ?? null,
    recoveryRunbook,
    mediaValidation: mediaValidation ? {
      path: layout.mediaHashManifestPath,
      summary: mediaValidation.summary,
    } : null,
    counts,
  });
  const manifest = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    generatedAt: finalResult.generatedAt,
    siteKey: finalResult.siteKey,
    ok: finalResult.ok,
    plan: safePlanForArtifact(finalResult.plan),
    settings: state.settings,
    counts,
    completeness: finalResult.completeness ?? null,
    archive: finalResult.result?.archive ?? null,
    authHealth: finalResult.authHealth ?? null,
    sessionProvider: finalResult.sessionProvider ?? null,
    sessionHealth: finalResult.sessionHealth ?? null,
    sessionGate: finalResult.sessionGate ?? null,
    runtimeRisk: finalResult.runtimeRisk ?? null,
    outcome: finalResult.outcome ?? null,
    recoveryRunbook,
    artifacts: artifactPathSummary(layout),
    downloads: finalResult.download ? {
      outDir: finalResult.download.outDir,
      total: finalResult.download.downloads?.length ?? 0,
      ok: finalResult.download.downloads?.filter((entry) => entry.ok).length ?? 0,
      expectedMedia: finalResult.download.expectedMedia?.length ?? 0,
      skippedMedia: finalResult.download.skippedMedia ?? 0,
      physicalCandidates: finalResult.download.downloadCandidates?.length ?? finalResult.download.downloads?.length ?? 0,
      skippedPhysicalCandidates: finalResult.download.skippedDownloadCandidates ?? 0,
      maxMediaDownloads: finalResult.download.maxMediaDownloads ?? null,
      concurrency: finalResult.download.concurrency ?? null,
      requestedConcurrency: finalResult.download.requestedConcurrency ?? null,
      adaptiveConcurrency: finalResult.download.adaptiveConcurrency ?? null,
      retries: finalResult.download.retries ?? null,
      retryBackoffMs: finalResult.download.retryBackoffMs ?? null,
      skippedExisting: finalResult.download.downloads?.filter((entry) => entry.skipped).length ?? 0,
      highestVariantHit: finalResult.completeness?.download?.highestVariantHit ?? null,
      qualityScore: finalResult.completeness?.download?.qualityScore ?? null,
      itemQuality: finalResult.completeness?.download?.itemQuality ?? [],
      details: layout.downloadsJsonlPath,
      hashManifest: layout.mediaHashManifestPath,
      validation: mediaValidation?.summary ?? null,
      queue: {
        path: layout.mediaQueuePath,
        total: finalResult.download.queue?.length ?? 0,
        pending: finalResult.download.queue?.filter((entry) => entry.status === 'pending').length ?? 0,
        done: finalResult.download.queue?.filter((entry) => entry.status === 'done').length ?? 0,
        failed: finalResult.download.queue?.filter((entry) => entry.status === 'failed').length ?? 0,
        skipped: finalResult.download.queue?.filter((entry) => entry.status === 'skipped').length ?? 0,
      },
    } : null,
  };
  await writeJsonFile(layout.manifestPath, manifest);
  return {
    ...artifactPathSummary(layout),
    counts,
  };
}

function normalizeComparableUrl(value) {
  try {
    const parsed = new URL(String(value ?? ''));
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/u, '');
  } catch {
    return String(value ?? '').trim().replace(/\/+$/u, '');
  }
}

async function readSessionUrl(session) {
  if (typeof session?.evaluateValue !== 'function') {
    return null;
  }
  try {
    return await session.evaluateValue('window.location.href');
  } catch {
    return null;
  }
}

async function navigateBackToPlanUrl(session, plan, timeoutMs) {
  const currentUrl = await readSessionUrl(session);
  if (!currentUrl) {
    return false;
  }
  if (
    normalizeComparableUrl(currentUrl)
    && normalizeComparableUrl(currentUrl) === normalizeComparableUrl(plan.url)
  ) {
    return false;
  }
  await session.navigateAndWait(plan.url, createWaitPolicy(timeoutMs));
  return true;
}

async function prepareSocialRelationSurface(session, config, plan, settings) {
  if (
    config.siteKey !== 'instagram'
    || (plan.action !== 'profile-following' && plan.action !== 'profile-followers' && plan.action !== 'followed-users')
    || !plan.account
  ) {
    return null;
  }
  const profileUrl = buildUrlFromTemplate(config, config.routes.profile, plan.account);
  await session.navigateAndWait(profileUrl, createWaitPolicy(settings.timeoutMs));
  const clickResult = await session.callPageFunction(pageOpenSocialRelationSurface, {
    account: plan.account,
    action: plan.action,
  });
  if (clickResult?.clicked) {
    await sleep(Math.max(settings.scrollWaitMs, 1500));
    try {
      await session.waitForSettled?.(createWaitPolicy(settings.timeoutMs));
    } catch {
      // Instagram relation dialogs can update through SPA navigation; extraction below is the verifier.
    }
  } else {
    const fallbackTimeoutMs = Math.min(settings.timeoutMs, 30_000);
    await session.navigateAndWait(plan.url, createWaitPolicy(fallbackTimeoutMs));
    await sleep(Math.max(settings.scrollWaitMs, 1500));
    try {
      await session.waitForSettled?.(createWaitPolicy(fallbackTimeoutMs));
    } catch {
      // Direct relation URLs can open the same SPA dialog; extraction below is the verifier.
    }
    const retryClickResult = await session.callPageFunction(pageOpenSocialRelationSurface, {
      account: plan.account,
      action: plan.action,
    });
    if (retryClickResult?.clicked) {
      await sleep(Math.max(settings.scrollWaitMs, 1500));
    }
    return {
      ...clickResult,
      directNavigation: plan.url,
      retry: retryClickResult,
      clicked: Boolean(retryClickResult?.clicked),
    };
  }
  return clickResult;
}

function normalizeRunSettings(plan, options = {}) {
  const outputRoot = path.resolve(String(options.outDir || options.outputDir || path.join(process.cwd(), 'runs', 'social', plan.siteKey)).trim());
  const artifactRunId = compactSlug(
    options.artifactRunId || options.runId || new Date().toISOString().replace(/[:.]/gu, '-'),
    'run',
  );
  const envToken = plan.siteKey.toUpperCase().replace(/[^A-Z0-9]+/gu, '_');
  const actionToken = String(options.action ?? '').trim().toLowerCase().replace(/_/gu, '-');
  const actionRequestsFullArchive = [
    'archive',
    'archive-user-content',
    'export-all',
    'full-archive',
    'full-history',
  ].includes(actionToken);
  const fullArchive = actionRequestsFullArchive || toBoolean(options.fullArchive ?? options.allHistory, false);
  const followedDateMode = String(options.followedDateMode || options.followedDateStrategy || '').trim().toLowerCase();
  const defaultMaxScrolls = fullArchive ? DEFAULT_FULL_ARCHIVE_MAX_SCROLLS : DEFAULT_MAX_SCROLLS;
  const defaultMaxItems = isSocialRelationAction(plan.action)
    ? DEFAULT_MAX_RELATION_ITEMS
    : fullArchive
      ? Math.max(DEFAULT_MAX_ITEMS, 2_000)
      : DEFAULT_MAX_ITEMS;
  const apiCursorDefault = fullArchive
    || (plan.siteKey === 'x' && plan.action === 'followed-posts-by-date')
    || (plan.siteKey === 'instagram' && plan.action === 'followed-posts-by-date' && /api/iu.test(followedDateMode));
  const requestedApiCursor = toBoolean(options.apiCursor, apiCursorDefault);
  const apiCursorSuppressed = plan.siteKey === 'instagram' && isSocialRelationAction(plan.action) && requestedApiCursor;
  return {
    browserPath: options.browserPath || process.env[`BWS_${envToken}_BROWSER_PATH`],
    browserProfileRoot: options.browserProfileRoot || process.env[`BWS_${envToken}_BROWSER_PROFILE_ROOT`],
    userDataDir: options.userDataDir || process.env[`BWS_${envToken}_USER_DATA_DIR`],
    headless: options.headless === undefined ? false : Boolean(options.headless),
    reuseLoginState: options.reuseLoginState,
    autoLogin: options.autoLogin,
    timeoutMs: toNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS),
    maxItems: Math.max(1, toNumber(options.maxItems, defaultMaxItems)),
    maxScrolls: Math.max(0, toNumber(options.maxScrolls, defaultMaxScrolls)),
    scrollWaitMs: Math.max(0, toNumber(options.scrollWaitMs, DEFAULT_SCROLL_WAIT_MS)),
    fullArchive,
    apiCursor: apiCursorSuppressed ? false : requestedApiCursor,
    apiCursorSuppressed,
    maxApiPages: Math.max(0, toNumber(options.maxApiPages, DEFAULT_MAX_API_PAGES)),
    maxUsers: Math.max(1, toNumber(options.maxUsers, DEFAULT_MAX_USERS)),
    maxDetailPages: Math.max(0, toNumber(options.maxDetailPages, DEFAULT_MAX_DETAIL_PAGES)),
    perUserMaxItems: Math.max(1, toNumber(options.perUserMaxItems, DEFAULT_MAX_ITEMS)),
    maxMediaDownloads: Math.max(1, toNumber(options.maxMediaDownloads, DEFAULT_MAX_MEDIA_DOWNLOADS)),
    mediaDownloadConcurrency: Math.max(1, Math.min(32, toNumber(options.mediaDownloadConcurrency, DEFAULT_MEDIA_DOWNLOAD_CONCURRENCY))),
    mediaDownloadRetries: Math.max(0, Math.min(10, toNumber(options.mediaDownloadRetries, DEFAULT_MEDIA_DOWNLOAD_RETRIES))),
    mediaDownloadBackoffMs: Math.max(0, toNumber(options.mediaDownloadBackoffMs, DEFAULT_MEDIA_DOWNLOAD_BACKOFF_MS)),
    skipExistingDownloads: toBoolean(options.skipExistingDownloads, true),
    riskBackoffMs: Math.max(0, toNumber(options.riskBackoffMs, DEFAULT_RISK_BACKOFF_MS)),
    riskRetries: Math.max(0, toNumber(options.riskRetries, DEFAULT_RISK_RETRIES)),
    apiRetries: Math.max(0, toNumber(options.apiRetries, options.riskRetries ?? DEFAULT_API_RETRIES)),
    followedDateMode: followedDateMode || (plan.siteKey === 'instagram' && plan.action === 'followed-posts-by-date' ? 'followed-profile-date-scan' : 'default'),
    dryRun: toBoolean(options.dryRun, false),
    downloadMedia: toBoolean(options.downloadMedia, false),
    outputRoot,
    runDir: options.runDir ? path.resolve(options.runDir) : null,
    artifactRunId,
    resume: toBoolean(options.resume, false),
    reportPath: options.reportPath ? path.resolve(options.reportPath) : null,
    profilePath: options.profilePath || SOCIAL_SITES[plan.siteKey].defaultProfilePath,
    sessionManifest: options.sessionManifest ? path.resolve(String(options.sessionManifest)) : null,
    sessionProvider: options.sessionProvider,
    useUnifiedSessionHealth: options.useUnifiedSessionHealth,
  };
}

async function resolveSocialSessionMetadata(plan, config, settings, artifactLayout, deps = {}) {
  if (settings.useUnifiedSessionHealth === true && !settings.sessionManifest) {
    const sessionResult = await (deps.runSessionTask ?? runSessionTask)({
      action: 'health',
      site: plan.siteKey,
      host: config.host,
      purpose: 'archive',
      profilePath: settings.profilePath,
      browserProfileRoot: settings.browserProfileRoot,
      userDataDir: settings.userDataDir,
      runDir: path.join(artifactLayout.runDir, 'session-health'),
      sessionRequirement: plan.requiresAuth === true ? 'required' : 'optional',
    }, {}, deps.sessionRunnerDeps ?? deps);
    return {
      sessionProvider: 'unified-session-runner',
      sessionHealth: summarizeSessionRunManifest(sessionResult.manifest),
    };
  }
  return await actionSessionMetadataFromOptions(settings, {
    siteKey: plan.siteKey,
    host: config.host,
  });
}

export async function runSocialAction(options = {}, deps = {}) {
  const plan = buildSocialActionPlan(options);
  const config = resolveSocialSiteConfig(plan.siteKey);
  const settings = normalizeRunSettings(plan, options);
  const artifactLayout = buildSocialArtifactLayout(plan, settings);
  const sessionMetadata = await resolveSocialSessionMetadata(plan, config, settings, artifactLayout, deps);
  if (plan.requiresAccount && !plan.account && !plan.canRunWithoutAccount) {
    throw new Error(`${plan.action} requires --account <handle> or a profile URL.`);
  }
  if (settings.dryRun) {
    const dryRunResult = {
      ok: true,
      siteKey: plan.siteKey,
      dryRun: true,
      plan,
      settings: {
        maxItems: settings.maxItems,
        maxScrolls: settings.maxScrolls,
        fullArchive: settings.fullArchive,
        apiCursor: settings.apiCursor,
        apiCursorSuppressed: settings.apiCursorSuppressed,
        maxApiPages: settings.maxApiPages,
        maxUsers: settings.maxUsers,
        downloadMedia: settings.downloadMedia,
        maxMediaDownloads: settings.maxMediaDownloads,
        mediaDownloadConcurrency: settings.mediaDownloadConcurrency,
        mediaDownloadRetries: settings.mediaDownloadRetries,
        mediaDownloadBackoffMs: settings.mediaDownloadBackoffMs,
        skipExistingDownloads: settings.skipExistingDownloads,
        riskBackoffMs: settings.riskBackoffMs,
        riskRetries: settings.riskRetries,
        apiRetries: settings.apiRetries,
        outputRoot: settings.outputRoot,
        runDir: artifactLayout.runDir,
        resume: settings.resume,
      },
      ...sessionMetadata,
      artifacts: artifactPathSummary(artifactLayout),
    };
    dryRunResult.sessionGate = buildSocialSessionGate(dryRunResult, {
      requiresAuth: plan.requiresAuth === true,
    });
    dryRunResult.markdown = renderMarkdownReport(dryRunResult);
    return dryRunResult;
  }

  const initialSessionGate = buildSocialSessionGate({
    siteKey: plan.siteKey,
    plan,
    ...sessionMetadata,
  }, {
    requiresAuth: plan.requiresAuth === true,
  });
  if (initialSessionGate.status === 'blocked') {
    const blockedResult = {
      ok: false,
      siteKey: plan.siteKey,
      dryRun: false,
      plan,
      reasonCode: 'session-gate-blocked',
      outcome: {
        ok: false,
        status: 'blocked',
        reason: initialSessionGate.reason,
      },
      ...sessionMetadata,
      sessionGate: initialSessionGate,
      artifacts: artifactPathSummary(artifactLayout),
    };
    blockedResult.markdown = renderMarkdownReport(blockedResult);
    return blockedResult;
  }

  const runtime = {
    openBrowserSession,
    resolveSiteBrowserSessionOptions,
    ensureAuthenticatedSession,
    exportDownloadSessionPassthrough,
    ...deps,
  };
  const authContext = await runtime.resolveSiteBrowserSessionOptions(plan.url, settings, {
    profilePath: settings.profilePath,
  });
  const initialNavigationUrl = config.siteKey === 'instagram' && isSocialRelationAction(plan.action) && plan.account
    ? buildUrlFromTemplate(config, config.routes.profile, plan.account)
    : plan.url;
  const loadedCheckpoint = await loadSocialCheckpoint(artifactLayout, settings);
  const checkpoint = createCheckpointWriter(artifactLayout, plan, settings, loadedCheckpoint);
  let session = null;
  let apiCapture = null;
  try {
    await ensureDir(artifactLayout.runDir);
    await ensureDir(artifactLayout.mediaDir);
    await checkpoint.write({
      status: 'started',
      startedAt: new Date().toISOString(),
      counts: {
        items: loadedCheckpoint.previousItems.length,
        media: 0,
      },
    });
    const shouldCaptureApi = (settings.apiCursor && !(config.siteKey === 'instagram' && isSocialRelationAction(plan.action)))
      || (config.siteKey === 'x' && isSocialRelationAction(plan.action))
      || (
        config.siteKey === 'x'
        && settings.downloadMedia
        && ['profile-content', 'search', 'followed-posts-by-date'].includes(plan.action)
      );
    await checkpoint.write({
      status: 'running',
      phase: 'browser-opening',
      updatedAt: new Date().toISOString(),
      currentUrl: initialNavigationUrl,
      counts: {
        items: loadedCheckpoint.previousItems.length,
        media: 0,
      },
    });
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
      startupUrl: shouldCaptureApi ? 'about:blank' : initialNavigationUrl,
    }, {
      userDataDirPrefix: `${plan.siteKey}-social-browser-`,
    });
    apiCapture = shouldCaptureApi && typeof session?.send === 'function' && typeof session?.client?.on === 'function'
      ? await createSocialApiCapture(session, config, settings)
      : null;
    await checkpoint.write({
      status: 'running',
      phase: 'browser-opened',
      updatedAt: new Date().toISOString(),
      currentUrl: initialNavigationUrl,
      counts: {
        items: loadedCheckpoint.previousItems.length,
        media: 0,
      },
    });
    await session.navigateAndWait(initialNavigationUrl, createWaitPolicy(settings.timeoutMs));
    await checkpoint.write({
      status: 'running',
      phase: 'auth-checking',
      updatedAt: new Date().toISOString(),
      currentUrl: initialNavigationUrl,
      counts: {
        items: loadedCheckpoint.previousItems.length,
        media: 0,
      },
    });
    const authResult = plan.requiresAuth
      ? await runtime.ensureAuthenticatedSession(session, initialNavigationUrl, settings, { authContext })
      : null;
    await checkpoint.write({
      status: 'running',
      phase: 'auth-ok',
      updatedAt: new Date().toISOString(),
      currentUrl: initialNavigationUrl,
      counts: {
        items: loadedCheckpoint.previousItems.length,
        media: 0,
      },
    });
    if (!(config.siteKey === 'instagram' && isSocialRelationAction(plan.action) && plan.account)) {
      await navigateBackToPlanUrl(session, plan, settings.timeoutMs);
    }
    let executionPlan = plan;
    if (plan.action === 'followed-users' && !plan.account) {
      const bootstrapState = await session.callPageFunction(pageExtractSocialState, config, {
        account: null,
        action: plan.action,
        contentType: plan.contentType,
        date: plan.date,
        fromDate: plan.fromDate,
        toDate: plan.toDate,
      });
      const inferredAccount = cleanText(bootstrapState?.currentAccount || '');
      if (inferredAccount) {
        executionPlan = {
          ...plan,
          account: inferredAccount,
          url: buildUrlFromTemplate(config, config.routes.following, inferredAccount),
          plannerNotes: [
            ...plan.plannerNotes,
            `Inferred current account ${inferredAccount} from authenticated navigation.`,
          ],
        };
        await session.navigateAndWait(executionPlan.url, createWaitPolicy(settings.timeoutMs));
      }
    }
    let surfacePreparation = null;
    let pageResult = null;
    const instagramApiFeedModes = new Set(['home-feed', 'api-feed', 'home-feed-api']);
    if (
      executionPlan.siteKey === 'instagram'
      && executionPlan.action === 'followed-posts-by-date'
      && !instagramApiFeedModes.has(settings.followedDateMode)
    ) {
      pageResult = await collectInstagramFollowedPostsByProfiles(session, config, executionPlan, settings, checkpoint, apiCapture);
      surfacePreparation = pageResult.surfacePreparation ?? null;
    } else {
      await checkpoint.write({
        status: 'running',
        phase: 'surface-preparing',
        updatedAt: new Date().toISOString(),
        currentUrl: executionPlan.url,
        counts: {
          items: loadedCheckpoint.previousItems.length,
          media: 0,
        },
      });
      surfacePreparation = await prepareSocialRelationSurface(session, config, executionPlan, settings);
      await checkpoint.write({
        status: 'running',
        phase: 'collecting-dom',
        updatedAt: new Date().toISOString(),
        currentUrl: executionPlan.url,
        counts: {
          items: loadedCheckpoint.previousItems.length,
          media: 0,
        },
      });
      const domPageSettings = settings.apiCursor && settings.fullArchive
        ? { ...settings, maxScrolls: Math.min(settings.maxScrolls, 1) }
        : settings;
      const domPageResult = await collectSocialPage(session, config, executionPlan, domPageSettings);
      const shouldCollectContentApiArchive = !(config.siteKey === 'instagram' && isSocialRelationAction(executionPlan.action));
      let apiArchive = shouldCollectContentApiArchive
        ? await collectSocialApiArchive(session, config, executionPlan, settings, apiCapture, checkpoint, {
          seedOnly: !settings.apiCursor && settings.downloadMedia && config.siteKey === 'x',
        })
        : null;
      if (shouldCollectContentApiArchive && isInstagramFeedUserArchivePlan(config, executionPlan, settings)) {
        const instagramFeedArchive = await collectInstagramFeedUserArchive(session, config, executionPlan, settings, checkpoint);
        if (shouldPreferInstagramDirectArchive(apiArchive, instagramFeedArchive)) {
          apiArchive = instagramFeedArchive;
        }
      }
      pageResult = mergePageResultWithArchive(domPageResult, apiArchive, settings);
      if (config.siteKey === 'x' && isSocialRelationAction(executionPlan.action)) {
        const relationApi = await collectXRelationApiUsers(session, executionPlan, settings, apiCapture);
        if (relationApi) {
          pageResult = {
            ...pageResult,
            relations: relationApi.users?.length ? relationApi.users : pageResult.relations,
            archive: {
              ...(pageResult.archive || {}),
              strategy: relationApi.strategy,
              complete: relationApi.complete,
              reason: relationApi.reason,
              bounded: relationApi.bounded,
              boundedBy: relationApi.boundedBy,
              pages: relationApi.pages,
              apiItemCount: relationApi.users.length,
              dedupedItemCount: relationApi.users.length || pageResult.relations?.length || 0,
              seedUrl: relationApi.seedUrl ?? null,
              requestTemplate: relationApi.requestTemplate ?? null,
              nextCursor: relationApi.nextCursor ?? null,
              boundarySignals: dedupeSortedStrings([
                ...(pageResult.archive?.boundarySignals ?? []),
                ...(relationApi.riskSignals ?? []),
              ]),
              capture: relationApi.capture,
            },
            riskSignals: dedupeSortedStrings([
              ...(pageResult.riskSignals ?? []),
              ...(relationApi.riskSignals ?? []),
            ]),
            riskEvents: [
              ...(pageResult.riskEvents ?? []),
              ...(relationApi.riskEvents ?? []),
            ],
          };
        }
      }
    }
    const resultPayload = mergeCheckpointItemsIntoPayload(
      selectResultPayload(executionPlan, pageResult),
      checkpoint,
      settings,
    );

    let passthrough = null;
    let download = null;
    if (settings.downloadMedia) {
      passthrough = await runtime.exportDownloadSessionPassthrough(session, executionPlan.url, authContext, {
        siteKey: executionPlan.siteKey,
        envToken: executionPlan.siteKey,
        loginState: authResult?.loginState ?? authResult ?? null,
      });
      const headers = await readPassthroughHeaders(passthrough);
      const itemMedia = (resultPayload.items || []).flatMap((item) => (item.media || []).map((mediaEntry, mediaIndex) => ({
        ...mediaEntry,
        itemId: mediaEntry.itemId ?? item.id ?? item.url ?? null,
        pageUrl: mediaEntry.pageUrl ?? item.url ?? null,
        mediaIndex: mediaEntry.mediaIndex ?? mediaIndex,
      })));
      const media = itemMedia.length ? itemMedia : (resultPayload.media || pageResult.media || []);
      const mediaOutDir = artifactLayout.mediaDir;
      const maxMediaDownloads = Math.min(media.length || settings.maxItems, settings.maxMediaDownloads);
      const downloadResult = await executeMediaDownloads({
        media,
        headers,
        outDir: mediaOutDir,
        siteKey: executionPlan.siteKey,
        account: executionPlan.account,
        maxItems: maxMediaDownloads,
        concurrency: settings.mediaDownloadConcurrency,
        retries: settings.mediaDownloadRetries,
        retryBackoffMs: settings.mediaDownloadBackoffMs,
        skipExisting: settings.skipExistingDownloads,
        previousDownloads: loadedCheckpoint.previousDownloads,
        previousQueue: loadedCheckpoint.previousDownloadQueue,
        queuePath: artifactLayout.mediaQueuePath,
      });
      download = {
        outDir: mediaOutDir,
        downloads: downloadResult.downloads,
        queue: downloadResult.queue,
        downloadCandidates: downloadResult.candidates,
        expectedMedia: downloadResult.expectedMedia,
        skippedMedia: downloadResult.skippedMedia,
        skippedDownloadCandidates: downloadResult.skippedCandidates,
        maxMediaDownloads,
        bounded: downloadResult.skippedMedia > 0 || downloadResult.skippedCandidates > 0,
        boundedBy: downloadResult.skippedMedia > 0 || downloadResult.skippedCandidates > 0 ? 'max-media-downloads' : null,
        concurrency: downloadResult.concurrency,
        requestedConcurrency: downloadResult.requestedConcurrency,
        adaptiveConcurrency: downloadResult.adaptiveConcurrency,
        retries: downloadResult.retries,
        retryBackoffMs: downloadResult.retryBackoffMs,
        passthrough,
      };
    }

    const finalResult = {
      ok: true,
      siteKey: executionPlan.siteKey,
      generatedAt: new Date().toISOString(),
      plan: executionPlan,
      auth: authResult ?? null,
      surfacePreparation,
      result: resultPayload,
      download,
      metrics: session.getMetrics?.() ?? null,
    };
    finalResult.runtimeRisk = summarizeRuntimeRisk(resultPayload, settings);
    finalResult.authHealth = summarizeSocialAuthHealth(executionPlan, settings, authContext, authResult, finalResult.runtimeRisk);
    finalResult.sessionProvider = sessionMetadata.sessionProvider;
    finalResult.sessionHealth = sessionMetadata.sessionHealth ?? null;
    finalResult.sessionGate = buildSocialSessionGate(finalResult, {
      requiresAuth: finalResult.authHealth?.required === true,
    });
    finalResult.completeness = summarizeCompleteness(finalResult);
    finalResult.outcome = summarizeRunOutcome(finalResult, settings);
    finalResult.ok = finalResult.outcome.ok;
    finalResult.recoveryRunbook = buildRecoveryRunbook({ ...finalResult, _settings: settings }, artifactLayout);
    finalResult.markdown = renderMarkdownReport(finalResult);
    finalResult.artifacts = await writeSocialArtifacts(finalResult, artifactLayout, checkpoint);
    if (settings.reportPath) {
      await writeJsonFile(settings.reportPath, finalResult);
      await writeTextFile(settings.reportPath.replace(/\.json$/iu, '.md'), finalResult.markdown);
    }
    return finalResult;
  } catch (error) {
    await checkpoint.write({
      status: 'failed',
      failedAt: new Date().toISOString(),
      error: error?.message ?? String(error),
    });
    throw error;
  } finally {
    apiCapture?.dispose?.();
    if (session) {
      await session.close();
    }
  }
}

function appendFlag(flags, key, value) {
  if (!(key in flags)) {
    flags[key] = value;
    return;
  }
  if (Array.isArray(flags[key])) {
    flags[key].push(value);
    return;
  }
  flags[key] = [flags[key], value];
}

function lastFlagValue(flags, key, fallback = undefined) {
  const value = flags[key];
  if (Array.isArray(value)) {
    return value[value.length - 1] ?? fallback;
  }
  return value ?? fallback;
}

export const SOCIAL_ACTION_HELP = `Usage:
  node src/entrypoints/sites/x-action.mjs <action> <account-or-query> [options]
  node src/entrypoints/sites/instagram-action.mjs <action> <account-or-query> [options]

Common actions include profile-content, full-archive, search, profile-following,
profile-followers, followed-posts-by-date, and account-info.

Options:
  --site <x|instagram>              Override the wrapper default site.
  --account <handle>                Target account or profile handle.
  --query <value>                   Search query.
  --content-type <type>             posts, replies, media, likes, or site-specific tab.
  --download-media                  Download media candidates discovered by the action.
  --max-items <n>                   Limit archive or content items.
  --max-media-downloads <n>         Limit downloaded media files.
  --max-users <n>                   Limit relation/followed scans.
  --run-dir <dir>                   Exact artifact run directory.
  --out-dir <dir>                   Artifact output root.
  --resume                          Resume from existing checkpoint state.
  --dry-run                         Plan without performing browser/media work when supported.
  --session-manifest <path>         Consume a unified runs/session health manifest.
  --session-health-plan             Generate and consume a unified session health manifest first.
  --no-session-health-plan          Use the legacy session provider path.
  --format <json|markdown>          Output format. Default: json.
  -h, --help                        Show this help.
`;

export function parseSocialActionArgs(argv = process.argv.slice(2), defaults = {}) {
  const args = [...argv];
  const positionals = [];
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '-h') {
      appendFlag(flags, 'help', true);
      continue;
    }
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const [key, inlineValue] = token.split('=', 2);
    const normalizedKey = key.replace(/^--/u, '');
    if (inlineValue !== undefined) {
      appendFlag(flags, normalizedKey, inlineValue);
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      appendFlag(flags, normalizedKey, next);
      index += 1;
    } else {
      appendFlag(flags, normalizedKey, true);
    }
  }

  const action = positionals[0] ?? lastFlagValue(flags, 'action', defaults.action ?? 'account-info');
  const normalizedActionToken = String(action ?? '').trim().toLowerCase().replace(/_/gu, '-');
  const actionRequestsFullArchive = [
    'archive',
    'archive-user-content',
    'export-all',
    'full-archive',
    'full-history',
  ].includes(normalizedActionToken);
  const firstItem = positionals[1] ?? null;
  const site = lastFlagValue(flags, 'site', defaults.site);
  const apiCursorFlag = lastFlagValue(flags, 'api-cursor');
  return {
    help: flags.help === true,
    site,
    action,
    account: lastFlagValue(flags, 'account', lastFlagValue(flags, 'handle', lastFlagValue(flags, 'user', firstItem))),
    query: lastFlagValue(flags, 'query', lastFlagValue(flags, 'keyword', action === 'search' ? firstItem : undefined)),
    contentType: lastFlagValue(flags, 'content-type', lastFlagValue(flags, 'tab')),
    date: lastFlagValue(flags, 'date'),
    fromDate: lastFlagValue(flags, 'from', lastFlagValue(flags, 'from-date')),
    toDate: lastFlagValue(flags, 'to', lastFlagValue(flags, 'to-date')),
    profilePath: lastFlagValue(flags, 'profile-path'),
    browserPath: lastFlagValue(flags, 'browser-path'),
    browserProfileRoot: lastFlagValue(flags, 'browser-profile-root'),
    userDataDir: lastFlagValue(flags, 'user-data-dir'),
    sessionManifest: lastFlagValue(flags, 'session-manifest'),
    sessionProvider: lastFlagValue(flags, 'session-provider'),
    useUnifiedSessionHealth: flags['no-session-health-plan'] === true
      ? false
      : flags['session-health-plan'] === true
        ? true
        : undefined,
    outDir: lastFlagValue(flags, 'out-dir'),
    runDir: lastFlagValue(flags, 'run-dir', lastFlagValue(flags, 'artifacts-dir')),
    artifactRunId: lastFlagValue(flags, 'artifact-run-id', lastFlagValue(flags, 'run-id')),
    reportPath: lastFlagValue(flags, 'report-path'),
    timeoutMs: lastFlagValue(flags, 'timeout'),
    maxItems: lastFlagValue(flags, 'max-items'),
    maxScrolls: lastFlagValue(flags, 'max-scrolls'),
    maxApiPages: lastFlagValue(flags, 'max-api-pages'),
    maxUsers: lastFlagValue(flags, 'max-users'),
    maxDetailPages: lastFlagValue(flags, 'max-detail-pages'),
    perUserMaxItems: lastFlagValue(flags, 'per-user-max-items'),
    maxMediaDownloads: lastFlagValue(flags, 'max-media-downloads'),
    mediaDownloadConcurrency: lastFlagValue(flags, 'media-download-concurrency', lastFlagValue(flags, 'download-concurrency')),
    mediaDownloadRetries: lastFlagValue(flags, 'media-download-retries', lastFlagValue(flags, 'download-retries')),
    mediaDownloadBackoffMs: lastFlagValue(flags, 'media-download-backoff-ms', lastFlagValue(flags, 'download-backoff-ms')),
    skipExistingDownloads: flags['no-skip-existing-downloads'] === true ? false : flags['skip-existing-downloads'] === true ? true : undefined,
    riskBackoffMs: flags['no-risk-backoff'] === true ? 0 : lastFlagValue(flags, 'risk-backoff-ms'),
    riskRetries: lastFlagValue(flags, 'risk-retries'),
    apiRetries: lastFlagValue(flags, 'api-retries'),
    scrollWaitMs: lastFlagValue(flags, 'scroll-wait'),
    fullArchive: actionRequestsFullArchive || flags['full-archive'] === true || flags['all-history'] === true,
    apiCursor: flags['no-api-cursor'] === true ? false : apiCursorFlag === undefined ? undefined : toBoolean(apiCursorFlag, true),
    followedDateMode: lastFlagValue(flags, 'followed-date-mode', lastFlagValue(flags, 'followed-date-strategy')),
    headless: flags.headless === true ? true : flags['no-headless'] === true ? false : undefined,
    reuseLoginState: flags['no-reuse-login-state'] === true ? false : flags['reuse-login-state'] === true ? true : undefined,
    autoLogin: flags['no-auto-login'] === true ? false : flags['auto-login'] === true ? true : undefined,
    dryRun: flags['dry-run'] === true,
    resume: flags['no-resume'] === true ? false : flags.resume === true ? true : undefined,
    downloadMedia: flags['download-media'] === true || flags.download === true,
    outputFormat: lastFlagValue(flags, 'format', 'json'),
  };
}

export async function runSocialActionCli(argv = process.argv.slice(2), defaults = {}) {
  initializeCliUtf8();
  const parsed = parseSocialActionArgs(argv, defaults);
  if (parsed.help) {
    process.stdout.write(SOCIAL_ACTION_HELP);
    return { help: SOCIAL_ACTION_HELP };
  }
  const result = await runSocialAction(parsed);
  if (String(parsed.outputFormat ?? 'json').toLowerCase() === 'markdown') {
    process.stdout.write(result.markdown || '');
  } else {
    writeJsonStdout(result);
  }
  if (result?.ok !== true) {
    process.exitCode = 1;
  }
}
