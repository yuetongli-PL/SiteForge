import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  assertGraphQueryResultCompatible,
  getAffectedGraphCapabilities,
  getGraphCapability,
  getGraphCapabilitiesByRiskLevel,
  getGraphCapabilitiesRequiringAuth,
  getGraphCapabilitiesUsingWbi,
  getGraphEndpointsByLifecycleState,
  getGraphFailureModesByArtifactWriteAllowed,
  getGraphFailureModesByCatalogAction,
  getGraphFailureModesByCooldownRequired,
  getGraphFailureModesByDegradable,
  getGraphFailureModesByManualRecoveryRequired,
  getGraphFailureModesByReasonCode,
  getGraphRequirements,
  getGraphRoutes,
  listGraphCapabilities,
  listGraphSites,
} from '../../src/sites/capability/site-capability-graph.mjs';

const MINIMAL_GRAPH_URL = new URL('./fixtures/site-capability-graph/minimal-v1.json', import.meta.url);

async function readMinimalGraphFixture() {
  return JSON.parse(await readFile(MINIMAL_GRAPH_URL, 'utf8'));
}

function addCapabilityRequirementDescriptors(graph) {
  const capability = graph.nodes.find((node) => node.type === 'CapabilityNode');
  capability.authRequirementRefs = ['auth:synthetic.example:optional-login'];
  capability.sessionRequirementRefs = ['session:synthetic.example:optional-login'];
  graph.nodes.push(
    {
      schemaVersion: 1,
      id: 'auth:synthetic.example:optional-login',
      type: 'AuthRequirementNode',
      authKind: 'login-state',
      requiredFor: [capability.id, 'endpoint:synthetic.example:public-detail'],
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
  graph.edges.push(
    {
      schemaVersion: 1,
      id: 'edge:capability:auth:query-test',
      type: 'capability_requires_auth',
      from: capability.id,
      to: 'auth:synthetic.example:optional-login',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
    {
      schemaVersion: 1,
      id: 'edge:capability:session:query-test',
      type: 'capability_requires_session',
      from: capability.id,
      to: 'session:synthetic.example:optional-login',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
  );
}

function addEndpointDescriptors(graph) {
  graph.nodes.push(
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
      supportedEndpointRefs: ['endpoint:synthetic.example:public-detail'],
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
      sourcePath: 'src/sites/capability/site-capability-graph.mjs',
    },
    {
      schemaVersion: 1,
      id: 'schema:synthetic-public-response',
      type: 'SchemaNode',
      schemaName: 'SyntheticPublicResponse',
      governedVersion: 1,
      owner: 'Capability',
      sourcePath: 'src/sites/capability/site-capability-graph.mjs',
    },
    {
      schemaVersion: 1,
      id: 'version:synthetic-endpoint-v1',
      type: 'VersionNode',
      versionKind: 'endpoint',
      version: 'synthetic-endpoint-v1',
    },
    {
      schemaVersion: 1,
      id: 'endpoint:synthetic.example:public-detail',
      type: 'EndpointNode',
      siteKey: 'synthetic.example',
      endpointKind: 'api',
      lifecycleState: 'cataloged',
      methodFamily: 'GET',
      routeRefs: ['route:synthetic.example:public-page'],
      capabilityRefs: ['capability:synthetic.example:open-public-page'],
      authRequirementRef: 'auth:synthetic.example:optional-login',
      sessionRequirementRef: 'session:synthetic.example:optional-login',
      signerRef: 'signer:synthetic.example:none',
      requestSchemaRef: 'schema:synthetic-public-request',
      responseSchemaRef: 'schema:synthetic-public-response',
      riskPolicyRef: 'risk-policy:synthetic.example:normal-readonly',
      versionRef: 'version:synthetic-endpoint-v1',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
  );
  for (const [id, type, to] of [
    ['edge:endpoint:auth:query-test', 'endpoint_requires_auth', 'auth:synthetic.example:optional-login'],
    ['edge:endpoint:session:query-test', 'endpoint_requires_session', 'session:synthetic.example:optional-login'],
    ['edge:endpoint:signer:query-test', 'endpoint_requires_signer', 'signer:synthetic.example:none'],
    ['edge:endpoint:request-schema:query-test', 'node_validated_by_schema', 'schema:synthetic-public-request'],
    ['edge:endpoint:response-schema:query-test', 'node_validated_by_schema', 'schema:synthetic-public-response'],
    ['edge:endpoint:risk:query-test', 'endpoint_guarded_by_risk_policy', 'risk-policy:synthetic.example:normal-readonly'],
    ['edge:endpoint:version:query-test', 'node_has_version', 'version:synthetic-endpoint-v1'],
  ]) {
    graph.edges.push({
      schemaVersion: 1,
      id,
      type,
      from: 'endpoint:synthetic.example:public-detail',
      to,
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    });
  }
}

function addEndpointLifecycleDescriptor(graph, { id, lifecycleState, edgeSuffix }) {
  const baseEndpoint = graph.nodes.find((node) => node.id === 'endpoint:synthetic.example:public-detail');
  assert.equal(typeof baseEndpoint, 'object');
  graph.nodes.push({
    ...baseEndpoint,
    id,
    lifecycleState,
  });

  const authRequirement = graph.nodes.find((node) => node.id === baseEndpoint.authRequirementRef);
  const signer = graph.nodes.find((node) => node.id === baseEndpoint.signerRef);
  assert.equal(typeof authRequirement, 'object');
  assert.equal(typeof signer, 'object');
  authRequirement.requiredFor = [...authRequirement.requiredFor, id];
  signer.supportedEndpointRefs = [...signer.supportedEndpointRefs, id];

  for (const [kind, type, to] of [
    ['auth', 'endpoint_requires_auth', baseEndpoint.authRequirementRef],
    ['session', 'endpoint_requires_session', baseEndpoint.sessionRequirementRef],
    ['signer', 'endpoint_requires_signer', baseEndpoint.signerRef],
    ['request-schema', 'node_validated_by_schema', baseEndpoint.requestSchemaRef],
    ['response-schema', 'node_validated_by_schema', baseEndpoint.responseSchemaRef],
    ['risk', 'endpoint_guarded_by_risk_policy', baseEndpoint.riskPolicyRef],
    ['version', 'node_has_version', baseEndpoint.versionRef],
  ]) {
    graph.edges.push({
      schemaVersion: 1,
      id: `edge:endpoint:${kind}:query-test-${edgeSuffix}`,
      type,
      from: id,
      to,
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    });
  }
}

function addFallbackRouteDescriptor(graph) {
  const capabilityId = 'capability:synthetic.example:open-public-page';
  const primaryRoute = graph.nodes.find((node) => node.id === 'route:synthetic.example:public-page');
  primaryRoute.fallbackRouteRefs = ['route:synthetic.example:fallback-page'];
  graph.nodes.push({
    schemaVersion: 1,
    id: 'route:synthetic.example:fallback-page',
    type: 'RouteNode',
    siteKey: 'synthetic.example',
    routeKind: 'page',
    urlPattern: 'https://synthetic.example/fallback/:id',
    pageType: 'fallback-detail',
    capabilityRefs: [capabilityId],
    adapterRef: {
      id: 'synthetic-adapter',
      version: 'synthetic-adapter-v1',
    },
    riskPolicyRef: 'risk-policy:synthetic.example:normal-readonly',
    sourceRefs: ['src/sites/core/adapters/generic-navigation.mjs'],
    testEvidenceRefs: ['test:site-capability-graph-schema'],
  });
}

function addCapabilityDependencyEdges(graph) {
  const capabilityId = 'capability:synthetic.example:open-public-page';
  for (const [id, type, to] of [
    ['edge:capability:schema:query-test', 'node_validated_by_schema', 'schema:SiteCapabilityGraph'],
    ['edge:capability:artifact:query-test', 'node_produces_artifact', 'artifact:graph-validation-report'],
    ['edge:capability:test:query-test', 'node_covered_by_test', 'test:site-capability-graph-schema'],
  ]) {
    graph.edges.push({
      schemaVersion: 1,
      id,
      type,
      from: capabilityId,
      to,
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    });
  }
}

test('query API lists sites and capabilities as descriptor-only GraphQueryResult values', async () => {
  const graph = await readMinimalGraphFixture();

  const sites = listGraphSites(graph);
  const capabilities = listGraphCapabilities(graph, 'synthetic.example');
  const unknownSiteCapabilities = listGraphCapabilities(graph, 'site:synthetic.example:unknown');

  assert.equal(assertGraphQueryResultCompatible(sites), true);
  assert.equal(assertGraphQueryResultCompatible(capabilities), true);
  assert.equal(sites.queryName, 'listSites');
  assert.equal(capabilities.queryName, 'listCapabilities');
  assert.deepEqual(sites.items.map((node) => node.id), ['site:synthetic.example']);
  assert.deepEqual(
    capabilities.items.map((node) => node.id),
    ['capability:synthetic.example:open-public-page'],
  );
  assert.deepEqual(unknownSiteCapabilities.items, []);

  sites.items[0].siteKey = 'mutated';
  assert.equal(graph.nodes.find((node) => node.type === 'SiteNode').siteKey, 'synthetic.example');
});

test('query API gets a capability and its routes without executing graph data', async () => {
  const graph = await readMinimalGraphFixture();
  const capabilityId = 'capability:synthetic.example:open-public-page';

  const capability = getGraphCapability(graph, capabilityId);
  const routes = getGraphRoutes(graph, capabilityId);

  assert.equal(capability.queryName, 'getCapability');
  assert.equal(routes.queryName, 'getRoutes');
  assert.deepEqual(capability.items.map((node) => node.id), [capabilityId]);
  assert.deepEqual(routes.items.map((node) => node.id), ['route:synthetic.example:public-page']);
  assert.deepEqual(getGraphRoutes(graph, 'capability:synthetic.example:missing').items, []);
});

test('query API preserves route fallback refs and affected capability traversal', async () => {
  const graph = await readMinimalGraphFixture();
  addFallbackRouteDescriptor(graph);
  const capabilityId = 'capability:synthetic.example:open-public-page';

  const routes = getGraphRoutes(graph, capabilityId);
  assert.equal(routes.queryName, 'getRoutes');
  assert.deepEqual(routes.items.map((node) => node.id), ['route:synthetic.example:public-page']);
  assert.deepEqual(routes.items[0].fallbackRouteRefs, ['route:synthetic.example:fallback-page']);

  const affectedByFallback = getAffectedGraphCapabilities(graph, 'route:synthetic.example:fallback-page');
  assert.equal(affectedByFallback.queryName, 'getAffectedCapabilities');
  assert.deepEqual(affectedByFallback.items.map((node) => node.id), [capabilityId]);

  const affectedByPrimaryRoute = getAffectedGraphCapabilities(graph, 'route:synthetic.example:public-page');
  assert.deepEqual(affectedByPrimaryRoute.items.map((node) => node.id), [capabilityId]);
});

test('query API returns capability requirements from descriptor refs only', async () => {
  const graph = await readMinimalGraphFixture();
  addCapabilityRequirementDescriptors(graph);

  const requirements = getGraphRequirements(graph, 'capability:synthetic.example:open-public-page');

  assert.equal(requirements.queryName, 'getRequirements');
  assert.deepEqual(requirements.items.map((node) => node.id), [
    'auth:synthetic.example:optional-login',
    'session:synthetic.example:optional-login',
    'risk-policy:synthetic.example:normal-readonly',
  ]);
  assert.deepEqual(getGraphRequirements(graph, 'capability:synthetic.example:missing').items, []);
});

test('query API returns capabilities affected by descriptor node ids', async () => {
  const graph = await readMinimalGraphFixture();
  addCapabilityRequirementDescriptors(graph);
  addEndpointDescriptors(graph);
  const capabilityId = 'capability:synthetic.example:open-public-page';

  for (const nodeId of [
    capabilityId,
    'route:synthetic.example:public-page',
    'auth:synthetic.example:optional-login',
    'session:synthetic.example:optional-login',
    'risk-policy:synthetic.example:normal-readonly',
    'endpoint:synthetic.example:public-detail',
    'schema:synthetic-public-response',
    'signer:synthetic.example:none',
    'version:synthetic-endpoint-v1',
  ]) {
    const affected = getAffectedGraphCapabilities(graph, nodeId);
    assert.equal(affected.queryName, 'getAffectedCapabilities');
    assert.deepEqual(affected.items.map((node) => node.id), [capabilityId]);
  }

  assert.deepEqual(getAffectedGraphCapabilities(graph, 'schema:synthetic.example:missing').items, []);
});

test('query API returns affected capabilities through artifact, test, and schema dependency edges', async () => {
  const graph = await readMinimalGraphFixture();
  addCapabilityDependencyEdges(graph);
  const capabilityId = 'capability:synthetic.example:open-public-page';

  for (const nodeId of [
    'artifact:graph-validation-report',
    'schema:SiteCapabilityGraph',
    'test:site-capability-graph-schema',
  ]) {
    const affected = getAffectedGraphCapabilities(graph, nodeId);
    assert.equal(assertGraphQueryResultCompatible(affected), true);
    assert.equal(affected.queryName, 'getAffectedCapabilities');
    assert.deepEqual(affected.items.map((node) => node.id), [capabilityId]);
  }
});

test('query API returns capability risk policy refs without risk state execution', async () => {
  const graph = await readMinimalGraphFixture();
  const capabilityId = 'capability:synthetic.example:open-public-page';
  const riskPolicyRef = 'risk-policy:synthetic.example:normal-readonly';

  const affectedByRiskPolicy = getAffectedGraphCapabilities(graph, riskPolicyRef);
  const normalRiskCapabilities = getGraphCapabilitiesByRiskLevel(graph, 'synthetic.example', 'normal');

  assert.equal(assertGraphQueryResultCompatible(affectedByRiskPolicy), true);
  assert.equal(affectedByRiskPolicy.queryName, 'getAffectedCapabilities');
  assert.deepEqual(affectedByRiskPolicy.items.map((node) => node.id), [capabilityId]);
  assert.equal(assertGraphQueryResultCompatible(normalRiskCapabilities), true);
  assert.equal(normalRiskCapabilities.queryName, 'getCapabilitiesByRiskLevel');
  assert.deepEqual(normalRiskCapabilities.items.map((node) => node.id), [capabilityId]);
  assert.deepEqual(getGraphCapabilitiesByRiskLevel(graph, 'synthetic.example', 'blocked').items, []);
  assert.doesNotMatch(
    JSON.stringify([affectedByRiskPolicy, normalRiskCapabilities]),
    /RiskStateMachine|risk-state execution|runtime risk|Authorization|cookie|sessionId|browserProfile/u,
  );
});

test('query API returns Layer-sourced RiskPolicyNode descriptors from capability requirements', async () => {
  const graph = await readMinimalGraphFixture();
  const capabilityId = 'capability:synthetic.example:open-public-page';
  const riskPolicyRef = 'risk-policy:synthetic.example:normal-readonly';
  const riskPolicy = graph.nodes.find((node) => node.id === riskPolicyRef);
  const capability = graph.nodes.find((node) => node.id === capabilityId);
  riskPolicy.sourceRefs = [...graph.manifest.sourceInventories];

  const requirements = getGraphRequirements(graph, capabilityId);
  const [queriedRiskPolicy] = requirements.items.filter((node) => node.type === 'RiskPolicyNode');

  assert.equal(assertGraphQueryResultCompatible(requirements), true);
  assert.equal(capability.riskPolicyRef, riskPolicyRef);
  assert.deepEqual(queriedRiskPolicy, {
    ...riskPolicy,
    sourceRefs: [
      'config/site-capabilities.json',
      'config/site-registry.json',
    ],
  });
  assert.doesNotMatch(
    JSON.stringify(requirements),
    /RiskStateMachine|risk-state execution|runtime risk transition|runtime risk|Authorization|cookie|sessionId|browserProfile/u,
  );
});

test('query API returns affected capabilities for endpoint schema refs without request materialization', async () => {
  const graph = await readMinimalGraphFixture();
  addCapabilityRequirementDescriptors(graph);
  addEndpointDescriptors(graph);
  const capabilityId = 'capability:synthetic.example:open-public-page';

  for (const schemaRef of [
    'schema:synthetic-public-request',
    'schema:synthetic-public-response',
  ]) {
    const affected = getAffectedGraphCapabilities(graph, schemaRef);

    assert.equal(assertGraphQueryResultCompatible(affected), true);
    assert.equal(affected.queryName, 'getAffectedCapabilities');
    assert.deepEqual(affected.items.map((node) => node.id), [capabilityId]);
    assert.doesNotMatch(
      JSON.stringify(affected),
      /request body|runtime request|endpoint materialization|raw-cookie|Authorization|sessionId|browserProfile/u,
    );
  }
});

test('query API filters capabilities by auth, WBI, and risk descriptors', async () => {
  const graph = await readMinimalGraphFixture();
  addCapabilityRequirementDescriptors(graph);
  addEndpointDescriptors(graph);
  const signer = graph.nodes.find((node) => node.id === 'signer:synthetic.example:none');
  const endpoint = graph.nodes.find((node) => node.id === 'endpoint:synthetic.example:public-detail');
  signer.signerKind = 'wbi';
  endpoint.requiresWbi = true;
  const capabilityId = 'capability:synthetic.example:open-public-page';

  assert.deepEqual(
    getGraphCapabilitiesRequiringAuth(graph, 'synthetic.example').items.map((node) => node.id),
    [capabilityId],
  );
  assert.deepEqual(
    getGraphCapabilitiesUsingWbi(graph, 'synthetic.example').items.map((node) => node.id),
    [capabilityId],
  );
  assert.deepEqual(
    getGraphCapabilitiesByRiskLevel(graph, 'synthetic.example', 'normal').items.map((node) => node.id),
    [capabilityId],
  );
  assert.deepEqual(getGraphCapabilitiesRequiringAuth(graph, 'site:synthetic.example:missing').items, []);
  assert.deepEqual(getGraphCapabilitiesUsingWbi(graph, 'site:synthetic.example:missing').items, []);
  assert.deepEqual(getGraphCapabilitiesByRiskLevel(graph, 'synthetic.example', 'blocked').items, []);
});

test('query API filters endpoint descriptors by lifecycle state without catalog promotion', async () => {
  const graph = await readMinimalGraphFixture();
  addCapabilityRequirementDescriptors(graph);
  addEndpointDescriptors(graph);
  addEndpointLifecycleDescriptor(graph, {
    id: 'endpoint:synthetic.example:observed-detail',
    lifecycleState: 'observed',
    edgeSuffix: 'observed-detail',
  });
  addEndpointLifecycleDescriptor(graph, {
    id: 'endpoint:synthetic.example:candidate-detail',
    lifecycleState: 'candidate',
    edgeSuffix: 'candidate-detail',
  });

  const cataloged = getGraphEndpointsByLifecycleState(graph, 'synthetic.example', 'cataloged');
  const observed = getGraphEndpointsByLifecycleState(graph, 'synthetic.example', 'observed');
  const candidate = getGraphEndpointsByLifecycleState(graph, 'synthetic.example', 'candidate');

  for (const result of [cataloged, observed, candidate]) {
    assert.equal(assertGraphQueryResultCompatible(result), true);
    assert.equal(result.queryName, 'getEndpointsByLifecycleState');
  }
  assert.deepEqual(cataloged.items.map((node) => node.id), ['endpoint:synthetic.example:public-detail']);
  assert.deepEqual(observed.items.map((node) => node.id), ['endpoint:synthetic.example:observed-detail']);
  assert.deepEqual(candidate.items.map((node) => node.id), ['endpoint:synthetic.example:candidate-detail']);
  assert.deepEqual(
    [cataloged, observed, candidate].flatMap((result) => result.items.map((node) => node.lifecycleState)),
    ['cataloged', 'observed', 'candidate'],
  );
  assert.equal(observed.items[0].cataloged, undefined);
  assert.equal(candidate.items[0].cataloged, undefined);
  assert.deepEqual(getGraphEndpointsByLifecycleState(graph, 'site:synthetic.example:missing', 'observed').items, []);
  assert.throws(
    () => getGraphEndpointsByLifecycleState(graph, 'synthetic.example', 'promoted'),
    /GraphEndpointLifecycleQuery lifecycleState is unsupported/u,
  );
  assert.doesNotMatch(
    JSON.stringify([cataloged, observed, candidate]),
    /raw-cookie|Authorization|sessionId|browserProfile|endpoint materialization|catalog promotion/u,
  );
});

test('query API returns failure mode reasonCode refs without failure handling execution', async () => {
  const graph = await readMinimalGraphFixture();

  const failureModes = getGraphFailureModesByReasonCode(graph, 'graph-schema-invalid');
  const missing = getGraphFailureModesByReasonCode(graph, 'graph-query-no-match');

  assert.equal(assertGraphQueryResultCompatible(failureModes), true);
  assert.equal(failureModes.queryName, 'getFailureModesByReasonCode');
  assert.deepEqual(failureModes.items.map((node) => ({
    id: node.id,
    type: node.type,
    reasonCode: node.reasonCode,
    artifactWriteAllowed: node.artifactWriteAllowed,
  })), [
    {
      id: 'failure:graph-schema-invalid',
      type: 'FailureModeNode',
      reasonCode: 'graph-schema-invalid',
      artifactWriteAllowed: false,
    },
  ]);
  assert.equal(assertGraphQueryResultCompatible(missing), true);
  assert.deepEqual(missing.items, []);
  assert.throws(
    () => getGraphFailureModesByReasonCode(graph, ''),
    /GraphFailureModeReasonCodeQuery reasonCode is required/u,
  );
  assert.doesNotMatch(
    JSON.stringify([failureModes, missing]),
    /failure handling execution|planner execution|RiskStateMachine|artifact write|runtime artifact|SiteAdapter runtime|downloader|SessionView|Authorization|cookie|sessionId|browserProfile/u,
  );
});

test('query API filters failure modes by artifact-write policy without artifact writes', async () => {
  const graph = await readMinimalGraphFixture();
  graph.nodes.push({
    schemaVersion: 1,
    id: 'failure:graph-query-no-match',
    type: 'FailureModeNode',
    reasonCode: 'graph-query-no-match',
    retryable: true,
    cooldownRequired: false,
    isolationRequired: false,
    manualRecoveryRequired: false,
    degradable: true,
    artifactWriteAllowed: true,
  });

  const blockedWrites = getGraphFailureModesByArtifactWriteAllowed(graph, false);
  const allowedWrites = getGraphFailureModesByArtifactWriteAllowed(graph, true);

  assert.equal(assertGraphQueryResultCompatible(blockedWrites), true);
  assert.equal(assertGraphQueryResultCompatible(allowedWrites), true);
  assert.equal(blockedWrites.queryName, 'getFailureModesByArtifactWriteAllowed');
  assert.equal(allowedWrites.queryName, 'getFailureModesByArtifactWriteAllowed');
  assert.deepEqual(blockedWrites.items.map((node) => ({
    id: node.id,
    reasonCode: node.reasonCode,
    artifactWriteAllowed: node.artifactWriteAllowed,
  })), [
    {
      id: 'failure:graph-schema-invalid',
      reasonCode: 'graph-schema-invalid',
      artifactWriteAllowed: false,
    },
  ]);
  assert.deepEqual(allowedWrites.items.map((node) => ({
    id: node.id,
    reasonCode: node.reasonCode,
    artifactWriteAllowed: node.artifactWriteAllowed,
  })), [
    {
      id: 'failure:graph-query-no-match',
      reasonCode: 'graph-query-no-match',
      artifactWriteAllowed: true,
    },
  ]);
  assert.throws(
    () => getGraphFailureModesByArtifactWriteAllowed(graph, 'true'),
    /GraphFailureModeArtifactWriteAllowedQuery artifactWriteAllowed must be a boolean/u,
  );
  assert.doesNotMatch(
    JSON.stringify([blockedWrites, allowedWrites]),
    /artifact write execution|runtime artifact write|artifact writer|SecurityGuard runtime writer|failure handling execution|SiteAdapter runtime|downloader|SessionView|Authorization|cookie|sessionId|browserProfile/u,
  );
});

test('query API filters failure modes by manual-recovery policy without recovery execution', async () => {
  const graph = await readMinimalGraphFixture();
  graph.nodes.push({
    schemaVersion: 1,
    id: 'failure:graph-route-forbidden-by-risk',
    type: 'FailureModeNode',
    reasonCode: 'graph-route-forbidden-by-risk',
    retryable: false,
    cooldownRequired: false,
    isolationRequired: true,
    manualRecoveryRequired: false,
    degradable: true,
    artifactWriteAllowed: false,
  });

  const manualRecovery = getGraphFailureModesByManualRecoveryRequired(graph, true);
  const automaticRecovery = getGraphFailureModesByManualRecoveryRequired(graph, false);

  assert.equal(assertGraphQueryResultCompatible(manualRecovery), true);
  assert.equal(assertGraphQueryResultCompatible(automaticRecovery), true);
  assert.equal(manualRecovery.queryName, 'getFailureModesByManualRecoveryRequired');
  assert.equal(automaticRecovery.queryName, 'getFailureModesByManualRecoveryRequired');
  assert.deepEqual(manualRecovery.items.map((node) => ({
    id: node.id,
    reasonCode: node.reasonCode,
    manualRecoveryRequired: node.manualRecoveryRequired,
  })), [
    {
      id: 'failure:graph-schema-invalid',
      reasonCode: 'graph-schema-invalid',
      manualRecoveryRequired: true,
    },
  ]);
  assert.deepEqual(automaticRecovery.items.map((node) => ({
    id: node.id,
    reasonCode: node.reasonCode,
    manualRecoveryRequired: node.manualRecoveryRequired,
  })), [
    {
      id: 'failure:graph-route-forbidden-by-risk',
      reasonCode: 'graph-route-forbidden-by-risk',
      manualRecoveryRequired: false,
    },
  ]);
  assert.throws(
    () => getGraphFailureModesByManualRecoveryRequired(graph, 'false'),
    /GraphFailureModeManualRecoveryRequiredQuery manualRecoveryRequired must be a boolean/u,
  );
  assert.doesNotMatch(
    JSON.stringify([manualRecovery, automaticRecovery]),
    /manual recovery execution|recovery service|runtime recovery|artifact write|failure handling execution|SiteAdapter runtime|downloader|SessionView|Authorization|cookie|sessionId|browserProfile/u,
  );
});

test('query API filters failure modes by cooldown policy without cooldown execution', async () => {
  const graph = await readMinimalGraphFixture();
  graph.nodes.push({
    schemaVersion: 1,
    id: 'failure:graph-planner-no-route',
    type: 'FailureModeNode',
    reasonCode: 'graph-planner-no-route',
    retryable: true,
    cooldownRequired: true,
    isolationRequired: false,
    manualRecoveryRequired: false,
    degradable: true,
    artifactWriteAllowed: false,
  });

  const cooldownRequired = getGraphFailureModesByCooldownRequired(graph, true);
  const noCooldownRequired = getGraphFailureModesByCooldownRequired(graph, false);

  assert.equal(assertGraphQueryResultCompatible(cooldownRequired), true);
  assert.equal(assertGraphQueryResultCompatible(noCooldownRequired), true);
  assert.equal(cooldownRequired.queryName, 'getFailureModesByCooldownRequired');
  assert.equal(noCooldownRequired.queryName, 'getFailureModesByCooldownRequired');
  assert.deepEqual(cooldownRequired.items.map((node) => ({
    id: node.id,
    reasonCode: node.reasonCode,
    cooldownRequired: node.cooldownRequired,
  })), [
    {
      id: 'failure:graph-planner-no-route',
      reasonCode: 'graph-planner-no-route',
      cooldownRequired: true,
    },
  ]);
  assert.deepEqual(noCooldownRequired.items.map((node) => ({
    id: node.id,
    reasonCode: node.reasonCode,
    cooldownRequired: node.cooldownRequired,
  })), [
    {
      id: 'failure:graph-schema-invalid',
      reasonCode: 'graph-schema-invalid',
      cooldownRequired: false,
    },
  ]);
  assert.throws(
    () => getGraphFailureModesByCooldownRequired(graph, 'true'),
    /GraphFailureModeCooldownRequiredQuery cooldownRequired must be a boolean/u,
  );
  assert.doesNotMatch(
    JSON.stringify([cooldownRequired, noCooldownRequired]),
    /cooldown execution|timer scheduling|runtime cooldown|risk-state transition|artifact write|failure handling execution|SiteAdapter runtime|downloader|SessionView|Authorization|cookie|sessionId|browserProfile/u,
  );
});

test('query API filters failure modes by degradation policy without degradation execution', async () => {
  const graph = await readMinimalGraphFixture();
  graph.nodes.push({
    schemaVersion: 1,
    id: 'failure:graph-planner-context-unsatisfied',
    type: 'FailureModeNode',
    reasonCode: 'graph-planner-context-unsatisfied',
    retryable: true,
    cooldownRequired: false,
    isolationRequired: false,
    manualRecoveryRequired: false,
    degradable: true,
    artifactWriteAllowed: false,
  });

  const degradable = getGraphFailureModesByDegradable(graph, true);
  const notDegradable = getGraphFailureModesByDegradable(graph, false);

  assert.equal(assertGraphQueryResultCompatible(degradable), true);
  assert.equal(assertGraphQueryResultCompatible(notDegradable), true);
  assert.equal(degradable.queryName, 'getFailureModesByDegradable');
  assert.equal(notDegradable.queryName, 'getFailureModesByDegradable');
  assert.deepEqual(degradable.items.map((node) => ({
    id: node.id,
    reasonCode: node.reasonCode,
    degradable: node.degradable,
  })), [
    {
      id: 'failure:graph-planner-context-unsatisfied',
      reasonCode: 'graph-planner-context-unsatisfied',
      degradable: true,
    },
  ]);
  assert.deepEqual(notDegradable.items.map((node) => ({
    id: node.id,
    reasonCode: node.reasonCode,
    degradable: node.degradable,
  })), [
    {
      id: 'failure:graph-schema-invalid',
      reasonCode: 'graph-schema-invalid',
      degradable: false,
    },
  ]);
  assert.throws(
    () => getGraphFailureModesByDegradable(graph, 'false'),
    /GraphFailureModeDegradableQuery degradable must be a boolean/u,
  );
  assert.doesNotMatch(
    JSON.stringify([degradable, notDegradable]),
    /degradation execution|fallback execution|runtime degradation|route execution|artifact write|failure handling execution|SiteAdapter runtime|downloader|SessionView|Authorization|cookie|sessionId|browserProfile/u,
  );
});

test('query API filters failure modes by catalog action without catalog mutation', async () => {
  const graph = await readMinimalGraphFixture();
  graph.nodes.push(
    {
      schemaVersion: 1,
      id: 'failure:graph-query-no-match',
      type: 'FailureModeNode',
      reasonCode: 'graph-query-no-match',
      retryable: true,
      cooldownRequired: false,
      isolationRequired: false,
      manualRecoveryRequired: false,
      degradable: true,
      artifactWriteAllowed: false,
      catalogAction: 'none',
    },
    {
      schemaVersion: 1,
      id: 'failure:graph-endpoint-missing-schema',
      type: 'FailureModeNode',
      reasonCode: 'graph-endpoint-missing-schema',
      retryable: false,
      cooldownRequired: false,
      isolationRequired: true,
      manualRecoveryRequired: true,
      degradable: false,
      artifactWriteAllowed: false,
      catalogAction: 'deprecate',
    },
    {
      schemaVersion: 1,
      id: 'failure:graph-candidate-promotion-forbidden',
      type: 'FailureModeNode',
      reasonCode: 'graph-candidate-promotion-forbidden',
      retryable: false,
      cooldownRequired: false,
      isolationRequired: true,
      manualRecoveryRequired: true,
      degradable: false,
      artifactWriteAllowed: false,
      catalogAction: 'block',
    },
  );

  const none = getGraphFailureModesByCatalogAction(graph, 'none');
  const deprecate = getGraphFailureModesByCatalogAction(graph, 'deprecate');
  const block = getGraphFailureModesByCatalogAction(graph, 'block');

  for (const result of [none, deprecate, block]) {
    assert.equal(assertGraphQueryResultCompatible(result), true);
    assert.equal(result.queryName, 'getFailureModesByCatalogAction');
  }
  assert.deepEqual(none.items.map((node) => ({
    id: node.id,
    reasonCode: node.reasonCode,
    catalogAction: node.catalogAction,
  })), [
    {
      id: 'failure:graph-query-no-match',
      reasonCode: 'graph-query-no-match',
      catalogAction: 'none',
    },
  ]);
  assert.deepEqual(deprecate.items.map((node) => ({
    id: node.id,
    reasonCode: node.reasonCode,
    catalogAction: node.catalogAction,
  })), [
    {
      id: 'failure:graph-endpoint-missing-schema',
      reasonCode: 'graph-endpoint-missing-schema',
      catalogAction: 'deprecate',
    },
  ]);
  assert.deepEqual(block.items.map((node) => ({
    id: node.id,
    reasonCode: node.reasonCode,
    catalogAction: node.catalogAction,
  })), [
    {
      id: 'failure:graph-candidate-promotion-forbidden',
      reasonCode: 'graph-candidate-promotion-forbidden',
      catalogAction: 'block',
    },
  ]);
  let unsupportedError;
  try {
    getGraphFailureModesByCatalogAction(graph, 'Authorization: synthetic-secret-value');
  } catch (error) {
    unsupportedError = error;
  }
  assert.match(
    unsupportedError?.message ?? '',
    /GraphFailureModeCatalogActionQuery catalogAction is unsupported/u,
  );
  assert.doesNotMatch(unsupportedError?.message ?? '', /Authorization|synthetic-secret-value/u);
  assert.doesNotMatch(
    JSON.stringify([none, deprecate, block]),
    /catalog mutation|catalog write|catalog promotion|runtime deprecation|endpoint materialization|artifact write|failure handling execution|SiteAdapter runtime|downloader|SessionView|Authorization|cookie|sessionId|browserProfile/u,
  );
});

test('query API fails closed on invalid graphs before returning results', async () => {
  const graph = await readMinimalGraphFixture();
  graph.nodes.push({ ...graph.nodes[0] });

  assert.throws(
    () => listGraphSites(graph),
    /graph-node-id-duplicate/u,
  );

  const futureManifestGraph = await readMinimalGraphFixture();
  futureManifestGraph.manifest.graphSchemaVersion = 999;
  assert.throws(
    () => listGraphSites(futureManifestGraph),
    /graph-schema-invalid/u,
  );

  const futureNodeGraph = await readMinimalGraphFixture();
  futureNodeGraph.nodes[0].schemaVersion = 999;
  assert.throws(
    () => listGraphSites(futureNodeGraph),
    /graph-schema-invalid/u,
  );
});
