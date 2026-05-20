// @ts-check

import {
  SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
} from './schema.mjs';
import {
  prepareExecutionArtifactJsonWithAudit,
} from './artifact-guard.mjs';
import {
  assertCoverageDeltaCompatible,
  assertNoExecutionSensitiveMaterial,
} from './validator.mjs';

function queueIdFor(delta) {
  return `coverage-delta:${delta.executionId}`;
}

export function createCoverageDeltaArtifactQueueEntry({
  coverageDelta,
  artifactRef,
} = {}) {
  assertCoverageDeltaCompatible(coverageDelta);
  const entry = {
    schemaVersion: SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
    queueType: 'CoverageDeltaArtifactQueue',
    queueMode: 'redacted_descriptor_queue',
    queueId: queueIdFor(coverageDelta),
    artifactRef: artifactRef ?? `artifact:${queueIdFor(coverageDelta)}`,
    source: 'site-capability-layer-feedback',
    coverageDelta,
    writeGuard: 'SecurityGuard/Redaction',
    writeTarget: 'artifact-service-governed',
    descriptorOnly: true,
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(entry);
  return entry;
}

export function prepareCoverageDeltaArtifactQueueWrite(options = {}) {
  const entry = createCoverageDeltaArtifactQueueEntry(options);
  const prepared = prepareExecutionArtifactJsonWithAudit(entry);
  return {
    ...prepared,
    queueId: entry.queueId,
    artifactRef: entry.artifactRef,
    redactionRequired: true,
    redactionApplied: true,
  };
}
