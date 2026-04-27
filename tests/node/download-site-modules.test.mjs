import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { readJsonFile } from '../../src/infra/io.mjs';
import {
  buildLegacyDownloadCommand,
  createDownloadPlan,
  getDownloadSiteModule,
  listDownloadSiteModules,
  resolveDownloadResources,
} from '../../src/sites/downloads/modules.mjs';
import {
  listDownloadSiteDefinitions,
  resolveDownloadSiteDefinition,
} from '../../src/sites/downloads/registry.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');

test('download site argv builders live in per-site module files', async () => {
  const moduleDir = path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'site-modules');
  for (const fileName of [
    'common.mjs',
    'bilibili.mjs',
    'douyin.mjs',
    'xiaohongshu.mjs',
    '22biqu.mjs',
    'social.mjs',
  ]) {
    await access(path.join(moduleDir, fileName));
  }

  const dispatcher = await readFile(path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'modules.mjs'), 'utf8');
  for (const forbidden of [
    'buildBilibiliArgs',
    'buildDouyinArgs',
    'buildXiaohongshuArgs',
    'buildSocialArgs',
    'build22BiquCommand',
    '--author-page-limit',
    '--book-url',
    '--max-api-pages',
  ]) {
    assert.equal(dispatcher.includes(forbidden), false);
  }
});

test('download site modules expose all configured legacy download sites', () => {
  assert.deepEqual(
    listDownloadSiteModules().map((module) => module.siteKey).sort(),
    ['22biqu', 'bilibili', 'douyin', 'instagram', 'x', 'xiaohongshu'],
  );
  for (const siteKey of ['bilibili', 'douyin', 'xiaohongshu', '22biqu', 'x', 'instagram']) {
    assert.equal(getDownloadSiteModule(siteKey)?.siteKey, siteKey);
  }
});

test('download modules create plans and preserve legacy-required resource resolution', async () => {
  const definitions = await listDownloadSiteDefinitions(REPO_ROOT);
  const definition = definitions.find((entry) => entry.siteKey === 'bilibili');
  const plan = await createDownloadPlan({
    site: 'bilibili',
    input: 'BV1modulePlan',
    dryRun: true,
  }, {
    workspaceRoot: REPO_ROOT,
    definition,
  });
  const resolved = await resolveDownloadResources(plan, {
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    status: 'ready',
    mode: 'reusable-profile',
    riskSignals: [],
  }, {
    request: { site: 'bilibili', input: 'BV1modulePlan' },
    workspaceRoot: REPO_ROOT,
    definition,
  });

  assert.equal(plan.siteKey, 'bilibili');
  assert.equal(plan.legacy.entrypoint.endsWith(path.join('src', 'entrypoints', 'sites', 'bilibili-action.mjs')), true);
  assert.equal(resolved.resources.length, 0);
  assert.equal(resolved.completeness.reason, 'legacy-downloader-required');
});

test('22biqu native resolver maps provided chapter data to download resources', async () => {
  const definition = await resolveDownloadSiteDefinition({ site: '22biqu' }, { workspaceRoot: REPO_ROOT });
  const request = {
    site: '22biqu',
    input: 'https://www.22biqu.com/biqu1/123/',
    title: 'Mock Book',
    chapters: [
      { url: '1001.html', title: 'Chapter One' },
      { chapterUrl: 'https://www.22biqu.com/biqu1/123/1002.html', chapterTitle: 'Chapter Two' },
    ],
    dryRun: true,
  };
  const plan = await createDownloadPlan(request, {
    workspaceRoot: REPO_ROOT,
    definition,
  });
  const resolved = await resolveDownloadResources(plan, null, {
    request,
    workspaceRoot: REPO_ROOT,
    definition,
  });

  assert.equal(resolved.siteKey, '22biqu');
  assert.equal(resolved.resources.length, 2);
  assert.equal(resolved.resources[0].url, 'https://www.22biqu.com/biqu1/123/1001.html');
  assert.equal(resolved.resources[0].mediaType, 'text');
  assert.equal(resolved.resources[0].fileName, '0001-Chapter One.txt');
  assert.equal(resolved.resources[1].url, 'https://www.22biqu.com/biqu1/123/1002.html');
  assert.equal(resolved.metadata.resolver.method, 'native-22biqu-chapters');
  assert.equal(resolved.completeness.complete, true);
  assert.equal(resolved.completeness.reason, '22biqu-chapters-provided');
});

test('22biqu ordinary book input still falls back to legacy resolution', async () => {
  const definition = await resolveDownloadSiteDefinition({ site: '22biqu' }, { workspaceRoot: REPO_ROOT });
  const request = {
    site: '22biqu',
    input: 'https://www.22biqu.com/biqu1/123/',
    dryRun: true,
  };
  const plan = await createDownloadPlan(request, {
    workspaceRoot: REPO_ROOT,
    definition,
  });
  const resolved = await resolveDownloadResources(plan, null, {
    request,
    workspaceRoot: REPO_ROOT,
    definition,
  });

  assert.equal(resolved.siteKey, '22biqu');
  assert.equal(resolved.resources.length, 0);
  assert.equal(resolved.completeness.reason, 'legacy-downloader-required');
  assert.equal(plan.legacy.entrypoint.endsWith(path.join('src', 'sites', 'chapter-content', 'download', 'python', 'book.py')), true);
});

for (const fixture of [
  {
    site: 'bilibili',
    input: 'https://www.bilibili.com/video/BV1native/',
    request: {
      site: 'bilibili',
      input: 'https://www.bilibili.com/video/BV1native/',
      title: 'Bilibili Native Clip',
      headers: { 'User-Agent': 'module-test' },
      resources: [
        {
          url: 'https://upos.example.test/video/native.m4s',
          fileName: 'native-video.m4s',
          mediaType: 'video',
          referer: 'https://www.bilibili.com/video/BV1native/',
          headers: { Range: 'bytes=0-' },
        },
      ],
      dryRun: true,
    },
    expected: {
      method: 'native-bilibili-resource-seeds',
      reason: 'bilibili-resource-seeds-provided',
      url: 'https://upos.example.test/video/native.m4s',
      fileName: 'native-video.m4s',
      mediaType: 'video',
      referer: 'https://www.bilibili.com/video/BV1native/',
      headerName: 'Range',
      headerValue: 'bytes=0-',
    },
  },
  {
    site: 'douyin',
    input: 'https://www.douyin.com/video/1234567890123456789',
    request: {
      site: 'douyin',
      input: 'https://www.douyin.com/video/1234567890123456789',
      metadata: {
        directMedia: [
          {
            resolvedMediaUrl: 'https://v3-web.example.test/video/play.mp4',
            resolvedTitle: 'Douyin Native Clip',
            requestedUrl: 'https://www.douyin.com/video/1234567890123456789',
            headers: { Cookie: 'session=1' },
          },
        ],
      },
      dryRun: true,
    },
    expected: {
      method: 'native-douyin-resource-seeds',
      reason: 'douyin-resource-seeds-provided',
      url: 'https://v3-web.example.test/video/play.mp4',
      fileName: '0001-Douyin Native Clip.mp4',
      mediaType: 'video',
      referer: 'https://www.douyin.com/video/1234567890123456789',
      headerName: 'Cookie',
      headerValue: 'session=1',
    },
  },
  {
    site: 'xiaohongshu',
    input: 'https://www.xiaohongshu.com/explore/662233445566778899aabbcc',
    request: {
      site: 'xiaohongshu',
      input: 'https://www.xiaohongshu.com/explore/662233445566778899aabbcc',
      title: 'Xiaohongshu Native Note',
      metadata: {
        downloadBundle: {
          headers: { Accept: 'image/avif,image/webp,*/*' },
          assets: [
            {
              url: 'https://ci.xiaohongshu.example.test/native-image.jpg',
              kind: 'image',
              finalUrl: 'https://www.xiaohongshu.com/explore/662233445566778899aabbcc',
            },
          ],
        },
      },
      dryRun: true,
    },
    expected: {
      method: 'native-xiaohongshu-resource-seeds',
      reason: 'xiaohongshu-resource-seeds-provided',
      url: 'https://ci.xiaohongshu.example.test/native-image.jpg',
      fileName: '0001-Xiaohongshu Native Note.jpg',
      mediaType: 'image',
      referer: 'https://www.xiaohongshu.com/explore/662233445566778899aabbcc',
      headerName: 'Accept',
      headerValue: 'image/avif,image/webp,*/*',
    },
  },
]) {
  test(`${fixture.site} native resolver maps provided resource seeds`, async () => {
    const definition = await resolveDownloadSiteDefinition({ site: fixture.site }, { workspaceRoot: REPO_ROOT });
    const plan = await createDownloadPlan(fixture.request, {
      workspaceRoot: REPO_ROOT,
      definition,
    });
    const resolved = await resolveDownloadResources(plan, {
      siteKey: fixture.site,
      status: 'ready',
      headers: { 'Accept-Language': 'zh-CN' },
    }, {
      request: fixture.request,
      workspaceRoot: REPO_ROOT,
      definition,
    });

    assert.equal(resolved.siteKey, fixture.site);
    assert.equal(resolved.resources.length, 1);
    assert.equal(resolved.resources[0].url, fixture.expected.url);
    assert.equal(resolved.resources[0].fileName, fixture.expected.fileName);
    assert.equal(resolved.resources[0].mediaType, fixture.expected.mediaType);
    assert.equal(resolved.resources[0].referer, fixture.expected.referer);
    assert.equal(resolved.resources[0].headers['Accept-Language'], 'zh-CN');
    assert.equal(resolved.resources[0].headers[fixture.expected.headerName], fixture.expected.headerValue);
    assert.equal(resolved.metadata.resolver.method, fixture.expected.method);
    assert.equal(resolved.completeness.reason, fixture.expected.reason);
    assert.equal(resolved.completeness.complete, true);
  });
}

for (const fixture of [
  { site: 'bilibili', input: 'BV1legacyFallback' },
  { site: 'douyin', input: 'https://www.douyin.com/user/MS4wLjABlegacyFallback' },
  { site: 'xiaohongshu', input: 'coffee search' },
]) {
  test(`${fixture.site} ordinary input still falls back to legacy resolution`, async () => {
    const definition = await resolveDownloadSiteDefinition({ site: fixture.site }, { workspaceRoot: REPO_ROOT });
    const request = {
      site: fixture.site,
      input: fixture.input,
      dryRun: true,
    };
    const plan = await createDownloadPlan(request, {
      workspaceRoot: REPO_ROOT,
      definition,
    });
    const resolved = await resolveDownloadResources(plan, null, {
      request,
      workspaceRoot: REPO_ROOT,
      definition,
    });

    assert.equal(resolved.siteKey, fixture.site);
    assert.equal(resolved.resources.length, 0);
    assert.equal(resolved.completeness.reason, 'legacy-downloader-required');
  });
}

test('download site modules build legacy argv per site', async () => {
  const runDir = path.join(os.tmpdir(), 'bwk-download-module-run');
  const layout = { runDir };
  const lease = {
    browserProfileRoot: path.join(os.tmpdir(), 'profiles'),
    userDataDir: path.join(os.tmpdir(), 'user-data'),
  };

  const bilibiliPlan = await createDownloadPlan({
    site: 'bilibili',
    input: 'BV1legacy',
    dryRun: false,
    skipExisting: true,
  }, { workspaceRoot: REPO_ROOT, definition: await resolveDownloadSiteDefinition({ site: 'bilibili' }, { workspaceRoot: REPO_ROOT }) });
  const bilibili = buildLegacyDownloadCommand(bilibiliPlan, lease, { input: 'BV1legacy', resume: true }, { workspaceRoot: REPO_ROOT, layout });
  assert.equal(bilibili.command, process.execPath);
  assert.equal(bilibili.args.includes(path.join(REPO_ROOT, 'src', 'entrypoints', 'sites', 'bilibili-action.mjs')), true);
  assert.equal(bilibili.args.includes('--resume'), true);
  assert.equal(bilibili.args.includes('--skip-existing'), true);

  const douyinPlan = await createDownloadPlan({
    site: 'douyin',
    input: 'https://www.douyin.com/video/1',
    dryRun: false,
  }, { workspaceRoot: REPO_ROOT, definition: await resolveDownloadSiteDefinition({ site: 'douyin' }, { workspaceRoot: REPO_ROOT }) });
  const douyin = buildLegacyDownloadCommand(douyinPlan, lease, { user: ['creator'], keyword: 'title' }, { workspaceRoot: REPO_ROOT, layout });
  assert.equal(douyin.args.includes('--user'), true);
  assert.equal(douyin.args.includes('creator'), true);
  assert.deepEqual(douyin.args.slice(-4), ['--output', 'full', '--format', 'json']);

  const xhsPlan = await createDownloadPlan({
    site: 'xiaohongshu',
    input: 'https://www.xiaohongshu.com/explore/abc',
    dryRun: false,
  }, { workspaceRoot: REPO_ROOT, definition: await resolveDownloadSiteDefinition({ site: 'xiaohongshu' }, { workspaceRoot: REPO_ROOT }) });
  const xhs = buildLegacyDownloadCommand(xhsPlan, lease, { followedUsers: true, query: 'coffee' }, { workspaceRoot: REPO_ROOT, layout });
  assert.equal(xhs.args.includes('--followed-users'), true);
  assert.equal(xhs.args.includes('--query'), true);

  const xPlan = await createDownloadPlan({
    site: 'x',
    input: 'https://x.com/openai',
    dryRun: false,
  }, { workspaceRoot: REPO_ROOT, definition: await resolveDownloadSiteDefinition({ site: 'x' }, { workspaceRoot: REPO_ROOT }) });
  const x = buildLegacyDownloadCommand(xPlan, lease, { downloadMedia: true }, { workspaceRoot: REPO_ROOT, layout });
  assert.equal(x.args[1], 'full-archive');
  assert.equal(x.args[2], 'openai');
  assert.equal(x.args.includes('--download-media'), true);
  assert.deepEqual(x.args.slice(-2), ['--format', 'json']);

  const bookPlan = await createDownloadPlan({
    site: '22biqu',
    input: 'https://www.22biqu.com/biqu1/123/',
    dryRun: false,
  }, { workspaceRoot: REPO_ROOT, definition: await resolveDownloadSiteDefinition({ site: '22biqu' }, { workspaceRoot: REPO_ROOT }) });
  const book = buildLegacyDownloadCommand(bookPlan, null, { pythonPath: 'pypy3' }, { workspaceRoot: REPO_ROOT, layout });
  assert.equal(book.command, 'pypy3');
  assert.equal(book.args.includes('--book-url'), true);
  assert.equal(book.args.includes('https://www.22biqu.com/biqu1/123/'), true);
});

test('site registry points download planner and resolver at modules', async () => {
  const registry = await readJsonFile(path.join(REPO_ROOT, 'config', 'site-registry.json'));
  for (const host of ['www.22biqu.com', 'www.bilibili.com', 'www.douyin.com', 'www.xiaohongshu.com', 'x.com', 'www.instagram.com']) {
    assert.equal(registry.sites[host].downloadPlanner, 'src/sites/downloads/modules.mjs');
    assert.equal(registry.sites[host].downloadResolver, 'src/sites/downloads/modules.mjs');
  }
});

test('legacy executor delegates site-specific argv construction to modules', async () => {
  const source = await readFile(path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'legacy-executor.mjs'), 'utf8');
  assert.equal(source.includes('buildBilibiliArgs'), false);
  assert.equal(source.includes('buildSocialArgs'), false);
  assert.equal(source.includes('legacy-python-book'), false);
  assert.equal(source.includes('./modules.mjs'), true);
});
