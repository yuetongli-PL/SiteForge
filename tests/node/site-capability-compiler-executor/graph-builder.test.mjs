import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSiteCapabilityGraphFromCompileManifest,
  createCapabilityGraphDraftFromCompileManifest,
} from '../../../src/app/compiler/index.mjs';
import {
  validateSiteCapabilityGraph,
} from '../../../src/domain/capabilities/site-capability-graph.mjs';
import {
  createSyntheticCompileManifest,
} from './helpers.mjs';

test('graph builder emits a valid descriptor-only graph from compile manifest', () => {
  const manifest = createSyntheticCompileManifest();
  const graph = createCapabilityGraphDraftFromCompileManifest(manifest);
  const report = validateSiteCapabilityGraph(graph);

  assert.equal(graph.manifest.compilerGenerated, true);
  assert.equal(graph.manifest.compilerVersion, manifest.compilerVersion);
  assert.equal(graph.manifest.sourceCompileManifestId, manifest.compileId);
  assert.ok(graph.nodes.some((node) => node.type === 'SiteNode'));
  assert.ok(graph.nodes.some((node) => node.type === 'CapabilityNode'));
  assert.ok(graph.nodes.some((node) => node.type === 'RouteNode'));
  assert.ok(graph.nodes.some((node) => node.type === 'ExecutionContractNode'));
  assert.ok(graph.nodes.some((node) => node.type === 'RuntimeBindingNode'));
  assert.ok(graph.nodes.some((node) => node.type === 'GovernancePolicyNode'));
  assert.ok(graph.edges.some((edge) => edge.type === 'site_declares_capability'));
  assert.ok(graph.edges.some((edge) => edge.type === 'capability_exposed_on_route'));
  assert.ok(graph.edges.some((edge) => edge.type === 'capability_guarded_by_risk_policy'));
  assert.ok(graph.edges.some((edge) => edge.type === 'capability_has_execution_contract'));
  assert.ok(graph.edges.some((edge) => edge.type === 'execution_contract_bound_to_runtime'));
  assert.ok(graph.edges.some((edge) => edge.type === 'execution_contract_governed_by_policy'));
  assert.equal(report.result, 'passed');
  assert.deepEqual(report.findings, []);
});

test('graph builder models destructive execution contracts without making them auto-executable', () => {
  const manifest = createSyntheticCompileManifest({
    capabilityConfig: {
      siteKey: 'synthetic.example',
      capabilities: [
        {
          capabilityKey: 'delete-record',
          normalizedIntent: 'delete-record',
          capabilityFamily: 'record-management',
          supportedTaskTypes: ['delete-record'],
          routeKey: 'record-admin',
          routeKind: 'page',
          urlPattern: 'https://synthetic.example/records/:id',
          pageType: 'admin-detail',
          mode: 'write',
          requiresApproval: true,
          requiresAuth: true,
          requiresSession: true,
          riskState: 'blocked',
          riskReasonCode: 'execution.destructive_default_blocked',
        },
      ],
    },
  });
  const graph = createCapabilityGraphDraftFromCompileManifest(manifest);
  const report = validateSiteCapabilityGraph(graph);
  const contract = graph.nodes.find((node) => node.type === 'ExecutionContractNode');
  const governance = graph.nodes.find((node) => node.type === 'GovernancePolicyNode');

  assert.equal(report.result, 'passed');
  assert.equal(contract.destructiveAction, true);
  assert.equal(contract.highRiskAction, true);
  assert.equal(contract.executionDisposition, 'blocked');
  assert.equal(contract.executionVerdict, 'blocked');
  assert.deepEqual(contract.executionGates, [
    'confirm_required',
    'audit_required',
    'session_required',
    'permission_required',
  ]);
  assert.equal(contract.runtimeCallable, false);
  assert.equal(contract.autoExecutable, false);
  assert.equal(contract.impactScope.level, 'destructive');
  assert.equal(contract.executionPrerequisites.sitePolicyExplicitAllowRequired, true);
  assert.equal(contract.executionPrerequisites.strongConfirmationRequired, true);
  assert.equal(contract.executionPrerequisites.auditRequired, true);
  assert.equal(contract.executionPrerequisites.naturalLanguageRequestGrantsExecution, false);
  assert.equal(governance.runtimeDispatchAllowedByDefault, false);
  assert.equal(governance.executionVerdict, 'blocked');
  assert.deepEqual(governance.executionGates, [
    'confirm_required',
    'audit_required',
    'session_required',
    'permission_required',
  ]);
  assert.equal(governance.strongConfirmationRequired, true);
  assert.equal(governance.sitePolicyExplicitAllowRequired, true);
  assert.equal(governance.auditPolicy.required, true);
});

test('graph build manifest records validation result and compiler provenance', () => {
  const manifest = createSyntheticCompileManifest();
  const result = buildSiteCapabilityGraphFromCompileManifest(manifest);

  assert.equal(result.validationReport.result, 'passed');
  assert.equal(result.graphBuildManifest.sourceCompileManifestId, manifest.compileId);
  assert.equal(result.graphBuildManifest.compilerVersion, manifest.compilerVersion);
  assert.equal(result.graphBuildManifest.sourceDigest, manifest.sourceDigest);
  assert.equal(result.graphBuildManifest.manifestDigest, manifest.manifestDigest);
  assert.equal(result.graphBuildManifest.validationResult, 'passed');
  assert.equal(result.redactionRequired, true);
});

test('graph version changes when compile manifest digest changes', () => {
  const first = buildSiteCapabilityGraphFromCompileManifest(createSyntheticCompileManifest());
  const second = buildSiteCapabilityGraphFromCompileManifest(createSyntheticCompileManifest({
    capabilityConfig: {
      siteKey: 'synthetic.example',
      capabilities: [
        {
          capabilityKey: 'open-public-page',
          normalizedIntent: 'open-page',
          capabilityFamily: 'navigate-to-author',
          supportedTaskTypes: ['open-page'],
          routeKey: 'public-page',
          routeKind: 'page',
          urlPattern: 'https://synthetic.example/public/:id',
          pageType: 'public-detail',
          mode: 'readOnly',
          agentExposed: true,
          requiresApproval: false,
          priority: 99,
        },
      ],
    },
  }));

  assert.notEqual(first.graph.graphVersion, second.graph.graphVersion);
});

test('graph validation rejects broken compiler-built route edges', () => {
  const manifest = createSyntheticCompileManifest();
  manifest.inventories.capabilities[0].routeRefs = ['route:synthetic.example:missing'];
  const graph = createCapabilityGraphDraftFromCompileManifest(manifest);
  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'failed');
  assert.ok(report.findings.some((finding) => finding.reasonCode === 'graph-capability-missing-route'));
});
