// @ts-check

const STRUCTURED_DESCRIPTOR_PATH_KEYS = Object.freeze(new Set([
  'authrequirementref',
  'authrequirementrefs',
  'authrequirement',
  'auth',
  'authgate',
  'bodyschema',
  'bodytemplate',
  'downloaderconstraint',
  'downloaderconstraints',
  'downloadertaskdescriptor',
  'destructiveauthorization',
  'destructiverequirement',
  'executioncontract',
  'executioncontractref',
  'executioncontracts',
  'executionprerequisites',
  'fieldconstraints',
  'governancepolicyref',
  'headerschema',
  'headerschemaref',
  'headerschemas',
  'headers',
  'headernames',
  'headernameref',
  'headerschema',
  'impactscope',
  'inputconstraints',
  'outputconstraints',
  'parameterconstraints',
  'parameterschema',
  'payloadtemplate',
  'requestschemaref',
  'requestschema',
  'requesttemplate',
  'responseschemaref',
  'responseschema',
  'riskpolicyref',
  'runtimebindingref',
  'runtimesecretplaceholder',
  'runtimesecretplaceholders',
  'requestedscope',
  'requestedscopes',
  'scope',
  'scopes',
  'schema',
  'schemas',
  'sessionrequirementref',
  'sessionrequirementrefs',
  'slots',
  'template',
]));

const STRUCTURED_EXECUTION_REF_FIELD_NAMES = Object.freeze([
  'authRequirementRef',
  'authRequirementRefs',
  'executionContractRef',
  'executionContractRefs',
  'governancePolicyRef',
  'policyDecisionRef',
  'requestSchemaRef',
  'responseSchemaRef',
  'riskPolicyRef',
  'runtimeBindingRef',
  'runtimeInvocationRequestRef',
  'sessionRequirementRef',
  'sessionRequirementRefs',
]);

const DESCRIPTOR_PLACEHOLDER_PATTERN =
  /^(?:\[REDACTED\]|\{\{[a-z0-9._:/-]+\}\}|<runtime:[a-z0-9._:/-]+>|runtime:(?:secret|slot|session|credential|binding):[a-z0-9._:/-]+|slot:[a-z0-9._:/-]+|placeholder:[a-z0-9._:/-]+)$/iu;

const SCHEMA_LITERAL_PATTERN =
  /^(?:string|number|integer|boolean|object|array|null|unknown|optional|required|runtime_placeholder|runtime_secret_placeholder|runtime_injected|redacted|not_persisted|schema_only|placeholder)$/iu;

const VALUE_LIKE_FIELD_PATTERN =
  /^(?:value|default|example|sample|literal|raw|body|content|secret|token|credential|cookie|authorization|set-cookie|csrf|xsrf|password|card|cvv|pan)$/iu;

const PRIVATE_PATH_PATTERN =
  /(?:^[a-z]:[\\/]|^\\\\|^\/(?:users|home|root|private|etc)\/|\\appdata\\|(?:^|[\\/])browserprofile(?:[\\/]|$)|(?:^|[\\/])user-data-dir(?:[\\/]|$))/iu;

const EXECUTABLE_CODE_PATTERN =
  /(?:\bimport\s*\(|\brequire\s*\(|\beval\s*\(|\bFunction\s*\(|\bfunction\s+[A-Za-z_$][\w$]*\s*\(|(?:^|[=(:,]\s*)(?:async\s*)?\([^)]*\)\s*=>|(?:^|[=(:,]\s*)(?:async\s*)?[A-Za-z_$][\w$]*\s*=>|\bmodule\.exports\b|\bexport\s+default\b)/u;

/**
 * @typedef {{
 *   isSensitiveFieldName?: (name: string) => boolean,
 *   sensitiveContext?: boolean,
 * }} DescriptorSafetyOptions
 */

function normalizeKey(value) {
  return String(value ?? '').trim().replace(/[^a-z0-9]/giu, '').toLowerCase();
}

function pathHasStructuredDescriptorContext(path = []) {
  return path.some((part) => STRUCTURED_DESCRIPTOR_PATH_KEYS.has(normalizeKey(part)));
}

function pathHasSensitivePart(path = [], isSensitiveFieldName = (_name) => false) {
  return path.some((part) => isSensitiveFieldName(String(part ?? '')));
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function isAllowedDescriptorString(value, path = [], {
  isSensitiveFieldName,
  sensitiveContext = false,
} = /** @type {DescriptorSafetyOptions} */ ({})) {
  const text = String(value ?? '');
  if (PRIVATE_PATH_PATTERN.test(text) || EXECUTABLE_CODE_PATTERN.test(text)) {
    return false;
  }
  const sensitivePath = sensitiveContext || pathHasSensitivePart(path, isSensitiveFieldName);
  if (!sensitivePath) {
    return true;
  }
  const lastKey = String(path.at(-1) ?? '');
  if (VALUE_LIKE_FIELD_PATTERN.test(lastKey)) {
    return DESCRIPTOR_PLACEHOLDER_PATTERN.test(text) || SCHEMA_LITERAL_PATTERN.test(text);
  }
  return DESCRIPTOR_PLACEHOLDER_PATTERN.test(text) || SCHEMA_LITERAL_PATTERN.test(text);
}

export function isStructuredExecutionDescriptorPath(path = []) {
  return pathHasStructuredDescriptorContext(path);
}

export function isStructuredExecutionRefFieldName(name) {
  return STRUCTURED_EXECUTION_REF_FIELD_NAMES.includes(String(name ?? ''));
}

export function structuredExecutionRefFieldNames() {
  return [...STRUCTURED_EXECUTION_REF_FIELD_NAMES];
}

export function isSafeStructuredSensitiveDescriptorValue(value, path = [], {
  isSensitiveFieldName,
} = /** @type {DescriptorSafetyOptions} */ ({})) {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
    return true;
  }
  if (typeof value === 'string') {
    return isAllowedDescriptorString(value, path, {
      isSensitiveFieldName,
      sensitiveContext: true,
    });
  }
  if (typeof value === 'function') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.every((item, index) => isSafeStructuredSensitiveDescriptorValue(item, [...path, String(index)], {
      isSensitiveFieldName,
    }));
  }
  if (!isPlainObject(value)) {
    return false;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (
      VALUE_LIKE_FIELD_PATTERN.test(key)
      && typeof child === 'string'
      && !isAllowedDescriptorString(child, childPath, {
        isSensitiveFieldName,
        sensitiveContext: true,
      })
    ) {
      return false;
    }
    if (!isSafeStructuredSensitiveDescriptorValue(child, childPath, {
      isSensitiveFieldName,
    })) {
      return false;
    }
  }
  return true;
}

export function scanUnsafeDescriptorRuntimeValues(value, findings, path = []) {
  if (typeof value === 'function') {
    findings.push({ path: path.join('.') || '$', reason: 'function-value' });
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      scanUnsafeDescriptorRuntimeValues(item, findings, [...path, String(index)]);
    }
    return;
  }
  if (value !== null && typeof value === 'object' && !isPlainObject(value)) {
    findings.push({ path: path.join('.') || '$', reason: 'runtime-object' });
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      scanUnsafeDescriptorRuntimeValues(child, findings, [...path, key]);
    }
    return;
  }
  if (typeof value !== 'string') {
    return;
  }
  if (PRIVATE_PATH_PATTERN.test(value)) {
    findings.push({ path: path.join('.') || '$', reason: 'private-path' });
  }
  if (EXECUTABLE_CODE_PATTERN.test(value)) {
    findings.push({ path: path.join('.') || '$', reason: 'executable-code' });
  }
}
