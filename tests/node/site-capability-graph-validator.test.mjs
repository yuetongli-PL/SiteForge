import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  assertSiteCapabilityGraphValid,
  generateGraphDocsSummary,
  validateSiteCapabilityGraph,
} from '../../src/domain/capabilities/site-capability-graph.mjs';
import {
  requireReasonCodeDefinition,
} from '../../src/domain/risks/reason-codes.mjs';

const MINIMAL_GRAPH_URL = new URL('./fixtures/site-capability-graph/minimal-v1.json', import.meta.url);
const APPROVED_LAYER_SOURCE_REF = 'config/site-capabilities.json';
const RISK_POLICY_ID = 'risk-policy:synthetic.example:normal-readonly';
const SENSITIVE_SOURCE_REF = 'Authorization: Bearer synthetic-secret-value';

async function readMinimalGraphFixture() {
  const graph = JSON.parse(await readFile(MINIMAL_GRAPH_URL, 'utf8'));
  for (const node of graph.nodes) {
    if (node.type === 'RiskPolicyNode' && node.sourceRefs === undefined) {
      node.sourceRefs = [APPROVED_LAYER_SOURCE_REF];
    }
  }
  return graph;
}

function findingCodes(report) {
  return report.findings.map((finding) => finding.reasonCode);
}

function assertGraphReasonCodesAreCataloged(report) {
  for (const reasonCode of findingCodes(report)) {
    const definition = requireReasonCodeDefinition(reasonCode, { family: 'graph' });
    assert.equal(definition.artifactWriteAllowed, false);
  }
}

function addEndpointSupportNodes(graph, endpointId = 'endpoint:synthetic.example:public-detail') {
  graph.nodes.push(
    {
      schemaVersion: 1,
      id: 'auth:synthetic.example:none',
      type: 'AuthRequirementNode',
      authKind: 'none',
      requiredFor: [endpointId],
      proofType: 'none',
      allowedMaterial: [],
      forbiddenMaterial: ['raw-cookie'],
      reasonCodeRefs: [],
    },
    {
      schemaVersion: 1,
      id: 'session:synthetic.example:none',
      type: 'SessionRequirementNode',
      purpose: 'none',
      scope: 'public',
      ttlClass: 'none',
      permissionClass: 'none',
      profileIsolation: 'not-applicable',
      networkContextClass: 'public',
      auditRequired: true,
      revocationRequired: false,
    },
    {
      schemaVersion: 1,
      id: 'signer:synthetic.example:none',
      type: 'SignerNode',
      siteKey: 'synthetic.example',
      signerKind: 'none',
      adapterRef: {
        id: 'synthetic-adapter',
        version: 'synthetic-adapter-v1',
      },
      versionRef: 'version:synthetic-endpoint-v1',
      supportedEndpointRefs: [endpointId],
      testEvidenceRefs: ['test:site-capability-graph-schema'],
      failureModeRefs: ['failure:graph-schema-invalid'],
    },
    {
      schemaVersion: 1,
      id: 'schema:synthetic-public-request',
      type: 'SchemaNode',
      schemaName: 'SyntheticPublicRequest',
      governedVersion: 1,
      owner: 'Capability',
      sourcePath: 'src/domain/capabilities/site-capability-graph.mjs',
    },
    {
      schemaVersion: 1,
      id: 'schema:synthetic-public-response',
      type: 'SchemaNode',
      schemaName: 'SyntheticPublicResponse',
      governedVersion: 1,
      owner: 'Capability',
      sourcePath: 'src/domain/capabilities/site-capability-graph.mjs',
    },
    {
      schemaVersion: 1,
      id: 'version:synthetic-endpoint-v1',
      type: 'VersionNode',
      versionKind: 'endpoint',
      version: 'synthetic-endpoint-v1',
    },
  );
}

function addCapabilityRequirementNodes(graph) {
  graph.nodes.push(
    {
      schemaVersion: 1,
      id: 'auth:synthetic.example:optional-login',
      type: 'AuthRequirementNode',
      authKind: 'login-state',
      requiredFor: ['capability:synthetic.example:open-public-page'],
      proofType: 'session-view',
      allowedMaterial: ['redacted-session-view'],
      forbiddenMaterial: ['raw-cookie'],
      reasonCodeRefs: [],
    },
    {
      schemaVersion: 1,
      id: 'session:synthetic.example:optional-login',
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
}

function addCapabilityRequirementEdges(graph, capability = /** @type {any} */ ({})) {
  const capabilityId = capability.id ?? 'capability:synthetic.example:open-public-page';
  graph.edges.push(
    {
      schemaVersion: 1,
      id: 'edge:capability:auth:open-public-page',
      type: 'capability_requires_auth',
      from: capabilityId,
      to: capability.authRequirementRefs?.[0] ?? 'auth:synthetic.example:optional-login',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
    {
      schemaVersion: 1,
      id: 'edge:capability:session:open-public-page',
      type: 'capability_requires_session',
      from: capabilityId,
      to: capability.sessionRequirementRefs?.[0] ?? 'session:synthetic.example:optional-login',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
  );
}

function addFallbackRouteNode(graph, overrides = /** @type {any} */ ({})) {
  const capability = graph.nodes.find((node) => node.type === 'CapabilityNode');
  const primaryRoute = graph.nodes.find((node) => node.type === 'RouteNode');
  const fallbackRouteId = overrides.id ?? 'route:synthetic.example:fallback-public-page';
  primaryRoute.fallbackRouteRefs = [fallbackRouteId];
  capability.routeRefs.push(fallbackRouteId);
  const fallbackRoute = {
    ...primaryRoute,
    id: fallbackRouteId,
    urlPattern: 'https://synthetic.example/fallback/:id',
    fallbackRouteRefs: [],
    ...overrides,
  };
  graph.nodes.push(fallbackRoute);
  graph.edges.push({
    schemaVersion: 1,
    id: 'edge:capability:route:fallback-public-page',
    type: 'capability_exposed_on_route',
    from: capability.id,
    to: fallbackRoute.id,
    testEvidenceRefs: ['test:site-capability-graph-schema'],
  });
  return fallbackRoute;
}

function addEndpointNode(graph, overrides = /** @type {any} */ ({})) {
  const endpoint = {
    schemaVersion: 1,
    id: 'endpoint:synthetic.example:public-detail',
    type: 'EndpointNode',
    siteKey: 'synthetic.example',
    endpointKind: 'api',
    lifecycleState: 'cataloged',
    methodFamily: 'GET',
    routeRefs: ['route:synthetic.example:public-page'],
    capabilityRefs: ['capability:synthetic.example:open-public-page'],
    authRequirementRef: 'auth:synthetic.example:none',
    sessionRequirementRef: 'session:synthetic.example:none',
    signerRef: 'signer:synthetic.example:none',
    requestSchemaRef: 'schema:synthetic-public-request',
    responseSchemaRef: 'schema:synthetic-public-response',
    riskPolicyRef: 'risk-policy:synthetic.example:normal-readonly',
    versionRef: 'version:synthetic-endpoint-v1',
    testEvidenceRefs: ['test:site-capability-graph-schema'],
    ...overrides,
  };
  graph.nodes.push(endpoint);
  return endpoint;
}

function addEndpointRequirementEdges(graph, endpoint = /** @type {any} */ ({})) {
  const endpointId = endpoint.id ?? 'endpoint:synthetic.example:public-detail';
  graph.edges.push(
    {
      schemaVersion: 1,
      id: 'edge:endpoint:auth:public-detail',
      type: 'endpoint_requires_auth',
      from: endpointId,
      to: endpoint.authRequirementRef ?? 'auth:synthetic.example:none',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
    {
      schemaVersion: 1,
      id: 'edge:endpoint:session:public-detail',
      type: 'endpoint_requires_session',
      from: endpointId,
      to: endpoint.sessionRequirementRef ?? 'session:synthetic.example:none',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
    {
      schemaVersion: 1,
      id: 'edge:endpoint:signer:public-detail',
      type: 'endpoint_requires_signer',
      from: endpointId,
      to: endpoint.signerRef ?? 'signer:synthetic.example:none',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
    {
      schemaVersion: 1,
      id: 'edge:endpoint:request-schema:public-detail',
      type: 'node_validated_by_schema',
      from: endpointId,
      to: endpoint.requestSchemaRef ?? 'schema:synthetic-public-request',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
    {
      schemaVersion: 1,
      id: 'edge:endpoint:response-schema:public-detail',
      type: 'node_validated_by_schema',
      from: endpointId,
      to: endpoint.responseSchemaRef ?? 'schema:synthetic-public-response',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
    {
      schemaVersion: 1,
      id: 'edge:endpoint:risk:public-detail',
      type: 'endpoint_guarded_by_risk_policy',
      from: endpointId,
      to: endpoint.riskPolicyRef ?? 'risk-policy:synthetic.example:normal-readonly',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
    {
      schemaVersion: 1,
      id: 'edge:endpoint:version:public-detail',
      type: 'node_has_version',
      from: endpointId,
      to: endpoint.versionRef ?? 'version:synthetic-endpoint-v1',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
  );
}

test('validator accepts the minimal synthetic graph fixture', async () => {
  const graph = await readMinimalGraphFixture();
  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'passed');
  assert.deepEqual(report.findings, []);
  assert.equal(assertSiteCapabilityGraphValid(graph), true);
});

test('validator rejects duplicate node ids', async () => {
  const graph = await readMinimalGraphFixture();
  graph.nodes.push({ ...graph.nodes[0] });

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'failed');
  assert.deepEqual(findingCodes(report), ['graph-node-id-duplicate']);
  assert.throws(
    () => assertSiteCapabilityGraphValid(graph),
    /graph-node-id-duplicate/u,
  );
});

test('validator rejects broken edge references', async () => {
  const graph = await readMinimalGraphFixture();
  graph.edges.push({
    schemaVersion: 1,
    id: 'edge:synthetic:broken',
    type: 'capability_exposed_on_route',
    from: 'capability:synthetic.example:open-public-page',
    to: 'route:synthetic.example:missing',
  });

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'failed');
  assert.deepEqual(findingCodes(report), ['graph-edge-broken']);
  assert.equal(report.findings[0].field, 'to');
});

test('validator rejects CapabilityNode route and risk refs that do not resolve', async () => {
  const graph = await readMinimalGraphFixture();
  const capability = graph.nodes.find((node) => node.type === 'CapabilityNode');
  capability.routeRefs = ['route:synthetic.example:missing'];
  capability.riskPolicyRef = 'risk-policy:synthetic.example:missing';

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'failed');
  assert.deepEqual(findingCodes(report), [
    'graph-capability-missing-route',
    'graph-capability-missing-risk-policy',
  ]);
});

test('validator accepts RouteNode fallback refs declared by shared capability routes', async () => {
  const graph = await readMinimalGraphFixture();
  addFallbackRouteNode(graph);

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'passed');
  assert.deepEqual(report.findings, []);
});

test('validator rejects RouteNode fallback refs that are missing, self-referential, or unrelated', async () => {
  {
    const graph = await readMinimalGraphFixture();
    const route = graph.nodes.find((node) => node.type === 'RouteNode');
    route.fallbackRouteRefs = ['route:synthetic.example:missing'];

    const report = validateSiteCapabilityGraph(graph);

    assert.equal(report.result, 'failed');
    assert.deepEqual(findingCodes(report), ['graph-edge-broken']);
    assert.match(report.findings[0].message, /fallbackRouteRef does not resolve/u);
  }

  {
    const graph = await readMinimalGraphFixture();
    const route = graph.nodes.find((node) => node.type === 'RouteNode');
    route.fallbackRouteRefs = [route.id];

    const report = validateSiteCapabilityGraph(graph);

    assert.equal(report.result, 'failed');
    assert.deepEqual(findingCodes(report), ['graph-edge-broken']);
    assert.match(report.findings[0].message, /must not reference itself/u);
  }

  {
    const graph = await readMinimalGraphFixture();
    addFallbackRouteNode(graph, {
      capabilityRefs: ['capability:synthetic.example:other'],
    });

    const report = validateSiteCapabilityGraph(graph);

    assert.equal(report.result, 'failed');
    assert.deepEqual(findingCodes(report), ['graph-edge-broken']);
    assert.match(report.findings[0].message, /must share at least one capabilityRef/u);
  }
});

test('validator fails closed when RouteNode riskPolicyRef is missing or not a RiskPolicyNode', async () => {
  {
    const graph = await readMinimalGraphFixture();
    const route = graph.nodes.find((node) => node.type === 'RouteNode');
    delete route.riskPolicyRef;

    const report = validateSiteCapabilityGraph(graph);

    assert.equal(report.result, 'failed');
    assert.deepEqual(findingCodes(report), ['graph-schema-invalid']);
    assert.match(report.findings[0].message, /RouteNode riskPolicyRef is required/u);
  }

  {
    const graph = await readMinimalGraphFixture();
    const route = graph.nodes.find((node) => node.type === 'RouteNode');
    route.riskPolicyRef = 'capability:synthetic.example:open-public-page';

    const report = validateSiteCapabilityGraph(graph);

    assert.equal(report.result, 'failed');
    assert.deepEqual(findingCodes(report), ['graph-capability-missing-risk-policy']);
    assert.match(report.findings[0].message, /RouteNode riskPolicyRef does not resolve to a RiskPolicyNode/u);
    assert.equal(report.findings[0].nodeId, route.id);
    assert.equal(report.findings[0].field, 'riskPolicyRef');
  }
});

test('validator accepts optional CapabilityNode auth and session refs backed by explicit graph edges', async () => {
  const graph = await readMinimalGraphFixture();
  addCapabilityRequirementNodes(graph);
  const capability = graph.nodes.find((node) => node.type === 'CapabilityNode');
  capability.authRequirementRefs = ['auth:synthetic.example:optional-login'];
  capability.sessionRequirementRefs = ['session:synthetic.example:optional-login'];
  addCapabilityRequirementEdges(graph, capability);

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'passed');
  assert.deepEqual(report.findings, []);
});

test('validator rejects CapabilityNode auth and session refs without nodes or explicit edges', async () => {
  const graph = await readMinimalGraphFixture();
  addCapabilityRequirementNodes(graph);
  const capability = graph.nodes.find((node) => node.type === 'CapabilityNode');
  capability.authRequirementRefs = ['auth:synthetic.example:optional-login'];
  capability.sessionRequirementRefs = ['session:synthetic.example:missing'];

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'failed');
  assert.deepEqual(findingCodes(report), [
    'graph-capability-missing-auth-requirement',
    'graph-capability-missing-session-requirement',
  ]);
});

test('validator rejects CapabilityNode auth refs missing reverse requiredFor declarations', async () => {
  const graph = await readMinimalGraphFixture();
  addCapabilityRequirementNodes(graph);
  const capability = graph.nodes.find((node) => node.type === 'CapabilityNode');
  capability.authRequirementRefs = ['auth:synthetic.example:optional-login'];
  capability.sessionRequirementRefs = ['session:synthetic.example:optional-login'];
  addCapabilityRequirementEdges(graph, capability);

  const authRequirement = graph.nodes.find((node) => node.id === capability.authRequirementRefs[0]);
  authRequirement.requiredFor = /** @type {any[]} */ ([]);

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'failed');
  assert.deepEqual(findingCodes(report), ['graph-capability-missing-auth-requirement']);
  assert.match(report.findings[0].message, /requiredFor/u);
});

test('validator rejects non-readOnly capabilities without approval', async () => {
  const graph = await readMinimalGraphFixture();
  const capability = graph.nodes.find((node) => node.type === 'CapabilityNode');
  capability.mode = 'download';
  capability.requiresApproval = false;

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'failed');
  assert.deepEqual(findingCodes(report), ['graph-non-readonly-missing-approval']);
});

test('validator accepts agent-exposed CapabilityNode with capability-level test evidence', async () => {
  const graph = await readMinimalGraphFixture();
  const capability = graph.nodes.find((node) => node.type === 'CapabilityNode');
  capability.agentExposed = true;

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'passed');
  assert.deepEqual(report.findings, []);
});

test('validator rejects agent-exposed CapabilityNode without test evidence independently of EndpointNode catalog evidence', async () => {
  const graph = await readMinimalGraphFixture();
  const capability = graph.nodes.find((node) => node.type === 'CapabilityNode');
  capability.agentExposed = true;
  capability.testEvidenceRefs = /** @type {any[]} */ ([]);

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'failed');
  assert.deepEqual(findingCodes(report), ['graph-agent-capability-missing-test-evidence']);
  assert.equal(report.findings[0].nodeId, capability.id);
  assert.equal(report.findings[0].field, 'testEvidenceRefs');
  assert.match(report.findings[0].message, /CapabilityNode/u);
  assert.doesNotMatch(report.findings[0].message, /Cataloged EndpointNode/u);
});

test('validator fails closed on forbidden sensitive or execution fields without echoing values', async () => {
  const graph = await readMinimalGraphFixture();
  graph.nodes[0].cookie = 'synthetic-sensitive-cookie-value';

  const report = validateSiteCapabilityGraph(graph);
  const serializedReport = JSON.stringify(report);

  assert.equal(report.result, 'failed');
  assert.deepEqual(findingCodes(report), ['graph-schema-invalid']);
  assert.doesNotMatch(serializedReport, /synthetic-sensitive-cookie-value/u);
});

for (const variant of [
  {
    name: 'missing',
    mutate(riskPolicy) {
      delete riskPolicy.sourceRefs;
    },
    messagePattern: /sourceRefs/u,
  },
  {
    name: 'empty',
    mutate(riskPolicy) {
      riskPolicy.sourceRefs = /** @type {any[]} */ ([]);
    },
    messagePattern: /sourceRefs must include at least one approved Layer config source/u,
  },
  {
    name: 'unsupported',
    mutate(riskPolicy) {
      riskPolicy.sourceRefs = ['src/sites/adapters/generic-navigation.mjs'];
    },
    messagePattern: /sourceRefs contains unsupported Layer config source/u,
  },
]) {
  test(`validator fails closed when RiskPolicyNode sourceRefs are ${variant.name}`, async () => {
    const graph = await readMinimalGraphFixture();
    const riskPolicy = graph.nodes.find((node) => node.id === RISK_POLICY_ID);
    variant.mutate(riskPolicy);

    const report = validateSiteCapabilityGraph(graph);

    assert.equal(report.result, 'failed', variant.name);
    assert.deepEqual(findingCodes(report), ['graph-schema-invalid'], variant.name);
    assert.match(report.findings[0].message, variant.messagePattern, variant.name);
  });
}

test('validator redacts unsupported RiskPolicyNode sourceRefs that contain sensitive authorization material', async () => {
  const graph = await readMinimalGraphFixture();
  const riskPolicy = graph.nodes.find((node) => node.id === RISK_POLICY_ID);
  riskPolicy.sourceRefs = [APPROVED_LAYER_SOURCE_REF, SENSITIVE_SOURCE_REF];

  const report = validateSiteCapabilityGraph(graph);
  const serializedReport = JSON.stringify(report);

  assert.equal(report.result, 'failed');
  assert.deepEqual(findingCodes(report), ['graph-schema-invalid']);
  assert.match(report.findings[0].message, /sourceRefs contains unsupported Layer config source/u);
  assert.doesNotMatch(serializedReport, /synthetic-secret-value/u);
  assert.doesNotMatch(serializedReport, /Authorization: Bearer/u);
});

test('validator keeps route risk validation descriptor-only across capability, route, and endpoint refs', async () => {
  const graph = await readMinimalGraphFixture();
  addEndpointSupportNodes(graph);
  const endpoint = addEndpointNode(graph);
  addEndpointRequirementEdges(graph, endpoint);

  const capability = graph.nodes.find((node) => node.type === 'CapabilityNode');
  const route = graph.nodes.find((node) => node.type === 'RouteNode');
  const riskPolicy = graph.nodes.find((node) => node.id === RISK_POLICY_ID);

  assert.equal(capability.riskPolicyRef, riskPolicy.id);
  assert.equal(route.riskPolicyRef, riskPolicy.id);
  assert.equal(endpoint.riskPolicyRef, riskPolicy.id);

  const report = validateSiteCapabilityGraph(graph);
  const summary = generateGraphDocsSummary(graph);
  const serializedSummary = JSON.stringify(summary);

  assert.equal(report.result, 'passed');
  assert.deepEqual(report.findings, []);
  assert.deepEqual(
    summary.sections.riskPolicySummary.map((entry) => ({
      ownerType: entry.ownerType,
      ownerId: entry.ownerId,
      riskPolicyRef: entry.riskPolicyRef,
      riskState: entry.riskState,
    })),
    [
      {
        ownerType: 'CapabilityNode',
        ownerId: capability.id,
        riskPolicyRef: riskPolicy.id,
        riskState: riskPolicy.state,
      },
      {
        ownerType: 'RouteNode',
        ownerId: route.id,
        riskPolicyRef: riskPolicy.id,
        riskState: riskPolicy.state,
      },
      {
        ownerType: 'EndpointNode',
        ownerId: endpoint.id,
        riskPolicyRef: riskPolicy.id,
        riskState: riskPolicy.state,
      },
    ],
  );
  assert.doesNotMatch(serializedSummary, /RiskStateMachine/u);
  assert.doesNotMatch(serializedSummary, /runtime transition/iu);
  assert.doesNotMatch(serializedSummary, /repo writes/iu);
  assert.doesNotMatch(serializedSummary, /Authorization: Bearer/u);
});

test('validator requires graph-derived artifact redaction descriptors', async () => {
  const graph = await readMinimalGraphFixture();
  const artifact = graph.nodes.find((node) => node.type === 'ArtifactContractNode');
  artifact.redactionRequired = false;

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'failed');
  assert.deepEqual(findingCodes(report), ['graph-artifact-redaction-required']);
});

test('validator accepts EndpointNode refs that resolve to the required node types', async () => {
  const graph = await readMinimalGraphFixture();
  addEndpointSupportNodes(graph);
  const endpoint = addEndpointNode(graph);
  addEndpointRequirementEdges(graph, endpoint);

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'passed');
  assert.deepEqual(report.findings, []);
});

test('validator rejects EndpointNode route and capability refs that do not resolve to required node types', async () => {
  const graph = await readMinimalGraphFixture();
  addEndpointSupportNodes(graph);
  const endpoint = addEndpointNode(graph, {
    routeRefs: ['capability:synthetic.example:open-public-page'],
    capabilityRefs: ['route:synthetic.example:public-page'],
  });
  addEndpointRequirementEdges(graph, endpoint);

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'failed');
  assert.deepEqual(findingCodes(report), [
    'graph-edge-broken',
    'graph-edge-broken',
  ]);
  assert.deepEqual(
    report.findings.map((finding) => finding.field),
    ['routeRefs', 'capabilityRefs'],
  );
});

test('validator rejects EndpointNode route and capability refs that are missing entirely', async () => {
  const graph = await readMinimalGraphFixture();
  addEndpointSupportNodes(graph);
  const endpoint = addEndpointNode(graph, {
    routeRefs: ['route:synthetic.example:missing-endpoint-route'],
    capabilityRefs: ['capability:synthetic.example:missing-endpoint-capability'],
  });
  addEndpointRequirementEdges(graph, endpoint);

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'failed');
  assert.deepEqual(findingCodes(report), [
    'graph-edge-broken',
    'graph-edge-broken',
  ]);
  assert.deepEqual(
    report.findings.map((finding) => finding.field),
    ['routeRefs', 'capabilityRefs'],
  );
});

test('validator rejects EndpointNode risk refs that do not resolve to RiskPolicyNode', async () => {
  const graph = await readMinimalGraphFixture();
  addEndpointSupportNodes(graph);
  const endpoint = addEndpointNode(graph, {
    riskPolicyRef: 'capability:synthetic.example:open-public-page',
  });
  addEndpointRequirementEdges(graph, endpoint);

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'failed');
  assert.deepEqual(findingCodes(report), ['graph-capability-missing-risk-policy']);
  assert.match(report.findings[0].message, /riskPolicyRef does not resolve to a RiskPolicyNode/u);
  assert.equal(report.findings[0].field, 'riskPolicyRef');
});

test('validator rejects EndpointNode requirement refs that lack explicit graph edges', async () => {
  const graph = await readMinimalGraphFixture();
  addEndpointSupportNodes(graph);
  addEndpointNode(graph);

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'failed');
  assert.deepEqual(findingCodes(report), [
    'graph-endpoint-missing-auth-requirement',
    'graph-endpoint-missing-session-requirement',
    'graph-endpoint-missing-signer',
    'graph-endpoint-missing-schema',
    'graph-endpoint-missing-schema',
    'graph-capability-missing-risk-policy',
    'graph-version-incompatible',
  ]);
});

test('validator rejects EndpointNode requirement refs missing reverse node declarations', async () => {
  const graph = await readMinimalGraphFixture();
  addEndpointSupportNodes(graph);
  const endpoint = addEndpointNode(graph);
  addEndpointRequirementEdges(graph, endpoint);

  const authRequirement = graph.nodes.find((node) => node.id === endpoint.authRequirementRef);
  const signer = graph.nodes.find((node) => node.id === endpoint.signerRef);
  authRequirement.requiredFor = /** @type {any[]} */ ([]);
  signer.supportedEndpointRefs = /** @type {any[]} */ ([]);

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'failed');
  assert.deepEqual(findingCodes(report), [
    'graph-endpoint-missing-auth-requirement',
    'graph-endpoint-missing-signer',
  ]);
  assert.match(report.findings[0].message, /requiredFor/u);
  assert.match(report.findings[1].message, /supportedEndpointRefs/u);
});

test('validator rejects EndpointNode refs that do not resolve to required node types', async () => {
  const graph = await readMinimalGraphFixture();
  addEndpointSupportNodes(graph);
  addEndpointNode(graph, {
    authRequirementRef: 'auth:synthetic.example:missing',
    sessionRequirementRef: 'session:synthetic.example:missing',
    signerRef: 'signer:synthetic.example:missing',
    responseSchemaRef: 'schema:synthetic-public-response-missing',
    versionRef: 'version:synthetic-endpoint-missing',
  });

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'failed');
  assert.deepEqual(findingCodes(report), [
    'graph-endpoint-missing-auth-requirement',
    'graph-endpoint-missing-session-requirement',
    'graph-endpoint-missing-signer',
    'graph-endpoint-missing-schema',
    'graph-endpoint-missing-schema',
    'graph-capability-missing-risk-policy',
    'graph-version-incompatible',
  ]);
});

test('validator rejects cookie endpoints without concrete auth and session requirements', async () => {
  const graph = await readMinimalGraphFixture();
  addEndpointSupportNodes(graph);
  const endpoint = addEndpointNode(graph, {
    requiresCookie: true,
  });
  addEndpointRequirementEdges(graph, endpoint);

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'failed');
  assert.deepEqual(findingCodes(report), [
    'graph-endpoint-missing-auth-requirement',
    'graph-endpoint-missing-session-requirement',
  ]);
});

test('validator rejects WBI endpoints without concrete signer requirements', async () => {
  const graph = await readMinimalGraphFixture();
  addEndpointSupportNodes(graph);
  const endpoint = addEndpointNode(graph, {
    requiresWbi: true,
  });
  addEndpointRequirementEdges(graph, endpoint);

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'failed');
  assert.deepEqual(findingCodes(report), ['graph-endpoint-missing-signer']);
});

test('validator rejects EndpointNode version refs that do not resolve to VersionNode', async () => {
  const graph = await readMinimalGraphFixture();
  addEndpointSupportNodes(graph);
  const endpoint = addEndpointNode(graph);
  addEndpointRequirementEdges(graph, endpoint);
  endpoint.versionRef = 'version:synthetic-endpoint-missing';

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'failed');
  assert.deepEqual(findingCodes(report), ['graph-version-incompatible']);
});

test('validator rejects cataloged EndpointNode without response schema edge or test evidence', async () => {
  {
    const graph = await readMinimalGraphFixture();
    addEndpointSupportNodes(graph);
    const endpoint = addEndpointNode(graph);
    addEndpointRequirementEdges(graph, endpoint);
    graph.edges = graph.edges.filter((edge) => edge.id !== 'edge:endpoint:response-schema:public-detail');

    const report = validateSiteCapabilityGraph(graph);

    assert.equal(report.result, 'failed');
    assert.deepEqual(findingCodes(report), ['graph-endpoint-missing-schema']);
    assert.match(report.findings[0].message, /responseSchemaRef is not declared by node_validated_by_schema edge/u);
  }

  {
    const graph = await readMinimalGraphFixture();
    addEndpointSupportNodes(graph);
    const endpoint = addEndpointNode(graph, {
      testEvidenceRefs: [],
    });
    addEndpointRequirementEdges(graph, endpoint);

    const report = validateSiteCapabilityGraph(graph);

    assert.equal(report.result, 'failed');
    assert.deepEqual(findingCodes(report), ['graph-agent-capability-missing-test-evidence']);
    assert.match(report.findings[0].message, /Cataloged EndpointNode must include test evidence refs/u);
  }
});

for (const lifecycleState of ['observed', 'candidate']) {
  test(`validator rejects ${lifecycleState} endpoints marked as cataloged without verification`, async () => {
    const graph = await readMinimalGraphFixture();
    addEndpointSupportNodes(graph);
    const endpoint = addEndpointNode(graph, {
      lifecycleState,
      cataloged: true,
    });
    addEndpointRequirementEdges(graph, endpoint);

    assert.equal(endpoint.execute, undefined);
    assert.equal(endpoint.catalogMutation, undefined);
    assert.equal(endpoint.rawCredential, undefined);

    const report = validateSiteCapabilityGraph(graph);
    const serializedReport = JSON.stringify(report);

    assert.equal(report.result, 'failed');
    assert.deepEqual(findingCodes(report), ['graph-observed-candidate-promoted-without-verification']);
    assert.equal(report.findings[0].nodeId, endpoint.id);
    assert.equal(report.findings[0].field, 'cataloged');
    assert.doesNotMatch(serializedReport, /synthetic-secret-value/u);
    assert.doesNotMatch(serializedReport, /Authorization: Bearer/u);
  });
}

test('validator emits only graph reasonCodes registered in the central catalog', async () => {
  const reports = /** @type {any[]} */ ([]);

  {
    const graph = await readMinimalGraphFixture();
    graph.nodes.push({ ...graph.nodes[0] });
    reports.push(validateSiteCapabilityGraph(graph));
  }

  {
    const graph = await readMinimalGraphFixture();
    graph.edges.push({ ...graph.edges[0] });
    reports.push(validateSiteCapabilityGraph(graph));
  }

  {
    const graph = await readMinimalGraphFixture();
    graph.edges.push({
      schemaVersion: 1,
      id: 'edge:synthetic:broken',
      type: 'capability_exposed_on_route',
      from: 'capability:synthetic.example:open-public-page',
      to: 'route:synthetic.example:missing',
    });
    reports.push(validateSiteCapabilityGraph(graph));
  }

  {
    const graph = await readMinimalGraphFixture();
    const capability = graph.nodes.find((node) => node.type === 'CapabilityNode');
    capability.routeRefs = ['route:synthetic.example:missing'];
    capability.riskPolicyRef = 'risk-policy:synthetic.example:missing';
    capability.authRequirementRefs = ['auth:synthetic.example:missing'];
    capability.sessionRequirementRefs = ['session:synthetic.example:missing'];
    capability.mode = 'download';
    capability.requiresApproval = false;
    reports.push(validateSiteCapabilityGraph(graph));
  }

  {
    const graph = await readMinimalGraphFixture();
    graph.nodes[0].execute = 'synthetic-handler-name';
    reports.push(validateSiteCapabilityGraph(graph));
  }

  {
    const graph = await readMinimalGraphFixture();
    const artifact = graph.nodes.find((node) => node.type === 'ArtifactContractNode');
    artifact.redactionRequired = false;
    reports.push(validateSiteCapabilityGraph(graph));
  }

  {
    const graph = await readMinimalGraphFixture();
    addEndpointSupportNodes(graph);
    const endpoint = addEndpointNode(graph, {
      authRequirementRef: 'auth:synthetic.example:missing',
      sessionRequirementRef: 'session:synthetic.example:missing',
      signerRef: 'signer:synthetic.example:missing',
      responseSchemaRef: 'schema:synthetic-public-response-missing',
      versionRef: 'version:synthetic-endpoint-missing',
      testEvidenceRefs: [],
    });
    addEndpointRequirementEdges(graph, endpoint);
    reports.push(validateSiteCapabilityGraph(graph));
  }

  {
    const graph = await readMinimalGraphFixture();
    addEndpointSupportNodes(graph);
    const endpoint = addEndpointNode(graph, {
      lifecycleState: 'candidate',
      cataloged: true,
      requiresCookie: true,
      requiresWbi: true,
    });
    addEndpointRequirementEdges(graph, endpoint);
    reports.push(validateSiteCapabilityGraph(graph));
  }

  const catalogedCodes = new Set();
  for (const report of reports) {
    assert.equal(report.result, 'failed');
    assertGraphReasonCodesAreCataloged(report);
    for (const reasonCode of findingCodes(report)) {
      catalogedCodes.add(reasonCode);
    }
  }

  assert.deepEqual([...catalogedCodes].sort(), [
    'graph-agent-capability-missing-test-evidence',
    'graph-artifact-redaction-required',
    'graph-capability-missing-auth-requirement',
    'graph-capability-missing-risk-policy',
    'graph-capability-missing-route',
    'graph-capability-missing-session-requirement',
    'graph-edge-broken',
    'graph-edge-id-duplicate',
    'graph-endpoint-missing-auth-requirement',
    'graph-endpoint-missing-schema',
    'graph-endpoint-missing-session-requirement',
    'graph-endpoint-missing-signer',
    'graph-node-id-duplicate',
    'graph-non-readonly-missing-approval',
    'graph-observed-candidate-promoted-without-verification',
    'graph-schema-invalid',
    'graph-version-incompatible',
  ]);
});
