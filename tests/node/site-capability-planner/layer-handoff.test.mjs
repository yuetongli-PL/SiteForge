import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
  assertPlannerLayerHandoffDescriptorCompatible,
  createDryRunCapabilityPlan,
  createPlannerLayerHandoffDescriptor,
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
    taskId: 'task:synthetic-layer-handoff',
    site: 'synthetic.example',
    normalizedIntent: 'open-page',
    mode: 'dry_run',
    traceId: 'trace:synthetic-layer-handoff',
    correlationId: 'correlation:synthetic-layer-handoff',
    ...overrides,
  };
}

function createContext(overrides = /** @type {any} */ ({})) {
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

async function createReadyDryRun() {
  const graph = await readMinimalGraphFixture();
  return createDryRunCapabilityPlan({
    request: createRequest(),
    context: createContext(),
    graph,
    validationReport: validationReportFor(graph),
  });
}

async function createBlockedDryRun() {
  const graph = graphWithAuthRequirement(await readMinimalGraphFixture());
  return createDryRunCapabilityPlan({
    request: createRequest(),
    context: createContext({
      authState: { satisfied: false },
    }),
    graph,
    validationReport: validationReportFor(graph),
  });
}

test('Planner layer handoff descriptor marks ready plans without dispatching Layer', async () => {
  const dryRunResult = await createReadyDryRun();
  const descriptor = createPlannerLayerHandoffDescriptor({ dryRunResult });

  assert.equal(assertPlannerLayerHandoffDescriptorCompatible(descriptor), true);
  assert.equal(descriptor.handoffTarget, 'site-capability-layer');
  assert.equal(descriptor.handoffMode, 'governed_handoff');
  assert.equal(descriptor.governedHandoffReady, true);
  assert.equal(descriptor.planId.startsWith('plan:'), true);
  assert.equal(descriptor.taskId, 'task:synthetic-layer-handoff');
  assert.equal(descriptor.traceId, 'trace:synthetic-layer-handoff');
  assert.equal(descriptor.correlationId, 'correlation:synthetic-layer-handoff');
  assert.equal(descriptor.siteKey, 'synthetic.example');
  assert.equal(descriptor.routeId, descriptor.capabilityPlan.selectedRoute.routeId);
  assert.equal(descriptor.dryRunResult.planStatus, 'ready');
  assert.equal(descriptor.dryRunResult.contextCheck.checkStatus, 'satisfied');
  assert.equal(descriptor.layerDispatchAllowed, false);
  assert.equal(descriptor.layerHandoffAllowed, false);
  assert.equal(descriptor.executionAllowed, false);
  assert.equal(descriptor.siteAdapterInvocationAllowed, false);
  assert.equal(descriptor.downloaderInvocationAllowed, false);
  assert.equal(descriptor.sessionMaterializationAllowed, false);
  assert.equal(descriptor.runtimeMaterializationAllowed, false);
  assert.equal(descriptor.capabilityPlan.planStatus, 'ready');
  assert.equal(descriptor.selectedRoute.source, 'site-capability-graph');
});

test('Planner layer handoff descriptor keeps blocked plans non-ready with reasonCode', async () => {
  const dryRunResult = await createBlockedDryRun();
  const descriptor = createPlannerLayerHandoffDescriptor({ dryRunResult });

  assert.equal(assertPlannerLayerHandoffDescriptorCompatible(descriptor), true);
  assert.equal(descriptor.governedHandoffReady, false);
  assert.equal(descriptor.reasonCode, 'planner.auth_required');
  assert.equal(descriptor.dryRunResult.contextCheck.checkStatus, 'blocked');
  assert.equal(descriptor.capabilityPlan.planStatus, 'blocked');
  assert.equal(descriptor.layerDispatchAllowed, false);
});

test('Planner layer handoff descriptor rejects runtime payloads and execution claims', async () => {
  const descriptor = createPlannerLayerHandoffDescriptor({
    dryRunResult: await createReadyDryRun(),
  });

  for (const mutation of [
    { executionAllowed: true },
    { layerDispatchAllowed: true },
    { layerHandoffAllowed: true },
    { siteAdapterInvocationAllowed: true },
    { downloaderInvocationAllowed: true },
    { sessionMaterializationAllowed: true },
    { runtimeMaterializationAllowed: true },
    { artifactServiceInvocationAllowed: true },
    { lifecycleDispatchAllowed: true },
    { externalTelemetryAllowed: true },
    { graphMutationAllowed: true },
    { logsWriteAllowed: true },
  ]) {
    assert.throws(
      () => assertPlannerLayerHandoffDescriptorCompatible({
        ...descriptor,
        ...mutation,
      }),
      /runtime outputs disabled/u,
    );
  }
  for (const [field, value] of [
    // @ts-ignore
    ['payload', { unsafe: true }],
    ['runtimePayload', { unsafe: true }],
    ['handoffPayload', { unsafe: true }],
    ['layerPayload', { unsafe: true }],
    ['graph', { nodes: [] }],
    ['context', { authState: { satisfied: true } }],
    ['validationReport', { result: 'passed' }],
    ['sessionView', { status: 'available' }],
    ['downloadPolicy', { mode: 'synthetic' }],
    ['standardTaskList', { items: [] }],
    ['siteAdapterRuntime', { pageType: 'synthetic' }],
    ['downloaderPayload', { command: 'download' }],
    ['artifact', { path: 'synthetic' }],
    ['manifest', { artifacts: [] }],
  ]) {
    assert.throws(
      () => assertPlannerLayerHandoffDescriptorCompatible({
        ...descriptor,
        // @ts-ignore
        [field]: value,
      }),
      new RegExp(`must not expose runtime payload field ${field}`, 'u'),
      String(field),
    );
  }
});

test('Planner layer handoff descriptor rejects invalid nested CapabilityPlan', async () => {
  const descriptor = createPlannerLayerHandoffDescriptor({
    dryRunResult: await createReadyDryRun(),
  });

  assert.throws(
    () => assertPlannerLayerHandoffDescriptorCompatible({
      ...descriptor,
      dryRunResult: {
        ...descriptor.dryRunResult,
        capabilityPlan: {
          ...descriptor.dryRunResult.capabilityPlan,
          selectedRoute: {
            ...descriptor.dryRunResult.capabilityPlan.selectedRoute,
            source: 'manual',
          },
        },
      },
      capabilityPlan: {
        ...descriptor.capabilityPlan,
        selectedRoute: {
          ...descriptor.capabilityPlan.selectedRoute,
          source: 'manual',
        },
      },
    }),
    /source must be site-capability-graph/u,
  );
  assert.throws(
    () => assertPlannerLayerHandoffDescriptorCompatible({
      ...descriptor,
      governedHandoffReady: false,
    }),
    /governedHandoffReady must match/u,
  );
});

test('Planner layer handoff descriptor rejects missing or mismatched nested dry-run result', async () => {
  const descriptor = createPlannerLayerHandoffDescriptor({
    dryRunResult: await createReadyDryRun(),
  });

  assert.throws(
    () => createPlannerLayerHandoffDescriptor({
      capabilityPlan: descriptor.capabilityPlan,
    }),
    /PlannerDryRunResult must be a plain object/u,
  );
  assert.throws(
    () => assertPlannerLayerHandoffDescriptorCompatible({
      ...descriptor,
      dryRunResult: undefined,
    }),
    /PlannerDryRunResult must be a plain object/u,
  );
  assert.throws(
    () => assertPlannerLayerHandoffDescriptorCompatible({
      ...descriptor,
      dryRunResult: {
        ...descriptor.dryRunResult,
        capabilityPlan: {
          ...descriptor.dryRunResult.capabilityPlan,
          normalizedIntent: 'different-intent',
        },
      },
    }),
    /normalizedIntent must match/u,
  );
  assert.throws(
    () => assertPlannerLayerHandoffDescriptorCompatible({
      ...descriptor,
      capabilityPlan: {
        ...descriptor.capabilityPlan,
        selectedRoute: {
          ...descriptor.capabilityPlan.selectedRoute,
          routeId: 'route:synthetic.other',
        },
      },
      routeId: 'route:synthetic.other',
    }),
    /routeId must match/u,
  );
});

test('Planner layer handoff descriptor rejects missing required descriptor identity fields', async () => {
  const descriptor = createPlannerLayerHandoffDescriptor({
    dryRunResult: await createReadyDryRun(),
  });

  for (const field of ['planId', 'taskId', 'traceId', 'correlationId', 'siteKey', 'routeId']) {
    assert.throws(
      () => assertPlannerLayerHandoffDescriptorCompatible({
        ...descriptor,
        [field]: undefined,
      }),
      /is required/u,
      field,
    );
  }
});
