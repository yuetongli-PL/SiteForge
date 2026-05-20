// @ts-check

import {
  PLANNER_SELECTED_ROUTE_SOURCE,
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
  SITE_CAPABILITY_PLANNER_VERSION,
} from './schema.mjs';
import {
  assertPlannerRouteResolutionCompatible,
} from './route-resolver.mjs';
import {
  assertPlannerContextCheckCompatible,
} from './context-checker.mjs';
import {
  assertNoPlannerSensitiveMaterial,
} from './validator.mjs';
import {
  isPlannerReasonCode,
} from './reason-codes.mjs';

const FALLBACK_DECISION_STATUSES = Object.freeze([
  'not_required',
  'fallback_selected',
  'fallback_not_found',
  'not_degradable',
]);

const FALLBACK_ELIGIBLE_REASON_CODES = Object.freeze([
  'planner.route_forbidden_by_risk',
  'planner.route_context_unsatisfied',
  'planner.version_incompatible',
  'planner.schema_missing',
]);

const FORBIDDEN_FALLBACK_DECISION_FIELDS = Object.freeze([
  'request',
  'context',
  'graph',
  'validationReport',
  'payload',
  'runtimePayload',
  'fallbackPayload',
  'graphPayload',
  'contextPayload',
  'handoffPayload',
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
  'page',
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function fail(message, code = 'planner.fallback_not_found') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertPlainObject(value, name, code = 'planner.fallback_not_found') {
  if (!isPlainObject(value)) {
    fail(`${name} must be a plain object`, code);
  }
}

function assertNonEmptyString(value, name, code = 'planner.fallback_not_found') {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${name} is required`, code);
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
    if (FORBIDDEN_FALLBACK_DECISION_FIELDS.includes(key)) {
      const pathName = [...pathParts, key].join('.');
      fail(`PlannerFallbackDecision must not expose runtime payload field ${pathName}`, 'planner.sensitive_material_forbidden');
    }
    assertNoPayloadFields(child, [...pathParts, key]);
  }
  return true;
}

function assertGraphRouteDescriptor(route, graphVersion, name) {
  assertPlainObject(route, name, 'planner.route_not_found');
  assertNonEmptyString(route.routeId, `${name} routeId`, 'planner.route_not_found');
  if (route.source !== PLANNER_SELECTED_ROUTE_SOURCE) {
    fail(`${name} source must be site-capability-graph`, 'planner.route_not_found');
  }
  if (route.graphVersion !== graphVersion) {
    fail(`${name} graphVersion must match fallback decision`, 'planner.version_incompatible');
  }
}

function assertRouteAndContextMatch(decision) {
  if (decision.contextCheck.graphVersion !== decision.routeResolution.graphVersion) {
    fail('PlannerFallbackDecision contextCheck graphVersion must match routeResolution', 'planner.version_incompatible');
  }
  for (const field of ['siteKey', 'normalizedIntent']) {
    if (decision[field] !== decision.routeResolution[field]) {
      fail(`PlannerFallbackDecision ${field} must match routeResolution`);
    }
  }
  for (const field of ['siteId', 'capabilityId']) {
    if (decision.contextCheck[field] !== decision.routeResolution[field]) {
      fail(`PlannerFallbackDecision contextCheck ${field} must match routeResolution`);
    }
  }
  if (decision.contextCheck.routeId !== decision.routeResolution.selectedRoute.routeId) {
    fail('PlannerFallbackDecision contextCheck routeId must match selected route');
  }
}

function firstFailure(contextCheck) {
  return Array.isArray(contextCheck?.failures) && contextCheck.failures.length
    ? contextCheck.failures[0]
    : undefined;
}

function isFallbackEligibleFailure(failure) {
  return failure?.degradable === true
    && FALLBACK_ELIGIBLE_REASON_CODES.includes(failure.reasonCode);
}

function baseDecision(routeResolution, contextCheck, fields = {}) {
  return {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    plannerVersion: SITE_CAPABILITY_PLANNER_VERSION,
    decisionType: 'PlannerFallbackDecision',
    graphVersion: routeResolution.graphVersion,
    siteId: routeResolution.siteId,
    siteKey: routeResolution.siteKey,
    normalizedIntent: routeResolution.normalizedIntent,
    capabilityId: routeResolution.capabilityId,
    routeId: routeResolution.selectedRoute.routeId,
    selectedRoute: routeResolution.selectedRoute,
    primaryRoute: routeResolution.selectedRoute,
    fallbackCandidates: routeResolution.fallbacks ?? [],
    routeResolution,
    contextCheck,
    contextCheckStatus: contextCheck.checkStatus,
    fallbackRequired: contextCheck.checkStatus !== 'satisfied',
    fallbackSelected: false,
    degradationApplied: false,
    redactionRequired: true,
    descriptorOnly: true,
    executionAllowed: false,
    layerHandoffAllowed: false,
    layerDispatchAllowed: false,
    siteAdapterInvocationAllowed: false,
    downloaderInvocationAllowed: false,
    sessionMaterializationAllowed: false,
    runtimeMaterializationAllowed: false,
    artifactWriteAllowed: false,
    artifactServiceInvocationAllowed: false,
    lifecycleDispatchAllowed: false,
    externalTelemetryAllowed: false,
    graphMutationAllowed: false,
    logsWriteAllowed: false,
    ...fields,
  };
}

export function assertPlannerFallbackDecisionCompatible(decision) {
  assertPlainObject(decision, 'PlannerFallbackDecision');
  if (decision.schemaVersion !== SITE_CAPABILITY_PLANNER_SCHEMA_VERSION) {
    fail('PlannerFallbackDecision schemaVersion is not compatible', 'planner.version_incompatible');
  }
  if (decision.decisionType !== 'PlannerFallbackDecision') {
    fail('PlannerFallbackDecision decisionType is not compatible');
  }
  if (!FALLBACK_DECISION_STATUSES.includes(decision.decisionStatus)) {
    fail('PlannerFallbackDecision decisionStatus is unsupported');
  }
  assertNonEmptyString(decision.graphVersion, 'PlannerFallbackDecision graphVersion', 'planner.version_incompatible');
  if (decision.plannerVersion !== SITE_CAPABILITY_PLANNER_VERSION) {
    fail('PlannerFallbackDecision plannerVersion is not compatible', 'planner.version_incompatible');
  }
  assertNonEmptyString(decision.siteId, 'PlannerFallbackDecision siteId');
  assertNonEmptyString(decision.siteKey, 'PlannerFallbackDecision siteKey');
  assertNonEmptyString(decision.normalizedIntent, 'PlannerFallbackDecision normalizedIntent');
  assertNonEmptyString(decision.capabilityId, 'PlannerFallbackDecision capabilityId');
  assertNonEmptyString(decision.routeId, 'PlannerFallbackDecision routeId');
  assertPlannerRouteResolutionCompatible(decision.routeResolution);
  assertPlannerContextCheckCompatible(decision.contextCheck);
  assertRouteAndContextMatch(decision);
  assertGraphRouteDescriptor(decision.selectedRoute, decision.graphVersion, 'PlannerFallbackDecision selectedRoute');
  assertGraphRouteDescriptor(decision.primaryRoute, decision.graphVersion, 'PlannerFallbackDecision primaryRoute');
  if (!Array.isArray(decision.fallbackCandidates)) {
    fail('PlannerFallbackDecision fallbackCandidates must be an array');
  }
  for (const candidate of decision.fallbackCandidates) {
    assertGraphRouteDescriptor(candidate, decision.graphVersion, 'PlannerFallbackDecision fallbackCandidate');
  }
  if (decision.fallbackSelected === true) {
    assertGraphRouteDescriptor(decision.selectedFallbackRoute, decision.graphVersion, 'PlannerFallbackDecision selectedFallbackRoute');
    if (!decision.fallbackCandidates.some((candidate) => candidate.routeId === decision.selectedFallbackRoute.routeId)) {
      fail('PlannerFallbackDecision selected fallback must come from routeResolution fallbacks');
    }
  } else if (decision.selectedFallbackRoute !== undefined) {
    fail('PlannerFallbackDecision selectedFallbackRoute requires fallbackSelected true');
  }
  if (decision.decisionStatus === 'not_required') {
    if (
      decision.fallbackRequired !== false
      || decision.fallbackSelected !== false
      || decision.degradationApplied !== false
      || decision.reasonCode !== undefined
      || decision.blockedReasonCode !== undefined
    ) {
      fail('PlannerFallbackDecision not_required status must not carry fallback or failure state');
    }
  }
  if (decision.decisionStatus === 'fallback_selected') {
    if (
      decision.fallbackRequired !== true
      || decision.fallbackSelected !== true
      || decision.degradationApplied !== true
    ) {
      fail('PlannerFallbackDecision fallback_selected status requires selectedFallbackRoute');
    }
    if (!isPlannerReasonCode(decision.reasonCode)) {
      fail('PlannerFallbackDecision fallback_selected status requires cataloged reasonCode');
    }
    if (!isPlannerReasonCode(decision.blockedReasonCode)) {
      fail('PlannerFallbackDecision fallback_selected status requires cataloged blockedReasonCode');
    }
  }
  if (decision.decisionStatus === 'fallback_not_found') {
    if (
      decision.fallbackRequired !== true
      || decision.fallbackSelected !== false
      || decision.degradationApplied !== false
      || decision.reasonCode !== 'planner.fallback_not_found'
      || !isPlannerReasonCode(decision.blockedReasonCode)
    ) {
      fail('PlannerFallbackDecision fallback_not_found status must preserve blocked reason without selected fallback');
    }
  }
  if (decision.decisionStatus === 'not_degradable') {
    if (
      decision.fallbackRequired !== true
      || decision.fallbackSelected !== false
      || decision.degradationApplied !== false
      || !isPlannerReasonCode(decision.reasonCode)
      || !isPlannerReasonCode(decision.blockedReasonCode)
    ) {
      fail('PlannerFallbackDecision not_degradable status must preserve blocked reason without selected fallback');
    }
  }
  if (
    decision.redactionRequired !== true
    || decision.descriptorOnly !== true
    || decision.executionAllowed !== false
    || decision.layerHandoffAllowed !== false
    || decision.layerDispatchAllowed !== false
    || decision.siteAdapterInvocationAllowed !== false
    || decision.downloaderInvocationAllowed !== false
    || decision.sessionMaterializationAllowed !== false
    || decision.runtimeMaterializationAllowed !== false
    || decision.artifactWriteAllowed !== false
    || decision.artifactServiceInvocationAllowed !== false
    || decision.lifecycleDispatchAllowed !== false
    || decision.externalTelemetryAllowed !== false
    || decision.graphMutationAllowed !== false
    || decision.logsWriteAllowed !== false
  ) {
    fail('PlannerFallbackDecision must be descriptor-only with runtime outputs disabled');
  }
  assertNoPayloadFields(decision);
  assertNoPlannerSensitiveMaterial(decision);
  return true;
}

export function selectPlannerFallbackRoute({
  routeResolution,
  contextCheck,
} = {}) {
  assertPlannerRouteResolutionCompatible(routeResolution);
  assertPlannerContextCheckCompatible(contextCheck);
  const failure = firstFailure(contextCheck);

  if (contextCheck.checkStatus === 'satisfied' || !failure) {
    const decision = baseDecision(routeResolution, contextCheck, {
      decisionStatus: 'not_required',
      reasonCode: undefined,
      blockedReasonCode: undefined,
      degradationAllowed: false,
      fallbackReason: 'context_satisfied',
    });
    assertPlannerFallbackDecisionCompatible(decision);
    return decision;
  }

  if (!isFallbackEligibleFailure(failure)) {
    const decision = baseDecision(routeResolution, contextCheck, {
      decisionStatus: 'not_degradable',
      reasonCode: failure.reasonCode,
      blockedReasonCode: failure.reasonCode,
      sourceReasonCode: failure.sourceReasonCode,
      degradationAllowed: false,
      fallbackRequired: true,
      fallbackReason: failure.degradable === true
        ? 'context_failure_not_fallback_eligible'
        : 'context_failure_not_degradable',
    });
    assertPlannerFallbackDecisionCompatible(decision);
    return decision;
  }

  const selectedFallback = routeResolution.fallbacks?.[0];
  if (!selectedFallback) {
    const decision = baseDecision(routeResolution, contextCheck, {
      decisionStatus: 'fallback_not_found',
      reasonCode: 'planner.fallback_not_found',
      blockedReasonCode: failure.reasonCode,
      sourceReasonCode: failure.sourceReasonCode,
      degradationAllowed: true,
      fallbackRequired: true,
      fallbackReason: 'graph_fallback_missing',
    });
    assertPlannerFallbackDecisionCompatible(decision);
    return decision;
  }

  const decision = baseDecision(routeResolution, contextCheck, {
    decisionStatus: 'fallback_selected',
    reasonCode: failure.reasonCode,
    blockedReasonCode: failure.reasonCode,
    sourceReasonCode: failure.sourceReasonCode,
    degradationAllowed: true,
    degradationApplied: true,
    fallbackRequired: true,
    fallbackSelected: true,
    selectedFallbackRoute: selectedFallback,
    fallbackReason: 'context_failure_degraded_to_graph_fallback',
  });
  assertPlannerFallbackDecisionCompatible(decision);
  return decision;
}
