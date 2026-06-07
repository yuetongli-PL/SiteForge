// @ts-check

import {
  assertNoPaymentAuthorizationRawMaterial,
  assertPaymentAuthorizationPlanValid,
} from './payment-requirement-validator.mjs';

export function createPaymentPartyVerificationPlan(plan = {}) {
  const safePlan = assertPaymentAuthorizationPlanValid(plan);
  const verification = {
    verificationType: 'payment_party_amount_currency_verification',
    amount: {
      valueRef: safePlan.amount.valueRef,
      currency: safePlan.amount.currency,
      verified: Boolean(safePlan.amount.valueRef && safePlan.amount.currency),
    },
    payeeRef: safePlan.payeeRef,
    payeeVerified: Boolean(safePlan.payeeRef),
    materialPolicy: 'safe_ref_only',
    providerInvoked: false,
    networkInvoked: false,
    sideEffectAttempted: false,
    redactionRequired: true,
  };
  assertNoPaymentAuthorizationRawMaterial(verification);
  return verification;
}
