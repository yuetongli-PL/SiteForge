// @ts-check

import {
  RUNTIME_AUTH_REASONS,
} from '../runtime-reasons.mjs';
import {
  normalizeSessionInspection,
  normalizeSessionRecord,
  safeSessionRefFromRecord,
  sessionStatusToRuntimeReason,
} from '../session-vault/session-vault-lifecycle.mjs';
import {
  sessionVaultScopesAllow,
} from '../session-vault/session-vault-policy.mjs';
import {
  assertSessionVaultSafeOutput,
  safeSessionVaultRef,
  sanitizeMaterialSummary,
} from '../session-vault/session-vault-sanitizer.mjs';
import {
  createProductionSessionVaultAdapterAuditSink,
} from './session-vault-adapter-audit-sink.mjs';
import {
  createProductionSessionVaultAdapterHealthView,
} from './session-vault-adapter-health.mjs';
import {
  PRODUCTION_SESSION_VAULT_ADAPTER_CAPABILITY_MATRIX,
  PRODUCTION_SESSION_VAULT_ADAPTER_INTERFACE_VERSION,
} from './session-vault-adapter-interface.mjs';

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function dateMs(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateIso(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function materialEntries(record = {}) {
  return toArray(record.materials ?? record.material).filter((entry) => entry && typeof entry === 'object');
}

function requestedMaterialTypes(request = {}) {
  return [...new Set(toArray(request.materialTypes)
    .map((type) => normalizeText(type).toLowerCase())
    .filter(Boolean))]
    .sort();
}

function finitePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function createStoredRecord(session = {}, {
  nowMs,
  defaultLeaseTtlMs,
} = {}) {
  const sessionHandle = normalizeText(session.sessionHandle ?? session.handle);
  if (!sessionHandle) return null;
  const leaseIssuedAtMs = dateMs(session.leaseIssuedAt ?? session.issuedAt) ?? nowMs;
  const ttlMs = finitePositiveNumber(session.leaseTtlMs ?? defaultLeaseTtlMs);
  const leaseExpiresAtMs = dateMs(session.leaseExpiresAt ?? session.expiresAt ?? session.expiry)
    ?? (ttlMs ? leaseIssuedAtMs + ttlMs : null);
  const materials = materialEntries(session);
  const metadata = {
    ...session,
    sessionHandle: undefined,
    handle: undefined,
    material: undefined,
    materials: undefined,
    status: normalizeText(session.status, 'active'),
    active: session.active !== false,
    expiresAt: dateIso(leaseExpiresAtMs) ?? session.expiresAt,
    leaseIssuedAt: dateIso(leaseIssuedAtMs),
    leaseExpiresAt: dateIso(leaseExpiresAtMs),
    materialSummary: sanitizeMaterialSummary(session.materialSummary, materials),
  };
  return {
    sessionHandle,
    metadata,
    materials,
    leaseExpiresAtMs,
  };
}

function statusForStoredRecord(record, nowMs) {
  const status = normalizeText(record?.metadata?.status).toLowerCase();
  if (record?.metadata?.revoked === true || status === 'revoked') return 'revoked';
  if (record?.metadata?.disabled === true || status === 'disabled') return 'disabled';
  if (Number.isFinite(record?.leaseExpiresAtMs) && nowMs >= record.leaseExpiresAtMs) return 'expired';
  if (status === 'expired' || record?.metadata?.expired === true) return 'expired';
  if (status === 'stale') return 'stale';
  return 'active';
}

function metadataForStoredRecord(record, nowMs) {
  const status = statusForStoredRecord(record, nowMs);
  return {
    ...record.metadata,
    status,
    active: status === 'active',
    expired: ['expired', 'revoked', 'disabled'].includes(status),
    revoked: status === 'revoked',
  };
}

function sanitizedReleaseError() {
  const error = new Error('production vault adapter release failed');
  error.code = RUNTIME_AUTH_REASONS.sessionVaultUnavailable;
  return error;
}

export function createInMemoryProductionVaultAdapter({
  adapterId = 'production-vault-adapter:in-memory-fileless',
  sessions = [],
  auditSink = createProductionSessionVaultAdapterAuditSink(),
  now = () => Date.now(),
  defaultLeaseTtlMs = null,
  releaseFailure = null,
} = {}) {
  const records = new Map();
  const activeGrants = new Map();
  let grantSequence = 0;
  const safeAdapterId = safeSessionVaultRef(adapterId, 'production-vault-adapter-in-memory-fileless');

  const currentMs = () => Number(now());
  for (const session of toArray(sessions)) {
    const stored = createStoredRecord(session, {
      nowMs: currentMs(),
      defaultLeaseTtlMs,
    });
    if (stored) records.set(stored.sessionHandle, stored);
  }

  const recordLedger = (event) => auditSink.record(event);
  const pruneInactiveGrants = () => {
    for (const [grantId, active] of [...activeGrants.entries()]) {
      const stored = records.get(active.sessionHandle);
      if (!stored) {
        activeGrants.delete(grantId);
        continue;
      }
      const status = statusForStoredRecord(stored, currentMs());
      if (status === 'active') continue;
      activeGrants.delete(grantId);
      recordLedger({
        eventType: 'session.grant.released',
        sessionRef: active.sessionRef,
        providerId: active.request?.providerId,
        capabilityId: active.request?.capabilityId,
        purpose: active.request?.purpose,
        scopes: active.request?.scopes,
        outcome: status === 'revoked' ? 'revoked' : 'expired',
        reason: sessionStatusToRuntimeReason(status),
      });
    }
  };
  const inspectionFor = (sessionHandle) => {
    const handle = normalizeText(sessionHandle);
    const stored = records.get(handle);
    if (!handle || !stored) return null;
    return normalizeSessionInspection(metadataForStoredRecord(stored, currentMs()), { sessionHandle: handle });
  };
  const inventoryRecords = () => [...records.values()]
    .map((record) => normalizeSessionRecord(metadataForStoredRecord(record, currentMs()), {
      sessionHandle: record.sessionHandle,
    }));

  const adapter = {
    adapterId: safeAdapterId,
    adapterKind: 'in_memory_production_vault_adapter',
    schemaVersion: PRODUCTION_SESSION_VAULT_ADAPTER_INTERFACE_VERSION,
    capabilityMatrix: PRODUCTION_SESSION_VAULT_ADAPTER_CAPABILITY_MATRIX,
    vaultType: 'production_session_vault_adapter_v1',

    async inspectSession(request = {}) {
      const handle = normalizeText(request.sessionHandle);
      const stored = records.get(handle);
      const sessionRef = stored
        ? safeSessionRefFromRecord(stored.metadata, handle)
        : null;
      recordLedger({
        eventType: 'session.inspect.requested',
        sessionRef,
        outcome: 'requested',
      });
      const inspection = inspectionFor(handle);
      if (!inspection) {
        recordLedger({
          eventType: 'session.inspect.denied',
          sessionRef,
          outcome: 'denied',
          reason: RUNTIME_AUTH_REASONS.sessionMissing,
        });
        return null;
      }
      if (inspection.revoked === true) {
        recordLedger({
          eventType: 'session.revoked.observed',
          sessionRef: inspection.sessionRef,
          scopes: inspection.scopes,
          outcome: 'denied',
          reason: RUNTIME_AUTH_REASONS.sessionExpired,
        });
      } else if (inspection.expired === true) {
        recordLedger({
          eventType: 'session.expired.observed',
          sessionRef: inspection.sessionRef,
          scopes: inspection.scopes,
          outcome: 'denied',
          reason: RUNTIME_AUTH_REASONS.sessionExpired,
        });
      }
      recordLedger({
        eventType: inspection.active ? 'session.inspect.completed' : 'session.inspect.denied',
        sessionRef: inspection.sessionRef,
        scopes: inspection.scopes,
        outcome: inspection.active ? 'completed' : 'denied',
        reason: inspection.active ? null : sessionStatusToRuntimeReason(inspection.status),
      });
      return inspection;
    },

    async getScopedSessionMaterial(request = {}) {
      const handle = normalizeText(request.sessionHandle);
      const stored = records.get(handle);
      const inspection = inspectionFor(handle);
      const materialTypes = requestedMaterialTypes(request);
      pruneInactiveGrants();
      recordLedger({
        eventType: 'session.grant.requested',
        sessionRef: inspection?.sessionRef,
        providerId: request.providerId,
        capabilityId: request.capabilityId,
        purpose: request.purpose,
        scopes: request.scopes,
        materialSummary: { types: materialTypes, count: materialTypes.length },
        outcome: 'requested',
      });
      if (!inspection || inspection.active !== true || !stored) {
        recordLedger({
          eventType: 'session.grant.denied',
          sessionRef: inspection?.sessionRef,
          providerId: request.providerId,
          capabilityId: request.capabilityId,
          purpose: request.purpose,
          scopes: request.scopes,
          outcome: 'denied',
          reason: inspection ? sessionStatusToRuntimeReason(inspection.status) : RUNTIME_AUTH_REASONS.sessionMissing,
        });
        return null;
      }
      if (materialTypes.length === 0) {
        recordLedger({
          eventType: 'session.material.unavailable',
          sessionRef: inspection.sessionRef,
          providerId: request.providerId,
          capabilityId: request.capabilityId,
          purpose: request.purpose,
          scopes: request.scopes,
          outcome: 'denied',
          reason: RUNTIME_AUTH_REASONS.materialUnavailable,
        });
        return null;
      }
      if (!sessionVaultScopesAllow({
        requestedScopes: request.scopes,
        sessionScopes: inspection.scopes,
      })) {
        recordLedger({
          eventType: 'session.scope.denied',
          sessionRef: inspection.sessionRef,
          providerId: request.providerId,
          capabilityId: request.capabilityId,
          purpose: request.purpose,
          scopes: request.scopes,
          outcome: 'denied',
          reason: RUNTIME_AUTH_REASONS.scopeNotAllowed,
        });
        return null;
      }

      const allowed = new Set(materialTypes);
      const materials = stored.materials
        .filter((entry) => allowed.has(normalizeText(entry.type ?? entry.materialType).toLowerCase()))
        .map((entry) => clone(entry));
      if (materials.length === 0) {
        recordLedger({
          eventType: 'session.material.unavailable',
          sessionRef: inspection.sessionRef,
          providerId: request.providerId,
          capabilityId: request.capabilityId,
          purpose: request.purpose,
          scopes: request.scopes,
          outcome: 'denied',
          reason: RUNTIME_AUTH_REASONS.materialUnavailable,
        });
        return null;
      }

      grantSequence += 1;
      const grantId = `prod-vault-grant:${grantSequence}`;
      const grant = {
        grantId,
        materials,
        summary: {
          materialTypes: materials.map((entry) => normalizeText(entry.type ?? entry.materialType).toLowerCase()).sort(),
          materialCount: materials.length,
          expiresAt: inspection.expiresAt ?? null,
        },
        expiresAt: inspection.expiresAt ?? null,
      };
      activeGrants.set(grantId, {
        sessionHandle: handle,
        sessionRef: inspection.sessionRef,
        request: { ...request, scopes: clone(request.scopes) },
      });
      recordLedger({
        eventType: 'session.grant.issued',
        sessionRef: inspection.sessionRef,
        providerId: request.providerId,
        capabilityId: request.capabilityId,
        purpose: request.purpose,
        scopes: request.scopes,
        materialSummary: grant.summary,
        outcome: 'issued',
      });
      return grant;
    },

    async releaseScopedSessionMaterial(request = {}) {
      const grantId = normalizeText(request.grantId);
      const active = activeGrants.get(grantId);
      if (!active) {
        recordLedger({
          eventType: 'session.grant.release_failed',
          outcome: 'release_failed',
          reason: RUNTIME_AUTH_REASONS.sessionVaultUnavailable,
        });
        throw sanitizedReleaseError();
      }
      const shouldFail = typeof releaseFailure === 'function'
        ? releaseFailure({ grantId }) === true
        : releaseFailure === true;
      if (shouldFail) {
        recordLedger({
          eventType: 'session.grant.release_failed',
          sessionRef: active?.sessionRef,
          providerId: active?.request?.providerId,
          capabilityId: active?.request?.capabilityId,
          purpose: active?.request?.purpose,
          scopes: active?.request?.scopes,
          outcome: 'release_failed',
          reason: RUNTIME_AUTH_REASONS.sessionVaultUnavailable,
        });
        throw sanitizedReleaseError();
      }
      if (grantId) activeGrants.delete(grantId);
      recordLedger({
        eventType: 'session.grant.released',
        sessionRef: active?.sessionRef,
        providerId: active?.request?.providerId,
        capabilityId: active?.request?.capabilityId,
        purpose: active?.request?.purpose,
        scopes: active?.request?.scopes,
        outcome: 'released',
      });
      return assertSessionVaultSafeOutput({
        released: true,
        redactionRequired: true,
      });
    },

    async revokeSession(request = {}) {
      const handle = normalizeText(request.sessionHandle);
      const stored = records.get(handle);
      if (!stored) {
        return assertSessionVaultSafeOutput({
          revoked: false,
          reason: RUNTIME_AUTH_REASONS.sessionMissing,
          redactionRequired: true,
        });
      }
      stored.metadata.status = 'revoked';
      stored.metadata.revoked = true;
      stored.metadata.active = false;
      stored.metadata.revokedAt = new Date(currentMs()).toISOString();
      const inspection = inspectionFor(handle);
      pruneInactiveGrants();
      recordLedger({
        eventType: 'session.revoked.observed',
        sessionRef: inspection?.sessionRef,
        scopes: inspection?.scopes,
        outcome: 'denied',
        reason: RUNTIME_AUTH_REASONS.sessionExpired,
      });
      return assertSessionVaultSafeOutput({
        revoked: true,
        sessionRef: inspection?.sessionRef,
        status: 'revoked',
        redactionRequired: true,
      });
    },

    async healthCheck() {
      pruneInactiveGrants();
      return createProductionSessionVaultAdapterHealthView({
        adapterId: safeAdapterId,
        records: inventoryRecords(),
        ledgerEvents: auditSink.listEvents(),
        activeGrantCount: activeGrants.size,
      });
    },

    listLedgerEvents() {
      return auditSink.listEvents();
    },

    listSessionInventory() {
      return inventoryRecords();
    },
  };

  return adapter;
}
