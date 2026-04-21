import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import {
  TRANSIENT_CLEANUP_TARGETS,
  buildSummary,
  cleanTransientOutputs,
  parseCliArgs,
  pathExists,
} from '../../tools/clean-transient-outputs.mjs';

test('parseCliArgs accepts dry-run and keep-empty-dirs flags', () => {
  const parsed = parseCliArgs(['--dry-run', '--keep-empty-dirs']);
  assert.equal(parsed.help, false);
  assert.equal(parsed.options.dryRun, true);
  assert.equal(parsed.options.keepEmptyDirs, true);
});

test('cleanTransientOutputs removes transient contents but leaves non-target data alone', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-cleanup-tool-'));

  try {
    for (const relativePath of TRANSIENT_CLEANUP_TARGETS) {
      const target = path.join(workspace, relativePath);
      await mkdir(target, { recursive: true });
      await writeFile(path.join(target, 'marker.txt'), 'transient');
    }

    const keepDir = path.join(workspace, 'profiles');
    await mkdir(keepDir, { recursive: true });
    await writeFile(path.join(keepDir, 'keep.txt'), 'truth');

    const result = await cleanTransientOutputs({
      repoRoot: workspace,
      keepEmptyDirs: true,
    });
    const summary = buildSummary(result);

    assert.equal(summary.removedCount, TRANSIENT_CLEANUP_TARGETS.length);
    assert.equal(summary.recreatedCount, TRANSIENT_CLEANUP_TARGETS.length);
    assert.equal(await pathExists(path.join(keepDir, 'keep.txt')), true);

    for (const relativePath of TRANSIENT_CLEANUP_TARGETS) {
      const target = path.join(workspace, relativePath);
      assert.equal(await pathExists(target), true, `${relativePath} should exist after recreation`);
      assert.equal(await pathExists(path.join(target, 'marker.txt')), false, `${relativePath} marker should be removed`);
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('cleanTransientOutputs dry-run leaves files untouched', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-cleanup-tool-dryrun-'));

  try {
    const target = path.join(workspace, 'archive');
    await mkdir(target, { recursive: true });
    const markerPath = path.join(target, 'marker.txt');
    await writeFile(markerPath, 'transient');

    const result = await cleanTransientOutputs({
      repoRoot: workspace,
      dryRun: true,
    });
    const summary = buildSummary(result);

    assert.equal(summary.removed.includes('archive'), true);
    assert.equal(await pathExists(markerPath), true);
    assert.equal(await readFile(markerPath, 'utf8'), 'transient');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('cleanTransientOutputs removes nested __pycache__ directories across the repo', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-cleanup-tool-pycache-'));

  try {
    const nestedPycache = path.join(workspace, 'src', 'sites', 'demo', '__pycache__');
    await mkdir(nestedPycache, { recursive: true });
    await writeFile(path.join(nestedPycache, 'cache.pyc'), 'compiled');

    const gitPycache = path.join(workspace, '.git', '__pycache__');
    await mkdir(gitPycache, { recursive: true });
    await writeFile(path.join(gitPycache, 'cache.pyc'), 'ignored');

    const result = await cleanTransientOutputs({
      repoRoot: workspace,
      keepEmptyDirs: false,
    });
    const summary = buildSummary(result);

    assert.equal(summary.removed.includes(path.join('src', 'sites', 'demo', '__pycache__')), true);
    assert.equal(await pathExists(nestedPycache), false);
    assert.equal(await pathExists(gitPycache), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
