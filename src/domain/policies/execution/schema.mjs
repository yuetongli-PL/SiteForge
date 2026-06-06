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

export const EXECUTION_VERDICTS = Object.freeze([
  'allow',
  'controlled',
  'blocked',
]);

export const EXECUTION_DISPOSITIONS = EXECUTION_VERDICTS;

export const EXECUTION_GATES = Object.freeze([
  'confirm_required',
  'audit_required',
  'session_required',
  'permission_required',
  'output_path_required',
  'dry_run_required',
]);

const EXECUTION_SCHEMA_NAMES = Object.freeze([
  'ExecutionManifest',
  'LayerExecutionHandoffDescriptor',
  'ExecutionPolicyDecision',
  'GovernedExecutionPolicyDecision',
  'RuntimeInvocationRequest',
  'ExecutionFeedback',
  'CoverageDelta',
  'CoverageDeltaArtifactQueue',
  'LayerOwnedRuntimeConsumerResult',
  'ExecutionArtifactGuardResult',
]);

export function listSiteCapabilityExecutionSchemaDefinitions() {
  return EXECUTION_SCHEMA_NAMES.map((name) => Object.freeze({
    name,
    version: SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
    sourcePath: 'src/domain/policies/execution/schema.mjs',
  }));
}
