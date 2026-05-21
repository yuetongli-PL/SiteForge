import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSiteCapabilityGraphFromCompileManifest,
} from '../../../src/app/compiler/index.mjs';
import {
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
  createDryRunCapabilityPlan,
} from '../../../src/app/planner/index.mjs';
import {
  createSyntheticCompileManifest,
} from './helpers.mjs';

function createPlanRequest() {
  return {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    taskId: 'task:compiler-generated-planner',
    site: 'synthetic.example',
    siteKey: 'synthetic.example',
    normalizedIntent: 'open-page',
    mode: 'dry_run',
    correlationId: 'correlation:compiler-generated-planner',
  };
}

function createPlanContext() {
  return {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    capabilityState: { schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION, agentExposed: true },
    sessionState: { schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION, status: 'not_required' },
    riskState: { schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION, level: 'low', allowed: true },
    approvalState: { schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION, approved: true },
    graphCompatibility: { validated: true },
    layerCompatibility: { compatible: true, layerCompatibilityVersion: '1.0.0' },
  };
}

test('Planner dry-run consumes validated compiler-generated Graph only', () => {
  const { graph, validationReport } = buildSiteCapabilityGraphFromCompileManifest(createSyntheticCompileManifest());
  const result = createDryRunCapabilityPlan({
    request: createPlanRequest(),
    context: createPlanContext(),
    graph,
    validationReport,
  });

  assert.equal(result.planStatus, 'ready');
  assert.equal(result.capabilityPlan.graphVersion, graph.graphVersion);
  assert.equal(result.capabilityPlan.selectedRoute.source, 'site-capability-graph');
  assert.equal(result.capabilityPlan.selectedRoute.routeId, 'route:synthetic.example:public-page');
  assert.equal(result.executionAllowed, false);
  assert.equal(result.layerHandoffAllowed, false);
  assert.equal(result.siteAdapterInvocationAllowed, false);
  assert.equal(result.downloaderInvocationAllowed, false);
  assert.equal(result.sessionMaterializationAllowed, false);
  assert.equal(result.runtimeMaterializationAllowed, false);
  assert.equal(result.lifecycleDispatchAllowed, false);
  assert.equal(result.externalTelemetryAllowed, false);
  assert.equal(result.graphMutationAllowed, false);
});

test('Planner rejects compiler Graph without passed validation report', () => {
  const { graph } = buildSiteCapabilityGraphFromCompileManifest(createSyntheticCompileManifest());
  assert.throws(
    () => createDryRunCapabilityPlan({
      request: createPlanRequest(),
      context: createPlanContext(),
      graph,
      validationReport: undefined,
    }),
    // @ts-ignore
    (error) => error.code === 'planner.graph_not_validated',
  );
  assert.throws(
    () => createDryRunCapabilityPlan({
      request: createPlanRequest(),
      context: createPlanContext(),
      graph,
      validationReport: {
        graphVersion: graph.graphVersion,
        result: 'failed',
        findings: [{ reasonCode: 'graph.edge_broken' }],
      },
    }),
    // @ts-ignore
    (error) => error.code === 'planner.graph_not_validated',
  );
});
