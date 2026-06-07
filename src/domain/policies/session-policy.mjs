// @ts-check

import {
  assertNoExecutionSensitiveMaterial,
} from './execution/index.mjs';

export const SESSION_POLICY_DECISION_SCHEMA_VERSION = 'session-policy-decision/v2';

const DEFAULT_CONSTRAINTS = Object.freeze({
  maxGrantTtlMs: 300_000,
  requireRelease: true,
  allowProfilePersistence: false,
  allowStorageStatePersistence: false,
  allowCredentialForwarding: false,
});

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function safeRef(value, fallback = null) {
  const text = normalizeText(value);
  if (!text) return fallback;
  if (/[\s"'`<>?&=%#]/u.test(text) || /(?:token|cookie|secret|credential|password|authorization|session[_-]?handle)/iu.test(text)) {
    return fallback;
  }
  return text
    .replace(/[^a-z0-9._:/-]+/giu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 180) || fallback;
}

function normalizeOperation(value) {
  const text = normalizeText(value).toLowerCase();
  if (text === 'api') return 'read';
  if (text === 'export') return 'download';
  if (text === 'ordinary_write') return 'write';
  return text;
}

function normalizeScope(scope = {}) {
  if (!isPlainObject(scope)) return null;
  const origin = normalizeText(scope.origin).toLowerCase().replace(/\/+$/u, '');
  const operations = (Array.isArray(scope.operations) ? scope.operations : [])
    .map(normalizeOperation)
    .filter(Boolean)
    .sort();
  if (!origin || operations.length === 0) return null;
  const normalized = { origin, operations };
  const resources = (Array.isArray(scope.resources) ? scope.resources : [])
    .map((resource) => normalizeText(resource))
    .filter(Boolean)
    .sort();
  if (resources.length) normalized.resources = resources;
  const audience = safeRef(scope.audience, null);
  if (audience) normalized.audience = audience;
  return normalized;
}

function normalizeScopes(scopes = []) {
  return (Array.isArray(scopes) ? scopes : [])
    .map(normalizeScope)
    .filter(Boolean);
}

function resourceCovered(candidate, allowed) {
  if (!candidate) return !Array.isArray(allowed.resources) || allowed.resources.length === 0;
  return !Array.isArray(allowed.resources)
    || allowed.resources.length === 0
    || allowed.resources.includes(candidate);
}

function scopeCovered(candidate, allowed) {
  if (candidate.origin !== allowed.origin) return false;
  if (candidate.audience && allowed.audience && candidate.audience !== allowed.audience) return false;
  if (!candidate.operations.every((operation) => allowed.operations.includes(operation))) return false;
  const resources = candidate.resources?.length ? candidate.resources : [null];
  return resources.every((resource) => resourceCovered(resource, allowed));
}

export function areSessionPolicyScopesSubset(candidateScopes = [], allowedScopes = []) {
  const candidates = normalizeScopes(candidateScopes);
  const allowed = normalizeScopes(allowedScopes);
  if (candidates.length === 0) return true;
  return candidates.every((candidate) => allowed.some((allowedScope) => scopeCovered(candidate, allowedScope)));
}

function normalizeMaterialTypes(types = []) {
  const allowed = new Set(['bearer_token', 'cookie', 'api_key', 'custom_header']);
  return [...new Set((Array.isArray(types) ? types : [])
    .map((type) => normalizeText(type).toLowerCase())
    .filter((type) => allowed.has(type)))]
    .sort();
}

function normalizeConstraints(constraints = {}) {
  return {
    maxGrantTtlMs: Number.isFinite(Number(constraints.maxGrantTtlMs))
      ? Math.max(0, Number(constraints.maxGrantTtlMs))
      : DEFAULT_CONSTRAINTS.maxGrantTtlMs,
    requireRelease: constraints.requireRelease !== false,
    allowProfilePersistence: false,
    allowStorageStatePersistence: false,
    allowCredentialForwarding: false,
  };
}

export function sanitizeSessionPolicyDecision(decision = {}) {
  const sanitized = {
    schemaVersion: SESSION_POLICY_DECISION_SCHEMA_VERSION,
    allowed: decision.allowed === true,
    reason: safeRef(decision.reason, null),
    decisionId: safeRef(decision.decisionId, 'policy-decision:session-policy'),
    policyId: safeRef(decision.policyId, 'governance-policy:session-policy'),
    scopesGranted: normalizeScopes(decision.scopesGranted),
    materialTypesAllowed: normalizeMaterialTypes(decision.materialTypesAllowed),
    constraints: normalizeConstraints(decision.constraints),
    provenance: {
      evaluator: safeRef(decision.provenance?.evaluator, 'session-policy-evaluator'),
      decisionSource: safeRef(decision.provenance?.decisionSource, 'structured_session_policy'),
    },
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(sanitized);
  return sanitized;
}

export function createSessionPolicyDecision(options = {}) {
  return sanitizeSessionPolicyDecision({
    allowed: options.allowed === true,
    reason: options.reason ?? null,
    decisionId: options.decisionId ?? 'policy-decision:session-policy',
    policyId: options.policyId ?? options.governanceGate?.policyId ?? 'governance-policy:session-policy',
    scopesGranted: options.scopesGranted ?? [],
    materialTypesAllowed: options.materialTypesAllowed ?? [],
    constraints: options.constraints ?? {},
    provenance: options.provenance,
  });
}

export function createSessionPolicyEvaluationInput(input = {}) {
  const authRequirement = isPlainObject(input.authRequirement) ? input.authRequirement : {};
  const material = isPlainObject(authRequirement.material) ? authRequirement.material : {};
  const sanitized = {
    capabilityId: safeRef(input.capabilityId, null),
    providerId: safeRef(input.providerId, null),
    capabilityKind: safeRef(input.capabilityKind, null),
    runtimeOperation: safeRef(input.runtimeOperation, null),
    targetOrigin: safeRef(input.targetOrigin, null),
    requestedScopes: normalizeScopes(input.requestedScopes),
    sessionScopes: normalizeScopes(input.sessionInspection?.scopes ?? input.sessionScopes),
    governanceGate: {
      satisfied: input.governanceGate?.satisfied === true,
      gateId: safeRef(input.governanceGate?.gateId, null),
      policyId: safeRef(input.governanceGate?.policyId, null),
    },
    materialTarget: safeRef(input.materialTarget ?? material.injectionTarget, null),
    materialTypes: normalizeMaterialTypes(input.materialTypes ?? material.allowedTypes),
    sessionInspection: {
      sessionRef: safeRef(input.sessionInspection?.sessionRef, null),
      status: safeRef(input.sessionInspection?.status, null),
      active: input.sessionInspection?.active === true,
      expiresAt: safeRef(input.sessionInspection?.expiresAt, null),
    },
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(sanitized);
  return sanitized;
}

export function evaluateSessionPolicy(input = {}) {
  const evaluation = createSessionPolicyEvaluationInput(input);
  if (evaluation.governanceGate.satisfied !== true) {
    return createSessionPolicyDecision({
      allowed: false,
      reason: 'runtime.auth_policy_gate_not_satisfied',
      policyId: evaluation.governanceGate.policyId,
      scopesGranted: [],
      materialTypesAllowed: [],
      provenance: { evaluator: 'default_session_policy_evaluator' },
    });
  }
  if (!areSessionPolicyScopesSubset(evaluation.requestedScopes, evaluation.sessionScopes)) {
    return createSessionPolicyDecision({
      allowed: false,
      reason: 'runtime.auth_session_scope_not_allowed',
      policyId: evaluation.governanceGate.policyId,
      scopesGranted: [],
      materialTypesAllowed: evaluation.materialTypes,
      provenance: { evaluator: 'default_session_policy_evaluator' },
    });
  }
  if (!['http_request', 'browser_context'].includes(evaluation.materialTarget)) {
    return createSessionPolicyDecision({
      allowed: false,
      reason: 'runtime.auth_required',
      policyId: evaluation.governanceGate.policyId,
      scopesGranted: evaluation.requestedScopes,
      materialTypesAllowed: [],
      provenance: { evaluator: 'default_session_policy_evaluator' },
    });
  }
  return createSessionPolicyDecision({
    allowed: true,
    reason: null,
    policyId: evaluation.governanceGate.policyId,
    scopesGranted: evaluation.requestedScopes,
    materialTypesAllowed: evaluation.materialTypes,
    constraints: {
      maxGrantTtlMs: 300_000,
      requireRelease: true,
      allowProfilePersistence: false,
      allowStorageStatePersistence: false,
      allowCredentialForwarding: false,
    },
    provenance: { evaluator: 'default_session_policy_evaluator' },
  });
}

export function createDefaultSessionPolicyEvaluator() {
  return {
    evaluate(input = {}) {
      return evaluateSessionPolicy(input);
    },
  };
}
