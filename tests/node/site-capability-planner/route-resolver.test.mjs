import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  assertPlannerRouteResolutionCompatible,
  loadValidatedPlannerGraphSource,
  resolvePlannerRoute,
} from '../../../src/app/planner/index.mjs';
import {
  validateSiteCapabilityGraph,
} from '../../../src/domain/capabilities/site-capability-graph.mjs';

const MINIMAL_GRAPH_URL = new URL('../fixtures/site-capability-graph/minimal-v1.json', import.meta.url);

async function readMinimalGraphFixture() {
  return JSON.parse(await readFile(MINIMAL_GRAPH_URL, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function addPriorityRoutes(graph) {
  const next = clone(graph);
  const capability = next.nodes.find((node) => node.type === 'CapabilityNode');
  const baseRoute = next.nodes.find((node) => node.type === 'RouteNode');
  const highPriorityRoute = {
    ...clone(baseRoute),
    id: 'route:synthetic.example:priority-public-page',
    priority: 20,
    fallbackRouteRefs: ['route:synthetic.example:metadata-only'],
    urlPattern: 'https://synthetic.example/public-priority/:id',
  };
  const metadataRoute = {
    ...clone(baseRoute),
    id: 'route:synthetic.example:metadata-only',
    priority: 1,
    routeKind: 'metadata',
    pageType: 'metadata-only',
    urlPattern: 'https://synthetic.example/metadata/:id',
  };
  baseRoute.priority = 5;
  capability.routeRefs = [
    baseRoute.id,
    highPriorityRoute.id,
  ];
  next.nodes.push(highPriorityRoute, metadataRoute);
  return next;
}

function loadGraphSource(graph) {
  const validationReport = validateSiteCapabilityGraph(graph);
  assert.equal(validationReport.result, 'passed');
  assert.deepEqual(validationReport.findings, []);
  return loadValidatedPlannerGraphSource({ graph, validationReport });
}

test('Planner route resolver selects the highest-priority Graph route and Graph-declared fallback', async () => {
  const graph = addPriorityRoutes(await readMinimalGraphFixture());
  const graphSource = loadGraphSource(graph);

  const resolution = resolvePlannerRoute({
    graph,
    graphSource,
    siteKey: 'synthetic.example',
    normalizedIntent: 'open-page',
  });

  assert.equal(assertPlannerRouteResolutionCompatible(resolution), true);
  assert.equal(resolution.selectedRoute.routeId, 'route:synthetic.example:priority-public-page');
  assert.equal(resolution.selectedRoute.source, 'site-capability-graph');
  assert.equal(resolution.selectedRoute.priority, 20);
  assert.deepEqual(
    resolution.routeCandidates.map((route) => route.routeId),
    [
      'route:synthetic.example:priority-public-page',
      'route:synthetic.example:public-page',
    ],
  );
  assert.equal(resolution.fallbacks.length, 1);
  assert.equal(resolution.fallbacks[0].routeId, 'route:synthetic.example:metadata-only');
  assert.equal(resolution.fallbacks[0].source, 'site-capability-graph');
  assert.equal(resolution.descriptorOnly, true);
  assert.equal(resolution.redactionRequired, true);
  assert.equal(resolution.executionAllowed, false);
  assert.equal(resolution.layerHandoffAllowed, false);
  assert.equal(resolution.siteAdapterInvocationAllowed, false);
  assert.equal(resolution.downloaderInvocationAllowed, false);
});

test('Planner route resolver rejects missing Graph source and version mismatch', async () => {
  const graph = addPriorityRoutes(await readMinimalGraphFixture());
  const graphSource = loadGraphSource(graph);

  assert.throws(
    () => resolvePlannerRoute({
      graph,
      graphSource: undefined,
      siteKey: 'synthetic.example',
      normalizedIntent: 'open-page',
    }),
    (error) => {
      // @ts-ignore
      assert.equal(error.code, 'planner.graph_missing');
      return true;
    },
  );
  assert.throws(
    () => resolvePlannerRoute({
      graph,
      graphSource: {
        ...graphSource,
        graphVersion: 'synthetic-other-graph-v1',
      },
      siteKey: 'synthetic.example',
      normalizedIntent: 'open-page',
    }),
    (error) => {
      // @ts-ignore
      assert.equal(error.code, 'planner.version_incompatible');
      return true;
    },
  );
});

test('Planner route resolver returns Planner reason codes for unresolved site capability and route', async () => {
  const graph = addPriorityRoutes(await readMinimalGraphFixture());
  const graphSource = loadGraphSource(graph);

  assert.throws(
    () => resolvePlannerRoute({
      graph,
      graphSource,
      siteKey: 'missing.example',
      normalizedIntent: 'open-page',
    }),
    (error) => {
      // @ts-ignore
      assert.equal(error.code, 'planner.site_unresolved');
      return true;
    },
  );
  assert.throws(
    () => resolvePlannerRoute({
      graph,
      graphSource,
      siteKey: 'synthetic.example',
      normalizedIntent: 'missing-intent',
    }),
    (error) => {
      // @ts-ignore
      assert.equal(error.code, 'planner.capability_not_found');
      return true;
    },
  );

  const graphWithMissingRoute = clone(graph);
  graphWithMissingRoute.nodes.find((node) => node.type === 'CapabilityNode').routeRefs = [
    'route:synthetic.example:missing',
  ];
  const missingRouteSource = loadValidatedPlannerGraphSource({
    graph: graphWithMissingRoute,
    validationReport: {
      schemaVersion: 1,
      graphVersion: graphWithMissingRoute.graphVersion,
      result: 'passed',
      findings: [],
    },
  });
  assert.throws(
    () => resolvePlannerRoute({
      graph: graphWithMissingRoute,
      graphSource: missingRouteSource,
      siteKey: 'synthetic.example',
      normalizedIntent: 'open-page',
    }),
    (error) => {
      // @ts-ignore
      assert.equal(error.code, 'planner.route_not_found');
      return true;
    },
  );
});

test('Planner route resolver rejects sensitive and runtime route fields without echoing values', async () => {
  const graph = addPriorityRoutes(await readMinimalGraphFixture());
  const graphSource = loadGraphSource(graph);

  assert.throws(
    () => resolvePlannerRoute({
      graph: {
        ...graph,
        nodes: [
          ...graph.nodes,
          {
            schemaVersion: 1,
            id: 'route:synthetic.example:unsafe',
            type: 'RouteNode',
            handler: 'execute',
            urlPattern: 'https://synthetic.example/?access_token=synthetic-secret-value',
          },
        ],
      },
      graphSource,
      siteKey: 'synthetic.example',
      normalizedIntent: 'open-page',
    }),
    (error) => {
      // @ts-ignore
      assert.equal(error.code, 'planner.sensitive_material_forbidden');
      // @ts-ignore
      assert.doesNotMatch(error.message, /synthetic-secret-value/u);
      return true;
    },
  );
});

test('Planner route resolution descriptor rejects non-Graph routes and execution flags', async () => {
  const graph = addPriorityRoutes(await readMinimalGraphFixture());
  const graphSource = loadGraphSource(graph);
  const resolution = resolvePlannerRoute({
    graph,
    graphSource,
    siteKey: 'synthetic.example',
    normalizedIntent: 'open-page',
  });

  assert.throws(
    () => assertPlannerRouteResolutionCompatible({
      ...resolution,
      selectedRoute: {
        ...resolution.selectedRoute,
        source: 'planner-invented',
      },
    }),
    /source must be site-capability-graph/u,
  );
  assert.throws(
    () => assertPlannerRouteResolutionCompatible({
      ...resolution,
      executionAllowed: true,
    }),
    /execution disabled/u,
  );
  assert.throws(
    () => assertPlannerRouteResolutionCompatible({
      ...resolution,
      downloaderInvocationAllowed: true,
    }),
    /execution disabled/u,
  );
});
