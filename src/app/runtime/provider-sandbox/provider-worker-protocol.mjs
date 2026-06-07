// @ts-check

export const PROVIDER_SANDBOX_PROTOCOL_SCHEMA_VERSION = 1;
export const PROVIDER_SANDBOX_RESULT_SCHEMA_VERSION = 1;
export const PROVIDER_SANDBOX_LIMITATION_STATEMENT =
  'Provider Sandbox V1 is a restricted provider service boundary, not a full OS-level sandbox.';

const SANDBOX_CANARY_PATTERN = /sf_sandbox_[a-z0-9_]*secret(?:_[0-9]+)?/iu;
const RAW_KEY_PATTERN =
  /(?:^|[_-])raw(?:$|[_-])|cookie|authorization|credential|password|secret|sessionVault|sessionHandle|runtimeContext|browserContext|storageState|localStorage|sessionStorage|IndexedDB|processEnv|env|fileSecret|headers?|body|request|response|page|vault/iu;
const RAW_VALUE_PATTERN = new RegExp([
  'sf_sandbox_[a-z0-9_]*secret(?:_[0-9]+)?',
  'authorization:\\s*bearer',
  ['coo', 'kie:'].join(''),
  ['set-coo', 'kie:'].join(''),
  'storageState',
  'localStorage',
  'sessionStorage',
  'IndexedDB',
].join('|'), 'iu');
const ALLOWED_CONTAINER_FIELDS = new Set([
  'capability',
  'executionContract',
  'invocationRequest',
]);
const ALLOWED_FALSE_SAFETY_FIELDS = new Set([
  'rawBrowserHandleAvailable',
  'rawEnvironmentAvailable',
  'rawMaterialAvailable',
  'rawRuntimeContextAvailable',
  'rawVaultAvailable',
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function safeText(value, fallback = '') {
  const text = String(value ?? fallback).trim();
  if (!text || SANDBOX_CANARY_PATTERN.test(text) || RAW_VALUE_PATTERN.test(text)) return fallback;
  return text.replace(/\s+/gu, ' ').slice(0, 240);
}

function safeRef(value, fallback = '') {
  return safeText(value, fallback)
    .replace(/[\s"'`<>\\?&=%#]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || fallback;
}

function sortedUnique(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => safeText(value))
    .filter(Boolean))]
    .sort();
}

function sanitizeDescriptor(value = {}) {
  if (!isPlainObject(value)) return {};
  const output = {};
  for (const key of ['capabilityId', 'capabilityRef', 'executionContractRef', 'operationKind', 'providerId']) {
    const text = safeRef(value[key]);
    if (text) output[key] = text;
  }
  for (const key of ['capabilityKinds', 'providerCompatibility', 'artifactRefs']) {
    const list = sortedUnique(value[key]);
    if (list.length > 0) output[key] = list;
  }
  for (const key of ['dryRun', 'destructiveAction', 'paymentOrFundsAction']) {
    if (typeof value[key] === 'boolean') output[key] = value[key];
  }
  return output;
}

function scanRaw(value, findings = [], path = []) {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) scanRaw(entry, findings, [...path, String(index)]);
    return findings;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (ALLOWED_CONTAINER_FIELDS.has(key)) {
        scanRaw(entry, findings, [...path, key]);
        continue;
      }
      if (ALLOWED_FALSE_SAFETY_FIELDS.has(key) && entry === false) {
        continue;
      }
      if (RAW_KEY_PATTERN.test(key)) {
        findings.push({ path: [...path, key].join('.') });
        continue;
      }
      scanRaw(entry, findings, [...path, key]);
    }
    return findings;
  }
  if (typeof value === 'string' && RAW_VALUE_PATTERN.test(value)) {
    findings.push({ path: path.join('.') || '<root>' });
  }
  return findings;
}

export function assertNoProviderSandboxRawMaterial(value) {
  const findings = scanRaw(value);
  if (findings.length > 0) {
    const error = new Error('Provider sandbox message contains forbidden raw material');
    // @ts-ignore
    error.code = 'provider_sandbox.raw_material_rejected';
    // @ts-ignore
    error.details = { findings };
    throw error;
  }
  return true;
}

export function sanitizeProviderSandboxMessage(message = {}) {
  assertNoProviderSandboxRawMaterial(message);
  const sanitized = {
    schemaVersion: PROVIDER_SANDBOX_PROTOCOL_SCHEMA_VERSION,
    messageId: safeRef(message.messageId, 'provider-sandbox-message'),
    providerId: safeRef(message.providerId, ''),
    invocationRequest: sanitizeDescriptor(message.invocationRequest),
    executionContract: sanitizeDescriptor(message.executionContract),
    capability: sanitizeDescriptor(message.capability),
    policy: {
      dryRun: message.policy?.dryRun !== false,
      timeoutMs: Number.isFinite(Number(message.policy?.timeoutMs)) ? Math.max(1, Number(message.policy.timeoutMs)) : 1000,
      allowOutputWrite: message.policy?.allowOutputWrite === true,
      allowAuthAdapter: message.policy?.allowAuthAdapter === true,
      allowControlledBrowserRuntime: message.policy?.allowControlledBrowserRuntime === true,
      allowNetwork: message.policy?.allowNetwork === true,
    },
    limitationStatement: PROVIDER_SANDBOX_LIMITATION_STATEMENT,
    redactionRequired: true,
  };
  assertNoProviderSandboxRawMaterial(sanitized);
  return sanitized;
}

export function createProviderSandboxEnvelope(options = {}) {
  assertNoProviderSandboxRawMaterial(options);
  return sanitizeProviderSandboxMessage({
    messageId: options.messageId,
    providerId: options.providerId,
    invocationRequest: options.invocationRequest,
    executionContract: options.executionContract,
    capability: options.capability,
    policy: options.policy,
  });
}
