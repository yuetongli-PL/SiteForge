import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const SCRIPT = path.join(process.cwd(), 'src', 'entrypoints', 'pipeline', 'run-pipeline.mjs');

function runPipelineCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
}

test('build CLI rejects missing numeric values before consuming following flags', () => {
  const result = runPipelineCli(['https://example.com/', '--timeout', '--json']);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing value for --timeout/u);
});

test('build CLI rejects non-finite numeric values', () => {
  for (const value of ['NaN', 'Infinity']) {
    const result = runPipelineCli(['https://example.com/', '--timeout', value]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--timeout must be a finite integer/u);
  }
});

test('build CLI rejects invalid retired legacy numeric options before runtime options are built', () => {
  const maxTriggers = runPipelineCli(['https://example.com/', '--max-triggers', '-1']);
  assert.notEqual(maxTriggers.status, 0);
  assert.match(maxTriggers.stderr, /--max-triggers must be at least 0/u);

  const chapterConcurrency = runPipelineCli(['https://example.com/', '--chapter-fetch-concurrency', '0']);
  assert.notEqual(chapterConcurrency.status, 0);
  assert.match(chapterConcurrency.stderr, /--chapter-fetch-concurrency must be at least 1/u);
});
