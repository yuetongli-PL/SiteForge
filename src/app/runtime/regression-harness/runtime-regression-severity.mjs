// @ts-check

import {
  RUNTIME_CI_REGRESSION_SEVERITIES,
} from './runtime-regression-schema.mjs';

const SEVERITY_RANK = Object.freeze({
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
});

export function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? 0;
}

export function maxRuntimeRegressionSeverity(values = []) {
  return values.reduce((current, value) => (
    severityRank(value) > severityRank(current) ? value : current
  ), 'none');
}

export function classifyRuntimeRegressionSeverity(change = {}) {
  const kind = String(change.kind ?? '');
  if (kind === 'payment_provider_invoked' || kind === 'destructive_provider_invoked') return 'critical';
  if (
    kind === 'blocked_to_completed'
    || kind === 'side_effect_introduced'
    || kind === 'auth_scope_widened'
    || kind === 'auth_requirement_removed'
    || kind === 'allowed_origins_widened'
    || kind === 'browser_guard_removed'
    || kind === 'material_type_widened'
    || kind === 'policy_denied_to_allowed'
    || kind === 'contract_concreteness_decreased'
    || kind === 'protected_reason_changed'
  ) {
    return 'high';
  }
  if (kind === 'provider_changed' || kind === 'reason_changed') return 'medium';
  if (kind === 'metadata_changed') return 'low';
  return RUNTIME_CI_REGRESSION_SEVERITIES.includes(change.severity) ? change.severity : 'low';
}
