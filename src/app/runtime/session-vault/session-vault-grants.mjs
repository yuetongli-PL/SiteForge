// @ts-check

import {
  SESSION_VAULT_SCHEMA_VERSION,
} from './session-vault-types.mjs';
import {
  assertSessionVaultSafeOutput,
  safeSessionVaultRef,
  sanitizeMaterialSummary,
  sanitizeSessionVaultScopes,
  stableSessionVaultHash,
} from './session-vault-sanitizer.mjs';

function dateText(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function safeGrantRef(grantId = '') {
  return stableSessionVaultHash(grantId, 'session-grant');
}

export function normalizeSessionMaterialGrant(grant = {}, {
  providerId = null,
  capabilityId = null,
  purpose = null,
  scopes = [],
  outcome = 'issued',
  reason = null,
} = {}) {
  const materials = Array.isArray(grant.materials)
    ? grant.materials
    : Array.isArray(grant.material)
      ? grant.material
      : [];
  const normalized = {
    schemaVersion: SESSION_VAULT_SCHEMA_VERSION,
    grantRef: safeGrantRef(grant.grantId ?? grant.id ?? `${providerId}:${capabilityId}:${purpose}`),
    providerId: safeSessionVaultRef(providerId, null),
    capabilityId: safeSessionVaultRef(capabilityId, null),
    purpose: safeSessionVaultRef(purpose, null),
    scopes: sanitizeSessionVaultScopes(scopes),
    materialSummary: sanitizeMaterialSummary(grant.summary, materials),
    issuedAt: dateText(grant.issuedAt ?? grant.createdAt),
    releasedAt: dateText(grant.releasedAt),
    outcome: safeSessionVaultRef(outcome, 'issued'),
    reason: safeSessionVaultRef(reason, null),
    redactionRequired: true,
  };
  const output = Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== null));
  return assertSessionVaultSafeOutput(output);
}
