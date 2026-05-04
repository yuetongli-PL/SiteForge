import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  API_CANDIDATE_SCHEMA_VERSION,
  createApiCandidateMultiAspectVerificationResultFromFixtures,
  createApiCandidateResponseVerificationResult,
  normalizeSiteAdapterCandidateDecision,
  writeRuntimeVerifiedApiCatalogStoreArtifacts,
  writeApiCatalogEntryArtifact,
} from '../../src/sites/capability/api-candidates.mjs';
import {
  apiCandidateFromObservedRequest,
  validateApiCandidateWithAdapter,
  writeApiCandidateArtifactsFromCaptureOutput,
  writeApiCandidateArtifactsFromObservedRequests,
  writeManualApiCandidateVerificationArtifacts,
  writeSiteAdapterCandidateDecisionArtifacts,
} from '../../src/sites/capability/api-discovery.mjs';
import { REDACTION_PLACEHOLDER } from '../../src/sites/capability/security-guard.mjs';
import { reasonCodeSummary } from '../../src/sites/capability/reason-codes.mjs';
import { genericNavigationAdapter } from '../../src/sites/core/adapters/generic-navigation.mjs';
import { assertSchemaCompatible } from '../../src/sites/capability/compatibility-registry.mjs';

async function assertMissingFiles(filePaths) {
  for (const filePath of filePaths) {
    await assert.rejects(access(filePath), /ENOENT/u);
  }
}

function createSyntheticMultiAspectVerificationFixtures({
  verifierId = 'synthetic-manual-multi-aspect-verifier',
  verifiedAt = '2026-05-02T02:15:00.000Z',
} = {}) {
  return {
    verifierId,
    verifiedAt,
    responseFixture: {
      statusCode: 200,
      body: {
        items: [
          {
            id: 'synthetic-manual-response-item-id',
            title: 'Synthetic manual response title',
          },
        ],
        paging: {
          cursor: 'synthetic-manual-response-cursor',
          hasMore: false,
        },
      },
    },
    authFixture: {
      authRequirement: 'session-view',
      requestProtectionRequirement: 'checked-redacted-request-protection',
    },
    paginationFixture: {
      paginationModel: 'cursor',
      pageSize: 20,
      stopCondition: 'empty-page',
    },
    riskFixture: {
      state: 'normal',
      level: 'low',
      signalType: 'none',
      action: 'continue',
    },
  };
}

function createSyntheticMultiAspectVerificationResult(candidate, {
  verifierId = 'synthetic-manual-multi-aspect-verifier',
  verifiedAt = '2026-05-02T02:15:00.000Z',
} = {}) {
  return createApiCandidateMultiAspectVerificationResultFromFixtures({
    candidate,
    ...createSyntheticMultiAspectVerificationFixtures({ verifierId, verifiedAt }),
  });
}

test('ApiDiscovery maps observed requests to versioned candidates without catalog promotion', () => {
  const candidate = apiCandidateFromObservedRequest({
    siteKey: 'example',
    method: 'post',
    url: 'https://example.invalid/api/items?access_token=synthetic-api-token&safe=1',
    headers: {
      authorization: 'Bearer synthetic-api-token',
    },
    body: {
      csrf: 'synthetic-csrf-token',
      safe: true,
    },
    source: 'synthetic-observed-request',
  });

  assert.equal(candidate.schemaVersion, API_CANDIDATE_SCHEMA_VERSION);
  assert.equal(candidate.siteKey, 'example');
  assert.equal(candidate.status, 'observed');
  assert.equal(candidate.endpoint.method, 'post');
  assert.equal(candidate.endpoint.url.includes('synthetic-api-token'), true);
  assert.equal(Object.hasOwn(candidate, 'candidateId'), false);
  assert.equal(Object.hasOwn(candidate, 'version'), false);
});

test('ApiDiscovery writes redacted candidate artifacts and does not create catalog artifacts', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-discovery-'));
  try {
    const candidatesDir = path.join(runDir, 'api-candidates');
    const auditsDir = path.join(runDir, 'redaction-audits');
    const catalogPath = path.join(runDir, 'api-catalog', 'candidate-0001.json');

    const results = await writeApiCandidateArtifactsFromObservedRequests([
      {
        siteKey: 'example',
        method: 'GET',
        url: 'https://example.invalid/api/items?access_token=synthetic-api-token&safe=1',
        headers: {
          authorization: 'Bearer synthetic-api-token',
          cookie: 'SESSDATA=synthetic-sessdata',
          accept: 'application/json',
        },
        body: {
          csrf: 'synthetic-csrf-token',
          safe: true,
        },
        observedAt: '2026-04-30T00:00:00.000Z',
      },
    ], {
      outputDir: candidatesDir,
      redactionAuditDir: auditsDir,
    });

    assert.equal(results.length, 1);
    const artifactText = await readFile(results[0].artifactPath, 'utf8');
    const auditText = await readFile(results[0].redactionAuditPath, 'utf8');
    const artifact = JSON.parse(artifactText);
    const audit = JSON.parse(auditText);

    assert.equal(artifact.schemaVersion, API_CANDIDATE_SCHEMA_VERSION);
    assert.equal(artifact.status, 'observed');
    assert.equal(artifact.endpoint.url.includes('synthetic-api-token'), false);
    assert.equal(artifact.endpoint.url.includes('safe=1'), true);
    assert.equal(artifact.request.headers.authorization, REDACTION_PLACEHOLDER);
    assert.equal(artifact.request.headers.cookie, REDACTION_PLACEHOLDER);
    assert.equal(artifact.request.headers.accept, 'application/json');
    assert.equal(artifact.request.body.csrf, REDACTION_PLACEHOLDER);
    assert.equal(Object.hasOwn(artifact, 'candidateId'), false);
    assert.equal(Object.hasOwn(artifact, 'version'), false);
    assert.equal(artifactText.includes('synthetic-api-token'), false);
    assert.equal(artifactText.includes('synthetic-sessdata'), false);
    assert.equal(artifactText.includes('synthetic-csrf-token'), false);
    assert.equal(audit.redactedPaths.includes('endpoint.url'), false);
    assert.equal(audit.redactedPaths.includes('request.headers.authorization'), true);
    assert.equal(audit.redactedPaths.includes('request.headers.cookie'), true);
    assert.equal(audit.redactedPaths.includes('request.body.csrf'), true);
    assert.equal(auditText.includes('synthetic-api-token'), false);
    await assert.rejects(access(catalogPath), /ENOENT/u);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiDiscovery requires redaction audit directory before candidate artifact writes', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-discovery-missing-audit-'));
  try {
    const candidatesDir = path.join(runDir, 'api-candidates');
    const candidatePath = path.join(candidatesDir, 'candidate-0001.json');

    await assert.rejects(
      writeApiCandidateArtifactsFromObservedRequests([
        {
          siteKey: 'example',
          method: 'GET',
          url: 'https://example.invalid/api/items?access_token=synthetic-api-token',
          headers: {
            authorization: 'Bearer synthetic-api-token',
          },
          body: {
            csrf: 'synthetic-csrf-token',
          },
        },
      ], {
        outputDir: candidatesDir,
      }),
      /ApiDiscovery redactionAuditDir is required/u,
    );
    await assertMissingFiles([candidatePath]);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiDiscovery writes redacted candidates from synthetic capture output', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-discovery-capture-'));
  try {
    const candidatesDir = path.join(runDir, 'api-candidates');
    const auditsDir = path.join(runDir, 'redaction-audits');
    const catalogPath = path.join(runDir, 'api-catalog', 'candidate-0001.json');

    const results = await writeApiCandidateArtifactsFromCaptureOutput({
      networkRequests: [
        {
          siteKey: 'example',
          method: 'POST',
          url: 'https://example.invalid/api/capture?access_token=synthetic-capture-token',
          headers: {
            authorization: 'Bearer synthetic-capture-token',
            accept: 'application/json',
          },
          body: {
            csrf: 'synthetic-capture-csrf',
            page: 1,
          },
          source: 'synthetic-capture-output',
        },
      ],
    }, {
      outputDir: candidatesDir,
      redactionAuditDir: auditsDir,
    });

    assert.equal(results.length, 1);
    const artifactText = await readFile(results[0].artifactPath, 'utf8');
    const auditText = await readFile(results[0].redactionAuditPath, 'utf8');
    const artifact = JSON.parse(artifactText);

    assert.equal(artifact.schemaVersion, API_CANDIDATE_SCHEMA_VERSION);
    assert.equal(artifact.status, 'observed');
    assert.equal(artifact.source, 'synthetic-capture-output');
    assert.equal(artifact.endpoint.url.includes('synthetic-capture-token'), false);
    assert.equal(artifact.request.headers.authorization, REDACTION_PLACEHOLDER);
    assert.equal(artifact.request.body.csrf, REDACTION_PLACEHOLDER);
    assert.equal(Object.hasOwn(artifact, 'candidateId'), false);
    assert.equal(Object.hasOwn(artifact, 'version'), false);
    assert.equal(artifactText.includes('synthetic-capture-token'), false);
    assert.equal(artifactText.includes('synthetic-capture-csrf'), false);
    assert.equal(auditText.includes('synthetic-capture-token'), false);
    await assert.rejects(access(catalogPath), /ENOENT/u);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiDiscovery-produced candidates can enter SiteAdapter validation without catalog promotion', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-discovery-adapter-validation-'));
  try {
    const catalogPath = path.join(runDir, 'api-catalog', 'candidate-0001.json');
    const candidate = apiCandidateFromObservedRequest({
      id: 'discovered-generic-candidate',
      siteKey: 'generic-navigation',
      method: 'GET',
      url: 'https://example.invalid/api/navigation?access_token=synthetic-discovery-adapter-token',
      headers: {
        authorization: 'Bearer synthetic-discovery-adapter-token',
      },
      source: 'synthetic-observed-request',
    });
    const decision = validateApiCandidateWithAdapter(candidate, genericNavigationAdapter, {
      validatedAt: '2026-05-01T02:00:00.000Z',
      evidence: {
        authorization: 'Bearer synthetic-discovery-adapter-token',
        source: 'synthetic-contract',
      },
    });

    assert.equal(candidate.status, 'observed');
    assert.equal(decision.candidateId, 'discovered-generic-candidate');
    assert.equal(decision.siteKey, 'generic-navigation');
    assert.equal(decision.adapterId, 'generic-navigation');
    assert.equal(decision.decision, 'accepted');
    assert.equal(decision.evidence.authorization, REDACTION_PLACEHOLDER);
    assert.equal(Object.hasOwn(decision, 'artifactPath'), false);
    assert.equal(Object.hasOwn(decision, 'catalogPath'), false);
    await assert.rejects(
      writeApiCatalogEntryArtifact(candidate, { catalogPath }),
      /ApiCandidate must be verified before catalog entry/u,
    );
    await assert.rejects(access(catalogPath), /ENOENT/u);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiDiscovery writes redacted SiteAdapter decision artifacts without catalog promotion', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-discovery-adapter-decision-artifacts-'));
  try {
    const candidatesDir = path.join(runDir, 'api-candidates');
    const decisionDir = path.join(runDir, 'api-candidate-decisions');
    const decisionAuditDir = path.join(runDir, 'api-candidate-decision-audits');
    const upgradeDecisionDir = path.join(runDir, 'api-catalog-upgrade-decisions');
    const upgradeDecisionAuditDir = path.join(runDir, 'api-catalog-upgrade-decision-audits');
    const upgradeDecisionEventDir = path.join(runDir, 'api-catalog-upgrade-decision-events');
    const upgradeDecisionEventAuditDir = path.join(runDir, 'api-catalog-upgrade-decision-event-audits');
    const catalogPath = path.join(runDir, 'api-catalog', 'candidate-0001.json');
    const candidateResults = await writeApiCandidateArtifactsFromObservedRequests([
      {
        id: 'decision-artifact-candidate',
        siteKey: 'generic-navigation',
        method: 'GET',
        url: 'https://example.invalid/api/navigation?access_token=synthetic-decision-artifact-token',
        headers: {
          authorization: 'Bearer synthetic-decision-artifact-token',
        },
        body: {
          csrf: 'synthetic-decision-artifact-csrf',
        },
        source: 'synthetic-observed-request',
      },
    ], {
      outputDir: candidatesDir,
      redactionAuditDir: path.join(runDir, 'api-candidate-audits'),
    });

    const decisions = await writeSiteAdapterCandidateDecisionArtifacts(candidateResults, {
      outputDir: decisionDir,
      redactionAuditDir: decisionAuditDir,
      catalogUpgradeDecisionOutputDir: upgradeDecisionDir,
      catalogUpgradeDecisionRedactionAuditDir: upgradeDecisionAuditDir,
      catalogUpgradeDecisionLifecycleEventOutputDir: upgradeDecisionEventDir,
      catalogUpgradeDecisionLifecycleEventRedactionAuditDir: upgradeDecisionEventAuditDir,
      lifecycleEventTraceId: 'synthetic-api-discovery-upgrade-trace',
      lifecycleEventCorrelationId: 'synthetic-api-discovery-upgrade-correlation',
      validatedAt: '2026-05-01T08:10:00.000Z',
      decidedAt: '2026-05-01T08:10:01.000Z',
      evidenceSource: 'synthetic-candidate-artifact',
      resolveAdapter: ({ host }) => (host === 'generic-navigation' ? genericNavigationAdapter : null),
    });

    assert.equal(decisions.length, 1);
    assert.equal(candidateResults[0].candidate.status, 'observed');
    const decisionText = await readFile(decisions[0].artifactPath, 'utf8');
    const auditText = await readFile(decisions[0].redactionAuditPath, 'utf8');
    const upgradeDecisionText = await readFile(decisions[0].catalogUpgradeDecisionArtifactPath, 'utf8');
    const upgradeAuditText = await readFile(decisions[0].catalogUpgradeDecisionRedactionAuditPath, 'utf8');
    const upgradeEventText = await readFile(decisions[0].catalogUpgradeDecisionLifecycleEventPath, 'utf8');
    const upgradeEventAuditText = await readFile(
      decisions[0].catalogUpgradeDecisionLifecycleEventRedactionAuditPath,
      'utf8',
    );
    const decision = JSON.parse(decisionText);
    const audit = JSON.parse(auditText);
    const upgradeDecision = JSON.parse(upgradeDecisionText);
    const upgradeAudit = JSON.parse(upgradeAuditText);
    const upgradeEvent = JSON.parse(upgradeEventText);

    assert.equal(decision.candidateId, 'decision-artifact-candidate');
    assert.equal(decision.siteKey, 'generic-navigation');
    assert.equal(decision.adapterId, 'generic-navigation');
    assert.equal(decision.decision, 'accepted');
    assert.equal(decision.scope.validationMode, 'capture-observed-candidate');
    assert.equal(decision.scope.candidateArtifact, candidateResults[0].artifactPath);
    assert.equal(decision.evidence.source, 'synthetic-candidate-artifact');
    assert.equal(decision.evidence.artifactPath, candidateResults[0].artifactPath);
    assert.equal(Object.hasOwn(decision, 'catalogPath'), false);
    assert.equal(Object.hasOwn(decision, 'apiCatalog'), false);
    assert.equal(decisionText.includes('synthetic-decision-artifact-token'), false);
    assert.equal(decisionText.includes('synthetic-decision-artifact-csrf'), false);
    assert.equal(auditText.includes('synthetic-decision-artifact-token'), false);
    assert.equal(auditText.includes('synthetic-decision-artifact-csrf'), false);
    assert.equal(Array.isArray(audit.redactedPaths), true);
    assert.equal(upgradeDecision.candidateId, 'decision-artifact-candidate');
    assert.equal(upgradeDecision.siteKey, 'generic-navigation');
    assert.equal(upgradeDecision.adapterId, 'generic-navigation');
    assert.equal(upgradeDecision.decision, 'blocked');
    assert.equal(upgradeDecision.canEnterCatalog, false);
    assert.equal(upgradeDecision.reasonCode, 'api-catalog-entry-blocked');
    assert.equal(upgradeDecision.requirements.candidateStatus, 'observed');
    assert.equal(upgradeDecision.requirements.candidateVerified, false);
    assert.equal(upgradeDecision.requirements.siteAdapterAccepted, true);
    assert.equal(upgradeDecision.requirements.policyAllowsCatalogUpgrade, false);
    assert.equal(Object.hasOwn(upgradeDecision, 'endpoint'), false);
    assert.equal(Object.hasOwn(upgradeDecision, 'request'), false);
    assert.equal(Object.hasOwn(upgradeDecision, 'candidate'), false);
    assert.equal(Object.hasOwn(upgradeDecision, 'catalogEntry'), false);
    assert.equal(upgradeDecisionText.includes('synthetic-decision-artifact-token'), false);
    assert.equal(upgradeDecisionText.includes('synthetic-decision-artifact-csrf'), false);
    assert.equal(upgradeAuditText.includes('synthetic-decision-artifact-token'), false);
    assert.equal(upgradeAuditText.includes('synthetic-decision-artifact-csrf'), false);
    assert.equal(Array.isArray(upgradeAudit.redactedPaths), true);
    assert.equal(upgradeEvent.eventType, 'api.catalog.upgrade_decision.written');
    assert.equal(upgradeEvent.traceId, 'synthetic-api-discovery-upgrade-trace');
    assert.equal(upgradeEvent.correlationId, 'synthetic-api-discovery-upgrade-correlation');
    assert.equal(upgradeEvent.details.candidateId, 'decision-artifact-candidate');
    assert.equal(upgradeEvent.details.decision, 'blocked');
    assert.equal(upgradeEvent.details.canEnterCatalog, false);
    assert.equal(Object.hasOwn(upgradeEvent.details, 'endpoint'), false);
    assert.equal(Object.hasOwn(upgradeEvent.details, 'request'), false);
    assert.equal(Object.hasOwn(upgradeEvent.details, 'candidate'), false);
    assert.equal(upgradeEventText.includes('synthetic-decision-artifact-token'), false);
    assert.equal(upgradeEventText.includes('synthetic-decision-artifact-csrf'), false);
    assert.equal(upgradeEventAuditText.includes('synthetic-decision-artifact-token'), false);
    assert.equal(upgradeEventAuditText.includes('synthetic-decision-artifact-csrf'), false);
    await assert.rejects(access(catalogPath), /ENOENT/u);

    const runtimeStoreDir = path.join(runDir, 'runtime-store-blocked');
    const runtimeStorePaths = [
      path.join(runtimeStoreDir, 'decision.json'),
      path.join(runtimeStoreDir, 'decision.redaction-audit.json'),
      path.join(runtimeStoreDir, 'entry.json'),
      path.join(runtimeStoreDir, 'entry.redaction-audit.json'),
      path.join(runtimeStoreDir, 'collection.json'),
      path.join(runtimeStoreDir, 'collection.redaction-audit.json'),
    ];
    await assert.rejects(
      writeRuntimeVerifiedApiCatalogStoreArtifacts({
        candidate: decisions[0].candidate,
        siteAdapterDecision: decisions[0].decision,
        policy: {
          allowCatalogUpgrade: true,
        },
        decidedAt: '2026-05-02T02:05:00.000Z',
        metadata: {
          version: 'capture-produced-no-promotion-v1',
        },
      }, {
        decisionPath: runtimeStorePaths[0],
        decisionRedactionAuditPath: runtimeStorePaths[1],
        catalogPath: runtimeStorePaths[2],
        catalogRedactionAuditPath: runtimeStorePaths[3],
        collectionPath: runtimeStorePaths[4],
        collectionRedactionAuditPath: runtimeStorePaths[5],
      }),
      /ApiCatalog upgrade decision does not allow catalog entry: api-catalog-entry-blocked/u,
    );
    await assertMissingFiles(runtimeStorePaths);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiDiscovery requires redaction audit directory before SiteAdapter decision writes', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-discovery-decision-missing-audit-'));
  try {
    const decisionDir = path.join(runDir, 'api-candidate-decisions');
    const decisionPath = path.join(decisionDir, 'decision-0001.json');

    await assert.rejects(
      writeSiteAdapterCandidateDecisionArtifacts([
        {
          candidate: apiCandidateFromObservedRequest({
            id: 'decision-missing-audit-candidate',
            siteKey: 'generic-navigation',
            method: 'GET',
            url: 'https://example.invalid/api/navigation?access_token=synthetic-decision-token',
            headers: {
              authorization: 'Bearer synthetic-decision-token',
            },
            body: {
              csrf: 'synthetic-decision-csrf-token',
            },
          }),
          artifactPath: path.join(runDir, 'api-candidates', 'candidate-0001.json'),
        },
      ], {
        outputDir: decisionDir,
        resolveAdapter: () => genericNavigationAdapter,
      }),
      /SiteAdapter decision redactionAuditDir is required/u,
    );
    await assertMissingFiles([decisionPath]);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiDiscovery preflights SiteAdapter decisions before writing paired audit artifacts', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-discovery-decision-preflight-'));
  try {
    const decisionDir = path.join(runDir, 'api-candidate-decisions');
    const auditDir = path.join(runDir, 'api-candidate-decision-audits');
    const firstDecisionPath = path.join(decisionDir, 'decision-0001.json');
    const firstAuditPath = path.join(auditDir, 'decision-0001.redaction-audit.json');
    const invalidAdapter = {
      validateApiCandidate: () => ({
        decision: 'accepted',
      }),
    };

    await assert.rejects(
      writeSiteAdapterCandidateDecisionArtifacts([
        {
          candidate: apiCandidateFromObservedRequest({
            id: 'decision-preflight-valid-candidate',
            siteKey: 'generic-navigation',
            method: 'GET',
            url: 'https://example.invalid/api/navigation?access_token=synthetic-valid-decision-token',
          }),
          artifactPath: path.join(runDir, 'api-candidates', 'candidate-0001.json'),
        },
        {
          candidate: apiCandidateFromObservedRequest({
            id: 'decision-preflight-invalid-candidate',
            siteKey: 'invalid-navigation',
            method: 'GET',
            url: 'https://example.invalid/api/invalid?access_token=synthetic-invalid-decision-token',
          }),
          artifactPath: path.join(runDir, 'api-candidates', 'candidate-0002.json'),
        },
      ], {
        outputDir: decisionDir,
        redactionAuditDir: auditDir,
        resolveAdapter: ({ host }) => (host === 'generic-navigation' ? genericNavigationAdapter : invalidAdapter),
      }),
      /adapterId is required/u,
    );
    await assertMissingFiles([
      firstDecisionPath,
      firstAuditPath,
    ]);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiDiscovery manual verification helper writes explicit verified evidence without catalog promotion', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-discovery-manual-verification-'));
  try {
    const outputDir = path.join(runDir, 'api-candidate-verification');
    const auditDir = path.join(runDir, 'api-candidate-verification-audits');
    const eventDir = path.join(runDir, 'api-candidate-verification-events');
    const eventAuditDir = path.join(runDir, 'api-candidate-verification-event-audits');
    const catalogPath = path.join(runDir, 'api-catalog', 'candidate-0001.json');
    const candidate = apiCandidateFromObservedRequest({
      id: 'manual-verification-candidate',
      siteKey: 'generic-navigation',
      method: 'GET',
      url: 'https://example.invalid/api/navigation?access_token=synthetic-manual-verification-token&safe=1',
      headers: {
        authorization: 'Bearer synthetic-manual-verification-token',
        accept: 'application/json',
      },
      body: {
        csrf: 'synthetic-manual-verification-csrf',
        safe: true,
      },
      source: 'synthetic-observed-request',
    });
    const siteAdapterDecision = validateApiCandidateWithAdapter(candidate, genericNavigationAdapter, {
      validatedAt: '2026-05-02T01:40:00.000Z',
      evidence: {
        source: 'synthetic-manual-verification-decision',
      },
    });

    const results = await writeManualApiCandidateVerificationArtifacts([
      {
        candidate,
        siteAdapterDecision,
        verificationResult: createSyntheticMultiAspectVerificationResult(candidate, {
          verifierId: 'synthetic-manual-verifier',
          verifiedAt: '2026-05-02T01:41:00.000Z',
        }),
      },
    ], {
      outputDir,
      redactionAuditDir: auditDir,
      lifecycleEventOutputDir: eventDir,
      lifecycleEventRedactionAuditDir: eventAuditDir,
      lifecycleEventTraceId: 'trace-manual-verification',
      lifecycleEventCorrelationId: 'corr-manual-verification',
      lifecycleEventTaskType: 'manual-api-verification',
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].evidence.candidate.status, 'verified');
    assert.equal(results[0].lifecycleEvent.eventType, 'api.candidate.verified');
    assert.equal(results[0].lifecycleEvent.traceId, 'trace-manual-verification');
    assert.equal(results[0].lifecycleEvent.correlationId, 'corr-manual-verification');
    assert.equal(results[0].lifecycleEvent.taskType, 'manual-api-verification');
    assert.equal(assertSchemaCompatible('LifecycleEvent', results[0].lifecycleEvent), true);

    const evidenceText = await readFile(results[0].artifactPath, 'utf8');
    const eventText = await readFile(results[0].lifecycleEventPath, 'utf8');
    const evidence = JSON.parse(evidenceText);
    const event = JSON.parse(eventText);
    assert.equal(evidence.candidate.status, 'verified');
    assert.match(evidence.verification.metadata.aspects.responseSchemaHash, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(evidence.verification.metadata.aspects.authRequirement, 'session-view');
    assert.equal(
      evidence.verification.metadata.aspects.requestProtectionRequirement,
      'checked-redacted-request-protection',
    );
    assert.equal(evidence.verification.metadata.aspects.paginationModel, 'cursor');
    assert.equal(evidence.verification.metadata.aspects.riskState, 'normal');
    assert.equal(evidence.verification.metadata.aspects.riskLevel, 'low');
    assert.equal(evidence.candidate.request.headers.authorization, REDACTION_PLACEHOLDER);
    assert.equal(evidence.candidate.request.body.csrf, REDACTION_PLACEHOLDER);
    assert.equal(Object.hasOwn(evidence, 'catalogEntry'), false);
    assert.equal(Object.hasOwn(evidence, 'catalogPath'), false);
    assert.equal(event.details.candidateId, 'manual-verification-candidate');
    assert.equal(Object.hasOwn(event.details, 'endpoint'), false);
    assert.equal(Object.hasOwn(event.details, 'request'), false);
    assert.equal(Object.hasOwn(event.details, 'candidate'), false);
    assert.equal(Object.hasOwn(evidence.verification.metadata.aspects, 'responseBody'), false);
    assert.equal(evidenceText.includes('synthetic-manual-verification-token'), false);
    assert.equal(evidenceText.includes('synthetic-manual-verification-csrf'), false);
    assert.equal(evidenceText.includes('Synthetic manual response title'), false);
    assert.equal(evidenceText.includes('synthetic-manual-response-cursor'), false);
    assert.equal(eventText.includes('synthetic-manual-verification-token'), false);
    assert.equal(eventText.includes('synthetic-manual-verification-csrf'), false);
    await assert.rejects(access(catalogPath), /ENOENT/u);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiDiscovery manual verification helper materializes explicit verification fixtures', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-discovery-manual-fixtures-'));
  try {
    const outputDir = path.join(runDir, 'api-candidate-verification');
    const auditDir = path.join(runDir, 'api-candidate-verification-audits');
    const eventDir = path.join(runDir, 'api-candidate-verification-events');
    const eventAuditDir = path.join(runDir, 'api-candidate-verification-event-audits');
    const catalogPath = path.join(runDir, 'api-catalog', 'candidate-0001.json');
    const candidate = apiCandidateFromObservedRequest({
      id: 'manual-fixtures-candidate',
      siteKey: 'generic-navigation',
      method: 'GET',
      url: 'https://example.invalid/api/navigation?access_token=synthetic-fixture-token&safe=1',
      headers: {
        authorization: 'Bearer synthetic-fixture-token',
        accept: 'application/json',
      },
      body: {
        csrf: 'synthetic-fixture-csrf',
        safe: true,
      },
      source: 'synthetic-observed-request',
    });
    const siteAdapterDecision = validateApiCandidateWithAdapter(candidate, genericNavigationAdapter, {
      validatedAt: '2026-05-02T02:47:00.000Z',
      evidence: {
        source: 'synthetic-manual-fixtures-decision',
      },
    });

    const results = await writeManualApiCandidateVerificationArtifacts([
      {
        candidate,
        siteAdapterDecision,
        verificationFixtures: createSyntheticMultiAspectVerificationFixtures({
          verifierId: 'synthetic-manual-fixtures-verifier',
          verifiedAt: '2026-05-02T02:48:00.000Z',
        }),
      },
    ], {
      outputDir,
      redactionAuditDir: auditDir,
      lifecycleEventOutputDir: eventDir,
      lifecycleEventRedactionAuditDir: eventAuditDir,
      lifecycleEventTraceId: 'trace-manual-fixtures',
      lifecycleEventCorrelationId: 'corr-manual-fixtures',
      lifecycleEventTaskType: 'manual-api-verification',
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].evidence.candidate.status, 'verified');
    assert.equal(results[0].lifecycleEvent.eventType, 'api.candidate.verified');
    const evidenceText = await readFile(results[0].artifactPath, 'utf8');
    const eventText = await readFile(results[0].lifecycleEventPath, 'utf8');
    const evidence = JSON.parse(evidenceText);
    assert.equal(evidence.verification.verifierId, 'synthetic-manual-fixtures-verifier');
    assert.match(evidence.verification.metadata.aspects.responseSchemaHash, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(evidence.verification.metadata.aspects.authRequirement, 'session-view');
    assert.equal(evidence.verification.metadata.aspects.paginationModel, 'cursor');
    assert.equal(evidence.verification.metadata.aspects.riskState, 'normal');
    assert.equal(evidence.candidate.request.headers.authorization, REDACTION_PLACEHOLDER);
    assert.equal(evidence.candidate.request.body.csrf, REDACTION_PLACEHOLDER);
    assert.equal(Object.hasOwn(evidence, 'catalogEntry'), false);
    assert.equal(Object.hasOwn(evidence.verification.metadata.aspects, 'responseBody'), false);
    assert.equal(evidenceText.includes('synthetic-fixture-token'), false);
    assert.equal(evidenceText.includes('synthetic-fixture-csrf'), false);
    assert.equal(evidenceText.includes('Synthetic manual response title'), false);
    assert.equal(evidenceText.includes('synthetic-manual-response-cursor'), false);
    assert.equal(eventText.includes('synthetic-fixture-token'), false);
    assert.equal(eventText.includes('synthetic-fixture-csrf'), false);
    await assert.rejects(access(catalogPath), /ENOENT/u);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiDiscovery manual verification helper fails closed before partial writes', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-discovery-manual-verification-fail-'));
  try {
    const candidate = apiCandidateFromObservedRequest({
      id: 'manual-verification-fail-candidate',
      siteKey: 'generic-navigation',
      method: 'GET',
      url: 'https://example.invalid/api/navigation',
      source: 'synthetic-observed-request',
    });
    const acceptedDecision = validateApiCandidateWithAdapter(candidate, genericNavigationAdapter, {
      validatedAt: '2026-05-02T01:50:00.000Z',
    });
    const validRecord = {
      candidate,
      siteAdapterDecision: acceptedDecision,
      verificationResult: createSyntheticMultiAspectVerificationResult(candidate, {
        verifierId: 'synthetic-manual-verifier',
        verifiedAt: '2026-05-02T01:51:00.000Z',
      }),
    };

    const batchDir = path.join(runDir, 'invalid-batch');
    await assert.rejects(
      writeManualApiCandidateVerificationArtifacts([
        validRecord,
        {
          candidate,
          siteAdapterDecision: acceptedDecision,
          verificationResult: {
            status: 'passed',
            verifierId: 'synthetic-manual-verifier',
          },
        },
      ], {
        outputDir: path.join(batchDir, 'verification'),
        redactionAuditDir: path.join(batchDir, 'verification-audits'),
        lifecycleEventOutputDir: path.join(batchDir, 'events'),
        lifecycleEventRedactionAuditDir: path.join(batchDir, 'event-audits'),
      }),
      /verifiedAt is required/u,
    );
    await assertMissingFiles([
      path.join(batchDir, 'verification', 'verification-evidence-0001.json'),
      path.join(batchDir, 'verification-audits', 'verification-evidence-0001.redaction-audit.json'),
      path.join(batchDir, 'events', 'verification-lifecycle-event-0001.json'),
      path.join(batchDir, 'event-audits', 'verification-lifecycle-event-0001.redaction-audit.json'),
    ]);

    const missingResultDir = path.join(runDir, 'missing-result');
    await assert.rejects(
      writeManualApiCandidateVerificationArtifacts([
        {
          candidate,
          siteAdapterDecision: acceptedDecision,
        },
      ], {
        outputDir: path.join(missingResultDir, 'verification'),
        redactionAuditDir: path.join(missingResultDir, 'verification-audits'),
      }),
      /verification result must be passed/u,
    );
    await assertMissingFiles([
      path.join(missingResultDir, 'verification', 'verification-evidence-0001.json'),
      path.join(missingResultDir, 'verification-audits', 'verification-evidence-0001.redaction-audit.json'),
    ]);

    const rejectedDecision = normalizeSiteAdapterCandidateDecision({
      adapterId: 'generic-navigation',
      decision: 'rejected',
      reasonCode: 'api-verification-failed',
    }, { candidate });
    const rejectedDir = path.join(runDir, 'rejected-decision');
    await assert.rejects(
      writeManualApiCandidateVerificationArtifacts([
        {
          candidate,
          siteAdapterDecision: rejectedDecision,
          verificationResult: validRecord.verificationResult,
        },
      ], {
        outputDir: path.join(rejectedDir, 'verification'),
        redactionAuditDir: path.join(rejectedDir, 'verification-audits'),
      }),
      /requires accepted SiteAdapter decision/u,
    );
    await assertMissingFiles([
      path.join(rejectedDir, 'verification', 'verification-evidence-0001.json'),
      path.join(rejectedDir, 'verification-audits', 'verification-evidence-0001.redaction-audit.json'),
    ]);

    const sensitiveDir = path.join(runDir, 'sensitive-metadata');
    await assert.rejects(
      writeManualApiCandidateVerificationArtifacts([
        {
          candidate,
          siteAdapterDecision: acceptedDecision,
          verificationResult: {
            status: 'passed',
            verifierId: 'synthetic-manual-verifier',
            verifiedAt: '2026-05-02T01:52:00.000Z',
            metadata: {
              authorization: 'Bearer synthetic-manual-metadata-token',
            },
          },
        },
      ], {
        outputDir: path.join(sensitiveDir, 'verification'),
        redactionAuditDir: path.join(sensitiveDir, 'verification-audits'),
      }),
      /metadata must not contain sensitive material/u,
    );
    await assertMissingFiles([
      path.join(sensitiveDir, 'verification', 'verification-evidence-0001.json'),
      path.join(sensitiveDir, 'verification-audits', 'verification-evidence-0001.redaction-audit.json'),
    ]);

    const sensitiveFixtureDir = path.join(runDir, 'sensitive-fixture');
    await assert.rejects(
      writeManualApiCandidateVerificationArtifacts([
        {
          candidate,
          siteAdapterDecision: acceptedDecision,
          verificationFixtures: {
            ...createSyntheticMultiAspectVerificationFixtures({
              verifierId: 'synthetic-sensitive-fixture-verifier',
              verifiedAt: '2026-05-02T02:49:00.000Z',
            }),
            responseFixture: {
              statusCode: 200,
              body: {
                csrf: 'synthetic-sensitive-fixture-csrf',
              },
            },
          },
        },
      ], {
        outputDir: path.join(sensitiveFixtureDir, 'verification'),
        redactionAuditDir: path.join(sensitiveFixtureDir, 'verification-audits'),
        lifecycleEventOutputDir: path.join(sensitiveFixtureDir, 'events'),
        lifecycleEventRedactionAuditDir: path.join(sensitiveFixtureDir, 'event-audits'),
      }),
      /response schema fixture must not contain sensitive material/u,
    );
    await assertMissingFiles([
      path.join(sensitiveFixtureDir, 'verification', 'verification-evidence-0001.json'),
      path.join(sensitiveFixtureDir, 'verification-audits', 'verification-evidence-0001.redaction-audit.json'),
      path.join(sensitiveFixtureDir, 'events', 'verification-lifecycle-event-0001.json'),
      path.join(sensitiveFixtureDir, 'event-audits', 'verification-lifecycle-event-0001.redaction-audit.json'),
    ]);

    const singleAspectDir = path.join(runDir, 'single-aspect');
    await assert.rejects(
      writeManualApiCandidateVerificationArtifacts([
        {
          candidate,
          siteAdapterDecision: acceptedDecision,
          verificationResult: createApiCandidateResponseVerificationResult({
            candidate,
            verifierId: 'synthetic-single-aspect-verifier',
            verifiedAt: '2026-05-02T01:53:00.000Z',
            responseEvidence: {
              responseSchemaHash: 'synthetic-single-aspect-schema-hash',
            },
          }),
        },
      ], {
        outputDir: path.join(singleAspectDir, 'verification'),
        redactionAuditDir: path.join(singleAspectDir, 'verification-audits'),
      }),
      /requires multi-aspect verification result/u,
    );
    await assertMissingFiles([
      path.join(singleAspectDir, 'verification', 'verification-evidence-0001.json'),
      path.join(singleAspectDir, 'verification-audits', 'verification-evidence-0001.redaction-audit.json'),
    ]);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiDiscovery manual verification output can explicitly feed runtime catalog store', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-discovery-manual-to-store-'));
  try {
    const candidate = apiCandidateFromObservedRequest({
      id: 'manual-to-store-candidate',
      siteKey: 'generic-navigation',
      method: 'GET',
      url: 'https://example.invalid/api/navigation?access_token=synthetic-manual-store-token&safe=1',
      headers: {
        authorization: 'Bearer synthetic-manual-store-token',
        accept: 'application/json',
      },
      body: {
        csrf: 'synthetic-manual-store-csrf',
        safe: true,
      },
      source: 'synthetic-observed-request',
    });
    const siteAdapterDecision = validateApiCandidateWithAdapter(candidate, genericNavigationAdapter, {
      validatedAt: '2026-05-02T02:00:00.000Z',
    });
    const manualResults = await writeManualApiCandidateVerificationArtifacts([
      {
        candidate,
        siteAdapterDecision,
        verificationResult: createSyntheticMultiAspectVerificationResult(candidate, {
          verifierId: 'synthetic-manual-store-verifier',
          verifiedAt: '2026-05-02T02:01:00.000Z',
        }),
      },
    ], {
      outputDir: path.join(runDir, 'manual-verification'),
      redactionAuditDir: path.join(runDir, 'manual-verification-audits'),
      lifecycleEventOutputDir: path.join(runDir, 'manual-verification-events'),
      lifecycleEventRedactionAuditDir: path.join(runDir, 'manual-verification-event-audits'),
    });
    const manualEvidence = manualResults[0].evidence;
    const storeDir = path.join(runDir, 'runtime-store');
    const storePaths = {
      decisionPath: path.join(storeDir, 'decision.json'),
      decisionRedactionAuditPath: path.join(storeDir, 'decision.redaction-audit.json'),
      catalogPath: path.join(storeDir, 'entry.json'),
      catalogRedactionAuditPath: path.join(storeDir, 'entry.redaction-audit.json'),
      verificationEventPath: path.join(storeDir, 'verification-event.json'),
      verificationEventRedactionAuditPath: path.join(storeDir, 'verification-event.redaction-audit.json'),
      collectionPath: path.join(storeDir, 'collection.json'),
      collectionRedactionAuditPath: path.join(storeDir, 'collection.redaction-audit.json'),
      collectionLifecycleEventPath: path.join(storeDir, 'collection-event.json'),
      collectionLifecycleEventRedactionAuditPath: path.join(storeDir, 'collection-event.redaction-audit.json'),
    };

    const storeResult = await writeRuntimeVerifiedApiCatalogStoreArtifacts({
      candidate: manualEvidence.candidate,
      siteAdapterDecision: manualEvidence.siteAdapterDecision,
      policy: {
        allowCatalogUpgrade: true,
      },
      decidedAt: '2026-05-02T02:02:00.000Z',
      metadata: {
        version: 'manual-store-v1',
        verifiedAt: manualEvidence.verification.verifiedAt,
        lastValidatedAt: '2026-05-02T02:03:00.000Z',
      },
    }, storePaths);

    assert.equal(storeResult.catalogEntry.entry.candidateId, 'manual-to-store-candidate');
    assert.equal(storeResult.catalogCollection.catalog.entries.length, 1);
    assert.equal(storeResult.catalogCollection.catalog.entries[0].candidateId, 'manual-to-store-candidate');
    assert.equal(storeResult.catalogCollection.lifecycleEvent.eventType, 'api.catalog.collection.written');
    assert.equal(storeResult.catalogEntry.verificationEvent.eventType, 'api.catalog.verification.written');
    assert.equal(assertSchemaCompatible('LifecycleEvent', storeResult.catalogCollection.lifecycleEvent), true);
    assert.equal(assertSchemaCompatible('LifecycleEvent', storeResult.catalogEntry.verificationEvent), true);

    const persistedCollection = JSON.parse(await readFile(storePaths.collectionPath, 'utf8'));
    const persistedDecision = JSON.parse(await readFile(storePaths.decisionPath, 'utf8'));
    assert.equal(persistedCollection.entries[0].candidateId, 'manual-to-store-candidate');
    assert.equal(persistedDecision.decision, 'allowed');
    const persistedText = [
      await readFile(manualResults[0].artifactPath, 'utf8'),
      await readFile(manualResults[0].lifecycleEventPath, 'utf8'),
      await readFile(storePaths.catalogPath, 'utf8'),
      await readFile(storePaths.collectionPath, 'utf8'),
      await readFile(storePaths.verificationEventPath, 'utf8'),
      await readFile(storePaths.collectionLifecycleEventPath, 'utf8'),
    ].join('\n');
    assert.equal(persistedText.includes('synthetic-manual-store-token'), false);
    assert.equal(persistedText.includes('synthetic-manual-store-csrf'), false);

    const blockedStoreDir = path.join(runDir, 'observed-store');
    const blockedPaths = [
      path.join(blockedStoreDir, 'decision.json'),
      path.join(blockedStoreDir, 'decision.redaction-audit.json'),
      path.join(blockedStoreDir, 'entry.json'),
      path.join(blockedStoreDir, 'entry.redaction-audit.json'),
      path.join(blockedStoreDir, 'collection.json'),
      path.join(blockedStoreDir, 'collection.redaction-audit.json'),
    ];
    await assert.rejects(
      writeRuntimeVerifiedApiCatalogStoreArtifacts({
        candidate,
        siteAdapterDecision,
        policy: {
          allowCatalogUpgrade: true,
        },
        metadata: {
          version: 'blocked-observed-v1',
        },
      }, {
        decisionPath: blockedPaths[0],
        decisionRedactionAuditPath: blockedPaths[1],
        catalogPath: blockedPaths[2],
        catalogRedactionAuditPath: blockedPaths[3],
        collectionPath: blockedPaths[4],
        collectionRedactionAuditPath: blockedPaths[5],
      }),
      /ApiCatalog upgrade decision does not allow catalog entry: api-catalog-entry-blocked/u,
    );
    await assertMissingFiles(blockedPaths);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiDiscovery rejects malformed observed request inputs before writing', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-discovery-invalid-'));
  try {
    await assert.rejects(
      writeApiCandidateArtifactsFromObservedRequests('not-an-array', { outputDir: runDir }),
      /Observed requests must be an array/u,
    );
    await assert.rejects(
      writeApiCandidateArtifactsFromObservedRequests([{ url: 'https://example.invalid/api' }], { outputDir: runDir }),
      /siteKey is required/u,
    );
    await assert.rejects(
      writeApiCandidateArtifactsFromObservedRequests([{ siteKey: 'example' }], { outputDir: runDir }),
      /url is required/u,
    );
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiDiscovery adapter validation requires an adapter validation method', () => {
  assert.throws(
    () => validateApiCandidateWithAdapter(apiCandidateFromObservedRequest({
      siteKey: 'generic-navigation',
      url: 'https://example.invalid/api/navigation',
    }), {}),
    /validateApiCandidate is required/u,
  );
});

test('ApiDiscovery decision artifact writer requires output and adapter boundaries', async () => {
  await assert.rejects(
    writeSiteAdapterCandidateDecisionArtifacts('not-an-array', {
      outputDir: 'unused',
      redactionAuditDir: 'unused',
      resolveAdapter: () => genericNavigationAdapter,
    }),
    /ApiCandidate results must be an array/u,
  );
  await assert.rejects(
    writeSiteAdapterCandidateDecisionArtifacts([], {
      redactionAuditDir: 'unused',
      resolveAdapter: () => genericNavigationAdapter,
    }),
    /decision outputDir is required/u,
  );
  await assert.rejects(
    writeSiteAdapterCandidateDecisionArtifacts([], {
      outputDir: 'unused',
      resolveAdapter: () => genericNavigationAdapter,
    }),
    /decision redactionAuditDir is required/u,
  );
  await assert.rejects(
    writeSiteAdapterCandidateDecisionArtifacts([], {
      outputDir: 'unused',
      redactionAuditDir: 'unused',
      catalogUpgradeDecisionOutputDir: 'unused',
      resolveAdapter: () => genericNavigationAdapter,
    }),
    /catalog upgrade decision output and redaction audit dirs must be provided together/u,
  );
  await assert.rejects(
    writeSiteAdapterCandidateDecisionArtifacts([], {
      outputDir: 'unused',
      redactionAuditDir: 'unused',
      catalogUpgradeDecisionRedactionAuditDir: 'unused',
      resolveAdapter: () => genericNavigationAdapter,
    }),
    /catalog upgrade decision output and redaction audit dirs must be provided together/u,
  );
  await assert.rejects(
    writeSiteAdapterCandidateDecisionArtifacts([], {
      outputDir: 'unused',
      redactionAuditDir: 'unused',
      catalogUpgradeDecisionOutputDir: 'unused',
      catalogUpgradeDecisionRedactionAuditDir: 'unused',
      catalogUpgradeDecisionLifecycleEventOutputDir: 'unused',
      resolveAdapter: () => genericNavigationAdapter,
    }),
    /catalog upgrade decision lifecycle event and redaction audit dirs must be provided together/u,
  );
  await assert.rejects(
    writeSiteAdapterCandidateDecisionArtifacts([], {
      outputDir: 'unused',
      redactionAuditDir: 'unused',
      catalogUpgradeDecisionLifecycleEventOutputDir: 'unused',
      catalogUpgradeDecisionLifecycleEventRedactionAuditDir: 'unused',
      resolveAdapter: () => genericNavigationAdapter,
    }),
    /lifecycle events require upgrade decision output dirs/u,
  );
  await assert.rejects(
    writeSiteAdapterCandidateDecisionArtifacts([], {
      outputDir: 'unused',
      redactionAuditDir: 'unused',
    }),
    /decision resolveAdapter is required/u,
  );
});

test('ApiDiscovery rejects promoted statuses before writing candidate artifacts', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-discovery-promoted-status-'));
  try {
    const verifiedDir = path.join(runDir, 'verified');
    const catalogedDir = path.join(runDir, 'cataloged');
    const verifiedPath = path.join(verifiedDir, 'candidate-0001.json');
    const catalogedPath = path.join(catalogedDir, 'candidate-0001.json');

    await assert.rejects(
      writeApiCandidateArtifactsFromObservedRequests([
        {
          siteKey: 'example',
          status: 'verified',
          url: 'https://example.invalid/api/items',
        },
      ], { outputDir: verifiedDir }),
      /status must be observed/u,
    );
    await assert.rejects(
      writeApiCandidateArtifactsFromObservedRequests([
        {
          siteKey: 'example',
          status: 'cataloged',
          url: 'https://example.invalid/api/items',
        },
      ], { outputDir: catalogedDir }),
      /status must be observed/u,
    );
    await assert.rejects(access(verifiedPath), /ENOENT/u);
    await assert.rejects(access(catalogedPath), /ENOENT/u);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiDiscovery preflights all observed requests before writing batch candidate artifacts', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-discovery-batch-preflight-'));
  try {
    const candidatesDir = path.join(runDir, 'api-candidates');
    const firstCandidatePath = path.join(candidatesDir, 'candidate-0001.json');
    const firstAuditPath = path.join(runDir, 'redaction-audits', 'candidate-0001.redaction-audit.json');

    await assert.rejects(
      writeApiCandidateArtifactsFromObservedRequests([
        {
          siteKey: 'example',
          url: 'https://example.invalid/api/valid?access_token=synthetic-valid-token',
          headers: {
            authorization: 'Bearer synthetic-valid-token',
          },
        },
        {
          siteKey: 'example',
          status: 'verified',
          url: 'https://example.invalid/api/promoted',
        },
      ], {
        outputDir: candidatesDir,
        redactionAuditDir: path.join(runDir, 'redaction-audits'),
      }),
      /status must be observed/u,
    );
    await assert.rejects(access(firstCandidatePath), /ENOENT/u);
    await assert.rejects(access(firstAuditPath), /ENOENT/u);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiDiscovery rejects malformed capture output before writing', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-discovery-capture-invalid-'));
  try {
    await assert.rejects(
      writeApiCandidateArtifactsFromCaptureOutput({ requests: 'not-an-array' }, { outputDir: runDir }),
      /Capture output requests must be an array/u,
    );
    await assert.rejects(
      writeApiCandidateArtifactsFromCaptureOutput({
        networkRequests: [
          {
            siteKey: 'example',
            status: 'verified',
            url: 'https://example.invalid/api/items',
          },
        ],
      }, { outputDir: runDir }),
      /status must be observed/u,
    );
    await assert.rejects(access(path.join(runDir, 'candidate-0001.json')), /ENOENT/u);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiDiscovery fails closed with recovery metadata when capture output generates no candidates', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-discovery-empty-capture-'));
  try {
    const candidatePath = path.join(runDir, 'api-candidates', 'candidate-0001.json');
    const auditPath = path.join(runDir, 'api-candidate-audits', 'candidate-0001.redaction-audit.json');

    await assert.rejects(
      writeApiCandidateArtifactsFromCaptureOutput({
        networkRequests: [],
      }, {
        outputDir: path.join(runDir, 'api-candidates'),
        redactionAuditDir: path.join(runDir, 'api-candidate-audits'),
      }),
      (error) => {
        assert.equal(error.name, 'ApiDiscoveryFailure');
        assert.equal(error.reasonCode, 'api-candidate-generation-failed');
        assert.deepEqual(error.reasonRecovery, reasonCodeSummary('api-candidate-generation-failed'));
        assert.equal(error.retryable, true);
        assert.equal(error.metadata.stage, 'candidate-generation');
        assert.equal(error.metadata.requestCount, 0);
        return true;
      },
    );
    await assertMissingFiles([candidatePath, auditPath]);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiDiscovery fails closed when SiteAdapter validation is missing', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-discovery-missing-adapter-validation-'));
  try {
    const firstDecisionPath = path.join(runDir, 'api-candidate-decisions', 'decision-0001.json');
    const firstAuditPath = path.join(
      runDir,
      'api-candidate-decision-audits',
      'decision-0001.redaction-audit.json',
    );
    const secondDecisionPath = path.join(runDir, 'api-candidate-decisions', 'decision-0002.json');
    const secondAuditPath = path.join(
      runDir,
      'api-candidate-decision-audits',
      'decision-0002.redaction-audit.json',
    );
    const validCandidate = apiCandidateFromObservedRequest({
      id: 'valid-before-missing-adapter-validation-candidate',
      siteKey: 'generic-navigation',
      url: 'https://example.invalid/api/navigation',
    });
    const candidate = apiCandidateFromObservedRequest({
      id: 'missing-adapter-validation-candidate',
      siteKey: 'missing-adapter-validation',
      url: 'https://missing-adapter-validation.invalid/api/items',
    });

    await assert.rejects(
      writeSiteAdapterCandidateDecisionArtifacts([
        {
          candidate: validCandidate,
          artifactPath: path.join(runDir, 'api-candidates', 'candidate-0001.json'),
        },
        {
          candidate,
          artifactPath: path.join(runDir, 'api-candidates', 'candidate-0002.json'),
        },
      ], {
        outputDir: path.join(runDir, 'api-candidate-decisions'),
        redactionAuditDir: path.join(runDir, 'api-candidate-decision-audits'),
        resolveAdapter: ({ host }) => (host === 'generic-navigation'
          ? genericNavigationAdapter
          : { id: 'missing-adapter-validation' }),
      }),
      (error) => {
        assert.equal(error.name, 'ApiDiscoveryFailure');
        assert.equal(error.reasonCode, 'site-adapter-core-api-unidentified');
        assert.deepEqual(error.reasonRecovery, reasonCodeSummary('site-adapter-core-api-unidentified'));
        assert.equal(error.retryable, false);
        assert.equal(error.manualRecoveryNeeded, true);
        assert.equal(error.artifactWriteAllowed, false);
        assert.equal(error.metadata.stage, 'site-adapter-validation');
        assert.equal(error.metadata.candidateId, 'missing-adapter-validation-candidate');
        assert.equal(error.metadata.siteKey, 'missing-adapter-validation');
        return true;
      },
    );
    await assertMissingFiles([firstDecisionPath, firstAuditPath, secondDecisionPath, secondAuditPath]);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});
