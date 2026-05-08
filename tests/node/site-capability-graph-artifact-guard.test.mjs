import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility,
  assertGraphDerivedArtifactWriteAllowed,
  assertGraphDocsMarkdownRepoOutputDryRunCompatibility,
  createDisabledGraphDocsMarkdownRuntimeConsumerResult,
  createGraphDocsMarkdownArtifact,
  createGraphDocsMarkdownRepoOutputDryRun,
  generateGraphDocsSummary,
  listGraphSites,
  validateSiteCapabilityGraph,
} from '../../src/sites/capability/site-capability-graph.mjs';
import * as siteCapabilityGraph from '../../src/sites/capability/site-capability-graph.mjs';
import {
  requireReasonCodeDefinition,
} from '../../src/sites/capability/reason-codes.mjs';

const MINIMAL_GRAPH_URL = new URL('./fixtures/site-capability-graph/minimal-v1.json', import.meta.url);

async function readMinimalGraphFixture() {
  return JSON.parse(await readFile(MINIMAL_GRAPH_URL, 'utf8'));
}

function captureThrownMessage(fn) {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected function to throw');
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

function loadGraphCorePositioningBoundaryGuardApi() {
  const create = siteCapabilityGraph.createGraphCorePositioningBoundaryGuard;
  const assertCompatibility = siteCapabilityGraph.assertGraphCorePositioningBoundaryGuardCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'Graph core positioning boundary guard exports are required: '
      + 'createGraphCorePositioningBoundaryGuard and '
      + 'assertGraphCorePositioningBoundaryGuardCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function loadGraphDocsMarkdownRuntimeConsumerHandoffGuardApi() {
  const create = siteCapabilityGraph.createGraphDocsMarkdownRuntimeConsumerHandoffGuard;
  const assertCompatibility =
    siteCapabilityGraph.assertGraphDocsMarkdownRuntimeConsumerHandoffGuardCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'docs markdown runtime consumer handoff guard exports are required: '
      + 'createGraphDocsMarkdownRuntimeConsumerHandoffGuard and '
      + 'assertGraphDocsMarkdownRuntimeConsumerHandoffGuardCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function loadGraphInventoryRuntimeConsumerHandoffGuardApi() {
  const create = siteCapabilityGraph.createGraphInventoryRuntimeConsumerHandoffGuard;
  const assertCompatibility =
    siteCapabilityGraph.assertGraphInventoryRuntimeConsumerHandoffGuardCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'graph inventory runtime consumer handoff guard exports are required: '
      + 'createGraphInventoryRuntimeConsumerHandoffGuard and '
      + 'assertGraphInventoryRuntimeConsumerHandoffGuardCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function loadGraphCorePositioningRuntimeBoundaryAcceptanceGuardApi() {
  const create = siteCapabilityGraph.createGraphCorePositioningRuntimeBoundaryAcceptanceGuard;
  const assertCompatibility =
    siteCapabilityGraph.assertGraphCorePositioningRuntimeBoundaryAcceptanceGuardCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'graph core positioning runtime boundary acceptance guard exports are required: '
      + 'createGraphCorePositioningRuntimeBoundaryAcceptanceGuard and '
      + 'assertGraphCorePositioningRuntimeBoundaryAcceptanceGuardCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function loadGraphAggregateExecutionBoundaryGuardApi() {
  const create = siteCapabilityGraph.createGraphAggregateExecutionBoundaryGuard;
  const assertCompatibility =
    siteCapabilityGraph.assertGraphAggregateExecutionBoundaryGuardCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'graph aggregate execution boundary guard exports are required: '
      + 'createGraphAggregateExecutionBoundaryGuard and '
      + 'assertGraphAggregateExecutionBoundaryGuardCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function loadGraphLayerAggregateExecutionBoundaryHandoffReviewGateApi() {
  const create =
    siteCapabilityGraph.createGraphLayerAggregateExecutionBoundaryHandoffReviewGate;
  const assertCompatibility =
    siteCapabilityGraph.assertGraphLayerAggregateExecutionBoundaryHandoffReviewGateCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'Graph/Layer aggregate execution boundary handoff review gate exports are required: '
      + 'createGraphLayerAggregateExecutionBoundaryHandoffReviewGate and '
      + 'assertGraphLayerAggregateExecutionBoundaryHandoffReviewGateCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function firstContractItem(contract) {
  if (Array.isArray(contract?.items) && contract.items.length > 0) {
    return contract.items[0];
  }
  return contract;
}

function createGraphAggregateExecutionBoundaryGuard(create, sourceGuard, options = {}) {
  try {
    return create(sourceGuard, options);
  } catch (error) {
    if (
      error instanceof TypeError
      || /source|guard|options|must be an object|core positioning/iu.test(String(error?.message ?? error))
    ) {
      return create({
        sourceCorePositioningRuntimeBoundaryAcceptanceGuard: sourceGuard,
        corePositioningRuntimeBoundaryAcceptanceGuard: sourceGuard,
        ...options,
      });
    }
    throw error;
  }
}

function createGraphLayerAggregateExecutionBoundaryHandoffReviewGate(
  create,
  aggregateExecutionBoundaryGuard,
  options = {},
) {
  try {
    return create(aggregateExecutionBoundaryGuard, options);
  } catch (error) {
    if (
      error instanceof TypeError
      || /source|guard|options|must be an object|aggregate execution boundary/iu
        .test(String(error?.message ?? error))
    ) {
      return create({
        sourceAggregateExecutionBoundaryGuard: aggregateExecutionBoundaryGuard,
        aggregateExecutionBoundaryGuard,
        sourceGuard: aggregateExecutionBoundaryGuard,
        ...options,
      });
    }
    throw error;
  }
}

async function createCorePositioningRuntimeBoundaryAcceptanceGuardForAggregateExecutionBoundary() {
  const { create: createPreflight } = loadFutureGraphLayerConsumerPreflightContractApi();
  const { create: createHandoffGuard } = loadGraphInventoryRuntimeConsumerHandoffGuardApi();
  const { create: createAcceptanceGuard } =
    loadGraphCorePositioningRuntimeBoundaryAcceptanceGuardApi();
  const graph = await readMinimalGraphFixture();
  const runtimeDesign = siteCapabilityGraph.createGraphInventoryRuntimeIntegrationDesign(graph, {
    integrationName: 'synthetic-aggregate-execution-boundary-runtime-design',
    inventoryName: 'synthetic-aggregate-execution-boundary-inventory',
    source: 'synthetic-minimal-graph-fixture',
  });
  const sourceRuntimeConsumer = siteCapabilityGraph.createDisabledGraphInventoryRuntimeConsumerResult(
    runtimeDesign,
    {
      consumerName: 'synthetic-aggregate-execution-boundary-disabled-consumer',
      featureEnabled: false,
    },
  );
  const sourcePreflight = createPreflight(sourceRuntimeConsumer, {
    consumerName: 'synthetic-aggregate-execution-boundary-preflight',
    descriptorOnly: true,
    featureEnabled: false,
    liveEnabled: false,
    liveRuntimeEnabled: false,
    executionEnabled: false,
    writeEnabled: false,
    repoWriteEnabled: false,
    runtimeArtifactWriteEnabled: false,
    materializationEnabled: false,
    sessionMaterializationEnabled: false,
    credentialMaterializationEnabled: false,
    profileMaterializationEnabled: false,
    downloaderExecutionEnabled: false,
    siteAdapterExecutionEnabled: false,
  });
  const sourceHandoffGuard = createHandoffGuard({
    sourcePreflight,
    sourceRuntimeConsumer,
  }, {
    handoffName: 'synthetic-aggregate-execution-boundary-source-handoff-guard',
  });
  return createAcceptanceGuard(sourceHandoffGuard, {
    guardName: 'synthetic-aggregate-execution-boundary-source-core-positioning-acceptance-guard',
  });
}

async function createAggregateExecutionBoundaryGuardForLayerHandoffReviewGate() {
  const { create: createAggregateGuard } = loadGraphAggregateExecutionBoundaryGuardApi();
  const sourceCorePositioningGuard =
    await createCorePositioningRuntimeBoundaryAcceptanceGuardForAggregateExecutionBoundary();
  return createGraphAggregateExecutionBoundaryGuard(
    createAggregateGuard,
    sourceCorePositioningGuard,
    {
      guardName: 'synthetic-layer-handoff-review-gate-source-aggregate-boundary',
    },
  );
}

test('graph-derived artifact guard accepts redaction-required graph descriptors', async () => {
  const graph = await readMinimalGraphFixture();
  const docsSummary = generateGraphDocsSummary(graph);
  const queryResult = {
    ...listGraphSites(graph),
    redactionRequired: true,
  };
  const validationReport = {
    ...validateSiteCapabilityGraph(graph),
    redactionRequired: true,
  };
  const artifactNode = {
    schemaVersion: 1,
    id: 'artifact:graph-docs-summary',
    type: 'ArtifactContractNode',
    artifactFamily: 'site-capability-graph-docs',
    redactionRequired: true,
    schemaRef: 'schema:GraphDocsSummary',
    writeGuard: 'SecurityGuard/Redaction',
    auditRequired: true,
  };

  assert.equal(assertGraphDerivedArtifactWriteAllowed(docsSummary), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(queryResult), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(validationReport), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(artifactNode), true);
});

test('graph-derived artifact guard rejects missing redaction descriptors', async () => {
  const graph = await readMinimalGraphFixture();
  const docsSummary = generateGraphDocsSummary(graph);
  docsSummary.redactionRequired = false;

  assert.throws(
    () => assertGraphDerivedArtifactWriteAllowed(docsSummary),
    /redactionRequired=true/u,
  );
});

test('graph-derived artifact guard rejects unsupported descriptor shapes', () => {
  assert.throws(
    () => assertGraphDerivedArtifactWriteAllowed({
      schemaVersion: 1,
      graphVersion: 'synthetic-graph-v1',
      redactionRequired: true,
      payload: [],
    }),
    /Unsupported graph-derived artifact type/u,
  );
});

test('graph-derived artifact guard rejects forbidden fields without echoing values', async () => {
  const graph = await readMinimalGraphFixture();
  const docsSummary = generateGraphDocsSummary(graph);
  docsSummary.sections.testCoverageSummary.push({
    nodeId: 'capability:synthetic.example:open-public-page',
    accessToken: 'synthetic-secret-value',
  });

  const message = captureThrownMessage(() => assertGraphDerivedArtifactWriteAllowed(docsSummary));

  assert.match(message, /forbidden field/u);
  assert.doesNotMatch(message, /synthetic-secret-value/u);
});

test('graph-derived artifact guard rejects forbidden value patterns without echoing values', async () => {
  const graph = await readMinimalGraphFixture();
  const docsSummary = generateGraphDocsSummary(graph);
  docsSummary.sections.testCoverageSummary.push({
    nodeId: 'capability:synthetic.example:open-public-page',
    note: 'Authorization: Bearer synthetic-secret-value',
  });

  const message = captureThrownMessage(() => assertGraphDerivedArtifactWriteAllowed(docsSummary));

  assert.match(message, /Forbidden sensitive pattern/u);
  assert.doesNotMatch(message, /synthetic-secret-value/u);
});

test('non-goal boundary guards reject bypass credentials sessions and unredacted writes', async () => {
  const graph = await readMinimalGraphFixture();
  const docsSummary = generateGraphDocsSummary(graph);
  const docsArtifact = createGraphDocsMarkdownArtifact(docsSummary);
  const repoOutput = createGraphDocsMarkdownRepoOutputDryRun(docsArtifact, {
    targetRelativePath: 'docs/site-capability-graph/non-goal-boundary.md',
    repoWriteEnabled: false,
    runtimeArtifactWriteEnabled: false,
  });
  const runtimeConsumer = createDisabledGraphDocsMarkdownRuntimeConsumerResult(docsArtifact, {
    consumerName: 'synthetic-non-goal-runtime-consumer',
    featureEnabled: false,
  });

  assert.equal(assertGraphDerivedArtifactWriteAllowed(docsArtifact), true);
  assert.equal(assertGraphDocsMarkdownRepoOutputDryRunCompatibility(repoOutput), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(repoOutput), true);
  assert.equal(assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility(runtimeConsumer), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(runtimeConsumer), true);

  const repoItem = repoOutput.items[0];
  assert.equal(repoItem.outputMode, 'dry-run-preview');
  assert.equal(repoItem.dryRunOnly, true);
  assert.equal(repoItem.repoWriteEnabled, false);
  assert.equal(repoItem.runtimeArtifactWriteEnabled, false);
  assert.equal(repoItem.explicitValidationRequired, true);
  for (const runtimeField of [
    'artifactPath',
    'docsOutputPath',
    'docsWriteEnabled',
    'downloadPolicy',
    'execute',
    'handler',
    'sessionView',
    'standardTaskList',
    'taskList',
    'unredactedPayload',
    'writer',
  ]) {
    assert.equal(Object.hasOwn(repoItem, runtimeField), false, runtimeField);
  }

  const runtimeItem = runtimeConsumer.items[0];
  assert.equal(runtimeItem.consumerMode, 'disabled-feature-flag');
  assert.equal(runtimeItem.featureEnabled, false);
  assert.equal(runtimeItem.result, 'blocked');
  assert.equal(runtimeItem.reasonCode, 'graph-runtime-consumer-disabled');
  for (const runtimeField of [
    'artifactPath',
    'docsWriteEnabled',
    'downloadPolicy',
    'execute',
    'handler',
    'repoPath',
    'runtimeDocsWriteEnabled',
    'sessionView',
    'standardTaskList',
    'taskList',
    'unredactedPayload',
    'writer',
  ]) {
    assert.equal(Object.hasOwn(runtimeItem, runtimeField), false, runtimeField);
  }

  const descriptorJson = JSON.stringify({ docsArtifact, repoOutput, runtimeConsumer });
  assert.doesNotMatch(
    descriptorJson,
    /synthetic-secret-value|Authorization|Bearer|SESSDATA|cookie|csrf|sessionId|browserProfilePath|userDataDir/iu,
  );
  assert.doesNotMatch(
    descriptorJson,
    /Graph execution enabled|SiteAdapter execution enabled|downloader execution enabled|runtime writes enabled|repo writes enabled/iu,
  );

  const unsafeSummary = generateGraphDocsSummary(graph);
  unsafeSummary.sections.testCoverageSummary.push({
    nodeId: 'capability:synthetic.example:open-public-page',
    authorizationHeader: 'Bearer synthetic-secret-value',
  });
  const unsafeSummaryMessage = captureThrownMessage(() => createGraphDocsMarkdownArtifact(unsafeSummary));
  assert.match(unsafeSummaryMessage, /forbidden field/u);
  assert.doesNotMatch(unsafeSummaryMessage, /synthetic-secret-value/u);

  for (const { name, fn, pattern } of [
    {
      name: 'repoWriteEnabled',
      fn: () => createGraphDocsMarkdownRepoOutputDryRun(docsArtifact, {
        targetRelativePath: 'docs/site-capability-graph/non-goal-boundary.md',
        repoWriteEnabled: true,
      }),
      pattern: /repoWriteEnabled must remain false/u,
    },
    {
      name: 'runtimeArtifactWriteEnabled',
      fn: () => createGraphDocsMarkdownRepoOutputDryRun(docsArtifact, {
        targetRelativePath: 'docs/site-capability-graph/non-goal-boundary.md',
        runtimeArtifactWriteEnabled: true,
      }),
      pattern: /runtimeArtifactWriteEnabled must remain false/u,
    },
    {
      name: 'featureEnabled',
      fn: () => createDisabledGraphDocsMarkdownRuntimeConsumerResult(docsArtifact, {
        featureEnabled: true,
      }),
      pattern: /featureEnabled must remain false/u,
    },
    {
      name: 'sessionView',
      fn: () => createDisabledGraphDocsMarkdownRuntimeConsumerResult(docsArtifact, {
        featureEnabled: false,
        sessionView: { status: 'synthetic-redacted' },
      }),
      pattern: /descriptor-only.*sessionView/u,
    },
    {
      name: 'browserProfilePath',
      fn: () => createDisabledGraphDocsMarkdownRuntimeConsumerResult(docsArtifact, {
        featureEnabled: false,
        browserProfilePath: 'synthetic-browser-profile-path',
      }),
      pattern: /descriptor-only.*browserProfilePath/u,
    },
    {
      name: 'unredactedPayload',
      fn: () => createDisabledGraphDocsMarkdownRuntimeConsumerResult(docsArtifact, {
        featureEnabled: false,
        unredactedPayload: { value: 'synthetic-redacted' },
      }),
      pattern: /descriptor-only.*unredactedPayload/u,
    },
    {
      name: 'handler',
      fn: () => createDisabledGraphDocsMarkdownRuntimeConsumerResult(docsArtifact, {
        featureEnabled: false,
        handler: { boundary: 'SiteAdapter', action: 'captcha-bypass' },
      }),
      pattern: /descriptor-only.*handler/u,
    },
    {
      name: 'downloadPolicy',
      fn: () => createDisabledGraphDocsMarkdownRuntimeConsumerResult(docsArtifact, {
        featureEnabled: false,
        downloadPolicy: { execution: 'downloader-disabled' },
      }),
      pattern: /descriptor-only.*downloadPolicy/u,
    },
  ]) {
    const message = captureThrownMessage(fn);
    assert.match(message, pattern, name);
    assert.doesNotMatch(message, /synthetic-secret-value|synthetic-browser-profile-path|captcha-bypass/u, name);
  }
});

test('future Layer consumer preflight rejects non-goal runtime capabilities before enablement', async () => {
  const { create, assertCompatibility } = loadFutureGraphLayerConsumerPreflightContractApi();
  const graph = await readMinimalGraphFixture();
  const docsArtifact = createGraphDocsMarkdownArtifact(generateGraphDocsSummary(graph));
  const baseOptions = {
    consumerName: 'synthetic-future-layer-preflight-consumer',
    descriptorOnly: true,
    featureEnabled: false,
    liveEnabled: false,
    liveRuntimeEnabled: false,
    liveRouteExecutionEnabled: false,
    executionEnabled: false,
    graphExecutionEnabled: false,
    siteAdapterExecutionEnabled: false,
    downloaderExecutionEnabled: false,
    writeEnabled: false,
    repoWriteEnabled: false,
    docsWriteEnabled: false,
    runtimeArtifactWriteEnabled: false,
    materializationEnabled: false,
    credentialMaterializationEnabled: false,
    sessionMaterializationEnabled: false,
    profileMaterializationEnabled: false,
  };

  const contract = create(docsArtifact, baseOptions);
  assert.equal(assertCompatibility(contract), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(contract), true);

  const item = firstContractItem(contract);
  assert.equal(item.descriptorOnly, true);
  for (const flagName of [
    'featureEnabled',
    'liveEnabled',
    'liveRuntimeEnabled',
    'liveRouteExecutionEnabled',
    'executionEnabled',
    'graphExecutionEnabled',
    'siteAdapterExecutionEnabled',
    'downloaderExecutionEnabled',
    'writeEnabled',
    'repoWriteEnabled',
    'docsWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'materializationEnabled',
    'credentialMaterializationEnabled',
    'sessionMaterializationEnabled',
    'profileMaterializationEnabled',
  ]) {
    assert.equal(item[flagName], false, flagName);
  }

  const safeDescriptorJson = JSON.stringify(contract);
  assert.doesNotMatch(
    safeDescriptorJson,
    /synthetic-secret-value|synthetic-profile-path|synthetic-bypass-token|Cookie|Authorization|SessionView|downloadPolicy|SiteAdapter invoked/iu,
  );

  for (const { name, options, pattern } of [
    {
      name: 'bypassAccessControl',
      options: { bypassAccessControl: 'synthetic-bypass-token' },
      pattern: /bypass|access-control|descriptor-only|fail/i,
    },
    {
      name: 'accessControlBypassEnabled',
      options: { accessControlBypassEnabled: true },
      pattern: /bypass|access-control|must remain false/i,
    },
    {
      name: 'credentialMaterializationEnabled',
      options: { credentialMaterializationEnabled: true },
      pattern: /credentialMaterializationEnabled must remain false/i,
    },
    {
      name: 'credentialMaterialization',
      options: { credentialMaterialization: { authorizationHeader: 'Bearer synthetic-secret-value' } },
      pattern: /credential|materialization|forbidden field|descriptor-only/i,
    },
    {
      name: 'sessionMaterializationEnabled',
      options: { sessionMaterializationEnabled: true },
      pattern: /sessionMaterializationEnabled must remain false/i,
    },
    {
      name: 'sessionView',
      options: { sessionView: { sessionId: 'synthetic-secret-value' } },
      pattern: /sessionView|session materialization|forbidden field|descriptor-only/i,
    },
    {
      name: 'profileMaterializationEnabled',
      options: { profileMaterializationEnabled: true },
      pattern: /profileMaterializationEnabled must remain false/i,
    },
    {
      name: 'browserProfilePath',
      options: { browserProfilePath: 'synthetic-profile-path' },
      pattern: /browserProfilePath|profile materialization|forbidden field|descriptor-only/i,
    },
    {
      name: 'unredactedWrite',
      options: { unredactedWrite: { cookie: 'synthetic-secret-value' } },
      pattern: /unredacted|forbidden field|descriptor-only/i,
    },
    {
      name: 'repoWriteEnabled',
      options: { repoWriteEnabled: true },
      pattern: /repoWriteEnabled must remain false/i,
    },
    {
      name: 'docsWriteEnabled',
      options: { docsWriteEnabled: true },
      pattern: /docsWriteEnabled must remain false/i,
    },
    {
      name: 'runtimeArtifactWriteEnabled',
      options: { runtimeArtifactWriteEnabled: true },
      pattern: /runtimeArtifactWriteEnabled must remain false/i,
    },
    {
      name: 'graphExecutionEnabled',
      options: { graphExecutionEnabled: true },
      pattern: /graphExecutionEnabled must remain false/i,
    },
    {
      name: 'executeGraph',
      options: { executeGraph: () => ({ ok: true }) },
      pattern: /executeGraph|Graph execution|descriptor-only/i,
    },
    {
      name: 'siteAdapterExecutionEnabled',
      options: { siteAdapterExecutionEnabled: true },
      pattern: /siteAdapterExecutionEnabled must remain false/i,
    },
    {
      name: 'siteAdapter',
      options: { siteAdapter: { execute: 'synthetic-bypass-token' } },
      pattern: /siteAdapter|SiteAdapter execution|descriptor-only|forbidden field/i,
    },
    {
      name: 'downloaderExecutionEnabled',
      options: { downloaderExecutionEnabled: true },
      pattern: /downloaderExecutionEnabled must remain false/i,
    },
    {
      name: 'downloadPolicy',
      options: { downloadPolicy: { execute: 'synthetic-bypass-token' } },
      pattern: /downloadPolicy|downloader execution|descriptor-only|forbidden field/i,
    },
  ]) {
    const message = captureThrownMessage(() => create(docsArtifact, {
      ...baseOptions,
      ...options,
    }));
    assert.match(message, pattern, name);
    assert.doesNotMatch(
      message,
      /synthetic-secret-value|synthetic-profile-path|synthetic-bypass-token/u,
      name,
    );
  }
});

test('docs markdown runtime consumer handoff guard consumes future preflight before disabled runtime consumer wiring', async () => {
  const { create: createPreflight, assertCompatibility: assertPreflightCompatibility } =
    loadFutureGraphLayerConsumerPreflightContractApi();
  const { create: createHandoffGuard, assertCompatibility: assertHandoffGuardCompatibility } =
    loadGraphDocsMarkdownRuntimeConsumerHandoffGuardApi();
  const graph = await readMinimalGraphFixture();
  const docsArtifact = createGraphDocsMarkdownArtifact(generateGraphDocsSummary(graph));
  const sourcePreflight = createPreflight(docsArtifact, {
    consumerName: 'synthetic-docs-runtime-handoff-preflight',
    descriptorOnly: true,
    featureEnabled: false,
    liveEnabled: false,
    liveRuntimeEnabled: false,
    executionEnabled: false,
    writeEnabled: false,
    repoWriteEnabled: false,
    docsWriteEnabled: false,
    runtimeArtifactWriteEnabled: false,
    credentialMaterializationEnabled: false,
    sessionMaterializationEnabled: false,
    profileMaterializationEnabled: false,
  });
  const sourceRuntimeConsumer = createDisabledGraphDocsMarkdownRuntimeConsumerResult(docsArtifact, {
    consumerName: 'synthetic-docs-runtime-handoff-disabled-consumer',
    featureEnabled: false,
  });

  const handoffGuard = createHandoffGuard({
    sourcePreflight,
    disabledRuntimeConsumer: sourceRuntimeConsumer,
  }, {
    handoffName: 'synthetic-docs-runtime-consumer-handoff-guard',
  });
  const item = firstContractItem(handoffGuard);

  assert.equal(assertPreflightCompatibility(sourcePreflight), true);
  assert.equal(
    assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility(sourceRuntimeConsumer),
    true,
  );
  assert.equal(assertHandoffGuardCompatibility(handoffGuard), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(handoffGuard), true);
  assert.equal(handoffGuard.queryName, 'createGraphDocsMarkdownRuntimeConsumerHandoffGuard');
  assert.equal(
    handoffGuard.artifactFamily,
    'site-capability-graph-docs-markdown-runtime-consumer-handoff-guard',
  );
  assert.equal(handoffGuard.redactionRequired, true);
  assert.equal(item.handoffMode ?? item.guardMode, 'descriptor-only');
  assert.equal(item.result, 'blocked');
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(item.consumerName, 'synthetic-docs-runtime-handoff-disabled-consumer');
  assert.equal(
    item.requiredPreflightGuard,
    'assertFutureGraphLayerConsumerPreflightCompatibility',
  );
  assert.equal(
    item.requiredDisabledRuntimeConsumerGuard,
    'assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility',
  );
  assert.equal(
    item.requiredHandoffGuard,
    'assertGraphDocsMarkdownRuntimeConsumerHandoffGuardCompatibility',
  );
  assert.equal(item.sourcePreflight.queryName, sourcePreflight.queryName);
  assert.equal(item.sourcePreflight.artifactFamily, sourcePreflight.artifactFamily);
  assert.equal(item.sourcePreflight.result, sourcePreflight.items[0].result);
  assert.equal(item.sourcePreflight.reasonCode, sourcePreflight.items[0].reasonCode);
  assert.equal(item.disabledRuntimeConsumer.queryName, sourceRuntimeConsumer.queryName);
  assert.equal(item.disabledRuntimeConsumer.artifactFamily, sourceRuntimeConsumer.artifactFamily);
  assert.equal(item.disabledRuntimeConsumer.result, sourceRuntimeConsumer.items[0].result);
  assert.equal(item.disabledRuntimeConsumer.reasonCode, sourceRuntimeConsumer.items[0].reasonCode);

  for (const flagName of [
    'featureEnabled',
    'consumerEnabled',
    'layerConsumerEnabled',
    'layerConsumerAllowed',
    'runtimeConsumerEnabled',
    'runtimeConsumerAllowed',
    'runtimeEnabled',
    'runtimeAllowed',
    'runtimeDocsWriteEnabled',
    'runtimeDocsWriteAllowed',
    'docsWriteEnabled',
    'docsWriteAllowed',
    'repoWriteEnabled',
    'repoWriteAllowed',
    'runtimeArtifactWriteEnabled',
    'runtimeArtifactWriteAllowed',
    'artifactWriteEnabled',
    'artifactWriteAllowed',
    'externalTelemetryEnabled',
    'externalTelemetryAllowed',
    'externalTelemetryDispatchEnabled',
    'externalTelemetryDispatchAllowed',
    'sessionMaterializationEnabled',
    'sessionMaterializationAllowed',
    'materializationEnabled',
    'materializationAllowed',
    'profileMaterializationEnabled',
    'profileMaterializationAllowed',
    'credentialMaterializationEnabled',
    'credentialMaterializationAllowed',
    'downloaderEnabled',
    'downloaderAllowed',
    'downloaderExecutionEnabled',
    'downloaderExecutionAllowed',
    'siteAdapterEnabled',
    'siteAdapterAllowed',
    'siteAdapterExecutionEnabled',
    'siteAdapterExecutionAllowed',
    'writeEnabled',
    'writeAllowed',
    'runtimeWriteEnabled',
    'runtimeWriteAllowed',
    'filesystemWriteEnabled',
    'filesystemWriteAllowed',
  ]) {
    assert.equal(item[flagName], false, flagName);
  }

  for (const runtimeField of [
    'artifactPath',
    'docsOutputPath',
    'downloadPolicy',
    'externalTelemetry',
    'handler',
    'outputPath',
    'repoPath',
    'runtimeArtifactPath',
    'sessionView',
    'siteAdapter',
    'standardTaskList',
    'taskList',
    'downloader',
    'writer',
  ]) {
    assert.equal(Object.hasOwn(item, runtimeField), false, runtimeField);
  }

  for (const { name, options, pattern } of [
    {
      name: 'featureEnabled',
      options: { featureEnabled: true },
      pattern: /featureEnabled must remain false|featureEnabled must be false/i,
    },
    {
      name: 'handoffEnabled',
      options: { handoffEnabled: true },
      pattern: /handoffEnabled must remain false|handoffEnabled must be false/i,
    },
    {
      name: 'runtimeHandoffEnabled',
      options: { runtimeHandoffEnabled: true },
      pattern: /runtimeHandoffEnabled must remain false|runtimeHandoffEnabled must be false/i,
    },
    {
      name: 'runtimeConsumerEnabled',
      options: { runtimeConsumerEnabled: true },
      pattern: /runtimeConsumerEnabled must remain false|runtimeConsumerEnabled must be false/i,
    },
    {
      name: 'repoWriteEnabled',
      options: { repoWriteEnabled: true },
      pattern: /repoWriteEnabled must remain false|repoWriteEnabled must be false/i,
    },
    {
      name: 'docsWriteEnabled',
      options: { docsWriteEnabled: true },
      pattern: /docsWriteEnabled must remain false|docsWriteEnabled must be false/i,
    },
    {
      name: 'runtimeArtifactWriteEnabled',
      options: { runtimeArtifactWriteEnabled: true },
      pattern: /runtimeArtifactWriteEnabled must remain false|runtimeArtifactWriteEnabled must be false/i,
    },
    {
      name: 'writer',
      options: { writer: { value: 'synthetic-secret-value' } },
      pattern: /writer|descriptor-only|forbidden field/i,
    },
    {
      name: 'outputPath',
      options: { outputPath: 'runs/synthetic-secret-value.md' },
      pattern: /outputPath|descriptor-only|runtime field/i,
    },
    {
      name: 'sessionView',
      options: { sessionView: { sessionId: 'synthetic-secret-value' } },
      pattern: /sessionView|descriptor-only|forbidden field/i,
    },
    {
      name: 'downloadPolicy',
      options: { downloadPolicy: { execute: 'synthetic-secret-value' } },
      pattern: /downloadPolicy|descriptor-only|forbidden field/i,
    },
    {
      name: 'externalTelemetry',
      options: { externalTelemetry: { authorizationHeader: 'Bearer synthetic-secret-value' } },
      pattern: /externalTelemetry|descriptor-only|forbidden field|Forbidden sensitive pattern/i,
    },
    {
      name: 'authorizationHeader',
      options: { authorizationHeader: 'Bearer synthetic-secret-value' },
      pattern: /authorizationHeader|forbidden field|Forbidden sensitive pattern|descriptor-only/i,
    },
  ]) {
    const message = captureThrownMessage(() => createHandoffGuard({
      sourcePreflight,
      disabledRuntimeConsumer: sourceRuntimeConsumer,
    }, {
      handoffName: 'synthetic-docs-runtime-consumer-handoff-guard',
      ...options,
    }));
    assert.match(message, pattern, name);
    assert.doesNotMatch(message, /synthetic-secret-value/u, name);
  }

  const unsafeGuard = createHandoffGuard({
    sourcePreflight,
    disabledRuntimeConsumer: sourceRuntimeConsumer,
  }, {
    handoffName: 'synthetic-docs-runtime-consumer-handoff-guard',
  });
  unsafeGuard.items[0].docsWriteEnabled = true;
  assert.throws(
    () => assertHandoffGuardCompatibility(unsafeGuard),
    /docsWriteEnabled must be false|docsWriteEnabled must remain false/u,
  );

  const rendered = JSON.stringify(handoffGuard);
  assert.doesNotMatch(rendered, /synthetic-secret-value|Authorization|Bearer|cookie|csrf|sessionId|browserProfile/iu);
  assert.doesNotMatch(rendered, /"writer"\s*:|"outputPath"\s*:|"sessionView"\s*:|"downloadPolicy"\s*:/u);
  assert.doesNotMatch(rendered, /"externalTelemetry"\s*:|"siteAdapter"\s*:|"downloader"\s*:/u);
});

test('graph inventory runtime consumer handoff guard consumes future preflight before disabled inventory runtime wiring', async () => {
  const { create: createPreflight, assertCompatibility: assertPreflightCompatibility } =
    loadFutureGraphLayerConsumerPreflightContractApi();
  const { create: createHandoffGuard, assertCompatibility: assertHandoffGuardCompatibility } =
    loadGraphInventoryRuntimeConsumerHandoffGuardApi();
  const graph = await readMinimalGraphFixture();
  const runtimeDesign = siteCapabilityGraph.createGraphInventoryRuntimeIntegrationDesign(graph, {
    integrationName: 'synthetic-inventory-runtime-handoff-design',
    inventoryName: 'synthetic-minimal-graph-inventory',
    source: 'synthetic-minimal-graph-fixture',
  });
  const sourceRuntimeConsumer = siteCapabilityGraph.createDisabledGraphInventoryRuntimeConsumerResult(
    runtimeDesign,
    {
      consumerName: 'synthetic-inventory-runtime-handoff-disabled-consumer',
      featureEnabled: false,
    },
  );
  const sourcePreflight = createPreflight(sourceRuntimeConsumer, {
    consumerName: 'synthetic-inventory-runtime-handoff-preflight',
    descriptorOnly: true,
    featureEnabled: false,
    liveEnabled: false,
    liveRuntimeEnabled: false,
    executionEnabled: false,
    writeEnabled: false,
    repoWriteEnabled: false,
    runtimeArtifactWriteEnabled: false,
    materializationEnabled: false,
    sessionMaterializationEnabled: false,
    credentialMaterializationEnabled: false,
    profileMaterializationEnabled: false,
    downloaderExecutionEnabled: false,
    siteAdapterExecutionEnabled: false,
  });

  const handoffGuard = createHandoffGuard({
    sourcePreflight,
    sourceRuntimeConsumer,
  }, {
    handoffName: 'synthetic-inventory-runtime-consumer-handoff-guard',
  });
  const item = firstContractItem(handoffGuard);

  assert.equal(assertPreflightCompatibility(sourcePreflight), true);
  assert.equal(siteCapabilityGraph.assertGraphInventoryRuntimeIntegrationDesignCompatibility(runtimeDesign), true);
  assert.equal(siteCapabilityGraph.assertDisabledGraphInventoryRuntimeConsumerResultCompatibility(sourceRuntimeConsumer), true);
  assert.equal(assertHandoffGuardCompatibility(handoffGuard), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(handoffGuard), true);
  assert.equal(handoffGuard.queryName, 'createGraphInventoryRuntimeConsumerHandoffGuard');
  assert.equal(
    handoffGuard.artifactFamily,
    'site-capability-graph-inventory-runtime-consumer-handoff-guard',
  );
  assert.equal(handoffGuard.redactionRequired, true);
  assert.equal(item.handoffMode ?? item.guardMode, 'descriptor-only');
  assert.equal(item.result, 'blocked');
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(item.consumerName, 'synthetic-inventory-runtime-handoff-disabled-consumer');
  assert.equal(
    item.requiredPreflightGuard,
    'assertFutureGraphLayerConsumerPreflightCompatibility',
  );
  assert.equal(
    item.requiredRuntimeConsumerGuard,
    'assertDisabledGraphInventoryRuntimeConsumerResultCompatibility',
  );
  assert.equal(
    item.requiredHandoffGuard,
    'assertGraphInventoryRuntimeConsumerHandoffGuardCompatibility',
  );
  assert.equal(
    item.requiredGuards.preflightGuard,
    'assertFutureGraphLayerConsumerPreflightCompatibility',
  );
  assert.equal(
    item.requiredGuards.runtimeConsumerGuard,
    'assertDisabledGraphInventoryRuntimeConsumerResultCompatibility',
  );
  assert.equal(
    item.requiredGuards.handoffGuard,
    'assertGraphInventoryRuntimeConsumerHandoffGuardCompatibility',
  );
  assert.equal(item.sourcePreflight.queryName, sourcePreflight.queryName);
  assert.equal(item.sourcePreflight.artifactFamily, sourcePreflight.artifactFamily);
  assert.equal(item.sourcePreflight.result, sourcePreflight.items[0].result);
  assert.equal(item.sourcePreflight.reasonCode, sourcePreflight.items[0].reasonCode);
  assert.equal(item.sourceRuntimeConsumer.queryName, sourceRuntimeConsumer.queryName);
  assert.equal(item.sourceRuntimeConsumer.artifactFamily, sourceRuntimeConsumer.artifactFamily);
  assert.equal(item.sourceRuntimeConsumer.result, sourceRuntimeConsumer.items[0].result);
  assert.equal(item.sourceRuntimeConsumer.reasonCode, sourceRuntimeConsumer.items[0].reasonCode);
  assert.equal(
    item.sourceRuntimeConsumer.sourceDesign.artifactFamily,
    'site-capability-graph-inventory-runtime-integration-design',
  );

  for (const flagName of [
    'featureEnabled',
    'handoffEnabled',
    'runtimeHandoffEnabled',
    'runtimeConsumerEnabled',
    'runtimeGenerationEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
    'schedulerPublishEnabled',
    'doctorPublishEnabled',
    'skillPublishEnabled',
    'mcpPublishEnabled',
    'publishEnabled',
    'sessionMaterializationEnabled',
    'downloaderEnabled',
    'downloaderExecutionEnabled',
    'siteAdapterEnabled',
    'siteAdapterExecutionEnabled',
  ]) {
    assert.equal(item[flagName], false, flagName);
  }

  for (const runtimeField of [
    'artifactPath',
    'browserProfilePath',
    'downloadPolicy',
    'externalCommand',
    'externalTelemetry',
    'inventoryOutputPath',
    'outputPath',
    'publishTarget',
    'repoPath',
    'runtimeArtifactPath',
    'runtimePayload',
    'schedulerPayload',
    'sessionView',
    'siteAdapter',
    'standardTaskList',
    'taskList',
    'downloader',
    'writer',
  ]) {
    assert.equal(Object.hasOwn(item, runtimeField), false, runtimeField);
  }

  for (const { name, options, pattern } of [
    {
      name: 'featureEnabled',
      options: { featureEnabled: true },
      pattern: /featureEnabled must remain false|featureEnabled must be false/i,
    },
    {
      name: 'runtimeGenerationEnabled',
      options: { runtimeGenerationEnabled: true },
      pattern: /runtimeGenerationEnabled must remain false|runtimeGenerationEnabled must be false/i,
    },
    {
      name: 'repoWriteEnabled',
      options: { repoWriteEnabled: true },
      pattern: /repoWriteEnabled must remain false|repoWriteEnabled must be false/i,
    },
    {
      name: 'runtimeArtifactWriteEnabled',
      options: { runtimeArtifactWriteEnabled: true },
      pattern: /runtimeArtifactWriteEnabled must remain false|runtimeArtifactWriteEnabled must be false/i,
    },
    {
      name: 'externalCommandEnabled',
      options: { externalCommandEnabled: true },
      pattern: /externalCommandEnabled must remain false|externalCommandEnabled must be false/i,
    },
    {
      name: 'schedulerPublishEnabled',
      options: { schedulerPublishEnabled: true },
      pattern: /schedulerPublishEnabled must remain false|schedulerPublishEnabled must be false/i,
    },
    {
      name: 'publishEnabled',
      options: { publishEnabled: true },
      pattern: /publishEnabled must remain false|publishEnabled must be false/i,
    },
    {
      name: 'sessionView',
      options: { sessionView: { sessionId: 'synthetic-secret-value' } },
      pattern: /sessionView|descriptor-only|forbidden field/i,
    },
    {
      name: 'downloadPolicy',
      options: { downloadPolicy: { execute: 'synthetic-secret-value' } },
      pattern: /downloadPolicy|descriptor-only|forbidden field/i,
    },
    {
      name: 'siteAdapter',
      options: { siteAdapter: { execute: 'synthetic-secret-value' } },
      pattern: /siteAdapter|descriptor-only|forbidden field/i,
    },
    {
      name: 'downloader',
      options: { downloader: { execute: 'synthetic-secret-value' } },
      pattern: /downloader|descriptor-only|forbidden field/i,
    },
    {
      name: 'externalTelemetry',
      options: { externalTelemetry: { authorizationHeader: 'Bearer synthetic-secret-value' } },
      pattern: /externalTelemetry|descriptor-only|forbidden field|Forbidden sensitive pattern/i,
    },
    {
      name: 'authorizationHeader',
      options: { authorizationHeader: 'Bearer synthetic-secret-value' },
      pattern: /authorizationHeader|forbidden field|Forbidden sensitive pattern|descriptor-only/i,
    },
  ]) {
    const message = captureThrownMessage(() => createHandoffGuard({
      sourcePreflight,
      sourceRuntimeConsumer,
    }, {
      handoffName: 'synthetic-inventory-runtime-consumer-handoff-guard',
      ...options,
    }));
    assert.match(message, pattern, name);
    assert.doesNotMatch(message, /synthetic-secret-value/u, name);
  }

  const unsafeGuard = createHandoffGuard({
    sourcePreflight,
    sourceRuntimeConsumer,
  }, {
    handoffName: 'synthetic-inventory-runtime-consumer-handoff-guard',
  });
  unsafeGuard.items[0].runtimeGenerationEnabled = true;
  assert.throws(
    () => assertHandoffGuardCompatibility(unsafeGuard),
    /runtimeGenerationEnabled must be false|runtimeGenerationEnabled must remain false/u,
  );

  const rendered = JSON.stringify(handoffGuard);
  assert.doesNotMatch(rendered, /synthetic-secret-value|Authorization|Bearer|cookie|csrf|sessionId|browserProfile/iu);
  assert.doesNotMatch(rendered, /"writer"\s*:|"outputPath"\s*:|"sessionView"\s*:|"downloadPolicy"\s*:/u);
  assert.doesNotMatch(rendered, /"externalTelemetry"\s*:|"siteAdapter"\s*:|"downloader"\s*:/u);
});

test('graph core positioning runtime boundary acceptance guard keeps Graph non-executable and stateless', async () => {
  const { create: createPreflight, assertCompatibility: assertPreflightCompatibility } =
    loadFutureGraphLayerConsumerPreflightContractApi();
  const { create: createHandoffGuard, assertCompatibility: assertHandoffGuardCompatibility } =
    loadGraphInventoryRuntimeConsumerHandoffGuardApi();
  const { create: createAcceptanceGuard, assertCompatibility: assertAcceptanceGuardCompatibility } =
    loadGraphCorePositioningRuntimeBoundaryAcceptanceGuardApi();
  const graph = await readMinimalGraphFixture();
  const runtimeDesign = siteCapabilityGraph.createGraphInventoryRuntimeIntegrationDesign(graph, {
    integrationName: 'synthetic-core-positioning-runtime-boundary-acceptance-design',
    inventoryName: 'synthetic-core-positioning-runtime-boundary-acceptance-inventory',
    source: 'synthetic-minimal-graph-fixture',
  });
  const sourceRuntimeConsumer = siteCapabilityGraph.createDisabledGraphInventoryRuntimeConsumerResult(
    runtimeDesign,
    {
      consumerName: 'synthetic-core-positioning-runtime-boundary-disabled-consumer',
      featureEnabled: false,
    },
  );
  const sourcePreflight = createPreflight(sourceRuntimeConsumer, {
    consumerName: 'synthetic-core-positioning-runtime-boundary-preflight',
    descriptorOnly: true,
    featureEnabled: false,
    liveEnabled: false,
    liveRuntimeEnabled: false,
    executionEnabled: false,
    writeEnabled: false,
    repoWriteEnabled: false,
    runtimeArtifactWriteEnabled: false,
    materializationEnabled: false,
    sessionMaterializationEnabled: false,
    credentialMaterializationEnabled: false,
    profileMaterializationEnabled: false,
    downloaderExecutionEnabled: false,
    siteAdapterExecutionEnabled: false,
  });
  const sourceHandoffGuard = createHandoffGuard({
    sourcePreflight,
    sourceRuntimeConsumer,
  }, {
    handoffName: 'synthetic-core-positioning-runtime-boundary-source-handoff-guard',
  });
  const acceptanceGuard = createAcceptanceGuard(sourceHandoffGuard, {
    guardName: 'synthetic-core-positioning-runtime-boundary-acceptance-guard',
  });
  const sourceItem = firstContractItem(sourceHandoffGuard);
  const item = firstContractItem(acceptanceGuard);

  assert.equal(assertPreflightCompatibility(sourcePreflight), true);
  assert.equal(siteCapabilityGraph.assertGraphInventoryRuntimeIntegrationDesignCompatibility(runtimeDesign), true);
  assert.equal(siteCapabilityGraph.assertDisabledGraphInventoryRuntimeConsumerResultCompatibility(sourceRuntimeConsumer), true);
  assert.equal(assertHandoffGuardCompatibility(sourceHandoffGuard), true);
  assert.equal(assertAcceptanceGuardCompatibility(acceptanceGuard), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(acceptanceGuard), true);
  assert.equal(
    acceptanceGuard.queryName,
    'createGraphCorePositioningRuntimeBoundaryAcceptanceGuard',
  );
  assert.equal(
    acceptanceGuard.artifactFamily,
    'site-capability-graph-core-positioning-runtime-boundary-acceptance-guard',
  );
  assert.equal(acceptanceGuard.redactionRequired, true);
  assert.equal(acceptanceGuard.graphVersion, sourceHandoffGuard.graphVersion);
  assert.equal(item.queryName, acceptanceGuard.queryName);
  assert.equal(item.artifactFamily, acceptanceGuard.artifactFamily);
  assert.equal(item.redactionRequired, true);
  assert.equal(item.guardMode ?? item.acceptanceMode ?? item.handoffMode, 'descriptor-only');
  assert.equal(item.result, 'blocked');
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(item.sourceInventoryRuntimeConsumerHandoff.queryName, sourceHandoffGuard.queryName);
  assert.equal(
    item.sourceInventoryRuntimeConsumerHandoff.artifactFamily,
    sourceHandoffGuard.artifactFamily,
  );
  assert.equal(
    item.sourceInventoryRuntimeConsumerHandoff.graphVersion,
    sourceHandoffGuard.graphVersion,
  );
  assert.equal(item.sourceInventoryRuntimeConsumerHandoff.result, sourceItem.result);
  assert.equal(item.sourceInventoryRuntimeConsumerHandoff.reasonCode, sourceItem.reasonCode);
  assert.equal(
    item.requiredPreflightGuard ?? item.requiredGuards?.preflightGuard,
    'assertFutureGraphLayerConsumerPreflightCompatibility',
  );
  assert.equal(
    item.requiredRuntimeConsumerGuard ?? item.requiredGuards?.runtimeConsumerGuard,
    'assertDisabledGraphInventoryRuntimeConsumerResultCompatibility',
  );
  assert.equal(
    item.requiredHandoffGuard ?? item.requiredGuards?.handoffGuard,
    'assertGraphInventoryRuntimeConsumerHandoffGuardCompatibility',
  );
  assert.equal(
    item.requiredCorePositioningAcceptanceGuard ?? item.requiredGuards?.corePositioningAcceptanceGuard,
    'assertGraphCorePositioningRuntimeBoundaryAcceptanceGuardCompatibility',
  );

  for (const flagName of [
    'featureEnabled',
    'graphExecutionAllowed',
    'graphExecutionEnabled',
    'graphQueryExecutionEnabled',
    'executionEnabled',
    'runtimeExecutionEnabled',
    'liveRouteExecutionEnabled',
    'runtimeLayerConsumerEnabled',
    'runtimeConsumerEnabled',
    'liveConsumerEnabled',
    'repoWriteAllowed',
    'repoWriteEnabled',
    'docsWriteEnabled',
    'writeAllowed',
    'writeEnabled',
    'runtimeWriteEnabled',
    'runtimeArtifactWriteAllowed',
    'runtimeArtifactWriteEnabled',
    'repoArtifactWriteEnabled',
    'filesystemWriteEnabled',
    'externalCommandEnabled',
    'taskRunnerEnabled',
    'schedulerPublishEnabled',
    'doctorPublishEnabled',
    'skillPublishEnabled',
    'mcpPublishEnabled',
    'publishEnabled',
    'siteAdapterEnabled',
    'siteAdapterExecutionEnabled',
    'siteAdapterInvocationEnabled',
    'downloaderEnabled',
    'downloaderExecutionEnabled',
    'downloaderInvocationEnabled',
    'sessionAccessEnabled',
    'sessionMaterializationEnabled',
    'sessionViewEnabled',
    'downloadPolicyEnabled',
    'standardTaskListEnabled',
    'profileMaterializationEnabled',
    'credentialMaterializationEnabled',
    'materializationEnabled',
    'dynamicStateEnabled',
    'dynamicStatePersistenceEnabled',
    'statePersistenceEnabled',
    'networkEnabled',
    'externalNetworkEnabled',
    'statusPromotionAllowed',
    'statusPromotionEnabled',
    'verifiedPromotionAllowed',
    'verifiedPromotionEnabled',
  ]) {
    if (Object.hasOwn(item, flagName)) {
      assert.equal(item[flagName], false, flagName);
    }
  }

  for (const runtimeField of [
    'artifactPath',
    'browserProfilePath',
    'downloadPolicy',
    'externalCommand',
    'externalNetwork',
    'externalTelemetry',
    'graphExecutor',
    'handler',
    'inventoryOutputPath',
    'networkClient',
    'outputPath',
    'profileMaterialization',
    'repoPath',
    'runtimeArtifactPath',
    'runtimePayload',
    'runtimeState',
    'runtimeStateStore',
    'schedulerPayload',
    'sessionView',
    'siteAdapter',
    'standardTaskList',
    'statePersistence',
    'taskList',
    'taskRunner',
    'downloader',
    'writer',
  ]) {
    assert.equal(Object.hasOwn(item, runtimeField), false, runtimeField);
  }

  for (const { name, options, pattern } of [
    {
      name: 'graphExecutionEnabled',
      options: { graphExecutionEnabled: true },
      pattern: /graphExecutionEnabled must remain false|graphExecutionEnabled must be false/i,
    },
    {
      name: 'runtimeLayerConsumerEnabled',
      options: { runtimeLayerConsumerEnabled: true },
      pattern: /runtimeLayerConsumerEnabled must remain false|runtimeLayerConsumerEnabled must be false/i,
    },
    {
      name: 'repoWriteEnabled',
      options: { repoWriteEnabled: true },
      pattern: /repoWriteEnabled must remain false|repoWriteEnabled must be false/i,
    },
    {
      name: 'docsWriteEnabled',
      options: { docsWriteEnabled: true },
      pattern: /docsWriteEnabled must remain false|docsWriteEnabled must be false/i,
    },
    {
      name: 'runtimeArtifactWriteEnabled',
      options: { runtimeArtifactWriteEnabled: true },
      pattern: /runtimeArtifactWriteEnabled must remain false|runtimeArtifactWriteEnabled must be false/i,
    },
    {
      name: 'externalCommandEnabled',
      options: { externalCommandEnabled: true },
      pattern: /externalCommandEnabled must remain false|externalCommandEnabled must be false/i,
    },
    {
      name: 'taskRunnerEnabled',
      options: { taskRunnerEnabled: true },
      pattern: /taskRunnerEnabled must remain false|taskRunnerEnabled must be false/i,
    },
    {
      name: 'statePersistenceEnabled',
      options: { statePersistenceEnabled: true },
      pattern: /statePersistenceEnabled must remain false|statePersistenceEnabled must be false/i,
    },
    {
      name: 'externalNetworkEnabled',
      options: { externalNetworkEnabled: true },
      pattern: /externalNetworkEnabled must remain false|externalNetworkEnabled must be false/i,
    },
    {
      name: 'sessionView',
      options: { sessionView: { sessionId: 'synthetic-secret-value' } },
      pattern: /sessionView|descriptor-only|forbidden field/i,
    },
    {
      name: 'downloadPolicy',
      options: { downloadPolicy: { execute: 'synthetic-secret-value' } },
      pattern: /downloadPolicy|descriptor-only|forbidden field/i,
    },
    {
      name: 'standardTaskList',
      options: { standardTaskList: [{ token: 'synthetic-secret-value' }] },
      pattern: /standardTaskList|descriptor-only|forbidden field|Forbidden sensitive pattern/i,
    },
    {
      name: 'siteAdapter',
      options: { siteAdapter: { execute: 'synthetic-secret-value' } },
      pattern: /siteAdapter|descriptor-only|forbidden field/i,
    },
    {
      name: 'downloader',
      options: { downloader: { execute: 'synthetic-secret-value' } },
      pattern: /downloader|descriptor-only|forbidden field/i,
    },
    {
      name: 'runtimeState',
      options: { runtimeState: { token: 'synthetic-secret-value' } },
      pattern: /runtimeState|descriptor-only|forbidden field|Forbidden sensitive pattern/i,
    },
    {
      name: 'authorizationHeader',
      options: { authorizationHeader: 'Bearer synthetic-secret-value' },
      pattern: /authorizationHeader|forbidden field|Forbidden sensitive pattern|descriptor-only/i,
    },
  ]) {
    const message = captureThrownMessage(() => createAcceptanceGuard(sourceHandoffGuard, {
      guardName: 'synthetic-core-positioning-runtime-boundary-acceptance-guard',
      ...options,
    }));
    assert.match(message, pattern, name);
    assert.doesNotMatch(message, /synthetic-secret-value/u, name);
  }

  const unsafeGuard = createAcceptanceGuard(sourceHandoffGuard, {
    guardName: 'synthetic-core-positioning-runtime-boundary-acceptance-guard',
  });
  unsafeGuard.items[0].graphExecutionEnabled = true;
  assert.throws(
    () => assertAcceptanceGuardCompatibility(unsafeGuard),
    /graphExecutionEnabled must be false|graphExecutionEnabled must remain false/u,
  );

  const rendered = JSON.stringify(acceptanceGuard);
  assert.doesNotMatch(rendered, /synthetic-secret-value|Authorization:|Bearer|csrf=/iu);
  assert.doesNotMatch(rendered, /"writer"\s*:|"outputPath"\s*:|"sessionView"\s*:|"downloadPolicy"\s*:/u);
  assert.doesNotMatch(rendered, /"standardTaskList"\s*:|"runtimePayload"\s*:|"runtimeState"\s*:/u);
  assert.doesNotMatch(rendered, /"externalTelemetry"\s*:|"externalNetwork"\s*:|"siteAdapter"\s*:|"downloader"\s*:/u);
});

test('graph aggregate execution boundary guard stays descriptor-only blocked and records Layer as execution entrypoint', async () => {
  const {
    create: createAggregateGuard,
    assertCompatibility,
  } = loadGraphAggregateExecutionBoundaryGuardApi();
  const sourceCorePositioningGuard =
    await createCorePositioningRuntimeBoundaryAcceptanceGuardForAggregateExecutionBoundary();
  const guard = createGraphAggregateExecutionBoundaryGuard(
    createAggregateGuard,
    sourceCorePositioningGuard,
    {
      guardName: 'synthetic-aggregate-execution-boundary-guard',
    },
  );
  const item = firstContractItem(guard);

  assert.equal(assertCompatibility(guard), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(guard), true);
  assert.equal(guard.queryName, 'createGraphAggregateExecutionBoundaryGuard');
  assert.equal(
    guard.artifactFamily,
    'site-capability-graph-aggregate-execution-boundary-guard',
  );
  assert.equal(guard.redactionRequired, true);
  assert.equal(guard.graphVersion, sourceCorePositioningGuard.graphVersion);
  assert.equal(item.queryName ?? guard.queryName, guard.queryName);
  assert.equal(item.redactionRequired, true);
  assert.equal(item.guardMode ?? item.boundaryMode ?? item.executionMode, 'descriptor-only');
  assert.equal(item.result, 'blocked');
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(
    item.layerExecutionEntrypoint ?? item.executionEntrypoint ?? item.executionEntryPoint,
    'Layer',
  );
  assert.equal(
    item.graphExecutionRole ?? item.graphExecutionBoundary,
    item.graphExecutionRole ?? item.graphExecutionBoundary,
  );
  assert.equal(
    item.sourceCorePositioningRuntimeBoundaryAcceptanceGuard?.queryName,
    sourceCorePositioningGuard.queryName,
  );
  assert.equal(
    item.sourceCorePositioningRuntimeBoundaryAcceptanceGuard?.graphVersion,
    sourceCorePositioningGuard.graphVersion,
  );

  for (const flagName of [
    'graphExecutionEnabled',
    'executionEnabled',
    'runtimeExecutionEnabled',
    'routeExecutionEnabled',
    'liveRouteExecutionEnabled',
    'layerBypassEnabled',
    'layerExecutionReplacementAllowed',
    'runtimeLayerConsumerEnabled',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'sessionMaterializationEnabled',
    'repoWriteEnabled',
    'docsWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalDispatchEnabled',
    'externalTelemetryEnabled',
    'taskRunnerEnabled',
    'statePersistenceEnabled',
    'dynamicRuntimeStateStored',
    'credentialMaterializationEnabled',
    'profileMaterializationEnabled',
  ]) {
    if (Object.hasOwn(item, flagName)) {
      assert.equal(item[flagName], false, flagName);
    }
  }

  for (const runtimeField of [
    'graphExecution',
    'execute',
    'handler',
    'taskRunner',
    'siteAdapter',
    'downloader',
    'sessionView',
    'downloadPolicy',
    'standardTaskList',
    'repoPath',
    'outputPath',
    'runtimeArtifact',
    'rawPayload',
    'unredactedPayload',
    'browserProfile',
    'token',
    'cookie',
    'authorization',
  ]) {
    assert.equal(Object.hasOwn(item, runtimeField), false, runtimeField);
  }

  const rendered = JSON.stringify(guard);
  assert.doesNotMatch(rendered, /synthetic-secret-value|Authorization|Bearer|cookie|csrf|sessionId|browserProfile/iu);
  assert.doesNotMatch(rendered, /"graphExecution"\s*:|"execute"\s*:|"handler"\s*:|"taskRunner"\s*:/u);
  assert.doesNotMatch(rendered, /"siteAdapter"\s*:|"downloader"\s*:|"sessionView"\s*:|"downloadPolicy"\s*:/u);
  assert.doesNotMatch(rendered, /"repoPath"\s*:|"outputPath"\s*:|"runtimeArtifact"\s*:|"rawPayload"\s*:/u);
});

test('graph aggregate execution boundary guard rejects enabled execution layer-bypass write and runtime flags', async () => {
  const {
    create: createAggregateGuard,
  } = loadGraphAggregateExecutionBoundaryGuardApi();
  const sourceCorePositioningGuard =
    await createCorePositioningRuntimeBoundaryAcceptanceGuardForAggregateExecutionBoundary();

  for (const flagName of [
    'graphExecutionEnabled',
    'executionEnabled',
    'runtimeExecutionEnabled',
    'routeExecutionEnabled',
    'liveRouteExecutionEnabled',
    'layerBypassEnabled',
    'layerExecutionReplacementAllowed',
    'runtimeLayerConsumerEnabled',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'sessionMaterializationEnabled',
    'repoWriteEnabled',
    'docsWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalDispatchEnabled',
    'externalTelemetryEnabled',
    'taskRunnerEnabled',
    'statePersistenceEnabled',
    'dynamicRuntimeStateStored',
    'credentialMaterializationEnabled',
    'profileMaterializationEnabled',
  ]) {
    const message = captureThrownMessage(
      () => createGraphAggregateExecutionBoundaryGuard(
        createAggregateGuard,
        sourceCorePositioningGuard,
        { [flagName]: true },
      ),
    );
    assert.match(message, /must remain false|must be false|descriptor-only|disabled|boundary|execution/i, flagName);
    assert.doesNotMatch(message, /synthetic-secret-value/u, flagName);
  }
});

test('graph aggregate execution boundary guard rejects runtime payloads and synthetic sensitive material without echoing it', async () => {
  const {
    create: createAggregateGuard,
  } = loadGraphAggregateExecutionBoundaryGuardApi();
  const sourceCorePositioningGuard =
    await createCorePositioningRuntimeBoundaryAcceptanceGuardForAggregateExecutionBoundary();

  for (const fieldName of [
    'graphExecution',
    'execute',
    'handler',
    'taskRunner',
    'siteAdapter',
    'downloader',
    'sessionView',
    'downloadPolicy',
    'standardTaskList',
    'repoPath',
    'outputPath',
    'runtimeArtifact',
    'rawPayload',
    'unredactedPayload',
    'browserProfile',
    'token',
    'cookie',
    'authorization',
  ]) {
    const message = captureThrownMessage(
      () => createGraphAggregateExecutionBoundaryGuard(
        createAggregateGuard,
        sourceCorePositioningGuard,
        {
          [fieldName]: {
            value: 'synthetic-redacted-value',
          },
        },
      ),
    );
    assert.match(message, /descriptor-only|forbidden field|Forbidden sensitive pattern|runtime|execution|payload/i, fieldName);
    assert.match(message, new RegExp(fieldName, 'iu'), fieldName);
    assert.doesNotMatch(message, /synthetic-secret-value/u, fieldName);
  }

  for (const fieldName of [
    'Authorization',
    'authorizationHeader',
    'cookie',
    'csrf',
    'csrfToken',
    'token',
    'sessionId',
    'browserProfile',
  ]) {
    const message = captureThrownMessage(
      () => createGraphAggregateExecutionBoundaryGuard(
        createAggregateGuard,
        sourceCorePositioningGuard,
        {
          [fieldName]: 'synthetic-secret-value',
        },
      ),
    );
    assert.match(message, /forbidden field|Forbidden sensitive pattern|sensitive|descriptor-only/i, fieldName);
    assert.match(message, new RegExp(fieldName, 'iu'), fieldName);
    assert.doesNotMatch(message, /synthetic-secret-value/u, fieldName);
  }
});

test('Graph/Layer aggregate execution boundary handoff review gate consumes aggregate safe summary only', async () => {
  const {
    create: createReviewGate,
    assertCompatibility,
  } = loadGraphLayerAggregateExecutionBoundaryHandoffReviewGateApi();
  const sourceAggregateGuard =
    await createAggregateExecutionBoundaryGuardForLayerHandoffReviewGate();
  const gate = createGraphLayerAggregateExecutionBoundaryHandoffReviewGate(
    createReviewGate,
    sourceAggregateGuard,
    {
      reviewGateName: 'synthetic-graph-layer-aggregate-boundary-handoff-review-gate',
    },
  );
  const item = firstContractItem(gate);
  const sourceSummary =
    gate.sourceAggregateExecutionBoundarySafeSummary
    ?? gate.sourceAggregateExecutionBoundarySummary
    ?? gate.sourceAggregateExecutionBoundaryGuardSummary
    ?? item.sourceAggregateExecutionBoundarySafeSummary
    ?? item.sourceAggregateExecutionBoundarySummary
    ?? item.sourceAggregateExecutionBoundaryGuardSummary
    ?? item.sourceAggregateExecutionBoundaryGuard;

  assert.equal(assertCompatibility(gate), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(gate), true);
  assert.equal(
    gate.queryName,
    'createGraphLayerAggregateExecutionBoundaryHandoffReviewGate',
  );
  assert.equal(
    gate.artifactFamily,
    'site-capability-graph-layer-aggregate-execution-boundary-handoff-review-gate',
  );
  assert.equal(gate.redactionRequired, true);
  assert.equal(gate.descriptorOnly ?? item.descriptorOnly, true);
  assert.equal(gate.result ?? item.result, 'blocked');
  assert.equal(gate.reasonCode ?? item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(item.redactionRequired, true);
  assert.equal(item.descriptorOnly ?? item.gateMode, item.descriptorOnly ?? item.gateMode);
  assert.equal(item.result, 'blocked');
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(sourceSummary?.redactionRequired, true);
  assert.equal(sourceSummary?.result, 'blocked');
  assert.equal(sourceSummary?.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(
    sourceSummary?.queryName,
    'createGraphAggregateExecutionBoundaryGuard',
  );
  assert.equal(
    sourceSummary?.artifactFamily,
    'site-capability-graph-aggregate-execution-boundary-guard',
  );
  assert.equal(Object.hasOwn(sourceSummary, 'items'), false);
  assert.equal(
    Object.hasOwn(sourceSummary, 'sourceCorePositioningRuntimeBoundaryAcceptanceGuard'),
    false,
  );

  for (const flagName of [
    'routeExecutionEnabled',
    'taskExecutionEnabled',
    'runtimeExecutionEnabled',
    'layerRuntimeConsumerEnabled',
    'runtimeLayerConsumerEnabled',
    'callbackEnabled',
    'handlerEnabled',
    'repoWriteEnabled',
    'docsWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalTelemetryEnabled',
    'externalDispatchEnabled',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'sessionMaterializationEnabled',
    'downloadPolicyMaterialized',
    'standardTaskListMaterialized',
  ]) {
    if (Object.hasOwn(gate, flagName)) {
      assert.equal(gate[flagName], false, flagName);
    }
    if (Object.hasOwn(item, flagName)) {
      assert.equal(item[flagName], false, flagName);
    }
  }

  const rendered = JSON.stringify(gate);
  assert.doesNotMatch(rendered, /synthetic-secret-value|Authorization|Bearer|cookie|csrf|sessionId|browserProfile/iu);
  assert.doesNotMatch(rendered, /"route"\s*:|"task"\s*:|"execute"\s*:|"handler"\s*:|"callback"\s*:/u);
  assert.doesNotMatch(rendered, /"repoPath"\s*:|"docsOutputPath"\s*:|"runtimeArtifactPath"\s*:|"outputPath"\s*:/u);
  assert.doesNotMatch(rendered, /"externalTelemetry"\s*:|"externalDispatch"\s*:|"SiteAdapter"\s*:|"siteAdapter"\s*:/u);
  assert.doesNotMatch(rendered, /"downloader"\s*:|"SessionView"\s*:|"sessionView"\s*:|"DownloadPolicy"\s*:/u);
  assert.doesNotMatch(rendered, /"downloadPolicy"\s*:|"StandardTaskList"\s*:|"standardTaskList"\s*:/u);
});

test('Graph/Layer aggregate execution boundary handoff review gate rejects runtime handoff products', async () => {
  const {
    create: createReviewGate,
  } = loadGraphLayerAggregateExecutionBoundaryHandoffReviewGateApi();
  const sourceAggregateGuard =
    await createAggregateExecutionBoundaryGuardForLayerHandoffReviewGate();

  for (const flagName of [
    'routeExecutionEnabled',
    'taskExecutionEnabled',
    'executionEnabled',
    'runtimeExecutionEnabled',
    'layerRuntimeConsumerEnabled',
    'runtimeLayerConsumerEnabled',
    'LayerRuntimeConsumerEnabled',
    'callbackEnabled',
    'handlerEnabled',
    'repoWriteEnabled',
    'docsWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'writeEnabled',
    'externalTelemetryEnabled',
    'externalDispatchEnabled',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'sessionMaterializationEnabled',
    'downloadPolicyMaterialized',
    'standardTaskListMaterialized',
  ]) {
    const message = captureThrownMessage(
      () => createGraphLayerAggregateExecutionBoundaryHandoffReviewGate(
        createReviewGate,
        sourceAggregateGuard,
        { [flagName]: true },
      ),
    );
    assert.match(message, /must remain false|must be false|descriptor-only|blocked|review|gate|handoff|runtime|execution/i, flagName);
    assert.doesNotMatch(message, /synthetic-sensitive-review-gate-material/u, flagName);
  }

  for (const fieldName of [
    'route',
    'routeExecution',
    'task',
    'taskExecution',
    'execute',
    'executor',
    'LayerRuntimeConsumer',
    'layerRuntimeConsumer',
    'runtimeConsumer',
    'callback',
    'consumerCallback',
    'handler',
    'repoPath',
    'docsOutputPath',
    'runtimeArtifactPath',
    'outputPath',
    'writer',
    'externalTelemetry',
    'telemetryDispatch',
    'externalDispatch',
    'SiteAdapter',
    'siteAdapter',
    'downloader',
    'SessionView',
    'sessionView',
    'DownloadPolicy',
    'downloadPolicy',
    'StandardTaskList',
    'standardTaskList',
    'taskList',
  ]) {
    const message = captureThrownMessage(
      () => createGraphLayerAggregateExecutionBoundaryHandoffReviewGate(
        createReviewGate,
        sourceAggregateGuard,
        {
          [fieldName]: {
            value: 'synthetic-redacted-review-gate-value',
          },
        },
      ),
    );
    assert.match(message, /descriptor-only|forbidden|runtime|execution|write|dispatch|review|gate|handoff|consumer|payload/i, fieldName);
    assert.match(message, new RegExp(fieldName, 'iu'), fieldName);
    assert.doesNotMatch(message, /synthetic-redacted-review-gate-value/u, fieldName);
  }
});

test('Graph/Layer aggregate execution boundary handoff review gate rejects synthetic sensitive material without echoing it', async () => {
  const {
    create: createReviewGate,
  } = loadGraphLayerAggregateExecutionBoundaryHandoffReviewGateApi();
  const sourceAggregateGuard =
    await createAggregateExecutionBoundaryGuardForLayerHandoffReviewGate();

  for (const fieldName of [
    'Authorization',
    'authorizationHeader',
    'cookie',
    'csrf',
    'csrfToken',
    'token',
    'sessionId',
    'SESSDATA',
    'browserProfile',
    'browserProfilePath',
    'credential',
    'credentials',
  ]) {
    const message = captureThrownMessage(
      () => createGraphLayerAggregateExecutionBoundaryHandoffReviewGate(
        createReviewGate,
        sourceAggregateGuard,
        {
          [fieldName]: 'synthetic-sensitive-review-gate-material',
        },
      ),
    );
    assert.match(message, /forbidden|Forbidden sensitive pattern|sensitive|descriptor-only|review|gate|handoff|runtime/i, fieldName);
    assert.match(message, new RegExp(fieldName, 'iu'), fieldName);
    assert.doesNotMatch(message, /synthetic-sensitive-review-gate-material/u, fieldName);
  }
});

test('graph core positioning boundary guard keeps inventory outputs non-executable and dry-run-only', async () => {
  const { create, assertCompatibility } = loadGraphCorePositioningBoundaryGuardApi();
  const graph = await readMinimalGraphFixture();
  const docsArtifact = createGraphDocsMarkdownArtifact(generateGraphDocsSummary(graph));
  const baseOptions = {
    boundaryName: 'synthetic-section-1-core-positioning-boundary',
    descriptorOnly: true,
    featureEnabled: false,
    repoWriteEnabled: false,
    docsWriteEnabled: false,
    runtimeArtifactWriteEnabled: false,
    graphExecutionEnabled: false,
    taskRunnerEnabled: false,
    sessionMaterializationEnabled: false,
    downloaderExecutionEnabled: false,
    siteAdapterExecutionEnabled: false,
  };

  const sourcePreflight = siteCapabilityGraph.createFutureGraphLayerConsumerPreflightContract(
    docsArtifact,
    { consumerName: 'synthetic-section-1-core-positioning-preflight' },
  );
  const repoOutputDryRun = siteCapabilityGraph.createGraphInventoryRepoOutputDryRun(graph, {
    inventoryName: 'synthetic-section-1-core-positioning-inventory',
    targetRelativePath: 'docs/site-capability-graph/generated-inventory.json',
    repoWriteEnabled: false,
    runtimeGenerationEnabled: false,
    runtimeArtifactWriteEnabled: false,
    externalCommandEnabled: false,
  });
  const guard = create({ sourcePreflight, repoOutputDryRun }, baseOptions);
  assert.equal(assertCompatibility(guard), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(guard), true);

  const item = firstContractItem(guard);
  assert.equal(item.descriptorOnly, true);
  assert.equal(item.result, 'blocked');
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(item.sourcePreflightFamily, 'site-capability-graph-future-layer-consumer-preflight-contract');
  assert.equal(item.sourceRepoOutputFamily, 'site-capability-graph-inventory-repo-output-dry-run');
  assert.equal(item.sourceRepoOutputDryRunOnly, true);
  assert.equal(item.sourceRepoOutputDryRunDescriptor.repoWriteEnabled, false);
  assert.equal(item.sourceRepoOutputDryRunDescriptor.runtimeArtifactWriteEnabled, false);
  for (const flagName of [
    'featureEnabled',
    'repoWriteEnabled',
    'docsWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'graphExecutionEnabled',
    'taskRunnerEnabled',
    'sessionMaterializationEnabled',
    'downloaderExecutionEnabled',
    'siteAdapterExecutionEnabled',
  ]) {
    assert.equal(item[flagName], false, flagName);
  }

  for (const runtimeField of [
    'artifactPath',
    'docsOutputPath',
    'downloadPolicy',
    'execute',
    'graphExecution',
    'handler',
    'repoPath',
    'runtimeArtifactPath',
    'sessionView',
    'siteAdapter',
    'standardTaskList',
    'taskList',
    'taskRunner',
    'downloader',
    'writer',
  ]) {
    assert.equal(Object.hasOwn(item, runtimeField), false, runtimeField);
  }

  const descriptorJson = JSON.stringify(guard);
  assert.doesNotMatch(
    descriptorJson,
    /synthetic-secret-value|Authorization|Bearer|SESSDATA|cookie|csrf|sessionId|browserProfilePath|userDataDir/iu,
  );
  assert.doesNotMatch(
    descriptorJson,
    /Graph execution enabled|task runner enabled|SiteAdapter invoked|downloader invoked|repo writes enabled|runtime artifact writes enabled/iu,
  );

  for (const { name, options, pattern } of [
    {
      name: 'repoWriteEnabled',
      options: { repoWriteEnabled: true },
      pattern: /repoWriteEnabled must remain false|descriptor-only/i,
    },
    {
      name: 'docsWriteEnabled',
      options: { docsWriteEnabled: true },
      pattern: /docsWriteEnabled must remain false|descriptor-only/i,
    },
    {
      name: 'runtimeArtifactWriteEnabled',
      options: { runtimeArtifactWriteEnabled: true },
      pattern: /runtimeArtifactWriteEnabled must remain false|descriptor-only/i,
    },
    {
      name: 'graphExecution',
      options: { graphExecution: { execute: 'synthetic-secret-value' } },
      pattern: /graphExecution|Graph execution|descriptor-only|forbidden field/i,
    },
    {
      name: 'taskRunner',
      options: { taskRunner: { run: 'synthetic-secret-value' } },
      pattern: /taskRunner|task runner|descriptor-only/i,
    },
    {
      name: 'sessionView',
      options: { sessionView: { sessionId: 'synthetic-secret-value' } },
      pattern: /sessionView|session materialization|descriptor-only|forbidden field/i,
    },
    {
      name: 'downloadPolicy',
      options: { downloadPolicy: { execute: 'synthetic-secret-value' } },
      pattern: /downloadPolicy|downloader|descriptor-only|forbidden field/i,
    },
    {
      name: 'siteAdapter',
      options: { siteAdapter: { execute: 'synthetic-secret-value' } },
      pattern: /siteAdapter|SiteAdapter|descriptor-only|forbidden field/i,
    },
    {
      name: 'downloader',
      options: { downloader: { execute: 'synthetic-secret-value' } },
      pattern: /downloader|descriptor-only|forbidden field/i,
    },
    {
      name: 'authorizationHeader',
      options: { authorizationHeader: 'Bearer synthetic-secret-value' },
      pattern: /authorizationHeader|forbidden field|descriptor-only/i,
    },
    {
      name: 'cookie',
      options: { cookie: 'synthetic-secret-value' },
      pattern: /cookie|forbidden field|descriptor-only/i,
    },
    {
      name: 'browserProfilePath',
      options: { browserProfilePath: 'synthetic-secret-value' },
      pattern: /browserProfilePath|forbidden field|descriptor-only/i,
    },
  ]) {
    const message = captureThrownMessage(() => create({ sourcePreflight, repoOutputDryRun }, {
      ...baseOptions,
      ...options,
    }));
    assert.match(message, pattern, name);
    assert.doesNotMatch(message, /synthetic-secret-value/u, name);
  }

  const mutatedGuard = create({ sourcePreflight, repoOutputDryRun }, baseOptions);
  mutatedGuard.items[0].repoWriteEnabled = true;
  assert.throws(
    () => assertCompatibility(mutatedGuard),
    /repoWriteEnabled must be false|repoWriteEnabled must remain false/u,
  );
});

test('graph artifact guard reasonCodes remain fail-closed', () => {
  for (const code of [
    'graph-artifact-redaction-required',
    'graph-docs-generation-failed',
  ]) {
    const definition = requireReasonCodeDefinition(code, { family: 'graph' });
    assert.equal(definition.retryable, false);
    assert.equal(definition.manualRecoveryNeeded, true);
    assert.equal(definition.artifactWriteAllowed, false);
  }
});
