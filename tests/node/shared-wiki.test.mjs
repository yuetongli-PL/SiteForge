import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  firstExistingPath,
  listDirectories,
  relativeToKb,
  resolveMaybeRelative,
} from '../../src/shared/wiki.mjs';

test('shared wiki helpers resolve paths and inspect directories without infra IO', async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-shared-wiki-'));
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  const kbDir = path.join(workspace, 'kb');
  const alphaDir = path.join(kbDir, 'alpha');
  const betaDir = path.join(kbDir, 'beta');
  await mkdir(alphaDir, { recursive: true });
  await mkdir(betaDir, { recursive: true });
  await writeFile(path.join(kbDir, 'readme.md'), '# ignored\n', 'utf8');

  assert.equal(resolveMaybeRelative('alpha', kbDir), alphaDir);
  assert.equal(relativeToKb(kbDir, path.join(alphaDir, 'note.md')), 'alpha/note.md');
  assert.equal(
    await firstExistingPath([
      { value: 'missing', baseDir: kbDir },
      { value: 'alpha', baseDir: kbDir },
    ]),
    alphaDir,
  );
  assert.deepEqual(await listDirectories(kbDir), [alphaDir, betaDir]);
  assert.deepEqual(await listDirectories(path.join(workspace, 'missing')), []);
});
