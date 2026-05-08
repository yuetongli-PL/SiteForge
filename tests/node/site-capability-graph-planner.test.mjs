import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  planGraphCapabilityRoute,
} from '../../src/sites/capability/site-capability-graph.mjs';
import {
  requireReasonCodeDefinition,
} from '../../src/sites/capability/reason-codes.mjs';

const MINIMAL_GRAPH_URL = new URL('./fixtures/site-capability-graph/minimal-v1.json', import.meta.url);
const APPROVED_LAYER_SOURCE_REF = 'config/site-capabilities.json';
const CAPABILITY_ID = 'capability:synthetic.example:open-public-page';
const PRIMARY_ROUTE_ID = 'route:synthetic.example:public-page';
const FAST_ROUTE_ID = 'route:synthetic.example:fast-public-page';

async function readMinimalGraphFixture() {
  const graph = JSON.parse(await readFile(MINIMAL_GRAPH_URL, 'utf8'));
  for (const node of graph.nodes) {
    if (node.type === 'RiskPolicyNode' && node.sourceRefs === undefined) {
      node.sourceRefs = [APPROVED_LAYER_SOURCE_REF];
    }
  }
  return graph;
}

function addPriorityRoute(graph) {
  const capability = graph.nodes.find((node) => node.id === CAPABILITY_ID);
  const primaryRoute = graph.nodes.find((node) => node.id === PRIMARY_ROUTE_ID);
  primaryRoute.priority = 20;
  capability.routeRefs.push(FAST_ROUTE_ID);
  graph.nodes.push({
    ...primaryRoute,
    id: FAST_ROUTE_ID,
    urlPattern: 'https://synthetic.example/fast-public/:id',
    priority: 5,
  });
  graph.edges.push({
    schemaVersion: 1,
    id: 'edge:capability:route:fast-public-page',
    type: 'capability_exposed_on_route',
    from: CAPABILITY_ID,
    to: FAST_ROUTE_ID,
    testEvidenceRefs: ['test:site-capability-graph-schema'],
  });
}

function assignRouteRiskPolicy(graph, routeId, riskPolicyId, state) {
  const route = graph.nodes.find((node) => node.id === routeId);
  route.riskPolicyRef = riskPolicyId;
  graph.nodes.push({
    schemaVersion: 1,
    id: riskPolicyId,
    type: 'RiskPolicyNode',
    state,
    allowedActions: ['read'],
    blockedActions: ['write'],
    requiresApproval: false,
    cooldownRequired: true,
    isolationRequired: false,
    manualRecoveryRequired: false,
    degradable: true,
    artifactWriteAllowed: false,
    reasonCodeRefs: ['graph-route-forbidden-by-risk'],
    sourceRefs: [APPROVED_LAYER_SOURCE_REF],
  });
}

test('graph planner selects the lowest-priority declared route without executing it', async () => {
  const graph = await readMinimalGraphFixture();
  addPriorityRoute(graph);

  const plan = planGraphCapabilityRoute(graph, CAPABILITY_ID);

  assert.equal(plan.result, 'planned');
  assert.equal(plan.reasonCode, null);
  assert.equal(plan.route.id, FAST_ROUTE_ID);

  plan.route.id = 'mutated';
  assert.equal(graph.nodes.find((node) => node.id === FAST_ROUTE_ID).id, FAST_ROUTE_ID);
});

test('graph planner filters routes by supplied context', async () => {
  const graph = await readMinimalGraphFixture();
  addPriorityRoute(graph);

  const plan = planGraphCapabilityRoute(graph, CAPABILITY_ID, {
    availableRouteIds: [PRIMARY_ROUTE_ID],
  });

  assert.equal(plan.result, 'planned');
  assert.equal(plan.route.id, PRIMARY_ROUTE_ID);
});

test('graph planner returns governed reasonCodes for no-route and context-unsatisfied cases', async () => {
  const graph = await readMinimalGraphFixture();

  const missingCapabilityPlan = planGraphCapabilityRoute(graph, 'capability:synthetic.example:missing');
  assert.equal(missingCapabilityPlan.result, 'blocked');
  assert.equal(missingCapabilityPlan.reasonCode, 'graph-planner-no-route');
  assert.equal(
    requireReasonCodeDefinition(missingCapabilityPlan.reasonCode, { family: 'graph' }).artifactWriteAllowed,
    false,
  );

  const contextBlockedPlan = planGraphCapabilityRoute(graph, CAPABILITY_ID, {
    availableRouteIds: ['route:synthetic.example:missing'],
  });
  assert.equal(contextBlockedPlan.result, 'blocked');
  assert.equal(contextBlockedPlan.reasonCode, 'graph-planner-context-unsatisfied');
  assert.equal(
    requireReasonCodeDefinition(contextBlockedPlan.reasonCode, { family: 'graph' }).artifactWriteAllowed,
    false,
  );
});

test('graph planner blocks route selection by declared risk state', async () => {
  const graph = await readMinimalGraphFixture();
  assignRouteRiskPolicy(
    graph,
    PRIMARY_ROUTE_ID,
    'risk-policy:synthetic.example:route-suspicious-readonly',
    'suspicious',
  );

  const plan = planGraphCapabilityRoute(graph, CAPABILITY_ID, {
    blockedRiskStates: ['suspicious'],
  });

  assert.equal(plan.result, 'blocked');
  assert.equal(plan.reasonCode, 'graph-route-forbidden-by-risk');
  assert.equal(plan.riskState, 'suspicious');
  assert.equal(
    requireReasonCodeDefinition(plan.reasonCode, { family: 'graph' }).artifactWriteAllowed,
    false,
  );
});
