// @ts-check

import {
  RUNTIME_CI_REGRESSION_REPORT_SCHEMA_VERSION,
} from './runtime-regression-schema.mjs';
import {
  assertNoRuntimeRegressionRawMaterial,
} from './runtime-regression-sanitizer.mjs';
import {
  maxRuntimeRegressionSeverity,
} from './runtime-regression-severity.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createRuntimeRegressionReport({
  reportId = 'runtime-ci-regression:report',
  comparisons = [],
} = {}) {
  const safeComparisons = Array.isArray(comparisons) ? comparisons : [];
  const maxSeverity = maxRuntimeRegressionSeverity(safeComparisons.map((comparison) => comparison.maxSeverity));
  const highRiskChangeCount = safeComparisons.reduce((total, comparison) => (
    total + Number(comparison.highRiskChangeCount ?? 0)
  ), 0);
  const failedClosedCount = safeComparisons.filter((comparison) => comparison.status === 'failed_closed').length;
  const report = {
    schemaVersion: RUNTIME_CI_REGRESSION_REPORT_SCHEMA_VERSION,
    reportType: 'runtime_ci_regression_report',
    reportId: String(reportId ?? 'runtime-ci-regression:report')
      .trim()
      .replace(/[\s"'`<>\\?&=%#]+/gu, '-')
      .slice(0, 160),
    status: failedClosedCount > 0
      ? 'failed_closed'
      : highRiskChangeCount > 0
        ? 'failed'
        : safeComparisons.some((comparison) => comparison.status === 'changed')
          ? 'changed'
          : 'passed',
    comparisonCount: safeComparisons.length,
    failedClosedCount,
    highRiskChangeCount,
    maxSeverity,
    comparisons: safeComparisons,
    providerInvoked: false,
    browserInvoked: false,
    vaultAccessed: false,
    networkInvoked: false,
    redactionRequired: true,
  };
  assertNoRuntimeRegressionRawMaterial(report);
  return clone(report);
}
