// @ts-check

import {
  assertNoForbiddenPatterns,
  scanForbiddenPatterns,
} from '../../../domain/sessions/security-guard.mjs';

export const COMPILATION_ARTIFACT_GUARD_SCHEMA_VERSION = 1;

export const SITEFORGE_COMPILED_ARTIFACT_SECRET_SCAN_FILES = Object.freeze([
  'site.json',
  'generated_adapter.json',
  'adapter_contract_tests.json',
  'auth_state_report.json',
  'seeds.json',
  'crawl_static.json',
  'crawl_authenticated.json',
  'crawl_checkpoint.json',
  'network_traces.json',
  'graph.json',
  'classified_graph.json',
  'affordances.json',
  'capabilities.json',
  'execution_plans.json',
  'intents.json',
  'skill.yaml',
  'execution_contracts.json',
  'execution_governance.json',
  'runtime_dispatch_report.json',
  'runtime_execution_report.json',
  'audit_log.json',
  'safety_policy.json',
  'verification_report.json',
  'registry_report.json',
  'build_report.user.json',
  'build_report.debug.json',
  'build_report.json',
  'capability_intent_summary.html',
  'page_reconciliation_report.json',
]);

const RAW_CONTAINER_FIELD_PATTERNS = Object.freeze([
  { reason: 'raw-cookie-field', pattern: /^(?:cookie|cookies|set-cookie)$/iu },
  { reason: 'raw-token-field', pattern: /^(?:token|tokens|access[_-]?token|refresh[_-]?token|csrf|csrf[_-]?token|xsrf|xsec[_-]?token)$/iu },
  { reason: 'raw-credential-field', pattern: /^(?:credential|credentials|password|secret|api[_-]?key|auth[_-]?secret)$/iu },
  { reason: 'raw-authorization-field', pattern: /^(?:authorization|auth[_-]?header|proxy[_-]?authorization)$/iu },
  { reason: 'raw-headers-container', pattern: /^(?:headers|requestHeaders|responseHeaders|rawHeaders|completeHeaders)$/u },
  { reason: 'raw-body-container', pattern: /^(?:body|requestBody|responseBody|rawBody|rawRequestBody|rawResponseBody)$/u },
  { reason: 'raw-request-response-container', pattern: /^(?:rawRequest|rawResponse|requestRaw|responseRaw|requestDump|responseDump)$/u },
  { reason: 'runtime-session-material', pattern: /^(?:sessionView|sessionLease|sessionState|sessionMaterial|rawSession|storageState|localStorage|sessionStorage)$/u },
  { reason: 'browser-profile-material', pattern: /^(?:profilePath|browserProfile|browserProfilePath|userProfile|profileMaterial|userDataDir)$/u },
  { reason: 'reusable-secret-material', pattern: /^(?:vaultSecret|secretMaterial|reusableSecret|sessionSecret|credentialMaterial|cookieMaterial)$/u },
]);

const RAW_TEXT_FIELD_PATTERN =
  /^\s*(?:cookie|cookies|set-cookie|authorization|headers|requestHeaders|responseHeaders|body|requestBody|responseBody|rawBody|sessionMaterial|storageState|profilePath|browserProfilePath|userDataDir)\s*:/imu;

const PERSONAL_SENSITIVE_TEXT_PATTERNS = Object.freeze([
  {
    reason: 'personal-email-address',
    pattern: /\b(?!example(?:\.com|\.org|\.net)\b)[A-Z0-9._%+-]+@(?!example\.)[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  },
]);

const ALLOWED_DESCRIPTOR_FIELD_PATTERNS = Object.freeze([
  /^(?:headerNames|allowedHeaderNames|requiredHeaderNames|headerName|headerNamePattern|headerSchema|headerShape)$/u,
  /^(?:authType|authRequirement|authRequirementRef|sessionRequirementRef|credentialMaterialPolicy|cookieMaterialPersisted)$/u,
  /^(?:bodySchema|requestSchema|requestSchemaRef|responseSchema|responseSchemaRef|payloadTemplate|payloadSlot|slotBindings|parameterConstraints)$/u,
  /^(?:rawBodyPersisted|rawRequestBodyPersisted|rawResponseBodyPersisted|rawHeadersPersisted|rawCredentialMaterialAllowed)$/u,
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function pathToString(path = []) {
  return path.length ? path.join('.') : '$';
}

function isAllowedDescriptorField(name) {
  return ALLOWED_DESCRIPTOR_FIELD_PATTERNS.some((pattern) => pattern.test(String(name ?? '')));
}

/**
 * @param {any[]} findings
 * @param {{ path?: any[], reason: string, pattern?: string | null, artifactName?: string | null }} entry
 */
function pushFinding(findings, {
  path = [],
  reason,
  pattern,
  artifactName,
}) {
  findings.push({
    artifactName: artifactName ?? null,
    path: pathToString(path),
    reason,
    ...(pattern ? { pattern } : {}),
  });
}

/**
 * @param {any} value
 * @param {any[]} findings
 * @param {{ artifactName?: string | null, path?: any[] }} [options]
 */
function scanObjectFields(value, findings, {
  artifactName,
  path = [],
} = {}) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      scanObjectFields(item, findings, { artifactName, path: [...path, String(index)] });
    }
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (!isAllowedDescriptorField(key)) {
      const match = RAW_CONTAINER_FIELD_PATTERNS.find(({ pattern }) => pattern.test(key));
      if (match) {
        pushFinding(findings, {
          artifactName,
          path: childPath,
          reason: match.reason,
        });
        continue;
      }
    }
    scanObjectFields(child, findings, { artifactName, path: childPath });
  }
}

function parseJsonText(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed || !/^[\[{]/u.test(trimmed)) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * @param {string} text
 * @param {any[]} findings
 * @param {{ artifactName?: string | null }} [options]
 */
function scanText(text, findings, { artifactName } = {}) {
  for (const finding of scanForbiddenPatterns(String(text ?? ''))) {
    pushFinding(findings, {
      artifactName,
      path: [finding.path ?? 'text'],
      reason: 'forbidden-sensitive-value-pattern',
      pattern: finding.pattern,
    });
  }
  if (RAW_TEXT_FIELD_PATTERN.test(String(text ?? ''))) {
    pushFinding(findings, {
      artifactName,
      path: ['text'],
      reason: 'raw-sensitive-container-text-field',
      pattern: 'raw-text-field',
    });
  }
  for (const { reason, pattern } of PERSONAL_SENSITIVE_TEXT_PATTERNS) {
    if (pattern.test(String(text ?? ''))) {
      pushFinding(findings, {
        artifactName,
        path: ['text'],
        reason,
      });
    }
  }
}

/**
 * @param {any} value
 * @param {{ artifactName?: string | null }} [options]
 */
export function scanCompiledArtifactSensitiveMaterial(value, { artifactName = null } = {}) {
  const findings = /** @type {any[]} */ ([]);
  if (typeof value === 'string') {
    const parsed = parseJsonText(value);
    if (parsed) {
      scanObjectFields(parsed, findings, { artifactName });
    }
    scanText(value, findings, { artifactName });
    return findings;
  }
  scanObjectFields(value, findings, { artifactName });
  try {
    assertNoForbiddenPatterns(value);
  } catch (error) {
    for (const finding of error?.findings ?? []) {
      pushFinding(findings, {
        artifactName,
        path: [finding.path ?? '$'],
        reason: 'forbidden-sensitive-value-pattern',
        pattern: finding.pattern,
      });
    }
  }
  for (const { reason, pattern } of PERSONAL_SENSITIVE_TEXT_PATTERNS) {
    const text = JSON.stringify(value);
    if (pattern.test(text)) {
      pushFinding(findings, {
        artifactName,
        path: ['text'],
        reason,
      });
    }
  }
  return findings;
}

/**
 * @param {any} value
 * @param {{ artifactName?: string | null }} [options]
 */
export function assertNoCompiledArtifactSensitiveMaterial(value, { artifactName = null } = {}) {
  const findings = scanCompiledArtifactSensitiveMaterial(value, { artifactName });
  if (findings.length) {
    /** @type {Error & Record<string, any>} */
    const error = new Error('Compiled SiteForge artifact contains forbidden sensitive material');
    error.code = 'siteforge.compiled_artifact_sensitive_material';
    error.findings = findings;
    throw error;
  }
  return true;
}
