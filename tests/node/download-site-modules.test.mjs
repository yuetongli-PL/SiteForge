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
    'bz888.mjs',
    'jable.mjs',
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

test('download site modules expose all configured download sites', () => {
  assert.deepEqual(
    listDownloadSiteModules().map((module) => module.siteKey).sort(),
    ['22biqu', 'bilibili', 'bz888', 'douyin', 'instagram', 'jable', 'x', 'xiaohongshu'],
  );
  for (const siteKey of ['bilibili', 'douyin', 'xiaohongshu', '22biqu', 'bz888', 'x', 'instagram', 'jable']) {
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

test('jable experimental download placeholder resolves to native miss without legacy fallback', async () => {
  const capabilities = await readJsonFile(path.join(REPO_ROOT, 'config', 'site-capabilities.json'));
  const jableCapabilities = capabilities.sites['jable.tv'];
  assert.equal(jableCapabilities.downloader.status, 'experimental');
  assert.deepEqual(jableCapabilities.downloader.taskTypes, ['video', 'media-bundle']);
  assert.equal(jableCapabilities.downloader.reasonCode, 'jable-native-resolver-required');
  assert.equal(JSON.stringify(jableCapabilities).includes('downloader_not_allowed'), false);

  const registry = await readJsonFile(path.join(REPO_ROOT, 'config', 'site-registry.json'));
  const jableRegistry = registry.sites['jable.tv'];
  assert.equal(jableRegistry.siteKey, 'jable');
  assert.equal(jableRegistry.adapterId, 'jable');
  assert.equal(Object.hasOwn(jableRegistry, 'legacyEntrypoint'), false);
  assert.equal(jableRegistry.downloadSupport.status, 'experimental');
  assert.equal(jableRegistry.downloadSupport.reasonCode, 'jable-native-resolver-required');
  assert.equal(JSON.stringify(jableRegistry).includes('downloader_not_allowed'), false);

  const definition = await resolveDownloadSiteDefinition({ site: 'jable' }, { workspaceRoot: REPO_ROOT });
  const plan = await createDownloadPlan({
    site: 'jable',
    taskType: 'video',
    input: 'jable-native-placeholder',
    dryRun: true,
  }, {
    workspaceRoot: REPO_ROOT,
    definition,
  });
  const resolved = await resolveDownloadResources(plan, null, {
    request: { site: 'jable', taskType: 'video', input: 'jable-native-placeholder' },
    workspaceRoot: REPO_ROOT,
    definition,
  });

  assert.equal(definition.siteKey, 'jable');
  assert.equal(definition.adapterId, 'jable');
  assert.equal(definition.legacyEntrypoint, null);
  assert.equal(definition.resolverMethod, 'native-jable-resource-seeds');
  assert.equal(plan.resolver.method, 'native-jable-resource-seeds');
  assert.equal(plan.legacy, undefined);
  assert.equal(resolved.resources.length, 0);
  assert.equal(resolved.groups.length, 0);
  assert.equal(resolved.metadata.resolver.method, 'native-jable-resource-seeds');
  assert.equal(resolved.completeness.reason, 'jable-native-resolver-required');
  assert.equal(resolved.completeness.complete, false);
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
            headers: { Cookie: 'session=1', Accept: 'video/mp4' },
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
      headerName: 'Accept',
      headerValue: 'video/mp4',
      forbiddenHeaderName: 'Cookie',
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
    if (fixture.expected.forbiddenHeaderName) {
      assert.equal(resolved.resources[0].headers[fixture.expected.forbiddenHeaderName], undefined);
    }
    assert.equal(resolved.metadata.resolver.method, fixture.expected.method);
    assert.equal(resolved.completeness.reason, fixture.expected.reason);
    assert.equal(resolved.completeness.complete, true);
  });
}

test('bilibili native resolver consumes catalog handoff endpoints for UP-space evidence', async () => {
  const definition = await resolveDownloadSiteDefinition({ site: 'bilibili' }, { workspaceRoot: REPO_ROOT });
  const request = {
    site: 'bilibili',
    input: 'https://space.bilibili.com/123456',
    maxItems: 1,
    plannerHandoff: {
      siteKey: 'bilibili',
      taskType: 'video',
      taskList: {
        items: [
          {
            kind: 'request',
            endpoint: 'https://api.bilibili.com/x/space/wbi/arc/search',
            method: 'GET',
          },
          {
            kind: 'request',
            endpoint: 'https://api.bilibili.com/x/web-interface/view',
            method: 'GET',
          },
          {
            kind: 'request',
            endpoint: 'https://api.bilibili.com/x/player/playurl',
            method: 'GET',
          },
        ],
      },
    },
    dryRun: true,
  };
  const calls = [];
  const mockFetchImpl = async (url) => {
    const parsed = new URL(url);
    calls.push(parsed);
    if (parsed.pathname === '/x/space/wbi/arc/search') {
      return {
        code: 0,
        data: {
          list: {
            vlist: [
              {
                bvid: 'BV1catalog',
                aid: 42,
                title: 'Catalog Handoff Video',
                arcurl: 'https://www.bilibili.com/video/BV1catalog/',
              },
            ],
          },
        },
      };
    }
    if (parsed.pathname === '/x/web-interface/view') {
      return {
        code: 0,
        data: {
          bvid: 'BV1catalog',
          aid: 42,
          title: 'Catalog Handoff Video',
          pages: [
            {
              cid: 987654,
              page: 1,
              part: 'P1',
            },
          ],
        },
      };
    }
    if (parsed.pathname === '/x/player/playurl') {
      return {
        code: 0,
        data: {
          dash: {
            video: [
              {
                id: 80,
                bandwidth: 2000,
                baseUrl: 'https://upos.example.test/catalog-video.m4s',
              },
            ],
            audio: [
              {
                id: 30280,
                bandwidth: 128,
                baseUrl: 'https://upos.example.test/catalog-audio.m4s',
              },
            ],
          },
        },
      };
    }
    return { code: -404, data: {} };
  };

  const plan = await createDownloadPlan(request, {
    workspaceRoot: REPO_ROOT,
    definition,
  });
  const resolved = await resolveDownloadResources(plan, {
    siteKey: 'bilibili',
    status: 'ready',
  }, {
    request,
    workspaceRoot: REPO_ROOT,
    definition,
    allowNetworkResolve: true,
    mockFetchImpl,
  });

  assert.equal(resolved.siteKey, 'bilibili');
  assert.equal(resolved.resources.length, 2);
  assert.equal(resolved.resources[0].url, 'https://upos.example.test/catalog-video.m4s');
  assert.equal(resolved.resources[1].url, 'https://upos.example.test/catalog-audio.m4s');
  assert.equal(resolved.metadata.resolver.method, 'native-bilibili-resource-seeds');
  assert.equal(resolved.completeness.reason, 'bilibili-resource-seeds-provided');
  assert.equal(resolved.completeness.complete, true);
  assert.deepEqual(calls.map((call) => call.pathname), [
    '/x/space/wbi/arc/search',
    '/x/web-interface/view',
    '/x/player/playurl',
  ]);
  assert.equal(calls[0].searchParams.get('mid'), '123456');
  assert.equal(calls[0].searchParams.get('ps'), '1');
  assert.equal(calls[1].searchParams.get('bvid'), 'BV1catalog');
  assert.equal(calls[2].searchParams.get('cid'), '987654');
});

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

for (const fixture of [
  {
    site: 'x',
    input: 'https://x.com/openai',
    expectedEntrypoint: path.join('src', 'entrypoints', 'sites', 'x-action.mjs'),
  },
  {
    site: 'instagram',
    input: 'https://www.instagram.com/openai/',
    expectedEntrypoint: path.join('src', 'entrypoints', 'sites', 'instagram-action.mjs'),
  },
]) {
  test(`${fixture.site} social archive input still falls back to legacy resolution`, async () => {
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
    assert.equal(plan.legacy.entrypoint.endsWith(fixture.expectedEntrypoint), true);
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

  const bzPlan = await createDownloadPlan({
    site: 'bz888',
    input: 'https://www.bz888888888.com/book/123/456.html',
    dryRun: false,
  }, { workspaceRoot: REPO_ROOT, definition: await resolveDownloadSiteDefinition({ site: 'bz888' }, { workspaceRoot: REPO_ROOT }) });
  const bz = buildLegacyDownloadCommand(bzPlan, null, { pythonPath: 'pypy3' }, { workspaceRoot: REPO_ROOT, layout });
  assert.equal(bz.command, 'pypy3');
  assert.equal(bz.args.includes('--book-url'), true);
  assert.equal(bz.args.includes('https://www.bz888888888.com/book/123/456.html'), true);
  assert.equal(bz.args.includes('download'), false);
});

test('social download module maps request fields to legacy action argv', async () => {
  const runDir = path.join(os.tmpdir(), 'bwk-download-social-module-run');
  const layout = { runDir };
  const lease = {
    browserProfileRoot: path.join(os.tmpdir(), 'profiles'),
    userDataDir: path.join(os.tmpdir(), 'user-data'),
  };
  const xDefinition = await resolveDownloadSiteDefinition({ site: 'x' }, { workspaceRoot: REPO_ROOT });
  const instagramDefinition = await resolveDownloadSiteDefinition({ site: 'instagram' }, { workspaceRoot: REPO_ROOT });

  const defaultPlan = await createDownloadPlan({
    site: 'x',
    input: 'openai',
    dryRun: false,
  }, { workspaceRoot: REPO_ROOT, definition: xDefinition });
  const defaultArchive = buildLegacyDownloadCommand(defaultPlan, lease, { input: 'openai' }, { workspaceRoot: REPO_ROOT, layout });
  assert.equal(defaultArchive.args[1], 'full-archive');
  assert.equal(defaultArchive.args[2], 'openai');
  assert.equal(defaultArchive.args.includes('--query'), false);

  const searchPlan = await createDownloadPlan({
    site: 'x',
    input: 'https://x.com/search?q=codex',
    dryRun: false,
  }, { workspaceRoot: REPO_ROOT, definition: xDefinition });
  const search = buildLegacyDownloadCommand(searchPlan, lease, {
    input: 'https://x.com/search?q=codex',
    date: '2026-04-26',
    maxItems: 5,
  }, { workspaceRoot: REPO_ROOT, layout });
  assert.equal(search.args[1], 'search');
  assert.equal(search.args.includes('--query'), true);
  assert.equal(search.args[search.args.indexOf('--query') + 1], 'codex');
  assert.equal(search.args[search.args.indexOf('--date') + 1], '2026-04-26');
  assert.equal(search.args[search.args.indexOf('--max-items') + 1], '5');

  const relationPlan = await createDownloadPlan({
    site: 'instagram',
    input: 'https://www.instagram.com/openai/followers/',
    dryRun: false,
  }, { workspaceRoot: REPO_ROOT, definition: instagramDefinition });
  const relation = buildLegacyDownloadCommand(relationPlan, lease, {
    input: 'https://www.instagram.com/openai/followers/',
    relation: 'followers',
    maxUsers: 25,
  }, { workspaceRoot: REPO_ROOT, layout });
  assert.equal(relation.args[1], 'profile-followers');
  assert.equal(relation.args[2], 'openai');
  assert.equal(relation.args[relation.args.indexOf('--max-users') + 1], '25');

  const mediaPlan = await createDownloadPlan({
    site: 'x',
    input: 'https://x.com/openai',
    taskType: 'media-bundle',
    dryRun: false,
  }, { workspaceRoot: REPO_ROOT, definition: xDefinition });
  const media = buildLegacyDownloadCommand(mediaPlan, lease, {
    input: 'https://x.com/openai',
    maxMediaDownloads: 3,
  }, { workspaceRoot: REPO_ROOT, layout });
  assert.equal(media.args[1], 'profile-content');
  assert.equal(media.args[2], 'openai');
  assert.equal(media.args[media.args.indexOf('--content-type') + 1], 'media');
  assert.equal(media.args.includes('--download-media'), true);
  assert.equal(media.args[media.args.indexOf('--max-media-downloads') + 1], '3');
});

test('site registry points download planner and resolver at modules', async () => {
  const registry = await readJsonFile(path.join(REPO_ROOT, 'config', 'site-registry.json'));
  for (const host of ['www.22biqu.com', 'www.bz888888888.com', 'www.bilibili.com', 'www.douyin.com', 'www.xiaohongshu.com', 'x.com', 'www.instagram.com']) {
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
