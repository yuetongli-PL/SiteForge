// @ts-check

import {
  PAYMENT_POLICY_SIMULATION_SCHEMA_VERSION,
} from './payment-authorization-schema.mjs';
import {
  assertNoPaymentAuthorizationRawMaterial,
  assertPaymentAuthorizationPlanValid,
  validatePaymentAuthorizationPlan,
} from './payment-requirement-validator.mjs';

export function simulatePaymentPolicy(plan = {}, {
  taskText = '',
  outOfBandApprovalObserved = false,
} = {}) {
  const validation = validatePaymentAuthorizationPlan(plan);
  const safePlan = validation.ok ? validation.sanitized : assertPaymentAuthorizationPlanValid(plan);
  const simulation = {
    schemaVersion: PAYMENT_POLICY_SIMULATION_SCHEMA_VERSION,
    simulationType: 'payment_policy_simulation',
    planValid: validation.ok,
    findings: validation.findings,
    decision: {
      decisionType: 'payment_policy_decision',
      status: 'blocked',
      allowed: false,
      reasonCode: 'runtime.payment_execution_blocked',
      productionExecutionDefault: 'blocked',
      naturalLanguageRequestGrantsExecution: false,
      outOfBandApprovalGrantsExecution: false,
      taskTextObserved: Boolean(taskText),
      outOfBandApprovalObserved: outOfBandApprovalObserved === true,
    },
    capabilityClass: safePlan.capabilityClass,
    amount: safePlan.amount,
    payeeRef: safePlan.payeeRef,
    providerInvoked: false,
    browserInvoked: false,
    vaultAccessed: false,
    networkInvoked: false,
    sideEffectAttempted: false,
    redactionRequired: true,
  };
  assertNoPaymentAuthorizationRawMaterial(simulation);
  return simulation;
}
