import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  GRAPH_EDGE_SCHEMA_VERSION,
  GRAPH_MANIFEST_SCHEMA_VERSION,
  GRAPH_NODE_SCHEMA_VERSION,
  GRAPH_NODE_TYPES,
  GRAPH_QUERY_RESULT_SCHEMA_VERSION,
  GRAPH_VALIDATION_REPORT_SCHEMA_VERSION,
  SITE_CAPABILITY_GRAPH_SCHEMA_VERSION,
  assertCapabilityNodeCompatible,
  assertEndpointNodeCompatible,
  assertFailureModeNodeCompatible,
  assertGraphEdgeCompatible,
  assertGraphManifestCompatible,
  assertGraphNodeCompatible,
  assertGraphQueryResultCompatible,
  assertRouteNodeCompatible,
  assertGraphValidationReportCompatible,
  assertSiteCapabilityGraphCompatible,
  listSiteCapabilityGraphSchemaDefinitions,
} from '../../src/domain/capabilities/site-capability-graph.mjs';

const MINIMAL_GRAPH_URL = new URL('./fixtures/site-capability-graph/minimal-v1.json', import.meta.url);
const DESIGN_REQUIRED_SCHEMA_NAMES = [
  'SiteCapabilityGraph',
  'GraphManifest',
  'SiteNode',
  'CapabilityNode',
  'RouteNode',
  'EndpointNode',
  'AuthRequirementNode',
  'SessionRequirementNode',
  'SignerNode',
  'RiskPolicyNode',
  'SchemaNode',
  'ArtifactContractNode',
  'TestEvidenceNode',
  'VersionNode',
  'FailureModeNode',
  'ObservabilityNode',
  'GraphEdge',
  'GraphValidationReport',
  'GraphQueryResult',
];
const EXECUTION_SPEC_SCHEMA_ALIASES = [
  'ArtifactNode',
  'TestNode',
];

async function readMinimalGraphFixture() {
  return JSON.parse(await readFile(MINIMAL_GRAPH_URL, 'utf8'));
}

test('Site Capability Graph schema definitions are versioned and cover required graph contracts', () => {
  const definitions = listSiteCapabilityGraphSchemaDefinitions();
  const byName = new Map(definitions.map((entry) => [entry.name, entry]));

  for (const name of [
    'GraphNode',
    ...DESIGN_REQUIRED_SCHEMA_NAMES,
    ...EXECUTION_SPEC_SCHEMA_ALIASES,
    ...GRAPH_NODE_TYPES,
  ]) {
    const entry = byName.get(name);
    assert.notEqual(entry, undefined, `${name} schema should be listed`);
    assert.equal(entry.version, 1);
    assert.equal(entry.sourcePath, 'src/domain/capabilities/site-capability-graph.mjs');
  }
});

test('minimal synthetic graph fixture is schema-compatible and descriptor-only', async () => {
  const graph = await readMinimalGraphFixture();

  assert.equal(assertSiteCapabilityGraphCompatible(graph), true);
  assert.equal(graph.schemaVersion, SITE_CAPABILITY_GRAPH_SCHEMA_VERSION);
  assert.equal(graph.manifest.schemaVersion, GRAPH_MANIFEST_SCHEMA_VERSION);

  const serialized = JSON.stringify(graph);
  assert.doesNotMatch(
    serialized,
    /SESSDATA|Authorization|Cookie|csrf|access_token|refresh_token|sessionid|browserProfilePath|userDataDir|deviceFingerprint|accountId|ipAddress/iu,
  );
  assert.doesNotMatch(serialized, /\b(?:handler|execute|executor|taskRunner)\b/iu);
});

test('graph node and edge schemas reject missing versions and unsupported types', () => {
  assert.throws(
    () => assertGraphNodeCompatible({
      id: 'node:missing-version',
      type: 'SiteNode',
      siteKey: 'synthetic.example',
      hostFamily: ['synthetic.example'],
    }),
    /GraphNode schemaVersion is required/u,
  );

  assert.throws(
    () => assertGraphNodeCompatible({
      schemaVersion: GRAPH_NODE_SCHEMA_VERSION,
      id: 'node:unsupported',
      type: 'TaskRunnerNode',
    }),
    /GraphNode type is unsupported/u,
  );

  assert.throws(
    () => assertGraphEdgeCompatible({
      schemaVersion: GRAPH_EDGE_SCHEMA_VERSION,
      id: 'edge:unsupported',
      type: 'executes_task',
      from: 'a',
      to: 'b',
    }),
    /GraphEdge type is unsupported/u,
  );
});

test('FailureModeNode schema accepts catalog deprecation descriptors without catalog mutation', () => {
  const failureMode = {
    schemaVersion: GRAPH_NODE_SCHEMA_VERSION,
    id: 'failure:graph-catalog-entry-expired',
    type: 'FailureModeNode',
    reasonCode: 'api-catalog-endpoint-expired',
    retryable: true,
    cooldownRequired: false,
    isolationRequired: false,
    manualRecoveryRequired: false,
    degradable: true,
    artifactWriteAllowed: true,
    catalogAction: 'deprecate',
  };

  assert.equal(assertFailureModeNodeCompatible(failureMode), true);
  assert.equal(assertFailureModeNodeCompatible({ ...failureMode, catalogAction: 'none' }), true);
  assert.equal(assertFailureModeNodeCompatible({ ...failureMode, catalogAction: 'block' }), true);
  assert.equal(assertFailureModeNodeCompatible({ ...failureMode, catalogAction: undefined }), true);
  assert.throws(
    () => assertFailureModeNodeCompatible({ ...failureMode, catalogAction: 'promote' }),
    /FailureModeNode catalogAction is unsupported/u,
  );
  assert.throws(
    () => assertFailureModeNodeCompatible({
      ...failureMode,
      catalogAction: 'Authorization: Bearer synthetic-secret-value',
    }),
    (error) => {
      // @ts-ignore
      assert.match(error.message, /FailureModeNode catalogAction is unsupported/u);
      // @ts-ignore
      assert.doesNotMatch(error.message, /Authorization|synthetic-secret-value/u);
      return true;
    },
  );

  assert.doesNotMatch(
    JSON.stringify(failureMode),
    /catalog mutation|catalog write|catalog promotion|runtime deprecation|route execution|downloader|SessionView/u,
  );
});

test('CapabilityNode schema accepts agent-exposed descriptor fields without execution authority', () => {
  assert.equal(assertCapabilityNodeCompatible({
    schemaVersion: GRAPH_NODE_SCHEMA_VERSION,
    id: 'capability:synthetic.example:read',
    type: 'CapabilityNode',
    siteKey: 'synthetic.example',
    capabilityKey: 'read',
    capabilityFamily: 'navigate-to-author',
    mode: 'readOnly',
    requiresApproval: false,
    supportedTaskTypes: ['open-page'],
    routeRefs: ['route:synthetic.example:public'],
    authRequirementRefs: ['auth:synthetic.example:none'],
    sessionRequirementRefs: ['session:synthetic.example:none'],
    riskPolicyRef: 'risk-policy:synthetic.example:normal',
    agentExposed: true,
    testEvidenceRefs: ['test:site-capability-graph-schema'],
  }), true);

  assert.throws(
    () => assertCapabilityNodeCompatible({
      schemaVersion: GRAPH_NODE_SCHEMA_VERSION,
      id: 'capability:synthetic.example:agent-string',
      type: 'CapabilityNode',
      siteKey: 'synthetic.example',
      capabilityKey: 'agent-string',
      capabilityFamily: 'navigate-to-author',
      mode: 'readOnly',
      requiresApproval: false,
      supportedTaskTypes: ['open-page'],
      routeRefs: ['route:synthetic.example:public'],
      riskPolicyRef: 'risk-policy:synthetic.example:normal',
      agentExposed: 'true',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    }),
    /agentExposed.*boolean/u,
  );

  assert.throws(
    () => assertCapabilityNodeCompatible({
      schemaVersion: GRAPH_NODE_SCHEMA_VERSION,
      id: 'capability:synthetic.example:execute',
      type: 'CapabilityNode',
      siteKey: 'synthetic.example',
      capabilityKey: 'execute',
      capabilityFamily: 'download-content',
      mode: 'download',
      requiresApproval: true,
      supportedTaskTypes: ['download-media'],
      routeRefs: ['route:synthetic.example:download'],
      riskPolicyRef: 'risk-policy:synthetic.example:normal',
      handler: 'should-not-exist',
    }),
    /forbidden field/u,
  );
});

test('RouteNode schema accepts descriptor-only fallback route refs', () => {
  assert.equal(assertRouteNodeCompatible({
    schemaVersion: GRAPH_NODE_SCHEMA_VERSION,
    id: 'route:synthetic.example:primary',
    type: 'RouteNode',
    siteKey: 'synthetic.example',
    routeKind: 'page',
    urlPattern: 'https://synthetic.example/primary/:id',
    pageType: 'public-detail',
    capabilityRefs: ['capability:synthetic.example:read'],
    fallbackRouteRefs: ['route:synthetic.example:fallback'],
    adapterRef: {
      id: 'synthetic-adapter',
      version: 'synthetic-adapter-v1',
    },
    riskPolicyRef: 'risk-policy:synthetic.example:normal',
    testEvidenceRefs: ['test:site-capability-graph-schema'],
  }), true);

  assert.throws(
    () => assertRouteNodeCompatible({
      schemaVersion: GRAPH_NODE_SCHEMA_VERSION,
      id: 'route:synthetic.example:primary',
      type: 'RouteNode',
      siteKey: 'synthetic.example',
      routeKind: 'page',
      urlPattern: 'https://synthetic.example/primary/:id',
      pageType: 'public-detail',
      capabilityRefs: ['capability:synthetic.example:read'],
      fallbackRouteRefs: 'route:synthetic.example:fallback',
      riskPolicyRef: 'risk-policy:synthetic.example:normal',
    }),
    /fallbackRouteRefs must be an array/u,
  );
});

test('EndpointNode schema requires design-declared requirement and version refs', () => {
  assert.equal(assertEndpointNodeCompatible({
    schemaVersion: GRAPH_NODE_SCHEMA_VERSION,
    id: 'endpoint:synthetic.example:public-detail',
    type: 'EndpointNode',
    siteKey: 'synthetic.example',
    endpointKind: 'api',
    lifecycleState: 'cataloged',
    methodFamily: 'GET',
    routeRefs: ['route:synthetic.example:public'],
    capabilityRefs: ['capability:synthetic.example:read'],
    authRequirementRef: 'auth:synthetic.example:none',
    sessionRequirementRef: 'session:synthetic.example:none',
    signerRef: 'signer:synthetic.example:none',
    requestSchemaRef: 'schema:synthetic-public-request',
    responseSchemaRef: 'schema:synthetic-public-response',
    riskPolicyRef: 'risk-policy:synthetic.example:normal',
    versionRef: 'version:synthetic-endpoint-v1',
  }), true);

  assert.throws(
    () => assertEndpointNodeCompatible({
      schemaVersion: GRAPH_NODE_SCHEMA_VERSION,
      id: 'endpoint:synthetic.example:missing-auth',
      type: 'EndpointNode',
      siteKey: 'synthetic.example',
      endpointKind: 'api',
      lifecycleState: 'cataloged',
      methodFamily: 'GET',
      routeRefs: ['route:synthetic.example:public'],
      capabilityRefs: ['capability:synthetic.example:read'],
      sessionRequirementRef: 'session:synthetic.example:none',
      signerRef: 'signer:synthetic.example:none',
      requestSchemaRef: 'schema:synthetic-public-request',
      responseSchemaRef: 'schema:synthetic-public-response',
      riskPolicyRef: 'risk-policy:synthetic.example:normal',
      versionRef: 'version:synthetic-endpoint-v1',
    }),
    /EndpointNode authRequirementRef is required/u,
  );
});

test('graph report and query result schemas are descriptor-only artifacts', () => {
  assert.equal(assertGraphValidationReportCompatible({
    schemaVersion: GRAPH_VALIDATION_REPORT_SCHEMA_VERSION,
    graphVersion: 'synthetic-graph-v1',
    result: 'passed',
    findings: [],
  }), true);

  assert.equal(assertGraphQueryResultCompatible({
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: 'synthetic-graph-v1',
    queryName: 'listCapabilities',
    items: [],
  }), true);

  assert.throws(
    () => assertGraphQueryResultCompatible({
      schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
      graphVersion: 'synthetic-graph-v1',
      queryName: 'listCapabilities',
      items: [],
      sessionId: 'synthetic-session-id',
    }),
    /forbidden field/u,
  );
});

test('GraphManifest, GraphNode, and GraphEdge fail closed on future schema versions', async () => {
  assert.throws(
    () => assertGraphManifestCompatible({
      schemaVersion: GRAPH_MANIFEST_SCHEMA_VERSION + 1,
      graphSchemaVersion: SITE_CAPABILITY_GRAPH_SCHEMA_VERSION,
      graphDataVersion: 'synthetic-graph-v1',
    }),
    /not compatible/u,
  );

  assert.throws(
    () => assertSiteCapabilityGraphCompatible({
      schemaVersion: SITE_CAPABILITY_GRAPH_SCHEMA_VERSION + 1,
      graphVersion: 'synthetic-graph-v1',
      manifest: {
        schemaVersion: GRAPH_MANIFEST_SCHEMA_VERSION,
        graphSchemaVersion: SITE_CAPABILITY_GRAPH_SCHEMA_VERSION,
        graphDataVersion: 'synthetic-graph-v1',
      },
      nodes: [],
      edges: [],
    }),
    /not compatible/u,
  );

  const nodeFutureGraph = await readMinimalGraphFixture();
  nodeFutureGraph.nodes[0].schemaVersion = GRAPH_NODE_SCHEMA_VERSION + 1;
  assert.throws(
    () => assertGraphNodeCompatible(nodeFutureGraph.nodes[0]),
    /not compatible/u,
  );
  assert.throws(
    () => assertSiteCapabilityGraphCompatible(nodeFutureGraph),
    /not compatible/u,
  );

  const edgeFutureGraph = await readMinimalGraphFixture();
  edgeFutureGraph.edges[0].schemaVersion = GRAPH_EDGE_SCHEMA_VERSION + 1;
  assert.throws(
    () => assertGraphEdgeCompatible(edgeFutureGraph.edges[0]),
    /not compatible/u,
  );
  assert.throws(
    () => assertSiteCapabilityGraphCompatible(edgeFutureGraph),
    /not compatible/u,
  );
});
