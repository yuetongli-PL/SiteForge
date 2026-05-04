import test from 'node:test';
import assert from 'node:assert/strict';

import { assertNoForbiddenPatterns } from '../../src/sites/capability/security-guard.mjs';

async function loadExecutionGateModule() {
  return await import('../../src/sites/capability/site-health-execution-gate.mjs');
}

async function loadRecoveryModule() {
  return await import('../../src/sites/capability/site-health-recovery.mjs');
}

async function evaluateGate(task, context = {}) {
  const {
    evaluateSiteHealthExecutionGate,
  } = await loadExecutionGateModule();
  assert.equal(typeof evaluateSiteHealthExecutionGate, 'function');
  return evaluateSiteHealthExecutionGate({
    task,
    healthRecovery: context.healthRecovery,
    cachedState: context.cachedState,
  });
}

function writeTask(overrides = {}) {
  return {
    taskId: 'task-write-post',
    taskType: 'write',
    capability: 'post.write',
    artifactWrites: [
      { artifactName: 'POST_WRITE_RESULT', relativePath: 'artifacts/post-write.json' },
    ],
    ...overrides,
  };
}

function readTask(overrides = {}) {
  return {
    taskId: 'task-read-profile',
    taskType: 'read',
    capability: 'profile.read',
    artifactWrites: [],
    ...overrides,
  };
}

function assertBlocked(decision, reasonPattern) {
  assert.equal(decision.allowed, false);
  assert.equal(decision.artifactWriteAllowed, false);
  assert.match(JSON.stringify(decision), reasonPattern);
}

function assertNoBypassActions(actions) {
  for (const action of actions) {
    assert.doesNotMatch(action, /captcha|mfa|challenge|verify|bypass|solve|unlock/iu);
  }
}

test('execution gate safe-stop, quarantine, and user-action risks block write tasks and artifact writes', async () => {
  for (const [riskType, expectedReason] of [
    ['unknown-health-risk', /safe-stop/u],
    ['account-restricted', /quarantine/u],
    ['captcha-required', /user-action|safe-stop/u],
    ['mfa-required', /user-action|safe-stop/u],
  ]) {
    const decision = await evaluateGate(writeTask(), {
      siteId: 'x',
      healthRecovery: {
        report: {
          status: 'blocked',
          risks: [{
            type: riskType,
            affectedCapability: 'post.write',
            requiresUserAction: ['captcha-required', 'mfa-required'].includes(riskType),
            autoRecoverable: false,
          }],
          recommendedActions: riskType === 'account-restricted'
            ? ['quarantine-site-profile', 'require-user-action', 'safe-stop']
            : ['require-user-action', 'safe-stop'],
        },
      },
    });

    assertBlocked(decision, expectedReason);
    assert.equal(decision.blockedCapabilities.includes('post.write'), true);
  }
});

test('execution gate readonly fallback preserves read capabilities while blocking write capabilities', async () => {
  const context = {
    siteId: 'instagram',
    healthRecovery: {
      report: {
        status: 'degraded',
        risks: [{
          type: 'rate-limited',
          affectedCapability: 'media.write',
          autoRecoverable: true,
          requiresUserAction: false,
        }],
        recommendedActions: ['apply-backoff', 'reduce-concurrency', 'switch-to-readonly-mode'],
      },
      recovery: {
        auditLog: [{
          riskType: 'rate-limited',
          fallbackMode: 'readonly',
          allowedActions: ['apply-backoff', 'reduce-concurrency', 'switch-to-readonly-mode'],
        }],
      },
    },
  };

  const readDecision = await evaluateGate(readTask({ capability: 'profile.read' }), context);
  assert.equal(readDecision.allowed, true);
  assert.equal(readDecision.capability, 'profile.read');
  assert.equal(readDecision.mode, 'readonly');
  assert.equal(readDecision.artifactWriteAllowed, false);

  const writeDecision = await evaluateGate(writeTask({ capability: 'media.write' }), context);
  assertBlocked(writeDecision, /readonly/u);
});

test('execution gate capability-disabled blocks only the affected capability', async () => {
  const context = {
    siteId: 'bilibili',
    healthRecovery: {
      report: {
        status: 'degraded',
        risks: [{
          type: 'capability-disabled',
          affectedCapability: 'comment.write',
          autoRecoverable: false,
          requiresUserAction: false,
        }],
        affectedCapabilities: ['comment.write'],
        capabilityHealth: [
          { capability: 'comment.write', status: 'disabled', risks: ['capability-disabled'], actions: ['disable-risky-capability'] },
          { capability: 'profile.read', status: 'healthy', risks: [], actions: [] },
        ],
        recommendedActions: ['disable-risky-capability'],
      },
      recovery: {
        auditLog: [{
          riskType: 'capability-disabled',
          affectedCapability: 'comment.write',
          fallbackMode: 'reduced',
          allowedActions: ['disable-risky-capability'],
        }],
      },
    },
  };

  const unaffected = await evaluateGate(readTask({ capability: 'profile.read' }), context);
  assert.equal(unaffected.allowed, true);
  assert.equal(unaffected.artifactWriteAllowed, true);

  const affected = await evaluateGate(writeTask({ capability: 'comment.write' }), context);
  assertBlocked(affected, /capability-disabled|disable-risky-capability/u);
  assert.deepEqual(affected.blockedCapabilities, ['comment.write']);
});

test('RecoveryPolicyRegistry overrides default recovery policy decisions', async () => {
  const {
    RecoveryPolicyRegistry,
    SiteHealthRecoveryEngine,
  } = await loadRecoveryModule();

  const policyRegistry = new RecoveryPolicyRegistry();
  policyRegistry.register('network-instability', {
    maxAttempts: 0,
    allowedActions: ['safe-stop'],
    stopConditions: ['network-instability'],
    fallbackMode: 'disabled',
    requiresAuditLog: true,
  });
  const engine = new SiteHealthRecoveryEngine({ policyRegistry });

  const result = await engine.recover({
    siteId: 'example',
    rawSignals: [{
      rawSignal: 'network_failed',
      affectedCapability: 'capture.read',
    }],
    capabilities: ['capture.read'],
  });

  assert.deepEqual(result.report.recommendedActions, ['safe-stop']);
  assert.equal(result.recovery.auditLog[0].fallbackMode, 'disabled');
  assert.equal(result.recovery.auditLog[0].result, 'manual-or-safe-stop');
});

test('HealthStateCache honors TTL and quarantine expiry before gate decisions', async () => {
  const {
    createCapabilityHealthStateCache,
  } = await loadExecutionGateModule();
  assert.equal(typeof createCapabilityHealthStateCache, 'function');

  let now = Date.parse('2026-05-04T00:00:00.000Z');
  const cache = createCapabilityHealthStateCache({
    now: () => new Date(now),
  });
  cache.set({
    siteId: 'x',
    capability: 'profile.read',
    status: 'blocked',
    reason: 'quarantine-site-profile',
    ttlMs: 1_000,
    quarantineUntil: '2026-05-04T00:00:02.000Z',
    healthRecovery: {
      report: {
        status: 'blocked',
        risks: [{
          type: 'account-restricted',
          affectedCapability: 'profile.read',
          autoRecoverable: false,
          requiresUserAction: true,
        }],
        recommendedActions: ['quarantine-site-profile', 'require-user-action', 'safe-stop'],
      },
    },
  });

  assertBlocked(await evaluateGate(readTask(), {
    siteId: 'x',
    cachedState: cache.get({ siteId: 'x', capability: 'profile.read' }),
  }), /quarantine/u);

  now = Date.parse('2026-05-04T00:00:01.500Z');
  assert.equal(cache.get({ siteId: 'x', capability: 'profile.read' }), undefined);

  cache.set({
    siteId: 'x',
    capability: 'profile.read',
    status: 'blocked',
    reason: 'quarantine-site-profile',
    ttlMs: 10_000,
    quarantineUntil: '2026-05-04T00:00:02.000Z',
    healthRecovery: {
      report: {
        status: 'blocked',
        risks: [{
          type: 'account-restricted',
          affectedCapability: 'profile.read',
          autoRecoverable: false,
          requiresUserAction: true,
        }],
        recommendedActions: ['quarantine-site-profile', 'require-user-action', 'safe-stop'],
      },
    },
  });
  now = Date.parse('2026-05-04T00:00:02.001Z');
  assert.equal(cache.get({ siteId: 'x', capability: 'profile.read' }), undefined);
});

test('site health recovery lifecycle event is descriptor-only and redacted', async () => {
  const {
    SITE_HEALTH_RECOVERY_ARTIFACTS,
    createSiteHealthRecoveryLifecycleEvent,
  } = await loadRecoveryModule();

  assert.equal(SITE_HEALTH_RECOVERY_ARTIFACTS.SITE_HEALTH_REPORT, 'SITE_HEALTH_REPORT');
  assert.equal(SITE_HEALTH_RECOVERY_ARTIFACTS.HEALTH_RECOVERY_AUDIT, 'HEALTH_RECOVERY_AUDIT');

  const event = createSiteHealthRecoveryLifecycleEvent({
    siteId: 'x',
    taskDescriptor: {
      taskId: 'x-health-recovery',
      taskType: 'site-health-recovery',
      capability: 'profile.read',
    },
    adapterDescriptor: {
      adapterId: 'x',
      adapterVersion: 'x-adapter-v1',
    },
    healthRecovery: {
      report: {
        status: 'blocked',
        risks: [{
          type: 'captcha-required',
          affectedCapability: 'authenticated.feed',
          metadata: {
            authorization: 'Bearer synthetic-health-event-token',
            cookie: 'SESSDATA=synthetic-health-event-cookie',
            csrf: 'synthetic-health-event-csrf',
          },
        }],
        recommendedActions: ['require-user-action', 'safe-stop'],
      },
      recovery: {
        auditLog: [{
          riskType: 'captcha-required',
          fallbackMode: 'disabled',
          allowedActions: ['require-user-action', 'safe-stop'],
        }],
      },
    },
    rawSession: {
      cookie: 'SESSDATA=synthetic-raw-session-cookie',
      authorization: 'Bearer synthetic-raw-session-token',
      profilePath: 'C:/Users/example/AppData/Local/Browser/User Data/Profile 7',
    },
  });

  assert.equal(event.eventType, 'site.health.recovery.evaluated');
  assert.equal(event.siteKey, 'x');
  assert.equal(event.taskId, 'x-health-recovery');
  assert.equal(event.taskType, 'site-health-recovery');
  assert.equal(event.adapterVersion, 'x-adapter-v1');
  assert.deepEqual(event.details.artifacts, [
    'SITE_HEALTH_REPORT',
    'HEALTH_RECOVERY_AUDIT',
  ]);
  assert.equal(Object.hasOwn(event.details, 'rawSession'), false);
  assert.equal(Object.hasOwn(event.details, 'credentials'), false);
  assert.equal(Object.hasOwn(event.details, 'cookies'), false);
  assert.equal(Object.hasOwn(event.details, 'profilePath'), false);
  assert.deepEqual(event.details.recoveryDescriptor, {
    status: 'blocked',
    riskTypes: ['captcha-required'],
    affectedCapabilities: ['authenticated.feed'],
    recommendedActions: ['require-user-action', 'safe-stop'],
    fallbackModes: ['disabled'],
  });
  assertNoForbiddenPatterns(event);
  assert.doesNotMatch(JSON.stringify(event), /synthetic-health-event|synthetic-raw-session|SESSDATA|Bearer|Profile 7|User Data/iu);
});

test('captcha, MFA, and rate-limit recovery policy never recommends bypass actions', async () => {
  const {
    SiteHealthRecoveryEngine,
  } = await loadRecoveryModule();
  const engine = new SiteHealthRecoveryEngine();

  for (const [rawSignal, expectedActions] of [
    ['captcha', ['require-user-action', 'safe-stop']],
    ['mfa', ['require-user-action', 'safe-stop']],
    ['rate-limit', ['apply-backoff', 'reduce-concurrency', 'switch-to-readonly-mode']],
  ]) {
    const result = await engine.recover({
      siteId: 'x',
      rawSignals: [{
        rawSignal,
        affectedCapability: 'authenticated.feed',
      }],
      capabilities: ['authenticated.feed', 'profile.read'],
    });

    assert.deepEqual(result.report.recommendedActions, expectedActions);
    assertNoBypassActions(result.report.recommendedActions);
    assert.equal(result.report.recommendedActions.includes('refresh-session'), false);
    assert.equal(result.report.recommendedActions.includes('rebuild-browser-context'), false);
  }
});
