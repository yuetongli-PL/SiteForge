import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRuntimeInvocationRequest,
} from '../../../src/app/planner/index.mjs';
import {
  assertRuntimeInvocationRequestCompatible,
} from '../../../src/domain/policies/execution/index.mjs';

test('RuntimeInvocationRequest keeps planner output descriptor-only for app runtime', () => {
  const request = createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: 'synthetic.example',
      capabilityId: 'capability:synthetic:update-record',
    },
    executionIntent: {
      id: 'update-record',
      capabilityId: 'capability:synthetic:update-record',
    },
    executionContractRef: 'execution-contract:synthetic-update-record',
    policyDecisionRef: 'policy:synthetic-update-record',
    verdictHint: 'controlled',
    requiredGates: ['confirm_required', 'audit_required'],
    taskId: 'task:synthetic-update-record',
    traceId: 'trace:synthetic-update-record',
    correlationId: 'correlation:synthetic-update-record',
  });

  assert.equal(assertRuntimeInvocationRequestCompatible(request), true);
  assert.equal(request.requestType, 'RuntimeInvocationRequest');
  assert.equal(request.runtimeBoundary, 'app/runtime');
  assert.equal(request.executionAttempted, false);
  assert.equal(request.sideEffectAttempted, false);
  assert.equal(request.verdictHint, 'controlled');
  assert.deepEqual(request.requiredGates, ['confirm_required', 'audit_required']);
});

test('RuntimeInvocationRequest rejects concrete runtime and session fields', () => {
  const request = createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: 'synthetic.example',
      capabilityId: 'capability:synthetic:download',
    },
    executionContractRef: 'execution-contract:synthetic-download',
  });

  for (const [field, value] of /** @type {Array<[string, any]>} */ ([
    ['siteAdapterRuntime', { kind: 'adapter' }],
    ['downloaderTask', { id: 'download' }],
    ['browserContext', { id: 'browser' }],
    ['sessionView', { available: true }],
  ])) {
    assert.throws(
      () => assertRuntimeInvocationRequestCompatible({
        ...request,
        [field]: value,
      }),
      // @ts-ignore
      (error) => error.code === 'execution.raw_sensitive_material_rejected',
      String(field),
    );
  }
});
