// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import * as runtimeIndex from '../../src/app/runtime/index.mjs';
import {
  createRuntimeRegressionSnapshotFixture,
} from '../../src/app/runtime/testing.mjs';
import {
  runRuntimeRegressionHarness,
} from '../../src/app/runtime/index.mjs';
import {
  RUNTIME_PRODUCTIZATION_TESTS,
  RUNTIME_REGRESSION_TESTS,
  RUNTIME_TRUST_TESTS,
  runtimeTestFilesForGroups,
} from '../../scripts/runtime-productization-regression.mjs';
import {
  OPTIONAL_LIVE_SMOKE_ENV,
  VERIFY_RELEASE_COMMANDS,
  assertNoReleaseGateCanaryLeakage,
  assertProductionProtectedProvidersAbsent,
  assertRegressionGatePasses,
  assertRuntimeIndexExportBoundary,
  shouldRunOptionalLiveSmoke,
  verifyReleaseCommandLabels,
} from '../../scripts/verify-release.mjs';

const PACKAGE_JSON_URL = new URL('../../package.json', import.meta.url);
const RELEASE_GATES_DOC_URL = new URL('../../docs/release/release-gates.md', import.meta.url);
const WORKFLOW_URL = new URL('../../.github/workflows/test.yml', import.meta.url);

async function readPackageJson() {
  return JSON.parse(await readFile(PACKAGE_JSON_URL, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baselineSnapshot(overrides = {}) {
  const base = createRuntimeRegressionSnapshotFixture({
    snapshotId: 'runtime-ci-regression:release-gate:baseline',
  });
  return {
    ...base,
    ...overrides,
    runtime: {
      ...base.runtime,
      ...(overrides.runtime ?? {}),
    },
    auth: {
      ...base.auth,
      ...(overrides.auth ?? {}),
    },
    browserGuard: {
      ...base.browserGuard,
      ...(overrides.browserGuard ?? {}),
    },
    policy: {
      ...base.policy,
      ...(overrides.policy ?? {}),
    },
    metadata: {
      ...base.metadata,
      ...(overrides.metadata ?? {}),
    },
  };
}

test('package scripts expose runtime trust productization regression and release gates', async () => {
  const { scripts } = await readPackageJson();

  assert.equal(scripts['test:runtime-trust'], 'node scripts/runtime-productization-regression.mjs --group trust');
  assert.equal(scripts['test:runtime-productization'], 'node scripts/runtime-productization-regression.mjs --group productization');
  assert.equal(scripts['test:regression'], 'node scripts/runtime-productization-regression.mjs --group regression');
  assert.equal(scripts['verify:release'], 'node scripts/verify-release.mjs');
  assert.match(scripts['release:local'], /npm run verify:release/u);
});

test('verify release command includes baseline and productization test groups', async () => {
  const labels = verifyReleaseCommandLabels();
  const commands = VERIFY_RELEASE_COMMANDS.map((entry) => `${entry.command} ${entry.args.join(' ')}`).join('\n');
  const productizationFiles = runtimeTestFilesForGroups(['productization']);
  const trustFiles = runtimeTestFilesForGroups(['trust']);

  assert.deepEqual(labels, [
    'runtime trust tests',
    'runtime productization tests',
    'runtime regression tests',
    'secret scan',
    'diff whitespace check',
  ]);
  assert.match(commands, /npm run test:runtime-trust/u);
  assert.match(commands, /npm run test:runtime-productization/u);
  assert.match(commands, /npm run test:regression/u);
  assert.equal(trustFiles.includes('tests/node/capability-contract-conformance.test.mjs'), true);
  assert.equal(productizationFiles.includes('tests/node/siteforge-runtime-productization-e2e-v1.test.mjs'), true);
  assert.equal(productizationFiles.includes('tests/node/first-party-site-package-pilot-v1.test.mjs'), true);
  assert.equal(productizationFiles.includes('tests/node/payment-authorization-lab-threat-model-v1.test.mjs'), true);
});

test('regression release gate blocks high-risk runtime drift', () => {
  const previous = baselineSnapshot({
    runtime: {
      status: 'blocked',
      sideEffectAttempted: false,
    },
  });
  const next = baselineSnapshot({
    snapshotId: 'runtime-ci-regression:release-gate:next',
    runtime: {
      status: 'completed',
      sideEffectAttempted: true,
    },
  });
  const report = runRuntimeRegressionHarness({
    reportId: 'runtime-ci-regression:release-gate',
    cases: [{ caseId: 'release-gate-high-risk', previous, next }],
  });

  assert.equal(report.highRiskChangeCount > 0, true);
  assert.throws(
    () => assertRegressionGatePasses(report),
    (error) => error.code === 'release_gate.high_risk_regression',
  );
});

test('regression release gate allows unchanged snapshots', () => {
  const snapshot = baselineSnapshot();
  const report = runRuntimeRegressionHarness({
    reportId: 'runtime-ci-regression:release-gate-pass',
    cases: [{ caseId: 'release-gate-pass', previous: snapshot, next: clone(snapshot) }],
  });

  assert.equal(report.status, 'passed');
  assert.equal(assertRegressionGatePasses(report), true);
});

test('release gate blocks raw canary leakage', () => {
  assert.throws(
    () => assertNoReleaseGateCanaryLeakage({
      safe: false,
      value: 'sf_release_cookie_secret_123',
    }),
    (error) => error.code === 'release_gate.raw_canary_leakage',
  );
  assert.throws(
    () => assertNoReleaseGateCanaryLeakage({
      safe: false,
      value: 'sf_prod_vault_token_secret_456',
    }),
    (error) => error.code === 'release_gate.raw_canary_leakage',
  );
  assert.equal(assertNoReleaseGateCanaryLeakage({ value: 'sanitized_summary_only' }), true);
});

test('release gate checks production payment and destructive provider absence', async () => {
  await assert.doesNotReject(() => assertProductionProtectedProvidersAbsent());
});

test('release gate checks runtime index export boundary', () => {
  assert.equal(assertRuntimeIndexExportBoundary(runtimeIndex), true);
  assert.throws(
    () => assertRuntimeIndexExportBoundary({
      createFakeRuntimeProvider: () => {},
    }),
    (error) => error.code === 'release_gate.runtime_index_testing_export',
  );
  assert.throws(
    () => assertRuntimeIndexExportBoundary({
      createInMemoryProductionVaultAdapter: () => {},
    }),
    (error) => error.code === 'release_gate.runtime_index_testing_export',
  );
});

test('release gate does not require live optional smoke by default', () => {
  assert.equal(shouldRunOptionalLiveSmoke({}), false);
  assert.equal(VERIFY_RELEASE_COMMANDS.some((entry) => entry.liveOptional === true), false);
});

test('optional live smoke remains opt-in', () => {
  assert.equal(shouldRunOptionalLiveSmoke({ [OPTIONAL_LIVE_SMOKE_ENV]: '1' }), true);
  assert.equal(shouldRunOptionalLiveSmoke({ [OPTIONAL_LIVE_SMOKE_ENV]: 'true' }), true);
  assert.equal(shouldRunOptionalLiveSmoke({ [OPTIONAL_LIVE_SMOKE_ENV]: '0' }), false);
});

test('existing release scripts are not weakened', async () => {
  const { scripts } = await readPackageJson();
  const releaseLocal = scripts['release:local'];

  for (const expected of [
    'npm run readme:check',
    'npm run typecheck',
    'npm run check:syntax',
    'npm run verify:release',
    'npm run test:node:focused',
    'npm run test:node:all',
    'npm run test:python',
    'npm run scan:secrets',
    'git diff --check',
  ]) {
    assert.match(releaseLocal, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
  assert.equal(RUNTIME_TRUST_TESTS.length > 0, true);
  assert.equal(RUNTIME_PRODUCTIZATION_TESTS.length > 0, true);
  assert.equal(RUNTIME_REGRESSION_TESTS.includes('tests/node/runtime-ci-regression-harness-v1.test.mjs'), true);
});

test('release gate docs and existing workflow reference the integrated gate path', async () => {
  const docs = await readFile(RELEASE_GATES_DOC_URL, 'utf8');
  const workflow = await readFile(WORKFLOW_URL, 'utf8');

  assert.match(docs, /npm run verify:release/u);
  assert.match(docs, /SITEFORGE_OPTIONAL_LIVE_SMOKE/u);
  assert.match(docs, /production payment or destructive providers/u);
  assert.match(workflow, /npm run release:local/u);
});
