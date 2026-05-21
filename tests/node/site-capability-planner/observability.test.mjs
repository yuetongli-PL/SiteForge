import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  SECURITY_GUARD_SCHEMA_VERSION,
} from '../../../src/domain/sessions/security-guard.mjs';
import {
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
  SITE_CAPABILITY_PLANNER_VERSION,
  assertPlannerArtifactWriteResultCompatible,
  assertPlannerLifecycleEventCompatible,
  createPlannerLifecycleEvent,
  writePlannerArtifact,
} from '../../../src/app/planner/index.mjs';

function createBaseEvent(overrides = /** @type {any} */ ({})) {
  return {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    eventType: 'planner.plan.generated',
    traceId: 'trace:synthetic-planner-observability',
    correlationId: 'correlation:synthetic-planner-observability',
    taskId: 'task:synthetic-planner-observability',
    siteId: 'site:example.test',
    siteKey: 'example.test',
    normalizedIntent: 'download-content',
    capabilityId: 'capability:example.download-content',
    routeId: 'route:example.download-content.public',
    graphVersion: '1.0.0',
    layerCompatibilityVersion: '1.0.0',
    adapterId: 'adapter:example.test',
    plannerDecision: {
      status: 'ready',
    },
    riskState: {
      level: 'low',
      allowed: true,
    },
    validationResult: {
      status: 'passed',
    },
    redactionEvent: {
      schemaVersion: SECURITY_GUARD_SCHEMA_VERSION,
      redactionRequired: true,
      descriptorOnly: true,
      redactionCount: 0,
      findingCount: 0,
    },
    ...overrides,
  };
}

function createArtifact(overrides = /** @type {any} */ ({})) {
  return {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    type: 'PLAN_MANIFEST',
    redactionRequired: true,
    payload: {
      planId: 'plan:synthetic-observability',
      descriptorOnly: true,
    },
    ...overrides,
  };
}

test('Planner observability creates descriptor-only lifecycle events with required fields', () => {
  const event = createPlannerLifecycleEvent(createBaseEvent());

  assert.equal(event.schemaVersion, SITE_CAPABILITY_PLANNER_SCHEMA_VERSION);
  assert.equal(event.plannerVersion, SITE_CAPABILITY_PLANNER_VERSION);
  assert.equal(event.eventType, 'planner.plan.generated');
  assert.equal(event.redactionRequired, true);
  assert.equal(event.descriptorOnly, true);
  assert.equal(event.executionAllowed, false);
  assert.equal(event.layerHandoffAllowed, false);
  assert.equal(event.externalTelemetryAllowed, false);
  assert.equal(event.lifecycleDispatchAllowed, false);
  assert.equal(event.siteAdapterInvocationAllowed, false);
  assert.equal(event.downloaderInvocationAllowed, false);
  assert.equal(event.artifactServiceInvocationAllowed, false);
  assert.equal(event.graphMutationAllowed, false);
  assert.equal(assertPlannerLifecycleEventCompatible(event), true);
});

test('Planner observability rejects missing required fields and incompatible schema', () => {
  assert.throws(
    () => createPlannerLifecycleEvent(createBaseEvent({
      traceId: '',
    })),
    /traceId/u,
  );
  assert.throws(
    () => createPlannerLifecycleEvent(createBaseEvent({
      siteId: undefined,
      siteKey: undefined,
    })),
    /siteId or siteKey/u,
  );
  assert.throws(
    () => createPlannerLifecycleEvent(createBaseEvent({
      schemaVersion: '99.0.0',
    })),
    (error) => {
      // @ts-ignore
      assert.equal(error.code, 'planner.version_incompatible');
      return true;
    },
  );
});

test('Planner observability validates cataloged reasonCodes', () => {
  const blocked = createPlannerLifecycleEvent(createBaseEvent({
    eventType: 'planner.plan.blocked',
    routeId: undefined,
    capabilityId: undefined,
    graphVersion: undefined,
    layerCompatibilityVersion: undefined,
    adapterId: undefined,
    plannerDecision: {
      status: 'blocked',
    },
    reasonCode: 'planner.auth_required',
    riskState: {
      allowed: false,
      reasonCode: 'planner.route_forbidden_by_risk',
    },
    validationResult: {
      status: 'failed',
      reasonCode: 'planner.route_context_unsatisfied',
    },
  }));

  assert.equal(blocked.reasonCode, 'planner.auth_required');
  assert.throws(
    () => createPlannerLifecycleEvent(createBaseEvent({
      reasonCode: 'graph-route-forbidden-by-risk',
    })),
    /cataloged Planner reasonCode/u,
  );
  assert.throws(
    () => createPlannerLifecycleEvent(createBaseEvent({
      plannerDecision: {
        status: 'failed',
      },
    })),
    /require reasonCode/u,
  );
  assert.throws(
    () => createPlannerLifecycleEvent(createBaseEvent({
      validationResult: {
        status: 'failed',
        reasonCode: 'not-a-planner-code',
      },
    })),
    /cataloged Planner reasonCode/u,
  );
});

test('Planner observability accepts guarded artifact and redaction summaries', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-observability-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const artifactWriteEvent = await writePlannerArtifact({
    artifact: createArtifact(),
    artifactPath: path.join(tempDir, 'plan.json'),
    auditPath: path.join(tempDir, 'plan.audit.json'),
  });

  assert.equal(assertPlannerArtifactWriteResultCompatible(artifactWriteEvent), true);
  const event = createPlannerLifecycleEvent(createBaseEvent({
    eventType: 'planner.artifact.write_recorded',
    artifactWriteEvent,
  }));

  assert.equal(event.artifactWriteEvent.artifactKind, 'PlanArtifact');
  assert.equal(event.artifactWriteEvent.rawArtifactWriteAllowed, false);
  assert.equal(assertPlannerLifecycleEventCompatible(event), true);

  assert.throws(
    () => createPlannerLifecycleEvent(createBaseEvent({
      eventType: 'planner.artifact.write_recorded',
      artifactWriteEvent: {
        ...artifactWriteEvent,
        rawArtifactWriteAllowed: true,
      },
    })),
    /redacted descriptor-only artifact evidence/u,
  );
  assert.throws(
    () => createPlannerLifecycleEvent(createBaseEvent({
      eventType: 'planner.redaction.recorded',
      redactionEvent: {
        schemaVersion: SECURITY_GUARD_SCHEMA_VERSION,
        descriptorOnly: true,
        redactionCount: 0,
        findingCount: 0,
      },
    })),
    /redaction-required descriptor/u,
  );
});

test('Planner observability rejects sensitive and runtime material without echoing secrets', () => {
  for (const { name, override } of [
    {
      name: 'headers',
      override: {
        headers: {
          authorization: 'Bearer synthetic-secret-value',
        },
      },
    },
    {
      name: 'sensitive value',
      override: {
        note: 'https://synthetic.example/?access_token=synthetic-secret-value',
      },
    },
    {
      name: 'session runtime',
      override: {
        sessionView: {
          status: 'available',
        },
      },
    },
    {
      name: 'downloader runtime',
      override: {
        downloaderPayload: {
          command: 'download',
        },
      },
    },
  ]) {
    assert.throws(
      () => createPlannerLifecycleEvent(createBaseEvent(override)),
      (error) => {
        // @ts-ignore
        assert.equal(error.code, 'planner.sensitive_material_forbidden');
        // @ts-ignore
        assert.doesNotMatch(error.message, /synthetic-secret-value/u, name);
        return true;
      },
      name,
    );
  }
});

test('Planner observability rejects payload fields and runtime claims', () => {
  for (const override of [
    { payload: { status: 'unsafe' } },
    { artifactJson: '{"unsafe":true}' },
    { eventPayload: { status: 'unsafe' } },
    { dispatch: { enabled: true } },
  ]) {
    assert.throws(
      () => createPlannerLifecycleEvent(createBaseEvent(override)),
      /must not expose payload field/u,
    );
  }

  for (const override of [
    { redactionRequired: false },
    { descriptorOnly: false },
    { executionAllowed: true },
    { externalTelemetryAllowed: true },
    { lifecycleDispatchAllowed: true },
    { downloaderInvocationAllowed: true },
    { artifactServiceInvocationAllowed: true },
    { graphMutationAllowed: true },
  ]) {
    assert.throws(
      () => createPlannerLifecycleEvent(createBaseEvent(override)),
      /redaction-required descriptor/u,
    );
  }
});
