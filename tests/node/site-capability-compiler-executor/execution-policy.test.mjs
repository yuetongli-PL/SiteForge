import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCoverageDeltaArtifactQueueEntry,
  createCoverageDeltaFromExecutionFeedback,
  createExecutionFeedbackFromLayerReceipt,
  createExecutionPolicyDecision,
  createLayerExecutionHandoffDescriptor,
  prepareCoverageDeltaArtifactQueueWrite,
} from '../../../src/sites/capability/execution/index.mjs';

function createHandoff() {
  return createLayerExecutionHandoffDescriptor({
    executionId: 'execution:policy',
    capabilityPlanRef: 'plan:policy',
    graphVersion: 'graph:v1',
    plannerVersion: '0.1.0',
    layerCompatibilityVersion: '1.0.0',
  });
}

test('ExecutionPolicyDecision preflights Layer-governed handoff without runtime dispatch', () => {
  const decision = createExecutionPolicyDecision({
    handoffDescriptor: createHandoff(),
    plannerHandoffRef: 'planner-handoff:policy',
    approvalSatisfied: true,
  });

  assert.equal(decision.decisionStatus, 'ready_for_layer_governed_dispatch');
  assert.equal(decision.layerGovernedDispatchReady, true);
  assert.equal(decision.executionAttempted, false);
  assert.equal(decision.directDownloaderInvocationAllowed, false);
  assert.equal(decision.directSiteAdapterInvocationAllowed, false);
});

test('ExecutionPolicyDecision blocks before approval and rejects runtime fields', () => {
  const blocked = createExecutionPolicyDecision({
    handoffDescriptor: createHandoff(),
    plannerHandoffRef: 'planner-handoff:policy',
    approvalSatisfied: false,
  });
  assert.equal(blocked.decisionStatus, 'blocked');
  assert.equal(blocked.reasonCode, 'execution.approval_required');

  assert.throws(
    () => createExecutionPolicyDecision({
      handoffDescriptor: createHandoff(),
      plannerHandoffRef: 'planner-handoff:policy',
      approvalSatisfied: true,
      downloaderTask: { id: 'task' },
    }),
    (error) => error.code === 'execution.raw_sensitive_material_rejected',
  );
});

test('CoverageDelta artifact queue prepares redacted descriptor writes', () => {
  const feedback = createExecutionFeedbackFromLayerReceipt({
    executionId: 'execution:coverage-delta',
    executionStatus: 'completed',
    artifactRefs: ['artifact:layer-summary'],
  });
  const delta = createCoverageDeltaFromExecutionFeedback({
    executionFeedback: feedback,
    coverageAfter: 'partial',
    evidenceRefs: ['artifact:layer-summary'],
  });
  const entry = createCoverageDeltaArtifactQueueEntry({ coverageDelta: delta });
  const prepared = prepareCoverageDeltaArtifactQueueWrite({ coverageDelta: delta });

  assert.equal(entry.queueMode, 'redacted_descriptor_queue');
  assert.equal(entry.descriptorOnly, true);
  assert.equal(prepared.redactionApplied, true);
  assert.doesNotMatch(prepared.artifactJson, /SESSDATA|Authorization|browserProfilePath|userDataDir/u);
});
