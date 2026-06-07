// @ts-check

import {
  assertNoExecutionSensitiveMaterial,
} from '../../../domain/policies/execution/index.mjs';
import {
  summarizeRuntimeAuditViews,
} from './audit-query-stats.mjs';
import {
  viewSummary,
  sanitizeAuditQueryViews,
} from './audit-query-sanitizer.mjs';

export function createRuntimeAuditRegressionSnapshot(views = [], {
  snapshotId = 'runtime-audit-regression:snapshot',
} = {}) {
  const sanitizedViews = sanitizeAuditQueryViews(views);
  const snapshot = {
    snapshotType: 'runtime_audit_regression_snapshot',
    snapshotId,
    viewCount: sanitizedViews.length,
    views: sanitizedViews.map(viewSummary),
    statistics: summarizeRuntimeAuditViews(sanitizedViews),
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(snapshot);
  return snapshot;
}
