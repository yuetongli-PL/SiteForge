// @ts-check

import { SESSION_RUN_MANIFEST_SCHEMA_VERSION } from '../sessions/contracts.mjs';
import {
  API_CANDIDATE_SCHEMA_VERSION,
  API_CATALOG_INDEX_SCHEMA_VERSION,
  API_CATALOG_SCHEMA_VERSION,
  API_CATALOG_ENTRY_SCHEMA_VERSION,
  API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION,
  SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION,
  SITE_ADAPTER_CATALOG_UPGRADE_POLICY_SCHEMA_VERSION,
} from '../capabilities/api-candidates.mjs';
import {
  ARTIFACT_REFERENCE_SET_SCHEMA_VERSION,
  MANIFEST_ARTIFACT_BUNDLE_SCHEMA_VERSION,
} from '../artifacts/schema.mjs';
import {
  CAPABILITY_HOOK_EVENT_TYPE_REGISTRY_SCHEMA_VERSION,
  CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_REGISTRY_SCHEMA_VERSION,
  CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION,
  CAPABILITY_HOOK_SCHEMA_VERSION,
} from '../lifecycle/capability-hook.mjs';
import { DOWNLOAD_POLICY_SCHEMA_VERSION } from '../policies/download-policy.mjs';
import { FOCUSED_REGRESSION_BATCH_DEFINITION_SCHEMA_VERSION } from '../capabilities/focused-regression-batches.mjs';
import { LIFECYCLE_EVENT_SCHEMA_VERSION } from '../lifecycle/lifecycle-events.mjs';
import { REASON_CODE_SCHEMA_VERSION } from '../risks/reason-codes.mjs';
import { RISK_STATE_SCHEMA_VERSION } from '../risks/risk-state.mjs';
import { SECURITY_GUARD_SCHEMA_VERSION } from '../sessions/security-guard.mjs';
import { SESSION_VIEW_SCHEMA_VERSION } from '../sessions/session-view.mjs';
import {
  GRAPH_DOCS_SUMMARY_SCHEMA_VERSION,
  GRAPH_EDGE_SCHEMA_VERSION,
  GRAPH_MANIFEST_SCHEMA_VERSION,
  GRAPH_NODE_SCHEMA_VERSION,
  GRAPH_NODE_TYPES,
  GRAPH_QUERY_RESULT_SCHEMA_VERSION,
  GRAPH_VALIDATION_REPORT_SCHEMA_VERSION,
  SITE_CAPABILITY_GRAPH_SCHEMA_VERSION,
} from '../capabilities/site-capability-graph.mjs';
import { STANDARD_TASK_LIST_SCHEMA_VERSION } from '../policies/standard-task-list.mjs';

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
    sourcePath: 'src/domain/risks/reason-codes.mjs',
    gap: 'Versioned taxonomy exists; full failure-mode coverage is still tracked by Section 15.',
  }),
  Object.freeze({
    name: 'SiteCapabilityGraph',
    status: 'partial',
    version: SITE_CAPABILITY_GRAPH_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/domain/capabilities/site-capability-graph.mjs',
    gap: 'Graph schema compatibility exists; Layer runtime consumption and site graph generation remain incomplete.',
  }),
  Object.freeze({
    name: 'GraphManifest',
    status: 'implemented',
    version: GRAPH_MANIFEST_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/domain/capabilities/site-capability-graph.mjs',
    gap: 'Manifest compatibility exists; generated site graph manifests are not yet produced from Layer sources.',
  }),
  Object.freeze({
    name: 'GraphNode',
    status: 'implemented',
    version: GRAPH_NODE_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/domain/capabilities/site-capability-graph.mjs',
    gap: 'Core node compatibility exists; complete site-specific node generation remains incremental.',
  }),
  ...GRAPH_NODE_TYPES.map((name) => Object.freeze({
    name,
    status: 'implemented',
    version: GRAPH_NODE_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/domain/capabilities/site-capability-graph.mjs',
    gap: 'Graph node subtype is governed by the central GraphNode schema and compatibility assertion.',
  })),
  Object.freeze({
    name: 'GraphEdge',
    status: 'implemented',
    version: GRAPH_EDGE_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/domain/capabilities/site-capability-graph.mjs',
    gap: 'Core edge compatibility exists; complete site-specific edge generation remains incremental.',
  }),
  Object.freeze({
    name: 'GraphValidationReport',
    status: 'implemented',
    version: GRAPH_VALIDATION_REPORT_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/domain/capabilities/site-capability-graph.mjs',
    gap: 'Validation report compatibility exists; persistent graph validation report writer is not yet implemented.',
  }),
  Object.freeze({
    name: 'GraphQueryResult',
    status: 'implemented',
    version: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/domain/capabilities/site-capability-graph.mjs',
    gap: 'Query result compatibility exists; Layer consumers do not yet use Graph query results.',
  }),
  Object.freeze({
    name: 'LayerSourceRiskPolicyInventorySummary',
    status: 'implemented',
    version: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/domain/capabilities/site-capability-graph.mjs',
    kernelGovernance: kernelSchemaGovernanceEvidence({
      family: 'SiteCapabilityGraph',
      role: 'layer-source-risk-policy-inventory-summary',
      inventoryName: 'LayerSourceRiskPolicyInventorySummary',
      producerPath: 'src/domain/capabilities/site-capability-graph.mjs',
      compatibilitySchemaName: 'LayerSourceRiskPolicyInventorySummary',
      verificationPaths: [
        'tests/node/site-capability-graph-generated-fixture.test.mjs',
        'tests/node/compatibility-registry.test.mjs',
        'tests/node/schema-inventory.test.mjs',
      ],
      gap: 'Layer-source RiskPolicy inventory summary is governed as a GraphQueryResult-compatible descriptor; no runtime writer is introduced.',
    }),
    gap: 'Layer-source RiskPolicy inventory summary helper has central compatibility coverage using the GraphQueryResult schema; runtime writer adoption is intentionally unchanged.',
  }),
  Object.freeze({
    name: 'LayerSourceAuthSessionRequirementInventorySummary',
    status: 'implemented',
    version: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/domain/capabilities/site-capability-graph.mjs',
    kernelGovernance: kernelSchemaGovernanceEvidence({
      family: 'SiteCapabilityGraph',
      role: 'layer-source-auth-session-requirement-inventory-summary',
      inventoryName: 'LayerSourceAuthSessionRequirementInventorySummary',
      producerPath: 'src/domain/capabilities/site-capability-graph.mjs',
      compatibilitySchemaName: 'LayerSourceAuthSessionRequirementInventorySummary',
      verificationPaths: [
        'tests/node/site-capability-graph-generated-fixture.test.mjs',
        'tests/node/compatibility-registry.test.mjs',
        'tests/node/schema-inventory.test.mjs',
      ],
      gap: 'Layer-source auth/session requirement inventory summary is governed as a GraphQueryResult-compatible descriptor; no runtime writer is introduced.',
    }),
    gap: 'Layer-source auth/session requirement inventory summary helper has central compatibility coverage using the GraphQueryResult schema; runtime writer adoption is intentionally unchanged.',
  }),
  Object.freeze({
    name: 'LayerSourceSignerDependencyInventorySummary',
    status: 'implemented',
    version: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/domain/capabilities/site-capability-graph.mjs',
    kernelGovernance: kernelSchemaGovernanceEvidence({
      family: 'SiteCapabilityGraph',
      role: 'layer-source-signer-dependency-inventory-summary',
      inventoryName: 'LayerSourceSignerDependencyInventorySummary',
      producerPath: 'src/domain/capabilities/site-capability-graph.mjs',
      compatibilitySchemaName: 'LayerSourceSignerDependencyInventorySummary',
      verificationPaths: [
        'tests/node/site-capability-graph-generated-fixture.test.mjs',
        'tests/node/compatibility-registry.test.mjs',
        'tests/node/schema-inventory.test.mjs',
      ],
      gap: 'Layer-source signer dependency inventory summary is governed as a GraphQueryResult-compatible descriptor; no runtime writer is introduced.',
    }),
    gap: 'Layer-source signer dependency inventory summary helper has central compatibility coverage using the GraphQueryResult schema; runtime writer adoption is intentionally unchanged.',
  }),
  Object.freeze({
    name: 'GraphDocsSummary',
    status: 'implemented',
    version: GRAPH_DOCS_SUMMARY_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/domain/capabilities/site-capability-graph.mjs',
    gap: 'Docs summary compatibility exists; persistent graph docs writer and Layer docs consumer are not yet implemented.',
  }),
  Object.freeze({
    name: 'LifecycleEvent',
    status: 'partial',
    version: LIFECYCLE_EVENT_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/domain/lifecycle/lifecycle-events.mjs',
    standardArtifact: standardArtifactEvidence({
      family: 'LifecycleEvents',
      role: 'standard-event-envelope',
      artifactName: 'LifecycleEvent',
      producerPath: 'src/domain/lifecycle/lifecycle-events.mjs',
      consumerPaths: [
        'src/app/pipeline/stages/capture.mjs',
        'src/domain/sessions/runner.mjs',
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
    sourcePath: 'src/domain/capabilities/api-candidates.mjs',
    gap: 'Minimal schema exists; persistent candidate artifacts and producer flow are incomplete.',
  }),
  Object.freeze({
    name: 'ApiCatalogEntry',
    status: 'partial',
    version: API_CATALOG_ENTRY_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/domain/capabilities/api-candidates.mjs',
    gap: 'Minimal entry schema exists; full catalog store and SiteAdapter validation are incomplete.',
  }),
  Object.freeze({
    name: 'ApiCatalog',
    status: 'partial',
    version: API_CATALOG_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/domain/capabilities/api-candidates.mjs',
    gap: 'Minimal collection schema exists; live promotion workflow and broader store lifecycle are incomplete.',
  }),
  Object.freeze({
    name: 'ApiCatalogIndex',
    status: 'partial',
    version: API_CATALOG_INDEX_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/domain/capabilities/api-candidates.mjs',
    standardArtifact: standardArtifactEvidence({
      family: 'api-catalog',
      role: 'catalog-index',
      artifactName: 'ApiCatalogIndex',
      producerPath: 'src/domain/capabilities/api-candidates.mjs',
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
    sourcePath: 'src/domain/capabilities/api-candidates.mjs',
    gap: 'Minimal response summary schema exists; runtime NetworkCapture/BrowserSession wiring and real response verification are incomplete.',
  }),
  Object.freeze({
    name: 'SiteAdapterCandidateDecision',
    status: 'partial',
    version: SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/domain/capabilities/api-candidates.mjs',
    gap: 'Minimal decision schema exists; site-specific validation implementations and catalog promotion workflow are incomplete.',
  }),
  Object.freeze({
    name: 'SiteAdapterCatalogUpgradePolicy',
    status: 'partial',
    version: SITE_ADAPTER_CATALOG_UPGRADE_POLICY_SCHEMA_VERSION,
    owner: 'Capability',
    sourcePath: 'src/domain/capabilities/api-candidates.mjs',
    gap: 'Minimal SiteAdapter-owned policy input schema exists; concrete site-specific upgrade rules and catalog store integration are incomplete.',
  }),
  Object.freeze({
    name: 'SessionRunManifest',
    status: 'partial',
    version: SESSION_RUN_MANIFEST_SCHEMA_VERSION,
    owner: 'Session',
    sourcePath: 'src/domain/sessions/contracts.mjs',
    gap: 'Session run manifest exists; runtime SessionView materialization and broader downloader integration are incomplete.',
  }),
  Object.freeze({
    name: 'StandardTaskList',
    status: 'partial',
    version: STANDARD_TASK_LIST_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/domain/policies/standard-task-list.mjs',
    standardArtifact: standardArtifactEvidence({
      family: 'DownloaderBoundaries',
      role: 'low-permission-task-list',
      artifactName: 'StandardTaskList',
      producerPath: 'src/app/planner/policy-handoff.mjs',
      verificationPaths: [
        'tests/node/standard-task-list.test.mjs',
        'tests/node/planner-policy-handoff.test.mjs',
        'tests/node/schema-inventory.test.mjs',
      ],
      gap: 'Planner handoff produces governed task-list descriptors; the former download runtime consumer has been removed.',
    }),
    gap: 'Minimal schema exists; runtime resolved-task/queue integration remains incomplete after download runtime removal.',
  }),
  Object.freeze({
    name: 'DownloadPolicy',
    status: 'partial',
    version: DOWNLOAD_POLICY_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/domain/policies/download-policy.mjs',
    standardArtifact: standardArtifactEvidence({
      family: 'DownloaderBoundaries',
      role: 'low-permission-download-policy',
      artifactName: 'DownloadPolicy',
      producerPath: 'src/app/planner/policy-handoff.mjs',
      verificationPaths: [
        'tests/node/download-policy.test.mjs',
        'tests/node/planner-policy-handoff.test.mjs',
        'tests/node/schema-inventory.test.mjs',
      ],
      gap: 'Planner handoff and policy normalization are governed; the former download runtime consumer has been removed.',
    }),
    gap: 'Minimal schema exists; runtime plan.policy integration remains incomplete after download runtime removal.',
  }),
  Object.freeze({
    name: 'SessionView',
    status: 'partial',
    version: SESSION_VIEW_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/domain/sessions/session-view.mjs',
    standardArtifact: standardArtifactEvidence({
      family: 'SessionBoundary',
      role: 'minimal-session-view',
      artifactName: 'SessionView',
      producerPath: 'src/domain/sessions/manifest-bridge.mjs',
      consumerPaths: [
        'src/domain/sessions/runner.mjs',
      ],
      verificationPaths: [
        'tests/node/session-view.test.mjs',
        'tests/node/site-session-runner.test.mjs',
        'tests/node/schema-inventory.test.mjs',
      ],
      gap: 'Unified session bridge exists; broader runtime SessionView adoption and revocation-handle governance remain incomplete.',
    }),
    gap: 'Minimal schema exists; session materialization runner integration is incomplete.',
  }),
  Object.freeze({
    name: 'RiskState',
    status: 'partial',
    version: RISK_STATE_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/domain/risks/risk-state.mjs',
    standardArtifact: standardArtifactEvidence({
      family: 'RiskSemantics',
      role: 'standard-risk-state',
      artifactName: 'RiskState',
      producerPath: 'src/infra/auth/site-session-governance.mjs',
      consumerPaths: [
        'src/sites/known-sites/social/actions/router.mjs',
        'src/infra/auth/site-session-governance.mjs',
      ],
      verificationPaths: [
        'tests/node/risk-state.test.mjs',
        'tests/node/site-session-governance.test.mjs',
        'tests/node/social-action-router.test.mjs',
        'tests/node/schema-inventory.test.mjs',
      ],
      gap: 'Governance producers emit governed RiskState evidence; complete cross-site risk producer coverage remains incremental.',
    }),
    gap: 'Minimal schema exists; runtime RiskStateMachine transitions and producer integration remain distributed.',
  }),
  Object.freeze({
    name: 'CapabilityHook',
    status: 'partial',
    version: CAPABILITY_HOOK_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/domain/lifecycle/capability-hook.mjs',
    standardArtifact: standardArtifactEvidence({
      family: 'LifecycleEvents',
      role: 'descriptor-only-hook-output-boundary',
      artifactName: 'CapabilityHook',
      producerPath: 'src/domain/lifecycle/capability-hook.mjs',
      consumerPaths: [
        'src/domain/capabilities/api-candidates.mjs',
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
    sourcePath: 'src/domain/lifecycle/capability-hook.mjs',
    gap: 'Versioned event-type allowlist exists for current LifecycleEvent producers; runtime hook execution policy remains intentionally unconnected.',
  }),
  Object.freeze({
    name: 'CapabilityHookProducerDescriptorRegistry',
    status: 'implemented',
    version: CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_REGISTRY_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/domain/lifecycle/capability-hook.mjs',
    kernelGovernance: kernelSchemaGovernanceEvidence({
      family: 'LifecycleEvents',
      role: 'high-risk-lifecycle-producer-descriptor-inventory',
      inventoryName: 'CapabilityHookProducerDescriptorRegistry',
      producerPath: 'src/domain/lifecycle/capability-hook.mjs',
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
    sourcePath: 'src/domain/lifecycle/capability-hook.mjs',
    gap: 'Versioned descriptor-only registry snapshot exists; runtime hook execution policy remains intentionally unconnected.',
  }),
  Object.freeze({
    name: 'FocusedRegressionBatchDefinition',
    status: 'partial',
    version: FOCUSED_REGRESSION_BATCH_DEFINITION_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/domain/capabilities/focused-regression-batches.mjs',
    gap: 'Versioned focused regression batch definition exists for A/B loop verification; full release validation remains deferred by policy.',
  }),
  Object.freeze({
    name: 'ArtifactReferenceSet',
    status: 'partial',
    version: ARTIFACT_REFERENCE_SET_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/domain/artifacts/schema.mjs',
    standardArtifact: standardArtifactEvidence({
      family: 'Artifacts',
      role: 'artifact-reference-set',
      artifactName: 'ArtifactReferenceSet',
      producerPath: 'src/domain/artifacts/schema.mjs',
      consumerPaths: [
        'src/domain/sessions/contracts.mjs',
      ],
      verificationPaths: [
        'tests/node/schema-inventory.test.mjs',
      ],
      gap: 'Reference-set schema is governed and consumed by manifests; full payload-family artifact schemas and universal writer coverage remain incomplete.',
    }),
    gap: 'Versioned artifact reference set exists and is consumed by session run manifests; broader artifact payload schemas and repository-wide writer coverage remain incomplete.',
  }),
  Object.freeze({
    name: 'ManifestArtifactBundle',
    status: 'partial',
    version: MANIFEST_ARTIFACT_BUNDLE_SCHEMA_VERSION,
    owner: 'Kernel',
    sourcePath: 'src/domain/artifacts/schema.mjs',
    standardArtifact: standardArtifactEvidence({
      family: 'ManifestArtifacts',
      role: 'manifest-payload-artifact-bundle',
      artifactName: 'ManifestArtifactBundle',
      producerPath: 'src/domain/artifacts/schema.mjs',
      consumerPaths: [
        'src/domain/sessions/contracts.mjs',
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
    sourcePath: 'src/domain/sessions/security-guard.mjs',
    standardArtifact: standardArtifactEvidence({
      family: 'ArtifactAudits',
      role: 'redaction-audit-sidecar',
      artifactName: 'RedactionAudit',
      producerPath: 'src/domain/sessions/security-guard.mjs',
      consumerPaths: [
        'src/domain/capabilities/api-candidates.mjs',
        'src/app/planner/policy-handoff.mjs',
        'src/domain/sessions/runner.mjs',
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
