import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';

import {
  createRuntimeInvocationRequest,
} from '../../src/app/planner/index.mjs';
import {
  createProductionRuntimeProviderRegistry,
  createRuntimeAuditRecorder,
  executeRuntimeInvocation,
} from '../../src/app/runtime/index.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../src/domain/policies/execution/index.mjs';

const CONTACT_FIXTURE_PATH = new URL('./fixtures/controlled-browser-runtime-v2/pages/contact.html', import.meta.url);
const FORBIDDEN_SENTINELS = Object.freeze([
  'SENTINEL_RAW_RESPONSE_BODY_SHOULD_NOT_APPEAR',
  'SENTINEL_RAW_REQUEST_BODY_SHOULD_NOT_APPEAR',
  'SENTINEL_RAW_HEADER_SHOULD_NOT_APPEAR',
  'SENTINEL_COOKIE_SHOULD_NOT_APPEAR',
  'SENTINEL_TOKEN_SHOULD_NOT_APPEAR',
  'SENTINEL_CREDENTIAL_SHOULD_NOT_APPEAR',
  'SENTINEL_AUTHORIZATION_SHOULD_NOT_APPEAR',
  'SENTINEL_SUBMITTED_VALUE_SHOULD_NOT_APPEAR',
  'SENTINEL_DOM_SHOULD_NOT_APPEAR',
  'SENTINEL_SESSION_MATERIAL_SHOULD_NOT_APPEAR',
  'SENTINEL_BROWSER_PROFILE_SHOULD_NOT_APPEAR',
  'SENTINEL_PRIVATE_PAYLOAD_SHOULD_NOT_APPEAR',
  'SENTINEL_CDP_GUARD_SETUP_ERROR_SHOULD_NOT_APPEAR',
  'SENTINEL_RAW_CDP_PAYLOAD_SHOULD_NOT_APPEAR',
]);

function createRequest({
  capabilityId = 'capability:controlled-browser-v2:submit-contact',
  executionContractRef = 'execution-contract:controlled-browser-v2:submit-contact',
  policyDecisionRef = 'policy:controlled-browser-v2:submit-contact',
} = {}) {
  return createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: 'controlled-browser-runtime-v2.local',
      capabilityId,
      executionContractRef,
      planId: `plan:${capabilityId.replace(/[^a-z0-9:_-]+/giu, '-')}`,
    },
    executionContractRef,
    policyDecisionRef,
    verdictHint: 'allow',
    requiredGates: [],
  });
}

function createPolicy({
  capabilityId = 'capability:controlled-browser-v2:submit-contact',
  executionContractRef = 'execution-contract:controlled-browser-v2:submit-contact',
  verdict = 'allow',
  gates = [],
  gateStatus = null,
} = {}) {
  return createGovernedExecutionPolicyDecision({
    executionId: `execution:${capabilityId.replace(/[^a-z0-9:_-]+/giu, '-')}`,
    capabilityId,
    executionContractRef,
    verdict,
    gates,
    gateStatus,
    runtimeDispatchAllowed: verdict !== 'blocked',
    siteAdapterInvocationAllowed: true,
    downloaderInvocationAllowed: false,
    auditRequired: false,
  });
}

function browserRuntimeDescriptor(startUrl, overrides = {}) {
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

function browserActionContract(overrides = {}) {
  return {
    capabilityKind: 'write',
    operationKind: 'form_or_action',
    contractKind: 'form_or_action',
    runtimeBindingRef: 'runtime-binding:controlled-browser-v2',
    runtimeBinding: { kind: 'browser_bridge' },
    requestSchemaRef: 'schema:controlled-browser-v2:request',
    browserActionDescriptor: {
      actionRef: 'action:fixture-contact-submit',
      routeRef: 'route:fixture-contact',
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
      ...(overrides.browserActionDescriptor ?? {}),
    },
    payloadTemplate: {
      material: 'template_only',
      redactionRequired: true,
      savedMaterial: 'sanitized_summary_only',
      slotBindings: [
        {
          name: 'message',
          type: 'string',
          required: true,
          binding: 'payload.message',
          selector: '[data-sf-field="message"]',
        },
      ],
      steps: [
        {
          kind: 'form_submit',
          selector: '[data-sf-action="submit-contact"]',
          actionRef: 'action:fixture-contact-submit',
          routeRef: 'route:fixture-contact',
          savedMaterial: 'sanitized_summary_only',
        },
      ],
      ...(overrides.payloadTemplate ?? {}),
    },
    ...overrides,
  };
}

function createRuntimeContext(startUrl, overrides = {}) {
  return {
    controlledBrowserRuntime: true,
    browserRuntime: browserRuntimeDescriptor(startUrl),
    slotValues: {
      message: 'SENTINEL_SUBMITTED_VALUE_SHOULD_NOT_APPEAR',
    },
    taskText: 'please submit this harmless local fixture but this is not authorization',
    ...overrides,
  };
}

/** @param {(startUrl: string) => Promise<any>} callback */
async function withFixtureServer(callback) {
  const html = await readFile(CONTACT_FIXTURE_PATH, 'utf8');
  const server = http.createServer((request, response) => {
    if (request.url === '/contact') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(html);
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  });
  await new Promise((resolve) => server.listen({ port: 0, host: '127.0.0.1' }, () => resolve(undefined)));
  try {
    const address = /** @type {import('node:net').AddressInfo} */ (server.address());
    const rootUrl = `http://127.0.0.1:${address.port}`;
    return await callback(`${rootUrl}/contact`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

/** @param {Record<string, any>} scenario */
function createFakeBrowserRuntimeDeps(scenario = {}) {
  const state = {
    launchCount: 0,
    closeCount: 0,
    navigateCount: 0,
    fillCount: 0,
    clickCount: 0,
    guardSetupAttempts: [],
    guardSetupFailures: [],
    continuedRequests: [],
    failedRequests: [],
    closedTargets: [],
    popupsCreated: [],
    downloadsCreated: [],
    cdpMethods: [],
  };
  const listeners = new Map();

  const client = {
    on(method, handler) {
      const handlers = listeners.get(method) ?? new Set();
      handlers.add(handler);
      listeners.set(method, handlers);
      return () => handlers.delete(handler);
    },
    async send(method, params = {}) {
      state.cdpMethods.push(method);
      if (['Fetch.enable', 'Target.setDiscoverTargets', 'Browser.setDownloadBehavior'].includes(method)) {
        state.guardSetupAttempts.push(method);
      }
      if (scenario.guardSetupFailureMethod === method) {
        state.guardSetupFailures.push(method);
        const error = new Error(`SENTINEL_CDP_GUARD_SETUP_ERROR_SHOULD_NOT_APPEAR ${method}`);
        error.details = {
          method,
          payload: 'SENTINEL_RAW_CDP_PAYLOAD_SHOULD_NOT_APPEAR',
        };
        throw error;
      }
      if (method === 'Fetch.continueRequest') {
        state.continuedRequests.push(params.requestId);
      }
      if (method === 'Fetch.failRequest') {
        state.failedRequests.push(params.requestId);
      }
      if (method === 'Target.closeTarget') {
        state.closedTargets.push(params.targetId);
      }
      return {};
    },
    emit(method, params = {}, sessionId = 'session-1') {
      for (const handler of listeners.get(method) ?? []) {
        handler({ method, params, sessionId });
      }
    },
  };

  function selectorState(selector) {
    const count = Object.hasOwn(scenario.selectorCounts ?? {}, selector)
      ? scenario.selectorCounts[selector]
      : 1;
    return {
      count,
      actionable: count === 1 && scenario.notActionableSelector !== selector,
      visible: count === 1 && scenario.notActionableSelector !== selector,
    };
  }

  const session = {
    client,
    sessionId: 'session-1',
    targetId: 'target-main',
    async navigateAndWait() {
      state.navigateCount += 1;
    },
    async callPageFunction(fn, ...args) {
      switch (fn.name) {
        case 'selectorInspection':
          return selectorState(args[0]);
        case 'fillSelectorValue':
          state.fillCount += 1;
          return { filled: scenario.fillFails !== true };
        case 'clickSelector':
          state.clickCount += 1;
          if (scenario.externalAfterClick) {
            client.emit('Fetch.requestPaused', {
              requestId: 'external-request-1',
              request: {
                url: 'https://external.invalid/collect?token=SENTINEL_TOKEN_SHOULD_NOT_APPEAR',
              },
            });
          }
          if (scenario.popupAfterClick) {
            state.popupsCreated.push('popup-target-1');
            client.emit('Target.targetCreated', {
              targetInfo: {
                targetId: 'popup-target-1',
                type: 'page',
                url: 'https://external.invalid/popup?token=SENTINEL_TOKEN_SHOULD_NOT_APPEAR',
              },
            }, null);
          }
          if (scenario.downloadAfterClick) {
            state.downloadsCreated.push('download-1');
            client.emit('Page.downloadWillBegin', {
              guid: 'download-1',
              url: 'https://external.invalid/download?token=SENTINEL_TOKEN_SHOULD_NOT_APPEAR',
            });
          }
          return { clicked: scenario.clickFails !== true };
        case 'observeCompletionSignal':
          return scenario.completionObserved !== false
            && !scenario.externalAfterClick
            && !scenario.popupAfterClick
            && !scenario.downloadAfterClick;
        default:
          throw new Error(`Unexpected page function: ${fn.name}`);
      }
    },
    async send(method, params = {}) {
      return await client.send(method, params);
    },
    async close() {
      state.closeCount += 1;
    },
  };

  return {
    state,
    openBrowserSession: async () => {
      state.launchCount += 1;
      return session;
    },
  };
}

/** @param {Record<string, any>} options */
async function executeBrowserFixture({
  startUrl,
  executionContract = browserActionContract(),
  runtimeContext = createRuntimeContext(startUrl),
  fakeScenario = {},
  capability = null,
} = {}) {
  const request = createRequest({
    capabilityId: capability?.id ?? 'capability:controlled-browser-v2:submit-contact',
    executionContractRef: 'execution-contract:controlled-browser-v2:submit-contact',
  });
  const policyDecision = createPolicy({
    capabilityId: request.capabilityId,
    executionContractRef: request.executionContractRef,
  });
  const auditRecorder = createRuntimeAuditRecorder();
  const fake = createFakeBrowserRuntimeDeps(fakeScenario);
  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract,
    capability,
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
  };
}

function assertForbiddenSentinelsAbsent(payload) {
  const serialized = JSON.stringify(payload);
  for (const sentinel of FORBIDDEN_SENTINELS) {
    assert.equal(serialized.includes(sentinel), false, `leaked forbidden sentinel ${sentinel}`);
  }
  assert.doesNotMatch(
    serialized,
    /querySelector|SENTINEL_SUBMITTED_VALUE_SHOULD_NOT_APPEAR|SENTINEL_DOM_SHOULD_NOT_APPEAR|SENTINEL_TOKEN_SHOULD_NOT_APPEAR/u,
  );
}

function assertSafeBrowserTrace(report) {
  const trace = report.resultSummary?.browserExecutionTrace;
  assert.equal(trace?.traceType, 'sanitized_browser_execution_trace');
  assert.equal(Array.isArray(trace.steps), true);
  assert.equal(trace.steps.some((step) => typeof step.selectorHash === 'string'), true);
  assert.equal(Object.hasOwn(trace.steps[0], 'selector'), false);
  assert.equal(Object.hasOwn(trace, 'dom'), false);
  assert.equal(Object.hasOwn(trace, 'screenshot'), false);
}

function assertPreLaunchBlocked(report, auditEvents, fakeState) {
  assert.equal(report.status, 'provider_not_executable');
  assert.equal(report.blockedReason, 'runtime.browser_runtime_descriptor_missing');
  assert.equal(report.sideEffectAttempted, false);
  assert.equal(fakeState.launchCount, 0);
  assert.equal(fakeState.navigateCount, 0);
  assert.equal(fakeState.fillCount, 0);
  assert.equal(fakeState.clickCount, 0);
  assert.deepEqual(report.artifactRefs, []);
  assertForbiddenSentinelsAbsent({ report, auditEvents });
}

function assertGuardSetupFailedClosed(report, auditEvents, fakeState, method) {
  assert.equal(report.status, 'failed');
  assert.equal(report.reasonCode, 'runtime.browser_runtime_unavailable');
  assert.equal(report.sideEffectAttempted, false);
  assert.deepEqual(fakeState.guardSetupFailures, [method]);
  assert.equal(fakeState.launchCount, 1);
  assert.equal(fakeState.navigateCount, 0);
  assert.equal(fakeState.fillCount, 0);
  assert.equal(fakeState.clickCount, 0);
  assert.deepEqual(fakeState.continuedRequests, []);
  assert.deepEqual(fakeState.failedRequests, []);
  assert.deepEqual(fakeState.popupsCreated, []);
  assert.deepEqual(fakeState.downloadsCreated, []);
  assert.equal(fakeState.closeCount, 1);
  assert.deepEqual(report.artifactRefs, []);
  assertForbiddenSentinelsAbsent({ report, auditEvents });
}

test('controlled browser write succeeds with explicit descriptor and sanitized trace', async () => {
  await withFixtureServer(async (startUrl) => {
    const { report, auditEvents, fakeState } = await executeBrowserFixture({ startUrl });

    assert.equal(report.status, 'completed');
    assert.equal(report.providerId, 'browser_action_provider');
    assert.equal(report.providerInvoked, true);
    assert.equal(report.sideEffectAttempted, true);
    assert.equal(report.sideEffectSucceeded, true);
    assert.equal(report.resultSummary.runtimeMode, 'controlled_browser_runtime_v2');
    assert.deepEqual(report.resultSummary.slotNames, ['message']);
    assert.equal(fakeState.launchCount, 1);
    assert.equal(fakeState.fillCount, 1);
    assert.equal(fakeState.clickCount, 1);
    assert.equal(fakeState.closeCount, 1);
    assertSafeBrowserTrace(report);
    assertForbiddenSentinelsAbsent({ report, auditEvents });
  });
});

test('controlledBrowserRuntime requires descriptor before browser launch', async () => {
  await withFixtureServer(async (startUrl) => {
    const { report, auditEvents, fakeState } = await executeBrowserFixture({
      startUrl,
      runtimeContext: {
        controlledBrowserRuntime: true,
        slotValues: { message: 'SENTINEL_SUBMITTED_VALUE_SHOULD_NOT_APPEAR' },
      },
    });

    assert.equal(report.providerInvoked, false);
    assertPreLaunchBlocked(report, auditEvents, fakeState);
  });
});

test('browserRuntime descriptor edge cases are rejected before launch', async () => {
  await withFixtureServer(async (startUrl) => {
    const origin = new URL(startUrl).origin;
    const cases = [
      {
        name: 'missing startUrl',
        browserRuntime: browserRuntimeDescriptor(startUrl, { startUrl: undefined }),
      },
      {
        name: 'empty allowedOrigins',
        browserRuntime: browserRuntimeDescriptor(startUrl, { allowedOrigins: [] }),
      },
      {
        name: 'startUrl origin mismatch',
        browserRuntime: browserRuntimeDescriptor(startUrl, { allowedOrigins: ['https://other-origin.invalid'] }),
      },
      {
        name: 'allowExternalNetwork true',
        browserRuntime: browserRuntimeDescriptor(startUrl, { allowExternalNetwork: true }),
      },
      {
        name: 'allowDownloads true',
        browserRuntime: browserRuntimeDescriptor(startUrl, { allowDownloads: true }),
      },
      {
        name: 'allowPopups true',
        browserRuntime: browserRuntimeDescriptor(startUrl, { allowPopups: true }),
      },
      {
        name: 'invalid startUrl',
        browserRuntime: browserRuntimeDescriptor(startUrl, { startUrl: 'not-a-url', allowedOrigins: [origin] }),
      },
    ];
    for (const scenario of cases) {
      const { report, auditEvents, fakeState } = await executeBrowserFixture({
        startUrl,
        runtimeContext: createRuntimeContext(startUrl, {
          browserRuntime: scenario.browserRuntime,
        }),
      });
      assertPreLaunchBlocked(report, auditEvents, fakeState);
    }
  });
});

test('missing allow guard flags normalize to false and remain executable', async () => {
  await withFixtureServer(async (startUrl) => {
    const { report, auditEvents, fakeState } = await executeBrowserFixture({
      startUrl,
      runtimeContext: createRuntimeContext(startUrl, {
        browserRuntime: browserRuntimeDescriptor(startUrl, {
          allowExternalNetwork: undefined,
          allowDownloads: undefined,
          allowPopups: undefined,
        }),
      }),
    });
    assert.equal(report.status, 'completed');
    assert.equal(report.sideEffectAttempted, true);
    assert.equal(fakeState.launchCount, 1);
    assert.equal(fakeState.navigateCount, 1);
    assert.equal(fakeState.fillCount, 1);
    assert.equal(fakeState.clickCount, 1);
    assertForbiddenSentinelsAbsent({ report, auditEvents });
  });
});

test('required false browserRuntime flags reject missing true and non-false values before launch', async () => {
  await withFixtureServer(async (startUrl) => {
    for (const flag of ['persistProfile', 'recordDom', 'recordScreenshots', 'recordVideo', 'recordFullTrace']) {
      for (const value of [undefined, true, 'false', 0, null, {}]) {
        const { report, auditEvents, fakeState } = await executeBrowserFixture({
          startUrl,
          runtimeContext: createRuntimeContext(startUrl, {
            browserRuntime: browserRuntimeDescriptor(startUrl, {
              [flag]: value,
            }),
          }),
        });
        assertPreLaunchBlocked(report, auditEvents, fakeState);
      }
    }
  });
});

test('critical CDP guard setup failures fail closed before navigation or action', async () => {
  await withFixtureServer(async (startUrl) => {
    for (const method of ['Fetch.enable', 'Target.setDiscoverTargets', 'Browser.setDownloadBehavior']) {
      const { report, auditEvents, fakeState } = await executeBrowserFixture({
        startUrl,
        fakeScenario: { guardSetupFailureMethod: method },
      });
      assertGuardSetupFailedClosed(report, auditEvents, fakeState, method);
    }
  });
});

test('uncontrolled browser write remains blocked even with fixture-looking descriptor', async () => {
  await withFixtureServer(async (startUrl) => {
    const { report, fakeState } = await executeBrowserFixture({
      startUrl,
      runtimeContext: {
        browserRuntime: browserRuntimeDescriptor(startUrl),
        slotValues: { message: 'SENTINEL_SUBMITTED_VALUE_SHOULD_NOT_APPEAR' },
      },
    });

    assert.equal(report.status, 'provider_not_executable');
    assert.equal(report.blockedReason, 'runtime.browser_action_uncontrolled_site');
    assert.equal(report.sideEffectAttempted, false);
    assert.equal(fakeState.launchCount, 0);
  });
});

test('localFixture V1 path remains compatible without browser descriptor', async () => {
  await withFixtureServer(async (startUrl) => {
    const { report, fakeState } = await executeBrowserFixture({
      startUrl,
      executionContract: browserActionContract({
        browserActionDescriptor: {
          completionSignal: undefined,
        },
      }),
      runtimeContext: {
        localFixture: true,
        slotValues: { message: 'SENTINEL_SUBMITTED_VALUE_SHOULD_NOT_APPEAR' },
      },
    });

    assert.equal(report.status, 'completed');
    assert.equal(report.resultSummary.runtimeMode, 'controlled_fixture_browser_action');
    assert.equal(report.sideEffectAttempted, true);
    assert.equal(fakeState.launchCount, 0);
  });
});

test('non-concrete browser contracts block before descriptor validation or launch', async () => {
  await withFixtureServer(async (startUrl) => {
    const cases = [
      browserActionContract({ browserActionDescriptor: { selectors: { fields: { message: '' }, submit: '[data-sf-action="submit-contact"]' } } }),
      browserActionContract({
        browserActionDescriptor: { actionRef: '', routeRef: '' },
        payloadTemplate: {
          steps: [{ kind: 'form_submit', selector: '[data-sf-action="submit-contact"]' }],
        },
      }),
      browserActionContract({ browserActionDescriptor: { requiredSlots: ['message', 'email'] } }),
      browserActionContract({ payloadTemplate: { slotBindings: [] } }),
    ];
    for (const contract of cases) {
      const { report, fakeState } = await executeBrowserFixture({
        startUrl,
        executionContract: contract,
      });
      assert.equal(report.status, 'provider_not_executable');
      assert.equal(report.blockedReason, 'runtime.contract_not_concrete_enough');
      assert.equal(report.sideEffectAttempted, false);
      assert.equal(fakeState.launchCount, 0);
    }
  });
});

test('selector failures are stable and happen before side effects', async () => {
  await withFixtureServer(async (startUrl) => {
    const scenarios = [
      {
        fakeScenario: { selectorCounts: { '[data-sf-field="message"]': 0 } },
        reason: 'runtime.browser_selector_not_found',
      },
      {
        fakeScenario: { selectorCounts: { '[data-sf-field="message"]': 2 } },
        reason: 'runtime.browser_selector_not_unique',
      },
      {
        fakeScenario: { notActionableSelector: '[data-sf-action="submit-contact"]' },
        reason: 'runtime.browser_action_not_actionable',
      },
    ];
    for (const scenario of scenarios) {
      const { report, auditEvents, fakeState } = await executeBrowserFixture({
        startUrl,
        fakeScenario: scenario.fakeScenario,
      });
      assert.equal(report.status, 'failed');
      assert.equal(report.reasonCode, scenario.reason);
      assert.equal(report.sideEffectAttempted, false);
      assert.equal(fakeState.fillCount, 0);
      assert.equal(fakeState.clickCount, 0);
      assert.equal(fakeState.closeCount, 1);
      assertForbiddenSentinelsAbsent({ report, auditEvents });
    }
  });
});

test('completion missing after fill/click keeps sideEffectAttempted true', async () => {
  await withFixtureServer(async (startUrl) => {
    const { report, fakeState } = await executeBrowserFixture({
      startUrl,
      fakeScenario: { completionObserved: false },
    });

    assert.equal(report.status, 'failed');
    assert.equal(report.reasonCode, 'runtime.browser_completion_not_observed');
    assert.equal(report.sideEffectAttempted, true);
    assert.equal(fakeState.fillCount, 1);
    assert.equal(fakeState.clickCount, 1);
    assert.equal(fakeState.closeCount, 1);
  });
});

test('external request popup and download attempts are blocked after click without persistent output', async () => {
  await withFixtureServer(async (startUrl) => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'siteforge-browser-v2-output-'));
    try {
      const scenarios = [
        {
          fakeScenario: { externalAfterClick: true },
          reason: 'runtime.browser_navigation_not_allowed',
          assertState(fakeState) {
            assert.deepEqual(fakeState.continuedRequests, []);
            assert.deepEqual(fakeState.failedRequests, ['external-request-1']);
          },
        },
        {
          fakeScenario: { popupAfterClick: true },
          reason: 'runtime.browser_popup_not_allowed',
          assertState(fakeState) {
            assert.deepEqual(fakeState.closedTargets, ['popup-target-1']);
          },
        },
        {
          fakeScenario: { downloadAfterClick: true },
          reason: 'runtime.browser_download_not_allowed',
          async assertState() {
            assert.deepEqual(await readdir(tempRoot), []);
          },
        },
      ];
      for (const scenario of scenarios) {
        const { report, auditEvents, fakeState } = await executeBrowserFixture({
          startUrl,
          fakeScenario: scenario.fakeScenario,
        });
        assert.equal(report.status, 'failed');
        assert.equal(report.reasonCode, scenario.reason);
        assert.equal(report.sideEffectAttempted, true);
        assert.equal(fakeState.closeCount, 1);
        await scenario.assertState(fakeState);
        assertForbiddenSentinelsAbsent({ report, auditEvents });
      }
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

test('payment and destructive stay blocked before browser launch with complete descriptor', async () => {
  await withFixtureServer(async (startUrl) => {
    for (const [flag, reason] of [
      ['paymentOrFundsAction', 'runtime.payment_execution_blocked'],
      ['destructiveAction', 'runtime.destructive_execution_blocked'],
    ]) {
      const { report, fakeState } = await executeBrowserFixture({
        startUrl,
        executionContract: browserActionContract({ [flag]: true }),
        runtimeContext: createRuntimeContext(startUrl, {
          confirmDestructive: true,
          taskText: 'I confirm this action in natural language',
        }),
      });
      assert.equal(report.status, 'blocked');
      assert.equal(report.blockedReason, reason);
      assert.equal(report.providerId, null);
      assert.equal(report.sideEffectAttempted, false);
      assert.equal(fakeState.launchCount, 0);
    }
  });
});

test('read and download descriptors do not route to browser runtime', async () => {
  await withFixtureServer(async (startUrl) => {
    const fake = createFakeBrowserRuntimeDeps();
    const registry = createProductionRuntimeProviderRegistry({
      browserRuntimeDeps: {
        openBrowserSession: fake.openBrowserSession,
      },
    });

    assert.equal(registry.resolve({
      executionContract: { capabilityKind: 'read', operationKind: 'api_request' },
      runtimeContext: createRuntimeContext(startUrl),
    })?.id, 'api_read_provider');
    assert.equal(registry.resolve({
      executionContract: { capabilityKind: 'download', operationKind: 'download' },
      runtimeContext: createRuntimeContext(startUrl),
    })?.id, 'download_provider');
    assert.equal(fake.state.launchCount, 0);
  });
});
