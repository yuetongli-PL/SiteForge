import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { assertSchemaCompatible } from '../../src/domain/schemas/compatibility-registry.mjs';
import {
  assertCapabilityNodeCompatible,
  assertDisabledGraphInventoryRuntimeConsumerResultCompatibility,
  assertGraphDerivedArtifactWriteAllowed,
  assertGraphInventoryCommandDesignCompatibility,
  assertGraphInventoryRepoOutputDryRunCompatibility,
  assertGraphInventoryRuntimeIntegrationDesignCompatibility,
  assertGraphRepoOutputApprovalGateDesignCompatibility,
  assertRiskPolicyNodeCompatible,
  assertSignerNodeCompatible,
  createDisabledGraphInventoryRuntimeConsumerResult,
  createGraphInventoryArtifact,
  createGraphInventoryCommandDesign,
  createGraphInventoryRepoOutputDryRun,
  createGraphInventoryRuntimeIntegrationDesign,
  createGraphRepoOutputApprovalGateDesign,
  generateGraphDocsSummary,
  getGraphCapabilitiesRequiringAuth,
  getGraphRequirements,
  listGraphCapabilities,
  planGraphCapabilityRoute,
  validateSiteCapabilityGraph,
} from '../../src/domain/capabilities/site-capability-graph.mjs';
import * as SiteCapabilityGraph from '../../src/domain/capabilities/site-capability-graph.mjs';
import { assertNoForbiddenPatterns } from '../../src/domain/sessions/security-guard.mjs';

const SITE_CAPABILITIES_URL = new URL('../../config/site-capabilities.json', import.meta.url);
const SITE_REGISTRY_URL = new URL('../../config/site-registry.json', import.meta.url);
const LAYER_SOURCE_INVENTORIES = Object.freeze([
  'config/site-capabilities.json',
  'config/site-registry.json',
]);
const GENERATED_FIXTURE_TEST_ID = 'test:site-capability-graph-generated-fixture';
const GENERATED_FIXTURE_TEST_PATH = 'tests/node/site-capability-graph-generated-fixture.test.mjs';

function captureThrownMessage(action) {
  try {
    action();
  } catch (error) {
    return String(error?.message ?? error);
  }
  throw new Error('Expected action to throw');
}

async function readLayerSiteDescriptor(host) {
  const config = JSON.parse(await readFile(SITE_CAPABILITIES_URL, 'utf8'));
  const descriptor = config?.sites?.[host];
  assert.equal(typeof descriptor, 'object');
  return descriptor;
}

async function readLayerSiteConfigs() {
  const [siteCapabilities, siteRegistry] = await Promise.all([
    readFile(SITE_CAPABILITIES_URL, 'utf8'),
    readFile(SITE_REGISTRY_URL, 'utf8'),
  ]);
  return {
    siteCapabilities: JSON.parse(siteCapabilities),
    siteRegistry: JSON.parse(siteRegistry),
  };
}

function getLayerSourceRiskPolicyInventorySummaryHelper() {
  for (const exportName of [
    'createLayerSourceRiskPolicyInventorySummary',
    'createLayerSourceRiskPolicyNodeInventorySummary',
    'createLayerSourceRiskPolicyInventory',
  ]) {
    if (typeof SiteCapabilityGraph[exportName] === 'function') {
      return SiteCapabilityGraph[exportName];
    }
  }
  assert.fail('Expected a Layer-source RiskPolicyNode inventory summary helper export');
}

function getLayerSourceAuthSessionRequirementInventorySummaryHelpers() {
  const createInventorySummary = SiteCapabilityGraph.createLayerSourceAuthSessionRequirementInventorySummary;
  const assertSummary = SiteCapabilityGraph.assertLayerSourceAuthSessionRequirementInventorySummaryCompatibility;

  assert.equal(
    typeof createInventorySummary,
    'function',
    'Expected createLayerSourceAuthSessionRequirementInventorySummary export',
  );
  assert.equal(
    typeof assertSummary,
    'function',
    'Expected assertLayerSourceAuthSessionRequirementInventorySummaryCompatibility export',
  );

  return { createInventorySummary, assertSummary };
}

function getLayerSourceSignerDependencyInventorySummaryHelpers() {
  const createInventorySummary = SiteCapabilityGraph.createLayerSourceSignerDependencyInventorySummary;
  const assertSummary = SiteCapabilityGraph.assertLayerSourceSignerDependencyInventorySummaryCompatibility;

  assert.equal(
    typeof createInventorySummary,
    'function',
    'Expected createLayerSourceSignerDependencyInventorySummary export',
  );
  assert.equal(
    typeof assertSummary,
    'function',
    'Expected assertLayerSourceSignerDependencyInventorySummaryCompatibility export',
  );

  return { createInventorySummary, assertSummary };
}

function collectLayerConfigHosts(siteCapabilities, siteRegistry) {
  return [...new Set([
    ...Object.keys(siteCapabilities?.sites ?? {}),
    ...Object.keys(siteRegistry?.sites ?? {}),
  ])].sort();
}

function expectedDownloadSessionRequirementForHost(siteRegistry, host) {
  const value = siteRegistry?.sites?.[host]?.downloadSessionRequirement;
  return ['required', 'optional', 'none'].includes(value) ? value : 'none';
}

function findInventoryItem(items, host, type) {
  return items.find((item) => item.host === host && item.type === type);
}

function getSummaryItems(summary) {
  assert.equal(typeof summary, 'object');
  assert.equal(Array.isArray(summary.items), true);
  return summary.items;
}

function itemReferencesHost(item, host) {
  const sanitizedHost = host.replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/gu, '');
  const text = JSON.stringify(item);
  return text.includes(host) || text.includes(sanitizedHost);
}

function assertNoEnabledRuntimeInventoryFields(value) {
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') {
      continue;
    }
    for (const [fieldName, fieldValue] of Object.entries(current)) {
      if ([
        'repoWriteEnabled',
        'runtimeGenerationEnabled',
        'runtimeArtifactWriteEnabled',
        'runtimeRiskTransitionEnabled',
        'riskStateMachineEnabled',
      ].includes(fieldName)) {
        assert.equal(fieldValue, false, `${fieldName} must remain disabled`);
      }
      if (fieldValue && typeof fieldValue === 'object') {
        stack.push(fieldValue);
      }
    }
  }
}

function assertDescriptorOnlyAuthSessionInventoryItem(item) {
  assert.equal(item.schemaVersion, 1);
  assert.equal(typeof item.id, 'string');
  assert.equal(typeof item.host, 'string');
  assert.equal(typeof item.siteKey, 'string');
  assert.equal(typeof item.downloadSessionRequirement, 'string');
  assert.notEqual(item.descriptorOnly, false);
  assert.ok(item.runtimeGenerationEnabled === undefined || item.runtimeGenerationEnabled === false);
  assert.ok(item.repoWriteEnabled === undefined || item.repoWriteEnabled === false);
  assert.ok(item.sessionMaterializationEnabled === undefined || item.sessionMaterializationEnabled === false);
  assert.ok(item.runtimeArtifactWriteEnabled === undefined || item.runtimeArtifactWriteEnabled === false);
  assert.ok(item.credentialMaterializationEnabled === undefined || item.credentialMaterializationEnabled === false);
  assert.deepEqual(
    [...item.sourceRefs].sort(),
    [...LAYER_SOURCE_INVENTORIES].sort(),
  );
  assert.equal(new Set(item.sourceRefs).size, item.sourceRefs.length);
}

function assertDescriptorOnlySignerDependencyInventoryItem(item) {
  assert.equal(item.schemaVersion, 1);
  assert.equal(item.type, 'SignerNode');
  assert.equal(typeof item.id, 'string');
  assert.equal(typeof item.host, 'string');
  assert.equal(typeof item.siteKey, 'string');
  assert.equal(typeof item.signerKind, 'string');
  assert.equal(typeof item.versionRef, 'string');
  assert.equal(Array.isArray(item.supportedEndpointRefs), true);
  assert.notEqual(item.descriptorOnly, false);
  assert.ok(item.runtimeSignerExecutionEnabled === undefined || item.runtimeSignerExecutionEnabled === false);
  assert.ok(item.runtimeGenerationEnabled === undefined || item.runtimeGenerationEnabled === false);
  assert.ok(item.repoWriteEnabled === undefined || item.repoWriteEnabled === false);
  assert.ok(item.runtimeArtifactWriteEnabled === undefined || item.runtimeArtifactWriteEnabled === false);
  assert.ok(item.sessionMaterializationEnabled === undefined || item.sessionMaterializationEnabled === false);
  assert.ok(item.credentialMaterializationEnabled === undefined || item.credentialMaterializationEnabled === false);
  assert.deepEqual(
    [...item.sourceRefs].sort(),
    [...LAYER_SOURCE_INVENTORIES].sort(),
  );
  assert.equal(new Set(item.sourceRefs).size, item.sourceRefs.length);
}

function createGeneratedSyntheticGraphFromLayerDescriptor(descriptor) {
  const siteKey = descriptor.siteKey;
  const host = descriptor.host;
  const capabilityFamily = descriptor.capabilityFamilies.find((family) => family === 'navigate-to-content');
  const graphVersion = 'synthetic-generated-from-layer-v1';
  const adapterVersion = 'synthetic-adapter-v1';
  const siteId = `site:${siteKey}`;
  const capabilityId = `capability:${siteKey}:navigate-to-content`;
  const routeId = `route:${siteKey}:public-content`;
  const riskPolicyId = `risk-policy:${siteKey}:normal-readonly`;

  assert.equal(host, 'www.qidian.com');
  assert.equal(siteKey, 'qidian');
  assert.equal(capabilityFamily, 'navigate-to-content');

  return {
    schemaVersion: 1,
    graphVersion,
    manifest: {
      schemaVersion: 1,
      graphSchemaVersion: 1,
      graphDataVersion: graphVersion,
      layerCompatibility: {
        kernelCompatibilityVersion: 'synthetic-kernel-v1',
        siteAdapterVersion: adapterVersion,
        downloaderCompatibilityVersion: 'synthetic-downloader-v1',
      },
      sourceInventories: [...LAYER_SOURCE_INVENTORIES],
    },
    nodes: [
      {
        schemaVersion: 1,
        id: siteId,
        type: 'SiteNode',
        siteKey,
        hostFamily: [host],
        adapterRef: {
          id: descriptor.adapterId,
          version: adapterVersion,
        },
      },
      {
        schemaVersion: 1,
        id: capabilityId,
        type: 'CapabilityNode',
        siteKey,
        capabilityKey: 'navigate-to-content',
        capabilityFamily,
        mode: 'readOnly',
        requiresApproval: false,
        supportedTaskTypes: ['open-page'],
        routeRefs: [routeId],
        riskPolicyRef: riskPolicyId,
        sourceRefs: ['config/site-capabilities.json'],
        testEvidenceRefs: [GENERATED_FIXTURE_TEST_ID],
      },
      {
        schemaVersion: 1,
        id: routeId,
        type: 'RouteNode',
        siteKey,
        routeKind: 'page',
        urlPattern: `${descriptor.baseUrl}:path`,
        pageType: descriptor.primaryArchetype,
        capabilityRefs: [capabilityId],
        adapterRef: {
          id: descriptor.adapterId,
          version: adapterVersion,
        },
        riskPolicyRef: riskPolicyId,
        sourceRefs: ['config/site-capabilities.json'],
        testEvidenceRefs: [GENERATED_FIXTURE_TEST_ID],
      },
      {
        schemaVersion: 1,
        id: riskPolicyId,
        type: 'RiskPolicyNode',
        state: 'normal',
        allowedActions: ['read'],
        blockedActions: ['write'],
        requiresApproval: false,
        cooldownRequired: false,
        isolationRequired: false,
        manualRecoveryRequired: false,
        degradable: true,
        artifactWriteAllowed: true,
        sourceRefs: [...LAYER_SOURCE_INVENTORIES],
        reasonCodeRefs: [],
      },
      {
        schemaVersion: 1,
        id: 'schema:GraphDocsSummary',
        type: 'SchemaNode',
        schemaName: 'GraphDocsSummary',
        governedVersion: 1,
        owner: 'Capability',
        sourcePath: 'src/domain/capabilities/site-capability-graph.mjs',
      },
      {
        schemaVersion: 1,
        id: 'artifact:generated-graph-docs-summary',
        type: 'ArtifactContractNode',
        artifactFamily: 'site-capability-graph-docs',
        redactionRequired: true,
        schemaRef: 'schema:GraphDocsSummary',
        writeGuard: 'SecurityGuard/Redaction',
        auditRequired: true,
      },
      {
        schemaVersion: 1,
        id: GENERATED_FIXTURE_TEST_ID,
        type: 'TestEvidenceNode',
        testPath: GENERATED_FIXTURE_TEST_PATH,
        command: `node --test ${GENERATED_FIXTURE_TEST_PATH}`,
        result: 'generated-layer-descriptor-fixture-compatible',
        fixtureType: 'synthetic-redacted',
      },
      {
        schemaVersion: 1,
        id: `version:${graphVersion}`,
        type: 'VersionNode',
        versionKind: 'graphDataVersion',
        version: graphVersion,
      },
      {
        schemaVersion: 1,
        id: 'failure:graph-schema-invalid',
        type: 'FailureModeNode',
        reasonCode: 'graph-schema-invalid',
        retryable: false,
        cooldownRequired: false,
        isolationRequired: false,
        manualRecoveryRequired: true,
        degradable: false,
        artifactWriteAllowed: false,
      },
      {
        schemaVersion: 1,
        id: 'observability:generated-graph-validation',
        type: 'ObservabilityNode',
        eventName: 'graph.validation.completed',
        requiredFields: [
          'traceId',
          'correlationId',
          'graphVersion',
          'schemaVersion',
          'validationResult',
        ],
        producerRefs: [GENERATED_FIXTURE_TEST_ID],
      },
    ],
    edges: [
      {
        schemaVersion: 1,
        id: `edge:${siteKey}:declares:navigate-to-content`,
        type: 'site_declares_capability',
        from: siteId,
        to: capabilityId,
        sourceRefs: ['config/site-capabilities.json'],
        testEvidenceRefs: [GENERATED_FIXTURE_TEST_ID],
      },
      {
        schemaVersion: 1,
        id: `edge:${siteKey}:capability:route`,
        type: 'capability_exposed_on_route',
        from: capabilityId,
        to: routeId,
        testEvidenceRefs: [GENERATED_FIXTURE_TEST_ID],
      },
      {
        schemaVersion: 1,
        id: `edge:${siteKey}:capability:risk`,
        type: 'capability_guarded_by_risk_policy',
        from: capabilityId,
        to: riskPolicyId,
        testEvidenceRefs: [GENERATED_FIXTURE_TEST_ID],
      },
      {
        schemaVersion: 1,
        id: `edge:${siteKey}:artifact:redaction`,
        type: 'artifact_guarded_by_redaction',
        from: 'artifact:generated-graph-docs-summary',
        to: 'schema:GraphDocsSummary',
        testEvidenceRefs: [GENERATED_FIXTURE_TEST_ID],
      },
      {
        schemaVersion: 1,
        id: `edge:${siteKey}:capability:test`,
        type: 'node_covered_by_test',
        from: capabilityId,
        to: GENERATED_FIXTURE_TEST_ID,
        testEvidenceRefs: [GENERATED_FIXTURE_TEST_ID],
      },
    ],
  };
}

function createGeneratedAuthRequiredReadGraphFromLayerDescriptor(descriptor) {
  const graph = createGeneratedSyntheticGraphFromLayerDescriptor(descriptor);
  const siteKey = descriptor.siteKey;
  const capabilityId = `capability:${siteKey}:navigate-to-content`;
  const authRequirementId = `auth:${siteKey}:read-login-state`;
  const sessionRequirementId = `session:${siteKey}:minimal-read-view`;
  const capability = graph.nodes.find((node) => node.id === capabilityId);

  assert.equal(typeof capability, 'object');
  capability.authRequirementRefs = [authRequirementId];
  capability.sessionRequirementRefs = [sessionRequirementId];
  capability.supportedTaskTypes = ['open-authenticated-page'];

  graph.nodes.push(
    {
      schemaVersion: 1,
      id: authRequirementId,
      type: 'AuthRequirementNode',
      // @ts-ignore
      authKind: 'login-state',
      requiredFor: [capabilityId],
      proofType: 'redacted-session-view',
      allowedMaterial: ['session-view-descriptor'],
      forbiddenMaterial: ['raw-cookie', 'raw-authorization-header', 'raw-session-id'],
      reasonCodeRefs: ['graph-planner-context-unsatisfied'],
    },
    {
      schemaVersion: 1,
      id: sessionRequirementId,
      type: 'SessionRequirementNode',
      purpose: 'read-authenticated-page',
      scope: 'site',
      ttlClass: 'short',
      permissionClass: 'read',
      profileIsolation: 'required',
      networkContextClass: 'stable',
      auditRequired: true,
      revocationRequired: true,
    },
  );

  graph.edges.push(
    {
      schemaVersion: 1,
      id: `edge:${siteKey}:capability:auth`,
      type: 'capability_requires_auth',
      from: capabilityId,
      to: authRequirementId,
      testEvidenceRefs: [GENERATED_FIXTURE_TEST_ID],
    },
    {
      schemaVersion: 1,
      id: `edge:${siteKey}:capability:session`,
      type: 'capability_requires_session',
      from: capabilityId,
      to: sessionRequirementId,
      testEvidenceRefs: [GENERATED_FIXTURE_TEST_ID],
    },
  );

  return graph;
}

test('generated synthetic graph fixture can be derived from an existing Layer site descriptor', async () => {
  const descriptor = await readLayerSiteDescriptor('www.qidian.com');
  const graph = createGeneratedSyntheticGraphFromLayerDescriptor(descriptor);

  assert.deepEqual(graph.manifest.sourceInventories, LAYER_SOURCE_INVENTORIES);
  assert.equal(assertSchemaCompatible('SiteCapabilityGraph', graph), true);
  assert.equal(assertNoForbiddenPatterns(graph), true);

  const report = validateSiteCapabilityGraph(graph);
  assert.equal(report.result, 'passed');
  assert.deepEqual(report.findings, []);

  const capabilities = listGraphCapabilities(graph, descriptor.siteKey);
  assert.deepEqual(capabilities.items.map((node) => node.id), [
    `capability:${descriptor.siteKey}:navigate-to-content`,
  ]);

  const plan = planGraphCapabilityRoute(graph, capabilities.items[0].id);
  assert.equal(plan.result, 'planned');
  assert.equal(plan.route.id, `route:${descriptor.siteKey}:public-content`);

  const docsSummary = generateGraphDocsSummary(graph);
  assert.equal(docsSummary.redactionRequired, true);
  assert.deepEqual(docsSummary.sections.capabilityList.map((entry) => entry.siteKey), [descriptor.siteKey]);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(docsSummary), true);
});

test('generated synthetic RiskPolicyNode keeps Layer source refs without runtime risk execution', async () => {
  const descriptor = await readLayerSiteDescriptor('www.qidian.com');
  const graph = createGeneratedSyntheticGraphFromLayerDescriptor(descriptor);
  const capabilityId = `capability:${descriptor.siteKey}:navigate-to-content`;
  const riskPolicyId = `risk-policy:${descriptor.siteKey}:normal-readonly`;
  const capability = graph.nodes.find((node) => node.id === capabilityId);
  const riskPolicy = graph.nodes.find((node) => node.id === riskPolicyId);
  const riskEdge = graph.edges.find(
    (edge) => edge.type === 'capability_guarded_by_risk_policy'
      && edge.from === capabilityId
      && edge.to === riskPolicyId,
  );

  assert.equal(typeof capability, 'object');
  assert.equal(typeof riskPolicy, 'object');
  assert.equal(typeof riskEdge, 'object');
  assert.equal(riskPolicy.type, 'RiskPolicyNode');
  assert.equal(capability.riskPolicyRef, riskPolicy.id);
  assert.deepEqual(riskPolicy.sourceRefs, graph.manifest.sourceInventories);
  assert.deepEqual(riskPolicy.sourceRefs, LAYER_SOURCE_INVENTORIES);

  const requirements = getGraphRequirements(graph, capabilityId);
  assert.deepEqual(
    requirements.items
      .filter((node) => node.type === 'RiskPolicyNode')
      .map((node) => ({
        id: node.id,
        state: node.state,
        sourceRefs: node.sourceRefs,
      })),
    [
      {
        id: riskPolicyId,
        state: 'normal',
        sourceRefs: LAYER_SOURCE_INVENTORIES,
      },
    ],
  );

  const docsSummary = generateGraphDocsSummary(graph);
  assert.deepEqual(
    docsSummary.sections.riskPolicySummary
      .filter((entry) => entry.ownerType === 'CapabilityNode')
      .map((entry) => ({
        ownerId: entry.ownerId,
        riskPolicyRef: entry.riskPolicyRef,
        riskState: entry.riskState,
        riskPolicyCapabilityRefs: entry.riskPolicyCapabilityRefs,
      })),
    [
      {
        ownerId: capabilityId,
        riskPolicyRef: riskPolicyId,
        riskState: 'normal',
        riskPolicyCapabilityRefs: [capabilityId],
      },
    ],
  );
  assert.doesNotMatch(
    JSON.stringify([graph, requirements, docsSummary]),
    /RiskStateMachine|risk-state execution|runtime risk transition|runtime risk|Authorization|cookie|sessionId|browserProfile/u,
  );
});

test('generated Layer-source RiskPolicyNode inventory summary covers all config hosts descriptor-only', async () => {
  const { siteCapabilities, siteRegistry } = await readLayerSiteConfigs();
  const expectedHosts = collectLayerConfigHosts(siteCapabilities, siteRegistry);
  const createInventorySummary = getLayerSourceRiskPolicyInventorySummaryHelper();

  assert.ok(expectedHosts.length > 1);
  assert.ok(expectedHosts.includes('www.qidian.com'));

  const summary = createInventorySummary({
    siteCapabilities,
    siteRegistry,
    sourceRefs: LAYER_SOURCE_INVENTORIES,
  });
  const items = getSummaryItems(summary);

  assert.equal(items.length, expectedHosts.length);
  assert.deepEqual(items.map((item) => item.host).sort(), expectedHosts);
  for (const host of expectedHosts) {
    assert.ok(
      items.some((item) => itemReferencesHost(item, host)),
      `expected RiskPolicyNode inventory item for ${host}`,
    );
  }

  for (const item of items) {
    assert.equal(assertRiskPolicyNodeCompatible(item), true);
    assert.equal(item.type, 'RiskPolicyNode');
    assert.equal(typeof item.id, 'string');
    assert.equal(item.schemaVersion, 1);
    assert.equal(typeof item.state, 'string');
    assert.equal(Array.isArray(item.allowedActions), true);
    assert.equal(Array.isArray(item.blockedActions), true);
    assert.equal(typeof item.requiresApproval, 'boolean');
    assert.equal(typeof item.cooldownRequired, 'boolean');
    assert.equal(typeof item.isolationRequired, 'boolean');
    assert.equal(typeof item.manualRecoveryRequired, 'boolean');
    assert.equal(typeof item.degradable, 'boolean');
    assert.equal(typeof item.artifactWriteAllowed, 'boolean');
    assert.deepEqual(
      [...item.sourceRefs].sort(),
      [...LAYER_SOURCE_INVENTORIES].sort(),
    );
    assert.equal(new Set(item.sourceRefs).size, item.sourceRefs.length);
  }

  assertNoEnabledRuntimeInventoryFields(summary);
  assert.doesNotMatch(
    JSON.stringify(summary),
    /profilePath|browserProfile|cookie|csrf|Authorization|sessionId|token|RiskStateMachine|runtime risk transition/iu,
  );
});

test('Layer-source RiskPolicyNode inventory sourceRefs fail closed without echoing sensitive values', async () => {
  const { siteCapabilities, siteRegistry } = await readLayerSiteConfigs();
  const createInventorySummary = getLayerSourceRiskPolicyInventorySummaryHelper();
  const summary = createInventorySummary({
    siteCapabilities,
    siteRegistry,
  });
  const assertSummary = SiteCapabilityGraph.assertLayerSourceRiskPolicyInventorySummaryCompatibility;

  assert.equal(typeof assertSummary, 'function');
  summary.items[0].sourceRefs = [
    'config/site-capabilities.json',
    'Authorization: Bearer synthetic-secret-value',
  ];

  const message = captureThrownMessage(() => assertSummary(summary));
  assert.match(message, /sourceRefs contains unsupported Layer config source/u);
  assert.doesNotMatch(message, /Authorization|Bearer|synthetic-secret-value/u);
});

test('Layer-source RiskPolicyNode inventory rejects runtime and write fields descriptor-only', async () => {
  const { siteCapabilities, siteRegistry } = await readLayerSiteConfigs();
  const createInventorySummary = getLayerSourceRiskPolicyInventorySummaryHelper();
  const assertSummary = SiteCapabilityGraph.assertLayerSourceRiskPolicyInventorySummaryCompatibility;

  for (const [fieldName, value] of Object.entries({
    runtimeDispatchEnabled: true,
    repoWriteEnabled: true,
    writePath: 'runs/site-capability-graph/Authorization-Bearer-synthetic-secret-value.json',
  })) {
    const summary = createInventorySummary({
      siteCapabilities,
      siteRegistry,
    });
    summary.items[0][fieldName] = value;

    const message = captureThrownMessage(() => assertSummary(summary));
    assert.match(message, /descriptor-only.*runtime\/write field/u);
    assert.match(message, new RegExp(fieldName, 'u'));
    assert.doesNotMatch(message, /Authorization|Bearer|synthetic-secret-value/u);
  }
});

test('generated Layer-source AuthRequirementNode and SessionRequirementNode inventory covers all config hosts descriptor-only', async () => {
  const { siteCapabilities, siteRegistry } = await readLayerSiteConfigs();
  const expectedHosts = collectLayerConfigHosts(siteCapabilities, siteRegistry);
  const { createInventorySummary, assertSummary } = getLayerSourceAuthSessionRequirementInventorySummaryHelpers();

  assert.ok(expectedHosts.length > 1);
  assert.ok(expectedHosts.includes('www.instagram.com'));
  assert.ok(expectedHosts.includes('www.bilibili.com'));
  assert.ok(expectedHosts.includes('www.bz888888888.com'));

  const summary = createInventorySummary({
    siteCapabilities,
    siteRegistry,
    sourceRefs: LAYER_SOURCE_INVENTORIES,
  });
  const items = getSummaryItems(summary);

  assert.equal(assertSummary(summary), true);
  assert.equal(summary.queryName, 'createLayerSourceAuthSessionRequirementInventorySummary');
  assert.equal(summary.redactionRequired, true);
  assert.equal(items.length, expectedHosts.length * 2);

  for (const host of expectedHosts) {
    const authItem = findInventoryItem(items, host, 'AuthRequirementNode');
    const sessionItem = findInventoryItem(items, host, 'SessionRequirementNode');
    const expectedDownloadSessionRequirement = expectedDownloadSessionRequirementForHost(siteRegistry, host);

    assert.equal(typeof authItem, 'object', `expected AuthRequirementNode inventory item for ${host}`);
    assert.equal(typeof sessionItem, 'object', `expected SessionRequirementNode inventory item for ${host}`);
    assertDescriptorOnlyAuthSessionInventoryItem(authItem);
    assertDescriptorOnlyAuthSessionInventoryItem(sessionItem);
    assert.equal(authItem.downloadSessionRequirement, expectedDownloadSessionRequirement);
    assert.equal(sessionItem.downloadSessionRequirement, expectedDownloadSessionRequirement);
    assert.equal(SiteCapabilityGraph.assertAuthRequirementNodeCompatible(authItem), true);
    assert.equal(SiteCapabilityGraph.assertSessionRequirementNodeCompatible(sessionItem), true);
  }

  assertNoEnabledRuntimeInventoryFields(summary);
  assert.doesNotMatch(
    JSON.stringify(summary),
    /"profilePath"|"browserProfile"|"cookie"|"csrf"|"Authorization"|"sessionId"|"token"|"sessionView"|runtime session material/iu,
  );
});

test('Layer-source AuthRequirementNode and SessionRequirementNode inventory derives required optional and none download sessions', async () => {
  const { siteCapabilities, siteRegistry } = await readLayerSiteConfigs();
  const { createInventorySummary, assertSummary } = getLayerSourceAuthSessionRequirementInventorySummaryHelpers();
  const summary = createInventorySummary({
    siteCapabilities,
    siteRegistry,
    sourceRefs: LAYER_SOURCE_INVENTORIES,
  });
  const items = getSummaryItems(summary);

  assert.equal(assertSummary(summary), true);
  assert.deepEqual(
    [...new Set(items.map((item) => item.downloadSessionRequirement))].sort(),
    ['none', 'optional', 'required'],
  );

  for (const { host, requirement } of [
    { host: 'www.instagram.com', requirement: 'required' },
    { host: 'www.bilibili.com', requirement: 'optional' },
    { host: 'www.bz888888888.com', requirement: 'none' },
  ]) {
    assert.deepEqual(
      items
        .filter((item) => item.host === host)
        .map((item) => [item.type, item.downloadSessionRequirement])
        .sort(),
      [
        ['AuthRequirementNode', requirement],
        ['SessionRequirementNode', requirement],
      ],
    );
  }
});

test('Layer-source AuthRequirementNode and SessionRequirementNode inventory rejects sensitive runtime material without echoing secrets', async () => {
  const { siteCapabilities, siteRegistry } = await readLayerSiteConfigs();
  const { createInventorySummary, assertSummary } = getLayerSourceAuthSessionRequirementInventorySummaryHelpers();
  const syntheticSecret = 'synthetic-secret-value';

  for (const [fieldName, value] of Object.entries({
    cookie: `session=${syntheticSecret}`,
    Authorization: `Bearer ${syntheticSecret}`,
    sessionView: { sessionId: syntheticSecret },
    browserProfile: `profile-${syntheticSecret}`,
    profilePath: `C:/Users/lyt-p/AppData/Profile/${syntheticSecret}`,
    repoWrite: true,
    runtimeGenerationEnabled: true,
    rawSessionMaterial: { token: syntheticSecret },
  })) {
    const createMessage = captureThrownMessage(() => createInventorySummary({
      siteCapabilities,
      siteRegistry,
      sourceRefs: LAYER_SOURCE_INVENTORIES,
      [fieldName]: value,
    }));
    assert.match(createMessage, /descriptor-only|forbidden|must remain false|runtime|sensitive/iu);
    assert.doesNotMatch(createMessage, /synthetic-secret-value/u);

    const summary = createInventorySummary({
      siteCapabilities,
      siteRegistry,
      sourceRefs: LAYER_SOURCE_INVENTORIES,
    });
    summary.items[0][fieldName] = value;

    const compatibilityMessage = captureThrownMessage(() => assertSummary(summary));
    assert.match(compatibilityMessage, /descriptor-only|forbidden|must remain false|runtime|sensitive/iu);
    assert.doesNotMatch(compatibilityMessage, /synthetic-secret-value/u);
  }
});

test('generated Layer-source SignerNode dependency inventory covers all config hosts descriptor-only', async () => {
  const { siteCapabilities, siteRegistry } = await readLayerSiteConfigs();
  const expectedHosts = collectLayerConfigHosts(siteCapabilities, siteRegistry);
  const { createInventorySummary, assertSummary } = getLayerSourceSignerDependencyInventorySummaryHelpers();

  assert.ok(expectedHosts.length > 1);
  assert.ok(expectedHosts.includes('www.bilibili.com'));
  assert.ok(expectedHosts.includes('www.bz888888888.com'));

  const summary = createInventorySummary({
    siteCapabilities,
    siteRegistry,
    sourceRefs: LAYER_SOURCE_INVENTORIES,
  });
  const items = getSummaryItems(summary);

  assert.equal(assertSummary(summary), true);
  assert.equal(summary.queryName, 'createLayerSourceSignerDependencyInventorySummary');
  assert.equal(summary.redactionRequired, true);
  assert.equal(items.length, expectedHosts.length);
  assert.deepEqual(items.map((item) => item.host).sort(), expectedHosts);

  for (const host of expectedHosts) {
    const item = findInventoryItem(items, host, 'SignerNode');

    assert.equal(typeof item, 'object', `expected descriptor-only SignerNode inventory item for ${host}`);
    assertDescriptorOnlySignerDependencyInventoryItem(item);
    assert.equal(assertSignerNodeCompatible(item), true);
  }

  const bilibiliItem = findInventoryItem(items, 'www.bilibili.com', 'SignerNode');
  const noSignerItem = findInventoryItem(items, 'www.bz888888888.com', 'SignerNode');
  assert.match(
    JSON.stringify(bilibiliItem),
    /wbi|signing|required|signer/iu,
    'Bilibili should retain descriptor-only evidence for WBI/signing-required source dependencies',
  );
  assert.match(
    String(bilibiliItem.signerKind),
    /wbi|signing-required|signed-request|descriptor-required/iu,
  );
  assert.match(
    String(noSignerItem.signerKind),
    /none|unsigned|not-required|descriptor-none/iu,
  );
  assert.deepEqual(noSignerItem.supportedEndpointRefs, []);

  assertNoEnabledRuntimeInventoryFields(summary);
  assert.doesNotMatch(
    JSON.stringify(summary),
    /"signedUrl"|"rawSignerKey"|"mixinKey"|"imgKey"|"subKey"|"token"|"Authorization"|"cookie"|"sessionView"|"browserProfile"|"profilePath"|runtime signer execution/iu,
  );
});

test('Layer-source SignerNode dependency inventory rejects signer secrets and runtime execution fields', async () => {
  const { siteCapabilities, siteRegistry } = await readLayerSiteConfigs();
  const { createInventorySummary, assertSummary } = getLayerSourceSignerDependencyInventorySummaryHelpers();
  const syntheticSecret = 'synthetic-secret-value';

  for (const [fieldName, value] of Object.entries({
    signedUrl: `https://example.com/?signature=${syntheticSecret}`,
    rawSignerKey: syntheticSecret,
    mixinKey: syntheticSecret,
    imgKey: syntheticSecret,
    subKey: syntheticSecret,
    token: syntheticSecret,
    Authorization: `Bearer ${syntheticSecret}`,
    cookie: `SESSDATA=${syntheticSecret}`,
    sessionView: { sessionId: syntheticSecret },
    browserProfile: `profile-${syntheticSecret}`,
    profilePath: `C:/Users/lyt-p/AppData/Profile/${syntheticSecret}`,
    repoWrite: true,
    runtimeSignerExecutionEnabled: true,
  })) {
    const createMessage = captureThrownMessage(() => createInventorySummary({
      siteCapabilities,
      siteRegistry,
      sourceRefs: LAYER_SOURCE_INVENTORIES,
      [fieldName]: value,
    }));
    assert.match(createMessage, /descriptor-only|forbidden|must remain false|runtime|sensitive|signer/iu);
    assert.doesNotMatch(createMessage, /synthetic-secret-value/u);

    const summary = createInventorySummary({
      siteCapabilities,
      siteRegistry,
      sourceRefs: LAYER_SOURCE_INVENTORIES,
    });
    summary.items[0][fieldName] = value;

    const compatibilityMessage = captureThrownMessage(() => assertSummary(summary));
    assert.match(compatibilityMessage, /descriptor-only|forbidden|must remain false|runtime|sensitive|signer/iu);
    assert.doesNotMatch(compatibilityMessage, /synthetic-secret-value/u);
  }
});

test('generated synthetic graph fixture covers auth-required read capability requirements', async () => {
  const descriptor = await readLayerSiteDescriptor('www.qidian.com');
  const graph = createGeneratedAuthRequiredReadGraphFromLayerDescriptor(descriptor);

  assert.equal(assertSchemaCompatible('SiteCapabilityGraph', graph), true);
  assert.equal(assertNoForbiddenPatterns(graph), true);

  const report = validateSiteCapabilityGraph(graph);
  assert.equal(report.result, 'passed');
  assert.deepEqual(report.findings, []);

  const capabilityId = `capability:${descriptor.siteKey}:navigate-to-content`;
  assert.deepEqual(
    getGraphCapabilitiesRequiringAuth(graph, descriptor.siteKey).items.map((node) => node.id),
    [capabilityId],
  );

  const requirements = getGraphRequirements(graph, capabilityId);
  assert.deepEqual(requirements.items.map((node) => node.id), [
    `auth:${descriptor.siteKey}:read-login-state`,
    `session:${descriptor.siteKey}:minimal-read-view`,
    `risk-policy:${descriptor.siteKey}:normal-readonly`,
  ]);

  const plan = planGraphCapabilityRoute(graph, capabilityId);
  assert.equal(plan.result, 'planned');
  assert.equal(plan.route.id, `route:${descriptor.siteKey}:public-content`);

  const docsSummary = generateGraphDocsSummary(graph);
  assert.equal(docsSummary.redactionRequired, true);
  assert.deepEqual(docsSummary.sections.authRequirementSummary, [
    {
      capabilityId,
      authRequirementRefs: [`auth:${descriptor.siteKey}:read-login-state`],
      authRequiredForRefs: [capabilityId],
      sessionRequirementRefs: [`session:${descriptor.siteKey}:minimal-read-view`],
    },
  ]);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(docsSummary), true);
});

test('generated synthetic graph fixture creates a guarded graph inventory artifact descriptor', async () => {
  const descriptor = await readLayerSiteDescriptor('www.qidian.com');
  const graph = createGeneratedSyntheticGraphFromLayerDescriptor(descriptor);

  assert.equal(validateSiteCapabilityGraph(graph).result, 'passed');
  assert.equal(assertSchemaCompatible('SiteCapabilityGraph', graph), true);
  const artifact = createGraphInventoryArtifact(graph, {
    inventoryName: 'qidian-generated-graph',
    source: 'config-site-capabilities-qidian',
  });
  assert.equal(assertGraphDerivedArtifactWriteAllowed(artifact), true);
});

test('generated graph inventory artifact rejects unsafe or unredacted descriptors', async () => {
  const descriptor = await readLayerSiteDescriptor('www.qidian.com');
  const graph = createGeneratedSyntheticGraphFromLayerDescriptor(descriptor);

  graph.nodes[0].accessToken = 'synthetic-secret-value';
  assert.throws(
    () => createGraphInventoryArtifact(graph),
    /forbidden field/u,
  );

  const safeGraph = createGeneratedSyntheticGraphFromLayerDescriptor(descriptor);
  const unredactedArtifact = createGraphInventoryArtifact(safeGraph);
  unredactedArtifact.redactionRequired = false;
  assert.throws(
    () => assertGraphDerivedArtifactWriteAllowed(unredactedArtifact),
    /redactionRequired=true/u,
  );
});

test('generated graph inventory command design stays descriptor-only without repo writes', async () => {
  const descriptor = await readLayerSiteDescriptor('www.qidian.com');
  const graph = createGeneratedSyntheticGraphFromLayerDescriptor(descriptor);

  const design = createGraphInventoryCommandDesign(graph, {
    inventoryName: 'qidian-generated-graph',
    source: 'config-site-capabilities-qidian',
  });

  assert.equal(assertGraphInventoryCommandDesignCompatibility(design), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(design), true);
  assert.equal(design.artifactFamily, 'site-capability-graph-inventory-command-design');
  assert.equal(design.redactionRequired, true);
  assert.equal(design.items[0].executionMode, 'design-only');
  assert.equal(design.items[0].runtimeGenerationEnabled, false);
  assert.equal(design.items[0].repoWriteEnabled, false);
  assert.equal(design.items[0].liveArtifactWriteEnabled, false);
  assert.equal(design.items[0].externalCommandEnabled, false);
  assert.equal(design.items[0].requiredArtifactFamily, 'site-capability-graph-inventory');
  assert.equal('requiredPlacementPolicy' in design.items[0], false);
  assert.equal('requiredWriter' in design.items[0], false);
  assert.doesNotMatch(JSON.stringify(design), /createGraphDerivedArtifactPlacement|writeGraphDerivedArtifactPair/u);
  assert.equal(design.items[0].inventoryArtifact.artifactFamily, 'site-capability-graph-inventory');
  assert.equal(design.items[0].inventoryArtifact.redactionRequired, true);
});

test('generated graph inventory command design rejects runtime generation options', async () => {
  const descriptor = await readLayerSiteDescriptor('www.qidian.com');
  const graph = createGeneratedSyntheticGraphFromLayerDescriptor(descriptor);

  assert.throws(
    () => createGraphInventoryCommandDesign(graph, { runtimeGenerationEnabled: true }),
    /runtimeGenerationEnabled must remain false/u,
  );
  assert.throws(
    () => createGraphInventoryCommandDesign(graph, { repoWriteEnabled: true }),
    /repoWriteEnabled must remain false/u,
  );
  assert.throws(
    () => createGraphInventoryCommandDesign(graph, {
      outputPath: 'runs/site-capability-graph/generated.json',
    }),
    /descriptor-only.*outputPath/u,
  );
  assert.throws(
    () => createGraphInventoryCommandDesign(graph, {
      accessToken: 'synthetic-secret-value',
    }),
    /forbidden field/u,
  );
});

test('generated graph inventory runtime integration design stays descriptor-only without repo writes', async () => {
  const descriptor = await readLayerSiteDescriptor('www.qidian.com');
  const graph = createGeneratedSyntheticGraphFromLayerDescriptor(descriptor);

  const design = createGraphInventoryRuntimeIntegrationDesign(graph, {
    inventoryName: 'qidian-generated-graph',
    source: 'config-site-capabilities-qidian',
  });

  assert.equal(assertGraphInventoryRuntimeIntegrationDesignCompatibility(design), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(design), true);
  assert.equal(design.queryName, 'createGraphInventoryRuntimeIntegrationDesign');
  assert.equal(design.artifactFamily, 'site-capability-graph-inventory-runtime-integration-design');
  assert.equal(design.redactionRequired, true);
  assert.equal(design.items[0].integrationMode, 'design-only');
  assert.equal(design.items[0].runtimeGenerationEnabled, false);
  assert.equal(design.items[0].repoWriteEnabled, false);
  assert.equal(design.items[0].runtimeArtifactWriteEnabled, false);
  assert.equal(design.items[0].externalCommandEnabled, false);
  assert.equal(design.items[0].schedulerPublishEnabled, false);
  assert.equal(design.items[0].doctorPublishEnabled, false);
  assert.equal(design.items[0].skillPublishEnabled, false);
  assert.equal(design.items[0].mcpPublishEnabled, false);
  assert.equal(design.items[0].inventoryArtifact.artifactFamily, 'site-capability-graph-inventory');
  assert.equal(design.items[0].inventoryArtifact.redactionRequired, true);
  assert.equal(design.items[0].commandDesign.artifactFamily, 'site-capability-graph-inventory-command-design');
  assert.equal(design.items[0].commandDesign.redactionRequired, true);
});

test('generated graph inventory runtime integration design rejects runtime writes and publish payloads', async () => {
  const descriptor = await readLayerSiteDescriptor('www.qidian.com');
  const graph = createGeneratedSyntheticGraphFromLayerDescriptor(descriptor);

  assert.throws(
    () => createGraphInventoryRuntimeIntegrationDesign(graph, { runtimeGenerationEnabled: true }),
    /runtimeGenerationEnabled must remain false/u,
  );
  assert.throws(
    () => createGraphInventoryRuntimeIntegrationDesign(graph, { repoWriteEnabled: true }),
    /repoWriteEnabled must remain false/u,
  );
  assert.throws(
    () => createGraphInventoryRuntimeIntegrationDesign(graph, { schedulerPublishEnabled: true }),
    /schedulerPublishEnabled must remain false/u,
  );
  assert.throws(
    () => createGraphInventoryRuntimeIntegrationDesign(graph, {
      outputPath: 'runs/site-capability-graph/generated.json',
    }),
    /descriptor-only.*outputPath/u,
  );
  assert.throws(
    () => createGraphInventoryRuntimeIntegrationDesign(graph, {
      schedulerPayload: {},
    }),
    /descriptor-only.*schedulerPayload/u,
  );
  assert.throws(
    () => createGraphInventoryRuntimeIntegrationDesign(graph, {
      sessionView: {},
    }),
    /descriptor-only.*sessionView/u,
  );
  assert.throws(
    () => createGraphInventoryRuntimeIntegrationDesign(graph, {
      userDataDir: 'synthetic-browser-profile-path',
    }),
    /descriptor-only.*userDataDir/u,
  );

  const fieldMessage = captureThrownMessage(() => createGraphInventoryRuntimeIntegrationDesign(graph, {
    inventoryName: 'Bearer synthetic-secret-value',
  }));
  assert.match(fieldMessage, /Forbidden sensitive pattern/u);
  assert.doesNotMatch(fieldMessage, /synthetic-secret-value/u);

  const design = createGraphInventoryRuntimeIntegrationDesign(graph);
  design.items[0].repoWriteEnabled = true;
  assert.throws(
    () => assertGraphInventoryRuntimeIntegrationDesignCompatibility(design),
    /repoWriteEnabled must be false/u,
  );

  const unsafeDesign = createGraphInventoryRuntimeIntegrationDesign(graph);
  unsafeDesign.items[0].inventoryArtifact.redactionRequired = false;
  assert.throws(
    () => assertGraphInventoryRuntimeIntegrationDesignCompatibility(unsafeDesign),
    /inventoryArtifact redactionRequired must be true/u,
  );
});

test('disabled graph inventory runtime consumer returns blocked descriptor without runtime generation', async () => {
  const descriptor = await readLayerSiteDescriptor('www.qidian.com');
  const graph = createGeneratedSyntheticGraphFromLayerDescriptor(descriptor);
  const design = createGraphInventoryRuntimeIntegrationDesign(graph, {
    inventoryName: 'qidian-generated-graph',
    source: 'config-site-capabilities-qidian',
  });

  const result = createDisabledGraphInventoryRuntimeConsumerResult(design);
  const item = result.items[0];

  assert.equal(assertDisabledGraphInventoryRuntimeConsumerResultCompatibility(result), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(result), true);
  assert.equal(result.queryName, 'createDisabledGraphInventoryRuntimeConsumerResult');
  assert.equal(result.artifactFamily, 'site-capability-graph-inventory-runtime-consumer-result');
  assert.equal(result.redactionRequired, true);
  assert.equal(item.consumerMode, 'disabled-feature-flag');
  assert.equal(item.featureEnabled, false);
  assert.equal(item.result, 'blocked');
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(item.reason.code, 'graph-runtime-consumer-disabled');
  assert.equal(item.runtimeGenerationEnabled, false);
  assert.equal(item.repoWriteEnabled, false);
  assert.equal(item.runtimeArtifactWriteEnabled, false);
  assert.equal(item.externalCommandEnabled, false);
  assert.equal(item.schedulerPublishEnabled, false);
  assert.equal(item.doctorPublishEnabled, false);
  assert.equal(item.skillPublishEnabled, false);
  assert.equal(item.mcpPublishEnabled, false);
  assert.equal(item.inventoryArtifact.artifactFamily, 'site-capability-graph-inventory');
  assert.equal(item.inventoryArtifact.redactionRequired, true);
  assert.equal(item.commandDesign.artifactFamily, 'site-capability-graph-inventory-command-design');
  assert.equal(item.commandDesign.redactionRequired, true);
  assert.equal('outputPath' in item, false);
  assert.equal('sessionView' in item, false);
  assert.equal('standardTaskList' in item, false);
});

test('disabled graph inventory runtime consumer rejects enabled flags and runtime payloads', async () => {
  const descriptor = await readLayerSiteDescriptor('www.qidian.com');
  const graph = createGeneratedSyntheticGraphFromLayerDescriptor(descriptor);
  const design = createGraphInventoryRuntimeIntegrationDesign(graph);

  for (const fieldName of [
    'featureEnabled',
    'runtimeGenerationEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
    'schedulerPublishEnabled',
    'doctorPublishEnabled',
    'skillPublishEnabled',
    'mcpPublishEnabled',
  ]) {
    assert.throws(
      () => createDisabledGraphInventoryRuntimeConsumerResult(design, { [fieldName]: true }),
      new RegExp(`${fieldName} must remain false`, 'u'),
    );
  }

  for (const { fieldName, value } of [
    { fieldName: 'outputPath', value: 'runs/site-capability-graph/generated.json' },
    { fieldName: 'inventoryOutputPath', value: 'runs/site-capability-graph/generated.json' },
    { fieldName: 'repoOutputPath', value: 'runs/site-capability-graph/generated.json' },
    { fieldName: 'repoPath', value: 'runs/site-capability-graph' },
    { fieldName: 'writePath', value: 'runs/site-capability-graph/inventory.json' },
    { fieldName: 'artifactPath', value: 'runs/site-capability-graph/inventory.json' },
    { fieldName: 'command', value: 'node tools/generate-graph.mjs' },
    { fieldName: 'shellCommand', value: 'node tools/generate-graph.mjs' },
    { fieldName: 'exec', value: 'node' },
    { fieldName: 'spawn', value: 'node' },
    { fieldName: 'process', value: {} },
    { fieldName: 'handler', value: () => true },
    { fieldName: 'schedulerPayload', value: {} },
    { fieldName: 'doctorPayload', value: {} },
    { fieldName: 'skillPayload', value: {} },
    { fieldName: 'mcpPayload', value: {} },
    { fieldName: 'sessionView', value: {} },
    { fieldName: 'standardTaskList', value: [] },
    { fieldName: 'taskList', value: [] },
    { fieldName: 'downloadPolicy', value: {} },
    { fieldName: 'browserProfile', value: 'synthetic-browser-profile' },
    { fieldName: 'profilePath', value: 'synthetic-browser-profile-path' },
    { fieldName: 'userDataDir', value: 'synthetic-user-data-dir' },
  ]) {
    assert.throws(
      () => createDisabledGraphInventoryRuntimeConsumerResult(design, { [fieldName]: value }),
      new RegExp(`descriptor-only.*${fieldName}`, 'u'),
    );
  }

  const enabledRuntimeResult = createDisabledGraphInventoryRuntimeConsumerResult(design);
  enabledRuntimeResult.items[0].runtimeGenerationEnabled = true;
  assert.throws(
    () => assertDisabledGraphInventoryRuntimeConsumerResultCompatibility(enabledRuntimeResult),
    /runtimeGenerationEnabled must be false/u,
  );

  const unsafeArtifactResult = createDisabledGraphInventoryRuntimeConsumerResult(design);
  unsafeArtifactResult.items[0].inventoryArtifact.redactionRequired = false;
  assert.throws(
    () => assertDisabledGraphInventoryRuntimeConsumerResultCompatibility(unsafeArtifactResult),
    /inventoryArtifact redactionRequired must be true/u,
  );
});

test('generated graph inventory repo output dry-run previews contained target without repo writes', async () => {
  const descriptor = await readLayerSiteDescriptor('www.qidian.com');
  const graph = createGeneratedSyntheticGraphFromLayerDescriptor(descriptor);
  const targetRelativePath = 'runs/site-capability-graph/qidian-generated-graph-dry-run.json';

  await assert.rejects(access(path.join(process.cwd(), targetRelativePath)), /ENOENT/u);

  const result = createGraphInventoryRepoOutputDryRun(graph, {
    inventoryName: 'qidian-generated-graph',
    source: 'config-site-capabilities-qidian',
    targetRelativePath,
  });
  const item = result.items[0];

  assert.equal(assertGraphInventoryRepoOutputDryRunCompatibility(result), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(result), true);
  assert.equal(result.queryName, 'createGraphInventoryRepoOutputDryRun');
  assert.equal(result.artifactFamily, 'site-capability-graph-inventory-repo-output-dry-run');
  assert.equal(result.redactionRequired, true);
  assert.equal(item.outputMode, 'dry-run-preview');
  assert.equal(item.dryRunOnly, true);
  assert.equal(item.targetRelativePath, targetRelativePath);
  assert.equal(item.repoWriteEnabled, false);
  assert.equal(item.runtimeGenerationEnabled, false);
  assert.equal(item.runtimeArtifactWriteEnabled, false);
  assert.equal(item.externalCommandEnabled, false);
  assert.equal(item.explicitValidationRequired, true);
  assert.equal(item.inventoryArtifact.artifactFamily, 'site-capability-graph-inventory');
  assert.equal(item.inventoryArtifact.redactionRequired, true);
  await assert.rejects(access(path.join(process.cwd(), targetRelativePath)), /ENOENT/u);
});

test('generated graph inventory repo output dry-run previews persisted CapabilityNode records only', async () => {
  const descriptor = await readLayerSiteDescriptor('www.qidian.com');
  const graph = createGeneratedSyntheticGraphFromLayerDescriptor(descriptor);
  const targetRelativePath = 'runs/site-capability-graph/w2-capability-node-inventory-dry-run.json';
  const runtimeRelativePath = 'runs/site-capability-graph/w2-capability-node-inventory.json';
  const targetPath = path.join(process.cwd(), targetRelativePath);
  const runtimePath = path.join(process.cwd(), runtimeRelativePath);

  await assert.rejects(access(targetPath), /ENOENT/u);
  await assert.rejects(access(runtimePath), /ENOENT/u);

  const result = createGraphInventoryRepoOutputDryRun(graph, {
    inventoryName: 'qidian-generated-graph',
    source: 'config-site-capabilities-qidian',
    targetRelativePath,
  });
  const item = result.items[0];
  const capabilityRecords = item.inventoryArtifact.items[0].graph.nodes
    .filter((node) => node.type === 'CapabilityNode');

  assert.equal(assertGraphInventoryRepoOutputDryRunCompatibility(result), true);
  assert.equal(item.outputMode, 'dry-run-preview');
  assert.equal(item.dryRunOnly, true);
  assert.equal(item.repoWriteEnabled, false);
  assert.equal(item.runtimeGenerationEnabled, false);
  assert.equal(item.runtimeArtifactWriteEnabled, false);
  assert.equal(item.externalCommandEnabled, false);
  assert.equal(item.inventoryArtifact.artifactFamily, 'site-capability-graph-inventory');
  assert.equal(item.inventoryArtifact.redactionRequired, true);
  assert.deepEqual(capabilityRecords.map((node) => node.id), [
    `capability:${descriptor.siteKey}:navigate-to-content`,
  ]);

  for (const record of capabilityRecords) {
    assert.equal(assertCapabilityNodeCompatible(record), true);
    assert.deepEqual(Object.fromEntries([
      'schemaVersion',
      'id',
      'type',
      'siteKey',
      'capabilityKey',
      'capabilityFamily',
      'mode',
      'requiresApproval',
      'supportedTaskTypes',
      'routeRefs',
      'riskPolicyRef',
      'sourceRefs',
      'testEvidenceRefs',
    ].map((fieldName) => [fieldName, Object.hasOwn(record, fieldName)])), {
      schemaVersion: true,
      id: true,
      type: true,
      siteKey: true,
      capabilityKey: true,
      capabilityFamily: true,
      mode: true,
      requiresApproval: true,
      supportedTaskTypes: true,
      routeRefs: true,
      riskPolicyRef: true,
      sourceRefs: true,
      testEvidenceRefs: true,
    });
  }

  assert.doesNotMatch(
    JSON.stringify(result),
    /artifactPath|writePath|runtime artifact|runtime generation|Authorization|cookie|csrf|sessionId|browserProfile/u,
  );
  await assert.rejects(access(targetPath), /ENOENT/u);
  await assert.rejects(access(runtimePath), /ENOENT/u);
});

function assertNoDatabaseOrRuntimeStorageDescriptor(item, label) {
  assert.ok(
    item.storageMode === 'descriptor-only-no-database-no-runtime-state'
      || item.storageMode === 'no-database-no-runtime-state'
      || item.databaseEnabled === false,
    `${label} must declare storageMode or equivalent no database descriptor`,
  );
  for (const fieldName of [
    'databaseEnabled',
    'storageAdapterEnabled',
    'runtimeStatePersistenceEnabled',
    'dynamicRuntimeStateStored',
  ]) {
    assert.equal(item[fieldName], false, `${label} ${fieldName} must be false`);
  }
  for (const fieldName of [
    'repoWriteEnabled',
    'runtimeGenerationEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
  ]) {
    assert.equal(item[fieldName], false, `${label} ${fieldName} must remain false`);
  }
}

function assertNoRuntimeStorageBoundaryPayload(value) {
  assert.doesNotMatch(
    JSON.stringify(value),
    /databaseUrl|dbPath|storageAdapter":|runtimeState":|runtimeStateStore|statePersistence":|SiteAdapter invoked|downloader invoked|SessionView materialized|synthetic-secret-value/u,
  );
}

test('graph inventory runtime descriptors enforce no database or runtime state storage', async () => {
  const descriptor = await readLayerSiteDescriptor('www.qidian.com');
  const graph = createGeneratedSyntheticGraphFromLayerDescriptor(descriptor);
  const targetRelativePath = 'runs/site-capability-graph/w2-no-runtime-storage-dry-run.json';
  const targetPath = path.join(process.cwd(), targetRelativePath);
  const design = createGraphInventoryRuntimeIntegrationDesign(graph, {
    inventoryName: 'qidian-generated-graph',
    source: 'config-site-capabilities-qidian',
  });
  const consumer = createDisabledGraphInventoryRuntimeConsumerResult(design);
  const dryRun = createGraphInventoryRepoOutputDryRun(graph, {
    inventoryName: 'qidian-generated-graph',
    source: 'config-site-capabilities-qidian',
    targetRelativePath,
  });

  assert.equal(assertGraphInventoryRuntimeIntegrationDesignCompatibility(design), true);
  assert.equal(assertDisabledGraphInventoryRuntimeConsumerResultCompatibility(consumer), true);
  assert.equal(assertGraphInventoryRepoOutputDryRunCompatibility(dryRun), true);
  assertNoDatabaseOrRuntimeStorageDescriptor(design.items[0], 'GraphInventoryRuntimeIntegrationDesign item');
  assertNoDatabaseOrRuntimeStorageDescriptor(consumer.items[0], 'DisabledGraphInventoryRuntimeConsumerResult item');
  assertNoDatabaseOrRuntimeStorageDescriptor(dryRun.items[0], 'GraphInventoryRepoOutputDryRun item');
  assertNoRuntimeStorageBoundaryPayload({ design, consumer, dryRun });
  await assert.rejects(access(targetPath), /ENOENT/u);

  for (const { fieldName, value } of [
    { fieldName: 'databaseUrl', value: 'sqlite://synthetic-secret-value' },
    { fieldName: 'dbPath', value: 'runs/site-capability-graph/state.sqlite' },
    { fieldName: 'storageAdapter', value: {} },
    { fieldName: 'runtimeState', value: {} },
    { fieldName: 'runtimeStateStore', value: {} },
    { fieldName: 'statePersistenceEnabled', value: true },
    { fieldName: 'databaseEnabled', value: true },
  ]) {
    for (const [factoryName, factory] of [
      ['GraphInventoryRuntimeIntegrationDesignOptions', (options) => createGraphInventoryRuntimeIntegrationDesign(graph, options)],
      ['DisabledGraphInventoryRuntimeConsumerOptions', (options) => createDisabledGraphInventoryRuntimeConsumerResult(design, options)],
      ['GraphInventoryRepoOutputDryRunOptions', (options) => createGraphInventoryRepoOutputDryRun(graph, options)],
    ]) {
      // @ts-ignore
      const message = captureThrownMessage(() => factory({ [fieldName]: value }));
      assert.match(
        message,
        new RegExp(`descriptor-only|forbidden field|unsafe storage/runtime option|${fieldName} must remain false`, 'u'),
        `${factoryName} must fail closed for ${fieldName}`,
      );
      assert.doesNotMatch(message, /synthetic-secret-value/u);
    }
  }
});

test('generated graph inventory repo output dry-run rejects writes, unsafe targets, and unsafe artifacts', async () => {
  const descriptor = await readLayerSiteDescriptor('www.qidian.com');
  const graph = createGeneratedSyntheticGraphFromLayerDescriptor(descriptor);

  for (const fieldName of [
    'repoWriteEnabled',
    'runtimeGenerationEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
  ]) {
    assert.throws(
      () => createGraphInventoryRepoOutputDryRun(graph, { [fieldName]: true }),
      new RegExp(`${fieldName} must remain false`, 'u'),
    );
  }

  for (const { targetRelativePath, pattern } of [
    {
      targetRelativePath: '../outside.json',
      pattern: /must stay within the repository/u,
    },
    {
      targetRelativePath: 'C:/Users/lyt-p/Desktop/outside.json',
      pattern: /must be repo-relative/u,
    },
    {
      targetRelativePath: 'site-capability-graph/generated.json',
      pattern: /runs\/site-capability-graph/u,
    },
  ]) {
    assert.throws(
      () => createGraphInventoryRepoOutputDryRun(graph, { targetRelativePath }),
      pattern,
    );
  }

  assert.throws(
    () => createGraphInventoryRepoOutputDryRun(graph, {
      outputPath: 'runs/site-capability-graph/generated.json',
    }),
    /descriptor-only.*outputPath/u,
  );
  assert.throws(
    () => createGraphInventoryRepoOutputDryRun(graph, {
      sessionView: {},
    }),
    /descriptor-only.*sessionView/u,
  );

  const result = createGraphInventoryRepoOutputDryRun(graph);
  result.items[0].repoWriteEnabled = true;
  assert.throws(
    () => assertGraphInventoryRepoOutputDryRunCompatibility(result),
    /repoWriteEnabled must be false/u,
  );

  const unsafeArtifactResult = createGraphInventoryRepoOutputDryRun(graph);
  unsafeArtifactResult.items[0].inventoryArtifact.redactionRequired = false;
  assert.throws(
    () => assertGraphInventoryRepoOutputDryRunCompatibility(unsafeArtifactResult),
    /inventoryArtifact redactionRequired must be true/u,
  );
});

test('schema-governed graph inventory output remains dry-run and design-only', async () => {
  const descriptor = await readLayerSiteDescriptor('www.qidian.com');
  const graph = createGeneratedSyntheticGraphFromLayerDescriptor(descriptor);
  const targetRelativePath = 'runs/site-capability-graph/schema-governed-inventory-output-dry-run.json';
  const targetPath = path.join(process.cwd(), targetRelativePath);
  const design = createGraphInventoryRuntimeIntegrationDesign(graph, {
    inventoryName: 'qidian-generated-graph',
    source: 'schema-governed-inventory-output-focused-test',
  });
  const consumer = createDisabledGraphInventoryRuntimeConsumerResult(design);
  const dryRun = createGraphInventoryRepoOutputDryRun(graph, {
    inventoryName: 'qidian-generated-graph',
    source: 'schema-governed-inventory-output-focused-test',
    targetRelativePath,
  });
  const gate = createGraphRepoOutputApprovalGateDesign(dryRun, {
    gateName: 'schema-governed-inventory-output-approval-gate',
  });

  assert.equal(assertGraphInventoryRuntimeIntegrationDesignCompatibility(design), true);
  assert.equal(assertDisabledGraphInventoryRuntimeConsumerResultCompatibility(consumer), true);
  assert.equal(assertGraphInventoryRepoOutputDryRunCompatibility(dryRun), true);
  assert.equal(assertGraphRepoOutputApprovalGateDesignCompatibility(gate), true);

  const designItem = design.items[0];
  const consumerItem = consumer.items[0];
  const dryRunItem = dryRun.items[0];
  const gateItem = gate.items[0];

  assert.equal(designItem.integrationMode, 'design-only');
  assert.equal(consumerItem.consumerMode, 'disabled-feature-flag');
  assert.equal(consumerItem.featureEnabled, false);
  assert.equal(consumerItem.result, 'blocked');
  assert.equal(dryRunItem.outputMode, 'dry-run-preview');
  assert.equal(dryRunItem.dryRunOnly, true);
  assert.equal(gateItem.gateMode, 'design-only');
  assert.equal(gateItem.approvalRequiredBeforeRepoWrite, true);
  assert.equal(gateItem.sourceOutputDryRunOnly, true);

  for (const [label, item] of [
    ['GraphInventoryRuntimeIntegrationDesign item', designItem],
    ['DisabledGraphInventoryRuntimeConsumerResult item', consumerItem],
    ['GraphInventoryRepoOutputDryRun item', dryRunItem],
  ]) {
    assertNoDatabaseOrRuntimeStorageDescriptor(item, label);
  }

  for (const [label, item] of [
    ['GraphInventoryRuntimeIntegrationDesign item', designItem],
    ['DisabledGraphInventoryRuntimeConsumerResult item', consumerItem],
    ['GraphInventoryRepoOutputDryRun item', dryRunItem],
    ['GraphRepoOutputApprovalGateDesign item', gateItem],
  ]) {
    for (const fieldName of [
      'repoWriteEnabled',
      'runtimeGenerationEnabled',
      'runtimeArtifactWriteEnabled',
    ]) {
      assert.equal(item[fieldName], false, `${label} ${fieldName} must remain false`);
    }
  }

  assertNoRuntimeStorageBoundaryPayload({ design, consumer, dryRun, gate });
  assert.deepEqual(
    {
      designInventoryFamily: designItem.inventoryArtifact.artifactFamily,
      consumerInventoryFamily: consumerItem.inventoryArtifact.artifactFamily,
      dryRunInventoryFamily: dryRunItem.inventoryArtifact.artifactFamily,
      gateSourceFamily: gateItem.sourceRepoOutput.artifactFamily,
    },
    {
      designInventoryFamily: 'site-capability-graph-inventory',
      consumerInventoryFamily: 'site-capability-graph-inventory',
      dryRunInventoryFamily: 'site-capability-graph-inventory',
      gateSourceFamily: 'site-capability-graph-inventory-repo-output-dry-run',
    },
  );
  assert.equal(dryRunItem.targetRelativePath, targetRelativePath);
  await assert.rejects(access(targetPath), /ENOENT/u);

  for (const fieldName of [
    'repoWriteEnabled',
    'runtimeGenerationEnabled',
    'runtimeArtifactWriteEnabled',
  ]) {
    for (const [factoryName, factory] of [
      ['GraphInventoryRuntimeIntegrationDesignOptions', (options) => createGraphInventoryRuntimeIntegrationDesign(graph, options)],
      ['DisabledGraphInventoryRuntimeConsumerOptions', (options) => createDisabledGraphInventoryRuntimeConsumerResult(design, options)],
      ['GraphInventoryRepoOutputDryRunOptions', (options) => createGraphInventoryRepoOutputDryRun(graph, options)],
      ['GraphRepoOutputApprovalGateDesignOptions', (options) => createGraphRepoOutputApprovalGateDesign(dryRun, options)],
    ]) {
      // @ts-ignore
      const message = captureThrownMessage(() => factory({ [fieldName]: true }));
      assert.match(
        message,
        new RegExp(`${fieldName} must remain false`, 'u'),
        `${factoryName} must fail closed for ${fieldName}`,
      );
    }
  }

  for (const { fieldName, value } of [
    { fieldName: 'databaseEnabled', value: true },
    { fieldName: 'storageAdapterEnabled', value: true },
    { fieldName: 'runtimeStatePersistenceEnabled', value: true },
    { fieldName: 'dynamicRuntimeStateStored', value: true },
    { fieldName: 'runtimeState', value: {} },
    { fieldName: 'runtimeStateStore', value: {} },
  ]) {
    for (const [factoryName, factory] of [
      ['GraphInventoryRuntimeIntegrationDesignOptions', (options) => createGraphInventoryRuntimeIntegrationDesign(graph, options)],
      ['DisabledGraphInventoryRuntimeConsumerOptions', (options) => createDisabledGraphInventoryRuntimeConsumerResult(design, options)],
      ['GraphInventoryRepoOutputDryRunOptions', (options) => createGraphInventoryRepoOutputDryRun(graph, options)],
    ]) {
      // @ts-ignore
      const message = captureThrownMessage(() => factory({ [fieldName]: value }));
      assert.match(
        message,
        new RegExp(`descriptor-only|unsafe storage/runtime option|${fieldName} must remain false`, 'u'),
        `${factoryName} must fail closed for ${fieldName}`,
      );
    }
  }

  await assert.rejects(access(targetPath), /ENOENT/u);
});

test('generated graph inventory repo output approval gate stays design-only', async () => {
  const descriptor = await readLayerSiteDescriptor('www.qidian.com');
  const graph = createGeneratedSyntheticGraphFromLayerDescriptor(descriptor);
  const dryRun = createGraphInventoryRepoOutputDryRun(graph, {
    inventoryName: 'qidian-generated-graph',
    source: 'config-site-capabilities-qidian',
    targetRelativePath: 'runs/site-capability-graph/qidian-generated-graph-dry-run.json',
  });

  const gate = createGraphRepoOutputApprovalGateDesign(dryRun, {
    gateName: 'qidian-generated-graph-repo-output-approval-gate',
  });
  const item = gate.items[0];

  assert.equal(assertGraphRepoOutputApprovalGateDesignCompatibility(gate), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(gate), true);
  assert.equal(gate.queryName, 'createGraphRepoOutputApprovalGateDesign');
  assert.equal(gate.artifactFamily, 'site-capability-graph-repo-output-approval-gate-design');
  assert.equal(gate.redactionRequired, true);
  assert.equal(item.gateMode, 'design-only');
  assert.equal(item.approvalGateEnabled, false);
  assert.equal(item.repoWriteEnabled, false);
  assert.equal(item.runtimeGenerationEnabled, false);
  assert.equal(item.runtimeArtifactWriteEnabled, false);
  assert.equal(item.externalCommandEnabled, false);
  assert.equal(item.approvalRequiredBeforeRepoWrite, true);
  assert.equal(item.sourceOutputDryRunOnly, true);
  assert.equal(item.sourceRepoOutput.artifactFamily, 'site-capability-graph-inventory-repo-output-dry-run');
  assert.ok(item.requiredApprovalEvidence.includes('explicit-user-request-in-current-task'));
  assert.ok(item.requiredApprovalEvidence.includes('B-review-accepted'));
  assert.ok(item.requiredApprovalEvidence.includes('redaction-guard-passed'));

  assert.throws(
    () => createGraphRepoOutputApprovalGateDesign(dryRun, { repoWriteEnabled: true }),
    /repoWriteEnabled must remain false/u,
  );
  assert.throws(
    () => createGraphRepoOutputApprovalGateDesign(dryRun, {
      outputPath: 'runs/site-capability-graph/qidian-generated-graph.json',
    }),
    /descriptor-only.*outputPath/u,
  );

  const unsafeGate = createGraphRepoOutputApprovalGateDesign(dryRun);
  unsafeGate.items[0].approvalGateEnabled = true;
  assert.throws(
    () => assertGraphRepoOutputApprovalGateDesignCompatibility(unsafeGate),
    /approvalGateEnabled must be false/u,
  );

  const unsafeSourceGate = createGraphRepoOutputApprovalGateDesign(dryRun);
  unsafeSourceGate.items[0].sourceRepoOutput.items[0].repoWriteEnabled = true;
  assert.throws(
    () => assertGraphRepoOutputApprovalGateDesignCompatibility(unsafeSourceGate),
    /repoWriteEnabled must be false/u,
  );
});
