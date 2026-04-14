import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { buildError, buildWarning } from '../../lib/wiki-report.mjs';
import { firstExistingPath, kbAbsolute, relativeToKb, resolveMaybeRelative } from '../../lib/wiki-paths.mjs';

test('wiki-report builders normalize string details', () => {
  assert.deepEqual(buildWarning('missing-summary', 'Summary missing', '/tmp/page.md'), {
    severity: 'warning',
    code: 'missing-summary',
    message: 'Summary missing',
    path: '/tmp/page.md',
  });
  assert.deepEqual(buildError('broken-link', 'Broken link', { path: '/tmp/page.md', ref: 'raw/foo' }), {
    severity: 'error',
    code: 'broken-link',
    message: 'Broken link',
    path: '/tmp/page.md',
    ref: 'raw/foo',
  });
});

test('wiki-path helpers resolve kb-relative paths', async () => {
  const root = path.join(os.tmpdir(), `browser-wiki-skill-wiki-paths-${Date.now()}`);
  const kbDir = path.join(root, 'knowledge-base', 'example.com');
  const rawDir = path.join(kbDir, 'raw', 'step-1-capture', 'run-1');
  await mkdir(rawDir, { recursive: true });
  const manifestPath = path.join(rawDir, 'manifest.json');
  await writeFile(manifestPath, '{}', 'utf8');

  assert.equal(relativeToKb(kbDir, manifestPath), 'raw/step-1-capture/run-1/manifest.json');
  assert.equal(kbAbsolute(kbDir, 'raw/step-1-capture/run-1/manifest.json'), manifestPath);
  assert.equal(resolveMaybeRelative('manifest.json', rawDir), manifestPath);
  assert.equal(
    await firstExistingPath([
      { value: 'missing.json', baseDir: rawDir },
      { value: 'manifest.json', baseDir: rawDir },
    ]),
    manifestPath,
  );
});
