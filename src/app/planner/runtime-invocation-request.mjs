// @ts-check

import {
  EXECUTION_GATES,
  EXECUTION_VERDICTS,
  SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
  SITE_CAPABILITY_EXECUTION_VERSION,
  assertNoExecutionSensitiveMaterial,
  assertRuntimeInvocationRequestCompatible,
} from '../../domain/policies/execution/index.mjs';
import {
  SITE_CAPABILITY_PLANNER_VERSION,
} from './schema.mjs';

function normalizeText(value) {
  return String(value ?? '').trim();
}

function safeIdPart(value, fallback = 'item') {
  const text = normalizeText(value);
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 96);
  return normalized || fallback;
}

function normalizeVerdictHint(value) {
  return EXECUTION_VERDICTS.includes(value) ? value : 'controlled';
}

function normalizeGates(values = []) {
  const set = new Set((Array.isArray(values) ? values : []).filter((value) => EXECUTION_GATES.includes(value)));
  return EXECUTION_GATES.filter((gate) => set.has(gate));
}

function planReference(capabilityPlan = /** @type {any} */ ({})) {
  if (capabilityPlan.planId) return String(capabilityPlan.planId);
  const siteId = safeIdPart(capabilityPlan.siteId, 'site');
  const capabilityId = safeIdPart(capabilityPlan.capabilityId, 'capability');
  return `plan:${siteId}:${capabilityId}`;
}

function intentReference(executionIntent = /** @type {any} */ ({}), capabilityId = 'capability') {
  if (executionIntent.intentRef) return String(executionIntent.intentRef);
  if (executionIntent.id) return `intent:${safeIdPart(executionIntent.id, 'intent')}`;
  if (executionIntent.intentId) return `intent:${safeIdPart(executionIntent.intentId, 'intent')}`;
  return `intent:${safeIdPart(capabilityId, 'capability')}`;
}

/** @param {Record<string, any>} options */
export function createRuntimeInvocationRequest({
  capabilityPlan = null,
  executionIntent = null,
  executionContractRef,
  policyDecisionRef = undefined,
  verdictHint = 'controlled',
  requiredGates = [],
  requestId,
  taskId = undefined,
  traceId = undefined,
  correlationId = undefined,
} = {}) {
  const capabilityId = normalizeText(capabilityPlan?.capabilityId ?? executionIntent?.capabilityId);
  const contractRef = normalizeText(executionContractRef ?? executionIntent?.executionContractRef ?? capabilityPlan?.executionContractRef);
  const planRef = capabilityPlan ? planReference(capabilityPlan) : undefined;
  const intentRef = executionIntent ? intentReference(executionIntent, capabilityId) : undefined;
  const normalizedRequestId = normalizeText(requestId)
    || `runtime-invocation:${safeIdPart(capabilityId, 'capability')}:${safeIdPart(contractRef, 'contract')}`;

  assertNoExecutionSensitiveMaterial({
    requestId: normalizedRequestId,
    capabilityId,
    executionContractRef: contractRef,
    policyDecisionRef,
    planRef,
    intentRef,
    verdictHint,
    requiredGates,
    taskId,
    traceId,
    correlationId,
  });

  const request = {
    schemaVersion: SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
    executionVersion: SITE_CAPABILITY_EXECUTION_VERSION,
    plannerVersion: SITE_CAPABILITY_PLANNER_VERSION,
    requestType: 'RuntimeInvocationRequest',
    runtimeBoundary: 'app/runtime',
    requestId: normalizedRequestId,
    taskId,
    traceId,
    correlationId,
    capabilityId,
    planRef,
    intentRef,
    executionContractRef: contractRef,
    policyDecisionRef,
    verdictHint: normalizeVerdictHint(verdictHint),
    requiredGates: normalizeGates(requiredGates),
    descriptorOnly: true,
    redactionRequired: true,
    executionAttempted: false,
    sideEffectAttempted: false,
    rawCredentialMaterialAllowed: false,
    materialPolicy: 'references_and_redacted_templates_only',
  };
  assertRuntimeInvocationRequestCompatible(request);
  return request;
}
