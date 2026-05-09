// @ts-check

export const SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION = '1.0.0';
export const SITE_CAPABILITY_EXECUTION_VERSION = '0.1.0';
export const SITE_CAPABILITY_EXECUTION_COMPATIBLE_SCHEMA_VERSIONS = Object.freeze([
  SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
]);

export const EXECUTION_STATUSES = Object.freeze([
  'accepted',
  'blocked',
  'completed',
  'failed',
  'degraded',
  'skipped',
]);

const EXECUTION_SCHEMA_NAMES = Object.freeze([
  'ExecutionManifest',
  'LayerExecutionHandoffDescriptor',
  'ExecutionPolicyDecision',
  'ExecutionFeedback',
  'CoverageDelta',
  'CoverageDeltaArtifactQueue',
  'ExecutionArtifactGuardResult',
]);

export function listSiteCapabilityExecutionSchemaDefinitions() {
  return EXECUTION_SCHEMA_NAMES.map((name) => Object.freeze({
    name,
    version: SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/execution/schema.mjs',
  }));
}
