// @ts-check

import {
  API_CANDIDATE_SCHEMA_VERSION,
  API_CATALOG_ENTRY_SCHEMA_VERSION,
  API_CATALOG_INDEX_SCHEMA_VERSION,
  API_CATALOG_SCHEMA_VERSION,
  API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION,
} from './api-candidates.mjs';
import { ARTIFACT_REFERENCE_SET_SCHEMA_VERSION } from './artifact-schema.mjs';
import {
  CAPABILITY_HOOK_EVENT_TYPE_REGISTRY_SCHEMA_VERSION,
  CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION,
  CAPABILITY_HOOK_SCHEMA_VERSION,
} from './capability-hook.mjs';
import { DOWNLOAD_POLICY_SCHEMA_VERSION } from './download-policy.mjs';
import { LIFECYCLE_EVENT_SCHEMA_VERSION } from './lifecycle-events.mjs';
import { NETWORK_CAPTURE_REQUEST_SCHEMA_VERSION } from './network-capture.mjs';
import { RISK_STATE_SCHEMA_VERSION } from './risk-state.mjs';
import { SECURITY_GUARD_SCHEMA_VERSION } from './security-guard.mjs';
import { SESSION_VIEW_SCHEMA_VERSION } from './session-view.mjs';
import { SITE_HEALTH_EXECUTION_GATE_SCHEMA_VERSION } from './site-health-execution-gate.mjs';
import { SITE_HEALTH_RECOVERY_SCHEMA_VERSION } from './site-health-recovery.mjs';
import { SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION } from './site-onboarding-discovery.mjs';
import { STANDARD_TASK_LIST_SCHEMA_VERSION } from './standard-task-list.mjs';

export const CAPABILITY_SERVICE_INVENTORY_SCHEMA_VERSION = 1;

export const CAPABILITY_SERVICE_SAFE_BOUNDARY_ROLES = Object.freeze([
  'capture-producer',
  'catalog-governor',
  'session-view-provider',
  'risk-state-machine',
  'redaction-guard',
  'artifact-schema-governor',
  'policy-provider',
  'lifecycle-hook-descriptor',
  'node-inventory-producer',
  'coverage-gate',
  'unknown-node-reporter',
  'health-risk-normalizer',
  'health-recovery-engine',
  'health-execution-gate',
]);

export const CAPABILITY_SERVICE_MODULE_PREFIX = 'src/sites/capability/';

const SAFE_BOUNDARY_ROLE_SET = new Set(CAPABILITY_SERVICE_SAFE_BOUNDARY_ROLES);
const REPO_ROOT_URL = new URL('../../../', import.meta.url);
const CONCRETE_SITE_SEMANTIC_PATTERN =
  /\b(?:22biqu|bilibili|douyin|instagram|jable|moodyz|xiaohongshu)\b/iu;

function schemaEvidence({
  schemaName,
  version,
  modulePath,
  exportName,
}) {
  return Object.freeze({
    schemaName,
    version,
    modulePath,
    exportName,
  });
}

function boundary({
  role,
  owner = 'CapabilityService',
  producerRole,
  consumerRole,
  safeBoundary,
}) {
  return Object.freeze({
    role,
    owner,
    producerRole,
    consumerRole,
    safeBoundary,
    forbiddenMaterial: Object.freeze([
      'raw credentials',
      'raw cookies',
      'authorization headers',
      'CSRF tokens',
      'raw session ids',
      'browser profile paths',
      'unredacted session material',
    ]),
  });
}

function siteSemanticsStatement(statement) {
  return Object.freeze({
    concreteSiteSemanticsAllowed: false,
    siteSpecificInterpretationOwner: 'SiteAdapter',
    statement,
  });
}

function serviceEntry({
  stableName,
  serviceKind,
  modulePath,
  exportedSymbols,
  schemaEvidence: serviceSchemaEvidence,
  safeBoundaryRole,
  siteSemantics,
}) {
  return Object.freeze({
    schemaVersion: CAPABILITY_SERVICE_INVENTORY_SCHEMA_VERSION,
    stableName,
    serviceKind,
    modulePath,
    exportedSymbols: Object.freeze([...exportedSymbols]),
    schemaEvidence: Object.freeze([...serviceSchemaEvidence]),
    safeBoundaryRole,
    siteSemantics,
  });
}

const NETWORK_CAPTURE_MODULE = 'src/sites/capability/network-capture.mjs';
const API_DISCOVERY_MODULE = 'src/sites/capability/api-discovery.mjs';
const API_CANDIDATES_MODULE = 'src/sites/capability/api-candidates.mjs';
const SESSION_VIEW_MODULE = 'src/sites/capability/session-view.mjs';
const RISK_STATE_MODULE = 'src/sites/capability/risk-state.mjs';
const SECURITY_GUARD_MODULE = 'src/sites/capability/security-guard.mjs';
const ARTIFACT_SCHEMA_MODULE = 'src/sites/capability/artifact-schema.mjs';
const STANDARD_TASK_LIST_MODULE = 'src/sites/capability/standard-task-list.mjs';
const DOWNLOAD_POLICY_MODULE = 'src/sites/capability/download-policy.mjs';
const LIFECYCLE_EVENTS_MODULE = 'src/sites/capability/lifecycle-events.mjs';
const CAPABILITY_HOOK_MODULE = 'src/sites/capability/capability-hook.mjs';
const SITE_ONBOARDING_DISCOVERY_MODULE = 'src/sites/capability/site-onboarding-discovery.mjs';
const SITE_HEALTH_RECOVERY_MODULE = 'src/sites/capability/site-health-recovery.mjs';
const SITE_HEALTH_EXECUTION_GATE_MODULE = 'src/sites/capability/site-health-execution-gate.mjs';

const CAPABILITY_SERVICE_INVENTORY = Object.freeze([
  serviceEntry({
    stableName: 'NetworkCaptureService',
    serviceKind: 'capture',
    modulePath: NETWORK_CAPTURE_MODULE,
    exportedSymbols: [
      'NETWORK_CAPTURE_REQUEST_SCHEMA_VERSION',
      'observedRequestFromNetworkCaptureEvent',
      'observedRequestsFromNetworkCaptureEvents',
      'responseSummaryFromNetworkCaptureEvent',
      'responseSummariesFromNetworkCaptureEvents',
      'assertNoNetworkCaptureSiteSemanticClassification',
    ],
    schemaEvidence: [
      schemaEvidence({
        schemaName: 'NetworkCaptureRequest',
        version: NETWORK_CAPTURE_REQUEST_SCHEMA_VERSION,
        modulePath: NETWORK_CAPTURE_MODULE,
        exportName: 'NETWORK_CAPTURE_REQUEST_SCHEMA_VERSION',
      }),
      schemaEvidence({
        schemaName: 'ApiResponseCaptureSummary',
        version: API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION,
        modulePath: API_CANDIDATES_MODULE,
        exportName: 'API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION',
      }),
    ],
    safeBoundaryRole: boundary({
      role: 'capture-producer',
      producerRole: 'BrowserSession/network observer',
      consumerRole: 'ApiDiscoveryService',
      safeBoundary: 'Produces redacted, site-agnostic observed request and response summaries only.',
    }),
    siteSemantics: siteSemanticsStatement(
      'NetworkCaptureService records protocol evidence only; SiteAdapter owns page type, auth state, and site API meaning.',
    ),
  }),
  serviceEntry({
    stableName: 'ApiDiscoveryService',
    serviceKind: 'api-discovery',
    modulePath: API_DISCOVERY_MODULE,
    exportedSymbols: [
      'apiCandidateFromObservedRequest',
      'writeApiCandidateArtifactsFromObservedRequests',
      'writeApiCandidateArtifactsFromCaptureOutput',
      'validateApiCandidateWithAdapter',
      'writeSiteAdapterCandidateDecisionArtifacts',
    ],
    schemaEvidence: [
      schemaEvidence({
        schemaName: 'ApiCandidate',
        version: API_CANDIDATE_SCHEMA_VERSION,
        modulePath: API_CANDIDATES_MODULE,
        exportName: 'API_CANDIDATE_SCHEMA_VERSION',
      }),
    ],
    safeBoundaryRole: boundary({
      role: 'capture-producer',
      producerRole: 'NetworkCaptureService',
      consumerRole: 'ApiKnowledgeService/SiteAdapter candidate validation',
      safeBoundary: 'Converts observed requests into redacted candidate artifacts without deciding concrete site meaning.',
    }),
    siteSemantics: siteSemanticsStatement(
      'ApiDiscoveryService may preserve evidence but concrete endpoint roles are assigned by SiteAdapter validation.',
    ),
  }),
  serviceEntry({
    stableName: 'ApiKnowledgeService',
    serviceKind: 'api-catalog',
    modulePath: API_CANDIDATES_MODULE,
    exportedSymbols: [
      'assertApiCandidateCompatible',
      'assertApiCatalogEntryCompatible',
      'assertApiCatalogCompatible',
      'assertApiCatalogIndexCompatible',
      'createApiCatalogEntryFromCandidate',
      'createApiCatalogCollection',
      'createApiCatalogIndex',
      'writeApiCatalogCollectionArtifact',
      'writeApiCatalogIndexArtifact',
    ],
    schemaEvidence: [
      schemaEvidence({
        schemaName: 'ApiCandidate',
        version: API_CANDIDATE_SCHEMA_VERSION,
        modulePath: API_CANDIDATES_MODULE,
        exportName: 'API_CANDIDATE_SCHEMA_VERSION',
      }),
      schemaEvidence({
        schemaName: 'ApiCatalogEntry',
        version: API_CATALOG_ENTRY_SCHEMA_VERSION,
        modulePath: API_CANDIDATES_MODULE,
        exportName: 'API_CATALOG_ENTRY_SCHEMA_VERSION',
      }),
      schemaEvidence({
        schemaName: 'ApiCatalog',
        version: API_CATALOG_SCHEMA_VERSION,
        modulePath: API_CANDIDATES_MODULE,
        exportName: 'API_CATALOG_SCHEMA_VERSION',
      }),
      schemaEvidence({
        schemaName: 'ApiCatalogIndex',
        version: API_CATALOG_INDEX_SCHEMA_VERSION,
        modulePath: API_CANDIDATES_MODULE,
        exportName: 'API_CATALOG_INDEX_SCHEMA_VERSION',
      }),
    ],
    safeBoundaryRole: boundary({
      role: 'catalog-governor',
      producerRole: 'SiteAdapter candidate verifier',
      consumerRole: 'Kernel catalog store/runtime maintenance',
      safeBoundary: 'Stores versioned catalog evidence and status transitions while keeping site interpretation outside the catalog contract.',
    }),
    siteSemantics: siteSemanticsStatement(
      'ApiKnowledgeService stores catalog evidence and validation status; concrete site endpoint semantics remain SiteAdapter-owned.',
    ),
  }),
  serviceEntry({
    stableName: 'SessionProvider',
    serviceKind: 'session-view',
    modulePath: SESSION_VIEW_MODULE,
    exportedSymbols: [
      'SESSION_VIEW_SCHEMA_VERSION',
      'assertSessionViewCompatible',
      'normalizeSessionView',
      'createSessionViewMaterializationAudit',
      'assertSessionViewSafe',
    ],
    schemaEvidence: [
      schemaEvidence({
        schemaName: 'SessionView',
        version: SESSION_VIEW_SCHEMA_VERSION,
        modulePath: SESSION_VIEW_MODULE,
        exportName: 'SESSION_VIEW_SCHEMA_VERSION',
      }),
    ],
    safeBoundaryRole: boundary({
      role: 'session-view-provider',
      producerRole: 'Session capability/runtime session manager',
      consumerRole: 'Kernel/downloader low-permission handoff',
      safeBoundary: 'Materializes minimal SessionView records and revocation handles without exposing raw session material.',
    }),
    siteSemantics: siteSemanticsStatement(
      'SessionProvider exposes permission and freshness signals only; account, profile, and site-specific login interpretation remain outside the service contract.',
    ),
  }),
  serviceEntry({
    stableName: 'RiskStateMachine',
    serviceKind: 'risk-state',
    modulePath: RISK_STATE_MODULE,
    exportedSymbols: [
      'RISK_STATE_SCHEMA_VERSION',
      'RISK_STATES',
      'createRiskStateTransitionTable',
      'assertRiskStateCompatible',
      'normalizeRiskState',
      'normalizeRiskTransition',
    ],
    schemaEvidence: [
      schemaEvidence({
        schemaName: 'RiskState',
        version: RISK_STATE_SCHEMA_VERSION,
        modulePath: RISK_STATE_MODULE,
        exportName: 'RISK_STATE_SCHEMA_VERSION',
      }),
    ],
    safeBoundaryRole: boundary({
      role: 'risk-state-machine',
      producerRole: 'Kernel/SiteAdapter risk signal mapper',
      consumerRole: 'Kernel retry, cooldown, isolation, and catalog-action decisions',
      safeBoundary: 'Maps normalized risk states to safe recovery behavior without bypassing access controls.',
    }),
    siteSemantics: siteSemanticsStatement(
      'RiskStateMachine consumes normalized risk categories; concrete site challenge text and detection rules are SiteAdapter-owned.',
    ),
  }),
  serviceEntry({
    stableName: 'HealthSignalNormalizer',
    serviceKind: 'health-signal-normalizer',
    modulePath: SITE_HEALTH_RECOVERY_MODULE,
    exportedSymbols: [
      'SITE_HEALTH_RECOVERY_SCHEMA_VERSION',
      'HEALTH_RISK_TYPES',
      'normalizeHealthRisk',
      'normalizeHealthSignal',
      'normalizeHealthSignals',
      'normalizeSiteAdapterHealthSignal',
      'createHealthSignalNormalizer',
    ],
    schemaEvidence: [
      schemaEvidence({
        schemaName: 'SiteHealthRecovery',
        version: SITE_HEALTH_RECOVERY_SCHEMA_VERSION,
        modulePath: SITE_HEALTH_RECOVERY_MODULE,
        exportName: 'SITE_HEALTH_RECOVERY_SCHEMA_VERSION',
      }),
    ],
    safeBoundaryRole: boundary({
      role: 'health-risk-normalizer',
      producerRole: 'SiteAdapter raw health signal mapper',
      consumerRole: 'SiteHealthRecoveryEngine and Kernel risk handling',
      safeBoundary: 'Normalizes redacted raw health signals into generic risk types without concrete site recovery logic.',
    }),
    siteSemantics: siteSemanticsStatement(
      'HealthSignalNormalizer consumes SiteAdapter-provided raw signal mappings; concrete site challenge detection remains SiteAdapter-owned.',
    ),
  }),
  serviceEntry({
    stableName: 'SiteHealthRecoveryEngine',
    serviceKind: 'health-recovery-engine',
    modulePath: SITE_HEALTH_RECOVERY_MODULE,
    exportedSymbols: [
      'SITE_HEALTH_RECOVERY_SCHEMA_VERSION',
      'RECOVERY_ACTIONS',
      'SITE_HEALTH_STATUSES',
      'SiteHealthRecoveryEngine',
      'RecoveryActionExecutor',
      'getDefaultRecoveryPolicy',
      'createCapabilityHealthRegistry',
      'createSiteHealthReport',
      'createUserRecoveryInstructions',
    ],
    schemaEvidence: [
      schemaEvidence({
        schemaName: 'SiteHealthRecovery',
        version: SITE_HEALTH_RECOVERY_SCHEMA_VERSION,
        modulePath: SITE_HEALTH_RECOVERY_MODULE,
        exportName: 'SITE_HEALTH_RECOVERY_SCHEMA_VERSION',
      }),
    ],
    safeBoundaryRole: boundary({
      role: 'health-recovery-engine',
      producerRole: 'HealthSignalNormalizer and RecoveryPolicyRegistry',
      consumerRole: 'Kernel recovery orchestration, audit, and capability health reporting',
      safeBoundary: 'Plans safe generic recovery, degradation, quarantine, or user-action outcomes without bypassing site controls.',
    }),
    siteSemantics: siteSemanticsStatement(
      'SiteHealthRecoveryEngine operates on generic risk and action taxonomies only; SiteAdapter owns site-specific signal interpretation.',
    ),
  }),
  serviceEntry({
    stableName: 'SiteHealthExecutionGate',
    serviceKind: 'health-execution-gate',
    modulePath: SITE_HEALTH_EXECUTION_GATE_MODULE,
    exportedSymbols: [
      'SITE_HEALTH_EXECUTION_GATE_SCHEMA_VERSION',
      'SITE_HEALTH_REPORT_ARTIFACT_NAME',
      'HEALTH_RECOVERY_AUDIT_ARTIFACT_NAME',
      'createRecoveryPolicyRegistry',
      'createCapabilityHealthStateCache',
      'evaluateSiteHealthExecutionGate',
      'applySiteHealthExecutionGateToTaskList',
      'SafeRecoveryActionExecutor',
      'createSiteHealthRecoveryLifecycleEvents',
    ],
    schemaEvidence: [
      schemaEvidence({
        schemaName: 'SiteHealthExecutionGate',
        version: SITE_HEALTH_EXECUTION_GATE_SCHEMA_VERSION,
        modulePath: SITE_HEALTH_EXECUTION_GATE_MODULE,
        exportName: 'SITE_HEALTH_EXECUTION_GATE_SCHEMA_VERSION',
      }),
    ],
    safeBoundaryRole: boundary({
      role: 'health-execution-gate',
      producerRole: 'SiteHealthRecoveryEngine report and capability health cache',
      consumerRole: 'Kernel/task entrypoints before write, download, or high-risk actions',
      safeBoundary: 'Consumes generic health reports to allow, block, readonly-degrade, or capability-disable tasks without site-specific recovery logic.',
    }),
    siteSemantics: siteSemanticsStatement(
      'SiteHealthExecutionGate consumes generic health report decisions only; SiteAdapter owns concrete site signal mapping.',
    ),
  }),
  serviceEntry({
    stableName: 'SecurityGuard',
    serviceKind: 'security',
    modulePath: SECURITY_GUARD_MODULE,
    exportedSymbols: [
      'SECURITY_GUARD_SCHEMA_VERSION',
      'REDACTION_PLACEHOLDER',
      'redactValue',
      'redactHeaders',
      'redactUrl',
      'redactBody',
      'assertNoForbiddenPatterns',
      'prepareRedactedArtifactJsonWithAudit',
    ],
    schemaEvidence: [
      schemaEvidence({
        schemaName: 'RedactionAudit',
        version: SECURITY_GUARD_SCHEMA_VERSION,
        modulePath: SECURITY_GUARD_MODULE,
        exportName: 'SECURITY_GUARD_SCHEMA_VERSION',
      }),
    ],
    safeBoundaryRole: boundary({
      role: 'redaction-guard',
      producerRole: 'Capability services before artifact writes',
      consumerRole: 'All artifact writers and compatibility checks',
      safeBoundary: 'Redacts and rejects sensitive material before persisted artifact output.',
    }),
    siteSemantics: siteSemanticsStatement(
      'SecurityGuard operates on sensitive-material patterns and must not encode site-specific behavioral meaning.',
    ),
  }),
  serviceEntry({
    stableName: 'ArtifactSchemaService',
    serviceKind: 'artifact-schema',
    modulePath: ARTIFACT_SCHEMA_MODULE,
    exportedSymbols: [
      'ARTIFACT_REFERENCE_SET_SCHEMA_VERSION',
      'normalizeArtifactReferenceSet',
      'assertArtifactReferenceSetCompatible',
      'normalizeManifestArtifactBundle',
      'assertManifestArtifactBundleCompatible',
    ],
    schemaEvidence: [
      schemaEvidence({
        schemaName: 'ArtifactReferenceSet',
        version: ARTIFACT_REFERENCE_SET_SCHEMA_VERSION,
        modulePath: ARTIFACT_SCHEMA_MODULE,
        exportName: 'ARTIFACT_REFERENCE_SET_SCHEMA_VERSION',
      }),
    ],
    safeBoundaryRole: boundary({
      role: 'artifact-schema-governor',
      producerRole: 'Kernel/capability artifact writers',
      consumerRole: 'Manifest and downloader artifact readers',
      safeBoundary: 'Provides versioned artifact references, not raw artifact payloads or sensitive material.',
    }),
    siteSemantics: siteSemanticsStatement(
      'ArtifactSchemaService records artifact references and schema compatibility only; site-specific artifact meaning is external.',
    ),
  }),
  serviceEntry({
    stableName: 'PolicyService',
    serviceKind: 'policy',
    modulePath: DOWNLOAD_POLICY_MODULE,
    exportedSymbols: [
      'DOWNLOAD_POLICY_SCHEMA_VERSION',
      'assertDownloadPolicyCompatible',
      'normalizeDownloadPolicy',
    ],
    schemaEvidence: [
      schemaEvidence({
        schemaName: 'DownloadPolicy',
        version: DOWNLOAD_POLICY_SCHEMA_VERSION,
        modulePath: DOWNLOAD_POLICY_MODULE,
        exportName: 'DOWNLOAD_POLICY_SCHEMA_VERSION',
      }),
      schemaEvidence({
        schemaName: 'StandardTaskList',
        version: STANDARD_TASK_LIST_SCHEMA_VERSION,
        modulePath: STANDARD_TASK_LIST_MODULE,
        exportName: 'STANDARD_TASK_LIST_SCHEMA_VERSION',
      }),
    ],
    safeBoundaryRole: boundary({
      role: 'policy-provider',
      producerRole: 'Kernel/planner policy handoff',
      consumerRole: 'downloader low-permission execution plan',
      safeBoundary: 'Produces low-permission task and download policy contracts without raw sessions or site-specific resolution logic.',
    }),
    siteSemantics: siteSemanticsStatement(
      'PolicyService governs permissions and execution shape; concrete resource interpretation remains SiteAdapter or resolver-owned.',
    ),
  }),
  serviceEntry({
    stableName: 'LifecycleHookService',
    serviceKind: 'lifecycle-hook',
    modulePath: CAPABILITY_HOOK_MODULE,
    exportedSymbols: [
      'CAPABILITY_HOOK_SCHEMA_VERSION',
      'createCapabilityHookEventTypeRegistry',
      'assertCapabilityHookCompatible',
      'assertCapabilityHookEventTypeRegistryCompatible',
      'assertCapabilityHookRegistrySnapshotCompatible',
      'normalizeCapabilityHook',
      'matchCapabilityHooksForLifecycleEvent',
      'createCapabilityHookRegistrySnapshot',
    ],
    schemaEvidence: [
      schemaEvidence({
        schemaName: 'LifecycleEvent',
        version: LIFECYCLE_EVENT_SCHEMA_VERSION,
        modulePath: LIFECYCLE_EVENTS_MODULE,
        exportName: 'LIFECYCLE_EVENT_SCHEMA_VERSION',
      }),
      schemaEvidence({
        schemaName: 'CapabilityHook',
        version: CAPABILITY_HOOK_SCHEMA_VERSION,
        modulePath: CAPABILITY_HOOK_MODULE,
        exportName: 'CAPABILITY_HOOK_SCHEMA_VERSION',
      }),
      schemaEvidence({
        schemaName: 'CapabilityHookEventTypeRegistry',
        version: CAPABILITY_HOOK_EVENT_TYPE_REGISTRY_SCHEMA_VERSION,
        modulePath: CAPABILITY_HOOK_MODULE,
        exportName: 'CAPABILITY_HOOK_EVENT_TYPE_REGISTRY_SCHEMA_VERSION',
      }),
      schemaEvidence({
        schemaName: 'CapabilityHookRegistrySnapshot',
        version: CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION,
        modulePath: CAPABILITY_HOOK_MODULE,
        exportName: 'CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION',
      }),
    ],
    safeBoundaryRole: boundary({
      role: 'lifecycle-hook-descriptor',
      producerRole: 'Kernel/capability lifecycle producers',
      consumerRole: 'Descriptor-only lifecycle subscribers and observability',
      safeBoundary: 'Matches descriptor-only hooks to versioned lifecycle events; executable hook dispatch is outside this contract.',
    }),
    siteSemantics: siteSemanticsStatement(
      'LifecycleHookService describes phases and events only; concrete site semantics remain SiteAdapter-owned and non-executable here.',
    ),
  }),
  serviceEntry({
    stableName: 'NodeInventoryService',
    serviceKind: 'node-inventory',
    modulePath: SITE_ONBOARDING_DISCOVERY_MODULE,
    exportedSymbols: [
      'SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION',
      'createSiteOnboardingDiscoveryInputFromCaptureExpand',
      'createSiteOnboardingDiscoveryInputsFromCaptureExpandOutput',
      'createNodeInventory',
      'createApiInventory',
      'createSiteOnboardingDiscoveryArtifacts',
      'renderNodeInventoryMarkdown',
      'renderApiInventoryMarkdown',
    ],
    schemaEvidence: [
      schemaEvidence({
        schemaName: 'SiteOnboardingDiscovery',
        version: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
        modulePath: SITE_ONBOARDING_DISCOVERY_MODULE,
        exportName: 'SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION',
      }),
    ],
    safeBoundaryRole: boundary({
      role: 'node-inventory-producer',
      producerRole: 'DOM/API discovery observations plus SiteAdapter decisions',
      consumerRole: 'CoverageAnalyzer/UnknownNodeReporter/onboarding review',
      safeBoundary: 'Records every discovered item with recognized, unknown, or ignored state without concrete site rules.',
    }),
    siteSemantics: siteSemanticsStatement(
      'NodeInventoryService stores adapter-provided classifications only; SiteAdapter owns concrete node and API interpretation.',
    ),
  }),
  serviceEntry({
    stableName: 'CoverageAnalyzer',
    serviceKind: 'coverage-analyzer',
    modulePath: SITE_ONBOARDING_DISCOVERY_MODULE,
    exportedSymbols: [
      'SITE_ONBOARDING_DISCOVERY_REQUIRED_COVERAGE_THRESHOLD',
      'evaluateSiteOnboardingCoverageGate',
      'createSiteCapabilityReport',
      'assertSiteOnboardingDiscoveryComplete',
      'renderSiteCapabilityReportMarkdown',
    ],
    schemaEvidence: [
      schemaEvidence({
        schemaName: 'SiteOnboardingDiscovery',
        version: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
        modulePath: SITE_ONBOARDING_DISCOVERY_MODULE,
        exportName: 'SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION',
      }),
    ],
    safeBoundaryRole: boundary({
      role: 'coverage-gate',
      producerRole: 'NodeInventoryService and UnknownNodeReporter',
      consumerRole: 'Kernel onboarding acceptance gate and Agent B review',
      safeBoundary: 'Evaluates required coverage and unknown required nodes/APIs without bypassing manual review.',
    }),
    siteSemantics: siteSemanticsStatement(
      'CoverageAnalyzer measures explicit inventory coverage; SiteAdapter remains the owner of site-specific meaning.',
    ),
  }),
  serviceEntry({
    stableName: 'UnknownNodeReporter',
    serviceKind: 'unknown-node-report',
    modulePath: SITE_ONBOARDING_DISCOVERY_MODULE,
    exportedSymbols: [
      'UNKNOWN_NODE_REPORT_SCHEMA_VERSION',
      'createUnknownNodeReport',
      'createDiscoveryAudit',
      'renderUnknownNodeReportMarkdown',
      'renderDiscoveryAuditMarkdown',
    ],
    schemaEvidence: [
      schemaEvidence({
        schemaName: 'SiteOnboardingDiscovery',
        version: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
        modulePath: SITE_ONBOARDING_DISCOVERY_MODULE,
        exportName: 'SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION',
      }),
    ],
    safeBoundaryRole: boundary({
      role: 'unknown-node-reporter',
      producerRole: 'NodeInventoryService and ApiInventory records',
      consumerRole: 'Site onboarding reviewer and matrix evidence',
      safeBoundary: 'Surfaces unknown nodes and APIs explicitly and records ignore/coverage audit state.',
    }),
    siteSemantics: siteSemanticsStatement(
      'UnknownNodeReporter reports missing interpretation evidence; SiteAdapter or human review resolves concrete meaning.',
    ),
  }),
]);

function normalizeStableName(value) {
  return String(value ?? '').trim();
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`CapabilityService ${fieldName} is required`);
  }
}

function assertSchemaEvidenceCompatible(entry, evidence, index) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error(`CapabilityService ${entry.stableName} schemaEvidence[${index}] must be an object`);
  }
  assertNonEmptyString(evidence.schemaName, `${entry.stableName}.schemaEvidence[${index}].schemaName`);
  assertNonEmptyString(evidence.modulePath, `${entry.stableName}.schemaEvidence[${index}].modulePath`);
  assertNonEmptyString(evidence.exportName, `${entry.stableName}.schemaEvidence[${index}].exportName`);
  const versionType = typeof evidence.version;
  if (
    !(
      (versionType === 'number' && Number.isFinite(evidence.version))
      || (versionType === 'string' && evidence.version.trim() !== '')
    )
  ) {
    throw new Error(`CapabilityService ${entry.stableName} schemaEvidence[${index}].version is required`);
  }
}

function assertSafeBoundaryRole(entry) {
  const role = entry.safeBoundaryRole;
  if (!role || typeof role !== 'object' || Array.isArray(role)) {
    throw new Error(`CapabilityService ${entry.stableName} safeBoundaryRole is required`);
  }
  assertNonEmptyString(role.role, `${entry.stableName}.safeBoundaryRole.role`);
  if (!SAFE_BOUNDARY_ROLE_SET.has(role.role)) {
    throw new Error(`CapabilityService ${entry.stableName} uses unsupported safeBoundaryRole: ${role.role}`);
  }
  assertNonEmptyString(role.owner, `${entry.stableName}.safeBoundaryRole.owner`);
  assertNonEmptyString(role.producerRole, `${entry.stableName}.safeBoundaryRole.producerRole`);
  assertNonEmptyString(role.consumerRole, `${entry.stableName}.safeBoundaryRole.consumerRole`);
  assertNonEmptyString(role.safeBoundary, `${entry.stableName}.safeBoundaryRole.safeBoundary`);
  if (!Array.isArray(role.forbiddenMaterial) || role.forbiddenMaterial.length === 0) {
    throw new Error(`CapabilityService ${entry.stableName} safeBoundaryRole.forbiddenMaterial is required`);
  }
}

function assertNoConcreteSiteSemanticsDeclaration(entry) {
  const siteSemantics = entry.siteSemantics;
  if (!siteSemantics || typeof siteSemantics !== 'object' || Array.isArray(siteSemantics)) {
    throw new Error(`CapabilityService ${entry.stableName} siteSemantics declaration is required`);
  }
  if (siteSemantics.concreteSiteSemanticsAllowed !== false) {
    throw new Error(`CapabilityService ${entry.stableName} must explicitly forbid concrete site semantics`);
  }
  if (siteSemantics.siteSpecificInterpretationOwner !== 'SiteAdapter') {
    throw new Error(`CapabilityService ${entry.stableName} site-specific interpretation owner must be SiteAdapter`);
  }
  assertNonEmptyString(siteSemantics.statement, `${entry.stableName}.siteSemantics.statement`);
}

function assertCapabilityServicePathBoundary(entry, modulePath, fieldName) {
  assertNonEmptyString(modulePath, `${entry.stableName}.${fieldName}`);
  if (!modulePath.startsWith(CAPABILITY_SERVICE_MODULE_PREFIX)) {
    throw new Error(
      `CapabilityService ${entry.stableName} ${fieldName} must stay under ${CAPABILITY_SERVICE_MODULE_PREFIX}`,
    );
  }
}

function assertNoConcreteSiteSemanticTokens(entry, value, fieldName) {
  const normalizedValue = String(value ?? '');
  if (CONCRETE_SITE_SEMANTIC_PATTERN.test(normalizedValue)) {
    throw new Error(
      `CapabilityService ${entry.stableName} ${fieldName} must not encode concrete site semantics: ${normalizedValue}`,
    );
  }
}

function moduleUrlForInventoryPath(modulePath) {
  return new URL(modulePath, REPO_ROOT_URL).href;
}

async function importInventoryModule(modulePath) {
  return import(moduleUrlForInventoryPath(modulePath));
}

export function listCapabilityServiceInventory() {
  return CAPABILITY_SERVICE_INVENTORY.map((entry) => ({
    ...entry,
    exportedSymbols: [...entry.exportedSymbols],
    schemaEvidence: entry.schemaEvidence.map((evidence) => ({ ...evidence })),
    safeBoundaryRole: {
      ...entry.safeBoundaryRole,
      forbiddenMaterial: [...entry.safeBoundaryRole.forbiddenMaterial],
    },
    siteSemantics: { ...entry.siteSemantics },
  }));
}

export function getCapabilityServiceInventoryEntry(stableName) {
  const normalizedName = normalizeStableName(stableName);
  return listCapabilityServiceInventory().find((entry) => entry.stableName === normalizedName) ?? null;
}

export function assertCapabilityServiceContract(entry = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error('CapabilityService entry must be an object');
  }
  if (entry.schemaVersion !== CAPABILITY_SERVICE_INVENTORY_SCHEMA_VERSION) {
    throw new Error(
      `CapabilityService ${entry.stableName ?? '<unknown>'} schemaVersion is required and must be ${CAPABILITY_SERVICE_INVENTORY_SCHEMA_VERSION}`,
    );
  }
  const stableName = normalizeStableName(entry.stableName);
  if (!/^[A-Z][A-Za-z0-9]*$/u.test(stableName)) {
    throw new Error(`CapabilityService stableName is required and must be stable PascalCase: ${stableName || '<empty>'}`);
  }
  assertNonEmptyString(entry.serviceKind, `${stableName}.serviceKind`);
  assertNonEmptyString(entry.modulePath, `${stableName}.modulePath`);
  if (!Array.isArray(entry.exportedSymbols) || entry.exportedSymbols.length === 0) {
    throw new Error(`CapabilityService ${stableName} exportedSymbols is required`);
  }
  for (const [index, symbol] of entry.exportedSymbols.entries()) {
    assertNonEmptyString(symbol, `${stableName}.exportedSymbols[${index}]`);
  }
  if (!Array.isArray(entry.schemaEvidence) || entry.schemaEvidence.length === 0) {
    throw new Error(`CapabilityService ${stableName} schemaEvidence is required`);
  }
  for (const [index, evidence] of entry.schemaEvidence.entries()) {
    assertSchemaEvidenceCompatible(entry, evidence, index);
  }
  assertSafeBoundaryRole(entry);
  assertNoConcreteSiteSemanticsDeclaration(entry);
  return true;
}

export function assertCapabilityServiceArchitecture(entry = {}) {
  assertCapabilityServiceContract(entry);
  assertCapabilityServicePathBoundary(entry, entry.modulePath, 'modulePath');
  assertNoConcreteSiteSemanticTokens(entry, entry.stableName, 'stableName');
  assertNoConcreteSiteSemanticTokens(entry, entry.serviceKind, 'serviceKind');
  assertNoConcreteSiteSemanticTokens(entry, entry.modulePath, 'modulePath');
  for (const [index, symbol] of entry.exportedSymbols.entries()) {
    assertNoConcreteSiteSemanticTokens(entry, symbol, `exportedSymbols[${index}]`);
  }
  for (const [index, evidence] of entry.schemaEvidence.entries()) {
    assertCapabilityServicePathBoundary(entry, evidence.modulePath, `schemaEvidence[${index}].modulePath`);
    assertNoConcreteSiteSemanticTokens(entry, evidence.schemaName, `schemaEvidence[${index}].schemaName`);
    assertNoConcreteSiteSemanticTokens(entry, evidence.modulePath, `schemaEvidence[${index}].modulePath`);
    assertNoConcreteSiteSemanticTokens(entry, evidence.exportName, `schemaEvidence[${index}].exportName`);
  }
  return true;
}

export function assertCapabilityServiceInventoryContracts(entries = listCapabilityServiceInventory()) {
  if (!Array.isArray(entries)) {
    throw new Error('CapabilityService inventory must be an array');
  }
  if (entries.length === 0) {
    throw new Error('CapabilityService inventory must not be empty');
  }
  const stableNames = new Set();
  for (const entry of entries) {
    assertCapabilityServiceContract(entry);
    if (stableNames.has(entry.stableName)) {
      throw new Error(`Duplicate CapabilityService stableName: ${entry.stableName}`);
    }
    stableNames.add(entry.stableName);
  }
  return true;
}

export function assertCapabilityServiceInventoryArchitecture(entries = listCapabilityServiceInventory()) {
  if (!Array.isArray(entries)) {
    throw new Error('CapabilityService inventory must be an array');
  }
  assertCapabilityServiceInventoryContracts(entries);
  for (const entry of entries) {
    assertCapabilityServiceArchitecture(entry);
  }
  return true;
}

export async function assertCapabilityServiceInventoryRuntimeCompatible({
  entries = listCapabilityServiceInventory(),
  importModule = importInventoryModule,
} = {}) {
  assertCapabilityServiceInventoryArchitecture(entries);
  const moduleCache = new Map();
  async function getModule(modulePath) {
    if (!moduleCache.has(modulePath)) {
      moduleCache.set(modulePath, await importModule(modulePath));
    }
    return moduleCache.get(modulePath);
  }

  for (const entry of entries) {
    const serviceModule = await getModule(entry.modulePath);
    for (const exportName of entry.exportedSymbols) {
      if (!Object.hasOwn(serviceModule, exportName)) {
        throw new Error(
          `CapabilityService ${entry.stableName} references missing export ${exportName} from ${entry.modulePath}`,
        );
      }
    }

    for (const evidence of entry.schemaEvidence) {
      const evidenceModule = await getModule(evidence.modulePath);
      if (!Object.hasOwn(evidenceModule, evidence.exportName)) {
        throw new Error(
          `CapabilityService ${entry.stableName} references missing schema export ${evidence.exportName} from ${evidence.modulePath}`,
        );
      }
      if (evidenceModule[evidence.exportName] !== evidence.version) {
        throw new Error(
          `CapabilityService ${entry.stableName} schema evidence is stale: ${evidence.schemaName}.${evidence.exportName}`,
        );
      }
    }
  }
  return true;
}
