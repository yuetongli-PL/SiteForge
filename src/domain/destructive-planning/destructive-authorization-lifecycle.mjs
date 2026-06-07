// @ts-check

import { assertDestructiveExecutionPlanValid, assertNoDestructivePlanningRawMaterial } from './destructive-execution-plan-validator.mjs';

export function createDestructiveAuthorizationLifecycle(plan = {}) {
  const safePlan = assertDestructiveExecutionPlanValid(plan);
  const lifecycle = {
    lifecycleType: 'destructive_authorization_lifecycle',
    targetRef: safePlan.targetRef,
    steps: [
      'target_ref_verified',
      'dry_run_proof_reviewed',
      'policy_gate_checked',
      'challenge_issued',
      'strong_confirmation_collected_out_of_band',
      'compensation_plan_reviewed',
      'final_human_review_required',
    ],
    requiresTwoStepConfirmation: safePlan.requiresTwoStepConfirmation,
    requiresTwoPersonAuthorization: safePlan.requiresTwoPersonAuthorization,
    allowNaturalLanguageAuthorization: false,
    productionExecutionDefault: safePlan.productionExecutionDefault,
    providerInvoked: false,
    sideEffectAttempted: false,
    redactionRequired: true,
  };
  assertNoDestructivePlanningRawMaterial(lifecycle);
  return lifecycle;
}
