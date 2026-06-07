// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createRuntimeProviderRegistryWith,
  createSkillInvocationIdempotencyLedger,
  createSkillRuntimeDryRunPreview,
  createSkillRuntimeInvocationRequest,
  invokeSkillRuntime,
  resolveSkillInvocationPackageRefs,
} from '../../src/app/runtime/index.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../src/domain/policies/execution/index.mjs';

const PACKAGE_FIXTURE_URL = new URL('./fixtures/skill-runtime-invocation-api-v1/skill-package.json', import.meta.url);
const POLICY_PACK_URL = new URL('./fixtures/policy-pack-authoring-simulation-v1/safe-policy-pack.json', import.meta.url);
const SKILL_CANARIES =
  /sf_skill_task_text_secret_should_not_authorize|sf_skill_cookie_secret_123|sf_skill_token_secret_456|sf_skill_session_ref_secret_should_not_log/u;
const CAPABILITY_REF = 'sitepkg:example.com/contact-submit@1.2.0';
const CONTRACT_REF = 'sitepkg:example.com/contract/contact-submit@1.2.0';
const RUNTIME_CONTRACT_REF = 'execution-contract:sitepkg:example.com-contract-contact-submit-1.2.0';

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

async function readPackageFixture() {
  return readJson(PACKAGE_FIXTURE_URL);
}

async function readPolicyPackFixture() {
  return readJson(POLICY_PACK_URL);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createBaseSkillRequest(overrides = {}) {
  return {
    schemaVersion: 'skill.runtime_invocation.v1',
    requestId: 'skill-invocation:phase18-contact-submit',
    skillId: 'skill:phase18-safe-skill',
    packageId: 'sitepkg:example.com',
    packageVersion: '1.2.0',
    capabilityRef: CAPABILITY_REF,
    executionContractRef: CONTRACT_REF,
    policyDecisionRef: 'policy-decision:phase18-safe-ref',
    mode: 'dryRun',
    idempotencyKey: 'idem:phase18-contact-submit',
    slots: {
      email: { slotRef: 'slot:email' },
      message: { slotRef: 'slot:message' },
    },
    auth: {
      sessionRef: 'session:phase18-safe-ref',
    },
    destructiveAuthorization: null,
    ...overrides,
  };
}

function createControlledPolicy(overrides = {}) {
  return createGovernedExecutionPolicyDecision({
    executionId: 'execution:phase18-contact-submit',
    capabilityId: 'capability:example.com:contact-submit',
    executionContractRef: RUNTIME_CONTRACT_REF,
    verdict: 'controlled',
    gates: ['audit_required'],
    gateStatus: {
      allSatisfied: true,
      audit_required: { satisfied: true },
    },
    runtimeDispatchAllowed: true,
    siteAdapterInvocationAllowed: true,
    auditRequired: true,
    ...overrides,
  });
}

function createCountingProviderRegistry(counter) {
  return createRuntimeProviderRegistryWith([
    {
      id: 'phase18-form-provider',
      providerKind: 'phase18_test_provider',
      capabilityKinds: ['form_or_action', 'write', 'submit'],
      async run({ invocationRequest, executionContract }) {
        counter.calls += 1;
        return {
          providerId: 'phase18-form-provider',
          providerKind: 'phase18_test_provider',
          status: 'completed',
          runtimeExecuted: true,
          sideEffectAttempted: true,
          sideEffectSucceeded: true,
          sideEffectFailed: false,
          resultSummary: {
            outcome: 'phase18_form_completed',
            capabilityId: invocationRequest.capabilityId,
            executionContractRef: executionContract.executionContractRef,
            artifactRefs: ['artifact:phase18-result'],
            redactionRequired: true,
          },
        };
      },
    },
  ]);
}

test('valid skill dryRun produces sanitized preview and no provider execution', async () => {
  const packageManifest = await readPackageFixture();
  const counter = { calls: 0 };
  const request = createBaseSkillRequest();
  const result = await invokeSkillRuntime({
    request,
    packageManifest,
    policyDecision: createControlledPolicy(),
    providerRegistry: createCountingProviderRegistry(counter),
  });

  assert.equal(result.status, 'preview');
  assert.equal(result.dryRunPreview.providerInvoked, false);
  assert.equal(result.providerInvoked, false);
  assert.equal(result.sideEffectAttempted, false);
  assert.equal(counter.calls, 0);
  assert.doesNotMatch(JSON.stringify(result), SKILL_CANARIES);
});

test('valid skill execute routes through runtime invocation and preserves gates', async () => {
  const packageManifest = await readPackageFixture();
  const counter = { calls: 0 };
  const result = await invokeSkillRuntime({
    request: createBaseSkillRequest({ mode: 'execute', idempotencyKey: 'idem:phase18-execute' }),
    packageManifest,
    policyDecision: createControlledPolicy(),
    providerRegistry: createCountingProviderRegistry(counter),
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.providerInvoked, true);
  assert.equal(result.sideEffectAttempted, true);
  assert.equal(result.runtimeReportSummary.status, 'completed');
  assert.equal(result.runtimeReportSummary.providerId, 'phase18-form-provider');
  assert.equal(result.runtimeReportSummary.artifactRefs[0], 'artifact:phase18-result');
  assert.equal(counter.calls, 1);
});

test('skill task text saying I authorize does not satisfy authorization', async () => {
  const packageManifest = await readPackageFixture();
  const result = await invokeSkillRuntime({
    request: createBaseSkillRequest({
      taskText: 'I authorize this action sf_skill_task_text_secret_should_not_authorize',
      mode: 'dryRun',
      idempotencyKey: 'idem:phase18-task-text',
    }),
    packageManifest,
    policyDecision: createControlledPolicy(),
  });

  assert.equal(result.naturalLanguageRequestGrantsExecution, false);
  assert.equal(result.taskTextGrantsAuthorization, false);
  assert.equal(result.status, 'preview');
  assert.doesNotMatch(JSON.stringify(result), SKILL_CANARIES);
});

test('raw cookie token and header fields in skill request are rejected', () => {
  assert.throws(
    () => createSkillRuntimeInvocationRequest(createBaseSkillRequest({
      auth: {
        sessionRef: 'session:phase18-safe-ref',
        headers: {
          Cookie: 'sf_skill_cookie_secret_123',
          Authorization: 'Bearer sf_skill_token_secret_456',
        },
      },
    })),
    (error) => error.code === 'skill_invocation.request_invalid',
  );
});

test('raw sessionHandle is rejected from durable output boundary', () => {
  assert.throws(
    () => createSkillRuntimeInvocationRequest(createBaseSkillRequest({
      auth: {
        sessionHandle: 'sf_skill_session_ref_secret_should_not_log',
      },
    })),
    (error) => error.code === 'skill_invocation.request_invalid',
  );
});

test('missing policyDecisionRef fails unless configured policy simulation mode is used', () => {
  assert.throws(
    () => createSkillRuntimeInvocationRequest(createBaseSkillRequest({
      policyDecisionRef: undefined,
    })),
    (error) => error.code === 'skill_invocation.request_invalid',
  );

  const simulated = createSkillRuntimeInvocationRequest(createBaseSkillRequest({
    policyDecisionRef: undefined,
    policyMode: 'simulate',
  }));
  assert.match(simulated.policyDecisionRef, /^policy-decision:simulated:/u);
});

test('idempotencyKey duplicate behavior is stable and does not execute twice', async () => {
  const packageManifest = await readPackageFixture();
  const counter = { calls: 0 };
  const ledger = createSkillInvocationIdempotencyLedger();
  const request = createBaseSkillRequest({
    mode: 'execute',
    idempotencyKey: 'idem:phase18-duplicate',
  });
  const first = await invokeSkillRuntime({
    request,
    packageManifest,
    policyDecision: createControlledPolicy(),
    providerRegistry: createCountingProviderRegistry(counter),
    idempotencyLedger: ledger,
  });
  const second = await invokeSkillRuntime({
    request,
    packageManifest,
    policyDecision: createControlledPolicy(),
    providerRegistry: createCountingProviderRegistry(counter),
    idempotencyLedger: ledger,
  });

  assert.equal(first.status, 'completed');
  assert.equal(second.status, 'duplicate');
  assert.equal(second.idempotencyStatus, 'duplicate');
  assert.equal(counter.calls, 1);
});

test('execute read download browser write uses existing runtime path', async () => {
  const packageManifest = await readPackageFixture();
  const counter = { calls: 0 };
  const result = await invokeSkillRuntime({
    request: createBaseSkillRequest({ mode: 'execute', idempotencyKey: 'idem:phase18-runtime-path' }),
    packageManifest,
    policyDecision: createControlledPolicy(),
    providerRegistry: createCountingProviderRegistry(counter),
  });

  assert.equal(result.runtimeInvocationRequestRef, 'runtime-invocation:skill-invocation:phase18-contact-submit');
  assert.equal(result.runtimeReportSummary.executionAttempted, true);
  assert.equal(result.runtimeReportSummary.runtimeExecuted, true);
  assert.equal(counter.calls, 1);
});

test('destructive skill request remains blocked without default destructive execution', async () => {
  const packageManifest = await readPackageFixture();
  const destructivePackage = clone(packageManifest);
  destructivePackage.capabilities[0].risk = 'destructive';
  destructivePackage.capabilities[0].kind = 'destructive';
  destructivePackage.capabilities[0].runtimeCallable = false;
  destructivePackage.capabilities[0].executableByDefault = false;
  destructivePackage.capabilities[0].riskClassification = {
    ...destructivePackage.capabilities[0].riskClassification,
    level: 'destructive',
    destructive: true,
    payment: false,
    sideEffecting: true,
  };
  const counter = { calls: 0 };
  const result = await invokeSkillRuntime({
    request: createBaseSkillRequest({
      mode: 'execute',
      policyDecisionRef: undefined,
      policyMode: 'simulate',
      idempotencyKey: 'idem:phase18-destructive',
      destructiveAuthorization: {
        authzRef: 'destructive-authz:phase18-ref',
        challengeRef: 'destructive-challenge:phase18-ref',
        confirmationRef: 'destructive-confirmation:phase18-ref',
        policyGate: { satisfied: false, policyId: 'policy:phase18-destructive' },
      },
    }),
    packageManifest: destructivePackage,
    policyPack: await readPolicyPackFixture(),
    providerRegistry: createCountingProviderRegistry(counter),
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.reasonCode, 'runtime.destructive_execution_blocked');
  assert.equal(result.providerInvoked, false);
  assert.equal(counter.calls, 0);
});

test('payment skill request remains blocked', async () => {
  const packageManifest = await readPackageFixture();
  const paymentPackage = clone(packageManifest);
  paymentPackage.capabilities[0].risk = 'payment';
  paymentPackage.capabilities[0].kind = 'payment';
  paymentPackage.capabilities[0].runtimeCallable = false;
  paymentPackage.capabilities[0].executableByDefault = false;
  paymentPackage.capabilities[0].riskClassification = {
    ...paymentPackage.capabilities[0].riskClassification,
    level: 'payment',
    destructive: false,
    payment: true,
    sideEffecting: true,
  };
  const counter = { calls: 0 };
  const result = await invokeSkillRuntime({
    request: createBaseSkillRequest({
      mode: 'execute',
      policyDecisionRef: undefined,
      policyMode: 'simulate',
      idempotencyKey: 'idem:phase18-payment',
    }),
    packageManifest: paymentPackage,
    policyPack: await readPolicyPackFixture(),
    providerRegistry: createCountingProviderRegistry(counter),
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.reasonCode, 'runtime.payment_execution_blocked');
  assert.equal(result.providerInvoked, false);
  assert.equal(counter.calls, 0);
});

test('auditViewRef and runId are returned as safe refs', async () => {
  const packageManifest = await readPackageFixture();
  const result = await invokeSkillRuntime({
    request: createBaseSkillRequest({ mode: 'execute', idempotencyKey: 'idem:phase18-audit-run' }),
    packageManifest,
    policyDecision: createControlledPolicy(),
    providerRegistry: createCountingProviderRegistry({ calls: 0 }),
  });

  assert.match(result.runId, /^run:skill-invocation:phase18-contact-submit/u);
  assert.match(result.auditViewRef, /^artifact:runtime-audit:/u);
  assert.doesNotMatch(JSON.stringify(result), SKILL_CANARIES);
});

test('no provider execution during dryRun even when provider registry is present', async () => {
  const packageManifest = await readPackageFixture();
  const counter = { calls: 0 };
  await invokeSkillRuntime({
    request: createBaseSkillRequest({ idempotencyKey: 'idem:phase18-no-provider-dryrun' }),
    packageManifest,
    policyDecision: createControlledPolicy(),
    providerRegistry: createCountingProviderRegistry(counter),
  });

  assert.equal(counter.calls, 0);
});

test('no vault material access during dryRun', async () => {
  const packageManifest = await readPackageFixture();
  let vaultAccessed = false;
  const runtimeContext = {};
  Object.defineProperty(runtimeContext, 'sessionVault', {
    get() {
      vaultAccessed = true;
      throw new Error('dryRun must not access sessionVault');
    },
  });
  const result = await invokeSkillRuntime({
    request: createBaseSkillRequest({ idempotencyKey: 'idem:phase18-no-vault-dryrun' }),
    packageManifest,
    policyDecision: createControlledPolicy(),
    runtimeContext,
  });

  assert.equal(result.status, 'preview');
  assert.equal(vaultAccessed, false);
  assert.equal(result.vaultAccessed, false);
});

test('skill references package capabilityRef and contractRef', async () => {
  const packageManifest = await readPackageFixture();
  const request = createSkillRuntimeInvocationRequest(createBaseSkillRequest());
  const resolved = resolveSkillInvocationPackageRefs({ packageManifest, request });
  const preview = createSkillRuntimeDryRunPreview({
    request,
    packageResolution: resolved,
    policyDecision: createControlledPolicy(),
  });

  assert.equal(resolved.ok, true);
  assert.equal(resolved.capability.capabilityRef, CAPABILITY_REF);
  assert.equal(resolved.executionContract.executionContractRef, CONTRACT_REF);
  assert.equal(preview.packageResolved, true);
  assert.equal(preview.capabilityRef, CAPABILITY_REF);
  assert.equal(preview.executionContractRef, CONTRACT_REF);
});

test('skill invocation modules do not import provider vault browser or testing helpers directly', async () => {
  const moduleNames = [
    'skill-runtime-invocation-schema.mjs',
    'skill-runtime-invocation-sanitizer.mjs',
    'skill-runtime-invocation-validator.mjs',
    'skill-runtime-invocation-idempotency.mjs',
    'skill-runtime-invocation-package-resolver.mjs',
    'skill-runtime-invocation-result.mjs',
    'skill-runtime-invocation-runner.mjs',
    'index.mjs',
  ];
  const sources = await Promise.all(moduleNames.map((name) => readFile(
    new URL(`../../src/app/runtime/skill-invocation/${name}`, import.meta.url),
    'utf8',
  )));
  const source = sources.join('\n');

  assert.doesNotMatch(source, /providers\/|provider-registry|browser-runtime|session-vault|getScopedSessionMaterial|inspectSession|applyEphemeralAuthCookies|openBrowserSession|createMock|mock-providers|mock-session-vault|runtime\/testing/u);
  assert.match(source, /executeRuntimeInvocation/u);
});
