// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

import {
  createRuntimeInvocationRequest,
} from '../../src/app/planner/index.mjs';
import {
  RUNTIME_REASONS,
  createProductionRuntimeProviderRegistry,
  createRuntimeAuditView,
  executeRuntimeInvocation,
  queryRuntimeAuditViews,
} from '../../src/app/runtime/index.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../src/domain/policies/execution/index.mjs';
import {
  assertDestructiveExecutionPlanValid,
  assertNoDestructivePlanningRawMaterial,
  createDestructiveAuthorizationLifecycle,
  createDestructiveCompensationPlan,
  createDestructiveDryRunProof,
  createDestructivePlanningAuditSummary,
  createDestructiveProviderRequirements,
  simulateDestructiveExecutionPlan,
  validateDestructiveExecutionPlan,
  verifyDestructiveTargetRef,
} from '../../src/domain/destructive-planning/index.mjs';

const FIXTURE_URL = new URL('./fixtures/destructive-controlled-execution-v2-planning/safe-destructive-plan.json', import.meta.url);
const FIXTURE_DIR_URL = new URL('./fixtures/destructive-controlled-execution-v2-planning/', import.meta.url);
const DESTRUCTIVE_CANARIES =
  /sf_destructive_plan_confirmation_secret_123|sf_destructive_target_private_secret_456/u;

async function readSafePlan() {
  return JSON.parse(await readFile(FIXTURE_URL, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function runtimeRequest() {
  return createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: 'destructive-planning.example',
      capabilityId: 'capability:destructive-planning:delete',
      executionContractRef: 'execution-contract:destructive-planning:delete',
      planId: 'plan:destructive-planning:delete',
    },
    executionContractRef: 'execution-contract:destructive-planning:delete',
    policyDecisionRef: 'policy:destructive-planning:delete',
    verdictHint: 'allow',
  });
}

function runtimePolicy(request) {
  return createGovernedExecutionPolicyDecision({
    executionId: 'execution:destructive-planning:delete',
    capabilityId: request.capabilityId,
    executionContractRef: request.executionContractRef,
    verdict: 'allow',
    gates: [],
    runtimeDispatchAllowed: true,
    siteAdapterInvocationAllowed: true,
    auditRequired: true,
  });
}

async function executeRuntimeDestructive({ runtimeContext = {} } = {}) {
  const request = runtimeRequest();
  return executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision: runtimePolicy(request),
    executionContract: {
      capabilityKind: 'destructive',
      operationKind: 'delete',
      contractKind: 'destructive',
      destructiveAction: true,
      destructiveRequirement: {
        required: true,
        actionClass: 'delete',
        targetRef: 'target:destructive-safe-ref',
      },
      redactionRequired: true,
    },
    runtimeContext,
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });
}

test('valid destructive execution plan accepted', async () => {
  const files = (await readdir(FIXTURE_DIR_URL)).filter((file) => file.endsWith('.json')).sort();
  assert.deepEqual(files, ['safe-destructive-plan.json']);
  const plan = await readSafePlan();
  const accepted = assertDestructiveExecutionPlanValid(plan);
  const requirements = createDestructiveProviderRequirements(plan);
  const lifecycle = createDestructiveAuthorizationLifecycle(plan);
  const target = verifyDestructiveTargetRef(plan);
  const proof = createDestructiveDryRunProof(plan);
  const compensation = createDestructiveCompensationPlan(plan, { rollbackSteps: ['restore snapshot'] });

  assert.equal(accepted.productionExecutionDefault, 'blocked');
  assert.equal(requirements.productionProviderRegistrationAllowed, false);
  assert.equal(lifecycle.allowNaturalLanguageAuthorization, false);
  assert.equal(target.targetVerified, true);
  assert.equal(proof.proofPresent, true);
  assert.equal(compensation.compensationPresent, true);
  assert.doesNotMatch(JSON.stringify({ accepted, requirements, lifecycle, target, proof, compensation }), DESTRUCTIVE_CANARIES);
});

test('plan without strong authorization rejected', async () => {
  const plan = await readSafePlan();
  assert.throws(
    () => assertDestructiveExecutionPlanValid({ ...plan, requiresStrongAuthorization: false }),
    (error) => error.code === 'destructive_planning.plan_invalid',
  );
});

test('plan allowing natural language authorization rejected', async () => {
  const plan = await readSafePlan();
  const report = validateDestructiveExecutionPlan({
    ...plan,
    allowNaturalLanguageAuthorization: true,
  });

  assert.equal(report.ok, false);
  assert.ok(report.errors.includes('allowNaturalLanguageAuthorization'));
});

test('plan without targetRef rejected', async () => {
  const plan = await readSafePlan();
  assert.throws(
    () => assertDestructiveExecutionPlanValid({ ...plan, targetRef: '' }),
    (error) => error.code === 'destructive_planning.plan_invalid',
  );
});

test('plan without dry-run proof flagged', async () => {
  const plan = await readSafePlan();
  const report = validateDestructiveExecutionPlan({ ...plan, dryRunProofRef: '' });

  assert.equal(report.ok, true);
  assert.equal(report.findings.some((finding) => finding.kind === 'dry_run_proof_missing'), true);
});

test('plan without compensation model flagged', async () => {
  const plan = await readSafePlan();
  const report = validateDestructiveExecutionPlan({ ...plan, compensationPlanRef: '' });

  assert.equal(report.ok, true);
  assert.equal(report.findings.some((finding) => finding.kind === 'compensation_plan_missing'), true);
});

test('simulation produces blocked-by-default decision', async () => {
  const plan = await readSafePlan();
  const simulation = simulateDestructiveExecutionPlan(plan);

  assert.equal(simulation.decision.status, 'blocked');
  assert.equal(simulation.decision.allowed, false);
  assert.equal(simulation.decision.reasonCode, RUNTIME_REASONS.destructiveExecutionBlocked);
  assert.equal(simulation.providerInvoked, false);
  assert.equal(simulation.sideEffectAttempted, false);
});

test('runtime destructive remains blocked', async () => {
  const report = await executeRuntimeDestructive();

  assert.equal(report.status, 'blocked');
  assert.equal(report.blockedReason, RUNTIME_REASONS.destructiveExecutionBlocked);
  assert.equal(report.providerInvoked, false);
  assert.equal(report.executionAttempted, false);
  assert.equal(report.sideEffectAttempted, false);
});

test('production registry has no destructive provider', () => {
  const registry = createProductionRuntimeProviderRegistry();
  const provider = registry.resolve({
    executionContract: {
      capabilityKind: 'destructive',
      destructiveAction: true,
    },
  });

  assert.equal(provider, null);
});

test('confirm destructive alone still blocked', async () => {
  const plan = await readSafePlan();
  const simulation = simulateDestructiveExecutionPlan(plan, { confirmDestructive: true });
  const report = await executeRuntimeDestructive({ runtimeContext: { confirmDestructive: true } });

  assert.equal(simulation.decision.confirmDestructiveGrantsExecution, false);
  assert.equal(simulation.decision.allowed, false);
  assert.equal(report.blockedReason, RUNTIME_REASONS.destructiveExecutionBlocked);
});

test('audit viewer displays planning summary safely', async () => {
  const plan = await readSafePlan();
  const simulation = simulateDestructiveExecutionPlan(plan);
  const summary = createDestructivePlanningAuditSummary(plan, simulation);
  const view = createRuntimeAuditView({
    report: {
      schemaVersion: '1.0.0',
      executionVersion: '0.1.0',
      reportType: 'RuntimeExecutionReport',
      requestId: 'runtime-invocation:destructive-planning',
      executionId: 'execution:destructive-planning',
      capabilityId: 'capability:destructive-planning:delete',
      executionContractRef: 'execution-contract:destructive-planning:delete',
      policyDecisionRef: 'policy:destructive-planning:delete',
      verdict: 'blocked',
      status: 'blocked',
      capabilityKind: 'destructive',
      runtimeDispatchAllowed: false,
      providerInvoked: false,
      executionAttempted: false,
      runtimeExecuted: false,
      sideEffectAttempted: false,
      sideEffectSucceeded: false,
      sideEffectFailed: false,
      reasonCode: RUNTIME_REASONS.destructiveExecutionBlocked,
      blockedReason: RUNTIME_REASONS.destructiveExecutionBlocked,
      destructiveSummary: summary,
      artifactRefs: [],
      redactionRequired: true,
    },
  });

  assert.equal(view.destructiveSummary.required, true);
  assert.equal(view.decisions.some((decision) => decision.decision === 'destructive_authorization'), true);
  assert.doesNotMatch(JSON.stringify(view), DESTRUCTIVE_CANARIES);
});

test('query filters destructive planning entries', async () => {
  const report = await executeRuntimeDestructive();
  const view = createRuntimeAuditView({ report });
  const query = queryRuntimeAuditViews([view], {
    reason: RUNTIME_REASONS.destructiveExecutionBlocked,
  });

  assert.equal(query.count, 1);
  assert.equal(query.results[0].destructive.required, true);
});

test('skill task text cannot authorize destructive', async () => {
  const plan = await readSafePlan();
  const simulation = simulateDestructiveExecutionPlan(plan, {
    taskText: 'delete it now, I authorize',
  });

  assert.equal(simulation.decision.taskTextObserved, true);
  assert.equal(simulation.decision.naturalLanguageRequestGrantsExecution, false);
  assert.equal(simulation.decision.allowed, false);
});

test('no raw confirmation token or phrase leakage', async () => {
  const plan = await readSafePlan();
  assert.throws(
    () => assertNoDestructivePlanningRawMaterial({
      ...plan,
      confirmationToken: 'sf_destructive_plan_confirmation_secret_123',
      targetRef: 'target:destructive-safe-ref',
    }),
    (error) => error.code === 'destructive_planning.raw_material_rejected',
  );
  assert.throws(
    () => assertDestructiveExecutionPlanValid({
      ...plan,
      targetRef: 'sf_destructive_target_private_secret_456',
    }),
    (error) => error.code === 'destructive_planning.plan_invalid'
      || error.code === 'destructive_planning.raw_material_rejected',
  );
  const simulation = simulateDestructiveExecutionPlan(clone(plan), {
    taskText: 'please delete',
    confirmDestructive: true,
  });
  assert.doesNotMatch(JSON.stringify(simulation), DESTRUCTIVE_CANARIES);
});
