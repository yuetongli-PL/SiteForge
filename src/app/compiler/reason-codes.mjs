// @ts-check

const DEFINITIONS = Object.freeze({
  'compiler.request_invalid': { retryable: false, cooldownRequired: false, manualInterventionRequired: true, degradable: false, artifactWriteAllowed: false, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'compiler.scope_invalid': { retryable: false, cooldownRequired: false, manualInterventionRequired: true, degradable: false, artifactWriteAllowed: false, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'compiler.capability_intake_invalid': { retryable: false, cooldownRequired: false, manualInterventionRequired: true, degradable: false, artifactWriteAllowed: false, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'compiler.scope_blocked': { retryable: true, cooldownRequired: true, manualInterventionRequired: true, degradable: true, artifactWriteAllowed: true, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'compiler.source_unavailable': { retryable: true, cooldownRequired: false, manualInterventionRequired: false, degradable: true, artifactWriteAllowed: true, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'compiler.source_not_redacted': { retryable: false, cooldownRequired: false, manualInterventionRequired: true, degradable: false, artifactWriteAllowed: false, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'compiler.raw_sensitive_material_rejected': { retryable: false, cooldownRequired: false, manualInterventionRequired: true, degradable: false, artifactWriteAllowed: false, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'compiler.manifest_invalid': { retryable: false, cooldownRequired: false, manualInterventionRequired: true, degradable: false, artifactWriteAllowed: false, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'compiler.node_inventory_invalid': { retryable: false, cooldownRequired: false, manualInterventionRequired: true, degradable: true, artifactWriteAllowed: true, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'compiler.capability_inventory_invalid': { retryable: false, cooldownRequired: false, manualInterventionRequired: true, degradable: true, artifactWriteAllowed: true, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'compiler.execution_path_invalid': { retryable: false, cooldownRequired: false, manualInterventionRequired: true, degradable: true, artifactWriteAllowed: true, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'compiler.unknown_node_detected': { retryable: true, cooldownRequired: false, manualInterventionRequired: false, degradable: true, artifactWriteAllowed: true, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'compiler.coverage_incomplete': { retryable: true, cooldownRequired: false, manualInterventionRequired: false, degradable: true, artifactWriteAllowed: true, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'compiler.redaction_required': { retryable: false, cooldownRequired: false, manualInterventionRequired: true, degradable: false, artifactWriteAllowed: false, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'compiler.redaction_failed': { retryable: false, cooldownRequired: false, manualInterventionRequired: true, degradable: false, artifactWriteAllowed: false, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'compiler.graph_build_failed': { retryable: false, cooldownRequired: false, manualInterventionRequired: true, degradable: false, artifactWriteAllowed: true, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'execution.plan_invalid': { retryable: false, cooldownRequired: false, manualInterventionRequired: true, degradable: false, artifactWriteAllowed: false, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'execution.layer_handoff_unavailable': { retryable: true, cooldownRequired: false, manualInterventionRequired: true, degradable: true, artifactWriteAllowed: true, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'execution.policy_denied': { retryable: false, cooldownRequired: false, manualInterventionRequired: true, degradable: true, artifactWriteAllowed: true, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'execution.auth_required': { retryable: true, cooldownRequired: false, manualInterventionRequired: true, degradable: true, artifactWriteAllowed: false, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'execution.session_required': { retryable: true, cooldownRequired: false, manualInterventionRequired: true, degradable: true, artifactWriteAllowed: false, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'execution.signer_required': { retryable: true, cooldownRequired: false, manualInterventionRequired: true, degradable: true, artifactWriteAllowed: false, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'execution.approval_required': { retryable: true, cooldownRequired: false, manualInterventionRequired: true, degradable: true, artifactWriteAllowed: false, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'execution.redaction_failed': { retryable: false, cooldownRequired: false, manualInterventionRequired: true, degradable: false, artifactWriteAllowed: false, plannerHandoffAllowed: false, layerHandoffAllowed: false },
  'execution.feedback_write_failed': { retryable: true, cooldownRequired: false, manualInterventionRequired: true, degradable: true, artifactWriteAllowed: false, plannerHandoffAllowed: false, layerHandoffAllowed: false },
});

export function listCompilerExecutorReasonCodeDefinitions() {
  return Object.entries(DEFINITIONS).map(([code, definition]) => ({
    code,
    ...definition,
  }));
}

export function requireCompilerExecutorReasonCodeDefinition(code) {
  const definition = DEFINITIONS[code];
  if (!definition) {
    const error = new Error('Unknown compiler/executor reasonCode');
    error.code = 'compiler.reason_code_unknown';
    throw error;
  }
  return {
    code,
    ...definition,
  };
}
