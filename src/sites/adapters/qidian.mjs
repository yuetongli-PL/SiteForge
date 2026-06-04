// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { createCatalogAdapter } from './factory.mjs';
import { normalizeSiteAdapterSemanticEntry } from './generic-navigation.mjs';
import { endpointParts } from './url-parts.mjs';

const QIDIAN_ADAPTER_VERSION = '2026-05-30';

const QIDIAN_HOSTS = Object.freeze([
  'www.qidian.com',
]);

const QIDIAN_IGNORED_REQUEST_PATTERNS = Object.freeze([
  /\/(?:favicon|robots\.txt)(?:$|[?#])/iu,
  /\/[A-Z0-9]{6,}\/probe\.js(?:$|[?#])/u,
  /\/(?:static|assets|js|css|images?|font)s?\//iu,
  /\.(?:css|js|png|jpe?g|webp|gif|svg|ico|woff2?|ttf)(?:$|[?#])/iu,
]);

const QIDIAN_RECOGNIZED_NODE_KINDS = new Set([
  'navigation-state',
  'page-type',
  'search-form',
  'content-link',
  'book-link',
  'chapter-link',
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
  'recovery-entry',
  'manual-risk',
  'manual-risk-state',
]);

const QIDIAN_SENSITIVE_NODE_KINDS = new Set([
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
  'recovery-entry',
  'manual-risk',
  'manual-risk-state',
]);

const QIDIAN_PAGE_TYPES = new Set([
  'home',
  'search-results-page',
  'book-detail-page',
  'chapter-page',
  'category-page',
  'auth-page',
  'utility-page',
]);

const QIDIAN_CATEGORY_PATH_SEGMENTS = new Set([
  '2cy',
  'all',
  'boy',
  'coverrec',
  'dushi',
  'finish',
  'free',
  'junshi',
  'kehuan',
  'lingyi',
  'lishi',
  'mm',
  'qihuan',
  'rank',
  'sanjiang',
  'strongrec',
  'tiyu',
  'wuxia',
  'xianshi',
  'xianxia',
  'xuanhuan',
  'youxi',
]);

export const QIDIAN_TERMINOLOGY = Object.freeze({
  entityLabel: 'book',
  entityPlural: 'books',
  personLabel: 'author',
  personPlural: 'authors',
  searchLabel: 'search books',
  openEntityLabel: 'open book',
  openPersonLabel: 'open author page',
  downloadLabel: 'download book',
  verifiedTaskLabel: 'book / chapter / bookshelf',
});

const INTENT_LABELS = Object.freeze({
  'search-book': 'search books',
  'search-content': 'search books',
  'open-book': 'open book',
  'open-chapter': 'open chapter',
  'open-author': 'open author page',
  'open-category': 'open category page',
  'open-utility-page': 'open utility page',
  'download-book': 'download book',
});

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function qidianPath(value) {
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

function qidianPageTypeFromPath(pathname = '/') {
  const normalizedPath = String(pathname || '/').trim().replace(/\/+$/u, '') || '/';
  if (normalizedPath === '/') {
    return 'home';
  }
  if (/^\/soushu(?:\/|$)/iu.test(normalizedPath)) {
    return 'search-results-page';
  }
  if (/^\/book\/\d+$/iu.test(normalizedPath)) {
    return 'book-detail-page';
  }
  if (/^\/chapter\/\d+\/\d+$/iu.test(normalizedPath)) {
    return 'chapter-page';
  }
  const firstSegment = normalizedPath.split('/').filter(Boolean)[0]?.toLowerCase() ?? '';
  if (QIDIAN_CATEGORY_PATH_SEGMENTS.has(firstSegment) || /^\/category\/\d+$/iu.test(normalizedPath)) {
    return 'category-page';
  }
  if (/^\/(?:bookcase|user|account|profile|help)(?:\/|$)/iu.test(normalizedPath)) {
    return 'utility-page';
  }
  if (/\/(?:login|register|signin|signup)(?:\/|$)/iu.test(normalizedPath)) {
    return 'auth-page';
  }
  return null;
}

function qidianPageTypeFromItem(item = /** @type {any} */ ({})) {
  const rawPageType =
    item.pageType
    ?? item.semanticPageType
    ?? item.evidence?.pageType
    ?? (String(item.nodeKind ?? item.kind ?? '').trim() === 'page-type'
      ? String(item.label ?? '').replace(/^pageType\./iu, '')
      : undefined);
  const pageType = normalizeText(rawPageType);
  if (pageType && QIDIAN_PAGE_TYPES.has(pageType)) {
    return pageType;
  }
  return qidianPageTypeFromPath(qidianPath(item.locator ?? item.url ?? item.path));
}

function qidianNodeKind(item = /** @type {any} */ ({})) {
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

function qidianEndpoint(item = /** @type {any} */ ({})) {
  return normalizeText(
    item.locator
      ?? item.url
      ?? item.endpoint?.url
      ?? item.path
      ?? item.route,
  );
}

function qidianApiPath(item = /** @type {any} */ ({})) {
  return qidianPath(qidianEndpoint(item));
}

function isReadOnlyMethod(candidate = /** @type {any} */ ({})) {
  const method = String(candidate?.endpoint?.method ?? candidate?.method ?? 'GET').trim().toUpperCase();
  return method === 'GET' || method === 'HEAD';
}

function isQidianSiteKey(value) {
  const siteKey = String(value ?? '').trim().toLowerCase();
  return siteKey === 'qidian' || siteKey === 'www.qidian.com';
}

function isQidianHost(host) {
  return QIDIAN_HOSTS.includes(String(host ?? '').toLowerCase());
}

function isQidianExecutableApiPath(pathname) {
  return /^\/(?:ajax|api)\//iu.test(String(pathname ?? ''))
    || /^\/webcommon\/(?:book|bookstore|chapterreview|portalOps|search|user)\//iu.test(String(pathname ?? ''))
    || /^\/(?:ajaxbook|ajaxchapter|bookstore|search)(?:\/|$)/iu.test(String(pathname ?? ''));
}

function isQidianApiCandidate(candidate = /** @type {any} */ ({})) {
  const { host, pathname } = endpointParts(candidate);
  return isQidianSiteKey(candidate?.siteKey)
    && isQidianHost(host)
    && isReadOnlyMethod(candidate)
    && isQidianExecutableApiPath(pathname);
}

function qidianApiSemanticsForPath(pathname) {
  if (/^\/ajax\/userinfo\//iu.test(pathname)) {
    return {
      semanticKind: 'read-authenticated-user',
      outputName: 'user_info',
      outputType: 'entity',
    };
  }
  if (/^\/webcommon\/user\/getuserinfo$/iu.test(pathname)) {
    return {
      semanticKind: 'read-authenticated-user',
      outputName: 'user_info',
      outputType: 'entity',
    };
  }
  if (/^\/webcommon\/bookstore\/getsystime$/iu.test(pathname)) {
    return {
      semanticKind: 'read-site-system-time',
      outputName: 'system_time',
      outputType: 'entity',
    };
  }
  if (/^\/ajax\/bookshelf\//iu.test(pathname)) {
    return {
      semanticKind: 'list-bookshelf-books',
      outputName: 'bookshelf_books',
      outputType: 'list',
    };
  }
  if (/^\/ajax\/search\//iu.test(pathname) || /^\/search(?:\/|$)/iu.test(pathname)) {
    return {
      semanticKind: 'search-books',
      outputName: 'books',
      outputType: 'list',
    };
  }
  if (/^\/webcommon\/search\/autocomplete$/iu.test(pathname)) {
    return {
      semanticKind: 'read-search-autocomplete',
      outputName: 'search_suggestions',
      outputType: 'list',
    };
  }
  if (/^\/webcommon\/portalops\/getportaladv$/iu.test(pathname)) {
    return {
      semanticKind: 'read-portal-advertising',
      outputName: 'portal_advertising',
      outputType: 'entity',
    };
  }
  if (/^\/webcommon\/portalops\/getrecord$/iu.test(pathname)) {
    return {
      semanticKind: 'read-portal-game-records',
      outputName: 'portal_game_records',
      outputType: 'list',
    };
  }
  if (/^\/webcommon\/chapterreview\/recommendbooks$/iu.test(pathname)) {
    return {
      semanticKind: 'read-chapter-recommended-books',
      outputName: 'recommended_books',
      outputType: 'list',
    };
  }
  if (/^\/ajax\/comment\/index$/iu.test(pathname)) {
    return {
      semanticKind: 'read-book-comments',
      outputName: 'book_comments',
      outputType: 'list',
    };
  }
  if (/^\/ajax\/book\/getfanshall$/iu.test(pathname)) {
    return {
      semanticKind: 'read-book-fans-hall',
      outputName: 'book_fans_hall',
      outputType: 'list',
    };
  }
  if (/^\/ajax\/book\/getfansrank$/iu.test(pathname)) {
    return {
      semanticKind: 'read-book-fans-rank',
      outputName: 'book_fans_rank',
      outputType: 'list',
    };
  }
  if (/^\/webcommon\/book\/category$/iu.test(pathname)) {
    return {
      semanticKind: 'read-book-catalog',
      outputName: 'book_catalog',
      outputType: 'list',
    };
  }
  if (/^\/webcommon\/book\/fansinfo$/iu.test(pathname)) {
    return {
      semanticKind: 'read-book-fans-info',
      outputName: 'book_fans_info',
      outputType: 'entity',
    };
  }
  if (/^\/webcommon\/book\/getcopyrightinfo$/iu.test(pathname)) {
    return {
      semanticKind: 'read-book-copyright-info',
      outputName: 'book_copyright_info',
      outputType: 'entity',
    };
  }
  if (/^\/webcommon\/book\/getuserdonatebalance$/iu.test(pathname)) {
    return {
      semanticKind: 'read-user-donate-balance',
      outputName: 'user_donate_balance',
      outputType: 'entity',
    };
  }
  if (/^\/webcommon\/book\/getusermonthticket$/iu.test(pathname)) {
    return {
      semanticKind: 'read-user-month-ticket',
      outputName: 'user_month_ticket',
      outputType: 'entity',
    };
  }
  if (/^\/webcommon\/book\/getuserrecomticket$/iu.test(pathname)) {
    return {
      semanticKind: 'read-user-recommend-ticket',
      outputName: 'user_recommend_ticket',
      outputType: 'entity',
    };
  }
  if (/^\/webcommon\/book\/readstatus$/iu.test(pathname)) {
    return {
      semanticKind: 'read-book-reading-status',
      outputName: 'book_reading_status',
      outputType: 'entity',
    };
  }
  if (/^\/ajax\/book\//iu.test(pathname) || /^\/bookstore(?:\/|$)/iu.test(pathname)) {
    return {
      semanticKind: 'read-book-metadata',
      outputName: 'book_metadata',
      outputType: 'entity',
    };
  }
  if (/^\/ajax\/chapter\//iu.test(pathname) || /^\/ajaxchapter(?:\/|$)/iu.test(pathname)) {
    return {
      semanticKind: 'read-chapter-metadata',
      outputName: 'chapter_metadata',
      outputType: 'entity',
    };
  }
  return {
    semanticKind: 'qidian-readonly-api',
    outputName: 'qidian_api_response',
    outputType: 'unknown',
  };
}

const QIDIAN_BUILD_API_SEEDS = Object.freeze([
  Object.freeze({
    id: 'qidian-known-api-book-catalog',
    semanticKind: 'read-book-catalog',
    url: 'https://www.qidian.com/webcommon/book/category?bookId=1042256511',
    responseEvidence: Object.freeze({
      statusCode: 0,
    }),
    parameterSource: Object.freeze({
      kind: 'qidian_yuew_sign',
    }),
  }),
  Object.freeze({
    id: 'qidian-known-api-book-comments',
    semanticKind: 'read-book-comments',
    url: 'https://www.qidian.com/ajax/comment/index?bookId=1042256511&pageSize=15',
    responseEvidence: Object.freeze({
      statusCode: 0,
    }),
    parameterSource: Object.freeze({
      kind: 'qidian_yuew_sign',
      pageUrl: 'https://www.qidian.com/book/1042256511',
    }),
  }),
  Object.freeze({
    id: 'qidian-known-api-book-copyright-info',
    semanticKind: 'read-book-copyright-info',
    url: 'https://www.qidian.com/webcommon/book/getCopyRightInfo?bookId=1042256511',
    responseEvidence: Object.freeze({
      statusCode: 0,
    }),
    parameterSource: Object.freeze({
      kind: 'qidian_yuew_sign',
    }),
  }),
  Object.freeze({
    id: 'qidian-known-api-book-fans-hall',
    semanticKind: 'read-book-fans-hall',
    url: 'https://www.qidian.com/ajax/book/getFansHall?bookId=1042256511',
    responseEvidence: Object.freeze({
      statusCode: 0,
    }),
    parameterSource: Object.freeze({
      kind: 'qidian_yuew_sign',
      pageUrl: 'https://www.qidian.com/book/1042256511',
    }),
  }),
  Object.freeze({
    id: 'qidian-known-api-book-fans-info',
    semanticKind: 'read-book-fans-info',
    url: 'https://www.qidian.com/webcommon/book/fansInfo?bookId=1042256511',
    responseEvidence: Object.freeze({
      statusCode: 0,
    }),
    parameterSource: Object.freeze({
      kind: 'qidian_yuew_sign',
    }),
  }),
  Object.freeze({
    id: 'qidian-known-api-book-fans-rank',
    semanticKind: 'read-book-fans-rank',
    url: 'https://www.qidian.com/ajax/book/GetFansRank?bookId=1042256511',
    responseEvidence: Object.freeze({
      statusCode: 0,
    }),
    parameterSource: Object.freeze({
      kind: 'qidian_yuew_sign',
      pageUrl: 'https://www.qidian.com/book/1042256511',
    }),
  }),
  Object.freeze({
    id: 'qidian-known-api-book-read-status',
    semanticKind: 'read-book-reading-status',
    url: 'https://www.qidian.com/webcommon/book/readStatus?bookId=1042256511',
    responseEvidence: Object.freeze({
      statusCode: 0,
    }),
    parameterSource: Object.freeze({
      kind: 'qidian_yuew_sign',
    }),
  }),
  Object.freeze({
    id: 'qidian-known-api-user-donate-balance',
    semanticKind: 'read-user-donate-balance',
    url: 'https://www.qidian.com/webcommon/book/getUserDonateBalance',
    responseEvidence: Object.freeze({
      statusCode: 0,
    }),
    parameterSource: Object.freeze({
      kind: 'qidian_yuew_sign',
    }),
  }),
  Object.freeze({
    id: 'qidian-known-api-user-month-ticket',
    semanticKind: 'read-user-month-ticket',
    url: 'https://www.qidian.com/webcommon/book/getUserMonthTicket?bookId=1042256511&userLevel=0',
    responseEvidence: Object.freeze({
      statusCode: 0,
    }),
    parameterSource: Object.freeze({
      kind: 'qidian_yuew_sign',
    }),
  }),
  Object.freeze({
    id: 'qidian-known-api-user-recommend-ticket',
    semanticKind: 'read-user-recommend-ticket',
    url: 'https://www.qidian.com/webcommon/book/getUserRecomTicket?bookId=1042256511&userLevel=0',
    responseEvidence: Object.freeze({
      statusCode: 0,
    }),
    parameterSource: Object.freeze({
      kind: 'qidian_yuew_sign',
    }),
  }),
  Object.freeze({
    id: 'qidian-known-api-chapter-recommended-books',
    semanticKind: 'read-chapter-recommended-books',
    url: 'https://www.qidian.com/webcommon/chapterreview/recommendbooks',
    responseEvidence: Object.freeze({
      statusCode: 0,
    }),
    parameterSource: Object.freeze({
      kind: 'qidian_yuew_sign',
    }),
  }),
  Object.freeze({
    id: 'qidian-known-api-portal-advertising',
    semanticKind: 'read-portal-advertising',
    url: 'https://www.qidian.com/webcommon/portalOps/getPortalAdv',
    responseEvidence: Object.freeze({
      statusCode: 0,
    }),
    parameterSource: Object.freeze({
      kind: 'qidian_yuew_sign',
    }),
  }),
  Object.freeze({
    id: 'qidian-known-api-portal-game-records',
    semanticKind: 'read-portal-game-records',
    url: 'https://www.qidian.com/webcommon/portalOps/getRecord',
    responseEvidence: Object.freeze({
      statusCode: 0,
    }),
    parameterSource: Object.freeze({
      kind: 'qidian_yuew_sign',
    }),
  }),
  Object.freeze({
    id: 'qidian-known-api-search-autocomplete',
    semanticKind: 'read-search-autocomplete',
    url: 'https://www.qidian.com/webcommon/search/autoComplete?siteid=1&query=%E5%89%91',
    responseEvidence: null,
    parameterSource: Object.freeze({
      kind: 'qidian_yuew_sign',
    }),
  }),
  Object.freeze({
    id: 'qidian-known-api-user-info',
    semanticKind: 'read-authenticated-user',
    url: 'https://www.qidian.com/webcommon/user/getUserInfo',
    responseEvidence: Object.freeze({
      statusCode: 0,
      objectField: 'data',
    }),
    parameterSource: Object.freeze({
      kind: 'qidian_yuew_sign',
    }),
  }),
  Object.freeze({
    id: 'qidian-known-api-system-time',
    semanticKind: 'read-site-system-time',
    url: 'https://www.qidian.com/webcommon/bookstore/getsystime',
    responseEvidence: Object.freeze({
      statusCode: 0,
      objectField: 'data',
    }),
    parameterSource: Object.freeze({
      kind: 'qidian_yuew_sign',
    }),
  }),
]);

function buildQidianApiDiscoverySeeds({ siteKey = 'qidian' } = {}) {
  return QIDIAN_BUILD_API_SEEDS.map((seed) => ({
    id: seed.id,
    siteKey,
    status: 'observed',
    method: 'GET',
    url: seed.url,
    resourceType: 'fetch',
    source: 'site-adapter.build-api-seed',
    evidence: {
      event: 'site-adapter-build-api-seed',
      source: 'qidian-known-site-query',
      semanticKind: seed.semanticKind,
      observedOnly: true,
      rawMaterialPersisted: false,
    },
    request: {
      headers: {
        Accept: 'application/json, text/plain;q=0.8, */*;q=0.1',
        Origin: 'https://www.qidian.com',
        Referer: 'https://www.qidian.com/',
      },
      body: {},
    },
    runtime: {
      semanticKind: seed.semanticKind,
      endpointTemplate: seed.url,
      responseEvidence: seed.responseEvidence,
      parameterSource: seed.parameterSource,
      runtimeParameterResolution: 'browser_bridge_page_context_qidian_yuew_sign',
      rawParameterMaterialPersisted: false,
    },
  }));
}

const QIDIAN_HEALTH_SIGNAL_MAP = Object.freeze({
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
  'risk-control': Object.freeze({
    type: 'platform-risk-detected',
    severity: 'high',
    affectedCapability: 'auth.challenge',
    autoRecoverable: false,
    requiresUserAction: true,
  }),
  'waf-challenge': Object.freeze({
    type: 'platform-risk-detected',
    severity: 'high',
    affectedCapability: 'browser.bridge',
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

function normalizeQidianHealthSignal(rawSignal = /** @type {any} */ ({})) {
  const signal = typeof rawSignal === 'string'
    ? rawSignal
    : String(rawSignal?.rawSignal ?? rawSignal?.signal ?? rawSignal?.reasonCode ?? 'unknown-health-risk');
  const mapped = QIDIAN_HEALTH_SIGNAL_MAP[signal] ?? {
    type: 'unknown-health-risk',
    severity: 'medium',
    autoRecoverable: false,
    requiresUserAction: true,
  };
  return {
    siteId: 'qidian',
    rawSignal: signal,
    ...mapped,
    affectedCapability: rawSignal?.affectedCapability ?? rawSignal?.capabilityKey ?? mapped.affectedCapability,
  };
}

export const qidianAdapter = createCatalogAdapter({
  id: 'qidian',
  hosts: QIDIAN_HOSTS,
  terminology: QIDIAN_TERMINOLOGY,
  intentLabels: INTENT_LABELS,
  inferPageType({ pathname = '/' } = /** @type {any} */ ({})) {
    return qidianPageTypeFromPath(pathname);
  },
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  classifyNode(item = /** @type {any} */ ({})) {
    const nodeKind = qidianNodeKind(item);
    if (nodeKind && QIDIAN_SENSITIVE_NODE_KINDS.has(nodeKind)) {
      return recognizedDecision(item, `qidian:${nodeKind}`);
    }
    const pageType = qidianPageTypeFromItem(item);
    if (pageType) {
      return recognizedDecision(item, `qidian:${pageType}`);
    }
    if (nodeKind && QIDIAN_RECOGNIZED_NODE_KINDS.has(nodeKind)) {
      return recognizedDecision(item, `qidian:${nodeKind}`);
    }
    if (nodeKind === 'artifact-ref') {
      return ignoredDecision(
        item,
        'Qidian discovery artifact reference is recorded elsewhere and is not a site capability node.',
      );
    }
    return {
      classification: 'unknown',
      required: Boolean(item.required),
    };
  },
  classifyApi(item = /** @type {any} */ ({})) {
    const endpoint = qidianEndpoint(item);
    const path = qidianApiPath(item);
    if (!endpoint) {
      return {
        classification: 'unknown',
        required: Boolean(item.required),
      };
    }
    if (QIDIAN_IGNORED_REQUEST_PATTERNS.some((pattern) => pattern.test(endpoint))) {
      return ignoredDecision(
        item,
        'Static, browser-support, or WAF probe request is outside Qidian capability coverage.',
      );
    }
    if (isQidianExecutableApiPath(path)) {
      return recognizedDecision(item, `qidian:observed-api:${path || '/'}`);
    }
    if (qidianPageTypeFromPath(path)) {
      return recognizedDecision(item, `qidian:page-request:${path || '/'}`);
    }
    return ignoredDecision(
      item,
      'Observed Qidian request is non-required until the Qidian SiteAdapter promotes it.',
    );
  },
  describeApiCandidateSemantics({
    candidate,
    scope = /** @type {any} */ ({}),
  } = /** @type {any} */ ({})) {
    const { host, pathname } = endpointParts(candidate);
    const semantics = qidianApiSemanticsForPath(pathname);
    const normalized = normalizeSiteAdapterSemanticEntry({
      candidate,
      semantics: {
        auth: {
          ...(candidate?.auth ?? {}),
          authenticationRequired: true,
          credentialPolicy: 'redacted-cookie-or-browser-bridge-session-only',
        },
        pagination: {
          ...(candidate?.pagination ?? {}),
          model: semantics.outputType === 'list' ? 'page-number-or-site-response' : 'none',
          pageParam: semantics.outputType === 'list' ? 'page' : null,
        },
        fieldMapping: {
          ...(candidate?.fieldMapping ?? {}),
          outputName: semantics.outputName,
          outputType: semantics.outputType,
        },
        risk: {
          ...(candidate?.risk ?? {}),
          hints: [
            'Qidian WAF can return a browser probe page before API data',
            'raw cookies and challenge material must stay out of persisted artifacts',
          ],
          rawMaterialPersisted: false,
        },
      },
      scope: {
        semanticMode: 'qidian-api-candidate',
        endpointHost: host,
        endpointPath: pathname,
        semanticKind: semantics.semanticKind,
        ...scope,
      },
    }, {
      adapterId: 'qidian',
      adapterVersion: QIDIAN_ADAPTER_VERSION,
      siteKey: 'qidian',
    });
    return {
      ...normalized,
      ...semantics,
    };
  },
  getBuildApiDiscoverySeeds({ site } = /** @type {any} */ ({})) {
    const siteKey = isQidianSiteKey(site?.id) ? site.id : 'qidian';
    return buildQidianApiDiscoverySeeds({ siteKey });
  },
  validateApiCandidate({
    candidate,
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    validatedAt,
  } = /** @type {any} */ ({})) {
    const { host, pathname } = endpointParts(candidate);
    const accepted = isQidianApiCandidate(candidate);
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 'qidian',
      adapterVersion: QIDIAN_ADAPTER_VERSION,
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 'qidian-api-candidate',
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
    const accepted = siteAdapterDecision?.decision === 'accepted' && isQidianApiCandidate(candidate);
    const policy = normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'qidian',
      adapterVersion: QIDIAN_ADAPTER_VERSION,
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 'qidian-api',
        endpointHost: host,
        endpointPath: pathname,
        ...scope,
      },
      evidence,
    }, {
      candidate,
      siteAdapterDecision,
    });
    return {
      ...policy,
      adapterVersion: QIDIAN_ADAPTER_VERSION,
    };
  },
  normalizeHealthSignal: normalizeQidianHealthSignal,
});
