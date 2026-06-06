// @ts-check

import {
  EXECUTION_GATES,
  assertGovernedExecutionPolicyDecisionCompatible,
  assertNoExecutionSensitiveMaterial,
  assertRuntimeInvocationRequestCompatible,
} from '../../domain/policies/execution/index.mjs';

function uniqueOrderedGates(values = []) {
  const set = new Set(values.filter((gate) => EXECUTION_GATES.includes(gate)));
  return EXECUTION_GATES.filter((gate) => set.has(gate));
}

function gateSatisfiedFromValue(value) {
  return value === true || value?.satisfied === true;
}

function gateSatisfied(gate, status = {}, governanceGates = {}) {
  if (gateSatisfiedFromValue(status?.[gate])) {
    return true;
  }
  if (gate === 'confirm_required') {
    return gateSatisfiedFromValue(governanceGates?.strongConfirmation);
  }
  if (gate === 'audit_required') {
    return gateSatisfiedFromValue(governanceGates?.completeAudit);
  }
  if (gate === 'session_required') {
    return gateSatisfiedFromValue(governanceGates?.runtimeConstraints)
      || governanceGates?.runtimeConstraints?.sessionSatisfied === true;
  }
  if (gate === 'permission_required') {
    return gateSatisfiedFromValue(governanceGates?.sitePolicyExplicitAllow)
      && (
        governanceGates?.runtimeConstraints?.executionGrantSatisfied === true
        || gateSatisfiedFromValue(governanceGates?.runtimeConstraints)
      );
  }
  if (gate === 'output_path_required') {
    return gateSatisfiedFromValue(status?.output_path_required)
      || gateSatisfiedFromValue(governanceGates?.outputPathConstraint);
  }
  if (gate === 'dry_run_required') {
    return gateSatisfiedFromValue(status?.dry_run_required);
  }
  return false;
}

function evaluateGates(requiredGates = [], gateStatus = {}, governanceGates = {}) {
  const gates = uniqueOrderedGates(requiredGates);
  const status = Object.fromEntries(gates.map((gate) => [
    gate,
    { satisfied: gateSatisfied(gate, gateStatus, governanceGates) },
  ]));
  return {
    requiredGates: gates,
    gateStatus: status,
    allSatisfied: gates.every((gate) => status[gate]?.satisfied === true),
  };
}

/** @param {Record<string, any>} options */
export function evaluateRuntimeInvocationDispatch({
  invocationRequest,
  policyDecision,
  gateStatus = null,
} = {}) {
  assertRuntimeInvocationRequestCompatible(invocationRequest);
  assertGovernedExecutionPolicyDecisionCompatible(policyDecision);
  assertNoExecutionSensitiveMaterial({
    invocationRequest,
    policyDecision,
    gateStatus,
  });

  const requiredGates = uniqueOrderedGates([
    ...(policyDecision.gates ?? []),
    ...(invocationRequest.requiredGates ?? []),
  ]);
  const gateEvaluation = evaluateGates(
    requiredGates,
    gateStatus ?? policyDecision.gateStatus ?? {},
    policyDecision.governanceGates ?? {},
  );
  const verdict = policyDecision.verdict;
  const runtimeDispatchAllowed = verdict === 'allow'
    ? requiredGates.length === 0
    : verdict === 'controlled' && gateEvaluation.allSatisfied === true;
  const status = verdict === 'blocked'
    ? 'blocked_by_policy'
    : verdict === 'allow'
      ? runtimeDispatchAllowed ? 'ready_for_direct_runtime' : 'blocked_by_gates'
      : runtimeDispatchAllowed ? 'ready_for_controlled_runtime' : 'blocked_by_gates';

  const report = {
    schemaVersion: invocationRequest.schemaVersion,
    executionVersion: invocationRequest.executionVersion,
    reportType: 'RuntimeDispatchDecision',
    runtimeBoundary: 'app/runtime',
    requestId: invocationRequest.requestId,
    capabilityId: invocationRequest.capabilityId,
    executionContractRef: invocationRequest.executionContractRef,
    policyDecisionRef: invocationRequest.policyDecisionRef,
    verdict,
    gates: requiredGates,
    gateEvaluation,
    status,
    runtimeDispatchAllowed,
    siteAdapterInvocationAllowed: runtimeDispatchAllowed && policyDecision.siteAdapterInvocationAllowed === true,
    downloaderInvocationAllowed: runtimeDispatchAllowed && policyDecision.downloaderInvocationAllowed === true,
    sessionContextUseAllowed: runtimeDispatchAllowed && policyDecision.sessionContextUseAllowed === true,
    runtimeExecuted: false,
    sideEffectAttempted: false,
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(report);
  return report;
}
