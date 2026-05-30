import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');

test('retired skill coverage regression gate source stays removed', async () => {
  await assert.rejects(
    () => stat(path.join(REPO_ROOT, 'src', 'skills', 'generation', 'coverage-regression-gate.mjs')),
    { code: 'ENOENT' },
  );
});
