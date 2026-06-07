// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertRuntimeRegressionSnapshotValid,
  compareRuntimeRegressionSnapshots,
  createRuntimeRegressionReport,
  runRuntimeRegressionHarness,
} from '../../src/app/runtime/index.mjs';
import {
  createRuntimeRegressionSnapshotFixture,
} from '../../src/app/runtime/testing.mjs';

const REGRESSION_CANARIES =
  /sf_regression_cookie_secret_123|sf_regression_token_secret_456|sf_regression_raw_body_secret_789/u;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseline(overrides = {}) {
  const base = createRuntimeRegressionSnapshotFixture({
    snapshotId: 'runtime-ci-regression:baseline',
  });
  return {
    ...base,
    ...overrides,
    runtime: {
      ...base.runtime,
      ...(overrides.runtime ?? {}),
    },
    auth: {
      ...base.auth,
      ...(overrides.auth ?? {}),
    },
    browserGuard: {
      ...base.browserGuard,
      ...(overrides.browserGuard ?? {}),
    },
    policy: {
      ...base.policy,
      ...(overrides.policy ?? {}),
    },
    metadata: {
      ...base.metadata,
      ...(overrides.metadata ?? {}),
    },
  };
}

function compareChange(previous, next, kind) {
  const comparison = compareRuntimeRegressionSnapshots(previous, next);
  return comparison.changes.find((change) => change.kind === kind);
}

test('identical snapshots pass', () => {
  const snapshot = baseline();
  const comparison = compareRuntimeRegressionSnapshots(snapshot, clone(snapshot));
  const report = runRuntimeRegressionHarness({
    cases: [{ caseId: 'identical', previous: snapshot, next: clone(snapshot) }],
  });

  assert.equal(comparison.status, 'same');
  assert.equal(comparison.changeCount, 0);
  assert.equal(report.status, 'passed');
});

test('sideEffectAttempted false to true is high severity', () => {
  const change = compareChange(
    baseline(),
    baseline({ runtime: { sideEffectAttempted: true } }),
    'side_effect_introduced',
  );

  assert.equal(change.severity, 'high');
});

test('blocked to completed is high severity', () => {
  const change = compareChange(
    baseline({ runtime: { status: 'blocked' } }),
    baseline({ runtime: { status: 'completed' } }),
    'blocked_to_completed',
  );

  assert.equal(change.severity, 'high');
});

test('payment blocked to provider invoked is critical', () => {
  const change = compareChange(
    baseline({
      runtime: {
        reasonCode: 'runtime.payment_execution_blocked',
        paymentBlocked: true,
        providerInvoked: false,
      },
    }),
    baseline({
      runtime: {
        reasonCode: 'runtime.payment_execution_blocked',
        paymentBlocked: true,
        providerInvoked: true,
      },
    }),
    'payment_provider_invoked',
  );

  assert.equal(change.severity, 'critical');
});

test('destructive blocked to provider invoked is critical', () => {
  const change = compareChange(
    baseline({
      runtime: {
        reasonCode: 'runtime.destructive_execution_blocked',
        destructiveBlocked: true,
        providerInvoked: false,
      },
    }),
    baseline({
      runtime: {
        reasonCode: 'runtime.destructive_execution_blocked',
        destructiveBlocked: true,
        providerInvoked: true,
      },
    }),
    'destructive_provider_invoked',
  );

  assert.equal(change.severity, 'critical');
});

test('auth scope widening is high severity', () => {
  const change = compareChange(
    baseline({ auth: { scopes: ['orders.read'] } }),
    baseline({ auth: { scopes: ['orders.read', 'orders.write'] } }),
    'auth_scope_widened',
  );

  assert.equal(change.severity, 'high');
});

test('allowedOrigins widening is high severity', () => {
  const change = compareChange(
    baseline({ browserGuard: { allowedOrigins: ['https://example.com'] } }),
    baseline({ browserGuard: { allowedOrigins: ['https://example.com', 'https://admin.example.com'] } }),
    'allowed_origins_widened',
  );

  assert.equal(change.severity, 'high');
});

test('providerId changed is flagged', () => {
  const change = compareChange(
    baseline({ runtime: { providerId: 'api_read_provider' } }),
    baseline({ runtime: { providerId: 'browser_action_provider' } }),
    'provider_changed',
  );

  assert.equal(change.path, 'runtime.providerId');
  assert.equal(change.severity, 'medium');
});

test('reason rename is flagged', () => {
  const change = compareChange(
    baseline({ runtime: { reasonCode: 'runtime.policy_blocked' } }),
    baseline({ runtime: { reasonCode: 'runtime.policy_denied' } }),
    'reason_changed',
  );

  assert.equal(change.path, 'runtime.reasonCode');
  assert.equal(change.severity, 'medium');
});

test('policy deny to allow is high severity', () => {
  const change = compareChange(
    baseline({ policy: { verdict: 'blocked', allowed: false } }),
    baseline({ policy: { verdict: 'allow', allowed: true } }),
    'policy_denied_to_allowed',
  );

  assert.equal(change.severity, 'high');
});

test('safe metadata change is low severity', () => {
  const comparison = compareRuntimeRegressionSnapshots(
    baseline({ metadata: { label: 'baseline' } }),
    baseline({ metadata: { label: 'renamed baseline' } }),
  );
  const change = comparison.changes.find((entry) => entry.kind === 'metadata_changed');

  assert.equal(comparison.maxSeverity, 'low');
  assert.equal(change.severity, 'low');
});

test('malformed snapshot fails closed', () => {
  const report = runRuntimeRegressionHarness({
    cases: [{
      caseId: 'malformed',
      previous: { runtime: { status: 'blocked' } },
      next: baseline(),
    }],
  });

  assert.equal(report.status, 'failed_closed');
  assert.equal(report.failedClosedCount, 1);
  assert.equal(report.comparisons[0].maxSeverity, 'critical');
});

test('regression report is sanitized', () => {
  const comparison = compareRuntimeRegressionSnapshots(
    baseline(),
    baseline({ runtime: { sideEffectAttempted: true } }),
  );
  const report = createRuntimeRegressionReport({
    reportId: 'runtime-ci-regression:phase19',
    comparisons: [comparison],
  });

  assert.equal(report.reportType, 'runtime_ci_regression_report');
  assert.equal(report.status, 'failed');
  assert.equal(report.providerInvoked, false);
  assert.equal(report.browserInvoked, false);
  assert.equal(report.vaultAccessed, false);
  assert.equal(report.networkInvoked, false);
  assert.doesNotMatch(JSON.stringify(report), REGRESSION_CANARIES);
});

test('no canary leakage and raw material is rejected fail closed', () => {
  assert.throws(
    () => assertRuntimeRegressionSnapshotValid({
      snapshotId: 'runtime-ci-regression:raw',
      runtime: { status: 'blocked' },
      headers: {
        Cookie: 'sf_regression_cookie_secret_123',
        Authorization: 'Bearer sf_regression_token_secret_456',
      },
      rawBody: 'sf_regression_raw_body_secret_789',
    }),
    (error) => error.code === 'runtime_regression.raw_material_rejected',
  );

  const report = runRuntimeRegressionHarness({
    cases: [{
      caseId: 'raw-canary',
      previous: {
        snapshotId: 'runtime-ci-regression:raw',
        runtime: { status: 'blocked' },
        rawBody: 'sf_regression_raw_body_secret_789',
      },
      next: baseline(),
    }],
  });

  assert.equal(report.status, 'failed_closed');
  assert.doesNotMatch(JSON.stringify(report), REGRESSION_CANARIES);
});
