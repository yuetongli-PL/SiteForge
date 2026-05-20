// @ts-check

import {
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
} from './schema.mjs';
import {
  assertPlannerRouteResolutionCompatible,
} from './route-resolver.mjs';
import {
  assertNoPlannerSensitiveMaterial,
  assertPlanContextCompatible,
} from './validator.mjs';
import {
  isPlannerReasonCode,
} from './reason-codes.mjs';

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertPlainObject(value, name, code = 'planner.request_invalid') {
  if (!isPlainObject(value)) {
    fail(`${name} must be a plain object`, code);
  }
}

function isRequired(value) {
  return value === true
    || value === 'required'
    || value === 'required_for_non_readonly'
    || value === 'minimal-session-view-only';
}

function isSatisfied(state, keys = ['satisfied', 'available', 'ready', 'approved', 'allowed', 'compatible', 'validated']) {
  if (state === true || state === 'satisfied' || state === 'available' || state === 'ready') {
    return true;
  }
  if (!isPlainObject(state)) {
    return false;
  }
  return keys.some((key) => state[key] === true || state[key] === 'satisfied' || state[key] === 'available');
}

function addFailure(failures, {
  reasonCode,
  requirement,
  sourceReasonCode,
  retryable = false,
  cooldownRequired = false,
  manualInterventionRequired = false,
  degradable = false,
  artifactWriteAllowed = false,
  layerHandoffAllowed = false,
} = {}) {
  failures.push({
    reasonCode,
    requirement,
    sourceReasonCode,
    retryable,
    cooldownRequired,
    manualInterventionRequired,
    degradable,
    artifactWriteAllowed,
    layerHandoffAllowed,
  });
}

function checkCompatibility(failures, context) {
  if (context.graphCompatibility && !isSatisfied(context.graphCompatibility, ['validated', 'compatible'])) {
    addFailure(failures, {
      reasonCode: 'planner.graph_not_validated',
      requirement: 'graph',
      sourceReasonCode: context.graphCompatibility.reasonCode,
    });
  }
  if (context.layerCompatibility && !isSatisfied(context.layerCompatibility, ['compatible'])) {
    addFailure(failures, {
      reasonCode: 'planner.version_incompatible',
      requirement: 'layerCompatibility',
      sourceReasonCode: context.layerCompatibility.reasonCode,
    });
  }
  if (context.adapterCapabilityState && !isSatisfied(context.adapterCapabilityState, ['available', 'compatible'])) {
    addFailure(failures, {
      reasonCode: 'planner.route_context_unsatisfied',
      requirement: 'adapterCapability',
      sourceReasonCode: context.adapterCapabilityState.reasonCode,
    });
  }
  if (context.schemaAvailability && !isSatisfied(context.schemaAvailability, ['available'])) {
    addFailure(failures, {
      reasonCode: 'planner.schema_missing',
      requirement: 'schema',
      sourceReasonCode: context.schemaAvailability.reasonCode,
    });
  }
  if (context.capabilityState && context.capabilityState.agentExposed === false) {
    addFailure(failures, {
      reasonCode: 'planner.route_context_unsatisfied',
      requirement: 'agentExposed',
      sourceReasonCode: context.capabilityState.reasonCode,
    });
  }
}

function checkRequirements(failures, {
  context,
  requirements,
  capability,
  riskPolicy,
}) {
  if (isRequired(requirements.auth) && !isSatisfied(context.authState)) {
    addFailure(failures, {
      reasonCode: 'planner.auth_required',
      requirement: 'auth',
      manualInterventionRequired: true,
    });
  }
  if (isRequired(requirements.session) && !isSatisfied(context.sessionState)) {
    addFailure(failures, {
      reasonCode: 'planner.session_required',
      requirement: 'session',
      manualInterventionRequired: true,
    });
  }
  if (isRequired(requirements.signer) && !isSatisfied(context.signerState)) {
    addFailure(failures, {
      reasonCode: 'planner.signer_required',
      requirement: 'signer',
      manualInterventionRequired: true,
    });
  }

  const nonReadOnly = capability.mode !== undefined && capability.mode !== 'readOnly';
  if (
    (nonReadOnly || isRequired(requirements.approval))
    && !isSatisfied(context.approvalState, ['approved'])
  ) {
    addFailure(failures, {
      reasonCode: 'planner.approval_required',
      requirement: 'approval',
      manualInterventionRequired: true,
    });
  }

  const riskAllowed = riskPolicy.allowed !== false
    && riskPolicy.blocked !== true
    && context.riskState?.allowed !== false
    && context.riskState?.blocked !== true;
  if (!riskAllowed) {
    addFailure(failures, {
      reasonCode: 'planner.route_forbidden_by_risk',
      requirement: 'risk',
      sourceReasonCode: riskPolicy.reasonCode ?? context.riskState?.reasonCode,
      cooldownRequired: Boolean(riskPolicy.cooldownRequired ?? context.riskState?.cooldownRequired),
      manualInterventionRequired: Boolean(riskPolicy.manualRecoveryRequired ?? context.riskState?.manualRecoveryRequired),
      degradable: Boolean(riskPolicy.degradable ?? context.riskState?.degradable),
    });
  }
}

export function assertPlannerContextCheckCompatible(check) {
  assertPlainObject(check, 'PlannerContextCheck', 'planner.route_context_unsatisfied');
  if (check.schemaVersion !== SITE_CAPABILITY_PLANNER_SCHEMA_VERSION) {
    fail('PlannerContextCheck schemaVersion is not compatible', 'planner.version_incompatible');
  }
  if (!['satisfied', 'blocked'].includes(check.checkStatus)) {
    fail('PlannerContextCheck checkStatus is unsupported', 'planner.route_context_unsatisfied');
  }
  if (!Array.isArray(check.failures)) {
    fail('PlannerContextCheck failures must be an array', 'planner.route_context_unsatisfied');
  }
  for (const failure of check.failures) {
    assertPlainObject(failure, 'PlannerContextCheck failure', 'planner.route_context_unsatisfied');
    if (!isPlannerReasonCode(failure.reasonCode)) {
      fail('PlannerContextCheck failure reasonCode must be cataloged', 'planner.route_context_unsatisfied');
    }
    if (failure.artifactWriteAllowed !== false || failure.layerHandoffAllowed !== false) {
      fail('PlannerContextCheck failures must block artifact write and Layer handoff', 'planner.route_context_unsatisfied');
    }
  }
  if (
    check.descriptorOnly !== true
    || check.redactionRequired !== true
    || check.executionAllowed !== false
    || check.layerHandoffAllowed !== false
    || check.runtimeMaterializationAllowed !== false
    || check.signerRuntimeAllowed !== false
  ) {
    fail('PlannerContextCheck must be descriptor-only with runtime materialization disabled', 'planner.route_context_unsatisfied');
  }
  assertNoPlannerSensitiveMaterial(check);
  return true;
}

export function checkPlannerContext({
  routeResolution,
  planContext,
  requirements = {},
  capability = {},
  riskPolicy = {},
} = {}) {
  assertPlannerRouteResolutionCompatible(routeResolution);
  assertPlanContextCompatible(planContext);
  assertNoPlannerSensitiveMaterial(requirements);
  assertNoPlannerSensitiveMaterial(capability);
  assertNoPlannerSensitiveMaterial(riskPolicy);

  const failures = [];
  checkCompatibility(failures, planContext);
  checkRequirements(failures, {
    context: planContext,
    requirements,
    capability,
    riskPolicy,
  });

  const check = {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    graphVersion: routeResolution.graphVersion,
    siteId: routeResolution.siteId,
    capabilityId: routeResolution.capabilityId,
    routeId: routeResolution.selectedRoute.routeId,
    checkStatus: failures.length === 0 ? 'satisfied' : 'blocked',
    requirements: {
      auth: requirements.auth ?? 'not_required',
      session: requirements.session ?? 'not_required',
      signer: requirements.signer ?? 'not_required',
      approval: requirements.approval ?? 'not_required',
    },
    riskSummary: {
      allowed: failures.every((failure) => failure.reasonCode !== 'planner.route_forbidden_by_risk'),
      sourceReasonCode: riskPolicy.reasonCode ?? planContext.riskState?.reasonCode,
    },
    failures,
    descriptorOnly: true,
    redactionRequired: true,
    executionAllowed: false,
    layerHandoffAllowed: false,
    runtimeMaterializationAllowed: false,
    signerRuntimeAllowed: false,
  };
  assertPlannerContextCheckCompatible(check);
  return check;
}
