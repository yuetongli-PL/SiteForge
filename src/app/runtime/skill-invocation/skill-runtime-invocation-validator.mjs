// @ts-check

import {
  SKILL_RUNTIME_INVOCATION_MODES,
  SKILL_RUNTIME_INVOCATION_POLICY_MODES,
  SKILL_RUNTIME_INVOCATION_SCHEMA_VERSION,
  SKILL_RUNTIME_INVOCATION_SAFE_REF_PATTERN,
} from './skill-runtime-invocation-schema.mjs';
import {
  assertNoSkillInvocationRawMaterial,
  sanitizeSkillRuntimeInvocationRequest,
} from './skill-runtime-invocation-sanitizer.mjs';

function fail(message, code, details = undefined) {
  const error = new Error(message);
  // @ts-ignore
  error.code = code;
  if (details !== undefined) {
    // @ts-ignore
    error.details = details;
  }
  throw error;
}

function safeRefPresent(value) {
  return typeof value === 'string' && SKILL_RUNTIME_INVOCATION_SAFE_REF_PATTERN.test(value);
}

export function validateSkillRuntimeInvocationRequest(input = {}) {
  try {
    const sanitized = sanitizeSkillRuntimeInvocationRequest(input);
    const errors = [];
    if (sanitized.schemaVersion !== SKILL_RUNTIME_INVOCATION_SCHEMA_VERSION) errors.push('schemaVersion');
    if (sanitized.requestType !== 'SkillRuntimeInvocationRequest') errors.push('requestType');
    if (!safeRefPresent(sanitized.requestId)) errors.push('requestId');
    if (!safeRefPresent(sanitized.skillId)) errors.push('skillId');
    if (!safeRefPresent(sanitized.capabilityRef)) errors.push('capabilityRef');
    if (!safeRefPresent(sanitized.executionContractRef)) errors.push('executionContractRef');
    if (!SKILL_RUNTIME_INVOCATION_MODES.includes(sanitized.mode)) errors.push('mode');
    if (!safeRefPresent(sanitized.idempotencyKey)) errors.push('idempotencyKey');
    if (!SKILL_RUNTIME_INVOCATION_POLICY_MODES.includes(sanitized.policyMode)) errors.push('policyMode');
    if (sanitized.policyMode !== 'simulate' && !safeRefPresent(sanitized.policyDecisionRef)) {
      errors.push('policyDecisionRef');
    }
    for (const [slotName, binding] of Object.entries(sanitized.slots ?? {})) {
      if (!safeRefPresent(slotName) || !safeRefPresent(binding.slotRef)) {
        errors.push(`slot:${slotName}`);
      }
    }
    if (
      sanitized.auth !== null
      && sanitized.auth.sessionRef
      && !safeRefPresent(sanitized.auth.sessionRef)
    ) {
      errors.push('auth.sessionRef');
    }
    if (
      sanitized.taskTextGrantsAuthorization !== false
      || sanitized.naturalLanguageRequestGrantsExecution !== false
      || sanitized.rawMaterialPersisted !== false
    ) {
      errors.push('authorizationBoundary');
    }
    return {
      ok: errors.length === 0,
      errors,
      sanitized,
    };
  } catch (error) {
    return {
      ok: false,
      errors: [error.code ?? error.message],
      sanitized: null,
    };
  }
}

export function assertSkillRuntimeInvocationRequestValid(input = {}) {
  const report = validateSkillRuntimeInvocationRequest(input);
  if (!report.ok) {
    fail('Skill runtime invocation request is invalid', 'skill_invocation.request_invalid', report.errors);
  }
  assertNoSkillInvocationRawMaterial(report.sanitized);
  return report.sanitized;
}

export function createSkillRuntimeInvocationRequest(input = {}) {
  return assertSkillRuntimeInvocationRequestValid(input);
}
