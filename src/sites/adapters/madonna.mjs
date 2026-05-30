// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { createCatalogAdapter } from './factory.mjs';
import { endpointParts } from './url-parts.mjs';

export const MADONNA_HOSTS = Object.freeze([
  'madonna-av.com',
  'www.madonna-av.com',
]);

export const MADONNA_TERMINOLOGY = Object.freeze({
  entityLabel: 'work',
  entityPlural: 'works',
  personLabel: 'actress',
  personPlural: 'actresses',
  searchLabel: 'search Madonna works',
  openEntityLabel: 'open Madonna work',
  openPersonLabel: 'open Madonna actress page',
  downloadLabel: 'download Madonna media',
  verifiedTaskLabel: 'Madonna work / actress catalog',
});

export const MADONNA_INTENT_LABELS = Object.freeze({
  'browse-category': 'browse Madonna category',
  'browse-ranking': 'browse Madonna ranking',
  'open-category': 'open Madonna category',
  'open-detail-page': 'open Madonna detail page',
  'open-work': 'open Madonna work',
  'open-work-or-list-work': 'open or list Madonna works',
  'open-book': 'open Madonna work',
  'open-actress': 'open Madonna actress page',
  'open-author': 'open Madonna actress page',
  'search-content': 'search Madonna works',
  'search-work': 'search Madonna works',
  'search-book': 'search Madonna works',
});

const MADONNA_SITE_KEY = 'madonna';
const READ_ONLY_METHODS = new Set(['GET', 'HEAD']);
const MADONNA_API_PATH_PATTERN = /(?:^\/(?:api|ajax|xhr|json)(?:\/|$)|\/(?:api|ajax|xhr)\/|\.json$)/iu;
const MADONNA_HTML_CATALOG_PATH_PATTERN = /^\/(?:works|actress|search|special|top|sitemap|link|help|privacy)(?:\/|$)/iu;
const MADONNA_MEDIA_PATH_PATTERN = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp|mp4|m4v|mov|webm|m3u8|mpd|mp3|aac|wav|ogg|flac|woff2?|ttf|otf|eot|pdf)(?:$|[?#])/iu;

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

function isMadonnaHost(host) {
  return MADONNA_HOSTS.includes(String(host ?? '').trim().toLowerCase());
}

function siteKeyMatchesMadonna(candidate = /** @type {any} */ ({})) {
  return String(candidate?.siteKey ?? '').trim() === MADONNA_SITE_KEY;
}

function endpointLooksApi(pathname, candidate, evidence) {
  const path = normalizePathname(pathname);
  const contentType = contentTypeValue(candidate, evidence);
  if (!path || MADONNA_MEDIA_PATH_PATTERN.test(path)) {
    return false;
  }
  if (contentType.includes('html')) {
    return false;
  }
  if (MADONNA_HTML_CATALOG_PATH_PATTERN.test(path) && !MADONNA_API_PATH_PATTERN.test(path)) {
    return false;
  }
  return MADONNA_API_PATH_PATTERN.test(path) || contentType.includes('json');
}

export function inferMadonnaPageType({ pathname = '' } = /** @type {any} */ ({})) {
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
    path === '/special'
    || path === '/works/genre'
    || path === '/works/series'
    || path === '/works/label'
    || path === '/works/date'
    || /^\/works\/list\/(?:release|reserve|genre|series|label|date)\/?[^/]*$/u.test(path)
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

export function isMadonnaApiCandidate(candidate = /** @type {any} */ ({}), evidence = /** @type {any} */ ({})) {
  const method = candidateMethod(candidate);
  const { host, pathname } = endpointParts(candidate);
  return siteKeyMatchesMadonna(candidate)
    && isMadonnaHost(host)
    && READ_ONLY_METHODS.has(method)
    && endpointLooksApi(pathname, candidate, evidence);
}

export function validateMadonnaApiCandidate({
  candidate,
  evidence = /** @type {any} */ ({}),
  scope = /** @type {any} */ ({}),
  validatedAt,
} = /** @type {any} */ ({})) {
  const { host, pathname } = endpointParts(candidate);
  const method = candidateMethod(candidate);
  const accepted = isMadonnaApiCandidate(candidate, evidence);
  return normalizeSiteAdapterCandidateDecision({
    adapterId: 'madonna',
    decision: accepted ? 'accepted' : 'rejected',
    reasonCode: accepted ? undefined : 'api-verification-failed',
    validatedAt,
    scope: {
      validationMode: 'madonna-api-candidate',
      endpointHost: host,
      endpointPath: pathname,
      endpointMethod: method,
      ...scope,
    },
    evidence,
  }, { candidate });
}

export function getMadonnaApiCatalogUpgradePolicy({
  candidate,
  siteAdapterDecision,
  evidence = /** @type {any} */ ({}),
  scope = /** @type {any} */ ({}),
  decidedAt,
} = /** @type {any} */ ({})) {
  const { host, pathname } = endpointParts(candidate);
  const method = candidateMethod(candidate);
  const accepted = siteAdapterDecision?.decision === 'accepted'
    && isMadonnaApiCandidate(candidate, evidence);
  return normalizeSiteAdapterCatalogUpgradePolicy({
    adapterId: 'madonna',
    allowCatalogUpgrade: accepted,
    reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
    decidedAt,
    scope: {
      policyMode: 'madonna-api',
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

export const madonnaAdapter = createCatalogAdapter({
  id: 'madonna',
  hosts: MADONNA_HOSTS,
  terminology: MADONNA_TERMINOLOGY,
  intentLabels: MADONNA_INTENT_LABELS,
  inferPageType: inferMadonnaPageType,
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  validateApiCandidate: validateMadonnaApiCandidate,
  getApiCatalogUpgradePolicy: getMadonnaApiCatalogUpgradePolicy,
});
