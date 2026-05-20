// @ts-check

import {
  SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
  SITE_CAPABILITY_EXECUTION_VERSION,
} from './schema.mjs';
import {
  assertLayerExecutionHandoffDescriptorCompatible,
  assertNoExecutionSensitiveMaterial,
} from './validator.mjs';

function fail(message, code = 'execution.policy_denied') {
  const error = new Error(message);
  error.code = code;
  throw error;
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
