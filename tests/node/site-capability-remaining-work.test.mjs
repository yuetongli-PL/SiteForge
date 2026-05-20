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
    'descriptor-only',
    'StandardTaskList',
    'DownloadPolicy',
    'src/sites/downloads/',
    'src/entrypoints/sites/download.mjs',
    'profile-health-risk',
    'generated-skill tests',
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
    'siteforge build <url>',
    'Public CLI facade: `siteforge build <url>`',
    'Pipeline, skill, crawler, site, social, catalog, and downloader entrypoints',
  ]) {
    assert.equal(contributing.includes(expected), true, `${expected} should be present`);
  }
});

test('skill sync policy documents project-local source and avoids implicit global writes', async () => {
  const contributing = await readRepoFile('CONTRIBUTING.md');

  assert.match(contributing, /Work only inside\s+this project directory/u);
  assert.equal(contributing.includes('src/skills/generation/'), true);
  assert.match(contributing, /Root-level\s+`skills\/`\s+directories are generated site data/u);
  assert.equal(contributing.includes('Manual install or sync must be explicit'), true);
});
