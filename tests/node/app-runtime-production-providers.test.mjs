import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import {
  createRuntimeInvocationRequest,
} from '../../src/app/planner/index.mjs';
import {
  createBrowserActionProvider,
  createApiReadProvider,
  createProductionRuntimeProviders,
  createProductionRuntimeProviderRegistry,
  executeRuntimeInvocation,
  BROWSER_BRIDGE_PROVIDER_ID,
  createBrowserBridgeReadProvider,
  WEIBO_READONLY_PROVIDER_ID,
  createWeiboReadonlyProvider,
  ZHIHU_READONLY_PROVIDER_ID,
  createZhihuReadonlyProvider,
} from '../../src/app/runtime/index.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../src/domain/policies/execution/index.mjs';
import {
  applyDefaultProductionRuntimeProviderRegistry,
} from '../../src/entrypoints/build/run-build.mjs';

function createRequest({
  capabilityId = 'capability:synthetic:read-catalog',
  executionContractRef = 'execution-contract:synthetic-read-catalog',
  policyDecisionRef = 'policy:synthetic-read-catalog',
  verdictHint = 'allow',
  requiredGates = [],
} = {}) {
  return createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: 'synthetic.example',
      capabilityId,
      executionContractRef,
      planId: `plan:${capabilityId.replace(/[^a-z0-9:_-]+/giu, '-')}`,
    },
    executionContractRef,
    policyDecisionRef,
    verdictHint,
    requiredGates,
  });
}

function createPolicy({
  capabilityId = 'capability:synthetic:read-catalog',
  executionContractRef = 'execution-contract:synthetic-read-catalog',
  verdict = 'allow',
  gates = [],
  gateStatus = null,
  siteAdapterInvocationAllowed = true,
  downloaderInvocationAllowed = false,
} = {}) {
  return createGovernedExecutionPolicyDecision({
    executionId: `execution:${capabilityId.replace(/[^a-z0-9:_-]+/giu, '-')}`,
    capabilityId,
    executionContractRef,
    verdict,
    gates,
    gateStatus,
    runtimeDispatchAllowed: verdict !== 'blocked',
    siteAdapterInvocationAllowed,
    downloaderInvocationAllowed,
    auditRequired: gates.includes('audit_required'),
  });
}

function assertSafeReport(report) {
  assert.doesNotMatch(
    JSON.stringify(report),
    /Bearer|set-cookie|Authorization|rawRequestBody|rawResponseBody|requestBody|responseBody|browserProfilePath|userDataDir|session material|cookie|credential|private fixture value|raw DOM|querySelector/iu,
  );
}

function browserActionContract(overrides = {}) {
  return {
    capabilityKind: 'write',
    operationKind: 'form_or_action',
    contractKind: 'form_or_action',
    runtimeBindingRef: 'runtime-binding:synthetic-browser-action',
    runtimeBinding: { kind: 'browser_bridge' },
    requestSchemaRef: 'schema:synthetic-browser-action:request',
    browserActionDescriptor: {
      selector: '[data-siteforge-action="contact-form"]',
      actionRef: 'action:fixture-contact-submit',
      routeRef: 'route:fixture-contact',
      requiredSlots: ['message'],
      ...(overrides.browserActionDescriptor ?? {}),
    },
    payloadTemplate: {
      material: 'template_only',
      redactionRequired: true,
      savedMaterial: 'sanitized_summary_only',
      slotBindings: [
        { name: 'message', type: 'string', required: true },
      ],
      steps: [
        {
          kind: 'form_submit',
          selector: '[data-siteforge-action="contact-form"]',
          actionRef: 'action:fixture-contact-submit',
          routeRef: 'route:fixture-contact',
          submit: true,
          finalSubmit: false,
          autoExecute: false,
          savedMaterial: 'sanitized_summary_only',
        },
      ],
      ...(overrides.payloadTemplate ?? {}),
    },
    ...overrides,
  };
}

test('CLI build options inject production registry factory only for task execution', () => {
  const injected = applyDefaultProductionRuntimeProviderRegistry({
    executionTask: 'search products',
    execute: true,
  });
  assert.equal(typeof injected.runtimeProviderRegistryFactory, 'function');
  assert.equal(injected.runtimeProviderRegistry, undefined);

  const registry = injected.runtimeProviderRegistryFactory();
  assert.equal(registry.resolve({
    invocationRequest: { capabilityId: 'capability:synthetic:search-products' },
    executionContract: {
      capabilityKind: 'read',
      operationKind: 'api_request',
    },
  })?.id, 'api_read_provider');
  assert.equal(registry.resolve({
    invocationRequest: { capabilityId: 'capability:synthetic:download-report' },
    executionContract: {
      capabilityKind: 'download',
      operationKind: 'download',
    },
  })?.id, 'download_provider');
  assert.equal(registry.resolve({
    invocationRequest: { capabilityId: 'capability:synthetic:submit-contact' },
    executionContract: browserActionContract(),
  })?.id, 'browser_action_provider');
  assert.equal(registry.resolve({
    invocationRequest: { capabilityId: 'capability:x:list-notifications' },
    executionContract: {
      capabilityKind: 'read',
      operationKind: 'navigate',
      runtimeBinding: { kind: 'browser_bridge', providerId: 'browser_bridge' },
    },
  })?.id, 'browser_bridge');
  assert.equal(registry.resolve({
    invocationRequest: { capabilityId: 'capability:x:list-bookmarks' },
    executionContract: {
      capabilityKind: 'read',
      operationKind: 'navigate',
      runtimeBinding: { kind: 'browser_bridge' },
    },
  })?.id, 'browser_bridge');

  assert.equal(
    applyDefaultProductionRuntimeProviderRegistry({ executionTask: 'search products' }).runtimeProviderRegistryFactory,
    undefined,
  );
  assert.equal(
    applyDefaultProductionRuntimeProviderRegistry({ execute: true }).runtimeProviderRegistryFactory,
    undefined,
  );
});

test('CLI production registry factory injection preserves explicit runtime providers', () => {
  const explicitRegistry = { resolve() { return null; } };
  const withRegistry = applyDefaultProductionRuntimeProviderRegistry({
    executionTask: 'search products',
    execute: true,
    runtimeProviderRegistry: explicitRegistry,
  });
  assert.equal(withRegistry.runtimeProviderRegistry, explicitRegistry);
  assert.equal(withRegistry.runtimeProviderRegistryFactory, undefined);

  const explicitFactory = () => explicitRegistry;
  const withFactory = applyDefaultProductionRuntimeProviderRegistry({
    executionTask: 'search products',
    execute: true,
    runtimeProviderRegistryFactory: explicitFactory,
  });
  assert.equal(withFactory.runtimeProviderRegistryFactory, explicitFactory);
  assert.equal(withFactory.runtimeProviderRegistry, undefined);
});

test('browser_bridge provider executes descriptor-only read tasks without session material or side effects', async () => {
  const request = createRequest({
    capabilityId: 'capability:x:list-notifications',
    executionContractRef: 'execution-contract:x:list-notifications',
    verdictHint: 'controlled',
    requiredGates: ['session_required'],
  });
  const policyDecision = createPolicy({
    capabilityId: 'capability:x:list-notifications',
    executionContractRef: 'execution-contract:x:list-notifications',
    verdict: 'controlled',
    gates: ['session_required'],
    gateStatus: {
      session_required: { satisfied: true },
    },
  });

  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    gateStatus: {
      session_required: { satisfied: true },
    },
    executionContract: {
      capabilityId: 'capability:x:list-notifications',
      capabilityKind: 'read',
      operationKind: 'navigate',
      contractKind: 'navigate',
      sessionRequirementRef: 'session-requirement:x:list-notifications',
      authRequirementRef: null,
      authRequirement: {
        required: false,
        mode: 'none',
        scopes: [],
        material: {
          allowedTypes: [],
          injectionTarget: 'http_request',
        },
      },
      requestSchemaRef: 'schema:x:list-notifications:request',
      runtimeBindingRef: 'runtime-binding:x:list-notifications',
      runtimeBinding: {
        kind: 'browser_bridge',
        providerId: 'browser_bridge',
      },
      payloadTemplate: {
        steps: [
          {
            kind: 'site_action',
            routeTemplate: '/notifications',
            savedMaterial: 'sanitized_summary_only',
          },
        ],
      },
      descriptorOnly: true,
      redactionRequired: true,
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(report.status, 'completed');
  assert.equal(report.providerId, BROWSER_BRIDGE_PROVIDER_ID);
  assert.equal(report.providerKind, 'browser_bridge_read_provider');
  assert.equal(report.providerInvoked, true);
  assert.equal(report.runtimeExecuted, true);
  assert.equal(report.sideEffectAttempted, false);
  assert.equal(report.sideEffectSucceeded, false);
  assert.equal(report.resultSummary.outcome, 'browser_bridge_summary_available');
  assert.equal(report.resultSummary.authMaterial, 'not_requested_by_provider');
  assert.deepEqual(report.resultSummary.routeRefs, ['/notifications']);
  assertSafeReport(report);
});

test('api_read_provider executes descriptor-only read/API tasks with sanitized summary', async () => {
  const request = createRequest();
  const policyDecision = createPolicy();

  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract: {
      capabilityKind: 'read',
      operationKind: 'api_request',
      contractKind: 'api_request',
      requestSchemaRef: 'schema:synthetic-read:request',
      runtimeBindingRef: 'runtime-binding:synthetic-read',
      runtimeBoundary: 'app/runtime',
      descriptorOnly: true,
      redactionRequired: true,
      payloadTemplate: {
        material: 'template_only',
        savedMaterial: 'sanitized_summary_only',
        slotBindings: [
          { name: 'query', type: 'string', required: true },
        ],
        steps: [
          { kind: 'read_sanitized_summary', routeTemplate: '/search/', pageKind: 'search-results-page' },
        ],
      },
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(report.status, 'completed');
  assert.equal(report.providerId, 'api_read_provider');
  assert.equal(report.providerInvoked, true);
  assert.equal(report.executionAttempted, true);
  assert.equal(report.sideEffectAttempted, true);
  assert.equal(report.sideEffectSucceeded, true);
  assert.equal(report.resultSummary.outcome, 'api_read_completed');
  assert.equal(report.resultSummary.runtimeMode, 'descriptor_only_read');
  assert.equal(report.resultSummary.structuredResult.kind, 'descriptor_read_summary');
  assert.equal(report.resultSummary.structuredResult.routeTemplate, '/search/');
  assert.equal(report.resultSummary.structuredResult.pageKind, 'search-results-page');
  assert.deepEqual(report.resultSummary.structuredResult.slotNames, ['query']);
  assert.deepEqual(report.resultSummary.structuredResult.slotSchema, [
    { name: 'query', required: true, type: 'string' },
  ]);
  assert.equal(report.resultSummary.structuredResult.savedMaterial, 'sanitized_summary_only');
  assert.deepEqual(report.artifactRefs, []);
  assertSafeReport(report);
});

test('api_read_provider rejects write download payment and destructive descriptors', async () => {
  const provider = createApiReadProvider();
  for (const descriptor of [
    { executionContract: { capabilityKind: 'write', operationKind: 'form_or_action' } },
    { executionContract: { capabilityKind: 'download', operationKind: 'download' } },
    { executionContract: { capabilityKind: 'read', paymentOrFundsAction: true } },
    { executionContract: { capabilityKind: 'read', destructiveAction: true } },
    { executionContract: { capabilityKind: 'read', operationKind: 'navigate', runtimeBinding: { kind: 'browser_bridge' } } },
  ]) {
    assert.equal(provider.supports(descriptor), false);
    assert.deepEqual(provider.canExecute(descriptor), {
      allowed: false,
      reasonCode: 'runtime.api_read_provider_unsupported',
    });
  }
});

test('browser_bridge provider rejects write download payment and destructive descriptors', async () => {
  const provider = createBrowserBridgeReadProvider();
  for (const descriptor of [
    { executionContract: { operationKind: 'form_or_action', runtimeBinding: { kind: 'browser_bridge', providerId: 'browser_bridge' } } },
    { executionContract: { operationKind: 'download', runtimeBinding: { kind: 'browser_bridge', providerId: 'browser_bridge' } } },
    { executionContract: { operationKind: 'navigate', paymentOrFundsAction: true, runtimeBinding: { kind: 'browser_bridge', providerId: 'browser_bridge' } } },
    { executionContract: { operationKind: 'navigate', destructiveAction: true, runtimeBinding: { kind: 'browser_bridge', providerId: 'browser_bridge' } } },
  ]) {
    assert.equal(provider.supports(descriptor), false);
    assert.deepEqual(provider.canExecute(descriptor), {
      allowed: false,
      reasonCode: 'runtime.browser_bridge_provider_unsupported',
    });
  }
});

test('api_read_provider treats post objects as readable when the operation is search or navigate', async () => {
  const registry = createProductionRuntimeProviderRegistry();
  const provider = createApiReadProvider();
  const searchPostsDescriptor = {
    invocationRequest: {
      capabilityId: 'capability:weibo:search-posts',
      executionContractRef: 'execution-contract:weibo:search-posts',
    },
    executionContract: {
      capabilityId: 'capability:weibo:search-posts',
      operationKind: 'navigate',
      contractKind: 'navigate',
      runtimeBinding: {
        kind: 'public_http',
        providerId: null,
      },
    },
  };

  assert.equal(registry.resolve(searchPostsDescriptor)?.id, 'api_read_provider');
  assert.equal(provider.supports(searchPostsDescriptor), true);

  for (const descriptor of [
    {
      invocationRequest: { capabilityId: 'capability:weibo:create-post' },
      executionContract: { operationKind: 'form_or_action', contractKind: 'form_or_action' },
    },
    {
      invocationRequest: { capabilityId: 'capability:weibo:publish-post' },
      executionContract: { operationKind: 'form_or_action', contractKind: 'form_or_action' },
    },
    {
      invocationRequest: { capabilityId: 'capability:weibo:delete-post' },
      executionContract: { operationKind: 'navigate', contractKind: 'navigate', runtimeBinding: { kind: 'public_http' } },
    },
  ]) {
    assert.equal(provider.supports(descriptor), false);
  }
});

test('weibo_readonly_provider executes search posts with sanitized HTTP summary and required query slot', async () => {
  const request = createRequest({
    capabilityId: 'capability:weibo.com-a7b18273:search-posts',
    executionContractRef: 'execution-contract:weibo.com-a7b18273:search-posts',
    policyDecisionRef: 'policy:weibo.com-a7b18273:search-posts',
  });
  const policyDecision = createPolicy({
    capabilityId: 'capability:weibo.com-a7b18273:search-posts',
    executionContractRef: 'execution-contract:weibo.com-a7b18273:search-posts',
  });
  const executionContract = {
    capabilityId: 'capability:weibo.com-a7b18273:search-posts',
    operationKind: 'navigate',
    contractKind: 'navigate',
    runtimeBinding: { kind: 'public_http', providerId: null },
    requestSchemaRef: 'schema:weibo-search-posts:request',
    responseSchemaRef: 'schema:weibo-search-posts:response',
    payloadTemplate: {
      material: 'template_only',
      savedMaterial: 'sanitized_summary_only',
      slotBindings: [
        { name: 'query', type: 'string', required: true },
      ],
    },
  };

  const fetchCalls = [];
  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract,
    runtimeContext: {
      slotValues: { query: 'openai' },
      fetchImpl: async (url, init) => {
        fetchCalls.push({ url, method: init?.method });
        return {
          status: 200,
          ok: true,
          headers: { get: () => 'text/html; charset=utf-8' },
          text: async () => '<html><div class="card-wrap"></div><div class="card-feed"></div></html>',
        };
      },
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(report.status, 'completed');
  assert.equal(report.providerId, WEIBO_READONLY_PROVIDER_ID);
  assert.equal(report.providerInvoked, true);
  assert.equal(report.executionAttempted, true);
  assert.equal(report.resultSummary.outcome, 'weibo_search_read_completed');
  assert.equal(report.resultSummary.response.bodySummary.resultContainerSignals, 2);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].method, 'GET');
  assert.match(fetchCalls[0].url, /^https:\/\/s\.weibo\.com\/weibo\?q=openai$/u);
  assertSafeReport(report);

  const missingSlotReport = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract,
    runtimeContext: {},
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });
  assert.equal(missingSlotReport.status, 'provider_not_executable');
  assert.equal(missingSlotReport.providerId, WEIBO_READONLY_PROVIDER_ID);
  assert.equal(missingSlotReport.blockedReason, 'runtime.missing_required_slot');
  assert.equal(missingSlotReport.providerInvoked, false);

  const redirectReport = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract,
    runtimeContext: {
      slotValues: { query: 'openai' },
      fetchImpl: async () => ({
        status: 302,
        ok: false,
        headers: { get: () => 'text/html; charset=utf-8' },
        text: async () => '',
      }),
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });
  assert.equal(redirectReport.status, 'failed');
  assert.equal(redirectReport.providerId, WEIBO_READONLY_PROVIDER_ID);
  assert.equal(redirectReport.reasonCode, 'runtime.weibo_readonly_auth_or_redirect_required');
  assert.equal(redirectReport.sideEffectFailed, true);

  const authRequiredContract = {
    ...executionContract,
    authRequirement: {
      required: true,
      mode: 'session_handle',
      scopes: [
        {
          origin: 'https://s.weibo.com',
          operations: ['read', 'query'],
          resources: ['/weibo'],
        },
      ],
      material: {
        allowedTypes: ['cookie'],
        injectionTarget: 'http_request',
      },
      policy: {
        requireGovernanceGate: true,
        allowCredentialForwarding: false,
        allowRawHeaderAudit: false,
        allowRawCookieAudit: false,
        allowRawBodyAudit: false,
      },
    },
  };
  const authMissingReport = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract: authRequiredContract,
    runtimeContext: {
      slotValues: { query: 'openai' },
      fetchImpl: async () => {
        throw new Error('auth gate should block before fetch');
      },
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });
  assert.equal(authMissingReport.status, 'blocked');
  assert.equal(authMissingReport.providerId, WEIBO_READONLY_PROVIDER_ID);
  assert.equal(authMissingReport.reasonCode, 'runtime.auth_session_missing');
  assert.equal(authMissingReport.providerInvoked, false);
  assert.equal(authMissingReport.sideEffectAttempted, false);
});

test('weibo_readonly_provider rejects 2xx auth challenge and unverifiable result pages', async () => {
  const baseExecution = {
    invocationRequest: createRequest({
      capabilityId: 'capability:weibo.com-a7b18273:search-posts',
      executionContractRef: 'execution-contract:weibo.com-a7b18273:search-posts',
      policyDecisionRef: 'policy:weibo.com-a7b18273:search-posts',
    }),
    policyDecision: createPolicy({
      capabilityId: 'capability:weibo.com-a7b18273:search-posts',
      executionContractRef: 'execution-contract:weibo.com-a7b18273:search-posts',
    }),
    executionContract: {
      capabilityId: 'capability:weibo.com-a7b18273:search-posts',
      operationKind: 'navigate',
      runtimeBinding: { kind: 'public_http', providerId: null },
      payloadTemplate: {
        slotBindings: [{ name: 'query', type: 'string', required: true }],
      },
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  };

  const challengeReport = await executeRuntimeInvocation({
    ...baseExecution,
    runtimeContext: {
      slotValues: { query: 'openai' },
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        headers: { get: () => 'text/html; charset=utf-8' },
        text: async () => '<html><title>登录</title><a href="https://passport.weibo.com/">请先登录</a><div>安全验证</div></html>',
      }),
    },
  });
  assert.equal(challengeReport.status, 'failed');
  assert.equal(challengeReport.reasonCode, 'runtime.weibo_readonly_auth_or_challenge_required');
  assert.equal(challengeReport.resultSummary.response.bodySummary.authOrChallengeSignals > 0, true);
  assertSafeReport(challengeReport);

  const unverifiedReport = await executeRuntimeInvocation({
    ...baseExecution,
    runtimeContext: {
      slotValues: { query: 'openai' },
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        headers: { get: () => 'text/html; charset=utf-8' },
        text: async () => '<html><main>plain shell</main></html>',
      }),
    },
  });
  assert.equal(unverifiedReport.status, 'failed');
  assert.equal(unverifiedReport.reasonCode, 'runtime.weibo_readonly_unverified_result_state');
  assert.equal(unverifiedReport.resultSummary.response.bodySummary.resultStateVerified, false);
  assertSafeReport(unverifiedReport);
});

test('weibo_readonly_provider executes followed-users read with uid slot and sanitized summary', async () => {
  const request = createRequest({
    capabilityId: 'capability:weibo.com-a7b18273:read-followed-users',
    executionContractRef: 'execution-contract:weibo.com-a7b18273:read-followed-users',
    policyDecisionRef: 'policy:weibo.com-a7b18273:read-followed-users',
  });
  const policyDecision = createPolicy({
    capabilityId: 'capability:weibo.com-a7b18273:read-followed-users',
    executionContractRef: 'execution-contract:weibo.com-a7b18273:read-followed-users',
  });
  const executionContract = {
    capabilityId: 'capability:weibo.com-a7b18273:read-followed-users',
    operationKind: 'navigate',
    runtimeBinding: { kind: 'public_http', providerId: null },
    payloadTemplate: {
      slotBindings: [
        { name: 'uid', type: 'string', required: true },
        { name: 'page', type: 'number', required: false },
      ],
    },
  };

  const fetchCalls = [];
  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract,
    runtimeContext: {
      siteKey: 'weibo',
      slotValues: { uid: '1234567890', page: 2 },
      fetchImpl: async (url, init) => {
        fetchCalls.push({ url, method: init?.method });
        return {
          status: 200,
          ok: true,
          headers: { get: () => 'application/json; charset=utf-8' },
          json: async () => ({
            ok: 1,
            total_number: 2,
            users: [
              { idstr: '2222222222' },
              { id: 3333333333 },
            ],
          }),
        };
      },
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(report.status, 'completed');
  assert.equal(report.providerId, WEIBO_READONLY_PROVIDER_ID);
  assert.equal(report.resultSummary.outcome, 'weibo_followed_users_read_completed');
  assert.equal(report.resultSummary.response.bodySummary.followedUserIdCount, 2);
  assert.deepEqual(report.resultSummary.response.bodySummary.followedUserIds, ['2222222222', '3333333333']);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].method, 'GET');
  assert.match(fetchCalls[0].url, /^https:\/\/weibo\.com\/ajax\/friendships\/friends\?uid=1234567890&page=2$/u);
  assertSafeReport(report);

  const missingUidReport = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract,
    runtimeContext: {
      siteKey: 'weibo',
      slotValues: {},
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });
  assert.equal(missingUidReport.status, 'provider_not_executable');
  assert.equal(missingUidReport.providerId, WEIBO_READONLY_PROVIDER_ID);
  assert.equal(missingUidReport.blockedReason, 'runtime.missing_required_uid_slot');
});

test('weibo_readonly_provider executes hot-search and hourly hot-rank APIs with sanitized JSON summaries', async () => {
  const basePolicy = createPolicy({
    capabilityId: 'capability:weibo.com-a7b18273:hot-search',
    executionContractRef: 'execution-contract:weibo.com-a7b18273:hot-search',
  });
  const hotSearchReport = await executeRuntimeInvocation({
    invocationRequest: createRequest({
      capabilityId: 'capability:weibo.com-a7b18273:hot-search',
      executionContractRef: 'execution-contract:weibo.com-a7b18273:hot-search',
      policyDecisionRef: 'policy:weibo.com-a7b18273:hot-search',
    }),
    policyDecision: basePolicy,
    executionContract: {
      capabilityId: 'capability:weibo.com-a7b18273:hot-search',
      operationKind: 'read',
      runtimeBinding: { kind: 'api', providerId: WEIBO_READONLY_PROVIDER_ID },
    },
    runtimeContext: {
      siteKey: 'weibo',
      fetchImpl: async (url, init) => {
        assert.equal(init?.method, 'GET');
        assert.equal(url, 'https://weibo.com/ajax/side/hotSearch');
        return {
          status: 200,
          ok: true,
          headers: { get: () => 'application/json; charset=utf-8' },
          json: async () => ({
            ok: 1,
            data: {
              realtime: [
                { note: '高考', num: 12345, category: '社会' },
                { note: '天气', num: 6789 },
              ],
            },
          }),
        };
      },
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(hotSearchReport.status, 'completed');
  assert.equal(hotSearchReport.providerId, WEIBO_READONLY_PROVIDER_ID);
  assert.equal(hotSearchReport.resultSummary.outcome, 'weibo_hot_search_api_read_completed');
  assert.equal(hotSearchReport.resultSummary.response.bodySummary.itemCount, 2);
  assert.equal(hotSearchReport.resultSummary.response.bodySummary.items[0].label, '高考');
  assertSafeReport(hotSearchReport);

  const hotRankReport = await executeRuntimeInvocation({
    invocationRequest: createRequest({
      capabilityId: 'capability:weibo.com-a7b18273:hot-rank-hour',
      executionContractRef: 'execution-contract:weibo.com-a7b18273:hot-rank-hour',
      policyDecisionRef: 'policy:weibo.com-a7b18273:hot-rank-hour',
    }),
    policyDecision: createPolicy({
      capabilityId: 'capability:weibo.com-a7b18273:hot-rank-hour',
      executionContractRef: 'execution-contract:weibo.com-a7b18273:hot-rank-hour',
    }),
    executionContract: {
      capabilityId: 'capability:weibo.com-a7b18273:hot-rank-hour',
      operationKind: 'read',
      runtimeBinding: { kind: 'api', providerId: WEIBO_READONLY_PROVIDER_ID },
    },
    runtimeContext: {
      siteKey: 'weibo',
      fetchImpl: async (url, init) => {
        assert.equal(init?.method, 'GET');
        assert.equal(url, 'https://weibo.com/ajax/statuses/hot_band');
        return {
          status: 200,
          ok: true,
          headers: { get: () => 'application/json; charset=utf-8' },
          json: async () => ({
            ok: 1,
            data: {
              band_list: [
                { word: '小时榜话题', realpos: 1, hot_num: 999 },
              ],
            },
          }),
        };
      },
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(hotRankReport.status, 'completed');
  assert.equal(hotRankReport.providerId, WEIBO_READONLY_PROVIDER_ID);
  assert.equal(hotRankReport.resultSummary.outcome, 'weibo_hot_rank_hour_api_read_completed');
  assert.equal(hotRankReport.resultSummary.response.bodySummary.itemCount, 1);
  assert.equal(hotRankReport.resultSummary.response.bodySummary.items[0].label, '小时榜话题');
  assertSafeReport(hotRankReport);

  const hotTimelineReport = await executeRuntimeInvocation({
    invocationRequest: createRequest({
      capabilityId: 'capability:weibo.com-a7b18273:hot-timeline',
      executionContractRef: 'execution-contract:weibo.com-a7b18273:hot-timeline',
      policyDecisionRef: 'policy:weibo.com-a7b18273:hot-timeline',
    }),
    policyDecision: createPolicy({
      capabilityId: 'capability:weibo.com-a7b18273:hot-timeline',
      executionContractRef: 'execution-contract:weibo.com-a7b18273:hot-timeline',
    }),
    executionContract: {
      capabilityId: 'capability:weibo.com-a7b18273:hot-timeline',
      operationKind: 'read',
      runtimeBinding: { kind: 'api', providerId: WEIBO_READONLY_PROVIDER_ID },
    },
    runtimeContext: {
      siteKey: 'weibo',
      fetchImpl: async (url, init) => {
        assert.equal(init?.method, 'GET');
        const parsed = new URL(url);
        assert.equal(`${parsed.origin}${parsed.pathname}`, 'https://weibo.com/ajax/feed/hottimeline');
        assert.equal(parsed.searchParams.get('group_id'), '102803');
        assert.equal(parsed.searchParams.get('containerid'), '102803');
        assert.equal(parsed.searchParams.get('count'), '10');
        return {
          status: 200,
          ok: true,
          headers: { get: () => 'application/json; charset=utf-8' },
          json: async () => ({
            ok: 1,
            statuses: [
              { idstr: 'timeline-1', text_raw: '热门微博内容摘要', user: { idstr: '1234567890' }, comments_count: 12 },
            ],
            total_number: 1,
          }),
        };
      },
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(hotTimelineReport.status, 'completed');
  assert.equal(hotTimelineReport.providerId, WEIBO_READONLY_PROVIDER_ID);
  assert.equal(hotTimelineReport.resultSummary.outcome, 'weibo_hot_timeline_api_read_completed');
  assert.equal(hotTimelineReport.resultSummary.response.bodySummary.itemCount, 1);
  assert.equal(hotTimelineReport.resultSummary.response.bodySummary.items[0].label, '热门微博内容摘要');
  assertSafeReport(hotTimelineReport);

  const hotRankWeekReport = await executeRuntimeInvocation({
    invocationRequest: createRequest({
      capabilityId: 'capability:weibo.com-a7b18273:hot-rank-week',
      executionContractRef: 'execution-contract:weibo.com-a7b18273:hot-rank-week',
      policyDecisionRef: 'policy:weibo.com-a7b18273:hot-rank-week',
    }),
    policyDecision: createPolicy({
      capabilityId: 'capability:weibo.com-a7b18273:hot-rank-week',
      executionContractRef: 'execution-contract:weibo.com-a7b18273:hot-rank-week',
    }),
    executionContract: {
      capabilityId: 'capability:weibo.com-a7b18273:hot-rank-week',
      operationKind: 'read',
      runtimeBinding: { kind: 'api', providerId: WEIBO_READONLY_PROVIDER_ID },
    },
    runtimeContext: {
      siteKey: 'weibo',
      fetchImpl: async (url, init) => {
        assert.equal(init?.method, 'GET');
        const parsed = new URL(url);
        assert.equal(`${parsed.origin}${parsed.pathname}`, 'https://weibo.com/ajax/feed/hottimeline');
        assert.equal(parsed.searchParams.get('group_id'), '102803');
        assert.equal(parsed.searchParams.get('ranking_type'), 'week');
        return {
          status: 200,
          ok: true,
          headers: { get: () => 'application/json; charset=utf-8' },
          json: async () => ({
            ok: 1,
            statuses: [
              { idstr: 'rank-week-1', text_raw: 'weekly hot rank fixture', user: { idstr: '1234567890' }, comments_count: 12 },
            ],
            total_number: 1,
          }),
        };
      },
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(hotRankWeekReport.status, 'completed');
  assert.equal(hotRankWeekReport.providerId, WEIBO_READONLY_PROVIDER_ID);
  assert.equal(hotRankWeekReport.resultSummary.outcome, 'weibo_hot_rank_week_api_read_completed');
  assert.equal(hotRankWeekReport.resultSummary.request.pathTemplate, '/ajax/feed/hottimeline?group_id=102803&containerid=102803&count=10&ranking_type=week');
  assert.equal(hotRankWeekReport.resultSummary.response.bodySummary.itemCount, 1);
  assert.equal(hotRankWeekReport.resultSummary.response.bodySummary.items[0].label, 'weekly hot rank fixture');
  assertSafeReport(hotRankWeekReport);
});

test('weibo_readonly_provider executes user posts API with sanitized item summaries', async () => {
  const report = await executeRuntimeInvocation({
    invocationRequest: createRequest({
      capabilityId: 'capability:weibo.com-a7b18273:user-posts',
      executionContractRef: 'execution-contract:weibo.com-a7b18273:user-posts',
      policyDecisionRef: 'policy:weibo.com-a7b18273:user-posts',
    }),
    policyDecision: createPolicy({
      capabilityId: 'capability:weibo.com-a7b18273:user-posts',
      executionContractRef: 'execution-contract:weibo.com-a7b18273:user-posts',
    }),
    executionContract: {
      capabilityId: 'capability:weibo.com-a7b18273:user-posts',
      operationKind: 'read',
      runtimeBinding: { kind: 'api', providerId: WEIBO_READONLY_PROVIDER_ID },
      payloadTemplate: {
        slotBindings: [{ name: 'uid', type: 'string', required: true }],
      },
    },
    runtimeContext: {
      siteKey: 'weibo',
      slotValues: { uid: '1234567890', page: 1 },
      fetchImpl: async (url, init) => {
        assert.equal(init?.method, 'GET');
        assert.equal(url, 'https://weibo.com/ajax/statuses/mymblog?uid=1234567890&page=1&feature=0');
        return {
          status: 200,
          ok: true,
          headers: { get: () => 'application/json; charset=utf-8' },
          json: async () => ({
            ok: 1,
            data: {
              list: [
                {
                  idstr: 'post-1',
                  created_at: 'Tue Jun 09 12:00:00 +0800 2026',
                  text_raw: '这是一条用于测试的微博内容摘要，不应作为原始正文长文本落盘。',
                  reposts_count: 1,
                  comments_count: 2,
                  attitudes_count: 3,
                },
              ],
            },
          }),
        };
      },
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(report.status, 'completed');
  assert.equal(report.providerId, WEIBO_READONLY_PROVIDER_ID);
  assert.equal(report.resultSummary.outcome, 'weibo_user_posts_api_read_completed');
  assert.equal(report.resultSummary.response.bodySummary.itemCount, 1);
  assert.equal(report.resultSummary.response.bodySummary.items[0].id, 'post-1');
  assert.equal(report.resultSummary.response.bodySummary.items[0].comments, 2);
  assertSafeReport(report);
});

test('weibo_readonly_provider executes user articles API with sanitized item summaries', async () => {
  const report = await executeRuntimeInvocation({
    invocationRequest: createRequest({
      capabilityId: 'capability:weibo.com-a7b18273:user-articles',
      executionContractRef: 'execution-contract:weibo.com-a7b18273:user-articles',
      policyDecisionRef: 'policy:weibo.com-a7b18273:user-articles',
    }),
    policyDecision: createPolicy({
      capabilityId: 'capability:weibo.com-a7b18273:user-articles',
      executionContractRef: 'execution-contract:weibo.com-a7b18273:user-articles',
    }),
    executionContract: {
      capabilityId: 'capability:weibo.com-a7b18273:user-articles',
      operationKind: 'read',
      runtimeBinding: { kind: 'api', providerId: WEIBO_READONLY_PROVIDER_ID },
      payloadTemplate: {
        slotBindings: [{ name: 'uid', type: 'string', required: true }],
      },
    },
    runtimeContext: {
      siteKey: 'weibo',
      slotValues: { uid: '1234567890', page: 1 },
      fetchImpl: async (url, init) => {
        assert.equal(init?.method, 'GET');
        assert.equal(url, 'https://weibo.com/ajax/statuses/mymblog?uid=1234567890&page=1&feature=7');
        return {
          status: 200,
          ok: true,
          headers: { get: () => 'application/json; charset=utf-8' },
          json: async () => ({
            ok: 1,
            data: {
              list: [
                {
                  idstr: 'article-post-1',
                  text_raw: 'sanitized article summary https://example.invalid/article-should-not-persist',
                  page_info: {
                    object_type: 'article',
                    page_title: 'sanitized article title',
                    page_url: 'https://example.invalid/page-should-not-persist',
                  },
                },
                {
                  idstr: 'live-post-1',
                  text_raw: 'sanitized live fixture',
                  page_info: {
                    object_type: 'live',
                  },
                },
              ],
            },
          }),
        };
      },
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(report.status, 'completed');
  assert.equal(report.providerId, WEIBO_READONLY_PROVIDER_ID);
  assert.equal(report.resultSummary.outcome, 'weibo_user_articles_api_read_completed');
  assert.equal(report.resultSummary.response.bodySummary.itemCount, 2);
  assert.equal(report.resultSummary.response.bodySummary.articleItemCount, 1);
  assert.equal(report.resultSummary.response.bodySummary.items[0].id, 'article-post-1');
  assert.equal(report.resultSummary.response.bodySummary.items[0].textSummary.includes('[url]'), true);
  assert.doesNotMatch(JSON.stringify(report), /article-should-not-persist|page-should-not-persist/u);
  assertSafeReport(report);
});

test('weibo_readonly_provider executes user audio API with verified empty-list summary', async () => {
  const report = await executeRuntimeInvocation({
    invocationRequest: createRequest({
      capabilityId: 'capability:weibo.com-a7b18273:user-audio',
      executionContractRef: 'execution-contract:weibo.com-a7b18273:user-audio',
      policyDecisionRef: 'policy:weibo.com-a7b18273:user-audio',
    }),
    policyDecision: createPolicy({
      capabilityId: 'capability:weibo.com-a7b18273:user-audio',
      executionContractRef: 'execution-contract:weibo.com-a7b18273:user-audio',
    }),
    executionContract: {
      capabilityId: 'capability:weibo.com-a7b18273:user-audio',
      operationKind: 'read',
      runtimeBinding: { kind: 'api', providerId: WEIBO_READONLY_PROVIDER_ID },
      payloadTemplate: {
        slotBindings: [{ name: 'uid', type: 'string', required: true }],
      },
    },
    runtimeContext: {
      siteKey: 'weibo',
      slotValues: { uid: '1234567890' },
      fetchImpl: async (url, init) => {
        assert.equal(init?.method, 'GET');
        assert.equal(url, 'https://weibo.com/ajax/profile/getAudioList?profile_uid=1234567890&cursor=0');
        return {
          status: 200,
          ok: true,
          headers: { get: () => 'application/json; charset=utf-8' },
          json: async () => ({
            ok: 1,
            data: {
              list: [],
              next_cursor: 0,
            },
          }),
        };
      },
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(report.status, 'completed');
  assert.equal(report.providerId, WEIBO_READONLY_PROVIDER_ID);
  assert.equal(report.resultSummary.outcome, 'weibo_user_audio_api_read_completed');
  assert.equal(report.resultSummary.response.bodySummary.matchedArrayPath, 'data.list');
  assert.equal(report.resultSummary.response.bodySummary.itemCount, 0);
  assert.equal(report.resultSummary.response.bodySummary.emptyStatePresent, true);
  assert.equal(report.resultSummary.response.bodySummary.resultStateVerified, true);
  assertSafeReport(report);
});

test('weibo_readonly_provider executes user albums and videos APIs with sanitized summaries', async () => {
  const albumsReport = await executeRuntimeInvocation({
    invocationRequest: createRequest({
      capabilityId: 'capability:weibo.com-a7b18273:user-albums',
      executionContractRef: 'execution-contract:weibo.com-a7b18273:user-albums',
      policyDecisionRef: 'policy:weibo.com-a7b18273:user-albums',
    }),
    policyDecision: createPolicy({
      capabilityId: 'capability:weibo.com-a7b18273:user-albums',
      executionContractRef: 'execution-contract:weibo.com-a7b18273:user-albums',
    }),
    executionContract: {
      capabilityId: 'capability:weibo.com-a7b18273:user-albums',
      operationKind: 'read',
      runtimeBinding: { kind: 'api', providerId: WEIBO_READONLY_PROVIDER_ID },
      payloadTemplate: {
        slotBindings: [{ name: 'uid', type: 'string', required: true }],
      },
    },
    runtimeContext: {
      siteKey: 'weibo',
      slotValues: { uid: '1234567890', page: 1 },
      fetchImpl: async (url, init) => {
        assert.equal(init?.method, 'GET');
        assert.equal(url, 'https://photo.weibo.com/photos/get_all?uid=1234567890&page=1&count=30');
        return {
          status: 200,
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({
            code: 'A00006',
            data: {
              photo_list: [
                {
                  photo_id: 'photo-1',
                  album_id: 'album-1',
                  feed_id: 'feed-1',
                  caption: 'sanitized album caption fixture',
                  pic_host: 'https://example.invalid/raw-should-not-persist',
                  pic_name: 'raw-name-should-not-persist',
                },
              ],
            },
          }),
        };
      },
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(albumsReport.status, 'completed');
  assert.equal(albumsReport.providerId, WEIBO_READONLY_PROVIDER_ID);
  assert.equal(albumsReport.resultSummary.outcome, 'weibo_user_albums_api_read_completed');
  assert.equal(albumsReport.resultSummary.response.bodySummary.itemCount, 1);
  assert.equal(albumsReport.resultSummary.response.bodySummary.items[0].id, 'photo-1');
  assert.doesNotMatch(JSON.stringify(albumsReport), /raw-should-not-persist/u);
  assertSafeReport(albumsReport);

  const videosReport = await executeRuntimeInvocation({
    invocationRequest: createRequest({
      capabilityId: 'capability:weibo.com-a7b18273:user-videos',
      executionContractRef: 'execution-contract:weibo.com-a7b18273:user-videos',
      policyDecisionRef: 'policy:weibo.com-a7b18273:user-videos',
    }),
    policyDecision: createPolicy({
      capabilityId: 'capability:weibo.com-a7b18273:user-videos',
      executionContractRef: 'execution-contract:weibo.com-a7b18273:user-videos',
    }),
    executionContract: {
      capabilityId: 'capability:weibo.com-a7b18273:user-videos',
      operationKind: 'read',
      runtimeBinding: { kind: 'api', providerId: WEIBO_READONLY_PROVIDER_ID },
      payloadTemplate: {
        slotBindings: [{ name: 'uid', type: 'string', required: true }],
      },
    },
    runtimeContext: {
      siteKey: 'weibo',
      slotValues: { uid: '1234567890', page: 1 },
      fetchImpl: async (url, init) => {
        assert.equal(init?.method, 'GET');
        assert.equal(url, 'https://weibo.com/ajax/statuses/mymblog?uid=1234567890&page=1&feature=3');
        return {
          status: 200,
          ok: true,
          headers: { get: () => 'application/json; charset=utf-8' },
          json: async () => ({
            ok: 1,
            data: {
              list: [
                {
                  idstr: 'video-post-1',
                  text_raw: 'sanitized video post fixture',
                  page_info: {
                    type: '11',
                    media_info: {
                      duration: 60,
                      stream_url: 'https://example.invalid/video-should-not-persist',
                    },
                  },
                },
              ],
            },
          }),
        };
      },
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(videosReport.status, 'completed');
  assert.equal(videosReport.providerId, WEIBO_READONLY_PROVIDER_ID);
  assert.equal(videosReport.resultSummary.outcome, 'weibo_user_videos_api_read_completed');
  assert.equal(videosReport.resultSummary.response.bodySummary.videoItemCount, 1);
  assert.equal(videosReport.resultSummary.response.bodySummary.items[0].durationSeconds, 60);
  assert.doesNotMatch(JSON.stringify(videosReport), /video-should-not-persist/u);
  assertSafeReport(videosReport);
});

test('weibo_readonly_provider production manifest declares auth adapter cookie injection', () => {
  const provider = createProductionRuntimeProviders()
    .find((entry) => entry.providerId === WEIBO_READONLY_PROVIDER_ID);

  assert.ok(provider, 'weibo provider should be registered');
  assert.equal(provider.manifest?.riskProfile?.requiresAuthAdapter, true);
  assert.deepEqual(provider.manifest?.riskProfile?.allowedAuthMaterialTypes, ['ephemeral-http-auth']);
  assert.deepEqual(provider.manifest?.riskProfile?.allowedInjectionTargets, ['http_request']);
  assert.equal(provider.manifest?.runtimeServices?.requiresNetwork, true);
  assert.equal(provider.manifest?.resultPolicy?.allowRawCookies, false);
});

test('zhihu_readonly_provider executes search posts with sanitized HTTP summary and required query slot', async () => {
  const provider = createZhihuReadonlyProvider();
  const descriptor = {
    invocationRequest: {
      capabilityId: 'capability:www.zhihu.com:search-posts',
    },
    executionContract: {
      capabilityId: 'capability:www.zhihu.com:search-posts',
      operationKind: 'query',
      runtimeBinding: {
        kind: 'public_http',
      },
    },
    runtimeContext: {
      siteKey: 'zhihu',
      siteHost: 'www.zhihu.com',
      slotValues: {
        query: 'siteforge',
      },
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        headers: { get: () => 'text/html; charset=utf-8' },
        text: async () => '<html><div class="SearchResult"></div><div class="ContentItem"></div></html>',
      }),
    },
  };

  assert.equal(provider.supports(descriptor), true);
  assert.deepEqual(provider.canExecute(descriptor), { allowed: true });

  const report = await provider.run(descriptor);
  assert.equal(report.status, 'completed');
  assert.equal(report.providerId, ZHIHU_READONLY_PROVIDER_ID);
  assert.equal(report.resultSummary.outcome, 'zhihu_search_read_completed');
  assert.equal(report.resultSummary.response.bodySummary.resultContainerSignals, 2);
  assert.doesNotMatch(JSON.stringify(report), /SearchResult|ContentItem|set-cookie|Authorization|rawResponseBody|browserProfilePath/iu);

  const missingSlot = provider.canExecute({
    ...descriptor,
    runtimeContext: {
      ...descriptor.runtimeContext,
      slotValues: {},
    },
  });
  assert.equal(missingSlot.allowed, false);
  assert.equal(missingSlot.reasonCode, 'runtime.missing_required_slot');
});

test('zhihu_readonly_provider executes hot and detail reads with sanitized summaries', async () => {
  const provider = createZhihuReadonlyProvider();
  const fetchCalls = [];
  const fetchImpl = async (url) => {
    fetchCalls.push(url);
    return {
      status: 200,
      ok: true,
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => '<html><div class="QuestionItem"></div><div class="AnswerItem"></div><div class="ContentItem"></div></html>',
    };
  };
  const baseDescriptor = {
    executionContract: {
      operationKind: 'read',
      runtimeBinding: {
        kind: 'public_http',
      },
    },
    runtimeContext: {
      siteKey: 'zhihu',
      siteHost: 'www.zhihu.com',
      fetchImpl,
    },
  };

  const hotReport = await provider.run({
    ...baseDescriptor,
    invocationRequest: { capabilityId: 'capability:www.zhihu.com:list-hot-posts' },
    executionContract: {
      ...baseDescriptor.executionContract,
      capabilityId: 'capability:www.zhihu.com:list-hot-posts',
    },
  });
  assert.equal(hotReport.status, 'completed');
  assert.equal(hotReport.resultSummary.outcome, 'zhihu_hot_posts_read_completed');
  assert.equal(hotReport.resultSummary.request.pathTemplate, '/hot');

  const hotBroadcastReport = await provider.run({
    ...baseDescriptor,
    invocationRequest: { capabilityId: 'capability:www.zhihu.com:list-hot-broadcasts' },
    executionContract: {
      ...baseDescriptor.executionContract,
      capabilityId: 'capability:www.zhihu.com:list-hot-broadcasts',
    },
  });
  assert.equal(hotBroadcastReport.status, 'completed');
  assert.equal(hotBroadcastReport.resultSummary.outcome, 'zhihu_hot_broadcasts_read_completed');
  assert.equal(hotBroadcastReport.resultSummary.request.pathTemplate, '/drama/feed');

  const topicReport = await provider.run({
    ...baseDescriptor,
    invocationRequest: { capabilityId: 'capability:www.zhihu.com:list-topic-discussions' },
    executionContract: {
      ...baseDescriptor.executionContract,
      capabilityId: 'capability:www.zhihu.com:list-topic-discussions',
    },
    runtimeContext: {
      ...baseDescriptor.runtimeContext,
      slotValues: { topic_id: '19607535' },
    },
  });
  assert.equal(topicReport.status, 'completed');
  assert.equal(topicReport.resultSummary.outcome, 'zhihu_topic_discussions_read_completed');
  assert.equal(topicReport.resultSummary.request.pathTemplate, '/topic/{topic_id}/hot');
  assert.equal(topicReport.resultSummary.request.topicSlotUsed, true);

  const userAnswersReport = await provider.run({
    ...baseDescriptor,
    invocationRequest: { capabilityId: 'capability:www.zhihu.com:list-user-answers' },
    executionContract: {
      ...baseDescriptor.executionContract,
      capabilityId: 'capability:www.zhihu.com:list-user-answers',
    },
    runtimeContext: {
      ...baseDescriptor.runtimeContext,
      slotValues: { account: 'zhihuadmin' },
    },
  });
  assert.equal(userAnswersReport.status, 'completed');
  assert.equal(userAnswersReport.resultSummary.outcome, 'zhihu_user_answers_read_completed');
  assert.equal(userAnswersReport.resultSummary.request.pathTemplate, '/people/{account}/answers');
  assert.equal(userAnswersReport.resultSummary.request.accountSlotUsed, true);

  const questionReport = await provider.run({
    ...baseDescriptor,
    invocationRequest: { capabilityId: 'capability:www.zhihu.com:view-question-detail' },
    executionContract: {
      ...baseDescriptor.executionContract,
      capabilityId: 'capability:www.zhihu.com:view-question-detail',
    },
    runtimeContext: {
      ...baseDescriptor.runtimeContext,
      slotValues: { question_id: '19550228' },
    },
  });
  assert.equal(questionReport.status, 'completed');
  assert.equal(questionReport.resultSummary.outcome, 'zhihu_question_detail_read_completed');
  assert.equal(questionReport.resultSummary.request.pathTemplate, '/question/{question_id}');

  const answerReport = await provider.run({
    ...baseDescriptor,
    invocationRequest: { capabilityId: 'capability:www.zhihu.com:view-answer-detail' },
    executionContract: {
      ...baseDescriptor.executionContract,
      capabilityId: 'capability:www.zhihu.com:view-answer-detail',
    },
    runtimeContext: {
      ...baseDescriptor.runtimeContext,
      slotValues: { question_id: '19550228', answer_id: '25354498' },
    },
  });
  assert.equal(answerReport.status, 'completed');
  assert.equal(answerReport.resultSummary.outcome, 'zhihu_answer_detail_read_completed');
  assert.equal(answerReport.resultSummary.request.pathTemplate, '/question/{question_id}/answer/{answer_id}');

  const missingQuestion = provider.canExecute({
    ...baseDescriptor,
    invocationRequest: { capabilityId: 'capability:www.zhihu.com:view-question-detail' },
    executionContract: {
      ...baseDescriptor.executionContract,
      capabilityId: 'capability:www.zhihu.com:view-question-detail',
    },
  });
  assert.equal(missingQuestion.allowed, false);
  assert.equal(missingQuestion.reasonCode, 'runtime.missing_required_question_slot');
  const missingAnswer = provider.canExecute({
    ...baseDescriptor,
    invocationRequest: { capabilityId: 'capability:www.zhihu.com:view-answer-detail' },
    executionContract: {
      ...baseDescriptor.executionContract,
      capabilityId: 'capability:www.zhihu.com:view-answer-detail',
    },
    runtimeContext: {
      ...baseDescriptor.runtimeContext,
      slotValues: { question_id: '19550228' },
    },
  });
  assert.equal(missingAnswer.allowed, false);
  assert.equal(missingAnswer.reasonCode, 'runtime.missing_required_answer_slot');
  const missingTopic = provider.canExecute({
    ...baseDescriptor,
    invocationRequest: { capabilityId: 'capability:www.zhihu.com:list-topic-featured' },
    executionContract: {
      ...baseDescriptor.executionContract,
      capabilityId: 'capability:www.zhihu.com:list-topic-featured',
    },
  });
  assert.equal(missingTopic.allowed, false);
  assert.equal(missingTopic.reasonCode, 'runtime.missing_required_topic_slot');
  const missingUserAccount = provider.canExecute({
    ...baseDescriptor,
    invocationRequest: { capabilityId: 'capability:www.zhihu.com:list-user-following' },
    executionContract: {
      ...baseDescriptor.executionContract,
      capabilityId: 'capability:www.zhihu.com:list-user-following',
    },
  });
  assert.equal(missingUserAccount.allowed, false);
  assert.equal(missingUserAccount.reasonCode, 'runtime.missing_required_account_slot');
  assert.equal(fetchCalls.some((url) => String(url).includes('/answer/25354498')), true);
  assert.equal(fetchCalls.some((url) => String(url).includes('/hot')), true);
  assert.equal(fetchCalls.some((url) => String(url).includes('/drama/feed')), true);
  assert.equal(fetchCalls.some((url) => String(url).includes('/topic/19607535/hot')), true);
  assert.equal(fetchCalls.some((url) => String(url).includes('/people/zhihuadmin/answers')), true);
  assert.equal(fetchCalls.some((url) => String(url).includes('/question/19550228')), true);
  assert.doesNotMatch(JSON.stringify([hotReport, hotBroadcastReport, topicReport, userAnswersReport, questionReport, answerReport]), /QuestionItem|AnswerItem|ContentItem|set-cookie|Authorization|rawResponseBody/iu);
});

test('zhihu_readonly_provider rejects bulk answer export without local artifacts', async () => {
  const provider = createZhihuReadonlyProvider();
  let fetchCalled = false;
  const descriptor = {
    invocationRequest: { capabilityId: 'capability:www.zhihu.com:view-question-detail' },
    executionContract: {
      capabilityId: 'capability:www.zhihu.com:view-question-detail',
      operationKind: 'read',
      runtimeBinding: {
        kind: 'public_http',
      },
    },
    runtimeContext: {
      siteKey: 'zhihu',
      siteHost: 'www.zhihu.com',
      executionTask: '所有回答导出本地',
      slotValues: { question_id: '2047442402122495550' },
      fetchImpl: async () => {
        fetchCalled = true;
        return {
          status: 200,
          ok: true,
          headers: { get: () => 'text/html; charset=utf-8' },
          text: async () => '<html><div class="AnswerItem">LONG_ANSWER_BODY_SHOULD_NOT_LEAK</div></html>',
        };
      },
    },
  };

  assert.equal(provider.supports(descriptor), true);
  assert.deepEqual(provider.canExecute(descriptor), {
    allowed: false,
    reasonCode: 'runtime.zhihu_answer_export_disallowed',
  });

  const report = await provider.run(descriptor);
  assert.equal(fetchCalled, false);
  assert.equal(report.status, 'failed');
  assert.equal(report.providerId, ZHIHU_READONLY_PROVIDER_ID);
  assert.equal(report.reasonCode, 'runtime.zhihu_answer_export_disallowed');
  assert.equal(report.runtimeExecuted, true);
  assert.equal(report.sideEffectAttempted, false);
  assert.equal(report.resultSummary.runtimeMode, 'zhihu_answer_export_guard_v1');
  assert.equal(report.resultSummary.responseMaterial, 'sanitized_summary_only');
  assert.equal(report.resultSummary.requestedSurface, 'zhihu_question_answers');
  assert.equal(report.resultSummary.contentPersistence, 'disallowed');
  assert.equal(report.resultSummary.localArtifactCreation, 'not_attempted');
  assert.deepEqual(report.resultSummary.artifactRefs, []);
  assertSafeReport(report);
  assert.doesNotMatch(JSON.stringify(report), /LONG_ANSWER_BODY_SHOULD_NOT_LEAK|AnswerItem|rawResponseBody|localIndex|cache-index|items\.jsonl/iu);

  const constrainedDetailDescriptor = {
    ...descriptor,
    runtimeContext: {
      ...descriptor.runtimeContext,
      executionTask: '不要导出正文，只查看问题详情',
    },
  };
  assert.equal(provider.supports(constrainedDetailDescriptor), true);
  assert.deepEqual(provider.canExecute(constrainedDetailDescriptor), { allowed: true });
});

test('production runtime routes Zhihu bulk answer export to readonly guard, not download provider', async () => {
  const capabilityId = 'capability:www.zhihu.com:view-question-detail';
  const executionContractRef = 'execution-contract:www.zhihu.com:view-question-detail';
  const request = createRequest({
    capabilityId,
    executionContractRef,
    policyDecisionRef: 'policy:www.zhihu.com:view-question-detail',
  });
  const policyDecision = createPolicy({
    capabilityId,
    executionContractRef,
  });
  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract: {
      capabilityId,
      operationKind: 'read',
      runtimeBinding: {
        kind: 'public_http',
      },
    },
    runtimeContext: {
      siteKey: 'zhihu',
      siteHost: 'www.zhihu.com',
      executionTask: '所有回答导出本地',
      slotValues: { question_id: '2047442402122495550' },
      fetchImpl: async () => {
        throw new Error('fetch should not run for guarded answer export');
      },
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(report.status, 'provider_not_executable');
  assert.equal(report.providerId, ZHIHU_READONLY_PROVIDER_ID);
  assert.equal(report.providerKind, 'zhihu_readonly_provider');
  assert.equal(report.blockedReason, 'runtime.zhihu_answer_export_disallowed');
  assert.equal(report.providerInvoked, false);
  assert.equal(report.executionAttempted, false);
  assert.deepEqual(report.artifactRefs, []);
  assertSafeReport(report);
});

test('zhihu_readonly_provider production manifest declares auth adapter cookie injection', () => {
  const provider = createProductionRuntimeProviders()
    .find((entry) => entry.providerId === ZHIHU_READONLY_PROVIDER_ID);

  assert.ok(provider, 'zhihu provider should be registered');
  assert.equal(provider.manifest?.riskProfile?.requiresAuthAdapter, true);
  assert.deepEqual(provider.manifest?.riskProfile?.allowedAuthMaterialTypes, ['ephemeral-http-auth']);
  assert.deepEqual(provider.manifest?.riskProfile?.allowedInjectionTargets, ['http_request']);
  assert.equal(provider.manifest?.runtimeServices?.requiresNetwork, true);
  assert.equal(provider.manifest?.resultPolicy?.allowRawCookies, false);
});

test('weibo_readonly_provider uses auth adapter without persisting request material', async () => {
  const provider = createWeiboReadonlyProvider();
  const fetchCalls = [];
  const report = await provider.run({
    invocationRequest: { capabilityId: 'capability:weibo.com-a7b18273:search-posts' },
    executionContract: {
      capabilityId: 'capability:weibo.com-a7b18273:search-posts',
      operationKind: 'navigate',
      runtimeBinding: { kind: 'public_http' },
    },
    runtimeContext: {
      slotValues: { query: 'openai' },
      fetchImpl: async (url, init) => {
        fetchCalls.push({ url, headers: init?.headers });
        return {
          status: 200,
          ok: true,
          headers: { get: () => 'text/html; charset=utf-8' },
          text: async () => '<main><div class="card-wrap"></div></main>',
        };
      },
    },
    authAdapter: {
      isRequired: () => true,
      applyHttpAuth: async (request) => ({
        ok: true,
        request: {
          ...request,
          headers: { 'x-redacted-fixture-auth': 'fixture' },
        },
        authSummary: {
          required: true,
          used: true,
          outcome: 'applied',
          material: 'sanitized_summary_only',
        },
      }),
    },
  });

  assert.equal(report.status, 'completed');
  assert.equal(report.providerId, WEIBO_READONLY_PROVIDER_ID);
  assert.equal(report.authSummary.used, true);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].headers['x-redacted-fixture-auth'], 'fixture');
  assertSafeReport(report);
});

test('download_provider blocks without approved output gate or policy', async () => {
  const request = createRequest({
    capabilityId: 'capability:synthetic:download-report',
    executionContractRef: 'execution-contract:synthetic-download-report',
    policyDecisionRef: 'policy:synthetic-download-report',
  });
  const policyDecision = createPolicy({
    capabilityId: 'capability:synthetic:download-report',
    executionContractRef: 'execution-contract:synthetic-download-report',
    downloaderInvocationAllowed: true,
    siteAdapterInvocationAllowed: false,
  });

  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract: {
      capabilityKind: 'download',
      operationKind: 'download',
      contractKind: 'download',
      runtimeBindingRef: 'runtime-binding:synthetic-download',
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(report.status, 'provider_not_executable');
  assert.equal(report.providerId, 'download_provider');
  assert.equal(report.providerInvoked, false);
  assert.equal(report.executionAttempted, false);
  assert.equal(report.sideEffectAttempted, false);
  assert.equal(report.blockedReason, 'runtime.download_output_policy_required');
  assertSafeReport(report);
});

test('download_provider writes only controlled artifact output when output gate is satisfied', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'siteforge-controlled-download-'));
  try {
    const request = createRequest({
      capabilityId: 'capability:synthetic:download-report',
      executionContractRef: 'execution-contract:synthetic-download-report',
      policyDecisionRef: 'policy:synthetic-download-report',
      verdictHint: 'controlled',
      requiredGates: ['output_path_required'],
    });
    const gateStatus = {
      allSatisfied: true,
      output_path_required: { satisfied: true },
    };
    const policyDecision = createPolicy({
      capabilityId: 'capability:synthetic:download-report',
      executionContractRef: 'execution-contract:synthetic-download-report',
      verdict: 'controlled',
      gates: ['output_path_required'],
      gateStatus,
      downloaderInvocationAllowed: true,
      siteAdapterInvocationAllowed: false,
    });

    const report = await executeRuntimeInvocation({
      invocationRequest: request,
      policyDecision,
      gateStatus,
      executionContract: {
        capabilityKind: 'download',
        operationKind: 'download',
        contractKind: 'download',
        runtimeBindingRef: 'runtime-binding:synthetic-download',
      },
      runtimeContext: {
        outputDir,
        downloadFilename: 'catalog-export.txt',
        fixtureText: 'controlled fixture export\n',
      },
      providerRegistry: createProductionRuntimeProviderRegistry(),
    });

    const written = await readFile(path.join(outputDir, 'catalog-export.txt'));
    const checksum = createHash('sha256').update(written).digest('hex');
    const download = report.resultSummary.downloads[0];

    assert.equal(report.status, 'completed');
    assert.equal(report.providerId, 'download_provider');
    assert.equal(report.executionAttempted, true);
    assert.equal(report.sideEffectAttempted, true);
    assert.equal(report.sideEffectSucceeded, true);
    assert.deepEqual(report.artifactRefs, ['artifact:runtime-download:catalog-export.txt']);
    assert.equal(download.artifactRef, 'artifact:runtime-download:catalog-export.txt');
    assert.equal(download.filename, 'catalog-export.txt');
    assert.equal(download.hash, checksum);
    assert.equal(download.checksum, checksum);
    assert.equal(download.byteSize, written.byteLength);
    assert.equal(download.mimeType, 'text/plain');
    assertSafeReport(report);
    assert.doesNotMatch(JSON.stringify(report), new RegExp(outputDir.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('download_provider ignores persisted contract inline content', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'siteforge-controlled-download-contract-'));
  try {
    const request = createRequest({
      capabilityId: 'capability:synthetic:download-report',
      executionContractRef: 'execution-contract:synthetic-download-report',
      policyDecisionRef: 'policy:synthetic-download-report',
      verdictHint: 'controlled',
      requiredGates: ['output_path_required'],
    });
    const gateStatus = {
      allSatisfied: true,
      output_path_required: { satisfied: true },
    };
    const policyDecision = createPolicy({
      capabilityId: 'capability:synthetic:download-report',
      executionContractRef: 'execution-contract:synthetic-download-report',
      verdict: 'controlled',
      gates: ['output_path_required'],
      gateStatus,
      downloaderInvocationAllowed: true,
      siteAdapterInvocationAllowed: false,
    });

    const report = await executeRuntimeInvocation({
      invocationRequest: request,
      policyDecision,
      gateStatus,
      executionContract: {
        capabilityKind: 'download',
        operationKind: 'download',
        contractKind: 'download',
        runtimeBindingRef: 'runtime-binding:synthetic-download',
        downloadDescriptor: {
          filename: 'contract-export.txt',
          fixtureText: 'contract inline content must be ignored\n',
        },
      },
      runtimeContext: {
        outputDir,
      },
      providerRegistry: createProductionRuntimeProviderRegistry(),
    });

    const written = await readFile(path.join(outputDir, 'contract-export.txt'), 'utf8');
    assert.equal(report.status, 'completed');
    assert.equal(written, 'SiteForge controlled runtime download fixture\n');
    assert.doesNotMatch(written, /contract inline content/u);
    assertSafeReport(report);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('download_provider rejects path traversal before side effects', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'siteforge-download-traversal-'));
  try {
    const request = createRequest({
      capabilityId: 'capability:synthetic:download-report',
      executionContractRef: 'execution-contract:synthetic-download-report',
      policyDecisionRef: 'policy:synthetic-download-report',
    });
    const policyDecision = createPolicy({
      capabilityId: 'capability:synthetic:download-report',
      executionContractRef: 'execution-contract:synthetic-download-report',
      downloaderInvocationAllowed: true,
      siteAdapterInvocationAllowed: false,
    });

    const report = await executeRuntimeInvocation({
      invocationRequest: request,
      policyDecision,
      executionContract: {
        capabilityKind: 'download',
        operationKind: 'download',
        contractKind: 'download',
        runtimeBindingRef: 'runtime-binding:synthetic-download',
      },
      runtimeContext: {
        outputPolicy: { approved: true },
        outputDir,
        downloadFilename: '../escape.txt',
      },
      providerRegistry: createProductionRuntimeProviderRegistry(),
    });

    assert.equal(report.status, 'provider_not_executable');
    assert.equal(report.providerId, 'download_provider');
    assert.equal(report.executionAttempted, false);
    assert.equal(report.sideEffectAttempted, false);
    assert.equal(report.blockedReason, 'runtime.download_path_traversal_rejected');
    assertSafeReport(report);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('browser_action_provider executes only explicit controlled fixture descriptors', async () => {
  const request = createRequest({
    capabilityId: 'capability:synthetic:submit-contact',
    executionContractRef: 'execution-contract:synthetic-submit-contact',
    policyDecisionRef: 'policy:synthetic-submit-contact',
  });
  const policyDecision = createPolicy({
    capabilityId: 'capability:synthetic:submit-contact',
    executionContractRef: 'execution-contract:synthetic-submit-contact',
  });

  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract: browserActionContract(),
    runtimeContext: {
      localFixture: true,
      slotValues: {
        message: 'private fixture value that must not persist',
      },
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(report.status, 'completed');
  assert.equal(report.providerId, 'browser_action_provider');
  assert.equal(report.providerInvoked, true);
  assert.equal(report.executionAttempted, true);
  assert.equal(report.sideEffectAttempted, true);
  assert.equal(report.sideEffectSucceeded, true);
  assert.equal(report.resultSummary.outcome, 'browser_action_completed');
  assert.equal(report.resultSummary.runtimeMode, 'controlled_fixture_browser_action');
  assert.deepEqual(report.resultSummary.slotNames, ['message']);
  assert.equal(report.resultSummary.actionRef, 'action:fixture-contact-submit');
  assert.equal(report.resultSummary.routeRef, 'route:fixture-contact');
  assert.equal(report.resultSummary.payloadTemplate.material, 'template_only');
  assertSafeReport(report);
});

test('browser_action_provider blocks uncontrolled runtime before side effects', async () => {
  const request = createRequest({
    capabilityId: 'capability:synthetic:submit-contact',
    executionContractRef: 'execution-contract:synthetic-submit-contact',
    policyDecisionRef: 'policy:synthetic-submit-contact',
  });
  const policyDecision = createPolicy({
    capabilityId: 'capability:synthetic:submit-contact',
    executionContractRef: 'execution-contract:synthetic-submit-contact',
  });

  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract: browserActionContract(),
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(report.status, 'provider_not_executable');
  assert.equal(report.providerId, 'browser_action_provider');
  assert.equal(report.providerInvoked, false);
  assert.equal(report.executionAttempted, false);
  assert.equal(report.sideEffectAttempted, false);
  assert.equal(report.blockedReason, 'runtime.browser_action_uncontrolled_site');
  assertSafeReport(report);
});

test('browser_action_provider blocks non-concrete descriptors without guessing selectors or actions', async () => {
  const provider = createBrowserActionProvider();
  const baseRuntimeContext = {
    localFixture: true,
    slotValues: { message: 'private fixture value that must not persist' },
  };
  const cases = [
    {
      name: 'missing selector',
      contract: browserActionContract({
        browserActionDescriptor: { selector: null },
        payloadTemplate: {
          steps: [{ kind: 'form_submit', buttonText: 'Send message' }],
        },
      }),
    },
    {
      name: 'missing route action ref',
      contract: browserActionContract({
        browserActionDescriptor: { actionRef: null, routeRef: null },
        payloadTemplate: {
          steps: [{ kind: 'form_submit', selector: '[data-siteforge-action="contact-form"]' }],
        },
      }),
    },
    {
      name: 'missing required slot value',
      contract: browserActionContract(),
      runtimeContext: { localFixture: true, slotValues: {} },
    },
    {
      name: 'missing payload template',
      contract: browserActionContract({ payloadTemplate: null }),
    },
    {
      name: 'missing slot binding coverage',
      contract: browserActionContract({
        browserActionDescriptor: { requiredSlots: ['message', 'email'] },
      }),
    },
  ];

  for (const scenario of cases) {
    assert.equal(provider.supports({ executionContract: scenario.contract }), true, scenario.name);
    assert.deepEqual(
      provider.canExecute({
        executionContract: scenario.contract,
        runtimeContext: scenario.runtimeContext ?? baseRuntimeContext,
      }),
      {
        allowed: false,
        reasonCode: 'runtime.contract_not_concrete_enough',
      },
      scenario.name,
    );
  }
});

test('browser_action_provider is side-effect-free before run and does not expose heuristic browser code', async () => {
  const providerSource = await readFile(new URL('../../src/app/runtime/providers/browser-action-provider.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(providerSource, /\b(?:querySelector|querySelectorAll|innerText|textContent|click\s*\(|submit\s*\(|goto\s*\(|navigate\s*\(|writeFile|readFile|mkdir)\b/u);

  const provider = createBrowserActionProvider();
  assert.equal(provider.supports({
    executionContract: browserActionContract({ destructiveAction: true }),
  }), false);
  assert.equal(provider.supports({
    executionContract: browserActionContract({ paymentOrFundsAction: true }),
  }), false);
  assert.deepEqual(provider.canExecute({
    executionContract: browserActionContract({ destructiveAction: true }),
    runtimeContext: {
      localFixture: true,
      slotValues: { message: 'private fixture value that must not persist' },
    },
  }), {
    allowed: false,
    reasonCode: 'runtime.browser_action_provider_unsupported',
  });
});

test('production registry preserves specific payment destructive blocks and resolves browser write actions', async () => {
  const cases = [
    {
      contract: { capabilityKind: 'read', operationKind: 'api_request', paymentOrFundsAction: true },
      reason: 'runtime.payment_execution_blocked',
    },
    {
      contract: { capabilityKind: 'read', operationKind: 'api_request', destructiveAction: true },
      reason: 'runtime.destructive_execution_blocked',
    },
  ];
  for (const { contract, reason } of cases) {
    const request = createRequest({
      capabilityId: 'capability:synthetic:unsupported-action',
      executionContractRef: 'execution-contract:synthetic-unsupported-action',
      policyDecisionRef: 'policy:synthetic-unsupported-action',
    });
    const policyDecision = createPolicy({
      capabilityId: 'capability:synthetic:unsupported-action',
      executionContractRef: 'execution-contract:synthetic-unsupported-action',
    });

    const report = await executeRuntimeInvocation({
      invocationRequest: request,
      policyDecision,
      executionContract: contract,
      providerRegistry: createProductionRuntimeProviderRegistry(),
    });

    assert.equal(report.status, 'blocked');
    assert.equal(report.blockedReason, reason);
    assert.equal(report.providerInvoked, false);
    assert.equal(report.sideEffectAttempted, false);
  }

  assert.equal(createProductionRuntimeProviderRegistry().resolve({
    executionContract: browserActionContract(),
  })?.id, 'browser_action_provider');
});
