import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const SCRIPT = path.join(process.cwd(), 'src', 'entrypoints', 'build', 'run-build.mjs');

function runBuildCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
}

test('build CLI rejects missing numeric values before consuming following flags', () => {
  const result = runBuildCli(['https://example.com/', '--timeout', '--json']);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing value for --timeout/u);
});

test('build CLI rejects non-finite numeric values', () => {
  for (const value of ['NaN', 'Infinity']) {
    const result = runBuildCli(['https://example.com/', '--timeout', value]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--timeout must be a finite integer/u);
  }
});

test('build CLI rejects removed legacy flags as unknown arguments', () => {
  for (const flag of ['--idle-ms', '--max-triggers', '--max-captured-states', '--chapter-fetch-concurrency']) {
    const result = runBuildCli(['https://example.com/', flag, '1']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`未知参数: ${flag}`, 'u'));
    assert.doesNotMatch(result.stderr, /legacy|retired|pipeline chain/iu);
  }
});
