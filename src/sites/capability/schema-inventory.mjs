// @ts-check

import { DOWNLOAD_RUN_MANIFEST_SCHEMA_VERSION } from '../downloads/contracts.mjs';
import { SESSION_RUN_MANIFEST_SCHEMA_VERSION } from '../sessions/contracts.mjs';
import {
  API_CANDIDATE_SCHEMA_VERSION,
  API_CATALOG_INDEX_SCHEMA_VERSION,
  API_CATALOG_SCHEMA_VERSION,
  API_CATALOG_ENTRY_SCHEMA_VERSION,
  API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION,
  SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION,
  SITE_ADAPTER_CATALOG_UPGRADE_POLICY_SCHEMA_VERSION,
} from './api-candidates.mjs';
import {
  ARTIFACT_REFERENCE_SET_SCHEMA_VERSION,
  MANIFEST_ARTIFACT_BUNDLE_SCHEMA_VERSION,
} from './artifact-schema.mjs';
import {
  CAPABILITY_HOOK_EVENT_TYPE_REGISTRY_SCHEMA_VERSION,
  CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_REGISTRY_SCHEMA_VERSION,
  CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION,
  CAPABILITY_HOOK_SCHEMA_VERSION,
} from './capability-hook.mjs';
import { DOWNLOAD_POLICY_SCHEMA_VERSION } from './download-policy.mjs';
import { FOCUSED_REGRESSION_BATCH_DEFINITION_SCHEMA_VERSION } from './focused-regression-batches.mjs';
import { LIFECYCLE_EVENT_SCHEMA_VERSION } from './lifecycle-events.mjs';
import { REASON_CODE_SCHEMA_VERSION } from './reason-codes.mjs';
import { RISK_STATE_SCHEMA_VERSION } from './risk-state.mjs';
import { SECURITY_GUARD_SCHEMA_VERSION } from './security-guard.mjs';
import { SESSION_VIEW_SCHEMA_VERSION } from './session-view.mjs';
import { STANDARD_TASK_LIST_SCHEMA_VERSION } from './standard-task-list.mjs';

export const SCHEMA_INVENTORY_STATUSES = Object.freeze([
  'implemented',
  'partial',
  'missing',
]);

export const STANDARD_ARTIFACT_SECTION = 19;
export const KERNEL_SCHEMA_GOVERNANCE_SECTION = 11;

function standardArtifactEvidence({
  family,
  role,
  artifactName,
  producerPath,
  consumerPaths = [],
  verificationPaths = [],
  gap,
}) {
  return Object.freeze({
    section: STANDARD_ARTIFACT_SECTION,
    family,
    role,
    artifactName,
    producerPath,
    consumerPaths: Object.freeze([...consumerPaths]),
    verificationPaths: Object.freeze([...verificationPaths]),
    gap,
  });
}

function kernelSchemaGovernanceEvidence({
  family,
  role,
  inventoryName,
  producerPath,
  compatibilitySchemaName,
  verificationPaths = [],
  gap,
}) {
  return Object.freeze({
    section: KERNEL_SCHEMA_GOVERNANCE_SECTION,
    family,
    role,
    inventoryName,
    producerPath,
    compatibilitySchemaName,
    verificationPaths: Object.freeze([...verificationPaths]),
    gap,
  });
}

const SCHEMA_INVENTORY = Object.freeze([
  Object.freeze({
    name: 'reasonCode',
    status: 'implemented',
    version: REASON_CODE_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/sites/capability/reason-codes.mjs',
    gap: 'Versioned taxonomy exists; full failure-mode coverage is still tracked by Section 15.',
  }),
  Object.freeze({
    name: 'LifecycleEvent',
    status: 'partial',
    version: LIFECYCLE_EVENT_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/sites/capability/lifecycle-events.mjs',
    standardArtifact: standardArtifactEvidence({
      family: 'LifecycleEvents',
      role: 'standard-event-envelope',
      artifactName: 'LifecycleEvent',
      producerPath: 'src/sites/capability/lifecycle-events.mjs',
      consumerPaths: [
        'src/pipeline/stages/capture.mjs',
        'src/sites/downloads/executor.mjs',
        'src/sites/downloads/runner.mjs',
        'src/sites/sessions/runner.mjs',
      ],
      verificationPaths: [
        'tests/node/lifecycle-events.test.mjs',
        'tests/node/schema-inventory.test.mjs',
      ],
      gap: 'Runtime producer profiles are still incremental; this records the shared event envelope and current producer evidence only.',
    }),
    gap: 'Minimal event schema and compatibility guard exist; broader hook families and runtime hook registration are incomplete.',
  }),
  Object.freeze({
    name: 'ApiCandidate',
    status: 'partial',
    version: API_CANDIDATE_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/sites/capability/api-candidates.mjs',
    gap: 'Minimal schema exists; persistent candidate artifacts and producer flow are incomplete.',
  }),
  Object.freeze({
    name: 'ApiCatalogEntry',
    status: 'partial',
    version: API_CATALOG_ENTRY_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/sites/capability/api-candidates.mjs',
    gap: 'Minimal entry schema exists; full catalog store and SiteAdapter validation are incomplete.',
  }),
  Object.freeze({
    name: 'ApiCatalog',
    status: 'partial',
    version: API_CATALOG_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/sites/capability/api-candidates.mjs',
    gap: 'Minimal collection schema exists; live promotion workflow and broader store lifecycle are incomplete.',
  }),
  Object.freeze({
    name: 'ApiCatalogIndex',
    status: 'partial',
    version: API_CATALOG_INDEX_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/sites/capability/api-candidates.mjs',
    standardArtifact: standardArtifactEvidence({
      family: 'api-catalog',
      role: 'catalog-index',
      artifactName: 'ApiCatalogIndex',
      producerPath: 'src/sites/capability/api-candidates.mjs',
      verificationPaths: [
        'tests/node/api-candidates.test.mjs',
        'tests/node/schema-inventory.test.mjs',
      ],
      gap: 'Catalog index writer evidence exists; broader live catalog invalidation and store lifecycle remain incomplete.',
    }),
    gap: 'Minimal index schema exists for catalog metadata/version summaries; live catalog store lifecycle and invalidation are incomplete.',
  }),
  Object.freeze({
    name: 'ApiResponseCaptureSummary',
    status: 'partial',
    version: API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/sites/capability/api-candidates.mjs',
    gap: 'Minimal response summary schema exists; runtime NetworkCapture/BrowserSession wiring and real response verification are incomplete.',
  }),
  Object.freeze({
    name: 'SiteAdapterCandidateDecision',
    status: 'partial',
    version: SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/sites/capability/api-candidates.mjs',
    gap: 'Minimal decision schema exists; site-specific validation implementations and catalog promotion workflow are incomplete.',
  }),
  Object.freeze({
    name: 'SiteAdapterCatalogUpgradePolicy',
    status: 'partial',
    version: SITE_ADAPTER_CATALOG_UPGRADE_POLICY_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/sites/capability/api-candidates.mjs',
    gap: 'Minimal SiteAdapter-owned policy input schema exists; concrete site-specific upgrade rules and catalog store integration are incomplete.',
  }),
  Object.freeze({
    name: 'DownloadRunManifest',
    status: 'partial',
    version: DOWNLOAD_RUN_MANIFEST_SCHEMA_VERSION,
    owner: 'Downloader',
    sourcePath: 'src/sites/downloads/contracts.mjs',
    gap: 'Download run manifest exists; StandardTaskList and DownloadPolicy are not yet wired into runtime plans.',
  }),
  Object.freeze({
    name: 'SessionRunManifest',
    status: 'partial',
    version: SESSION_RUN_MANIFEST_SCHEMA_VERSION,
    owner: 'Session',
    sourcePath: 'src/sites/sessions/contracts.mjs',
    gap: 'Session run manifest exists; runtime SessionView materialization and broader downloader integration are incomplete.',
  }),
  Object.freeze({
    name: 'StandardTaskList',
    status: 'partial',
    version: STANDARD_TASK_LIST_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/sites/capability/standard-task-list.mjs',
    standardArtifact: standardArtifactEvidence({
      family: 'DownloaderBoundaries',
      role: 'low-permission-task-list',
      artifactName: 'StandardTaskList',
      producerPath: 'src/sites/capability/planner-policy-handoff.mjs',
      consumerPaths: [
        'src/sites/downloads/contracts.mjs',
        'src/sites/downloads/runner.mjs',
      ],
      verificationPaths: [
        'tests/node/standard-task-list.test.mjs',
        'tests/node/planner-policy-handoff.test.mjs',
        'tests/node/downloads-runner.test.mjs',
        'tests/node/schema-inventory.test.mjs',
      ],
      gap: 'Planner handoff and downloader terminal artifacts produce governed task lists; broader site planner adoption remains incremental.',
    }),
    gap: 'Minimal schema exists; runtime resolved-task/queue integration and downloader compatibility checks are incomplete.',
  }),
  Object.freeze({
    name: 'DownloadPolicy',
    status: 'partial',
    version: DOWNLOAD_POLICY_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/sites/capability/download-policy.mjs',
    standardArtifact: standardArtifactEvidence({
      family: 'DownloaderBoundaries',
      role: 'low-permission-download-policy',
      artifactName: 'DownloadPolicy',
      producerPath: 'src/sites/capability/planner-policy-handoff.mjs',
      consumerPaths: [
        'src/sites/downloads/contracts.mjs',
      ],
      verificationPaths: [
        'tests/node/download-policy.test.mjs',
        'tests/node/planner-policy-handoff.test.mjs',
        'tests/node/downloads-runner.test.mjs',
        'tests/node/schema-inventory.test.mjs',
      ],
      gap: 'Planner handoff and download plan normalization are governed; end-to-end native site planner rollout remains incomplete.',
    }),
    gap: 'Minimal schema exists; runtime plan.policy integration and broader downloader compatibility checks are incomplete.',
  }),
  Object.freeze({
    name: 'SessionView',
    status: 'partial',
    version: SESSION_VIEW_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/sites/capability/session-view.mjs',
    standardArtifact: standardArtifactEvidence({
      family: 'SessionBoundary',
      role: 'minimal-session-view',
      artifactName: 'SessionView',
      producerPath: 'src/sites/sessions/manifest-bridge.mjs',
      consumerPaths: [
        'src/sites/downloads/contracts.mjs',
        'src/sites/downloads/runner.mjs',
      ],
      verificationPaths: [
        'tests/node/session-view.test.mjs',
        'tests/node/downloads-runner.test.mjs',
        'tests/node/site-session-runner.test.mjs',
        'tests/node/schema-inventory.test.mjs',
      ],
      gap: 'Unified session bridge and downloader consumer boundary exist; broader runtime SessionView adoption and revocation-handle governance remain incomplete.',
    }),
    gap: 'Minimal schema exists; session materialization runner and downloader integration are incomplete.',
  }),
  Object.freeze({
    name: 'RiskState',
    status: 'partial',
    version: RISK_STATE_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/sites/capability/risk-state.mjs',
    standardArtifact: standardArtifactEvidence({
      family: 'RiskSemantics',
      role: 'standard-risk-state',
      artifactName: 'RiskState',
      producerPath: 'src/sites/downloads/runner.mjs',
      consumerPaths: [
        'src/sites/downloads/contracts.mjs',
        'src/sites/social/actions/router.mjs',
        'src/infra/auth/site-session-governance.mjs',
      ],
      verificationPaths: [
        'tests/node/risk-state.test.mjs',
        'tests/node/downloads-runner.test.mjs',
        'tests/node/site-session-governance.test.mjs',
        'tests/node/social-action-router.test.mjs',
        'tests/node/schema-inventory.test.mjs',
      ],
      gap: 'Downloader and governance producers emit governed RiskState evidence; complete cross-site risk producer coverage remains incremental.',
    }),
    gap: 'Minimal schema exists; runtime RiskStateMachine transitions and producer integration remain distributed.',
  }),
  Object.freeze({
    name: 'CapabilityHook',
    status: 'partial',
    version: CAPABILITY_HOOK_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/sites/capability/capability-hook.mjs',
    standardArtifact: standardArtifactEvidence({
      family: 'LifecycleEvents',
      role: 'descriptor-only-hook-output-boundary',
      artifactName: 'CapabilityHook',
      producerPath: 'src/sites/capability/capability-hook.mjs',
      consumerPaths: [
        'src/sites/capability/api-candidates.mjs',
      ],
      verificationPaths: [
        'tests/node/capability-hook.test.mjs',
        'tests/node/schema-inventory.test.mjs',
      ],
      gap: 'Descriptor-only hook inventory exists for lifecycle event matching; runtime hook execution policy remains intentionally unconnected.',
    }),
    gap: 'Minimal schema exists; lifecycle dispatcher registration and runtime hook integration are incomplete.',
  }),
  Object.freeze({
    name: 'CapabilityHookEventTypeRegistry',
    status: 'partial',
    version: CAPABILITY_HOOK_EVENT_TYPE_REGISTRY_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/sites/capability/capability-hook.mjs',
    gap: 'Versioned event-type allowlist exists for current LifecycleEvent producers; runtime hook execution policy remains intentionally unconnected.',
  }),
  Object.freeze({
    name: 'CapabilityHookProducerDescriptorRegistry',
    status: 'implemented',
    version: CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_REGISTRY_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/sites/capability/capability-hook.mjs',
    kernelGovernance: kernelSchemaGovernanceEvidence({
      family: 'LifecycleEvents',
      role: 'high-risk-lifecycle-producer-descriptor-inventory',
      inventoryName: 'CapabilityHookProducerDescriptorRegistry',
      producerPath: 'src/sites/capability/capability-hook.mjs',
      compatibilitySchemaName: 'CapabilityHookProducerDescriptorRegistry',
      verificationPaths: [
        'tests/node/capability-hook.test.mjs',
        'tests/node/compatibility-registry.test.mjs',
        'tests/node/schema-inventory.test.mjs',
      ],
      gap: 'High-risk lifecycle producers are governed through descriptor-only, fail-closed producer profiles; full producer coverage remains incremental.',
    }),
    gap: 'Descriptor-only producer inventory and central compatibility guard exist for high-risk LifecycleEvent producers; broader non-critical producer descriptor coverage remains incremental.',
  }),
  Object.freeze({
    name: 'CapabilityHookRegistrySnapshot',
    status: 'partial',
    version: CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/sites/capability/capability-hook.mjs',
    gap: 'Versioned descriptor-only registry snapshot exists; runtime hook execution policy remains intentionally unconnected.',
  }),
  Object.freeze({
    name: 'FocusedRegressionBatchDefinition',
    status: 'partial',
    version: FOCUSED_REGRESSION_BATCH_DEFINITION_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/sites/capability/focused-regression-batches.mjs',
    gap: 'Versioned focused regression batch definition exists for A/B loop verification; full release validation remains deferred by policy.',
  }),
  Object.freeze({
    name: 'ArtifactReferenceSet',
    status: 'partial',
    version: ARTIFACT_REFERENCE_SET_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/sites/capability/artifact-schema.mjs',
    standardArtifact: standardArtifactEvidence({
      family: 'Artifacts',
      role: 'artifact-reference-set',
      artifactName: 'ArtifactReferenceSet',
      producerPath: 'src/sites/capability/artifact-schema.mjs',
      consumerPaths: [
        'src/sites/downloads/contracts.mjs',
        'src/sites/sessions/contracts.mjs',
      ],
      verificationPaths: [
        'tests/node/downloads-runner.test.mjs',
        'tests/node/schema-inventory.test.mjs',
      ],
      gap: 'Reference-set schema is governed and consumed by manifests; full payload-family artifact schemas and universal writer coverage remain incomplete.',
    }),
    gap: 'Versioned artifact reference set exists and is consumed by download run manifests; broader artifact payload schemas and repository-wide writer coverage remain incomplete.',
  }),
  Object.freeze({
    name: 'ManifestArtifactBundle',
    status: 'partial',
    version: MANIFEST_ARTIFACT_BUNDLE_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/sites/capability/artifact-schema.mjs',
    standardArtifact: standardArtifactEvidence({
      family: 'ManifestArtifacts',
      role: 'manifest-payload-artifact-bundle',
      artifactName: 'ManifestArtifactBundle',
      producerPath: 'src/sites/capability/artifact-schema.mjs',
      consumerPaths: [
        'src/sites/downloads/contracts.mjs',
        'src/sites/sessions/contracts.mjs',
      ],
      verificationPaths: [
        'tests/node/schema-inventory.test.mjs',
      ],
      gap: 'Payload-family bundle schema records manifest/artifact compatibility evidence; runtime manifest writers still emit raw manifest payloads directly.',
    }),
    gap: 'Versioned manifest payload-family schema exists for manifest artifact bundle compatibility evidence; runtime writer adoption remains incremental.',
  }),
  Object.freeze({
    name: 'RedactionAudit',
    status: 'implemented',
    version: SECURITY_GUARD_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/sites/capability/security-guard.mjs',
    standardArtifact: standardArtifactEvidence({
      family: 'ArtifactAudits',
      role: 'redaction-audit-sidecar',
      artifactName: 'RedactionAudit',
      producerPath: 'src/sites/capability/security-guard.mjs',
      consumerPaths: [
        'src/sites/capability/api-candidates.mjs',
        'src/sites/capability/planner-policy-handoff.mjs',
        'src/sites/downloads/runner.mjs',
        'src/sites/sessions/runner.mjs',
      ],
      verificationPaths: [
        'tests/node/security-guard-redaction.test.mjs',
        'tests/node/planner-policy-handoff.test.mjs',
        'tests/node/schema-inventory.test.mjs',
      ],
      gap: 'Paired redaction audit sidecars are versioned and covered for current writers; repository-wide artifact writer coverage remains incremental.',
    }),
    gap: 'SecurityGuard redaction audit schema and paired sidecar writers exist; universal writer enforcement is still incremental.',
  }),
]);

export function listSchemaInventory() {
  return SCHEMA_INVENTORY.map((entry) => ({ ...entry }));
}

export function getSchemaInventoryEntry(name) {
  return listSchemaInventory().find((entry) => entry.name === name) ?? null;
}

export function listMissingSchemas() {
  return listSchemaInventory().filter((entry) => entry.status === 'missing');
}

export function listStandardArtifactInventory() {
  return listSchemaInventory().filter(
    (entry) => entry.standardArtifact?.section === STANDARD_ARTIFACT_SECTION,
  );
}

export function listKernelSchemaGovernanceInventory() {
  return listSchemaInventory().filter(
    (entry) => entry.kernelGovernance?.section === KERNEL_SCHEMA_GOVERNANCE_SECTION,
  );
}
