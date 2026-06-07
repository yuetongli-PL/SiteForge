import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
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
} from '../../src/app/runtime/index.mjs';
import {
  createFakeControlledBrowserRuntimeDeps,
  createMockSessionVault,
} from '../../src/app/runtime/testing.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../src/domain/policies/execution/index.mjs';

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'auth-aware-controlled-browser-runtime-v1',
);

const DEFAULT_START_URL = 'http://auth-browser.example.test/contact';
const DEFAULT_ORIGIN = new URL(DEFAULT_START_URL).origin;
const CANARIES = Object.freeze([
  'sf_browser_cookie_secret_123',
  'sf_browser_session_handle_secret_should_not_log',
  'sf_browser_cookie_name_should_not_log',
  'sf_browser_auth_grant_secret_456',
  'sf_browser_cdp_cookie_payload_secret_789',
]);

function scope({
  origin = DEFAULT_ORIGIN,
  operations = ['form_or_action'],
  resources = undefined,
} = {}) {
  return {
    origin,
    operations,
    ...(resources ? { resources } : {}),
  };
}

function authRequirement({
  origin = DEFAULT_ORIGIN,
  operations = ['form_or_action'],
  materialTypes = ['cookie'],
  injectionTarget = 'browser_context',
  required = true,
} = {}) {
  return {
    required,
    mode: required ? 'session_handle' : 'none',
    scopes: required ? [scope({ origin, operations })] : [],
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
      allowStorageStatePersistence: false,
      allowProfilePersistence: false,
      allowAutomaticLogin: false,
    },
  };
}

function authData({
  origin = DEFAULT_ORIGIN,
  operations = ['form_or_action'],
  sessionHandle = CANARIES[1],
  authGate = { satisfied: true, gateId: 'gate:browser-auth', policyId: 'policy:browser-auth' },
} = {}) {
  return {
    sessionHandle,
    requestedScopes: [scope({ origin, operations })],
    ...(authGate === undefined ? {} : { authGate }),
  };
}

function browserRuntimeDescriptor(startUrl = DEFAULT_START_URL, overrides = {}) {
  const origin = new URL(startUrl).origin;
  return {
    mode: 'controlled',
    engine: 'chromium',
    startUrl,
    allowedOrigins: [origin],
    allowExternalNetwork: false,
    allowDownloads: false,
    allowPopups: false,
    persistProfile: false,
    recordDom: false,
    recordScreenshots: false,
    recordVideo: false,
    recordFullTrace: false,
    timeoutMs: 500,
    actionTimeoutMs: 250,
    completionTimeoutMs: 250,
    ...overrides,
  };
}

function browserActionContract({
  operation = 'form_or_action',
  requirement = authRequirement({ operations: [operation] }),
} = {}) {
  return {
    capabilityKind: operation === 'write' ? 'write' : 'submit',
    operationKind: operation,
    contractKind: 'form_or_action',
    runtimeBindingRef: 'runtime-binding:auth-browser-v1',
    runtimeBinding: {
      kind: 'browser_bridge',
      targetUrl: DEFAULT_START_URL,
    },
    authRequirement: requirement,
    browserActionDescriptor: {
      actionRef: 'action:auth-browser-submit',
      routeRef: 'route:auth-browser-contact',
      requiredSlots: ['message'],
      selectors: {
        fields: {
          message: '[data-sf-field="message"]',
        },
        submit: '[data-sf-action="submit-contact"]',
      },
      completionSignal: {
        kind: 'selectorVisible',
        selector: '[data-sf-completion="contact-submitted"]',
        timeoutMs: 250,
      },
    },
    payloadTemplate: {
      material: 'template_only',
      redactionRequired: true,
      savedMaterial: 'sanitized_summary_only',
      slotBindings: [{
        name: 'message',
        type: 'string',
        required: true,
        binding: 'payload.message',
        selector: '[data-sf-field="message"]',
      }],
      steps: [{
        kind: 'form_submit',
        selector: '[data-sf-action="submit-contact"]',
        actionRef: 'action:auth-browser-submit',
        routeRef: 'route:auth-browser-contact',
        savedMaterial: 'sanitized_summary_only',
      }],
    },
    redactionRequired: true,
  };
}

function requestFor({
  operation = 'form_or_action',
  requestAuthRequirement = undefined,
  requestAuth = authData({ operations: [operation] }),
} = {}) {
  return createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: 'auth-browser.example.test',
      capabilityId: `capability:auth-browser-v1:${operation}`,
      executionContractRef: `execution-contract:auth-browser-v1:${operation}`,
      planId: `plan:auth-browser-v1:${operation}`,
    },
    executionContractRef: `execution-contract:auth-browser-v1:${operation}`,
    policyDecisionRef: `policy:auth-browser-v1:${operation}`,
    verdictHint: 'allow',
    requiredGates: [],
    authRequirement: requestAuthRequirement,
    auth: requestAuth,
  });
}

function policyFor(request) {
  return createGovernedExecutionPolicyDecision({
    executionId: `execution:${request.capabilityId}`,
    capabilityId: request.capabilityId,
    executionContractRef: request.executionContractRef,
    verdict: 'allow',
    gates: [],
    gateStatus: null,
    runtimeDispatchAllowed: true,
    siteAdapterInvocationAllowed: true,
    downloaderInvocationAllowed: false,
    auditRequired: false,
  });
}

function cookieMaterial(overrides = {}) {
  return [{
    type: 'cookie',
    name: CANARIES[2],
    value: CANARIES[0],
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
    expires: 1_893_456_000,
    ...overrides,
  }];
}

function wrapVault(base, eventLog) {
  return {
    ...base,
    getCounters: base.getCounters,
    async inspectSession(request) {
      eventLog.push('vault.inspect');
      return await base.inspectSession(request);
    },
    async getScopedSessionMaterial(request) {
      eventLog.push('vault.material');
      return await base.getScopedSessionMaterial(request);
    },
    async releaseScopedSessionMaterial(request) {
      eventLog.push('vault.release');
      return await base.releaseScopedSessionMaterial(request);
    },
  };
}

async function executeAuthBrowser({
  operation = 'form_or_action',
  startUrl = DEFAULT_START_URL,
  requirement = authRequirement({ origin: new URL(startUrl).origin, operations: [operation] }),
  requestAuthRequirement = undefined,
  requestAuth = authData({ origin: new URL(startUrl).origin, operations: [operation] }),
  runtimeContextOverrides = {},
  browserRuntimeOverrides = {},
  fakeScenario = {},
  vaultOptions = {},
} = {}) {
  const eventLog = [];
  const request = requestFor({ operation, requestAuthRequirement, requestAuth });
  const contract = browserActionContract({ operation, requirement });
  const fake = createFakeControlledBrowserRuntimeDeps({ ...fakeScenario, eventLog });
  const baseVault = createMockSessionVault({
    sessionHandle: CANARIES[1],
    sessionRef: 'auth-session:browser-v1-safe',
    scopes: [scope({ origin: new URL(startUrl).origin, operations: [operation] })],
    material: cookieMaterial(),
    grantId: CANARIES[3],
    grantSummary: {
      materialTypes: ['cookie'],
      materialCount: 1,
      expiresAt: '2030-01-01T00:00:00.000Z',
    },
    ...vaultOptions,
  });
  const vault = wrapVault(baseVault, eventLog);
  const auditRecorder = createRuntimeAuditRecorder();
  const runtimeContext = {
    controlledBrowserRuntime: true,
    browserRuntime: browserRuntimeDescriptor(startUrl, browserRuntimeOverrides),
    slotValues: { message: 'fixture controlled browser message' },
    taskText: 'Natural language text must not authorize auth or target origin https://evil.example.test',
    sessionVault: vault,
    ...runtimeContextOverrides,
  };
  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision: policyFor(request),
    executionContract: contract,
    runtimeContext,
    providerRegistry: createProductionRuntimeProviderRegistry({
      browserRuntimeDeps: {
        openBrowserSession: fake.openBrowserSession,
      },
    }),
    auditRecorder,
  });
  return {
    report,
    auditEvents: auditRecorder.listEvents(),
    fakeState: fake.state,
    vault,
    eventLog,
  };
}

function assertNoCanaryLeak(payload) {
  const serialized = JSON.stringify(payload);
  for (const canary of CANARIES) {
    assert.equal(serialized.includes(canary), false, `leaked canary ${canary}`);
  }
  assert.doesNotMatch(
    serialized,
    /Set-Cookie|Authorization|raw CDP|storageState|localStorage|sessionStorage|IndexedDB|screenshot|video|raw DOM/u,
  );
}

function assertPreRunBlocked(report, fakeState, vault, reasonCode, label = 'pre-run block') {
  assert.equal(report.status, 'blocked', label);
  assert.equal(report.blockedReason, reasonCode, label);
  assert.equal(report.providerInvoked, false, label);
  assert.equal(report.executionAttempted, false, label);
  assert.equal(report.sideEffectAttempted, false, label);
  assert.equal(fakeState.launchCount, 0, label);
  assert.equal(fakeState.authCookieApplyCount, 0, label);
  assert.equal(vault.getCounters().getScopedSessionMaterialCalls, 0, label);
}

test('auth-aware controlled browser fixtures are present and loadable', async () => {
  const files = (await readdir(FIXTURE_DIR)).filter((file) => file.endsWith('.json')).sort();
  assert.deepEqual(files, ['auth-browser-write-valid.json']);
  const fixture = JSON.parse(await readFile(path.join(FIXTURE_DIR, files[0]), 'utf8'));
  assert.equal(fixture.providerId, BROWSER_ACTION_PROVIDER_ID);
  assert.equal(fixture.authRequirement.material.injectionTarget, 'browser_context');
});

test('auth-aware controlled browser write succeeds for write submit and form_or_action', async () => {
  for (const operation of ['write', 'submit', 'form_or_action']) {
    const { report, auditEvents, fakeState, vault, eventLog } = await executeAuthBrowser({ operation });
    assert.equal(report.status, 'completed');
    assert.equal(report.providerId, BROWSER_ACTION_PROVIDER_ID);
    assert.equal(report.providerInvoked, true);
    assert.equal(report.executionAttempted, true);
    assert.equal(report.sideEffectAttempted, true);
    assert.equal(report.sideEffectSucceeded, true);
    assert.equal(report.authSummary.used, true);
    assert.deepEqual(report.authSummary.materialSummary, { types: ['cookie'], count: 1 });
    assert.equal(report.resultSummary.browserExecutionTrace.authEvents.length, 1);
    assert.equal(fakeState.authCookieApplyCount, 1);
    assert.equal(fakeState.authCookieHostOnlyCount, 1);
    assert.equal(fakeState.authCookieDomainPropertySeen, false);
    assert.equal(fakeState.navigateCount, 1);
    assert.equal(fakeState.fillCount, 1);
    assert.equal(fakeState.clickCount, 1);
    assert.equal(fakeState.closeCount, 1);
    assert.equal(vault.getCounters().inspectSessionCalls, 1);
    assert.equal(vault.getCounters().getScopedSessionMaterialCalls, 1);
    assert.equal(vault.getCounters().releaseScopedSessionMaterialCalls, 1);
    assert.deepEqual(eventLog.slice(1, 5), [
      'guard:Fetch.enable',
      'guard:Target.setDiscoverTargets',
      'guard:Browser.setDownloadBehavior',
      'vault.material',
    ]);
    assertNoCanaryLeak({ report, auditEvents });
  }
});

test('public controlled browser path does not touch auth vault or cookie injection', async () => {
  const { report, auditEvents, fakeState, vault } = await executeAuthBrowser({
    requirement: authRequirement({ required: false }),
    requestAuth: undefined,
    vaultOptions: {
      failureMode: 'inspectThrows',
    },
  });
  assert.equal(report.status, 'completed');
  assert.equal(fakeState.authCookieApplyCount, 0);
  assert.equal(vault.getCounters().inspectSessionCalls, 0);
  assert.equal(vault.getCounters().getScopedSessionMaterialCalls, 0);
  assert.equal(vault.getCounters().releaseScopedSessionMaterialCalls, 0);
  assertNoCanaryLeak({ report, auditEvents });
});

test('browser auth pre-run gate failures block before provider run and material access', async () => {
  const scenarios = [
    {
      name: 'missing sessionHandle',
      requestAuth: authData({ sessionHandle: '', operations: ['form_or_action'] }),
      reason: RUNTIME_AUTH_REASONS.sessionMissing,
      inspectCalls: 0,
    },
    {
      name: 'missing vault',
      runtimeContextOverrides: { sessionVault: undefined },
      reason: RUNTIME_AUTH_REASONS.sessionVaultUnavailable,
      inspectCalls: 0,
    },
    {
      name: 'inspect throws',
      vaultOptions: { failureMode: 'inspectThrows' },
      reason: RUNTIME_AUTH_REASONS.sessionVaultUnavailable,
      inspectCalls: 1,
    },
    {
      name: 'revoked session',
      vaultOptions: { failureMode: 'revokedSession' },
      reason: RUNTIME_AUTH_REASONS.sessionExpired,
      inspectCalls: 1,
    },
    {
      name: 'authGate missing',
      requestAuth: {
        sessionHandle: CANARIES[1],
        requestedScopes: [scope({ operations: ['form_or_action'] })],
      },
      reason: RUNTIME_AUTH_REASONS.policyGateNotSatisfied,
      inspectCalls: 1,
    },
    {
      name: 'authGate false',
      requestAuth: authData({
        operations: ['form_or_action'],
        authGate: { satisfied: false, gateId: 'gate:browser-auth', policyId: 'policy:browser-auth' },
      }),
      reason: RUNTIME_AUTH_REASONS.policyGateNotSatisfied,
      inspectCalls: 1,
    },
    {
      name: 'session scope mismatch',
      vaultOptions: { scopes: [scope({ origin: DEFAULT_ORIGIN, operations: ['write'] })] },
      reason: RUNTIME_AUTH_REASONS.scopeNotAllowed,
      inspectCalls: 1,
    },
    {
      name: 'http_request target unsupported for browser',
      requirement: authRequirement({ operations: ['form_or_action'], injectionTarget: 'http_request' }),
      reason: RUNTIME_AUTH_REASONS.authRequired,
      inspectCalls: 0,
    },
    {
      name: 'non cookie material unsupported for browser',
      requirement: authRequirement({ operations: ['form_or_action'], materialTypes: ['bearer_token'] }),
      reason: RUNTIME_AUTH_REASONS.authRequired,
      inspectCalls: 0,
    },
  ];
  for (const scenario of scenarios) {
    const { report, auditEvents, fakeState, vault } = await executeAuthBrowser(scenario);
    assertPreRunBlocked(report, fakeState, vault, scenario.reason, scenario.name);
    assert.equal(vault.getCounters().inspectSessionCalls, scenario.inspectCalls, scenario.name);
    assertNoCanaryLeak({ report, auditEvents });
  }
});

test('browser guard setup failures happen before material lookup and auth injection', async () => {
  for (const method of ['Fetch.enable', 'Target.setDiscoverTargets', 'Browser.setDownloadBehavior']) {
    const { report, auditEvents, fakeState, vault } = await executeAuthBrowser({
      fakeScenario: { guardSetupFailureMethod: method },
    });
    assert.equal(report.status, 'failed');
    assert.equal(report.reasonCode, RUNTIME_REASONS.browserRuntimeUnavailable);
    assert.equal(report.providerInvoked, true);
    assert.equal(report.executionAttempted, true);
    assert.equal(report.sideEffectAttempted, false);
    assert.deepEqual(fakeState.guardSetupFailures, [method]);
    assert.equal(fakeState.navigateCount, 0);
    assert.equal(fakeState.fillCount, 0);
    assert.equal(fakeState.clickCount, 0);
    assert.equal(fakeState.authCookieApplyCount, 0);
    assert.equal(fakeState.closeCount, 1);
    assert.equal(vault.getCounters().inspectSessionCalls, 1);
    assert.equal(vault.getCounters().getScopedSessionMaterialCalls, 0);
    assert.equal(vault.getCounters().releaseScopedSessionMaterialCalls, 0);
    assertNoCanaryLeak({ report, auditEvents });
  }
});

test('browser auth material and injection failures stop before navigation or action', async () => {
  const scenarios = [
    {
      name: 'material unavailable',
      vaultOptions: { failureMode: 'materialUnavailable' },
      reason: RUNTIME_AUTH_REASONS.materialUnavailable,
      materialCalls: 1,
      releaseCalls: 0,
      applyCalls: 0,
    },
    {
      name: 'unsafe parent domain cookie',
      vaultOptions: { material: cookieMaterial({ domain: 'example.test' }) },
      reason: RUNTIME_AUTH_REASONS.scopeNotAllowed,
      materialCalls: 1,
      releaseCalls: 1,
      applyCalls: 0,
    },
    {
      name: 'driver injection failure',
      fakeScenario: { authCookieApplyFailure: true },
      reason: RUNTIME_AUTH_REASONS.providerInjectionFailed,
      materialCalls: 1,
      releaseCalls: 1,
      applyCalls: 1,
    },
    {
      name: 'release failure does not overwrite primary result',
      fakeScenario: { authCookieApplyFailure: true },
      vaultOptions: { failureMode: 'releaseThrows' },
      reason: RUNTIME_AUTH_REASONS.providerInjectionFailed,
      materialCalls: 1,
      releaseCalls: 1,
      applyCalls: 1,
    },
  ];
  for (const scenario of scenarios) {
    const { report, auditEvents, fakeState, vault } = await executeAuthBrowser(scenario);
    assert.equal(report.status, 'failed', scenario.name);
    assert.equal(report.reasonCode, scenario.reason, scenario.name);
    assert.equal(report.providerInvoked, true);
    assert.equal(report.executionAttempted, true);
    assert.equal(report.sideEffectAttempted, false);
    assert.equal(fakeState.navigateCount, 0);
    assert.equal(fakeState.fillCount, 0);
    assert.equal(fakeState.clickCount, 0);
    assert.equal(fakeState.authCookieApplyCount, scenario.applyCalls);
    assert.equal(vault.getCounters().getScopedSessionMaterialCalls, scenario.materialCalls);
    assert.equal(vault.getCounters().releaseScopedSessionMaterialCalls, scenario.releaseCalls);
    assertNoCanaryLeak({ report, auditEvents });
  }
});

test('cookie safety allows exact host and host-only only', async () => {
  const allowed = [
    {
      name: 'host-only',
      material: cookieMaterial(),
      hostOnly: 1,
      domainCookies: 0,
    },
    {
      name: 'exact target host',
      material: cookieMaterial({ domain: 'auth-browser.example.test' }),
      hostOnly: 0,
      domainCookies: 1,
    },
  ];
  for (const scenario of allowed) {
    const { report, fakeState } = await executeAuthBrowser({
      vaultOptions: { material: scenario.material },
    });
    assert.equal(report.status, 'completed', scenario.name);
    assert.equal(fakeState.authCookieHostOnlyCount, scenario.hostOnly);
    assert.equal(fakeState.authCookieDomainCount, scenario.domainCookies);
  }

  const blocked = [
    { name: 'wildcard domain', material: cookieMaterial({ domain: '*.example.test' }) },
    { name: 'parent domain', material: cookieMaterial({ domain: 'example.test' }) },
    { name: 'public suffix', material: cookieMaterial({ domain: 'test' }) },
    { name: 'cross origin domain', material: cookieMaterial({ domain: 'other.example.test' }) },
    { name: 'secure false on https', startUrl: 'https://auth-browser.example.test/contact', material: cookieMaterial({ secure: false }) },
    { name: 'sameSite none without secure', material: cookieMaterial({ sameSite: 'None', secure: false }) },
    {
      name: 'expires beyond grant',
      material: cookieMaterial({ expires: 1_893_456_000 }),
      grantSummary: { materialTypes: ['cookie'], materialCount: 1, expiresAt: '2028-01-01T00:00:00.000Z' },
    },
  ];
  for (const scenario of blocked) {
    const startUrl = scenario.startUrl ?? DEFAULT_START_URL;
    const { report, auditEvents, fakeState, vault } = await executeAuthBrowser({
      startUrl,
      vaultOptions: {
        material: scenario.material,
        grantSummary: scenario.grantSummary ?? {
          materialTypes: ['cookie'],
          materialCount: 1,
          expiresAt: '2030-01-01T00:00:00.000Z',
        },
      },
    });
    assert.equal(report.status, 'failed', scenario.name);
    assert.equal(report.reasonCode, RUNTIME_AUTH_REASONS.scopeNotAllowed, scenario.name);
    assert.equal(fakeState.authCookieApplyCount, 0);
    assert.equal(fakeState.navigateCount, 0);
    assert.equal(vault.getCounters().releaseScopedSessionMaterialCalls, 1);
    assertNoCanaryLeak({ report, auditEvents });
  }
});

test('browser target origin is descriptor driven and must satisfy browser and auth scopes', async () => {
  const mismatchAllowedOrigin = await executeAuthBrowser({
    browserRuntimeOverrides: { allowedOrigins: ['https://other.example.test'] },
  });
  assertPreRunBlocked(
    mismatchAllowedOrigin.report,
    mismatchAllowedOrigin.fakeState,
    mismatchAllowedOrigin.vault,
    RUNTIME_REASONS.browserNavigationNotAllowed,
  );
  assert.equal(mismatchAllowedOrigin.vault.getCounters().inspectSessionCalls, 0);
  assertNoCanaryLeak({ report: mismatchAllowedOrigin.report, auditEvents: mismatchAllowedOrigin.auditEvents });

  const scopedToTaskTextOnly = await executeAuthBrowser({
    requirement: authRequirement({ origin: 'https://evil.example.test', operations: ['form_or_action'] }),
    requestAuth: authData({ origin: 'https://evil.example.test', operations: ['form_or_action'] }),
    vaultOptions: {
      scopes: [scope({ origin: 'https://evil.example.test', operations: ['form_or_action'] })],
    },
  });
  assert.equal(scopedToTaskTextOnly.report.status, 'failed');
  assert.equal(scopedToTaskTextOnly.report.reasonCode, RUNTIME_AUTH_REASONS.scopeNotAllowed);
  assert.equal(scopedToTaskTextOnly.fakeState.authCookieApplyCount, 0);
  assert.equal(scopedToTaskTextOnly.fakeState.navigateCount, 0);
  assert.equal(scopedToTaskTextOnly.vault.getCounters().getScopedSessionMaterialCalls, 0);
  assertNoCanaryLeak({ report: scopedToTaskTextOnly.report, auditEvents: scopedToTaskTextOnly.auditEvents });
});

test('selector and completion failures after browser auth release material and keep V2 reasons', async () => {
  const scenarios = [
    {
      name: 'selector not found',
      fakeScenario: { selectorCounts: { '[data-sf-field="message"]': 0 } },
      reason: RUNTIME_REASONS.browserSelectorNotFound,
    },
    {
      name: 'selector not unique',
      fakeScenario: { selectorCounts: { '[data-sf-field="message"]': 2 } },
      reason: RUNTIME_REASONS.browserSelectorNotUnique,
    },
    {
      name: 'completion missing',
      fakeScenario: { completionObserved: false },
      reason: RUNTIME_REASONS.browserCompletionNotObserved,
    },
  ];
  for (const scenario of scenarios) {
    const { report, auditEvents, fakeState, vault } = await executeAuthBrowser(scenario);
    assert.equal(report.status, 'failed', scenario.name);
    assert.equal(report.reasonCode, scenario.reason, scenario.name);
    assert.equal(fakeState.authCookieApplyCount, 1);
    assert.equal(vault.getCounters().getScopedSessionMaterialCalls, 1);
    assert.equal(vault.getCounters().releaseScopedSessionMaterialCalls, 1);
    assertNoCanaryLeak({ report, auditEvents });
  }
});
