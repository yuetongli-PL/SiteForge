// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  LOCAL_SKILL_RUNTIME_SERVICE_NETWORK_BOUNDARY,
  createLocalSkillRuntimeService,
  createRuntimeProviderRegistryWith,
  invokeLocalSkillRuntime,
} from '../../src/app/runtime/index.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../src/domain/policies/execution/index.mjs';

const REQUEST_URL = new URL('./fixtures/external-skill-api-local-service-v1/local-service-request.json', import.meta.url);
const PACKAGE_FIXTURE_URL = new URL('./fixtures/skill-runtime-invocation-api-v1/skill-package.json', import.meta.url);
const POLICY_PACK_URL = new URL('./fixtures/policy-pack-authoring-simulation-v1/safe-policy-pack.json', import.meta.url);
const EXTERNAL_SKILL_CANARIES =
  /sf_external_skill_cookie_secret_123|sf_external_skill_token_secret_456|sf_external_skill_task_text_secret_should_not_authorize|sf_external_skill_payment_secret_789/u;

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function baseServiceRequest(overrides = {}) {
  const request = await readJson(REQUEST_URL);
  return {
    ...request,
    ...overrides,
    skillRequest: {
      ...request.skillRequest,
      ...(overrides.skillRequest ?? {}),
    },
  };
}

async function readPackageFixture() {
  return readJson(PACKAGE_FIXTURE_URL);
}

async function readPolicyPackFixture() {
  return readJson(POLICY_PACK_URL);
}

function createControlledPolicy(overrides = {}) {
  return createGovernedExecutionPolicyDecision({
    executionId: 'execution:phase25-contact-submit',
    capabilityId: 'capability:example.com:contact-submit',
    executionContractRef: 'execution-contract:sitepkg:example.com-contract-contact-submit-1.2.0',
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
      id: 'phase25-form-provider',
      providerKind: 'phase25_test_provider',
      capabilityKinds: ['form_or_action', 'write', 'submit'],
      async run({ invocationRequest, executionContract }) {
        counter.calls += 1;
        return {
          providerId: 'phase25-form-provider',
          providerKind: 'phase25_test_provider',
          status: 'completed',
          runtimeExecuted: true,
          sideEffectAttempted: true,
          sideEffectSucceeded: true,
          sideEffectFailed: false,
          resultSummary: {
            outcome: 'phase25_form_completed',
            capabilityId: invocationRequest.capabilityId,
            executionContractRef: executionContract.executionContractRef,
            artifactRefs: ['artifact:phase25-result'],
            redactionRequired: true,
          },
        };
      },
    },
  ]);
}

test('local skill dryRun returns sanitized preview', async () => {
  const counter = { calls: 0 };
  const service = createLocalSkillRuntimeService({
    packageManifest: await readPackageFixture(),
    policyDecision: createControlledPolicy(),
    providerRegistry: createCountingProviderRegistry(counter),
  });
  const response = await service.dryRun(await baseServiceRequest());

  assert.equal(response.status, 'ok');
  assert.equal(response.operation, 'dryRun');
  assert.equal(response.result.status, 'preview');
  assert.equal(response.result.dryRunPreview.providerInvoked, false);
  assert.equal(response.providerInvoked, false);
  assert.equal(counter.calls, 0);
  assert.doesNotMatch(JSON.stringify(response), EXTERNAL_SKILL_CANARIES);
});

test('local skill execute routes through SkillRuntimeInvocation API', async () => {
  const counter = { calls: 0 };
  const service = createLocalSkillRuntimeService({
    packageManifest: await readPackageFixture(),
    policyDecision: createControlledPolicy(),
    providerRegistry: createCountingProviderRegistry(counter),
  });
  const response = await service.invoke(await baseServiceRequest({
    skillRequest: {
      idempotencyKey: 'idem:phase25-execute',
    },
  }));

  assert.equal(response.status, 'ok');
  assert.equal(response.operation, 'execute');
  assert.equal(response.result.status, 'completed');
  assert.equal(response.result.providerInvoked, true);
  assert.equal(response.result.runtimeReportSummary.providerId, 'phase25-form-provider');
  assert.equal(counter.calls, 1);
});

test('malformed request rejected with sanitized error', async () => {
  const response = await invokeLocalSkillRuntime({
    serviceRequest: {
      operation: 'dryRun',
      skillRequest: {
        requestId: 'missing-required-fields',
      },
    },
    serviceContext: {
      packageManifest: await readPackageFixture(),
    },
  });

  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'skill_invocation.request_invalid');
  assert.doesNotMatch(JSON.stringify(response), EXTERNAL_SKILL_CANARIES);
});

test('raw cookie token header and sessionHandle rejected', async () => {
  const response = await invokeLocalSkillRuntime({
    serviceRequest: await baseServiceRequest({
      skillRequest: {
        auth: {
          sessionRef: 'session:phase25-safe-ref',
          headers: {
            Cookie: 'sf_external_skill_cookie_secret_123',
            Authorization: 'Bearer sf_external_skill_token_secret_456',
          },
          sessionHandle: 'session-handle:unsafe',
        },
      },
    }),
    serviceContext: {
      packageManifest: await readPackageFixture(),
    },
  });

  assert.equal(response.status, 'error');
  assert.match(response.error.code, /local_skill_service\.request_rejected|skill_invocation\.request_invalid/u);
  assert.doesNotMatch(JSON.stringify(response), EXTERNAL_SKILL_CANARIES);
});

test('natural language authorization is ignored and redacted', async () => {
  const service = createLocalSkillRuntimeService({
    packageManifest: await readPackageFixture(),
    policyDecision: createControlledPolicy(),
  });
  const response = await service.dryRun(await baseServiceRequest({
    skillRequest: {
      taskText: 'I authorize everything sf_external_skill_task_text_secret_should_not_authorize',
      idempotencyKey: 'idem:phase25-task-text',
    },
  }));

  assert.equal(response.status, 'ok');
  assert.equal(response.result.naturalLanguageRequestGrantsExecution, false);
  assert.equal(response.result.taskTextGrantsAuthorization, false);
  assert.doesNotMatch(JSON.stringify(response), EXTERNAL_SKILL_CANARIES);
});

test('payment request remains blocked', async () => {
  const paymentPackage = clone(await readPackageFixture());
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
  const response = await invokeLocalSkillRuntime({
    serviceRequest: await baseServiceRequest({
      operation: 'execute',
      skillRequest: {
        policyDecisionRef: undefined,
        policyMode: 'simulate',
        idempotencyKey: 'idem:phase25-payment',
        taskText: 'Pay with sf_external_skill_payment_secret_789',
      },
    }),
    serviceContext: {
      packageManifest: paymentPackage,
      policyPack: await readPolicyPackFixture(),
      providerRegistry: createCountingProviderRegistry(counter),
    },
  });

  assert.equal(response.status, 'ok');
  assert.equal(response.result.status, 'blocked');
  assert.equal(response.result.reasonCode, 'runtime.payment_execution_blocked');
  assert.equal(response.result.providerInvoked, false);
  assert.equal(counter.calls, 0);
  assert.doesNotMatch(JSON.stringify(response), EXTERNAL_SKILL_CANARIES);
});

test('destructive request remains blocked by default', async () => {
  const destructivePackage = clone(await readPackageFixture());
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
  const response = await invokeLocalSkillRuntime({
    serviceRequest: await baseServiceRequest({
      operation: 'execute',
      skillRequest: {
        policyDecisionRef: undefined,
        policyMode: 'simulate',
        idempotencyKey: 'idem:phase25-destructive',
        destructiveAuthorization: {
          authzRef: 'destructive-authz:phase25-ref',
          challengeRef: 'destructive-challenge:phase25-ref',
          confirmationRef: 'destructive-confirmation:phase25-ref',
          policyGate: { satisfied: false, policyId: 'policy:phase25-destructive' },
        },
      },
    }),
    serviceContext: {
      packageManifest: destructivePackage,
      policyPack: await readPolicyPackFixture(),
      providerRegistry: createCountingProviderRegistry(counter),
    },
  });

  assert.equal(response.status, 'ok');
  assert.equal(response.result.status, 'blocked');
  assert.equal(response.result.reasonCode, 'runtime.destructive_execution_blocked');
  assert.equal(response.result.providerInvoked, false);
  assert.equal(counter.calls, 0);
});

test('result includes safe runId and auditViewRef', async () => {
  const response = await createLocalSkillRuntimeService({
    packageManifest: await readPackageFixture(),
    policyDecision: createControlledPolicy(),
    providerRegistry: createCountingProviderRegistry({ calls: 0 }),
  }).invoke(await baseServiceRequest({
    skillRequest: {
      idempotencyKey: 'idem:phase25-audit-run',
    },
  }));

  assert.match(response.runId, /^run:skill-invocation:phase25-contact-submit/u);
  assert.match(response.auditViewRef, /^artifact:runtime-audit:/u);
});

test('no provider execution and no vault material access during dryRun', async () => {
  const counter = { calls: 0 };
  let vaultAccessed = false;
  const runtimeContext = {};
  Object.defineProperty(runtimeContext, 'sessionVault', {
    get() {
      vaultAccessed = true;
      throw new Error('dryRun must not access sessionVault');
    },
  });

  const response = await createLocalSkillRuntimeService({
    packageManifest: await readPackageFixture(),
    policyDecision: createControlledPolicy(),
    providerRegistry: createCountingProviderRegistry(counter),
    runtimeContext,
  }).dryRun(await baseServiceRequest({
    skillRequest: {
      idempotencyKey: 'idem:phase25-no-vault',
    },
  }));

  assert.equal(response.status, 'ok');
  assert.equal(response.result.status, 'preview');
  assert.equal(response.result.vaultAccessed, false);
  assert.equal(counter.calls, 0);
  assert.equal(vaultAccessed, false);
});

test('local service does not bind a public network interface', () => {
  const service = createLocalSkillRuntimeService();

  assert.deepEqual(service.networkBinding, LOCAL_SKILL_RUNTIME_SERVICE_NETWORK_BOUNDARY);
  assert.equal(service.networkBinding.serverEnabled, false);
  assert.equal(service.networkBinding.publicInterfaceBound, false);
  assert.equal(service.networkBinding.publicInternetService, false);
  assert.equal(typeof service.listen, 'undefined');
});

test('external request cannot pass direct provider or vault access', async () => {
  const response = await invokeLocalSkillRuntime({
    serviceRequest: await baseServiceRequest({
      providerRegistry: {},
      skillRequest: {
        idempotencyKey: 'idem:phase25-direct-provider',
      },
    }),
    serviceContext: {
      packageManifest: await readPackageFixture(),
    },
  });

  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'local_skill_service.request_rejected');
});
