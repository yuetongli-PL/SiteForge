// @ts-check

import { copyFile, mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  API_CANDIDATE_SCHEMA_VERSION,
  API_CATALOG_ENTRY_SCHEMA_VERSION,
  assertApiCandidateCompatible,
  assertApiCatalogEntryCompatible,
  assertApiCatalogUpgradeDecisionAllowsCatalog,
  assertSiteAdapterCandidateDecisionCompatible,
  createApiCandidateResponseVerificationResult,
  createApiCandidateVerificationLifecycleEvent,
  createApiCatalogEntryFromCandidate,
  createApiCatalogUpgradeDecision,
  createApiCatalogVerificationLifecycleEvent,
  normalizeApiCandidate,
  normalizeSiteAdapterCandidateDecision,
  verifyApiCandidateForCatalog,
} from './api-candidates.mjs';
import {
  assertLifecycleEventCompatible,
  assertLifecycleEventObservabilityFields,
} from './lifecycle-events.mjs';
import {
  REASON_CODE_SCHEMA_VERSION,
  reasonCodeSummary,
  requireReasonCodeDefinition,
} from './reason-codes.mjs';
import {
  prepareRedactedArtifactJsonWithAudit,
  assertNoForbiddenPatterns,
} from './security-guard.mjs';
import {
  createTrustBoundaryCrossingRecord,
  assertTrustBoundaryCrossing,
} from './trust-boundary.mjs';
import {
  assertPlannerPolicyRuntimeHandoffCompatibility,
  createPlannerPolicyHandoff,
} from './planner-policy-handoff.mjs';

export const SITE_CAPABILITY_DATA_FLOW_EVIDENCE_SCHEMA_VERSION = 1;

const DEFAULT_OBSERVED_AT = '2026-05-03T00:00:00.000Z';
const DEFAULT_VERIFIED_AT = '2026-05-03T00:01:00.000Z';
const DEFAULT_LAST_VALIDATED_AT = '2026-05-03T00:02:00.000Z';
const DATA_FLOW_ARTIFACT_FILE_NAMES = Object.freeze({
  manifest: 'site-capability-data-flow-manifest.json',
  lifecycle: 'site-capability-data-flow-lifecycle.json',
  handoff: 'site-capability-data-flow-handoff.json',
  redactionAudit: 'site-capability-data-flow-redaction-audit.json',
});

function summarizeRedactionAudit(audit = {}) {
  return {
    redactedPathCount: Array.isArray(audit.redactedPaths) ? audit.redactedPaths.length : 0,
    findingCount: Array.isArray(audit.findings) ? audit.findings.length : 0,
  };
}

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

async function assertTargetIsNotDirectory(filePath, label) {
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      throw new Error(`${label} output path must not be a directory: ${filePath}`);
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

async function writePreparedArtifactSet(entries = [], label = 'DataFlowEvidence artifact writer') {
  for (const entry of entries) {
    await assertTargetIsNotDirectory(entry.filePath, label);
  }
  const tempEntries = entries.map((entry, index) => ({
    ...entry,
    tempPath: path.join(
      path.dirname(entry.filePath),
      `.${path.basename(entry.filePath)}.${process.pid}.${Date.now()}.${index}.tmp`,
    ),
    backupPath: path.join(
      path.dirname(entry.filePath),
      `.${path.basename(entry.filePath)}.${process.pid}.${Date.now()}.${index}.backup`,
    ),
    backupExists: false,
  }));
  const committedEntries = [];
  try {
    for (const entry of tempEntries) {
      try {
        await copyFile(entry.filePath, entry.backupPath);
        entry.backupExists = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      }
    }
    for (const entry of tempEntries) {
      await writeFile(entry.tempPath, `${entry.text}\n`, 'utf8');
    }
    for (const entry of tempEntries) {
      await rename(entry.tempPath, entry.filePath);
      committedEntries.push(entry);
    }
  } catch (error) {
    await Promise.allSettled(tempEntries.map((entry) => unlink(entry.tempPath)));
    await Promise.allSettled([...committedEntries].reverse().map(async (entry) => {
      if (entry.backupExists) {
        await copyFile(entry.backupPath, entry.filePath);
        return;
      }
      await unlink(entry.filePath).catch((unlinkError) => {
        if (unlinkError?.code !== 'ENOENT') {
          throw unlinkError;
        }
      });
    }));
    throw error;
  } finally {
    await Promise.allSettled(tempEntries.map((entry) => unlink(entry.backupPath)));
  }
}

function createDefaultCaptureFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    source: 'synthetic-redacted-capture-fixture',
    observedRequest: {
      method: 'GET',
      url: 'https://section6.example.invalid/api/items?access_token=synthetic-section6-token&cursor=1',
      headers: {
        authorization: 'Bearer synthetic-section6-token',
        accept: 'application/json',
      },
      body: {
        csrf: 'synthetic-section6-csrf',
        safe: true,
      },
    },
    ...overrides,
  };
}

function createCandidateFromRedactedCapture({
  captureEvidence,
  siteKey,
  candidateId,
  observedAt,
} = {}) {
  const observedRequest = captureEvidence?.observedRequest ?? {};
  return normalizeApiCandidate({
    schemaVersion: API_CANDIDATE_SCHEMA_VERSION,
    id: candidateId,
    siteKey,
    status: 'candidate',
    endpoint: {
      method: observedRequest.method ?? 'GET',
      url: observedRequest.url,
    },
    request: {
      headers: observedRequest.headers,
      body: observedRequest.body,
    },
    evidence: {
      source: 'redacted-capture-fixture',
      captureSchemaVersion: captureEvidence?.schemaVersion,
    },
    observedAt,
  });
}

function createReasonCodeEvidence(codes) {
  return {
    schemaVersion: REASON_CODE_SCHEMA_VERSION,
    summaries: codes.map((code) => reasonCodeSummary(code)),
  };
}

function assertReasonCodeEvidenceCompatible(reasonCodes = {}) {
  if (reasonCodes.schemaVersion !== REASON_CODE_SCHEMA_VERSION) {
    throw new Error(
      `DataFlowEvidence reasonCode schemaVersion ${reasonCodes.schemaVersion} is not compatible with ${REASON_CODE_SCHEMA_VERSION}`,
    );
  }
  if (!Array.isArray(reasonCodes.summaries) || !reasonCodes.summaries.length) {
    throw new Error('DataFlowEvidence reasonCode summaries are required');
  }
  for (const summary of reasonCodes.summaries) {
    requireReasonCodeDefinition(summary?.code);
  }
  return true;
}

export function createSiteCapabilityDataFlowEvidence({
  siteKey = 'section6-fixture',
  candidateId = 'section6-synthetic-capture-items',
  adapterId = 'section6-synthetic-adapter',
  adapterVersion = 'section6-adapter-v1',
  taskType = 'archive-items',
  traceId = 'trace-section6-data-flow',
  correlationId = 'corr-section6-data-flow',
  captureFixture,
  observedAt = DEFAULT_OBSERVED_AT,
  verifiedAt = DEFAULT_VERIFIED_AT,
  lastValidatedAt = DEFAULT_LAST_VALIDATED_AT,
} = {}) {
  const normalizedSiteKey = normalizeText(siteKey);
  if (!normalizedSiteKey) {
    throw new Error('DataFlowEvidence siteKey is required');
  }
  const normalizedCandidateId = normalizeText(candidateId);
  if (!normalizedCandidateId) {
    throw new Error('DataFlowEvidence candidateId is required');
  }

  const capturePrepared = prepareRedactedArtifactJsonWithAudit(
    createDefaultCaptureFixture(captureFixture),
  );
  const apiCandidate = createCandidateFromRedactedCapture({
    captureEvidence: capturePrepared.value,
    siteKey: normalizedSiteKey,
    candidateId: normalizedCandidateId,
    observedAt,
  });
  assertApiCandidateCompatible(apiCandidate);

  const siteAdapterDecision = normalizeSiteAdapterCandidateDecision({
    candidateId: apiCandidate.id,
    siteKey: apiCandidate.siteKey,
    adapterId,
    adapterVersion,
    decision: 'accepted',
    validatedAt: verifiedAt,
    evidence: {
      source: 'synthetic-redacted-fixture',
      captureSchemaVersion: capturePrepared.value.schemaVersion,
    },
  }, {
    candidate: apiCandidate,
  });
  assertSiteAdapterCandidateDecisionCompatible(siteAdapterDecision);

  const verificationResult = createApiCandidateResponseVerificationResult({
    candidate: apiCandidate,
    responseEvidence: {
      responseSchemaHash: 'sha256-section6-synthetic-response-schema',
      statusCode: 200,
    },
    verifierId: 'section6-synthetic-verifier',
    verifiedAt,
    status: 'passed',
  });
  const verifiedEvidence = verifyApiCandidateForCatalog({
    candidate: apiCandidate,
    siteAdapterDecision,
    verificationResult,
  });
  const catalogEntry = createApiCatalogEntryFromCandidate(verifiedEvidence.candidate, {
    version: 'section6-api-v1',
    verifiedAt,
    lastValidatedAt,
    status: 'cataloged',
    invalidationStatus: 'active',
    auth: {
      required: false,
      scheme: 'none',
    },
    pagination: {
      type: 'cursor',
      cursorField: 'nextCursor',
      pageSize: 20,
    },
    risk: {
      level: 'low',
    },
    fieldMapping: {
      items: '$.data.items',
    },
  });
  assertApiCatalogEntryCompatible(catalogEntry);

  const candidateLifecycleEvent = createApiCandidateVerificationLifecycleEvent(verifiedEvidence, {
    createdAt: verifiedAt,
    traceId,
    correlationId,
    taskType,
    adapterVersion,
  });
  const catalogLifecycleEvent = createApiCatalogVerificationLifecycleEvent(verifiedEvidence.candidate, {
    metadata: {
      taskType,
      adapterVersion,
      version: catalogEntry.version,
      verifiedAt,
      lastValidatedAt,
      status: catalogEntry.status,
      invalidationStatus: catalogEntry.invalidationStatus,
      auth: catalogEntry.auth,
      pagination: catalogEntry.pagination,
      risk: catalogEntry.risk,
      fieldMapping: catalogEntry.fieldMapping,
    },
    createdAt: lastValidatedAt,
    traceId,
    correlationId,
  });

  const candidateToCatalogBoundary = createTrustBoundaryCrossingRecord({
    from: 'api-candidates',
    to: 'api-catalog',
    purpose: 'Section 6 synthetic verified candidate to catalog evidence',
    controls: ['redacted', 'minimized', 'permission-checked'],
    payload: {
      candidate: verifiedEvidence.candidate,
      catalogEntry,
    },
  });
  const catalogUpgradeDecision = createApiCatalogUpgradeDecision({
    candidate: verifiedEvidence.candidate,
    siteAdapterDecision,
    policy: {
      allowCatalogUpgrade: true,
      decidedAt: verifiedAt,
      evidence: {
        source: 'synthetic-section6-policy-fixture',
      },
    },
    decidedAt: verifiedAt,
  });
  const handoff = createPlannerPolicyHandoff({
    catalogEntry,
    catalogUpgradeDecision,
    taskIntent: {
      siteKey: normalizedSiteKey,
      taskType,
      id: `${normalizedCandidateId}:download-task`,
      kind: 'request',
      cacheKey: `${normalizedSiteKey}:${taskType}:items`,
      dedupKey: `${normalizedSiteKey}:${taskType}:items`,
    },
    policy: {
      dryRun: true,
      allowNetworkResolve: false,
      retries: 1,
      retryBackoffMs: 250,
      cache: true,
      dedup: true,
    },
  });
  const catalogToDownloaderBoundary = createTrustBoundaryCrossingRecord({
    from: 'api-catalog',
    to: 'downloader',
    purpose: 'Section 6 synthetic planner policy handoff',
    controls: ['redacted', 'minimized', 'permission-checked'],
    payload: handoff,
  });

  const evidence = {
    schemaVersion: SITE_CAPABILITY_DATA_FLOW_EVIDENCE_SCHEMA_VERSION,
    flowId: `${normalizedSiteKey}:${normalizedCandidateId}`,
    siteKey: normalizedSiteKey,
    taskType,
    redactedCaptureEvidence: capturePrepared.value,
    apiCandidate,
    siteAdapterDecision,
    verificationResult,
    verifiedApiCandidate: verifiedEvidence.candidate,
    catalogEntry,
    catalogUpgradeDecision,
    handoff,
    lifecycle: {
      candidateVerified: candidateLifecycleEvent,
      catalogVerified: catalogLifecycleEvent,
    },
    trustBoundaries: [
      candidateToCatalogBoundary,
      catalogToDownloaderBoundary,
    ],
    reasonCodes: createReasonCodeEvidence([
      'api-verification-failed',
      'schema-version-incompatible',
      'redaction-failed',
      'download-policy-generation-failed',
    ]),
    redactionEvidence: {
      capture: summarizeRedactionAudit(capturePrepared.auditValue),
    },
  };
  const flowPrepared = prepareRedactedArtifactJsonWithAudit(evidence);
  const redactedEvidence = {
    ...flowPrepared.value,
    redactionEvidence: {
      ...flowPrepared.value.redactionEvidence,
      flow: summarizeRedactionAudit(flowPrepared.auditValue),
    },
  };
  assertSiteCapabilityDataFlowEvidenceCompatible(redactedEvidence);
  assertNoForbiddenPatterns(redactedEvidence);
  return redactedEvidence;
}

export async function writeSiteCapabilityDataFlowEvidenceArtifacts({
  evidence,
  ...evidenceOptions
} = {}, {
  outputDir,
} = {}) {
  const outputRoot = normalizeText(outputDir);
  if (!outputRoot) {
    throw new Error('DataFlowEvidence artifact outputDir is required');
  }

  const redactedEvidence = evidence ?? createSiteCapabilityDataFlowEvidence(evidenceOptions);
  assertSiteCapabilityDataFlowEvidenceCompatible(redactedEvidence);
  assertNoForbiddenPatterns(redactedEvidence);

  const lifecycleEvidence = {
    schemaVersion: SITE_CAPABILITY_DATA_FLOW_EVIDENCE_SCHEMA_VERSION,
    evidenceType: 'site-capability-data-flow-lifecycle',
    flowId: redactedEvidence.flowId,
    siteKey: redactedEvidence.siteKey,
    taskType: redactedEvidence.taskType,
    lifecycle: redactedEvidence.lifecycle,
  };
  assertLifecycleEventCompatible(lifecycleEvidence.lifecycle?.candidateVerified);
  assertLifecycleEventCompatible(lifecycleEvidence.lifecycle?.catalogVerified);

  const handoffEvidence = {
    schemaVersion: SITE_CAPABILITY_DATA_FLOW_EVIDENCE_SCHEMA_VERSION,
    evidenceType: 'site-capability-data-flow-handoff',
    flowId: redactedEvidence.flowId,
    siteKey: redactedEvidence.siteKey,
    taskType: redactedEvidence.taskType,
    handoff: redactedEvidence.handoff,
    trustBoundary: redactedEvidence.trustBoundaries?.[1],
    reasonCodes: redactedEvidence.reasonCodes,
  };
  assertPlannerPolicyRuntimeHandoffCompatibility(handoffEvidence.handoff);
  assertTrustBoundaryCrossing(handoffEvidence.trustBoundary);
  assertReasonCodeEvidenceCompatible(handoffEvidence.reasonCodes);

  const manifestPrepared = prepareRedactedArtifactJsonWithAudit(redactedEvidence);
  const lifecyclePrepared = prepareRedactedArtifactJsonWithAudit(lifecycleEvidence);
  const handoffPrepared = prepareRedactedArtifactJsonWithAudit(handoffEvidence);
  const auditSidecar = {
    schemaVersion: SITE_CAPABILITY_DATA_FLOW_EVIDENCE_SCHEMA_VERSION,
    evidenceType: 'site-capability-data-flow-redaction-audit',
    flowId: redactedEvidence.flowId,
    siteKey: redactedEvidence.siteKey,
    taskType: redactedEvidence.taskType,
    artifacts: {
      manifest: {
        fileName: DATA_FLOW_ARTIFACT_FILE_NAMES.manifest,
        redactionSummary: summarizeRedactionAudit(manifestPrepared.auditValue),
      },
      lifecycle: {
        fileName: DATA_FLOW_ARTIFACT_FILE_NAMES.lifecycle,
        redactionSummary: summarizeRedactionAudit(lifecyclePrepared.auditValue),
      },
      handoff: {
        fileName: DATA_FLOW_ARTIFACT_FILE_NAMES.handoff,
        redactionSummary: summarizeRedactionAudit(handoffPrepared.auditValue),
      },
    },
    redactionAudits: {
      manifest: manifestPrepared.auditValue,
      lifecycle: lifecyclePrepared.auditValue,
      handoff: handoffPrepared.auditValue,
    },
  };
  const auditPrepared = prepareRedactedArtifactJsonWithAudit(auditSidecar);
  assertNoForbiddenPatterns(auditPrepared.value);

  const artifactPaths = {
    manifest: path.join(outputRoot, DATA_FLOW_ARTIFACT_FILE_NAMES.manifest),
    lifecycle: path.join(outputRoot, DATA_FLOW_ARTIFACT_FILE_NAMES.lifecycle),
    handoff: path.join(outputRoot, DATA_FLOW_ARTIFACT_FILE_NAMES.handoff),
    redactionAudit: path.join(outputRoot, DATA_FLOW_ARTIFACT_FILE_NAMES.redactionAudit),
  };
  await mkdir(outputRoot, { recursive: true });
  await writePreparedArtifactSet([
    { filePath: artifactPaths.manifest, text: manifestPrepared.json },
    { filePath: artifactPaths.lifecycle, text: lifecyclePrepared.json },
    { filePath: artifactPaths.handoff, text: handoffPrepared.json },
    { filePath: artifactPaths.redactionAudit, text: auditPrepared.json },
  ]);

  return {
    evidence: manifestPrepared.value,
    lifecycleEvidence: lifecyclePrepared.value,
    handoffEvidence: handoffPrepared.value,
    redactionAudit: auditPrepared.value,
    artifacts: artifactPaths,
    redactionSummary: {
      manifest: summarizeRedactionAudit(manifestPrepared.auditValue),
      lifecycle: summarizeRedactionAudit(lifecyclePrepared.auditValue),
      handoff: summarizeRedactionAudit(handoffPrepared.auditValue),
    },
  };
}

export function assertSiteCapabilityDataFlowEvidenceCompatible(evidence = {}) {
  if (evidence.schemaVersion !== SITE_CAPABILITY_DATA_FLOW_EVIDENCE_SCHEMA_VERSION) {
    throw new Error(
      `DataFlowEvidence schemaVersion ${evidence.schemaVersion} is not compatible with ${SITE_CAPABILITY_DATA_FLOW_EVIDENCE_SCHEMA_VERSION}`,
    );
  }
  assertApiCandidateCompatible(evidence.apiCandidate);
  assertApiCandidateCompatible(evidence.verifiedApiCandidate);
  assertSiteAdapterCandidateDecisionCompatible(evidence.siteAdapterDecision);
  assertApiCatalogEntryCompatible(evidence.catalogEntry);
  assertApiCatalogUpgradeDecisionAllowsCatalog(evidence.catalogUpgradeDecision);
  assertPlannerPolicyRuntimeHandoffCompatibility(evidence.handoff);
  assertLifecycleEventCompatible(evidence.lifecycle?.candidateVerified);
  assertLifecycleEventCompatible(evidence.lifecycle?.catalogVerified);
  assertLifecycleEventObservabilityFields(evidence.lifecycle?.candidateVerified, {
    requiredFields: ['traceId', 'correlationId', 'taskId', 'siteKey', 'taskType', 'adapterVersion'],
    requiredDetailFields: ['candidateId', 'candidateStatus', 'adapterId', 'verifierId', 'verifiedAt'],
  });
  assertLifecycleEventObservabilityFields(evidence.lifecycle?.catalogVerified, {
    requiredFields: ['traceId', 'correlationId', 'taskId', 'siteKey', 'taskType', 'adapterVersion'],
    requiredDetailFields: [
      'candidateId',
      'catalogVersion',
      'catalogStatus',
      'invalidationStatus',
      'verifiedAt',
      'lastValidatedAt',
      'catalogEntry',
    ],
  });
  if (!Array.isArray(evidence.trustBoundaries) || evidence.trustBoundaries.length !== 2) {
    throw new Error('DataFlowEvidence requires exactly two trust boundary records');
  }
  assertTrustBoundaryCrossing(evidence.trustBoundaries[0]);
  assertTrustBoundaryCrossing(evidence.trustBoundaries[1]);
  assertReasonCodeEvidenceCompatible(evidence.reasonCodes);
  assertNoForbiddenPatterns(evidence);
  if (evidence.catalogEntry?.schemaVersion !== API_CATALOG_ENTRY_SCHEMA_VERSION) {
    throw new Error('DataFlowEvidence catalogEntry schemaVersion mismatch');
  }
  if (evidence.apiCandidate?.schemaVersion !== API_CANDIDATE_SCHEMA_VERSION) {
    throw new Error('DataFlowEvidence apiCandidate schemaVersion mismatch');
  }
  return true;
}
