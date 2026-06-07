// @ts-check

import { POLICY_PACK_REGRESSION_SCHEMA_VERSION } from './policy-pack-schema.mjs';
import { simulatePolicyPack } from './policy-pack-simulator.mjs';

export function createPolicyRegressionSnapshot(policyPack = {}, cases = []) {
  return {
    schemaVersion: POLICY_PACK_REGRESSION_SCHEMA_VERSION,
    policyPackId: policyPack.policyPackId,
    caseCount: Array.isArray(cases) ? cases.length : 0,
    results: (Array.isArray(cases) ? cases : []).map((entry) => {
      const simulation = simulatePolicyPack(policyPack, entry.input);
      return {
        caseId: String(entry.caseId ?? 'case'),
        allowed: simulation.decision.allowed,
        reason: simulation.decision.reason,
        decisionId: simulation.decision.decisionId,
      };
    }),
    redactionRequired: true,
  };
}
