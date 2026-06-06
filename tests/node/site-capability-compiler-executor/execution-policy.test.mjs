import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXECUTION_GATES,
  EXECUTION_VERDICTS,
  createCoverageDeltaArtifactQueueEntry,
  createCoverageDeltaFromExecutionFeedback,
  createExecutionFeedbackFromLayerReceipt,
  createExecutionPolicyDecision,
  createGovernedExecutionPolicyDecision,
  createLayerExecutionHandoffDescriptor,
  prepareCoverageDeltaArtifactQueueWrite,
  assertNoExecutionSensitiveMaterial,
} from '../../../src/domain/policies/execution/index.mjs';

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
    // @ts-ignore
    (error) => error.code === 'execution.raw_sensitive_material_rejected',
  );
});

test('GovernedExecutionPolicyDecision separates final verdict from execution gates', () => {
  assert.deepEqual(EXECUTION_VERDICTS, ['allow', 'controlled', 'blocked']);
  assert.equal(EXECUTION_GATES.includes('confirm_required'), true);
  assert.equal(EXECUTION_VERDICTS.includes('confirm_required'), false);

  const controlled = createGovernedExecutionPolicyDecision({
    executionId: 'execution:policy',
    capabilityId: 'capability:policy:update-record',
    executionContractRef: 'execution-contract:policy-update-record',
    verdict: 'controlled',
    gates: ['confirm_required', 'audit_required', 'session_required', 'permission_required'],
    runtimeDispatchAllowed: false,
    confirmationRequired: true,
    auditRequired: true,
    sessionRequired: true,
    permissionRequired: true,
  });

  assert.equal(controlled.verdict, 'controlled');
  assert.equal(controlled.disposition, 'controlled');
  assert.deepEqual(controlled.gates, [
    'confirm_required',
    'audit_required',
    'session_required',
    'permission_required',
  ]);

  const legacyConfirmation = createGovernedExecutionPolicyDecision({
    executionId: 'execution:policy',
    capabilityId: 'capability:policy:legacy-confirm',
    executionContractRef: 'execution-contract:policy-legacy-confirm',
    disposition: 'confirm_required',
    runtimeDispatchAllowed: false,
    confirmationRequired: true,
  });
  assert.equal(legacyConfirmation.verdict, 'controlled');
  assert.equal(legacyConfirmation.disposition, 'controlled');
  assert.deepEqual(legacyConfirmation.gates, ['confirm_required', 'audit_required']);

  assert.throws(
    () => createGovernedExecutionPolicyDecision({
      executionId: 'execution:policy',
      capabilityId: 'capability:policy:invalid',
      executionContractRef: 'execution-contract:policy-invalid',
      // @ts-ignore
      verdict: 'confirm_required',
    }),
    /verdict is unsupported/u,
  );

  assert.throws(
    () => createGovernedExecutionPolicyDecision({
      executionId: 'execution:policy',
      capabilityId: 'capability:policy:allow-with-gate',
      executionContractRef: 'execution-contract:policy-allow-with-gate',
      verdict: 'allow',
      gates: ['confirm_required'],
    }),
    /Allow governed execution cannot require gates/u,
  );
});

test('Execution validators allow structured descriptors but reject runtime material', () => {
  assert.equal(assertNoExecutionSensitiveMaterial({
    executionContractRef: 'execution-contract:policy-download',
    requestSchemaRef: 'schema:policy-download:request',
    runtimeBindingRef: 'runtime-binding:policy-download',
    sessionRequirementRef: 'session-requirement:policy-authenticated',
    payloadTemplate: {
      csrfToken: '{{runtime.secret.csrf}}',
      address: {
        type: 'string',
        source: 'slot:shipping-address',
      },
    },
    headerSchema: {
      Authorization: {
        type: 'string',
        source: 'runtime_secret_placeholder',
      },
      'Set-Cookie': {
        type: 'string',
        source: 'runtime_secret_placeholder',
      },
    },
    downloaderTaskDescriptor: {
      taskKind: 'download',
      outputPathConstraint: {
        type: 'workspace_relative',
        value: '{{slot:outputPath}}',
      },
    },
  }), true);

  const rejectedDescriptors = [
    {
      name: 'raw header value',
      value: {
        headerSchema: {
          Authorization: {
            value: 'Bearer synthetic-secret-value',
          },
        },
      },
    },
    {
      name: 'runtime downloader task',
      value: {
        payloadTemplate: {
          downloaderTask: {
            id: 'task:synthetic',
          },
        },
      },
    },
    {
      name: 'private local path',
      value: {
        downloaderTaskDescriptor: {
          outputPath: 'C:/Users/example/AppData/Local/BrowserProfile',
        },
      },
    },
    {
      name: 'function value',
      value: {
        payloadTemplate: {
          transform: () => 'unsafe',
        },
      },
    },
    {
      name: 'unsafe credential ref',
      value: {
        executionContractRef: 'execution-contract:policy-credential',
      },
    },
  ];

  for (const { name, value } of rejectedDescriptors) {
    assert.throws(
      () => assertNoExecutionSensitiveMaterial(value),
      (error) => {
        // @ts-ignore
        assert.equal(error.code, 'execution.raw_sensitive_material_rejected');
        // @ts-ignore
        assert.doesNotMatch(error.message, /synthetic-secret-value|BrowserProfile/u);
        return true;
      },
      `${name} should be rejected`,
    );
  }
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
  assert.equal(feedback.dryRun, true);
  assert.equal(feedback.runtimeExecuted, false);
  assert.equal(feedback.directDownloaderInvocationAllowed, false);
  assert.equal(feedback.directSiteAdapterInvocationAllowed, false);
  assert.equal(delta.dryRun, true);
  assert.equal(delta.runtimeExecuted, false);
  assert.equal(delta.directDownloaderInvocationAllowed, false);
  assert.equal(delta.directSiteAdapterInvocationAllowed, false);
  assert.equal(prepared.redactionApplied, true);
  assert.doesNotMatch(prepared.artifactJson, /SESSDATA|Authorization|browserProfilePath|userDataDir/u);
});
