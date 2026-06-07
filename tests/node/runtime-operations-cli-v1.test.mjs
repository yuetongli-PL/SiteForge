// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createRuntimeAuditView,
  createRunStoreIntegrityDigest,
  createRunStoreManifest,
  writeRuntimeRunStore,
} from '../../src/app/runtime/index.mjs';
import {
  createRuntimeRegressionSnapshotFixture,
} from '../../src/app/runtime/testing.mjs';
import {
  runRuntimeOpsCli,
} from '../../src/app/cli/runtime-ops.mjs';
import {
  runtimeOpsCliCommand,
} from '../../src/infra/cli/command-map.mjs';

const CLI_CANARIES = /sf_cli_cookie_secret_123|sf_cli_token_secret_456|sf_cli_raw_body_secret_789/u;
const PUBLIC_READ_PACKAGE = new URL('../../packages/siteforge-sites/public-read-fixture/site.capability_package.json', import.meta.url);
const POLICY_PACK = new URL('./fixtures/policy-pack-authoring-simulation-v1/safe-policy-pack.json', import.meta.url);

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'siteforge-runtime-ops-cli-'));
}

async function readJson(urlOrPath) {
  return JSON.parse(await readFile(urlOrPath, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertNoCliCanary(payload) {
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  assert.doesNotMatch(serialized, CLI_CANARIES);
  assert.doesNotMatch(serialized, /Bearer\s+|Authorization|Cookie\s*[:=]|Set-Cookie|rawBody|storageState/u);
}

function baseReport(overrides = {}) {
  return {
    schemaVersion: 'site-capability-execution/v1',
    executionVersion: 'runtime-test-v1',
    reportType: 'RuntimeExecutionReport',
    requestId: 'runtime-invocation:cli-v1',
    executionId: 'execution:cli-v1',
    capabilityId: 'capability:cli-v1:read',
    executionContractRef: 'execution-contract:cli-v1',
    policyDecisionRef: 'policy:cli-v1',
    verdict: 'allow',
    status: 'completed',
    capabilityKind: 'read',
    providerId: 'api_read_provider',
    providerKind: 'api_read_provider',
    runtimeDispatchAllowed: true,
    providerInvoked: true,
    executionAttempted: true,
    runtimeExecuted: true,
    sideEffectAttempted: false,
    sideEffectSucceeded: false,
    sideEffectFailed: false,
    artifactRefs: ['artifact:cli-v1:safe-summary'],
    resultSummary: {
      outcome: 'runtime_ops_cli_summary',
      artifactRefs: ['artifact:cli-v1:safe-summary'],
      redactionRequired: true,
    },
    redactionRequired: true,
    ...overrides,
  };
}

function auditEvent(report = baseReport()) {
  return {
    eventType: 'runtime_execution_report',
    auditRef: 'artifact:runtime-audit:cli-v1:1',
    requestId: report.requestId,
    executionId: report.executionId,
    capabilityId: report.capabilityId,
    providerId: report.providerId,
    verdict: report.verdict,
    status: report.status,
    runtimeDispatchAllowed: report.runtimeDispatchAllowed,
    executionAttempted: report.executionAttempted,
    sideEffectAttempted: report.sideEffectAttempted,
    sideEffectSucceeded: report.sideEffectSucceeded,
    sideEffectFailed: report.sideEffectFailed,
    reasonCode: report.reasonCode,
    blockedReason: report.blockedReason,
    artifactRefs: report.artifactRefs,
    redactionRequired: true,
  };
}

async function writeRunStoreFixture(root) {
  const report = baseReport();
  const auditView = createRuntimeAuditView({
    report,
    auditEvents: [auditEvent(report)],
  });
  const manifest = await writeRuntimeRunStore(root, {
    runId: 'run:cli-v1',
    createdAt: '2026-06-07T00:00:00.000Z',
    invocationRef: 'invocation:cli-v1',
    capabilityRef: 'sitepkg:phase28/public-read@1.0.0',
    executionContractRef: 'sitepkg:phase28/contract/public-read@1.0.0',
    packageId: 'sitepkg:phase28-runtime-ops',
    providerId: 'api_read_provider',
    status: 'completed',
    sideEffectAttempted: false,
    runtimeExecutionReport: report,
    auditEvents: [auditEvent(report)],
    auditView,
    artifactMetadata: [{
      artifactRef: 'artifact:cli-v1:safe-summary',
      kind: 'runtime-summary',
      digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      savedMaterial: 'sanitized_summary_only',
    }],
    policyDecisionSummary: {
      decisionId: 'policy-decision:cli-v1',
      policyId: 'policy-pack:siteforge-safe-defaults',
      reason: 'policy.runtime_ops_read_allowed',
      allowed: true,
    },
    files: [{
      kind: 'artifact_metadata',
      path: 'run-cli-v1/raw-artifact.txt',
      digest: createRunStoreIntegrityDigest(createRunStoreManifest({ runId: 'run:artifact-placeholder' })),
      sizeBytes: 99,
    }],
  });
  await writeFile(path.join(root, 'run-cli-v1', 'raw-artifact.txt'), 'sf_cli_raw_body_secret_789', 'utf8');
  return {
    manifest,
    manifestPath: path.join(root, 'run-cli-v1', 'run_manifest.json'),
    runDir: path.join(root, 'run-cli-v1'),
  };
}

async function writePackagePair(root) {
  const previous = await readJson(PUBLIC_READ_PACKAGE);
  const next = clone(previous);
  next.capabilities[0].risk = 'ordinary_write';
  next.capabilities[0].riskClassification = {
    ...next.capabilities[0].riskClassification,
    level: 'ordinary_write',
    sideEffecting: true,
  };
  const previousPath = path.join(root, 'previous-package.json');
  const nextPath = path.join(root, 'next-package.json');
  await writeFile(previousPath, JSON.stringify(previous, null, 2), 'utf8');
  await writeFile(nextPath, JSON.stringify(next, null, 2), 'utf8');
  return { previousPath, nextPath };
}

async function writeRegressionPair(root) {
  const previous = createRuntimeRegressionSnapshotFixture({
    snapshotId: 'runtime-ci-regression:cli:previous',
    runtime: {
      status: 'blocked',
      reasonCode: 'runtime.policy_blocked',
      providerId: 'api_read_provider',
      capabilityKind: 'read',
      providerInvoked: false,
      executionAttempted: false,
      sideEffectAttempted: false,
      paymentBlocked: false,
      destructiveBlocked: false,
      executionContractConcrete: true,
    },
  });
  const next = createRuntimeRegressionSnapshotFixture({
    snapshotId: 'runtime-ci-regression:cli:next',
    runtime: {
      status: 'completed',
      reasonCode: 'runtime.policy_blocked',
      providerId: 'api_read_provider',
      capabilityKind: 'read',
      providerInvoked: true,
      executionAttempted: true,
      sideEffectAttempted: true,
      paymentBlocked: false,
      destructiveBlocked: false,
      executionContractConcrete: true,
    },
  });
  const previousPath = path.join(root, 'previous-snapshot.json');
  const nextPath = path.join(root, 'next-snapshot.json');
  await writeFile(previousPath, JSON.stringify(previous, null, 2), 'utf8');
  await writeFile(nextPath, JSON.stringify(next, null, 2), 'utf8');
  return { previousPath, nextPath };
}

test('audit view CLI renders text and json from a run store', async () => {
  const root = await tempRoot();
  const { manifestPath } = await writeRunStoreFixture(root);

  const text = await runRuntimeOpsCli(['audit', 'view', manifestPath, '--format', 'text']);
  const json = await runRuntimeOpsCli(['audit', 'view', manifestPath, '--format', 'json']);

  assert.equal(text.exitCode, 0, text.stderr);
  assert.match(text.stdout, /# Runtime Audit View/u);
  assert.match(text.stdout, /provider: api_read_provider/u);
  assert.equal(json.exitCode, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).redactionRequired, true);
  assertNoCliCanary(text.stdout + json.stdout);
});

test('audit query CLI applies a safe run-store filter', async () => {
  const root = await tempRoot();
  const { manifestPath } = await writeRunStoreFixture(root);
  const result = await runRuntimeOpsCli([
    'audit',
    'query',
    manifestPath,
    '--filter',
    'policyId=policy-pack:siteforge-safe-defaults',
  ]);
  const output = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(output.count, 1);
  assert.equal(output.runs[0].providerId, 'api_read_provider');
  assert.equal(output.vaultAccessed, false);
  assertNoCliCanary(output);
});

test('run inspect CLI emits sanitized run summary without raw artifact content', async () => {
  const root = await tempRoot();
  const { manifestPath } = await writeRunStoreFixture(root);
  const result = await runRuntimeOpsCli(['run', 'inspect', manifestPath]);
  const output = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(output.run.runId, 'run:cli-v1');
  assert.equal(output.rawArtifactContentRead, false);
  assert.equal(output.providerInvoked, false);
  assert.doesNotMatch(result.stdout, /sf_cli_raw_body_secret_789/u);
});

test('package inspect CLI emits descriptor-only package summary', async () => {
  const result = await runRuntimeOpsCli(['package', 'inspect', fileURLToPath(PUBLIC_READ_PACKAGE)]);
  const output = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(output.packageId, 'sitepkg:phase26-public-read');
  assert.equal(output.capabilityCount, 1);
  assert.equal(output.capabilities[0].risk, 'public_read');
  assertNoCliCanary(output);
});

test('package diff CLI detects risk widening', async () => {
  const root = await tempRoot();
  const { previousPath, nextPath } = await writePackagePair(root);
  const result = await runRuntimeOpsCli(['package', 'diff', previousPath, nextPath]);
  const output = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(output.highRiskChangeCount, 1);
  assert.equal(output.changes[0].kind, 'risk_widened');
  assert.equal(output.networkInvoked, false);
});

test('policy simulate CLI returns policy decision without runtime execution', async () => {
  const result = await runRuntimeOpsCli([
    'policy',
    'simulate',
    fileURLToPath(POLICY_PACK),
    fileURLToPath(PUBLIC_READ_PACKAGE),
  ]);
  const output = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(output.decision.providerInvoked, false);
  assert.equal(output.providerInvoked, false);
  assert.equal(output.browserInvoked, false);
  assert.equal(output.vaultAccessed, false);
  assert.equal(output.networkInvoked, false);
});

test('regression compare CLI flags high-risk drift', async () => {
  const root = await tempRoot();
  const { previousPath, nextPath } = await writeRegressionPair(root);
  const result = await runRuntimeOpsCli(['regression', 'compare', previousPath, nextPath]);
  const output = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(output.highRiskChangeCount > 0, true);
  assert.equal(output.changes.some((change) => change.kind === 'side_effect_introduced'), true);
});

test('runtime ops CLI rejects path traversal and unsafe filters', async () => {
  const root = await tempRoot();
  const traversal = await runRuntimeOpsCli(['package', 'inspect', '../package.json'], { cwd: root });
  const unsafeFilter = await runRuntimeOpsCli([
    'audit',
    'query',
    path.join(root, 'run-cli-v1', 'run_manifest.json'),
    '--filter',
    'cookie=sf_cli_cookie_secret_123',
  ]);

  assert.equal(traversal.exitCode, 1);
  assert.match(traversal.stderr, /runtime_ops.path_rejected/u);
  assert.equal(unsafeFilter.exitCode, 1);
  assert.doesNotMatch(unsafeFilter.stderr, CLI_CANARIES);
});

test('runtime ops CLI does not call provider browser vault or network paths', async () => {
  const root = await tempRoot();
  const { manifestPath } = await writeRunStoreFixture(root);
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = () => {
    fetchCalled = true;
    throw new Error('runtime ops CLI must not fetch');
  };
  try {
    const result = await runRuntimeOpsCli(['audit', 'query', manifestPath, '--filter', 'status=completed']);
    const output = JSON.parse(result.stdout);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(output.providerInvoked, false);
    assert.equal(output.browserInvoked, false);
    assert.equal(output.vaultAccessed, false);
    assert.equal(output.networkInvoked, false);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('payment and destructive CLI actions are not available', async () => {
  const payment = await runRuntimeOpsCli(['payment', 'execute']);
  const destructive = await runRuntimeOpsCli(['destructive', 'execute']);

  assert.equal(payment.exitCode, 1);
  assert.equal(destructive.exitCode, 1);
  assert.match(payment.stderr, /runtime_ops.command_not_supported/u);
  assert.match(destructive.stderr, /runtime_ops.command_not_supported/u);
});

test('runtime ops command-map helper uses internal CLI entrypoint', () => {
  const command = runtimeOpsCliCommand(['package', 'inspect', 'packages/siteforge-sites/public-read-fixture/site.capability_package.json']);

  assert.equal(
    command,
    'node src/app/cli/runtime-ops.mjs package inspect packages/siteforge-sites/public-read-fixture/site.capability_package.json',
  );
  assert.doesNotMatch(command, /^siteforge build/u);
});
