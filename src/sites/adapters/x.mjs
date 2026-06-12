// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { createCatalogAdapter } from './factory.mjs';
import { normalizeSiteAdapterSemanticEntry } from './generic-navigation.mjs';
import { endpointParts } from './url-parts.mjs';

const X_ADAPTER_VERSION = '2026-06-09';

const X_HOSTS = Object.freeze([
  'x.com',
  'www.x.com',
]);

export const X_TERMINOLOGY = Object.freeze({
  entityLabel: 'post',
  entityPlural: 'posts',
  personLabel: 'account',
  personPlural: 'accounts',
  searchLabel: 'search posts',
  openEntityLabel: 'open post',
  openPersonLabel: 'open account profile',
  downloadLabel: 'download post',
  verifiedTaskLabel: 'post / account / timeline',
});

const INTENT_LABELS = Object.freeze({
  'search-post': 'search posts',
  'search-posts': 'search posts',
  'search-content': 'search posts',
  'search-book': 'search posts',
  'open-post': 'open post',
  'open-book': 'open post',
  'open-author': 'open account profile',
  'open-profile': 'open account profile',
  'open-category': 'open explore page',
  'open-utility-page': 'open utility page',
  'open-auth-page': 'open login page',
  'download-book': 'download post media',
  'profile-content': 'list account posts',
  'list-profile-content': 'list account posts',
  'list-author-posts': 'list account posts',
  'list-author-replies': 'list account replies',
  'list-author-media': 'list account media',
  'list-author-highlights': 'list account highlights',
  'list-author-following': 'list account following',
  'list-profile-following': 'list account following',
  'list-followed-users': 'list followed accounts',
  'list-followed-updates': 'list followed account posts',
  'account-info': 'get account information',
});

function isReservedRootSegment(segment) {
  return [
    'compose',
    'explore',
    'home',
    'i',
    'jobs',
    'login',
    'messages',
    'notifications',
    'search',
    'settings',
    'signup',
  ].includes(segment);
}

function inferXPageType({ pathname = '' } = /** @type {any} */ ({})) {
  const normalizedPath = String(pathname || '/').trim().replace(/\/+$/u, '').toLowerCase() || '/';
  if (normalizedPath === '/home' || normalizedPath === '/') {
    return 'home';
  }
  if (normalizedPath === '/search' || normalizedPath.startsWith('/search/')) {
    return 'search-results-page';
  }
  if (normalizedPath === '/explore' || normalizedPath.startsWith('/explore/')) {
    return 'category-page';
  }
  if (
    normalizedPath === '/i/flow/login'
    || normalizedPath === '/login'
    || normalizedPath === '/signup'
    || normalizedPath.startsWith('/i/flow/signup')
  ) {
    return 'auth-page';
  }
  if (
    normalizedPath === '/notifications'
    || normalizedPath === '/messages'
    || normalizedPath === '/i/bookmarks'
    || normalizedPath.startsWith('/settings')
  ) {
    return 'author-list-page';
  }
  if (normalizedPath.startsWith('/i/status/')) {
    return 'book-detail-page';
  }
  if (/^\/[^/]+\/status\/\d+(?:\/|$)/u.test(normalizedPath)) {
    return 'book-detail-page';
  }
  if (/^\/[^/]+\/(?:following|followers)(?:\/|$)/u.test(normalizedPath)) {
    return 'author-list-page';
  }
  if (/^\/[^/]+\/(?:with_replies|media|highlights)(?:\/|$)/u.test(normalizedPath)) {
    return 'author-page';
  }

  const firstSegment = normalizedPath.split('/').filter(Boolean)[0] ?? '';
  if (firstSegment && !isReservedRootSegment(firstSegment)) {
    return 'author-page';
  }
  return null;
}

function isXApiCandidate(candidate = /** @type {any} */ ({})) {
  const siteKey = String(candidate?.siteKey ?? '').trim();
  const { host, pathname } = endpointParts(candidate);
  return siteKey === 'x'
    && X_HOSTS.includes(host)
    && isReadOnlyMethod(candidate)
    && pathname.startsWith('/i/api/');
}

function isReadOnlyMethod(candidate = /** @type {any} */ ({})) {
  const method = String(candidate?.endpoint?.method ?? candidate?.method ?? 'GET').trim().toUpperCase();
  return method === 'GET' || method === 'HEAD';
}

function xApiOperationName(pathname) {
  const segments = String(pathname ?? '').split('/').filter(Boolean);
  return segments[segments.length - 1] || null;
}

function xApiSemanticsForPath(pathname) {
  if (pathname === '/i/api/1.1/hashflags.json') {
    return {
      semanticKind: 'read-hashflags',
      name: 'read X hashflags API',
      description: 'Read replay-verified X hashflag metadata through a read-only web API endpoint.',
      object: 'hashflag metadata',
      userValue: 'Inspect public X hashflag metadata without account mutation.',
      outputName: 'hashflags',
      outputType: 'entity',
      intentExamples: [
        'read X hashflags',
        'inspect X hashflag metadata',
      ],
    };
  }
  if (pathname === '/i/api/2/badge_count/badge_count.json') {
    return {
      semanticKind: 'read-badge-count-summary',
      name: 'read X badge count API',
      description: 'Read replay-verified X badge-count summary through a user-authorized read-only web API endpoint.',
      object: 'badge count summary',
      userValue: 'Check authenticated X badge-count metadata without opening or mutating notification items.',
      outputName: 'badge_count',
      outputType: 'entity',
      intentExamples: [
        'read X badge count',
        'check X notification count metadata',
      ],
    };
  }
  if (pathname.startsWith('/i/api/graphql/')) {
    const operationName = xApiOperationName(pathname);
    return {
      semanticKind: operationName ? `x-graphql-${operationName}` : 'x-graphql-readonly-api',
      name: operationName ? `read X ${operationName} API` : 'read X GraphQL API',
      description: 'Read replay-verified X GraphQL data through a read-only web API endpoint.',
      object: operationName ? `${operationName} response` : 'X GraphQL response',
      userValue: 'Read X API metadata without write, follow, like, repost, DM, payment, or account mutation.',
      outputName: operationName ? operationName.replace(/[^A-Za-z0-9]+/gu, '_').toLowerCase() : 'x_graphql_response',
      outputType: 'entity',
      intentExamples: [],
    };
  }
  return {
    semanticKind: 'x-readonly-api',
    name: 'read X API',
    description: 'Read replay-verified X web API metadata through a read-only endpoint.',
    object: 'X API response',
    userValue: 'Read X API metadata without account mutation.',
    outputName: 'x_api_response',
    outputType: 'entity',
    intentExamples: [],
  };
}

const X_WEB_AUTH_PARAMETER_SOURCE = Object.freeze({
  kind: 'x_web_auth_headers',
  pageUrl: 'https://x.com/home',
  rawMaterialPersisted: false,
});

const X_BUILD_API_SEEDS = Object.freeze([
  Object.freeze({
    id: 'x-known-api-hashflags',
    semanticKind: 'read-hashflags',
    url: 'https://x.com/i/api/1.1/hashflags.json',
    responseEvidence: null,
    parameterSource: X_WEB_AUTH_PARAMETER_SOURCE,
    runtimeParameterResolution: 'browser_bridge_page_context_x_web_auth_headers',
  }),
  Object.freeze({
    id: 'x-known-api-badge-count',
    semanticKind: 'read-badge-count-summary',
    url: 'https://x.com/i/api/2/badge_count/badge_count.json?supports_ntab_urt=1',
    responseEvidence: null,
    parameterSource: X_WEB_AUTH_PARAMETER_SOURCE,
    runtimeParameterResolution: 'browser_bridge_page_context_x_web_auth_headers',
  }),
]);

function buildXApiDiscoverySeeds({ siteKey = 'x' } = {}) {
  return X_BUILD_API_SEEDS.map((seed) => ({
    id: seed.id,
    siteKey,
    status: 'observed',
    method: 'GET',
    url: seed.url,
    resourceType: 'fetch',
    source: 'site-adapter.build-api-seed',
    evidence: {
      event: 'site-adapter-build-api-seed',
      source: 'x-known-site-query',
      semanticKind: seed.semanticKind,
      observedOnly: true,
      rawMaterialPersisted: false,
    },
    request: {
      headers: {
        Accept: 'application/json, text/plain;q=0.8, */*;q=0.1',
      },
      body: {},
    },
    runtime: {
      semanticKind: seed.semanticKind,
      endpointTemplate: seed.url,
      responseEvidence: seed.responseEvidence,
      parameterSource: seed.parameterSource,
      runtimeParameterResolution: seed.runtimeParameterResolution,
      rawParameterMaterialPersisted: false,
    },
  }));
}

const X_HEALTH_SIGNAL_MAP = Object.freeze({
  'profile-health-risk': Object.freeze({
    type: 'platform-risk-detected',
    severity: 'high',
    affectedCapability: 'profile.read',
    autoRecoverable: false,
    requiresUserAction: true,
  }),
  'login-required': Object.freeze({
    type: 'login-required',
    severity: 'high',
    affectedCapability: 'auth.session',
    autoRecoverable: false,
    requiresUserAction: true,
  }),
  captcha: Object.freeze({
    type: 'captcha-required',
    severity: 'high',
    affectedCapability: 'auth.challenge',
    autoRecoverable: false,
    requiresUserAction: true,
  }),
  mfa: Object.freeze({
    type: 'mfa-required',
    severity: 'high',
    affectedCapability: 'auth.session',
    autoRecoverable: false,
    requiresUserAction: true,
  }),
  'rate-limit': Object.freeze({
    type: 'rate-limited',
    severity: 'medium',
    affectedCapability: 'api.request',
    autoRecoverable: true,
    requiresUserAction: false,
  }),
  'permission-denied': Object.freeze({
    type: 'permission-denied',
    severity: 'high',
    affectedCapability: 'content.read',
    autoRecoverable: false,
    requiresUserAction: true,
  }),
  csrf: Object.freeze({
    type: 'csrf-invalid',
    severity: 'medium',
    affectedCapability: 'api.auth',
    autoRecoverable: true,
    requiresUserAction: false,
  }),
});

function normalizeXHealthSignal(rawSignal = /** @type {any} */ ({})) {
  const signal = typeof rawSignal === 'string'
    ? rawSignal
    : String(rawSignal?.rawSignal ?? rawSignal?.signal ?? rawSignal?.reasonCode ?? 'unknown-health-risk');
  const mapped = X_HEALTH_SIGNAL_MAP[signal] ?? {
    type: 'unknown-health-risk',
    severity: 'medium',
    autoRecoverable: false,
    requiresUserAction: true,
  };
  return {
    siteId: 'x',
    rawSignal: signal,
    ...mapped,
    affectedCapability: rawSignal?.affectedCapability ?? rawSignal?.capabilityKey ?? mapped.affectedCapability,
  };
}

export const xAdapter = createCatalogAdapter({
  id: 'x',
  hosts: X_HOSTS,
  terminology: X_TERMINOLOGY,
  intentLabels: INTENT_LABELS,
  inferPageType: inferXPageType,
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  describeApiCandidateSemantics({
    candidate,
    scope = /** @type {any} */ ({}),
  } = /** @type {any} */ ({})) {
    const { host, pathname } = endpointParts(candidate);
    const semantics = xApiSemanticsForPath(pathname);
    const normalized = normalizeSiteAdapterSemanticEntry({
      candidate,
      semantics: {
        auth: {
          ...(candidate?.auth ?? {}),
          authenticationRequired: true,
          credentialPolicy: 'browser-bridge-page-context-csrf-only',
        },
        pagination: {
          ...(candidate?.pagination ?? {}),
        },
        fieldMapping: {
          ...(candidate?.fieldMapping ?? {}),
          outputName: semantics.outputName,
          outputType: semantics.outputType,
        },
        risk: {
          ...(candidate?.risk ?? {}),
          hints: [
            'X web APIs can require user-authorized cookies plus a CSRF header derived in page context',
            'raw cookies, CSRF values, Authorization headers, and response bodies must stay out of persisted artifacts',
          ],
          rawMaterialPersisted: false,
        },
      },
      scope: {
        semanticMode: 'x-api-candidate',
        endpointHost: host,
        endpointPath: pathname,
        semanticKind: semantics.semanticKind,
        ...scope,
      },
    }, {
      adapterId: 'x',
      adapterVersion: X_ADAPTER_VERSION,
      siteKey: 'x',
    });
    return {
      ...normalized,
      ...semantics,
    };
  },
  getBuildApiDiscoverySeeds({ site } = /** @type {any} */ ({})) {
    const siteKey = String(site?.id ?? '').trim() === 'x' ? site.id : 'x';
    return buildXApiDiscoverySeeds({ siteKey });
  },
  validateApiCandidate({
    candidate,
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    validatedAt,
  } = /** @type {any} */ ({})) {
    const { host, pathname } = endpointParts(candidate);
    const accepted = isXApiCandidate(candidate);
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 'x',
      adapterVersion: X_ADAPTER_VERSION,
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 'x-api-candidate',
        endpointHost: host,
        endpointPath: pathname,
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
    const accepted = siteAdapterDecision?.decision === 'accepted' && isXApiCandidate(candidate);
    return normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'x',
      adapterVersion: X_ADAPTER_VERSION,
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 'x-api',
        endpointHost: host,
        endpointPath: pathname,
        ...scope,
      },
      evidence,
    }, {
      candidate,
      siteAdapterDecision,
    });
  },
  normalizeHealthSignal: normalizeXHealthSignal,
});
