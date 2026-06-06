import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import {
  createRuntimeInvocationRequest,
} from '../../src/app/planner/index.mjs';
import {
  createBrowserActionProvider,
  createApiReadProvider,
  createProductionRuntimeProviderRegistry,
  executeRuntimeInvocation,
} from '../../src/app/runtime/index.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../src/domain/policies/execution/index.mjs';
import {
  applyDefaultProductionRuntimeProviderRegistry,
} from '../../src/entrypoints/build/run-build.mjs';

function createRequest({
  capabilityId = 'capability:synthetic:read-catalog',
  executionContractRef = 'execution-contract:synthetic-read-catalog',
  policyDecisionRef = 'policy:synthetic-read-catalog',
  verdictHint = 'allow',
  requiredGates = [],
} = {}) {
  return createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: 'synthetic.example',
      capabilityId,
      executionContractRef,
      planId: `plan:${capabilityId.replace(/[^a-z0-9:_-]+/giu, '-')}`,
    },
    executionContractRef,
    policyDecisionRef,
    verdictHint,
    requiredGates,
  });
}

function createPolicy({
  capabilityId = 'capability:synthetic:read-catalog',
  executionContractRef = 'execution-contract:synthetic-read-catalog',
  verdict = 'allow',
  gates = [],
  gateStatus = null,
  siteAdapterInvocationAllowed = true,
  downloaderInvocationAllowed = false,
} = {}) {
  return createGovernedExecutionPolicyDecision({
    executionId: `execution:${capabilityId.replace(/[^a-z0-9:_-]+/giu, '-')}`,
    capabilityId,
    executionContractRef,
    verdict,
    gates,
    gateStatus,
    runtimeDispatchAllowed: verdict !== 'blocked',
    siteAdapterInvocationAllowed,
    downloaderInvocationAllowed,
    auditRequired: gates.includes('audit_required'),
  });
}

function assertSafeReport(report) {
  assert.doesNotMatch(
    JSON.stringify(report),
    /Bearer|set-cookie|Authorization|rawRequestBody|rawResponseBody|requestBody|responseBody|browserProfilePath|userDataDir|session material|cookie|credential|private fixture value|raw DOM|querySelector/iu,
  );
}

function browserActionContract(overrides = {}) {
  return {
    capabilityKind: 'write',
    operationKind: 'form_or_action',
    contractKind: 'form_or_action',
    runtimeBindingRef: 'runtime-binding:synthetic-browser-action',
    runtimeBinding: { kind: 'browser_bridge' },
    requestSchemaRef: 'schema:synthetic-browser-action:request',
    browserActionDescriptor: {
      selector: '[data-siteforge-action="contact-form"]',
      actionRef: 'action:fixture-contact-submit',
      routeRef: 'route:fixture-contact',
      requiredSlots: ['message'],
      ...(overrides.browserActionDescriptor ?? {}),
    },
    payloadTemplate: {
      material: 'template_only',
      redactionRequired: true,
      savedMaterial: 'sanitized_summary_only',
      slotBindings: [
        { name: 'message', type: 'string', required: true },
      ],
      steps: [
        {
          kind: 'form_submit',
          selector: '[data-siteforge-action="contact-form"]',
          actionRef: 'action:fixture-contact-submit',
          routeRef: 'route:fixture-contact',
          submit: true,
          finalSubmit: false,
          autoExecute: false,
          savedMaterial: 'sanitized_summary_only',
        },
      ],
      ...(overrides.payloadTemplate ?? {}),
    },
    ...overrides,
  };
}

test('CLI build options inject production registry factory only for task execution', () => {
  const injected = applyDefaultProductionRuntimeProviderRegistry({
    executionTask: 'search products',
    execute: true,
  });
  assert.equal(typeof injected.runtimeProviderRegistryFactory, 'function');
  assert.equal(injected.runtimeProviderRegistry, undefined);

  const registry = injected.runtimeProviderRegistryFactory();
  assert.equal(registry.resolve({
    invocationRequest: { capabilityId: 'capability:synthetic:search-products' },
    executionContract: {
      capabilityKind: 'read',
      operationKind: 'api_request',
    },
  })?.id, 'api_read_provider');
  assert.equal(registry.resolve({
    invocationRequest: { capabilityId: 'capability:synthetic:download-report' },
    executionContract: {
      capabilityKind: 'download',
      operationKind: 'download',
    },
  })?.id, 'download_provider');
  assert.equal(registry.resolve({
    invocationRequest: { capabilityId: 'capability:synthetic:submit-contact' },
    executionContract: browserActionContract(),
  })?.id, 'browser_action_provider');

  assert.equal(
    applyDefaultProductionRuntimeProviderRegistry({ executionTask: 'search products' }).runtimeProviderRegistryFactory,
    undefined,
  );
  assert.equal(
    applyDefaultProductionRuntimeProviderRegistry({ execute: true }).runtimeProviderRegistryFactory,
    undefined,
  );
});

test('CLI production registry factory injection preserves explicit runtime providers', () => {
  const explicitRegistry = { resolve() { return null; } };
  const withRegistry = applyDefaultProductionRuntimeProviderRegistry({
    executionTask: 'search products',
    execute: true,
    runtimeProviderRegistry: explicitRegistry,
  });
  assert.equal(withRegistry.runtimeProviderRegistry, explicitRegistry);
  assert.equal(withRegistry.runtimeProviderRegistryFactory, undefined);

  const explicitFactory = () => explicitRegistry;
  const withFactory = applyDefaultProductionRuntimeProviderRegistry({
    executionTask: 'search products',
    execute: true,
    runtimeProviderRegistryFactory: explicitFactory,
  });
  assert.equal(withFactory.runtimeProviderRegistryFactory, explicitFactory);
  assert.equal(withFactory.runtimeProviderRegistry, undefined);
});

test('api_read_provider executes descriptor-only read/API tasks with sanitized summary', async () => {
  const request = createRequest();
  const policyDecision = createPolicy();

  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract: {
      capabilityKind: 'read',
      operationKind: 'api_request',
      contractKind: 'api_request',
      requestSchemaRef: 'schema:synthetic-read:request',
      runtimeBindingRef: 'runtime-binding:synthetic-read',
      runtimeBoundary: 'app/runtime',
      descriptorOnly: true,
      redactionRequired: true,
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(report.status, 'completed');
  assert.equal(report.providerId, 'api_read_provider');
  assert.equal(report.providerInvoked, true);
  assert.equal(report.executionAttempted, true);
  assert.equal(report.sideEffectAttempted, true);
  assert.equal(report.sideEffectSucceeded, true);
  assert.equal(report.resultSummary.outcome, 'api_read_completed');
  assert.equal(report.resultSummary.runtimeMode, 'descriptor_only_read');
  assert.deepEqual(report.artifactRefs, []);
  assertSafeReport(report);
});

test('api_read_provider rejects write download payment and destructive descriptors', async () => {
  const provider = createApiReadProvider();
  for (const descriptor of [
    { executionContract: { capabilityKind: 'write', operationKind: 'form_or_action' } },
    { executionContract: { capabilityKind: 'download', operationKind: 'download' } },
    { executionContract: { capabilityKind: 'read', paymentOrFundsAction: true } },
    { executionContract: { capabilityKind: 'read', destructiveAction: true } },
  ]) {
    assert.equal(provider.supports(descriptor), false);
    assert.deepEqual(provider.canExecute(descriptor), {
      allowed: false,
      reasonCode: 'runtime.api_read_provider_unsupported',
    });
  }
});

test('download_provider blocks without approved output gate or policy', async () => {
  const request = createRequest({
    capabilityId: 'capability:synthetic:download-report',
    executionContractRef: 'execution-contract:synthetic-download-report',
    policyDecisionRef: 'policy:synthetic-download-report',
  });
  const policyDecision = createPolicy({
    capabilityId: 'capability:synthetic:download-report',
    executionContractRef: 'execution-contract:synthetic-download-report',
    downloaderInvocationAllowed: true,
    siteAdapterInvocationAllowed: false,
  });

  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract: {
      capabilityKind: 'download',
      operationKind: 'download',
      contractKind: 'download',
      runtimeBindingRef: 'runtime-binding:synthetic-download',
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(report.status, 'provider_not_executable');
  assert.equal(report.providerId, 'download_provider');
  assert.equal(report.providerInvoked, false);
  assert.equal(report.executionAttempted, false);
  assert.equal(report.sideEffectAttempted, false);
  assert.equal(report.blockedReason, 'runtime.download_output_policy_required');
  assertSafeReport(report);
});

test('download_provider writes only controlled artifact output when output gate is satisfied', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'siteforge-controlled-download-'));
  try {
    const request = createRequest({
      capabilityId: 'capability:synthetic:download-report',
      executionContractRef: 'execution-contract:synthetic-download-report',
      policyDecisionRef: 'policy:synthetic-download-report',
      verdictHint: 'controlled',
      requiredGates: ['output_path_required'],
    });
    const gateStatus = {
      allSatisfied: true,
      output_path_required: { satisfied: true },
    };
    const policyDecision = createPolicy({
      capabilityId: 'capability:synthetic:download-report',
      executionContractRef: 'execution-contract:synthetic-download-report',
      verdict: 'controlled',
      gates: ['output_path_required'],
      gateStatus,
      downloaderInvocationAllowed: true,
      siteAdapterInvocationAllowed: false,
    });

    const report = await executeRuntimeInvocation({
      invocationRequest: request,
      policyDecision,
      gateStatus,
      executionContract: {
        capabilityKind: 'download',
        operationKind: 'download',
        contractKind: 'download',
        runtimeBindingRef: 'runtime-binding:synthetic-download',
      },
      runtimeContext: {
        outputDir,
        downloadFilename: 'catalog-export.txt',
        fixtureText: 'controlled fixture export\n',
      },
      providerRegistry: createProductionRuntimeProviderRegistry(),
    });

    const written = await readFile(path.join(outputDir, 'catalog-export.txt'));
    const checksum = createHash('sha256').update(written).digest('hex');
    const download = report.resultSummary.downloads[0];

    assert.equal(report.status, 'completed');
    assert.equal(report.providerId, 'download_provider');
    assert.equal(report.executionAttempted, true);
    assert.equal(report.sideEffectAttempted, true);
    assert.equal(report.sideEffectSucceeded, true);
    assert.deepEqual(report.artifactRefs, ['artifact:runtime-download:catalog-export.txt']);
    assert.equal(download.artifactRef, 'artifact:runtime-download:catalog-export.txt');
    assert.equal(download.filename, 'catalog-export.txt');
    assert.equal(download.hash, checksum);
    assert.equal(download.checksum, checksum);
    assert.equal(download.byteSize, written.byteLength);
    assert.equal(download.mimeType, 'text/plain');
    assertSafeReport(report);
    assert.doesNotMatch(JSON.stringify(report), new RegExp(outputDir.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('download_provider ignores persisted contract inline content', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'siteforge-controlled-download-contract-'));
  try {
    const request = createRequest({
      capabilityId: 'capability:synthetic:download-report',
      executionContractRef: 'execution-contract:synthetic-download-report',
      policyDecisionRef: 'policy:synthetic-download-report',
      verdictHint: 'controlled',
      requiredGates: ['output_path_required'],
    });
    const gateStatus = {
      allSatisfied: true,
      output_path_required: { satisfied: true },
    };
    const policyDecision = createPolicy({
      capabilityId: 'capability:synthetic:download-report',
      executionContractRef: 'execution-contract:synthetic-download-report',
      verdict: 'controlled',
      gates: ['output_path_required'],
      gateStatus,
      downloaderInvocationAllowed: true,
      siteAdapterInvocationAllowed: false,
    });

    const report = await executeRuntimeInvocation({
      invocationRequest: request,
      policyDecision,
      gateStatus,
      executionContract: {
        capabilityKind: 'download',
        operationKind: 'download',
        contractKind: 'download',
        runtimeBindingRef: 'runtime-binding:synthetic-download',
        downloadDescriptor: {
          filename: 'contract-export.txt',
          fixtureText: 'contract inline content must be ignored\n',
        },
      },
      runtimeContext: {
        outputDir,
      },
      providerRegistry: createProductionRuntimeProviderRegistry(),
    });

    const written = await readFile(path.join(outputDir, 'contract-export.txt'), 'utf8');
    assert.equal(report.status, 'completed');
    assert.equal(written, 'SiteForge controlled runtime download fixture\n');
    assert.doesNotMatch(written, /contract inline content/u);
    assertSafeReport(report);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('download_provider rejects path traversal before side effects', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'siteforge-download-traversal-'));
  try {
    const request = createRequest({
      capabilityId: 'capability:synthetic:download-report',
      executionContractRef: 'execution-contract:synthetic-download-report',
      policyDecisionRef: 'policy:synthetic-download-report',
    });
    const policyDecision = createPolicy({
      capabilityId: 'capability:synthetic:download-report',
      executionContractRef: 'execution-contract:synthetic-download-report',
      downloaderInvocationAllowed: true,
      siteAdapterInvocationAllowed: false,
    });

    const report = await executeRuntimeInvocation({
      invocationRequest: request,
      policyDecision,
      executionContract: {
        capabilityKind: 'download',
        operationKind: 'download',
        contractKind: 'download',
        runtimeBindingRef: 'runtime-binding:synthetic-download',
      },
      runtimeContext: {
        outputPolicy: { approved: true },
        outputDir,
        downloadFilename: '../escape.txt',
      },
      providerRegistry: createProductionRuntimeProviderRegistry(),
    });

    assert.equal(report.status, 'provider_not_executable');
    assert.equal(report.providerId, 'download_provider');
    assert.equal(report.executionAttempted, false);
    assert.equal(report.sideEffectAttempted, false);
    assert.equal(report.blockedReason, 'runtime.download_path_traversal_rejected');
    assertSafeReport(report);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('browser_action_provider executes only explicit controlled fixture descriptors', async () => {
  const request = createRequest({
    capabilityId: 'capability:synthetic:submit-contact',
    executionContractRef: 'execution-contract:synthetic-submit-contact',
    policyDecisionRef: 'policy:synthetic-submit-contact',
  });
  const policyDecision = createPolicy({
    capabilityId: 'capability:synthetic:submit-contact',
    executionContractRef: 'execution-contract:synthetic-submit-contact',
  });

  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract: browserActionContract(),
    runtimeContext: {
      localFixture: true,
      slotValues: {
        message: 'private fixture value that must not persist',
      },
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(report.status, 'completed');
  assert.equal(report.providerId, 'browser_action_provider');
  assert.equal(report.providerInvoked, true);
  assert.equal(report.executionAttempted, true);
  assert.equal(report.sideEffectAttempted, true);
  assert.equal(report.sideEffectSucceeded, true);
  assert.equal(report.resultSummary.outcome, 'browser_action_completed');
  assert.equal(report.resultSummary.runtimeMode, 'controlled_fixture_browser_action');
  assert.deepEqual(report.resultSummary.slotNames, ['message']);
  assert.equal(report.resultSummary.actionRef, 'action:fixture-contact-submit');
  assert.equal(report.resultSummary.routeRef, 'route:fixture-contact');
  assert.equal(report.resultSummary.payloadTemplate.material, 'template_only');
  assertSafeReport(report);
});

test('browser_action_provider blocks uncontrolled runtime before side effects', async () => {
  const request = createRequest({
    capabilityId: 'capability:synthetic:submit-contact',
    executionContractRef: 'execution-contract:synthetic-submit-contact',
    policyDecisionRef: 'policy:synthetic-submit-contact',
  });
  const policyDecision = createPolicy({
    capabilityId: 'capability:synthetic:submit-contact',
    executionContractRef: 'execution-contract:synthetic-submit-contact',
  });

  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision,
    executionContract: browserActionContract(),
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });

  assert.equal(report.status, 'provider_not_executable');
  assert.equal(report.providerId, 'browser_action_provider');
  assert.equal(report.providerInvoked, false);
  assert.equal(report.executionAttempted, false);
  assert.equal(report.sideEffectAttempted, false);
  assert.equal(report.blockedReason, 'runtime.browser_action_uncontrolled_site');
  assertSafeReport(report);
});

test('browser_action_provider blocks non-concrete descriptors without guessing selectors or actions', async () => {
  const provider = createBrowserActionProvider();
  const baseRuntimeContext = {
    localFixture: true,
    slotValues: { message: 'private fixture value that must not persist' },
  };
  const cases = [
    {
      name: 'missing selector',
      contract: browserActionContract({
        browserActionDescriptor: { selector: null },
        payloadTemplate: {
          steps: [{ kind: 'form_submit', buttonText: 'Send message' }],
        },
      }),
    },
    {
      name: 'missing route action ref',
      contract: browserActionContract({
        browserActionDescriptor: { actionRef: null, routeRef: null },
        payloadTemplate: {
          steps: [{ kind: 'form_submit', selector: '[data-siteforge-action="contact-form"]' }],
        },
      }),
    },
    {
      name: 'missing required slot value',
      contract: browserActionContract(),
      runtimeContext: { localFixture: true, slotValues: {} },
    },
    {
      name: 'missing payload template',
      contract: browserActionContract({ payloadTemplate: null }),
    },
    {
      name: 'missing slot binding coverage',
      contract: browserActionContract({
        browserActionDescriptor: { requiredSlots: ['message', 'email'] },
      }),
    },
  ];

  for (const scenario of cases) {
    assert.equal(provider.supports({ executionContract: scenario.contract }), true, scenario.name);
    assert.deepEqual(
      provider.canExecute({
        executionContract: scenario.contract,
        runtimeContext: scenario.runtimeContext ?? baseRuntimeContext,
      }),
      {
        allowed: false,
        reasonCode: 'runtime.contract_not_concrete_enough',
      },
      scenario.name,
    );
  }
});

test('browser_action_provider is side-effect-free before run and does not expose heuristic browser code', async () => {
  const providerSource = await readFile(new URL('../../src/app/runtime/providers/browser-action-provider.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(providerSource, /\b(?:querySelector|querySelectorAll|innerText|textContent|click\s*\(|submit\s*\(|goto\s*\(|navigate\s*\(|writeFile|readFile|mkdir)\b/u);

  const provider = createBrowserActionProvider();
  assert.equal(provider.supports({
    executionContract: browserActionContract({ destructiveAction: true }),
  }), false);
  assert.equal(provider.supports({
    executionContract: browserActionContract({ paymentOrFundsAction: true }),
  }), false);
  assert.deepEqual(provider.canExecute({
    executionContract: browserActionContract({ destructiveAction: true }),
    runtimeContext: {
      localFixture: true,
      slotValues: { message: 'private fixture value that must not persist' },
    },
  }), {
    allowed: false,
    reasonCode: 'runtime.browser_action_provider_unsupported',
  });
});

test('production registry preserves specific payment destructive blocks and resolves browser write actions', async () => {
  const cases = [
    {
      contract: { capabilityKind: 'read', operationKind: 'api_request', paymentOrFundsAction: true },
      reason: 'runtime.payment_execution_blocked',
    },
    {
      contract: { capabilityKind: 'read', operationKind: 'api_request', destructiveAction: true },
      reason: 'runtime.destructive_execution_blocked',
    },
  ];
  for (const { contract, reason } of cases) {
    const request = createRequest({
      capabilityId: 'capability:synthetic:unsupported-action',
      executionContractRef: 'execution-contract:synthetic-unsupported-action',
      policyDecisionRef: 'policy:synthetic-unsupported-action',
    });
    const policyDecision = createPolicy({
      capabilityId: 'capability:synthetic:unsupported-action',
      executionContractRef: 'execution-contract:synthetic-unsupported-action',
    });

    const report = await executeRuntimeInvocation({
      invocationRequest: request,
      policyDecision,
      executionContract: contract,
      providerRegistry: createProductionRuntimeProviderRegistry(),
    });

    assert.equal(report.status, 'blocked');
    assert.equal(report.blockedReason, reason);
    assert.equal(report.providerInvoked, false);
    assert.equal(report.sideEffectAttempted, false);
  }

  assert.equal(createProductionRuntimeProviderRegistry().resolve({
    executionContract: browserActionContract(),
  })?.id, 'browser_action_provider');
});
