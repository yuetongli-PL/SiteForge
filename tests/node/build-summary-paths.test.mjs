import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCESS_REMEDIATION_PLAN_FILE,
  PAGE_RECONCILIATION_REPORT_FILE,
  ROBOTS_REMEDIATION_PLAN_FILE,
  accessRemediationResultPath,
  capabilityIntentHtmlResultPath,
  pageReconciliationResultPath,
  robotsRemediationResultPath,
} from '../../src/app/pipeline/build/build-summary-paths.mjs';

test('build summary report path helpers preserve artifact precedence', () => {
  assert.equal(PAGE_RECONCILIATION_REPORT_FILE, 'page_reconciliation_report.json');
  assert.equal(ACCESS_REMEDIATION_PLAN_FILE, 'access_remediation_plan.json');
  assert.equal(ROBOTS_REMEDIATION_PLAN_FILE, 'robots_remediation_plan.json');

  assert.equal(capabilityIntentHtmlResultPath({
    artifacts: { 'capability_intent_summary.html': 'reports/artifact.html' },
    reports: { capability_intent_summary_html: 'reports/fallback.html' },
  }), 'reports/artifact.html');

  assert.equal(pageReconciliationResultPath({
    user_report: { reports: { page_reconciliation_report: 'reports/user-page.json' } },
  }), 'reports/user-page.json');

  assert.equal(robotsRemediationResultPath({
    reports: { robots_remediation_plan: 'reports/robots.json' },
  }), 'reports/robots.json');

  assert.equal(accessRemediationResultPath({
    userReport: { reports: { access_remediation_plan: 'reports/access.json' } },
  }), 'reports/access.json');
});

test('build summary report path helpers return null when no report is present', () => {
  assert.equal(capabilityIntentHtmlResultPath({}), null);
  assert.equal(pageReconciliationResultPath({}), null);
  assert.equal(robotsRemediationResultPath({}), null);
  assert.equal(accessRemediationResultPath({}), null);
});
