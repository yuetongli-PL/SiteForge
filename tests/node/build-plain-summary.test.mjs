import test from 'node:test';
import assert from 'node:assert/strict';

import { renderSiteForgePlainBuildSummary } from '../../src/app/pipeline/build/build-plain-summary.mjs';

test('plain build summary renders user-facing counts, reports, and sanitized URL', () => {
  const output = renderSiteForgePlainBuildSummary({
    status: 'success',
    inputUrl: 'https://example.test/shop?access_token=SECRET',
    skillId: 'skill-shop',
    artifacts: {
      'siteforge_user_report.json': 'artifacts/siteforge_user_report.json',
      'capability_intent_summary.html': 'reports/capability_intent_summary.html',
      'page_reconciliation_report.json': 'reports/page_reconciliation_report.json',
      'robots_remediation_plan.json': 'reports/robots_remediation_plan.json',
      'access_remediation_plan.json': 'reports/access_remediation_plan.json',
    },
    user_report: {
      result_status: 'partial_success',
      capability_summary: {
        active: 2,
        enabled_status: { limited_enabled: 1 },
        candidate: 3,
        disabled: 4,
      },
      coverage: {
        public: { pages: 5 },
        authenticated: { pages: 6 },
        overlay: { pagesRevisited: 7 },
      },
      build_completion: {
        verification_status: 'passed',
        registry_registered: true,
      },
      pageReconciliation: {
        status: 'warning',
        reasonCodes: ['dynamic-unsupported', 'network-fetch-failed', 'extra-a', 'extra-b', 'extra-c'],
      },
    },
  });

  assert.match(output, /SiteForge build: partial_success/u);
  assert.match(output, /URL: https:\/\/example\.test/u);
  assert.doesNotMatch(output, /SECRET/u);
  assert.match(output, /Skill: skill-shop/u);
  assert.match(output, /Capabilities: active 2 \/ limited 1 \/ candidate 3 \/ disabled 4/u);
  assert.match(output, /Coverage: public 5 pages \/ authenticated 6 pages \/ overlay 7 pages/u);
  assert.match(output, /Verification: passed/u);
  assert.match(output, /Registry: registered/u);
  assert.match(output, /Page reconciliation: warning \(dynamic-unsupported,network-fetch-failed,extra-a,extra-b\)/u);
  assert.match(output, /Page reconciliation report: .*page_reconciliation_report\.json/u);
  assert.match(output, /Robots remediation plan: .*robots_remediation_plan\.json/u);
  assert.match(output, /Access remediation plan: .*access_remediation_plan\.json/u);
  assert.match(output, /HTML report: .*capability_intent_summary\.html/u);
});

test('plain build summary falls back to report paths and zero counts', () => {
  const output = renderSiteForgePlainBuildSummary({
    status: 'failed',
    userReport: {
      result_status: 'failed',
      build_completion: {
        report_path: 'reports/user.json',
        registry_registered: false,
      },
    },
  });

  assert.match(output, /SiteForge build: failed/u);
  assert.match(output, /URL: -/u);
  assert.match(output, /Capabilities: active 0 \/ limited 0 \/ candidate 0 \/ disabled 0/u);
  assert.match(output, /Coverage: public 0 pages \/ authenticated 0 pages \/ overlay 0 pages/u);
  assert.match(output, /Report: .*user\.json/u);
});
