import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  writeVerifiedApiCatalogArtifactsFromObservedProducerEvidence,
} from '../../src/sites/capability/api-catalog-promotion.mjs';
import {
  createBilibiliSiteSpecificDiscoveryArtifacts,
  writeBilibiliVerifiedApiCatalogArtifactsFromGovernedProducerEvidence,
} from '../../src/sites/bilibili/capability-evidence-fixtures.mjs';
import {
  assertExecutableCapabilityEvidenceFixtureCompatible,
  createExecutableCapabilityEvidenceFixture,
} from '../../src/sites/capability/capability-evidence-chain.mjs';
import {
  createSiteOnboardingDiscoveryArtifacts,
  createSiteOnboardingDiscoveryInputFromCaptureExpand,
} from '../../src/sites/capability/site-onboarding-discovery.mjs';
import {
  assertLayerOwnedRuntimeConsumerResultCompatible,
  createExecutionPolicyDecision,
  createLayerExecutionHandoffDescriptor,
  createLayerOwnedRuntimeConsumerResult,
} from '../../src/sites/capability/execution/index.mjs';
import {
  assertNoForbiddenPatterns,
} from '../../src/sites/capability/security-guard.mjs';

function adapterFromDecisions({
  nodes = {},
  apis = {},
  capabilityEvidenceFixtures = [],
} = {}) {
  return {
    id: 'synthetic-adapter',
    metadata: {
      capabilityEvidenceFixtures,
    },
    classifyNode(node) {
      return nodes[node.id] ?? {
        classification: 'unknown',
        required: node.required,
      };
    },
    classifyApi(api) {
      return apis[api.id] ?? {
        classification: 'unknown',
        required: api.required,
      };
    },
  };
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

function observedSearchRequest() {
  const sensitiveQueryKey = 'access' + '_token';
  return {
    id: 'observed-search-api',
    siteKey: 'synthetic-navigation',
    status: 'observed',
    method: 'GET',
    url: `https://example.invalid/api/search?${sensitiveQueryKey}=synthetic-promotion-token&q=sample`,
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
    validatedAt: '2026-05-10T00:00:00.000Z',
    evidence: {
      route: 'search-content',
    },
  };
}

function verificationFixtures() {
  return {
    verifierId: 'synthetic-multi-aspect-verifier',
    verifiedAt: '2026-05-10T00:01:00.000Z',
    responseFixture: {
      statusCode: 200,
      body: {
        items: [{
          id: 'sample-id',
          title: 'Sample title',
        }],
        paging: {
          hasMore: false,
        },
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

test('real producer intake records DOM a11y governed retry and transport API surfaces', () => {
  const discoveryInput = createSiteOnboardingDiscoveryInputFromCaptureExpand({
    siteKey: 'synthetic-navigation',
    capture: {
      domNodes: [{
        id: 'dom-search-form',
        tagName: 'form',
        role: 'search',
        label: 'Search',
      }],
      accessibilityNodes: [{
        id: 'a11y-open-menu',
        role: 'menuitem',
        name: 'Open menu',
      }],
    },
    expand: {
      governedRetryAttempts: [{
        id: 'retry-lazy-menu',
        label: 'Open lazy menu',
        kind: 'button',
        status: 'skipped_by_budget',
        reasonCode: 'skipped_by_budget',
        attempted: true,
        attemptCount: 1,
        governedAttempt: true,
        retryExecuted: true,
      }],
    },
    networkRequests: [
      {
        id: 'ws-feed',
        method: 'GET',
        url: 'wss://example.invalid/ws/feed',
        resourceType: 'websocket',
      },
      {
        id: 'sse-feed',
        method: 'GET',
        url: 'https://example.invalid/events',
        resourceType: 'eventsource',
      },
      {
        id: 'preflight-search',
        method: 'OPTIONS',
        url: 'https://example.invalid/api/search',
        resourceType: 'preflight',
      },
    ],
  });

  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'synthetic-navigation',
    discoveredNodes: discoveryInput.discoveredNodes,
    discoveredApis: discoveryInput.discoveredApis,
    adapter: adapterFromDecisions(),
  });

  const nodeEntries = artifacts.objects.NODE_INVENTORY.entries;
  const apiEntries = artifacts.objects.API_INVENTORY.entries;
  assert.equal(nodeEntries.some((entry) => entry.source === 'domNodes' && entry.tagName === 'form'), true);
  assert.equal(nodeEntries.some((entry) =>
    entry.source === 'accessibilityNodes' && entry.role === 'menuitem'), true);
  const retryNode = nodeEntries.find((entry) => entry.id.includes('retry-lazy-menu'));
  assert.equal(retryNode.discoveryStatus, 'skipped_by_budget');
  assert.equal(retryNode.attemptResult.governedAttempt, true);
  assert.equal(retryNode.attemptResult.retryExecuted, true);
  assert.equal(retryNode.followUpStrategy.retryClass, 'budget-expansion');
  assert.equal(apiEntries.some((entry) => entry.resourceType === 'websocket'), true);
  assert.equal(apiEntries.some((entry) => entry.resourceType === 'eventsource'), true);
  assert.equal(apiEntries.some((entry) => entry.method === 'OPTIONS'), true);
  assert.equal(artifacts.objects.UNKNOWN_NODE_REPORT.artifactName, 'UNKNOWN_NODE_REPORT');
  assert.equal(artifacts.objects.UNKNOWN_API_REPORT.artifactName, 'UNKNOWN_API_REPORT');
  assertNoForbiddenPatterns(artifacts);
});

test('Bilibili concrete site evidence flows through governed producer, API catalog, and executable capability gates', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bilibili-site-specific-evidence-'));
  try {
    const paths = catalogPaths(runDir, 'bilibili');
    const catalogResult = await writeBilibiliVerifiedApiCatalogArtifactsFromGovernedProducerEvidence({
      ...paths,
      collectionGeneratedAt: '2026-05-10T00:10:00.000Z',
      collectionCatalogId: 'bilibili-api-catalog',
      collectionCatalogVersion: 'catalog-v1',
      indexGeneratedAt: '2026-05-10T00:11:00.000Z',
      indexVersion: 'index-v1',
      indexLifecycleEventSiteKey: 'bilibili',
      indexLifecycleEventTaskType: 'site-specific-api-evidence',
      indexLifecycleEventAdapterVersion: 'bilibili-adapter-fixture-v1',
    });
    const artifacts = createBilibiliSiteSpecificDiscoveryArtifacts({
      apiCatalogRef: 'artifact:api-catalog:bilibili-video-view-api',
    }).artifacts;

    assert.equal(catalogResult.observedCandidate.siteKey, 'bilibili');
    assert.equal(catalogResult.verifiedCandidate.status, 'verified');
    assert.equal(catalogResult.siteAdapterDecision.adapterId, 'bilibili');
    assert.equal(catalogResult.siteAdapterDecision.decision, 'accepted');
    assert.equal(catalogResult.catalogUpgradePolicy.allowCatalogUpgrade, true);
    assert.equal(catalogResult.observedApiAutoPromotionAllowed, false);

    const catalogEntry = JSON.parse(await readFile(paths.catalogPath, 'utf8'));
    assert.equal(catalogEntry.siteKey, 'bilibili');
    assert.equal(catalogEntry.status, 'cataloged');
    assert.equal(catalogEntry.endpoint.url.includes('/x/web-interface/view'), true);

    const nodeEntries = artifacts.objects.NODE_INVENTORY.entries;
    const apiEntries = artifacts.objects.API_INVENTORY.entries;
    const capabilityTarget = artifacts.objects.CAPABILITY_TARGETS.targets
      .find((entry) => entry.targetId === 'navigate-to-content');

    assert.equal(nodeEntries.some((entry) => entry.id.includes('bilibili-video-card')), true);
    assert.equal(nodeEntries.some((entry) => entry.source === 'accessibilityNodes'), true);
    assert.equal(nodeEntries.some((entry) =>
      entry.id.includes('bilibili-up-archive-trigger')
      && entry.discoveryStatus === 'skipped_by_budget'
      && entry.attemptResult?.governedAttempt === true), true);
    assert.equal(apiEntries.some((entry) =>
      entry.siteKey === 'bilibili'
      && entry.id === 'bilibili-video-view-api'
      && entry.discoveryStatus === 'observed_only'
      && entry.verificationState === 'unverified'), true);
    assert.equal(apiEntries.some((entry) => entry.method === 'OPTIONS'), true);
    assert.equal(apiEntries.some((entry) => entry.resourceType === 'websocket'), true);
    assert.equal(capabilityTarget.discoveryState, 'verified');
    assert.equal(capabilityTarget.executableCapabilityAllowed, true);
    assert.equal(capabilityTarget.mappingSummary.executableEvidenceCount, 4);
    assert.equal(capabilityTarget.evidenceMappings.some((mapping) =>
      mapping.evidenceDetail?.descriptorKind === 'verified-api-catalog-capability-evidence'
      && mapping.evidenceDetail.sourceApiId === 'artifact:api-catalog:bilibili-video-view-api'
      && mapping.evidenceDetail.executableEvidence === true), true);
    assert.equal(artifacts.objects.CAPABILITY_GAP_REPORT.gaps
      .some((gap) => gap.targetId === 'navigate-to-content'), false);
    assertNoForbiddenPatterns(catalogResult);
    assertNoForbiddenPatterns(catalogEntry);
    assertNoForbiddenPatterns(artifacts);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('observed producer API needs SiteAdapter policy schema and test gates before catalog promotion', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'api-catalog-promotion-'));
  try {
    const paths = catalogPaths(runDir);
    const result = await writeVerifiedApiCatalogArtifactsFromObservedProducerEvidence({
      observedRequest: observedSearchRequest(),
      siteAdapterDecision: acceptedSearchDecision(),
      catalogUpgradePolicy: {
        adapterId: 'synthetic-adapter',
        allowCatalogUpgrade: true,
        evidence: {
          policy: 'catalog-upgrade-allowed',
        },
      },
      verification: verificationFixtures(),
      decidedAt: '2026-05-10T00:02:00.000Z',
      metadata: {
        version: 'catalog-v1',
        taskType: 'api-catalog-maintenance',
        adapterVersion: 'adapter-v1',
      },
    }, {
      ...paths,
      collectionGeneratedAt: '2026-05-10T00:03:00.000Z',
      collectionCatalogId: 'synthetic-api-catalog',
      collectionCatalogVersion: 'catalog-v1',
      indexGeneratedAt: '2026-05-10T00:04:00.000Z',
      indexVersion: 'index-v1',
      indexLifecycleEventSiteKey: 'synthetic-navigation',
      indexLifecycleEventTaskType: 'api-catalog-maintenance',
      indexLifecycleEventAdapterVersion: 'adapter-v1',
    });

    const collection = JSON.parse(await readFile(paths.collectionPath, 'utf8'));
    const index = JSON.parse(await readFile(paths.indexPath, 'utf8'));
    const entry = JSON.parse(await readFile(paths.catalogPath, 'utf8'));
    const persisted = JSON.stringify({ collection, index, entry });

    assert.equal(result.observedCandidate.status, 'observed');
    assert.equal(result.verifiedCandidate.status, 'verified');
    assert.equal(result.observedApiAutoPromotionAllowed, false);
    assert.equal(result.siteAdapterDecision.decision, 'accepted');
    assert.equal(result.catalogUpgradePolicy.allowCatalogUpgrade, true);
    assert.equal(collection.entries.length, 1);
    assert.equal(collection.entries[0].candidateId, 'observed-search-api');
    assert.equal(index.catalogs[0].entryCount, 1);
    assert.equal(entry.status, 'cataloged');
    assert.equal(persisted.includes('synthetic-promotion-token'), false);
    assertNoForbiddenPatterns(result);
    assertNoForbiddenPatterns(collection);
    assertNoForbiddenPatterns(index);

    const blockedPaths = catalogPaths(runDir, 'blocked');
    await assert.rejects(
      () => writeVerifiedApiCatalogArtifactsFromObservedProducerEvidence({
        observedRequest: observedSearchRequest(),
        siteAdapterDecision: acceptedSearchDecision(),
        catalogUpgradePolicy: {
          adapterId: 'synthetic-adapter',
          allowCatalogUpgrade: false,
          reasonCode: 'api-catalog-entry-blocked',
        },
        verification: verificationFixtures(),
        decidedAt: '2026-05-10T00:05:00.000Z',
      }, {
        ...blockedPaths,
        collectionGeneratedAt: '2026-05-10T00:06:00.000Z',
        collectionCatalogId: 'blocked-api-catalog',
        collectionCatalogVersion: 'catalog-v1',
      }),
      /ApiCatalog upgrade decision does not allow catalog entry/u,
    );
    await assertMissingFiles(blockedPaths);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('executable capability requires exact adapter schema test policy quorum plus verified API catalog evidence', () => {
  const fixture = createExecutableCapabilityEvidenceFixture({
    capability: 'search-content',
    apiCatalogRef: 'artifact:api-catalog:observed-search-api',
    adapterRef: 'adapter:search-content',
    schemaRef: 'schema:search-content',
    testEvidenceRefs: ['test:search-content'],
    policyRef: 'policy:search-content',
  });
  assert.equal(assertExecutableCapabilityEvidenceFixtureCompatible(fixture), true);

  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'synthetic-navigation',
    requestedCapabilities: ['search-content'],
    adapter: adapterFromDecisions({
      capabilityEvidenceFixtures: [fixture],
    }),
  });
  const target = artifacts.objects.CAPABILITY_TARGETS.targets
    .find((entry) => entry.targetId === 'search-content');

  assert.equal(target.discoveryState, 'verified');
  assert.equal(target.executableCapabilityAllowed, true);
  assert.equal(target.mappingSummary.executableEvidenceCount, 4);
  assert.equal(target.evidenceMappings.some((mapping) =>
    mapping.evidenceDetail?.descriptorKind === 'verified-api-catalog-capability-evidence'
    && mapping.evidenceDetail.sourceApiId === 'artifact:api-catalog:observed-search-api'
    && mapping.evidenceDetail.executableEvidence === true), true);
  assert.equal(artifacts.objects.CAPABILITY_GAP_REPORT.gaps
    .some((gap) => gap.targetId === 'search-content'), false);
  assertNoForbiddenPatterns(artifacts);

  assert.throws(
    () => createExecutableCapabilityEvidenceFixture({
      capability: 'search-content',
      evidenceKinds: ['adapter', 'schema', 'test'],
    }),
    (error) => error.code === 'capability.executable_quorum_missing',
  );
});

test('Layer-owned runtime consumer accepts Layer receipt without direct task execution', () => {
  const handoffDescriptor = createLayerExecutionHandoffDescriptor({
    executionId: 'execution:layer-consumer',
    capabilityPlanRef: 'plan:layer-consumer',
    graphVersion: 'graph:v1',
    plannerVersion: 'planner:v1',
    layerCompatibilityVersion: 'layer:v1',
  });
  const policyDecision = createExecutionPolicyDecision({
    handoffDescriptor,
    plannerHandoffRef: 'planner-handoff:layer-consumer',
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
    traceId: 'trace-layer-consumer',
    correlationId: 'correlation-layer-consumer',
    siteKey: 'synthetic-navigation',
    adapterVersion: 'adapter-v1',
  });

  assert.equal(assertLayerOwnedRuntimeConsumerResultCompatible(result), true);
  assert.equal(result.consumerOwner, 'site-capability-layer');
  assert.equal(result.runtimeTaskExecutedByConsumer, false);
  assert.equal(result.directDownloaderInvocationAllowed, false);
  assert.equal(result.directSiteAdapterInvocationAllowed, false);
  assert.equal(result.sessionViewMaterializationAllowed, false);
  assert.equal(result.coverageDelta.coverageAfter, 'complete_within_scope');
  assert.equal(result.coverageDeltaQueueEntry.queueMode, 'redacted_descriptor_queue');
  assert.equal(result.coverageDeltaArtifactWrite.redactionApplied, true);
  assert.equal(result.lifecycleEvent.eventType, 'execution.layer.consumer.receipt');
  assert.equal(result.lifecycleEvent.details.artifactRefCount, 1);
  assertNoForbiddenPatterns(result);

  const blockedDecision = createExecutionPolicyDecision({
    handoffDescriptor,
    plannerHandoffRef: 'planner-handoff:layer-consumer',
    approvalSatisfied: false,
  });
  assert.throws(
    () => createLayerOwnedRuntimeConsumerResult({
      handoffDescriptor,
      policyDecision: blockedDecision,
      layerReceipt: {
        executionStatus: 'accepted',
      },
      traceId: 'trace-layer-consumer-blocked',
      correlationId: 'correlation-layer-consumer-blocked',
      siteKey: 'synthetic-navigation',
      adapterVersion: 'adapter-v1',
    }),
    (error) => error.code === 'execution.approval_required',
  );
  assert.throws(
    () => createLayerOwnedRuntimeConsumerResult({
      handoffDescriptor,
      policyDecision,
      layerReceipt: {
        executionStatus: 'accepted',
        downloaderTask: {
          id: 'blocked-runtime-task',
        },
      },
      traceId: 'trace-layer-consumer-runtime',
      correlationId: 'correlation-layer-consumer-runtime',
      siteKey: 'synthetic-navigation',
      adapterVersion: 'adapter-v1',
    }),
    (error) => error.code === 'execution.raw_sensitive_material_rejected',
  );
});
