import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRuntimeInvocationRequest,
} from '../../src/app/planner/index.mjs';
import {
  evaluateRuntimeInvocationDispatch,
} from '../../src/app/runtime/index.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../src/domain/policies/execution/index.mjs';

function createRequest(overrides = {}) {
  return createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: 'synthetic.example',
      capabilityId: 'capability:synthetic:update-record',
    },
    executionContractRef: 'execution-contract:synthetic-update-record',
    policyDecisionRef: 'policy:synthetic-update-record',
    ...overrides,
  });
}

test('runtime dispatcher allows direct runtime only for allow verdict without gates', () => {
  const request = createRequest({ verdictHint: 'allow' });
  const policyDecision = createGovernedExecutionPolicyDecision({
    executionId: 'execution:synthetic',
    capabilityId: 'capability:synthetic:update-record',
    executionContractRef: 'execution-contract:synthetic-update-record',
    verdict: 'allow',
    runtimeDispatchAllowed: true,
    siteAdapterInvocationAllowed: true,
    auditRequired: false,
  });

  const report = evaluateRuntimeInvocationDispatch({ invocationRequest: request, policyDecision });

  assert.equal(report.status, 'ready_for_direct_runtime');
  assert.equal(report.verdict, 'allow');
  assert.deepEqual(report.gates, []);
  assert.equal(report.runtimeDispatchAllowed, true);
  assert.equal(report.siteAdapterInvocationAllowed, true);
  assert.equal(report.runtimeExecuted, false);
  assert.equal(report.sideEffectAttempted, false);
});

test('runtime dispatcher blocks controlled runtime until required gates are satisfied', () => {
  const request = createRequest({
    verdictHint: 'controlled',
    requiredGates: ['confirm_required', 'audit_required'],
  });
  const policyDecision = createGovernedExecutionPolicyDecision({
    executionId: 'execution:synthetic',
    capabilityId: 'capability:synthetic:update-record',
    executionContractRef: 'execution-contract:synthetic-update-record',
    verdict: 'controlled',
    gates: ['confirm_required', 'audit_required'],
    confirmationRequired: true,
    auditRequired: true,
    runtimeDispatchAllowed: false,
  });

  const report = evaluateRuntimeInvocationDispatch({ invocationRequest: request, policyDecision });

  assert.equal(report.status, 'blocked_by_gates');
  assert.equal(report.verdict, 'controlled');
  assert.deepEqual(report.gates, ['confirm_required', 'audit_required']);
  assert.equal(report.gateEvaluation.allSatisfied, false);
  assert.equal(report.runtimeDispatchAllowed, false);
});

test('runtime dispatcher permits controlled runtime after gates are satisfied', () => {
  const request = createRequest({
    verdictHint: 'controlled',
    requiredGates: ['confirm_required', 'audit_required', 'permission_required'],
  });
  const policyDecision = createGovernedExecutionPolicyDecision({
    executionId: 'execution:synthetic',
    capabilityId: 'capability:synthetic:update-record',
    executionContractRef: 'execution-contract:synthetic-update-record',
    verdict: 'controlled',
    gates: ['confirm_required', 'audit_required', 'permission_required'],
    confirmationRequired: true,
    auditRequired: true,
    permissionRequired: true,
    runtimeDispatchAllowed: true,
    siteAdapterInvocationAllowed: true,
    gateStatus: {
      allSatisfied: true,
      confirm_required: { satisfied: true },
      audit_required: { satisfied: true },
      permission_required: { satisfied: true },
    },
  });

  const report = evaluateRuntimeInvocationDispatch({ invocationRequest: request, policyDecision });

  assert.equal(report.status, 'ready_for_controlled_runtime');
  assert.equal(report.runtimeDispatchAllowed, true);
  assert.equal(report.siteAdapterInvocationAllowed, true);
  assert.equal(report.gateEvaluation.allSatisfied, true);
});

test('runtime dispatcher never dispatches blocked verdicts', () => {
  const request = createRequest({ verdictHint: 'blocked' });
  const policyDecision = createGovernedExecutionPolicyDecision({
    executionId: 'execution:synthetic',
    capabilityId: 'capability:synthetic:delete-record',
    executionContractRef: 'execution-contract:synthetic-delete-record',
    verdict: 'blocked',
    gates: ['confirm_required', 'audit_required', 'permission_required'],
    highRiskAction: true,
    destructiveAction: true,
    runtimeDispatchAllowed: true,
  });

  const report = evaluateRuntimeInvocationDispatch({ invocationRequest: request, policyDecision });

  assert.equal(report.status, 'blocked_by_policy');
  assert.equal(report.verdict, 'blocked');
  assert.equal(report.runtimeDispatchAllowed, false);
  assert.equal(report.siteAdapterInvocationAllowed, false);
});
