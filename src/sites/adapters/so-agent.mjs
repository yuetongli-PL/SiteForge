// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { createCatalogAdapter } from './factory.mjs';
import { endpointParts } from './url-parts.mjs';

export const SO_AGENT_HOSTS = Object.freeze([
  'so-agent.jp',
  'www.so-agent.jp',
]);

export const SO_AGENT_TERMINOLOGY = Object.freeze({
  entityLabel: 'profile',
  entityPlural: 'profiles',
  personLabel: 'model',
  personPlural: 'models',
  searchLabel: 'search disabled',
  openEntityLabel: 'open profile',
  openPersonLabel: 'open model profile',
  downloadLabel: 'download disabled',
  verifiedTaskLabel: 'model profile / news / agency page',
});

export const SO_AGENT_INTENT_LABELS = Object.freeze({
  'open-model': 'open model profile',
  'open-author': 'open model profile',
  'open-category': 'open public index page',
  'open-utility-page': 'open agency utility page',
  'open-work': 'open public profile',
});

function normalizePathname(pathname) {
  const raw = String(pathname ?? '').trim() || '/';
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const collapsed = withSlash.replace(/\/{2,}/gu, '/');
  return (collapsed.length > 1 ? collapsed.replace(/\/+$/u, '') : collapsed).toLowerCase();
}

function candidateMethod(candidate = /** @type {any} */ ({})) {
  return String(candidate?.endpoint?.method ?? candidate?.method ?? 'GET').trim().toUpperCase() || 'GET';
}

export function inferSoAgentPageType({ pathname = '' } = /** @type {any} */ ({})) {
  const path = normalizePathname(pathname);
  if (path === '/' || path === '/index.php') {
    return 'home';
  }
  if (path === '/model.php') {
    return 'author-list-page';
  }
  if (/^\/model\/[a-z0-9_-]+$/u.test(path)) {
    return 'author-page';
  }
  if (path === '/news.php') {
    return 'category-page';
  }
  if (path === '/company.php' || path === '/recruit.php') {
    return 'utility-page';
  }
  return null;
}

export function validateSoAgentApiCandidate({
  candidate,
  evidence = /** @type {any} */ ({}),
  scope = /** @type {any} */ ({}),
  validatedAt,
} = /** @type {any} */ ({})) {
  const { host, pathname } = endpointParts(candidate);
  return normalizeSiteAdapterCandidateDecision({
    adapterId: 'so-agent',
    decision: 'rejected',
    reasonCode: 'api-verification-failed',
    validatedAt,
    scope: {
      validationMode: 'so-agent-no-observed-public-api',
      endpointHost: host,
      endpointPath: pathname,
      endpointMethod: candidateMethod(candidate),
      publicApiObserved: false,
      ...scope,
    },
    evidence,
  }, { candidate });
}

export function getSoAgentApiCatalogUpgradePolicy({
  candidate,
  siteAdapterDecision,
  evidence = /** @type {any} */ ({}),
  scope = /** @type {any} */ ({}),
  decidedAt,
} = /** @type {any} */ ({})) {
  const { host, pathname } = endpointParts(candidate);
  return normalizeSiteAdapterCatalogUpgradePolicy({
    adapterId: 'so-agent',
    allowCatalogUpgrade: false,
    reasonCode: 'api-catalog-entry-blocked',
    decidedAt,
    scope: {
      policyMode: 'so-agent-no-observed-public-api',
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

export const soAgentAdapter = createCatalogAdapter({
  id: 'so-agent',
  hosts: SO_AGENT_HOSTS,
  terminology: SO_AGENT_TERMINOLOGY,
  intentLabels: SO_AGENT_INTENT_LABELS,
  inferPageType: inferSoAgentPageType,
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  classifyPath({ pathname = '' } = /** @type {any} */ ({})) {
    const pageType = inferSoAgentPageType({ pathname });
    return {
      kind: pageType ? 'so-agent-path' : null,
      detail: pageType,
    };
  },
  validateApiCandidate: validateSoAgentApiCandidate,
  getApiCatalogUpgradePolicy: getSoAgentApiCatalogUpgradePolicy,
});
