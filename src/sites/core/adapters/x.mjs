// @ts-check

import { cleanText } from '../../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../capability/api-candidates.mjs';
import { createCatalogAdapter } from './factory.mjs';

const X_HOSTS = Object.freeze([
  'x.com',
  'www.x.com',
]);

export const X_TERMINOLOGY = Object.freeze({
  entityLabel: 'post',
  entityPlural: 'posts',
  personLabel: 'account',
  personPlural: 'accounts',
  searchLabel: 'search posts',
  openEntityLabel: 'open post',
  openPersonLabel: 'open account profile',
  downloadLabel: 'download post',
  verifiedTaskLabel: 'post / account / timeline',
});

const INTENT_LABELS = Object.freeze({
  'search-post': 'search posts',
  'search-posts': 'search posts',
  'search-content': 'search posts',
  'search-book': 'search posts',
  'open-post': 'open post',
  'open-book': 'open post',
  'open-author': 'open account profile',
  'open-profile': 'open account profile',
  'open-category': 'open explore page',
  'open-utility-page': 'open utility page',
  'open-auth-page': 'open login page',
  'download-book': 'download post media',
  'profile-content': 'list account posts',
  'list-profile-content': 'list account posts',
  'list-author-posts': 'list account posts',
  'list-author-replies': 'list account replies',
  'list-author-media': 'list account media',
  'list-author-highlights': 'list account highlights',
  'list-author-following': 'list account following',
  'list-profile-following': 'list account following',
  'list-followed-users': 'list followed accounts',
  'list-followed-updates': 'list followed account posts',
  'account-info': 'get account information',
});

function isReservedRootSegment(segment) {
  return [
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
  ].includes(segment);
}

function inferXPageType({ pathname = '' } = {}) {
  const normalizedPath = String(pathname || '/').trim().replace(/\/+$/u, '').toLowerCase() || '/';
  if (normalizedPath === '/home' || normalizedPath === '/') {
    return 'home';
  }
  if (normalizedPath === '/search' || normalizedPath.startsWith('/search/')) {
    return 'search-results-page';
  }
  if (normalizedPath === '/explore' || normalizedPath.startsWith('/explore/')) {
    return 'category-page';
  }
  if (
    normalizedPath === '/i/flow/login'
    || normalizedPath === '/login'
    || normalizedPath === '/signup'
    || normalizedPath.startsWith('/i/flow/signup')
  ) {
    return 'auth-page';
  }
  if (
    normalizedPath === '/notifications'
    || normalizedPath === '/messages'
    || normalizedPath === '/i/bookmarks'
    || normalizedPath.startsWith('/settings')
  ) {
    return 'author-list-page';
  }
  if (normalizedPath.startsWith('/i/status/')) {
    return 'book-detail-page';
  }
  if (/^\/[^/]+\/status\/\d+(?:\/|$)/u.test(normalizedPath)) {
    return 'book-detail-page';
  }
  if (/^\/[^/]+\/(?:following|followers)(?:\/|$)/u.test(normalizedPath)) {
    return 'author-list-page';
  }
  if (/^\/[^/]+\/(?:with_replies|media|highlights)(?:\/|$)/u.test(normalizedPath)) {
    return 'author-page';
  }

  const firstSegment = normalizedPath.split('/').filter(Boolean)[0] ?? '';
  if (firstSegment && !isReservedRootSegment(firstSegment)) {
    return 'author-page';
  }
  return null;
}

function parseUrl(input) {
  try {
    return input ? new URL(input) : null;
  } catch {
    return null;
  }
}

function endpointParts(candidate = {}) {
  const parsed = parseUrl(candidate?.endpoint?.url);
  return {
    host: parsed?.hostname.toLowerCase() ?? '',
    pathname: parsed?.pathname ?? '',
  };
}

function isXApiCandidate(candidate = {}) {
  const siteKey = String(candidate?.siteKey ?? '').trim();
  const { host, pathname } = endpointParts(candidate);
  return siteKey === 'x'
    && X_HOSTS.includes(host)
    && pathname.startsWith('/i/api/');
}

const X_HEALTH_SIGNAL_MAP = Object.freeze({
  'profile-health-risk': Object.freeze({
    type: 'platform-risk-detected',
    severity: 'high',
    affectedCapability: 'profile.read',
    autoRecoverable: false,
    requiresUserAction: true,
  }),
  'login-required': Object.freeze({
    type: 'login-required',
    severity: 'high',
    affectedCapability: 'auth.session',
    autoRecoverable: false,
    requiresUserAction: true,
  }),
  captcha: Object.freeze({
    type: 'captcha-required',
    severity: 'high',
    affectedCapability: 'auth.challenge',
    autoRecoverable: false,
    requiresUserAction: true,
  }),
  mfa: Object.freeze({
    type: 'mfa-required',
    severity: 'high',
    affectedCapability: 'auth.session',
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
  csrf: Object.freeze({
    type: 'csrf-invalid',
    severity: 'medium',
    affectedCapability: 'api.auth',
    autoRecoverable: true,
    requiresUserAction: false,
  }),
});

function normalizeXHealthSignal(rawSignal = {}) {
  const signal = typeof rawSignal === 'string'
    ? rawSignal
    : String(rawSignal?.rawSignal ?? rawSignal?.signal ?? rawSignal?.reasonCode ?? 'unknown-health-risk');
  const mapped = X_HEALTH_SIGNAL_MAP[signal] ?? {
    type: 'unknown-health-risk',
    severity: 'medium',
    autoRecoverable: false,
    requiresUserAction: true,
  };
  return {
    siteId: 'x',
    rawSignal: signal,
    ...mapped,
    affectedCapability: rawSignal?.affectedCapability ?? rawSignal?.capabilityKey ?? mapped.affectedCapability,
  };
}

export const xAdapter = createCatalogAdapter({
  id: 'x',
  hosts: X_HOSTS,
  terminology: X_TERMINOLOGY,
  intentLabels: INTENT_LABELS,
  inferPageType: inferXPageType,
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  validateApiCandidate({
    candidate,
    evidence = {},
    scope = {},
    validatedAt,
  } = {}) {
    const { host, pathname } = endpointParts(candidate);
    const accepted = isXApiCandidate(candidate);
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 'x',
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 'x-api-candidate',
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
    evidence = {},
    scope = {},
    decidedAt,
  } = {}) {
    const { host, pathname } = endpointParts(candidate);
    const accepted = siteAdapterDecision?.decision === 'accepted' && isXApiCandidate(candidate);
    return normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'x',
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 'x-api',
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
  normalizeHealthSignal: normalizeXHealthSignal,
});
