import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
  SITE_CAPABILITY_COMPILER_VERSION,
  assertCompilerCompatibilityDeclarationCompatible,
  assertNoCompilerSensitiveMaterial,
  assertSiteCompileManifestCompatible,
  assertSiteCompileRequestCompatible,
  assertSiteCompileScopeCompatible,
  createCompilerCompatibilityDeclaration,
  listSiteCapabilityCompilerSchemaDefinitions,
} from '../../../src/app/compiler/index.mjs';

const REQUIRED_SCHEMA_NAMES = [
  'SiteCompileRequest',
  'SiteCompileScope',
  'SiteCompileManifest',
  'SiteCompileSourceRef',
  'CapabilityIntake',
  'CapabilityIntakeQuestionnaire',
  'CapabilityCoverageSummary',
  'NodeInventory',
  'CapabilityInventory',
  'ExecutionPathInventory',
  'FunctionPathTrace',
  'RequirementInventory',
  'CompileCoverageReport',
  'UnknownNodeReport',
  'CapabilityGraphDraft',
  'GraphBuildManifest',
  'ExecutionManifest',
  'CompilerCompatibilityDeclaration',
];

const SYNTHETIC_DIGEST_A = `sha256:${'a'.repeat(64)}`;
const SYNTHETIC_DIGEST_B = `sha256:${'b'.repeat(64)}`;

function createCompileScope(overrides = {}) {
  return {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    coverageMode: 'hybrid',
    coverageCompleteness: 'partial',
    allowedCaptureModes: [
      'static',
      'adapter_metadata',
      'redacted_artifact_replay',
    ],
    sourceTypes: [
      'site-registry',
      'site-capabilities',
      'adapter-metadata',
    ],
    redactionRequired: true,
    ...overrides,
  };
}

function createCompileRequest(overrides = {}) {
  return {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    siteId: 'site:example.test',
    siteKey: 'example',
    url: 'https://example.test/catalog',
    compileScope: createCompileScope(),
    sourceTypes: [
      'site-registry',
      'site-capabilities',
      'adapter-metadata',
    ],
    redactionRequired: true,
    ...overrides,
  };
}

function createCapabilityIntake(overrides = {}) {
  return {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    intakeMode: 'user_requested',
    inquiryRequired: false,
    requestedCapabilities: ['open-page'],
    candidateCapabilities: ['open-page', 'download-content'],
    unconfirmedCapabilities: ['download-content'],
    unconfirmedCapabilityPolicy: 'best_effort_full_coverage',
    targetedCaptureStrategy: 'requested_first_then_best_effort_unconfirmed',
    redactionRequired: true,
    ...overrides,
  };
}

function createCompileManifest(overrides = {}) {
  return {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    compilerVersion: SITE_CAPABILITY_COMPILER_VERSION,
    siteId: 'site:example.test',
    compileScope: createCompileScope(),
    sourceRefs: [
      {
        type: 'site-registry',
        ref: 'config/site-registry.json#example',
        digestAlgorithm: 'sha256',
        digest: SYNTHETIC_DIGEST_A,
        sourceDigest: SYNTHETIC_DIGEST_A,
        redactionRequired: true,
      },
      {
        type: 'site-capabilities',
        ref: 'config/site-capabilities.json#example',
        digestAlgorithm: 'sha256',
        digest: SYNTHETIC_DIGEST_A,
        sourceDigest: SYNTHETIC_DIGEST_A,
        redactionRequired: true,
      },
    ],
    sourceDigest: SYNTHETIC_DIGEST_A,
    manifestDigest: SYNTHETIC_DIGEST_B,
    incrementalCompile: {
      sourceDigest: SYNTHETIC_DIGEST_A,
      previousSourceDigest: null,
      changed: true,
      unchanged: false,
      changedSourceRefs: ['config/site-registry.json#example', 'config/site-capabilities.json#example'],
    },
    inventories: {
      nodes: [],
      capabilities: [],
      executionPaths: [],
      requirements: [],
    },
    coverageReport: {
      coverageCompleteness: 'partial',
      unknownNodeCount: 0,
      blockedReasonCodes: [],
      capabilityCoverageSummary: {
        schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
        requestedCapabilities: ['open-page'],
        unconfirmedCapabilities: ['download-content'],
        targetedCapabilityCount: 1,
        bestEffortUnconfirmedCount: 1,
        unconfirmedCapabilityPolicy: 'best_effort_full_coverage',
        redactionRequired: true,
      },
    },
    redactionRequired: true,
    ...overrides,
  };
}

test('Compiler schema definitions are versioned and list required contracts', () => {
  const definitions = listSiteCapabilityCompilerSchemaDefinitions();
  const byName = new Map(definitions.map((entry) => [entry.name, entry]));

  for (const name of REQUIRED_SCHEMA_NAMES) {
    const entry = byName.get(name);
    assert.notEqual(entry, undefined, `${name} schema should be listed`);
    assert.equal(entry.version, SITE_CAPABILITY_COMPILER_SCHEMA_VERSION);
    assert.equal(entry.sourcePath, 'src/app/compiler/schema.mjs');
  }
});

test('SiteCompileRequest and SiteCompileScope accept minimal descriptor-only input', () => {
  assert.equal(assertSiteCompileScopeCompatible(createCompileScope()), true);
  assert.equal(assertSiteCompileRequestCompatible(createCompileRequest()), true);
  assert.equal(assertSiteCompileRequestCompatible(createCompileRequest({
    capabilityIntake: createCapabilityIntake(),
  })), true);
  assert.equal(assertSiteCompileRequestCompatible(createCompileRequest({
    siteId: undefined,
    siteKey: undefined,
  })), true);
});

test('CapabilityIntake supports targeted requested capabilities and rejects unsafe inputs', () => {
  assert.equal(assertSiteCompileRequestCompatible(createCompileRequest({
    capabilityIntake: createCapabilityIntake({
      requestedCapabilities: ['open-page', 'download-content'],
      unconfirmedCapabilities: [],
    }),
  })), true);

  assert.throws(
    () => assertSiteCompileRequestCompatible(createCompileRequest({
      capabilityIntake: createCapabilityIntake({
        requestedCapabilities: ['https://example.test/public/path'],
      }),
    })),
    (error) => error.code === 'compiler.capability_intake_invalid',
  );

  assert.throws(
    () => assertSiteCompileRequestCompatible(createCompileRequest({
      capabilityIntake: createCapabilityIntake({
        browserProfilePath: 'C:/Users/example/profile',
      }),
    })),
    (error) => error.code === 'compiler.raw_sensitive_material_rejected',
  );

  assert.throws(
    () => assertSiteCompileRequestCompatible(createCompileRequest({
      capabilityIntake: createCapabilityIntake({
        redactionRequired: false,
      }),
    })),
    /CapabilityIntake redactionRequired must be true/u,
  );
});

test('SiteCompileRequest and SiteCompileScope reject invalid scope semantics', () => {
  assert.throws(
    () => assertSiteCompileScopeCompatible(createCompileScope({
      schemaVersion: '2.0.0',
    })),
    /schemaVersion is not compatible/u,
  );
  assert.throws(
    () => assertSiteCompileRequestCompatible(createCompileRequest({
      siteId: undefined,
      siteKey: undefined,
      url: undefined,
    })),
    /siteId, siteKey, or url/u,
  );
  assert.throws(
    () => assertSiteCompileScopeCompatible(createCompileScope({
      coverageMode: 'unbounded_full_site',
    })),
    /coverageMode is unsupported/u,
  );
  assert.throws(
    () => assertSiteCompileScopeCompatible(createCompileScope({
      allowedCaptureModes: ['captcha_bypass_capture'],
    })),
    /forbidden sensitive or runtime fields|unsupported value/u,
  );
});

test('Compiler validators reject raw sensitive fields and values without echoing secrets', () => {
  assert.throws(
    () => assertSiteCompileRequestCompatible(createCompileRequest({
      cookie: 'SESSDATA=synthetic-secret-value',
    })),
    (error) => {
      assert.equal(error.code, 'compiler.raw_sensitive_material_rejected');
      assert.doesNotMatch(error.message, /synthetic-secret-value/u);
      return true;
    },
  );

  assert.throws(
    () => assertNoCompilerSensitiveMaterial({
      evidence: 'https://example.test/?access_token=synthetic-secret-value',
    }),
    (error) => {
      assert.equal(error.code, 'compiler.raw_sensitive_material_rejected');
      assert.doesNotMatch(error.message, /synthetic-secret-value/u);
      return true;
    },
  );

  assert.throws(
    () => assertSiteCompileManifestCompatible(createCompileManifest({
      browserProfilePath: 'C:/Users/example/profile',
    })),
    /forbidden sensitive or runtime fields/u,
  );
  assert.throws(
    () => assertSiteCompileManifestCompatible(createCompileManifest({
      sourceRefs: [
        {
          type: 'redacted-artifact',
          ref: 'runs/synthetic/manifest.json',
          digestAlgorithm: 'sha256',
          digest: SYNTHETIC_DIGEST_A,
          sourceDigest: SYNTHETIC_DIGEST_A,
          requestHeaders: {
            'x-synthetic': 'value',
          },
          redactionRequired: true,
        },
      ],
    })),
    /forbidden sensitive or runtime fields/u,
  );
  assert.throws(
    () => assertSiteCompileRequestCompatible(createCompileRequest({
      storageState: {
        cookies: [],
      },
    })),
    /forbidden sensitive or runtime fields/u,
  );

  const rejectedFields = [
    ['Authorization', 'Bearer synthetic-secret-value'],
    ['refreshToken', 'synthetic-secret-value'],
    ['sessionId', 'synthetic-secret-value'],
    ['accountId', 'synthetic-account'],
    ['deviceFingerprint', 'synthetic-device'],
    ['ipAddress', '192.0.2.10'],
    ['sessionView', { status: 'synthetic' }],
    ['standardTaskList', { items: [] }],
    ['downloaderTask', { id: 'task:synthetic' }],
    ['handler', 'synthetic-handler'],
    ['execute', true],
    ['browserContext', { id: 'context:synthetic' }],
  ];

  for (const [fieldName, fieldValue] of rejectedFields) {
    assert.throws(
      () => assertNoCompilerSensitiveMaterial({
        [fieldName]: fieldValue,
      }),
      (error) => {
        assert.equal(error.code, 'compiler.raw_sensitive_material_rejected');
        assert.doesNotMatch(error.message, /synthetic-secret-value|192\.0\.2\.10/u);
        return true;
      },
      `${fieldName} should be rejected`,
    );
  }
});

test('Compiler validators reject unsafe source and evidence refs', () => {
  const unsafeSourceRefs = [
    'https://example.test/public/manifest.json',
    'runs/synthetic/manifest.json',
    'C:/Users/example/manifest.json',
    'artifact:layer-summary?access_token=synthetic',
    'artifact:user@example.test',
    'artifact:192.0.2.44',
    'artifact:run-handler.mjs',
  ];

  for (const unsafeRef of unsafeSourceRefs) {
    assert.throws(
      () => assertSiteCompileManifestCompatible(createCompileManifest({
        sourceRefs: [
          {
            type: 'redacted-artifact',
            ref: unsafeRef,
            digestAlgorithm: 'sha256',
            digest: SYNTHETIC_DIGEST_A,
            sourceDigest: SYNTHETIC_DIGEST_A,
            redactionRequired: true,
          },
        ],
      })),
      (error) => {
        assert.equal(error.code, 'compiler.raw_sensitive_material_rejected');
        assert.doesNotMatch(error.message, /access_token|example\.test|192\.0\.2\.44/u);
        return true;
      },
      `${unsafeRef} should be rejected`,
    );
  }

  assert.throws(
    () => assertSiteCompileManifestCompatible(createCompileManifest({
      coverageReport: {
        coverageCompleteness: 'partial',
        unknownNodeCount: 0,
        blockedReasonCodes: [],
        evidenceRefs: ['https://example.test/api/catalog'],
        capabilityCoverageSummary: {
          schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
          requestedCapabilities: ['open-page'],
          unconfirmedCapabilities: ['download-content'],
          targetedCapabilityCount: 1,
          bestEffortUnconfirmedCount: 1,
          unconfirmedCapabilityPolicy: 'best_effort_full_coverage',
          redactionRequired: true,
        },
      },
    })),
    (error) => error.code === 'compiler.raw_sensitive_material_rejected',
  );
});

test('SiteCompileManifest requires versions, source refs, inventories, coverage, and redaction', () => {
  assert.equal(assertSiteCompileManifestCompatible(createCompileManifest()), true);

  assert.throws(
    () => assertSiteCompileManifestCompatible(createCompileManifest({
      compilerVersion: undefined,
    })),
    /compilerVersion is required/u,
  );
  assert.throws(
    () => assertSiteCompileManifestCompatible(createCompileManifest({
      sourceRefs: [],
    })),
    /sourceRefs are required/u,
  );
  assert.throws(
    () => assertSiteCompileManifestCompatible(createCompileManifest({
      inventories: {
        nodes: [],
        capabilities: [],
        executionPaths: [],
      },
    })),
    /inventories.requirements must be an array/u,
  );
  assert.throws(
    () => assertSiteCompileManifestCompatible(createCompileManifest({
      coverageReport: {
        coverageCompleteness: 'partial',
        unknownNodeCount: -1,
        blockedReasonCodes: [],
      },
    })),
    /unknownNodeCount must be a non-negative integer/u,
  );
  assert.throws(
    () => assertSiteCompileManifestCompatible(createCompileManifest({
      coverageReport: {
        coverageCompleteness: 'partial',
        unknownNodeCount: 0,
        blockedReasonCodes: [],
        capabilityCoverageSummary: {
          schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
          requestedCapabilities: ['open-page'],
          unconfirmedCapabilities: ['download-content'],
          targetedCapabilityCount: -1,
          bestEffortUnconfirmedCount: 1,
          unconfirmedCapabilityPolicy: 'best_effort_full_coverage',
          redactionRequired: true,
        },
      },
    })),
    /targetedCapabilityCount must be a non-negative integer/u,
  );
  assert.throws(
    () => assertSiteCompileManifestCompatible(createCompileManifest({
      coverageReport: {
        coverageCompleteness: 'partial',
        unknownNodeCount: 1,
        blockedReasonCodes: ['compiler.coverage_incomplete'],
        capabilityCoverageSummary: {
          schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
          requestedCapabilities: ['download-content'],
          missingRequestedCapabilities: ['download-content'],
          missingRequestedCapabilityCount: 0,
          targetedCapabilityCount: 0,
          bestEffortUnconfirmedCount: 0,
          capabilityGapStatus: 'clear',
          unconfirmedCapabilityPolicy: 'best_effort_full_coverage',
          redactionRequired: true,
        },
      },
    })),
    /missingRequestedCapabilityCount must match/u,
  );
});

test('Compiler-derived artifacts must declare redactionRequired true', () => {
  assert.throws(
    () => assertSiteCompileRequestCompatible(createCompileRequest({
      redactionRequired: false,
    })),
    /SiteCompileRequest redactionRequired must be true/u,
  );
  assert.throws(
    () => assertSiteCompileScopeCompatible(createCompileScope({
      redactionRequired: false,
    })),
    /SiteCompileScope redactionRequired must be true/u,
  );
  assert.throws(
    () => assertSiteCompileManifestCompatible(createCompileManifest({
      redactionRequired: false,
    })),
    /SiteCompileManifest redactionRequired must be true/u,
  );
  assert.throws(
    () => assertSiteCompileManifestCompatible(createCompileManifest({
      sourceRefs: [
        {
          type: 'site-registry',
          ref: 'config/site-registry.json#example',
          digestAlgorithm: 'sha256',
          digest: SYNTHETIC_DIGEST_A,
          sourceDigest: SYNTHETIC_DIGEST_A,
          redactionRequired: false,
        },
      ],
    })),
    /SiteCompileSourceRef redactionRequired must be true/u,
  );
});

test('SiteCompileManifest rejects missing or inconsistent digest governance', () => {
  assert.throws(
    () => assertSiteCompileManifestCompatible(createCompileManifest({
      sourceDigest: undefined,
    })),
    /sourceDigest is required/u,
  );
  assert.throws(
    () => assertSiteCompileManifestCompatible(createCompileManifest({
      manifestDigest: 'not-a-digest',
    })),
    /manifestDigest must be a sha256 digest/u,
  );
  assert.throws(
    () => assertSiteCompileManifestCompatible(createCompileManifest({
      sourceRefs: [
        {
          type: 'site-registry',
          ref: 'config/site-registry.json#example',
          digestAlgorithm: 'sha256',
          digest: SYNTHETIC_DIGEST_A,
          redactionRequired: true,
        },
      ],
    })),
    /sourceDigest is required/u,
  );
  assert.throws(
    () => assertSiteCompileManifestCompatible(createCompileManifest({
      incrementalCompile: {
        sourceDigest: SYNTHETIC_DIGEST_B,
        previousSourceDigest: null,
        changed: true,
        unchanged: false,
        changedSourceRefs: [],
      },
    })),
    /must match SiteCompileManifest sourceDigest/u,
  );
});

test('Compiler compatibility declaration is versioned and fail-closed', () => {
  const declaration = createCompilerCompatibilityDeclaration({
    graphSchemaVersion: 1,
    graphVersion: '1.0.0',
    plannerCompatibilityVersion: '1.0.0',
    layerCompatibilityVersion: '1.0.0',
  });

  assert.equal(assertCompilerCompatibilityDeclarationCompatible(declaration), true);
  assert.throws(
    () => assertCompilerCompatibilityDeclarationCompatible({
      ...declaration,
      schemaVersion: '2.0.0',
    }),
    /schemaVersion is not compatible/u,
  );
  assert.throws(
    () => assertCompilerCompatibilityDeclarationCompatible({
      ...declaration,
      compatibleCompilerSchemaVersions: ['0.9.0'],
    }),
    /compatibleCompilerSchemaVersions must include current schema/u,
  );
});
