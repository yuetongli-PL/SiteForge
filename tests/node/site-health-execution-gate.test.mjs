import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HEALTH_RECOVERY_AUDIT_ARTIFACT_NAME,
  HEALTH_RECOVERY_ROLLBACK_ARTIFACT_NAME,
  SITE_HEALTH_EXECUTION_GATE_SCHEMA_VERSION,
  SITE_HEALTH_REPORT_ARTIFACT_NAME,
  SafeRecoveryActionExecutor,
  applySiteHealthExecutionGateToTaskList,
  createCapabilityHealthStateCache,
  createHealthRecoveryRollbackPlan,
  createRecoveryPolicyRegistry,
  createSiteHealthRecoveryLifecycleEvents,
  evaluateSiteHealthExecutionGate,
} from '../../src/sites/capability/site-health-execution-gate.mjs';
import { SiteHealthRecoveryEngine } from '../../src/sites/capability/site-health-recovery.mjs';

function healthRecoveryReport(overrides = {}) {
  return {
    schemaVersion: 1,
    report: {
      schemaVersion: 1,
      siteId: 'x',
      status: 'degraded',
      risks: [],
      affectedCapabilities: ['post.write'],
      capabilityHealth: [
        {
          capability: 'post.write',
          status: 'disabled',
          risks: ['capability-disabled'],
          actions: ['disable-risky-capability'],
        },
        {
          capability: 'profile.read',
          status: 'healthy',
          risks: [],
          actions: [],
        },
      ],
      recommendedActions: ['disable-risky-capability'],
      ...overrides.report,
    },
    recovery: {
      actions: [],
      auditLog: [],
      ...overrides.recovery,
    },
  };
}

test('execution gate blocks only disabled capability and preserves read capability', () => {
  const postWrite = evaluateSiteHealthExecutionGate({
    healthRecovery: healthRecoveryReport(),
    task: {
      capability: 'post.write',
      mode: 'write',
    },
  });
  const profileRead = evaluateSiteHealthExecutionGate({
    healthRecovery: healthRecoveryReport(),
    task: {
      capability: 'profile.read',
      mode: 'read',
    },
  });

  assert.equal(postWrite.schemaVersion, SITE_HEALTH_EXECUTION_GATE_SCHEMA_VERSION);
  assert.equal(postWrite.allowed, false);
  assert.equal(postWrite.reason, 'capability-disabled');
  assert.equal(profileRead.allowed, true);
  assert.equal(profileRead.status, 'allowed');
});

test('execution gate readonly mode blocks write tasks but allows read tasks', () => {
  const recovery = healthRecoveryReport({
    report: {
      capabilityHealth: [
        { capability: 'profile.read', status: 'healthy', risks: [], actions: [] },
        { capability: 'post.write', status: 'healthy', risks: [], actions: [] },
      ],
      recommendedActions: ['switch-to-readonly-mode'],
    },
  });

  assert.equal(evaluateSiteHealthExecutionGate({
    healthRecovery: recovery,
    task: { capability: 'profile.read', mode: 'read' },
  }).allowed, true);
  const writeDecision = evaluateSiteHealthExecutionGate({
    healthRecovery: recovery,
    task: { capability: 'post.write', mode: 'write' },
  });
  assert.equal(writeDecision.allowed, false);
  assert.equal(writeDecision.reason, 'readonly-mode');
});

test('execution gate blocks user-action, quarantine, and safe-stop actions', () => {
  for (const action of ['require-user-action', 'quarantine-site-profile', 'safe-stop']) {
    const decision = evaluateSiteHealthExecutionGate({
      healthRecovery: healthRecoveryReport({
        report: {
          recommendedActions: [action],
          capabilityHealth: [
            { capability: 'profile.read', status: 'healthy', risks: [], actions: [] },
          ],
        },
      }),
      task: { capability: 'profile.read', mode: 'read' },
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'health-risk-blocked');
  }
});

test('policy registry overrides default recovery policy without mutating original registry', () => {
  const registry = createRecoveryPolicyRegistry({
    'rate-limited': {
      maxAttempts: 3,
      allowedActions: ['apply-backoff'],
    },
  });
  const next = registry.set('rate-limited', {
    maxAttempts: 5,
    allowedActions: ['apply-backoff', 'switch-to-readonly-mode'],
  });

  assert.equal(registry.get('rate-limited').maxAttempts, 3);
  assert.equal(next.get('rate-limited').maxAttempts, 5);
  assert.deepEqual(next.get('rate-limited').allowedActions, ['apply-backoff', 'switch-to-readonly-mode']);
});

test('capability health state cache respects TTL and redacts sensitive material', () => {
  let now = new Date('2026-05-04T00:00:00.000Z');
  const cache = createCapabilityHealthStateCache({ now: () => now });
  cache.set({
    siteId: 'x',
    profileId: 'default',
    capability: 'profile.read',
    status: 'disabled',
    reason: 'profilePath=C:/Users/example/Profile 1',
    ttlMs: 1_000,
  });

  const active = cache.get({ siteId: 'x', profileId: 'default', capability: 'profile.read' });
  assert.equal(active.status, 'disabled');
  assert.equal(JSON.stringify(active).includes('Profile 1'), false);
  now = new Date('2026-05-04T00:00:01.001Z');
  assert.equal(cache.get({ siteId: 'x', profileId: 'default', capability: 'profile.read' }), undefined);
});

test('safe recovery action executor plans only safe generic actions', async () => {
  const executor = new SafeRecoveryActionExecutor();
  assert.deepEqual(await executor.execute('apply-backoff', { backoffMs: 5000 }), {
    action: 'apply-backoff',
    status: 'planned',
    backoffMs: 5000,
  });
  assert.deepEqual(await executor.execute('switch-to-readonly-mode'), {
    action: 'switch-to-readonly-mode',
    status: 'planned',
    mode: 'readonly',
  });
  assert.deepEqual(await executor.execute('require-user-action'), {
    action: 'require-user-action',
    status: 'deferred',
    requiresUserAction: true,
  });
});

test('lifecycle events are descriptor-only and redacted', async () => {
  const engine = new SiteHealthRecoveryEngine();
  const healthRecovery = await engine.recover({
    siteId: 'x',
    rawSignals: [{
      rawSignal: 'profile-health-risk',
      affectedCapability: 'profile.read',
      metadata: {
        authorization: 'Bearer synthetic-lifecycle-token',
      },
    }],
  });
  const events = createSiteHealthRecoveryLifecycleEvents({
    healthRecovery,
    traceId: 'trace-health',
    correlationId: 'corr-health',
    taskId: 'task-health',
    siteKey: 'x',
  });

  assert.equal(events[0].eventType, 'site.health.recovery.evaluated');
  assert.equal(events.some((event) => event.eventType === 'site.health.recovery.safe_stop'), true);
  assert.equal(events.every((event) => event.schemaVersion === 1), true);
  assert.equal(JSON.stringify(events).includes('synthetic-lifecycle-token'), false);
  assert.equal(events.slice(1).every((event) => event.details.descriptorOnly === true), true);
  assert.equal(events.slice(1).every((event) => event.details.executableDispatchEnabled === false), true);
});

test('artifact constants and task-list gate output are stable', () => {
  assert.equal(SITE_HEALTH_REPORT_ARTIFACT_NAME, 'SITE_HEALTH_REPORT');
  assert.equal(HEALTH_RECOVERY_AUDIT_ARTIFACT_NAME, 'HEALTH_RECOVERY_AUDIT');
  assert.equal(HEALTH_RECOVERY_ROLLBACK_ARTIFACT_NAME, 'HEALTH_RECOVERY_ROLLBACK_PLAN');

  const gated = applySiteHealthExecutionGateToTaskList({
    healthRecovery: healthRecoveryReport(),
    tasks: [
      { id: 'profile', capability: 'profile.read', mode: 'read' },
      { id: 'post', capability: 'post.write', mode: 'write' },
    ],
  });
  assert.equal(gated[0].healthGate.allowed, true);
  assert.equal(gated[1].healthGate.allowed, false);
});

test('rollback plan is descriptor-only and redacted', () => {
  const plan = createHealthRecoveryRollbackPlan({
    healthRecovery: healthRecoveryReport({
      report: {
        siteId: 'x',
        profileId: 'profilePath=C:/Users/example/Profile 7',
      },
      recovery: {
        actions: [
          { action: 'switch-to-readonly-mode', status: 'planned' },
          { action: 'disable-risky-capability', capability: 'post.write', status: 'planned' },
          { action: 'quarantine-site-profile', status: 'deferred' },
          {
            action: 'refresh-session',
            status: 'planned',
            metadata: {
              authorization: 'Bearer synthetic-rollback-token',
              cookie: 'SESSDATA=synthetic-rollback-cookie',
            },
          },
        ],
      },
    }),
  });

  assert.equal(plan.artifactName, 'HEALTH_RECOVERY_ROLLBACK_PLAN');
  assert.equal(plan.rollbackSupported, true);
  assert.deepEqual(plan.rollbackSteps.map((step) => step.action), [
    'restore-previous-capability-mode',
    'reenable-capability:post.write',
    'manual-review-required-before-unquarantine',
    'revoke-refreshed-session-view-on-failed-health-probe',
  ]);
  assert.equal(plan.rollbackSteps.every((step) => step.executableDispatchEnabled === false), true);
  assert.equal(JSON.stringify(plan).includes('synthetic-rollback'), false);
  assert.equal(JSON.stringify(plan).includes('Profile 7'), false);
});
