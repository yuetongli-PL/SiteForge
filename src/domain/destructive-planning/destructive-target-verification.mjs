// @ts-check

import { assertDestructiveExecutionPlanValid, assertNoDestructivePlanningRawMaterial } from './destructive-execution-plan-validator.mjs';

export function verifyDestructiveTargetRef(plan = {}) {
  const safePlan = assertDestructiveExecutionPlanValid(plan);
  const verification = {
    verificationType: 'destructive_target_ref_verification',
    targetRef: safePlan.targetRef,
    targetVerified: Boolean(safePlan.targetRef),
    materialPolicy: 'safe_ref_only',
    providerInvoked: false,
    sideEffectAttempted: false,
    redactionRequired: true,
  };
  assertNoDestructivePlanningRawMaterial(verification);
  return verification;
}
