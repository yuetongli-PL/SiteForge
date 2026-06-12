// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { createCatalogAdapter } from './factory.mjs';
import { normalizeSiteAdapterSemanticEntry } from './generic-navigation.mjs';
import { endpointParts } from './url-parts.mjs';

const ZHIHU_ADAPTER_VERSION = '2026-06-09';

const ZHIHU_HOSTS = Object.freeze([
  'www.zhihu.com',
  'zhihu.com',
  'api.zhihu.com',
]);

const ZHIHU_IGNORED_REQUEST_PATTERNS = Object.freeze([
  /\/(?:favicon|robots\.txt)(?:$|[?#])/iu,
  /\/(?:static|assets|js|css|images?|font)s?\//iu,
  /\.(?:css|js|png|jpe?g|webp|gif|svg|ico|woff2?|ttf)(?:$|[?#])/iu,
]);

const ZHIHU_PAGE_TYPES = new Set([
  'auth-page',
  'author-page',
  'category-page',
  'author-list-page',
  'content-detail-page',
  'home',
  'media-page',
  'topic-page',
  'notification-page',
  'search-results-page',
  'settings-page',
  'utility-page',
  'write-entry-disabled',
]);

const ZHIHU_RECOGNIZED_NODE_KINDS = new Set([
  'navigation-state',
  'page-type',
  'search-form',
  'content-link',
  'post-link',
  'question-link',
  'answer-link',
  'profile-link',
  'safe-nav-link',
  'auth-link',
  'login-state',
  'permission',
  'permission-signal',
  'permission-denied',
  'risk',
  'risk-control',
  'risk-signal',
  'limited-page',
  'restriction-page',
  'rate-limit',
]);

const ZHIHU_SENSITIVE_NODE_KINDS = new Set([
  'login-state',
  'permission',
  'permission-signal',
  'permission-denied',
  'risk',
  'risk-control',
  'risk-signal',
  'limited-page',
  'restriction-page',
  'rate-limit',
]);

export const ZHIHU_TERMINOLOGY = Object.freeze({
  entityLabel: 'post',
  entityPlural: 'posts',
  personLabel: 'account',
  personPlural: 'accounts',
  searchLabel: 'search Zhihu',
  openEntityLabel: 'open Zhihu content',
  openPersonLabel: 'open Zhihu profile',
  downloadLabel: 'download Zhihu content',
  verifiedTaskLabel: 'question / answer / profile / feed',
});

const INTENT_LABELS = Object.freeze({
  'account-info': 'get Zhihu account information',
  'list-comment-thread': 'list Zhihu answer comments',
  'list-followed-updates': 'list followed Zhihu updates',
  'list-followed-users': 'list followed Zhihu accounts',
  'list-hot-broadcasts': 'list Zhihu hot broadcasts',
  'list-hot-posts': 'list Zhihu hot posts',
  'list-notifications': 'list Zhihu notifications',
  'list-profile-content': 'list Zhihu profile content',
  'list-recommended-timeline-posts': 'list Zhihu recommended timeline posts',
  'list-topic-discussions': 'list Zhihu topic discussions',
  'list-topic-featured': 'list Zhihu topic featured answers',
  'list-user-activities': 'list Zhihu user activities',
  'list-user-answers': 'list Zhihu user answers',
  'list-user-articles': 'list Zhihu user articles',
  'list-user-collections': 'list Zhihu user collections',
  'list-user-columns': 'list Zhihu user columns',
  'list-user-following': 'list Zhihu user following',
  'list-user-pins': 'list Zhihu user pins',
  'list-user-questions': 'list Zhihu user questions',
  'list-user-videos': 'list Zhihu user videos',
  'open-author': 'open Zhihu profile',
  'open-category': 'open Zhihu topic or hot page',
  'open-comment': 'open Zhihu comment thread',
  'open-post': 'open Zhihu question or answer',
  'open-search-result-detail': 'open Zhihu search result detail',
  'open-utility-page': 'open Zhihu utility page',
  'profile-content': 'list Zhihu profile content',
  'read-search-result-summaries': 'read Zhihu search result summaries',
  'search-content': 'search Zhihu',
  'search-latest-posts': 'search latest Zhihu content',
  'search-media-posts': 'search Zhihu media content',
  'search-posts': 'search Zhihu content',
  'search-users': 'search Zhihu users',
  'view-answer-detail': 'open Zhihu answer detail',
  'view-question-detail': 'open Zhihu question detail',
});

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function zhihuPath(value) {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }
  try {
    return new URL(text).pathname || '/';
  } catch {
    return text.startsWith('/') ? text : `/${text}`;
  }
}

function reservedProfileSegment(segment) {
  return [
    'api',
    'appview',
    'creator',
    'drama',
    'explore',
    'follow',
    'hot',
    'inbox',
    'login',
    'notifications',
    'people',
    'pin',
    'question',
    'search',
    'settings',
    'signin',
    'signup',
    'topic',
    'write',
    'zvideo',
  ].includes(segment);
}

function inferZhihuPageType({ pathname = '' } = /** @type {any} */ ({})) {
  const normalizedPath = String(pathname || '/').trim().replace(/\/+$/u, '').toLowerCase() || '/';
  if (normalizedPath === '/') {
    return 'home';
  }
  if (
    normalizedPath === '/login'
    || normalizedPath === '/signin'
    || normalizedPath === '/signup'
    || normalizedPath.startsWith('/account/')
    || normalizedPath.startsWith('/verification')
  ) {
    return 'auth-page';
  }
  if (normalizedPath === '/search' || normalizedPath.startsWith('/search/')) {
    return 'search-results-page';
  }
  if (normalizedPath === '/hot' || normalizedPath.startsWith('/topic')) {
    return 'category-page';
  }
  if (normalizedPath === '/drama/feed' || normalizedPath.startsWith('/drama/')) {
    return 'media-page';
  }
  if (normalizedPath === '/notifications' || normalizedPath.startsWith('/notifications/')) {
    return 'notification-page';
  }
  if (normalizedPath.startsWith('/people/') || normalizedPath.startsWith('/org/')) {
    return 'author-page';
  }
  if (
    /^\/question\/\d+(?:\/answer\/\d+)?(?:\/|$)/u.test(normalizedPath)
    || /^\/answer\/\d+(?:\/|$)/u.test(normalizedPath)
    || /^\/p\/\d+(?:\/|$)/u.test(normalizedPath)
    || /^\/zvideo\/\d+(?:\/|$)/u.test(normalizedPath)
  ) {
    return 'content-detail-page';
  }
  if (
    normalizedPath.startsWith('/settings')
    || normalizedPath.startsWith('/inbox')
    || normalizedPath.startsWith('/creator')
  ) {
    return 'settings-page';
  }
  if (
    normalizedPath.startsWith('/write')
    || normalizedPath.startsWith('/draft')
    || normalizedPath.startsWith('/question/waiting')
  ) {
    return 'write-entry-disabled';
  }

  const firstSegment = normalizedPath.split('/').filter(Boolean)[0] ?? '';
  if (firstSegment && !reservedProfileSegment(firstSegment)) {
    return 'author-page';
  }
  return null;
}

function zhihuPageTypeFromItem(item = /** @type {any} */ ({})) {
  const rawPageType =
    item.pageType
    ?? item.semanticPageType
    ?? item.evidence?.pageType
    ?? (String(item.nodeKind ?? item.kind ?? '').trim() === 'page-type'
      ? String(item.label ?? '').replace(/^pageType\./iu, '')
      : undefined);
  const pageType = normalizeText(rawPageType);
  if (pageType && ZHIHU_PAGE_TYPES.has(pageType)) {
    return pageType;
  }
  return inferZhihuPageType({ pathname: zhihuPath(item.locator ?? item.url ?? item.path) });
}

function zhihuNodeKind(item = /** @type {any} */ ({})) {
  return normalizeText(item.nodeKind ?? item.kind ?? item.type);
}

function recognizedDecision(item, recognizedAs) {
  return {
    classification: 'recognized',
    recognizedAs,
    required: Boolean(item?.required),
  };
}

function ignoredDecision(item, reason) {
  return {
    classification: 'ignored',
    reason,
    required: Boolean(item?.required),
  };
}

function isReadOnlyMethod(candidate = /** @type {any} */ ({})) {
  const method = String(candidate?.endpoint?.method ?? candidate?.method ?? 'GET').trim().toUpperCase();
  return method === 'GET' || method === 'HEAD';
}

function isZhihuSiteKey(value) {
  const siteKey = String(value ?? '').trim().toLowerCase();
  return siteKey === 'zhihu' || siteKey === 'www.zhihu.com' || siteKey === 'zhihu.com';
}

function isZhihuHost(host) {
  return ZHIHU_HOSTS.includes(String(host ?? '').toLowerCase());
}

function isZhihuExecutableApiPath(pathname) {
  return /^\/api\/v[34]\//iu.test(String(pathname ?? ''))
    || /^\/api\/(?:members|questions|answers|search|notifications|feed)\//iu.test(String(pathname ?? ''));
}

function isZhihuApiCandidate(candidate = /** @type {any} */ ({})) {
  const { host, pathname } = endpointParts(candidate);
  return isZhihuSiteKey(candidate?.siteKey)
    && isZhihuHost(host)
    && isReadOnlyMethod(candidate)
    && isZhihuExecutableApiPath(pathname);
}

function zhihuApiSemanticsForPath(pathname) {
  if (/^\/api\/v[34]\/search/iu.test(pathname)) {
    return {
      semanticKind: 'search-posts',
      name: 'search Zhihu content API',
      description: 'Read replay-verified Zhihu search metadata through a read-only web API endpoint.',
      object: 'Zhihu search results',
      userValue: 'Search Zhihu content without publishing, voting, following, or messaging.',
      outputName: 'zhihu_search_results',
      outputType: 'list',
      intentExamples: ['search Zhihu content', 'search Zhihu questions'],
    };
  }
  if (/^\/api\/v[34]\/feed\/topstory/iu.test(pathname)) {
    return {
      semanticKind: 'list-recommended-timeline-posts',
      name: 'read Zhihu homepage feed API',
      description: 'Read replay-verified Zhihu homepage feed metadata through a user-authorized read-only endpoint.',
      object: 'Zhihu homepage feed',
      userValue: 'Read homepage feed summaries without account mutation.',
      outputName: 'feed_items',
      outputType: 'list',
      intentExamples: ['read Zhihu feed', 'list recommended Zhihu posts'],
    };
  }
  if (/^\/api\/v[34]\/members\//iu.test(pathname)) {
    return {
      semanticKind: 'query-account-profile',
      name: 'read Zhihu profile API',
      description: 'Read replay-verified Zhihu profile metadata through a read-only endpoint.',
      object: 'Zhihu profile metadata',
      userValue: 'Inspect a Zhihu profile without account mutation.',
      outputName: 'profile',
      outputType: 'entity',
      intentExamples: ['read Zhihu profile', 'open Zhihu profile metadata'],
    };
  }
  if (/^\/api\/v[34]\/questions\/[^/]+\/answers/iu.test(pathname)) {
    return {
      semanticKind: 'list-comment-thread',
      name: 'read Zhihu question answers API',
      description: 'Read replay-verified Zhihu answer-list metadata through a read-only endpoint.',
      object: 'Zhihu answer list',
      userValue: 'Inspect answer summaries without commenting, voting, or following.',
      outputName: 'answers',
      outputType: 'list',
      intentExamples: ['list Zhihu answers', 'read question answer summaries'],
    };
  }
  if (/^\/api\/v[34]\/answers\//iu.test(pathname)) {
    return {
      semanticKind: 'open-post',
      name: 'read Zhihu answer API',
      description: 'Read replay-verified Zhihu answer metadata through a read-only endpoint.',
      object: 'Zhihu answer metadata',
      userValue: 'Open answer metadata without voting, commenting, or collecting.',
      outputName: 'answer',
      outputType: 'entity',
      intentExamples: ['read Zhihu answer metadata', 'open Zhihu answer'],
    };
  }
  if (/^\/api\/v[34]\/notifications/iu.test(pathname)) {
    return {
      semanticKind: 'list-notifications',
      name: 'read Zhihu notifications API',
      description: 'Read replay-verified Zhihu notification metadata through a user-authorized read-only endpoint.',
      object: 'Zhihu notifications',
      userValue: 'Read notification summaries without replying or mutating account state.',
      outputName: 'notifications',
      outputType: 'list',
      intentExamples: ['list Zhihu notifications', 'read Zhihu notification summaries'],
    };
  }
  if (/^\/api\/v[34]\/(?:me|people\/self)/iu.test(pathname)) {
    return {
      semanticKind: 'account-info',
      name: 'read Zhihu account API',
      description: 'Read replay-verified account metadata through a user-authorized read-only endpoint.',
      object: 'Zhihu account metadata',
      userValue: 'Inspect account metadata without settings changes.',
      outputName: 'account',
      outputType: 'entity',
      intentExamples: ['read Zhihu account info', 'check Zhihu account metadata'],
    };
  }
  return {
    semanticKind: 'zhihu-readonly-api',
    name: 'read Zhihu API',
    description: 'Read replay-verified Zhihu web API metadata through a read-only endpoint.',
    object: 'Zhihu API response',
    userValue: 'Read Zhihu API metadata without account mutation.',
    outputName: 'zhihu_api_response',
    outputType: 'entity',
    intentExamples: [],
  };
}

const ZHIHU_HEALTH_SIGNAL_MAP = Object.freeze({
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
  'permission-denied': Object.freeze({
    type: 'permission-denied',
    severity: 'high',
    affectedCapability: 'content.read',
    autoRecoverable: false,
    requiresUserAction: true,
  }),
  'profile-health-risk': Object.freeze({
    type: 'platform-risk-detected',
    severity: 'high',
    affectedCapability: 'profile.read',
    autoRecoverable: false,
    requiresUserAction: true,
  }),
  'robots-disallowed': Object.freeze({
    type: 'platform-policy-blocked',
    severity: 'high',
    affectedCapability: 'generic.crawl',
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
  csrf: Object.freeze({
    type: 'csrf-invalid',
    severity: 'medium',
    affectedCapability: 'api.auth',
    autoRecoverable: true,
    requiresUserAction: false,
  }),
});

function normalizeZhihuHealthSignal(rawSignal = /** @type {any} */ ({})) {
  const signal = typeof rawSignal === 'string'
    ? rawSignal
    : String(rawSignal?.rawSignal ?? rawSignal?.signal ?? rawSignal?.reasonCode ?? 'unknown-health-risk');
  const mapped = ZHIHU_HEALTH_SIGNAL_MAP[signal] ?? {
    type: 'unknown-health-risk',
    severity: 'medium',
    autoRecoverable: false,
    requiresUserAction: true,
  };
  return {
    siteId: 'zhihu',
    rawSignal: signal,
    ...mapped,
    affectedCapability: rawSignal?.affectedCapability ?? rawSignal?.capabilityKey ?? mapped.affectedCapability,
  };
}

export const zhihuAdapter = createCatalogAdapter({
  id: 'zhihu',
  hosts: ZHIHU_HOSTS,
  terminology: ZHIHU_TERMINOLOGY,
  intentLabels: INTENT_LABELS,
  inferPageType: inferZhihuPageType,
  normalizeDisplayLabel: ({ value }) => cleanText(value).replace(/\s*-\s*Zhihu$/iu, '').replace(/\s*-\s*\u77e5\u4e4e$/u, ''),
  classifyNode(item = /** @type {any} */ ({})) {
    const nodeKind = zhihuNodeKind(item);
    if (nodeKind && ZHIHU_SENSITIVE_NODE_KINDS.has(nodeKind)) {
      return recognizedDecision(item, `zhihu:${nodeKind}`);
    }
    const pageType = zhihuPageTypeFromItem(item);
    if (pageType) {
      return recognizedDecision(item, `zhihu:${pageType}`);
    }
    if (nodeKind && ZHIHU_RECOGNIZED_NODE_KINDS.has(nodeKind)) {
      return recognizedDecision(item, `zhihu:${nodeKind}`);
    }
    if (nodeKind === 'artifact-ref') {
      return ignoredDecision(
        item,
        'Zhihu discovery artifact reference is recorded elsewhere and is not a site capability node.',
      );
    }
    return {
      classification: 'unknown',
      required: Boolean(item.required),
    };
  },
  classifyApi(item = /** @type {any} */ ({})) {
    const endpoint = normalizeText(
      item.locator
        ?? item.url
        ?? item.endpoint?.url
        ?? item.path
        ?? item.route,
    );
    const path = zhihuPath(endpoint);
    if (!endpoint) {
      return {
        classification: 'unknown',
        required: Boolean(item.required),
      };
    }
    if (ZHIHU_IGNORED_REQUEST_PATTERNS.some((pattern) => pattern.test(endpoint))) {
      return ignoredDecision(
        item,
        'Static or browser-support request is outside Zhihu capability coverage.',
      );
    }
    if (isZhihuExecutableApiPath(path)) {
      return recognizedDecision(item, `zhihu:observed-api:${path || '/'}`);
    }
    if (inferZhihuPageType({ pathname: path })) {
      return recognizedDecision(item, `zhihu:page-request:${path || '/'}`);
    }
    return ignoredDecision(
      item,
      'Observed Zhihu request is non-required until the Zhihu SiteAdapter promotes it.',
    );
  },
  describeApiCandidateSemantics({
    candidate,
    scope = /** @type {any} */ ({}),
  } = /** @type {any} */ ({})) {
    const { host, pathname } = endpointParts(candidate);
    const semantics = zhihuApiSemanticsForPath(pathname);
    const normalized = normalizeSiteAdapterSemanticEntry({
      candidate,
      semantics: {
        auth: {
          ...(candidate?.auth ?? {}),
          authenticationRequired: true,
          credentialPolicy: 'browser-bridge-redacted-session-only',
        },
        pagination: {
          ...(candidate?.pagination ?? {}),
          model: semantics.outputType === 'list' ? 'cursor-or-page' : 'none',
        },
        fieldMapping: {
          ...(candidate?.fieldMapping ?? {}),
          outputName: semantics.outputName,
          outputType: semantics.outputType,
        },
        risk: {
          ...(candidate?.risk ?? {}),
          hints: [
            'Zhihu web APIs can require user-authorized cookies and anti-CSRF context',
            'raw cookies, tokens, Authorization headers, x-zse signatures, and response bodies must stay out of persisted artifacts',
          ],
          rawMaterialPersisted: false,
        },
      },
      scope: {
        semanticMode: 'zhihu-api-candidate',
        endpointHost: host,
        endpointPath: pathname,
        semanticKind: semantics.semanticKind,
        ...scope,
      },
    }, {
      adapterId: 'zhihu',
      adapterVersion: ZHIHU_ADAPTER_VERSION,
      siteKey: 'zhihu',
    });
    return {
      ...normalized,
      ...semantics,
    };
  },
  validateApiCandidate({
    candidate,
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    validatedAt,
  } = /** @type {any} */ ({})) {
    const { host, pathname } = endpointParts(candidate);
    const accepted = isZhihuApiCandidate(candidate);
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 'zhihu',
      adapterVersion: ZHIHU_ADAPTER_VERSION,
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 'zhihu-api-candidate',
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
    const accepted = siteAdapterDecision?.decision === 'accepted' && isZhihuApiCandidate(candidate);
    return normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'zhihu',
      adapterVersion: ZHIHU_ADAPTER_VERSION,
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 'zhihu-api',
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
  normalizeHealthSignal: normalizeZhihuHealthSignal,
});
