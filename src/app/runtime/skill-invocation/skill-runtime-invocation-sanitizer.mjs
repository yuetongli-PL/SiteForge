// @ts-check

import {
  SKILL_RUNTIME_INVOCATION_MODES,
  SKILL_RUNTIME_INVOCATION_POLICY_MODES,
  SKILL_RUNTIME_INVOCATION_SCHEMA_VERSION,
  SKILL_RUNTIME_INVOCATION_SAFE_REF_PATTERN,
} from './skill-runtime-invocation-schema.mjs';

const SKILL_CANARY_PATTERN = /sf_skill_[a-z0-9_]*secret[a-z0-9_]*/iu;
const PAYMENT_CANARY_PATTERN =
  /sf_payment_(?:(?:lab_)?(?:card|bank|token)|authorization_phrase)_secret_[0-9]+/iu;
const FORBIDDEN_FIELD_PATTERN =
  /(?:^|[_-])raw(?:$|[_-])|sessionHandle|cookie|token|authorization|headers?|credential|password|secret|storageState|localStorage|sessionStorage|IndexedDB|requestBody|responseBody|paymentCredential|card|bank/iu;
const FORBIDDEN_VALUE_PATTERN = new RegExp([
  'sf_skill_[a-z0-9_]*secret[a-z0-9_]*',
  'sf_payment_(?:(?:lab_)?(?:card|bank|token)|authorization_phrase)_secret_[0-9]+',
  'authorization:\\s*bearer',
  ['coo', 'kie:'].join(''),
  ['set-coo', 'kie:'].join(''),
  'access[_-]?token',
  'refresh[_-]?token',
  'storageState',
  'localStorage',
  'sessionStorage',
  'IndexedDB',
  'payment\\s+credential',
  'card\\s+number',
].join('|'), 'iu');

const ALLOWED_CONTAINER_FIELDS = new Set([
  'auth',
  'destructiveAuthorization',
  'policyGate',
]);

const ALLOWED_REF_FIELDS = new Set([
  'authzRef',
  'authorizationRef',
  'challengeRef',
  'confirmationRef',
  'policyId',
]);

const ALLOWED_TASK_TEXT_FIELDS = new Set([
  'taskText',
  'description',
]);

const ALLOWED_FALSE_FIELDS = new Set([
  'naturalLanguageRequestGrantsExecution',
  'taskTextGrantsAuthorization',
  'grantsAuthorization',
  'providerInvoked',
  'browserInvoked',
  'vaultAccessed',
  'networkInvoked',
  'sideEffectAttempted',
  'rawMaterialPersisted',
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

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

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function safeIdPart(value, fallback = 'ref') {
  const text = normalizeText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 96);
  return text || fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasForbiddenValue(value) {
  return FORBIDDEN_VALUE_PATTERN.test(value)
    || SKILL_CANARY_PATTERN.test(value)
    || PAYMENT_CANARY_PATTERN.test(value);
}

function scanForbidden(value, findings = [], path = []) {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      scanForbidden(entry, findings, [...path, String(index)]);
    }
    return findings;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (ALLOWED_FALSE_FIELDS.has(key) && entry === false) {
        continue;
      }
      if (ALLOWED_CONTAINER_FIELDS.has(key)) {
        scanForbidden(entry, findings, [...path, key]);
        continue;
      }
      if (ALLOWED_REF_FIELDS.has(key) && typeof entry === 'string' && !hasForbiddenValue(entry)) {
        continue;
      }
      if (FORBIDDEN_FIELD_PATTERN.test(key)) {
        findings.push({ path: [...path, key].join('.') });
        continue;
      }
      scanForbidden(entry, findings, [...path, key]);
    }
    return findings;
  }
  const key = path[path.length - 1] ?? '';
  if (
    typeof value === 'string'
    && !ALLOWED_TASK_TEXT_FIELDS.has(key)
    && hasForbiddenValue(value)
  ) {
    findings.push({ path: path.join('.') || '<root>' });
  }
  return findings;
}

export function assertNoSkillInvocationRawMaterial(value) {
  const findings = scanForbidden(value);
  if (findings.length > 0) {
    fail('Skill runtime invocation contains forbidden raw material', 'skill_invocation.raw_material_rejected', {
      findings,
    });
  }
  return true;
}

export function safeSkillInvocationRef(value, fallback = '') {
  const text = normalizeText(value, fallback);
  if (!text) return fallback;
  if (hasForbiddenValue(text)) {
    fail('Skill runtime invocation ref contains forbidden raw material', 'skill_invocation.raw_material_rejected');
  }
  const safe = text
    .replace(/[\s"'`<>\\?&=%#]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 200);
  if (!safe || !SKILL_RUNTIME_INVOCATION_SAFE_REF_PATTERN.test(safe)) {
    fail('Skill runtime invocation ref is invalid', 'skill_invocation.ref_invalid', { value: safe });
  }
  return safe;
}

function safeTaskText(value) {
  const text = normalizeText(value);
  if (!text) return '';
  if (hasForbiddenValue(text)) {
    return '[redacted]';
  }
  return text.replace(/\s+/gu, ' ').slice(0, 280);
}

function sanitizeSlots(slots = {}) {
  if (slots === undefined || slots === null) return {};
  if (!isPlainObject(slots)) {
    fail('Skill invocation slots must be an object of safe slot refs', 'skill_invocation.slots_invalid');
  }
  const sanitized = {};
  for (const [name, binding] of Object.entries(slots)) {
    if (!isPlainObject(binding)) {
      fail('Skill invocation slot binding must be descriptor-only', 'skill_invocation.slots_invalid');
    }
    if (
      Object.prototype.hasOwnProperty.call(binding, 'value')
      || Object.prototype.hasOwnProperty.call(binding, 'rawValue')
      || Object.prototype.hasOwnProperty.call(binding, 'body')
    ) {
      fail('Skill invocation slot binding cannot carry raw values', 'skill_invocation.raw_material_rejected');
    }
    const slotName = safeIdPart(name, 'slot');
    sanitized[slotName] = {
      slotRef: safeSkillInvocationRef(binding.slotRef, `slot:${slotName}`),
      required: binding.required === true,
    };
  }
  return sanitized;
}

function sanitizeAuth(auth = null) {
  if (auth === undefined || auth === null) return null;
  if (!isPlainObject(auth)) {
    fail('Skill invocation auth must be a descriptor-only object', 'skill_invocation.auth_invalid');
  }
  if (auth.sessionHandle !== undefined) {
    fail('Skill invocation auth must use sessionRef, not sessionHandle', 'skill_invocation.raw_material_rejected');
  }
  return {
    sessionRef: auth.sessionRef === undefined ? '' : safeSkillInvocationRef(auth.sessionRef, ''),
    material: 'ref_only',
  };
}

function sanitizeDestructiveAuthorization(authorization = null) {
  if (authorization === undefined || authorization === null) return null;
  if (!isPlainObject(authorization)) {
    fail('Skill destructive authorization must be structured refs only', 'skill_invocation.destructive_authorization_invalid');
  }
  const policyGate = isPlainObject(authorization.policyGate) ? authorization.policyGate : {};
  return {
    authzRef: safeSkillInvocationRef(authorization.authzRef ?? authorization.authorizationRef, ''),
    challengeRef: safeSkillInvocationRef(authorization.challengeRef, ''),
    confirmationRef: safeSkillInvocationRef(authorization.confirmationRef, ''),
    policyGate: {
      satisfied: policyGate.satisfied === true,
      policyId: policyGate.policyId === undefined ? '' : safeSkillInvocationRef(policyGate.policyId, ''),
    },
    material: 'ref_only',
  };
}

export function sanitizeSkillRuntimeInvocationRequest(input = {}) {
  assertNoSkillInvocationRawMaterial(input);
  const skillId = safeSkillInvocationRef(input.skillId, '');
  const capabilityRef = safeSkillInvocationRef(input.capabilityRef, '');
  const executionContractRef = safeSkillInvocationRef(input.executionContractRef, '');
  const policyMode = SKILL_RUNTIME_INVOCATION_POLICY_MODES.includes(input.policyMode)
    ? input.policyMode
    : 'decision_ref_required';
  const policyDecisionFallback = policyMode === 'simulate'
    ? `policy-decision:simulated:${safeIdPart(capabilityRef, 'capability')}`
    : '';
  const requestId = safeSkillInvocationRef(
    input.requestId,
    `skill-invocation:${safeIdPart(skillId, 'skill')}:${safeIdPart(capabilityRef, 'capability')}`,
  );
  const mode = SKILL_RUNTIME_INVOCATION_MODES.includes(input.mode) ? input.mode : 'dryRun';
  const sanitized = {
    schemaVersion: SKILL_RUNTIME_INVOCATION_SCHEMA_VERSION,
    requestType: 'SkillRuntimeInvocationRequest',
    runtimeBoundary: 'app/runtime/skill-invocation',
    requestId,
    skillId,
    packageId: input.packageId === undefined ? '' : safeSkillInvocationRef(input.packageId, ''),
    packageVersion: input.packageVersion === undefined ? '' : safeSkillInvocationRef(input.packageVersion, '1.0.0'),
    capabilityRef,
    executionContractRef,
    policyDecisionRef: input.policyDecisionRef === undefined
      ? policyDecisionFallback
      : safeSkillInvocationRef(input.policyDecisionRef, policyDecisionFallback),
    policyMode,
    mode,
    idempotencyKey: safeSkillInvocationRef(input.idempotencyKey, `idem:${safeIdPart(requestId, 'request')}`),
    slots: sanitizeSlots(input.slots ?? {}),
    auth: sanitizeAuth(input.auth),
    destructiveAuthorization: sanitizeDestructiveAuthorization(input.destructiveAuthorization),
    taskText: safeTaskText(input.taskText ?? input.description),
    taskTextGrantsAuthorization: false,
    naturalLanguageRequestGrantsExecution: false,
    redactionRequired: true,
    providerInvoked: false,
    browserInvoked: false,
    vaultAccessed: false,
    networkInvoked: false,
    rawMaterialPersisted: false,
  };
  assertNoSkillInvocationRawMaterial(sanitized);
  return clone(sanitized);
}

export function sanitizeSkillRuntimeInvocationSummary(value = {}) {
  assertNoSkillInvocationRawMaterial(value);
  const summary = {
    requestId: value.requestId === undefined ? '' : safeSkillInvocationRef(value.requestId, ''),
    skillId: value.skillId === undefined ? '' : safeSkillInvocationRef(value.skillId, ''),
    capabilityRef: value.capabilityRef === undefined ? '' : safeSkillInvocationRef(value.capabilityRef, ''),
    executionContractRef: value.executionContractRef === undefined ? '' : safeSkillInvocationRef(value.executionContractRef, ''),
    policyDecisionRef: value.policyDecisionRef === undefined ? '' : safeSkillInvocationRef(value.policyDecisionRef, ''),
    redactionRequired: true,
  };
  assertNoSkillInvocationRawMaterial(summary);
  return summary;
}
