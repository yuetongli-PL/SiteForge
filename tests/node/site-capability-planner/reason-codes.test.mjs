import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertPlannerReasonCodeCatalogCompatible,
  checkPlannerContext,
  getPlannerReasonCode,
  isPlannerReasonCode,
  listPlannerReasonCodes,
  mapSourceReasonCodeToPlannerReasonCode,
} from '../../../src/app/planner/index.mjs';
import {
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
} from '../../../src/app/planner/schema.mjs';

const REQUIRED_PLANNER_REASON_CODES = [
  'planner.request_invalid',
  'planner.intent_unresolved',
  'planner.site_unresolved',
  'planner.graph_missing',
  'planner.graph_not_validated',
  'planner.capability_not_found',
  'planner.route_not_found',
  'planner.route_context_unsatisfied',
  'planner.route_forbidden_by_risk',
  'planner.auth_required',
  'planner.session_required',
  'planner.signer_required',
  'planner.approval_required',
  'planner.version_incompatible',
  'planner.schema_missing',
  'planner.artifact_redaction_required',
  'planner.artifact_redaction_failed',
  'planner.fallback_not_found',
  'planner.plan_generation_failed',
  'planner.layer_handoff_unavailable',
];

function createRouteResolution() {
  return {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    graphVersion: 'synthetic-graph-v1',
    siteId: 'site:synthetic.example',
    siteKey: 'synthetic.example',
    normalizedIntent: 'open-page',
    capabilityId: 'capability:synthetic.example:open-public-page',
    selectedRoute: {
      routeId: 'route:synthetic.example:public-page',
      source: 'site-capability-graph',
      graphVersion: 'synthetic-graph-v1',
    },
    routeCandidates: [
      {
        routeId: 'route:synthetic.example:public-page',
        source: 'site-capability-graph',
        graphVersion: 'synthetic-graph-v1',
      },
    ],
    fallbacks: [],
    descriptorOnly: true,
    redactionRequired: true,
    executionAllowed: false,
    layerHandoffAllowed: false,
    siteAdapterInvocationAllowed: false,
    downloaderInvocationAllowed: false,
  };
}

function createPlanContext(overrides = {}) {
  return {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    graphCompatibility: { validated: true },
    layerCompatibility: { compatible: true },
    adapterCapabilityState: { available: true },
    schemaAvailability: { available: true },
    capabilityState: { agentExposed: true },
    authState: { satisfied: true },
    sessionState: { satisfied: true },
    signerState: { satisfied: true },
    approvalState: { approved: true },
    riskState: { allowed: true },
    ...overrides,
  };
}

test('Planner reasonCode catalog covers required Planner failure modes', () => {
  assert.equal(assertPlannerReasonCodeCatalogCompatible(), true);
  const byCode = new Map(listPlannerReasonCodes().map((entry) => [entry.code, entry]));

  for (const code of REQUIRED_PLANNER_REASON_CODES) {
    const entry = byCode.get(code);
    assert.notEqual(entry, undefined, `${code} should be cataloged`);
    assert.equal(entry.schemaVersion, SITE_CAPABILITY_PLANNER_SCHEMA_VERSION);
    assert.equal(entry.artifactWriteAllowed, false);
    assert.equal(entry.layerHandoffAllowed, false);
  }
});

test('Planner reasonCode catalog exposes retry cooldown manual and degradation semantics', () => {
  const risk = getPlannerReasonCode('planner.route_forbidden_by_risk');
  assert.equal(risk.retryable, false);
  assert.equal(risk.cooldownRequired, true);
  assert.equal(risk.manualInterventionRequired, true);
  assert.equal(risk.degradable, true);

  const auth = getPlannerReasonCode('planner.auth_required');
  assert.equal(auth.retryable, true);
  assert.equal(auth.manualInterventionRequired, true);

  const version = getPlannerReasonCode('planner.version_incompatible');
  assert.equal(version.retryable, false);
  assert.equal(version.artifactWriteAllowed, false);
});

test('Planner reasonCode mapping preserves Graph source reason boundaries', () => {
  assert.equal(
    mapSourceReasonCodeToPlannerReasonCode('graph-route-forbidden-by-risk'),
    'planner.route_forbidden_by_risk',
  );
  assert.equal(
    mapSourceReasonCodeToPlannerReasonCode('graph-endpoint-missing-auth-requirement'),
    'planner.auth_required',
  );
  assert.equal(
    mapSourceReasonCodeToPlannerReasonCode('graph-endpoint-missing-session-requirement'),
    'planner.session_required',
  );
  assert.equal(
    mapSourceReasonCodeToPlannerReasonCode('graph-endpoint-missing-signer'),
    'planner.signer_required',
  );
  assert.equal(
    mapSourceReasonCodeToPlannerReasonCode('graph-artifact-redaction-required'),
    'planner.artifact_redaction_required',
  );
  assert.equal(
    mapSourceReasonCodeToPlannerReasonCode('unknown-source-reason'),
    'planner.plan_generation_failed',
  );
});

test('Planner context checker emits only cataloged Planner reasonCodes', () => {
  const check = checkPlannerContext({
    routeResolution: createRouteResolution(),
    planContext: createPlanContext({
      authState: { satisfied: false },
      sessionState: { satisfied: false },
      signerState: { satisfied: false },
      approvalState: { approved: false },
      riskState: {
        allowed: false,
        reasonCode: 'graph-route-forbidden-by-risk',
      },
    }),
    requirements: {
      auth: 'required',
      session: 'minimal-session-view-only',
      signer: 'required',
      approval: 'required',
    },
    capability: {
      mode: 'write',
    },
    riskPolicy: {
      allowed: false,
      reasonCode: 'graph-route-forbidden-by-risk',
    },
  });

  assert.equal(check.checkStatus, 'blocked');
  for (const failure of check.failures) {
    assert.equal(isPlannerReasonCode(failure.reasonCode), true);
    assert.equal(getPlannerReasonCode(failure.reasonCode).artifactWriteAllowed, false);
    assert.equal(failure.layerHandoffAllowed, false);
  }
});

test('Planner reasonCode catalog rejects malformed entries', () => {
  const valid = listPlannerReasonCodes();

  assert.throws(
    () => assertPlannerReasonCodeCatalogCompatible([
      ...valid,
      {
        ...valid[0],
        code: valid[0].code,
      },
    ]),
    /duplicate/u,
  );
  assert.throws(
    () => assertPlannerReasonCodeCatalogCompatible([
      {
        ...valid[0],
        schemaVersion: '2.0.0',
      },
    ]),
    /schemaVersion is not compatible/u,
  );
  assert.throws(
    () => assertPlannerReasonCodeCatalogCompatible([
      {
        ...valid[0],
        artifactWriteAllowed: true,
      },
    ]),
    /block artifact write/u,
  );
});
