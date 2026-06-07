import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  RUNTIME_AUDIT_VIEW_SCHEMA_VERSION,
  createRuntimeAuditView,
  loadRuntimeAuditBundle,
  renderRuntimeAuditView,
  sanitizeRuntimeAuditView,
} from '../../src/app/runtime/index.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(TEST_DIR, 'fixtures', 'runtime-execution-replay-audit-viewer-v1');
const RUNTIME_DIR = path.join(TEST_DIR, '..', '..', 'src', 'app', 'runtime');

const CANARIES = Object.freeze([
  'sf_replay_cookie_secret_123',
  'sf_replay_token_secret_456',
  'sf_replay_authorization_secret_789',
  'sf_replay_session_handle_secret_should_not_log',
  'sf_replay_grant_secret_000',
  'sf_replay_cdp_cookie_payload_secret_111',
  'sf_replay_raw_body_secret_222',
  'sf_replay_storage_state_secret_333',
]);

function assertNoCanaryLeak(payload, label = 'audit view output') {
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  for (const canary of CANARIES) {
    assert.equal(serialized.includes(canary), false, `${label} leaked ${canary}`);
  }
  assert.doesNotMatch(
    serialized,
    /Bearer\s+|Authorization|Set-Cookie|Cookie\s*[:=]|storageState|localStorage|sessionStorage|IndexedDB|raw DOM|screenshot|video|grant-secret/u,
  );
}

function baseReport(overrides = {}) {
  return {
    schemaVersion: 'site-capability-execution/v1',
    executionVersion: 'runtime-test-v1',
    reportType: 'RuntimeExecutionReport',
    requestId: 'runtime-invocation:replay-v1',
    executionId: 'execution:replay-v1',
    capabilityId: 'capability:replay-v1:read',
    executionContractRef: 'execution-contract:replay-v1',
    policyDecisionRef: 'policy:replay-v1',
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
    reasonCode: null,
    blockedReason: null,
    artifactRefs: [],
    authSummary: null,
    resultSummary: {
      outcome: 'api_read_completed',
      providerId: 'api_read_provider',
      runtimeMode: 'descriptor_only_read',
      artifactRefs: [],
      redactionRequired: true,
    },
    redactionRequired: true,
    ...overrides,
  };
}

function authSummary({
  used = true,
  outcome = 'used',
  reason = null,
  types = ['bearer_token'],
  count = 1,
} = {}) {
  return {
    required: true,
    used,
    sessionRef: 'auth-session:replay-safe-ref',
    scopesRequested: [{ origin: 'https://replay.example.test', operations: ['read'] }],
    scopesGranted: [{ origin: 'https://replay.example.test', operations: ['read'] }],
    materialSummary: { types, count },
    outcome,
    reason,
  };
}

function auditEvent(report, overrides = {}) {
  return {
    eventType: 'runtime_execution_report',
    auditRef: 'artifact:runtime-audit:replay-v1:1',
    requestId: report.requestId,
    executionId: report.executionId,
    capabilityId: report.capabilityId,
    providerId: report.providerId,
    verdict: report.verdict,
    status: report.status,
    runtimeDispatchAllowed: report.runtimeDispatchAllowed,
    executionAttempted: report.executionAttempted,
    sideEffectAttempted: report.sideEffectAttempted,
    sideEffectSucceeded: report.sideEffectSucceeded,
    sideEffectFailed: report.sideEffectFailed,
    blockedReason: report.blockedReason,
    reasonCode: report.reasonCode,
    artifactRefs: report.artifactRefs,
    authSummary: report.authSummary,
    redactionRequired: true,
    ...overrides,
  };
}

function createView(bundle) {
  const view = createRuntimeAuditView(bundle);
  const json = renderRuntimeAuditView(view, { format: 'json' });
  const text = renderRuntimeAuditView(view, { format: 'text' });
  assert.equal(view.schemaVersion, RUNTIME_AUDIT_VIEW_SCHEMA_VERSION);
  assertNoCanaryLeak({ view, json, text });
  return { view, json, text };
}

test('runtime audit viewer fixtures are present and loadable', async () => {
  const files = (await readdir(FIXTURE_DIR)).filter((file) => file.endsWith('.json')).sort();
  assert.deepEqual(files, ['public-read-success-report.json']);
  const bundle = await loadRuntimeAuditBundle({
    reportPath: path.join(FIXTURE_DIR, files[0]),
  });
  const { view } = createView(bundle);
  assert.equal(view.outcome.status, 'completed');
  assert.equal(view.invocation.providerId, 'api_read_provider');
  assert.equal(view.integrity.sourceSummaries.length, 1);
});

test('audit viewer renders public read, auth read, auth download, and auth browser write success views', () => {
  const scenarios = [
    {
      name: 'public read',
      report: baseReport(),
      expectedProvider: 'api_read_provider',
    },
    {
      name: 'auth read',
      report: baseReport({
        authSummary: authSummary(),
        resultSummary: {
          outcome: 'api_read_completed',
          providerId: 'api_read_provider',
          runtimeMode: 'auth_http_read_v1',
          response: {
            status: 200,
            ok: true,
            contentType: 'application/json',
            bodySummary: { kind: 'json_object', byteLength: 18 },
          },
          authSummary: authSummary(),
          artifactRefs: [],
          redactionRequired: true,
        },
      }),
      expectedProvider: 'api_read_provider',
    },
    {
      name: 'auth download',
      report: baseReport({
        capabilityKind: 'download',
        providerId: 'download_provider',
        providerKind: 'download_provider',
        artifactRefs: ['artifact:runtime-download:replay-export'],
        authSummary: authSummary({ types: ['api_key'] }),
        resultSummary: {
          outcome: 'download_completed',
          providerId: 'download_provider',
          runtimeMode: 'auth_http_download_v1',
          artifactRefs: ['artifact:runtime-download:replay-export'],
          downloads: [{
            artifactRef: 'artifact:runtime-download:replay-export',
            filename: 'replay-export.txt',
            byteSize: 42,
            mimeType: 'text/plain',
            checksum: 'sha256:replay-safe',
          }],
          authSummary: authSummary({ types: ['api_key'] }),
          redactionRequired: true,
        },
      }),
      expectedProvider: 'download_provider',
    },
    {
      name: 'auth browser write',
      report: baseReport({
        capabilityKind: 'submit',
        providerId: 'browser_action_provider',
        providerKind: 'browser_action_provider',
        authSummary: authSummary({ types: ['cookie'] }),
        resultSummary: {
          outcome: 'browser_action_completed',
          providerId: 'browser_action_provider',
          runtimeMode: 'controlled_browser_action_v2',
          browserExecutionTrace: {
            traceType: 'sanitized_browser_execution_trace',
            status: 'completed',
            actionRef: 'action:replay-submit',
            routeRef: 'route:replay-contact',
            slotNames: ['message'],
            startOriginHash: 'origin-hash:replay',
            startPathHash: 'path-hash:replay',
            steps: [
              { kind: 'guard_installed', status: 'completed' },
              { kind: 'navigate', status: 'completed' },
              { kind: 'action', status: 'completed' },
            ],
            authEvents: [{
              event: 'browser.auth.applied',
              originHash: 'origin-hash:replay',
              sessionRef: 'auth-session:replay-safe-ref',
              materialSummary: { types: ['cookie'], count: 1 },
            }],
            completion: { observed: true },
            cleanup: { sessionClosed: true },
            redactionRequired: true,
          },
          authSummary: authSummary({ types: ['cookie'] }),
          artifactRefs: [],
          redactionRequired: true,
        },
      }),
      expectedProvider: 'browser_action_provider',
    },
  ];

  for (const scenario of scenarios) {
    const { view, text } = createView({
      report: scenario.report,
      auditEvents: [auditEvent(scenario.report)],
    });
    assert.equal(view.outcome.status, 'completed', scenario.name);
    assert.equal(view.invocation.providerId, scenario.expectedProvider, scenario.name);
    assert.equal(view.timeline.some((entry) => entry.eventType === 'runtime.execution.completed'), true, scenario.name);
    assert.match(text, /Runtime Audit View/u, scenario.name);
  }
});

test('audit viewer explains blocked and failed runtime outcomes', () => {
  /** @type {Array<[string, any, string]>} */
  const scenarios = [
    ['payment blocked', baseReport({
      status: 'blocked',
      capabilityKind: 'payment',
      providerId: null,
      providerKind: null,
      runtimeDispatchAllowed: false,
      providerInvoked: false,
      executionAttempted: false,
      runtimeExecuted: false,
      sideEffectAttempted: false,
      sideEffectSucceeded: false,
      blockedReason: 'runtime.payment_execution_blocked',
      reasonCode: 'runtime.payment_execution_blocked',
    }), 'runtime.execution.blocked'],
    ['destructive blocked', baseReport({
      status: 'blocked',
      capabilityKind: 'destructive',
      providerId: null,
      providerKind: null,
      runtimeDispatchAllowed: false,
      providerInvoked: false,
      executionAttempted: false,
      runtimeExecuted: false,
      sideEffectAttempted: false,
      sideEffectSucceeded: false,
      blockedReason: 'runtime.destructive_execution_blocked',
      reasonCode: 'runtime.destructive_execution_blocked',
    }), 'runtime.execution.blocked'],
    ['auth gate blocked', baseReport({
      status: 'blocked',
      providerInvoked: false,
      executionAttempted: false,
      runtimeExecuted: false,
      sideEffectAttempted: false,
      sideEffectSucceeded: false,
      blockedReason: 'runtime.auth_session_missing',
      reasonCode: 'runtime.auth_session_missing',
      authSummary: authSummary({ used: false, outcome: 'blocked', reason: 'runtime.auth_session_missing', count: 0 }),
    }), 'runtime.auth.gate.blocked'],
    ['browser guard failure', baseReport({
      status: 'failed',
      providerId: 'browser_action_provider',
      providerKind: 'browser_action_provider',
      reasonCode: 'runtime.browser_runtime_unavailable',
      sideEffectAttempted: false,
      sideEffectSucceeded: false,
      sideEffectFailed: true,
      resultSummary: {
        outcome: 'browser_action_failed',
        providerId: 'browser_action_provider',
        reasonCode: 'runtime.browser_runtime_unavailable',
        browserExecutionTrace: {
          traceType: 'sanitized_browser_execution_trace',
          status: 'failed',
          steps: [{ kind: 'guard_failed', status: 'failed', reasonCode: 'runtime.browser_runtime_unavailable' }],
          cleanup: { sessionClosed: true },
          redactionRequired: true,
        },
        redactionRequired: true,
      },
    }), 'runtime.execution.failed'],
    ['provider failure', baseReport({
      status: 'failed',
      reasonCode: 'runtime.provider_failed',
      sideEffectSucceeded: false,
      sideEffectFailed: true,
      sanitizedError: { name: 'Error', code: 'runtime.provider_failed', message: 'Runtime provider failed' },
    }), 'runtime.execution.failed'],
  ];

  for (const [name, report, expectedEvent] of scenarios) {
    const { view } = createView({ report, auditEvents: [auditEvent(report)] });
    assert.equal(view.timeline.some((entry) => entry.eventType === expectedEvent), true, name);
    assert.equal(view.outcome.sideEffectAttempted, report.sideEffectAttempted, name);
  }
});

test('audit viewer rejects malformed JSON and warns on mismatched report/audit bundles', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'siteforge-audit-viewer-'));
  try {
    const malformed = path.join(tempDir, 'malformed.json');
    await writeFile(malformed, '{not-json', 'utf8');
    await assert.rejects(
      () => loadRuntimeAuditBundle({ reportPath: malformed }),
      /Runtime audit bundle JSON is malformed/u,
    );

    const report = baseReport();
    const { view } = createView({
      report,
      auditEvents: [auditEvent(report, { requestId: 'runtime-invocation:other' })],
    });
    assert.equal(view.integrity.status, 'warning');
    assert.equal(view.integrity.warnings[0].code, 'runtime.audit_view.input_mismatch');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('audit viewer sanitizes unsafe input canaries from JSON and text output', () => {
  const report = baseReport({
    authSummary: {
      ...authSummary(),
      sessionRef: CANARIES[3],
    },
    resultSummary: {
      outcome: 'api_read_failed',
      providerId: 'api_read_provider',
      response: {
        status: 401,
        ok: false,
        contentType: 'application/json',
        bodySummary: { kind: 'json_object', byteLength: 123 },
      },
      authSummary: authSummary(),
      redactionRequired: true,
    },
  });
  const { view, json, text } = createView({
    report,
    auditEvents: [auditEvent(report)],
    providerResult: {
      providerId: 'api_read_provider',
      status: 'failed',
      rawHeaders: { Authorization: `Bearer ${CANARIES[2]}` },
      rawBody: CANARIES[6],
      sessionHandle: CANARIES[3],
      grantId: CANARIES[4],
      browserContext: { storageState: CANARIES[7] },
      resultSummary: {
        outcome: 'api_read_failed',
        providerId: 'api_read_provider',
        response: { status: 401, contentType: 'application/json' },
      },
    },
    artifactMetadata: [{
      artifactRef: 'artifact:runtime-download:replay',
      filename: 'safe.txt',
      cookieName: CANARIES[0],
      rawCdpPayload: CANARIES[5],
    }],
  });
  assert.equal(view.redactionSummary.unsafeInputDetected, true);
  assertNoCanaryLeak(json, 'json renderer');
  assertNoCanaryLeak(text, 'text renderer');
});

test('audit viewer modules are read-only and do not import execution/provider/vault/browser side-effect paths', async () => {
  const files = [
    'audit-view-builder.mjs',
    'audit-view-loader.mjs',
    'audit-view-renderer-json.mjs',
    'audit-view-renderer-text.mjs',
    'audit-view-sanitizer.mjs',
    'audit-view-integrity.mjs',
    'index.mjs',
  ];
  for (const file of files) {
    const source = await readFile(path.join(RUNTIME_DIR, 'audit-viewer', file), 'utf8');
    assert.doesNotMatch(source, /executeRuntimeInvocation|provider-registry|providers\/|SessionVault|inspectSession|getScopedSessionMaterial|openBrowserSession|fetchImpl|globalThis\.fetch/u, file);
  }

  const runtimeIndex = await readFile(path.join(RUNTIME_DIR, 'index.mjs'), 'utf8');
  assert.doesNotMatch(runtimeIndex, /createMockSessionVault|createFakeControlledBrowserRuntimeDeps|fixture|testing provider/u);

  const view = sanitizeRuntimeAuditView(createRuntimeAuditView({ report: baseReport() }));
  assert.equal(view.outcome.status, 'completed');
});
