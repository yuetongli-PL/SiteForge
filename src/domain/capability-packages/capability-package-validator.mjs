// @ts-check

import { jsonClone } from '../../shared/clone.mjs';
import {
  CAPABILITY_PACKAGE_OPERATION_KINDS,
  CAPABILITY_PACKAGE_PROVIDER_COMPATIBILITY_VALUES,
  CAPABILITY_PACKAGE_RISK_LEVELS,
  CAPABILITY_PACKAGE_SCHEMA_VERSION,
} from './capability-package-schema.mjs';

const PACKAGE_CANARY_PATTERN = /sf_package_[a-z0-9_]*secret(?:_[0-9]+)?/iu;
const FORBIDDEN_FIELD_PATTERN =
  /(?:^|[_-])raw(?:$|[_-])|cookie|setCookie|authorizationHeader|password|credential|secret|sessionHandle|storageState|localStorage|sessionStorage|IndexedDB|screenshot|video|trace|requestHeaders|responseHeaders|requestBody|responseBody|rawBody|rawRequest|rawResponse|privateForm/iu;
const FORBIDDEN_VALUE_PATTERN = new RegExp([
  'sf_package_[a-z0-9_]*secret(?:_[0-9]+)?',
  'authorization:\\s*bearer',
  ['coo', 'kie:'].join(''),
  ['set-coo', 'kie:'].join(''),
  'access[_-]?token',
  'refresh[_-]?token',
  ['SESS', 'DATA='].join(''),
  'storageState',
  'localStorage',
  'sessionStorage',
  'IndexedDB',
].join('|'), 'iu');

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function clone(value) {
  return jsonClone(value);
}

function text(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function cleanText(value, fallback = '') {
  const normalized = text(value, fallback);
  if (!normalized || FORBIDDEN_VALUE_PATTERN.test(normalized)) {
    return fallback;
  }
  return normalized.replace(/\s+/gu, ' ').slice(0, 240);
}

function cleanRef(value, fallback = '') {
  return cleanText(value, fallback)
    .replace(/[\s"'`<>\\]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || fallback;
}

function sortedUnique(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => cleanText(value))
    .filter(Boolean))]
    .sort();
}

function scanForbiddenMaterial(value, findings = [], path = []) {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      scanForbiddenMaterial(entry, findings, [...path, String(index)]);
    }
    return findings;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_FIELD_PATTERN.test(key)) {
        findings.push({ path: [...path, key].join('.') });
        continue;
      }
      scanForbiddenMaterial(entry, findings, [...path, key]);
    }
    return findings;
  }
  if (typeof value === 'string' && (PACKAGE_CANARY_PATTERN.test(value) || FORBIDDEN_VALUE_PATTERN.test(value))) {
    findings.push({ path: path.join('.') || '<root>' });
  }
  return findings;
}

function assertNoForbiddenPackageMaterial(value) {
  const findings = scanForbiddenMaterial(value);
  if (findings.length > 0) {
    const error = new Error('Capability package contains forbidden raw material');
    // @ts-ignore
    error.code = 'capability_package.raw_material_rejected';
    // @ts-ignore
    error.details = { findings };
    throw error;
  }
  return true;
}

function normalizeAuthRequirement(value = {}) {
  return {
    required: value.required === true,
    scopes: sortedUnique(value.scopes),
    material: 'descriptor_only',
    grantsAuthorization: false,
  };
}

function normalizeRiskClassification(value = {}) {
  const level = CAPABILITY_PACKAGE_RISK_LEVELS.includes(value.level)
    ? value.level
    : 'public_read';
  return {
    level,
    destructive: value.destructive === true || level === 'destructive',
    payment: value.payment === true || level === 'payment',
    sideEffecting: value.sideEffecting === true || ['ordinary_write', 'destructive', 'payment'].includes(level),
    material: 'descriptor_only',
  };
}

function normalizeProviderCompatibility(values = []) {
  return sortedUnique(values);
}

function normalizePolicyRequirements(value = {}) {
  return {
    executionGates: sortedUnique(value.executionGates),
    auditRequired: value.auditRequired === true,
    confirmationRequired: value.confirmationRequired === true,
    strongConfirmationRequired: value.strongConfirmationRequired === true,
    sitePolicyExplicitAllowRequired: value.sitePolicyExplicitAllowRequired === true,
    naturalLanguageRequestGrantsExecution: false,
    material: 'descriptor_only',
  };
}

function normalizeCapability(capability = {}) {
  const kind = CAPABILITY_PACKAGE_OPERATION_KINDS.includes(capability.kind)
    ? capability.kind
    : 'navigate';
  const providerCompatibility = normalizeProviderCompatibility(capability.providerCompatibility);
  return {
    capabilityRef: cleanRef(capability.capabilityRef),
    capabilityId: cleanRef(capability.capabilityId),
    sourceCapabilityId: cleanRef(capability.sourceCapabilityId),
    kind,
    risk: CAPABILITY_PACKAGE_RISK_LEVELS.includes(capability.risk) ? capability.risk : 'public_read',
    executionContractRef: cleanRef(capability.executionContractRef),
    providerCompatibility,
    authRequirement: normalizeAuthRequirement(capability.authRequirement),
    riskClassification: normalizeRiskClassification(capability.riskClassification ?? { level: capability.risk }),
    policyRequirements: normalizePolicyRequirements(capability.policyRequirements),
    runtimeCallable: capability.runtimeCallable === true,
    executableByDefault: capability.executableByDefault === true,
    skillCallable: capability.skillCallable !== false,
    material: 'descriptor_only',
  };
}

function normalizeExecutionContract(contract = {}) {
  const kind = CAPABILITY_PACKAGE_OPERATION_KINDS.includes(contract.kind)
    ? contract.kind
    : 'navigate';
  return {
    executionContractRef: cleanRef(contract.executionContractRef),
    sourceExecutionContractId: cleanRef(contract.sourceExecutionContractId),
    capabilityRef: cleanRef(contract.capabilityRef),
    kind,
    concreteEnough: contract.concreteEnough === true,
    selectorConfidence: Number.isFinite(contract.selectorConfidence) ? contract.selectorConfidence : null,
    completionSignals: sortedUnique(contract.completionSignals),
    providerCompatibility: normalizeProviderCompatibility(contract.providerCompatibility),
    payloadTemplate: {
      material: 'template_only',
      requiredSlotNames: sortedUnique(contract.payloadTemplate?.requiredSlotNames),
      savedMaterial: 'sanitized_summary_only',
    },
    policyRequirements: normalizePolicyRequirements(contract.policyRequirements),
    runtimeBindingRef: cleanRef(contract.runtimeBindingRef),
    material: 'descriptor_only',
  };
}

export function sanitizeCapabilityPackageManifest(manifest = {}) {
  assertNoForbiddenPackageMaterial(manifest);
  const capabilities = (Array.isArray(manifest.capabilities) ? manifest.capabilities : [])
    .map(normalizeCapability)
    .filter((capability) => capability.capabilityRef && capability.capabilityId && capability.executionContractRef)
    .sort((left, right) => left.capabilityRef.localeCompare(right.capabilityRef));
  const executionContracts = (Array.isArray(manifest.executionContracts) ? manifest.executionContracts : [])
    .map(normalizeExecutionContract)
    .filter((contract) => contract.executionContractRef && contract.capabilityRef)
    .sort((left, right) => left.executionContractRef.localeCompare(right.executionContractRef));
  const sanitized = {
    schemaVersion: CAPABILITY_PACKAGE_SCHEMA_VERSION,
    packageId: cleanRef(manifest.packageId),
    version: cleanText(manifest.version, '1.0.0'),
    siteOrigin: cleanText(manifest.siteOrigin),
    graphDigest: cleanText(manifest.graphDigest),
    packageDigest: cleanText(manifest.packageDigest),
    capabilities,
    executionContracts,
    provenance: {
      schemaVersion: 1,
      compiledAt: cleanText(manifest.provenance?.compiledAt, 'unknown'),
      compilerVersion: cleanText(manifest.provenance?.compilerVersion, 'unknown'),
      sourceDigest: cleanText(manifest.provenance?.sourceDigest),
      graphDigest: cleanText(manifest.provenance?.graphDigest ?? manifest.graphDigest),
      graphVersion: cleanText(manifest.provenance?.graphVersion),
      material: 'descriptor_only',
    },
    auditMetadata: {
      packageId: cleanRef(manifest.auditMetadata?.packageId ?? manifest.packageId),
      version: cleanText(manifest.auditMetadata?.version ?? manifest.version, '1.0.0'),
      packageDigest: cleanText(manifest.auditMetadata?.packageDigest ?? manifest.packageDigest),
      graphDigest: cleanText(manifest.auditMetadata?.graphDigest ?? manifest.graphDigest),
      redactionRequired: true,
    },
    redactionRequired: true,
  };
  assertNoForbiddenPackageMaterial(sanitized);
  return sanitized;
}

export function validateCapabilityPackageManifest(manifest = {}) {
  const errors = [];
  try {
    const sanitized = sanitizeCapabilityPackageManifest(manifest);
    if (sanitized.schemaVersion !== CAPABILITY_PACKAGE_SCHEMA_VERSION) errors.push('schemaVersion');
    if (!sanitized.packageId.startsWith('sitepkg:')) errors.push('packageId');
    if (!/^\d+\.\d+\.\d+$/u.test(sanitized.version)) errors.push('version');
    if (!/^https?:\/\/[a-z0-9.-]+(?::\d+)?$/iu.test(sanitized.siteOrigin)) errors.push('siteOrigin');
    if (!/^sha256:[a-f0-9]{64}$/u.test(sanitized.graphDigest)) errors.push('graphDigest');
    if (!Array.isArray(sanitized.capabilities) || sanitized.capabilities.length === 0) errors.push('capabilities');
    if (!Array.isArray(sanitized.executionContracts)) errors.push('executionContracts');
    const contractRefs = new Set(sanitized.executionContracts.map((contract) => contract.executionContractRef));
    for (const capability of sanitized.capabilities) {
      for (const provider of capability.providerCompatibility) {
        if (!CAPABILITY_PACKAGE_PROVIDER_COMPATIBILITY_VALUES.includes(provider)) {
          errors.push(`unknownProviderCompatibility:${provider}`);
        }
      }
      if (!contractRefs.has(capability.executionContractRef)) {
        errors.push(`missingExecutionContract:${capability.capabilityRef}`);
      }
      if (capability.riskClassification.payment === true && capability.executableByDefault === true) {
        errors.push(`paymentExecutableByDefault:${capability.capabilityRef}`);
      }
      if (capability.riskClassification.payment === true && capability.runtimeCallable === true) {
        errors.push(`paymentRuntimeCallable:${capability.capabilityRef}`);
      }
      if (capability.riskClassification.destructive === true && capability.executableByDefault === true) {
        errors.push(`destructiveExecutableByDefault:${capability.capabilityRef}`);
      }
      if (capability.riskClassification.destructive === true && capability.runtimeCallable === true) {
        errors.push(`destructiveRuntimeCallable:${capability.capabilityRef}`);
      }
    }
    for (const contract of sanitized.executionContracts) {
      for (const provider of contract.providerCompatibility) {
        if (!CAPABILITY_PACKAGE_PROVIDER_COMPATIBILITY_VALUES.includes(provider)) {
          errors.push(`unknownProviderCompatibility:${provider}`);
        }
      }
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

export function assertCapabilityPackageManifestValid(manifest = {}) {
  const report = validateCapabilityPackageManifest(manifest);
  if (!report.ok) {
    const error = new Error('Capability package manifest is invalid');
    // @ts-ignore
    error.code = 'capability_package.manifest_invalid';
    // @ts-ignore
    error.details = report.errors;
    throw error;
  }
  return report.sanitized;
}

export function exportCapabilityPackageSafeJson(manifest = {}) {
  const sanitized = assertCapabilityPackageManifestValid(manifest);
  return JSON.stringify(sanitized, null, 2);
}

export function importCapabilityPackageSafeJson(json) {
  const parsed = JSON.parse(String(json));
  return assertCapabilityPackageManifestValid(parsed);
}

export function cloneCapabilityPackageManifest(manifest = {}) {
  return clone(assertCapabilityPackageManifestValid(manifest));
}
