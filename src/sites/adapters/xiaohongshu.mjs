// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import { detectXiaohongshuRestrictionPage } from '../../shared/xiaohongshu-risk.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { requireReasonCodeDefinition } from '../../domain/risks/reason-codes.mjs';
import { redactValue } from '../../domain/sessions/security-guard.mjs';
import { createCatalogAdapter } from './factory.mjs';
import { endpointParts, parseUrl } from './url-parts.mjs';

const XIAOHONGSHU_HOSTS = Object.freeze([
  'www.xiaohongshu.com',
  'xiaohongshu.com',
]);

export const XIAOHONGSHU_TERMINOLOGY = Object.freeze({
  entityLabel: '\u7b14\u8bb0',
  entityPlural: '\u7b14\u8bb0',
  personLabel: '\u7528\u6237',
  personPlural: '\u7528\u6237',
  searchLabel: '\u641c\u7d22\u7b14\u8bb0',
  openEntityLabel: '\u6253\u5f00\u7b14\u8bb0',
  openPersonLabel: '\u6253\u5f00\u7528\u6237\u4e3b\u9875',
  downloadLabel: '\u4e0b\u8f7d\u7b14\u8bb0',
  verifiedTaskLabel: '\u7b14\u8bb0 / \u7528\u6237 / \u53d1\u73b0 / \u901a\u77e5',
});

const INTENT_LABELS = Object.freeze({
  'search-video': '\u641c\u7d22\u7b14\u8bb0',
  'search-work': '\u641c\u7d22\u7b14\u8bb0',
  'search-book': '\u641c\u7d22\u7b14\u8bb0',
  'open-video': '\u6253\u5f00\u7b14\u8bb0',
  'open-work': '\u6253\u5f00\u7b14\u8bb0',
  'open-book': '\u6253\u5f00\u7b14\u8bb0',
  'open-up': '\u6253\u5f00\u7528\u6237\u4e3b\u9875',
  'open-author': '\u6253\u5f00\u7528\u6237\u4e3b\u9875',
  'open-actress': '\u6253\u5f00\u7528\u6237\u4e3b\u9875',
  'open-model': '\u6253\u5f00\u7528\u6237\u4e3b\u9875',
  'open-category': '\u6253\u5f00\u53d1\u73b0\u9875',
  'open-utility-page': '\u6253\u5f00\u901a\u77e5\u9875',
  'open-auth-page': '\u6253\u5f00\u767b\u5f55\u9875',
  'download-book': '\u4e0b\u8f7d\u7b14\u8bb0',
  'download-video': '\u4e0b\u8f7d\u7b14\u8bb0',
  'download-work': '\u4e0b\u8f7d\u7b14\u8bb0',
  'list-followed-users': '\u67e5\u8be2\u5173\u6ce8\u7528\u6237\u5217\u8868',
  'list-followed-updates': '\u67e5\u8be2\u5173\u6ce8\u7528\u6237\u6700\u8fd1\u66f4\u65b0',
});

function isXiaohongshuApiCandidate(candidate = /** @type {any} */ ({})) {
  const siteKey = String(candidate?.siteKey ?? '').trim();
  const { host, pathname } = endpointParts(candidate);
  return siteKey === 'xiaohongshu'
    && XIAOHONGSHU_HOSTS.includes(host)
    && pathname.startsWith('/api/');
}

function stripXiaohongshuSuffix(value) {
  return cleanText(value)
    .replace(/\s*-\s*\u5c0f\u7ea2\u4e66$/u, '')
    .trim();
}

function normalizeXiaohongshuDisplayLabel(rawValue, { url, pageType, queryText } = /** @type {any} */ ({})) {
  const parsed = parseUrl(url);
  const pathname = parsed?.pathname ?? '';
  const searchQuery = cleanText(queryText || parsed?.searchParams.get('keyword') || '');
  const stripped = stripXiaohongshuSuffix(rawValue);

  if (pageType === 'home' || pathname === '/explore') {
    return '\u53d1\u73b0';
  }

  if (pageType === 'search-results-page' || pathname === '/search_result') {
    return searchQuery ? `\u641c\u7d22\uff1a${searchQuery}` : (stripped || '\u641c\u7d22\u7ed3\u679c');
  }

  if (pageType === 'author-page' || pathname.startsWith('/user/profile/')) {
    return stripped || '\u7528\u6237\u4e3b\u9875';
  }

  if (pageType === 'book-detail-page' || pathname.startsWith('/explore/')) {
    return stripped || '\u7b14\u8bb0\u8be6\u60c5';
  }

  if (pageType === 'utility-page' || pathname.startsWith('/notification')) {
    return '\u901a\u77e5\u9875';
  }

  if (pathname.startsWith('/livelist')) {
    return '\u76f4\u64ad\u5217\u8868';
  }

  if (pageType === 'auth-page' || pathname === '/login') {
    return '\u767b\u5f55\u9875';
  }

  if (pathname === '/register') {
    return '\u6ce8\u518c\u9875';
  }

  return stripped || null;
}

function inferXiaohongshuPageType({ pathname = '' } = /** @type {any} */ ({})) {
  const normalizedPath = cleanText(pathname).replace(/\/+$/u, '') || '/';
  if (normalizedPath === '/website-login/error') {
    return 'auth-page';
  }
  return null;
}

function normalizeRestrictionPageResult(result = null) {
  if (!result?.restrictionDetected) {
    return null;
  }
  const reasonCode = cleanText(result.reasonCode ?? result.antiCrawlReasonCode ?? 'anti-crawl-verify')
    || 'anti-crawl-verify';
  requireReasonCodeDefinition(/** @type {any} */ (reasonCode), { family: 'risk' });

  const riskCauseCode = cleanText(result.riskCauseCode ?? '') || null;
  if (riskCauseCode) {
    requireReasonCodeDefinition(/** @type {any} */ (riskCauseCode), { family: 'risk' });
  }

  const { value } = redactValue({
    ...result,
    reasonCode,
    antiCrawlReasonCode: reasonCode,
    riskCauseCode,
  });
  delete value.artifactPath;
  delete value.catalogPath;
  delete value.catalogEntry;
  delete value.request;
  delete value.response;
  return value;
}

const XIAOHONGSHU_HEALTH_SIGNAL_MAP = Object.freeze({
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

function normalizeXiaohongshuHealthSignal(rawSignal = /** @type {any} */ ({})) {
  const signal = typeof rawSignal === 'string'
    ? rawSignal
    : String(rawSignal?.rawSignal ?? rawSignal?.signal ?? rawSignal?.reasonCode ?? 'unknown-health-risk');
  const mapped = XIAOHONGSHU_HEALTH_SIGNAL_MAP[signal] ?? {
    type: 'unknown-health-risk',
    severity: 'medium',
    autoRecoverable: false,
    requiresUserAction: true,
  };
  return {
    siteId: 'xiaohongshu',
    rawSignal: signal,
    ...mapped,
    affectedCapability: rawSignal?.affectedCapability ?? rawSignal?.capabilityKey ?? mapped.affectedCapability,
  };
}

export const xiaohongshuAdapter = createCatalogAdapter({
  id: 'xiaohongshu',
  hosts: XIAOHONGSHU_HOSTS,
  terminology: XIAOHONGSHU_TERMINOLOGY,
  intentLabels: INTENT_LABELS,
  inferPageType: inferXiaohongshuPageType,
  detectRestrictionPage(input = /** @type {any} */ ({})) {
    return normalizeRestrictionPageResult(detectXiaohongshuRestrictionPage(input));
  },
  normalizeDisplayLabel({ value, ...options }) {
    return normalizeXiaohongshuDisplayLabel(value, options) ?? cleanText(value);
  },
  validateApiCandidate({
    candidate,
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    validatedAt,
  } = /** @type {any} */ ({})) {
    const { host, pathname } = endpointParts(candidate);
    const accepted = isXiaohongshuApiCandidate(candidate);
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 'xiaohongshu',
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 'xiaohongshu-api-candidate',
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
    const accepted = siteAdapterDecision?.decision === 'accepted' && isXiaohongshuApiCandidate(candidate);
    return normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'xiaohongshu',
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 'xiaohongshu-api',
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
  normalizeHealthSignal: normalizeXiaohongshuHealthSignal,
});
