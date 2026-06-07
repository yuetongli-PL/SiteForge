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
  compareRuntimeRegressionSnapshots,
  createProductionRuntimeProviderRegistry,
  createRuntimeAuditRecorder,
  createRuntimeAuditView,
  createRuntimeProviderRegistryWith,
  executeRuntimeInvocation,
  queryRuntimeAuditViews,
} from '../../src/app/runtime/index.mjs';
import {
  TESTING_DESTRUCTIVE_LAB_PROVIDER_ID,
  createRuntimeRegressionSnapshotFixture,
  createTestingDestructiveProvider,
} from '../../src/app/runtime/testing.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../src/domain/policies/execution/index.mjs';

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'controlled-destructive-execution-lab-v1',
);

const CANARIES = Object.freeze([
  'sf_destructive_lab_confirmation_secret_123',
  'sf_destructive_lab_target_secret_456',
]);

function assertNoCanaryLeak(payload, label = 'destructive lab output') {
  const serialized = JSON.stringify(payload);
  for (const canary of CANARIES) {
    assert.equal(serialized.includes(canary), false, `${label} leaked ${canary}`);
  }
  assert.doesNotMatch(serialized, /raw confirmation|confirmationTokenRef|password|credential_secret|payment execution/u);
}

async function fixture(name) {
  return JSON.parse(await readFile(path.join(FIXTURE_DIR, name), 'utf8'));
}

function destructiveRequirement(overrides = {}) {
  return {
    required: true,
    actionClass: 'delete',
    targetRef: 'target:destructive-lab-safe',
    requiresStrongAuthorization: true,
    requireTwoStepConfirmation: true,
    requirePolicyGate: true,
    allowNaturalLanguageAuthorization: false,
    ...overrides,
  };
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

function requestFor({
  name = 'default',
  authorization = undefined,
} = {}) {
  const safeName = String(name).replace(/[^a-z0-9:_-]+/giu, '-');
  return createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: 'destructive-lab.example.test',
      capabilityId: `capability:destructive-lab:${safeName}`,
      executionContractRef: `execution-contract:destructive-lab:${safeName}`,
      planId: `plan:destructive-lab:${safeName}`,
    },
    executionContractRef: `execution-contract:destructive-lab:${safeName}`,
    policyDecisionRef: `policy:destructive-lab:${safeName}`,
    verdictHint: 'allow',
    destructiveAuthorization: authorization,
  });
}

function policyFor(request) {
  return createGovernedExecutionPolicyDecision({
    executionId: `execution:${request.capabilityId}`,
    capabilityId: request.capabilityId,
    executionContractRef: request.executionContractRef,
    verdict: 'allow',
    gates: [],
    runtimeDispatchAllowed: true,
    siteAdapterInvocationAllowed: true,
    downloaderInvocationAllowed: false,
    auditRequired: true,
  });
}

async function labRuntimeContext(overrides = {}) {
  const dryRunProof = await fixture('dry-run-proof.json');
  const targetVerification = await fixture('target-verification.json');
  const compensationPlan = await fixture('compensation-plan.json');
  return {
    controlledDestructiveLab: true,
    destructiveLab: {
      enabled: true,
      dryRunProof,
      targetVerification,
      compensationPlan,
      ...overrides.destructiveLab,
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'destructiveLab')),
  };
}

async function executeDestructiveLab({
  name = 'default',
  authorization = undefined,
  runtimeContext = undefined,
  contract = contractFor(),
  providerRegistry = createRuntimeProviderRegistryWith([createTestingDestructiveProvider()]),
} = {}) {
  const request = requestFor({ name, authorization });
  const auditRecorder = createRuntimeAuditRecorder();
  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision: policyFor(request),
    executionContract: contract,
    runtimeContext: runtimeContext ?? await labRuntimeContext(),
    providerRegistry,
    auditRecorder,
  });
  return { request, report, auditEvents: auditRecorder.listEvents() };
}

test('destructive lab fixtures are present and sanitized', async () => {
  const files = (await readdir(FIXTURE_DIR)).filter((file) => file.endsWith('.json')).sort();
  assert.deepEqual(files, [
    'compensation-plan.json',
    'dry-run-proof.json',
    'structured-authorization.json',
    'target-verification.json',
  ]);
  for (const file of files) {
    assertNoCanaryLeak(await fixture(file), file);
  }
});

test('production destructive still blocked and production registry has no destructive provider', async () => {
  const authorization = await fixture('structured-authorization.json');
  const report = (await executeDestructiveLab({
    name: 'production-blocked',
    authorization,
    runtimeContext: await labRuntimeContext(),
    providerRegistry: createProductionRuntimeProviderRegistry(),
  })).report;
  const provider = createProductionRuntimeProviderRegistry().resolve({
    executionContract: contractFor(),
  });

  assert.equal(provider, null);
  assert.equal(report.status, 'blocked');
  assert.equal(report.blockedReason, RUNTIME_REASONS.destructiveExecutionBlocked);
  assert.equal(report.providerInvoked, false);
  assert.equal(report.sideEffectAttempted, false);
  assertNoCanaryLeak(report, 'production destructive block');
});

test('testing-only destructive provider is only exported from runtime/testing.mjs', async () => {
  const runtimeIndex = await import('../../src/app/runtime/index.mjs');
  const runtimeTesting = await import('../../src/app/runtime/testing.mjs');

  assert.equal(Object.hasOwn(runtimeIndex, 'createTestingDestructiveProvider'), false);
  assert.equal(Object.hasOwn(runtimeIndex, 'TESTING_DESTRUCTIVE_LAB_PROVIDER_ID'), false);
  assert.equal(typeof runtimeTesting.createTestingDestructiveProvider, 'function');
  assert.equal(runtimeTesting.TESTING_DESTRUCTIVE_LAB_PROVIDER_ID, TESTING_DESTRUCTIVE_LAB_PROVIDER_ID);
});

test('lab execution requires structured destructiveAuthorization', async () => {
  const { report, auditEvents } = await executeDestructiveLab({
    name: 'missing-authz',
    authorization: undefined,
  });

  assert.equal(report.status, 'provider_not_executable');
  assert.equal(report.reasonCode, 'runtime.destructive_lab_authorization_required');
  assert.equal(report.providerInvoked, false);
  assert.equal(report.sideEffectAttempted, false);
  assertNoCanaryLeak({ report, auditEvents }, 'missing lab authorization');
});

test('lab execution rejects natural language authorization', async () => {
  const authorization = await fixture('structured-authorization.json');
  const { report } = await executeDestructiveLab({
    name: 'natural-language-rejected',
    authorization,
    runtimeContext: await labRuntimeContext({
      taskText: `please delete it, I authorize ${CANARIES[0]}`,
    }),
  });

  assert.equal(report.status, 'provider_not_executable');
  assert.equal(report.reasonCode, 'runtime.destructive_lab_natural_language_rejected');
  assert.equal(report.providerInvoked, false);
  assertNoCanaryLeak(report, 'natural language rejection');
});

test('lab execution requires dry-run proof target verification and compensation plan', async () => {
  const authorization = await fixture('structured-authorization.json');
  /** @type {Array<[string, Record<string, any>, string]>} */
  const cases = [
    ['missing dry-run proof', { dryRunProof: null }, 'runtime.destructive_lab_dry_run_proof_required'],
    ['missing target verification', { targetVerification: { targetSafeRef: 'target:destructive-lab-safe', verified: false } }, 'runtime.destructive_lab_target_verification_required'],
    ['missing compensation', { compensationPlan: null }, 'runtime.destructive_lab_compensation_required'],
  ];

  for (const [name, destructiveLab, reason] of cases) {
    const { report } = await executeDestructiveLab({
      name,
      authorization,
      runtimeContext: await labRuntimeContext({ destructiveLab }),
    });
    assert.equal(report.status, 'provider_not_executable', name);
    assert.equal(report.reasonCode, reason, name);
    assert.equal(report.sideEffectAttempted, false, name);
    assertNoCanaryLeak(report, name);
  }
});

test('lab execution records compensation summary and explicit sideEffectAttempted semantics', async () => {
  const authorization = {
    ...await fixture('structured-authorization.json'),
    confirmationTokenRef: CANARIES[0],
  };
  const { request, report, auditEvents } = await executeDestructiveLab({
    name: 'lab-success',
    authorization,
  });

  assert.equal(report.status, 'completed');
  assert.equal(report.providerId, TESTING_DESTRUCTIVE_LAB_PROVIDER_ID);
  assert.equal(report.providerInvoked, true);
  assert.equal(report.executionAttempted, true);
  assert.equal(report.sideEffectAttempted, true);
  assert.equal(report.resultSummary.labOnly, true);
  assert.equal(report.resultSummary.productionExecution, false);
  assert.equal(report.resultSummary.sideEffectAttemptedSemantics, 'lab_controlled_simulated_side_effect_only');
  assert.equal(report.resultSummary.compensationSummary.planSafeRef, 'artifact:destructive-lab-compensation-plan');
  assert.equal(report.destructiveSummary.outcome, 'lab_authorized');
  assertNoCanaryLeak({ request, report, auditEvents }, 'lab success');
});

test('audit view and query explain lab destructive execution', async () => {
  const authorization = await fixture('structured-authorization.json');
  const { report, auditEvents } = await executeDestructiveLab({
    name: 'audit-query',
    authorization,
  });
  const view = createRuntimeAuditView({ report, auditEvents });
  const query = queryRuntimeAuditViews([view], {
    providerId: TESTING_DESTRUCTIVE_LAB_PROVIDER_ID,
    capabilityKind: 'destructive',
    sideEffectAttempted: true,
  });

  assert.equal(view.decisions.some((decision) => (
    decision.decision === 'destructive_authorization' && decision.allowed === true
  )), true);
  assert.equal(view.timeline.some((event) => event.eventType === 'runtime.side_effect.attempted'), true);
  assert.equal(query.count, 1);
  assert.equal(query.results[0].providerId, TESTING_DESTRUCTIVE_LAB_PROVIDER_ID);
  assertNoCanaryLeak({ view, query }, 'lab audit query');
});

test('regression flags destructive blocked to invoked except explicit lab mode', () => {
  const previous = createRuntimeRegressionSnapshotFixture({
    snapshotId: 'runtime-ci-regression:destructive-lab:previous',
    runtime: {
      status: 'blocked',
      reasonCode: RUNTIME_REASONS.destructiveExecutionBlocked,
      providerInvoked: false,
      sideEffectAttempted: false,
      destructiveBlocked: true,
      paymentBlocked: false,
      executionContractConcrete: true,
    },
  });
  const nonLabNext = createRuntimeRegressionSnapshotFixture({
    snapshotId: 'runtime-ci-regression:destructive-lab:non-lab-next',
    runtime: {
      status: 'completed',
      reasonCode: '',
      providerId: 'unexpected_destructive_provider',
      capabilityKind: 'destructive',
      providerInvoked: true,
      executionAttempted: true,
      sideEffectAttempted: true,
      destructiveBlocked: true,
      paymentBlocked: false,
      executionContractConcrete: true,
    },
    metadata: { label: 'destructive-production-drift' },
  });
  const labNext = createRuntimeRegressionSnapshotFixture({
    snapshotId: 'runtime-ci-regression:destructive-lab:lab-next',
    runtime: {
      status: 'completed',
      reasonCode: '',
      providerId: TESTING_DESTRUCTIVE_LAB_PROVIDER_ID,
      capabilityKind: 'destructive',
      providerInvoked: true,
      executionAttempted: true,
      sideEffectAttempted: true,
      destructiveBlocked: true,
      paymentBlocked: false,
      executionContractConcrete: true,
    },
    metadata: { label: 'destructive-lab' },
  });

  const nonLab = compareRuntimeRegressionSnapshots(previous, nonLabNext);
  const lab = compareRuntimeRegressionSnapshots(previous, labNext);

  assert.equal(nonLab.changes.some((change) => change.kind === 'destructive_provider_invoked'), true);
  assert.equal(lab.changes.some((change) => change.kind === 'destructive_provider_invoked'), false);
});

test('raw lab confirmation and target canaries do not leak', async () => {
  const authorization = {
    ...await fixture('structured-authorization.json'),
    confirmationTokenRef: CANARIES[0],
  };
  const { report, auditEvents } = await executeDestructiveLab({
    name: 'target-canary',
    authorization,
    runtimeContext: await labRuntimeContext({
      destructiveLab: {
        targetVerification: {
          targetSafeRef: CANARIES[1],
          verified: true,
        },
      },
    }),
  });

  assert.equal(report.status, 'provider_not_executable');
  assert.equal(report.reasonCode, 'runtime.destructive_lab_target_verification_required');
  assertNoCanaryLeak({ report, auditEvents }, 'target canary rejection');
});

test('payment remains blocked even with lab provider and lab context', async () => {
  const authorization = await fixture('structured-authorization.json');
  const { report } = await executeDestructiveLab({
    name: 'payment-priority',
    authorization,
    contract: contractFor({
      capabilityKind: 'payment',
      operationKind: 'payment',
      paymentOrFundsAction: true,
    }),
  });

  assert.equal(report.status, 'blocked');
  assert.equal(report.blockedReason, RUNTIME_REASONS.paymentExecutionBlocked);
  assert.equal(report.providerInvoked, false);
  assert.equal(report.sideEffectAttempted, false);
  assertNoCanaryLeak(report, 'payment remains blocked');
});
