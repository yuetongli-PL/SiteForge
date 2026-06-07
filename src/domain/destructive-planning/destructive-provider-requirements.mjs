// @ts-check

import { assertDestructiveExecutionPlanValid, assertNoDestructivePlanningRawMaterial } from './destructive-execution-plan-validator.mjs';

export function createDestructiveProviderRequirements(plan = {}) {
  const safePlan = assertDestructiveExecutionPlanValid(plan);
  const requirements = {
    requirementType: 'destructive_provider_requirements',
    actionClass: safePlan.actionClass,
    providerClassification: 'destructive',
    productionProviderRegistrationAllowed: false,
    requiresStrongAuthorization: true,
    requiresTwoStepConfirmation: safePlan.requiresTwoStepConfirmation,
    requiresTwoPersonAuthorization: safePlan.requiresTwoPersonAuthorization,
    requiresPolicyGate: safePlan.requiresPolicyGate,
    requiresDryRunProof: safePlan.requiresDryRunProof,
    requiresCompensationPlan: safePlan.requiresCompensationPlan,
    providerInvoked: false,
    redactionRequired: true,
  };
  assertNoDestructivePlanningRawMaterial(requirements);
  return requirements;
}
