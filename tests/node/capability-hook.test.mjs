import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CAPABILITY_HOOK_DESCRIPTOR_POLICY,
  CAPABILITY_HOOK_CRITICAL_PRODUCER_EVENT_TYPES,
  CAPABILITY_HOOK_EVENT_TYPES,
  CAPABILITY_HOOK_EVENT_TYPE_REGISTRY_SCHEMA_VERSION,
  CAPABILITY_HOOK_EXECUTION_POLICY,
  CAPABILITY_HOOK_EXECUTION_POLICY_SCHEMA_VERSION,
  CAPABILITY_HOOK_PHASES,
  CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_POLICY,
  CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_REGISTRY_SCHEMA_VERSION,
  CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION,
  CAPABILITY_HOOK_SCHEMA_VERSION,
  CAPABILITY_HOOK_TYPES,
  assertCapabilityHookEventTypeRegistryCompatible,
  assertCapabilityHookProducerDescriptorCompatible,
  assertCapabilityHookProducerDescriptorRegistryCompatible,
  assertCapabilityHookRegistrySnapshotCompatible,
  assertCapabilityHookCompatible,
  assertHookExecutionPolicyCompatible,
  createCapabilityHookEventTypeRegistry,
  createCapabilityHookLifecycleEvidence,
  createCapabilityHookProducerDescriptorRegistry,
  createCapabilityHookRegistry,
  createCapabilityHookRegistrySnapshot,
  matchCapabilityHooksForLifecycleEvent,
  normalizeCapabilityHook,
  normalizeCapabilityHookSubscriber,
} from '../../src/sites/capability/capability-hook.mjs';

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

function lifecycleEventProducerBlock(source, eventType) {
  const eventTypeIndex = source.indexOf(`eventType: '${eventType}'`);
  assert.notEqual(eventTypeIndex, -1, `LifecycleEvent producer ${eventType} must exist`);
  const startIndex = source.lastIndexOf('normalizeLifecycleEvent({', eventTypeIndex);
  assert.notEqual(startIndex, -1, `LifecycleEvent producer ${eventType} must normalize the event`);
  const schemaCompatibleIndex = source.indexOf("assertSchemaCompatible('LifecycleEvent',", eventTypeIndex);
  const governedSchemaCompatibleIndex = source.indexOf("assertGovernedSchemaCompatible('LifecycleEvent',", eventTypeIndex);
  const lifecycleCompatibleIndex = source.indexOf('assertLifecycleEventCompatible(', eventTypeIndex);
  const endIndex = [schemaCompatibleIndex, governedSchemaCompatibleIndex, lifecycleCompatibleIndex]
    .filter((index) => index !== -1)
    .sort((left, right) => left - right)[0] ?? -1;
  assert.notEqual(endIndex, -1, `LifecycleEvent producer ${eventType} must check compatibility before dispatch/write`);
  return source.slice(startIndex, endIndex);
}

test('CapabilityHook normalizes a safe versioned hook descriptor', () => {
  const hook = normalizeCapabilityHook({
    schemaVersion: CAPABILITY_HOOK_SCHEMA_VERSION,
    phase: 'before_download',
    hookType: 'guard',
    subscriber: {
      name: 'download-policy-boundary',
      modulePath: 'src/sites/capability/download-policy.mjs',
      entrypoint: 'normalizeDownloadPolicy',
      capability: 'download-policy',
      order: 10,
    },
    reasonCode: 'session-required',
  });

  assert.deepEqual(hook, {
    schemaVersion: CAPABILITY_HOOK_SCHEMA_VERSION,
    id: 'before_download:download-policy-boundary',
    phase: 'before_download',
    hookType: 'guard',
    subscriber: {
      name: 'download-policy-boundary',
      modulePath: 'src/sites/capability/download-policy.mjs',
      entrypoint: 'normalizeDownloadPolicy',
      capability: 'download-policy',
      order: 10,
    },
    reasonCode: 'session-required',
    safety: {
      failClosed: true,
      redactionRequired: true,
      artifactWriteAllowed: false,
    },
  });
});

test('CapabilityHook exposes the design lifecycle phases and hook types', () => {
  assert.equal(CAPABILITY_HOOK_PHASES.includes('before_task'), true);
  assert.equal(CAPABILITY_HOOK_PHASES.includes('after_task'), true);
  assert.equal(CAPABILITY_HOOK_PHASES.includes('before_candidate_write'), true);
  assert.equal(CAPABILITY_HOOK_PHASES.includes('after_catalog_verify'), true);
  assert.equal(CAPABILITY_HOOK_PHASES.includes('before_session_materialize'), true);
  assert.equal(CAPABILITY_HOOK_PHASES.includes('before_artifact_write'), true);
  assert.equal(CAPABILITY_HOOK_PHASES.includes('on_risk'), true);
  assert.equal(CAPABILITY_HOOK_PHASES.includes('on_cooldown'), true);
  assert.equal(CAPABILITY_HOOK_PHASES.includes('on_manual_recovery_required'), true);
  assert.equal(CAPABILITY_HOOK_PHASES.includes('on_failure'), true);
  assert.equal(CAPABILITY_HOOK_PHASES.includes('on_completion'), true);
  assert.deepEqual(CAPABILITY_HOOK_TYPES, [
    'observer',
    'guard',
    'transform',
    'artifact_writer',
  ]);
  assert.equal(CAPABILITY_HOOK_EVENT_TYPES.includes('capture.manifest.written'), true);
  assert.equal(CAPABILITY_HOOK_EVENT_TYPES.includes('api.catalog.verification.written'), true);
  assert.equal(CAPABILITY_HOOK_EVENT_TYPES.includes('download.executor.before_download'), true);
  assert.equal(CAPABILITY_HOOK_EVENT_TYPES.includes('download.executor.completed'), true);
  assert.equal(CAPABILITY_HOOK_EVENT_TYPES.includes('session.run.completed'), true);
  assert.equal(CAPABILITY_HOOK_EVENT_TYPES.includes('social.action.risk_blocked'), true);
});

test('CapabilityHook artifact writers are redaction-required and fail closed by default', () => {
  const hook = normalizeCapabilityHook({
    phase: 'before_artifact_write',
    hookType: 'artifact_writer',
    subscriber: {
      name: 'redacted-artifact-writer',
    },
  });

  assert.equal(hook.safety.failClosed, true);
  assert.equal(hook.safety.redactionRequired, true);
  assert.equal(hook.safety.artifactWriteAllowed, true);
  assert.throws(
    () => normalizeCapabilityHook({
      phase: 'before_artifact_write',
      hookType: 'artifact_writer',
      subscriber: { name: 'unsafe-writer' },
      safety: {
        redactionRequired: false,
        artifactWriteAllowed: true,
      },
    }),
    /artifact writes require redaction/u,
  );
});

test('CapabilityHook rejects unsupported phases, types, subscribers, and reason codes', () => {
  assert.throws(
    () => normalizeCapabilityHook({
      phase: 'captcha_bypass',
      subscriber: { name: 'unsafe' },
    }),
    /Unsupported CapabilityHook phase/u,
  );
  assert.throws(
    () => normalizeCapabilityHook({
      phase: 'on_failure',
      hookType: 'runner',
      subscriber: { name: 'unsafe' },
    }),
    /Unsupported CapabilityHook type/u,
  );
  assert.throws(
    () => normalizeCapabilityHook({
      phase: 'on_failure',
      subscriber: { name: 'failure-handler' },
      reasonCode: 'unknown-hook-reason',
    }),
    /Unknown reasonCode/u,
  );
  assert.throws(
    () => normalizeCapabilityHook({
      phase: 'after_download',
      subscriber: { name: 'unsupported-event-type' },
      filters: {
        eventTypes: ['download.secret.internal'],
      },
    }),
    /Unsupported CapabilityHook eventType/u,
  );
  assert.throws(
    () => normalizeCapabilityHookSubscriber({ name: 'executable', handler: () => {} }),
    /must not include executable functions/u,
  );
  assert.throws(
    () => normalizeCapabilityHookSubscriber({ modulePath: 'src/example.mjs' }),
    /subscriber\.name is required/u,
  );
  assert.throws(
    () => normalizeCapabilityHookSubscriber({ name: 'bad-order', order: -1 }),
    /subscriber\.order must be a non-negative number/u,
  );
});

test('CapabilityHook compatibility guard requires the current schema version', () => {
  assert.equal(assertCapabilityHookCompatible({ schemaVersion: CAPABILITY_HOOK_SCHEMA_VERSION }), true);
  assert.throws(
    () => assertCapabilityHookCompatible({}),
    /schemaVersion is required/u,
  );
  assert.throws(
    () => assertCapabilityHookCompatible({ schemaVersion: CAPABILITY_HOOK_SCHEMA_VERSION + 1 }),
    /not compatible/u,
  );
});

test('CapabilityHook execution policy is versioned, descriptor-only, and fail-closed', () => {
  assert.deepEqual(CAPABILITY_HOOK_EXECUTION_POLICY, {
    schemaVersion: CAPABILITY_HOOK_EXECUTION_POLICY_SCHEMA_VERSION,
    descriptorOnly: true,
    executionMode: 'descriptor_match_only',
    executableDispatchEnabled: false,
    executableHooksAllowed: false,
    hookInvocationAllowed: false,
    failClosed: true,
    sensitiveMaterialAllowed: false,
  });
  assert.equal(assertHookExecutionPolicyCompatible(CAPABILITY_HOOK_EXECUTION_POLICY), true);
  assert.throws(
    () => assertHookExecutionPolicyCompatible({}),
    /schemaVersion is required/u,
  );
  assert.throws(
    () => assertHookExecutionPolicyCompatible({
      ...CAPABILITY_HOOK_EXECUTION_POLICY,
      schemaVersion: CAPABILITY_HOOK_EXECUTION_POLICY_SCHEMA_VERSION + 1,
    }),
    /not compatible/u,
  );
  assert.throws(
    () => assertHookExecutionPolicyCompatible({
      ...CAPABILITY_HOOK_EXECUTION_POLICY,
      executionMode: 'executable_dispatch',
      executableDispatchEnabled: true,
    }),
    /descriptor-only, dispatch-disabled, and fail closed/u,
  );
  assert.throws(
    () => assertHookExecutionPolicyCompatible({
      ...CAPABILITY_HOOK_EXECUTION_POLICY,
      executableHooksAllowed: true,
    }),
    /descriptor-only, dispatch-disabled, and fail closed/u,
  );
  assert.throws(
    () => assertHookExecutionPolicyCompatible({
      ...CAPABILITY_HOOK_EXECUTION_POLICY,
      hookInvocationAllowed: true,
    }),
    /descriptor-only, dispatch-disabled, and fail closed/u,
  );
  assert.throws(
    () => assertHookExecutionPolicyCompatible({
      ...CAPABILITY_HOOK_EXECUTION_POLICY,
      failClosed: false,
    }),
    /descriptor-only, dispatch-disabled, and fail closed/u,
  );
  assert.throws(
    () => assertHookExecutionPolicyCompatible({
      ...CAPABILITY_HOOK_EXECUTION_POLICY,
      dispatch: () => {},
    }),
    /must not include executable functions/u,
  );
});

test('CapabilityHook event type registry is versioned and compatible with producer inventory', () => {
  const registry = createCapabilityHookEventTypeRegistry();
  assert.deepEqual(registry, {
    schemaVersion: CAPABILITY_HOOK_EVENT_TYPE_REGISTRY_SCHEMA_VERSION,
    eventTypes: CAPABILITY_HOOK_EVENT_TYPES,
  });
  assert.equal(assertCapabilityHookEventTypeRegistryCompatible(registry), true);
  assert.throws(
    () => assertCapabilityHookEventTypeRegistryCompatible({ eventTypes: CAPABILITY_HOOK_EVENT_TYPES }),
    /schemaVersion is required/u,
  );
  assert.throws(
    () => assertCapabilityHookEventTypeRegistryCompatible({
      schemaVersion: CAPABILITY_HOOK_EVENT_TYPE_REGISTRY_SCHEMA_VERSION + 1,
      eventTypes: CAPABILITY_HOOK_EVENT_TYPES,
    }),
    /not compatible/u,
  );
  assert.throws(
    () => assertCapabilityHookEventTypeRegistryCompatible({
      schemaVersion: CAPABILITY_HOOK_EVENT_TYPE_REGISTRY_SCHEMA_VERSION,
      eventTypes: [...CAPABILITY_HOOK_EVENT_TYPES, 'download.secret.internal'],
    }),
    /Unsupported CapabilityHook eventType/u,
  );
  assert.throws(
    () => assertCapabilityHookEventTypeRegistryCompatible({
      schemaVersion: CAPABILITY_HOOK_EVENT_TYPE_REGISTRY_SCHEMA_VERSION,
      eventTypes: CAPABILITY_HOOK_EVENT_TYPES.slice(1),
    }),
    /must match current runtime producer inventory/u,
  );
});

test('CapabilityHook producer descriptor registry fails closed for high-risk producers', () => {
  const registry = createCapabilityHookProducerDescriptorRegistry();

  assert.equal(registry.schemaVersion, CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_REGISTRY_SCHEMA_VERSION);
  assert.deepEqual(registry.descriptorPolicy, CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_POLICY);
  assert.equal(assertCapabilityHookProducerDescriptorRegistryCompatible(registry), true);
  assert.deepEqual(
    registry.producers.map((producer) => producer.eventType).sort(),
    [...CAPABILITY_HOOK_CRITICAL_PRODUCER_EVENT_TYPES].sort(),
  );

  const producersByEventType = new Map(
    registry.producers.map((producer) => [producer.eventType, producer]),
  );
  assert.deepEqual(producersByEventType.get('session.run.completed').phaseHints, [
    'after_session_materialize',
    'on_completion',
  ]);
  assert.deepEqual(producersByEventType.get('download.run.terminal').phaseHints, [
    'after_download',
    'on_completion',
  ]);
  assert.deepEqual(producersByEventType.get('social.action.risk_blocked').phaseHints, [
    'on_risk',
    'on_failure',
  ]);

  for (const producer of registry.producers) {
    assert.equal(assertCapabilityHookProducerDescriptorCompatible(producer), true);
    assert.deepEqual(producer.descriptorPolicy, CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_POLICY);
    assert.equal(producer.descriptorPolicy.descriptorOnly, true);
    assert.equal(producer.descriptorPolicy.failClosed, true);
    assert.equal(producer.descriptorPolicy.rawCredentialsAllowed, false);
    assert.equal(producer.descriptorPolicy.rawSessionPayloadsAllowed, false);
    assert.equal(producer.descriptorPolicy.rawProfilePayloadsAllowed, false);
  }

  const json = JSON.stringify(registry);
  assert.equal(json.includes('modulePath'), false);
  assert.equal(json.includes('entrypoint'), false);
  assert.equal(json.includes('synthetic-secret'), false);
  assert.equal(json.includes('synthetic-session-material'), false);
  assert.equal(json.includes('synthetic-browser-profile'), false);

  assert.throws(
    () => assertCapabilityHookProducerDescriptorCompatible({
      ...producersByEventType.get('download.run.terminal'),
      descriptorPolicy: {
        ...CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_POLICY,
        failClosed: false,
      },
    }),
    /descriptor-only and fail closed/u,
  );
  assert.throws(
    () => createCapabilityHookProducerDescriptorRegistry({
      producers: registry.producers.filter((producer) => producer.eventType !== 'session.run.completed'),
    }),
    /must include high-risk producer descriptor: session\.run\.completed/u,
  );
  assert.throws(
    () => assertCapabilityHookProducerDescriptorCompatible({
      ...producersByEventType.get('session.run.completed'),
      sessionMaterial: 'synthetic-session-material',
    }),
    /raw sensitive material field/u,
  );
  assert.throws(
    () => assertCapabilityHookProducerDescriptorCompatible({
      ...producersByEventType.get('social.action.risk_blocked'),
      browserProfilePath: 'synthetic-browser-profile',
    }),
    /raw sensitive material field/u,
  );
  assert.throws(
    () => assertCapabilityHookProducerDescriptorCompatible({
      ...producersByEventType.get('download.run.terminal'),
      rawCredentials: 'synthetic-secret',
    }),
    /raw sensitive material field/u,
  );
});

test('CapabilityHook registry stores normalized descriptors without executing code', () => {
  const registry = createCapabilityHookRegistry();
  const hook = registry.register({
    phase: 'before_download',
    hookType: 'guard',
    subscriber: {
      name: 'download-policy-boundary',
      modulePath: 'src/sites/capability/download-policy.mjs',
      entrypoint: 'normalizeDownloadPolicy',
    },
  });

  assert.equal(registry.size(), 1);
  assert.equal(hook.schemaVersion, CAPABILITY_HOOK_SCHEMA_VERSION);
  assert.equal(hook.id, 'before_download:download-policy-boundary');
  assert.deepEqual(registry.get(hook.id), hook);
  assert.deepEqual(registry.listByPhase('before_download'), [hook]);

  hook.phase = 'on_failure';
  assert.equal(registry.get('before_download:download-policy-boundary').phase, 'before_download');
});

test('CapabilityHook registry snapshot is versioned, compatible, and descriptor-only', () => {
  const registry = createCapabilityHookRegistry([{
    id: 'download-completed-observer',
    phase: 'after_download',
    subscriber: {
      name: 'download-completed-observer',
      modulePath: 'src/sites/capability/lifecycle-events.mjs',
      entrypoint: 'observe',
      order: 3,
    },
    filters: {
      eventTypes: ['download.executor.completed'],
    },
  }]);

  const snapshot = registry.snapshot();
  assert.deepEqual(snapshot, {
    schemaVersion: CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION,
    hooks: [{
      schemaVersion: CAPABILITY_HOOK_SCHEMA_VERSION,
      id: 'download-completed-observer',
      phase: 'after_download',
      hookType: 'observer',
      subscriber: {
        name: 'download-completed-observer',
        modulePath: 'src/sites/capability/lifecycle-events.mjs',
        entrypoint: 'observe',
        order: 3,
      },
      safety: {
        failClosed: true,
        redactionRequired: true,
        artifactWriteAllowed: false,
      },
      filters: {
        eventTypes: ['download.executor.completed'],
      },
    }],
  });
  assert.equal(assertCapabilityHookRegistrySnapshotCompatible(snapshot), true);
  assert.deepEqual(createCapabilityHookRegistrySnapshot(registry), snapshot);

  snapshot.hooks[0].phase = 'on_failure';
  assert.equal(registry.get('download-completed-observer').phase, 'after_download');
});

test('CapabilityHook registry snapshot fails closed for drift, duplicates, and sensitive descriptors', () => {
  const safeSnapshot = createCapabilityHookRegistrySnapshot([{
    id: 'safe-risk-hook',
    phase: 'on_risk',
    subscriber: {
      name: 'risk-observer',
    },
  }]);

  assert.throws(
    () => assertCapabilityHookRegistrySnapshotCompatible({
      ...safeSnapshot,
      schemaVersion: CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION + 1,
    }),
    /not compatible/u,
  );
  assert.throws(
    () => assertCapabilityHookRegistrySnapshotCompatible({
      schemaVersion: CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION,
      hooks: [{ ...safeSnapshot.hooks[0], schemaVersion: CAPABILITY_HOOK_SCHEMA_VERSION + 1 }],
    }),
    /not compatible/u,
  );
  assert.throws(
    () => assertCapabilityHookRegistrySnapshotCompatible({
      schemaVersion: CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION,
      hooks: [safeSnapshot.hooks[0], safeSnapshot.hooks[0]],
    }),
    /Duplicate CapabilityHook id/u,
  );
  assert.throws(
    () => assertCapabilityHookRegistrySnapshotCompatible({
      schemaVersion: CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION,
      hooks: [{
        schemaVersion: CAPABILITY_HOOK_SCHEMA_VERSION,
        id: 'Bearer synthetic-registry-secret',
        phase: 'on_failure',
        subscriber: {
          name: 'unsafe-summary',
        },
      }],
    }),
    /Forbidden sensitive pattern/u,
  );
  assert.throws(
    () => createCapabilityHookRegistrySnapshot({
      list() {
        return [safeSnapshot.hooks[0]];
      },
    }),
    /trusted registry or hook descriptor array/u,
  );
});

test('CapabilityHook registry fails closed for duplicate and unsafe descriptors', () => {
  const registry = createCapabilityHookRegistry([{
    id: 'safe-hook',
    phase: 'before_download',
    subscriber: { name: 'safe-subscriber' },
  }]);
  assert.equal(registry.size(), 1);
  assert.throws(
    () => registry.register({
      id: 'safe-hook',
      phase: 'after_download',
      subscriber: { name: 'another-subscriber' },
    }),
    /Duplicate CapabilityHook id/u,
  );
  assert.throws(
    () => registry.register({
      phase: 'captcha_bypass',
      subscriber: { name: 'unsafe-phase' },
    }),
    /Unsupported CapabilityHook phase/u,
  );
  assert.throws(
    () => registry.register({
      phase: 'before_artifact_write',
      hookType: 'artifact_writer',
      subscriber: { name: 'unsafe-writer' },
      safety: {
        redactionRequired: false,
        artifactWriteAllowed: true,
      },
    }),
    /artifact writes require redaction/u,
  );

  let called = false;
  assert.throws(
    () => registry.register({
      phase: 'on_failure',
      run: () => {
        called = true;
      },
      subscriber: { name: 'executable-hook' },
    }),
    /descriptor must not include executable functions/u,
  );
  assert.throws(
    () => registry.register({
      phase: 'on_failure',
      subscriber: {
        name: 'executable',
        handler: () => {
          called = true;
        },
      },
    }),
    /must not include executable functions/u,
  );
  assert.equal(called, false);
  assert.equal(registry.size(), 1);
});

test('CapabilityHook lifecycle matching rejects untrusted registry-like objects without calling list', () => {
  let called = false;
  const untrustedRegistry = {
    list() {
      called = true;
      return [{
        phase: 'after_download',
        subscriber: { name: 'untrusted-list-subscriber' },
      }];
    },
  };

  assert.throws(
    () => matchCapabilityHooksForLifecycleEvent(untrustedRegistry, {
      eventType: 'download.executor.completed',
      siteKey: 'x',
    }),
    /trusted registry or hook descriptor array/u,
  );
  assert.equal(called, false);
});

test('CapabilityHook lifecycle matching returns redacted descriptor summaries without executing hooks', () => {
  const registry = createCapabilityHookRegistry([
    {
      id: 'download-completed-observer',
      phase: 'after_download',
      hookType: 'observer',
      subscriber: {
        name: 'download-completed-observer',
        modulePath: 'src/sites/capability/lifecycle-events.mjs',
        entrypoint: 'observe',
        capability: 'download-policy',
        order: 5,
      },
      filters: {
        eventTypes: ['download.executor.completed'],
        siteKeys: ['x'],
        taskTypes: ['archive'],
      },
    },
    {
      id: 'before-download-guard',
      phase: 'before_download',
      hookType: 'guard',
      subscriber: {
        name: 'before-download-guard',
        order: 1,
      },
    },
  ]);

  let called = false;
  const result = registry.matchLifecycleEvent({
    eventType: 'download.executor.completed',
    traceId: 'trace-1',
    correlationId: 'corr-1',
    taskId: 'task-1',
    siteKey: 'x',
    taskType: 'archive',
    details: {
      authorization: 'Bearer synthetic-secret',
      callback: 'not-executed',
    },
  });

  assert.equal(called, false);
  assert.equal(result.schemaVersion, CAPABILITY_HOOK_SCHEMA_VERSION);
  assert.deepEqual(result.executionPolicy, CAPABILITY_HOOK_EXECUTION_POLICY);
  assert.deepEqual(result.phases, ['after_download', 'on_completion']);
  assert.equal(result.matchCount, 1);
  assert.deepEqual(result.matches.map((match) => match.id), ['download-completed-observer']);
  assert.equal(result.matches[0].subscriber.name, 'download-completed-observer');
  assert.equal(Object.hasOwn(result.matches[0].subscriber, 'modulePath'), false);
  assert.equal(Object.hasOwn(result.matches[0].subscriber, 'entrypoint'), false);
  assert.deepEqual(result.lifecycleEvent, {
    schemaVersion: 1,
    eventType: 'download.executor.completed',
    traceId: 'trace-1',
    correlationId: 'corr-1',
    taskId: 'task-1',
    siteKey: 'x',
    taskType: 'archive',
  });

  assert.throws(
    () => matchCapabilityHooksForLifecycleEvent(registry.list(), {
      eventType: 'download.executor.completed',
      details: {
        unsafe: () => {
          called = true;
        },
      },
    }),
    /must not include executable functions/u,
  );
  assert.equal(called, false);
  assert.throws(
    () => matchCapabilityHooksForLifecycleEvent(registry.list(), {
      eventType: 'download.executor.completed',
      siteKey: 'x',
    }, {
      executionPolicy: {
        ...CAPABILITY_HOOK_EXECUTION_POLICY,
        executableDispatchEnabled: true,
      },
    }),
    /descriptor-only, dispatch-disabled, and fail closed/u,
  );
  assert.equal(called, false);
});

test('CapabilityHook lifecycle matching honors explicit phase and filters', () => {
  const hooks = [
    {
      id: 'explicit-phase-match',
      phase: 'after_artifact_write',
      hookType: 'artifact_writer',
      subscriber: {
        name: 'artifact-write-observer',
      },
      filters: {
        reasonCodes: ['redaction-failed'],
      },
    },
    {
      id: 'site-mismatch',
      phase: 'after_artifact_write',
      subscriber: {
        name: 'site-mismatch',
      },
      filters: {
        siteKeys: ['instagram'],
      },
    },
  ];

  const result = matchCapabilityHooksForLifecycleEvent(hooks, {
    eventType: 'custom.runtime.event',
    siteKey: 'x',
    reasonCode: 'redaction-failed',
    details: {
      lifecyclePhase: 'after_artifact_write',
    },
  });

  assert.equal(result.matchCount, 1);
  assert.equal(result.matches[0].id, 'explicit-phase-match');
  assert.deepEqual(result.phases, ['after_artifact_write']);

  const noMatch = matchCapabilityHooksForLifecycleEvent(hooks, {
    eventType: 'custom.runtime.event',
    siteKey: 'x',
    reasonCode: 'redaction-failed',
  }, {
    phase: 'before_artifact_write',
  });
  assert.equal(noMatch.matchCount, 0);
});

test('CapabilityHook lifecycle matching infers manual recovery required without executing hooks', () => {
  const registry = createCapabilityHookRegistry([{
    id: 'manual-recovery-observer',
    phase: 'on_manual_recovery_required',
    subscriber: {
      name: 'manual-recovery-observer',
      modulePath: 'src/sites/capability/lifecycle-events.mjs',
      entrypoint: 'observe',
      order: 1,
    },
    filters: {
      reasonCodes: ['session-invalid'],
    },
  }]);

  const result = registry.matchLifecycleEvent({
    eventType: 'session.run.completed',
    traceId: 'trace-synthetic-manual-recovery',
    correlationId: 'correlation-synthetic-manual-recovery',
    taskId: 'task-synthetic-manual-recovery',
    siteKey: 'bilibili',
    taskType: 'session-repair',
    reasonCode: 'session-invalid',
    details: {
      riskState: {
        recovery: {
          manualRecoveryNeeded: true,
        },
      },
    },
  });

  assert.equal(result.matchCount, 1);
  assert.deepEqual(result.phases, [
    'after_session_materialize',
    'on_manual_recovery_required',
    'on_completion',
  ]);
  assert.equal(result.matches[0].id, 'manual-recovery-observer');
  assert.equal(Object.hasOwn(result.matches[0].subscriber, 'modulePath'), false);
  assert.equal(Object.hasOwn(result.matches[0].subscriber, 'entrypoint'), false);
  assert.deepEqual(result.lifecycleEvent, {
    schemaVersion: 1,
    eventType: 'session.run.completed',
    traceId: 'trace-synthetic-manual-recovery',
    correlationId: 'correlation-synthetic-manual-recovery',
    taskId: 'task-synthetic-manual-recovery',
    siteKey: 'bilibili',
    taskType: 'session-repair',
    reasonCode: 'session-invalid',
  });
  assert.equal(JSON.stringify(result).includes('modulePath'), false);
  assert.equal(JSON.stringify(result).includes('entrypoint'), false);
});

test('CapabilityHook lifecycle matching redacts sensitive descriptor text in summaries', () => {
  const result = matchCapabilityHooksForLifecycleEvent([{
    id: 'sensitive-summary',
    phase: 'after_download',
    subscriber: {
      name: 'Bearer synthetic-secret',
    },
  }], {
    eventType: 'download.executor.completed',
    siteKey: 'bilibili',
  });

  const json = JSON.stringify(result);
  assert.equal(result.matchCount, 1);
  assert.match(json, /\[REDACTED\]/u);
  assert.doesNotMatch(json, /synthetic-secret/u);
  assert.doesNotMatch(json, /Bearer/u);
});

test('CapabilityHook lifecycle evidence summarizes capture phases and matches without executable hooks', () => {
  const registry = createCapabilityHookRegistry([
    {
      id: 'capture-observer',
      phase: 'after_capture',
      subscriber: {
        name: 'capture-observer',
        modulePath: 'src/sites/capability/lifecycle-events.mjs',
        entrypoint: 'observe',
        capability: 'capture',
        order: 2,
      },
      filters: {
        eventTypes: ['capture.api_candidates.written'],
        siteKeys: ['bilibili'],
      },
    },
    {
      id: 'candidate-write-observer',
      phase: 'after_candidate_write',
      subscriber: {
        name: 'candidate-write-observer',
        modulePath: 'src/sites/capability/api-candidates.mjs',
        entrypoint: 'observe',
        capability: 'api-candidates',
        order: 1,
      },
      filters: {
        eventTypes: ['capture.api_candidates.written'],
      },
    },
  ]);

  const evidence = createCapabilityHookLifecycleEvidence(registry, {
    eventType: 'capture.api_candidates.written',
    traceId: 'trace-capture-hook-evidence',
    correlationId: 'correlation-capture-hook-evidence',
    taskId: 'task-capture-hook-evidence',
    siteKey: 'bilibili',
    taskType: 'capture',
    adapterVersion: 'adapter-v1',
    details: {
      authorization: 'Bearer synthetic-capture-secret',
    },
  });

  assert.equal(evidence.schemaVersion, CAPABILITY_HOOK_SCHEMA_VERSION);
  assert.equal(evidence.evidenceType, 'capability_hook.lifecycle_match_summary');
  assert.deepEqual(evidence.descriptorPolicy, CAPABILITY_HOOK_DESCRIPTOR_POLICY);
  assert.deepEqual(evidence.executionPolicy, CAPABILITY_HOOK_EXECUTION_POLICY);
  assert.deepEqual(evidence.phaseSummary, {
    source: 'event_type_inference',
    phases: ['after_capture', 'after_candidate_write'],
    phaseCount: 2,
  });
  assert.equal(evidence.matchSummary.matchCount, 2);
  assert.deepEqual(
    evidence.matchSummary.matches.map((match) => match.id),
    ['candidate-write-observer', 'capture-observer'],
  );
  assert.deepEqual(evidence.lifecycleEvent, {
    schemaVersion: 1,
    eventType: 'capture.api_candidates.written',
    traceId: 'trace-capture-hook-evidence',
    correlationId: 'correlation-capture-hook-evidence',
    taskId: 'task-capture-hook-evidence',
    siteKey: 'bilibili',
    taskType: 'capture',
    adapterVersion: 'adapter-v1',
  });
  const json = JSON.stringify(evidence);
  assert.equal(json.includes('modulePath'), false);
  assert.equal(json.includes('entrypoint'), false);
  assert.equal(json.includes('synthetic-capture-secret'), false);
  assert.equal(json.includes('Bearer'), false);
});

test('CapabilityHook lifecycle evidence summarizes download producer phases and safe matches', () => {
  const registry = createCapabilityHookRegistry([
    {
      id: 'download-terminal-observer',
      phase: 'after_download',
      subscriber: {
        name: 'download-terminal-observer',
        modulePath: 'src/sites/downloads/runner.mjs',
        entrypoint: 'observeTerminal',
        capability: 'download-runner',
        order: 2,
      },
      filters: {
        eventTypes: ['download.run.terminal'],
        siteKeys: ['x'],
      },
    },
    {
      id: 'download-terminal-completion-observer',
      phase: 'on_completion',
      subscriber: {
        name: 'download-terminal-completion-observer',
        modulePath: 'src/sites/capability/lifecycle-events.mjs',
        entrypoint: 'observe',
        capability: 'download-runner',
        order: 1,
      },
      filters: {
        eventTypes: ['download.run.terminal'],
        reasonCodes: ['download-failures'],
      },
    },
    {
      id: 'capture-family-mismatch',
      phase: 'after_capture',
      subscriber: {
        name: 'capture-family-mismatch',
        order: 0,
      },
      filters: {
        eventTypes: ['capture.manifest.written'],
      },
    },
  ]);

  const evidence = createCapabilityHookLifecycleEvidence(registry, {
    eventType: 'download.run.terminal',
    traceId: 'trace-download-hook-evidence',
    correlationId: 'correlation-download-hook-evidence',
    taskId: 'task-download-hook-evidence',
    siteKey: 'x',
    taskType: 'media-bundle',
    adapterVersion: 'x-adapter-v1',
    reasonCode: 'download-failures',
    details: {
      status: 'failed',
      reason: 'download-failures',
      authorization: 'Bearer synthetic-download-secret',
      session: {
        csrf: 'synthetic-download-csrf',
      },
    },
  });

  assert.equal(evidence.schemaVersion, CAPABILITY_HOOK_SCHEMA_VERSION);
  assert.deepEqual(evidence.phaseSummary, {
    source: 'event_type_inference',
    phases: ['after_download', 'on_completion'],
    phaseCount: 2,
  });
  assert.deepEqual(evidence.producerFamilySummary, {
    source: 'event_type_prefix',
    family: 'download',
    producer: 'run',
    eventName: 'terminal',
    inferredTerminal: true,
    inferredCompletion: true,
  });
  assert.equal(evidence.matchSummary.matchCount, 2);
  assert.deepEqual(
    evidence.matchSummary.matches.map((match) => match.id),
    ['download-terminal-completion-observer', 'download-terminal-observer'],
  );
  assert.deepEqual(evidence.lifecycleEvent, {
    schemaVersion: 1,
    eventType: 'download.run.terminal',
    traceId: 'trace-download-hook-evidence',
    correlationId: 'correlation-download-hook-evidence',
    taskId: 'task-download-hook-evidence',
    siteKey: 'x',
    taskType: 'media-bundle',
    adapterVersion: 'x-adapter-v1',
    reasonCode: 'download-failures',
  });
  const json = JSON.stringify(evidence);
  assert.equal(json.includes('modulePath'), false);
  assert.equal(json.includes('entrypoint'), false);
  assert.equal(json.includes('synthetic-download-secret'), false);
  assert.equal(json.includes('synthetic-download-csrf'), false);
  assert.equal(json.includes('Bearer'), false);
});

test('CapabilityHook lifecycle evidence summarizes API catalog producer phases and safe matches', () => {
  const registry = createCapabilityHookRegistry([
    {
      id: 'api-catalog-schema-failure-observer',
      phase: 'on_failure',
      subscriber: {
        name: 'api-catalog-schema-failure-observer',
        modulePath: 'src/sites/capability/api-candidates.mjs',
        entrypoint: 'observeSchemaFailure',
        capability: 'api-catalog',
        order: 1,
      },
      filters: {
        eventTypes: ['api.catalog.schema_incompatible'],
        reasonCodes: ['schema-version-incompatible'],
      },
    },
    {
      id: 'api-catalog-verify-observer',
      phase: 'after_catalog_verify',
      subscriber: {
        name: 'api-catalog-verify-observer',
        modulePath: 'src/sites/capability/api-candidates.mjs',
        entrypoint: 'observeCatalogVerify',
        capability: 'api-catalog',
        order: 2,
      },
      filters: {
        eventTypes: [
          'api.catalog.schema_incompatible',
          'api.catalog.collection.written',
          'api.catalog.index.written',
        ],
        siteKeys: ['bilibili'],
      },
    },
    {
      id: 'api-catalog-artifact-observer',
      phase: 'after_artifact_write',
      subscriber: {
        name: 'api-catalog-artifact-observer',
        modulePath: 'src/sites/capability/api-candidates.mjs',
        entrypoint: 'observeCatalogArtifact',
        capability: 'api-catalog',
        order: 1,
      },
      filters: {
        eventTypes: ['api.catalog.collection.written', 'api.catalog.index.written'],
      },
    },
  ]);

  const schemaEvidence = createCapabilityHookLifecycleEvidence(registry, {
    eventType: 'api.catalog.schema_incompatible',
    traceId: 'trace-api-catalog-schema-hook-evidence',
    correlationId: 'correlation-api-catalog-schema-hook-evidence',
    taskId: 'task-api-catalog-schema-hook-evidence',
    siteKey: 'bilibili',
    taskType: 'api-catalog-write',
    adapterVersion: 'bilibili-adapter-v1',
    reasonCode: 'schema-version-incompatible',
    details: {
      schemaName: 'ApiCatalog',
      expectedVersion: 1,
      receivedVersion: 2,
      authorization: 'Bearer synthetic-api-catalog-schema-secret',
    },
  });

  assert.deepEqual(schemaEvidence.phaseSummary, {
    source: 'event_type_inference',
    phases: ['after_catalog_verify', 'on_failure'],
    phaseCount: 2,
  });
  assert.deepEqual(schemaEvidence.producerFamilySummary, {
    source: 'event_type_prefix',
    family: 'api',
    producer: 'catalog',
    eventName: 'schema_incompatible',
    inferredTerminal: false,
    inferredCompletion: false,
  });
  assert.equal(schemaEvidence.matchSummary.matchCount, 2);
  assert.deepEqual(
    schemaEvidence.matchSummary.matches.map((match) => match.id),
    ['api-catalog-schema-failure-observer', 'api-catalog-verify-observer'],
  );

  const collectionEvidence = createCapabilityHookLifecycleEvidence(registry, {
    eventType: 'api.catalog.collection.written',
    traceId: 'trace-api-catalog-collection-hook-evidence',
    correlationId: 'correlation-api-catalog-collection-hook-evidence',
    taskId: 'task-api-catalog-collection-hook-evidence',
    siteKey: 'bilibili',
    taskType: 'api-catalog-write',
    adapterVersion: 'bilibili-adapter-v1',
    details: {
      catalogId: 'bilibili-public-api',
      entryCount: 2,
      csrf: 'synthetic-api-catalog-collection-csrf',
    },
  });

  assert.deepEqual(collectionEvidence.phaseSummary, {
    source: 'event_type_inference',
    phases: ['after_catalog_verify', 'after_artifact_write'],
    phaseCount: 2,
  });
  assert.equal(collectionEvidence.matchSummary.matchCount, 2);
  assert.deepEqual(
    collectionEvidence.matchSummary.matches.map((match) => match.id),
    ['api-catalog-artifact-observer', 'api-catalog-verify-observer'],
  );

  const json = JSON.stringify({ schemaEvidence, collectionEvidence });
  assert.equal(json.includes('modulePath'), false);
  assert.equal(json.includes('entrypoint'), false);
  assert.equal(json.includes('synthetic-api-catalog-schema-secret'), false);
  assert.equal(json.includes('synthetic-api-catalog-collection-csrf'), false);
  assert.equal(json.includes('Bearer'), false);
});

test('runtime LifecycleEvent producers expose safe CapabilityHook match summaries', () => {
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

  assert.deepEqual(
    producerFiles.map((filePath) => path.relative(REPO_ROOT, filePath).replaceAll(path.sep, '/')).sort(),
    [
      'src/pipeline/stages/capture.mjs',
      'src/sites/capability/api-candidates.mjs',
      'src/sites/capability/site-health-execution-gate.mjs',
      'src/sites/capability/site-health-recovery.mjs',
      'src/sites/downloads/executor.mjs',
      'src/sites/downloads/legacy-executor.mjs',
      'src/sites/downloads/runner.mjs',
      'src/sites/sessions/runner.mjs',
      'src/sites/social/actions/router.mjs',
    ],
  );

  const requiredObservabilityFields = [
    'eventType',
    'traceId',
    'correlationId',
    'taskId',
    'siteKey',
    'taskType',
    'adapterVersion',
    'reasonCode',
  ];

  for (const filePath of producerFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(REPO_ROOT, filePath);
    const isSiteHealthProducer = relativePath.replaceAll(path.sep, '/').startsWith('src/sites/capability/site-health-');
    if (!isSiteHealthProducer) {
      assert.match(
        source,
        /matchCapabilityHooksForLifecycleEvent|lifecycleEventWithCapabilityHookMatches/u,
        `${relativePath} must match CapabilityHook descriptors before dispatch/write`,
      );
      assert.match(
        source,
        /capabilityHookMatches/u,
        `${relativePath} must attach only safe CapabilityHook match summaries`,
      );
    }
    const requiredFields = isSiteHealthProducer
      ? requiredObservabilityFields.filter((field) => !['adapterVersion', 'reasonCode'].includes(field))
      : requiredObservabilityFields;
    for (const field of requiredFields) {
      assert.match(
        source,
        new RegExp(`\\b${field}\\b`, 'u'),
        `${relativePath} must expose LifecycleEvent observability field ${field}`,
      );
    }
  }
});

test('runtime LifecycleEvent producer inventory is explicit by event type', () => {
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
  const eventTypes = producerFiles.flatMap((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    return [...source.matchAll(/\beventType:\s*'([^']+)'/gu)].map((match) => match[1]);
  });

  assert.deepEqual([...new Set(eventTypes)].sort(), CAPABILITY_HOOK_EVENT_TYPES);
  assert.deepEqual(CAPABILITY_HOOK_EVENT_TYPES, [
    'api.candidate.verified',
    'api.catalog.collection.written',
    'api.catalog.index.written',
    'api.catalog.schema_incompatible',
    'api.catalog.upgrade_decision.written',
    'api.catalog.verification.written',
    'capture.api_candidates.written',
    'capture.manifest.written',
    'download.executor.before_download',
    'download.executor.completed',
    'download.executor.dry_run',
    'download.legacy.completed',
    'download.legacy.recovery_preflight',
    'download.run.terminal',
    'session.run.completed',
    'site.health.recovery.action.planned',
    'site.health.recovery.evaluated',
    'site.health.recovery.safe_stop',
    'social.action.risk_blocked',
  ]);
});

test('download executor LifecycleEvent producers expose required observability fields per event type', () => {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'executor.mjs'),
    'utf8',
  );
  const requiredFields = [
    'eventType',
    'taskId',
    'siteKey',
    'taskType',
    'adapterVersion',
    'reasonCode',
    'capabilityHookMatches',
  ];

  for (const eventType of [
    'download.executor.before_download',
    'download.executor.completed',
    'download.executor.dry_run',
  ]) {
    const block = lifecycleEventProducerBlock(source, eventType);
    assert.match(
      block,
      /\.\.\.downloadExecutorLifecycleContext\(manifest\)/u,
      `${eventType} producer must attach trace/correlation context`,
    );
    for (const field of requiredFields) {
      assert.match(
        block,
        new RegExp(`\\b${field}\\b`, 'u'),
        `${eventType} producer must expose ${field}`,
      );
    }
  }
  assert.match(source, /function downloadExecutorLifecycleContext/u);
  assert.match(source, /\btraceId\b/u);
  assert.match(source, /\bcorrelationId\b/u);
});

test('legacy download executor LifecycleEvent producers expose required observability fields per event type', () => {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'legacy-executor.mjs'),
    'utf8',
  );
  const requiredFields = [
    'eventType',
    'taskId',
    'siteKey',
    'taskType',
    'adapterVersion',
    'reasonCode',
    'capabilityHookMatches',
  ];
  const eventTypes = new Map([
    ['download.legacy.recovery_preflight', 'legacyRecoveryLifecycleContext'],
    ['download.legacy.completed', 'legacyCompletedLifecycleContext'],
  ]);

  for (const [eventType, contextHelper] of eventTypes) {
    const block = lifecycleEventProducerBlock(source, eventType);
    assert.match(
      block,
      new RegExp(`\\.\\.\\.${contextHelper}\\(manifest\\)`, 'u'),
      `${eventType} producer must attach trace/correlation context`,
    );
    for (const field of requiredFields) {
      assert.match(
        block,
        new RegExp(`\\b${field}\\b`, 'u'),
        `${eventType} producer must expose ${field}`,
      );
    }
  }
  assert.match(source, /function legacyRecoveryLifecycleContext/u);
  assert.match(source, /function legacyCompletedLifecycleContext/u);
  assert.match(source, /\btraceId\b/u);
  assert.match(source, /\bcorrelationId\b/u);
});

test('download runner terminal LifecycleEvent producer exposes required observability fields', () => {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'runner.mjs'),
    'utf8',
  );
  const block = lifecycleEventProducerBlock(source, 'download.run.terminal');
  assert.match(
    block,
    /\.\.\.downloadLifecycleContext\(manifest\)/u,
    'download.run.terminal producer must attach trace/correlation context',
  );
  for (const field of [
    'eventType',
    'taskId',
    'siteKey',
    'taskType',
    'adapterVersion',
    'reasonCode',
    'capabilityHookMatches',
  ]) {
    assert.match(
      block,
      new RegExp(`\\b${field}\\b`, 'u'),
      `download.run.terminal producer must expose ${field}`,
    );
  }
  assert.match(source, /function downloadLifecycleContext/u);
  assert.match(source, /\btraceId\b/u);
  assert.match(source, /\bcorrelationId\b/u);
});

test('session runner completed LifecycleEvent producer exposes required observability fields', () => {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'src', 'sites', 'sessions', 'runner.mjs'),
    'utf8',
  );
  const block = lifecycleEventProducerBlock(source, 'session.run.completed');
  assert.match(
    block,
    /\.\.\.sessionLifecycleContext\(manifest\)/u,
    'session.run.completed producer must attach trace/correlation/task context',
  );
  for (const field of [
    'eventType',
    'taskId',
    'siteKey',
    'reasonCode',
    'capabilityHookMatches',
  ]) {
    assert.match(
      block,
      new RegExp(`\\b${field}\\b`, 'u'),
      `session.run.completed producer must expose ${field}`,
    );
  }
  assert.match(source, /function sessionLifecycleContext/u);
  assert.match(source, /\btraceId\b/u);
  assert.match(source, /\bcorrelationId\b/u);
  assert.match(source, /\btaskType\b/u);
  assert.match(source, /\badapterVersion\b/u);
});

test('capture stage direct LifecycleEvent producers expose required observability fields', () => {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'src', 'pipeline', 'stages', 'capture.mjs'),
    'utf8',
  );
  const commonFields = [
    'eventType',
    'taskId',
    'siteKey',
    'capabilityHookMatches',
  ];

  for (const eventType of ['capture.manifest.written', 'capture.api_candidates.written']) {
    const block = lifecycleEventProducerBlock(source, eventType);
    assert.match(
      block,
      /\.\.\.captureLifecycleContext\(manifest\)/u,
      `${eventType} producer must attach trace/correlation/task context`,
    );
    for (const field of commonFields) {
      assert.match(
        block,
        new RegExp(`\\b${field}\\b`, 'u'),
        `${eventType} producer must expose ${field}`,
      );
    }
  }

  const manifestBlock = lifecycleEventProducerBlock(source, 'capture.manifest.written');
  assert.match(manifestBlock, /\breasonCode\b/u);
  const candidatesBlock = lifecycleEventProducerBlock(source, 'capture.api_candidates.written');
  assert.match(candidatesBlock, /\bapiCandidateDecisionSummary\b/u);
  assert.match(candidatesBlock, /\bapiCandidateCatalogUpgradeDecisionSummary\b/u);
  assert.match(source, /\breasonCodes\b/u);
  assert.match(source, /function captureLifecycleContext/u);
  assert.match(source, /\btraceId\b/u);
  assert.match(source, /\bcorrelationId\b/u);
  assert.match(source, /\btaskType\b/u);
  assert.match(source, /\badapterVersion\b/u);
});

test('API candidate lifecycle producers expose required observability fields per event type', () => {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'src', 'sites', 'capability', 'api-candidates.mjs'),
    'utf8',
  );
  const commonFields = [
    'eventType',
    'traceId',
    'correlationId',
    'taskId',
    'siteKey',
    'taskType',
    'adapterVersion',
  ];

  for (const eventType of ['api.candidate.verified', 'api.catalog.upgrade_decision.written']) {
    const block = lifecycleEventProducerBlock(source, eventType);
    for (const field of commonFields) {
      assert.match(
        block,
        new RegExp(`\\b${field}\\b`, 'u'),
        `${eventType} producer must expose ${field}`,
      );
    }
  }

  const verifiedBlock = lifecycleEventProducerBlock(source, 'api.candidate.verified');
  assert.match(verifiedBlock, /\bverifierId\b/u);
  assert.match(verifiedBlock, /\bverifiedAt\b/u);
  const upgradeBlock = lifecycleEventProducerBlock(source, 'api.catalog.upgrade_decision.written');
  assert.match(upgradeBlock, /\breasonCode\b/u);
  assert.match(upgradeBlock, /\bcanEnterCatalog\b/u);
  assert.match(upgradeBlock, /\bcatalogAction\b/u);
  assert.match(source, /function lifecycleEventWithCapabilityHookMatches/u);
  assert.match(source, /\bcapabilityHookMatches\b/u);
});

test('API catalog lifecycle producers expose required observability fields per event type', () => {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'src', 'sites', 'capability', 'api-candidates.mjs'),
    'utf8',
  );
  const commonFields = [
    'eventType',
    'traceId',
    'correlationId',
    'taskId',
    'siteKey',
    'taskType',
    'adapterVersion',
  ];

  for (const eventType of ['api.catalog.schema_incompatible', 'api.catalog.verification.written']) {
    const block = lifecycleEventProducerBlock(source, eventType);
    for (const field of commonFields) {
      assert.match(
        block,
        new RegExp(`\\b${field}\\b`, 'u'),
        `${eventType} producer must expose ${field}`,
      );
    }
  }

  const schemaIncompatibleBlock = lifecycleEventProducerBlock(source, 'api.catalog.schema_incompatible');
  assert.match(schemaIncompatibleBlock, /\breasonCode\b/u);
  assert.match(schemaIncompatibleBlock, /\bschemaName\b/u);
  assert.match(schemaIncompatibleBlock, /\bexpectedVersion\b/u);
  assert.match(schemaIncompatibleBlock, /\breceivedVersion\b/u);
  assert.match(schemaIncompatibleBlock, /\bfailClosed\b/u);

  const verificationBlock = lifecycleEventProducerBlock(source, 'api.catalog.verification.written');
  assert.match(verificationBlock, /\bcatalogVersion\b/u);
  assert.match(verificationBlock, /\bcatalogStatus\b/u);
  assert.match(verificationBlock, /\binvalidationStatus\b/u);
  assert.match(verificationBlock, /\bverifiedAt\b/u);
  assert.match(verificationBlock, /\blastValidatedAt\b/u);
  assert.match(source, /function lifecycleEventWithCapabilityHookMatches/u);
  assert.match(source, /\bcapabilityHookMatches\b/u);
});

test('API catalog collection and index lifecycle producers expose required observability fields per event type', () => {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'src', 'sites', 'capability', 'api-candidates.mjs'),
    'utf8',
  );
  const commonFields = [
    'eventType',
    'traceId',
    'correlationId',
    'taskId',
    'siteKey',
    'taskType',
    'adapterVersion',
  ];

  for (const eventType of ['api.catalog.collection.written', 'api.catalog.index.written']) {
    const block = lifecycleEventProducerBlock(source, eventType);
    for (const field of commonFields) {
      assert.match(
        block,
        new RegExp(`\\b${field}\\b`, 'u'),
        `${eventType} producer must expose ${field}`,
      );
    }
  }

  const collectionBlock = lifecycleEventProducerBlock(source, 'api.catalog.collection.written');
  assert.match(collectionBlock, /\bcatalogId\b/u);
  assert.match(collectionBlock, /\bcatalogVersion\b/u);
  assert.match(collectionBlock, /\bentryCount\b/u);
  assert.match(collectionBlock, /\binvalidationStatuses\b/u);
  assert.match(collectionBlock, /\breasonCodes\b/u);

  const indexBlock = lifecycleEventProducerBlock(source, 'api.catalog.index.written');
  assert.match(indexBlock, /\bindexVersion\b/u);
  assert.match(indexBlock, /\bcatalogCount\b/u);
  assert.match(indexBlock, /\btotalEntryCount\b/u);
  assert.match(indexBlock, /\bcatalogs\b/u);
  assert.match(indexBlock, /\breasonCodes\b/u);
  assert.match(source, /function lifecycleEventWithCapabilityHookMatches/u);
  assert.match(source, /\bcapabilityHookMatches\b/u);
});

test('social action risk-blocked LifecycleEvent producer exposes RiskState observability fields', () => {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'src', 'sites', 'social', 'actions', 'router.mjs'),
    'utf8',
  );
  const block = lifecycleEventProducerBlock(source, 'social.action.risk_blocked');
  for (const field of [
    'eventType',
    'traceId',
    'correlationId',
    'taskId',
    'siteKey',
    'taskType',
    'adapterVersion',
    'reasonCode',
    'riskState',
    'capabilityHookMatches',
  ]) {
    assert.match(
      block,
      new RegExp(`\\b${field}\\b`, 'u'),
      `social.action.risk_blocked producer must expose ${field}`,
    );
  }
  assert.match(source, /function buildSocialRiskBlockedLifecycleEvent/u);
  assert.match(source, /\bwriteLifecycleEventArtifact\b/u);
});
