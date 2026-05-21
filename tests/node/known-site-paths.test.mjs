import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';

import {
  BILIBILI_DOWNLOAD_PYTHON_ENTRY,
  BILIBILI_DOWNLOAD_PYTHON_ENTRY_LABEL,
  DOUYIN_DOWNLOAD_PYTHON_ENTRY,
  DOUYIN_DOWNLOAD_PYTHON_ENTRY_LABEL,
  XIAOHONGSHU_DOWNLOAD_PYTHON_ENTRY,
  XIAOHONGSHU_DOWNLOAD_PYTHON_ENTRY_LABEL,
  knownSiteDownloaderPath,
  knownSiteDownloaderRelativePath,
} from '../../src/sites/known-sites/paths.mjs';
import {
  REPO_ROOT as SHARED_REPO_ROOT,
  assertRepoRoot,
  resolveRepoPath,
} from '../../src/infra/paths/repo-root.mjs';
import { mergeOptions as mergeXiaohongshuFollowOptions } from '../../src/sites/known-sites/xiaohongshu/queries/follow-query.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');

async function pathExists(relativePath) {
  const stats = await stat(path.join(REPO_ROOT, relativePath));
  assert.ok(stats.isFile() || stats.isDirectory(), `Expected path to exist: ${relativePath}`);
}

async function pathMissing(relativePath) {
  await assert.rejects(
    () => stat(path.join(REPO_ROOT, relativePath)),
    { code: 'ENOENT' },
    `Expected path to be absent: ${relativePath}`,
  );
}

function knownDownloaderPath(siteKey, fileName) {
  return path.posix.join('src', 'sites', 'known-sites', siteKey, 'download', 'python', fileName);
}

function legacyDownloaderPath(siteKey, fileName) {
  return path.posix.join('src', 'sites', siteKey, 'download', 'python', fileName);
}

async function sourceContains(relativePath, expectedText) {
  const source = await readFile(path.join(REPO_ROOT, relativePath), 'utf8');
  assert.equal(
    source.includes(expectedText),
    true,
    `${relativePath} should reference ${expectedText}`,
  );
}

async function sourceDoesNotContain(relativePath, forbiddenText) {
  const source = await readFile(path.join(REPO_ROOT, relativePath), 'utf8');
  assert.equal(
    source.includes(forbiddenText),
    false,
    `${relativePath} should not reference ${forbiddenText}`,
  );
}

test('known-site downloader entrypoints live under src/sites/known-sites', async () => {
  await Promise.all([
    pathExists(knownDownloaderPath('bilibili', 'bilibili.py')),
    pathExists(knownDownloaderPath('douyin', 'douyin.py')),
    pathExists(knownDownloaderPath('xiaohongshu', 'xiaohongshu.py')),
    pathExists(knownDownloaderPath('chapter-content', 'book.py')),
    pathExists(knownDownloaderPath('shared', 'media_bundle.py')),
  ]);
});

test('old flat known-site downloader paths stay absent', async () => {
  await Promise.all([
    pathMissing(legacyDownloaderPath('bilibili', 'bilibili.py')),
    pathMissing(legacyDownloaderPath('douyin', 'douyin.py')),
    pathMissing(legacyDownloaderPath('xiaohongshu', 'xiaohongshu.py')),
    pathMissing(legacyDownloaderPath('chapter-content', 'book.py')),
    pathMissing(legacyDownloaderPath('shared', 'media_bundle.py')),
  ]);
});

test('known-site downloader path module is the router source of truth', async () => {
  const specs = [
    ['bilibili', 'bilibili.py', BILIBILI_DOWNLOAD_PYTHON_ENTRY, BILIBILI_DOWNLOAD_PYTHON_ENTRY_LABEL],
    ['douyin', 'douyin.py', DOUYIN_DOWNLOAD_PYTHON_ENTRY, DOUYIN_DOWNLOAD_PYTHON_ENTRY_LABEL],
    ['xiaohongshu', 'xiaohongshu.py', XIAOHONGSHU_DOWNLOAD_PYTHON_ENTRY, XIAOHONGSHU_DOWNLOAD_PYTHON_ENTRY_LABEL],
  ];

  for (const [siteKey, fileName, absolutePath, label] of specs) {
    const relativePath = knownDownloaderPath(siteKey, fileName);
    assert.equal(label, relativePath);
    assert.equal(knownSiteDownloaderRelativePath(siteKey), relativePath);
    assert.equal(knownSiteDownloaderPath(siteKey), absolutePath);
    assert.equal(absolutePath, path.join(REPO_ROOT, ...relativePath.split('/')));
    await pathExists(relativePath);
  }

  await Promise.all([
    sourceContains('src/sites/known-sites/bilibili/actions/router.mjs', 'BILIBILI_DOWNLOAD_PYTHON_ENTRY'),
    sourceContains('src/sites/known-sites/douyin/actions/router.mjs', 'DOUYIN_DOWNLOAD_PYTHON_ENTRY'),
    sourceContains('src/sites/known-sites/xiaohongshu/actions/router.mjs', 'XIAOHONGSHU_DOWNLOAD_PYTHON_ENTRY'),
  ]);
});

test('known-site routers do not reference retired flat downloader paths', async () => {
  const routers = [
    'src/sites/known-sites/bilibili/actions/router.mjs',
    'src/sites/known-sites/douyin/actions/router.mjs',
    'src/sites/known-sites/xiaohongshu/actions/router.mjs',
  ];
  const retiredPaths = [
    legacyDownloaderPath('bilibili', 'bilibili.py'),
    legacyDownloaderPath('douyin', 'douyin.py'),
    legacyDownloaderPath('xiaohongshu', 'xiaohongshu.py'),
  ];

  for (const router of routers) {
    for (const retiredPath of retiredPaths) {
      await sourceDoesNotContain(router, retiredPath);
    }
  }
});

test('xiaohongshu action router keeps the repo-root default profile path', async () => {
  await sourceContains(
    'src/sites/known-sites/xiaohongshu/actions/router.mjs',
    "'profiles', 'www.xiaohongshu.com.json'",
  );
});

test('shared repo root resolves to the project root, not src or the parent directory', async () => {
  assert.equal(SHARED_REPO_ROOT, REPO_ROOT);
  assert.equal(assertRepoRoot(SHARED_REPO_ROOT), REPO_ROOT);
  assert.notEqual(SHARED_REPO_ROOT, path.join(REPO_ROOT, 'src'));
  assert.notEqual(SHARED_REPO_ROOT, path.resolve(REPO_ROOT, '..'));
  await Promise.all([
    pathExists(path.relative(REPO_ROOT, resolveRepoPath('package.json')).replace(/\\/gu, '/')),
    pathExists(path.relative(REPO_ROOT, resolveRepoPath('config', 'site-registry.json')).replace(/\\/gu, '/')),
    pathExists(path.relative(REPO_ROOT, resolveRepoPath('config', 'site-capabilities.json')).replace(/\\/gu, '/')),
    pathExists(path.relative(REPO_ROOT, resolveRepoPath('src', 'sites', 'known-sites')).replace(/\\/gu, '/')),
  ]);
});

test('xiaohongshu follow query default profile path stays under repo-root profiles', () => {
  const options = mergeXiaohongshuFollowOptions('https://www.xiaohongshu.com/notification', {});
  assert.equal(options.profilePath, path.join(REPO_ROOT, 'profiles', 'www.xiaohongshu.com.json'));
  assert.equal(options.profilePath.includes(`${path.sep}src${path.sep}profiles${path.sep}`), false);
});
