// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterSemanticEntry,
  SITE_ADAPTER_SEMANTIC_ENTRY_VERSION,
} from './generic-navigation.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { inferBilibiliPageTypeFromUrl } from '../known-sites/bilibili/model/page-type.mjs';
import { createCatalogAdapter } from './factory.mjs';

const BILIBILI_HOSTS = Object.freeze([
  'api.bilibili.com',
  'www.bilibili.com',
  'search.bilibili.com',
  'space.bilibili.com',
]);

const BILIBILI_API_HOSTS = Object.freeze(['api.bilibili.com']);

const BILIBILI_API_ENDPOINT_SEMANTICS = Object.freeze({
  '/x/web-interface/view': Object.freeze({
    apiKind: 'video-detail',
    resolverRole: 'view',
    siteSurface: 'video-detail-api',
    auth: Object.freeze({
      authenticationRequired: false,
      credentialPolicy: 'redacted-session-view-only',
    }),
    pagination: Object.freeze({
      model: 'none',
    }),
    fieldMapping: Object.freeze({
      bvidPath: 'data.bvid',
      aidPath: 'data.aid',
      pagesPath: 'data.pages',
      cidPath: 'data.pages[].cid',
      titlePath: 'data.title',
    }),
  }),
  '/x/player/playurl': Object.freeze({
    apiKind: 'playurl',
    resolverRole: 'media-url',
    siteSurface: 'video-playurl-api',
    auth: Object.freeze({
      authenticationRequired: false,
      credentialPolicy: 'redacted-session-view-only',
    }),
    pagination: Object.freeze({
      model: 'none',
    }),
    fieldMapping: Object.freeze({
      dashVideoPath: 'data.dash.video[]',
      dashAudioPath: 'data.dash.audio[]',
      durlPath: 'data.durl[]',
      streamUrlPaths: ['baseUrl', 'base_url', 'url', 'backupUrl[]'],
    }),
  }),
  '/x/polymer/web-space/seasons_archives_list': Object.freeze({
    apiKind: 'space-collection',
    resolverRole: 'playlist-list',
    siteSurface: 'space-collection-api',
    auth: Object.freeze({
      authenticationRequired: false,
      credentialPolicy: 'redacted-session-view-only',
    }),
    pagination: Object.freeze({
      model: 'page-number',
      pageParam: 'page_num',
      pageSizeParam: 'page_size',
      firstPage: 1,
      maxPageSize: 50,
    }),
    fieldMapping: Object.freeze({
      itemsPath: 'data.archives|data.items|data.medias',
      bvidPath: 'bvid',
      aidPath: 'aid|id',
      titlePath: 'title|name',
    }),
  }),
  '/x/space/wbi/arc/search': Object.freeze({
    apiKind: 'space-archives',
    resolverRole: 'playlist-list',
    siteSurface: 'up-space-archives-api',
    auth: Object.freeze({
      authenticationRequired: false,
      credentialPolicy: 'redacted-session-view-only',
      freshnessEvidenceRequired: true,
      signatureEvidenceRequired: 'wbi',
    }),
    pagination: Object.freeze({
      model: 'page-number',
      pageParam: 'pn',
      pageSizeParam: 'ps',
      firstPage: 1,
      maxPageSize: 50,
    }),
    fieldMapping: Object.freeze({
      itemsPath: 'data.list.vlist',
      bvidPath: 'bvid',
      aidPath: 'aid|id',
      titlePath: 'title',
      publishTimePath: 'created|created_at|pubdate',
    }),
    risk: Object.freeze({
      liveApiEvidenceRequired: true,
      riskCodes: [-352, -412],
      riskReasonCode: 'bilibili-api-evidence-unavailable',
    }),
  }),
});

export const BILIBILI_TERMINOLOGY = Object.freeze({
  entityLabel: '\u89c6\u9891',
  entityPlural: '\u89c6\u9891',
  personLabel: 'UP\u4e3b',
  personPlural: 'UP\u4e3b',
  searchLabel: '\u641c\u7d22\u89c6\u9891',
  openEntityLabel: '\u6253\u5f00\u89c6\u9891',
  openPersonLabel: '\u6253\u5f00UP\u4e3b\u4e3b\u9875',
  downloadLabel: '\u4e0b\u8f7d\u89c6\u9891',
  verifiedTaskLabel: '\u89c6\u9891 / UP\u4e3b / \u5206\u533a',
});

const INTENT_LABELS = Object.freeze({
  'search-video': '\u641c\u7d22\u89c6\u9891',
  'search-work': '\u641c\u7d22\u89c6\u9891',
  'search-book': '\u641c\u7d22\u89c6\u9891',
  'open-video': '\u6253\u5f00\u89c6\u9891',
  'open-work': '\u6253\u5f00\u89c6\u9891',
  'open-book': '\u6253\u5f00\u89c6\u9891',
  'open-up': '\u6253\u5f00UP\u4e3b\u4e3b\u9875',
  'open-author': '\u6253\u5f00UP\u4e3b\u4e3b\u9875',
  'open-actress': '\u6253\u5f00UP\u4e3b\u4e3b\u9875',
  'open-category': '\u6253\u5f00\u5206\u533a\u9875',
  'open-utility-page': '\u6253\u5f00\u529f\u80fd\u9875',
});

function endpointParts(candidate = {}) {
  try {
    const parsed = new URL(String(candidate?.endpoint?.url ?? candidate?.url ?? ''));
    return {
      host: parsed.hostname.toLowerCase(),
      pathname: parsed.pathname,
    };
  } catch {
    return {
      host: '',
      pathname: '',
    };
  }
}

function bilibiliEndpointSemantics(pathname) {
  return BILIBILI_API_ENDPOINT_SEMANTICS[pathname] ?? null;
}

function isBilibiliApiCandidate(candidate = {}) {
  const siteKey = String(candidate?.siteKey ?? '').trim();
  const { host, pathname } = endpointParts(candidate);
  return siteKey === 'bilibili'
    && BILIBILI_API_HOSTS.includes(host)
    && Boolean(bilibiliEndpointSemantics(pathname));
}

const BILIBILI_HEALTH_SIGNAL_MAP = Object.freeze({
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

function normalizeBilibiliHealthSignal(rawSignal = {}) {
  const signal = typeof rawSignal === 'string'
    ? rawSignal
    : String(rawSignal?.rawSignal ?? rawSignal?.signal ?? rawSignal?.reasonCode ?? 'unknown-health-risk');
  const mapped = BILIBILI_HEALTH_SIGNAL_MAP[signal] ?? {
    type: 'unknown-health-risk',
    severity: 'medium',
    autoRecoverable: false,
    requiresUserAction: true,
  };
  return {
    siteId: 'bilibili',
    rawSignal: signal,
    ...mapped,
    affectedCapability: rawSignal?.affectedCapability ?? rawSignal?.capabilityKey ?? mapped.affectedCapability,
  };
}

export const bilibiliAdapter = createCatalogAdapter({
  id: 'bilibili',
  hosts: BILIBILI_HOSTS,
  terminology: BILIBILI_TERMINOLOGY,
  intentLabels: INTENT_LABELS,
  inferPageType({ inputUrl }) {
    return inferBilibiliPageTypeFromUrl(inputUrl);
  },
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  describeApiCandidateSemantics(input = {}) {
    const { host, pathname } = endpointParts(input.candidate);
    const semantics = bilibiliEndpointSemantics(pathname);
    return normalizeSiteAdapterSemanticEntry({
      ...input,
      semantics: {
        auth: {
          authenticationRequired: false,
          credentialPolicy: 'redacted-session-view-only',
          ...(semantics?.auth ?? {}),
          ...(input.candidate?.auth ?? {}),
        },
        pagination: {
          ...(semantics?.pagination ?? {}),
          ...(input.candidate?.pagination ?? {}),
        },
        fieldMapping: {
          ...(semantics?.fieldMapping ?? {}),
          ...(input.candidate?.fieldMapping ?? {}),
        },
        risk: {
          downloaderBoundary: 'resolved resource consumer only',
          reasonCodeOnUnavailable: 'bilibili-api-evidence-unavailable',
          hints: [
            'do not persist raw request or response bodies',
            'do not pass raw cookies or SESSDATA to downloader',
          ],
          ...(semantics?.risk ?? {}),
          ...(input.candidate?.risk ?? {}),
        },
      },
      scope: {
        semanticMode: 'bilibili-api-candidate',
        endpointHost: host,
        endpointPath: pathname,
        apiKind: semantics?.apiKind ?? 'unknown',
        resolverRole: semantics?.resolverRole ?? 'unsupported',
        siteSurface: semantics?.siteSurface ?? 'unsupported-api',
        contractVersion: SITE_ADAPTER_SEMANTIC_ENTRY_VERSION,
        ...(input.scope ?? {}),
      },
    }, {
      adapterId: 'bilibili',
      siteKey: 'bilibili',
    });
  },
  validateApiCandidate({
    candidate,
    evidence = {},
    scope = {},
    validatedAt,
  } = {}) {
    const { host, pathname } = endpointParts(candidate);
    const accepted = isBilibiliApiCandidate(candidate);
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 'bilibili',
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 'bilibili-api-candidate',
        endpointHost: host,
        endpointPath: pathname,
        apiKind: bilibiliEndpointSemantics(pathname)?.apiKind ?? 'unsupported',
        resolverRole: bilibiliEndpointSemantics(pathname)?.resolverRole ?? 'unsupported',
        ...scope,
      },
      evidence,
    }, {
      candidate,
    });
  },
  getApiCatalogUpgradePolicy({
    candidate,
    siteAdapterDecision,
    evidence = {},
    scope = {},
    decidedAt,
  } = {}) {
    const { host, pathname } = endpointParts(candidate);
    const accepted = siteAdapterDecision?.decision === 'accepted' && isBilibiliApiCandidate(candidate);
    return normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'bilibili',
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 'bilibili-public-api',
        endpointHost: host,
        endpointPath: pathname,
        apiKind: bilibiliEndpointSemantics(pathname)?.apiKind ?? 'unsupported',
        resolverRole: bilibiliEndpointSemantics(pathname)?.resolverRole ?? 'unsupported',
        ...scope,
      },
      evidence,
    }, {
      candidate,
      siteAdapterDecision,
    });
  },
  normalizeHealthSignal: normalizeBilibiliHealthSignal,
});
