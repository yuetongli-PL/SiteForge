// @ts-check

import { createRuntimeRunId } from './run-store-paths.mjs';
import { createRunStoreIntegrityDigest } from './run-store-integrity.mjs';
import { createRunStoreRetentionMetadata } from './run-store-retention.mjs';
import { sanitizeRunStoreManifest } from './run-store-sanitizer.mjs';

export function createRunStoreManifest(run = {}, options = {}) {
  const manifest = sanitizeRunStoreManifest({
    runId: run.runId ?? createRuntimeRunId({ seed: options.seed ?? run.invocationRef ?? 'runtime' }),
    createdAt: run.createdAt ?? options.createdAt ?? 'unknown',
    invocationRef: run.invocationRef,
    capabilityRef: run.capabilityRef,
    executionContractRef: run.executionContractRef,
    providerId: run.providerId,
    packageId: run.packageId,
    policyId: run.policyDecisionSummary?.policyId ?? run.policyId,
    status: run.status,
    sideEffectAttempted: run.sideEffectAttempted,
    files: run.files ?? [],
    artifactMetadata: run.artifactMetadata ?? [],
    policyDecisionSummary: run.policyDecisionSummary,
    vaultLedgerSummary: run.vaultLedgerSummary,
    retention: createRunStoreRetentionMetadata(run.retention ?? options.retention),
    redaction: run.redaction ?? { status: 'ok', sensitiveInputDetected: false },
    sourceDigests: run.sourceDigests ?? [],
    warnings: run.warnings ?? [],
  });
  return sanitizeRunStoreManifest({
    ...manifest,
    integrityDigest: createRunStoreIntegrityDigest(manifest),
  });
}
