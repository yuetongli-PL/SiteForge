// @ts-check

import {
  RUNTIME_CI_REGRESSION_HARNESS_SCHEMA_VERSION,
} from './runtime-regression-schema.mjs';
import {
  assertNoRuntimeRegressionRawMaterial,
} from './runtime-regression-sanitizer.mjs';
import {
  compareRuntimeRegressionSnapshots,
} from './runtime-regression-compare.mjs';
import {
  createRuntimeRegressionReport,
} from './runtime-regression-report.mjs';

function failedClosedComparison(caseId, error) {
  return {
    schemaVersion: RUNTIME_CI_REGRESSION_HARNESS_SCHEMA_VERSION,
    comparisonType: 'runtime_ci_regression_comparison',
    status: 'failed_closed',
    caseId: String(caseId ?? 'case').replace(/[\s"'`<>\\?&=%#]+/gu, '-').slice(0, 120),
    previousSnapshotId: null,
    nextSnapshotId: null,
    changeCount: 1,
    maxSeverity: 'critical',
    highRiskChangeCount: 1,
    changes: [{
      kind: 'snapshot_invalid',
      path: 'snapshot',
      before: null,
      after: null,
      severity: 'critical',
      summary: error?.code ?? 'runtime_regression.snapshot_invalid',
    }],
    providerInvoked: false,
    browserInvoked: false,
    vaultAccessed: false,
    networkInvoked: false,
    redactionRequired: true,
  };
}

export function runRuntimeRegressionHarness({
  reportId = 'runtime-ci-regression:report',
  cases = [],
} = {}) {
  const comparisons = [];
  for (const entry of Array.isArray(cases) ? cases : []) {
    try {
      const comparison = compareRuntimeRegressionSnapshots(entry.previous, entry.next);
      comparisons.push({
        ...comparison,
        caseId: String(entry.caseId ?? comparison.previousSnapshotId ?? 'case')
          .replace(/[\s"'`<>\\?&=%#]+/gu, '-')
          .slice(0, 120),
      });
    } catch (error) {
      comparisons.push(failedClosedComparison(entry.caseId, error));
    }
  }
  const report = createRuntimeRegressionReport({ reportId, comparisons });
  assertNoRuntimeRegressionRawMaterial(report);
  return report;
}
