import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('project overview docs are generated from the current config and architecture template', () => {
  const result = spawnSync('node', ['tools/generate-project-docs.mjs', '--check'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /generated docs are current/u);
});
