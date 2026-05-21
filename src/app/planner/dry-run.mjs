// @ts-check

import {
  SECURITY_GUARD_SCHEMA_VERSION,
} from '../../domain/sessions/security-guard.mjs';
import {
  PLANNER_PLAN_STATUSES,
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
  SITE_CAPABILITY_PLANNER_VERSION,
} from './schema.mjs';
import {
  assertCapabilityPlanCompatible,
  assertNoPlannerSensitiveMaterial,
  assertPlanContextCompatible,
  assertPlanRequestCompatible,
} from './validator.mjs';
import {
  loadValidatedPlannerGraphSource,
  assertPlannerGraphSourceCompatible,
} from './loader.mjs';
import {
  resolvePlannerRoute,
  assertPlannerRouteResolutionCompatible,
} from './route-resolver.mjs';
import {
  checkPlannerContext,
  assertPlannerContextCheckCompatible,
} from './context-checker.mjs';
import {
  selectPlannerFallbackRoute,
  assertPlannerFallbackDecisionCompatible,
} from './fallback-strategy.mjs';
import {
  createPlannerLifecycleEvent,
  assertPlannerLifecycleEventCompatible,
} from './observability.mjs';

const FORBIDDEN_DRY_RUN_RESULT_FIELDS = Object.freeze([
  'request',
  'context',
  'planContext',
  'graph',
  'rawGraph',
  'validationReport',
  'payload',
  'graphPayload',
  'contextPayload',
  'runtimePayload',
  'eventPayload',
  'json',
  'artifactJson',
  'artifactValue',
  'auditValue',
  'artifact',
  'manifest',
  'auditJson',
  'standardTaskList',
  'downloadPolicy',
  'sessionView',
  'siteAdapterDecision',
  'siteAdapterRuntime',
  'downloaderPayload',
  'downloaderTask',
  'handler',
  'executor',
  'browserContext',
  'resolvedResources',
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function fail(message, code = 'planner.plan_generation_failed') {
  /** @type {Error & Record<string, any>} */
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) {
    fail(`${name} must be a plain object`, 'planner.schema_missing');
  }
}

function assertNonEmptyString(value, name, code = 'planner.schema_missing') {
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
    if (FORBIDDEN_DRY_RUN_RESULT_FIELDS.includes(key)) {
      const pathName = [...pathParts, key].join('.');
      fail(`PlannerDryRunResult must not expose runtime payload field ${pathName}`, 'planner.sensitive_material_forbidden');
    }
    assertNoPayloadFields(child, [...pathParts, key]);
  }
  return true;
}

function graphNodes(graph, type) {
  return Array.isArray(graph?.nodes)
    ? graph.nodes.filter((node) => node?.type === type)
    : [];
}

function findNodeById(graph, id) {
  return Array.isArray(graph?.nodes)
    ? graph.nodes.find((node) => node?.id === id)
    : undefined;
}

function findRiskPolicy(graph, capability, route) {
  const riskPolicyRef = capability?.riskPolicyRef ?? route?.riskPolicyRef;
  return riskPolicyRef ? findNodeById(graph, riskPolicyRef) : undefined;
}

function boolRequirement(value) {
  return value === true || value === 'required';
}

/** @param {Record<string, any>} options */
function deriveRequirementSummary({ capability, route, riskPolicy } = {}) {
  const nonReadOnly = capability?.mode !== undefined && capability.mode !== 'readOnly';
  const approvalRequired = boolRequirement(capability?.requiresApproval)
    || boolRequirement(route?.requiresApproval)
    || boolRequirement(riskPolicy?.requiresApproval)
    || nonReadOnly;
  return {
    auth: boolRequirement(capability?.requiresAuth) || boolRequirement(route?.requiresAuth)
      ? 'required'
      : 'optional',
    session: boolRequirement(capability?.requiresSession) || boolRequirement(route?.requiresSession)
      ? 'minimal-session-view-only'
      : 'not_required',
    signer: boolRequirement(capability?.requiresSigner) || boolRequirement(route?.requiresSigner)
      ? 'required'
      : 'not_required',
    approval: approvalRequired ? 'required_for_non_readonly' : 'not_required',
    approvalRequired,
  };
}

function deriveRiskPolicySummary(riskPolicy) {
  if (!riskPolicy) {
    return {
      allowed: true,
    };
  }
  const blocked = riskPolicy.blocked === true || riskPolicy.state === 'blocked';
  return {
    allowed: !blocked,
    blocked,
    reasonCode: riskPolicy.reasonCode,
    sourceReasonCode: riskPolicy.sourceReasonCode,
    cooldownRequired: riskPolicy.cooldownRequired === true,
    manualInterventionRequired: riskPolicy.manualRecoveryRequired === true,
    degradable: riskPolicy.degradable !== false,
  };
}

function createExpectedArtifacts() {
  return [
    {
      type: 'CAPABILITY_PLAN',
      redactionRequired: true,
    },
    {
      type: 'PLANNER_DRY_RUN_RESULT',
      redactionRequired: true,
    },
    {
      type: 'PLANNER_LIFECYCLE_EVENT',
      redactionRequired: true,
    },
  ];
}

function firstFailure(contextCheck) {
  return Array.isArray(contextCheck?.failures) && contextCheck.failures.length
    ? contextCheck.failures[0]
    : undefined;
}

/** @param {Record<string, any>} options */
function createCapabilityPlan({
  request,
  normalizedIntent,
  graphSource,
  routeResolution,
  contextCheck,
  fallbackDecision,
  requirements,
  riskPolicy,
  capability,
} = {}) {
  const failure = firstFailure(contextCheck);
  const planStatus = contextCheck.checkStatus === 'satisfied'
    ? 'ready'
    : fallbackDecision?.decisionStatus === 'fallback_selected'
      ? 'degraded'
      : 'blocked';
  const selectedRoute = fallbackDecision?.selectedFallbackRoute ?? routeResolution.selectedRoute;
  const capabilityPlan = {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    plannerVersion: SITE_CAPABILITY_PLANNER_VERSION,
    graphVersion: graphSource.graphVersion,
    layerCompatibilityVersion: request.layerCompatibilityVersion
      ?? graphSource.layerCompatibilityVersion
      ?? '1.0.0',
    planStatus,
    siteId: routeResolution.siteId,
    normalizedIntent,
    capabilityId: routeResolution.capabilityId,
    capabilityMode: capability?.mode ?? 'readOnly',
    selectedRoute,
    fallbacks: routeResolution.fallbacks,
    fallbackDecision,
    requirements,
    riskSummary: {
      allowed: (riskPolicy.allowed !== false && contextCheck.checkStatus === 'satisfied')
        || fallbackDecision?.decisionStatus === 'fallback_selected',
      riskGates: riskPolicy.reasonCode ? [riskPolicy.reasonCode] : [],
    },
    decisions: [
      {
        decision: planStatus === 'ready'
          ? 'selected'
          : planStatus === 'degraded'
            ? 'fallback_selected'
            : 'blocked',
        reasonCode: fallbackDecision?.reasonCode ?? failure?.reasonCode,
        sourceReasonCode: failure?.sourceReasonCode,
        fallbackRouteId: fallbackDecision?.selectedFallbackRoute?.routeId,
      },
    ],
    failures: failure ? contextCheck.failures : [],
    steps: [
      {
        stepId: 'step:planner-dry-run-only',
        type: planStatus === 'degraded'
          ? 'fallback_capability_plan_descriptor'
          : 'capability_plan_descriptor',
        executable: false,
      },
    ],
    expectedArtifacts: createExpectedArtifacts(),
    redactionRequired: true,
  };
  assertCapabilityPlanCompatible(capabilityPlan);
  return capabilityPlan;
}

/** @param {Record<string, any>} options */
function createLifecycleEvent({
  request,
  normalizedIntent,
  graphSource,
  routeResolution,
  contextCheck,
  capabilityPlan,
} = {}) {
  const failure = firstFailure(contextCheck);
  const status = capabilityPlan.planStatus === 'ready' ? 'ready' : 'blocked';
  return createPlannerLifecycleEvent({
    eventType: status === 'ready' ? 'planner.plan.generated' : 'planner.plan.blocked',
    traceId: request.traceId ?? `trace:${request.taskId}`,
    correlationId: request.correlationId ?? `correlation:${request.taskId}`,
    taskId: request.taskId,
    siteId: routeResolution.siteId,
    siteKey: routeResolution.siteKey,
    normalizedIntent,
    capabilityId: routeResolution.capabilityId,
    routeId: routeResolution.selectedRoute.routeId,
    graphVersion: graphSource.graphVersion,
    layerCompatibilityVersion: capabilityPlan.layerCompatibilityVersion,
    adapterId: request.adapterId ?? 'planner-dry-run',
    plannerDecision: {
      status,
      reasonCode: failure?.reasonCode,
    },
    reasonCode: failure?.reasonCode,
    riskState: contextCheck.riskState,
    validationResult: {
      status: contextCheck.checkStatus,
      reasonCode: failure?.reasonCode,
    },
    redactionEvent: {
      schemaVersion: SECURITY_GUARD_SCHEMA_VERSION,
      redactionRequired: true,
      descriptorOnly: true,
      redactionCount: 0,
      findingCount: 0,
    },
  });
}

export function normalizePlannerIntent(request) {
  assertPlanRequestCompatible(request);
  const normalized = request.normalizedIntent
    ?? request.intentInput?.normalizedIntent
    ?? request.intentInput?.standardIntent;
  assertNonEmptyString(normalized, 'PlanRequest normalizedIntent', 'planner.intent_unresolved');
  return normalized;
}

export function assertPlannerDryRunResultCompatible(result) {
  assertPlainObject(result, 'PlannerDryRunResult');
  if (result.schemaVersion !== SITE_CAPABILITY_PLANNER_SCHEMA_VERSION) {
    fail('PlannerDryRunResult schemaVersion is not compatible', 'planner.version_incompatible');
  }
  if (result.plannerVersion !== SITE_CAPABILITY_PLANNER_VERSION) {
    fail('PlannerDryRunResult plannerVersion is not compatible', 'planner.version_incompatible');
  }
  if (result.resultType !== 'PlannerDryRunResult' || result.mode !== 'dry_run') {
    fail('PlannerDryRunResult must be a dry_run descriptor', 'planner.request_invalid');
  }
  if (!PLANNER_PLAN_STATUSES.includes(result.planStatus)) {
    fail('PlannerDryRunResult planStatus is unsupported', 'planner.request_invalid');
  }
  assertNonEmptyString(result.normalizedIntent, 'PlannerDryRunResult normalizedIntent', 'planner.intent_unresolved');
  assertPlannerGraphSourceCompatible(result.graphSource);
  assertPlannerRouteResolutionCompatible(result.routeResolution);
  assertPlannerContextCheckCompatible(result.contextCheck);
  assertPlannerFallbackDecisionCompatible(result.fallbackDecision);
  assertCapabilityPlanCompatible(result.capabilityPlan);
  assertPlannerLifecycleEventCompatible(result.lifecycleEvent);
  if (
    result.redactionRequired !== true
    || result.descriptorOnly !== true
    || result.executionAllowed !== false
    || result.layerHandoffAllowed !== false
    || result.siteAdapterInvocationAllowed !== false
    || result.downloaderInvocationAllowed !== false
    || result.sessionMaterializationAllowed !== false
    || result.runtimeMaterializationAllowed !== false
    || result.artifactServiceInvocationAllowed !== false
    || result.lifecycleDispatchAllowed !== false
    || result.externalTelemetryAllowed !== false
    || result.graphMutationAllowed !== false
    || result.logsWriteAllowed !== false
  ) {
    fail('PlannerDryRunResult must disable runtime outputs', 'planner.layer_handoff_unavailable');
  }
  assertNoPayloadFields(result);
  assertNoPlannerSensitiveMaterial(result);
  return true;
}

/** @param {Record<string, any>} options */
export function createDryRunCapabilityPlan({
  request,
  context,
  graph,
  validationReport,
} = {}) {
  assertPlanRequestCompatible(request);
  if (request.mode !== undefined && request.mode !== 'dry_run') {
    fail('Planner dry-run entrypoint only supports dry_run mode', 'planner.layer_handoff_unavailable');
  }
  assertPlanContextCompatible(context);
  const normalizedIntent = normalizePlannerIntent(request);
  const graphSource = loadValidatedPlannerGraphSource({ graph, validationReport });
  const routeResolution = resolvePlannerRoute({
    graph,
    graphSource,
    siteId: request.siteId,
    siteKey: request.siteKey ?? request.site,
    normalizedIntent,
    capabilityId: request.capabilityId ?? request.requestedCapabilityId,
  });

  const capability = findNodeById(graph, routeResolution.capabilityId);
  const route = findNodeById(graph, routeResolution.selectedRoute.routeId);
  const riskPolicyNode = findRiskPolicy(graph, capability, route);
  const requirements = deriveRequirementSummary({ capability, route, riskPolicy: riskPolicyNode });
  const riskPolicy = deriveRiskPolicySummary(riskPolicyNode);
  const contextCheck = checkPlannerContext({
    routeResolution,
    planContext: context,
    requirements,
    capability: {
      capabilityId: routeResolution.capabilityId,
      mode: capability?.mode ?? 'readOnly',
    },
    riskPolicy,
  });
  const fallbackDecision = selectPlannerFallbackRoute({
    routeResolution,
    contextCheck,
  });
  const capabilityPlan = createCapabilityPlan({
    request,
    normalizedIntent,
    graphSource,
    routeResolution,
    contextCheck,
    fallbackDecision,
    requirements,
    riskPolicy,
    capability,
  });
  const lifecycleEvent = createLifecycleEvent({
    request,
    normalizedIntent,
    graphSource,
    routeResolution,
    contextCheck,
    capabilityPlan,
  });
  const result = {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    plannerVersion: SITE_CAPABILITY_PLANNER_VERSION,
    resultType: 'PlannerDryRunResult',
    mode: 'dry_run',
    planStatus: capabilityPlan.planStatus,
    normalizedIntent,
    graphSource,
    routeResolution,
    contextCheck,
    fallbackDecision,
    capabilityPlan,
    lifecycleEvent,
    redactionRequired: true,
    descriptorOnly: true,
    executionAllowed: false,
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
  assertPlannerDryRunResultCompatible(result);
  return result;
}
