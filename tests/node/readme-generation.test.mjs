import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('project README is generated from the current config', () => {
  const result = spawnSync(process.execPath, ['tools/generate-readme.mjs', '--check'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Generated README is current/u);
});
