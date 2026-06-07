// @ts-check

import {
  assertNoExecutionSensitiveMaterial,
} from '../../../domain/policies/execution/index.mjs';
import {
  viewSummary,
} from './audit-query-sanitizer.mjs';

const COMPARE_FIELDS = Object.freeze([
  'status',
  'reason',
  'providerId',
  'capabilityKind',
  'providerInvoked',
  'executionAttempted',
  'sideEffectAttempted',
  'auth.required',
  'auth.used',
]);

function getPath(value, path) {
  return path.split('.').reduce((current, part) => current?.[part], value);
}

function severityFor(path, before, after) {
  if (path === 'sideEffectAttempted' && before === false && after === true) return 'high';
  if (path === 'status' && before === 'blocked' && after === 'completed') return 'high';
  if (path === 'reason' && /payment|destructive/u.test(String(before ?? after ?? ''))) return 'high';
  if (path === 'providerId') return 'medium';
  if (path.startsWith('auth.')) return 'medium';
  return 'low';
}

function summarizeChange(path, before, after) {
  if (path === 'sideEffectAttempted') return 'side effect behavior changed';
  if (path === 'status') return 'execution outcome changed';
  if (path === 'reason') return 'stable reason changed';
  if (path === 'providerId') return 'provider selection changed';
  if (path.startsWith('auth.')) return 'auth behavior changed';
  return `${path} changed`;
}

export function compareRuntimeAuditViews(beforeView, afterView) {
  const before = viewSummary(beforeView);
  const after = viewSummary(afterView);
  const changes = [];
  for (const path of COMPARE_FIELDS) {
    const beforeValue = getPath(before, path);
    const afterValue = getPath(after, path);
    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue;
    changes.push({
      path: path === 'sideEffectAttempted' ? 'outcome.sideEffectAttempted' : path,
      before: beforeValue ?? null,
      after: afterValue ?? null,
      severity: severityFor(path, beforeValue, afterValue),
      summary: summarizeChange(path, beforeValue, afterValue),
    });
  }
  const riskSummary = changes
    .filter((change) => change.severity === 'high')
    .map((change) => change.summary);
  const result = {
    status: changes.length ? 'changed' : 'same',
    changes,
    riskSummary,
    before,
    after,
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(result);
  return result;
}
