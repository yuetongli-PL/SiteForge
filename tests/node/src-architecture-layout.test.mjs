import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, readdir, stat } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');
const execFile = promisify(execFileCallback);

async function expectPathExists(relativePath) {
  const targetPath = path.join(REPO_ROOT, relativePath);
  const stats = await stat(targetPath);
  assert.ok(stats, `Expected path to exist: ${relativePath}`);
}

async function expectPathMissing(relativePath) {
  const targetPath = path.join(REPO_ROOT, relativePath);
  await assert.rejects(() => stat(targetPath), { code: 'ENOENT' });
}

async function trackedPathsUnder(relativePath) {
  const { stdout } = await execFile('git', ['ls-files', relativePath], { cwd: REPO_ROOT });
  return stdout.split(/\r?\n/u).filter(Boolean);
}

function knownDownloaderPath(siteKey, fileName) {
  return path.posix.join('src', 'sites', 'known-sites', siteKey, 'download', 'python', fileName);
}

function legacyDownloaderPath(siteKey, fileName) {
  return path.posix.join('src', 'sites', siteKey, 'download', 'python', fileName);
}

function legacyDownloaderDir(siteKey) {
  return path.posix.join('src', 'sites', siteKey, 'download');
}

function legacySitePath(siteKey, ...segments) {
  return path.posix.join('src', 'sites', siteKey, ...segments);
}

test('src-first code layout exists', async () => {
  await Promise.all([
    expectPathExists('src/entrypoints'),
    expectPathExists('src/entrypoints/cli'),
    expectPathExists('src/entrypoints/operator'),
    expectPathExists('src/app'),
    expectPathExists('src/app/pipeline'),
    expectPathExists('src/app/compiler'),
    expectPathExists('src/app/planner'),
    expectPathExists('src/domain'),
    expectPathExists('src/sites'),
    expectPathExists('src/infra'),
    expectPathExists('src/infra/cli'),
    expectPathExists('src/shared'),
    expectPathExists('src/skills'),
  ]);
});

test('site and auth modules are organized under src', async () => {
  await Promise.all([
    expectPathExists('src/sites/adapters'),
    expectPathExists('src/sites/registry'),
    expectPathExists('src/sites/known-sites/douyin'),
    expectPathExists('src/sites/known-sites/bilibili'),
    expectPathExists('src/infra/auth/site-auth.mjs'),
    expectPathExists('src/infra/auth/site-session-governance.mjs'),
    expectPathExists('src/infra/auth/auth-keepalive-preflight.mjs'),
    expectPathExists('src/infra/auth/windows-credential-manager.mjs'),
  ]);
});

test('root truth and output boundaries stay outside src', async () => {
  await Promise.all([
    expectPathExists('schema'),
    expectPathExists('config'),
    expectPathExists('tools'),
    expectPathExists('config/site-registry.json'),
    expectPathExists('config/site-capabilities.json'),
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

test('test-derived repo root resolves to project root, not src or its parent', async () => {
  assert.equal(path.basename(REPO_ROOT), 'SiteForge');
  assert.equal(path.basename(path.join(REPO_ROOT, 'src')), 'src');
  assert.notEqual(REPO_ROOT, path.join(REPO_ROOT, 'src'));
  assert.notEqual(REPO_ROOT, path.resolve(REPO_ROOT, '..'));
  await Promise.all([
    expectPathExists('src'),
    expectPathExists('package.json'),
  ]);
});

test('root-level site data directories stay out of the tracked pure code tree', async () => {
  for (const relativePath of [
    '.playwright-mcp',
    'book-content',
    'knowledge-base',
    'profiles',
    'runs',
    'skills',
    'crawler-scripts',
  ]) {
    assert.deepEqual(
      await trackedPathsUnder(relativePath),
      [],
      `${relativePath} should remain local generated data, not tracked project source`,
    );
  }
});

test('root only keeps approved project metadata regular files', async () => {
  const entries = await readdir(REPO_ROOT, { withFileTypes: true });
  const regularFiles = entries
    .filter((entry) => entry.isFile())
    .filter((entry) => entry.name !== '.git')
    .map((entry) => entry.name)
    .sort();
  const rootDesignDocs = regularFiles.filter((name) => /^Site Capability Layer .+\.md$/u.test(name));
  assert.ok(rootDesignDocs.length <= 1, 'root should not accumulate duplicate Site Capability Layer design docs');
  await Promise.all([
    expectPathExists('README.md'),
    expectPathExists('AGENTS.md'),
    expectPathExists('package.json'),
  ]);

  assert.deepEqual(regularFiles, [
    '.gitattributes',
    '.gitignore',
    'AGENTS.md',
    'README.md',
    'SECURITY.md',
    'package.json',
    'requirements.txt',
    'tsconfig.typecheck.json',
    ...rootDesignDocs,
  ].sort());
});

test('retired compatibility directories stay removed', async () => {
  await Promise.all([
    expectPathMissing('downloaders'),
    expectPathMissing('lib'),
    expectPathMissing('src/pipeline'),
    expectPathMissing('src/kernel'),
    expectPathMissing('src/sites/core'),
    expectPathMissing('src/sites/catalog'),
    expectPathMissing('src/sites/capability'),
    expectPathMissing('src/app/pipeline/engine'),
    expectPathMissing('src/app/pipeline/runtime'),
    expectPathMissing('src/app/pipeline/artifacts'),
    expectPathMissing('src/app/pipeline/stages'),
  ]);
});

test('site modules do not depend directly on entrypoint modules', async () => {
  const sourceChecks = [
    ['src/sites/known-sites/bilibili/actions/router.mjs', 'entrypoints/sites'],
    ['src/sites/known-sites/douyin/actions/router.mjs', 'entrypoints/sites'],
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

test('canonical src modules own profile validation and infra implementations', async () => {
  const sourceChecks = [
    ['src/sites/registry/core/profile-validation.mjs', 'lib/profile-validation.mjs'],
    ['src/infra/browser/benchmark-report.mjs', 'lib/browser-runtime/benchmark-report.mjs'],
    ['src/infra/browser/cdp-client.mjs', 'lib/browser-runtime/cdp-client.mjs'],
    ['src/infra/browser/launcher.mjs', 'lib/browser-runtime/launcher.mjs'],
    ['src/infra/browser/profile-store.mjs', 'lib/browser-runtime/profile-store.mjs'],
    ['src/infra/browser/session.mjs', 'lib/browser-runtime/session.mjs'],
    ['src/sites/known-sites/bilibili/model/diagnosis.mjs', 'lib/sites/bilibili/diagnosis.mjs'],
    ['src/sites/known-sites/bilibili/model/surfacing.mjs', 'lib/sites/bilibili/surfacing.mjs'],
    ['src/sites/known-sites/douyin/model/diagnosis.mjs', 'lib/sites/douyin/site.mjs'],
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
    expectPathMissing('scripts/bilibili-action.mjs'),
    expectPathMissing('scripts/douyin-action.mjs'),
    expectPathMissing('scripts/export-douyin-cookies.mjs'),
    expectPathMissing('scripts/extract-bilibili-links.mjs'),
    expectPathMissing('scripts/nl-site-login.mjs'),
    expectPathMissing('scripts/download.mjs'),
    expectPathMissing('scripts/open-bilibili-page.mjs'),
    expectPathMissing('scripts/resolve-douyin-media.mjs'),
    expectPathMissing('scripts/session-repair-plan.mjs'),
    expectPathMissing('scripts/site-credentials.mjs'),
    expectPathMissing('scripts/site-doctor.mjs'),
    expectPathMissing('scripts/site-keepalive.mjs'),
    expectPathMissing('scripts/site-login.mjs'),
    expectPathMissing('scripts/site-scaffold.mjs'),
    expectPathMissing('scripts/social-auth-import.mjs'),
    expectPathMissing('scripts/xiaohongshu-action.mjs'),
    expectPathMissing('src/entrypoints/cli/capabilities.mjs'),
    expectPathExists('src/entrypoints/operator/capabilities.mjs'),
    expectPathExists('src/entrypoints/sites/bilibili-action.mjs'),
    expectPathExists('src/entrypoints/sites/douyin-action.mjs'),
    expectPathExists('src/entrypoints/sites/douyin-export-cookies.mjs'),
    expectPathExists('src/entrypoints/sites/bilibili-extract-links.mjs'),
    expectPathExists('src/entrypoints/sites/nl-site-login.mjs'),
    expectPathMissing('src/entrypoints/sites/download.mjs'),
    expectPathExists('src/entrypoints/sites/bilibili-open-page.mjs'),
    expectPathExists('src/entrypoints/sites/douyin-resolve-media.mjs'),
    expectPathExists('src/entrypoints/sites/session-repair-plan.mjs'),
    expectPathExists('src/entrypoints/sites/site-credentials.mjs'),
    expectPathExists('src/entrypoints/sites/site-doctor.mjs'),
    expectPathExists('src/entrypoints/sites/site-keepalive.mjs'),
    expectPathExists('src/entrypoints/sites/site-login.mjs'),
    expectPathExists('src/entrypoints/sites/site-scaffold.mjs'),
    expectPathExists('src/entrypoints/sites/social-auth-import.mjs'),
    expectPathExists('src/entrypoints/sites/xiaohongshu-action.mjs'),
  ]);
});

test('flat site aliases and old microdirectories stay removed', async () => {
  await Promise.all([
    expectPathMissing('src/sites/douyin/action-router.mjs'),
    expectPathMissing(legacySitePath('douyin', 'download-enumerator.mjs')),
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
    expectPathMissing('src/infra/fs'),
    expectPathMissing('src/entrypoints/compat'),
  ]);
});

test('known-site downloader paths stay under known-sites layout', async () => {
  await Promise.all([
    expectPathMissing(legacyDownloaderPath('bilibili', 'bilibili.py')),
    expectPathMissing(legacyDownloaderPath('douyin', 'douyin.py')),
    expectPathMissing(legacyDownloaderPath('xiaohongshu', 'xiaohongshu.py')),
    expectPathExists(knownDownloaderPath('bilibili', 'bilibili.py')),
    expectPathExists(knownDownloaderPath('douyin', 'douyin.py')),
    expectPathExists(knownDownloaderPath('xiaohongshu', 'xiaohongshu.py')),
  ]);
});

test('source does not retain old flat downloader path literals', async () => {
  const forbiddenTexts = [
    legacyDownloaderDir('bilibili'),
    legacyDownloaderDir('douyin'),
    legacyDownloaderDir('xiaohongshu'),
  ];
  const sourcePaths = (await trackedPathsUnder('src'))
    .filter((relativePath) => /\.(?:mjs|js|json|py)$/u.test(relativePath));

  for (const relativePath of sourcePaths) {
    let source = '';
    try {
      source = await readFile(path.join(REPO_ROOT, relativePath), 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
    for (const forbiddenText of forbiddenTexts) {
      assert.equal(
        source.includes(forbiddenText),
        false,
        `${relativePath} should not reference ${forbiddenText}`,
      );
    }
  }
});
