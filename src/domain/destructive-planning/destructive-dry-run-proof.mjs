// @ts-check

import { assertDestructiveExecutionPlanValid, assertNoDestructivePlanningRawMaterial } from './destructive-execution-plan-validator.mjs';

export function createDestructiveDryRunProof(plan = {}, {
  proofRef = undefined,
  evidenceRefs = [],
} = {}) {
  const safePlan = assertDestructiveExecutionPlanValid(plan);
  const proof = {
    proofType: 'destructive_dry_run_proof',
    targetRef: safePlan.targetRef,
    proofRef: String(proofRef ?? safePlan.dryRunProofRef ?? '').trim(),
    evidenceRefs: (Array.isArray(evidenceRefs) ? evidenceRefs : [])
      .map((ref) => String(ref ?? '').trim())
      .filter(Boolean),
    proofPresent: Boolean(proofRef ?? safePlan.dryRunProofRef),
    executionAttempted: false,
    sideEffectAttempted: false,
    redactionRequired: true,
  };
  assertNoDestructivePlanningRawMaterial(proof);
  return proof;
}
