import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  readJsonFile,
  readJsonFileIfExists,
  writeJsonFile,
} from '../../src/infra/io.mjs';

async function withTempDir(t) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'siteforge-io-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  return rootDir;
}

test('readJsonFile tolerates a UTF-8 BOM', async (t) => {
  const rootDir = await withTempDir(t);
  const filePath = path.join(rootDir, 'payload.json');
  await writeFile(filePath, '\uFEFF{"ok":true}\n', 'utf8');

  assert.deepEqual(await readJsonFile(filePath), { ok: true });
});

test('readJsonFileIfExists returns fallback only when the file is absent', async (t) => {
  const rootDir = await withTempDir(t);
  const filePath = path.join(rootDir, 'nested', 'payload.json');

  assert.equal(await readJsonFileIfExists(filePath, 'fallback'), 'fallback');
  await writeJsonFile(filePath, { count: 2 });

  assert.deepEqual(await readJsonFileIfExists(filePath, 'fallback'), { count: 2 });
  assert.equal(await readFile(filePath, 'utf8'), '{\n  "count": 2\n}\n');
});
