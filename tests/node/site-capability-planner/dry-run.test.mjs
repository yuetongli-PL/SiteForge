import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
  assertCapabilityPlanCompatible,
  assertPlannerDryRunResultCompatible,
  createDryRunCapabilityPlan,
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

function createRequest(overrides = /** @type {any} */ ({})) {
  return {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    taskId: 'task:synthetic-dry-run',
    site: 'synthetic.example',
    normalizedIntent: 'open-page',
    mode: 'dry_run',
    traceId: 'trace:synthetic-dry-run',
    correlationId: 'correlation:synthetic-dry-run',
    ...overrides,
  };
}

function createContext(overrides = /** @type {any} */ ({})) {
  return {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    graphCompatibility: {
      validated: true,
    },
    layerCompatibility: {
      compatible: true,
      layerCompatibilityVersion: 'synthetic-layer-v1',
    },
    adapterCapabilityState: {
      available: true,
    },
    schemaAvailability: {
      available: true,
    },
    capabilityState: {
      agentExposed: true,
    },
    authState: {
      satisfied: true,
    },
    sessionState: {
      satisfied: true,
    },
    signerState: {
      satisfied: true,
    },
    approvalState: {
      approved: true,
    },
    riskState: {
      allowed: true,
    },
    ...overrides,
  };
}

function graphWithAuthRequirement(graph) {
  const next = clone(graph);
  const capability = next.nodes.find((node) => node.type === 'CapabilityNode');
  capability.requiresAuth = true;
  return next;
}

function validationReportFor(graph) {
  const validationReport = validateSiteCapabilityGraph(graph);
  assert.equal(validationReport.result, 'passed');
  assert.deepEqual(validationReport.findings, []);
  return validationReport;
}

test('Planner dry-run creates a descriptor-only ready CapabilityPlan from validated Graph', async () => {
  const graph = await readMinimalGraphFixture();
  const result = createDryRunCapabilityPlan({
    request: createRequest(),
    context: createContext(),
    graph,
    validationReport: validationReportFor(graph),
  });

  assert.equal(assertPlannerDryRunResultCompatible(result), true);
  assert.equal(assertCapabilityPlanCompatible(result.capabilityPlan), true);
  assert.equal(result.planStatus, 'ready');
  assert.equal(result.capabilityPlan.planStatus, 'ready');
  assert.equal(result.routeResolution.selectedRoute.source, 'site-capability-graph');
  assert.equal(result.capabilityPlan.selectedRoute.source, 'site-capability-graph');
  assert.equal(result.lifecycleEvent.eventType, 'planner.plan.generated');
  assert.equal(result.redactionRequired, true);
  assert.equal(result.descriptorOnly, true);
  assert.equal(result.executionAllowed, false);
  assert.equal(result.layerHandoffAllowed, false);
  assert.equal(result.siteAdapterInvocationAllowed, false);
  assert.equal(result.downloaderInvocationAllowed, false);
  assert.equal(result.sessionMaterializationAllowed, false);
  assert.equal(result.runtimeMaterializationAllowed, false);
  assert.equal(result.artifactServiceInvocationAllowed, false);
  assert.equal(result.lifecycleDispatchAllowed, false);
  assert.equal(result.externalTelemetryAllowed, false);
  assert.equal(result.graphMutationAllowed, false);
  assert.deepEqual(
    result.capabilityPlan.expectedArtifacts.map((artifact) => artifact.type),
    ['CAPABILITY_PLAN', 'PLANNER_DRY_RUN_RESULT', 'PLANNER_LIFECYCLE_EVENT'],
  );
});

test('Planner dry-run normalizes safe intentInput without SiteAdapter semantics', async () => {
  const graph = await readMinimalGraphFixture();
  const result = createDryRunCapabilityPlan({
    request: createRequest({
      normalizedIntent: undefined,
      intentInput: {
        standardIntent: 'open-page',
      },
    }),
    context: createContext(),
    graph,
    validationReport: validationReportFor(graph),
  });

  assert.equal(result.normalizedIntent, 'open-page');
  assert.equal(result.capabilityPlan.normalizedIntent, 'open-page');
});

test('Planner dry-run returns blocked descriptors for unsatisfied context', async () => {
  const graph = graphWithAuthRequirement(await readMinimalGraphFixture());
  const result = createDryRunCapabilityPlan({
    request: createRequest(),
    context: createContext({
      authState: {
        satisfied: false,
      },
    }),
    graph,
    validationReport: validationReportFor(graph),
  });

  assert.equal(assertPlannerDryRunResultCompatible(result), true);
  assert.equal(result.planStatus, 'blocked');
  assert.equal(result.contextCheck.checkStatus, 'blocked');
  assert.equal(result.contextCheck.failures[0].reasonCode, 'planner.auth_required');
  assert.equal(result.capabilityPlan.planStatus, 'blocked');
  assert.equal(result.capabilityPlan.failures[0].reasonCode, 'planner.auth_required');
  assert.equal(result.lifecycleEvent.eventType, 'planner.plan.blocked');
  assert.equal(result.lifecycleEvent.reasonCode, 'planner.auth_required');
  assert.equal(result.layerHandoffAllowed, false);
});

test('Planner dry-run fails closed on unvalidated Graph and unsupported handoff mode', async () => {
  const graph = await readMinimalGraphFixture();
  assert.throws(
    () => createDryRunCapabilityPlan({
      request: createRequest(),
      context: createContext(),
      graph,
      validationReport: {
        result: 'failed',
        findings: [{
          severity: 'error',
          message: 'synthetic validation error',
        }],
      },
    }),
    (error) => {
      // @ts-ignore
      assert.equal(error.code, 'planner.graph_not_validated');
      return true;
    },
  );

  assert.throws(
    () => createDryRunCapabilityPlan({
      request: createRequest({
        mode: 'governed_handoff',
      }),
      context: createContext(),
      graph,
      validationReport: validationReportFor(graph),
    }),
    (error) => {
      // @ts-ignore
      assert.equal(error.code, 'planner.layer_handoff_unavailable');
      return true;
    },
  );
});

test('Planner dry-run rejects sensitive and runtime material without echoing secrets', async () => {
  const graph = await readMinimalGraphFixture();
  for (const { name, request, context } of [
    {
      name: 'request secret URL',
      request: createRequest({
        url: 'https://synthetic.example/?access_token=synthetic-secret-value',
      }),
      context: createContext(),
    },
    {
      name: 'context session runtime',
      request: createRequest(),
      context: createContext({
        sessionView: {
          id: 'synthetic-secret-value',
        },
      }),
    },
    {
      name: 'context downloader runtime',
      request: createRequest(),
      context: createContext({
        downloaderPayload: {
          command: 'download',
        },
      }),
    },
  ]) {
    assert.throws(
      () => createDryRunCapabilityPlan({
        request,
        context,
        graph,
        validationReport: validationReportFor(graph),
      }),
      (error) => {
        // @ts-ignore
        assert.equal(error.code, 'planner.sensitive_material_forbidden');
        // @ts-ignore
        assert.doesNotMatch(error.message, /synthetic-secret-value/u, name);
        return true;
      },
      name,
    );
  }
});

test('Planner dry-run result validator rejects runtime payload fields and execution claims', async () => {
  const graph = await readMinimalGraphFixture();
  const result = createDryRunCapabilityPlan({
    request: createRequest(),
    context: createContext(),
    graph,
    validationReport: validationReportFor(graph),
  });

  for (const mutation of [
    { executionAllowed: true },
    { layerHandoffAllowed: true },
    { downloaderInvocationAllowed: true },
    { lifecycleDispatchAllowed: true },
  ]) {
    assert.throws(
      () => assertPlannerDryRunResultCompatible({
        ...result,
        ...mutation,
      }),
      /disable runtime outputs/u,
    );
  }
  for (const [field, value] of [
    // @ts-ignore
    ['payload', { unsafe: true }],
    ['json', '{"unsafe":true}'],
    ['artifactValue', { unsafe: true }],
    ['auditValue', { unsafe: true }],
    ['graphPayload', { nodes: [] }],
  ]) {
    assert.throws(
      () => assertPlannerDryRunResultCompatible({
        ...result,
        // @ts-ignore
        [field]: value,
      }),
      new RegExp(`must not expose runtime payload field ${field}`, 'u'),
      String(field),
    );
  }
  assert.throws(
    () => assertPlannerDryRunResultCompatible({
      ...result,
      capabilityPlan: {
        ...result.capabilityPlan,
        selectedRoute: {
          ...result.capabilityPlan.selectedRoute,
          source: 'manual',
        },
      },
    }),
    /source must be site-capability-graph/u,
  );
});
