// @ts-check

import {
  assertNoForbiddenPatterns,
  redactValue,
} from '../sessions/security-guard.mjs';

export const EXECUTABLE_CAPABILITY_EVIDENCE_CHAIN_SCHEMA_VERSION = 1;

const REQUIRED_EXECUTABLE_CAPABILITY_EVIDENCE_KINDS = Object.freeze([
  'adapter',
  'schema',
  'test',
  'policy',
  'risk',
  'approval',
]);

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function normalizeToken(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:/-]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || undefined;
}

function safeEvidenceRef(value, fallback) {
  const normalized = normalizeText(redactValue(value ?? fallback).value);
  if (!normalized) {
    throw new Error('Executable capability evidence ref is required');
  }
  assertNoForbiddenPatterns(normalized);
  if (
    normalized.includes('[REDACTED]')
    || /\b(?:cookie|authorization|sessdata|csrf|access[_-]?token|refresh[_-]?token|session[_-]?id|browser[_-]?profile|user[_-]?data[_-]?dir)\b/iu.test(normalized)
    || /^https?:\/\//iu.test(normalized)
    || /^[a-z]:[\\/]/iu.test(normalized)
    || /\b\d{1,3}(?:\.\d{1,3}){3}\b/u.test(normalized)
    || /@/u.test(normalized)
    || /\.(?:mjs|cjs|js|cmd|bat|ps1|sh|exe|dll)$/iu.test(normalized)
  ) {
    return 'redacted-evidence-ref';
  }
  return normalized;
}

function normalizeEvidenceKinds(evidenceKinds = REQUIRED_EXECUTABLE_CAPABILITY_EVIDENCE_KINDS) {
  const kinds = [...new Set(evidenceKinds.map(normalizeToken).filter(Boolean))].sort();
  const missing = REQUIRED_EXECUTABLE_CAPABILITY_EVIDENCE_KINDS
    .filter((kind) => !kinds.includes(kind));
  if (missing.length > 0) {
    const error = new Error(`Executable capability evidence chain is missing required evidence: ${missing.join(', ')}`);
    error.code = 'capability.executable_quorum_missing';
    throw error;
  }
  return kinds;
}

export function createExecutableCapabilityEvidenceFixture({
  capability,
  id,
  verifiedAt,
  adapterRef,
  schemaRef,
  testEvidenceRefs = [],
  policyRef,
  riskRef,
  approvalRef,
  apiCatalogRef,
  evidenceKinds = REQUIRED_EXECUTABLE_CAPABILITY_EVIDENCE_KINDS,
} = {}) {
  const target = normalizeToken(capability);
  if (!target) {
    throw new Error('Executable capability evidence chain capability is required');
  }
  const kinds = normalizeEvidenceKinds(evidenceKinds);
  const fixture = {
    schemaVersion: EXECUTABLE_CAPABILITY_EVIDENCE_CHAIN_SCHEMA_VERSION,
    id: normalizeToken(id) ?? `executable-evidence:${target}`,
    capability: target,
    discoveryStatus: 'verified',
    verificationState: 'verified',
    evidenceKinds: kinds,
    adapterRef: safeEvidenceRef(adapterRef, `adapter:${target}`),
    schemaRef: safeEvidenceRef(schemaRef, `schema:${target}`),
    testEvidenceRefs: (Array.isArray(testEvidenceRefs) && testEvidenceRefs.length
      ? testEvidenceRefs
      : [`test:${target}`]).map((ref) => safeEvidenceRef(ref, `test:${target}`)),
    policyRef: safeEvidenceRef(policyRef, `policy:${target}`),
    riskRef: safeEvidenceRef(riskRef, `risk:${target}`),
    approvalRef: safeEvidenceRef(approvalRef, `approval:${target}`),
    apiCatalogRef: apiCatalogRef ? safeEvidenceRef(apiCatalogRef, `artifact:api-catalog:${target}`) : undefined,
    verifiedAt: normalizeText(verifiedAt),
    exactQuorumRequired: true,
    exactQuorumSatisfied: true,
    executableCapabilityAllowed: true,
    descriptorOnly: true,
    redactionRequired: true,
  };
  assertNoForbiddenPatterns(fixture);
  return Object.freeze(fixture);
}

export function assertExecutableCapabilityEvidenceFixtureCompatible(fixture = {}) {
  if (fixture.schemaVersion !== EXECUTABLE_CAPABILITY_EVIDENCE_CHAIN_SCHEMA_VERSION) {
    throw new Error('Executable capability evidence fixture schemaVersion is not compatible');
  }
  normalizeEvidenceKinds(fixture.evidenceKinds);
  if (
    fixture.discoveryStatus !== 'verified'
    || fixture.verificationState !== 'verified'
    || fixture.exactQuorumRequired !== true
    || fixture.exactQuorumSatisfied !== true
    || fixture.executableCapabilityAllowed !== true
    || fixture.descriptorOnly !== true
    || fixture.redactionRequired !== true
  ) {
    throw new Error('Executable capability evidence fixture must be verified, exact-quorum, descriptor-only evidence');
  }
  for (const ref of [
    fixture.adapterRef,
    fixture.schemaRef,
    fixture.policyRef,
    fixture.riskRef,
    fixture.approvalRef,
    ...(Array.isArray(fixture.testEvidenceRefs) ? fixture.testEvidenceRefs : []),
    ...(fixture.apiCatalogRef ? [fixture.apiCatalogRef] : []),
  ]) {
    safeEvidenceRef(ref, ref);
  }
  assertNoForbiddenPatterns(fixture);
  return true;
}
