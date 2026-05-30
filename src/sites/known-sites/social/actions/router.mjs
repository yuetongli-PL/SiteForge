// @ts-check

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

import { openBrowserSession } from '../../../../infra/browser/session.mjs';
import { initializeCliUtf8, writeJsonStdout } from '../../../../infra/cli.mjs';
import {
  actionCliCommand,
  formatCommand,
  siteLoginCommand,
} from '../../../../infra/cli/command-map.mjs';
import { parseBoolean } from '../../../../infra/cli/parse-values.mjs';
import { runSingleStageCliWithProgress } from '../../../../infra/cli/progress-cli.mjs';
import {
  ensureAuthenticatedSession,
  inspectReusableSiteSession,
  resolveSiteBrowserSessionOptions,
} from '../../../../infra/auth/site-auth.mjs';
import {
  prepareSiteSessionGovernance,
  readAuthSessionState,
  resolveAuthSessionPolicy,
  writeAuthSessionState,
} from '../../../../infra/auth/site-session-governance.mjs';
import { ensureDir, readJsonFile, readTextFile, writeJsonFile, writeJsonLines, writeTextFile } from '../../../../infra/io.mjs';
import { htmlEscape } from '../../../../shared/html-escape.mjs';
import { cleanText, compactSlug, normalizeText } from '../../../../shared/normalize.mjs';
import {
  actionSessionMetadataFromOptions,
  summarizeSessionRunManifest,
} from '../../../../domain/sessions/manifest-bridge.mjs';
import { evaluateAuthenticatedSessionReleaseGate } from '../../../../domain/sessions/release-gate.mjs';
import { buildSessionRepairPlanCommand } from '../../../../domain/sessions/repair-command.mjs';
import { runSessionTask } from '../../../../domain/sessions/runner.mjs';
import { matchCapabilityHooksForLifecycleEvent } from '../../../../domain/lifecycle/capability-hook.mjs';
import { assertSchemaCompatible } from '../../../../domain/schemas/compatibility-registry.mjs';
import {
  normalizeLifecycleEvent,
  writeLifecycleEventArtifact,
} from '../../../../domain/lifecycle/lifecycle-events.mjs';
import { reasonCodeSummary } from '../../../../domain/risks/reason-codes.mjs';
import { normalizeRiskTransition } from '../../../../domain/risks/risk-state.mjs';
import {
  assertNoForbiddenPatterns,
  prepareRedactedArtifactJsonWithAudit,
  redactValue,
} from '../../../../domain/sessions/security-guard.mjs';
import {
  artifactPathSummary,
  buildSocialArtifactLayout,
  safePlanForArtifact,
  safeSettingsForArtifact,
  safeUrlForArtifact,
} from './artifacts.mjs';
import {
  SOCIAL_ACTION_HELP,
  parseSocialActionArgs,
} from './cli.mjs';
import { createBlockedMediaDownloadReport } from './download-boundary.mjs';

export { SOCIAL_ACTION_HELP, parseSocialActionArgs } from './cli.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..', '..', '..');

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ITEMS = 100;
const DEFAULT_MAX_RELATION_ITEMS = 500;
const DEFAULT_MAX_SCROLLS = 8;
const DEFAULT_SCROLL_WAIT_MS = 700;
const DEFAULT_FULL_ARCHIVE_MAX_SCROLLS = 250;
const DEFAULT_MAX_API_PAGES = 25;
const DEFAULT_MAX_USERS = 25;
const DEFAULT_MAX_DETAIL_PAGES = 60;
const DEFAULT_MAX_CONTROL_PROBES = 8;
const DEFAULT_MAX_READ_CRAWL_PAGES = 20;
const DEFAULT_MAX_READ_CRAWL_DEPTH = 1;
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
  'app-route': 'read-route',
  'read-route': 'read-route',
  'route': 'read-route',
  'route-crawl': 'read-route',
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
  return parseBoolean(value, { defaultValue });
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
    'read-route',
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

function buildSearchUrl(config, { query, date, fromDate, toDate } = /** @type {any} */ ({})) {
  const parsed = new URL(config.routes.search, `${config.baseUrl}/`);
  const normalizedQuery = normalizeText(query || '');
  if (config.siteKey === 'x') {
    const searchTerms = /** @type {any[]} */ ([]);
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

function normalizeNumericId(value) {
  const text = String(value ?? '').trim();
  return /^\d+$/u.test(text) ? text : null;
}

function normalizeOpaqueId(value) {
  const text = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]+$/u.test(text) ? text : null;
}

function normalizeDateWindow({ date, fromDate, toDate } = /** @type {any} */ ({})) {
  const normalizedDate = String(date ?? '').trim();
  const normalizedFrom = String(fromDate ?? '').trim();
  const normalizedTo = String(toDate ?? '').trim();
  return {
    date: isDateString(normalizedDate) ? normalizedDate : null,
    fromDate: isDateString(normalizedFrom) ? normalizedFrom : null,
    toDate: isDateString(normalizedTo) ? normalizedTo : null,
  };
}

const X_READ_ROUTE_ALIASES = Object.freeze({
  'account-about': '/{account}/about',
  'account-accessibility': '/{account}/accessibility',
  'account-articles': '/{account}/articles',
  'account-communities': '/{account}/communities',
  'account-communities-explore': '/{account}/communities/explore',
  'account-photo': '/{account}/photo',
  articles: '/i/articles',
  bookmarks: '/i/bookmarks',
  chat: '/i/chat',
  communities: '/i/communities',
  'community-about': '/i/communities/{communityId}/about',
  'community-detail': '/i/communities/{communityId}',
  'community-members': '/i/communities/{communityId}/members',
  'community-members-search': '/i/communities/{communityId}/members/search',
  'community-search': '/i/communities/{communityId}/search',
  'communities-explore': '/{account}/communities/explore',
  'connect-people': '/i/connect_people',
  connect_people: '/i/connect_people',
  'compose-post': '/compose/post',
  'creator-studio': '/i/jf/creators/studio',
  'creators-studio': '/i/jf/creators/studio',
  explore: '/explore',
  'explore-news': '/explore/tabs/news',
  'explore-trending': '/explore/tabs/trending',
  'explore-for-you': '/explore/tabs/for-you',
  foryou: '/explore/tabs/for-you',
  'for-you': '/explore/tabs/for-you',
  grok: '/i/grok',
  home: '/home',
  'internal-status': '/i/status/{statusId}',
  'audio-space': '/i/spaces/{spaceId}',
  'spaces': '/i/spaces/{spaceId}',
  jobs: '/jobs',
  'news-stories-home': '/i/jf/stories/home',
  'keyboard-shortcuts': '/i/keyboard_shortcuts',
  'list-detail': '/i/lists/{listId}',
  'list-followers': '/i/lists/{listId}/followers',
  'list-members': '/i/lists/{listId}/members',
  lists: '/i/lists',
  messages: '/messages',
  mentions: '/notifications/mentions',
  'notification-mentions': '/notifications/mentions',
  'notification-verified': '/notifications/verified',
  notifications: '/notifications',
  'verified-notifications': '/notifications/verified',
  'followers-you-follow': '/{account}/followers_you_follow',
  followers_you_follow: '/{account}/followers_you_follow',
  'profile-likes': '/{account}/likes',
  'profile-lists': '/{account}/lists',
  'premium-sign-up': '/i/premium_sign_up',
  premium_sign_up: '/i/premium_sign_up',
  root: '/',
  search: '/search',
  'search-empty': '/search',
  'search-top': '/search?q=:query&src=typed_query',
  settings: '/settings',
  'status-analytics': '/{account}/status/{statusId}/analytics',
  'settings-account': '/settings/account',
  'settings-account-id-verification': '/settings/account/id_verification',
  'settings-account-login': '/settings/account/login',
  'settings-account-login-verification': '/settings/account/login_verification',
  'settings-account-passkey': '/settings/account/passkey',
  'settings-accessibility': '/settings/accessibility',
  'settings-accessibility-display-languages': '/settings/accessibility_display_and_languages',
  'settings-additional-resources': '/settings/additional_resources',
  'settings-about': '/settings/about',
  'settings-about-your-account': '/settings/about_your_account',
  'settings-autoplay': '/settings/autoplay',
  'settings-blocked-all': '/settings/blocked/all',
  'settings-ads-preferences': '/settings/ads_preferences',
  'settings-audience-and-tagging': '/settings/audience_and_tagging',
  'settings-connected-accounts': '/settings/connected_accounts',
  'settings-content-you-see': '/settings/content_you_see',
  'settings-contacts': '/settings/contacts',
  'settings-contacts-dashboard': '/settings/contacts_dashboard',
  'settings-data': '/settings/data',
  'settings-data-sharing-with-business-partners': '/settings/data_sharing_with_business_partners',
  'settings-deactivate': '/settings/deactivate',
  'settings-delegate': '/settings/delegate',
  'settings-delegate-groups': '/settings/delegate/groups',
  'settings-delegate-members': '/settings/delegate/members',
  'settings-direct-messages': '/settings/direct_messages',
  'settings-display': '/settings/display',
  'settings-download-your-data': '/settings/download_your_data',
  'settings-email-notifications': '/settings/email_notifications',
  'settings-explore': '/settings/explore',
  'settings-explore-location': '/settings/explore/location',
  'settings-grok-settings': '/settings/grok_settings',
  'settings-languages': '/settings/languages',
  'settings-location-information': '/settings/location_information',
  'settings-manage-subscriptions': '/settings/manage_subscriptions',
  'settings-monetization': '/settings/monetization',
  'settings-mute-and-block': '/settings/mute_and_block',
  'settings-muted-all': '/settings/muted/all',
  'settings-muted-keywords': '/settings/muted_keywords',
  'settings-notifications': '/settings/notifications',
  'settings-notifications-advanced-filters': '/settings/notifications/advanced_filters',
  'settings-notifications-email': '/settings/notifications/email_notifications',
  'settings-notifications-filters': '/settings/notifications/filters',
  'settings-notifications-preferences': '/settings/notifications/preferences',
  'settings-notifications-push': '/settings/notifications/push_notifications',
  'settings-off-twitter-activity': '/settings/off_twitter_activity',
  'settings-privacy-and-safety': '/settings/privacy_and_safety',
  'settings-profile': '/settings/profile',
  'settings-push-notifications': '/settings/push_notifications',
  'settings-search': '/settings/search',
  'settings-security': '/settings/security',
  'settings-security-and-account-access': '/settings/security_and_account_access',
  'settings-spaces': '/settings/spaces',
  'settings-your-twitter-data': '/settings/your_twitter_data',
  'settings-your-twitter-data-account': '/settings/your_twitter_data/account',
  'settings-your-tweets': '/settings/your_tweets',
  'status-detail': '/{account}/status/{statusId}',
  'status-internal': '/i/status/{statusId}',
  'stories-home': '/i/jf/stories/home',
  'status-likes': '/{account}/status/{statusId}/likes',
  'status-photo': '/{account}/status/{statusId}/photo/{mediaId}',
  'status-quotes': '/{account}/status/{statusId}/quotes',
  'status-retweets': '/{account}/status/{statusId}/retweets',
  topsearch: '/search?q=:query&src=typed_query',
  'verified-followers': '/{account}/verified_followers',
  verified_followers: '/{account}/verified_followers',
});

const X_READ_ROUTE_DETAILS = Object.freeze({
  '/': Object.freeze({
    routeName: 'root',
    capability: 'app.root.inspect',
    intent: 'inspect_root_redirect',
  }),
  '/{account}/likes': Object.freeze({
    routeName: 'profile-likes',
    capability: 'timeline.likes.inspect',
    intent: 'inspect_profile_likes',
    requiresAccount: true,
  }),
  '/{account}/lists': Object.freeze({
    routeName: 'profile-lists',
    capability: 'profile.lists.inspect',
    intent: 'inspect_profile_lists',
    requiresAccount: true,
  }),
  '/{account}/followers_you_follow': Object.freeze({
    routeName: 'followers-you-follow',
    capability: 'relation.followers-you-follow.inspect',
    intent: 'inspect_followers_you_follow',
    requiresAccount: true,
  }),
  '/{account}/verified_followers': Object.freeze({
    routeName: 'verified-followers',
    capability: 'relation.verified-followers.inspect',
    intent: 'inspect_verified_followers',
    requiresAccount: true,
  }),
  '/{account}/about': Object.freeze({
    routeName: 'account-about',
    capability: 'dynamic.account-about.inspect',
    intent: 'inspect_account_about_route',
    requiresAccount: true,
  }),
  '/{account}/accessibility': Object.freeze({
    routeName: 'account-accessibility',
    capability: 'dynamic.account-accessibility.inspect',
    intent: 'inspect_account_accessibility_route',
    requiresAccount: true,
  }),
  '/{account}/articles': Object.freeze({
    routeName: 'account-articles',
    capability: 'dynamic.account-articles.inspect',
    intent: 'inspect_account_articles_route',
    requiresAccount: true,
  }),
  '/{account}/photo': Object.freeze({
    routeName: 'account-photo',
    capability: 'dynamic.account-photo.inspect',
    intent: 'inspect_account_photo_route',
    requiresAccount: true,
  }),
  '/{account}/communities': Object.freeze({
    routeName: 'account-communities',
    capability: 'dynamic.account-communities.inspect',
    intent: 'inspect_account_communities_route',
    requiresAccount: true,
  }),
  '/{account}/communities/explore': Object.freeze({
    routeName: 'account-communities-explore',
    capability: 'dynamic.account-communities-explore.inspect',
    intent: 'inspect_account_communities_explore_route',
    requiresAccount: true,
  }),
  '/compose/post': Object.freeze({
    routeName: 'compose-post',
    capability: 'risk-reviewed.compose-surface.inspect',
    intent: 'inspect_compose_surface_without_submit',
    requiresRiskReviewedRead: true,
  }),
  '/i/premium_sign_up': Object.freeze({
    routeName: 'premium-sign-up',
    capability: 'commerce.premium-signup.inspect',
    intent: 'inspect_premium_signup',
    requiresRiskReviewedRead: true,
  }),
  '/i/jf/creators/studio': Object.freeze({
    routeName: 'creator-studio',
    capability: 'risk-reviewed.creator-studio.inspect',
    intent: 'inspect_creator_studio_surface',
    requiresRiskReviewedRead: true,
  }),
  '/i/jf/stories/home': Object.freeze({
    routeName: 'news-stories-home',
    capability: 'app.news-stories.inspect',
    intent: 'inspect_news_stories_home_surface',
  }),
  '/messages': Object.freeze({
    routeName: 'messages',
    capability: 'risk-reviewed.messages.inspect',
    intent: 'inspect_messages_inbox_surface',
    requiresRiskReviewedRead: true,
  }),
  '/i/chat': Object.freeze({
    routeName: 'chat',
    capability: 'risk-reviewed.chat.inspect',
    intent: 'inspect_chat_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings': Object.freeze({
    routeName: 'settings',
    capability: 'risk-reviewed.settings.inspect',
    intent: 'inspect_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/account': Object.freeze({
    routeName: 'settings-account',
    capability: 'risk-reviewed.settings-account.inspect',
    intent: 'inspect_account_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/account/id_verification': Object.freeze({
    routeName: 'settings-account-id-verification',
    capability: 'risk-reviewed.settings-account-id-verification.inspect',
    intent: 'inspect_account_id_verification_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/account/login': Object.freeze({
    routeName: 'settings-account-login',
    capability: 'risk-reviewed.settings-account-login.inspect',
    intent: 'inspect_account_login_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/account/login_verification': Object.freeze({
    routeName: 'settings-account-login-verification',
    capability: 'risk-reviewed.settings-account-login-verification.inspect',
    intent: 'inspect_account_login_verification_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/account/passkey': Object.freeze({
    routeName: 'settings-account-passkey',
    capability: 'risk-reviewed.settings-account-passkey.inspect',
    intent: 'inspect_account_passkey_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/accessibility': Object.freeze({
    routeName: 'settings-accessibility',
    capability: 'risk-reviewed.settings-accessibility.inspect',
    intent: 'inspect_accessibility_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/security': Object.freeze({
    routeName: 'settings-security',
    capability: 'risk-reviewed.settings-security.inspect',
    intent: 'inspect_security_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/security_and_account_access': Object.freeze({
    routeName: 'settings-security-and-account-access',
    capability: 'risk-reviewed.settings-security-account-access.inspect',
    intent: 'inspect_security_account_access_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/privacy_and_safety': Object.freeze({
    routeName: 'settings-privacy-and-safety',
    capability: 'risk-reviewed.settings-privacy.inspect',
    intent: 'inspect_privacy_safety_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/profile': Object.freeze({
    routeName: 'settings-profile',
    capability: 'risk-reviewed.settings-profile.inspect',
    intent: 'inspect_profile_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/accessibility_display_and_languages': Object.freeze({
    routeName: 'settings-accessibility-display-languages',
    capability: 'risk-reviewed.settings-accessibility-display-languages.inspect',
    intent: 'inspect_accessibility_display_language_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/additional_resources': Object.freeze({
    routeName: 'settings-additional-resources',
    capability: 'risk-reviewed.settings-additional-resources.inspect',
    intent: 'inspect_additional_resources_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/about': Object.freeze({
    routeName: 'settings-about',
    capability: 'risk-reviewed.settings-about.inspect',
    intent: 'inspect_about_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/about_your_account': Object.freeze({
    routeName: 'settings-about-your-account',
    capability: 'risk-reviewed.settings-about-your-account.inspect',
    intent: 'inspect_about_your_account_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/ads_preferences': Object.freeze({
    routeName: 'settings-ads-preferences',
    capability: 'risk-reviewed.settings-ads-preferences.inspect',
    intent: 'inspect_ads_preferences_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/audience_and_tagging': Object.freeze({
    routeName: 'settings-audience-and-tagging',
    capability: 'risk-reviewed.settings-audience-tagging.inspect',
    intent: 'inspect_audience_tagging_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/autoplay': Object.freeze({
    routeName: 'settings-autoplay',
    capability: 'risk-reviewed.settings-autoplay.inspect',
    intent: 'inspect_autoplay_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/blocked/all': Object.freeze({
    routeName: 'settings-blocked-all',
    capability: 'risk-reviewed.settings-blocked-all.inspect',
    intent: 'inspect_blocked_accounts_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/connected_accounts': Object.freeze({
    routeName: 'settings-connected-accounts',
    capability: 'risk-reviewed.settings-connected-accounts.inspect',
    intent: 'inspect_connected_accounts_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/contacts': Object.freeze({
    routeName: 'settings-contacts',
    capability: 'risk-reviewed.settings-contacts.inspect',
    intent: 'inspect_contacts_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/contacts_dashboard': Object.freeze({
    routeName: 'settings-contacts-dashboard',
    capability: 'risk-reviewed.settings-contacts-dashboard.inspect',
    intent: 'inspect_contacts_dashboard_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/content_you_see': Object.freeze({
    routeName: 'settings-content-you-see',
    capability: 'risk-reviewed.settings-content-you-see.inspect',
    intent: 'inspect_content_you_see_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/data': Object.freeze({
    routeName: 'settings-data',
    capability: 'risk-reviewed.settings-data-index.inspect',
    intent: 'inspect_data_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/data_sharing_with_business_partners': Object.freeze({
    routeName: 'settings-data-sharing-with-business-partners',
    capability: 'risk-reviewed.settings-business-data-sharing.inspect',
    intent: 'inspect_business_data_sharing_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/deactivate': Object.freeze({
    routeName: 'settings-deactivate',
    capability: 'risk-reviewed.settings-deactivation.inspect',
    intent: 'inspect_account_deactivation_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/delegate': Object.freeze({
    routeName: 'settings-delegate',
    capability: 'risk-reviewed.settings-delegate.inspect',
    intent: 'inspect_delegate_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/delegate/groups': Object.freeze({
    routeName: 'settings-delegate-groups',
    capability: 'risk-reviewed.settings-delegate-groups.inspect',
    intent: 'inspect_delegate_groups_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/delegate/members': Object.freeze({
    routeName: 'settings-delegate-members',
    capability: 'risk-reviewed.settings-delegate-members.inspect',
    intent: 'inspect_delegate_members_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/direct_messages': Object.freeze({
    routeName: 'settings-direct-messages',
    capability: 'risk-reviewed.settings-direct-messages.inspect',
    intent: 'inspect_direct_messages_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/display': Object.freeze({
    routeName: 'settings-display',
    capability: 'risk-reviewed.settings-display.inspect',
    intent: 'inspect_display_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/download_your_data': Object.freeze({
    routeName: 'settings-download-your-data',
    capability: 'risk-reviewed.settings-download-data.inspect',
    intent: 'inspect_download_data_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/email_notifications': Object.freeze({
    routeName: 'settings-email-notifications',
    capability: 'risk-reviewed.settings-email-notifications-legacy.inspect',
    intent: 'inspect_legacy_email_notification_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/explore': Object.freeze({
    routeName: 'settings-explore',
    capability: 'risk-reviewed.settings-explore.inspect',
    intent: 'inspect_explore_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/explore/location': Object.freeze({
    routeName: 'settings-explore-location',
    capability: 'risk-reviewed.settings-explore-location.inspect',
    intent: 'inspect_explore_location_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/grok_settings': Object.freeze({
    routeName: 'settings-grok-settings',
    capability: 'risk-reviewed.settings-grok.inspect',
    intent: 'inspect_grok_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/languages': Object.freeze({
    routeName: 'settings-languages',
    capability: 'risk-reviewed.settings-languages.inspect',
    intent: 'inspect_language_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/location_information': Object.freeze({
    routeName: 'settings-location-information',
    capability: 'risk-reviewed.settings-location-information.inspect',
    intent: 'inspect_location_information_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/manage_subscriptions': Object.freeze({
    routeName: 'settings-manage-subscriptions',
    capability: 'risk-reviewed.settings-manage-subscriptions.inspect',
    intent: 'inspect_manage_subscriptions_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/monetization': Object.freeze({
    routeName: 'settings-monetization',
    capability: 'risk-reviewed.settings-monetization.inspect',
    intent: 'inspect_monetization_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/mute_and_block': Object.freeze({
    routeName: 'settings-mute-and-block',
    capability: 'risk-reviewed.settings-mute-block.inspect',
    intent: 'inspect_mute_block_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/muted/all': Object.freeze({
    routeName: 'settings-muted-all',
    capability: 'risk-reviewed.settings-muted-all.inspect',
    intent: 'inspect_muted_accounts_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/muted_keywords': Object.freeze({
    routeName: 'settings-muted-keywords',
    capability: 'risk-reviewed.settings-muted-keywords.inspect',
    intent: 'inspect_muted_keywords_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/notifications': Object.freeze({
    routeName: 'settings-notifications',
    capability: 'risk-reviewed.settings-notifications.inspect',
    intent: 'inspect_notification_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/notifications/email_notifications': Object.freeze({
    routeName: 'settings-notifications-email',
    capability: 'risk-reviewed.settings-email-notifications.inspect',
    intent: 'inspect_email_notification_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/notifications/advanced_filters': Object.freeze({
    routeName: 'settings-notifications-advanced-filters',
    capability: 'risk-reviewed.settings-notification-advanced-filters.inspect',
    intent: 'inspect_notification_advanced_filter_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/notifications/filters': Object.freeze({
    routeName: 'settings-notifications-filters',
    capability: 'risk-reviewed.settings-notification-filters.inspect',
    intent: 'inspect_notification_filter_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/notifications/preferences': Object.freeze({
    routeName: 'settings-notifications-preferences',
    capability: 'risk-reviewed.settings-notification-preferences.inspect',
    intent: 'inspect_notification_preference_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/notifications/push_notifications': Object.freeze({
    routeName: 'settings-notifications-push',
    capability: 'risk-reviewed.settings-push-notifications.inspect',
    intent: 'inspect_push_notification_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/off_twitter_activity': Object.freeze({
    routeName: 'settings-off-twitter-activity',
    capability: 'risk-reviewed.settings-off-twitter-activity.inspect',
    intent: 'inspect_off_twitter_activity_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/push_notifications': Object.freeze({
    routeName: 'settings-push-notifications',
    capability: 'risk-reviewed.settings-push-notifications-legacy.inspect',
    intent: 'inspect_legacy_push_notification_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/search': Object.freeze({
    routeName: 'settings-search',
    capability: 'risk-reviewed.settings-search.inspect',
    intent: 'inspect_settings_search_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/spaces': Object.freeze({
    routeName: 'settings-spaces',
    capability: 'risk-reviewed.settings-spaces.inspect',
    intent: 'inspect_spaces_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/your_twitter_data': Object.freeze({
    routeName: 'settings-your-twitter-data',
    capability: 'risk-reviewed.settings-data.inspect',
    intent: 'inspect_account_data_settings_index_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/your_twitter_data/account': Object.freeze({
    routeName: 'settings-your-twitter-data-account',
    capability: 'risk-reviewed.settings-data-account.inspect',
    intent: 'inspect_account_data_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/settings/your_tweets': Object.freeze({
    routeName: 'settings-your-tweets',
    capability: 'risk-reviewed.settings-your-tweets.inspect',
    intent: 'inspect_your_tweets_settings_surface',
    requiresRiskReviewedRead: true,
  }),
  '/i/status/{statusId}': Object.freeze({
    routeName: 'internal-status',
    capability: 'content.internal-status.inspect',
    intent: 'inspect_internal_status_redirect',
    requiresStatusId: true,
  }),
  '/i/spaces/{spaceId}': Object.freeze({
    routeName: 'audio-space',
    capability: 'audio.space.inspect',
    intent: 'inspect_audio_space',
    requiresSpaceId: true,
  }),
  '/{account}/status/{statusId}': Object.freeze({
    routeName: 'status-detail',
    capability: 'content.status.inspect',
    intent: 'inspect_status_detail',
    requiresAccount: true,
    requiresStatusId: true,
  }),
  '/{account}/status/{statusId}/analytics': Object.freeze({
    routeName: 'status-analytics',
    capability: 'risk-reviewed.status-analytics.inspect',
    intent: 'inspect_status_analytics',
    requiresAccount: true,
    requiresStatusId: true,
    requiresRiskReviewedRead: true,
  }),
  '/{account}/status/{statusId}/likes': Object.freeze({
    routeName: 'status-likes',
    capability: 'engagement.status-likes.inspect',
    intent: 'inspect_status_likes',
    requiresAccount: true,
    requiresStatusId: true,
  }),
  '/{account}/status/{statusId}/photo/{mediaId}': Object.freeze({
    routeName: 'status-photo',
    capability: 'media.status-photo.inspect',
    intent: 'inspect_status_photo',
    requiresAccount: true,
    requiresStatusId: true,
    requiresMediaId: true,
  }),
  '/{account}/status/{statusId}/quotes': Object.freeze({
    routeName: 'status-quotes',
    capability: 'engagement.status-quotes.inspect',
    intent: 'inspect_status_quotes',
    requiresAccount: true,
    requiresStatusId: true,
  }),
  '/{account}/status/{statusId}/retweets': Object.freeze({
    routeName: 'status-retweets',
    capability: 'engagement.status-retweets.inspect',
    intent: 'inspect_status_retweets',
    requiresAccount: true,
    requiresStatusId: true,
  }),
  '/explore/tabs/news': Object.freeze({
    routeName: 'explore-news',
    capability: 'app.explore-news.inspect',
    intent: 'inspect_news_explore_surface',
  }),
  '/explore/tabs/trending': Object.freeze({
    routeName: 'explore-trending',
    capability: 'app.explore-trending.inspect',
    intent: 'inspect_trending_explore_surface',
  }),
  '/home': Object.freeze({
    routeName: 'home',
    capability: 'app.home.inspect',
    intent: 'inspect_home_timeline',
  }),
  '/explore': Object.freeze({
    routeName: 'explore',
    capability: 'app.explore.inspect',
    intent: 'inspect_explore_surface',
  }),
  '/explore/tabs/for-you': Object.freeze({
    routeName: 'explore-for-you',
    capability: 'app.explore-for-you.inspect',
    intent: 'inspect_for_you_explore_surface',
  }),
  '/notifications': Object.freeze({
    routeName: 'notifications',
    capability: 'app.notifications.inspect',
    intent: 'inspect_notifications',
  }),
  '/notifications/mentions': Object.freeze({
    routeName: 'notification-mentions',
    capability: 'app.notification-mentions.inspect',
    intent: 'inspect_notification_mentions',
  }),
  '/notifications/verified': Object.freeze({
    routeName: 'notification-verified',
    capability: 'app.notification-verified.inspect',
    intent: 'inspect_verified_notifications',
  }),
  '/search': Object.freeze({
    routeName: 'search-empty',
    capability: 'search.surface.inspect',
    intent: 'inspect_search_surface',
  }),
  '/search?q=:query&src=typed_query': Object.freeze({
    routeName: 'search-top',
    capability: 'search.top.inspect',
    intent: 'inspect_search_top_results',
    requiresQuery: true,
  }),
  '/i/bookmarks': Object.freeze({
    routeName: 'bookmarks',
    capability: 'app.bookmarks.inspect',
    intent: 'inspect_bookmarks',
  }),
  '/i/keyboard_shortcuts': Object.freeze({
    routeName: 'keyboard-shortcuts',
    capability: 'app.keyboard-shortcuts.inspect',
    intent: 'inspect_keyboard_shortcuts_surface',
  }),
  '/i/articles': Object.freeze({
    routeName: 'articles',
    capability: 'app.articles.inspect',
    intent: 'inspect_articles_surface',
  }),
  '/i/communities': Object.freeze({
    routeName: 'communities',
    capability: 'app.communities.inspect',
    intent: 'inspect_communities_surface',
  }),
  '/i/communities/{communityId}': Object.freeze({
    routeName: 'community-detail',
    capability: 'communities.detail.inspect',
    intent: 'inspect_community_detail',
    requiresCommunityId: true,
  }),
  '/i/communities/{communityId}/about': Object.freeze({
    routeName: 'community-about',
    capability: 'communities.about.inspect',
    intent: 'inspect_community_about',
    requiresCommunityId: true,
  }),
  '/i/communities/{communityId}/members': Object.freeze({
    routeName: 'community-members',
    capability: 'communities.members.inspect',
    intent: 'inspect_community_members',
    requiresCommunityId: true,
  }),
  '/i/communities/{communityId}/members/search': Object.freeze({
    routeName: 'community-members-search',
    capability: 'communities.members-search.inspect',
    intent: 'inspect_community_members_search',
    requiresCommunityId: true,
  }),
  '/i/communities/{communityId}/search': Object.freeze({
    routeName: 'community-search',
    capability: 'communities.search.inspect',
    intent: 'inspect_community_search',
    requiresCommunityId: true,
  }),
  '/i/connect_people': Object.freeze({
    routeName: 'connect-people',
    capability: 'app.connect-people.inspect',
    intent: 'inspect_connect_people',
  }),
  '/i/grok': Object.freeze({
    routeName: 'grok',
    capability: 'app.grok.inspect',
    intent: 'inspect_grok_surface',
  }),
  '/jobs': Object.freeze({
    routeName: 'jobs',
    capability: 'app.jobs.inspect',
    intent: 'inspect_jobs_surface',
  }),
  '/i/lists': Object.freeze({
    routeName: 'lists',
    capability: 'app.lists.inspect',
    intent: 'inspect_lists_surface',
  }),
  '/i/lists/{listId}': Object.freeze({
    routeName: 'list-detail',
    capability: 'lists.detail.inspect',
    intent: 'inspect_list_detail',
    requiresListId: true,
  }),
  '/i/lists/{listId}/followers': Object.freeze({
    routeName: 'list-followers',
    capability: 'lists.followers.inspect',
    intent: 'inspect_list_followers',
    requiresListId: true,
  }),
  '/i/lists/{listId}/members': Object.freeze({
    routeName: 'list-members',
    capability: 'lists.members.inspect',
    intent: 'inspect_list_members',
    requiresListId: true,
  }),
});

function normalizeXReadRoutePath(value, config) {
  const raw = String(value ?? '').trim();
  if (!raw || config.siteKey !== 'x') {
    return null;
  }
  const alias = X_READ_ROUTE_ALIASES[raw.toLowerCase().replace(/^\/+/u, '')];
  if (alias) {
    return { routePath: alias, account: null, query: null };
  }
  try {
    const parsed = new URL(raw, `${config.baseUrl}/`);
    if (parsed.hostname.toLowerCase() !== config.host) {
      return null;
    }
    const pathname = parsed.pathname.replace(/\/+$/u, '') || '/';
    if (X_READ_ROUTE_DETAILS[pathname]) {
      return { routePath: pathname, account: null, query: null };
    }
    if (pathname === '/search' && parsed.searchParams.has('q') && parsed.searchParams.has('src') && !parsed.searchParams.has('f')) {
      return {
        routePath: '/search?q=:query&src=typed_query',
        account: null,
        query: parsed.searchParams.get('q'),
      };
    }
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length === 3 && parts[0] === 'i' && parts[1] === 'status' && /^\d+$/u.test(parts[2])) {
      return {
        routePath: '/i/status/{statusId}',
        account: null,
        statusId: parts[2],
        query: null,
      };
    }
    if (parts.length === 3 && parts[0] === 'i' && parts[1] === 'communities' && /^[A-Za-z0-9_-]+$/u.test(parts[2])) {
      return {
        routePath: '/i/communities/{communityId}',
        account: null,
        communityId: parts[2],
        query: null,
      };
    }
    if (
      parts.length === 4
      && parts[0] === 'i'
      && parts[1] === 'communities'
      && /^[A-Za-z0-9_-]+$/u.test(parts[2])
      && ['about', 'members', 'search'].includes(parts[3])
    ) {
      return {
        routePath: `/i/communities/{communityId}/${parts[3]}`,
        account: null,
        communityId: parts[2],
        query: null,
      };
    }
    if (
      parts.length === 5
      && parts[0] === 'i'
      && parts[1] === 'communities'
      && /^[A-Za-z0-9_-]+$/u.test(parts[2])
      && parts[3] === 'members'
      && parts[4] === 'search'
    ) {
      return {
        routePath: '/i/communities/{communityId}/members/search',
        account: null,
        communityId: parts[2],
        query: null,
      };
    }
    if (parts.length === 3 && parts[0] === 'i' && parts[1] === 'lists' && /^[A-Za-z0-9_-]+$/u.test(parts[2])) {
      return {
        routePath: '/i/lists/{listId}',
        account: null,
        listId: parts[2],
        query: null,
      };
    }
    if (
      parts.length === 4
      && parts[0] === 'i'
      && parts[1] === 'lists'
      && /^[A-Za-z0-9_-]+$/u.test(parts[2])
      && ['followers', 'members'].includes(parts[3])
    ) {
      return {
        routePath: `/i/lists/{listId}/${parts[3]}`,
        account: null,
        listId: parts[2],
        query: null,
      };
    }
    if (parts.length === 3 && parts[0] === 'i' && parts[1] === 'spaces' && /^[A-Za-z0-9_-]+$/u.test(parts[2])) {
      return {
        routePath: '/i/spaces/{spaceId}',
        account: null,
        spaceId: parts[2],
        query: null,
      };
    }
    if (
      parts.length === 2
      && ['articles', 'communities', 'followers_you_follow', 'likes', 'lists', 'photo', 'verified_followers'].includes(parts[1])
      && !isReservedAccountSegment(parts[0], config)
    ) {
      return {
        routePath: `/{account}/${parts[1]}`,
        account: parts[0].replace(/^@/u, ''),
        query: null,
      };
    }
    if (
      parts.length === 3
      && parts[1] === 'communities'
      && parts[2] === 'explore'
      && !isReservedAccountSegment(parts[0], config)
    ) {
      return {
        routePath: '/{account}/communities/explore',
        account: parts[0].replace(/^@/u, ''),
        query: null,
      };
    }
    if (
      parts.length >= 3
      && parts[1] === 'status'
      && /^\d+$/u.test(parts[2])
      && !isReservedAccountSegment(parts[0], config)
    ) {
      if (parts.length === 3) {
        return {
          routePath: '/{account}/status/{statusId}',
          account: parts[0].replace(/^@/u, ''),
          statusId: parts[2],
          query: null,
        };
      }
      if (parts.length === 4 && ['analytics', 'likes', 'quotes', 'retweets'].includes(parts[3])) {
        return {
          routePath: `/{account}/status/{statusId}/${parts[3]}`,
          account: parts[0].replace(/^@/u, ''),
          statusId: parts[2],
          query: null,
        };
      }
      if (parts.length === 5 && parts[3] === 'photo' && /^\d+$/u.test(parts[4])) {
        return {
          routePath: '/{account}/status/{statusId}/photo/{mediaId}',
          account: parts[0].replace(/^@/u, ''),
          statusId: parts[2],
          mediaId: parts[4],
          query: null,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function buildXReadRouteUrl(config, routePath, { account = null, query = null, statusId = null, mediaId = null, spaceId = null, communityId = null, listId = null } = /** @type {any} */ ({})) {
  if (routePath === '/search?q=:query&src=typed_query') {
    const parsed = new URL('/search', `${config.baseUrl}/`);
    parsed.searchParams.set('q', normalizeText(query || ''));
    parsed.searchParams.set('src', 'typed_query');
    return parsed.toString();
  }
  const pathValue = String(routePath)
    .replace('{account}', account ? encodeURIComponent(account) : '')
    .replace('{statusId}', statusId ? encodeURIComponent(statusId) : '')
    .replace('{mediaId}', mediaId ? encodeURIComponent(mediaId) : '')
    .replace('{spaceId}', spaceId ? encodeURIComponent(spaceId) : '')
    .replace('{communityId}', communityId ? encodeURIComponent(communityId) : '')
    .replace('{listId}', listId ? encodeURIComponent(listId) : '');
  return new URL(pathValue, `${config.baseUrl}/`).toString();
}

function firstNonEmpty(values = /** @type {any[]} */ ([])) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

export function buildSocialActionPlan(input = /** @type {any} */ ({})) {
  const config = resolveSocialSiteConfig(input.site ?? input.siteKey ?? input.host);
  const action = normalizeAction(input.action ?? 'account-info', input.contentType);
  const contentType = normalizeContentType(input.action, input.contentType, config.siteKey);
  const routeInput = action === 'read-route'
    ? firstNonEmpty([input.route, input.routePath, input.path, input.url, input.target])
    : null;
  const readRoute = routeInput ? normalizeXReadRoutePath(routeInput, config) : null;
  const account = normalizeSocialAccount(input.account ?? input.handle ?? input.user ?? input.profile ?? readRoute?.account ?? input.target, config.siteKey);
  const query = firstNonEmpty([input.query, input.keyword, input.q, readRoute?.query]);
  const statusId = normalizeNumericId(input.statusId ?? input.tweetId ?? input.postId ?? readRoute?.statusId);
  const mediaId = normalizeNumericId(input.mediaId ?? input.photoId ?? readRoute?.mediaId);
  const spaceId = normalizeOpaqueId(input.spaceId ?? readRoute?.spaceId);
  const communityId = normalizeOpaqueId(input.communityId ?? input.community ?? readRoute?.communityId);
  const listId = normalizeOpaqueId(input.listId ?? input.list ?? readRoute?.listId);
  const routePath = action === 'read-route'
    ? readRoute?.routePath ?? null
    : null;
  const dateWindow = normalizeDateWindow({
    date: input.date,
    fromDate: input.fromDate ?? input.from,
    toDate: input.toDate ?? input.to,
  });

  let url = config.homeUrl;
  let requiresAccount = false;
  let requiresAuth = true;
  let plannerNotes = /** @type {any[]} */ ([]);

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
    requiresAuth = config.siteKey === 'x' || config.siteKey === 'instagram';
  } else if (action === 'read-route') {
    if (!routePath) {
      throw new Error('read-route requires a supported X --route path.');
    }
    const detail = X_READ_ROUTE_DETAILS[routePath] ?? {};
    if (detail.requiresAccount && !account) {
      throw new Error('read-route requires --account <handle> for this X route.');
    }
    if (detail.requiresQuery && !query) {
      throw new Error('read-route requires --query <value> for this X route.');
    }
    if (detail.requiresStatusId && !statusId) {
      throw new Error('read-route requires --status-id <id> for this X route.');
    }
    if (detail.requiresMediaId && !mediaId) {
      throw new Error('read-route requires --media-id <id> for this X route.');
    }
    if (detail.requiresSpaceId && !spaceId) {
      throw new Error('read-route requires --space-id <id> for this X route.');
    }
    if (detail.requiresCommunityId && !communityId) {
      throw new Error('read-route requires --community-id <id> for this X route.');
    }
    if (detail.requiresListId && !listId) {
      throw new Error('read-route requires --list-id <id> for this X route.');
    }
    if (detail.requiresRiskReviewedRead && input.riskReviewedReadSurfaces !== true) {
      throw new Error('read-route requires --risk-reviewed-read-surfaces for this higher-risk read-only X route.');
    }
    url = buildXReadRouteUrl(config, routePath, { account, query, statusId, mediaId, spaceId, communityId, listId });
    requiresAuth = true;
    plannerNotes.push('Using a bounded read-only same-site route as the crawl start surface.');
  }
  const readRouteDetail = routePath ? X_READ_ROUTE_DETAILS[routePath] : null;

  return {
    siteKey: config.siteKey,
    host: config.host,
    action,
    contentType,
    account,
    query,
    routePath,
    routeName: readRouteDetail?.routeName ?? null,
    statusId,
    mediaId,
    spaceId,
    communityId,
    listId,
    capability: readRouteDetail?.capability ?? null,
    intent: readRouteDetail?.intent ?? null,
    ...dateWindow,
    url,
    requiresAccount,
    requiresAuth,
    canRunWithoutAccount: ['followed-users', 'followed-posts-by-date', 'search', 'read-route'].includes(action),
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

function socialStateHasExtractedContent(state = /** @type {any} */ ({})) {
  return Boolean(
    (Array.isArray(state.items) && state.items.length > 0)
    || (Array.isArray(state.relations) && state.relations.length > 0)
    || (Array.isArray(state.media) && state.media.length > 0)
  );
}

function isNoContentReadRoutePlan(plan = /** @type {any} */ ({})) {
  const routePath = String(plan?.routePath ?? '');
  return plan?.siteKey === 'x'
    && plan?.action === 'read-route'
    && (
      routePath === '/messages'
      || routePath === '/i/chat'
      || routePath === '/i/keyboard_shortcuts'
      || routePath === '/notifications'
      || routePath.startsWith('/notifications/')
      || routePath === '/settings'
      || routePath.startsWith('/settings/')
    );
}

function noContentRequestForPlan(plan = /** @type {any} */ ({})) {
  const noContent = isNoContentReadRoutePlan(plan);
  return {
    noContent,
    noContentRouteTemplate: noContent ? plan.routePath : null,
  };
}

function contentSuppressionReasonForPlan(plan = /** @type {any} */ ({})) {
  const routePath = String(plan?.routePath ?? '');
  if (routePath === '/messages' || routePath === '/i/chat') return 'sensitive-message-surface';
  if (routePath === '/i/keyboard_shortcuts') return 'structure-only-app-surface';
  if (routePath === '/notifications' || routePath.startsWith('/notifications/')) return 'sensitive-notification-surface';
  if (routePath === '/settings' || routePath.startsWith('/settings/')) return 'sensitive-settings-surface';
  return 'sensitive-read-surface';
}

function socialStateHasProfileSurface(state = /** @type {any} */ ({})) {
  return Boolean(
    cleanText(state?.account?.displayName || '')
    || cleanText(state?.account?.bio || '')
    || (Array.isArray(state?.account?.stats) && state.account.stats.length > 0)
  );
}

function socialStateHasBoundarySignal(state = /** @type {any} */ ({})) {
  return Boolean(
    (Array.isArray(state.visibilitySignals) && state.visibilitySignals.length > 0)
    || (Array.isArray(state.riskSignals) && state.riskSignals.length > 0)
  );
}

function isLikelyXBlankShell(state = /** @type {any} */ ({})) {
  const title = cleanText(state?.title || '');
  const inventory = state?.surfaceInventory && typeof state.surfaceInventory === 'object'
    ? state.surfaceInventory
    : {};
  const lowInventory = (inventory.linkCount ?? 0) === 0 && (inventory.controlCount ?? 0) <= 3;
  return (title === 'X' || title === '')
    && !socialStateHasExtractedContent(state)
    && !socialStateHasProfileSurface(state)
    && !socialStateHasBoundarySignal(state)
    && lowInventory;
}

function isSocialListAction(action) {
  return [
    'profile-content',
    'profile-following',
    'profile-followers',
    'followed-users',
    'followed-posts-by-date',
    'search',
  ].includes(String(action ?? ''));
}

function socialStateHasListSurface(state = /** @type {any} */ ({}), request = /** @type {any} */ ({})) {
  if (['profile-following', 'profile-followers', 'followed-users'].includes(String(request.action ?? ''))) {
    return Array.isArray(state.relations) && state.relations.length > 0;
  }
  return Array.isArray(state.items) && state.items.length > 0;
}

function initialSocialStateReady(config, state = /** @type {any} */ ({}), request = /** @type {any} */ ({})) {
  if (!state) {
    return false;
  }
  if (socialStateHasBoundarySignal(state)) {
    return true;
  }
  if (config?.siteKey === 'x' && isSocialListAction(request.action)) {
    return socialStateHasListSurface(state, request);
  }
  if (socialStateHasExtractedContent(state) || socialStateHasProfileSurface(state)) {
    return true;
  }
  if (config?.siteKey !== 'x') {
    return true;
  }
  return !isLikelyXBlankShell(state);
}

async function readInitialSocialState(session, config, plan, settings) {
  const request = {
    account: plan.account,
    action: plan.action,
    contentType: plan.contentType,
    date: plan.date,
    fromDate: plan.fromDate,
    toDate: plan.toDate,
    ...noContentRequestForPlan(plan),
  };
  const startedAt = Date.now();
  const shouldWaitForSpaSurface = config?.siteKey === 'x';
  const xSurfaceWaitMs = settings.probeReadControls ? 30_000 : 15_000;
  const deadline = startedAt + (shouldWaitForSpaSurface ? Math.min(settings.timeoutMs ?? DEFAULT_TIMEOUT_MS, xSurfaceWaitMs) : 0);
  const pollMs = Math.min(700, Math.max(50, settings.scrollWaitMs || 0));
  let attempts = 0;
  let state = null;
  while (true) {
    attempts += 1;
    state = await session.callPageFunction(pageExtractSocialState, config, request);
    if (initialSocialStateReady(config, state, request)) {
      return {
        state,
        surfaceWait: {
          ready: true,
          attempts,
          elapsedMs: Date.now() - startedAt,
        },
      };
    }
    if (!shouldWaitForSpaSurface || Date.now() >= deadline) {
      return {
        state,
        surfaceWait: {
          ready: false,
          reason: isLikelyXBlankShell(state) ? 'x-blank-shell-timeout' : 'social-surface-timeout',
          attempts,
          elapsedMs: Date.now() - startedAt,
        },
      };
    }
    await sleep(pollMs);
  }
}

function pageExtractSocialState(config, request) {
  const normalize = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
  const normalizeKey = (value) => normalize(value).toLowerCase().replace(/[^a-z0-9:_/-]+/giu, '-').replace(/^-|-$/gu, '').slice(0, 80);
  const noContent = request?.noContent === true;
  const safeToken = (value) => {
    let token = normalizeKey(value).replace(/\d{4,}/gu, ':id');
    for (const dynamicValue of [request.account, currentProfileLink]) {
      const dynamicToken = normalizeKey(dynamicValue);
      if (dynamicToken) {
        token = token
          .split(/([:_/-]+)/u)
          .map((part) => (part === dynamicToken ? ':account' : part))
          .join('');
      }
    }
    if (/^useravatar-container-[a-z0-9_:-]+$/u.test(token)) {
      token = 'useravatar-container-:account';
    }
    if (!token || /(?:auth|bearer|cookie|ct0|password|secret|session|token)/iu.test(token)) {
      return null;
    }
    return token;
  };
  const controlLabelKind = (value) => {
    const text = normalize(value).toLowerCase();
    if (!text) return null;
    /** @type {Array<[string, RegExp]>} */
    const matches = [
      ['search', /\bsearch\b|\u641c\u7d22/u],
      ['post', /\b(?:post|tweet|compose)\b/u],
      ['reply', /\breply\b/u],
      ['repost', /\b(?:repost|retweet)\b/u],
      ['like', /\blike\b/u],
      ['bookmark', /\bbookmark\b/u],
      ['share', /\bshare\b/u],
      ['follow', /\bfollow\b/u],
      ['menu', /\b(?:more|menu)\b/u],
      ['close', /\bclose\b/u],
      ['back', /\bback\b/u],
      ['next', /\bnext\b/u],
      ['skip', /\bskip(?: to)?\b|\u8df3\u81f3/u],
      ['retry', /\b(?:retry|reload|try again)\b/u],
      ['login', /\b(?:log in|login|sign in)\b/u],
      ['notifications', /\bnotifications?\b/u],
      ['messages', /\bmessages?\b/u],
      ['profile', /\bprofile\b/u],
      ['translation', /\b(?:show original|translate|translation)\b|\u663e\u793a\u539f\u6587|\u7ffb\u8bd1/u],
    ];
    return matches.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
  };
  const descendantLabelText = (node) => normalize([...(node.querySelectorAll?.('[aria-label], [title], [alt], title') ?? [])]
    .map((child) => child.getAttribute?.('aria-label') || child.getAttribute?.('title') || child.getAttribute?.('alt') || child.textContent || '')
    .filter(Boolean)
    .join(' '));
  const controlLabelText = (node) => normalize([
    node.getAttribute('aria-label') || '',
    node.getAttribute('name') || '',
    node.getAttribute('placeholder') || '',
    node.getAttribute('title') || '',
    descendantLabelText(node),
    node.textContent || '',
  ].filter(Boolean).join(' '));
  const anonymousControlSignature = (node) => {
    const closestRoleNode = node.closest?.('[role]');
    const closestRole = closestRoleNode && closestRoleNode !== node
      ? normalize(closestRoleNode.getAttribute('role') || '').toLowerCase()
      : null;
    return {
      role: normalize(node.getAttribute('role') || node.tagName || 'control').toLowerCase(),
      type: safeToken(node.getAttribute('type') || ''),
      disabled: Boolean(node.disabled || node.getAttribute('aria-disabled') === 'true'),
      closestRole: safeToken(closestRole),
      inArticle: Boolean(node.closest?.('article')),
      inDialog: Boolean(node.closest?.('[role="dialog"], [aria-modal="true"]')),
      inForm: Boolean(node.closest?.('form')),
      svgCount: node.querySelectorAll?.('svg').length ?? 0,
      imageCount: node.querySelectorAll?.('img, video, source').length ?? 0,
      childElementCount: node.children?.length ?? 0,
    };
  };
  const controlIconSignature = (node) => {
    const svg = node.querySelector?.('svg');
    if (!svg) return null;
    const paths = [...(svg.querySelectorAll?.('path') ?? [])]
      .map((pathNode) => pathNode.getAttribute?.('d') || '')
      .filter(Boolean)
      .slice(0, 6);
    if (!paths.length) return null;
    const viewBox = normalize(svg.getAttribute('viewBox') || '');
    const pathLengths = paths.map((value) => value.length).join('-');
    const commandShape = paths
      .map((value) => (value.match(/[a-z]/giu) || []).slice(0, 16).join(''))
      .join('-');
    return safeToken(`${viewBox}-${paths.length}-${pathLengths}-${commandShape}`);
  };
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
  const hostAllowed = (url) => {
    try {
      const parsed = new URL(url, window.location.origin);
      return parsed.hostname === window.location.hostname || parsed.hostname.endsWith(`.${window.location.hostname}`);
    } catch {
      return false;
    }
  };
  const routeTemplateFromHref = (href) => {
    try {
      const parsed = new URL(href, window.location.origin);
      if (!hostAllowed(parsed.href)) {
        return null;
      }
      const safeRouteSegments = new Set([
        ...config.reservedSegments,
        'about',
        'about_your_account',
        'account',
        'accessibility_display_and_languages',
        'additional_resources',
        'ads_preferences',
        'accessibility',
        'affiliates',
        'analytics',
        'articles',
        'audience_and_tagging',
        'autoplay',
        'bookmarks',
        'chat',
        'communities',
        'content_you_see',
        'connect_people',
        'creators',
        'data_sharing_with_business_partners',
        'data_usage',
        'direct_messages',
        'discoverability_and_contacts',
        'display',
        'email_notifications',
        'filters',
        'for-you',
        'followers',
        'followers_you_follow',
        'following',
        'groups',
        'grok_settings',
        'grok',
        'header_photo',
        'help',
        'how-twitter-ads-work.html',
        'jf',
        'keyboard_shortcuts',
        'likes',
        'lists',
        'location',
        'location_information',
        'media',
        'members',
        'mentions',
        'mute_and_block',
        'off_twitter_activity',
        'photo',
        'post',
        'premium_sign_up',
        'preferences',
        'privacy_and_safety',
        'push_notifications',
        'quotes',
        'retweets',
        'security',
        'spaces',
        'status',
        'studio',
        'stories',
        'tabs',
        'verified',
        'troubleshooting',
        'verified_followers',
        'with_replies',
        'your_tweets',
        'your_twitter_data',
      ]);
      const parts = parsed.pathname.split('/').filter(Boolean);
      const isSafeStructureRouteSegment = (part, index) => {
        const lower = String(part ?? '').toLowerCase();
        if (index === 0 || !/^[a-z][a-z0-9_]{1,63}$/u.test(lower)) return false;
        if (/(?:auth|bearer|cookie|ct0|password|secret|session|token)/iu.test(lower)) return false;
        const root = String(parts[0] ?? '').toLowerCase();
        return root === 'settings' || root === 'notifications';
      };
      const templated = parts.map((part, index) => {
        const lower = part.toLowerCase();
        if (/^\d+$/u.test(part)) return ':id';
        if (index === 0 && !config.reservedSegments.includes(lower)) return ':account';
        if (safeRouteSegments.has(lower) || isSafeStructureRouteSegment(part, index)) return lower;
        return ':segment';
      });
      const path = `/${templated.join('/')}`.replace(/\/$/u, '') || '/';
      if (parsed.pathname === '/search') {
        const q = parsed.searchParams.has('q') ? 'q=:query' : '';
        const src = parsed.searchParams.has('src') ? 'src=:src' : '';
        const f = parsed.searchParams.has('f') ? 'f=:filter' : '';
        const search = [q, src, f].filter(Boolean).join('&');
        return search ? `${path}?${search}` : path;
      }
      return path;
    } catch {
      return null;
    }
  };
  const classifyLink = (href, label = '') => {
    const template = routeTemplateFromHref(href);
    const text = `${template ?? ''} ${label}`.toLowerCase();
    if (/\/status(?:\/:id)?/u.test(text)) return 'content-detail';
    if (/following/u.test(text)) return 'following';
    if (/followers/u.test(text)) return 'followers';
    if (/with_replies/u.test(text)) return 'profile-replies';
    if (/media/u.test(text)) return 'profile-media';
    if (/highlights/u.test(text)) return 'profile-highlights';
    if (/\/search/u.test(text)) return 'search';
    if (/\/home/u.test(text)) return 'home';
    if (/notifications/u.test(text)) return 'notifications';
    if (/messages/u.test(text)) return 'messages';
    if (/bookmarks/u.test(text)) return 'bookmarks';
    if (template === '/:account') return 'profile';
    return template ? 'same-site-link' : 'external-or-unsupported';
  };
  const classifyControlFunction = (entry = /** @type {any} */ ({})) => {
    const role = String(entry.role ?? '').toLowerCase();
    const testId = String(entry.testId ?? '').toLowerCase();
    const labelKind = String(entry.labelKind ?? '').toLowerCase();
    const routeTemplate = String(entry.routeTemplate ?? '').toLowerCase();
    const ancestorTestId = String(entry.ancestorTestId ?? '').toLowerCase();
    const descendantTestId = String(entry.descendantTestId ?? '').toLowerCase();
    const descendantLabelKind = String(entry.descendantLabelKind ?? '').toLowerCase();
    const iconSignature = String(entry.iconSignature ?? '').toLowerCase();
    const key = `${role} ${testId} ${labelKind} ${routeTemplate} ${ancestorTestId} ${descendantTestId} ${descendantLabelKind} ${iconSignature}`;
    const has = (...tokens) => tokens.some((token) => key.includes(token));
    if (entry.disabled === true && ['button', 'link', 'menuitem'].includes(role)) {
      return {
        functionKind: 'interactive.disabled-control',
        intent: 'observe_disabled_interactive_control',
        executionClass: 'observed-only',
        mutationRisk: 'none',
      };
    }
    if (has('login', 'sign-in')) {
      return {
        functionKind: 'auth.login',
        intent: 'authenticate_session',
        executionClass: 'auth-blocked',
        mutationRisk: 'account-auth',
      };
    }
    if (has('follow', 'unfollow')) {
      return {
        functionKind: 'relation.follow-toggle',
        intent: 'mutate_follow_state',
        executionClass: 'mutation-blocked',
        mutationRisk: 'relationship-write',
      };
    }
    if (has('like')) {
      return {
        functionKind: 'engagement.like-toggle',
        intent: 'mutate_like_state',
        executionClass: 'mutation-blocked',
        mutationRisk: 'engagement-write',
      };
    }
    if (has('retweet', 'repost')) {
      return {
        functionKind: 'engagement.repost-toggle',
        intent: 'mutate_repost_state',
        executionClass: 'mutation-blocked',
        mutationRisk: 'engagement-write',
      };
    }
    if (has('reply')) {
      return {
        functionKind: 'compose.reply',
        intent: 'create_reply',
        executionClass: 'mutation-blocked',
        mutationRisk: 'content-write',
      };
    }
    if (has('bookmark')) {
      return {
        functionKind: 'engagement.bookmark-toggle',
        intent: 'mutate_bookmark_state',
        executionClass: 'mutation-blocked',
        mutationRisk: 'engagement-write',
      };
    }
    if (has('tweetbutton', 'newtweet', 'compose') || labelKind === 'post') {
      return {
        functionKind: 'compose.post',
        intent: 'create_post',
        executionClass: 'mutation-blocked',
        mutationRisk: 'content-write',
      };
    }
    if (has('contentdisclosurebutton')) {
      return {
        functionKind: 'compose.content-disclosure',
        intent: 'configure_content_disclosure',
        executionClass: 'mutation-blocked',
        mutationRisk: 'content-write',
      };
    }
    if (has('createpollbutton')) {
      return {
        functionKind: 'compose.poll',
        intent: 'add_post_poll',
        executionClass: 'mutation-blocked',
        mutationRisk: 'content-write',
      };
    }
    if (has('gifsearchbutton')) {
      return {
        functionKind: 'compose.gif',
        intent: 'add_post_gif',
        executionClass: 'mutation-blocked',
        mutationRisk: 'content-write',
      };
    }
    if (has('geobutton')) {
      return {
        functionKind: 'compose.location',
        intent: 'add_post_location',
        executionClass: 'mutation-blocked',
        mutationRisk: 'content-write',
      };
    }
    if (has('grokimggen')) {
      return {
        functionKind: 'compose.grok-image',
        intent: 'generate_post_image',
        executionClass: 'mutation-blocked',
        mutationRisk: 'content-write',
      };
    }
    if (has('scheduleoption')) {
      return {
        functionKind: 'compose.schedule',
        intent: 'schedule_post',
        executionClass: 'mutation-blocked',
        mutationRisk: 'content-write',
      };
    }
    if (ancestorTestId === 'primarycolumn' && iconSignature === '0-0-24-24-1-296-mcszmllvlcllllzm') {
      return {
        functionKind: 'compose.reply-permissions',
        intent: 'configure_reply_permissions',
        executionClass: 'mutation-blocked',
        mutationRisk: 'content-write',
      };
    }
    if (ancestorTestId === 'primarycolumn' && iconSignature === '0-0-24-24-1-999-mhlclclvlclclhlc') {
      return {
        functionKind: 'content.translation-info',
        intent: 'inspect_translation_info',
        executionClass: 'read-menu-probe',
        mutationRisk: 'none',
      };
    }
    if (labelKind === 'translation') {
      return {
        functionKind: 'content.translation-toggle',
        intent: 'toggle_content_translation',
        executionClass: 'read-navigation-probe',
        mutationRisk: 'none',
      };
    }
    if (ancestorTestId === 'tweet' && iconSignature === '0-0-24-24-1-199-mllvhvllzmlchcvh') {
      return {
        functionKind: 'share.menu',
        intent: 'open_share_options',
        executionClass: 'read-menu-probe',
        mutationRisk: 'none',
      };
    }
    if (ancestorTestId === 'primarycolumn' && iconSignature === '0-0-24-24-1-253-mvhvhvhvhvhvhzmh') {
      return {
        functionKind: 'account.notifications-toggle',
        intent: 'mutate_account_notification_state',
        executionClass: 'mutation-blocked',
        mutationRisk: 'notification-write',
      };
    }
    if (has('tweet-text-show-more-link', 'show-more')) {
      return {
        functionKind: 'content.expand',
        intent: 'expand_content_text',
        executionClass: 'read-navigation-probe',
        mutationRisk: 'none',
      };
    }
    if (has('app-bar-back') || labelKind === 'back') {
      return {
        functionKind: 'navigation.back',
        intent: 'navigate_read_surface',
        executionClass: 'read-navigation-probe',
        mutationRisk: 'none',
      };
    }
    if (has('app-bar-close') || labelKind === 'close') {
      return {
        functionKind: 'navigation.close',
        intent: 'close_current_panel',
        executionClass: 'read-navigation-probe',
        mutationRisk: 'none',
      };
    }
    if (labelKind === 'skip') {
      return {
        functionKind: 'navigation.skip',
        intent: 'skip_to_content',
        executionClass: 'read-navigation-probe',
        mutationRisk: 'none',
      };
    }
    if (has('chat-drawer', 'grokdrawer', 'accountswitcher')) {
      return {
        functionKind: 'menu.open',
        intent: 'inspect_available_options',
        executionClass: 'read-menu-probe',
        mutationRisk: 'none',
      };
    }
    if (has('share')) {
      return {
        functionKind: 'share.menu',
        intent: 'open_share_options',
        executionClass: 'read-menu-probe',
        mutationRisk: 'none',
      };
    }
    if (has('searchbox', 'searchfiltersadvancedsearch') || role === 'search' || role === 'combobox' || role === 'input' || labelKind === 'search') {
      return {
        functionKind: 'search.input-or-filter',
        intent: 'refine_search_results',
        executionClass: 'read-search-probe',
        mutationRisk: 'none',
      };
    }
    if (role === 'tab' || has('tab') || /\/(?:with_replies|media|highlights|following|followers|search)(?:[/?]|$)/u.test(routeTemplate)) {
      return {
        functionKind: 'navigation.tab',
        intent: 'switch_read_surface',
        executionClass: 'read-tab-probe',
        mutationRisk: 'none',
      };
    }
    if (has('pilllabel')) {
      return {
        functionKind: 'navigation.tab',
        intent: 'switch_read_surface',
        executionClass: 'read-tab-probe',
        mutationRisk: 'none',
      };
    }
    if (has('menu', 'overflow', 'caret', 'useractions')) {
      return {
        functionKind: 'menu.open',
        intent: 'inspect_available_options',
        executionClass: 'read-menu-probe',
        mutationRisk: 'none',
      };
    }
    if (has('video', 'player', 'scrollsnap', 'photo', 'media')) {
      return {
        functionKind: 'media.viewer-control',
        intent: 'inspect_media_viewer',
        executionClass: 'read-media-probe',
        mutationRisk: 'none',
      };
    }
    const currentRouteTemplate = routeTemplateFromHref(window.location.href);
    if (
      currentRouteTemplate?.startsWith('/settings')
      && role === 'button'
      && !testId
      && !labelKind
      && !routeTemplate
      && !ancestorTestId
      && !descendantTestId
      && !descendantLabelKind
      && !iconSignature
    ) {
      return {
        functionKind: 'account.settings',
        intent: 'inspect_account_settings',
        executionClass: 'side-effect-risk-blocked',
        mutationRisk: 'account-write-risk',
      };
    }
    if (routeTemplate) {
      return {
        functionKind: 'navigation.link',
        intent: 'navigate_read_surface',
        executionClass: 'read-navigation-probe',
        mutationRisk: 'none',
      };
    }
    if (has('usercell', 'useravatar-container-:account')) {
      return {
        functionKind: 'navigation.profile',
        intent: 'inspect_profile_surface',
        executionClass: 'read-navigation-probe',
        mutationRisk: 'none',
      };
    }
    if (['button', 'link', 'menuitem'].includes(role)) {
      return {
        functionKind: 'interactive.unclassified-control',
        intent: 'inspect_unclassified_interactive_control',
        executionClass: 'unknown-risk-blocked',
        mutationRisk: 'unknown-interaction-risk',
      };
    }
    return {
      functionKind: 'surface.display-node',
      intent: 'observe_surface_structure',
      executionClass: 'observed-only',
      mutationRisk: 'none',
    };
  };
  const summarizeEntries = (entries, keyFn, mapper, limit = 40) => {
    const counts = new Map();
    const samples = new Map();
    for (const entry of entries) {
      const key = keyFn(entry);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!samples.has(key)) {
        samples.set(key, mapper(entry));
      }
    }
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, limit)
      .map(([key, count]) => ({
        ...samples.get(key),
        count,
      }));
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
  const isDecorativeMedia = (entry = /** @type {any} */ ({})) => {
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

  const currentProfileLink = noContent
    ? null
    : all(config.accountSelectors.currentProfileLink)
      .map((node) => node.getAttribute('href') || node.href || '')
      .map(pathnameHandle)
      .find(Boolean) || null;
  const displayName = noContent ? null : oneText([config.accountSelectors.displayName]);
  const bio = noContent ? null : oneText([config.accountSelectors.bio]);
  const statLinks = noContent ? [] : all(config.accountSelectors.statLinks).map((node) => ({
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

  const pageMedia = noContent ? [] : [...mediaFrom(document), ...mediaFromPerformance()]
    .filter((entry) => !isDecorativeMedia(entry));
  const bodyText = normalize(document.body?.innerText || '').slice(0, 12_000);
  const normalizedPath = String(window.location?.pathname ?? '').toLowerCase();
  const visibilitySignals = /** @type {any[]} */ ([]);
  const riskSignals = /** @type {any[]} */ ([]);
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
  if (riskSignals.includes('challenge')) {
    const hasChallengeUi = Boolean(document.querySelector(
      'iframe[src*="captcha"], input[name="challenge_response"], [data-testid*="verification"]',
    ));
    const hasChallengeText = /captcha|verification required|verify (?:it'?s you|your account|your identity)|unusual activity|suspicious activity/iu.test(bodyText)
      || normalizedPath.includes('/challenge');
    if (!hasChallengeUi && !hasChallengeText) {
      riskSignals.splice(riskSignals.indexOf('challenge'), 1);
    }
  }
  if (/rate limit|too many requests|try again later|temporarily restricted|temporarily unavailable|稍后再试|请求过多/iu.test(bodyText)) {
    riskSignals.push('rate-limited');
  }
  if (/something went wrong|try reloading|出错了|請嘗試重新載入|请尝试重新加载|重试/iu.test(bodyText)) {
    riskSignals.push('timeline-load-error');
  }

  const shouldDeferDateFiltering = (
    config.siteKey === 'instagram'
    && request.action === 'profile-content'
    && (request.date || request.fromDate || request.toDate)
  ) || (
    config.siteKey === 'x'
    && request.action === 'followed-posts-by-date'
    && (request.date || request.fromDate || request.toDate)
  );

  let rawItems = noContent ? [] : all(config.contentSelectors.item)
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
    !noContent
    && rawItems.length === 0
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
  const relationAccounts = noContent ? [] : all(relationSelector)
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
  const linkEntries = all('a[href]')
    .map((node) => {
      const href = node.getAttribute('href') || node.href || '';
      const routeTemplate = routeTemplateFromHref(href);
      if (!routeTemplate) {
        return null;
      }
      const label = normalize(node.getAttribute('aria-label') || node.textContent || '');
      const kind = classifyLink(href, label);
      return {
        routeTemplate,
        kind,
      };
    })
    .filter(Boolean);
  const controlEntries = all('button, [role="button"], [role="tab"], [role="menuitem"], input, textarea, select, form, [data-testid]')
    .map((node) => {
      const tag = String(node.tagName || '').toLowerCase();
      const role = normalize(node.getAttribute('role') || tag || 'control').toLowerCase();
      const testId = safeToken(node.getAttribute('data-testid') || '');
      const labelKind = controlLabelKind(controlLabelText(node));
      const closestTestIdNode = node.closest?.('[data-testid]');
      const ancestorTestId = closestTestIdNode && closestTestIdNode !== node
        ? safeToken(closestTestIdNode.getAttribute('data-testid') || '')
        : null;
      const descendantTestId = safeToken(node.querySelector?.('[data-testid]')?.getAttribute('data-testid') || '');
      const descendantLabelKind = controlLabelKind(descendantLabelText(node));
      const href = node.getAttribute('href') || '';
      const routeTemplate = href ? routeTemplateFromHref(href) : null;
      const controlKey = testId || labelKind || role;
      if (!controlKey && !routeTemplate) {
        return null;
      }
      const entry = {
        role,
        testId: testId || null,
        labelKind,
        ancestorTestId,
        descendantTestId,
        descendantLabelKind,
        routeTemplate,
        disabled: node.matches?.(':disabled') || node.getAttribute('aria-disabled') === 'true',
        iconSignature: controlIconSignature(node),
      };
      return {
        ...entry,
        node,
        anonymousSignature: null,
        ...classifyControlFunction(entry),
      };
    })
    .filter(Boolean);
  const iconClassifications = new Map();
  for (const entry of controlEntries) {
    if (!entry.iconSignature || entry.functionKind === 'interactive.unclassified-control') continue;
    if (entry.mutationRisk !== 'none' && !['mutation-blocked', 'auth-blocked', 'side-effect-risk-blocked'].includes(entry.executionClass)) continue;
    if (!iconClassifications.has(entry.iconSignature)) {
      iconClassifications.set(entry.iconSignature, {
        functionKind: entry.functionKind,
        intent: entry.intent,
        executionClass: entry.executionClass,
        mutationRisk: entry.mutationRisk,
      });
    }
  }
  for (const entry of controlEntries) {
    if (entry.functionKind !== 'interactive.unclassified-control' || !entry.iconSignature) continue;
    const matched = iconClassifications.get(entry.iconSignature);
    if (!matched) continue;
    Object.assign(entry, matched);
  }
  const currentRouteTemplate = routeTemplateFromHref(window.location.href);
  for (const entry of controlEntries) {
    if (entry.functionKind === 'interactive.unclassified-control') {
      const closestLink = entry.node.closest?.('a[href]');
      const closestLinkHref = closestLink?.getAttribute?.('href') || closestLink?.href || '';
      const closestLinkRouteTemplate = closestLinkHref ? routeTemplateFromHref(closestLinkHref) : null;
      const closestLinkLabel = closestLink
        ? normalize(closestLink.getAttribute?.('aria-label') || closestLink.textContent || '')
        : '';
      entry.anonymousSignature = {
        ...anonymousControlSignature(entry.node),
        closestLinkRouteTemplate,
        closestLinkKind: closestLinkRouteTemplate ? classifyLink(closestLinkHref, closestLinkLabel) : null,
      };
      const sig = entry.anonymousSignature;
      if (
        currentRouteTemplate === '/i/jf/stories/home'
        && entry.role === 'button'
        && entry.ancestorTestId === 'primarycolumn'
        && sig?.closestRole === 'main'
        && sig?.inDialog !== true
        && sig?.inForm !== true
      ) {
        Object.assign(entry, {
          functionKind: 'content.news-story-card',
          intent: 'inspect_news_story_card',
          executionClass: 'read-navigation-probe',
          mutationRisk: 'none',
        });
        entry.anonymousSignature = null;
      }
    } else {
      entry.anonymousSignature = null;
    }
    delete entry.node;
  }
  const forms = all('form')
    .map((node) => ({
      role: normalize(node.getAttribute('role') || 'form').toLowerCase(),
      inputCount: all('input, textarea, select', node).length,
      buttonCount: all('button, [role="button"]', node).length,
      actionRouteTemplate: routeTemplateFromHref(node.getAttribute('action') || window.location.href),
    }));
  const surfaceInventory = {
    urlRouteTemplate: currentRouteTemplate,
    linkCount: linkEntries.length,
    controlCount: controlEntries.length,
    formCount: forms.length,
    linkRoutes: summarizeEntries(
      linkEntries,
      (entry) => `${entry.kind}:${entry.routeTemplate}`,
      (entry) => ({
        kind: entry.kind,
        routeTemplate: entry.routeTemplate,
      }),
    ),
    controls: summarizeEntries(
      controlEntries,
      (entry) => `${entry.role}:${entry.testId || entry.labelKind || entry.routeTemplate || entry.iconSignature || 'anonymous'}`,
      (entry) => ({
        role: entry.role,
        testId: entry.testId,
        labelKind: entry.labelKind,
        ancestorTestId: entry.ancestorTestId,
        descendantTestId: entry.descendantTestId,
        descendantLabelKind: entry.descendantLabelKind,
        iconSignature: entry.iconSignature,
        routeTemplate: entry.routeTemplate,
        functionKind: entry.functionKind,
        intent: entry.intent,
        executionClass: entry.executionClass,
        mutationRisk: entry.mutationRisk,
      }),
    ),
    controlFunctions: summarizeEntries(
      controlEntries,
      (entry) => `${entry.executionClass}:${entry.functionKind}:${entry.intent}:${entry.mutationRisk}`,
      (entry) => ({
        functionKind: entry.functionKind,
        intent: entry.intent,
        executionClass: entry.executionClass,
        mutationRisk: entry.mutationRisk,
      }),
    ),
    anonymousControls: summarizeEntries(
      controlEntries.filter((entry) => entry.functionKind === 'interactive.unclassified-control'),
      (entry) => {
        const sig = entry.anonymousSignature || {};
        return [
          sig.role,
          sig.type,
          sig.disabled ? 'disabled' : 'enabled',
          sig.closestRole,
          sig.inArticle ? 'article' : 'no-article',
          sig.inDialog ? 'dialog' : 'no-dialog',
          sig.inForm ? 'form' : 'no-form',
          sig.closestLinkKind,
          sig.closestLinkRouteTemplate,
          `svg:${sig.svgCount ?? 0}`,
          `img:${sig.imageCount ?? 0}`,
          `children:${sig.childElementCount ?? 0}`,
        ].join(':');
      },
      (entry) => entry.anonymousSignature || {},
      20,
    ),
    forms,
  };

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
    surfaceInventory,
    visibilitySignals: [...new Set(visibilitySignals)],
    riskSignals: [...new Set(riskSignals)],
  };
}
function pageProbeReadOnlyControls(config, request = /** @type {any} */ ({})) {
  const normalize = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
  const normalizeKey = (value) => normalize(value).toLowerCase().replace(/[^a-z0-9:_/-]+/giu, '-').replace(/^-|-$/gu, '').slice(0, 80);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  const cssString = (value) => {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(String(value ?? ''));
    }
    return String(value ?? '').replace(/["\\]/gu, '\\$&');
  };
  const all = (selector, root = document) => {
    try {
      return [...root.querySelectorAll(selector)];
    } catch {
      return [];
    }
  };
  const safeToken = (value) => {
    let token = normalizeKey(value).replace(/\d{4,}/gu, ':id');
    for (const dynamicValue of [request.account]) {
      const dynamicToken = normalizeKey(dynamicValue);
      if (dynamicToken) {
        token = token
          .split(/([:_/-]+)/u)
          .map((part) => (part === dynamicToken ? ':account' : part))
          .join('');
      }
    }
    if (/^useravatar-container-[a-z0-9_:-]+$/u.test(token)) {
      token = 'useravatar-container-:account';
    }
    if (!token || /(?:auth|bearer|cookie|ct0|password|secret|session|token)/iu.test(token)) {
      return null;
    }
    return token;
  };
  const hostAllowed = (url) => {
    try {
      const parsed = new URL(url, window.location.origin);
      return parsed.hostname === window.location.hostname || parsed.hostname.endsWith(`.${window.location.hostname}`);
    } catch {
      return false;
    }
  };
  const isBlockedNoContentRoute = (routeTemplate) => {
    if (request.noContent !== true || !request.noContentRouteTemplate || !routeTemplate) {
      return false;
    }
    const root = String(request.noContentRouteTemplate).replace(/\/+$/u, '');
    const route = String(routeTemplate).replace(/\/+$/u, '');
    return route !== root && route.startsWith(`${root}/`);
  };
  const routeTemplateFromHref = (href) => {
    try {
      const parsed = new URL(href, window.location.origin);
      if (!hostAllowed(parsed.href)) {
        return null;
      }
      const safeRouteSegments = new Set([
        ...config.reservedSegments,
        'about',
        'about_your_account',
        'account',
        'accessibility_display_and_languages',
        'additional_resources',
        'ads_preferences',
        'accessibility',
        'affiliates',
        'analytics',
        'articles',
        'audience_and_tagging',
        'autoplay',
        'bookmarks',
        'chat',
        'communities',
        'content_you_see',
        'connect_people',
        'creators',
        'data_sharing_with_business_partners',
        'data_usage',
        'direct_messages',
        'discoverability_and_contacts',
        'display',
        'email_notifications',
        'filters',
        'for-you',
        'followers',
        'followers_you_follow',
        'following',
        'groups',
        'grok_settings',
        'grok',
        'header_photo',
        'help',
        'how-twitter-ads-work.html',
        'jf',
        'keyboard_shortcuts',
        'likes',
        'lists',
        'location',
        'location_information',
        'media',
        'members',
        'mentions',
        'mute_and_block',
        'off_twitter_activity',
        'photo',
        'post',
        'premium_sign_up',
        'preferences',
        'privacy_and_safety',
        'push_notifications',
        'quotes',
        'retweets',
        'security',
        'spaces',
        'status',
        'studio',
        'stories',
        'tabs',
        'verified',
        'troubleshooting',
        'verified_followers',
        'with_replies',
        'your_tweets',
        'your_twitter_data',
      ]);
      const parts = parsed.pathname.split('/').filter(Boolean);
      const isSafeStructureRouteSegment = (part, index) => {
        const lower = String(part ?? '').toLowerCase();
        if (index === 0 || !/^[a-z][a-z0-9_]{1,63}$/u.test(lower)) return false;
        if (/(?:auth|bearer|cookie|ct0|password|secret|session|token)/iu.test(lower)) return false;
        const root = String(parts[0] ?? '').toLowerCase();
        return root === 'settings' || root === 'notifications';
      };
      const templated = parts.map((part, index) => {
        const lower = part.toLowerCase();
        if (/^\d+$/u.test(part)) return ':id';
        if (index === 0 && !config.reservedSegments.includes(lower)) return ':account';
        if (safeRouteSegments.has(lower) || isSafeStructureRouteSegment(part, index)) return lower;
        return ':segment';
      });
      const path = `/${templated.join('/')}`.replace(/\/$/u, '') || '/';
      if (parsed.pathname === '/search') {
        const q = parsed.searchParams.has('q') ? 'q=:query' : '';
        const src = parsed.searchParams.has('src') ? 'src=:src' : '';
        const f = parsed.searchParams.has('f') ? 'f=:filter' : '';
        const search = [q, src, f].filter(Boolean).join('&');
        return search ? `${path}?${search}` : path;
      }
      return path;
    } catch {
      return null;
    }
  };
  const controlLabelKind = (value) => {
    const text = normalize(value).toLowerCase();
    if (!text) return null;
    /** @type {Array<[string, RegExp]>} */
    const matches = [
      ['search', /\bsearch\b|\u641c\u7d22/u],
      ['post', /\b(?:post|tweet|compose)\b/u],
      ['reply', /\breply\b/u],
      ['repost', /\b(?:repost|retweet)\b/u],
      ['like', /\blike\b/u],
      ['bookmark', /\bbookmark\b/u],
      ['share', /\bshare\b/u],
      ['follow', /\bfollow\b/u],
      ['menu', /\b(?:more|menu)\b/u],
      ['close', /\bclose\b/u],
      ['back', /\bback\b/u],
      ['next', /\bnext\b/u],
      ['skip', /\bskip(?: to)?\b|\u8df3\u81f3/u],
      ['retry', /\b(?:retry|reload|try again)\b/u],
      ['login', /\b(?:log in|login|sign in)\b/u],
      ['notifications', /\bnotifications?\b/u],
      ['messages', /\bmessages?\b/u],
      ['profile', /\bprofile\b/u],
      ['translation', /\b(?:show original|translate|translation)\b|\u663e\u793a\u539f\u6587|\u7ffb\u8bd1/u],
    ];
    return matches.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
  };
  const descendantLabelText = (node) => normalize([...(node.querySelectorAll?.('[aria-label], [title], [alt], title') ?? [])]
    .map((child) => child.getAttribute?.('aria-label') || child.getAttribute?.('title') || child.getAttribute?.('alt') || child.textContent || '')
    .filter(Boolean)
    .join(' '));
  const controlLabelText = (node) => normalize([
    node.getAttribute('aria-label') || '',
    node.getAttribute('name') || '',
    node.getAttribute('placeholder') || '',
    node.getAttribute('title') || '',
    descendantLabelText(node),
    node.textContent || '',
  ].filter(Boolean).join(' '));
  const classifyControlFunction = (entry = /** @type {any} */ ({})) => {
    const role = String(entry.role ?? '').toLowerCase();
    const testId = String(entry.testId ?? '').toLowerCase();
    const labelKind = String(entry.labelKind ?? '').toLowerCase();
    const routeTemplate = String(entry.routeTemplate ?? '').toLowerCase();
    const ancestorTestId = String(entry.ancestorTestId ?? '').toLowerCase();
    const descendantTestId = String(entry.descendantTestId ?? '').toLowerCase();
    const descendantLabelKind = String(entry.descendantLabelKind ?? '').toLowerCase();
    const iconSignature = String(entry.iconSignature ?? '').toLowerCase();
    const key = `${role} ${testId} ${labelKind} ${routeTemplate} ${ancestorTestId} ${descendantTestId} ${descendantLabelKind} ${iconSignature}`;
    const has = (...tokens) => tokens.some((token) => key.includes(token));
    if (entry.disabled === true && ['button', 'link', 'menuitem'].includes(role)) return { functionKind: 'interactive.disabled-control', intent: 'observe_disabled_interactive_control', executionClass: 'observed-only', mutationRisk: 'none' };
    if (has('login', 'sign-in')) return { functionKind: 'auth.login', intent: 'authenticate_session', executionClass: 'auth-blocked', mutationRisk: 'account-auth' };
    if (has('follow', 'unfollow')) return { functionKind: 'relation.follow-toggle', intent: 'mutate_follow_state', executionClass: 'mutation-blocked', mutationRisk: 'relationship-write' };
    if (has('like')) return { functionKind: 'engagement.like-toggle', intent: 'mutate_like_state', executionClass: 'mutation-blocked', mutationRisk: 'engagement-write' };
    if (has('retweet', 'repost')) return { functionKind: 'engagement.repost-toggle', intent: 'mutate_repost_state', executionClass: 'mutation-blocked', mutationRisk: 'engagement-write' };
    if (has('reply')) return { functionKind: 'compose.reply', intent: 'create_reply', executionClass: 'mutation-blocked', mutationRisk: 'content-write' };
    if (has('bookmark')) return { functionKind: 'engagement.bookmark-toggle', intent: 'mutate_bookmark_state', executionClass: 'mutation-blocked', mutationRisk: 'engagement-write' };
    if (has('tweetbutton', 'newtweet', 'compose') || labelKind === 'post') return { functionKind: 'compose.post', intent: 'create_post', executionClass: 'mutation-blocked', mutationRisk: 'content-write' };
    if (has('contentdisclosurebutton')) return { functionKind: 'compose.content-disclosure', intent: 'configure_content_disclosure', executionClass: 'mutation-blocked', mutationRisk: 'content-write' };
    if (has('createpollbutton')) return { functionKind: 'compose.poll', intent: 'add_post_poll', executionClass: 'mutation-blocked', mutationRisk: 'content-write' };
    if (has('gifsearchbutton')) return { functionKind: 'compose.gif', intent: 'add_post_gif', executionClass: 'mutation-blocked', mutationRisk: 'content-write' };
    if (has('geobutton')) return { functionKind: 'compose.location', intent: 'add_post_location', executionClass: 'mutation-blocked', mutationRisk: 'content-write' };
    if (has('grokimggen')) return { functionKind: 'compose.grok-image', intent: 'generate_post_image', executionClass: 'mutation-blocked', mutationRisk: 'content-write' };
    if (has('scheduleoption')) return { functionKind: 'compose.schedule', intent: 'schedule_post', executionClass: 'mutation-blocked', mutationRisk: 'content-write' };
    if (ancestorTestId === 'primarycolumn' && iconSignature === '0-0-24-24-1-296-mcszmllvlcllllzm') return { functionKind: 'compose.reply-permissions', intent: 'configure_reply_permissions', executionClass: 'mutation-blocked', mutationRisk: 'content-write' };
    if (ancestorTestId === 'primarycolumn' && iconSignature === '0-0-24-24-1-999-mhlclclvlclclhlc') return { functionKind: 'content.translation-info', intent: 'inspect_translation_info', executionClass: 'read-menu-probe', mutationRisk: 'none' };
    if (labelKind === 'translation') return { functionKind: 'content.translation-toggle', intent: 'toggle_content_translation', executionClass: 'read-navigation-probe', mutationRisk: 'none' };
    if (ancestorTestId === 'tweet' && iconSignature === '0-0-24-24-1-199-mllvhvllzmlchcvh') return { functionKind: 'share.menu', intent: 'open_share_options', executionClass: 'read-menu-probe', mutationRisk: 'none' };
    if (ancestorTestId === 'primarycolumn' && iconSignature === '0-0-24-24-1-253-mvhvhvhvhvhvhzmh') return { functionKind: 'account.notifications-toggle', intent: 'mutate_account_notification_state', executionClass: 'mutation-blocked', mutationRisk: 'notification-write' };
    if (has('tweet-text-show-more-link', 'show-more')) return { functionKind: 'content.expand', intent: 'expand_content_text', executionClass: 'read-navigation-probe', mutationRisk: 'none' };
    if (has('app-bar-back') || labelKind === 'back') return { functionKind: 'navigation.back', intent: 'navigate_read_surface', executionClass: 'read-navigation-probe', mutationRisk: 'none' };
    if (has('app-bar-close') || labelKind === 'close') return { functionKind: 'navigation.close', intent: 'close_current_panel', executionClass: 'read-navigation-probe', mutationRisk: 'none' };
    if (labelKind === 'skip') return { functionKind: 'navigation.skip', intent: 'skip_to_content', executionClass: 'read-navigation-probe', mutationRisk: 'none' };
    if (has('chat-drawer', 'grokdrawer', 'accountswitcher')) return { functionKind: 'menu.open', intent: 'inspect_available_options', executionClass: 'read-menu-probe', mutationRisk: 'none' };
    if (has('share')) return { functionKind: 'share.menu', intent: 'open_share_options', executionClass: 'read-menu-probe', mutationRisk: 'none' };
    if (has('searchbox', 'searchfiltersadvancedsearch') || role === 'search' || role === 'combobox' || role === 'input' || labelKind === 'search') return { functionKind: 'search.input-or-filter', intent: 'refine_search_results', executionClass: 'read-search-probe', mutationRisk: 'none' };
    if (role === 'tab' || has('tab') || /\/(?:with_replies|media|highlights|following|followers|search)(?:[/?]|$)/u.test(routeTemplate)) return { functionKind: 'navigation.tab', intent: 'switch_read_surface', executionClass: 'read-tab-probe', mutationRisk: 'none' };
    if (has('pilllabel')) return { functionKind: 'navigation.tab', intent: 'switch_read_surface', executionClass: 'read-tab-probe', mutationRisk: 'none' };
    if (has('menu', 'overflow', 'caret', 'useractions')) return { functionKind: 'menu.open', intent: 'inspect_available_options', executionClass: 'read-menu-probe', mutationRisk: 'none' };
    if (has('video', 'player', 'scrollsnap', 'photo', 'media')) return { functionKind: 'media.viewer-control', intent: 'inspect_media_viewer', executionClass: 'read-media-probe', mutationRisk: 'none' };
    const currentRouteTemplate = routeTemplateFromHref(window.location.href);
    if (
      currentRouteTemplate?.startsWith('/settings')
      && role === 'button'
      && !testId
      && !labelKind
      && !routeTemplate
      && !ancestorTestId
      && !descendantTestId
      && !descendantLabelKind
      && !iconSignature
    ) return { functionKind: 'account.settings', intent: 'inspect_account_settings', executionClass: 'side-effect-risk-blocked', mutationRisk: 'account-write-risk' };
    if (routeTemplate) return { functionKind: 'navigation.link', intent: 'navigate_read_surface', executionClass: 'read-navigation-probe', mutationRisk: 'none' };
    if (has('usercell', 'useravatar-container-:account')) return { functionKind: 'navigation.profile', intent: 'inspect_profile_surface', executionClass: 'read-navigation-probe', mutationRisk: 'none' };
    if (['button', 'link', 'menuitem'].includes(role)) return { functionKind: 'interactive.unclassified-control', intent: 'inspect_unclassified_interactive_control', executionClass: 'unknown-risk-blocked', mutationRisk: 'unknown-interaction-risk' };
    return { functionKind: 'surface.display-node', intent: 'observe_surface_structure', executionClass: 'observed-only', mutationRisk: 'none' };
  };
  const summarizeEntries = (entries, keyFn, mapper, limit = 80) => {
    const counts = new Map();
    const samples = new Map();
    for (const entry of entries) {
      const key = keyFn(entry);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!samples.has(key)) {
        samples.set(key, mapper(entry));
      }
    }
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, limit)
      .map(([key, count]) => ({
        ...samples.get(key),
        count,
      }));
  };
  const snapshot = () => ({
    routeTemplate: routeTemplateFromHref(window.location.href),
    title: document.title || '',
    dialogCount: all('[role="dialog"], [aria-modal="true"]').length,
    menuItemCount: all('[role="menuitem"], [role="menu"] [role], [data-testid*="Dropdown"], [data-testid*="dropdown"]').length,
    focusedRole: normalize(document.activeElement?.getAttribute?.('role') || document.activeElement?.tagName || '').toLowerCase() || null,
  });
  const candidateNodes = all('a[href], button, [role="button"], [role="tab"], [role="menuitem"], input, textarea, select, form, [data-testid]');
  const entries = candidateNodes.map((node, index) => {
    const tag = String(node.tagName || '').toLowerCase();
    const role = normalize(node.getAttribute('role') || tag || 'control').toLowerCase();
    const rawTestId = node.getAttribute('data-testid') || '';
    const testId = safeToken(rawTestId);
    const labelKind = controlLabelKind(controlLabelText(node));
    const closestTestIdNode = node.closest?.('[data-testid]');
    const ancestorTestId = closestTestIdNode && closestTestIdNode !== node
      ? safeToken(closestTestIdNode.getAttribute('data-testid') || '')
      : null;
    const descendantTestId = safeToken(node.querySelector?.('[data-testid]')?.getAttribute('data-testid') || '');
    const descendantLabelKind = controlLabelKind(descendantLabelText(node));
    const href = node.getAttribute('href') || '';
    const routeTemplate = href ? routeTemplateFromHref(href) : null;
    const entry = {
      index,
      tag,
      role,
      rawTestId,
      testId,
      labelKind,
      ancestorTestId,
      descendantTestId,
      descendantLabelKind,
      href,
      routeTemplate,
      disabled: node.matches?.(':disabled') || node.getAttribute('aria-disabled') === 'true',
    };
    return {
      ...entry,
      ...classifyControlFunction(entry),
    };
  });
  const priority = {
    'read-tab-probe': 10,
    'read-menu-probe': 20,
    'read-search-probe': 30,
    'read-media-probe': 40,
    'read-navigation-probe': 50,
  };
  const readCandidates = entries
    .filter((entry) => Object.prototype.hasOwnProperty.call(priority, entry.executionClass))
    .filter((entry) => entry.functionKind !== 'surface.display-node')
    .filter((entry) => entry.mutationRisk === 'none')
    .filter((entry) => !isBlockedNoContentRoute(entry.routeTemplate))
    .sort((left, right) => priority[left.executionClass] - priority[right.executionClass]);
  const selected = [];
  const seen = new Set();
  for (const entry of readCandidates) {
    const key = `${entry.executionClass}:${entry.functionKind}:${entry.testId || entry.labelKind || entry.routeTemplate || entry.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(entry);
    if (selected.length >= Math.max(0, Number(request.maxProbes ?? 8))) {
      break;
    }
  }
  const findNode = (entry) => {
    if (entry.rawTestId) {
      const testIdMatch = document.querySelector(`[data-testid="${cssString(entry.rawTestId)}"]`);
      if (testIdMatch) return testIdMatch;
    }
    if (entry.href) {
      const hrefMatch = document.querySelector(`a[href="${cssString(entry.href)}"]`);
      if (hrefMatch) return hrefMatch;
    }
    return candidateNodes[entry.index] || null;
  };
  const closeTransientUi = () => {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
    } catch {
      // Best-effort close; route restoration below is the stronger guard.
    }
  };
  const probeOne = async (entry) => {
    const before = snapshot();
    const node = findNode(entry);
    if (!node) {
      return {
        status: 'skipped',
        reason: 'control-not-found',
        functionKind: entry.functionKind,
        intent: entry.intent,
        executionClass: entry.executionClass,
        mutationRisk: entry.mutationRisk,
        routeTemplate: entry.routeTemplate,
        controlKey: entry.testId || entry.labelKind || entry.role,
        before,
        after: before,
      };
    }
    const action = ['input', 'textarea', 'select', 'combobox', 'search'].includes(entry.role) || ['input', 'textarea', 'select'].includes(entry.tag)
      ? 'focus'
      : 'click';
    try {
      node.scrollIntoView?.({ block: 'center', inline: 'center' });
      if (action === 'focus') {
        node.focus?.();
      } else {
        node.click?.();
      }
      await wait(Math.max(100, Number(request.settleMs ?? 500)));
      const after = snapshot();
      const changedRoute = before.routeTemplate !== after.routeTemplate;
      if (changedRoute && window.history.length > 1) {
        window.history.back();
        await wait(Math.max(100, Number(request.settleMs ?? 500)));
      }
      closeTransientUi();
      return {
        status: 'passed',
        action,
        functionKind: entry.functionKind,
        intent: entry.intent,
        executionClass: entry.executionClass,
        mutationRisk: entry.mutationRisk,
        routeTemplate: entry.routeTemplate,
        controlKey: entry.testId || entry.labelKind || entry.role,
        before,
        after,
        changedRoute,
        openedDialog: after.dialogCount > before.dialogCount,
        openedMenu: after.menuItemCount > before.menuItemCount,
      };
    } catch (error) {
      return {
        status: 'failed',
        reason: 'probe-execution-failed',
        error: normalize(error?.message || String(error)).slice(0, 120),
        functionKind: entry.functionKind,
        intent: entry.intent,
        executionClass: entry.executionClass,
        mutationRisk: entry.mutationRisk,
        routeTemplate: entry.routeTemplate,
        controlKey: entry.testId || entry.labelKind || entry.role,
        before,
        after: snapshot(),
      };
    }
  };
  return (async () => {
    const probes = [];
    for (const entry of selected) {
      probes.push(await probeOne(entry));
    }
    const mutationBlocked = entries.filter((entry) => entry.executionClass === 'mutation-blocked');
    return {
      schemaVersion: 1,
      requested: true,
      maxProbes: Math.max(0, Number(request.maxProbes ?? 8)),
      candidateCount: readCandidates.length,
      selectedCount: selected.length,
      executedCount: probes.filter((entry) => entry.status === 'passed').length,
      skippedCount: probes.filter((entry) => entry.status === 'skipped').length,
      failedCount: probes.filter((entry) => entry.status === 'failed').length,
      mutationBlockedCount: mutationBlocked.length,
      mutationBlockedFunctions: summarizeEntries(
        mutationBlocked,
        (entry) => `${entry.functionKind}:${entry.intent}:${entry.mutationRisk}`,
        (entry) => ({
          functionKind: entry.functionKind,
          intent: entry.intent,
          executionClass: entry.executionClass,
          mutationRisk: entry.mutationRisk,
        }),
      ),
      probes,
    };
  })();
}

function pageCollectReadOnlyRouteCandidates(config, request = /** @type {any} */ ({})) {
  const normalize = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
  const safeToken = (value) => normalize(value).toLowerCase().replace(/[^a-z0-9:_/-]+/giu, '-').replace(/^-|-$/gu, '').slice(0, 80) || null;
  const hostAllowed = (url) => {
    try {
      const parsed = new URL(url, window.location.origin);
      return parsed.hostname === window.location.hostname || parsed.hostname.endsWith(`.${window.location.hostname}`);
    } catch {
      return false;
    }
  };
  const routeTemplateFromHref = (href) => {
    try {
      const parsed = new URL(href, window.location.origin);
      if (!hostAllowed(parsed.href)) return null;
      const safeRouteSegments = new Set([
        ...config.reservedSegments,
        'account',
        'about_your_account',
        'accessibility_display_and_languages',
        'additional_resources',
        'ads_preferences',
        'articles',
        'audience_and_tagging',
        'autoplay',
        'bookmarks',
        'chat',
        'communities',
        'content_you_see',
        'connect_people',
        'creators',
        'data_sharing_with_business_partners',
        'data_usage',
        'direct_messages',
        'discoverability_and_contacts',
        'display',
        'email_notifications',
        'filters',
        'for-you',
        'followers',
        'followers_you_follow',
        'following',
        'groups',
        'grok_settings',
        'grok',
        'highlights',
        'jf',
        'keyboard_shortcuts',
        'likes',
        'lists',
        'location',
        'location_information',
        'media',
        'members',
        'mentions',
        'mute_and_block',
        'off_twitter_activity',
        'photo',
        'post',
        'preferences',
        'privacy_and_safety',
        'push_notifications',
        'quotes',
        'retweets',
        'security',
        'spaces',
        'status',
        'stories',
        'tabs',
        'verified',
        'verified_followers',
        'with_replies',
        'your_tweets',
        'your_twitter_data',
      ]);
      const parts = parsed.pathname.split('/').filter(Boolean);
      const isSafeStructureRouteSegment = (part, index) => {
        const lower = String(part ?? '').toLowerCase();
        if (index === 0 || !/^[a-z][a-z0-9_]{1,63}$/u.test(lower)) return false;
        if (/(?:auth|bearer|cookie|ct0|password|secret|session|token)/iu.test(lower)) return false;
        const root = String(parts[0] ?? '').toLowerCase();
        return root === 'settings' || root === 'notifications';
      };
      const templated = parts.map((part, index) => {
        const lower = part.toLowerCase();
        if (/^\d+$/u.test(part)) return ':id';
        if (index === 0 && !config.reservedSegments.includes(lower)) return ':account';
        if (safeRouteSegments.has(lower) || isSafeStructureRouteSegment(part, index)) return lower;
        return ':segment';
      });
      const path = `/${templated.join('/')}`.replace(/\/$/u, '') || '/';
      if (parsed.pathname === '/search') {
        const q = parsed.searchParams.has('q') ? 'q=:query' : '';
        const src = parsed.searchParams.has('src') ? 'src=:src' : '';
        const f = parsed.searchParams.has('f') ? 'f=:filter' : '';
        const search = [q, src, f].filter(Boolean).join('&');
        return search ? `${path}?${search}` : path;
      }
      return path;
    } catch {
      return null;
    }
  };
  const classifyRoute = (routeTemplate) => {
    const route = String(routeTemplate ?? '').toLowerCase();
    if (!route) {
      return { functionKind: 'navigation.unknown', intent: 'inspect_unknown_route', executionClass: 'observed-only', mutationRisk: 'none' };
    }
    const noContentRoot = String(request.noContentRouteTemplate ?? '').toLowerCase().replace(/\/+$/u, '');
    if (request.noContent === true && noContentRoot && route !== noContentRoot && route.startsWith(`${noContentRoot}/`)) {
      return { functionKind: 'navigation.link', intent: 'navigate_read_surface', executionClass: 'unknown-risk-blocked', mutationRisk: 'private-content-risk' };
    }
    if (/^\/(?:login|signup)(?:\/|$)/u.test(route)) {
      return { functionKind: 'auth.login', intent: 'authenticate_session', executionClass: 'auth-blocked', mutationRisk: 'account-auth' };
    }
    if (/^\/compose(?:\/|$)/u.test(route)) {
      return { functionKind: 'compose.post', intent: 'create_post', executionClass: 'mutation-blocked', mutationRisk: 'content-write' };
    }
    if (/^\/settings(?:\/|$)/u.test(route)) {
      return { functionKind: 'account.settings', intent: 'inspect_account_settings', executionClass: 'side-effect-risk-blocked', mutationRisk: 'account-write-risk' };
    }
    if (/premium_sign_up/u.test(route)) {
      return { functionKind: 'commerce.premium-signup', intent: 'inspect_premium_signup', executionClass: 'side-effect-risk-blocked', mutationRisk: 'purchase-risk' };
    }
    if (/^\/(?:home|explore|notifications|messages|i\/articles|i\/bookmarks|i\/communities|i\/connect_people|i\/chat|i\/grok|i\/keyboard_shortcuts|i\/lists)(?:\/|$)/u.test(route)) {
      return { functionKind: 'navigation.app-section', intent: 'navigate_read_surface', executionClass: 'read-navigation-probe', mutationRisk: 'none' };
    }
    if (/\/status\/:id/u.test(route)) {
      return { functionKind: 'navigation.content-detail', intent: 'inspect_content_detail', executionClass: 'read-navigation-probe', mutationRisk: 'none' };
    }
    if (/\/(?:articles|photo|with_replies|media|highlights|following|followers|followers_you_follow|verified_followers)(?:[/?]|$)/u.test(route)) {
      return { functionKind: 'navigation.profile-tab', intent: 'switch_read_surface', executionClass: 'read-tab-probe', mutationRisk: 'none' };
    }
    if (/^\/search(?:[/?]|$)/u.test(route)) {
      return { functionKind: 'search.results', intent: 'inspect_search_results', executionClass: 'read-search-probe', mutationRisk: 'none' };
    }
    if (route === '/:account' || route.startsWith('/:account/')) {
      return { functionKind: 'navigation.profile', intent: 'inspect_profile_surface', executionClass: 'read-navigation-probe', mutationRisk: 'none' };
    }
    return { functionKind: 'navigation.link', intent: 'navigate_read_surface', executionClass: 'read-navigation-probe', mutationRisk: 'none' };
  };
  const counts = new Map();
  const samples = new Map();
  const maxCandidates = Math.max(0, Number(request.maxCandidates ?? 80));
  for (const link of [...document.querySelectorAll('a[href]')]) {
    const href = link.getAttribute('href') || link.href || '';
    let url = null;
    try {
      url = new URL(href, window.location.origin).toString();
    } catch {
      url = null;
    }
    const routeTemplate = url ? routeTemplateFromHref(url) : null;
    if (!url || !routeTemplate) continue;
    const classified = classifyRoute(routeTemplate);
    const key = `${classified.executionClass}:${classified.functionKind}:${routeTemplate}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!samples.has(key)) {
      samples.set(key, {
        url,
        routeTemplate,
        controlKey: safeToken(link.getAttribute('data-testid') || link.getAttribute('role') || 'link'),
        ...classified,
      });
    }
  }
  const candidates = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, maxCandidates)
    .map(([key, count]) => ({
      ...samples.get(key),
      count,
    }));
  return {
    schemaVersion: 1,
    routeTemplate: routeTemplateFromHref(window.location.href),
    linkCount: document.querySelectorAll('a[href]').length,
    candidateCount: candidates.length,
    candidates,
  };
}

function canRiskReviewedReadNavigate(candidate = /** @type {any} */ ({}), settings = /** @type {any} */ ({})) {
  if (settings.riskReviewedReadSurfaces !== true || !candidate.url || !candidate.routeTemplate) {
    return false;
  }
  const executionClass = String(candidate.executionClass ?? '');
  const mutationRisk = String(candidate.mutationRisk ?? '');
  const routeTemplate = String(candidate.routeTemplate ?? '');
  if (!['mutation-blocked', 'side-effect-risk-blocked'].includes(executionClass)) {
    return false;
  }
  if (!['account-write-risk', 'content-write', 'purchase-risk'].includes(mutationRisk)) {
    return false;
  }
  return /^\/(?:compose|settings|i\/premium_sign_up)(?:\/|$)/u.test(routeTemplate);
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

async function runReadOnlyControlProbes(session, config, plan, settings, apiCapture = null) {
  if (!settings.probeReadControls || settings.maxControlProbes <= 0) {
    return null;
  }
  const apiStartIndex = apiCapture?.mark?.() ?? 0;
  const startedAt = new Date().toISOString();
  const result = await session.callPageFunction(pageProbeReadOnlyControls, config, {
    account: plan.account,
    action: plan.action,
    contentType: plan.contentType,
    maxProbes: settings.maxControlProbes,
    settleMs: Math.min(Math.max(settings.scrollWaitMs, 300), 1_500),
    ...noContentRequestForPlan(plan),
  });
  const api = await summarizeControlProbeApiCapture(apiCapture, apiStartIndex, Math.min(settings.timeoutMs, 5_000));
  return {
    ...(result || {}),
    startedAt,
    completedAt: new Date().toISOString(),
    api,
  };
}

async function readCrawlSocialState(session, config, plan, settings) {
  const deadline = Date.now() + Math.min(settings.timeoutMs ?? DEFAULT_TIMEOUT_MS, settings.probeReadControls ? 15_000 : 8_000);
  let state = null;
  while (Date.now() <= deadline) {
    state = await session.callPageFunction(pageExtractSocialState, config, {
      account: plan.account,
      action: plan.action,
      contentType: plan.contentType,
      date: plan.date,
      fromDate: plan.fromDate,
      toDate: plan.toDate,
      ...noContentRequestForPlan(plan),
    });
    const inventory = state?.surfaceInventory && typeof state.surfaceInventory === 'object'
      ? state.surfaceInventory
      : {};
    const hasUsableReadSurface = socialStateHasBoundarySignal(state)
      || socialStateHasExtractedContent(state)
      || socialStateHasProfileSurface(state)
      || (Number(inventory.linkCount) || 0) > 0
      || (Number(inventory.controlCount) || 0) > 6;
    if (hasUsableReadSurface || (config?.siteKey !== 'x' && !isLikelyXBlankShell(state))) {
      return state;
    }
    await sleep(Math.max(250, Math.min(settings.scrollWaitMs || DEFAULT_SCROLL_WAIT_MS, 1_000)));
  }
  return state ?? {};
}

async function runReadOnlySurfaceCrawl(session, config, plan, settings, apiCapture = null) {
  if (!settings.crawlReadSurfaces || settings.maxReadCrawlPages <= 0) {
    return null;
  }
  const apiStartIndex = apiCapture?.mark?.() ?? 0;
  const startedAt = new Date().toISOString();
  let enqueuedCount = 1;
  const queue = [{
    url: plan.url,
    routeTemplate: null,
    depth: 0,
    sourceRouteTemplate: null,
  }];
  const queuedRouteTemplates = new Set();
  const visitedRouteTemplates = new Set();
  const blocked = new Map();
  const pages = [];
  const readExecutionClasses = new Set([
    'read-navigation-probe',
    'read-search-probe',
    'read-tab-probe',
    'risk-reviewed-read-navigation',
  ]);
  while (queue.length && pages.length < settings.maxReadCrawlPages) {
    const current = queue.shift();
    if (!current?.url) continue;
    try {
      const currentPageUrl = await readSessionUrl(session);
      const canReuseCurrentPage = current.depth === 0
        && normalizeComparableUrl(currentPageUrl) === normalizeComparableUrl(current.url);
      if (!canReuseCurrentPage) {
        await session.navigateAndWait(current.url, createWaitPolicy(settings.timeoutMs));
      }
    } catch {
      pages.push({
        depth: current.depth,
        requestedRouteTemplate: current.routeTemplate,
        routeTemplate: current.routeTemplate,
        status: 'failed',
        reason: 'navigation-failed',
        sourceRouteTemplate: current.sourceRouteTemplate,
      });
      continue;
    }
    const state = await readCrawlSocialState(session, config, plan, settings);
    const candidatesResult = await session.callPageFunction(pageCollectReadOnlyRouteCandidates, config, {
      account: plan.account,
      maxCandidates: 100,
      ...noContentRequestForPlan(plan),
    });
    const routeTemplate = candidatesResult?.routeTemplate || state?.surfaceInventory?.urlRouteTemplate || current.routeTemplate || null;
    if (routeTemplate) {
      visitedRouteTemplates.add(routeTemplate);
    }
    const candidates = Array.isArray(candidatesResult?.candidates) ? candidatesResult.candidates : [];
    const readCandidates = [];
    for (const candidate of candidates) {
      const sanitized = {
        routeTemplate: candidate.routeTemplate ?? null,
        functionKind: candidate.functionKind ?? null,
        intent: candidate.intent ?? null,
        executionClass: candidate.executionClass ?? null,
        mutationRisk: candidate.mutationRisk ?? null,
        routeSample: safeRouteSampleFromUrl(candidate.url, candidate.routeTemplate, config),
        count: candidate.count ?? 1,
      };
      const isRead = readExecutionClasses.has(candidate.executionClass) && candidate.mutationRisk === 'none';
      const riskReviewedRead = canRiskReviewedReadNavigate(candidate, settings);
      if (!isRead && !riskReviewedRead) {
        const blockedKey = `${candidate.executionClass}:${candidate.functionKind}:${candidate.routeTemplate}`;
        if (!blocked.has(blockedKey)) {
          blocked.set(blockedKey, sanitized);
        }
        continue;
      }
      const readCandidate = riskReviewedRead
        ? {
          ...sanitized,
          executionClass: 'risk-reviewed-read-navigation',
          riskReviewed: true,
          originalExecutionClass: candidate.executionClass ?? null,
        }
        : sanitized;
      readCandidates.push(readCandidate);
      if (
        current.depth < settings.maxReadCrawlDepth
        && candidate.url
        && candidate.routeTemplate
        && !visitedRouteTemplates.has(candidate.routeTemplate)
        && !queuedRouteTemplates.has(candidate.routeTemplate)
      ) {
        queue.push({
          url: candidate.url,
          routeTemplate: candidate.routeTemplate,
          depth: current.depth + 1,
          sourceRouteTemplate: routeTemplate,
        });
        enqueuedCount += 1;
        queuedRouteTemplates.add(candidate.routeTemplate);
      }
    }
    pages.push({
      depth: current.depth,
      requestedRouteTemplate: current.routeTemplate ?? routeTemplate,
      routeTemplate,
      routeSample: safeRouteSampleFromUrl(current.url, routeTemplate, config),
      status: isLikelyXBlankShell(state) ? 'degraded' : 'passed',
      reason: isLikelyXBlankShell(state) ? 'x-blank-shell' : null,
      sourceRouteTemplate: current.sourceRouteTemplate,
      linkCount: state?.surfaceInventory?.linkCount ?? candidatesResult?.linkCount ?? 0,
      controlCount: state?.surfaceInventory?.controlCount ?? 0,
      candidateCount: candidates.length,
      readCandidateCount: readCandidates.length,
      blockedCandidateCount: candidates.length - readCandidates.length,
      riskReviewedCandidateCount: readCandidates.filter((candidate) => candidate.riskReviewed === true).length,
      readRouteTemplates: dedupeSortedStrings(readCandidates.map((candidate) => candidate.routeTemplate)).slice(0, 40),
      readRouteSamples: dedupeRouteSamples(readCandidates.map((candidate) => candidate.routeSample)).slice(0, 40),
      functionKinds: dedupeSortedStrings(readCandidates.map((candidate) => candidate.functionKind)).slice(0, 20),
      executionClasses: dedupeSortedStrings(readCandidates.map((candidate) => candidate.executionClass)).slice(0, 20),
    });
  }
  const api = await summarizeControlProbeApiCapture(apiCapture, apiStartIndex, Math.min(settings.timeoutMs, 5_000));
  const discoveredRouteTemplates = dedupeSortedStrings([
    ...pages.map((page) => page.routeTemplate),
    ...pages.flatMap((page) => page.readRouteTemplates ?? []),
  ]);
  return {
    schemaVersion: 1,
    requested: true,
    startedAt,
    completedAt: new Date().toISOString(),
    maxPages: settings.maxReadCrawlPages,
    maxDepth: settings.maxReadCrawlDepth,
    visitedCount: pages.length,
    queuedCount: enqueuedCount,
    pendingQueueCount: queue.length,
    exhausted: queue.length === 0,
    discoveredRouteTemplateCount: discoveredRouteTemplates.length,
    discoveredRouteTemplates,
    functionKinds: dedupeSortedStrings(pages.flatMap((page) => page.functionKinds ?? [])),
    executionClasses: dedupeSortedStrings(pages.flatMap((page) => page.executionClasses ?? [])),
    blockedRouteCount: blocked.size,
    blockedFunctions: [...blocked.values()].slice(0, 80),
    pages,
    api,
  };
}

function pageClickSocialRetry() {
  const normalize = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
  const candidates = [
    ...document.querySelectorAll('button, [role="button"], div[data-testid], span'),
  ];
  const target = candidates.find((node) => /^(?:retry|重试|重試)$/iu.test(normalize(node.textContent || node.getAttribute?.('aria-label') || '')))
    || candidates.find((node) => /retry|重试|重試/iu.test(normalize(node.textContent || node.getAttribute?.('aria-label') || '')));
  if (!target) {
    return { clicked: false, reason: 'retry-control-not-found' };
  }
  const clickable = typeof target.closest === 'function'
    ? target.closest('button, [role="button"]') || target
    : target;
  clickable.click();
  return {
    clicked: true,
    text: normalize(target.textContent || target.getAttribute?.('aria-label') || ''),
  };
}

function pageScrollToBottom(config = /** @type {any} */ ({}), request = /** @type {any} */ ({})) {
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
  const merged = /** @type {any[]} */ ([]);
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

function dedupeSortedStrings(values = /** @type {any[]} */ ([])) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function classifyRouteSampleValue(value) {
  const text = String(value ?? '');
  if (!text) return 'empty';
  if (/^\d+$/u.test(text)) return 'digits';
  if (/^[a-z0-9_]{1,30}$/iu.test(text)) return 'handle-like';
  if (/^[a-z0-9_-]+$/iu.test(text)) return 'slug';
  return 'mixed';
}

function safeRouteSampleFromUrl(url, routeTemplate, config) {
  const template = String(routeTemplate ?? '').trim();
  if (!url || !template) return null;
  try {
    const parsed = new URL(String(url), `${config.baseUrl}/`);
    if (parsed.hostname !== config.host && !parsed.hostname.endsWith(`.${config.host}`)) {
      return null;
    }
    const [pathTemplate] = template.split('?', 2);
    const templateSegments = pathTemplate.split('/').filter(Boolean);
    const valueSegments = parsed.pathname.split('/').filter(Boolean);
    const segmentShapes = templateSegments.map((segment, index) => {
      const value = valueSegments[index] ?? '';
      if (segment.startsWith(':')) {
        return {
          kind: segment.slice(1),
          valueLength: value.length,
          valueClass: classifyRouteSampleValue(value),
        };
      }
      return {
        kind: 'static',
        value: segment,
      };
    });
    const queryKeys = [...parsed.searchParams.keys()].sort((left, right) => left.localeCompare(right, 'en'));
    return {
      routeTemplate: template,
      pathDepth: templateSegments.length,
      dynamicSegmentCount: segmentShapes.filter((segment) => segment.kind !== 'static').length,
      segmentShapes,
      queryKeys,
      queryValueShapes: queryKeys.map((key) => {
        const value = parsed.searchParams.get(key) ?? '';
        return {
          key,
          valueLength: value.length,
          tokenCount: value.split(/\s+/u).filter(Boolean).length,
          valueClass: classifyRouteSampleValue(value),
        };
      }),
    };
  } catch {
    return null;
  }
}

function dedupeRouteSamples(samples = /** @type {any[]} */ ([])) {
  const seen = new Set();
  const result = [];
  for (const sample of samples) {
    if (!sample?.routeTemplate) continue;
    const key = JSON.stringify(sample);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(sample);
  }
  return result;
}

function isSocialRelationAction(action) {
  return ['profile-following', 'profile-followers', 'followed-users'].includes(String(action ?? ''));
}

function pickRuntimeRiskSignal(signals = /** @type {any[]} */ ([])) {
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
  if (normalized.has('timeline-load-error')) {
    return 'timeline-load-error';
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
  if (signal === 'timeline-load-error') {
    return 'timeline-load-error';
  }
  return null;
}

function isRetryableRuntimeRisk(signal) {
  return signal === 'rate-limited' || signal === 'timeline-load-error';
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

function hasItemAuthor(item = /** @type {any} */ ({})) {
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

function summarizeJsonShape(value, prefix = '$', paths = /** @type {any[]} */ ([]), depth = 0) {
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
  const output = /** @type {any} */ ({});
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

function apiOperationNameFromResponse(response = /** @type {any} */ ({})) {
  return response.request?.operationName
    ?? response.requestTemplate?.operationName
    ?? response.operationName
    ?? parseApiRequestDetails(response.url).operationName
    ?? null;
}

function summarizeParsedApiResponse(response, parsed, config, plan) {
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const users = Array.isArray(parsed?.users) ? parsed.users : [];
  const parsedEntries = parsedApiEntries(parsed);
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
    operationName: apiOperationNameFromResponse(response),
    itemCount: parsedEntries.length,
    userCount: users.length,
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
  const noContent = isNoContentReadRoutePlan(plan);
  const maxItems = settings.maxItems;
  const maxScrolls = noContent ? 0 : settings.maxScrolls;
  const collectedStates = /** @type {any[]} */ ([]);
  let stagnantRounds = 0;
  let previousItemCount = 0;
  let previousRelationCount = 0;
  let scrollSummary = /** @type {any[]} */ ([]);
  const visibilitySignals = /** @type {any[]} */ ([]);
  const riskSignals = /** @type {any[]} */ ([]);
  const riskEvents = /** @type {any[]} */ ([]);
  let riskRetryCount = 0;
  let stopReason = null;
  let relationExpectedCount = null;
  const initialRead = await readInitialSocialState(session, config, plan, settings);
  if (initialRead.surfaceWait?.ready === false && initialRead.surfaceWait.reason) {
    visibilitySignals.push(initialRead.surfaceWait.reason);
  }

  for (let round = 0; round <= maxScrolls; round += 1) {
    const state = round === 0 && initialRead.state
      ? initialRead.state
      : await session.callPageFunction(pageExtractSocialState, config, {
        account: plan.account,
        action: plan.action,
        contentType: plan.contentType,
        date: plan.date,
        fromDate: plan.fromDate,
        toDate: plan.toDate,
        ...noContentRequestForPlan(plan),
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
      const waitMs = retryable
        ? runtimeRiskSignal === 'timeline-load-error'
          ? Math.max(settings.scrollWaitMs, 1_500)
          : riskBackoffDelayMs(settings, riskRetryCount)
        : 0;
      const recoveryAction = retryable && runtimeRiskSignal === 'timeline-load-error'
        ? await session.callPageFunction(pageClickSocialRetry)
        : null;
      riskEvents.push({
        round,
        signal: runtimeRiskSignal,
        retryable,
        retry: retryable ? riskRetryCount + 1 : riskRetryCount,
        waitMs,
        finalUrl: state?.url ?? null,
        recoveryAction,
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
  const mergedMedia = mergeByKey(allMedia, (entry) => `${entry.type}:${entry.url}`, maxItems * 5);
  const mergedItems = mergeByKey(allItems, (entry) => entry.url || entry.text, maxItems);
  const upgradedItems = config.siteKey === 'x'
    ? upgradeXPosterMediaWithVideoResources(mergedItems, mergedMedia)
    : mergedItems;
  const mergedRelations = mergeByKey(allRelations, (entry) => entry.handle || entry.url, maxItems);
  const hasRelationExpectedCount = Number.isFinite(relationExpectedCount);
  const noContentArchive = noContent
    ? {
      strategy: 'no-content-structure-probe',
      complete: null,
      reason: 'content-redacted-for-sensitive-surface',
      pages: 0,
      domItemCount: 0,
      apiItemCount: 0,
      dedupedItemCount: 0,
      boundarySignals: [],
    }
    : null;
  const relationArchive = !noContent && isSocialRelationAction(plan.action)
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
    items: upgradedItems,
    relations: mergedRelations,
    media: mergedMedia,
    relationExpectedCount: Number.isFinite(relationExpectedCount) ? relationExpectedCount : null,
    archive: noContentArchive ?? relationArchive,
    scrollSummary,
    surfaceWait: initialRead.surfaceWait,
    surfaceInventory: latest.surfaceInventory ?? null,
    visibilitySignals: dedupeSortedStrings(visibilitySignals),
    riskSignals: dedupeSortedStrings(riskSignals),
    riskEvents,
    stopReason,
  };
}

function isSocialApiUrl(config, url) {
  const value = String(url ?? '');
  if (config.siteKey === 'x') {
    return /(?:\/i\/api\/(?:graphql|1\.1|2|fleets|badge_count|graphql\.json)(?:\/|[?#])|\/graphql\/|https:\/\/api\.x\.com\/1\.1\/)/iu.test(value);
  }
  if (config.siteKey === 'instagram') {
    return /(?:\/graphql\/query|\/api\/v1\/(?:feed|friendships|media|users|clips)|\/api\/graphql)/iu.test(value);
  }
  return false;
}

const SENSITIVE_API_HEADER_RE = /^(?:authorization|cookie|origin|referer|set-cookie|x-csrf-token|x-ig-www-claim|x-instagram-ajax)$/iu;
const FORBIDDEN_FETCH_HEADER_RE = /^(?:accept-encoding|connection|content-length|cookie|host|origin|referer|sec-|user-agent|priority)$/iu;
const REPLAY_FETCH_HEADER_RE = /^(?:accept|authorization|content-type|x-[a-z0-9-]+)$/iu;
const API_DEBUG_HEADER_RE = /^(?:retry-after|x-rate-limit-|x-app-limit|x-business-use-case-usage|x-ig-|x-fb-|x-twitter-|cf-|content-type|date)$/iu;

function normalizeHeaderEntries(headers = /** @type {any} */ ({})) {
  return Object.entries(headers || {})
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => [String(name).toLowerCase(), String(value)]);
}

function truncateHeaderValue(value) {
  const text = String(value ?? '');
  return text.length > 240 ? `${text.slice(0, 240)}...<truncated>` : text;
}

function sanitizeApiDebugHeaders(headers = /** @type {any} */ ({})) {
  const result = /** @type {any} */ ({});
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

export function sanitizeSocialApiRequestTemplate(request = /** @type {any} */ ({})) {
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

function buildBrowserReplayHeaders(request = /** @type {any} */ ({})) {
  const headers = /** @type {any} */ ({});
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

function buildSocialApiReplayRequest(request = /** @type {any} */ ({})) {
  return {
    url: request.url || null,
    method: request.method || 'GET',
    headers: buildBrowserReplayHeaders(request),
    body: request.postData || null,
  };
}

function shouldFallbackCaptureApiBody(candidate = /** @type {any} */ ({}), config = /** @type {any} */ ({}), plan = /** @type {any} */ ({})) {
  if (config.siteKey !== 'x') {
    return false;
  }
  if (isSocialRelationAction(plan.action)) {
    return isXRelationApiUrl(candidate.url, plan.action);
  }
  if (!requiresTargetTimelineApiSeed(config, plan)) {
    return false;
  }
  return isTargetTimelineApiSummary({
    operationName: apiOperationNameFromResponse(candidate),
    url: candidate.url,
  }, config, plan);
}

async function createSocialApiCapture(session, config, settings, plan = null) {
  if (typeof session?.send !== 'function' || !session?.client?.on) {
    return null;
  }
  const responses = /** @type {any[]} */ ([]);
  const candidates = new Map();
  const requests = new Map();
  const pendingBodies = new Set();
  const errors = /** @type {any[]} */ ([]);
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
        let recovered = false;
        if (shouldFallbackCaptureApiBody(candidate, config, plan || {})) {
          try {
            const result = normalizeApiFetchResult(await session.callPageFunction(pageFetchJson, candidate.replayRequest));
            if (result.ok && result.json) {
              responses.push({
                ...candidate,
                status: result.status ?? candidate.status,
                responseHeaders: sanitizeApiDebugHeaders(result.headers || {}),
                capturedAt: new Date().toISOString(),
                captureFallback: 'page-fetch-json',
                json: result.json,
              });
              stats.capturedBodies += 1;
              recovered = true;
            }
          } catch {
            recovered = false;
          }
        }
        if (!recovered) {
          stats.bodyErrors += 1;
          errors.push({
            url: candidate.url,
            status: candidate.status,
            mimeType: candidate.mimeType || null,
            responseHeaders: candidate.responseHeaders || {},
            operationName: apiOperationNameFromResponse(candidate),
            capturedAt: new Date().toISOString(),
            error: error?.message ?? String(error),
          });
        }
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

function decodeXNoteTweetStatusId(value) {
  const raw = String(value ?? '').trim();
  if (!raw || /^\d+$/u.test(raw)) {
    return raw || null;
  }
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    const match = decoded.match(/^NoteTweet:(\d+)$/u);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function normalizeXStatusId(value) {
  return decodeXNoteTweetStatusId(value) || String(value ?? '').trim() || null;
}

function xSnowflakeTimestamp(value) {
  const id = normalizeXStatusId(value);
  if (!id || !/^\d+$/u.test(id)) {
    return '';
  }
  try {
    const twitterEpochMs = 1_288_834_974_657n;
    const timestampMs = (BigInt(id) >> 22n) + twitterEpochMs;
    const parsed = new Date(Number(timestampMs));
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
  } catch {
    return '';
  }
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dimensionsScore(entry = /** @type {any} */ ({})) {
  return finiteNumber(entry.width) * finiteNumber(entry.height);
}

function selectBestImageCandidate(candidates = /** @type {any[]} */ ([])) {
  return (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate?.url)
    .sort((left, right) => dimensionsScore(right) - dimensionsScore(left))[0] ?? null;
}

function selectBestVideoCandidate(candidates = /** @type {any[]} */ ([])) {
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

function xVideoMediaKeyFromUrl(value) {
  const url = String(value ?? '');
  if (!url) {
    return null;
  }
  const match = url.match(/\/(?:ext_tw_video|amplify_video|tweet_video)(?:_thumb)?\/(\d+)/iu);
  return match?.[1] ?? null;
}

function isXVideoPosterMedia(entry = /** @type {any} */ ({})) {
  const value = String(entry.url ?? entry.posterUrl ?? '').toLowerCase();
  return /\/(?:ext_tw_video|amplify_video|tweet_video)_thumb\//u.test(value)
    || /[?&]format=(?:jpg|jpeg|png|webp)\b/u.test(value) && /(?:ext_tw_video|amplify_video|tweet_video)/u.test(value);
}

function isXDirectVideoMedia(entry = /** @type {any} */ ({})) {
  const value = String(entry.url ?? '').toLowerCase();
  return entry.type === 'video'
    && /^https?:\/\//iu.test(value)
    && (
      /(^|\.)video\.twimg\.com\//iu.test(value)
      || /(?:\.mp4|\.m3u8)(?:[?#]|$)/iu.test(value)
    );
}

function upgradeXPosterMediaWithVideoResources(items = /** @type {any[]} */ ([]), media = /** @type {any[]} */ ([])) {
  const videosByKey = new Map();
  for (const entry of Array.isArray(media) ? media : []) {
    if (!isXDirectVideoMedia(entry)) {
      continue;
    }
    const key = xVideoMediaKeyFromUrl(entry.url);
    if (!key) {
      continue;
    }
    const dimensions = parseDimensionsFromUrl(entry.url);
    const candidate = {
      ...entry,
      type: 'video',
      width: entry.width ?? dimensions.width,
      height: entry.height ?? dimensions.height,
      source: entry.source || 'performance-video-resource',
    };
    const existing = videosByKey.get(key);
    videosByKey.set(key, selectBestVideoCandidate([existing, candidate].filter(Boolean)));
  }
  if (!videosByKey.size) {
    return items;
  }
  return (Array.isArray(items) ? items : []).map((item) => {
    const itemMedia = Array.isArray(item?.media) ? item.media : [];
    if (!itemMedia.length) {
      return item;
    }
    let changed = false;
    const upgradedMedia = itemMedia.map((entry) => {
      if (!isXVideoPosterMedia(entry)) {
        return entry;
      }
      const key = xVideoMediaKeyFromUrl(entry.url || entry.posterUrl);
      const video = key ? videosByKey.get(key) : null;
      if (!video?.url) {
        return entry;
      }
      changed = true;
      const dimensions = parseDimensionsFromUrl(video.url);
      const { fallbackFrom, expectedType, ...rest } = entry;
      return {
        ...rest,
        type: 'video',
        url: video.url,
        posterUrl: entry.url || entry.posterUrl || video.posterUrl || null,
        width: video.width ?? dimensions.width ?? entry.width ?? null,
        height: video.height ?? dimensions.height ?? entry.height ?? null,
        bitrate: video.bitrate ?? entry.bitrate ?? null,
        durationMillis: video.durationMillis ?? entry.durationMillis ?? null,
        variants: Array.isArray(video.variants) ? video.variants : entry.variants,
        source: video.source || entry.source || 'performance-video-resource',
      };
    });
    return changed ? { ...item, media: upgradedMedia } : item;
  });
}

function dedupeMediaEntries(media = /** @type {any[]} */ ([])) {
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

function parseXMedia(legacy = /** @type {any} */ ({})) {
  const media = legacy.extended_entities?.media || legacy.entities?.media || [];
  return /** @type {any[]} */ (Array.isArray(media) ? media : []).flatMap((entry) => {
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
        bitrate: null,
        width: null,
        height: null,
        durationMillis: null,
        variants: [],
      }];
    }
    return [];
  });
}

function normalizeXTweetResult(result) {
  const tweet = result?.tweet || result;
  const legacy = tweet?.legacy || (tweet?.full_text || tweet?.text || tweet?.id_str ? tweet : null);
  const restId = normalizeXStatusId(tweet?.rest_id || legacy?.id_str || tweet?.id_str || tweet?.id);
  if (!legacy || !restId) {
    return null;
  }
  const screenName = tweet?.core?.user_results?.result?.legacy?.screen_name
    || tweet?.core?.user_results?.result?.core?.screen_name
    || tweet?.core?.user_results?.result?.screen_name
    || tweet?.user?.screen_name
    || legacy?.user?.screen_name
    || null;
  return {
    id: restId,
    url: screenName ? `https://x.com/${screenName}/status/${restId}` : `https://x.com/i/status/${restId}`,
    text: cleanText(legacy.full_text || legacy.text || ''),
    timestamp: normalizeXCreatedAt(legacy.created_at) || xSnowflakeTimestamp(restId),
    author: screenName ? { handle: screenName, url: `https://x.com/${screenName}` } : null,
    sourceAccount: screenName || null,
    isRetweet: Boolean(legacy.retweeted_status_result || legacy.retweeted_status_id_str || legacy.retweeted_status_id),
    media: parseXMedia(legacy),
    source: 'api-cursor',
  };
}

function normalizeXUserResult(result) {
  const user = result?.user || result;
  const legacy = user?.legacy || (user?.screen_name || user?.name || user?.id_str ? user : null);
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
    id: user?.rest_id || legacy?.id_str || user?.id_str || user?.id || null,
    url: `https://x.com/${handle}`,
    label: cleanText(legacy?.name || user?.core?.name || ''),
    displayName: cleanText(legacy?.name || user?.core?.name || '') || null,
    bio: cleanText(legacy?.description || user?.description || ''),
    followers: finiteNumber(legacy?.followers_count ?? user?.followers_count, null),
    following: finiteNumber(legacy?.friends_count ?? user?.friends_count, null),
    verified: Boolean(legacy?.verified || user?.verified || user?.is_blue_verified),
    source: 'api-relation',
  };
}

function collectXRelationEntries(json) {
  const users = /** @type {any[]} */ ([]);
  const cursors = /** @type {any[]} */ ([]);
  collectRecursive(json, (node) => {
    for (const cursorValue of [node?.next_cursor_str, node?.next_cursor]) {
      if (cursorValue && String(cursorValue) !== '0') {
        cursors.push(String(cursorValue));
      }
    }
    const cursor = xCursorFromTimelineContent(node, node?.entryId || node?.entry_id);
    if (cursor) {
      cursors.push(cursor);
    }
    const legacyUsers = Array.isArray(node?.users)
      ? node.users
      : node?.users && typeof node.users === 'object'
        ? Object.values(node.users)
        : [];
    const candidates = [
      ...legacyUsers,
      node?.itemContent?.user_results?.result,
      node?.user_results?.result,
      node?.userResult?.result,
      node?.__typename === 'User' || node?.legacy?.screen_name ? node : null,
      node?.screen_name ? node : null,
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
    ? /(?:\/i\/api\/graphql\/[^/]+\/Followers\?|(?:\/i\/api|https:\/\/api\.x\.com)\/1\.1\/followers\/list\.json(?:[?#]|$))/iu.test(value)
    : /(?:\/i\/api\/graphql\/[^/]+\/Following\?|(?:\/i\/api|https:\/\/api\.x\.com)\/1\.1\/(?:friends\/following\/list|friends\/list)\.json(?:[?#]|$))/iu.test(value);
}

function xCursorFromTimelineContent(content = /** @type {any} */ ({}), entryId = '') {
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

function xTweetResultFromItemContent(itemContent = /** @type {any} */ ({})) {
  return itemContent?.tweet_results?.result
    || itemContent?.tweetResult?.result
    || itemContent?.tweet?.result
    || null;
}

function collectXTimelineEntries(json) {
  const items = /** @type {any[]} */ ([]);
  const cursors = /** @type {any[]} */ ([]);
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

function instagramTimestampFromNode(node = /** @type {any} */ ({})) {
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

function instagramDurationMillisFromNode(node = /** @type {any} */ ({})) {
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

function instagramAuthorFromNode(node = /** @type {any} */ ({})) {
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

function instagramPermalinkPath(node = /** @type {any} */ ({})) {
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
  const media = /** @type {any[]} */ ([]);
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
  const items = /** @type {any[]} */ ([]);
  const cursors = /** @type {any[]} */ ([]);
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
        } else if ((node?.full_text || node?.text) && (node?.id_str || node?.id)) {
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

export function parseSocialRelationApiPayload(site, json) {
  const config = resolveSocialSiteConfig(site);
  if (config.siteKey === 'x') {
    const relation = collectXRelationEntries(json);
    return {
      users: relation.users,
      nextCursor: relation.nextCursor,
      riskSignals: detectApiPayloadRisk(json),
    };
  }
  return {
    users: [],
    nextCursor: null,
    riskSignals: detectApiPayloadRisk(json),
  };
}

function apiErrorTexts(json) {
  const texts = /** @type {any[]} */ ([]);
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
  const signals = /** @type {any[]} */ ([]);
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

function retryAfterMsFromHeaders(headers = /** @type {any} */ ({})) {
  const normalized = Object.fromEntries(normalizeHeaderEntries(headers));
  return parseRetryAfterMs(normalized['retry-after']);
}

function apiRiskReasonFromSignals(signals = /** @type {any[]} */ ([]), status = null) {
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
  return ['max-items', 'max-api-pages', 'max-users', 'max-detail-pages'].includes(normalized)
    ? normalized
    : null;
}

function isSoftCursorReplayExhaustion(fetchResult = /** @type {any} */ ({}), context = /** @type {any} */ ({})) {
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

function pageFetchJson(requestOrUrl, replayHeaders = /** @type {any} */ ({})) {
  const request = typeof requestOrUrl === 'string'
    ? { url: requestOrUrl, method: 'GET', headers: replayHeaders }
    : requestOrUrl;
  const method = String(request?.method || 'GET').toUpperCase();
  const init = /** @type {RequestInit & { headers: any }} */ ({
    method,
    credentials: 'include',
    headers: {
      accept: 'application/json, text/plain, */*',
      ...(request?.headers || {}),
    },
  });
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
    const headers = /** @type {any} */ ({});
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

function operationNameFromApiEntry(entry = /** @type {any} */ ({})) {
  return String(apiOperationNameFromResponse(entry.response) ?? '').toLowerCase();
}

function urlFromApiEntry(entry = /** @type {any} */ ({})) {
  return String(entry.response?.url ?? '').toLowerCase();
}

function scoreSocialApiSeed(entry, config, plan) {
  const operationName = operationNameFromApiEntry(entry);
  const url = urlFromApiEntry(entry);
  const parsedItems = parsedApiEntries(entry.parsed);
  let score = 0;
  if (entry.parsed?.nextCursor) {
    score += 100;
  }
  score += Math.min(parsedItems.length, 50);
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

function parsedApiEntries(parsed = /** @type {any} */ ({})) {
  if (Array.isArray(parsed?.items)) {
    return parsed.items;
  }
  if (Array.isArray(parsed?.users)) {
    return parsed.users;
  }
  return [];
}

function parsedApiForSummary(parsed = /** @type {any} */ ({}), config = /** @type {any} */ ({}), plan = /** @type {any} */ ({})) {
  if (config?.siteKey === 'x' && plan?.action === 'profile-content' && plan?.account && Array.isArray(parsed?.items)) {
    return {
      ...parsed,
      items: annotateApiArchiveItems(parsed.items, plan),
    };
  }
  return parsed;
}

function isTargetTimelineApiSummary(summary, config = /** @type {any} */ ({}), plan = /** @type {any} */ ({})) {
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

function requiresTargetTimelineApiSeed(config = /** @type {any} */ ({}), plan = /** @type {any} */ ({})) {
  if (config.siteKey === 'x') {
    return ['profile-content', 'search', 'followed-posts-by-date'].includes(plan.action);
  }
  if (config.siteKey === 'instagram') {
    return ['profile-content', 'followed-posts-by-date'].includes(plan.action);
  }
  return false;
}

function isTargetTimelineApiEntry(entry, config = /** @type {any} */ ({}), plan = /** @type {any} */ ({})) {
  return isTargetTimelineApiSummary(
    summarizeParsedApiResponse(entry.response, entry.parsed, config, plan),
    config,
    plan,
  );
}

function isSchemaDriftApiSummary(summary, config = /** @type {any} */ ({}), plan = /** @type {any} */ ({})) {
  return isTargetTimelineApiSummary(summary, config, plan)
    && (
      summary.itemCount === 0
      || !summary.hasNextCursor
      || summary.missingTimestampCount > 0
      || summary.missingAuthorCount > 0
    );
}

function classifyApiSchemaDrift(summary = /** @type {any} */ ({})) {
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
      return parsedApiEntries(right.parsed).length - parsedApiEntries(left.parsed).length;
    })[0] ?? null;
}

function summarizeSocialApiCapture(apiCapture, parsedResponses = /** @type {any[]} */ ([]), config = null, plan = null) {
  if (!apiCapture) {
    return null;
  }
  const responses = Array.isArray(apiCapture.responses) ? apiCapture.responses : [];
  const parsedSummaries = parsedResponses.map((entry) => summarizeParsedApiResponse(
    entry.response,
    parsedApiForSummary(entry.parsed, config || {}, plan || {}),
    config || {},
    plan || {},
  ));
  const targetOperations = dedupeSortedStrings(parsedSummaries
    .filter((summary) => isTargetTimelineApiSummary(summary, config || {}, plan || {}))
    .map((summary) => summary.operationName));
  const backgroundOperations = dedupeSortedStrings(responses
    .map((response) => apiOperationNameFromResponse(response))
    .filter((operation) => !targetOperations.includes(String(operation ?? ''))));
  const operations = [...targetOperations, ...backgroundOperations];
  const driftSamples = parsedSummaries
    .filter((entry) => isSchemaDriftApiSummary(entry, config || {}, plan || {}))
    .map(annotateApiSchemaDriftSummary)
    .slice(-API_CAPTURE_SAMPLE_LIMIT);
  const rawDriftSamples = parsedResponses
    .map((entry) => ({
      summary: summarizeParsedApiResponse(
        entry.response,
        parsedApiForSummary(entry.parsed, config || {}, plan || {}),
        config || {},
        plan || {},
      ),
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
    parsedSeedCandidateCount: parsedResponses.filter((entry) => parsedApiEntries(entry.parsed).length || entry.parsed?.nextCursor).length,
    operations: operations.slice(0, API_CAPTURE_SAMPLE_LIMIT),
    samples: parsedSummaries.slice(-API_CAPTURE_SAMPLE_LIMIT),
    driftSamples,
    rawDriftSampleCount: rawDriftSamples.length,
    rawDriftSamples,
    errors: (apiCapture.errors || []).slice(-API_CAPTURE_SAMPLE_LIMIT),
  };
}

function missingSocialApiSeedReason({
  capturedRiskSignals = [],
  capturedResponses = [],
  parsedResponses = [],
  capture = null,
} = {}) {
  if (capturedRiskSignals.length) {
    return apiRiskReasonFromSignals(capturedRiskSignals);
  }
  if (!capturedResponses.length) {
    return 'no-api-seed-captured';
  }
  const operationCount = Array.isArray(capture?.operations) ? capture.operations.length : 0;
  if (operationCount > 0 && parsedResponses.length > 0) {
    return 'api-operations-no-archive-seed';
  }
  return 'no-parseable-api-seed';
}

async function summarizeControlProbeApiCapture(apiCapture, startIndex = 0, timeoutMs = 1_500) {
  if (!apiCapture) {
    return null;
  }
  await apiCapture.flush?.(timeoutMs);
  const responses = Array.isArray(apiCapture.responses)
    ? apiCapture.responses.slice(Math.max(0, Number(startIndex) || 0))
    : [];
  const operations = dedupeSortedStrings(responses.map((response) => apiOperationNameFromResponse(response))).slice(0, API_CAPTURE_SAMPLE_LIMIT);
  const sideEffectPattern = /(?:mutation|update|subscribe|subscription|authenticate|log(?:\.json)?)/iu;
  return {
    responseCount: responses.length,
    operations,
    sideEffectRiskOperations: operations.filter((operation) => sideEffectPattern.test(String(operation ?? ''))),
    readLikeOperations: operations.filter((operation) => !sideEffectPattern.test(String(operation ?? ''))),
    statusCodes: dedupeSortedStrings(responses.map((response) => response?.status)),
  };
}

function normalizeHandleForCompare(value) {
  return String(value ?? '').trim().replace(/^@/u, '').toLowerCase();
}

function itemAuthorHandle(item = /** @type {any} */ ({})) {
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

function itemMatchesRequestedAccount(item = /** @type {any} */ ({}), plan = /** @type {any} */ ({})) {
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
  const attempts = /** @type {any[]} */ ([]);
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

async function collectSocialApiArchive(session, config, plan, settings, apiCapture, checkpoint = null, options = /** @type {any} */ ({})) {
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
      reason: missingSocialApiSeedReason({
        capturedRiskSignals,
        capturedResponses,
        parsedResponses,
        capture,
      }),
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
  const apiRiskEvents = /** @type {any[]} */ ([]);
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

function instagramDirectArchiveCapture(profileUrl, feedUrl, events = /** @type {any[]} */ ([])) {
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
  const samples = /** @type {any[]} */ ([]);
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

/**
 * @returns {{ promise: Promise<any>, resolve: (value?: any) => void, reject: (reason?: any) => void }}
 */
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

async function collectXRelationUsersFromReplayRequest(session, seedRequest, settings, seedPage = null) {
  let replayRequest = seedRequest;
  let cursor = seedPage?.nextCursor || null;
  let pages = Array.isArray(seedPage?.users) && seedPage.users.length ? 1 : 0;
  let users = mergeByKey(seedPage?.users || [], (entry) => entry.handle?.toLowerCase() || entry.url, settings.maxItems);
  let reason = cursor ? 'max-api-pages' : 'no-next-cursor';
  const riskSignals = /** @type {any[]} */ ([]);
  const riskEvents = /** @type {any[]} */ ([]);

  while (replayRequest?.url && pages < settings.maxApiPages && users.length < settings.maxItems) {
    const nextRequest = pages === 0
      ? replayRequest
      : cursor
        ? buildCursorReplayRequest(replayRequest, cursor)
        : null;
    if (!nextRequest?.url) {
      break;
    }
    const fetchResult = await fetchCursorReplayJson(session, nextRequest, settings);
    riskEvents.push(...(fetchResult.attempts || []).map((attempt) => ({
      ...attempt,
      url: nextRequest.url,
    })));
    riskSignals.push(...(fetchResult.riskSignals ?? []));
    if (!fetchResult.ok) {
      const status = Number(fetchResult.status);
      reason = users.length > 0 && pages > 0 && (status === 404 || status === 410)
        ? 'soft-cursor-exhausted'
        : fetchResult.reason || 'relation-page-fetch-failed';
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
      reason = users.length > 0 ? 'soft-cursor-exhausted' : 'no-new-users';
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
    replayRequest = nextRequest;
    reason = 'max-api-pages';
  }

  if (users.length >= settings.maxItems) {
    reason = 'max-items';
  }
  if (pages >= settings.maxApiPages && cursor && users.length < settings.maxItems) {
    reason = 'max-api-pages';
  }
  const boundedBy = boundedReasonFromArchiveReason(reason);
  return {
    strategy: 'api-relation',
    complete: ['no-next-cursor', 'soft-cursor-exhausted'].includes(reason) && !boundedBy && !riskSignals.length,
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
  const seedUsers = Array.isArray(seed?.parsed?.users) ? seed.parsed.users : [];
  const seedRequest = seedUsers.length
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

  const archive = await collectXRelationUsersFromReplayRequest(session, seedRequest, settings, seedUsers.length ? {
    users: seedUsers,
    nextCursor: seed?.parsed?.nextCursor ?? null,
  } : null);
  return {
    ...archive,
    seedUrl: seedRequest.url,
    requestTemplate: seedRequest.requestTemplate || seed?.response?.request || null,
    capture: summarizeSocialApiCapture(apiCapture, parsedResponses, resolveSocialSiteConfig('x'), plan),
  };
}

function normalizeFollowedUserSeedEntry(entry = /** @type {any} */ ({})) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const handle = cleanText(entry.handle || entry.username || entry.account || entry.screenName || '');
  const url = cleanText(entry.url || (handle ? `https://x.com/${handle}` : ''));
  if (!handle && !url) {
    return null;
  }
  return {
    handle: handle || pathnameHandleFromUrl(url),
    id: cleanText(entry.id || entry.userId || '') || null,
    url,
    label: cleanText(entry.label || entry.displayName || entry.name || handle) || null,
    displayName: cleanText(entry.displayName || entry.name || entry.label || '') || null,
    source: entry.source || 'followed-users-file',
  };
}

function pathnameHandleFromUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    const first = parsed.pathname.split('/').filter(Boolean)[0] || '';
    return first ? first.replace(/^@/u, '') : null;
  } catch {
    return null;
  }
}

async function loadFollowedUsersSeed(filePath, settings = /** @type {any} */ ({})) {
  if (!filePath) {
    return null;
  }
  const resolvedPath = path.resolve(String(filePath));
  const rows = (await readJsonLinesFile(resolvedPath))
    .filter((entry) => !entry?.kind || entry.kind === 'user')
    .map(normalizeFollowedUserSeedEntry)
    .filter(Boolean);
  const users = mergeByKey(rows, (entry) => entry.handle?.toLowerCase() || entry.url, settings.maxUsers);
  const runDir = path.dirname(resolvedPath);
  const manifest = await readJsonFile(path.join(runDir, 'manifest.json')).catch(() => null);
  const state = manifest ? null : await readJsonFile(path.join(runDir, 'state.json')).catch(() => null);
  const archive = manifest?.archive ?? state?.archive ?? null;
  const complete = archive?.complete === true || manifest?.completeness?.archiveStatus === 'yes';
  return {
    users,
    archive: {
      strategy: 'followed-users-file',
      complete,
      reason: complete ? null : (archive?.reason || manifest?.completeness?.archiveReason || 'followed-users-file-unverified'),
      file: resolvedPath,
      userCount: users.length,
      sourceArchive: archive
        ? {
          strategy: archive.strategy ?? null,
          complete: archive.complete ?? null,
          reason: archive.reason ?? null,
        }
        : null,
    },
  };
}

function summarizeXRelationApiArchive(relationApiArchive, relationApiUsers = /** @type {any[]} */ ([]), users = /** @type {any[]} */ ([])) {
  if (!relationApiArchive) {
    return null;
  }
  return {
    strategy: relationApiArchive.strategy,
    complete: relationApiArchive.complete,
    reason: relationApiArchive.reason,
    pages: relationApiArchive.pages,
    apiItemCount: relationApiUsers.length,
    dedupedItemCount: users.length,
    nextCursor: relationApiArchive.nextCursor ?? null,
  };
}

function summarizeFollowedRelationArchive(relationApiArchive, relationApiUsers = /** @type {any[]} */ ([]), users = /** @type {any[]} */ ([]), followedUsersSeed = null) {
  const apiSummary = summarizeXRelationApiArchive(relationApiArchive, relationApiUsers, users);
  if (!followedUsersSeed?.archive) {
    return apiSummary;
  }
  return {
    ...followedUsersSeed.archive,
    dedupedItemCount: users.length,
    fallbackFrom: apiSummary,
  };
}

function prefersDomForNoApiCursorFollowedPosts(plan = /** @type {any} */ ({}), settings = /** @type {any} */ ({})) {
  return plan.siteKey === 'x'
    && plan.action === 'followed-posts-by-date'
    && settings.apiCursor !== true;
}

function apiMediaByItemKey(items = /** @type {any[]} */ ([])) {
  const mediaByItem = new Map();
  for (const item of items || []) {
    const key = item.id || item.url || null;
    if (key && Array.isArray(item.media) && item.media.length) {
      mediaByItem.set(String(key), item.media);
    }
    if (item.url && Array.isArray(item.media) && item.media.length) {
      mediaByItem.set(String(item.url), item.media);
    }
  }
  return mediaByItem;
}

function mergeDomPrimaryPageResultWithArchive(pageResult, archive, settings) {
  const archiveItems = Array.isArray(archive?.items) ? archive.items : [];
  const pageItems = Array.isArray(pageResult.items) ? pageResult.items : [];
  const archiveMediaByItem = apiMediaByItemKey(archiveItems);
  const items = pageItems.map((item) => {
    const key = item.id || item.url || null;
    const apiMedia = key ? archiveMediaByItem.get(String(key)) : null;
    return apiMedia?.length ? { ...item, media: apiMedia } : item;
  });
  const media = mergeByKey([
    ...items.flatMap((item) => item.media || []),
    ...(pageResult.media || []),
  ], (entry) => `${entry.type}:${entry.url}`, settings.maxItems * 5);
  return {
    ...pageResult,
    items,
    media,
    archive: {
      ...(pageResult.archive || {}),
      strategy: 'dom-scroll',
      complete: true,
      reason: null,
      confidence: 'dom-primary',
      pages: 0,
      domItemCount: pageItems.length,
      apiItemCount: archiveItems.length,
      dedupedItemCount: items.length,
      capture: archive?.capture ?? pageResult.archive?.capture ?? null,
      boundarySignals: dedupeSortedStrings([
        ...(pageResult.archive?.boundarySignals ?? []),
        ...(archive?.boundarySignals ?? []),
        ...(archive?.riskSignals ?? []),
        ...(pageResult.visibilitySignals ?? []),
        ...(pageResult.riskSignals ?? []),
      ]),
    },
    riskSignals: dedupeSortedStrings([
      ...(pageResult.riskSignals ?? []),
      ...(archive?.riskSignals ?? []),
    ]),
    riskEvents: [
      ...(pageResult.riskEvents ?? []),
      ...(archive?.riskEvents ?? []),
    ],
    stopReason: pageResult.stopReason || runtimeRiskToStopReason(pickRuntimeRiskSignal(archive?.riskSignals ?? [])),
  };
}

function mergePageResultWithArchive(pageResult, archive, settings, plan = /** @type {any} */ ({})) {
  const preferDomForNoApiCursor = prefersDomForNoApiCursorFollowedPosts(plan, settings);
  if (preferDomForNoApiCursor && (pageResult.items?.length ?? 0) > 0) {
    return mergeDomPrimaryPageResultWithArchive(pageResult, archive, settings);
  }
  if (!archive?.items?.length) {
    const noApiCursorDomEmpty = preferDomForNoApiCursor && (pageResult.items?.length ?? 0) === 0;
    const fallbackArchive = noApiCursorDomEmpty
      ? {
        ...(pageResult.archive || {}),
        strategy: 'dom-scroll',
        complete: null,
        reason: pageResult.stopReason || 'dom-empty',
        pages: 0,
        capture: archive?.capture ?? pageResult.archive?.capture ?? null,
      }
      : archive ?? pageResult.archive ?? {
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
  const enriched = /** @type {any[]} */ ([]);
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

async function collectProfileDateScanAttempt(session, config, profilePlan, settings, apiCapture, profileApiDisabledAfterRateLimit, options = /** @type {any} */ ({})) {
  const apiCaptureStartIndex = apiCapture?.mark?.() ?? 0;
  await session.navigateAndWait(profilePlan.url, createWaitPolicy(settings.timeoutMs));
  const profileResult = await collectSocialPage(session, config, profilePlan, {
    ...settings,
    maxScrolls: options.maxScrolls ?? settings.maxScrolls,
    maxItems: Math.min(settings.perUserMaxItems, settings.maxItems),
  });
  const apiProfileArchive = settings.apiCursor && !profileApiDisabledAfterRateLimit
    ? await collectSocialApiArchive(session, config, profilePlan, {
      ...settings,
      maxItems: Math.min(settings.perUserMaxItems, settings.maxItems),
    }, apiCapture, null, {
      seedOnly: false,
      captureStartIndex: apiCaptureStartIndex,
      includeCheckpointItems: false,
    })
    : null;
  return { profileResult, apiProfileArchive };
}

function initialProfileDateScanMaxScrolls(config, settings = /** @type {any} */ ({})) {
  if (config?.siteKey === 'x' && settings.apiCursor === true) {
    return Math.min(settings.maxScrolls, 2);
  }
  return settings.maxScrolls;
}

function shouldRetryEmptyXProfileDateScan(config, profileResult = /** @type {any} */ ({}), apiProfileArchive = null) {
  if (config?.siteKey !== 'x') {
    return false;
  }
  const profileStopReason = profileResult.stopReason || runtimeRiskToStopReason(pickRuntimeRiskSignal(profileResult.riskSignals ?? []));
  const apiStopReason = runtimeRiskToStopReason(pickRuntimeRiskSignal(apiProfileArchive?.riskSignals ?? []));
  if (profileStopReason || apiStopReason) {
    return false;
  }
  if ((profileResult.riskSignals ?? []).length > 0 || (apiProfileArchive?.riskSignals ?? []).length > 0) {
    return false;
  }
  if ((profileResult.visibilitySignals ?? []).length > 0) {
    return false;
  }
  return (profileResult.items?.length ?? 0) === 0 && (apiProfileArchive?.items?.length ?? 0) === 0;
}

async function collectFollowedPostsByProfiles(session, config, plan, settings, checkpoint = null, apiCapture = null) {
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
  const relationApiArchive = config.siteKey === 'x'
    ? await collectXRelationApiUsers(session, relationPlan, {
      ...settings,
      maxItems: settings.maxUsers,
    }, apiCapture)
    : null;
  const relationApiUsers = Array.isArray(relationApiArchive?.users) ? relationApiArchive.users : [];
  const followedUsersSeed = await loadFollowedUsersSeed(settings.followedUsersFile, settings);
  const followedUsersFileUsers = Array.isArray(followedUsersSeed?.users) ? followedUsersSeed.users : [];
  const useFollowedUsersSeedOnly = followedUsersFileUsers.length > 0 && followedUsersSeed?.archive?.complete === true;
  const users = useFollowedUsersSeedOnly
    ? mergeByKey(followedUsersFileUsers, (entry) => entry.handle?.toLowerCase() || entry.url, settings.maxUsers)
    : mergeByKey([
      ...(relationResult.relations || []),
      ...relationApiUsers,
      ...followedUsersFileUsers,
    ], (entry) => entry.handle?.toLowerCase() || entry.url, settings.maxUsers);
  const previousArchive = settings.resume ? checkpoint?.previousState?.archive : null;
  const collectedItems = settings.resume ? [...(checkpoint?.previousItems || [])] : [];
  const collectedMedia = collectedItems.flatMap((entry) => entry.media || []);
  const scannedUsers = settings.resume && Array.isArray(previousArchive?.scannedUsers)
    ? [...previousArchive.scannedUsers]
    : [];
  const scannedHandles = new Set(scannedUsers.map((entry) => cleanText(entry?.handle || '').toLowerCase()).filter(Boolean));
  let profileApiDisabledAfterRateLimit = scannedUsers.some((entry) => (
    entry?.apiReason === 'api-rate-limited'
    || (entry?.visibilitySignals ?? []).includes('api-rate-limited-dom-fallback')
  ));
  let scanStopReason = relationResult.stopReason || runtimeRiskToStopReason(pickRuntimeRiskSignal([
    ...(relationResult.riskSignals ?? []),
    ...(relationApiArchive?.riskSignals ?? []),
  ]));
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
    let { profileResult, apiProfileArchive } = await collectProfileDateScanAttempt(
      session,
      config,
      profilePlan,
      settings,
      apiCapture,
      profileApiDisabledAfterRateLimit,
      { maxScrolls: initialProfileDateScanMaxScrolls(config, settings) },
    );
    let emptyRetryCount = 0;
    if (shouldRetryEmptyXProfileDateScan(config, profileResult, apiProfileArchive)) {
      emptyRetryCount += 1;
      await sleep(Math.max(settings.scrollWaitMs, 1_500));
      ({ profileResult, apiProfileArchive } = await collectProfileDateScanAttempt(
        session,
        config,
        profilePlan,
        settings,
        apiCapture,
        profileApiDisabledAfterRateLimit,
        { maxScrolls: settings.maxScrolls },
      ));
    }
    let profileStopReason = profileResult.stopReason || runtimeRiskToStopReason(pickRuntimeRiskSignal(profileResult.riskSignals ?? []));
    const apiProfileRiskSignal = pickRuntimeRiskSignal(apiProfileArchive?.riskSignals ?? []);
    const apiProfileStopReason = runtimeRiskToStopReason(apiProfileRiskSignal);
    const apiRateLimitedDomFallback = apiProfileStopReason === 'rate-limited' && !profileStopReason;
    if (apiRateLimitedDomFallback) {
      profileApiDisabledAfterRateLimit = true;
    } else {
      profileStopReason = profileStopReason || apiProfileStopReason;
    }
    const profileTimelineLoadFailed = profileStopReason === 'timeline-load-error';
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
    if (config.siteKey === 'instagram' && matchedItems.length === 0 && (profileResult.items || []).some((entry) => entry.url && !entry.timestamp)) {
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
      visibilitySignals: dedupeSortedStrings([
        ...(profileResult.visibilitySignals ?? []),
        ...(apiRateLimitedDomFallback ? ['api-rate-limited-dom-fallback'] : []),
      ]),
      riskSignals: dedupeSortedStrings([
        ...(profileResult.riskSignals ?? []),
        ...(apiRateLimitedDomFallback ? [] : (apiProfileArchive?.riskSignals ?? [])),
      ]),
      stopReason: profileStopReason ?? null,
      emptyRetryCount,
    });
    if (profileStopReason && !profileTimelineLoadFailed) {
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
    ...(relationApiArchive?.riskSignals ?? []),
    ...scannedUsers.flatMap((entry) => [...(entry.visibilitySignals ?? []), ...(entry.riskSignals ?? [])]),
  ]);
  const boundaryCounts = {
    privateOrUnavailable: scannedUsers.filter((entry) => (entry.visibilitySignals ?? []).some((signal) => ['private-account', 'deleted-or-unavailable', 'age-or-region-restricted'].includes(signal))).length,
    riskBlocked: scannedUsers.filter((entry) => (entry.riskSignals ?? []).length || entry.stopReason).length,
    noVisibleItems: scannedUsers.filter((entry) => entry.visibleItems === 0 && entry.apiItems === 0).length,
    missingMatchedItems: scannedUsers.filter((entry) => entry.matchedItems === 0 && ((entry.visibleItems ?? 0) > 0 || (entry.apiItems ?? 0) > 0)).length,
  };
  const relationComplete = relationApiArchive?.complete === true
    || relationResult.archive?.complete === true
    || followedUsersSeed?.archive?.complete === true;
  const scannedAllUsers = users.length === 0
    ? relationComplete
    : scannedUsers.length >= Math.min(users.length, settings.maxUsers);
  const boundedByMaxUsers = users.length >= settings.maxUsers && relationComplete !== true;
  const boundedByMaxItems = items.length >= settings.maxItems;
  const archiveComplete = Boolean(
    relationComplete
    && scannedAllUsers
    && !scanStopReason
    && !boundedByMaxUsers
    && !boundedByMaxItems
    && boundarySignals.length === 0,
  );
  const archiveReason = scanStopReason
    ? scanStopReason
    : boundedByMaxUsers
      ? 'max-users'
      : boundedByMaxItems
        ? 'max-items'
        : boundarySignals.length > 0
          ? 'platform-boundary-signals'
          : archiveComplete
            ? null
            : 'unverified-following-pagination';
  const confidence = scanStopReason || boundaryCounts.riskBlocked > 0
    ? 'risk-blocked'
    : boundaryCounts.privateOrUnavailable > 0
      ? 'private-or-unavailable'
      : items.some((entry) => !entry.timestamp) || boundaryCounts.missingMatchedItems > 0
        ? 'missing-detail-time'
        : boundedByMaxUsers
          ? 'bounded-by-max-users'
          : archiveComplete
            ? 'verified-complete'
            : 'unverified-following-pagination';
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
    surfaceInventory: relationResult.surfaceInventory ?? null,
    visibilitySignals: dedupeSortedStrings([
      ...(relationResult.visibilitySignals ?? []),
      ...scannedUsers.flatMap((entry) => entry.visibilitySignals ?? []),
    ]),
    riskSignals: dedupeSortedStrings([
      ...(relationResult.riskSignals ?? []),
      ...(relationApiArchive?.riskSignals ?? []),
      ...scannedUsers.flatMap((entry) => entry.riskSignals ?? []),
    ]),
    riskEvents: [
      ...(relationResult.riskEvents ?? []),
    ],
    stopReason: scanStopReason,
    archive: {
      strategy: 'followed-profile-date-scan',
      complete: archiveComplete,
      reason: archiveReason,
      confidence,
      boundarySignals,
      boundaryCounts,
      scannedUsers,
      relationArchive: summarizeFollowedRelationArchive(relationApiArchive, relationApiUsers, users, followedUsersSeed),
    },
  };
}

function shouldUseFollowedProfileDateScan(config, plan, settings, pageResult = null) {
  if (plan.action !== 'followed-posts-by-date') {
    return false;
  }
  const mode = String(settings.followedDateMode || '').toLowerCase();
  const profileScanModes = new Set(['followed-profile-date-scan', 'profile-date-scan', 'profile-scan']);
  if (config.siteKey === 'instagram') {
    return profileScanModes.has(mode) || !new Set(['home-feed', 'api-feed', 'home-feed-api']).has(mode);
  }
  if (config.siteKey !== 'x') {
    return false;
  }
  if (new Set(['search-only', 'filter-follows', 'filter-follows-search']).has(mode)) {
    return false;
  }
  if (profileScanModes.has(mode)) {
    return true;
  }
  if (!pageResult) {
    return false;
  }
  if ((pageResult.items?.length ?? 0) > 0) {
    return false;
  }
  if (runtimeRiskToStopReason(pickRuntimeRiskSignal(pageResult.riskSignals ?? []))) {
    return false;
  }
  return ['dom-empty', 'no-results', 'no-api-seed-captured', 'no-parseable-api-seed', 'api-operations-no-archive-seed', 'target-empty'].includes(
    String(pageResult.archive?.reason || pageResult.stopReason || ''),
  );
}

function selectResultPayload(plan, pageResult) {
  const runtimeFields = {
    visibilitySignals: pageResult.visibilitySignals ?? [],
    riskSignals: pageResult.riskSignals ?? [],
    riskEvents: pageResult.riskEvents ?? [],
    stopReason: pageResult.stopReason ?? null,
    controlProbe: pageResult.controlProbe ?? null,
    readCrawl: pageResult.readCrawl ?? null,
  };
  if (isNoContentReadRoutePlan(plan)) {
    return {
      queryType: plan.action,
      contentType: plan.contentType,
      account: {
        handle: null,
        displayName: null,
        bio: null,
        stats: [],
      },
      items: [],
      media: [],
      finalUrl: pageResult.finalUrl,
      title: pageResult.title,
      surfaceInventory: pageResult.surfaceInventory ?? null,
      archive: pageResult.archive ?? null,
      contentSuppressed: true,
      contentSuppressionReason: contentSuppressionReasonForPlan(plan),
      ...runtimeFields,
    };
  }
  if (plan.action === 'account-info') {
    return {
      queryType: 'account-info',
      account: pageResult.account,
      currentAccount: pageResult.currentAccount,
      finalUrl: pageResult.finalUrl,
      title: pageResult.title,
      surfaceInventory: pageResult.surfaceInventory ?? null,
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
      surfaceInventory: pageResult.surfaceInventory ?? null,
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
    surfaceInventory: pageResult.surfaceInventory ?? null,
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

function riskStateForRuntimeRisk(pageResult = /** @type {any} */ ({}), plan = /** @type {any} */ ({}), settings = /** @type {any} */ ({}), riskSummary = /** @type {any} */ ({})) {
  if (riskSummary.rateLimited !== true) {
    return null;
  }
  const taskAction = settings.fullArchive ? 'full-archive' : (plan.action ?? 'action');
  return normalizeRiskTransition({
    from: 'normal',
    state: 'rate_limited',
    reasonCode: 'request-burst',
    siteKey: plan.siteKey,
    taskId: `${plan.siteKey ?? 'social'}:${taskAction}`,
    scope: String(pageResult.archive?.reason ?? riskSummary.stopReason ?? '').startsWith('api-') ? 'api' : 'profile',
  });
}

function summarizeRuntimeRisk(pageResult = /** @type {any} */ ({}), settings = /** @type {any} */ ({}), plan = /** @type {any} */ ({})) {
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
  const riskState = riskStateForRuntimeRisk(pageResult, plan, settings, {
    rateLimited,
    stopReason,
  });
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
    riskState,
  };
}

function summarizeSocialAuthHealth(plan, settings, authContext = /** @type {any} */ ({}), authResult = null, runtimeRisk = null) {
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
  const recoveryCommand = siteLoginCommand(SOCIAL_SITES[plan.siteKey].homeUrl, [
    '--profile-path',
    profilePath,
    '--no-headless',
    '--reuse-login-state',
  ]);
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

function renderMarkdownReport(result) {
  const safePlan = safePlanForArtifact(result.plan ?? {});
  const lines = [
    `# ${result.siteKey} ${result.plan.action}`,
    '',
    `- URL: ${safePlan.url ?? '<redacted-url>'}`,
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
  if (result.result?.controlProbe?.requested) {
    const probe = result.result.controlProbe;
    lines.push(`- Read control probes: ${probe.executedCount ?? 0}/${probe.selectedCount ?? 0} executed, failed ${probe.failedCount ?? 0}, mutation-blocked ${probe.mutationBlockedCount ?? 0}`);
    if (probe.api?.operations?.length) {
      lines.push(`- Read control probe API: ${probe.api.operations.join(', ')}`);
    }
  }
  if (result.result?.readCrawl?.requested) {
    const crawl = result.result.readCrawl;
    lines.push(`- Read surface crawl: visited ${crawl.visitedCount ?? 0}/${crawl.maxPages ?? 0}, routes ${crawl.discoveredRouteTemplateCount ?? 0}, blocked ${crawl.blockedRouteCount ?? 0}`);
    if (crawl.api?.operations?.length) {
      lines.push(`- Read surface crawl API: ${crawl.api.operations.join(', ')}`);
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

function socialActionAuthConfirmed(authResult = null) {
  const status = normalizeText(authResult?.status);
  return ['already-authenticated', 'authenticated'].includes(status)
    || authResult?.loginState?.identityConfirmed === true
    || authResult?.identityConfirmed === true
    || authResult?.loggedIn === true;
}

function shouldRecordSocialActionSessionReuse({ plan = /** @type {any} */ ({}), authContext = /** @type {any} */ ({}), authResult = null, finalResult = null, closeSummary = null } = /** @type {any} */ ({})) {
  if (plan.requiresAuth !== true || !authContext.userDataDir || authContext.reuseLoginState === false) {
    return false;
  }
  if (!socialActionAuthConfirmed(authResult)) {
    return false;
  }
  if (authResult?.challengeRequired === true || finalResult?.runtimeRisk?.authExpired === true) {
    return false;
  }
  const shutdownMode = normalizeText(closeSummary?.shutdownMode);
  if (shutdownMode && !['graceful', 'forced'].includes(shutdownMode)) {
    return false;
  }
  return true;
}

async function recordSocialActionSessionReuse({
  plan = /** @type {any} */ ({}),
  authContext = /** @type {any} */ ({}),
  authResult = null,
  finalResult = null,
  closeSummary = null,
  settings = /** @type {any} */ ({}),
} = /** @type {any} */ ({}), deps = /** @type {any} */ ({})) {
  if (!shouldRecordSocialActionSessionReuse({ plan, authContext, authResult, finalResult, closeSummary })) {
    return null;
  }
  const userDataDir = authContext.userDataDir;
  const readState = deps.readAuthSessionState ?? readAuthSessionState;
  const writeState = deps.writeAuthSessionState ?? writeAuthSessionState;
  const previousState = await readState(userDataDir) ?? {};
  const previousCounts = previousState.counts ?? {};
  const now = deps.now instanceof Date ? deps.now : new Date();
  const nowIso = now.toISOString();
  const authPolicy = resolveAuthSessionPolicy(authContext.authConfig ?? {});
  const keepaliveIntervalMinutes = authPolicy.keepaliveIntervalMinutes;
  const nextSuggestedKeepaliveAt = new Date(now.getTime() + (keepaliveIntervalMinutes * 60_000)).toISOString();
  const persistedState = {
    updatedAt: nowIso,
    keepaliveIntervalMinutes,
    lastHealthyAt: nowIso,
    lastAuthenticatedAt: nowIso,
    lastKeepaliveAt: cleanText(previousState.lastKeepaliveAt) || null,
    lastLoginAt: normalizeText(authResult?.status) === 'authenticated'
      ? nowIso
      : cleanText(previousState.lastLoginAt) || null,
    lastSessionReuseVerifiedAt: nowIso,
    nextSuggestedKeepaliveAt,
    lastRiskAt: cleanText(previousState.lastRiskAt) || null,
    lastRiskCauseCode: cleanText(previousState.lastRiskCauseCode) || null,
    lastRiskAction: cleanText(previousState.lastRiskAction) || null,
    lastAntiCrawlSignals: Array.isArray(previousState.lastAntiCrawlSignals)
      ? previousState.lastAntiCrawlSignals.filter(Boolean)
      : [],
    lastWarmupAt: cleanText(previousState.lastWarmupAt) || null,
    lastWarmupCompleted: previousState.lastWarmupCompleted === true,
    lastWarmupUrls: Array.isArray(previousState.lastWarmupUrls)
      ? previousState.lastWarmupUrls.filter(Boolean)
      : [],
    lastBrowserShutdownMode: normalizeText(closeSummary?.shutdownMode) || null,
    networkIdentityFingerprint: cleanText(previousState.networkIdentityFingerprint) || null,
    profileQuarantined: previousState.profileQuarantined === true,
    counts: {
      successfulKeepalives: Number(previousCounts.successfulKeepalives ?? 0),
      successfulLogins: Number(previousCounts.successfulLogins ?? 0) + (
        normalizeText(authResult?.status) === 'authenticated' ? 1 : 0
      ),
      sessionReuseVerifications: Number(previousCounts.sessionReuseVerifications ?? 0) + 1,
      failedKeepalives: Number(previousCounts.failedKeepalives ?? 0),
      socialActionSessionReuses: Number(previousCounts.socialActionSessionReuses ?? 0) + 1,
    },
  };
  await writeState(userDataDir, persistedState);
  return {
    status: 'recorded',
    operation: plan.action,
    profileRef: authContext.userDataDir ? 'persistent-profile' : 'none',
    shutdownMode: closeSummary?.shutdownMode ?? null,
    nextSuggestedKeepaliveAt,
    timeoutMs: settings.timeoutMs ?? null,
  };
}

function buildSocialSessionGate(result = /** @type {any} */ ({}), { requiresAuth = false } = /** @type {any} */ ({})) {
  return evaluateAuthenticatedSessionReleaseGate({
    authHealth: { required: requiresAuth },
    sessionProvider: result.sessionProvider,
    sessionHealth: result.sessionHealth,
  }, {
    requiresAuth,
  });
}

function buildSocialSessionRepairCommand(result = /** @type {any} */ ({}), gate = /** @type {any} */ ({})) {
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

function relativeIndexHref(filePath, layout) {
  if (!filePath) {
    return '';
  }
  const relative = path.relative(layout.runDir, filePath);
  const parts = relative.split(path.sep).filter(Boolean).map((part) => encodeURIComponent(part));
  return parts.join('/');
}

function collectDownloadsForIndex(downloads = /** @type {any[]} */ ([])) {
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
  const safePlan = safePlanForArtifact(result.plan ?? {});
  const title = `${result.siteKey} ${safePlan.account || safePlan.query || safePlan.action || 'archive'}`;
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

function buildSocialActionRecoveryCommand(result, layout, extraArgs = /** @type {any[]} */ ([])) {
  const plan = result.plan || {};
  const settings = result.settings || result._settings || {};
  const site = plan.siteKey || result.siteKey || 'x';
  const action = settings.fullArchive && plan.action === 'profile-content' ? 'full-archive' : (plan.action || 'profile-content');
  const args = [action];
  if (plan.account && !['followed-users', 'followed-posts-by-date', 'search'].includes(plan.action)) {
    args.push(plan.account);
  }
  if (plan.action === 'profile-content' && plan.contentType && action !== 'full-archive') {
    args.push('--content-type', plan.contentType);
  }
  if (plan.date) {
    args.push('--date', plan.date);
  }
  if (plan.fromDate) {
    args.push('--from-date', plan.fromDate);
  }
  if (plan.toDate) {
    args.push('--to-date', plan.toDate);
  }
  if (plan.query) {
    args.push('--query', plan.query);
  }
  if (plan.action === 'read-route' && plan.routePath) {
    args.push('--route', plan.routePath);
  }
  if (plan.action === 'read-route' && plan.statusId) {
    args.push('--status-id', plan.statusId);
  }
  if (plan.action === 'read-route' && plan.mediaId) {
    args.push('--media-id', plan.mediaId);
  }
  if (plan.action === 'read-route' && plan.spaceId) {
    args.push('--space-id', plan.spaceId);
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
    args.push('--download-media');
  }
  if (settings.riskBackoffMs !== undefined) {
    args.push('--risk-backoff-ms', String(settings.riskBackoffMs));
  }
  if (settings.riskRetries !== undefined) {
    args.push('--risk-retries', String(settings.riskRetries));
  }
  args.push(...extraArgs);
  return actionCliCommand(site, args);
}

export function buildRecoveryRunbook(result, layout) {
  const commands = /** @type {any[]} */ ([]);
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
      formatCommand(['node', 'scripts/social-live-resume.mjs', '--state', layout.manifestPath, '--site', site, '--execute', '--cooldown-minutes', '30', '--max-attempts', '3']),
      'Let the cooldown expire, then let the resume runner continue from the saved cursor/state.',
    );
  }
  if (result.completeness?.driftReasons?.length) {
    addCommand(
      'inspect-api-drift',
      result.completeness.driftReasons[0],
      formatCommand(['node', 'scripts/social-live-report.mjs', '--runs-root', layout.runDir, '--site', site]),
      `Inspect ${path.basename(layout.apiCapturePath)} and ${path.basename(layout.apiDriftSamplesPath)} before changing API parsing rules.`,
    );
  }
  const downloadSummary = result.completeness?.download;
  const downloadExecutable = result.download
    && result.download.blocked !== true
    && result.download.supported !== false
    && result.download.status !== 'blocked'
    && result.download.reason !== 'download-layer-removed';
  if (
    downloadExecutable
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

function expectedMinimumBytes(entry = /** @type {any} */ ({})) {
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
  const entries = /** @type {any[]} */ ([]);
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
    'dom-empty',
    'no-results',
    'soft-cursor-exhausted',
  ]);
  const archiveBoundedBy = archive?.boundedBy || boundedReasonFromArchiveReason(archiveReason);
  const boundedReasons = [
    archiveBoundedBy,
  ].filter(Boolean);
  const driftReasons = [
    archiveReason,
    ...(archive?.capture?.driftSamples?.length ? ['api-schema-drift-samples'] : []),
  ].filter((reason) => ['no-api-seed-captured', 'no-parseable-api-seed', 'api-operations-no-archive-seed', 'api-schema-drift-samples'].includes(String(reason)));
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
  if (archive?.reason === 'soft-cursor-exhausted' && ((result.completeness?.itemCount ?? 0) > 0 || (result.completeness?.userCount ?? 0) > 0)) {
    return {
      ok: true,
      status: 'degraded',
      reason: 'soft-cursor-exhausted',
      resumable: false,
    };
  }
  const apiCursorDisabledFollowedPosts = result.plan?.action === 'followed-posts-by-date'
    && settings.apiCursor !== true;
  const requiresArchiveComplete = (settings.fullArchive && !apiCursorDisabledFollowedPosts)
    || (result.plan?.action === 'followed-posts-by-date' && settings.apiCursor === true);
  if (requiresArchiveComplete && archive && archive.complete !== true) {
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
      reason: result.completeness.driftReasons?.[0] || result.completeness.platformBoundarySignals?.[0] || result.completeness.archiveReason || null,
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
  let previousDownloadQueue = /** @type {any[]} */ ([]);
  try {
    const queueArtifact = await readJsonFile(layout.mediaQueuePath);
    previousDownloadQueue = Array.isArray(queueArtifact?.queue) ? queueArtifact.queue : [];
  } catch {
    previousDownloadQueue = /** @type {any[]} */ ([]);
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
    async write(patch = /** @type {any} */ ({})) {
      const safeCurrentUrl = safeUrlForArtifact(
        Object.hasOwn(patch, 'currentUrl') ? patch.currentUrl : currentState.currentUrl,
        plan.host,
      );
      currentState = {
        ...currentState,
        ...patch,
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        updatedAt: new Date().toISOString(),
        siteKey: plan.siteKey,
        plan: safePlanForArtifact(patch.plan || plan),
        currentUrl: safeCurrentUrl,
        settings: safeSettingsForArtifact(settings),
        artifacts: artifactPathSummary(layout),
      };
      await writeJsonFile(layout.statePath, currentState);
      return currentState;
    },
  };
}

export function createSocialArtifactRedactionFailure(error, { artifactKind = 'artifact' } = /** @type {any} */ ({})) {
  const reason = reasonCodeSummary('redaction-failed');
  const causeSummary = Object.fromEntries(Object.entries(redactValue({
    name: error instanceof Error ? error.name : undefined,
    code: error && typeof error === 'object' ? error.code : undefined,
  }).value).filter(([, value]) => value !== undefined));
  const failure = new Error(`Redaction failed for ${artifactKind}; persistent artifact write blocked`);
  failure.name = 'SocialArtifactRedactionFailure';
  failure.code = reason.code;
  failure.reasonCode = reason.code;
  failure.failureMode = 'redaction-failed';
  failure.family = reason.family;
  failure.retryable = reason.retryable;
  failure.cooldownNeeded = reason.cooldownNeeded;
  failure.isolationNeeded = reason.isolationNeeded;
  failure.manualRecoveryNeeded = reason.manualRecoveryNeeded;
  failure.degradable = reason.degradable;
  failure.artifactWriteAllowed = reason.artifactWriteAllowed;
  failure.catalogAction = reason.catalogAction;
  failure.artifactKind = artifactKind;
  failure.causeSummary = causeSummary;
  return failure;
}

export async function writeRedactedJsonArtifactWithAudit(
  artifactPath,
  auditPath,
  payload,
  { artifactKind = 'artifact' } = /** @type {any} */ ({}),
) {
  let prepared;
  try {
    prepared = prepareRedactedArtifactJsonWithAudit(payload);
  } catch (error) {
    throw createSocialArtifactRedactionFailure(error, { artifactKind });
  }
  await writeTextFile(artifactPath, prepared.json);
  await writeTextFile(auditPath, prepared.auditJson);
}

function externalReportMarkdownPath(reportPath) {
  return /\.json$/iu.test(reportPath) ? reportPath.replace(/\.json$/iu, '.md') : `${reportPath}.md`;
}

function externalReportAuditPath(reportPath) {
  return /\.json$/iu.test(reportPath)
    ? reportPath.replace(/\.json$/iu, '.redaction-audit.json')
    : `${reportPath}.redaction-audit.json`;
}

function externalReportMarkdownAuditPath(markdownPath) {
  return `${markdownPath}.redaction-audit.json`;
}

function prepareRedactedMarkdownArtifact(markdown, { artifactKind = 'social-report-markdown' } = /** @type {any} */ ({})) {
  try {
    const redactedMarkdown = redactValue(String(markdown ?? ''));
    const markdownText = String(redactedMarkdown.value ?? '');
    assertNoForbiddenPatterns(markdownText);
    const audit = prepareRedactedArtifactJsonWithAudit(redactedMarkdown.audit);
    return {
      markdownText,
      auditJson: audit.json,
    };
  } catch (error) {
    throw createSocialArtifactRedactionFailure(error, { artifactKind });
  }
}

export async function writeExternalSocialReportArtifacts(reportPath, finalResult) {
  const markdownPath = externalReportMarkdownPath(reportPath);
  const jsonAuditPath = externalReportAuditPath(reportPath);
  const markdownAuditPath = externalReportMarkdownAuditPath(markdownPath);
  let preparedJson;
  let preparedMarkdown;
  try {
    preparedJson = prepareRedactedArtifactJsonWithAudit(finalResult);
    const markdown = finalResult.markdown || renderMarkdownReport(finalResult);
    preparedMarkdown = prepareRedactedMarkdownArtifact(markdown, { artifactKind: 'external-social-report' });
  } catch (error) {
    throw createSocialArtifactRedactionFailure(error, { artifactKind: 'external-social-report' });
  }
  await writeTextFile(reportPath, preparedJson.json);
  await writeTextFile(jsonAuditPath, preparedJson.auditJson);
  await writeTextFile(markdownPath, preparedMarkdown.markdownText);
  await writeTextFile(markdownAuditPath, preparedMarkdown.auditJson);
  return {
    reportPath,
    reportRedactionAuditPath: jsonAuditPath,
    markdownReportPath: markdownPath,
    markdownRedactionAuditPath: markdownAuditPath,
  };
}

export async function writeInternalSocialReportArtifact(reportPath, auditPath, markdown) {
  const prepared = prepareRedactedMarkdownArtifact(markdown, { artifactKind: 'internal-social-report' });
  await writeTextFile(reportPath, prepared.markdownText);
  await writeTextFile(auditPath, prepared.auditJson);
  return {
    reportPath,
    reportRedactionAuditPath: auditPath,
  };
}

function capabilityHookMatchSummaryForLifecycleEvent(lifecycleEvent, {
  capabilityHookRegistry,
  capabilityHooks,
} = /** @type {any} */ ({})) {
  const hooks = capabilityHookRegistry ?? capabilityHooks;
  if (!hooks) {
    return undefined;
  }
  return matchCapabilityHooksForLifecycleEvent(hooks, lifecycleEvent);
}

function socialActionTaskType(finalResult = /** @type {any} */ ({})) {
  const taskId = String(finalResult.runtimeRisk?.riskState?.taskId ?? '');
  const [, taskType] = taskId.split(':');
  return taskType || finalResult.plan?.action || 'social-action';
}

function buildSocialRiskBlockedLifecycleEvent(finalResult = /** @type {any} */ ({}), layout, hookOptions = /** @type {any} */ ({})) {
  const riskState = finalResult.runtimeRisk?.riskState;
  if (finalResult.runtimeRisk?.hardStop !== true || !riskState) {
    return null;
  }
  let lifecycleEvent = normalizeLifecycleEvent({
    eventType: 'social.action.risk_blocked',
    traceId: path.basename(layout.runDir),
    correlationId: riskState.taskId,
    taskId: riskState.taskId,
    siteKey: finalResult.siteKey,
    taskType: socialActionTaskType(finalResult),
    adapterVersion: finalResult.plan?.adapterVersion ?? 'social-action-router-v1',
    reasonCode: riskState.reasonCode,
    createdAt: finalResult.generatedAt,
    details: {
      status: finalResult.outcome?.status,
      reason: finalResult.outcome?.reason,
      stopReason: finalResult.runtimeRisk?.stopReason,
      riskSignals: finalResult.runtimeRisk?.riskSignals ?? [],
      riskState,
    },
  });
  const capabilityHookMatches = capabilityHookMatchSummaryForLifecycleEvent(lifecycleEvent, hookOptions);
  if (capabilityHookMatches) {
    lifecycleEvent = normalizeLifecycleEvent({
      ...lifecycleEvent,
      details: {
        ...lifecycleEvent.details,
        capabilityHookMatches,
      },
    });
  }
  assertSchemaCompatible('LifecycleEvent', lifecycleEvent);
  return lifecycleEvent;
}

async function writeSocialArtifacts(finalResult, layout, checkpointWriter, hookOptions = /** @type {any} */ ({})) {
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
  await writeInternalSocialReportArtifact(
    layout.reportPath,
    layout.reportRedactionAuditPath,
    finalResult.markdown || renderMarkdownReport(finalResult),
  );
  await writeTextFile(layout.indexCsvPath, renderSocialIndexCsv(finalResult, layout));
  await writeTextFile(layout.indexHtmlPath, renderSocialIndexHtml(finalResult, layout));
  if (finalResult.result?.archive?.capture) {
    await writeRedactedJsonArtifactWithAudit(
      layout.apiCapturePath,
      layout.apiCaptureRedactionAuditPath,
      {
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        generatedAt: finalResult.generatedAt,
        siteKey: finalResult.siteKey,
        plan: safePlanForArtifact(finalResult.plan),
        archiveReason: finalResult.result.archive.reason ?? null,
        capture: finalResult.result.archive.capture,
      },
      { artifactKind: 'api-capture-debug' },
    );
    if (finalResult.result.archive.capture.rawDriftSamples?.length) {
      await writeRedactedJsonArtifactWithAudit(
        layout.apiDriftSamplesPath,
        layout.apiDriftSamplesRedactionAuditPath,
        {
          schemaVersion: ARTIFACT_SCHEMA_VERSION,
          generatedAt: finalResult.generatedAt,
          siteKey: finalResult.siteKey,
          plan: safePlanForArtifact(finalResult.plan),
          archiveReason: finalResult.result.archive.reason ?? null,
          samples: finalResult.result.archive.capture.rawDriftSamples,
        },
        { artifactKind: 'api-drift-samples' },
      );
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
    surfaceInventory: finalResult.result?.surfaceInventory ?? null,
    controlProbe: finalResult.result?.controlProbe ?? null,
    readCrawl: finalResult.result?.readCrawl ?? null,
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
  const manifestPrepared = prepareRedactedArtifactJsonWithAudit(manifest);
  await writeTextFile(layout.manifestPath, manifestPrepared.json);
  await writeTextFile(layout.manifestRedactionAuditPath, manifestPrepared.auditJson);
  const riskBlockedLifecycleEvent = buildSocialRiskBlockedLifecycleEvent(finalResult, layout, hookOptions);
  if (riskBlockedLifecycleEvent) {
    await writeLifecycleEventArtifact(riskBlockedLifecycleEvent, {
      eventPath: layout.socialRiskBlockedLifecycleEventPath,
      auditPath: layout.socialRiskBlockedLifecycleEventRedactionAuditPath,
    });
  }
  return artifactPathSummary(layout);
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

function normalizeRunSettings(plan, options = /** @type {any} */ ({})) {
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
    maxControlProbes: Math.max(0, toNumber(options.maxControlProbes, DEFAULT_MAX_CONTROL_PROBES)),
    maxReadCrawlPages: Math.max(0, toNumber(options.maxReadCrawlPages, DEFAULT_MAX_READ_CRAWL_PAGES)),
    maxReadCrawlDepth: Math.max(0, toNumber(options.maxReadCrawlDepth, DEFAULT_MAX_READ_CRAWL_DEPTH)),
    maxUsers: Math.max(1, toNumber(options.maxUsers, DEFAULT_MAX_USERS)),
    maxDetailPages: Math.max(0, toNumber(options.maxDetailPages, DEFAULT_MAX_DETAIL_PAGES)),
    perUserMaxItems: Math.max(1, toNumber(options.perUserMaxItems, DEFAULT_MAX_ITEMS)),
    followedUsersFile: options.followedUsersFile ? path.resolve(String(options.followedUsersFile)) : null,
    riskBackoffMs: Math.max(0, toNumber(options.riskBackoffMs, DEFAULT_RISK_BACKOFF_MS)),
    riskRetries: Math.max(0, toNumber(options.riskRetries, DEFAULT_RISK_RETRIES)),
    apiRetries: Math.max(0, toNumber(options.apiRetries, options.riskRetries ?? DEFAULT_API_RETRIES)),
    followedDateMode: followedDateMode || (plan.siteKey === 'instagram' && plan.action === 'followed-posts-by-date' ? 'followed-profile-date-scan' : 'default'),
    dryRun: toBoolean(options.dryRun, false),
    probeReadControls: toBoolean(options.probeReadControls, false),
    crawlReadSurfaces: toBoolean(options.crawlReadSurfaces, false),
    riskReviewedReadSurfaces: toBoolean(options.riskReviewedReadSurfaces, false),
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

function socialSessionHealthUrl(siteKey, options = /** @type {any} */ ({})) {
  const host = normalizeText(options.host) || SOCIAL_SITES[siteKey]?.host || siteKey;
  return SOCIAL_SITES[siteKey]?.homeUrl || `https://${host}/`;
}

async function inspectReusableSocialSession(siteKey, options = /** @type {any} */ ({}), deps = /** @type {any} */ ({})) {
  return await (deps.inspectReusableSiteSessionRuntime ?? inspectReusableSiteSession)(
    socialSessionHealthUrl(siteKey, options),
    {
      browserProfileRoot: options.browserProfileRoot,
      userDataDir: options.userDataDir,
      reuseLoginState: true,
    },
    {
      profilePath: options.profilePath,
    },
    deps.inspectReusableSiteSessionDeps ?? deps,
  );
}

function socialSessionRunnerDeps(deps = /** @type {any} */ ({})) {
  const explicit = deps.sessionRunnerDeps ?? {};
  return {
    ...deps,
    ...explicit,
    inspectReusableSiteSession: explicit.inspectReusableSiteSession
      ?? deps.inspectReusableSiteSession
      ?? ((siteKey, options) => inspectReusableSocialSession(siteKey, options, deps)),
    prepareSiteSessionGovernance: explicit.prepareSiteSessionGovernance
      ?? deps.prepareSiteSessionGovernance
      ?? prepareSiteSessionGovernance,
  };
}

async function resolveSocialSessionMetadata(plan, config, settings, artifactLayout, deps = /** @type {any} */ ({})) {
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
    }, {}, socialSessionRunnerDeps(deps));
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

export async function runSocialAction(options = /** @type {any} */ ({}), deps = /** @type {any} */ ({})) {
  const plan = buildSocialActionPlan(options);
  const config = resolveSocialSiteConfig(plan.siteKey);
  const settings = normalizeRunSettings(plan, options);
  const artifactLayout = buildSocialArtifactLayout(plan, settings);
  const sessionMetadata = await resolveSocialSessionMetadata(plan, config, settings, artifactLayout, deps);
  if (plan.requiresAccount && !plan.account && !plan.canRunWithoutAccount) {
    throw new Error(`${plan.action} requires --account <handle> or a profile URL.`);
  }
  if (settings.dryRun) {
    const dryRunResult = /** @type {any} */ ({
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
        maxControlProbes: settings.maxControlProbes,
        maxReadCrawlPages: settings.maxReadCrawlPages,
        maxReadCrawlDepth: settings.maxReadCrawlDepth,
        maxUsers: settings.maxUsers,
        downloadMedia: settings.downloadMedia,
        probeReadControls: settings.probeReadControls,
        crawlReadSurfaces: settings.crawlReadSurfaces,
        riskReviewedReadSurfaces: settings.riskReviewedReadSurfaces,
        riskBackoffMs: settings.riskBackoffMs,
        riskRetries: settings.riskRetries,
        apiRetries: settings.apiRetries,
        outputRoot: settings.outputRoot,
        runDir: artifactLayout.runDir,
        resume: settings.resume,
      },
      ...sessionMetadata,
      artifacts: artifactPathSummary(artifactLayout),
    });
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
    const loadedCheckpoint = await loadSocialCheckpoint(artifactLayout, settings);
    const checkpoint = createCheckpointWriter(artifactLayout, plan, settings, loadedCheckpoint);
    const blockedResult = /** @type {any} */ ({
      ok: false,
      siteKey: plan.siteKey,
      dryRun: false,
      generatedAt: new Date().toISOString(),
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
    });
    blockedResult.markdown = renderMarkdownReport(blockedResult);
    blockedResult.recoveryRunbook = buildRecoveryRunbook(blockedResult, artifactLayout);
    blockedResult.artifacts = await writeSocialArtifacts(blockedResult, artifactLayout, checkpoint, {
      capabilityHookRegistry: deps.capabilityHookRegistry,
      capabilityHooks: deps.capabilityHooks,
    });
    return blockedResult;
  }

  const runtime = {
    openBrowserSession,
    resolveSiteBrowserSessionOptions,
    ensureAuthenticatedSession,
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
  let authResult = null;
  let finalResult = /** @type {any} */ (null);
  let sessionCloseSummary = null;
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
    const shouldCaptureApi = settings.probeReadControls
      || settings.crawlReadSurfaces
      || (settings.apiCursor && !(config.siteKey === 'instagram' && isSocialRelationAction(plan.action)))
      || (config.siteKey === 'x' && isSocialRelationAction(plan.action));
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
      ? await createSocialApiCapture(session, config, settings, plan)
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
    authResult = plan.requiresAuth
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
    let pageResult = /** @type {any} */ (null);
    if (shouldUseFollowedProfileDateScan(config, executionPlan, settings)) {
      pageResult = await collectFollowedPostsByProfiles(session, config, executionPlan, settings, checkpoint, apiCapture);
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
      const shouldCollectContentApiArchive = !(config.siteKey === 'instagram' && isSocialRelationAction(executionPlan.action))
        && !isNoContentReadRoutePlan(executionPlan);
      let apiArchive = /** @type {any} */ (shouldCollectContentApiArchive
        ? await collectSocialApiArchive(session, config, executionPlan, settings, apiCapture, checkpoint, {
          seedOnly: false,
        })
        : null);
      if (shouldCollectContentApiArchive && isInstagramFeedUserArchivePlan(config, executionPlan, settings)) {
        const instagramFeedArchive = await collectInstagramFeedUserArchive(session, config, executionPlan, settings, checkpoint);
        if (shouldPreferInstagramDirectArchive(apiArchive, instagramFeedArchive)) {
          apiArchive = instagramFeedArchive;
        }
      }
      pageResult = mergePageResultWithArchive(domPageResult, apiArchive, settings, executionPlan);
      if (config.siteKey === 'x' && isSocialRelationAction(executionPlan.action)) {
        const relationApi = /** @type {any} */ (await collectXRelationApiUsers(session, executionPlan, settings, apiCapture));
        if (relationApi) {
          const relationApiUsers = Array.isArray(relationApi.users) ? relationApi.users : [];
          pageResult = {
            ...pageResult,
            relations: relationApiUsers.length ? relationApiUsers : pageResult.relations,
            archive: {
              ...(pageResult.archive || {}),
              strategy: relationApi.strategy,
              complete: relationApi.complete,
              reason: relationApi.reason,
              bounded: relationApi.bounded,
              boundedBy: relationApi.boundedBy,
              pages: relationApi.pages,
              apiItemCount: relationApiUsers.length,
              dedupedItemCount: relationApiUsers.length || pageResult.relations?.length || 0,
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
      if (shouldUseFollowedProfileDateScan(config, executionPlan, settings, pageResult)) {
        const fallbackResult = await collectFollowedPostsByProfiles(session, config, executionPlan, settings, checkpoint, apiCapture);
        pageResult = {
          ...fallbackResult,
          archive: {
            ...(fallbackResult.archive || {}),
            fallbackFrom: {
              strategy: pageResult.archive?.strategy ?? null,
              reason: pageResult.archive?.reason ?? null,
              domItemCount: pageResult.archive?.domItemCount ?? pageResult.items?.length ?? 0,
              apiItemCount: pageResult.archive?.apiItemCount ?? 0,
            },
          },
          riskSignals: dedupeSortedStrings([
            ...(pageResult.riskSignals ?? []),
            ...(fallbackResult.riskSignals ?? []),
          ]),
          riskEvents: [
            ...(pageResult.riskEvents ?? []),
            ...(fallbackResult.riskEvents ?? []),
          ],
        };
        surfacePreparation = fallbackResult.surfacePreparation ?? surfacePreparation;
      }
    }
    if (settings.probeReadControls) {
      await checkpoint.write({
        status: 'running',
        phase: 'probing-read-controls',
        updatedAt: new Date().toISOString(),
        currentUrl: executionPlan.url,
        counts: {
          items: pageResult?.items?.length ?? loadedCheckpoint.previousItems.length,
          media: pageResult?.media?.length ?? 0,
        },
      });
      const controlProbe = await runReadOnlyControlProbes(session, config, executionPlan, settings, apiCapture);
      if (controlProbe) {
        pageResult = {
          ...pageResult,
          controlProbe,
        };
      }
    }
    if (settings.crawlReadSurfaces) {
      await checkpoint.write({
        status: 'running',
        phase: 'crawling-read-surfaces',
        updatedAt: new Date().toISOString(),
        currentUrl: executionPlan.url,
        counts: {
          items: pageResult?.items?.length ?? loadedCheckpoint.previousItems.length,
          media: pageResult?.media?.length ?? 0,
        },
      });
      const readCrawl = await runReadOnlySurfaceCrawl(session, config, executionPlan, settings, apiCapture);
      if (readCrawl) {
        pageResult = {
          ...pageResult,
          readCrawl,
        };
      }
    }
    const resultPayload = mergeCheckpointItemsIntoPayload(
      selectResultPayload(executionPlan, pageResult),
      checkpoint,
      settings,
    );

    let download = null;
    if (settings.downloadMedia) {
      const mediaOutDir = artifactLayout.mediaDir;
      const downloadResult = await createBlockedMediaDownloadReport();
      download = {
        outDir: mediaOutDir,
        downloads: downloadResult.downloads,
        queue: downloadResult.queue,
        downloadCandidates: downloadResult.candidates,
        expectedMedia: downloadResult.expectedMedia,
        status: downloadResult.status,
        supported: downloadResult.supported,
        blocked: downloadResult.blocked,
        reason: downloadResult.reason,
        skippedMedia: downloadResult.skippedMedia,
        skippedDownloadCandidates: downloadResult.skippedCandidates,
        bounded: downloadResult.skippedMedia > 0 || downloadResult.skippedCandidates > 0,
        boundedBy: null,
      };
    }

    finalResult = {
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
    finalResult.runtimeRisk = summarizeRuntimeRisk(resultPayload, settings, executionPlan);
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
    finalResult.artifacts = await writeSocialArtifacts(finalResult, artifactLayout, checkpoint, {
      capabilityHookRegistry: deps.capabilityHookRegistry,
      capabilityHooks: deps.capabilityHooks,
    });
    if (settings.reportPath) {
      await writeExternalSocialReportArtifacts(settings.reportPath, finalResult);
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
      sessionCloseSummary = await session.close();
      const authSessionRecord = await recordSocialActionSessionReuse({
        plan: finalResult?.plan ?? plan,
        authContext,
        authResult,
        finalResult,
        closeSummary: sessionCloseSummary,
        settings,
      }, deps).catch((error) => ({
        status: 'skipped',
        reason: normalizeText(error?.message) || 'auth-session-record-failed',
      }));
      if (finalResult && authSessionRecord) {
        finalResult.authSessionRecord = authSessionRecord;
      }
    }
  }
}

function socialProgressSubject(parsed = /** @type {any} */ ({})) {
  const site = normalizeText(parsed.site) || 'social';
  const action = normalizeText(parsed.action) || 'action';
  return `${site}:${action}`;
}

function socialProgressArtifacts(result = /** @type {any} */ ({})) {
  const artifacts = result?.artifacts && typeof result.artifacts === 'object'
    ? result.artifacts
    : {};
  return Object.entries(artifacts)
    .filter(([, value]) => typeof value === 'string' && value)
    .filter(([key]) => [
      'runDir',
      'manifest',
      'report',
      'items',
      'downloads',
      'mediaManifest',
      'mediaQueue',
      'state',
      'indexCsv',
      'indexHtml',
    ].includes(key))
    .map(([key, value]) => ({ label: key, path: value }));
}

function socialProgressMessage(result = /** @type {any} */ ({})) {
  const outcome = normalizeText(result?.outcome?.status) || (result?.ok === true ? 'completed' : 'stopped');
  const reason = normalizeText(result?.outcome?.reason);
  const itemCount = Number(result?.result?.archive?.items?.length ?? result?.counts?.items ?? 0);
  const downloadTotal = Number(result?.download?.downloads?.length ?? result?.artifacts?.downloads?.total ?? 0);
  return [
    outcome,
    reason ? `reason=${reason}` : '',
    itemCount ? `items=${itemCount}` : '',
    downloadTotal ? `downloads=${downloadTotal}` : '',
  ].filter(Boolean).join(' ');
}

export async function runSocialActionCli(argv = process.argv.slice(2), defaults = /** @type {any} */ ({})) {
  initializeCliUtf8();
  const parsed = parseSocialActionArgs(argv, defaults);
  if (parsed.help) {
    process.stdout.write(SOCIAL_ACTION_HELP);
    return { help: SOCIAL_ACTION_HELP };
  }
  const result = await runSingleStageCliWithProgress({
    inputUrl: socialProgressSubject(parsed),
    options: parsed,
    taskId: 'socialAction',
    title: 'Social site action',
    stageId: 'socialAction',
    stageTitle: '运行社交站点任务',
    run: (stageOptions) => runSocialAction(stageOptions),
    successMessage: socialProgressMessage,
    artifacts: socialProgressArtifacts,
    warningResult: (stageResult) => stageResult?.result?.archive?.complete === false,
    isFailureResult: (stageResult) => stageResult?.ok !== true,
    failureReason: (stageResult) => normalizeText(stageResult?.outcome?.reason)
      || normalizeText(stageResult?.sessionGate?.reason)
      || 'social action failed',
    failureTitle: 'Social action safely stopped',
    nextStep: 'Inspect the generated report and run the suggested recovery command from the recovery runbook.',
  });
  if (String(parsed.outputFormat ?? 'json').toLowerCase() === 'markdown') {
    process.stdout.write(result.markdown || '');
  } else {
    writeJsonStdout(result);
  }
  if (result?.ok !== true) {
    process.exitCode = 1;
  }
}
