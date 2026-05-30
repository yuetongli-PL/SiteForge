// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { createCatalogAdapter } from './factory.mjs';
import { endpointParts, parseUrl } from './url-parts.mjs';

const KMP_HOSTS = Object.freeze([
  'www.km-produce.com',
  'km-produce.com',
]);

export const KMP_TERMINOLOGY = Object.freeze({
  entityLabel: 'work',
  entityPlural: 'works',
  personLabel: 'performer',
  personPlural: 'performers',
  searchLabel: 'search works',
  openEntityLabel: 'open work',
  openPersonLabel: 'open performer page',
  downloadLabel: 'download work media',
  verifiedTaskLabel: 'work / label / ranking',
});

const INTENT_LABELS = Object.freeze({
  'browse-category': 'browse category',
  'browse-ranking': 'browse ranking',
  'browse-tag': 'browse tag',
  'open-detail-page': 'open work details',
  'open-work-or-list-work': 'open or list works',
  'search-content': 'search works',
  'search-work': 'search works',
  'open-work': 'open work details',
  'open-category': 'open category page',
  'open-utility-page': 'open utility page',
});

const READ_ONLY_AJAX_ACTION_PATTERN = /^(?:get|list|load|more|search|filter|query|ranking|works?|labels?|tags?|topics?|taxonomy|archive)(?:[_-]|$)/iu;
const MUTATING_AJAX_ACTION_PATTERN = /(?:add|create|delete|edit|insert|login|logout|mail|nonce|order|post|register|remove|save|send|submit|update|upload|write)/iu;
const KMP_REST_CATALOG_SEGMENTS = Object.freeze([
  'categories',
  'labels',
  'pages',
  'posts',
  'search',
  'tags',
  'topics',
  'works',
]);
const KMP_BLOCKED_REST_SEGMENTS = Object.freeze([
  'comments',
  'media',
  'settings',
  'users',
]);

function normalizePathname(pathname = '/') {
  const normalized = String(pathname || '/').trim().replace(/\/+$/u, '').toLowerCase();
  return normalized || '/';
}

function endpointMethod(candidate = /** @type {any} */ ({})) {
  return String(candidate?.endpoint?.method ?? 'GET').trim().toUpperCase();
}

function isReadOnlyMethod(candidate = /** @type {any} */ ({})) {
  return ['GET', 'HEAD'].includes(endpointMethod(candidate));
}

function isWordPressRestRoute(parsed) {
  if (!parsed) {
    return false;
  }
  const pathname = normalizePathname(parsed.pathname);
  const restRoute = String(parsed.searchParams.get('rest_route') ?? '').trim();
  const routePath = restRoute.startsWith('/')
    ? restRoute
    : pathname.startsWith('/wp-json/')
      ? pathname.slice('/wp-json'.length)
      : '';
  const segments = routePath.split('/').filter(Boolean);
  if (segments.some((segment) => KMP_BLOCKED_REST_SEGMENTS.includes(segment))) {
    return false;
  }
  return segments.some((segment) => KMP_REST_CATALOG_SEGMENTS.includes(segment));
}

function isReadOnlyAdminAjax(parsed) {
  if (!parsed) {
    return false;
  }
  const pathname = normalizePathname(parsed.pathname);
  if (pathname !== '/wp-admin/admin-ajax.php') {
    return false;
  }
  const action = String(parsed.searchParams.get('action') ?? '').trim();
  return Boolean(action)
    && READ_ONLY_AJAX_ACTION_PATTERN.test(action)
    && !MUTATING_AJAX_ACTION_PATTERN.test(action);
}

function hasExplicitJsonEndpoint(parsed) {
  if (!parsed) {
    return false;
  }
  const pathname = normalizePathname(parsed.pathname);
  return pathname.endsWith('.json')
    || pathname === '/api'
    || pathname.startsWith('/api/');
}

function inferPageType({ pathname = '' } = /** @type {any} */ ({})) {
  const normalizedPath = normalizePathname(pathname);
  if (normalizedPath === '/') {
    return 'home';
  }
  if (normalizedPath === '/search' || normalizedPath.startsWith('/search/')) {
    return 'search-results-page';
  }
  if (normalizedPath === '/ranking' || normalizedPath.startsWith('/ranking/')) {
    return 'category-page';
  }
  if (
    normalizedPath === '/tag'
    || normalizedPath.startsWith('/tag/')
    || normalizedPath.startsWith('/topics')
    || normalizedPath === '/kmp_movies'
    || normalizedPath.startsWith('/works/tag/')
    || normalizedPath.startsWith('/works/category/')
  ) {
    return 'category-page';
  }
  if (
    normalizedPath === '/label'
    || normalizedPath.startsWith('/label/')
    || normalizedPath === '/works'
    || normalizedPath.startsWith('/works/page/')
    || normalizedPath === '/works-vr'
    || normalizedPath === '/works-sell'
  ) {
    return 'category-page';
  }
  if (normalizedPath === '/girls' || normalizedPath === '/actress' || normalizedPath.startsWith('/actress/')) {
    return 'author-list-page';
  }
  if (/^\/works\/[^/]+/u.test(normalizedPath)) {
    return 'book-detail-page';
  }
  if (/^\/(?:contents|event|company|policy|ad_contact|recruit)(?:\/|$)/u.test(normalizedPath)) {
    return 'utility-page';
  }
  if (normalizedPath === '/wp-json' || normalizedPath.startsWith('/wp-json/')) {
    return 'utility-page';
  }
  return null;
}

function isKmProduceApiCandidate(candidate = /** @type {any} */ ({})) {
  const siteKey = String(candidate?.siteKey ?? '').trim();
  const { host } = endpointParts(candidate);
  const parsed = parseUrl(candidate?.endpoint?.url);
  return siteKey === 'km-produce'
    && KMP_HOSTS.includes(host)
    && isReadOnlyMethod(candidate)
    && (
      isWordPressRestRoute(parsed)
      || isReadOnlyAdminAjax(parsed)
      || hasExplicitJsonEndpoint(parsed)
    );
}

export const kmProduceAdapter = createCatalogAdapter({
  id: 'km-produce',
  hosts: KMP_HOSTS,
  terminology: KMP_TERMINOLOGY,
  intentLabels: INTENT_LABELS,
  inferPageType,
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  classifyPath({ pathname = '' } = /** @type {any} */ ({})) {
    const pageType = inferPageType({ pathname });
    return {
      kind: pageType ? 'km-produce-path' : null,
      detail: pageType,
    };
  },
  validateApiCandidate({
    candidate,
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    validatedAt,
  } = /** @type {any} */ ({})) {
    const { host, pathname } = endpointParts(candidate);
    const accepted = isKmProduceApiCandidate(candidate);
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 'km-produce',
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 'km-produce-api-candidate',
        endpointHost: host,
        endpointPath: pathname,
        endpointMethod: endpointMethod(candidate),
        bridgeEvidence: '20260530T013440006Z/kmp-bazooka.json',
        bridgeStatus: 'browser_verified',
        htmlCatalogPagesRejected: true,
        mediaPersistence: false,
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
    const accepted = siteAdapterDecision?.decision === 'accepted' && isKmProduceApiCandidate(candidate);
    return normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'km-produce',
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 'km-produce-api',
        endpointHost: host,
        endpointPath: pathname,
        endpointMethod: endpointMethod(candidate),
        htmlCatalogPagesRejected: true,
        mediaPersistence: false,
        ...scope,
      },
      evidence,
    }, {
      candidate,
      siteAdapterDecision,
    });
  },
});
