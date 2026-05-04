// @ts-check

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  API_CANDIDATE_SCHEMA_VERSION,
  assertSiteAdapterCandidateDecisionCompatible,
  createApiCandidateMultiAspectVerificationResultFromFixtures,
  normalizeSiteAdapterCandidateDecision,
  verifyApiCandidateForCatalog,
  writeApiCatalogUpgradeDecisionArtifact,
  writeApiCandidateArtifact,
  writeApiCandidateVerificationEvidenceArtifact,
} from './api-candidates.mjs';
import { reasonCodeSummary, requireReasonCodeDefinition } from './reason-codes.mjs';
import { prepareRedactedArtifactJsonWithAudit } from './security-guard.mjs';

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function candidateArtifactName(index) {
  return `candidate-${String(index + 1).padStart(4, '0')}.json`;
}

function decisionArtifactName(index) {
  return `decision-${String(index + 1).padStart(4, '0')}.json`;
}

function upgradeDecisionArtifactName(index) {
  return `upgrade-decision-${String(index + 1).padStart(4, '0')}.json`;
}

function upgradeDecisionLifecycleEventArtifactName(index) {
  return `upgrade-decision-lifecycle-event-${String(index + 1).padStart(4, '0')}.json`;
}

function verificationEvidenceArtifactName(index) {
  return `verification-evidence-${String(index + 1).padStart(4, '0')}.json`;
}

function verificationLifecycleEventArtifactName(index) {
  return `verification-lifecycle-event-${String(index + 1).padStart(4, '0')}.json`;
}

function requestsFromCaptureOutput(captureOutput = {}) {
  if (Array.isArray(captureOutput)) {
    return captureOutput;
  }
  const requests = captureOutput.requests ?? captureOutput.networkRequests;
  if (!Array.isArray(requests)) {
    throw new Error('Capture output requests must be an array');
  }
  return requests;
}

export function createApiDiscoveryFailure(reasonCode, message, {
  stage = 'api-discovery',
  cause,
  metadata = {},
} = {}) {
  const recovery = reasonCodeSummary(reasonCode);
  requireReasonCodeDefinition(reasonCode, { family: 'api' });
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = 'ApiDiscoveryFailure';
  error.code = recovery.code;
  error.reasonCode = recovery.code;
  error.reasonRecovery = recovery;
  error.retryable = recovery.retryable;
  error.manualRecoveryNeeded = recovery.manualRecoveryNeeded;
  error.artifactWriteAllowed = recovery.artifactWriteAllowed;
  error.recovery = {
    ...recovery,
    stage,
  };
  error.metadata = {
    stage,
    ...metadata,
  };
  return error;
}

export function apiCandidateFromObservedRequest(raw = {}) {
  const siteKey = normalizeText(raw.siteKey);
  if (!siteKey) {
    throw new Error('Observed request siteKey is required');
  }
  const url = normalizeText(raw.url ?? raw.endpoint?.url);
  if (!url) {
    throw new Error('Observed request url is required');
  }
  const status = normalizeText(raw.status);
  if (status && status !== 'observed') {
    throw new Error('ApiDiscovery observed request status must be observed');
  }

  return {
    schemaVersion: API_CANDIDATE_SCHEMA_VERSION,
    id: normalizeText(raw.id),
    siteKey,
    status: 'observed',
    endpoint: {
      method: normalizeText(raw.method ?? raw.endpoint?.method) ?? 'GET',
      url,
    },
    source: normalizeText(raw.source) ?? 'observed-request',
    observedAt: normalizeText(raw.observedAt),
    evidence: raw.evidence,
    request: {
      headers: raw.headers ?? raw.request?.headers ?? {},
      body: raw.body ?? raw.request?.body,
    },
  };
}

export async function writeApiCandidateArtifactsFromObservedRequests(requests = [], {
  outputDir,
  redactionAuditDir,
} = {}) {
  if (!Array.isArray(requests)) {
    throw new Error('Observed requests must be an array');
  }
  const candidateDir = normalizeText(outputDir);
  if (!candidateDir) {
    throw new Error('ApiDiscovery outputDir is required');
  }
  const auditDir = normalizeText(redactionAuditDir);
  const candidates = requests.map((request) => apiCandidateFromObservedRequest(request));
  if (candidates.length === 0) {
    throw createApiDiscoveryFailure(
      'api-candidate-generation-failed',
      'ApiDiscovery did not generate any candidates from observed requests',
      {
        stage: 'candidate-generation',
        metadata: {
          requestCount: 0,
        },
      },
    );
  }
  if (!auditDir) {
    throw new Error('ApiDiscovery redactionAuditDir is required');
  }

  const artifacts = [];
  for (const [index, candidate] of candidates.entries()) {
    const artifactName = candidateArtifactName(index);
    const result = await writeApiCandidateArtifact(candidate, {
      candidatePath: path.join(candidateDir, artifactName),
      redactionAuditPath: path.join(auditDir, artifactName.replace(/\.json$/u, '.redaction-audit.json')),
    });
    artifacts.push({
      index,
      ...result,
    });
  }
  return artifacts;
}

export async function writeApiCandidateArtifactsFromCaptureOutput(captureOutput = {}, options = {}) {
  return writeApiCandidateArtifactsFromObservedRequests(requestsFromCaptureOutput(captureOutput), options);
}

function assertManualVerificationResultIsMultiAspect(verificationResult) {
  const evidenceType = normalizeText(verificationResult?.metadata?.evidenceType);
  if (evidenceType !== 'multi-aspect') {
    throw new Error('Manual ApiCandidate verification requires multi-aspect verification result');
  }
}

function materializeManualVerificationResult(record = {}) {
  if (record?.verificationResult) {
    return record.verificationResult;
  }
  const fixtures = record?.verificationFixtures;
  if (!fixtures) {
    return undefined;
  }
  return createApiCandidateMultiAspectVerificationResultFromFixtures({
    candidate: record?.candidate,
    verifierId: fixtures.verifierId,
    verifiedAt: fixtures.verifiedAt,
    responseFixture: fixtures.responseFixture,
    authFixture: fixtures.authFixture,
    paginationFixture: fixtures.paginationFixture,
    riskFixture: fixtures.riskFixture,
    metadata: fixtures.metadata,
  });
}

export async function writeManualApiCandidateVerificationArtifacts(records = [], {
  outputDir,
  redactionAuditDir,
  lifecycleEventOutputDir,
  lifecycleEventRedactionAuditDir,
  lifecycleEventTraceId,
  lifecycleEventCorrelationId,
  lifecycleEventTaskType,
  lifecycleEventAdapterVersion,
} = {}) {
  if (!Array.isArray(records)) {
    throw new Error('Manual ApiCandidate verification records must be an array');
  }
  const verificationDir = normalizeText(outputDir);
  if (!verificationDir) {
    throw new Error('Manual ApiCandidate verification outputDir is required');
  }
  const auditDir = normalizeText(redactionAuditDir);
  if (!auditDir) {
    throw new Error('Manual ApiCandidate verification redactionAuditDir is required');
  }
  const eventDir = normalizeText(lifecycleEventOutputDir);
  const eventAuditDir = normalizeText(lifecycleEventRedactionAuditDir);
  const shouldWriteLifecycleEvents = Boolean(eventDir || eventAuditDir);
  if (shouldWriteLifecycleEvents && (!eventDir || !eventAuditDir)) {
    throw new Error('Manual ApiCandidate verification lifecycle event and redaction audit dirs must be provided together');
  }

  const verifiedRecords = records.map((record) => {
    const verificationResult = materializeManualVerificationResult(record);
    const evidence = verifyApiCandidateForCatalog({
      candidate: record?.candidate,
      siteAdapterDecision: record?.siteAdapterDecision,
      verificationResult,
    });
    assertManualVerificationResultIsMultiAspect(verificationResult);
    return {
      candidate: record?.candidate,
      siteAdapterDecision: record?.siteAdapterDecision,
      verificationResult,
      evidence,
    };
  });

  const artifacts = [];
  for (const [index, record] of verifiedRecords.entries()) {
    const artifactName = verificationEvidenceArtifactName(index);
    const lifecycleArtifactName = verificationLifecycleEventArtifactName(index);
    const result = await writeApiCandidateVerificationEvidenceArtifact({
      candidate: record.candidate,
      siteAdapterDecision: record.siteAdapterDecision,
      verificationResult: record.verificationResult,
    }, {
      evidencePath: path.join(verificationDir, artifactName),
      redactionAuditPath: path.join(
        auditDir,
        artifactName.replace(/\.json$/u, '.redaction-audit.json'),
      ),
      ...(shouldWriteLifecycleEvents ? {
        lifecycleEventPath: path.join(eventDir, lifecycleArtifactName),
        lifecycleEventRedactionAuditPath: path.join(
          eventAuditDir,
          lifecycleArtifactName.replace(/\.json$/u, '.redaction-audit.json'),
        ),
        lifecycleEventTraceId,
        lifecycleEventCorrelationId,
        lifecycleEventTaskType,
        lifecycleEventAdapterVersion,
      } : {}),
    });
    artifacts.push({
      index,
      ...result,
    });
  }
  return artifacts;
}

export function validateApiCandidateWithAdapter(candidate = {}, adapter = {}, {
  evidence = {},
  scope = {},
  validatedAt,
} = {}) {
  if (typeof adapter.validateApiCandidate !== 'function') {
    throw new Error('SiteAdapter validateApiCandidate is required');
  }
  return normalizeSiteAdapterCandidateDecision(adapter.validateApiCandidate({
    candidate,
    evidence,
    scope,
    validatedAt,
  }), {
    candidate,
  });
}

export async function writeSiteAdapterCandidateDecisionArtifacts(candidateResults = [], {
  outputDir,
  redactionAuditDir,
  resolveAdapter,
  validatedAt,
  decidedAt,
  validationMode = 'capture-observed-candidate',
  evidenceSource = 'api-candidate-artifact',
  catalogUpgradeDecisionOutputDir,
  catalogUpgradeDecisionRedactionAuditDir,
  catalogUpgradeDecisionLifecycleEventOutputDir,
  catalogUpgradeDecisionLifecycleEventRedactionAuditDir,
  lifecycleEventTraceId,
  lifecycleEventCorrelationId,
  lifecycleEventTaskType,
  lifecycleEventAdapterVersion,
} = {}) {
  if (!Array.isArray(candidateResults)) {
    throw new Error('ApiCandidate results must be an array');
  }
  const decisionDir = normalizeText(outputDir);
  if (!decisionDir) {
    throw new Error('SiteAdapter decision outputDir is required');
  }
  const auditDir = normalizeText(redactionAuditDir);
  if (!auditDir) {
    throw new Error('SiteAdapter decision redactionAuditDir is required');
  }
  if (typeof resolveAdapter !== 'function') {
    throw new Error('SiteAdapter decision resolveAdapter is required');
  }
  const upgradeDecisionDir = normalizeText(catalogUpgradeDecisionOutputDir);
  const upgradeDecisionAuditDir = normalizeText(catalogUpgradeDecisionRedactionAuditDir);
  const shouldWriteUpgradeDecisions = Boolean(upgradeDecisionDir || upgradeDecisionAuditDir);
  if (shouldWriteUpgradeDecisions && (!upgradeDecisionDir || !upgradeDecisionAuditDir)) {
    throw new Error('SiteAdapter catalog upgrade decision output and redaction audit dirs must be provided together');
  }
  const upgradeDecisionEventDir = normalizeText(catalogUpgradeDecisionLifecycleEventOutputDir);
  const upgradeDecisionEventAuditDir = normalizeText(catalogUpgradeDecisionLifecycleEventRedactionAuditDir);
  const shouldWriteUpgradeDecisionEvents = Boolean(upgradeDecisionEventDir || upgradeDecisionEventAuditDir);
  if (shouldWriteUpgradeDecisionEvents && (!upgradeDecisionEventDir || !upgradeDecisionEventAuditDir)) {
    throw new Error('SiteAdapter catalog upgrade decision lifecycle event and redaction audit dirs must be provided together');
  }
  if (shouldWriteUpgradeDecisionEvents && !shouldWriteUpgradeDecisions) {
    throw new Error('SiteAdapter catalog upgrade decision lifecycle events require upgrade decision output dirs');
  }

  const decisionRecords = [];
  for (const [index, result] of candidateResults.entries()) {
    const candidate = result?.candidate;
    const adapter = resolveAdapter({
      candidate,
      host: candidate?.siteKey,
      inputUrl: candidate?.endpoint?.url,
    });
    if (typeof adapter?.validateApiCandidate !== 'function') {
      throw createApiDiscoveryFailure(
        'site-adapter-core-api-unidentified',
        `SiteAdapter could not identify a core API validation path for ${candidate?.siteKey ?? 'unknown-site'}`,
        {
          stage: 'site-adapter-validation',
          metadata: {
            candidateId: normalizeText(candidate?.id),
            siteKey: normalizeText(candidate?.siteKey),
          },
        },
      );
    }

    const artifactName = decisionArtifactName(index);
    const decisionPath = path.join(decisionDir, artifactName);
    const redactionAuditPath = path.join(
      auditDir,
      artifactName.replace(/\.json$/u, '.redaction-audit.json'),
    );
    const decision = validateApiCandidateWithAdapter(candidate, adapter, {
      validatedAt,
      scope: {
        validationMode,
        candidateArtifact: result?.artifactPath,
      },
      evidence: {
        source: evidenceSource,
        artifactPath: result?.artifactPath,
      },
    });
    assertSiteAdapterCandidateDecisionCompatible(decision);
    const prepared = prepareRedactedArtifactJsonWithAudit(decision);
    assertSiteAdapterCandidateDecisionCompatible(prepared.value);
    let catalogUpgradePolicy;
    let upgradeArtifactName;
    if (shouldWriteUpgradeDecisions && typeof adapter.getApiCatalogUpgradePolicy === 'function') {
      upgradeArtifactName = upgradeDecisionArtifactName(index);
      catalogUpgradePolicy = adapter.getApiCatalogUpgradePolicy({
        candidate,
        siteAdapterDecision: prepared.value,
        decidedAt: decidedAt ?? validatedAt,
        scope: {
          validationMode,
          candidateArtifact: result?.artifactPath,
          siteAdapterDecisionArtifact: decisionPath,
        },
        evidence: {
          source: evidenceSource,
          candidateArtifact: result?.artifactPath,
          siteAdapterDecisionArtifact: decisionPath,
        },
      });
    }
    decisionRecords.push({
      index,
      candidate,
      decision,
      prepared,
      decisionPath,
      redactionAuditPath,
      catalogUpgradePolicy,
      upgradeArtifactName,
    });
  }

  const decisions = [];
  for (const record of decisionRecords) {
    await mkdir(path.dirname(record.decisionPath), { recursive: true });
    await mkdir(path.dirname(record.redactionAuditPath), { recursive: true });
    await writeFile(record.decisionPath, `${record.prepared.json}\n`, 'utf8');
    await writeFile(record.redactionAuditPath, `${record.prepared.auditJson}\n`, 'utf8');
    let catalogUpgradeDecision;
    if (record.catalogUpgradePolicy) {
      catalogUpgradeDecision = await writeApiCatalogUpgradeDecisionArtifact({
        candidate: record.candidate,
        siteAdapterDecision: record.prepared.value,
        policy: record.catalogUpgradePolicy,
        decidedAt: decidedAt ?? validatedAt,
      }, {
        decisionPath: path.join(upgradeDecisionDir, record.upgradeArtifactName),
        redactionAuditPath: path.join(
          upgradeDecisionAuditDir,
          record.upgradeArtifactName.replace(/\.json$/u, '.redaction-audit.json'),
        ),
        ...(shouldWriteUpgradeDecisionEvents ? {
          lifecycleEventPath: path.join(
            upgradeDecisionEventDir,
            upgradeDecisionLifecycleEventArtifactName(record.index),
          ),
          lifecycleEventRedactionAuditPath: path.join(
            upgradeDecisionEventAuditDir,
            upgradeDecisionLifecycleEventArtifactName(record.index).replace(/\.json$/u, '.redaction-audit.json'),
          ),
          lifecycleEventCreatedAt: decidedAt ?? validatedAt,
          lifecycleEventTraceId,
          lifecycleEventCorrelationId,
          lifecycleEventTaskType,
          lifecycleEventAdapterVersion,
        } : {}),
      });
    }
    decisions.push({
      index: record.index,
      candidate: record.candidate,
      decision: record.decision,
      artifactPath: record.decisionPath,
      redactionAuditPath: record.redactionAuditPath,
      ...(catalogUpgradeDecision ? {
        catalogUpgradeDecision: catalogUpgradeDecision.decision,
        catalogUpgradeDecisionArtifactPath: catalogUpgradeDecision.artifactPath,
        catalogUpgradeDecisionRedactionAuditPath: catalogUpgradeDecision.redactionAuditPath,
        catalogUpgradeDecisionLifecycleEvent: catalogUpgradeDecision.lifecycleEvent,
        catalogUpgradeDecisionLifecycleEventPath: catalogUpgradeDecision.lifecycleEventPath,
        catalogUpgradeDecisionLifecycleEventRedactionAuditPath:
          catalogUpgradeDecision.lifecycleEventRedactionAuditPath,
      } : {}),
    });
  }

  return decisions;
}
