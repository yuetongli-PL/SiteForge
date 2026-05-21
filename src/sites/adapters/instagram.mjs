// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { createCatalogAdapter } from './factory.mjs';

const INSTAGRAM_HOSTS = Object.freeze([
  'www.instagram.com',
  'instagram.com',
]);

export const INSTAGRAM_TERMINOLOGY = Object.freeze({
  entityLabel: 'post',
  entityPlural: 'posts',
  personLabel: 'profile',
  personPlural: 'profiles',
  searchLabel: 'search Instagram',
  openEntityLabel: 'open post',
  openPersonLabel: 'open profile',
  downloadLabel: 'download post',
  verifiedTaskLabel: 'post / reel / profile',
});

const INTENT_LABELS = Object.freeze({
  'search-content': 'search Instagram',
  'search-book': 'search Instagram',
  'open-post': 'open post',
  'open-book': 'open post',
  'open-reel': 'open reel',
  'open-profile': 'open profile',
  'open-author': 'open profile',
  'open-category': 'open explore page',
  'open-utility-page': 'open utility page',
  'open-auth-page': 'open login page',
  'download-book': 'download post media',
  'profile-content': 'list profile posts',
  'list-profile-content': 'list profile posts',
  'list-author-posts': 'list profile posts',
  'list-author-media': 'list profile media',
  'list-author-highlights': 'list profile highlights',
  'list-author-following': 'list profile following',
  'list-profile-following': 'list profile following',
  'list-followed-users': 'list followed profiles',
  'list-followed-updates': 'list followed profile posts',
  'account-info': 'get profile information',
});

function isReservedRootSegment(segment) {
  return [
    'about',
    'accounts',
    'api',
    'challenge',
    'direct',
    'explore',
    'graphql',
    'legal',
    'p',
    'privacy',
    'reel',
    'reels',
    'stories',
    'tv',
    'web',
  ].includes(segment);
}

function inferInstagramPageType({ pathname = '' } = /** @type {any} */ ({})) {
  const normalizedPath = String(pathname || '/').trim().replace(/\/+$/u, '').toLowerCase() || '/';
  if (normalizedPath === '/') {
    return 'home';
  }
  if (
    normalizedPath.startsWith('/accounts/login')
    || normalizedPath.startsWith('/accounts/emailsignup')
    || normalizedPath.startsWith('/accounts/password')
    || normalizedPath.startsWith('/challenge')
  ) {
    return 'auth-page';
  }
  if (normalizedPath === '/explore/search' || normalizedPath.startsWith('/explore/search/')) {
    return 'search-results-page';
  }
  if (
    normalizedPath === '/explore'
    || normalizedPath.startsWith('/explore/')
    || normalizedPath === '/popular'
    || normalizedPath.startsWith('/reels')
  ) {
    return 'category-page';
  }
  if (normalizedPath.startsWith('/web/')) {
    return 'unknown-page';
  }
  if (
    normalizedPath.startsWith('/p/')
    || normalizedPath.startsWith('/reel/')
    || normalizedPath.startsWith('/tv/')
  ) {
    return 'book-detail-page';
  }
  if (normalizedPath.startsWith('/direct')) {
    return 'author-list-page';
  }
  if (/^\/[^/]+\/(?:following|followers)(?:\/|$)/u.test(normalizedPath)) {
    return 'author-list-page';
  }
  if (/^\/[^/]+\/(?:reels|tagged|saved)(?:\/|$)/u.test(normalizedPath)) {
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

function endpointParts(candidate = /** @type {any} */ ({})) {
  const parsed = parseUrl(candidate?.endpoint?.url);
  return {
    host: parsed?.hostname.toLowerCase() ?? '',
    pathname: parsed?.pathname ?? '',
  };
}

function isInstagramApiCandidate(candidate = /** @type {any} */ ({})) {
  const siteKey = String(candidate?.siteKey ?? '').trim();
  const { host, pathname } = endpointParts(candidate);
  return siteKey === 'instagram'
    && INSTAGRAM_HOSTS.includes(host)
    && pathname.startsWith('/api/');
}

const INSTAGRAM_HEALTH_SIGNAL_MAP = Object.freeze({
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
  'profile-health-risk': Object.freeze({
    type: 'platform-risk-detected',
    severity: 'high',
    affectedCapability: 'profile.read',
    autoRecoverable: false,
    requiresUserAction: true,
  }),
});

function normalizeInstagramHealthSignal(rawSignal = /** @type {any} */ ({})) {
  const signal = typeof rawSignal === 'string'
    ? rawSignal
    : String(rawSignal?.rawSignal ?? rawSignal?.signal ?? rawSignal?.reasonCode ?? 'unknown-health-risk');
  const mapped = INSTAGRAM_HEALTH_SIGNAL_MAP[signal] ?? {
    type: 'unknown-health-risk',
    severity: 'medium',
    autoRecoverable: false,
    requiresUserAction: true,
  };
  return {
    siteId: 'instagram',
    rawSignal: signal,
    ...mapped,
    affectedCapability: rawSignal?.affectedCapability ?? rawSignal?.capabilityKey ?? mapped.affectedCapability,
  };
}

export const instagramAdapter = createCatalogAdapter({
  id: 'instagram',
  hosts: INSTAGRAM_HOSTS,
  terminology: INSTAGRAM_TERMINOLOGY,
  intentLabels: INTENT_LABELS,
  inferPageType: inferInstagramPageType,
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  validateApiCandidate({
    candidate,
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    validatedAt,
  } = /** @type {any} */ ({})) {
    const { host, pathname } = endpointParts(candidate);
    const accepted = isInstagramApiCandidate(candidate);
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 'instagram',
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 'instagram-api-candidate',
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
    const accepted = siteAdapterDecision?.decision === 'accepted' && isInstagramApiCandidate(candidate);
    return normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'instagram',
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 'instagram-api',
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
  normalizeHealthSignal: normalizeInstagramHealthSignal,
});
