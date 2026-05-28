// @ts-check

import {
  BUILD_SCHEMA_VERSION,
  normalizeUrl,
} from './models.mjs';
import { routePatternForUrl } from './html.mjs';
import { sanitizeReportPublicValue } from './user-report-values.mjs';

export function browserBridgeRouteCaptured(result = /** @type {any} */ ({})) {
  return ['captured', 'captured_with_warning'].includes(String(result?.status ?? '').trim())
    && result?.captured !== false;
}

export function browserBridgeRouteRetryable(result = /** @type {any} */ ({})) {
  const status = String(result?.status ?? '').trim();
  const reasonCode = String(result?.reasonCode ?? '').trim();
  if (status === 'challenge_detected' && reasonCode === 'browser-bridge-definite-challenge') {
    return false;
  }
  if (['timeout', 'challenge_detected', 'thin_capture'].includes(status)) {
    return true;
  }
  if (status !== 'blocked') {
    return false;
  }
  return [
    'browser-bridge-collector-injection-failed',
    'browser-bridge-route-open-failed',
    'execute-script-failed',
    'collector-message-failed',
    'navigation-in-progress',
    'tab-missing',
  ].includes(reasonCode);
}

export function routeTemplateComparisonValues(context = /** @type {any} */ ({}), values = /** @type {any[]} */ ([])) {
  const variants = new Set();
  const addVariant = (value) => {
    const text = String(value ?? '').trim();
    if (!text) {
      return;
    }
    variants.add(text);
    if (text !== '/' && text.endsWith('/')) {
      variants.add(text.replace(/\/+$/u, ''));
    } else if (text !== '/') {
      variants.add(`${text}/`);
    }
  };
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text) {
      continue;
    }
    addVariant(text.split(/[?#]/u)[0] || text);
    try {
      const normalizedUrl = normalizeUrl(text, context.site?.rootUrl);
      const parsed = new URL(normalizedUrl);
      addVariant(parsed.pathname || '/');
      addVariant(routePatternForUrl(normalizedUrl));
    } catch {
      // Non-URL route templates are handled through the raw path variants above.
    }
  }
  return [...variants].filter(Boolean);
}

export function configuredAuthRouteTemplateSet(context = /** @type {any} */ ({})) {
  const targets = [
    ...(context.crawlContract?.coverageTargets?.authRoutes ?? []),
    ...(context.options?.authRoutes ?? []),
    ...(context.options?.localBuildConfig?.authRoutes ?? []),
  ];
  const configured = new Set();
  for (const target of targets) {
    for (const variant of routeTemplateComparisonValues(context, [target])) {
      if (variant && variant !== '/') {
        configured.add(variant);
      }
    }
  }
  return configured;
}

export function matchesConfiguredAuthRoute(context = /** @type {any} */ ({}), configuredRouteTemplates = new Set(), values = /** @type {any[]} */ ([])) {
  if (!configuredRouteTemplates?.size) {
    return false;
  }
  return routeTemplateComparisonValues(context, values).some((variant) => variant !== '/' && configuredRouteTemplates.has(variant));
}

export function browserBridgeMissingRouteTemplateSet(context = /** @type {any} */ ({})) {
  const bridge = context.authStateReport?.browserBridge ?? {};
  const routeResults = Array.isArray(bridge.routeResults) ? bridge.routeResults : [];
  const missing = new Set();
  for (const result of routeResults) {
    if (browserBridgeRouteCaptured(result)) {
      continue;
    }
    for (const variant of routeTemplateComparisonValues(context, [
      result?.targetRoute,
      result?.routeTemplate,
      result?.targetUrl,
      result?.url,
      result?.normalizedUrl,
    ])) {
      missing.add(variant);
    }
  }
  return missing;
}

export function browserBridgeCapturedRouteTemplateSet(context = /** @type {any} */ ({})) {
  const bridge = context.authStateReport?.browserBridge ?? {};
  const routeResults = Array.isArray(bridge.routeResults) ? bridge.routeResults : [];
  const captured = new Set();
  for (const result of routeResults) {
    if (!browserBridgeRouteCaptured(result)) {
      continue;
    }
    for (const variant of routeTemplateComparisonValues(context, [
      result?.targetRoute,
      result?.routeTemplate,
      result?.targetUrl,
      result?.url,
      result?.normalizedUrl,
    ])) {
      captured.add(variant);
    }
  }
  return captured;
}

export function matchesBrowserBridgeMissingRoute(context = /** @type {any} */ ({}), missingRouteTemplates = new Set(), values = /** @type {any[]} */ ([])) {
  if (!missingRouteTemplates?.size) {
    return false;
  }
  return routeTemplateComparisonValues(context, values).some((variant) => missingRouteTemplates.has(variant));
}

export function matchesBrowserBridgeMissingNonRootRoute(context = /** @type {any} */ ({}), missingRouteTemplates = new Set(), values = /** @type {any[]} */ ([])) {
  if (!missingRouteTemplates?.size) {
    return false;
  }
  return routeTemplateComparisonValues(context, values).some((variant) => variant !== '/' && missingRouteTemplates.has(variant));
}

export function browserBridgePageWasCaptured(context = /** @type {any} */ ({}), page = /** @type {any} */ ({})) {
  if (context.authStateReport?.authMethod !== 'browser') {
    return true;
  }
  const routeResults = Array.isArray(context.authStateReport?.browserBridge?.routeResults)
    ? context.authStateReport.browserBridge.routeResults
    : [];
  if (!routeResults.length) {
    return true;
  }
  const routeId = String(page?.routeId ?? '').trim();
  if (routeId) {
    const routeResult = routeResults.find((result) => String(result?.routeId ?? '').trim() === routeId);
    if (routeResult) {
      return browserBridgeRouteCaptured(routeResult);
    }
  }
  const values = [
    page?.routeTemplate,
    page?.routePattern,
    page?.normalizedUrl,
    page?.url,
  ];
  if (matchesBrowserBridgeMissingRoute(context, browserBridgeMissingRouteTemplateSet(context), values)) {
    return false;
  }
  const capturedRoutes = browserBridgeCapturedRouteTemplateSet(context);
  return capturedRoutes.size === 0 || routeTemplateComparisonValues(context, values).some((variant) => capturedRoutes.has(variant));
}

export function routeCapturePlanFromAuthState(context, authStateReport = /** @type {any} */ ({})) {
  const bridge = authStateReport?.browserBridge ?? {};
  const routeResults = Array.isArray(bridge.routeResults) ? bridge.routeResults : [];
  const missingRoutes = routeResults
    .filter((result) => !browserBridgeRouteCaptured(result))
    .map((result) => {
      const retryable = browserBridgeRouteRetryable(result);
      const finalReasonCode = result?.finalReasonCode ?? result?.reasonCode ?? result?.status ?? 'browser-auth-route-not-captured';
      const routeLimitExceeded = finalReasonCode === 'browser-bridge-route-limit-exceeded';
      return {
        routeId: result?.routeId ?? null,
        sourceLayer: result?.sourceLayer === 'authenticated_overlay' ? 'authenticated_overlay' : 'authenticated',
        targetRoute: result?.targetRoute ?? null,
        status: result?.status ?? 'timeout',
        reasonCode: result?.reasonCode ?? result?.status ?? 'browser-auth-route-not-captured',
        initialStatus: result?.initialStatus ?? result?.status ?? 'timeout',
        finalStatus: result?.finalStatus ?? result?.status ?? 'timeout',
        finalReasonCode,
        retryAttemptCount: Math.max(0, Number(result?.retryAttemptCount ?? 0) || 0),
        retryOutcome: result?.retryOutcome ?? 'not_attempted',
        recommendedRetryMode: routeLimitExceeded
          ? 'split_browser_bridge_route_batch'
          : retryable ? 'browser_bridge_missing_route_retry' : 'access_boundary_no_automatic_retry',
        retryable,
        capabilityGenerated: false,
      };
    });
  const unattemptedRoutes = missingRoutes.filter((route) => route.finalReasonCode === 'browser-bridge-route-limit-exceeded');
  if (
    authStateReport?.authMethod !== 'browser'
    || !['browser_verified', 'browser_verified_partial'].includes(String(authStateReport?.authVerificationStatus ?? ''))
    || Number(bridge.capturedRouteCount ?? 0) <= 0
  ) {
    return null;
  }
  const routeCoverageStatus = ['complete', 'partial', 'none'].includes(String(bridge.routeCoverageStatus ?? '').trim())
    ? String(bridge.routeCoverageStatus).trim()
    : missingRoutes.length > 0
      ? 'partial'
      : 'complete';
  return sanitizeReportPublicValue({
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-route-capture-plan',
    siteId: context.site.id,
    buildId: context.buildId,
    status: routeCoverageStatus,
    routeCoverageStatus,
    retryStatus: bridge.retryStatus ?? 'not_attempted',
    retryPasses: Math.max(0, Number(bridge.retryPasses ?? 0) || 0),
    initialCapturedRouteCount: Math.max(0, Number(bridge.initialCapturedRouteCount ?? 0) || 0),
    retryAttemptedRouteCount: Math.max(0, Number(bridge.retryAttemptedRouteCount ?? 0) || 0),
    retryCapturedRouteCount: Math.max(0, Number(bridge.retryCapturedRouteCount ?? 0) || 0),
    finalCapturedRouteCount: Math.max(0, Number(bridge.finalCapturedRouteCount ?? bridge.capturedRouteCount ?? 0) || 0),
    finalMissingRouteCount: Math.max(0, Number(bridge.finalMissingRouteCount ?? missingRoutes.length) || 0),
    routeQueueLimit: Math.max(0, Number(bridge.routeQueueLimit ?? 0) || 0),
    scheduledRouteCount: Math.max(0, Number(bridge.scheduledRouteCount ?? 0) || 0),
    overflowRouteCount: Math.max(0, Number(bridge.overflowRouteCount ?? 0) || 0),
    unattemptedRouteCount: Math.max(0, Number(bridge.unattemptedRouteCount ?? unattemptedRoutes.length) || 0),
    routeQueueTruncated: bridge.routeQueueTruncated === true,
    routeQueueStatus: bridge.routeQueueStatus ?? (bridge.routeQueueTruncated === true ? 'truncated' : 'complete'),
    routeLimitReasonCode: bridge.routeLimitReasonCode ?? null,
    routeCount: Number(bridge.routeCount ?? routeResults.length ?? 0) || 0,
    capturedRouteCount: Number(bridge.capturedRouteCount ?? 0) || 0,
    missingRouteCount: Math.max(0, Number(bridge.missingRouteCount ?? missingRoutes.length) || 0),
    missingRoutes,
    unattemptedRoutes,
    safety: {
      cookiePersisted: false,
      browserProfilePersisted: false,
      storageRead: false,
      rawDomPersisted: false,
      rawHtmlPersisted: false,
      privateBodyPersisted: false,
    },
  });
}
