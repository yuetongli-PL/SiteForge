// @ts-check

import {
  assertNoExecutionSensitiveMaterial,
} from '../../../domain/policies/execution/index.mjs';
import {
  sanitizeAuditQueryViews,
  viewSummary,
} from './audit-query-sanitizer.mjs';

function increment(map, key) {
  const normalized = key || 'unknown';
  map[normalized] = (map[normalized] ?? 0) + 1;
}

function mapToRows(map, keyName = 'key') {
  return Object.entries(map)
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([key, count]) => ({
      [keyName]: key,
      count,
    }));
}

export function summarizeRuntimeAuditViews(views = []) {
  const summaries = sanitizeAuditQueryViews(views).map(viewSummary);
  const byStatus = {};
  const byReason = {};
  const byProvider = {};
  const byMaterialType = {};
  let sideEffectAttemptedCount = 0;
  let authUsedCount = 0;
  let unsafeInputDetectedCount = 0;
  for (const summary of summaries) {
    increment(byStatus, summary.status);
    increment(byReason, summary.reason);
    increment(byProvider, summary.providerId);
    if (summary.sideEffectAttempted) sideEffectAttemptedCount += 1;
    if (summary.auth?.used) authUsedCount += 1;
    if (summary.unsafeInputDetected) unsafeInputDetectedCount += 1;
    for (const type of summary.auth?.materialTypes ?? []) {
      increment(byMaterialType, type);
    }
  }
  const result = {
    summaryType: 'runtime_audit_view_statistics',
    count: summaries.length,
    byStatus,
    byReason,
    byProvider,
    materialTypeCounts: mapToRows(byMaterialType, 'type'),
    sideEffectAttemptedCount,
    authUsedCount,
    unsafeInputDetectedCount,
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(result);
  return result;
}
