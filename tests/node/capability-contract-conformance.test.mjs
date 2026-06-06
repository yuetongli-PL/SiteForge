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
  createProductionRuntimeProviderRegistry,
  createRuntimeAuditRecorder,
  createRuntimeProviderRegistryWith,
  executeRuntimeInvocation,
} from '../../src/app/runtime/index.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../src/domain/policies/execution/index.mjs';

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'capability-contract-conformance',
);

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

function createInstrumentedProductionRegistry() {
  const runCalls = [];
  const providers = createProductionRuntimeProviderRegistry().list().map((provider) => ({
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

test('runtime dispatch, blocking, artifact metadata, and sanitization match fixtures', async () => {
  for (const fixture of await loadFixtures()) {
    await runConformanceFixture(fixture);
  }
});
