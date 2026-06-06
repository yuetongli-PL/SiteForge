// @ts-check

export const SITE_CAPABILITY_PLANNER_SCHEMA_VERSION = '1.0.0';
export const SITE_CAPABILITY_PLANNER_VERSION = '0.1.0';
export const SITE_CAPABILITY_PLANNER_COMPATIBLE_SCHEMA_VERSIONS = Object.freeze([
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
]);

export const PLANNER_SELECTED_ROUTE_SOURCE = 'site-capability-graph';

export const PLANNER_PLAN_STATUSES = Object.freeze([
  'ready',
  'blocked',
  'degraded',
  'failed',
]);

export const PLANNER_REQUEST_MODES = Object.freeze([
  'dry_run',
  'governed_handoff',
]);

const PLANNER_SCHEMA_NAMES = Object.freeze([
  'PlannerConfig',
  'PlanRequest',
  'PlanContext',
  'PlanContextCapabilityState',
  'PlanContextSessionState',
  'PlanContextRiskState',
  'CapabilityPlan',
  'PlanStep',
  'PlanDecision',
  'PlanRequirementSummary',
  'PlanRiskSummary',
  'PlanFailure',
  'PlanArtifact',
  'PlanManifest',
  'PlannerGraphSource',
  'PlannerRouteResolution',
  'PlannerContextCheck',
  'PlannerFallbackDecision',
  'PlannerReasonCode',
  'PlannerArtifactWriteResult',
  'PlannerLifecycleEvent',
  'PlannerDryRunResult',
  'PlannerLayerHandoffDescriptor',
  'RuntimeInvocationRequest',
  'PlannerCompatibilityDeclaration',
]);

export function listSiteCapabilityPlannerSchemaDefinitions() {
  return PLANNER_SCHEMA_NAMES.map((name) => Object.freeze({
    name,
    version: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    sourcePath: 'src/app/planner/schema.mjs',
  }));
}

/** @param {Record<string, any>} options */
export function createPlannerCompatibilityDeclaration({
  graphSchemaVersion,
  graphVersion,
  layerCompatibilityVersion,
  plannerVersion = SITE_CAPABILITY_PLANNER_VERSION,
} = {}) {
  return {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    plannerVersion,
    compatiblePlannerSchemaVersions: [...SITE_CAPABILITY_PLANNER_COMPATIBLE_SCHEMA_VERSIONS],
    graphSchemaVersion,
    graphVersion,
    layerCompatibilityVersion,
  };
}
