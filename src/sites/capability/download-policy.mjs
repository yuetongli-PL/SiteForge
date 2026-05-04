// @ts-check

import { normalizeReasonCode } from './reason-codes.mjs';

export const DOWNLOAD_POLICY_SCHEMA_VERSION = 1;

export const DOWNLOAD_POLICY_SESSION_REQUIREMENTS = Object.freeze([
  'none',
  'optional',
  'required',
]);

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeNonNegativeInteger(value, fallback, fieldName) {
  const numeric = Number(value ?? fallback);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`DownloadPolicy ${fieldName} must be a non-negative number`);
  }
  return Math.trunc(numeric);
}

function normalizeSessionRequirement(value) {
  const normalized = normalizeText(value) ?? 'none';
  if (!DOWNLOAD_POLICY_SESSION_REQUIREMENTS.includes(normalized)) {
    throw new Error(`Unsupported DownloadPolicy sessionRequirement: ${normalized}`);
  }
  return normalized;
}

function normalizeFlagObject(value, fallback = false) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      enabled: normalizeBoolean(value.enabled, fallback),
    };
  }
  return {
    enabled: normalizeBoolean(value, fallback),
  };
}

export function assertDownloadPolicyCompatible(raw = {}) {
  const version = Number(raw?.schemaVersion);
  if (!Number.isInteger(version)) {
    throw new Error('DownloadPolicy schemaVersion is required for compatibility checks');
  }
  if (version !== DOWNLOAD_POLICY_SCHEMA_VERSION) {
    throw new Error(`DownloadPolicy schemaVersion ${version} is not compatible with ${DOWNLOAD_POLICY_SCHEMA_VERSION}`);
  }
  return true;
}

export function normalizeDownloadPolicy(raw = {}, defaults = {}) {
  if (raw.schemaVersion !== undefined) {
    assertDownloadPolicyCompatible(raw);
  }
  const siteKey = normalizeText(raw.siteKey ?? defaults.siteKey);
  if (!siteKey) {
    throw new Error('DownloadPolicy siteKey is required');
  }
  const reasonCode = normalizeText(raw.reasonCode ?? defaults.reasonCode);
  return {
    schemaVersion: DOWNLOAD_POLICY_SCHEMA_VERSION,
    siteKey,
    taskType: normalizeText(raw.taskType ?? defaults.taskType) ?? 'generic-resource',
    dryRun: normalizeBoolean(raw.dryRun ?? defaults.dryRun, true),
    allowNetworkResolve: normalizeBoolean(raw.allowNetworkResolve ?? raw.network?.allowResolve ?? defaults.allowNetworkResolve, false),
    retries: normalizeNonNegativeInteger(raw.retries ?? defaults.retries, 0, 'retries'),
    retryBackoffMs: normalizeNonNegativeInteger(raw.retryBackoffMs ?? defaults.retryBackoffMs, 0, 'retryBackoffMs'),
    cache: normalizeFlagObject(raw.cache ?? defaults.cache, true),
    dedup: normalizeFlagObject(raw.dedup ?? defaults.dedup, true),
    sessionRequirement: normalizeSessionRequirement(raw.sessionRequirement ?? defaults.sessionRequirement),
    reasonCode: reasonCode ? normalizeReasonCode(reasonCode) : undefined,
  };
}
