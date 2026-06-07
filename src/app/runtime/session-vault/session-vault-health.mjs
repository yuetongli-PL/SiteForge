// @ts-check

import {
  assertSessionVaultSafeOutput,
} from './session-vault-sanitizer.mjs';
import {
  normalizeSessionRecord,
} from './session-vault-lifecycle.mjs';

export function createSessionInventoryView(records = []) {
  const inventory = (Array.isArray(records) ? records : [])
    .map((record) => normalizeSessionRecord(record));
  return assertSessionVaultSafeOutput(inventory);
}

export function createSessionVaultHealthView(records = [], {
  ledgerEvents = [],
} = {}) {
  const inventory = createSessionInventoryView(records);
  const byStatus = {};
  for (const record of inventory) {
    byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
  }
  const health = {
    status: inventory.some((record) => record.status === 'active') ? 'available' : 'metadata_only',
    sessionCount: inventory.length,
    byStatus,
    ledgerEventCount: Array.isArray(ledgerEvents) ? ledgerEvents.length : 0,
    redactionRequired: true,
  };
  return assertSessionVaultSafeOutput(health);
}
