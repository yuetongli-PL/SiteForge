// @ts-check

export const SITE_CAPABILITY_COMPILER_SCHEMA_VERSION = '1.0.0';
export const SITE_CAPABILITY_COMPILER_VERSION = '0.1.0';
export const SITE_CAPABILITY_COMPILER_COMPATIBLE_SCHEMA_VERSIONS = Object.freeze([
  SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
]);

export const SITE_COMPILE_COVERAGE_MODES = Object.freeze([
  'declared_only',
  'observed_only',
  'hybrid',
  'regression_replay',
  'bounded_full',
]);

export const SITE_COMPILE_COVERAGE_COMPLETENESS = Object.freeze([
  'complete_within_scope',
  'partial',
  'unknown',
  'blocked',
]);

export const SITE_COMPILE_CAPTURE_MODES = Object.freeze([
  'static',
  'adapter_metadata',
  'redacted_artifact_replay',
  'governed_capture',
  'api_discovery',
  'dry_run_trace',
]);

export const SITE_COMPILE_SOURCE_TYPES = Object.freeze([
  'site-registry',
  'site-capabilities',
  'adapter-metadata',
  'redacted-artifact',
  'synthetic-fixture',
  'api-discovery',
  'dry-run-trace',
]);

const COMPILER_SCHEMA_NAMES = Object.freeze([
  'SiteCompileRequest',
  'SiteCompileScope',
  'SiteCompileManifest',
  'SiteCompileSourceRef',
  'CompilerConfigSource',
  'CompilerSourceDigest',
  'IncrementalCompileSummary',
  'NodeInventory',
  'CapabilityInventory',
  'ExecutionPathInventory',
  'FunctionPathTrace',
  'RequirementInventory',
  'CompileCoverageReport',
  'UnknownNodeReport',
  'CapabilityGraphDraft',
  'GraphBuildManifest',
  'ExecutionManifest',
  'ExecutionFeedback',
  'CoverageDelta',
  'CompilerLifecycleEvent',
  'CompilerArtifactGuardResult',
  'CompilerCompatibilityDeclaration',
]);

export function listSiteCapabilityCompilerSchemaDefinitions() {
  return COMPILER_SCHEMA_NAMES.map((name) => Object.freeze({
    name,
    version: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/compiler/schema.mjs',
  }));
}

export function createCompilerCompatibilityDeclaration({
  compilerVersion = SITE_CAPABILITY_COMPILER_VERSION,
  graphSchemaVersion,
  graphVersion,
  plannerCompatibilityVersion,
  layerCompatibilityVersion,
} = {}) {
  return {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    compilerVersion,
    compatibleCompilerSchemaVersions: [...SITE_CAPABILITY_COMPILER_COMPATIBLE_SCHEMA_VERSIONS],
    graphSchemaVersion,
    graphVersion,
    plannerCompatibilityVersion,
    layerCompatibilityVersion,
  };
}
