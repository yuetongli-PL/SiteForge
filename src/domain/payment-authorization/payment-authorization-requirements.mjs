// @ts-check

import {
  assertNoPaymentAuthorizationRawMaterial,
  assertPaymentAuthorizationPlanValid,
} from './payment-requirement-validator.mjs';

export function createPaymentAuthorizationRequirements(plan = {}) {
  const safePlan = assertPaymentAuthorizationPlanValid(plan);
  const requirements = {
    requirementType: 'payment_authorization_requirements',
    paymentRequired: true,
    capabilityClass: safePlan.capabilityClass,
    amount: safePlan.amount,
    payeeRef: safePlan.payeeRef,
    requiresStrongAuthorization: true,
    requiresOutOfBandApproval: true,
    requiresPolicyGate: safePlan.requiresPolicyGate,
    allowNaturalLanguageAuthorization: false,
    productionExecutionDefault: safePlan.productionExecutionDefault,
    providerInvoked: false,
    sideEffectAttempted: false,
    redactionRequired: true,
  };
  assertNoPaymentAuthorizationRawMaterial(requirements);
  return requirements;
}
