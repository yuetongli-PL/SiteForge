import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import { buildExampleStageSpec, compileFixtureKnowledgeBase } from './kb-test-fixtures.mjs';
import { assertRepoMetadataUnchanged, captureRepoMetadataSnapshot } from './helpers/site-metadata-sandbox.mjs';

const repoRoot = process.cwd();

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

test('run-pipeline CLI keeps help and missing-url behavior compatible', async () => {
  const help = runNodeCli(path.join('src', 'entrypoints', 'pipeline', 'run-pipeline.mjs'), ['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage:\s+node src[\\/]entrypoints[\\/]pipeline[\\/]run-pipeline\.mjs <url>/u);

  const missingUrl = runNodeCli(path.join('src', 'entrypoints', 'pipeline', 'run-pipeline.mjs'), []);
  assert.equal(missingUrl.status, 1);
  assert.match(missingUrl.stdout, /Usage:\s+node src[\\/]entrypoints[\\/]pipeline[\\/]run-pipeline\.mjs <url>/u);
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

test('site-doctor and site-scaffold CLIs expose stable help output', () => {
  const doctorHelp = runNodeCli(path.join('scripts', 'site-doctor.mjs'), ['--help']);
  assert.equal(doctorHelp.status, 0);
  assert.match(doctorHelp.stdout, /node src[\\/]entrypoints[\\/]sites[\\/]site-doctor\.mjs <url>/u);

  const scaffoldHelp = runNodeCli(path.join('scripts', 'site-scaffold.mjs'), ['--help']);
  assert.equal(scaffoldHelp.status, 0);
  assert.match(scaffoldHelp.stdout, /node src[\\/]entrypoints[\\/]sites[\\/]site-scaffold\.mjs <url> --archetype/u);
});
