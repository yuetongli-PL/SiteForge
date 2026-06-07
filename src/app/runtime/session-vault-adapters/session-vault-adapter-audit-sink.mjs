// @ts-check

import {
  sanitizeSessionVaultLedgerEvent,
} from '../session-vault/session-vault-audit-ledger.mjs';

export function sanitizeProductionSessionVaultAdapterAuditEvent(event = {}) {
  return sanitizeSessionVaultLedgerEvent(event);
}

export function createProductionSessionVaultAdapterAuditSink() {
  const events = [];
  return {
    record(event = {}) {
      const sanitized = sanitizeProductionSessionVaultAdapterAuditEvent(event);
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
