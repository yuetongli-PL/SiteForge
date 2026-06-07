// @ts-check

import { RUNTIME_RUN_STORE_QUERY_INDEX_SCHEMA_VERSION } from './run-store-schema.mjs';
import { sanitizeRunStoreManifest } from './run-store-sanitizer.mjs';

export function createRunStoreQueryIndex(manifests = []) {
  return {
    schemaVersion: RUNTIME_RUN_STORE_QUERY_INDEX_SCHEMA_VERSION,
    runCount: manifests.length,
    runs: manifests.map((manifest) => {
      const safe = sanitizeRunStoreManifest(manifest);
      return {
        runId: safe.runId,
        status: safe.status,
        providerId: safe.providerId,
        capabilityRef: safe.capabilityRef,
        packageId: safe.packageId,
        policyId: safe.policyId,
        reason: safe.policyDecisionSummary?.reason ?? '',
        sideEffectAttempted: safe.sideEffectAttempted,
        redactionStatus: safe.redaction.status,
      };
    }),
    redactionRequired: true,
  };
}

export function queryRunStoreIndex(index = {}, filters = {}) {
  const runs = Array.isArray(index.runs) ? index.runs : [];
  return {
    schemaVersion: RUNTIME_RUN_STORE_QUERY_INDEX_SCHEMA_VERSION,
    count: runs.filter((run) => (
      (!filters.status || run.status === filters.status)
      && (!filters.providerId || run.providerId === filters.providerId)
      && (!filters.policyId || run.policyId === filters.policyId)
      && (!filters.reason || run.reason === filters.reason)
    )).length,
    runs: runs.filter((run) => (
      (!filters.status || run.status === filters.status)
      && (!filters.providerId || run.providerId === filters.providerId)
      && (!filters.policyId || run.policyId === filters.policyId)
      && (!filters.reason || run.reason === filters.reason)
    )),
    redactionRequired: true,
  };
}
