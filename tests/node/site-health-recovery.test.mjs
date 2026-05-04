import test from 'node:test';
import assert from 'node:assert/strict';

import { xAdapter } from '../../src/sites/core/adapters/x.mjs';
import {
  HEALTH_RISK_TYPES,
  RECOVERY_ACTIONS,
  SITE_HEALTH_RECOVERY_SCHEMA_VERSION,
  RecoveryActionExecutor,
  SiteHealthRecoveryEngine,
  createCapabilityHealthRegistry,
  createHealthSignalNormalizer,
  createSiteHealthReport,
  createUserRecoveryInstructions,
  normalizeHealthSignal,
  normalizeSiteAdapterHealthSignal,
} from '../../src/sites/capability/site-health-recovery.mjs';

test('SiteHealthRecovery exposes the generic risk and action taxonomies', () => {
  assert.equal(SITE_HEALTH_RECOVERY_SCHEMA_VERSION, 1);
  assert.deepEqual(HEALTH_RISK_TYPES, [
    'auth-expired',
    'session-stale',
    'cookie-invalid',
    'csrf-invalid',
    'login-required',
    'mfa-required',
    'captcha-required',
    'user-verification-required',
    'account-restricted',
    'rate-limited',
    'permission-denied',
    'geo-restricted',
    'adapter-drift',
    'network-instability',
    'browser-context-corrupted',
    'storage-cache-invalid',
    'capability-disabled',
    'platform-risk-detected',
    'unknown-health-risk',
  ]);
  assert.deepEqual(RECOVERY_ACTIONS, [
    'refresh-session',
    'refresh-csrf-token',
    'clear-site-cache',
    'rebuild-browser-context',
    'retry-health-probe',
    'reduce-concurrency',
    'apply-backoff',
    'switch-to-readonly-mode',
    'disable-risky-capability',
    'quarantine-site-profile',
    'require-user-action',
    'safe-stop',
  ]);
});

test('X profile-health-risk is a raw SiteAdapter signal normalized to a generic risk', () => {
  const mapped = normalizeSiteAdapterHealthSignal(xAdapter, {
    signal: 'profile-health-risk',
    capabilityKey: 'profile.read',
    metadata: {
      authorization: 'Bearer synthetic-health-token',
      cookie: 'SESSDATA=synthetic-health-cookie',
    },
  });

  assert.equal(mapped.schemaVersion, undefined);
  assert.equal(mapped.siteId, 'x');
  assert.equal(mapped.rawSignal, 'profile-health-risk');
  assert.equal(mapped.type, 'platform-risk-detected');
  assert.equal(mapped.affectedCapability, 'profile.read');
  assert.equal(mapped.severity, 'high');
  assert.equal(mapped.autoRecoverable, false);
  assert.equal(mapped.requiresUserAction, true);
  assert.equal(JSON.stringify(mapped).includes('synthetic-health'), false);
  assert.equal(JSON.stringify(mapped).includes('SESSDATA='), false);
});

test('generic normalizer maps common site signals without site-specific branches', () => {
  const normalizer = createHealthSignalNormalizer({
    siteId: 'example',
    signalMap: {
      csrf_failed: {
        type: 'csrf-invalid',
        severity: 'medium',
        affectedCapability: 'post.write',
      },
    },
  });

  assert.deepEqual(normalizer.normalize('csrf_failed'), {
    siteId: 'example',
    rawSignal: 'csrf_failed',
    type: 'csrf-invalid',
    severity: 'medium',
    affectedCapability: 'post.write',
    autoRecoverable: true,
    requiresUserAction: false,
    prohibitedAutoActions: [],
    metadata: {},
  });

  assert.equal(normalizeHealthSignal('429', { siteId: 'example' }).type, 'rate-limited');
});

test('SiteHealthRecoveryEngine refreshes stale sessions without whole-site shutdown', async () => {
  const executed = [];
  const engine = new SiteHealthRecoveryEngine({
    actionExecutor: new RecoveryActionExecutor({
      handlers: {
        'refresh-session': async ({ risk }) => {
          executed.push(risk.type);
          return { status: 'planned' };
        },
        'retry-health-probe': async () => ({ status: 'planned' }),
      },
    }),
  });

  const result = await engine.recover({
    siteId: 'douyin',
    rawSignals: [{
      rawSignal: 'session-invalid',
      type: 'session-stale',
      affectedCapability: 'profile.read',
    }],
    capabilities: ['profile.read', 'search.read'],
  });

  assert.deepEqual(executed, ['session-stale']);
  assert.equal(result.report.status, 'degraded');
  assert.deepEqual(result.report.recommendedActions, ['refresh-session', 'retry-health-probe']);
  assert.equal(result.report.capabilityHealth.find((entry) => entry.capability === 'search.read').status, 'healthy');
});

test('csrf-invalid triggers token refresh and a health probe', async () => {
  const engine = new SiteHealthRecoveryEngine();
  const result = await engine.recover({
    siteId: 'x',
    rawSignals: [{
      rawSignal: 'csrf_failed',
      affectedCapability: 'post.write',
    }],
    capabilities: ['post.write'],
  });

  assert.equal(result.report.risks[0].type, 'csrf-invalid');
  assert.deepEqual(result.report.recommendedActions, ['refresh-csrf-token', 'retry-health-probe']);
  assert.equal(result.recovery.actions.every((entry) => entry.status === 'planned'), true);
});

test('rate-limited applies backoff, reduces concurrency, and switches to readonly mode', async () => {
  const engine = new SiteHealthRecoveryEngine();
  const result = await engine.recover({
    siteId: 'instagram',
    rawSignals: [{
      rawSignal: 'rate-limit',
      affectedCapability: 'media.read',
    }],
    capabilities: ['profile.read', 'media.read'],
  });

  assert.equal(result.report.risks[0].type, 'rate-limited');
  assert.deepEqual(result.report.recommendedActions, [
    'apply-backoff',
    'reduce-concurrency',
    'switch-to-readonly-mode',
  ]);
  assert.equal(result.report.status, 'degraded');
  assert.equal(result.report.capabilityHealth.find((entry) => entry.capability === 'profile.read').status, 'healthy');
});

test('captcha and MFA never trigger bypass-like automatic recovery', async () => {
  for (const rawSignal of ['captcha', 'mfa']) {
    const engine = new SiteHealthRecoveryEngine();
    const result = await engine.recover({
      siteId: 'x',
      rawSignals: [{
        rawSignal,
        affectedCapability: 'authenticated.feed',
      }],
      capabilities: ['profile.read', 'authenticated.feed'],
    });

    assert.equal(result.report.risks[0].requiresUserAction, true);
    assert.equal(result.report.risks[0].autoRecoverable, false);
    assert.deepEqual(result.report.recommendedActions, ['require-user-action', 'safe-stop']);
    assert.equal(result.recovery.actions.some((entry) => entry.action === 'refresh-session'), false);
  }
});

test('account-restricted quarantines site profile and requires user action', async () => {
  const engine = new SiteHealthRecoveryEngine();
  const result = await engine.recover({
    siteId: 'x',
    rawSignals: [{
      rawSignal: 'account_locked',
      affectedCapability: 'profile.read',
      severity: 'critical',
    }],
    capabilities: ['profile.read'],
  });

  assert.equal(result.report.status, 'blocked');
  assert.deepEqual(result.report.recommendedActions, [
    'quarantine-site-profile',
    'require-user-action',
    'safe-stop',
  ]);
  assert.equal(result.report.capabilityHealth[0].status, 'disabled');
});

test('adapter-drift disables only the affected capability', async () => {
  const engine = new SiteHealthRecoveryEngine();
  const result = await engine.recover({
    siteId: 'xiaohongshu',
    rawSignals: [{
      rawSignal: 'adapter_drift',
      affectedCapability: 'follow-query',
    }],
    capabilities: ['follow-query', 'search.read'],
  });

  assert.equal(result.report.status, 'degraded');
  assert.deepEqual(result.report.recommendedActions, ['disable-risky-capability']);
  assert.equal(result.report.capabilityHealth.find((entry) => entry.capability === 'follow-query').status, 'disabled');
  assert.equal(result.report.capabilityHealth.find((entry) => entry.capability === 'search.read').status, 'healthy');
});

test('single capability degradation does not shut down the whole site', () => {
  const report = createSiteHealthReport({
    siteId: 'bilibili',
    risks: [{
      rawSignal: 'capability-disabled',
      affectedCapability: 'api-catalog',
    }],
    capabilities: ['api-catalog', 'profile.read'],
  });

  assert.equal(report.status, 'degraded');
  assert.equal(report.capabilityHealth.find((entry) => entry.capability === 'api-catalog').status, 'disabled');
  assert.equal(report.capabilityHealth.find((entry) => entry.capability === 'profile.read').status, 'healthy');
});

test('unknown health risks safe-stop and block artifact writes in recovery planning', async () => {
  const engine = new SiteHealthRecoveryEngine();
  const result = await engine.recover({
    siteId: 'unknown.test',
    rawSignals: [{
      rawSignal: 'unmapped-platform-signal',
      affectedCapability: 'capture',
    }],
    capabilities: ['capture'],
  });

  assert.equal(result.report.status, 'blocked');
  assert.deepEqual(result.report.recommendedActions, ['safe-stop']);
  assert.equal(result.report.risks[0].type, 'unknown-health-risk');
  assert.equal(result.recovery.auditLog[0].fallbackMode, 'disabled');
});

test('capability registry and user instructions are redacted and action oriented', () => {
  const registry = createCapabilityHealthRegistry({
    capabilities: ['profile.read', 'post.write'],
    risks: [{
      siteId: 'x',
      rawSignal: 'profile-health-risk',
      type: 'platform-risk-detected',
      severity: 'high',
      affectedCapability: 'profile.read',
      autoRecoverable: false,
      requiresUserAction: true,
      prohibitedAutoActions: [],
      metadata: {},
    }],
  });
  const report = createSiteHealthReport({
    siteId: 'x',
    risks: [{
      rawSignal: 'mfa',
      affectedCapability: 'post.write',
      metadata: {
        profilePath: 'C:/Users/example/Profile 1',
      },
    }],
    capabilities: ['profile.read', 'post.write'],
  });

  assert.equal(registry.find((entry) => entry.capability === 'profile.read').status, 'disabled');
  const instructions = createUserRecoveryInstructions(report);
  assert.equal(instructions[0].riskType, 'mfa-required');
  assert.equal(JSON.stringify(instructions).includes('Profile 1'), false);
});
