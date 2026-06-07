// @ts-check

export const DESTRUCTIVE_EXECUTION_PLAN_SCHEMA_VERSION = 'destructive.execution_plan.v2';
export const DESTRUCTIVE_PLANNING_SIMULATION_SCHEMA_VERSION = 'destructive.planning_simulation.v1';
export const DESTRUCTIVE_PLANNING_AUDIT_SUMMARY_SCHEMA_VERSION = 'destructive.planning_audit_summary.v1';

export const DESTRUCTIVE_ACTION_CLASSES = Object.freeze([
  'delete',
  'revoke',
  'cancel',
  'modify_irreversible',
  'other',
]);

export const DESTRUCTIVE_PRODUCTION_EXECUTION_DEFAULT = 'blocked';

export const DESTRUCTIVE_PLANNING_SCHEMA_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: 'DestructiveExecutionPlan',
    version: DESTRUCTIVE_EXECUTION_PLAN_SCHEMA_VERSION,
    sourcePath: 'src/domain/destructive-planning/destructive-execution-plan-schema.mjs',
  }),
  Object.freeze({
    name: 'DestructivePlanningSimulation',
    version: DESTRUCTIVE_PLANNING_SIMULATION_SCHEMA_VERSION,
    sourcePath: 'src/domain/destructive-planning/destructive-execution-plan-schema.mjs',
  }),
  Object.freeze({
    name: 'DestructivePlanningAuditSummary',
    version: DESTRUCTIVE_PLANNING_AUDIT_SUMMARY_SCHEMA_VERSION,
    sourcePath: 'src/domain/destructive-planning/destructive-execution-plan-schema.mjs',
  }),
]);

export function listDestructivePlanningSchemaDefinitions() {
  return DESTRUCTIVE_PLANNING_SCHEMA_DEFINITIONS.map((definition) => ({ ...definition }));
}
