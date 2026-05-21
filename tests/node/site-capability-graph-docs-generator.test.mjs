import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility,
  assertDisabledGraphMigrationReportRuntimeConsumerResultCompatibility,
  assertGraphDerivedArtifactWriteAllowed,
  assertGraphDocsOutputCompletionChecklistCompatibility,
  assertGraphDocsOutputFinalAcceptanceDescriptorCompatibility,
  assertGraphDocsOutputFinalAcceptanceReportDescriptorCompatibility,
  assertGraphDocsOutputFinalBReviewChecklistCompatibility,
  assertGraphDocsOutputFinalMatrixHandoffCompatibility,
  assertGraphDocsMarkdownCleanupPolicyGuardCompatibility,
  assertGraphDocsMarkdownArtifactConsumerCompatibility,
  assertGraphDocsMarkdownFinalOutputBoundarySummaryCompatibility,
  assertGraphDocsMarkdownGeneratedOutputManifestGuardCompatibility,
  assertGraphDocsMarkdownRepoOutputDryRunCompatibility,
  assertGraphDocsMarkdownRetainedOutputIndexGuardCompatibility,
  assertGraphDocsMarkdownRetentionCleanupCompatibilityHandoff,
  assertGraphMigrationReportRepoOutputDryRunCompatibility,
  assertGraphMigrationReportRuntimeIntegrationDesignCompatibility,
  assertGraphRepoOutputApprovalGateDesignCompatibility,
  assertGraphDocsSummaryCompatible,
  createDisabledGraphDocsMarkdownRuntimeConsumerResult,
  createDisabledGraphMigrationReportRuntimeConsumerResult,
  createGraphDocsOutputCompletionChecklist,
  createGraphDocsOutputFinalAcceptanceDescriptor,
  createGraphDocsOutputFinalAcceptanceReportDescriptor,
  createGraphDocsOutputFinalBReviewChecklist,
  createGraphDocsOutputFinalMatrixHandoff,
  createGraphDocsMarkdownCleanupPolicyGuard,
  createGraphDocsMarkdownArtifact,
  createGraphDocsMarkdownFinalOutputBoundarySummary,
  createGraphDocsMarkdownGeneratedOutputManifestGuard,
  createGraphDocsMarkdownRepoOutputDryRun,
  createGraphDocsMarkdownRetainedOutputIndexGuard,
  createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff,
  createGraphMigrationReportRepoOutputDryRun,
  createGraphMigrationReportRuntimeIntegrationDesign,
  createGraphRepoOutputApprovalGateDesign,
  generateGraphDocsSummary,
  generateGraphMigrationReport,
  listSiteCapabilityGraphSchemaDefinitions,
  renderGraphDocsSummaryMarkdown,
} from '../../src/domain/capabilities/site-capability-graph.mjs';
import {
  createGraphDerivedArtifactPlacement,
  writeGraphDerivedArtifactPair,
} from '../../src/domain/artifacts/site-capability-graph-artifacts.mjs';

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

function addAuthRequirementDescriptors(graph) {
  const capability = graph.nodes.find((node) => node.type === 'CapabilityNode');
  assert.equal(typeof capability, 'object');
  capability.authRequirementRefs = ['auth:synthetic.example:optional-login'];
  capability.sessionRequirementRefs = ['session:synthetic.example:optional-login'];
  graph.nodes.push(
    {
      schemaVersion: 1,
      id: 'auth:synthetic.example:optional-login',
      type: 'AuthRequirementNode',
      authKind: 'login-state',
      requiredFor: [capability.id],
      proofType: 'redacted-session-view',
      allowedMaterial: ['session-view-descriptor'],
      forbiddenMaterial: ['raw-cookie', 'raw-authorization-header'],
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
      id: 'edge:capability:auth:docs-test',
      type: 'capability_requires_auth',
      from: capability.id,
      to: 'auth:synthetic.example:optional-login',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
    {
      schemaVersion: 1,
      id: 'edge:capability:session:docs-test',
      type: 'capability_requires_session',
      from: capability.id,
      to: 'session:synthetic.example:optional-login',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
  );
}

function addEndpointSupportDescriptors(graph, endpointId = 'endpoint:synthetic.example:public-detail') {
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

function addEndpointDescriptor(graph, overrides = {}) {
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

function addFallbackRouteDescriptor(graph) {
  const capability = graph.nodes.find((node) => node.type === 'CapabilityNode');
  const primaryRoute = graph.nodes.find((node) => node.type === 'RouteNode');
  assert.equal(typeof capability, 'object');
  assert.equal(typeof primaryRoute, 'object');

  const fallbackRouteId = 'route:synthetic.example:fallback-public-page';
  primaryRoute.fallbackRouteRefs = [fallbackRouteId];
  capability.routeRefs = [...capability.routeRefs, fallbackRouteId];

  const fallbackRoute = {
    ...primaryRoute,
    id: fallbackRouteId,
    urlPattern: 'https://synthetic.example/fallback/:id',
    fallbackRouteRefs: [],
  };
  graph.nodes.push(fallbackRoute);
  graph.edges.push({
    schemaVersion: 1,
    id: 'edge:capability:route:fallback-public-page',
    type: 'capability_exposed_on_route',
    from: capability.id,
    to: fallbackRouteId,
    testEvidenceRefs: ['test:site-capability-graph-schema'],
  });

  return { primaryRoute, fallbackRoute };
}

function addEndpointRequirementEdges(graph, endpoint = {}) {
  const endpointId = endpoint.id ?? 'endpoint:synthetic.example:public-detail';
  graph.edges.push(
    {
      schemaVersion: 1,
      id: 'edge:endpoint:auth:docs-public-detail',
      type: 'endpoint_requires_auth',
      from: endpointId,
      to: endpoint.authRequirementRef ?? 'auth:synthetic.example:none',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
    {
      schemaVersion: 1,
      id: 'edge:endpoint:session:docs-public-detail',
      type: 'endpoint_requires_session',
      from: endpointId,
      to: endpoint.sessionRequirementRef ?? 'session:synthetic.example:none',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
    {
      schemaVersion: 1,
      id: 'edge:endpoint:signer:docs-public-detail',
      type: 'endpoint_requires_signer',
      from: endpointId,
      to: endpoint.signerRef ?? 'signer:synthetic.example:none',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
    {
      schemaVersion: 1,
      id: 'edge:endpoint:request-schema:docs-public-detail',
      type: 'node_validated_by_schema',
      from: endpointId,
      to: endpoint.requestSchemaRef ?? 'schema:synthetic-public-request',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
    {
      schemaVersion: 1,
      id: 'edge:endpoint:response-schema:docs-public-detail',
      type: 'node_validated_by_schema',
      from: endpointId,
      to: endpoint.responseSchemaRef ?? 'schema:synthetic-public-response',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
    {
      schemaVersion: 1,
      id: 'edge:endpoint:risk:docs-public-detail',
      type: 'endpoint_guarded_by_risk_policy',
      from: endpointId,
      to: endpoint.riskPolicyRef ?? 'risk-policy:synthetic.example:normal-readonly',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
    {
      schemaVersion: 1,
      id: 'edge:endpoint:version:docs-public-detail',
      type: 'node_has_version',
      from: endpointId,
      to: endpoint.versionRef ?? 'version:synthetic-endpoint-v1',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
  );
}

test('GraphDocsSummary schema is versioned in the graph schema inventory', () => {
  const schema = listSiteCapabilityGraphSchemaDefinitions()
    .find((entry) => entry.name === 'GraphDocsSummary');

  assert.deepEqual(schema, {
    name: 'GraphDocsSummary',
    version: 1,
    sourcePath: 'src/domain/capabilities/site-capability-graph.mjs',
  });
});

test('docs generator creates descriptor-only redaction-required summaries', async () => {
  const graph = await readMinimalGraphFixture();

  const summary = generateGraphDocsSummary(graph);

  assert.equal(assertGraphDocsSummaryCompatible(summary), true);
  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.graphVersion, 'synthetic-graph-v1');
  assert.equal(summary.artifactFamily, 'site-capability-graph-docs');
  assert.equal(summary.redactionRequired, true);
  assert.deepEqual(summary.sections.capabilityList, [
    {
      id: 'capability:synthetic.example:open-public-page',
      siteKey: 'synthetic.example',
      capabilityKey: 'open-public-page',
      capabilityFamily: 'navigate-to-author',
      mode: 'readOnly',
      requiresApproval: false,
      routeRefs: ['route:synthetic.example:public-page'],
      riskPolicyRef: 'risk-policy:synthetic.example:normal-readonly',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
  ]);
  assert.deepEqual(summary.sections.dependencyMap.map((edge) => edge.id), [
    'edge:site:declares:open-public-page',
    'edge:capability:route:open-public-page',
    'edge:capability:risk:open-public-page',
    'edge:artifact:redaction:graph-validation-report',
  ]);
  assert.deepEqual(summary.sections.dependencyMapByEdgeType, [
    {
      edgeType: 'site_declares_capability',
      edgeCount: 1,
      edgeIds: ['edge:site:declares:open-public-page'],
    },
    {
      edgeType: 'capability_exposed_on_route',
      edgeCount: 1,
      edgeIds: ['edge:capability:route:open-public-page'],
    },
    {
      edgeType: 'capability_guarded_by_risk_policy',
      edgeCount: 1,
      edgeIds: ['edge:capability:risk:open-public-page'],
    },
    {
      edgeType: 'artifact_guarded_by_redaction',
      edgeCount: 1,
      edgeIds: ['edge:artifact:redaction:graph-validation-report'],
    },
  ]);
  assert.deepEqual(summary.sections.routeDependencySummary, [
    {
      routeId: 'route:synthetic.example:public-page',
      siteKey: 'synthetic.example',
      routeKind: 'page',
      pageType: 'public-detail',
      capabilityRefs: ['capability:synthetic.example:open-public-page'],
      fallbackRouteRefs: [],
      adapterRef: {
        id: 'synthetic-adapter',
        version: 'synthetic-adapter-v1',
      },
      riskPolicyRef: 'risk-policy:synthetic.example:normal-readonly',
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
  ]);
  assert.deepEqual(summary.sections.endpointImpactMap, []);
  assert.deepEqual(summary.sections.authRequirementSummary, []);
  assert.deepEqual(summary.sections.signerDependencySummary, []);
  assert.deepEqual(summary.sections.agentExposedCapabilityList, []);
  assert.deepEqual(summary.sections.riskPolicySummary.map((entry) => entry.riskState), [
    'normal',
    'normal',
  ]);
  assert.deepEqual(summary.sections.testCoverageSummary.map((entry) => entry.nodeId), [
    'capability:synthetic.example:open-public-page',
    'route:synthetic.example:public-page',
  ]);
  assert.deepEqual(summary.sections.layerDesignSourceReferences.map((entry) => entry.path), [
    'AGENTS.md',
    'README.md',
  ]);
});

test('docs generator records current layer source references without retired docs', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const references = summary.sections.layerDesignSourceReferences;

  assert.equal(assertGraphDocsSummaryCompatible(summary), true);
  assert.equal(summary.redactionRequired, true);
  assert.deepEqual(
    references.filter((entry) => entry.status === 'present-reference').map((entry) => entry.path),
    ['AGENTS.md', 'README.md'],
  );

  const markdown = renderGraphDocsSummaryMarkdown(summary);
  assert.match(markdown, /## Layer Design Sources/u);
  assert.match(markdown, /status: present-reference/u);
  assert.match(markdown, /AGENTS\.md/u);
  assert.match(markdown, /README\.md/u);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(summary), true);
});

test('docs summary compatibility rejects missing Layer source reference section', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  delete summary.sections.layerDesignSourceReferences;

  const message = captureThrownMessage(() => assertGraphDocsSummaryCompatible(summary));

  assert.match(message, /GraphDocsSummary sections\.layerDesignSourceReferences must be an array/u);
  assert.doesNotMatch(message, /docs\/architecture\.md/u);
});

test('docs summary compatibility rejects missing endpoint impact map section', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  delete summary.sections.endpointImpactMap;

  const message = captureThrownMessage(() => assertGraphDocsSummaryCompatible(summary));

  assert.match(message, /GraphDocsSummary sections\.endpointImpactMap must be an array/u);
});

test('docs renderer creates deterministic markdown from descriptor-only summaries', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);

  const markdown = renderGraphDocsSummaryMarkdown(summary);

  assert.equal(markdown, renderGraphDocsSummaryMarkdown(summary));
  assert.match(markdown, /^# Site Capability Graph Docs Summary\n/u);
  assert.match(markdown, /- graphVersion: synthetic-graph-v1/u);
  assert.match(markdown, /## Capabilities\n- capability:synthetic\.example:open-public-page/u);
  assert.match(markdown, /## Dependency Map\n- edge:site:declares:open-public-page \| type=site_declares_capability/u);
  assert.match(markdown, /## Dependency Map By Edge Type\n- site_declares_capability \| count=1/u);
  assert.match(markdown, /  - edgeIds: edge:site:declares:open-public-page/u);
  assert.match(markdown, /## Route Dependencies\n- route:synthetic\.example:public-page/u);
  assert.match(markdown, /## Endpoint Impact Map\n- none/u);
  assert.match(markdown, /## Auth Requirements\n- none/u);
  assert.match(markdown, /## Test Coverage\n- capability:synthetic\.example:open-public-page/u);
});

test('docs summary rejects live runtime wording', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const markdown = renderGraphDocsSummaryMarkdown(summary);
  const rendered = `${JSON.stringify(summary)}\n${markdown}`;

  for (const pattern of [
    /\blive route execution\b/iu,
    /\blive runtime\b/iu,
    /\bruntime writes? enabled\b/iu,
    /\bruntime artifact writes? enabled\b/iu,
    /\brepo writes? enabled\b/iu,
    /\bexternal telemetry enabled\b/iu,
    /\broute execution enabled\b/iu,
  ]) {
    assert.doesNotMatch(rendered, pattern);
  }

  const unsafeSummary = generateGraphDocsSummary(graph);
  unsafeSummary.sections.layerDesignSourceReferences[0].note = 'live route execution enabled';
  const summaryMessage = captureThrownMessage(() => assertGraphDocsSummaryCompatible(unsafeSummary));
  assert.match(summaryMessage, /must not describe Graph docs output as live runtime: live route execution/u);

  const unsafeMarkdownSummary = generateGraphDocsSummary(graph);
  unsafeMarkdownSummary.sections.layerDesignSourceReferences[0].note = 'runtime writes enabled';
  const markdownMessage = captureThrownMessage(() => renderGraphDocsSummaryMarkdown(unsafeMarkdownSummary));
  assert.match(markdownMessage, /must not describe Graph docs output as live runtime: runtime write enabled/u);
});

test('docs markdown artifact rejects live runtime wording before artifact creation', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  summary.sections.layerDesignSourceReferences[0].note = 'external telemetry enabled';

  const message = captureThrownMessage(() => createGraphDocsMarkdownArtifact(summary));

  assert.match(message, /must not describe Graph docs output as live runtime: external telemetry enabled/u);
});

test('docs renderer includes auth and session requirement summaries without materializing sessions', async () => {
  const graph = await readMinimalGraphFixture();
  addAuthRequirementDescriptors(graph);
  const summary = generateGraphDocsSummary(graph);

  const markdown = renderGraphDocsSummaryMarkdown(summary);

  assert.deepEqual(summary.sections.authRequirementSummary, [
    {
      capabilityId: 'capability:synthetic.example:open-public-page',
      authRequirementRefs: ['auth:synthetic.example:optional-login'],
      authRequiredForRefs: ['capability:synthetic.example:open-public-page'],
      sessionRequirementRefs: ['session:synthetic.example:optional-login'],
    },
  ]);
  assert.match(
    markdown,
    /## Auth Requirements\n- capability:synthetic\.example:open-public-page \| authRefs: auth:synthetic\.example:optional-login \| authRequiredFor: capability:synthetic\.example:open-public-page \| sessionRefs: session:synthetic\.example:optional-login/u,
  );
  assert.doesNotMatch(markdown, /raw-session|browserProfile|sessionId/u);
});

test('docs renderer includes signer dependency failure mode and reverse endpoint refs without executing signers', async () => {
  const graph = await readMinimalGraphFixture();
  addEndpointSupportDescriptors(graph);
  const endpoint = addEndpointDescriptor(graph, {
    requiresCookie: false,
    requiresWbi: false,
  });
  addEndpointRequirementEdges(graph, endpoint);

  const summary = generateGraphDocsSummary(graph);
  const markdown = renderGraphDocsSummaryMarkdown(summary);

  assert.deepEqual(summary.sections.signerDependencySummary, [
    {
      signerId: 'signer:synthetic.example:none',
      siteKey: 'synthetic.example',
      signerKind: 'none',
      supportedEndpointRefs: ['endpoint:synthetic.example:public-detail'],
      failureModeRefs: ['failure:graph-schema-invalid'],
      endpointSignerRefs: ['endpoint:synthetic.example:public-detail'],
    },
  ]);
  assert.match(
    markdown,
    /## Signer Dependencies\n- signer:synthetic\.example:none \| site=synthetic\.example \| signer=none \| endpoints=endpoint:synthetic\.example:public-detail \| failureModeRefs=failure:graph-schema-invalid \| endpointSignerRefs=endpoint:synthetic\.example:public-detail/u,
  );
  assert.doesNotMatch(markdown, /raw-key|signedUrl|Authorization|cookie|sessionId/u);
});

test('docs renderer includes failure mode retry semantics without runtime retry behavior', async () => {
  const graph = await readMinimalGraphFixture();

  const summary = generateGraphDocsSummary(graph);
  const markdown = renderGraphDocsSummaryMarkdown(summary);

  assert.deepEqual(summary.sections.failureModeSummary, [
    {
      failureModeId: 'failure:graph-schema-invalid',
      reasonCode: 'graph-schema-invalid',
      retryable: false,
      cooldownRequired: false,
      isolationRequired: false,
      manualRecoveryRequired: true,
      degradable: false,
      artifactWriteAllowed: false,
    },
  ]);
  assert.match(
    markdown,
    /## Failure Modes\n- failure:graph-schema-invalid \| reasonCode=graph-schema-invalid\n  - retryable: false\n  - cooldownRequired: false\n  - isolationRequired: false\n  - manualRecoveryRequired: true\n  - degradable: false\n  - artifactWriteAllowed: false/u,
  );
  assert.doesNotMatch(markdown, /retry execution|runtime retry|cooldown execution|manual recovery execution/u);
});

test('docs renderer includes failure mode artifact-write semantics without artifact writes', async () => {
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

  const summary = generateGraphDocsSummary(graph);
  const markdown = renderGraphDocsSummaryMarkdown(summary);

  assert.deepEqual(
    summary.sections.failureModeSummary.map((entry) => ({
      failureModeId: entry.failureModeId,
      reasonCode: entry.reasonCode,
      artifactWriteAllowed: entry.artifactWriteAllowed,
    })),
    [
      {
        failureModeId: 'failure:graph-schema-invalid',
        reasonCode: 'graph-schema-invalid',
        artifactWriteAllowed: false,
      },
      {
        failureModeId: 'failure:graph-query-no-match',
        reasonCode: 'graph-query-no-match',
        artifactWriteAllowed: true,
      },
    ],
  );
  assert.match(
    markdown,
    /- failure:graph-schema-invalid \| reasonCode=graph-schema-invalid\n  - retryable: false\n  - cooldownRequired: false\n  - isolationRequired: false\n  - manualRecoveryRequired: true\n  - degradable: false\n  - artifactWriteAllowed: false/u,
  );
  assert.match(
    markdown,
    /- failure:graph-query-no-match \| reasonCode=graph-query-no-match\n  - retryable: true\n  - cooldownRequired: false\n  - isolationRequired: false\n  - manualRecoveryRequired: false\n  - degradable: true\n  - artifactWriteAllowed: true/u,
  );
  assert.doesNotMatch(markdown, /artifact write execution|runtime artifact write|repo output path|audit path/u);
});

test('docs renderer includes failure mode manual-recovery semantics without recovery execution', async () => {
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

  const summary = generateGraphDocsSummary(graph);
  const markdown = renderGraphDocsSummaryMarkdown(summary);

  assert.deepEqual(
    summary.sections.failureModeSummary.map((entry) => ({
      failureModeId: entry.failureModeId,
      reasonCode: entry.reasonCode,
      manualRecoveryRequired: entry.manualRecoveryRequired,
    })),
    [
      {
        failureModeId: 'failure:graph-schema-invalid',
        reasonCode: 'graph-schema-invalid',
        manualRecoveryRequired: true,
      },
      {
        failureModeId: 'failure:graph-route-forbidden-by-risk',
        reasonCode: 'graph-route-forbidden-by-risk',
        manualRecoveryRequired: false,
      },
    ],
  );
  assert.match(
    markdown,
    /- failure:graph-schema-invalid \| reasonCode=graph-schema-invalid\n  - retryable: false\n  - cooldownRequired: false\n  - isolationRequired: false\n  - manualRecoveryRequired: true/u,
  );
  assert.match(
    markdown,
    /- failure:graph-route-forbidden-by-risk \| reasonCode=graph-route-forbidden-by-risk\n  - retryable: false\n  - cooldownRequired: false\n  - isolationRequired: true\n  - manualRecoveryRequired: false/u,
  );
  assert.doesNotMatch(markdown, /manual recovery execution|recovery service|runtime recovery|artifact write|SessionView/u);
});

test('docs renderer includes failure mode cooldown semantics without cooldown execution', async () => {
  const graph = await readMinimalGraphFixture();
  graph.nodes.push({
    schemaVersion: 1,
    id: 'failure:graph-auth-expired',
    type: 'FailureModeNode',
    reasonCode: 'graph-auth-expired',
    retryable: true,
    cooldownRequired: true,
    isolationRequired: false,
    manualRecoveryRequired: false,
    degradable: true,
    artifactWriteAllowed: false,
  });

  const summary = generateGraphDocsSummary(graph);
  const markdown = renderGraphDocsSummaryMarkdown(summary);

  assert.deepEqual(
    summary.sections.failureModeSummary.map((entry) => ({
      failureModeId: entry.failureModeId,
      reasonCode: entry.reasonCode,
      cooldownRequired: entry.cooldownRequired,
    })),
    [
      {
        failureModeId: 'failure:graph-schema-invalid',
        reasonCode: 'graph-schema-invalid',
        cooldownRequired: false,
      },
      {
        failureModeId: 'failure:graph-auth-expired',
        reasonCode: 'graph-auth-expired',
        cooldownRequired: true,
      },
    ],
  );
  assert.match(
    markdown,
    /- failure:graph-schema-invalid \| reasonCode=graph-schema-invalid\n  - retryable: false\n  - cooldownRequired: false/u,
  );
  assert.match(
    markdown,
    /- failure:graph-auth-expired \| reasonCode=graph-auth-expired\n  - retryable: true\n  - cooldownRequired: true/u,
  );
  assert.doesNotMatch(markdown, /cooldown execution|runtime cooldown|risk-state transition|timer scheduling|artifact write|SessionView/u);
});

test('docs renderer includes failure mode degradation semantics without degradation execution', async () => {
  const graph = await readMinimalGraphFixture();
  graph.nodes.push({
    schemaVersion: 1,
    id: 'failure:graph-planner-context-unsatisfied',
    type: 'FailureModeNode',
    reasonCode: 'graph-planner-context-unsatisfied',
    retryable: false,
    cooldownRequired: false,
    isolationRequired: false,
    manualRecoveryRequired: false,
    degradable: true,
    artifactWriteAllowed: false,
  });

  const summary = generateGraphDocsSummary(graph);
  const markdown = renderGraphDocsSummaryMarkdown(summary);

  assert.deepEqual(
    summary.sections.failureModeSummary.map((entry) => ({
      failureModeId: entry.failureModeId,
      reasonCode: entry.reasonCode,
      degradable: entry.degradable,
    })),
    [
      {
        failureModeId: 'failure:graph-schema-invalid',
        reasonCode: 'graph-schema-invalid',
        degradable: false,
      },
      {
        failureModeId: 'failure:graph-planner-context-unsatisfied',
        reasonCode: 'graph-planner-context-unsatisfied',
        degradable: true,
      },
    ],
  );
  assert.match(
    markdown,
    /- failure:graph-schema-invalid \| reasonCode=graph-schema-invalid\n  - retryable: false\n  - cooldownRequired: false\n  - isolationRequired: false\n  - manualRecoveryRequired: true\n  - degradable: false/u,
  );
  assert.match(
    markdown,
    /- failure:graph-planner-context-unsatisfied \| reasonCode=graph-planner-context-unsatisfied\n  - retryable: false\n  - cooldownRequired: false\n  - isolationRequired: false\n  - manualRecoveryRequired: false\n  - degradable: true/u,
  );
  assert.doesNotMatch(markdown, /degradation execution|fallback execution|runtime degradation|route execution|artifact write|SessionView|downloader/u);
});

test('docs renderer includes failure mode catalogAction semantics without catalog mutation', async () => {
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

  const summary = generateGraphDocsSummary(graph);
  const markdown = renderGraphDocsSummaryMarkdown(summary);

  assert.deepEqual(
    summary.sections.failureModeSummary
      .filter((entry) => entry.catalogAction !== undefined)
      .map((entry) => ({
        failureModeId: entry.failureModeId,
        reasonCode: entry.reasonCode,
        catalogAction: entry.catalogAction,
      })),
    [
      {
        failureModeId: 'failure:graph-query-no-match',
        reasonCode: 'graph-query-no-match',
        catalogAction: 'none',
      },
      {
        failureModeId: 'failure:graph-endpoint-missing-schema',
        reasonCode: 'graph-endpoint-missing-schema',
        catalogAction: 'deprecate',
      },
      {
        failureModeId: 'failure:graph-candidate-promotion-forbidden',
        reasonCode: 'graph-candidate-promotion-forbidden',
        catalogAction: 'block',
      },
    ],
  );
  assert.match(
    markdown,
    /- failure:graph-query-no-match \| reasonCode=graph-query-no-match\n  - retryable: true\n  - cooldownRequired: false\n  - isolationRequired: false\n  - manualRecoveryRequired: false\n  - degradable: true\n  - artifactWriteAllowed: false\n  - catalogAction: none/u,
  );
  assert.match(
    markdown,
    /- failure:graph-endpoint-missing-schema \| reasonCode=graph-endpoint-missing-schema\n  - retryable: false\n  - cooldownRequired: false\n  - isolationRequired: true\n  - manualRecoveryRequired: true\n  - degradable: false\n  - artifactWriteAllowed: false\n  - catalogAction: deprecate/u,
  );
  assert.match(
    markdown,
    /- failure:graph-candidate-promotion-forbidden \| reasonCode=graph-candidate-promotion-forbidden\n  - retryable: false\n  - cooldownRequired: false\n  - isolationRequired: true\n  - manualRecoveryRequired: true\n  - degradable: false\n  - artifactWriteAllowed: false\n  - catalogAction: block/u,
  );
  assert.doesNotMatch(
    markdown,
    /catalog mutation|catalog write|catalog promotion|runtime deprecation|endpoint materialization|artifact write execution|SiteAdapter runtime|downloader|SessionView|Authorization|cookie|sessionId|browserProfile/u,
  );
});

test('docs markdown artifact preserves failure mode catalogAction descriptors without artifact writes', async () => {
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

  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const markdown = artifact.items[0].markdown;
  const artifactJson = JSON.stringify(artifact);

  assert.equal(artifact.artifactFamily, 'site-capability-graph-docs-markdown');
  assert.equal(artifact.redactionRequired, true);
  assert.equal(assertGraphDocsMarkdownArtifactConsumerCompatibility(artifact), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(artifact), true);
  assert.deepEqual(
    summary.sections.failureModeSummary
      .filter((entry) => entry.catalogAction !== undefined)
      .map((entry) => ({
        failureModeId: entry.failureModeId,
        catalogAction: entry.catalogAction,
      })),
    [
      {
        failureModeId: 'failure:graph-query-no-match',
        catalogAction: 'none',
      },
      {
        failureModeId: 'failure:graph-endpoint-missing-schema',
        catalogAction: 'deprecate',
      },
      {
        failureModeId: 'failure:graph-candidate-promotion-forbidden',
        catalogAction: 'block',
      },
    ],
  );
  for (const catalogAction of ['none', 'deprecate', 'block']) {
    assert.match(markdown, new RegExp(`catalogAction: ${catalogAction}`, 'u'));
  }
  assert.doesNotMatch(
    artifactJson,
    /Authorization|cookie|csrf|sessionId|browserProfile|synthetic-secret-value/u,
  );
  assert.doesNotMatch(
    markdown,
    /catalog mutation|catalog write|catalog promotion|api-candidate promotion|runtime deprecation|endpoint lifecycle mutation|SiteAdapter runtime|downloader|SessionView/u,
  );
});

test('docs markdown artifact keeps failureModeSummary descriptors redaction-required', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const markdown = artifact.items[0].markdown;

  assert.equal(artifact.redactionRequired, true);
  assert.equal(artifact.artifactFamily, 'site-capability-graph-docs-markdown');
  assert.equal(artifact.queryName, 'renderGraphDocsSummaryMarkdown');
  assert.equal(assertGraphDocsMarkdownArtifactConsumerCompatibility(artifact), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(artifact), true);
  assert.match(markdown, /## Failure Modes/u);
  assert.match(markdown, /failure:graph-schema-invalid/u);
  assert.match(markdown, /artifactWriteAllowed: false/u);

  const unsafeForConsumer = structuredClone(artifact);
  unsafeForConsumer.redactionRequired = false;
  const consumerMessage = captureThrownMessage(() => (
    assertGraphDocsMarkdownArtifactConsumerCompatibility(unsafeForConsumer)
  ));
  assert.match(consumerMessage, /redactionRequired must be true/u);
  assert.doesNotMatch(consumerMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const unsafeForWriter = structuredClone(artifact);
  unsafeForWriter.redactionRequired = false;
  const writerMessage = captureThrownMessage(() => assertGraphDerivedArtifactWriteAllowed(unsafeForWriter));
  assert.match(writerMessage, /redactionRequired=true/u);
  assert.doesNotMatch(writerMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
});

test('docs renderer omits catalogAction for legacy failure modes without catalog descriptors', async () => {
  const graph = await readMinimalGraphFixture();

  const summary = generateGraphDocsSummary(graph);
  const markdown = renderGraphDocsSummaryMarkdown(summary);
  const legacyFailureMode = summary.sections.failureModeSummary.find(
    (entry) => entry.failureModeId === 'failure:graph-schema-invalid',
  );
  const legacyMarkdown = markdown.match(
    /- failure:graph-schema-invalid \| reasonCode=graph-schema-invalid[\s\S]*?(?=\n- failure:|\n## )/u,
  )?.[0];

  assert.equal(legacyFailureMode.reasonCode, 'graph-schema-invalid');
  assert.equal('catalogAction' in legacyFailureMode, false);
  assert.equal(typeof legacyMarkdown, 'string');
  assert.doesNotMatch(legacyMarkdown, /catalogAction:/u);
  assert.doesNotMatch(
    legacyMarkdown,
    /catalog mutation|catalog write|catalog promotion|deprecating catalog|blocking catalog|runtime deprecation|endpoint lifecycle mutation|SiteAdapter runtime|downloader|SessionView/u,
  );
});

test('docs renderer keeps catalogAction block and deprecate as non-mutating descriptors', async () => {
  const graph = await readMinimalGraphFixture();
  graph.nodes.push(
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

  const markdown = renderGraphDocsSummaryMarkdown(generateGraphDocsSummary(graph));

  assert.match(
    markdown,
    /failure:graph-endpoint-missing-schema[\s\S]*catalogAction: deprecate/u,
  );
  assert.match(
    markdown,
    /failure:graph-candidate-promotion-forbidden[\s\S]*catalogAction: block/u,
  );
  assert.doesNotMatch(
    markdown,
    /deprecating catalog|blocking catalog|catalog mutation|catalog write|catalog promotion|api-candidate promotion|runtime deprecation|endpoint lifecycle mutation|artifact write|SiteAdapter runtime|downloader|SessionView/u,
  );
});

test('docs renderer includes risk policy capability and endpoint refs without executing risk state', async () => {
  const graph = await readMinimalGraphFixture();
  addEndpointSupportDescriptors(graph);
  const endpoint = addEndpointDescriptor(graph, {
    requiresCookie: false,
    requiresWbi: false,
  });
  addEndpointRequirementEdges(graph, endpoint);

  const summary = generateGraphDocsSummary(graph);
  const markdown = renderGraphDocsSummaryMarkdown(summary);
  const capabilityRiskSummary = summary.sections.riskPolicySummary.find(
    (entry) => entry.ownerType === 'CapabilityNode',
  );

  assert.deepEqual(capabilityRiskSummary, {
    ownerType: 'CapabilityNode',
    ownerId: 'capability:synthetic.example:open-public-page',
    riskPolicyRef: 'risk-policy:synthetic.example:normal-readonly',
    riskState: 'normal',
    riskPolicyCapabilityRefs: ['capability:synthetic.example:open-public-page'],
    riskPolicyEndpointRefs: ['endpoint:synthetic.example:public-detail'],
  });
  assert.deepEqual(
    summary.sections.riskPolicySummary
      .filter((entry) => entry.ownerType === 'EndpointNode'),
    [
      {
        ownerType: 'EndpointNode',
        ownerId: 'endpoint:synthetic.example:public-detail',
        riskPolicyRef: 'risk-policy:synthetic.example:normal-readonly',
        riskState: 'normal',
        riskPolicyCapabilityRefs: ['capability:synthetic.example:open-public-page'],
        riskPolicyEndpointRefs: ['endpoint:synthetic.example:public-detail'],
      },
    ],
  );
  assert.match(
    markdown,
    /## Risk Policies[\s\S]*- CapabilityNode capability:synthetic\.example:open-public-page \| policy=risk-policy:synthetic\.example:normal-readonly \| state=normal \| capabilityRefs=capability:synthetic\.example:open-public-page \| endpointRefs=endpoint:synthetic\.example:public-detail/u,
  );
  assert.match(
    markdown,
    /## Risk Policies[\s\S]*- EndpointNode endpoint:synthetic\.example:public-detail \| policy=risk-policy:synthetic\.example:normal-readonly \| state=normal \| capabilityRefs=capability:synthetic\.example:open-public-page \| endpointRefs=endpoint:synthetic\.example:public-detail/u,
  );
  assert.doesNotMatch(markdown, /RiskStateMachine|risk-state execution|runtime risk|sessionId|cookie/u);
});

test('docs generator reads Layer-sourced RiskPolicyNode descriptors without runtime risk transitions', async () => {
  const graph = await readMinimalGraphFixture();
  const riskPolicyRef = 'risk-policy:synthetic.example:normal-readonly';
  const riskPolicy = graph.nodes.find((node) => node.id === riskPolicyRef);
  riskPolicy.sourceRefs = [...graph.manifest.sourceInventories];

  const summary = generateGraphDocsSummary(graph);
  const markdown = renderGraphDocsSummaryMarkdown(summary);
  const [capabilityRiskSummary] = summary.sections.riskPolicySummary
    .filter((entry) => entry.ownerType === 'CapabilityNode');

  assert.deepEqual(riskPolicy.sourceRefs, [
    'config/site-capabilities.json',
    'config/site-registry.json',
  ]);
  assert.deepEqual(capabilityRiskSummary, {
    ownerType: 'CapabilityNode',
    ownerId: 'capability:synthetic.example:open-public-page',
    riskPolicyRef,
    riskState: 'normal',
    riskPolicyCapabilityRefs: ['capability:synthetic.example:open-public-page'],
    riskPolicyEndpointRefs: [],
  });
  assert.match(
    markdown,
    /## Risk Policies[\s\S]*- CapabilityNode capability:synthetic\.example:open-public-page \| policy=risk-policy:synthetic\.example:normal-readonly \| state=normal/u,
  );
  assert.doesNotMatch(
    `${JSON.stringify(summary)}\n${markdown}`,
    /RiskStateMachine|risk-state execution|runtime risk transition|runtime risk|Authorization|cookie|sessionId|browserProfile/u,
  );
});

test('docs renderer includes route fallback refs without executing routes', async () => {
  const graph = await readMinimalGraphFixture();
  addFallbackRouteDescriptor(graph);

  const summary = generateGraphDocsSummary(graph);
  const markdown = renderGraphDocsSummaryMarkdown(summary);

  const primaryRouteSummary = summary.sections.routeDependencySummary.find(
    (route) => route.routeId === 'route:synthetic.example:public-page',
  );
  assert.deepEqual(primaryRouteSummary, {
    routeId: 'route:synthetic.example:public-page',
    siteKey: 'synthetic.example',
    routeKind: 'page',
    pageType: 'public-detail',
    capabilityRefs: ['capability:synthetic.example:open-public-page'],
    fallbackRouteRefs: ['route:synthetic.example:fallback-public-page'],
    adapterRef: {
      id: 'synthetic-adapter',
      version: 'synthetic-adapter-v1',
    },
    riskPolicyRef: 'risk-policy:synthetic.example:normal-readonly',
    testEvidenceRefs: ['test:site-capability-graph-schema'],
  });
  assert.match(
    markdown,
    /## Route Dependencies[\s\S]*- route:synthetic\.example:public-page[\s\S]*  - fallbackRouteRefs: route:synthetic\.example:fallback-public-page/u,
  );
  assert.match(markdown, /  - adapterRef: \{"id":"synthetic-adapter","version":"synthetic-adapter-v1"\}/u);
  assert.doesNotMatch(markdown, /route execution|SiteAdapter runtime|downloader|sessionId|cookie/u);
});

test('docs renderer includes capability test evidence refs without executing tests', async () => {
  const graph = await readMinimalGraphFixture();

  const summary = generateGraphDocsSummary(graph);
  const markdown = renderGraphDocsSummaryMarkdown(summary);

  assert.deepEqual(summary.sections.capabilityList[0].testEvidenceRefs, [
    'test:site-capability-graph-schema',
  ]);
  assert.deepEqual(
    summary.sections.testCoverageSummary
      .filter((entry) => entry.nodeId === 'capability:synthetic.example:open-public-page'),
    [
      {
        nodeId: 'capability:synthetic.example:open-public-page',
        nodeType: 'CapabilityNode',
        testEvidenceRefs: ['test:site-capability-graph-schema'],
      },
    ],
  );
  assert.match(
    markdown,
    /## Capabilities[\s\S]*- capability:synthetic\.example:open-public-page[\s\S]*  - testEvidenceRefs: test:site-capability-graph-schema/u,
  );
  assert.match(
    markdown,
    /## Test Coverage[\s\S]*- capability:synthetic\.example:open-public-page \| type=CapabilityNode \| tests=test:site-capability-graph-schema/u,
  );
  assert.doesNotMatch(markdown, /test execution|runtime test|sessionId|cookie|Authorization/u);
});

test('docs renderer includes route adapter descriptors without invoking adapters', async () => {
  const graph = await readMinimalGraphFixture();

  const summary = generateGraphDocsSummary(graph);
  const markdown = renderGraphDocsSummaryMarkdown(summary);
  const route = summary.sections.routeDependencySummary.find(
    (entry) => entry.routeId === 'route:synthetic.example:public-page',
  );

  assert.deepEqual(route.adapterRef, {
    id: 'synthetic-adapter',
    version: 'synthetic-adapter-v1',
  });
  assert.match(
    markdown,
    /## Route Dependencies[\s\S]*- route:synthetic\.example:public-page[\s\S]*  - adapterRef: \{"id":"synthetic-adapter","version":"synthetic-adapter-v1"\}/u,
  );
  assert.doesNotMatch(markdown, /SiteAdapter runtime|adapter invocation|route execution|downloader|sessionId|cookie/u);
});

test('docs renderer includes endpoint impact map without materializing endpoint runtime data', async () => {
  const graph = await readMinimalGraphFixture();
  addEndpointSupportDescriptors(graph);
  const endpoint = addEndpointDescriptor(graph, {
    requiresCookie: false,
    requiresWbi: false,
  });
  addEndpointRequirementEdges(graph, endpoint);

  const summary = generateGraphDocsSummary(graph);
  const markdown = renderGraphDocsSummaryMarkdown(summary);

  assert.equal(assertGraphDocsSummaryCompatible(summary), true);
  assert.deepEqual(summary.sections.endpointImpactMap, [
    {
      endpointId: 'endpoint:synthetic.example:public-detail',
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
      requiresCookie: false,
      requiresWbi: false,
      testEvidenceRefs: ['test:site-capability-graph-schema'],
    },
  ]);
  assert.match(markdown, /## Endpoint Impact Map\n- endpoint:synthetic\.example:public-detail/u);
  assert.match(markdown, /  - lifecycleState: cataloged/u);
  assert.match(markdown, /  - routeRefs: route:synthetic\.example:public-page/u);
  assert.match(markdown, /  - capabilityRefs: capability:synthetic\.example:open-public-page/u);
  assert.match(markdown, /  - requestSchemaRef: schema:synthetic-public-request/u);
  assert.match(markdown, /  - responseSchemaRef: schema:synthetic-public-response/u);
  assert.match(markdown, /  - versionRef: version:synthetic-endpoint-v1/u);
  assert.match(markdown, /  - testEvidenceRefs: test:site-capability-graph-schema/u);
  assert.doesNotMatch(markdown, /raw-cookie|raw-session|browserProfile|sessionId|Authorization/u);
});

test('docs renderer includes endpoint request schema refs without request execution', async () => {
  const graph = await readMinimalGraphFixture();
  addEndpointSupportDescriptors(graph);
  const endpoint = addEndpointDescriptor(graph, {
    requiresCookie: false,
    requiresWbi: false,
  });
  addEndpointRequirementEdges(graph, endpoint);

  const summary = generateGraphDocsSummary(graph);
  const markdown = renderGraphDocsSummaryMarkdown(summary);
  const [entry] = summary.sections.endpointImpactMap;

  assert.equal(entry.requestSchemaRef, 'schema:synthetic-public-request');
  assert.match(
    markdown,
    /## Endpoint Impact Map[\s\S]*- endpoint:synthetic\.example:public-detail[\s\S]*  - requestSchemaRef: schema:synthetic-public-request/u,
  );
  assert.doesNotMatch(markdown, /request execution|request body|runtime request|Authorization|cookie|sessionId/u);
});

test('docs renderer includes endpoint version refs without version gate execution', async () => {
  const graph = await readMinimalGraphFixture();
  addEndpointSupportDescriptors(graph);
  const endpoint = addEndpointDescriptor(graph, {
    requiresCookie: false,
    requiresWbi: false,
  });
  addEndpointRequirementEdges(graph, endpoint);

  const summary = generateGraphDocsSummary(graph);
  const markdown = renderGraphDocsSummaryMarkdown(summary);
  const [entry] = summary.sections.endpointImpactMap;

  assert.equal(entry.versionRef, 'version:synthetic-endpoint-v1');
  assert.match(
    markdown,
    /## Endpoint Impact Map[\s\S]*- endpoint:synthetic\.example:public-detail[\s\S]*  - versionRef: version:synthetic-endpoint-v1/u,
  );
  assert.doesNotMatch(markdown, /version gate execution|runtime version check|endpoint execution|Authorization|cookie|sessionId/u);
});

test('docs renderer preserves observed and candidate endpoint lifecycle states without catalog promotion', async () => {
  for (const lifecycleState of ['observed', 'candidate']) {
    const graph = await readMinimalGraphFixture();
    addEndpointSupportDescriptors(graph);
    const endpoint = addEndpointDescriptor(graph, {
      lifecycleState,
      requiresCookie: false,
      requiresWbi: false,
    });
    addEndpointRequirementEdges(graph, endpoint);

    const summary = generateGraphDocsSummary(graph);
    const markdown = renderGraphDocsSummaryMarkdown(summary);
    const [entry] = summary.sections.endpointImpactMap;

    assert.equal(assertGraphDocsSummaryCompatible(summary), true);
    assert.equal(entry.endpointId, 'endpoint:synthetic.example:public-detail');
    assert.equal(entry.lifecycleState, lifecycleState);
    assert.equal(endpoint.cataloged, undefined);
    assert.match(markdown, /## Endpoint Impact Map\n- endpoint:synthetic\.example:public-detail/u);
    assert.match(markdown, new RegExp(`  - lifecycleState: ${lifecycleState}`, 'u'));
    assert.doesNotMatch(markdown, /catalog promotion|api-candidate promotion|endpoint materialization/u);
    assert.doesNotMatch(markdown, /raw-cookie|raw-session|browserProfile|sessionId|Authorization/u);
  }
});

test('docs markdown artifact descriptor writes through guarded graph artifact writer', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'site-capability-graph-docs-markdown-'));

  try {
    const placement = createGraphDerivedArtifactPlacement({
      outputDir,
      runId: 'synthetic-run-001',
      artifactFamily: 'site-capability-graph-docs-markdown',
      artifactName: 'graph-docs-summary-markdown',
    });

    assert.equal(artifact.schemaVersion, 1);
    assert.equal(artifact.graphVersion, 'synthetic-graph-v1');
    assert.equal(artifact.queryName, 'renderGraphDocsSummaryMarkdown');
    assert.equal(artifact.artifactFamily, 'site-capability-graph-docs-markdown');
    assert.equal(artifact.redactionRequired, true);
    assert.equal(artifact.items[0].format, 'markdown');
    assert.match(artifact.items[0].markdown, /^# Site Capability Graph Docs Summary\n/u);
    assert.doesNotMatch(artifact.items[0].markdown, /auth=/u);
    assert.equal(assertGraphDocsMarkdownArtifactConsumerCompatibility(artifact), true);
    assert.equal(assertGraphDerivedArtifactWriteAllowed(artifact), true);

    const result = await writeGraphDerivedArtifactPair(artifact, placement);

    assert.equal(result.artifactPath, placement.artifactPath);
    assert.equal(result.auditPath, placement.auditPath);

    const writtenArtifact = JSON.parse(await readFile(result.artifactPath, 'utf8'));
    const writtenAudit = JSON.parse(await readFile(result.auditPath, 'utf8'));
    assert.equal(writtenArtifact.artifactFamily, 'site-capability-graph-docs-markdown');
    assert.equal(writtenArtifact.items[0].markdown, artifact.items[0].markdown);
    assert.equal(writtenAudit.schemaVersion, 1);
    assert.deepEqual(writtenAudit.findings, []);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('docs markdown artifact consumer contract stays descriptor-only without runtime docs writes', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'site-capability-graph-docs-consumer-'));

  try {
    const placement = createGraphDerivedArtifactPlacement({
      outputDir,
      runId: 'synthetic-run-docs-consumer',
      artifactFamily: 'site-capability-graph-docs-markdown',
      artifactName: 'graph-docs-summary-markdown-consumer',
    });

    assert.equal(assertGraphDocsMarkdownArtifactConsumerCompatibility(artifact), true);
    assert.equal(artifact.queryName, 'renderGraphDocsSummaryMarkdown');
    assert.equal(artifact.artifactFamily, 'site-capability-graph-docs-markdown');
    assert.equal(artifact.redactionRequired, true);
    assert.equal(artifact.items[0].format, 'markdown');
    assert.match(artifact.items[0].markdown, /^# Site Capability Graph Docs Summary\n/u);

    const result = await writeGraphDerivedArtifactPair(artifact, placement);
    const artifactJson = await readFile(result.artifactPath, 'utf8');
    const auditJson = await readFile(result.auditPath, 'utf8');
    assert.doesNotMatch(artifactJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
    assert.doesNotMatch(auditJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('docs markdown artifact consumer rejects missing Layer source references', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  artifact.items[0].markdown = artifact.items[0].markdown.replace(
    /\n## Layer Design Sources\n[\s\S]*?\n## Capabilities\n/u,
    '\n## Capabilities\n',
  );

  const message = captureThrownMessage(() => assertGraphDocsMarkdownArtifactConsumerCompatibility(artifact));

  assert.match(message, /missing Layer source reference: ## Layer Design Sources/u);
});

test('docs markdown artifact consumer contract rejects runtime docs writes and unsafe payloads', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);

  assert.throws(
    () => assertGraphDocsMarkdownArtifactConsumerCompatibility({
      ...artifact,
      outputPath: 'runs/site-capability-graph/generated-docs.md',
    }),
    /descriptor-only.*outputPath/u,
  );
  assert.throws(
    () => assertGraphDocsMarkdownArtifactConsumerCompatibility({
      ...artifact,
      docsWriteEnabled: true,
    }),
    /descriptor-only.*docsWriteEnabled/u,
  );
  assert.throws(
    () => assertGraphDocsMarkdownArtifactConsumerCompatibility({
      ...artifact,
      externalTelemetryDispatchEnabled: true,
    }),
    /descriptor-only.*externalTelemetryDispatchEnabled/u,
  );
  assert.throws(
    () => assertGraphDocsMarkdownArtifactConsumerCompatibility({
      ...artifact,
      sessionView: {},
    }),
    /descriptor-only.*sessionView/u,
  );
  assert.throws(
    () => assertGraphDocsMarkdownArtifactConsumerCompatibility({
      ...artifact,
      redactionRequired: false,
    }),
    /redactionRequired must be true/u,
  );

  const fieldMessage = captureThrownMessage(() => assertGraphDocsMarkdownArtifactConsumerCompatibility({
    ...artifact,
    accessToken: 'synthetic-secret-value',
  }));
  assert.match(fieldMessage, /forbidden field/u);
  assert.doesNotMatch(fieldMessage, /synthetic-secret-value/u);

  const valueMessage = captureThrownMessage(() => assertGraphDocsMarkdownArtifactConsumerCompatibility({
    ...artifact,
    items: [{
      ...artifact.items[0],
      markdown: `${artifact.items[0].markdown}\nAuthorization: Bearer synthetic-secret-value\n`,
    }],
  }));
  assert.match(valueMessage, /Forbidden sensitive pattern/u);
  assert.doesNotMatch(valueMessage, /synthetic-secret-value/u);
});

test('disabled docs markdown runtime consumer keeps failureModeSummary artifact descriptor blocked', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const result = createDisabledGraphDocsMarkdownRuntimeConsumerResult(artifact);
  const item = result.items[0];
  const markdown = item.docsArtifact.items[0].markdown;

  assert.equal(result.redactionRequired, true);
  assert.equal(result.artifactFamily, 'site-capability-graph-docs-markdown-runtime-consumer-result');
  assert.equal(assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility(result), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(result), true);
  assert.equal(item.consumerMode, 'disabled-feature-flag');
  assert.equal(item.featureEnabled, false);
  assert.equal(item.result, 'blocked');
  assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
  assert.equal(item.docsArtifact.redactionRequired, true);
  assert.equal(item.sourceArtifact.queryName, 'renderGraphDocsSummaryMarkdown');
  assert.match(markdown, /## Failure Modes/u);
  assert.match(markdown, /failure:graph-schema-invalid/u);
  assert.equal('outputPath' in item, false);
  assert.equal('runtimeDocsWriteEnabled' in item, false);
  assert.equal('sessionView' in item, false);
  assert.equal('downloadPolicy' in item, false);

  for (const [fieldName, value] of [
    ['featureEnabled', true],
    ['runtimeDocsWriteEnabled', true],
    ['sessionView', {}],
    ['downloadPolicy', {}],
  ]) {
    const message = captureThrownMessage(() => (
      createDisabledGraphDocsMarkdownRuntimeConsumerResult(artifact, { [fieldName]: value })
    ));
    assert.match(message, fieldName === 'featureEnabled' ? /featureEnabled must remain false/u : new RegExp(`descriptor-only.*${fieldName}`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  const unsafeResult = structuredClone(result);
  unsafeResult.items[0].docsArtifact.redactionRequired = false;
  const unsafeMessage = captureThrownMessage(() => (
    assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility(unsafeResult)
  ));
  assert.match(unsafeMessage, /redactionRequired must be true/u);
  assert.doesNotMatch(unsafeMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
});

test('docs markdown repo output dry-run keeps failureModeSummary artifact contained without writes', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const targetRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.md';
  const targetUrl = new URL(`../../${targetRelativePath}`, import.meta.url);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);

  const result = createGraphDocsMarkdownRepoOutputDryRun(artifact, { targetRelativePath });
  const item = result.items[0];
  const markdown = item.docsArtifact.items[0].markdown;

  assert.equal(result.redactionRequired, true);
  assert.equal(result.artifactFamily, 'site-capability-graph-docs-markdown-repo-output-dry-run');
  assert.equal(assertGraphDocsMarkdownRepoOutputDryRunCompatibility(result), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(result), true);
  assert.equal(item.outputMode, 'dry-run-preview');
  assert.equal(item.dryRunOnly, true);
  assert.equal(item.targetRelativePath, targetRelativePath);
  assert.equal(item.repoWriteEnabled, false);
  assert.equal(item.runtimeArtifactWriteEnabled, false);
  assert.equal(item.explicitValidationRequired, true);
  assert.equal(item.sourceArtifact.queryName, 'renderGraphDocsSummaryMarkdown');
  assert.equal(item.docsArtifact.redactionRequired, true);
  assert.match(markdown, /## Failure Modes/u);
  assert.match(markdown, /failure:graph-schema-invalid/u);
  assert.equal('artifactPath' in item, false);
  assert.equal('runtimeDocsWriteEnabled' in item, false);
  assert.equal('sessionView' in item, false);
  assert.equal('downloadPolicy' in item, false);

  for (const [fieldName, value] of [
    ['repoWriteEnabled', true],
    ['runtimeArtifactWriteEnabled', true],
    ['sessionView', {}],
    ['downloadPolicy', {}],
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsMarkdownRepoOutputDryRun(artifact, {
        targetRelativePath,
        [fieldName]: value,
      })
    ));
    assert.match(message, fieldName.endsWith('Enabled') ? new RegExp(`${fieldName} must remain false`, 'u') : new RegExp(`descriptor-only.*${fieldName}`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  for (const target of [
    '../generated-failuremode-summary-docs.md',
    'site-capability-graph/generated-failuremode-summary-docs.md',
    'runs/site-capability-graph/generated-failuremode-summary-docs.json',
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsMarkdownRepoOutputDryRun(artifact, { targetRelativePath: target })
    ));
    assert.match(message, /targetRelativePath/u);
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  const unsafeResult = structuredClone(result);
  unsafeResult.items[0].repoWriteEnabled = true;
  const unsafeMessage = captureThrownMessage(() => (
    assertGraphDocsMarkdownRepoOutputDryRunCompatibility(unsafeResult)
  ));
  assert.match(unsafeMessage, /repoWriteEnabled must be false/u);
  assert.doesNotMatch(unsafeMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
});

test('docs markdown failureModeSummary repo output approval gate stays design-only', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const markdown = renderGraphDocsSummaryMarkdown(summary);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const targetRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.md';
  const targetUrl = new URL(`../../${targetRelativePath}`, import.meta.url);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
  assert.equal(artifact.items[0].markdown, markdown);
  assert.match(markdown, /## Failure Modes/u);
  assert.match(markdown, /failure:graph-schema-invalid/u);

  const dryRun = createGraphDocsMarkdownRepoOutputDryRun(artifact, { targetRelativePath });
  const gate = createGraphRepoOutputApprovalGateDesign(dryRun);
  const item = gate.items[0];
  const sourceRepoOutput = item.sourceRepoOutput;
  const sourceItem = sourceRepoOutput.items[0];

  assert.equal(assertGraphDocsMarkdownRepoOutputDryRunCompatibility(dryRun), true);
  assert.equal(assertGraphRepoOutputApprovalGateDesignCompatibility(gate), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(gate), true);
  assert.equal(gate.queryName, 'createGraphRepoOutputApprovalGateDesign');
  assert.equal(gate.artifactFamily, 'site-capability-graph-repo-output-approval-gate-design');
  assert.equal(gate.redactionRequired, true);
  assert.equal(item.gateName, 'site-capability-graph-repo-output-approval-gate');
  assert.equal(item.gateMode, 'design-only');
  for (const fieldName of [
    'approvalGateEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'runtimeGenerationEnabled',
    'externalCommandEnabled',
    'schedulerPublishEnabled',
    'doctorPublishEnabled',
    'skillPublishEnabled',
    'mcpPublishEnabled',
  ]) {
    assert.equal(item[fieldName], false);
  }
  assert.equal(item.approvalRequiredBeforeRepoWrite, true);
  assert.equal(item.sourceOutputDryRunOnly, true);
  for (const requiredEvidence of [
    'explicit-user-request-in-current-task',
    'matrix-section-updated-with-verification',
    'focused-tests-passed',
    'redaction-guard-passed',
    'repo-target-contained',
    'B-review-accepted',
  ]) {
    assert.ok(item.requiredApprovalEvidence.includes(requiredEvidence));
  }

  assert.equal(sourceRepoOutput.artifactFamily, 'site-capability-graph-docs-markdown-repo-output-dry-run');
  assert.equal(sourceItem.targetRelativePath, targetRelativePath);
  assert.equal(sourceItem.outputMode, 'dry-run-preview');
  assert.equal(sourceItem.dryRunOnly, true);
  assert.equal(sourceItem.repoWriteEnabled, false);
  assert.equal(sourceItem.runtimeArtifactWriteEnabled, false);
  assert.equal(sourceItem.explicitValidationRequired, true);
  assert.equal(sourceItem.docsArtifact.redactionRequired, true);
  assert.match(sourceItem.docsArtifact.items[0].markdown, /failure:graph-schema-invalid/u);
  assert.equal('sessionView' in item, false);
  assert.equal('downloadPolicy' in item, false);
  assert.equal('publishPayload' in item, false);
  assert.equal('sessionView' in sourceItem, false);
  assert.equal('downloadPolicy' in sourceItem, false);
  assert.equal('artifactPath' in sourceItem, false);

  for (const fieldName of [
    'approvalGateEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'runtimeGenerationEnabled',
    'externalCommandEnabled',
    'schedulerPublishEnabled',
    'doctorPublishEnabled',
    'skillPublishEnabled',
    'mcpPublishEnabled',
  ]) {
    const message = captureThrownMessage(() => (
      createGraphRepoOutputApprovalGateDesign(dryRun, { [fieldName]: true })
    ));
    assert.match(message, new RegExp(`${fieldName} must remain false`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  for (const [fieldName, value] of [
    ['sessionView', {}],
    ['downloadPolicy', {}],
    ['publishPayload', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
  ]) {
    const message = captureThrownMessage(() => (
      createGraphRepoOutputApprovalGateDesign(dryRun, { [fieldName]: value })
    ));
    assert.match(message, new RegExp(`descriptor-only.*${fieldName}`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  const unsafeSource = structuredClone(dryRun);
  unsafeSource.items[0].repoWriteEnabled = true;
  const sourceMutationMessage = captureThrownMessage(() => (
    createGraphRepoOutputApprovalGateDesign(unsafeSource)
  ));
  assert.match(sourceMutationMessage, /repoWriteEnabled must be false/u);
  assert.doesNotMatch(sourceMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const unsafeValidationSource = structuredClone(dryRun);
  unsafeValidationSource.items[0].explicitValidationRequired = false;
  const validationMutationMessage = captureThrownMessage(() => (
    createGraphRepoOutputApprovalGateDesign(unsafeValidationSource)
  ));
  assert.match(validationMutationMessage, /explicitValidationRequired must be true/u);
  assert.doesNotMatch(validationMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const unsafeDocsArtifactSource = structuredClone(dryRun);
  unsafeDocsArtifactSource.items[0].docsArtifact.redactionRequired = false;
  const docsArtifactMutationMessage = captureThrownMessage(() => (
    createGraphRepoOutputApprovalGateDesign(unsafeDocsArtifactSource)
  ));
  assert.match(docsArtifactMutationMessage, /redactionRequired must be true/u);
  assert.doesNotMatch(docsArtifactMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const unsafeGate = structuredClone(gate);
  unsafeGate.items[0].sourceRepoOutput.items[0].dryRunOnly = false;
  const gateMutationMessage = captureThrownMessage(() => (
    assertGraphRepoOutputApprovalGateDesignCompatibility(unsafeGate)
  ));
  assert.match(gateMutationMessage, /dryRunOnly must be true/u);
  assert.doesNotMatch(gateMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
});

test('docs markdown failureModeSummary generated-output manifest guard stays descriptor-only', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const markdown = renderGraphDocsSummaryMarkdown(summary);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const targetRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.md';
  const manifestRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.manifest.json';
  const targetUrl = new URL(`../../${targetRelativePath}`, import.meta.url);
  const manifestUrl = new URL(`../../${manifestRelativePath}`, import.meta.url);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
  await assert.rejects(() => access(manifestUrl), /ENOENT/u);
  assert.equal(artifact.items[0].markdown, markdown);
  assert.match(markdown, /## Failure Modes/u);
  assert.match(markdown, /failure:graph-schema-invalid/u);

  const dryRun = createGraphDocsMarkdownRepoOutputDryRun(artifact, { targetRelativePath });
  const gate = createGraphRepoOutputApprovalGateDesign(dryRun);
  const manifestGuard = createGraphDocsMarkdownGeneratedOutputManifestGuard(gate, {
    manifestRelativePath,
  });
  const item = manifestGuard.items[0];

  assert.equal(assertGraphDocsMarkdownRepoOutputDryRunCompatibility(dryRun), true);
  assert.equal(assertGraphRepoOutputApprovalGateDesignCompatibility(gate), true);
  assert.equal(assertGraphDocsMarkdownGeneratedOutputManifestGuardCompatibility(manifestGuard), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(manifestGuard), true);
  assert.equal(manifestGuard.queryName, 'createGraphDocsMarkdownGeneratedOutputManifestGuard');
  assert.equal(
    manifestGuard.artifactFamily,
    'site-capability-graph-docs-markdown-generated-output-manifest-guard',
  );
  assert.equal(manifestGuard.redactionRequired, true);
  assert.equal(item.guardMode, 'descriptor-only');
  assert.equal(item.manifestKind, 'generated-output-manifest');
  assert.equal(item.manifestRelativePath, manifestRelativePath);
  assert.equal(item.generatedOutputTargetRelativePath, targetRelativePath);
  assert.equal(item.sourceOutputFamily, 'site-capability-graph-docs-markdown-repo-output-dry-run');
  assert.equal(item.sourceGateFamily, 'site-capability-graph-repo-output-approval-gate-design');
  for (const fieldName of [
    'manifestWriteEnabled',
    'repoWriteEnabled',
    'runtimeGenerationEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
  ]) {
    assert.equal(item[fieldName], false);
  }
  assert.equal(item.explicitValidationRequired, true);
  assert.equal(item.redactionRequiredBeforeManifestWrite, true);
  assert.equal(item.requiredApprovalGate, 'createGraphRepoOutputApprovalGateDesign');
  assert.equal(
    item.requiredArtifactGuard,
    'SecurityGuard/Redaction before graph-derived artifact writes',
  );
  assert.equal('manifestPath' in item, false);
  assert.equal('artifactPath' in item, false);
  assert.equal('sessionView' in item, false);
  assert.equal('downloadPolicy' in item, false);
  assert.equal('publishPayload' in item, false);
  assert.match(
    item.sourceApprovalGate.items[0].sourceRepoOutput.items[0].docsArtifact.items[0].markdown,
    /failure:graph-schema-invalid/u,
  );

  for (const fieldName of [
    'manifestWriteEnabled',
    'repoWriteEnabled',
    'runtimeGenerationEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsMarkdownGeneratedOutputManifestGuard(gate, {
        manifestRelativePath,
        [fieldName]: true,
      })
    ));
    assert.match(message, new RegExp(`${fieldName} must remain false`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  for (const [fieldName, value] of [
    ['generatedOutputManifest', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
    ['generatedOutputPath', 'runs/site-capability-graph/generated-failuremode-summary-docs.manifest.json'],
    ['manifestPath', manifestRelativePath],
    ['sessionView', {}],
    ['downloadPolicy', {}],
    ['publishPayload', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsMarkdownGeneratedOutputManifestGuard(gate, {
        manifestRelativePath,
        [fieldName]: value,
      })
    ));
    assert.match(message, new RegExp(`descriptor-only.*${fieldName}`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  for (const manifestTarget of [
    '../generated-failuremode-summary-docs.manifest.json',
    'site-capability-graph/generated-failuremode-summary-docs.manifest.json',
    'runs/site-capability-graph/generated-failuremode-summary-docs.json',
    'runs/site-capability-graph/generated-failuremode-summary-docs.md',
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsMarkdownGeneratedOutputManifestGuard(gate, {
        manifestRelativePath: manifestTarget,
      })
    ));
    assert.match(message, /manifestRelativePath/u);
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  const unsafeGuard = structuredClone(manifestGuard);
  unsafeGuard.items[0].manifestWriteEnabled = true;
  const manifestMutationMessage = captureThrownMessage(() => (
    assertGraphDocsMarkdownGeneratedOutputManifestGuardCompatibility(unsafeGuard)
  ));
  assert.match(manifestMutationMessage, /manifestWriteEnabled must be false/u);
  assert.doesNotMatch(manifestMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const unsafeSource = structuredClone(manifestGuard);
  unsafeSource.items[0].sourceApprovalGate.items[0].sourceRepoOutput.items[0].docsArtifact.redactionRequired = false;
  const sourceMutationMessage = captureThrownMessage(() => (
    assertGraphDocsMarkdownGeneratedOutputManifestGuardCompatibility(unsafeSource)
  ));
  assert.match(sourceMutationMessage, /redactionRequired must be true/u);
  assert.doesNotMatch(sourceMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const wrongSource = createGraphMigrationReportRepoOutputDryRun(graph, {
    targetRelativePath: 'runs/site-capability-graph/generated-migration-report-dry-run.md',
  });
  const wrongGate = createGraphRepoOutputApprovalGateDesign(wrongSource);
  const wrongSourceMessage = captureThrownMessage(() => (
    createGraphDocsMarkdownGeneratedOutputManifestGuard(wrongGate, { manifestRelativePath })
  ));
  assert.match(wrongSourceMessage, /must wrap docs markdown repo output dry-run/u);
  assert.doesNotMatch(wrongSourceMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
  await assert.rejects(() => access(manifestUrl), /ENOENT/u);
});

test('docs markdown failureModeSummary retained-output index guard stays descriptor-only', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const targetRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.md';
  const manifestRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.manifest.json';
  const indexRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.retained-index.json';
  const targetUrl = new URL(`../../${targetRelativePath}`, import.meta.url);
  const manifestUrl = new URL(`../../${manifestRelativePath}`, import.meta.url);
  const indexUrl = new URL(`../../${indexRelativePath}`, import.meta.url);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
  await assert.rejects(() => access(manifestUrl), /ENOENT/u);
  await assert.rejects(() => access(indexUrl), /ENOENT/u);

  const dryRun = createGraphDocsMarkdownRepoOutputDryRun(artifact, { targetRelativePath });
  const gate = createGraphRepoOutputApprovalGateDesign(dryRun);
  const manifestGuard = createGraphDocsMarkdownGeneratedOutputManifestGuard(gate, {
    manifestRelativePath,
  });
  const indexGuard = createGraphDocsMarkdownRetainedOutputIndexGuard(manifestGuard, {
    indexRelativePath,
  });
  const item = indexGuard.items[0];

  assert.equal(assertGraphDocsMarkdownGeneratedOutputManifestGuardCompatibility(manifestGuard), true);
  assert.equal(assertGraphDocsMarkdownRetainedOutputIndexGuardCompatibility(indexGuard), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(indexGuard), true);
  assert.equal(indexGuard.queryName, 'createGraphDocsMarkdownRetainedOutputIndexGuard');
  assert.equal(
    indexGuard.artifactFamily,
    'site-capability-graph-docs-markdown-retained-output-index-guard',
  );
  assert.equal(indexGuard.redactionRequired, true);
  assert.equal(item.guardMode, 'descriptor-only');
  assert.equal(item.indexKind, 'retained-output-index');
  assert.equal(item.indexRelativePath, indexRelativePath);
  assert.equal(item.manifestRelativePath, manifestRelativePath);
  assert.equal(item.generatedOutputTargetRelativePath, targetRelativePath);
  assert.equal(item.sourceManifestGuardFamily, 'site-capability-graph-docs-markdown-generated-output-manifest-guard');
  assert.equal(item.sourceOutputFamily, 'site-capability-graph-docs-markdown-repo-output-dry-run');
  assert.equal(item.sourceGateFamily, 'site-capability-graph-repo-output-approval-gate-design');
  for (const fieldName of [
    'indexWriteEnabled',
    'repoWriteEnabled',
    'runtimeIndexingEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
  ]) {
    assert.equal(item[fieldName], false);
  }
  assert.equal(item.explicitValidationRequired, true);
  assert.equal(item.redactionRequiredBeforeIndexWrite, true);
  assert.equal(item.requiredManifestGuard, 'createGraphDocsMarkdownGeneratedOutputManifestGuard');
  assert.equal(
    item.requiredArtifactGuard,
    'SecurityGuard/Redaction before graph-derived artifact writes',
  );
  assert.equal('indexPath' in item, false);
  assert.equal('retainedOutputIndex' in item, false);
  assert.equal('artifactPath' in item, false);
  assert.equal('sessionView' in item, false);
  assert.equal('downloadPolicy' in item, false);
  assert.equal('publishPayload' in item, false);
  assert.match(
    item.sourceManifestGuard.items[0].sourceApprovalGate.items[0].sourceRepoOutput.items[0].docsArtifact.items[0].markdown,
    /failure:graph-schema-invalid/u,
  );

  for (const fieldName of [
    'indexWriteEnabled',
    'repoWriteEnabled',
    'runtimeIndexingEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsMarkdownRetainedOutputIndexGuard(manifestGuard, {
        indexRelativePath,
        [fieldName]: true,
      })
    ));
    assert.match(message, new RegExp(`${fieldName} must remain false`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  for (const [fieldName, value] of [
    ['retainedOutputIndex', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
    ['retainedOutputPath', 'runs/site-capability-graph/generated-failuremode-summary-docs.retained-index.json'],
    ['indexPath', indexRelativePath],
    ['sessionView', {}],
    ['downloadPolicy', {}],
    ['publishPayload', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsMarkdownRetainedOutputIndexGuard(manifestGuard, {
        indexRelativePath,
        [fieldName]: value,
      })
    ));
    assert.match(message, new RegExp(`descriptor-only.*${fieldName}`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  for (const indexTarget of [
    '../generated-failuremode-summary-docs.retained-index.json',
    'site-capability-graph/generated-failuremode-summary-docs.retained-index.json',
    'runs/site-capability-graph/generated-failuremode-summary-docs.json',
    'runs/site-capability-graph/generated-failuremode-summary-docs.manifest.json',
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsMarkdownRetainedOutputIndexGuard(manifestGuard, {
        indexRelativePath: indexTarget,
      })
    ));
    assert.match(message, /indexRelativePath/u);
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  const unsafeIndexGuard = structuredClone(indexGuard);
  unsafeIndexGuard.items[0].indexWriteEnabled = true;
  const indexMutationMessage = captureThrownMessage(() => (
    assertGraphDocsMarkdownRetainedOutputIndexGuardCompatibility(unsafeIndexGuard)
  ));
  assert.match(indexMutationMessage, /indexWriteEnabled must be false/u);
  assert.doesNotMatch(indexMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const unsafeSource = structuredClone(indexGuard);
  unsafeSource.items[0].sourceManifestGuard.items[0].sourceApprovalGate.items[0].sourceRepoOutput.items[0].docsArtifact.redactionRequired = false;
  const sourceMutationMessage = captureThrownMessage(() => (
    assertGraphDocsMarkdownRetainedOutputIndexGuardCompatibility(unsafeSource)
  ));
  assert.match(sourceMutationMessage, /redactionRequired must be true/u);
  assert.doesNotMatch(sourceMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const wrongSourceMessage = captureThrownMessage(() => (
    createGraphDocsMarkdownRetainedOutputIndexGuard(gate, { indexRelativePath })
  ));
  assert.match(
    wrongSourceMessage,
    /GraphDocsMarkdownGeneratedOutputManifestGuard|sourceManifestGuard/u,
  );
  assert.doesNotMatch(wrongSourceMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
  await assert.rejects(() => access(manifestUrl), /ENOENT/u);
  await assert.rejects(() => access(indexUrl), /ENOENT/u);
});

test('docs markdown failureModeSummary cleanup-policy guard stays descriptor-only', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const targetRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.md';
  const manifestRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.manifest.json';
  const indexRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.retained-index.json';
  const targetUrl = new URL(`../../${targetRelativePath}`, import.meta.url);
  const manifestUrl = new URL(`../../${manifestRelativePath}`, import.meta.url);
  const indexUrl = new URL(`../../${indexRelativePath}`, import.meta.url);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
  await assert.rejects(() => access(manifestUrl), /ENOENT/u);
  await assert.rejects(() => access(indexUrl), /ENOENT/u);

  const dryRun = createGraphDocsMarkdownRepoOutputDryRun(artifact, { targetRelativePath });
  const gate = createGraphRepoOutputApprovalGateDesign(dryRun);
  const manifestGuard = createGraphDocsMarkdownGeneratedOutputManifestGuard(gate, {
    manifestRelativePath,
  });
  const indexGuard = createGraphDocsMarkdownRetainedOutputIndexGuard(manifestGuard, {
    indexRelativePath,
  });
  const cleanupGuard = createGraphDocsMarkdownCleanupPolicyGuard(indexGuard);
  const item = cleanupGuard.items[0];

  assert.equal(assertGraphDocsMarkdownRetainedOutputIndexGuardCompatibility(indexGuard), true);
  assert.equal(assertGraphDocsMarkdownCleanupPolicyGuardCompatibility(cleanupGuard), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(cleanupGuard), true);
  assert.equal(cleanupGuard.queryName, 'createGraphDocsMarkdownCleanupPolicyGuard');
  assert.equal(
    cleanupGuard.artifactFamily,
    'site-capability-graph-docs-markdown-cleanup-policy-guard',
  );
  assert.equal(cleanupGuard.redactionRequired, true);
  assert.equal(item.guardMode, 'descriptor-only');
  assert.equal(item.policyKind, 'artifact-descriptor-cleanup-policy');
  assert.equal(item.indexRelativePath, indexRelativePath);
  assert.equal(item.manifestRelativePath, manifestRelativePath);
  assert.equal(item.generatedOutputTargetRelativePath, targetRelativePath);
  assert.equal(item.sourceIndexGuardFamily, 'site-capability-graph-docs-markdown-retained-output-index-guard');
  assert.equal(item.sourceManifestGuardFamily, 'site-capability-graph-docs-markdown-generated-output-manifest-guard');
  assert.equal(item.sourceOutputFamily, 'site-capability-graph-docs-markdown-repo-output-dry-run');
  assert.equal(item.sourceGateFamily, 'site-capability-graph-repo-output-approval-gate-design');
  for (const fieldName of [
    'cleanupWriteEnabled',
    'deleteEnabled',
    'indexWriteEnabled',
    'repoWriteEnabled',
    'runtimeCleanupEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
  ]) {
    assert.equal(item[fieldName], false);
  }
  assert.equal(item.explicitValidationRequired, true);
  assert.equal(item.redactionRequiredBeforeCleanup, true);
  assert.equal(item.cleanupRequiresApproval, true);
  assert.equal(item.requiredIndexGuard, 'createGraphDocsMarkdownRetainedOutputIndexGuard');
  assert.equal(
    item.requiredArtifactGuard,
    'SecurityGuard/Redaction before graph-derived artifact cleanup',
  );
  assert.equal('cleanupPath' in item, false);
  assert.equal('cleanupPolicy' in item, false);
  assert.equal('deletePath' in item, false);
  assert.equal('retainedOutputIndex' in item, false);
  assert.equal('artifactPath' in item, false);
  assert.equal('sessionView' in item, false);
  assert.equal('downloadPolicy' in item, false);
  assert.equal('publishPayload' in item, false);
  assert.match(
    item.sourceIndexGuard.items[0].sourceManifestGuard.items[0].sourceApprovalGate.items[0].sourceRepoOutput.items[0].docsArtifact.items[0].markdown,
    /failure:graph-schema-invalid/u,
  );

  for (const fieldName of [
    'cleanupWriteEnabled',
    'deleteEnabled',
    'indexWriteEnabled',
    'repoWriteEnabled',
    'runtimeCleanupEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsMarkdownCleanupPolicyGuard(indexGuard, {
        [fieldName]: true,
      })
    ));
    assert.match(message, new RegExp(`${fieldName} must remain false`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  for (const [fieldName, value] of [
    ['cleanupPolicy', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
    ['cleanupPath', indexRelativePath],
    ['deletePath', indexRelativePath],
    ['retainedOutputIndex', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
    ['sessionView', {}],
    ['downloadPolicy', {}],
    ['publishPayload', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsMarkdownCleanupPolicyGuard(indexGuard, {
        [fieldName]: value,
      })
    ));
    assert.match(message, new RegExp(`descriptor-only.*${fieldName}`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  const unsafeCleanup = structuredClone(cleanupGuard);
  unsafeCleanup.items[0].deleteEnabled = true;
  const deleteMutationMessage = captureThrownMessage(() => (
    assertGraphDocsMarkdownCleanupPolicyGuardCompatibility(unsafeCleanup)
  ));
  assert.match(deleteMutationMessage, /deleteEnabled must be false/u);
  assert.doesNotMatch(deleteMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const unsafeSource = structuredClone(cleanupGuard);
  unsafeSource.items[0].sourceIndexGuard.items[0].sourceManifestGuard.items[0].sourceApprovalGate.items[0].sourceRepoOutput.items[0].docsArtifact.redactionRequired = false;
  const sourceMutationMessage = captureThrownMessage(() => (
    assertGraphDocsMarkdownCleanupPolicyGuardCompatibility(unsafeSource)
  ));
  assert.match(sourceMutationMessage, /redactionRequired must be true/u);
  assert.doesNotMatch(sourceMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const wrongSourceMessage = captureThrownMessage(() => (
    createGraphDocsMarkdownCleanupPolicyGuard(manifestGuard)
  ));
  assert.match(
    wrongSourceMessage,
    /GraphDocsMarkdownRetainedOutputIndexGuard|sourceIndexGuard/u,
  );
  assert.doesNotMatch(wrongSourceMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
  await assert.rejects(() => access(manifestUrl), /ENOENT/u);
  await assert.rejects(() => access(indexUrl), /ENOENT/u);
});

test('docs markdown failureModeSummary retention-cleanup handoff stays descriptor-only', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const targetRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.md';
  const manifestRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.manifest.json';
  const indexRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.retained-index.json';
  const targetUrl = new URL(`../../${targetRelativePath}`, import.meta.url);
  const manifestUrl = new URL(`../../${manifestRelativePath}`, import.meta.url);
  const indexUrl = new URL(`../../${indexRelativePath}`, import.meta.url);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
  await assert.rejects(() => access(manifestUrl), /ENOENT/u);
  await assert.rejects(() => access(indexUrl), /ENOENT/u);

  const dryRun = createGraphDocsMarkdownRepoOutputDryRun(artifact, { targetRelativePath });
  const gate = createGraphRepoOutputApprovalGateDesign(dryRun);
  const manifestGuard = createGraphDocsMarkdownGeneratedOutputManifestGuard(gate, {
    manifestRelativePath,
  });
  const indexGuard = createGraphDocsMarkdownRetainedOutputIndexGuard(manifestGuard, {
    indexRelativePath,
  });
  const cleanupGuard = createGraphDocsMarkdownCleanupPolicyGuard(indexGuard);
  const handoff = createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff(cleanupGuard);
  const item = handoff.items[0];

  assert.equal(assertGraphDocsMarkdownCleanupPolicyGuardCompatibility(cleanupGuard), true);
  assert.equal(assertGraphDocsMarkdownRetentionCleanupCompatibilityHandoff(handoff), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(handoff), true);
  assert.equal(handoff.queryName, 'createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff');
  assert.equal(
    handoff.artifactFamily,
    'site-capability-graph-docs-markdown-retention-cleanup-compatibility-handoff',
  );
  assert.equal(handoff.redactionRequired, true);
  assert.equal(item.handoffMode, 'descriptor-only');
  assert.equal(item.compatibilityKind, 'retention-cleanup-compatibility-handoff');
  assert.equal(item.indexRelativePath, indexRelativePath);
  assert.equal(item.manifestRelativePath, manifestRelativePath);
  assert.equal(item.generatedOutputTargetRelativePath, targetRelativePath);
  assert.equal(item.sourceCleanupPolicyFamily, 'site-capability-graph-docs-markdown-cleanup-policy-guard');
  assert.equal(item.sourceIndexGuardFamily, 'site-capability-graph-docs-markdown-retained-output-index-guard');
  assert.equal(item.sourceManifestGuardFamily, 'site-capability-graph-docs-markdown-generated-output-manifest-guard');
  assert.equal(item.sourceOutputFamily, 'site-capability-graph-docs-markdown-repo-output-dry-run');
  assert.equal(item.sourceGateFamily, 'site-capability-graph-repo-output-approval-gate-design');
  for (const fieldName of [
    'handoffEnabled',
    'runtimeHandoffEnabled',
    'cleanupExecutionEnabled',
    'deleteEnabled',
    'retentionDecisionWriteEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
  ]) {
    assert.equal(item[fieldName], false);
  }
  assert.equal(item.explicitValidationRequired, true);
  assert.equal(item.redactionRequiredBeforeHandoff, true);
  assert.equal(item.cleanupRequiresApproval, true);
  assert.equal(item.retainedIndexRequired, true);
  assert.equal(item.requiredCleanupPolicyGuard, 'createGraphDocsMarkdownCleanupPolicyGuard');
  assert.equal(item.requiredLayerConsumer, 'disabled until explicit Layer retention/cleanup consumer exists');
  assert.equal(
    item.requiredArtifactGuard,
    'SecurityGuard/Redaction before graph-derived retention cleanup handoff',
  );
  assert.equal('handoffPayload' in item, false);
  assert.equal('cleanupPolicy' in item, false);
  assert.equal('retentionPolicy' in item, false);
  assert.equal('cleanupExecution' in item, false);
  assert.equal('deletePlan' in item, false);
  assert.equal('sessionView' in item, false);
  assert.equal('downloadPolicy' in item, false);
  assert.equal('publishPayload' in item, false);
  assert.match(
    item.sourceCleanupPolicyGuard.items[0].sourceIndexGuard.items[0].sourceManifestGuard.items[0].sourceApprovalGate.items[0].sourceRepoOutput.items[0].docsArtifact.items[0].markdown,
    /failure:graph-schema-invalid/u,
  );

  for (const fieldName of [
    'handoffEnabled',
    'runtimeHandoffEnabled',
    'cleanupExecutionEnabled',
    'deleteEnabled',
    'retentionDecisionWriteEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff(cleanupGuard, {
        [fieldName]: true,
      })
    ));
    assert.match(message, new RegExp(`${fieldName} must remain false`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  for (const [fieldName, value] of [
    ['handoffPayload', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
    ['cleanupPolicy', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
    ['retentionPolicy', { maxAgeDays: 7 }],
    ['cleanupExecution', {}],
    ['deletePlan', { path: indexRelativePath }],
    ['sessionView', {}],
    ['downloadPolicy', {}],
    ['publishPayload', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff(cleanupGuard, {
        [fieldName]: value,
      })
    ));
    assert.match(message, new RegExp(`descriptor-only.*${fieldName}`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  const unsafeHandoff = structuredClone(handoff);
  unsafeHandoff.items[0].runtimeHandoffEnabled = true;
  const runtimeMutationMessage = captureThrownMessage(() => (
    assertGraphDocsMarkdownRetentionCleanupCompatibilityHandoff(unsafeHandoff)
  ));
  assert.match(runtimeMutationMessage, /runtimeHandoffEnabled must be false/u);
  assert.doesNotMatch(runtimeMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const unsafeSource = structuredClone(handoff);
  unsafeSource.items[0].sourceCleanupPolicyGuard.items[0].sourceIndexGuard.items[0].sourceManifestGuard.items[0].sourceApprovalGate.items[0].sourceRepoOutput.items[0].docsArtifact.redactionRequired = false;
  const sourceMutationMessage = captureThrownMessage(() => (
    assertGraphDocsMarkdownRetentionCleanupCompatibilityHandoff(unsafeSource)
  ));
  assert.match(sourceMutationMessage, /redactionRequired must be true/u);
  assert.doesNotMatch(sourceMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const wrongSourceMessage = captureThrownMessage(() => (
    createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff(indexGuard)
  ));
  assert.match(
    wrongSourceMessage,
    /GraphDocsMarkdownCleanupPolicyGuard|sourceCleanupPolicyGuard/u,
  );
  assert.doesNotMatch(wrongSourceMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
  await assert.rejects(() => access(manifestUrl), /ENOENT/u);
  await assert.rejects(() => access(indexUrl), /ENOENT/u);
});

test('docs markdown failureModeSummary final docs-output boundary summary stays descriptor-only', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const targetRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.md';
  const manifestRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.manifest.json';
  const indexRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.retained-index.json';
  const targetUrl = new URL(`../../${targetRelativePath}`, import.meta.url);
  const manifestUrl = new URL(`../../${manifestRelativePath}`, import.meta.url);
  const indexUrl = new URL(`../../${indexRelativePath}`, import.meta.url);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
  await assert.rejects(() => access(manifestUrl), /ENOENT/u);
  await assert.rejects(() => access(indexUrl), /ENOENT/u);

  const dryRun = createGraphDocsMarkdownRepoOutputDryRun(artifact, { targetRelativePath });
  const gate = createGraphRepoOutputApprovalGateDesign(dryRun);
  const manifestGuard = createGraphDocsMarkdownGeneratedOutputManifestGuard(gate, {
    manifestRelativePath,
  });
  const indexGuard = createGraphDocsMarkdownRetainedOutputIndexGuard(manifestGuard, {
    indexRelativePath,
  });
  const cleanupGuard = createGraphDocsMarkdownCleanupPolicyGuard(indexGuard);
  const handoff = createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff(cleanupGuard);
  const finalSummary = createGraphDocsMarkdownFinalOutputBoundarySummary(handoff);
  const item = finalSummary.items[0];

  assert.equal(assertGraphDocsMarkdownRetentionCleanupCompatibilityHandoff(handoff), true);
  assert.equal(assertGraphDocsMarkdownFinalOutputBoundarySummaryCompatibility(finalSummary), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(finalSummary), true);
  assert.equal(finalSummary.queryName, 'createGraphDocsMarkdownFinalOutputBoundarySummary');
  assert.equal(
    finalSummary.artifactFamily,
    'site-capability-graph-docs-markdown-final-output-boundary-summary',
  );
  assert.equal(finalSummary.redactionRequired, true);
  assert.equal(item.summaryMode, 'descriptor-only');
  assert.equal(item.summaryKind, 'final-docs-output-boundary-summary');
  assert.equal(item.sourceHandoffFamily, 'site-capability-graph-docs-markdown-retention-cleanup-compatibility-handoff');
  assert.equal(item.sourceCleanupPolicyFamily, 'site-capability-graph-docs-markdown-cleanup-policy-guard');
  assert.equal(item.sourceIndexGuardFamily, 'site-capability-graph-docs-markdown-retained-output-index-guard');
  assert.equal(item.sourceManifestGuardFamily, 'site-capability-graph-docs-markdown-generated-output-manifest-guard');
  assert.equal(item.sourceOutputFamily, 'site-capability-graph-docs-markdown-repo-output-dry-run');
  assert.equal(item.sourceGateFamily, 'site-capability-graph-repo-output-approval-gate-design');
  for (const fieldName of [
    'finalizationEnabled',
    'runtimeOutputEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
    'publishEnabled',
  ]) {
    assert.equal(item[fieldName], false);
  }
  assert.equal(item.redactionRequiredBeforeFinalOutput, true);
  assert.equal(item.layerConsumerRequired, true);
  assert.equal(item.requiredHandoff, 'createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff');
  assert.equal(item.requiredLayerConsumer, 'disabled until explicit Layer docs output consumer exists');
  assert.equal(
    item.requiredArtifactGuard,
    'SecurityGuard/Redaction before graph-derived final docs output',
  );
  assert.equal('finalOutput' in item, false);
  assert.equal('docsOutputPath' in item, false);
  assert.equal('runtimeOutput' in item, false);
  assert.equal('artifactPath' in item, false);
  assert.equal('sessionView' in item, false);
  assert.equal('downloadPolicy' in item, false);
  assert.equal('publishPayload' in item, false);

  for (const fieldName of [
    'finalizationEnabled',
    'runtimeOutputEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
    'publishEnabled',
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsMarkdownFinalOutputBoundarySummary(handoff, {
        [fieldName]: true,
      })
    ));
    assert.match(message, new RegExp(`${fieldName} must remain false`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  for (const [fieldName, value] of [
    ['finalOutput', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
    ['docsOutputPath', targetRelativePath],
    ['runtimeOutput', {}],
    ['handoffPayload', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
    ['sessionView', {}],
    ['downloadPolicy', {}],
    ['publishPayload', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsMarkdownFinalOutputBoundarySummary(handoff, {
        [fieldName]: value,
      })
    ));
    assert.match(message, new RegExp(`descriptor-only.*${fieldName}`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  const unsafeSummary = structuredClone(finalSummary);
  unsafeSummary.items[0].runtimeOutputEnabled = true;
  const runtimeMutationMessage = captureThrownMessage(() => (
    assertGraphDocsMarkdownFinalOutputBoundarySummaryCompatibility(unsafeSummary)
  ));
  assert.match(runtimeMutationMessage, /runtimeOutputEnabled must be false/u);
  assert.doesNotMatch(runtimeMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const unsafeSource = structuredClone(finalSummary);
  unsafeSource.items[0].sourceHandoff.items[0].sourceCleanupPolicyGuard.items[0].sourceIndexGuard.items[0].sourceManifestGuard.items[0].sourceApprovalGate.items[0].sourceRepoOutput.items[0].docsArtifact.redactionRequired = false;
  const sourceMutationMessage = captureThrownMessage(() => (
    assertGraphDocsMarkdownFinalOutputBoundarySummaryCompatibility(unsafeSource)
  ));
  assert.match(sourceMutationMessage, /redactionRequired must be true/u);
  assert.doesNotMatch(sourceMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const wrongSourceMessage = captureThrownMessage(() => (
    createGraphDocsMarkdownFinalOutputBoundarySummary(cleanupGuard)
  ));
  assert.match(
    wrongSourceMessage,
    /GraphDocsMarkdownRetentionCleanupCompatibilityHandoff|sourceHandoff/u,
  );
  assert.doesNotMatch(wrongSourceMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
  await assert.rejects(() => access(manifestUrl), /ENOENT/u);
  await assert.rejects(() => access(indexUrl), /ENOENT/u);
});

test('GraphDocsSummary docs-output completion checklist stays descriptor-only', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const targetRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.md';
  const manifestRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.manifest.json';
  const indexRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.retained-index.json';
  const targetUrl = new URL(`../../${targetRelativePath}`, import.meta.url);
  const manifestUrl = new URL(`../../${manifestRelativePath}`, import.meta.url);
  const indexUrl = new URL(`../../${indexRelativePath}`, import.meta.url);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
  await assert.rejects(() => access(manifestUrl), /ENOENT/u);
  await assert.rejects(() => access(indexUrl), /ENOENT/u);

  const dryRun = createGraphDocsMarkdownRepoOutputDryRun(artifact, { targetRelativePath });
  const gate = createGraphRepoOutputApprovalGateDesign(dryRun);
  const manifestGuard = createGraphDocsMarkdownGeneratedOutputManifestGuard(gate, {
    manifestRelativePath,
  });
  const indexGuard = createGraphDocsMarkdownRetainedOutputIndexGuard(manifestGuard, {
    indexRelativePath,
  });
  const cleanupGuard = createGraphDocsMarkdownCleanupPolicyGuard(indexGuard);
  const handoff = createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff(cleanupGuard);
  const finalSummary = createGraphDocsMarkdownFinalOutputBoundarySummary(handoff);
  const checklist = createGraphDocsOutputCompletionChecklist(finalSummary);
  const item = checklist.items[0];

  assert.equal(assertGraphDocsMarkdownFinalOutputBoundarySummaryCompatibility(finalSummary), true);
  assert.equal(assertGraphDocsOutputCompletionChecklistCompatibility(checklist), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(checklist), true);
  assert.equal(checklist.queryName, 'createGraphDocsOutputCompletionChecklist');
  assert.equal(checklist.artifactFamily, 'site-capability-graph-docs-output-completion-checklist');
  assert.equal(checklist.redactionRequired, true);
  assert.equal(item.checklistMode, 'descriptor-only');
  assert.equal(item.checklistKind, 'docs-output-completion-checklist');
  assert.equal(item.sourceBoundarySummaryFamily, 'site-capability-graph-docs-markdown-final-output-boundary-summary');
  assert.equal(item.sourceHandoffFamily, 'site-capability-graph-docs-markdown-retention-cleanup-compatibility-handoff');
  assert.equal(item.sourceCleanupPolicyFamily, 'site-capability-graph-docs-markdown-cleanup-policy-guard');
  assert.equal(item.sourceIndexGuardFamily, 'site-capability-graph-docs-markdown-retained-output-index-guard');
  assert.equal(item.sourceManifestGuardFamily, 'site-capability-graph-docs-markdown-generated-output-manifest-guard');
  assert.equal(item.sourceOutputFamily, 'site-capability-graph-docs-markdown-repo-output-dry-run');
  assert.equal(item.sourceGateFamily, 'site-capability-graph-repo-output-approval-gate-design');
  for (const fieldName of [
    'completionEnabled',
    'runtimeChecklistEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
    'publishEnabled',
  ]) {
    assert.equal(item[fieldName], false);
  }
  assert.equal(item.redactionRequiredBeforeCompletion, true);
  assert.equal(item.layerConsumerRequired, true);
  assert.equal(item.requiredBoundarySummary, 'createGraphDocsMarkdownFinalOutputBoundarySummary');
  assert.equal(item.requiredLayerConsumer, 'disabled until explicit Layer docs output completion consumer exists');
  assert.equal(
    item.requiredArtifactGuard,
    'SecurityGuard/Redaction before graph-derived docs completion output',
  );
  assert.deepEqual(item.requiredEvidence, [
    'docs-generator-passed',
    'docs-matrix-cross-check-passed',
    'matrix-updated-with-verification',
    'descriptor-only-boundary-preserved',
    'redaction-required-before-output',
    'B-review-accepted',
  ]);
  assert.equal('checklistOutput' in item, false);
  assert.equal('completionResult' in item, false);
  assert.equal('docsOutputPath' in item, false);
  assert.equal('runtimeChecklist' in item, false);
  assert.equal('sessionView' in item, false);
  assert.equal('downloadPolicy' in item, false);
  assert.equal('publishPayload' in item, false);

  for (const fieldName of [
    'completionEnabled',
    'runtimeChecklistEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
    'publishEnabled',
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsOutputCompletionChecklist(finalSummary, {
        [fieldName]: true,
      })
    ));
    assert.match(message, new RegExp(`${fieldName} must remain false`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  for (const [fieldName, value] of [
    ['checklistOutput', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
    ['completionResult', {}],
    ['docsOutputPath', targetRelativePath],
    ['runtimeChecklist', {}],
    ['sessionView', {}],
    ['downloadPolicy', {}],
    ['publishPayload', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsOutputCompletionChecklist(finalSummary, {
        [fieldName]: value,
      })
    ));
    assert.match(message, new RegExp(`descriptor-only.*${fieldName}`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  const unsafeChecklist = structuredClone(checklist);
  unsafeChecklist.items[0].completionEnabled = true;
  const completionMutationMessage = captureThrownMessage(() => (
    assertGraphDocsOutputCompletionChecklistCompatibility(unsafeChecklist)
  ));
  assert.match(completionMutationMessage, /completionEnabled must be false/u);
  assert.doesNotMatch(completionMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const missingEvidenceChecklist = structuredClone(checklist);
  missingEvidenceChecklist.items[0].requiredEvidence = item.requiredEvidence.filter(
    (evidence) => evidence !== 'redaction-required-before-output',
  );
  const missingEvidenceMessage = captureThrownMessage(() => (
    assertGraphDocsOutputCompletionChecklistCompatibility(missingEvidenceChecklist)
  ));
  assert.match(
    missingEvidenceMessage,
    /requiredEvidence must include redaction-required-before-output/u,
  );
  assert.doesNotMatch(missingEvidenceMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const replacedEvidenceChecklist = structuredClone(checklist);
  replacedEvidenceChecklist.items[0].requiredEvidence = item.requiredEvidence.map((evidence) => (
    evidence === 'B-review-accepted' ? 'synthetic-secret-value' : evidence
  ));
  const replacedEvidenceMessage = captureThrownMessage(() => (
    assertGraphDocsOutputCompletionChecklistCompatibility(replacedEvidenceChecklist)
  ));
  assert.doesNotMatch(replacedEvidenceMessage, /synthetic-secret-value/u);

  const unsafeSource = structuredClone(checklist);
  unsafeSource.items[0].sourceBoundarySummary.items[0].sourceHandoff.items[0].sourceCleanupPolicyGuard.items[0].sourceIndexGuard.items[0].sourceManifestGuard.items[0].sourceApprovalGate.items[0].sourceRepoOutput.items[0].docsArtifact.redactionRequired = false;
  const sourceMutationMessage = captureThrownMessage(() => (
    assertGraphDocsOutputCompletionChecklistCompatibility(unsafeSource)
  ));
  assert.match(sourceMutationMessage, /redactionRequired must be true/u);
  assert.doesNotMatch(sourceMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const wrongSourceMessage = captureThrownMessage(() => (
    createGraphDocsOutputCompletionChecklist(handoff)
  ));
  assert.match(
    wrongSourceMessage,
    /GraphDocsMarkdownFinalOutputBoundarySummary|sourceBoundarySummary/u,
  );
  assert.doesNotMatch(wrongSourceMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
  await assert.rejects(() => access(manifestUrl), /ENOENT/u);
  await assert.rejects(() => access(indexUrl), /ENOENT/u);
});

test('GraphDocsSummary docs-output completion final matrix handoff stays descriptor-only', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const targetRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.md';
  const manifestRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.manifest.json';
  const indexRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.retained-index.json';
  const targetUrl = new URL(`../../${targetRelativePath}`, import.meta.url);
  const manifestUrl = new URL(`../../${manifestRelativePath}`, import.meta.url);
  const indexUrl = new URL(`../../${indexRelativePath}`, import.meta.url);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
  await assert.rejects(() => access(manifestUrl), /ENOENT/u);
  await assert.rejects(() => access(indexUrl), /ENOENT/u);

  const dryRun = createGraphDocsMarkdownRepoOutputDryRun(artifact, { targetRelativePath });
  const gate = createGraphRepoOutputApprovalGateDesign(dryRun);
  const manifestGuard = createGraphDocsMarkdownGeneratedOutputManifestGuard(gate, {
    manifestRelativePath,
  });
  const indexGuard = createGraphDocsMarkdownRetainedOutputIndexGuard(manifestGuard, {
    indexRelativePath,
  });
  const cleanupGuard = createGraphDocsMarkdownCleanupPolicyGuard(indexGuard);
  const handoff = createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff(cleanupGuard);
  const finalSummary = createGraphDocsMarkdownFinalOutputBoundarySummary(handoff);
  const checklist = createGraphDocsOutputCompletionChecklist(finalSummary);
  const matrixHandoff = createGraphDocsOutputFinalMatrixHandoff(checklist);
  const item = matrixHandoff.items[0];

  assert.equal(assertGraphDocsOutputCompletionChecklistCompatibility(checklist), true);
  assert.equal(assertGraphDocsOutputFinalMatrixHandoffCompatibility(matrixHandoff), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(matrixHandoff), true);
  assert.equal(matrixHandoff.queryName, 'createGraphDocsOutputFinalMatrixHandoff');
  assert.equal(matrixHandoff.artifactFamily, 'site-capability-graph-docs-output-final-matrix-handoff');
  assert.equal(matrixHandoff.redactionRequired, true);
  assert.equal(item.handoffMode, 'descriptor-only');
  assert.equal(item.handoffKind, 'docs-output-completion-final-matrix-handoff');
  assert.equal(item.sourceChecklistFamily, 'site-capability-graph-docs-output-completion-checklist');
  assert.equal(item.sourceBoundarySummaryFamily, 'site-capability-graph-docs-markdown-final-output-boundary-summary');
  assert.equal(item.sourceHandoffFamily, 'site-capability-graph-docs-markdown-retention-cleanup-compatibility-handoff');
  assert.equal(item.sourceCleanupPolicyFamily, 'site-capability-graph-docs-markdown-cleanup-policy-guard');
  assert.equal(item.sourceIndexGuardFamily, 'site-capability-graph-docs-markdown-retained-output-index-guard');
  assert.equal(item.sourceManifestGuardFamily, 'site-capability-graph-docs-markdown-generated-output-manifest-guard');
  assert.equal(item.sourceOutputFamily, 'site-capability-graph-docs-markdown-repo-output-dry-run');
  assert.equal(item.sourceGateFamily, 'site-capability-graph-repo-output-approval-gate-design');
  for (const fieldName of [
    'handoffEnabled',
    'runtimeMatrixUpdateEnabled',
    'matrixWriteEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
    'publishEnabled',
  ]) {
    assert.equal(item[fieldName], false);
  }
  assert.equal(item.redactionRequiredBeforeMatrixUpdate, true);
  assert.equal(item.layerConsumerRequired, true);
  assert.equal(item.BReviewRequired, true);
  assert.equal(item.requiredChecklist, 'createGraphDocsOutputCompletionChecklist');
  assert.equal(
    item.requiredLayerConsumer,
    'disabled until explicit Layer docs output matrix handoff consumer exists',
  );
  assert.equal(
    item.requiredArtifactGuard,
    'SecurityGuard/Redaction before graph-derived docs matrix handoff output',
  );
  assert.equal(
    item.requiredMatrixLedger,
    'IMPLEMENTATION_MATRIX.md updated by Agent A and reviewed by Agent B',
  );
  assert.equal('finalMatrixHandoff' in item, false);
  assert.equal('handoffResult' in item, false);
  assert.equal('matrixPatch' in item, false);
  assert.equal('matrixWrite' in item, false);
  assert.equal('matrixStatusUpdate' in item, false);
  assert.equal('statusPromotion' in item, false);
  assert.equal('verifiedPromotion' in item, false);
  assert.equal('sessionView' in item, false);
  assert.equal('downloadPolicy' in item, false);
  assert.equal('publishPayload' in item, false);

  for (const fieldName of [
    'handoffEnabled',
    'runtimeMatrixUpdateEnabled',
    'matrixWriteEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
    'publishEnabled',
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsOutputFinalMatrixHandoff(checklist, {
        [fieldName]: true,
      })
    ));
    assert.match(message, new RegExp(`${fieldName} must remain false`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  for (const [fieldName, value] of [
    ['finalMatrixHandoff', {}],
    ['handoffResult', {}],
    ['matrixPatch', { status: 'verified' }],
    ['matrixOutputPath', targetRelativePath],
    ['matrixWrite', {}],
    ['matrixStatusUpdate', { status: 'verified' }],
    ['statusPromotion', { section: 20 }],
    ['verifiedPromotion', { section: 20 }],
    ['sessionView', {}],
    ['downloadPolicy', {}],
    ['publishPayload', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsOutputFinalMatrixHandoff(checklist, {
        [fieldName]: value,
      })
    ));
    assert.match(message, new RegExp(`descriptor-only.*${fieldName}`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  const unsafeHandoff = structuredClone(matrixHandoff);
  unsafeHandoff.items[0].matrixWriteEnabled = true;
  const matrixWriteMutationMessage = captureThrownMessage(() => (
    assertGraphDocsOutputFinalMatrixHandoffCompatibility(unsafeHandoff)
  ));
  assert.match(matrixWriteMutationMessage, /matrixWriteEnabled must be false/u);
  assert.doesNotMatch(matrixWriteMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const unsafeSource = structuredClone(matrixHandoff);
  unsafeSource.items[0].sourceChecklist.items[0].sourceBoundarySummary.items[0].sourceHandoff.items[0].sourceCleanupPolicyGuard.items[0].sourceIndexGuard.items[0].sourceManifestGuard.items[0].sourceApprovalGate.items[0].sourceRepoOutput.items[0].docsArtifact.redactionRequired = false;
  const sourceMutationMessage = captureThrownMessage(() => (
    assertGraphDocsOutputFinalMatrixHandoffCompatibility(unsafeSource)
  ));
  assert.match(sourceMutationMessage, /redactionRequired must be true/u);
  assert.doesNotMatch(sourceMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const wrongSourceMessage = captureThrownMessage(() => (
    createGraphDocsOutputFinalMatrixHandoff(finalSummary)
  ));
  assert.match(
    wrongSourceMessage,
    /GraphDocsOutputCompletionChecklist|sourceChecklist/u,
  );
  assert.doesNotMatch(wrongSourceMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
  await assert.rejects(() => access(manifestUrl), /ENOENT/u);
  await assert.rejects(() => access(indexUrl), /ENOENT/u);
});

test('GraphDocsSummary docs-output completion final acceptance descriptor stays descriptor-only', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const targetRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.md';
  const manifestRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.manifest.json';
  const indexRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.retained-index.json';
  const targetUrl = new URL(`../../${targetRelativePath}`, import.meta.url);
  const manifestUrl = new URL(`../../${manifestRelativePath}`, import.meta.url);
  const indexUrl = new URL(`../../${indexRelativePath}`, import.meta.url);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
  await assert.rejects(() => access(manifestUrl), /ENOENT/u);
  await assert.rejects(() => access(indexUrl), /ENOENT/u);

  const dryRun = createGraphDocsMarkdownRepoOutputDryRun(artifact, { targetRelativePath });
  const gate = createGraphRepoOutputApprovalGateDesign(dryRun);
  const manifestGuard = createGraphDocsMarkdownGeneratedOutputManifestGuard(gate, {
    manifestRelativePath,
  });
  const indexGuard = createGraphDocsMarkdownRetainedOutputIndexGuard(manifestGuard, {
    indexRelativePath,
  });
  const cleanupGuard = createGraphDocsMarkdownCleanupPolicyGuard(indexGuard);
  const handoff = createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff(cleanupGuard);
  const finalSummary = createGraphDocsMarkdownFinalOutputBoundarySummary(handoff);
  const checklist = createGraphDocsOutputCompletionChecklist(finalSummary);
  const matrixHandoff = createGraphDocsOutputFinalMatrixHandoff(checklist);
  const acceptance = createGraphDocsOutputFinalAcceptanceDescriptor(matrixHandoff);
  const item = acceptance.items[0];

  assert.equal(assertGraphDocsOutputFinalMatrixHandoffCompatibility(matrixHandoff), true);
  assert.equal(assertGraphDocsOutputFinalAcceptanceDescriptorCompatibility(acceptance), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(acceptance), true);
  assert.equal(acceptance.queryName, 'createGraphDocsOutputFinalAcceptanceDescriptor');
  assert.equal(acceptance.artifactFamily, 'site-capability-graph-docs-output-final-acceptance-descriptor');
  assert.equal(acceptance.redactionRequired, true);
  assert.equal(item.acceptanceMode, 'descriptor-only');
  assert.equal(item.acceptanceKind, 'docs-output-final-acceptance-descriptor');
  assert.equal(item.sourceMatrixHandoffFamily, 'site-capability-graph-docs-output-final-matrix-handoff');
  assert.equal(item.sourceChecklistFamily, 'site-capability-graph-docs-output-completion-checklist');
  assert.equal(item.sourceBoundarySummaryFamily, 'site-capability-graph-docs-markdown-final-output-boundary-summary');
  for (const fieldName of [
    'acceptanceEnabled',
    'runtimeAcceptanceEnabled',
    'matrixWriteEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
    'publishEnabled',
  ]) {
    assert.equal(item[fieldName], false);
  }
  assert.equal(item.redactionRequiredBeforeAcceptance, true);
  assert.equal(item.layerConsumerRequired, true);
  assert.equal(item.finalBReviewRequired, true);
  assert.equal(item.matrixVerifiedPromotionAllowed, false);
  assert.equal(item.requiredMatrixHandoff, 'createGraphDocsOutputFinalMatrixHandoff');
  assert.equal(
    item.requiredArtifactGuard,
    'SecurityGuard/Redaction before graph-derived docs final acceptance output',
  );
  assert.equal(
    item.requiredFinalReview,
    'Agent B final acceptance remains external to Graph descriptor generation',
  );
  assert.equal('finalAcceptance' in item, false);
  assert.equal('acceptanceResult' in item, false);
  assert.equal('finalAcceptancePayload' in item, false);
  assert.equal('matrixWrite' in item, false);
  assert.equal('statusPromotion' in item, false);
  assert.equal('verifiedPromotion' in item, false);
  assert.equal('sessionView' in item, false);
  assert.equal('downloadPolicy' in item, false);
  assert.equal('publishPayload' in item, false);

  for (const fieldName of [
    'acceptanceEnabled',
    'runtimeAcceptanceEnabled',
    'matrixWriteEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
    'publishEnabled',
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsOutputFinalAcceptanceDescriptor(matrixHandoff, {
        [fieldName]: true,
      })
    ));
    assert.match(message, new RegExp(`${fieldName} must remain false`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  for (const [fieldName, value] of [
    ['finalAcceptance', {}],
    ['acceptanceResult', {}],
    ['finalAcceptancePayload', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
    ['matrixWrite', {}],
    ['statusPromotion', { status: 'verified' }],
    ['verifiedPromotion', { section: 20 }],
    ['sessionView', {}],
    ['downloadPolicy', {}],
    ['publishPayload', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsOutputFinalAcceptanceDescriptor(matrixHandoff, {
        [fieldName]: value,
      })
    ));
    assert.match(message, new RegExp(`descriptor-only.*${fieldName}`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  const unsafeAcceptance = structuredClone(acceptance);
  unsafeAcceptance.items[0].matrixVerifiedPromotionAllowed = true;
  const promotionMutationMessage = captureThrownMessage(() => (
    assertGraphDocsOutputFinalAcceptanceDescriptorCompatibility(unsafeAcceptance)
  ));
  assert.match(promotionMutationMessage, /matrixVerifiedPromotionAllowed must be false/u);
  assert.doesNotMatch(promotionMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const unsafeSource = structuredClone(acceptance);
  unsafeSource.items[0].sourceMatrixHandoff.items[0].sourceChecklist.items[0].sourceBoundarySummary.items[0].sourceHandoff.items[0].sourceCleanupPolicyGuard.items[0].sourceIndexGuard.items[0].sourceManifestGuard.items[0].sourceApprovalGate.items[0].sourceRepoOutput.items[0].docsArtifact.redactionRequired = false;
  const sourceMutationMessage = captureThrownMessage(() => (
    assertGraphDocsOutputFinalAcceptanceDescriptorCompatibility(unsafeSource)
  ));
  assert.match(sourceMutationMessage, /redactionRequired must be true/u);
  assert.doesNotMatch(sourceMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const wrongSourceMessage = captureThrownMessage(() => (
    createGraphDocsOutputFinalAcceptanceDescriptor(checklist)
  ));
  assert.match(
    wrongSourceMessage,
    /GraphDocsOutputFinalMatrixHandoff|sourceMatrixHandoff/u,
  );
  assert.doesNotMatch(wrongSourceMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
  await assert.rejects(() => access(manifestUrl), /ENOENT/u);
  await assert.rejects(() => access(indexUrl), /ENOENT/u);
});

test('GraphDocsSummary docs-output final acceptance report descriptor stays descriptor-only', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const targetRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.md';
  const manifestRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.manifest.json';
  const indexRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.retained-index.json';
  const targetUrl = new URL(`../../${targetRelativePath}`, import.meta.url);
  const manifestUrl = new URL(`../../${manifestRelativePath}`, import.meta.url);
  const indexUrl = new URL(`../../${indexRelativePath}`, import.meta.url);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
  await assert.rejects(() => access(manifestUrl), /ENOENT/u);
  await assert.rejects(() => access(indexUrl), /ENOENT/u);

  const dryRun = createGraphDocsMarkdownRepoOutputDryRun(artifact, { targetRelativePath });
  const gate = createGraphRepoOutputApprovalGateDesign(dryRun);
  const manifestGuard = createGraphDocsMarkdownGeneratedOutputManifestGuard(gate, {
    manifestRelativePath,
  });
  const indexGuard = createGraphDocsMarkdownRetainedOutputIndexGuard(manifestGuard, {
    indexRelativePath,
  });
  const cleanupGuard = createGraphDocsMarkdownCleanupPolicyGuard(indexGuard);
  const handoff = createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff(cleanupGuard);
  const finalSummary = createGraphDocsMarkdownFinalOutputBoundarySummary(handoff);
  const checklist = createGraphDocsOutputCompletionChecklist(finalSummary);
  const matrixHandoff = createGraphDocsOutputFinalMatrixHandoff(checklist);
  const acceptance = createGraphDocsOutputFinalAcceptanceDescriptor(matrixHandoff);
  const acceptanceReport = createGraphDocsOutputFinalAcceptanceReportDescriptor(acceptance);
  const item = acceptanceReport.items[0];

  assert.equal(assertGraphDocsOutputFinalAcceptanceDescriptorCompatibility(acceptance), true);
  assert.equal(
    assertGraphDocsOutputFinalAcceptanceReportDescriptorCompatibility(acceptanceReport),
    true,
  );
  assert.equal(assertGraphDerivedArtifactWriteAllowed(acceptanceReport), true);
  assert.equal(acceptanceReport.queryName, 'createGraphDocsOutputFinalAcceptanceReportDescriptor');
  assert.equal(
    acceptanceReport.artifactFamily,
    'site-capability-graph-docs-output-final-acceptance-report-descriptor',
  );
  assert.equal(acceptanceReport.redactionRequired, true);
  assert.equal(item.reportMode, 'descriptor-only');
  assert.equal(item.reportKind, 'docs-output-final-acceptance-report-descriptor');
  assert.equal(item.sourceAcceptanceDescriptorFamily, 'site-capability-graph-docs-output-final-acceptance-descriptor');
  assert.equal(item.sourceMatrixHandoffFamily, 'site-capability-graph-docs-output-final-matrix-handoff');
  assert.equal(item.sourceChecklistFamily, 'site-capability-graph-docs-output-completion-checklist');
  assert.equal(item.sourceBoundarySummaryFamily, 'site-capability-graph-docs-markdown-final-output-boundary-summary');
  for (const fieldName of [
    'reportEnabled',
    'runtimeReportEnabled',
    'matrixWriteEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
    'publishEnabled',
  ]) {
    assert.equal(item[fieldName], false);
  }
  assert.equal(item.redactionRequiredBeforeReport, true);
  assert.equal(item.layerConsumerRequired, true);
  assert.equal(item.finalBReviewRequired, true);
  assert.equal(item.publishAllowed, false);
  assert.equal(item.matrixVerifiedPromotionAllowed, false);
  assert.equal(item.requiredAcceptanceDescriptor, 'createGraphDocsOutputFinalAcceptanceDescriptor');
  assert.equal(
    item.requiredArtifactGuard,
    'SecurityGuard/Redaction before graph-derived docs final acceptance report output',
  );
  assert.equal(
    item.requiredFinalReview,
    'Agent B final acceptance report remains external to Graph descriptor generation',
  );
  assert.equal('finalAcceptanceReport' in item, false);
  assert.equal('reportOutput' in item, false);
  assert.equal('reportResult' in item, false);
  assert.equal('reportPayload' in item, false);
  assert.equal('publishPayload' in item, false);
  assert.equal('publishTarget' in item, false);
  assert.equal('docsOutputPath' in item, false);
  assert.equal('repoPath' in item, false);
  assert.equal('statusPromotion' in item, false);
  assert.equal('verifiedPromotion' in item, false);
  assert.equal('sessionView' in item, false);
  assert.equal('downloadPolicy' in item, false);

  for (const fieldName of [
    'reportEnabled',
    'runtimeReportEnabled',
    'matrixWriteEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
    'publishEnabled',
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsOutputFinalAcceptanceReportDescriptor(acceptance, {
        [fieldName]: true,
      })
    ));
    assert.match(message, new RegExp(`${fieldName} must remain false`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  for (const [fieldName, value] of [
    ['finalAcceptanceReport', {}],
    ['reportOutput', {}],
    ['reportResult', {}],
    ['reportPayload', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
    ['publishPayload', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
    ['publishTarget', 'runs/site-capability-graph/final-acceptance-report.md'],
    ['docsOutputPath', 'runs/site-capability-graph/final-acceptance-report.md'],
    ['repoPath', 'C:/Users/lyt-p/Desktop/Browser-Wiki-Skill'],
    ['statusPromotion', { status: 'verified' }],
    ['verifiedPromotion', { section: 20 }],
    ['sessionView', {}],
    ['downloadPolicy', {}],
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsOutputFinalAcceptanceReportDescriptor(acceptance, {
        [fieldName]: value,
      })
    ));
    assert.match(message, new RegExp(`descriptor-only.*${fieldName}`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  const unsafeReport = structuredClone(acceptanceReport);
  unsafeReport.items[0].publishAllowed = true;
  const publishMutationMessage = captureThrownMessage(() => (
    assertGraphDocsOutputFinalAcceptanceReportDescriptorCompatibility(unsafeReport)
  ));
  assert.match(publishMutationMessage, /publishAllowed must be false/u);
  assert.doesNotMatch(publishMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const unsafePromotion = structuredClone(acceptanceReport);
  unsafePromotion.items[0].matrixVerifiedPromotionAllowed = true;
  const promotionMutationMessage = captureThrownMessage(() => (
    assertGraphDocsOutputFinalAcceptanceReportDescriptorCompatibility(unsafePromotion)
  ));
  assert.match(promotionMutationMessage, /matrixVerifiedPromotionAllowed must be false/u);
  assert.doesNotMatch(promotionMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const unsafeSource = structuredClone(acceptanceReport);
  unsafeSource.items[0].sourceAcceptanceDescriptor.items[0].sourceMatrixHandoff.items[0].sourceChecklist.items[0].sourceBoundarySummary.items[0].sourceHandoff.items[0].sourceCleanupPolicyGuard.items[0].sourceIndexGuard.items[0].sourceManifestGuard.items[0].sourceApprovalGate.items[0].sourceRepoOutput.items[0].docsArtifact.redactionRequired = false;
  const sourceMutationMessage = captureThrownMessage(() => (
    assertGraphDocsOutputFinalAcceptanceReportDescriptorCompatibility(unsafeSource)
  ));
  assert.match(sourceMutationMessage, /redactionRequired must be true/u);
  assert.doesNotMatch(sourceMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const wrongSourceMessage = captureThrownMessage(() => (
    createGraphDocsOutputFinalAcceptanceReportDescriptor(matrixHandoff)
  ));
  assert.match(
    wrongSourceMessage,
    /GraphDocsOutputFinalAcceptanceDescriptor|sourceAcceptanceDescriptor/u,
  );
  assert.doesNotMatch(wrongSourceMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
  await assert.rejects(() => access(manifestUrl), /ENOENT/u);
  await assert.rejects(() => access(indexUrl), /ENOENT/u);
});

test('GraphDocsSummary docs-output final B-review checklist stays descriptor-only', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const targetRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.md';
  const manifestRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.manifest.json';
  const indexRelativePath = 'runs/site-capability-graph/generated-failuremode-summary-docs.retained-index.json';
  const targetUrl = new URL(`../../${targetRelativePath}`, import.meta.url);
  const manifestUrl = new URL(`../../${manifestRelativePath}`, import.meta.url);
  const indexUrl = new URL(`../../${indexRelativePath}`, import.meta.url);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
  await assert.rejects(() => access(manifestUrl), /ENOENT/u);
  await assert.rejects(() => access(indexUrl), /ENOENT/u);

  const dryRun = createGraphDocsMarkdownRepoOutputDryRun(artifact, { targetRelativePath });
  const gate = createGraphRepoOutputApprovalGateDesign(dryRun);
  const manifestGuard = createGraphDocsMarkdownGeneratedOutputManifestGuard(gate, {
    manifestRelativePath,
  });
  const indexGuard = createGraphDocsMarkdownRetainedOutputIndexGuard(manifestGuard, {
    indexRelativePath,
  });
  const cleanupGuard = createGraphDocsMarkdownCleanupPolicyGuard(indexGuard);
  const handoff = createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff(cleanupGuard);
  const finalSummary = createGraphDocsMarkdownFinalOutputBoundarySummary(handoff);
  const checklist = createGraphDocsOutputCompletionChecklist(finalSummary);
  const matrixHandoff = createGraphDocsOutputFinalMatrixHandoff(checklist);
  const acceptance = createGraphDocsOutputFinalAcceptanceDescriptor(matrixHandoff);
  const acceptanceReport = createGraphDocsOutputFinalAcceptanceReportDescriptor(acceptance);
  const bReviewChecklist = createGraphDocsOutputFinalBReviewChecklist(acceptanceReport);
  const item = bReviewChecklist.items[0];

  assert.equal(
    assertGraphDocsOutputFinalAcceptanceReportDescriptorCompatibility(acceptanceReport),
    true,
  );
  assert.equal(assertGraphDocsOutputFinalBReviewChecklistCompatibility(bReviewChecklist), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(bReviewChecklist), true);
  assert.equal(bReviewChecklist.queryName, 'createGraphDocsOutputFinalBReviewChecklist');
  assert.equal(
    bReviewChecklist.artifactFamily,
    'site-capability-graph-docs-output-final-b-review-checklist',
  );
  assert.equal(bReviewChecklist.redactionRequired, true);
  assert.equal(item.checklistMode, 'descriptor-only');
  assert.equal(item.checklistKind, 'docs-output-final-b-review-checklist');
  assert.equal(item.sourceAcceptanceReportDescriptorFamily, 'site-capability-graph-docs-output-final-acceptance-report-descriptor');
  assert.equal(item.sourceAcceptanceDescriptorFamily, 'site-capability-graph-docs-output-final-acceptance-descriptor');
  assert.equal(item.sourceMatrixHandoffFamily, 'site-capability-graph-docs-output-final-matrix-handoff');
  assert.equal(item.sourceChecklistFamily, 'site-capability-graph-docs-output-completion-checklist');
  assert.deepEqual(item.remainingNonVerifiedSections, Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(item.remainingNonVerifiedCount, 20);
  for (const fieldName of [
    'reviewEnabled',
    'runtimeReviewEnabled',
    'matrixWriteEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
    'publishEnabled',
  ]) {
    assert.equal(item[fieldName], false);
  }
  assert.equal(item.redactionRequiredBeforeReview, true);
  assert.equal(item.layerConsumerRequired, true);
  assert.equal(item.BReviewRequired, true);
  assert.equal(item.reviewResultMaterialized, false);
  assert.equal(item.matrixVerifiedPromotionAllowed, false);
  assert.equal(item.requiredAcceptanceReportDescriptor, 'createGraphDocsOutputFinalAcceptanceReportDescriptor');
  assert.equal(
    item.requiredArtifactGuard,
    'SecurityGuard/Redaction before graph-derived docs final B-review checklist output',
  );
  assert.equal(
    item.requiredManualReview,
    'Agent B review remains external to Graph descriptor generation',
  );
  assert.equal('finalBReviewChecklist' in item, false);
  assert.equal('reviewOutput' in item, false);
  assert.equal('reviewResult' in item, false);
  assert.equal('reviewPayload' in item, false);
  assert.equal('statusPromotion' in item, false);
  assert.equal('verifiedPromotion' in item, false);
  assert.equal('matrixWrite' in item, false);
  assert.equal('publishPayload' in item, false);
  assert.equal('sessionView' in item, false);
  assert.equal('downloadPolicy' in item, false);

  for (const fieldName of [
    'reviewEnabled',
    'runtimeReviewEnabled',
    'matrixWriteEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
    'publishEnabled',
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsOutputFinalBReviewChecklist(acceptanceReport, {
        [fieldName]: true,
      })
    ));
    assert.match(message, new RegExp(`${fieldName} must remain false`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  for (const [fieldName, value] of [
    ['finalBReviewChecklist', {}],
    ['reviewOutput', {}],
    ['reviewResult', {}],
    ['reviewPayload', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
    ['statusPromotion', { status: 'verified' }],
    ['verifiedPromotion', { section: 20 }],
    ['matrixWrite', {}],
    ['publishPayload', { authorization: 'Authorization: Bearer synthetic-secret-value' }],
    ['sessionView', {}],
    ['downloadPolicy', {}],
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsOutputFinalBReviewChecklist(acceptanceReport, {
        [fieldName]: value,
      })
    ));
    assert.match(message, new RegExp(`descriptor-only.*${fieldName}`, 'u'));
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  for (const remainingNonVerifiedSections of [
    [],
    [0],
    [21],
    [1, 1],
  ]) {
    const message = captureThrownMessage(() => (
      createGraphDocsOutputFinalBReviewChecklist(acceptanceReport, {
        remainingNonVerifiedSections,
      })
    ));
    assert.match(message, /remainingNonVerifiedSections/u);
    assert.doesNotMatch(message, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);
  }

  const unsafeReview = structuredClone(bReviewChecklist);
  unsafeReview.items[0].reviewResultMaterialized = true;
  const reviewMutationMessage = captureThrownMessage(() => (
    assertGraphDocsOutputFinalBReviewChecklistCompatibility(unsafeReview)
  ));
  assert.match(reviewMutationMessage, /reviewResultMaterialized must be false/u);
  assert.doesNotMatch(reviewMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const unsafePromotion = structuredClone(bReviewChecklist);
  unsafePromotion.items[0].matrixVerifiedPromotionAllowed = true;
  const promotionMutationMessage = captureThrownMessage(() => (
    assertGraphDocsOutputFinalBReviewChecklistCompatibility(unsafePromotion)
  ));
  assert.match(promotionMutationMessage, /matrixVerifiedPromotionAllowed must be false/u);
  assert.doesNotMatch(promotionMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const unsafeCount = structuredClone(bReviewChecklist);
  unsafeCount.items[0].remainingNonVerifiedCount = 1;
  const countMutationMessage = captureThrownMessage(() => (
    assertGraphDocsOutputFinalBReviewChecklistCompatibility(unsafeCount)
  ));
  assert.match(countMutationMessage, /remainingNonVerifiedCount must match/u);
  assert.doesNotMatch(countMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const unsafeSource = structuredClone(bReviewChecklist);
  unsafeSource.items[0].sourceAcceptanceReportDescriptor.items[0].sourceAcceptanceDescriptor.items[0].sourceMatrixHandoff.items[0].sourceChecklist.items[0].sourceBoundarySummary.items[0].sourceHandoff.items[0].sourceCleanupPolicyGuard.items[0].sourceIndexGuard.items[0].sourceManifestGuard.items[0].sourceApprovalGate.items[0].sourceRepoOutput.items[0].docsArtifact.redactionRequired = false;
  const sourceMutationMessage = captureThrownMessage(() => (
    assertGraphDocsOutputFinalBReviewChecklistCompatibility(unsafeSource)
  ));
  assert.match(sourceMutationMessage, /redactionRequired must be true/u);
  assert.doesNotMatch(sourceMutationMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  const wrongSourceMessage = captureThrownMessage(() => (
    createGraphDocsOutputFinalBReviewChecklist(acceptance)
  ));
  assert.match(
    wrongSourceMessage,
    /GraphDocsOutputFinalAcceptanceReportDescriptor|sourceAcceptanceReportDescriptor/u,
  );
  assert.doesNotMatch(wrongSourceMessage, /failure:graph-schema-invalid|Authorization|synthetic-secret-value/u);

  await assert.rejects(() => access(targetUrl), /ENOENT/u);
  await assert.rejects(() => access(manifestUrl), /ENOENT/u);
  await assert.rejects(() => access(indexUrl), /ENOENT/u);
});

test('disabled docs markdown runtime consumer returns blocked descriptor without docs writes', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'site-capability-graph-docs-runtime-consumer-'));

  try {
    const result = createDisabledGraphDocsMarkdownRuntimeConsumerResult(artifact);
    const item = result.items[0];
    const placement = createGraphDerivedArtifactPlacement({
      outputDir,
      runId: 'synthetic-run-docs-markdown-runtime-consumer',
      artifactFamily: 'site-capability-graph-docs-markdown-runtime-consumer-result',
      artifactName: 'graph-docs-markdown-runtime-consumer',
    });

    assert.equal(assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility(result), true);
    assert.equal(assertGraphDerivedArtifactWriteAllowed(result), true);
    assert.equal(result.queryName, 'createDisabledGraphDocsMarkdownRuntimeConsumerResult');
    assert.equal(result.artifactFamily, 'site-capability-graph-docs-markdown-runtime-consumer-result');
    assert.equal(result.redactionRequired, true);
    assert.equal(item.consumerMode, 'disabled-feature-flag');
    assert.equal(item.featureEnabled, false);
    assert.equal(item.result, 'blocked');
    assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
    assert.equal(item.reason.code, 'graph-runtime-consumer-disabled');
    assert.equal(item.sourceArtifact.queryName, artifact.queryName);
    assert.equal(item.sourceArtifact.artifactFamily, artifact.artifactFamily);
    assert.equal(item.docsArtifact.artifactFamily, 'site-capability-graph-docs-markdown');
    assert.equal(item.docsArtifact.redactionRequired, true);
    assert.equal('outputPath' in item, false);
    assert.equal('docsWriteEnabled' in item, false);
    assert.equal('runtimeDocsWriteEnabled' in item, false);
    assert.equal('sessionView' in item, false);
    assert.equal('standardTaskList' in item, false);

    const written = await writeGraphDerivedArtifactPair(result, placement);
    const artifactJson = await readFile(written.artifactPath, 'utf8');
    const auditJson = await readFile(written.auditPath, 'utf8');
    assert.doesNotMatch(artifactJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
    assert.doesNotMatch(auditJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('disabled docs markdown runtime consumer rejects enabled flag and runtime payloads', async () => {
  const graph = await readMinimalGraphFixture();
  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);

  assert.throws(
    () => createDisabledGraphDocsMarkdownRuntimeConsumerResult(artifact, { featureEnabled: true }),
    /featureEnabled must remain false/u,
  );

  for (const { fieldName, value } of [
    { fieldName: 'outputPath', value: 'runs/site-capability-graph/generated-docs.md' },
    { fieldName: 'docsOutputPath', value: 'runs/site-capability-graph/generated-docs.md' },
    { fieldName: 'docsPath', value: 'runs/site-capability-graph/generated-docs.md' },
    { fieldName: 'repoPath', value: 'runs/site-capability-graph' },
    { fieldName: 'repositoryPath', value: 'runs/site-capability-graph' },
    { fieldName: 'writePath', value: 'runs/site-capability-graph/docs.md' },
    { fieldName: 'artifactPath', value: 'runs/site-capability-graph/docs.md' },
    { fieldName: 'docsWriteEnabled', value: true },
    { fieldName: 'runtimeDocsWriteEnabled', value: true },
    { fieldName: 'externalTelemetryDispatchEnabled', value: true },
    { fieldName: 'externalTelemetry', value: {} },
    { fieldName: 'externalDispatch', value: {} },
    { fieldName: 'dispatch', value: {} },
    { fieldName: 'subscribers', value: [] },
    { fieldName: 'subscriberResults', value: [] },
    { fieldName: 'writer', value: {} },
    { fieldName: 'handler', value: () => true },
    { fieldName: 'rawPayload', value: {} },
    { fieldName: 'unredactedPayload', value: {} },
    { fieldName: 'sessionView', value: {} },
    { fieldName: 'standardTaskList', value: [] },
    { fieldName: 'taskList', value: [] },
    { fieldName: 'downloadPolicy', value: {} },
    { fieldName: 'browserProfile', value: 'synthetic-browser-profile' },
    { fieldName: 'browserProfilePath', value: 'synthetic-browser-profile-path' },
    { fieldName: 'userDataDir', value: 'synthetic-user-data-dir' },
  ]) {
    assert.throws(
      () => createDisabledGraphDocsMarkdownRuntimeConsumerResult(artifact, { [fieldName]: value }),
      new RegExp(`descriptor-only.*${fieldName}`, 'u'),
    );
  }

  const enabledResult = createDisabledGraphDocsMarkdownRuntimeConsumerResult(artifact);
  enabledResult.items[0].featureEnabled = true;
  assert.throws(
    () => assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility(enabledResult),
    /featureEnabled must be false/u,
  );

  const unsafeArtifactResult = createDisabledGraphDocsMarkdownRuntimeConsumerResult(artifact);
  unsafeArtifactResult.items[0].docsArtifact.redactionRequired = false;
  assert.throws(
    () => assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility(unsafeArtifactResult),
    /redactionRequired must be true/u,
  );

  const mismatchedSourceResult = createDisabledGraphDocsMarkdownRuntimeConsumerResult(artifact);
  mismatchedSourceResult.items[0].sourceArtifact.artifactFamily = 'site-capability-graph-docs-markdown-other';
  assert.throws(
    () => assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility(mismatchedSourceResult),
    /sourceArtifact artifactFamily must match docsArtifact/u,
  );
});

test('docs markdown artifact fails closed on forbidden summary data or unredacted writes', async () => {
  const graph = await readMinimalGraphFixture();
  const summaryWithField = generateGraphDocsSummary(graph);
  summaryWithField.sections.capabilityList[0].accessToken = 'synthetic-secret-value';

  const fieldMessage = captureThrownMessage(() => createGraphDocsMarkdownArtifact(summaryWithField));
  assert.match(fieldMessage, /forbidden field/u);
  assert.doesNotMatch(fieldMessage, /synthetic-secret-value/u);

  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  artifact.redactionRequired = false;
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'site-capability-graph-docs-markdown-'));

  try {
    const placement = createGraphDerivedArtifactPlacement({
      outputDir,
      runId: 'synthetic-run-001',
      artifactFamily: 'site-capability-graph-docs-markdown',
      artifactName: 'graph-docs-summary-markdown',
    });

    await assert.rejects(
      () => writeGraphDerivedArtifactPair(artifact, placement),
      /redactionRequired=true/u,
    );
    await assert.rejects(
      () => readFile(placement.artifactPath, 'utf8'),
      /ENOENT/u,
    );
    await assert.rejects(
      () => readFile(placement.auditPath, 'utf8'),
      /ENOENT/u,
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('docs renderer fails closed on forbidden fields and value patterns', async () => {
  const graph = await readMinimalGraphFixture();
  const summaryWithField = generateGraphDocsSummary(graph);
  summaryWithField.sections.capabilityList[0].accessToken = 'synthetic-secret-value';

  const fieldMessage = captureThrownMessage(() => renderGraphDocsSummaryMarkdown(summaryWithField));
  assert.match(fieldMessage, /forbidden field/u);
  assert.doesNotMatch(fieldMessage, /synthetic-secret-value/u);

  const summaryWithValue = generateGraphDocsSummary(graph);
  summaryWithValue.sections.capabilityList[0].id = 'Bearer synthetic.secret.value';

  const valueMessage = captureThrownMessage(() => renderGraphDocsSummaryMarkdown(summaryWithValue));
  assert.match(valueMessage, /Forbidden sensitive pattern detected/u);
  assert.doesNotMatch(valueMessage, /synthetic\.secret\.value/u);
});

test('migration report generator creates a redaction-required descriptor from graph query data', async () => {
  const graph = await readMinimalGraphFixture();

  const report = generateGraphMigrationReport(graph, {
    statusSummary: {
      verified: 0,
      implemented: 5,
      partial: 15,
    },
    knownGaps: ['runtime Layer consumer not connected'],
    nextTasks: ['persist generated graph inventory'],
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.graphVersion, 'synthetic-graph-v1');
  assert.equal(report.queryName, 'generateGraphMigrationReport');
  assert.equal(report.artifactFamily, 'site-capability-graph-migration-report');
  assert.equal(report.redactionRequired, true);
  assert.deepEqual(report.items, [{
    schemaVersion: 1,
    graphVersion: 'synthetic-graph-v1',
    totals: {
      siteCount: 1,
      capabilityCount: 1,
      routeCount: 1,
      endpointCount: 0,
      authRequiredCapabilityCount: 0,
      testEvidenceNodeCount: 1,
    },
    statusSummary: {
      verified: 0,
      implemented: 5,
      partial: 15,
    },
    knownGaps: ['runtime Layer consumer not connected'],
    nextTasks: ['persist generated graph inventory'],
  }]);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(report), true);
});

test('migration report generator counts auth-required capabilities from graph descriptors', async () => {
  const graph = await readMinimalGraphFixture();
  addAuthRequirementDescriptors(graph);

  const report = generateGraphMigrationReport(graph);

  assert.equal(report.items[0].totals.authRequiredCapabilityCount, 1);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(report), true);
});

test('migration report artifact writes through guarded graph artifact writer', async () => {
  const graph = await readMinimalGraphFixture();
  const report = generateGraphMigrationReport(graph, {
    statusSummary: {
      verified: 0,
      implemented: 5,
      partial: 15,
    },
    knownGaps: ['runtime Layer consumer not connected'],
    nextTasks: ['generate graph inventory'],
  });
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'site-capability-graph-migration-report-'));

  try {
    const placement = createGraphDerivedArtifactPlacement({
      outputDir,
      runId: 'synthetic-run-001',
      artifactFamily: 'site-capability-graph-migration-report',
      artifactName: 'migration-report',
    });

    assert.equal(assertGraphDerivedArtifactWriteAllowed(report), true);
    const result = await writeGraphDerivedArtifactPair(report, placement);
    assert.equal(result.artifactPath, placement.artifactPath);
    assert.equal(result.auditPath, placement.auditPath);

    const writtenReport = JSON.parse(await readFile(result.artifactPath, 'utf8'));
    const writtenAudit = JSON.parse(await readFile(result.auditPath, 'utf8'));
    assert.equal(writtenReport.artifactFamily, 'site-capability-graph-migration-report');
    assert.equal(writtenReport.redactionRequired, true);
    assert.deepEqual(writtenReport.items[0].statusSummary, {
      verified: 0,
      implemented: 5,
      partial: 15,
    });
    assert.deepEqual(writtenReport.items[0].knownGaps, ['runtime Layer consumer not connected']);
    assert.equal(writtenAudit.schemaVersion, 1);
    assert.deepEqual(writtenAudit.findings, []);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('migration report runtime integration design stays descriptor-only without repo writes', async () => {
  const graph = await readMinimalGraphFixture();
  const design = createGraphMigrationReportRuntimeIntegrationDesign(graph, {
    statusSummary: {
      verified: 0,
      implemented: 5,
      partial: 15,
    },
    knownGaps: ['runtime Layer consumer not connected'],
    nextTasks: ['wire migration report behind disabled flag'],
  });
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'site-capability-graph-migration-design-'));

  try {
    const placement = createGraphDerivedArtifactPlacement({
      outputDir,
      runId: 'synthetic-run-migration-report-design',
      artifactFamily: 'site-capability-graph-migration-report-runtime-integration-design',
      artifactName: 'migration-report-design',
    });

    assert.equal(assertGraphMigrationReportRuntimeIntegrationDesignCompatibility(design), true);
    assert.equal(assertGraphDerivedArtifactWriteAllowed(design), true);
    assert.equal(design.queryName, 'createGraphMigrationReportRuntimeIntegrationDesign');
    assert.equal(design.artifactFamily, 'site-capability-graph-migration-report-runtime-integration-design');
    assert.equal(design.redactionRequired, true);
    assert.equal(design.items[0].integrationMode, 'design-only');
    assert.equal(design.items[0].repoWriteEnabled, false);
    assert.equal(design.items[0].runtimeArtifactWriteEnabled, false);
    assert.equal(design.items[0].schedulerPublishEnabled, false);
    assert.equal(design.items[0].doctorPublishEnabled, false);
    assert.equal(design.items[0].skillPublishEnabled, false);
    assert.equal(design.items[0].mcpPublishEnabled, false);
    assert.equal(design.items[0].report.artifactFamily, 'site-capability-graph-migration-report');
    assert.equal(design.items[0].report.redactionRequired, true);

    const result = await writeGraphDerivedArtifactPair(design, placement);
    const artifactJson = await readFile(result.artifactPath, 'utf8');
    const auditJson = await readFile(result.auditPath, 'utf8');
    assert.doesNotMatch(artifactJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
    assert.doesNotMatch(auditJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('migration report runtime integration design rejects repo writes and publish payloads', async () => {
  const graph = await readMinimalGraphFixture();

  assert.throws(
    () => createGraphMigrationReportRuntimeIntegrationDesign(graph, { repoWriteEnabled: true }),
    /repoWriteEnabled must remain false/u,
  );
  assert.throws(
    () => createGraphMigrationReportRuntimeIntegrationDesign(graph, { schedulerPublishEnabled: true }),
    /schedulerPublishEnabled must remain false/u,
  );
  assert.throws(
    () => createGraphMigrationReportRuntimeIntegrationDesign(graph, {
      outputPath: 'runs/site-capability-graph/MIGRATION_REPORT.md',
    }),
    /descriptor-only.*outputPath/u,
  );
  assert.throws(
    () => createGraphMigrationReportRuntimeIntegrationDesign(graph, {
      schedulerPayload: {},
    }),
    /descriptor-only.*schedulerPayload/u,
  );
  assert.throws(
    () => createGraphMigrationReportRuntimeIntegrationDesign(graph, {
      sessionView: {},
    }),
    /descriptor-only.*sessionView/u,
  );

  const fieldMessage = captureThrownMessage(() => createGraphMigrationReportRuntimeIntegrationDesign(graph, {
    statusSummary: {
      accessToken: 'synthetic-secret-value',
    },
  }));
  assert.match(fieldMessage, /forbidden field/u);
  assert.doesNotMatch(fieldMessage, /synthetic-secret-value/u);

  const design = createGraphMigrationReportRuntimeIntegrationDesign(graph);
  design.items[0].repoWriteEnabled = true;
  assert.throws(
    () => assertGraphMigrationReportRuntimeIntegrationDesignCompatibility(design),
    /repoWriteEnabled must be false/u,
  );

  const unsafeDesign = createGraphMigrationReportRuntimeIntegrationDesign(graph);
  unsafeDesign.items[0].report.redactionRequired = false;
  assert.throws(
    () => assertGraphMigrationReportRuntimeIntegrationDesignCompatibility(unsafeDesign),
    /report redactionRequired must be true/u,
  );
});

test('disabled migration report runtime consumer returns blocked descriptor without repo writes', async () => {
  const graph = await readMinimalGraphFixture();
  const design = createGraphMigrationReportRuntimeIntegrationDesign(graph, {
    statusSummary: {
      verified: 0,
      implemented: 5,
      partial: 15,
    },
    knownGaps: ['runtime migration report writer not connected'],
    nextTasks: ['wire migration report behind disabled flag'],
  });
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'site-capability-graph-migration-consumer-'));

  try {
    const result = createDisabledGraphMigrationReportRuntimeConsumerResult(design);
    const item = result.items[0];
    const placement = createGraphDerivedArtifactPlacement({
      outputDir,
      runId: 'synthetic-run-migration-report-consumer',
      artifactFamily: 'site-capability-graph-migration-report-runtime-consumer-result',
      artifactName: 'migration-report-consumer',
    });

    assert.equal(assertDisabledGraphMigrationReportRuntimeConsumerResultCompatibility(result), true);
    assert.equal(assertGraphDerivedArtifactWriteAllowed(result), true);
    assert.equal(result.queryName, 'createDisabledGraphMigrationReportRuntimeConsumerResult');
    assert.equal(result.artifactFamily, 'site-capability-graph-migration-report-runtime-consumer-result');
    assert.equal(result.redactionRequired, true);
    assert.equal(item.consumerMode, 'disabled-feature-flag');
    assert.equal(item.featureEnabled, false);
    assert.equal(item.result, 'blocked');
    assert.equal(item.reasonCode, 'graph-runtime-consumer-disabled');
    assert.equal(item.reason.code, 'graph-runtime-consumer-disabled');
    assert.equal(item.repoWriteEnabled, false);
    assert.equal(item.runtimeArtifactWriteEnabled, false);
    assert.equal(item.schedulerPublishEnabled, false);
    assert.equal(item.doctorPublishEnabled, false);
    assert.equal(item.skillPublishEnabled, false);
    assert.equal(item.mcpPublishEnabled, false);
    assert.equal(item.report.artifactFamily, 'site-capability-graph-migration-report');
    assert.equal(item.report.redactionRequired, true);
    assert.equal('schedulerPayload' in item, false);
    assert.equal('artifactPath' in item, false);
    assert.equal('sessionView' in item, false);

    const written = await writeGraphDerivedArtifactPair(result, placement);
    const artifactJson = await readFile(written.artifactPath, 'utf8');
    const auditJson = await readFile(written.auditPath, 'utf8');
    assert.doesNotMatch(artifactJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
    assert.doesNotMatch(auditJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('disabled migration report runtime consumer rejects enabled flags and publish payloads', async () => {
  const graph = await readMinimalGraphFixture();
  const design = createGraphMigrationReportRuntimeIntegrationDesign(graph);

  for (const fieldName of [
    'featureEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'schedulerPublishEnabled',
    'doctorPublishEnabled',
    'skillPublishEnabled',
    'mcpPublishEnabled',
  ]) {
    assert.throws(
      () => createDisabledGraphMigrationReportRuntimeConsumerResult(design, { [fieldName]: true }),
      new RegExp(`${fieldName} must remain false`, 'u'),
    );
  }

  for (const { fieldName, value } of [
    { fieldName: 'outputPath', value: 'runs/site-capability-graph/MIGRATION_REPORT.md' },
    { fieldName: 'reportPath', value: 'runs/site-capability-graph/MIGRATION_REPORT.md' },
    { fieldName: 'repoPath', value: 'runs/site-capability-graph' },
    { fieldName: 'writePath', value: 'runs/site-capability-graph/report.json' },
    { fieldName: 'artifactPath', value: 'runs/site-capability-graph/report.json' },
    { fieldName: 'schedulerPayload', value: {} },
    { fieldName: 'doctorPayload', value: {} },
    { fieldName: 'skillPayload', value: {} },
    { fieldName: 'mcpPayload', value: {} },
    { fieldName: 'sessionView', value: {} },
    { fieldName: 'standardTaskList', value: [] },
    { fieldName: 'taskList', value: [] },
    { fieldName: 'downloadPolicy', value: {} },
  ]) {
    assert.throws(
      () => createDisabledGraphMigrationReportRuntimeConsumerResult(design, { [fieldName]: value }),
      new RegExp(`descriptor-only.*${fieldName}`, 'u'),
    );
  }

  const enabledPublishResult = createDisabledGraphMigrationReportRuntimeConsumerResult(design);
  enabledPublishResult.items[0].schedulerPublishEnabled = true;
  assert.throws(
    () => assertDisabledGraphMigrationReportRuntimeConsumerResultCompatibility(enabledPublishResult),
    /schedulerPublishEnabled must be false/u,
  );

  const unsafeReportResult = createDisabledGraphMigrationReportRuntimeConsumerResult(design);
  unsafeReportResult.items[0].report.redactionRequired = false;
  assert.throws(
    () => assertDisabledGraphMigrationReportRuntimeConsumerResultCompatibility(unsafeReportResult),
    /report redactionRequired must be true/u,
  );
});

test('migration report repo output dry-run previews contained target without repo writes', async () => {
  const graph = await readMinimalGraphFixture();
  const targetRelativePath = 'runs/site-capability-graph/generated-migration-report-dry-run.md';
  const repoTargetPath = path.join(process.cwd(), targetRelativePath);
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'site-capability-graph-migration-report-dry-run-'));

  try {
    await assert.rejects(() => access(repoTargetPath), /ENOENT/u);

    const result = createGraphMigrationReportRepoOutputDryRun(graph, {
      targetRelativePath,
      statusSummary: {
        verified: 0,
        implemented: 5,
        partial: 15,
      },
      knownGaps: ['runtime migration report writer not connected'],
      nextTasks: ['keep repo output dry-run until explicit validation exists'],
    });
    const item = result.items[0];
    const placement = createGraphDerivedArtifactPlacement({
      outputDir,
      runId: 'synthetic-run-migration-report-repo-output-dry-run',
      artifactFamily: 'site-capability-graph-migration-report-repo-output-dry-run',
      artifactName: 'migration-report-repo-output-dry-run',
    });

    assert.equal(assertGraphMigrationReportRepoOutputDryRunCompatibility(result), true);
    assert.equal(assertGraphDerivedArtifactWriteAllowed(result), true);
    assert.equal(result.queryName, 'createGraphMigrationReportRepoOutputDryRun');
    assert.equal(result.artifactFamily, 'site-capability-graph-migration-report-repo-output-dry-run');
    assert.equal(result.redactionRequired, true);
    assert.equal(item.outputMode, 'dry-run-preview');
    assert.equal(item.dryRunOnly, true);
    assert.equal(item.targetRelativePath, targetRelativePath);
    assert.equal(item.repoWriteEnabled, false);
    assert.equal(item.runtimeArtifactWriteEnabled, false);
    assert.equal(item.schedulerPublishEnabled, false);
    assert.equal(item.doctorPublishEnabled, false);
    assert.equal(item.skillPublishEnabled, false);
    assert.equal(item.mcpPublishEnabled, false);
    assert.equal(item.explicitValidationRequired, true);
    assert.equal(item.report.artifactFamily, 'site-capability-graph-migration-report');
    assert.equal(item.report.redactionRequired, true);

    const written = await writeGraphDerivedArtifactPair(result, placement);
    const artifactJson = await readFile(written.artifactPath, 'utf8');
    const auditJson = await readFile(written.auditPath, 'utf8');
    assert.doesNotMatch(artifactJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
    assert.doesNotMatch(auditJson, /authorization|cookie|csrf|sessionId|browserProfile/iu);
    await assert.rejects(() => access(repoTargetPath), /ENOENT/u);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('migration report repo output dry-run rejects writes, unsafe targets, and unsafe reports', async () => {
  const graph = await readMinimalGraphFixture();

  for (const fieldName of [
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'schedulerPublishEnabled',
    'doctorPublishEnabled',
    'skillPublishEnabled',
    'mcpPublishEnabled',
  ]) {
    assert.throws(
      () => createGraphMigrationReportRepoOutputDryRun(graph, { [fieldName]: true }),
      new RegExp(`${fieldName} must remain false`, 'u'),
    );
  }

  for (const targetRelativePath of [
    '../outside.md',
    'C:/Users/lyt-p/Desktop/outside.md',
    'site-capability-graph/migration-report.json',
    'runs/site-capability-graph/MIGRATION_REPORT.md',
    'runs/site-capability-graph/report.txt',
  ]) {
    assert.throws(
      () => createGraphMigrationReportRepoOutputDryRun(graph, { targetRelativePath }),
      /targetRelativePath/u,
    );
  }

  assert.throws(
    () => createGraphMigrationReportRepoOutputDryRun(graph, {
      outputPath: 'runs/site-capability-graph/generated-migration-report.md',
    }),
    /descriptor-only.*outputPath/u,
  );
  assert.throws(
    () => createGraphMigrationReportRepoOutputDryRun(graph, {
      sessionView: {},
    }),
    /descriptor-only.*sessionView/u,
  );

  const unsafeResult = createGraphMigrationReportRepoOutputDryRun(graph);
  unsafeResult.items[0].repoWriteEnabled = true;
  assert.throws(
    () => assertGraphMigrationReportRepoOutputDryRunCompatibility(unsafeResult),
    /repoWriteEnabled must be false/u,
  );

  const unsafeReportResult = createGraphMigrationReportRepoOutputDryRun(graph);
  unsafeReportResult.items[0].report.redactionRequired = false;
  assert.throws(
    () => assertGraphMigrationReportRepoOutputDryRunCompatibility(unsafeReportResult),
    /report redactionRequired must be true/u,
  );
});

test('migration report repo output approval gate stays design-only', async () => {
  const graph = await readMinimalGraphFixture();
  const dryRun = createGraphMigrationReportRepoOutputDryRun(graph, {
    targetRelativePath: 'runs/site-capability-graph/generated-migration-report-dry-run.md',
    statusSummary: {
      verified: 0,
      implemented: 5,
      partial: 15,
    },
    knownGaps: ['runtime migration report writer not connected'],
    nextTasks: ['keep repo output dry-run until approval gate is implemented'],
  });

  const gate = createGraphRepoOutputApprovalGateDesign(dryRun, {
    gateName: 'migration-report-repo-output-approval-gate',
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
  assert.equal(item.runtimeArtifactWriteEnabled, false);
  assert.equal(item.schedulerPublishEnabled, false);
  assert.equal(item.doctorPublishEnabled, false);
  assert.equal(item.skillPublishEnabled, false);
  assert.equal(item.mcpPublishEnabled, false);
  assert.equal(item.approvalRequiredBeforeRepoWrite, true);
  assert.equal(item.sourceOutputDryRunOnly, true);
  assert.equal(item.sourceRepoOutput.artifactFamily, 'site-capability-graph-migration-report-repo-output-dry-run');
  assert.ok(item.requiredApprovalEvidence.includes('matrix-section-updated-with-verification'));
  assert.ok(item.requiredApprovalEvidence.includes('focused-tests-passed'));
  assert.ok(item.requiredApprovalEvidence.includes('repo-target-contained'));

  assert.throws(
    () => createGraphRepoOutputApprovalGateDesign(dryRun, { schedulerPublishEnabled: true }),
    /schedulerPublishEnabled must remain false/u,
  );
  assert.throws(
    () => createGraphRepoOutputApprovalGateDesign(dryRun, {
      publishPayload: { destination: 'synthetic' },
    }),
    /descriptor-only.*publishPayload/u,
  );

  const unsafeGate = createGraphRepoOutputApprovalGateDesign(dryRun);
  unsafeGate.items[0].sourceOutputDryRunOnly = false;
  assert.throws(
    () => assertGraphRepoOutputApprovalGateDesignCompatibility(unsafeGate),
    /sourceOutputDryRunOnly must be true/u,
  );

  const unsafeSourceGate = createGraphRepoOutputApprovalGateDesign(dryRun);
  unsafeSourceGate.items[0].sourceRepoOutput.items[0].explicitValidationRequired = false;
  assert.throws(
    () => assertGraphRepoOutputApprovalGateDesignCompatibility(unsafeSourceGate),
    /explicitValidationRequired must be true/u,
  );
});

test('migration report artifact fails closed before unsafe writes', async () => {
  const graph = await readMinimalGraphFixture();
  const report = generateGraphMigrationReport(graph);
  report.redactionRequired = false;
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'site-capability-graph-migration-report-'));

  try {
    const placement = createGraphDerivedArtifactPlacement({
      outputDir,
      runId: 'synthetic-run-001',
      artifactFamily: 'site-capability-graph-migration-report',
      artifactName: 'migration-report',
    });

    await assert.rejects(
      () => writeGraphDerivedArtifactPair(report, placement),
      /redactionRequired=true/u,
    );
    await assert.rejects(
      () => readFile(placement.artifactPath, 'utf8'),
      /ENOENT/u,
    );
    await assert.rejects(
      () => readFile(placement.auditPath, 'utf8'),
      /ENOENT/u,
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('migration report generator rejects forbidden options before artifact guard', async () => {
  const graph = await readMinimalGraphFixture();

  const fieldMessage = captureThrownMessage(() => generateGraphMigrationReport(graph, {
    statusSummary: {
      accessToken: 'synthetic-secret-value',
    },
  }));
  assert.match(fieldMessage, /forbidden field/u);
  assert.doesNotMatch(fieldMessage, /synthetic-secret-value/u);

  const valueMessage = captureThrownMessage(() => generateGraphMigrationReport(graph, {
    nextTasks: ['Authorization: Bearer synthetic-secret-value'],
  }));
  assert.match(valueMessage, /Forbidden sensitive pattern/u);
  assert.doesNotMatch(valueMessage, /synthetic-secret-value/u);
});

test('docs generator output is cloned and does not mutate graph descriptors', async () => {
  const graph = await readMinimalGraphFixture();

  const summary = generateGraphDocsSummary(graph);
  summary.sections.capabilityList[0].siteKey = 'mutated';

  const capability = graph.nodes.find((node) => node.type === 'CapabilityNode');
  assert.equal(capability.siteKey, 'synthetic.example');
});

test('docs generator does not mutate catalogAction failure mode descriptors', async () => {
  const graph = await readMinimalGraphFixture();
  const failureMode = {
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
  };
  graph.nodes.push(failureMode);
  const beforeGeneration = JSON.stringify(failureMode);

  const summary = generateGraphDocsSummary(graph);
  const markdown = renderGraphDocsSummaryMarkdown(summary);
  const summaryFailureMode = summary.sections.failureModeSummary.find(
    (entry) => entry.failureModeId === failureMode.id,
  );
  summaryFailureMode.catalogAction = 'deprecate';

  assert.equal(JSON.stringify(failureMode), beforeGeneration);
  assert.equal(graph.nodes.find((node) => node.id === failureMode.id).catalogAction, 'block');
  assert.match(markdown, /failure:graph-candidate-promotion-forbidden[\s\S]*catalogAction: block/u);
  assert.doesNotMatch(
    markdown,
    /catalog mutation|catalog write|catalog promotion|runtime deprecation|endpoint lifecycle mutation|artifact write|SiteAdapter runtime|downloader|SessionView/u,
  );
});

test('docs generator rejects unsupported catalogAction without echoing values', async () => {
  const graph = await readMinimalGraphFixture();
  graph.nodes.push({
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
    catalogAction: 'Authorization: Bearer synthetic-secret-value',
  });
  let markdownCreated = false;

  const message = captureThrownMessage(() => {
    const summary = generateGraphDocsSummary(graph);
    renderGraphDocsSummaryMarkdown(summary);
    markdownCreated = true;
  });

  assert.equal(markdownCreated, false);
  assert.match(message, /FailureModeNode catalogAction is unsupported/u);
  assert.doesNotMatch(message, /Authorization|synthetic-secret-value/u);
});

test('docs generator redaction guard rejects failureModeSummary catalogAction sensitive values', async () => {
  const graph = await readMinimalGraphFixture();
  graph.nodes.push({
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
  });

  const renderSummary = generateGraphDocsSummary(graph);
  const renderEntry = renderSummary.sections.failureModeSummary.find(
    (entry) => entry.failureModeId === 'failure:graph-candidate-promotion-forbidden',
  );
  renderEntry.catalogAction = 'Authorization: Bearer synthetic-secret-value';
  const renderMessage = captureThrownMessage(() => renderGraphDocsSummaryMarkdown(renderSummary));

  assert.match(renderMessage, /Forbidden sensitive pattern/u);
  assert.doesNotMatch(renderMessage, /Authorization|synthetic-secret-value/u);

  const artifactSummary = generateGraphDocsSummary(graph);
  const artifactEntry = artifactSummary.sections.failureModeSummary.find(
    (entry) => entry.failureModeId === 'failure:graph-candidate-promotion-forbidden',
  );
  artifactEntry.catalogAction = 'Authorization: Bearer synthetic-secret-value';
  let artifactCreated = false;
  const artifactMessage = captureThrownMessage(() => {
    createGraphDocsMarkdownArtifact(artifactSummary);
    artifactCreated = true;
  });

  assert.equal(artifactCreated, false);
  assert.match(artifactMessage, /Forbidden sensitive pattern/u);
  assert.doesNotMatch(artifactMessage, /Authorization|synthetic-secret-value/u);
});

test('docs generator fails closed on forbidden graph fields without echoing values', async () => {
  const graph = await readMinimalGraphFixture();
  graph.nodes[0].authorizationHeader = 'synthetic-secret-value';

  const message = captureThrownMessage(() => generateGraphDocsSummary(graph));

  assert.match(message, /graph-schema-invalid|forbidden field/u);
  assert.doesNotMatch(message, /synthetic-secret-value/u);
});

test('GraphDocsSummary compatibility rejects forbidden fields without echoing values', () => {
  const message = captureThrownMessage(() => assertGraphDocsSummaryCompatible({
    schemaVersion: 1,
    graphVersion: 'synthetic-graph-v1',
    artifactFamily: 'site-capability-graph-docs',
    redactionRequired: true,
    sections: {
      capabilityList: [],
      dependencyMap: [],
      dependencyMapByEdgeType: [],
      routeDependencySummary: [],
      endpointImpactMap: [],
      authRequirementSummary: [],
      signerDependencySummary: [],
      riskPolicySummary: [],
      failureModeSummary: [],
      agentExposedCapabilityList: [],
      testCoverageSummary: [
        {
          nodeId: 'capability:synthetic.example:open-public-page',
          accessToken: 'synthetic-secret-value',
        },
      ],
      layerDesignSourceReferences: [],
    },
  }));

  assert.match(message, /forbidden field/u);
  assert.doesNotMatch(message, /synthetic-secret-value/u);
});
