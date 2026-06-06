import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLANNER_SELECTED_ROUTE_SOURCE,
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
  SITE_CAPABILITY_PLANNER_VERSION,
  assertCapabilityPlanCompatible,
  assertNoPlannerSensitiveMaterial,
  assertPlanArtifactCompatible,
  assertPlanContextCompatible,
  assertPlanManifestCompatible,
  assertPlanRequestCompatible,
  assertPlannerCompatibilityDeclarationCompatible,
  assertPlannerConfigCompatible,
  createPlannerCompatibilityDeclaration,
  listSiteCapabilityPlannerSchemaDefinitions,
} from '../../../src/app/planner/index.mjs';

const REQUIRED_SCHEMA_NAMES = [
  'PlannerConfig',
  'PlanRequest',
  'PlanContext',
  'PlanContextCapabilityState',
  'PlanContextSessionState',
  'PlanContextRiskState',
  'CapabilityPlan',
  'PlanStep',
  'PlanDecision',
  'PlanRequirementSummary',
  'PlanRiskSummary',
  'PlanFailure',
  'PlanArtifact',
  'PlanManifest',
  'PlannerGraphSource',
  'PlannerRouteResolution',
  'PlannerContextCheck',
  'PlannerFallbackDecision',
  'PlannerReasonCode',
  'PlannerArtifactWriteResult',
  'PlannerLifecycleEvent',
  'PlannerDryRunResult',
  'PlannerLayerHandoffDescriptor',
  'PlannerCompatibilityDeclaration',
];

function createPlanRequest(overrides = /** @type {any} */ ({})) {
  return {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    taskId: 'task:synthetic-planner-1',
    site: 'example.test',
    normalizedIntent: 'download-content',
    mode: 'dry_run',
    correlationId: 'correlation:synthetic-planner-1',
    ...overrides,
  };
}

function createPlanContext(overrides = /** @type {any} */ ({})) {
  return {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    capabilityState: {
      schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
      agentExposed: true,
    },
    sessionState: {
      schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
      status: 'not_required',
    },
    riskState: {
      schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
      level: 'low',
      allowed: true,
    },
    graphCompatibility: {
      validated: true,
      graphVersion: '1.0.0',
    },
    layerCompatibility: {
      compatible: true,
      layerCompatibilityVersion: '1.0.0',
    },
    ...overrides,
  };
}

function createCapabilityPlan(overrides = /** @type {any} */ ({})) {
  return {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    plannerVersion: SITE_CAPABILITY_PLANNER_VERSION,
    graphVersion: '1.0.0',
    layerCompatibilityVersion: '1.0.0',
    planStatus: 'ready',
    siteId: 'site:example.test',
    normalizedIntent: 'download-content',
    capabilityId: 'capability:example.download-content',
    capabilityMode: 'readOnly',
    selectedRoute: {
      routeId: 'route:example.download-content.public',
      source: PLANNER_SELECTED_ROUTE_SOURCE,
      priority: 10,
    },
    requirements: {
      auth: 'optional',
      session: 'minimal-session-view-only',
      signer: 'not_required',
      approval: 'not_required',
    },
    riskSummary: {
      allowed: true,
      riskGates: ['risk:rate-limit'],
    },
    decisions: [
      {
        decision: 'selected',
        reason: 'highest_priority_safe_route',
      },
    ],
    steps: [
      {
        stepId: 'step:plan-only',
        type: 'layer_handoff_descriptor',
        executable: false,
      },
    ],
    fallbacks: [
      {
        routeId: 'route:example.metadata-only',
        source: PLANNER_SELECTED_ROUTE_SOURCE,
        reason: 'degrade_to_metadata_only',
      },
    ],
    expectedArtifacts: [
      {
        type: 'PLAN_MANIFEST',
        redactionRequired: true,
      },
    ],
    redactionRequired: true,
    ...overrides,
  };
}

test('Planner schema definitions are versioned and cover required contracts', () => {
  const definitions = listSiteCapabilityPlannerSchemaDefinitions();
  const byName = new Map(definitions.map((entry) => [entry.name, entry]));

  for (const name of REQUIRED_SCHEMA_NAMES) {
    const entry = byName.get(name);
    assert.notEqual(entry, undefined, `${name} schema should be listed`);
    assert.equal(entry.version, SITE_CAPABILITY_PLANNER_SCHEMA_VERSION);
    assert.equal(entry.sourcePath, 'src/app/planner/schema.mjs');
  }
});

test('PlanRequest and PlanContext accept minimal descriptor-only planning input', () => {
  assert.equal(assertPlannerConfigCompatible({
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    defaultMode: 'dry_run',
  }), true);
  assert.equal(assertPlanRequestCompatible(createPlanRequest()), true);
  assert.equal(assertPlanRequestCompatible(createPlanRequest({
    normalizedIntent: undefined,
    intentInput: {
      text: 'synthetic task description',
    },
  })), true);
  assert.equal(assertPlanContextCompatible(createPlanContext()), true);
});

test('PlanRequest rejects missing site and unresolved intent', () => {
  assert.throws(
    () => assertPlanRequestCompatible(createPlanRequest({
      site: undefined,
      url: undefined,
    })),
    /site or url/u,
  );
  assert.throws(
    () => assertPlanRequestCompatible(createPlanRequest({
      normalizedIntent: undefined,
      intentInput: undefined,
    })),
    /normalizedIntent or intentInput/u,
  );
});

test('Planner validators reject raw sensitive fields and values without echoing secret values', () => {
  assert.throws(
    () => assertPlanContextCompatible(createPlanContext({
      cookie: 'SESSDATA=synthetic-secret-value',
    })),
    (error) => {
      // @ts-ignore
      assert.equal(error.code, 'planner.sensitive_material_forbidden');
      // @ts-ignore
      assert.doesNotMatch(error.message, /synthetic-secret-value/u);
      return true;
    },
  );

  assert.throws(
    () => assertNoPlannerSensitiveMaterial({
      evidence: 'https://example.test/?access_token=synthetic-secret-value',
    }),
    (error) => {
      // @ts-ignore
      assert.equal(error.code, 'planner.sensitive_material_forbidden');
      // @ts-ignore
      assert.doesNotMatch(error.message, /synthetic-secret-value/u);
      return true;
    },
  );

  assert.throws(
    () => assertPlanRequestCompatible(createPlanRequest({
      browserProfilePath: 'C:/Users/example/profile',
    })),
    /forbidden sensitive or runtime fields/u,
  );
  assert.throws(
    () => assertPlanContextCompatible(createPlanContext({
      headers: {
        'x-synthetic': 'value',
      },
    })),
    /forbidden sensitive or runtime fields/u,
  );
  assert.throws(
    () => assertPlanContextCompatible(createPlanContext({
      storageState: {
        cookies: [],
      },
    })),
    /forbidden sensitive or runtime fields/u,
  );
  assert.throws(
    () => assertPlanContextCompatible(createPlanContext({
      credentialRef: 'credential:synthetic',
    })),
    /forbidden sensitive or runtime fields/u,
  );
});

test('CapabilityPlan accepts a minimal plan with Graph-sourced route and redaction-required artifacts', () => {
  const plan = createCapabilityPlan();

  assert.equal(assertCapabilityPlanCompatible(plan), true);
});

test('Planner validators allow structured execution descriptors but reject raw runtime material', () => {
  const structuredPlan = createCapabilityPlan({
    executionContractRef: 'execution-contract:example:download-invoice',
    requestSchemaRef: 'schema:example:download-invoice:request',
    runtimeBindingRef: 'runtime-binding:example:download-invoice',
    sessionRequirementRef: 'session-requirement:example:authenticated',
    payloadTemplate: {
      csrfToken: '{{runtime.secret.csrf}}',
      orderId: {
        type: 'string',
        source: 'slot:order-id',
        persisted: false,
      },
    },
    headerSchema: {
      Authorization: {
        type: 'string',
        source: 'runtime_secret_placeholder',
      },
      Cookie: {
        type: 'string',
        source: 'runtime_secret_placeholder',
      },
    },
    downloaderTaskDescriptor: {
      taskKind: 'download',
      outputPathConstraint: {
        type: 'workspace_relative',
        value: '{{slot:outputPath}}',
      },
    },
  });

  assert.equal(assertCapabilityPlanCompatible(structuredPlan), true);

  const rejectedDescriptors = [
    {
      name: 'raw authorization header value',
      value: {
        headerSchema: {
          Authorization: {
            value: 'Bearer synthetic-secret-value',
          },
        },
      },
    },
    {
      name: 'raw downloader task',
      value: {
        downloaderTask: {
          id: 'task:synthetic',
        },
      },
    },
    {
      name: 'local profile path',
      value: {
        payloadTemplate: {
          profilePath: 'C:/Users/example/AppData/Local/BrowserProfile',
        },
      },
    },
    {
      name: 'function value',
      value: {
        payloadTemplate: {
          transform: () => 'unsafe',
        },
      },
    },
    {
      name: 'dynamic import code string',
      value: {
        downloaderTaskDescriptor: {
          loader: 'import("unsafe-adapter")',
        },
      },
    },
    {
      name: 'unsafe credential ref',
      value: {
        executionContractRef: 'execution-contract:example:credential',
      },
    },
  ];

  for (const { name, value } of rejectedDescriptors) {
    assert.throws(
      () => assertNoPlannerSensitiveMaterial(value),
      (error) => {
        // @ts-ignore
        assert.equal(error.code, 'planner.sensitive_material_forbidden');
        // @ts-ignore
        assert.doesNotMatch(error.message, /synthetic-secret-value|BrowserProfile|unsafe-adapter/u);
        return true;
      },
      `${name} should be rejected`,
    );
  }
});

test('CapabilityPlan requires version fields and Graph-sourced selectedRoute', () => {
  assert.throws(
    () => assertCapabilityPlanCompatible(createCapabilityPlan({
      plannerVersion: undefined,
    })),
    /plannerVersion is required/u,
  );
  assert.throws(
    () => assertCapabilityPlanCompatible(createCapabilityPlan({
      graphVersion: undefined,
    })),
    /graphVersion is required/u,
  );
  assert.throws(
    () => assertCapabilityPlanCompatible(createCapabilityPlan({
      selectedRoute: {
        routeId: 'route:example.download-content.public',
      },
    })),
    /source must be site-capability-graph/u,
  );
  assert.throws(
    () => assertCapabilityPlanCompatible(createCapabilityPlan({
      selectedRoute: {
        routeId: 'route:example.download-content.public',
        source: 'observed-api-candidate',
      },
    })),
    /source must be site-capability-graph/u,
  );
});

test('CapabilityPlan rejects fallback routes that do not explicitly come from Graph', () => {
  assert.throws(
    () => assertCapabilityPlanCompatible(createCapabilityPlan({
      fallbacks: [
        {
          routeId: 'route:example.fallback',
          source: 'planner-invented',
        },
      ],
    })),
    /fallbackRoute source must be site-capability-graph/u,
  );
});

test('CapabilityPlan requires redaction-required planner-derived artifacts', () => {
  assert.throws(
    () => assertCapabilityPlanCompatible(createCapabilityPlan({
      redactionRequired: false,
    })),
    /CapabilityPlan redactionRequired must be true/u,
  );
  assert.throws(
    () => assertCapabilityPlanCompatible(createCapabilityPlan({
      expectedArtifacts: [
        {
          type: 'PLAN_MANIFEST',
          redactionRequired: false,
        },
      ],
    })),
    /expectedArtifacts redactionRequired must be true/u,
  );
  assert.equal(assertPlanArtifactCompatible({
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    type: 'PLAN_MANIFEST',
    redactionRequired: true,
  }), true);
  assert.throws(
    () => assertPlanArtifactCompatible({
      schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
      type: 'PLAN_MANIFEST',
      redactionRequired: false,
    }),
    /PlanArtifact redactionRequired must be true/u,
  );
});

test('PlanManifest validates only redaction-required plan artifacts', () => {
  assert.equal(assertPlanManifestCompatible({
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    redactionRequired: true,
    artifacts: [
      {
        schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
        type: 'PLAN_MANIFEST',
        redactionRequired: true,
      },
    ],
  }), true);
  assert.throws(
    () => assertPlanManifestCompatible({
      schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
      redactionRequired: true,
      artifacts: [
        {
          schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
          type: 'PLAN_MANIFEST',
          redactionRequired: false,
        },
      ],
    }),
    /PlanArtifact redactionRequired must be true/u,
  );
});

test('CapabilityPlan rejects runtime execution products and non-readOnly plans without approval', () => {
  assert.throws(
    () => assertCapabilityPlanCompatible(createCapabilityPlan({
      standardTaskList: {
        schemaVersion: 1,
        items: [],
      },
    })),
    /forbidden sensitive or runtime fields/u,
  );
  assert.throws(
    () => assertCapabilityPlanCompatible(createCapabilityPlan({
      siteAdapterDecision: {
        pageType: 'synthetic',
      },
    })),
    /forbidden sensitive or runtime fields/u,
  );
  assert.throws(
    () => assertCapabilityPlanCompatible(createCapabilityPlan({
      downloaderTask: {
        id: 'task:synthetic-downloader',
      },
    })),
    /forbidden sensitive or runtime fields/u,
  );
  assert.throws(
    () => assertCapabilityPlanCompatible(createCapabilityPlan({
      capabilityMode: 'write',
      requirements: {
        auth: 'required',
        session: 'minimal-session-view-only',
        signer: 'required',
      },
    })),
    /requires approval requirement/u,
  );
  assert.equal(assertCapabilityPlanCompatible(createCapabilityPlan({
    capabilityMode: 'write',
    requirements: {
      auth: 'required',
      session: 'minimal-session-view-only',
      signer: 'required',
      approval: 'required',
    },
  })), true);
});

test('Planner compatibility declaration is versioned and fail-closed', () => {
  const declaration = createPlannerCompatibilityDeclaration({
    graphSchemaVersion: 1,
    graphVersion: '1.0.0',
    layerCompatibilityVersion: '1.0.0',
  });

  assert.equal(assertPlannerCompatibilityDeclarationCompatible(declaration), true);
  assert.throws(
    () => assertPlannerCompatibilityDeclarationCompatible({
      ...declaration,
      schemaVersion: '2.0.0',
    }),
    /schemaVersion is not compatible/u,
  );
  assert.throws(
    () => assertPlannerCompatibilityDeclarationCompatible({
      ...declaration,
      compatiblePlannerSchemaVersions: ['0.9.0'],
    }),
    /compatiblePlannerSchemaVersions must include current schema/u,
  );
});
