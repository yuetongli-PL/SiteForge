// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { createCatalogAdapter } from './factory.mjs';
import { endpointParts, parseUrl } from './url-parts.mjs';

export const SOD_HOSTS = Object.freeze([
  'www.sod.co.jp',
  'sod.co.jp',
]);

export const SOD_TERMINOLOGY = Object.freeze({
  entityLabel: 'release',
  entityPlural: 'releases',
  personLabel: 'performer',
  personPlural: 'performers',
  searchLabel: 'search releases',
  openEntityLabel: 'open release',
  openPersonLabel: 'open performer page',
  downloadLabel: 'download release media',
  verifiedTaskLabel: 'release / performer / catalog',
});

export const SOD_INTENT_LABELS = Object.freeze({
  'search-work': 'search releases',
  'search-book': 'search releases',
  'search-content': 'search releases',
  'open-work': 'open release',
  'open-book': 'open release',
  'open-video': 'open release',
  'open-actress': 'open performer page',
  'open-author': 'open performer page',
  'open-category': 'open catalog page',
  'open-utility-page': 'open utility page',
  'open-auth-page': 'open age check page',
  'list-category-videos': 'list catalog releases',
});

const SOD_SITE_KEYS = Object.freeze([
  'sod',
  'sod.co.jp',
  'www.sod.co.jp',
]);

const SOD_API_PATH_PREFIXES = Object.freeze([
  '/api/',
  '/ajax/',
  '/json/',
  '/webapi/',
]);

const SOD_HTML_CATALOG_PATHS = Object.freeze([
  '/',
  '/agecheck',
  '/newreleases',
  '/newreleases/archive',
  '/search',
  '/actress',
  '/performer',
  '/genre',
  '/genres',
  '/label',
  '/maker',
  '/series',
]);

const SOD_MEDIA_OR_ASSET_PATH_PATTERN = /\.(?:avif|css|eot|gif|ico|jpe?g|js|m3u8|mov|mp4|png|svg|ts|ttf|webm|webp|woff2?)$/iu;

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
  return SOD_SITE_KEYS.includes(String(candidate?.siteKey ?? '').trim().toLowerCase());
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

function hasSodApiPathSignal(pathname, candidate = /** @type {any} */ ({})) {
  const normalizedPath = normalizePathname(pathname);
  if (SOD_API_PATH_PREFIXES.some((prefix) => normalizedPath === prefix.slice(0, -1) || normalizedPath.startsWith(prefix))) {
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

function isSodHtmlCatalogPath(pathname) {
  const normalizedPath = normalizePathname(pathname);
  return SOD_HTML_CATALOG_PATHS.some((path) => normalizedPath === path || normalizedPath.startsWith(`${path}/`));
}

export function inferSodPageType({ pathname = '' } = /** @type {any} */ ({})) {
  const normalizedPath = normalizePathname(pathname);
  if (normalizedPath === '/') {
    return 'home';
  }
  if (normalizedPath.startsWith('/agecheck')) {
    return 'auth-page';
  }
  if (normalizedPath.startsWith('/newreleases') || normalizedPath.startsWith('/genre') || normalizedPath.startsWith('/label') || normalizedPath.startsWith('/maker') || normalizedPath.startsWith('/series')) {
    return 'category-page';
  }
  if (normalizedPath.startsWith('/search')) {
    return 'search-results-page';
  }
  if (normalizedPath === '/actress' || normalizedPath === '/performer') {
    return 'author-list-page';
  }
  if (normalizedPath.startsWith('/actress/') || normalizedPath.startsWith('/performer/')) {
    return 'author-page';
  }
  if (/(?:^|\/)(?:product|products|work|works|detail)(?:\/|$)/u.test(normalizedPath)) {
    return 'book-detail-page';
  }
  if (hasSodApiPathSignal(normalizedPath)) {
    return 'utility-page';
  }
  return null;
}

export function isSodApiCandidate(candidate = /** @type {any} */ ({}), evidence = /** @type {any} */ ({})) {
  const method = requestMethod(candidate);
  const { host, pathname } = endpointParts(candidate);
  const normalizedPath = normalizePathname(pathname);
  if (!siteKeyMatches(candidate) || !SOD_HOSTS.includes(host) || !isReadOnlyMethod(method)) {
    return false;
  }
  if (SOD_MEDIA_OR_ASSET_PATH_PATTERN.test(normalizedPath)) {
    return false;
  }
  if (hasHtmlResponseSignal(candidate, evidence) && !hasJsonLikeSignal(candidate, evidence)) {
    return false;
  }
  return hasSodApiPathSignal(normalizedPath, candidate)
    && (!isSodHtmlCatalogPath(normalizedPath) || hasJsonLikeSignal(candidate, evidence) || /\.json$/iu.test(normalizedPath));
}

export const sodAdapter = createCatalogAdapter({
  id: 'sod',
  hosts: SOD_HOSTS,
  terminology: SOD_TERMINOLOGY,
  intentLabels: SOD_INTENT_LABELS,
  inferPageType: inferSodPageType,
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  validateApiCandidate({
    candidate,
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    validatedAt,
  } = /** @type {any} */ ({})) {
    const method = requestMethod(candidate);
    const { host, pathname } = endpointParts(candidate);
    const accepted = isSodApiCandidate(candidate, evidence);
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 'sod',
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 'sod-readonly-api-candidate',
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
    const accepted = siteAdapterDecision?.decision === 'accepted' && isSodApiCandidate(candidate, evidence);
    return normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'sod',
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 'sod-readonly-api',
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
