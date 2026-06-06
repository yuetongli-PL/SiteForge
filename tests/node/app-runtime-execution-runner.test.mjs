import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createRuntimeInvocationRequest,
} from '../../src/app/planner/index.mjs';
import {
  createRuntimeAuditRecorder,
  createRuntimeProviderRegistryWith,
  executeRuntimeInvocation,
} from '../../src/app/runtime/index.mjs';
import {
  createMockSessionVault,
  createMockRuntimeProviderRegistry,
} from '../../src/app/runtime/testing.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../src/domain/policies/execution/index.mjs';

/** @param {Record<string, any>} [overrides] */
function createRequest(overrides = {}) {
  return createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: 'synthetic.example',
      capabilityId: overrides.capabilityId ?? 'capability:synthetic:write-record',
    },
    executionContractRef: overrides.executionContractRef ?? 'execution-contract:synthetic-write-record',
    policyDecisionRef: overrides.policyDecisionRef ?? 'policy:synthetic-write-record',
    verdictHint: overrides.verdictHint ?? 'allow',
    requiredGates: overrides.requiredGates ?? [],
  });
}

/** @param {Record<string, any>} [options] */
function createPolicy({
  capabilityId = 'capability:synthetic:write-record',
  executionContractRef = 'execution-contract:synthetic-write-record',
  verdict = 'allow',
  gates = [],
  gateStatus = null,
  runtimeDispatchAllowed = true,
  siteAdapterInvocationAllowed = true,
  downloaderInvocationAllowed = false,
  auditRequired = false,
  ...rest
} = {}) {
  return createGovernedExecutionPolicyDecision({
    executionId: 'execution:synthetic',
    capabilityId,
    executionContractRef,
    verdict,
    gates,
    gateStatus,
    runtimeDispatchAllowed,
    siteAdapterInvocationAllowed,
    downloaderInvocationAllowed,
    auditRequired,
    ...rest,
  });
}

test('runtime public API does not export or import testing providers', async () => {
  const [indexSource, runnerSource, pipelineSource, runBuildSource] = await Promise.all([
    readFile(new URL('../../src/app/runtime/index.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../src/app/runtime/execution-runner.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../src/app/pipeline/build/pipeline.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../src/entrypoints/build/run-build.mjs', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(indexSource, /mock-providers|mock-session-vault|testing\.mjs/u);
  assert.doesNotMatch(runnerSource, /mock-providers|mock-session-vault|testing\.mjs|createMockRuntimeProviderRegistry/u);
  assert.match(runnerSource, /providerRegistry/u);
  assert.match(pipelineSource, /executeRuntimeInvocation/u);
  assert.doesNotMatch(pipelineSource, /api-read-provider|download-provider|browser-action-provider|mock-providers|mock-session-vault|runtime\/testing/u);
  assert.match(runBuildSource, /createProductionRuntimeProviderRegistry/u);
  assert.match(runBuildSource, /from '..\/..\/app\/runtime\/index\.mjs'/u);
  assert.doesNotMatch(runBuildSource, /api-read-provider|download-provider|browser-action-provider|mock-providers|mock-session-vault|runtime\/testing/u);
});

test('runtime execution runner invokes mock write provider after allow dispatch', async () => {
  const request = createRequest();
  const policyDecision = createPolicy();

  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract: {
      capabilityKind: 'write',
      contractKind: 'write',
      runtimeBindingRef: 'runtime-binding:synthetic-write',
    },
    providerRegistry: createMockRuntimeProviderRegistry(),
  });

  assert.equal(report.reportType, 'RuntimeExecutionReport');
  assert.equal(report.status, 'completed');
  assert.equal(report.executionId, 'execution:synthetic');
  assert.equal(report.dispatchStatus, 'ready_for_direct_runtime');
  assert.equal(report.providerId, 'mock-runtime-write');
  assert.equal(report.verdict, 'allow');
  assert.deepEqual(report.gates, []);
  assert.deepEqual(report.gateStatus, {});
  assert.equal(report.runtimeDispatchAllowed, true);
  assert.equal(report.providerInvoked, true);
  assert.equal(report.executionAttempted, true);
  assert.equal(report.runtimeExecuted, true);
  assert.equal(report.sideEffectAttempted, true);
  assert.equal(report.sideEffectSucceeded, true);
  assert.equal(report.sideEffectFailed, false);
  assert.equal(report.blockedReason, null);
  assert.equal(report.sanitizedError, null);
  assert.deepEqual(report.artifactRefs, []);
  assert.match(report.auditRef, /^artifact:runtime-audit:/u);
  assert.equal(report.resultSummary.outcome, 'mock_write_completed');
});

test('runtime execution runner invokes mock download provider after controlled gates are satisfied', async () => {
  const request = createRequest({
    capabilityId: 'capability:synthetic:download-report',
    executionContractRef: 'execution-contract:synthetic-download-report',
    policyDecisionRef: 'policy:synthetic-download-report',
    verdictHint: 'controlled',
    requiredGates: ['session_required', 'output_path_required'],
  });
  const policyDecision = createPolicy({
    capabilityId: 'capability:synthetic:download-report',
    executionContractRef: 'execution-contract:synthetic-download-report',
    verdict: 'controlled',
    gates: ['session_required', 'output_path_required'],
    gateStatus: {
      allSatisfied: true,
      session_required: { satisfied: true },
      output_path_required: { satisfied: true },
    },
    runtimeDispatchAllowed: true,
    siteAdapterInvocationAllowed: false,
    downloaderInvocationAllowed: true,
    sessionRequired: true,
    outputPathRequired: true,
  });

  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract: {
      capabilityKind: 'download',
      contractKind: 'download',
      runtimeBindingRef: 'runtime-binding:synthetic-download',
    },
    providerRegistry: createMockRuntimeProviderRegistry(),
  });

  assert.equal(report.status, 'completed');
  assert.equal(report.dispatchStatus, 'ready_for_controlled_runtime');
  assert.equal(report.providerId, 'mock-runtime-download');
  assert.equal(report.runtimeExecuted, true);
  assert.equal(report.executionAttempted, true);
  assert.equal(report.sideEffectAttempted, true);
  assert.equal(report.sideEffectSucceeded, true);
  assert.equal(report.gateEvaluation.allSatisfied, true);
  assert.deepEqual(report.gateStatus, {
    session_required: { satisfied: true },
    output_path_required: { satisfied: true },
  });
});

test('runtime execution runner blocks controlled dispatch when gates are missing', async () => {
  const request = createRequest({
    verdictHint: 'controlled',
    requiredGates: ['session_required'],
  });
  const policyDecision = createPolicy({
    verdict: 'controlled',
    gates: ['session_required'],
    runtimeDispatchAllowed: false,
    sessionRequired: true,
  });

  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract: {
      capabilityKind: 'write',
      runtimeBindingRef: 'runtime-binding:synthetic-write',
    },
    providerRegistry: createMockRuntimeProviderRegistry(),
  });

  assert.equal(report.status, 'blocked_by_gates');
  assert.equal(report.providerInvoked, false);
  assert.equal(report.executionAttempted, false);
  assert.equal(report.runtimeExecuted, false);
  assert.equal(report.sideEffectAttempted, false);
  assert.equal(report.sideEffectSucceeded, false);
  assert.equal(report.sideEffectFailed, false);
  assert.equal(report.blockedReason, 'runtime.gates_not_satisfied');
});

test('runtime execution runner never calls providers for blocked verdicts', async () => {
  let providerCalls = 0;
  const request = createRequest({ verdictHint: 'blocked' });
  const policyDecision = createPolicy({
    verdict: 'blocked',
    runtimeDispatchAllowed: false,
    siteAdapterInvocationAllowed: true,
  });
  const providerRegistry = createRuntimeProviderRegistryWith([
    {
      id: 'counting-provider',
      capabilityKinds: ['write'],
      providerKind: 'mock',
      async run() {
        providerCalls += 1;
        return {
          status: 'completed',
          runtimeExecuted: true,
          sideEffectAttempted: false,
          resultSummary: { outcome: 'unexpected', artifactRefs: [], redactionRequired: true },
        };
      },
    },
  ]);

  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract: {
      capabilityKind: 'write',
      runtimeBindingRef: 'runtime-binding:synthetic-write',
    },
    providerRegistry,
  });

  assert.equal(report.status, 'blocked_by_policy');
  assert.equal(report.providerInvoked, false);
  assert.equal(report.executionAttempted, false);
  assert.equal(report.sideEffectAttempted, false);
  assert.equal(providerCalls, 0);
});

test('runtime execution runner reports provider_unavailable without side effects', async () => {
  const request = createRequest();
  const policyDecision = createPolicy();

  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract: {
      capabilityKind: 'write',
      providerId: 'missing-provider',
      runtimeBindingRef: 'runtime-binding:synthetic-write',
    },
    providerRegistry: createRuntimeProviderRegistryWith([]),
  });

  assert.equal(report.status, 'blocked');
  assert.equal(report.providerInvoked, false);
  assert.equal(report.executionAttempted, false);
  assert.equal(report.runtimeExecuted, false);
  assert.equal(report.sideEffectAttempted, false);
  assert.equal(report.blockedReason, 'runtime.provider_unavailable');
});

test('runtime execution runner blocks execution when provider registry is unavailable', async () => {
  const request = createRequest();
  const policyDecision = createPolicy();

  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract: {
      capabilityKind: 'write',
      runtimeBindingRef: 'runtime-binding:synthetic-write',
    },
  });

  assert.equal(report.status, 'blocked');
  assert.equal(report.providerId, null);
  assert.equal(report.providerInvoked, false);
  assert.equal(report.executionAttempted, false);
  assert.equal(report.runtimeExecuted, false);
  assert.equal(report.sideEffectAttempted, false);
  assert.equal(report.blockedReason, 'runtime.provider_registry_unavailable');
});

test('runtime execution runner respects provider canExecute false without side effects', async () => {
  let runCalls = 0;
  const request = createRequest();
  const policyDecision = createPolicy();
  const providerRegistry = createRuntimeProviderRegistryWith([
    {
      id: 'declining-provider',
      capabilityKinds: ['write'],
      providerKind: 'mock',
      canExecute() {
        return { allowed: false, reasonCode: 'runtime.synthetic_provider_declined' };
      },
      async run() {
        runCalls += 1;
        return {
          status: 'completed',
          runtimeExecuted: true,
          sideEffectAttempted: true,
          resultSummary: { outcome: 'unexpected', artifactRefs: [], redactionRequired: true },
        };
      },
    },
  ]);

  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract: {
      capabilityKind: 'write',
      runtimeBindingRef: 'runtime-binding:synthetic-write',
    },
    providerRegistry,
  });

  assert.equal(report.status, 'provider_not_executable');
  assert.equal(report.providerId, 'declining-provider');
  assert.equal(report.providerInvoked, false);
  assert.equal(report.executionAttempted, false);
  assert.equal(report.sideEffectAttempted, false);
  assert.equal(report.sideEffectSucceeded, false);
  assert.equal(report.sideEffectFailed, false);
  assert.equal(report.blockedReason, 'runtime.synthetic_provider_declined');
  assert.equal(runCalls, 0);
});

test('runtime execution runner returns failed with sanitizedError when provider throws', async () => {
  const request = createRequest();
  const policyDecision = createPolicy();
  const providerRegistry = createRuntimeProviderRegistryWith([
    {
      id: 'throwing-provider',
      capabilityKinds: ['write'],
      providerKind: 'mock',
      async run() {
        throw Object.assign(new Error('Bearer raw-secret-token should not persist'), {
          code: 'provider.secret_error',
        });
      },
    },
  ]);

  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract: {
      capabilityKind: 'write',
      runtimeBindingRef: 'runtime-binding:synthetic-write',
    },
    providerRegistry,
  });

  assert.equal(report.status, 'failed');
  assert.equal(report.reasonCode, 'runtime.provider_failed');
  assert.equal(report.providerInvoked, true);
  assert.equal(report.executionAttempted, true);
  assert.equal(report.sideEffectAttempted, true);
  assert.equal(report.sideEffectSucceeded, false);
  assert.equal(report.sideEffectFailed, true);
  assert.equal(report.sanitizedError.message, 'Runtime provider failed');
  assert.doesNotMatch(JSON.stringify(report), /raw-secret-token|Bearer/u);
});

test('runtime execution runner rejects sensitive provider output', async () => {
  const request = createRequest({
    capabilityId: 'capability:synthetic:read-record',
    executionContractRef: 'execution-contract:synthetic-read-record',
    policyDecisionRef: 'policy:synthetic-read-record',
  });
  const policyDecision = createPolicy({
    capabilityId: 'capability:synthetic:read-record',
    executionContractRef: 'execution-contract:synthetic-read-record',
  });
  const providerRegistry = createRuntimeProviderRegistryWith([
    {
      id: 'bad-provider',
      capabilityKinds: ['read'],
      providerKind: 'mock',
      async run() {
        return {
          status: 'completed',
          runtimeExecuted: true,
          sideEffectAttempted: false,
          resultSummary: {
            outcome: 'unsafe',
            headers: {
              Authorization: 'Bearer not-for-artifacts',
            },
            redactionRequired: true,
          },
        };
      },
    },
  ]);

  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract: {
      capabilityKind: 'read',
      runtimeBindingRef: 'runtime-binding:synthetic-read',
    },
    providerRegistry,
  });

  assert.equal(report.status, 'provider_output_rejected');
  assert.equal(report.reasonCode, 'runtime.provider_output_rejected');
  assert.equal(report.providerInvoked, true);
  assert.equal(report.executionAttempted, true);
  assert.equal(report.runtimeExecuted, true);
  assert.equal(report.sideEffectAttempted, true);
  assert.equal(report.sideEffectFailed, true);
  assert.equal(report.resultSummary, null);
});

test('runtime audit recorder writes sanitized whitelist events only', () => {
  const recorder = createRuntimeAuditRecorder();
  const event = recorder.record({
    requestId: 'runtime-invocation:synthetic',
    executionId: 'execution:synthetic',
    capabilityId: 'capability:synthetic:write-record',
    executionContractRef: 'execution-contract:synthetic-write-record',
    providerId: 'mock-runtime-write',
    verdict: 'allow',
    status: 'completed',
    gates: [],
    gateStatus: {},
    runtimeDispatchAllowed: true,
    executionAttempted: true,
    sideEffectAttempted: true,
    sideEffectSucceeded: true,
    sideEffectFailed: false,
    artifactRefs: [],
    headers: { Authorization: 'Bearer raw-token' },
    rawRequestBody: 'token=raw-token',
    sanitizedError: new Error('Cookie: raw-cookie'),
  });

  assert.match(event.auditRef, /^artifact:runtime-audit:/u);
  assert.equal(event.sideEffectAttempted, true);
  assert.equal(event.sanitizedError.message, 'Runtime error redacted');
  assert.doesNotMatch(JSON.stringify(event), /Authorization|raw-token|rawRequestBody|raw-cookie|Cookie/u);
  assert.equal(recorder.listEvents().length, 1);
});

test('mock session vault returns only synthetic placeholder boundary data', async () => {
  const vault = createMockSessionVault();
  const sessionBoundary = await vault.resolveSessionRequirement({
    sessionRequirementRef: 'session-requirement:synthetic-authenticated',
    requestId: 'runtime-invocation:synthetic',
  });

  assert.equal(sessionBoundary.runtimeBoundary, 'app/runtime');
  assert.equal(sessionBoundary.availability, 'synthetic_available');
  assert.equal(sessionBoundary.materialized, false);
  assert.equal(sessionBoundary.materialPolicy, 'placeholder_only');
  assert.match(sessionBoundary.leaseRef, /^session-requirement:/u);
  assert.doesNotMatch(JSON.stringify(sessionBoundary), /cookie|token|credential|Authorization|browserProfilePath|userDataDir/iu);
});
