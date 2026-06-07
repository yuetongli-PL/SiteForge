// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createRuntimeInvocationRequest,
} from '../../src/app/planner/index.mjs';
import {
  RUNTIME_REASONS,
  compareRuntimeRegressionSnapshots,
  createProductionRuntimeProviderRegistry,
  createRuntimeAuditView,
  createSkillRuntimeInvocationRequest,
  executeRuntimeInvocation,
  queryRuntimeAuditViews,
} from '../../src/app/runtime/index.mjs';
import {
  createRuntimeRegressionSnapshotFixture,
} from '../../src/app/runtime/testing.mjs';
import {
  buildCapabilityPackageFromGraph,
  validateCapabilityPackageManifest,
} from '../../src/domain/capability-packages/index.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../src/domain/policies/execution/index.mjs';
import {
  simulatePolicyPack,
} from '../../src/domain/policies/policy-pack/index.mjs';
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

const DOC_URL = new URL('../../docs/security/payment-threat-model.md', import.meta.url);
const PLAN_URL = new URL('./fixtures/payment-authorization-lab-threat-model-v1/payment-lab-plan.json', import.meta.url);
const APPROVAL_URL = new URL('./fixtures/payment-authorization-lab-threat-model-v1/out-of-band-approval.json', import.meta.url);
const POLICY_INPUT_URL = new URL('./fixtures/payment-authorization-lab-threat-model-v1/policy-pack-payment-input.json', import.meta.url);
const POLICY_PACK_URL = new URL('./fixtures/policy-pack-authoring-simulation-v1/safe-policy-pack.json', import.meta.url);
const PACKAGE_GRAPH_URL = new URL('./fixtures/capability-package-site-adapter-registry-v1/compiled-graph.json', import.meta.url);
const PAYMENT_LAB_CANARIES =
  /sf_payment_lab_card_secret_123|sf_payment_lab_bank_secret_456|sf_payment_lab_token_secret_789/u;

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

async function readPlan() {
  return readJson(PLAN_URL);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function runtimeRequest() {
  return createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: 'payment-lab.example',
      capabilityId: 'capability:payment-lab:checkout',
      executionContractRef: 'execution-contract:payment-lab:checkout',
      planId: 'plan:payment-lab:checkout',
    },
    executionContractRef: 'execution-contract:payment-lab:checkout',
    policyDecisionRef: 'policy:payment-lab:checkout',
    verdictHint: 'allow',
  });
}

function runtimePolicy(request) {
  return createGovernedExecutionPolicyDecision({
    executionId: 'execution:payment-lab:checkout',
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
      amountRef: 'amount:payment-lab-checkout-total-safe-ref',
      currency: 'USD',
      payeeRef: 'payee:payment-lab-merchant-safe-ref',
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

function paymentSnapshot(snapshotId, overrides = {}) {
  const base = createRuntimeRegressionSnapshotFixture({
    snapshotId,
    runtime: {
      status: 'blocked',
      reasonCode: RUNTIME_REASONS.paymentExecutionBlocked,
      providerId: '',
      capabilityKind: 'payment',
      providerInvoked: false,
      executionAttempted: false,
      sideEffectAttempted: false,
      paymentBlocked: true,
      destructiveBlocked: false,
      executionContractConcrete: true,
    },
    auth: {
      required: false,
      used: false,
      scopes: [],
      materialTypes: [],
    },
    policy: {
      policyId: 'policy:payment-lab',
      verdict: 'blocked',
      reason: RUNTIME_REASONS.paymentExecutionBlocked,
      allowed: false,
    },
    metadata: {
      label: 'payment-lab-blocked',
    },
  });
  return {
    ...base,
    ...overrides,
    runtime: {
      ...base.runtime,
      ...(overrides.runtime ?? {}),
    },
    auth: {
      ...base.auth,
      ...(overrides.auth ?? {}),
    },
    policy: {
      ...base.policy,
      ...(overrides.policy ?? {}),
    },
    metadata: {
      ...base.metadata,
      ...(overrides.metadata ?? {}),
    },
  };
}

async function buildPaymentPackage() {
  const graph = await readJson(PACKAGE_GRAPH_URL);
  const paymentGraph = clone(graph);
  const capability = paymentGraph.nodes.find((node) => node.type === 'CapabilityNode');
  const contract = paymentGraph.nodes.find((node) => node.type === 'ExecutionContractNode');
  const governance = paymentGraph.nodes.find((node) => node.type === 'GovernancePolicyNode');
  capability.id = 'capability:payment-lab.example:checkout-payment';
  capability.capabilityKey = 'checkout-payment';
  capability.supportedTaskTypes = ['checkout.pay'];
  capability.requiresApproval = true;
  contract.id = 'execution-contract:payment-lab.example:checkout-payment';
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
    version: '1.0.0',
    compiledAt: '2026-06-07T00:00:00.000Z',
  });
}

test('payment threat model states the non-execution boundary', async () => {
  const document = await readFile(DOC_URL, 'utf8');

  assert.match(document, /payment authorization planning and lab simulation only/iu);
  assert.match(document, /does not implement payment execution/iu);
  assert.match(document, /does not register a real payment provider/iu);
  assert.match(document, /does not perform payment network requests/iu);
  assert.match(document, /Natural language task text is rejected as authorization/iu);
  assert.match(document, /raw payment credential persistence/iu);
  assert.doesNotMatch(document, PAYMENT_LAB_CANARIES);
});

test('lab fixtures use safe payment refs only', async () => {
  const plan = await readPlan();
  const approval = await readJson(APPROVAL_URL);
  const policyInput = await readJson(POLICY_INPUT_URL);

  assert.equal(assertNoPaymentAuthorizationRawMaterial({ plan, approval, policyInput }), true);
  assert.equal(plan.amount.valueRef, 'amount:payment-lab-checkout-total-safe-ref');
  assert.equal(plan.amount.currency, 'USD');
  assert.equal(plan.payeeRef, 'payee:payment-lab-merchant-safe-ref');
  assert.equal(approval.observed, true);
  assert.equal(approval.grantsExecution, false);
  assert.doesNotMatch(JSON.stringify({ plan, approval, policyInput }), PAYMENT_LAB_CANARIES);
});

test('payment simulation verifies amount currency and payee safe refs', async () => {
  const plan = await readPlan();
  const accepted = assertPaymentAuthorizationPlanValid(plan);
  const requirements = createPaymentAuthorizationRequirements(plan);
  const verification = createPaymentPartyVerificationPlan(plan);
  const classification = classifyPaymentCapability(plan);

  assert.equal(accepted.productionExecutionDefault, 'blocked');
  assert.equal(requirements.requiresStrongAuthorization, true);
  assert.equal(requirements.requiresOutOfBandApproval, true);
  assert.equal(requirements.allowNaturalLanguageAuthorization, false);
  assert.equal(verification.amount.valueRef, plan.amount.valueRef);
  assert.equal(verification.amount.currency, 'USD');
  assert.equal(verification.amount.verified, true);
  assert.equal(verification.payeeRef, plan.payeeRef);
  assert.equal(verification.payeeVerified, true);
  assert.equal(classification.risk, 'payment');
  assert.equal(classification.runtimeCallable, false);
  assert.doesNotMatch(JSON.stringify({ accepted, requirements, verification, classification }), PAYMENT_LAB_CANARIES);
});

test('missing out-of-band approval and natural language authorization are rejected', async () => {
  const plan = await readPlan();
  const missingApproval = validatePaymentAuthorizationPlan({
    ...plan,
    requiresOutOfBandApproval: false,
  });
  const naturalLanguage = validatePaymentAuthorizationPlan({
    ...plan,
    allowNaturalLanguageAuthorization: true,
  });
  const simulation = simulatePaymentPolicy(plan, {
    taskText: 'I authorize this payment in task text',
    outOfBandApprovalObserved: true,
  });

  assert.equal(missingApproval.ok, false);
  assert.ok(missingApproval.errors.includes('requiresOutOfBandApproval'));
  assert.ok(missingApproval.findings.some((finding) => finding.kind === 'out_of_band_approval_missing'));
  assert.equal(naturalLanguage.ok, false);
  assert.ok(naturalLanguage.errors.includes('allowNaturalLanguageAuthorization'));
  assert.equal(simulation.decision.naturalLanguageRequestGrantsExecution, false);
  assert.equal(simulation.decision.outOfBandApprovalObserved, true);
  assert.equal(simulation.decision.outOfBandApprovalGrantsExecution, false);
});

test('skill task text redacts payment lab canary and cannot authorize payment', () => {
  const request = createSkillRuntimeInvocationRequest({
    schemaVersion: 'skill.runtime_invocation.v1',
    requestId: 'skill-invocation:payment-lab-canary-task-text',
    skillId: 'skill:payment-lab-safe-skill',
    packageId: 'sitepkg:payment-lab.example',
    packageVersion: '1.0.0',
    capabilityRef: 'sitepkg:payment-lab.example/checkout-payment@1.0.0',
    executionContractRef: 'sitepkg:payment-lab.example/contract/checkout-payment@1.0.0',
    policyDecisionRef: 'policy-decision:payment-lab-safe-ref',
    mode: 'dryRun',
    idempotencyKey: 'idem:payment-lab-canary-task-text',
    taskText: 'I authorize payment with sf_payment_lab_token_secret_789',
    slots: {
      amount: { slotRef: 'slot:payment-lab-amount' },
      payee: { slotRef: 'slot:payment-lab-payee' },
    },
  });

  assert.equal(request.taskText, '[redacted]');
  assert.equal(request.taskTextGrantsAuthorization, false);
  assert.equal(request.naturalLanguageRequestGrantsExecution, false);
  assert.equal(request.rawMaterialPersisted, false);
  assert.doesNotMatch(JSON.stringify(request), PAYMENT_LAB_CANARIES);
});

test('production payment provider remains absent', () => {
  const registry = createProductionRuntimeProviderRegistry();
  const provider = registry.resolve({
    executionContract: runtimePaymentContract(),
  });
  const prohibition = assertProductionPaymentProviderProhibited(registry);

  assert.equal(provider, null);
  assert.equal(prohibition.paymentProviderRegistered, false);
  assert.equal(prohibition.paymentProviderProhibited, true);
  assert.equal(prohibition.productionProviderRegistrationAllowed, false);
});

test('payment runtime remains blocked before provider invocation', async () => {
  const report = await executeRuntimePayment();

  assert.equal(report.status, 'blocked');
  assert.equal(report.blockedReason, RUNTIME_REASONS.paymentExecutionBlocked);
  assert.equal(report.reasonCode, RUNTIME_REASONS.paymentExecutionBlocked);
  assert.equal(report.providerInvoked, false);
  assert.equal(report.executionAttempted, false);
  assert.equal(report.sideEffectAttempted, false);
});

test('payment runtime blocks before provider selection', async () => {
  const request = runtimeRequest();
  let resolveCalls = 0;
  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision: runtimePolicy(request),
    executionContract: runtimePaymentContract(),
    providerRegistry: {
      resolve() {
        resolveCalls += 1;
        throw new Error('payment provider selection must not run');
      },
    },
  });

  assert.equal(report.status, 'blocked');
  assert.equal(report.blockedReason, RUNTIME_REASONS.paymentExecutionBlocked);
  assert.equal(report.providerInvoked, false);
  assert.equal(resolveCalls, 0);
});

test('payment audit summary is sanitized and records simulation without execution', async () => {
  const plan = await readPlan();
  const simulation = simulatePaymentPolicy(plan, {
    taskText: 'please pay now',
    outOfBandApprovalObserved: true,
  });
  const summary = createPaymentAuditPlanningSummary(plan, simulation);
  const view = createRuntimeAuditView({
    report: {
      schemaVersion: '1.0.0',
      executionVersion: '0.1.0',
      reportType: 'RuntimeExecutionReport',
      requestId: 'runtime-invocation:payment-lab',
      executionId: 'execution:payment-lab',
      capabilityId: 'capability:payment-lab:checkout',
      executionContractRef: 'execution-contract:payment-lab:checkout',
      policyDecisionRef: 'policy:payment-lab:checkout',
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

  assert.equal(summary.outOfBandApproval.observed, true);
  assert.equal(summary.outOfBandApproval.grantsExecution, false);
  assert.equal(summary.providerInvoked, false);
  assert.equal(summary.sideEffectAttempted, false);
  assert.equal(view.invocation.capabilityKind, 'payment');
  assert.equal(view.outcome.blockedReason, RUNTIME_REASONS.paymentExecutionBlocked);
  assert.equal(view.providerResult.outcome, 'payment_audit_planning_summary');
  assert.doesNotMatch(JSON.stringify({ simulation, summary, view }), PAYMENT_LAB_CANARIES);
});

test('policy pack simulation blocks payment without executing surfaces', async () => {
  const policyPack = await readJson(POLICY_PACK_URL);
  const paymentInput = await readJson(POLICY_INPUT_URL);
  const simulation = simulatePolicyPack(policyPack, paymentInput);

  assert.equal(simulation.decision.allowed, false);
  assert.equal(simulation.decision.reason, RUNTIME_REASONS.paymentExecutionBlocked);
  assert.equal(simulation.decision.providerInvoked, false);
  assert.equal(simulation.decision.browserInvoked, false);
  assert.equal(simulation.decision.vaultAccessed, false);
  assert.equal(simulation.decision.networkInvoked, false);
});

test('query and regression integration preserve payment blocked detection', async () => {
  const report = await executeRuntimePayment();
  const view = createRuntimeAuditView({ report });
  const byReason = queryRuntimeAuditViews([view], {
    reason: RUNTIME_REASONS.paymentExecutionBlocked,
  });
  const byCapabilityKind = queryRuntimeAuditViews([view], {
    capabilityKind: 'payment',
  });
  const driftView = createRuntimeAuditView({
    report: {
      ...report,
      requestId: 'runtime-invocation:payment-lab-provider-drift',
      providerInvoked: true,
    },
  });
  const byProviderInvoked = queryRuntimeAuditViews([view, driftView], {
    capabilityKind: 'payment',
    providerInvoked: true,
  });
  const comparison = compareRuntimeRegressionSnapshots(
    paymentSnapshot('runtime-ci-regression:payment-lab:previous'),
    paymentSnapshot('runtime-ci-regression:payment-lab:next', {
      runtime: {
        providerId: 'payment_provider_drift',
        providerInvoked: true,
      },
    }),
  );

  assert.equal(byReason.count, 1);
  assert.equal(byCapabilityKind.count, 1);
  assert.equal(byProviderInvoked.count, 1);
  assert.equal(byProviderInvoked.results[0].providerInvoked, true);
  assert.ok(comparison.changes.some((change) => (
    change.kind === 'payment_provider_invoked'
    && change.severity === 'critical'
  )));
  assert.equal(comparison.providerInvoked, false);
});

test('capability package preserves payment classification', async () => {
  const manifest = await buildPaymentPackage();
  const capability = manifest.capabilities[0];
  const manuallyRelaxed = clone(manifest);
  manuallyRelaxed.capabilities[0].runtimeCallable = true;
  const relaxedReport = validateCapabilityPackageManifest(manuallyRelaxed);

  assert.equal(capability.risk, 'payment');
  assert.equal(capability.riskClassification.payment, true);
  assert.equal(capability.runtimeCallable, false);
  assert.equal(capability.executableByDefault, false);
  assert.equal(relaxedReport.ok, false);
  assert.equal(relaxedReport.errors.some((error) => error.startsWith('paymentRuntimeCallable:')), true);
  assert.doesNotMatch(JSON.stringify(manifest), PAYMENT_LAB_CANARIES);
});

test('raw lab card bank and token material is rejected even in safe-ref fields', async () => {
  const plan = await readPlan();

  assert.throws(
    () => assertNoPaymentAuthorizationRawMaterial({
      ...plan,
      paymentCredential: 'sf_payment_lab_token_secret_789',
    }),
    (error) => error.code === 'payment_authorization.raw_material_rejected',
  );
  assert.throws(
    () => assertNoPaymentAuthorizationRawMaterial({
      ...plan,
      bankAccount: 'sf_payment_lab_bank_secret_456',
    }),
    (error) => error.code === 'payment_authorization.raw_material_rejected',
  );
  assert.throws(
    () => assertPaymentAuthorizationPlanValid({
      ...plan,
      amount: {
        valueRef: 'sf_payment_lab_card_secret_123',
        currency: 'USD',
      },
    }),
    (error) => error.code === 'payment_authorization.plan_invalid',
  );

  const simulation = simulatePaymentPolicy(clone(plan), {
    taskText: 'please process payment',
    outOfBandApprovalObserved: true,
  });
  const summary = createPaymentAuditPlanningSummary(plan, simulation);

  assert.doesNotMatch(JSON.stringify({ simulation, summary }), PAYMENT_LAB_CANARIES);
});
