import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

async function readRepoFile(...segments) {
  return await readFile(path.resolve(...segments), 'utf8');
}

test('remaining work status is consolidated into the matrix instead of short-lived docs', async () => {
  const matrix = await readRepoFile('CONTRIBUTING.md');

  for (const expected of [
    '14 non-Douyin remaining items',
    'Xiaohongshu fresh evidence',
    'Bilibili UP-space',
    'native-miss-diagnostics-v1',
    'profile-health-risk',
    'repo-local skills',
  ]) {
    assert.equal(matrix.includes(expected), true, `${expected} should remain recorded in the matrix`);
  }

  assert.equal(/raw cookies|authorization headers|CAPTCHA bypass/iu.test(matrix), true);
});

test('manual profile health recovery boundaries live in contributor guidance', async () => {
  const contributing = await readRepoFile('CONTRIBUTING.md');

  for (const expected of [
    'Do not delete, rebuild, or mutate a browser profile automatically.',
    'Do not bypass CAPTCHA',
    'Do not extract or persist raw cookies',
    'social-health-watch.mjs --site x',
    'social-health-watch.mjs --site instagram',
    'bilibili-action.mjs login',
  ]) {
    assert.equal(contributing.includes(expected), true, `${expected} should be present`);
  }
});

test('skill sync policy documents project-local source and avoids implicit global writes', async () => {
  const contributing = await readRepoFile('CONTRIBUTING.md');

  assert.match(contributing, /Work only inside\s+this project directory/u);
  for (const skill of ['bilibili', 'xiaohongshu-explore', 'x', 'instagram']) {
    assert.equal(contributing.includes(`skills/${skill}/SKILL.md`), true);
  }
  assert.equal(contributing.includes('Manual sync command, when explicitly allowed'), true);
});
