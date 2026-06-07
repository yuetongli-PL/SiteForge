// @ts-check

import {
  assertNoProviderRawMaterial,
} from './provider-manifest.mjs';

const RAW_KEY_PATTERN = /(?:raw|cookie|token|authorization|header|credential|password|secret|session|storageState|localStorage|sessionStorage|IndexedDB|body|request|response|payment|confirmation)/iu;
const RESULT_ALLOWED_KEYS = Object.freeze(new Set([
  'providerId',
  'providerKind',
  'status',
  'reasonCode',
  'runtimeExecuted',
  'sideEffectAttempted',
  'sideEffectSucceeded',
  'sideEffectFailed',
  'artifactRefs',
  'resultSummary',
  'warnings',
]));
const SUMMARY_ALLOWED_KEYS = Object.freeze(new Set([
  'outcome',
  'providerId',
  'runtimeMode',
  'capabilityId',
  'executionContractRef',
  'reasonCode',
  'artifactRefs',
  'savedMaterial',
  'redactionRequired',
  'responseMaterial',
  'slotNames',
  'payloadTemplate',
  'downloads',
  'warnings',
]));

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function sanitizeScalar(value) {
  if (typeof value === 'string') return value.trim().slice(0, 240) || undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (value === null) return null;
  return undefined;
}

function sanitizeArray(value) {
  return Array.isArray(value)
    ? value.map((item) => sanitizeValue(item)).filter((item) => item !== undefined)
    : [];
}

function sanitizeValue(value) {
  if (Array.isArray(value)) return sanitizeArray(value);
  if (isPlainObject(value)) return sanitizeObject(value, null);
  return sanitizeScalar(value);
}

function sanitizeObject(value, allowedKeys) {
  if (!isPlainObject(value)) return {};
  const output = {};
  const warnings = [];
  for (const key of Object.keys(value).sort()) {
    if ((allowedKeys && !allowedKeys.has(key)) || RAW_KEY_PATTERN.test(key)) {
      warnings.push('provider.raw_output_field_removed');
      continue;
    }
    const sanitized = sanitizeValue(value[key]);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  if (warnings.length > 0) output.warnings = [...new Set([...(output.warnings ?? []), ...warnings])].sort();
  return output;
}

export function sanitizeProviderResult(result = {}, manifest = {}, options = {}) {
  const sanitized = sanitizeObject(result, RESULT_ALLOWED_KEYS);
  if (isPlainObject(result.resultSummary)) {
    sanitized.resultSummary = sanitizeObject(result.resultSummary, SUMMARY_ALLOWED_KEYS);
  }
  sanitized.providerId = sanitized.providerId ?? manifest.providerId ?? null;
  sanitized.status = sanitized.status ?? 'failed';
  sanitized.warnings = [...new Set(sanitizeArray(sanitized.warnings ?? []))].sort();
  assertNoProviderRawMaterial(sanitized, options.label ?? 'ProviderResult');
  return sanitized;
}

export function sanitizeProviderError(error = {}, options = {}) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const sanitized = {
    name: error?.name === 'ProviderSdkValidationError' ? 'ProviderSdkValidationError' : 'ProviderError',
    code: String(error?.code ?? 'provider.error').replace(/[^a-z0-9._:-]+/giu, '_').slice(0, 120),
    message: /sf_provider_|authorization|cookie|token|raw body|secret/iu.test(message)
      ? 'Provider error contained sensitive material and was sanitized.'
      : message.slice(0, 240),
  };
  assertNoProviderRawMaterial(sanitized, options.label ?? 'ProviderError');
  return sanitized;
}

