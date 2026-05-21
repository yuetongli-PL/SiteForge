// @ts-check

import {
  createApiCandidateMultiAspectVerificationResultFromFixtures,
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
  verifyApiCandidateForCatalog,
  writeRuntimeVerifiedApiCatalogStoreArtifacts,
} from './api-candidates.mjs';
import { apiCandidateFromObservedRequest } from './api-discovery.mjs';
import { assertNoForbiddenPatterns } from '../sessions/security-guard.mjs';

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function normalizeEvidenceRef(value, fieldName) {
  const ref = normalizeText(value);
  if (!ref) {
    throw new Error(`Verified API catalog promotion ${fieldName} is required`);
  }
  assertNoForbiddenPatterns(ref);
  return ref;
}

function normalizeEvidenceRefs(values, fieldName) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`Verified API catalog promotion ${fieldName} is required`);
  }
  return values.map((value) => normalizeEvidenceRef(value, fieldName));
}

/** @param {Record<string, any>} [promotionEvidence] */
function normalizePromotionEvidence(promotionEvidence = {}) {
  if (!promotionEvidence || typeof promotionEvidence !== 'object' || Array.isArray(promotionEvidence)) {
    throw new Error('Verified API catalog promotion evidence is required');
  }
  const evidence = {
    schemaEvidenceRef: normalizeEvidenceRef(
      promotionEvidence.schemaEvidenceRef ?? promotionEvidence.schemaRef,
      'schemaEvidenceRef',
    ),
    policyEvidenceRef: normalizeEvidenceRef(
      promotionEvidence.policyEvidenceRef ?? promotionEvidence.policyRef,
      'policyEvidenceRef',
    ),
    testEvidenceRefs: normalizeEvidenceRefs(
      promotionEvidence.testEvidenceRefs ?? promotionEvidence.testRefs,
      'testEvidenceRefs',
    ),
  };
  assertNoForbiddenPatterns(evidence);
  return evidence;
}

/** @param {Record<string, any>} options */
export function assertVerifiedApiCatalogPromotionEvidence({
  candidate,
  siteAdapterDecision,
  catalogUpgradePolicy,
  promotionEvidence,
} = {}) {
  const evidence = normalizePromotionEvidence(promotionEvidence);
  if (candidate?.status !== 'verified') {
    throw new Error(`Verified API catalog promotion requires verified candidate: ${candidate?.status ?? '<missing>'}`);
  }
  if (siteAdapterDecision?.decision !== 'accepted') {
    throw new Error(`Verified API catalog promotion requires accepted SiteAdapter decision: ${siteAdapterDecision?.decision ?? '<missing>'}`);
  }
  if (catalogUpgradePolicy?.allowCatalogUpgrade !== true) {
    throw new Error('Verified API catalog promotion requires policy allowCatalogUpgrade=true');
  }
  const gate = {
    schemaVersion: 1,
    gate: 'verified-api-catalog-promotion',
    candidateId: candidate.id,
    siteKey: candidate.siteKey,
    adapterId: siteAdapterDecision.adapterId,
    requirements: {
      candidateStatus: candidate.status,
      candidateVerified: true,
      siteAdapterDecision: siteAdapterDecision.decision,
      siteAdapterAccepted: true,
      policyAllowsCatalogUpgrade: true,
      schemaEvidence: 'present',
      policyEvidence: 'present',
      testEvidence: 'present',
      redactionAudit: 'required',
    },
    evidence,
    observedApiAutoPromotionAllowed: false,
    redactionRequired: true,
  };
  assertNoForbiddenPatterns(gate);
  return gate;
}

function addAuditSummary(summary, artifact) {
  if (!artifact) {
    return;
  }
  for (const key of [
    'redactionAuditPath',
    'verificationEventRedactionAuditPath',
    'lifecycleEventRedactionAuditPath',
  ]) {
    if (artifact[key]) {
      summary.auditPaths.push(artifact[key]);
    }
  }
  for (const key of [
    'redactionAudit',
    'verificationEventRedactionAudit',
    'lifecycleEventRedactionAudit',
  ]) {
    const audit = artifact[key];
    if (!audit) {
      continue;
    }
    summary.findingCount += Array.isArray(audit.findings) ? audit.findings.length : 0;
    summary.redactedPathCount += Array.isArray(audit.redactedPaths) ? audit.redactedPaths.length : 0;
  }
}

/** @param {Record<string, any>} [artifacts] */
function summarizePromotionRedactionAudits(artifacts = {}) {
  const summary = {
    auditPaths: [],
    findingCount: 0,
    redactedPathCount: 0,
  };
  addAuditSummary(summary, artifacts.upgradeDecision);
  addAuditSummary(summary, artifacts.catalogEntry);
  addAuditSummary(summary, artifacts.catalogCollection);
  addAuditSummary(summary, artifacts.catalogIndex);
  if (summary.auditPaths.length === 0) {
    throw new Error('Verified API catalog promotion redaction audit is required');
  }
  const redactionAudit = {
    auditPathCount: summary.auditPaths.length,
    findingCount: summary.findingCount,
    redactedPathCount: summary.redactedPathCount,
    auditPaths: summary.auditPaths,
  };
  assertNoForbiddenPatterns(redactionAudit);
  return redactionAudit;
}

/**
 * @param {Record<string, any>} candidate
 * @param {Record<string, any>} options
 */
function createVerificationResult(candidate, {
  verificationResult,
  verifierId,
  verifiedAt,
  responseFixture,
  authFixture,
  paginationFixture,
  riskFixture,
  metadata,
} = {}) {
  if (verificationResult) {
    return verificationResult;
  }
  return createApiCandidateMultiAspectVerificationResultFromFixtures({
    candidate,
    verifierId,
    verifiedAt,
    responseFixture,
    authFixture,
    paginationFixture,
    riskFixture,
    metadata,
  });
}

/** @param {Record<string, any>} options */
export async function writeVerifiedApiCatalogArtifactsFromObservedProducerEvidence({
  observedRequest,
  siteAdapterDecision,
  catalogUpgradePolicy,
  verification = {},
  promotionEvidence,
  metadata = {},
  decidedAt,
} = {}, paths = {}) {
  const observedCandidate = apiCandidateFromObservedRequest(observedRequest);
  assertNoForbiddenPatterns(observedCandidate);
  const normalizedDecision = normalizeSiteAdapterCandidateDecision(siteAdapterDecision, {
    candidate: observedCandidate,
  });
  const verificationResult = createVerificationResult(observedCandidate, verification);
  const verifiedEvidence = verifyApiCandidateForCatalog({
    candidate: observedCandidate,
    siteAdapterDecision: normalizedDecision,
    verificationResult,
  });
  const normalizedPolicy = normalizeSiteAdapterCatalogUpgradePolicy(catalogUpgradePolicy, {
    candidate: verifiedEvidence.candidate,
    siteAdapterDecision: verifiedEvidence.siteAdapterDecision,
  });
  const promotionGate = assertVerifiedApiCatalogPromotionEvidence({
    candidate: verifiedEvidence.candidate,
    siteAdapterDecision: verifiedEvidence.siteAdapterDecision,
    catalogUpgradePolicy: normalizedPolicy,
    promotionEvidence,
  });
  const artifacts = await writeRuntimeVerifiedApiCatalogStoreArtifacts({
    candidate: verifiedEvidence.candidate,
    siteAdapterDecision: verifiedEvidence.siteAdapterDecision,
    policy: normalizedPolicy,
    decidedAt,
    metadata: {
      verifiedAt: normalizeText(verificationResult.verifiedAt),
      ...metadata,
    },
  }, paths);
  const redactionAudit = summarizePromotionRedactionAudits(artifacts);
  return {
    observedCandidate,
    verifiedCandidate: verifiedEvidence.candidate,
    verification: verifiedEvidence.verification,
    siteAdapterDecision: verifiedEvidence.siteAdapterDecision,
    catalogUpgradePolicy: normalizedPolicy,
    promotionGate: {
      ...promotionGate,
      requirements: {
        ...promotionGate.requirements,
        redactionAudit: 'present',
      },
      redactionAudit,
    },
    artifacts,
    observedApiAutoPromotionAllowed: false,
    verifiedCatalogPromotionPath: 'site-adapter-policy-schema-test-gated',
    redactionRequired: true,
  };
}
