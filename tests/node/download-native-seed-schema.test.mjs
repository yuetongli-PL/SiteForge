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

const REQUIRED_TASK_KEYS_SORTED = [...REQUIRED_TASK_KEYS].sort();
const REQUIRED_RESOURCE_KEYS_SORTED = [...REQUIRED_RESOURCE_KEYS].sort();
const REQUIRED_COMPLETENESS_KEYS_SORTED = [
  'complete',
  'expectedCount',
  'reason',
  'resolvedCount',
].sort();

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

function assertResolvedTaskSchema(resolved, fixture, {
  expectedCount = resolved.resources.length,
  resolvedCount = resolved.resources.length,
  complete = true,
  reason = fixture.options.completeReason,
} = {}) {
  assert.deepEqual(sortedKeys(resolved), REQUIRED_TASK_KEYS_SORTED);
  assert.equal(Array.isArray(resolved.resources), true);
  assert.equal(Array.isArray(resolved.groups), true);
  assert.deepEqual(sortedKeys(resolved.completeness), REQUIRED_COMPLETENESS_KEYS_SORTED);
  assert.equal(resolved.metadata.resolver.method, fixture.options.method);
  assert.equal(resolved.completeness.expectedCount, expectedCount);
  assert.equal(resolved.completeness.resolvedCount, resolvedCount);
  assert.equal(resolved.completeness.complete, complete);
  assert.equal(resolved.completeness.reason, reason);
}

function assertResourceSchema(resource, fixture, {
  id,
  url,
  method = 'GET',
  headers = {},
  fileName,
  mediaType,
  sourceUrl,
  referer,
  expectedBytes,
  expectedHash,
  priority,
  groupId,
  metadata = {},
} = {}) {
  assert.deepEqual(sortedKeys(resource), REQUIRED_RESOURCE_KEYS_SORTED);
  assert.equal(resource.id, id);
  assert.equal(resource.url, url);
  assert.equal(resource.method, method);
  assert.equal(resource.fileName, fileName);
  assert.equal(resource.mediaType, mediaType);
  assert.equal(resource.sourceUrl, sourceUrl);
  assert.equal(resource.referer, referer);
  assert.equal(resource.expectedBytes, expectedBytes);
  assert.equal(resource.expectedHash, expectedHash);
  assert.equal(resource.priority, priority);
  assert.equal(resource.groupId, groupId);
  assert.equal(typeof resource.headers, 'object');
  assert.equal(typeof resource.metadata, 'object');
  assert.equal(Object.hasOwn(resource.headers, 'Cookie'), false);
  assert.equal(Object.hasOwn(resource.headers, 'cookie'), false);
  assert.deepEqual(resource.headers, headers);
  assert.deepEqual(resource.metadata, {
    ...metadata,
    siteResolver: fixture.site,
  });
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

    assertResolvedTaskSchema(resolved, fixture, {
      expectedCount: 1,
      resolvedCount: 1,
      complete: true,
      reason: fixture.options.completeReason,
    });
    assert.equal(resolved.resources.length, 1);
    const expectedHeaders = {
      'Accept-Language': 'zh-CN',
    };
    if (fixture.expectedResource.headerName) {
      expectedHeaders[fixture.expectedResource.headerName] = fixture.expectedResource.headerValue;
    }
    assertResourceSchema(resource, fixture, {
      id: resource.id,
      url: resource.url,
      headers: expectedHeaders,
      fileName: fixture.expectedResource.fileName,
      mediaType: fixture.expectedResource.mediaType,
      sourceUrl: fixture.input,
      referer: fixture.input,
      expectedBytes: undefined,
      expectedHash: undefined,
      priority: 0,
      groupId: fixture.request.title,
      metadata: {
        [fixture.expectedResource.metadataName]: fixture.expectedResource.metadataValue,
        title: fixture.request.title,
        sourceTitle: fixture.request.title,
      },
    });
    resolvedTasks.push(resolved);
  }

  const taskShape = sortedKeys(resolvedTasks[0]);
  const resourceShape = sortedKeys(resolvedTasks[0].resources[0]);
  for (const resolved of resolvedTasks.slice(1)) {
    assert.deepEqual(sortedKeys(resolved), taskShape);
    assert.deepEqual(sortedKeys(resolved.resources[0]), resourceShape);
  }
});

test('native seed resolvers keep multi-resource arrays and per-resource fields aligned', async () => {
  const sessionLease = {
    siteKey: 'schema-test',
    status: 'ready',
    headers: {
      'Accept-Language': 'zh-CN',
      'User-Agent': 'native-schema-test',
    },
  };
  const cases = [
    {
      site: 'bilibili',
      request: {
        site: 'bilibili',
        input: 'https://www.bilibili.com/video/BV1nativeSchemaMulti/',
        title: 'Bilibili Multi Schema',
        headers: { 'X-Request-Trace': 'bilibili-request' },
        downloadHeaders: { 'X-Download-Trace': 'bilibili-download' },
        resources: [
          {
            id: 'bili-video',
            url: 'https://upos.example.test/schema/multi-video.m4s',
            fileName: 'bilibili-video.m4s',
            mediaType: 'video',
            headers: { Range: 'bytes=0-' },
            metadata: { stream: 'video' },
            expectedBytes: '2048',
            expectedHash: 'sha256-video',
          },
          {
            id: 'bili-audio',
            url: 'https://upos.example.test/schema/multi-audio.m4s',
            contentType: 'audio/mpeg',
            headers: { Range: 'bytes=10-' },
            metadata: { stream: 'audio' },
            priority: 9,
          },
        ],
        dryRun: true,
      },
      expectedResources: [
        {
          id: 'bili-video',
          url: 'https://upos.example.test/schema/multi-video.m4s',
          fileName: 'bilibili-video.m4s',
          mediaType: 'video',
          headers: { Range: 'bytes=0-' },
          expectedBytes: 2048,
          expectedHash: 'sha256-video',
          priority: 0,
          groupId: 'Bilibili Multi Schema',
          metadata: {
            stream: 'video',
            title: 'Bilibili Multi Schema',
            sourceTitle: 'Bilibili Multi Schema',
          },
        },
        {
          id: 'bili-audio',
          url: 'https://upos.example.test/schema/multi-audio.m4s',
          fileName: '0002-Bilibili Multi Schema.mp3',
          mediaType: 'audio',
          headers: { Range: 'bytes=10-' },
          expectedBytes: undefined,
          expectedHash: undefined,
          priority: 9,
          groupId: 'Bilibili Multi Schema',
          metadata: {
            stream: 'audio',
            title: 'Bilibili Multi Schema',
            sourceTitle: 'Bilibili Multi Schema',
          },
        },
      ],
    },
    {
      site: 'douyin',
      request: {
        site: 'douyin',
        input: 'https://www.douyin.com/video/7321000000000000001',
        title: 'Douyin Multi Schema',
        headers: { 'X-Request-Trace': 'douyin-request' },
        downloadHeaders: { 'X-Download-Trace': 'douyin-download' },
        metadata: {
          directMedia: [
            {
              id: 'douyin-video',
              resolvedMediaUrl: 'https://v3-web.example.test/schema/multi-play.mp4',
              fileName: 'douyin-video.mp4',
              headers: { Cookie: 'session=1' },
              metadata: { stream: 'play' },
            },
            {
              id: 'douyin-cover',
              url: 'https://v3-web.example.test/schema/multi-cover.webp',
              contentType: 'image/webp',
              headers: { Accept: 'image/webp' },
              metadata: { stream: 'cover' },
            },
          ],
        },
        dryRun: true,
      },
      expectedResources: [
        {
          id: 'douyin-video',
          url: 'https://v3-web.example.test/schema/multi-play.mp4',
          fileName: 'douyin-video.mp4',
          mediaType: 'video',
          headers: {},
          expectedBytes: undefined,
          expectedHash: undefined,
          priority: 0,
          groupId: 'Douyin Multi Schema',
          metadata: {
            stream: 'play',
            title: 'Douyin Multi Schema',
            sourceTitle: 'Douyin Multi Schema',
          },
        },
        {
          id: 'douyin-cover',
          url: 'https://v3-web.example.test/schema/multi-cover.webp',
          fileName: '0002-Douyin Multi Schema.webp',
          mediaType: 'image',
          headers: { Accept: 'image/webp' },
          expectedBytes: undefined,
          expectedHash: undefined,
          priority: 1,
          groupId: 'Douyin Multi Schema',
          metadata: {
            stream: 'cover',
            title: 'Douyin Multi Schema',
            sourceTitle: 'Douyin Multi Schema',
          },
        },
      ],
    },
    {
      site: 'xiaohongshu',
      request: {
        site: 'xiaohongshu',
        input: 'https://www.xiaohongshu.com/explore/662233445566778899aabbcd',
        title: 'Xiaohongshu Multi Schema',
        headers: { 'X-Request-Trace': 'xiaohongshu-request' },
        downloadHeaders: { 'X-Download-Trace': 'xiaohongshu-download' },
        metadata: {
          downloadBundle: {
            title: 'Xiaohongshu Bundle Schema',
            headers: { 'X-Bundle': 'note-assets' },
            assets: [
              {
                id: 'xhs-image-1',
                url: 'https://ci.xiaohongshu.example.test/schema/multi-image-1.jpg',
                fileName: 'xiaohongshu-image-1.jpg',
                headers: { Accept: 'image/avif,image/webp,*/*' },
                metadata: { asset: 'image-1' },
              },
              {
                id: 'xhs-image-2',
                src: '//ci.xiaohongshu.example.test/schema/multi-image-2.png',
                contentType: 'image/png',
                metadata: { asset: 'image-2' },
              },
            ],
          },
        },
        dryRun: true,
      },
      expectedResources: [
        {
          id: 'xhs-image-1',
          url: 'https://ci.xiaohongshu.example.test/schema/multi-image-1.jpg',
          fileName: 'xiaohongshu-image-1.jpg',
          mediaType: 'image',
          headers: {
            'X-Bundle': 'note-assets',
            Accept: 'image/avif,image/webp,*/*',
          },
          expectedBytes: undefined,
          expectedHash: undefined,
          priority: 0,
          groupId: 'Xiaohongshu Multi Schema',
          metadata: {
            asset: 'image-1',
            title: 'Xiaohongshu Bundle Schema',
            sourceTitle: 'Xiaohongshu Multi Schema',
          },
        },
        {
          id: 'xhs-image-2',
          url: 'https://ci.xiaohongshu.example.test/schema/multi-image-2.png',
          fileName: '0002-Xiaohongshu Bundle Schema.png',
          mediaType: 'image',
          headers: { 'X-Bundle': 'note-assets' },
          expectedBytes: undefined,
          expectedHash: undefined,
          priority: 1,
          groupId: 'Xiaohongshu Multi Schema',
          metadata: {
            asset: 'image-2',
            title: 'Xiaohongshu Bundle Schema',
            sourceTitle: 'Xiaohongshu Multi Schema',
          },
        },
      ],
    },
  ];

  for (const entry of cases) {
    const fixture = SITE_FIXTURES.find((candidate) => candidate.site === entry.site);
    assert.ok(fixture, `Missing native seed fixture for ${entry.site}`);
    const { resolved } = await resolveFixture(fixture, entry.request, {
      ...sessionLease,
      siteKey: entry.site,
    });

    assertResolvedTaskSchema(resolved, fixture, {
      expectedCount: 2,
      resolvedCount: 2,
      complete: true,
      reason: fixture.options.completeReason,
    });
    assert.equal(resolved.resources.length, 2);
    for (const [index, expected] of entry.expectedResources.entries()) {
      assertResourceSchema(resolved.resources[index], fixture, {
        ...expected,
        headers: {
          'Accept-Language': 'zh-CN',
          'User-Agent': 'native-schema-test',
          'X-Request-Trace': `${entry.site}-request`,
          'X-Download-Trace': `${entry.site}-download`,
          ...expected.headers,
        },
        sourceUrl: entry.request.input,
        referer: entry.request.input,
      });
    }
  }
});

test('native seed resolvers strip artifact-facing sensitive seed fields', async () => {
  const fixture = SITE_FIXTURES.find((entry) => entry.site === 'douyin');
  assert.ok(fixture, 'Missing native seed fixture for douyin');
  const request = {
    site: 'douyin',
    input: 'https://www.douyin.com/video/7321000000000000099?access_token=synthetic-seed-input-token&auth_token=synthetic-seed-input-auth-token&sessionid=synthetic-seed-input-session',
    title: 'Cookie: sid=synthetic-seed-title-cookie',
    groupId: 'sessionid=synthetic-seed-group-session',
    headers: {
      Cookie: 'sessionid=synthetic-seed-request-cookie',
      Authorization: 'Bearer synthetic-seed-request-auth',
      'X-CSRF-Token': 'synthetic-seed-request-csrf',
      'User-Agent': 'native-seed-safe-agent',
    },
    metadata: {
      directMedia: [{
        id: 'synthetic-seed-id-token',
        resolvedMediaUrl: 'https://v3-web.example.test/schema/sensitive-play.mp4',
        fileName: 'csrf=synthetic-seed-file-csrf.mp4',
        pageUrl: 'https://www.douyin.com/video/7321000000000000099?refresh_token=synthetic-seed-page-token&token=synthetic-seed-page-token',
        referer: 'https://www.douyin.com/video/7321000000000000099?sessionid=synthetic-seed-referer-session',
        headers: {
          Cookie: 'sessionid=synthetic-seed-resource-cookie',
          Authorization: 'Bearer synthetic-seed-resource-auth',
          Range: 'bytes=0-',
        },
        metadata: {
          diagnostic: 'Authorization: Bearer synthetic-seed-metadata-auth',
          label: 'safe metadata label',
        },
      }],
    },
    dryRun: true,
  };

  const { plan, resolved } = await resolveFixture(fixture, request, {
    siteKey: 'douyin',
    status: 'ready',
    headers: {
      Cookie: 'sessionid=synthetic-seed-lease-cookie',
      Authorization: 'Bearer synthetic-seed-lease-auth',
      'User-Agent': 'native-seed-lease-agent',
    },
  });
  const resource = resolved.resources[0];
  const serialized = JSON.stringify(resolved);

  assert.equal(resolved.resources.length, 1);
  assert.equal(resource.url, 'https://v3-web.example.test/schema/sensitive-play.mp4');
  assert.equal(resource.id.includes('synthetic-seed'), false);
  assert.equal(resource.fileName, '0001-download.mp4');
  assert.equal(resource.sourceUrl, plan.source.canonicalUrl);
  assert.equal(resource.referer, plan.source.canonicalUrl);
  assert.equal(resource.headers.Cookie, undefined);
  assert.equal(resource.headers.Authorization, undefined);
  assert.equal(resource.headers['X-CSRF-Token'], undefined);
  assert.deepEqual(resource.headers, {
    'User-Agent': 'native-seed-safe-agent',
    Range: 'bytes=0-',
  });
  assert.equal(resource.metadata.label, 'safe metadata label');
  assert.equal(resource.metadata.diagnostic, undefined);
  assert.doesNotMatch(serialized, /synthetic-seed-|Authorization|Cookie|csrf=|sessionid=|access_token=|auth_token=|refresh_token=|\btoken=|Bearer/iu);
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
    assert.ok(fixture, `Missing native seed fixture for ${request.site}`);
    const { resolved } = await resolveFixture(fixture, request, null);
    assert.deepEqual(sortedKeys(resolved), REQUIRED_TASK_KEYS_SORTED);
    assert.deepEqual(sortedKeys(resolved.completeness), REQUIRED_COMPLETENESS_KEYS_SORTED);
    assert.equal(resolved.siteKey, request.site);
    assert.equal(resolved.resources.length, 0);
    assert.equal(resolved.completeness.complete, false);
    assert.equal(resolved.completeness.expectedCount, 0);
    assert.equal(resolved.completeness.resolvedCount, 0);
    assert.equal(resolved.completeness.reason, 'legacy-downloader-required');
  }
});
