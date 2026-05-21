import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import { resolveCliDispatch } from '../../src/entrypoints/cli/index.mjs';
import {
  PUBLIC_BOOLEAN_BUILD_FLAGS,
  PUBLIC_BUILD_HELP_FLAGS,
} from '../../src/entrypoints/cli/public-build-contract.mjs';

const repoRoot = process.cwd();
const INTERNAL_BUILD_FLAGS = [
  '--browser-path',
  '--max-depth',
  '--max-pages',
  '--max-seeds',
  '--json',
  '--quiet',
  '--progress',
];
const LEGACY_PUBLIC_ROUTES = [
  ['capabilities', 'list', 'x-com-authorized-browser-surface'],
  ['site', 'doctor', 'https://example.com/'],
  ['download', 'plan', 'https://example.com/'],
  ['social', 'templates'],
  ['catalog', 'jable-ranking', 'https://example.com/'],
  ['skill', 'https://example.com/'],
  ['doctor', 'https://example.com/'],
];

function runNodeCli(scriptName, args, options = {}) {
  return spawnSync(process.execPath, [path.join(repoRoot, scriptName), ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
}

function assertBuildDispatch(args) {
  const dispatch = resolveCliDispatch(args);
  assert.equal(dispatch.script, path.resolve(repoRoot, 'src', 'entrypoints', 'pipeline', 'run-pipeline.mjs'));
  assert.deepEqual(dispatch.args, args.slice(1));
  return dispatch;
}

function assertResolveError(args, pattern) {
  assert.throws(
    () => resolveCliDispatch(args),
    pattern,
    `${args.join(' ')} should fail with ${pattern}`,
  );
}

test('public SiteForge CLI exposes only build help', () => {
  const help = runNodeCli(path.join('src', 'entrypoints', 'cli', 'index.mjs'), ['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /siteforge build <url>/u);
  for (const flag of PUBLIC_BUILD_HELP_FLAGS) {
    assert.match(help.stdout, new RegExp(flag.replace(/[|]/gu, '\\$&'), 'u'));
  }
  for (const flag of INTERNAL_BUILD_FLAGS) {
    assert.doesNotMatch(help.stdout, new RegExp(flag, 'u'));
  }
  assert.doesNotMatch(help.stdout, /siteforge capabilities/u);
  assert.doesNotMatch(help.stdout, /site doctor|site scaffold|download plan|generate-skill/u);
});

test('public SiteForge CLI runs when invoked through an npm link path', async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-linked-cli-'));
  try {
    const nodeModulesDir = path.join(workspace, 'node_modules');
    const linkedPackageDir = path.join(nodeModulesDir, 'siteforge');
    await mkdir(nodeModulesDir, { recursive: true });
    try {
      await symlink(repoRoot, linkedPackageDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (['EPERM', 'ENOTSUP'].includes(error?.code)) {
        t.skip(`cannot create linked package path on this filesystem: ${error.code}`);
        return;
      }
      throw error;
    }

    const result = spawnSync(
      process.execPath,
      [path.join(linkedPackageDir, 'src', 'entrypoints', 'cli', 'index.mjs'), '--help'],
      {
        cwd: workspace,
        encoding: 'utf8',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /siteforge build <url>/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('public SiteForge CLI help routes stay available', () => {
  for (const args of [
    [],
    ['--help'],
    ['build'],
    ['build', '--help'],
  ]) {
    const dispatch = resolveCliDispatch(args);
    assert.match(dispatch.help, /siteforge build <url>/u);
  }
});

test('public SiteForge CLI accepts only documented build flags', () => {
  assertBuildDispatch(['build', 'https://example.com/']);

  for (const flag of PUBLIC_BOOLEAN_BUILD_FLAGS) {
    assertBuildDispatch(['build', 'https://example.com/', flag]);
  }

  for (const args of [
    ['build', 'https://example.com/', '--privacy', 'limited'],
    ['build', 'https://example.com/', '--privacy=limited'],
    ['build', 'https://example.com/', '--privacy', 'strict'],
    ['build', 'https://example.com/', '--report', 'user'],
    ['build', 'https://example.com/', '--report=user'],
    ['build', 'https://example.com/', '--report', 'debug'],
    ['build', 'https://example.com/', '--report', 'both'],
    ['build', 'https://example.com/', '--privacy', 'limited', '--report', 'both'],
  ]) {
    assertBuildDispatch(args);
  }
});

test('public SiteForge CLI rejects unsupported build arguments before dispatch', () => {
  for (const args of [
    ['build', 'https://example.com/', '--unknown'],
    ['build', 'https://example.com/', '--unknown=value'],
    ['build', 'https://example.com/', '--browser-path'],
  ]) {
    assertResolveError(args, /Unknown flag: --/u);
  }

  for (const args of [
    ['build', 'https://example.com/', '--privacy'],
    ['build', 'https://example.com/', '--privacy='],
    ['build', 'https://example.com/', '--privacy', '--debug'],
  ]) {
    assertResolveError(args, /Missing value for --privacy/u);
  }

  assertResolveError(['build', 'https://example.com/', '--privacy', 'invalid'], /--privacy must be one of: limited, strict/u);
  assertResolveError(['build', 'https://example.com/', '--report', 'invalid'], /--report must be one of: user, debug, both/u);
  assertResolveError(['build', 'https://example.com/', '--auto=false'], /Flag does not take a value: --auto/u);
  assertResolveError(['build', 'https://example.com/', '--manual=true'], /Flag does not take a value: --manual/u);
  assertResolveError(['build', 'https://example.com/', '--deep=1'], /Flag does not take a value: --deep/u);
  assertResolveError(['build', 'https://example.com/', '-x'], /Unknown flag: -x/u);
  assertResolveError(['build', 'https://example.com/', '-bad'], /Unknown flag: -bad/u);
  assertResolveError(['build', 'https://example.com/', 'extra'], /Unsupported argument: extra/u);
});

test('public SiteForge CLI validates build URL shape before dispatch', () => {
  assertResolveError(['build', 'not-a-url'], /Invalid URL: not-a-url/u);
  assertResolveError(['build', 'ftp:\/\/example.com/'], /Unsupported URL protocol: ftp:/u);
  assertResolveError(['build', 'https://user:pass@example.com/'], /URL must not include credentials/u);
});

test('public SiteForge CLI rejects legacy public routes at runtime', () => {
  assert.throws(
    () => resolveCliDispatch([
      'capabilities',
      'confirm',
      'x-com-authorized-browser-surface',
      '--group',
      'sensitive-read',
      '--limited',
    ]),
    /Unknown command: capabilities/u,
  );

  for (const route of LEGACY_PUBLIC_ROUTES) {
    const result = runNodeCli(path.join('src', 'entrypoints', 'cli', 'index.mjs'), route);
    assert.notEqual(result.status, 0, `${route.join(' ')} unexpectedly succeeded`);
    assert.match(result.stderr, new RegExp(`Unknown command: ${route[0]}`, 'u'));
    assert.match(result.stderr, /siteforge build <url>/u);
  }
});

test('public documentation and user-facing copy do not advertise internal CLI surface', async () => {
  const files = [
    'README.md',
    path.join('src', 'entrypoints', 'cli', 'index.mjs'),
    path.join('src', 'infra', 'cli', 'build-progress.mjs'),
    path.join('src', 'entrypoints', 'pipeline', 'run-pipeline.mjs'),
  ];
  const failures = [];
  for (const file of files) {
    const text = await readFile(path.join(repoRoot, file), 'utf8');
    const lines = text.split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      if (/\bsiteforge\s+(?!build\b)[a-z][\w-]*/u.test(line)) {
        failures.push(`${file}:${index + 1}: ${line.trim()}`);
      }
      if (/siteforge build .* --(?:json|quiet|progress|capability)\b/u.test(line)) {
        failures.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});
