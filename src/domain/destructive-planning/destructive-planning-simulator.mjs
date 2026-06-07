// @ts-check

import {
  DESTRUCTIVE_PLANNING_SIMULATION_SCHEMA_VERSION,
} from './destructive-execution-plan-schema.mjs';
import {
  assertDestructiveExecutionPlanValid,
  assertNoDestructivePlanningRawMaterial,
  validateDestructiveExecutionPlan,
} from './destructive-execution-plan-validator.mjs';

export function simulateDestructiveExecutionPlan(plan = {}, {
  taskText = '',
  confirmDestructive = false,
} = {}) {
  const validation = validateDestructiveExecutionPlan(plan);
  const safePlan = validation.ok ? validation.sanitized : assertDestructiveExecutionPlanValid(plan);
  const simulation = {
    schemaVersion: DESTRUCTIVE_PLANNING_SIMULATION_SCHEMA_VERSION,
    simulationType: 'destructive_planning_simulation',
    planValid: validation.ok,
    findings: validation.findings,
    decision: {
      decisionType: 'destructive_planning_decision',
      status: 'blocked',
      allowed: false,
      reasonCode: 'runtime.destructive_execution_blocked',
      productionExecutionDefault: 'blocked',
      naturalLanguageRequestGrantsExecution: false,
      confirmDestructiveGrantsExecution: false,
      taskTextObserved: Boolean(taskText),
      confirmDestructiveObserved: confirmDestructive === true,
    },
    targetRef: safePlan.targetRef,
    actionClass: safePlan.actionClass,
    providerInvoked: false,
    browserInvoked: false,
    vaultAccessed: false,
    networkInvoked: false,
    sideEffectAttempted: false,
    redactionRequired: true,
  };
  assertNoDestructivePlanningRawMaterial(simulation);
  return simulation;
}
