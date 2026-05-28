import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SITEFORGE_CAPABILITY_INTENT_SUMMARY_HTML_FILE as CAPABILITY_INTENT_SUMMARY_HTML_FILE,
  SITEFORGE_DEBUG_REPORT_FILE as DEBUG_REPORT_FILE,
  SITEFORGE_DEBUG_REPORT_JSON_ALIAS as DEBUG_REPORT_JSON_ALIAS,
  SITEFORGE_INDEX_REPORT_FILE as INDEX_REPORT_FILE,
  SITEFORGE_USER_REPORT_FILE as USER_REPORT_FILE,
  SITEFORGE_USER_REPORT_JSON_ALIAS as USER_REPORT_JSON_ALIAS,
  SITEFORGE_USER_REPORT_MARKDOWN_ALIAS as USER_REPORT_MARKDOWN_ALIAS,
  SITEFORGE_USER_REPORT_MARKDOWN_FILE as USER_REPORT_MARKDOWN_FILE,
} from '../../src/app/pipeline/build/artifact-contract.mjs';
import { ACCESS_REMEDIATION_PLAN_FILE } from '../../src/app/pipeline/build/build-summary-paths.mjs';
import {
  AUTHORIZED_SOURCE_MANIFEST_FILE,
  AUTHORIZED_SOURCE_MANIFEST_RELATIVE_PATH,
  CAPABILITY_INTENT_SUMMARY_HTML_RELATIVE_PATH,
  RAW_PAGE_MATERIAL_MANIFEST_FILE,
  RAW_PAGE_MATERIAL_MANIFEST_RELATIVE_PATH,
  buildDebugReport,
  buildReportIndex,
  buildRouteStateGraph,
  sanitizedNetworkSummary,
  summarizeStageRecords,
} from '../../src/app/pipeline/build/build-debug-report.mjs';

test('build debug report summarizes stage records without leaking extra fields', () => {
  assert.deepEqual(summarizeStageRecords({
    crawlStatic: {
      status: 'failed',
      reasonCode: 'robots-disallowed',
      reasonCodes: ['robots-disallowed'],
      warnings: ['robots-disallowed'],
      errors: ['blocked'],
      summary: { pages: 0 },
      raw: 'not included',
    },
  }), {
    crawlStatic: {
      status: 'failed',
      reasonCode: 'robots-disallowed',
      reasonCodes: ['robots-disallowed'],
      warnings: ['robots-disallowed'],
      errors: ['blocked'],
      summary: { pages: 0 },
    },
  });
});

test('build debug report network summary merges capture, replay, and source diagnostics', () => {
  const summary = sanitizedNetworkSummary(
    {
      policy: { captureNetwork: true },
      options: {},
      setupProfile: {
        sourceDiagnostics: [
          { statusCode: 403, sourcePath: 'https://blocked.example/path' },
          { statusCode: 200, sourcePath: 'https://ok.example/' },
          { statusCode: 200, sourcePath: 'not-a-url' },
        ],
      },
    },
    {
      captureNetworkTraces: {
        summary: {
          sanitizedSummary: {
            rawTracesPersisted: false,
            savedSummaryOnly: true,
            rawArtifactPath: 'reports/raw_network.json',
            rawTraceCount: 4,
            rawTruncatedBodyCount: 1,
            apiCandidateCount: 2,
            apiCandidateArtifacts: ['api_candidates.json'],
          },
        },
      },
      apiAdapterReplay: {
        summary: {
          adapterDecisionCount: 3,
          adapterAcceptedCount: 2,
          replayVerifiedCount: 1,
          activatedApiAdapterCount: 1,
          skippedReasonCounts: { unsafe: 1 },
          catalogPromotionGateCount: 2,
          catalogPromotionReadyCount: 1,
          catalogPromotionBlockedReasonCounts: { schema: 1 },
        },
      },
    },
  );

  assert.equal(summary.requested, true);
  assert.equal(summary.raw_traces_persisted, false);
  assert.equal(summary.raw_trace_count, 4);
  assert.equal(summary.api_candidate_count, 2);
  assert.equal(summary.adapter_validation_count, 3);
  assert.equal(summary.replay_verified_count, 1);
  assert.deepEqual(summary.adapter_skipped_reason_counts, { unsafe: 1 });
  assert.equal(summary.source_diagnostic_count, 3);
  assert.deepEqual(summary.observed_status_codes, ['200', '403']);
  assert.deepEqual(summary.observed_hosts, ['blocked.example', 'ok.example']);
});

test('build debug report route state graph keeps route-only public fields', () => {
  assert.deepEqual(buildRouteStateGraph({
    classifyNodes: {
      graph: {
        nodes: [{
          id: 'node-1',
          type: 'page',
          routePattern: '/products/:id',
          routeTemplate: '/products/123',
          tabState: 'detail',
          pageType: 'product',
          classification: 'detail',
          authRequired: true,
          childNodeIds: ['child-1'],
          rawHtml: '<html>secret</html>',
        }],
      },
    },
  }), {
    routes: [{
      id: 'node-1',
      type: 'page',
      routePattern: '/products/:id',
      routeTemplate: '/products/123',
      tabState: 'detail',
      pageType: 'product',
      classification: 'detail',
      authRequired: true,
      childNodeIds: ['child-1'],
    }],
  });
});

test('build debug report and report index preserve sanitized report contracts', () => {
  const context = {
    buildId: 'build-1',
    artifactDir: 'C:\\repo\\SiteForge\\siteforge-sites\\example.test\\builds\\build-1',
    site: { id: 'example-test' },
    options: { reportMode: 'debug', privacyMode: 'strict' },
    policy: {},
    setupProfile: {},
    crawlContract: { crawlMode: 'public_only' },
    authStateReport: { authMethod: 'none' },
    siteAdapterProfile: { id: 'adapter-1' },
  };
  const stageResults = {
    discoverSeeds: { seeds: [{ id: 'seed-1' }] },
    classifyNodes: { graph: { nodes: [{ id: 'node-1', type: 'page', sourceLayer: 'public' }] } },
    extractAffordances: { affordances: [{ id: 'action-1' }] },
    discoverCapabilities: { capabilities: [{ id: 'cap-1', name: 'Read homepage', status: 'active', enabled_status: 'enabled' }] },
    generateIntents: { intents: [{ id: 'intent-1', capabilityId: 'cap-1' }] },
    verifySkill: { verificationReport: { status: 'passed' } },
    registerSkill: { registryReport: { status: 'registered' } },
  };
  const report = {
    status: 'success',
    buildId: 'build-1',
    siteId: 'example-test',
    skillId: 'skill-1',
    artifacts: {
      [USER_REPORT_FILE]: 'reports/user_report.json',
      [USER_REPORT_MARKDOWN_FILE]: 'reports/user_report.md',
      [USER_REPORT_JSON_ALIAS]: 'user.json',
      [USER_REPORT_MARKDOWN_ALIAS]: 'user.md',
      [DEBUG_REPORT_FILE]: 'reports/debug_report.json',
      [DEBUG_REPORT_JSON_ALIAS]: 'debug.json',
      [INDEX_REPORT_FILE]: 'build_report.json',
      [CAPABILITY_INTENT_SUMMARY_HTML_FILE]: 'reports/capability_intent_summary.html',
      [RAW_PAGE_MATERIAL_MANIFEST_FILE]: 'reports/raw_page_material_manifest.json',
      [AUTHORIZED_SOURCE_MANIFEST_FILE]: 'reports/authorized_source_manifest.json',
      [ACCESS_REMEDIATION_PLAN_FILE]: 'reports/access_remediation_plan.json',
    },
    warningCodes: ['network-summary-only'],
    warnings: ['Network summary requested; raw network traces were not captured or persisted.'],
    setupCollectionReview: { missingRecordCount: 0 },
    collectionOutcomes: { unsuccessful: [] },
  };
  const userReport = {
    result_status: 'success',
    skill_id: 'skill-1',
    build_id: 'build-1',
    site: { id: 'example-test' },
    privacy_summary: { mode: 'strict' },
  };

  const debugReport = buildDebugReport(context, stageResults, {
    crawlStatic: { status: 'success', reasonCodes: [], warnings: [], errors: [], summary: { pages: 1 } },
  }, report, userReport, {
    siteAdapter: { id: 'adapter-1', source: 'generated' },
  });

  assert.equal(debugReport.artifactFamily, 'siteforge-build-debug-report');
  assert.deepEqual(debugReport.site_adapter, { id: 'adapter-1', source: 'generated' });
  assert.equal(debugReport.test_metadata.stage_count, 1);
  assert.equal(debugReport.test_metadata.report_mode, 'debug');
  assert.equal(debugReport.seeds.length, 1);
  assert.equal(debugReport.nodes.length, 1);
  assert.equal(debugReport.capabilities.length, 1);
  assert.equal(debugReport.route_state_graph.routes.length, 1);

  const index = buildReportIndex(report, userReport, debugReport);
  assert.equal(index.artifactFamily, 'siteforge-build-report-index');
  assert.equal(index.reports.user.json, 'reports/user_report.json');
  assert.equal(index.reports.debug.alias_json, 'debug.json');
  assert.equal(index.report_index.capability_intent_summary_html, CAPABILITY_INTENT_SUMMARY_HTML_RELATIVE_PATH);
  assert.equal(index.report_index.raw_page_material_manifest, RAW_PAGE_MATERIAL_MANIFEST_RELATIVE_PATH);
  assert.equal(index.report_index.authorized_source_manifest, AUTHORIZED_SOURCE_MANIFEST_RELATIVE_PATH);
  assert.deepEqual(index.report_index.available_reports, [
    'user',
    'debug',
    'capability_intent_summary_html',
    'page_reconciliation_report',
    'raw_page_material_manifest',
    'authorized_source_manifest',
    'access_remediation_plan',
  ]);
  assert.deepEqual(index.debug_report_summary, {
    result_status: 'success',
    seed_count: 1,
    node_count: 1,
    action_count: 1,
    capability_count: 1,
    intent_count: 1,
    sanitization_report: { redaction_required: true, status: 'pending' },
  });
});
