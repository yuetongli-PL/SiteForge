import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  PLANNER_SELECTED_ROUTE_SOURCE,
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
  assertPlannerGraphSourceCompatible,
  loadValidatedPlannerGraphSource,
} from '../../../src/app/planner/index.mjs';
import {
  validateSiteCapabilityGraph,
} from '../../../src/domain/capabilities/site-capability-graph.mjs';

const MINIMAL_GRAPH_URL = new URL('../fixtures/site-capability-graph/minimal-v1.json', import.meta.url);

async function readMinimalGraphFixture() {
  return JSON.parse(await readFile(MINIMAL_GRAPH_URL, 'utf8'));
}

test('Planner graph loader accepts only validated synthetic Graph descriptors', async () => {
  const graph = await readMinimalGraphFixture();
  const validationReport = validateSiteCapabilityGraph(graph);

  const source = loadValidatedPlannerGraphSource({
    graph,
    validationReport,
    expectedGraphVersion: graph.graphVersion,
    expectedGraphSchemaVersion: graph.schemaVersion,
  });

  assert.equal(assertPlannerGraphSourceCompatible(source), true);
  assert.equal(source.schemaVersion, SITE_CAPABILITY_PLANNER_SCHEMA_VERSION);
  assert.equal(source.source, PLANNER_SELECTED_ROUTE_SOURCE);
  assert.equal(source.graphVersion, graph.graphVersion);
  assert.equal(source.graphSchemaVersion, graph.schemaVersion);
  assert.equal(source.validated, true);
  assert.equal(source.validationResult, 'passed');
  assert.equal(source.descriptorOnly, true);
  assert.equal(source.redactionRequired, true);
  assert.equal(source.safeSummaryOnly, true);
  assert.equal(source.routeResolutionAllowed, false);
  assert.equal(source.executionAllowed, false);
  assert.equal(source.layerHandoffAllowed, false);
  assert.equal(source.counts.sites, 1);
  assert.equal(source.counts.capabilities, 1);
  assert.equal(source.counts.routes, 1);
  assert.equal(source.counts.riskPolicies, 1);
  assert.deepEqual(source.sourceInventories, graph.manifest.sourceInventories);
});

test('Planner graph loader rejects missing or unvalidated Graph input', async () => {
  const graph = await readMinimalGraphFixture();
  const validationReport = validateSiteCapabilityGraph(graph);

  assert.throws(
    () => loadValidatedPlannerGraphSource({
      graph: undefined,
      validationReport,
    }),
    (error) => {
      assert.equal(error.code, 'planner.graph_missing');
      return true;
    },
  );
  assert.throws(
    () => loadValidatedPlannerGraphSource({
      graph,
      validationReport: undefined,
    }),
    (error) => {
      assert.equal(error.code, 'planner.graph_not_validated');
      return true;
    },
  );
  assert.throws(
    () => loadValidatedPlannerGraphSource({
      graph,
      validationReport: {
        ...validationReport,
        result: 'failed',
      },
    }),
    (error) => {
      assert.equal(error.code, 'planner.graph_not_validated');
      return true;
    },
  );
  assert.throws(
    () => loadValidatedPlannerGraphSource({
      graph,
      validationReport: {
        ...validationReport,
        findings: [
          {
            reasonCode: 'graph-synthetic-finding',
          },
        ],
      },
    }),
    (error) => {
      assert.equal(error.code, 'planner.graph_not_validated');
      return true;
    },
  );
});

test('Planner graph loader fail-closes incompatible Graph versions', async () => {
  const graph = await readMinimalGraphFixture();
  const validationReport = validateSiteCapabilityGraph(graph);

  assert.throws(
    () => loadValidatedPlannerGraphSource({
      graph,
      validationReport: {
        ...validationReport,
        graphVersion: 'synthetic-other-graph-v1',
      },
    }),
    (error) => {
      assert.equal(error.code, 'planner.version_incompatible');
      return true;
    },
  );
  assert.throws(
    () => loadValidatedPlannerGraphSource({
      graph,
      validationReport,
      expectedGraphVersion: 'synthetic-other-graph-v1',
    }),
    (error) => {
      assert.equal(error.code, 'planner.version_incompatible');
      return true;
    },
  );
  assert.throws(
    () => loadValidatedPlannerGraphSource({
      graph,
      validationReport,
      expectedGraphSchemaVersion: 999,
    }),
    (error) => {
      assert.equal(error.code, 'planner.version_incompatible');
      return true;
    },
  );
});

test('Planner graph loader rejects Graph descriptors carrying sensitive or runtime fields', async () => {
  const graph = await readMinimalGraphFixture();
  const validationReport = validateSiteCapabilityGraph(graph);

  assert.throws(
    () => loadValidatedPlannerGraphSource({
      graph: {
        ...graph,
        headers: {
          cookie: 'SESSDATA=synthetic-secret-value',
        },
      },
      validationReport,
    }),
    (error) => {
      assert.equal(error.code, 'planner.sensitive_material_forbidden');
      assert.doesNotMatch(error.message, /synthetic-secret-value/u);
      return true;
    },
  );
  assert.throws(
    () => loadValidatedPlannerGraphSource({
      graph: {
        ...graph,
        nodes: [
          ...graph.nodes,
          {
            schemaVersion: 1,
            id: 'node:runtime',
            type: 'RouteNode',
            siteKey: 'synthetic.example',
            handler: 'execute',
          },
        ],
      },
      validationReport,
    }),
    (error) => {
      assert.equal(error.code, 'planner.sensitive_material_forbidden');
      return true;
    },
  );
});

test('Planner graph source summary remains descriptor-only and redaction-required', async () => {
  const graph = await readMinimalGraphFixture();
  const validationReport = validateSiteCapabilityGraph(graph);
  const source = loadValidatedPlannerGraphSource({ graph, validationReport });

  assert.throws(
    () => assertPlannerGraphSourceCompatible({
      ...source,
      descriptorOnly: false,
    }),
    /descriptor-only with redactionRequired/u,
  );
  assert.throws(
    () => assertPlannerGraphSourceCompatible({
      ...source,
      redactionRequired: false,
    }),
    /descriptor-only with redactionRequired/u,
  );
  assert.throws(
    () => assertPlannerGraphSourceCompatible({
      ...source,
      source: 'planner-invented',
    }),
    /source must be site-capability-graph/u,
  );
  assert.throws(
    () => assertPlannerGraphSourceCompatible({
      ...source,
      routeResolutionAllowed: true,
    }),
    /safe summary/u,
  );
  assert.throws(
    () => assertPlannerGraphSourceCompatible({
      ...source,
      executionAllowed: true,
    }),
    /safe summary/u,
  );
  assert.throws(
    () => assertPlannerGraphSourceCompatible({
      ...source,
      layerHandoffAllowed: true,
    }),
    /safe summary/u,
  );
});
