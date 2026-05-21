import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LIFECYCLE_EVENT_PRODUCER_DESCRIPTOR_POLICY,
  LIFECYCLE_EVENT_PRODUCER_INVENTORY_SCHEMA_VERSION,
  LIFECYCLE_EVENT_OBSERVABILITY_PROFILES,
  LIFECYCLE_EVENT_SCHEMA_VERSION,
  assertLifecycleEventCompatible,
  assertLifecycleEventObservabilityFields,
  assertLifecycleEventProducerInventoryCompatible,
  assertLifecycleEventProducerObservability,
  createLifecycleEventProducerInventory,
  dispatchLifecycleEvent,
  listLifecycleEventProducerEventTypes,
  normalizeLifecycleEvent,
  summarizeLifecycleEventProducerInventory,
  writeLifecycleEventArtifact,
} from '../../src/domain/lifecycle/lifecycle-events.mjs';
import * as lifecycleEvents from '../../src/domain/lifecycle/lifecycle-events.mjs';
import { REDACTION_PLACEHOLDER } from '../../src/domain/sessions/security-guard.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function collectFiles(dir, predicate, collected = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, predicate, collected);
    } else if (predicate(fullPath)) {
      collected.push(fullPath);
    }
  }
  return collected;
}

function discoverRuntimeLifecycleProducerEventTypes() {
  const srcRoot = path.join(REPO_ROOT, 'src');
  const excludedCoreFiles = new Set([
    path.join(srcRoot, 'sites', 'capability', 'capability-hook.mjs'),
    path.join(srcRoot, 'sites', 'capability', 'lifecycle-events.mjs'),
  ]);
  const producerFiles = collectFiles(srcRoot, (filePath) => filePath.endsWith('.mjs'))
    .filter((filePath) => !excludedCoreFiles.has(filePath))
    .filter((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8');
      return source.includes('normalizeLifecycleEvent(') && source.includes('eventType:');
    });
  return [...new Set(producerFiles.flatMap((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const constantValuesByName = new Map(
      [...source.matchAll(/\b(?:export\s+)?const\s+([A-Z0-9_]+)\s*=\s*'([^']+)'/gu)]
        .map((match) => [match[1], match[2]]),
    );
    const literalEventTypes = [...source.matchAll(/\beventType:\s*'([^']+)'/gu)]
      .map((match) => match[1]);
    const constantEventTypes = [...source.matchAll(/\beventType:\s*([A-Z0-9_]+)/gu)]
      .map((match) => constantValuesByName.get(match[1]))
      .filter(Boolean);
    return [
      ...literalEventTypes,
      ...constantEventTypes,
    ];
  }))].sort();
}

function loadLifecycleEventSubscriberRegistryApi() {
  const create = lifecycleEvents.createLifecycleEventSubscriberRegistry;
  if (typeof create !== 'function') {
    throw new Error(
      'LifecycleEvent subscriber registry export is required: '
      + 'createLifecycleEventSubscriberRegistry',
    );
  }
  return { create };
}

function registerLifecycleSubscriber(registry, descriptor, subscriber) {
  if (typeof registry.registerSubscriber === 'function') {
    return registry.registerSubscriber({ ...descriptor, subscriber });
  }
  if (typeof registry.register === 'function') {
    return registry.register({ ...descriptor, subscriber });
  }
  throw new Error('LifecycleEvent subscriber registry must expose registerSubscriber()');
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

function captureThrownMessage(fn) {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected function to throw');
}

test('LifecycleEvent preserves optional trace and correlation identifiers', () => {
  const event = normalizeLifecycleEvent({
    eventType: 'test.lifecycle.event',
    traceId: 'trace-synthetic-1',
    correlationId: 'correlation-synthetic-1',
    taskId: 'task-synthetic-1',
    siteKey: 'example',
    taskType: 'api-catalog-verification',
    adapterVersion: 'fixture-adapter-v1',
    createdAt: '2026-05-01T04:00:00.000Z',
  });

  assert.equal(event.schemaVersion, LIFECYCLE_EVENT_SCHEMA_VERSION);
  assert.equal(assertLifecycleEventCompatible(event), true);
  assert.equal(event.traceId, 'trace-synthetic-1');
  assert.equal(event.correlationId, 'correlation-synthetic-1');
  assert.equal(event.taskId, 'task-synthetic-1');
  assert.equal(event.siteKey, 'example');
  assert.equal(event.taskType, 'api-catalog-verification');
  assert.equal(event.adapterVersion, 'fixture-adapter-v1');
  assert.equal(assertLifecycleEventObservabilityFields(event, {
    requiredFields: [
      'traceId',
      'correlationId',
      'taskId',
      'siteKey',
      'taskType',
      'adapterVersion',
    ],
  }), true);
});

test('LifecycleEvent subscriber registry dispatches normalized events only to matching in-memory subscribers', async () => {
  const { create } = loadLifecycleEventSubscriberRegistryApi();
  const registry = create();
  const received = [];
  const nonMatchingReceived = [];

  registerLifecycleSubscriber(registry, {
    subscriberId: 'synthetic-in-memory-subscriber',
    eventTypes: ['test.lifecycle.registry.match'],
    descriptorOnly: true,
    inMemory: true,
    externalTelemetry: false,
    writesArtifacts: false,
    writesLogs: false,
    redactionRequired: true,
  }, async (event) => {
    received.push(event);
    return {
      subscriberId: 'synthetic-in-memory-subscriber',
      eventType: event.eventType,
      traceId: event.traceId,
    };
  });
  registerLifecycleSubscriber(registry, {
    subscriberId: 'synthetic-non-matching-subscriber',
    eventTypes: ['test.lifecycle.registry.other'],
    descriptorOnly: true,
    inMemory: true,
    externalTelemetry: false,
    writesArtifacts: false,
    writesLogs: false,
    redactionRequired: true,
  }, async (event) => {
    nonMatchingReceived.push(event);
    return {
      subscriberId: 'synthetic-non-matching-subscriber',
      eventType: event.eventType,
    };
  });

  const result = await registry.dispatch({
    eventType: 'test.lifecycle.registry.match',
    traceId: 'trace-synthetic-subscriber-registry',
    correlationId: 'correlation-synthetic-subscriber-registry',
    taskId: 'task-synthetic-subscriber-registry',
    siteKey: 'example',
    taskType: 'registry-test',
    adapterVersion: 'fixture-adapter-v1',
    createdAt: '2026-05-07T00:00:00.000Z',
    details: {
      status: 'blocked',
    },
  });

  assert.equal(assertLifecycleEventCompatible(result.event), true);
  assert.equal(result.event.schemaVersion, LIFECYCLE_EVENT_SCHEMA_VERSION);
  assert.equal(result.event.eventType, 'test.lifecycle.registry.match');
  assert.equal(received.length, 1);
  assert.equal(nonMatchingReceived.length, 0);
  assert.equal(received[0].schemaVersion, LIFECYCLE_EVENT_SCHEMA_VERSION);
  assert.equal(received[0].eventType, 'test.lifecycle.registry.match');
  assert.deepEqual(result.subscriberResults, [{
    subscriberId: 'synthetic-in-memory-subscriber',
    eventType: 'test.lifecycle.registry.match',
    traceId: 'trace-synthetic-subscriber-registry',
  }]);
});

test('LifecycleEvent subscriber registry lists safe descriptors without functions', () => {
  const { create } = loadLifecycleEventSubscriberRegistryApi();
  const registry = create();

  registerLifecycleSubscriber(registry, {
    subscriberId: 'synthetic-descriptor-only-subscriber',
    eventTypes: ['test.lifecycle.registry.descriptor'],
    descriptorOnly: true,
    inMemory: true,
    externalTelemetry: false,
    writesArtifacts: false,
    writesLogs: false,
    redactionRequired: true,
    owner: 'Layer',
  }, async () => ({
    subscriberId: 'synthetic-descriptor-only-subscriber',
    status: 'received',
  }));

  const descriptors = registry.listSubscriberDescriptors();

  assert.equal(Array.isArray(descriptors), true);
  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0].subscriberId, 'synthetic-descriptor-only-subscriber');
  assert.deepEqual(descriptors[0].eventTypes, ['test.lifecycle.registry.descriptor']);
  assert.equal(descriptors[0].redactionRequired, true);
  assert.equal(assertNoFunctionValues(descriptors), true);
  assert.equal(JSON.stringify(descriptors).includes('subscriber'), true);
  assert.equal(JSON.stringify(descriptors).includes('async'), false);
  assert.equal(JSON.stringify(descriptors).includes('function'), false);
  assert.equal(JSON.stringify(descriptors).includes('synthetic-secret-value'), false);
});

test('LifecycleEvent subscriber registry rejects telemetry write and redaction bypass descriptors', () => {
  const { create } = loadLifecycleEventSubscriberRegistryApi();
  const registry = create();
  const baseDescriptor = {
    subscriberId: 'synthetic-rejected-subscriber',
    eventTypes: ['test.lifecycle.registry.rejected'],
    descriptorOnly: true,
    inMemory: true,
    externalTelemetry: false,
    writesArtifacts: false,
    writesLogs: false,
    redactionRequired: true,
  };

  for (const { name, descriptor, pattern } of [
    {
      name: 'externalTelemetry',
      descriptor: { externalTelemetry: true },
      pattern: /externalTelemetry.*false|externalTelemetry.*disabled|external telemetry/i,
    },
    {
      name: 'writesArtifacts',
      descriptor: { writesArtifacts: true },
      pattern: /writesArtifacts.*false|writesArtifacts.*disabled|artifacts/i,
    },
    {
      name: 'writesLogs',
      descriptor: { writesLogs: true },
      pattern: /writesLogs.*false|writesLogs.*disabled|logs/i,
    },
    {
      name: 'redactionRequired',
      descriptor: { redactionRequired: false },
      pattern: /redactionRequired.*true|redaction required/i,
    },
  ]) {
    assert.throws(
      () => registerLifecycleSubscriber(registry, {
        ...baseDescriptor,
        subscriberId: `synthetic-rejected-${name}`,
        ...descriptor,
      }, async () => ({ status: 'unused' })),
      pattern,
      name,
    );
  }
});

test('LifecycleEvent subscriber registry rejects sensitive descriptor patterns without echoing values', () => {
  const { create } = loadLifecycleEventSubscriberRegistryApi();
  const registry = create();
  const baseDescriptor = {
    subscriberId: 'synthetic-sensitive-rejected-subscriber',
    eventTypes: ['test.lifecycle.registry.sensitive'],
    descriptorOnly: true,
    inMemory: true,
    externalTelemetry: false,
    writesArtifacts: false,
    writesLogs: false,
    redactionRequired: true,
  };

  for (const { name, descriptor, pattern } of [
    {
      name: 'authorization header text',
      descriptor: {
        description: 'Authorization: Bearer synthetic-secret-value',
      },
      pattern: /forbidden|sensitive|authorization/i,
    },
    {
      name: 'cookie key',
      descriptor: {
        cookie: REDACTION_PLACEHOLDER,
      },
      pattern: /forbidden|sensitive|cookie/i,
    },
    {
      name: 'session id key',
      descriptor: {
        sessionId: REDACTION_PLACEHOLDER,
      },
      pattern: /forbidden|sensitive|sessionId|session/i,
    },
    {
      name: 'browser profile key',
      descriptor: {
        browserProfile: REDACTION_PLACEHOLDER,
      },
      pattern: /forbidden|sensitive|browserProfile|profile/i,
    },
  ]) {
    let message;
    try {
      registerLifecycleSubscriber(registry, {
        ...baseDescriptor,
        subscriberId: `synthetic-sensitive-rejected-${name.replaceAll(' ', '-')}`,
        ...descriptor,
      }, async () => ({ status: 'unused' }));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.ok(message, `${name} must fail closed`);
    assert.match(message, pattern, name);
    assert.doesNotMatch(message, /synthetic-secret-value/u, name);
  }
});

test('LifecycleEvent observability field guard rejects incomplete events', () => {
  assert.throws(
    () => assertLifecycleEventObservabilityFields({
      schemaVersion: LIFECYCLE_EVENT_SCHEMA_VERSION,
      eventType: 'test.lifecycle.incomplete',
      traceId: 'trace-synthetic-incomplete',
      correlationId: 'correlation-synthetic-incomplete',
      siteKey: 'example',
      taskType: 'download',
      createdAt: '2026-05-01T04:10:00.000Z',
      details: {},
    }),
    /taskId/u,
  );
  assert.throws(
    () => assertLifecycleEventObservabilityFields({
      schemaVersion: LIFECYCLE_EVENT_SCHEMA_VERSION,
      eventType: 'test.lifecycle.incomplete-details',
      traceId: 'trace-synthetic-incomplete',
      correlationId: 'correlation-synthetic-incomplete',
      taskId: 'task-synthetic-incomplete',
      siteKey: 'example',
      taskType: 'download',
      createdAt: '2026-05-01T04:10:00.000Z',
      details: {},
    }, {
      requiredDetailFields: ['riskState'],
    }),
    /riskState/u,
  );
});

test('LifecycleEvent producer inventory is versioned, safe, and aligned with runtime producers', () => {
  const inventory = createLifecycleEventProducerInventory();
  assert.equal(inventory.schemaVersion, LIFECYCLE_EVENT_PRODUCER_INVENTORY_SCHEMA_VERSION);
  assert.deepEqual(inventory.descriptorPolicy, LIFECYCLE_EVENT_PRODUCER_DESCRIPTOR_POLICY);
  assert.equal(assertLifecycleEventProducerInventoryCompatible(inventory), true);

  const inventoryEventTypes = listLifecycleEventProducerEventTypes({ inventory }).sort();
  assert.deepEqual(inventoryEventTypes, discoverRuntimeLifecycleProducerEventTypes());

  const summary = summarizeLifecycleEventProducerInventory({ inventory });
  assert.deepEqual(summary, {
    schemaVersion: LIFECYCLE_EVENT_PRODUCER_INVENTORY_SCHEMA_VERSION,
    eventTypeCount: 13,
    producerModuleCounts: {
      'src/domain/capabilities/api-candidates.mjs': 6,
      'src/domain/policies/execution/layer-runtime-consumer.mjs': 1,
      'src/domain/risks/site-health-execution-gate.mjs': 3,
      'src/domain/capabilities/site-capability-graph.mjs': 1,
      'src/domain/sessions/runner.mjs': 1,
      'src/sites/known-sites/social/actions/router.mjs': 1,
    },
    profiledEventTypeCount: Object.keys(LIFECYCLE_EVENT_OBSERVABILITY_PROFILES).length,
    profiledEventTypes: [
      'api.catalog.collection.written',
      'api.catalog.index.written',
      'api.catalog.schema_incompatible',
      'api.catalog.upgrade_decision.written',
      'execution.layer.consumer.receipt',
      'site.health.recovery.evaluated',
      'site.health.recovery.action.planned',
      'site.health.recovery.safe_stop',
      'social.action.risk_blocked',
    ],
    inventoriedOnlyEventTypes: [
      'api.candidate.verified',
      'api.catalog.verification.written',
      'graph.docs.summary.generated',
      'session.run.completed',
    ],
  });

  const producersByEventType = new Map(inventory.producers.map((producer) => [producer.eventType, producer]));
  for (const eventType of Object.keys(LIFECYCLE_EVENT_OBSERVABILITY_PROFILES)) {
    assert.equal(producersByEventType.get(eventType).profileStatus, 'profiled');
  }
  for (const producer of inventory.producers) {
    assert.equal(fs.existsSync(path.join(REPO_ROOT, producer.sourceModule)), true);
  }
  assert.deepEqual(producersByEventType.get('graph.docs.summary.generated'), {
    eventType: 'graph.docs.summary.generated',
    producerId: 'site-capability-graph.docs-summary-generated',
    sourceModule: 'src/domain/capabilities/site-capability-graph.mjs',
    profileStatus: 'inventoried',
  });

  const json = JSON.stringify(inventory);
  assert.equal(json.includes('Bearer '), false);
  assert.equal(json.includes('SESSDATA'), false);
  assert.equal(json.includes('synthetic-secret'), false);
  assert.equal(json.includes('browser-profiles'), false);

  assert.throws(
    () => assertLifecycleEventProducerInventoryCompatible({
      ...inventory,
      producers: [inventory.producers[0], inventory.producers[0]],
    }),
    /Duplicate LifecycleEvent producer eventType/u,
  );
  assert.throws(
    () => createLifecycleEventProducerInventory({
      producers: [{
        eventType: 'api.catalog.collection.written',
        producerId: 'unsafe-profile-status',
        sourceModule: 'src/domain/capabilities/api-candidates.mjs',
        profileStatus: 'inventoried',
      }],
    }),
    /profileStatus must be profiled/u,
  );
  assert.throws(
    () => createLifecycleEventProducerInventory({
      producers: [{
        eventType: 'synthetic.unprofiled',
        producerId: 'unsafe-function',
        sourceModule: 'src/domain/risks/reason-codes.mjs',
        profileStatus: 'inventoried',
        discover: () => {},
      }],
    }),
    /must not include executable functions/u,
  );
});

test('LifecycleEvent producer inventory no longer exposes retired download runtime producers', () => {
  const inventory = createLifecycleEventProducerInventory();
  const summary = summarizeLifecycleEventProducerInventory({ inventory });
  for (const eventType of [
    'download.run.terminal',
    'download.executor.before_download',
    'download.executor.completed',
    'download.executor.dry_run',
    'download.legacy.completed',
    'download.legacy.recovery_preflight',
  ]) {
    assert.equal(Object.hasOwn(LIFECYCLE_EVENT_OBSERVABILITY_PROFILES, eventType), false);
    assert.equal(summary.profiledEventTypes.includes(eventType), false);
    assert.equal(summary.inventoriedOnlyEventTypes.includes(eventType), false);
  }
  assert.equal(Object.keys(summary.producerModuleCounts).some((modulePath) => (
    modulePath.startsWith('src/sites/downloads/')
  )), false);
});

test('LifecycleEvent producer observability profile fails closed for API catalog schema incompatibility', async () => {
  assert.equal(Object.hasOwn(LIFECYCLE_EVENT_OBSERVABILITY_PROFILES, 'api.catalog.schema_incompatible'), true);
  const completeEvent = {
    schemaVersion: LIFECYCLE_EVENT_SCHEMA_VERSION,
    eventType: 'api.catalog.schema_incompatible',
    traceId: 'trace-synthetic-api-catalog-profile',
    correlationId: 'correlation-synthetic-api-catalog-profile',
    taskId: 'task-synthetic-api-catalog-profile',
    siteKey: 'example',
    taskType: 'api-catalog-maintenance',
    adapterVersion: 'api-catalog-adapter-v1',
    reasonCode: 'schema-version-incompatible',
    createdAt: '2026-05-03T00:05:00.000Z',
    details: {
      operation: 'api-catalog-entry-write',
      schemaName: 'ApiCandidate',
      expectedVersion: 1,
      receivedVersion: 2,
      failClosed: true,
      artifactWriteAllowed: false,
      retryable: false,
      manualRecoveryNeeded: true,
      reasonRecovery: {
        code: 'schema-version-incompatible',
      },
      capabilityHookMatches: {
        matchCount: 0,
        phases: [],
        matches: [],
      },
    },
  };

  for (const field of [
    'traceId',
    'correlationId',
    'taskId',
    'siteKey',
    'taskType',
    'adapterVersion',
    'reasonCode',
  ]) {
    const incompleteEvent = { ...completeEvent, [field]: undefined };
    assert.throws(
      () => assertLifecycleEventProducerObservability(incompleteEvent),
      new RegExp(field, 'u'),
    );
  }

  for (const field of [
    'operation',
    'schemaName',
    'expectedVersion',
    'receivedVersion',
    'failClosed',
    'artifactWriteAllowed',
    'retryable',
    'manualRecoveryNeeded',
    'reasonRecovery',
    'capabilityHookMatches',
  ]) {
    const incompleteEvent = {
      ...completeEvent,
      details: {
        ...completeEvent.details,
        [field]: undefined,
      },
    };
    assert.throws(
      () => assertLifecycleEventProducerObservability(incompleteEvent),
      new RegExp(field, 'u'),
    );
  }

  const result = await dispatchLifecycleEvent(completeEvent);
  assert.equal(result.event.eventType, 'api.catalog.schema_incompatible');
  assert.equal(result.event.reasonCode, 'schema-version-incompatible');
  assert.equal(result.event.details.failClosed, true);
});

test('LifecycleEvent producer observability profile fails closed for API catalog upgrade decisions', async () => {
  assert.equal(Object.hasOwn(LIFECYCLE_EVENT_OBSERVABILITY_PROFILES, 'api.catalog.upgrade_decision.written'), true);
  const completeEvent = {
    schemaVersion: LIFECYCLE_EVENT_SCHEMA_VERSION,
    eventType: 'api.catalog.upgrade_decision.written',
    traceId: 'trace-synthetic-api-catalog-upgrade-profile',
    correlationId: 'correlation-synthetic-api-catalog-upgrade-profile',
    taskId: 'upgrade-synthetic-candidate',
    siteKey: 'example',
    taskType: 'api-catalog-upgrade',
    adapterVersion: 'api-catalog-adapter-v1',
    reasonCode: 'api-catalog-entry-blocked',
    createdAt: '2026-05-03T00:05:30.000Z',
    details: {
      candidateId: 'upgrade-synthetic-candidate',
      adapterId: 'example-api-adapter',
      decision: 'blocked',
      canEnterCatalog: false,
      catalogAction: 'block',
      requirements: {
        manualReview: true,
      },
    },
  };

  for (const field of [
    'traceId',
    'correlationId',
    'taskId',
    'siteKey',
    'taskType',
    'adapterVersion',
    'reasonCode',
  ]) {
    assert.throws(
      () => assertLifecycleEventProducerObservability({ ...completeEvent, [field]: undefined }),
      new RegExp(field, 'u'),
    );
  }

  for (const field of [
    'candidateId',
    'adapterId',
    'decision',
    'canEnterCatalog',
    'catalogAction',
    'requirements',
  ]) {
    assert.throws(
      () => assertLifecycleEventProducerObservability({
        ...completeEvent,
        details: {
          ...completeEvent.details,
          [field]: undefined,
        },
      }),
      new RegExp(field, 'u'),
    );
  }

  const result = await dispatchLifecycleEvent(completeEvent);
  assert.equal(result.event.eventType, 'api.catalog.upgrade_decision.written');
  assert.equal(result.event.reasonCode, 'api-catalog-entry-blocked');
  assert.equal(result.event.details.catalogAction, 'block');
});

test('LifecycleEvent producer observability profile fails closed for social risk-blocked producers', async () => {
  assert.equal(Object.hasOwn(LIFECYCLE_EVENT_OBSERVABILITY_PROFILES, 'social.action.risk_blocked'), true);
  const completeEvent = {
    schemaVersion: LIFECYCLE_EVENT_SCHEMA_VERSION,
    eventType: 'social.action.risk_blocked',
    traceId: 'trace-synthetic-social-risk-profile',
    correlationId: 'x:full-archive',
    taskId: 'x:full-archive',
    siteKey: 'x',
    taskType: 'full-archive',
    adapterVersion: 'social-action-router-v1',
    reasonCode: 'request-burst',
    createdAt: '2026-05-03T00:08:00.000Z',
    details: {
      status: 'paused',
      reason: 'api-rate-limited',
      stopReason: 'rate-limited',
      riskSignals: ['api-429'],
      riskState: {
        schemaVersion: 1,
        state: 'rate_limited',
        reasonCode: 'request-burst',
        scope: 'api',
        siteKey: 'x',
        taskId: 'x:full-archive',
        transition: {
          from: 'normal',
          to: 'rate_limited',
          observedAt: '2026-05-03T00:08:00.000Z',
        },
        recovery: {
          retryable: true,
          cooldownNeeded: true,
          isolationNeeded: false,
          manualRecoveryNeeded: false,
          degradable: true,
          artifactWriteAllowed: true,
        },
      },
    },
  };

  for (const field of [
    'traceId',
    'correlationId',
    'taskId',
    'siteKey',
    'taskType',
    'adapterVersion',
    'reasonCode',
  ]) {
    assert.throws(
      () => assertLifecycleEventProducerObservability({ ...completeEvent, [field]: undefined }),
      new RegExp(field, 'u'),
    );
  }

  for (const field of [
    'status',
    'reason',
    'stopReason',
    'riskSignals',
    'riskState',
  ]) {
    assert.throws(
      () => assertLifecycleEventProducerObservability({
        ...completeEvent,
        details: {
          ...completeEvent.details,
          [field]: undefined,
        },
      }),
      new RegExp(field, 'u'),
    );
  }

  for (const [field, riskState] of [
    ['riskState.transition', { ...completeEvent.details.riskState, transition: undefined }],
    ['riskState.transition.from', {
      ...completeEvent.details.riskState,
      transition: {
        ...completeEvent.details.riskState.transition,
        from: undefined,
      },
    }],
    ['riskState.transition.to', {
      ...completeEvent.details.riskState,
      transition: {
        ...completeEvent.details.riskState.transition,
        to: undefined,
      },
    }],
    ['riskState.recovery', { ...completeEvent.details.riskState, recovery: undefined }],
  ]) {
    await assert.rejects(
      () => dispatchLifecycleEvent({
        ...completeEvent,
        details: {
          ...completeEvent.details,
          riskState,
        },
      }),
      new RegExp(field.replace('.', '\\.'), 'u'),
    );
  }

  const result = await dispatchLifecycleEvent(completeEvent);
  assert.equal(result.event.eventType, 'social.action.risk_blocked');
  assert.equal(result.event.reasonCode, 'request-burst');
  assert.equal(result.event.details.riskState.transition.to, 'rate_limited');
});

test('LifecycleEvent producer observability profiles fail closed for API catalog collection and index writes', async () => {
  assert.equal(Object.hasOwn(LIFECYCLE_EVENT_OBSERVABILITY_PROFILES, 'api.catalog.collection.written'), true);
  assert.equal(Object.hasOwn(LIFECYCLE_EVENT_OBSERVABILITY_PROFILES, 'api.catalog.index.written'), true);

  const completeCollectionEvent = {
    schemaVersion: LIFECYCLE_EVENT_SCHEMA_VERSION,
    eventType: 'api.catalog.collection.written',
    traceId: 'trace-synthetic-api-catalog-collection-profile',
    correlationId: 'correlation-synthetic-api-catalog-collection-profile',
    taskId: 'catalog-synthetic-main',
    siteKey: 'example',
    taskType: 'api-catalog-maintenance',
    adapterVersion: 'api-catalog-adapter-v1',
    reasonCode: 'api-catalog-write-failed',
    createdAt: '2026-05-03T00:06:00.000Z',
    details: {
      catalogId: 'catalog-synthetic-main',
      catalogVersion: 'catalog-v1',
      generatedAt: '2026-05-03T00:06:00.000Z',
      entryCount: 1,
      siteKeys: ['example'],
      statuses: {
        cataloged: 1,
      },
      invalidationStatuses: {
        active: 1,
      },
      reasonCodes: {
        'api-catalog-write-failed': 1,
      },
      reasonRecoveries: {
        'api-catalog-write-failed': {
          code: 'api-catalog-write-failed',
        },
      },
    },
  };
  const completeIndexEvent = {
    schemaVersion: LIFECYCLE_EVENT_SCHEMA_VERSION,
    eventType: 'api.catalog.index.written',
    traceId: 'trace-synthetic-api-catalog-index-profile',
    correlationId: 'correlation-synthetic-api-catalog-index-profile',
    taskId: 'index-synthetic-main',
    siteKey: 'example',
    taskType: 'api-catalog-maintenance',
    adapterVersion: 'api-catalog-adapter-v1',
    reasonCode: 'api-catalog-write-failed',
    createdAt: '2026-05-03T00:07:00.000Z',
    details: {
      indexVersion: 'index-v1',
      indexGeneratedAt: '2026-05-03T00:07:00.000Z',
      catalogCount: 1,
      totalEntryCount: 1,
      reasonCodes: {
        'api-catalog-write-failed': 1,
      },
      reasonRecoveries: {
        'api-catalog-write-failed': {
          code: 'api-catalog-write-failed',
        },
      },
      catalogs: [{
        catalogId: 'catalog-synthetic-main',
        catalogVersion: 'catalog-v1',
        entryCount: 1,
      }],
    },
  };

  for (const event of [completeCollectionEvent, completeIndexEvent]) {
    for (const field of [
      'traceId',
      'correlationId',
      'taskId',
      'siteKey',
      'taskType',
      'adapterVersion',
      'reasonCode',
    ]) {
      assert.throws(
        () => assertLifecycleEventProducerObservability({ ...event, [field]: undefined }),
        new RegExp(field, 'u'),
      );
    }
  }

  for (const field of [
    'catalogId',
    'catalogVersion',
    'generatedAt',
    'entryCount',
    'siteKeys',
    'statuses',
    'invalidationStatuses',
    'reasonCodes',
    'reasonRecoveries',
  ]) {
    assert.throws(
      () => assertLifecycleEventProducerObservability({
        ...completeCollectionEvent,
        details: {
          ...completeCollectionEvent.details,
          [field]: undefined,
        },
      }),
      new RegExp(field, 'u'),
    );
  }

  for (const field of [
    'indexVersion',
    'indexGeneratedAt',
    'catalogCount',
    'totalEntryCount',
    'reasonCodes',
    'reasonRecoveries',
    'catalogs',
  ]) {
    assert.throws(
      () => assertLifecycleEventProducerObservability({
        ...completeIndexEvent,
        details: {
          ...completeIndexEvent.details,
          [field]: undefined,
        },
      }),
      new RegExp(field, 'u'),
    );
  }

  const collectionResult = await dispatchLifecycleEvent(completeCollectionEvent);
  const indexResult = await dispatchLifecycleEvent(completeIndexEvent);
  assert.equal(collectionResult.event.eventType, 'api.catalog.collection.written');
  assert.equal(collectionResult.event.reasonCode, 'api-catalog-write-failed');
  assert.equal(indexResult.event.eventType, 'api.catalog.index.written');
  assert.equal(indexResult.event.reasonCode, 'api-catalog-write-failed');
});

test('LifecycleEvent artifact writer persists redacted event and audit with observability ids', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'lifecycle-event-'));
  try {
    const eventPath = path.join(runDir, 'event.json');
    const auditPath = path.join(runDir, 'event.redaction-audit.json');
    const result = await writeLifecycleEventArtifact({
      eventType: 'test.lifecycle.redacted',
      traceId: 'trace-synthetic-redacted',
      correlationId: 'correlation-synthetic-redacted',
      taskId: 'task-synthetic-redacted',
      siteKey: 'example',
      createdAt: '2026-05-01T04:30:00.000Z',
      details: {
        authorization: 'Bearer synthetic-lifecycle-token',
        nested: {
          csrf: 'synthetic-lifecycle-csrf',
        },
      },
    }, {
      eventPath,
      auditPath,
    });

    const eventText = await readFile(eventPath, 'utf8');
    const auditText = await readFile(auditPath, 'utf8');
    const event = JSON.parse(eventText);
    const audit = JSON.parse(auditText);

    assert.equal(result.artifacts.lifecycleEvent, eventPath);
    assert.equal(result.artifacts.lifecycleEventRedactionAudit, auditPath);
    assert.deepEqual(result.redactionSummary, {
      redactedPathCount: 2,
      findingCount: 0,
    });
    assert.equal(event.schemaVersion, LIFECYCLE_EVENT_SCHEMA_VERSION);
    assert.equal(event.traceId, 'trace-synthetic-redacted');
    assert.equal(event.correlationId, 'correlation-synthetic-redacted');
    assert.equal(event.details.authorization, REDACTION_PLACEHOLDER);
    assert.equal(event.details.nested.csrf, REDACTION_PLACEHOLDER);
    assert.equal(Object.hasOwn(event, 'redactionSummary'), false);
    assert.equal(Object.hasOwn(audit, 'redactionSummary'), false);
    assert.equal(audit.redactedPaths.includes('details.authorization'), true);
    assert.equal(audit.redactedPaths.includes('details.nested.csrf'), true);
    assert.equal(eventText.includes('synthetic-lifecycle-token'), false);
    assert.equal(eventText.includes('synthetic-lifecycle-csrf'), false);
    assert.equal(eventText.includes('redactionSummary'), false);
    assert.equal(auditText.includes('synthetic-lifecycle-token'), false);
    assert.equal(auditText.includes('synthetic-lifecycle-csrf'), false);
    assert.equal(auditText.includes('redactionSummary'), false);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('LifecycleEvent dispatch sends normalized observability identifiers to subscribers', async () => {
  const received = [];
  const result = await dispatchLifecycleEvent({
    eventType: 'test.lifecycle.dispatch',
    traceId: 'trace-synthetic-dispatch',
    correlationId: 'correlation-synthetic-dispatch',
    taskId: 'task-synthetic-dispatch',
    siteKey: 'example',
    createdAt: '2026-05-01T05:00:00.000Z',
  }, {
    subscribers: [
      async (event) => {
        received.push(event);
        return { accepted: true };
      },
    ],
  });

  assert.equal(result.event.schemaVersion, LIFECYCLE_EVENT_SCHEMA_VERSION);
  assert.equal(result.event.traceId, 'trace-synthetic-dispatch');
  assert.equal(result.event.correlationId, 'correlation-synthetic-dispatch');
  assert.deepEqual(result.subscriberResults, [{ accepted: true }]);
  assert.equal(received.length, 1);
  assert.equal(received[0].traceId, 'trace-synthetic-dispatch');
  assert.equal(received[0].correlationId, 'correlation-synthetic-dispatch');
});
