// @ts-check

import { assertNoForbiddenPatterns } from '../../../domain/sessions/security-guard.mjs';
import { uniqueSortedStrings } from '../../../shared/normalize.mjs';
import { BUILD_SCHEMA_VERSION } from './models.mjs';
import { sanitizeEvidenceRef } from './risk-policy.mjs';
import {
  RUNTIME_PROVIDER_IDS,
  RUNTIME_PROVIDER_RUNTIME_MODES,
  normalizeRuntimeProviderId,
  runtimeProviderBundleRequirements,
  runtimeProviderDescriptor,
  runtimeProviderRuntimeMode,
} from './runtime-provider.mjs';

export const EVIDENCE_PROVIDER_IDS = RUNTIME_PROVIDER_IDS;
export const EVIDENCE_PROVIDER_RUNTIME_MODES = RUNTIME_PROVIDER_RUNTIME_MODES;

function normalizeProviderId(value, fallback = 'public_http') {
  return normalizeRuntimeProviderId(value, fallback);
}

function bool(value) {
  return value === true;
}

function safeText(value, fallback = null, maxLength = 160) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return fallback;
  }
  const sanitized = sanitizeEvidenceRef(raw);
  if (!sanitized || /\b(?:authorization|bearer|cookie|token|secret|session|password|localStorage|sessionStorage|userDataDir|browser\s*profile|raw\s+dom|raw\s+html)\b/iu.test(String(sanitized))) {
    return '[REDACTED]';
  }
  if (/<\/?(?:html|body|script|iframe|style|div|span|section|article|main|ul|li|form|input|button)\b/iu.test(String(sanitized))) {
    return '[REDACTED]';
  }
  return String(sanitized).slice(0, maxLength);
}

function normalizeCollection(collection = null, providerId = 'public_http') {
  const status = ['success', 'skipped', 'blocked', 'failed', 'partial'].includes(String(collection?.status ?? '').trim())
    ? String(collection.status).trim()
    : 'success';
  return {
    ...(collection && typeof collection === 'object' ? collection : {}),
    status,
    providerId,
  };
}

export function providerRuntimeMode(providerId, page = /** @type {any} */ ({})) {
  return runtimeProviderRuntimeMode(providerId, page);
}

export function providerRuntimeRequirements(providerId) {
  return runtimeProviderBundleRequirements(providerId);
}

export function normalizeEvidencePage(page = /** @type {any} */ ({}), {
  providerId = 'public_http',
  authMethod = null,
  authVerificationStatus = null,
  sourceLayer = null,
} = /** @type {any} */ ({})) {
  const normalizedProviderId = normalizeProviderId(providerId);
  const descriptor = runtimeProviderDescriptor(normalizedProviderId);
  const normalizedSourceLayer = String(sourceLayer ?? page.sourceLayer ?? descriptor.sourceLayer ?? 'public').trim();
  const normalizedAuthMethod = String(authMethod ?? page.authMethod ?? descriptor.authMethod ?? 'none').trim();
  const next = {
    ...page,
    providerId: normalizedProviderId,
    sourceLayer: normalizedSourceLayer,
    authMethod: normalizedAuthMethod,
    authVerificationStatus: page.authVerificationStatus ?? authVerificationStatus ?? null,
    evidenceLevel: page.evidenceLevel ?? descriptor.evidenceLevel ?? 'candidate',
    runtimeMode: providerRuntimeMode(normalizedProviderId, page),
    collection: normalizeCollection(page.collection, normalizedProviderId),
  };
  if (typeof next.title === 'string') {
    next.title = safeText(next.title, null, 120);
  }
  if (typeof next.textSummary === 'string') {
    next.textSummary = safeText(next.textSummary, null, 240);
  }
  for (const key of [
    'rawHtml',
    'rawHTML',
    'rawDom',
    'rawDOM',
    'rawBody',
    'body',
    'headers',
    'requestHeaders',
    'responseHeaders',
    'cookie',
    'cookies',
    'cookieHeader',
    'authorization',
    'token',
    'localStorage',
    'sessionStorage',
    'userDataDir',
    'browserProfile',
  ]) {
    if (Object.hasOwn(next, key)) {
      delete next[key];
    }
  }
  return next;
}

function routeResultCaptured(result = /** @type {any} */ ({})) {
  return ['captured', 'captured_with_warning'].includes(String(result?.status ?? '').trim()) && result?.captured !== false;
}

function normalizeRouteResult(result = /** @type {any} */ ({}), providerId = 'public_http') {
  const descriptor = runtimeProviderDescriptor(providerId);
  return {
    routeId: safeText(result.routeId, null, 120),
    sourceLayer: String(result.sourceLayer ?? descriptor.sourceLayer ?? 'public'),
    targetRoute: safeText(result.targetRoute ?? result.routeTemplate ?? result.normalizedUrl ?? result.url, null, 240),
    status: safeText(result.status, 'unknown', 80),
    reasonCode: safeText(result.reasonCode, null, 120),
    finalReasonCode: safeText(result.finalReasonCode, result.reasonCode ?? null, 120),
    retryAttemptCount: Math.max(0, Number(result.retryAttemptCount ?? 0) || 0),
    retryOutcome: safeText(result.retryOutcome, null, 80),
    captured: routeResultCaptured(result),
  };
}

function defaultPrivacy(providerId) {
  return {
    rawDomSaved: false,
    rawHtmlSaved: false,
    rawContentSaved: false,
    privateContentSaved: false,
    cookiesSaved: false,
    tokensSaved: false,
    authHeadersSaved: false,
    browserProfileSaved: false,
    storageSaved: false,
    rawNetworkPayloadSaved: false,
    cookieMaterialPersisted: false,
    browserProfilePersisted: false,
    providerId,
  };
}

function assertNoProviderUnsafeStrings(value, path = []) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertNoProviderUnsafeStrings(item, [...path, String(index)]);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      assertNoProviderUnsafeStrings(child, [...path, key]);
    }
    return;
  }
  if (typeof value !== 'string') {
    return;
  }
  if (/<\/?(?:html|body|script|iframe)\b|Authorization:\s*Bearer|Bearer\s+[A-Za-z0-9._~+/-]+=*|\bcookie\s*[:=]|\bsid\s*=|\b(?:token|secret|password)\s*=/iu.test(value)) {
    const error = /** @type {Error & Record<string, any>} */ (new Error('Unsafe evidence provider material detected'));
    error.code = 'evidence-provider-redaction-failed';
    error.path = path.join('.') || '$';
    throw error;
  }
}

export function normalizeEvidenceBundle(input = /** @type {any} */ ({}), options = /** @type {any} */ ({})) {
  const providerId = normalizeProviderId(input.providerId ?? options.providerId);
  const descriptor = runtimeProviderDescriptor(providerId);
  const authMethod = input.authMethod ?? options.authMethod ?? descriptor.authMethod ?? 'none';
  const authVerificationStatus = input.authVerificationStatus ?? options.authVerificationStatus ?? null;
  const sourceLayer = input.sourceLayer ?? options.sourceLayer ?? descriptor.sourceLayer ?? 'public';
  const pages = (Array.isArray(input.pages) ? input.pages : [])
    .map((page) => normalizeEvidencePage(page, {
      providerId,
      authMethod,
      authVerificationStatus,
      sourceLayer: page?.sourceLayer ?? sourceLayer,
    }));
  const routeResults = (Array.isArray(input.routeResults) ? input.routeResults : [])
    .map((result) => normalizeRouteResult(result, providerId));
  const capturedRouteCount = routeResults.filter((result) => result.captured === true).length;
  const missingRouteCount = Math.max(0, routeResults.length - capturedRouteCount);
  const coverage = {
    ...(input.coverage && typeof input.coverage === 'object' ? input.coverage : {}),
    providerId,
    pages: pages.length,
    routeResults: routeResults.length,
    capturedRouteCount,
    missingRouteCount,
  };
  const bundle = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-evidence-bundle',
    providerId,
    status: input.status ?? (pages.length || capturedRouteCount ? 'success' : 'skipped'),
    authMethod,
    authVerificationStatus,
    sourceLayer,
    pages,
    routeResults,
    coverage,
    warnings: uniqueSortedStrings([...(input.warnings ?? [])].map((warning) => safeText(warning, null, 240)).filter(Boolean)),
    reasonCodes: uniqueSortedStrings(input.reasonCodes ?? []),
    privacy: {
      ...defaultPrivacy(providerId),
      ...(input.privacy && typeof input.privacy === 'object' ? input.privacy : {}),
      cookieMaterialPersisted: false,
      browserProfilePersisted: false,
      rawDomSaved: false,
      rawHtmlSaved: false,
      rawContentSaved: false,
      privateContentSaved: false,
      rawNetworkPayloadSaved: false,
    },
    runtimeRequirements: input.runtimeRequirements ?? providerRuntimeRequirements(providerId),
  };
  assertNoProviderUnsafeStrings(bundle);
  assertNoForbiddenPatterns(bundle);
  return bundle;
}

export function mergeEvidenceBundles(bundles = /** @type {any[]} */ ([])) {
  const normalized = bundles.map((bundle) => normalizeEvidenceBundle(bundle));
  const byProvider = new Map();
  for (const bundle of normalized) {
    const existing = byProvider.get(bundle.providerId);
    if (!existing) {
      byProvider.set(bundle.providerId, bundle);
      continue;
    }
    existing.pages.push(...bundle.pages);
    existing.routeResults.push(...bundle.routeResults);
    existing.warnings = uniqueSortedStrings([...existing.warnings, ...bundle.warnings]);
    existing.reasonCodes = uniqueSortedStrings([...existing.reasonCodes, ...bundle.reasonCodes]);
    existing.coverage = {
      ...existing.coverage,
      pages: existing.pages.length,
      routeResults: existing.routeResults.length,
      capturedRouteCount: existing.routeResults.filter((result) => result.captured === true).length,
      missingRouteCount: existing.routeResults.filter((result) => result.captured !== true).length,
    };
  }
  return [...byProvider.values()];
}

export function evidenceCoverageFromBundles(bundles = /** @type {any[]} */ ([])) {
  const normalized = mergeEvidenceBundles(bundles);
  const providers = {};
  for (const bundle of normalized) {
    providers[bundle.providerId] = {
      status: bundle.status,
      pages: bundle.pages.length,
      routeResults: bundle.routeResults.length,
      capturedRouteCount: bundle.coverage.capturedRouteCount ?? 0,
      missingRouteCount: bundle.coverage.missingRouteCount ?? 0,
      sourceLayer: bundle.sourceLayer,
      authMethod: bundle.authMethod,
      runtimeMode: bundle.runtimeRequirements?.runtimeMode ?? providerRuntimeMode(bundle.providerId),
    };
  }
  return {
    providerCount: normalized.length,
    pages: normalized.reduce((sum, bundle) => sum + bundle.pages.length, 0),
    routeResults: normalized.reduce((sum, bundle) => sum + bundle.routeResults.length, 0),
    providers,
  };
}

export function evidenceBundlesFromStageResults(stageResults = /** @type {any} */ ({})) {
  return mergeEvidenceBundles([
    ...(stageResults.crawlStatic?.evidenceBundles ?? []),
    ...(stageResults.crawlAuthenticated?.evidenceBundles ?? []),
    ...(stageResults.crawlRendered?.evidenceBundles ?? []),
  ]);
}

export function canUseEvidenceProvider(context = /** @type {any} */ ({}), providerId = 'public_http') {
  const normalizedProviderId = normalizeProviderId(providerId);
  if (['public_http', 'authorized_summary', 'public_rendered'].includes(normalizedProviderId)) {
    return true;
  }
  const authState = context.authStateReport ?? {};
  if (normalizedProviderId === 'cookie_http') {
    return authState.authMethod === 'cookie'
      && authState.authVerificationStatus === 'cookie_verified'
      && authState.verified === true;
  }
  if (normalizedProviderId === 'browser_bridge') {
    return authState.authMethod === 'browser'
      && ['browser_verified', 'browser_verified_partial'].includes(String(authState.authVerificationStatus ?? ''))
      && authState.verified === true;
  }
  return false;
}
