// @ts-check

import {
  DESTRUCTIVE_ACTION_CLASSES,
  DESTRUCTIVE_EXECUTION_PLAN_SCHEMA_VERSION,
  DESTRUCTIVE_PRODUCTION_EXECUTION_DEFAULT,
} from './destructive-execution-plan-schema.mjs';

const DESTRUCTIVE_CANARY_PATTERN = /sf_destructive_(?:plan_confirmation|target_private)_secret_[0-9]+/iu;
const FORBIDDEN_FIELD_PATTERN =
  /(?:^|[_-])raw(?:$|[_-])|confirmationToken|confirmationPhrase|cookie|token|authorization|headers?|credential|password|secret|paymentCredential|card|bank|privateTarget|targetMaterial/iu;
const FORBIDDEN_VALUE_PATTERN = new RegExp([
  'sf_destructive_(?:plan_confirmation|target_private)_secret_[0-9]+',
  'authorization:\\s*bearer',
  ['coo', 'kie:'].join(''),
  ['set-coo', 'kie:'].join(''),
  'confirmation\\s+token',
  'confirmation\\s+phrase',
  'payment\\s+credential',
].join('|'), 'iu');

const ALLOWED_CONTAINER_FIELDS = new Set([
  'authorizationLifecycle',
  'providerRequirements',
  'targetVerification',
  'dryRunProof',
  'compensationPlan',
  'auditPlanning',
  'policyGate',
]);

const ALLOWED_BOOLEAN_FIELDS = new Set([
  'requiresStrongAuthorization',
  'requiresTwoStepConfirmation',
  'requiresTwoPersonAuthorization',
  'requiresPolicyGate',
  'requiresDryRunProof',
  'requiresCompensationPlan',
  'allowNaturalLanguageAuthorization',
  'naturalLanguageRequestGrantsExecution',
  'confirmDestructiveGrantsExecution',
  'providerInvoked',
  'browserInvoked',
  'vaultAccessed',
  'networkInvoked',
  'sideEffectAttempted',
  'rawMaterialPersisted',
  'blockedByDefault',
  'proofPresent',
  'compensationPresent',
]);

const ALLOWED_REF_FIELDS = new Set([
  'authzRef',
  'challengeRef',
  'confirmationRef',
  'policyId',
  'targetRef',
  'targetSafeRef',
  'dryRunProofRef',
  'compensationPlanRef',
  'rollbackRef',
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
  if (!text) return fallback;
  if (FORBIDDEN_VALUE_PATTERN.test(text) || DESTRUCTIVE_CANARY_PATTERN.test(text)) {
    fail('Destructive planning value contains forbidden raw material', 'destructive_planning.raw_material_rejected');
  }
  return text
    .replace(/[\s"'`<>\\?&=%#]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 180) || fallback;
}

function cleanActionClass(value) {
  const text = cleanText(value, 'other');
  return DESTRUCTIVE_ACTION_CLASSES.includes(text) ? text : 'other';
}

function scanForbidden(value, findings = [], path = []) {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) scanForbidden(entry, findings, [...path, String(index)]);
    return findings;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (ALLOWED_BOOLEAN_FIELDS.has(key) && typeof entry === 'boolean') {
        continue;
      }
      if (ALLOWED_CONTAINER_FIELDS.has(key)) {
        scanForbidden(entry, findings, [...path, key]);
        continue;
      }
      if (ALLOWED_REF_FIELDS.has(key) && typeof entry === 'string' && !FORBIDDEN_VALUE_PATTERN.test(entry)) {
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
  if (typeof value === 'string' && (FORBIDDEN_VALUE_PATTERN.test(value) || DESTRUCTIVE_CANARY_PATTERN.test(value))) {
    findings.push({ path: path.join('.') || '<root>' });
  }
  return findings;
}

export function assertNoDestructivePlanningRawMaterial(value) {
  const findings = scanForbidden(value);
  if (findings.length > 0) {
    fail('Destructive planning artifact contains forbidden raw material', 'destructive_planning.raw_material_rejected', {
      findings,
    });
  }
  return true;
}

export function sanitizeDestructiveExecutionPlan(input = {}) {
  assertNoDestructivePlanningRawMaterial(input);
  const sanitized = {
    schemaVersion: DESTRUCTIVE_EXECUTION_PLAN_SCHEMA_VERSION,
    planType: 'destructive_execution_plan',
    actionClass: cleanActionClass(input.actionClass),
    targetRef: cleanText(input.targetRef, ''),
    targetSafeRef: cleanText(input.targetSafeRef ?? input.targetRef, ''),
    requiresStrongAuthorization: input.requiresStrongAuthorization === true,
    requiresTwoStepConfirmation: input.requiresTwoStepConfirmation !== false,
    requiresTwoPersonAuthorization: input.requiresTwoPersonAuthorization === true,
    requiresPolicyGate: input.requiresPolicyGate !== false,
    requiresDryRunProof: input.requiresDryRunProof !== false,
    requiresCompensationPlan: input.requiresCompensationPlan !== false,
    allowNaturalLanguageAuthorization: false,
    productionExecutionDefault: DESTRUCTIVE_PRODUCTION_EXECUTION_DEFAULT,
    dryRunProofRef: cleanText(input.dryRunProofRef, ''),
    compensationPlanRef: cleanText(input.compensationPlanRef, ''),
    providerInvoked: false,
    browserInvoked: false,
    vaultAccessed: false,
    networkInvoked: false,
    sideEffectAttempted: false,
    rawMaterialPersisted: false,
    redactionRequired: true,
  };
  if (input.allowNaturalLanguageAuthorization === true) {
    sanitized.allowNaturalLanguageAuthorization = true;
  }
  assertNoDestructivePlanningRawMaterial(sanitized);
  return clone(sanitized);
}

export function validateDestructiveExecutionPlan(input = {}) {
  try {
    const sanitized = sanitizeDestructiveExecutionPlan(input);
    const errors = [];
    const findings = [];
    if (sanitized.schemaVersion !== DESTRUCTIVE_EXECUTION_PLAN_SCHEMA_VERSION) errors.push('schemaVersion');
    if (!sanitized.targetRef) errors.push('targetRef');
    if (sanitized.requiresStrongAuthorization !== true) errors.push('requiresStrongAuthorization');
    if (sanitized.allowNaturalLanguageAuthorization === true) errors.push('allowNaturalLanguageAuthorization');
    if (sanitized.productionExecutionDefault !== DESTRUCTIVE_PRODUCTION_EXECUTION_DEFAULT) errors.push('productionExecutionDefault');
    if (sanitized.requiresDryRunProof === true && !sanitized.dryRunProofRef) {
      findings.push({
        kind: 'dry_run_proof_missing',
        severity: 'high',
        reasonCode: 'destructive_planning.dry_run_proof_required',
      });
    }
    if (sanitized.requiresCompensationPlan === true && !sanitized.compensationPlanRef) {
      findings.push({
        kind: 'compensation_plan_missing',
        severity: 'high',
        reasonCode: 'destructive_planning.compensation_plan_required',
      });
    }
    return {
      ok: errors.length === 0,
      errors,
      findings,
      sanitized,
    };
  } catch (error) {
    return {
      ok: false,
      errors: [error.code ?? error.message],
      findings: [],
      sanitized: null,
    };
  }
}

export function assertDestructiveExecutionPlanValid(input = {}) {
  const report = validateDestructiveExecutionPlan(input);
  if (!report.ok) {
    fail('Destructive execution plan is invalid', 'destructive_planning.plan_invalid', report.errors);
  }
  return report.sanitized;
}
