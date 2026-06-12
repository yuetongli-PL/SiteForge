// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { createCatalogAdapter } from './factory.mjs';
import { endpointParts } from './url-parts.mjs';

const WEIBO_HOSTS = Object.freeze([
  'weibo.com',
  'www.weibo.com',
  's.weibo.com',
]);

export const WEIBO_TERMINOLOGY = Object.freeze({
  entityLabel: 'post',
  entityPlural: 'posts',
  personLabel: 'account',
  personPlural: 'accounts',
  searchLabel: 'search Weibo',
  openEntityLabel: 'open post',
  openPersonLabel: 'open Weibo profile',
  downloadLabel: 'download post media',
  verifiedTaskLabel: 'post / profile / timeline',
});

const INTENT_LABELS = Object.freeze({
  'account-info': 'get Weibo account information',
  'list-followed-updates': 'list followed account posts',
  'list-followed-users': 'list followed accounts',
  'list-notifications': 'list notifications',
  'list-profile-content': 'list profile posts',
  'open-author': 'open Weibo profile',
  'open-post': 'open post',
  'open-utility-page': 'open Weibo utility page',
  'profile-content': 'list profile posts',
  'search-content': 'search Weibo',
  'search-posts': 'search Weibo posts',
});

function reservedProfileSegment(segment) {
  return [
    'ajax',
    'api',
    'at',
    'feed',
    'home',
    'login',
    'message',
    'messages',
    'notice',
    'notifications',
    'p',
    'passport',
    'search',
    'searchall',
    'settings',
    'signup',
    'u',
  ].includes(segment);
}

function inferWeiboPageType({ pathname = '', hostname = '', inputUrl = '' } = /** @type {any} */ ({})) {
  const host = String(hostname || (() => {
    try {
      return new URL(inputUrl).hostname;
    } catch {
      return '';
    }
  })()).toLowerCase();
  const normalizedPath = String(pathname || '/').trim().replace(/\/+$/u, '').toLowerCase() || '/';
  if (host === 's.weibo.com') {
    return 'search-results-page';
  }
  if (normalizedPath === '/' || normalizedPath === '/home') {
    return 'home';
  }
  if (
    normalizedPath.startsWith('/login')
    || normalizedPath.startsWith('/signin')
    || normalizedPath.startsWith('/signup')
    || normalizedPath.startsWith('/passport')
  ) {
    return 'auth-page';
  }
  if (
    normalizedPath === '/search'
    || normalizedPath.startsWith('/search/')
    || normalizedPath === '/searchall'
    || normalizedPath.startsWith('/searchall/')
  ) {
    return 'search-results-page';
  }
  if (normalizedPath.startsWith('/u/') || normalizedPath.startsWith('/n/')) {
    return 'author-page';
  }
  if (normalizedPath.startsWith('/message') || normalizedPath.startsWith('/messages')) {
    return 'message-page';
  }
  if (
    normalizedPath.startsWith('/notice')
    || normalizedPath.startsWith('/notifications')
    || normalizedPath.startsWith('/at/')
  ) {
    return 'notification-page';
  }
  if (normalizedPath.startsWith('/settings')) {
    return 'settings-page';
  }
  if (normalizedPath.startsWith('/compose') || normalizedPath.startsWith('/p/aj/')) {
    return 'write-entry-disabled';
  }
  if (/^\/[^/]+\/[^/]+(?:\/|$)/u.test(normalizedPath)) {
    return 'content-detail-page';
  }

  const firstSegment = normalizedPath.split('/').filter(Boolean)[0] ?? '';
  if (firstSegment && !reservedProfileSegment(firstSegment)) {
    return 'author-page';
  }
  return null;
}

function isWeiboApiCandidate(candidate = /** @type {any} */ ({})) {
  const siteKey = String(candidate?.siteKey ?? '').trim();
  const method = String(candidate?.endpoint?.method ?? candidate?.method ?? 'GET').toUpperCase();
  const { host, pathname } = endpointParts(candidate);
  return siteKey === 'weibo'
    && ['GET', 'HEAD'].includes(method)
    && ['weibo.com', 'www.weibo.com'].includes(host)
    && (pathname.startsWith('/ajax/') || pathname.startsWith('/api/'));
}

const WEIBO_HEALTH_SIGNAL_MAP = Object.freeze({
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
  'permission-denied': Object.freeze({
    type: 'permission-denied',
    severity: 'high',
    affectedCapability: 'content.read',
    autoRecoverable: false,
    requiresUserAction: true,
  }),
  'profile-health-risk': Object.freeze({
    type: 'platform-risk-detected',
    severity: 'high',
    affectedCapability: 'profile.read',
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
  'robots-disallowed': Object.freeze({
    type: 'platform-policy-blocked',
    severity: 'high',
    affectedCapability: 'generic.crawl',
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

function normalizeWeiboHealthSignal(rawSignal = /** @type {any} */ ({})) {
  const signal = typeof rawSignal === 'string'
    ? rawSignal
    : String(rawSignal?.rawSignal ?? rawSignal?.signal ?? rawSignal?.reasonCode ?? 'unknown-health-risk');
  const mapped = WEIBO_HEALTH_SIGNAL_MAP[signal] ?? {
    type: 'unknown-health-risk',
    severity: 'medium',
    autoRecoverable: false,
    requiresUserAction: true,
  };
  return {
    siteId: 'weibo',
    rawSignal: signal,
    ...mapped,
    affectedCapability: rawSignal?.affectedCapability ?? rawSignal?.capabilityKey ?? mapped.affectedCapability,
  };
}

export const weiboAdapter = createCatalogAdapter({
  id: 'weibo',
  hosts: WEIBO_HOSTS,
  terminology: WEIBO_TERMINOLOGY,
  intentLabels: INTENT_LABELS,
  inferPageType: inferWeiboPageType,
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  validateApiCandidate({
    candidate,
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    validatedAt,
  } = /** @type {any} */ ({})) {
    const { host, pathname } = endpointParts(candidate);
    const accepted = isWeiboApiCandidate(candidate);
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 'weibo',
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 'weibo-read-api-candidate',
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
    const accepted = siteAdapterDecision?.decision === 'accepted' && isWeiboApiCandidate(candidate);
    return normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'weibo',
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 'weibo-read-api',
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
  normalizeHealthSignal: normalizeWeiboHealthSignal,
});
