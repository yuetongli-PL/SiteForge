// @ts-check

import { writeTextFile } from '../../infra/io.mjs';
import { normalizeReasonCode } from './reason-codes.mjs';
import {
  assertNoForbiddenPatterns,
  prepareRedactedArtifactJsonWithAudit,
  redactValue,
} from './security-guard.mjs';

export const LIFECYCLE_EVENT_SCHEMA_VERSION = 1;
export const LIFECYCLE_EVENT_PRODUCER_INVENTORY_SCHEMA_VERSION = 1;
export const LIFECYCLE_OBSERVABILITY_CORE_FIELDS = Object.freeze([
  'traceId',
  'correlationId',
  'taskId',
  'siteKey',
  'taskType',
]);
export const LIFECYCLE_EVENT_PRODUCER_DESCRIPTOR_POLICY = Object.freeze({
  descriptorOnly: true,
  executableProducerDiscoveryAllowed: false,
  sensitiveMaterialAllowed: false,
  rawCredentialsAllowed: false,
  rawSessionPayloadsAllowed: false,
  rawProfilePayloadsAllowed: false,
  failClosed: true,
});

const LIFECYCLE_DOWNLOAD_PRODUCER_FIELDS = Object.freeze([
  ...LIFECYCLE_OBSERVABILITY_CORE_FIELDS,
  'adapterVersion',
  'reasonCode',
]);
const LIFECYCLE_DOWNLOAD_TERMINAL_DETAIL_FIELDS = Object.freeze([
  'status',
  'reason',
]);
const LIFECYCLE_DOWNLOAD_EXECUTOR_DETAIL_FIELDS = Object.freeze([
  ...LIFECYCLE_DOWNLOAD_TERMINAL_DETAIL_FIELDS,
  'counts',
]);
const LIFECYCLE_DOWNLOAD_EXECUTOR_BEFORE_DOWNLOAD_DETAIL_FIELDS = Object.freeze([
  ...LIFECYCLE_DOWNLOAD_EXECUTOR_DETAIL_FIELDS,
  'capabilityHookPhase',
  'capabilityHookMatches',
  'capabilityHookLifecycleEvidence',
]);
const LIFECYCLE_DOWNLOAD_RUN_TERMINAL_OBSERVABILITY_PROFILE = Object.freeze({
  requiredFields: LIFECYCLE_DOWNLOAD_PRODUCER_FIELDS,
  requiredDetailFields: LIFECYCLE_DOWNLOAD_TERMINAL_DETAIL_FIELDS,
});
const LIFECYCLE_DOWNLOAD_EXECUTOR_OBSERVABILITY_PROFILE = Object.freeze({
  requiredFields: LIFECYCLE_DOWNLOAD_PRODUCER_FIELDS,
  requiredDetailFields: LIFECYCLE_DOWNLOAD_EXECUTOR_DETAIL_FIELDS,
});
const LIFECYCLE_API_FAILURE_PRODUCER_FIELDS = Object.freeze([
  ...LIFECYCLE_OBSERVABILITY_CORE_FIELDS,
  'adapterVersion',
  'reasonCode',
]);
const LIFECYCLE_API_CATALOG_PRODUCER_FIELDS = Object.freeze([
  ...LIFECYCLE_OBSERVABILITY_CORE_FIELDS,
  'adapterVersion',
  'reasonCode',
]);
const LIFECYCLE_API_CATALOG_UPGRADE_DECISION_DETAIL_FIELDS = Object.freeze([
  'candidateId',
  'adapterId',
  'decision',
  'canEnterCatalog',
  'catalogAction',
  'requirements',
]);
const LIFECYCLE_API_CATALOG_COLLECTION_WRITTEN_DETAIL_FIELDS = Object.freeze([
  'catalogId',
  'catalogVersion',
  'generatedAt',
  'entryCount',
  'siteKeys',
  'statuses',
  'invalidationStatuses',
  'reasonCodes',
  'reasonRecoveries',
]);
const LIFECYCLE_API_CATALOG_INDEX_WRITTEN_DETAIL_FIELDS = Object.freeze([
  'indexVersion',
  'indexGeneratedAt',
  'catalogCount',
  'totalEntryCount',
  'reasonCodes',
  'reasonRecoveries',
  'catalogs',
]);
const LIFECYCLE_API_CATALOG_SCHEMA_INCOMPATIBLE_DETAIL_FIELDS = Object.freeze([
  'operation',
  'schemaName',
  'expectedVersion',
  'receivedVersion',
  'failClosed',
  'artifactWriteAllowed',
  'retryable',
  'manualRecoveryNeeded',
  'reasonRecovery',
  'capabilityHookMatches',
]);
const LIFECYCLE_SOCIAL_RISK_PRODUCER_FIELDS = Object.freeze([
  ...LIFECYCLE_OBSERVABILITY_CORE_FIELDS,
  'adapterVersion',
  'reasonCode',
]);
const LIFECYCLE_SOCIAL_RISK_BLOCKED_DETAIL_FIELDS = Object.freeze([
  'status',
  'reason',
  'stopReason',
  'riskSignals',
  'riskState',
  'riskState.schemaVersion',
  'riskState.state',
  'riskState.reasonCode',
  'riskState.scope',
  'riskState.transition',
  'riskState.transition.from',
  'riskState.transition.to',
  'riskState.recovery',
]);
const LIFECYCLE_SITE_HEALTH_PRODUCER_FIELDS = Object.freeze([
  ...LIFECYCLE_OBSERVABILITY_CORE_FIELDS,
]);
const LIFECYCLE_SITE_HEALTH_EVALUATED_DETAIL_FIELDS = Object.freeze([
  'status',
  'riskTypes',
  'affectedCapabilities',
  'recommendedActions',
]);
const LIFECYCLE_SITE_HEALTH_ACTION_DETAIL_FIELDS = Object.freeze([
  'action',
  'descriptorOnly',
  'executableDispatchEnabled',
]);

export const LIFECYCLE_EVENT_OBSERVABILITY_PROFILES = Object.freeze({
  'api.catalog.collection.written': Object.freeze({
    requiredFields: LIFECYCLE_API_CATALOG_PRODUCER_FIELDS,
    requiredDetailFields: LIFECYCLE_API_CATALOG_COLLECTION_WRITTEN_DETAIL_FIELDS,
  }),
  'api.catalog.index.written': Object.freeze({
    requiredFields: LIFECYCLE_API_CATALOG_PRODUCER_FIELDS,
    requiredDetailFields: LIFECYCLE_API_CATALOG_INDEX_WRITTEN_DETAIL_FIELDS,
  }),
  'api.catalog.schema_incompatible': Object.freeze({
    requiredFields: LIFECYCLE_API_FAILURE_PRODUCER_FIELDS,
    requiredDetailFields: LIFECYCLE_API_CATALOG_SCHEMA_INCOMPATIBLE_DETAIL_FIELDS,
  }),
  'api.catalog.upgrade_decision.written': Object.freeze({
    requiredFields: LIFECYCLE_API_CATALOG_PRODUCER_FIELDS,
    requiredDetailFields: LIFECYCLE_API_CATALOG_UPGRADE_DECISION_DETAIL_FIELDS,
  }),
  'capture.manifest.written': Object.freeze({
    requiredFields: Object.freeze([
      'traceId',
      'correlationId',
      'taskId',
      'siteKey',
      'taskType',
      'adapterVersion',
    ]),
    requiredDetailFields: Object.freeze([
      'status',
    ]),
  }),
  'capture.api_candidates.written': Object.freeze({
    requiredFields: Object.freeze([
      'traceId',
      'correlationId',
      'taskId',
      'siteKey',
      'taskType',
      'adapterVersion',
    ]),
    requiredDetailFields: Object.freeze([
      'count',
      'apiCandidates',
      'apiCandidateRedactionAudits',
      'apiCandidateDecisions',
    ]),
  }),
  'download.run.terminal': LIFECYCLE_DOWNLOAD_RUN_TERMINAL_OBSERVABILITY_PROFILE,
  'download.executor.before_download': Object.freeze({
    requiredFields: LIFECYCLE_DOWNLOAD_PRODUCER_FIELDS,
    requiredDetailFields: LIFECYCLE_DOWNLOAD_EXECUTOR_BEFORE_DOWNLOAD_DETAIL_FIELDS,
  }),
  'download.executor.completed': LIFECYCLE_DOWNLOAD_EXECUTOR_OBSERVABILITY_PROFILE,
  'download.executor.dry_run': LIFECYCLE_DOWNLOAD_EXECUTOR_OBSERVABILITY_PROFILE,
  'download.legacy.completed': LIFECYCLE_DOWNLOAD_EXECUTOR_OBSERVABILITY_PROFILE,
  'download.legacy.recovery_preflight': LIFECYCLE_DOWNLOAD_EXECUTOR_OBSERVABILITY_PROFILE,
  'social.action.risk_blocked': Object.freeze({
    requiredFields: LIFECYCLE_SOCIAL_RISK_PRODUCER_FIELDS,
    requiredDetailFields: LIFECYCLE_SOCIAL_RISK_BLOCKED_DETAIL_FIELDS,
  }),
  'site.health.recovery.evaluated': Object.freeze({
    requiredFields: LIFECYCLE_SITE_HEALTH_PRODUCER_FIELDS,
    requiredDetailFields: LIFECYCLE_SITE_HEALTH_EVALUATED_DETAIL_FIELDS,
  }),
  'site.health.recovery.action.planned': Object.freeze({
    requiredFields: LIFECYCLE_SITE_HEALTH_PRODUCER_FIELDS,
    requiredDetailFields: LIFECYCLE_SITE_HEALTH_ACTION_DETAIL_FIELDS,
  }),
  'site.health.recovery.safe_stop': Object.freeze({
    requiredFields: LIFECYCLE_SITE_HEALTH_PRODUCER_FIELDS,
    requiredDetailFields: LIFECYCLE_SITE_HEALTH_ACTION_DETAIL_FIELDS,
  }),
});

const LIFECYCLE_EVENT_PRODUCER_DESCRIPTORS = Object.freeze([
  {
    eventType: 'api.candidate.verified',
    producerId: 'api-candidates.candidate-verification',
    sourceModule: 'src/sites/capability/api-candidates.mjs',
    profileStatus: 'inventoried',
  },
  {
    eventType: 'api.catalog.collection.written',
    producerId: 'api-candidates.catalog-collection-write',
    sourceModule: 'src/sites/capability/api-candidates.mjs',
    profileStatus: 'profiled',
  },
  {
    eventType: 'api.catalog.index.written',
    producerId: 'api-candidates.catalog-index-write',
    sourceModule: 'src/sites/capability/api-candidates.mjs',
    profileStatus: 'profiled',
  },
  {
    eventType: 'api.catalog.schema_incompatible',
    producerId: 'api-candidates.catalog-schema-incompatible',
    sourceModule: 'src/sites/capability/api-candidates.mjs',
    profileStatus: 'profiled',
  },
  {
    eventType: 'api.catalog.upgrade_decision.written',
    producerId: 'api-candidates.catalog-upgrade-decision',
    sourceModule: 'src/sites/capability/api-candidates.mjs',
    profileStatus: 'profiled',
  },
  {
    eventType: 'api.catalog.verification.written',
    producerId: 'api-candidates.catalog-verification',
    sourceModule: 'src/sites/capability/api-candidates.mjs',
    profileStatus: 'inventoried',
  },
  {
    eventType: 'capture.api_candidates.written',
    producerId: 'capture-stage.api-candidates-write',
    sourceModule: 'src/pipeline/stages/capture.mjs',
    profileStatus: 'profiled',
  },
  {
    eventType: 'capture.manifest.written',
    producerId: 'capture-stage.manifest-write',
    sourceModule: 'src/pipeline/stages/capture.mjs',
    profileStatus: 'profiled',
  },
  {
    eventType: 'download.executor.before_download',
    producerId: 'download-executor.before-download',
    sourceModule: 'src/sites/downloads/executor.mjs',
    profileStatus: 'profiled',
  },
  {
    eventType: 'download.executor.completed',
    producerId: 'download-executor.completed',
    sourceModule: 'src/sites/downloads/executor.mjs',
    profileStatus: 'profiled',
  },
  {
    eventType: 'download.executor.dry_run',
    producerId: 'download-executor.dry-run',
    sourceModule: 'src/sites/downloads/executor.mjs',
    profileStatus: 'profiled',
  },
  {
    eventType: 'download.legacy.completed',
    producerId: 'download-legacy-executor.completed',
    sourceModule: 'src/sites/downloads/legacy-executor.mjs',
    profileStatus: 'profiled',
  },
  {
    eventType: 'download.legacy.recovery_preflight',
    producerId: 'download-legacy-executor.recovery-preflight',
    sourceModule: 'src/sites/downloads/legacy-executor.mjs',
    profileStatus: 'profiled',
  },
  {
    eventType: 'download.run.terminal',
    producerId: 'download-runner.terminal',
    sourceModule: 'src/sites/downloads/runner.mjs',
    profileStatus: 'profiled',
  },
  {
    eventType: 'session.run.completed',
    producerId: 'session-runner.completed',
    sourceModule: 'src/sites/sessions/runner.mjs',
    profileStatus: 'inventoried',
  },
  {
    eventType: 'site.health.recovery.evaluated',
    producerId: 'site-health-recovery.evaluated',
    sourceModule: 'src/sites/capability/site-health-execution-gate.mjs',
    profileStatus: 'profiled',
  },
  {
    eventType: 'site.health.recovery.action.planned',
    producerId: 'site-health-recovery.action-planned',
    sourceModule: 'src/sites/capability/site-health-execution-gate.mjs',
    profileStatus: 'profiled',
  },
  {
    eventType: 'site.health.recovery.safe_stop',
    producerId: 'site-health-recovery.safe-stop',
    sourceModule: 'src/sites/capability/site-health-execution-gate.mjs',
    profileStatus: 'profiled',
  },
  {
    eventType: 'social.action.risk_blocked',
    producerId: 'social-action-router.risk-blocked',
    sourceModule: 'src/sites/social/actions/router.mjs',
    profileStatus: 'profiled',
  },
].map((descriptor) => Object.freeze(descriptor)));

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function normalizeDetails(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function containsExecutableFunction(value, seen = new Set()) {
  if (typeof value === 'function') {
    return true;
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  return Object.values(value).some((entry) => containsExecutableFunction(entry, seen));
}

function hasRequiredDetailValue(details, fieldPath) {
  let current = details;
  for (const segment of String(fieldPath).split('.')) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return false;
    }
    current = current[segment];
  }
  return current !== undefined && current !== null;
}

function summarizeRedactionAudit(audit = {}) {
  return {
    redactedPathCount: Array.isArray(audit.redactedPaths) ? audit.redactedPaths.length : 0,
    findingCount: Array.isArray(audit.findings) ? audit.findings.length : 0,
  };
}

export function normalizeLifecycleEvent(raw = {}, defaults = {}) {
  const eventType = normalizeText(raw.eventType ?? defaults.eventType) ?? 'task.event';
  const reasonCode = normalizeText(raw.reasonCode ?? defaults.reasonCode);
  return {
    schemaVersion: LIFECYCLE_EVENT_SCHEMA_VERSION,
    eventType,
    traceId: normalizeText(raw.traceId ?? defaults.traceId),
    correlationId: normalizeText(raw.correlationId ?? defaults.correlationId),
    taskId: normalizeText(raw.taskId ?? defaults.taskId),
    siteKey: normalizeText(raw.siteKey ?? defaults.siteKey),
    taskType: normalizeText(raw.taskType ?? defaults.taskType),
    adapterVersion: normalizeText(raw.adapterVersion ?? defaults.adapterVersion),
    reasonCode: reasonCode ? normalizeReasonCode(reasonCode) : undefined,
    createdAt: normalizeText(raw.createdAt ?? defaults.createdAt) ?? new Date().toISOString(),
    details: normalizeDetails(raw.details ?? defaults.details),
  };
}

function normalizeLifecycleProducerDescriptorPolicy(raw = LIFECYCLE_EVENT_PRODUCER_DESCRIPTOR_POLICY) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('LifecycleEvent producer descriptor policy must be an object');
  }
  if (containsExecutableFunction(raw)) {
    throw new Error('LifecycleEvent producer descriptor policy must not include executable functions');
  }
  const policy = {
    descriptorOnly: raw.descriptorOnly === undefined ? true : Boolean(raw.descriptorOnly),
    executableProducerDiscoveryAllowed: raw.executableProducerDiscoveryAllowed === undefined
      ? false
      : Boolean(raw.executableProducerDiscoveryAllowed),
    sensitiveMaterialAllowed: raw.sensitiveMaterialAllowed === undefined ? false : Boolean(raw.sensitiveMaterialAllowed),
    rawCredentialsAllowed: raw.rawCredentialsAllowed === undefined ? false : Boolean(raw.rawCredentialsAllowed),
    rawSessionPayloadsAllowed: raw.rawSessionPayloadsAllowed === undefined ? false : Boolean(raw.rawSessionPayloadsAllowed),
    rawProfilePayloadsAllowed: raw.rawProfilePayloadsAllowed === undefined ? false : Boolean(raw.rawProfilePayloadsAllowed),
    failClosed: raw.failClosed === undefined ? true : Boolean(raw.failClosed),
  };
  if (
    policy.descriptorOnly !== true
    || policy.executableProducerDiscoveryAllowed !== false
    || policy.sensitiveMaterialAllowed !== false
    || policy.rawCredentialsAllowed !== false
    || policy.rawSessionPayloadsAllowed !== false
    || policy.rawProfilePayloadsAllowed !== false
    || policy.failClosed !== true
  ) {
    throw new Error('LifecycleEvent producer descriptor policy must be descriptor-only and fail closed');
  }
  const { value } = redactValue(policy);
  assertNoForbiddenPatterns(value);
  return value;
}

function normalizeLifecycleEventProducerDescriptor(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('LifecycleEvent producer descriptor must be an object');
  }
  if (containsExecutableFunction(raw)) {
    throw new Error('LifecycleEvent producer descriptor must not include executable functions');
  }
  assertNoForbiddenPatterns(raw);
  const eventType = normalizeText(raw.eventType);
  if (!eventType) {
    throw new Error('LifecycleEvent producer descriptor eventType is required');
  }
  const producerId = normalizeText(raw.producerId);
  if (!producerId) {
    throw new Error('LifecycleEvent producer descriptor producerId is required');
  }
  const sourceModule = normalizeText(raw.sourceModule);
  if (!sourceModule || !sourceModule.startsWith('src/') || !sourceModule.endsWith('.mjs')) {
    throw new Error('LifecycleEvent producer descriptor sourceModule must be a repo source module');
  }
  const profileStatus = normalizeText(raw.profileStatus) ?? 'inventoried';
  if (!['inventoried', 'profiled'].includes(profileStatus)) {
    throw new Error(`Unsupported LifecycleEvent producer profileStatus: ${profileStatus}`);
  }
  if (profileStatus === 'profiled' && !Object.hasOwn(LIFECYCLE_EVENT_OBSERVABILITY_PROFILES, eventType)) {
    throw new Error(`LifecycleEvent producer profile is missing for eventType: ${eventType}`);
  }
  if (Object.hasOwn(LIFECYCLE_EVENT_OBSERVABILITY_PROFILES, eventType) && profileStatus !== 'profiled') {
    throw new Error(`LifecycleEvent producer profileStatus must be profiled for eventType: ${eventType}`);
  }
  const descriptor = {
    eventType,
    producerId,
    sourceModule,
    profileStatus,
  };
  const { value } = redactValue(descriptor);
  assertNoForbiddenPatterns(value);
  return value;
}

export function createLifecycleEventProducerInventory({
  producers = LIFECYCLE_EVENT_PRODUCER_DESCRIPTORS,
} = {}) {
  const inventory = {
    schemaVersion: LIFECYCLE_EVENT_PRODUCER_INVENTORY_SCHEMA_VERSION,
    descriptorPolicy: LIFECYCLE_EVENT_PRODUCER_DESCRIPTOR_POLICY,
    producers: producers.map((producer) => normalizeLifecycleEventProducerDescriptor(producer)),
  };
  assertLifecycleEventProducerInventoryCompatible(inventory);
  return inventory;
}

export function assertLifecycleEventProducerInventoryCompatible(raw = {}) {
  const version = Number(raw?.schemaVersion);
  if (!Number.isInteger(version)) {
    throw new Error('LifecycleEventProducerInventory schemaVersion is required');
  }
  if (version !== LIFECYCLE_EVENT_PRODUCER_INVENTORY_SCHEMA_VERSION) {
    throw new Error(
      `LifecycleEventProducerInventory schemaVersion ${version} is not compatible with ${LIFECYCLE_EVENT_PRODUCER_INVENTORY_SCHEMA_VERSION}`,
    );
  }
  normalizeLifecycleProducerDescriptorPolicy(raw.descriptorPolicy);
  if (!Array.isArray(raw.producers)) {
    throw new Error('LifecycleEventProducerInventory producers must be an array');
  }
  const seenEventTypes = new Set();
  const seenProducerIds = new Set();
  for (const producer of raw.producers) {
    const normalized = normalizeLifecycleEventProducerDescriptor(producer);
    if (seenEventTypes.has(normalized.eventType)) {
      throw new Error(`Duplicate LifecycleEvent producer eventType: ${normalized.eventType}`);
    }
    if (seenProducerIds.has(normalized.producerId)) {
      throw new Error(`Duplicate LifecycleEvent producerId: ${normalized.producerId}`);
    }
    seenEventTypes.add(normalized.eventType);
    seenProducerIds.add(normalized.producerId);
  }
  for (const eventType of Object.keys(LIFECYCLE_EVENT_OBSERVABILITY_PROFILES)) {
    if (!seenEventTypes.has(eventType)) {
      throw new Error(`LifecycleEventProducerInventory must include profiled eventType: ${eventType}`);
    }
  }
  assertNoForbiddenPatterns(raw);
  return true;
}

export function listLifecycleEventProducerEventTypes({
  inventory = createLifecycleEventProducerInventory(),
} = {}) {
  assertLifecycleEventProducerInventoryCompatible(inventory);
  return inventory.producers.map((producer) => producer.eventType);
}

export function summarizeLifecycleEventProducerInventory({
  inventory = createLifecycleEventProducerInventory(),
} = {}) {
  assertLifecycleEventProducerInventoryCompatible(inventory);
  const moduleCounts = {};
  const profiledEventTypes = [];
  const inventoriedOnlyEventTypes = [];
  for (const producer of inventory.producers) {
    moduleCounts[producer.sourceModule] = (moduleCounts[producer.sourceModule] ?? 0) + 1;
    if (producer.profileStatus === 'profiled') {
      profiledEventTypes.push(producer.eventType);
    } else {
      inventoriedOnlyEventTypes.push(producer.eventType);
    }
  }
  return {
    schemaVersion: inventory.schemaVersion,
    eventTypeCount: inventory.producers.length,
    producerModuleCounts: moduleCounts,
    profiledEventTypeCount: profiledEventTypes.length,
    profiledEventTypes,
    inventoriedOnlyEventTypes,
  };
}

export function assertLifecycleEventCompatible(payload = {}) {
  if (payload?.schemaVersion === undefined || payload?.schemaVersion === null) {
    throw new Error('LifecycleEvent schemaVersion is required');
  }
  if (payload.schemaVersion !== LIFECYCLE_EVENT_SCHEMA_VERSION) {
    throw new Error(
      `LifecycleEvent schemaVersion ${payload.schemaVersion} is not compatible with ${LIFECYCLE_EVENT_SCHEMA_VERSION}`,
    );
  }
  return true;
}

export function assertLifecycleEventObservabilityFields(event = {}, {
  requiredFields = LIFECYCLE_OBSERVABILITY_CORE_FIELDS,
  requiredDetailFields = [],
} = {}) {
  assertLifecycleEventCompatible(event);
  for (const field of requiredFields) {
    if (!normalizeText(event[field])) {
      throw new Error(`LifecycleEvent observability field is required: ${field}`);
    }
  }
  const details = normalizeDetails(event.details);
  for (const field of requiredDetailFields) {
    if (!hasRequiredDetailValue(details, field)) {
      throw new Error(`LifecycleEvent observability details field is required: ${field}`);
    }
  }
  return true;
}

export function assertLifecycleEventProducerObservability(event = {}) {
  const normalized = normalizeLifecycleEvent(event);
  const profile = LIFECYCLE_EVENT_OBSERVABILITY_PROFILES[normalized.eventType];
  if (!profile) {
    assertLifecycleEventCompatible(normalized);
    return true;
  }
  return assertLifecycleEventObservabilityFields(normalized, profile);
}

export async function writeLifecycleEventArtifact(event, {
  eventPath,
  auditPath,
} = {}) {
  if (!eventPath || !auditPath) {
    throw new Error('Lifecycle event artifact paths are required');
  }
  const normalized = normalizeLifecycleEvent(event);
  assertLifecycleEventCompatible(normalized);
  assertLifecycleEventProducerObservability(normalized);
  const { json, auditJson, auditValue } = prepareRedactedArtifactJsonWithAudit(normalized);
  await writeTextFile(eventPath, json);
  await writeTextFile(auditPath, auditJson);
  return {
    event: normalized,
    redactionSummary: summarizeRedactionAudit(auditValue),
    artifacts: {
      lifecycleEvent: eventPath,
      lifecycleEventRedactionAudit: auditPath,
    },
  };
}

export function createLifecycleArtifactWriterSubscriber({
  eventPath,
  auditPath,
} = {}) {
  return async function lifecycleArtifactWriterSubscriber(event) {
    return await writeLifecycleEventArtifact(event, { eventPath, auditPath });
  };
}

export function composeLifecycleSubscribers(...subscriberGroups) {
  const subscribers = [];
  for (const group of subscriberGroups) {
    if (group == null) {
      continue;
    }
    const groupSubscribers = Array.isArray(group) ? group : [group];
    for (const subscriber of groupSubscribers) {
      if (typeof subscriber !== 'function') {
        throw new Error('Lifecycle event subscriber must be a function');
      }
      subscribers.push(subscriber);
    }
  }
  return subscribers;
}

export async function dispatchLifecycleEvent(event, {
  subscribers = [],
} = {}) {
  const normalized = normalizeLifecycleEvent(event);
  assertLifecycleEventCompatible(normalized);
  assertLifecycleEventProducerObservability(normalized);
  const subscriberResults = [];
  for (const subscriber of composeLifecycleSubscribers(subscribers)) {
    subscriberResults.push(await subscriber(normalized));
  }
  return {
    event: normalized,
    subscriberResults,
  };
}
