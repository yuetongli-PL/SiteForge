import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import { resolveCliDispatch } from '../../src/entrypoints/cli/index.mjs';
import { buildExampleStageSpec, compileFixtureKnowledgeBase } from './kb-test-fixtures.mjs';
import { assertRepoMetadataUnchanged, captureRepoMetadataSnapshot } from './helpers/site-metadata-sandbox.mjs';

const repoRoot = process.cwd();
const PUBLIC_BUILD_FLAGS = ['--auto', '--deep', '--network', '--manual', '--explain', '--verbose', '--debug'];
const LEGACY_PUBLIC_ROUTES = [
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

function parseJsonStdout(result) {
  const stdout = String(result.stdout ?? '').trim();
  return stdout ? JSON.parse(stdout) : null;
}

test('internal run-pipeline CLI keeps help and missing-url behavior compatible', async () => {
  const help = runNodeCli(path.join('src', 'entrypoints', 'pipeline', 'run-pipeline.mjs'), ['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /用法:\s+node src\/entrypoints\/pipeline\/run-pipeline\.mjs <url> \[internal options\]/u);
  assert.match(help.stdout, /公开命令:\s+siteforge build <url>/u);

  const missingUrl = runNodeCli(path.join('src', 'entrypoints', 'pipeline', 'run-pipeline.mjs'), []);
  assert.equal(missingUrl.status, 1);
  assert.match(missingUrl.stdout, /用法:\s+node src\/entrypoints\/pipeline\/run-pipeline\.mjs <url> \[internal options\]/u);
  assert.match(missingUrl.stdout, /公开命令:\s+siteforge build <url>/u);
});

test('compile-wiki CLI lint command returns JSON summary', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-cli-compile-'));
  const repoMetadataSnapshot = await captureRepoMetadataSnapshot();

  try {
    const fixture = await compileFixtureKnowledgeBase(workspace, buildExampleStageSpec());
    const kbDir = fixture.kbDir;
    const reportDir = path.join(workspace, 'reports');
    const result = runNodeCli(path.join('src', 'entrypoints', 'pipeline', 'compile-wiki.mjs'), ['lint', '--kb-dir', kbDir, '--report-dir', reportDir], {
      cwd: workspace,
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = parseJsonStdout(result);
    assert.equal(path.resolve(payload.kbDir), path.resolve(kbDir));
    assert.equal(typeof payload.passed, 'boolean');
    assert.ok(Number.isInteger(payload.errors));
    assert.ok(Number.isInteger(payload.warnings));
    await assertRepoMetadataUnchanged(repoMetadataSnapshot);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('generate-skill CLI returns the expected summary shape', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-cli-skill-'));
  const repoMetadataSnapshot = await captureRepoMetadataSnapshot();

  try {
    const spec = buildExampleStageSpec();
    const fixture = await compileFixtureKnowledgeBase(workspace, spec);
    const result = runNodeCli(
      path.join('src', 'entrypoints', 'pipeline', 'generate-skill.mjs'),
      [
        spec.inputUrl,
        '--kb-dir',
        fixture.kbDir,
        '--out-dir',
        path.join(workspace, 'skills', 'example-cli'),
        '--skill-name',
        'example-cli',
      ],
      { cwd: workspace },
    );

    assert.equal(result.status, 0, result.stderr);
    const payload = parseJsonStdout(result);
    assert.equal(payload.skillName, 'example-cli');
    assert.equal(path.basename(payload.skillDir), 'example-cli');
    assert.deepEqual(payload.references, [
      'references/index.md',
      'references/flows.md',
      'references/recovery.md',
      'references/approval.md',
      'references/nl-intents.md',
      'references/interaction-model.md',
    ]);
    assert.ok(Array.isArray(payload.warnings));
    await assertRepoMetadataUnchanged(repoMetadataSnapshot);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('public SiteForge CLI exposes only build help', () => {
  const help = runNodeCli(path.join('src', 'entrypoints', 'cli', 'index.mjs'), ['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /siteforge build <url>/u);
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

test('public SiteForge CLI accepts build flags and rejects legacy public routes at runtime', () => {
  for (const flag of PUBLIC_BUILD_FLAGS) {
    const dispatch = resolveCliDispatch(['build', 'https://example.com/', flag]);
    assert.equal(path.basename(dispatch.script), 'run-pipeline.mjs');
    assert.deepEqual(dispatch.args, ['https://example.com/', flag]);
  }

  assert.deepEqual(
    resolveCliDispatch(['build', 'https://example.com/', '--privacy', 'limited', '--report', 'both']).args,
    ['https://example.com/', '--privacy', 'limited', '--report', 'both'],
  );
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
  assert.throws(
    () => resolveCliDispatch(['build', 'https://example.com/', 'extra']),
    /Unsupported argument: extra/u,
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
