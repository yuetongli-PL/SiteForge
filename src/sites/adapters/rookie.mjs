// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { createCatalogAdapter } from './factory.mjs';
import { endpointParts } from './url-parts.mjs';

export const ROOKIE_HOSTS = Object.freeze([
  'rookie-av.jp',
  'www.rookie-av.jp',
]);

export const ROOKIE_TERMINOLOGY = Object.freeze({
  entityLabel: 'work',
  entityPlural: 'works',
  personLabel: 'actress',
  personPlural: 'actresses',
  searchLabel: 'search works',
  openEntityLabel: 'open work',
  openPersonLabel: 'open actress page',
  downloadLabel: 'download work media',
  verifiedTaskLabel: 'work / actress catalog',
});

export const ROOKIE_INTENT_LABELS = Object.freeze({
  'browse-category': 'browse ROOKIE category',
  'browse-ranking': 'browse ROOKIE ranking',
  'open-category': 'open ROOKIE category',
  'open-detail-page': 'open ROOKIE detail page',
  'open-work': 'open ROOKIE work',
  'open-work-or-list-work': 'open or list ROOKIE works',
  'open-book': 'open ROOKIE work',
  'open-actress': 'open ROOKIE actress page',
  'open-author': 'open ROOKIE actress page',
  'search-content': 'search ROOKIE works',
  'search-work': 'search ROOKIE works',
  'search-book': 'search ROOKIE works',
});

const ROOKIE_SITE_KEY = 'rookie';
const READ_ONLY_METHODS = new Set(['GET', 'HEAD']);
const ROOKIE_API_PATH_PATTERN = /(?:^\/(?:api|ajax|xhr|json)(?:\/|$)|\/(?:api|ajax|xhr)\/|\.json$)/iu;
const ROOKIE_HTML_CATALOG_PATH_PATTERN = /^\/(?:works|actress|search|top|sitemap|link|help|privacy|recruit)(?:\/|$)/iu;
const ROOKIE_MEDIA_PATH_PATTERN = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp|mp4|m4v|mov|webm|m3u8|mpd|mp3|aac|wav|ogg|flac|woff2?|ttf|otf|eot|pdf)(?:$|[?#])/iu;

function normalizePathname(pathname) {
  const raw = String(pathname ?? '').trim() || '/';
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const collapsed = withSlash.replace(/\/{2,}/gu, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/+$/u, '') : collapsed;
}

function candidateMethod(candidate = /** @type {any} */ ({})) {
  return String(candidate?.endpoint?.method ?? candidate?.method ?? 'GET').trim().toUpperCase() || 'GET';
}

function contentTypeValue(candidate = /** @type {any} */ ({}), evidence = /** @type {any} */ ({})) {
  return String(
    candidate?.evidence?.contentType
      ?? candidate?.response?.contentType
      ?? candidate?.responseSummary?.contentType
      ?? evidence?.contentType
      ?? evidence?.response?.contentType
      ?? evidence?.responseSummary?.contentType
      ?? ''
  ).trim().toLowerCase();
}

function isRookieHost(host) {
  return ROOKIE_HOSTS.includes(String(host ?? '').trim().toLowerCase());
}

function siteKeyMatchesRookie(candidate = /** @type {any} */ ({})) {
  return String(candidate?.siteKey ?? '').trim() === ROOKIE_SITE_KEY;
}

function endpointLooksApi(pathname, candidate, evidence) {
  const path = normalizePathname(pathname);
  const contentType = contentTypeValue(candidate, evidence);
  if (!path || ROOKIE_MEDIA_PATH_PATTERN.test(path)) {
    return false;
  }
  if (contentType.includes('html')) {
    return false;
  }
  if (ROOKIE_HTML_CATALOG_PATH_PATTERN.test(path) && !ROOKIE_API_PATH_PATTERN.test(path)) {
    return false;
  }
  return ROOKIE_API_PATH_PATTERN.test(path) || contentType.includes('json');
}

export function inferRookiePageType({ pathname = '' } = /** @type {any} */ ({})) {
  const path = normalizePathname(pathname).toLowerCase();
  if (path === '/' || path === '/top') {
    return 'home';
  }
  if (path === '/search' || path.startsWith('/search/')) {
    return 'search-results-page';
  }
  if (/^\/works\/detail\/[a-z0-9-]+$/iu.test(path)) {
    return 'book-detail-page';
  }
  if (/^\/actress\/detail\/\d+$/u.test(path)) {
    return 'author-page';
  }
  if (path === '/actress' || /^\/actress\/[^/]+$/u.test(path)) {
    return 'author-list-page';
  }
  if (
    path === '/works/genre'
    || path === '/works/series'
    || path === '/works/date'
    || /^\/works\/list\/(?:release|reserve|genre|series|date)\/?[^/]*$/u.test(path)
  ) {
    return 'category-page';
  }
  if (
    path === '/recruit'
    || path.startsWith('/recruit/')
    || path === '/sitemap'
    || path === '/link'
    || path === '/help'
    || path === '/privacy'
  ) {
    return 'utility-page';
  }
  return null;
}

export function isRookieApiCandidate(candidate = /** @type {any} */ ({}), evidence = /** @type {any} */ ({})) {
  const method = candidateMethod(candidate);
  const { host, pathname } = endpointParts(candidate);
  return siteKeyMatchesRookie(candidate)
    && isRookieHost(host)
    && READ_ONLY_METHODS.has(method)
    && endpointLooksApi(pathname, candidate, evidence);
}

export function validateRookieApiCandidate({
  candidate,
  evidence = /** @type {any} */ ({}),
  scope = /** @type {any} */ ({}),
  validatedAt,
} = /** @type {any} */ ({})) {
  const { host, pathname } = endpointParts(candidate);
  const method = candidateMethod(candidate);
  const accepted = isRookieApiCandidate(candidate, evidence);
  return normalizeSiteAdapterCandidateDecision({
    adapterId: 'rookie',
    decision: accepted ? 'accepted' : 'rejected',
    reasonCode: accepted ? undefined : 'api-verification-failed',
    validatedAt,
    scope: {
      validationMode: 'rookie-api-candidate',
      endpointHost: host,
      endpointPath: pathname,
      endpointMethod: method,
      ...scope,
    },
    evidence,
  }, { candidate });
}

export function getRookieApiCatalogUpgradePolicy({
  candidate,
  siteAdapterDecision,
  evidence = /** @type {any} */ ({}),
  scope = /** @type {any} */ ({}),
  decidedAt,
} = /** @type {any} */ ({})) {
  const { host, pathname } = endpointParts(candidate);
  const method = candidateMethod(candidate);
  const accepted = siteAdapterDecision?.decision === 'accepted'
    && isRookieApiCandidate(candidate, evidence);
  return normalizeSiteAdapterCatalogUpgradePolicy({
    adapterId: 'rookie',
    allowCatalogUpgrade: accepted,
    reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
    decidedAt,
    scope: {
      policyMode: 'rookie-api',
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
}

export const rookieAdapter = createCatalogAdapter({
  id: 'rookie',
  hosts: ROOKIE_HOSTS,
  terminology: ROOKIE_TERMINOLOGY,
  intentLabels: ROOKIE_INTENT_LABELS,
  inferPageType: inferRookiePageType,
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  validateApiCandidate: validateRookieApiCandidate,
  getApiCatalogUpgradePolicy: getRookieApiCatalogUpgradePolicy,
});
