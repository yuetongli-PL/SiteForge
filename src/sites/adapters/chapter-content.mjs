// @ts-check

import { genericNavigationAdapter } from './generic-navigation.mjs';
import { resolveProfileArchetype } from '../registry/core/archetypes.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';

const CHAPTER_CONTENT_ADAPTER_VERSION = '2026-05-10';

const QIDIAN_RECOGNIZED_PAGE_TYPES = new Set([
  'home',
  'search-results-page',
  'book-detail-page',
  'chapter-page',
  'category-page',
  'auth-page',
]);

const QIDIAN_RECOGNIZED_NODE_KINDS = new Set([
  'navigation-state',
  'page-type',
  'search-form',
  'content-link',
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

const QIDIAN_IGNORED_NODE_KINDS = new Set([
  'artifact-ref',
]);

const QIDIAN_IGNORED_API_PATTERNS = [
  /\/(?:favicon|robots\.txt)(?:$|[?#])/iu,
  /\/(?:static|assets|js|css|images?|font)s?\//iu,
  /\.(?:css|js|png|jpe?g|webp|gif|svg|ico|woff2?|ttf)(?:$|[?#])/iu,
];

const BZ888_RECOGNIZED_PAGE_TYPES = new Set([
  'home',
  'search-results-page',
  'book-detail-page',
  'chapter-page',
  'category-page',
  'auth-page',
  'limited-page',
  'restriction-page',
  'unknown-page',
]);

const BZ888_RECOGNIZED_NODE_KINDS = new Set([
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
  'ocr-image-text',
  'chapter-body-image',
]);

const BZ888_SENSITIVE_NODE_KINDS = new Set([
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

const BZ888_IGNORED_API_PATTERNS = [
  /\/(?:favicon|robots\.txt)(?:$|[?#])/iu,
  /\/cdn-cgi\/(?:challenge-platform|speculation|trace)(?:\/|$|[?#])/iu,
  /\/(?:static|assets|js|css|images?|font)s?\//iu,
  /\.(?:css|js|png|jpe?g|webp|gif|svg|ico|woff2?|ttf)(?:$|[?#])/iu,
];

const CHAPTER_CONTENT_SITES = new Set([
  'qidian',
  'www.qidian.com',
  'bz888',
  'www.bz888888888.com',
  'chapter-content',
]);

const {
  validateApiCandidate: _genericValidateApiCandidate,
  getApiCatalogUpgradePolicy: _genericGetApiCatalogUpgradePolicy,
  ...genericAdapterDefaults
} = genericNavigationAdapter;

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function qidianDiscoveryContext(context = /** @type {any} */ ({})) {
  return String(context.siteKey ?? '').toLowerCase() === 'qidian';
}

function bz888DiscoveryContext(context = /** @type {any} */ ({})) {
  return String(context.siteKey ?? '').toLowerCase() === 'bz888'
    || String(context.host ?? '').toLowerCase() === 'www.bz888888888.com';
}

function qidianUrlPath(value) {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }
  try {
    return new URL(text).pathname;
  } catch {
    return text;
  }
}

function qidianRecognizedPageType(item = /** @type {any} */ ({})) {
  const rawPageType =
    item.pageType
    ?? item.semanticPageType
    ?? item.evidence?.pageType
    ?? (String(item.nodeKind ?? item.kind ?? '').trim() === 'page-type'
      ? String(item.label ?? '').replace(/^pageType\./iu, '')
      : undefined);
  const pageType = normalizeText(rawPageType);
  return pageType && QIDIAN_RECOGNIZED_PAGE_TYPES.has(pageType) ? pageType : undefined;
}

function qidianPageTypeFromLocator(item = /** @type {any} */ ({})) {
  const path = qidianUrlPath(item.locator ?? item.url ?? item.path);
  if (path === '/' || path === '') {
    return 'home';
  }
  if (/^\/soushu(?:\/|$)/iu.test(path)) {
    return 'search-results-page';
  }
  if (/^\/book\/\d+\/?$/iu.test(path)) {
    return 'book-detail-page';
  }
  if (/^\/chapter\/\d+\/\d+\/?$/iu.test(path)) {
    return 'chapter-page';
  }
  if (/^\/(?:all|rank|finish|free|mm|boy)(?:\/|$)/iu.test(path)) {
    return 'category-page';
  }
  if (/\/(?:login|register|signin|signup)(?:\/|$)/iu.test(path)) {
    return 'auth-page';
  }
  return undefined;
}

function bz888PageTypeFromLocator(item = /** @type {any} */ ({})) {
  const path = qidianUrlPath(item.locator ?? item.url ?? item.path);
  if (path === '/' || path === '') {
    return 'home';
  }
  if (/\/(?:search|s|ss|modules\/article\/search)(?:\/|\.php|$)/iu.test(path)) {
    return 'search-results-page';
  }
  if (/\/(?:book|novel|txt|b|biqu)\d*\/?\d*\/?$/iu.test(path) || /^\/\d+\/?$/u.test(path)) {
    return 'book-detail-page';
  }
  if (/\/(?:book|novel|txt|b|biqu)?\d+\/\d+(?:_\d+)?\.html$/iu.test(path)) {
    return 'chapter-page';
  }
  if (/\/(?:sort|class|category|list|quanben|rank|top)(?:\/|$)/iu.test(path)) {
    return 'category-page';
  }
  if (/\/(?:login|register|user|member)(?:\/|$)/iu.test(path)) {
    return 'auth-page';
  }
  if (/\/cdn-cgi\/challenge-platform(?:\/|$)/iu.test(path)) {
    return 'restriction-page';
  }
  return undefined;
}

function qidianNodeKind(item = /** @type {any} */ ({})) {
  return normalizeText(item.nodeKind ?? item.kind ?? item.type);
}

function recognizedNodeDecision(item, recognizedAs) {
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

function qidianApiEndpoint(item = /** @type {any} */ ({})) {
  return normalizeText(
    item.locator
      ?? item.url
      ?? item.endpoint?.url
      ?? item.path
      ?? item.route,
  );
}

function qidianApiPath(item = /** @type {any} */ ({})) {
  return qidianUrlPath(qidianApiEndpoint(item));
}

function candidateHost(candidate = /** @type {any} */ ({})) {
  try {
    return new URL(qidianApiEndpoint(candidate) ?? '').hostname.toLowerCase();
  } catch {
    return '';
  }
}

function candidatePath(candidate = /** @type {any} */ ({})) {
  try {
    return new URL(qidianApiEndpoint(candidate) ?? '').pathname || '/';
  } catch {
    return qidianApiPath(candidate);
  }
}

function chapterContentCandidateSiteAllowed(candidate = /** @type {any} */ ({})) {
  const siteKey = String(candidate?.siteKey ?? '').trim().toLowerCase();
  const host = candidateHost(candidate);
  return CHAPTER_CONTENT_SITES.has(siteKey)
    || CHAPTER_CONTENT_SITES.has(host);
}

function chapterContentApiClassification(candidate = /** @type {any} */ ({})) {
  const siteKey = String(candidate?.siteKey ?? '').trim().toLowerCase();
  const host = candidateHost(candidate);
  const context = {
    siteKey: CHAPTER_CONTENT_SITES.has(siteKey) ? siteKey : host,
    host,
  };
  if (bz888DiscoveryContext(context)) {
    return chapterContentAdapter.classifyApi(candidate, context);
  }
  if (qidianDiscoveryContext(context)) {
    return chapterContentAdapter.classifyApi(candidate, context);
  }
  return { classification: 'unknown', required: Boolean(candidate?.required) };
}

export const chapterContentAdapter = Object.freeze({
  ...genericAdapterDefaults,
  id: 'chapter-content',
  version: CHAPTER_CONTENT_ADAPTER_VERSION,
  siteKey({ host, profile } = /** @type {any} */ ({})) {
    const resolvedHost = String(host ?? profile?.host ?? '').toLowerCase();
    if (resolvedHost === 'www.qidian.com') {
      return 'qidian';
    }
    if (resolvedHost === 'www.bz888888888.com') {
      return 'bz888';
    }
    return 'chapter-content';
  },
  matches({ host, profile } = /** @type {any} */ ({})) {
    const resolvedHost = String(host ?? profile?.host ?? '').toLowerCase();
    return resolveProfileArchetype(profile, { host }) === 'chapter-content'
      || resolvedHost === 'www.qidian.com'
      || resolvedHost === 'www.bz888888888.com'
      || Boolean(profile?.bookDetail && profile?.chapter);
  },
  inferPageType({ pathname = '/', hostname = '' } = /** @type {any} */ ({})) {
    const resolvedHost = String(hostname ?? '').toLowerCase();
    if (resolvedHost === 'www.bz888888888.com') {
      return bz888PageTypeFromLocator({ path: pathname }) ?? null;
    }
    if (resolvedHost !== 'www.qidian.com') {
      return null;
    }
    const normalizedPath = String(pathname || '/');
    if (normalizedPath === '/' || normalizedPath === '') {
      return 'home';
    }
    if (/^\/soushu(?:\/|$)/iu.test(normalizedPath)) {
      return 'search-results-page';
    }
    if (/^\/book\/\d+\/?$/iu.test(normalizedPath)) {
      return 'book-detail-page';
    }
    if (/^\/chapter\/\d+\/\d+\/?$/iu.test(normalizedPath)) {
      return 'chapter-page';
    }
    if (/^\/(?:all|rank|finish|free|mm|boy)(?:\/|$)/iu.test(normalizedPath)) {
      return 'category-page';
    }
    if (/\/(?:login|register|signin|signup)(?:\/|$)/iu.test(normalizedPath)) {
      return 'auth-page';
    }
    return null;
  },
  classifyNode(item = /** @type {any} */ ({}), context = /** @type {any} */ ({})) {
    if (bz888DiscoveryContext(context)) {
      const nodeKind = qidianNodeKind(item);
      if (nodeKind && BZ888_SENSITIVE_NODE_KINDS.has(nodeKind)) {
        return recognizedNodeDecision(item, `bz888:${nodeKind}`);
      }
      const pageType = qidianRecognizedPageType(item) ?? bz888PageTypeFromLocator(item);
      if (pageType && BZ888_RECOGNIZED_PAGE_TYPES.has(pageType)) {
        return recognizedNodeDecision(item, `bz888:${pageType}`);
      }
      if (nodeKind && BZ888_RECOGNIZED_NODE_KINDS.has(nodeKind)) {
        return recognizedNodeDecision(item, `bz888:${nodeKind}`);
      }
      return {
        classification: 'unknown',
        required: Boolean(item.required),
      };
    }

    if (!qidianDiscoveryContext(context)) {
      return genericAdapterDefaults.classifyNode(/** @type {any} */ (item));
    }

    const nodeKind = qidianNodeKind(item);
    if (nodeKind && QIDIAN_SENSITIVE_NODE_KINDS.has(nodeKind)) {
      return recognizedNodeDecision(item, `qidian:${nodeKind}`);
    }
    const pageType = qidianRecognizedPageType(item) ?? qidianPageTypeFromLocator(item);
    if (pageType) {
      return recognizedNodeDecision(item, `qidian:${pageType}`);
    }
    if (nodeKind && QIDIAN_RECOGNIZED_NODE_KINDS.has(nodeKind)) {
      return recognizedNodeDecision(item, `qidian:${nodeKind}`);
    }
    if (nodeKind && QIDIAN_IGNORED_NODE_KINDS.has(nodeKind)) {
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
  classifyApi(item = /** @type {any} */ ({}), context = /** @type {any} */ ({})) {
    if (bz888DiscoveryContext(context)) {
      const endpoint = qidianApiEndpoint(item);
      const path = qidianApiPath(item);
      if (!endpoint) {
        return {
          classification: 'unknown',
          required: Boolean(item.required),
        };
      }
      if (BZ888_IGNORED_API_PATTERNS.some((pattern) => pattern.test(endpoint))) {
        return ignoredDecision(
          item,
          'Static, image, browser-support, or Cloudflare challenge request is outside bz888 chapter-content capability coverage.',
        );
      }
      if (/\/(?:search|s|ss|book|novel|txt|b|biqu|sort|class|category|list|quanben|rank|top)(?:\/|\.php|$)/iu.test(path)) {
        return recognizedNodeDecision(item, `bz888:page-request:${path || '/'}`);
      }
      if (/\/(?:api|ajax|chapter|book|search)(?:\/|$)/iu.test(path)) {
        return recognizedNodeDecision(item, `bz888:observed-api:${path || '/'}`);
      }
      return ignoredDecision(
        item,
        'Observed bz888 request is non-required until a SiteAdapter API contract promotes it.',
      );
    }

    if (!qidianDiscoveryContext(context)) {
      return genericAdapterDefaults.classifyApi(/** @type {any} */ (item));
    }

    const endpoint = qidianApiEndpoint(item);
    const path = qidianApiPath(item);
    if (!endpoint) {
      return {
        classification: 'unknown',
        required: Boolean(item.required),
      };
    }
    if (QIDIAN_IGNORED_API_PATTERNS.some((pattern) => pattern.test(endpoint))) {
      return ignoredDecision(
        item,
        'Static or browser-support request is outside Qidian onboarding capability coverage.',
      );
    }
    if (/^\/(?:soushu|book|chapter|all|rank|finish|free|mm|boy)(?:\/|$)/iu.test(path)) {
      return recognizedNodeDecision(item, `qidian:page-request:${path || '/'}`);
    }
    if (/\/(?:api|ajax|ajaxbook|ajaxchapter|bookstore|search)(?:\/|$)/iu.test(path)) {
      return recognizedNodeDecision(item, `qidian:observed-api:${path || '/'}`);
    }
    return ignoredDecision(
      item,
      'Observed Qidian request is non-required until a SiteAdapter API contract promotes it.',
    );
  },
  validateApiCandidate({
    candidate,
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    validatedAt,
  } = /** @type {any} */ ({})) {
    const siteAllowed = chapterContentCandidateSiteAllowed(candidate);
    const classification = siteAllowed
      ? chapterContentApiClassification(candidate)
      : { classification: 'unknown', required: Boolean(candidate?.required) };
    const accepted = siteAllowed && classification.classification === 'recognized';
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 'chapter-content',
      adapterVersion: CHAPTER_CONTENT_ADAPTER_VERSION,
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 'chapter-content-observed-public-surface',
        path: candidatePath(candidate),
        classification: classification.classification,
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
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    decidedAt,
  } = /** @type {any} */ ({})) {
    const candidateStatus = String(candidate?.status ?? '').trim();
    const accepted = siteAdapterDecision?.decision === 'accepted' && candidateStatus === 'verified';
    return normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'chapter-content',
      adapterVersion: CHAPTER_CONTENT_ADAPTER_VERSION,
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 'chapter-content-explicit-verification-required',
        ...scope,
      },
      evidence,
    }, {
      candidate,
      siteAdapterDecision,
    });
  },
});
