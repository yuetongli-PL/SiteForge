// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createRuntimeInvocationRequest,
} from '../../src/app/planner/index.mjs';
import {
  RUNTIME_REASONS,
  createProductionRuntimeProviderRegistry,
  createRuntimeAuditView,
  executeRuntimeInvocation,
  invokeSkillRuntime,
  queryRuntimeAuditViews,
} from '../../src/app/runtime/index.mjs';
import {
  buildCapabilityPackageFromGraph,
} from '../../src/domain/capability-packages/index.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../src/domain/policies/execution/index.mjs';
import {
  assertNoPaymentAuthorizationRawMaterial,
  assertPaymentAuthorizationPlanValid,
  assertProductionPaymentProviderProhibited,
  classifyPaymentCapability,
  createPaymentAuditPlanningSummary,
  createPaymentAuthorizationRequirements,
  createPaymentPartyVerificationPlan,
  simulatePaymentPolicy,
  validatePaymentAuthorizationPlan,
} from '../../src/domain/payment-authorization/index.mjs';

const PLAN_URL = new URL('./fixtures/payment-authorization-architecture-plan-v1/safe-payment-plan.json', import.meta.url);
const PACKAGE_GRAPH_URL = new URL('./fixtures/capability-package-site-adapter-registry-v1/compiled-graph.json', import.meta.url);
const PAYMENT_CANARIES =
  /sf_payment_card_secret_123|sf_payment_bank_secret_456|sf_payment_token_secret_789|sf_payment_authorization_phrase_secret_000/u;

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

async function readSafePlan() {
  return readJson(PLAN_URL);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function runtimeRequest() {
  return createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: 'payment-planning.example',
      capabilityId: 'capability:payment-planning:checkout',
      executionContractRef: 'execution-contract:payment-planning:checkout',
      planId: 'plan:payment-planning:checkout',
    },
    executionContractRef: 'execution-contract:payment-planning:checkout',
    policyDecisionRef: 'policy:payment-planning:checkout',
    verdictHint: 'allow',
  });
}

function runtimePolicy(request) {
  return createGovernedExecutionPolicyDecision({
    executionId: 'execution:payment-planning:checkout',
    capabilityId: request.capabilityId,
    executionContractRef: request.executionContractRef,
    verdict: 'allow',
    gates: [],
    runtimeDispatchAllowed: true,
    siteAdapterInvocationAllowed: true,
    auditRequired: true,
  });
}

function runtimePaymentContract() {
  return {
    capabilityKind: 'payment',
    operationKind: 'payment',
    contractKind: 'payment',
    paymentOrFundsAction: true,
    paymentRequirement: {
      required: true,
      amountRef: 'amount:checkout-total-safe-ref',
      currency: 'USD',
      payeeRef: 'payee:merchant-safe-ref',
    },
    redactionRequired: true,
  };
}

async function executeRuntimePayment() {
  const request = runtimeRequest();
  return executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision: runtimePolicy(request),
    executionContract: runtimePaymentContract(),
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });
}

async function buildPaymentPackage() {
  const graph = await readJson(PACKAGE_GRAPH_URL);
  const paymentGraph = clone(graph);
  const capability = paymentGraph.nodes.find((node) => node.type === 'CapabilityNode');
  const contract = paymentGraph.nodes.find((node) => node.type === 'ExecutionContractNode');
  const governance = paymentGraph.nodes.find((node) => node.type === 'GovernancePolicyNode');
  capability.id = 'capability:example.com:checkout-payment';
  capability.capabilityKey = 'checkout-payment';
  capability.supportedTaskTypes = ['checkout.pay'];
  capability.requiresApproval = true;
  contract.id = 'execution-contract:example.com:checkout-payment';
  contract.capabilityRef = capability.id;
  contract.paymentOrFundsAction = true;
  contract.highRiskAction = true;
  contract.providerCompatibility = ['browser_action_provider'];
  contract.executionGates = ['confirm_required', 'audit_required', 'permission_required'];
  governance.paymentConfirmationRequired = true;
  governance.strongConfirmationRequired = true;
  governance.executionGates = ['confirm_required', 'audit_required', 'permission_required'];
  paymentGraph.edges.find((edge) => edge.type === 'capability_has_execution_contract').from = capability.id;
  paymentGraph.edges.find((edge) => edge.type === 'capability_has_execution_contract').to = contract.id;

  return buildCapabilityPackageFromGraph(paymentGraph, {
    version: '1.2.0',
    compiledAt: '2026-06-07T00:00:00.000Z',
  });
}

function skillPaymentRequest(manifest, overrides = {}) {
  const capability = manifest.capabilities[0];
  return {
    schemaVersion: 'skill.runtime_invocation.v1',
    requestId: 'skill-invocation:phase21-checkout-payment',
    skillId: 'skill:phase21-payment-safe-skill',
    packageId: manifest.packageId,
    packageVersion: manifest.version,
    capabilityRef: capability.capabilityRef,
    executionContractRef: capability.executionContractRef,
    policyDecisionRef: 'policy-decision:phase21-payment-safe-ref',
    mode: 'dryRun',
    idempotencyKey: 'idem:phase21-checkout-payment',
    taskText: 'I authorize this payment in the task text',
    slots: {
      amount: { slotRef: 'slot:amount-ref' },
      payee: { slotRef: 'slot:payee-ref' },
    },
    ...overrides,
  };
}

function skillPaymentPolicy() {
  return createGovernedExecutionPolicyDecision({
    executionId: 'execution:phase21-checkout-payment',
    capabilityId: 'capability:example.com:checkout-payment',
    executionContractRef: 'execution-contract:sitepkg:example.com-contract-checkout-payment-1.2.0',
    verdict: 'controlled',
    gates: ['confirm_required', 'audit_required', 'permission_required'],
    gateStatus: {
      allSatisfied: true,
      confirm_required: { satisfied: true },
      audit_required: { satisfied: true },
      permission_required: { satisfied: true },
    },
    runtimeDispatchAllowed: true,
    siteAdapterInvocationAllowed: true,
    paymentOrFundsAction: true,
    strongConfirmationRequired: true,
    permissionRequired: true,
    auditRequired: true,
    naturalLanguageRequestGrantsExecution: false,
  });
}

test('valid payment authorization plan accepted', async () => {
  const plan = await readSafePlan();
  const accepted = assertPaymentAuthorizationPlanValid(plan);
  const requirements = createPaymentAuthorizationRequirements(plan);
  const verification = createPaymentPartyVerificationPlan(plan);

  assert.equal(accepted.productionExecutionDefault, 'blocked');
  assert.equal(requirements.requiresStrongAuthorization, true);
  assert.equal(requirements.requiresOutOfBandApproval, true);
  assert.equal(verification.amount.verified, true);
  assert.equal(verification.payeeVerified, true);
  assert.doesNotMatch(JSON.stringify({ accepted, requirements, verification }), PAYMENT_CANARIES);
});

test('missing amount currency and payee are flagged', async () => {
  const plan = await readSafePlan();
  const report = validatePaymentAuthorizationPlan({
    ...plan,
    amount: { valueRef: '', currency: '' },
    payeeRef: '',
  });

  assert.equal(report.ok, false);
  assert.ok(report.errors.includes('amount.valueRef'));
  assert.ok(report.errors.includes('amount.currency'));
  assert.ok(report.errors.includes('payeeRef'));
  assert.ok(report.findings.some((finding) => finding.kind === 'amount_ref_missing'));
  assert.ok(report.findings.some((finding) => finding.kind === 'currency_missing'));
  assert.ok(report.findings.some((finding) => finding.kind === 'payee_ref_missing'));
});

test('natural language authorization rejected', async () => {
  const plan = await readSafePlan();
  const report = validatePaymentAuthorizationPlan({
    ...plan,
    allowNaturalLanguageAuthorization: true,
  });

  assert.equal(report.ok, false);
  assert.ok(report.errors.includes('allowNaturalLanguageAuthorization'));
});

test('missing out-of-band approval is flagged', async () => {
  const plan = await readSafePlan();
  const report = validatePaymentAuthorizationPlan({
    ...plan,
    requiresOutOfBandApproval: false,
  });

  assert.equal(report.ok, false);
  assert.ok(report.errors.includes('requiresOutOfBandApproval'));
  assert.ok(report.findings.some((finding) => finding.kind === 'out_of_band_approval_missing'));
});

test('payment capability classified', async () => {
  const plan = await readSafePlan();
  const classification = classifyPaymentCapability(plan);

  assert.equal(classification.risk, 'payment');
  assert.equal(classification.riskClassification.payment, true);
  assert.equal(classification.runtimeCallable, false);
  assert.equal(classification.executableByDefault, false);
  assert.equal(classification.productionProviderRegistrationAllowed, false);
});

test('payment policy simulation returns blocked by default', async () => {
  const plan = await readSafePlan();
  const simulation = simulatePaymentPolicy(plan, {
    taskText: 'please pay now',
    outOfBandApprovalObserved: true,
  });

  assert.equal(simulation.decision.status, 'blocked');
  assert.equal(simulation.decision.allowed, false);
  assert.equal(simulation.decision.reasonCode, RUNTIME_REASONS.paymentExecutionBlocked);
  assert.equal(simulation.decision.naturalLanguageRequestGrantsExecution, false);
  assert.equal(simulation.decision.outOfBandApprovalGrantsExecution, false);
  assert.equal(simulation.providerInvoked, false);
  assert.equal(simulation.sideEffectAttempted, false);
});

test('runtime payment remains payment execution blocked', async () => {
  const report = await executeRuntimePayment();

  assert.equal(report.status, 'blocked');
  assert.equal(report.blockedReason, RUNTIME_REASONS.paymentExecutionBlocked);
  assert.equal(report.providerInvoked, false);
  assert.equal(report.executionAttempted, false);
  assert.equal(report.sideEffectAttempted, false);
});

test('production registry has no payment executable provider', () => {
  const registry = createProductionRuntimeProviderRegistry();
  const provider = registry.resolve({
    executionContract: runtimePaymentContract(),
  });
  const prohibition = assertProductionPaymentProviderProhibited(registry);

  assert.equal(provider, null);
  assert.equal(prohibition.paymentProviderRegistered, false);
  assert.equal(prohibition.productionProviderRegistrationAllowed, false);
});

test('audit viewer displays payment planning summary safely', async () => {
  const plan = await readSafePlan();
  const simulation = simulatePaymentPolicy(plan);
  const summary = createPaymentAuditPlanningSummary(plan, simulation);
  const view = createRuntimeAuditView({
    report: {
      schemaVersion: '1.0.0',
      executionVersion: '0.1.0',
      reportType: 'RuntimeExecutionReport',
      requestId: 'runtime-invocation:payment-planning',
      executionId: 'execution:payment-planning',
      capabilityId: 'capability:payment-planning:checkout',
      executionContractRef: 'execution-contract:payment-planning:checkout',
      policyDecisionRef: 'policy:payment-planning:checkout',
      verdict: 'blocked',
      status: 'blocked',
      capabilityKind: 'payment',
      runtimeDispatchAllowed: false,
      providerInvoked: false,
      executionAttempted: false,
      runtimeExecuted: false,
      sideEffectAttempted: false,
      sideEffectSucceeded: false,
      sideEffectFailed: false,
      reasonCode: RUNTIME_REASONS.paymentExecutionBlocked,
      blockedReason: RUNTIME_REASONS.paymentExecutionBlocked,
      resultSummary: {
        outcome: summary.summaryType,
        runtimeMode: summary.planningStatus,
        artifactRefs: [],
        redactionRequired: true,
      },
      artifactRefs: [],
      redactionRequired: true,
    },
  });

  assert.equal(view.invocation.capabilityKind, 'payment');
  assert.equal(view.outcome.blockedReason, RUNTIME_REASONS.paymentExecutionBlocked);
  assert.equal(view.providerResult.outcome, 'payment_audit_planning_summary');
  assert.doesNotMatch(JSON.stringify({ summary, view }), PAYMENT_CANARIES);
});

test('query filters payment blocked planning entries', async () => {
  const report = await executeRuntimePayment();
  const view = createRuntimeAuditView({ report });
  const byReason = queryRuntimeAuditViews([view], {
    reason: RUNTIME_REASONS.paymentExecutionBlocked,
  });
  const byCapabilityKind = queryRuntimeAuditViews([view], {
    capabilityKind: 'payment',
  });

  assert.equal(byReason.count, 1);
  assert.equal(byReason.results[0].reason, RUNTIME_REASONS.paymentExecutionBlocked);
  assert.equal(byCapabilityKind.count, 1);
  assert.equal(byCapabilityKind.results[0].capabilityKind, 'payment');
});

test('capability package records payment classification', async () => {
  const manifest = await buildPaymentPackage();
  const capability = manifest.capabilities[0];

  assert.equal(capability.risk, 'payment');
  assert.equal(capability.riskClassification.payment, true);
  assert.equal(capability.runtimeCallable, false);
  assert.equal(capability.executableByDefault, false);
});

test('skill invocation cannot authorize payment through task text', async () => {
  const manifest = await buildPaymentPackage();
  const preview = await invokeSkillRuntime({
    request: skillPaymentRequest(manifest),
    packageManifest: manifest,
    policyDecision: skillPaymentPolicy(),
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });
  const executed = await invokeSkillRuntime({
    request: skillPaymentRequest(manifest, {
      mode: 'execute',
      idempotencyKey: 'idem:phase21-checkout-payment-execute',
    }),
    packageManifest: manifest,
    policyDecision: skillPaymentPolicy(),
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(preview.status, 'preview');
  assert.equal(preview.dryRunPreview.paymentBlocked, true);
  assert.equal(preview.naturalLanguageRequestGrantsExecution, false);
  assert.equal(preview.taskTextGrantsAuthorization, false);
  assert.equal(executed.status, 'blocked');
  assert.equal(executed.reasonCode, RUNTIME_REASONS.paymentExecutionBlocked);
  assert.equal(executed.providerInvoked, false);
  assert.equal(executed.sideEffectAttempted, false);
});

test('no raw payment credential leakage', async () => {
  const plan = await readSafePlan();
  assert.throws(
    () => assertNoPaymentAuthorizationRawMaterial({
      ...plan,
      paymentCredential: 'sf_payment_token_secret_789',
    }),
    (error) => error.code === 'payment_authorization.raw_material_rejected',
  );
  assert.throws(
    () => assertPaymentAuthorizationPlanValid({
      ...plan,
      amount: {
        valueRef: 'sf_payment_card_secret_123',
        currency: 'USD',
      },
    }),
    (error) => error.code === 'payment_authorization.plan_invalid',
  );
  const simulation = simulatePaymentPolicy(clone(plan), {
    taskText: 'please process payment',
  });
  const summary = createPaymentAuditPlanningSummary(plan, simulation);

  assert.doesNotMatch(JSON.stringify({ simulation, summary }), PAYMENT_CANARIES);
});
