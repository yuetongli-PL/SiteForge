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
  RUNTIME_REASONS,
  createProductionRuntimeProviderRegistry,
  createRuntimeAuditRecorder,
  executeRuntimeInvocation,
  isAuthScopeSubset,
  normalizeAuthRequirement,
  normalizeAuthScope,
  sanitizeAuthAuditSummary,
  validateAuthRequirementNarrowing,
} from '../../src/app/runtime/index.mjs';
import {
  createMockSessionVault,
} from '../../src/app/runtime/testing.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../src/domain/policies/execution/index.mjs';

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'auth-runtime-integration-v1',
);

const CANARIES = Object.freeze([
  'sf_test_secret_token_123',
  'sf_test_cookie_secret_456',
  'sf_test_api_key_789',
  'sf_test_authorization_secret_000',
  'sf_test_session_handle_secret_should_not_log',
]);

function scope({
  origin = 'https://auth.example.test',
  operations = ['read'],
  resources = undefined,
} = {}) {
  return {
    origin,
    operations,
    ...(resources ? { resources } : {}),
  };
}

function authRequirement({
  operations = ['read'],
  origin = 'https://auth.example.test',
  resources = undefined,
  materialTypes = ['bearer_token'],
  injectionTarget = 'http_request',
  required = true,
} = {}) {
  return {
    required,
    mode: required ? 'session_handle' : 'none',
    scopes: required ? [scope({ origin, operations, resources })] : [],
    material: {
      allowedTypes: materialTypes,
      injectionTarget,
    },
    policy: {
      requireGovernanceGate: true,
      allowCredentialForwarding: false,
      allowRawHeaderAudit: false,
      allowRawCookieAudit: false,
      allowRawBodyAudit: false,
    },
  };
}

function authData({
  sessionHandle = 'sf_test_session_handle_secret_should_not_log',
  operations = ['read'],
  origin = 'https://auth.example.test',
  resources = undefined,
  satisfied = true,
} = {}) {
  return {
    sessionHandle,
    requestedScopes: [scope({ origin, operations, resources })],
    authGate: {
      satisfied,
      gateId: 'auth-gate:fixture',
      policyId: 'policy:fixture',
    },
  };
}

function requestFor({
  capabilityId = 'capability:auth-v1:read',
  executionContractRef = 'execution-contract:auth-v1:read',
  verdictHint = 'allow',
  requiredGates = [],
  authRequirement: requestAuthRequirement = undefined,
  auth = undefined,
} = {}) {
  return createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: 'auth.example.test',
      capabilityId,
      executionContractRef,
      planId: `plan:${capabilityId.replace(/[^a-z0-9:_-]+/giu, '-')}`,
    },
    executionContractRef,
    policyDecisionRef: `policy:${capabilityId.replace(/[^a-z0-9:_-]+/giu, '-')}`,
    verdictHint,
    requiredGates,
    authRequirement: requestAuthRequirement,
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
    executionId: `execution:${request.capabilityId.replace(/[^a-z0-9:_-]+/giu, '-')}`,
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

function readContract({
  url = 'https://auth.example.test/api/items',
  method = 'GET',
  requirement = authRequirement({ operations: ['read'] }),
  descriptorOverrides = {},
} = {}) {
  return {
    capabilityKind: 'read',
    operationKind: 'api_request',
    contractKind: 'api_request',
    runtimeBindingRef: 'runtime-binding:auth-v1:read',
    runtimeBinding: {
      httpRequest: {
        url,
        method,
        ...descriptorOverrides,
      },
    },
    authRequirement: requirement,
    descriptorOnly: true,
    redactionRequired: true,
  };
}

function downloadContract({
  url = 'https://auth.example.test/api/export',
  method = 'GET',
  filename = 'auth-export.txt',
  requirement = authRequirement({ operations: ['download'], materialTypes: ['api_key'] }),
  descriptorOverrides = {},
} = {}) {
  return {
    capabilityKind: 'download',
    operationKind: 'download',
    contractKind: 'download',
    runtimeBindingRef: 'runtime-binding:auth-v1:download',
    runtimeBinding: {
      downloadDescriptor: {
        url,
        method,
        filename,
        ...descriptorOverrides,
      },
    },
    downloadDescriptor: {
      filename,
    },
    authRequirement: requirement,
    redactionRequired: true,
  };
}

function browserWriteContract({ requirement = authRequirement({ operations: ['read'] }) } = {}) {
  return {
    capabilityKind: 'submit',
    operationKind: 'form_or_action',
    contractKind: 'form_or_action',
    runtimeBinding: { kind: 'browser_bridge' },
    browserActionDescriptor: {
      selector: '[data-siteforge-action="contact-form"]',
      actionRef: 'action:fixture-contact-submit',
      routeRef: 'route:fixture-contact',
      requiredSlots: ['message'],
    },
    payloadTemplate: {
      material: 'template_only',
      redactionRequired: true,
      savedMaterial: 'sanitized_summary_only',
      slotBindings: [{ name: 'message', type: 'string', required: true }],
      steps: [{
        kind: 'form_submit',
        selector: '[data-siteforge-action="contact-form"]',
        actionRef: 'action:fixture-contact-submit',
      }],
    },
    authRequirement: requirement,
  };
}

function assertNoCanaries(payload, context = 'payload') {
  const serialized = JSON.stringify(payload);
  for (const canary of CANARIES) {
    assert.equal(serialized.includes(canary), false, `${context} leaked ${canary}`);
  }
  assert.doesNotMatch(serialized, /Bearer\s+|Authorization|Cookie|Set-Cookie|grant:mock|rawSession|storageState|localStorage|IndexedDB/u);
}

/** @param {Record<string, any>} options */
function createFetch({
  status = 200,
  body = JSON.stringify({ items: [{ id: 1 }] }),
  headers = /** @type {Record<string, string>} */ ({ 'content-type': 'application/json' }),
  onCall = null,
} = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (onCall) onCall(url, options);
    return new Response(body, { status, headers });
  };
  return { fetchImpl, calls };
}

/** @param {Record<string, any>} options */
async function executeAuthRead({
  contract = readContract(),
  request = requestFor({
    capabilityId: 'capability:auth-v1:read',
    executionContractRef: 'execution-contract:auth-v1:read',
    authRequirement: contract.authRequirement,
    auth: authData({ operations: ['read'] }),
  }),
  vault = createMockSessionVault({
    scopes: [scope({ operations: ['read', 'query', 'download'] })],
    material: [{ type: 'bearer_token', value: CANARIES[0] }],
  }),
  fetchImpl = createFetch().fetchImpl,
  runtimeContext = {},
} = {}) {
  const auditRecorder = createRuntimeAuditRecorder();
  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision: policyFor(request),
    executionContract: contract,
    runtimeContext: {
      sessionVault: vault,
      fetchImpl,
      ...runtimeContext,
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
    auditRecorder,
  });
  return { report, auditEvents: auditRecorder.listEvents(), vault };
}

/** @param {Record<string, any>} options */
async function executeAuthDownload({
  outputDir,
  contract = downloadContract(),
  request = requestFor({
    capabilityId: 'capability:auth-v1:download',
    executionContractRef: 'execution-contract:auth-v1:download',
    verdictHint: 'controlled',
    requiredGates: ['output_path_required'],
    authRequirement: contract.authRequirement,
    auth: authData({ operations: ['download'] }),
  }),
  vault = createMockSessionVault({
    scopes: [scope({ operations: ['download'] })],
    material: [{ type: 'api_key', value: CANARIES[2], headerName: 'x-api-key' }],
  }),
  fetchImpl = createFetch({ body: 'downloaded fixture\n', headers: { 'content-type': 'text/plain' } }).fetchImpl,
} = {}) {
  const auditRecorder = createRuntimeAuditRecorder();
  const gateStatus = {
    allSatisfied: true,
    output_path_required: { satisfied: true },
  };
  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision: policyFor(request, {
      verdict: 'controlled',
      gates: ['output_path_required'],
      gateStatus,
      downloaderInvocationAllowed: true,
      siteAdapterInvocationAllowed: false,
    }),
    gateStatus,
    executionContract: contract,
    runtimeContext: {
      sessionVault: vault,
      fetchImpl,
      outputDir,
      downloadFilename: 'auth-export.txt',
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
    auditRecorder,
  });
  return { report, auditEvents: auditRecorder.listEvents(), vault };
}

test('auth helpers normalize requirements and enforce narrowing', () => {
  const normalized = normalizeAuthRequirement(authRequirement({
    operations: ['api', 'export'],
    materialTypes: ['bearer_token', 'api_key'],
  }));
  assert.equal(normalized.required, true);
  assert.deepEqual(normalized.scopes[0].operations, ['download', 'read']);
  assert.deepEqual(normalizeAuthScope({ origin: 'https://auth.example.test/x', operations: ['export'] }).operations, ['download']);
  assert.equal(isAuthScopeSubset(scope({ operations: ['read'] }), [scope({ operations: ['read', 'query'] })]), true);
  const sanitizedSummary = sanitizeAuthAuditSummary({
    required: true,
    used: true,
    sessionRef: CANARIES[4],
    scopesRequested: [scope({ operations: ['read'] })],
    scopesGranted: [scope({ operations: ['read'] })],
    materialSummary: { types: ['bearer_token'], count: 1 },
    outcome: 'used',
  });
  assert.notEqual(sanitizedSummary.sessionRef, CANARIES[4]);
  if (typeof sanitizedSummary.sessionRef === 'string') {
    assert.equal(sanitizedSummary.sessionRef.includes(CANARIES[4]), false);
  }

  assert.equal(validateAuthRequirementNarrowing({
    contractAuthRequirement: authRequirement({ materialTypes: ['bearer_token'] }),
    invocationAuthRequirement: authRequirement({ materialTypes: ['bearer_token'] }),
  }).allowed, true);
  assert.equal(validateAuthRequirementNarrowing({
    contractAuthRequirement: authRequirement({ materialTypes: ['bearer_token'] }),
    invocationAuthRequirement: authRequirement({ materialTypes: ['bearer_token', 'api_key'] }),
  }).allowed, false);
});

test('auth fixtures are present and loadable', async () => {
  const files = (await readdir(FIXTURE_DIR)).filter((file) => file.endsWith('.json')).sort();
  assert.deepEqual(files, ['auth-api-read-valid.json', 'auth-download-valid.json']);
  for (const file of files) {
    const fixture = JSON.parse(await readFile(path.join(FIXTURE_DIR, file), 'utf8'));
    assert.equal(typeof fixture.providerId, 'string');
    assert.equal(typeof fixture.url, 'string');
  }
});

test('public providers do not touch session vault when auth is not required', async () => {
  const vault = createMockSessionVault({ failureMode: 'inspectThrows' });
  const request = requestFor();
  const auditRecorder = createRuntimeAuditRecorder();
  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision: policyFor(request),
    executionContract: {
      capabilityKind: 'read',
      operationKind: 'api_request',
      contractKind: 'api_request',
      runtimeBindingRef: 'runtime-binding:public-read',
      descriptorOnly: true,
      redactionRequired: true,
    },
    runtimeContext: { sessionVault: vault },
    providerRegistry: createProductionRuntimeProviderRegistry(),
    auditRecorder,
  });

  assert.equal(report.status, 'completed');
  assert.equal(report.providerId, 'api_read_provider');
  assert.equal(vault.getCounters().inspectSessionCalls, 0);
  assert.equal(vault.getCounters().getScopedSessionMaterialCalls, 0);
  assertNoCanaries({ report, auditEvents: auditRecorder.listEvents() }, 'public report');
});

test('valid auth read injects ephemeral material only into fetch and releases grant', async () => {
  const fetch = createFetch({
    onCall(_url, options) {
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers.authorization, `Bearer ${CANARIES[0]}`);
    },
  });
  const { report, auditEvents, vault } = await executeAuthRead({ fetchImpl: fetch.fetchImpl });

  assert.equal(fetch.calls.length, 1);
  assert.equal(report.status, 'completed');
  assert.equal(report.providerId, 'api_read_provider');
  assert.equal(report.providerInvoked, true);
  assert.equal(report.executionAttempted, true);
  assert.equal(report.sideEffectAttempted, true);
  assert.equal(report.authSummary.required, true);
  assert.equal(report.authSummary.used, true);
  assert.equal(vault.getCounters().inspectSessionCalls, 1);
  assert.equal(vault.getCounters().getScopedSessionMaterialCalls, 1);
  assert.equal(vault.getCounters().releaseScopedSessionMaterialCalls, 1);
  assertNoCanaries({ report, auditEvents }, 'auth read report');
});

test('valid auth download writes controlled artifact metadata without leaking material', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'siteforge-auth-download-'));
  try {
    const fetch = createFetch({
      body: 'authorized download body\n',
      headers: { 'content-type': 'text/plain' },
      onCall(_url, options) {
        assert.equal(options.redirect, 'manual');
        assert.equal(options.headers['x-api-key'], CANARIES[2]);
      },
    });
    const { report, auditEvents, vault } = await executeAuthDownload({ outputDir, fetchImpl: fetch.fetchImpl });
    const written = await readFile(path.join(outputDir, 'auth-export.txt'), 'utf8');

    assert.equal(written, 'authorized download body\n');
    assert.equal(report.status, 'completed');
    assert.equal(report.providerId, 'download_provider');
    assert.equal(report.sideEffectAttempted, true);
    assert.equal(report.resultSummary.downloads[0].filename, 'auth-export.txt');
    assert.equal(report.authSummary.used, true);
    assert.equal(vault.getCounters().releaseScopedSessionMaterialCalls, 1);
    assertNoCanaries({ report, auditEvents, metadata: report.resultSummary.downloads }, 'auth download report');
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('auth gate failures happen before provider.run and before material access', async () => {
  const cases = [
    {
      name: 'missing handle',
      requestAuth: authData({ operations: ['read'], sessionHandle: '' }),
      vault: createMockSessionVault(),
      reason: RUNTIME_AUTH_REASONS.sessionMissing,
      inspectCalls: 0,
    },
    {
      name: 'missing vault',
      requestAuth: authData({ operations: ['read'] }),
      vault: null,
      reason: RUNTIME_AUTH_REASONS.sessionVaultUnavailable,
      inspectCalls: null,
    },
    {
      name: 'inspect throws',
      requestAuth: authData({ operations: ['read'] }),
      vault: createMockSessionVault({ failureMode: 'inspectThrows' }),
      reason: RUNTIME_AUTH_REASONS.sessionVaultUnavailable,
      inspectCalls: 1,
    },
    {
      name: 'missing session',
      requestAuth: authData({ operations: ['read'] }),
      vault: createMockSessionVault({ failureMode: 'missingSession' }),
      reason: RUNTIME_AUTH_REASONS.sessionMissing,
      inspectCalls: 1,
    },
    {
      name: 'expired session',
      requestAuth: authData({ operations: ['read'] }),
      vault: createMockSessionVault({ failureMode: 'expiredSession' }),
      reason: RUNTIME_AUTH_REASONS.sessionExpired,
      inspectCalls: 1,
    },
    {
      name: 'revoked session',
      requestAuth: authData({ operations: ['read'] }),
      vault: createMockSessionVault({ failureMode: 'revokedSession' }),
      reason: RUNTIME_AUTH_REASONS.sessionExpired,
      inspectCalls: 1,
    },
    {
      name: 'scope mismatch',
      requestAuth: authData({ operations: ['read'] }),
      vault: createMockSessionVault({ failureMode: 'scopeMismatch' }),
      reason: RUNTIME_AUTH_REASONS.scopeNotAllowed,
      inspectCalls: 1,
    },
    {
      name: 'auth gate false',
      requestAuth: authData({ operations: ['read'], satisfied: false }),
      vault: createMockSessionVault({ scopes: [scope({ operations: ['read'] })] }),
      reason: RUNTIME_AUTH_REASONS.policyGateNotSatisfied,
      inspectCalls: 1,
    },
    {
      name: 'auth gate missing',
      requestAuth: {
        sessionHandle: CANARIES[4],
        requestedScopes: [scope({ operations: ['read'] })],
      },
      vault: createMockSessionVault({ scopes: [scope({ operations: ['read'] })] }),
      reason: RUNTIME_AUTH_REASONS.policyGateNotSatisfied,
      inspectCalls: 1,
    },
  ];

  for (const scenario of cases) {
    const contract = readContract();
    const request = requestFor({
      capabilityId: `capability:auth-v1:${scenario.name.replace(/\s+/gu, '-')}`,
      executionContractRef: `execution-contract:auth-v1:${scenario.name.replace(/\s+/gu, '-')}`,
      authRequirement: contract.authRequirement,
      auth: scenario.requestAuth,
    });
    const { report, auditEvents, vault } = await executeAuthRead({
      contract,
      request,
      vault: scenario.vault,
      runtimeContext: scenario.vault ? {} : { sessionVault: null },
    });

    assert.equal(report.status, 'blocked', scenario.name);
    assert.equal(report.blockedReason, scenario.reason, scenario.name);
    assert.equal(report.providerInvoked, false, scenario.name);
    assert.equal(report.executionAttempted, false, scenario.name);
    assert.equal(report.sideEffectAttempted, false, scenario.name);
    if (scenario.inspectCalls !== null) {
      assert.equal(vault.getCounters().inspectSessionCalls, scenario.inspectCalls, scenario.name);
      assert.equal(vault.getCounters().getScopedSessionMaterialCalls, 0, scenario.name);
    }
    assertNoCanaries({ report, auditEvents }, scenario.name);
  }
});

test('material unavailable and injection failures keep providerInvoked true but sideEffectAttempted false', async () => {
  /** @type {Array<[string, string, number]>} */
  const cases = [
    ['materialUnavailable', RUNTIME_AUTH_REASONS.materialUnavailable, 0],
    ['materialThrows', RUNTIME_AUTH_REASONS.materialUnavailable, 0],
    ['injectionFailure', RUNTIME_AUTH_REASONS.providerInjectionFailed, 1],
  ];
  for (const [failureMode, reason, expectedReleaseCalls] of cases) {
    const vault = createMockSessionVault({
      scopes: [scope({ operations: ['read'] })],
      failureMode,
    });
    const { report, auditEvents } = await executeAuthRead({ vault });

    assert.equal(report.status, 'failed', failureMode);
    assert.equal(report.reasonCode, reason, failureMode);
    assert.equal(report.providerInvoked, true, failureMode);
    assert.equal(report.executionAttempted, true, failureMode);
    assert.equal(report.sideEffectAttempted, false, failureMode);
    assert.equal(vault.getCounters().getScopedSessionMaterialCalls, 1, failureMode);
    assert.equal(vault.getCounters().releaseScopedSessionMaterialCalls, expectedReleaseCalls, failureMode);
    assertNoCanaries({ report, auditEvents }, failureMode);
  }
});

test('contract authRequirement is authoritative and invocation can only narrow', async () => {
  const scenarios = [
    {
      name: 'relax required',
      contractRequirement: authRequirement({ operations: ['read'], materialTypes: ['bearer_token'] }),
      requestRequirement: authRequirement({ operations: ['read'], materialTypes: ['bearer_token'], required: false }),
      requestAuth: authData({ operations: ['read'] }),
    },
    {
      name: 'widen scope',
      contractRequirement: authRequirement({ operations: ['read'], resources: ['/api/items'] }),
      requestRequirement: authRequirement({ operations: ['read'] }),
      requestAuth: authData({ operations: ['read'] }),
    },
    {
      name: 'widen material',
      contractRequirement: authRequirement({ operations: ['read'], materialTypes: ['bearer_token'] }),
      requestRequirement: authRequirement({ operations: ['read'], materialTypes: ['bearer_token', 'api_key'] }),
      requestAuth: authData({ operations: ['read'] }),
    },
    {
      name: 'change injection target',
      contractRequirement: authRequirement({ operations: ['read'], materialTypes: ['bearer_token'] }),
      requestRequirement: {
        ...authRequirement({ operations: ['read'], materialTypes: ['bearer_token'] }),
        material: { allowedTypes: ['bearer_token'], injectionTarget: 'browser_context' },
      },
      requestAuth: authData({ operations: ['read'] }),
    },
    {
      name: 'contract absent invocation opens auth',
      contractRequirement: null,
      requestRequirement: authRequirement({ operations: ['read'] }),
      requestAuth: authData({ operations: ['read'] }),
    },
  ];

  for (const scenario of scenarios) {
    const contract = readContract({ requirement: scenario.contractRequirement });
    if (scenario.contractRequirement === null) {
      delete contract.authRequirement;
    }
    const request = requestFor({
      capabilityId: `capability:auth-v1:precedence:${scenario.name.replace(/\s+/gu, '-')}`,
      executionContractRef: `execution-contract:auth-v1:precedence:${scenario.name.replace(/\s+/gu, '-')}`,
      authRequirement: scenario.requestRequirement,
      auth: scenario.requestAuth,
    });
    const { report, auditEvents } = await executeAuthRead({
      contract,
      request,
      vault: createMockSessionVault({ scopes: [scope({ operations: ['read'] })] }),
    });
    assert.equal(report.blockedReason, RUNTIME_AUTH_REASONS.scopeNotAllowed, scenario.name);
    assert.equal(report.providerInvoked, false, scenario.name);
    assertNoCanaries({ report, auditEvents }, scenario.name);
  }

  const narrowedRequirement = authRequirement({
    operations: ['read'],
    resources: ['https://auth.example.test/api/items'],
    materialTypes: ['bearer_token'],
  });
  const request = requestFor({
    capabilityId: 'capability:auth-v1:precedence:narrow-success',
    executionContractRef: 'execution-contract:auth-v1:precedence:narrow-success',
    authRequirement: narrowedRequirement,
    auth: authData({
      operations: ['read'],
      resources: ['https://auth.example.test/api/items'],
    }),
  });
  const contract = readContract({
    requirement: authRequirement({ operations: ['read', 'query'], materialTypes: ['bearer_token', 'api_key'] }),
  });
  const { report } = await executeAuthRead({
    contract,
    request,
    vault: createMockSessionVault({
      scopes: [scope({ operations: ['read'], resources: ['https://auth.example.test/api/items'] })],
      material: [{ type: 'bearer_token', value: CANARIES[0] }],
    }),
  });
  assert.equal(report.status, 'completed');
});

test('HTTP descriptor safety fails closed before auth network execution', async () => {
  /** @type {Array<[string, Record<string, any>, (((contract: Record<string, any>) => void) | null), string?]>} */
  const cases = [
    ['missing descriptor', readContract(), (contract) => { delete contract.runtimeBinding.httpRequest; }],
    ['post method', readContract({ method: 'POST' }), null],
    ['request body', readContract({ descriptorOverrides: { body: { value: 1 } } }), null],
    ['raw headers', readContract({ descriptorOverrides: { headers: { Authorization: `Bearer ${CANARIES[3]}` } } }), null],
    ['embedded credential url', readContract({ url: `https://user:${CANARIES[0]}@auth.example.test/api/items` }), null],
    ['secret query url', readContract({ url: `https://auth.example.test/api/items?access_token=${CANARIES[0]}` }), null],
    ['outside scope', readContract({ url: 'https://other.example.test/api/items' }), null, RUNTIME_AUTH_REASONS.scopeNotAllowed],
  ];

  for (const [name, contract, mutate, expectedReason = RUNTIME_REASONS.contractNotConcreteEnough] of cases) {
    if (mutate) mutate(contract);
    const fetch = createFetch();
    const { report, auditEvents, vault } = await executeAuthRead({
      contract,
      fetchImpl: fetch.fetchImpl,
      vault: createMockSessionVault({ scopes: [scope({ operations: ['read'] })] }),
    });
    assert.equal(report.status, 'failed', name);
    assert.equal(report.reasonCode, expectedReason, name);
    assert.equal(report.providerInvoked, true, name);
    assert.equal(report.sideEffectAttempted, false, name);
    assert.equal(fetch.calls.length, 0, name);
    if (expectedReason === RUNTIME_REASONS.contractNotConcreteEnough) {
      assert.equal(vault.getCounters().getScopedSessionMaterialCalls, 0, name);
    }
    assertNoCanaries({ report, auditEvents }, name);
  }
});

test('cross-origin redirects are not followed and do not forward credentials', async () => {
  const fetch = createFetch({
    status: 302,
    body: '',
    headers: {
      location: `https://evil.example.test/collect?token=${CANARIES[0]}`,
      'content-type': 'text/plain',
    },
  });
  const { report, auditEvents, vault } = await executeAuthRead({ fetchImpl: fetch.fetchImpl });

  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].options.redirect, 'manual');
  assert.equal(fetch.calls[0].options.headers.authorization, `Bearer ${CANARIES[0]}`);
  assert.equal(report.status, 'failed');
  assert.equal(report.reasonCode, RUNTIME_AUTH_REASONS.scopeNotAllowed);
  assert.equal(report.sideEffectAttempted, true);
  assert.equal(report.resultSummary.redirect.crossOrigin, true);
  assert.equal(report.resultSummary.redirect.locationOrigin, 'https://evil.example.test');
  assert.equal(vault.getCounters().releaseScopedSessionMaterialCalls, 1);
  assertNoCanaries({ report, auditEvents }, 'redirect report');
});

test('release runs after success and failure, and release failures are sanitized', async () => {
  const successVault = createMockSessionVault({
    scopes: [scope({ operations: ['read'] })],
    material: [{ type: 'bearer_token', value: CANARIES[0] }],
  });
  const success = await executeAuthRead({ vault: successVault });
  assert.equal(success.report.status, 'completed');
  assert.equal(successVault.getCounters().releaseScopedSessionMaterialCalls, 1);

  const failingVault = createMockSessionVault({
    scopes: [scope({ operations: ['read'] })],
    failureMode: 'injectionFailure',
  });
  const failure = await executeAuthRead({ vault: failingVault });
  assert.equal(failure.report.reasonCode, RUNTIME_AUTH_REASONS.providerInjectionFailed);
  assert.equal(failingVault.getCounters().releaseScopedSessionMaterialCalls, 1);

  const releaseThrowingVault = {
    ...createMockSessionVault({
      scopes: [scope({ operations: ['read'] })],
      material: [{ type: 'bearer_token', value: CANARIES[0] }],
    }),
    async releaseScopedSessionMaterial() {
      this.counters.releaseScopedSessionMaterialCalls += 1;
      throw new Error(`release leaked ${CANARIES[3]}`);
    },
  };
  const releaseFailure = await executeAuthRead({ vault: releaseThrowingVault });
  assert.equal(releaseFailure.report.status, 'completed');
  assert.equal(releaseThrowingVault.getCounters().releaseScopedSessionMaterialCalls, 1);
  assertNoCanaries(releaseFailure, 'release failure report');
});

test('auth-required browser is blocked in V1 while payment and destructive keep existing reasons', async () => {
  const browserVault = createMockSessionVault({ scopes: [scope({ operations: ['read'] })] });
  const browserFetchCalls = [];
  const browserRequest = requestFor({
    capabilityId: 'capability:auth-v1:browser-write',
    executionContractRef: 'execution-contract:auth-v1:browser-write',
    authRequirement: authRequirement({ operations: ['read'] }),
    auth: authData({ operations: ['read'] }),
  });
  const browserReport = await executeRuntimeInvocation({
    invocationRequest: browserRequest,
    policyDecision: policyFor(browserRequest),
    executionContract: browserWriteContract(),
    runtimeContext: {
      controlledBrowserRuntime: true,
      localFixture: true,
      slotValues: { message: 'private fixture value' },
      sessionVault: browserVault,
      async fetchImpl(...args) {
        browserFetchCalls.push(args);
        throw new Error('auth preflight must not fetch');
      },
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });
  assert.equal(createProductionRuntimeProviderRegistry().resolve({ executionContract: browserWriteContract() })?.id, BROWSER_ACTION_PROVIDER_ID);
  assert.equal(browserReport.status, 'blocked');
  assert.equal(browserReport.blockedReason, RUNTIME_AUTH_REASONS.authRequired);
  assert.equal(browserReport.providerInvoked, false);
  assert.equal(browserReport.executionAttempted, false);
  assert.equal(browserReport.sideEffectAttempted, false);
  assert.equal(browserVault.getCounters().inspectSessionCalls, 0);
  assert.equal(browserVault.getCounters().getScopedSessionMaterialCalls, 0);
  assert.equal(browserVault.getCounters().releaseScopedSessionMaterialCalls, 0);
  assert.equal(browserFetchCalls.length, 0);

  for (const [flag, reason] of [
    ['paymentOrFundsAction', RUNTIME_REASONS.paymentExecutionBlocked],
    ['destructiveAction', RUNTIME_REASONS.destructiveExecutionBlocked],
  ]) {
    const request = requestFor({
      capabilityId: `capability:auth-v1:${flag}`,
      executionContractRef: `execution-contract:auth-v1:${flag}`,
      authRequirement: authRequirement({ operations: ['read'] }),
      auth: authData({ operations: ['read'] }),
    });
    const report = await executeRuntimeInvocation({
      invocationRequest: request,
      policyDecision: policyFor(request),
      executionContract: {
        capabilityKind: flag === 'paymentOrFundsAction' ? 'payment' : 'read',
        operationKind: flag === 'paymentOrFundsAction' ? 'payment' : 'read',
        [flag]: true,
        authRequirement: authRequirement({ operations: ['read'] }),
      },
      runtimeContext: {
        sessionVault: createMockSessionVault({ scopes: [scope({ operations: ['read'] })] }),
      },
      providerRegistry: createProductionRuntimeProviderRegistry(),
    });
    assert.equal(report.blockedReason, reason, flag);
    assert.equal(report.providerInvoked, false, flag);
    assert.equal(report.sideEffectAttempted, false, flag);
  }
});

test('runtime public exports keep testing APIs behind runtime/testing.mjs', async () => {
  const runtimeIndex = await import('../../src/app/runtime/index.mjs');
  const runtimeTesting = await import('../../src/app/runtime/testing.mjs');

  assert.equal(typeof runtimeIndex.createProviderAuthAdapter, 'function');
  assert.equal(typeof runtimeIndex.normalizeAuthRequirement, 'function');
  assert.equal(typeof runtimeIndex.RUNTIME_AUTH_REASONS, 'object');
  assert.equal(Object.hasOwn(runtimeIndex, 'createMockSessionVault'), false);
  assert.equal(Object.hasOwn(runtimeIndex, 'createMockRuntimeProviderRegistry'), false);
  assert.equal(typeof runtimeTesting.createMockSessionVault, 'function');
});
