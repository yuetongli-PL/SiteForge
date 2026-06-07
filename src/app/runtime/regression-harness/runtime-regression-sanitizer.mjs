// @ts-check

import {
  RUNTIME_CI_REGRESSION_SNAPSHOT_SCHEMA_VERSION,
} from './runtime-regression-schema.mjs';

const REGRESSION_CANARY_PATTERN = /sf_regression_[a-z0-9_]*secret(?:_[0-9]+)?/iu;
const FORBIDDEN_FIELD_PATTERN =
  /(?:^|[_-])raw(?:$|[_-])|cookie|token|authorization|headers?|credential|password|secret|sessionHandle|sessionObject|vault|storageState|localStorage|sessionStorage|IndexedDB|screenshot|video|trace|requestBody|responseBody|artifactContent|paymentCredential|card|bank/iu;
const FORBIDDEN_VALUE_PATTERN = new RegExp([
  'sf_regression_[a-z0-9_]*secret(?:_[0-9]+)?',
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
  'raw\\s+body',
].join('|'), 'iu');

const ALLOWED_CONTAINERS = new Set([
  'auth',
  'browserGuard',
  'runtime',
  'policy',
  'metadata',
  'auditView',
  'capabilityGraph',
  'capabilityPackage',
  'policyRegression',
]);

const ALLOWED_FALSE_FIELDS = new Set([
  'providerInvoked',
  'executionAttempted',
  'sideEffectAttempted',
  'sideEffectSucceeded',
  'sideEffectFailed',
  'vaultAccessed',
  'paymentBlocked',
  'destructiveBlocked',
  'required',
  'used',
  'present',
  'executionContractConcrete',
  'naturalLanguageRequestGrantsExecution',
  'grantsAuthorization',
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanText(value, fallback = '') {
  const text = String(value ?? '').trim();
  if (!text || FORBIDDEN_VALUE_PATTERN.test(text) || REGRESSION_CANARY_PATTERN.test(text)) return fallback;
  return text
    .replace(/[\s"'`<>\\?&=%#]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 200) || fallback;
}

function cleanLabel(value, fallback = '') {
  const text = String(value ?? '').trim();
  if (!text || FORBIDDEN_VALUE_PATTERN.test(text) || REGRESSION_CANARY_PATTERN.test(text)) return fallback;
  return text.replace(/\s+/gu, ' ').slice(0, 160);
}

function bool(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function list(value = []) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((entry) => cleanText(entry))
    .filter(Boolean))]
    .sort();
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
      if (ALLOWED_CONTAINERS.has(key)) {
        scanForbidden(entry, findings, [...path, key]);
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
  if (typeof value === 'string' && (FORBIDDEN_VALUE_PATTERN.test(value) || REGRESSION_CANARY_PATTERN.test(value))) {
    findings.push({ path: path.join('.') || '<root>' });
  }
  return findings;
}

export function assertNoRuntimeRegressionRawMaterial(value) {
  const findings = scanForbidden(value);
  if (findings.length > 0) {
    fail('Runtime regression snapshot contains forbidden raw material', 'runtime_regression.raw_material_rejected', {
      findings,
    });
  }
  return true;
}

function sanitizeRuntime(runtime = {}) {
  return {
    status: cleanText(runtime.status, 'blocked'),
    reasonCode: cleanText(runtime.reasonCode ?? runtime.reason, ''),
    providerId: cleanText(runtime.providerId, ''),
    capabilityKind: cleanText(runtime.capabilityKind, ''),
    providerInvoked: bool(runtime.providerInvoked),
    executionAttempted: bool(runtime.executionAttempted),
    sideEffectAttempted: bool(runtime.sideEffectAttempted),
    paymentBlocked: bool(runtime.paymentBlocked),
    destructiveBlocked: bool(runtime.destructiveBlocked),
    executionContractConcrete: runtime.executionContractConcrete === undefined
      ? true
      : bool(runtime.executionContractConcrete, true),
  };
}

function sanitizeAuth(auth = {}) {
  return {
    required: bool(auth.required),
    used: bool(auth.used),
    scopes: list(auth.scopes),
    materialTypes: list(auth.materialTypes),
  };
}

function sanitizeBrowserGuard(browserGuard = {}) {
  return {
    present: browserGuard.present === undefined ? true : bool(browserGuard.present, true),
    allowedOrigins: list(browserGuard.allowedOrigins),
  };
}

function sanitizePolicy(policy = {}) {
  return {
    policyId: cleanText(policy.policyId, ''),
    verdict: cleanText(policy.verdict, ''),
    reason: cleanText(policy.reason ?? policy.reasonCode, ''),
    allowed: policy.allowed === undefined ? null : bool(policy.allowed),
  };
}

function sanitizeAuditView(auditView = null) {
  if (!isPlainObject(auditView)) return null;
  return {
    requestId: cleanText(auditView.requestId, ''),
    status: cleanText(auditView.status, ''),
    reason: cleanText(auditView.reason ?? auditView.reasonCode, ''),
    providerId: cleanText(auditView.providerId, ''),
    capabilityKind: cleanText(auditView.capabilityKind, ''),
    providerInvoked: bool(auditView.providerInvoked),
    executionAttempted: bool(auditView.executionAttempted),
    sideEffectAttempted: bool(auditView.sideEffectAttempted),
    auth: sanitizeAuth(auditView.auth),
    redactionRequired: true,
  };
}

export function sanitizeRuntimeRegressionSnapshot(input = {}) {
  assertNoRuntimeRegressionRawMaterial(input);
  if (!isPlainObject(input)) {
    fail('Runtime regression snapshot must be a plain object', 'runtime_regression.snapshot_invalid');
  }
  const snapshot = {
    schemaVersion: RUNTIME_CI_REGRESSION_SNAPSHOT_SCHEMA_VERSION,
    snapshotType: 'runtime_ci_regression_snapshot',
    snapshotId: cleanText(input.snapshotId, ''),
    runtime: sanitizeRuntime(input.runtime),
    auth: sanitizeAuth(input.auth),
    browserGuard: sanitizeBrowserGuard(input.browserGuard),
    policy: sanitizePolicy(input.policy),
    auditView: sanitizeAuditView(input.auditView),
    capabilityGraph: isPlainObject(input.capabilityGraph) ? clone(input.capabilityGraph) : null,
    capabilityPackage: isPlainObject(input.capabilityPackage) ? clone(input.capabilityPackage) : null,
    policyRegression: isPlainObject(input.policyRegression) ? clone(input.policyRegression) : null,
    metadata: {
      label: cleanLabel(input.metadata?.label, ''),
      owner: cleanText(input.metadata?.owner, ''),
    },
    providerInvoked: false,
    browserInvoked: false,
    vaultAccessed: false,
    networkInvoked: false,
    rawMaterialPersisted: false,
    redactionRequired: true,
  };
  if (!snapshot.snapshotId) {
    fail('Runtime regression snapshotId is required', 'runtime_regression.snapshot_invalid');
  }
  assertNoRuntimeRegressionRawMaterial(snapshot);
  return clone(snapshot);
}

export function assertRuntimeRegressionSnapshotValid(input = {}) {
  return sanitizeRuntimeRegressionSnapshot(input);
}
