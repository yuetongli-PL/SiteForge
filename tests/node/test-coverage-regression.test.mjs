import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
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
import {
  simpleShopRoutes,
  withTestSite,
} from './helpers/test-site-server.mjs';

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readPackageScripts() {
  const packageJson = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'));
  return packageJson.scripts ?? {};
}

function scriptTestFiles(script) {
  return new Set(String(script ?? '')
    .split(/\s+/u)
    .filter((part) => /^tests\/node\/.*\.test\.mjs$/u.test(part)));
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

test('stale SiteForge golden output fixtures stay absent unless wired into tests', async () => {
  const goldenDir = path.join(process.cwd(), 'tests', 'golden');
  let fileNames = /** @type {string[]} */ ([]);
  try {
    fileNames = await readdir(goldenDir);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
  assert.deepEqual(
    fileNames.filter((name) => /^siteforge_build_.*_output\.txt$/u.test(name)),
    [],
  );
});

test('focused pipeline suite includes build profile reuse coverage', async () => {
  const scripts = await readPackageScripts();
  const pipelineTestFiles = scriptTestFiles(scripts['test:pipeline']);

  assert.equal(
    pipelineTestFiles.has('tests/node/build-profile-reuse.test.mjs'),
    true,
    'test:pipeline should cover saved build_profile.json reuse and crawlContract compatibility',
  );
});

test('focused pipeline suite includes browser bridge version policy coverage', async () => {
  const scripts = await readPackageScripts();
  const pipelineTestFiles = scriptTestFiles(scripts['test:pipeline']);

  assert.equal(
    pipelineTestFiles.has('tests/node/browser-bridge-version-policy.test.mjs'),
    true,
    'test:pipeline should cover browser bridge extension version compatibility policy',
  );
});

test('focused pipeline suite includes browser bridge route coverage policy coverage', async () => {
  const scripts = await readPackageScripts();
  const pipelineTestFiles = scriptTestFiles(scripts['test:pipeline']);

  assert.equal(
    pipelineTestFiles.has('tests/node/browser-bridge-route-coverage.test.mjs'),
    true,
    'test:pipeline should cover browser bridge route capture and retry policy',
  );
});

test('focused pipeline suite includes capability evidence matrix coverage', async () => {
  const scripts = await readPackageScripts();
  const pipelineTestFiles = scriptTestFiles(scripts['test:pipeline']);

  assert.equal(
    pipelineTestFiles.has('tests/node/capability-evidence-matrix.test.mjs'),
    true,
    'test:pipeline should cover capability evidence matrix activation policy',
  );
});

test('focused capability suite includes runtime contract conformance coverage', async () => {
  const scripts = await readPackageScripts();
  const capabilityTestFiles = scriptTestFiles(scripts['test:capability']);

  assert.equal(
    capabilityTestFiles.has('tests/node/capability-contract-conformance.test.mjs'),
    true,
    'test:capability should cover Controlled Runtime capability contract conformance',
  );
});

test('focused core suite includes shared wiki and architecture gate coverage', async () => {
  const scripts = await readPackageScripts();
  const focusedScript = scripts['test:node:focused'] ?? '';
  const coreTestFiles = scriptTestFiles(scripts['test:core']);

  assert.match(
    focusedScript,
    /\btest:core\b/u,
    'test:node:focused should continue running the core architecture gate suite',
  );
  for (const file of [
    'tests/node/architecture-import-rules.test.mjs',
    'tests/node/test-coverage-regression.test.mjs',
    'tests/node/controlled-browser-runtime-v2.test.mjs',
    'tests/node/shared-wiki.test.mjs',
    'tests/node/site-doctor-progress-copy.test.mjs',
  ]) {
    assert.equal(coreTestFiles.has(file), true, `test:core should include ${file}`);
  }
});

test('SiteForge build artifacts do not persist sensitive input URL material', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-redaction-'));
  try {
    await withTestSite(simpleShopRoutes, async (rootUrl) => {
      const sensitiveUrl = `${rootUrl}?access_token=synthetic-build-token&safe=1&utm_source=x#frag`;
      const expectedSafeUrl = `${rootUrl}?safe=1`;
      const result = await runSiteForgeBuild(sensitiveUrl, {
        cwd: workspace,
        buildId: 'redaction-build',
        now: new Date('2026-05-16T03:00:00.000Z'),
        fetchDelayMs: 0,
      });

      assert.equal(result.status, 'success');
      assert.equal(result.inputUrl, expectedSafeUrl);

      const buildReport = await readJson(result.artifacts['build_report.json']);
      assert.equal(buildReport.inputUrl, expectedSafeUrl);
      assert.equal(buildReport.siteId, stableSiteIdFromUrl(rootUrl));

      const generatedTexts = [
        ...await collectTextFiles(path.join(workspace, '.siteforge')),
      ];
      assert.equal(generatedTexts.length > 0, true);
      for (const { filePath, text } of generatedTexts) {
        assert.equal(text.includes('synthetic-build-token'), false, `${filePath} leaked the raw build token`);
        assert.equal(text.includes('access_token=synthetic-build-token'), false, `${filePath} leaked the raw query`);
        assert.equal(assertNoForbiddenPatterns(text), true, `${filePath} should pass forbidden-pattern scan`);
      }
    });
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
