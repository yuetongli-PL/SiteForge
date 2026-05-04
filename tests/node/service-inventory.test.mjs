import test from 'node:test';
import assert from 'node:assert/strict';

import {
  API_CANDIDATE_SCHEMA_VERSION,
  API_CATALOG_ENTRY_SCHEMA_VERSION,
  API_CATALOG_INDEX_SCHEMA_VERSION,
  API_CATALOG_SCHEMA_VERSION,
  API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION,
} from '../../src/sites/capability/api-candidates.mjs';
import { ARTIFACT_REFERENCE_SET_SCHEMA_VERSION } from '../../src/sites/capability/artifact-schema.mjs';
import {
  CAPABILITY_HOOK_EVENT_TYPE_REGISTRY_SCHEMA_VERSION,
  CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION,
  CAPABILITY_HOOK_SCHEMA_VERSION,
} from '../../src/sites/capability/capability-hook.mjs';
import { DOWNLOAD_POLICY_SCHEMA_VERSION } from '../../src/sites/capability/download-policy.mjs';
import { LIFECYCLE_EVENT_SCHEMA_VERSION } from '../../src/sites/capability/lifecycle-events.mjs';
import { NETWORK_CAPTURE_REQUEST_SCHEMA_VERSION } from '../../src/sites/capability/network-capture.mjs';
import { RISK_STATE_SCHEMA_VERSION } from '../../src/sites/capability/risk-state.mjs';
import { SECURITY_GUARD_SCHEMA_VERSION } from '../../src/sites/capability/security-guard.mjs';
import { SESSION_VIEW_SCHEMA_VERSION } from '../../src/sites/capability/session-view.mjs';
import { SITE_HEALTH_EXECUTION_GATE_SCHEMA_VERSION } from '../../src/sites/capability/site-health-execution-gate.mjs';
import { SITE_HEALTH_RECOVERY_SCHEMA_VERSION } from '../../src/sites/capability/site-health-recovery.mjs';
import { SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION } from '../../src/sites/capability/site-onboarding-discovery.mjs';
import { STANDARD_TASK_LIST_SCHEMA_VERSION } from '../../src/sites/capability/standard-task-list.mjs';
import {
  CAPABILITY_SERVICE_INVENTORY_SCHEMA_VERSION,
  assertCapabilityServiceArchitecture,
  assertCapabilityServiceContract,
  assertCapabilityServiceInventoryArchitecture,
  assertCapabilityServiceInventoryContracts,
  assertCapabilityServiceInventoryRuntimeCompatible,
  getCapabilityServiceInventoryEntry,
  listCapabilityServiceInventory,
} from '../../src/sites/capability/service-inventory.mjs';

const EXPECTED_SERVICE_NAMES = [
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
];

const EXPECTED_SCHEMA_VERSIONS = new Map([
  ['ApiCandidate', API_CANDIDATE_SCHEMA_VERSION],
  ['ApiCatalogEntry', API_CATALOG_ENTRY_SCHEMA_VERSION],
  ['ApiCatalog', API_CATALOG_SCHEMA_VERSION],
  ['ApiCatalogIndex', API_CATALOG_INDEX_SCHEMA_VERSION],
  ['ApiResponseCaptureSummary', API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION],
  ['ArtifactReferenceSet', ARTIFACT_REFERENCE_SET_SCHEMA_VERSION],
  ['CapabilityHook', CAPABILITY_HOOK_SCHEMA_VERSION],
  ['CapabilityHookEventTypeRegistry', CAPABILITY_HOOK_EVENT_TYPE_REGISTRY_SCHEMA_VERSION],
  ['CapabilityHookRegistrySnapshot', CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION],
  ['DownloadPolicy', DOWNLOAD_POLICY_SCHEMA_VERSION],
  ['LifecycleEvent', LIFECYCLE_EVENT_SCHEMA_VERSION],
  ['NetworkCaptureRequest', NETWORK_CAPTURE_REQUEST_SCHEMA_VERSION],
  ['RiskState', RISK_STATE_SCHEMA_VERSION],
  ['RedactionAudit', SECURITY_GUARD_SCHEMA_VERSION],
  ['SessionView', SESSION_VIEW_SCHEMA_VERSION],
  ['SiteHealthExecutionGate', SITE_HEALTH_EXECUTION_GATE_SCHEMA_VERSION],
  ['SiteHealthRecovery', SITE_HEALTH_RECOVERY_SCHEMA_VERSION],
  ['SiteOnboardingDiscovery', SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION],
  ['StandardTaskList', STANDARD_TASK_LIST_SCHEMA_VERSION],
]);

async function importInventoryModule(modulePath) {
  return import(new URL(`../../${modulePath}`, import.meta.url));
}

test('CapabilityService inventory lists the current Section 4 service primitives', () => {
  const names = listCapabilityServiceInventory().map((entry) => entry.stableName).sort();

  assert.deepEqual(names, EXPECTED_SERVICE_NAMES);
  assert.equal(assertCapabilityServiceInventoryContracts(), true);
  assert.equal(assertCapabilityServiceInventoryArchitecture(), true);
});

test('CapabilityService entries expose stable contracts and fail closed on missing declarations', () => {
  const entry = getCapabilityServiceInventoryEntry('NetworkCaptureService');
  assert.notEqual(entry, null);
  assert.equal(entry.schemaVersion, CAPABILITY_SERVICE_INVENTORY_SCHEMA_VERSION);
  assert.equal(assertCapabilityServiceContract(entry), true);

  assert.throws(
    () => assertCapabilityServiceContract({ ...entry, schemaEvidence: [] }),
    /schemaEvidence is required/u,
  );
  assert.throws(
    () => assertCapabilityServiceContract({ ...entry, safeBoundaryRole: undefined }),
    /safeBoundaryRole is required/u,
  );
  assert.throws(
    () => assertCapabilityServiceContract({
      ...entry,
      siteSemantics: {
        ...entry.siteSemantics,
        concreteSiteSemanticsAllowed: true,
      },
    }),
    /must explicitly forbid concrete site semantics/u,
  );
});

test('CapabilityService schema evidence matches existing schema exports', () => {
  for (const entry of listCapabilityServiceInventory()) {
    for (const evidence of entry.schemaEvidence) {
      assert.equal(
        evidence.version,
        EXPECTED_SCHEMA_VERSIONS.get(evidence.schemaName),
        `${entry.stableName} ${evidence.schemaName} version must match the current schema export`,
      );
    }
  }
});

test('CapabilityService inventory points at real module exports', async () => {
  assert.equal(await assertCapabilityServiceInventoryRuntimeCompatible(), true);

  const moduleCache = new Map();
  for (const entry of listCapabilityServiceInventory()) {
    if (!moduleCache.has(entry.modulePath)) {
      moduleCache.set(entry.modulePath, await importInventoryModule(entry.modulePath));
    }
    const serviceModule = moduleCache.get(entry.modulePath);
    for (const exportName of entry.exportedSymbols) {
      assert.equal(
        Object.hasOwn(serviceModule, exportName),
        true,
        `${entry.stableName} references missing export ${exportName} from ${entry.modulePath}`,
      );
    }

    for (const evidence of entry.schemaEvidence) {
      if (!moduleCache.has(evidence.modulePath)) {
        moduleCache.set(evidence.modulePath, await importInventoryModule(evidence.modulePath));
      }
      const evidenceModule = moduleCache.get(evidence.modulePath);
      assert.equal(
        Object.hasOwn(evidenceModule, evidence.exportName),
        true,
        `${entry.stableName} references missing schema export ${evidence.exportName} from ${evidence.modulePath}`,
      );
      assert.equal(evidenceModule[evidence.exportName], evidence.version);
    }
  }
});

test('CapabilityService runtime compatibility gate fails closed on stale module metadata', async () => {
  const entry = getCapabilityServiceInventoryEntry('SecurityGuard');
  assert.notEqual(entry, null);

  await assert.rejects(
    () => assertCapabilityServiceInventoryRuntimeCompatible({
      entries: [
        {
          ...entry,
          exportedSymbols: [...entry.exportedSymbols, 'missingSecurityGuardExport'],
        },
      ],
    }),
    /references missing export missingSecurityGuardExport/u,
  );

  await assert.rejects(
    () => assertCapabilityServiceInventoryRuntimeCompatible({
      importModule: async () => ({
        SECURITY_GUARD_SCHEMA_VERSION: SECURITY_GUARD_SCHEMA_VERSION + 1,
        REDACTION_PLACEHOLDER: '[REDACTED]',
        redactValue() {},
        redactHeaders() {},
        redactUrl() {},
        redactBody() {},
        assertNoForbiddenPatterns() {},
        prepareRedactedArtifactJsonWithAudit() {},
      }),
      entries: [entry],
    }),
    /schema evidence is stale/u,
  );
});

test('CapabilityService contracts keep site-specific semantics outside services', () => {
  for (const entry of listCapabilityServiceInventory()) {
    assert.equal(assertCapabilityServiceArchitecture(entry), true);
    assert.equal(entry.siteSemantics.concreteSiteSemanticsAllowed, false);
    assert.equal(entry.siteSemantics.siteSpecificInterpretationOwner, 'SiteAdapter');
    assert.match(entry.siteSemantics.statement, /SiteAdapter|outside|external|must not/u);
    assert.equal(
      entry.safeBoundaryRole.forbiddenMaterial.includes('raw cookies'),
      true,
      `${entry.stableName} must keep raw cookies outside the service boundary`,
    );
    assert.equal(
      entry.safeBoundaryRole.forbiddenMaterial.includes('authorization headers'),
      true,
      `${entry.stableName} must keep authorization headers outside the service boundary`,
    );
  }

  const entry = getCapabilityServiceInventoryEntry('NetworkCaptureService');
  assert.throws(
    () => assertCapabilityServiceArchitecture({
      ...entry,
      modulePath: 'src/sites/bilibili/navigation/open.mjs',
    }),
    /must stay under src\/sites\/capability\//u,
  );
  assert.throws(
    () => assertCapabilityServiceArchitecture({
      ...entry,
      serviceKind: 'bilibili-capture',
    }),
    /must not encode concrete site semantics/u,
  );
});
