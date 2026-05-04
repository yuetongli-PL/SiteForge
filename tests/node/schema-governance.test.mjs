import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RISK_STATE_SCHEMA_VERSION } from '../../src/sites/capability/risk-state.mjs';
import { SESSION_VIEW_SCHEMA_VERSION } from '../../src/sites/capability/session-view.mjs';
import { DOWNLOAD_POLICY_SCHEMA_VERSION } from '../../src/sites/capability/download-policy.mjs';
import { LIFECYCLE_EVENT_SCHEMA_VERSION } from '../../src/sites/capability/lifecycle-events.mjs';
import { STANDARD_TASK_LIST_SCHEMA_VERSION } from '../../src/sites/capability/standard-task-list.mjs';
import {
  API_CANDIDATE_SCHEMA_VERSION,
  API_CATALOG_INDEX_SCHEMA_VERSION,
  API_CATALOG_SCHEMA_VERSION,
  API_CATALOG_ENTRY_SCHEMA_VERSION,
  API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION,
  SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION,
  SITE_ADAPTER_CATALOG_UPGRADE_POLICY_SCHEMA_VERSION,
} from '../../src/sites/capability/api-candidates.mjs';
import {
  REASON_CODE_SCHEMA_VERSION,
  listReasonCodeDefinitions,
} from '../../src/sites/capability/reason-codes.mjs';
import {
  createCapabilityHookEventTypeRegistry,
} from '../../src/sites/capability/capability-hook.mjs';
import {
  SCHEMA_GOVERNANCE_SCHEMA_VERSION,
  assertCapabilityServicesRuntimeReady,
  assertDesignSchemaFamilyGoverned,
  assertGovernedSchemaCompatible,
  assertRuntimeVersionFamilyCompatible,
  assertRuntimeVersionFamilyReady,
  getGovernedSchema,
  listCapabilityServiceRuntimeRegistry,
  listDesignSchemaFamilies,
  listGovernedSchemas,
  listRuntimeVersionFamilies,
} from '../../src/sites/capability/schema-governance.mjs';
import { listSchemaInventory } from '../../src/sites/capability/schema-inventory.mjs';
import {
  KERNEL_SCHEMA_GOVERNANCE_ENTRYPOINT,
  assertKernelDesignSchemaFamilyGoverned,
  assertKernelGovernedSchemaCompatible,
  getKernelGovernedSchema,
  listKernelGovernedSchemas,
  listKernelSchemaFamilies,
} from '../../src/kernel/site-capability-schema-governance.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function compatibleKernelPayload(schemaName) {
  const schema = getKernelGovernedSchema(schemaName);
  assert.notEqual(schema, null);
  if (schemaName === 'reasonCode') {
    return {
      schemaVersion: schema.version,
      entries: listReasonCodeDefinitions(),
    };
  }
  if (schemaName === 'ArtifactReferenceSet') {
    return {
      schemaVersion: schema.version,
      manifest: 'runs/kernel/schema-governance/manifest.json',
    };
  }
  if (schemaName === 'CapabilityHookEventTypeRegistry') {
    return createCapabilityHookEventTypeRegistry();
  }
  if (schemaName === 'CapabilityHookRegistrySnapshot') {
    return {
      schemaVersion: schema.version,
      hooks: [],
    };
  }
  return {
    schemaVersion: schema.version,
  };
}

test('Kernel-owned schema governance entrypoint covers Section 11 design families', () => {
  assert.deepEqual(KERNEL_SCHEMA_GOVERNANCE_ENTRYPOINT, {
    section: 11,
    owner: 'Kernel',
    sourcePath: 'src/kernel/site-capability-schema-governance.mjs',
    delegatedModules: [
      'src/sites/capability/schema-inventory.mjs',
      'src/sites/capability/compatibility-registry.mjs',
      'src/sites/capability/schema-governance.mjs',
    ],
  });

  const families = listKernelSchemaFamilies();
  assert.deepEqual(Object.keys(families), [
    'Manifest',
    'reasonCode',
    'StandardTaskList',
    'DownloadPolicy',
    'Artifact',
    'LifecycleEvent',
    'ApiCandidate',
    'ApiCatalog',
    'SessionView',
    'RiskState',
    'CapabilityHook',
  ]);

  const governed = new Map(listKernelGovernedSchemas().map((entry) => [entry.name, entry]));
  for (const [family, schemaNames] of Object.entries(families)) {
    assert.equal(assertKernelDesignSchemaFamilyGoverned(family), true);
    for (const schemaName of schemaNames) {
      const schema = governed.get(schemaName);
      assert.notEqual(schema, undefined);
      assert.equal(schema.kernelGovernance.section, 11);
      assert.equal(schema.kernelGovernance.owner, 'Kernel');
      assert.equal(schema.kernelGovernance.entrypoint, 'src/kernel/site-capability-schema-governance.mjs');
      assert.notEqual(schema.compatibility, null);
      assert.equal(schema.compatibility.version, schema.version);
      assert.equal(assertKernelGovernedSchemaCompatible(schemaName, compatibleKernelPayload(schemaName)), true);
    }
  }
});

test('Kernel-owned schema governance entrypoint fails closed on unknown schema and version drift', () => {
  assert.throws(
    () => assertKernelDesignSchemaFamilyGoverned('UnknownFamily'),
    /Unknown Kernel schema family/u,
  );
  assert.throws(
    () => assertKernelGovernedSchemaCompatible('UnknownSchema', { schemaVersion: 1 }),
    /Unknown Kernel governed schema/u,
  );

  for (const schemaName of [
    'DownloadRunManifest',
    'SessionRunManifest',
    'StandardTaskList',
    'DownloadPolicy',
    'ArtifactReferenceSet',
    'LifecycleEvent',
    'ApiCandidate',
    'ApiCatalog',
    'SessionView',
    'RiskState',
    'CapabilityHook',
  ]) {
    const schema = getKernelGovernedSchema(schemaName);
    assert.notEqual(schema, null);
    assert.throws(
      () => assertKernelGovernedSchemaCompatible(schemaName, {
        ...compatibleKernelPayload(schemaName),
        schemaVersion: schema.version + 1,
      }),
      /not compatible/u,
    );
    assert.throws(
      () => assertKernelGovernedSchemaCompatible(schemaName, {}),
      /schemaVersion is required/u,
    );
  }
});

test('schema governance facade covers every design schema family from one Kernel-owned entrypoint', () => {
  const families = listDesignSchemaFamilies();
  assert.deepEqual(Object.keys(families), [
    'Manifest',
    'reasonCode',
    'StandardTaskList',
    'DownloadPolicy',
    'Artifact',
    'LifecycleEvent',
    'ApiCandidate',
    'ApiCatalog',
    'SessionView',
    'RiskState',
    'CapabilityHook',
  ]);

  for (const [family, schemaNames] of Object.entries(families)) {
    assert.equal(schemaNames.length > 0, true);
    assert.equal(assertDesignSchemaFamilyGoverned(family), true);
    for (const schemaName of schemaNames) {
      const governed = getGovernedSchema(schemaName);
      assert.notEqual(governed, null);
      assert.equal(governed.governanceVersion, SCHEMA_GOVERNANCE_SCHEMA_VERSION);
      assert.notEqual(governed.status, 'missing');
      assert.equal(typeof governed.sourcePath, 'string');
    }
  }
});

test('schema governance facade governs the current reasonCode catalog compatibility', () => {
  const reasonCodeSchema = getGovernedSchema('reasonCode');
  assert.notEqual(reasonCodeSchema, null);
  assert.deepEqual(reasonCodeSchema.compatibility, {
    version: REASON_CODE_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/reason-codes.mjs',
  });

  const currentCatalog = {
    schemaVersion: REASON_CODE_SCHEMA_VERSION,
    entries: listReasonCodeDefinitions(),
  };
  assert.equal(assertGovernedSchemaCompatible('reasonCode', currentCatalog), true);

  assert.throws(
    () => assertGovernedSchemaCompatible('reasonCode', {
      ...currentCatalog,
      schemaVersion: REASON_CODE_SCHEMA_VERSION + 1,
    }),
    /not compatible/u,
  );
  assert.throws(
    () => assertGovernedSchemaCompatible('reasonCode', {
      schemaVersion: REASON_CODE_SCHEMA_VERSION,
      entries: [
        {
          ...currentCatalog.entries[0],
          family: 'not-a-family',
        },
      ],
    }),
    /invalid family/u,
  );
});

test('schema governance facade aligns inventory and compatibility metadata', () => {
  const governed = listGovernedSchemas();
  const inventory = listSchemaInventory();
  assert.deepEqual(governed.map((entry) => entry.name), inventory.map((entry) => entry.name));

  for (const entry of governed) {
    assert.equal(entry.governanceVersion, SCHEMA_GOVERNANCE_SCHEMA_VERSION);
    if (entry.compatibility) {
      assert.equal(entry.compatibility.version, entry.version);
      assert.equal(entry.compatibility.sourcePath, entry.sourcePath);
    }
  }
});

test('schema governance facade exposes API catalog runtime version family readiness gate', () => {
  const families = listRuntimeVersionFamilies();
  assert.deepEqual(families.ApiCatalog, {
    key: 'ApiCatalog',
    section: 12,
    owner: 'CapabilityService',
    producerRole: 'SiteAdapter',
    consumerRole: 'Kernel/API catalog store',
    schemaNames: [
      'ApiCandidate',
      'ApiResponseCaptureSummary',
      'SiteAdapterCandidateDecision',
      'SiteAdapterCatalogUpgradePolicy',
      'ApiCatalogEntry',
      'ApiCatalog',
      'ApiCatalogIndex',
    ],
  });
  assert.equal(assertRuntimeVersionFamilyReady('ApiCatalog'), true);

  const compatibleApiCatalogPayloads = {
    ApiCandidate: { schemaVersion: API_CANDIDATE_SCHEMA_VERSION },
    ApiResponseCaptureSummary: { schemaVersion: API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION },
    SiteAdapterCandidateDecision: { schemaVersion: SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION },
    SiteAdapterCatalogUpgradePolicy: { schemaVersion: SITE_ADAPTER_CATALOG_UPGRADE_POLICY_SCHEMA_VERSION },
    ApiCatalogEntry: { schemaVersion: API_CATALOG_ENTRY_SCHEMA_VERSION },
    ApiCatalog: { schemaVersion: API_CATALOG_SCHEMA_VERSION },
    ApiCatalogIndex: { schemaVersion: API_CATALOG_INDEX_SCHEMA_VERSION },
  };
  assert.equal(assertRuntimeVersionFamilyCompatible('ApiCatalog', compatibleApiCatalogPayloads), true);

  assert.throws(
    () => assertRuntimeVersionFamilyCompatible('ApiCatalog', {
      ...compatibleApiCatalogPayloads,
      ApiCatalogIndex: { schemaVersion: API_CATALOG_INDEX_SCHEMA_VERSION + 1 },
    }),
    /not compatible/u,
  );
  assert.throws(
    () => assertRuntimeVersionFamilyCompatible('ApiCatalog', {
      ...compatibleApiCatalogPayloads,
      ApiCatalogEntry: undefined,
    }),
    /schemaVersion is required/u,
  );
  const { ApiCatalogIndex, ...missingIndexPayloads } = compatibleApiCatalogPayloads;
  assert.throws(
    () => assertRuntimeVersionFamilyCompatible('ApiCatalog', missingIndexPayloads),
    /Runtime version family payload is required: ApiCatalog\.ApiCatalogIndex/u,
  );
  assert.throws(
    () => assertRuntimeVersionFamilyReady('UnknownFamily'),
    /Unknown runtime version family/u,
  );
});

test('schema governance facade exposes runtime readiness version family without duplicating API catalog gate', () => {
  const families = listRuntimeVersionFamilies();
  assert.deepEqual(families.RuntimeReadiness, {
    key: 'RuntimeReadiness',
    section: 12,
    owner: 'Kernel',
    producerRole: 'Kernel/SiteAdapter/CapabilityService',
    consumerRole: 'downloader/runtime handoff',
    schemaNames: [
      'LifecycleEvent',
      'SiteAdapterCandidateDecision',
      'SiteAdapterCatalogUpgradePolicy',
      'StandardTaskList',
      'DownloadPolicy',
      'SessionView',
      'RiskState',
    ],
  });
  assert.notDeepEqual(
    families.RuntimeReadiness.schemaNames,
    families.ApiCatalog.schemaNames,
    'runtime readiness must not be a second API catalog family gate',
  );
  assert.equal(assertRuntimeVersionFamilyReady('RuntimeReadiness'), true);

  const compatibleRuntimeReadinessPayloads = {
    LifecycleEvent: { schemaVersion: LIFECYCLE_EVENT_SCHEMA_VERSION },
    SiteAdapterCandidateDecision: { schemaVersion: SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION },
    SiteAdapterCatalogUpgradePolicy: { schemaVersion: SITE_ADAPTER_CATALOG_UPGRADE_POLICY_SCHEMA_VERSION },
    StandardTaskList: { schemaVersion: STANDARD_TASK_LIST_SCHEMA_VERSION },
    DownloadPolicy: { schemaVersion: DOWNLOAD_POLICY_SCHEMA_VERSION },
    SessionView: { schemaVersion: SESSION_VIEW_SCHEMA_VERSION },
    RiskState: { schemaVersion: RISK_STATE_SCHEMA_VERSION },
  };
  assert.equal(assertRuntimeVersionFamilyCompatible('RuntimeReadiness', compatibleRuntimeReadinessPayloads), true);

  assert.throws(
    () => assertRuntimeVersionFamilyCompatible('RuntimeReadiness', {
      ...compatibleRuntimeReadinessPayloads,
      DownloadPolicy: {},
    }),
    /schemaVersion is required/u,
  );
  assert.throws(
    () => assertRuntimeVersionFamilyCompatible('RuntimeReadiness', {
      ...compatibleRuntimeReadinessPayloads,
      SiteAdapterCandidateDecision: {
        schemaVersion: SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION + 1,
      },
    }),
    /not compatible/u,
  );
  const { SessionView, ...missingSessionViewPayloads } = compatibleRuntimeReadinessPayloads;
  assert.throws(
    () => assertRuntimeVersionFamilyCompatible('RuntimeReadiness', missingSessionViewPayloads),
    /Runtime version family payload is required: RuntimeReadiness\.SessionView/u,
  );
});

test('schema governance facade gates runtime readiness through CapabilityService inventory', async () => {
  const services = listCapabilityServiceRuntimeRegistry();
  assert.deepEqual(
    services.map((entry) => entry.stableName).sort(),
    [
      'ApiDiscoveryService',
      'ApiKnowledgeService',
      'ArtifactSchemaService',
      'CoverageAnalyzer',
      'HealthSignalNormalizer',
      'LifecycleHookService',
      'NetworkCaptureService',
      'NodeInventoryService',
      'PolicyService',
      'RiskStateMachine',
      'SecurityGuard',
      'SessionProvider',
      'SiteHealthExecutionGate',
      'SiteHealthRecoveryEngine',
      'UnknownNodeReporter',
    ],
  );
  assert.equal(services.every((entry) => entry.modulePath.startsWith('src/sites/capability/')), true);
  assert.equal(assertRuntimeVersionFamilyReady('RuntimeReadiness'), true);
  assert.equal(await assertCapabilityServicesRuntimeReady(), true);

  await assert.rejects(
    () => assertCapabilityServicesRuntimeReady({
      importModule: async () => ({}),
    }),
    /references missing export/u,
  );
});

test('schema governance facade is the generic downloader StandardTaskList boundary gate', () => {
  const executorSource = fs.readFileSync(
    path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'executor.mjs'),
    'utf8',
  );
  const runnerSource = fs.readFileSync(
    path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'runner.mjs'),
    'utf8',
  );

  assert.match(
    executorSource,
    /from '\.\.\/capability\/schema-governance\.mjs'/u,
    'generic downloader executor must import the governed schema facade',
  );
  assert.match(
    executorSource,
    /assertGovernedSchemaCompatible\('StandardTaskList'/u,
    'generic downloader executor must govern StandardTaskList compatibility through the facade',
  );
  assert.match(
    executorSource,
    /assertGovernedSchemaCompatible\('LifecycleEvent'/u,
    'generic downloader executor must govern LifecycleEvent compatibility through the facade',
  );
  assert.doesNotMatch(
    executorSource,
    /from '\.\.\/capability\/compatibility-registry\.mjs'/u,
    'generic downloader executor must not bypass governance with a direct compatibility-registry import',
  );
  assert.match(
    executorSource,
    /assertGovernedSchemaCompatible\('DownloadPolicy'/u,
    'generic downloader runtime gate must govern DownloadPolicy compatibility through the facade',
  );
  assert.match(
    executorSource,
    /assertGovernedSchemaCompatible\('SessionView'/u,
    'generic downloader runtime gate must govern SessionView compatibility through the facade',
  );
  assert.match(
    executorSource,
    /assertGovernedSchemaCompatible\('ApiCatalogEntry'/u,
    'generic downloader runtime gate must govern ApiCatalogEntry compatibility through the facade',
  );
  assert.match(
    runnerSource,
    /assertRuntimeDownloadCompatibility/u,
    'download runner handoff must use the shared runtime compatibility gate before executor or legacy branches',
  );
});

test('schema governance facade is the planner policy handoff writer boundary gate', () => {
  const handoffSource = fs.readFileSync(
    path.join(REPO_ROOT, 'src', 'sites', 'capability', 'planner-policy-handoff.mjs'),
    'utf8',
  );

  assert.match(
    handoffSource,
    /from '\.\/schema-governance\.mjs'/u,
    'planner policy handoff must import the governed schema facade',
  );
  assert.match(
    handoffSource,
    /function assertPlannerPolicyHandoffWriterCompatibility/u,
    'planner policy handoff must expose an explicit writer compatibility gate',
  );
  assert.match(
    handoffSource,
    /assertPlannerPolicyHandoffWriterCompatibility\(\{/u,
    'planner policy handoff writer must use the explicit compatibility gate',
  );
  assert.match(
    handoffSource,
    /assertGovernedSchemaCompatible\('ApiCatalogEntry', catalogEntry\)/u,
    'planner policy handoff must govern ApiCatalogEntry compatibility through the facade',
  );
  assert.match(
    handoffSource,
    /assertGovernedSchemaCompatible\('DownloadPolicy', downloadPolicy\)/u,
    'planner policy handoff must govern DownloadPolicy compatibility through the facade',
  );
  assert.match(
    handoffSource,
    /assertGovernedSchemaCompatible\('StandardTaskList', taskList\)/u,
    'planner policy handoff must govern StandardTaskList compatibility through the facade',
  );
  assert.doesNotMatch(
    handoffSource,
    /from '\.\/compatibility-registry\.mjs'/u,
    'planner policy handoff must not bypass governance with a direct compatibility-registry import',
  );
});

test('schema governance facade delegates compatible payload checks and fails closed', () => {
  assert.equal(assertGovernedSchemaCompatible('SessionView', {
    schemaVersion: SESSION_VIEW_SCHEMA_VERSION,
  }), true);
  assert.equal(assertGovernedSchemaCompatible('RiskState', {
    schemaVersion: RISK_STATE_SCHEMA_VERSION,
  }), true);

  assert.throws(
    () => assertGovernedSchemaCompatible('UnknownSchema', { schemaVersion: 1 }),
    /Unknown governed schema/u,
  );
  assert.throws(
    () => assertGovernedSchemaCompatible('DownloadRunManifest', { schemaVersion: 1 }),
    /does not have a compatibility guard/u,
  );
  assert.throws(
    () => assertGovernedSchemaCompatible('SessionView', {
      schemaVersion: SESSION_VIEW_SCHEMA_VERSION + 1,
    }),
    /not compatible/u,
  );
});
