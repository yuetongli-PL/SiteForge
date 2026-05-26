// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { inferDouyinPageTypeFromUrl } from '../known-sites/douyin/model/site.mjs';
import { createCatalogAdapter } from './factory.mjs';

const DOUYIN_HOSTS = Object.freeze([
  'www.douyin.com',
  'creator.douyin.com',
]);

export const DOUYIN_TERMINOLOGY = Object.freeze({
  entityLabel: '\u89c6\u9891',
  entityPlural: '\u89c6\u9891',
  personLabel: '\u7528\u6237',
  personPlural: '\u7528\u6237',
  searchLabel: '\u641c\u7d22\u89c6\u9891',
  openEntityLabel: '\u6253\u5f00\u89c6\u9891',
  openPersonLabel: '\u6253\u5f00\u7528\u6237\u4e3b\u9875',
  downloadLabel: '\u4e0b\u8f7d\u89c6\u9891',
  verifiedTaskLabel: '\u89c6\u9891/\u7528\u6237/\u5206\u7c7b',
});

const INTENT_LABELS = Object.freeze({
  'search-video': '\u641c\u7d22\u89c6\u9891',
  'search-work': '\u641c\u7d22\u89c6\u9891',
  'search-book': '\u641c\u7d22\u89c6\u9891',
  'open-video': '\u6253\u5f00\u89c6\u9891',
  'open-work': '\u6253\u5f00\u89c6\u9891',
  'open-book': '\u6253\u5f00\u89c6\u9891',
  'open-up': '\u6253\u5f00\u7528\u6237\u4e3b\u9875',
  'open-author': '\u6253\u5f00\u7528\u6237\u4e3b\u9875',
  'open-actress': '\u6253\u5f00\u7528\u6237\u4e3b\u9875',
  'open-model': '\u6253\u5f00\u7528\u6237\u4e3b\u9875',
  'open-category': '\u6253\u5f00\u5206\u7c7b\u9875',
  'open-utility-page': '\u6253\u5f00\u529f\u80fd\u9875',
  'list-followed-users': '\u63d0\u53d6\u5173\u6ce8\u7528\u6237\u5217\u8868',
  'list-followed-updates': '\u63d0\u53d6\u5173\u6ce8\u66f4\u65b0\u89c6\u9891',
});

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

function isDouyinSiteKey(value) {
  const siteKey = String(value ?? '').trim();
  return siteKey === 'douyin' || /^douyin\.com-/u.test(siteKey);
}

function isDouyinApiCandidate(candidate = /** @type {any} */ ({})) {
  const { host, pathname } = endpointParts(candidate);
  if (!isDouyinSiteKey(candidate?.siteKey)) {
    return false;
  }
  if (host === 'www.douyin.com') {
    return pathname.startsWith('/aweme/v1/');
  }
  return host === 'creator.douyin.com'
    && (pathname.startsWith('/aweme/v1/') || pathname.startsWith('/web/api/'));
}

const DOUYIN_HEALTH_SIGNAL_MAP = Object.freeze({
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

function normalizeDouyinHealthSignal(rawSignal = /** @type {any} */ ({})) {
  const signal = typeof rawSignal === 'string'
    ? rawSignal
    : String(rawSignal?.rawSignal ?? rawSignal?.signal ?? rawSignal?.reasonCode ?? 'unknown-health-risk');
  const mapped = DOUYIN_HEALTH_SIGNAL_MAP[signal] ?? {
    type: 'unknown-health-risk',
    severity: 'medium',
    autoRecoverable: false,
    requiresUserAction: true,
  };
  return {
    siteId: 'douyin',
    rawSignal: signal,
    ...mapped,
    affectedCapability: rawSignal?.affectedCapability ?? rawSignal?.capabilityKey ?? mapped.affectedCapability,
  };
}

export const douyinAdapter = createCatalogAdapter({
  id: 'douyin',
  hosts: DOUYIN_HOSTS,
  terminology: DOUYIN_TERMINOLOGY,
  intentLabels: INTENT_LABELS,
  inferPageType({ inputUrl }) {
    return inferDouyinPageTypeFromUrl(inputUrl);
  },
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  validateApiCandidate({
    candidate,
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    validatedAt,
  } = /** @type {any} */ ({})) {
    const { host, pathname } = endpointParts(candidate);
    const accepted = isDouyinApiCandidate(candidate);
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 'douyin',
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 'douyin-api-candidate',
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
    const accepted = siteAdapterDecision?.decision === 'accepted' && isDouyinApiCandidate(candidate);
    return normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'douyin',
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 'douyin-aweme-api',
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
  normalizeHealthSignal: normalizeDouyinHealthSignal,
});
