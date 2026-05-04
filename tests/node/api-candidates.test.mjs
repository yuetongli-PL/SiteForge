import test from 'node:test';
import assert from 'node:assert/strict';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  API_CANDIDATE_SCHEMA_VERSION,
  API_CANDIDATE_STATUSES,
  API_CATALOG_INDEX_SCHEMA_VERSION,
  API_CATALOG_SCHEMA_VERSION,
  API_CATALOG_ENTRY_SCHEMA_VERSION,
  API_CATALOG_UPGRADE_DECISION_VERSION,
  API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION,
  SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION,
  SITE_ADAPTER_CATALOG_UPGRADE_POLICY_SCHEMA_VERSION,
  assertApiCandidateCompatible,
  assertApiCandidateCanEnterCatalog,
  assertApiCatalogCompatible,
  assertApiCatalogEntryCompatible,
  assertApiCatalogIndexCompatible,
  assertApiCatalogUpgradeDecisionAllowsCatalog,
  assertApiResponseCaptureSummaryCompatible,
  assertSiteAdapterCandidateDecisionCompatible,
  assertSiteAdapterCatalogUpgradePolicyCompatible,
  createApiCandidateAuthVerificationResult,
  createApiCandidateAuthVerificationResultFromFixture,
  createApiCandidateMultiAspectVerificationResult,
  createApiCandidateMultiAspectVerificationResultFromFixtures,
  createApiCandidatePaginationVerificationResult,
  createApiCandidatePaginationVerificationResultFromFixture,
  createApiCandidateRiskVerificationResult,
  createApiCandidateRiskVerificationResultFromFixture,
  createApiCandidateVerificationLifecycleEvent,
  createApiCandidateResponseCaptureSummary,
  createApiCandidateResponseVerificationResult,
  createApiCandidateResponseSchemaVerificationResultFromCaptureSummary,
  createApiCandidateResponseSchemaVerificationResultFromFixture,
  createApiCatalogIndex,
  createApiCatalogCollection,
  createApiCatalogCollectionLifecycleEvent,
  createApiCatalogEntryFromCandidate,
  createApiCatalogUpgradeDecision,
  createApiCatalogSchemaIncompatibilityLifecycleEvent,
  createApiCatalogVerificationHookDescriptor,
  normalizeApiCandidate,
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
  transitionApiCatalogCollectionEntryStatus,
  upsertApiCatalogCollectionArtifact,
  verifyApiCandidateForCatalog,
  writeApiCandidateArtifact,
  writeApiCandidateVerificationEvidenceArtifact,
  writeApiCandidateResponseVerificationResultArtifact,
  writeApiCatalogCollectionArtifact,
  writeApiCatalogCollectionStatusTransitionArtifact,
  writeApiCatalogEntryArtifact,
  writeApiCatalogIndexArtifact,
  writeApiCatalogUpgradeDecisionArtifact,
  writeApiCatalogVerificationEventArtifact,
  writeRuntimeApiCatalogMaintenanceArtifacts,
  writeRuntimeVerifiedApiCatalogStoreArtifacts,
  writeVerifiedApiCatalogUpgradeFixtureArtifacts,
} from '../../src/sites/capability/api-candidates.mjs';
import {
  assertLifecycleEventObservabilityFields,
  writeLifecycleEventArtifact,
} from '../../src/sites/capability/lifecycle-events.mjs';
import { reasonCodeSummary } from '../../src/sites/capability/reason-codes.mjs';
import { REDACTION_PLACEHOLDER } from '../../src/sites/capability/security-guard.mjs';
import { assertSchemaCompatible } from '../../src/sites/capability/compatibility-registry.mjs';
import { createCapabilityHookRegistry } from '../../src/sites/capability/capability-hook.mjs';
import { writeCatalogStorePlannerPolicyHandoffArtifact } from '../../src/sites/capability/planner-policy-handoff.mjs';

function createCandidate(overrides = {}) {
  return {
    schemaVersion: API_CANDIDATE_SCHEMA_VERSION,
    siteKey: 'example',
    status: 'candidate',
    endpoint: {
      method: 'get',
      url: 'https://example.invalid/api/items?access_token=synthetic-api-token&safe=1',
    },
    request: {
      headers: {
        authorization: 'Bearer synthetic-api-token',
        accept: 'application/json',
      },
      body: {
        csrf: 'synthetic-csrf-token',
        safe: true,
      },
    },
    evidence: {
      source: 'synthetic-fixture',
    },
    ...overrides,
  };
}

function createVerifiedCatalogRegressionFixture() {
  const candidates = [
    createCandidate({
      id: 'fixture-catalog-video-list',
      siteKey: 'fixture-site',
      status: 'verified',
      endpoint: {
        method: 'GET',
        url: 'https://fixture.invalid/api/videos?access_token=synthetic-fixture-access-token&page=1',
      },
      auth: {
        authorization: 'Bearer synthetic-fixture-authorization',
      },
      pagination: {
        model: 'page',
        pageParam: 'page',
      },
      fieldMapping: {
        itemId: '$.data.items[*].id',
      },
      risk: {
        level: 'low',
      },
      observedAt: '2026-05-01T04:00:00.000Z',
    }),
    createCandidate({
      id: 'fixture-catalog-video-detail',
      siteKey: 'fixture-site',
      status: 'verified',
      endpoint: {
        method: 'POST',
        url: 'https://fixture.invalid/api/video/detail?csrf=synthetic-fixture-csrf',
      },
      request: {
        headers: {
          authorization: 'Bearer synthetic-fixture-detail-authorization',
          accept: 'application/json',
        },
        body: {
          csrf: 'synthetic-fixture-detail-csrf',
          safe: true,
        },
      },
      fieldMapping: {
        title: '$.data.title',
      },
      observedAt: '2026-05-01T04:01:00.000Z',
    }),
  ];

  return {
    candidates,
    metadataByCandidateId: {
      'fixture-catalog-video-list': {
        version: 'fixture-api-v1',
        verifiedAt: '2026-05-01T04:05:00.000Z',
        lastValidatedAt: '2026-05-01T04:06:00.000Z',
        invalidationStatus: 'active',
        auth: {
          authorization: 'Bearer synthetic-fixture-catalog-authorization',
        },
        risk: {
          level: 'low',
        },
      },
      'fixture-catalog-video-detail': {
        version: 'fixture-api-v1',
        verifiedAt: '2026-05-01T04:07:00.000Z',
        lastValidatedAt: '2026-05-01T04:08:00.000Z',
        invalidationStatus: 'stale',
      },
    },
    generatedAt: '2026-05-01T04:10:00.000Z',
  };
}

function withoutSchemaVersion(candidate) {
  const { schemaVersion, ...rest } = candidate;
  return rest;
}

async function assertMissingFiles(filePaths) {
  for (const filePath of filePaths) {
    await assert.rejects(access(filePath), /ENOENT/u);
  }
}

test('ApiCandidate schema is versioned and redacts synthetic request material', () => {
  const candidate = normalizeApiCandidate(createCandidate());

  assert.equal(candidate.schemaVersion, API_CANDIDATE_SCHEMA_VERSION);
  assert.equal(assertApiCandidateCompatible(candidate), true);
  assert.equal(candidate.status, 'candidate');
  assert.equal(candidate.endpoint.method, 'GET');
  assert.equal(candidate.endpoint.url.includes('synthetic-api-token'), false);
  assert.equal(candidate.endpoint.url.includes('safe=1'), true);
  assert.equal(candidate.request.headers.authorization, REDACTION_PLACEHOLDER);
  assert.equal(candidate.request.headers.accept, 'application/json');
  assert.equal(candidate.request.body.csrf, REDACTION_PLACEHOLDER);
  assert.equal(JSON.stringify(candidate).includes('synthetic-api-token'), false);
  assert.equal(JSON.stringify(candidate).includes('synthetic-csrf-token'), false);
});

test('only verified ApiCandidate can enter catalog', () => {
  for (const status of API_CANDIDATE_STATUSES) {
    const candidate = createCandidate({ status });
    if (status === 'verified') {
      assert.equal(assertApiCandidateCanEnterCatalog(candidate).status, 'verified');
      continue;
    }
    assert.throws(
      () => assertApiCandidateCanEnterCatalog(candidate),
      /ApiCandidate must be verified before catalog entry/u,
    );
  }
});

test('verified evidence producer creates verified ApiCandidate without catalog writes', () => {
  const observedCandidate = createCandidate({
    id: 'verification-producer-candidate',
    siteKey: 'fixture-site',
    status: 'observed',
    endpoint: {
      method: 'POST',
      url: 'https://fixture.invalid/api/items?access_token=synthetic-verification-token&safe=1',
    },
    request: {
      headers: {
        authorization: 'Bearer synthetic-verification-token',
        accept: 'application/json',
      },
      body: {
        csrf: 'synthetic-verification-csrf',
        safe: true,
      },
    },
  });
  const acceptedDecision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'fixture-adapter',
    adapterVersion: 'adapter-v1',
    decision: 'accepted',
    validatedAt: '2026-05-02T01:00:00.000Z',
    evidence: {
      route: 'synthetic-route',
    },
  }, { candidate: observedCandidate });

  const result = verifyApiCandidateForCatalog({
    candidate: observedCandidate,
    siteAdapterDecision: acceptedDecision,
    verificationResult: {
      status: 'passed',
      verifierId: 'synthetic-contract-verifier',
      verifiedAt: '2026-05-02T01:01:00.000Z',
      metadata: {
        responseSchemaHash: 'synthetic-schema-hash',
        regressionFixture: 'synthetic-fixture',
      },
    },
  });

  assert.equal(result.candidate.status, 'verified');
  assert.equal(result.candidate.source, 'verified-evidence');
  assert.equal(result.candidate.id, 'verification-producer-candidate');
  assert.equal(result.candidate.endpoint.method, 'POST');
  assert.equal(result.candidate.endpoint.url.includes('synthetic-verification-token'), false);
  assert.equal(result.candidate.endpoint.url.includes('safe=1'), true);
  assert.equal(result.candidate.request.headers.authorization, REDACTION_PLACEHOLDER);
  assert.equal(result.candidate.request.body.csrf, REDACTION_PLACEHOLDER);
  assert.equal(result.candidate.evidence.verification.verifierId, 'synthetic-contract-verifier');
  assert.equal(result.candidate.evidence.verification.verifiedAt, '2026-05-02T01:01:00.000Z');
  assert.equal(result.candidate.evidence.verification.siteAdapterDecision.adapterId, 'fixture-adapter');
  assert.equal(result.candidate.evidence.verification.siteAdapterDecision.adapterVersion, 'adapter-v1');
  assert.equal(assertApiCandidateCanEnterCatalog(result.candidate).status, 'verified');
  assert.equal(Object.hasOwn(result.candidate, 'catalogPath'), false);
  assert.equal(Object.hasOwn(result.candidate, 'catalogEntry'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-verification-token'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-verification-csrf'), false);
});

test('response schema verification result feeds verified evidence producer', () => {
  const candidate = createCandidate({
    id: 'response-schema-verification-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });
  const acceptedDecision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'fixture-adapter',
    adapterVersion: 'adapter-v1',
    decision: 'accepted',
  }, { candidate });
  const verificationResult = createApiCandidateResponseVerificationResult({
    candidate,
    verifierId: 'synthetic-response-schema-verifier',
    verifiedAt: '2026-05-02T01:05:00.000Z',
    responseEvidence: {
      responseSchemaHash: 'synthetic-response-schema-hash',
      statusCode: 200,
      sampleShape: {
        items: 'array',
      },
    },
    metadata: {
      regressionFixture: 'synthetic-response-fixture',
    },
  });

  assert.equal(verificationResult.status, 'passed');
  assert.equal(verificationResult.verifierId, 'synthetic-response-schema-verifier');
  assert.equal(verificationResult.metadata.candidateId, 'response-schema-verification-candidate');
  assert.equal(verificationResult.metadata.siteKey, 'fixture-site');
  assert.equal(verificationResult.metadata.responseSchemaHash, 'synthetic-response-schema-hash');
  assert.equal(verificationResult.metadata.evidenceType, 'response-schema');

  const result = verifyApiCandidateForCatalog({
    candidate,
    siteAdapterDecision: acceptedDecision,
    verificationResult,
  });
  assert.equal(result.candidate.status, 'verified');
  assert.equal(result.candidate.evidence.verification.metadata.responseSchemaHash, 'synthetic-response-schema-hash');
  assert.equal(JSON.stringify(result).includes('synthetic-api-token'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-csrf-token'), false);
});

test('response capture summary contract feeds response schema verification without catalog promotion', () => {
  const candidate = createCandidate({
    id: 'response-capture-summary-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
    endpoint: {
      method: 'GET',
      url: 'https://fixture.invalid/api/summary?access_token=synthetic-response-summary-token',
    },
  });
  const summary = createApiCandidateResponseCaptureSummary({
    candidate,
    capturedAt: '2026-05-02T03:58:00.000Z',
    response: {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
      body: {
        items: [{
          id: 'synthetic-item-id',
          title: 'Synthetic title',
        }],
        paging: {
          hasMore: false,
        },
      },
    },
    metadata: {
      captureSource: 'synthetic-network-capture',
    },
  });

  assert.equal(summary.schemaVersion, API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION);
  assert.equal(assertApiResponseCaptureSummaryCompatible(summary), true);
  assert.equal(assertSchemaCompatible('ApiResponseCaptureSummary', summary), true);
  assert.equal(summary.candidateId, 'response-capture-summary-candidate');
  assert.equal(summary.siteKey, 'fixture-site');
  assert.equal(summary.statusCode, 200);
  assert.equal(summary.contentType, 'application/json');
  assert.deepEqual(summary.headerNames, ['cache-control', 'content-type']);
  assert.equal(summary.bodyShape.type, 'object');
  assert.equal(summary.bodyShape.fields.items.type, 'array');
  assert.match(summary.responseSchemaHash, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(summary).includes('Synthetic title'), false);
  assert.equal(JSON.stringify(summary).includes('synthetic-item-id'), false);
  assert.equal(JSON.stringify(summary).includes('synthetic-response-summary-token'), false);
  assert.equal(JSON.stringify(summary).includes('"endpoint"'), false);
  assert.equal(JSON.stringify(summary).includes('"headers"'), false);

  const verificationResult = createApiCandidateResponseSchemaVerificationResultFromCaptureSummary({
    candidate,
    responseSummary: summary,
    verifierId: 'synthetic-response-capture-verifier',
    verifiedAt: '2026-05-02T03:59:00.000Z',
  });

  assert.equal(verificationResult.status, 'passed');
  assert.equal(verificationResult.verifierId, 'synthetic-response-capture-verifier');
  assert.equal(verificationResult.metadata.responseCaptureSummaryVersion, API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION);
  assert.equal(verificationResult.metadata.responseSchemaHash, summary.responseSchemaHash);
  assert.equal(verificationResult.metadata.evidenceType, 'response-schema');
  assert.equal(JSON.stringify(verificationResult).includes('Synthetic title'), false);
  assert.equal(JSON.stringify(verificationResult).includes('synthetic-item-id'), false);
  assert.equal(JSON.stringify(verificationResult).includes('synthetic-response-summary-token'), false);

  const acceptedDecision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'fixture-adapter',
    adapterVersion: 'adapter-v1',
    decision: 'accepted',
  }, { candidate });
  const verified = verifyApiCandidateForCatalog({
    candidate,
    siteAdapterDecision: acceptedDecision,
    verificationResult,
  });
  assert.equal(verified.candidate.status, 'verified');
  assert.equal(Object.hasOwn(verified.candidate, 'catalogEntry'), false);
  assert.equal(Object.hasOwn(verified.candidate, 'catalogPath'), false);
});

test('response verification result artifact writer persists response-schema evidence only', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-response-verification-result-'));
  try {
    const candidate = createCandidate({
      id: 'response-verification-result-candidate',
      siteKey: 'fixture-site',
      status: 'candidate',
    });
    const verificationResult = createApiCandidateResponseVerificationResult({
      candidate,
      verifierId: 'synthetic-response-result-writer',
      verifiedAt: '2026-05-02T05:22:00.000Z',
      responseEvidence: {
        responseSchemaHash: 'synthetic-response-result-schema-hash',
        statusCode: 200,
      },
      metadata: {
        fixture: 'synthetic-response-result',
      },
    });
    const resultPath = path.join(runDir, 'response-verification', 'result.json');
    const auditPath = path.join(runDir, 'response-verification', 'result.redaction-audit.json');

    const written = await writeApiCandidateResponseVerificationResultArtifact(verificationResult, {
      resultPath,
      redactionAuditPath: auditPath,
    });

    assert.equal(written.artifactPath, resultPath);
    assert.equal(written.redactionAuditPath, auditPath);
    const persisted = JSON.parse(await readFile(resultPath, 'utf8'));
    assert.equal(persisted.status, 'passed');
    assert.equal(persisted.metadata.evidenceType, 'response-schema');
    assert.equal(persisted.metadata.candidateId, 'response-verification-result-candidate');
    assert.equal(persisted.metadata.responseSchemaHash, 'synthetic-response-result-schema-hash');
    assert.equal(Object.hasOwn(persisted, 'candidate'), false);
    assert.equal(Object.hasOwn(persisted, 'catalogEntry'), false);
    assert.equal(Object.hasOwn(persisted, 'headers'), false);
    const audit = JSON.parse(await readFile(auditPath, 'utf8'));
    assert.equal(Array.isArray(audit.redactedPaths), true);

    const invalidPath = path.join(runDir, 'invalid', 'result.json');
    const missingAuditPath = path.join(runDir, 'missing-audit', 'result.json');
    await assert.rejects(
      () => writeApiCandidateResponseVerificationResultArtifact(verificationResult, {
        resultPath: missingAuditPath,
      }),
      /redactionAuditPath is required/u,
    );
    await assert.rejects(
      () => access(missingAuditPath),
      /ENOENT/u,
    );
    await assert.rejects(
      () => writeApiCandidateResponseVerificationResultArtifact({
        status: 'passed',
        verifierId: 'synthetic-response-result-writer',
        verifiedAt: '2026-05-02T05:22:01.000Z',
        metadata: {
          evidenceType: 'auth',
          responseSchemaHash: 'synthetic-response-result-schema-hash',
        },
      }, {
        resultPath: invalidPath,
        redactionAuditPath: path.join(runDir, 'invalid', 'result.redaction-audit.json'),
      }),
      /requires response-schema evidence/u,
    );
    await assert.rejects(
      () => access(invalidPath),
      /ENOENT/u,
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('response capture summary contract fails closed for sensitive or mismatched inputs', () => {
  const candidate = createCandidate({
    id: 'response-capture-summary-fail-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });
  assert.throws(
    () => createApiCandidateResponseCaptureSummary({
      candidate,
      response: {
        statusCode: 200,
        headers: {
          authorization: 'Bearer synthetic-response-summary-token',
        },
      },
    }),
    /headers must not contain sensitive material/u,
  );
  assert.throws(
    () => createApiCandidateResponseCaptureSummary({
      candidate,
      response: {
        statusCode: 200,
        body: {
          access_token: 'synthetic-response-summary-token',
        },
      },
    }),
    /body must not contain sensitive material/u,
  );
  const summary = createApiCandidateResponseCaptureSummary({
    candidate,
    response: {
      statusCode: 200,
      body: {
        ok: true,
      },
    },
  });
  assert.throws(
    () => createApiCandidateResponseSchemaVerificationResultFromCaptureSummary({
      candidate: createCandidate({
        id: 'other-response-candidate',
        siteKey: 'fixture-site',
        status: 'candidate',
      }),
      responseSummary: summary,
      verifierId: 'synthetic-response-capture-verifier',
      verifiedAt: '2026-05-02T04:00:00.000Z',
    }),
    /candidate boundary mismatch/u,
  );
  assert.throws(
    () => createApiCandidateResponseSchemaVerificationResultFromCaptureSummary({
      candidate,
      responseSummary: {
        ...summary,
        schemaVersion: API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION + 1,
      },
      verifierId: 'synthetic-response-capture-verifier',
      verifiedAt: '2026-05-02T04:00:00.000Z',
    }),
    /not compatible/u,
  );
});

test('response schema verification producer derives safe fixture summaries', () => {
  const candidate = createCandidate({
    id: 'response-schema-producer-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });
  const result = createApiCandidateResponseSchemaVerificationResultFromFixture({
    candidate,
    verifierId: 'synthetic-response-schema-producer',
    verifiedAt: '2026-05-02T02:06:00.000Z',
    responseFixture: {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
      },
      body: {
        items: [
          {
            id: 'synthetic-item-id',
            title: 'Synthetic title',
          },
        ],
        paging: {
          cursor: 'synthetic-cursor',
          hasMore: false,
        },
      },
    },
    metadata: {
      regressionFixture: 'synthetic-response-schema-fixture',
    },
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.verifierId, 'synthetic-response-schema-producer');
  assert.equal(result.verifiedAt, '2026-05-02T02:06:00.000Z');
  assert.equal(result.metadata.evidenceType, 'response-schema');
  assert.equal(result.metadata.candidateId, 'response-schema-producer-candidate');
  assert.match(result.metadata.responseSchemaHash, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(result.metadata.responseFieldSummary.type, 'object');
  assert.equal(result.metadata.responseFieldSummary.fields.items.type, 'array');
  assert.equal(result.metadata.responseFieldSummary.fields.paging.fields.hasMore.type, 'boolean');

  const reordered = createApiCandidateResponseSchemaVerificationResultFromFixture({
    candidate,
    verifierId: 'synthetic-response-schema-producer',
    verifiedAt: '2026-05-02T02:06:00.000Z',
    responseFixture: {
      body: {
        paging: {
          hasMore: false,
          cursor: 'different-synthetic-cursor-value',
        },
        items: [
          {
            title: 'Different synthetic title',
            id: 'different-synthetic-item-id',
          },
        ],
      },
      statusCode: 200,
    },
  });
  assert.equal(reordered.metadata.responseSchemaHash, result.metadata.responseSchemaHash);
  assert.equal(JSON.stringify(result).includes('synthetic-api-token'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-csrf-token'), false);
});

test('response schema verification producer fails closed for unsafe fixtures', () => {
  const candidate = createCandidate({
    id: 'response-schema-producer-fail-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });
  assert.throws(
    () => createApiCandidateResponseSchemaVerificationResultFromFixture({
      candidate,
      verifierId: 'synthetic-response-schema-producer',
      verifiedAt: '2026-05-02T02:07:00.000Z',
      responseFixture: {
        body: {
          items: [],
        },
      },
    }),
    /statusCode must be an HTTP status code/u,
  );
  assert.throws(
    () => createApiCandidateResponseSchemaVerificationResultFromFixture({
      candidate,
      verifierId: 'synthetic-response-schema-producer',
      verifiedAt: '2026-05-02T02:07:00.000Z',
      responseFixture: {
        statusCode: 200,
      },
    }),
    /body is required/u,
  );
  assert.throws(
    () => createApiCandidateResponseSchemaVerificationResultFromFixture({
      candidate,
      verifierId: 'synthetic-response-schema-producer',
      verifiedAt: '2026-05-02T02:07:00.000Z',
      responseFixture: {
        statusCode: 200,
        headers: {
          authorization: 'Bearer synthetic-response-schema-producer-token',
        },
        body: {
          items: [],
        },
      },
    }),
    /response schema fixture must not contain sensitive material/u,
  );
  assert.throws(
    () => createApiCandidateResponseSchemaVerificationResultFromFixture({
      candidate,
      verifierId: 'synthetic-response-schema-producer',
      verifiedAt: '2026-05-02T02:07:00.000Z',
      responseFixture: {
        statusCode: 200,
        body: {
          csrf: 'synthetic-response-schema-producer-csrf',
        },
      },
    }),
    /response schema fixture must not contain sensitive material/u,
  );
});

test('response schema verification result fails closed for missing or sensitive evidence', () => {
  const candidate = createCandidate({
    id: 'response-schema-verification-fail-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });
  const acceptedDecision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'fixture-adapter',
    decision: 'accepted',
  }, { candidate });

  assert.throws(
    () => createApiCandidateResponseVerificationResult({
      candidate,
      verifiedAt: '2026-05-02T01:06:00.000Z',
      responseEvidence: {
        responseSchemaHash: 'synthetic-response-schema-hash',
      },
    }),
    /verifierId is required/u,
  );
  assert.throws(
    () => createApiCandidateResponseVerificationResult({
      candidate,
      verifierId: 'synthetic-response-schema-verifier',
      responseEvidence: {
        responseSchemaHash: 'synthetic-response-schema-hash',
      },
    }),
    /verifiedAt is required/u,
  );
  assert.throws(
    () => createApiCandidateResponseVerificationResult({
      candidate,
      verifierId: 'synthetic-response-schema-verifier',
      verifiedAt: '2026-05-02T01:06:00.000Z',
      responseEvidence: {
        statusCode: 200,
      },
    }),
    /responseSchemaHash is required/u,
  );
  assert.throws(
    () => createApiCandidateResponseVerificationResult({
      candidate,
      verifierId: 'synthetic-response-schema-verifier',
      verifiedAt: '2026-05-02T01:06:00.000Z',
      responseEvidence: {
        responseSchemaHash: 'synthetic-response-schema-hash',
        headers: {
          authorization: 'Bearer synthetic-response-token',
        },
      },
    }),
    /response verification evidence must not contain sensitive material/u,
  );
  assert.throws(
    () => createApiCandidateResponseVerificationResult({
      candidate,
      verifierId: 'synthetic-response-schema-verifier',
      verifiedAt: '2026-05-02T01:06:00.000Z',
      responseEvidence: {
        responseSchemaHash: 'synthetic-response-schema-hash',
      },
      metadata: {
        csrf: 'synthetic-response-metadata-csrf',
      },
    }),
    /response verification metadata must not contain sensitive material/u,
  );

  const failed = createApiCandidateResponseVerificationResult({
    candidate,
    verifierId: 'synthetic-response-schema-verifier',
    verifiedAt: '2026-05-02T01:06:00.000Z',
    passed: false,
    reasonCode: 'api-verification-failed',
    responseEvidence: {},
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.reasonCode, 'api-verification-failed');
  assert.deepEqual(reasonCodeSummary(failed.reasonCode), {
    code: 'api-verification-failed',
    family: 'api',
    retryable: true,
    cooldownNeeded: false,
    isolationNeeded: false,
    manualRecoveryNeeded: false,
    degradable: false,
    artifactWriteAllowed: true,
    catalogAction: 'deprecate',
  });
  assert.throws(
    () => verifyApiCandidateForCatalog({
      candidate,
      siteAdapterDecision: acceptedDecision,
      verificationResult: failed,
    }),
    /verification result must be passed/u,
  );
});

test('auth and CSRF verification result feeds verified evidence producer', () => {
  const candidate = createCandidate({
    id: 'auth-csrf-verification-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });
  const acceptedDecision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'fixture-adapter',
    adapterVersion: 'adapter-v1',
    decision: 'accepted',
  }, { candidate });
  const verificationResult = createApiCandidateAuthVerificationResult({
    candidate,
    verifierId: 'synthetic-auth-csrf-verifier',
    verifiedAt: '2026-05-02T01:25:00.000Z',
    authEvidence: {
      authRequirement: 'session-view',
      requestProtectionRequirement: 'checked-redacted-request-protection',
      permission: 'read',
    },
    metadata: {
      regressionFixture: 'synthetic-auth-csrf-fixture',
    },
  });

  assert.equal(verificationResult.status, 'passed');
  assert.equal(verificationResult.verifierId, 'synthetic-auth-csrf-verifier');
  assert.equal(verificationResult.metadata.candidateId, 'auth-csrf-verification-candidate');
  assert.equal(verificationResult.metadata.siteKey, 'fixture-site');
  assert.equal(verificationResult.metadata.authRequirement, 'session-view');
  assert.equal(
    verificationResult.metadata.requestProtectionRequirement,
    'checked-redacted-request-protection',
  );
  assert.equal(verificationResult.metadata.evidenceType, 'auth-csrf');

  const result = verifyApiCandidateForCatalog({
    candidate,
    siteAdapterDecision: acceptedDecision,
    verificationResult,
  });
  assert.equal(result.candidate.status, 'verified');
  assert.equal(result.candidate.evidence.verification.metadata.authRequirement, 'session-view');
  assert.equal(
    result.candidate.evidence.verification.metadata.requestProtectionRequirement,
    'checked-redacted-request-protection',
  );
  assert.equal(JSON.stringify(result).includes('synthetic-api-token'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-csrf-token'), false);
});

test('auth and CSRF verification producer derives safe fixture summaries', () => {
  const candidate = createCandidate({
    id: 'auth-csrf-producer-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });
  const result = createApiCandidateAuthVerificationResultFromFixture({
    candidate,
    verifierId: 'synthetic-auth-csrf-producer',
    verifiedAt: '2026-05-02T02:13:00.000Z',
    authFixture: {
      requiresSessionView: true,
      requestProtectionRequirement: 'checked-redacted-request-protection',
      permission: 'read',
    },
    metadata: {
      regressionFixture: 'synthetic-auth-csrf-producer-fixture',
    },
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.verifierId, 'synthetic-auth-csrf-producer');
  assert.equal(result.metadata.evidenceType, 'auth-csrf');
  assert.equal(result.metadata.candidateId, 'auth-csrf-producer-candidate');
  assert.equal(result.metadata.siteKey, 'fixture-site');
  assert.equal(result.metadata.authRequirement, 'session-view');
  assert.equal(
    result.metadata.requestProtectionRequirement,
    'checked-redacted-request-protection',
  );
  assert.equal(Object.hasOwn(result.metadata, 'request'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-api-token'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-csrf-token'), false);
});

test('auth and CSRF verification producer fails closed for unsafe fixtures', () => {
  const candidate = createCandidate({
    id: 'auth-csrf-producer-fail-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });
  assert.throws(
    () => createApiCandidateAuthVerificationResultFromFixture({
      candidate,
      verifierId: 'synthetic-auth-csrf-producer',
      verifiedAt: '2026-05-02T02:14:00.000Z',
      authFixture: {
        requestProtectionRequirement: 'checked-redacted-request-protection',
      },
    }),
    /authRequirement is required/u,
  );
  assert.throws(
    () => createApiCandidateAuthVerificationResultFromFixture({
      candidate,
      verifierId: 'synthetic-auth-csrf-producer',
      verifiedAt: '2026-05-02T02:14:00.000Z',
      authFixture: {
        requiresSessionView: true,
        request: {
          headers: {
            cookie: 'sessionid=synthetic-auth-producer-cookie',
          },
        },
      },
    }),
    /auth verification fixture must not contain sensitive material/u,
  );
  assert.throws(
    () => createApiCandidateAuthVerificationResultFromFixture({
      candidate,
      verifierId: 'synthetic-auth-csrf-producer',
      verifiedAt: '2026-05-02T02:14:00.000Z',
      authFixture: {
        authRequirement: 'session-view',
        request: {
          query: {
            csrf: 'synthetic-auth-producer-csrf',
          },
        },
      },
    }),
    /auth verification fixture must not contain sensitive material/u,
  );
  assert.throws(
    () => createApiCandidateAuthVerificationResultFromFixture({
      candidate,
      verifierId: 'synthetic-auth-csrf-producer',
      verifiedAt: '2026-05-02T02:14:00.000Z',
      authFixture: {
        authRequirement: 'session-view',
        request: {
          body: {
            accessToken: 'synthetic-auth-producer-token',
          },
        },
      },
    }),
    /auth verification fixture must not contain sensitive material/u,
  );
});

test('auth and CSRF verification result fails closed for missing or sensitive evidence', () => {
  const candidate = createCandidate({
    id: 'auth-csrf-verification-fail-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });

  assert.throws(
    () => createApiCandidateAuthVerificationResult({
      candidate,
      verifiedAt: '2026-05-02T01:26:00.000Z',
      authEvidence: {
        authRequirement: 'session-view',
      },
    }),
    /verifierId is required/u,
  );
  assert.throws(
    () => createApiCandidateAuthVerificationResult({
      candidate,
      verifierId: 'synthetic-auth-csrf-verifier',
      authEvidence: {
        authRequirement: 'session-view',
      },
    }),
    /verifiedAt is required/u,
  );
  assert.throws(
    () => createApiCandidateAuthVerificationResult({
      candidate,
      verifierId: 'synthetic-auth-csrf-verifier',
      verifiedAt: '2026-05-02T01:26:00.000Z',
      authEvidence: {
        permission: 'read',
      },
    }),
    /authRequirement is required/u,
  );
  assert.throws(
    () => createApiCandidateAuthVerificationResult({
      candidate,
      verifierId: 'synthetic-auth-csrf-verifier',
      verifiedAt: '2026-05-02T01:26:00.000Z',
      authEvidence: {
        authRequirement: 'session-view',
        headers: {
          cookie: 'sessionid=synthetic-auth-cookie',
        },
      },
    }),
    /auth verification evidence must not contain sensitive material/u,
  );
  assert.throws(
    () => createApiCandidateAuthVerificationResult({
      candidate,
      verifierId: 'synthetic-auth-csrf-verifier',
      verifiedAt: '2026-05-02T01:26:00.000Z',
      authEvidence: {
        authRequirement: 'session-view',
      },
      metadata: {
        authorization: 'Bearer synthetic-auth-metadata-token',
      },
    }),
    /auth verification metadata must not contain sensitive material/u,
  );

  const failed = createApiCandidateAuthVerificationResult({
    candidate,
    verifierId: 'synthetic-auth-csrf-verifier',
    verifiedAt: '2026-05-02T01:26:00.000Z',
    passed: false,
    reasonCode: 'api-auth-verification-failed',
    authEvidence: {
      permission: 'read',
    },
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.reasonCode, 'api-auth-verification-failed');
  assert.deepEqual(reasonCodeSummary(failed.reasonCode), {
    code: 'api-auth-verification-failed',
    family: 'api',
    retryable: true,
    cooldownNeeded: false,
    isolationNeeded: false,
    manualRecoveryNeeded: false,
    degradable: false,
    artifactWriteAllowed: true,
    catalogAction: 'deprecate',
  });
  assert.throws(
    () => verifyApiCandidateForCatalog({
      candidate,
      siteAdapterDecision: normalizeSiteAdapterCandidateDecision({
        adapterId: 'fixture-adapter',
        decision: 'accepted',
      }, { candidate }),
      verificationResult: failed,
    }),
    /api-auth-verification-failed/u,
  );
});

test('pagination verification result feeds verified evidence producer', () => {
  const candidate = createCandidate({
    id: 'pagination-verification-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });
  const acceptedDecision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'fixture-adapter',
    adapterVersion: 'adapter-v1',
    decision: 'accepted',
  }, { candidate });
  const verificationResult = createApiCandidatePaginationVerificationResult({
    candidate,
    verifierId: 'synthetic-pagination-verifier',
    verifiedAt: '2026-05-02T01:35:00.000Z',
    paginationEvidence: {
      paginationModel: 'cursor',
      pageSize: 20,
      stopCondition: 'empty-page',
    },
    metadata: {
      regressionFixture: 'synthetic-pagination-fixture',
    },
  });

  assert.equal(verificationResult.status, 'passed');
  assert.equal(verificationResult.verifierId, 'synthetic-pagination-verifier');
  assert.equal(verificationResult.metadata.candidateId, 'pagination-verification-candidate');
  assert.equal(verificationResult.metadata.siteKey, 'fixture-site');
  assert.equal(verificationResult.metadata.paginationModel, 'cursor');
  assert.equal(verificationResult.metadata.evidenceType, 'pagination');

  const result = verifyApiCandidateForCatalog({
    candidate,
    siteAdapterDecision: acceptedDecision,
    verificationResult,
  });
  assert.equal(result.candidate.status, 'verified');
  assert.equal(result.candidate.evidence.verification.metadata.paginationModel, 'cursor');
  assert.equal(JSON.stringify(result).includes('synthetic-api-token'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-csrf-token'), false);
});

test('pagination verification producer derives safe fixture summaries', () => {
  const candidate = createCandidate({
    id: 'pagination-producer-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });
  const result = createApiCandidatePaginationVerificationResultFromFixture({
    candidate,
    verifierId: 'synthetic-pagination-producer',
    verifiedAt: '2026-05-02T02:20:00.000Z',
    paginationFixture: {
      paginationModel: 'cursor',
      pageSize: 20,
      stopCondition: 'empty-page',
    },
    metadata: {
      regressionFixture: 'synthetic-pagination-producer-fixture',
    },
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.verifierId, 'synthetic-pagination-producer');
  assert.equal(result.metadata.evidenceType, 'pagination');
  assert.equal(result.metadata.candidateId, 'pagination-producer-candidate');
  assert.equal(result.metadata.siteKey, 'fixture-site');
  assert.equal(result.metadata.paginationModel, 'cursor');
  assert.equal(result.metadata.pageSize, 20);
  assert.equal(result.metadata.stopCondition, 'empty-page');
  assert.equal(Object.hasOwn(result.metadata, 'request'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-api-token'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-csrf-token'), false);
});

test('pagination verification producer fails closed for unsafe fixtures', () => {
  const candidate = createCandidate({
    id: 'pagination-producer-fail-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });
  assert.throws(
    () => createApiCandidatePaginationVerificationResultFromFixture({
      candidate,
      verifierId: 'synthetic-pagination-producer',
      verifiedAt: '2026-05-02T02:21:00.000Z',
      paginationFixture: {
        pageSize: 20,
      },
    }),
    /paginationModel is required/u,
  );
  assert.throws(
    () => createApiCandidatePaginationVerificationResultFromFixture({
      candidate,
      verifierId: 'synthetic-pagination-producer',
      verifiedAt: '2026-05-02T02:21:00.000Z',
      paginationFixture: {
        paginationModel: 'cursor',
        request: {
          headers: {
            authorization: 'Bearer synthetic-pagination-producer-token',
          },
        },
      },
    }),
    /pagination verification fixture must not contain sensitive material/u,
  );
  assert.throws(
    () => createApiCandidatePaginationVerificationResultFromFixture({
      candidate,
      verifierId: 'synthetic-pagination-producer',
      verifiedAt: '2026-05-02T02:21:00.000Z',
      paginationFixture: {
        paginationModel: 'cursor',
        request: {
          query: {
            access_token: 'synthetic-pagination-producer-token',
          },
        },
      },
    }),
    /pagination verification fixture must not contain sensitive material/u,
  );
  assert.throws(
    () => createApiCandidatePaginationVerificationResultFromFixture({
      candidate,
      verifierId: 'synthetic-pagination-producer',
      verifiedAt: '2026-05-02T02:21:00.000Z',
      paginationFixture: {
        paginationModel: 'cursor',
        request: {
          body: {
            csrf: 'synthetic-pagination-producer-csrf',
          },
        },
      },
    }),
    /pagination verification fixture must not contain sensitive material/u,
  );
});

test('pagination verification result fails closed for missing or sensitive evidence', () => {
  const candidate = createCandidate({
    id: 'pagination-verification-fail-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });

  assert.throws(
    () => createApiCandidatePaginationVerificationResult({
      candidate,
      verifiedAt: '2026-05-02T01:36:00.000Z',
      paginationEvidence: {
        paginationModel: 'cursor',
      },
    }),
    /verifierId is required/u,
  );
  assert.throws(
    () => createApiCandidatePaginationVerificationResult({
      candidate,
      verifierId: 'synthetic-pagination-verifier',
      paginationEvidence: {
        paginationModel: 'cursor',
      },
    }),
    /verifiedAt is required/u,
  );
  assert.throws(
    () => createApiCandidatePaginationVerificationResult({
      candidate,
      verifierId: 'synthetic-pagination-verifier',
      verifiedAt: '2026-05-02T01:36:00.000Z',
      paginationEvidence: {
        pageSize: 20,
      },
    }),
    /paginationModel is required/u,
  );
  assert.throws(
    () => createApiCandidatePaginationVerificationResult({
      candidate,
      verifierId: 'synthetic-pagination-verifier',
      verifiedAt: '2026-05-02T01:36:00.000Z',
      paginationEvidence: {
        paginationModel: 'cursor',
        nextUrl: 'https://example.invalid/api/items?access_token=synthetic-pagination-token',
      },
    }),
    /pagination verification evidence must not contain sensitive material/u,
  );
  assert.throws(
    () => createApiCandidatePaginationVerificationResult({
      candidate,
      verifierId: 'synthetic-pagination-verifier',
      verifiedAt: '2026-05-02T01:36:00.000Z',
      paginationEvidence: {
        paginationModel: 'cursor',
      },
      metadata: {
        sessionId: 'synthetic-pagination-session-id',
      },
    }),
    /pagination verification metadata must not contain sensitive material/u,
  );

  const failed = createApiCandidatePaginationVerificationResult({
    candidate,
    verifierId: 'synthetic-pagination-verifier',
    verifiedAt: '2026-05-02T01:36:00.000Z',
    passed: false,
    reasonCode: 'api-pagination-verification-failed',
    paginationEvidence: {
      pageSize: 20,
    },
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.reasonCode, 'api-pagination-verification-failed');
  assert.deepEqual(reasonCodeSummary(failed.reasonCode), {
    code: 'api-pagination-verification-failed',
    family: 'api',
    retryable: true,
    cooldownNeeded: false,
    isolationNeeded: false,
    manualRecoveryNeeded: false,
    degradable: false,
    artifactWriteAllowed: true,
    catalogAction: 'deprecate',
  });
  assert.throws(
    () => verifyApiCandidateForCatalog({
      candidate,
      siteAdapterDecision: normalizeSiteAdapterCandidateDecision({
        adapterId: 'fixture-adapter',
        decision: 'accepted',
      }, { candidate }),
      verificationResult: failed,
    }),
    /api-pagination-verification-failed/u,
  );
});

test('risk verification result feeds verified evidence producer', () => {
  const candidate = createCandidate({
    id: 'risk-verification-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });
  const acceptedDecision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'fixture-adapter',
    adapterVersion: 'adapter-v1',
    decision: 'accepted',
  }, { candidate });
  const verificationResult = createApiCandidateRiskVerificationResult({
    candidate,
    verifierId: 'synthetic-risk-verifier',
    verifiedAt: '2026-05-02T01:50:00.000Z',
    riskEvidence: {
      riskState: 'normal',
      riskLevel: 'low',
      retryAllowed: true,
    },
    metadata: {
      regressionFixture: 'synthetic-risk-fixture',
    },
  });

  assert.equal(verificationResult.status, 'passed');
  assert.equal(verificationResult.verifierId, 'synthetic-risk-verifier');
  assert.equal(verificationResult.metadata.candidateId, 'risk-verification-candidate');
  assert.equal(verificationResult.metadata.siteKey, 'fixture-site');
  assert.equal(verificationResult.metadata.riskState, 'normal');
  assert.equal(verificationResult.metadata.riskLevel, 'low');
  assert.equal(verificationResult.metadata.evidenceType, 'risk');

  const result = verifyApiCandidateForCatalog({
    candidate,
    siteAdapterDecision: acceptedDecision,
    verificationResult,
  });
  assert.equal(result.candidate.status, 'verified');
  assert.equal(result.candidate.evidence.verification.metadata.riskState, 'normal');
  assert.equal(result.candidate.evidence.verification.metadata.riskLevel, 'low');
  assert.equal(JSON.stringify(result).includes('synthetic-api-token'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-csrf-token'), false);
});

test('risk verification producer derives safe fixture summaries', () => {
  const candidate = createCandidate({
    id: 'risk-producer-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });
  const verificationResult = createApiCandidateRiskVerificationResultFromFixture({
    candidate,
    verifierId: 'synthetic-risk-fixture-verifier',
    verifiedAt: '2026-05-02T02:35:00.000Z',
    riskFixture: {
      state: 'normal',
      level: 'low',
      signalType: 'none',
      action: 'continue',
    },
    metadata: {
      regressionFixture: 'synthetic-risk-summary',
    },
  });

  assert.equal(verificationResult.status, 'passed');
  assert.equal(verificationResult.verifierId, 'synthetic-risk-fixture-verifier');
  assert.equal(verificationResult.metadata.evidenceType, 'risk');
  assert.equal(verificationResult.metadata.candidateId, 'risk-producer-candidate');
  assert.equal(verificationResult.metadata.siteKey, 'fixture-site');
  assert.equal(verificationResult.metadata.riskState, 'normal');
  assert.equal(verificationResult.metadata.riskLevel, 'low');
  assert.equal(verificationResult.metadata.riskSignal, 'none');
  assert.equal(verificationResult.metadata.recommendedAction, 'continue');
  assert.equal(Object.hasOwn(verificationResult.metadata, 'request'), false);
  assert.equal(JSON.stringify(verificationResult).includes('synthetic-api-token'), false);
  assert.equal(JSON.stringify(verificationResult).includes('synthetic-csrf-token'), false);
});

test('risk verification producer fails closed for unsafe fixtures', () => {
  const candidate = createCandidate({
    id: 'risk-producer-fail-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });

  assert.throws(
    () => createApiCandidateRiskVerificationResultFromFixture({
      candidate,
      verifierId: 'synthetic-risk-fixture-verifier',
      verifiedAt: '2026-05-02T02:36:00.000Z',
      riskFixture: {
        level: 'low',
      },
    }),
    /riskState is required/u,
  );
  assert.throws(
    () => createApiCandidateRiskVerificationResultFromFixture({
      candidate,
      verifierId: 'synthetic-risk-fixture-verifier',
      verifiedAt: '2026-05-02T02:36:00.000Z',
      riskFixture: {
        state: 'normal',
        request: {
          headers: {
            authorization: 'Bearer synthetic-risk-token',
          },
        },
      },
    }),
    /risk verification fixture must not contain sensitive material/u,
  );
  assert.throws(
    () => createApiCandidateRiskVerificationResultFromFixture({
      candidate,
      verifierId: 'synthetic-risk-fixture-verifier',
      verifiedAt: '2026-05-02T02:36:00.000Z',
      riskFixture: {
        state: 'normal',
        request: {
          query: {
            access_token: 'synthetic-risk-query-token',
          },
        },
      },
    }),
    /risk verification fixture must not contain sensitive material/u,
  );
  assert.throws(
    () => createApiCandidateRiskVerificationResultFromFixture({
      candidate,
      verifierId: 'synthetic-risk-fixture-verifier',
      verifiedAt: '2026-05-02T02:36:00.000Z',
      riskFixture: {
        state: 'normal',
        request: {
          body: {
            csrf: 'synthetic-risk-csrf',
          },
        },
      },
    }),
    /risk verification fixture must not contain sensitive material/u,
  );
});

test('risk verification result fails closed for missing or sensitive evidence', () => {
  const candidate = createCandidate({
    id: 'risk-verification-fail-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });

  assert.throws(
    () => createApiCandidateRiskVerificationResult({
      candidate,
      verifiedAt: '2026-05-02T01:51:00.000Z',
      riskEvidence: {
        riskState: 'normal',
      },
    }),
    /verifierId is required/u,
  );
  assert.throws(
    () => createApiCandidateRiskVerificationResult({
      candidate,
      verifierId: 'synthetic-risk-verifier',
      riskEvidence: {
        riskState: 'normal',
      },
    }),
    /verifiedAt is required/u,
  );
  assert.throws(
    () => createApiCandidateRiskVerificationResult({
      candidate,
      verifierId: 'synthetic-risk-verifier',
      verifiedAt: '2026-05-02T01:51:00.000Z',
      riskEvidence: {
        riskLevel: 'low',
      },
    }),
    /riskState is required/u,
  );
  assert.throws(
    () => createApiCandidateRiskVerificationResult({
      candidate,
      verifierId: 'synthetic-risk-verifier',
      verifiedAt: '2026-05-02T01:51:00.000Z',
      riskEvidence: {
        riskState: 'normal',
        diagnosticUrl: 'https://example.invalid/risk?session_id=synthetic-risk-session',
      },
    }),
    /risk verification evidence must not contain sensitive material/u,
  );
  assert.throws(
    () => createApiCandidateRiskVerificationResult({
      candidate,
      verifierId: 'synthetic-risk-verifier',
      verifiedAt: '2026-05-02T01:51:00.000Z',
      riskEvidence: {
        riskState: 'normal',
      },
      metadata: {
        browserProfile: 'synthetic-profile-id',
      },
    }),
    /risk verification metadata must not contain sensitive material/u,
  );

  const failed = createApiCandidateRiskVerificationResult({
    candidate,
    verifierId: 'synthetic-risk-verifier',
    verifiedAt: '2026-05-02T01:51:00.000Z',
    passed: false,
    reasonCode: 'api-risk-verification-failed',
    riskEvidence: {
      riskLevel: 'high',
    },
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.reasonCode, 'api-risk-verification-failed');
  assert.deepEqual(reasonCodeSummary(failed.reasonCode), {
    code: 'api-risk-verification-failed',
    family: 'api',
    retryable: true,
    cooldownNeeded: false,
    isolationNeeded: false,
    manualRecoveryNeeded: false,
    degradable: false,
    artifactWriteAllowed: true,
    catalogAction: 'deprecate',
  });
  assert.throws(
    () => verifyApiCandidateForCatalog({
      candidate,
      siteAdapterDecision: normalizeSiteAdapterCandidateDecision({
        adapterId: 'fixture-adapter',
        decision: 'accepted',
      }, { candidate }),
      verificationResult: failed,
    }),
    /api-risk-verification-failed/u,
  );
});

test('multi-aspect verification producer composes safe fixture summaries', () => {
  const candidate = createCandidate({
    id: 'multi-aspect-fixture-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });
  const result = createApiCandidateMultiAspectVerificationResultFromFixtures({
    candidate,
    verifierId: 'synthetic-multi-aspect-fixture-verifier',
    verifiedAt: '2026-05-02T02:45:00.000Z',
    responseFixture: {
      statusCode: 200,
      body: {
        items: [
          {
            id: 'synthetic-multi-aspect-response-id',
            title: 'Synthetic multi-aspect response title',
          },
        ],
        paging: {
          cursor: 'synthetic-multi-aspect-cursor',
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
    metadata: {
      regressionFixture: 'synthetic-multi-aspect-fixture',
    },
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.verifierId, 'synthetic-multi-aspect-fixture-verifier');
  assert.equal(result.metadata.evidenceType, 'multi-aspect');
  assert.equal(result.metadata.candidateId, 'multi-aspect-fixture-candidate');
  assert.match(result.metadata.aspects.responseSchemaHash, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(result.metadata.aspects.authRequirement, 'session-view');
  assert.equal(
    result.metadata.aspects.requestProtectionRequirement,
    'checked-redacted-request-protection',
  );
  assert.equal(result.metadata.aspects.paginationModel, 'cursor');
  assert.equal(result.metadata.aspects.riskState, 'normal');
  assert.equal(result.metadata.aspects.riskLevel, 'low');
  assert.equal(result.metadata.aspectVerifierIds.responseSchema, 'synthetic-multi-aspect-fixture-verifier-response');
  assert.equal(result.metadata.aspectVerifierIds.auth, 'synthetic-multi-aspect-fixture-verifier-auth');
  assert.equal(result.metadata.aspectVerifierIds.pagination, 'synthetic-multi-aspect-fixture-verifier-pagination');
  assert.equal(result.metadata.aspectVerifierIds.risk, 'synthetic-multi-aspect-fixture-verifier-risk');
  assert.equal(Object.hasOwn(result.metadata.aspects, 'responseBody'), false);
  assert.equal(JSON.stringify(result).includes('Synthetic multi-aspect response title'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-multi-aspect-cursor'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-api-token'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-csrf-token'), false);
});

test('multi-aspect verification producer fails closed for unsafe fixtures', () => {
  const candidate = createCandidate({
    id: 'multi-aspect-fixture-fail-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });
  const base = {
    candidate,
    verifierId: 'synthetic-multi-aspect-fixture-verifier',
    verifiedAt: '2026-05-02T02:46:00.000Z',
    responseFixture: {
      statusCode: 200,
      body: {
        items: [],
      },
    },
    authFixture: {
      authRequirement: 'session-view',
    },
    paginationFixture: {
      paginationModel: 'cursor',
    },
    riskFixture: {
      state: 'normal',
    },
  };

  assert.throws(
    () => createApiCandidateMultiAspectVerificationResultFromFixtures({
      ...base,
      responseFixture: {
        statusCode: 200,
        body: {
          csrf: 'synthetic-multi-aspect-csrf',
        },
      },
    }),
    /response schema fixture must not contain sensitive material/u,
  );
  assert.throws(
    () => createApiCandidateMultiAspectVerificationResultFromFixtures({
      ...base,
      authFixture: {
        request: {
          headers: {
            authorization: 'Bearer synthetic-multi-aspect-token',
          },
        },
      },
    }),
    /auth verification fixture must not contain sensitive material/u,
  );
  assert.throws(
    () => createApiCandidateMultiAspectVerificationResultFromFixtures({
      ...base,
      paginationFixture: {
        paginationModel: 'cursor',
        request: {
          query: {
            access_token: 'synthetic-multi-aspect-query-token',
          },
        },
      },
    }),
    /pagination verification fixture must not contain sensitive material/u,
  );
  assert.throws(
    () => createApiCandidateMultiAspectVerificationResultFromFixtures({
      ...base,
      riskFixture: {
        state: 'normal',
        request: {
          body: {
            csrf: 'synthetic-multi-aspect-risk-csrf',
          },
        },
      },
    }),
    /risk verification fixture must not contain sensitive material/u,
  );
});

test('multi-aspect verification result requires all endpoint verification aspects', () => {
  const candidate = createCandidate({
    id: 'multi-aspect-verification-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });
  const acceptedDecision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'fixture-adapter',
    adapterVersion: 'adapter-v1',
    decision: 'accepted',
  }, { candidate });
  const responseSchema = createApiCandidateResponseVerificationResult({
    candidate,
    verifierId: 'synthetic-response-schema-verifier',
    verifiedAt: '2026-05-02T02:00:00.000Z',
    responseEvidence: {
      responseSchemaHash: 'synthetic-multi-aspect-schema-hash',
    },
  });
  const auth = createApiCandidateAuthVerificationResult({
    candidate,
    verifierId: 'synthetic-auth-verifier',
    verifiedAt: '2026-05-02T02:00:01.000Z',
    authEvidence: {
      authRequirement: 'session-view',
      requestProtectionRequirement: 'checked-redacted-request-protection',
    },
  });
  const pagination = createApiCandidatePaginationVerificationResult({
    candidate,
    verifierId: 'synthetic-pagination-verifier',
    verifiedAt: '2026-05-02T02:00:02.000Z',
    paginationEvidence: {
      paginationModel: 'cursor',
    },
  });
  const risk = createApiCandidateRiskVerificationResult({
    candidate,
    verifierId: 'synthetic-risk-verifier',
    verifiedAt: '2026-05-02T02:00:03.000Z',
    riskEvidence: {
      riskState: 'normal',
      riskLevel: 'low',
    },
  });
  const verificationResult = createApiCandidateMultiAspectVerificationResult({
    candidate,
    verifierId: 'synthetic-multi-aspect-verifier',
    verifiedAt: '2026-05-02T02:00:04.000Z',
    verificationResults: {
      responseSchema,
      auth,
      pagination,
      risk,
    },
  });

  assert.equal(verificationResult.status, 'passed');
  assert.equal(verificationResult.metadata.evidenceType, 'multi-aspect');
  assert.equal(verificationResult.metadata.aspects.responseSchemaHash, 'synthetic-multi-aspect-schema-hash');
  assert.equal(verificationResult.metadata.aspects.authRequirement, 'session-view');
  assert.equal(
    verificationResult.metadata.aspects.requestProtectionRequirement,
    'checked-redacted-request-protection',
  );
  assert.equal(verificationResult.metadata.aspects.paginationModel, 'cursor');
  assert.equal(verificationResult.metadata.aspects.riskState, 'normal');
  assert.equal(verificationResult.metadata.aspectVerifierIds.risk, 'synthetic-risk-verifier');

  const result = verifyApiCandidateForCatalog({
    candidate,
    siteAdapterDecision: acceptedDecision,
    verificationResult,
  });
  assert.equal(result.candidate.status, 'verified');
  assert.equal(result.candidate.evidence.verification.metadata.evidenceType, 'multi-aspect');
  assert.equal(result.candidate.evidence.verification.metadata.aspects.paginationModel, 'cursor');
  assert.equal(JSON.stringify(result).includes('synthetic-api-token'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-csrf-token'), false);
});

test('multi-aspect verification result fails closed for incomplete or mismatched aspects', () => {
  const candidate = createCandidate({
    id: 'multi-aspect-verification-fail-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });
  const otherCandidate = createCandidate({
    id: 'multi-aspect-verification-other-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });
  const responseSchema = createApiCandidateResponseVerificationResult({
    candidate,
    verifierId: 'synthetic-response-schema-verifier',
    verifiedAt: '2026-05-02T02:01:00.000Z',
    responseEvidence: {
      responseSchemaHash: 'synthetic-multi-aspect-schema-hash',
    },
  });
  const auth = createApiCandidateAuthVerificationResult({
    candidate,
    verifierId: 'synthetic-auth-verifier',
    verifiedAt: '2026-05-02T02:01:01.000Z',
    authEvidence: {
      authRequirement: 'session-view',
    },
  });
  const pagination = createApiCandidatePaginationVerificationResult({
    candidate,
    verifierId: 'synthetic-pagination-verifier',
    verifiedAt: '2026-05-02T02:01:02.000Z',
    paginationEvidence: {
      paginationModel: 'cursor',
    },
  });
  const risk = createApiCandidateRiskVerificationResult({
    candidate,
    verifierId: 'synthetic-risk-verifier',
    verifiedAt: '2026-05-02T02:01:03.000Z',
    riskEvidence: {
      riskState: 'normal',
    },
  });
  const otherRisk = createApiCandidateRiskVerificationResult({
    candidate: otherCandidate,
    verifierId: 'synthetic-risk-verifier',
    verifiedAt: '2026-05-02T02:01:04.000Z',
    riskEvidence: {
      riskState: 'normal',
    },
  });
  const failedRisk = createApiCandidateRiskVerificationResult({
    candidate,
    verifierId: 'synthetic-risk-verifier',
    verifiedAt: '2026-05-02T02:01:05.000Z',
    passed: false,
    reasonCode: 'api-risk-verification-failed',
    riskEvidence: {},
  });

  assert.throws(
    () => createApiCandidateMultiAspectVerificationResult({
      candidate,
      verifierId: 'synthetic-multi-aspect-verifier',
      verifiedAt: '2026-05-02T02:01:06.000Z',
      verificationResults: {
        responseSchema,
        auth,
        pagination,
      },
    }),
    /verification result must be passed/u,
  );
  assert.throws(
    () => createApiCandidateMultiAspectVerificationResult({
      candidate,
      verifierId: 'synthetic-multi-aspect-verifier',
      verifiedAt: '2026-05-02T02:01:07.000Z',
      verificationResults: {
        responseSchema,
        auth,
        pagination,
        risk: failedRisk,
      },
    }),
    /api-risk-verification-failed/u,
  );
  assert.throws(
    () => createApiCandidateMultiAspectVerificationResult({
      candidate,
      verifierId: 'synthetic-multi-aspect-verifier',
      verifiedAt: '2026-05-02T02:01:08.000Z',
      verificationResults: {
        responseSchema,
        auth,
        pagination,
        risk: otherRisk,
      },
    }),
    /candidateId must match candidate/u,
  );
  assert.throws(
    () => createApiCandidateMultiAspectVerificationResult({
      candidate,
      verifierId: 'synthetic-multi-aspect-verifier',
      verifiedAt: '2026-05-02T02:01:09.000Z',
      verificationResults: {
        responseSchema,
        auth: {
          ...auth,
          metadata: {
            ...auth.metadata,
            evidenceType: 'response-schema',
          },
        },
        pagination,
        risk,
      },
    }),
    /auth evidenceType must be auth-csrf/u,
  );
  assert.throws(
    () => createApiCandidateMultiAspectVerificationResult({
      candidate,
      verifierId: 'synthetic-multi-aspect-verifier',
      verifiedAt: '2026-05-02T02:01:10.000Z',
      verificationResults: {
        responseSchema: {
          ...responseSchema,
          metadata: {
            candidateId: candidate.id,
            siteKey: candidate.siteKey,
            evidenceType: 'response-schema',
          },
        },
        auth,
        pagination,
        risk,
      },
    }),
    /responseSchema responseSchemaHash is required/u,
  );
  assert.throws(
    () => createApiCandidateMultiAspectVerificationResult({
      candidate,
      verifierId: 'synthetic-multi-aspect-verifier',
      verifiedAt: '2026-05-02T02:01:11.000Z',
      verificationResults: {
        responseSchema,
        auth: {
          ...auth,
          metadata: {
            candidateId: candidate.id,
            siteKey: candidate.siteKey,
            evidenceType: 'auth-csrf',
          },
        },
        pagination,
        risk,
      },
    }),
    /auth authRequirement is required/u,
  );
  assert.throws(
    () => createApiCandidateMultiAspectVerificationResult({
      candidate,
      verifierId: 'synthetic-multi-aspect-verifier',
      verifiedAt: '2026-05-02T02:01:12.000Z',
      verificationResults: {
        responseSchema,
        auth,
        pagination: {
          ...pagination,
          metadata: {
            candidateId: candidate.id,
            siteKey: candidate.siteKey,
            evidenceType: 'pagination',
          },
        },
        risk,
      },
    }),
    /pagination paginationModel is required/u,
  );
  assert.throws(
    () => createApiCandidateMultiAspectVerificationResult({
      candidate,
      verifierId: 'synthetic-multi-aspect-verifier',
      verifiedAt: '2026-05-02T02:01:13.000Z',
      verificationResults: {
        responseSchema,
        auth,
        pagination,
        risk: {
          ...risk,
          metadata: {
            candidateId: candidate.id,
            siteKey: candidate.siteKey,
            evidenceType: 'risk',
          },
        },
      },
    }),
    /risk riskState is required/u,
  );
});

test('verified evidence producer fails closed for missing or unsafe evidence', () => {
  const candidate = createCandidate({
    id: 'verification-producer-fail-candidate',
    siteKey: 'fixture-site',
    status: 'candidate',
  });
  const acceptedDecision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'fixture-adapter',
    decision: 'accepted',
  }, { candidate });

  assert.throws(
    () => verifyApiCandidateForCatalog({
      candidate,
      siteAdapterDecision: acceptedDecision,
      verificationResult: {
        status: 'failed',
        reasonCode: 'api-verification-failed',
        verifierId: 'synthetic-contract-verifier',
        verifiedAt: '2026-05-02T01:10:00.000Z',
      },
    }),
    /verification result must be passed/u,
  );
  assert.throws(
    () => verifyApiCandidateForCatalog({
      candidate,
      siteAdapterDecision: acceptedDecision,
      verificationResult: {
        status: 'passed',
        verifierId: 'synthetic-contract-verifier',
      },
    }),
    /verifiedAt is required/u,
  );
  assert.throws(
    () => verifyApiCandidateForCatalog({
      candidate,
      siteAdapterDecision: acceptedDecision,
      verificationResult: {
        status: 'passed',
        verifiedAt: '2026-05-02T01:10:00.000Z',
      },
    }),
    /verifierId is required/u,
  );
  assert.throws(
    () => verifyApiCandidateForCatalog({
      candidate,
      siteAdapterDecision: acceptedDecision,
      verificationResult: {
        status: 'passed',
        verifierId: 'synthetic-contract-verifier',
        verifiedAt: '2026-05-02T01:10:00.000Z',
        metadata: {
          authorization: 'Bearer synthetic-metadata-token',
        },
      },
    }),
    /metadata must not contain sensitive material/u,
  );

  const rejectedDecision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'fixture-adapter',
    decision: 'rejected',
    reasonCode: 'api-verification-failed',
  }, { candidate });
  assert.throws(
    () => verifyApiCandidateForCatalog({
      candidate,
      siteAdapterDecision: rejectedDecision,
      verificationResult: {
        status: 'passed',
        verifierId: 'synthetic-contract-verifier',
        verifiedAt: '2026-05-02T01:10:00.000Z',
      },
    }),
    /requires accepted SiteAdapter decision/u,
  );

  const alreadyVerified = createCandidate({
    id: 'verification-producer-already-verified',
    siteKey: 'fixture-site',
    status: 'verified',
  });
  const alreadyVerifiedDecision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'fixture-adapter',
    decision: 'accepted',
  }, { candidate: alreadyVerified });
  assert.throws(
    () => verifyApiCandidateForCatalog({
      candidate: alreadyVerified,
      siteAdapterDecision: alreadyVerifiedDecision,
      verificationResult: {
        status: 'passed',
        verifierId: 'synthetic-contract-verifier',
        verifiedAt: '2026-05-02T01:10:00.000Z',
      },
    }),
    /requires observed or candidate input/u,
  );
});

test('verified evidence artifact writer persists redacted evidence and lifecycle summary only', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-candidate-verification-evidence-'));
  try {
    const evidencePath = path.join(runDir, 'verification', 'evidence.json');
    const auditPath = path.join(runDir, 'verification', 'evidence.redaction-audit.json');
    const eventPath = path.join(runDir, 'events', 'api-candidate-verified.json');
    const eventAuditPath = path.join(runDir, 'events', 'api-candidate-verified.redaction-audit.json');
    const capabilityHookRegistry = createCapabilityHookRegistry([{
      id: 'fixture-api-candidate-verified-observer',
      phase: 'after_candidate_write',
      hookType: 'observer',
      subscriber: {
        name: 'fixture-api-candidate-verified-subscriber',
        modulePath: 'synthetic/api-candidate-verified-hook.mjs',
        entrypoint: 'shouldNotExecute',
        capability: 'api-candidate',
      },
      filters: {
        eventTypes: ['api.candidate.verified'],
        siteKeys: ['fixture-site'],
      },
    }]);
    const candidate = createCandidate({
      id: 'verification-evidence-writer-candidate',
      siteKey: 'fixture-site',
      status: 'candidate',
      endpoint: {
        method: 'GET',
        url: 'https://fixture.invalid/api/items?access_token=synthetic-writer-token&safe=1',
      },
      request: {
        headers: {
          authorization: 'Bearer synthetic-writer-token',
          accept: 'application/json',
        },
        body: {
          csrf: 'synthetic-writer-csrf',
          safe: true,
        },
      },
    });
    const acceptedDecision = normalizeSiteAdapterCandidateDecision({
      adapterId: 'fixture-adapter',
      adapterVersion: 'adapter-v2',
      decision: 'accepted',
      validatedAt: '2026-05-02T01:20:00.000Z',
    }, { candidate });

    const result = await writeApiCandidateVerificationEvidenceArtifact({
      candidate,
      siteAdapterDecision: acceptedDecision,
      verificationResult: {
        status: 'passed',
        verifierId: 'synthetic-runtime-verifier',
        verifiedAt: '2026-05-02T01:21:00.000Z',
        metadata: {
          fixture: 'synthetic-regression-fixture',
        },
      },
    }, {
      evidencePath,
      redactionAuditPath: auditPath,
      lifecycleEventPath: eventPath,
      lifecycleEventRedactionAuditPath: eventAuditPath,
      lifecycleEventTraceId: 'trace-verification-evidence',
      lifecycleEventCorrelationId: 'corr-verification-evidence',
      lifecycleEventTaskType: 'api-verification',
      capabilityHookRegistry,
    });

    assert.equal(result.evidence.candidate.status, 'verified');
    assert.equal(result.evidence.verification.verifierId, 'synthetic-runtime-verifier');
    assert.equal(result.evidence.candidate.request.headers.authorization, REDACTION_PLACEHOLDER);
    assert.equal(result.evidence.candidate.request.body.csrf, REDACTION_PLACEHOLDER);
    assert.equal(result.lifecycleEvent.eventType, 'api.candidate.verified');
    assert.equal(result.lifecycleEvent.traceId, 'trace-verification-evidence');
    assert.equal(result.lifecycleEvent.correlationId, 'corr-verification-evidence');
    assert.equal(result.lifecycleEvent.taskType, 'api-verification');
    assert.equal(result.lifecycleEvent.adapterVersion, 'adapter-v2');
    assert.equal(result.lifecycleEvent.details.candidateId, 'verification-evidence-writer-candidate');
    assert.equal(result.lifecycleEvent.details.verifierId, 'synthetic-runtime-verifier');
    assert.deepEqual(result.lifecycleEvent.details.capabilityHookMatches.phases, ['after_candidate_write']);
    assert.equal(result.lifecycleEvent.details.capabilityHookMatches.matchCount, 1);
    assert.deepEqual(result.lifecycleEvent.details.capabilityHookMatches.lifecycleEvent, {
      schemaVersion: 1,
      eventType: 'api.candidate.verified',
      traceId: 'trace-verification-evidence',
      correlationId: 'corr-verification-evidence',
      taskId: 'verification-evidence-writer-candidate',
      siteKey: 'fixture-site',
      taskType: 'api-verification',
      adapterVersion: 'adapter-v2',
    });
    assert.equal(Object.hasOwn(result.lifecycleEvent.details.capabilityHookMatches.lifecycleEvent, 'details'), false);
    assert.equal(
      result.lifecycleEvent.details.capabilityHookMatches.matches[0].id,
      'fixture-api-candidate-verified-observer',
    );
    assert.equal(
      result.lifecycleEvent.details.capabilityHookMatches.matches[0].subscriber.name,
      'fixture-api-candidate-verified-subscriber',
    );
    assert.equal(
      Object.hasOwn(result.lifecycleEvent.details.capabilityHookMatches.matches[0].subscriber, 'modulePath'),
      false,
    );
    assert.equal(
      Object.hasOwn(result.lifecycleEvent.details.capabilityHookMatches.matches[0].subscriber, 'entrypoint'),
      false,
    );
    assert.equal(JSON.stringify(result.lifecycleEvent.details.capabilityHookMatches).includes('synthetic-writer-token'), false);
    assert.equal(JSON.stringify(result.lifecycleEvent.details.capabilityHookMatches).includes('synthetic-writer-csrf'), false);
    assert.equal(Object.hasOwn(result.lifecycleEvent.details, 'endpoint'), false);
    assert.equal(Object.hasOwn(result.lifecycleEvent.details, 'request'), false);
    assert.equal(assertSchemaCompatible('LifecycleEvent', result.lifecycleEvent), true);

    const persistedEvidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    const persistedEvent = JSON.parse(await readFile(eventPath, 'utf8'));
    const persistedAudit = JSON.parse(await readFile(auditPath, 'utf8'));
    const persistedEventAudit = JSON.parse(await readFile(eventAuditPath, 'utf8'));
    assert.equal(persistedEvidence.candidate.status, 'verified');
    assert.equal(persistedEvent.eventType, 'api.candidate.verified');
    assert.deepEqual(persistedEvent.details.capabilityHookMatches.lifecycleEvent, {
      schemaVersion: 1,
      eventType: 'api.candidate.verified',
      traceId: 'trace-verification-evidence',
      correlationId: 'corr-verification-evidence',
      taskId: 'verification-evidence-writer-candidate',
      siteKey: 'fixture-site',
      taskType: 'api-verification',
      adapterVersion: 'adapter-v2',
    });
    assert.equal(Object.hasOwn(persistedEvent.details.capabilityHookMatches.lifecycleEvent, 'details'), false);
    assert.equal(assertSchemaCompatible('LifecycleEvent', persistedEvent), true);
    assert.equal(Object.hasOwn(persistedEvidence, 'catalogEntry'), false);
    assert.equal(Object.hasOwn(persistedEvidence, 'catalogPath'), false);
    assert.equal(JSON.stringify(persistedEvidence).includes('synthetic-writer-token'), false);
    assert.equal(JSON.stringify(persistedEvidence).includes('synthetic-writer-csrf'), false);
    assert.equal(JSON.stringify(persistedEvent).includes('synthetic-writer-token'), false);
    assert.equal(JSON.stringify(persistedEvent).includes('synthetic-writer-csrf'), false);
    assert.equal(JSON.stringify(persistedEvent).includes('api-candidate-verified-hook.mjs'), false);
    assert.equal(JSON.stringify(persistedEvent).includes('shouldNotExecute'), false);
    assert.equal(JSON.stringify(persistedEventAudit).includes('api-candidate-verified-hook.mjs'), false);
    assert.equal(JSON.stringify(persistedEventAudit).includes('shouldNotExecute'), false);
    assert.ok(Array.isArray(persistedAudit.redactedPaths));
    assert.ok(Array.isArray(persistedEventAudit.redactedPaths));

    const standaloneEvent = createApiCandidateVerificationLifecycleEvent(result.evidence, {
      traceId: 'trace-standalone-verification',
      correlationId: 'corr-standalone-verification',
    });
    assert.equal(assertSchemaCompatible('LifecycleEvent', standaloneEvent), true);
    assert.equal(standaloneEvent.details.candidateId, 'verification-evidence-writer-candidate');
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('verified evidence artifact writer fails closed without partial artifacts', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-candidate-verification-fail-'));
  try {
    const candidate = createCandidate({
      id: 'verification-evidence-fail-candidate',
      siteKey: 'fixture-site',
      status: 'candidate',
    });
    const acceptedDecision = normalizeSiteAdapterCandidateDecision({
      adapterId: 'fixture-adapter',
      decision: 'accepted',
    }, { candidate });
    const validVerificationResult = {
      status: 'passed',
      verifierId: 'synthetic-runtime-verifier',
      verifiedAt: '2026-05-02T01:30:00.000Z',
    };

    const missingAuditDir = path.join(runDir, 'missing-audit');
    const missingAuditPaths = [
      path.join(missingAuditDir, 'evidence.json'),
      path.join(missingAuditDir, 'event.json'),
      path.join(missingAuditDir, 'event.redaction-audit.json'),
    ];
    await assert.rejects(
      writeApiCandidateVerificationEvidenceArtifact({
        candidate,
        siteAdapterDecision: acceptedDecision,
        verificationResult: validVerificationResult,
      }, {
        evidencePath: missingAuditPaths[0],
        lifecycleEventPath: missingAuditPaths[1],
        lifecycleEventRedactionAuditPath: missingAuditPaths[2],
      }),
      /ApiCandidate verification redactionAuditPath is required/u,
    );
    await assertMissingFiles(missingAuditPaths);

    const partialDir = path.join(runDir, 'partial-lifecycle');
    const partialPaths = [
      path.join(partialDir, 'evidence.json'),
      path.join(partialDir, 'evidence.redaction-audit.json'),
      path.join(partialDir, 'event.json'),
    ];
    await assert.rejects(
      writeApiCandidateVerificationEvidenceArtifact({
        candidate,
        siteAdapterDecision: acceptedDecision,
        verificationResult: validVerificationResult,
      }, {
        evidencePath: partialPaths[0],
        redactionAuditPath: partialPaths[1],
        lifecycleEventPath: partialPaths[2],
      }),
      /lifecycle event and redaction audit paths must be provided together/u,
    );
    await assertMissingFiles(partialPaths);

    const sensitiveDir = path.join(runDir, 'sensitive-metadata');
    const sensitivePaths = [
      path.join(sensitiveDir, 'evidence.json'),
      path.join(sensitiveDir, 'evidence.redaction-audit.json'),
      path.join(sensitiveDir, 'event.json'),
      path.join(sensitiveDir, 'event.redaction-audit.json'),
    ];
    await assert.rejects(
      writeApiCandidateVerificationEvidenceArtifact({
        candidate,
        siteAdapterDecision: acceptedDecision,
        verificationResult: {
          status: 'passed',
          verifierId: 'synthetic-runtime-verifier',
          verifiedAt: '2026-05-02T01:30:00.000Z',
          metadata: {
            csrf: 'synthetic-sensitive-metadata-csrf',
          },
        },
      }, {
        evidencePath: sensitivePaths[0],
        redactionAuditPath: sensitivePaths[1],
        lifecycleEventPath: sensitivePaths[2],
        lifecycleEventRedactionAuditPath: sensitivePaths[3],
      }),
      /metadata must not contain sensitive material/u,
    );
    await assertMissingFiles(sensitivePaths);

    const lifecycleAuditIoDir = path.join(runDir, 'lifecycle-audit-io');
    const lifecycleAuditParentPath = path.join(lifecycleAuditIoDir, 'event-audit-parent-is-file');
    const lifecycleAuditIoPaths = [
      path.join(lifecycleAuditIoDir, 'evidence.json'),
      path.join(lifecycleAuditIoDir, 'evidence.redaction-audit.json'),
      path.join(lifecycleAuditIoDir, 'event.json'),
      path.join(lifecycleAuditParentPath, 'event.redaction-audit.json'),
    ];
    await mkdir(lifecycleAuditIoDir, { recursive: true });
    await writeFile(lifecycleAuditParentPath, 'not-a-directory', 'utf8');
    await assert.rejects(
      writeApiCandidateVerificationEvidenceArtifact({
        candidate,
        siteAdapterDecision: acceptedDecision,
        verificationResult: validVerificationResult,
      }, {
        evidencePath: lifecycleAuditIoPaths[0],
        redactionAuditPath: lifecycleAuditIoPaths[1],
        lifecycleEventPath: lifecycleAuditIoPaths[2],
        lifecycleEventRedactionAuditPath: lifecycleAuditIoPaths[3],
      }),
      (error) => {
        assert.doesNotMatch(JSON.stringify(error), /synthetic-runtime-verifier|authorization|cookie|csrf|sessionId/iu);
        return true;
      },
    );
    await assertMissingFiles(lifecycleAuditIoPaths);

    const rejectedDir = path.join(runDir, 'rejected-decision');
    const rejectedPaths = [
      path.join(rejectedDir, 'evidence.json'),
      path.join(rejectedDir, 'evidence.redaction-audit.json'),
    ];
    const rejectedDecision = normalizeSiteAdapterCandidateDecision({
      adapterId: 'fixture-adapter',
      decision: 'rejected',
      reasonCode: 'api-verification-failed',
    }, { candidate });
    await assert.rejects(
      writeApiCandidateVerificationEvidenceArtifact({
        candidate,
        siteAdapterDecision: rejectedDecision,
        verificationResult: validVerificationResult,
      }, {
        evidencePath: rejectedPaths[0],
        redactionAuditPath: rejectedPaths[1],
      }),
      /requires accepted SiteAdapter decision/u,
    );
    await assertMissingFiles(rejectedPaths);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalogEntry can only be created from a verified ApiCandidate', () => {
  const verified = createCandidate({
    id: 'candidate-1',
    status: 'verified',
    observedAt: '2026-04-30T00:00:00.000Z',
    auth: {
      authorization: 'Bearer synthetic-catalog-token',
    },
    pagination: {
      model: 'cursor',
    },
    fieldMapping: {
      itemId: '$.id',
    },
    risk: {
      level: 'low',
    },
  });

  const entry = createApiCatalogEntryFromCandidate(verified, {
    version: '2026-04-30',
    verifiedAt: '2026-04-30T01:00:00.000Z',
    lastValidatedAt: '2026-04-30T02:00:00.000Z',
  });

  assert.equal(entry.schemaVersion, API_CATALOG_ENTRY_SCHEMA_VERSION);
  assert.equal(assertApiCatalogEntryCompatible(entry), true);
  assert.equal(entry.candidateId, 'candidate-1');
  assert.equal(entry.siteKey, 'example');
  assert.equal(entry.endpoint.method, 'GET');
  assert.equal(entry.endpoint.url.includes('synthetic-api-token'), false);
  assert.equal(entry.version, '2026-04-30');
  assert.equal(entry.status, 'cataloged');
  assert.equal(entry.auth.authorization, REDACTION_PLACEHOLDER);
  assert.equal(entry.pagination.model, 'cursor');
  assert.equal(entry.fieldMapping.itemId, '$.id');
  assert.equal(entry.risk.level, 'low');
  assert.equal(entry.verifiedAt, '2026-04-30T01:00:00.000Z');
  assert.equal(entry.lastValidatedAt, '2026-04-30T02:00:00.000Z');
  assert.equal(JSON.stringify(entry).includes('synthetic-catalog-token'), false);

  assert.throws(
    () => createApiCatalogEntryFromCandidate(createCandidate({ status: 'candidate' })),
    /ApiCandidate must be verified before catalog entry/u,
  );
});

test('ApiCatalog upgrade decision contract gates catalog entry creation without writing artifacts', () => {
  const verifiedCandidate = createCandidate({
    id: 'upgrade-candidate-1',
    siteKey: 'fixture-site',
    status: 'verified',
  });
  const acceptedDecision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'fixture-adapter',
    decision: 'accepted',
  }, { candidate: verifiedCandidate });

  const allowed = createApiCatalogUpgradeDecision({
    candidate: verifiedCandidate,
    siteAdapterDecision: acceptedDecision,
    decidedAt: '2026-05-01T14:05:00.000Z',
  });

  assert.equal(allowed.contractVersion, API_CATALOG_UPGRADE_DECISION_VERSION);
  assert.equal(allowed.candidateId, 'upgrade-candidate-1');
  assert.equal(allowed.siteKey, 'fixture-site');
  assert.equal(allowed.adapterId, 'fixture-adapter');
  assert.equal(allowed.decision, 'allowed');
  assert.equal(allowed.canEnterCatalog, true);
  assert.equal(allowed.catalogAction, 'catalog');
  assert.equal(Object.hasOwn(allowed, 'artifactPath'), false);
  assert.equal(Object.hasOwn(allowed, 'catalogPath'), false);
  assert.deepEqual(allowed.requirements, {
    candidateStatus: 'verified',
    candidateVerified: true,
    siteAdapterDecision: 'accepted',
    siteAdapterAccepted: true,
    policyAllowsCatalogUpgrade: true,
  });

  const observedCandidate = createCandidate({
    id: 'upgrade-candidate-observed',
    siteKey: 'fixture-site',
    status: 'observed',
  });
  const observedDecision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'fixture-adapter',
    decision: 'accepted',
  }, { candidate: observedCandidate });
  const blockedObserved = createApiCatalogUpgradeDecision({
    candidate: observedCandidate,
    siteAdapterDecision: observedDecision,
  });
  assert.equal(blockedObserved.decision, 'blocked');
  assert.equal(blockedObserved.canEnterCatalog, false);
  assert.equal(blockedObserved.reasonCode, 'api-catalog-entry-blocked');
  assert.equal(blockedObserved.catalogAction, 'block');
  assert.equal(blockedObserved.requirements.candidateVerified, false);
  assert.throws(
    () => createApiCatalogEntryFromCandidate(observedCandidate),
    /ApiCandidate must be verified before catalog entry/u,
  );

  const rejectedDecision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'fixture-adapter',
    decision: 'rejected',
    reasonCode: 'api-verification-failed',
  }, { candidate: verifiedCandidate });
  const blockedRejected = createApiCatalogUpgradeDecision({
    candidate: verifiedCandidate,
    siteAdapterDecision: rejectedDecision,
  });
  assert.equal(blockedRejected.decision, 'blocked');
  assert.equal(blockedRejected.reasonCode, 'api-verification-failed');
  assert.equal(blockedRejected.catalogAction, 'deprecate');
  assert.equal(blockedRejected.requirements.siteAdapterAccepted, false);

  const blockedPolicy = createApiCatalogUpgradeDecision({
    candidate: verifiedCandidate,
    siteAdapterDecision: acceptedDecision,
    policy: {
      allowCatalogUpgrade: false,
      reasonCode: 'api-catalog-entry-blocked',
    },
  });
  assert.equal(blockedPolicy.decision, 'blocked');
  assert.equal(blockedPolicy.reasonCode, 'api-catalog-entry-blocked');
  assert.equal(blockedPolicy.requirements.policyAllowsCatalogUpgrade, false);

  assert.throws(
    () => createApiCatalogUpgradeDecision({
      candidate: verifiedCandidate,
      siteAdapterDecision: {
        ...acceptedDecision,
        candidateId: 'different-candidate',
      },
    }),
    /candidateId must match/u,
  );
  assert.throws(
    () => createApiCatalogUpgradeDecision({
      candidate: verifiedCandidate,
      siteAdapterDecision: acceptedDecision,
      policy: {
        allowCatalogUpgrade: false,
        reasonCode: 'redaction-failed',
      },
    }),
    /belongs to artifact, not api/u,
  );
  const missingCandidateVersion = { ...verifiedCandidate };
  delete missingCandidateVersion.schemaVersion;
  assert.throws(
    () => createApiCatalogUpgradeDecision({
      candidate: missingCandidateVersion,
      siteAdapterDecision: acceptedDecision,
    }),
    /ApiCandidate schemaVersion is required/u,
  );
  assert.throws(
    () => createApiCatalogUpgradeDecision({
      candidate: {
        ...verifiedCandidate,
        schemaVersion: API_CANDIDATE_SCHEMA_VERSION + 1,
      },
      siteAdapterDecision: acceptedDecision,
    }),
    /ApiCandidate schemaVersion .* not compatible/u,
  );
  assert.throws(
    () => createApiCatalogUpgradeDecision({
      candidate: verifiedCandidate,
      siteAdapterDecision: {
        ...acceptedDecision,
        contractVersion: SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION + 1,
      },
    }),
    /SiteAdapterCandidateDecision schemaVersion .* not compatible/u,
  );
  assert.throws(
    () => createApiCatalogUpgradeDecision({
      candidate: verifiedCandidate,
      siteAdapterDecision: {
        ...acceptedDecision,
        schemaVersion: SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION + 1,
      },
    }),
    /SiteAdapterCandidateDecision .* (?:not compatible|conflicts)/u,
  );
});

test('ApiCatalog upgrade fixture writer rejects non-verified candidates before artifact writes', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-upgrade-fixture-non-verified-'));
  try {
    const candidate = createCandidate({
      id: 'upgrade-fixture-candidate-status',
      siteKey: 'fixture-site',
      status: 'candidate',
    });
    const siteAdapterDecision = normalizeSiteAdapterCandidateDecision({
      adapterId: 'fixture-adapter',
      decision: 'accepted',
    }, { candidate });
    const outputPaths = [
      path.join(runDir, 'decision.json'),
      path.join(runDir, 'decision.redaction-audit.json'),
      path.join(runDir, 'catalog.json'),
      path.join(runDir, 'catalog.redaction-audit.json'),
      path.join(runDir, 'verification-event.json'),
      path.join(runDir, 'verification-event.redaction-audit.json'),
    ];
    const [
      decisionPath,
      decisionRedactionAuditPath,
      catalogPath,
      catalogRedactionAuditPath,
      verificationEventPath,
      verificationEventRedactionAuditPath,
    ] = outputPaths;

    await assert.rejects(
      writeVerifiedApiCatalogUpgradeFixtureArtifacts({
        candidate,
        siteAdapterDecision,
        policy: {
          allowCatalogUpgrade: true,
        },
        metadata: {
          version: 'fixture-api-v1',
          verifiedAt: '2026-05-01T09:00:00.000Z',
        },
      }, {
        decisionPath,
        decisionRedactionAuditPath,
        catalogPath,
        catalogRedactionAuditPath,
        verificationEventPath,
        verificationEventRedactionAuditPath,
        verificationEventTraceId: 'upgrade-fixture-trace',
        verificationEventCorrelationId: 'upgrade-fixture-correlation',
      }),
      /ApiCatalog upgrade decision does not allow catalog entry: api-catalog-entry-blocked/u,
    );

    for (const outputPath of outputPaths) {
      await assert.rejects(access(outputPath), /ENOENT/u);
    }
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('SiteAdapter catalog upgrade policy contract feeds upgrade decisions without promotion authority', () => {
  const verifiedCandidate = createCandidate({
    id: 'upgrade-policy-candidate',
    siteKey: 'fixture-site',
    status: 'verified',
  });
  const acceptedDecision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'fixture-adapter',
    decision: 'accepted',
  }, { candidate: verifiedCandidate });
  const policy = normalizeSiteAdapterCatalogUpgradePolicy({
    adapterId: 'fixture-adapter',
    allowCatalogUpgrade: true,
    decidedAt: '2026-05-01T15:05:00.000Z',
    evidence: {
      authorization: 'Bearer synthetic-upgrade-policy-token',
      sampleCount: 1,
    },
  }, {
    candidate: verifiedCandidate,
    siteAdapterDecision: acceptedDecision,
  });

  assert.equal(policy.contractVersion, SITE_ADAPTER_CATALOG_UPGRADE_POLICY_SCHEMA_VERSION);
  assert.equal(assertSiteAdapterCatalogUpgradePolicyCompatible(policy), true);
  assert.equal(policy.candidateId, 'upgrade-policy-candidate');
  assert.equal(policy.siteKey, 'fixture-site');
  assert.equal(policy.adapterId, 'fixture-adapter');
  assert.equal(policy.allowCatalogUpgrade, true);
  assert.equal(policy.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(policy, 'artifactPath'), false);
  assert.equal(Object.hasOwn(policy, 'catalogPath'), false);

  const allowed = createApiCatalogUpgradeDecision({
    candidate: verifiedCandidate,
    siteAdapterDecision: acceptedDecision,
    policy,
  });
  assert.equal(allowed.decision, 'allowed');
  assert.equal(assertApiCatalogUpgradeDecisionAllowsCatalog(allowed), allowed);
  assert.equal(allowed.requirements.policyAllowsCatalogUpgrade, true);

  const blockedPolicy = normalizeSiteAdapterCatalogUpgradePolicy({
    adapterId: 'fixture-adapter',
    allowCatalogUpgrade: false,
    reasonCode: 'api-catalog-entry-blocked',
  }, {
    candidate: verifiedCandidate,
    siteAdapterDecision: acceptedDecision,
  });
  const blocked = createApiCatalogUpgradeDecision({
    candidate: verifiedCandidate,
    siteAdapterDecision: acceptedDecision,
    policy: blockedPolicy,
  });
  assert.equal(blocked.decision, 'blocked');
  assert.equal(blocked.reasonCode, 'api-catalog-entry-blocked');
  assert.throws(
    () => assertApiCatalogUpgradeDecisionAllowsCatalog(blocked),
    /does not allow catalog entry: api-catalog-entry-blocked/u,
  );

  assert.throws(
    () => createApiCatalogUpgradeDecision({
      candidate: verifiedCandidate,
      siteAdapterDecision: acceptedDecision,
      policy: {
        ...policy,
        contractVersion: SITE_ADAPTER_CATALOG_UPGRADE_POLICY_SCHEMA_VERSION + 1,
      },
    }),
    /SiteAdapterCatalogUpgradePolicy schemaVersion .* not compatible/u,
  );
  assert.throws(
    () => assertSiteAdapterCatalogUpgradePolicyCompatible({
      ...policy,
      contractVersion: undefined,
    }),
    /SiteAdapterCatalogUpgradePolicy schemaVersion is required/u,
  );
  assert.throws(
    () => assertSiteAdapterCatalogUpgradePolicyCompatible({
      ...policy,
      contractVersion: SITE_ADAPTER_CATALOG_UPGRADE_POLICY_SCHEMA_VERSION,
      schemaVersion: SITE_ADAPTER_CATALOG_UPGRADE_POLICY_SCHEMA_VERSION + 1,
    }),
    /conflicts with schemaVersion/u,
  );
  assert.throws(
    () => normalizeSiteAdapterCatalogUpgradePolicy({
      ...policy,
      candidateId: 'different-candidate',
    }, {
      candidate: verifiedCandidate,
      siteAdapterDecision: acceptedDecision,
    }),
    /candidateId must match/u,
  );
});

test('ApiCatalog upgrade decision artifact writer redacts and fails closed without catalog promotion', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-upgrade-decision-'));
  try {
    const decisionPath = path.join(runDir, 'upgrade', 'decision.json');
    const auditPath = path.join(runDir, 'upgrade', 'decision.redaction-audit.json');
    const eventPath = path.join(runDir, 'upgrade', 'decision.lifecycle-event.json');
    const eventAuditPath = path.join(runDir, 'upgrade', 'decision.lifecycle-event.redaction-audit.json');
    const missingAuditPath = path.join(runDir, 'upgrade', 'missing-audit-decision.json');
    const blockedPath = path.join(runDir, 'upgrade', 'blocked.json');
    const blockedAuditPath = path.join(runDir, 'upgrade', 'blocked.redaction-audit.json');
    const futurePath = path.join(runDir, 'upgrade', 'future.json');
    const capabilityHookRegistry = createCapabilityHookRegistry([{
      id: 'fixture-upgrade-decision-catalog-observer',
      phase: 'before_catalog_verify',
      hookType: 'observer',
      subscriber: {
        name: 'fixture-upgrade-decision-catalog-subscriber',
        modulePath: 'synthetic/upgrade-decision-catalog-hook.mjs',
        entrypoint: 'shouldNotExecute',
        capability: 'api-catalog',
      },
      filters: {
        eventTypes: ['api.catalog.upgrade_decision.written'],
        siteKeys: ['fixture-site'],
      },
    }, {
      id: 'fixture-upgrade-decision-artifact-observer',
      phase: 'after_artifact_write',
      hookType: 'observer',
      subscriber: {
        name: 'fixture-upgrade-decision-artifact-subscriber',
        modulePath: 'synthetic/upgrade-decision-artifact-hook.mjs',
        entrypoint: 'shouldNotExecute',
        capability: 'api-catalog',
      },
      filters: {
        eventTypes: ['api.catalog.upgrade_decision.written'],
        siteKeys: ['fixture-site'],
      },
    }]);
    const candidate = createCandidate({
      id: 'upgrade-artifact-candidate',
      siteKey: 'fixture-site',
      status: 'verified',
      auth: {
        authorization: 'Bearer synthetic-upgrade-artifact-token',
      },
      request: {
        headers: {
          authorization: 'Bearer synthetic-upgrade-request-token',
          cookie: 'SESSDATA=synthetic-upgrade-sessdata',
        },
        body: {
          csrf: 'synthetic-upgrade-csrf',
        },
      },
    });
    const acceptedDecision = normalizeSiteAdapterCandidateDecision({
      adapterId: 'fixture-adapter',
      decision: 'accepted',
      evidence: {
        authorization: 'Bearer synthetic-upgrade-decision-token',
      },
    }, { candidate });

    await assert.rejects(
      writeApiCatalogUpgradeDecisionArtifact({
        candidate,
        siteAdapterDecision: acceptedDecision,
        decidedAt: '2026-05-01T14:20:00.000Z',
      }, {
        decisionPath: missingAuditPath,
      }),
      /ApiCatalog upgrade decision redactionAuditPath is required/u,
    );
    await assert.rejects(access(missingAuditPath), /ENOENT/u);

    const result = await writeApiCatalogUpgradeDecisionArtifact({
      candidate,
      siteAdapterDecision: acceptedDecision,
      decidedAt: '2026-05-01T14:25:00.000Z',
    }, {
      decisionPath,
      redactionAuditPath: auditPath,
      lifecycleEventPath: eventPath,
      lifecycleEventRedactionAuditPath: eventAuditPath,
      lifecycleEventTraceId: 'upgrade-decision-trace',
      lifecycleEventCorrelationId: 'upgrade-decision-correlation',
      lifecycleEventTaskType: 'api-catalog-upgrade',
      lifecycleEventAdapterVersion: 'fixture-adapter-v1',
      capabilityHookRegistry,
    });
    const decisionText = await readFile(decisionPath, 'utf8');
    const auditText = await readFile(auditPath, 'utf8');
    const eventText = await readFile(eventPath, 'utf8');
    const eventAuditText = await readFile(eventAuditPath, 'utf8');
    const decision = JSON.parse(decisionText);
    const event = JSON.parse(eventText);

    assert.equal(result.artifactPath, decisionPath);
    assert.equal(result.redactionAuditPath, auditPath);
    assert.equal(result.lifecycleEventPath, eventPath);
    assert.equal(result.lifecycleEventRedactionAuditPath, eventAuditPath);
    assert.equal(decision.contractVersion, API_CATALOG_UPGRADE_DECISION_VERSION);
    assert.equal(decision.decision, 'allowed');
    assert.equal(decision.canEnterCatalog, true);
    assert.equal(Object.hasOwn(decision, 'catalogPath'), false);
    assert.equal(Object.hasOwn(decision, 'endpoint'), false);
    assert.equal(assertSchemaCompatible('LifecycleEvent', event), true);
    assert.equal(assertLifecycleEventObservabilityFields(event, {
      requiredFields: [
        'traceId',
        'correlationId',
        'taskId',
        'siteKey',
        'taskType',
        'adapterVersion',
      ],
      requiredDetailFields: [
        'candidateId',
        'adapterId',
        'decision',
        'canEnterCatalog',
        'catalogAction',
        'requirements',
        'capabilityHookMatches',
      ],
    }), true);
    assert.equal(event.eventType, 'api.catalog.upgrade_decision.written');
    assert.equal(event.traceId, 'upgrade-decision-trace');
    assert.equal(event.correlationId, 'upgrade-decision-correlation');
    assert.equal(event.taskType, 'api-catalog-upgrade');
    assert.equal(event.adapterVersion, 'fixture-adapter-v1');
    assert.equal(event.taskId, 'upgrade-artifact-candidate');
    assert.equal(event.siteKey, 'fixture-site');
    assert.equal(event.details.candidateId, 'upgrade-artifact-candidate');
    assert.equal(event.details.adapterId, 'fixture-adapter');
    assert.equal(event.details.decision, 'allowed');
    assert.equal(event.details.canEnterCatalog, true);
    assert.deepEqual(event.details.capabilityHookMatches.phases, [
      'before_catalog_verify',
      'after_artifact_write',
    ]);
    assert.equal(event.details.capabilityHookMatches.matchCount, 2);
    assert.deepEqual(event.details.capabilityHookMatches.lifecycleEvent, {
      schemaVersion: 1,
      eventType: 'api.catalog.upgrade_decision.written',
      traceId: 'upgrade-decision-trace',
      correlationId: 'upgrade-decision-correlation',
      taskId: 'upgrade-artifact-candidate',
      siteKey: 'fixture-site',
      taskType: 'api-catalog-upgrade',
      adapterVersion: 'fixture-adapter-v1',
    });
    assert.equal(Object.hasOwn(event.details.capabilityHookMatches.lifecycleEvent, 'details'), false);
    assert.deepEqual(event.details.capabilityHookMatches.matches.map((match) => match.id), [
      'fixture-upgrade-decision-artifact-observer',
      'fixture-upgrade-decision-catalog-observer',
    ]);
    for (const match of event.details.capabilityHookMatches.matches) {
      assert.equal(Object.hasOwn(match.subscriber, 'modulePath'), false);
      assert.equal(Object.hasOwn(match.subscriber, 'entrypoint'), false);
    }
    for (const rawField of ['endpoint', 'request', 'body', 'auth', 'candidate', 'rawCandidate']) {
      assert.equal(Object.hasOwn(event.details, rawField), false);
    }
    for (const text of [decisionText, auditText, eventText, eventAuditText]) {
      assert.equal(text.includes('synthetic-upgrade-artifact-token'), false);
      assert.equal(text.includes('synthetic-upgrade-request-token'), false);
      assert.equal(text.includes('synthetic-upgrade-decision-token'), false);
      assert.equal(text.includes('synthetic-upgrade-sessdata'), false);
      assert.equal(text.includes('synthetic-upgrade-csrf'), false);
      assert.equal(text.includes('upgrade-decision-catalog-hook.mjs'), false);
      assert.equal(text.includes('upgrade-decision-artifact-hook.mjs'), false);
      assert.equal(text.includes('shouldNotExecute'), false);
    }

    const blockedResult = await writeApiCatalogUpgradeDecisionArtifact({
      candidate,
      siteAdapterDecision: acceptedDecision,
      policy: {
        allowCatalogUpgrade: false,
        reasonCode: 'api-catalog-entry-blocked',
      },
    }, {
      decisionPath: blockedPath,
      redactionAuditPath: blockedAuditPath,
    });
    assert.equal(blockedResult.decision.decision, 'blocked');
    assert.equal(blockedResult.decision.canEnterCatalog, false);
    assert.equal(blockedResult.decision.reasonCode, 'api-catalog-entry-blocked');

    await assert.rejects(
      writeApiCatalogUpgradeDecisionArtifact({
        candidate: {
          ...candidate,
          schemaVersion: API_CANDIDATE_SCHEMA_VERSION + 1,
        },
        siteAdapterDecision: acceptedDecision,
      }, {
        decisionPath: futurePath,
      }),
      /not compatible/u,
    );
    await assert.rejects(access(futurePath), /ENOENT/u);
    const partialDecisionPath = path.join(runDir, 'upgrade', 'partial-event.json');
    const partialEventPath = path.join(runDir, 'upgrade', 'partial-event.lifecycle.json');
    const partialEventAuditPath = path.join(runDir, 'upgrade', 'partial-event.lifecycle.redaction-audit.json');
    await assert.rejects(
      writeApiCatalogUpgradeDecisionArtifact({
        candidate,
        siteAdapterDecision: acceptedDecision,
      }, {
        decisionPath: partialDecisionPath,
        lifecycleEventPath: partialEventPath,
      }),
      /lifecycle event and redaction audit paths must be provided together/u,
    );
    for (const partialPath of [partialDecisionPath, partialEventPath, partialEventAuditPath]) {
      await assert.rejects(access(partialPath), /ENOENT/u);
    }
    await assert.rejects(
      () => access(path.join(runDir, 'api-catalog', 'upgrade-artifact-candidate.json')),
      /ENOENT/u,
    );
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog upgrade decision gate composes with verified-only catalog writer without automatic promotion', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-upgrade-gated-entry-'));
  try {
    const decisionPath = path.join(runDir, 'upgrade', 'decision.json');
    const auditPath = path.join(runDir, 'upgrade', 'decision.redaction-audit.json');
    const catalogPath = path.join(runDir, 'catalog', 'entry.json');
    const catalogAuditPath = path.join(runDir, 'catalog', 'entry.redaction-audit.json');
    const blockedCatalogPath = path.join(runDir, 'catalog', 'blocked-entry.json');
    const candidate = createCandidate({
      id: 'upgrade-gated-candidate',
      siteKey: 'fixture-site',
      status: 'verified',
      auth: {
        authorization: 'Bearer synthetic-upgrade-gated-token',
      },
    });
    const acceptedDecision = normalizeSiteAdapterCandidateDecision({
      adapterId: 'fixture-adapter',
      decision: 'accepted',
    }, { candidate });

    const upgradeResult = await writeApiCatalogUpgradeDecisionArtifact({
      candidate,
      siteAdapterDecision: acceptedDecision,
      decidedAt: '2026-05-01T14:40:00.000Z',
    }, {
      decisionPath,
      redactionAuditPath: auditPath,
    });

    assert.equal(assertApiCatalogUpgradeDecisionAllowsCatalog(upgradeResult.decision), upgradeResult.decision);
    const catalogResult = await writeApiCatalogEntryArtifact(candidate, {
      catalogPath,
      redactionAuditPath: catalogAuditPath,
      metadata: {
        version: 'upgrade-gated-v1',
        verifiedAt: '2026-05-01T14:41:00.000Z',
      },
    });
    const catalogText = await readFile(catalogPath, 'utf8');
    assert.equal(catalogResult.entry.candidateId, 'upgrade-gated-candidate');
    assert.equal(catalogResult.entry.version, 'upgrade-gated-v1');
    assert.equal(catalogText.includes('synthetic-upgrade-gated-token'), false);
    assert.equal(JSON.stringify(upgradeResult.decision).includes('catalogPath'), false);

    const blockedDecision = createApiCatalogUpgradeDecision({
      candidate,
      siteAdapterDecision: acceptedDecision,
      policy: {
        allowCatalogUpgrade: false,
        reasonCode: 'api-catalog-entry-blocked',
      },
    });
    assert.throws(
      () => assertApiCatalogUpgradeDecisionAllowsCatalog(blockedDecision),
      /does not allow catalog entry: api-catalog-entry-blocked/u,
    );
    await assert.rejects(access(blockedCatalogPath), /ENOENT/u);
    assert.throws(
      () => assertApiCatalogUpgradeDecisionAllowsCatalog({
        ...upgradeResult.decision,
        contractVersion: API_CATALOG_UPGRADE_DECISION_VERSION + 1,
      }),
      /not compatible/u,
    );
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog verified upgrade fixture helper writes only after explicit allow gate', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-upgrade-fixture-'));
  try {
    const decisionPath = path.join(runDir, 'allowed', 'decision.json');
    const decisionAuditPath = path.join(runDir, 'allowed', 'decision.redaction-audit.json');
    const catalogPath = path.join(runDir, 'allowed', 'entry.json');
    const catalogAuditPath = path.join(runDir, 'allowed', 'entry.redaction-audit.json');
    const collectionPath = path.join(runDir, 'allowed', 'api-catalog.json');
    const collectionAuditPath = path.join(runDir, 'allowed', 'api-catalog.redaction-audit.json');
    const collectionEventPath = path.join(runDir, 'allowed', 'api-catalog.lifecycle-event.json');
    const collectionEventAuditPath = path.join(runDir, 'allowed', 'api-catalog.lifecycle-event.redaction-audit.json');
    const eventPath = path.join(runDir, 'allowed', 'verification-event.json');
    const eventAuditPath = path.join(runDir, 'allowed', 'verification-event.redaction-audit.json');
    const blockedDecisionPath = path.join(runDir, 'blocked', 'decision.json');
    const blockedDecisionAuditPath = path.join(runDir, 'blocked', 'decision.redaction-audit.json');
    const blockedCatalogPath = path.join(runDir, 'blocked', 'entry.json');
    const blockedCatalogAuditPath = path.join(runDir, 'blocked', 'entry.redaction-audit.json');
    const observedDecisionPath = path.join(runDir, 'observed', 'decision.json');
    const observedDecisionAuditPath = path.join(runDir, 'observed', 'decision.redaction-audit.json');
    const observedCatalogPath = path.join(runDir, 'observed', 'entry.json');
    const observedCatalogAuditPath = path.join(runDir, 'observed', 'entry.redaction-audit.json');
    const observedEventPath = path.join(runDir, 'observed', 'verification-event.json');
    const observedEventAuditPath = path.join(runDir, 'observed', 'verification-event.redaction-audit.json');

    const candidate = createCandidate({
      id: 'upgrade-fixture-candidate',
      siteKey: 'fixture-site',
      status: 'verified',
      endpoint: {
        method: 'GET',
        url: 'https://fixture.invalid/api/verified?access_token=synthetic-upgrade-fixture-token',
      },
      auth: {
        authorization: 'Bearer synthetic-upgrade-fixture-token',
      },
      request: {
        headers: {
          authorization: 'Bearer synthetic-upgrade-fixture-token',
        },
      },
    });
    const acceptedDecision = normalizeSiteAdapterCandidateDecision({
      adapterId: 'fixture-adapter',
      decision: 'accepted',
    }, { candidate });
    const allowPolicy = normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'fixture-adapter',
      allowCatalogUpgrade: true,
    }, { candidate, siteAdapterDecision: acceptedDecision });

    const result = await writeVerifiedApiCatalogUpgradeFixtureArtifacts({
      candidate,
      siteAdapterDecision: acceptedDecision,
      policy: allowPolicy,
      decidedAt: '2026-05-01T18:20:00.000Z',
      metadata: {
        version: 'upgrade-fixture-v1',
        verifiedAt: '2026-05-01T18:21:00.000Z',
        lastValidatedAt: '2026-05-01T18:22:00.000Z',
      },
    }, {
      decisionPath,
      decisionRedactionAuditPath: decisionAuditPath,
      catalogPath,
      catalogRedactionAuditPath: catalogAuditPath,
      collectionPath,
      collectionRedactionAuditPath: collectionAuditPath,
      collectionLifecycleEventPath: collectionEventPath,
      collectionLifecycleEventRedactionAuditPath: collectionEventAuditPath,
      collectionLifecycleEventTraceId: 'upgrade-fixture-collection-trace',
      collectionLifecycleEventCorrelationId: 'upgrade-fixture-collection-correlation',
      collectionCatalogId: 'upgrade-fixture-catalog',
      collectionCatalogVersion: 'upgrade-fixture-v1',
      verificationEventPath: eventPath,
      verificationEventRedactionAuditPath: eventAuditPath,
      verificationEventTraceId: 'upgrade-fixture-trace',
      verificationEventCorrelationId: 'upgrade-fixture-correlation',
    });

    const decision = JSON.parse(await readFile(decisionPath, 'utf8'));
    const catalogEntry = JSON.parse(await readFile(catalogPath, 'utf8'));
    const catalogCollection = JSON.parse(await readFile(collectionPath, 'utf8'));
    const collectionEvent = JSON.parse(await readFile(collectionEventPath, 'utf8'));
    const event = JSON.parse(await readFile(eventPath, 'utf8'));
    const catalogAudit = JSON.parse(await readFile(catalogAuditPath, 'utf8'));
    const collectionAudit = JSON.parse(await readFile(collectionAuditPath, 'utf8'));
    const collectionEventAudit = JSON.parse(await readFile(collectionEventAuditPath, 'utf8'));
    const eventAudit = JSON.parse(await readFile(eventAuditPath, 'utf8'));

    assert.equal(result.upgradeDecision.decision.decision, 'allowed');
    assert.equal(result.catalogEntry.entry.candidateId, 'upgrade-fixture-candidate');
    assert.equal(result.catalogCollection.catalog.entries.length, 1);
    assert.equal(assertApiCatalogUpgradeDecisionAllowsCatalog(decision), decision);
    assert.equal(assertApiCatalogEntryCompatible(catalogEntry), true);
    assert.equal(assertApiCatalogCompatible(catalogCollection), true);
    assert.equal(assertSchemaCompatible('LifecycleEvent', event), true);
    assert.equal(assertSchemaCompatible('LifecycleEvent', collectionEvent), true);
    assert.equal(decision.requirements.candidateVerified, true);
    assert.equal(decision.requirements.siteAdapterAccepted, true);
    assert.equal(decision.requirements.policyAllowsCatalogUpgrade, true);
    assert.equal(catalogEntry.version, 'upgrade-fixture-v1');
    assert.equal(catalogEntry.auth.authorization, REDACTION_PLACEHOLDER);
    assert.equal(catalogEntry.endpoint.url.includes('synthetic-upgrade-fixture-token'), false);
    assert.equal(catalogCollection.catalogId, 'upgrade-fixture-catalog');
    assert.equal(catalogCollection.catalogVersion, 'upgrade-fixture-v1');
    assert.equal(catalogCollection.entries[0].candidateId, 'upgrade-fixture-candidate');
    assert.equal(catalogCollection.entries[0].auth.authorization, REDACTION_PLACEHOLDER);
    assert.equal(collectionEvent.eventType, 'api.catalog.collection.written');
    assert.equal(collectionEvent.traceId, 'upgrade-fixture-collection-trace');
    assert.equal(collectionEvent.correlationId, 'upgrade-fixture-collection-correlation');
    assert.equal(collectionEvent.details.catalogId, 'upgrade-fixture-catalog');
    assert.equal(collectionEvent.details.entryCount, 1);
    assert.equal(JSON.stringify(collectionEvent).includes('endpoint'), false);
    assert.equal(JSON.stringify(collectionEvent).includes('auth'), false);
    assert.equal(JSON.stringify(collectionEvent).includes('entries'), false);
    assert.deepEqual(collectionEventAudit.redactedPaths, []);
    assert.equal(event.eventType, 'api.catalog.verification.written');
    assert.equal(event.traceId, 'upgrade-fixture-trace');
    assert.equal(event.correlationId, 'upgrade-fixture-correlation');
    assert.equal(catalogAudit.redactedPaths.includes('auth.authorization'), true);
    assert.equal(collectionAudit.redactedPaths.includes('entries.0.auth.authorization'), true);
    assert.equal(eventAudit.redactedPaths.includes('details.catalogEntry.auth.authorization'), true);

    for (const filePath of [
      decisionPath,
      decisionAuditPath,
      catalogPath,
      catalogAuditPath,
      collectionPath,
      collectionAuditPath,
      collectionEventPath,
      collectionEventAuditPath,
      eventPath,
      eventAuditPath,
    ]) {
      const text = await readFile(filePath, 'utf8');
      assert.equal(text.includes('synthetic-upgrade-fixture-token'), false);
    }

    const blockedPolicy = normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'fixture-adapter',
      allowCatalogUpgrade: false,
      reasonCode: 'api-catalog-entry-blocked',
    }, { candidate, siteAdapterDecision: acceptedDecision });
    await assert.rejects(
      writeVerifiedApiCatalogUpgradeFixtureArtifacts({
        candidate,
        siteAdapterDecision: acceptedDecision,
        policy: blockedPolicy,
      }, {
        decisionPath: blockedDecisionPath,
        decisionRedactionAuditPath: blockedDecisionAuditPath,
        catalogPath: blockedCatalogPath,
        catalogRedactionAuditPath: blockedCatalogAuditPath,
      }),
      /does not allow catalog entry: api-catalog-entry-blocked/u,
    );
    await assert.rejects(access(blockedDecisionPath), /ENOENT/u);
    await assert.rejects(access(blockedDecisionAuditPath), /ENOENT/u);
    await assert.rejects(access(blockedCatalogPath), /ENOENT/u);
    await assert.rejects(access(blockedCatalogAuditPath), /ENOENT/u);

    const observedCandidate = createCandidate({
      id: 'upgrade-fixture-observed',
      siteKey: 'fixture-site',
      status: 'observed',
    });
    const observedAcceptedDecision = normalizeSiteAdapterCandidateDecision({
      adapterId: 'fixture-adapter',
      decision: 'accepted',
    }, { candidate: observedCandidate });
    const observedAllowPolicy = normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'fixture-adapter',
      allowCatalogUpgrade: true,
    }, { candidate: observedCandidate, siteAdapterDecision: observedAcceptedDecision });
    await assert.rejects(
      writeVerifiedApiCatalogUpgradeFixtureArtifacts({
        candidate: observedCandidate,
        siteAdapterDecision: observedAcceptedDecision,
        policy: observedAllowPolicy,
      }, {
        decisionPath: observedDecisionPath,
        decisionRedactionAuditPath: observedDecisionAuditPath,
        catalogPath: observedCatalogPath,
        catalogRedactionAuditPath: observedCatalogAuditPath,
        verificationEventPath: observedEventPath,
        verificationEventRedactionAuditPath: observedEventAuditPath,
      }),
      /does not allow catalog entry: api-catalog-entry-blocked/u,
    );
    await assert.rejects(access(observedDecisionPath), /ENOENT/u);
    await assert.rejects(access(observedDecisionAuditPath), /ENOENT/u);
    await assert.rejects(access(observedCatalogPath), /ENOENT/u);
    await assert.rejects(access(observedCatalogAuditPath), /ENOENT/u);
    await assert.rejects(access(observedEventPath), /ENOENT/u);
    await assert.rejects(access(observedEventAuditPath), /ENOENT/u);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('runtime ApiCatalog store writer accepts only verified explicit allow evidence', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-runtime-store-'));
  try {
    const allowedDir = path.join(runDir, 'allowed');
    const decisionPath = path.join(allowedDir, 'decision.json');
    const decisionAuditPath = path.join(allowedDir, 'decision.redaction-audit.json');
    const catalogPath = path.join(allowedDir, 'entry.json');
    const catalogAuditPath = path.join(allowedDir, 'entry.redaction-audit.json');
    const collectionPath = path.join(allowedDir, 'api-catalog.json');
    const collectionAuditPath = path.join(allowedDir, 'api-catalog.redaction-audit.json');
    const collectionEventPath = path.join(allowedDir, 'api-catalog.lifecycle-event.json');
    const collectionEventAuditPath = path.join(allowedDir, 'api-catalog.lifecycle-event.redaction-audit.json');
    const indexPath = path.join(allowedDir, 'api-catalog-index.json');
    const indexAuditPath = path.join(allowedDir, 'api-catalog-index.redaction-audit.json');
    const indexEventPath = path.join(allowedDir, 'api-catalog-index.lifecycle-event.json');
    const indexEventAuditPath = path.join(allowedDir, 'api-catalog-index.lifecycle-event.redaction-audit.json');
    const eventPath = path.join(allowedDir, 'verification-event.json');
    const eventAuditPath = path.join(allowedDir, 'verification-event.redaction-audit.json');
    const blockedDir = path.join(runDir, 'blocked');
    const observedDir = path.join(runDir, 'observed');
    const candidateDir = path.join(runDir, 'candidate');
    const rejectedDir = path.join(runDir, 'rejected');
    const artifactPathsFor = (dir) => [
      path.join(dir, 'decision.json'),
      path.join(dir, 'decision.redaction-audit.json'),
      path.join(dir, 'entry.json'),
      path.join(dir, 'entry.redaction-audit.json'),
      path.join(dir, 'api-catalog.json'),
      path.join(dir, 'api-catalog.redaction-audit.json'),
      path.join(dir, 'api-catalog.lifecycle-event.json'),
      path.join(dir, 'api-catalog.lifecycle-event.redaction-audit.json'),
      path.join(dir, 'verification-event.json'),
      path.join(dir, 'verification-event.redaction-audit.json'),
      path.join(dir, 'api-catalog-index.json'),
      path.join(dir, 'api-catalog-index.redaction-audit.json'),
      path.join(dir, 'api-catalog-index.lifecycle-event.json'),
      path.join(dir, 'api-catalog-index.lifecycle-event.redaction-audit.json'),
    ];
    const assertNoArtifactsWritten = async (filePaths) => {
      for (const filePath of filePaths) {
        await assert.rejects(access(filePath), /ENOENT/u);
      }
    };

    const candidate = createCandidate({
      id: 'runtime-store-candidate',
      siteKey: 'runtime-site',
      status: 'verified',
      endpoint: {
        method: 'GET',
        url: 'https://runtime.invalid/api?access_token=synthetic-runtime-store-token',
      },
      auth: {
        authorization: 'Bearer synthetic-runtime-store-token',
      },
      request: {
        headers: {
          authorization: 'Bearer synthetic-runtime-store-token',
        },
      },
    });
    const acceptedDecision = normalizeSiteAdapterCandidateDecision({
      adapterId: 'runtime-adapter',
      decision: 'accepted',
    }, { candidate });
    const allowPolicy = normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'runtime-adapter',
      allowCatalogUpgrade: true,
    }, { candidate, siteAdapterDecision: acceptedDecision });

    const result = await writeRuntimeVerifiedApiCatalogStoreArtifacts({
      candidate,
      siteAdapterDecision: acceptedDecision,
      policy: allowPolicy,
      decidedAt: '2026-05-02T00:20:00.000Z',
      metadata: {
        version: 'runtime-store-v1',
        verifiedAt: '2026-05-02T00:21:00.000Z',
        lastValidatedAt: '2026-05-02T00:22:00.000Z',
      },
    }, {
      decisionPath,
      decisionRedactionAuditPath: decisionAuditPath,
      catalogPath,
      catalogRedactionAuditPath: catalogAuditPath,
      collectionPath,
      collectionRedactionAuditPath: collectionAuditPath,
      collectionLifecycleEventPath: collectionEventPath,
      collectionLifecycleEventRedactionAuditPath: collectionEventAuditPath,
      collectionLifecycleEventTraceId: 'runtime-store-collection-trace',
      collectionLifecycleEventCorrelationId: 'runtime-store-collection-correlation',
      collectionCatalogId: 'runtime-store-catalog',
      collectionCatalogVersion: 'runtime-store-v1',
      verificationEventPath: eventPath,
      verificationEventRedactionAuditPath: eventAuditPath,
      verificationEventTraceId: 'runtime-store-trace',
      verificationEventCorrelationId: 'runtime-store-correlation',
      indexPath,
      indexRedactionAuditPath: indexAuditPath,
      indexLifecycleEventPath: indexEventPath,
      indexLifecycleEventRedactionAuditPath: indexEventAuditPath,
      indexLifecycleEventTraceId: 'runtime-store-index-trace',
      indexLifecycleEventCorrelationId: 'runtime-store-index-correlation',
      indexLifecycleEventSiteKey: 'runtime-site',
      indexLifecycleEventTaskType: 'api-catalog-maintenance',
      indexLifecycleEventAdapterVersion: 'runtime-adapter-v1',
      indexGeneratedAt: '2026-05-02T00:23:00.000Z',
      indexVersion: 'runtime-store-index-v1',
    });

    const collection = JSON.parse(await readFile(collectionPath, 'utf8'));
    const collectionEvent = JSON.parse(await readFile(collectionEventPath, 'utf8'));
    const verificationEvent = JSON.parse(await readFile(eventPath, 'utf8'));
    const index = JSON.parse(await readFile(indexPath, 'utf8'));
    const indexEvent = JSON.parse(await readFile(indexEventPath, 'utf8'));
    const collectionAudit = JSON.parse(await readFile(collectionAuditPath, 'utf8'));

    assert.equal(result.upgradeDecision.decision.decision, 'allowed');
    assert.equal(result.catalogEntry.entry.candidateId, 'runtime-store-candidate');
    assert.equal(result.catalogCollection.catalog.catalogId, 'runtime-store-catalog');
    assert.equal(result.catalogIndex.index.indexVersion, 'runtime-store-index-v1');
    assert.equal(assertApiCatalogCompatible(collection), true);
    assert.equal(assertApiCatalogIndexCompatible(index), true);
    assert.equal(collection.catalogId, 'runtime-store-catalog');
    assert.equal(collection.entries.length, 1);
    assert.equal(collection.entries[0].candidateId, 'runtime-store-candidate');
    assert.equal(collection.entries[0].auth.authorization, REDACTION_PLACEHOLDER);
    assert.equal(collection.entries[0].endpoint.url.includes('synthetic-runtime-store-token'), false);
    assert.equal(collectionEvent.eventType, 'api.catalog.collection.written');
    assert.equal(collectionEvent.traceId, 'runtime-store-collection-trace');
    assert.equal(collectionEvent.details.entryCount, 1);
    assert.equal(assertSchemaCompatible('LifecycleEvent', collectionEvent), true);
    assert.equal(JSON.stringify(collectionEvent).includes('endpoint'), false);
    assert.equal(JSON.stringify(collectionEvent).includes('auth'), false);
    assert.equal(verificationEvent.eventType, 'api.catalog.verification.written');
    assert.equal(assertSchemaCompatible('LifecycleEvent', verificationEvent), true);
    assert.equal(index.indexVersion, 'runtime-store-index-v1');
    assert.equal(index.generatedAt, '2026-05-02T00:23:00.000Z');
    assert.equal(index.catalogs.length, 1);
    assert.equal(index.catalogs[0].catalogId, 'runtime-store-catalog');
    assert.equal(index.catalogs[0].entryCount, 1);
    assert.deepEqual(index.catalogs[0].statuses, { cataloged: 1 });
    assert.equal(indexEvent.eventType, 'api.catalog.index.written');
    assert.equal(indexEvent.traceId, 'runtime-store-index-trace');
    assert.equal(indexEvent.correlationId, 'runtime-store-index-correlation');
    assert.equal(indexEvent.siteKey, 'runtime-site');
    assert.equal(indexEvent.taskType, 'api-catalog-maintenance');
    assert.equal(indexEvent.adapterVersion, 'runtime-adapter-v1');
    assert.equal(indexEvent.details.totalEntryCount, 1);
    assert.equal(assertSchemaCompatible('LifecycleEvent', indexEvent), true);
    assert.equal(JSON.stringify(indexEvent).includes('endpoint'), false);
    assert.equal(JSON.stringify(indexEvent).includes('auth'), false);
    assert.equal(collectionAudit.redactedPaths.includes('entries.0.auth.authorization'), true);

    for (const filePath of [
      decisionPath,
      decisionAuditPath,
      catalogPath,
      catalogAuditPath,
      collectionPath,
      collectionAuditPath,
      collectionEventPath,
      collectionEventAuditPath,
      eventPath,
      eventAuditPath,
      indexPath,
      indexAuditPath,
      indexEventPath,
      indexEventAuditPath,
    ]) {
      const text = await readFile(filePath, 'utf8');
      assert.equal(text.includes('synthetic-runtime-store-token'), false);
    }

    const blockedPolicy = normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'runtime-adapter',
      allowCatalogUpgrade: false,
      reasonCode: 'api-catalog-entry-blocked',
    }, { candidate, siteAdapterDecision: acceptedDecision });
    const blockedPaths = artifactPathsFor(blockedDir);
    await assert.rejects(
      writeRuntimeVerifiedApiCatalogStoreArtifacts({
        candidate,
        siteAdapterDecision: acceptedDecision,
        policy: blockedPolicy,
      }, {
        decisionPath: blockedPaths[0],
        decisionRedactionAuditPath: blockedPaths[1],
        catalogPath: blockedPaths[2],
        catalogRedactionAuditPath: blockedPaths[3],
        collectionPath: blockedPaths[4],
        collectionRedactionAuditPath: blockedPaths[5],
        collectionLifecycleEventPath: blockedPaths[6],
        collectionLifecycleEventRedactionAuditPath: blockedPaths[7],
        verificationEventPath: blockedPaths[8],
        verificationEventRedactionAuditPath: blockedPaths[9],
        indexPath: blockedPaths[10],
        indexRedactionAuditPath: blockedPaths[11],
        indexLifecycleEventPath: blockedPaths[12],
        indexLifecycleEventRedactionAuditPath: blockedPaths[13],
      }),
      /does not allow catalog entry: api-catalog-entry-blocked/u,
    );
    await assertNoArtifactsWritten(blockedPaths);

    const observedCandidate = createCandidate({
      id: 'runtime-store-observed',
      siteKey: 'runtime-site',
      status: 'observed',
    });
    const observedDecision = normalizeSiteAdapterCandidateDecision({
      adapterId: 'runtime-adapter',
      decision: 'accepted',
    }, { candidate: observedCandidate });
    const observedPolicy = normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'runtime-adapter',
      allowCatalogUpgrade: true,
    }, { candidate: observedCandidate, siteAdapterDecision: observedDecision });
    const observedPaths = artifactPathsFor(observedDir);
    await assert.rejects(
      writeRuntimeVerifiedApiCatalogStoreArtifacts({
        candidate: observedCandidate,
        siteAdapterDecision: observedDecision,
        policy: observedPolicy,
      }, {
        decisionPath: observedPaths[0],
        decisionRedactionAuditPath: observedPaths[1],
        catalogPath: observedPaths[2],
        catalogRedactionAuditPath: observedPaths[3],
        collectionPath: observedPaths[4],
        collectionRedactionAuditPath: observedPaths[5],
        collectionLifecycleEventPath: observedPaths[6],
        collectionLifecycleEventRedactionAuditPath: observedPaths[7],
        verificationEventPath: observedPaths[8],
        verificationEventRedactionAuditPath: observedPaths[9],
        indexPath: observedPaths[10],
        indexRedactionAuditPath: observedPaths[11],
        indexLifecycleEventPath: observedPaths[12],
        indexLifecycleEventRedactionAuditPath: observedPaths[13],
      }),
      /does not allow catalog entry: api-catalog-entry-blocked/u,
    );
    await assertNoArtifactsWritten(observedPaths);

    const unverifiedCandidate = createCandidate({
      id: 'runtime-store-candidate-status',
      siteKey: 'runtime-site',
      status: 'candidate',
    });
    const candidateDecision = normalizeSiteAdapterCandidateDecision({
      adapterId: 'runtime-adapter',
      decision: 'accepted',
    }, { candidate: unverifiedCandidate });
    const candidatePolicy = normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'runtime-adapter',
      allowCatalogUpgrade: true,
    }, { candidate: unverifiedCandidate, siteAdapterDecision: candidateDecision });
    const candidatePaths = artifactPathsFor(candidateDir);
    await assert.rejects(
      writeRuntimeVerifiedApiCatalogStoreArtifacts({
        candidate: unverifiedCandidate,
        siteAdapterDecision: candidateDecision,
        policy: candidatePolicy,
      }, {
        decisionPath: candidatePaths[0],
        decisionRedactionAuditPath: candidatePaths[1],
        catalogPath: candidatePaths[2],
        catalogRedactionAuditPath: candidatePaths[3],
        collectionPath: candidatePaths[4],
        collectionRedactionAuditPath: candidatePaths[5],
        collectionLifecycleEventPath: candidatePaths[6],
        collectionLifecycleEventRedactionAuditPath: candidatePaths[7],
        verificationEventPath: candidatePaths[8],
        verificationEventRedactionAuditPath: candidatePaths[9],
        indexPath: candidatePaths[10],
        indexRedactionAuditPath: candidatePaths[11],
        indexLifecycleEventPath: candidatePaths[12],
        indexLifecycleEventRedactionAuditPath: candidatePaths[13],
      }),
      /does not allow catalog entry: api-catalog-entry-blocked/u,
    );
    await assertNoArtifactsWritten(candidatePaths);

    for (const status of ['cataloged', 'deprecated', 'blocked']) {
      const nonVerifiedCandidate = createCandidate({
        id: `runtime-store-${status}`,
        siteKey: 'runtime-site',
        status,
      });
      const nonVerifiedDecision = normalizeSiteAdapterCandidateDecision({
        adapterId: 'runtime-adapter',
        decision: 'accepted',
      }, { candidate: nonVerifiedCandidate });
      const nonVerifiedPolicy = normalizeSiteAdapterCatalogUpgradePolicy({
        adapterId: 'runtime-adapter',
        allowCatalogUpgrade: true,
      }, { candidate: nonVerifiedCandidate, siteAdapterDecision: nonVerifiedDecision });
      const nonVerifiedPaths = artifactPathsFor(path.join(runDir, `non-verified-${status}`));
      await assert.rejects(
        writeRuntimeVerifiedApiCatalogStoreArtifacts({
          candidate: nonVerifiedCandidate,
          siteAdapterDecision: nonVerifiedDecision,
          policy: nonVerifiedPolicy,
        }, {
          decisionPath: nonVerifiedPaths[0],
          decisionRedactionAuditPath: nonVerifiedPaths[1],
          catalogPath: nonVerifiedPaths[2],
          catalogRedactionAuditPath: nonVerifiedPaths[3],
          collectionPath: nonVerifiedPaths[4],
          collectionRedactionAuditPath: nonVerifiedPaths[5],
          collectionLifecycleEventPath: nonVerifiedPaths[6],
          collectionLifecycleEventRedactionAuditPath: nonVerifiedPaths[7],
          verificationEventPath: nonVerifiedPaths[8],
          verificationEventRedactionAuditPath: nonVerifiedPaths[9],
          indexPath: nonVerifiedPaths[10],
          indexRedactionAuditPath: nonVerifiedPaths[11],
          indexLifecycleEventPath: nonVerifiedPaths[12],
          indexLifecycleEventRedactionAuditPath: nonVerifiedPaths[13],
        }),
        /does not allow catalog entry: api-catalog-entry-blocked/u,
      );
      await assertNoArtifactsWritten(nonVerifiedPaths);
    }

    const rejectedDecision = normalizeSiteAdapterCandidateDecision({
      adapterId: 'runtime-adapter',
      decision: 'rejected',
      reasonCode: 'api-verification-failed',
    }, { candidate });
    const rejectedPolicy = normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'runtime-adapter',
      allowCatalogUpgrade: true,
    }, { candidate, siteAdapterDecision: rejectedDecision });
    const rejectedPaths = artifactPathsFor(rejectedDir);
    await assert.rejects(
      writeRuntimeVerifiedApiCatalogStoreArtifacts({
        candidate,
        siteAdapterDecision: rejectedDecision,
        policy: rejectedPolicy,
      }, {
        decisionPath: rejectedPaths[0],
        decisionRedactionAuditPath: rejectedPaths[1],
        catalogPath: rejectedPaths[2],
        catalogRedactionAuditPath: rejectedPaths[3],
        collectionPath: rejectedPaths[4],
        collectionRedactionAuditPath: rejectedPaths[5],
        collectionLifecycleEventPath: rejectedPaths[6],
        collectionLifecycleEventRedactionAuditPath: rejectedPaths[7],
        verificationEventPath: rejectedPaths[8],
        verificationEventRedactionAuditPath: rejectedPaths[9],
        indexPath: rejectedPaths[10],
        indexRedactionAuditPath: rejectedPaths[11],
        indexLifecycleEventPath: rejectedPaths[12],
        indexLifecycleEventRedactionAuditPath: rejectedPaths[13],
      }),
      /does not allow catalog entry: api-verification-failed/u,
    );
    await assertNoArtifactsWritten(rejectedPaths);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog verified upgrade fixture helper rejects incomplete optional artifact paths without partial writes', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-upgrade-fixture-incomplete-paths-'));
  try {
    const candidate = createCandidate({
      id: 'upgrade-fixture-incomplete-paths',
      siteKey: 'fixture-site',
      status: 'verified',
      endpoint: {
        method: 'GET',
        url: 'https://fixture.invalid/api/incomplete?access_token=synthetic-incomplete-path-token',
      },
      request: {
        headers: {
          authorization: 'Bearer synthetic-incomplete-path-token',
        },
      },
    });
    const siteAdapterDecision = normalizeSiteAdapterCandidateDecision({
      adapterId: 'fixture-adapter',
      decision: 'accepted',
    }, { candidate });
    const policy = normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'fixture-adapter',
      allowCatalogUpgrade: true,
    }, { candidate, siteAdapterDecision });
    const artifactPathsFor = (dir) => ({
      decisionPath: path.join(dir, 'decision.json'),
      decisionRedactionAuditPath: path.join(dir, 'decision.redaction-audit.json'),
      catalogPath: path.join(dir, 'entry.json'),
      catalogRedactionAuditPath: path.join(dir, 'entry.redaction-audit.json'),
      collectionPath: path.join(dir, 'api-catalog.json'),
      collectionRedactionAuditPath: path.join(dir, 'api-catalog.redaction-audit.json'),
      collectionLifecycleEventPath: path.join(dir, 'api-catalog.lifecycle-event.json'),
      collectionLifecycleEventRedactionAuditPath: path.join(dir, 'api-catalog.lifecycle-event.redaction-audit.json'),
      verificationEventPath: path.join(dir, 'verification-event.json'),
      verificationEventRedactionAuditPath: path.join(dir, 'verification-event.redaction-audit.json'),
    });
    const assertSafeReject = async (promise, expectedPattern, paths) => {
      await assert.rejects(
        promise,
        (error) => {
          assert.match(error.message, expectedPattern);
          assert.doesNotMatch(JSON.stringify(error), /synthetic-incomplete-path-token|authorization|cookie|csrf|sessionId/iu);
          return true;
        },
      );
      await assertMissingFiles(Object.values(paths));
    };

    const partialVerificationPaths = artifactPathsFor(path.join(runDir, 'partial-verification'));
    await assertSafeReject(
      writeVerifiedApiCatalogUpgradeFixtureArtifacts({
        candidate,
        siteAdapterDecision,
        policy,
        decidedAt: '2026-05-03T10:55:00.000Z',
      }, {
        decisionPath: partialVerificationPaths.decisionPath,
        decisionRedactionAuditPath: partialVerificationPaths.decisionRedactionAuditPath,
        catalogPath: partialVerificationPaths.catalogPath,
        catalogRedactionAuditPath: partialVerificationPaths.catalogRedactionAuditPath,
        verificationEventPath: partialVerificationPaths.verificationEventPath,
      }),
      /verification event and redaction audit paths must be provided together/u,
      partialVerificationPaths,
    );

    const missingCollectionAuditPaths = artifactPathsFor(path.join(runDir, 'missing-collection-audit'));
    await assertSafeReject(
      writeVerifiedApiCatalogUpgradeFixtureArtifacts({
        candidate,
        siteAdapterDecision,
        policy,
        decidedAt: '2026-05-03T10:56:00.000Z',
      }, {
        decisionPath: missingCollectionAuditPaths.decisionPath,
        decisionRedactionAuditPath: missingCollectionAuditPaths.decisionRedactionAuditPath,
        catalogPath: missingCollectionAuditPaths.catalogPath,
        catalogRedactionAuditPath: missingCollectionAuditPaths.catalogRedactionAuditPath,
        collectionPath: missingCollectionAuditPaths.collectionPath,
      }),
      /collectionRedactionAuditPath is required for collection writes/u,
      missingCollectionAuditPaths,
    );

    const partialCollectionLifecyclePaths = artifactPathsFor(path.join(runDir, 'partial-collection-lifecycle'));
    await assertSafeReject(
      writeVerifiedApiCatalogUpgradeFixtureArtifacts({
        candidate,
        siteAdapterDecision,
        policy,
        decidedAt: '2026-05-03T10:57:00.000Z',
      }, {
        decisionPath: partialCollectionLifecyclePaths.decisionPath,
        decisionRedactionAuditPath: partialCollectionLifecyclePaths.decisionRedactionAuditPath,
        catalogPath: partialCollectionLifecyclePaths.catalogPath,
        catalogRedactionAuditPath: partialCollectionLifecyclePaths.catalogRedactionAuditPath,
        collectionPath: partialCollectionLifecyclePaths.collectionPath,
        collectionRedactionAuditPath: partialCollectionLifecyclePaths.collectionRedactionAuditPath,
        collectionLifecycleEventPath: partialCollectionLifecyclePaths.collectionLifecycleEventPath,
      }),
      /collection lifecycle event and redaction audit paths must be provided together/u,
      partialCollectionLifecyclePaths,
    );
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('runtime ApiCatalog store output can feed planner handoff without downloader execution', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-runtime-planner-handoff-'));
  try {
    const storeDir = path.join(runDir, 'store');
    const handoffPath = path.join(runDir, 'planner', 'planner-handoff.json');
    const handoffAuditPath = path.join(runDir, 'planner', 'planner-handoff.redaction-audit.json');
    const candidate = createCandidate({
      id: 'runtime-planner-handoff-candidate',
      siteKey: 'runtime-planner-site',
      status: 'verified',
      endpoint: {
        method: 'GET',
        url: 'https://runtime.invalid/api/items?access_token=synthetic-runtime-planner-token&cursor=1',
      },
      request: {
        headers: {
          authorization: 'Bearer synthetic-runtime-planner-token',
          accept: 'application/json',
        },
      },
    });
    const acceptedDecision = normalizeSiteAdapterCandidateDecision({
      adapterId: 'runtime-planner-adapter',
      decision: 'accepted',
    }, { candidate });
    const allowPolicy = normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'runtime-planner-adapter',
      allowCatalogUpgrade: true,
    }, { candidate, siteAdapterDecision: acceptedDecision });

    const store = await writeRuntimeVerifiedApiCatalogStoreArtifacts({
      candidate,
      siteAdapterDecision: acceptedDecision,
      policy: allowPolicy,
      decidedAt: '2026-05-02T02:20:00.000Z',
      metadata: {
        version: 'runtime-planner-store-v1',
        verifiedAt: '2026-05-02T02:21:00.000Z',
        lastValidatedAt: '2026-05-02T02:22:00.000Z',
        auth: {
          required: true,
          scheme: 'session-view',
        },
        pagination: {
          type: 'cursor',
          cursorField: 'nextCursor',
          pageSize: 20,
        },
      },
    }, {
      decisionPath: path.join(storeDir, 'decision.json'),
      decisionRedactionAuditPath: path.join(storeDir, 'decision.redaction-audit.json'),
      catalogPath: path.join(storeDir, 'entry.json'),
      catalogRedactionAuditPath: path.join(storeDir, 'entry.redaction-audit.json'),
      collectionPath: path.join(storeDir, 'api-catalog.json'),
      collectionRedactionAuditPath: path.join(storeDir, 'api-catalog.redaction-audit.json'),
      collectionLifecycleEventPath: path.join(storeDir, 'api-catalog.lifecycle-event.json'),
      collectionLifecycleEventRedactionAuditPath: path.join(storeDir, 'api-catalog.lifecycle-event.redaction-audit.json'),
      verificationEventPath: path.join(storeDir, 'verification-event.json'),
      verificationEventRedactionAuditPath: path.join(storeDir, 'verification-event.redaction-audit.json'),
      collectionCatalogId: 'runtime-planner-catalog',
      collectionCatalogVersion: 'runtime-planner-store-v1',
    });

    const handoff = await writeCatalogStorePlannerPolicyHandoffArtifact(store, {
      taskIntent: {
        siteKey: 'runtime-planner-site',
        taskType: 'catalog-backed-download',
        id: 'runtime-planner-task-1',
      },
      policy: {
        retries: 1,
        retryBackoffMs: 250,
      },
    }, {
      handoffPath,
      redactionAuditPath: handoffAuditPath,
    });

    assert.equal(handoff.handoff.downloadPolicy.sessionRequirement, 'required');
    assert.equal(handoff.handoff.downloadPolicy.allowNetworkResolve, false);
    assert.equal(handoff.handoff.taskList.items[0].endpoint.includes('synthetic-runtime-planner-token'), false);
    assert.equal(handoff.handoff.taskList.items[0].pagination.pageSize, 20);
    for (const filePath of [handoffPath, handoffAuditPath]) {
      const text = await readFile(filePath, 'utf8');
      assert.doesNotMatch(text, /synthetic-runtime-planner-token|authorization|cookie|csrf|sessionId|browserProfile/iu);
    }
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCandidate and ApiCatalogEntry compatibility guards reject missing or future versions', () => {
  assert.throws(
    () => assertApiCandidateCompatible({}),
    /ApiCandidate schemaVersion is required/u,
  );
  assert.throws(
    () => assertApiCandidateCompatible({ schemaVersion: API_CANDIDATE_SCHEMA_VERSION + 1 }),
    /not compatible/u,
  );
  assert.throws(
    () => assertApiCatalogEntryCompatible({}),
    /ApiCatalogEntry schemaVersion is required/u,
  );
  assert.throws(
    () => assertApiCatalogEntryCompatible({ schemaVersion: API_CATALOG_ENTRY_SCHEMA_VERSION + 1 }),
    /not compatible/u,
  );
  assert.throws(
    () => assertApiCatalogCompatible({}),
    /ApiCatalog schemaVersion is required/u,
  );
  assert.throws(
    () => assertApiCatalogCompatible({ schemaVersion: API_CATALOG_SCHEMA_VERSION + 1 }),
    /not compatible/u,
  );
  assert.throws(
    () => assertApiCatalogIndexCompatible({}),
    /ApiCatalogIndex schemaVersion is required/u,
  );
  assert.throws(
    () => assertApiCatalogIndexCompatible({ schemaVersion: API_CATALOG_INDEX_SCHEMA_VERSION + 1 }),
    /not compatible/u,
  );
});

test('SiteAdapter candidate decision compatibility guard accepts current contract and schema versions', () => {
  const decision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'generic-navigation',
    decision: 'accepted',
  }, {
    candidate: createCandidate({
      id: 'decision-compatible-candidate',
      siteKey: 'generic-navigation',
      status: 'observed',
    }),
  });

  assert.equal(decision.contractVersion, SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION);
  assert.equal(assertSiteAdapterCandidateDecisionCompatible(decision), true);
  assert.equal(
    assertSiteAdapterCandidateDecisionCompatible({
      schemaVersion: SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION,
    }),
    true,
  );
});

test('SiteAdapter candidate decision compatibility guard rejects missing or future versions', () => {
  assert.throws(
    () => assertSiteAdapterCandidateDecisionCompatible({}),
    /SiteAdapterCandidateDecision schemaVersion is required/u,
  );
  assert.throws(
    () => assertSiteAdapterCandidateDecisionCompatible({
      contractVersion: SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION + 1,
    }),
    /not compatible/u,
  );
  assert.throws(
    () => assertSiteAdapterCandidateDecisionCompatible({
      schemaVersion: SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION + 1,
    }),
    /not compatible/u,
  );
  assert.throws(
    () => assertSiteAdapterCandidateDecisionCompatible({
      contractVersion: SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION,
      schemaVersion: SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION + 1,
    }),
    /conflicts with schemaVersion/u,
  );
});

test('ApiCatalogEntry rejects unsupported catalog statuses', () => {
  assert.throws(
    () => createApiCatalogEntryFromCandidate(createCandidate({ status: 'verified' }), {
      status: 'experimental',
    }),
    /Unsupported ApiCatalogEntry status/u,
  );
  assert.throws(
    () => createApiCatalogEntryFromCandidate(createCandidate({ status: 'verified' }), {
      invalidationStatus: 'unknown',
    }),
    /Unsupported ApiCatalogEntry invalidationStatus/u,
  );
});

test('ApiCatalogEntry blocked and deprecated states still require verified candidates', () => {
  const deprecated = createApiCatalogEntryFromCandidate(createCandidate({
    id: 'deprecated-candidate',
    status: 'verified',
  }), {
    status: 'deprecated',
    risk: {
      reasonCode: 'api-verification-failed',
      catalogAction: reasonCodeSummary('api-verification-failed').catalogAction,
    },
  });
  const blocked = createApiCatalogEntryFromCandidate(createCandidate({
    id: 'blocked-candidate',
    status: 'verified',
  }), {
    status: 'blocked',
    risk: {
      reasonCode: 'api-catalog-entry-blocked',
      catalogAction: reasonCodeSummary('api-catalog-entry-blocked').catalogAction,
    },
  });

  assert.equal(deprecated.status, 'deprecated');
  assert.equal(deprecated.invalidationStatus, 'deprecated');
  assert.equal(deprecated.risk.reasonCode, 'api-verification-failed');
  assert.equal(deprecated.risk.catalogAction, 'deprecate');
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.invalidationStatus, 'blocked');
  assert.equal(blocked.risk.reasonCode, 'api-catalog-entry-blocked');
  assert.equal(blocked.risk.catalogAction, 'block');
  assert.throws(
    () => createApiCatalogEntryFromCandidate(createCandidate({
      status: 'candidate',
    }), {
      status: 'blocked',
      risk: {
        reasonCode: 'api-catalog-entry-blocked',
      },
    }),
    /ApiCandidate must be verified before catalog entry/u,
  );
});

test('ApiCatalog verification lifecycle metadata preserves blocked and deprecated states safely', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-lifecycle-state-'));
  try {
    const deprecatedEventPath = path.join(runDir, 'deprecated-event.json');
    const deprecatedAuditPath = path.join(runDir, 'deprecated-event.redaction-audit.json');
    const blockedEventPath = path.join(runDir, 'blocked-event.json');
    const blockedAuditPath = path.join(runDir, 'blocked-event.redaction-audit.json');
    const nonVerifiedEventPath = path.join(runDir, 'non-verified-event.json');
    const nonVerifiedAuditPath = path.join(runDir, 'non-verified-event.redaction-audit.json');

    await writeApiCatalogVerificationEventArtifact(createCandidate({
      id: 'deprecated-event-candidate',
      status: 'verified',
      auth: {
        authorization: 'Bearer synthetic-deprecated-event-token',
      },
    }), {
      eventPath: deprecatedEventPath,
      redactionAuditPath: deprecatedAuditPath,
      traceId: 'deprecated-event-trace',
      correlationId: 'deprecated-event-correlation',
      metadata: {
        status: 'deprecated',
        version: 'deprecated-api-v1',
        verifiedAt: '2026-05-01T06:00:00.000Z',
        lastValidatedAt: '2026-05-01T06:01:00.000Z',
        risk: {
          reasonCode: 'api-verification-failed',
          catalogAction: reasonCodeSummary('api-verification-failed').catalogAction,
        },
      },
    });
    await writeApiCatalogVerificationEventArtifact(createCandidate({
      id: 'blocked-event-candidate',
      status: 'verified',
      auth: {
        authorization: 'Bearer synthetic-blocked-event-token',
      },
    }), {
      eventPath: blockedEventPath,
      redactionAuditPath: blockedAuditPath,
      traceId: 'blocked-event-trace',
      correlationId: 'blocked-event-correlation',
      metadata: {
        status: 'blocked',
        version: 'blocked-api-v1',
        verifiedAt: '2026-05-01T06:02:00.000Z',
        lastValidatedAt: '2026-05-01T06:03:00.000Z',
        risk: {
          reasonCode: 'api-catalog-entry-blocked',
          catalogAction: reasonCodeSummary('api-catalog-entry-blocked').catalogAction,
        },
      },
    });

    const deprecatedEventText = await readFile(deprecatedEventPath, 'utf8');
    const deprecatedAuditText = await readFile(deprecatedAuditPath, 'utf8');
    const blockedEventText = await readFile(blockedEventPath, 'utf8');
    const blockedAuditText = await readFile(blockedAuditPath, 'utf8');
    const deprecatedEvent = JSON.parse(deprecatedEventText);
    const deprecatedAudit = JSON.parse(deprecatedAuditText);
    const blockedEvent = JSON.parse(blockedEventText);
    const blockedAudit = JSON.parse(blockedAuditText);

    assert.equal(assertSchemaCompatible('LifecycleEvent', deprecatedEvent), true);
    assert.equal(assertSchemaCompatible('LifecycleEvent', blockedEvent), true);
    assert.equal(deprecatedEvent.details.catalogVersion, 'deprecated-api-v1');
    assert.equal(deprecatedEvent.details.catalogStatus, 'deprecated');
    assert.equal(deprecatedEvent.details.invalidationStatus, 'deprecated');
    assert.equal(deprecatedEvent.details.verifiedAt, '2026-05-01T06:00:00.000Z');
    assert.equal(deprecatedEvent.details.lastValidatedAt, '2026-05-01T06:01:00.000Z');
    assert.equal(deprecatedEvent.details.catalogEntry.risk.catalogAction, 'deprecate');
    assert.equal(blockedEvent.details.catalogVersion, 'blocked-api-v1');
    assert.equal(blockedEvent.details.catalogStatus, 'blocked');
    assert.equal(blockedEvent.details.invalidationStatus, 'blocked');
    assert.equal(blockedEvent.details.verifiedAt, '2026-05-01T06:02:00.000Z');
    assert.equal(blockedEvent.details.lastValidatedAt, '2026-05-01T06:03:00.000Z');
    assert.equal(blockedEvent.details.catalogEntry.risk.catalogAction, 'block');
    assert.equal(deprecatedAudit.redactedPaths.includes('details.catalogEntry.auth.authorization'), true);
    assert.equal(blockedAudit.redactedPaths.includes('details.catalogEntry.auth.authorization'), true);

    for (const text of [deprecatedEventText, deprecatedAuditText, blockedEventText, blockedAuditText]) {
      assert.equal(text.includes('synthetic-deprecated-event-token'), false);
      assert.equal(text.includes('synthetic-blocked-event-token'), false);
    }

    await assert.rejects(
      writeApiCatalogVerificationEventArtifact(createCandidate({
        id: 'non-verified-blocked-event-candidate',
        status: 'candidate',
      }), {
        eventPath: nonVerifiedEventPath,
        redactionAuditPath: nonVerifiedAuditPath,
        metadata: {
          status: 'blocked',
        },
      }),
      /ApiCandidate must be verified before catalog entry/u,
    );
    await assert.rejects(access(nonVerifiedEventPath), /ENOENT/u);
    await assert.rejects(access(nonVerifiedAuditPath), /ENOENT/u);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog collection can include explicit blocked and deprecated verified entries', () => {
  const catalog = createApiCatalogCollection([
    createCandidate({ id: 'catalog-deprecated', status: 'verified' }),
    createCandidate({ id: 'catalog-blocked', status: 'verified' }),
  ], {
    metadataByCandidateId: {
      'catalog-deprecated': {
        status: 'deprecated',
        risk: {
          reasonCode: 'api-verification-failed',
          catalogAction: reasonCodeSummary('api-verification-failed').catalogAction,
        },
      },
      'catalog-blocked': {
        status: 'blocked',
        risk: {
          reasonCode: 'api-catalog-entry-blocked',
          catalogAction: reasonCodeSummary('api-catalog-entry-blocked').catalogAction,
        },
      },
    },
  });

  assert.equal(catalog.entries[0].status, 'deprecated');
  assert.equal(catalog.entries[0].risk.catalogAction, 'deprecate');
  assert.equal(catalog.entries[1].status, 'blocked');
  assert.equal(catalog.entries[1].risk.catalogAction, 'block');
});

test('ApiCatalog terminal entries cannot produce active index summaries', () => {
  const catalog = createApiCatalogCollection([
    createCandidate({ id: 'catalog-terminal-valid', status: 'verified' }),
  ]);
  const malformedDeprecatedCatalog = {
    ...catalog,
    entries: [{
      ...catalog.entries[0],
      status: 'deprecated',
      invalidationStatus: 'active',
      risk: {
        reasonCode: 'api-verification-failed',
        catalogAction: reasonCodeSummary('api-verification-failed').catalogAction,
      },
    }],
  };

  assert.throws(
    () => createApiCatalogEntryFromCandidate(createCandidate({
      id: 'catalog-terminal-deprecated-active',
      status: 'verified',
    }), {
      status: 'deprecated',
      invalidationStatus: 'active',
    }),
    /deprecated status must not use active invalidationStatus/u,
  );
  assert.throws(
    () => createApiCatalogCollection([
      createCandidate({ id: 'catalog-terminal-blocked-active', status: 'verified' }),
    ], {
      metadataByCandidateId: {
        'catalog-terminal-blocked-active': {
          status: 'blocked',
          invalidationStatus: 'active',
        },
      },
    }),
    /blocked status must not use active invalidationStatus/u,
  );
  assert.throws(
    () => createApiCatalogIndex([malformedDeprecatedCatalog]),
    /deprecated status must not use active invalidationStatus/u,
  );
});

test('ApiCatalog collection status transition updates verified entries with safe summaries', () => {
  const catalog = createApiCatalogCollection([
    createCandidate({
      id: 'transition-active',
      siteKey: 'fixture-site',
      status: 'verified',
      endpoint: {
        method: 'GET',
        url: 'https://fixture.invalid/api/active?access_token=synthetic-transition-token',
      },
      request: {
        headers: {
          authorization: 'Bearer synthetic-transition-token',
        },
      },
    }),
    createCandidate({
      id: 'transition-stale',
      siteKey: 'fixture-site',
      status: 'verified',
    }),
  ], {
    generatedAt: '2026-05-02T02:50:00.000Z',
    catalogId: 'transition-catalog',
    catalogVersion: 'transition-v1',
  });

  const stale = transitionApiCatalogCollectionEntryStatus(catalog, {
    candidateId: 'transition-active',
    invalidationStatus: 'stale',
    transitionedAt: '2026-05-02T02:51:00.000Z',
    reasonCode: 'api-catalog-endpoint-expired',
    catalogAction: 'free-text-must-not-win',
  });
  assert.equal(stale.entries[0].status, 'cataloged');
  assert.equal(stale.entries[0].invalidationStatus, 'stale');
  assert.equal(stale.entries[0].risk.reasonCode, 'api-catalog-endpoint-expired');
  assert.equal(stale.entries[0].risk.catalogAction, 'deprecate');
  assert.deepEqual(reasonCodeSummary(stale.entries[0].risk.reasonCode), {
    code: 'api-catalog-endpoint-expired',
    family: 'api',
    retryable: true,
    cooldownNeeded: false,
    isolationNeeded: false,
    manualRecoveryNeeded: false,
    degradable: false,
    artifactWriteAllowed: true,
    catalogAction: 'deprecate',
  });
  assert.equal(stale.entries[0].risk.catalogAction.includes('free-text'), false);
  assert.equal(stale.entries[0].lastValidatedAt, '2026-05-02T02:51:00.000Z');

  const blocked = transitionApiCatalogCollectionEntryStatus(stale, {
    candidateId: 'transition-stale',
    status: 'blocked',
    transitionedAt: '2026-05-02T02:52:00.000Z',
    reasonCode: 'api-catalog-entry-blocked',
  });
  assert.equal(blocked.entries[1].status, 'blocked');
  assert.equal(blocked.entries[1].invalidationStatus, 'blocked');
  assert.equal(blocked.entries[1].risk.catalogAction, 'block');

  const event = createApiCatalogCollectionLifecycleEvent(blocked, {
    createdAt: '2026-05-02T02:52:00.000Z',
    traceId: 'transition-trace',
    correlationId: 'transition-correlation',
  });
  const index = createApiCatalogIndex([blocked], {
    generatedAt: '2026-05-02T02:53:00.000Z',
  });

  assert.deepEqual(event.details.statuses, {
    blocked: 1,
    cataloged: 1,
  });
  assert.deepEqual(event.details.invalidationStatuses, {
    blocked: 1,
    stale: 1,
  });
  assert.deepEqual(event.details.reasonCodes, {
    'api-catalog-endpoint-expired': 1,
    'api-catalog-entry-blocked': 1,
  });
  assert.deepEqual(event.details.reasonRecoveries, {
    'api-catalog-endpoint-expired': reasonCodeSummary('api-catalog-endpoint-expired'),
    'api-catalog-entry-blocked': reasonCodeSummary('api-catalog-entry-blocked'),
  });
  assert.deepEqual(index.catalogs[0].statuses, {
    blocked: 1,
    cataloged: 1,
  });
  assert.deepEqual(index.catalogs[0].invalidationStatuses, {
    blocked: 1,
    stale: 1,
  });
  assert.deepEqual(index.catalogs[0].reasonCodes, {
    'api-catalog-endpoint-expired': 1,
    'api-catalog-entry-blocked': 1,
  });
  assert.equal(JSON.stringify(event).includes('"endpoint"'), false);
  assert.equal(JSON.stringify(event).includes('"request"'), false);
  assert.equal(JSON.stringify(index).includes('synthetic-transition-token'), false);
});

test('ApiCatalog collection status transition artifact writes guarded summaries only', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-status-transition-'));
  try {
    const catalogPath = path.join(runDir, 'api-catalog.json');
    const catalogAuditPath = path.join(runDir, 'api-catalog.redaction-audit.json');
    const transitionEventPath = path.join(runDir, 'api-catalog-transition.lifecycle-event.json');
    const transitionEventAuditPath = path.join(runDir, 'api-catalog-transition.lifecycle-event.redaction-audit.json');
    await writeApiCatalogCollectionArtifact([
      createCandidate({
        id: 'transition-artifact-candidate',
        siteKey: 'fixture-site',
        status: 'verified',
        endpoint: {
          method: 'GET',
          url: 'https://fixture.invalid/api/items?access_token=synthetic-transition-artifact-token',
        },
        request: {
          headers: {
            authorization: 'Bearer synthetic-transition-artifact-token',
          },
          body: {
            csrf: 'synthetic-transition-artifact-csrf',
            safe: true,
          },
        },
      }),
    ], {
      catalogPath,
      redactionAuditPath: catalogAuditPath,
      generatedAt: '2026-05-02T03:00:00.000Z',
      catalogId: 'transition-artifact-catalog',
      catalogVersion: 'transition-artifact-v1',
    });

    const result = await writeApiCatalogCollectionStatusTransitionArtifact({
      catalogPath,
      redactionAuditPath: catalogAuditPath,
      lifecycleEventPath: transitionEventPath,
      lifecycleEventRedactionAuditPath: transitionEventAuditPath,
      lifecycleEventCreatedAt: '2026-05-02T03:01:00.000Z',
      lifecycleEventTraceId: 'transition-artifact-trace',
      lifecycleEventCorrelationId: 'transition-artifact-correlation',
      lifecycleEventTaskType: 'api-catalog-maintenance',
      lifecycleEventAdapterVersion: 'fixture-adapter-v1',
      candidateId: 'transition-artifact-candidate',
      invalidationStatus: 'stale',
      transitionedAt: '2026-05-02T03:01:00.000Z',
      reasonCode: 'api-catalog-endpoint-expired',
    });

    const catalogText = await readFile(catalogPath, 'utf8');
    const catalogAuditText = await readFile(catalogAuditPath, 'utf8');
    const eventText = await readFile(transitionEventPath, 'utf8');
    const eventAuditText = await readFile(transitionEventAuditPath, 'utf8');
    const persisted = JSON.parse(catalogText);
    const event = JSON.parse(eventText);

    assert.equal(result.catalog.entries[0].status, 'cataloged');
    assert.equal(result.catalog.entries[0].invalidationStatus, 'stale');
    assert.equal(result.catalog.entries[0].risk.reasonCode, 'api-catalog-endpoint-expired');
    assert.equal(result.catalog.entries[0].risk.catalogAction, 'deprecate');
    assert.equal(persisted.entries[0].lastValidatedAt, '2026-05-02T03:01:00.000Z');
    assert.equal(assertSchemaCompatible('LifecycleEvent', event), true);
    assert.equal(assertLifecycleEventObservabilityFields(event, {
      requiredFields: [
        'traceId',
        'correlationId',
        'taskId',
        'siteKey',
        'taskType',
        'adapterVersion',
        'reasonCode',
      ],
      requiredDetailFields: [
        'catalogId',
        'catalogVersion',
        'generatedAt',
        'latestValidatedAt',
        'entryCount',
        'siteKeys',
        'statuses',
        'invalidationStatuses',
        'reasonCodes',
        'reasonRecoveries',
      ],
    }), true);
    assert.equal(event.eventType, 'api.catalog.collection.written');
    assert.deepEqual(event.details.statuses, { cataloged: 1 });
    assert.deepEqual(event.details.invalidationStatuses, { stale: 1 });
    assert.deepEqual(event.details.reasonCodes, { 'api-catalog-endpoint-expired': 1 });
    assert.deepEqual(event.details.reasonRecoveries, {
      'api-catalog-endpoint-expired': reasonCodeSummary('api-catalog-endpoint-expired'),
    });
    assert.equal(event.details.generatedAt, '2026-05-02T03:01:00.000Z');
    assert.equal(event.traceId, 'transition-artifact-trace');
    assert.equal(event.correlationId, 'transition-artifact-correlation');
    assert.equal(event.taskId, 'transition-artifact-catalog');
    assert.equal(event.siteKey, 'fixture-site');
    assert.equal(event.taskType, 'api-catalog-maintenance');
    assert.equal(event.adapterVersion, 'fixture-adapter-v1');
    assert.equal(event.reasonCode, 'api-catalog-endpoint-expired');

    for (const unsafe of ['endpoint', 'request', 'auth', 'body', 'query']) {
      assert.equal(eventText.includes(`"${unsafe}"`), false);
    }
    for (const text of [catalogText, catalogAuditText, eventText, eventAuditText]) {
      assert.equal(text.includes('synthetic-transition-artifact-token'), false);
      assert.equal(text.includes('synthetic-transition-artifact-csrf'), false);
    }
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('ApiCatalog collection status transition artifact rejects invalid transitions before partial writes', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-status-transition-invalid-'));
  try {
    const catalogPath = path.join(runDir, 'api-catalog.json');
    const catalogAuditPath = path.join(runDir, 'api-catalog.redaction-audit.json');
    const transitionEventPath = path.join(runDir, 'api-catalog-transition.lifecycle-event.json');
    const transitionEventAuditPath = path.join(runDir, 'api-catalog-transition.lifecycle-event.redaction-audit.json');
    await writeApiCatalogCollectionArtifact([
      createCandidate({
        id: 'transition-artifact-valid',
        status: 'verified',
      }),
    ], {
      catalogPath,
      redactionAuditPath: catalogAuditPath,
      generatedAt: '2026-05-02T03:05:00.000Z',
      catalogId: 'transition-invalid-catalog',
      catalogVersion: 'transition-invalid-v1',
    });
    const beforeCatalogText = await readFile(catalogPath, 'utf8');
    const beforeAuditText = await readFile(catalogAuditPath, 'utf8');

    await assert.rejects(
      writeApiCatalogCollectionStatusTransitionArtifact({
        catalogPath,
        redactionAuditPath: catalogAuditPath,
        lifecycleEventPath: transitionEventPath,
        lifecycleEventRedactionAuditPath: transitionEventAuditPath,
        candidateId: 'transition-artifact-missing',
        invalidationStatus: 'blocked',
        transitionedAt: '2026-05-02T03:06:00.000Z',
        reasonCode: 'api-catalog-entry-blocked',
      }),
      /candidate not found/u,
    );

    assert.equal(await readFile(catalogPath, 'utf8'), beforeCatalogText);
    assert.equal(await readFile(catalogAuditPath, 'utf8'), beforeAuditText);
    await assert.rejects(access(transitionEventPath), /ENOENT/u);
    await assert.rejects(access(transitionEventAuditPath), /ENOENT/u);

    for (const lifecycleStatus of ['observed', 'candidate', 'verified']) {
      await assert.rejects(
        writeApiCatalogCollectionStatusTransitionArtifact({
          catalogPath,
          redactionAuditPath: catalogAuditPath,
          lifecycleEventPath: transitionEventPath,
          lifecycleEventRedactionAuditPath: transitionEventAuditPath,
          candidateId: 'transition-artifact-valid',
          status: lifecycleStatus,
          transitionedAt: '2026-05-02T03:06:30.000Z',
          reasonCode: 'api-verification-failed',
        }),
        new RegExp(`must not use ApiCandidate lifecycle status: ${lifecycleStatus}`, 'u'),
      );
      assert.equal(await readFile(catalogPath, 'utf8'), beforeCatalogText);
      assert.equal(await readFile(catalogAuditPath, 'utf8'), beforeAuditText);
      await assert.rejects(access(transitionEventPath), /ENOENT/u);
      await assert.rejects(access(transitionEventAuditPath), /ENOENT/u);
    }

    const incompatibleCatalogPath = path.join(runDir, 'incompatible-api-catalog.json');
    const incompatibleAuditPath = path.join(runDir, 'incompatible-api-catalog.redaction-audit.json');
    const incompatibleEventPath = path.join(runDir, 'incompatible-api-catalog.lifecycle-event.json');
    const incompatibleEventAuditPath = path.join(
      runDir,
      'incompatible-api-catalog.lifecycle-event.redaction-audit.json',
    );
    const incompatibleCatalogText = `${JSON.stringify({
      schemaVersion: API_CATALOG_SCHEMA_VERSION + 1,
      entries: [],
    })}\n`;
    const incompatibleAuditText = '{"sentinel":"audit-before-incompatible-status-transition"}\n';
    await writeFile(incompatibleCatalogPath, incompatibleCatalogText, 'utf8');
    await writeFile(incompatibleAuditPath, incompatibleAuditText, 'utf8');
    await assert.rejects(
      writeApiCatalogCollectionStatusTransitionArtifact({
        catalogPath: incompatibleCatalogPath,
        redactionAuditPath: incompatibleAuditPath,
        lifecycleEventPath: incompatibleEventPath,
        lifecycleEventRedactionAuditPath: incompatibleEventAuditPath,
        candidateId: 'transition-artifact-valid',
        invalidationStatus: 'stale',
        transitionedAt: '2026-05-02T03:07:00.000Z',
        reasonCode: 'api-catalog-endpoint-expired',
      }),
      /not compatible/u,
    );
    assert.equal(await readFile(incompatibleCatalogPath, 'utf8'), incompatibleCatalogText);
    assert.equal(await readFile(incompatibleAuditPath, 'utf8'), incompatibleAuditText);
    await assert.rejects(access(incompatibleEventPath), /ENOENT/u);
    await assert.rejects(access(incompatibleEventAuditPath), /ENOENT/u);

    await assert.rejects(
      writeApiCatalogCollectionStatusTransitionArtifact({
        catalogPath: path.join(runDir, 'missing-catalog.json'),
        candidateId: 'transition-artifact-valid',
        invalidationStatus: 'stale',
      }),
      /requires an existing catalog/u,
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('ApiCatalog collection status transition rolls back catalog when audit replace fails', {
  skip: process.platform !== 'win32',
}, async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-status-transition-rollback-'));
  const catalogPath = path.join(runDir, 'api-catalog.json');
  const catalogAuditPath = path.join(runDir, 'api-catalog.redaction-audit.json');
  const transitionEventPath = path.join(runDir, 'api-catalog-transition.lifecycle-event.json');
  const transitionEventAuditPath = path.join(runDir, 'api-catalog-transition.lifecycle-event.redaction-audit.json');
  try {
    await writeApiCatalogCollectionArtifact([
      createCandidate({
        id: 'transition-rollback-valid',
        status: 'verified',
        endpoint: {
          method: 'GET',
          url: 'https://fixture.invalid/api/rollback?access_token=synthetic-transition-rollback-token',
        },
      }),
    ], {
      catalogPath,
      redactionAuditPath: catalogAuditPath,
      generatedAt: '2026-05-02T03:08:00.000Z',
      catalogId: 'transition-rollback-catalog',
      catalogVersion: 'transition-rollback-v1',
    });
    const beforeCatalogText = await readFile(catalogPath, 'utf8');
    const beforeAuditText = await readFile(catalogAuditPath, 'utf8');
    await chmod(catalogAuditPath, 0o444);

    await assert.rejects(
      writeApiCatalogCollectionStatusTransitionArtifact({
        catalogPath,
        redactionAuditPath: catalogAuditPath,
        lifecycleEventPath: transitionEventPath,
        lifecycleEventRedactionAuditPath: transitionEventAuditPath,
        candidateId: 'transition-rollback-valid',
        invalidationStatus: 'stale',
        transitionedAt: '2026-05-02T03:09:00.000Z',
        reasonCode: 'api-catalog-endpoint-expired',
      }),
      (error) => {
        assert.match(error?.code ?? error?.message ?? '', /EPERM|EACCES|operation not permitted|access denied/iu);
        assert.doesNotMatch(JSON.stringify(error), /synthetic-transition-rollback-token|authorization|cookie|csrf|sessionId/iu);
        return true;
      },
    );
    await chmod(catalogAuditPath, 0o666);

    assert.equal(await readFile(catalogPath, 'utf8'), beforeCatalogText);
    assert.equal(await readFile(catalogAuditPath, 'utf8'), beforeAuditText);
    await assert.rejects(access(transitionEventPath), /ENOENT/u);
    await assert.rejects(access(transitionEventAuditPath), /ENOENT/u);
  } finally {
    await chmod(catalogAuditPath, 0o666).catch(() => {});
    await rm(runDir, { recursive: true, force: true });
  }
});

test('runtime ApiCatalog maintenance helper consumes explicit stale and blocked evidence only', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-maintenance-'));
  try {
    const catalogPath = path.join(runDir, 'api-catalog.json');
    const catalogAuditPath = path.join(runDir, 'api-catalog.redaction-audit.json');
    const eventPath = path.join(runDir, 'api-catalog-maintenance.lifecycle-event.json');
    const eventAuditPath = path.join(runDir, 'api-catalog-maintenance.lifecycle-event.redaction-audit.json');
    await writeApiCatalogCollectionArtifact([
      createCandidate({
        id: 'maintenance-stale-candidate',
        siteKey: 'fixture-site',
        status: 'verified',
        endpoint: {
          method: 'GET',
          url: 'https://fixture.invalid/api/maintenance?access_token=synthetic-maintenance-token',
        },
        request: {
          headers: {
            authorization: 'Bearer synthetic-maintenance-token',
          },
          body: {
            csrf: 'synthetic-maintenance-csrf',
          },
        },
      }),
      createCandidate({
        id: 'maintenance-blocked-candidate',
        siteKey: 'fixture-site',
        status: 'verified',
      }),
      createCandidate({
        id: 'maintenance-deprecated-candidate',
        siteKey: 'fixture-site',
        status: 'verified',
      }),
    ], {
      catalogPath,
      redactionAuditPath: catalogAuditPath,
      generatedAt: '2026-05-02T03:10:00.000Z',
      catalogId: 'maintenance-catalog',
      catalogVersion: 'maintenance-v1',
    });

    const staleResult = await writeRuntimeApiCatalogMaintenanceArtifacts({
      maintenanceEvidence: {
        candidateId: 'maintenance-stale-candidate',
        invalidationStatus: 'stale',
        reasonCode: 'api-catalog-endpoint-expired',
        verifiedAt: '2026-05-02T03:11:00.000Z',
        verifierId: 'synthetic-maintenance-verifier',
        details: {
          verificationKind: 'explicit-maintenance-fixture',
          safeSummary: 'response fixture no longer matches catalog schema',
        },
      },
    }, {
      catalogPath,
      redactionAuditPath: catalogAuditPath,
      lifecycleEventPath: eventPath,
      lifecycleEventRedactionAuditPath: eventAuditPath,
      lifecycleEventCreatedAt: '2026-05-02T03:11:00.000Z',
      lifecycleEventTraceId: 'maintenance-trace',
      lifecycleEventCorrelationId: 'maintenance-correlation',
      lifecycleEventTaskType: 'api-catalog-maintenance',
      lifecycleEventAdapterVersion: 'fixture-adapter-v1',
    });
    const blockedResult = await writeRuntimeApiCatalogMaintenanceArtifacts({
      maintenanceEvidence: {
        candidateId: 'maintenance-blocked-candidate',
        status: 'blocked',
        reasonCode: 'api-catalog-entry-blocked',
        verifiedAt: '2026-05-02T03:12:00.000Z',
        verifierId: 'synthetic-maintenance-verifier',
      },
    }, {
      catalogPath,
      redactionAuditPath: catalogAuditPath,
      lifecycleEventPath: eventPath,
      lifecycleEventRedactionAuditPath: eventAuditPath,
      lifecycleEventCreatedAt: '2026-05-02T03:12:00.000Z',
      lifecycleEventTraceId: 'maintenance-trace',
      lifecycleEventCorrelationId: 'maintenance-correlation',
      lifecycleEventTaskType: 'api-catalog-maintenance',
      lifecycleEventAdapterVersion: 'fixture-adapter-v1',
    });
    const deprecatedResult = await writeRuntimeApiCatalogMaintenanceArtifacts({
      maintenanceEvidence: {
        candidateId: 'maintenance-deprecated-candidate',
        status: 'deprecated',
        reasonCode: 'api-catalog-endpoint-expired',
        verifiedAt: '2026-05-02T03:13:00.000Z',
        verifierId: 'synthetic-maintenance-verifier',
      },
    }, {
      catalogPath,
      redactionAuditPath: catalogAuditPath,
      lifecycleEventPath: eventPath,
      lifecycleEventRedactionAuditPath: eventAuditPath,
      lifecycleEventCreatedAt: '2026-05-02T03:13:00.000Z',
      lifecycleEventTraceId: 'maintenance-trace',
      lifecycleEventCorrelationId: 'maintenance-correlation',
      lifecycleEventTaskType: 'api-catalog-maintenance',
      lifecycleEventAdapterVersion: 'fixture-adapter-v1',
    });

    const catalogText = await readFile(catalogPath, 'utf8');
    const auditText = await readFile(catalogAuditPath, 'utf8');
    const eventText = await readFile(eventPath, 'utf8');
    const eventAuditText = await readFile(eventAuditPath, 'utf8');
    const catalog = JSON.parse(catalogText);
    const event = JSON.parse(eventText);

    assert.equal(staleResult.maintenanceEvidence.invalidationStatus, 'stale');
    assert.equal(blockedResult.maintenanceEvidence.invalidationStatus, 'blocked');
    assert.equal(deprecatedResult.maintenanceEvidence.invalidationStatus, 'deprecated');
    const entriesByCandidateId = new Map(catalog.entries.map((entry) => [entry.candidateId, entry]));
    assert.equal(entriesByCandidateId.get('maintenance-blocked-candidate').status, 'blocked');
    assert.equal(entriesByCandidateId.get('maintenance-blocked-candidate').risk.reasonCode, 'api-catalog-entry-blocked');
    assert.equal(entriesByCandidateId.get('maintenance-deprecated-candidate').status, 'deprecated');
    assert.equal(entriesByCandidateId.get('maintenance-deprecated-candidate').risk.reasonCode, 'api-catalog-endpoint-expired');
    assert.equal(entriesByCandidateId.get('maintenance-stale-candidate').status, 'cataloged');
    assert.equal(entriesByCandidateId.get('maintenance-stale-candidate').invalidationStatus, 'stale');
    assert.equal(entriesByCandidateId.get('maintenance-stale-candidate').risk.reasonCode, 'api-catalog-endpoint-expired');
    assert.equal(assertSchemaCompatible('LifecycleEvent', event), true);
    assert.equal(assertLifecycleEventObservabilityFields(event, {
      requiredFields: [
        'traceId',
        'correlationId',
        'taskId',
        'siteKey',
        'taskType',
        'adapterVersion',
        'reasonCode',
      ],
      requiredDetailFields: [
        'catalogId',
        'catalogVersion',
        'generatedAt',
        'latestValidatedAt',
        'entryCount',
        'siteKeys',
        'statuses',
        'invalidationStatuses',
        'reasonCodes',
        'reasonRecoveries',
      ],
    }), true);
    assert.equal(event.eventType, 'api.catalog.collection.written');
    assert.equal(event.traceId, 'maintenance-trace');
    assert.equal(event.correlationId, 'maintenance-correlation');
    assert.equal(event.taskId, 'maintenance-catalog');
    assert.equal(event.siteKey, 'fixture-site');
    assert.equal(event.taskType, 'api-catalog-maintenance');
    assert.equal(event.adapterVersion, 'fixture-adapter-v1');
    assert.equal(event.reasonCode, 'api-catalog-endpoint-expired');
    assert.deepEqual(event.details.statuses, {
      blocked: 1,
      cataloged: 1,
      deprecated: 1,
    });
    assert.deepEqual(event.details.invalidationStatuses, {
      blocked: 1,
      deprecated: 1,
      stale: 1,
    });
    assert.deepEqual(event.details.reasonCodes, {
      'api-catalog-endpoint-expired': 2,
      'api-catalog-entry-blocked': 1,
    });
    assert.deepEqual(event.details.reasonRecoveries, {
      'api-catalog-endpoint-expired': reasonCodeSummary('api-catalog-endpoint-expired'),
      'api-catalog-entry-blocked': reasonCodeSummary('api-catalog-entry-blocked'),
    });
    for (const unsafe of ['endpoint', 'request', 'auth', 'body', 'query']) {
      assert.equal(eventText.includes(`"${unsafe}"`), false);
    }
    for (const text of [catalogText, auditText, eventText, eventAuditText]) {
      assert.equal(text.includes('synthetic-maintenance-token'), false);
      assert.equal(text.includes('synthetic-maintenance-csrf'), false);
    }
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('runtime ApiCatalog maintenance helper rejects promotion and unsafe evidence before writes', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-maintenance-invalid-'));
  try {
    const catalogPath = path.join(runDir, 'api-catalog.json');
    const catalogAuditPath = path.join(runDir, 'api-catalog.redaction-audit.json');
    const eventPath = path.join(runDir, 'api-catalog-maintenance.lifecycle-event.json');
    const eventAuditPath = path.join(runDir, 'api-catalog-maintenance.lifecycle-event.redaction-audit.json');
    await writeApiCatalogCollectionArtifact([
      createCandidate({
        id: 'maintenance-valid-candidate',
        status: 'verified',
      }),
    ], {
      catalogPath,
      redactionAuditPath: catalogAuditPath,
      generatedAt: '2026-05-02T03:15:00.000Z',
    });
    const beforeCatalogText = await readFile(catalogPath, 'utf8');
    const beforeAuditText = await readFile(catalogAuditPath, 'utf8');

    await assert.rejects(
      writeRuntimeApiCatalogMaintenanceArtifacts({
        maintenanceEvidence: {
          candidateId: 'maintenance-valid-candidate',
          status: 'active',
          reasonCode: 'api-verification-failed',
          verifiedAt: '2026-05-02T03:16:00.000Z',
          verifierId: 'synthetic-maintenance-verifier',
        },
      }, {
        catalogPath,
        redactionAuditPath: catalogAuditPath,
        lifecycleEventPath: eventPath,
        lifecycleEventRedactionAuditPath: eventAuditPath,
      }),
      (error) => {
        const recovery = reasonCodeSummary('api-verification-failed');
        assert.equal(error.name, 'ApiCatalogMaintenanceFailure');
        assert.equal(error.message, 'ApiCatalog maintenance failed before artifact write');
        assert.equal(error.reasonCode, recovery.code);
        assert.equal(error.retryable, recovery.retryable);
        assert.equal(error.cooldownNeeded, recovery.cooldownNeeded);
        assert.equal(error.isolationNeeded, recovery.isolationNeeded);
        assert.equal(error.manualRecoveryNeeded, recovery.manualRecoveryNeeded);
        assert.equal(error.degradable, recovery.degradable);
        assert.equal(error.artifactWriteAllowed, recovery.artifactWriteAllowed);
        assert.equal(error.catalogAction, recovery.catalogAction);
        assert.equal(error.failureMode, 'api-catalog-maintenance-failed');
        assert.deepEqual(error.causeSummary, { name: 'Error' });
        assert.equal(Object.hasOwn(error, 'cause'), false);
        return true;
      },
    );
    const verificationFailureRecovery = reasonCodeSummary('api-verification-failed');
    for (const status of ['observed', 'candidate', 'verified']) {
      await assert.rejects(
        writeRuntimeApiCatalogMaintenanceArtifacts({
          maintenanceEvidence: {
            candidateId: 'maintenance-valid-candidate',
            status,
            reasonCode: 'api-verification-failed',
            verifiedAt: '2026-05-02T03:16:30.000Z',
            verifierId: 'synthetic-maintenance-verifier',
          },
        }, {
          catalogPath,
          redactionAuditPath: catalogAuditPath,
          lifecycleEventPath: eventPath,
          lifecycleEventRedactionAuditPath: eventAuditPath,
        }),
        (error) => {
          assert.equal(error.name, 'ApiCatalogMaintenanceFailure');
          assert.equal(error.message, 'ApiCatalog maintenance failed before artifact write');
          assert.equal(error.reasonCode, verificationFailureRecovery.code);
          assert.equal(error.retryable, verificationFailureRecovery.retryable);
          assert.equal(error.cooldownNeeded, verificationFailureRecovery.cooldownNeeded);
          assert.equal(error.isolationNeeded, verificationFailureRecovery.isolationNeeded);
          assert.equal(error.manualRecoveryNeeded, verificationFailureRecovery.manualRecoveryNeeded);
          assert.equal(error.degradable, verificationFailureRecovery.degradable);
          assert.equal(error.artifactWriteAllowed, verificationFailureRecovery.artifactWriteAllowed);
          assert.equal(error.catalogAction, verificationFailureRecovery.catalogAction);
          assert.equal(error.failureMode, 'api-catalog-maintenance-failed');
          assert.deepEqual(error.causeSummary, { name: 'Error' });
          assert.equal(Object.hasOwn(error, 'cause'), false);
          return true;
        },
      );
    }
    await assert.rejects(
      writeRuntimeApiCatalogMaintenanceArtifacts({
        maintenanceEvidence: {
          candidateId: 'maintenance-valid-candidate',
          status: 'Authorization: Bearer synthetic-maintenance-leak',
          reasonCode: 'api-verification-failed',
          verifiedAt: '2026-05-02T03:16:45.000Z',
          verifierId: 'synthetic-maintenance-verifier',
        },
      }, {
        catalogPath,
        redactionAuditPath: catalogAuditPath,
        lifecycleEventPath: eventPath,
        lifecycleEventRedactionAuditPath: eventAuditPath,
      }),
      (error) => {
        const serialized = JSON.stringify(error);
        assert.equal(error.name, 'ApiCatalogMaintenanceFailure');
        assert.equal(error.message, 'ApiCatalog maintenance failed before artifact write');
        assert.equal(error.reasonCode, verificationFailureRecovery.code);
        assert.equal(error.artifactWriteAllowed, verificationFailureRecovery.artifactWriteAllowed);
        assert.deepEqual(error.causeSummary, { name: 'Error' });
        assert.equal(Object.hasOwn(error, 'cause'), false);
        assert.equal(error.message.includes('synthetic-maintenance-leak'), false);
        assert.equal(serialized.includes('synthetic-maintenance-leak'), false);
        assert.equal(JSON.stringify(error.causeSummary).includes('synthetic-maintenance-leak'), false);
        return true;
      },
    );
    await assert.rejects(
      writeRuntimeApiCatalogMaintenanceArtifacts({
        maintenanceEvidence: {
          candidateId: 'maintenance-valid-candidate',
          status: 'blocked',
          reasonCode: 'api-catalog-entry-blocked',
          verifiedAt: '2026-05-02T03:17:00.000Z',
          verifierId: 'synthetic-maintenance-verifier',
          details: {
            authorization: 'Bearer synthetic-maintenance-unsafe-token',
          },
        },
      }, {
        catalogPath,
        redactionAuditPath: catalogAuditPath,
        lifecycleEventPath: eventPath,
        lifecycleEventRedactionAuditPath: eventAuditPath,
      }),
      (error) => {
        const serialized = JSON.stringify(error);
        const recovery = reasonCodeSummary('api-catalog-entry-blocked');
        assert.equal(error.name, 'ApiCatalogMaintenanceFailure');
        assert.equal(error.message, 'ApiCatalog maintenance failed before artifact write');
        assert.equal(error.reasonCode, recovery.code);
        assert.equal(error.retryable, recovery.retryable);
        assert.equal(error.cooldownNeeded, recovery.cooldownNeeded);
        assert.equal(error.isolationNeeded, recovery.isolationNeeded);
        assert.equal(error.manualRecoveryNeeded, recovery.manualRecoveryNeeded);
        assert.equal(error.degradable, recovery.degradable);
        assert.equal(error.artifactWriteAllowed, recovery.artifactWriteAllowed);
        assert.equal(error.catalogAction, recovery.catalogAction);
        assert.equal(error.failureMode, 'api-catalog-maintenance-failed');
        assert.deepEqual(error.causeSummary, { name: 'Error' });
        assert.equal(Object.hasOwn(error, 'cause'), false);
        assert.equal(error.message.includes('synthetic-maintenance-unsafe-token'), false);
        assert.equal(serialized.includes('synthetic-maintenance-unsafe-token'), false);
        assert.equal(JSON.stringify(error.causeSummary).includes('synthetic-maintenance-unsafe-token'), false);
        return true;
      },
    );
    await assert.rejects(
      writeRuntimeApiCatalogMaintenanceArtifacts({
        maintenanceEvidence: {
          candidateId: 'maintenance-missing-candidate',
          status: 'blocked',
          reasonCode: 'api-catalog-entry-blocked',
          verifiedAt: '2026-05-02T03:18:00.000Z',
          verifierId: 'synthetic-maintenance-verifier',
        },
      }, {
        catalogPath,
        redactionAuditPath: catalogAuditPath,
        lifecycleEventPath: eventPath,
        lifecycleEventRedactionAuditPath: eventAuditPath,
      }),
      /candidate not found/u,
    );

    assert.equal(await readFile(catalogPath, 'utf8'), beforeCatalogText);
    assert.equal(await readFile(catalogAuditPath, 'utf8'), beforeAuditText);
    await assert.rejects(access(eventPath), /ENOENT/u);
    await assert.rejects(access(eventAuditPath), /ENOENT/u);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('ApiCatalog collection status transition rejects invalid inputs before writes', () => {
  const catalog = createApiCatalogCollection([
    createCandidate({ id: 'transition-valid', status: 'verified' }),
  ]);

  assert.throws(
    () => transitionApiCatalogCollectionEntryStatus(catalog, {
      invalidationStatus: 'stale',
    }),
    /candidateId is required/u,
  );
  assert.throws(
    () => transitionApiCatalogCollectionEntryStatus(catalog, {
      candidateId: 'transition-valid',
      invalidationStatus: 'unknown',
    }),
    /Unsupported ApiCatalogEntry invalidationStatus/u,
  );
  for (const status of ['observed', 'candidate', 'verified']) {
    assert.throws(
      () => transitionApiCatalogCollectionEntryStatus(catalog, {
        candidateId: 'transition-valid',
        status,
      }),
      new RegExp(`must not use ApiCandidate lifecycle status: ${status}`, 'u'),
    );
  }
  assert.throws(
    () => transitionApiCatalogCollectionEntryStatus(catalog, {
      candidateId: 'missing-candidate',
      invalidationStatus: 'blocked',
    }),
    /candidate not found/u,
  );
  assert.throws(
    () => transitionApiCatalogCollectionEntryStatus({
      ...catalog,
      schemaVersion: API_CATALOG_SCHEMA_VERSION + 1,
    }, {
      candidateId: 'transition-valid',
      invalidationStatus: 'stale',
    }),
    /ApiCatalog schemaVersion/u,
  );
  assert.throws(
    () => transitionApiCatalogCollectionEntryStatus({
      ...catalog,
      entries: [{
        ...catalog.entries[0],
        schemaVersion: API_CATALOG_ENTRY_SCHEMA_VERSION + 1,
      }],
    }, {
      candidateId: 'transition-valid',
      invalidationStatus: 'stale',
    }),
    /ApiCatalogEntry schemaVersion/u,
  );
  assert.throws(
    () => createApiCatalogCollection([
      createCandidate({ id: 'transition-non-verified', status: 'candidate' }),
    ]),
    /ApiCandidate must be verified before catalog entry/u,
  );
});

test('ApiCatalog index artifact preserves deprecated and blocked lifecycle summaries only', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-index-lifecycle-'));
  try {
    const catalog = createApiCatalogCollection([
      createCandidate({
        id: 'catalog-index-deprecated',
        siteKey: 'fixture-site',
        status: 'verified',
        endpoint: {
          method: 'GET',
          url: 'https://fixture.invalid/api/deprecated?access_token=synthetic-deprecated-index-token',
        },
      }),
      createCandidate({
        id: 'catalog-index-blocked',
        siteKey: 'fixture-site',
        status: 'verified',
        endpoint: {
          method: 'POST',
          url: 'https://fixture.invalid/api/blocked',
        },
        request: {
          headers: {
            authorization: 'Bearer synthetic-blocked-index-token',
          },
        },
      }),
    ], {
      catalogId: 'fixture-lifecycle-catalog',
      catalogVersion: 'fixture-lifecycle-v1',
      generatedAt: '2026-05-01T06:10:00.000Z',
      metadataByCandidateId: {
        'catalog-index-deprecated': {
          status: 'deprecated',
          invalidationStatus: 'deprecated',
          version: 'deprecated-api-v1',
          verifiedAt: '2026-05-01T06:00:00.000Z',
          lastValidatedAt: '2026-05-01T06:01:00.000Z',
          auth: {
            authorization: 'Bearer synthetic-deprecated-index-auth',
          },
          risk: {
            reasonCode: 'api-verification-failed',
            catalogAction: reasonCodeSummary('api-verification-failed').catalogAction,
          },
        },
        'catalog-index-blocked': {
          status: 'blocked',
          invalidationStatus: 'blocked',
          version: 'blocked-api-v1',
          verifiedAt: '2026-05-01T06:02:00.000Z',
          lastValidatedAt: '2026-05-01T06:03:00.000Z',
          auth: {
            authorization: 'Bearer synthetic-blocked-index-auth',
          },
          risk: {
            reasonCode: 'api-catalog-entry-blocked',
            catalogAction: reasonCodeSummary('api-catalog-entry-blocked').catalogAction,
          },
        },
      },
    });
    const indexPath = path.join(runDir, 'api-catalog-index.json');
    const auditPath = path.join(runDir, 'api-catalog-index.redaction-audit.json');
    const eventPath = path.join(runDir, 'api-catalog-index.lifecycle-event.json');
    const eventAuditPath = path.join(runDir, 'api-catalog-index.lifecycle-event.redaction-audit.json');

    const result = await writeApiCatalogIndexArtifact([catalog], {
      indexPath,
      redactionAuditPath: auditPath,
      lifecycleEventPath: eventPath,
      lifecycleEventRedactionAuditPath: eventAuditPath,
      lifecycleEventTraceId: 'catalog-index-lifecycle-trace',
      lifecycleEventCorrelationId: 'catalog-index-lifecycle-correlation',
      generatedAt: '2026-05-01T06:20:00.000Z',
      indexVersion: 'fixture-lifecycle-index-v1',
    });
    const indexText = await readFile(indexPath, 'utf8');
    const auditText = await readFile(auditPath, 'utf8');
    const eventText = await readFile(eventPath, 'utf8');
    const eventAuditText = await readFile(eventAuditPath, 'utf8');
    const persisted = JSON.parse(indexText);
    const event = JSON.parse(eventText);

    assert.equal(result.artifactPath, indexPath);
    assert.deepEqual(persisted.reasonCodes, {
      'api-catalog-entry-blocked': 1,
      'api-verification-failed': 1,
    });
    assert.deepEqual(persisted.catalogs[0].statuses, {
      blocked: 1,
      deprecated: 1,
    });
    assert.deepEqual(persisted.catalogs[0].invalidationStatuses, {
      blocked: 1,
      deprecated: 1,
    });
    assert.deepEqual(persisted.catalogs[0].reasonCodes, {
      'api-catalog-entry-blocked': 1,
      'api-verification-failed': 1,
    });
    assert.deepEqual(event.details.catalogs[0].statuses, {
      blocked: 1,
      deprecated: 1,
    });
    assert.deepEqual(event.details.catalogs[0].invalidationStatuses, {
      blocked: 1,
      deprecated: 1,
    });
    assert.deepEqual(event.details.catalogs[0].reasonCodes, {
      'api-catalog-entry-blocked': 1,
      'api-verification-failed': 1,
    });
    assert.deepEqual(event.details.reasonCodes, {
      'api-catalog-entry-blocked': 1,
      'api-verification-failed': 1,
    });
    assert.deepEqual(event.details.catalogs[0].reasonRecoveries, {
      'api-catalog-entry-blocked': reasonCodeSummary('api-catalog-entry-blocked'),
      'api-verification-failed': reasonCodeSummary('api-verification-failed'),
    });
    assert.deepEqual(event.details.reasonRecoveries, {
      'api-catalog-entry-blocked': reasonCodeSummary('api-catalog-entry-blocked'),
      'api-verification-failed': reasonCodeSummary('api-verification-failed'),
    });
    assert.equal(event.details.catalogs[0].latestValidatedAt, '2026-05-01T06:03:00.000Z');
    assert.equal(JSON.stringify(event).includes('"endpoint"'), false);
    assert.equal(JSON.stringify(event).includes('"auth"'), false);
    assert.equal(JSON.stringify(event).includes('catalogEntry'), false);

    for (const text of [indexText, auditText, eventText, eventAuditText]) {
      assert.equal(text.includes('synthetic-deprecated-index-token'), false);
      assert.equal(text.includes('synthetic-blocked-index-token'), false);
      assert.equal(text.includes('synthetic-deprecated-index-auth'), false);
      assert.equal(text.includes('synthetic-blocked-index-auth'), false);
    }
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCandidate artifact writer persists redacted candidates without catalog promotion', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-candidate-'));
  try {
    const candidatePath = path.join(runDir, 'candidates', 'candidate.json');
    const redactionAuditPath = path.join(runDir, 'candidates', 'candidate.redaction-audit.json');
    const catalogPath = path.join(runDir, 'catalog', 'candidate.json');
    const result = await writeApiCandidateArtifact(createCandidate({
      id: 'candidate-artifact-1',
      status: 'candidate',
      auth: {
        authorization: 'Bearer synthetic-candidate-auth-token',
      },
    }), {
      candidatePath,
      redactionAuditPath,
    });

    const artifactText = await readFile(candidatePath, 'utf8');
    const auditText = await readFile(redactionAuditPath, 'utf8');
    const artifact = JSON.parse(artifactText);
    const audit = JSON.parse(auditText);

    assert.equal(result.artifactPath, candidatePath);
    assert.equal(result.candidate.status, 'candidate');
    assert.deepEqual(result.redactionSummary, {
      redactedPathCount: 3,
      findingCount: 0,
    });
    assert.equal(artifact.schemaVersion, API_CANDIDATE_SCHEMA_VERSION);
    assert.equal(artifact.id, 'candidate-artifact-1');
    assert.equal(artifact.status, 'candidate');
    assert.equal(artifact.auth.authorization, REDACTION_PLACEHOLDER);
    assert.equal(artifact.request.headers.authorization, REDACTION_PLACEHOLDER);
    assert.equal(artifact.request.body.csrf, REDACTION_PLACEHOLDER);
    assert.equal(Object.hasOwn(artifact, 'redactionSummary'), false);
    assert.equal(Object.hasOwn(audit, 'redactionSummary'), false);
    assert.equal(Object.hasOwn(artifact, 'candidateId'), false);
    assert.equal(Object.hasOwn(artifact, 'version'), false);
    assert.equal(artifactText.includes('synthetic-api-token'), false);
    assert.equal(artifactText.includes('synthetic-candidate-auth-token'), false);
    assert.equal(artifactText.includes('synthetic-csrf-token'), false);
    assert.equal(artifactText.includes('redactionSummary'), false);
    assert.equal(audit.redactedPaths.includes('auth.authorization'), true);
    assert.equal(audit.redactedPaths.includes('request.headers.authorization'), true);
    assert.equal(auditText.includes('synthetic-candidate-auth-token'), false);
    assert.equal(auditText.includes('redactionSummary'), false);
    await assert.rejects(
      writeApiCatalogEntryArtifact(createCandidate({ status: 'candidate' }), { catalogPath }),
      /ApiCandidate must be verified before catalog entry/u,
    );
    await assert.rejects(
      access(catalogPath),
      /ENOENT/u,
    );
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCandidate artifact writer rejects missing or future schema versions before writing', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-candidate-version-reject-'));
  try {
    const missingVersionPath = path.join(runDir, 'missing.json');
    const futureVersionPath = path.join(runDir, 'future.json');
    const missingAuditPath = path.join(runDir, 'missing-audit.json');

    await assert.rejects(
      writeApiCandidateArtifact(withoutSchemaVersion(createCandidate()), { candidatePath: missingVersionPath }),
      /ApiCandidate schemaVersion is required/u,
    );
    await assert.rejects(
      writeApiCandidateArtifact(createCandidate({
        schemaVersion: API_CANDIDATE_SCHEMA_VERSION + 1,
      }), { candidatePath: futureVersionPath }),
      /not compatible/u,
    );
    await assert.rejects(
      writeApiCandidateArtifact(createCandidate(), { candidatePath: missingAuditPath }),
      /ApiCandidate redactionAuditPath is required/u,
    );
    await assert.rejects(access(missingVersionPath), /ENOENT/u);
    await assert.rejects(access(futureVersionPath), /ENOENT/u);
    await assert.rejects(access(missingAuditPath), /ENOENT/u);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalogEntry artifact writer persists only verified redacted catalog entries', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-entry-'));
  try {
    const catalogPath = path.join(runDir, 'catalog', 'example.json');
    const redactionAuditPath = path.join(runDir, 'catalog', 'example.redaction-audit.json');
    const result = await writeApiCatalogEntryArtifact(createCandidate({
      id: 'candidate-to-persist',
      status: 'verified',
      auth: {
        authorization: 'Bearer synthetic-catalog-token',
      },
      observedAt: '2026-04-30T00:00:00.000Z',
    }), {
      catalogPath,
      redactionAuditPath,
      metadata: {
        version: '2026-04-30',
        lastValidatedAt: '2026-04-30T02:00:00.000Z',
      },
    });

    const artifactText = await readFile(catalogPath, 'utf8');
    const auditText = await readFile(redactionAuditPath, 'utf8');
    const artifact = JSON.parse(artifactText);
    const audit = JSON.parse(auditText);

    assert.equal(result.artifactPath, catalogPath);
    assert.equal(result.redactionAuditPath, redactionAuditPath);
    assert.deepEqual(result.redactionSummary, {
      redactedPathCount: audit.redactedPaths.length,
      findingCount: audit.findings.length,
    });
    assert.equal(artifact.schemaVersion, API_CATALOG_ENTRY_SCHEMA_VERSION);
    assert.equal(artifact.candidateId, 'candidate-to-persist');
    assert.equal(artifact.auth.authorization, REDACTION_PLACEHOLDER);
    assert.equal(artifact.endpoint.url.includes('synthetic-api-token'), false);
    assert.equal(Object.hasOwn(artifact, 'redactionSummary'), false);
    assert.equal(Object.hasOwn(audit, 'redactionSummary'), false);
    assert.equal(artifactText.includes('synthetic-api-token'), false);
    assert.equal(artifactText.includes('synthetic-catalog-token'), false);
    assert.equal(artifactText.includes('redactionSummary'), false);
    assert.equal(audit.redactedPaths.includes('auth.authorization'), true);
    assert.equal(auditText.includes('synthetic-catalog-token'), false);
    assert.equal(auditText.includes('redactionSummary'), false);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalogEntry artifact writer can emit paired verification lifecycle artifacts', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-entry-with-verification-'));
  try {
    const catalogPath = path.join(runDir, 'catalog', 'example.json');
    const redactionAuditPath = path.join(runDir, 'catalog', 'example.redaction-audit.json');
    const verificationEventPath = path.join(runDir, 'events', 'catalog-verification.json');
    const verificationEventRedactionAuditPath = path.join(
      runDir,
      'events',
      'catalog-verification.redaction-audit.json',
    );
    const result = await writeApiCatalogEntryArtifact(createCandidate({
      id: 'candidate-entry-verification',
      status: 'verified',
      auth: {
        authorization: 'Bearer synthetic-catalog-entry-verification-token',
      },
    }), {
      catalogPath,
      redactionAuditPath,
      verificationEventPath,
      verificationEventRedactionAuditPath,
      verificationEventCreatedAt: '2026-05-01T03:00:00.000Z',
      metadata: {
        version: '2026-05-01',
        lastValidatedAt: '2026-05-01T03:00:00.000Z',
      },
    });

    const catalogText = await readFile(catalogPath, 'utf8');
    const auditText = await readFile(redactionAuditPath, 'utf8');
    const eventText = await readFile(verificationEventPath, 'utf8');
    const eventAuditText = await readFile(verificationEventRedactionAuditPath, 'utf8');
    const event = JSON.parse(eventText);
    const eventAudit = JSON.parse(eventAuditText);

    assert.equal(result.artifactPath, catalogPath);
    assert.equal(result.verificationEventPath, verificationEventPath);
    assert.equal(result.verificationEventRedactionAuditPath, verificationEventRedactionAuditPath);
    assert.equal(assertSchemaCompatible('LifecycleEvent', result.verificationEvent), true);
    assert.equal(result.verificationEvent.eventType, 'api.catalog.verification.written');
    assert.equal(event.taskId, 'candidate-entry-verification');
    assert.equal(assertSchemaCompatible('LifecycleEvent', event), true);
    assert.equal(event.createdAt, '2026-05-01T03:00:00.000Z');
    assert.equal(event.details.catalogEntry.auth.authorization, REDACTION_PLACEHOLDER);
    assert.equal(eventAudit.redactedPaths.includes('details.catalogEntry.auth.authorization'), true);
    assert.equal(catalogText.includes('synthetic-catalog-entry-verification-token'), false);
    assert.equal(auditText.includes('synthetic-catalog-entry-verification-token'), false);
    assert.equal(eventText.includes('synthetic-catalog-entry-verification-token'), false);
    assert.equal(eventAuditText.includes('synthetic-catalog-entry-verification-token'), false);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog verification hook descriptor registers without executing hook code', () => {
  const descriptor = createApiCatalogVerificationHookDescriptor();
  assert.equal(assertSchemaCompatible('CapabilityHook', descriptor), true);
  assert.equal(descriptor.id, 'api-catalog-verification:lifecycle-artifact-writer');
  assert.equal(descriptor.phase, 'after_catalog_verify');
  assert.equal(descriptor.hookType, 'artifact_writer');
  assert.equal(descriptor.subscriber.name, 'api-catalog-verification-event-writer');
  assert.equal(descriptor.subscriber.modulePath, 'src/sites/capability/api-candidates.mjs');
  assert.equal(descriptor.subscriber.entrypoint, 'writeApiCatalogVerificationEventArtifact');
  assert.equal(descriptor.subscriber.capability, 'api-catalog');
  assert.equal(descriptor.safety.failClosed, true);
  assert.equal(descriptor.safety.redactionRequired, true);
  assert.equal(descriptor.safety.artifactWriteAllowed, true);
  assert.equal(Object.hasOwn(descriptor, 'run'), false);
  assert.equal(Object.hasOwn(descriptor, 'handler'), false);
  assert.equal(Object.hasOwn(descriptor.subscriber, 'run'), false);
  assert.equal(Object.hasOwn(descriptor.subscriber, 'handler'), false);

  const registry = createCapabilityHookRegistry();
  const registered = registry.register(descriptor);
  assert.deepEqual(registered, descriptor);
  assert.deepEqual(registry.listByPhase('after_catalog_verify'), [descriptor]);
  registered.phase = 'on_failure';
  registered.subscriber.entrypoint = 'mutatedEntrypoint';
  const registeredFromGet = registry.get(descriptor.id);
  assert.equal(registeredFromGet.phase, 'after_catalog_verify');
  assert.equal(registeredFromGet.subscriber.entrypoint, 'writeApiCatalogVerificationEventArtifact');
  const registeredFromList = registry.listByPhase('after_catalog_verify')[0];
  registeredFromList.safety.failClosed = false;
  assert.equal(registry.get(descriptor.id).safety.failClosed, true);

  let called = false;
  assert.throws(
    () => createApiCatalogVerificationHookDescriptor({
      run: () => {
        called = true;
      },
    }),
    /descriptor must not include executable functions/u,
  );
  assert.equal(called, false);
});

test('ApiCatalogEntry artifact writer rejects non-verified candidates before writing', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-entry-reject-'));
  try {
    const catalogPath = path.join(runDir, 'catalog', 'example.json');
    await assert.rejects(
      writeApiCatalogEntryArtifact(createCandidate({ status: 'candidate' }), { catalogPath }),
      /ApiCandidate must be verified before catalog entry/u,
    );
    await assert.rejects(
      access(catalogPath),
      /ENOENT/u,
    );
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalogEntry artifact writer fails closed for verification event partial paths and non-verified candidates', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-entry-verification-reject-'));
  try {
    const partialCatalogPath = path.join(runDir, 'partial', 'catalog.json');
    const partialEventPath = path.join(runDir, 'partial', 'event.json');
    await assert.rejects(
      writeApiCatalogEntryArtifact(createCandidate({ status: 'verified' }), {
        catalogPath: partialCatalogPath,
        verificationEventPath: partialEventPath,
      }),
      /must be provided together/u,
    );
    await assert.rejects(access(partialCatalogPath), /ENOENT/u);
    await assert.rejects(access(partialEventPath), /ENOENT/u);

    const unverifiedCatalogPath = path.join(runDir, 'unverified', 'catalog.json');
    const unverifiedAuditPath = path.join(runDir, 'unverified', 'catalog.redaction-audit.json');
    const unverifiedEventPath = path.join(runDir, 'unverified', 'event.json');
    const unverifiedEventAuditPath = path.join(runDir, 'unverified', 'event.redaction-audit.json');
    await assert.rejects(
      writeApiCatalogEntryArtifact(createCandidate({ status: 'observed' }), {
        catalogPath: unverifiedCatalogPath,
        redactionAuditPath: unverifiedAuditPath,
        verificationEventPath: unverifiedEventPath,
        verificationEventRedactionAuditPath: unverifiedEventAuditPath,
      }),
      /ApiCandidate must be verified before catalog entry/u,
    );
    await assert.rejects(access(unverifiedCatalogPath), /ENOENT/u);
    await assert.rejects(access(unverifiedAuditPath), /ENOENT/u);
    await assert.rejects(access(unverifiedEventPath), /ENOENT/u);
    await assert.rejects(access(unverifiedEventAuditPath), /ENOENT/u);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalogEntry artifact writer rejects missing or future candidate schema versions before writing', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-entry-version-reject-'));
  try {
    const missingVersionPath = path.join(runDir, 'missing.json');
    const futureVersionPath = path.join(runDir, 'future.json');
    const missingAuditPath = path.join(runDir, 'missing-audit.json');

    await assert.rejects(
      writeApiCatalogEntryArtifact(withoutSchemaVersion(createCandidate({
        status: 'verified',
      })), { catalogPath: missingVersionPath }),
      /ApiCandidate schemaVersion is required/u,
    );
    await assert.rejects(
      writeApiCatalogEntryArtifact(createCandidate({
        status: 'verified',
        schemaVersion: API_CANDIDATE_SCHEMA_VERSION + 1,
      }), { catalogPath: futureVersionPath }),
      /not compatible/u,
    );
    await assert.rejects(
      writeApiCatalogEntryArtifact(createCandidate({ status: 'verified' }), {
        catalogPath: missingAuditPath,
      }),
      /ApiCatalogEntry redactionAuditPath is required/u,
    );
    await assert.rejects(access(missingVersionPath), /ENOENT/u);
    await assert.rejects(access(futureVersionPath), /ENOENT/u);
    await assert.rejects(access(missingAuditPath), /ENOENT/u);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalogEntry artifact writer rejects duplicate output paths before writing', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-entry-duplicate-paths-'));
  try {
    const duplicatePath = path.join(runDir, 'catalog', 'entry.json');
    await assert.rejects(
      writeApiCatalogEntryArtifact(createCandidate({
        id: 'catalog-entry-duplicate-paths',
        status: 'verified',
      }), {
        catalogPath: duplicatePath,
        redactionAuditPath: duplicatePath,
      }),
      /output paths must be distinct/u,
    );
    await assertMissingFiles([duplicatePath]);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalogEntry artifact writer rejects audit IO failure without partial catalog writes', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-entry-audit-io-fail-'));
  try {
    const catalogPath = path.join(runDir, 'catalog', 'entry.json');
    const auditParentPath = path.join(runDir, 'audit-parent-is-file');
    const redactionAuditPath = path.join(auditParentPath, 'entry.redaction-audit.json');
    await writeFile(auditParentPath, 'not-a-directory', 'utf8');

    await assert.rejects(
      writeApiCatalogEntryArtifact(createCandidate({
        id: 'catalog-entry-audit-io-fail',
        status: 'verified',
        endpoint: {
          method: 'GET',
          url: 'https://example.invalid/api/audit-io?access_token=synthetic-entry-audit-io-token',
        },
        request: {
          headers: {
            authorization: 'Bearer synthetic-entry-audit-io-token',
          },
        },
      }), {
        catalogPath,
        redactionAuditPath,
      }),
      (error) => {
        assert.doesNotMatch(JSON.stringify(error), /synthetic-entry-audit-io-token|authorization|cookie|csrf|sessionId/iu);
        return true;
      },
    );
    await assertMissingFiles([catalogPath, redactionAuditPath]);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalogEntry artifact writer preserves existing catalog when audit IO fails', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-entry-audit-preserve-'));
  try {
    const catalogPath = path.join(runDir, 'catalog', 'entry.json');
    const auditParentPath = path.join(runDir, 'audit-parent-is-file');
    const redactionAuditPath = path.join(auditParentPath, 'entry.redaction-audit.json');
    const catalogSentinel = '{"sentinel":"catalog-before-audit-failure"}\n';
    await mkdir(path.dirname(catalogPath), { recursive: true });
    await writeFile(catalogPath, catalogSentinel, 'utf8');
    await writeFile(auditParentPath, 'not-a-directory', 'utf8');

    await assert.rejects(
      writeApiCatalogEntryArtifact(createCandidate({
        id: 'catalog-entry-audit-preserve',
        status: 'verified',
      }), {
        catalogPath,
        redactionAuditPath,
      }),
    );
    assert.equal(await readFile(catalogPath, 'utf8'), catalogSentinel);
    await assertMissingFiles([redactionAuditPath]);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalogEntry artifact writer rejects verification audit IO failure without partial event writes', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-entry-event-audit-io-fail-'));
  try {
    const catalogPath = path.join(runDir, 'catalog', 'entry.json');
    const redactionAuditPath = path.join(runDir, 'catalog', 'entry.redaction-audit.json');
    const verificationEventPath = path.join(runDir, 'event', 'catalog-verification.json');
    const eventAuditParentPath = path.join(runDir, 'event-audit-parent-is-file');
    const verificationEventRedactionAuditPath = path.join(
      eventAuditParentPath,
      'catalog-verification.redaction-audit.json',
    );
    await writeFile(eventAuditParentPath, 'not-a-directory', 'utf8');

    await assert.rejects(
      writeApiCatalogEntryArtifact(createCandidate({
        id: 'catalog-entry-event-audit-io-fail',
        status: 'verified',
        endpoint: {
          method: 'GET',
          url: 'https://example.invalid/api/event-audit-io?access_token=synthetic-entry-event-audit-token',
        },
        request: {
          headers: {
            authorization: 'Bearer synthetic-entry-event-audit-token',
          },
        },
      }), {
        catalogPath,
        redactionAuditPath,
        verificationEventPath,
        verificationEventRedactionAuditPath,
      }),
      (error) => {
        assert.doesNotMatch(JSON.stringify(error), /synthetic-entry-event-audit-token|authorization|cookie|csrf|sessionId/iu);
        return true;
      },
    );
    await assertMissingFiles([
      catalogPath,
      redactionAuditPath,
      verificationEventPath,
      verificationEventRedactionAuditPath,
    ]);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog verification event writer persists only verified redacted lifecycle events', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-verification-event-'));
  try {
    const eventPath = path.join(runDir, 'events', 'catalog-verification.json');
    const redactionAuditPath = path.join(runDir, 'events', 'catalog-verification.redaction-audit.json');
    const result = await writeApiCatalogVerificationEventArtifact(createCandidate({
      id: 'candidate-verification-event',
      status: 'verified',
      auth: {
        authorization: 'Bearer synthetic-catalog-verification-token',
      },
      observedAt: '2026-05-01T01:00:00.000Z',
    }), {
      eventPath,
      redactionAuditPath,
      createdAt: '2026-05-01T02:00:00.000Z',
      traceId: 'catalog-verification-trace',
      correlationId: 'catalog-verification-correlation',
      metadata: {
        version: '2026-05-01',
        taskType: 'api-catalog-verification',
        adapterVersion: 'fixture-adapter-v1',
        lastValidatedAt: '2026-05-01T02:00:00.000Z',
      },
    });

    const eventText = await readFile(eventPath, 'utf8');
    const auditText = await readFile(redactionAuditPath, 'utf8');
    const event = JSON.parse(eventText);
    const audit = JSON.parse(auditText);

    assert.equal(result.artifactPath, eventPath);
    assert.equal(result.redactionAuditPath, redactionAuditPath);
    assert.equal(event.eventType, 'api.catalog.verification.written');
    assert.equal(assertSchemaCompatible('LifecycleEvent', result.event), true);
    assert.equal(assertSchemaCompatible('LifecycleEvent', event), true);
    assert.equal(result.event.traceId, event.traceId);
    assert.equal(result.event.correlationId, event.correlationId);
    assert.equal(result.event.taskId, event.taskId);
    assert.equal(result.event.taskType, event.taskType);
    assert.equal(result.event.adapterVersion, event.adapterVersion);
    assert.equal(result.event.reasonCode, undefined);
    assert.equal(Object.hasOwn(event, 'reasonCode'), false);
    assert.equal(event.traceId, 'catalog-verification-trace');
    assert.equal(event.correlationId, 'catalog-verification-correlation');
    assert.equal(event.taskId, 'candidate-verification-event');
    assert.equal(event.siteKey, 'example');
    assert.equal(event.taskType, 'api-catalog-verification');
    assert.equal(event.adapterVersion, 'fixture-adapter-v1');
    assert.equal(event.createdAt, '2026-05-01T02:00:00.000Z');
    assert.equal(event.details.candidateId, 'candidate-verification-event');
    assert.equal(event.details.catalogStatus, 'cataloged');
    assert.equal(event.details.catalogEntry.candidateId, 'candidate-verification-event');
    assert.equal(event.details.catalogEntry.auth.authorization, REDACTION_PLACEHOLDER);
    assert.equal(eventText.includes('synthetic-api-token'), false);
    assert.equal(eventText.includes('synthetic-catalog-verification-token'), false);
    assert.equal(audit.redactedPaths.includes('details.catalogEntry.auth.authorization'), true);
    assert.equal(auditText.includes('synthetic-api-token'), false);
    assert.equal(auditText.includes('synthetic-catalog-verification-token'), false);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog verification event writer rejects non-verified candidates before writing', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-verification-event-reject-'));
  try {
    const missingAuditEventPath = path.join(runDir, 'missing-audit-event.json');
    await assert.rejects(
      writeApiCatalogVerificationEventArtifact(createCandidate({
        id: 'missing-audit-verification-event',
        status: 'verified',
      }), {
        eventPath: missingAuditEventPath,
      }),
      /ApiCatalog verification redactionAuditPath is required/u,
    );
    await assert.rejects(access(missingAuditEventPath), /ENOENT/u);

    for (const status of ['observed', 'candidate']) {
      const eventPath = path.join(runDir, `${status}.json`);
      const redactionAuditPath = path.join(runDir, `${status}.redaction-audit.json`);
      await assert.rejects(
        writeApiCatalogVerificationEventArtifact(createCandidate({ status }), {
          eventPath,
          redactionAuditPath,
        }),
        /ApiCandidate must be verified before catalog entry/u,
      );
      await assert.rejects(access(eventPath), /ENOENT/u);
      await assert.rejects(access(redactionAuditPath), /ENOENT/u);
    }
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog collection writer persists only verified redacted entries', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-collection-'));
  try {
    const catalogPath = path.join(runDir, 'catalog.json');
    const redactionAuditPath = path.join(runDir, 'catalog.redaction-audit.json');
    const lifecycleEventPath = path.join(runDir, 'catalog.lifecycle-event.json');
    const lifecycleEventRedactionAuditPath = path.join(runDir, 'catalog.lifecycle-event.redaction-audit.json');
    const partialLifecycleCatalogPath = path.join(runDir, 'partial-lifecycle-catalog.json');
    const partialLifecycleEventPath = path.join(runDir, 'partial-lifecycle-event.json');
    const capabilityHookRegistry = createCapabilityHookRegistry([{
      id: 'fixture-collection-catalog-observer',
      phase: 'after_catalog_verify',
      hookType: 'observer',
      subscriber: {
        name: 'fixture-collection-catalog-subscriber',
        modulePath: 'synthetic/collection-catalog-hook.mjs',
        entrypoint: 'shouldNotExecute',
        capability: 'api-catalog',
        order: 0,
      },
      filters: {
        eventTypes: ['api.catalog.collection.written'],
        siteKeys: ['example'],
      },
    }, {
      id: 'fixture-collection-artifact-observer',
      phase: 'after_artifact_write',
      hookType: 'observer',
      subscriber: {
        name: 'fixture-collection-artifact-subscriber',
        modulePath: 'synthetic/collection-artifact-hook.mjs',
        entrypoint: 'shouldNotExecute',
        capability: 'api-catalog',
        order: 1,
      },
      filters: {
        eventTypes: ['api.catalog.collection.written'],
        siteKeys: ['example'],
      },
    }]);
    const result = await writeApiCatalogCollectionArtifact([
      createCandidate({
        id: 'candidate-catalog-1',
        status: 'verified',
        auth: {
          authorization: 'Bearer synthetic-collection-token-1',
        },
      }),
      createCandidate({
        id: 'candidate-catalog-2',
        status: 'verified',
        endpoint: {
          method: 'POST',
          url: 'https://example.invalid/api/other?refresh_token=synthetic-refresh-token',
        },
      }),
    ], {
      catalogPath,
      redactionAuditPath,
      lifecycleEventPath,
      lifecycleEventRedactionAuditPath,
      lifecycleEventTraceId: 'catalog-collection-trace',
      lifecycleEventCorrelationId: 'catalog-collection-correlation',
      lifecycleEventTaskType: 'api-catalog-maintenance',
      lifecycleEventAdapterVersion: 'fixture-adapter-v1',
      capabilityHookRegistry,
      generatedAt: '2026-05-01T00:00:00.000Z',
      metadataByCandidateId: {
        'candidate-catalog-1': {
          version: '2026-05-01',
          lastValidatedAt: '2026-05-01T01:00:00.000Z',
        },
      },
    });

    const artifactText = await readFile(catalogPath, 'utf8');
    const auditText = await readFile(redactionAuditPath, 'utf8');
    const lifecycleEventText = await readFile(lifecycleEventPath, 'utf8');
    const lifecycleEventAuditText = await readFile(lifecycleEventRedactionAuditPath, 'utf8');
    const artifact = JSON.parse(artifactText);
    const audit = JSON.parse(auditText);
    const lifecycleEvent = JSON.parse(lifecycleEventText);
    const lifecycleEventAudit = JSON.parse(lifecycleEventAuditText);

    assert.equal(result.artifactPath, catalogPath);
    assert.equal(result.lifecycleEventPath, lifecycleEventPath);
    assert.equal(result.lifecycleEventRedactionAuditPath, lifecycleEventRedactionAuditPath);
    assert.deepEqual(result.redactionSummary, {
      redactedPathCount: audit.redactedPaths.length,
      findingCount: audit.findings.length,
    });
    assert.equal(JSON.stringify(result.redactionSummary).includes('synthetic-collection-token-1'), false);
    assert.equal(JSON.stringify(result.redactionSummary).includes('synthetic-refresh-token'), false);
    assert.equal(artifact.schemaVersion, API_CATALOG_SCHEMA_VERSION);
    assert.equal(assertApiCatalogCompatible(artifact), true);
    assert.equal(artifact.generatedAt, '2026-05-01T00:00:00.000Z');
    assert.equal(artifact.entries.length, 2);
    assert.equal(artifact.entries[0].candidateId, 'candidate-catalog-1');
    assert.equal(artifact.entries[0].version, '2026-05-01');
    assert.equal(artifact.entries[0].auth.authorization, REDACTION_PLACEHOLDER);
    assert.equal(artifact.entries[1].endpoint.url.includes('synthetic-refresh-token'), false);
    assert.equal(artifactText.includes('synthetic-collection-token-1'), false);
    assert.equal(artifactText.includes('synthetic-refresh-token'), false);
    assert.equal(assertSchemaCompatible('LifecycleEvent', lifecycleEvent), true);
    assert.equal(assertLifecycleEventObservabilityFields(lifecycleEvent, {
      requiredFields: [
        'traceId',
        'correlationId',
        'taskId',
        'siteKey',
        'taskType',
        'adapterVersion',
      ],
      requiredDetailFields: [
        'catalogId',
        'catalogVersion',
        'generatedAt',
        'latestValidatedAt',
        'entryCount',
        'siteKeys',
        'statuses',
        'invalidationStatuses',
        'reasonCodes',
        'reasonRecoveries',
        'capabilityHookMatches',
      ],
    }), true);
    assert.equal(lifecycleEvent.eventType, 'api.catalog.collection.written');
    assert.equal(lifecycleEvent.traceId, 'catalog-collection-trace');
    assert.equal(lifecycleEvent.correlationId, 'catalog-collection-correlation');
    assert.equal(lifecycleEvent.taskId, 'catalog-1');
    assert.equal(lifecycleEvent.siteKey, 'example');
    assert.equal(lifecycleEvent.taskType, 'api-catalog-maintenance');
    assert.equal(lifecycleEvent.adapterVersion, 'fixture-adapter-v1');
    assert.equal(lifecycleEvent.details.catalogId, 'catalog-1');
    assert.equal(lifecycleEvent.details.entryCount, 2);
    assert.deepEqual(lifecycleEvent.details.siteKeys, ['example']);
    assert.deepEqual(lifecycleEvent.details.statuses, { cataloged: 2 });
    assert.deepEqual(lifecycleEvent.details.invalidationStatuses, { active: 2 });
    assert.deepEqual(lifecycleEvent.details.reasonCodes, {});
    assert.deepEqual(lifecycleEvent.details.reasonRecoveries, {});
    assert.deepEqual(lifecycleEvent.details.capabilityHookMatches.phases, [
      'after_catalog_verify',
      'after_artifact_write',
    ]);
    assert.equal(lifecycleEvent.details.capabilityHookMatches.matchCount, 2);
    assert.deepEqual(lifecycleEvent.details.capabilityHookMatches.lifecycleEvent, {
      schemaVersion: 1,
      eventType: 'api.catalog.collection.written',
      traceId: 'catalog-collection-trace',
      correlationId: 'catalog-collection-correlation',
      taskId: 'catalog-1',
      siteKey: 'example',
      taskType: 'api-catalog-maintenance',
      adapterVersion: 'fixture-adapter-v1',
    });
    assert.equal(Object.hasOwn(lifecycleEvent.details.capabilityHookMatches.lifecycleEvent, 'details'), false);
    assert.deepEqual(lifecycleEvent.details.capabilityHookMatches.matches.map((match) => match.id), [
      'fixture-collection-catalog-observer',
      'fixture-collection-artifact-observer',
    ]);
    for (const match of lifecycleEvent.details.capabilityHookMatches.matches) {
      assert.equal(Object.hasOwn(match.subscriber, 'modulePath'), false);
      assert.equal(Object.hasOwn(match.subscriber, 'entrypoint'), false);
    }
    assert.deepEqual(Object.keys(lifecycleEvent.details).sort(), [
      'capabilityHookMatches',
      'catalogId',
      'catalogVersion',
      'entryCount',
      'generatedAt',
      'invalidationStatuses',
      'latestValidatedAt',
      'reasonCodes',
      'reasonRecoveries',
      'siteKeys',
      'statuses',
    ]);
    assert.equal(JSON.stringify(lifecycleEvent).includes('endpoint'), false);
    assert.equal(JSON.stringify(lifecycleEvent).includes('request'), false);
    assert.equal(JSON.stringify(lifecycleEvent).includes('auth'), false);
    assert.equal(JSON.stringify(lifecycleEvent).includes('entries'), false);
    assert.equal(JSON.stringify(lifecycleEvent).includes('candidateId'), false);
    assert.equal(lifecycleEventText.includes('synthetic-collection-token-1'), false);
    assert.equal(lifecycleEventText.includes('synthetic-refresh-token'), false);
    assert.equal(lifecycleEventText.includes('synthetic/collection-catalog-hook.mjs'), false);
    assert.equal(lifecycleEventText.includes('synthetic/collection-artifact-hook.mjs'), false);
    assert.equal(lifecycleEventText.includes('shouldNotExecute'), false);
    assert.deepEqual(lifecycleEventAudit.redactedPaths, []);
    assert.equal(lifecycleEventAuditText.includes('synthetic-collection-token-1'), false);
    assert.equal(lifecycleEventAuditText.includes('synthetic-refresh-token'), false);
    assert.equal(lifecycleEventAuditText.includes('synthetic/collection-catalog-hook.mjs'), false);
    assert.equal(lifecycleEventAuditText.includes('synthetic/collection-artifact-hook.mjs'), false);
    assert.equal(lifecycleEventAuditText.includes('shouldNotExecute'), false);
    assert.equal(audit.redactedPaths.includes('entries.0.auth.authorization'), true);
    assert.equal(auditText.includes('synthetic-collection-token-1'), false);
    assert.equal(Object.hasOwn(artifact, 'redactionSummary'), false);
    assert.equal(Object.hasOwn(audit, 'redactionSummary'), false);
    assert.equal(createApiCatalogCollectionLifecycleEvent(artifact).eventType, 'api.catalog.collection.written');
    await assert.rejects(
      writeApiCatalogCollectionArtifact([
        createCandidate({
          id: 'partial-lifecycle-catalog-candidate',
          status: 'verified',
        }),
      ], {
        catalogPath: partialLifecycleCatalogPath,
        lifecycleEventPath: partialLifecycleEventPath,
      }),
      /must be provided together/u,
    );
    await assert.rejects(access(partialLifecycleCatalogPath), /ENOENT/u);
    await assert.rejects(access(partialLifecycleEventPath), /ENOENT/u);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog collection upsert preserves verified entries and writes safe lifecycle summary', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-collection-upsert-'));
  try {
    const catalogPath = path.join(runDir, 'catalog.json');
    const redactionAuditPath = path.join(runDir, 'catalog.redaction-audit.json');
    const lifecycleEventPath = path.join(runDir, 'catalog.lifecycle-event.json');
    const lifecycleEventRedactionAuditPath = path.join(runDir, 'catalog.lifecycle-event.redaction-audit.json');
    const incompatibleCatalogPath = path.join(runDir, 'incompatible-catalog.json');
    const incompatibleCatalogText = JSON.stringify({
      schemaVersion: API_CATALOG_SCHEMA_VERSION + 1,
      entries: [],
    });
    const candidateStateCatalogPath = path.join(runDir, 'candidate-state-catalog.json');
    const candidateStateCatalogText = JSON.stringify({
      schemaVersion: API_CATALOG_SCHEMA_VERSION,
      entries: [{
        schemaVersion: API_CATALOG_ENTRY_SCHEMA_VERSION,
        candidateId: 'candidate-upsert-state-leak',
        siteKey: 'example',
        endpoint: {
          method: 'GET',
          url: 'https://example.invalid/api/state-leak',
        },
        status: 'verified',
        invalidationStatus: 'active',
        verifiedAt: '2026-05-01T07:20:00.000Z',
        lastValidatedAt: '2026-05-01T07:21:00.000Z',
      }],
    });

    await writeApiCatalogCollectionArtifact([
      createCandidate({
        id: 'candidate-upsert-existing',
        status: 'verified',
        auth: {
          authorization: 'Bearer synthetic-upsert-existing-token',
        },
      }),
    ], {
      catalogPath,
      redactionAuditPath,
      generatedAt: '2026-05-01T07:00:00.000Z',
      catalogId: 'fixture-upsert-catalog',
      catalogVersion: 'fixture-upsert-v1',
      metadataByCandidateId: {
        'candidate-upsert-existing': {
          version: 'fixture-upsert-v1',
          lastValidatedAt: '2026-05-01T07:01:00.000Z',
        },
      },
    });

    const result = await upsertApiCatalogCollectionArtifact([
      createCandidate({
        id: 'candidate-upsert-existing',
        status: 'verified',
        endpoint: {
          method: 'GET',
          url: 'https://example.invalid/api/upsert-existing?access_token=synthetic-upsert-replacement-token',
        },
      }),
      createCandidate({
        id: 'candidate-upsert-added',
        status: 'verified',
        auth: {
          authorization: 'Bearer synthetic-upsert-added-token',
        },
      }),
    ], {
      catalogPath,
      redactionAuditPath,
      lifecycleEventPath,
      lifecycleEventRedactionAuditPath,
      lifecycleEventTraceId: 'catalog-upsert-trace',
      lifecycleEventCorrelationId: 'catalog-upsert-correlation',
      generatedAt: '2026-05-01T07:10:00.000Z',
      catalogId: 'fixture-upsert-catalog',
      catalogVersion: 'fixture-upsert-v2',
      metadataByCandidateId: {
        'candidate-upsert-existing': {
          version: 'fixture-upsert-v2',
          status: 'deprecated',
          invalidationStatus: 'deprecated',
          lastValidatedAt: '2026-05-01T07:11:00.000Z',
        },
        'candidate-upsert-added': {
          version: 'fixture-upsert-v2',
          lastValidatedAt: '2026-05-01T07:12:00.000Z',
        },
      },
    });

    const catalogText = await readFile(catalogPath, 'utf8');
    const auditText = await readFile(redactionAuditPath, 'utf8');
    const eventText = await readFile(lifecycleEventPath, 'utf8');
    const eventAuditText = await readFile(lifecycleEventRedactionAuditPath, 'utf8');
    const catalog = JSON.parse(catalogText);
    const audit = JSON.parse(auditText);
    const event = JSON.parse(eventText);
    const eventAudit = JSON.parse(eventAuditText);

    assert.equal(result.artifactPath, catalogPath);
    assert.equal(assertApiCatalogCompatible(catalog), true);
    assert.equal(assertSchemaCompatible('LifecycleEvent', event), true);
    assert.equal(catalog.catalogId, 'fixture-upsert-catalog');
    assert.equal(catalog.catalogVersion, 'fixture-upsert-v2');
    assert.deepEqual(catalog.entries.map((entry) => entry.candidateId), [
      'candidate-upsert-added',
      'candidate-upsert-existing',
    ]);
    assert.equal(catalog.entries[0].status, 'cataloged');
    assert.equal(catalog.entries[1].status, 'deprecated');
    assert.equal(catalog.entries[1].version, 'fixture-upsert-v2');
    assert.equal(catalog.entries[1].invalidationStatus, 'deprecated');
    assert.equal(catalog.entries[1].endpoint.url.includes('synthetic-upsert-replacement-token'), false);
    assert.equal(event.eventType, 'api.catalog.collection.written');
    assert.equal(event.traceId, 'catalog-upsert-trace');
    assert.equal(event.correlationId, 'catalog-upsert-correlation');
    assert.equal(event.details.catalogId, 'fixture-upsert-catalog');
    assert.equal(event.details.catalogVersion, 'fixture-upsert-v2');
    assert.equal(event.details.entryCount, 2);
    assert.deepEqual(event.details.statuses, {
      cataloged: 1,
      deprecated: 1,
    });
    assert.deepEqual(event.details.invalidationStatuses, {
      active: 1,
      deprecated: 1,
    });
    assert.deepEqual(event.details.reasonCodes, {});
    assert.deepEqual(event.details.reasonRecoveries, {});
    assert.equal(JSON.stringify(event).includes('"endpoint"'), false);
    assert.equal(JSON.stringify(event).includes('"request"'), false);
    assert.equal(JSON.stringify(event).includes('"auth"'), false);
    assert.equal(JSON.stringify(event).includes('entries'), false);
    assert.equal(JSON.stringify(event).includes('candidateId'), false);
    assert.deepEqual(eventAudit.redactedPaths, []);
    for (const text of [catalogText, auditText, eventText, eventAuditText]) {
      assert.equal(text.includes('synthetic-upsert-existing-token'), false);
      assert.equal(text.includes('synthetic-upsert-replacement-token'), false);
      assert.equal(text.includes('synthetic-upsert-added-token'), false);
    }

    await writeFile(incompatibleCatalogPath, incompatibleCatalogText, 'utf8');
    await assert.rejects(
      upsertApiCatalogCollectionArtifact([
        createCandidate({
          id: 'candidate-upsert-incompatible',
          status: 'verified',
        }),
      ], {
        catalogPath: incompatibleCatalogPath,
        redactionAuditPath: path.join(runDir, 'incompatible-catalog.redaction-audit.json'),
      }),
      /not compatible/u,
    );
    assert.equal(await readFile(incompatibleCatalogPath, 'utf8'), incompatibleCatalogText);
    await writeFile(candidateStateCatalogPath, candidateStateCatalogText, 'utf8');
    await assert.rejects(
      upsertApiCatalogCollectionArtifact([
        createCandidate({
          id: 'candidate-upsert-state-guard',
          status: 'verified',
        }),
      ], {
        catalogPath: candidateStateCatalogPath,
        redactionAuditPath: path.join(runDir, 'candidate-state-catalog.redaction-audit.json'),
        lifecycleEventPath: path.join(runDir, 'candidate-state-catalog.lifecycle-event.json'),
        lifecycleEventRedactionAuditPath: path.join(runDir, 'candidate-state-catalog.lifecycle-event.redaction-audit.json'),
      }),
      /Unsupported ApiCatalogEntry status: verified/u,
    );
    assert.equal(await readFile(candidateStateCatalogPath, 'utf8'), candidateStateCatalogText);
    await assert.rejects(access(path.join(runDir, 'candidate-state-catalog.redaction-audit.json')), /ENOENT/u);
    await assert.rejects(access(path.join(runDir, 'candidate-state-catalog.lifecycle-event.json')), /ENOENT/u);
    await assert.rejects(access(path.join(runDir, 'candidate-state-catalog.lifecycle-event.redaction-audit.json')), /ENOENT/u);
    await assert.rejects(
      upsertApiCatalogCollectionArtifact([
        createCandidate({
          id: 'candidate-upsert-non-verified',
          status: 'candidate',
        }),
      ], { catalogPath }),
      /ApiCandidate must be verified before catalog entry/u,
    );
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog collection writer fails closed before writing when forbidden material survives redaction', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-collection-fail-closed-'));
  try {
    const catalogPath = path.join(runDir, 'catalog.json');
    const redactionAuditPath = path.join(runDir, 'catalog.redaction-audit.json');
    const missingAuditCatalogPath = path.join(runDir, 'missing-audit-catalog.json');
    const forbiddenFieldMapping = Object.create(null);
    forbiddenFieldMapping.toJSON = () => ({
      leak: 'access_token=synthetic-catalog-survives-redaction',
    });

    await assert.rejects(
      writeApiCatalogCollectionArtifact([
        createCandidate({
          id: 'candidate-catalog-missing-audit',
          status: 'verified',
        }),
      ], {
        catalogPath: missingAuditCatalogPath,
      }),
      /ApiCatalog redactionAuditPath is required/u,
    );
    await assert.rejects(access(missingAuditCatalogPath), /ENOENT/u);

    await assert.rejects(
      writeApiCatalogCollectionArtifact([
        createCandidate({
          id: 'candidate-catalog-fail-closed',
          status: 'verified',
        }),
      ], {
        catalogPath,
        redactionAuditPath,
        generatedAt: '2026-05-01T06:00:00.000Z',
        metadataByCandidateId: {
          'candidate-catalog-fail-closed': {
            version: 'fail-closed-v1',
            fieldMapping: forbiddenFieldMapping,
          },
        },
      }),
      (error) => {
        const recovery = reasonCodeSummary(error.code);
        assert.equal(error.code, 'redaction-failed');
        assert.equal(recovery.retryable, false);
        assert.equal(recovery.manualRecoveryNeeded, true);
        assert.equal(recovery.artifactWriteAllowed, false);
        assert.equal(error.findings.some((finding) => finding.pattern === 'sensitive-query-assignment'), true);
        return true;
      },
    );
    await assert.rejects(access(catalogPath), /ENOENT/u);
    await assert.rejects(access(redactionAuditPath), /ENOENT/u);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog collection writer preserves existing artifacts when redaction fails closed', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-collection-preserve-existing-'));
  try {
    const catalogPath = path.join(runDir, 'catalog.json');
    const redactionAuditPath = path.join(runDir, 'catalog.redaction-audit.json');
    const catalogSentinel = '{"sentinel":"catalog-before-redaction-failure"}\n';
    const auditSentinel = '{"sentinel":"audit-before-redaction-failure"}\n';
    await writeFile(catalogPath, catalogSentinel, 'utf8');
    await writeFile(redactionAuditPath, auditSentinel, 'utf8');

    const forbiddenFieldMapping = Object.create(null);
    forbiddenFieldMapping.toJSON = () => ({
      leak: 'access_token=synthetic-catalog-preserve-existing-token',
    });

    await assert.rejects(
      writeApiCatalogCollectionArtifact([
        createCandidate({
          id: 'candidate-catalog-preserve-existing',
          status: 'verified',
        }),
      ], {
        catalogPath,
        redactionAuditPath,
        generatedAt: '2026-05-01T06:10:00.000Z',
        metadataByCandidateId: {
          'candidate-catalog-preserve-existing': {
            version: 'preserve-existing-v1',
            fieldMapping: forbiddenFieldMapping,
          },
        },
      }),
      (error) => {
        const recovery = reasonCodeSummary(error.code);
        assert.equal(error.code, 'redaction-failed');
        assert.equal(recovery.retryable, false);
        assert.equal(recovery.manualRecoveryNeeded, true);
        assert.equal(recovery.artifactWriteAllowed, false);
        assert.equal(error.findings.some((finding) => finding.pattern === 'sensitive-query-assignment'), true);
        return true;
      },
    );
    assert.equal(await readFile(catalogPath, 'utf8'), catalogSentinel);
    assert.equal(await readFile(redactionAuditPath, 'utf8'), auditSentinel);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog collection writer rejects duplicate output paths before writing', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-collection-duplicate-paths-'));
  try {
    const duplicatePath = path.join(runDir, 'catalog.json');
    await assert.rejects(
      writeApiCatalogCollectionArtifact([
        createCandidate({
          id: 'candidate-catalog-duplicate-paths',
          status: 'verified',
        }),
      ], {
        catalogPath: duplicatePath,
        redactionAuditPath: duplicatePath,
      }),
      /output paths must be distinct/u,
    );
    await assertMissingFiles([duplicatePath]);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog collection writer rejects audit IO failure without partial catalog writes', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-collection-audit-io-fail-'));
  try {
    const catalogPath = path.join(runDir, 'api-catalog.json');
    const auditParentPath = path.join(runDir, 'audit-parent-is-file');
    const redactionAuditPath = path.join(auditParentPath, 'api-catalog.redaction-audit.json');
    await writeFile(auditParentPath, 'not-a-directory', 'utf8');

    await assert.rejects(
      writeApiCatalogCollectionArtifact([
        createCandidate({
          id: 'candidate-catalog-audit-io-fail',
          status: 'verified',
          endpoint: {
            method: 'GET',
            url: 'https://example.invalid/api/catalog-audit-io?access_token=synthetic-collection-audit-io-token',
          },
          request: {
            headers: {
              authorization: 'Bearer synthetic-collection-audit-io-token',
            },
          },
        }),
      ], {
        catalogPath,
        redactionAuditPath,
      }),
      (error) => {
        assert.doesNotMatch(JSON.stringify(error), /synthetic-collection-audit-io-token|authorization|cookie|csrf|sessionId/iu);
        return true;
      },
    );
    await assertMissingFiles([catalogPath, redactionAuditPath]);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog collection writer preserves existing catalog when audit IO fails', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-collection-audit-preserve-'));
  try {
    const catalogPath = path.join(runDir, 'api-catalog.json');
    const auditParentPath = path.join(runDir, 'audit-parent-is-file');
    const redactionAuditPath = path.join(auditParentPath, 'api-catalog.redaction-audit.json');
    const catalogSentinel = '{"sentinel":"collection-before-audit-failure"}\n';
    await writeFile(catalogPath, catalogSentinel, 'utf8');
    await writeFile(auditParentPath, 'not-a-directory', 'utf8');

    await assert.rejects(
      writeApiCatalogCollectionArtifact([
        createCandidate({
          id: 'candidate-catalog-audit-preserve',
          status: 'verified',
        }),
      ], {
        catalogPath,
        redactionAuditPath,
      }),
    );
    assert.equal(await readFile(catalogPath, 'utf8'), catalogSentinel);
    await assertMissingFiles([redactionAuditPath]);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog collection writer rejects lifecycle audit IO failure without partial event writes', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-collection-event-audit-io-fail-'));
  try {
    const catalogPath = path.join(runDir, 'api-catalog.json');
    const redactionAuditPath = path.join(runDir, 'api-catalog.redaction-audit.json');
    const lifecycleEventPath = path.join(runDir, 'api-catalog.lifecycle-event.json');
    const eventAuditParentPath = path.join(runDir, 'event-audit-parent-is-file');
    const lifecycleEventRedactionAuditPath = path.join(
      eventAuditParentPath,
      'api-catalog.lifecycle-event.redaction-audit.json',
    );
    await writeFile(eventAuditParentPath, 'not-a-directory', 'utf8');

    await assert.rejects(
      writeApiCatalogCollectionArtifact([
        createCandidate({
          id: 'candidate-catalog-event-audit-io-fail',
          status: 'verified',
          endpoint: {
            method: 'GET',
            url: 'https://example.invalid/api/catalog-event-audit-io?access_token=synthetic-collection-event-audit-token',
          },
          request: {
            headers: {
              authorization: 'Bearer synthetic-collection-event-audit-token',
            },
          },
        }),
      ], {
        catalogPath,
        redactionAuditPath,
        lifecycleEventPath,
        lifecycleEventRedactionAuditPath,
      }),
      (error) => {
        assert.doesNotMatch(JSON.stringify(error), /synthetic-collection-event-audit-token|authorization|cookie|csrf|sessionId/iu);
        return true;
      },
    );
    await assertMissingFiles([
      catalogPath,
      redactionAuditPath,
      lifecycleEventPath,
      lifecycleEventRedactionAuditPath,
    ]);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog collection writer rejects non-verified entries before writing', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-collection-reject-'));
  try {
    const catalogPath = path.join(runDir, 'api-catalog', 'catalog.json');
    await assert.rejects(
      writeApiCatalogCollectionArtifact([
        createCandidate({ id: 'verified-candidate', status: 'verified' }),
        createCandidate({ id: 'unverified-candidate', status: 'candidate' }),
      ], { catalogPath }),
      /ApiCandidate must be verified before catalog entry/u,
    );
    await assert.rejects(access(catalogPath), /ENOENT/u);
    assert.throws(
      () => createApiCatalogCollection('not-an-array'),
      /candidates must be an array/u,
    );
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog index artifact summarizes catalog versions without endpoint or auth material', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-index-'));
  try {
    const fixture = createVerifiedCatalogRegressionFixture();
    const indexPath = path.join(runDir, 'api-catalog-index.json');
    const auditPath = path.join(runDir, 'api-catalog-index.redaction-audit.json');
    const eventPath = path.join(runDir, 'api-catalog-index.lifecycle-event.json');
    const eventAuditPath = path.join(runDir, 'api-catalog-index.lifecycle-event.redaction-audit.json');
    const missingAuditIndexPath = path.join(runDir, 'missing-audit-index.json');
    const incompatibleIndexPath = path.join(runDir, 'future-index.json');
    const incompatibleAuditPath = path.join(runDir, 'future-index.redaction-audit.json');
    const incompatibleEventPath = path.join(runDir, 'future-index.lifecycle-event.json');
    const incompatibleEventAuditPath = path.join(runDir, 'future-index.lifecycle-event.redaction-audit.json');
    const incompatibleEntryIndexPath = path.join(runDir, 'future-entry-index.json');
    const incompatibleEntryAuditPath = path.join(runDir, 'future-entry-index.redaction-audit.json');
    const incompatibleEntryEventPath = path.join(runDir, 'future-entry-index.lifecycle-event.json');
    const incompatibleEntryEventAuditPath = path.join(runDir, 'future-entry-index.lifecycle-event.redaction-audit.json');
    const candidateStatusIndexPath = path.join(runDir, 'candidate-status-index.json');
    const candidateStatusAuditPath = path.join(runDir, 'candidate-status-index.redaction-audit.json');
    const candidateStatusEventPath = path.join(runDir, 'candidate-status-index.lifecycle-event.json');
    const candidateStatusEventAuditPath = path.join(runDir, 'candidate-status-index.lifecycle-event.redaction-audit.json');
    const partialEventIndexPath = path.join(runDir, 'partial-event-index.json');
    const partialEventPath = path.join(runDir, 'partial-event.json');
    const capabilityHookRegistry = createCapabilityHookRegistry([{
      id: 'fixture-index-catalog-observer',
      phase: 'after_catalog_verify',
      hookType: 'observer',
      subscriber: {
        name: 'fixture-index-catalog-subscriber',
        modulePath: 'synthetic/index-catalog-hook.mjs',
        entrypoint: 'shouldNotExecute',
        capability: 'api-catalog',
        order: 0,
      },
      filters: {
        eventTypes: ['api.catalog.index.written'],
      },
    }, {
      id: 'fixture-index-artifact-observer',
      phase: 'after_artifact_write',
      hookType: 'observer',
      subscriber: {
        name: 'fixture-index-artifact-subscriber',
        modulePath: 'synthetic/index-artifact-hook.mjs',
        entrypoint: 'shouldNotExecute',
        capability: 'api-catalog',
        order: 1,
      },
      filters: {
        eventTypes: ['api.catalog.index.written'],
      },
    }]);
    const catalog = createApiCatalogCollection(fixture.candidates, {
      catalogId: 'fixture-catalog-main',
      catalogVersion: 'fixture-api-v1',
      generatedAt: fixture.generatedAt,
      metadataByCandidateId: fixture.metadataByCandidateId,
    });
    const index = createApiCatalogIndex([catalog], {
      generatedAt: '2026-05-01T05:20:00.000Z',
      indexVersion: 'fixture-index-v1',
    });

    assert.equal(index.schemaVersion, API_CATALOG_INDEX_SCHEMA_VERSION);
    assert.equal(assertApiCatalogIndexCompatible(index), true);
    assert.equal(assertSchemaCompatible('ApiCatalogIndex', index), true);
    assert.equal(index.indexVersion, 'fixture-index-v1');
    assert.deepEqual(index.reasonCodes, {});
    assert.equal(index.catalogs.length, 1);
    assert.deepEqual(index.catalogs[0], {
      catalogId: 'fixture-catalog-main',
      catalogVersion: 'fixture-api-v1',
      generatedAt: fixture.generatedAt,
      latestValidatedAt: '2026-05-01T04:08:00.000Z',
      entryCount: 2,
      siteKeys: ['fixture-site'],
      statuses: {
        cataloged: 2,
      },
      invalidationStatuses: {
        active: 1,
        stale: 1,
      },
      reasonCodes: {},
    });
    assert.equal(JSON.stringify(index).includes('synthetic-fixture-access-token'), false);
    assert.equal(JSON.stringify(index).includes('authorization'), false);
    assert.equal(JSON.stringify(index).includes('https://fixture.invalid'), false);

    await assert.rejects(
      writeApiCatalogIndexArtifact([catalog], {
        indexPath: missingAuditIndexPath,
        generatedAt: '2026-05-01T05:25:00.000Z',
        indexVersion: 'fixture-index-v1',
      }),
      /ApiCatalogIndex redactionAuditPath is required/u,
    );
    await assert.rejects(access(missingAuditIndexPath), /ENOENT/u);

    const result = await writeApiCatalogIndexArtifact([catalog], {
      indexPath,
      redactionAuditPath: auditPath,
      lifecycleEventPath: eventPath,
      lifecycleEventRedactionAuditPath: eventAuditPath,
      lifecycleEventTraceId: 'catalog-index-trace',
      lifecycleEventCorrelationId: 'catalog-index-correlation',
      lifecycleEventSiteKey: 'fixture-site',
      lifecycleEventTaskType: 'api-catalog-maintenance',
      lifecycleEventAdapterVersion: 'fixture-adapter-v1',
      capabilityHookRegistry,
      generatedAt: '2026-05-01T05:30:00.000Z',
      indexVersion: 'fixture-index-v1',
    });
    const indexText = await readFile(indexPath, 'utf8');
    const auditText = await readFile(auditPath, 'utf8');
    const eventText = await readFile(eventPath, 'utf8');
    const eventAuditText = await readFile(eventAuditPath, 'utf8');
    const persisted = JSON.parse(indexText);
    const audit = JSON.parse(auditText);
    const event = JSON.parse(eventText);
    const eventAudit = JSON.parse(eventAuditText);

    assert.equal(result.artifactPath, indexPath);
    assert.deepEqual(result.redactionSummary, {
      redactedPathCount: audit.redactedPaths.length,
      findingCount: audit.findings.length,
    });
    assert.equal(JSON.stringify(result.redactionSummary).includes('synthetic-fixture-access-token'), false);
    assert.equal(JSON.stringify(result.redactionSummary).includes('synthetic-fixture-catalog-authorization'), false);
    assert.equal(assertApiCatalogIndexCompatible(persisted), true);
    assert.equal(assertSchemaCompatible('ApiCatalogIndex', persisted), true);
    assert.equal(assertSchemaCompatible('ApiCatalogIndex', result.index), true);
    assert.deepEqual(result.index, persisted);
    assert.equal(result.index.schemaVersion, API_CATALOG_INDEX_SCHEMA_VERSION);
    assert.equal(result.index.indexVersion, 'fixture-index-v1');
    assert.deepEqual(Object.keys(persisted).sort(), [
      'catalogs',
      'generatedAt',
      'indexVersion',
      'reasonCodes',
      'schemaVersion',
    ]);
    assert.equal(result.redactionAuditPath, auditPath);
    assert.equal(result.lifecycleEventPath, eventPath);
    assert.equal(result.lifecycleEventRedactionAuditPath, eventAuditPath);
    assert.equal(assertSchemaCompatible('LifecycleEvent', event), true);
    assert.equal(assertLifecycleEventObservabilityFields(event, {
      requiredFields: [
        'traceId',
        'correlationId',
        'taskId',
        'siteKey',
        'taskType',
        'adapterVersion',
      ],
      requiredDetailFields: [
        'indexVersion',
        'indexGeneratedAt',
        'catalogCount',
        'totalEntryCount',
        'reasonCodes',
        'reasonRecoveries',
        'catalogs',
        'capabilityHookMatches',
      ],
    }), true);
    assert.equal(persisted.catalogs[0].catalogId, 'fixture-catalog-main');
    assert.equal(persisted.catalogs[0].entryCount, 2);
    assert.equal(persisted.catalogs[0].latestValidatedAt, '2026-05-01T04:08:00.000Z');
    assert.deepEqual(persisted.reasonCodes, {});
    assert.deepEqual(persisted.catalogs[0].invalidationStatuses, {
      active: 1,
      stale: 1,
    });
    assert.deepEqual(persisted.catalogs[0].reasonCodes, {});
    assert.equal(event.eventType, 'api.catalog.index.written');
    assert.equal(event.traceId, 'catalog-index-trace');
    assert.equal(event.correlationId, 'catalog-index-correlation');
    assert.equal(event.taskId, 'fixture-index-v1');
    assert.equal(event.siteKey, 'fixture-site');
    assert.equal(event.taskType, 'api-catalog-maintenance');
    assert.equal(event.adapterVersion, 'fixture-adapter-v1');
    assert.equal(event.createdAt, '2026-05-01T05:30:00.000Z');
    assert.equal(event.details.indexVersion, 'fixture-index-v1');
    assert.equal(event.details.catalogCount, 1);
    assert.equal(event.details.totalEntryCount, 2);
    assert.deepEqual(Object.keys(event.details).sort(), [
      'capabilityHookMatches',
      'catalogCount',
      'catalogs',
      'indexGeneratedAt',
      'indexVersion',
      'reasonCodes',
      'reasonRecoveries',
      'totalEntryCount',
    ]);
    assert.deepEqual(Object.keys(event.details.catalogs[0]).sort(), [
      'catalogId',
      'catalogVersion',
      'entryCount',
      'generatedAt',
      'invalidationStatuses',
      'latestValidatedAt',
      'reasonCodes',
      'reasonRecoveries',
      'siteKeys',
      'statuses',
    ]);
    assert.deepEqual(event.details.catalogs[0], {
      catalogId: 'fixture-catalog-main',
      catalogVersion: 'fixture-api-v1',
      generatedAt: fixture.generatedAt,
      latestValidatedAt: '2026-05-01T04:08:00.000Z',
      entryCount: 2,
      siteKeys: ['fixture-site'],
      statuses: {
        cataloged: 2,
      },
      invalidationStatuses: {
        active: 1,
        stale: 1,
      },
      reasonCodes: {},
      reasonRecoveries: {},
    });
    assert.deepEqual(event.details.reasonCodes, {});
    assert.deepEqual(event.details.reasonRecoveries, {});
    assert.deepEqual(event.details.capabilityHookMatches.phases, [
      'after_catalog_verify',
      'after_artifact_write',
    ]);
    assert.equal(event.details.capabilityHookMatches.matchCount, 2);
    assert.deepEqual(event.details.capabilityHookMatches.lifecycleEvent, {
      schemaVersion: 1,
      eventType: 'api.catalog.index.written',
      traceId: 'catalog-index-trace',
      correlationId: 'catalog-index-correlation',
      taskId: 'fixture-index-v1',
      siteKey: 'fixture-site',
      taskType: 'api-catalog-maintenance',
      adapterVersion: 'fixture-adapter-v1',
    });
    assert.equal(Object.hasOwn(event.details.capabilityHookMatches.lifecycleEvent, 'details'), false);
    assert.deepEqual(event.details.capabilityHookMatches.matches.map((match) => match.id), [
      'fixture-index-catalog-observer',
      'fixture-index-artifact-observer',
    ]);
    for (const match of event.details.capabilityHookMatches.matches) {
      assert.equal(Object.hasOwn(match.subscriber, 'modulePath'), false);
      assert.equal(Object.hasOwn(match.subscriber, 'entrypoint'), false);
    }
    assert.equal(event.details.catalogs[0].catalogVersion, 'fixture-api-v1');
    assert.deepEqual(event.details.catalogs[0].invalidationStatuses, {
      active: 1,
      stale: 1,
    });
    assert.equal(JSON.stringify(event).includes('"endpoint"'), false);
    assert.equal(JSON.stringify(event).includes('"request"'), false);
    assert.equal(JSON.stringify(event).includes('"auth"'), false);
    assert.equal(JSON.stringify(event).includes('"body"'), false);
    assert.equal(JSON.stringify(event).includes('"query"'), false);
    assert.equal(JSON.stringify(event).includes('candidateId'), false);
    assert.equal(JSON.stringify(event).includes('entries'), false);
    assert.equal(JSON.stringify(event).includes('catalogEntry'), false);
    assert.deepEqual(audit.redactedPaths, []);
    assert.deepEqual(eventAudit.redactedPaths, []);
    assert.equal(Object.hasOwn(persisted, 'redactionSummary'), false);
    assert.equal(Object.hasOwn(audit, 'redactionSummary'), false);
    assert.equal(indexText.includes('synthetic-fixture-access-token'), false);
    assert.equal(indexText.includes('synthetic-fixture-catalog-authorization'), false);
    assert.equal(indexText.includes('https://fixture.invalid'), false);
    assert.equal(auditText.includes('synthetic-fixture-access-token'), false);
    assert.equal(eventText.includes('synthetic-fixture-access-token'), false);
    assert.equal(eventText.includes('synthetic-fixture-catalog-authorization'), false);
    assert.equal(eventText.includes('https://fixture.invalid'), false);
    assert.equal(eventText.includes('synthetic/index-catalog-hook.mjs'), false);
    assert.equal(eventText.includes('synthetic/index-artifact-hook.mjs'), false);
    assert.equal(eventText.includes('shouldNotExecute'), false);
    assert.equal(eventAuditText.includes('synthetic-fixture-access-token'), false);
    assert.equal(eventAuditText.includes('synthetic/index-catalog-hook.mjs'), false);
    assert.equal(eventAuditText.includes('synthetic/index-artifact-hook.mjs'), false);
    assert.equal(eventAuditText.includes('shouldNotExecute'), false);

    await assert.rejects(
      writeApiCatalogIndexArtifact([{
        ...catalog,
        schemaVersion: API_CATALOG_SCHEMA_VERSION + 1,
      }], {
        indexPath: incompatibleIndexPath,
        redactionAuditPath: incompatibleAuditPath,
        lifecycleEventPath: incompatibleEventPath,
        lifecycleEventRedactionAuditPath: incompatibleEventAuditPath,
      }),
      /not compatible/u,
    );
    await assert.rejects(access(incompatibleIndexPath), /ENOENT/u);
    await assert.rejects(access(incompatibleAuditPath), /ENOENT/u);
    await assert.rejects(access(incompatibleEventPath), /ENOENT/u);
    await assert.rejects(access(incompatibleEventAuditPath), /ENOENT/u);
    await assert.rejects(
      writeApiCatalogIndexArtifact([{
        ...catalog,
        entries: [{
          ...catalog.entries[0],
          schemaVersion: API_CATALOG_ENTRY_SCHEMA_VERSION + 1,
        }],
      }], {
        indexPath: incompatibleEntryIndexPath,
        redactionAuditPath: incompatibleEntryAuditPath,
        lifecycleEventPath: incompatibleEntryEventPath,
        lifecycleEventRedactionAuditPath: incompatibleEntryEventAuditPath,
      }),
      /ApiCatalogEntry schemaVersion .*not compatible/u,
    );
    await assert.rejects(access(incompatibleEntryIndexPath), /ENOENT/u);
    await assert.rejects(access(incompatibleEntryAuditPath), /ENOENT/u);
    await assert.rejects(access(incompatibleEntryEventPath), /ENOENT/u);
    await assert.rejects(access(incompatibleEntryEventAuditPath), /ENOENT/u);
    await assert.rejects(
      writeApiCatalogIndexArtifact([{
        ...catalog,
        entries: [{
          ...catalog.entries[0],
          status: 'verified',
        }],
      }], {
        indexPath: candidateStatusIndexPath,
        redactionAuditPath: candidateStatusAuditPath,
        lifecycleEventPath: candidateStatusEventPath,
        lifecycleEventRedactionAuditPath: candidateStatusEventAuditPath,
      }),
      /Unsupported ApiCatalogEntry status: verified/u,
    );
    await assert.rejects(access(candidateStatusIndexPath), /ENOENT/u);
    await assert.rejects(access(candidateStatusAuditPath), /ENOENT/u);
    await assert.rejects(access(candidateStatusEventPath), /ENOENT/u);
    await assert.rejects(access(candidateStatusEventAuditPath), /ENOENT/u);
    await assert.rejects(
      writeApiCatalogIndexArtifact([catalog], {
        indexPath: partialEventIndexPath,
        lifecycleEventPath: partialEventPath,
      }),
      /must be provided together/u,
    );
    await assert.rejects(access(partialEventIndexPath), /ENOENT/u);
    await assert.rejects(access(partialEventPath), /ENOENT/u);
    assert.throws(
      () => createApiCatalogIndex('not-an-array'),
      /catalogs must be an array/u,
    );
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog index artifact writer rejects duplicate output paths before writing', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-index-duplicate-paths-'));
  try {
    const fixture = createVerifiedCatalogRegressionFixture();
    const catalog = createApiCatalogCollection(fixture.candidates, {
      catalogId: 'fixture-catalog-main',
      catalogVersion: 'fixture-api-v1',
      generatedAt: fixture.generatedAt,
      metadataByCandidateId: fixture.metadataByCandidateId,
    });
    const duplicatePath = path.join(runDir, 'api-catalog-index.json');
    await assert.rejects(
      writeApiCatalogIndexArtifact([catalog], {
        indexPath: duplicatePath,
        redactionAuditPath: duplicatePath,
      }),
      /output paths must be distinct/u,
    );
    await assertMissingFiles([duplicatePath]);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog index artifact writer rejects audit IO failure without partial index writes', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-index-audit-io-fail-'));
  try {
    const fixture = createVerifiedCatalogRegressionFixture();
    const catalog = createApiCatalogCollection(fixture.candidates, {
      catalogId: 'fixture-catalog-main',
      catalogVersion: 'fixture-api-v1',
      generatedAt: fixture.generatedAt,
      metadataByCandidateId: fixture.metadataByCandidateId,
    });
    const indexPath = path.join(runDir, 'api-catalog-index.json');
    const auditParentPath = path.join(runDir, 'audit-parent-is-file');
    const redactionAuditPath = path.join(auditParentPath, 'api-catalog-index.redaction-audit.json');
    await writeFile(auditParentPath, 'not-a-directory', 'utf8');

    await assert.rejects(
      writeApiCatalogIndexArtifact([catalog], {
        indexPath,
        redactionAuditPath,
      }),
      (error) => {
        assert.doesNotMatch(JSON.stringify(error), /synthetic-fixture-access-token|synthetic-fixture-catalog-authorization|authorization|cookie|csrf|sessionId/iu);
        return true;
      },
    );
    await assertMissingFiles([indexPath, redactionAuditPath]);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog index artifact writer preserves existing index when audit IO fails', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-index-audit-preserve-'));
  try {
    const fixture = createVerifiedCatalogRegressionFixture();
    const catalog = createApiCatalogCollection(fixture.candidates, {
      catalogId: 'fixture-catalog-main',
      catalogVersion: 'fixture-api-v1',
      generatedAt: fixture.generatedAt,
      metadataByCandidateId: fixture.metadataByCandidateId,
    });
    const indexPath = path.join(runDir, 'api-catalog-index.json');
    const auditParentPath = path.join(runDir, 'audit-parent-is-file');
    const redactionAuditPath = path.join(auditParentPath, 'api-catalog-index.redaction-audit.json');
    const indexSentinel = '{"sentinel":"index-before-audit-failure"}\n';
    await writeFile(indexPath, indexSentinel, 'utf8');
    await writeFile(auditParentPath, 'not-a-directory', 'utf8');

    await assert.rejects(
      writeApiCatalogIndexArtifact([catalog], {
        indexPath,
        redactionAuditPath,
      }),
    );
    assert.equal(await readFile(indexPath, 'utf8'), indexSentinel);
    await assertMissingFiles([redactionAuditPath]);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog index artifact writer rejects lifecycle audit IO failure without partial event writes', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-index-event-audit-io-fail-'));
  try {
    const fixture = createVerifiedCatalogRegressionFixture();
    const catalog = createApiCatalogCollection(fixture.candidates, {
      catalogId: 'fixture-catalog-main',
      catalogVersion: 'fixture-api-v1',
      generatedAt: fixture.generatedAt,
      metadataByCandidateId: fixture.metadataByCandidateId,
    });
    const indexPath = path.join(runDir, 'api-catalog-index.json');
    const redactionAuditPath = path.join(runDir, 'api-catalog-index.redaction-audit.json');
    const lifecycleEventPath = path.join(runDir, 'api-catalog-index.lifecycle-event.json');
    const eventAuditParentPath = path.join(runDir, 'event-audit-parent-is-file');
    const lifecycleEventRedactionAuditPath = path.join(
      eventAuditParentPath,
      'api-catalog-index.lifecycle-event.redaction-audit.json',
    );
    await writeFile(eventAuditParentPath, 'not-a-directory', 'utf8');

    await assert.rejects(
      writeApiCatalogIndexArtifact([catalog], {
        indexPath,
        redactionAuditPath,
        lifecycleEventPath,
        lifecycleEventRedactionAuditPath,
      }),
      (error) => {
        assert.doesNotMatch(JSON.stringify(error), /synthetic-fixture-access-token|synthetic-fixture-catalog-authorization|authorization|cookie|csrf|sessionId|shouldNotExecute/iu);
        return true;
      },
    );
    await assertMissingFiles([
      indexPath,
      redactionAuditPath,
      lifecycleEventPath,
      lifecycleEventRedactionAuditPath,
    ]);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog synthetic verified fixture covers entry collection event and audit boundaries', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-fixture-regression-'));
  try {
    const fixture = createVerifiedCatalogRegressionFixture();
    const entryPath = path.join(runDir, 'fixture', 'entry.json');
    const entryAuditPath = path.join(runDir, 'fixture', 'entry.redaction-audit.json');
    const collectionPath = path.join(runDir, 'fixture', 'api-catalog.json');
    const collectionAuditPath = path.join(runDir, 'fixture', 'api-catalog.redaction-audit.json');
    const eventPath = path.join(runDir, 'fixture', 'catalog-verification.json');
    const eventAuditPath = path.join(runDir, 'fixture', 'catalog-verification.redaction-audit.json');
    const nonVerifiedCatalogPath = path.join(runDir, 'fixture', 'non-verified-entry.json');
    const nonVerifiedEventPath = path.join(runDir, 'fixture', 'non-verified-event.json');
    const nonVerifiedEventAuditPath = path.join(runDir, 'fixture', 'non-verified-event.redaction-audit.json');
    const capabilityHookRegistry = createCapabilityHookRegistry([{
      id: 'fixture-api-catalog-verification-observer',
      phase: 'after_catalog_verify',
      hookType: 'observer',
      subscriber: {
        name: 'fixture-api-catalog-verification-subscriber',
        modulePath: 'synthetic/should-not-be-persisted.mjs',
        entrypoint: 'shouldNotBePersisted',
        capability: 'api-catalog',
      },
      filters: {
        eventTypes: ['api.catalog.verification.written'],
        siteKeys: ['fixture-site'],
      },
    }]);

    const entryResult = await writeApiCatalogEntryArtifact(fixture.candidates[0], {
      catalogPath: entryPath,
      redactionAuditPath: entryAuditPath,
      verificationEventPath: eventPath,
      verificationEventRedactionAuditPath: eventAuditPath,
      verificationEventTraceId: 'fixture-catalog-trace',
      verificationEventCorrelationId: 'fixture-catalog-correlation',
      capabilityHookRegistry,
      metadata: {
        ...fixture.metadataByCandidateId['fixture-catalog-video-list'],
        taskType: 'api-catalog-maintenance',
        adapterVersion: 'fixture-adapter-v1',
      },
    });
    const collectionResult = await writeApiCatalogCollectionArtifact(fixture.candidates, {
      catalogPath: collectionPath,
      redactionAuditPath: collectionAuditPath,
      generatedAt: fixture.generatedAt,
      metadataByCandidateId: fixture.metadataByCandidateId,
    });

    const entryText = await readFile(entryPath, 'utf8');
    const entryAuditText = await readFile(entryAuditPath, 'utf8');
    const collectionText = await readFile(collectionPath, 'utf8');
    const collectionAuditText = await readFile(collectionAuditPath, 'utf8');
    const eventText = await readFile(eventPath, 'utf8');
    const eventAuditText = await readFile(eventAuditPath, 'utf8');
    const entry = JSON.parse(entryText);
    const entryAudit = JSON.parse(entryAuditText);
    const collection = JSON.parse(collectionText);
    const collectionAudit = JSON.parse(collectionAuditText);
    const event = JSON.parse(eventText);
    const eventAudit = JSON.parse(eventAuditText);

    assert.equal(assertApiCatalogEntryCompatible(entry), true);
    assert.equal(assertApiCatalogCompatible(collection), true);
    assert.equal(assertSchemaCompatible('LifecycleEvent', event), true);
    assert.equal(assertLifecycleEventObservabilityFields(event, {
      requiredFields: [
        'traceId',
        'correlationId',
        'taskId',
        'siteKey',
        'taskType',
        'adapterVersion',
      ],
      requiredDetailFields: [
        'candidateId',
        'catalogVersion',
        'catalogStatus',
        'invalidationStatus',
        'verifiedAt',
        'lastValidatedAt',
        'catalogEntry',
        'capabilityHookMatches',
      ],
    }), true);
    assert.equal(entryResult.entry.candidateId, 'fixture-catalog-video-list');
    assert.equal(entry.schemaVersion, API_CATALOG_ENTRY_SCHEMA_VERSION);
    assert.equal(entry.siteKey, 'fixture-site');
    assert.equal(entry.status, 'cataloged');
    assert.equal(entry.version, 'fixture-api-v1');
    assert.equal(entry.verifiedAt, '2026-05-01T04:05:00.000Z');
    assert.equal(entry.lastValidatedAt, '2026-05-01T04:06:00.000Z');
    assert.equal(entry.invalidationStatus, 'active');
    assert.equal(entry.auth.authorization, REDACTION_PLACEHOLDER);
    assert.equal(entry.endpoint.url.includes('synthetic-fixture-access-token'), false);
    assert.equal(collectionResult.catalog.entries.length, 2);
    assert.equal(collection.schemaVersion, API_CATALOG_SCHEMA_VERSION);
    assert.equal(collection.generatedAt, '2026-05-01T04:10:00.000Z');
    assert.equal(collection.entries[0].candidateId, 'fixture-catalog-video-list');
    assert.equal(collection.entries[1].candidateId, 'fixture-catalog-video-detail');
    assert.deepEqual(collection.entries.map((catalogEntry) => ({
      candidateId: catalogEntry.candidateId,
      status: catalogEntry.status,
      version: catalogEntry.version,
      invalidationStatus: catalogEntry.invalidationStatus,
      verifiedAt: catalogEntry.verifiedAt,
      lastValidatedAt: catalogEntry.lastValidatedAt,
    })), [{
      candidateId: 'fixture-catalog-video-list',
      status: 'cataloged',
      version: 'fixture-api-v1',
      invalidationStatus: 'active',
      verifiedAt: '2026-05-01T04:05:00.000Z',
      lastValidatedAt: '2026-05-01T04:06:00.000Z',
    }, {
      candidateId: 'fixture-catalog-video-detail',
      status: 'cataloged',
      version: 'fixture-api-v1',
      invalidationStatus: 'stale',
      verifiedAt: '2026-05-01T04:07:00.000Z',
      lastValidatedAt: '2026-05-01T04:08:00.000Z',
    }]);
    assert.equal(collection.entries[0].auth.authorization, REDACTION_PLACEHOLDER);
    assert.equal(collection.entries[1].endpoint.url.includes('synthetic-fixture-csrf'), false);
    assert.equal(event.eventType, 'api.catalog.verification.written');
    assert.equal(event.traceId, 'fixture-catalog-trace');
    assert.equal(event.correlationId, 'fixture-catalog-correlation');
    assert.equal(event.taskId, 'fixture-catalog-video-list');
    assert.equal(event.siteKey, 'fixture-site');
    assert.equal(event.taskType, 'api-catalog-maintenance');
    assert.equal(event.adapterVersion, 'fixture-adapter-v1');
    assert.equal(event.details.catalogVersion, 'fixture-api-v1');
    assert.equal(event.details.catalogStatus, 'cataloged');
    assert.equal(event.details.invalidationStatus, 'active');
    assert.equal(event.details.verifiedAt, '2026-05-01T04:05:00.000Z');
    assert.equal(event.details.lastValidatedAt, '2026-05-01T04:06:00.000Z');
    assert.equal(event.details.catalogEntry.auth.authorization, REDACTION_PLACEHOLDER);
    assert.deepEqual(event.details.capabilityHookMatches.phases, ['after_catalog_verify']);
    assert.equal(event.details.capabilityHookMatches.matchCount, 1);
    assert.deepEqual(event.details.capabilityHookMatches.lifecycleEvent, {
      schemaVersion: 1,
      eventType: 'api.catalog.verification.written',
      traceId: 'fixture-catalog-trace',
      correlationId: 'fixture-catalog-correlation',
      taskId: 'fixture-catalog-video-list',
      siteKey: 'fixture-site',
      taskType: 'api-catalog-maintenance',
      adapterVersion: 'fixture-adapter-v1',
    });
    assert.equal(Object.hasOwn(event.details.capabilityHookMatches.lifecycleEvent, 'details'), false);
    assert.equal(
      event.details.capabilityHookMatches.matches[0].id,
      'fixture-api-catalog-verification-observer',
    );
    assert.equal(
      event.details.capabilityHookMatches.matches[0].subscriber.name,
      'fixture-api-catalog-verification-subscriber',
    );
    assert.equal(
      Object.hasOwn(event.details.capabilityHookMatches.matches[0].subscriber, 'modulePath'),
      false,
    );
    assert.equal(
      Object.hasOwn(event.details.capabilityHookMatches.matches[0].subscriber, 'entrypoint'),
      false,
    );
    assert.equal(entryAudit.redactedPaths.includes('auth.authorization'), true);
    assert.equal(collectionAudit.redactedPaths.includes('entries.0.auth.authorization'), true);
    assert.equal(eventAudit.redactedPaths.includes('details.catalogEntry.auth.authorization'), true);

    for (const text of [
      entryText,
      entryAuditText,
      collectionText,
      collectionAuditText,
      eventText,
      eventAuditText,
    ]) {
      assert.equal(text.includes('synthetic-fixture-access-token'), false);
      assert.equal(text.includes('synthetic-fixture-authorization'), false);
      assert.equal(text.includes('synthetic-fixture-catalog-authorization'), false);
      assert.equal(text.includes('synthetic-fixture-csrf'), false);
      assert.equal(text.includes('synthetic-fixture-detail-authorization'), false);
      assert.equal(text.includes('synthetic-fixture-detail-csrf'), false);
      assert.equal(text.includes('synthetic/should-not-be-persisted.mjs'), false);
      assert.equal(text.includes('shouldNotBePersisted'), false);
    }

    await assert.rejects(
      writeApiCatalogEntryArtifact(createCandidate({
        id: 'fixture-non-verified',
        siteKey: 'fixture-site',
        status: 'candidate',
      }), {
        catalogPath: nonVerifiedCatalogPath,
        verificationEventPath: nonVerifiedEventPath,
        verificationEventRedactionAuditPath: nonVerifiedEventAuditPath,
      }),
      /ApiCandidate must be verified before catalog entry/u,
    );
    await assert.rejects(access(nonVerifiedCatalogPath), /ENOENT/u);
    await assert.rejects(access(nonVerifiedEventPath), /ENOENT/u);
    await assert.rejects(access(nonVerifiedEventAuditPath), /ENOENT/u);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCatalog schema incompatibility emits safe lifecycle evidence without catalog writes', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-schema-incompatible-'));
  try {
    const catalogPath = path.join(runDir, 'catalog', 'future-entry.json');
    const collectionPath = path.join(runDir, 'catalog', 'future-collection.json');
    const eventPath = path.join(runDir, 'events', 'schema-incompatible.json');
    const auditPath = path.join(runDir, 'events', 'schema-incompatible.redaction-audit.json');
    const futureCandidate = createCandidate({
      id: 'future-schema-candidate',
      siteKey: 'fixture-site',
      status: 'verified',
      schemaVersion: API_CANDIDATE_SCHEMA_VERSION + 1,
      auth: {
        authorization: 'Bearer synthetic-future-schema-token',
      },
      request: {
        headers: {
          authorization: 'Bearer synthetic-future-schema-request-token',
        },
        body: {
          csrf: 'synthetic-future-schema-csrf',
        },
      },
    });

    await assert.rejects(
      writeApiCatalogEntryArtifact(futureCandidate, { catalogPath }),
      /not compatible/u,
    );
    await assert.rejects(
      writeApiCatalogCollectionArtifact([futureCandidate], { catalogPath: collectionPath }),
      /not compatible/u,
    );
    await assert.rejects(access(catalogPath), /ENOENT/u);
    await assert.rejects(access(collectionPath), /ENOENT/u);

    const capabilityHookRegistry = createCapabilityHookRegistry([{
      id: 'fixture-schema-incompatible-catalog-observer',
      phase: 'after_catalog_verify',
      hookType: 'observer',
      subscriber: {
        name: 'fixture-schema-incompatible-catalog-subscriber',
        modulePath: 'synthetic/catalog-schema-hook.mjs',
        entrypoint: 'shouldNotExecute',
        capability: 'api-catalog',
      },
      filters: {
        eventTypes: ['api.catalog.schema_incompatible'],
        siteKeys: ['fixture-site'],
        reasonCodes: ['schema-version-incompatible'],
      },
    }, {
      id: 'fixture-schema-incompatible-failure-observer',
      phase: 'on_failure',
      hookType: 'observer',
      subscriber: {
        name: 'fixture-schema-incompatible-failure-subscriber',
        modulePath: 'synthetic/failure-schema-hook.mjs',
        entrypoint: 'shouldNotExecute',
        capability: 'api-catalog',
      },
      filters: {
        eventTypes: ['api.catalog.schema_incompatible'],
        siteKeys: ['fixture-site'],
        reasonCodes: ['schema-version-incompatible'],
      },
    }]);

    const evidence = createApiCatalogSchemaIncompatibilityLifecycleEvent({
      schemaName: 'ApiCandidate',
      expectedVersion: API_CANDIDATE_SCHEMA_VERSION,
      receivedVersion: API_CANDIDATE_SCHEMA_VERSION + 1,
      operation: 'api-catalog-entry-write',
      siteKey: 'fixture-site',
      candidateId: 'future-schema-candidate',
      traceId: 'schema-incompatible-trace',
      correlationId: 'schema-incompatible-correlation',
      taskType: 'api-catalog-maintenance',
      adapterVersion: 'fixture-adapter-v1',
      createdAt: '2026-05-01T05:00:00.000Z',
      capabilityHookRegistry,
    });
    const result = await writeLifecycleEventArtifact(evidence, {
      eventPath,
      auditPath,
    });

    const eventText = await readFile(eventPath, 'utf8');
    const auditText = await readFile(auditPath, 'utf8');
    const event = JSON.parse(eventText);
    const audit = JSON.parse(auditText);

    assert.equal(result.artifacts.lifecycleEvent, eventPath);
    assert.equal(assertSchemaCompatible('LifecycleEvent', event), true);
    assert.equal(assertLifecycleEventObservabilityFields(event, {
      requiredFields: [
        'traceId',
        'correlationId',
        'taskId',
        'siteKey',
        'taskType',
        'adapterVersion',
        'reasonCode',
      ],
      requiredDetailFields: [
        'operation',
        'schemaName',
        'expectedVersion',
        'receivedVersion',
        'failClosed',
        'artifactWriteAllowed',
        'retryable',
        'manualRecoveryNeeded',
        'reasonRecovery',
        'capabilityHookMatches',
      ],
    }), true);
    assert.equal(event.eventType, 'api.catalog.schema_incompatible');
    assert.equal(event.reasonCode, 'schema-version-incompatible');
    assert.equal(event.traceId, 'schema-incompatible-trace');
    assert.equal(event.correlationId, 'schema-incompatible-correlation');
    assert.equal(event.taskId, 'future-schema-candidate');
    assert.equal(event.siteKey, 'fixture-site');
    assert.equal(event.taskType, 'api-catalog-maintenance');
    assert.equal(event.adapterVersion, 'fixture-adapter-v1');
    assert.equal(event.details.schemaName, 'ApiCandidate');
    assert.equal(event.details.expectedVersion, API_CANDIDATE_SCHEMA_VERSION);
    assert.equal(event.details.receivedVersion, API_CANDIDATE_SCHEMA_VERSION + 1);
    assert.equal(event.details.failClosed, true);
    assert.equal(event.details.artifactWriteAllowed, false);
    assert.equal(event.details.retryable, false);
    assert.equal(event.details.manualRecoveryNeeded, true);
    assert.deepEqual(event.details.reasonRecovery, reasonCodeSummary('schema-version-incompatible'));
    assert.deepEqual(event.details.capabilityHookMatches.phases, [
      'after_catalog_verify',
      'on_failure',
    ]);
    assert.equal(event.details.capabilityHookMatches.matchCount, 2);
    assert.deepEqual(event.details.capabilityHookMatches.lifecycleEvent, {
      schemaVersion: 1,
      eventType: 'api.catalog.schema_incompatible',
      traceId: 'schema-incompatible-trace',
      correlationId: 'schema-incompatible-correlation',
      taskId: 'future-schema-candidate',
      siteKey: 'fixture-site',
      taskType: 'api-catalog-maintenance',
      adapterVersion: 'fixture-adapter-v1',
      reasonCode: 'schema-version-incompatible',
    });
    assert.equal(Object.hasOwn(event.details.capabilityHookMatches.lifecycleEvent, 'details'), false);
    assert.deepEqual(event.details.capabilityHookMatches.matches.map((match) => match.id), [
      'fixture-schema-incompatible-catalog-observer',
      'fixture-schema-incompatible-failure-observer',
    ]);
    for (const match of event.details.capabilityHookMatches.matches) {
      assert.equal(Object.hasOwn(match.subscriber, 'modulePath'), false);
      assert.equal(Object.hasOwn(match.subscriber, 'entrypoint'), false);
    }
    assert.deepEqual(audit.redactedPaths, []);
    assert.equal(eventText.includes('synthetic-future-schema-token'), false);
    assert.equal(eventText.includes('synthetic-future-schema-request-token'), false);
    assert.equal(eventText.includes('synthetic-future-schema-csrf'), false);
    assert.equal(eventText.includes('synthetic/catalog-schema-hook.mjs'), false);
    assert.equal(eventText.includes('synthetic/failure-schema-hook.mjs'), false);
    assert.equal(eventText.includes('shouldNotExecute'), false);
    assert.equal(auditText.includes('synthetic-future-schema-token'), false);
    assert.equal(auditText.includes('synthetic-future-schema-request-token'), false);
    assert.equal(auditText.includes('synthetic-future-schema-csrf'), false);
    assert.equal(auditText.includes('synthetic/catalog-schema-hook.mjs'), false);
    assert.equal(auditText.includes('synthetic/failure-schema-hook.mjs'), false);
    assert.equal(auditText.includes('shouldNotExecute'), false);
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('ApiCandidate rejects missing required fields and unsupported statuses', () => {
  assert.throws(
    () => normalizeApiCandidate(createCandidate({ siteKey: '' })),
    /siteKey is required/u,
  );
  assert.throws(
    () => normalizeApiCandidate(createCandidate({ endpoint: { method: 'GET', url: '' } })),
    /endpoint\.url is required/u,
  );
  assert.throws(
    () => normalizeApiCandidate(createCandidate({ status: 'stable' })),
    /Unsupported ApiCandidate status/u,
  );
});
