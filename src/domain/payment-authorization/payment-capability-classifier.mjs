// @ts-check

import {
  assertNoPaymentAuthorizationRawMaterial,
  sanitizePaymentAuthorizationPlan,
} from './payment-requirement-validator.mjs';

const CLASS_HINTS = Object.freeze([
  Object.freeze({ capabilityClass: 'subscription', pattern: /subscription|recurring|membership/iu }),
  Object.freeze({ capabilityClass: 'funds_transfer', pattern: /transfer|wire|payout|disbursement/iu }),
  Object.freeze({ capabilityClass: 'refund', pattern: /refund|return/iu }),
  Object.freeze({ capabilityClass: 'billing_update', pattern: /billing|invoice|payment-method/iu }),
  Object.freeze({ capabilityClass: 'purchase', pattern: /purchase|checkout|order/iu }),
]);

function text(value) {
  return String(value ?? '').trim().toLowerCase();
}

function classFromText(value, fallback) {
  const haystack = text(value);
  for (const { capabilityClass, pattern } of CLASS_HINTS) {
    if (pattern.test(haystack)) return capabilityClass;
  }
  return fallback;
}

export function classifyPaymentCapability(input = {}) {
  const plan = sanitizePaymentAuthorizationPlan(input);
  const capabilityClass = classFromText(
    `${input.capabilityRef ?? ''} ${input.paymentRequirementRef ?? ''} ${plan.capabilityClass}`,
    plan.capabilityClass,
  );
  const classification = {
    classificationType: 'payment_capability_classification',
    capabilityRef: plan.capabilityRef,
    capabilityClass,
    risk: 'payment',
    riskClassification: {
      level: 'payment',
      payment: true,
      destructive: false,
      sideEffecting: true,
      material: 'descriptor_only',
    },
    policyRequirements: {
      auditRequired: true,
      strongAuthorizationRequired: true,
      outOfBandApprovalRequired: true,
      naturalLanguageRequestGrantsExecution: false,
      material: 'descriptor_only',
    },
    runtimeCallable: false,
    executableByDefault: false,
    productionProviderRegistrationAllowed: false,
    redactionRequired: true,
  };
  assertNoPaymentAuthorizationRawMaterial(classification);
  return classification;
}
