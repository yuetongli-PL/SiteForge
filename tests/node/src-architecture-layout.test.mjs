import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, readdir, stat } from 'node:fs/promises';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');

async function expectPathExists(relativePath) {
  const targetPath = path.join(REPO_ROOT, relativePath);
  const stats = await stat(targetPath);
  assert.ok(stats, `Expected path to exist: ${relativePath}`);
}

async function expectPathMissing(relativePath) {
  const targetPath = path.join(REPO_ROOT, relativePath);
  await assert.rejects(() => stat(targetPath), { code: 'ENOENT' });
}

test('src-first code layout exists', async () => {
  await Promise.all([
    expectPathExists('src/entrypoints'),
    expectPathExists('src/pipeline'),
    expectPathExists('src/sites'),
    expectPathExists('src/infra'),
    expectPathExists('src/shared'),
    expectPathExists('src/skills'),
  ]);
});

test('site and auth modules are organized under src', async () => {
  await Promise.all([
    expectPathExists('src/sites/core'),
    expectPathExists('src/sites/douyin'),
    expectPathExists('src/sites/bilibili'),
    expectPathExists('src/infra/auth/site-auth.mjs'),
    expectPathExists('src/infra/auth/site-session-governance.mjs'),
    expectPathExists('src/infra/auth/auth-keepalive-preflight.mjs'),
    expectPathExists('src/infra/auth/windows-credential-manager.mjs'),
  ]);
});

test('root truth and output boundaries stay outside src', async () => {
  await Promise.all([
    expectPathExists('profiles'),
    expectPathExists('schema'),
    expectPathExists('config'),
    expectPathExists('docs'),
    expectPathExists('tools'),
    expectPathExists('runs'),
    expectPathExists('config/site-registry.json'),
    expectPathExists('config/site-capabilities.json'),
    expectPathExists('crawler-scripts'),
    expectPathExists('knowledge-base'),
    expectPathExists('book-content'),
    expectPathExists('skills'),
    expectPathMissing('site-registry.json'),
    expectPathMissing('site-capabilities.json'),
    expectPathMissing('src/profiles'),
    expectPathMissing('src/schema'),
    expectPathMissing('src/site-registry.json'),
    expectPathMissing('src/site-capabilities.json'),
    expectPathMissing('src/crawler-scripts'),
    expectPathMissing('src/knowledge-base'),
    expectPathMissing('src/book-content'),
  ]);
});

test('root only keeps README.md and .gitignore as regular files', async () => {
  const entries = await readdir(REPO_ROOT, { withFileTypes: true });
  const regularFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(regularFiles, ['.gitignore', 'README.md']);
});

test('retired compatibility directories stay removed', async () => {
  await Promise.all([
    expectPathMissing('downloaders'),
    expectPathMissing('lib'),
  ]);
});

test('site modules and pipeline runtime do not depend directly on entrypoint modules', async () => {
  const sourceChecks = [
    ['src/sites/bilibili/actions/router.mjs', 'entrypoints/sites'],
    ['src/sites/douyin/actions/router.mjs', 'entrypoints/sites'],
    ['src/pipeline/runtime/create-default-runtime.mjs', 'entrypoints/sites/site-keepalive.mjs'],
  ];

  for (const [relativePath, forbiddenText] of sourceChecks) {
    const source = await readFile(path.join(REPO_ROOT, relativePath), 'utf8');
    assert.equal(
      source.includes(forbiddenText),
      false,
      `${relativePath} should not reference ${forbiddenText} directly`,
    );
  }
});

test('canonical src modules own pipeline options and profile validation implementations', async () => {
  const sourceChecks = [
    ['src/pipeline/engine/options.mjs', 'lib/pipeline/options.mjs'],
    ['src/sites/core/profile-validation.mjs', 'lib/profile-validation.mjs'],
    ['src/infra/browser/benchmark-report.mjs', 'lib/browser-runtime/benchmark-report.mjs'],
    ['src/infra/browser/cdp-client.mjs', 'lib/browser-runtime/cdp-client.mjs'],
    ['src/infra/browser/launcher.mjs', 'lib/browser-runtime/launcher.mjs'],
    ['src/infra/browser/profile-store.mjs', 'lib/browser-runtime/profile-store.mjs'],
    ['src/infra/browser/session.mjs', 'lib/browser-runtime/session.mjs'],
    ['src/sites/bilibili/model/diagnosis.mjs', 'lib/sites/bilibili/diagnosis.mjs'],
    ['src/sites/bilibili/model/surfacing.mjs', 'lib/sites/bilibili/surfacing.mjs'],
    ['src/sites/douyin/model/diagnosis.mjs', 'lib/sites/douyin/site.mjs'],
    ['src/infra/cli.mjs', 'lib/cli.mjs'],
    ['src/infra/io.mjs', 'lib/io.mjs'],
    ['src/shared/normalize.mjs', 'lib/normalize.mjs'],
    ['src/shared/markdown.mjs', 'lib/markdown.mjs'],
    ['src/shared/wiki.mjs', 'lib/wiki-paths.mjs'],
  ];

  for (const [relativePath, forbiddenText] of sourceChecks) {
    const source = await readFile(path.join(REPO_ROOT, relativePath), 'utf8');
    assert.equal(
      source.includes(forbiddenText),
      false,
      `${relativePath} should not remain a lib wrapper`,
    );
  }
});

test('retired root compatibility entrypoints stay removed', async () => {
  await Promise.all([
    expectPathMissing('run-pipeline.mjs'),
    expectPathMissing('generate-skill.mjs'),
    expectPathMissing('capture.mjs'),
    expectPathMissing('expand-states.mjs'),
    expectPathMissing('query-douyin-follow.mjs'),
    expectPathMissing('query-jable-ranking.mjs'),
    expectPathMissing('download_book.py'),
    expectPathMissing('download_bilibili.py'),
    expectPathMissing('download_douyin.py'),
    expectPathMissing('site_context.py'),
    expectPathExists('scripts/site-login.mjs'),
    expectPathExists('scripts/site-keepalive.mjs'),
    expectPathExists('scripts/site-doctor.mjs'),
  ]);
});

test('flat site aliases and old microdirectories stay removed', async () => {
  await Promise.all([
    expectPathMissing('src/sites/douyin/action-router.mjs'),
    expectPathMissing('src/sites/douyin/download-enumerator.mjs'),
    expectPathMissing('src/sites/douyin/follow-query.mjs'),
    expectPathMissing('src/sites/douyin/live-export.mjs'),
    expectPathMissing('src/sites/douyin/media-resolver.mjs'),
    expectPathMissing('src/sites/douyin/site.mjs'),
    expectPathMissing('src/sites/bilibili/action-router.mjs'),
    expectPathMissing('src/sites/bilibili/open.mjs'),
    expectPathMissing('src/sites/jable/ranking.mjs'),
    expectPathMissing('src/shared/markdown'),
    expectPathMissing('src/shared/text'),
    expectPathMissing('src/shared/urls'),
    expectPathMissing('src/infra/cli'),
    expectPathMissing('src/infra/fs'),
    expectPathMissing('src/entrypoints/compat'),
  ]);
});
