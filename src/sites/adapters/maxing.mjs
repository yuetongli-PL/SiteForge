// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { createCatalogAdapter } from './factory.mjs';
import { endpointParts } from './url-parts.mjs';

export const MAXING_HOSTS = Object.freeze([
  'maxing.jp',
  'www.maxing.jp',
]);

export const MAXING_TERMINOLOGY = Object.freeze({
  entityLabel: 'work',
  entityPlural: 'works',
  personLabel: 'performer',
  personPlural: 'performers',
  searchLabel: 'search works',
  openEntityLabel: 'open work',
  openPersonLabel: 'open performer page',
  downloadLabel: 'download work',
  verifiedTaskLabel: 'MAXING catalog / performer / shop page',
});

export const MAXING_INTENT_LABELS = Object.freeze({
  'browse-ranking': 'browse ranking',
  'search-content': 'search works',
  'search-work': 'search works',
  'search-book': 'search works',
  'open-work': 'open work',
  'open-book': 'open work',
  'open-actress': 'open performer page',
  'open-author': 'open performer page',
  'open-category': 'open catalog page',
  'open-utility-page': 'open utility page',
  'open-auth-page': 'open account page',
  'list-actresses': 'list performers',
  'store-search': 'search stores',
});

const MAXING_API_PREFIXES = Object.freeze([
  '/api/',
  '/ajax/',
  '/json/',
]);

function normalizePathname(pathname) {
  const normalized = String(pathname || '/').trim().replace(/\/{2,}/gu, '/');
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return (withSlash.length > 1 ? withSlash.replace(/\/+$/gu, '') : withSlash).toLowerCase();
}

function candidateMethod(candidate = /** @type {any} */ ({})) {
  return String(candidate?.endpoint?.method ?? candidate?.method ?? 'GET').trim().toUpperCase();
}

function isReadOnlyMethod(method) {
  return method === 'GET' || method === 'HEAD';
}

function isMaxingHost(host) {
  return MAXING_HOSTS.includes(String(host ?? '').trim().toLowerCase());
}

function isMaxingHtmlSurface(pathname) {
  const normalizedPath = normalizePathname(pathname);
  return normalizedPath === '/'
    || normalizedPath === '/top'
    || normalizedPath.startsWith('/actress')
    || normalizedPath.startsWith('/contact')
    || normalizedPath.startsWith('/customer')
    || normalizedPath.startsWith('/event')
    || normalizedPath.startsWith('/link')
    || normalizedPath.startsWith('/shop')
    || normalizedPath.startsWith('/shop_search')
    || normalizedPath.endsWith('.html');
}

function isMaxingApiPath(pathname) {
  const normalizedPath = normalizePathname(pathname);
  if (isMaxingHtmlSurface(normalizedPath)) {
    return false;
  }
  return MAXING_API_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix))
    || normalizedPath.endsWith('.json');
}

export function inferMaxingPageType({ pathname = '' } = /** @type {any} */ ({})) {
  const normalizedPath = normalizePathname(pathname);
  if (normalizedPath === '/' || normalizedPath === '/top') {
    return 'home';
  }
  if (
    normalizedPath === '/shop_search'
    || normalizedPath.startsWith('/shop_search/sn/')
    || normalizedPath === '/shop/search.html'
    || /^\/shop\/sr\/\d+\.html$/u.test(normalizedPath)
    || normalizedPath.startsWith('/shop/src/page/')
  ) {
    return 'search-results-page';
  }
  if (/^\/shop\/pid\/\d+\.html$/u.test(normalizedPath)) {
    return 'book-detail-page';
  }
  if (
    /^\/actress\/pd\/act\d+\.html$/u.test(normalizedPath)
    || /^\/shop\/ac\/act\d+\.html$/u.test(normalizedPath)
  ) {
    return 'author-page';
  }
  if (
    normalizedPath === '/actress'
    || normalizedPath.startsWith('/actress/pos/')
    || normalizedPath.startsWith('/actress/sc/')
  ) {
    return 'author-list-page';
  }
  if (
    normalizedPath === '/shop'
    || normalizedPath === '/shop/now_release.html'
    || normalizedPath === '/shop/reserve.html'
    || /^\/shop\/reserve\/page\d+\.html$/u.test(normalizedPath)
    || normalizedPath.startsWith('/shop/la/')
    || normalizedPath.startsWith('/shop/mk/')
  ) {
    return 'category-page';
  }
  if (normalizedPath === '/shop/remainder.html') {
    return 'utility-page';
  }
  if (normalizedPath === '/shop/login.html' || normalizedPath === '/shop/usr_entry.html') {
    return 'auth-page';
  }
  if (
    normalizedPath === '/contact'
    || normalizedPath === '/customer'
    || normalizedPath.startsWith('/customer/')
    || normalizedPath === '/event'
    || /^\/event\/\d{4}-\d{2}\.html$/u.test(normalizedPath)
    || normalizedPath === '/link'
  ) {
    return 'utility-page';
  }
  return null;
}

export function isMaxingApiCandidate(candidate = /** @type {any} */ ({})) {
  const siteKey = String(candidate?.siteKey ?? '').trim();
  const method = candidateMethod(candidate);
  const { host, pathname } = endpointParts(candidate);
  return siteKey === 'maxing'
    && isMaxingHost(host)
    && isReadOnlyMethod(method)
    && isMaxingApiPath(pathname);
}

export const maxingAdapter = createCatalogAdapter({
  id: 'maxing',
  hosts: MAXING_HOSTS,
  terminology: MAXING_TERMINOLOGY,
  intentLabels: MAXING_INTENT_LABELS,
  inferPageType: inferMaxingPageType,
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  validateApiCandidate({
    candidate,
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    validatedAt,
  } = /** @type {any} */ ({})) {
    const { host, pathname } = endpointParts(candidate);
    const method = candidateMethod(candidate);
    const accepted = isMaxingApiCandidate(candidate);
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 'maxing',
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 'maxing-api-candidate',
        endpointHost: host,
        endpointPath: pathname,
        endpointMethod: method,
        acceptedMethods: ['GET', 'HEAD'],
        rejectsHtmlCatalogSurfaces: true,
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
    const method = candidateMethod(candidate);
    const accepted = siteAdapterDecision?.decision === 'accepted' && isMaxingApiCandidate(candidate);
    return normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'maxing',
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 'maxing-api',
        endpointHost: host,
        endpointPath: pathname,
        endpointMethod: method,
        acceptedMethods: ['GET', 'HEAD'],
        rejectsHtmlCatalogSurfaces: true,
        ...scope,
      },
      evidence,
    }, {
      candidate,
      siteAdapterDecision,
    });
  },
});
