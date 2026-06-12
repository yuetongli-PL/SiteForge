// @ts-check

import { cleanText, hostFromUrl } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { createCatalogAdapter } from './factory.mjs';
import { endpointParts, parseUrl } from './url-parts.mjs';

export const ONE_TWO_THREE_AV_HOSTS = Object.freeze([
  '123av.com',
  'www.123av.com',
]);

export const ONE_TWO_THREE_AV_TERMINOLOGY = Object.freeze({
  entityLabel: '\u5f71\u7247',
  entityPlural: '\u5f71\u7247',
  personLabel: '\u6f14\u5458',
  personPlural: '\u6f14\u5458',
  searchLabel: '\u641c\u7d22\u5f71\u7247',
  openEntityLabel: '\u6253\u5f00\u5f71\u7247',
  openPersonLabel: '\u6253\u5f00\u6f14\u5458\u9875',
  downloadLabel: '\u4e0b\u8f7d\u5df2\u7981\u7528',
  verifiedTaskLabel: '\u5f71\u7247 / \u6f14\u5458 / \u76ee\u5f55',
});

export const ONE_TWO_THREE_AV_INTENT_LABELS = Object.freeze({
  'search-video': '\u641c\u7d22\u5f71\u7247',
  'search-content': '\u641c\u7d22\u5f71\u7247',
  'search-book': '\u641c\u7d22\u5f71\u7247',
  'open-video': '\u6253\u5f00\u5f71\u7247',
  'open-book': '\u6253\u5f00\u5f71\u7247',
  'open-actress': '\u6253\u5f00\u6f14\u5458\u9875',
  'open-author': '\u6253\u5f00\u6f14\u5458\u9875',
  'open-category': '\u6253\u5f00\u76ee\u5f55\u9875',
  'list-category-videos': '\u67e5\u770b\u76ee\u5f55\u5217\u8868',
  'open-utility-page': '\u6253\u5f00\u5408\u89c4\u9875',
});

const LOCALE_SEGMENTS = new Set([
  'de',
  'en',
  'fil',
  'fr',
  'hi',
  'id',
  'ja',
  'ko',
  'ms',
  'th',
  'vi',
  'zh',
]);

const CATALOG_ROOT_SEGMENTS = new Set([
  'dm9',
  'jable',
  'javguru',
  'supjav',
]);

const CATEGORY_ROOT_SEGMENTS = new Set([
  'genres',
  'makers',
  'series',
  'tags',
]);

const SORT_SEGMENTS = new Set([
  'censored',
  'monthly-hot',
  'new-release',
  'recent-update',
  'today-hot',
  'trending',
  'uncensored',
  'weekly-hot',
]);

const UTILITY_SEGMENTS = new Set([
  '2257',
  'abuse',
  'contact',
  'privacy',
  'terms',
]);

function resolveHost(input = /** @type {any} */ ({})) {
  return String(
    input.host
      ?? input.siteContext?.host
      ?? input.profile?.host
      ?? hostFromUrl(input.candidateUrl)
      ?? hostFromUrl(input.inputUrl)
      ?? ''
  ).toLowerCase();
}

function decodeSegment(segment) {
  try {
    return decodeURIComponent(String(segment ?? ''));
  } catch {
    return String(segment ?? '');
  }
}

function normalizePathname(pathname, inputUrl = '') {
  const parsed = parseUrl(inputUrl);
  const raw = String(pathname ?? parsed?.pathname ?? '').trim() || '/';
  const prefixed = raw.startsWith('/') ? raw : `/${raw}`;
  const collapsed = prefixed.replace(/\/{2,}/gu, '/');
  return (collapsed.length > 1 ? collapsed.replace(/\/+$/u, '') : collapsed).toLowerCase();
}

function normalizedSegments(pathname, inputUrl = '') {
  return normalizePathname(pathname, inputUrl)
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeSegment(segment).toLowerCase());
}

function stripLocale(segments) {
  return LOCALE_SEGMENTS.has(segments[0]) ? segments.slice(1) : segments;
}

function hasSearchQuery(inputUrl = '') {
  const parsed = parseUrl(inputUrl);
  if (!parsed) {
    return false;
  }
  return ['q', 'keyword', 'search', 'search_query'].some((param) => parsed.searchParams.has(param));
}

function candidateMethod(candidate = /** @type {any} */ ({})) {
  return String(candidate?.endpoint?.method ?? candidate?.method ?? 'GET').trim().toUpperCase() || 'GET';
}

export function inferOneTwoThreeAvPageType({
  pathname = '',
  inputUrl = '',
} = /** @type {any} */ ({})) {
  const allSegments = normalizedSegments(pathname, inputUrl);
  const segments = stripLocale(allSegments);
  const first = segments[0] ?? '';
  const second = segments[1] ?? '';

  if (segments.length === 0) {
    return 'home';
  }
  if (first === 'search' || hasSearchQuery(inputUrl)) {
    return 'search-results-page';
  }
  if (UTILITY_SEGMENTS.has(first)) {
    return 'utility-page';
  }
  if (first === 'actresses' && segments.length === 1) {
    return 'author-list-page';
  }
  if (first === 'actresses' && segments.length > 1) {
    return 'author-page';
  }
  if (['actress', 'actor', 'model', 'models'].includes(first) && segments.length > 1) {
    return 'author-page';
  }
  if (first === 'v' && segments.length > 1) {
    return 'book-detail-page';
  }
  if (
    CATEGORY_ROOT_SEGMENTS.has(first)
    || CATALOG_ROOT_SEGMENTS.has(first)
    || SORT_SEGMENTS.has(first)
    || SORT_SEGMENTS.has(second)
  ) {
    return 'category-page';
  }
  return null;
}

export function normalizeOneTwoThreeAvDisplayLabel({
  value,
  url,
  pageType,
  inputUrl = '',
} = /** @type {any} */ ({})) {
  const parsed = parseUrl(url ?? inputUrl);
  const segments = stripLocale(normalizedSegments(parsed?.pathname ?? '', parsed?.toString() ?? inputUrl));
  const first = segments[0] ?? '';
  const second = segments[1] ?? '';
  const resolvedPageType = pageType ?? inferOneTwoThreeAvPageType({
    pathname: parsed?.pathname ?? '',
    inputUrl: parsed?.toString() ?? inputUrl,
  });

  if (resolvedPageType === 'home') {
    return '123av';
  }
  if (resolvedPageType === 'search-results-page') {
    return '\u641c\u7d22\u7ed3\u679c';
  }
  if (resolvedPageType === 'book-detail-page') {
    return '\u5f71\u7247\u8be6\u60c5';
  }
  if (resolvedPageType === 'author-list-page') {
    return '\u6f14\u5458\u5217\u8868';
  }
  if (resolvedPageType === 'author-page') {
    return '\u6f14\u5458\u9875';
  }
  if (resolvedPageType === 'utility-page') {
    return '\u5408\u89c4\u9875';
  }
  if (resolvedPageType === 'category-page') {
    if (first === 'tags') {
      return '\u6807\u7b7e\u76ee\u5f55';
    }
    if (first === 'genres') {
      return '\u7c7b\u578b\u76ee\u5f55';
    }
    if (first === 'makers') {
      return '\u5236\u4f5c\u65b9\u76ee\u5f55';
    }
    if (first === 'series') {
      return '\u7cfb\u5217\u76ee\u5f55';
    }
    if (SORT_SEGMENTS.has(first) || SORT_SEGMENTS.has(second)) {
      return '\u6392\u5e8f\u76ee\u5f55';
    }
    return '\u76ee\u5f55\u9875';
  }
  return cleanText(value);
}

export function validateOneTwoThreeAvApiCandidate({
  candidate,
  evidence = /** @type {any} */ ({}),
  scope = /** @type {any} */ ({}),
  validatedAt,
} = /** @type {any} */ ({})) {
  const { host, pathname } = endpointParts(candidate);
  return normalizeSiteAdapterCandidateDecision({
    adapterId: '123av',
    decision: 'rejected',
    reasonCode: 'api-verification-failed',
    validatedAt,
    scope: {
      validationMode: '123av-no-observed-public-api',
      endpointHost: host,
      endpointPath: pathname,
      endpointMethod: candidateMethod(candidate),
      publicApiObserved: false,
      ...scope,
    },
    evidence,
  }, { candidate });
}

export function getOneTwoThreeAvApiCatalogUpgradePolicy({
  candidate,
  siteAdapterDecision,
  evidence = /** @type {any} */ ({}),
  scope = /** @type {any} */ ({}),
  decidedAt,
} = /** @type {any} */ ({})) {
  const { host, pathname } = endpointParts(candidate);
  return normalizeSiteAdapterCatalogUpgradePolicy({
    adapterId: '123av',
    allowCatalogUpgrade: false,
    reasonCode: 'api-catalog-entry-blocked',
    decidedAt,
    scope: {
      policyMode: '123av-no-observed-public-api',
      endpointHost: host,
      endpointPath: pathname,
      endpointMethod: candidateMethod(candidate),
      publicApiObserved: false,
      ...scope,
    },
    evidence,
  }, {
    candidate,
    siteAdapterDecision,
  });
}

export const oneTwoThreeAvAdapter = createCatalogAdapter({
  id: '123av',
  hosts: ONE_TWO_THREE_AV_HOSTS,
  terminology: ONE_TWO_THREE_AV_TERMINOLOGY,
  intentLabels: ONE_TWO_THREE_AV_INTENT_LABELS,
  matches({ host, profile, inputUrl } = /** @type {any} */ ({})) {
    return ONE_TWO_THREE_AV_HOSTS.includes(resolveHost({ host, profile, inputUrl }));
  },
  inferPageType: inferOneTwoThreeAvPageType,
  normalizeDisplayLabel: normalizeOneTwoThreeAvDisplayLabel,
  classifyPath({ pathname = '', inputUrl = '' } = /** @type {any} */ ({})) {
    const pageType = inferOneTwoThreeAvPageType({ pathname, inputUrl });
    return {
      kind: pageType ? '123av-path' : null,
      detail: pageType,
    };
  },
  validateApiCandidate: validateOneTwoThreeAvApiCandidate,
  getApiCatalogUpgradePolicy: getOneTwoThreeAvApiCatalogUpgradePolicy,
});
