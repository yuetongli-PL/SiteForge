import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  API_CANDIDATE_SCHEMA_VERSION,
  API_CATALOG_ENTRY_SCHEMA_VERSION,
  createApiCatalogUpgradeDecision,
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
  writeVerifiedApiCatalogUpgradeFixtureArtifacts,
} from '../../src/sites/capability/api-candidates.mjs';
import {
  assertDisabledGraphPlannerRuntimeConsumerResultCompatibility,
  assertGraphPlannerRiskBlockingRuntimePreflightCompatibility,
  assertPlannerPolicyHandoffWriterCompatibility,
  assertPlannerPolicyRuntimeHandoffCompatibility,
  assertGraphPlannerRuntimeIntegrationDesignCompatibility,
  assertGraphPlannerRouteHandoffLayerEntrypointBoundaryCompatibility,
  assertGraphPlannerRouteHandoffConsumerCompatibility,
  createDisabledGraphPlannerRuntimeConsumerResult,
  assertGraphLayerPolicyPlannerRelationshipEvidenceCompatibility,
  createGraphLayerPolicyPlannerRelationshipEvidence,
  createGraphPlannerRiskBlockingRuntimePreflightContract,
  createGraphPlannerRuntimeIntegrationDesign,
  createGraphPlannerRouteHandoffArtifact,
  createGraphPlannerRouteHandoff,
  createPlannerPolicyHandoff,
  writeCatalogStorePlannerPolicyHandoffArtifact,
  writePlannerPolicyHandoffArtifact,
} from '../../src/sites/capability/planner-policy-handoff.mjs';
import * as plannerPolicyHandoff from '../../src/sites/capability/planner-policy-handoff.mjs';
import {
  createGraphDerivedArtifactPlacement,
  prepareGraphDerivedArtifactWrite,
  writeGraphDerivedArtifactPair,
} from '../../src/sites/capability/site-capability-graph-artifacts.mjs';
import {
  DOWNLOAD_POLICY_SCHEMA_VERSION,
} from '../../src/sites/capability/download-policy.mjs';
import {
  STANDARD_TASK_LIST_SCHEMA_VERSION,
} from '../../src/sites/capability/standard-task-list.mjs';
import { assertGovernedSchemaCompatible } from '../../src/sites/capability/schema-governance.mjs';
import * as siteCapabilityGraph from '../../src/sites/capability/site-capability-graph.mjs';

const MINIMAL_GRAPH_URL = new URL('./fixtures/site-capability-graph/minimal-v1.json', import.meta.url);
const GRAPH_CAPABILITY_ID = 'capability:synthetic.example:open-public-page';
const GRAPH_ROUTE_ID = 'route:synthetic.example:public-page';

async function readMinimalGraphFixture() {
  return JSON.parse(await readFile(MINIMAL_GRAPH_URL, 'utf8'));
}

function loadFutureGraphLayerConsumerPreflightContractApi() {
  const create = siteCapabilityGraph.createFutureGraphLayerConsumerPreflightContract;
  const assertCompatibility = siteCapabilityGraph.assertFutureGraphLayerConsumerPreflightCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'future Layer consumer preflight contract exports are required: '
      + 'createFutureGraphLayerConsumerPreflightContract and '
      + 'assertFutureGraphLayerConsumerPreflightCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function loadGraphPlannerLayerEntrypointHandoffGuardApi() {
  const create = plannerPolicyHandoff.createGraphPlannerLayerEntrypointHandoffGuard;
  const assertCompatibility =
    plannerPolicyHandoff.assertGraphPlannerLayerEntrypointHandoffGuardCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'graph planner Layer entrypoint handoff guard exports are required: '
      + 'createGraphPlannerLayerEntrypointHandoffGuard and '
      + 'assertGraphPlannerLayerEntrypointHandoffGuardCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function loadGraphPlannerLayerEntrypointHandoffSafeSummaryApi() {
  const create = plannerPolicyHandoff.createGraphPlannerLayerEntrypointHandoffSafeSummary;
  const assertCompatibility =
    plannerPolicyHandoff.assertGraphPlannerLayerEntrypointHandoffSafeSummaryCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'graph planner Layer entrypoint handoff safe summary exports are required: '
      + 'createGraphPlannerLayerEntrypointHandoffSafeSummary and '
      + 'assertGraphPlannerLayerEntrypointHandoffSafeSummaryCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function loadGraphPlannerLayerEntrypointLiveExecutionDenialGuardApi() {
  const create = plannerPolicyHandoff.createGraphPlannerLayerEntrypointLiveExecutionDenialGuard;
  const assertCompatibility =
    plannerPolicyHandoff.assertGraphPlannerLayerEntrypointLiveExecutionDenialGuardCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'graph planner Layer entrypoint live execution denial guard exports are required: '
      + 'createGraphPlannerLayerEntrypointLiveExecutionDenialGuard and '
      + 'assertGraphPlannerLayerEntrypointLiveExecutionDenialGuardCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function captureThrownMessage(fn) {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected function to throw');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function findPreflightEvidence(value) {
  const candidates = [
    value?.preflightContractEvidence,
    value?.preflightContract,
    value?.requiredPreflight,
    value?.sourcePreflight,
    value?.preflight,
    value?.items?.[0]?.preflightContractEvidence,
    value?.items?.[0]?.preflightContract,
    value?.items?.[0]?.requiredPreflight,
    value?.items?.[0]?.sourcePreflight,
    value?.items?.[0]?.preflight,
  ];
  return candidates.find((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate));
}

function assertPreflightEvidence(value, label) {
  const evidence = findPreflightEvidence(value);
  assert.ok(evidence, `${label} must record required/source preflight contract evidence`);
  const evidenceJson = JSON.stringify(evidence);
  assert.match(evidenceJson, /createFutureGraphLayerConsumerPreflightContract/u);
  assert.match(evidenceJson, /site-capability-graph-future-layer-consumer-preflight-contract/u);
  assert.match(evidenceJson, /descriptor-only-preflight|preflight/u);
  assert.match(evidenceJson, /assertFutureGraphLayerConsumerPreflightCompatibility|contract|sourceArtifact/u);
  assert.doesNotMatch(evidenceJson, /synthetic-secret-value|synthetic-profile-path|synthetic-bypass-token/u);
  return evidence;
}

function assertNoPlannerRuntimeProducts(value, label) {
  const forbiddenKeys = new Set([
    'downloadPolicy',
    'downloader',
    'sessionView',
    'siteAdapter',
    'taskList',
  ]);
  const pending = [{ value, path: label }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current.value)) {
      current.value.forEach((item, index) => pending.push({ value: item, path: `${current.path}.${index}` }));
      continue;
    }
    if (!current.value || typeof current.value !== 'object') {
      continue;
    }
    for (const [key, child] of Object.entries(current.value)) {
      assert.equal(forbiddenKeys.has(key), false, `${current.path}.${key} must not expose runtime products`);
      pending.push({ value: child, path: `${current.path}.${key}` });
    }
  }
}

function createCatalogEntry(overrides = {}) {
  return {
    schemaVersion: API_CATALOG_ENTRY_SCHEMA_VERSION,
    candidateId: 'candidate-synthetic-planner-list',
    siteKey: 'example',
    endpoint: {
      method: 'GET',
      url: 'https://example.test/api/items?access_token=synthetic-planner-token&cursor=1',
    },
    version: 'api-v1',
    auth: {
      required: true,
      scheme: 'session-view',
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
    verifiedAt: '2026-05-02T00:00:00.000Z',
    lastValidatedAt: '2026-05-02T00:01:00.000Z',
    status: 'cataloged',
    invalidationStatus: 'active',
    ...overrides,
  };
}

function assignGraphRouteRiskPolicy(graph, routeId, riskPolicyId, state) {
  const route = graph.nodes.find((node) => node.id === routeId);
  route.riskPolicyRef = riskPolicyId;
  graph.nodes.push({
    schemaVersion: 1,
    id: riskPolicyId,
    type: 'RiskPolicyNode',
    state,
    allowedActions: ['read'],
    blockedActions: ['write'],
    requiresApproval: false,
    cooldownRequired: true,
    isolationRequired: false,
    manualRecoveryRequired: false,
    degradable: true,
    artifactWriteAllowed: false,
    sourceRefs: ['config/site-capabilities.json'],
    reasonCodeRefs: ['graph-route-forbidden-by-risk'],
  });
}

function createCandidateFromCatalogEntry(catalogEntry = createCatalogEntry(), overrides = {}) {
  return {
    schemaVersion: API_CANDIDATE_SCHEMA_VERSION,
    id: catalogEntry.candidateId,
    siteKey: catalogEntry.siteKey,
    status: 'verified',
    endpoint: {
      method: catalogEntry.endpoint?.method ?? 'GET',
      url: catalogEntry.endpoint?.url ?? 'https://example.test/api/items?access_token=synthetic-planner-token&cursor=1',
    },
    auth: catalogEntry.auth,
    pagination: catalogEntry.pagination,
    fieldMapping: catalogEntry.fieldMapping,
    risk: catalogEntry.risk,
    ...overrides,
  };
}

function createAllowedCatalogUpgradeDecision(catalogEntry = createCatalogEntry()) {
  const candidate = createCandidateFromCatalogEntry(catalogEntry);
  const siteAdapterDecision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'synthetic-planner-adapter',
    decision: 'accepted',
  }, { candidate });
  const policy = normalizeSiteAdapterCatalogUpgradePolicy({
    adapterId: 'synthetic-planner-adapter',
    allowCatalogUpgrade: true,
  }, { candidate, siteAdapterDecision });
  return createApiCatalogUpgradeDecision({
    candidate,
    siteAdapterDecision,
    policy,
    decidedAt: '2026-05-02T00:02:00.000Z',
  });
}

function createBlockedCatalogUpgradeDecision(catalogEntry = createCatalogEntry(), status) {
  const candidate = createCandidateFromCatalogEntry(catalogEntry, { status });
  const siteAdapterDecision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'synthetic-planner-adapter',
    decision: 'accepted',
  }, { candidate });
  const policy = normalizeSiteAdapterCatalogUpgradePolicy({
    adapterId: 'synthetic-planner-adapter',
    allowCatalogUpgrade: true,
  }, { candidate, siteAdapterDecision });
  return createApiCatalogUpgradeDecision({
    candidate,
    siteAdapterDecision,
    policy,
    decidedAt: '2026-05-02T00:03:00.000Z',
  });
}

test('planner policy handoff converts an active catalog entry into low-permission products', () => {
  const catalogEntry = createCatalogEntry();
  const handoff = createPlannerPolicyHandoff({
    catalogEntry,
    catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(catalogEntry),
    taskIntent: {
      siteKey: 'example',
      taskType: 'archive-items',
      id: 'task-item-1',
      kind: 'request',
      cacheKey: 'example:items',
      dedupKey: 'example:items',
    },
    policy: {
      retries: 2,
      retryBackoffMs: 500,
      cache: true,
      dedup: true,
    },
  });

  assert.equal(handoff.siteKey, 'example');
  assert.equal(handoff.taskType, 'archive-items');
  assert.deepEqual(handoff.catalogGate.requirements, {
    candidateStatus: 'verified',
    candidateVerified: true,
    siteAdapterDecision: 'accepted',
    siteAdapterAccepted: true,
    policyAllowsCatalogUpgrade: true,
  });
  assert.equal(handoff.catalogGate.decision, 'allowed');
  assert.equal(handoff.downloadPolicy.schemaVersion, DOWNLOAD_POLICY_SCHEMA_VERSION);
  assert.equal(assertGovernedSchemaCompatible('DownloadPolicy', handoff.downloadPolicy), true);
  assert.equal(handoff.downloadPolicy.sessionRequirement, 'required');
  assert.equal(handoff.downloadPolicy.dryRun, true);
  assert.equal(handoff.downloadPolicy.allowNetworkResolve, false);
  assert.equal(handoff.downloadPolicy.retries, 2);
  assert.equal(handoff.taskList.schemaVersion, STANDARD_TASK_LIST_SCHEMA_VERSION);
  assert.equal(assertGovernedSchemaCompatible('StandardTaskList', handoff.taskList), true);
  assert.equal(handoff.taskList.policyRef, 'download-policy:example:archive-items');
  assert.equal(handoff.taskList.items[0].id, 'task-item-1');
  assert.equal(handoff.taskList.items[0].method, 'GET');
  assert.equal(handoff.taskList.items[0].capability, 'archive-items');
  assert.equal(handoff.taskList.items[0].mode, 'read');
  assert.equal(handoff.taskList.items[0].endpoint.includes('synthetic-planner-token'), false);
  assert.equal(handoff.taskList.items[0].endpoint.includes('access_token='), true);
  assert.deepEqual(handoff.taskList.items[0].pagination, {
    type: 'cursor',
    cursorField: 'nextCursor',
    pageSize: 20,
  });
  assert.deepEqual(handoff.taskList.items[0].retry, {
    retries: 2,
    retryBackoffMs: 500,
  });
  assert.doesNotMatch(JSON.stringify(handoff), /synthetic-planner-token|authorization|cookie|csrf|sessionId/iu);
  assert.equal(Object.hasOwn(handoff, 'graphPlan'), false);
});

test('planner policy handoff exposes optional descriptor-only graph route plans', async () => {
  const graph = await readMinimalGraphFixture();

  const handoff = createGraphPlannerRouteHandoff({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
  });

  assert.equal(handoff.schemaVersion, 1);
  assert.equal(handoff.handoffKind, 'site-capability-graph-route-plan');
  assert.equal(handoff.graphVersion, 'synthetic-graph-v1');
  assert.deepEqual(handoff.compatibility, {
    graphSchemaVersion: 1,
    graphDataVersion: 'synthetic-graph-v1',
    supportedGraphDataVersions: [
      'synthetic-graph-v1',
      'synthetic-generated-from-layer-v1',
    ],
  });
  assert.equal(handoff.result, 'planned');
  assert.equal(handoff.reasonCode, null);
  assert.equal(handoff.reason, null);
  assert.equal(handoff.executionAllowed, false);
  assert.equal(handoff.route.id, GRAPH_ROUTE_ID);
  assert.equal(assertGraphPlannerRouteHandoffConsumerCompatibility(handoff), true);
  assert.doesNotMatch(JSON.stringify(handoff), /authorization|cookie|csrf|sessionId|browserProfile/iu);
});

test('graph planner route handoff consumer contract stays descriptor-only', async () => {
  const graph = await readMinimalGraphFixture();
  const handoff = createGraphPlannerRouteHandoff({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
  });

  assert.equal(assertGraphPlannerRouteHandoffConsumerCompatibility(handoff), true);
  assert.equal(Object.hasOwn(handoff, 'taskList'), false);
  assert.equal(Object.hasOwn(handoff, 'downloadPolicy'), false);
  assert.equal(Object.hasOwn(handoff, 'sessionView'), false);
  assert.equal(Object.hasOwn(handoff, 'artifactPath'), false);
  assert.equal(handoff.executionAllowed, false);
  assert.throws(
    () => assertGraphPlannerRouteHandoffConsumerCompatibility({
      ...handoff,
      executionAllowed: true,
    }),
    /executionAllowed must be false/u,
  );
  assert.throws(
    () => assertGraphPlannerRouteHandoffConsumerCompatibility({
      ...handoff,
      taskList: {
        schemaVersion: STANDARD_TASK_LIST_SCHEMA_VERSION,
        siteKey: 'synthetic.example',
        items: [],
      },
    }),
    /descriptor-only.*taskList/u,
  );
  assert.throws(
    () => assertGraphPlannerRouteHandoffConsumerCompatibility({
      ...handoff,
      sessionRef: 'session-ref:synthetic-ref',
    }),
    /must not expose raw sessionRef/u,
  );
});

test('graph planner route handoff rejects Layer runtime products before execution', async () => {
  const graph = await readMinimalGraphFixture();
  const handoff = createGraphPlannerRouteHandoff({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
  });

  assert.equal(assertGraphPlannerRouteHandoffLayerEntrypointBoundaryCompatibility(handoff), true);
  assert.equal(handoff.executionAllowed, false);
  assert.equal(Object.hasOwn(handoff, 'downloadPolicy'), false);
  assert.equal(Object.hasOwn(handoff, 'siteAdapter'), false);
  assert.equal(Object.hasOwn(handoff, 'downloader'), false);
  assert.equal(Object.hasOwn(handoff, 'sessionView'), false);

  const runtimeProductMutations = [
    ['downloadPolicy', { dryRun: true }],
    ['siteAdapter', { adapterId: 'synthetic-adapter' }],
    ['downloader', { mode: 'synthetic-downloader' }],
    ['sessionView', { state: 'synthetic-session' }],
    ['taskList', { items: [] }],
    ['runtimeArtifactWriteEnabled', true],
  ];

  for (const [fieldName, fieldValue] of runtimeProductMutations) {
    assert.throws(
      () => assertGraphPlannerRouteHandoffLayerEntrypointBoundaryCompatibility({
        ...handoff,
        [fieldName]: fieldValue,
      }),
      /descriptor-only/u,
      `${fieldName} must be rejected before Layer runtime execution`,
    );
  }

  assert.throws(
    () => assertGraphPlannerRouteHandoffLayerEntrypointBoundaryCompatibility({
      ...handoff,
      diagnostic: 'Authorization: Bearer synthetic-secret-value',
    }),
    (error) => {
      assert.match(error.message, /Forbidden sensitive pattern|raw sensitive material/u);
      assert.doesNotMatch(error.message, /synthetic-secret-value/u);
      return true;
    },
  );
});

test('graph planner runtime integration design stays descriptor-only without live route execution', async (t) => {
  const graph = await readMinimalGraphFixture();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'graph-planner-runtime-design-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const design = createGraphPlannerRuntimeIntegrationDesign({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
  });

  assert.equal(assertGraphPlannerRuntimeIntegrationDesignCompatibility(design), true);
  assert.equal(design.queryName, 'createGraphPlannerRuntimeIntegrationDesign');
  assert.equal(design.artifactFamily, 'site-capability-graph-planner-runtime-integration-design');
  assert.equal(design.redactionRequired, true);
  assert.equal(design.items[0].integrationMode, 'design-only');
  assert.equal(design.items[0].executionAllowed, false);
  assert.equal(design.items[0].liveRouteExecutionEnabled, false);
  assert.equal(design.items[0].siteAdapterInvocationEnabled, false);
  assert.equal(design.items[0].downloaderInvocationEnabled, false);
  assert.equal(design.items[0].sessionMaterializationEnabled, false);
  assert.equal(design.items[0].runtimeArtifactWriteEnabled, false);
  assert.equal(design.items[0].externalDispatchEnabled, false);
  assert.equal(design.items[0].handoff.result, 'planned');
  assert.equal(design.items[0].handoff.route.id, GRAPH_ROUTE_ID);
  assert.equal(Object.hasOwn(design.items[0], 'taskList'), false);
  assert.equal(Object.hasOwn(design.items[0], 'downloadPolicy'), false);
  assert.equal(Object.hasOwn(design.items[0], 'sessionView'), false);

  const placement = createGraphDerivedArtifactPlacement({
    outputDir: tempDir,
    runId: 'synthetic-run-graph-planner-runtime-design',
    artifactFamily: 'site-capability-graph-planner-runtime-integration-design',
    artifactName: 'runtime-design',
  });
  const result = await writeGraphDerivedArtifactPair(design, placement);
  const artifactJson = await readFile(result.artifactPath, 'utf8');
  const auditJson = await readFile(result.auditPath, 'utf8');
  assert.doesNotMatch(artifactJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
  assert.doesNotMatch(auditJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
});

test('graph planner runtime integration design carries blocked route reasons without execution', async () => {
  const graph = await readMinimalGraphFixture();
  const design = createGraphPlannerRuntimeIntegrationDesign({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
    context: {
      availableRouteIds: ['route:synthetic.example:missing'],
    },
  });

  assert.equal(assertGraphPlannerRuntimeIntegrationDesignCompatibility(design), true);
  assert.equal(design.items[0].handoff.result, 'blocked');
  assert.equal(design.items[0].handoff.reasonCode, 'graph-planner-context-unsatisfied');
  assert.equal(design.items[0].handoff.route, null);
  assert.equal(design.items[0].executionAllowed, false);
  assert.equal(design.items[0].liveRouteExecutionEnabled, false);
});

test('graph planner runtime integration design rejects execution and runtime products', async () => {
  const graph = await readMinimalGraphFixture();

  assert.throws(
    () => createGraphPlannerRuntimeIntegrationDesign({
      graph,
      capabilityId: GRAPH_CAPABILITY_ID,
      liveRouteExecutionEnabled: true,
    }),
    /liveRouteExecutionEnabled must remain false/u,
  );
  assert.throws(
    () => createGraphPlannerRuntimeIntegrationDesign({
      graph,
      capabilityId: GRAPH_CAPABILITY_ID,
      siteAdapterInvocationEnabled: true,
    }),
    /siteAdapterInvocationEnabled must remain false/u,
  );
  assert.throws(
    () => createGraphPlannerRuntimeIntegrationDesign({
      graph,
      capabilityId: GRAPH_CAPABILITY_ID,
      taskList: [],
    }),
    /descriptor-only.*taskList/u,
  );
  assert.throws(
    () => createGraphPlannerRuntimeIntegrationDesign({
      graph,
      capabilityId: GRAPH_CAPABILITY_ID,
      sessionRef: 'session-ref:synthetic-ref',
    }),
    /must not expose raw sessionRef/u,
  );

  const fieldMessage = (() => {
    try {
      createGraphPlannerRuntimeIntegrationDesign({
        graph,
        capabilityId: GRAPH_CAPABILITY_ID,
        accessToken: 'synthetic-secret-value',
      });
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error('Expected function to throw');
  })();
  assert.match(fieldMessage, /must not expose raw accessToken/u);
  assert.doesNotMatch(fieldMessage, /synthetic-secret-value/u);

  const design = createGraphPlannerRuntimeIntegrationDesign({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
  });
  design.items[0].downloaderInvocationEnabled = true;
  assert.throws(
    () => assertGraphPlannerRuntimeIntegrationDesignCompatibility(design),
    /downloaderInvocationEnabled must be false/u,
  );

  const unsafeDesign = createGraphPlannerRuntimeIntegrationDesign({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
  });
  unsafeDesign.items[0].handoff.taskList = [];
  assert.throws(
    () => assertGraphPlannerRuntimeIntegrationDesignCompatibility(unsafeDesign),
    /descriptor-only.*taskList/u,
  );
});

test('disabled graph planner runtime consumer returns blocked descriptor without execution', async (t) => {
  const graph = await readMinimalGraphFixture();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'graph-planner-disabled-consumer-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const design = createGraphPlannerRuntimeIntegrationDesign({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
  });
  const result = createDisabledGraphPlannerRuntimeConsumerResult(design);

  assert.equal(assertDisabledGraphPlannerRuntimeConsumerResultCompatibility(result), true);
  assert.equal(result.queryName, 'createDisabledGraphPlannerRuntimeConsumerResult');
  assert.equal(result.artifactFamily, 'site-capability-graph-planner-runtime-consumer-result');
  assert.equal(result.redactionRequired, true);
  assert.equal(result.items[0].consumerMode, 'disabled-feature-flag');
  assert.equal(result.items[0].featureEnabled, false);
  assert.equal(result.items[0].result, 'blocked');
  assert.equal(result.items[0].reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(result.items[0].sourceHandoffReasonCode, 'graph-planner-context-unsatisfied');
  assert.equal(result.items[0].executionAllowed, false);
  assert.equal(result.items[0].liveRouteExecutionEnabled, false);
  assert.equal(result.items[0].siteAdapterInvocationEnabled, false);
  assert.equal(result.items[0].downloaderInvocationEnabled, false);
  assert.equal(result.items[0].sessionMaterializationEnabled, false);
  assert.equal(result.items[0].runtimeArtifactWriteEnabled, false);
  assert.equal(result.items[0].externalDispatchEnabled, false);
  assert.equal(result.items[0].handoff.result, 'planned');
  assert.equal(result.items[0].handoff.routeId, GRAPH_ROUTE_ID);
  assert.equal(Object.hasOwn(result.items[0], 'taskList'), false);
  assert.equal(Object.hasOwn(result.items[0], 'downloadPolicy'), false);
  assert.equal(Object.hasOwn(result.items[0], 'sessionView'), false);

  const placement = createGraphDerivedArtifactPlacement({
    outputDir: tempDir,
    runId: 'synthetic-run-graph-planner-disabled-consumer',
    artifactFamily: 'site-capability-graph-planner-runtime-consumer-result',
    artifactName: 'disabled-consumer',
  });
  const writeResult = await writeGraphDerivedArtifactPair(result, placement);
  const artifactJson = await readFile(writeResult.artifactPath, 'utf8');
  const auditJson = await readFile(writeResult.auditPath, 'utf8');
  assert.doesNotMatch(artifactJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
  assert.doesNotMatch(auditJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
});

test('disabled graph planner runtime consumer preserves blocked handoff reason', async () => {
  const graph = await readMinimalGraphFixture();
  const design = createGraphPlannerRuntimeIntegrationDesign({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
    context: {
      availableRouteIds: ['route:synthetic.example:missing'],
    },
  });
  const result = createDisabledGraphPlannerRuntimeConsumerResult(design);

  assert.equal(assertDisabledGraphPlannerRuntimeConsumerResultCompatibility(result), true);
  assert.equal(result.items[0].handoff.result, 'blocked');
  assert.equal(result.items[0].handoff.routeId, null);
  assert.equal(result.items[0].reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(result.items[0].sourceHandoffReasonCode, 'graph-planner-context-unsatisfied');
  assert.equal(result.items[0].handoff.reasonCode, 'graph-planner-context-unsatisfied');
  assert.equal(result.items[0].executionAllowed, false);
});

test('disabled graph planner runtime consumer preserves Layer-source RiskPolicyNode risk block without runtime execution', async () => {
  const riskGraph = await readMinimalGraphFixture();
  assignGraphRouteRiskPolicy(
    riskGraph,
    GRAPH_ROUTE_ID,
    'risk-policy:synthetic.example:route-suspicious-readonly',
    'suspicious',
  );
  const riskPolicy = riskGraph.nodes.find(
    (node) => node.id === 'risk-policy:synthetic.example:route-suspicious-readonly',
  );
  assert.deepEqual(riskPolicy.sourceRefs, ['config/site-capabilities.json']);

  const design = createGraphPlannerRuntimeIntegrationDesign({
    graph: riskGraph,
    capabilityId: GRAPH_CAPABILITY_ID,
    context: {
      blockedRiskStates: ['suspicious'],
    },
  });
  const result = createDisabledGraphPlannerRuntimeConsumerResult(design);

  assert.equal(assertGraphPlannerRuntimeIntegrationDesignCompatibility(design), true);
  assert.equal(assertDisabledGraphPlannerRuntimeConsumerResultCompatibility(result), true);
  assert.equal(design.items[0].integrationMode, 'design-only');
  assert.equal(design.items[0].handoff.result, 'blocked');
  assert.equal(design.items[0].handoff.reasonCode, 'graph-route-forbidden-by-risk');
  assert.equal(design.items[0].handoff.riskState, 'suspicious');
  assert.equal(design.items[0].executionAllowed, false);
  assert.equal(design.items[0].liveRouteExecutionEnabled, false);
  assert.equal(design.items[0].siteAdapterInvocationEnabled, false);
  assert.equal(design.items[0].downloaderInvocationEnabled, false);
  assert.equal(design.items[0].sessionMaterializationEnabled, false);
  assert.equal(design.items[0].runtimeArtifactWriteEnabled, false);
  assert.equal(design.items[0].externalDispatchEnabled, false);
  assert.equal(Object.hasOwn(design.items[0], 'taskList'), false);
  assert.equal(Object.hasOwn(design.items[0], 'downloadPolicy'), false);
  assert.equal(Object.hasOwn(design.items[0], 'sessionView'), false);

  assert.equal(result.items[0].consumerMode, 'disabled-feature-flag');
  assert.equal(result.items[0].featureEnabled, false);
  assert.equal(result.items[0].result, 'blocked');
  assert.equal(result.items[0].reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(result.items[0].sourceHandoffReasonCode, 'graph-route-forbidden-by-risk');
  assert.equal(result.items[0].handoff.result, 'blocked');
  assert.equal(result.items[0].handoff.reasonCode, 'graph-route-forbidden-by-risk');
  assert.equal(result.items[0].handoff.riskState, 'suspicious');
  assert.equal(result.items[0].executionAllowed, false);
  assert.equal(result.items[0].liveRouteExecutionEnabled, false);
  assert.equal(result.items[0].siteAdapterInvocationEnabled, false);
  assert.equal(result.items[0].downloaderInvocationEnabled, false);
  assert.equal(result.items[0].sessionMaterializationEnabled, false);
  assert.equal(result.items[0].runtimeArtifactWriteEnabled, false);
  assert.equal(result.items[0].externalDispatchEnabled, false);
  assert.equal(Object.hasOwn(result.items[0], 'taskList'), false);
  assert.equal(Object.hasOwn(result.items[0], 'downloadPolicy'), false);
  assert.equal(Object.hasOwn(result.items[0], 'sessionView'), false);

  const designJson = JSON.stringify(design);
  const resultJson = JSON.stringify(result);
  const runtimeEvidenceJson = JSON.stringify({
    designHandoff: design.items[0].handoff,
    result,
  });
  assert.doesNotMatch(designJson, /RiskStateMachine|runtime risk transition|SiteAdapter invoked|downloader invoked|cookie|Authorization|sessionId|browserProfile/iu);
  assert.doesNotMatch(resultJson, /RiskStateMachine|runtime risk transition|SiteAdapter invoked|downloader invoked|cookie|Authorization|sessionId|browserProfile/iu);
  assert.doesNotMatch(runtimeEvidenceJson, /RiskStateMachine|runtime risk transition|SiteAdapter invoked|downloader invoked|SessionView|cookie|Authorization|sessionId|browserProfile/iu);
});

test('graph planner risk-blocking runtime preflight contract stays disabled before runtime registration', async () => {
  const riskGraph = await readMinimalGraphFixture();
  assignGraphRouteRiskPolicy(
    riskGraph,
    GRAPH_ROUTE_ID,
    'risk-policy:synthetic.example:route-suspicious-readonly',
    'suspicious',
  );
  const design = createGraphPlannerRuntimeIntegrationDesign({
    graph: riskGraph,
    capabilityId: GRAPH_CAPABILITY_ID,
    context: {
      blockedRiskStates: ['suspicious'],
    },
  });

  const preflight = createGraphPlannerRiskBlockingRuntimePreflightContract(design);

  assert.equal(assertGraphPlannerRiskBlockingRuntimePreflightCompatibility(preflight), true);
  assert.equal(preflight.queryName, 'createGraphPlannerRiskBlockingRuntimePreflightContract');
  assert.equal(preflight.artifactFamily, 'site-capability-graph-planner-risk-blocking-runtime-preflight-contract');
  assert.equal(preflight.redactionRequired, true);
  assert.equal(preflight.items[0].contractMode, 'contract-only');
  assert.equal(preflight.items[0].featureEnabled, false);
  assert.equal(preflight.items[0].result, 'blocked');
  assert.equal(preflight.items[0].registrationStatus, 'not-registered');
  assert.equal(preflight.items[0].sourceDesign.queryName, 'createGraphPlannerRuntimeIntegrationDesign');
  assert.equal(preflight.items[0].sourceDesign.artifactFamily, 'site-capability-graph-planner-runtime-integration-design');
  assert.equal(preflight.items[0].sourceHandoffReasonCode, 'graph-route-forbidden-by-risk');
  assert.equal(preflight.items[0].handoff.reasonCode, 'graph-route-forbidden-by-risk');
  assert.equal(preflight.items[0].handoff.riskState, 'suspicious');

  const gates = preflight.items[0].gates;
  assert.deepEqual(gates.plannerRuntimeConsumer, {
    enabled: false,
    status: 'disabled',
    result: 'blocked',
  });
  assert.deepEqual(gates.riskTransition, {
    enabled: false,
    status: 'disabled',
    result: 'blocked',
  });
  assert.deepEqual(gates.routeExecution, {
    enabled: false,
    status: 'disabled',
    result: 'blocked',
  });
  assert.deepEqual(gates.externalDispatch, {
    enabled: false,
    status: 'disabled',
    result: 'blocked',
  });
  assert.deepEqual(gates.siteAdapter, {
    enabled: false,
    registered: false,
    status: 'not-registered',
    result: 'blocked',
  });
  assert.deepEqual(gates.downloader, {
    enabled: false,
    registered: false,
    status: 'not-registered',
    result: 'blocked',
  });
  assert.deepEqual(gates.sessionView, {
    enabled: false,
    materialized: false,
    status: 'disabled',
    result: 'blocked',
  });
  assert.deepEqual(gates.artifactWrites, {
    enabled: false,
    allowed: false,
    status: 'disabled',
    result: 'blocked',
  });
  assert.deepEqual(gates.repoWrites, {
    enabled: false,
    allowed: false,
    status: 'disabled',
    result: 'blocked',
  });
  assert.deepEqual(gates.runtimeWrites, {
    enabled: false,
    allowed: false,
    status: 'disabled',
    result: 'blocked',
  });

  const preflightJson = JSON.stringify(preflight);
  assert.match(preflightJson, /contract-only/u);
  assert.match(preflightJson, /disabled/u);
  assert.match(preflightJson, /blocked/u);
  assert.match(preflightJson, /not-registered/u);
  assert.doesNotMatch(preflightJson, /RiskStateMachine|runtimeRiskTransition|executeRoute|downloader invoked|cookie|Authorization|sessionId|browserProfile|synthetic-secret-value/iu);
});

test('graph planner risk-blocking runtime preflight contract rejects runtime hooks and secrets fail-closed', async () => {
  const riskGraph = await readMinimalGraphFixture();
  assignGraphRouteRiskPolicy(
    riskGraph,
    GRAPH_ROUTE_ID,
    'risk-policy:synthetic.example:route-suspicious-readonly',
    'suspicious',
  );
  const design = createGraphPlannerRuntimeIntegrationDesign({
    graph: riskGraph,
    capabilityId: GRAPH_CAPABILITY_ID,
    context: {
      blockedRiskStates: ['suspicious'],
    },
  });

  for (const [fieldName, fieldValue] of Object.entries({
    featureEnabled: true,
    executionAllowed: true,
    liveRouteExecutionEnabled: true,
    routeHandoffEnabled: true,
    riskTransitionEnabled: true,
    siteAdapterInvocationEnabled: true,
    downloaderInvocationEnabled: true,
    sessionMaterializationEnabled: true,
    artifactWriteEnabled: true,
    repoWriteEnabled: true,
    runtimeWriteEnabled: true,
    externalDispatchEnabled: true,
    RiskStateMachine: { transition: 'runtime' },
    runtimeRiskTransition: { from: 'suspicious', to: 'trusted' },
    executeRoute: () => ({ result: 'executed' }),
    siteAdapter: { invoke: true },
    downloader: { invoke: true },
    sessionView: { id: 'synthetic-session-view' },
    standardTaskList: { items: [] },
    downloadPolicy: { dryRun: false },
    artifactPayload: { unsafe: true },
    cookie: 'synthetic-secret-value',
    Authorization: 'Bearer synthetic-secret-value',
    sessionId: 'synthetic-secret-value',
    browserProfile: 'synthetic-secret-value',
    payload: { token: 'synthetic-secret-value' },
  })) {
    const message = (() => {
      try {
        createGraphPlannerRiskBlockingRuntimePreflightContract(design, {
          [fieldName]: fieldValue,
        });
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      throw new Error(`Expected ${fieldName} to fail closed`);
    })();
    assert.match(message, new RegExp(`preflight|descriptor-only|runtime|forbidden|${fieldName}`, 'iu'));
    assert.doesNotMatch(message, /synthetic-secret-value/u);
  }

  const unsafePreflight = createGraphPlannerRiskBlockingRuntimePreflightContract(design);
  unsafePreflight.items[0].gates.routeExecution.enabled = true;
  assert.throws(
    () => assertGraphPlannerRiskBlockingRuntimePreflightCompatibility(unsafePreflight),
    /routeExecution|enabled|false|disabled|blocked/iu,
  );

  const unsafeSecretPreflight = createGraphPlannerRiskBlockingRuntimePreflightContract(design);
  unsafeSecretPreflight.items[0].payload = {
    Authorization: 'Bearer synthetic-secret-value',
  };
  const unsafeMessage = (() => {
    try {
      assertGraphPlannerRiskBlockingRuntimePreflightCompatibility(unsafeSecretPreflight);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error('Expected unsafe preflight to fail closed');
  })();
  assert.match(unsafeMessage, /payload|Authorization|raw sensitive material|forbidden/iu);
  assert.doesNotMatch(unsafeMessage, /synthetic-secret-value/u);
});

test('disabled graph planner runtime consumer rejects enabled flags and runtime payloads', async () => {
  const graph = await readMinimalGraphFixture();
  const design = createGraphPlannerRuntimeIntegrationDesign({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
  });

  assert.throws(
    () => createDisabledGraphPlannerRuntimeConsumerResult(design, { featureEnabled: true }),
    /featureEnabled must remain false/u,
  );
  for (const fieldName of [
    'liveRouteExecutionEnabled',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'sessionMaterializationEnabled',
    'runtimeArtifactWriteEnabled',
    'externalDispatchEnabled',
  ]) {
    assert.throws(
      () => createDisabledGraphPlannerRuntimeConsumerResult(design, { [fieldName]: true }),
      new RegExp(`${fieldName} must remain false`, 'u'),
    );
  }
  assert.throws(
    () => createDisabledGraphPlannerRuntimeConsumerResult(design, { taskList: [] }),
    /descriptor-only.*taskList/u,
  );
  assert.throws(
    () => createDisabledGraphPlannerRuntimeConsumerResult(design, { downloadPolicy: {} }),
    /descriptor-only.*downloadPolicy/u,
  );
  assert.throws(
    () => createDisabledGraphPlannerRuntimeConsumerResult(design, { sessionView: {} }),
    /descriptor-only.*sessionView/u,
  );
  assert.throws(
    () => createDisabledGraphPlannerRuntimeConsumerResult(design, { routeExecutor: {} }),
    /descriptor-only.*routeExecutor/u,
  );
  assert.throws(
    () => createDisabledGraphPlannerRuntimeConsumerResult(design, { outputPath: 'artifacts/graph-plan.json' }),
    /descriptor-only.*outputPath/u,
  );

  const unsafeResult = createDisabledGraphPlannerRuntimeConsumerResult(design);
  unsafeResult.items[0].executionAllowed = true;
  assert.throws(
    () => assertDisabledGraphPlannerRuntimeConsumerResultCompatibility(unsafeResult),
    /executionAllowed must be false/u,
  );

  const runtimePayloadResult = createDisabledGraphPlannerRuntimeConsumerResult(design);
  runtimePayloadResult.items[0].taskList = [];
  assert.throws(
    () => assertDisabledGraphPlannerRuntimeConsumerResultCompatibility(runtimePayloadResult),
    /descriptor-only.*taskList/u,
  );
});

test('disabled graph planner runtime consumer requires future Layer preflight contract before runtime wiring', async () => {
  const { create, assertCompatibility } = loadFutureGraphLayerConsumerPreflightContractApi();
  const graph = await readMinimalGraphFixture();
  const preflightContract = create({
    graphVersion: 'synthetic-graph-v1',
    consumerName: 'synthetic-section3-disabled-runtime-preflight',
  });
  assert.equal(assertCompatibility(preflightContract), true);

  const design = createGraphPlannerRuntimeIntegrationDesign({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
    preflightContract,
  });
  assert.equal(assertGraphPlannerRuntimeIntegrationDesignCompatibility(design), true);
  assertPreflightEvidence(design, 'GraphPlannerRuntimeIntegrationDesign');
  assert.equal(design.items[0].executionAllowed, false);
  assert.equal(design.items[0].liveRouteExecutionEnabled, false);
  assert.equal(design.items[0].siteAdapterInvocationEnabled, false);
  assert.equal(design.items[0].downloaderInvocationEnabled, false);
  assert.equal(design.items[0].sessionMaterializationEnabled, false);
  assert.equal(design.items[0].runtimeArtifactWriteEnabled, false);
  assert.equal(design.items[0].externalDispatchEnabled, false);
  assertNoPlannerRuntimeProducts(design, 'GraphPlannerRuntimeIntegrationDesign');

  const result = createDisabledGraphPlannerRuntimeConsumerResult(design, {
    preflightContract,
  });
  assert.equal(assertDisabledGraphPlannerRuntimeConsumerResultCompatibility(result), true);
  assertPreflightEvidence(result, 'DisabledGraphPlannerRuntimeConsumerResult');
  assert.equal(result.items[0].featureEnabled, false);
  assert.equal(result.items[0].executionAllowed, false);
  assert.equal(result.items[0].liveRouteExecutionEnabled, false);
  assert.equal(result.items[0].siteAdapterInvocationEnabled, false);
  assert.equal(result.items[0].downloaderInvocationEnabled, false);
  assert.equal(result.items[0].sessionMaterializationEnabled, false);
  assert.equal(result.items[0].runtimeArtifactWriteEnabled, false);
  assert.equal(result.items[0].externalDispatchEnabled, false);
  assertNoPlannerRuntimeProducts(result, 'DisabledGraphPlannerRuntimeConsumerResult');

  const defaultPreflightDesign = createGraphPlannerRuntimeIntegrationDesign({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
  });
  assert.equal(assertGraphPlannerRuntimeIntegrationDesignCompatibility(defaultPreflightDesign), true);
  assertPreflightEvidence(defaultPreflightDesign, 'GraphPlannerRuntimeIntegrationDesign default preflight');

  const enabledPreflight = cloneJson(preflightContract);
  enabledPreflight.items[0].featureEnabled = true;
  assert.throws(
    () => createGraphPlannerRuntimeIntegrationDesign({
      graph,
      capabilityId: GRAPH_CAPABILITY_ID,
      preflightContract: enabledPreflight,
    }),
    /preflight|featureEnabled must remain false/i,
  );

  const runtimePayloadPreflight = cloneJson(preflightContract);
  runtimePayloadPreflight.items[0].downloadPolicy = {
    schemaVersion: DOWNLOAD_POLICY_SCHEMA_VERSION,
  };
  assert.throws(
    () => createGraphPlannerRuntimeIntegrationDesign({
      graph,
      capabilityId: GRAPH_CAPABILITY_ID,
      preflightContract: runtimePayloadPreflight,
    }),
    /preflight|runtime product|downloadPolicy/i,
  );

  const unsafePreflight = cloneJson(preflightContract);
  unsafePreflight.items[0].accessToken = 'synthetic-secret-value';
  unsafePreflight.items[0].profilePath = 'synthetic-profile-path';
  unsafePreflight.items[0].token = 'synthetic-bypass-token';
  const unsafeMessage = (() => {
    try {
      createDisabledGraphPlannerRuntimeConsumerResult(design, {
        preflightContract: unsafePreflight,
      });
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error('Expected function to throw');
  })();
  assert.match(unsafeMessage, /preflight|accessToken|profilePath|token|raw sensitive material|forbidden/iu);
  assert.doesNotMatch(unsafeMessage, /synthetic-secret-value|synthetic-profile-path|synthetic-bypass-token/u);
});

test('graph planner Layer entrypoint handoff guard keeps Graph from becoming a second executor', async () => {
  const { create: createPreflight, assertCompatibility: assertPreflightCompatibility } =
    loadFutureGraphLayerConsumerPreflightContractApi();
  const { create: createHandoffGuard, assertCompatibility: assertHandoffGuardCompatibility } =
    loadGraphPlannerLayerEntrypointHandoffGuardApi();
  const graph = await readMinimalGraphFixture();
  const preflightContract = createPreflight({
    graphVersion: 'synthetic-graph-v1',
    consumerName: 'synthetic-section3-planner-entrypoint-preflight',
  });
  const design = createGraphPlannerRuntimeIntegrationDesign({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
    preflightContract,
  });
  const disabledRuntimeConsumer = createDisabledGraphPlannerRuntimeConsumerResult(design, {
    consumerName: 'synthetic-section3-disabled-planner-entrypoint-consumer',
    preflightContract,
  });
  const guard = createHandoffGuard({
    sourcePreflight: preflightContract,
    disabledRuntimeConsumer,
  }, {
    handoffName: 'synthetic-section3-planner-layer-entrypoint-handoff-guard',
  });
  const item = guard.items[0];
  const requiredGuards = item.requiredGuards ?? {};
  const sourceRuntimeConsumer = item.sourceRuntimeConsumer
    ?? item.sourceDisabledRuntimeConsumer
    ?? item.disabledRuntimeConsumer;

  assert.equal(assertPreflightCompatibility(preflightContract), true);
  assert.equal(assertGraphPlannerRuntimeIntegrationDesignCompatibility(design), true);
  assert.equal(assertDisabledGraphPlannerRuntimeConsumerResultCompatibility(disabledRuntimeConsumer), true);
  assert.equal(assertHandoffGuardCompatibility(guard), true);
  assert.equal(guard.queryName, 'createGraphPlannerLayerEntrypointHandoffGuard');
  assert.equal(
    guard.artifactFamily,
    'site-capability-graph-planner-layer-entrypoint-handoff-guard',
  );
  assert.equal(guard.redactionRequired, true);
  assert.equal(item.handoffMode ?? item.guardMode ?? item.contractMode, 'descriptor-only');
  assert.equal(item.result, 'blocked');
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(item.requiredPreflightGuard, 'assertFutureGraphLayerConsumerPreflightCompatibility');
  assert.equal(
    item.requiredRuntimeConsumerGuard ?? item.requiredDisabledRuntimeConsumerGuard,
    'assertDisabledGraphPlannerRuntimeConsumerResultCompatibility',
  );
  assert.equal(
    item.requiredHandoffGuard,
    'assertGraphPlannerLayerEntrypointHandoffGuardCompatibility',
  );
  assert.equal(
    requiredGuards.preflightGuard ?? item.requiredPreflightGuard,
    'assertFutureGraphLayerConsumerPreflightCompatibility',
  );
  assert.equal(
    requiredGuards.runtimeConsumerGuard
      ?? requiredGuards.disabledRuntimeConsumerGuard
      ?? item.requiredRuntimeConsumerGuard
      ?? item.requiredDisabledRuntimeConsumerGuard,
    'assertDisabledGraphPlannerRuntimeConsumerResultCompatibility',
  );
  assert.equal(
    requiredGuards.handoffGuard ?? item.requiredHandoffGuard,
    'assertGraphPlannerLayerEntrypointHandoffGuardCompatibility',
  );
  assert.equal(item.sourcePreflight.queryName, preflightContract.queryName);
  assert.equal(item.sourcePreflight.artifactFamily, preflightContract.artifactFamily);
  assert.equal(item.sourcePreflight.result, preflightContract.items[0].result);
  assert.equal(item.sourcePreflight.reasonCode, preflightContract.items[0].reasonCode);
  assert.equal(sourceRuntimeConsumer.queryName, disabledRuntimeConsumer.queryName);
  assert.equal(sourceRuntimeConsumer.artifactFamily, disabledRuntimeConsumer.artifactFamily);
  assert.equal(sourceRuntimeConsumer.result, disabledRuntimeConsumer.items[0].result);
  assert.equal(sourceRuntimeConsumer.reasonCode, disabledRuntimeConsumer.items[0].reasonCode);
  assert.equal(
    sourceRuntimeConsumer.sourceDesign.artifactFamily,
    'site-capability-graph-planner-runtime-integration-design',
  );

  for (const flagName of [
    'executionAllowed',
    'liveRouteExecutionEnabled',
    'graphExecutionEnabled',
    'runtimeExecutionEnabled',
    'layerEntrypointReplacementAllowed',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'sessionMaterializationEnabled',
    'runtimeArtifactWriteEnabled',
    'repoWriteEnabled',
    'externalDispatchEnabled',
  ]) {
    assert.equal(item[flagName], false, flagName);
  }

  for (const runtimeField of [
    'taskList',
    'downloadPolicy',
    'sessionView',
    'downloader',
    'siteAdapter',
    'handler',
    'outputPath',
    'runtimePayload',
    'routeExecutor',
  ]) {
    assert.equal(Object.hasOwn(item, runtimeField), false, runtimeField);
  }

  for (const { name, options, pattern } of [
    {
      name: 'executionAllowed',
      options: { executionAllowed: true },
      pattern: /executionAllowed must remain false|executionAllowed must be false/i,
    },
    {
      name: 'liveRouteExecutionEnabled',
      options: { liveRouteExecutionEnabled: true },
      pattern: /liveRouteExecutionEnabled must remain false|liveRouteExecutionEnabled must be false/i,
    },
    {
      name: 'graphExecutionEnabled',
      options: { graphExecutionEnabled: true },
      pattern: /graphExecutionEnabled must remain false|graphExecutionEnabled must be false/i,
    },
    {
      name: 'runtimeExecutionEnabled',
      options: { runtimeExecutionEnabled: true },
      pattern: /runtimeExecutionEnabled must remain false|runtimeExecutionEnabled must be false/i,
    },
    {
      name: 'layerEntrypointReplacementAllowed',
      options: { layerEntrypointReplacementAllowed: true },
      pattern: /layerEntrypointReplacementAllowed must remain false|layerEntrypointReplacementAllowed must be false/i,
    },
    {
      name: 'siteAdapterInvocationEnabled',
      options: { siteAdapterInvocationEnabled: true },
      pattern: /siteAdapterInvocationEnabled must remain false|siteAdapterInvocationEnabled must be false/i,
    },
    {
      name: 'downloaderInvocationEnabled',
      options: { downloaderInvocationEnabled: true },
      pattern: /downloaderInvocationEnabled must remain false|downloaderInvocationEnabled must be false/i,
    },
    {
      name: 'sessionMaterializationEnabled',
      options: { sessionMaterializationEnabled: true },
      pattern: /sessionMaterializationEnabled must remain false|sessionMaterializationEnabled must be false/i,
    },
    {
      name: 'runtimeArtifactWriteEnabled',
      options: { runtimeArtifactWriteEnabled: true },
      pattern: /runtimeArtifactWriteEnabled must remain false|runtimeArtifactWriteEnabled must be false/i,
    },
    {
      name: 'repoWriteEnabled',
      options: { repoWriteEnabled: true },
      pattern: /repoWriteEnabled must remain false|repoWriteEnabled must be false/i,
    },
    {
      name: 'externalDispatchEnabled',
      options: { externalDispatchEnabled: true },
      pattern: /externalDispatchEnabled must remain false|externalDispatchEnabled must be false/i,
    },
    {
      name: 'taskList',
      options: { taskList: [] },
      pattern: /taskList|descriptor-only|runtime field/i,
    },
    {
      name: 'downloadPolicy',
      options: { downloadPolicy: { execute: 'synthetic-secret-value' } },
      pattern: /downloadPolicy|descriptor-only|runtime field/i,
    },
    {
      name: 'sessionView',
      options: { sessionView: { sessionId: 'synthetic-secret-value' } },
      pattern: /sessionView|descriptor-only|runtime field|raw sensitive material/i,
    },
    {
      name: 'downloader',
      options: { downloader: { execute: 'synthetic-secret-value' } },
      pattern: /downloader|descriptor-only|runtime field/i,
    },
    {
      name: 'siteAdapter',
      options: { siteAdapter: { execute: 'synthetic-secret-value' } },
      pattern: /siteAdapter|descriptor-only|runtime field/i,
    },
    {
      name: 'handler',
      options: { handler: { execute: 'synthetic-secret-value' } },
      pattern: /handler|descriptor-only|runtime field/i,
    },
    {
      name: 'outputPath',
      options: { outputPath: 'runs/synthetic-secret-value.json' },
      pattern: /outputPath|descriptor-only|runtime field/i,
    },
    {
      name: 'runtimePayload',
      options: { runtimePayload: { Authorization: 'Bearer synthetic-secret-value' } },
      pattern: /runtimePayload|Authorization|descriptor-only|runtime field|raw sensitive material/i,
    },
  ]) {
    const message = captureThrownMessage(() => createHandoffGuard({
      sourcePreflight: preflightContract,
      disabledRuntimeConsumer,
    }, {
      handoffName: 'synthetic-section3-planner-layer-entrypoint-handoff-guard',
      ...options,
    }));
    assert.match(message, pattern, name);
    assert.doesNotMatch(message, /synthetic-secret-value/u, name);
  }

  const unsafeGuard = createHandoffGuard({
    sourcePreflight: preflightContract,
    disabledRuntimeConsumer,
  }, {
    handoffName: 'synthetic-section3-planner-layer-entrypoint-handoff-guard',
  });
  unsafeGuard.items[0].graphExecutionEnabled = true;
  assert.throws(
    () => assertHandoffGuardCompatibility(unsafeGuard),
    /graphExecutionEnabled must be false|graphExecutionEnabled must remain false/u,
  );

  const rendered = JSON.stringify(guard);
  assert.doesNotMatch(rendered, /synthetic-secret-value|Authorization|Bearer|cookie|csrf|sessionId|browserProfile/iu);
  assert.doesNotMatch(rendered, /"taskList"\s*:|"downloadPolicy"\s*:|"sessionView"\s*:|"downloader"\s*:/u);
  assert.doesNotMatch(rendered, /"siteAdapter"\s*:|"handler"\s*:|"outputPath"\s*:|"runtimePayload"\s*:/u);
});

test('graph planner Layer entrypoint handoff guard rejects unsafe source aliases', async () => {
  const { create: createPreflight } = loadFutureGraphLayerConsumerPreflightContractApi();
  const { create: createHandoffGuard, assertCompatibility: assertHandoffGuardCompatibility } =
    loadGraphPlannerLayerEntrypointHandoffGuardApi();
  const graph = await readMinimalGraphFixture();
  const preflightContract = createPreflight({
    graphVersion: 'synthetic-graph-v1',
    consumerName: 'synthetic-section3-source-alias-preflight',
  });
  const design = createGraphPlannerRuntimeIntegrationDesign({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
    preflightContract,
  });
  const disabledRuntimeConsumer = createDisabledGraphPlannerRuntimeConsumerResult(design, {
    consumerName: 'synthetic-section3-source-alias-disabled-runtime-consumer',
    preflightContract,
  });

  const guard = createHandoffGuard({
    sourcePreflight: preflightContract,
    preflight: preflightContract,
    disabledRuntimeConsumer,
    runtimeConsumerResult: disabledRuntimeConsumer,
    sourceRuntimeConsumer: disabledRuntimeConsumer,
    plannerRuntimeDesign: design,
    runtimeDesign: design,
    sourceDesign: design,
  }, {
    handoffName: 'synthetic-section3-source-alias-handoff-guard',
  });
  assert.equal(assertHandoffGuardCompatibility(guard), true);

  const otherPreflight = createPreflight({
    graphVersion: 'synthetic-graph-v1',
    consumerName: 'synthetic-section3-other-source-alias-preflight',
  });
  const otherDesign = createGraphPlannerRuntimeIntegrationDesign({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
    preflightContract,
  });
  const otherRuntimeConsumer = createDisabledGraphPlannerRuntimeConsumerResult(design, {
    consumerName: 'synthetic-section3-other-source-alias-disabled-runtime-consumer',
    preflightContract,
  });

  for (const { name, sources, pattern } of [
    {
      name: 'preflight alias mismatch',
      sources: {
        sourcePreflight: preflightContract,
        preflight: otherPreflight,
        disabledRuntimeConsumer,
      },
      pattern: /preflight source aliases must reference the same descriptor object/u,
    },
    {
      name: 'preflight unselected alias compatibility',
      sources: {
        sourcePreflight: preflightContract,
        preflight: { ...preflightContract, queryName: 'synthetic-unsafe-query' },
        disabledRuntimeConsumer,
      },
      pattern: /queryName/u,
    },
    {
      name: 'runtime alias mismatch',
      sources: {
        sourcePreflight: preflightContract,
        disabledRuntimeConsumer,
        runtimeConsumerResult: otherRuntimeConsumer,
      },
      pattern: /runtimeConsumer source aliases must reference the same descriptor object/u,
    },
    {
      name: 'runtime unselected alias compatibility',
      sources: {
        sourcePreflight: preflightContract,
        disabledRuntimeConsumer,
        sourceRuntimeConsumer: {
          ...disabledRuntimeConsumer,
          queryName: 'synthetic-unsafe-query',
        },
      },
      pattern: /queryName/u,
    },
    {
      name: 'design alias mismatch',
      sources: {
        sourcePreflight: preflightContract,
        disabledRuntimeConsumer,
        plannerRuntimeDesign: design,
        runtimeDesign: otherDesign,
      },
      pattern: /runtimeDesign source aliases must reference the same descriptor object/u,
    },
    {
      name: 'design unselected alias compatibility',
      sources: {
        sourcePreflight: preflightContract,
        disabledRuntimeConsumer,
        plannerRuntimeDesign: design,
        sourceDesign: {
          ...design,
          queryName: 'synthetic-unsafe-query',
        },
      },
      pattern: /queryName/u,
    },
    {
      name: 'sources runtime payload',
      sources: {
        sourcePreflight: preflightContract,
        disabledRuntimeConsumer,
        runtimePayload: { Authorization: 'Bearer synthetic-secret-value' },
      },
      pattern: /runtimePayload|runtime field|descriptor-only/u,
    },
    {
      name: 'sources callback',
      sources: {
        sourcePreflight: preflightContract,
        disabledRuntimeConsumer,
        callback: { token: 'synthetic-secret-value' },
      },
      pattern: /callback|runtime field|descriptor-only/u,
    },
    {
      name: 'sources nested browser profile',
      sources: {
        sourcePreflight: preflightContract,
        disabledRuntimeConsumer,
        metadata: { browserProfile: 'synthetic-secret-value' },
      },
      pattern: /browserProfile|runtime field|raw sensitive material/u,
    },
  ]) {
    const message = captureThrownMessage(() => createHandoffGuard(sources, {
      handoffName: 'synthetic-section3-source-alias-handoff-guard',
    }));
    assert.match(message, pattern, name);
    assert.doesNotMatch(message, /synthetic-secret-value|Bearer synthetic-secret-value/u, name);
  }
});

test('graph planner Layer entrypoint handoff safe summary proves minimum Layer consumption boundary', async () => {
  const { create: createPreflight } = loadFutureGraphLayerConsumerPreflightContractApi();
  const { create: createHandoffGuard, assertCompatibility: assertHandoffGuardCompatibility } =
    loadGraphPlannerLayerEntrypointHandoffGuardApi();
  const { create: createSafeSummary, assertCompatibility: assertSafeSummaryCompatibility } =
    loadGraphPlannerLayerEntrypointHandoffSafeSummaryApi();
  const graph = await readMinimalGraphFixture();
  const preflightContract = createPreflight({
    graphVersion: 'synthetic-graph-v1',
    consumerName: 'synthetic-section3-safe-summary-preflight',
  });
  const design = createGraphPlannerRuntimeIntegrationDesign({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
    preflightContract,
  });
  const disabledRuntimeConsumer = createDisabledGraphPlannerRuntimeConsumerResult(design, {
    consumerName: 'synthetic-section3-safe-summary-disabled-runtime-consumer',
  });
  const guard = createHandoffGuard({
    sourcePreflight: preflightContract,
    disabledRuntimeConsumer,
  }, {
    handoffName: 'synthetic-section3-safe-summary-source-guard',
  });

  const summary = createSafeSummary(guard);
  const item = summary.items[0];

  assert.equal(assertHandoffGuardCompatibility(guard), true);
  assert.equal(assertSafeSummaryCompatibility(summary), true);
  assert.equal(summary.queryName, 'createGraphPlannerLayerEntrypointHandoffSafeSummary');
  assert.equal(
    summary.artifactFamily,
    'site-capability-graph-planner-layer-entrypoint-handoff-safe-summary',
  );
  assert.equal(summary.redactionRequired, true);
  assert.equal(item.summaryMode, 'descriptor-only');
  assert.equal(item.result, 'blocked');
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(item.layerEntrypoint, 'SiteCapabilityLayerPlanner');
  assert.equal(item.blockedEntrypoint, 'GraphPlannerRuntimeConsumer');
  assert.equal(item.graphVersion, 'synthetic-graph-v1');
  assert.deepEqual(item.sourceGuard, {
    queryName: 'createGraphPlannerLayerEntrypointHandoffGuard',
    artifactFamily: 'site-capability-graph-planner-layer-entrypoint-handoff-guard',
    graphVersion: 'synthetic-graph-v1',
    redactionRequired: true,
    guardName: 'synthetic-section3-safe-summary-source-guard',
    guardMode: 'descriptor-only',
    result: 'blocked',
    reasonCode: 'graph-runtime-consumer-disabled',
    requiredHandoffGuard: 'assertGraphPlannerLayerEntrypointHandoffGuardCompatibility',
    sourcePreflight: {
      queryName: 'createFutureGraphLayerConsumerPreflightContract',
      artifactFamily: 'site-capability-graph-future-layer-consumer-preflight-contract',
      graphVersion: 'synthetic-graph-v1',
      result: 'blocked',
      reasonCode: 'graph-runtime-consumer-disabled',
    },
    sourceRuntimeConsumer: {
      queryName: 'createDisabledGraphPlannerRuntimeConsumerResult',
      artifactFamily: 'site-capability-graph-planner-runtime-consumer-result',
      graphVersion: 'synthetic-graph-v1',
      result: 'blocked',
      reasonCode: 'graph-runtime-consumer-disabled',
    },
  });

  const rendered = JSON.stringify(summary);
  assert.doesNotMatch(rendered, /"handoff"\s*:|"route"\s*:|"taskList"\s*:|"standardTaskList"\s*:/u);
  assert.doesNotMatch(rendered, /"downloadPolicy"\s*:|"sessionView"\s*:|"siteAdapter"\s*:|"downloader"\s*:/u);
  assert.doesNotMatch(rendered, /"artifactPath"\s*:|"repoPath"\s*:|"writePath"\s*:|"handler"\s*:|"callback"\s*:/u);
  assert.doesNotMatch(rendered, /credential|token|cookie|sessionId|profile|synthetic-secret-value/iu);

  for (const [fieldName, fieldValue] of [
    ['executionAllowed', true],
    ['runtimeExecutionEnabled', true],
    ['handoff', { secret: 'synthetic-secret-value' }],
    ['route', { id: 'route:synthetic-secret-value' }],
    ['taskList', { items: [] }],
    ['standardTaskList', { items: [] }],
    ['downloadPolicy', { dryRun: true }],
    ['sessionView', { sessionId: 'synthetic-secret-value' }],
    ['siteAdapter', { invoke: 'synthetic-secret-value' }],
    ['downloader', { run: 'synthetic-secret-value' }],
    ['artifactPath', 'runs/synthetic-secret-value.json'],
    ['repoPath', 'C:/synthetic-secret-value'],
    ['writePath', 'runs/synthetic-secret-value.json'],
    ['handler', { run: 'synthetic-secret-value' }],
    ['callback', { run: 'synthetic-secret-value' }],
    ['credential', 'synthetic-secret-value'],
    ['token', 'synthetic-secret-value'],
    ['cookie', 'synthetic-secret-value'],
    ['profile', 'synthetic-secret-value'],
  ]) {
    const unsafeGuard = cloneJson(guard);
    unsafeGuard.items[0][fieldName] = fieldValue;
    const message = captureThrownMessage(() => createSafeSummary(unsafeGuard));
    assert.match(message, /descriptor-only|runtime field|must remain false|raw|sensitive|forbidden/iu, fieldName);
    assert.doesNotMatch(message, /synthetic-secret-value/u, fieldName);
  }

  const unsafeSummary = cloneJson(summary);
  unsafeSummary.items[0].route = { id: 'route:synthetic-secret-value' };
  const unsafeSummaryMessage = captureThrownMessage(() => assertSafeSummaryCompatibility(unsafeSummary));
  assert.match(unsafeSummaryMessage, /descriptor-only|runtime field/u);
  assert.doesNotMatch(unsafeSummaryMessage, /synthetic-secret-value/u);
});

test('graph planner Layer entrypoint live execution denial guard consumes safe summary without executing', async () => {
  const { create: createPreflight } = loadFutureGraphLayerConsumerPreflightContractApi();
  const { create: createHandoffGuard } = loadGraphPlannerLayerEntrypointHandoffGuardApi();
  const { create: createSafeSummary, assertCompatibility: assertSafeSummaryCompatibility } =
    loadGraphPlannerLayerEntrypointHandoffSafeSummaryApi();
  const { create: createLiveExecutionDenialGuard, assertCompatibility: assertDenialGuardCompatibility } =
    loadGraphPlannerLayerEntrypointLiveExecutionDenialGuardApi();
  const graph = await readMinimalGraphFixture();
  const preflightContract = createPreflight({
    graphVersion: 'synthetic-graph-v1',
    consumerName: 'synthetic-section3-live-denial-preflight',
  });
  const design = createGraphPlannerRuntimeIntegrationDesign({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
    preflightContract,
  });
  const disabledRuntimeConsumer = createDisabledGraphPlannerRuntimeConsumerResult(design, {
    consumerName: 'synthetic-section3-live-denial-disabled-runtime-consumer',
  });
  const guard = createHandoffGuard({
    sourcePreflight: preflightContract,
    disabledRuntimeConsumer,
  }, {
    handoffName: 'synthetic-section3-live-denial-source-guard',
  });
  const summary = createSafeSummary(guard);

  const denialGuard = createLiveExecutionDenialGuard(summary, {
    guardName: 'synthetic-section3-live-execution-denial-guard',
  });
  const item = denialGuard.items[0];

  assert.equal(assertSafeSummaryCompatibility(summary), true);
  assert.equal(assertDenialGuardCompatibility(denialGuard), true);
  assert.equal(denialGuard.queryName, 'createGraphPlannerLayerEntrypointLiveExecutionDenialGuard');
  assert.equal(
    denialGuard.artifactFamily,
    'site-capability-graph-planner-layer-entrypoint-live-execution-denial-guard',
  );
  assert.equal(denialGuard.redactionRequired, true);
  assert.equal(item.denialMode, 'descriptor-only');
  assert.equal(item.result, 'blocked');
  assert.equal(item.redactionRequired, true);
  assert.equal(item.layerEntrypoint, 'SiteCapabilityLayerPlanner');
  assert.equal(item.blockedEntrypoint, 'GraphPlannerRuntimeConsumer');
  assert.equal(item.graphVersion, 'synthetic-graph-v1');
  assert.equal(item.sourceSummary.queryName, 'createGraphPlannerLayerEntrypointHandoffSafeSummary');
  assert.equal(item.sourceSummary.result, 'blocked');
  assert.equal(item.sourceSummary.summaryMode, 'descriptor-only');

  assertNoPlannerRuntimeProducts(denialGuard, 'GraphPlannerLayerEntrypointLiveExecutionDenialGuard');
  const rendered = JSON.stringify(denialGuard);
  assert.doesNotMatch(rendered, /"route"\s*:|"routePlan"\s*:|"taskList"\s*:|"standardTaskList"\s*:/u);
  assert.doesNotMatch(rendered, /"downloadPolicy"\s*:|"sessionView"\s*:|"siteAdapter"\s*:|"downloader"\s*:/u);
  assert.doesNotMatch(rendered, /"artifactPath"\s*:|"repoPath"\s*:|"writePath"\s*:|"outputPath"\s*:/u);
  assert.doesNotMatch(rendered, /"handler"\s*:|"callback"\s*:|"runtimePayload"\s*:|"payload"\s*:/u);
  assert.doesNotMatch(rendered, /credential|token|cookie|csrf|sessionId|profile|synthetic-secret-value/iu);
});

test('graph planner Layer entrypoint live execution denial guard rejects runtime execution products and unsafe source aliases', async () => {
  const { create: createPreflight } = loadFutureGraphLayerConsumerPreflightContractApi();
  const { create: createHandoffGuard } = loadGraphPlannerLayerEntrypointHandoffGuardApi();
  const { create: createSafeSummary } = loadGraphPlannerLayerEntrypointHandoffSafeSummaryApi();
  const { create: createLiveExecutionDenialGuard, assertCompatibility: assertDenialGuardCompatibility } =
    loadGraphPlannerLayerEntrypointLiveExecutionDenialGuardApi();
  const graph = await readMinimalGraphFixture();
  const preflightContract = createPreflight({
    graphVersion: 'synthetic-graph-v1',
    consumerName: 'synthetic-section3-live-denial-reject-preflight',
  });
  const design = createGraphPlannerRuntimeIntegrationDesign({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
    preflightContract,
  });
  const disabledRuntimeConsumer = createDisabledGraphPlannerRuntimeConsumerResult(design, {
    consumerName: 'synthetic-section3-live-denial-reject-disabled-runtime-consumer',
  });
  const guard = createHandoffGuard({
    sourcePreflight: preflightContract,
    disabledRuntimeConsumer,
  }, {
    handoffName: 'synthetic-section3-live-denial-reject-source-guard',
  });
  const summary = createSafeSummary(guard);
  const otherSummary = createSafeSummary(createHandoffGuard({
    sourcePreflight: preflightContract,
    disabledRuntimeConsumer,
  }, {
    handoffName: 'synthetic-section3-live-denial-reject-other-source-guard',
  }));

  const validAliasedGuard = createLiveExecutionDenialGuard({
    sourceSafeSummary: summary,
    safeSummary: summary,
    handoffSafeSummary: summary,
    sourceHandoffSafeSummary: summary,
    plannerLayerEntrypointHandoffSafeSummary: summary,
    sourcePlannerLayerEntrypointHandoffSafeSummary: summary,
  }, {
    guardName: 'synthetic-section3-live-denial-aliased-guard',
  });
  assert.equal(assertDenialGuardCompatibility(validAliasedGuard), true);

  for (const { name, source, options = {}, pattern } of [
    {
      name: 'missing source',
      source: {},
      pattern: /safe summary source|required|missing/i,
    },
    {
      name: 'live execution enabled',
      source: summary,
      options: { liveExecutionEnabled: true },
      pattern: /liveExecutionEnabled|execution.*false|descriptor-only/i,
    },
    {
      name: 'runtime execution enabled',
      source: summary,
      options: { runtimeExecutionEnabled: true },
      pattern: /runtimeExecutionEnabled|execution.*false|descriptor-only/i,
    },
    {
      name: 'route execution enabled',
      source: summary,
      options: { routeExecutionEnabled: true },
      pattern: /routeExecutionEnabled|execution.*false|descriptor-only/i,
    },
    {
      name: 'site adapter invocation enabled',
      source: summary,
      options: { siteAdapterInvocationEnabled: true },
      pattern: /siteAdapterInvocationEnabled|execution.*false|descriptor-only/i,
    },
    {
      name: 'downloader invocation enabled',
      source: summary,
      options: { downloaderInvocationEnabled: true },
      pattern: /downloaderInvocationEnabled|execution.*false|descriptor-only/i,
    },
    {
      name: 'runtime artifact write enabled',
      source: summary,
      options: { runtimeArtifactWriteEnabled: true },
      pattern: /runtimeArtifactWriteEnabled|write.*false|descriptor-only/i,
    },
    {
      name: 'download policy payload',
      source: summary,
      options: { downloadPolicy: { execute: 'synthetic-secret-value' } },
      pattern: /downloadPolicy|runtime field|descriptor-only/i,
    },
    {
      name: 'session view payload',
      source: summary,
      options: { sessionView: { sessionId: 'synthetic-secret-value' } },
      pattern: /sessionView|runtime field|raw sensitive material|descriptor-only/i,
    },
    {
      name: 'runtime payload',
      source: summary,
      options: { runtimePayload: { Authorization: 'Bearer synthetic-secret-value' } },
      pattern: /runtimePayload|Authorization|runtime field|raw sensitive material|descriptor-only/i,
    },
    {
      name: 'write path',
      source: summary,
      options: { writePath: 'runs/synthetic-secret-value.json' },
      pattern: /writePath|runtime field|descriptor-only/i,
    },
    {
      name: 'sensitive option',
      source: summary,
      options: { token: 'synthetic-secret-value' },
      pattern: /token|raw sensitive material|forbidden/i,
    },
    {
      name: 'multiple distinct aliases',
      source: {
        sourceSafeSummary: summary,
        safeSummary: otherSummary,
      },
      pattern: /safeSummary source aliases must reference the same descriptor object|source aliases/i,
    },
    {
      name: 'distinct source handoff safe summary alias',
      source: {
        sourceSafeSummary: summary,
        sourceHandoffSafeSummary: otherSummary,
      },
      pattern: /safeSummary source aliases must reference the same descriptor object|source aliases/i,
    },
    {
      name: 'distinct planner layer entrypoint handoff safe summary alias',
      source: {
        safeSummary: summary,
        plannerLayerEntrypointHandoffSafeSummary: otherSummary,
      },
      pattern: /safeSummary source aliases must reference the same descriptor object|source aliases/i,
    },
    {
      name: 'unsafe alias',
      source: {
        sourceSafeSummary: summary,
        handoffSafeSummary: {
          ...summary,
          queryName: 'synthetic-unsafe-query',
        },
      },
      pattern: /queryName|source aliases|compatibility/i,
    },
    {
      name: 'source runtime payload alias',
      source: {
        sourceSafeSummary: summary,
        runtimePayload: { Authorization: 'Bearer synthetic-secret-value' },
      },
      pattern: /runtimePayload|runtime field|descriptor-only|raw sensitive material/i,
    },
  ]) {
    const message = captureThrownMessage(() => createLiveExecutionDenialGuard(source, {
      guardName: 'synthetic-section3-live-denial-reject-guard',
      ...options,
    }));
    assert.match(message, pattern, name);
    assert.doesNotMatch(message, /synthetic-secret-value|Bearer synthetic-secret-value/u, name);
  }

  const unsafeGuard = createLiveExecutionDenialGuard(summary, {
    guardName: 'synthetic-section3-live-denial-mutated-guard',
  });
  unsafeGuard.items[0].executionAllowed = true;
  const enabledMessage = captureThrownMessage(() => assertDenialGuardCompatibility(unsafeGuard));
  assert.match(enabledMessage, /executionAllowed|must be false|descriptor-only/iu);
  assert.doesNotMatch(enabledMessage, /synthetic-secret-value/u);

  const unsafePayloadGuard = createLiveExecutionDenialGuard(summary, {
    guardName: 'synthetic-section3-live-denial-mutated-payload-guard',
  });
  unsafePayloadGuard.items[0].runtimePayload = {
    Authorization: 'Bearer synthetic-secret-value',
  };
  const payloadMessage = captureThrownMessage(() => assertDenialGuardCompatibility(unsafePayloadGuard));
  assert.match(payloadMessage, /runtimePayload|Authorization|runtime field|raw sensitive material|descriptor-only/iu);
  assert.doesNotMatch(payloadMessage, /synthetic-secret-value/u);
});

test('graph planner route handoff can be prepared and written as a guarded graph artifact', async (t) => {
  const graph = await readMinimalGraphFixture();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'graph-planner-handoff-artifact-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const artifact = createGraphPlannerRouteHandoffArtifact({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
  });
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.queryName, 'createGraphPlannerRouteHandoff');
  assert.equal(artifact.artifactFamily, 'site-capability-graph-planner-handoff');
  assert.equal(artifact.redactionRequired, true);
  assert.equal(artifact.items[0].executionAllowed, false);
  assert.equal(artifact.items[0].route.id, GRAPH_ROUTE_ID);

  const prepared = prepareGraphDerivedArtifactWrite(artifact);
  assert.equal(prepared.artifactFamily, 'site-capability-graph-planner-handoff');
  assert.equal(JSON.parse(prepared.artifactJson).redactionRequired, true);
  assert.equal(JSON.parse(prepared.auditJson).schemaVersion, 1);

  const placement = createGraphDerivedArtifactPlacement({
    outputDir: tempDir,
    runId: 'synthetic-run-graph-plan',
    artifactFamily: 'site-capability-graph-planner-handoff',
    artifactName: 'route-plan',
  });
  const result = await writeGraphDerivedArtifactPair(artifact, placement);

  assert.equal(result.artifactPath, placement.artifactPath);
  assert.equal(result.auditPath, placement.auditPath);
  const artifactJson = await readFile(result.artifactPath, 'utf8');
  const auditJson = await readFile(result.auditPath, 'utf8');
  assert.doesNotMatch(artifactJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
  assert.doesNotMatch(auditJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
});

test('graph planner route handoff artifact fails closed before unsafe writes', async (t) => {
  const graph = await readMinimalGraphFixture();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'graph-planner-handoff-artifact-fail-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const placement = createGraphDerivedArtifactPlacement({
    outputDir: tempDir,
    runId: 'synthetic-run-graph-plan-fail',
    artifactFamily: 'site-capability-graph-planner-handoff',
    artifactName: 'route-plan',
  });
  const unsafeArtifact = createGraphPlannerRouteHandoffArtifact({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
  });
  unsafeArtifact.items[0].accessToken = 'synthetic-secret-value';

  await assert.rejects(
    () => writeGraphDerivedArtifactPair(unsafeArtifact, placement),
    /forbidden field/u,
  );
  await assert.rejects(access(placement.artifactPath), /ENOENT/u);
  await assert.rejects(access(placement.auditPath), /ENOENT/u);

  const unredactedArtifact = createGraphPlannerRouteHandoffArtifact({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
  });
  unredactedArtifact.redactionRequired = false;
  assert.throws(
    () => prepareGraphDerivedArtifactWrite(unredactedArtifact),
    /redactionRequired=true/u,
  );
});

test('planner policy handoff carries graph planner reasonCodes without route execution', async () => {
  const graph = await readMinimalGraphFixture();
  const contextBlocked = createGraphPlannerRouteHandoff({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
    context: {
      availableRouteIds: ['route:synthetic.example:missing'],
    },
  });

  assert.equal(contextBlocked.result, 'blocked');
  assert.equal(contextBlocked.reasonCode, 'graph-planner-context-unsatisfied');
  assert.equal(contextBlocked.reason.code, 'graph-planner-context-unsatisfied');
  assert.equal(contextBlocked.reason.artifactWriteAllowed, false);
  assert.equal(contextBlocked.route, null);
  assert.equal(contextBlocked.executionAllowed, false);
  assert.equal(assertGraphPlannerRouteHandoffConsumerCompatibility(contextBlocked), true);

  const riskGraph = await readMinimalGraphFixture();
  assignGraphRouteRiskPolicy(
    riskGraph,
    GRAPH_ROUTE_ID,
    'risk-policy:synthetic.example:route-suspicious-readonly',
    'suspicious',
  );
  const riskBlocked = createGraphPlannerRouteHandoff({
    graph: riskGraph,
    capabilityId: GRAPH_CAPABILITY_ID,
    context: {
      blockedRiskStates: ['suspicious'],
    },
  });

  assert.equal(riskBlocked.result, 'blocked');
  assert.equal(riskBlocked.reasonCode, 'graph-route-forbidden-by-risk');
  assert.equal(riskBlocked.reason.code, 'graph-route-forbidden-by-risk');
  assert.equal(riskBlocked.riskState, 'suspicious');
  assert.equal(riskBlocked.route, null);
  assert.equal(riskBlocked.executionAllowed, false);
  assert.equal(assertGraphPlannerRouteHandoffConsumerCompatibility(riskBlocked), true);
});

test('planner policy handoff gates graph versions before route planning', async () => {
  const graph = await readMinimalGraphFixture();
  const futureDataVersionGraph = {
    ...graph,
    manifest: {
      ...graph.manifest,
      graphDataVersion: 'future-graph-v999',
    },
  };
  const futureSchemaVersionGraph = {
    ...graph,
    manifest: {
      ...graph.manifest,
      graphSchemaVersion: 999,
    },
  };

  for (const blockedGraph of [futureDataVersionGraph, futureSchemaVersionGraph]) {
    assert.throws(
      () => createGraphPlannerRouteHandoff({
        graph: blockedGraph,
        capabilityId: GRAPH_CAPABILITY_ID,
      }),
      (error) => {
        assert.equal(error.reasonCode, 'graph-version-incompatible');
        assert.equal(error.retryable, false);
        assert.equal(error.manualRecoveryNeeded, true);
        assert.equal(error.artifactWriteAllowed, false);
        assert.equal(error.failureMode, 'graph-version-compatibility');
        assert.equal(error.causeSummary.reasonCode, 'graph-version-incompatible');
        assert.equal(error.causeSummary.supportedGraphSchemaVersion, 1);
        assert.deepEqual(error.causeSummary.supportedGraphDataVersions, [
          'synthetic-graph-v1',
          'synthetic-generated-from-layer-v1',
        ]);
        return true;
      },
    );
  }

  assert.throws(
    () => createGraphPlannerRouteHandoff({
      graph,
      capabilityId: GRAPH_CAPABILITY_ID,
      supportedGraphDataVersions: ['other-compatible-graph-v1'],
    }),
    /Graph planner handoff version compatibility failed/u,
  );
});

test('Graph Layer policy planner relationship evidence runs policy handoff while keeping Graph read-only', async () => {
  const graph = await readMinimalGraphFixture();
  const catalogEntry = createCatalogEntry({
    candidateId: 'candidate-synthetic-graph-layer-policy-planner',
    siteKey: 'synthetic.example',
    endpoint: {
      method: 'GET',
      url: 'https://synthetic.example/api/public-page?id=1',
    },
    auth: {
      required: false,
      scheme: 'none',
    },
  });
  const evidence = createGraphLayerPolicyPlannerRelationshipEvidence({
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
    catalogEntry,
    catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(catalogEntry),
    taskIntent: {
      siteKey: 'synthetic.example',
      taskType: 'open-page',
      id: 'task-synthetic-graph-layer-policy-planner',
      kind: 'request',
      cacheKey: 'synthetic.example:public-page:1',
      dedupKey: 'synthetic.example:public-page:1',
    },
    policy: {
      retries: 1,
      retryBackoffMs: 100,
      cache: true,
      dedup: true,
      sessionRequirement: 'none',
    },
  });
  const item = evidence.items[0];

  assert.equal(assertGraphLayerPolicyPlannerRelationshipEvidenceCompatibility(evidence), true);
  assert.equal(evidence.queryName, 'createGraphLayerPolicyPlannerRelationshipEvidence');
  assert.equal(evidence.artifactFamily, 'site-capability-graph-layer-policy-planner-relationship-evidence');
  assert.equal(evidence.relationshipKind, 'graph-layer-policy-planner-runtime-path');
  assert.equal(evidence.layerEntryPoint, 'SiteCapabilityLayerPlanner');
  assert.equal(evidence.redactionRequired, true);
  assert.equal(item.relationshipMode, 'policy-handoff-runtime-path-with-readonly-graph-plan');
  assert.equal(item.result, 'reviewable');
  assert.equal(item.graphConsumedAs, 'read-only-route-planning-evidence');
  assert.equal(item.layerPolicyPlannerEntrypoint, 'createPlannerPolicyHandoff');
  assert.equal(item.policyRuntimeCompatibilityGuard, 'assertPlannerPolicyRuntimeHandoffCompatibility');
  assert.equal(
    item.graphRouteCompatibilityGuard,
    'assertGraphPlannerRouteHandoffLayerEntrypointBoundaryCompatibility',
  );
  assert.equal(item.graphRoutePlan.result, 'planned');
  assert.equal(item.graphRoutePlan.routeId, GRAPH_ROUTE_ID);
  assert.equal(item.graphRoutePlan.executionAllowed, false);
  assert.equal(item.policyRuntimePath.siteKey, 'synthetic.example');
  assert.equal(item.policyRuntimePath.taskType, 'open-page');
  assert.equal(item.policyRuntimePath.policyDryRun, true);
  assert.equal(item.policyRuntimePath.policyNetworkResolveAllowed, false);
  assert.equal(item.policyRuntimePath.policySessionRequirement, 'none');
  assert.equal(item.policyRuntimePath.standardTaskCount, 1);

  for (const flagName of [
    'graphExecutionAllowed',
    'routeExecutionAllowed',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'sessionMaterializationEnabled',
    'runtimeArtifactWriteEnabled',
    'repoWriteEnabled',
    'externalDispatchEnabled',
    'statusPromotionEnabled',
  ]) {
    assert.equal(item[flagName], false, flagName);
  }
  for (const runtimeField of [
    'taskList',
    'downloadPolicy',
    'sessionView',
    'siteAdapter',
    'downloader',
    'handler',
    'routeExecutor',
    'runtimePayload',
    'artifactPath',
    'writePath',
  ]) {
    assert.equal(Object.hasOwn(item, runtimeField), false, runtimeField);
  }
  const rendered = JSON.stringify(evidence);
  assert.doesNotMatch(rendered, /"taskList"\s*:|"downloadPolicy"\s*:|"sessionView"\s*:/u);
  assert.doesNotMatch(rendered, /"siteAdapter"\s*:|"downloader"\s*:|"runtimePayload"\s*:/u);
  assert.doesNotMatch(rendered, /authorization|cookie|csrf|sessionId|browserProfile|synthetic-secret-value/iu);
});

test('Graph Layer policy planner relationship evidence fails closed on execution, runtime products, and blocked routes', async () => {
  const graph = await readMinimalGraphFixture();
  const catalogEntry = createCatalogEntry({
    candidateId: 'candidate-synthetic-graph-layer-policy-planner-fail',
    siteKey: 'synthetic.example',
    endpoint: {
      method: 'GET',
      url: 'https://synthetic.example/api/public-page?id=1',
    },
    auth: {
      required: false,
      scheme: 'none',
    },
  });
  const baseOptions = {
    graph,
    capabilityId: GRAPH_CAPABILITY_ID,
    catalogEntry,
    catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(catalogEntry),
    taskIntent: {
      siteKey: 'synthetic.example',
      taskType: 'open-page',
      id: 'task-synthetic-graph-layer-policy-planner-fail',
      kind: 'request',
    },
    policy: {
      sessionRequirement: 'none',
    },
  };
  const evidence = createGraphLayerPolicyPlannerRelationshipEvidence(baseOptions);

  const enabledExecution = cloneJson(evidence);
  enabledExecution.items[0].graphExecutionAllowed = true;
  assert.throws(
    () => assertGraphLayerPolicyPlannerRelationshipEvidenceCompatibility(enabledExecution),
    /graphExecutionAllowed must be false/u,
  );

  const runtimePayload = cloneJson(evidence);
  runtimePayload.items[0].downloadPolicy = {
    Authorization: 'Bearer synthetic-secret-value',
  };
  const runtimeMessage = captureThrownMessage(
    () => assertGraphLayerPolicyPlannerRelationshipEvidenceCompatibility(runtimePayload),
  );
  assert.match(runtimeMessage, /downloadPolicy|runtime field|raw sensitive material|forbidden|raw Authorization/iu);
  assert.doesNotMatch(runtimeMessage, /synthetic-secret-value|Bearer synthetic-secret-value/u);

  const blockedRouteMessage = captureThrownMessage(() => createGraphLayerPolicyPlannerRelationshipEvidence({
    ...baseOptions,
    context: {
      availableRouteIds: ['route:synthetic.example:missing'],
    },
  }));
  assert.match(blockedRouteMessage, /planned graph route|graph-planner-context-unsatisfied/u);
  assert.doesNotMatch(blockedRouteMessage, /Authorization|cookie|sessionId|synthetic-secret-value/iu);
});

test('planner policy handoff applies SiteHealthExecutionGate before downloader handoff', () => {
  const catalogEntry = createCatalogEntry();
  const healthRecovery = {
    report: {
      siteId: 'example',
      status: 'degraded',
      risks: [{
        type: 'rate-limited',
        affectedCapability: 'post.write',
      }],
      affectedCapabilities: ['post.write'],
      capabilityHealth: [
        { capability: 'profile.read', status: 'healthy', risks: [], actions: [] },
        { capability: 'post.write', status: 'healthy', risks: ['rate-limited'], actions: ['switch-to-readonly-mode'] },
      ],
      recommendedActions: ['switch-to-readonly-mode'],
    },
  };

  const allowed = createPlannerPolicyHandoff({
    catalogEntry,
    catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(catalogEntry),
    taskIntent: {
      siteKey: 'example',
      taskType: 'archive-items',
      id: 'profile-read',
      capability: 'profile.read',
      mode: 'read',
    },
    healthRecovery,
  });

  assert.equal(allowed.taskList.items[0].healthGate.allowed, true);
  assert.equal(allowed.taskList.items[0].healthGate.mode, 'readonly');
  assert.equal(allowed.taskList.items[0].healthGate.artifactWriteAllowed, false);

  assert.throws(
    () => createPlannerPolicyHandoff({
      catalogEntry,
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(catalogEntry),
      taskIntent: {
        siteKey: 'example',
        taskType: 'archive-items',
        id: 'post-write',
        capability: 'post.write',
        mode: 'write',
      },
      healthRecovery,
    }),
    /blocked by SiteHealthExecutionGate: readonly-mode/u,
  );
});

test('planner policy handoff rejects blocked health gates before artifact writes', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-policy-health-gate-blocked-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const handoffPath = path.join(tempDir, 'planner-handoff.json');
  const auditPath = path.join(tempDir, 'planner-handoff.audit.json');

  await assert.rejects(
    writePlannerPolicyHandoffArtifact({
      catalogEntry: createCatalogEntry(),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: {
        siteKey: 'example',
        taskType: 'archive-items',
        id: 'post-write',
        capability: 'post.write',
        mode: 'write',
      },
      healthRecovery: {
        report: {
          siteId: 'example',
          status: 'blocked',
          risks: [{
            type: 'login-required',
            affectedCapability: 'post.write',
          }],
          recommendedActions: ['require-user-action', 'safe-stop'],
        },
      },
    }, {
      handoffPath,
      redactionAuditPath: auditPath,
    }),
    /blocked by SiteHealthExecutionGate/u,
  );
  await assert.rejects(access(handoffPath), /ENOENT/u);
  await assert.rejects(access(auditPath), /ENOENT/u);
});

test('planner policy handoff uses schema governance facade for catalog and standard products', async () => {
  const source = await readFile(
    new URL('../../src/sites/capability/planner-policy-handoff.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /function assertPlannerPolicyHandoffWriterCompatibility/u);
  assert.match(source, /function assertPlannerPolicyRuntimeHandoffCompatibility/u);
  assert.match(source, /assertPlannerPolicyHandoffWriterCompatibility\(\{/u);
  assert.match(source, /assertPlannerPolicyRuntimeHandoffCompatibility\(handoff\)/u);
  assert.match(source, /assertGovernedSchemaCompatible\('ApiCatalogEntry', catalogEntry\)/u);
  assert.match(source, /assertGovernedSchemaCompatible\('DownloadPolicy', downloadPolicy\)/u);
  assert.match(source, /assertGovernedSchemaCompatible\('StandardTaskList', taskList\)/u);
  assert.match(source, /assertTrustBoundaryCrossing/u);
  assert.match(source, /from: 'api-catalog'/u);
  assert.match(source, /to: 'downloader'/u);
  assert.match(source, /'redacted', 'minimized', 'permission-checked'/u);
});

test('planner policy handoff explicit writer compatibility gate fails closed', () => {
  const handoff = createPlannerPolicyHandoff({
    catalogEntry: createCatalogEntry(),
    catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
    taskIntent: {
      siteKey: 'example',
      taskType: 'archive-items',
      id: 'task-item-1',
    },
  });

  assert.equal(assertPlannerPolicyHandoffWriterCompatibility({
    catalogEntry: createCatalogEntry(),
    downloadPolicy: handoff.downloadPolicy,
    taskList: handoff.taskList,
  }), true);
  assert.throws(
    () => assertPlannerPolicyHandoffWriterCompatibility({
      catalogEntry: createCatalogEntry(),
      downloadPolicy: {
        ...handoff.downloadPolicy,
        schemaVersion: DOWNLOAD_POLICY_SCHEMA_VERSION + 1,
      },
      taskList: handoff.taskList,
    }),
    /DownloadPolicy schemaVersion 2 is not compatible/u,
  );
  assert.throws(
    () => assertPlannerPolicyHandoffWriterCompatibility({
      catalogEntry: createCatalogEntry(),
      downloadPolicy: handoff.downloadPolicy,
      taskList: {
        ...handoff.taskList,
        policyRef: 'browser-profile:synthetic-ref',
      },
    }),
    /must not expose raw browser-profile-ref/u,
  );
  assert.throws(
    () => assertPlannerPolicyHandoffWriterCompatibility({
      catalogEntry: createCatalogEntry(),
      downloadPolicy: {
        ...handoff.downloadPolicy,
        storageStateRef: 'storage-state:synthetic-ref',
      },
      taskList: handoff.taskList,
    }),
    /must not expose raw storageStateRef/u,
  );
});

test('planner policy runtime handoff compatibility gate fails closed', () => {
  const handoff = createPlannerPolicyHandoff({
    catalogEntry: createCatalogEntry(),
    catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
    taskIntent: {
      siteKey: 'example',
      taskType: 'archive-items',
      id: 'task-item-1',
    },
  });

  assert.equal(assertPlannerPolicyRuntimeHandoffCompatibility(handoff), true);
  assert.throws(
    () => assertPlannerPolicyRuntimeHandoffCompatibility({
      ...handoff,
      taskList: {
        ...handoff.taskList,
        schemaVersion: STANDARD_TASK_LIST_SCHEMA_VERSION + 1,
      },
    }),
    /StandardTaskList schemaVersion 2 is not compatible/u,
  );
  assert.throws(
    () => assertPlannerPolicyRuntimeHandoffCompatibility({
      ...handoff,
      downloadPolicy: {
        ...handoff.downloadPolicy,
        schemaVersion: DOWNLOAD_POLICY_SCHEMA_VERSION + 1,
      },
    }),
    /DownloadPolicy schemaVersion 2 is not compatible/u,
  );
  assert.throws(
    () => assertPlannerPolicyRuntimeHandoffCompatibility({
      ...handoff,
      taskList: {
        ...handoff.taskList,
        policyRef: 'raw-session:synthetic-ref',
      },
    }),
    /must not expose raw session-ref/u,
  );
  assert.throws(
    () => assertPlannerPolicyRuntimeHandoffCompatibility({
      ...handoff,
      diagnostic: 'sid=synthetic-runtime-session',
    }),
    /raw sensitive material/u,
  );
});

test('planner policy handoff rejects inactive catalog entries and site mismatches', () => {
  assert.throws(
    () => createPlannerPolicyHandoff({
      catalogEntry: createCatalogEntry({ status: 'blocked', invalidationStatus: 'blocked' }),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: { taskType: 'archive-items' },
    }),
    /requires a cataloged ApiCatalogEntry/u,
  );
  assert.throws(
    () => createPlannerPolicyHandoff({
      catalogEntry: createCatalogEntry({ invalidationStatus: 'stale' }),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: { taskType: 'archive-items' },
    }),
    /requires an active ApiCatalogEntry/u,
  );
  assert.throws(
    () => createPlannerPolicyHandoff({
      catalogEntry: createCatalogEntry(),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: { siteKey: 'other-site', taskType: 'archive-items' },
    }),
    /site mismatch/u,
  );
});

test('planner policy catalog gate blocks observed and candidate API knowledge', () => {
  for (const status of ['observed', 'candidate']) {
    const catalogEntry = createCatalogEntry({
      candidateId: `synthetic-${status}-planner-list`,
    });
    const blockedDecision = createBlockedCatalogUpgradeDecision(catalogEntry, status);

    assert.equal(blockedDecision.decision, 'blocked');
    assert.equal(blockedDecision.requirements.candidateStatus, status);
    assert.equal(blockedDecision.requirements.candidateVerified, false);
    assert.throws(
      () => createPlannerPolicyHandoff({
        catalogEntry,
        catalogUpgradeDecision: blockedDecision,
        taskIntent: {
          siteKey: 'example',
          taskType: 'archive-items',
        },
      }),
      /does not allow catalog entry: api-catalog-entry-blocked/u,
    );
    assert.throws(
      () => createPlannerPolicyHandoff({
        catalogEntry,
        catalogUpgradeDecision: {
          ...blockedDecision,
          decision: 'allowed',
          canEnterCatalog: true,
          catalogAction: 'catalog',
        },
        taskIntent: {
          siteKey: 'example',
          taskType: 'archive-items',
        },
      }),
      /requires verified ApiCandidate catalog gate/u,
    );
  }
});

test('planner policy handoff rejects raw session, credential, and profile containers', () => {
  assert.throws(
    () => createPlannerPolicyHandoff({
      catalogEntry: createCatalogEntry({
        auth: {
          authorization: 'Bearer synthetic-planner-token',
        },
      }),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: { taskType: 'archive-items' },
    }),
    /must not expose raw authorization/u,
  );
  assert.throws(
    () => createPlannerPolicyHandoff({
      catalogEntry: createCatalogEntry(),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: {
        taskType: 'archive-items',
        headers: {
          authorization: 'Bearer synthetic-planner-token',
        },
      },
    }),
    /must not expose raw headers/u,
  );
  assert.throws(
    () => createPlannerPolicyHandoff({
      catalogEntry: createCatalogEntry(),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      policy: {
        sessionId: 'synthetic-session-id',
      },
    }),
    /must not expose raw sessionId/u,
  );
  assert.throws(
    () => createPlannerPolicyHandoff({
      catalogEntry: createCatalogEntry(),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: {
        browserProfile: 'synthetic-profile',
      },
    }),
    /must not expose raw browserProfile/u,
  );
  assert.throws(
    () => createPlannerPolicyHandoff({
      catalogEntry: createCatalogEntry({
        auth: {
          profileRef: 'browser-profile:synthetic-ref',
        },
      }),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: { taskType: 'archive-items' },
    }),
    /must not expose raw profileRef/u,
  );
  assert.throws(
    () => createPlannerPolicyHandoff({
      catalogEntry: createCatalogEntry(),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: {
        taskType: 'archive-items',
        cacheKey: 'credential-ref:synthetic-ref',
      },
    }),
    /must not expose raw credential-ref/u,
  );
});

test('planner policy handoff writer persists redacted artifacts without downloader execution', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-policy-handoff-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const handoffPath = path.join(tempDir, 'planner-handoff.json');
  const auditPath = path.join(tempDir, 'planner-handoff.audit.json');

  const result = await writePlannerPolicyHandoffArtifact({
    catalogEntry: createCatalogEntry(),
    catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
    taskIntent: {
      siteKey: 'example',
      taskType: 'archive-items',
      id: 'task-item-1',
    },
    policy: {
      retries: 1,
    },
  }, {
    handoffPath,
    redactionAuditPath: auditPath,
  });

  assert.equal(result.artifactPath, handoffPath);
  assert.equal(result.redactionAuditPath, auditPath);
  assert.equal(result.handoff.taskList.schemaVersion, STANDARD_TASK_LIST_SCHEMA_VERSION);
  assert.equal(result.handoff.downloadPolicy.schemaVersion, DOWNLOAD_POLICY_SCHEMA_VERSION);
  assert.equal(result.handoff.downloadPolicy.allowNetworkResolve, false);

  const handoffJson = await readFile(handoffPath, 'utf8');
  const auditJson = await readFile(auditPath, 'utf8');
  assert.doesNotMatch(handoffJson, /synthetic-planner-token|authorization|cookie|csrf|sessionId|browserProfile/iu);
  assert.doesNotMatch(auditJson, /synthetic-planner-token|authorization|cookie|csrf|sessionId|browserProfile/iu);
  const persisted = JSON.parse(handoffJson);
  assert.equal(persisted.taskList.items[0].endpoint.includes('access_token='), true);
  assert.equal(persisted.downloadPolicy.dryRun, true);
});

test('verified synthetic catalog fixture enters planner policy handoff through policy gate', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-policy-verified-fixture-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const storeDir = path.join(tempDir, 'store');
  const handoffPath = path.join(tempDir, 'planner', 'planner-handoff.json');
  const handoffAuditPath = path.join(tempDir, 'planner', 'planner-handoff.audit.json');
  const candidate = {
    schemaVersion: API_CANDIDATE_SCHEMA_VERSION,
    id: 'verified-planner-catalog-fixture',
    siteKey: 'verified-planner-site',
    status: 'verified',
    endpoint: {
      method: 'GET',
      url: 'https://verified-planner.invalid/api/items?access_token=synthetic-verified-planner-token&cursor=1',
    },
    auth: {
      authorization: 'Bearer synthetic-verified-planner-token',
    },
    request: {
      headers: {
        authorization: 'Bearer synthetic-verified-planner-token',
        accept: 'application/json',
      },
    },
    pagination: {
      type: 'cursor',
      cursorField: 'nextCursor',
      pageSize: 25,
    },
    fieldMapping: {
      items: '$.data.items',
    },
  };
  const siteAdapterDecision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'verified-planner-adapter',
    decision: 'accepted',
  }, { candidate });
  const allowPolicy = normalizeSiteAdapterCatalogUpgradePolicy({
    adapterId: 'verified-planner-adapter',
    allowCatalogUpgrade: true,
  }, { candidate, siteAdapterDecision });

  const store = await writeVerifiedApiCatalogUpgradeFixtureArtifacts({
    candidate,
    siteAdapterDecision,
    policy: allowPolicy,
    decidedAt: '2026-05-03T08:10:00.000Z',
    metadata: {
      version: 'verified-planner-fixture-v1',
      verifiedAt: '2026-05-03T08:11:00.000Z',
      lastValidatedAt: '2026-05-03T08:12:00.000Z',
      auth: {
        required: true,
        scheme: 'session-view',
      },
      pagination: {
        type: 'cursor',
        cursorField: 'nextCursor',
        pageSize: 25,
      },
    },
  }, {
    decisionPath: path.join(storeDir, 'decision.json'),
    decisionRedactionAuditPath: path.join(storeDir, 'decision.redaction-audit.json'),
    catalogPath: path.join(storeDir, 'entry.json'),
    catalogRedactionAuditPath: path.join(storeDir, 'entry.redaction-audit.json'),
  });

  const result = await writeCatalogStorePlannerPolicyHandoffArtifact(store, {
    taskIntent: {
      siteKey: 'verified-planner-site',
      taskType: 'fixture-items',
      id: 'verified-planner-task-1',
    },
    policy: {
      retries: 1,
      retryBackoffMs: 125,
    },
  }, {
    handoffPath,
    redactionAuditPath: handoffAuditPath,
  });

  assert.equal(result.handoff.catalogEntryId, 'verified-planner-catalog-fixture');
  assert.deepEqual(result.handoff.catalogGate.requirements, {
    candidateStatus: 'verified',
    candidateVerified: true,
    siteAdapterDecision: 'accepted',
    siteAdapterAccepted: true,
    policyAllowsCatalogUpgrade: true,
  });
  assert.equal(result.handoff.downloadPolicy.sessionRequirement, 'required');
  assert.equal(result.handoff.downloadPolicy.allowNetworkResolve, false);
  assert.equal(result.handoff.taskList.items[0].pagination.pageSize, 25);
  assert.equal(result.handoff.taskList.items[0].endpoint.includes('synthetic-verified-planner-token'), false);
  for (const filePath of [handoffPath, handoffAuditPath]) {
    const text = await readFile(filePath, 'utf8');
    assert.doesNotMatch(text, /synthetic-verified-planner-token|authorization|cookie|csrf|sessionId|browserProfile/iu);
  }
});

test('planner policy handoff writer consumes catalog store results without downloader execution', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-policy-catalog-store-handoff-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const handoffPath = path.join(tempDir, 'planner-handoff.json');
  const auditPath = path.join(tempDir, 'planner-handoff.audit.json');
  const result = await writeCatalogStorePlannerPolicyHandoffArtifact({
    catalogEntry: {
      entry: createCatalogEntry(),
    },
    upgradeDecision: {
      decision: createAllowedCatalogUpgradeDecision(),
    },
  }, {
    taskIntent: {
      siteKey: 'example',
      taskType: 'catalog-backed-download',
      id: 'catalog-store-task-1',
    },
    policy: {
      retries: 1,
      retryBackoffMs: 250,
    },
  }, {
    handoffPath,
    redactionAuditPath: auditPath,
  });

  assert.equal(result.handoff.catalogEntryId, 'candidate-synthetic-planner-list');
  assert.equal(result.handoff.taskList.items[0].id, 'catalog-store-task-1');
  assert.equal(result.handoff.downloadPolicy.allowNetworkResolve, false);
  assert.equal(result.handoff.downloadPolicy.sessionRequirement, 'required');
  assert.equal(JSON.stringify(result).includes('synthetic-planner-token'), false);
  await assert.rejects(
    writeCatalogStorePlannerPolicyHandoffArtifact({}, {
      taskIntent: { taskType: 'catalog-backed-download' },
    }, {
      handoffPath: path.join(tempDir, 'missing.json'),
      redactionAuditPath: path.join(tempDir, 'missing.audit.json'),
    }),
    /catalog store entry must be an object/u,
  );
});

test('planner policy handoff writer fails closed before partial writes', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-policy-handoff-fail-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const handoffPath = path.join(tempDir, 'planner-handoff.json');
  const auditPath = path.join(tempDir, 'planner-handoff.audit.json');
  const missingAuditPath = path.join(tempDir, 'missing-audit-handoff.json');

  await assert.rejects(
    writePlannerPolicyHandoffArtifact({
      catalogEntry: createCatalogEntry(),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: {
        siteKey: 'example',
        taskType: 'archive-items',
      },
    }, {
      handoffPath: missingAuditPath,
    }),
    /PlannerPolicyHandoff redactionAuditPath is required/u,
  );
  await assert.rejects(access(missingAuditPath), /ENOENT/u);

  await assert.rejects(
    writePlannerPolicyHandoffArtifact({
      catalogEntry: createCatalogEntry(),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: {
        taskType: 'archive-items',
        headers: {
          authorization: 'Bearer synthetic-planner-token',
        },
      },
    }, {
      handoffPath,
      redactionAuditPath: auditPath,
    }),
    /must not expose raw headers/u,
  );
  await assert.rejects(access(handoffPath), /ENOENT/u);
  await assert.rejects(access(auditPath), /ENOENT/u);
});

test('planner policy handoff writer maps schema compatibility failure to reasonCode', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-policy-handoff-schema-fail-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const handoffPath = path.join(tempDir, 'planner-handoff.json');
  const auditPath = path.join(tempDir, 'planner-handoff.audit.json');

  await assert.rejects(
    writePlannerPolicyHandoffArtifact({
      catalogEntry: createCatalogEntry({
        schemaVersion: API_CATALOG_ENTRY_SCHEMA_VERSION + 1,
      }),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: {
        taskType: 'archive-items',
      },
    }, {
      handoffPath,
      redactionAuditPath: auditPath,
    }),
    (error) => {
      assert.equal(error.reasonCode, 'schema-version-incompatible');
      assert.equal(error.retryable, false);
      assert.equal(error.manualRecoveryNeeded, true);
      assert.equal(error.artifactWriteAllowed, false);
      assert.equal(error.failureMode, 'schema-compatibility');
      assert.deepEqual(error.causeSummary, {
        reasonCode: 'schema-version-incompatible',
        message: 'schema compatibility failure',
      });
      assert.doesNotMatch(JSON.stringify(error), /synthetic-planner-token|authorization|cookie|csrf|sessionId/iu);
      return true;
    },
  );
  await assert.rejects(access(handoffPath), /ENOENT/u);
  await assert.rejects(access(auditPath), /ENOENT/u);
});

test('planner policy handoff writer fails closed on downstream policy incompatibility before writes', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-policy-handoff-policy-schema-fail-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const handoffPath = path.join(tempDir, 'planner-handoff.json');
  const auditPath = path.join(tempDir, 'planner-handoff.audit.json');

  await assert.rejects(
    writePlannerPolicyHandoffArtifact({
      catalogEntry: createCatalogEntry(),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: {
        taskType: 'archive-items',
      },
      policy: {
        schemaVersion: DOWNLOAD_POLICY_SCHEMA_VERSION + 1,
      },
    }, {
      handoffPath,
      redactionAuditPath: auditPath,
    }),
    (error) => {
      assert.equal(error.reasonCode, 'schema-version-incompatible');
      assert.equal(error.artifactWriteAllowed, false);
      assert.equal(error.failureMode, 'schema-compatibility');
      assert.doesNotMatch(JSON.stringify(error), /synthetic-planner-token|authorization|cookie|csrf|sessionId/iu);
      return true;
    },
  );
  await assert.rejects(access(handoffPath), /ENOENT/u);
  await assert.rejects(access(auditPath), /ENOENT/u);
});

test('planner policy handoff writer maps policy generation failure and writes nothing', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-policy-handoff-policy-generation-fail-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const handoffPath = path.join(tempDir, 'planner-handoff.json');
  const auditPath = path.join(tempDir, 'planner-handoff.audit.json');

  await assert.rejects(
    writePlannerPolicyHandoffArtifact({
      catalogEntry: createCatalogEntry(),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: {
        taskType: 'archive-items',
      },
      policy: {
        retries: -1,
      },
    }, {
      handoffPath,
      redactionAuditPath: auditPath,
    }),
    (error) => {
      assert.equal(error.reasonCode, 'download-policy-generation-failed');
      assert.equal(error.retryable, false);
      assert.equal(error.manualRecoveryNeeded, true);
      assert.equal(error.degradable, true);
      assert.equal(error.artifactWriteAllowed, false);
      assert.equal(error.failureMode, 'download-policy-generation');
      assert.deepEqual(error.causeSummary, {
        reasonCode: 'download-policy-generation-failed',
        message: 'download policy generation failure',
      });
      assert.doesNotMatch(JSON.stringify(error), /synthetic-planner-token|authorization|cookie|csrf|sessionId/iu);
      return true;
    },
  );
  await assert.rejects(access(handoffPath), /ENOENT/u);
  await assert.rejects(access(auditPath), /ENOENT/u);
});
