// @ts-check

import { RUNTIME_RUN_STORE_RETENTION_SCHEMA_VERSION } from './run-store-schema.mjs';

export function createRunStoreRetentionMetadata(options = {}) {
  return {
    schemaVersion: RUNTIME_RUN_STORE_RETENTION_SCHEMA_VERSION,
    retentionClass: String(options.retentionClass ?? 'standard').replace(/[^a-z0-9._:-]+/giu, '_'),
    ttlDays: Number.isFinite(Number(options.ttlDays)) ? Math.max(0, Number(options.ttlDays)) : 30,
    purgeEligible: options.purgeEligible === true,
    rawMaterialRetentionAllowed: false,
    redactionRequired: true,
  };
}
