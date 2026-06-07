// @ts-check

import {
  PAYMENT_AUTHORIZATION_PLAN_SCHEMA_VERSION,
  PAYMENT_CAPABILITY_CLASSES,
  PAYMENT_PRODUCTION_EXECUTION_DEFAULT,
} from './payment-authorization-schema.mjs';

const PAYMENT_CANARY_PATTERN =
  /sf_payment_(?:(?:lab_)?(?:card|bank|token)|authorization_phrase)_secret_[0-9]+/iu;
const FORBIDDEN_FIELD_PATTERN =
  /(?:^|[_-])raw(?:$|[_-])|paymentCredential|card|cardNumber|bank|bankAccount|accountNumber|paymentAccount|privatePayment|token|authorizationPhrase|cookie|authorization|headers?|credential|password|secret/iu;
const FORBIDDEN_VALUE_PATTERN = new RegExp([
  'sf_payment_(?:(?:lab_)?(?:card|bank|token)|authorization_phrase)_secret_[0-9]+',
  'authorization:\\s*bearer',
  ['coo', 'kie:'].join(''),
  ['set-coo', 'kie:'].join(''),
  'payment\\s+credential',
  'card\\s+number',
  'bank\\s+account',
  'authorization\\s+phrase',
  'access[_-]?token',
  'refresh[_-]?token',
].join('|'), 'iu');

const ALLOWED_CONTAINER_FIELDS = new Set([
  'amount',
  'paymentRequirement',
  'partyVerification',
  'authorizationRequirement',
  'outOfBandApproval',
  'policyGate',
  'policySimulation',
  'auditPlanning',
]);

const ALLOWED_BOOLEAN_FIELDS = new Set([
  'paymentRequired',
  'requiresOutOfBandApproval',
  'requiresStrongAuthorization',
  'requiresPayeeVerification',
  'requiresAmountVerification',
  'requiresPolicyGate',
  'strongAuthorizationRequired',
  'outOfBandApprovalRequired',
  'allowNaturalLanguageAuthorization',
  'naturalLanguageRequestGrantsExecution',
  'providerInvoked',
  'browserInvoked',
  'vaultAccessed',
  'networkInvoked',
  'sideEffectAttempted',
  'rawMaterialPersisted',
  'paymentProviderRegistered',
  'productionProviderRegistrationAllowed',
  'paymentProviderProhibited',
]);

const ALLOWED_REF_FIELDS = new Set([
  'valueRef',
  'amountRef',
  'payeeRef',
  'approvalRef',
  'authorizationPolicyRef',
  'policyId',
  'capabilityRef',
  'paymentRequirementRef',
]);

const ALLOWED_TEXT_FIELDS = new Set([
  'currency',
  'capabilityClass',
  'productionExecutionDefault',
  'planningStatus',
  'schemaVersion',
  'planType',
  'classificationType',
  'summaryType',
  'simulationType',
  'decisionType',
  'materialPolicy',
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
  if (FORBIDDEN_VALUE_PATTERN.test(text) || PAYMENT_CANARY_PATTERN.test(text)) {
    fail('Payment authorization value contains forbidden raw material', 'payment_authorization.raw_material_rejected');
  }
  return text
    .replace(/[\s"'`<>\\?&=%#]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 180) || fallback;
}

function cleanCurrency(value) {
  const text = cleanText(value, '').toUpperCase();
  return /^[A-Z]{3}$/u.test(text) ? text : '';
}

function cleanCapabilityClass(value) {
  const text = cleanText(value, 'direct_payment');
  return PAYMENT_CAPABILITY_CLASSES.includes(text) ? text : 'other';
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
      if (
        ALLOWED_REF_FIELDS.has(key)
        && typeof entry === 'string'
        && !FORBIDDEN_VALUE_PATTERN.test(entry)
        && !PAYMENT_CANARY_PATTERN.test(entry)
      ) {
        continue;
      }
      if (
        ALLOWED_TEXT_FIELDS.has(key)
        && typeof entry === 'string'
        && !FORBIDDEN_VALUE_PATTERN.test(entry)
        && !PAYMENT_CANARY_PATTERN.test(entry)
      ) {
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
  if (typeof value === 'string' && (FORBIDDEN_VALUE_PATTERN.test(value) || PAYMENT_CANARY_PATTERN.test(value))) {
    findings.push({ path: path.join('.') || '<root>' });
  }
  return findings;
}

export function assertNoPaymentAuthorizationRawMaterial(value) {
  const findings = scanForbidden(value);
  if (findings.length > 0) {
    fail('Payment authorization artifact contains forbidden raw material', 'payment_authorization.raw_material_rejected', {
      findings,
    });
  }
  return true;
}

export function sanitizePaymentAuthorizationPlan(input = {}) {
  assertNoPaymentAuthorizationRawMaterial(input);
  const amount = isPlainObject(input.amount) ? input.amount : {};
  const sanitized = {
    schemaVersion: PAYMENT_AUTHORIZATION_PLAN_SCHEMA_VERSION,
    planType: 'payment_authorization_plan',
    paymentRequired: input.paymentRequired !== false,
    capabilityClass: cleanCapabilityClass(input.capabilityClass),
    amount: {
      valueRef: cleanText(amount.valueRef ?? input.amountRef, ''),
      currency: cleanCurrency(amount.currency ?? input.currency),
      materialPolicy: 'safe_ref_only',
    },
    payeeRef: cleanText(input.payeeRef, ''),
    requiresOutOfBandApproval: input.requiresOutOfBandApproval === true,
    requiresStrongAuthorization: input.requiresStrongAuthorization === true,
    requiresPayeeVerification: input.requiresPayeeVerification !== false,
    requiresAmountVerification: input.requiresAmountVerification !== false,
    requiresPolicyGate: input.requiresPolicyGate !== false,
    allowNaturalLanguageAuthorization: input.allowNaturalLanguageAuthorization === true,
    productionExecutionDefault: PAYMENT_PRODUCTION_EXECUTION_DEFAULT,
    approvalRef: cleanText(input.approvalRef, ''),
    authorizationPolicyRef: cleanText(input.authorizationPolicyRef, ''),
    capabilityRef: cleanText(input.capabilityRef, ''),
    providerInvoked: false,
    browserInvoked: false,
    vaultAccessed: false,
    networkInvoked: false,
    sideEffectAttempted: false,
    rawMaterialPersisted: false,
    redactionRequired: true,
  };
  assertNoPaymentAuthorizationRawMaterial(sanitized);
  return clone(sanitized);
}

function finding(kind, severity, reasonCode) {
  return { kind, severity, reasonCode };
}

export function validatePaymentAuthorizationPlan(input = {}) {
  try {
    const sanitized = sanitizePaymentAuthorizationPlan(input);
    const errors = [];
    const findings = [];
    if (sanitized.schemaVersion !== PAYMENT_AUTHORIZATION_PLAN_SCHEMA_VERSION) errors.push('schemaVersion');
    if (sanitized.paymentRequired !== true) errors.push('paymentRequired');
    if (!sanitized.amount.valueRef) {
      errors.push('amount.valueRef');
      findings.push(finding('amount_ref_missing', 'critical', 'payment_authorization.amount_ref_required'));
    }
    if (!sanitized.amount.currency) {
      errors.push('amount.currency');
      findings.push(finding('currency_missing', 'critical', 'payment_authorization.currency_required'));
    }
    if (!sanitized.payeeRef) {
      errors.push('payeeRef');
      findings.push(finding('payee_ref_missing', 'critical', 'payment_authorization.payee_ref_required'));
    }
    if (sanitized.requiresStrongAuthorization !== true) errors.push('requiresStrongAuthorization');
    if (sanitized.requiresOutOfBandApproval !== true) {
      errors.push('requiresOutOfBandApproval');
      findings.push(finding('out_of_band_approval_missing', 'critical', 'payment_authorization.out_of_band_approval_required'));
    }
    if (sanitized.allowNaturalLanguageAuthorization === true) errors.push('allowNaturalLanguageAuthorization');
    if (sanitized.productionExecutionDefault !== PAYMENT_PRODUCTION_EXECUTION_DEFAULT) errors.push('productionExecutionDefault');
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

export function assertPaymentAuthorizationPlanValid(input = {}) {
  const report = validatePaymentAuthorizationPlan(input);
  if (!report.ok) {
    fail('Payment authorization plan is invalid', 'payment_authorization.plan_invalid', report.errors);
  }
  return report.sanitized;
}
