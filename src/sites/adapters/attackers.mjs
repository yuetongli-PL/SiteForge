// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { createCatalogAdapter } from './factory.mjs';
import { endpointParts, parseUrl } from './url-parts.mjs';

const ATTACKERS_HOSTS = Object.freeze([
  'attackers.net',
  'www.attackers.net',
]);

export const ATTACKERS_TERMINOLOGY = Object.freeze({
  entityLabel: 'work',
  entityPlural: 'works',
  personLabel: 'performer',
  personPlural: 'performers',
  searchLabel: 'search works',
  openEntityLabel: 'open work',
  openPersonLabel: 'open performer page',
  downloadLabel: 'download work media',
  verifiedTaskLabel: 'work / performer / ranking',
});

const INTENT_LABELS = Object.freeze({
  'browse-ranking': 'browse ranking',
  'browse-category': 'browse category',
  'browse-tag': 'browse tag',
  'open-detail-page': 'open work details',
  'open-work-or-list-work': 'open or list works',
  'search-content': 'search works',
  'search-work': 'search works',
  'open-work': 'open work details',
  'open-category': 'open category page',
  'open-utility-page': 'open utility page',
});

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

function hasJsonSignal(url) {
  const parsed = parseUrl(url);
  if (!parsed) {
    return false;
  }
  const pathname = parsed.pathname.toLowerCase();
  return pathname.endsWith('.json')
    || parsed.searchParams.get('format') === 'json'
    || parsed.searchParams.get('output') === 'json'
    || parsed.searchParams.get('ajax') === '1'
    || parsed.searchParams.get('xhr') === '1';
}

function inferPageType({ pathname = '' } = /** @type {any} */ ({})) {
  const normalizedPath = normalizePathname(pathname);
  if (normalizedPath === '/') {
    return 'home';
  }
  if (normalizedPath === '/top' || normalizedPath.startsWith('/top/')) {
    return 'category-page';
  }
  if (normalizedPath === '/search' || normalizedPath.startsWith('/search/')) {
    return 'search-results-page';
  }
  if (/^\/(?:tag|tags|genre|genres|category|categories|series|maker|label)(?:\/|$)/u.test(normalizedPath)) {
    return 'category-page';
  }
  if (/^\/(?:actress|actor|performer|star|models?)$/u.test(normalizedPath)) {
    return 'author-list-page';
  }
  if (/^\/(?:actress|actor|performer|star|models?)\//u.test(normalizedPath)) {
    return 'author-page';
  }
  if (/^\/(?:works?|movie|movies|video|videos)\/[^/]+/u.test(normalizedPath)) {
    return 'book-detail-page';
  }
  if (/^\/(?:works?|movie|movies|video|videos)(?:\/|$)/u.test(normalizedPath)) {
    return 'category-page';
  }
  if (/^\/(?:login|signup|register|account|mypage)(?:\/|$)/u.test(normalizedPath)) {
    return 'auth-page';
  }
  if (/^\/(?:company|contact|privacy|terms|help)(?:\/|$)/u.test(normalizedPath)) {
    return 'utility-page';
  }
  return null;
}

function isAttackersApiCandidate(candidate = /** @type {any} */ ({})) {
  const siteKey = String(candidate?.siteKey ?? '').trim();
  const { host, pathname } = endpointParts(candidate);
  const endpointUrl = candidate?.endpoint?.url;
  const normalizedPath = normalizePathname(pathname);
  return siteKey === 'attackers'
    && ATTACKERS_HOSTS.includes(host)
    && isReadOnlyMethod(candidate)
    && (
      normalizedPath === '/api'
      || normalizedPath.startsWith('/api/')
      || normalizedPath === '/ajax'
      || normalizedPath.startsWith('/ajax/')
      || hasJsonSignal(endpointUrl)
    );
}

export const attackersAdapter = createCatalogAdapter({
  id: 'attackers',
  hosts: ATTACKERS_HOSTS,
  terminology: ATTACKERS_TERMINOLOGY,
  intentLabels: INTENT_LABELS,
  inferPageType,
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  classifyPath({ pathname = '' } = /** @type {any} */ ({})) {
    const pageType = inferPageType({ pathname });
    return {
      kind: pageType ? 'attackers-path' : null,
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
    const accepted = isAttackersApiCandidate(candidate);
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 'attackers',
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 'attackers-api-candidate',
        endpointHost: host,
        endpointPath: pathname,
        endpointMethod: endpointMethod(candidate),
        bridgeEvidence: '20260530T013440006Z/attackers.json',
        bridgeStatus: 'browser_blocked',
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
    const accepted = siteAdapterDecision?.decision === 'accepted' && isAttackersApiCandidate(candidate);
    return normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'attackers',
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 'attackers-api',
        endpointHost: host,
        endpointPath: pathname,
        endpointMethod: endpointMethod(candidate),
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
