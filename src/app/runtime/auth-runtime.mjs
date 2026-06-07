// @ts-check

import { createHash } from 'node:crypto';

import {
  assertNoExecutionSensitiveMaterial,
} from '../../domain/policies/execution/index.mjs';
import {
  createSessionPolicyEvaluationInput,
  sanitizeSessionPolicyDecision,
} from '../../domain/policies/session-policy.mjs';
import {
  RUNTIME_AUTH_REASONS,
  RUNTIME_REASONS,
} from './runtime-reasons.mjs';

const AUTH_SUPPORTED_PROVIDER_IDS = Object.freeze(new Set([
  'api_read_provider',
  'download_provider',
  'browser_action_provider',
]));
const AUTH_V1_OPERATIONS = Object.freeze(new Set(['read', 'query', 'download', 'write', 'submit', 'form_or_action']));
const AUTH_HTTP_PROVIDER_IDS = Object.freeze(new Set(['api_read_provider', 'download_provider']));
const AUTH_BROWSER_PROVIDER_IDS = Object.freeze(new Set(['browser_action_provider']));
const AUTH_BROWSER_OPERATIONS = Object.freeze(new Set(['write', 'submit', 'form_or_action']));
const AUTH_MATERIAL_TYPES = Object.freeze(new Set([
  'bearer_token',
  'cookie',
  'api_key',
  'custom_header',
]));
const AUTH_INJECTION_TARGETS = Object.freeze(new Set(['http_request', 'browser_context']));
const SECRET_QUERY_PATTERN =
  /^(?:auth|authorization|sid|sessdata|csrf|xsrf|secret|password|pass|signature|sign|access[_-]?token|refresh[_-]?token|session(?:[_-]?id)?|api[_-]?key|xsec[_-]?token|token)$/iu;
const SAFE_HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/u;

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

function uniqueSorted(values = []) {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function normalizeOrigin(value) {
  const text = normalizeText(value);
  if (!text) return '';
  try {
    return new URL(text).origin.toLowerCase();
  } catch {
    try {
      return new URL(`${text.replace(/\/+$/u, '')}/`).origin.toLowerCase();
    } catch {
      return text.toLowerCase().replace(/\/+$/u, '');
    }
  }
}

function normalizeOperation(value) {
  const text = normalizeText(value).toLowerCase();
  if (text === 'api') return 'read';
  if (text === 'export') return 'download';
  if (text === 'ordinary_write') return 'write';
  return text;
}

function normalizeOperations(values = []) {
  return uniqueSorted((Array.isArray(values) ? values : [values])
    .map(normalizeOperation)
    .filter((operation) => AUTH_V1_OPERATIONS.has(operation)));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeAuthScope(scope = {}) {
  if (!isPlainObject(scope)) {
    return null;
  }
  const origin = normalizeOrigin(scope.origin);
  const operations = normalizeOperations(scope.operations);
  if (!origin || operations.length === 0) {
    return null;
  }
  const normalized = {
    origin,
    operations,
  };
  const audience = normalizeText(scope.audience);
  if (audience) {
    normalized.audience = audience;
  }
  const resources = uniqueSorted(asArray(scope.resources).map((resource) => normalizeText(resource)));
  if (resources.length) {
    normalized.resources = resources;
  }
  assertNoExecutionSensitiveMaterial({ authRequirement: normalized });
  return normalized;
}

function normalizeScopes(scopes = []) {
  return asArray(scopes).map(normalizeAuthScope).filter(Boolean);
}

function normalizeMaterialTypes(types = []) {
  return uniqueSorted(asArray(types)
    .map((type) => normalizeText(type).toLowerCase())
    .filter((type) => AUTH_MATERIAL_TYPES.has(type)));
}

export function normalizeAuthRequirement(requirement = null) {
  if (!isPlainObject(requirement)) {
    return {
      required: false,
      mode: 'none',
      scopes: [],
      material: {
        allowedTypes: [],
        injectionTarget: 'http_request',
      },
      policy: {
        requireGovernanceGate: true,
        allowCredentialForwarding: false,
        allowRawHeaderAudit: false,
        allowRawCookieAudit: false,
        allowRawBodyAudit: false,
      },
      valid: true,
    };
  }

  const required = requirement.required === true;
  const mode = required ? normalizeText(requirement.mode, 'session_handle') : 'none';
  const material = isPlainObject(requirement.material) ? requirement.material : {};
  const allowedTypes = normalizeMaterialTypes(material.allowedTypes);
  const injectionTarget = normalizeText(material.injectionTarget, 'http_request');
  const scopes = normalizeScopes(requirement.scopes);
  const policy = isPlainObject(requirement.policy) ? requirement.policy : {};
  const normalized = {
    required,
    mode,
    scopes,
    material: {
      allowedTypes,
      injectionTarget,
    },
    policy: {
      requireGovernanceGate: policy.requireGovernanceGate !== false,
      allowCredentialForwarding: false,
      allowRawHeaderAudit: false,
      allowRawCookieAudit: false,
      allowRawBodyAudit: false,
    },
    valid: true,
  };
  if (required && (
    mode !== 'session_handle'
    || !AUTH_INJECTION_TARGETS.has(injectionTarget)
    || allowedTypes.length === 0
    || scopes.length === 0
  )) {
    normalized.valid = false;
    normalized.reasonCode = RUNTIME_AUTH_REASONS.scopeNotAllowed;
  }
  assertNoExecutionSensitiveMaterial({ authRequirement: normalized });
  return normalized;
}

function operationCovered(operation, allowedScope) {
  return allowedScope.operations?.includes(operation);
}

function resourceCovered(resource, allowedScope) {
  if (!resource) {
    return !Array.isArray(allowedScope.resources) || allowedScope.resources.length === 0;
  }
  return !Array.isArray(allowedScope.resources)
    || allowedScope.resources.length === 0
    || allowedScope.resources.includes(resource);
}

function scopeEntryCovered(candidate, allowedScope) {
  if (candidate.origin !== allowedScope.origin) {
    return false;
  }
  if (candidate.audience && allowedScope.audience && candidate.audience !== allowedScope.audience) {
    return false;
  }
  for (const operation of candidate.operations) {
    if (!operationCovered(operation, allowedScope)) {
      return false;
    }
  }
  const resources = Array.isArray(candidate.resources) && candidate.resources.length
    ? candidate.resources
    : [null];
  return resources.every((resource) => resourceCovered(resource, allowedScope));
}

export function isAuthScopeSubset(candidateScope, allowedScopes = []) {
  const candidate = normalizeAuthScope(candidateScope);
  if (!candidate) return false;
  const allowed = normalizeScopes(allowedScopes);
  return allowed.some((allowedScope) => scopeEntryCovered(candidate, allowedScope));
}

export function areAuthScopesSubset(candidateScopes = [], allowedScopes = []) {
  const candidates = normalizeScopes(candidateScopes);
  if (candidates.length === 0) {
    return true;
  }
  return candidates.every((scope) => isAuthScopeSubset(scope, allowedScopes));
}

function materialTypesSubset(candidate = [], allowed = []) {
  const candidateTypes = normalizeMaterialTypes(candidate);
  const allowedTypes = new Set(normalizeMaterialTypes(allowed));
  return candidateTypes.every((type) => allowedTypes.has(type));
}

function scopeOperationsAreWithin(scopes = [], allowedOperations) {
  return normalizeScopes(scopes).every((scope) => (
    scope.operations.length > 0
    && scope.operations.every((operation) => allowedOperations.has(operation))
  ));
}

export function isAuthRequirementSupportedForProvider(providerId, requirement = null, operation = null) {
  const normalized = normalizeAuthRequirement(requirement);
  if (normalized.required !== true) {
    return true;
  }
  if (normalized.valid !== true || !AUTH_SUPPORTED_PROVIDER_IDS.has(providerId)) {
    return false;
  }
  const target = normalized.material.injectionTarget;
  const materialTypes = normalizeMaterialTypes(normalized.material.allowedTypes);
  const normalizedOperation = normalizeOperation(operation);
  if (AUTH_HTTP_PROVIDER_IDS.has(providerId)) {
    if (target !== 'http_request') {
      return false;
    }
    if (providerId === 'download_provider') {
      return normalizedOperation === 'download'
        && scopeOperationsAreWithin(normalized.scopes, new Set(['download']));
    }
    return ['read', 'query'].includes(normalizedOperation)
      && scopeOperationsAreWithin(normalized.scopes, new Set(['read', 'query']));
  }
  if (AUTH_BROWSER_PROVIDER_IDS.has(providerId)) {
    return target === 'browser_context'
      && materialTypes.length === 1
      && materialTypes[0] === 'cookie'
      && AUTH_BROWSER_OPERATIONS.has(normalizedOperation)
      && scopeOperationsAreWithin(normalized.scopes, AUTH_BROWSER_OPERATIONS);
  }
  return false;
}

export function validateAuthRequirementNarrowing({
  contractAuthRequirement = null,
  invocationAuthRequirement = null,
} = {}) {
  const contractRequirement = normalizeAuthRequirement(contractAuthRequirement);
  const invocationRequirement = normalizeAuthRequirement(invocationAuthRequirement);
  if (contractRequirement.required !== true) {
    return {
      allowed: invocationRequirement.required !== true,
      reasonCode: invocationRequirement.required === true ? RUNTIME_AUTH_REASONS.scopeNotAllowed : null,
      contractRequirement,
      invocationRequirement,
    };
  }
  if (invocationAuthRequirement === null || invocationAuthRequirement === undefined) {
    return {
      allowed: contractRequirement.valid === true,
      reasonCode: contractRequirement.valid === true ? null : RUNTIME_AUTH_REASONS.scopeNotAllowed,
      contractRequirement,
      invocationRequirement: null,
    };
  }
  const sameTarget = invocationRequirement.material.injectionTarget === contractRequirement.material.injectionTarget;
  const sameMode = invocationRequirement.mode === contractRequirement.mode;
  const requiredNotRelaxed = invocationRequirement.required === true;
  const scopesNarrow = areAuthScopesSubset(invocationRequirement.scopes, contractRequirement.scopes);
  const materialNarrow = materialTypesSubset(
    invocationRequirement.material.allowedTypes,
    contractRequirement.material.allowedTypes,
  );
  const allowed = contractRequirement.valid === true
    && invocationRequirement.valid === true
    && requiredNotRelaxed
    && sameMode
    && sameTarget
    && scopesNarrow
    && materialNarrow;
  return {
    allowed,
    reasonCode: allowed ? null : RUNTIME_AUTH_REASONS.scopeNotAllowed,
    contractRequirement,
    invocationRequirement,
  };
}

export function resolveRuntimeAuthRequirement({
  invocationRequest = null,
  executionContract = null,
} = {}) {
  const narrowing = validateAuthRequirementNarrowing({
    contractAuthRequirement: executionContract?.authRequirement ?? null,
    invocationAuthRequirement: invocationRequest?.authRequirement ?? null,
  });
  const required = narrowing.contractRequirement.required === true;
  return {
    required,
    allowed: narrowing.allowed === true,
    reasonCode: narrowing.allowed === true ? null : RUNTIME_AUTH_REASONS.scopeNotAllowed,
    requirement: narrowing.contractRequirement,
    invocationRequirement: narrowing.invocationRequirement,
  };
}

function safeHashRef(prefix, value) {
  const hash = createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 24);
  return `${prefix}:sha256:${hash}`;
}

function safeRef(value, fallback) {
  const text = normalizeText(value);
  if (!text || /[\s"'`<>?&=%#]/u.test(text) || /(?:token|cookie|secret|authorization|credential|password|api[_-]?key)/iu.test(text)) {
    return fallback;
  }
  return text
    .replace(/[^a-z0-9._:/-]+/giu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 180) || fallback;
}

export function safeSessionRefFromMetadata(metadata = null, sessionHandle = '') {
  const fallback = safeHashRef('auth-session', sessionHandle);
  if (!isPlainObject(metadata)) {
    return fallback;
  }
  return safeRef(
    metadata.sessionRef ?? metadata.ref ?? metadata.id ?? metadata.sessionId,
    fallback,
  );
}

/** @param {Record<string, any>} summary */
export function sanitizeAuthAuditSummary(summary = {}) {
  const normalized = {
    required: summary.required === true,
    used: summary.used === true,
    sessionRef: safeRef(summary.sessionRef, null),
    scopesRequested: normalizeScopes(summary.scopesRequested),
    scopesGranted: normalizeScopes(summary.scopesGranted),
    materialSummary: {
      types: normalizeMaterialTypes(summary.materialSummary?.types),
      count: Number.isFinite(Number(summary.materialSummary?.count))
        ? Math.max(0, Number(summary.materialSummary.count))
        : 0,
    },
    outcome: safeRef(summary.outcome, 'not_required'),
    reason: safeRef(summary.reason, null),
  };
  assertNoExecutionSensitiveMaterial(normalized);
  return normalized;
}

export function sanitizeRuntimeSessionPolicySummary(summary = null) {
  if (!isPlainObject(summary)) return null;
  return sanitizeSessionPolicyDecision(summary);
}

/** @param {Record<string, any>} options */
function authSummary(options = {}) {
  const {
    required,
    used = false,
    sessionRef = null,
    scopesRequested = [],
    scopesGranted = [],
    materialTypes = [],
    materialCount = 0,
    outcome,
    reason = null,
  } = options;
  return sanitizeAuthAuditSummary({
    required,
    used,
    sessionRef,
    scopesRequested,
    scopesGranted,
    materialSummary: {
      types: materialTypes,
      count: materialCount,
    },
    outcome,
    reason,
  });
}

function sessionIsExpired(metadata = null) {
  const status = normalizeText(metadata?.status).toLowerCase();
  return metadata?.expired === true
    || metadata?.revoked === true
    || ['expired', 'revoked', 'inactive'].includes(status);
}

function sessionIsActive(metadata = null) {
  if (!isPlainObject(metadata) || sessionIsExpired(metadata)) {
    return false;
  }
  const status = normalizeText(metadata.status).toLowerCase();
  return metadata.active === true
    || ['active', 'valid', 'available', 'session_available', 'authenticated'].includes(status);
}

function scopesFromSessionMetadata(metadata = null) {
  return normalizeScopes(
    metadata?.scopes
      ?? metadata?.allowedScopes
      ?? metadata?.authorizedScopes
      ?? [],
  );
}

function sessionPolicyEvaluatorFrom(runtimeContext = null) {
  const evaluator = runtimeContext?.sessionPolicyEvaluator ?? runtimeContext?.runtimeAuthPolicy?.sessionPolicyEvaluator;
  if (typeof evaluator === 'function') {
    return evaluator;
  }
  if (typeof evaluator?.evaluate === 'function') {
    return (input) => evaluator.evaluate(input);
  }
  return null;
}

async function evaluateStructuredSessionPolicy({
  invocationRequest = null,
  executionContract = null,
  runtimeContext = null,
  provider = null,
  contractRequirement = null,
  requestedScopes = [],
  sessionScopes = [],
  sessionRef = null,
  metadata = null,
  operation = null,
} = {}) {
  const evaluator = sessionPolicyEvaluatorFrom(runtimeContext);
  if (!evaluator) {
    return { allowed: true, policySummary: null };
  }
  const invocationAuth = isPlainObject(invocationRequest?.auth) ? invocationRequest.auth : {};
  const input = createSessionPolicyEvaluationInput({
    capabilityId: invocationRequest?.capabilityId,
    providerId: provider?.id,
    capabilityKind: executionContract?.capabilityKind ?? executionContract?.operationKind,
    authRequirement: contractRequirement,
    requestedScopes,
    sessionScopes,
    sessionInspection: {
      sessionRef,
      status: metadata?.status,
      active: metadata?.active === true,
      scopes: sessionScopes,
      expiresAt: metadata?.expiresAt ?? metadata?.expires ?? metadata?.expiry ?? null,
    },
    governanceGate: invocationAuth.authGate,
    runtimeOperation: operation,
    targetOrigin: requestedScopes[0]?.origin ?? contractRequirement?.scopes?.[0]?.origin ?? null,
  });
  let decision;
  try {
    decision = await evaluator(input);
  } catch {
    decision = {
      allowed: false,
      reason: RUNTIME_AUTH_REASONS.policyGateNotSatisfied,
      decisionId: 'policy-decision:session-policy-error',
      policyId: input.governanceGate?.policyId,
      scopesGranted: [],
      materialTypesAllowed: [],
      constraints: {},
    };
  }
  const policySummary = sanitizeRuntimeSessionPolicySummary(decision);
  if (input.governanceGate?.satisfied !== true && policySummary.allowed === true) {
    const denied = sanitizeRuntimeSessionPolicySummary({
      ...policySummary,
      allowed: false,
      reason: RUNTIME_AUTH_REASONS.policyGateNotSatisfied,
      scopesGranted: [],
      materialTypesAllowed: [],
    });
    return {
      allowed: false,
      reasonCode: RUNTIME_AUTH_REASONS.policyGateNotSatisfied,
      policySummary: denied,
    };
  }
  return {
    allowed: policySummary.allowed === true,
    reasonCode: policySummary.allowed === true ? null : policySummary.reason || RUNTIME_AUTH_REASONS.policyGateNotSatisfied,
    policySummary,
  };
}

function effectiveRequestedScopes(invocationAuth = null, requirement = null, invocationRequirement = null) {
  const requested = normalizeScopes(invocationAuth?.requestedScopes);
  if (requested.length) return requested;
  if (invocationRequirement?.scopes?.length) return invocationRequirement.scopes;
  return requirement?.scopes ?? [];
}

/** @param {Record<string, any>} options */
export async function evaluateRuntimeAuthGate(options = {}) {
  const {
    invocationRequest,
    executionContract = null,
    runtimeContext = null,
    provider = null,
  } = options;
  const contractRaw = executionContract?.authRequirement ?? null;
  const invocationRaw = invocationRequest?.authRequirement ?? null;
  const narrowing = validateAuthRequirementNarrowing({
    contractAuthRequirement: contractRaw,
    invocationAuthRequirement: invocationRaw,
  });
  const contractRequirement = narrowing.contractRequirement;
  if (contractRequirement.required !== true) {
    if (narrowing.allowed !== true) {
      return {
        allowed: false,
        required: true,
        reasonCode: RUNTIME_AUTH_REASONS.scopeNotAllowed,
        authSummary: authSummary({
          required: true,
          outcome: 'blocked',
          reason: RUNTIME_AUTH_REASONS.scopeNotAllowed,
        }),
      };
    }
    return {
      allowed: true,
      required: false,
      authSummary: authSummary({
        required: false,
        outcome: 'not_required',
      }),
    };
  }
  if (narrowing.allowed !== true) {
    return {
      allowed: false,
      required: true,
      reasonCode: RUNTIME_AUTH_REASONS.scopeNotAllowed,
      authSummary: authSummary({
        required: true,
        outcome: 'blocked',
        reason: RUNTIME_AUTH_REASONS.scopeNotAllowed,
      }),
    };
  }

  if (!AUTH_SUPPORTED_PROVIDER_IDS.has(provider?.id)) {
    return {
      allowed: false,
      required: true,
      reasonCode: RUNTIME_AUTH_REASONS.authRequired,
      authSummary: authSummary({
        required: true,
        outcome: 'blocked',
        reason: RUNTIME_AUTH_REASONS.authRequired,
      }),
    };
  }
  const providerOperation = operationForProvider(provider?.id, options);
  if (!isAuthRequirementSupportedForProvider(provider?.id, contractRequirement, providerOperation)) {
    return {
      allowed: false,
      required: true,
      reasonCode: RUNTIME_AUTH_REASONS.authRequired,
      authSummary: authSummary({
        required: true,
        outcome: 'blocked',
        reason: RUNTIME_AUTH_REASONS.authRequired,
      }),
    };
  }

  const invocationAuth = isPlainObject(invocationRequest?.auth) ? invocationRequest.auth : {};
  const requestedScopes = effectiveRequestedScopes(invocationAuth, contractRequirement, narrowing.invocationRequirement);
  const sessionHandle = normalizeText(invocationAuth.sessionHandle);
  if (!sessionHandle) {
    return {
      allowed: false,
      required: true,
      reasonCode: RUNTIME_AUTH_REASONS.sessionMissing,
      authSummary: authSummary({
        required: true,
        scopesRequested: requestedScopes,
        outcome: 'blocked',
        reason: RUNTIME_AUTH_REASONS.sessionMissing,
      }),
    };
  }
  if (!areAuthScopesSubset(requestedScopes, contractRequirement.scopes)) {
    return {
      allowed: false,
      required: true,
      reasonCode: RUNTIME_AUTH_REASONS.scopeNotAllowed,
      authSummary: authSummary({
        required: true,
        scopesRequested: requestedScopes,
        outcome: 'blocked',
        reason: RUNTIME_AUTH_REASONS.scopeNotAllowed,
      }),
    };
  }
  const sessionVault = runtimeContext?.sessionVault;
  if (!sessionVault || typeof sessionVault.inspectSession !== 'function') {
    return {
      allowed: false,
      required: true,
      reasonCode: RUNTIME_AUTH_REASONS.sessionVaultUnavailable,
      authSummary: authSummary({
        required: true,
        scopesRequested: requestedScopes,
        outcome: 'blocked',
        reason: RUNTIME_AUTH_REASONS.sessionVaultUnavailable,
      }),
    };
  }

  let metadata;
  try {
    metadata = await sessionVault.inspectSession({ sessionHandle });
  } catch {
    return {
      allowed: false,
      required: true,
      reasonCode: RUNTIME_AUTH_REASONS.sessionVaultUnavailable,
      authSummary: authSummary({
        required: true,
        scopesRequested: requestedScopes,
        outcome: 'blocked',
        reason: RUNTIME_AUTH_REASONS.sessionVaultUnavailable,
      }),
    };
  }
  const sessionRef = safeSessionRefFromMetadata(metadata, sessionHandle);
  if (!metadata) {
    return {
      allowed: false,
      required: true,
      reasonCode: RUNTIME_AUTH_REASONS.sessionMissing,
      authSummary: authSummary({
        required: true,
        sessionRef,
        scopesRequested: requestedScopes,
        outcome: 'blocked',
        reason: RUNTIME_AUTH_REASONS.sessionMissing,
      }),
    };
  }
  if (!sessionIsActive(metadata)) {
    return {
      allowed: false,
      required: true,
      reasonCode: RUNTIME_AUTH_REASONS.sessionExpired,
      authSummary: authSummary({
        required: true,
        sessionRef,
        scopesRequested: requestedScopes,
        outcome: 'blocked',
        reason: RUNTIME_AUTH_REASONS.sessionExpired,
      }),
    };
  }
  const hasSessionPolicyEvaluator = Boolean(sessionPolicyEvaluatorFrom(runtimeContext));
  if (invocationAuth.authGate?.satisfied !== true && !hasSessionPolicyEvaluator) {
    return {
      allowed: false,
      required: true,
      reasonCode: RUNTIME_AUTH_REASONS.policyGateNotSatisfied,
      authSummary: authSummary({
        required: true,
        sessionRef,
        scopesRequested: requestedScopes,
        outcome: 'blocked',
        reason: RUNTIME_AUTH_REASONS.policyGateNotSatisfied,
      }),
    };
  }
  const sessionScopes = scopesFromSessionMetadata(metadata);
  if (!areAuthScopesSubset(requestedScopes, sessionScopes)) {
    return {
      allowed: false,
      required: true,
      reasonCode: RUNTIME_AUTH_REASONS.scopeNotAllowed,
      authSummary: authSummary({
        required: true,
        sessionRef,
        scopesRequested: requestedScopes,
        scopesGranted: sessionScopes,
        outcome: 'blocked',
        reason: RUNTIME_AUTH_REASONS.scopeNotAllowed,
      }),
    };
  }
  const policyDecision = await evaluateStructuredSessionPolicy({
    invocationRequest,
    executionContract,
    runtimeContext,
    provider,
    contractRequirement,
    requestedScopes,
    sessionScopes,
    sessionRef,
    metadata,
    operation: providerOperation,
  });
  if (policyDecision.allowed !== true) {
    return {
      allowed: false,
      required: true,
      reasonCode: policyDecision.reasonCode,
      policySummary: policyDecision.policySummary,
      authSummary: authSummary({
        required: true,
        sessionRef,
        scopesRequested: requestedScopes,
        scopesGranted: sessionScopes,
        outcome: 'blocked',
        reason: policyDecision.reasonCode,
      }),
    };
  }
  return {
    allowed: true,
    required: true,
    sessionVault,
    sessionHandle,
    sessionRef,
    requestedScopes,
    sessionScopes,
    sessionExpiresAt: metadata.expiresAt ?? metadata.expires ?? metadata.expiry ?? null,
    requirement: contractRequirement,
    policySummary: policyDecision.policySummary,
    authSummary: authSummary({
      required: true,
      sessionRef,
      scopesRequested: requestedScopes,
      scopesGranted: sessionScopes,
      outcome: 'ready',
    }),
  };
}

function headerNameAllowed(name) {
  return SAFE_HEADER_NAME_PATTERN.test(name);
}

function materialEntries(grant = {}) {
  const candidates = [
    grant.materials,
    grant.material,
    grant.entries,
  ].find(Array.isArray);
  if (Array.isArray(candidates)) {
    return candidates;
  }
  if (isPlainObject(grant.material)) {
    return [grant.material];
  }
  if (isPlainObject(grant)) {
    return [grant];
  }
  return [];
}

function validateUrlForAuth(urlValue) {
  let parsed;
  try {
    parsed = new URL(String(urlValue ?? ''));
  } catch {
    return { ok: false, reasonCode: RUNTIME_REASONS.contractNotConcreteEnough };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, reasonCode: RUNTIME_REASONS.contractNotConcreteEnough };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reasonCode: RUNTIME_REASONS.contractNotConcreteEnough };
  }
  for (const key of parsed.searchParams.keys()) {
    if (SECRET_QUERY_PATTERN.test(key)) {
      return { ok: false, reasonCode: RUNTIME_REASONS.contractNotConcreteEnough };
    }
  }
  return { ok: true, parsed };
}

function methodAllowed(method) {
  return ['GET', 'HEAD'].includes(normalizeText(method, 'GET').toUpperCase());
}

export function operationForProvider(providerId, {
  invocationRequest = null,
  executionContract = null,
  capability = null,
  runtimeContext = null,
} = {}) {
  const candidates = [
    runtimeContext?.authOperation,
    executionContract?.authOperation,
    executionContract?.operationKind,
    executionContract?.capabilityKind,
    executionContract?.contractKind,
    capability?.operationKind,
    capability?.capabilityKind,
    capability?.kind,
    invocationRequest?.operationKind,
    invocationRequest?.capabilityKind,
  ];
  for (const candidate of candidates) {
    const operation = normalizeOperation(candidate);
    if (!AUTH_V1_OPERATIONS.has(operation)) {
      continue;
    }
    if (providerId === 'download_provider') {
      if (operation === 'download') {
        return 'download';
      }
      continue;
    }
    if (providerId === 'browser_action_provider') {
      if (AUTH_BROWSER_OPERATIONS.has(operation)) {
        return operation;
      }
      continue;
    }
    if (['read', 'query'].includes(operation)) {
      return operation;
    }
  }
  if (providerId === 'browser_action_provider') {
    return 'form_or_action';
  }
  return providerId === 'download_provider' ? 'download' : 'read';
}

/** @param {Record<string, any>} options */
export function isUrlCoveredByAuthScopes(options = {}) {
  const {
    url,
    operation,
    scopes = [],
  } = options;
  const checked = validateUrlForAuth(url);
  if (checked.ok !== true) return false;
  const parsed = checked.parsed;
  const origin = parsed.origin.toLowerCase();
  const resourceCandidates = uniqueSorted([
    parsed.href,
    `${parsed.origin}${parsed.pathname}`,
    parsed.pathname,
  ]);
  const allowedScopes = normalizeScopes(scopes);
  return allowedScopes.some((scope) => {
    if (scope.origin !== origin || !scope.operations.includes(operation)) {
      return false;
    }
    if (!Array.isArray(scope.resources) || scope.resources.length === 0) {
      return true;
    }
    return resourceCandidates.some((resource) => scope.resources.includes(resource));
  });
}

/** @param {Record<string, any>} options */
export function validateAuthHttpRequest(options = {}) {
  const {
    url,
    method = 'GET',
    body = null,
    providerId = null,
    operation = null,
    requirement = null,
    requestedScopes = [],
    sessionScopes = [],
  } = options;
  const urlCheck = validateUrlForAuth(url);
  if (urlCheck.ok !== true) {
    return urlCheck;
  }
  const normalizedMethod = normalizeText(method, 'GET').toUpperCase();
  if (!methodAllowed(normalizedMethod) || body !== null && body !== undefined && String(body).trim() !== '') {
    return { ok: false, reasonCode: RUNTIME_REASONS.contractNotConcreteEnough };
  }
  const effectiveOperation = AUTH_V1_OPERATIONS.has(normalizeOperation(operation))
    ? normalizeOperation(operation)
    : operationForProvider(providerId);
  for (const scopes of [requirement?.scopes ?? [], requestedScopes, sessionScopes]) {
    if (!isUrlCoveredByAuthScopes({
      url: urlCheck.parsed.href,
      operation: effectiveOperation,
      scopes,
    })) {
      return { ok: false, reasonCode: RUNTIME_AUTH_REASONS.scopeNotAllowed };
    }
  }
  return {
    ok: true,
    url: urlCheck.parsed.href,
    method: normalizedMethod,
    origin: urlCheck.parsed.origin.toLowerCase(),
  };
}

function hasForbiddenDescriptorHeaders(descriptor = {}) {
  return descriptor.headers !== undefined
    || descriptor.requestHeaders !== undefined
    || descriptor.headerValues !== undefined;
}

function hasForbiddenDescriptorBody(descriptor = {}) {
  return descriptor.body !== undefined
    || descriptor.requestBody !== undefined
    || descriptor.payload !== undefined
    || descriptor.formData !== undefined;
}

function concreteDescriptorFrom(value = null) {
  if (!isPlainObject(value)) {
    return null;
  }
  const url = normalizeText(value.url ?? value.endpoint);
  if (!url) {
    return null;
  }
  return {
    url,
    method: normalizeText(value.method, 'GET').toUpperCase(),
    responsePolicy: isPlainObject(value.responsePolicy) ? {
      material: safeRef(value.responsePolicy.material, 'sanitized_summary_only'),
      persistBody: value.responsePolicy.persistBody === true,
    } : null,
    rawDescriptor: value,
  };
}

/** @param {Record<string, any>} options */
export function resolveAuthHttpRequestDescriptor(options = {}) {
  const {
    providerId,
    executionContract = null,
    runtimeContext = null,
  } = options;
  const binding = executionContract?.runtimeBinding ?? {};
  const candidates = providerId === 'download_provider'
    ? [
      binding.downloadDescriptor,
      executionContract?.downloadDescriptor,
      binding.httpRequest,
      executionContract?.httpRequestDescriptor,
      runtimeContext?.httpRequest,
    ]
    : [
      binding.httpRequest,
      executionContract?.httpRequestDescriptor,
      runtimeContext?.httpRequest,
    ];
  const descriptor = candidates.map(concreteDescriptorFrom).find(Boolean);
  if (!descriptor) {
    return { ok: false, reasonCode: RUNTIME_REASONS.contractNotConcreteEnough };
  }
  if (
    hasForbiddenDescriptorHeaders(descriptor.rawDescriptor)
    || hasForbiddenDescriptorBody(descriptor.rawDescriptor)
    || !methodAllowed(descriptor.method)
    || descriptor.responsePolicy?.persistBody === true
    || validateUrlForAuth(descriptor.url).ok !== true
  ) {
    return { ok: false, reasonCode: RUNTIME_REASONS.contractNotConcreteEnough };
  }
  return {
    ok: true,
    descriptor: {
      url: descriptor.url,
      method: descriptor.method,
      responsePolicy: descriptor.responsePolicy,
    },
  };
}

function applyMaterialToHeaders(headers, entry) {
  const type = normalizeText(entry?.type ?? entry?.materialType).toLowerCase();
  const value = normalizeText(entry?.value ?? entry?.secret ?? entry?.token);
  if (!AUTH_MATERIAL_TYPES.has(type) || !value) {
    return false;
  }
  if (type === 'bearer_token') {
    headers.authorization = `Bearer ${value}`;
    return true;
  }
  if (type === 'cookie') {
    headers.cookie = value;
    return true;
  }
  if (type === 'api_key') {
    const headerName = normalizeText(entry.headerName ?? entry.name, 'x-api-key').toLowerCase();
    if (!headerNameAllowed(headerName)) return false;
    headers[headerName] = value;
    return true;
  }
  const headerName = normalizeText(entry.headerName ?? entry.name).toLowerCase();
  if (!headerName || !headerNameAllowed(headerName)) return false;
  headers[headerName] = value;
  return true;
}

const PUBLIC_SUFFIX_DENYLIST = Object.freeze(new Set([
  'com',
  'org',
  'net',
  'edu',
  'gov',
  'mil',
  'int',
  'io',
  'dev',
  'app',
  'test',
  'invalid',
  'localhost',
  'uk',
  'co.uk',
  'cn',
  'com.cn',
  'jp',
  'co.jp',
]));

function isIpAddress(hostname) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(hostname)
    || hostname.includes(':');
}

function parseTargetUrl({ targetUrl = null, targetOrigin = null } = {}) {
  for (const value of [targetUrl, targetOrigin]) {
    const text = normalizeText(value);
    if (!text) continue;
    try {
      const parsed = new URL(text);
      if (['http:', 'https:'].includes(parsed.protocol)) {
        return { ok: true, parsed };
      }
    } catch {
      try {
        const parsed = new URL(`${text.replace(/\/+$/u, '')}/`);
        if (['http:', 'https:'].includes(parsed.protocol)) {
          return { ok: true, parsed };
        }
      } catch {
        // Try the next candidate.
      }
    }
  }
  return { ok: false, reasonCode: RUNTIME_REASONS.contractNotConcreteEnough };
}

function browserOriginAllowed(origin, allowedOrigins = []) {
  const normalized = normalizeOrigin(origin);
  return asArray(allowedOrigins)
    .map((candidate) => normalizeOrigin(candidate))
    .filter(Boolean)
    .includes(normalized);
}

function validateBrowserAuthTarget({
  targetUrl = null,
  targetOrigin = null,
  allowedOrigins = [],
  operation = null,
  requirement = null,
  requestedScopes = [],
  sessionScopes = [],
} = {}) {
  const checked = parseTargetUrl({ targetUrl, targetOrigin });
  if (checked.ok !== true) {
    return checked;
  }
  const parsed = checked.parsed;
  const origin = parsed.origin.toLowerCase();
  const effectiveOperation = normalizeOperation(operation);
  if (!AUTH_BROWSER_OPERATIONS.has(effectiveOperation)) {
    return { ok: false, reasonCode: RUNTIME_AUTH_REASONS.authRequired };
  }
  if (!browserOriginAllowed(origin, allowedOrigins)) {
    return { ok: false, reasonCode: RUNTIME_REASONS.browserNavigationNotAllowed };
  }
  for (const scopes of [requirement?.scopes ?? [], requestedScopes, sessionScopes]) {
    if (!isUrlCoveredByAuthScopes({
      url: parsed.href,
      operation: effectiveOperation,
      scopes,
    })) {
      return { ok: false, reasonCode: RUNTIME_AUTH_REASONS.scopeNotAllowed };
    }
  }
  return {
    ok: true,
    url: parsed.href,
    origin,
    host: parsed.hostname.toLowerCase(),
    path: parsed.pathname || '/',
    https: parsed.protocol === 'https:',
  };
}

function expirySeconds(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 9_999_999_999 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function materialExpiryLimitSeconds(grant = {}, sessionExpiresAt = null) {
  const values = [
    grant.expires,
    grant.expiresAt,
    grant.expiry,
    grant.summary?.expires,
    grant.summary?.expiresAt,
    grant.summary?.expiry,
    sessionExpiresAt,
  ].map(expirySeconds).filter((value) => Number.isFinite(value));
  return values.length ? Math.min(...values) : null;
}

function normalizeSameSite(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const lowered = text.toLowerCase();
  if (lowered === 'strict') return 'Strict';
  if (lowered === 'lax') return 'Lax';
  if (lowered === 'none') return 'None';
  return null;
}

function cookieDomainAllowed(rawDomain, targetHost) {
  const text = normalizeText(rawDomain).toLowerCase();
  if (!text) {
    return { ok: true, hostOnly: true, domain: null };
  }
  const domain = text.replace(/\.$/u, '');
  if (
    domain.startsWith('.')
    || domain.includes('*')
    || domain !== targetHost
    || PUBLIC_SUFFIX_DENYLIST.has(domain)
    || (!domain.includes('.') && !isIpAddress(domain))
  ) {
    return { ok: false };
  }
  return { ok: true, hostOnly: false, domain };
}

/** @param {Record<string, any>} options */
function validateBrowserCookieMaterial(options = {}) {
  const {
    grant = {},
    target = {},
    sessionExpiresAt = null,
  } = options;
  const entries = materialEntries(grant);
  const cookies = [];
  const expiryLimit = materialExpiryLimitSeconds(grant, sessionExpiresAt);
  for (const entry of entries) {
    const type = normalizeText(entry?.type ?? entry?.materialType).toLowerCase();
    const name = normalizeText(entry?.name);
    const value = normalizeText(entry?.value ?? entry?.secret);
    if (type !== 'cookie' || !name || !value) {
      return { ok: false, reasonCode: RUNTIME_AUTH_REASONS.scopeNotAllowed };
    }
    const domainCheck = cookieDomainAllowed(entry.domain ?? entry.cookieDomain, target.host);
    if (domainCheck.ok !== true) {
      return { ok: false, reasonCode: RUNTIME_AUTH_REASONS.scopeNotAllowed };
    }
    const path = normalizeText(entry.path, '/');
    if (!path.startsWith('/') || (path !== '/' && !target.path.startsWith(path))) {
      return { ok: false, reasonCode: RUNTIME_AUTH_REASONS.scopeNotAllowed };
    }
    const secure = entry.secure === true;
    if (target.https && secure !== true) {
      return { ok: false, reasonCode: RUNTIME_AUTH_REASONS.scopeNotAllowed };
    }
    const sameSite = normalizeSameSite(entry.sameSite);
    if (entry.sameSite !== undefined && !sameSite) {
      return { ok: false, reasonCode: RUNTIME_AUTH_REASONS.scopeNotAllowed };
    }
    if (sameSite === 'None' && secure !== true) {
      return { ok: false, reasonCode: RUNTIME_AUTH_REASONS.scopeNotAllowed };
    }
    const expires = expirySeconds(entry.expires ?? entry.expiresAt);
    if (expires !== null && expiryLimit !== null && expires > expiryLimit) {
      return { ok: false, reasonCode: RUNTIME_AUTH_REASONS.scopeNotAllowed };
    }
    const cookie = {
      name,
      value,
      path,
      httpOnly: entry.httpOnly === true,
      secure,
    };
    if (sameSite) {
      cookie.sameSite = sameSite;
    }
    if (expires !== null) {
      cookie.expires = expires;
    }
    if (domainCheck.hostOnly === true) {
      cookie.url = target.origin;
    } else {
      cookie.domain = domainCheck.domain;
    }
    cookies.push(cookie);
  }
  if (cookies.length === 0) {
    return { ok: false, reasonCode: RUNTIME_AUTH_REASONS.materialUnavailable };
  }
  return {
    ok: true,
    cookies,
    materialTypes: ['cookie'],
    materialCount: cookies.length,
  };
}

/** @param {Record<string, any>} options */
export function createProviderAuthAdapter(options = {}) {
  const {
    sessionVault,
    sessionHandle,
    providerId,
    capabilityId,
    requirement,
    requestedScopes,
    sessionScopes,
    sessionRef,
    operation,
    sessionExpiresAt = null,
    policyConstraints = null,
  } = options;
  const issuedGrantIds = [];
  const materialTypes = requirement?.material?.allowedTypes ?? [];
  const adapterSummary = (overrides = {}) => authSummary({
    required: requirement?.required === true,
    sessionRef,
    scopesRequested: requestedScopes,
    scopesGranted: sessionScopes,
    materialTypes,
    ...overrides,
  });
  return {
    isRequired() {
      return requirement?.required === true;
    },
    getPolicyConstraints() {
      if (!isPlainObject(policyConstraints)) return null;
      return {
        maxGrantTtlMs: Number.isFinite(Number(policyConstraints.maxGrantTtlMs))
          ? Number(policyConstraints.maxGrantTtlMs)
          : null,
        requireRelease: policyConstraints.requireRelease !== false,
        allowProfilePersistence: false,
        allowStorageStatePersistence: false,
        allowCredentialForwarding: false,
      };
    },
    /** @param {Record<string, any>} request */
    async applyHttpAuth(request = {}) {
      const {
        url,
        method = 'GET',
        headers = {},
        body = null,
      } = request;
      const requestValidation = validateAuthHttpRequest({
        url,
        method,
        body,
        providerId,
        operation,
        requirement,
        requestedScopes,
        sessionScopes,
      });
      if (requestValidation.ok !== true) {
        return {
          ok: false,
          reasonCode: requestValidation.reasonCode,
          authSummary: adapterSummary({
            used: false,
            outcome: 'blocked',
            reason: requestValidation.reasonCode,
          }),
        };
      }
      let grant;
      try {
        grant = await sessionVault.getScopedSessionMaterial({
          sessionHandle,
          providerId,
          capabilityId,
          scopes: requestedScopes,
          materialTypes,
          purpose: 'http_request_auth',
        });
      } catch {
        return {
          ok: false,
          reasonCode: RUNTIME_AUTH_REASONS.materialUnavailable,
          authSummary: adapterSummary({
            used: false,
            outcome: 'blocked',
            reason: RUNTIME_AUTH_REASONS.materialUnavailable,
          }),
        };
      }
      if (!grant) {
        return {
          ok: false,
          reasonCode: RUNTIME_AUTH_REASONS.materialUnavailable,
          authSummary: adapterSummary({
            used: false,
            outcome: 'blocked',
            reason: RUNTIME_AUTH_REASONS.materialUnavailable,
          }),
        };
      }
      if (normalizeText(grant.grantId)) {
        issuedGrantIds.push(normalizeText(grant.grantId));
      }
      const nextHeaders = { ...headers };
      const entries = materialEntries(grant);
      const appliedTypes = [];
      for (const entry of entries) {
        if (applyMaterialToHeaders(nextHeaders, entry) !== true) {
          return {
            ok: false,
            reasonCode: RUNTIME_AUTH_REASONS.providerInjectionFailed,
            authSummary: adapterSummary({
              used: false,
              materialTypes: appliedTypes,
              materialCount: appliedTypes.length,
              outcome: 'blocked',
              reason: RUNTIME_AUTH_REASONS.providerInjectionFailed,
            }),
          };
        }
        appliedTypes.push(normalizeText(entry.type ?? entry.materialType).toLowerCase());
      }
      return {
        ok: true,
        request: {
          url: requestValidation.url,
          method: requestValidation.method,
          headers: nextHeaders,
          redirect: 'manual',
        },
        authSummary: adapterSummary({
          used: true,
          materialTypes: appliedTypes,
          materialCount: appliedTypes.length,
          outcome: 'used',
        }),
      };
    },
    async applyBrowserAuth(request = {}) {
      const {
        driver = null,
        targetUrl = null,
        targetOrigin = null,
        allowedOrigins = [],
      } = request;
      const targetValidation = validateBrowserAuthTarget({
        targetUrl,
        targetOrigin,
        allowedOrigins,
        operation,
        requirement,
        requestedScopes,
        sessionScopes,
      });
      if (targetValidation.ok !== true) {
        return {
          ok: false,
          reasonCode: targetValidation.reasonCode,
          authSummary: adapterSummary({
            used: false,
            outcome: 'blocked',
            reason: targetValidation.reasonCode,
          }),
        };
      }
      if (typeof driver?.applyEphemeralAuthCookies !== 'function') {
        return {
          ok: false,
          reasonCode: RUNTIME_AUTH_REASONS.providerInjectionFailed,
          authSummary: adapterSummary({
            used: false,
            outcome: 'blocked',
            reason: RUNTIME_AUTH_REASONS.providerInjectionFailed,
          }),
        };
      }
      let grant;
      try {
        grant = await sessionVault.getScopedSessionMaterial({
          sessionHandle,
          providerId,
          capabilityId,
          scopes: requestedScopes,
          materialTypes: ['cookie'],
          purpose: 'browser_context_auth',
        });
      } catch {
        return {
          ok: false,
          reasonCode: RUNTIME_AUTH_REASONS.materialUnavailable,
          authSummary: adapterSummary({
            used: false,
            outcome: 'blocked',
            reason: RUNTIME_AUTH_REASONS.materialUnavailable,
          }),
        };
      }
      if (!grant) {
        return {
          ok: false,
          reasonCode: RUNTIME_AUTH_REASONS.materialUnavailable,
          authSummary: adapterSummary({
            used: false,
            outcome: 'blocked',
            reason: RUNTIME_AUTH_REASONS.materialUnavailable,
          }),
        };
      }
      if (normalizeText(grant.grantId)) {
        issuedGrantIds.push(normalizeText(grant.grantId));
      }
      const materialValidation = validateBrowserCookieMaterial({
        grant,
        target: targetValidation,
        sessionExpiresAt,
      });
      if (materialValidation.ok !== true) {
        return {
          ok: false,
          reasonCode: materialValidation.reasonCode,
          authSummary: adapterSummary({
            used: false,
            outcome: 'blocked',
            reason: materialValidation.reasonCode,
          }),
        };
      }
      try {
        await driver.applyEphemeralAuthCookies({
          origin: targetValidation.origin,
          cookies: materialValidation.cookies,
        });
      } catch {
        return {
          ok: false,
          reasonCode: RUNTIME_AUTH_REASONS.providerInjectionFailed,
          authSummary: adapterSummary({
            used: false,
            outcome: 'blocked',
            reason: RUNTIME_AUTH_REASONS.providerInjectionFailed,
          }),
        };
      }
      return {
        ok: true,
        origin: targetValidation.origin,
        authSummary: adapterSummary({
          used: true,
          materialTypes: materialValidation.materialTypes,
          materialCount: materialValidation.materialCount,
          outcome: 'used',
        }),
      };
    },
    async releaseAll() {
      if (typeof sessionVault?.releaseScopedSessionMaterial !== 'function') {
        return { releaseAttempted: false, releaseFailed: false };
      }
      let failed = false;
      for (const grantId of issuedGrantIds) {
        try {
          await sessionVault.releaseScopedSessionMaterial({ grantId });
        } catch {
          failed = true;
        }
      }
      return {
        releaseAttempted: issuedGrantIds.length > 0,
        releaseFailed: failed,
      };
    },
    async releaseIssuedMaterial() {
      return await this.releaseAll();
    },
  };
}

export function assertSessionVaultInterface(value) {
  if (!value || typeof value.inspectSession !== 'function' || typeof value.getScopedSessionMaterial !== 'function') {
    throw new TypeError('SessionVault must expose inspectSession() and getScopedSessionMaterial()');
  }
  return true;
}

export function isAuthSupportedProviderId(providerId) {
  return AUTH_SUPPORTED_PROVIDER_IDS.has(providerId);
}
