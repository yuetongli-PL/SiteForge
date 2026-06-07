// @ts-check

import {
  RUNTIME_AUTH_REASONS,
} from '../runtime-reasons.mjs';
import {
  SESSION_LIFECYCLE_STATUSES,
  SESSION_VAULT_SCHEMA_VERSION,
} from './session-vault-types.mjs';
import {
  assertSessionVaultSafeOutput,
  safeSessionVaultRef,
  safeSessionVaultText,
  sanitizeMaterialSummary,
  sanitizeSessionVaultScopes,
  stableSessionVaultHash,
} from './session-vault-sanitizer.mjs';

const STATUS_SET = new Set(SESSION_LIFECYCLE_STATUSES);

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeStatus(record = {}) {
  const status = normalizeText(record.status).toLowerCase();
  if (record.revoked === true || status === 'revoked') return 'revoked';
  if (record.disabled === true || status === 'disabled') return 'disabled';
  if (record.rotated === true || status === 'rotated') return 'rotated';
  if (record.expired === true || status === 'expired') return 'expired';
  if (record.stale === true || status === 'stale') return 'stale';
  if (record.active === true || status === 'active' || status === 'valid') return 'active';
  return STATUS_SET.has(status) ? status : 'unknown';
}

function dateText(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function safeSessionRefFromRecord(record = {}, sessionHandle = '') {
  return safeSessionVaultRef(
    record.sessionRef ?? record.ref ?? record.id ?? record.sessionId,
    stableSessionVaultHash(sessionHandle, 'auth-session'),
  );
}

export function normalizeSessionRecord(record = {}, {
  sessionHandle = '',
} = {}) {
  const status = normalizeStatus(record);
  const normalized = {
    schemaVersion: SESSION_VAULT_SCHEMA_VERSION,
    sessionRef: safeSessionRefFromRecord(record, sessionHandle),
    status,
    active: status === 'active',
    origin: safeSessionVaultText(record.origin, null),
    audience: safeSessionVaultRef(record.audience, null),
    scopes: sanitizeSessionVaultScopes(record.scopes ?? record.allowedScopes ?? record.authorizedScopes),
    expiresAt: dateText(record.expiresAt ?? record.expiry),
    lastUsedAt: dateText(record.lastUsedAt),
    revokedAt: dateText(record.revokedAt),
    rotatedAt: dateText(record.rotatedAt),
    policyVersion: safeSessionVaultRef(record.policyVersion, null),
    materialSummary: sanitizeMaterialSummary(record.materialSummary),
    materialPolicy: 'metadata_only',
    redactionRequired: true,
  };
  const output = Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== null));
  return assertSessionVaultSafeOutput(output);
}

export function normalizeSessionInspection(metadata = null, {
  sessionHandle = '',
} = {}) {
  if (!metadata) return null;
  const record = normalizeSessionRecord(metadata, { sessionHandle });
  const inspection = {
    sessionRef: record.sessionRef,
    status: record.status,
    active: record.status === 'active',
    expired: ['expired', 'revoked', 'disabled'].includes(record.status),
    revoked: record.status === 'revoked',
    scopes: record.scopes,
    expiresAt: record.expiresAt,
    materialPolicy: 'metadata_only',
    redactionRequired: true,
  };
  return assertSessionVaultSafeOutput(inspection);
}

export function sessionStatusToRuntimeReason(status) {
  const normalized = normalizeText(status).toLowerCase();
  if (['expired', 'revoked', 'disabled', 'rotated', 'stale'].includes(normalized)) {
    return RUNTIME_AUTH_REASONS.sessionExpired;
  }
  if (normalized === 'missing') {
    return RUNTIME_AUTH_REASONS.sessionMissing;
  }
  if (normalized === 'scope_denied') {
    return RUNTIME_AUTH_REASONS.scopeNotAllowed;
  }
  if (normalized === 'material_unavailable') {
    return RUNTIME_AUTH_REASONS.materialUnavailable;
  }
  return null;
}
