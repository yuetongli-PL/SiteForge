// @ts-check

import {
  SECURITY_GUARD_SCHEMA_VERSION,
} from '../../domain/sessions/security-guard.mjs';
import {
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
  SITE_CAPABILITY_PLANNER_VERSION,
} from './schema.mjs';
import {
  assertNoPlannerSensitiveMaterial,
} from './validator.mjs';
import {
  assertPlannerArtifactWriteResultCompatible,
} from './plan-artifact.mjs';
import {
  isPlannerReasonCode,
} from './reason-codes.mjs';

export const PLANNER_LIFECYCLE_EVENT_TYPES = Object.freeze([
  'planner.plan.generated',
  'planner.plan.blocked',
  'planner.validation.result',
  'planner.artifact.write_recorded',
  'planner.redaction.recorded',
]);

export const PLANNER_LIFECYCLE_DECISION_STATUSES = Object.freeze([
  'ready',
  'blocked',
  'degraded',
  'failed',
]);

const FORBIDDEN_OBSERVABILITY_FIELDS = Object.freeze([
  'payload',
  'runtimePayload',
  'eventPayload',
  'observabilityPayload',
  'telemetryPayload',
  'json',
  'auditJson',
  'artifactJson',
  'artifactValue',
  'artifact',
  'manifest',
  'rawEvent',
  'request',
  'response',
  'logContext',
  'handler',
  'subscriber',
  'dispatch',
  'sink',
  'writePath',
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function fail(message, code = 'planner.schema_missing') {
  /** @type {Error & Record<string, any>} */
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) {
    fail(`${name} must be a plain object`);
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${name} is required`);
  }
}

function assertNonNegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    fail(`${name} must be a non-negative integer`, 'planner.artifact_redaction_failed');
  }
}

function assertNoFunctions(value, pathParts = []) {
  if (typeof value === 'function') {
    const pathName = pathParts.length ? pathParts.join('.') : 'event';
    fail(`PlannerLifecycleEvent must not contain executable function at ${pathName}`, 'planner.sensitive_material_forbidden');
  }
  if (!value || typeof value !== 'object') {
    return true;
  }
  for (const [key, child] of Object.entries(value)) {
    assertNoFunctions(child, [...pathParts, key]);
  }
  return true;
}

function assertNoPayloadFields(value, pathParts = []) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertNoPayloadFields(item, [...pathParts, String(index)]);
    }
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_OBSERVABILITY_FIELDS.includes(key)) {
      const pathName = [...pathParts, key].join('.');
      fail(`PlannerLifecycleEvent must not expose payload field ${pathName}`, 'planner.sensitive_material_forbidden');
    }
    assertNoPayloadFields(child, [...pathParts, key]);
  }
  return true;
}

function assertPlannerReason(value, name) {
  if (value === undefined || value === null || value === '') {
    return true;
  }
  if (!isPlannerReasonCode(value)) {
    fail(`${name} must be a cataloged Planner reasonCode`, 'planner.plan_generation_failed');
  }
  return true;
}

function assertOptionalReasonField(value, name) {
  if (!isPlainObject(value)) {
    return true;
  }
  assertPlannerReason(value.reasonCode, `${name}.reasonCode`);
  return true;
}

function assertRedactionEventCompatible(redactionEvent) {
  if (redactionEvent === undefined) {
    return true;
  }
  assertPlainObject(redactionEvent, 'PlannerLifecycleEvent redactionEvent');
  if (
    redactionEvent.schemaVersion !== SECURITY_GUARD_SCHEMA_VERSION
    || redactionEvent.redactionRequired !== true
    || redactionEvent.descriptorOnly !== true
  ) {
    fail('PlannerLifecycleEvent redactionEvent must be a redaction-required descriptor', 'planner.artifact_redaction_failed');
  }
  assertNonNegativeInteger(redactionEvent.redactionCount, 'PlannerLifecycleEvent redactionEvent.redactionCount');
  assertNonNegativeInteger(redactionEvent.findingCount, 'PlannerLifecycleEvent redactionEvent.findingCount');
  return true;
}

function assertSafetyFlags(event) {
  if (
    event.redactionRequired !== true
    || event.descriptorOnly !== true
    || event.executionAllowed !== false
    || event.layerHandoffAllowed !== false
    || event.runtimeMaterializationAllowed !== false
    || event.siteAdapterInvocationAllowed !== false
    || event.downloaderInvocationAllowed !== false
    || event.artifactServiceInvocationAllowed !== false
    || event.externalTelemetryAllowed !== false
    || event.lifecycleDispatchAllowed !== false
    || event.graphMutationAllowed !== false
    || event.logsWriteAllowed !== false
  ) {
    fail('PlannerLifecycleEvent must be a redaction-required descriptor with all runtime outputs disabled', 'planner.artifact_redaction_required');
  }
}

function assertPlannerDecision(event) {
  assertPlainObject(event.plannerDecision, 'PlannerLifecycleEvent plannerDecision');
  const status = event.plannerDecision.status;
  if (!PLANNER_LIFECYCLE_DECISION_STATUSES.includes(status)) {
    fail('PlannerLifecycleEvent plannerDecision.status is unsupported', 'planner.request_invalid');
  }
  assertPlannerReason(event.plannerDecision.reasonCode, 'PlannerLifecycleEvent plannerDecision.reasonCode');
  if (['blocked', 'degraded', 'failed'].includes(status) && !event.reasonCode && !event.plannerDecision.reasonCode) {
    fail('PlannerLifecycleEvent blocked/degraded/failed decisions require reasonCode', 'planner.plan_generation_failed');
  }
  return true;
}

function assertEventTypeRequirements(event) {
  switch (event.eventType) {
    case 'planner.plan.generated':
      for (const field of [
        'capabilityId',
        'routeId',
        'graphVersion',
        'layerCompatibilityVersion',
        'adapterId',
      ]) {
        assertNonEmptyString(event[field], `PlannerLifecycleEvent ${field}`);
      }
      break;
    case 'planner.validation.result':
      assertPlainObject(event.validationResult, 'PlannerLifecycleEvent validationResult');
      break;
    case 'planner.artifact.write_recorded':
      assertPlainObject(event.artifactWriteEvent, 'PlannerLifecycleEvent artifactWriteEvent');
      break;
    case 'planner.redaction.recorded':
      assertPlainObject(event.redactionEvent, 'PlannerLifecycleEvent redactionEvent');
      break;
    default:
      break;
  }
}

export function assertPlannerLifecycleEventCompatible(event) {
  assertPlainObject(event, 'PlannerLifecycleEvent');
  if (event.schemaVersion !== SITE_CAPABILITY_PLANNER_SCHEMA_VERSION) {
    fail('PlannerLifecycleEvent schemaVersion is not compatible', 'planner.version_incompatible');
  }
  assertNonEmptyString(event.plannerVersion, 'PlannerLifecycleEvent plannerVersion');
  if (!PLANNER_LIFECYCLE_EVENT_TYPES.includes(event.eventType)) {
    fail('PlannerLifecycleEvent eventType is unsupported', 'planner.request_invalid');
  }
  for (const field of [
    'traceId',
    'correlationId',
    'taskId',
    'normalizedIntent',
  ]) {
    assertNonEmptyString(event[field], `PlannerLifecycleEvent ${field}`);
  }
  if (!event.siteId && !event.siteKey) {
    fail('PlannerLifecycleEvent siteId or siteKey is required', 'planner.site_unresolved');
  }
  assertPlannerDecision(event);
  assertPlannerReason(event.reasonCode, 'PlannerLifecycleEvent reasonCode');
  assertOptionalReasonField(event.riskState, 'PlannerLifecycleEvent riskState');
  assertOptionalReasonField(event.validationResult, 'PlannerLifecycleEvent validationResult');
  if (event.artifactWriteEvent !== undefined) {
    assertPlannerArtifactWriteResultCompatible(event.artifactWriteEvent);
  }
  assertRedactionEventCompatible(event.redactionEvent);
  assertEventTypeRequirements(event);
  assertSafetyFlags(event);
  assertNoPayloadFields(event);
  assertNoFunctions(event);
  assertNoPlannerSensitiveMaterial(event);
  return true;
}

/** @param {Record<string, any>} [raw] */
export function createPlannerLifecycleEvent(raw = {}, defaults = {}) {
  const event = {
    schemaVersion: raw.schemaVersion ?? defaults.schemaVersion ?? SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    plannerVersion: raw.plannerVersion ?? defaults.plannerVersion ?? SITE_CAPABILITY_PLANNER_VERSION,
    eventType: raw.eventType ?? defaults.eventType ?? 'planner.plan.generated',
    createdAt: raw.createdAt ?? defaults.createdAt ?? new Date().toISOString(),
    traceId: raw.traceId ?? defaults.traceId,
    correlationId: raw.correlationId ?? defaults.correlationId,
    taskId: raw.taskId ?? defaults.taskId,
    siteId: raw.siteId ?? defaults.siteId,
    siteKey: raw.siteKey ?? defaults.siteKey,
    normalizedIntent: raw.normalizedIntent ?? defaults.normalizedIntent,
    capabilityId: raw.capabilityId ?? defaults.capabilityId,
    routeId: raw.routeId ?? defaults.routeId,
    graphVersion: raw.graphVersion ?? defaults.graphVersion,
    layerCompatibilityVersion: raw.layerCompatibilityVersion ?? defaults.layerCompatibilityVersion,
    adapterId: raw.adapterId ?? defaults.adapterId,
    plannerDecision: raw.plannerDecision ?? defaults.plannerDecision,
    reasonCode: raw.reasonCode ?? defaults.reasonCode,
    riskState: raw.riskState ?? defaults.riskState,
    validationResult: raw.validationResult ?? defaults.validationResult,
    artifactWriteEvent: raw.artifactWriteEvent ?? defaults.artifactWriteEvent,
    redactionEvent: raw.redactionEvent ?? defaults.redactionEvent,
    redactionRequired: raw.redactionRequired ?? defaults.redactionRequired ?? true,
    descriptorOnly: raw.descriptorOnly ?? defaults.descriptorOnly ?? true,
    executionAllowed: raw.executionAllowed ?? defaults.executionAllowed ?? false,
    layerHandoffAllowed: raw.layerHandoffAllowed ?? defaults.layerHandoffAllowed ?? false,
    runtimeMaterializationAllowed: raw.runtimeMaterializationAllowed ?? defaults.runtimeMaterializationAllowed ?? false,
    siteAdapterInvocationAllowed: raw.siteAdapterInvocationAllowed ?? defaults.siteAdapterInvocationAllowed ?? false,
    downloaderInvocationAllowed: raw.downloaderInvocationAllowed ?? defaults.downloaderInvocationAllowed ?? false,
    artifactServiceInvocationAllowed: raw.artifactServiceInvocationAllowed ?? defaults.artifactServiceInvocationAllowed ?? false,
    externalTelemetryAllowed: raw.externalTelemetryAllowed ?? defaults.externalTelemetryAllowed ?? false,
    lifecycleDispatchAllowed: raw.lifecycleDispatchAllowed ?? defaults.lifecycleDispatchAllowed ?? false,
    graphMutationAllowed: raw.graphMutationAllowed ?? defaults.graphMutationAllowed ?? false,
    logsWriteAllowed: raw.logsWriteAllowed ?? defaults.logsWriteAllowed ?? false,
  };
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in event)) {
      event[key] = value;
    }
  }
  assertPlannerLifecycleEventCompatible(event);
  return event;
}
