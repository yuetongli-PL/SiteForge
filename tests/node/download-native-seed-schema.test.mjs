import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createDownloadPlan,
  resolveDownloadResources,
} from '../../src/sites/downloads/modules.mjs';
import {
  resolveDownloadSiteDefinition,
} from '../../src/sites/downloads/registry.mjs';
import { nativeSeedResolverOptions as bilibiliNativeSeedOptions } from '../../src/sites/downloads/site-modules/bilibili.mjs';
import { nativeSeedResolverOptions as douyinNativeSeedOptions } from '../../src/sites/downloads/site-modules/douyin.mjs';
import { nativeSeedResolverOptions as xiaohongshuNativeSeedOptions } from '../../src/sites/downloads/site-modules/xiaohongshu.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');

const REQUIRED_TASK_KEYS = [
  'planId',
  'siteKey',
  'taskType',
  'resources',
  'groups',
  'metadata',
  'completeness',
];

const REQUIRED_RESOURCE_KEYS = [
  'id',
  'url',
  'method',
  'headers',
  'body',
  'fileName',
  'mediaType',
  'sourceUrl',
  'referer',
  'expectedBytes',
  'expectedHash',
  'priority',
  'groupId',
  'metadata',
];

const SITE_FIXTURES = [
  {
    site: 'bilibili',
    input: 'https://www.bilibili.com/video/BV1nativeSchema/',
    options: bilibiliNativeSeedOptions,
    request: {
      site: 'bilibili',
      input: 'https://www.bilibili.com/video/BV1nativeSchema/',
      title: 'Bilibili Native Schema',
      resources: [
        {
          url: 'https://upos.example.test/schema/native-video.m4s',
          fileName: 'bilibili-native-video.m4s',
          mediaType: 'video',
          headers: { Range: 'bytes=0-' },
          metadata: { representationId: 'video-1080p' },
        },
      ],
      dryRun: true,
    },
    expectedResource: {
      fileName: 'bilibili-native-video.m4s',
      mediaType: 'video',
      headerName: 'Range',
      headerValue: 'bytes=0-',
      metadataName: 'representationId',
      metadataValue: 'video-1080p',
    },
  },
  {
    site: 'douyin',
    input: 'https://www.douyin.com/video/7321000000000000000',
    options: douyinNativeSeedOptions,
    request: {
      site: 'douyin',
      input: 'https://www.douyin.com/video/7321000000000000000',
      title: 'Douyin Native Schema',
      metadata: {
        directMedia: [
          {
            resolvedMediaUrl: 'https://v3-web.example.test/schema/play.mp4',
            fileName: 'douyin-native-video.mp4',
            headers: { Cookie: 'session=1' },
            metadata: { awemeId: '7321000000000000000' },
          },
        ],
      },
      dryRun: true,
    },
    expectedResource: {
      fileName: 'douyin-native-video.mp4',
      mediaType: 'video',
      headerName: 'Cookie',
      headerValue: 'session=1',
      metadataName: 'awemeId',
      metadataValue: '7321000000000000000',
    },
  },
  {
    site: 'xiaohongshu',
    input: 'https://www.xiaohongshu.com/explore/662233445566778899aabbcc',
    options: xiaohongshuNativeSeedOptions,
    request: {
      site: 'xiaohongshu',
      input: 'https://www.xiaohongshu.com/explore/662233445566778899aabbcc',
      title: 'Xiaohongshu Native Schema',
      metadata: {
        downloadBundle: {
          assets: [
            {
              url: 'https://ci.xiaohongshu.example.test/schema/image.jpg',
              fileName: 'xiaohongshu-native-image.jpg',
              headers: { Accept: 'image/avif,image/webp,*/*' },
              metadata: { noteId: '662233445566778899aabbcc' },
            },
          ],
        },
      },
      dryRun: true,
    },
    expectedResource: {
      fileName: 'xiaohongshu-native-image.jpg',
      mediaType: 'image',
      headerName: 'Accept',
      headerValue: 'image/avif,image/webp,*/*',
      metadataName: 'noteId',
      metadataValue: '662233445566778899aabbcc',
    },
  },
];

async function resolveFixture(fixture, request = fixture.request, sessionLease = undefined) {
  const definition = await resolveDownloadSiteDefinition({ site: fixture.site }, { workspaceRoot: REPO_ROOT });
  const plan = await createDownloadPlan(request, {
    workspaceRoot: REPO_ROOT,
    definition,
  });
  const resolved = await resolveDownloadResources(plan, sessionLease ?? {
    siteKey: fixture.site,
    status: 'ready',
    headers: { 'Accept-Language': 'zh-CN' },
  }, {
    request,
    workspaceRoot: REPO_ROOT,
    definition,
  });
  return { plan, resolved };
}

function sortedKeys(value) {
  return Object.keys(value).sort();
}

test('native seed resolver options expose the same contract knobs for all three sites', () => {
  const shapes = SITE_FIXTURES.map((fixture) => sortedKeys(fixture.options));
  assert.deepEqual(shapes[0], ['completeReason', 'defaultMediaType', 'incompleteReason', 'method']);
  assert.deepEqual(shapes[1], shapes[0]);
  assert.deepEqual(shapes[2], shapes[0]);
  assert.equal(bilibiliNativeSeedOptions.defaultMediaType, 'video');
  assert.equal(douyinNativeSeedOptions.defaultMediaType, 'video');
  assert.equal(xiaohongshuNativeSeedOptions.defaultMediaType, 'image');
});

test('native seed resolvers return the same resolved task and resource schema', async () => {
  const resolvedTasks = [];

  for (const fixture of SITE_FIXTURES) {
    const { resolved } = await resolveFixture(fixture);
    const resource = resolved.resources[0];

    assert.deepEqual(sortedKeys(resolved), REQUIRED_TASK_KEYS.sort());
    assert.deepEqual(sortedKeys(resource), REQUIRED_RESOURCE_KEYS.sort());
    assert.equal(resolved.resources.length, 1);
    assert.equal(resource.headers['Accept-Language'], 'zh-CN');
    assert.equal(resource.headers[fixture.expectedResource.headerName], fixture.expectedResource.headerValue);
    assert.equal(resource.fileName, fixture.expectedResource.fileName);
    assert.equal(resource.mediaType, fixture.expectedResource.mediaType);
    assert.equal(resource.metadata[fixture.expectedResource.metadataName], fixture.expectedResource.metadataValue);
    assert.equal(resource.metadata.siteResolver, fixture.site);
    assert.equal(resolved.metadata.resolver.method, fixture.options.method);
    assert.equal(resolved.completeness.complete, true);
    assert.equal(resolved.completeness.expectedCount, 1);
    assert.equal(resolved.completeness.resolvedCount, 1);
    assert.equal(resolved.completeness.reason, fixture.options.completeReason);
    resolvedTasks.push(resolved);
  }

  const taskShape = sortedKeys(resolvedTasks[0]);
  const resourceShape = sortedKeys(resolvedTasks[0].resources[0]);
  for (const resolved of resolvedTasks.slice(1)) {
    assert.deepEqual(sortedKeys(resolved), taskShape);
    assert.deepEqual(sortedKeys(resolved.resources[0]), resourceShape);
  }
});

test('ordinary native-site inputs still use legacy fallback when no seed is pre-resolved', async () => {
  const fallbackRequests = [
    {
      site: 'bilibili',
      input: 'BV1legacySchema',
      dryRun: true,
    },
    {
      site: 'douyin',
      input: 'https://www.douyin.com/user/MS4wLjABAAAAlegacySchema',
      dryRun: true,
    },
    {
      site: 'xiaohongshu',
      input: 'https://www.xiaohongshu.com/explore/662233445566778899aabbcc',
      dryRun: true,
    },
  ];

  for (const request of fallbackRequests) {
    const fixture = SITE_FIXTURES.find((entry) => entry.site === request.site);
    const { resolved } = await resolveFixture(fixture, request, null);
    assert.equal(resolved.siteKey, request.site);
    assert.equal(resolved.resources.length, 0);
    assert.equal(resolved.completeness.complete, false);
    assert.equal(resolved.completeness.reason, 'legacy-downloader-required');
  }
});
