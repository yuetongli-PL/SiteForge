import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCoverageDeltaFromExecutionFeedback,
  createExecutionFeedbackFromLayerReceipt,
  createLayerExecutionHandoffDescriptor,
  prepareExecutionArtifactJsonWithAudit,
} from '../../../src/sites/capability/execution/index.mjs';

test('execution handoff remains descriptor-only and Layer-governed', () => {
  const handoff = createLayerExecutionHandoffDescriptor({
    executionId: 'execution:synthetic',
    capabilityPlanRef: 'plan:synthetic',
    graphVersion: 'compiler-generated:synthetic.example:0.1.0',
    plannerVersion: '0.1.0',
    layerCompatibilityVersion: '1.0.0',
  });

  assert.equal(handoff.handoffTarget, 'site-capability-layer');
  assert.equal(handoff.descriptorOnly, true);
  assert.equal(handoff.executionAttempted, false);
  assert.equal(handoff.layerDispatchAllowed, false);
  assert.equal(handoff.directDownloaderInvocationAllowed, false);
  assert.equal(handoff.directSiteAdapterInvocationAllowed, false);
  assert.equal(handoff.sessionViewAllowed, false);
});

test('execution feedback and coverage delta accept Layer-origin summaries only', () => {
  const feedback = createExecutionFeedbackFromLayerReceipt({
    executionId: 'execution:synthetic',
    executionStatus: 'completed',
    artifactRefs: ['artifact:synthetic'],
    reasonCodes: [],
  });
  const delta = createCoverageDeltaFromExecutionFeedback({
    executionFeedback: feedback,
    coverageAfter: 'partial',
    evidenceRefs: ['artifact:synthetic'],
  });

  assert.equal(feedback.feedbackSource, 'site-capability-layer');
  assert.equal(delta.executionId, feedback.executionId);
});

test('execution contracts reject direct downloader, session, and sensitive material', () => {
  assert.throws(
    () => createLayerExecutionHandoffDescriptor({
      executionId: 'execution:synthetic',
      capabilityPlanRef: 'plan:synthetic',
      graphVersion: 'graph',
      plannerVersion: 'planner',
      layerCompatibilityVersion: 'layer',
      downloaderTask: { id: 'task:synthetic' },
    }),
    /forbidden sensitive or runtime fields/u,
  );
  assert.throws(
    () => createExecutionFeedbackFromLayerReceipt({
      executionId: 'execution:synthetic',
      executionStatus: 'completed',
      sessionView: { status: 'synthetic' },
    }),
    /forbidden sensitive or runtime fields/u,
  );
  assert.throws(
    () => prepareExecutionArtifactJsonWithAudit({
      redactionRequired: true,
      cookie: 'SESSDATA=synthetic-secret-value',
    }),
    (error) => {
      assert.equal(error.code, 'execution.raw_sensitive_material_rejected');
      assert.doesNotMatch(error.message, /synthetic-secret-value/u);
      return true;
    },
  );
});

test('coverage delta rejects complete coverage promotion without evidence', () => {
  const feedback = createExecutionFeedbackFromLayerReceipt({
    executionId: 'execution:synthetic',
    executionStatus: 'completed',
  });
  assert.throws(
    () => createCoverageDeltaFromExecutionFeedback({
      executionFeedback: feedback,
      coverageAfter: 'complete_within_scope',
      evidenceRefs: [],
    }),
    /complete coverage requires evidence/u,
  );
});

test('execution contracts reject unsafe artifact and evidence refs', () => {
  assert.throws(
    () => createLayerExecutionHandoffDescriptor({
      executionId: 'execution:synthetic',
      capabilityPlanRef: 'https://example.test/plan.json',
      graphVersion: 'graph',
      plannerVersion: 'planner',
      layerCompatibilityVersion: 'layer',
    }),
    (error) => error.code === 'execution.raw_sensitive_material_rejected',
  );

  assert.throws(
    () => createExecutionFeedbackFromLayerReceipt({
      executionId: 'execution:synthetic',
      executionStatus: 'completed',
      artifactRefs: ['artifact:user@example.test'],
    }),
    (error) => error.code === 'execution.raw_sensitive_material_rejected',
  );

  const feedback = createExecutionFeedbackFromLayerReceipt({
    executionId: 'execution:synthetic',
    executionStatus: 'completed',
    artifactRefs: ['artifact:synthetic'],
  });
  assert.throws(
    () => createCoverageDeltaFromExecutionFeedback({
      executionFeedback: feedback,
      coverageAfter: 'partial',
      evidenceRefs: ['C:/Users/example/coverage-delta.json'],
    }),
    (error) => error.code === 'execution.raw_sensitive_material_rejected',
  );
});
