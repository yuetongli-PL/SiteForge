// @ts-check

import {
  normalizeReasonCode,
  requireReasonCodeDefinition,
} from './reason-codes.mjs';
import {
  assertLifecycleEventCompatible,
  normalizeLifecycleEvent,
} from './lifecycle-events.mjs';
import {
  assertNoForbiddenPatterns,
  redactValue,
} from './security-guard.mjs';

export const CAPABILITY_HOOK_SCHEMA_VERSION = 1;
export const CAPABILITY_HOOK_EVENT_TYPE_REGISTRY_SCHEMA_VERSION = 1;
export const CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_REGISTRY_SCHEMA_VERSION = 1;
export const CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION = 1;
export const CAPABILITY_HOOK_EXECUTION_POLICY_SCHEMA_VERSION = 1;

export const CAPABILITY_HOOK_DESCRIPTOR_POLICY = Object.freeze({
  descriptorOnly: true,
  executableHooksAllowed: false,
  hookInvocationAllowed: false,
  sensitiveMaterialAllowed: false,
});

export const CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_POLICY = Object.freeze({
  ...CAPABILITY_HOOK_DESCRIPTOR_POLICY,
  failClosed: true,
  rawCredentialsAllowed: false,
  rawSessionPayloadsAllowed: false,
  rawProfilePayloadsAllowed: false,
});

export const CAPABILITY_HOOK_EXECUTION_POLICY = Object.freeze({
  schemaVersion: CAPABILITY_HOOK_EXECUTION_POLICY_SCHEMA_VERSION,
  descriptorOnly: true,
  executionMode: 'descriptor_match_only',
  executableDispatchEnabled: false,
  executableHooksAllowed: false,
  hookInvocationAllowed: false,
  failClosed: true,
  sensitiveMaterialAllowed: false,
});

export const CAPABILITY_HOOK_PHASES = Object.freeze([
  'before_task',
  'after_task',
  'before_capture',
  'after_capture',
  'before_candidate_write',
  'after_candidate_write',
  'before_catalog_verify',
  'after_catalog_verify',
  'before_session_materialize',
  'after_session_materialize',
  'before_download',
  'after_download',
  'before_artifact_write',
  'after_artifact_write',
  'on_risk',
  'on_cooldown',
  'on_manual_recovery_required',
  'on_failure',
  'on_completion',
]);

export const CAPABILITY_HOOK_TYPES = Object.freeze([
  'observer',
  'guard',
  'transform',
  'artifact_writer',
]);

export const CAPABILITY_HOOK_EVENT_TYPES = Object.freeze([
  'api.candidate.verified',
  'api.catalog.collection.written',
  'api.catalog.index.written',
  'api.catalog.schema_incompatible',
  'api.catalog.upgrade_decision.written',
  'api.catalog.verification.written',
  'capture.api_candidates.written',
  'capture.manifest.written',
  'download.executor.before_download',
  'download.executor.completed',
  'download.executor.dry_run',
  'download.legacy.completed',
  'download.legacy.recovery_preflight',
  'download.run.terminal',
  'session.run.completed',
  'site.health.recovery.action.planned',
  'site.health.recovery.evaluated',
  'site.health.recovery.safe_stop',
  'social.action.risk_blocked',
]);

export const CAPABILITY_HOOK_CRITICAL_PRODUCER_EVENT_TYPES = Object.freeze([
  'session.run.completed',
  'download.run.terminal',
  'social.action.risk_blocked',
]);

const TRUSTED_CAPABILITY_HOOK_REGISTRY = Symbol('TrustedCapabilityHookRegistry');

const FORBIDDEN_PRODUCER_DESCRIPTOR_MATERIAL_KEYS = Object.freeze(new Set([
  'authorization',
  'cookie',
  'cookies',
  'csrf',
  'csrftoken',
  'token',
  'accesstoken',
  'refreshtoken',
  'sessionid',
  'sessionids',
  'sessdata',
  'rawcredential',
  'rawcredentials',
  'rawsession',
  'rawsessionmaterial',
  'sessionmaterial',
  'browserprofile',
  'browserprofilepath',
  'rawbrowserprofile',
  'profilepath',
  'profiledir',
]));

const CAPABILITY_HOOK_CRITICAL_PRODUCER_DESCRIPTORS = Object.freeze([
  Object.freeze({
    schemaVersion: CAPABILITY_HOOK_SCHEMA_VERSION,
    eventType: 'session.run.completed',
    producerId: 'session-runner.completed',
    sourceModule: 'src/sites/sessions/runner.mjs',
    phaseHints: Object.freeze(['after_session_materialize', 'on_completion']),
    lifecycleFields: Object.freeze([
      'eventType',
      'traceId',
      'correlationId',
      'taskId',
      'siteKey',
      'taskType',
      'adapterVersion',
      'reasonCode',
    ]),
    detailFields: Object.freeze([
      'status',
      'reason',
      'capabilityHookMatches',
    ]),
    descriptorPolicy: CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_POLICY,
  }),
  Object.freeze({
    schemaVersion: CAPABILITY_HOOK_SCHEMA_VERSION,
    eventType: 'download.run.terminal',
    producerId: 'download-runner.terminal',
    sourceModule: 'src/sites/downloads/runner.mjs',
    phaseHints: Object.freeze(['after_download', 'on_completion']),
    lifecycleFields: Object.freeze([
      'eventType',
      'traceId',
      'correlationId',
      'taskId',
      'siteKey',
      'taskType',
      'adapterVersion',
      'reasonCode',
    ]),
    detailFields: Object.freeze([
      'status',
      'reason',
      'capabilityHookMatches',
    ]),
    descriptorPolicy: CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_POLICY,
  }),
  Object.freeze({
    schemaVersion: CAPABILITY_HOOK_SCHEMA_VERSION,
    eventType: 'social.action.risk_blocked',
    producerId: 'social-action-router.risk-blocked',
    sourceModule: 'src/sites/social/actions/router.mjs',
    phaseHints: Object.freeze(['on_risk', 'on_failure']),
    lifecycleFields: Object.freeze([
      'eventType',
      'traceId',
      'correlationId',
      'taskId',
      'siteKey',
      'taskType',
      'adapterVersion',
      'reasonCode',
    ]),
    detailFields: Object.freeze([
      'status',
      'reason',
      'riskSignals',
      'riskState',
      'capabilityHookMatches',
    ]),
    descriptorPolicy: CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_POLICY,
  }),
]);

export function createCapabilityHookEventTypeRegistry() {
  return {
    schemaVersion: CAPABILITY_HOOK_EVENT_TYPE_REGISTRY_SCHEMA_VERSION,
    eventTypes: [...CAPABILITY_HOOK_EVENT_TYPES],
  };
}

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function normalizePhase(value) {
  const phase = normalizeText(value);
  if (!phase || !CAPABILITY_HOOK_PHASES.includes(phase)) {
    throw new Error(`Unsupported CapabilityHook phase: ${String(value ?? '')}`);
  }
  return phase;
}

function normalizeHookType(value) {
  const hookType = normalizeText(value) ?? 'observer';
  if (!CAPABILITY_HOOK_TYPES.includes(hookType)) {
    throw new Error(`Unsupported CapabilityHook type: ${hookType}`);
  }
  return hookType;
}

function normalizeHookEventType(value) {
  const eventType = normalizeText(value);
  if (!eventType || !CAPABILITY_HOOK_EVENT_TYPES.includes(eventType)) {
    throw new Error(`Unsupported CapabilityHook eventType: ${String(value ?? '')}`);
  }
  return eventType;
}

function normalizeNonNegativeInteger(value, fallback, fieldName) {
  const numeric = Number(value ?? fallback);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`CapabilityHook ${fieldName} must be a non-negative number`);
  }
  return Math.trunc(numeric);
}

function normalizeReason(value) {
  const reasonCode = normalizeReasonCode(value);
  if (!reasonCode) {
    return undefined;
  }
  requireReasonCodeDefinition(reasonCode);
  return reasonCode;
}

function normalizeTextList(value, fieldName, {
  normalize = normalizeText,
} = {}) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const values = Array.isArray(value) ? value : [value];
  const normalized = values
    .map((entry) => normalize(entry))
    .filter(Boolean);
  if (!normalized.length) {
    throw new Error(`CapabilityHook ${fieldName} must include at least one value`);
  }
  return [...new Set(normalized)];
}

function stripUndefined(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function normalizeMaterialKey(value) {
  return String(value ?? '').replace(/[-_\s.]/gu, '').toLowerCase();
}

function assertNoProducerDescriptorMaterial(value, path = []) {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertNoProducerDescriptorMaterial(entry, [...path, String(index)]);
    }
    return true;
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && FORBIDDEN_PRODUCER_DESCRIPTOR_MATERIAL_KEYS.has(normalizeMaterialKey(value))) {
      throw new Error(`CapabilityHook producer descriptor must not include raw sensitive material field: ${path.join('.') || '$'}`);
    }
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const childPath = [...path, key];
    if (FORBIDDEN_PRODUCER_DESCRIPTOR_MATERIAL_KEYS.has(normalizeMaterialKey(key))) {
      throw new Error(`CapabilityHook producer descriptor must not include raw sensitive material field: ${childPath.join('.')}`);
    }
    assertNoProducerDescriptorMaterial(entry, childPath);
  }
  return true;
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

export function normalizeCapabilityHookSubscriber(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('CapabilityHook subscriber must be an object descriptor');
  }
  if (containsExecutableFunction(raw)) {
    throw new Error('CapabilityHook subscriber descriptor must not include executable functions');
  }
  const name = normalizeText(raw.name);
  if (!name) {
    throw new Error('CapabilityHook subscriber.name is required');
  }
  return stripUndefined({
    name,
    modulePath: normalizeText(raw.modulePath),
    entrypoint: normalizeText(raw.entrypoint),
    capability: normalizeText(raw.capability),
    order: normalizeNonNegativeInteger(raw.order, 0, 'subscriber.order'),
  });
}

function normalizeSafety(raw = {}, hookType) {
  const failClosed = raw.failClosed === undefined ? true : Boolean(raw.failClosed);
  const redactionRequired = raw.redactionRequired === undefined ? true : Boolean(raw.redactionRequired);
  const artifactWriteAllowed = raw.artifactWriteAllowed === undefined
    ? hookType === 'artifact_writer'
    : Boolean(raw.artifactWriteAllowed);
  if (artifactWriteAllowed && !redactionRequired) {
    throw new Error('CapabilityHook artifact writes require redaction');
  }
  return {
    failClosed,
    redactionRequired,
    artifactWriteAllowed,
  };
}

function normalizeHookFilters(raw = {}) {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('CapabilityHook filters must be an object descriptor');
  }
  const filters = stripUndefined({
    eventTypes: normalizeTextList(raw.eventTypes ?? raw.eventType, 'filters.eventTypes', {
      normalize: normalizeHookEventType,
    }),
    siteKeys: normalizeTextList(raw.siteKeys ?? raw.siteKey, 'filters.siteKeys'),
    taskTypes: normalizeTextList(raw.taskTypes ?? raw.taskType, 'filters.taskTypes'),
    adapterVersions: normalizeTextList(raw.adapterVersions ?? raw.adapterVersion, 'filters.adapterVersions'),
    reasonCodes: normalizeTextList(raw.reasonCodes ?? raw.reasonCode, 'filters.reasonCodes', {
      normalize: normalizeReason,
    }),
  });
  return Object.keys(filters).length ? filters : undefined;
}

function normalizeProducerDescriptorPolicy(raw = {}) {
  const descriptorPolicy = {
    descriptorOnly: raw.descriptorOnly === undefined ? true : Boolean(raw.descriptorOnly),
    executableHooksAllowed: raw.executableHooksAllowed === undefined ? false : Boolean(raw.executableHooksAllowed),
    hookInvocationAllowed: raw.hookInvocationAllowed === undefined ? false : Boolean(raw.hookInvocationAllowed),
    sensitiveMaterialAllowed: raw.sensitiveMaterialAllowed === undefined ? false : Boolean(raw.sensitiveMaterialAllowed),
    failClosed: raw.failClosed === undefined ? true : Boolean(raw.failClosed),
    rawCredentialsAllowed: raw.rawCredentialsAllowed === undefined ? false : Boolean(raw.rawCredentialsAllowed),
    rawSessionPayloadsAllowed: raw.rawSessionPayloadsAllowed === undefined ? false : Boolean(raw.rawSessionPayloadsAllowed),
    rawProfilePayloadsAllowed: raw.rawProfilePayloadsAllowed === undefined ? false : Boolean(raw.rawProfilePayloadsAllowed),
  };
  if (
    descriptorPolicy.descriptorOnly !== true
    || descriptorPolicy.executableHooksAllowed !== false
    || descriptorPolicy.hookInvocationAllowed !== false
    || descriptorPolicy.sensitiveMaterialAllowed !== false
    || descriptorPolicy.failClosed !== true
    || descriptorPolicy.rawCredentialsAllowed !== false
    || descriptorPolicy.rawSessionPayloadsAllowed !== false
    || descriptorPolicy.rawProfilePayloadsAllowed !== false
  ) {
    throw new Error('CapabilityHook producer descriptor policy must be descriptor-only and fail closed');
  }
  return descriptorPolicy;
}

function normalizeHookExecutionPolicy(raw = CAPABILITY_HOOK_EXECUTION_POLICY) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('CapabilityHook execution policy must be an object descriptor');
  }
  if (containsExecutableFunction(raw)) {
    throw new Error('CapabilityHook execution policy must not include executable functions');
  }
  const version = Number(raw.schemaVersion);
  if (!Number.isInteger(version)) {
    throw new Error('CapabilityHook execution policy schemaVersion is required');
  }
  if (version !== CAPABILITY_HOOK_EXECUTION_POLICY_SCHEMA_VERSION) {
    throw new Error(
      `CapabilityHook execution policy schemaVersion ${version} is not compatible with ${CAPABILITY_HOOK_EXECUTION_POLICY_SCHEMA_VERSION}`,
    );
  }
  const executionPolicy = {
    schemaVersion: CAPABILITY_HOOK_EXECUTION_POLICY_SCHEMA_VERSION,
    descriptorOnly: raw.descriptorOnly === undefined ? true : Boolean(raw.descriptorOnly),
    executionMode: normalizeText(raw.executionMode ?? 'descriptor_match_only'),
    executableDispatchEnabled: raw.executableDispatchEnabled === undefined ? false : Boolean(raw.executableDispatchEnabled),
    executableHooksAllowed: raw.executableHooksAllowed === undefined ? false : Boolean(raw.executableHooksAllowed),
    hookInvocationAllowed: raw.hookInvocationAllowed === undefined ? false : Boolean(raw.hookInvocationAllowed),
    failClosed: raw.failClosed === undefined ? true : Boolean(raw.failClosed),
    sensitiveMaterialAllowed: raw.sensitiveMaterialAllowed === undefined ? false : Boolean(raw.sensitiveMaterialAllowed),
  };
  if (
    executionPolicy.descriptorOnly !== true
    || executionPolicy.executionMode !== 'descriptor_match_only'
    || executionPolicy.executableDispatchEnabled !== false
    || executionPolicy.executableHooksAllowed !== false
    || executionPolicy.hookInvocationAllowed !== false
    || executionPolicy.failClosed !== true
    || executionPolicy.sensitiveMaterialAllowed !== false
  ) {
    throw new Error('CapabilityHook execution policy must be descriptor-only, dispatch-disabled, and fail closed');
  }
  const { value } = redactValue(executionPolicy);
  assertNoForbiddenPatterns(value);
  return value;
}

export function assertHookExecutionPolicyCompatible(raw = CAPABILITY_HOOK_EXECUTION_POLICY) {
  normalizeHookExecutionPolicy(raw);
  return true;
}

function normalizeCapabilityHookProducerDescriptor(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('CapabilityHook producer descriptor must be an object');
  }
  if (containsExecutableFunction(raw)) {
    throw new Error('CapabilityHook producer descriptor must not include executable functions');
  }
  assertNoProducerDescriptorMaterial(raw);
  assertNoForbiddenPatterns(raw);
  const version = Number(raw.schemaVersion);
  if (!Number.isInteger(version)) {
    throw new Error('CapabilityHook producer descriptor schemaVersion is required');
  }
  if (version !== CAPABILITY_HOOK_SCHEMA_VERSION) {
    throw new Error(
      `CapabilityHook producer descriptor schemaVersion ${version} is not compatible with ${CAPABILITY_HOOK_SCHEMA_VERSION}`,
    );
  }
  const descriptor = {
    schemaVersion: CAPABILITY_HOOK_SCHEMA_VERSION,
    eventType: normalizeHookEventType(raw.eventType),
    producerId: normalizeText(raw.producerId),
    sourceModule: normalizeText(raw.sourceModule),
    phaseHints: normalizeTextList(raw.phaseHints ?? raw.phases, 'producerDescriptor.phaseHints', {
      normalize: normalizePhase,
    }),
    lifecycleFields: normalizeTextList(raw.lifecycleFields, 'producerDescriptor.lifecycleFields'),
    detailFields: normalizeTextList(raw.detailFields, 'producerDescriptor.detailFields'),
    descriptorPolicy: normalizeProducerDescriptorPolicy(raw.descriptorPolicy),
  };
  if (!descriptor.producerId) {
    throw new Error('CapabilityHook producer descriptor producerId is required');
  }
  if (!descriptor.sourceModule) {
    throw new Error('CapabilityHook producer descriptor sourceModule is required');
  }
  const { value } = redactValue(descriptor);
  assertNoProducerDescriptorMaterial(value);
  assertNoForbiddenPatterns(value);
  return value;
}

export function assertCapabilityHookProducerDescriptorCompatible(raw = {}) {
  normalizeCapabilityHookProducerDescriptor(raw);
  return true;
}

export function createCapabilityHookProducerDescriptorRegistry({
  producers = CAPABILITY_HOOK_CRITICAL_PRODUCER_DESCRIPTORS,
} = {}) {
  const registry = {
    schemaVersion: CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_REGISTRY_SCHEMA_VERSION,
    descriptorPolicy: CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_POLICY,
    producers: producers.map((producer) => normalizeCapabilityHookProducerDescriptor(producer)),
  };
  assertCapabilityHookProducerDescriptorRegistryCompatible(registry);
  return registry;
}

export function assertCapabilityHookProducerDescriptorRegistryCompatible(raw = {}) {
  const version = Number(raw?.schemaVersion);
  if (!Number.isInteger(version)) {
    throw new Error('CapabilityHookProducerDescriptorRegistry schemaVersion is required');
  }
  if (version !== CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_REGISTRY_SCHEMA_VERSION) {
    throw new Error(
      `CapabilityHookProducerDescriptorRegistry schemaVersion ${version} is not compatible with ${CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_REGISTRY_SCHEMA_VERSION}`,
    );
  }
  normalizeProducerDescriptorPolicy(raw.descriptorPolicy);
  if (!Array.isArray(raw.producers)) {
    throw new Error('CapabilityHookProducerDescriptorRegistry producers must be an array');
  }
  assertNoProducerDescriptorMaterial(raw);
  assertNoForbiddenPatterns(raw);
  const seenEventTypes = new Set();
  for (const producer of raw.producers) {
    const normalized = normalizeCapabilityHookProducerDescriptor(producer);
    if (seenEventTypes.has(normalized.eventType)) {
      throw new Error(`Duplicate CapabilityHook producer descriptor eventType: ${normalized.eventType}`);
    }
    seenEventTypes.add(normalized.eventType);
  }
  for (const eventType of CAPABILITY_HOOK_CRITICAL_PRODUCER_EVENT_TYPES) {
    if (!seenEventTypes.has(eventType)) {
      throw new Error(`CapabilityHookProducerDescriptorRegistry must include high-risk producer descriptor: ${eventType}`);
    }
  }
  return true;
}

export function assertCapabilityHookCompatible(raw = {}) {
  const version = Number(raw?.schemaVersion);
  if (!Number.isInteger(version)) {
    throw new Error('CapabilityHook schemaVersion is required for compatibility checks');
  }
  if (version !== CAPABILITY_HOOK_SCHEMA_VERSION) {
    throw new Error(`CapabilityHook schemaVersion ${version} is not compatible with ${CAPABILITY_HOOK_SCHEMA_VERSION}`);
  }
  return true;
}

export function assertCapabilityHookEventTypeRegistryCompatible(raw = {}) {
  const version = Number(raw?.schemaVersion);
  if (!Number.isInteger(version)) {
    throw new Error('CapabilityHookEventTypeRegistry schemaVersion is required');
  }
  if (version !== CAPABILITY_HOOK_EVENT_TYPE_REGISTRY_SCHEMA_VERSION) {
    throw new Error(
      `CapabilityHookEventTypeRegistry schemaVersion ${version} is not compatible with ${CAPABILITY_HOOK_EVENT_TYPE_REGISTRY_SCHEMA_VERSION}`,
    );
  }
  if (!Array.isArray(raw.eventTypes)) {
    throw new Error('CapabilityHookEventTypeRegistry eventTypes must be an array');
  }
  const normalizedEventTypes = raw.eventTypes.map((eventType) => normalizeHookEventType(eventType));
  if (normalizedEventTypes.length !== CAPABILITY_HOOK_EVENT_TYPES.length) {
    throw new Error('CapabilityHookEventTypeRegistry eventTypes must match current runtime producer inventory');
  }
  for (const [index, eventType] of CAPABILITY_HOOK_EVENT_TYPES.entries()) {
    if (normalizedEventTypes[index] !== eventType) {
      throw new Error('CapabilityHookEventTypeRegistry eventTypes must match current runtime producer inventory');
    }
  }
  return true;
}

export function assertCapabilityHookRegistrySnapshotCompatible(raw = {}) {
  const version = Number(raw?.schemaVersion);
  if (!Number.isInteger(version)) {
    throw new Error('CapabilityHookRegistrySnapshot schemaVersion is required');
  }
  if (version !== CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(
      `CapabilityHookRegistrySnapshot schemaVersion ${version} is not compatible with ${CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION}`,
    );
  }
  if (!Array.isArray(raw.hooks)) {
    throw new Error('CapabilityHookRegistrySnapshot hooks must be an array');
  }
  assertNoForbiddenPatterns(raw);
  const seenIds = new Set();
  for (const hook of raw.hooks) {
    assertCapabilityHookCompatible(hook);
    const normalized = normalizeCapabilityHook(hook);
    if (seenIds.has(normalized.id)) {
      throw new Error(`Duplicate CapabilityHook id in registry snapshot: ${normalized.id}`);
    }
    seenIds.add(normalized.id);
  }
  return true;
}

export function normalizeCapabilityHook(raw = {}, defaults = {}) {
  if (containsExecutableFunction(raw) || containsExecutableFunction(defaults)) {
    throw new Error('CapabilityHook descriptor must not include executable functions');
  }
  if (raw.schemaVersion !== undefined) {
    assertCapabilityHookCompatible(raw);
  }
  const phase = normalizePhase(raw.phase ?? defaults.phase);
  const hookType = normalizeHookType(raw.hookType ?? raw.type ?? defaults.hookType);
  const subscriber = normalizeCapabilityHookSubscriber(raw.subscriber ?? defaults.subscriber);
  return stripUndefined({
    schemaVersion: CAPABILITY_HOOK_SCHEMA_VERSION,
    id: normalizeText(raw.id ?? defaults.id) ?? `${phase}:${subscriber.name}`,
    phase,
    hookType,
    subscriber,
    reasonCode: normalizeReason(raw.reasonCode ?? defaults.reasonCode),
    safety: normalizeSafety(raw.safety, hookType),
    filters: normalizeHookFilters(raw.filters ?? defaults.filters),
  });
}

function cloneHookDescriptor(hook) {
  return JSON.parse(JSON.stringify(hook));
}

function listRegistryHooks(hooksOrRegistry = []) {
  if (hooksOrRegistry && typeof hooksOrRegistry.list === 'function') {
    if (hooksOrRegistry[TRUSTED_CAPABILITY_HOOK_REGISTRY] !== true) {
      throw new Error('CapabilityHook lifecycle matching requires a trusted registry or hook descriptor array');
    }
    return hooksOrRegistry.list();
  }
  if (!Array.isArray(hooksOrRegistry)) {
    throw new Error('CapabilityHook lifecycle matching requires a hook descriptor array or trusted registry');
  }
  return hooksOrRegistry;
}

function normalizePhaseList(value) {
  const phases = normalizeTextList(value, 'lifecycleEvent.phases', {
    normalize: normalizePhase,
  });
  return phases ?? [];
}

function inferLifecycleEventPhases(event, options = {}) {
  if (options.phase !== undefined || options.phases !== undefined) {
    return normalizePhaseList(options.phases ?? options.phase);
  }
  const explicitPhase = event.details?.capabilityHookPhase
    ?? event.details?.lifecyclePhase
    ?? event.details?.phase;
  if (explicitPhase !== undefined) {
    return normalizePhaseList(explicitPhase);
  }
  const eventType = String(event.eventType ?? '');
  const phases = new Set();
  if (eventType === 'api.catalog.schema_incompatible') {
    phases.add('after_catalog_verify');
    phases.add('on_failure');
  }
  if (
    eventType === 'api.catalog.collection.written'
    || eventType === 'api.catalog.index.written'
  ) {
    phases.add('after_catalog_verify');
    phases.add('after_artifact_write');
  }
  if (eventType.startsWith('capture.')) {
    phases.add('after_capture');
  }
  if (/api[-_.]?candidates?|candidate/i.test(eventType) && /written|write|created|persisted/i.test(eventType)) {
    phases.add('after_candidate_write');
  }
  if (/catalog/i.test(eventType) && /verif/i.test(eventType)) {
    phases.add('after_catalog_verify');
  }
  if (/session/i.test(eventType) && /materialize|completed|run/i.test(eventType)) {
    phases.add('after_session_materialize');
  }
  if (/download/i.test(eventType)) {
    phases.add('after_download');
  }
  if (/artifact/i.test(eventType) && /written|write|persisted/i.test(eventType)) {
    phases.add('after_artifact_write');
  }
  if (/risk/i.test(eventType)) {
    phases.add('on_risk');
  }
  if (/cooldown/i.test(eventType)) {
    phases.add('on_cooldown');
  }
  if (
    event.details?.manualRecoveryNeeded === true
    || event.details?.riskState?.recovery?.manualRecoveryNeeded === true
    || /manual[-_.]?recovery/i.test(eventType)
  ) {
    phases.add('on_manual_recovery_required');
  }
  if (/fail|error|rejected|blocked/i.test(eventType)) {
    phases.add('on_failure');
  }
  if (/completed|terminal|success/i.test(eventType)) {
    phases.add('on_completion');
  }
  return [...phases];
}

function filterMatches(values, actual) {
  return !values || values.includes(actual);
}

function hookMatchesEvent(hook, event, phases) {
  if (!phases.includes(hook.phase)) {
    return false;
  }
  const filters = hook.filters ?? {};
  return filterMatches(filters.eventTypes, event.eventType)
    && filterMatches(filters.siteKeys, event.siteKey)
    && filterMatches(filters.taskTypes, event.taskType)
    && filterMatches(filters.adapterVersions, event.adapterVersion)
    && filterMatches(filters.reasonCodes, event.reasonCode);
}

function summarizeHookMatch(hook) {
  return stripUndefined({
    id: hook.id,
    phase: hook.phase,
    hookType: hook.hookType,
    subscriber: {
      name: hook.subscriber.name,
      capability: hook.subscriber.capability,
      order: hook.subscriber.order,
    },
    reasonCode: hook.reasonCode,
    safety: hook.safety,
    filters: hook.filters,
  });
}

function summarizeLifecycleEvent(event) {
  return stripUndefined({
    schemaVersion: event.schemaVersion,
    eventType: event.eventType,
    traceId: event.traceId,
    correlationId: event.correlationId,
    taskId: event.taskId,
    siteKey: event.siteKey,
    taskType: event.taskType,
    adapterVersion: event.adapterVersion,
    reasonCode: event.reasonCode,
  });
}

function summarizeLifecyclePhaseEvidence(event, options, phases) {
  const details = event.details ?? {};
  let source = 'event_type_inference';
  let detailField;
  if (options.phase !== undefined || options.phases !== undefined) {
    source = 'options';
  } else if (details.capabilityHookPhase !== undefined) {
    source = 'lifecycle_event_details';
    detailField = 'capabilityHookPhase';
  } else if (details.lifecyclePhase !== undefined) {
    source = 'lifecycle_event_details';
    detailField = 'lifecyclePhase';
  } else if (details.phase !== undefined) {
    source = 'lifecycle_event_details';
    detailField = 'phase';
  }
  return stripUndefined({
    source,
    detailField,
    phases,
    phaseCount: phases.length,
  });
}

function summarizeLifecycleProducerFamilyEvidence(event) {
  const [family, producer, ...eventNameParts] = String(event.eventType ?? '')
    .split('.')
    .filter(Boolean);
  if (!family) {
    return undefined;
  }
  const eventName = eventNameParts.join('.');
  return stripUndefined({
    source: 'event_type_prefix',
    family,
    producer,
    eventName,
    inferredTerminal: /terminal/i.test(eventName),
    inferredCompletion: /completed|terminal|success/i.test(eventName),
  });
}

export function matchCapabilityHooksForLifecycleEvent(hooksOrRegistry = [], lifecycleEvent = {}, options = {}) {
  if (
    (!hooksOrRegistry || typeof hooksOrRegistry.list !== 'function') && containsExecutableFunction(hooksOrRegistry)
    || containsExecutableFunction(lifecycleEvent)
    || containsExecutableFunction(options)
  ) {
    throw new Error('CapabilityHook lifecycle matching must not include executable functions');
  }
  const executionPolicy = normalizeHookExecutionPolicy(options.executionPolicy ?? CAPABILITY_HOOK_EXECUTION_POLICY);
  const event = normalizeLifecycleEvent(lifecycleEvent);
  assertLifecycleEventCompatible(event);
  const phases = inferLifecycleEventPhases(event, options);
  const hooks = listRegistryHooks(hooksOrRegistry)
    .map((hook) => normalizeCapabilityHook(hook))
    .filter((hook) => hookMatchesEvent(hook, event, phases))
    .sort((left, right) => {
      const orderDelta = left.subscriber.order - right.subscriber.order;
      return orderDelta || left.id.localeCompare(right.id);
    });
  const summary = {
    schemaVersion: CAPABILITY_HOOK_SCHEMA_VERSION,
    executionPolicy,
    lifecycleEvent: summarizeLifecycleEvent(event),
    phases,
    matchCount: hooks.length,
    matches: hooks.map(summarizeHookMatch),
  };
  const { value } = redactValue(summary);
  assertNoForbiddenPatterns(value);
  return value;
}

export function createCapabilityHookLifecycleEvidence(hooksOrRegistry = [], lifecycleEvent = {}, options = {}) {
  const event = normalizeLifecycleEvent(lifecycleEvent);
  assertLifecycleEventCompatible(event);
  const matchSummary = matchCapabilityHooksForLifecycleEvent(hooksOrRegistry, event, options);
  const evidence = {
    schemaVersion: CAPABILITY_HOOK_SCHEMA_VERSION,
    evidenceType: 'capability_hook.lifecycle_match_summary',
    descriptorPolicy: CAPABILITY_HOOK_DESCRIPTOR_POLICY,
    executionPolicy: matchSummary.executionPolicy,
    lifecycleEvent: matchSummary.lifecycleEvent,
    phaseSummary: summarizeLifecyclePhaseEvidence(event, options, matchSummary.phases),
    producerFamilySummary: summarizeLifecycleProducerFamilyEvidence(event),
    matchSummary: {
      matchCount: matchSummary.matchCount,
      matches: matchSummary.matches,
    },
  };
  const { value } = redactValue(evidence);
  assertNoForbiddenPatterns(value);
  return value;
}

export function createCapabilityHookRegistrySnapshot(hooksOrRegistry = []) {
  const hooks = listRegistryHooks(hooksOrRegistry).map((hook) => normalizeCapabilityHook(hook));
  const { value } = redactValue({
    schemaVersion: CAPABILITY_HOOK_REGISTRY_SNAPSHOT_SCHEMA_VERSION,
    hooks,
  });
  assertCapabilityHookRegistrySnapshotCompatible(value);
  return value;
}

export function createCapabilityHookRegistry(initialHooks = []) {
  if (!Array.isArray(initialHooks)) {
    throw new Error('CapabilityHook registry initialHooks must be an array');
  }
  const hooksById = new Map();
  const register = (raw = {}, defaults = {}) => {
    const hook = normalizeCapabilityHook(raw, defaults);
    if (hooksById.has(hook.id)) {
      throw new Error(`Duplicate CapabilityHook id: ${hook.id}`);
    }
    hooksById.set(hook.id, hook);
    return cloneHookDescriptor(hook);
  };
  for (const hook of initialHooks) {
    register(hook);
  }
  return Object.freeze({
    [TRUSTED_CAPABILITY_HOOK_REGISTRY]: true,
    register,
    get(id) {
      const hook = hooksById.get(String(id ?? '').trim());
      return hook ? cloneHookDescriptor(hook) : undefined;
    },
    list() {
      return Array.from(hooksById.values(), cloneHookDescriptor);
    },
    listByPhase(phase) {
      const normalizedPhase = normalizePhase(phase);
      return Array.from(hooksById.values())
        .filter((hook) => hook.phase === normalizedPhase)
        .map(cloneHookDescriptor);
    },
    snapshot() {
      return createCapabilityHookRegistrySnapshot(Array.from(hooksById.values()));
    },
    matchLifecycleEvent(lifecycleEvent, options = {}) {
      return matchCapabilityHooksForLifecycleEvent(Array.from(hooksById.values()), lifecycleEvent, options);
    },
    size() {
      return hooksById.size;
    },
  });
}
