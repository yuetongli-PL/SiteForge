// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { createCatalogAdapter } from './factory.mjs';
import { endpointParts, parseUrl } from './url-parts.mjs';

export const DAHLIA_HOSTS = Object.freeze([
  'dahlia-av.jp',
  'www.dahlia-av.jp',
]);

export const DAHLIA_TERMINOLOGY = Object.freeze({
  entityLabel: 'work',
  entityPlural: 'works',
  personLabel: 'actress',
  personPlural: 'actresses',
  searchLabel: 'search works',
  openEntityLabel: 'open work',
  openPersonLabel: 'open actress page',
  downloadLabel: 'download work',
  verifiedTaskLabel: 'work / actress / news',
});

export const DAHLIA_INTENT_LABELS = Object.freeze({
  'search-work': 'search works',
  'search-book': 'search works',
  'search-content': 'search works',
  'open-work': 'open work',
  'open-book': 'open work',
  'open-actress': 'open actress page',
  'open-author': 'open actress page',
  'open-category': 'open catalog page',
  'open-utility-page': 'open utility page',
});

const DAHLIA_REST_CATALOG_SEGMENTS = Object.freeze([
  'actress',
  'actresses',
  'categories',
  'news',
  'pages',
  'posts',
  'search',
  'tags',
  'work',
  'works',
]);

const BLOCKED_REST_SEGMENTS = Object.freeze([
  'cart',
  'comments',
  'contact',
  'contact-form-7',
  'login',
  'media',
  'orders',
  'payment',
  'settings',
  'users',
]);

const WRITE_LIKE_API_SEGMENTS = Object.freeze([
  'auth',
  'cart',
  'checkout',
  'comment',
  'create',
  'delete',
  'favorite',
  'follow',
  'login',
  'logout',
  'order',
  'payment',
  'purchase',
  'register',
  'review',
  'signin',
  'signup',
  'update',
  'upload',
]);

function normalizePathname(pathname) {
  const input = String(pathname ?? '').trim() || '/';
  const normalized = input.startsWith('/') ? input : `/${input}`;
  return normalized.replace(/\/{2,}/gu, '/').replace(/\/+$/u, '') || '/';
}

function candidateMethod(candidate = /** @type {any} */ ({})) {
  return String(candidate?.endpoint?.method ?? candidate?.method ?? 'GET').trim().toUpperCase();
}

function isReadOnlyCandidateMethod(candidate = /** @type {any} */ ({})) {
  return ['GET', 'HEAD'].includes(candidateMethod(candidate));
}

function isDahliaHost(host) {
  return DAHLIA_HOSTS.includes(String(host ?? '').toLowerCase());
}

function normalizedEndpointRoute(candidate = /** @type {any} */ ({})) {
  const parsed = parseUrl(candidate?.endpoint?.url ?? candidate?.url);
  const pathname = normalizePathname(parsed?.pathname ?? '');
  const restRoute = parsed?.searchParams?.get('rest_route');
  if (restRoute) {
    return normalizePathname(restRoute).toLowerCase();
  }
  return pathname.toLowerCase();
}

function hasDahliaRestApiSurface(candidate = /** @type {any} */ ({})) {
  const parsed = parseUrl(candidate?.endpoint?.url ?? candidate?.url);
  const pathname = normalizePathname(parsed?.pathname ?? '').toLowerCase();
  return pathname.startsWith('/wp-json/')
    || Boolean(parsed?.searchParams?.get('rest_route'));
}

function routeSegments(route) {
  return normalizePathname(route)
    .toLowerCase()
    .split('/')
    .filter(Boolean);
}

function pathHasAnySegment(route, segmentSet) {
  const segments = routeSegments(route);
  return segments.some((segment) => segmentSet.includes(segment));
}

function isDahliaRestCatalogRoute(route) {
  const normalizedRoute = normalizePathname(route).toLowerCase();
  const restPath = normalizedRoute.startsWith('/wp-json/')
    ? normalizePathname(normalizedRoute.slice('/wp-json'.length))
    : normalizedRoute;
  const segments = routeSegments(restPath);
  if (segments.length < 2) {
    return false;
  }
  if (pathHasAnySegment(restPath, BLOCKED_REST_SEGMENTS)) {
    return false;
  }
  if (pathHasAnySegment(restPath, WRITE_LIKE_API_SEGMENTS)) {
    return false;
  }
  return segments.some((segment) => DAHLIA_REST_CATALOG_SEGMENTS.includes(segment));
}

function dahliaApiKind(route) {
  const segments = routeSegments(route);
  const matched = segments.find((segment) => DAHLIA_REST_CATALOG_SEGMENTS.includes(segment));
  return matched ?? 'catalog';
}

export function inferDahliaPageType({ pathname = '', inputUrl = '' } = /** @type {any} */ ({})) {
  const parsed = parseUrl(inputUrl);
  const normalizedPath = normalizePathname(pathname || parsed?.pathname || '/').toLowerCase();
  if (normalizedPath === '/' && parsed?.searchParams?.has('s')) {
    return 'search-results-page';
  }
  if (parsed?.searchParams?.has('s')) {
    return 'search-results-page';
  }
  if (normalizedPath === '/') {
    return 'home';
  }
  if (normalizedPath === '/work' || /^\/work\/page\/\d+(?:\/|$)/u.test(normalizedPath)) {
    return 'category-page';
  }
  if (/^\/works\/[^/]+(?:\/|$)/u.test(normalizedPath)) {
    return 'book-detail-page';
  }
  if (normalizedPath === '/actress') {
    return 'author-list-page';
  }
  if (/^\/actress\/[^/]+(?:\/|$)/u.test(normalizedPath)) {
    return 'author-page';
  }
  if (normalizedPath === '/news') {
    return 'category-page';
  }
  if (/^\/news\/[^/]+(?:\/|$)/u.test(normalizedPath)) {
    return 'content-detail-page';
  }
  if (
    normalizedPath === '/about'
    || normalizedPath === '/privacy-policy'
    || normalizedPath === '/contact'
    || normalizedPath === '/recruit'
  ) {
    return 'utility-page';
  }
  return null;
}

export function isDahliaApiCandidate(candidate = /** @type {any} */ ({})) {
  const siteKey = String(candidate?.siteKey ?? '').trim();
  const { host } = endpointParts(candidate);
  const route = normalizedEndpointRoute(candidate);
  return siteKey === 'dahlia'
    && isReadOnlyCandidateMethod(candidate)
    && isDahliaHost(host)
    && hasDahliaRestApiSurface(candidate)
    && isDahliaRestCatalogRoute(route);
}

export const dahliaAdapter = createCatalogAdapter({
  id: 'dahlia',
  hosts: DAHLIA_HOSTS,
  terminology: DAHLIA_TERMINOLOGY,
  intentLabels: DAHLIA_INTENT_LABELS,
  inferPageType: inferDahliaPageType,
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  validateApiCandidate({
    candidate,
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    validatedAt,
  } = /** @type {any} */ ({})) {
    const { host, pathname } = endpointParts(candidate);
    const route = normalizedEndpointRoute(candidate);
    const method = candidateMethod(candidate);
    const accepted = isDahliaApiCandidate(candidate);
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 'dahlia',
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 'dahlia-api-candidate',
        endpointHost: host,
        endpointPath: pathname,
        endpointMethod: method,
        apiKind: dahliaApiKind(route),
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
    const route = normalizedEndpointRoute(candidate);
    const method = candidateMethod(candidate);
    const accepted = siteAdapterDecision?.decision === 'accepted' && isDahliaApiCandidate(candidate);
    return normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'dahlia',
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 'dahlia-api',
        endpointHost: host,
        endpointPath: pathname,
        endpointMethod: method,
        apiKind: dahliaApiKind(route),
        ...scope,
      },
      evidence,
    }, {
      candidate,
      siteAdapterDecision,
    });
  },
});
