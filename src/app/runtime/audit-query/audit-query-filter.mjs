// @ts-check

import {
  assertNoExecutionSensitiveMaterial,
} from '../../../domain/policies/execution/index.mjs';
import {
  normalizeQueryFilter,
  sanitizeAuditQueryViews,
  viewSummary,
} from './audit-query-sanitizer.mjs';

function matches(summary, filter) {
  if (filter.providerId && summary.providerId !== filter.providerId) return false;
  if (filter.capabilityKind && summary.capabilityKind !== filter.capabilityKind) return false;
  if (filter.reason && summary.reason !== filter.reason) return false;
  if (filter.status && summary.status !== filter.status) return false;
  if (filter.sideEffectAttempted !== null && summary.sideEffectAttempted !== filter.sideEffectAttempted) return false;
  if (filter.authUsed !== null && summary.auth?.used !== filter.authUsed) return false;
  if (filter.authRequired !== null && summary.auth?.required !== filter.authRequired) return false;
  if (filter.materialType && !summary.auth?.materialTypes?.includes(filter.materialType)) return false;
  if (filter.targetOrigin && !summary.targetOrigins?.includes(filter.targetOrigin)) return false;
  if (filter.unsafeInputDetected !== null && summary.unsafeInputDetected !== filter.unsafeInputDetected) return false;
  return true;
}

export function queryRuntimeAuditViews(views = [], filter = {}) {
  const normalizedFilter = normalizeQueryFilter(filter);
  const rows = sanitizeAuditQueryViews(views)
    .map((view) => ({ view, summary: viewSummary(view) }))
    .filter(({ summary }) => matches(summary, normalizedFilter));
  const result = {
    queryType: 'runtime_audit_view_query',
    filter: normalizedFilter,
    count: rows.length,
    results: rows.map(({ summary }) => summary),
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(result);
  return result;
}
