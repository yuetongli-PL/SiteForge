// @ts-check

import {
  createProviderSdkFinding,
  ProviderSdkValidationError,
} from './provider-sdk-errors.mjs';

export const PROVIDER_MANIFEST_SCHEMA_VERSION = 'provider.manifest.v1';

export const PROVIDER_ALLOWED_SIDE_EFFECTS = Object.freeze([
  'none',
  'bounded',
  'external_write',
  'destructive',
  'payment',
]);

const RAW_KEY_PATTERN = /(?:raw|cookie|token|authorization|header|credential|password|secret|sessionhandle|sessionmaterial|storagestate|localstorage|sessionstorage|indexeddb|rawbody|paymentcredential|confirmationtoken)/iu;
const RAW_VALUE_PATTERN = /(?:sf_provider_[a-z0-9_]*secret|authorization:\s*bearer|cookie:|set-cookie:|raw\s+(?:body|headers?|cookie|token)|storageState|localStorage|sessionStorage|IndexedDB|payment\s+credential)/iu;

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeToken(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

function sanitizeString(value) {
  const text = normalizeText(value);
  return text && !RAW_VALUE_PATTERN.test(text) ? text : undefined;
}

function sanitizeBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizeStringArray(value) {
  return Array.isArray(value)
    ? [...new Set(value.map(sanitizeString).filter(Boolean))].sort()
    : [];
}

function sanitizeSafeObject(value, allowedKeys) {
  if (!isPlainObject(value)) return {};
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (!allowedKeys.includes(key)) continue;
    const item = value[key];
    if (typeof item === 'boolean') output[key] = item;
    else if (Array.isArray(item)) output[key] = sanitizeStringArray(item);
    else {
      const text = sanitizeString(item);
      if (text !== undefined) output[key] = text;
    }
  }
  return output;
}

export function sanitizeProviderManifest(manifest = {}) {
  if (!isPlainObject(manifest)) return {};
  const riskProfile = sanitizeSafeObject(manifest.riskProfile, [
    'sideEffects',
    'requiresControlledRuntime',
    'requiresAuthAdapter',
    'allowedAuthMaterialTypes',
    'allowedInjectionTargets',
  ]);
  const runtimeServices = sanitizeSafeObject(manifest.runtimeServices, [
    'requiresOutputWriter',
    'requiresBrowserRuntime',
    'requiresNetwork',
    'requiresSessionMaterial',
  ]);
  const resultPolicy = sanitizeSafeObject(manifest.resultPolicy, [
    'allowRawHeaders',
    'allowRawBody',
    'allowRawCookies',
    'allowRawTokens',
  ]);
  return {
    schemaVersion: sanitizeString(manifest.schemaVersion),
    providerId: sanitizeString(manifest.providerId),
    capabilityKinds: sanitizeStringArray(manifest.capabilityKinds),
    supportedOperations: sanitizeStringArray(manifest.supportedOperations),
    riskProfile: {
      sideEffects: normalizeToken(riskProfile.sideEffects ?? 'none') || 'none',
      requiresControlledRuntime: sanitizeBoolean(riskProfile.requiresControlledRuntime),
      requiresAuthAdapter: sanitizeBoolean(riskProfile.requiresAuthAdapter),
      allowedAuthMaterialTypes: sanitizeStringArray(riskProfile.allowedAuthMaterialTypes),
      allowedInjectionTargets: sanitizeStringArray(riskProfile.allowedInjectionTargets),
    },
    runtimeServices: {
      requiresOutputWriter: sanitizeBoolean(runtimeServices.requiresOutputWriter),
      requiresBrowserRuntime: sanitizeBoolean(runtimeServices.requiresBrowserRuntime),
      requiresNetwork: sanitizeBoolean(runtimeServices.requiresNetwork),
      requiresSessionMaterial: sanitizeBoolean(runtimeServices.requiresSessionMaterial),
    },
    resultPolicy: {
      allowRawHeaders: sanitizeBoolean(resultPolicy.allowRawHeaders),
      allowRawBody: sanitizeBoolean(resultPolicy.allowRawBody),
      allowRawCookies: sanitizeBoolean(resultPolicy.allowRawCookies),
      allowRawTokens: sanitizeBoolean(resultPolicy.allowRawTokens),
    },
  };
}

export function validateProviderManifest(manifest = {}, options = {}) {
  const sanitizedManifest = sanitizeProviderManifest(manifest);
  const findings = [];
  if (sanitizedManifest.schemaVersion !== PROVIDER_MANIFEST_SCHEMA_VERSION) {
    findings.push(createProviderSdkFinding(
      'provider.manifest.schema_version_invalid',
      'Provider manifest schemaVersion must be provider.manifest.v1.',
    ));
  }
  if (!sanitizedManifest.providerId) {
    findings.push(createProviderSdkFinding(
      'provider.manifest.provider_id_required',
      'Provider manifest providerId is required.',
    ));
  }
  if (sanitizedManifest.capabilityKinds.length === 0) {
    findings.push(createProviderSdkFinding(
      'provider.manifest.capability_kinds_required',
      'Provider manifest capabilityKinds must include at least one kind.',
    ));
  }
  if (!PROVIDER_ALLOWED_SIDE_EFFECTS.includes(sanitizedManifest.riskProfile.sideEffects)) {
    findings.push(createProviderSdkFinding(
      'provider.manifest.side_effects_invalid',
      'Provider manifest sideEffects is unsupported.',
    ));
  }
  for (const [key, allowed] of Object.entries(sanitizedManifest.resultPolicy)) {
    if (allowed === true && options.production === true) {
      findings.push(createProviderSdkFinding(
        'provider.manifest.raw_result_policy_forbidden',
        `Provider manifest resultPolicy ${key} must remain false in production.`,
      ));
    }
  }
  return {
    ok: findings.length === 0,
    manifest: sanitizedManifest,
    findings,
  };
}

export function assertProviderManifestValid(manifest = {}, options = {}) {
  const report = validateProviderManifest(manifest, options);
  if (!report.ok) {
    throw new ProviderSdkValidationError(report.findings[0].message, {
      code: report.findings[0].reasonCode,
      details: { findings: report.findings },
    });
  }
  return true;
}

export function attachProviderManifest(provider = {}, manifest = {}) {
  const report = validateProviderManifest(manifest);
  if (!report.ok) {
    throw new ProviderSdkValidationError(report.findings[0].message, {
      code: report.findings[0].reasonCode,
      details: { findings: report.findings },
    });
  }
  return {
    ...provider,
    providerId: report.manifest.providerId,
    manifest: report.manifest,
  };
}

export function assertNoProviderRawMaterial(value, label = 'Provider SDK output') {
  const serialized = JSON.stringify(value);
  if (RAW_VALUE_PATTERN.test(serialized)) {
    throw new ProviderSdkValidationError(`${label} contains forbidden raw provider material`, {
      code: 'provider.raw_material_leak',
    });
  }
  return true;
}
