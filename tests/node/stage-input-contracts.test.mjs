import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import { capture } from '../../src/pipeline/stages/capture.mjs';
import { collectBookContent, parseCliArgs as parseCollectCliArgs } from '../../src/pipeline/stages/collect-content.mjs';

const REPO_ROOT = process.cwd();

const STAGE_CONTRACTS = [
  ['src/entrypoints/pipeline/capture.mjs', 'src/pipeline/stages/capture.mjs'],
  ['src/entrypoints/pipeline/expand-states.mjs', 'src/pipeline/stages/expand.mjs'],
  ['src/entrypoints/pipeline/collect-book-content.mjs', 'src/pipeline/stages/collect-content.mjs'],
  ['src/entrypoints/pipeline/analyze-states.mjs', 'src/pipeline/stages/analyze.mjs'],
  ['src/entrypoints/pipeline/abstract-interactions.mjs', 'src/pipeline/stages/abstract.mjs'],
  ['src/entrypoints/pipeline/nl-entry.mjs', 'src/pipeline/stages/nl.mjs'],
  ['src/entrypoints/pipeline/generate-docs.mjs', 'src/pipeline/stages/docs.mjs'],
  ['src/entrypoints/pipeline/govern-interactions.mjs', 'src/pipeline/stages/governance.mjs'],
  ['src/entrypoints/pipeline/compile-wiki.mjs', 'src/pipeline/stages/kb/index.mjs'],
  ['src/entrypoints/pipeline/generate-skill.mjs', 'src/pipeline/stages/skill.mjs'],
];

test('pipeline stage implementations no longer depend on entrypoint modules', async () => {
  for (const [, stage] of STAGE_CONTRACTS) {
    const source = await readFile(path.join(REPO_ROOT, stage), 'utf8');
    assert.equal(
      /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"][^'"]*entrypoints\/pipeline/iu.test(source),
      false,
      `${stage} should not import pipeline entrypoints`,
    );
  }
});

test('pipeline entrypoints point at the canonical stage modules', async () => {
  for (const [entrypoint, stage] of STAGE_CONTRACTS) {
    const source = await readFile(path.join(REPO_ROOT, entrypoint), 'utf8');
    const normalizedStage = stage.replace(/^src\//u, '').replaceAll('\\', '/');
    assert.match(
      source,
      new RegExp(normalizedStage.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
      `${entrypoint} should reference ${stage}`,
    );
  }
});

test('capture returns an INVALID_INPUT manifest from the canonical stage when url parsing fails', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-contract-'));

  try {
    const manifest = await capture('not-a-url', {
      outDir: path.join(workspace, 'capture-out'),
    });
    assert.equal(manifest.status, 'failed');
    assert.equal(manifest.error?.code, 'INVALID_INPUT');
    assert.match(manifest.outDir, /capture-out/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('collectBookContent returns an empty summary from the canonical stage when no expanded input exists and fallback is disabled', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-collect-content-contract-'));

  try {
    const result = await collectBookContent('https://jable.tv/', {
      expandedStatesDir: path.join(workspace, 'missing-expanded'),
      outDir: path.join(workspace, 'book-content-out'),
      skipFallback: true,
    });
    assert.equal(result.summary.books, 0);
    assert.equal(result.summary.authors, 0);
    assert.equal(result.summary.queries, 0);
    assert.match(result.outDir, /book-content-out/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('collect-content stage CLI parser remains available from the canonical stage module', () => {
  const parsed = parseCollectCliArgs(['https://jable.tv/', '--expanded-dir', 'expanded', '--search-query', 'keyword']);
  assert.equal(parsed.command, 'collect');
  assert.equal(parsed.inputUrl, 'https://jable.tv/');
  assert.equal(parsed.options.expandedStatesDir, 'expanded');
  assert.deepEqual(parsed.options.searchQueries, ['keyword']);
});
