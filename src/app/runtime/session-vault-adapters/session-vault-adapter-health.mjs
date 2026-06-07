// @ts-check

import {
  assertSessionVaultSafeOutput,
  safeSessionVaultRef,
} from '../session-vault/session-vault-sanitizer.mjs';
import {
  createSessionInventoryView,
} from '../session-vault/session-vault-health.mjs';
import {
  PRODUCTION_SESSION_VAULT_ADAPTER_CAPABILITY_MATRIX,
  PRODUCTION_SESSION_VAULT_ADAPTER_ENCRYPTION_BOUNDARY,
  PRODUCTION_SESSION_VAULT_ADAPTER_INTERFACE_VERSION,
  PRODUCTION_SESSION_VAULT_ADAPTER_KEY_MANAGEMENT_BOUNDARY,
  PRODUCTION_SESSION_VAULT_ADAPTER_STORAGE_BOUNDARY,
} from './session-vault-adapter-interface.mjs';

export function createProductionSessionVaultAdapterHealthView({
  adapterId = 'production-vault-adapter',
  records = [],
  ledgerEvents = [],
  activeGrantCount = 0,
} = {}) {
  const inventory = createSessionInventoryView(records);
  const byStatus = {};
  for (const record of inventory) {
    byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
  }
  const health = {
    schemaVersion: PRODUCTION_SESSION_VAULT_ADAPTER_INTERFACE_VERSION,
    adapterId: safeSessionVaultRef(adapterId, 'production-vault-adapter'),
    status: inventory.some((record) => record.status === 'active') ? 'available' : 'metadata_only',
    sessionCount: inventory.length,
    activeGrantCount: Math.max(0, Number(activeGrantCount) || 0),
    byStatus,
    ledgerEventCount: Array.isArray(ledgerEvents) ? ledgerEvents.length : 0,
    storageBoundary: PRODUCTION_SESSION_VAULT_ADAPTER_STORAGE_BOUNDARY,
    encryptionAtRestBoundary: PRODUCTION_SESSION_VAULT_ADAPTER_ENCRYPTION_BOUNDARY,
    keyManagementBoundary: PRODUCTION_SESSION_VAULT_ADAPTER_KEY_MANAGEMENT_BOUNDARY,
    capabilityMatrix: PRODUCTION_SESSION_VAULT_ADAPTER_CAPABILITY_MATRIX,
    redactionRequired: true,
  };
  return assertSessionVaultSafeOutput(health);
}
