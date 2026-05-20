import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
  assertPlannerContextCheckCompatible,
  assertPlannerFallbackDecisionCompatible,
  checkPlannerContext,
  createDryRunCapabilityPlan,
  loadValidatedPlannerGraphSource,
  resolvePlannerRoute,
  selectPlannerFallbackRoute,
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

function addPriorityFallbackRoutes(graph) {
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

function addBlockedRiskPolicy(graph) {
  const next = clone(graph);
  const capability = next.nodes.find((node) => node.type === 'CapabilityNode');
  const blockedRiskPolicy = {
    schemaVersion: 1,
    id: 'risk-policy:synthetic.example:blocked-degradable',
    type: 'RiskPolicyNode',
    state: 'blocked',
    reasonCode: 'graph-route-forbidden-by-risk',
    allowedActions: [],
    blockedActions: ['read'],
    requiresApproval: false,
    cooldownRequired: true,
    isolationRequired: false,
    manualRecoveryRequired: true,
    degradable: true,
    artifactWriteAllowed: false,
    sourceRefs: ['config/site-capabilities.json'],
  };
  capability.riskPolicyRef = blockedRiskPolicy.id;
  next.nodes.push(blockedRiskPolicy);
  return next;
}

function loadGraphSource(graph) {
  const validationReport = validateSiteCapabilityGraph(graph);
  assert.equal(validationReport.result, 'passed');
  assert.deepEqual(validationReport.findings, []);
  return loadValidatedPlannerGraphSource({ graph, validationReport });
}

function createContext(overrides = {}) {
  return {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    graphCompatibility: { validated: true },
    layerCompatibility: {
      compatible: true,
      layerCompatibilityVersion: 'synthetic-layer-v1',
    },
    adapterCapabilityState: { available: true },
    schemaAvailability: { available: true },
    capabilityState: { agentExposed: true },
    authState: { satisfied: true },
    sessionState: { satisfied: true },
    signerState: { satisfied: true },
    approvalState: { approved: true },
    riskState: { allowed: true },
    ...overrides,
  };
}

function createRequest(overrides = {}) {
  return {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    taskId: 'task:synthetic-fallback',
    site: 'synthetic.example',
    normalizedIntent: 'open-page',
    mode: 'dry_run',
    traceId: 'trace:synthetic-fallback',
    correlationId: 'correlation:synthetic-fallback',
    ...overrides,
  };
}

async function createRouteResolution({ withFallback = true } = {}) {
  const baseGraph = await readMinimalGraphFixture();
  const graph = withFallback ? addPriorityFallbackRoutes(baseGraph) : baseGraph;
  return resolvePlannerRoute({
    graph,
    graphSource: loadGraphSource(graph),
    siteKey: 'synthetic.example',
    normalizedIntent: 'open-page',
  });
}

function createRiskBlockedCheck(routeResolution, { degradable = true } = {}) {
  return checkPlannerContext({
    routeResolution,
    planContext: createContext(),
    requirements: {},
    capability: { mode: 'readOnly' },
    riskPolicy: {
      allowed: false,
      blocked: true,
      reasonCode: 'graph-route-forbidden-by-risk',
      degradable,
      cooldownRequired: true,
      manualRecoveryRequired: true,
    },
  });
}

test('Planner fallback strategy returns not-required when context is satisfied', async () => {
  const routeResolution = await createRouteResolution();
  const contextCheck = checkPlannerContext({
    routeResolution,
    planContext: createContext(),
    requirements: {},
    capability: { mode: 'readOnly' },
    riskPolicy: { allowed: true },
  });
  const decision = selectPlannerFallbackRoute({ routeResolution, contextCheck });

  assert.equal(assertPlannerFallbackDecisionCompatible(decision), true);
  assert.equal(decision.decisionStatus, 'not_required');
  assert.equal(decision.fallbackRequired, false);
  assert.equal(decision.fallbackSelected, false);
  assert.equal(decision.executionAllowed, false);
  assert.equal(decision.layerHandoffAllowed, false);
  assert.equal(decision.downloaderInvocationAllowed, false);
});

test('Planner fallback strategy selects only Graph-declared fallback for degradable risk blocks', async () => {
  const routeResolution = await createRouteResolution();
  const contextCheck = createRiskBlockedCheck(routeResolution);
  const decision = selectPlannerFallbackRoute({ routeResolution, contextCheck });

  assert.equal(assertPlannerFallbackDecisionCompatible(decision), true);
  assert.equal(decision.decisionStatus, 'fallback_selected');
  assert.equal(decision.degradationApplied, true);
  assert.equal(decision.reasonCode, 'planner.route_forbidden_by_risk');
  assert.equal(decision.blockedReasonCode, 'planner.route_forbidden_by_risk');
  assert.equal(decision.sourceReasonCode, 'graph-route-forbidden-by-risk');
  assert.equal(decision.selectedFallbackRoute.routeId, 'route:synthetic.example:metadata-only');
  assert.equal(decision.selectedFallbackRoute.source, 'site-capability-graph');
});

test('Planner fallback strategy maps degradable missing fallback to planner.fallback_not_found', async () => {
  const routeResolution = await createRouteResolution({ withFallback: false });
  const contextCheck = createRiskBlockedCheck(routeResolution);
  const decision = selectPlannerFallbackRoute({ routeResolution, contextCheck });

  assert.equal(decision.decisionStatus, 'fallback_not_found');
  assert.equal(decision.reasonCode, 'planner.fallback_not_found');
  assert.equal(decision.blockedReasonCode, 'planner.route_forbidden_by_risk');
  assert.equal(decision.sourceReasonCode, 'graph-route-forbidden-by-risk');
  assert.equal(decision.degradationAllowed, true);
  assert.equal(decision.fallbackSelected, false);
});

test('Planner fallback strategy supports version and schema degradation decisions from context failures', async () => {
  const routeResolution = await createRouteResolution();
  const satisfiedCheck = checkPlannerContext({
    routeResolution,
    planContext: createContext(),
    requirements: {},
    capability: { mode: 'readOnly' },
    riskPolicy: { allowed: true },
  });
  const contextCheck = {
    ...satisfiedCheck,
    checkStatus: 'blocked',
    failures: [
      {
        reasonCode: 'planner.version_incompatible',
        requirement: 'layerCompatibility',
        retryable: false,
        cooldownRequired: false,
        manualInterventionRequired: true,
        degradable: true,
        artifactWriteAllowed: false,
        layerHandoffAllowed: false,
      },
      {
        reasonCode: 'planner.schema_missing',
        requirement: 'schema',
        retryable: true,
        cooldownRequired: false,
        manualInterventionRequired: true,
        degradable: true,
        artifactWriteAllowed: false,
        layerHandoffAllowed: false,
      },
    ],
  };
  assert.equal(assertPlannerContextCheckCompatible(contextCheck), true);

  const decision = selectPlannerFallbackRoute({ routeResolution, contextCheck });

  assert.equal(decision.decisionStatus, 'fallback_selected');
  assert.equal(decision.reasonCode, 'planner.version_incompatible');
  assert.equal(decision.selectedFallbackRoute.source, 'site-capability-graph');
});

test('Planner fallback strategy does not select fallback for non-degradable blocked failures', async () => {
  const routeResolution = await createRouteResolution();
  const contextCheck = createRiskBlockedCheck(routeResolution, { degradable: false });
  const decision = selectPlannerFallbackRoute({ routeResolution, contextCheck });

  assert.equal(decision.decisionStatus, 'not_degradable');
  assert.equal(decision.reasonCode, 'planner.route_forbidden_by_risk');
  assert.equal(decision.blockedReasonCode, 'planner.route_forbidden_by_risk');
  assert.equal(decision.fallbackSelected, false);
  assert.equal(decision.degradationApplied, false);
});

test('Planner fallback strategy never degrades auth session signer or approval gates', async () => {
  const routeResolution = await createRouteResolution();
  const satisfiedCheck = checkPlannerContext({
    routeResolution,
    planContext: createContext(),
    requirements: {},
    capability: { mode: 'readOnly' },
    riskPolicy: { allowed: true },
  });

  for (const reasonCode of [
    'planner.auth_required',
    'planner.session_required',
    'planner.signer_required',
    'planner.approval_required',
  ]) {
    const contextCheck = {
      ...satisfiedCheck,
      checkStatus: 'blocked',
      failures: [
        {
          reasonCode,
          requirement: reasonCode.replace('planner.', '').replace('_required', ''),
          retryable: true,
          cooldownRequired: false,
          manualInterventionRequired: true,
          degradable: true,
          artifactWriteAllowed: false,
          layerHandoffAllowed: false,
        },
      ],
    };
    assert.equal(assertPlannerContextCheckCompatible(contextCheck), true);

    const decision = selectPlannerFallbackRoute({ routeResolution, contextCheck });

    assert.equal(decision.decisionStatus, 'not_degradable', reasonCode);
    assert.equal(decision.reasonCode, reasonCode);
    assert.equal(decision.fallbackSelected, false);
    assert.equal(decision.fallbackReason, 'context_failure_not_fallback_eligible');
  }
});

test('Planner fallback decision rejects runtime payloads execution claims and non-Graph fallback routes', async () => {
  const routeResolution = await createRouteResolution();
  const contextCheck = createRiskBlockedCheck(routeResolution);
  const decision = selectPlannerFallbackRoute({ routeResolution, contextCheck });

  assert.throws(
    () => assertPlannerFallbackDecisionCompatible({
      ...decision,
      executionAllowed: true,
    }),
    /runtime outputs disabled/u,
  );
  assert.throws(
    () => assertPlannerFallbackDecisionCompatible({
      ...decision,
      plannerVersion: '0.0.0',
    }),
    /plannerVersion is not compatible/u,
  );
  assert.throws(
    () => assertPlannerFallbackDecisionCompatible({
      ...decision,
      siteKey: undefined,
    }),
    /siteKey is required/u,
  );
  assert.throws(
    () => assertPlannerFallbackDecisionCompatible({
      ...decision,
      normalizedIntent: 'other-intent',
    }),
    /normalizedIntent must match/u,
  );
  assert.throws(
    () => assertPlannerFallbackDecisionCompatible({
      ...decision,
      selectedFallbackRoute: {
        ...decision.selectedFallbackRoute,
        source: 'planner-invented',
      },
    }),
    /source must be site-capability-graph/u,
  );
  assert.throws(
    () => assertPlannerFallbackDecisionCompatible({
      ...decision,
      selectedFallbackRoute: {
        ...decision.selectedFallbackRoute,
        routeId: 'route:synthetic.example:not-a-candidate',
      },
    }),
    /selected fallback must come from routeResolution fallbacks/u,
  );
  assert.throws(
    () => assertPlannerFallbackDecisionCompatible({
      ...decision,
      selectedFallbackRoute: {
        ...decision.selectedFallbackRoute,
        graphVersion: 'synthetic-other-graph-v1',
      },
    }),
    /graphVersion must match/u,
  );
  assert.throws(
    () => assertPlannerFallbackDecisionCompatible({
      ...decision,
      reasonCode: 'planner.uncataloged',
    }),
    /cataloged reasonCode/u,
  );
  assert.throws(
    () => assertPlannerFallbackDecisionCompatible({
      ...decision,
      redactionRequired: false,
    }),
    /runtime outputs disabled/u,
  );
  assert.throws(
    () => assertPlannerFallbackDecisionCompatible({
      ...decision,
      contextCheck: {
        ...decision.contextCheck,
        routeId: 'route:synthetic.example:other-primary',
      },
    }),
    /routeId must match/u,
  );
  assert.throws(
    () => assertPlannerFallbackDecisionCompatible({
      ...decision,
      payload: {
        url: 'https://synthetic.example/?access_token=synthetic-secret-value',
      },
    }),
    (error) => {
      assert.equal(error.code, 'planner.sensitive_material_forbidden');
      assert.doesNotMatch(error.message, /synthetic-secret-value/u);
      return true;
    },
  );
});

test('Planner fallback decision enforces per-status invariants', async () => {
  const routeResolution = await createRouteResolution();
  const satisfiedCheck = checkPlannerContext({
    routeResolution,
    planContext: createContext(),
    requirements: {},
    capability: { mode: 'readOnly' },
    riskPolicy: { allowed: true },
  });
  const notRequired = selectPlannerFallbackRoute({
    routeResolution,
    contextCheck: satisfiedCheck,
  });
  const selected = selectPlannerFallbackRoute({
    routeResolution,
    contextCheck: createRiskBlockedCheck(routeResolution),
  });
  const missingFallbackRouteResolution = await createRouteResolution({ withFallback: false });
  const missingFallback = selectPlannerFallbackRoute({
    routeResolution: missingFallbackRouteResolution,
    contextCheck: createRiskBlockedCheck(missingFallbackRouteResolution),
  });
  const notDegradable = selectPlannerFallbackRoute({
    routeResolution,
    contextCheck: createRiskBlockedCheck(routeResolution, { degradable: false }),
  });

  assert.throws(
    () => assertPlannerFallbackDecisionCompatible({
      ...notRequired,
      fallbackRequired: true,
    }),
    /not_required status/u,
  );
  assert.throws(
    () => assertPlannerFallbackDecisionCompatible({
      ...notRequired,
      selectedFallbackRoute: routeResolution.fallbacks[0],
    }),
    /selectedFallbackRoute requires/u,
  );
  assert.throws(
    () => assertPlannerFallbackDecisionCompatible({
      ...selected,
      degradationApplied: false,
    }),
    /fallback_selected status/u,
  );
  assert.throws(
    () => assertPlannerFallbackDecisionCompatible({
      ...missingFallback,
      reasonCode: 'planner.route_forbidden_by_risk',
    }),
    /fallback_not_found status/u,
  );
  assert.throws(
    () => assertPlannerFallbackDecisionCompatible({
      ...notDegradable,
      selectedFallbackRoute: routeResolution.fallbacks[0],
    }),
    /selectedFallbackRoute requires/u,
  );
});

test('Planner fallback strategy does not mutate route resolution or context check inputs', async () => {
  const routeResolution = await createRouteResolution();
  const contextCheck = createRiskBlockedCheck(routeResolution);
  const routeBefore = clone(routeResolution);
  const contextBefore = clone(contextCheck);

  selectPlannerFallbackRoute({ routeResolution, contextCheck });

  assert.deepEqual(routeResolution, routeBefore);
  assert.deepEqual(contextCheck, contextBefore);
});

test('Planner dry-run uses fallback strategy to produce degraded Graph fallback plan', async () => {
  const graph = addBlockedRiskPolicy(addPriorityFallbackRoutes(await readMinimalGraphFixture()));
  const dryRunResult = createDryRunCapabilityPlan({
    request: createRequest(),
    context: createContext(),
    graph,
    validationReport: validateSiteCapabilityGraph(graph),
  });

  assert.equal(dryRunResult.planStatus, 'degraded');
  assert.equal(dryRunResult.fallbackDecision.decisionStatus, 'fallback_selected');
  assert.equal(dryRunResult.capabilityPlan.planStatus, 'degraded');
  assert.equal(
    dryRunResult.capabilityPlan.selectedRoute.routeId,
    'route:synthetic.example:metadata-only',
  );
  assert.equal(dryRunResult.routeResolution.selectedRoute.routeId, 'route:synthetic.example:priority-public-page');
  assert.equal(dryRunResult.executionAllowed, false);
});
