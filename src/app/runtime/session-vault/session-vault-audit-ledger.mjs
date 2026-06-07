// @ts-check

import {
  assertSessionVaultSafeOutput,
  safeSessionVaultRef,
  sanitizeMaterialSummary,
  sanitizeSessionVaultScopes,
} from './session-vault-sanitizer.mjs';
import {
  SESSION_VAULT_LEDGER_EVENT_SET,
} from './session-vault-types.mjs';

function nowIso() {
  return new Date().toISOString();
}

function safeEventType(value) {
  return SESSION_VAULT_LEDGER_EVENT_SET.has(value) ? value : 'session.inspect.denied';
}

export function sanitizeSessionVaultLedgerEvent(event = {}) {
  const sanitized = {
    eventType: safeEventType(event.eventType),
    sessionRef: safeSessionVaultRef(event.sessionRef, null),
    providerId: safeSessionVaultRef(event.providerId, null),
    capabilityId: safeSessionVaultRef(event.capabilityId, null),
    purpose: safeSessionVaultRef(event.purpose, null),
    scopes: sanitizeSessionVaultScopes(event.scopes),
    materialSummary: sanitizeMaterialSummary(event.materialSummary),
    outcome: safeSessionVaultRef(event.outcome, null),
    reason: safeSessionVaultRef(event.reason, null),
    policyId: safeSessionVaultRef(event.policyId, null),
    timestamp: event.timestamp ?? nowIso(),
    redactionRequired: true,
  };
  const output = Object.fromEntries(Object.entries(sanitized).filter(([, value]) => value !== null));
  return assertSessionVaultSafeOutput(output);
}

export function createSessionVaultAuditLedger() {
  const events = [];
  return {
    record(event = {}) {
      const sanitized = sanitizeSessionVaultLedgerEvent(event);
      events.push(sanitized);
      return sanitized;
    },
    listEvents() {
      return events.map((event) => ({ ...event }));
    },
    clear() {
      events.length = 0;
    },
  };
}
