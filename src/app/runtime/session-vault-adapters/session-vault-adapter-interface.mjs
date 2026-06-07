// @ts-check

import {
  assertSessionVaultSafeOutput,
  safeSessionVaultRef,
} from '../session-vault/session-vault-sanitizer.mjs';

export const PRODUCTION_SESSION_VAULT_ADAPTER_INTERFACE_VERSION =
  'production-session-vault-adapter/v1';

export const PRODUCTION_SESSION_VAULT_ADAPTER_STORAGE_BOUNDARY =
  'backend_agnostic_metadata_only_runtime_boundary';

export const PRODUCTION_SESSION_VAULT_ADAPTER_ENCRYPTION_BOUNDARY =
  'backend_managed_encryption_at_rest_outside_runtime';

export const PRODUCTION_SESSION_VAULT_ADAPTER_KEY_MANAGEMENT_BOUNDARY =
  'external_kms_or_process_secret_boundary_outside_runtime';

export const PRODUCTION_SESSION_VAULT_ADAPTER_CAPABILITY_MATRIX = Object.freeze({
  backendAgnostic: true,
  filelessPrototypeSupported: true,
  managedBackendSupported: true,
  leaseTtlRequired: true,
  revocationRequired: true,
  auditSinkRequired: true,
  healthCheckRequired: true,
  materialPersistence: 'forbidden',
  profilePersistence: 'forbidden',
  browserStatePersistence: 'forbidden',
  automaticLogin: 'forbidden',
  runtimeIndexMaterialExport: 'forbidden',
});

const REQUIRED_METHODS = Object.freeze([
  'inspectSession',
  'getScopedSessionMaterial',
  'releaseScopedSessionMaterial',
  'healthCheck',
  'listLedgerEvents',
  'listSessionInventory',
]);

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function methodStatus(adapter, method) {
  return typeof adapter?.[method] === 'function';
}

export function createProductionSessionVaultAdapterInterface({
  adapterId = 'production-vault-adapter',
  adapterKind = 'production_session_vault_adapter',
} = {}) {
  const descriptor = {
    schemaVersion: PRODUCTION_SESSION_VAULT_ADAPTER_INTERFACE_VERSION,
    adapterId: safeSessionVaultRef(adapterId, 'production-vault-adapter'),
    adapterKind: safeSessionVaultRef(adapterKind, 'production_session_vault_adapter'),
    methods: [...REQUIRED_METHODS],
    storageBoundary: PRODUCTION_SESSION_VAULT_ADAPTER_STORAGE_BOUNDARY,
    encryptionAtRestBoundary: PRODUCTION_SESSION_VAULT_ADAPTER_ENCRYPTION_BOUNDARY,
    keyManagementBoundary: PRODUCTION_SESSION_VAULT_ADAPTER_KEY_MANAGEMENT_BOUNDARY,
    capabilityMatrix: PRODUCTION_SESSION_VAULT_ADAPTER_CAPABILITY_MATRIX,
    redactionRequired: true,
  };
  return assertSessionVaultSafeOutput(descriptor);
}

export function validateProductionSessionVaultAdapter(adapter = null) {
  const missingMethods = REQUIRED_METHODS.filter((method) => !methodStatus(adapter, method));
  const adapterId = normalizeText(adapter?.adapterId, 'production-vault-adapter');
  const validation = {
    schemaVersion: PRODUCTION_SESSION_VAULT_ADAPTER_INTERFACE_VERSION,
    adapterId: safeSessionVaultRef(adapterId, 'production-vault-adapter'),
    valid: missingMethods.length === 0,
    missingMethods,
    storageBoundary: PRODUCTION_SESSION_VAULT_ADAPTER_STORAGE_BOUNDARY,
    redactionRequired: true,
  };
  return assertSessionVaultSafeOutput(validation);
}

export function assertProductionSessionVaultAdapterValid(adapter = null) {
  const validation = validateProductionSessionVaultAdapter(adapter);
  if (validation.valid !== true) {
    throw new TypeError(`Production session vault adapter missing methods: ${validation.missingMethods.join(', ')}`);
  }
  return true;
}
