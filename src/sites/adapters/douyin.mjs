// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { inferDouyinPageTypeFromUrl } from '../known-sites/douyin/model/site.mjs';
import { createCatalogAdapter } from './factory.mjs';
import { normalizeSiteAdapterSemanticEntry } from './generic-navigation.mjs';

const DOUYIN_HOSTS = Object.freeze([
  'www.douyin.com',
  'creator.douyin.com',
]);

export const DOUYIN_TERMINOLOGY = Object.freeze({
  entityLabel: '\u89c6\u9891',
  entityPlural: '\u89c6\u9891',
  personLabel: '\u7528\u6237',
  personPlural: '\u7528\u6237',
  searchLabel: '\u641c\u7d22\u89c6\u9891',
  openEntityLabel: '\u6253\u5f00\u89c6\u9891',
  openPersonLabel: '\u6253\u5f00\u7528\u6237\u4e3b\u9875',
  downloadLabel: '\u4e0b\u8f7d\u89c6\u9891',
  verifiedTaskLabel: '\u89c6\u9891/\u7528\u6237/\u5206\u7c7b',
});

const INTENT_LABELS = Object.freeze({
  'search-video': '\u641c\u7d22\u89c6\u9891',
  'search-work': '\u641c\u7d22\u89c6\u9891',
  'search-book': '\u641c\u7d22\u89c6\u9891',
  'open-video': '\u6253\u5f00\u89c6\u9891',
  'open-work': '\u6253\u5f00\u89c6\u9891',
  'open-book': '\u6253\u5f00\u89c6\u9891',
  'open-up': '\u6253\u5f00\u7528\u6237\u4e3b\u9875',
  'open-author': '\u6253\u5f00\u7528\u6237\u4e3b\u9875',
  'open-actress': '\u6253\u5f00\u7528\u6237\u4e3b\u9875',
  'open-model': '\u6253\u5f00\u7528\u6237\u4e3b\u9875',
  'open-category': '\u6253\u5f00\u5206\u7c7b\u9875',
  'open-utility-page': '\u6253\u5f00\u529f\u80fd\u9875',
  'list-followed-users': '\u63d0\u53d6\u5173\u6ce8\u7528\u6237\u5217\u8868',
  'list-followed-updates': '\u63d0\u53d6\u5173\u6ce8\u66f4\u65b0\u89c6\u9891',
});

function parseUrl(input) {
  try {
    return input ? new URL(input) : null;
  } catch {
    return null;
  }
}

function endpointParts(candidate = /** @type {any} */ ({})) {
  const parsed = parseUrl(candidate?.endpoint?.url);
  return {
    host: parsed?.hostname.toLowerCase() ?? '',
    pathname: parsed?.pathname ?? '',
  };
}

function isDouyinSiteKey(value) {
  const siteKey = String(value ?? '').trim();
  return siteKey === 'douyin' || /^douyin\.com-/u.test(siteKey);
}

function isDouyinApiCandidate(candidate = /** @type {any} */ ({})) {
  const { host, pathname } = endpointParts(candidate);
  if (!isDouyinSiteKey(candidate?.siteKey)) {
    return false;
  }
  if (host === 'www.douyin.com') {
    return pathname.startsWith('/aweme/v1/');
  }
  return host === 'creator.douyin.com'
    && (pathname.startsWith('/aweme/v1/') || pathname.startsWith('/web/api/'));
}

const DOUYIN_SELF_PARAMETER_SOURCE = Object.freeze({
  kind: 'douyin_self_user_render_data',
  pageUrl: 'https://www.douyin.com/user/self',
  fields: Object.freeze({
    user_id: 'uid',
    sec_user_id: 'secUid',
  }),
  rawMaterialPersisted: false,
});

const DOUYIN_BUILD_API_SEEDS = Object.freeze([
  Object.freeze({
    id: 'douyin-known-api-following-list',
    semanticKind: 'list-followed-users',
    method: 'GET',
    endpointTemplate: 'https://www.douyin.com/aweme/v1/web/user/following/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&offset=0&min_time=0&max_time=0&count=20&source_type=4&gps_access=0&address_book_access=0&is_top=1&user_id={self.uid}&sec_user_id={self.secUid}',
    responseEvidence: Object.freeze({
      statusCode: 0,
      arrayField: 'followings',
    }),
  }),
  Object.freeze({
    id: 'douyin-known-api-aweme-posts',
    semanticKind: 'list-profile-videos',
    method: 'GET',
    endpointTemplate: 'https://www.douyin.com/aweme/v1/web/aweme/post/?device_platform=webapp&aid=6383&channel=channel_pc_web&max_cursor=0&count=18&user_id={self.uid}&sec_user_id={self.secUid}',
    responseEvidence: Object.freeze({
      statusCode: 0,
      arrayField: 'aweme_list',
    }),
  }),
]);

function douyinApiSemanticsForPath(pathname) {
  if (pathname === '/aweme/v1/web/user/following/list/') {
    return {
      semanticKind: 'list-followed-users',
      name: 'list followed users API',
      description: 'Read the authenticated Douyin following list through a replay-verified read-only API endpoint.',
      object: 'followed users',
      userValue: 'List followed Douyin accounts without follow or unfollow actions.',
      outputName: 'followed_users',
      outputType: 'list',
      intentExamples: [
        'list followed Douyin users',
        'read Douyin following list',
        '\u63d0\u53d6\u6296\u97f3\u5173\u6ce8\u7528\u6237\u5217\u8868',
      ],
    };
  }
  if (pathname === '/aweme/v1/web/aweme/post/') {
    return {
      semanticKind: 'list-profile-videos',
      name: 'list profile videos API',
      description: 'Read replay-verified Douyin profile video posts through a read-only API endpoint.',
      object: 'profile videos',
      userValue: 'List Douyin profile video posts without publishing, liking, or account mutation.',
      outputName: 'videos',
      outputType: 'list',
      intentExamples: [
        'list Douyin profile videos',
        'read Douyin video posts',
        '\u63d0\u53d6\u6296\u97f3\u89c6\u9891\u5217\u8868',
      ],
    };
  }
  if (pathname === '/aweme/v1/web/aweme/detail/') {
    return {
      semanticKind: 'read-video-detail',
      name: 'read video detail API',
      description: 'Read replay-verified Douyin video detail metadata through a read-only API endpoint.',
      object: 'video detail',
      userValue: 'Read Douyin video detail metadata without account mutation.',
      outputName: 'video_detail',
      outputType: 'entity',
      intentExamples: [
        'read Douyin video detail',
        'get Douyin video metadata',
        '\u8bfb\u53d6\u6296\u97f3\u89c6\u9891\u8be6\u60c5',
      ],
    };
  }
  if (/\/user\/info\/?$/u.test(pathname)) {
    return {
      semanticKind: 'read-creator-user-info',
      name: 'read creator user info API',
      description: 'Read replay-verified Douyin creator account user information through a read-only API endpoint.',
      object: 'creator user info',
      userValue: 'Read Douyin creator account information without account mutation.',
      outputName: 'creator_user_info',
      outputType: 'entity',
      intentExamples: [
        'read Douyin creator user info',
        'get creator account info',
        '\u8bfb\u53d6\u6296\u97f3\u521b\u4f5c\u8005\u7528\u6237\u4fe1\u606f',
      ],
    };
  }
  if (pathname === '/aweme/v1/web/oversea/judgment/') {
    return {
      semanticKind: 'read-oversea-judgment',
      name: 'read oversea judgment API',
      description: 'Read replay-verified Douyin regional access judgment through a read-only API endpoint.',
      object: 'regional access judgment',
      userValue: 'Read Douyin regional access status without account mutation.',
      outputName: 'regional_access_status',
      outputType: 'entity',
      intentExamples: [
        'read Douyin regional access status',
        'get Douyin oversea judgment',
        '\u8bfb\u53d6\u6296\u97f3\u5730\u533a\u8bbf\u95ee\u72b6\u6001',
      ],
    };
  }
  return null;
}

function douyinUnsupportedApiSemantics(pathname) {
  return {
    semanticKind: 'unsupported-douyin-api',
    name: 'unsupported Douyin API',
    description: 'Unsupported Douyin API candidate; the adapter can describe it only as a redacted read-only candidate.',
    object: 'unsupported Douyin API response',
    userValue: 'Unsupported Douyin API candidate without activation or catalog promotion.',
    outputName: 'unsupported_douyin_api',
    outputType: 'unknown',
    intentExamples: [],
    endpointPath: pathname,
  };
}

function buildDouyinApiDiscoverySeeds({ siteKey = 'douyin' } = {}) {
  return DOUYIN_BUILD_API_SEEDS.map((seed) => ({
    id: seed.id,
    siteKey,
    status: 'observed',
    method: seed.method,
    url: seed.endpointTemplate,
    resourceType: 'fetch',
    source: 'site-adapter.build-api-seed',
    evidence: {
      event: 'site-adapter-build-api-seed',
      source: 'douyin-known-site-query',
      semanticKind: seed.semanticKind,
      observedOnly: true,
      catalogPromotionAllowed: false,
      rawMaterialPersisted: false,
    },
    request: {
      headers: {
        Origin: 'https://www.douyin.com',
        Referer: 'https://www.douyin.com/user/self',
      },
      body: {},
    },
    runtime: {
      semanticKind: seed.semanticKind,
      endpointTemplate: seed.endpointTemplate,
      parameterSource: DOUYIN_SELF_PARAMETER_SOURCE,
      responseEvidence: seed.responseEvidence,
      runtimeParameterResolution: 'browser_bridge_page_context_or_build_time_cookie_replay',
      rawParameterMaterialPersisted: false,
    },
  }));
}

const DOUYIN_HEALTH_SIGNAL_MAP = Object.freeze({
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

function normalizeDouyinHealthSignal(rawSignal = /** @type {any} */ ({})) {
  const signal = typeof rawSignal === 'string'
    ? rawSignal
    : String(rawSignal?.rawSignal ?? rawSignal?.signal ?? rawSignal?.reasonCode ?? 'unknown-health-risk');
  const mapped = DOUYIN_HEALTH_SIGNAL_MAP[signal] ?? {
    type: 'unknown-health-risk',
    severity: 'medium',
    autoRecoverable: false,
    requiresUserAction: true,
  };
  return {
    siteId: 'douyin',
    rawSignal: signal,
    ...mapped,
    affectedCapability: rawSignal?.affectedCapability ?? rawSignal?.capabilityKey ?? mapped.affectedCapability,
  };
}

export const douyinAdapter = createCatalogAdapter({
  id: 'douyin',
  hosts: DOUYIN_HOSTS,
  terminology: DOUYIN_TERMINOLOGY,
  intentLabels: INTENT_LABELS,
  inferPageType({ inputUrl }) {
    return inferDouyinPageTypeFromUrl(inputUrl);
  },
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  describeApiCandidateSemantics({
    candidate,
    scope = /** @type {any} */ ({}),
  } = /** @type {any} */ ({})) {
    const { pathname } = endpointParts(candidate);
    const semantics = douyinApiSemanticsForPath(pathname) ?? douyinUnsupportedApiSemantics(pathname);
    const normalized = normalizeSiteAdapterSemanticEntry({
      candidate,
      semantics: {
        auth: {
          ...(candidate?.auth ?? {}),
          authenticationRequired: true,
          credentialPolicy: 'redacted-session-view-only',
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
          reasonCodeOnUnavailable: 'douyin-api-evidence-unavailable',
          rawMaterialPersisted: false,
          catalogPromotionAllowed: false,
          ...(candidate?.risk ?? {}),
        },
      },
      scope: {
        semanticMode: 'douyin-api-candidate',
        endpointPath: pathname,
        semanticKind: semantics.semanticKind,
        ...scope,
      },
    }, {
      adapterId: 'douyin',
      siteKey: 'douyin',
    });
    return {
      ...normalized,
      ...semantics,
    };
  },
  getBuildApiDiscoverySeeds({ site } = /** @type {any} */ ({})) {
    const siteKey = isDouyinSiteKey(site?.id) ? site.id : 'douyin';
    return buildDouyinApiDiscoverySeeds({ siteKey });
  },
  validateApiCandidate({
    candidate,
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    validatedAt,
  } = /** @type {any} */ ({})) {
    const { host, pathname } = endpointParts(candidate);
    const accepted = isDouyinApiCandidate(candidate);
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 'douyin',
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 'douyin-api-candidate',
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
    const accepted = siteAdapterDecision?.decision === 'accepted' && isDouyinApiCandidate(candidate);
    return normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'douyin',
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 'douyin-aweme-api',
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
  normalizeHealthSignal: normalizeDouyinHealthSignal,
});
