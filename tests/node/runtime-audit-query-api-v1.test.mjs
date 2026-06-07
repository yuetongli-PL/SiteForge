import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  compareRuntimeAuditViews,
  createRuntimeAuditRegressionSnapshot,
  createRuntimeAuditView,
  loadRuntimeAuditBundle,
  queryRuntimeAuditViews,
  summarizeRuntimeAuditViews,
} from '../../src/app/runtime/index.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(TEST_DIR, 'fixtures', 'runtime-audit-query-api-v1');
const RUNTIME_DIR = path.join(TEST_DIR, '..', '..', 'src', 'app', 'runtime');

const CANARIES = Object.freeze([
  'sf_global_cookie_secret_123',
  'sf_global_token_secret_456',
  'sf_global_authorization_secret_789',
  'sf_global_session_handle_secret_should_not_log',
  'sf_global_grant_secret_000',
  'sf_global_storage_state_secret_111',
  'sf_global_destructive_confirmation_secret_222',
  'sf_global_raw_body_secret_333',
]);

const ORIGIN = 'https://query.example.test';

function assertNoCanaryLeak(payload, label = 'audit query output') {
  const serialized = JSON.stringify(payload);
  for (const canary of CANARIES) {
    assert.equal(serialized.includes(canary), false, `${label} leaked ${canary}`);
  }
  assert.doesNotMatch(serialized, /Bearer\s+|Authorization|Cookie\s*[:=]|Set-Cookie|storageState|rawBody/u);
}

function report(overrides = {}) {
  return {
    schemaVersion: 'site-capability-execution/v1',
    executionVersion: 'runtime-test-v1',
    reportType: 'RuntimeExecutionReport',
    requestId: 'runtime-invocation:query-v1',
    executionId: 'execution:query-v1',
    capabilityId: 'capability:query-v1',
    executionContractRef: 'execution-contract:query-v1',
    policyDecisionRef: 'policy:query-v1',
    verdict: 'allow',
    status: 'completed',
    capabilityKind: 'read',
    providerId: 'api_read_provider',
    providerKind: 'api_read_provider',
    runtimeDispatchAllowed: true,
    providerInvoked: true,
    executionAttempted: true,
    runtimeExecuted: true,
    sideEffectAttempted: true,
    sideEffectSucceeded: true,
    sideEffectFailed: false,
    artifactRefs: [],
    resultSummary: {
      outcome: 'api_read_completed',
      providerId: 'api_read_provider',
      artifactRefs: [],
      redactionRequired: true,
    },
    redactionRequired: true,
    ...overrides,
  };
}

function authSummary({ used = true, type = 'bearer_token', operation = 'read', outcome = 'used', reason = null } = {}) {
  return {
    required: true,
    used,
    sessionRef: 'auth-session:query-safe',
    scopesRequested: [{ origin: ORIGIN, operations: [operation] }],
    scopesGranted: [{ origin: ORIGIN, operations: [operation] }],
    materialSummary: { types: used ? [type] : [], count: used ? 1 : 0 },
    outcome,
    reason,
  };
}

function view(overrides = {}) {
  return createRuntimeAuditView({ report: report(overrides) });
}

test('runtime audit query fixtures are present and loadable', async () => {
  const files = (await readdir(FIXTURE_DIR)).filter((file) => file.endsWith('.json')).sort();
  assert.deepEqual(files, ['auth-blocked-view.json']);
  const fixture = JSON.parse(await readFile(path.join(FIXTURE_DIR, files[0]), 'utf8'));
  const result = queryRuntimeAuditViews([fixture], { reason: 'runtime.auth_session_scope_not_allowed' });
  assert.equal(result.count, 1);
  assertNoCanaryLeak(result, 'fixture query');
});

test('query filters by reason outcome provider auth browser material and target origin', () => {
  const views = [
    view(),
    view({
      requestId: 'runtime-invocation:query-auth',
      authSummary: authSummary(),
    }),
    view({
      requestId: 'runtime-invocation:query-browser',
      capabilityKind: 'submit',
      providerId: 'browser_action_provider',
      providerKind: 'browser_action_provider',
      authSummary: authSummary({ type: 'cookie', operation: 'form_or_action' }),
    }),
    view({
      requestId: 'runtime-invocation:query-blocked-auth',
      status: 'blocked',
      providerInvoked: false,
      executionAttempted: false,
      runtimeExecuted: false,
      sideEffectAttempted: false,
      sideEffectSucceeded: false,
      reasonCode: 'runtime.auth_session_scope_not_allowed',
      blockedReason: 'runtime.auth_session_scope_not_allowed',
      authSummary: authSummary({ used: false, outcome: 'blocked', reason: 'runtime.auth_session_scope_not_allowed' }),
    }),
    view({
      requestId: 'runtime-invocation:query-destructive',
      status: 'blocked',
      capabilityKind: 'destructive',
      providerId: null,
      providerKind: null,
      providerInvoked: false,
      executionAttempted: false,
      runtimeExecuted: false,
      sideEffectAttempted: false,
      sideEffectSucceeded: false,
      reasonCode: 'runtime.destructive_execution_blocked',
      blockedReason: 'runtime.destructive_execution_blocked',
    }),
  ];

  assert.equal(queryRuntimeAuditViews(views, { providerId: 'browser_action_provider' }).count, 1);
  assert.equal(queryRuntimeAuditViews(views, { capabilityKind: 'submit' }).count, 1);
  assert.equal(queryRuntimeAuditViews(views, { reason: 'runtime.auth_session_scope_not_allowed' }).count, 1);
  assert.equal(queryRuntimeAuditViews(views, { status: 'blocked' }).count, 2);
  assert.equal(queryRuntimeAuditViews(views, { sideEffectAttempted: true }).count, 3);
  assert.equal(queryRuntimeAuditViews(views, { authUsed: true }).count, 2);
  assert.equal(queryRuntimeAuditViews(views, { materialType: 'cookie' }).count, 1);
  assert.equal(queryRuntimeAuditViews(views, { targetOrigin: ORIGIN }).count, 3);
  assert.equal(queryRuntimeAuditViews(views, { reason: 'runtime.destructive_execution_blocked' }).count, 1);
  assertNoCanaryLeak({ views: views.map((item) => item.sourceDigest), stats: summarizeRuntimeAuditViews(views) }, 'query matrix');
});

test('query can find unsafe-input audit views without leaking canaries', () => {
  const unsafe = createRuntimeAuditView({
    report: report({
      requestId: 'runtime-invocation:query-unsafe',
      authSummary: { ...authSummary(), sessionRef: CANARIES[3] },
    }),
    providerResult: {
      providerId: 'api_read_provider',
      rawHeaders: { Authorization: `Bearer ${CANARIES[2]}` },
      rawBody: CANARIES[7],
      storageState: CANARIES[5],
      grantId: CANARIES[4],
    },
  });
  const result = queryRuntimeAuditViews([unsafe], { unsafeInputDetected: true });
  assert.equal(result.count, 1);
  assert.equal(result.results[0].unsafeInputDetected, true);
  assertNoCanaryLeak({ unsafe, result }, 'unsafe query');
});

test('compare detects identical views and high-risk behavior drift', () => {
  const before = view({
    requestId: 'runtime-invocation:compare-before',
    status: 'blocked',
    providerInvoked: false,
    executionAttempted: false,
    runtimeExecuted: false,
    sideEffectAttempted: false,
    sideEffectSucceeded: false,
    reasonCode: 'runtime.auth_session_missing',
    blockedReason: 'runtime.auth_session_missing',
  });
  const identical = compareRuntimeAuditViews(before, before);
  assert.equal(identical.status, 'same');
  assert.deepEqual(identical.changes, []);

  const after = view({
    requestId: 'runtime-invocation:compare-after',
    status: 'completed',
    providerInvoked: true,
    executionAttempted: true,
    runtimeExecuted: true,
    sideEffectAttempted: true,
    sideEffectSucceeded: true,
    reasonCode: null,
    blockedReason: null,
  });
  const drift = compareRuntimeAuditViews(before, after);
  assert.equal(drift.status, 'changed');
  assert.equal(drift.changes.some((change) => change.path === 'outcome.sideEffectAttempted' && change.severity === 'high'), true);
  assert.equal(drift.changes.some((change) => change.path === 'status' && change.severity === 'high'), true);

  const reasonDrift = compareRuntimeAuditViews(
    view({ status: 'blocked', reasonCode: 'runtime.payment_execution_blocked', blockedReason: 'runtime.payment_execution_blocked', sideEffectAttempted: false }),
    view({ status: 'blocked', reasonCode: 'runtime.provider_failed', blockedReason: 'runtime.provider_failed', sideEffectAttempted: false }),
  );
  assert.equal(reasonDrift.changes.some((change) => change.path === 'reason' && change.severity === 'high'), true);
  assertNoCanaryLeak({ identical, drift, reasonDrift }, 'compare output');
});

test('regression snapshot and stats are sanitized', () => {
  const views = [
    view({ authSummary: authSummary() }),
    view({
      requestId: 'runtime-invocation:snapshot-blocked',
      status: 'blocked',
      providerInvoked: false,
      executionAttempted: false,
      runtimeExecuted: false,
      sideEffectAttempted: false,
      sideEffectSucceeded: false,
      reasonCode: 'runtime.destructive_execution_blocked',
      blockedReason: 'runtime.destructive_execution_blocked',
    }),
  ];
  const snapshot = createRuntimeAuditRegressionSnapshot(views, {
    snapshotId: 'runtime-audit-regression:query-v1',
  });
  const stats = summarizeRuntimeAuditViews(views);
  assert.equal(snapshot.viewCount, 2);
  assert.equal(stats.byStatus.completed, 1);
  assert.equal(stats.byStatus.blocked, 1);
  assert.equal(stats.sideEffectAttemptedCount, 1);
  assertNoCanaryLeak({ snapshot, stats }, 'snapshot stats');
});

test('replay loader rejects malformed and oversized input for query hardening', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'siteforge-audit-query-'));
  try {
    const malformed = path.join(tempDir, 'malformed.json');
    await writeFile(malformed, '{not-json', 'utf8');
    await assert.rejects(() => loadRuntimeAuditBundle({ reportPath: malformed }), /malformed/u);

    const oversized = path.join(tempDir, 'oversized.json');
    await writeFile(oversized, JSON.stringify({ payload: 'x'.repeat(128) }), 'utf8');
    await assert.rejects(() => loadRuntimeAuditBundle({ reportPath: oversized, maxBytes: 16 }), /size limit/u);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('audit query modules are read-only and do not import provider implementations', async () => {
  const files = [
    'audit-query-index.mjs',
    'audit-query-filter.mjs',
    'audit-query-compare.mjs',
    'audit-query-regression.mjs',
    'audit-query-stats.mjs',
    'audit-query-sanitizer.mjs',
  ];
  for (const file of files) {
    const source = await readFile(path.join(RUNTIME_DIR, 'audit-query', file), 'utf8');
    assert.doesNotMatch(source, /executeRuntimeInvocation|provider-registry|providers\/|sessionVault|getScopedSessionMaterial|openBrowserSession|fetch\(|globalThis\.fetch/u, file);
  }
});
