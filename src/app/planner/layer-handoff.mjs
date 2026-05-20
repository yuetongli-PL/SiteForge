// @ts-check

import {
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
  SITE_CAPABILITY_PLANNER_VERSION,
} from './schema.mjs';
import {
  assertCapabilityPlanCompatible,
  assertNoPlannerSensitiveMaterial,
} from './validator.mjs';
import {
  assertPlannerDryRunResultCompatible,
} from './dry-run.mjs';
import {
  isPlannerReasonCode,
} from './reason-codes.mjs';

const FORBIDDEN_HANDOFF_DESCRIPTOR_FIELDS = Object.freeze([
  'request',
  'context',
  'planContext',
  'graph',
  'rawGraph',
  'validationReport',
  'payload',
  'runtimePayload',
  'handoffPayload',
  'layerPayload',
  'json',
  'artifactJson',
  'artifact',
  'manifest',
  'auditJson',
  'sessionView',
  'downloadPolicy',
  'standardTaskList',
  'siteAdapterRuntime',
  'downloaderPayload',
  'browserContext',
  'resolvedResources',
  'handler',
  'executor',
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function fail(message, code = 'planner.layer_handoff_unavailable') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) {
    fail(`${name} must be a plain object`, 'planner.schema_missing');
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${name} is required`, 'planner.schema_missing');
  }
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
    if (FORBIDDEN_HANDOFF_DESCRIPTOR_FIELDS.includes(key)) {
      const pathName = [...pathParts, key].join('.');
      fail(`PlannerLayerHandoffDescriptor must not expose runtime payload field ${pathName}`, 'planner.sensitive_material_forbidden');
    }
    assertNoPayloadFields(child, [...pathParts, key]);
  }
  return true;
}

function firstPlanFailure(capabilityPlan) {
  return Array.isArray(capabilityPlan.failures) && capabilityPlan.failures.length
    ? capabilityPlan.failures[0]
    : undefined;
}

function firstContextFailure(dryRunResult) {
  return Array.isArray(dryRunResult?.contextCheck?.failures) && dryRunResult.contextCheck.failures.length
    ? dryRunResult.contextCheck.failures[0]
    : undefined;
}

function assertEqual(actual, expected, name) {
  if (actual !== expected) {
    fail(`PlannerLayerHandoffDescriptor ${name} must match dry-run and CapabilityPlan`);
  }
}

function assertHandoffConsistency(descriptor) {
  const { dryRunResult, capabilityPlan } = descriptor;
  const routeId = capabilityPlan.selectedRoute?.routeId;
  const contextSatisfied = dryRunResult.contextCheck?.checkStatus === 'satisfied';
  const planReady = capabilityPlan.planStatus === 'ready'
    && dryRunResult.planStatus === 'ready'
    && contextSatisfied;

  assertEqual(dryRunResult.capabilityPlan.planStatus, capabilityPlan.planStatus, 'planStatus');
  assertEqual(dryRunResult.capabilityPlan.siteId, capabilityPlan.siteId, 'siteId');
  assertEqual(dryRunResult.capabilityPlan.normalizedIntent, capabilityPlan.normalizedIntent, 'normalizedIntent');
  assertEqual(dryRunResult.capabilityPlan.capabilityId, capabilityPlan.capabilityId, 'capabilityId');
  assertEqual(dryRunResult.capabilityPlan.selectedRoute?.routeId, routeId, 'routeId');
  assertEqual(dryRunResult.capabilityPlan.graphVersion, capabilityPlan.graphVersion, 'graphVersion');
  assertEqual(
    dryRunResult.capabilityPlan.layerCompatibilityVersion,
    capabilityPlan.layerCompatibilityVersion,
    'layerCompatibilityVersion',
  );
  assertEqual(descriptor.routeId, routeId, 'routeId');
  assertEqual(descriptor.graphVersion, capabilityPlan.graphVersion, 'graphVersion');
  assertEqual(descriptor.layerCompatibilityVersion, capabilityPlan.layerCompatibilityVersion, 'layerCompatibilityVersion');
  assertEqual(descriptor.siteId, capabilityPlan.siteId, 'siteId');
  assertEqual(descriptor.normalizedIntent, capabilityPlan.normalizedIntent, 'normalizedIntent');
  assertEqual(descriptor.capabilityId, capabilityPlan.capabilityId, 'capabilityId');
  if (descriptor.governedHandoffReady !== planReady) {
    fail('PlannerLayerHandoffDescriptor governedHandoffReady must match dry-run readiness');
  }
  if (!planReady) {
    if (!isPlannerReasonCode(descriptor.reasonCode)) {
      fail('PlannerLayerHandoffDescriptor blocked handoff requires cataloged reasonCode');
    }
    if (
      descriptor.reasonCode !== firstPlanFailure(capabilityPlan)?.reasonCode
      && descriptor.reasonCode !== firstContextFailure(dryRunResult)?.reasonCode
      && descriptor.reasonCode !== 'planner.layer_handoff_unavailable'
    ) {
      fail('PlannerLayerHandoffDescriptor reasonCode must match blocked dry-run state');
    }
  }
}

export function assertPlannerLayerHandoffDescriptorCompatible(descriptor) {
  assertPlainObject(descriptor, 'PlannerLayerHandoffDescriptor');
  if (descriptor.schemaVersion !== SITE_CAPABILITY_PLANNER_SCHEMA_VERSION) {
    fail('PlannerLayerHandoffDescriptor schemaVersion is not compatible', 'planner.version_incompatible');
  }
  if (descriptor.plannerVersion !== SITE_CAPABILITY_PLANNER_VERSION) {
    fail('PlannerLayerHandoffDescriptor plannerVersion is not compatible', 'planner.version_incompatible');
  }
  if (
    descriptor.descriptorType !== 'PlannerLayerHandoffDescriptor'
    || descriptor.handoffTarget !== 'site-capability-layer'
    || descriptor.handoffMode !== 'governed_handoff'
  ) {
    fail('PlannerLayerHandoffDescriptor target is not compatible');
  }
  assertNonEmptyString(descriptor.planId, 'PlannerLayerHandoffDescriptor planId');
  assertNonEmptyString(descriptor.taskId, 'PlannerLayerHandoffDescriptor taskId');
  assertNonEmptyString(descriptor.traceId, 'PlannerLayerHandoffDescriptor traceId');
  assertNonEmptyString(descriptor.correlationId, 'PlannerLayerHandoffDescriptor correlationId');
  assertNonEmptyString(descriptor.siteId, 'PlannerLayerHandoffDescriptor siteId');
  assertNonEmptyString(descriptor.siteKey, 'PlannerLayerHandoffDescriptor siteKey');
  assertNonEmptyString(descriptor.normalizedIntent, 'PlannerLayerHandoffDescriptor normalizedIntent');
  assertNonEmptyString(descriptor.capabilityId, 'PlannerLayerHandoffDescriptor capabilityId');
  assertNonEmptyString(descriptor.routeId, 'PlannerLayerHandoffDescriptor routeId');
  assertNonEmptyString(descriptor.graphVersion, 'PlannerLayerHandoffDescriptor graphVersion');
  assertNonEmptyString(descriptor.layerCompatibilityVersion, 'PlannerLayerHandoffDescriptor layerCompatibilityVersion');
  assertPlainObject(descriptor.selectedRoute, 'PlannerLayerHandoffDescriptor selectedRoute');
  assertPlannerDryRunResultCompatible(descriptor.dryRunResult);
  assertCapabilityPlanCompatible(descriptor.capabilityPlan);
  assertHandoffConsistency(descriptor);
  if (
    descriptor.redactionRequired !== true
    || descriptor.descriptorOnly !== true
    || descriptor.executionAllowed !== false
    || descriptor.layerDispatchAllowed !== false
    || descriptor.layerHandoffAllowed !== false
    || descriptor.siteAdapterInvocationAllowed !== false
    || descriptor.downloaderInvocationAllowed !== false
    || descriptor.sessionMaterializationAllowed !== false
    || descriptor.runtimeMaterializationAllowed !== false
    || descriptor.artifactServiceInvocationAllowed !== false
    || descriptor.lifecycleDispatchAllowed !== false
    || descriptor.externalTelemetryAllowed !== false
    || descriptor.graphMutationAllowed !== false
    || descriptor.logsWriteAllowed !== false
  ) {
    fail('PlannerLayerHandoffDescriptor must be descriptor-only with runtime outputs disabled');
  }
  assertNoPayloadFields(descriptor);
  assertNoPlannerSensitiveMaterial(descriptor);
  return true;
}

export function createPlannerLayerHandoffDescriptor({
  dryRunResult,
  capabilityPlan = dryRunResult?.capabilityPlan,
} = {}) {
  assertPlannerDryRunResultCompatible(dryRunResult);
  assertCapabilityPlanCompatible(capabilityPlan);
  const failure = firstPlanFailure(capabilityPlan) ?? firstContextFailure(dryRunResult);
  const routeId = capabilityPlan.selectedRoute.routeId;
  const governedHandoffReady = capabilityPlan.planStatus === 'ready'
    && dryRunResult.planStatus === 'ready'
    && dryRunResult.contextCheck.checkStatus === 'satisfied';
  const descriptor = {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    plannerVersion: SITE_CAPABILITY_PLANNER_VERSION,
    descriptorType: 'PlannerLayerHandoffDescriptor',
    handoffTarget: 'site-capability-layer',
    handoffMode: 'governed_handoff',
    planId: `plan:${capabilityPlan.siteId}:${capabilityPlan.capabilityId}:${routeId}`,
    governedHandoffReady,
    reasonCode: governedHandoffReady ? undefined : failure?.reasonCode ?? 'planner.layer_handoff_unavailable',
    sourceReasonCode: failure?.sourceReasonCode,
    taskId: dryRunResult?.lifecycleEvent?.taskId ?? `planner-task:${capabilityPlan.siteId}`,
    traceId: dryRunResult?.lifecycleEvent?.traceId,
    correlationId: dryRunResult?.lifecycleEvent?.correlationId,
    siteId: capabilityPlan.siteId,
    siteKey: dryRunResult.routeResolution.siteKey,
    normalizedIntent: capabilityPlan.normalizedIntent,
    capabilityId: capabilityPlan.capabilityId,
    routeId,
    selectedRoute: capabilityPlan.selectedRoute,
    graphVersion: capabilityPlan.graphVersion,
    layerCompatibilityVersion: capabilityPlan.layerCompatibilityVersion,
    capabilityPlan,
    dryRunResult,
    redactionRequired: true,
    descriptorOnly: true,
    executionAllowed: false,
    layerDispatchAllowed: false,
    layerHandoffAllowed: false,
    siteAdapterInvocationAllowed: false,
    downloaderInvocationAllowed: false,
    sessionMaterializationAllowed: false,
    runtimeMaterializationAllowed: false,
    artifactServiceInvocationAllowed: false,
    lifecycleDispatchAllowed: false,
    externalTelemetryAllowed: false,
    graphMutationAllowed: false,
    logsWriteAllowed: false,
  };
  assertPlannerLayerHandoffDescriptorCompatible(descriptor);
  return descriptor;
}
