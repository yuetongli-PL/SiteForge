// @ts-check

import {
  DESTRUCTIVE_PLANNING_AUDIT_SUMMARY_SCHEMA_VERSION,
} from './destructive-execution-plan-schema.mjs';
import { assertDestructiveExecutionPlanValid, assertNoDestructivePlanningRawMaterial } from './destructive-execution-plan-validator.mjs';

export function createDestructivePlanningAuditSummary(plan = {}, simulation = null) {
  const safePlan = assertDestructiveExecutionPlanValid(plan);
  const summary = {
    schemaVersion: DESTRUCTIVE_PLANNING_AUDIT_SUMMARY_SCHEMA_VERSION,
    summaryType: 'destructive_planning_audit_summary',
    required: true,
    actionClass: safePlan.actionClass,
    targetSafeRef: safePlan.targetSafeRef,
    reason: simulation?.decision?.reasonCode ?? 'runtime.destructive_execution_blocked',
    planningStatus: 'blocked_by_default',
    strongAuth: {
      present: false,
      authzRef: null,
      challengeRef: null,
      confirmationRef: null,
    },
    policyGate: {
      satisfied: false,
      policyId: 'policy:destructive-planning',
    },
    dryRunProof: {
      required: safePlan.requiresDryRunProof,
      proofRef: safePlan.dryRunProofRef,
      present: Boolean(safePlan.dryRunProofRef),
    },
    compensationPlan: {
      required: safePlan.requiresCompensationPlan,
      compensationPlanRef: safePlan.compensationPlanRef,
      present: Boolean(safePlan.compensationPlanRef),
    },
    allowNaturalLanguageAuthorization: false,
    productionExecutionDefault: 'blocked',
    providerInvoked: false,
    sideEffectAttempted: false,
    redactionRequired: true,
  };
  assertNoDestructivePlanningRawMaterial(summary);
  return summary;
}
