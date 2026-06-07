// @ts-check

import {
  SKILL_RUNTIME_INVOCATION_RESULT_SCHEMA_VERSION,
  SKILL_RUNTIME_INVOCATION_RESULT_STATUSES,
} from './skill-runtime-invocation-schema.mjs';
import {
  assertNoSkillInvocationRawMaterial,
  safeSkillInvocationRef,
} from './skill-runtime-invocation-sanitizer.mjs';
import {
  assertSkillRuntimeInvocationRequestValid,
} from './skill-runtime-invocation-validator.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function resultStatus(value, fallback = 'blocked') {
  return SKILL_RUNTIME_INVOCATION_RESULT_STATUSES.includes(value) ? value : fallback;
}

function safeOptionalRef(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  return safeSkillInvocationRef(value, fallback ?? '');
}

function runtimeReportSummary(report = null) {
  if (!report) return null;
  return {
    reportType: 'RuntimeExecutionReportSummary',
    status: String(report.status ?? 'blocked'),
    reasonCode: report.reasonCode ?? report.blockedReason ?? null,
    providerId: report.providerId ?? null,
    providerKind: report.providerKind ?? null,
    providerInvoked: report.providerInvoked === true,
    executionAttempted: report.executionAttempted === true,
    runtimeExecuted: report.runtimeExecuted === true,
    sideEffectAttempted: report.sideEffectAttempted === true,
    sideEffectSucceeded: report.sideEffectSucceeded === true,
    sideEffectFailed: report.sideEffectFailed === true,
    artifactRefs: Array.isArray(report.artifactRefs) ? report.artifactRefs : [],
    redactionRequired: true,
  };
}

/** @param {Record<string, any>} options */
export function createSkillRuntimeInvocationResult({
  request,
  status = 'blocked',
  reasonCode = null,
  dryRunPreview = null,
  runtimeInvocationRequest = null,
  runtimeReport = null,
  idempotencyStatus = 'new',
} = {}) {
  const safeRequest = assertSkillRuntimeInvocationRequestValid(request);
  const safeRunId = safeSkillInvocationRef(runtimeReport?.runId, `run:${safeRequest.requestId}`);
  const result = {
    schemaVersion: SKILL_RUNTIME_INVOCATION_RESULT_SCHEMA_VERSION,
    resultType: 'SkillRuntimeInvocationResult',
    runtimeBoundary: 'app/runtime/skill-invocation',
    requestId: safeRequest.requestId,
    skillId: safeRequest.skillId,
    mode: safeRequest.mode,
    capabilityRef: safeRequest.capabilityRef,
    executionContractRef: safeRequest.executionContractRef,
    policyDecisionRef: safeRequest.policyDecisionRef,
    idempotencyKey: safeRequest.idempotencyKey,
    idempotencyStatus,
    status: resultStatus(status),
    reasonCode,
    runId: safeRunId,
    auditViewRef: safeOptionalRef(runtimeReport?.auditRef, `audit-view:${safeRequest.requestId}`),
    runtimeInvocationRequestRef: safeOptionalRef(runtimeInvocationRequest?.requestId, null),
    dryRunPreview,
    runtimeReportSummary: runtimeReportSummary(runtimeReport),
    providerInvoked: runtimeReport?.providerInvoked === true,
    browserInvoked: runtimeReport?.providerId === 'browser_action_provider' && runtimeReport.runtimeExecuted === true,
    vaultAccessed: false,
    networkInvoked: false,
    sideEffectAttempted: runtimeReport?.sideEffectAttempted === true,
    taskTextGrantsAuthorization: false,
    naturalLanguageRequestGrantsExecution: false,
    redactionRequired: true,
  };
  assertNoSkillInvocationRawMaterial(result);
  return clone(result);
}
