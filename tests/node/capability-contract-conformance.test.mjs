import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  createRuntimeInvocationRequest,
} from '../../src/app/planner/index.mjs';
import {
  API_READ_PROVIDER_ID,
  BROWSER_ACTION_PROVIDER_ID,
  DOWNLOAD_PROVIDER_ID,
  RUNTIME_AUTH_REASONS,
  RUNTIME_REASONS,
  createProductionRuntimeProviderRegistry,
  createRuntimeAuditRecorder,
  createRuntimeProviderRegistryWith,
  executeRuntimeInvocation,
} from '../../src/app/runtime/index.mjs';
import {
  createMockSessionVault,
} from '../../src/app/runtime/testing.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../src/domain/policies/execution/index.mjs';

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'capability-contract-conformance',
);
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUTH_SESSION_HANDLE = 'sf_test_session_handle_secret_should_not_log';
const AUTH_TOKEN = 'sf_test_secret_token_123';

const EXPECTED_FIXTURE_NAMES = Object.freeze([
  'api-read',
  'query-read-form',
  'download-allowed',
  'download-missing-output-gate',
  'download-path-traversal',
  'download-outside-output-dir',
  'browser-write-controlled-local-fixture',
  'browser-write-controlled-runtime',
  'browser-write-uncontrolled',
  'browser-write-missing-selector',
  'browser-write-missing-action-ref',
  'browser-write-missing-required-slot',
  'browser-write-incomplete-payload-coverage',
  'payment',
  'destructive',
  'destructive-confirm-alone',
]);

function safeIdPart(value) {
  return String(value ?? 'fixture')
    .replace(/[^a-z0-9:_-]+/giu, '-')
    .replace(/^-+|-+$/gu, '')
    || 'fixture';
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertPathMissing(filePath, message) {
  assert.equal(await pathExists(filePath), false, message);
}

async function assertDirectoryEmptyOrMissing(directoryPath, message) {
  if (!await pathExists(directoryPath)) {
    return;
  }
  assert.deepEqual(await readdir(directoryPath), [], message);
}

async function loadFixtures() {
  const files = (await readdir(FIXTURE_DIR))
    .filter((file) => file.endsWith('.json'))
    .sort();
  const fixtures = [];
  for (const file of files) {
    fixtures.push(JSON.parse(await readFile(path.join(FIXTURE_DIR, file), 'utf8')));
  }
  return fixtures.sort((left, right) => left.name.localeCompare(right.name, 'en'));
}

function interpolate(value, replacements) {
  if (typeof value === 'string') {
    return value.replace(/\{\{([a-zA-Z0-9_]+)\}\}/gu, (_, key) => replacements[key] ?? `{{${key}}}`);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => interpolate(entry, replacements));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      interpolate(entry, replacements),
    ]));
  }
  return value;
}

function createRequestFromFixture(fixture) {
  const request = fixture.request ?? {};
  const capabilityId = request.capabilityId ?? fixture.capability?.id ?? `capability:conformance:${fixture.name}`;
  const executionContractRef = request.executionContractRef
    ?? fixture.executionContract?.executionContractRef
    ?? `execution-contract:conformance:${fixture.name}`;
  const policyDecisionRef = request.policyDecisionRef ?? `policy:conformance:${fixture.name}`;
  return createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: request.siteId ?? 'synthetic.example',
      capabilityId,
      executionContractRef,
      planId: request.planId ?? `plan:${safeIdPart(capabilityId)}`,
    },
    executionContractRef,
    policyDecisionRef,
    verdictHint: request.verdictHint ?? fixture.policyDecision?.verdict ?? 'allow',
    requiredGates: request.requiredGates ?? fixture.policyDecision?.gates ?? [],
  });
}

function createPolicyFromFixture(fixture, invocationRequest) {
  const policy = fixture.policyDecision ?? {};
  const gates = policy.gates ?? [];
  return createGovernedExecutionPolicyDecision({
    executionId: policy.executionId ?? `execution:${safeIdPart(invocationRequest.capabilityId)}`,
    capabilityId: invocationRequest.capabilityId,
    executionContractRef: invocationRequest.executionContractRef,
    verdict: policy.verdict ?? 'allow',
    gates,
    gateStatus: policy.gateStatus ?? null,
    runtimeDispatchAllowed: policy.runtimeDispatchAllowed ?? policy.verdict !== 'blocked',
    siteAdapterInvocationAllowed: policy.siteAdapterInvocationAllowed === true,
    downloaderInvocationAllowed: policy.downloaderInvocationAllowed === true,
    auditRequired: policy.auditRequired === true || gates.includes('audit_required'),
    confirmationRequired: policy.confirmationRequired === true,
    sessionRequired: policy.sessionRequired === true,
    permissionRequired: policy.permissionRequired === true,
    dryRunRequired: policy.dryRunRequired === true,
  });
}

function authScope({
  origin = 'https://auth.example.test',
  operations = ['read'],
  resources = [],
} = {}) {
  const scope = {
    origin,
    operations,
  };
  if (resources.length) {
    scope.resources = resources;
  }
  return scope;
}

function authRequirement({
  origin = 'https://auth.example.test',
  operations = ['read'],
  materialTypes = ['bearer_token'],
  injectionTarget = 'http_request',
  resources = [],
} = {}) {
  return {
    required: true,
    mode: 'session_handle',
    scopes: [authScope({ origin, operations, resources })],
    material: {
      allowedTypes: materialTypes,
      injectionTarget,
    },
    policy: {
      requireGovernanceGate: true,
      allowCredentialForwarding: false,
      allowRawHeaderAudit: false,
      allowRawCookieAudit: false,
      allowRawBodyAudit: false,
    },
  };
}

function authData({
  origin = 'https://auth.example.test',
  operations = ['read'],
  resources = [],
} = {}) {
  return {
    sessionHandle: AUTH_SESSION_HANDLE,
    requestedScopes: [authScope({ origin, operations, resources })],
    authGate: {
      satisfied: true,
      gateId: 'governance-policy:auth-runtime-v1',
      policyId: 'policy:auth-runtime-v1',
    },
  };
}

function createAuthConformanceRequest({
  name,
  capabilityId = `capability:conformance:auth:${name}`,
  executionContractRef = `execution-contract:conformance:auth:${name}`,
  requirement,
  auth,
}) {
  return createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: 'auth.example.test',
      capabilityId,
      executionContractRef,
      planId: `plan:conformance:auth:${safeIdPart(name)}`,
    },
    executionContractRef,
    policyDecisionRef: `policy:conformance:auth:${safeIdPart(name)}`,
    verdictHint: 'allow',
    requiredGates: [],
    authRequirement: requirement,
    auth,
  });
}

function createAuthConformancePolicy(request) {
  return createGovernedExecutionPolicyDecision({
    executionId: `execution:${safeIdPart(request.capabilityId)}`,
    capabilityId: request.capabilityId,
    executionContractRef: request.executionContractRef,
    verdict: 'allow',
    gates: [],
    runtimeDispatchAllowed: true,
    siteAdapterInvocationAllowed: false,
    downloaderInvocationAllowed: false,
  });
}

function createAuthHttpContract({
  capabilityKind = 'read',
  operationKind = 'read',
  requirement = authRequirement({ operations: [operationKind] }),
  url = 'https://auth.example.test/api/items',
  filename = 'auth-conformance.txt',
} = {}) {
  return {
    capabilityKind,
    operationKind,
    contractKind: operationKind,
    runtimeBindingRef: `runtime-binding:auth-conformance:${safeIdPart(operationKind)}`,
    runtimeBinding: {
      httpRequest: {
        url,
        method: 'GET',
        responsePolicy: { material: 'sanitized_summary_only' },
      },
      downloadDescriptor: {
        url,
        method: 'GET',
        filename,
        responsePolicy: { material: 'sanitized_summary_only' },
      },
    },
    downloadDescriptor: {
      filename,
    },
    authRequirement: requirement,
    descriptorOnly: true,
    redactionRequired: true,
  };
}

function createConformanceFetch({ body = '{"ok":true}', contentType = 'application/json' } = {}) {
  const calls = [];
  return {
    calls,
    async fetchImpl(url, options = {}) {
      calls.push({ url, options });
      return {
        status: 200,
        ok: true,
        headers: {
          get(name) {
            return String(name ?? '').toLowerCase() === 'content-type' ? contentType : null;
          },
        },
        async text() {
          return body;
        },
        async arrayBuffer() {
          const bytes = Buffer.from(body);
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
      };
    },
  };
}

function createInstrumentedProductionRegistry() {
  const runCalls = [];
  const providers = createProductionRuntimeProviderRegistry({
    browserRuntimeDeps: createConformanceBrowserRuntimeDeps(),
  }).list().map((provider) => ({
    ...provider,
    async run(options) {
      runCalls.push(provider.id);
      return provider.run(options);
    },
  }));
  return {
    providerRegistry: createRuntimeProviderRegistryWith(providers),
    runCalls,
  };
}

function createConformanceBrowserRuntimeDeps() {
  return {
    openBrowserSession: async () => ({
      client: {
        on() {
          return () => {};
        },
        async send() {
          return {};
        },
      },
      sessionId: 'session-conformance',
      targetId: 'target-conformance',
      async navigateAndWait() {},
      async send() {
        return {};
      },
      async callPageFunction(fn) {
        switch (fn.name) {
          case 'selectorInspection':
            return { count: 1, actionable: true, visible: true };
          case 'fillSelectorValue':
            return { filled: true };
          case 'clickSelector':
            return { clicked: true };
          case 'observeCompletionSignal':
            return true;
          default:
            throw new Error(`Unexpected conformance browser function: ${fn.name}`);
        }
      },
      async close() {},
    }),
  };
}

function assertForbiddenSentinelsAbsent(payload, sentinels, context) {
  const serialized = JSON.stringify(payload);
  for (const sentinel of sentinels ?? []) {
    assert.equal(
      serialized.includes(sentinel),
      false,
      `${context} leaked forbidden sentinel ${sentinel}`,
    );
  }
}

function assertExpectedEnvelope(report, expected, runCalls, fixtureName) {
  assert.equal(report.status, expected.status, `${fixtureName} status`);
  assert.equal(report.providerId, expected.providerId ?? null, `${fixtureName} providerId`);
  if (Object.hasOwn(expected, 'providerInvoked')) {
    assert.equal(report.providerInvoked, expected.providerInvoked, `${fixtureName} providerInvoked`);
  }
  assert.equal(report.sideEffectAttempted, expected.sideEffectAttempted, `${fixtureName} sideEffectAttempted`);
  if (expected.blockedReason) {
    assert.equal(report.blockedReason, expected.blockedReason, `${fixtureName} blockedReason`);
  } else {
    assert.equal(report.blockedReason, null, `${fixtureName} blockedReason`);
  }
  if (expected.resultOutcome) {
    assert.equal(report.resultSummary?.outcome, expected.resultOutcome, `${fixtureName} result outcome`);
  }
  if (expected.providerInvoked === true) {
    assert.deepEqual(runCalls, [expected.providerId], `${fixtureName} provider run call`);
  } else if (expected.providerInvoked === false) {
    assert.deepEqual(runCalls, [], `${fixtureName} provider run should not be called`);
  }
}

function assertDownloadMetadata(report, expected, outputDir) {
  const metadata = expected.artifactMetadata;
  if (!metadata) return;
  const download = report.resultSummary?.downloads?.[0];
  assert.ok(download, 'download summary metadata is present');
  assert.equal(download.artifactRef, metadata.artifactRef);
  assert.equal(download.filename, metadata.filename);
  assert.equal(download.mimeType, metadata.mimeType);
  assert.equal(typeof download.byteSize, 'number');
  assert.equal(download.byteSize > 0, true);
  assert.equal(typeof download.hash, 'string');
  assert.equal(download.hash.length, 64);
  assert.equal(download.hash, download.checksum);
  assert.deepEqual(report.artifactRefs, [metadata.artifactRef]);

  const targetPath = path.resolve(outputDir, metadata.filename);
  const rootWithSeparator = path.resolve(outputDir).endsWith(path.sep)
    ? path.resolve(outputDir)
    : `${path.resolve(outputDir)}${path.sep}`;
  assert.equal(targetPath.startsWith(rootWithSeparator), true, 'download target stays inside output dir');
}

async function assertDownloadFiles(fixture, report, runtimeContext, expected) {
  const outputDir = runtimeContext.outputDir;
  if (expected.artifactMetadata) {
    const targetPath = path.join(outputDir, expected.artifactMetadata.filename);
    const written = await readFile(targetPath);
    const checksum = createHash('sha256').update(written).digest('hex');
    assert.equal(report.resultSummary.downloads[0].checksum, checksum);
  }
  if (expected.noArtifactWritten) {
    assert.deepEqual(report.artifactRefs, [], `${fixture.name} artifactRefs`);
    assert.equal(report.resultSummary, null, `${fixture.name} resultSummary`);
    await assertDirectoryEmptyOrMissing(outputDir, `${fixture.name} should not write controlled output`);
  }
  if (expected.outsidePathMustNotExist) {
    await assertPathMissing(
      expected.outsidePathMustNotExist,
      `${fixture.name} should not write outside the allowed output directory`,
    );
  }
}

async function runConformanceFixture(fixture) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), `siteforge-conformance-${fixture.name}-`));
  try {
    const replacements = {
      outputDir: path.join(tempRoot, 'allowed-output'),
      outsideFile: path.join(tempRoot, 'outside', 'escape.txt'),
      traversalTarget: path.join(tempRoot, 'escape.txt'),
    };
    const runtimeContext = interpolate(fixture.runtimeContext ?? {}, replacements);
    const expected = interpolate(fixture.expected ?? {}, replacements);
    const invocationRequest = createRequestFromFixture(fixture);
    const policyDecision = createPolicyFromFixture(fixture, invocationRequest);
    const auditRecorder = createRuntimeAuditRecorder();
    const { providerRegistry, runCalls } = createInstrumentedProductionRegistry();

    const report = await executeRuntimeInvocation({
      invocationRequest,
      policyDecision,
      gateStatus: policyDecision.gateStatus ?? null,
      executionContract: fixture.executionContract ?? null,
      capability: fixture.capability ?? null,
      runtimeContext,
      providerRegistry,
      auditRecorder,
    });
    const auditEvents = auditRecorder.listEvents();

    assertExpectedEnvelope(report, expected, runCalls, fixture.name);
    assertDownloadMetadata(report, expected, runtimeContext.outputDir);
    await assertDownloadFiles(fixture, report, runtimeContext, expected);
    assertForbiddenSentinelsAbsent({ report, auditEvents }, fixture.forbiddenSentinels, fixture.name);
    assert.equal(auditEvents.length, 1, `${fixture.name} audit event count`);
    assert.equal(auditEvents[0].auditRef, report.auditRef, `${fixture.name} auditRef`);
    return { report, auditEvents };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test('capability contract conformance fixtures are complete', async () => {
  const fixtures = await loadFixtures();
  assert.deepEqual(fixtures.map((fixture) => fixture.name).sort(), [...EXPECTED_FIXTURE_NAMES].sort());
  for (const fixture of fixtures) {
    assert.equal(Array.isArray(fixture.forbiddenSentinels), true, `${fixture.name} has forbiddenSentinels`);
    assert.equal(fixture.forbiddenSentinels.length >= 12, true, `${fixture.name} sentinel coverage`);
  }
});

test('production provider matrix matches Controlled Runtime Execution V1', async () => {
  const fixtures = Object.fromEntries((await loadFixtures()).map((fixture) => [fixture.name, fixture]));
  const registry = createProductionRuntimeProviderRegistry();
  const providers = Object.fromEntries(registry.list().map((provider) => [provider.id, provider]));

  const positive = [
    [{ executionContract: { capabilityKind: 'read', operationKind: 'read' } }, API_READ_PROVIDER_ID],
    [{ executionContract: { capabilityKind: 'query', operationKind: 'query' } }, API_READ_PROVIDER_ID],
    [{ executionContract: fixtures['api-read'].executionContract }, API_READ_PROVIDER_ID],
    [{ executionContract: fixtures['query-read-form'].executionContract }, API_READ_PROVIDER_ID],
    [{ executionContract: { capabilityKind: 'download', operationKind: 'download' } }, DOWNLOAD_PROVIDER_ID],
    [{ executionContract: fixtures['download-outside-output-dir'].executionContract }, DOWNLOAD_PROVIDER_ID],
    [{ executionContract: fixtures['browser-write-controlled-local-fixture'].executionContract }, BROWSER_ACTION_PROVIDER_ID],
    [{ executionContract: fixtures['browser-write-controlled-runtime'].executionContract }, BROWSER_ACTION_PROVIDER_ID],
    [{ executionContract: fixtures['browser-write-incomplete-payload-coverage'].executionContract }, BROWSER_ACTION_PROVIDER_ID],
  ];
  for (const [descriptor, providerId] of positive) {
    assert.equal(registry.resolve(descriptor)?.id, providerId, `${providerId} selection`);
  }

  const apiReadNegatives = [
    fixtures['browser-write-controlled-local-fixture'],
    fixtures['browser-write-controlled-runtime'],
    fixtures['browser-write-incomplete-payload-coverage'],
    fixtures['download-allowed'],
    fixtures.payment,
    fixtures.destructive,
  ];
  for (const fixture of apiReadNegatives) {
    assert.equal(
      providers[API_READ_PROVIDER_ID].supports({ executionContract: fixture.executionContract, capability: fixture.capability }),
      false,
      `api_read_provider should not support ${fixture.name}`,
    );
  }

  const downloadNegatives = [
    fixtures['api-read'],
    fixtures['query-read-form'],
    fixtures['browser-write-controlled-local-fixture'],
    fixtures['browser-write-controlled-runtime'],
    fixtures['browser-write-incomplete-payload-coverage'],
    fixtures.payment,
    fixtures.destructive,
  ];
  for (const fixture of downloadNegatives) {
    assert.equal(
      providers[DOWNLOAD_PROVIDER_ID].supports({ executionContract: fixture.executionContract, capability: fixture.capability }),
      false,
      `download_provider should not support ${fixture.name}`,
    );
  }

  const browserNegatives = [
    fixtures['api-read'],
    fixtures['query-read-form'],
    fixtures['download-allowed'],
    fixtures['download-outside-output-dir'],
    fixtures.payment,
    fixtures.destructive,
  ];
  for (const fixture of browserNegatives) {
    assert.equal(
      providers[BROWSER_ACTION_PROVIDER_ID].supports({ executionContract: fixture.executionContract, capability: fixture.capability }),
      false,
      `browser_action_provider should not support ${fixture.name}`,
    );
  }

  assert.equal(registry.resolve({ executionContract: fixtures.payment.executionContract, capability: fixtures.payment.capability }), null);
  assert.equal(registry.resolve({ executionContract: fixtures.destructive.executionContract, capability: fixtures.destructive.capability }), null);
});

test('auth runtime v1 provider matrix is limited to api read and download HTTP execution', async () => {
  const registry = createProductionRuntimeProviderRegistry();
  const publicMatrix = [
    [{ executionContract: { capabilityKind: 'read', operationKind: 'api_request' } }, API_READ_PROVIDER_ID],
    [{ executionContract: { capabilityKind: 'query', operationKind: 'query' } }, API_READ_PROVIDER_ID],
    [{ executionContract: { capabilityKind: 'download', operationKind: 'download' } }, DOWNLOAD_PROVIDER_ID],
    [{ executionContract: { capabilityKind: 'export', operationKind: 'export' } }, DOWNLOAD_PROVIDER_ID],
  ];
  for (const [descriptor, providerId] of publicMatrix) {
    assert.equal(registry.resolve(descriptor)?.id, providerId, `${providerId} public selection`);
  }

  const scenarios = [
    {
      name: 'api-read',
      providerId: API_READ_PROVIDER_ID,
      capabilityKind: 'read',
      operationKind: 'api_request',
      authOperations: ['read'],
    },
    {
      name: 'query-read',
      providerId: API_READ_PROVIDER_ID,
      capabilityKind: 'query',
      operationKind: 'query',
      authOperations: ['query'],
    },
    {
      name: 'download',
      providerId: DOWNLOAD_PROVIDER_ID,
      capabilityKind: 'download',
      operationKind: 'download',
      authOperations: ['download'],
    },
    {
      name: 'export',
      providerId: DOWNLOAD_PROVIDER_ID,
      capabilityKind: 'export',
      operationKind: 'export',
      authOperations: ['export'],
    },
  ];

  for (const scenario of scenarios) {
    const requirement = authRequirement({ operations: scenario.authOperations });
    const request = createAuthConformanceRequest({
      name: scenario.name,
      requirement,
      auth: authData({ operations: scenario.authOperations }),
    });
    const contract = createAuthHttpContract({
      capabilityKind: scenario.capabilityKind,
      operationKind: scenario.operationKind,
      requirement,
      filename: `${scenario.name}.txt`,
    });
    const fetch = createConformanceFetch({ body: scenario.providerId === DOWNLOAD_PROVIDER_ID ? 'download body' : '{"items":[1]}' });
    const outputDir = await mkdtemp(path.join(os.tmpdir(), `siteforge-auth-conformance-${scenario.name}-`));
    try {
      const vault = createMockSessionVault({
        sessionHandle: AUTH_SESSION_HANDLE,
        scopes: [authScope({ operations: scenario.authOperations })],
        material: [{ type: 'bearer_token', value: AUTH_TOKEN }],
      });
      const report = await executeRuntimeInvocation({
        invocationRequest: request,
        policyDecision: createAuthConformancePolicy(request),
        executionContract: contract,
        runtimeContext: {
          fetchImpl: fetch.fetchImpl,
          sessionVault: vault,
          outputDir,
          outputPolicy: { approved: true },
        },
        providerRegistry: registry,
      });

      assert.equal(report.status, 'completed', scenario.name);
      assert.equal(report.providerId, scenario.providerId, scenario.name);
      assert.equal(report.providerInvoked, true, scenario.name);
      assert.equal(report.executionAttempted, true, scenario.name);
      assert.equal(report.sideEffectAttempted, true, scenario.name);
      assert.equal(fetch.calls.length, 1, scenario.name);
      assert.equal(fetch.calls[0].options.redirect, 'manual', scenario.name);
      assert.equal(vault.getCounters().inspectSessionCalls, 1, scenario.name);
      assert.equal(vault.getCounters().getScopedSessionMaterialCalls, 1, scenario.name);
      assert.equal(vault.getCounters().releaseScopedSessionMaterialCalls, 1, scenario.name);
      assertForbiddenSentinelsAbsent({ report }, [AUTH_SESSION_HANDLE, AUTH_TOKEN, 'Authorization', 'Bearer'], scenario.name);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
});

test('auth runtime v1 blocks browser auth while preserving payment and destructive reasons', async () => {
  const registry = createProductionRuntimeProviderRegistry({
    browserRuntimeDeps: createConformanceBrowserRuntimeDeps(),
  });
  const requirement = authRequirement({ operations: ['read'] });
  const request = createAuthConformanceRequest({
    name: 'browser-auth-blocked',
    requirement,
    auth: authData({ operations: ['read'] }),
  });
  const browserContract = {
    capabilityKind: 'write',
    operationKind: 'form_or_action',
    runtimeBindingRef: 'runtime-binding:auth-conformance:browser',
    runtimeBinding: {
      browserRuntime: {
        url: 'https://auth.example.test/form',
        action: { kind: 'click', selector: '#submit', actionRef: 'browser-action:submit' },
        completion: { kind: 'selector_visible', selector: '#done' },
      },
    },
    authRequirement: requirement,
    descriptorOnly: true,
    redactionRequired: true,
  };
  assert.equal(registry.resolve({ executionContract: browserContract })?.id, BROWSER_ACTION_PROVIDER_ID);
  const browserReport = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision: createAuthConformancePolicy(request),
    executionContract: browserContract,
    runtimeContext: {},
    providerRegistry: registry,
  });
  assert.equal(browserReport.status, 'blocked');
  assert.equal(browserReport.blockedReason, RUNTIME_AUTH_REASONS.authRequired);
  assert.equal(browserReport.providerInvoked, false);

  for (const [flag, reason] of [
    ['paymentOrFundsAction', RUNTIME_REASONS.paymentExecutionBlocked],
    ['destructiveAction', RUNTIME_REASONS.destructiveExecutionBlocked],
  ]) {
    const blockedRequest = createAuthConformanceRequest({
      name: `blocked-${flag}`,
      requirement,
      auth: authData({ operations: ['read'] }),
    });
    const report = await executeRuntimeInvocation({
      invocationRequest: blockedRequest,
      policyDecision: createAuthConformancePolicy(blockedRequest),
      executionContract: {
        capabilityKind: 'read',
        operationKind: 'read',
        runtimeProviderId: API_READ_PROVIDER_ID,
        [flag]: true,
        authRequirement: requirement,
        descriptorOnly: true,
        redactionRequired: true,
      },
      runtimeContext: {},
      providerRegistry: registry,
    });
    assert.equal(report.status, 'blocked');
    assert.equal(report.blockedReason, reason);
    assert.equal(report.providerInvoked, false);
  }
});

test('auth-aware controlled browser runtime v1 supports browser_context cookie write only under controlled runtime', async () => {
  const startUrl = 'https://auth.example.test/form';
  const requirement = authRequirement({
    origin: 'https://auth.example.test',
    operations: ['form_or_action'],
    materialTypes: ['cookie'],
    injectionTarget: 'browser_context',
  });
  const request = createAuthConformanceRequest({
    name: 'browser-context-write',
    requirement,
    auth: authData({ operations: ['form_or_action'] }),
  });
  const vault = createMockSessionVault({
    sessionHandle: AUTH_SESSION_HANDLE,
    scopes: [authScope({ operations: ['form_or_action'] })],
    material: [{
      type: 'cookie',
      name: 'sf_browser_cookie_name_should_not_log',
      value: AUTH_TOKEN,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      expires: 1_893_456_000,
    }],
    grantSummary: {
      materialTypes: ['cookie'],
      materialCount: 1,
      expiresAt: '2030-01-01T00:00:00.000Z',
    },
  });
  const contract = {
    capabilityKind: 'submit',
    operationKind: 'form_or_action',
    contractKind: 'form_or_action',
    runtimeBindingRef: 'runtime-binding:auth-conformance:browser-context',
    runtimeBinding: {
      kind: 'browser_bridge',
      targetUrl: startUrl,
    },
    authRequirement: requirement,
    browserActionDescriptor: {
      actionRef: 'action:auth-conformance-submit',
      routeRef: 'route:auth-conformance-form',
      requiredSlots: ['message'],
      selectors: {
        fields: {
          message: '[data-sf-field="message"]',
        },
        submit: '[data-sf-action="submit"]',
      },
      completionSignal: {
        kind: 'selectorVisible',
        selector: '[data-sf-completion="done"]',
        timeoutMs: 250,
      },
    },
    payloadTemplate: {
      material: 'template_only',
      redactionRequired: true,
      savedMaterial: 'sanitized_summary_only',
      slotBindings: [{
        name: 'message',
        type: 'string',
        required: true,
        binding: 'payload.message',
        selector: '[data-sf-field="message"]',
      }],
      steps: [{
        kind: 'form_submit',
        selector: '[data-sf-action="submit"]',
        actionRef: 'action:auth-conformance-submit',
      }],
    },
    descriptorOnly: true,
    redactionRequired: true,
  };
  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision: createAuthConformancePolicy(request),
    executionContract: contract,
    runtimeContext: {
      controlledBrowserRuntime: true,
      browserRuntime: {
        mode: 'controlled',
        engine: 'chromium',
        startUrl,
        allowedOrigins: ['https://auth.example.test'],
        allowExternalNetwork: false,
        allowDownloads: false,
        allowPopups: false,
        persistProfile: false,
        recordDom: false,
        recordScreenshots: false,
        recordVideo: false,
        recordFullTrace: false,
      },
      slotValues: {
        message: 'conformance message',
      },
      sessionVault: vault,
    },
    providerRegistry: createProductionRuntimeProviderRegistry({
      browserRuntimeDeps: createConformanceBrowserRuntimeDeps(),
    }),
  });

  assert.equal(report.status, 'completed');
  assert.equal(report.providerId, BROWSER_ACTION_PROVIDER_ID);
  assert.equal(report.providerInvoked, true);
  assert.equal(report.executionAttempted, true);
  assert.equal(report.sideEffectAttempted, true);
  assert.equal(vault.getCounters().inspectSessionCalls, 1);
  assert.equal(vault.getCounters().getScopedSessionMaterialCalls, 1);
  assert.equal(vault.getCounters().releaseScopedSessionMaterialCalls, 1);
  assert.deepEqual(report.authSummary.materialSummary, { types: ['cookie'], count: 1 });
  assertForbiddenSentinelsAbsent(
    { report },
    [AUTH_SESSION_HANDLE, AUTH_TOKEN, 'sf_browser_cookie_name_should_not_log', 'Set-Cookie', 'storageState'],
    'browser_context_write',
  );
});

test('auth runtime production exports keep mock vault behind runtime testing API', async () => {
  const runtimeIndex = await readFile(path.join(PROJECT_ROOT, 'src', 'app', 'runtime', 'index.mjs'), 'utf8');
  const runtimeTesting = await readFile(path.join(PROJECT_ROOT, 'src', 'app', 'runtime', 'testing.mjs'), 'utf8');

  assert.doesNotMatch(runtimeIndex, /createMockSessionVault|mock-session-vault|createTestingRuntimeProviderRegistry|fake.*browser/iu);
  assert.match(runtimeTesting, /mock-session-vault/u);
});

test('runtime trust infrastructure modules preserve architecture and production boundaries', async () => {
  const runtimeIndex = await readFile(path.join(PROJECT_ROOT, 'src', 'app', 'runtime', 'index.mjs'), 'utf8');
  const runtimeTesting = await readFile(path.join(PROJECT_ROOT, 'src', 'app', 'runtime', 'testing.mjs'), 'utf8');
  const executionRunner = await readFile(path.join(PROJECT_ROOT, 'src', 'app', 'runtime', 'execution-runner.mjs'), 'utf8');
  const providerIndex = await readFile(path.join(PROJECT_ROOT, 'src', 'app', 'runtime', 'providers', 'index.mjs'), 'utf8');
  const runBuild = await readFile(path.join(PROJECT_ROOT, 'src', 'entrypoints', 'build', 'run-build.mjs'), 'utf8');
  const sessionPolicy = await readFile(path.join(PROJECT_ROOT, 'src', 'domain', 'policies', 'session-policy.mjs'), 'utf8');

  for (const relativePath of [
    'src/app/runtime/audit-viewer/audit-view-builder.mjs',
    'src/app/runtime/audit-viewer/audit-view-loader.mjs',
    'src/app/runtime/audit-viewer/audit-view-sanitizer.mjs',
    'src/app/runtime/audit-query/audit-query-filter.mjs',
    'src/app/runtime/audit-query/audit-query-compare.mjs',
    'src/app/runtime/audit-query/audit-query-regression.mjs',
    'src/app/runtime/audit-query/audit-query-stats.mjs',
  ]) {
    const source = await readFile(path.join(PROJECT_ROOT, ...relativePath.split('/')), 'utf8');
    assert.doesNotMatch(source, /providers\/|api-read-provider|download-provider|browser-action-provider|executeRuntimeInvocation|provider-registry/u, relativePath);
    assert.doesNotMatch(source, /SessionVault|getScopedSessionMaterial|openBrowserSession|globalThis\.fetch|fetchImpl/u, relativePath);
  }

  assert.doesNotMatch(sessionPolicy, /providers\/|api-read-provider|download-provider|browser-action-provider|sessionVault|getScopedSessionMaterial|fetch\(|openBrowserSession/u);
  assert.doesNotMatch(runtimeIndex, /createMockSessionVault|mock-session-vault|createFakeControlledBrowserRuntimeDeps|createTestingRuntimeProviderRegistry|createMockDestructiveProvider|createTestingDestructiveProvider/iu);
  assert.match(runtimeTesting, /mock-session-vault/u);
  assert.doesNotMatch(providerIndex, /destructive_provider|createDestructive|DestructiveProvider/u);
  assert.doesNotMatch(executionRunner, /createMockSessionVault|createMockRuntimeProviderRegistry|mock-providers|fallback.*mock/iu);
  assert.doesNotMatch(runBuild, /createMockSessionVault|controlledBrowserRuntime\s*:\s*true|browserRuntimeFactory\s*:|sessionVault\s*:/u);
  assert.equal(createProductionRuntimeProviderRegistry().resolve({
    executionContract: {
      capabilityKind: 'destructive',
      operationKind: 'delete',
      destructiveAction: true,
    },
  }), null);
});

test('runtime dispatch, blocking, artifact metadata, and sanitization match fixtures', async () => {
  for (const fixture of await loadFixtures()) {
    await runConformanceFixture(fixture);
  }
});
