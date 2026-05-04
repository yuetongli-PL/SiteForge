import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  DOWNLOAD_RUN_MANIFEST_SCHEMA_VERSION,
  normalizeDownloadRunManifest,
} from '../../src/sites/downloads/contracts.mjs';
import {
  SESSION_RUN_MANIFEST_SCHEMA_VERSION,
  normalizeSessionRunManifest,
} from '../../src/sites/sessions/contracts.mjs';
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
  ARTIFACT_REFERENCE_SET_COMPATIBLE_SCHEMA_VERSIONS,
  ARTIFACT_REFERENCE_SET_SCHEMA_COMPATIBILITY,
  ARTIFACT_REFERENCE_SET_SCHEMA_VERSION,
  MANIFEST_ARTIFACT_BUNDLE_COMPATIBLE_SCHEMA_VERSIONS,
  MANIFEST_ARTIFACT_BUNDLE_SCHEMA_COMPATIBILITY,
  MANIFEST_ARTIFACT_BUNDLE_SCHEMA_VERSION,
  assertArtifactReferenceSetCompatible,
  assertManifestArtifactBundleCompatible,
  isArtifactReferenceSetSchemaVersionCompatible,
  isManifestArtifactBundleSchemaVersionCompatible,
  normalizeArtifactReferenceSet,
  normalizeManifestArtifactBundle,
  normalizeManifestArtifactBundleFromManifest,
} from '../../src/sites/capability/artifact-schema.mjs';
import {
  CAPABILITY_HOOK_EVENT_TYPE_REGISTRY_SCHEMA_VERSION,
  CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_REGISTRY_SCHEMA_VERSION,
  CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION,
  CAPABILITY_HOOK_SCHEMA_VERSION,
  createCapabilityHookProducerDescriptorRegistry,
} from '../../src/sites/capability/capability-hook.mjs';
import { DOWNLOAD_POLICY_SCHEMA_VERSION } from '../../src/sites/capability/download-policy.mjs';
import { FOCUSED_REGRESSION_BATCH_DEFINITION_SCHEMA_VERSION } from '../../src/sites/capability/focused-regression-batches.mjs';
import { LIFECYCLE_EVENT_SCHEMA_VERSION } from '../../src/sites/capability/lifecycle-events.mjs';
import { REASON_CODE_SCHEMA_VERSION } from '../../src/sites/capability/reason-codes.mjs';
import { RISK_STATE_SCHEMA_VERSION } from '../../src/sites/capability/risk-state.mjs';
import { SECURITY_GUARD_SCHEMA_VERSION } from '../../src/sites/capability/security-guard.mjs';
import { SESSION_VIEW_SCHEMA_VERSION } from '../../src/sites/capability/session-view.mjs';
import { STANDARD_TASK_LIST_SCHEMA_VERSION } from '../../src/sites/capability/standard-task-list.mjs';
import {
  assertSchemaCompatible,
  getCompatibilitySchema,
} from '../../src/sites/capability/compatibility-registry.mjs';
import {
  KERNEL_SCHEMA_GOVERNANCE_SECTION,
  SCHEMA_INVENTORY_STATUSES,
  STANDARD_ARTIFACT_SECTION,
  getSchemaInventoryEntry,
  listKernelSchemaGovernanceInventory,
  listMissingSchemas,
  listSchemaInventory,
  listStandardArtifactInventory,
} from '../../src/sites/capability/schema-inventory.mjs';

const CONTRIBUTING_URL = new URL('../../CONTRIBUTING.md', import.meta.url);

async function readFocusedRegressionBatchDefinition() {
  const markdown = await readFile(CONTRIBUTING_URL, 'utf8');
  const match = markdown.match(
    /<!-- SCL_FOCUSED_REGRESSION_BATCHES_JSON_BEGIN -->\s*```json[^\n]*\n([\s\S]*?)\n```\s*<!-- SCL_FOCUSED_REGRESSION_BATCHES_JSON_END -->/u,
  );
  assert.notEqual(match, null, 'CONTRIBUTING.md must embed focused regression batches JSON');
  return JSON.parse(match[1]);
}

test('schema inventory records current versioned schema evidence', () => {
  const expected = new Map([
    ['reasonCode', REASON_CODE_SCHEMA_VERSION],
    ['LifecycleEvent', LIFECYCLE_EVENT_SCHEMA_VERSION],
    ['ApiCandidate', API_CANDIDATE_SCHEMA_VERSION],
    ['ApiCatalogEntry', API_CATALOG_ENTRY_SCHEMA_VERSION],
    ['ApiCatalog', API_CATALOG_SCHEMA_VERSION],
    ['ApiCatalogIndex', API_CATALOG_INDEX_SCHEMA_VERSION],
    ['ApiResponseCaptureSummary', API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION],
    ['SiteAdapterCandidateDecision', SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION],
    ['SiteAdapterCatalogUpgradePolicy', SITE_ADAPTER_CATALOG_UPGRADE_POLICY_SCHEMA_VERSION],
    ['DownloadRunManifest', DOWNLOAD_RUN_MANIFEST_SCHEMA_VERSION],
    ['DownloadPolicy', DOWNLOAD_POLICY_SCHEMA_VERSION],
    ['SessionRunManifest', SESSION_RUN_MANIFEST_SCHEMA_VERSION],
    ['SessionView', SESSION_VIEW_SCHEMA_VERSION],
    ['StandardTaskList', STANDARD_TASK_LIST_SCHEMA_VERSION],
    ['RiskState', RISK_STATE_SCHEMA_VERSION],
    ['CapabilityHook', CAPABILITY_HOOK_SCHEMA_VERSION],
    ['CapabilityHookEventTypeRegistry', CAPABILITY_HOOK_EVENT_TYPE_REGISTRY_SCHEMA_VERSION],
    ['CapabilityHookProducerDescriptorRegistry', CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_REGISTRY_SCHEMA_VERSION],
    ['CapabilityHookRegistrySnapshot', CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION],
    ['FocusedRegressionBatchDefinition', FOCUSED_REGRESSION_BATCH_DEFINITION_SCHEMA_VERSION],
    ['ArtifactReferenceSet', ARTIFACT_REFERENCE_SET_SCHEMA_VERSION],
    ['ManifestArtifactBundle', MANIFEST_ARTIFACT_BUNDLE_SCHEMA_VERSION],
    ['RedactionAudit', SECURITY_GUARD_SCHEMA_VERSION],
  ]);

  for (const [name, version] of expected) {
    const entry = getSchemaInventoryEntry(name);
    assert.notEqual(entry, null);
    assert.equal(entry.version, version);
    assert.match(entry.sourcePath, /^src\//u);
    assert.notEqual(entry.status, 'missing');
  }
});

test('schema inventory entries expose the required contract fields', () => {
  const allowedStatuses = new Set(SCHEMA_INVENTORY_STATUSES);
  for (const entry of listSchemaInventory()) {
    assert.equal(typeof entry.name, 'string');
    assert.equal(entry.name.length > 0, true);
    assert.equal(typeof entry.status, 'string');
    assert.equal(allowedStatuses.has(entry.status), true);
    assert.equal(typeof entry.owner, 'string');
    assert.equal(entry.owner.length > 0, true);
    assert.equal(typeof entry.gap, 'string');
    assert.equal(entry.gap.length > 0, true);
  }
});

test('schema inventory keeps missing design schemas explicitly missing', () => {
  const missingNames = listMissingSchemas().map((entry) => entry.name).sort();
  assert.deepEqual(missingNames, []);

  for (const entry of listMissingSchemas()) {
    assert.equal(entry.version, null);
    assert.equal(entry.sourcePath, null);
    assert.match(entry.gap, /Required by Site Capability Layer design/u);
  }
});

test('schema inventory entries do not claim missing schemas are implemented', () => {
  for (const entry of listSchemaInventory()) {
    if (entry.status === 'missing') {
      assert.equal(entry.version, null);
      assert.equal(entry.sourcePath, null);
      continue;
    }
    assert.equal(typeof entry.version, 'number');
    assert.equal(typeof entry.sourcePath, 'string');
  }
});

test('schema inventory records Section 19 standard artifact evidence', () => {
  const evidenceByName = new Map(
    listStandardArtifactInventory().map((entry) => [entry.name, entry.standardArtifact]),
  );
  const expectedEvidence = new Map([
    ['ArtifactReferenceSet', {
      family: 'Artifacts',
      role: 'artifact-reference-set',
      producerPath: 'src/sites/capability/artifact-schema.mjs',
      consumerPath: 'src/sites/downloads/contracts.mjs',
    }],
    ['ManifestArtifactBundle', {
      family: 'ManifestArtifacts',
      role: 'manifest-payload-artifact-bundle',
      producerPath: 'src/sites/capability/artifact-schema.mjs',
      consumerPath: 'src/sites/sessions/contracts.mjs',
      verificationPath: 'tests/node/schema-inventory.test.mjs',
    }],
    ['LifecycleEvent', {
      family: 'LifecycleEvents',
      role: 'standard-event-envelope',
      producerPath: 'src/sites/capability/lifecycle-events.mjs',
      consumerPath: 'src/pipeline/stages/capture.mjs',
    }],
    ['ApiCatalogIndex', {
      family: 'api-catalog',
      role: 'catalog-index',
      producerPath: 'src/sites/capability/api-candidates.mjs',
    }],
    ['StandardTaskList', {
      family: 'DownloaderBoundaries',
      role: 'low-permission-task-list',
      producerPath: 'src/sites/capability/planner-policy-handoff.mjs',
      consumerPath: 'src/sites/downloads/runner.mjs',
      verificationPath: 'tests/node/standard-task-list.test.mjs',
    }],
    ['DownloadPolicy', {
      family: 'DownloaderBoundaries',
      role: 'low-permission-download-policy',
      producerPath: 'src/sites/capability/planner-policy-handoff.mjs',
      consumerPath: 'src/sites/downloads/contracts.mjs',
      verificationPath: 'tests/node/download-policy.test.mjs',
    }],
    ['SessionView', {
      family: 'SessionBoundary',
      role: 'minimal-session-view',
      producerPath: 'src/sites/sessions/manifest-bridge.mjs',
      consumerPath: 'src/sites/downloads/contracts.mjs',
      verificationPath: 'tests/node/session-view.test.mjs',
    }],
    ['RiskState', {
      family: 'RiskSemantics',
      role: 'standard-risk-state',
      producerPath: 'src/sites/downloads/runner.mjs',
      consumerPath: 'src/infra/auth/site-session-governance.mjs',
      verificationPath: 'tests/node/risk-state.test.mjs',
    }],
    ['CapabilityHook', {
      family: 'LifecycleEvents',
      role: 'descriptor-only-hook-output-boundary',
      producerPath: 'src/sites/capability/capability-hook.mjs',
      consumerPath: 'src/sites/capability/api-candidates.mjs',
    }],
    ['RedactionAudit', {
      family: 'ArtifactAudits',
      role: 'redaction-audit-sidecar',
      producerPath: 'src/sites/capability/security-guard.mjs',
      consumerPath: 'src/sites/capability/planner-policy-handoff.mjs',
      verificationPath: 'tests/node/security-guard-redaction.test.mjs',
    }],
  ]);

  for (const [name, expected] of expectedEvidence) {
    const entry = getSchemaInventoryEntry(name);
    const evidence = evidenceByName.get(name);
    assert.notEqual(entry, null);
    assert.notEqual(entry.status, 'missing');
    assert.equal(typeof entry.version, 'number');
    assert.equal(typeof entry.owner, 'string');
    assert.equal(entry.owner.length > 0, true);
    assert.notEqual(evidence, undefined);
    assert.equal(evidence.section, STANDARD_ARTIFACT_SECTION);
    assert.equal(evidence.family, expected.family);
    assert.equal(evidence.role, expected.role);
    assert.equal(evidence.artifactName, name);
    assert.equal(evidence.producerPath, expected.producerPath);
    assert.equal(Array.isArray(evidence.consumerPaths), true);
    assert.equal(Array.isArray(evidence.verificationPaths), true);
    if (expected.consumerPath) {
      assert.equal(evidence.consumerPaths.includes(expected.consumerPath), true);
    }
    if (expected.verificationPath) {
      assert.equal(evidence.verificationPaths.includes(expected.verificationPath), true);
    }
    assert.equal(evidence.verificationPaths.includes('tests/node/schema-inventory.test.mjs'), true);
    assert.equal(typeof evidence.gap, 'string');
    assert.equal(evidence.gap.length > 0, true);
  }
});

test('schema inventory records Kernel-governed lifecycle producer inventory evidence', () => {
  const entry = getSchemaInventoryEntry('CapabilityHookProducerDescriptorRegistry');
  const registryEntry = getCompatibilitySchema('CapabilityHookProducerDescriptorRegistry');
  const governanceEntries = listKernelSchemaGovernanceInventory();
  const governance = entry?.kernelGovernance;
  const producerRegistry = createCapabilityHookProducerDescriptorRegistry();

  assert.notEqual(entry, null);
  assert.notEqual(registryEntry, null);
  assert.equal(entry.status, 'implemented');
  assert.equal(entry.owner, 'Kernel');
  assert.equal(entry.version, CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_REGISTRY_SCHEMA_VERSION);
  assert.equal(entry.sourcePath, 'src/sites/capability/capability-hook.mjs');
  assert.equal(registryEntry.version, entry.version);
  assert.equal(registryEntry.sourcePath, entry.sourcePath);
  assert.equal(governanceEntries.some((candidate) => candidate.name === entry.name), true);
  assert.notEqual(governance, undefined);
  assert.equal(governance.section, KERNEL_SCHEMA_GOVERNANCE_SECTION);
  assert.equal(governance.family, 'LifecycleEvents');
  assert.equal(governance.role, 'high-risk-lifecycle-producer-descriptor-inventory');
  assert.equal(governance.inventoryName, entry.name);
  assert.equal(governance.compatibilitySchemaName, entry.name);
  assert.equal(governance.producerPath, entry.sourcePath);
  assert.equal(governance.verificationPaths.includes('tests/node/compatibility-registry.test.mjs'), true);
  assert.equal(assertSchemaCompatible(entry.name, producerRegistry), true);
});

test('focused regression batch definition document is governed by schema inventory', async () => {
  const definition = await readFocusedRegressionBatchDefinition();
  const inventoryEntry = getSchemaInventoryEntry('FocusedRegressionBatchDefinition');
  const registryEntry = getCompatibilitySchema('FocusedRegressionBatchDefinition');

  assert.notEqual(inventoryEntry, null);
  assert.notEqual(registryEntry, null);
  assert.equal(inventoryEntry.owner, 'Kernel');
  assert.equal(inventoryEntry.version, FOCUSED_REGRESSION_BATCH_DEFINITION_SCHEMA_VERSION);
  assert.equal(inventoryEntry.sourcePath, 'src/sites/capability/focused-regression-batches.mjs');
  assert.equal(registryEntry.version, inventoryEntry.version);
  assert.equal(registryEntry.sourcePath, inventoryEntry.sourcePath);
  assert.equal(assertSchemaCompatible('FocusedRegressionBatchDefinition', definition), true);
});

test('ArtifactReferenceSet records current compatibility evidence', () => {
  const normalized = normalizeArtifactReferenceSet({
    manifest: 'runs/example/manifest.json',
    source: {
      rawCapture: 'runs/example/raw.json',
      skipped: '',
    },
  });
  const inventoryEntry = getSchemaInventoryEntry('ArtifactReferenceSet');
  const registryEntry = getCompatibilitySchema('ArtifactReferenceSet');

  assert.notEqual(inventoryEntry, null);
  assert.notEqual(registryEntry, null);
  assert.equal(ARTIFACT_REFERENCE_SET_SCHEMA_COMPATIBILITY.name, 'ArtifactReferenceSet');
  assert.equal(
    ARTIFACT_REFERENCE_SET_SCHEMA_COMPATIBILITY.currentVersion,
    ARTIFACT_REFERENCE_SET_SCHEMA_VERSION,
  );
  assert.deepEqual(
    ARTIFACT_REFERENCE_SET_COMPATIBLE_SCHEMA_VERSIONS,
    [ARTIFACT_REFERENCE_SET_SCHEMA_VERSION],
  );
  assert.equal(inventoryEntry.version, ARTIFACT_REFERENCE_SET_SCHEMA_COMPATIBILITY.currentVersion);
  assert.equal(registryEntry.version, ARTIFACT_REFERENCE_SET_SCHEMA_COMPATIBILITY.currentVersion);
  assert.equal(normalized.schemaVersion, ARTIFACT_REFERENCE_SET_SCHEMA_VERSION);
  assert.equal(assertArtifactReferenceSetCompatible(normalized), true);
  assert.equal(assertSchemaCompatible('ArtifactReferenceSet', normalized), true);
  assert.equal(isArtifactReferenceSetSchemaVersionCompatible(ARTIFACT_REFERENCE_SET_SCHEMA_VERSION), true);
  assert.equal(isArtifactReferenceSetSchemaVersionCompatible(ARTIFACT_REFERENCE_SET_SCHEMA_VERSION + 1), false);
});

test('ManifestArtifactBundle records manifest payload-family compatibility evidence', () => {
  const downloadManifest = normalizeDownloadRunManifest({
    runId: 'run-standard-artifacts',
    planId: 'plan-standard-artifacts',
    siteKey: 'example',
    status: 'passed',
    counts: {
      expected: 1,
      attempted: 1,
      downloaded: 1,
      skipped: 0,
      failed: 0,
    },
    artifacts: {
      manifest: 'runs/example/download/manifest.json',
      queue: 'runs/example/download/queue.json',
      downloadsJsonl: 'runs/example/download/downloads.jsonl',
      reportMarkdown: 'runs/example/download/report.md',
      redactionAudit: 'runs/example/download/redaction-audit.json',
      lifecycleEvent: 'runs/example/download/lifecycle-event.json',
      lifecycleEventRedactionAudit: 'runs/example/download/lifecycle-event-redaction-audit.json',
      plan: 'runs/example/download/plan.json',
      resolvedTask: 'runs/example/download/resolved-task.json',
      standardTaskList: 'runs/example/download/standard-task-list.json',
      runDir: 'runs/example/download',
      filesDir: 'runs/example/download/files',
      source: {
        manifest: 'runs/example/source/manifest.json',
        mediaManifest: 'runs/example/source/media-manifest.json',
      },
    },
  });
  const normalized = normalizeManifestArtifactBundleFromManifest(downloadManifest, {
    manifestName: 'DownloadRunManifest',
  });
  const sessionManifest = normalizeSessionRunManifest({
    runId: 'session-standard-artifacts',
    plan: {
      id: 'session-plan-standard-artifacts',
      siteKey: 'example',
      host: 'example.invalid',
      purpose: 'download',
      dryRun: true,
    },
    health: {
      status: 'ready',
      authStatus: 'authenticated',
    },
    artifacts: {
      manifest: 'runs/example/session/manifest.json',
      redactionAudit: 'runs/example/session/redaction-audit.json',
      sessionViewMaterializationAudit: 'runs/example/session/session-view-materialization-audit.json',
      sessionViewMaterializationRedactionAudit: 'runs/example/session/session-view-materialization-redaction-audit.json',
      lifecycleEvent: 'runs/example/session/lifecycle-event.json',
      lifecycleEventRedactionAudit: 'runs/example/session/lifecycle-event-redaction-audit.json',
      runDir: 'runs/example/session',
    },
  });
  const sessionBundle = normalizeManifestArtifactBundleFromManifest(sessionManifest, {
    manifestName: 'SessionRunManifest',
  });
  const inventoryEntry = getSchemaInventoryEntry('ManifestArtifactBundle');

  assert.notEqual(inventoryEntry, null);
  assert.equal(MANIFEST_ARTIFACT_BUNDLE_SCHEMA_COMPATIBILITY.name, 'ManifestArtifactBundle');
  assert.equal(
    MANIFEST_ARTIFACT_BUNDLE_SCHEMA_COMPATIBILITY.currentVersion,
    MANIFEST_ARTIFACT_BUNDLE_SCHEMA_VERSION,
  );
  assert.deepEqual(
    MANIFEST_ARTIFACT_BUNDLE_COMPATIBLE_SCHEMA_VERSIONS,
    [MANIFEST_ARTIFACT_BUNDLE_SCHEMA_VERSION],
  );
  assert.equal(inventoryEntry.status, 'partial');
  assert.notEqual(inventoryEntry.status, 'missing');
  assert.equal(inventoryEntry.version, MANIFEST_ARTIFACT_BUNDLE_SCHEMA_VERSION);
  assert.equal(normalized.schemaVersion, MANIFEST_ARTIFACT_BUNDLE_SCHEMA_VERSION);
  assert.equal(normalized.manifestName, 'DownloadRunManifest');
  assert.equal(normalized.manifestSchemaVersion, DOWNLOAD_RUN_MANIFEST_SCHEMA_VERSION);
  assert.equal(normalized.manifestPath, downloadManifest.artifacts.manifest);
  assert.equal(normalized.artifacts.schemaVersion, ARTIFACT_REFERENCE_SET_SCHEMA_VERSION);
  assert.equal(normalized.artifacts.manifest, downloadManifest.artifacts.manifest);
  assert.equal(normalized.artifacts.redactionAudit, downloadManifest.artifacts.redactionAudit);
  assert.equal(normalized.artifacts.lifecycleEvent, downloadManifest.artifacts.lifecycleEvent);
  assert.equal(
    normalized.artifacts.lifecycleEventRedactionAudit,
    downloadManifest.artifacts.lifecycleEventRedactionAudit,
  );
  assert.deepEqual(normalized.artifacts.source, downloadManifest.artifacts.source);
  assert.equal(assertManifestArtifactBundleCompatible(normalized), true);
  assert.equal(sessionBundle.manifestName, 'SessionRunManifest');
  assert.equal(sessionBundle.manifestSchemaVersion, SESSION_RUN_MANIFEST_SCHEMA_VERSION);
  assert.equal(sessionBundle.manifestPath, sessionManifest.artifacts.manifest);
  assert.equal(sessionBundle.artifacts.manifest, sessionManifest.artifacts.manifest);
  assert.equal(sessionBundle.artifacts.redactionAudit, sessionManifest.artifacts.redactionAudit);
  assert.equal(sessionBundle.artifacts.lifecycleEvent, sessionManifest.artifacts.lifecycleEvent);
  assert.equal(
    sessionBundle.artifacts.lifecycleEventRedactionAudit,
    sessionManifest.artifacts.lifecycleEventRedactionAudit,
  );
  assert.equal(
    sessionBundle.artifacts.sessionViewMaterializationRedactionAudit,
    sessionManifest.artifacts.sessionViewMaterializationRedactionAudit,
  );
  assert.equal(assertManifestArtifactBundleCompatible(sessionBundle), true);
  assert.equal(isManifestArtifactBundleSchemaVersionCompatible(MANIFEST_ARTIFACT_BUNDLE_SCHEMA_VERSION), true);
  assert.equal(isManifestArtifactBundleSchemaVersionCompatible(MANIFEST_ARTIFACT_BUNDLE_SCHEMA_VERSION + 1), false);
  assert.throws(
    () => assertManifestArtifactBundleCompatible({
      ...normalized,
      artifacts: {
        schemaVersion: ARTIFACT_REFERENCE_SET_SCHEMA_VERSION,
        manifest: ['runs/example/manifest.json'],
      },
    }),
    /artifacts\.manifest must be a string artifact reference/u,
  );
});
