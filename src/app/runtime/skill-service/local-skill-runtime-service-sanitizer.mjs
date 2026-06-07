// @ts-check

import {
  createSkillRuntimeInvocationRequest,
} from '../skill-invocation/skill-runtime-invocation-validator.mjs';
import {
  assertNoSkillInvocationRawMaterial,
} from '../skill-invocation/skill-runtime-invocation-sanitizer.mjs';
import {
  LOCAL_SKILL_RUNTIME_SERVICE_OPERATIONS,
  LOCAL_SKILL_RUNTIME_SERVICE_RESPONSE_SCHEMA_VERSION,
  LOCAL_SKILL_RUNTIME_SERVICE_SCHEMA_VERSION,
} from './local-skill-runtime-service-schema.mjs';

const EXTERNAL_SKILL_CANARY_PATTERN = /sf_external_skill_[a-z0-9_]*secret[a-z0-9_]*/iu;
const FORBIDDEN_DIRECT_FIELD_NAMES = new Set([
  'provider',
  'providers',
  'providerRegistry',
  'runtimeContext',
  'vault',
  'sessionVault',
  'browserRuntime',
  'browserRuntimeFactory',
  'auditRecorder',
  'fetch',
  'httpServer',
  'listen',
  'bindAddress',
]);
const FORBIDDEN_FIELD_PATTERN =
  /(?:^|[_-])raw(?:$|[_-])|sessionHandle|cookie|token|authorization|headers?|credential|password|secret|storageState|localStorage|sessionStorage|IndexedDB|requestBody|responseBody|paymentCredential|card|bank|profile/iu;
const FORBIDDEN_VALUE_PATTERN = new RegExp([
  'sf_external_skill_[a-z0-9_]*secret[a-z0-9_]*',
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
const ALLOWED_ENVELOPE_FIELDS = new Set([
  'schemaVersion',
  'requestType',
  'operation',
  'mode',
  'skillRequest',
  'packageManifest',
  'policyPack',
  'policyDecision',
  'redactionRequired',
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function sanitizeTaskText(value) {
  if (value === undefined || value === null) return value;
  return String(value)
    .replace(EXTERNAL_SKILL_CANARY_PATTERN, '[redacted]')
    .replace(FORBIDDEN_VALUE_PATTERN, '[redacted]')
    .replace(/\s+/gu, ' ')
    .slice(0, 280);
}

function scanRequestBoundary(value, findings = [], path = []) {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      scanRequestBoundary(entry, findings, [...path, String(index)]);
    }
    return findings;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'taskText' || key === 'description') {
        continue;
      }
      if (ALLOWED_CONTAINER_FIELDS.has(key)) {
        scanRequestBoundary(entry, findings, [...path, key]);
        continue;
      }
      if (FORBIDDEN_DIRECT_FIELD_NAMES.has(key) || FORBIDDEN_FIELD_PATTERN.test(key)) {
        findings.push({ path: [...path, key].join('.') });
        continue;
      }
      scanRequestBoundary(entry, findings, [...path, key]);
    }
    return findings;
  }
  if (typeof value === 'string' && (EXTERNAL_SKILL_CANARY_PATTERN.test(value) || FORBIDDEN_VALUE_PATTERN.test(value))) {
    findings.push({ path: path.join('.') || '<root>' });
  }
  return findings;
}

function assertLocalServiceRequestBoundary(value) {
  const findings = scanRequestBoundary(value);
  if (findings.length > 0) {
    fail('Local skill runtime service request contains forbidden material or direct runtime access', 'local_skill_service.request_rejected', {
      findings,
    });
  }
}

function assertEnvelopeBoundary(input = {}) {
  const findings = [];
  for (const key of Object.keys(input)) {
    if (!ALLOWED_ENVELOPE_FIELDS.has(key)) {
      findings.push({ path: key });
    }
  }
  if (findings.length > 0) {
    fail('Local skill runtime service request contains unsupported envelope fields', 'local_skill_service.request_rejected', {
      findings,
    });
  }
}

function safeOperation(value, fallback = 'dryRun') {
  return LOCAL_SKILL_RUNTIME_SERVICE_OPERATIONS.includes(value) ? value : fallback;
}

function normalizeEnvelope(input = {}, forcedOperation = null) {
  if (!isPlainObject(input)) {
    fail('Local skill runtime service request must be a JSON object', 'local_skill_service.request_invalid');
  }
  const hasEnvelope = isPlainObject(input.skillRequest);
  if (hasEnvelope) {
    assertEnvelopeBoundary(input);
  }
  const operation = safeOperation(forcedOperation ?? input.operation ?? input.mode, 'dryRun');
  const skillRequestInput = hasEnvelope ? input.skillRequest : input;
  if (!isPlainObject(skillRequestInput)) {
    fail('Local skill runtime service skillRequest must be a JSON object', 'local_skill_service.request_invalid');
  }
  const skillRequestBoundaryInput = {
    ...skillRequestInput,
    taskText: sanitizeTaskText(skillRequestInput.taskText),
    description: sanitizeTaskText(skillRequestInput.description),
  };
  assertLocalServiceRequestBoundary(skillRequestBoundaryInput);
  const skillRequest = createSkillRuntimeInvocationRequest({
    ...skillRequestBoundaryInput,
    mode: operation === 'execute' ? 'execute' : 'dryRun',
  });
  const packageManifest = hasEnvelope && input.packageManifest !== undefined ? input.packageManifest : null;
  const policyPack = hasEnvelope && input.policyPack !== undefined ? input.policyPack : null;
  const policyDecision = hasEnvelope && input.policyDecision !== undefined ? input.policyDecision : null;
  assertLocalServiceRequestBoundary({ packageManifest, policyPack, policyDecision });
  return {
    schemaVersion: LOCAL_SKILL_RUNTIME_SERVICE_SCHEMA_VERSION,
    requestType: 'LocalSkillRuntimeServiceRequest',
    operation,
    skillRequest,
    packageManifest: packageManifest === null ? null : clone(packageManifest),
    policyPack: policyPack === null ? null : clone(policyPack),
    policyDecision: policyDecision === null ? null : clone(policyDecision),
    redactionRequired: true,
  };
}

export function sanitizeLocalSkillRuntimeServiceRequest(input = {}, options = {}) {
  const request = normalizeEnvelope(input, options.operation ?? null);
  assertNoSkillInvocationRawMaterial(request.skillRequest);
  return request;
}

function safeErrorDetails(details) {
  if (Array.isArray(details)) {
    return details.map((entry) => String(entry).slice(0, 160));
  }
  if (isPlainObject(details) && Array.isArray(details.findings)) {
    return {
      findings: details.findings.map((finding) => ({
        path: String(finding.path ?? '<unknown>').slice(0, 160),
      })),
    };
  }
  return undefined;
}

export function createLocalSkillRuntimeServiceError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'local_skill_service.failed';
  const envelope = {
    schemaVersion: LOCAL_SKILL_RUNTIME_SERVICE_RESPONSE_SCHEMA_VERSION,
    responseType: 'LocalSkillRuntimeServiceResponse',
    serviceMode: 'local-sdk',
    status: 'error',
    error: {
      code,
      message: code,
      details: safeErrorDetails(error?.details),
    },
    redactionRequired: true,
  };
  assertNoSkillInvocationRawMaterial(envelope);
  return envelope;
}

export function sanitizeLocalSkillRuntimeServiceResponse(response = {}) {
  const envelope = {
    schemaVersion: LOCAL_SKILL_RUNTIME_SERVICE_RESPONSE_SCHEMA_VERSION,
    responseType: 'LocalSkillRuntimeServiceResponse',
    serviceMode: 'local-sdk',
    ...response,
    redactionRequired: true,
  };
  assertNoSkillInvocationRawMaterial(envelope);
  return clone(envelope);
}
