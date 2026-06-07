// @ts-check

import { POLICY_PACK_DIFF_SCHEMA_VERSION } from './policy-pack-schema.mjs';
import { assertPolicyPackValid } from './policy-pack-validator.mjs';

function byRuleId(policyPack) {
  return new Map(policyPack.rules.map((rule) => [rule.id, rule]));
}

function addedValues(previous = [], next = []) {
  const previousSet = new Set(previous);
  return next.filter((value) => !previousSet.has(value));
}

function change(kind, severity, ruleId, details = {}) {
  return { kind, severity, ruleId, details };
}

export function diffPolicyPacks(previousPack = {}, nextPack = {}) {
  const previous = assertPolicyPackValid(previousPack);
  const next = assertPolicyPackValid(nextPack);
  const previousRules = byRuleId(previous);
  const changes = [];
  for (const nextRule of next.rules) {
    const previousRule = previousRules.get(nextRule.id);
    if (!previousRule) {
      changes.push(change('rule_added', nextRule.effect === 'allow' ? 'medium' : 'low', nextRule.id));
      continue;
    }
    if (previousRule.effect === 'deny' && nextRule.effect === 'allow') {
      changes.push(change('rule_effect_deny_to_allow', 'high', nextRule.id));
    }
    const addedScopes = addedValues(previousRule.match.requestedScopes, nextRule.match.requestedScopes);
    if (addedScopes.length > 0) {
      changes.push(change('scope_widened', 'high', nextRule.id, { addedScopes }));
    }
  }
  return {
    schemaVersion: POLICY_PACK_DIFF_SCHEMA_VERSION,
    previousPolicyPackId: previous.policyPackId,
    nextPolicyPackId: next.policyPackId,
    changes,
    highRiskChangeCount: changes.filter((entry) => ['high', 'critical'].includes(entry.severity)).length,
    redactionRequired: true,
  };
}
