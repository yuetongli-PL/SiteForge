// @ts-check

export function explainPolicyDecision(decision = {}) {
  const matchedRuleIds = (decision.matchedRules ?? []).map((rule) => rule.ruleId).filter(Boolean);
  return {
    decisionId: decision.decisionId,
    policyId: decision.policyId,
    allowed: decision.allowed === true,
    reason: decision.reason,
    matchedRuleIds,
    summary: decision.allowed === true
      ? 'Policy simulation allowed the structured metadata request.'
      : `Policy simulation denied the structured metadata request: ${decision.reason}`,
    redactionRequired: true,
  };
}
