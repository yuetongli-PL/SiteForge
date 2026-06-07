#!/usr/bin/env node
// @ts-check

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const RUNTIME_TRUST_TESTS = Object.freeze([
  'tests/node/capability-contract-conformance.test.mjs',
  'tests/node/capability-package-site-adapter-registry-v1.test.mjs',
  'tests/node/policy-pack-authoring-simulation-v1.test.mjs',
  'tests/node/runtime-audit-query-api-v1.test.mjs',
  'tests/node/provider-plugin-api-adapter-sdk-v1.test.mjs',
]);

export const RUNTIME_PRODUCTIZATION_TESTS = Object.freeze([
  'tests/node/siteforge-runtime-productization-e2e-v1.test.mjs',
  'tests/node/external-skill-api-local-service-v1.test.mjs',
  'tests/node/first-party-site-package-pilot-v1.test.mjs',
  'tests/node/skill-runtime-invocation-api-v1.test.mjs',
  'tests/node/runtime-operations-run-store-v1.test.mjs',
  'tests/node/runtime-worker-isolation-provider-sandbox-v1.test.mjs',
  'tests/node/documentation-runtime-productization-v1.test.mjs',
  'tests/node/payment-authorization-lab-threat-model-v1.test.mjs',
]);

export const RUNTIME_REGRESSION_TESTS = Object.freeze([
  'tests/node/runtime-ci-regression-harness-v1.test.mjs',
  'tests/node/ci-release-gate-integration-v1.test.mjs',
]);

export const RUNTIME_TEST_GROUPS = Object.freeze({
  trust: RUNTIME_TRUST_TESTS,
  productization: RUNTIME_PRODUCTIZATION_TESTS,
  regression: RUNTIME_REGRESSION_TESTS,
});

export function createNodeTestCommand(testFiles = []) {
  return {
    command: process.execPath,
    args: ['--test', '--test-concurrency=1', ...testFiles],
  };
}

function normalizeGroup(value = '') {
  const text = String(value ?? '').trim();
  return Object.hasOwn(RUNTIME_TEST_GROUPS, text) ? text : 'all';
}

export function selectedRuntimeTestGroups(argv = []) {
  const groupFlagIndex = argv.indexOf('--group');
  if (groupFlagIndex === -1) {
    return ['all'];
  }
  return [normalizeGroup(argv[groupFlagIndex + 1])];
}

export function runtimeTestFilesForGroups(groups = ['all']) {
  const normalized = groups.map(normalizeGroup);
  const names = normalized.includes('all')
    ? ['trust', 'productization', 'regression']
    : normalized;
  return [...new Set(names.flatMap((name) => RUNTIME_TEST_GROUPS[name] ?? []))];
}

export function runRuntimeProductizationRegression({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  stdio = 'inherit',
} = {}) {
  const groups = selectedRuntimeTestGroups(argv);
  const testFiles = runtimeTestFilesForGroups(groups);
  const command = createNodeTestCommand(testFiles);
  return spawnSync(command.command, command.args, {
    cwd,
    stdio: /** @type {import('node:child_process').StdioOptions} */ (stdio),
    shell: false,
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const result = runRuntimeProductizationRegression();
  process.exitCode = result.status ?? 1;
}
