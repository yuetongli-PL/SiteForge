import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
  assertPlannerContextCheckCompatible,
  checkPlannerContext,
  loadValidatedPlannerGraphSource,
  resolvePlannerRoute,
} from '../../../src/app/planner/index.mjs';
import {
  validateSiteCapabilityGraph,
} from '../../../src/domain/capabilities/site-capability-graph.mjs';

const MINIMAL_GRAPH_URL = new URL('../fixtures/site-capability-graph/minimal-v1.json', import.meta.url);

async function readMinimalGraphFixture() {
  return JSON.parse(await readFile(MINIMAL_GRAPH_URL, 'utf8'));
}

async function createRouteResolution() {
  const graph = await readMinimalGraphFixture();
  const validationReport = validateSiteCapabilityGraph(graph);
  const graphSource = loadValidatedPlannerGraphSource({ graph, validationReport });
  return resolvePlannerRoute({
    graph,
    graphSource,
    siteKey: 'synthetic.example',
    normalizedIntent: 'open-page',
  });
}

function createPlanContext(overrides = /** @type {any} */ ({})) {
  return {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    graphCompatibility: {
      validated: true,
    },
    layerCompatibility: {
      compatible: true,
    },
    adapterCapabilityState: {
      available: true,
    },
    schemaAvailability: {
      available: true,
    },
    capabilityState: {
      agentExposed: true,
    },
    authState: {
      satisfied: true,
    },
    sessionState: {
      satisfied: true,
    },
    signerState: {
      satisfied: true,
    },
    approvalState: {
      approved: true,
    },
    riskState: {
      allowed: true,
    },
    ...overrides,
  };
}

const REQUIRED_REQUIREMENTS = Object.freeze({
  auth: 'required',
  session: 'minimal-session-view-only',
  signer: 'required',
  approval: 'required',
});

test('Planner context checker accepts satisfied descriptor-only requirements', async () => {
  const routeResolution = await createRouteResolution();

  const check = checkPlannerContext({
    routeResolution,
    planContext: createPlanContext(),
    requirements: REQUIRED_REQUIREMENTS,
    capability: {
      mode: 'write',
    },
    riskPolicy: {
      allowed: true,
    },
  });

  assert.equal(assertPlannerContextCheckCompatible(check), true);
  assert.equal(check.checkStatus, 'satisfied');
  assert.deepEqual(check.failures, []);
  assert.equal(check.descriptorOnly, true);
  assert.equal(check.redactionRequired, true);
  assert.equal(check.executionAllowed, false);
  assert.equal(check.layerHandoffAllowed, false);
  assert.equal(check.runtimeMaterializationAllowed, false);
  assert.equal(check.signerRuntimeAllowed, false);
});

test('Planner context checker maps auth session signer and approval failures', async () => {
  const routeResolution = await createRouteResolution();

  const check = checkPlannerContext({
    routeResolution,
    planContext: createPlanContext({
      authState: { satisfied: false },
      sessionState: { satisfied: false },
      signerState: { satisfied: false },
      approvalState: { approved: false },
    }),
    requirements: REQUIRED_REQUIREMENTS,
    capability: {
      mode: 'write',
    },
    riskPolicy: {
      allowed: true,
    },
  });

  assert.equal(check.checkStatus, 'blocked');
  assert.deepEqual(
    check.failures.map((failure) => failure.reasonCode),
    [
      'planner.auth_required',
      'planner.session_required',
      'planner.signer_required',
      'planner.approval_required',
    ],
  );
  assert.equal(check.failures.every((failure) => failure.layerHandoffAllowed === false), true);
});

test('Planner context checker maps risk policy blocks and preserves source reason', async () => {
  const routeResolution = await createRouteResolution();

  const check = checkPlannerContext({
    routeResolution,
    planContext: createPlanContext(),
    requirements: {},
    capability: {
      mode: 'readOnly',
    },
    riskPolicy: {
      allowed: false,
      reasonCode: 'graph-route-forbidden-by-risk',
      cooldownRequired: true,
      manualRecoveryRequired: true,
      degradable: true,
    },
  });

  assert.equal(check.checkStatus, 'blocked');
  assert.equal(check.failures.length, 1);
  assert.equal(check.failures[0].reasonCode, 'planner.route_forbidden_by_risk');
  assert.equal(check.failures[0].sourceReasonCode, 'graph-route-forbidden-by-risk');
  assert.equal(check.failures[0].cooldownRequired, true);
  assert.equal(check.failures[0].manualInterventionRequired, true);
  assert.equal(check.failures[0].degradable, true);
  assert.equal(check.riskSummary.allowed, false);
});

test('Planner context checker maps graph layer adapter schema and agent exposure failures', async () => {
  const routeResolution = await createRouteResolution();

  const check = checkPlannerContext({
    routeResolution,
    planContext: createPlanContext({
      graphCompatibility: {
        validated: false,
        reasonCode: 'graph-validation-failed',
      },
      layerCompatibility: {
        compatible: false,
        reasonCode: 'layer-version-mismatch',
      },
      adapterCapabilityState: {
        available: false,
        reasonCode: 'adapter-capability-missing',
      },
      schemaAvailability: {
        available: false,
        reasonCode: 'schema-missing',
      },
      capabilityState: {
        agentExposed: false,
        reasonCode: 'agent-exposure-disabled',
      },
    }),
    requirements: {},
    capability: {
      mode: 'readOnly',
    },
    riskPolicy: {
      allowed: true,
    },
  });

  assert.equal(check.checkStatus, 'blocked');
  assert.deepEqual(
    check.failures.map((failure) => failure.reasonCode),
    [
      'planner.graph_not_validated',
      'planner.version_incompatible',
      'planner.route_context_unsatisfied',
      'planner.schema_missing',
      'planner.route_context_unsatisfied',
    ],
  );
});

test('Planner context checker rejects raw sensitive and runtime material', async () => {
  const routeResolution = await createRouteResolution();

  assert.throws(
    () => checkPlannerContext({
      routeResolution,
      planContext: createPlanContext({
        headers: {
          authorization: 'Bearer synthetic-secret-value',
        },
      }),
      requirements: REQUIRED_REQUIREMENTS,
    }),
    (error) => {
      // @ts-ignore
      assert.equal(error.code, 'planner.sensitive_material_forbidden');
      // @ts-ignore
      assert.doesNotMatch(error.message, /synthetic-secret-value/u);
      return true;
    },
  );
  assert.throws(
    () => checkPlannerContext({
      routeResolution,
      planContext: createPlanContext(),
      requirements: {
        sessionView: {
          schemaVersion: 1,
        },
      },
    }),
    /forbidden sensitive or runtime fields/u,
  );
});

test('Planner context check descriptor rejects runtime materialization flags', async () => {
  const routeResolution = await createRouteResolution();
  const check = checkPlannerContext({
    routeResolution,
    planContext: createPlanContext(),
  });

  assert.throws(
    () => assertPlannerContextCheckCompatible({
      ...check,
      runtimeMaterializationAllowed: true,
    }),
    /runtime materialization disabled/u,
  );
  assert.throws(
    () => assertPlannerContextCheckCompatible({
      ...check,
      signerRuntimeAllowed: true,
    }),
    /runtime materialization disabled/u,
  );
});
