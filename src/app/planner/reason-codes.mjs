// @ts-check

import {
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
} from './schema.mjs';

function definePlannerReasonCode(definition) {
  return Object.freeze({
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    retryable: false,
    cooldownRequired: false,
    manualInterventionRequired: false,
    degradable: false,
    artifactWriteAllowed: false,
    layerHandoffAllowed: false,
    sourceReasonCodes: [],
    ...definition,
  });
}

export const PLANNER_REASON_CODE_CATALOG = Object.freeze([
  definePlannerReasonCode({
    code: 'planner.request_invalid',
    retryable: false,
    sourceReasonCodes: ['planner.sensitive_material_forbidden'],
  }),
  definePlannerReasonCode({
    code: 'planner.sensitive_material_forbidden',
    retryable: false,
  }),
  definePlannerReasonCode({
    code: 'planner.intent_unresolved',
    retryable: false,
  }),
  definePlannerReasonCode({
    code: 'planner.site_unresolved',
    retryable: false,
  }),
  definePlannerReasonCode({
    code: 'planner.graph_missing',
    retryable: true,
    manualInterventionRequired: true,
  }),
  definePlannerReasonCode({
    code: 'planner.graph_not_validated',
    retryable: true,
    manualInterventionRequired: true,
    sourceReasonCodes: ['graph-validation-failed'],
  }),
  definePlannerReasonCode({
    code: 'planner.capability_not_found',
    retryable: false,
  }),
  definePlannerReasonCode({
    code: 'planner.route_not_found',
    retryable: false,
  }),
  definePlannerReasonCode({
    code: 'planner.route_context_unsatisfied',
    retryable: true,
    degradable: true,
    sourceReasonCodes: ['graph-planner-context-unsatisfied'],
  }),
  definePlannerReasonCode({
    code: 'planner.route_forbidden_by_risk',
    retryable: false,
    cooldownRequired: true,
    manualInterventionRequired: true,
    degradable: true,
    sourceReasonCodes: ['graph-route-forbidden-by-risk'],
  }),
  definePlannerReasonCode({
    code: 'planner.auth_required',
    retryable: true,
    manualInterventionRequired: true,
    sourceReasonCodes: ['graph-endpoint-missing-auth-requirement'],
  }),
  definePlannerReasonCode({
    code: 'planner.session_required',
    retryable: true,
    manualInterventionRequired: true,
    sourceReasonCodes: ['graph-endpoint-missing-session-requirement'],
  }),
  definePlannerReasonCode({
    code: 'planner.signer_required',
    retryable: true,
    manualInterventionRequired: true,
    sourceReasonCodes: ['graph-endpoint-missing-signer'],
  }),
  definePlannerReasonCode({
    code: 'planner.approval_required',
    retryable: false,
    manualInterventionRequired: true,
    sourceReasonCodes: ['graph-non-readonly-missing-approval'],
  }),
  definePlannerReasonCode({
    code: 'planner.version_incompatible',
    retryable: false,
    sourceReasonCodes: ['graph-version-incompatible'],
  }),
  definePlannerReasonCode({
    code: 'planner.schema_missing',
    retryable: true,
    manualInterventionRequired: true,
  }),
  definePlannerReasonCode({
    code: 'planner.artifact_redaction_required',
    retryable: false,
    sourceReasonCodes: ['graph-artifact-redaction-required'],
  }),
  definePlannerReasonCode({
    code: 'planner.artifact_redaction_failed',
    retryable: false,
  }),
  definePlannerReasonCode({
    code: 'planner.fallback_not_found',
    retryable: false,
  }),
  definePlannerReasonCode({
    code: 'planner.plan_generation_failed',
    retryable: true,
  }),
  definePlannerReasonCode({
    code: 'planner.layer_handoff_unavailable',
    retryable: true,
    manualInterventionRequired: true,
  }),
]);

const CATALOG_BY_CODE = new Map(PLANNER_REASON_CODE_CATALOG.map((entry) => [entry.code, entry]));
const SOURCE_TO_PLANNER_REASON = new Map(
  PLANNER_REASON_CODE_CATALOG.flatMap((entry) => (
    entry.sourceReasonCodes.map((sourceReasonCode) => [sourceReasonCode, entry.code])
  )),
);

function fail(message) {
  const error = new Error(message);
  error.code = 'planner.reason_code_invalid';
  throw error;
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

export function listPlannerReasonCodes() {
  return PLANNER_REASON_CODE_CATALOG.map((entry) => ({ ...entry }));
}

export function getPlannerReasonCode(code) {
  return CATALOG_BY_CODE.get(code);
}

export function isPlannerReasonCode(code) {
  return CATALOG_BY_CODE.has(code);
}

export function mapSourceReasonCodeToPlannerReasonCode(sourceReasonCode, {
  fallback = 'planner.plan_generation_failed',
} = {}) {
  if (isPlannerReasonCode(sourceReasonCode)) {
    return sourceReasonCode;
  }
  return SOURCE_TO_PLANNER_REASON.get(sourceReasonCode) ?? fallback;
}

export function assertPlannerReasonCodeCatalogCompatible(catalog = PLANNER_REASON_CODE_CATALOG) {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    fail('Planner reasonCode catalog must be a non-empty array');
  }
  const seen = new Set();
  for (const entry of catalog) {
    if (!isPlainObject(entry)) {
      fail('Planner reasonCode entry must be a plain object');
    }
    if (entry.schemaVersion !== SITE_CAPABILITY_PLANNER_SCHEMA_VERSION) {
      fail('Planner reasonCode schemaVersion is not compatible');
    }
    if (typeof entry.code !== 'string' || !entry.code.startsWith('planner.')) {
      fail('Planner reasonCode code must start with planner.');
    }
    if (seen.has(entry.code)) {
      fail('Planner reasonCode catalog contains duplicate codes');
    }
    seen.add(entry.code);
    for (const field of [
      'retryable',
      'cooldownRequired',
      'manualInterventionRequired',
      'degradable',
      'artifactWriteAllowed',
      'layerHandoffAllowed',
    ]) {
      if (typeof entry[field] !== 'boolean') {
        fail(`Planner reasonCode ${field} must be boolean`);
      }
    }
    if (!Array.isArray(entry.sourceReasonCodes)) {
      fail('Planner reasonCode sourceReasonCodes must be an array');
    }
    if (entry.artifactWriteAllowed !== false || entry.layerHandoffAllowed !== false) {
      fail('Planner reasonCode catalog entries must block artifact write and Layer handoff by default');
    }
  }
  return true;
}
