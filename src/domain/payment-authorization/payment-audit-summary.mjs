// @ts-check

import {
  PAYMENT_AUDIT_PLANNING_SUMMARY_SCHEMA_VERSION,
} from './payment-authorization-schema.mjs';
import {
  assertNoPaymentAuthorizationRawMaterial,
  assertPaymentAuthorizationPlanValid,
} from './payment-requirement-validator.mjs';

export function createPaymentAuditPlanningSummary(plan = {}, simulation = null) {
  const safePlan = assertPaymentAuthorizationPlanValid(plan);
  const summary = {
    schemaVersion: PAYMENT_AUDIT_PLANNING_SUMMARY_SCHEMA_VERSION,
    summaryType: 'payment_audit_planning_summary',
    required: true,
    capabilityClass: safePlan.capabilityClass,
    amount: safePlan.amount,
    payeeRef: safePlan.payeeRef,
    reason: simulation?.decision?.reasonCode ?? 'runtime.payment_execution_blocked',
    planningStatus: 'blocked_by_default',
    authorizationRequirement: {
      strongAuthorizationRequired: true,
      authorizationPolicyRef: safePlan.authorizationPolicyRef,
      naturalLanguageRequestGrantsExecution: false,
    },
    outOfBandApproval: {
      required: true,
      approvalRef: safePlan.approvalRef,
      observed: simulation?.decision?.outOfBandApprovalObserved === true,
      grantsExecution: false,
    },
    policyGate: {
      required: safePlan.requiresPolicyGate,
      satisfied: false,
      policyId: safePlan.authorizationPolicyRef || 'policy:payment-authorization',
    },
    productionExecutionDefault: 'blocked',
    providerInvoked: false,
    sideEffectAttempted: false,
    redactionRequired: true,
  };
  assertNoPaymentAuthorizationRawMaterial(summary);
  return summary;
}
