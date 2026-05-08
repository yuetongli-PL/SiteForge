import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GRAPH_NODE_SCHEMA_VERSION,
  GRAPH_NODE_TYPES,
  GRAPH_QUERY_RESULT_SCHEMA_VERSION,
  createLayerSourceAuthSessionRequirementInventorySummary,
  createLayerSourceRiskPolicyInventorySummary,
  createLayerSourceSignerDependencyInventorySummary,
  assertLayerSourceAuthSessionRequirementInventorySummaryCompatibility,
  assertLayerSourceRiskPolicyInventorySummaryCompatibility,
  assertLayerSourceSignerDependencyInventorySummaryCompatibility,
} from '../../src/sites/capability/site-capability-graph.mjs';
import {
  assertSchemaCompatible,
  getCompatibilitySchema,
  listCompatibilitySchemas,
} from '../../src/sites/capability/compatibility-registry.mjs';
import {
  getSchemaInventoryEntry,
  listMissingSchemas,
} from '../../src/sites/capability/schema-inventory.mjs';
import {
  CAPABILITY_HOOK_EVENT_TYPES,
  CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_POLICY,
  createCapabilityHookEventTypeRegistry,
  createCapabilityHookProducerDescriptorRegistry,
  createCapabilityHookRegistrySnapshot,
} from '../../src/sites/capability/capability-hook.mjs';
import { createFocusedRegressionBatchDefinitionFixture } from '../../src/sites/capability/focused-regression-batches.mjs';
import {
  normalizeArtifactReferenceSet,
  normalizeManifestArtifactBundle,
} from '../../src/sites/capability/artifact-schema.mjs';
import { listReasonCodeDefinitions } from '../../src/sites/capability/reason-codes.mjs';

const REGISTERED_SCHEMA_NAMES = [
  'ApiCandidate',
  'ApiCatalogEntry',
  'ApiCatalog',
  'ApiCatalogIndex',
  'ApiResponseCaptureSummary',
  'SiteAdapterCandidateDecision',
  'SiteAdapterCatalogUpgradePolicy',
  'reasonCode',
  'SiteCapabilityGraph',
  'GraphManifest',
  'GraphNode',
  ...GRAPH_NODE_TYPES,
  'GraphEdge',
  'GraphValidationReport',
  'GraphQueryResult',
  'LayerSourceRiskPolicyInventorySummary',
  'LayerSourceAuthSessionRequirementInventorySummary',
  'LayerSourceSignerDependencyInventorySummary',
  'GraphDocsSummary',
  'SessionView',
  'DownloadPolicy',
  'StandardTaskList',
  'RiskState',
  'CapabilityHook',
  'CapabilityHookEventTypeRegistry',
  'CapabilityHookProducerDescriptorRegistry',
  'CapabilityHookRegistrySnapshot',
  'LifecycleEvent',
  'FocusedRegressionBatchDefinition',
  'ArtifactReferenceSet',
  'ManifestArtifactBundle',
];

const LAYER_SOURCE_INVENTORY_SUMMARY_NAMES = [
  'LayerSourceRiskPolicyInventorySummary',
  'LayerSourceAuthSessionRequirementInventorySummary',
  'LayerSourceSignerDependencyInventorySummary',
];
const SITE_CAPABILITY_GRAPH_SOURCE_PATH = 'src/sites/capability/site-capability-graph.mjs';

function createSyntheticGraphNodePayload(type) {
  const base = {
    schemaVersion: GRAPH_NODE_SCHEMA_VERSION,
    id: `node:synthetic:${type}`,
    type,
  };
  const byType = {
    SiteNode: {
      siteKey: 'synthetic.example',
      hostFamily: ['synthetic.example'],
    },
    CapabilityNode: {
      siteKey: 'synthetic.example',
      capabilityKey: 'read-public-page',
      capabilityFamily: 'navigate-page',
      mode: 'readOnly',
      requiresApproval: false,
      supportedTaskTypes: ['open-page'],
      routeRefs: ['route:synthetic.example:public'],
      riskPolicyRef: 'risk-policy:synthetic.example:normal',
    },
    RouteNode: {
      siteKey: 'synthetic.example',
      routeKind: 'page',
      urlPattern: 'https://synthetic.example/:id',
      pageType: 'public-detail',
      capabilityRefs: ['capability:synthetic.example:read-public-page'],
      riskPolicyRef: 'risk-policy:synthetic.example:normal',
    },
    EndpointNode: {
      siteKey: 'synthetic.example',
      endpointKind: 'api',
      lifecycleState: 'cataloged',
      methodFamily: 'GET',
      routeRefs: ['route:synthetic.example:public'],
      capabilityRefs: ['capability:synthetic.example:read-public-page'],
      authRequirementRef: 'auth:synthetic.example:none',
      sessionRequirementRef: 'session:synthetic.example:none',
      signerRef: 'signer:synthetic.example:none',
      requestSchemaRef: 'schema:synthetic-request',
      responseSchemaRef: 'schema:synthetic-response',
      riskPolicyRef: 'risk-policy:synthetic.example:normal',
      versionRef: 'version:synthetic-endpoint-v1',
    },
    AuthRequirementNode: {
      authKind: 'none',
      requiredFor: ['open-page'],
      proofType: 'public',
    },
    SessionRequirementNode: {
      purpose: 'read-public-page',
      scope: 'public',
      ttlClass: 'none',
      permissionClass: 'none',
      profileIsolation: 'not-required',
      networkContextClass: 'public',
      auditRequired: false,
      revocationRequired: false,
    },
    SignerNode: {
      siteKey: 'synthetic.example',
      signerKind: 'none',
      versionRef: 'version:synthetic-signer-v1',
      supportedEndpointRefs: ['endpoint:synthetic.example:public'],
    },
    RiskPolicyNode: {
      state: 'normal',
      allowedActions: ['navigate'],
      blockedActions: [],
      requiresApproval: false,
      cooldownRequired: false,
      isolationRequired: false,
      manualRecoveryRequired: false,
      degradable: true,
      artifactWriteAllowed: true,
      sourceRefs: ['config/site-capabilities.json'],
    },
    SchemaNode: {
      schemaName: 'SyntheticNodeSchema',
      governedVersion: GRAPH_NODE_SCHEMA_VERSION,
      owner: 'Capability',
      sourcePath: SITE_CAPABILITY_GRAPH_SOURCE_PATH,
    },
    ArtifactContractNode: {
      artifactFamily: 'synthetic-descriptor',
      redactionRequired: true,
      schemaRef: 'schema:synthetic-artifact',
      writeGuard: 'SecurityGuard redaction required',
      auditRequired: true,
    },
    ArtifactNode: {
      artifactFamily: 'synthetic-descriptor',
      redactionRequired: true,
      schemaRef: 'schema:synthetic-artifact',
      writeGuard: 'SecurityGuard redaction required',
      auditRequired: true,
    },
    TestEvidenceNode: {
      testPath: 'tests/node/compatibility-registry.test.mjs',
      command: 'node --test tests/node/compatibility-registry.test.mjs',
      result: 'passed',
      fixtureType: 'synthetic-redacted',
    },
    TestNode: {
      testPath: 'tests/node/compatibility-registry.test.mjs',
      command: 'node --test tests/node/compatibility-registry.test.mjs',
      result: 'passed',
      fixtureType: 'synthetic-redacted',
    },
    VersionNode: {
      versionKind: 'schema',
      version: '1',
    },
    FailureModeNode: {
      reasonCode: 'synthetic-public-error',
      retryable: false,
      cooldownRequired: false,
      isolationRequired: false,
      manualRecoveryRequired: false,
      degradable: true,
      artifactWriteAllowed: true,
    },
    ObservabilityNode: {
      eventName: 'synthetic.public.event',
      requiredFields: ['traceId'],
    },
  };

  return {
    ...base,
    ...byType[type],
  };
}

function createSyntheticLayerSourceInputs() {
  return {
    siteCapabilities: {
      version: 1,
      sites: {
        'synthetic.example': {
          host: 'synthetic.example',
          siteKey: 'synthetic',
          pageTypes: ['auth-page'],
          capabilityFamilies: ['download-content'],
          supportedIntents: ['download-book'],
          safeActionKinds: ['navigate'],
          approvalActionKinds: ['download-submit'],
          downloader: {
            supported: true,
            requiresLogin: true,
            liveAccessStatus: 'auth_required',
          },
        },
      },
    },
    siteRegistry: {
      version: 1,
      sites: {
        'synthetic.example': {
          host: 'synthetic.example',
          siteKey: 'synthetic',
          downloadSessionRequirement: 'required',
          downloadTaskTypes: ['book'],
          capabilityFamilies: ['download-content'],
          downloadSupport: {
            supported: true,
            requiresLogin: true,
            unsupportedLiveReasonCode: 'auth_required',
          },
        },
      },
    },
  };
}

function compatiblePayloadFor(schema) {
  if (schema.name === 'SiteCapabilityGraph') {
    return {
      schemaVersion: schema.version,
      graphVersion: 'synthetic-graph-v1',
      manifest: {
        schemaVersion: 1,
        graphSchemaVersion: schema.version,
        graphDataVersion: 'synthetic-graph-v1',
      },
      nodes: [],
      edges: [],
    };
  }
  if (schema.name === 'GraphManifest') {
    return {
      schemaVersion: schema.version,
      graphSchemaVersion: 1,
      graphDataVersion: 'synthetic-graph-v1',
    };
  }
  if (schema.name === 'GraphNode') {
    return createSyntheticGraphNodePayload('SiteNode');
  }
  if (GRAPH_NODE_TYPES.includes(schema.name)) {
    return createSyntheticGraphNodePayload(schema.name);
  }
  if (schema.name === 'GraphEdge') {
    return {
      schemaVersion: schema.version,
      id: 'edge:synthetic:site:capability',
      type: 'site_declares_capability',
      from: 'site:synthetic.example',
      to: 'capability:synthetic.example:open-public-page',
    };
  }
  if (schema.name === 'GraphValidationReport') {
    return {
      schemaVersion: schema.version,
      graphVersion: 'synthetic-graph-v1',
      result: 'passed',
      findings: [],
    };
  }
  if (schema.name === 'GraphQueryResult') {
    return {
      schemaVersion: schema.version,
      graphVersion: 'synthetic-graph-v1',
      queryName: 'listSites',
      items: [],
    };
  }
  if (schema.name === 'GraphDocsSummary') {
    return {
      schemaVersion: schema.version,
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
        testCoverageSummary: [],
        layerDesignSourceReferences: [],
      },
    };
  }
  if (schema.name === 'LayerSourceRiskPolicyInventorySummary') {
    return createLayerSourceRiskPolicyInventorySummary(createSyntheticLayerSourceInputs());
  }
  if (schema.name === 'LayerSourceAuthSessionRequirementInventorySummary') {
    return createLayerSourceAuthSessionRequirementInventorySummary(createSyntheticLayerSourceInputs());
  }
  if (schema.name === 'LayerSourceSignerDependencyInventorySummary') {
    return createLayerSourceSignerDependencyInventorySummary(createSyntheticLayerSourceInputs());
  }
  if (schema.name === 'CapabilityHookEventTypeRegistry') {
    return createCapabilityHookEventTypeRegistry();
  }
  if (schema.name === 'CapabilityHookProducerDescriptorRegistry') {
    return createCapabilityHookProducerDescriptorRegistry();
  }
  if (schema.name === 'CapabilityHookRegistrySnapshot') {
    return createCapabilityHookRegistrySnapshot([{
      phase: 'on_completion',
      subscriber: {
        name: 'synthetic-completion-observer',
      },
    }]);
  }
  if (schema.name === 'FocusedRegressionBatchDefinition') {
    return createFocusedRegressionBatchDefinitionFixture();
  }
  if (schema.name === 'ArtifactReferenceSet') {
    return normalizeArtifactReferenceSet({
      manifest: 'runs/synthetic/manifest.json',
      source: {
        diagnostic: 'runs/synthetic/diagnostic.json',
      },
    });
  }
  if (schema.name === 'ManifestArtifactBundle') {
    return normalizeManifestArtifactBundle({
      manifestName: 'SyntheticManifest',
      manifestSchemaVersion: 1,
      manifestPath: 'runs/synthetic/manifest.json',
      artifacts: {
        manifest: 'runs/synthetic/manifest.json',
        redactionAudit: 'runs/synthetic/redaction-audit.json',
      },
    });
  }
  if (schema.name === 'reasonCode') {
    return {
      schemaVersion: schema.version,
      entries: listReasonCodeDefinitions(),
    };
  }
  return { schemaVersion: schema.version };
}

test('compatibility registry exposes current core schema versions', () => {
  const schemas = listCompatibilitySchemas();
  assert.deepEqual(schemas.map((entry) => entry.name), REGISTERED_SCHEMA_NAMES);
  for (const schema of schemas) {
    assert.equal(typeof schema.version, 'number');
    assert.match(schema.sourcePath, /^src\/sites\/capability\//u);
    assert.equal(Object.hasOwn(schema, 'assertCompatible'), false);
  }
});

test('compatibility registry accepts current schema payload versions', () => {
  for (const schema of listCompatibilitySchemas()) {
    assert.equal(assertSchemaCompatible(schema.name, compatiblePayloadFor(schema)), true);
  }
});

test('compatibility registry governs all GraphNode subtype schema names', () => {
  for (const name of GRAPH_NODE_TYPES) {
    const registryEntry = getCompatibilitySchema(name);
    const inventoryEntry = getSchemaInventoryEntry(name);
    const payload = createSyntheticGraphNodePayload(name);

    assert.notEqual(registryEntry, null, `${name} must be listed in compatibility registry`);
    assert.notEqual(inventoryEntry, null, `${name} must be listed in schema inventory`);
    assert.equal(registryEntry.version, GRAPH_NODE_SCHEMA_VERSION);
    assert.equal(inventoryEntry.version, GRAPH_NODE_SCHEMA_VERSION);
    assert.equal(registryEntry.sourcePath, SITE_CAPABILITY_GRAPH_SOURCE_PATH);
    assert.equal(inventoryEntry.sourcePath, SITE_CAPABILITY_GRAPH_SOURCE_PATH);
    assert.equal(assertSchemaCompatible(name, payload), true);
  }
});

test('compatibility registry governs Layer-source inventory summary schema names', () => {
  const inputs = createSyntheticLayerSourceInputs();
  const summaries = new Map([
    ['LayerSourceRiskPolicyInventorySummary', createLayerSourceRiskPolicyInventorySummary(inputs)],
    [
      'LayerSourceAuthSessionRequirementInventorySummary',
      createLayerSourceAuthSessionRequirementInventorySummary(inputs),
    ],
    ['LayerSourceSignerDependencyInventorySummary', createLayerSourceSignerDependencyInventorySummary(inputs)],
  ]);
  const directAssertions = new Map([
    ['LayerSourceRiskPolicyInventorySummary', assertLayerSourceRiskPolicyInventorySummaryCompatibility],
    [
      'LayerSourceAuthSessionRequirementInventorySummary',
      assertLayerSourceAuthSessionRequirementInventorySummaryCompatibility,
    ],
    ['LayerSourceSignerDependencyInventorySummary', assertLayerSourceSignerDependencyInventorySummaryCompatibility],
  ]);

  for (const name of LAYER_SOURCE_INVENTORY_SUMMARY_NAMES) {
    const registryEntry = getCompatibilitySchema(name);
    const inventoryEntry = getSchemaInventoryEntry(name);
    const summary = summaries.get(name);

    assert.notEqual(registryEntry, null);
    assert.notEqual(inventoryEntry, null);
    assert.equal(registryEntry.version, GRAPH_QUERY_RESULT_SCHEMA_VERSION);
    assert.equal(inventoryEntry.version, GRAPH_QUERY_RESULT_SCHEMA_VERSION);
    assert.equal(registryEntry.sourcePath, SITE_CAPABILITY_GRAPH_SOURCE_PATH);
    assert.equal(inventoryEntry.sourcePath, SITE_CAPABILITY_GRAPH_SOURCE_PATH);
    assert.equal(summary.schemaVersion, GRAPH_QUERY_RESULT_SCHEMA_VERSION);
    assert.equal(directAssertions.get(name)(summary), true);
    assert.equal(assertSchemaCompatible(name, summary), true);
  }
});

test('compatibility registry rejects CapabilityHook producer inventory drift centrally', () => {
  const current = createCapabilityHookEventTypeRegistry();
  assert.equal(assertSchemaCompatible('CapabilityHookEventTypeRegistry', current), true);

  assert.throws(
    () => assertSchemaCompatible('CapabilityHookEventTypeRegistry', {
      ...current,
      eventTypes: [...CAPABILITY_HOOK_EVENT_TYPES, 'download.secret.internal'],
    }),
    /Unsupported CapabilityHook eventType/u,
  );
  assert.throws(
    () => assertSchemaCompatible('CapabilityHookEventTypeRegistry', {
      ...current,
      eventTypes: CAPABILITY_HOOK_EVENT_TYPES.slice(1),
    }),
    /must match current runtime producer inventory/u,
  );
  assert.throws(
    () => assertSchemaCompatible('CapabilityHookEventTypeRegistry', {
      ...current,
      eventTypes: [...CAPABILITY_HOOK_EVENT_TYPES].reverse(),
    }),
    /must match current runtime producer inventory/u,
  );
});

test('compatibility registry rejects CapabilityHook producer descriptor inventory drift centrally', () => {
  const current = createCapabilityHookProducerDescriptorRegistry();
  assert.equal(assertSchemaCompatible('CapabilityHookProducerDescriptorRegistry', current), true);

  assert.throws(
    () => assertSchemaCompatible('CapabilityHookProducerDescriptorRegistry', {
      ...current,
      producers: current.producers.filter((producer) => producer.eventType !== 'download.run.terminal'),
    }),
    /must include high-risk producer descriptor: download\.run\.terminal/u,
  );
  assert.throws(
    () => assertSchemaCompatible('CapabilityHookProducerDescriptorRegistry', {
      ...current,
      producers: [
        ...current.producers,
        {
          ...current.producers[0],
          producerId: 'duplicate-session-runner',
        },
      ],
    }),
    /Duplicate CapabilityHook producer descriptor eventType: session\.run\.completed/u,
  );
  assert.throws(
    () => assertSchemaCompatible('CapabilityHookProducerDescriptorRegistry', {
      ...current,
      descriptorPolicy: {
        ...CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_POLICY,
        rawSessionPayloadsAllowed: true,
      },
    }),
    /descriptor-only and fail closed/u,
  );
  assert.throws(
    () => assertSchemaCompatible('CapabilityHookProducerDescriptorRegistry', {
      ...current,
      producers: current.producers.map((producer) => (
        producer.eventType === 'social.action.risk_blocked'
          ? { ...producer, browserProfilePath: 'synthetic-profile-path' }
          : producer
      )),
    }),
    /raw sensitive material field/u,
  );
});

test('compatibility registry rejects invalid ArtifactReferenceSet payloads centrally', () => {
  assert.equal(assertSchemaCompatible('ArtifactReferenceSet', normalizeArtifactReferenceSet({
    manifest: 'runs/synthetic/manifest.json',
  })), true);
  assert.throws(
    () => assertSchemaCompatible('ArtifactReferenceSet', {
      schemaVersion: 1,
      manifest: ['runs/synthetic/manifest.json'],
    }),
    /artifacts\.manifest must be a string artifact reference/u,
  );
  assert.throws(
    () => assertSchemaCompatible('ArtifactReferenceSet', {
      schemaVersion: 1,
      source: {
        diagnostic: 123,
      },
    }),
    /artifacts\.source\.diagnostic must be a string artifact reference/u,
  );
});

test('compatibility registry rejects unknown schemas and incompatible versions', () => {
  assert.throws(
    () => assertSchemaCompatible('UnknownSchema', { schemaVersion: 1 }),
    /Unknown compatibility schema/u,
  );
  assert.throws(
    () => assertSchemaCompatible('', { schemaVersion: 1 }),
    /Unknown compatibility schema/u,
  );

  for (const schema of listCompatibilitySchemas()) {
    assert.throws(
      () => assertSchemaCompatible(schema.name, { schemaVersion: schema.version + 1 }),
      /not compatible/u,
    );
    assert.throws(
      () => assertSchemaCompatible(schema.name, {}),
      /schemaVersion is required/u,
    );
  }
});

test('compatibility registry metadata matches schema inventory for core schemas', () => {
  assert.deepEqual(listMissingSchemas(), []);
  for (const schemaName of REGISTERED_SCHEMA_NAMES) {
    const registryEntry = getCompatibilitySchema(schemaName);
    const inventoryEntry = getSchemaInventoryEntry(schemaName);
    assert.notEqual(registryEntry, null);
    assert.notEqual(inventoryEntry, null);
    assert.equal(registryEntry.version, inventoryEntry.version);
    assert.equal(registryEntry.sourcePath, inventoryEntry.sourcePath);
    assert.notEqual(inventoryEntry.status, 'missing');
  }
});
