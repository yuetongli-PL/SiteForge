import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  GRAPH_DOCS_GENERATION_EVENT_TYPE,
  GRAPH_DOCS_GENERATION_OBSERVABILITY_PROFILE,
  assertGraphDerivedArtifactWriteAllowed,
  assertDisabledGraphDocsLifecycleDispatchConsumerResultCompatibility,
  assertDisabledGraphDocsLifecycleObservabilityAdapterHandshakeCompatibility,
  assertDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesignCompatibility,
  assertGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignCompatibility,
  assertGraphDocsLifecycleDispatchDesignCompatibility,
  assertGraphDocsLifecycleDispatchPreflightCompatibility,
  assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility,
  assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightCompatibility,
  assertGraphDocsGenerationLifecycleEventConsumerCompatibility,
  assertGraphDocsGenerationObservabilityEvent,
  assertGraphLifecycleProducerInventoryObservabilityCoverageCompatibility,
  createDisabledGraphDocsLifecycleDispatchConsumerResult,
  createDisabledGraphDocsLifecycleObservabilityAdapterHandshake,
  createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign,
  createGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign,
  createGraphDocsLifecycleObservabilityRegistrationOwnerPreflight,
  createGraphDocsLifecycleObservabilityRuntimeImplementationPreflight,
  createGraphDocsLifecycleDispatchDesign,
  createGraphDocsLifecycleDispatchPreflightContract,
  createGraphDocsGenerationLifecycleEvent,
  createGraphLifecycleProducerInventoryObservabilityCoverage,
  generateGraphDocsSummary,
  writeGraphDocsGenerationLifecycleEventArtifact,
} from '../../src/domain/capabilities/site-capability-graph.mjs';
import * as siteCapabilityGraph from '../../src/domain/capabilities/site-capability-graph.mjs';
import {
  createGraphDerivedArtifactPlacement,
  writeGraphDerivedArtifactPair,
} from '../../src/domain/artifacts/site-capability-graph-artifacts.mjs';
import {
  LIFECYCLE_EVENT_OBSERVABILITY_PROFILES,
  LIFECYCLE_EVENT_SCHEMA_VERSION,
  createLifecycleEventSubscriberRegistry,
  dispatchLifecycleEvent,
  normalizeLifecycleEvent,
} from '../../src/domain/lifecycle/lifecycle-events.mjs';

const MINIMAL_GRAPH_URL = new URL('./fixtures/site-capability-graph/minimal-v1.json', import.meta.url);

async function readMinimalGraphFixture() {
  return JSON.parse(await readFile(MINIMAL_GRAPH_URL, 'utf8'));
}

function createGraphDocsEvent(overrides = /** @type {any} */ ({})) {
  return normalizeLifecycleEvent({
    eventType: GRAPH_DOCS_GENERATION_EVENT_TYPE,
    traceId: 'trace-synthetic-graph-docs',
    correlationId: 'correlation-synthetic-graph-docs',
    taskId: 'task-synthetic-graph-docs',
    siteKey: 'synthetic.example',
    taskType: 'site-capability-graph-docs',
    adapterVersion: 'synthetic-adapter-v1',
    reasonCode: 'graph-docs-generation-failed',
    createdAt: '2026-05-05T00:00:00.000Z',
    details: {
      graphVersion: 'synthetic-graph-v1',
      capabilityId: 'capability:synthetic.example:open-public-page',
      capabilityKey: 'open-public-page',
      lifecycleEvent: GRAPH_DOCS_GENERATION_EVENT_TYPE,
      validationResult: 'failed',
      redactionResult: 'blocked',
      riskState: 'normal',
      queryName: 'generateGraphDocsSummary',
      artifactFamily: 'site-capability-graph-docs',
      redactionRequired: true,
    },
    ...overrides,
  });
}

function captureThrownMessage(fn) {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected function to throw');
}

async function captureRejectedMessage(fn) {
  try {
    await fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected function to reject');
}

function assertNoFunctionValues(value, pathLabel = 'value') {
  if (typeof value === 'function') {
    throw new Error(`${pathLabel} must not include function values`);
  }
  if (!value || typeof value !== 'object') {
    return true;
  }
  for (const [key, child] of Object.entries(value)) {
    assertNoFunctionValues(child, `${pathLabel}.${key}`);
  }
  return true;
}

function loadGraphDocsGenerationLifecycleEventRegistrySubscriberApi() {
  const create = siteCapabilityGraph.createGraphDocsGenerationLifecycleEventRegistrySubscriber;
  if (typeof create !== 'function') {
    throw new Error(
      'graph docs lifecycle producer registry subscriber export is required: '
      + 'createGraphDocsGenerationLifecycleEventRegistrySubscriber',
    );
  }
  return { create };
}

function loadGraphDocsLifecycleObservabilityRegistrationOwnerIntegrationApi() {
  const create = siteCapabilityGraph.createGraphDocsLifecycleObservabilityRegistrationOwnerIntegration;
  const assertCompatibility =
    siteCapabilityGraph.assertGraphDocsLifecycleObservabilityRegistrationOwnerIntegrationCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'registration owner integration exports are required: '
      + 'createGraphDocsLifecycleObservabilityRegistrationOwnerIntegration and '
      + 'assertGraphDocsLifecycleObservabilityRegistrationOwnerIntegrationCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function loadGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultApi() {
  const create =
    siteCapabilityGraph.createGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult;
  const assertCompatibility =
    siteCapabilityGraph
      .assertGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'runtime dispatch dry-run adapter result exports are required: '
      + 'createGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult and '
      + 'assertGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function loadGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardApi() {
  const create =
    siteCapabilityGraph.createGraphDocsLifecycleObservabilityLayerAdapterHandoffGuard;
  const assertCompatibility =
    siteCapabilityGraph
      .assertGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'runtime dispatch Layer adapter handoff guard exports are required: '
      + 'createGraphDocsLifecycleObservabilityLayerAdapterHandoffGuard and '
      + 'assertGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function loadGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateApi() {
  const create =
    siteCapabilityGraph
      .createGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate;
  const assertCompatibility =
    siteCapabilityGraph
      .assertGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'runtime dispatch Layer adapter compatibility review gate exports are required: '
      + 'createGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate and '
      + 'assertGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function loadGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightApi() {
  const create =
    siteCapabilityGraph
      .createGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight;
  const assertCompatibility =
    siteCapabilityGraph
      .assertGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'runtime dispatch write-intent preflight exports are required: '
      + 'createGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight and '
      + 'assertGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function loadGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardApi() {
  const create =
    siteCapabilityGraph
      .createGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard;
  const assertCompatibility =
    siteCapabilityGraph
      .assertGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'runtime dispatch live-write boundary guard exports are required: '
      + 'createGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard and '
      + 'assertGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function loadGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardApi() {
  const create =
    siteCapabilityGraph
      .createGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard;
  const assertCompatibility =
    siteCapabilityGraph
      .assertGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'runtime dispatch live adapter write boundary guard exports are required: '
      + 'createGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard and '
      + 'assertGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function createRegistrationOwnerIntegration(create, registry, options = /** @type {any} */ ({})) {
  try {
    return create(registry, options);
  } catch (error) {
    if (
      error instanceof TypeError
      || /registry|options|must be an object|must expose registerSubscriber/iu.test(String(error?.message ?? error))
    ) {
      return create({ registry, ...options });
    }
    throw error;
  }
}

async function createRuntimeDispatchDryRunAdapterResult(create, {
  registry,
  event,
  ...options
} = /** @type {any} */ ({})) {
  return await create({
    registry,
    subscriberRegistry: registry,
    lifecycleEvent: event,
    event,
    ...options,
  });
}

async function createRuntimeDispatchDryRunAdapterResultForLayerAdapterHandoffGuard() {
  const {
    create: createRegistrationIntegration,
  } = loadGraphDocsLifecycleObservabilityRegistrationOwnerIntegrationApi();
  const {
    create: createDryRunAdapterResult,
  } = loadGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultApi();
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const registry = createLifecycleEventSubscriberRegistry();
  const registrationOwnerIntegration =
    createRegistrationOwnerIntegration(createRegistrationIntegration, registry, {
      integrationName: 'synthetic-layer-adapter-handoff-registration-owner',
      subscriberId: 'synthetic-layer-adapter-handoff-subscriber',
    });
  const event = createGraphDocsGenerationLifecycleEvent({
    summary,
    traceId: 'trace-synthetic-layer-adapter-handoff-dry-run',
    correlationId: 'correlation-synthetic-layer-adapter-handoff-dry-run',
    taskId: 'task-synthetic-layer-adapter-handoff-dry-run',
    siteKey: 'synthetic.example',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    createdAt: '2026-05-05T00:00:00.000Z',
  });
  return await createRuntimeDispatchDryRunAdapterResult(createDryRunAdapterResult, {
    registry,
    event,
    sourceRegistrationOwnerIntegration: registrationOwnerIntegration,
    adapterName: 'synthetic-layer-adapter-handoff-dry-run-adapter',
  });
}

async function createWriteIntentPreflightForLiveWriteBoundaryGuard() {
  const {
    create: createLayerAdapterHandoffGuard,
  } = loadGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardApi();
  const {
    create: createCompatibilityReviewGate,
  } = loadGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateApi();
  const {
    create: createWriteIntentPreflight,
  } = loadGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightApi();
  const dryRunResult = await createRuntimeDispatchDryRunAdapterResultForLayerAdapterHandoffGuard();
  const handoffGuard = createLayerAdapterHandoffGuard(dryRunResult, {
    handoffName: 'synthetic-layer-adapter-handoff-guard-for-live-write-boundary',
  });
  const compatibilityReviewGate = createCompatibilityReviewGate(handoffGuard, {
    reviewGateName: 'synthetic-compatibility-review-gate-for-live-write-boundary',
  });
  return createWriteIntentPreflight(compatibilityReviewGate, {
    preflightName: 'synthetic-write-intent-preflight-for-live-write-boundary',
  });
}

async function createLiveWriteBoundaryGuardForLiveAdapterWriteBoundaryGuard() {
  const {
    create: createLiveWriteBoundaryGuard,
  } = loadGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardApi();
  const writeIntentPreflight = await createWriteIntentPreflightForLiveWriteBoundaryGuard();
  return createLiveWriteBoundaryGuard(writeIntentPreflight, {
    guardName: 'synthetic-runtime-dispatch-live-write-boundary-guard-for-live-adapter',
  });
}

function loadGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardApi() {
  const create = siteCapabilityGraph.createGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard;
  const assertCompatibility =
    siteCapabilityGraph.assertGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'registration owner handoff guard exports are required: '
      + 'createGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard and '
      + 'assertGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function loadGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardApi() {
  const create =
    siteCapabilityGraph.createGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard;
  const assertCompatibility =
    siteCapabilityGraph
      .assertGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'runtime registration consumer guard exports are required: '
      + 'createGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard and '
      + 'assertGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function loadGraphObservabilityExternalTelemetryDispatchBoundaryApi() {
  const create = siteCapabilityGraph.createGraphObservabilityExternalTelemetryDispatchBoundary;
  const assertCompatibility =
    siteCapabilityGraph.assertGraphObservabilityExternalTelemetryDispatchBoundaryCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'external telemetry dispatch boundary exports are required: '
      + 'createGraphObservabilityExternalTelemetryDispatchBoundary and '
      + 'assertGraphObservabilityExternalTelemetryDispatchBoundaryCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function createExternalTelemetryDispatchBoundary(create, sourceGuard, options = /** @type {any} */ ({})) {
  try {
    return create(sourceGuard, options);
  } catch (error) {
    if (
      error instanceof TypeError
      || /source|guard|options|must be an object|runtime registration/iu.test(String(error?.message ?? error))
    ) {
      return create({
        runtimeRegistrationConsumerGuard: sourceGuard,
        sourceRuntimeRegistrationConsumerGuard: sourceGuard,
        ...options,
      });
    }
    throw error;
  }
}

async function createRuntimeRegistrationConsumerGuardForExternalTelemetryBoundary() {
  const {
    create: createRegistrationOwnerHandoffGuard,
  } = loadGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardApi();
  const {
    create: createRuntimeRegistrationConsumerGuard,
  } = loadGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardApi();
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const baseOptions = {
    summary,
    traceId: 'trace-synthetic-section-18-external-telemetry-boundary',
    correlationId: 'correlation-synthetic-section-18-external-telemetry-boundary',
    taskId: 'task-synthetic-section-18-external-telemetry-boundary',
    siteKey: 'synthetic.example',
    graphVersion: 'synthetic-section-18-external-telemetry-boundary-source-graph',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    createdAt: '2026-05-05T00:00:00.000Z',
  };
  const lifecycleDispatchPreflight = createGraphDocsLifecycleDispatchPreflightContract(
    baseOptions,
  );
  const adapterHandshake = createDisabledGraphDocsLifecycleObservabilityAdapterHandshake({
    ...baseOptions,
    preflight: lifecycleDispatchPreflight,
    adapterName: 'synthetic-observability-adapter-from-external-telemetry-boundary',
  });
  const consumerIntegrationDesign = createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign({
    ...baseOptions,
    preflight: lifecycleDispatchPreflight,
    handshake: adapterHandshake,
    consumerName: 'synthetic-observability-consumer-from-external-telemetry-boundary',
  });
  const adapterBoundary = createGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign({
    ...baseOptions,
    consumerIntegrationDesign,
    boundaryName: 'synthetic-observability-adapter-wiring-from-external-telemetry-boundary',
  });
  const runtimePreflight = createGraphDocsLifecycleObservabilityRuntimeImplementationPreflight({
    ...baseOptions,
    adapterBoundary,
    preflightName: 'synthetic-runtime-implementation-preflight-from-external-telemetry-boundary',
  });
  const ownerPreflight = createGraphDocsLifecycleObservabilityRegistrationOwnerPreflight({
    ...baseOptions,
    runtimeImplementationPreflight: runtimePreflight,
    preflightName: 'synthetic-registration-owner-preflight-from-external-telemetry-boundary',
  });
  const handoffGuard = createRegistrationOwnerHandoffGuard(ownerPreflight, {
    handoffName: 'synthetic-registration-owner-handoff-from-external-telemetry-boundary',
  });
  return createRuntimeRegistrationConsumerGuard(handoffGuard, {
    consumerName: 'synthetic-runtime-registration-consumer-from-external-telemetry-boundary',
  });
}

test('graph docs generation observability profile is descriptor-only and not a runtime producer profile', () => {
  assert.equal(GRAPH_DOCS_GENERATION_EVENT_TYPE, 'graph.docs.summary.generated');
  assert.deepEqual(GRAPH_DOCS_GENERATION_OBSERVABILITY_PROFILE.requiredFields, [
    'traceId',
    'correlationId',
    'taskId',
    'siteKey',
    'taskType',
    'adapterVersion',
    'reasonCode',
  ]);
  assert.equal(
    Object.hasOwn(LIFECYCLE_EVENT_OBSERVABILITY_PROFILES, GRAPH_DOCS_GENERATION_EVENT_TYPE),
    false,
  );
});

test('graph docs generation observability fixture satisfies required descriptor fields', () => {
  const event = createGraphDocsEvent();

  assert.equal(event.schemaVersion, LIFECYCLE_EVENT_SCHEMA_VERSION);
  assert.equal(assertGraphDocsGenerationObservabilityEvent(event), true);
});

test('graph docs generation lifecycle producer creates dispatchable descriptor events', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);

  const event = createGraphDocsGenerationLifecycleEvent({
    summary,
    traceId: 'trace-synthetic-graph-docs-producer',
    correlationId: 'correlation-synthetic-graph-docs-producer',
    taskId: 'task-synthetic-graph-docs-producer',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    createdAt: '2026-05-05T00:00:00.000Z',
  });

  assert.equal(event.eventType, GRAPH_DOCS_GENERATION_EVENT_TYPE);
  assert.equal(event.details.graphVersion, 'synthetic-graph-v1');
  assert.equal(event.details.capabilityId, 'capability:synthetic.example:open-public-page');
  assert.equal(event.details.routeId, 'route:synthetic.example:public-page');
  assert.equal(event.details.plannerDecision, 'not-dispatched');
  assert.equal(event.details.redactionRequired, true);
  assert.equal(assertGraphDocsGenerationLifecycleEventConsumerCompatibility(event), true);
  assert.equal(assertGraphDocsGenerationObservabilityEvent(event), true);

  const dispatched = await dispatchLifecycleEvent(event);
  assert.equal(dispatched.event.eventType, GRAPH_DOCS_GENERATION_EVENT_TYPE);
  assert.deepEqual(dispatched.subscriberResults, []);
});

test('graph docs lifecycle producer registry subscriber dispatches safe summaries through registry', async () => {
  const { create } = loadGraphDocsGenerationLifecycleEventRegistrySubscriberApi();
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const registry = createLifecycleEventSubscriberRegistry();
  const subscriberDescriptor = create({
    subscriberId: 'synthetic-graph-docs-lifecycle-registry-subscriber',
    redactionRequired: true,
  });

  const registeredDescriptor = registry.registerSubscriber(subscriberDescriptor);
  const event = createGraphDocsGenerationLifecycleEvent({
    summary,
    traceId: 'trace-synthetic-graph-docs-registry-subscriber',
    correlationId: 'correlation-synthetic-graph-docs-registry-subscriber',
    taskId: 'task-synthetic-graph-docs-registry-subscriber',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    createdAt: '2026-05-05T00:00:00.000Z',
  });
  const result = await registry.dispatch(event);
  const [subscriberResult] = result.subscriberResults;
  const [descriptor] = registry.listSubscriberDescriptors();

  assert.equal(registeredDescriptor.subscriberId, 'synthetic-graph-docs-lifecycle-registry-subscriber');
  assert.equal(registeredDescriptor.redactionRequired, true);
  assert.equal(registeredDescriptor.externalTelemetry, false);
  assert.equal(registeredDescriptor.writesArtifacts, false);
  assert.equal(registeredDescriptor.writesLogs, false);
  assert.deepEqual(registeredDescriptor.eventTypes, [GRAPH_DOCS_GENERATION_EVENT_TYPE]);
  assert.equal(result.event.eventType, GRAPH_DOCS_GENERATION_EVENT_TYPE);
  assert.equal(result.event.schemaVersion, LIFECYCLE_EVENT_SCHEMA_VERSION);
  assert.equal(result.subscriberResults.length, 1);
  assert.equal(
    subscriberResult.eventType ?? subscriberResult.lifecycleEvent,
    GRAPH_DOCS_GENERATION_EVENT_TYPE,
  );
  assert.equal(subscriberResult.accepted, true);
  assert.equal(subscriberResult.graphVersion, summary.graphVersion);
  if (Object.hasOwn(subscriberResult, 'artifactFamily')) {
    assert.equal(subscriberResult.artifactFamily, 'site-capability-graph-docs');
  }
  assert.equal(subscriberResult.redactionRequired, true);
  assert.equal(subscriberResult.externalTelemetryEnabled ?? false, false);
  assert.equal(subscriberResult.writesArtifacts ?? false, false);
  assert.equal(subscriberResult.writesLogs ?? false, false);
  assert.equal(subscriberResult.docsWriteEnabled ?? false, false);
  assert.equal(subscriberResult.artifactWriteEnabled ?? false, false);
  assert.equal(subscriberResult.sessionMaterializationEnabled ?? false, false);
  assert.equal(subscriberResult.downloaderInvocationEnabled ?? false, false);
  assert.equal(subscriberResult.siteAdapterInvocationEnabled ?? false, false);
  assert.equal(descriptor.subscriberId, registeredDescriptor.subscriberId);
  assert.deepEqual(descriptor.eventTypes, [GRAPH_DOCS_GENERATION_EVENT_TYPE]);
  assert.equal(assertNoFunctionValues(registry.listSubscriberDescriptors()), true);
  assert.doesNotMatch(
    JSON.stringify({ descriptors: registry.listSubscriberDescriptors(), subscriberResult }),
    /function|synthetic-secret-value|Authorization|Bearer|cookie|csrf|sessionId|browserProfile/iu,
  );
});

test('graph docs lifecycle producer registry subscriber ignores non-matching lifecycle events', async () => {
  const { create } = loadGraphDocsGenerationLifecycleEventRegistrySubscriberApi();
  const registry = createLifecycleEventSubscriberRegistry();
  const subscriberDescriptor = create({
    subscriberId: 'synthetic-graph-docs-lifecycle-registry-non-matching-subscriber',
  });
  registry.registerSubscriber(subscriberDescriptor);

  const result = await registry.dispatch(normalizeLifecycleEvent({
    eventType: 'synthetic.lifecycle.other',
    traceId: 'trace-synthetic-graph-docs-registry-non-match',
    correlationId: 'correlation-synthetic-graph-docs-registry-non-match',
    taskId: 'task-synthetic-graph-docs-registry-non-match',
    siteKey: 'synthetic.example',
    taskType: 'site-capability-graph-docs',
    adapterVersion: 'synthetic-adapter-v1',
    createdAt: '2026-05-05T00:00:00.000Z',
    details: {
      graphVersion: 'synthetic-graph-v1',
      artifactFamily: 'site-capability-graph-docs',
      redactionRequired: true,
    },
  }));

  assert.equal(result.event.eventType, 'synthetic.lifecycle.other');
  assert.deepEqual(result.subscriberResults, []);
});

test('graph docs lifecycle producer registry subscriber rejects runtime writes telemetry and sensitive descriptors', () => {
  const { create } = loadGraphDocsGenerationLifecycleEventRegistrySubscriberApi();
  for (const { name, options, pattern } of [
    {
      name: 'externalTelemetry',
      options: { externalTelemetry: true },
      pattern: /externalTelemetry.*false|external telemetry|descriptor-only/i,
    },
    {
      name: 'writesArtifacts',
      options: { writesArtifacts: true },
      pattern: /writesArtifacts.*false|artifact.*write|descriptor-only/i,
    },
    {
      name: 'writesLogs',
      options: { writesLogs: true },
      pattern: /writesLogs.*false|log.*write|descriptor-only/i,
    },
    {
      name: 'redactionRequired',
      options: { redactionRequired: false },
      pattern: /redactionRequired.*true|redaction required/i,
    },
    {
      name: 'sessionView',
      options: { sessionView: { sessionId: 'synthetic-secret-value' } },
      pattern: /sessionView|forbidden|sensitive|descriptor-only/i,
    },
    {
      name: 'downloader',
      options: { downloader: { execute: 'synthetic-secret-value' } },
      pattern: /downloader|forbidden|descriptor-only/i,
    },
    {
      name: 'siteAdapter',
      options: { siteAdapter: { execute: 'synthetic-secret-value' } },
      pattern: /siteAdapter|forbidden|descriptor-only/i,
    },
    {
      name: 'runtimePayload',
      options: { runtimePayload: { Authorization: 'Bearer synthetic-secret-value' } },
      pattern: /runtimePayload|Authorization|Forbidden sensitive pattern|forbidden|descriptor-only/i,
    },
    {
      name: 'authorizationHeader',
      options: { authorizationHeader: 'Bearer synthetic-secret-value' },
      pattern: /authorizationHeader|Forbidden sensitive pattern|forbidden|sensitive/i,
    },
    {
      name: 'cookie',
      options: { cookie: 'synthetic-secret-value' },
      pattern: /cookie|forbidden|sensitive/i,
    },
    {
      name: 'browserProfile',
      options: { browserProfile: 'synthetic-secret-value' },
      pattern: /browserProfile|profile|forbidden|sensitive/i,
    },
  ]) {
    const message = captureThrownMessage(() => create({
      subscriberId: `synthetic-graph-docs-lifecycle-registry-rejected-${name}`,
      ...options,
    }));
    assert.match(message, pattern, name);
    assert.doesNotMatch(message, /synthetic-secret-value/u, name);
  }
});

test('graph docs lifecycle producer registry subscriber registry rejects unsafe descriptor mutation', () => {
  const { create } = loadGraphDocsGenerationLifecycleEventRegistrySubscriberApi();
  const registry = createLifecycleEventSubscriberRegistry();
  const subscriberDescriptor = create({
    subscriberId: 'synthetic-graph-docs-lifecycle-registry-mutated-subscriber',
  });

  for (const { name, descriptorPatch, pattern } of [
    {
      name: 'externalTelemetry',
      descriptorPatch: { externalTelemetry: true },
      pattern: /externalTelemetry.*false|external telemetry/i,
    },
    {
      name: 'writesArtifacts',
      descriptorPatch: { writesArtifacts: true },
      pattern: /writesArtifacts.*false|artifacts/i,
    },
    {
      name: 'writesLogs',
      descriptorPatch: { writesLogs: true },
      pattern: /writesLogs.*false|logs/i,
    },
    {
      name: 'redactionRequired',
      descriptorPatch: { redactionRequired: false },
      pattern: /redactionRequired.*true|redaction required/i,
    },
  ]) {
    const message = captureThrownMessage(() => registry.registerSubscriber({
      ...subscriberDescriptor,
      ...descriptorPatch,
    }));
    assert.match(message, pattern, name);
    assert.doesNotMatch(message, /synthetic-secret-value/u, name);
  }
});

test('registration owner integration registers graph docs lifecycle producer registry subscriber', async () => {
  const { create, assertCompatibility } =
    loadGraphDocsLifecycleObservabilityRegistrationOwnerIntegrationApi();
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const registry = createLifecycleEventSubscriberRegistry();
  const integration = createRegistrationOwnerIntegration(create, registry, {
    integrationName: 'synthetic-registration-owner-integration',
    subscriberId: 'synthetic-registration-owner-integration-subscriber',
    redactionRequired: true,
  });
  const descriptors = registry.listSubscriberDescriptors();
  const [descriptor] = descriptors;
  const item = integration.items?.[0] ?? integration;
  const event = createGraphDocsGenerationLifecycleEvent({
    summary,
    traceId: 'trace-synthetic-registration-owner-integration',
    correlationId: 'correlation-synthetic-registration-owner-integration',
    taskId: 'task-synthetic-registration-owner-integration',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    createdAt: '2026-05-05T00:00:00.000Z',
  });
  const dispatchResult = await registry.dispatch(event);
  const [subscriberResult] = dispatchResult.subscriberResults;

  assert.equal(assertCompatibility(integration), true);
  assert.equal(
    integration.queryName,
    'createGraphDocsLifecycleObservabilityRegistrationOwnerIntegration',
  );
  assert.equal(integration.redactionRequired, true);
  assert.equal(item.result ?? 'registered', 'registered');
  assert.equal(descriptors.length, 1);
  assert.equal(descriptor.subscriberId, 'synthetic-registration-owner-integration-subscriber');
  assert.deepEqual(descriptor.eventTypes, [GRAPH_DOCS_GENERATION_EVENT_TYPE]);
  assert.equal(descriptor.redactionRequired, true);
  assert.equal(descriptor.externalTelemetry, false);
  assert.equal(descriptor.writesArtifacts, false);
  assert.equal(descriptor.writesLogs, false);
  assert.equal(descriptor.writesDocs ?? false, false);
  assert.equal(descriptor.writesRepo ?? false, false);
  assert.equal(descriptor.sessionMaterialization ?? descriptor.sessionMaterializationEnabled ?? false, false);
  assert.equal(descriptor.downloaderInvocation ?? descriptor.downloaderInvocationEnabled ?? false, false);
  assert.equal(descriptor.siteAdapterInvocation ?? descriptor.siteAdapterInvocationEnabled ?? false, false);
  assert.equal(assertNoFunctionValues(descriptors), true);
  assert.equal(dispatchResult.event.eventType, GRAPH_DOCS_GENERATION_EVENT_TYPE);
  assert.equal(dispatchResult.subscriberResults.length, 1);
  assert.equal(subscriberResult.accepted, true);
  assert.equal(subscriberResult.subscriberId, 'synthetic-registration-owner-integration-subscriber');
  assert.equal(subscriberResult.eventType, GRAPH_DOCS_GENERATION_EVENT_TYPE);
  assert.equal(subscriberResult.graphVersion, summary.graphVersion);
  assert.equal(subscriberResult.redactionRequired, true);
  assert.equal(subscriberResult.externalTelemetryEnabled ?? false, false);
  assert.equal(subscriberResult.writesArtifacts ?? false, false);
  assert.equal(subscriberResult.writesLogs ?? false, false);
  assert.equal(subscriberResult.docsWriteEnabled ?? false, false);
  assert.equal(subscriberResult.artifactWriteEnabled ?? false, false);
  assert.equal(subscriberResult.sessionMaterializationEnabled ?? false, false);
  assert.equal(subscriberResult.downloaderInvocationEnabled ?? false, false);
  assert.equal(subscriberResult.siteAdapterInvocationEnabled ?? false, false);
  assert.doesNotMatch(
    JSON.stringify({ descriptors, subscriberResult, integration }),
    /function|synthetic-secret-value|Authorization|Bearer|cookie|csrf|sessionId|browserProfile/iu,
  );
});

test('registration owner integration only subscribes to graph docs lifecycle events', async () => {
  const { create, assertCompatibility } =
    loadGraphDocsLifecycleObservabilityRegistrationOwnerIntegrationApi();
  const registry = createLifecycleEventSubscriberRegistry();
  const integration = createRegistrationOwnerIntegration(create, registry, {
    integrationName: 'synthetic-registration-owner-integration-non-matching',
    subscriberId: 'synthetic-registration-owner-integration-non-matching-subscriber',
  });

  const dispatchResult = await registry.dispatch(normalizeLifecycleEvent({
    eventType: 'synthetic.lifecycle.other',
    traceId: 'trace-synthetic-registration-owner-integration-non-match',
    correlationId: 'correlation-synthetic-registration-owner-integration-non-match',
    taskId: 'task-synthetic-registration-owner-integration-non-match',
    siteKey: 'synthetic.example',
    taskType: 'site-capability-graph-docs',
    adapterVersion: 'synthetic-adapter-v1',
    createdAt: '2026-05-05T00:00:00.000Z',
    details: {
      graphVersion: 'synthetic-graph-v1',
      artifactFamily: 'site-capability-graph-docs',
      redactionRequired: true,
    },
  }));
  const [descriptor] = registry.listSubscriberDescriptors();

  assert.equal(assertCompatibility(integration), true);
  assert.deepEqual(descriptor.eventTypes, [GRAPH_DOCS_GENERATION_EVENT_TYPE]);
  assert.equal(dispatchResult.event.eventType, 'synthetic.lifecycle.other');
  assert.deepEqual(dispatchResult.subscriberResults, []);
});

test('registration owner integration rejects unsafe runtime telemetry write and sensitive options', () => {
  const { create } = loadGraphDocsLifecycleObservabilityRegistrationOwnerIntegrationApi();
  for (const { name, options, pattern } of [
    {
      name: 'externalTelemetry',
      options: { externalTelemetry: true },
      pattern: /externalTelemetry.*false|external telemetry|descriptor-only|runtime/i,
    },
    {
      name: 'writesArtifacts',
      options: { writesArtifacts: true },
      pattern: /writesArtifacts.*false|artifact.*write|descriptor-only|runtime/i,
    },
    {
      name: 'writesLogs',
      options: { writesLogs: true },
      pattern: /writesLogs.*false|log.*write|descriptor-only|runtime/i,
    },
    {
      name: 'writesDocs',
      options: { writesDocs: true },
      pattern: /writesDocs.*false|docs.*write|descriptor-only|runtime/i,
    },
    {
      name: 'sessionView',
      options: { sessionView: { sessionId: 'synthetic-secret-value' } },
      pattern: /sessionView|forbidden|sensitive|descriptor-only|runtime/i,
    },
    {
      name: 'downloader',
      options: { downloader: { execute: 'synthetic-secret-value' } },
      pattern: /downloader|forbidden|descriptor-only|runtime/i,
    },
    {
      name: 'siteAdapter',
      options: { siteAdapter: { execute: 'synthetic-secret-value' } },
      pattern: /siteAdapter|forbidden|descriptor-only|runtime/i,
    },
    {
      name: 'runtimePayload',
      options: { runtimePayload: { Authorization: 'Bearer synthetic-secret-value' } },
      pattern: /runtimePayload|Authorization|Forbidden sensitive pattern|forbidden|descriptor-only|runtime/i,
    },
    {
      name: 'authorizationHeader',
      options: { authorizationHeader: 'Bearer synthetic-secret-value' },
      pattern: /authorizationHeader|Forbidden sensitive pattern|forbidden|sensitive/i,
    },
    {
      name: 'cookie',
      options: { cookie: 'synthetic-secret-value' },
      pattern: /cookie|forbidden|sensitive/i,
    },
    {
      name: 'browserProfile',
      options: { browserProfile: 'synthetic-secret-value' },
      pattern: /browserProfile|profile|forbidden|sensitive/i,
    },
  ]) {
    const registry = createLifecycleEventSubscriberRegistry();
    const message = captureThrownMessage(() => createRegistrationOwnerIntegration(create, registry, {
      integrationName: `synthetic-registration-owner-integration-rejected-${name}`,
      subscriberId: `synthetic-registration-owner-integration-rejected-${name}`,
      ...options,
    }));
    assert.match(message, pattern, name);
    assert.doesNotMatch(message, /synthetic-secret-value/u, name);
  }
});

test('runtime dispatch dry-run adapter result dispatches normalized Graph docs lifecycle event through Layer-owned registry', async () => {
  const {
    create: createRegistrationIntegration,
  } = loadGraphDocsLifecycleObservabilityRegistrationOwnerIntegrationApi();
  const {
    create: createDryRunAdapterResult,
    assertCompatibility,
  } = loadGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultApi();
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const registry = createLifecycleEventSubscriberRegistry();
  const registrationOwnerIntegration = createRegistrationOwnerIntegration(createRegistrationIntegration, registry, {
    integrationName: 'synthetic-runtime-dispatch-dry-run-registration-owner',
    subscriberId: 'synthetic-runtime-dispatch-dry-run-subscriber',
  });
  const event = createGraphDocsGenerationLifecycleEvent({
    summary,
    traceId: 'trace-synthetic-runtime-dispatch-dry-run',
    correlationId: 'correlation-synthetic-runtime-dispatch-dry-run',
    taskId: 'task-synthetic-runtime-dispatch-dry-run',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    createdAt: '2026-05-05T00:00:00.000Z',
  });

  const result = await createRuntimeDispatchDryRunAdapterResult(createDryRunAdapterResult, {
    registry,
    event,
    sourceRegistrationOwnerIntegration: registrationOwnerIntegration,
    adapterName: 'synthetic-runtime-dispatch-dry-run-adapter',
  });
  const item = result.items?.[0] ?? result;
  const subscriberResults =
    item.subscriberResultSummaries
    ?? item.subscriberResults
    ?? result.subscriberResultSummaries
    ?? result.subscriberResults
    ?? item.dispatchResult?.subscriberResults
    ?? result.dispatchResult?.subscriberResults;
  const [subscriberResult] = subscriberResults ?? [];

  assert.equal(assertCompatibility(result), true);
  assert.equal(
    result.queryName,
    'createGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult',
  );
  assert.equal(
    result.artifactFamily,
    'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-dry-run-adapter-result',
  );
  assert.equal(result.redactionRequired, true);
  assert.equal(item.redactionRequired ?? result.redactionRequired, true);
  assert.equal(item.descriptorOnly ?? true, true);
  assert.equal(item.registryOwner ?? item.registrationOwner ?? 'Layer', 'Layer');
  assert.equal(item.event?.eventType ?? item.lifecycleEvent?.eventType, GRAPH_DOCS_GENERATION_EVENT_TYPE);
  assert.equal(item.event?.schemaVersion ?? item.lifecycleEvent?.schemaVersion, LIFECYCLE_EVENT_SCHEMA_VERSION);
  assert.equal(item.event?.details?.graphVersion ?? item.lifecycleEvent?.details?.graphVersion, summary.graphVersion);
  assert.equal(Array.isArray(subscriberResults), true);
  assert.equal(subscriberResults.length, 1);
  assert.equal(subscriberResult.subscriberId, 'synthetic-runtime-dispatch-dry-run-subscriber');
  assert.equal(subscriberResult.eventType, GRAPH_DOCS_GENERATION_EVENT_TYPE);
  assert.equal(subscriberResult.graphVersion, summary.graphVersion);
  assert.equal(subscriberResult.redactionRequired, true);

  for (const fieldName of [
    'externalTelemetryEnabled',
    'runtimeDispatchEnabled',
    'runtimeWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'repoWriteEnabled',
    'docsWriteEnabled',
    'writesLogs',
    'writesArtifacts',
    'sessionMaterializationEnabled',
    'downloaderInvocationEnabled',
    'siteAdapterInvocationEnabled',
    'taskRunnerEnabled',
  ]) {
    if (Object.hasOwn(item, fieldName)) {
      assert.equal(item[fieldName], false, `${fieldName} must remain false`);
    }
    if (Object.hasOwn(result, fieldName)) {
      assert.equal(result[fieldName], false, `${fieldName} must remain false`);
    }
  }

  assert.equal(assertNoFunctionValues(result), true);
  assert.equal(assertNoFunctionValues(registry.listSubscriberDescriptors()), true);
  assert.doesNotMatch(
    JSON.stringify({
      result,
      descriptors: registry.listSubscriberDescriptors(),
      subscriberResult,
    }),
    /function|synthetic-secret-value|Authorization|Bearer|cookie|csrf|sessionId|browserProfile/iu,
  );
});

test('runtime dispatch dry-run adapter result rejects telemetry writes and runtime payloads', async () => {
  const {
    create: createRegistrationIntegration,
  } = loadGraphDocsLifecycleObservabilityRegistrationOwnerIntegrationApi();
  const {
    create: createDryRunAdapterResult,
  } = loadGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultApi();
  const registry = createLifecycleEventSubscriberRegistry();
  createRegistrationOwnerIntegration(createRegistrationIntegration, registry, {
    integrationName: 'synthetic-runtime-dispatch-dry-run-rejection-registration-owner',
    subscriberId: 'synthetic-runtime-dispatch-dry-run-rejection-subscriber',
  });
  const event = createGraphDocsEvent({
    traceId: 'trace-synthetic-runtime-dispatch-dry-run-rejection',
    correlationId: 'correlation-synthetic-runtime-dispatch-dry-run-rejection',
    taskId: 'task-synthetic-runtime-dispatch-dry-run-rejection',
  });

  for (const fieldName of [
    'externalTelemetry',
    'externalTelemetryEnabled',
    'runtimeDispatchEnabled',
    'runtimeWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'repoWriteEnabled',
    'docsWriteEnabled',
    'writesLogs',
    'writesArtifacts',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'sessionMaterializationEnabled',
    'taskRunnerEnabled',
  ]) {
    const message = await captureRejectedMessage(
      () => createRuntimeDispatchDryRunAdapterResult(createDryRunAdapterResult, {
        registry,
        event,
        [fieldName]: true,
      }),
    );
    assert.match(message, /must remain false|must be false|descriptor-only|disabled|dry-run|runtime/u, fieldName);
    assert.doesNotMatch(message, /synthetic-secret-value/u, fieldName);
  }

  for (const fieldName of [
    'runtimePayload',
    'telemetryPayload',
    'dispatchPayload',
    'siteAdapter',
    'downloader',
    'sessionView',
    'downloadPolicy',
    'task',
    'taskList',
    'taskRunner',
    'handler',
    'outputPath',
    'repoArtifactPath',
    'eventPath',
    'auditPath',
  ]) {
    const message = await captureRejectedMessage(
      () => createRuntimeDispatchDryRunAdapterResult(createDryRunAdapterResult, {
        registry,
        event,
        [fieldName]: {
          value: 'synthetic-redacted-value',
        },
      }),
    );
    assert.match(message, /descriptor-only|forbidden field|runtime|disabled|payload|dry-run/u, fieldName);
    assert.match(message, new RegExp(fieldName, 'u'), fieldName);
    assert.doesNotMatch(message, /synthetic-secret-value/u, fieldName);
  }
});

test('runtime dispatch dry-run adapter result rejects sensitive material without echoing it', async () => {
  const {
    create: createDryRunAdapterResult,
  } = loadGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultApi();
  const registry = createLifecycleEventSubscriberRegistry();
  const event = createGraphDocsEvent({
    traceId: 'trace-synthetic-runtime-dispatch-dry-run-sensitive',
    correlationId: 'correlation-synthetic-runtime-dispatch-dry-run-sensitive',
    taskId: 'task-synthetic-runtime-dispatch-dry-run-sensitive',
  });

  for (const fieldName of [
    'Authorization',
    'authorizationHeader',
    'cookie',
    'csrf',
    'token',
    'sessionId',
    'browserProfile',
    'credential',
    'credentials',
  ]) {
    const message = await captureRejectedMessage(
      () => createRuntimeDispatchDryRunAdapterResult(createDryRunAdapterResult, {
        registry,
        event,
        [fieldName]: 'synthetic-secret-value',
      }),
    );
    assert.match(message, /forbidden field|Forbidden sensitive pattern|sensitive|descriptor-only|runtime/u);
    assert.match(message, new RegExp(fieldName, 'iu'));
    assert.doesNotMatch(message, /synthetic-secret-value/u);
  }

});

test('runtime dispatch Layer adapter handoff guard consumes dry-run result before live adapter wiring', async () => {
  const {
    create: createLayerAdapterHandoffGuard,
    assertCompatibility,
  } = loadGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardApi();
  const dryRunResult = await createRuntimeDispatchDryRunAdapterResultForLayerAdapterHandoffGuard();

  const guard = createLayerAdapterHandoffGuard(dryRunResult, {
    handoffName: 'synthetic-layer-adapter-handoff-guard',
  });
  const item = guard.items[0];

  assert.equal(assertCompatibility(guard), true);
  assert.equal(
    guard.queryName,
    'createGraphDocsLifecycleObservabilityLayerAdapterHandoffGuard',
  );
  assert.equal(
    guard.artifactFamily,
    'site-capability-graph-docs-lifecycle-observability-layer-adapter-handoff-guard',
  );
  assert.equal(guard.redactionRequired, true);
  assert.equal(item.handoffMode, 'descriptor-only');
  assert.equal(item.result, 'blocked');
  assert.equal(item.redactionRequired, true);
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(
    item.sourceRuntimeDispatchDryRunAdapterResult.queryName,
    dryRunResult.queryName,
  );
  assert.equal(
    item.sourceRuntimeDispatchDryRunAdapterResult.artifactFamily,
    dryRunResult.artifactFamily,
  );
  assert.equal(
    item.sourceRuntimeDispatchDryRunAdapterResult.graphVersion,
    dryRunResult.graphVersion,
  );
  assert.equal(item.sourceRuntimeDispatchDryRunAdapterResult.dryRun, true);
  assert.equal(item.sourceRuntimeDispatchDryRunAdapterResult.descriptorOnly, true);
  assert.equal(
    item.sourceRuntimeDispatchDryRunAdapterResult.subscriberResultCount,
    dryRunResult.items[0].subscriberResultCount,
  );
  assert.equal(
    item.requiredGuards.runtimeDispatchDryRunAdapterResult,
    'assertGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultCompatibility',
  );
  assert.equal(
    item.requiredGuards.layerAdapterHandoffGuard,
    'assertGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardCompatibility',
  );

  for (const fieldName of [
    'externalTelemetryEnabled',
    'runtimeDispatchEnabled',
    'runtimeWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'runtimeLogWriteEnabled',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'sessionMaterializationEnabled',
    'statusPromotionAllowed',
  ]) {
    assert.equal(item[fieldName], false, `${fieldName} must remain false`);
  }

  assert.equal(assertNoFunctionValues(guard), true);
  const rendered = JSON.stringify(guard);
  assert.doesNotMatch(rendered, /"callback"\s*:/u);
  assert.doesNotMatch(rendered, /"registry"\s*:/u);
  assert.doesNotMatch(rendered, /"telemetrySink"\s*:/u);
  assert.doesNotMatch(rendered, /"runtimePayload"\s*:/u);
  assert.doesNotMatch(rendered, /"siteAdapter"\s*:/u);
  assert.doesNotMatch(rendered, /"downloader"\s*:/u);
  assert.doesNotMatch(rendered, /synthetic-secret-value|Authorization|Bearer|cookie|csrf|sessionId|browserProfile/iu);

  const unsupportedSource = {
    ...dryRunResult,
    queryName: 'createGraphDocsLifecycleObservabilityRegistrationOwnerIntegration',
  };
  const message = captureThrownMessage(
    () => createLayerAdapterHandoffGuard(unsupportedSource, {
      handoffName: 'synthetic-layer-adapter-handoff-bad-source',
    }),
  );
  assert.match(message, /runtime dispatch dry-run adapter result|queryName/u);
});

test('runtime dispatch Layer adapter handoff guard rejects adapter runtime telemetry writes and sensitive material', async () => {
  const {
    create: createLayerAdapterHandoffGuard,
  } = loadGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardApi();
  const dryRunResult = await createRuntimeDispatchDryRunAdapterResultForLayerAdapterHandoffGuard();

  for (const fieldName of [
    'externalTelemetryEnabled',
    'runtimeDispatchEnabled',
    'runtimeWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'runtimeLogWriteEnabled',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'sessionMaterializationEnabled',
    'statusPromotionAllowed',
  ]) {
    const message = captureThrownMessage(
      () => createLayerAdapterHandoffGuard(dryRunResult, {
        [fieldName]: true,
      }),
    );
    assert.match(message, /must remain false|must be false|descriptor-only|blocked/u, fieldName);
    assert.doesNotMatch(message, /synthetic-secret-value/u, fieldName);
  }

  for (const fieldName of [
    'adapter',
    'callback',
    'subscriber',
    'telemetrySink',
    'runtimePayload',
    'siteAdapter',
    'downloader',
    'sessionView',
    'artifactPath',
    'writePath',
  ]) {
    const message = captureThrownMessage(
      () => createLayerAdapterHandoffGuard(dryRunResult, {
        [fieldName]: {
          value: 'synthetic-redacted-value',
        },
      }),
    );
    assert.match(message, /descriptor-only|runtime|rejected|field/u, fieldName);
    assert.match(message, new RegExp(fieldName, 'u'), fieldName);
    assert.doesNotMatch(message, /synthetic-redacted-value|synthetic-secret-value/u, fieldName);
  }

  for (const fieldName of [
    'Authorization',
    'authorizationHeader',
    'cookie',
    'csrf',
    'token',
    'sessionId',
    'browserProfile',
    'credential',
    'credentials',
  ]) {
    const message = captureThrownMessage(
      () => createLayerAdapterHandoffGuard(dryRunResult, {
        [fieldName]: 'synthetic-secret-value',
      }),
    );
    assert.match(message, /forbidden field|Forbidden sensitive pattern|sensitive|descriptor-only|runtime/u);
    assert.match(message, new RegExp(fieldName, 'iu'));
    assert.doesNotMatch(message, /synthetic-secret-value/u);
  }

  const ignoredAliasMessage = captureThrownMessage(
    () => createLayerAdapterHandoffGuard({
      runtimeDispatchDryRunAdapterResult: dryRunResult,
      sourceRuntimeDispatchDryRunAdapterResult: {
        ...dryRunResult,
        runtimePayload: {
          Authorization: 'synthetic-secret-value',
        },
      },
    }),
  );
  assert.match(ignoredAliasMessage, /runtimePayload|Authorization|sensitive|descriptor-only|runtime/u);
  assert.doesNotMatch(ignoredAliasMessage, /synthetic-secret-value/u);

  const distinctAliasMessage = captureThrownMessage(
    () => createLayerAdapterHandoffGuard({
      runtimeDispatchDryRunAdapterResult: dryRunResult,
      sourceRuntimeDispatchDryRunAdapterResult: { ...dryRunResult },
    }),
  );
  assert.match(distinctAliasMessage, /multiple distinct source aliases|sourceRuntimeDispatchDryRunAdapterResult/u);
  assert.doesNotMatch(distinctAliasMessage, /synthetic-secret-value/u);
});

test('runtime dispatch Layer adapter compatibility review gate consumes handoff guard without live adapter wiring', async () => {
  const {
    create: createLayerAdapterHandoffGuard,
  } = loadGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardApi();
  const {
    create: createCompatibilityReviewGate,
    assertCompatibility,
  } = loadGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateApi();
  const dryRunResult = await createRuntimeDispatchDryRunAdapterResultForLayerAdapterHandoffGuard();
  const handoffGuard = createLayerAdapterHandoffGuard(dryRunResult, {
    handoffName: 'synthetic-layer-adapter-handoff-guard-for-review-gate',
  });

  const gate = createCompatibilityReviewGate(handoffGuard, {
    reviewGateName: 'synthetic-runtime-dispatch-layer-adapter-compatibility-review-gate',
  });
  const item = gate.items[0];

  assert.equal(assertCompatibility(gate), true);
  assert.equal(
    gate.queryName,
    'createGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate',
  );
  assert.equal(
    gate.artifactFamily,
    'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-layer-adapter-compatibility-review-gate',
  );
  assert.equal(gate.redactionRequired, true);
  assert.equal(item.reviewMode, 'descriptor-only');
  assert.equal(item.result, 'blocked');
  assert.equal(item.redactionRequired, true);
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(
    item.sourceLayerAdapterHandoffGuard.queryName,
    handoffGuard.queryName,
  );
  assert.equal(
    item.sourceLayerAdapterHandoffGuard.artifactFamily,
    handoffGuard.artifactFamily,
  );
  assert.equal(
    item.sourceLayerAdapterHandoffGuard.graphVersion,
    handoffGuard.graphVersion,
  );
  assert.equal(item.sourceLayerAdapterHandoffGuard.handoffMode, 'descriptor-only');
  assert.equal(item.sourceLayerAdapterHandoffGuard.result, 'blocked');
  assert.equal(
    item.requiredGuards.layerAdapterHandoffGuard,
    'assertGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardCompatibility',
  );
  assert.equal(
    item.requiredGuards.runtimeDispatchLayerAdapterCompatibilityReviewGate,
    'assertGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateCompatibility',
  );

  for (const fieldName of [
    'liveAdapterWiringEnabled',
    'adapterWiringEnabled',
    'runtimeDispatchEnabled',
    'runtimeWriteEnabled',
    'runtimeWritesEnabled',
    'runtimeArtifactWriteEnabled',
    'runtimeLogWriteEnabled',
    'externalTelemetryEnabled',
    'externalTelemetryDispatchEnabled',
    'siteAdapterInvocationEnabled',
    'siteAdapterEnabled',
    'downloaderInvocationEnabled',
    'downloaderEnabled',
    'sessionViewEnabled',
    'sessionMaterializationEnabled',
    'sessionViewMaterialized',
    'statusPromotionAllowed',
    'verifiedPromotionAllowed',
  ]) {
    assert.equal(item[fieldName], false, `${fieldName} must remain false`);
  }

  assert.equal(assertNoFunctionValues(gate), true);
  const rendered = JSON.stringify(gate);
  assert.doesNotMatch(rendered, /"callback"\s*:/u);
  assert.doesNotMatch(rendered, /"subscriber"\s*:/u);
  assert.doesNotMatch(rendered, /"telemetrySink"\s*:/u);
  assert.doesNotMatch(rendered, /"runtimePayload"\s*:/u);
  assert.doesNotMatch(rendered, /"siteAdapter"\s*:/u);
  assert.doesNotMatch(rendered, /"downloader"\s*:/u);
  assert.doesNotMatch(rendered, /"sessionView"\s*:/u);
  assert.doesNotMatch(rendered, /"artifactPath"\s*:/u);
  assert.doesNotMatch(rendered, /"writePath"\s*:/u);
  assert.doesNotMatch(rendered, /"logPath"\s*:/u);
  assert.doesNotMatch(rendered, /synthetic-secret-value|Authorization|Bearer|cookie|csrf|sessionId|browserProfile/iu);
});

test('runtime dispatch Layer adapter compatibility review gate rejects runtime adapter products and unsafe source aliases', async () => {
  const {
    create: createLayerAdapterHandoffGuard,
  } = loadGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardApi();
  const {
    create: createCompatibilityReviewGate,
  } = loadGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateApi();
  const dryRunResult = await createRuntimeDispatchDryRunAdapterResultForLayerAdapterHandoffGuard();
  const handoffGuard = createLayerAdapterHandoffGuard(dryRunResult, {
    handoffName: 'synthetic-layer-adapter-handoff-guard-for-review-gate-rejections',
  });

  for (const fieldName of [
    'liveAdapterWiringEnabled',
    'runtimeDispatchEnabled',
    'runtimeWriteEnabled',
    'externalTelemetryEnabled',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'sessionViewEnabled',
    'sessionMaterializationEnabled',
    'statusPromotionAllowed',
  ]) {
    const message = captureThrownMessage(
      () => createCompatibilityReviewGate(handoffGuard, {
        [fieldName]: true,
      }),
    );
    assert.match(message, /must remain false|must be false|descriptor-only|blocked/u, fieldName);
    assert.doesNotMatch(message, /synthetic-secret-value/u, fieldName);
  }

  for (const fieldName of [
    'runtimeAdapterProducts',
    'callback',
    'subscriber',
    'telemetrySink',
    'runtimePayload',
    'siteAdapter',
    'downloader',
    'sessionView',
    'artifactPath',
    'writePath',
    'logPath',
  ]) {
    const message = captureThrownMessage(
      () => createCompatibilityReviewGate(handoffGuard, {
        [fieldName]: {
          value: 'synthetic-redacted-value',
        },
      }),
    );
    assert.match(message, /descriptor-only|runtime|rejected|field/u, fieldName);
    assert.match(message, new RegExp(fieldName, 'u'), fieldName);
    assert.doesNotMatch(message, /synthetic-redacted-value|synthetic-secret-value/u, fieldName);
  }

  for (const fieldName of [
    'Authorization',
    'authorizationHeader',
    'Cookie',
    'cookie',
    'csrf',
    'token',
    'sessionId',
    'browserProfile',
    'credential',
    'credentials',
  ]) {
    const message = captureThrownMessage(
      () => createCompatibilityReviewGate(handoffGuard, {
        [fieldName]: 'synthetic-secret-value',
      }),
    );
    assert.match(message, /forbidden field|Forbidden sensitive pattern|sensitive|descriptor-only|runtime/u);
    assert.match(message, new RegExp(fieldName, 'iu'));
    assert.doesNotMatch(message, /synthetic-secret-value/u);
  }

  const unsafeAliasMessage = captureThrownMessage(
    () => createCompatibilityReviewGate({
      layerAdapterHandoffGuard: handoffGuard,
      sourceLayerAdapterHandoffGuard: {
        ...handoffGuard,
        runtimeAdapterProducts: {
          Authorization: 'synthetic-secret-value',
        },
      },
    }),
  );
  assert.match(unsafeAliasMessage, /runtimeAdapterProducts|Authorization|sensitive|descriptor-only|runtime/u);
  assert.doesNotMatch(unsafeAliasMessage, /synthetic-secret-value/u);

  const distinctSourceAliasMessage = captureThrownMessage(
    () => createCompatibilityReviewGate({
      layerAdapterHandoffGuard: handoffGuard,
      sourceLayerAdapterHandoffGuard: { ...handoffGuard },
    }),
  );
  assert.match(
    distinctSourceAliasMessage,
    /multiple distinct source aliases|sourceLayerAdapterHandoffGuard/u,
  );
  assert.doesNotMatch(distinctSourceAliasMessage, /synthetic-secret-value/u);

  const distinctHandoffAliasMessage = captureThrownMessage(
    () => createCompatibilityReviewGate({
      layerAdapterHandoffGuard: handoffGuard,
      handoffGuard: { ...handoffGuard },
    }),
  );
  assert.match(
    distinctHandoffAliasMessage,
    /multiple distinct source aliases|handoffGuard/u,
  );
  assert.doesNotMatch(distinctHandoffAliasMessage, /synthetic-secret-value/u);
});

test('runtime dispatch write-intent preflight consumes compatibility review gate before writes', async () => {
  const {
    create: createLayerAdapterHandoffGuard,
  } = loadGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardApi();
  const {
    create: createCompatibilityReviewGate,
  } = loadGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateApi();
  const {
    create: createWriteIntentPreflight,
    assertCompatibility,
  } = loadGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightApi();
  const dryRunResult = await createRuntimeDispatchDryRunAdapterResultForLayerAdapterHandoffGuard();
  const handoffGuard = createLayerAdapterHandoffGuard(dryRunResult, {
    handoffName: 'synthetic-layer-adapter-handoff-guard-for-write-intent-preflight',
  });
  const compatibilityReviewGate = createCompatibilityReviewGate(handoffGuard, {
    reviewGateName: 'synthetic-compatibility-review-gate-for-write-intent-preflight',
  });

  const preflight = createWriteIntentPreflight(compatibilityReviewGate, {
    preflightName: 'synthetic-runtime-dispatch-write-intent-preflight',
  });
  const item = preflight.items[0];

  assert.equal(assertCompatibility(preflight), true);
  assert.equal(
    preflight.queryName,
    'createGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight',
  );
  assert.equal(
    preflight.artifactFamily,
    'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-write-intent-preflight',
  );
  assert.equal(preflight.redactionRequired, true);
  assert.equal(item.preflightMode, 'descriptor-only');
  assert.equal(item.result, 'blocked');
  assert.equal(item.redactionRequired, true);
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(
    item.sourceCompatibilityReviewGate.queryName,
    compatibilityReviewGate.queryName,
  );
  assert.equal(
    item.sourceCompatibilityReviewGate.artifactFamily,
    compatibilityReviewGate.artifactFamily,
  );
  assert.equal(
    item.sourceCompatibilityReviewGate.graphVersion,
    compatibilityReviewGate.graphVersion,
  );
  assert.equal(item.sourceCompatibilityReviewGate.reviewMode, 'descriptor-only');
  assert.equal(item.sourceCompatibilityReviewGate.result, 'blocked');
  assert.equal(
    item.requiredGuards.runtimeDispatchLayerAdapterCompatibilityReviewGate,
    'assertGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateCompatibility',
  );
  assert.equal(
    item.requiredGuards.runtimeDispatchWriteIntentPreflight,
    'assertGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightCompatibility',
  );

  for (const fieldName of [
    'runtimeWriteEnabled',
    'runtimeLogWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'runtimeDocsWriteEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'externalTelemetryEnabled',
    'externalTelemetryDispatchEnabled',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'downloaderEnabled',
    'sessionMaterializationEnabled',
    'sessionViewMaterialized',
    'statusPromotionAllowed',
  ]) {
    assert.equal(item[fieldName], false, `${fieldName} must remain false`);
  }

  assert.equal(assertNoFunctionValues(preflight), true);
  const rendered = JSON.stringify(preflight);
  assert.doesNotMatch(rendered, /"writePath"\s*:/u);
  assert.doesNotMatch(rendered, /"logSink"\s*:/u);
  assert.doesNotMatch(rendered, /"artifactWriter"\s*:/u);
  assert.doesNotMatch(rendered, /"repoWriter"\s*:/u);
  assert.doesNotMatch(rendered, /"docsWriter"\s*:/u);
  assert.doesNotMatch(rendered, /"telemetrySink"\s*:/u);
  assert.doesNotMatch(rendered, /"runtimePayload"\s*:/u);
  assert.doesNotMatch(rendered, /"siteAdapter"\s*:/u);
  assert.doesNotMatch(rendered, /"downloader"\s*:/u);
  assert.doesNotMatch(rendered, /"sessionView"\s*:/u);
  assert.doesNotMatch(rendered, /synthetic-secret-value|Authorization|Bearer|cookie|csrf|sessionId|browserProfile/iu);
});

test('runtime dispatch write-intent preflight rejects runtime writers telemetry and sensitive material', async () => {
  const {
    create: createLayerAdapterHandoffGuard,
  } = loadGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardApi();
  const {
    create: createCompatibilityReviewGate,
  } = loadGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateApi();
  const {
    create: createWriteIntentPreflight,
  } = loadGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightApi();
  const dryRunResult = await createRuntimeDispatchDryRunAdapterResultForLayerAdapterHandoffGuard();
  const handoffGuard = createLayerAdapterHandoffGuard(dryRunResult, {
    handoffName: 'synthetic-layer-adapter-handoff-guard-for-write-intent-rejections',
  });
  const compatibilityReviewGate = createCompatibilityReviewGate(handoffGuard, {
    reviewGateName: 'synthetic-compatibility-review-gate-for-write-intent-rejections',
  });

  for (const fieldName of [
    'runtimeWriteEnabled',
    'runtimeLogWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'runtimeDocsWriteEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'externalTelemetryEnabled',
    'externalTelemetryDispatchEnabled',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'downloaderEnabled',
    'sessionMaterializationEnabled',
    'sessionViewMaterialized',
    'statusPromotionAllowed',
  ]) {
    const message = captureThrownMessage(
      () => createWriteIntentPreflight(compatibilityReviewGate, {
        [fieldName]: true,
      }),
    );
    assert.match(message, /must remain false|must be false|descriptor-only|blocked/u, fieldName);
    assert.doesNotMatch(message, /synthetic-secret-value/u, fieldName);
  }

  for (const fieldName of [
    'writePath',
    'logSink',
    'artifactWriter',
    'repoWriter',
    'docsWriter',
    'subscriber',
    'callback',
    'handler',
    'siteAdapter',
    'downloader',
    'SessionView',
    'sessionView',
    'runtimePayload',
    'telemetrySink',
  ]) {
    const message = captureThrownMessage(
      () => createWriteIntentPreflight(compatibilityReviewGate, {
        [fieldName]: {
          value: 'synthetic-redacted-value',
        },
      }),
    );
    assert.match(message, /descriptor-only|runtime|rejected|field/u, fieldName);
    assert.match(message, new RegExp(fieldName, 'iu'), fieldName);
    assert.doesNotMatch(message, /synthetic-redacted-value|synthetic-secret-value/u, fieldName);
  }

  for (const fieldName of [
    'Authorization',
    'authorizationHeader',
    'Cookie',
    'cookie',
    'csrf',
    'token',
    'sessionId',
    'browserProfile',
    'credential',
    'credentials',
  ]) {
    const message = captureThrownMessage(
      () => createWriteIntentPreflight(compatibilityReviewGate, {
        [fieldName]: 'synthetic-secret-value',
      }),
    );
    assert.match(message, /forbidden field|Forbidden sensitive pattern|sensitive|descriptor-only|runtime/u);
    assert.match(message, new RegExp(fieldName, 'iu'));
    assert.doesNotMatch(message, /synthetic-secret-value/u);
  }

  const unsafeAliasMessage = captureThrownMessage(
    () => createWriteIntentPreflight({
      compatibilityReviewGate,
      sourceCompatibilityReviewGate: {
        ...compatibilityReviewGate,
        telemetrySink: {
          Authorization: 'synthetic-secret-value',
        },
      },
    }),
  );
  assert.match(unsafeAliasMessage, /telemetrySink|Authorization|sensitive|descriptor-only|runtime/u);
  assert.doesNotMatch(unsafeAliasMessage, /synthetic-secret-value/u);

  const distinctAliasMessage = captureThrownMessage(
    () => createWriteIntentPreflight({
      compatibilityReviewGate,
      sourceCompatibilityReviewGate: { ...compatibilityReviewGate },
    }),
  );
  assert.match(
    distinctAliasMessage,
    /multiple distinct source aliases|sourceCompatibilityReviewGate/u,
  );
  assert.doesNotMatch(distinctAliasMessage, /synthetic-secret-value/u);

  const distinctRuntimeAliasMessage = captureThrownMessage(
    () => createWriteIntentPreflight({
      compatibilityReviewGate,
      runtimeDispatchLayerAdapterCompatibilityReviewGate: { ...compatibilityReviewGate },
    }),
  );
  assert.match(
    distinctRuntimeAliasMessage,
    /multiple distinct source aliases|runtimeDispatchLayerAdapterCompatibilityReviewGate/u,
  );
  assert.doesNotMatch(distinctRuntimeAliasMessage, /synthetic-secret-value/u);
});

test('runtime dispatch live-write boundary guard consumes write-intent preflight before live writes', async () => {
  const {
    create: createLiveWriteBoundaryGuard,
    assertCompatibility,
  } = loadGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardApi();
  const writeIntentPreflight = await createWriteIntentPreflightForLiveWriteBoundaryGuard();

  const guard = createLiveWriteBoundaryGuard(writeIntentPreflight, {
    guardName: 'synthetic-runtime-dispatch-live-write-boundary-guard',
  });
  const item = guard.items[0];

  assert.equal(assertCompatibility(guard), true);
  assert.equal(
    guard.queryName,
    'createGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard',
  );
  assert.equal(
    guard.artifactFamily,
    'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-live-write-boundary-guard',
  );
  assert.equal(guard.redactionRequired, true);
  assert.equal(item.guardMode, 'descriptor-only');
  assert.equal(item.result, 'blocked');
  assert.equal(item.redactionRequired, true);
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(
    item.sourceWriteIntentPreflight.queryName,
    writeIntentPreflight.queryName,
  );
  assert.equal(
    item.sourceWriteIntentPreflight.artifactFamily,
    writeIntentPreflight.artifactFamily,
  );
  assert.equal(
    item.sourceWriteIntentPreflight.graphVersion,
    writeIntentPreflight.graphVersion,
  );
  assert.equal(item.sourceWriteIntentPreflight.preflightMode, 'descriptor-only');
  assert.equal(item.sourceWriteIntentPreflight.result, 'blocked');
  assert.equal(
    item.requiredGuards.runtimeDispatchWriteIntentPreflight,
    'assertGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightCompatibility',
  );
  assert.equal(
    item.requiredGuards.runtimeDispatchLiveWriteBoundaryGuard,
    'assertGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardCompatibility',
  );

  for (const fieldName of [
    'liveWriteEnabled',
    'runtimeWriteEnabled',
    'runtimeLogWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'runtimeDocsWriteEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'externalTelemetryEnabled',
    'externalTelemetryDispatchEnabled',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'downloaderEnabled',
    'sessionMaterializationEnabled',
    'sessionViewMaterialized',
    'taskRunnerInvocationEnabled',
    'taskRunnerEnabled',
    'statusPromotionAllowed',
    'verifiedPromotionAllowed',
  ]) {
    assert.equal(item[fieldName], false, `${fieldName} must remain false`);
  }

  assert.equal(assertNoFunctionValues(guard), true);
  const rendered = JSON.stringify(guard);
  assert.doesNotMatch(rendered, /"writePath"\s*:/u);
  assert.doesNotMatch(rendered, /"logSink"\s*:/u);
  assert.doesNotMatch(rendered, /"artifactWriter"\s*:/u);
  assert.doesNotMatch(rendered, /"repoWriter"\s*:/u);
  assert.doesNotMatch(rendered, /"docsWriter"\s*:/u);
  assert.doesNotMatch(rendered, /"telemetrySink"\s*:/u);
  assert.doesNotMatch(rendered, /"runtimePayload"\s*:/u);
  assert.doesNotMatch(rendered, /"siteAdapter"\s*:/u);
  assert.doesNotMatch(rendered, /"downloader"\s*:/u);
  assert.doesNotMatch(rendered, /"sessionView"\s*:/u);
  assert.doesNotMatch(rendered, /"taskRunner"\s*:/u);
  assert.doesNotMatch(rendered, /synthetic-secret-value|Authorization|Bearer|cookie|csrf|sessionId|browserProfile/iu);
});

test('runtime dispatch live-write boundary guard rejects runtime writers telemetry and unsafe source aliases', async () => {
  const {
    create: createLiveWriteBoundaryGuard,
  } = loadGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardApi();
  const writeIntentPreflight = await createWriteIntentPreflightForLiveWriteBoundaryGuard();

  for (const fieldName of [
    'liveWriteEnabled',
    'runtimeWriteEnabled',
    'runtimeLogWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'runtimeDocsWriteEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'externalTelemetryEnabled',
    'externalTelemetryDispatchEnabled',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'downloaderEnabled',
    'sessionMaterializationEnabled',
    'sessionViewMaterialized',
    'taskRunnerInvocationEnabled',
    'taskRunnerEnabled',
    'statusPromotionAllowed',
    'verifiedPromotionAllowed',
  ]) {
    const message = captureThrownMessage(
      () => createLiveWriteBoundaryGuard(writeIntentPreflight, {
        [fieldName]: true,
      }),
    );
    assert.match(message, /must remain false|must be false|descriptor-only|blocked/u, fieldName);
    assert.doesNotMatch(message, /synthetic-secret-value/u, fieldName);
  }

  for (const fieldName of [
    'writePath',
    'logSink',
    'artifactWriter',
    'repoWriter',
    'docsWriter',
    'subscriber',
    'callback',
    'handler',
    'siteAdapter',
    'downloader',
    'SessionView',
    'sessionView',
    'runtimePayload',
    'telemetrySink',
    'externalTelemetrySink',
    'taskRunner',
    'taskRunnerStatusPromotion',
  ]) {
    const message = captureThrownMessage(
      () => createLiveWriteBoundaryGuard(writeIntentPreflight, {
        [fieldName]: {
          value: 'synthetic-redacted-value',
        },
      }),
    );
    assert.match(message, /descriptor-only|runtime|rejected|field/u, fieldName);
    assert.match(message, new RegExp(fieldName, 'iu'), fieldName);
    assert.doesNotMatch(message, /synthetic-redacted-value|synthetic-secret-value/u, fieldName);
  }

  for (const fieldName of [
    'Authorization',
    'authorizationHeader',
    'Cookie',
    'cookie',
    'csrf',
    'token',
    'sessionId',
    'browserProfile',
    'credential',
    'credentials',
  ]) {
    const message = captureThrownMessage(
      () => createLiveWriteBoundaryGuard(writeIntentPreflight, {
        [fieldName]: 'synthetic-secret-value',
      }),
    );
    assert.match(message, /forbidden field|Forbidden sensitive pattern|sensitive|descriptor-only|runtime/u);
    assert.match(message, new RegExp(fieldName, 'iu'));
    assert.doesNotMatch(message, /synthetic-secret-value/u);
  }

  const unsafeAliasMessage = captureThrownMessage(
    () => createLiveWriteBoundaryGuard({
      writeIntentPreflight,
      sourceWriteIntentPreflight: {
        ...writeIntentPreflight,
        artifactWriter: {
          Authorization: 'synthetic-secret-value',
        },
      },
    }),
  );
  assert.match(unsafeAliasMessage, /artifactWriter|Authorization|sensitive|descriptor-only|runtime/u);
  assert.doesNotMatch(unsafeAliasMessage, /synthetic-secret-value/u);

  const unsafePreflightAliasMessage = captureThrownMessage(
    () => createLiveWriteBoundaryGuard({
      writeIntentPreflight,
      preflight: {
        ...writeIntentPreflight,
        telemetrySink: {
          Authorization: 'synthetic-secret-value',
        },
      },
    }),
  );
  assert.match(unsafePreflightAliasMessage, /telemetrySink|Authorization|sensitive|descriptor-only|runtime/u);
  assert.doesNotMatch(unsafePreflightAliasMessage, /synthetic-secret-value/u);

  const missingSourceMessage = captureThrownMessage(
    () => createLiveWriteBoundaryGuard({}),
  );
  assert.match(missingSourceMessage, /requires a writeIntentPreflight source/u);
  assert.doesNotMatch(missingSourceMessage, /synthetic-secret-value/u);

  const distinctSourceAliasMessage = captureThrownMessage(
    () => createLiveWriteBoundaryGuard({
      writeIntentPreflight,
      sourceWriteIntentPreflight: { ...writeIntentPreflight },
    }),
  );
  assert.match(
    distinctSourceAliasMessage,
    /multiple distinct source aliases|sourceWriteIntentPreflight/u,
  );
  assert.doesNotMatch(distinctSourceAliasMessage, /synthetic-secret-value/u);

  const distinctRuntimeAliasMessage = captureThrownMessage(
    () => createLiveWriteBoundaryGuard({
      writeIntentPreflight,
      runtimeDispatchWriteIntentPreflight: { ...writeIntentPreflight },
    }),
  );
  assert.match(
    distinctRuntimeAliasMessage,
    /multiple distinct source aliases|runtimeDispatchWriteIntentPreflight/u,
  );
  assert.doesNotMatch(distinctRuntimeAliasMessage, /synthetic-secret-value/u);

  const distinctPreflightAliasMessage = captureThrownMessage(
    () => createLiveWriteBoundaryGuard({
      writeIntentPreflight,
      preflight: { ...writeIntentPreflight },
    }),
  );
  assert.match(
    distinctPreflightAliasMessage,
    /multiple distinct source aliases|preflight/u,
  );
  assert.doesNotMatch(distinctPreflightAliasMessage, /synthetic-secret-value/u);
});

test('runtime dispatch live adapter write boundary guard consumes live-write boundary before adapter dispatch writes', async () => {
  const {
    create: createLiveAdapterWriteBoundaryGuard,
    assertCompatibility,
  } = loadGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardApi();
  const liveWriteBoundaryGuard = await createLiveWriteBoundaryGuardForLiveAdapterWriteBoundaryGuard();

  const guard = createLiveAdapterWriteBoundaryGuard(liveWriteBoundaryGuard, {
    guardName: 'synthetic-runtime-dispatch-live-adapter-write-boundary-guard',
  });
  const item = guard.items[0];

  assert.equal(assertCompatibility(guard), true);
  assert.equal(
    guard.queryName,
    'createGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard',
  );
  assert.equal(
    guard.artifactFamily,
    'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-live-adapter-write-boundary-guard',
  );
  assert.equal(guard.redactionRequired, true);
  assert.equal(item.guardMode, 'descriptor-only');
  assert.equal(item.result, 'blocked');
  assert.equal(item.redactionRequired, true);
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(
    item.sourceLiveWriteBoundaryGuard.queryName,
    liveWriteBoundaryGuard.queryName,
  );
  assert.equal(
    item.sourceLiveWriteBoundaryGuard.artifactFamily,
    liveWriteBoundaryGuard.artifactFamily,
  );
  assert.equal(
    item.sourceLiveWriteBoundaryGuard.graphVersion,
    liveWriteBoundaryGuard.graphVersion,
  );
  assert.equal(item.sourceLiveWriteBoundaryGuard.guardMode, 'descriptor-only');
  assert.equal(item.sourceLiveWriteBoundaryGuard.result, 'blocked');
  assert.equal(
    item.requiredGuards.runtimeDispatchLiveWriteBoundaryGuard,
    'assertGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardCompatibility',
  );
  assert.equal(
    item.requiredGuards.runtimeDispatchLiveAdapterWriteBoundaryGuard,
    'assertGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardCompatibility',
  );

  for (const fieldName of [
    'liveAdapterWriteEnabled',
    'liveWriteEnabled',
    'runtimeWriteEnabled',
    'runtimeLogWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'runtimeDocsWriteEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'externalTelemetryEnabled',
    'externalTelemetryDispatchEnabled',
    'siteAdapterInvocationEnabled',
    'siteAdapterEnabled',
    'downloaderInvocationEnabled',
    'downloaderEnabled',
    'sessionMaterializationEnabled',
    'sessionViewMaterialized',
    'taskRunnerInvocationEnabled',
    'taskRunnerEnabled',
    'routeExecutionEnabled',
    'graphExecutionEnabled',
    'graphExecutes',
    'statusPromotionAllowed',
    'verifiedPromotionAllowed',
  ]) {
    assert.equal(item[fieldName], false, `${fieldName} must remain false`);
  }

  assert.equal(assertNoFunctionValues(guard), true);
  const rendered = JSON.stringify(guard);
  assert.doesNotMatch(rendered, /"writePath"\s*:/u);
  assert.doesNotMatch(rendered, /"runtimeWriter"\s*:/u);
  assert.doesNotMatch(rendered, /"runtimeLog"\s*:/u);
  assert.doesNotMatch(rendered, /"logSink"\s*:/u);
  assert.doesNotMatch(rendered, /"artifactWriter"\s*:/u);
  assert.doesNotMatch(rendered, /"docsWriter"\s*:/u);
  assert.doesNotMatch(rendered, /"repoWriter"\s*:/u);
  assert.doesNotMatch(rendered, /"telemetrySink"\s*:/u);
  assert.doesNotMatch(rendered, /"externalTelemetryPayload"\s*:/u);
  assert.doesNotMatch(rendered, /"runtimePayload"\s*:/u);
  assert.doesNotMatch(rendered, /"siteAdapter"\s*:/u);
  assert.doesNotMatch(rendered, /"downloader"\s*:/u);
  assert.doesNotMatch(rendered, /"SessionView"\s*:/u);
  assert.doesNotMatch(rendered, /"sessionView"\s*:/u);
  assert.doesNotMatch(rendered, /"taskRunner"\s*:/u);
  assert.doesNotMatch(rendered, /"routeExecution"\s*:/u);
  assert.doesNotMatch(rendered, /"graphExecution"\s*:/u);
  assert.doesNotMatch(rendered, /synthetic-secret-value|Authorization|Bearer|cookie|csrf|sessionId|browserProfile/iu);
});

test('runtime dispatch live adapter write boundary guard rejects runtime adapter dispatch writes and unsafe source aliases', async () => {
  const {
    create: createLiveAdapterWriteBoundaryGuard,
  } = loadGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardApi();
  const liveWriteBoundaryGuard = await createLiveWriteBoundaryGuardForLiveAdapterWriteBoundaryGuard();

  for (const fieldName of [
    'liveAdapterWriteEnabled',
    'liveWriteEnabled',
    'runtimeWriteEnabled',
    'runtimeLogWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'runtimeDocsWriteEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'externalTelemetryEnabled',
    'externalTelemetryDispatchEnabled',
    'telemetryDispatchEnabled',
    'siteAdapterInvocationEnabled',
    'siteAdapterEnabled',
    'downloaderInvocationEnabled',
    'downloaderEnabled',
    'sessionMaterializationEnabled',
    'sessionViewMaterialized',
    'taskRunnerInvocationEnabled',
    'taskRunnerEnabled',
    'routeExecutionEnabled',
    'graphExecutionEnabled',
    'graphExecutes',
    'statusPromotionAllowed',
    'verifiedPromotionAllowed',
  ]) {
    const message = captureThrownMessage(
      () => createLiveAdapterWriteBoundaryGuard(liveWriteBoundaryGuard, {
        [fieldName]: true,
      }),
    );
    assert.match(message, /must remain false|must be false|descriptor-only|blocked/u, fieldName);
    assert.doesNotMatch(message, /synthetic-secret-value/u, fieldName);
  }

  for (const fieldName of [
    'writePath',
    'runtimeWriter',
    'runtimeLog',
    'runtimeLogWriter',
    'logSink',
    'artifactWriter',
    'artifactWritePayload',
    'runtimeArtifactWriter',
    'docsWriter',
    'docsPayload',
    'repoWriter',
    'repoPayload',
    'subscriber',
    'callback',
    'handler',
    'telemetrySink',
    'externalTelemetrySink',
    'externalTelemetryDispatch',
    'externalTelemetryPayload',
    'siteAdapter',
    'SiteAdapter',
    'siteAdapterPayload',
    'downloader',
    'downloaderPayload',
    'SessionView',
    'sessionView',
    'sessionViewPayload',
    'taskRunner',
    'taskRunnerPayload',
    'route',
    'routeExecution',
    'graphExecution',
    'runtimePayload',
  ]) {
    const message = captureThrownMessage(
      () => createLiveAdapterWriteBoundaryGuard(liveWriteBoundaryGuard, {
        [fieldName]: {
          Authorization: 'synthetic-secret-value',
        },
      }),
    );
    assert.match(message, /descriptor-only|runtime|rejected|field|sensitive/u, fieldName);
    assert.match(message, new RegExp(fieldName, 'iu'), fieldName);
    assert.doesNotMatch(message, /synthetic-secret-value/u, fieldName);
  }

  for (const fieldName of [
    'Authorization',
    'authorizationHeader',
    'Cookie',
    'cookie',
    'csrf',
    'token',
    'sessionId',
    'browserProfile',
    'credential',
    'credentials',
  ]) {
    const message = captureThrownMessage(
      () => createLiveAdapterWriteBoundaryGuard(liveWriteBoundaryGuard, {
        [fieldName]: 'synthetic-secret-value',
      }),
    );
    assert.match(message, /forbidden field|Forbidden sensitive pattern|sensitive|descriptor-only|runtime/u);
    assert.match(message, new RegExp(fieldName, 'iu'));
    assert.doesNotMatch(message, /synthetic-secret-value/u);
  }
});

test('runtime dispatch live adapter write boundary guard validates source aliases fail closed', async () => {
  const {
    create: createLiveAdapterWriteBoundaryGuard,
    assertCompatibility,
  } = loadGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardApi();
  const liveWriteBoundaryGuard = await createLiveWriteBoundaryGuardForLiveAdapterWriteBoundaryGuard();

  for (const aliasName of [
    'liveWriteBoundaryGuard',
    'sourceLiveWriteBoundaryGuard',
    'runtimeDispatchLiveWriteBoundaryGuard',
    'sourceRuntimeDispatchLiveWriteBoundaryGuard',
    'guard',
  ]) {
    const guard = createLiveAdapterWriteBoundaryGuard({
      [aliasName]: liveWriteBoundaryGuard,
      guardName: `synthetic-live-adapter-write-boundary-${aliasName}`,
    });
    assert.equal(assertCompatibility(guard), true, aliasName);
    assert.equal(guard.items[0].sourceLiveWriteBoundaryGuard.queryName, liveWriteBoundaryGuard.queryName);
    assert.equal(guard.items[0].guardMode, 'descriptor-only');
    assert.equal(guard.items[0].result, 'blocked');
  }

  const allAliasesGuard = createLiveAdapterWriteBoundaryGuard({
    liveWriteBoundaryGuard,
    sourceLiveWriteBoundaryGuard: liveWriteBoundaryGuard,
    runtimeDispatchLiveWriteBoundaryGuard: liveWriteBoundaryGuard,
    sourceRuntimeDispatchLiveWriteBoundaryGuard: liveWriteBoundaryGuard,
    guard: liveWriteBoundaryGuard,
  });
  assert.equal(assertCompatibility(allAliasesGuard), true);

  const missingSourceMessage = captureThrownMessage(
    () => createLiveAdapterWriteBoundaryGuard({}),
  );
  assert.match(missingSourceMessage, /requires a liveWriteBoundaryGuard source|live write boundary guard source/u);
  assert.doesNotMatch(missingSourceMessage, /synthetic-secret-value/u);

  const unsafeAliasMessage = captureThrownMessage(
    () => createLiveAdapterWriteBoundaryGuard({
      liveWriteBoundaryGuard: {
        ...liveWriteBoundaryGuard,
        runtimePayload: {
          Authorization: 'synthetic-secret-value',
        },
      },
    }),
  );
  assert.match(unsafeAliasMessage, /runtimePayload|Authorization|sensitive|descriptor-only|runtime/u);
  assert.doesNotMatch(unsafeAliasMessage, /synthetic-secret-value/u);

  const distinctSourceAliasMessage = captureThrownMessage(
    () => createLiveAdapterWriteBoundaryGuard({
      liveWriteBoundaryGuard,
      sourceLiveWriteBoundaryGuard: { ...liveWriteBoundaryGuard },
    }),
  );
  assert.match(
    distinctSourceAliasMessage,
    /multiple distinct source aliases|sourceLiveWriteBoundaryGuard/u,
  );
  assert.doesNotMatch(distinctSourceAliasMessage, /synthetic-secret-value/u);

  const distinctRuntimeAliasMessage = captureThrownMessage(
    () => createLiveAdapterWriteBoundaryGuard({
      liveWriteBoundaryGuard,
      runtimeDispatchLiveWriteBoundaryGuard: { ...liveWriteBoundaryGuard },
    }),
  );
  assert.match(
    distinctRuntimeAliasMessage,
    /multiple distinct source aliases|runtimeDispatchLiveWriteBoundaryGuard/u,
  );
  assert.doesNotMatch(distinctRuntimeAliasMessage, /synthetic-secret-value/u);

  const distinctSourceRuntimeAliasMessage = captureThrownMessage(
    () => createLiveAdapterWriteBoundaryGuard({
      liveWriteBoundaryGuard,
      sourceRuntimeDispatchLiveWriteBoundaryGuard: { ...liveWriteBoundaryGuard },
    }),
  );
  assert.match(
    distinctSourceRuntimeAliasMessage,
    /multiple distinct source aliases|sourceRuntimeDispatchLiveWriteBoundaryGuard/u,
  );
  assert.doesNotMatch(distinctSourceRuntimeAliasMessage, /synthetic-secret-value/u);

  const distinctGuardAliasMessage = captureThrownMessage(
    () => createLiveAdapterWriteBoundaryGuard({
      liveWriteBoundaryGuard,
      guard: { ...liveWriteBoundaryGuard },
    }),
  );
  assert.match(
    distinctGuardAliasMessage,
    /multiple distinct source aliases|guard/u,
  );
  assert.doesNotMatch(distinctGuardAliasMessage, /synthetic-secret-value/u);
});

test('graph docs lifecycle dispatch design stays descriptor-only without external telemetry', async (t) => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'graph-docs-dispatch-design-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const design = createGraphDocsLifecycleDispatchDesign({
    summary,
    traceId: 'trace-synthetic-graph-docs-dispatch-design',
    correlationId: 'correlation-synthetic-graph-docs-dispatch-design',
    taskId: 'task-synthetic-graph-docs-dispatch-design',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    createdAt: '2026-05-05T00:00:00.000Z',
  });

  assert.equal(assertGraphDocsLifecycleDispatchDesignCompatibility(design), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(design), true);
  assert.equal(design.queryName, 'createGraphDocsLifecycleDispatchDesign');
  assert.equal(design.artifactFamily, 'site-capability-graph-lifecycle-dispatch-design');
  assert.equal(design.redactionRequired, true);
  assert.equal(design.items[0].dispatchMode, 'design-only');
  assert.equal(design.items[0].runtimeDispatchEnabled, false);
  assert.equal(design.items[0].externalTelemetryDispatchEnabled, false);
  assert.equal(design.items[0].subscriberRegistrationEnabled, false);
  assert.equal(design.items[0].repoArtifactWriteEnabled, false);
  assert.equal(design.items[0].sessionMaterializationEnabled, false);
  assert.equal(design.items[0].lifecycleEvent.eventType, GRAPH_DOCS_GENERATION_EVENT_TYPE);
  assert.equal(Object.hasOwn(design.items[0], 'subscribers'), false);
  assert.equal(Object.hasOwn(design.items[0], 'telemetrySink'), false);

  const placement = createGraphDerivedArtifactPlacement({
    outputDir: tempDir,
    runId: 'synthetic-run-graph-docs-dispatch-design',
    artifactFamily: 'site-capability-graph-lifecycle-dispatch-design',
    artifactName: 'dispatch-design',
  });
  const result = await writeGraphDerivedArtifactPair(design, placement);
  const artifactJson = await readFile(result.artifactPath, 'utf8');
  const auditJson = await readFile(result.auditPath, 'utf8');
  assert.doesNotMatch(artifactJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
  assert.doesNotMatch(auditJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
});

test('graph docs generation lifecycle consumer contract rejects telemetry and runtime payloads', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const event = createGraphDocsGenerationLifecycleEvent({
    summary,
    traceId: 'trace-synthetic-graph-docs-consumer',
    correlationId: 'correlation-synthetic-graph-docs-consumer',
    taskId: 'task-synthetic-graph-docs-consumer',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    createdAt: '2026-05-05T00:00:00.000Z',
  });

  assert.equal(assertGraphDocsGenerationLifecycleEventConsumerCompatibility(event), true);
  assert.throws(
    () => assertGraphDocsGenerationLifecycleEventConsumerCompatibility({
      ...event,
      externalTelemetryDispatchEnabled: true,
    }),
    /descriptor-only.*externalTelemetryDispatchEnabled/u,
  );
  assert.throws(
    () => assertGraphDocsGenerationLifecycleEventConsumerCompatibility({
      ...event,
      details: {
        ...event.details,
        taskList: [],
      },
    }),
    /descriptor-only.*taskList/u,
  );
  assert.throws(
    () => assertGraphDocsGenerationLifecycleEventConsumerCompatibility({
      ...event,
      details: {
        ...event.details,
        redactionRequired: false,
      },
    }),
    /redactionRequired must be true/u,
  );
  assert.throws(
    () => assertGraphDocsGenerationLifecycleEventConsumerCompatibility({
      ...event,
      details: {
        ...event.details,
        accessToken: 'synthetic-secret-value',
      },
    }),
    /forbidden field/u,
  );
  const topLevelFieldMessage = captureThrownMessage(() => assertGraphDocsGenerationLifecycleEventConsumerCompatibility({
    ...event,
    accessToken: 'synthetic-secret-value',
  }));
  assert.match(topLevelFieldMessage, /forbidden field/u);
  assert.doesNotMatch(topLevelFieldMessage, /synthetic-secret-value/u);

  const topLevelValueMessage = captureThrownMessage(() => assertGraphDocsGenerationLifecycleEventConsumerCompatibility({
    ...event,
    note: 'Authorization: Bearer synthetic-secret-value',
  }));
  assert.match(topLevelValueMessage, /Forbidden sensitive pattern/u);
  assert.doesNotMatch(topLevelValueMessage, /synthetic-secret-value/u);
});

test('graph docs lifecycle dispatch design rejects runtime dispatch and telemetry products', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const baseOptions = {
    summary,
    traceId: 'trace-synthetic-graph-docs-dispatch-design',
    correlationId: 'correlation-synthetic-graph-docs-dispatch-design',
    taskId: 'task-synthetic-graph-docs-dispatch-design',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    createdAt: '2026-05-05T00:00:00.000Z',
  };

  assert.throws(
    () => createGraphDocsLifecycleDispatchDesign({
      ...baseOptions,
      runtimeDispatchEnabled: true,
    }),
    /runtimeDispatchEnabled must remain false/u,
  );
  assert.throws(
    () => createGraphDocsLifecycleDispatchDesign({
      ...baseOptions,
      externalTelemetryDispatchEnabled: true,
    }),
    /externalTelemetryDispatchEnabled must remain false/u,
  );
  assert.throws(
    () => createGraphDocsLifecycleDispatchDesign({
      ...baseOptions,
      subscriberRegistrationEnabled: true,
    }),
    /subscriberRegistrationEnabled must remain false/u,
  );
  assert.throws(
    () => createGraphDocsLifecycleDispatchDesign({
      ...baseOptions,
      eventPath: 'runs/graph-docs-event.json',
    }),
    /descriptor-only.*eventPath/u,
  );
  assert.throws(
    () => createGraphDocsLifecycleDispatchDesign({
      ...baseOptions,
      subscribers: [],
    }),
    /descriptor-only.*subscribers/u,
  );

  const fieldMessage = captureThrownMessage(() => createGraphDocsLifecycleDispatchDesign({
    ...baseOptions,
    details: {
      accessToken: 'synthetic-secret-value',
    },
  }));
  assert.match(fieldMessage, /forbidden field/u);
  assert.doesNotMatch(fieldMessage, /synthetic-secret-value/u);

  assert.throws(
    () => createGraphDocsLifecycleDispatchDesign({
      ...baseOptions,
      details: {
        durationMs: 123,
      },
    }),
    /fake metric field/u,
  );

  const design = createGraphDocsLifecycleDispatchDesign(baseOptions);
  design.items[0].runtimeDispatchEnabled = true;
  assert.throws(
    () => assertGraphDocsLifecycleDispatchDesignCompatibility(design),
    /runtimeDispatchEnabled must be false/u,
  );

  const unsafeDesign = createGraphDocsLifecycleDispatchDesign(baseOptions);
  unsafeDesign.items[0].lifecycleEvent.details.taskList = /** @type {any[]} */ ([]);
  assert.throws(
    () => assertGraphDocsLifecycleDispatchDesignCompatibility(unsafeDesign),
    /descriptor-only.*taskList/u,
  );
});

test('disabled graph docs lifecycle dispatch consumer returns blocked descriptor without dispatch', async (t) => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'graph-docs-disabled-dispatch-consumer-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const design = createGraphDocsLifecycleDispatchDesign({
    summary,
    traceId: 'trace-synthetic-graph-docs-disabled-dispatch-consumer',
    correlationId: 'correlation-synthetic-graph-docs-disabled-dispatch-consumer',
    taskId: 'task-synthetic-graph-docs-disabled-dispatch-consumer',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    createdAt: '2026-05-05T00:00:00.000Z',
  });
  const result = createDisabledGraphDocsLifecycleDispatchConsumerResult(design);

  assert.equal(assertDisabledGraphDocsLifecycleDispatchConsumerResultCompatibility(result), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(result), true);
  assert.equal(result.queryName, 'createDisabledGraphDocsLifecycleDispatchConsumerResult');
  assert.equal(result.artifactFamily, 'site-capability-graph-lifecycle-dispatch-consumer-result');
  assert.equal(result.redactionRequired, true);
  assert.equal(result.items[0].consumerMode, 'disabled-feature-flag');
  assert.equal(result.items[0].featureEnabled, false);
  assert.equal(result.items[0].result, 'blocked');
  assert.equal(result.items[0].reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(result.items[0].sourceLifecycleReasonCode, 'graph-docs-generation-failed');
  assert.equal(result.items[0].dispatchAllowed, false);
  assert.equal(result.items[0].runtimeDispatchEnabled, false);
  assert.equal(result.items[0].externalTelemetryDispatchEnabled, false);
  assert.equal(result.items[0].subscriberRegistrationEnabled, false);
  assert.equal(result.items[0].repoArtifactWriteEnabled, false);
  assert.equal(result.items[0].runtimeArtifactWriteEnabled, false);
  assert.equal(result.items[0].sessionMaterializationEnabled, false);
  assert.equal(result.items[0].lifecycleEvent.eventType, GRAPH_DOCS_GENERATION_EVENT_TYPE);
  assert.equal(Object.hasOwn(result.items[0], 'subscribers'), false);
  assert.equal(Object.hasOwn(result.items[0], 'telemetrySink'), false);
  assert.equal(Object.hasOwn(result.items[0], 'artifactPath'), false);

  const placement = createGraphDerivedArtifactPlacement({
    outputDir: tempDir,
    runId: 'synthetic-run-graph-docs-disabled-dispatch-consumer',
    artifactFamily: 'site-capability-graph-lifecycle-dispatch-consumer-result',
    artifactName: 'disabled-dispatch-consumer',
  });
  const writeResult = await writeGraphDerivedArtifactPair(result, placement);
  const artifactJson = await readFile(writeResult.artifactPath, 'utf8');
  const auditJson = await readFile(writeResult.auditPath, 'utf8');
  assert.doesNotMatch(artifactJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
  assert.doesNotMatch(auditJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
});

test('graph docs lifecycle dispatch preflight rejects telemetry subscribers and runtime writes before enablement', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const baseOptions = {
    summary,
    traceId: 'trace-synthetic-section-18-dispatch-preflight',
    correlationId: 'correlation-synthetic-section-18-dispatch-preflight',
    taskId: 'task-synthetic-section-18-dispatch-preflight',
    siteKey: 'synthetic.example',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    createdAt: '2026-05-05T00:00:00.000Z',
  };

  const preflight = createGraphDocsLifecycleDispatchPreflightContract(baseOptions);
  const item = preflight.items[0];

  assert.equal(assertGraphDocsLifecycleDispatchPreflightCompatibility(preflight), true);
  assert.equal(preflight.queryName, 'createGraphDocsLifecycleDispatchPreflightContract');
  assert.equal(preflight.artifactFamily, 'site-capability-graph-lifecycle-dispatch-preflight-contract');
  assert.equal(preflight.redactionRequired, true);
  assert.equal(item.preflightMode, 'contract-only');
  assert.equal(item.consumerMode, 'disabled');
  assert.equal(item.result, 'blocked');
  assert.equal(item.integrationAllowed, false);
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(
    item.requiredRuntimeGuard,
    'assertGraphDocsLifecycleDispatchPreflightCompatibility',
  );
  assert.equal(
    item.requiredSubscriberGuard,
    'assertGraphDocsLifecycleDispatchPreflightCompatibility',
  );
  assert.equal(item.forbiddenRuntimeOptions.includes('telemetrySink'), true);
  assert.equal(item.forbiddenRuntimeOptions.includes('subscribers'), true);
  assert.equal(item.forbiddenRuntimeOptions.includes('runtimeLog'), true);

  for (const fieldName of [
    'runtimeDispatchEnabled',
    'externalTelemetryEnabled',
    'externalTelemetryDispatchEnabled',
    'subscriberRegistrationEnabled',
    'runtimeSubscriberEnabled',
    'runtimeDispatchProducerEnabled',
    'repoArtifactWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'artifactWriteEnabled',
    'runtimeLogWriteEnabled',
    'sessionMaterializationEnabled',
  ]) {
    assert.equal(item[fieldName], false, `${fieldName} must be false before enablement`);
  }

  const design = createGraphDocsLifecycleDispatchDesign({
    ...baseOptions,
    preflight,
  });
  assert.equal(assertGraphDocsLifecycleDispatchDesignCompatibility(design), true);
  assert.equal(design.items[0].sourcePreflight.queryName, preflight.queryName);
  assert.equal(design.items[0].sourcePreflight.artifactFamily, preflight.artifactFamily);
  assert.equal(design.items[0].sourcePreflight.result, 'blocked');
  assert.equal(design.items[0].sourcePreflight.integrationAllowed, false);
  assert.equal(design.items[0].sourcePreflight.reasonCode, item.reasonCode);
  assert.equal(
    design.items[0].requiredPreflightGuard,
    'assertGraphDocsLifecycleDispatchPreflightCompatibility',
  );

  const result = createDisabledGraphDocsLifecycleDispatchConsumerResult(design);
  assert.equal(assertDisabledGraphDocsLifecycleDispatchConsumerResultCompatibility(result), true);
  assert.deepEqual(result.items[0].sourcePreflight, design.items[0].sourcePreflight);
  assert.equal(
    result.items[0].requiredPreflightGuard,
    'assertGraphDocsLifecycleDispatchPreflightCompatibility',
  );

  for (const fieldName of [
    'telemetrySink',
    'externalTelemetry',
    'externalTelemetrySink',
    'subscribers',
    'subscriberResults',
    'dispatchLifecycleEvent',
    'artifactPath',
    'runtimeLog',
    'logPath',
    'sessionView',
    'siteAdapter',
    'downloader',
    'taskList',
  ]) {
    assert.throws(
      () => createGraphDocsLifecycleDispatchPreflightContract({
        ...baseOptions,
        [fieldName]: {},
      }),
      new RegExp(`descriptor-only.*${fieldName}`, 'u'),
    );
  }

  const secretFieldMessage = captureThrownMessage(() => createGraphDocsLifecycleDispatchPreflightContract({
    ...baseOptions,
    details: {
      accessToken: 'synthetic-secret-value',
    },
  }));
  assert.match(secretFieldMessage, /forbidden field/u);
  assert.doesNotMatch(secretFieldMessage, /synthetic-secret-value/u);

  const secretValueMessage = captureThrownMessage(() => createGraphDocsLifecycleDispatchPreflightContract({
    ...baseOptions,
    details: {
      note: 'Authorization: Bearer synthetic-secret-value',
    },
  }));
  assert.match(secretValueMessage, /Forbidden sensitive pattern/u);
  assert.doesNotMatch(secretValueMessage, /synthetic-secret-value/u);
});

test('disabled Layer observability adapter handshake consumes preflight before runtime registration', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const baseOptions = {
    summary,
    traceId: 'trace-synthetic-section-18-adapter-handshake',
    correlationId: 'correlation-synthetic-section-18-adapter-handshake',
    taskId: 'task-synthetic-section-18-adapter-handshake',
    siteKey: 'synthetic.example',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    createdAt: '2026-05-05T00:00:00.000Z',
  };
  const preflight = createGraphDocsLifecycleDispatchPreflightContract(baseOptions);
  const preflightItem = preflight.items[0];

  const handshake = createDisabledGraphDocsLifecycleObservabilityAdapterHandshake({
    ...baseOptions,
    preflight,
  });
  const item = handshake.items[0];

  assert.equal(
    assertDisabledGraphDocsLifecycleObservabilityAdapterHandshakeCompatibility(handshake),
    true,
  );
  assert.equal(handshake.queryName, 'createDisabledGraphDocsLifecycleObservabilityAdapterHandshake');
  assert.equal(
    handshake.artifactFamily,
    'site-capability-graph-docs-lifecycle-observability-adapter-handshake',
  );
  assert.equal(handshake.redactionRequired, true);
  assert.equal(item.sourcePreflight.queryName, preflight.queryName);
  assert.equal(item.sourcePreflight.artifactFamily, preflight.artifactFamily);
  assert.equal(item.sourcePreflight.result, preflightItem.result);
  assert.equal(item.sourcePreflight.integrationAllowed, preflightItem.integrationAllowed);
  assert.equal(item.sourcePreflight.reasonCode, preflightItem.reasonCode);
  assert.equal(
    item.requiredPreflightGuard,
    'assertGraphDocsLifecycleDispatchPreflightCompatibility',
  );
  assert.equal(item.featureEnabled, false);
  assert.equal(item.result, 'blocked');
  assert.equal(item.registrationAllowed, false);
  assert.equal(item.producerRegistrationAllowed, false);
  assert.equal(item.subscriberRegistrationAllowed, false);
  assert.equal(item.telemetryDispatchAllowed, false);
  assert.equal(item.runtimeDispatchAllowed, false);
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');

  for (const fieldName of [
    'runtimeDispatchEnabled',
    'externalTelemetryEnabled',
    'externalTelemetryDispatchEnabled',
    'subscriberRegistrationEnabled',
    'runtimeSubscriberEnabled',
    'runtimeDispatchProducerEnabled',
    'repoArtifactWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'artifactWriteEnabled',
    'runtimeLogWriteEnabled',
    'sessionMaterializationEnabled',
  ]) {
    assert.equal(item[fieldName], false, `${fieldName} must be false before runtime registration`);
  }

  for (const fieldName of [
    'subscriber',
    'registerSubscriber',
    'producerRegistration',
    'telemetrySink',
    'externalTelemetrySink',
    'runtimeDispatch',
    'artifactPath',
    'runtimeLog',
    'logPath',
    'sessionView',
    'siteAdapter',
    'downloader',
    'taskList',
  ]) {
    const message = captureThrownMessage(() => createDisabledGraphDocsLifecycleObservabilityAdapterHandshake({
      ...baseOptions,
      preflight,
      [fieldName]: {
        value: 'synthetic-secret-value',
      },
    }));
    assert.match(message, /descriptor-only/u);
    assert.match(message, new RegExp(fieldName, 'u'));
    assert.doesNotMatch(message, /synthetic-secret-value/u);
  }
});

test('disabled Layer observability consumer integration design remains no-op after handshake', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const baseOptions = {
    summary,
    traceId: 'trace-synthetic-section-18-consumer-integration',
    correlationId: 'correlation-synthetic-section-18-consumer-integration',
    taskId: 'task-synthetic-section-18-consumer-integration',
    siteKey: 'synthetic.example',
    graphVersion: 'synthetic-section-18-source-handshake-graph',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    createdAt: '2026-05-05T00:00:00.000Z',
  };
  const preflight = createGraphDocsLifecycleDispatchPreflightContract(baseOptions);
  const ignoredOptionsPreflight = createGraphDocsLifecycleDispatchPreflightContract({
    ...baseOptions,
    graphVersion: 'synthetic-section-18-ignored-options-preflight-graph',
  });
  const preflightItem = preflight.items[0];
  const handshake = createDisabledGraphDocsLifecycleObservabilityAdapterHandshake({
    ...baseOptions,
    preflight,
    adapterName: 'synthetic-observability-adapter-from-source-handshake',
  });
  const handshakeItem = handshake.items[0];

  const design = createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign({
    ...baseOptions,
    preflight: ignoredOptionsPreflight,
    handshake,
  });
  const item = design.items[0];

  assert.equal(
    assertDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesignCompatibility(design),
    true,
  );
  assert.equal(
    design.queryName,
    'createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign',
  );
  assert.equal(
    design.artifactFamily,
    'site-capability-graph-docs-lifecycle-observability-consumer-integration-design',
  );
  assert.equal(design.graphVersion, handshake.graphVersion);
  assert.notEqual(design.graphVersion, ignoredOptionsPreflight.graphVersion);
  assert.equal(design.redactionRequired, true);
  assert.equal(item.sourceHandshake.queryName, handshake.queryName);
  assert.equal(item.sourceHandshake.artifactFamily, handshake.artifactFamily);
  assert.equal(item.sourceHandshake.adapterName, handshakeItem.adapterName);
  assert.equal(item.sourceHandshake.adapterName, 'synthetic-observability-adapter-from-source-handshake');
  assert.equal(item.sourceHandshake.result, handshakeItem.result);
  assert.equal(item.sourceHandshake.reasonCode, handshakeItem.reasonCode);
  assert.equal(item.sourceHandshake.integrationAllowed, handshakeItem.integrationAllowed);
  assert.equal(item.sourcePreflight.queryName, preflight.queryName);
  assert.equal(item.sourcePreflight.artifactFamily, preflight.artifactFamily);
  assert.equal(item.sourcePreflight.result, preflightItem.result);
  assert.equal(item.sourcePreflight.reasonCode, preflightItem.reasonCode);
  assert.equal(item.sourcePreflight.integrationAllowed, preflightItem.integrationAllowed);
  assert.equal(
    item.requiredHandshakeGuard,
    'assertDisabledGraphDocsLifecycleObservabilityAdapterHandshakeCompatibility',
  );
  assert.equal(
    item.requiredPreflightGuard,
    'assertGraphDocsLifecycleDispatchPreflightCompatibility',
  );
  assert.equal(item.featureEnabled, false);
  assert.equal(item.result, 'blocked');
  assert.equal(item.consumerIntegrationEnabled, false);
  assert.equal(item.runtimeConsumerEnabled, false);
  assert.equal(item.registrationAllowed, false);
  assert.equal(item.producerRegistrationAllowed, false);
  assert.equal(item.subscriberRegistrationAllowed, false);
  assert.equal(item.telemetryDispatchAllowed, false);
  assert.equal(item.runtimeDispatchAllowed, false);
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');

  for (const fieldName of [
    'runtimeDispatchEnabled',
    'externalTelemetryEnabled',
    'externalTelemetryDispatchEnabled',
    'subscriberRegistrationEnabled',
    'runtimeSubscriberEnabled',
    'runtimeDispatchProducerEnabled',
    'repoArtifactWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'artifactWriteEnabled',
    'runtimeLogWriteEnabled',
    'sessionMaterializationEnabled',
  ]) {
    assert.equal(item[fieldName], false, `${fieldName} must remain false after handshake`);
  }

  for (const fieldName of [
    'consumer',
    'runtimeConsumer',
    'subscriber',
    'registerSubscriber',
    'producerRegistration',
    'telemetrySink',
    'externalTelemetrySink',
    'event',
    'payload',
    'runtimeDispatch',
    'runtimePayload',
    'sourceRuntimePayload',
    'artifactPath',
    'runtimeLog',
    'logPath',
    'sessionView',
    'siteAdapter',
    'siteAdapterPayload',
    'downloader',
    'taskList',
  ]) {
    const message = captureThrownMessage(() => createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign({
      ...baseOptions,
      preflight,
      handshake,
      [fieldName]: {
        value: 'synthetic-secret-value',
      },
    }));
    assert.match(message, /descriptor-only/u);
    assert.match(message, new RegExp(fieldName, 'u'));
    assert.doesNotMatch(message, /synthetic-secret-value/u);
  }
});

test('graph docs lifecycle observability adapter wiring boundary consumes disabled consumer integration descriptor', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const baseOptions = {
    summary,
    traceId: 'trace-synthetic-section-18-adapter-wiring-boundary',
    correlationId: 'correlation-synthetic-section-18-adapter-wiring-boundary',
    taskId: 'task-synthetic-section-18-adapter-wiring-boundary',
    siteKey: 'synthetic.example',
    graphVersion: 'synthetic-section-18-source-boundary-graph',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    createdAt: '2026-05-05T00:00:00.000Z',
  };
  const preflight = createGraphDocsLifecycleDispatchPreflightContract(baseOptions);
  const ignoredOptionsPreflight = createGraphDocsLifecycleDispatchPreflightContract({
    ...baseOptions,
    graphVersion: 'synthetic-section-18-ignored-boundary-options-preflight-graph',
  });
  const handshake = createDisabledGraphDocsLifecycleObservabilityAdapterHandshake({
    ...baseOptions,
    preflight,
    adapterName: 'synthetic-observability-adapter-from-boundary-source',
  });
  const ignoredOptionsHandshake = createDisabledGraphDocsLifecycleObservabilityAdapterHandshake({
    ...baseOptions,
    preflight: ignoredOptionsPreflight,
    adapterName: 'synthetic-observability-adapter-from-ignored-options',
  });
  const consumerIntegrationDesign = createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign({
    ...baseOptions,
    preflight: ignoredOptionsPreflight,
    handshake,
    consumerName: 'synthetic-observability-consumer-from-boundary-source',
  });
  const consumerIntegrationItem = consumerIntegrationDesign.items[0];
  const boundary = createGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign({
    ...baseOptions,
    graphVersion: 'synthetic-section-18-ignored-boundary-options-graph',
    preflight: ignoredOptionsPreflight,
    handshake: ignoredOptionsHandshake,
    consumerIntegrationDesign,
    consumerName: 'synthetic-observability-consumer-from-ignored-options',
    adapterName: 'synthetic-observability-adapter-from-ignored-options',
  });
  const item = boundary.items[0];
  const sourceConsumerIntegrationDesign = item.sourceDesign;

  assert.equal(
    assertGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignCompatibility(boundary),
    true,
  );
  assert.equal(
    assertDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesignCompatibility(
      consumerIntegrationDesign,
    ),
    true,
  );
  assert.equal(
    boundary.queryName,
    'createGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign',
  );
  assert.equal(
    boundary.artifactFamily,
    'site-capability-graph-docs-lifecycle-observability-adapter-wiring-boundary-design',
  );
  assert.equal(boundary.redactionRequired, true);
  assert.equal(boundary.graphVersion, consumerIntegrationDesign.graphVersion);
  assert.notEqual(boundary.graphVersion, ignoredOptionsPreflight.graphVersion);
  assert.notEqual(boundary.graphVersion, 'synthetic-section-18-ignored-boundary-options-graph');
  assert.equal(item.queryName, boundary.queryName);
  assert.equal(item.artifactFamily, boundary.artifactFamily);
  assert.equal(item.redactionRequired, true);
  assert.equal(item.consumerName, consumerIntegrationItem.consumerName);
  assert.equal(item.consumerName, 'synthetic-observability-consumer-from-boundary-source');
  assert.equal(item.adapterName, handshake.items[0].adapterName);
  assert.equal(item.adapterName, 'synthetic-observability-adapter-from-boundary-source');
  assert.equal(
    item.requiredHandshakeGuard,
    'assertDisabledGraphDocsLifecycleObservabilityAdapterHandshakeCompatibility',
  );
  assert.equal(
    item.requiredPreflightGuard,
    'assertGraphDocsLifecycleDispatchPreflightCompatibility',
  );

  assert.equal(sourceConsumerIntegrationDesign.queryName, consumerIntegrationDesign.queryName);
  assert.equal(sourceConsumerIntegrationDesign.artifactFamily, consumerIntegrationDesign.artifactFamily);
  assert.equal(sourceConsumerIntegrationDesign.graphVersion, consumerIntegrationDesign.graphVersion);
  assert.equal(sourceConsumerIntegrationDesign.redactionRequired, true);
  assert.equal(sourceConsumerIntegrationDesign.integrationMode, consumerIntegrationItem.integrationMode);
  assert.equal(sourceConsumerIntegrationDesign.consumerName, consumerIntegrationItem.consumerName);
  assert.equal(sourceConsumerIntegrationDesign.result, consumerIntegrationItem.result);
  assert.equal(sourceConsumerIntegrationDesign.reasonCode, consumerIntegrationItem.reasonCode);
  assert.equal(
    sourceConsumerIntegrationDesign.consumerIntegrationEnabled,
    consumerIntegrationItem.consumerIntegrationEnabled,
  );
  assert.equal(
    sourceConsumerIntegrationDesign.runtimeConsumerEnabled,
    consumerIntegrationItem.runtimeConsumerEnabled,
  );
  assert.equal(item.sourceHandshake.queryName, handshake.queryName);
  assert.equal(item.sourceHandshake.artifactFamily, handshake.artifactFamily);
  assert.equal(item.sourceHandshake.adapterName, handshake.items[0].adapterName);
  assert.equal(item.sourcePreflight.queryName, preflight.queryName);
  assert.equal(item.sourcePreflight.artifactFamily, preflight.artifactFamily);
  assert.equal(item.sourcePreflight.graphVersion, preflight.graphVersion);
  assert.equal(item.sourcePreflight.result, preflight.items[0].result);
  assert.equal(item.sourcePreflight.reasonCode, preflight.items[0].reasonCode);
  assert.equal(item.sourcePreflight.integrationAllowed, preflight.items[0].integrationAllowed);

  for (const fieldName of [
    'registrationAllowed',
    'producerRegistrationAllowed',
    'subscriberRegistrationAllowed',
    'telemetryDispatchAllowed',
    'runtimeDispatchAllowed',
    'runtimeDispatchEnabled',
    'externalTelemetryEnabled',
    'externalTelemetryDispatchEnabled',
    'subscriberRegistrationEnabled',
    'runtimeSubscriberEnabled',
    'runtimeDispatchProducerEnabled',
    'repoArtifactWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'artifactWriteEnabled',
    'runtimeLogWriteEnabled',
    'sessionMaterializationEnabled',
  ]) {
    assert.equal(item[fieldName], false, `${fieldName} must remain false at the wiring boundary`);
  }

  for (const fieldName of [
    'producer',
    'subscriber',
    'registerSubscriber',
    'dispatch',
    'dispatchLifecycleEvent',
    'telemetrySink',
    'externalTelemetrySink',
    'event',
    'payload',
    'runtimePayload',
    'sourceRuntimePayload',
    'siteAdapterPayload',
    'sessionView',
    'siteAdapter',
    'downloader',
    'taskList',
    'artifactPath',
    'logPath',
  ]) {
    const message = captureThrownMessage(() => createGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign({
      ...baseOptions,
      consumerIntegrationDesign,
      [fieldName]: {
        value: 'synthetic-secret-value',
      },
    }));
    assert.match(message, /descriptor-only/u);
    assert.match(message, new RegExp(fieldName, 'u'));
    assert.doesNotMatch(message, /synthetic-secret-value/u);
  }

  const rendered = JSON.stringify(boundary);
  assert.doesNotMatch(rendered, /dispatchLifecycleEvent|synthetic-secret-value/u);
  assert.doesNotMatch(rendered, /artifactPath|logPath/u);
});

test('graph docs lifecycle observability runtime implementation preflight stays disabled before registration', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const baseOptions = {
    summary,
    traceId: 'trace-synthetic-section-18-runtime-implementation-preflight',
    correlationId: 'correlation-synthetic-section-18-runtime-implementation-preflight',
    taskId: 'task-synthetic-section-18-runtime-implementation-preflight',
    siteKey: 'synthetic.example',
    graphVersion: 'synthetic-section-18-runtime-source-boundary-graph',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    createdAt: '2026-05-05T00:00:00.000Z',
  };
  const preflight = createGraphDocsLifecycleDispatchPreflightContract(baseOptions);
  const ignoredOptionsPreflight = createGraphDocsLifecycleDispatchPreflightContract({
    ...baseOptions,
    graphVersion: 'synthetic-section-18-runtime-ignored-options-preflight-graph',
  });
  const handshake = createDisabledGraphDocsLifecycleObservabilityAdapterHandshake({
    ...baseOptions,
    preflight,
    adapterName: 'synthetic-observability-adapter-from-runtime-source-boundary',
  });
  const ignoredOptionsHandshake = createDisabledGraphDocsLifecycleObservabilityAdapterHandshake({
    ...baseOptions,
    preflight: ignoredOptionsPreflight,
    adapterName: 'synthetic-observability-adapter-from-runtime-ignored-options',
  });
  const consumerIntegrationDesign = createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign({
    ...baseOptions,
    preflight: ignoredOptionsPreflight,
    handshake,
    consumerName: 'synthetic-observability-consumer-from-runtime-source-boundary',
  });
  const ignoredOptionsConsumerIntegrationDesign = createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign({
    ...baseOptions,
    preflight: ignoredOptionsPreflight,
    handshake: ignoredOptionsHandshake,
    consumerName: 'synthetic-observability-consumer-from-runtime-ignored-options',
  });
  const boundary = createGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign({
    ...baseOptions,
    graphVersion: 'synthetic-section-18-runtime-ignored-boundary-options-graph',
    preflight: ignoredOptionsPreflight,
    handshake: ignoredOptionsHandshake,
    consumerIntegrationDesign,
    consumerName: 'synthetic-observability-consumer-from-runtime-ignored-options',
    adapterName: 'synthetic-observability-adapter-from-runtime-ignored-options',
    boundaryName: 'synthetic-observability-boundary-from-runtime-ignored-options',
    adapterBoundaryName: 'synthetic-observability-boundary-from-runtime-source-boundary',
  });
  const ignoredOptionsBoundary = createGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign({
    ...baseOptions,
    graphVersion: 'synthetic-section-18-runtime-ignored-source-boundary-graph',
    preflight: ignoredOptionsPreflight,
    handshake: ignoredOptionsHandshake,
    consumerIntegrationDesign: ignoredOptionsConsumerIntegrationDesign,
    consumerName: 'synthetic-observability-consumer-from-runtime-ignored-options',
    adapterName: 'synthetic-observability-adapter-from-runtime-ignored-options',
    boundaryName: 'synthetic-observability-boundary-from-runtime-ignored-options',
    adapterBoundaryName: 'synthetic-observability-boundary-from-runtime-ignored-options',
  });

  const runtimePreflight = createGraphDocsLifecycleObservabilityRuntimeImplementationPreflight(
    boundary,
    {
      ...baseOptions,
      graphVersion: 'synthetic-section-18-runtime-ignored-options-graph',
      preflight: ignoredOptionsPreflight,
      handshake: ignoredOptionsHandshake,
      consumerIntegrationDesign: ignoredOptionsConsumerIntegrationDesign,
      boundary: ignoredOptionsBoundary,
      sourceBoundary: ignoredOptionsBoundary,
      consumerName: 'synthetic-observability-consumer-from-runtime-ignored-options',
      adapterName: 'synthetic-observability-adapter-from-runtime-ignored-options',
      boundaryName: 'synthetic-observability-boundary-from-runtime-ignored-options',
      adapterBoundaryName: 'synthetic-observability-boundary-from-runtime-ignored-options',
    },
  );
  const item = runtimePreflight.items[0];
  const sourceBoundary = item.sourceBoundary;

  assert.equal(
    assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightCompatibility(
      runtimePreflight,
    ),
    true,
  );
  assert.equal(
    assertGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignCompatibility(boundary),
    true,
  );
  assert.equal(
    runtimePreflight.queryName,
    'createGraphDocsLifecycleObservabilityRuntimeImplementationPreflight',
  );
  assert.equal(
    runtimePreflight.artifactFamily,
    'site-capability-graph-docs-lifecycle-observability-runtime-implementation-preflight',
  );
  assert.equal(runtimePreflight.redactionRequired, true);
  assert.equal(runtimePreflight.graphVersion, boundary.graphVersion);
  assert.notEqual(runtimePreflight.graphVersion, 'synthetic-section-18-runtime-ignored-options-graph');
  assert.equal(item.queryName, runtimePreflight.queryName);
  assert.equal(item.artifactFamily, runtimePreflight.artifactFamily);
  assert.equal(item.redactionRequired, true);
  assert.equal(item.consumerName, 'synthetic-observability-consumer-from-runtime-source-boundary');
  assert.equal(item.adapterName, 'synthetic-observability-adapter-from-runtime-source-boundary');
  assert.equal(
    item.boundaryName ?? item.adapterBoundaryName,
    'synthetic-observability-boundary-from-runtime-source-boundary',
  );
  assert.notEqual(item.consumerName, 'synthetic-observability-consumer-from-runtime-ignored-options');
  assert.notEqual(item.adapterName, 'synthetic-observability-adapter-from-runtime-ignored-options');
  assert.notEqual(
    item.boundaryName ?? item.adapterBoundaryName,
    'synthetic-observability-boundary-from-runtime-ignored-options',
  );
  assert.equal(sourceBoundary.queryName, boundary.queryName);
  assert.equal(sourceBoundary.artifactFamily, boundary.artifactFamily);
  assert.equal(sourceBoundary.graphVersion, boundary.graphVersion);
  assert.equal(sourceBoundary.redactionRequired, true);
  assert.equal(sourceBoundary.boundaryMode, boundary.items[0].boundaryMode);
  assert.equal(sourceBoundary.consumerName, boundary.items[0].consumerName);
  assert.equal(sourceBoundary.adapterName, boundary.items[0].adapterName);
  assert.equal(
    sourceBoundary.boundaryName ?? sourceBoundary.adapterBoundaryName,
    boundary.items[0].boundaryName ?? boundary.items[0].adapterBoundaryName,
  );
  assert.equal(item.sourceDesign.queryName, boundary.items[0].sourceDesign.queryName);
  assert.equal(item.sourceDesign.artifactFamily, boundary.items[0].sourceDesign.artifactFamily);
  assert.equal(item.sourceDesign.consumerName, boundary.items[0].sourceDesign.consumerName);
  assert.equal(item.sourceDesign.result, boundary.items[0].sourceDesign.result);
  assert.equal(item.sourceHandshake.queryName, boundary.items[0].sourceHandshake.queryName);
  assert.equal(item.sourceHandshake.artifactFamily, boundary.items[0].sourceHandshake.artifactFamily);
  assert.equal(item.sourceHandshake.adapterName, boundary.items[0].sourceHandshake.adapterName);
  assert.equal(item.sourceHandshake.result, boundary.items[0].sourceHandshake.result);
  assert.equal(item.sourcePreflight.queryName, boundary.items[0].sourcePreflight.queryName);
  assert.equal(item.sourcePreflight.artifactFamily, boundary.items[0].sourcePreflight.artifactFamily);
  assert.equal(item.sourcePreflight.graphVersion, boundary.items[0].sourcePreflight.graphVersion);
  assert.equal(item.sourcePreflight.result, boundary.items[0].sourcePreflight.result);
  assert.equal(item.sourcePreflight.reasonCode, boundary.items[0].sourcePreflight.reasonCode);
  assert.equal(item.sourcePreflight.integrationAllowed, boundary.items[0].sourcePreflight.integrationAllowed);
  assert.equal(
    item.requiredBoundaryGuard,
    'assertGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignCompatibility',
  );
  assert.equal(
    item.requiredRuntimeImplementationPreflightGuard,
    'assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightCompatibility',
  );
  assert.equal(
    item.requiredGuards.boundaryGuard,
    'assertGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignCompatibility',
  );
  assert.equal(
    item.requiredGuards.runtimeImplementationPreflightGuard,
    'assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightCompatibility',
  );

  for (const fieldName of [
    'producerRegistrationOwner',
    'subscriberRegistrationOwner',
    'telemetryDispatchGate',
    'dispatchWriteGate',
    'logWriteGate',
    'artifactWriteGate',
  ]) {
    assert.notEqual(item[fieldName], undefined, `${fieldName} must exist before registration`);
    if (typeof item[fieldName] === 'boolean') {
      assert.equal(item[fieldName], false, `${fieldName} must be disabled before registration`);
    } else {
      assert.match(String(item[fieldName]), /disabled|false|blocked/u);
    }
  }

  for (const fieldName of [
    'featureEnabled',
    'runtimeImplementationEnabled',
    'runtimeRegistrationEnabled',
    'registrationAllowed',
    'producerRegistrationAllowed',
    'subscriberRegistrationAllowed',
    'telemetryDispatchAllowed',
    'runtimeDispatchAllowed',
    'runtimeDispatchEnabled',
    'externalTelemetryEnabled',
    'externalTelemetryDispatchEnabled',
    'subscriberRegistrationEnabled',
    'runtimeSubscriberEnabled',
    'runtimeDispatchProducerEnabled',
    'repoArtifactWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'artifactWriteEnabled',
    'runtimeLogWriteEnabled',
    'sessionMaterializationEnabled',
  ]) {
    assert.equal(item[fieldName], false, `${fieldName} must remain false before runtime registration`);
  }

  for (const fieldName of [
    'registration',
    'producerRegistration',
    'subscriberRegistration',
    'producer',
    'subscriber',
    'registerProducer',
    'registerSubscriber',
    'dispatch',
    'dispatchLifecycleEvent',
    'lifecycleEvent',
    'telemetrySink',
    'externalTelemetry',
    'externalTelemetrySink',
    'event',
    'payload',
    'runtimePayload',
    'sourceRuntimePayload',
    'telemetryPayload',
    'dispatchPayload',
    'writePayload',
    'siteAdapterPayload',
    'sessionView',
    'siteAdapter',
    'downloader',
    'taskList',
    'artifactPayload',
    'artifactPath',
    'logPath',
  ]) {
    const message = captureThrownMessage(
      () => createGraphDocsLifecycleObservabilityRuntimeImplementationPreflight(boundary, {
        [fieldName]: {
          value: 'synthetic-secret-value',
        },
      }),
    );
    assert.match(message, /descriptor-only/u);
    assert.match(message, new RegExp(fieldName, 'u'));
    assert.doesNotMatch(message, /synthetic-secret-value/u);
  }

  const rendered = JSON.stringify(runtimePreflight);
  assert.doesNotMatch(rendered, /synthetic-secret-value/u);
  assert.doesNotMatch(rendered, /"dispatchLifecycleEvent"\s*:/u);
  assert.doesNotMatch(rendered, /"telemetrySink"\s*:/u);
  assert.doesNotMatch(rendered, /"runtimePayload"\s*:/u);
  assert.doesNotMatch(rendered, /"artifactPath"\s*:/u);
  assert.doesNotMatch(rendered, /"logPath"\s*:/u);
  assert.doesNotMatch(rendered, /"sessionView"\s*:/u);
});

test('graph docs lifecycle observability registration owner preflight stays disabled before registration', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const baseOptions = {
    summary,
    traceId: 'trace-synthetic-section-18-registration-owner-preflight',
    correlationId: 'correlation-synthetic-section-18-registration-owner-preflight',
    taskId: 'task-synthetic-section-18-registration-owner-preflight',
    siteKey: 'synthetic.example',
    graphVersion: 'synthetic-section-18-registration-owner-source-graph',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    createdAt: '2026-05-05T00:00:00.000Z',
  };
  const runtimePreflight = createGraphDocsLifecycleObservabilityRuntimeImplementationPreflight(baseOptions);
  const ignoredRuntimePreflight = createGraphDocsLifecycleObservabilityRuntimeImplementationPreflight({
    ...baseOptions,
    graphVersion: 'synthetic-section-18-registration-owner-ignored-graph',
  });

  const ownerPreflight = createGraphDocsLifecycleObservabilityRegistrationOwnerPreflight(
    runtimePreflight,
    {
      ...baseOptions,
      graphVersion: 'synthetic-section-18-registration-owner-ignored-options-graph',
      runtimeImplementationPreflight: ignoredRuntimePreflight,
      sourceRuntimeImplementationPreflight: ignoredRuntimePreflight,
      preflightName: 'synthetic-registration-owner-preflight',
    },
  );
  const item = ownerPreflight.items[0];

  assert.equal(
    assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility(ownerPreflight),
    true,
  );
  assert.equal(
    assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightCompatibility(runtimePreflight),
    true,
  );
  assert.equal(
    ownerPreflight.queryName,
    'createGraphDocsLifecycleObservabilityRegistrationOwnerPreflight',
  );
  assert.equal(
    ownerPreflight.artifactFamily,
    'site-capability-graph-docs-lifecycle-observability-registration-owner-preflight',
  );
  assert.equal(ownerPreflight.redactionRequired, true);
  assert.equal(ownerPreflight.graphVersion, runtimePreflight.graphVersion);
  assert.notEqual(ownerPreflight.graphVersion, 'synthetic-section-18-registration-owner-ignored-options-graph');
  assert.equal(item.ownerPreflightMode, 'descriptor-only');
  assert.equal(item.registrationOwnerMode, 'disabled');
  assert.equal(item.runtimeMode, 'not-registered');
  assert.equal(item.result, 'blocked');
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(item.consumerName, runtimePreflight.items[0].consumerName);
  assert.equal(item.adapterName, runtimePreflight.items[0].adapterName);
  assert.equal(item.preflightName, 'synthetic-registration-owner-preflight');
  assert.equal(
    item.sourceRuntimeImplementationPreflight.queryName,
    runtimePreflight.queryName,
  );
  assert.equal(
    item.sourceRuntimeImplementationPreflight.artifactFamily,
    runtimePreflight.artifactFamily,
  );
  assert.equal(
    item.sourceRuntimeImplementationPreflight.graphVersion,
    runtimePreflight.graphVersion,
  );
  assert.equal(item.sourceRuntimeImplementationPreflight.result, runtimePreflight.items[0].result);
  assert.equal(item.sourceRuntimeImplementationPreflight.reasonCode, runtimePreflight.items[0].reasonCode);
  assert.equal(
    item.requiredRuntimeImplementationPreflightGuard,
    'assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightCompatibility',
  );
  assert.equal(
    item.requiredRegistrationOwnerPreflightGuard,
    'assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility',
  );
  assert.equal(
    item.requiredGuards.runtimeImplementationPreflightGuard,
    'assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightCompatibility',
  );
  assert.equal(
    item.requiredGuards.registrationOwnerPreflightGuard,
    'assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility',
  );

  for (const fieldName of [
    'producerRegistrationOwner',
    'subscriberRegistrationOwner',
    'telemetryDispatchGate',
    'dispatchWriteGate',
    'logWriteGate',
    'artifactWriteGate',
  ]) {
    assert.equal(item[fieldName], runtimePreflight.items[0].registrationOwnershipPlan[fieldName]);
    assert.equal(item[fieldName], item.registrationOwnershipPlan[fieldName]);
  }

  for (const ownerName of ['producerOwner', 'subscriberOwner']) {
    assert.equal(item.registrationOwners[ownerName].registrationAllowed, false);
    assert.equal(item.registrationOwners[ownerName].registrationEnabled, false);
    assert.match(item.registrationOwners[ownerName].guard, /RegistrationAllowed=false/u);
  }

  for (const fieldName of [
    'featureEnabled',
    'runtimeImplementationEnabled',
    'runtimeRegistrationEnabled',
    'registrationAllowed',
    'producerRegistrationAllowed',
    'subscriberRegistrationAllowed',
    'telemetryDispatchAllowed',
    'runtimeDispatchAllowed',
    'runtimeDispatchEnabled',
    'externalTelemetryEnabled',
    'externalTelemetryDispatchEnabled',
    'subscriberRegistrationEnabled',
    'runtimeSubscriberEnabled',
    'runtimeDispatchProducerEnabled',
    'repoArtifactWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'artifactWriteEnabled',
    'runtimeLogWriteEnabled',
    'sessionMaterializationEnabled',
  ]) {
    assert.equal(item[fieldName], false, `${fieldName} must remain false before registration owner wiring`);
  }

  for (const fieldName of [
    'producerRegistrationAllowed',
    'subscriberRegistrationAllowed',
    'telemetryDispatchAllowed',
    'runtimeDispatchAllowed',
    'runtimeLogWriteEnabled',
  ]) {
    assert.throws(
      () => createGraphDocsLifecycleObservabilityRegistrationOwnerPreflight(runtimePreflight, {
        [fieldName]: true,
      }),
      /must remain false/u,
    );
  }

  for (const fieldName of [
    'registration',
    'producerRegistration',
    'subscriberRegistration',
    'registerProducer',
    'registerSubscriber',
    'producer',
    'subscriber',
    'telemetrySink',
    'externalTelemetry',
    'dispatchLifecycleEvent',
    'lifecycleEvent',
    'runtimePayload',
    'sessionView',
    'siteAdapter',
    'downloader',
    'artifactPayload',
    'artifactPath',
    'logPath',
  ]) {
    const message = captureThrownMessage(
      () => createGraphDocsLifecycleObservabilityRegistrationOwnerPreflight(runtimePreflight, {
        [fieldName]: {
          value: 'synthetic-secret-value',
        },
      }),
    );
    assert.match(message, /descriptor-only/u);
    assert.match(message, new RegExp(fieldName, 'u'));
    assert.doesNotMatch(message, /synthetic-secret-value/u);
  }

  const rendered = JSON.stringify(ownerPreflight);
  assert.doesNotMatch(rendered, /synthetic-secret-value/u);
  assert.doesNotMatch(rendered, /"registerProducer"\s*:/u);
  assert.doesNotMatch(rendered, /"registerSubscriber"\s*:/u);
  assert.doesNotMatch(rendered, /"telemetrySink"\s*:/u);
  assert.doesNotMatch(rendered, /"runtimePayload"\s*:/u);
  assert.doesNotMatch(rendered, /"artifactPath"\s*:/u);
  assert.doesNotMatch(rendered, /"sessionView"\s*:/u);
});

test('graph docs lifecycle observability registration owner handoff guard stays disabled before runtime registration', async () => {
  const { create, assertCompatibility } =
    loadGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardApi();
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const baseOptions = {
    summary,
    traceId: 'trace-synthetic-section-18-registration-owner-handoff',
    correlationId: 'correlation-synthetic-section-18-registration-owner-handoff',
    taskId: 'task-synthetic-section-18-registration-owner-handoff',
    siteKey: 'synthetic.example',
    graphVersion: 'synthetic-section-18-registration-owner-handoff-source-graph',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    createdAt: '2026-05-05T00:00:00.000Z',
  };
  const runtimePreflight = createGraphDocsLifecycleObservabilityRuntimeImplementationPreflight(
    baseOptions,
  );
  const ownerPreflight = createGraphDocsLifecycleObservabilityRegistrationOwnerPreflight(
    runtimePreflight,
    {
      ...baseOptions,
      preflightName: 'synthetic-registration-owner-handoff-source-preflight',
    },
  );

  const handoffGuard = create(ownerPreflight, {
    handoffName: 'synthetic-registration-owner-handoff-guard',
  });
  const item = handoffGuard.items[0];

  assert.equal(assertCompatibility(handoffGuard), true);
  assert.equal(
    assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility(ownerPreflight),
    true,
  );
  assert.equal(
    handoffGuard.queryName,
    'createGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard',
  );
  assert.equal(
    handoffGuard.artifactFamily,
    'site-capability-graph-docs-lifecycle-observability-registration-owner-handoff-guard',
  );
  assert.equal(handoffGuard.redactionRequired, true);
  assert.equal(handoffGuard.graphVersion, ownerPreflight.graphVersion);
  assert.equal(item.handoffName, 'synthetic-registration-owner-handoff-guard');
  assert.equal(item.handoffMode ?? item.guardMode, 'descriptor-only');
  assert.equal(item.result, 'blocked');
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(item.consumerName, ownerPreflight.items[0].consumerName);
  assert.equal(item.adapterName, ownerPreflight.items[0].adapterName);
  assert.equal(
    item.requiredRegistrationOwnerPreflightGuard,
    'assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility',
  );
  assert.equal(
    item.requiredRegistrationOwnerHandoffGuard,
    'assertGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardCompatibility',
  );
  assert.equal(
    item.requiredGuards.registrationOwnerPreflightGuard,
    'assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility',
  );
  assert.equal(
    item.requiredGuards.registrationOwnerHandoffGuard,
    'assertGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardCompatibility',
  );
  assert.equal(
    item.sourceRegistrationOwnerPreflight.queryName,
    ownerPreflight.queryName,
  );
  assert.equal(
    item.sourceRegistrationOwnerPreflight.artifactFamily,
    ownerPreflight.artifactFamily,
  );
  assert.equal(
    item.sourceRegistrationOwnerPreflight.graphVersion,
    ownerPreflight.graphVersion,
  );
  assert.equal(item.sourceRegistrationOwnerPreflight.result, ownerPreflight.items[0].result);
  assert.equal(item.sourceRegistrationOwnerPreflight.reasonCode, ownerPreflight.items[0].reasonCode);

  for (const fieldName of [
    'producerRegistrationOwner',
    'subscriberRegistrationOwner',
    'telemetryDispatchGate',
    'dispatchWriteGate',
    'logWriteGate',
    'artifactWriteGate',
  ]) {
    assert.equal(item[fieldName], ownerPreflight.items[0].registrationOwnershipPlan[fieldName]);
    assert.equal(item[fieldName], item.registrationOwnershipPlan[fieldName]);
  }

  for (const fieldName of [
    'featureEnabled',
    'runtimeImplementationEnabled',
    'runtimeRegistrationEnabled',
    'registrationAllowed',
    'producerRegistrationAllowed',
    'producerRegistrationEnabled',
    'subscriberRegistrationAllowed',
    'telemetryDispatchAllowed',
    'telemetryDispatchEnabled',
    'runtimeDispatchAllowed',
    'dispatchWriteAllowed',
    'dispatchWriteEnabled',
    'logWriteAllowed',
    'logWriteEnabled',
    'artifactWriteAllowed',
    'externalTelemetryEnabled',
    'runtimeDispatchEnabled',
    'externalTelemetryDispatchEnabled',
    'subscriberRegistrationEnabled',
    'runtimeSubscriberEnabled',
    'runtimeDispatchProducerEnabled',
    'repoArtifactWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'artifactWriteEnabled',
    'runtimeLogWriteEnabled',
    'sessionMaterializationEnabled',
  ]) {
    assert.equal(item[fieldName], false, `${fieldName} must remain false before handoff wiring`);
  }

  for (const runtimeField of [
    'registration',
    'producerRegistration',
    'subscriberRegistration',
    'registerProducer',
    'registerSubscriber',
    'producer',
    'subscriber',
    'telemetrySink',
    'externalTelemetry',
    'dispatchLifecycleEvent',
    'lifecycleEvent',
    'runtimePayload',
    'telemetryPayload',
    'dispatchPayload',
    'runtimeLog',
    'sessionView',
    'siteAdapter',
    'downloader',
    'artifactPayload',
    'artifactPath',
    'logPath',
  ]) {
    assert.equal(Object.hasOwn(item, runtimeField), false, runtimeField);
  }

  for (const fieldName of [
    'registrationAllowed',
    'producerRegistrationAllowed',
    'producerRegistrationEnabled',
    'subscriberRegistrationAllowed',
    'telemetryDispatchAllowed',
    'telemetryDispatchEnabled',
    'runtimeDispatchAllowed',
    'dispatchWriteAllowed',
    'dispatchWriteEnabled',
    'logWriteAllowed',
    'logWriteEnabled',
    'artifactWriteAllowed',
    'runtimeLogWriteEnabled',
    'runtimeArtifactWriteEnabled',
  ]) {
    assert.throws(
      () => create(ownerPreflight, {
        [fieldName]: true,
      }),
      /must remain false/u,
    );
  }

  for (const fieldName of [
    'registration',
    'producerRegistration',
    'subscriberRegistration',
    'registerProducer',
    'registerSubscriber',
    'producer',
    'subscriber',
    'telemetrySink',
    'externalTelemetry',
    'dispatchLifecycleEvent',
    'lifecycleEvent',
    'runtimePayload',
    'telemetryPayload',
    'dispatchPayload',
    'runtimeLog',
    'sessionView',
    'siteAdapter',
    'downloader',
    'artifactPayload',
    'artifactPath',
    'logPath',
    'authorizationHeader',
    'cookie',
  ]) {
    const message = captureThrownMessage(
      () => create(ownerPreflight, {
        [fieldName]: {
          value: 'synthetic-secret-value',
        },
      }),
    );
    assert.match(message, /descriptor-only|forbidden field|Forbidden sensitive pattern/u);
    assert.match(message, new RegExp(fieldName, 'u'));
    assert.doesNotMatch(message, /synthetic-secret-value/u);
  }

  const unsafeGuard = create(ownerPreflight, {
    handoffName: 'synthetic-registration-owner-handoff-guard',
  });
  unsafeGuard.items[0].telemetryDispatchAllowed = true;
  assert.throws(
    () => assertCompatibility(unsafeGuard),
    /telemetryDispatchAllowed must be false/u,
  );

  const rendered = JSON.stringify(handoffGuard);
  assert.doesNotMatch(rendered, /synthetic-secret-value/u);
  assert.doesNotMatch(rendered, /"registerProducer"\s*:/u);
  assert.doesNotMatch(rendered, /"registerSubscriber"\s*:/u);
  assert.doesNotMatch(rendered, /"telemetrySink"\s*:/u);
  assert.doesNotMatch(rendered, /"dispatchLifecycleEvent"\s*:/u);
  assert.doesNotMatch(rendered, /"runtimeLog"\s*:/u);
  assert.doesNotMatch(rendered, /"runtimePayload"\s*:/u);
  assert.doesNotMatch(rendered, /"artifactPath"\s*:/u);
  assert.doesNotMatch(rendered, /"logPath"\s*:/u);
  assert.doesNotMatch(rendered, /"sessionView"\s*:/u);
});

test('graph docs lifecycle observability runtime registration consumer guard stays disabled before runtime registration', async () => {
  const {
    create: createRegistrationOwnerHandoffGuard,
    assertCompatibility: assertRegistrationOwnerHandoffGuardCompatibility,
  } = loadGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardApi();
  const {
    create: createRuntimeRegistrationConsumerGuard,
    assertCompatibility: assertRuntimeRegistrationConsumerGuardCompatibility,
  } = loadGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardApi();
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const baseOptions = {
    summary,
    traceId: 'trace-synthetic-section-18-runtime-registration-consumer-guard',
    correlationId: 'correlation-synthetic-section-18-runtime-registration-consumer-guard',
    taskId: 'task-synthetic-section-18-runtime-registration-consumer-guard',
    siteKey: 'synthetic.example',
    graphVersion: 'synthetic-section-18-runtime-registration-consumer-guard-source-graph',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    createdAt: '2026-05-05T00:00:00.000Z',
  };
  const lifecycleDispatchPreflight = createGraphDocsLifecycleDispatchPreflightContract(
    baseOptions,
  );
  const adapterHandshake = createDisabledGraphDocsLifecycleObservabilityAdapterHandshake({
    ...baseOptions,
    preflight: lifecycleDispatchPreflight,
    adapterName: 'synthetic-observability-adapter-from-runtime-registration-consumer-guard',
  });
  const consumerIntegrationDesign = createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign({
    ...baseOptions,
    preflight: lifecycleDispatchPreflight,
    handshake: adapterHandshake,
    consumerName: 'synthetic-observability-consumer-from-runtime-registration-consumer-guard',
  });
  const adapterBoundary = createGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign({
    ...baseOptions,
    consumerIntegrationDesign,
  });
  const runtimePreflight = createGraphDocsLifecycleObservabilityRuntimeImplementationPreflight(
    adapterBoundary,
    {
      ...baseOptions,
      consumerName: 'synthetic-observability-runtime-registration-consumer-guard',
    },
  );
  const ownerPreflight = createGraphDocsLifecycleObservabilityRegistrationOwnerPreflight(
    runtimePreflight,
    {
      ...baseOptions,
      preflightName: 'synthetic-runtime-registration-consumer-guard-owner-preflight',
    },
  );
  const handoffGuard = createRegistrationOwnerHandoffGuard(ownerPreflight, {
    handoffName: 'synthetic-registration-owner-handoff-for-runtime-registration-consumer-guard',
  });
  const guard = createRuntimeRegistrationConsumerGuard(handoffGuard, {
    consumerName: 'synthetic-runtime-registration-consumer-guard',
  });
  const sourceItem = handoffGuard.items[0];
  const item = guard.items[0];

  assert.equal(
    assertGraphDocsLifecycleDispatchPreflightCompatibility(lifecycleDispatchPreflight),
    true,
  );
  assert.equal(
    assertDisabledGraphDocsLifecycleObservabilityAdapterHandshakeCompatibility(adapterHandshake),
    true,
  );
  assert.equal(
    assertDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesignCompatibility(
      consumerIntegrationDesign,
    ),
    true,
  );
  assert.equal(
    assertGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignCompatibility(
      adapterBoundary,
    ),
    true,
  );
  assert.equal(
    assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightCompatibility(
      runtimePreflight,
    ),
    true,
  );
  assert.equal(
    assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility(ownerPreflight),
    true,
  );
  assert.equal(assertRegistrationOwnerHandoffGuardCompatibility(handoffGuard), true);
  assert.equal(assertRuntimeRegistrationConsumerGuardCompatibility(guard), true);
  assert.equal(
    guard.queryName,
    'createGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard',
  );
  assert.equal(
    guard.artifactFamily,
    'site-capability-graph-docs-lifecycle-observability-runtime-registration-consumer-guard',
  );
  assert.equal(guard.redactionRequired, true);
  assert.equal(guard.graphVersion, handoffGuard.graphVersion);
  assert.equal(item.queryName, guard.queryName);
  assert.equal(item.artifactFamily, guard.artifactFamily);
  assert.equal(item.redactionRequired, true);
  assert.equal(item.guardMode ?? item.handoffMode ?? item.consumerMode, 'descriptor-only');
  assert.equal(item.runtimeRegistrationMode ?? item.registrationOwnerMode, 'disabled');
  assert.equal(item.runtimeMode, 'not-registered');
  assert.equal(item.result, 'blocked');
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(item.consumerName, sourceItem.consumerName);
  assert.equal(item.sourceRegistrationOwnerHandoffGuard.queryName, handoffGuard.queryName);
  assert.equal(item.sourceRegistrationOwnerHandoffGuard.artifactFamily, handoffGuard.artifactFamily);
  assert.equal(item.sourceRegistrationOwnerHandoffGuard.graphVersion, handoffGuard.graphVersion);
  assert.equal(item.sourceRegistrationOwnerHandoffGuard.result, sourceItem.result);
  assert.equal(item.sourceRegistrationOwnerHandoffGuard.reasonCode, sourceItem.reasonCode);
  assert.deepEqual(item.registrationOwnershipPlan, sourceItem.registrationOwnershipPlan);

  for (const fieldName of [
    'producerRegistrationOwner',
    'subscriberRegistrationOwner',
    'telemetryDispatchGate',
    'dispatchWriteGate',
    'logWriteGate',
    'artifactWriteGate',
  ]) {
    assert.equal(item[fieldName], sourceItem[fieldName]);
    assert.equal(item[fieldName], item.registrationOwnershipPlan[fieldName]);
  }

  assert.equal(
    item.requiredGuards.registrationOwnerHandoffGuard,
    'assertGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardCompatibility',
  );
  assert.equal(
    item.requiredGuards.runtimeRegistrationConsumerGuard,
    'assertGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardCompatibility',
  );

  for (const fieldName of [
    'featureEnabled',
    'runtimeImplementationEnabled',
    'runtimeRegistrationEnabled',
    'runtimeRegistrationAllowed',
    'registrationAllowed',
    'producerRegistrationAllowed',
    'producerRegistrationEnabled',
    'subscriberRegistrationAllowed',
    'subscriberRegistrationEnabled',
    'runtimeSubscriberEnabled',
    'runtimeDispatchProducerEnabled',
    'telemetryDispatchAllowed',
    'telemetryDispatchEnabled',
    'externalTelemetryEnabled',
    'externalTelemetryDispatchEnabled',
    'runtimeDispatchAllowed',
    'runtimeDispatchEnabled',
    'dispatchWriteAllowed',
    'dispatchWriteEnabled',
    'logWriteAllowed',
    'logWriteEnabled',
    'artifactWriteAllowed',
    'artifactWriteEnabled',
    'runtimeLogWriteEnabled',
    'repoArtifactWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'runtimeWriteEnabled',
    'repoWriteEnabled',
    'sessionMaterializationEnabled',
    'sessionViewEnabled',
    'downloaderEnabled',
    'downloaderInvocationEnabled',
    'siteAdapterEnabled',
    'siteAdapterInvocationEnabled',
    'runtimeConsumerEnabled',
    'statusPromotionAllowed',
    'verifiedPromotionAllowed',
  ]) {
    if (Object.hasOwn(item, fieldName)) {
      assert.equal(item[fieldName], false, `${fieldName} must remain false before registration`);
    }
  }

  for (const runtimeField of [
    'registration',
    'runtimeRegistration',
    'producerRegistration',
    'subscriberRegistration',
    'registerProducer',
    'registerSubscriber',
    'producer',
    'subscriber',
    'telemetrySink',
    'externalTelemetry',
    'dispatchLifecycleEvent',
    'lifecycleEvent',
    'runtimePayload',
    'telemetryPayload',
    'dispatchPayload',
    'runtimeLog',
    'sessionView',
    'siteAdapter',
    'downloader',
    'downloadPolicy',
    'taskList',
    'standardTaskList',
    'artifactPayload',
    'artifactPath',
    'runtimeArtifact',
    'logPath',
    'writePath',
    'handler',
    'outputPath',
  ]) {
    assert.equal(Object.hasOwn(item, runtimeField), false, runtimeField);
  }

  for (const fieldName of [
    'runtimeRegistrationEnabled',
    'runtimeRegistrationAllowed',
    'registrationAllowed',
    'producerRegistrationAllowed',
    'producerRegistrationEnabled',
    'subscriberRegistrationAllowed',
    'subscriberRegistrationEnabled',
    'telemetryDispatchAllowed',
    'telemetryDispatchEnabled',
    'externalTelemetryEnabled',
    'runtimeDispatchAllowed',
    'runtimeDispatchEnabled',
    'dispatchWriteAllowed',
    'dispatchWriteEnabled',
    'logWriteAllowed',
    'logWriteEnabled',
    'artifactWriteAllowed',
    'runtimeLogWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'repoWriteEnabled',
  ]) {
    const message = captureThrownMessage(
      () => createRuntimeRegistrationConsumerGuard(handoffGuard, {
        [fieldName]: true,
      }),
    );
    assert.match(message, /must remain false|must be false/u);
    assert.doesNotMatch(message, /synthetic-secret-value/u);
  }

  for (const fieldName of [
    'registration',
    'runtimeRegistration',
    'producerRegistration',
    'subscriberRegistration',
    'registerProducer',
    'registerSubscriber',
    'producer',
    'subscriber',
    'telemetrySink',
    'externalTelemetry',
    'dispatchLifecycleEvent',
    'lifecycleEvent',
    'runtimePayload',
    'telemetryPayload',
    'dispatchPayload',
    'runtimeLog',
    'sessionView',
    'siteAdapter',
    'downloader',
    'downloadPolicy',
    'taskList',
    'artifactPayload',
    'artifactPath',
    'runtimeArtifact',
    'logPath',
    'writePath',
    'handler',
    'outputPath',
    'authorizationHeader',
    'cookie',
    'token',
    'sessionId',
    'browserProfile',
  ]) {
    let message;
    try {
      createRuntimeRegistrationConsumerGuard(handoffGuard, {
        [fieldName]: {
          value: 'synthetic-secret-value',
        },
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.ok(message, `${fieldName} must fail closed before runtime registration`);
    assert.match(message, /descriptor-only|forbidden field|Forbidden sensitive pattern/u);
    assert.match(message, new RegExp(fieldName, 'u'));
    assert.doesNotMatch(message, /synthetic-secret-value/u);
  }

  const unsafeGuard = createRuntimeRegistrationConsumerGuard(handoffGuard, {
    consumerName: 'synthetic-runtime-registration-consumer-guard',
  });
  unsafeGuard.items[0].runtimeRegistrationEnabled = true;
  assert.throws(
    () => assertRuntimeRegistrationConsumerGuardCompatibility(unsafeGuard),
    /runtimeRegistrationEnabled must (?:remain false|be false)/u,
  );

  const rendered = JSON.stringify(guard);
  assert.doesNotMatch(rendered, /synthetic-secret-value/u);
  assert.doesNotMatch(rendered, /Authorization|Bearer|cookie|token|sessionId|browserProfile/iu);
  assert.doesNotMatch(rendered, /"registerProducer"\s*:/u);
  assert.doesNotMatch(rendered, /"registerSubscriber"\s*:/u);
  assert.doesNotMatch(rendered, /"telemetrySink"\s*:/u);
  assert.doesNotMatch(rendered, /"externalTelemetry"\s*:/u);
  assert.doesNotMatch(rendered, /"dispatchLifecycleEvent"\s*:/u);
  assert.doesNotMatch(rendered, /"runtimeLog"\s*:/u);
  assert.doesNotMatch(rendered, /"runtimePayload"\s*:/u);
  assert.doesNotMatch(rendered, /"artifactPath"\s*:/u);
  assert.doesNotMatch(rendered, /"runtimeArtifact"\s*:/u);
  assert.doesNotMatch(rendered, /"logPath"\s*:/u);
  assert.doesNotMatch(rendered, /"sessionView"\s*:/u);
  assert.doesNotMatch(rendered, /"siteAdapter"\s*:/u);
  assert.doesNotMatch(rendered, /"downloader"\s*:/u);
});

test('graph observability external telemetry dispatch boundary stays descriptor-only disabled', async () => {
  const {
    create: createExternalTelemetryBoundary,
    assertCompatibility: assertExternalTelemetryBoundaryCompatibility,
  } = loadGraphObservabilityExternalTelemetryDispatchBoundaryApi();
  const sourceGuard = await createRuntimeRegistrationConsumerGuardForExternalTelemetryBoundary();
  const boundary = createExternalTelemetryDispatchBoundary(
    createExternalTelemetryBoundary,
    sourceGuard,
    {
      boundaryName: 'synthetic-external-telemetry-dispatch-boundary',
    },
  );
  const item = boundary.items?.[0] ?? boundary;

  assert.equal(assertExternalTelemetryBoundaryCompatibility(boundary), true);
  assert.equal(boundary.queryName, 'createGraphObservabilityExternalTelemetryDispatchBoundary');
  assert.equal(
    boundary.artifactFamily,
    'site-capability-graph-observability-external-telemetry-dispatch-boundary',
  );
  assert.equal(boundary.redactionRequired, true);
  assert.equal(boundary.graphVersion, sourceGuard.graphVersion);
  assert.equal(item.queryName ?? boundary.queryName, boundary.queryName);
  assert.equal(item.redactionRequired, true);
  assert.equal(item.boundaryMode ?? item.guardMode ?? item.dispatchMode, 'descriptor-only');
  assert.equal(item.result, 'blocked');
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(
    item.sourceRuntimeRegistrationConsumerGuard?.queryName,
    sourceGuard.queryName,
  );
  assert.equal(
    item.sourceRuntimeRegistrationConsumerGuard?.graphVersion,
    sourceGuard.graphVersion,
  );

  for (const fieldName of [
    'externalTelemetryEnabled',
    'externalTelemetryDispatchEnabled',
    'telemetryDispatchEnabled',
    'telemetryDispatchAllowed',
    'runtimeDispatchEnabled',
    'runtimeWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'repoArtifactWriteEnabled',
    'repoWriteEnabled',
    'routeExecutionEnabled',
    'liveRouteExecutionEnabled',
    'siteAdapterInvocationEnabled',
    'siteAdapterEnabled',
    'downloaderInvocationEnabled',
    'downloaderEnabled',
    'sessionMaterializationEnabled',
    'sessionViewEnabled',
    'taskRunnerEnabled',
    'profileMaterializationEnabled',
    'runtimeConsumerEnabled',
    'statusPromotionAllowed',
    'verifiedPromotionAllowed',
  ]) {
    if (Object.hasOwn(item, fieldName)) {
      assert.equal(item[fieldName], false, `${fieldName} must remain false`);
    }
  }

  for (const runtimeField of [
    'telemetrySink',
    'externalTelemetry',
    'externalTelemetrySink',
    'dispatchLifecycleEvent',
    'externalDispatch',
    'runtimePayload',
    'telemetryPayload',
    'dispatchPayload',
    'subscriber',
    'subscribers',
    'subscriberResults',
    'sessionView',
    'siteAdapter',
    'downloader',
    'downloadPolicy',
    'taskList',
    'standardTaskList',
    'browserProfile',
    'runtimeArtifact',
    'runtimeLog',
    'artifactPath',
    'logPath',
    'handler',
    'outputPath',
  ]) {
    assert.equal(Object.hasOwn(item, runtimeField), false, runtimeField);
  }

  assert.equal(assertNoFunctionValues(boundary), true);
  const rendered = JSON.stringify(boundary);
  assert.doesNotMatch(rendered, /synthetic-secret-value/u);
  assert.doesNotMatch(rendered, /Authorization|Bearer|cookie|token|sessionId|browserProfile/iu);
  assert.doesNotMatch(rendered, /"telemetrySink"\s*:|"externalTelemetry"\s*:|"runtimePayload"\s*:/u);
  assert.doesNotMatch(rendered, /"sessionView"\s*:|"siteAdapter"\s*:|"downloader"\s*:/u);
});

test('graph observability external telemetry dispatch boundary rejects enabled runtime telemetry payloads', async () => {
  const {
    create: createExternalTelemetryBoundary,
  } = loadGraphObservabilityExternalTelemetryDispatchBoundaryApi();
  const sourceGuard = await createRuntimeRegistrationConsumerGuardForExternalTelemetryBoundary();

  for (const fieldName of [
    'externalTelemetryEnabled',
    'externalTelemetryDispatchEnabled',
    'telemetryDispatchEnabled',
    'telemetryDispatchAllowed',
    'externalDispatchEnabled',
    'runtimeDispatchEnabled',
    'runtimeWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'repoWriteEnabled',
    'routeExecutionEnabled',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'sessionMaterializationEnabled',
    'profileMaterializationEnabled',
  ]) {
    const message = captureThrownMessage(
      () => createExternalTelemetryDispatchBoundary(
        createExternalTelemetryBoundary,
        sourceGuard,
        { [fieldName]: true },
      ),
    );
    assert.match(message, /must remain false|must be false|descriptor-only|disabled/u, fieldName);
    assert.doesNotMatch(message, /synthetic-secret-value/u, fieldName);
  }

  for (const fieldName of [
    'externalTelemetry',
    'externalTelemetrySink',
    'externalDispatch',
    'telemetrySink',
    'dispatchLifecycleEvent',
    'subscriber',
    'subscribers',
    'subscriberResults',
    'sessionView',
    'downloadPolicy',
    'downloader',
    'siteAdapter',
    'taskList',
    'standardTaskList',
    'browserProfile',
    'runtimePayload',
    'telemetryPayload',
    'dispatchPayload',
    'runtimeArtifact',
    'runtimeLog',
    'handler',
    'outputPath',
  ]) {
    const message = captureThrownMessage(
      () => createExternalTelemetryDispatchBoundary(
        createExternalTelemetryBoundary,
        sourceGuard,
        {
          [fieldName]: {
            value: 'synthetic-redacted-value',
          },
        },
      ),
    );
    assert.match(message, /descriptor-only|forbidden field|runtime|disabled/u, fieldName);
    assert.match(message, new RegExp(fieldName, 'u'), fieldName);
    assert.doesNotMatch(message, /synthetic-secret-value/u, fieldName);
  }
});

test('graph observability external telemetry dispatch boundary rejects sensitive material without echoing it', async () => {
  const {
    create: createExternalTelemetryBoundary,
  } = loadGraphObservabilityExternalTelemetryDispatchBoundaryApi();
  const sourceGuard = await createRuntimeRegistrationConsumerGuardForExternalTelemetryBoundary();

  for (const fieldName of [
    'Authorization',
    'authorizationHeader',
    'cookie',
    'token',
    'sessionId',
    'browserProfile',
    'credential',
    'credentials',
  ]) {
    const message = captureThrownMessage(
      () => createExternalTelemetryDispatchBoundary(
        createExternalTelemetryBoundary,
        sourceGuard,
        {
          [fieldName]: 'synthetic-secret-value',
        },
      ),
    );
    assert.match(message, /forbidden field|Forbidden sensitive pattern|sensitive|descriptor-only/u);
    assert.match(message, new RegExp(fieldName, 'iu'));
    assert.doesNotMatch(message, /synthetic-secret-value/u);
  }
});

test('docs lifecycle dispatch runtime producer subscriber boundary stays descriptor-only without external telemetry', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const design = createGraphDocsLifecycleDispatchDesign({
    summary,
    traceId: 'trace-synthetic-section-18-observability',
    correlationId: 'correlation-synthetic-section-18-observability',
    taskId: 'task-synthetic-section-18-observability',
    siteKey: 'synthetic.example',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    createdAt: '2026-05-05T00:00:00.000Z',
    details: {
      graphVersion: 'synthetic-graph-v1',
      capabilityId: 'capability:synthetic.example:open-public-page',
      routeId: 'route:synthetic.example:public-page',
      adapterVersion: 'synthetic-adapter-v1',
    },
  });
  const result = createDisabledGraphDocsLifecycleDispatchConsumerResult(design);
  const event = design.items[0].lifecycleEvent;
  const consumer = result.items[0];

  assert.equal(assertGraphDocsLifecycleDispatchDesignCompatibility(design), true);
  assert.equal(assertDisabledGraphDocsLifecycleDispatchConsumerResultCompatibility(result), true);
  assert.equal(assertGraphDocsGenerationLifecycleEventConsumerCompatibility(event), true);
  assert.equal(assertGraphDocsGenerationObservabilityEvent(event), true);
  assert.equal(design.redactionRequired, true);
  assert.equal(result.redactionRequired, true);
  assert.equal(event.traceId, 'trace-synthetic-section-18-observability');
  assert.equal(event.correlationId, 'correlation-synthetic-section-18-observability');
  assert.equal(event.taskId, 'task-synthetic-section-18-observability');
  assert.equal(event.siteKey, 'synthetic.example');
  assert.equal(event.details.graphVersion, 'synthetic-graph-v1');
  assert.equal(event.details.capabilityId, 'capability:synthetic.example:open-public-page');
  assert.equal(event.details.routeId, 'route:synthetic.example:public-page');
  assert.equal(event.adapterVersion, 'synthetic-adapter-v1');
  assert.equal(event.details.adapterVersion, 'synthetic-adapter-v1');
  assert.equal(design.items[0].dispatchMode, 'design-only');
  assert.equal(design.items[0].runtimeDispatchEnabled, false);
  assert.equal(design.items[0].externalTelemetryDispatchEnabled, false);
  assert.equal(design.items[0].subscriberRegistrationEnabled, false);
  assert.equal(design.items[0].repoArtifactWriteEnabled, false);
  assert.equal(design.items[0].sessionMaterializationEnabled, false);
  assert.equal(consumer.consumerMode, 'disabled-feature-flag');
  assert.equal(consumer.featureEnabled, false);
  assert.equal(consumer.result, 'blocked');
  assert.equal(consumer.dispatchAllowed, false);
  assert.equal(consumer.runtimeDispatchEnabled, false);
  assert.equal(consumer.externalTelemetryDispatchEnabled, false);
  assert.equal(consumer.subscriberRegistrationEnabled, false);
  assert.equal(consumer.repoArtifactWriteEnabled, false);
  assert.equal(consumer.runtimeArtifactWriteEnabled, false);
  assert.equal(consumer.sessionMaterializationEnabled, false);

  for (const fieldName of [
    'artifactPath',
    'artifactPayload',
    'auditPath',
    'dispatch',
    'dispatchLifecycleEvent',
    'downloadPolicy',
    'eventPath',
    'externalTelemetry',
    'handler',
    'outputPath',
    'rawArtifact',
    'repoArtifactPath',
    'sessionView',
    'subscriberResults',
    'subscribers',
    'taskList',
    'telemetrySink',
    'writePath',
  ]) {
    assert.throws(
      () => createDisabledGraphDocsLifecycleDispatchConsumerResult(design, { [fieldName]: {} }),
      new RegExp(`descriptor-only.*${fieldName}`, 'u'),
    );
  }

  const hasOwnField = (value, fieldName) => {
    if (!value || typeof value !== 'object') {
      return false;
    }
    if (Object.hasOwn(value, fieldName)) {
      return true;
    }
    return Object.values(value).some((entry) => hasOwnField(entry, fieldName));
  };
  for (const fieldName of [
    'artifactPath',
    'artifactPayload',
    'auditPath',
    'dispatch',
    'dispatchLifecycleEvent',
    'downloadPolicy',
    'eventPath',
    'externalTelemetry',
    'handler',
    'outputPath',
    'rawArtifact',
    'repoArtifactPath',
    'sessionView',
    'siteAdapterPayload',
    'siteAdapterRuntime',
    'subscriberResults',
    'subscribers',
    'taskList',
    'telemetrySink',
    'writePath',
  ]) {
    assert.equal(hasOwnField({ design, result }, fieldName), false, `${fieldName} must not be emitted`);
  }

  const rendered = JSON.stringify({ design, result });
  assert.doesNotMatch(
    rendered,
    /cookie|Authorization|sessionId|browserProfile|profilePath|accessToken|csrf|SESSDATA|Bearer\s+|127\.0\.0\.1|localhost|\b\d{1,3}(?:\.\d{1,3}){3}\b/iu,
  );
});

test('disabled graph docs lifecycle dispatch consumer preserves source reason while returning disabled reason', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const design = createGraphDocsLifecycleDispatchDesign({
    summary,
    traceId: 'trace-synthetic-graph-docs-disabled-dispatch-reason',
    correlationId: 'correlation-synthetic-graph-docs-disabled-dispatch-reason',
    taskId: 'task-synthetic-graph-docs-disabled-dispatch-reason',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    reasonCode: 'graph-artifact-redaction-required',
    createdAt: '2026-05-05T00:00:00.000Z',
  });

  const result = createDisabledGraphDocsLifecycleDispatchConsumerResult(design);
  const item = result.items[0];

  assert.equal(assertDisabledGraphDocsLifecycleDispatchConsumerResultCompatibility(result), true);
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(item.reason.code, 'graph-runtime-consumer-disabled');
  assert.equal(item.sourceLifecycleReasonCode, 'graph-artifact-redaction-required');
  assert.equal(item.lifecycleEvent.reasonCode, 'graph-artifact-redaction-required');
  assert.equal(item.dispatchAllowed, false);
  assert.equal(item.runtimeDispatchEnabled, false);
  assert.equal(item.externalTelemetryDispatchEnabled, false);
  assert.equal(item.subscriberRegistrationEnabled, false);
  assert.equal(Object.hasOwn(item, 'subscribers'), false);
  assert.equal(Object.hasOwn(item, 'telemetrySink'), false);

  const mismatchedSourceReason = createDisabledGraphDocsLifecycleDispatchConsumerResult(design);
  mismatchedSourceReason.items[0].sourceLifecycleReasonCode = 'graph-docs-generation-failed';
  assert.throws(
    () => assertDisabledGraphDocsLifecycleDispatchConsumerResultCompatibility(mismatchedSourceReason),
    /sourceLifecycleReasonCode must preserve lifecycle event reasonCode/u,
  );

  const overwrittenDisabledReason = createDisabledGraphDocsLifecycleDispatchConsumerResult(design);
  overwrittenDisabledReason.items[0].reasonCode = 'graph-artifact-redaction-required';
  overwrittenDisabledReason.items[0].reason.code = 'graph-artifact-redaction-required';
  assert.throws(
    () => assertDisabledGraphDocsLifecycleDispatchConsumerResultCompatibility(overwrittenDisabledReason),
    /reasonCode must be graph-runtime-consumer-disabled/u,
  );
});

test('disabled graph docs lifecycle dispatch consumer rejects enabled flags and runtime payloads', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const design = createGraphDocsLifecycleDispatchDesign({
    summary,
    traceId: 'trace-synthetic-graph-docs-disabled-dispatch-consumer',
    correlationId: 'correlation-synthetic-graph-docs-disabled-dispatch-consumer',
    taskId: 'task-synthetic-graph-docs-disabled-dispatch-consumer',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    createdAt: '2026-05-05T00:00:00.000Z',
  });

  for (const fieldName of [
    'featureEnabled',
    'runtimeDispatchEnabled',
    'externalTelemetryDispatchEnabled',
    'subscriberRegistrationEnabled',
    'repoArtifactWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'sessionMaterializationEnabled',
  ]) {
    assert.throws(
      () => createDisabledGraphDocsLifecycleDispatchConsumerResult(design, { [fieldName]: true }),
      new RegExp(`${fieldName} must remain false`, 'u'),
    );
  }
  assert.throws(
    () => createDisabledGraphDocsLifecycleDispatchConsumerResult(design, { subscribers: [] }),
    /descriptor-only.*subscribers/u,
  );
  assert.throws(
    () => createDisabledGraphDocsLifecycleDispatchConsumerResult(design, { telemetrySink: {} }),
    /descriptor-only.*telemetrySink/u,
  );
  assert.throws(
    () => createDisabledGraphDocsLifecycleDispatchConsumerResult(design, { artifactPath: 'runs/graph-docs.json' }),
    /descriptor-only.*artifactPath/u,
  );
  assert.throws(
    () => createDisabledGraphDocsLifecycleDispatchConsumerResult(design, { outputPath: 'runs/event.json' }),
    /descriptor-only.*outputPath/u,
  );
  assert.throws(
    () => createDisabledGraphDocsLifecycleDispatchConsumerResult(design, { sessionView: {} }),
    /descriptor-only.*sessionView/u,
  );
  assert.throws(
    () => createDisabledGraphDocsLifecycleDispatchConsumerResult(design, { downloadPolicy: {} }),
    /descriptor-only.*downloadPolicy/u,
  );

  const unsafeResult = createDisabledGraphDocsLifecycleDispatchConsumerResult(design);
  unsafeResult.items[0].dispatchAllowed = true;
  assert.throws(
    () => assertDisabledGraphDocsLifecycleDispatchConsumerResultCompatibility(unsafeResult),
    /dispatchAllowed must be false/u,
  );

  const runtimePayloadResult = createDisabledGraphDocsLifecycleDispatchConsumerResult(design);
  runtimePayloadResult.items[0].telemetrySink = /** @type {any} */ ({});
  assert.throws(
    () => assertDisabledGraphDocsLifecycleDispatchConsumerResultCompatibility(runtimePayloadResult),
    /descriptor-only.*telemetrySink/u,
  );
});

test('graph docs generation lifecycle event writes through guarded lifecycle artifact writer', async (t) => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'graph-docs-lifecycle-artifact-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const eventPath = path.join(tempDir, 'graph-docs-lifecycle-event.json');
  const auditPath = path.join(tempDir, 'graph-docs-lifecycle-event.redaction-audit.json');

  const result = await writeGraphDocsGenerationLifecycleEventArtifact({
    summary,
    traceId: 'trace-synthetic-graph-docs-artifact',
    correlationId: 'correlation-synthetic-graph-docs-artifact',
    taskId: 'task-synthetic-graph-docs-artifact',
    adapterVersion: 'synthetic-adapter-v1',
    routeId: 'route:synthetic.example:public-page',
    createdAt: '2026-05-05T00:00:00.000Z',
    eventPath,
    auditPath,
  });

  assert.equal(result.event.eventType, GRAPH_DOCS_GENERATION_EVENT_TYPE);
  assert.equal(result.event.details.redactionRequired, true);
  assert.equal(result.artifacts.lifecycleEvent, eventPath);
  assert.equal(result.artifacts.lifecycleEventRedactionAudit, auditPath);
  assert.deepEqual(result.redactionSummary, {
    redactedPathCount: 0,
    findingCount: 0,
  });

  const eventJson = await readFile(eventPath, 'utf8');
  const auditJson = await readFile(auditPath, 'utf8');
  assert.doesNotMatch(eventJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
  assert.doesNotMatch(auditJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
});

test('graph docs generation lifecycle artifact writer fails closed before unsafe writes', async (t) => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'graph-docs-lifecycle-artifact-fail-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const eventPath = path.join(tempDir, 'graph-docs-lifecycle-event.json');
  const auditPath = path.join(tempDir, 'graph-docs-lifecycle-event.redaction-audit.json');

  await assert.rejects(
    writeGraphDocsGenerationLifecycleEventArtifact({
      summary,
      traceId: 'trace-synthetic-graph-docs-artifact',
      correlationId: 'correlation-synthetic-graph-docs-artifact',
      taskId: 'task-synthetic-graph-docs-artifact',
      adapterVersion: 'synthetic-adapter-v1',
      details: {
        accessToken: 'synthetic-secret-value',
      },
      eventPath,
      auditPath,
    }),
    /forbidden field/u,
  );
  await assert.rejects(access(eventPath), /ENOENT/u);
  await assert.rejects(access(auditPath), /ENOENT/u);

  const unredactedSummary = generateGraphDocsSummary(graph);
  unredactedSummary.redactionRequired = false;
  await assert.rejects(
    writeGraphDocsGenerationLifecycleEventArtifact({
      summary: unredactedSummary,
      traceId: 'trace-synthetic-graph-docs-artifact',
      correlationId: 'correlation-synthetic-graph-docs-artifact',
      taskId: 'task-synthetic-graph-docs-artifact',
      adapterVersion: 'synthetic-adapter-v1',
      eventPath,
      auditPath,
    }),
    /redactionRequired must be true/u,
  );
  await assert.rejects(access(eventPath), /ENOENT/u);
  await assert.rejects(access(auditPath), /ENOENT/u);
});

test('graph docs generation lifecycle producer fails closed on incomplete events', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);

  assert.throws(
    () => createGraphDocsGenerationLifecycleEvent({
      summary,
      correlationId: 'correlation-synthetic-graph-docs-producer',
      taskId: 'task-synthetic-graph-docs-producer',
      adapterVersion: 'synthetic-adapter-v1',
    }),
    /traceId/u,
  );
});

test('graph docs generation lifecycle producer rejects unsafe detail fields', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);

  assert.throws(
    () => createGraphDocsGenerationLifecycleEvent({
      summary,
      traceId: 'trace-synthetic-graph-docs-producer',
      correlationId: 'correlation-synthetic-graph-docs-producer',
      taskId: 'task-synthetic-graph-docs-producer',
      adapterVersion: 'synthetic-adapter-v1',
      details: {
        accessToken: 'synthetic-secret-value',
      },
    }),
    /forbidden field/u,
  );
  assert.throws(
    () => createGraphDocsGenerationLifecycleEvent({
      summary,
      traceId: 'trace-synthetic-graph-docs-producer',
      correlationId: 'correlation-synthetic-graph-docs-producer',
      taskId: 'task-synthetic-graph-docs-producer',
      adapterVersion: 'synthetic-adapter-v1',
      details: {
        durationMs: 123,
      },
    }),
    /fake metric field/u,
  );
});

test('producer inventory observability coverage summarizes profiled lifecycle producers descriptor-only', () => {
  const coverage = createGraphLifecycleProducerInventoryObservabilityCoverage({
    graphVersion: 'synthetic-producer-inventory-observability-coverage-v1',
  });
  const [item] = coverage.items;
  const profiledEventTypes = item.summary.profiledEventTypes;

  assert.equal(
    assertGraphLifecycleProducerInventoryObservabilityCoverageCompatibility(coverage),
    true,
  );
  assert.equal(coverage.queryName, 'createGraphLifecycleProducerInventoryObservabilityCoverage');
  assert.equal(
    coverage.artifactFamily,
    'site-capability-graph-lifecycle-producer-inventory-observability-coverage',
  );
  assert.equal(coverage.redactionRequired, true);
  assert.equal(coverage.descriptorOnly, true);
  assert.equal(item.descriptorOnly, true);
  assert.equal(item.redactionRequired, true);
  assert.equal(item.runtimeDispatchEnabled, false);
  assert.equal(item.externalTelemetryEnabled, false);
  assert.equal(item.telemetrySinkEnabled, false);
  assert.equal(item.writesArtifacts, false);
  assert.equal(item.writesLogs, false);
  for (const eventType of [
    'capture.manifest.written',
    'capture.api_candidates.written',
    'api.catalog.collection.written',
    'api.catalog.index.written',
    'api.catalog.schema_incompatible',
    'api.catalog.upgrade_decision.written',
    'social.action.risk_blocked',
    'site.health.recovery.evaluated',
    'site.health.recovery.action.planned',
    'site.health.recovery.safe_stop',
  ]) {
    assert.equal(profiledEventTypes.includes(eventType), true, `${eventType} must be profiled`);
  }
  assert.equal(item.summary.eventTypeCount >= profiledEventTypes.length, true);
  assert.equal(item.summary.profiledEventTypeCount, profiledEventTypes.length);
  assert.equal(Object.keys(item.summary.producerModuleCounts).some((modulePath) => (
    modulePath.startsWith('src/sites/downloads/')
  )), false);
  assert.equal(
    item.summary.producerModuleCounts['src/domain/capabilities/site-capability-graph.mjs'],
    1,
  );
  assert.doesNotMatch(
    JSON.stringify(coverage),
    /"subscriber":|"subscribers":|"dispatch":|"dispatchLifecycleEvent":|"telemetrySink":\{|"sessionView":|"siteAdapter":|"downloader":|synthetic-secret-value/iu,
  );
});

test('producer inventory observability coverage inventories graph docs summary without runtime producer profile', () => {
  const coverage = createGraphLifecycleProducerInventoryObservabilityCoverage();
  const [item] = coverage.items;

  assert.equal(item.docsGenerationEventType, GRAPH_DOCS_GENERATION_EVENT_TYPE);
  assert.equal(item.docsGenerationRuntimeProducerProfile, false);
  assert.equal(item.docsGenerationProfileSource, 'graph-descriptor-only-event-fixture');
  assert.equal(item.summary.profiledEventTypes.includes(GRAPH_DOCS_GENERATION_EVENT_TYPE), false);
  assert.equal(item.summary.inventoriedOnlyEventTypes.includes(GRAPH_DOCS_GENERATION_EVENT_TYPE), true);

  const unsafeCoverage = structuredClone(coverage);
  unsafeCoverage.items[0].summary.profiledEventTypes.push(GRAPH_DOCS_GENERATION_EVENT_TYPE);
  unsafeCoverage.items[0].summary.profiledEventTypeCount += 1;
  assert.throws(
    () => assertGraphLifecycleProducerInventoryObservabilityCoverageCompatibility(unsafeCoverage),
    /not treat graph\.docs\.summary\.generated as a runtime producer profile/u,
  );
});

test('producer inventory observability coverage fails closed on runtime telemetry sensitive and fake metric options', () => {
  for (const { name, options, pattern } of [
    {
      name: 'externalTelemetry',
      options: { externalTelemetry: { secret: 'synthetic-secret-value' } },
      pattern: /externalTelemetry must remain false/u,
    },
    {
      name: 'externalTelemetrySink',
      options: { externalTelemetrySink: { secret: 'synthetic-secret-value' } },
      pattern: /externalTelemetrySink must remain false|runtime field: .*externalTelemetrySink/u,
    },
    {
      name: 'runtimeDispatchEnabled',
      options: { runtimeDispatchEnabled: true },
      pattern: /runtimeDispatchEnabled must remain false/u,
    },
    {
      name: 'runtimeDispatchProducer',
      options: { runtimeDispatchProducer: { secret: 'synthetic-secret-value' } },
      pattern: /runtimeDispatchProducer must remain false/u,
    },
    {
      name: 'writesArtifacts',
      options: { writesArtifacts: true },
      pattern: /writesArtifacts must remain false/u,
    },
    {
      name: 'writesLogs',
      options: { writesLogs: true },
      pattern: /writesLogs must remain false/u,
    },
    {
      name: 'subscriber',
      options: { subscriber: () => 'synthetic-secret-value' },
      pattern: /runtime field: .*subscriber/u,
    },
    {
      name: 'dispatch',
      options: { dispatch: () => 'synthetic-secret-value' },
      pattern: /runtime field: .*dispatch/u,
    },
    {
      name: 'telemetrySink',
      options: { telemetrySink: { secret: 'synthetic-secret-value' } },
      pattern: /runtime field: .*telemetrySink/u,
    },
    {
      name: 'sessionView',
      options: { sessionView: { secret: 'synthetic-secret-value' } },
      pattern: /runtime field: .*sessionView/u,
    },
    {
      name: 'siteAdapter',
      options: { siteAdapter: { secret: 'synthetic-secret-value' } },
      pattern: /runtime field: .*siteAdapter/u,
    },
    {
      name: 'downloader',
      options: { downloader: { secret: 'synthetic-secret-value' } },
      pattern: /runtime field: .*downloader/u,
    },
    {
      name: 'function value',
      options: { nested: { callback: () => 'synthetic-secret-value' } },
      pattern: /executable function/u,
    },
    {
      name: 'sensitive field',
      options: { token: 'synthetic-secret-value' },
      pattern: /runtime field: .*token|forbidden field/u,
    },
    {
      name: 'fake metric',
      options: { durationMs: 123 },
      pattern: /fake metric field/u,
    },
  ]) {
    const message = captureThrownMessage(
      () => createGraphLifecycleProducerInventoryObservabilityCoverage(options),
    );
    assert.match(message, pattern, name);
    assert.doesNotMatch(message, /synthetic-secret-value/u, name);
  }
});

test('graph docs generation observability fixture rejects missing details', () => {
  const event = createGraphDocsEvent({
    details: {
      graphVersion: 'synthetic-graph-v1',
    },
  });

  assert.throws(
    () => assertGraphDocsGenerationObservabilityEvent(event),
    /capabilityId/u,
  );
});

test('graph docs generation observability fixture rejects forbidden fields without echoing values', () => {
  const event = createGraphDocsEvent({
    details: {
      ...createGraphDocsEvent().details,
      accessToken: 'synthetic-secret-value',
    },
  });

  const message = captureThrownMessage(() => assertGraphDocsGenerationObservabilityEvent(event));

  assert.match(message, /forbidden field/u);
  assert.doesNotMatch(message, /synthetic-secret-value/u);
});

test('graph docs generation observability fixture rejects forbidden value patterns without echoing values', () => {
  const event = createGraphDocsEvent({
    details: {
      ...createGraphDocsEvent().details,
      note: 'Authorization: Bearer synthetic-secret-value',
    },
  });

  const message = captureThrownMessage(() => assertGraphDocsGenerationObservabilityEvent(event));

  assert.match(message, /Forbidden sensitive pattern/u);
  assert.doesNotMatch(message, /synthetic-secret-value/u);
});

test('graph docs generation observability fixture rejects fake metric fields', () => {
  const event = createGraphDocsEvent({
    details: {
      ...createGraphDocsEvent().details,
      durationMs: 123,
    },
  });

  assert.throws(
    () => assertGraphDocsGenerationObservabilityEvent(event),
    /fake metric field/u,
  );
});
