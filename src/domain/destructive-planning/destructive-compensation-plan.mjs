// @ts-check

import { assertDestructiveExecutionPlanValid, assertNoDestructivePlanningRawMaterial } from './destructive-execution-plan-validator.mjs';

export function createDestructiveCompensationPlan(plan = {}, {
  compensationPlanRef = undefined,
  rollbackSteps = [],
} = {}) {
  const safePlan = assertDestructiveExecutionPlanValid(plan);
  const compensation = {
    compensationType: 'destructive_compensation_plan',
    targetRef: safePlan.targetRef,
    compensationPlanRef: String(compensationPlanRef ?? safePlan.compensationPlanRef ?? '').trim(),
    rollbackSteps: (Array.isArray(rollbackSteps) ? rollbackSteps : [])
      .map((step) => String(step ?? '').trim().replace(/\s+/gu, '_').toLowerCase())
      .filter(Boolean),
    compensationPresent: Boolean(compensationPlanRef ?? safePlan.compensationPlanRef),
    providerInvoked: false,
    sideEffectAttempted: false,
    redactionRequired: true,
  };
  assertNoDestructivePlanningRawMaterial(compensation);
  return compensation;
}
