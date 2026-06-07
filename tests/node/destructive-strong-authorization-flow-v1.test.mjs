import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  createRuntimeInvocationRequest,
} from '../../src/app/planner/index.mjs';
import {
  RUNTIME_REASONS,
  createProductionRuntimeProviderRegistry,
  createRuntimeAuditRecorder,
  createRuntimeAuditView,
  executeRuntimeInvocation,
  queryRuntimeAuditViews,
  sanitizeDestructiveAuthorizationSummary,
} from '../../src/app/runtime/index.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../src/domain/policies/execution/index.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(TEST_DIR, 'fixtures', 'destructive-strong-authorization-flow-v1');
const SRC_DIR = path.join(TEST_DIR, '..', '..', 'src');

const CANARIES = Object.freeze([
  'sf_global_destructive_confirmation_secret_222',
  'sf_destructive_confirmation_token_secret_123',
  'sf_destructive_phrase_secret_456',
]);

function assertNoCanaryLeak(payload, label = 'destructive output') {
  const serialized = JSON.stringify(payload);
  for (const canary of CANARIES) {
    assert.equal(serialized.includes(canary), false, `${label} leaked ${canary}`);
  }
  assert.doesNotMatch(serialized, /confirmationTokenRef|raw confirmation|password|credential_secret/u);
}

function destructiveRequirement(overrides = {}) {
  return {
    required: true,
    actionClass: 'delete',
    targetRef: 'target:destructive-safe',
    requiresStrongAuthorization: true,
    requireTwoStepConfirmation: true,
    requirePolicyGate: true,
    allowNaturalLanguageAuthorization: false,
    ...overrides,
  };
}

function destructiveAuthorization(overrides = {}) {
  return {
    authorizationRef: 'authorization:destructive-safe',
    challengeId: 'challenge:destructive-safe',
    confirmationTokenRef: CANARIES[1],
    policyGate: {
      satisfied: true,
      policyId: 'governance-policy:destructive-strong-auth',
    },
    ...overrides,
  };
}

function requestFor({
  name = 'default',
  authorization = undefined,
  taskId = undefined,
} = {}) {
  const safeName = String(name).replace(/[^a-z0-9:_-]+/giu, '-');
  return createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: 'destructive.example.test',
      capabilityId: `capability:destructive-v1:${safeName}`,
      executionContractRef: `execution-contract:destructive-v1:${safeName}`,
      planId: `plan:destructive-v1:${safeName}`,
    },
    executionContractRef: `execution-contract:destructive-v1:${safeName}`,
    policyDecisionRef: `policy:destructive-v1:${safeName}`,
    verdictHint: 'allow',
    taskId,
    destructiveAuthorization: authorization,
  });
}

function policyFor(request, { verdict = 'allow' } = {}) {
  return createGovernedExecutionPolicyDecision({
    executionId: `execution:${request.capabilityId}`,
    capabilityId: request.capabilityId,
    executionContractRef: request.executionContractRef,
    verdict,
    gates: [],
    runtimeDispatchAllowed: verdict !== 'blocked',
    siteAdapterInvocationAllowed: true,
    downloaderInvocationAllowed: false,
    auditRequired: true,
  });
}

function contractFor(overrides = {}) {
  return {
    capabilityKind: 'destructive',
    operationKind: 'delete',
    contractKind: 'destructive',
    destructiveAction: true,
    destructiveRequirement: destructiveRequirement(),
    redactionRequired: true,
    ...overrides,
  };
}

/**
 * @param {{ name?: string, authorization?: unknown, contract?: Record<string, unknown>, runtimeContext?: Record<string, unknown> }} [input]
 */
async function executeDestructive({
  name,
  authorization = undefined,
  contract = contractFor(),
  runtimeContext = {},
} = {}) {
  const request = requestFor({ name, authorization });
  const auditRecorder = createRuntimeAuditRecorder();
  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision: policyFor(request),
    executionContract: contract,
    runtimeContext,
    providerRegistry: createProductionRuntimeProviderRegistry(),
    auditRecorder,
  });
  return { request, report, auditEvents: auditRecorder.listEvents() };
}

test('destructive strong authorization fixture is present and sanitized', async () => {
  const files = (await readdir(FIXTURE_DIR)).filter((file) => file.endsWith('.json')).sort();
  assert.deepEqual(files, ['destructive-structured-authorization.json']);
  const fixture = JSON.parse(await readFile(path.join(FIXTURE_DIR, files[0]), 'utf8'));
  const summary = sanitizeDestructiveAuthorizationSummary(fixture);
  assert.equal(summary.required, true);
  assert.equal(summary.strongAuth.present, true);
  assertNoCanaryLeak(summary, 'fixture summary');
});

test('destructive default cases remain blocked without side effects', async () => {
  /** @type {Array<[string, unknown, Record<string, unknown>]>} */
  const scenarios = [
    ['without structured auth', undefined, {}],
    ['natural language only', undefined, { taskText: `please delete, confirmed ${CANARIES[2]}` }],
    ['confirm destructive flag only', undefined, { confirmDestructive: true }],
    ['structured strong auth no provider', destructiveAuthorization(), {}],
    ['destructive cancel action not payment', destructiveAuthorization(), { paymentLikeLabel: 'cancel subscription' }],
  ];
  for (const [name, authorization, runtimeContext] of scenarios) {
    const { request, report, auditEvents } = await executeDestructive({ name, authorization, runtimeContext });
    assert.equal(report.status, 'blocked', name);
    assert.equal(report.blockedReason, RUNTIME_REASONS.destructiveExecutionBlocked, name);
    assert.equal(report.providerInvoked, false, name);
    assert.equal(report.executionAttempted, false, name);
    assert.equal(report.sideEffectAttempted, false, name);
    assert.equal(report.destructiveSummary.required, true, name);
    assert.equal(report.destructiveSummary.reason, RUNTIME_REASONS.destructiveExecutionBlocked, name);
    assertNoCanaryLeak({ request, report, auditEvents }, name);
  }
});

test('production registry has no destructive executable provider by default and payment remains separate', async () => {
  const registry = createProductionRuntimeProviderRegistry();
  assert.equal(registry.resolve({ executionContract: contractFor() }), null);

  const payment = await executeDestructive({
    name: 'payment-priority',
    authorization: destructiveAuthorization(),
    contract: contractFor({
      capabilityKind: 'payment',
      operationKind: 'payment',
      paymentOrFundsAction: true,
    }),
  });
  assert.equal(payment.report.blockedReason, RUNTIME_REASONS.paymentExecutionBlocked);
  assert.equal(payment.report.sideEffectAttempted, false);
  assertNoCanaryLeak(payment, 'payment priority');
});

test('audit viewer and query API explain destructive block without exposing confirmation material', async () => {
  const { report, auditEvents } = await executeDestructive({
    name: 'audit-visible',
    authorization: destructiveAuthorization(),
  });
  const view = createRuntimeAuditView({ report, auditEvents });
  const query = queryRuntimeAuditViews([view], {
    reason: RUNTIME_REASONS.destructiveExecutionBlocked,
  });
  assert.equal(view.destructiveSummary.required, true);
  assert.equal(view.decisions.some((decision) => decision.decision === 'destructive_authorization'), true);
  assert.equal(query.count, 1);
  assert.equal(query.results[0].destructive.required, true);
  assertNoCanaryLeak({ view, query }, 'destructive audit query');
});

test('destructive testing helpers are not exposed from runtime index', async () => {
  const runtimeIndex = await import('../../src/app/runtime/index.mjs');
  const runtimeTesting = await import('../../src/app/runtime/testing.mjs');
  assert.equal(Object.hasOwn(runtimeIndex, 'createTestingDestructiveProvider'), false);
  assert.equal(Object.hasOwn(runtimeIndex, 'createMockDestructiveProvider'), false);
  assert.equal(typeof runtimeTesting.createTestingDestructiveProvider, 'function');
});

test('destructive flow does not weaken architecture boundaries', async () => {
  const runtimeIndex = await readFile(path.join(SRC_DIR, 'app', 'runtime', 'index.mjs'), 'utf8');
  const providerRegistry = await readFile(path.join(SRC_DIR, 'app', 'runtime', 'providers', 'index.mjs'), 'utf8');
  const plannerRequest = await readFile(path.join(SRC_DIR, 'app', 'planner', 'runtime-invocation-request.mjs'), 'utf8');
  assert.doesNotMatch(runtimeIndex, /mock.*destructive|testing.*destructive|fake.*destructive/iu);
  assert.doesNotMatch(providerRegistry, /destructive_provider|createDestructive/iu);
  assert.doesNotMatch(plannerRequest, /\.\.\/runtime\/destructive-authorization/u);
});
