// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { createCatalogAdapter } from './factory.mjs';
import { endpointParts, parseUrl } from './url-parts.mjs';

export const S1_HOSTS = Object.freeze([
  's1s1s1.com',
  'www.s1s1s1.com',
]);

export const S1_TERMINOLOGY = Object.freeze({
  entityLabel: 'title',
  entityPlural: 'titles',
  personLabel: 'performer',
  personPlural: 'performers',
  searchLabel: 'search titles',
  openEntityLabel: 'open title',
  openPersonLabel: 'open performer page',
  downloadLabel: 'download title media',
  verifiedTaskLabel: 'title / performer / catalog',
});

export const S1_INTENT_LABELS = Object.freeze({
  'search-work': 'search titles',
  'search-book': 'search titles',
  'search-content': 'search titles',
  'open-work': 'open title',
  'open-book': 'open title',
  'open-video': 'open title',
  'open-actress': 'open performer page',
  'open-author': 'open performer page',
  'open-category': 'open catalog page',
  'open-utility-page': 'open utility page',
  'open-auth-page': 'open blocked or age-gated page',
  'list-category-videos': 'list catalog titles',
});

const S1_SITE_KEYS = Object.freeze([
  's1',
  's1s1s1.com',
  'www.s1s1s1.com',
]);

const S1_API_PATH_PREFIXES = Object.freeze([
  '/api/',
  '/ajax/',
  '/json/',
  '/webapi/',
]);

const S1_HTML_CATALOG_PATHS = Object.freeze([
  '/',
  '/top',
  '/search',
  '/works',
  '/work',
  '/actress',
  '/performer',
  '/genre',
  '/genres',
  '/label',
  '/maker',
  '/series',
  '/ranking',
  '/newrelease',
  '/newreleases',
]);

const S1_MEDIA_OR_ASSET_PATH_PATTERN = /\.(?:avif|css|eot|gif|ico|jpe?g|js|m3u8|mov|mp4|png|svg|ts|ttf|webm|webp|woff2?)$/iu;

function normalizePathname(pathname) {
  const normalized = String(pathname || '/').trim().replace(/\/{2,}/gu, '/').replace(/\/+$/u, '').toLowerCase();
  return normalized || '/';
}

function requestMethod(candidate = /** @type {any} */ ({})) {
  return String(candidate?.endpoint?.method ?? candidate?.method ?? 'GET').trim().toUpperCase() || 'GET';
}

function isReadOnlyMethod(method) {
  return method === 'GET' || method === 'HEAD';
}

function siteKeyMatches(candidate = /** @type {any} */ ({})) {
  return S1_SITE_KEYS.includes(String(candidate?.siteKey ?? '').trim().toLowerCase());
}

function headerValue(candidate = /** @type {any} */ ({}), name) {
  const headers = {
    ...(candidate?.headers ?? {}),
    ...(candidate?.request?.headers ?? {}),
  };
  const normalizedName = String(name ?? '').toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === normalizedName) {
      return String(value ?? '');
    }
  }
  return '';
}

function responseContentTypes(candidate = /** @type {any} */ ({}), evidence = /** @type {any} */ ({})) {
  return [
    candidate?.response?.contentType,
    candidate?.responseEvidence?.contentType,
    candidate?.runtime?.responseEvidence?.contentType,
    candidate?.evidence?.responseEvidence?.contentType,
    evidence?.response?.contentType,
    evidence?.responseEvidence?.contentType,
  ].map((value) => String(value ?? '').toLowerCase()).filter(Boolean);
}

function hasJsonLikeSignal(candidate = /** @type {any} */ ({}), evidence = /** @type {any} */ ({})) {
  if (responseContentTypes(candidate, evidence).some((type) => /(?:application|text)\/(?:[^;\s+]+\+)?json\b|graphql/iu.test(type))) {
    return true;
  }
  const accept = headerValue(candidate, 'accept').toLowerCase();
  const requestedWith = headerValue(candidate, 'x-requested-with').toLowerCase();
  return accept.includes('application/json') || requestedWith === 'xmlhttprequest';
}

function hasHtmlResponseSignal(candidate = /** @type {any} */ ({}), evidence = /** @type {any} */ ({})) {
  return responseContentTypes(candidate, evidence).some((type) => /text\/html\b/iu.test(type));
}

function hasS1ApiPathSignal(pathname, candidate = /** @type {any} */ ({})) {
  const normalizedPath = normalizePathname(pathname);
  if (S1_API_PATH_PREFIXES.some((prefix) => normalizedPath === prefix.slice(0, -1) || normalizedPath.startsWith(prefix))) {
    return true;
  }
  if (/(?:^|[/_.-])(?:api|ajax|json|xhr)(?:$|[/_.-])/iu.test(normalizedPath)) {
    return true;
  }
  if (/\.json$/iu.test(normalizedPath)) {
    return true;
  }
  const parsed = parseUrl(candidate?.endpoint?.url ?? candidate?.url);
  return parsed?.searchParams.get('format') === 'json'
    || parsed?.searchParams.get('output') === 'json'
    || parsed?.searchParams.get('response') === 'json';
}

function isS1HtmlCatalogPath(pathname) {
  const normalizedPath = normalizePathname(pathname);
  return S1_HTML_CATALOG_PATHS.some((path) => normalizedPath === path || normalizedPath.startsWith(`${path}/`));
}

export function inferS1PageType({ pathname = '' } = /** @type {any} */ ({})) {
  const normalizedPath = normalizePathname(pathname);
  if (normalizedPath === '/') {
    return 'home';
  }
  if (normalizedPath === '/top') {
    return 'category-page';
  }
  if (normalizedPath.startsWith('/login') || normalizedPath.startsWith('/age') || normalizedPath.startsWith('/verify')) {
    return 'auth-page';
  }
  if (normalizedPath.startsWith('/search')) {
    return 'search-results-page';
  }
  if (normalizedPath.startsWith('/genre') || normalizedPath.startsWith('/label') || normalizedPath.startsWith('/maker') || normalizedPath.startsWith('/series') || normalizedPath.startsWith('/ranking') || normalizedPath.startsWith('/newrelease')) {
    return 'category-page';
  }
  if (
    normalizedPath === '/works'
    || normalizedPath === '/works/genre'
    || normalizedPath === '/works/series'
    || normalizedPath === '/works/date'
    || normalizedPath.startsWith('/works/list/')
    || normalizedPath === '/work'
    || normalizedPath === '/work/genre'
    || normalizedPath === '/work/series'
    || normalizedPath === '/work/date'
    || normalizedPath.startsWith('/work/list/')
  ) {
    return 'category-page';
  }
  if (normalizedPath === '/actress' || normalizedPath === '/performer') {
    return 'author-list-page';
  }
  if (normalizedPath.startsWith('/actress/') || normalizedPath.startsWith('/performer/')) {
    return 'author-page';
  }
  if (/(?:^|\/)(?:work|works|product|products|detail)(?:\/|$)/u.test(normalizedPath)) {
    return 'book-detail-page';
  }
  if (hasS1ApiPathSignal(normalizedPath)) {
    return 'utility-page';
  }
  return null;
}

export function isS1ApiCandidate(candidate = /** @type {any} */ ({}), evidence = /** @type {any} */ ({})) {
  const method = requestMethod(candidate);
  const { host, pathname } = endpointParts(candidate);
  const normalizedPath = normalizePathname(pathname);
  if (!siteKeyMatches(candidate) || !S1_HOSTS.includes(host) || !isReadOnlyMethod(method)) {
    return false;
  }
  if (S1_MEDIA_OR_ASSET_PATH_PATTERN.test(normalizedPath)) {
    return false;
  }
  if (hasHtmlResponseSignal(candidate, evidence) && !hasJsonLikeSignal(candidate, evidence)) {
    return false;
  }
  return hasS1ApiPathSignal(normalizedPath, candidate)
    && (!isS1HtmlCatalogPath(normalizedPath) || hasJsonLikeSignal(candidate, evidence) || /\.json$/iu.test(normalizedPath));
}

export const s1Adapter = createCatalogAdapter({
  id: 's1',
  hosts: S1_HOSTS,
  terminology: S1_TERMINOLOGY,
  intentLabels: S1_INTENT_LABELS,
  inferPageType: inferS1PageType,
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  validateApiCandidate({
    candidate,
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    validatedAt,
  } = /** @type {any} */ ({})) {
    const method = requestMethod(candidate);
    const { host, pathname } = endpointParts(candidate);
    const accepted = isS1ApiCandidate(candidate, evidence);
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 's1',
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 's1-readonly-api-candidate',
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
    const method = requestMethod(candidate);
    const { host, pathname } = endpointParts(candidate);
    const accepted = siteAdapterDecision?.decision === 'accepted' && isS1ApiCandidate(candidate, evidence);
    return normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 's1',
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 's1-readonly-api',
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
