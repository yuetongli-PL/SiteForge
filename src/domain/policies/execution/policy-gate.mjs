// @ts-check

import {
  EXECUTION_GATES,
  EXECUTION_VERDICTS,
  SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
  SITE_CAPABILITY_EXECUTION_VERSION,
} from './schema.mjs';
import {
  assertLayerExecutionHandoffDescriptorCompatible,
  assertNoExecutionSensitiveMaterial,
} from './validator.mjs';

function fail(message, code = 'execution.policy_denied') {
  /** @type {Error & Record<string, any>} */
  const error = new Error(message);
  error.code = code;
  throw error;
}

function uniqueOrderedGates(values = []) {
  const set = new Set(values.filter((value) => EXECUTION_GATES.includes(value)));
  return EXECUTION_GATES.filter((gate) => set.has(gate));
}

function normalizeVerdict(value, fallback = 'blocked') {
  if (value === 'confirm_required') {
    return 'controlled';
  }
  return EXECUTION_VERDICTS.includes(value) ? value : fallback;
}

function gatesFromPolicyInputs({
  gates = [],
  confirmationRequired = false,
  destructiveConfirmationRequired = false,
  strongConfirmationRequired = false,
  highRiskAction = false,
  destructiveAction = false,
  paymentOrFundsAction = false,
  auditRequired = true,
  sessionRequired = false,
  permissionRequired = false,
  outputPathRequired = false,
  dryRunRequired = false,
} = {}) {
  return uniqueOrderedGates([
    ...gates,
    confirmationRequired === true
      || destructiveConfirmationRequired === true
      || strongConfirmationRequired === true
      || highRiskAction === true
      || destructiveAction === true
      || paymentOrFundsAction === true
      ? 'confirm_required'
      : null,
    auditRequired === true
      || highRiskAction === true
      || destructiveAction === true
      || paymentOrFundsAction === true
      ? 'audit_required'
      : null,
    sessionRequired === true ? 'session_required' : null,
    permissionRequired === true
      || highRiskAction === true
      || destructiveAction === true
      || paymentOrFundsAction === true
      ? 'permission_required'
      : null,
    outputPathRequired === true ? 'output_path_required' : null,
    dryRunRequired === true ? 'dry_run_required' : null,
  ]);
}

function gateStatusSatisfied(decision) {
  if (!Array.isArray(decision.gates) || decision.gates.length === 0) {
    return true;
  }
  if (decision.gateStatus?.allSatisfied === true || decision.governanceGates?.allSatisfied === true) {
    return true;
  }
  return decision.gates.every((gate) => decision.gateStatus?.[gate]?.satisfied === true);
}

export function assertExecutionPolicyDecisionCompatible(decision) {
  if (decision?.schemaVersion !== SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION) {
    fail('ExecutionPolicyDecision schemaVersion is not compatible', 'execution.version_incompatible');
  }
  if (decision.executionVersion !== SITE_CAPABILITY_EXECUTION_VERSION) {
    fail('ExecutionPolicyDecision executionVersion is not compatible', 'execution.version_incompatible');
  }
  if (decision.decisionType !== 'ExecutionPolicyDecision') {
    fail('ExecutionPolicyDecision decisionType is required');
  }
  if (decision.handoffTarget !== 'site-capability-layer') {
    fail('ExecutionPolicyDecision target must be site-capability-layer', 'execution.layer_handoff_unavailable');
  }
  if (
    decision.descriptorOnly !== true
    || decision.redactionRequired !== true
    || decision.executionAttempted !== false
    || decision.directDownloaderInvocationAllowed !== false
    || decision.directSiteAdapterInvocationAllowed !== false
    || decision.sessionViewAllowed !== false
    || decision.rawCredentialMaterialAllowed !== false
  ) {
    fail('ExecutionPolicyDecision must remain descriptor-only with direct runtime disabled');
  }
  assertNoExecutionSensitiveMaterial(decision);
  return true;
}

export function assertGovernedExecutionPolicyDecisionCompatible(decision) {
  if (decision?.schemaVersion !== SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION) {
    fail('GovernedExecutionPolicyDecision schemaVersion is not compatible', 'execution.version_incompatible');
  }
  if (decision.executionVersion !== SITE_CAPABILITY_EXECUTION_VERSION) {
    fail('GovernedExecutionPolicyDecision executionVersion is not compatible', 'execution.version_incompatible');
  }
  if (decision.decisionType !== 'GovernedExecutionPolicyDecision') {
    fail('GovernedExecutionPolicyDecision decisionType is required');
  }
  if (!EXECUTION_VERDICTS.includes(decision.verdict)) {
    fail('GovernedExecutionPolicyDecision verdict is unsupported', 'execution.policy_denied');
  }
  if (decision.disposition !== undefined && !EXECUTION_VERDICTS.includes(decision.disposition)) {
    fail('GovernedExecutionPolicyDecision disposition must mirror final verdict', 'execution.policy_denied');
  }
  if (!Array.isArray(decision.gates) || decision.gates.some((gate) => !EXECUTION_GATES.includes(gate))) {
    fail('GovernedExecutionPolicyDecision gates are unsupported', 'execution.policy_denied');
  }
  if (decision.verdict === 'allow' && decision.gates.length > 0) {
    fail('Allow governed execution cannot require gates');
  }
  if (
    (decision.highRiskAction === true || decision.destructiveAction === true || decision.paymentOrFundsAction === true)
    && decision.verdict === 'allow'
  ) {
    fail('High-risk governed execution must be controlled or blocked');
  }
  if (decision.redactionRequired !== true || decision.rawCredentialMaterialAllowed !== false) {
    fail('GovernedExecutionPolicyDecision must keep redaction and raw credential boundaries');
  }
  if (decision.verdict === 'blocked' && decision.runtimeDispatchAllowed === true) {
    fail('Blocked governed execution cannot allow runtime dispatch');
  }
  if (decision.naturalLanguageRequestGrantsExecution === true) {
    fail('Natural-language requests are not governed execution authorization');
  }
  if ((decision.highRiskAction === true || decision.destructiveAction === true || decision.paymentOrFundsAction === true)
    && decision.runtimeDispatchAllowed === true
    && !gateStatusSatisfied(decision)) {
    fail('High-risk governed execution cannot dispatch without satisfied governance gates');
  }
  if (decision.verdict === 'controlled' && decision.runtimeDispatchAllowed === true && !gateStatusSatisfied(decision)) {
    fail('Controlled governed execution cannot dispatch without satisfied gates');
  }
  if (decision.destructiveConfirmationRequired === true
    && decision.runtimeDispatchAllowed === true
    && !gateStatusSatisfied(decision)) {
    fail('Destructive governed execution cannot dispatch without confirmation');
  }
  assertNoExecutionSensitiveMaterial(decision);
  return true;
}

/** @param {Record<string, any>} options */
export function createExecutionPolicyDecision({
  handoffDescriptor,
  plannerHandoffRef,
  governedLayerEntrypointAvailable = true,
  approvalSatisfied = false,
  policyMode = 'preflight_only',
  ...rest
} = {}) {
  assertLayerExecutionHandoffDescriptorCompatible(handoffDescriptor);
  assertNoExecutionSensitiveMaterial({
    plannerHandoffRef,
    governedLayerEntrypointAvailable,
    approvalSatisfied,
    policyMode,
    ...rest,
  });
  const preflightPassed = governedLayerEntrypointAvailable === true && approvalSatisfied === true;
  const decision = {
    schemaVersion: SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
    executionVersion: SITE_CAPABILITY_EXECUTION_VERSION,
    decisionType: 'ExecutionPolicyDecision',
    policyMode,
    decisionStatus: preflightPassed ? 'ready_for_layer_governed_dispatch' : 'blocked',
    reasonCode: preflightPassed ? undefined : 'execution.approval_required',
    executionId: handoffDescriptor.executionId,
    capabilityPlanRef: handoffDescriptor.capabilityPlanRef,
    plannerHandoffRef,
    graphVersion: handoffDescriptor.graphVersion,
    plannerVersion: handoffDescriptor.plannerVersion,
    layerCompatibilityVersion: handoffDescriptor.layerCompatibilityVersion,
    handoffTarget: 'site-capability-layer',
    governedLayerEntrypointAvailable,
    approvalSatisfied,
    layerGovernedDispatchReady: preflightPassed,
    descriptorOnly: true,
    executionAttempted: false,
    directDownloaderInvocationAllowed: false,
    directSiteAdapterInvocationAllowed: false,
    sessionViewAllowed: false,
    rawCredentialMaterialAllowed: false,
    redactionRequired: true,
  };
  assertExecutionPolicyDecisionCompatible(decision);
  return decision;
}

/** @param {Record<string, any>} options */
export function createGovernedExecutionPolicyDecision({
  executionId,
  capabilityId,
  executionContractRef,
  verdict,
  disposition = 'blocked',
  gates = [],
  gateStatus = null,
  runtimeDispatchAllowed = false,
  siteAdapterInvocationAllowed = false,
  downloaderInvocationAllowed = false,
  sessionMaterializationAllowed = false,
  sessionContextUseAllowed = false,
  sessionRequired = false,
  confirmationRequired = false,
  destructiveConfirmationRequired = false,
  strongConfirmationRequired = false,
  permissionRequired = false,
  outputPathRequired = false,
  dryRunRequired = false,
  highRiskAction = false,
  destructiveAction = false,
  paymentOrFundsAction = false,
  governanceGates = null,
  naturalLanguageRequestGrantsExecution = false,
  auditRequired = true,
  reasonCode,
  ...rest
} = {}) {
  if (verdict === 'confirm_required') {
    fail('GovernedExecutionPolicyDecision verdict is unsupported', 'execution.policy_denied');
  }
  assertNoExecutionSensitiveMaterial({
    executionId,
    capabilityId,
    executionContractRef,
    verdict,
    disposition,
    gates,
    gateStatus,
    reasonCode,
    governanceGates,
    naturalLanguageRequestGrantsExecution,
    ...rest,
  });
  const resolvedVerdict = normalizeVerdict(verdict ?? disposition);
  const resolvedGates = resolvedVerdict === 'allow'
    ? uniqueOrderedGates(gates)
    : gatesFromPolicyInputs({
      gates,
      confirmationRequired,
      destructiveConfirmationRequired,
      strongConfirmationRequired,
      highRiskAction,
      destructiveAction,
      paymentOrFundsAction,
      auditRequired,
      sessionRequired,
      permissionRequired,
      outputPathRequired,
      dryRunRequired,
    });
  const blocked = resolvedVerdict === 'blocked';
  const decision = {
    schemaVersion: SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
    executionVersion: SITE_CAPABILITY_EXECUTION_VERSION,
    decisionType: 'GovernedExecutionPolicyDecision',
    executionId,
    capabilityId,
    executionContractRef,
    verdict: resolvedVerdict,
    gates: resolvedGates,
    gateStatus,
    disposition: resolvedVerdict,
    controlledRuntimePathAllowed: !blocked,
    runtimeDispatchAllowed: blocked ? false : runtimeDispatchAllowed === true,
    siteAdapterInvocationAllowed: blocked ? false : siteAdapterInvocationAllowed === true,
    downloaderInvocationAllowed: blocked ? false : downloaderInvocationAllowed === true,
    sessionContextUseAllowed: blocked
      ? false
      : sessionContextUseAllowed === true || sessionMaterializationAllowed === true,
    sessionRequired: sessionRequired === true,
    confirmationRequired: confirmationRequired === true,
    destructiveConfirmationRequired: destructiveConfirmationRequired === true,
    strongConfirmationRequired: strongConfirmationRequired === true,
    permissionRequired: permissionRequired === true,
    outputPathRequired: outputPathRequired === true,
    dryRunRequired: dryRunRequired === true,
    highRiskAction: highRiskAction === true,
    destructiveAction: destructiveAction === true,
    paymentOrFundsAction: paymentOrFundsAction === true,
    governanceGates,
    naturalLanguageRequestGrantsExecution: naturalLanguageRequestGrantsExecution === true,
    auditRequired: auditRequired === true,
    rawCredentialMaterialAllowed: false,
    sessionPersistencePolicy: 'no_persistence',
    payloadMaterialPolicy: 'template_or_redacted_only',
    redactionRequired: true,
    reasonCode: reasonCode ?? (
      resolvedVerdict === 'blocked'
        ? 'execution.policy_blocked'
        : resolvedGates.includes('confirm_required') && runtimeDispatchAllowed !== true
          ? 'execution.confirmation_required'
          : 'execution.governed_dispatch_allowed'
    ),
    ...rest,
  };
  assertGovernedExecutionPolicyDecisionCompatible(decision);
  return decision;
}
