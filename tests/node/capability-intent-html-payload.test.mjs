import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  SITEFORGE_CAPABILITY_INTENT_SUMMARY_HTML_FILE as CAPABILITY_INTENT_SUMMARY_HTML_FILE,
  SITEFORGE_DEBUG_REPORT_FILE as DEBUG_REPORT_FILE,
  SITEFORGE_INDEX_REPORT_FILE as INDEX_REPORT_FILE,
  SITEFORGE_USER_REPORT_FILE as USER_REPORT_FILE,
  SITEFORGE_USER_REPORT_MARKDOWN_FILE as USER_REPORT_MARKDOWN_FILE,
} from '../../src/app/pipeline/build/artifact-contract.mjs';
import {
  buildCapabilityIntentHtmlPayload,
  buildElementCoverageAuditRows,
  capabilityHtmlGroup,
  capabilityHtmlReason,
  capabilityHtmlStrategy,
  capabilitySourceNodesForHtml,
  categoryInstancesForHtml,
  elementCoverageAuditSummary,
  htmlCategoryInstanceLabel,
  intentCallableLabel,
  routeTemplatesForHtml,
} from '../../src/app/pipeline/build/capability-intent-html-payload.mjs';

test('capability intent HTML payload helpers classify capability rows for display', () => {
  assert.equal(capabilityHtmlGroup({ status: 'active', enabled_status: 'enabled' }), 'enabled');
  assert.equal(capabilityHtmlGroup({ status: 'candidate', enabled_status: 'enabled' }), 'candidate');
  assert.equal(capabilityHtmlGroup({ status: 'active', enabled_status: 'draft_only' }), 'draft_only');
  assert.equal(capabilityHtmlReason({ activationBlockedReason: 'missing_auth_evidence' }), 'This capability needs authenticated structural evidence; this build did not satisfy the required auth evidence, so it remains a candidate.');
  assert.equal(capabilityHtmlReason({ authRequired: true }), 'This capability may only return sanitized structural summaries; body text and account material are not saved.');
  assert.equal(capabilityHtmlStrategy({ user_strategy: 'custom strategy', default_policy: 'disabled' }), 'custom strategy');
  assert.equal(intentCallableLabel({ callable: false }, { status: 'active' }), 'non-callable');
  assert.equal(intentCallableLabel({ callable: true }, { status: 'active' }), 'callable');
});

test('capability intent HTML payload helpers resolve source nodes, routes, and category labels', () => {
  const graphNodeById = new Map([
    ['node-b', { id: 'node-b', routeTemplate: '/b', categoryInstance: { kind: 'category', label: 'B', routeTemplate: '/b' } }],
    ['node-a', { id: 'node-a', instanceRouteTemplate: '/a', categoryInstance: { kind: 'category', label: 'A', routeTemplate: '/a', evidenceStatus: 'present' } }],
  ]);
  const capability = {
    entryNodeIds: ['node-b', 'node-a', 'node-a'],
    requiredNodeIds: ['node-b'],
    routeTemplate: '/root',
    executionPlan: { steps: [{ routeTemplate: '/step' }, { routePath: '/path' }] },
    categoryInstance: { kind: 'category', label: 'A', routeTemplate: '/a', sourceLayer: 'public' },
  };
  const sourceNodes = capabilitySourceNodesForHtml(capability, graphNodeById);

  assert.deepEqual(sourceNodes.map((node) => node.id), ['node-a', 'node-b']);
  assert.deepEqual(routeTemplatesForHtml(capability, sourceNodes), ['/a', '/b', '/path', '/root', '/step']);
  assert.deepEqual(categoryInstancesForHtml(capability, sourceNodes), [
    { kind: 'category', label: 'A', routeTemplate: '/a', sourceLayer: 'public', evidenceStatus: null },
    { kind: 'category', label: 'B', routeTemplate: '/b', sourceLayer: null, evidenceStatus: null },
  ]);
  assert.equal(htmlCategoryInstanceLabel({ kind: 'category', label: 'A', routeTemplate: '/a' }), 'category: A (/a)');
});

test('capability intent HTML payload builds element coverage rows and summary', () => {
  const rows = buildElementCoverageAuditRows({
    nodes: [
      { id: 'node-covered', type: 'component', sourceLayer: 'public', evidenceStatus: 'element_instance_summary_present', elementRole: 'link', elementLabel: 'Covered', routeTemplate: '/covered' },
      { id: 'node-missing-intent', type: 'operation', sourceLayer: 'authenticated', authRequired: true, evidenceStatus: 'element_instance_summary_present', elementRole: 'button', elementLabel: 'No intent', routeTemplate: '/missing-intent' },
      { id: 'node-missing-cap', type: 'component', sourceLayer: 'public_rendered', evidenceStatus: 'element_instance_summary_present', elementRole: 'card', elementLabel: 'No cap', routeTemplate: '/missing-cap' },
      { id: 'node-ignored', type: 'page', sourceLayer: 'public', evidenceStatus: 'element_instance_summary_present' },
    ],
  }, [
    { id: 'cap-covered', name: 'Covered cap', sourceNodeIds: ['node-covered'] },
    { id: 'cap-no-intent', name: 'No intent cap', sourceNodeIds: ['node-missing-intent'] },
  ], [
    { id: 'intent-covered', capabilityId: 'cap-covered', sourceNodeId: 'node-covered' },
  ]);

  assert.deepEqual(rows.map((row) => [row.nodeId, row.status]), [
    ['node-missing-intent', 'missing_intent'],
    ['node-covered', 'covered'],
    ['node-missing-cap', 'missing_capability'],
  ]);
  assert.deepEqual(elementCoverageAuditSummary(rows), {
    total: 3,
    covered: 1,
    graphIntentOnly: 0,
    missingCapability: 1,
    missingIntent: 1,
  });
});

test('capability intent HTML payload assembles sanitized rows, mappings, counts, and paths', () => {
  const cwd = 'C:\\repo\\SiteForge';
  const artifactDir = path.join(cwd, 'siteforge-sites', 'example.test', 'builds', 'build-1');
  const htmlPath = path.join(artifactDir, 'reports', 'capability_intent_summary.html');
  const payload = buildCapabilityIntentHtmlPayload(
    {
      cwd,
      artifactDir,
      buildId: 'build-1',
      skillId: 'skill-1',
      site: { id: 'example-test', rootUrl: 'https://example.test/?token=secret' },
      crawlContract: { crawlMode: 'mixed', authMethod: 'browser' },
      authStateReport: { authVerificationStatus: 'browser_verified' },
    },
    {
      classifyNodes: {
        graph: {
          nodes: [
            { id: 'page-1', type: 'page', sourceLayer: 'public', title: 'Home' },
            { id: 'node-1', type: 'component', sourceLayer: 'public', evidenceStatus: 'element_instance_summary_present', elementRole: 'link', elementLabel: 'Profile', routeTemplate: '/profile' },
          ],
        },
      },
      discoverCapabilities: {
        capabilities: [{
          id: 'cap-1',
          name: 'Read profile <script>',
          userValue: 'alice@example.test',
          status: 'active',
          enabled_status: 'enabled',
          risk_level: 'read_public_low',
          action: 'view',
          object: 'profile',
          entryNodeIds: ['node-1'],
          evidenceMatrix: {
            requiredEvidence: ['dom_summary'],
            observedEvidence: ['dom_summary'],
            missingEvidence: [],
            activationDecision: 'enabled',
          },
          executionPlan: {
            steps: [{ routeTemplate: '/profile?token=secret' }],
          },
        }],
      },
      generateIntents: {
        intents: [{
          id: 'intent-1',
          capabilityId: 'cap-1',
          sourceNodeId: 'node-1',
          canonicalUtterance: 'open profile',
          callable: true,
          utteranceExamples: ['one', 'two', 'three', 'four'],
          negativeExamples: ['no1', 'no2', 'no3', 'no4'],
        }],
      },
      verifySkill: { verificationReport: { status: 'passed', runtimeMode: 'generic_http_read' } },
      registerSkill: { registryReport: { status: 'registered' } },
    },
    {
      status: 'success',
      buildId: 'build-1',
      siteId: 'example-test',
      skillId: 'skill-1',
      artifacts: {
        [USER_REPORT_FILE]: path.join(artifactDir, USER_REPORT_FILE),
        [USER_REPORT_MARKDOWN_FILE]: path.join(artifactDir, USER_REPORT_MARKDOWN_FILE),
        [DEBUG_REPORT_FILE]: path.join(artifactDir, DEBUG_REPORT_FILE),
        [INDEX_REPORT_FILE]: path.join(artifactDir, INDEX_REPORT_FILE),
        [CAPABILITY_INTENT_SUMMARY_HTML_FILE]: htmlPath,
      },
      summary: { verificationStatus: 'passed' },
    },
    {
      result_status: 'success',
      legacy_status: 'success',
      coverage: {
        blockedByAuth: [],
        requiresLoginButMissing: [],
      },
    },
  );

  assert.equal(payload.artifactFamily, 'siteforge-capability-intent-html-summary');
  assert.equal(payload.meta.siteUrl, 'https://example.test/');
  assert.equal(payload.meta.paths.htmlReport, 'siteforge-sites/example.test/builds/build-1/reports/capability_intent_summary.html');
  assert.equal(payload.counts.capabilities, 1);
  assert.equal(payload.counts.intents, 1);
  assert.equal(payload.counts.nodes, 2);
  assert.equal(payload.counts.elementNodes, 1);
  assert.equal(payload.capabilities[0].name, 'Read profile <script>');
  assert.equal(payload.capabilities[0].userValue, '[REDACTED_EMAIL]');
  assert.deepEqual(payload.capabilities[0].routeTemplates, ['/profile', '/profile?[REDACTED_SECRET]']);
  assert.deepEqual(payload.intents[0].utteranceExamples, ['one', 'two', 'three']);
  assert.deepEqual(payload.intents[0].negativeExamples, ['no1', 'no2', 'no3']);
  assert.equal(payload.intents[0].callable, 'callable');
  assert.deepEqual(payload.mappings[0].canonicalUtterances, ['open profile']);
  assert.deepEqual(payload.elementCoverage.summary, {
    total: 1,
    covered: 1,
    graphIntentOnly: 0,
    missingCapability: 0,
    missingIntent: 0,
  });
});
