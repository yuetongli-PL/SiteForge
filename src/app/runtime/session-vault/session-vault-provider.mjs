// @ts-check

import {
  RUNTIME_AUTH_REASONS,
} from '../runtime-reasons.mjs';
import {
  createSessionVaultAuditLedger,
} from './session-vault-audit-ledger.mjs';
import {
  normalizeSessionMaterialGrant,
} from './session-vault-grants.mjs';
import {
  normalizeSessionInspection,
  normalizeSessionRecord,
  safeSessionRefFromRecord,
  sessionStatusToRuntimeReason,
} from './session-vault-lifecycle.mjs';
import {
  sessionVaultScopesAllow,
} from './session-vault-policy.mjs';
import {
  assertSessionVaultSafeOutput,
  safeSessionVaultRef,
} from './session-vault-sanitizer.mjs';

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function keyForHandle(sessionHandle) {
  return normalizeText(sessionHandle);
}

export function createSessionVaultProvider({
  sessions = [],
  materialResolver = null,
  releaseMaterial = null,
  ledger = createSessionVaultAuditLedger(),
} = {}) {
  const sessionRecords = new Map();
  const activeGrants = new Map();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const handle = keyForHandle(session.sessionHandle ?? session.handle);
    if (!handle) continue;
    sessionRecords.set(handle, { ...session });
  }

  const recordLedger = (event) => ledger.record(event);

  const provider = {
    vaultType: 'production_session_vault_boundary_v2',
    /**
     * @param {{ sessionHandle?: unknown }} [request]
     */
    async inspectSession(request = {}) {
      const { sessionHandle } = request;
      const handle = keyForHandle(sessionHandle);
      const record = sessionRecords.get(handle);
      const sessionRef = record
        ? safeSessionRefFromRecord(record, handle)
        : safeSessionVaultRef(null, null);
      recordLedger({
        eventType: 'session.inspect.requested',
        sessionRef,
        outcome: 'requested',
      });
      if (!handle || !record) {
        recordLedger({
          eventType: 'session.inspect.denied',
          sessionRef,
          outcome: 'denied',
          reason: RUNTIME_AUTH_REASONS.sessionMissing,
        });
        return null;
      }
      const inspection = normalizeSessionInspection(record, { sessionHandle: handle });
      if (inspection.status === 'revoked') {
        recordLedger({
          eventType: 'session.revoked.observed',
          sessionRef: inspection.sessionRef,
          scopes: inspection.scopes,
          outcome: 'denied',
          reason: RUNTIME_AUTH_REASONS.sessionExpired,
        });
      }
      if (['expired', 'disabled'].includes(inspection.status)) {
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
      const handle = keyForHandle(request.sessionHandle);
      const record = sessionRecords.get(handle);
      const inspection = record ? normalizeSessionInspection(record, { sessionHandle: handle }) : null;
      recordLedger({
        eventType: 'session.grant.requested',
        sessionRef: inspection?.sessionRef,
        providerId: request.providerId,
        capabilityId: request.capabilityId,
        purpose: request.purpose,
        scopes: request.scopes,
        materialSummary: { types: request.materialTypes, count: request.materialTypes?.length ?? 0 },
        outcome: 'requested',
      });
      if (!inspection || inspection.active !== true) {
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
      const grant = typeof materialResolver === 'function'
        ? await materialResolver({
          ...request,
          sessionRef: inspection.sessionRef,
          sessionRecord: normalizeSessionRecord(record, { sessionHandle: handle }),
        })
        : null;
      if (!grant) {
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
      const grantId = normalizeText(grant.grantId ?? grant.id);
      if (grantId) {
        activeGrants.set(grantId, {
          grant,
          sessionRef: inspection.sessionRef,
          request: { ...request },
        });
      }
      const grantSummary = normalizeSessionMaterialGrant(grant, {
        providerId: request.providerId,
        capabilityId: request.capabilityId,
        purpose: request.purpose,
        scopes: request.scopes,
        outcome: 'issued',
      });
      recordLedger({
        eventType: 'session.grant.issued',
        sessionRef: inspection.sessionRef,
        providerId: request.providerId,
        capabilityId: request.capabilityId,
        purpose: request.purpose,
        scopes: request.scopes,
        materialSummary: grantSummary.materialSummary,
        outcome: 'issued',
      });
      return grant;
    },
    /**
     * @param {{ grantId?: unknown }} [request]
     */
    async releaseScopedSessionMaterial(request = {}) {
      const { grantId } = request;
      const key = normalizeText(grantId);
      const active = activeGrants.get(key);
      try {
        if (typeof releaseMaterial === 'function') {
          await releaseMaterial({ grantId, grant: active?.grant });
        }
        if (key) activeGrants.delete(key);
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
      } catch (error) {
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
        throw error;
      }
    },
    listLedgerEvents() {
      return ledger.listEvents();
    },
    listSessionInventory() {
      return [...sessionRecords.values()].map((record) => normalizeSessionRecord(record));
    },
  };
  return provider;
}

export const createInMemorySessionVaultProvider = createSessionVaultProvider;
