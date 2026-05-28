// @ts-check

import { SANITIZED_SUMMARY_ONLY } from './risk-policy.mjs';

export const RUNTIME_PROVIDER_IDS = Object.freeze([
  'public_http',
  'cookie_http',
  'browser_bridge',
  'authorized_summary',
  'public_rendered',
]);

export const RUNTIME_MODES = Object.freeze({
  genericHttpRead: 'generic_http_read',
  browserBridgeRequired: 'browser_bridge_required',
});

export const RUNTIME_PROMOTION_CLASSES = Object.freeze({
  genericHttpRead: 'generic_http_read_runtime',
  browserBridge: 'browser_bridge_runtime',
});

const RUNTIME_PROVIDER_DESCRIPTOR_BASE = Object.freeze({
  public_http: Object.freeze({
    providerId: 'public_http',
    sourceLayer: 'public',
    authMethod: 'none',
    evidenceLevel: 'public_verified',
    runtimeMode: RUNTIME_MODES.genericHttpRead,
    promotionClass: RUNTIME_PROMOTION_CLASSES.genericHttpRead,
  }),
  cookie_http: Object.freeze({
    providerId: 'cookie_http',
    sourceLayer: 'authenticated',
    authMethod: 'cookie',
    evidenceLevel: 'login_page_verified',
    runtimeMode: null,
    promotionClass: null,
  }),
  browser_bridge: Object.freeze({
    providerId: 'browser_bridge',
    sourceLayer: 'authenticated',
    authMethod: 'browser',
    evidenceLevel: 'browser_structure_verified',
    runtimeMode: RUNTIME_MODES.browserBridgeRequired,
    promotionClass: RUNTIME_PROMOTION_CLASSES.browserBridge,
  }),
  authorized_summary: Object.freeze({
    providerId: 'authorized_summary',
    sourceLayer: 'authorized_source',
    authMethod: 'none',
    evidenceLevel: 'authorized_source_verified',
    runtimeMode: null,
    promotionClass: null,
  }),
  public_rendered: Object.freeze({
    providerId: 'public_rendered',
    sourceLayer: 'public_rendered',
    authMethod: 'none',
    evidenceLevel: 'public_rendered_verified',
    runtimeMode: RUNTIME_MODES.genericHttpRead,
    promotionClass: RUNTIME_PROMOTION_CLASSES.genericHttpRead,
  }),
});

export const RUNTIME_PROVIDER_RUNTIME_MODES = Object.freeze(Object.fromEntries(
  RUNTIME_PROVIDER_IDS.map((providerId) => [
    providerId,
    RUNTIME_PROVIDER_DESCRIPTOR_BASE[providerId].runtimeMode,
  ]),
));

function cloneRuntimeValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneRuntimeValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneRuntimeValue(item)]));
  }
  return value;
}

export function normalizeRuntimeProviderId(value, fallback = 'public_http') {
  const providerId = String(value ?? '').trim();
  return RUNTIME_PROVIDER_IDS.includes(providerId) ? providerId : fallback;
}

export function runtimeProviderBundleRequirements(providerId) {
  const normalizedProviderId = normalizeRuntimeProviderId(providerId);
  if (normalizedProviderId === 'public_http' || normalizedProviderId === 'public_rendered') {
    return {
      runtimeMode: RUNTIME_MODES.genericHttpRead,
      readOnly: true,
      allowedMethods: ['GET'],
      cookieMaterialAllowed: false,
      crossSiteNavigationAllowed: false,
      formSubmissionAllowed: false,
    };
  }
  if (normalizedProviderId === 'browser_bridge') {
    return {
      runtimeMode: RUNTIME_MODES.browserBridgeRequired,
      readOnly: true,
      requiresFreshBridgeEvidence: true,
      cookieMaterialAllowed: false,
      browserProfileMaterialAllowed: false,
      storageMaterialAllowed: false,
    };
  }
  if (normalizedProviderId === 'cookie_http') {
    return {
      runtimeMode: null,
      readOnly: true,
      requiresFreshCookieInput: true,
      cookieMaterialPersisted: false,
      crossSiteCookieAllowed: false,
    };
  }
  return {
    runtimeMode: null,
    readOnly: true,
    userProvidedSummary: true,
    ordinaryHttpRuntimeClaimed: false,
  };
}

export function runtimeProviderDescriptor(providerId) {
  const normalizedProviderId = normalizeRuntimeProviderId(providerId);
  const descriptor = RUNTIME_PROVIDER_DESCRIPTOR_BASE[normalizedProviderId];
  return {
    ...descriptor,
    bundleRequirements: runtimeProviderBundleRequirements(normalizedProviderId),
  };
}

export function runtimeProviderRuntimeMode(providerId, page = /** @type {any} */ ({})) {
  if (page?.runtimeMode) {
    return page.runtimeMode;
  }
  return runtimeProviderDescriptor(providerId).runtimeMode ?? null;
}

function browserBridgeCoverageStatus(authStateReport = /** @type {any} */ ({})) {
  const bridge = authStateReport.browserBridge ?? {};
  if (['complete', 'partial', 'none'].includes(String(bridge.routeCoverageStatus ?? '').trim())) {
    return bridge.routeCoverageStatus;
  }
  const routeCount = Number(bridge.routeCount ?? 0);
  const missingRouteCount = Number(bridge.missingRouteCount ?? 0);
  if (routeCount > 0 && missingRouteCount === 0) {
    return 'complete';
  }
  return 'partial';
}

function browserBridgePromotionRequirements(authStateReport = /** @type {any} */ ({})) {
  const bridge = authStateReport.browserBridge ?? {};
  return {
    authMethod: 'browser',
    authVerificationStatus: authStateReport.authVerificationStatus ?? 'browser_verified',
    requiresFreshBridgeEvidence: true,
    defaultBrowserBridgeRequired: true,
    genericHttpRuntimeAllowed: false,
    savedMaterial: SANITIZED_SUMMARY_ONLY,
    routeCount: Number(bridge.routeCount ?? 0),
    capturedRouteCount: Number(bridge.capturedRouteCount ?? 0),
    missingRouteCount: Number(bridge.missingRouteCount ?? 0),
    routeCoverageStatus: bridge.routeCoverageStatus ?? browserBridgeCoverageStatus(authStateReport),
    retryStatus: bridge.retryStatus ?? 'not_attempted',
    retryPasses: Number(bridge.retryPasses ?? 0),
    retryAttemptedRouteCount: Number(bridge.retryAttemptedRouteCount ?? 0),
    retryCapturedRouteCount: Number(bridge.retryCapturedRouteCount ?? 0),
  };
}

function genericHttpPromotionRequirements() {
  return {
    authMethod: 'none',
    robotsAllowed: true,
    readOnly: true,
    allowedMethods: ['GET'],
    cookieMaterialAllowed: false,
    savedMaterial: SANITIZED_SUMMARY_ONLY,
    crossSiteNavigationAllowed: false,
    formSubmissionAllowed: false,
  };
}

export function runtimeProviderPromotionMetadata(providerId, options = /** @type {any} */ ({})) {
  const normalizedProviderId = normalizeRuntimeProviderId(providerId);
  const descriptor = runtimeProviderDescriptor(normalizedProviderId);
  if (descriptor.runtimeMode === RUNTIME_MODES.browserBridgeRequired) {
    const authStateReport = options.authStateReport ?? {};
    return {
      promotionClass: descriptor.promotionClass,
      runtimeMode: descriptor.runtimeMode,
      requiresFreshBridgeEvidence: true,
      genericHttpRuntimeAllowed: false,
      coverageStatus: browserBridgeCoverageStatus(authStateReport),
      runtimeRequirements: cloneRuntimeValue(options.runtimeRequirements ?? browserBridgePromotionRequirements(authStateReport)),
    };
  }
  if (descriptor.runtimeMode === RUNTIME_MODES.genericHttpRead) {
    return {
      promotionClass: descriptor.promotionClass,
      runtimeMode: descriptor.runtimeMode,
      requiresFreshBridgeEvidence: false,
      genericHttpRuntimeAllowed: true,
      coverageStatus: options.coverageStatus ?? 'complete',
      runtimeRequirements: cloneRuntimeValue(options.runtimeRequirements ?? genericHttpPromotionRequirements()),
    };
  }
  return null;
}

export function bridgeRuntimeMetadata(authStateReport = /** @type {any} */ ({})) {
  return runtimeProviderPromotionMetadata('browser_bridge', {
    authStateReport,
  });
}

export function genericHttpRuntimeMetadata() {
  return runtimeProviderPromotionMetadata('public_http');
}

export function registryIntentRuntimeMetadata(
  intent = /** @type {any} */ ({}),
  capability = /** @type {any} */ ({}),
  fallback = /** @type {any} */ (null),
) {
  const runtimeMode = intent.runtimeMode ?? capability.runtimeMode ?? fallback?.runtimeMode ?? null;
  if (!runtimeMode) {
    return null;
  }
  return {
    promotionClass: intent.promotionClass ?? capability.promotionClass ?? fallback?.promotionClass ?? null,
    runtimeMode,
    requiresFreshBridgeEvidence: Boolean(intent.requiresFreshBridgeEvidence ?? capability.requiresFreshBridgeEvidence ?? fallback?.requiresFreshBridgeEvidence),
    genericHttpRuntimeAllowed: Boolean(intent.genericHttpRuntimeAllowed ?? capability.genericHttpRuntimeAllowed ?? fallback?.genericHttpRuntimeAllowed),
    coverageStatus: intent.coverageStatus ?? capability.coverageStatus ?? fallback?.coverageStatus ?? null,
    runtimeRequirements: cloneRuntimeValue(intent.runtimeRequirements ?? capability.runtimeRequirements ?? fallback?.runtimeRequirements ?? null),
  };
}
