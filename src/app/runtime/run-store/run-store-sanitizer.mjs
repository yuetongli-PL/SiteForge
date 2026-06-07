// @ts-check

import { RUNTIME_RUN_STORE_SCHEMA_VERSION } from './run-store-schema.mjs';

const RUNSTORE_CANARY_PATTERN = /sf_runstore_[a-z0-9_]*secret(?:_[0-9]+)?/iu;
const RAW_KEY_PATTERN =
  /(?:^|[_-])raw(?:$|[_-])|cookie|token|authorization|headers?|credential|password|secret|sessionHandle|sessionObject|vault|storageState|localStorage|sessionStorage|IndexedDB|rawDom|screenshot|video|trace|requestBody|responseBody|artifactContent|paymentCredential/iu;
const RAW_VALUE_PATTERN = new RegExp([
  'sf_runstore_[a-z0-9_]*secret(?:_[0-9]+)?',
  'authorization:\\s*bearer',
  ['coo', 'kie:'].join(''),
  ['set-coo', 'kie:'].join(''),
  'storageState',
  'localStorage',
  'sessionStorage',
  'IndexedDB',
].join('|'), 'iu');
const ALLOWED_CONTAINER_FIELDS = new Set([
  'policyDecisionSummary',
  'vaultLedgerSummary',
]);
const ALLOWED_FALSE_SAFETY_FIELDS = new Set([
  'rawArtifactContentRead',
  'rawMaterialPersisted',
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function safeText(value, fallback = '') {
  const text = String(value ?? fallback).trim();
  if (!text || RUNSTORE_CANARY_PATTERN.test(text) || RAW_VALUE_PATTERN.test(text)) return fallback;
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

export function assertNoRunStoreRawMaterial(value) {
  const findings = scanRaw(value);
  if (findings.length > 0) {
    const error = new Error('Run store data contains forbidden raw material');
    // @ts-ignore
    error.code = 'run_store.raw_material_rejected';
    // @ts-ignore
    error.details = { findings };
    throw error;
  }
  return true;
}

function sanitizeFile(file = {}) {
  return {
    kind: safeRef(file.kind, 'artifact_metadata'),
    path: safeRef(file.path, 'artifact-metadata.json'),
    digest: safeText(file.digest, ''),
    sizeBytes: Number.isFinite(Number(file.sizeBytes)) ? Math.max(0, Number(file.sizeBytes)) : 0,
    redactionRequired: true,
  };
}

export function sanitizeRunStoreManifest(manifest = {}) {
  assertNoRunStoreRawMaterial(manifest);
  const sanitized = {
    schemaVersion: RUNTIME_RUN_STORE_SCHEMA_VERSION,
    runId: safeRef(manifest.runId, 'run:unknown'),
    createdAt: safeText(manifest.createdAt, 'unknown'),
    invocationRef: safeRef(manifest.invocationRef, ''),
    capabilityRef: safeRef(manifest.capabilityRef, ''),
    executionContractRef: safeRef(manifest.executionContractRef, ''),
    providerId: safeRef(manifest.providerId, ''),
    packageId: safeRef(manifest.packageId, ''),
    policyId: safeRef(manifest.policyId, ''),
    status: safeRef(manifest.status, 'unknown'),
    sideEffectAttempted: manifest.sideEffectAttempted === true,
    files: (Array.isArray(manifest.files) ? manifest.files : []).map(sanitizeFile),
    artifactMetadata: (Array.isArray(manifest.artifactMetadata) ? manifest.artifactMetadata : []).map((artifact) => ({
      artifactRef: safeRef(artifact.artifactRef, ''),
      kind: safeRef(artifact.kind, 'artifact'),
      digest: safeText(artifact.digest, ''),
      savedMaterial: 'sanitized_summary_only',
      redactionRequired: true,
    })),
    policyDecisionSummary: manifest.policyDecisionSummary ? {
      decisionId: safeRef(manifest.policyDecisionSummary.decisionId, ''),
      policyId: safeRef(manifest.policyDecisionSummary.policyId, ''),
      reason: safeRef(manifest.policyDecisionSummary.reason, ''),
      allowed: manifest.policyDecisionSummary.allowed === true,
      redactionRequired: true,
    } : null,
    vaultLedgerSummary: manifest.vaultLedgerSummary ? {
      eventCount: Number.isInteger(manifest.vaultLedgerSummary.eventCount) ? manifest.vaultLedgerSummary.eventCount : 0,
      rawMaterialPersisted: false,
      redactionRequired: true,
    } : null,
    retention: manifest.retention,
    redaction: {
      status: safeRef(manifest.redaction?.status, 'ok'),
      sensitiveInputDetected: manifest.redaction?.sensitiveInputDetected === true,
    },
    sourceDigests: sortedUnique(manifest.sourceDigests),
    integrityDigest: safeText(manifest.integrityDigest, ''),
    warnings: sortedUnique(manifest.warnings),
    redactionRequired: true,
  };
  assertNoRunStoreRawMaterial(sanitized);
  return sanitized;
}
