// @ts-check

import { jsonClone } from '../../../shared/clone.mjs';
import {
  POLICY_PACK_SCHEMA_VERSION,
  POLICY_RULE_EFFECTS,
} from './policy-pack-schema.mjs';

const POLICY_CANARY_PATTERN = /sf_policy_[a-z0-9_]*secret(?:_[0-9]+)?/iu;
const FORBIDDEN_FIELD_PATTERN =
  /(?:^|[_-])raw(?:$|[_-])|cookie|token|authorization|headers?|credential|password|secret|sessionHandle|vault|storageState|localStorage|sessionStorage|IndexedDB|screenshot|video|trace|requestBody|responseBody|paymentCredential|confirmationToken|naturalLanguageAuthorization/iu;
const FORBIDDEN_VALUE_PATTERN = new RegExp([
  'sf_policy_[a-z0-9_]*secret(?:_[0-9]+)?',
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
  'confirmation\\s+token',
].join('|'), 'iu');
const ALLOWED_FALSE_SAFETY_FIELDS = new Set([
  'allowCredentialForwarding',
  'allowProfilePersistence',
  'allowStorageStatePersistence',
  'grantsAuthorization',
  'vaultAccessed',
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function cleanText(value, fallback = '') {
  const text = String(value ?? fallback).trim();
  if (!text || FORBIDDEN_VALUE_PATTERN.test(text)) return fallback;
  return text.replace(/\s+/gu, ' ').slice(0, 240);
}

function cleanRef(value, fallback = '') {
  return cleanText(value, fallback)
    .replace(/[\s"'`<>\\?&=%#]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || fallback;
}

function sortedUnique(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => cleanText(value))
    .filter(Boolean))]
    .sort();
}

function scanForbidden(value, findings = [], path = []) {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) scanForbidden(entry, findings, [...path, String(index)]);
    return findings;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (ALLOWED_FALSE_SAFETY_FIELDS.has(key) && entry === false) {
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
  if (typeof value === 'string' && (POLICY_CANARY_PATTERN.test(value) || FORBIDDEN_VALUE_PATTERN.test(value))) {
    findings.push({ path: path.join('.') || '<root>' });
  }
  return findings;
}

export function assertNoPolicyPackRawMaterial(value) {
  const findings = scanForbidden(value);
  if (findings.length > 0) {
    const error = new Error('Policy pack data contains forbidden raw material');
    // @ts-ignore
    error.code = 'policy_pack.raw_material_rejected';
    // @ts-ignore
    error.details = { findings };
    throw error;
  }
  return true;
}

function normalizeMatch(match = {}) {
  return {
    providerId: cleanRef(match.providerId, ''),
    capabilityKind: cleanRef(match.capabilityKind, ''),
    operations: sortedUnique(match.operations),
    authRequired: match.authRequired === true ? true : match.authRequired === false ? false : null,
    requestedScopes: sortedUnique(match.requestedScopes),
    targetOrigin: cleanRef(match.targetOrigin, ''),
    destructive: match.destructive === true ? true : null,
    payment: match.payment === true ? true : null,
  };
}

function normalizeConstraints(constraints = {}) {
  return {
    maxGrantTtlMs: Number.isFinite(Number(constraints.maxGrantTtlMs))
      ? Math.max(0, Number(constraints.maxGrantTtlMs))
      : 300000,
    requireRelease: constraints.requireRelease !== false,
    allowProfilePersistence: false,
    allowStorageStatePersistence: false,
    allowCredentialForwarding: false,
  };
}

function normalizeRule(rule = {}) {
  const effect = POLICY_RULE_EFFECTS.includes(rule.effect) ? rule.effect : 'deny';
  return {
    id: cleanRef(rule.id),
    match: normalizeMatch(rule.match),
    effect,
    reason: cleanRef(rule.reason, effect === 'allow' ? 'policy.allowed' : 'policy.denied'),
    constraints: normalizeConstraints(rule.constraints),
    material: 'descriptor_only',
  };
}

export function sanitizePolicyPack(policyPack = {}) {
  assertNoPolicyPackRawMaterial(policyPack);
  const sanitized = {
    schemaVersion: POLICY_PACK_SCHEMA_VERSION,
    policyPackId: cleanRef(policyPack.policyPackId),
    version: cleanText(policyPack.version, '1.0.0'),
    rules: (Array.isArray(policyPack.rules) ? policyPack.rules : [])
      .map(normalizeRule)
      .filter((rule) => rule.id)
      .sort((left, right) => left.id.localeCompare(right.id)),
    provenance: {
      authoringMode: cleanRef(policyPack.provenance?.authoringMode, 'structured_policy_pack'),
      material: 'descriptor_only',
    },
    redactionRequired: true,
  };
  assertNoPolicyPackRawMaterial(sanitized);
  return sanitized;
}

export function validatePolicyPack(policyPack = {}) {
  try {
    const sanitized = sanitizePolicyPack(policyPack);
    const errors = [];
    if (sanitized.schemaVersion !== POLICY_PACK_SCHEMA_VERSION) errors.push('schemaVersion');
    if (!sanitized.policyPackId) errors.push('policyPackId');
    if (!/^\d+\.\d+\.\d+$/u.test(sanitized.version)) errors.push('version');
    if (!sanitized.rules.length) errors.push('rules');
    const ruleIds = new Set();
    for (const rule of sanitized.rules) {
      if (ruleIds.has(rule.id)) errors.push(`duplicateRule:${rule.id}`);
      ruleIds.add(rule.id);
      if (!POLICY_RULE_EFFECTS.includes(rule.effect)) errors.push(`invalidEffect:${rule.id}`);
      if (rule.match.destructive === true && rule.effect === 'allow') errors.push(`destructiveAllow:${rule.id}`);
      if (rule.match.payment === true && rule.effect === 'allow') errors.push(`paymentAllow:${rule.id}`);
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

export function assertPolicyPackValid(policyPack = {}) {
  const report = validatePolicyPack(policyPack);
  if (!report.ok) {
    const error = new Error('Policy pack is invalid');
    // @ts-ignore
    error.code = 'policy_pack.invalid';
    // @ts-ignore
    error.details = report.errors;
    throw error;
  }
  return jsonClone(report.sanitized);
}

export function sanitizePolicySimulationInput(input = {}) {
  assertNoPolicyPackRawMaterial(input);
  const sanitized = {
    packageId: cleanRef(input.packageId, ''),
    capabilityRef: cleanRef(input.capabilityRef, ''),
    providerId: cleanRef(input.providerId, ''),
    capabilityKind: cleanRef(input.capabilityKind, ''),
    operation: cleanRef(input.operation, ''),
    authRequirement: {
      required: input.authRequirement?.required === true,
      scopes: sortedUnique(input.authRequirement?.scopes ?? input.requestedScopes),
      grantsAuthorization: false,
    },
    requestedScopes: sortedUnique(input.requestedScopes ?? input.authRequirement?.scopes),
    sessionInspection: {
      status: cleanRef(input.sessionInspection?.status, ''),
      active: input.sessionInspection?.active === true,
      scopes: sortedUnique(input.sessionInspection?.scopes),
    },
    targetOrigin: cleanRef(input.targetOrigin, ''),
    materialSummary: {
      materialTypes: sortedUnique(input.materialSummary?.materialTypes),
      injectionTargets: sortedUnique(input.materialSummary?.injectionTargets),
      descriptorOnly: true,
    },
    destructiveRequirement: {
      required: input.destructiveRequirement?.required === true || input.destructive === true,
      executionRequested: false,
    },
    paymentRequirement: {
      required: input.paymentRequirement?.required === true || input.payment === true,
      executionRequested: false,
    },
    naturalLanguageRequestGrantsExecution: false,
    redactionRequired: true,
  };
  assertNoPolicyPackRawMaterial(sanitized);
  return sanitized;
}
