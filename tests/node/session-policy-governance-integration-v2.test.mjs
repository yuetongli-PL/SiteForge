import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  createRuntimeInvocationRequest,
} from '../../src/app/planner/index.mjs';
import {
  BROWSER_ACTION_PROVIDER_ID,
  RUNTIME_AUTH_REASONS,
  createDefaultSessionPolicyEvaluator,
  createProductionRuntimeProviderRegistry,
  createRuntimeAuditRecorder,
  createRuntimeAuditView,
  executeRuntimeInvocation,
  sanitizeSessionPolicyDecision,
} from '../../src/app/runtime/index.mjs';
import {
  createFakeControlledBrowserRuntimeDeps,
  createMockSessionVault,
} from '../../src/app/runtime/testing.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../src/domain/policies/execution/index.mjs';
import {
  evaluateSessionPolicy,
} from '../../src/domain/policies/session-policy.mjs';

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'session-policy-governance-integration-v2',
);
const RUNTIME_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

const CANARIES = Object.freeze([
  'sf_policy_token_secret_123',
  'sf_policy_cookie_secret_456',
  'sf_policy_session_handle_secret_should_not_log',
  'sf_policy_grant_secret_789',
]);

const ORIGIN = 'https://policy.example.test';
const START_URL = `${ORIGIN}/contact`;

function assertNoCanaryLeak(payload, label = 'policy output') {
  const serialized = JSON.stringify(payload);
  for (const canary of CANARIES) {
    assert.equal(serialized.includes(canary), false, `${label} leaked ${canary}`);
  }
  assert.doesNotMatch(serialized, /Bearer\s+|Authorization|Cookie\s*[:=]|Set-Cookie|grant/u);
}

function scope({ origin = ORIGIN, operations = ['read'] } = {}) {
  return { origin, operations };
}

function authRequirement({
  operations = ['read'],
  materialTypes = ['bearer_token'],
  injectionTarget = 'http_request',
} = {}) {
  return {
    required: true,
    mode: 'session_handle',
    scopes: [scope({ operations })],
    material: { allowedTypes: materialTypes, injectionTarget },
    policy: {
      requireGovernanceGate: true,
      allowCredentialForwarding: false,
      allowRawHeaderAudit: false,
      allowRawCookieAudit: false,
      allowRawBodyAudit: false,
    },
  };
}

function authData({ operations = ['read'], authGate = { satisfied: true, gateId: 'gate:policy', policyId: 'governance-policy:session-policy-test' } } = {}) {
  return {
    sessionHandle: CANARIES[2],
    requestedScopes: [scope({ operations })],
    ...(authGate === undefined ? {} : { authGate }),
  };
}

function requestFor({
  capabilityId = 'capability:policy-v2:read',
  executionContractRef = 'execution-contract:policy-v2:read',
  requirement = authRequirement(),
  auth = authData(),
  requiredGates = [],
  verdictHint = 'allow',
} = {}) {
  return createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: 'policy.example.test',
      capabilityId,
      executionContractRef,
      planId: `plan:${capabilityId.replace(/[^a-z0-9:_-]+/giu, '-')}`,
    },
    executionContractRef,
    policyDecisionRef: `policy:${capabilityId.replace(/[^a-z0-9:_-]+/giu, '-')}`,
    verdictHint,
    requiredGates,
    authRequirement: requirement,
    auth,
  });
}

function policyFor(request, {
  verdict = 'allow',
  gates = [],
  gateStatus = null,
  downloaderInvocationAllowed = false,
  siteAdapterInvocationAllowed = true,
} = {}) {
  return createGovernedExecutionPolicyDecision({
    executionId: `execution:${request.capabilityId}`,
    capabilityId: request.capabilityId,
    executionContractRef: request.executionContractRef,
    verdict,
    gates,
    gateStatus,
    runtimeDispatchAllowed: verdict !== 'blocked',
    siteAdapterInvocationAllowed,
    downloaderInvocationAllowed,
    auditRequired: gates.includes('audit_required'),
  });
}

function readContract(requirement = authRequirement()) {
  return {
    capabilityKind: 'read',
    operationKind: 'api_request',
    contractKind: 'api_request',
    runtimeBinding: { httpRequest: { url: `${ORIGIN}/api/items`, method: 'GET' } },
    authRequirement: requirement,
    redactionRequired: true,
  };
}

function downloadContract(requirement = authRequirement({ operations: ['download'], materialTypes: ['api_key'] })) {
  return {
    capabilityKind: 'download',
    operationKind: 'download',
    contractKind: 'download',
    runtimeBinding: { downloadDescriptor: { url: `${ORIGIN}/api/export`, method: 'GET', filename: 'policy-export.txt' } },
    downloadDescriptor: { filename: 'policy-export.txt' },
    authRequirement: requirement,
    redactionRequired: true,
  };
}

function browserContract(requirement = authRequirement({ operations: ['form_or_action'], materialTypes: ['cookie'], injectionTarget: 'browser_context' })) {
  return {
    capabilityKind: 'submit',
    operationKind: 'form_or_action',
    contractKind: 'form_or_action',
    runtimeBinding: { kind: 'browser_bridge', targetUrl: START_URL },
    authRequirement: requirement,
    browserActionDescriptor: {
      actionRef: 'action:policy-submit',
      routeRef: 'route:policy-contact',
      requiredSlots: ['message'],
      selectors: {
        fields: { message: '[data-sf-field="message"]' },
        submit: '[data-sf-action="submit-contact"]',
      },
      completionSignal: { kind: 'selectorVisible', selector: '[data-sf-completion="contact-submitted"]', timeoutMs: 250 },
    },
    payloadTemplate: {
      material: 'template_only',
      redactionRequired: true,
      savedMaterial: 'sanitized_summary_only',
      slotBindings: [{ name: 'message', type: 'string', required: true, selector: '[data-sf-field="message"]' }],
      steps: [{ kind: 'form_submit', selector: '[data-sf-action="submit-contact"]', actionRef: 'action:policy-submit' }],
    },
    redactionRequired: true,
  };
}

function vaultFor({ operations = ['read'], material = [{ type: 'bearer_token', value: CANARIES[0] }] } = {}) {
  return createMockSessionVault({
    sessionHandle: CANARIES[2],
    sessionRef: 'auth-session:policy-safe',
    scopes: [scope({ operations })],
    grantId: CANARIES[3],
    material,
  });
}

test('session policy governance fixtures are present and sanitized', async () => {
  const files = (await readdir(FIXTURE_DIR)).filter((file) => file.endsWith('.json')).sort();
  assert.deepEqual(files, ['policy-allowed.json']);
  const fixture = JSON.parse(await readFile(path.join(FIXTURE_DIR, files[0]), 'utf8'));
  const decision = sanitizeSessionPolicyDecision(fixture);
  assert.equal(decision.allowed, true);
  assertNoCanaryLeak(decision, 'fixture decision');
});

test('default session policy evaluator allows scoped auth read, download, and browser write', async () => {
  const evaluator = createDefaultSessionPolicyEvaluator();
  const readRequest = requestFor();
  const readAudit = createRuntimeAuditRecorder();
  const readReport = await executeRuntimeInvocation({
    invocationRequest: readRequest,
    policyDecision: policyFor(readRequest),
    executionContract: readContract(),
    runtimeContext: {
      sessionVault: vaultFor({ operations: ['read'] }),
      sessionPolicyEvaluator: evaluator,
      async fetchImpl(_url, options) {
        assert.equal(options.headers.authorization, `Bearer ${CANARIES[0]}`);
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
    auditRecorder: readAudit,
  });
  assert.equal(readReport.status, 'completed');
  assert.equal(readReport.policySummary.allowed, true);

  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'siteforge-policy-download-'));
  try {
    const downloadRequest = requestFor({
      capabilityId: 'capability:policy-v2:download',
      executionContractRef: 'execution-contract:policy-v2:download',
      requirement: authRequirement({ operations: ['download'], materialTypes: ['api_key'] }),
      auth: authData({ operations: ['download'] }),
      requiredGates: ['output_path_required'],
      verdictHint: 'controlled',
    });
    const gateStatus = { allSatisfied: true, output_path_required: { satisfied: true } };
    const downloadReport = await executeRuntimeInvocation({
      invocationRequest: downloadRequest,
      policyDecision: policyFor(downloadRequest, {
        verdict: 'controlled',
        gates: ['output_path_required'],
        gateStatus,
        downloaderInvocationAllowed: true,
        siteAdapterInvocationAllowed: false,
      }),
      gateStatus,
      executionContract: downloadContract(),
      runtimeContext: {
        sessionVault: vaultFor({
          operations: ['download'],
          material: [{ type: 'api_key', value: CANARIES[0], headerName: 'x-api-key' }],
        }),
        sessionPolicyEvaluator: evaluateSessionPolicy,
        outputDir,
        downloadFilename: 'policy-export.txt',
        async fetchImpl() {
          return new Response('download fixture', { status: 200, headers: { 'content-type': 'text/plain' } });
        },
      },
      providerRegistry: createProductionRuntimeProviderRegistry(),
    });
    assert.equal(downloadReport.status, 'completed');
    assert.equal(downloadReport.policySummary.allowed, true);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }

  const fake = createFakeControlledBrowserRuntimeDeps();
  const browserRequest = requestFor({
    capabilityId: 'capability:policy-v2:browser',
    executionContractRef: 'execution-contract:policy-v2:browser',
    requirement: authRequirement({ operations: ['form_or_action'], materialTypes: ['cookie'], injectionTarget: 'browser_context' }),
    auth: authData({ operations: ['form_or_action'] }),
  });
  const browserReport = await executeRuntimeInvocation({
    invocationRequest: browserRequest,
    policyDecision: policyFor(browserRequest),
    executionContract: browserContract(),
    runtimeContext: {
      controlledBrowserRuntime: true,
      browserRuntime: {
        mode: 'controlled',
        engine: 'chromium',
        startUrl: START_URL,
        allowedOrigins: [ORIGIN],
        allowExternalNetwork: false,
        allowDownloads: false,
        allowPopups: false,
        persistProfile: false,
        recordDom: false,
        recordScreenshots: false,
        recordVideo: false,
        recordFullTrace: false,
      },
      slotValues: { message: 'policy browser fixture' },
      sessionVault: vaultFor({
        operations: ['form_or_action'],
        material: [{ type: 'cookie', name: 'policy_cookie', value: CANARIES[1], path: '/', secure: true, sameSite: 'Lax' }],
      }),
      sessionPolicyEvaluator: evaluator,
    },
    providerRegistry: createProductionRuntimeProviderRegistry({ browserRuntimeDeps: { openBrowserSession: fake.openBrowserSession } }),
  });
  assert.equal(browserReport.status, 'completed', JSON.stringify(browserReport));
  assert.equal(browserReport.providerId, BROWSER_ACTION_PROVIDER_ID);
  assert.equal(browserReport.policySummary.allowed, true);
  assertNoCanaryLeak({ readReport, readAudit: readAudit.listEvents(), browserReport }, 'allowed reports');
});

test('session policy denials map to stable runtime auth reasons before provider material access', async () => {
  /** @type {Array<[string, string, any?]>} */
  const scenarios = [
    ['scope denied', RUNTIME_AUTH_REASONS.scopeNotAllowed],
    ['material target denied', RUNTIME_AUTH_REASONS.authRequired],
    ['missing governance gate', RUNTIME_AUTH_REASONS.policyGateNotSatisfied, undefined],
  ];
  for (const [name, reason, authGate = { satisfied: true, gateId: 'gate:policy', policyId: 'governance-policy:session-policy-test' }] of scenarios) {
    const request = requestFor({
      capabilityId: `capability:policy-v2:${name.replace(/\s+/gu, '-')}`,
      executionContractRef: `execution-contract:policy-v2:${name.replace(/\s+/gu, '-')}`,
      auth: authData({ authGate }),
    });
    const vault = vaultFor();
    const report = await executeRuntimeInvocation({
      invocationRequest: request,
      policyDecision: policyFor(request),
      executionContract: readContract(),
      runtimeContext: {
        sessionVault: vault,
        sessionPolicyEvaluator(input) {
          assertNoCanaryLeak(input, `${name} policy input`);
          return {
            allowed: false,
            reason,
            decisionId: `policy-decision:${name.replace(/\s+/gu, '-')}`,
            policyId: 'governance-policy:session-policy-test',
            scopesGranted: [],
            materialTypesAllowed: [],
            constraints: { requireRelease: true },
          };
        },
      },
      providerRegistry: createProductionRuntimeProviderRegistry(),
    });
    assert.equal(report.status, 'blocked', name);
    assert.equal(report.blockedReason, reason, name);
    assert.equal(report.providerInvoked, false, name);
    assert.equal(report.executionAttempted, false, name);
    assert.equal(report.sideEffectAttempted, false, name);
    assert.equal(vault.getCounters().getScopedSessionMaterialCalls, 0, name);
    assert.equal(report.policySummary.allowed, false, name);
    assertNoCanaryLeak(report, name);
  }
});

test('session policy constraints are passed to ProviderAuthAdapter', async () => {
  let capturedConstraints = null;
  const request = requestFor();
  const provider = {
    id: 'api_read_provider',
    providerKind: 'api_read_provider',
    supports: () => true,
    canExecute: () => ({ allowed: true }),
    async run({ authAdapter }) {
      capturedConstraints = authAdapter.getPolicyConstraints();
      return {
        providerId: 'api_read_provider',
        providerKind: 'api_read_provider',
        status: 'completed',
        runtimeExecuted: true,
        sideEffectAttempted: false,
        sideEffectSucceeded: true,
        sideEffectFailed: false,
        resultSummary: {
          outcome: 'policy_constraints_observed',
          providerId: 'api_read_provider',
          artifactRefs: [],
          redactionRequired: true,
        },
      };
    },
  };
  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision: policyFor(request),
    executionContract: readContract(),
    runtimeContext: {
      sessionVault: vaultFor(),
      sessionPolicyEvaluator() {
        return {
          allowed: true,
          decisionId: 'policy-decision:constraints',
          policyId: 'governance-policy:session-policy-test',
          scopesGranted: [scope()],
          materialTypesAllowed: ['bearer_token'],
          constraints: { maxGrantTtlMs: 12345, requireRelease: true },
        };
      },
    },
    providerRegistry: { resolve: () => provider },
  });
  assert.equal(report.status, 'completed');
  assert.deepEqual(capturedConstraints, {
    maxGrantTtlMs: 12345,
    requireRelease: true,
    allowProfilePersistence: false,
    allowStorageStatePersistence: false,
    allowCredentialForwarding: false,
  });
  assert.equal(report.policySummary.constraints.maxGrantTtlMs, 12345);
});

test('audit viewer includes structured session policy decision summary', async () => {
  const request = requestFor();
  const auditRecorder = createRuntimeAuditRecorder();
  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision: policyFor(request),
    executionContract: readContract(),
    runtimeContext: {
      sessionVault: vaultFor(),
      sessionPolicyEvaluator: evaluateSessionPolicy,
      async fetchImpl() {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
    auditRecorder,
  });
  const view = createRuntimeAuditView({
    report,
    auditEvents: auditRecorder.listEvents(),
  });
  assert.equal(view.policySummary.allowed, true);
  assert.equal(view.decisions.some((decision) => decision.decision === 'session_policy'), true);
  assertNoCanaryLeak({ report, view, auditEvents: auditRecorder.listEvents() }, 'audit policy view');
});

test('session policy modules stay pure and do not import provider implementation or vault material', async () => {
  const policySource = await readFile(path.join(RUNTIME_DIR, 'domain', 'policies', 'session-policy.mjs'), 'utf8');
  assert.doesNotMatch(policySource, /providers\/|api-read-provider|download-provider|browser-action-provider|sessionVault|getScopedSessionMaterial|fetch\(|openBrowserSession/u);
});
