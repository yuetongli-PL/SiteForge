// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { createCatalogAdapter } from './factory.mjs';
import { endpointParts } from './url-parts.mjs';

export const DOGMA_HOSTS = Object.freeze([
  'dogma.co.jp',
  'www.dogma.co.jp',
]);

export const DOGMA_TERMINOLOGY = Object.freeze({
  entityLabel: 'work',
  entityPlural: 'works',
  personLabel: 'performer',
  personPlural: 'performers',
  searchLabel: 'search site',
  openEntityLabel: 'open work',
  openPersonLabel: 'open performer page',
  downloadLabel: 'open download page',
  verifiedTaskLabel: 'Dogma catalog / download page',
});

export const DOGMA_INTENT_LABELS = Object.freeze({
  'open-download-page': 'open download page',
  'open-utility-page': 'open utility page',
  'open-category': 'open catalog page',
  'search-content': 'search site',
  'search-work': 'search works',
  'search-book': 'search works',
  'open-work': 'open work',
  'open-book': 'open work',
  'open-actress': 'open performer page',
  'open-author': 'open performer page',
});

const DOGMA_API_PREFIXES = Object.freeze([
  '/api/',
  '/ajax/',
  '/wp-json/',
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

function isDogmaHost(host) {
  return DOGMA_HOSTS.includes(String(host ?? '').trim().toLowerCase());
}

function isDogmaHtmlSurface(pathname) {
  const normalizedPath = normalizePathname(pathname);
  return normalizedPath === '/'
    || normalizedPath === '/13-download'
    || /^\/\d+-download$/u.test(normalizedPath)
    || normalizedPath.endsWith('.html')
    || normalizedPath.endsWith('.php');
}

function isDogmaApiPath(pathname) {
  const normalizedPath = normalizePathname(pathname);
  if (isDogmaHtmlSurface(normalizedPath)) {
    return false;
  }
  return DOGMA_API_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix))
    || normalizedPath.endsWith('.json');
}

export function inferDogmaPageType({ pathname = '' } = /** @type {any} */ ({})) {
  const normalizedPath = normalizePathname(pathname);
  if (normalizedPath === '/') {
    return 'home';
  }
  if (normalizedPath === '/13-download' || /^\/\d+-download$/u.test(normalizedPath)) {
    return 'utility-page';
  }
  if (/search/u.test(normalizedPath)) {
    return 'search-results-page';
  }
  if (/actress|performer|author/u.test(normalizedPath)) {
    return normalizedPath.split('/').filter(Boolean).length > 1 ? 'author-page' : 'author-list-page';
  }
  if (/works?|products?|catalog|category/u.test(normalizedPath)) {
    return 'category-page';
  }
  return null;
}

export function isDogmaApiCandidate(candidate = /** @type {any} */ ({})) {
  const siteKey = String(candidate?.siteKey ?? '').trim();
  const method = candidateMethod(candidate);
  const { host, pathname } = endpointParts(candidate);
  return siteKey === 'dogma'
    && isDogmaHost(host)
    && isReadOnlyMethod(method)
    && isDogmaApiPath(pathname);
}

export const dogmaAdapter = createCatalogAdapter({
  id: 'dogma',
  hosts: DOGMA_HOSTS,
  terminology: DOGMA_TERMINOLOGY,
  intentLabels: DOGMA_INTENT_LABELS,
  inferPageType: inferDogmaPageType,
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  validateApiCandidate({
    candidate,
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    validatedAt,
  } = /** @type {any} */ ({})) {
    const { host, pathname } = endpointParts(candidate);
    const method = candidateMethod(candidate);
    const accepted = isDogmaApiCandidate(candidate);
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 'dogma',
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 'dogma-api-candidate',
        endpointHost: host,
        endpointPath: pathname,
        endpointMethod: method,
        acceptedMethods: ['GET', 'HEAD'],
        rejectsHtmlDownloadSurfaces: true,
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
    const accepted = siteAdapterDecision?.decision === 'accepted' && isDogmaApiCandidate(candidate);
    return normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'dogma',
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 'dogma-api',
        endpointHost: host,
        endpointPath: pathname,
        endpointMethod: method,
        acceptedMethods: ['GET', 'HEAD'],
        rejectsHtmlDownloadSurfaces: true,
        ...scope,
      },
      evidence,
    }, {
      candidate,
      siteAdapterDecision,
    });
  },
});
