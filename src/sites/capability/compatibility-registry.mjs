// @ts-check

import {
  API_CANDIDATE_SCHEMA_VERSION,
  API_CATALOG_INDEX_SCHEMA_VERSION,
  API_CATALOG_SCHEMA_VERSION,
  API_CATALOG_ENTRY_SCHEMA_VERSION,
  API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION,
  SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION,
  SITE_ADAPTER_CATALOG_UPGRADE_POLICY_SCHEMA_VERSION,
  assertApiCandidateCompatible,
  assertApiCatalogCompatible,
  assertApiCatalogEntryCompatible,
  assertApiCatalogIndexCompatible,
  assertApiResponseCaptureSummaryCompatible,
  assertSiteAdapterCandidateDecisionCompatible,
  assertSiteAdapterCatalogUpgradePolicyCompatible,
} from './api-candidates.mjs';
import {
  ARTIFACT_REFERENCE_SET_SCHEMA_VERSION,
  MANIFEST_ARTIFACT_BUNDLE_SCHEMA_VERSION,
  assertArtifactReferenceSetCompatible,
  assertManifestArtifactBundleCompatible,
} from './artifact-schema.mjs';
import {
  CAPABILITY_HOOK_EVENT_TYPE_REGISTRY_SCHEMA_VERSION,
  CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_REGISTRY_SCHEMA_VERSION,
  CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION,
  CAPABILITY_HOOK_SCHEMA_VERSION,
  assertCapabilityHookEventTypeRegistryCompatible,
  assertCapabilityHookProducerDescriptorRegistryCompatible,
  assertCapabilityHookRegistrySnapshotCompatible,
  assertCapabilityHookCompatible,
} from './capability-hook.mjs';
import {
  FOCUSED_REGRESSION_BATCH_DEFINITION_SCHEMA_VERSION,
  assertFocusedRegressionBatchDefinitionCompatible,
} from './focused-regression-batches.mjs';
import {
  LIFECYCLE_EVENT_SCHEMA_VERSION,
  assertLifecycleEventCompatible,
} from './lifecycle-events.mjs';
import {
  DOWNLOAD_POLICY_SCHEMA_VERSION,
  assertDownloadPolicyCompatible,
} from './download-policy.mjs';
import {
  REASON_CODE_SCHEMA_VERSION,
  assertReasonCodeCatalogCompatible,
} from './reason-codes.mjs';
import {
  RISK_STATE_SCHEMA_VERSION,
  assertRiskStateCompatible,
} from './risk-state.mjs';
import {
  SESSION_VIEW_SCHEMA_VERSION,
  assertSessionViewCompatible,
} from './session-view.mjs';
import {
  STANDARD_TASK_LIST_SCHEMA_VERSION,
  assertStandardTaskListCompatible,
} from './standard-task-list.mjs';

const COMPATIBILITY_REGISTRY = Object.freeze([
  Object.freeze({
    name: 'ApiCandidate',
    version: API_CANDIDATE_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/api-candidates.mjs',
    assertCompatible: assertApiCandidateCompatible,
  }),
  Object.freeze({
    name: 'ApiCatalogEntry',
    version: API_CATALOG_ENTRY_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/api-candidates.mjs',
    assertCompatible: assertApiCatalogEntryCompatible,
  }),
  Object.freeze({
    name: 'ApiCatalog',
    version: API_CATALOG_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/api-candidates.mjs',
    assertCompatible: assertApiCatalogCompatible,
  }),
  Object.freeze({
    name: 'ApiCatalogIndex',
    version: API_CATALOG_INDEX_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/api-candidates.mjs',
    assertCompatible: assertApiCatalogIndexCompatible,
  }),
  Object.freeze({
    name: 'ApiResponseCaptureSummary',
    version: API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/api-candidates.mjs',
    assertCompatible: assertApiResponseCaptureSummaryCompatible,
  }),
  Object.freeze({
    name: 'SiteAdapterCandidateDecision',
    version: SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/api-candidates.mjs',
    assertCompatible: assertSiteAdapterCandidateDecisionCompatible,
  }),
  Object.freeze({
    name: 'SiteAdapterCatalogUpgradePolicy',
    version: SITE_ADAPTER_CATALOG_UPGRADE_POLICY_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/api-candidates.mjs',
    assertCompatible: assertSiteAdapterCatalogUpgradePolicyCompatible,
  }),
  Object.freeze({
    name: 'reasonCode',
    version: REASON_CODE_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/reason-codes.mjs',
    assertCompatible: assertReasonCodeCatalogCompatible,
  }),
  Object.freeze({
    name: 'SessionView',
    version: SESSION_VIEW_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/session-view.mjs',
    assertCompatible: assertSessionViewCompatible,
  }),
  Object.freeze({
    name: 'DownloadPolicy',
    version: DOWNLOAD_POLICY_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/download-policy.mjs',
    assertCompatible: assertDownloadPolicyCompatible,
  }),
  Object.freeze({
    name: 'StandardTaskList',
    version: STANDARD_TASK_LIST_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/standard-task-list.mjs',
    assertCompatible: assertStandardTaskListCompatible,
  }),
  Object.freeze({
    name: 'RiskState',
    version: RISK_STATE_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/risk-state.mjs',
    assertCompatible: assertRiskStateCompatible,
  }),
  Object.freeze({
    name: 'CapabilityHook',
    version: CAPABILITY_HOOK_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/capability-hook.mjs',
    assertCompatible: assertCapabilityHookCompatible,
  }),
  Object.freeze({
    name: 'CapabilityHookEventTypeRegistry',
    version: CAPABILITY_HOOK_EVENT_TYPE_REGISTRY_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/capability-hook.mjs',
    assertCompatible: assertCapabilityHookEventTypeRegistryCompatible,
  }),
  Object.freeze({
    name: 'CapabilityHookProducerDescriptorRegistry',
    version: CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_REGISTRY_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/capability-hook.mjs',
    assertCompatible: assertCapabilityHookProducerDescriptorRegistryCompatible,
  }),
  Object.freeze({
    name: 'CapabilityHookRegistrySnapshot',
    version: CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/capability-hook.mjs',
    assertCompatible: assertCapabilityHookRegistrySnapshotCompatible,
  }),
  Object.freeze({
    name: 'LifecycleEvent',
    version: LIFECYCLE_EVENT_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/lifecycle-events.mjs',
    assertCompatible: assertLifecycleEventCompatible,
  }),
  Object.freeze({
    name: 'FocusedRegressionBatchDefinition',
    version: FOCUSED_REGRESSION_BATCH_DEFINITION_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/focused-regression-batches.mjs',
    assertCompatible: assertFocusedRegressionBatchDefinitionCompatible,
  }),
  Object.freeze({
    name: 'ArtifactReferenceSet',
    version: ARTIFACT_REFERENCE_SET_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/artifact-schema.mjs',
    assertCompatible: assertArtifactReferenceSetCompatible,
  }),
  Object.freeze({
    name: 'ManifestArtifactBundle',
    version: MANIFEST_ARTIFACT_BUNDLE_SCHEMA_VERSION,
    sourcePath: 'src/sites/capability/artifact-schema.mjs',
    assertCompatible: assertManifestArtifactBundleCompatible,
  }),
]);

export function listCompatibilitySchemas() {
  return COMPATIBILITY_REGISTRY.map(({ assertCompatible, ...entry }) => ({ ...entry }));
}

export function getCompatibilitySchema(name) {
  const normalizedName = String(name ?? '').trim();
  const entry = COMPATIBILITY_REGISTRY.find((candidate) => candidate.name === normalizedName);
  if (!entry) {
    return null;
  }
  const { assertCompatible, ...metadata } = entry;
  return { ...metadata };
}

export function assertSchemaCompatible(name, payload = {}) {
  const normalizedName = String(name ?? '').trim();
  const entry = COMPATIBILITY_REGISTRY.find((candidate) => candidate.name === normalizedName);
  if (!entry) {
    throw new Error(`Unknown compatibility schema: ${normalizedName || '<empty>'}`);
  }
  entry.assertCompatible(payload);
  return true;
}
