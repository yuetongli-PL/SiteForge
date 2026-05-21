import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';

import {
  runSiteForgeBuild,
  stableSiteIdFromUrl,
} from '../../src/app/pipeline/build/index.mjs';
import {
  writeVerifiedApiCatalogArtifactsFromObservedProducerEvidence,
} from '../../src/domain/capabilities/api-catalog-promotion.mjs';
import {
  createExecutionPolicyDecision,
  createLayerExecutionHandoffDescriptor,
  createLayerOwnedRuntimeConsumerResult,
  writeLayerOwnedRuntimeFeedbackArtifacts,
} from '../../src/domain/policies/execution/index.mjs';
import {
  assertNoForbiddenPatterns,
} from '../../src/domain/sessions/security-guard.mjs';

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function collectTextFiles(rootDir) {
  const rows = /** @type {any[]} */ ([]);
  async function visit(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        rows.push({
          filePath: entryPath,
          text: await readFile(entryPath, 'utf8'),
        });
      }
    }
  }
  await visit(rootDir);
  return rows;
}

function catalogPaths(runDir, prefix = 'catalog') {
  const dir = path.join(runDir, prefix);
  return {
    decisionPath: path.join(dir, 'decision.json'),
    decisionRedactionAuditPath: path.join(dir, 'decision.redaction-audit.json'),
    catalogPath: path.join(dir, 'entry.json'),
    catalogRedactionAuditPath: path.join(dir, 'entry.redaction-audit.json'),
    verificationEventPath: path.join(dir, 'verification-event.json'),
    verificationEventRedactionAuditPath: path.join(dir, 'verification-event.redaction-audit.json'),
    collectionPath: path.join(dir, 'collection.json'),
    collectionRedactionAuditPath: path.join(dir, 'collection.redaction-audit.json'),
    collectionLifecycleEventPath: path.join(dir, 'collection-event.json'),
    collectionLifecycleEventRedactionAuditPath: path.join(dir, 'collection-event.redaction-audit.json'),
    indexPath: path.join(dir, 'index.json'),
    indexRedactionAuditPath: path.join(dir, 'index.redaction-audit.json'),
    indexLifecycleEventPath: path.join(dir, 'index-event.json'),
    indexLifecycleEventRedactionAuditPath: path.join(dir, 'index-event.redaction-audit.json'),
  };
}

async function assertMissingFiles(paths) {
  for (const filePath of Object.values(paths)) {
    await assert.rejects(access(filePath), /ENOENT/u);
  }
}

function safeObservedSearchRequest() {
  return {
    id: 'observed-search-api',
    siteKey: 'synthetic-navigation',
    status: 'observed',
    method: 'GET',
    url: 'https://example.invalid/api/search?q=sample',
    resourceType: 'fetch',
    headers: {
      accept: 'application/json',
    },
    body: {
      safe: true,
    },
    source: 'controlled-capture-producer',
    evidence: {
      producer: 'capture-network',
    },
  };
}

function acceptedSearchDecision() {
  return {
    adapterId: 'synthetic-adapter',
    adapterVersion: 'adapter-v1',
    decision: 'accepted',
    validatedAt: '2026-05-16T00:01:00.000Z',
    evidence: {
      route: 'search-content',
    },
  };
}

function verificationFixtures() {
  return {
    verifierId: 'synthetic-multi-aspect-verifier',
    verifiedAt: '2026-05-16T00:02:00.000Z',
    responseFixture: {
      statusCode: 200,
      body: {
        items: [{ id: 'sample-id', title: 'Sample title' }],
        paging: { hasMore: false },
      },
    },
    authFixture: {
      authRequirement: 'none',
      requestProtectionRequirement: 'none',
    },
    paginationFixture: {
      paginationModel: 'none',
    },
    riskFixture: {
      riskState: 'low',
      riskLevel: 'low',
    },
  };
}

test('SiteForge build artifacts do not persist sensitive input URL material', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-redaction-'));
  const sensitiveUrl = 'https://fixture.local/?access_token=synthetic-build-token&safe=1&utm_source=x#frag';
  try {
    const result = await runSiteForgeBuild(sensitiveUrl, {
      cwd: workspace,
      buildId: 'redaction-build',
      now: new Date('2026-05-16T03:00:00.000Z'),
    });

    assert.equal(result.status, 'success');
    assert.equal(result.inputUrl, 'https://fixture.local/?safe=1');

    const buildReport = await readJson(result.artifacts['build_report.json']);
    assert.equal(buildReport.inputUrl, 'https://fixture.local/?safe=1');
    assert.equal(buildReport.siteId, stableSiteIdFromUrl('https://fixture.local/'));

    const generatedTexts = [
      ...await collectTextFiles(path.join(workspace, '.siteforge')),
    ];
    assert.equal(generatedTexts.length > 0, true);
    for (const { filePath, text } of generatedTexts) {
      assert.equal(text.includes('synthetic-build-token'), false, `${filePath} leaked the raw build token`);
      assert.equal(text.includes('access_token=synthetic-build-token'), false, `${filePath} leaked the raw query`);
      assert.equal(assertNoForbiddenPatterns(text), true, `${filePath} should pass forbidden-pattern scan`);
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verified API catalog promotion rejects sensitive evidence refs before artifact writes', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-promotion-sensitive-ref-'));
  try {
    const paths = catalogPaths(runDir, 'blocked-sensitive-ref');
    await assert.rejects(
      () => writeVerifiedApiCatalogArtifactsFromObservedProducerEvidence({
        observedRequest: safeObservedSearchRequest(),
        siteAdapterDecision: acceptedSearchDecision(),
        catalogUpgradePolicy: {
          adapterId: 'synthetic-adapter',
          allowCatalogUpgrade: true,
          evidence: {
            policy: 'catalog-upgrade-allowed',
          },
        },
        verification: verificationFixtures(),
        promotionEvidence: {
          schemaEvidenceRef: 'schema:synthetic-search-response',
          policyEvidenceRef: 'policy:synthetic-catalog-upgrade',
          testEvidenceRefs: ['test:api-catalog?access_token=synthetic-promotion-token'],
        },
        decidedAt: '2026-05-16T00:03:00.000Z',
      }, {
        ...paths,
        collectionGeneratedAt: '2026-05-16T00:04:00.000Z',
        collectionCatalogId: 'synthetic-api-catalog',
        collectionCatalogVersion: 'catalog-v1',
        indexGeneratedAt: '2026-05-16T00:05:00.000Z',
        indexVersion: 'index-v1',
        indexLifecycleEventSiteKey: 'synthetic-navigation',
        indexLifecycleEventTaskType: 'api-catalog-maintenance',
        indexLifecycleEventAdapterVersion: 'adapter-v1',
      }),
      /Forbidden sensitive pattern/u,
    );
    await assertMissingFiles(paths);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('Layer-owned runtime feedback writes descriptor artifacts and audit sidecars without executing tasks', async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'layer-runtime-feedback-write-'));
  try {
    const handoffDescriptor = createLayerExecutionHandoffDescriptor({
      executionId: 'execution:layer-feedback-write',
      capabilityPlanRef: 'plan:layer-feedback-write',
      graphVersion: 'graph:v1',
      plannerVersion: 'planner:v1',
      layerCompatibilityVersion: 'layer:v1',
    });
    const policyDecision = createExecutionPolicyDecision({
      handoffDescriptor,
      plannerHandoffRef: 'planner-handoff:layer-feedback-write',
      approvalSatisfied: true,
    });
    const result = createLayerOwnedRuntimeConsumerResult({
      handoffDescriptor,
      policyDecision,
      layerReceipt: {
        executionStatus: 'completed',
        artifactRefs: ['artifact:layer-summary'],
      },
      coverageBefore: 'partial',
      coverageAfter: 'complete_within_scope',
      deltaType: 'verified',
      affectedNodeRefs: ['node:home'],
      affectedCapabilityRefs: ['capability:search-content'],
      affectedRouteRefs: ['route:search-content'],
      traceId: 'trace-layer-feedback-write',
      correlationId: 'correlation-layer-feedback-write',
      siteKey: 'synthetic-navigation',
      adapterVersion: 'adapter-v1',
    });

    const writeSummary = await writeLayerOwnedRuntimeFeedbackArtifacts({ outDir, result });
    assert.equal(writeSummary.writeAllowed, true);
    assert.equal(writeSummary.runtimeExecuted, false);
    assert.equal(writeSummary.runtimeTaskExecutedByConsumer, false);
    assert.equal(writeSummary.directDownloaderInvocationAllowed, false);
    assert.equal(writeSummary.directSiteAdapterInvocationAllowed, false);
    assert.equal(writeSummary.sessionViewMaterializationAllowed, false);
    assert.equal(writeSummary.artifactFiles.length, 5);
    assert.equal(writeSummary.auditFiles.length, 5);

    const consumer = await readJson(path.join(outDir, 'layer-runtime-consumer-result.json'));
    assert.equal(consumer.consumerOwner, 'site-capability-layer');
    assert.equal(consumer.runtimeExecuted, false);
    assert.equal(consumer.directDownloaderInvocationAllowed, false);
    assert.equal(consumer.directSiteAdapterInvocationAllowed, false);
    assert.equal(consumer.sessionViewMaterializationAllowed, false);
    assert.equal(consumer.rawCredentialMaterialAllowed, false);
    assert.equal(consumer.coverageDeltaQueueEntry.queueMode, 'redacted_descriptor_queue');

    for (const fileName of [...writeSummary.artifactFiles, ...writeSummary.auditFiles]) {
      const text = await readFile(path.join(outDir, fileName), 'utf8');
      assert.equal(assertNoForbiddenPatterns(text), true, `${fileName} should pass forbidden-pattern scan`);
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
