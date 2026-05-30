// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { createCatalogAdapter } from './factory.mjs';

const REDDIT_HOSTS = Object.freeze([
  'www.reddit.com',
  'reddit.com',
  'old.reddit.com',
  'oauth.reddit.com',
]);

export const REDDIT_TERMINOLOGY = Object.freeze({
  entityLabel: 'post',
  entityPlural: 'posts',
  personLabel: 'redditor',
  personPlural: 'redditors',
  searchLabel: 'search Reddit',
  openEntityLabel: 'open post',
  openPersonLabel: 'open redditor profile',
  downloadLabel: 'download attachment',
  verifiedTaskLabel: 'subreddit / post / comment / API',
});

const INTENT_LABELS = Object.freeze({
  'search-content': 'search Reddit',
  'search-posts': 'search Reddit posts',
  'open-post': 'open Reddit post',
  'open-comment': 'open Reddit comment',
  'open-author': 'open redditor profile',
  'open-profile': 'open redditor profile',
  'open-category': 'open subreddit',
  'open-utility-page': 'open Reddit utility page',
  'profile-content': 'list redditor posts',
  'list-profile-content': 'list redditor posts',
  'list-followed-users': 'list subscribed communities',
  'list-followed-updates': 'list subscribed feed posts',
  'account-info': 'get Reddit account information',
});

function endpointParts(candidate = /** @type {any} */ ({})) {
  try {
    const parsed = new URL(candidate?.endpoint?.url);
    return {
      host: parsed.hostname.toLowerCase(),
      pathname: parsed.pathname,
    };
  } catch {
    return { host: '', pathname: '' };
  }
}

function inferRedditPageType({ pathname = '' } = /** @type {any} */ ({})) {
  const normalizedPath = String(pathname || '/').trim().replace(/\/+$/u, '').toLowerCase() || '/';
  if (normalizedPath === '/' || normalizedPath === '/hot' || normalizedPath === '/new' || normalizedPath === '/top' || normalizedPath === '/rising') {
    return 'home';
  }
  if (normalizedPath === '/search' || normalizedPath.startsWith('/search/')) {
    return 'search-results-page';
  }
  if (/^\/r\/[^/]+(?:\/|$)/u.test(normalizedPath)) {
    if (/^\/r\/[^/]+\/comments\/[^/]+/u.test(normalizedPath)) {
      return 'content-detail-page';
    }
    if (/^\/r\/[^/]+\/about(?:\/|$)/u.test(normalizedPath)) {
      return 'utility-page';
    }
    return 'category-page';
  }
  if (/^\/user\/[^/]+(?:\/|$)/u.test(normalizedPath)) {
    return 'author-page';
  }
  if (/^\/comments\/[^/]+/u.test(normalizedPath) || /^\/by_id\//u.test(normalizedPath)) {
    return 'content-detail-page';
  }
  if (normalizedPath.startsWith('/message') || normalizedPath.startsWith('/prefs') || normalizedPath.startsWith('/settings')) {
    return 'auth-page';
  }
  if (normalizedPath.startsWith('/api/') || normalizedPath.startsWith('/subreddits') || normalizedPath.startsWith('/wiki')) {
    return 'utility-page';
  }
  return null;
}

function isRedditApiCandidate(candidate = /** @type {any} */ ({})) {
  const siteKey = String(candidate?.siteKey ?? '').trim();
  const method = String(candidate?.endpoint?.method ?? candidate?.method ?? 'GET').toUpperCase();
  const { host, pathname } = endpointParts(candidate);
  return siteKey === 'reddit'
    && ['GET', 'HEAD'].includes(method)
    && ['oauth.reddit.com', 'www.reddit.com', 'reddit.com'].includes(host)
    && (
      pathname.startsWith('/api/')
      || pathname.startsWith('/api/v1/')
      || pathname.startsWith('/r/')
      || pathname.startsWith('/user/')
      || pathname.startsWith('/subreddits')
      || pathname.startsWith('/comments/')
      || pathname.startsWith('/wiki/')
      || ['/hot', '/new', '/top', '/rising', '/search', '/best'].includes(pathname)
    );
}

const REDDIT_HEALTH_SIGNAL_MAP = Object.freeze({
  'oauth-token-required': Object.freeze({
    type: 'login-required',
    severity: 'high',
    affectedCapability: 'api.auth',
    autoRecoverable: false,
    requiresUserAction: true,
  }),
  'rate-limit': Object.freeze({
    type: 'rate-limited',
    severity: 'medium',
    affectedCapability: 'api.request',
    autoRecoverable: true,
    requiresUserAction: false,
  }),
  'permission-denied': Object.freeze({
    type: 'permission-denied',
    severity: 'high',
    affectedCapability: 'content.read',
    autoRecoverable: false,
    requiresUserAction: true,
  }),
  'robots-disallowed': Object.freeze({
    type: 'platform-policy-blocked',
    severity: 'high',
    affectedCapability: 'generic.crawl',
    autoRecoverable: false,
    requiresUserAction: true,
  }),
});

function normalizeRedditHealthSignal(rawSignal = /** @type {any} */ ({})) {
  const signal = typeof rawSignal === 'string'
    ? rawSignal
    : String(rawSignal?.rawSignal ?? rawSignal?.signal ?? rawSignal?.reasonCode ?? 'unknown-health-risk');
  const mapped = REDDIT_HEALTH_SIGNAL_MAP[signal] ?? {
    type: 'unknown-health-risk',
    severity: 'medium',
    autoRecoverable: false,
    requiresUserAction: true,
  };
  return {
    siteId: 'reddit',
    rawSignal: signal,
    ...mapped,
    affectedCapability: rawSignal?.affectedCapability ?? rawSignal?.capabilityKey ?? mapped.affectedCapability,
  };
}

export const redditAdapter = createCatalogAdapter({
  id: 'reddit',
  hosts: REDDIT_HOSTS,
  terminology: REDDIT_TERMINOLOGY,
  intentLabels: INTENT_LABELS,
  inferPageType: inferRedditPageType,
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  validateApiCandidate({
    candidate,
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    validatedAt,
  } = /** @type {any} */ ({})) {
    const { host, pathname } = endpointParts(candidate);
    const accepted = isRedditApiCandidate(candidate);
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 'reddit',
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 'reddit-official-api-read-candidate',
        endpointHost: host,
        endpointPath: pathname,
        ...scope,
      },
      evidence,
    }, { candidate });
  },
  getApiCatalogUpgradePolicy({
    candidate,
    siteAdapterDecision,
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    decidedAt,
  } = /** @type {any} */ ({})) {
    const { host, pathname } = endpointParts(candidate);
    const accepted = siteAdapterDecision?.decision === 'accepted' && isRedditApiCandidate(candidate);
    return normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'reddit',
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 'reddit-official-api-read',
        endpointHost: host,
        endpointPath: pathname,
        ...scope,
      },
      evidence,
    }, {
      candidate,
      siteAdapterDecision,
    });
  },
  normalizeHealthSignal: normalizeRedditHealthSignal,
});
