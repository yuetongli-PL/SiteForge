// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { createCatalogAdapter } from './factory.mjs';
import { endpointParts } from './url-parts.mjs';

export const EIGHTMAN_HOSTS = Object.freeze([
  'www.8man.jp',
  '8man.jp',
  'so-agent.jp',
  'www.so-agent.jp',
]);

export const EIGHTMAN_TERMINOLOGY = Object.freeze({
  entityLabel: 'news item',
  entityPlural: 'news items',
  personLabel: 'model',
  personPlural: 'models',
  searchLabel: 'search models',
  openEntityLabel: 'open news item',
  openPersonLabel: 'open model profile',
  downloadLabel: 'download disabled',
  verifiedTaskLabel: 'model / news / recruit',
});

export const EIGHTMAN_INTENT_LABELS = Object.freeze({
  'search-model': 'search models',
  'search-author': 'search models',
  'open-model': 'open model profile',
  'open-author': 'open model profile',
  'open-news': 'open news item',
  'open-book': 'open news item',
  'open-category': 'open list page',
  'open-utility-page': 'open utility page',
  'open-auth-page': 'open blocked page',
  'browse-models': 'browse models',
  'browse-news': 'browse news',
  'browse-recruit': 'browse recruit page',
});

const READ_ONLY_METHODS = new Set(['GET', 'HEAD']);

function normalizePathname(pathname) {
  const raw = String(pathname ?? '').trim() || '/';
  const prefixed = raw.startsWith('/') ? raw : `/${raw}`;
  const normalized = prefixed.replace(/\/{2,}/gu, '/').replace(/\/+$/u, '') || '/';
  return normalized.toLowerCase();
}

function stripPhpSuffix(pathname) {
  return normalizePathname(pathname).replace(/\.php$/u, '');
}

function endpointMethod(candidate = /** @type {any} */ ({})) {
  return String(candidate?.endpoint?.method ?? 'GET').trim().toUpperCase();
}

function isReadOnlyMethod(candidate = /** @type {any} */ ({})) {
  return READ_ONLY_METHODS.has(endpointMethod(candidate));
}

function isEightmanHost(host) {
  return EIGHTMAN_HOSTS.includes(String(host ?? '').trim().toLowerCase());
}

export function inferEightmanPageType({ pathname = '' } = /** @type {any} */ ({})) {
  const normalized = stripPhpSuffix(pathname);
  if (normalized === '/') {
    return 'home';
  }
  if (normalized === '/model') {
    return 'author-list-page';
  }
  if (normalized.startsWith('/model/')) {
    return 'author-page';
  }
  if (normalized === '/news') {
    return 'category-page';
  }
  if (normalized.startsWith('/news/')) {
    return 'content-detail-page';
  }
  if (normalized === '/recruit') {
    return 'utility-page';
  }
  if (normalized === '/company' || normalized === '/contact') {
    return 'utility-page';
  }
  return null;
}

export function isEightmanApiCandidate(candidate = /** @type {any} */ ({})) {
  const siteKey = String(candidate?.siteKey ?? '').trim();
  const { host } = endpointParts(candidate);
  if (siteKey !== 'eightman' || !isEightmanHost(host) || !isReadOnlyMethod(candidate)) {
    return false;
  }
  return false;
}

export const eightmanAdapter = createCatalogAdapter({
  id: 'eightman',
  hosts: EIGHTMAN_HOSTS,
  terminology: EIGHTMAN_TERMINOLOGY,
  intentLabels: EIGHTMAN_INTENT_LABELS,
  inferPageType: inferEightmanPageType,
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  validateApiCandidate({
    candidate,
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    validatedAt,
  } = /** @type {any} */ ({})) {
    const { host, pathname } = endpointParts(candidate);
    const accepted = isEightmanApiCandidate(candidate);
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 'eightman',
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 'eightman-no-bridge-api-endpoints',
        endpointHost: host,
        endpointPath: pathname,
        endpointMethod: endpointMethod(candidate),
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
    const accepted = siteAdapterDecision?.decision === 'accepted' && isEightmanApiCandidate(candidate);
    return normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'eightman',
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 'eightman-no-bridge-api-endpoints',
        endpointHost: host,
        endpointPath: pathname,
        endpointMethod: endpointMethod(candidate),
        ...scope,
      },
      evidence,
    }, {
      candidate,
      siteAdapterDecision,
    });
  },
});
