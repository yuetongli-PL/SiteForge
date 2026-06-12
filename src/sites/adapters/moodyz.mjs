// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { createCatalogAdapter } from './factory.mjs';
import { endpointParts, parseUrl } from './url-parts.mjs';

export const MOODYZ_HOSTS = Object.freeze([
  'moodyz.com',
  'www.moodyz.com',
]);

export const MOODYZ_TERMINOLOGY = Object.freeze({
  entityLabel: 'work',
  entityPlural: 'works',
  personLabel: 'actress',
  personPlural: 'actresses',
  searchLabel: 'search works',
  openEntityLabel: 'open work',
  openPersonLabel: 'open actress page',
  downloadLabel: 'download disabled',
  verifiedTaskLabel: 'work / actress catalog',
});

export const MOODYZ_INTENT_LABELS = Object.freeze({
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

const WRITE_LIKE_API_SEGMENTS = Object.freeze([
  'account',
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

function pathHasWriteLikeSegment(pathname) {
  const segments = normalizePathname(pathname)
    .toLowerCase()
    .split('/')
    .filter(Boolean);
  return segments.some((segment) => WRITE_LIKE_API_SEGMENTS.includes(segment));
}

function isMoodyzHost(host) {
  return MOODYZ_HOSTS.includes(String(host ?? '').toLowerCase());
}

export function inferMoodyzPageType({ pathname = '', inputUrl = '' } = /** @type {any} */ ({})) {
  const parsedPathname = pathname || parseUrl(inputUrl)?.pathname || '/';
  const normalizedPath = normalizePathname(parsedPathname).toLowerCase();

  if (normalizedPath === '/') {
    return 'home';
  }
  if (normalizedPath === '/search' || normalizedPath.startsWith('/search/')) {
    return 'search-results-page';
  }
  if (normalizedPath === '/works/detail' || normalizedPath.startsWith('/works/detail/')) {
    return 'book-detail-page';
  }
  if (
    normalizedPath === '/works/date'
    || normalizedPath === '/works/genre'
    || normalizedPath === '/works/series'
    || normalizedPath === '/works/label'
    || normalizedPath === '/top'
    || /^\/works\/list\/(?:date\/\d{4}-\d{2}-\d{2}|genre\/[^/]+|series\/[^/]+|label\/[^/]+|release|reserve)(?:\/|$)/u.test(normalizedPath)
  ) {
    return 'category-page';
  }
  if (/^\/actress(?:\/|$)/u.test(normalizedPath)) {
    return 'author-page';
  }
  if (
    normalizedPath === '/sitemap'
    || normalizedPath === '/link'
    || normalizedPath === '/help'
    || normalizedPath === '/privacy'
    || normalizedPath.startsWith('/recruit/')
  ) {
    return 'utility-page';
  }
  return null;
}

export function isMoodyzApiCandidate(candidate = /** @type {any} */ ({})) {
  const siteKey = String(candidate?.siteKey ?? '').trim();
  const { host, pathname } = endpointParts(candidate);
  return siteKey === 'moodyz'
    && isReadOnlyCandidateMethod(candidate)
    && isMoodyzHost(host)
    && (pathname === '/api' || pathname.startsWith('/api/'))
    && !pathHasWriteLikeSegment(pathname);
}

export const moodyzAdapter = createCatalogAdapter({
  id: 'moodyz',
  hosts: MOODYZ_HOSTS,
  terminology: MOODYZ_TERMINOLOGY,
  intentLabels: MOODYZ_INTENT_LABELS,
  inferPageType: inferMoodyzPageType,
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  validateApiCandidate({
    candidate,
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    validatedAt,
  } = /** @type {any} */ ({})) {
    const { host, pathname } = endpointParts(candidate);
    const method = candidateMethod(candidate);
    const accepted = isMoodyzApiCandidate(candidate);
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 'moodyz',
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 'moodyz-api-candidate',
        endpointHost: host,
        endpointPath: pathname,
        endpointMethod: method,
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
    const accepted = siteAdapterDecision?.decision === 'accepted' && isMoodyzApiCandidate(candidate);
    return normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'moodyz',
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 'moodyz-api',
        endpointHost: host,
        endpointPath: pathname,
        endpointMethod: method,
        ...scope,
      },
      evidence,
    }, {
      candidate,
      siteAdapterDecision,
    });
  },
});
