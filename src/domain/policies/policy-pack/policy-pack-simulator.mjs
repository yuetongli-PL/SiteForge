// @ts-check

import {
  POLICY_PACK_DECISION_SCHEMA_VERSION,
  POLICY_PACK_SIMULATION_SCHEMA_VERSION,
} from './policy-pack-schema.mjs';
import {
  assertNoPolicyPackRawMaterial,
  assertPolicyPackValid,
  sanitizePolicySimulationInput,
} from './policy-pack-validator.mjs';
import { explainPolicyDecision } from './policy-pack-decision-explainer.mjs';

function listIncludesAll(candidate = [], expected = []) {
  if (!expected.length) return true;
  const candidateSet = new Set(candidate);
  return expected.every((value) => candidateSet.has(value));
}

function ruleMatches(rule, input) {
  const match = rule.match ?? {};
  if (match.providerId && match.providerId !== input.providerId) return false;
  if (match.capabilityKind && match.capabilityKind !== input.capabilityKind) return false;
  if (match.targetOrigin && match.targetOrigin !== input.targetOrigin) return false;
  if (Array.isArray(match.operations) && match.operations.length > 0 && !match.operations.includes(input.operation)) return false;
  if (match.authRequired !== null && match.authRequired !== input.authRequirement.required) return false;
  if (!listIncludesAll(input.requestedScopes, match.requestedScopes ?? [])) return false;
  if (match.destructive === true && input.destructiveRequirement.required !== true) return false;
  if (match.payment === true && input.paymentRequirement.required !== true) return false;
  return true;
}

function createDecision(policyPack, input, rule, fallbackReason) {
  const allowed = rule?.effect === 'allow';
  const reason = rule?.reason ?? fallbackReason;
  const matchedRules = rule ? [{
    ruleId: rule.id,
    effect: rule.effect,
    reason,
  }] : [];
  const decision = {
    schemaVersion: POLICY_PACK_DECISION_SCHEMA_VERSION,
    decisionId: `policy-decision:${policyPack.policyPackId}:${input.capabilityKind || 'capability'}:${reason}`,
    policyId: policyPack.policyPackId,
    policyVersion: policyPack.version,
    allowed,
    reason,
    matchedRules,
    constraints: rule?.constraints ?? {
      maxGrantTtlMs: 300000,
      requireRelease: true,
      allowProfilePersistence: false,
      allowStorageStatePersistence: false,
      allowCredentialForwarding: false,
    },
    naturalLanguageRequestGrantsExecution: false,
    providerInvoked: false,
    browserInvoked: false,
    vaultAccessed: false,
    networkInvoked: false,
    redactionRequired: true,
  };
  decision.explanation = explainPolicyDecision(decision);
  assertNoPolicyPackRawMaterial(decision);
  return decision;
}

export function simulatePolicyPack(policyPack = {}, input = {}) {
  const safePack = assertPolicyPackValid(policyPack);
  const safeInput = sanitizePolicySimulationInput(input);
  if (safeInput.destructiveRequirement.required === true) {
    return {
      schemaVersion: POLICY_PACK_SIMULATION_SCHEMA_VERSION,
      input: safeInput,
      decision: createDecision(safePack, safeInput, null, 'runtime.destructive_execution_blocked'),
      redactionRequired: true,
    };
  }
  if (safeInput.paymentRequirement.required === true) {
    return {
      schemaVersion: POLICY_PACK_SIMULATION_SCHEMA_VERSION,
      input: safeInput,
      decision: createDecision(safePack, safeInput, null, 'runtime.payment_execution_blocked'),
      redactionRequired: true,
    };
  }
  const matchingRule = safePack.rules.find((rule) => ruleMatches(rule, safeInput));
  const decision = createDecision(safePack, safeInput, matchingRule, 'policy.no_matching_rule');
  const simulation = {
    schemaVersion: POLICY_PACK_SIMULATION_SCHEMA_VERSION,
    input: safeInput,
    decision,
    redactionRequired: true,
  };
  assertNoPolicyPackRawMaterial(simulation);
  return simulation;
}
