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

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');

async function resolveDouyin(request, extraContext = {}, sessionLease = null) {
  const definition = await resolveDownloadSiteDefinition({ site: 'douyin' }, { workspaceRoot: REPO_ROOT });
  const plan = await createDownloadPlan(request, {
    workspaceRoot: REPO_ROOT,
    definition,
  });
  const resolved = await resolveDownloadResources(plan, sessionLease, {
    request,
    workspaceRoot: REPO_ROOT,
    definition,
    ...extraContext,
  });
  return { plan, resolved };
}

test('douyin native resolver maps injected ordinary video media results to resources', async () => {
  const called = [];
  const { resolved } = await resolveDouyin({
    site: 'douyin',
    input: 'https://www.douyin.com/video/7321000000000000000',
    dryRun: true,
  }, {
    resolveDouyinMediaBatch: async (items) => {
      called.push(...items);
      return {
        results: [{
          videoId: '7321000000000000000',
          requestedUrl: items[0],
          bestUrl: 'https://v3-web.example.test/native/video.mp4',
          resolvedTitle: 'Native Douyin Clip',
          bestFormat: {
            formatId: 'play',
            codec: 'h264',
            width: 1080,
            height: 1920,
          },
          downloadHeaders: {
            Referer: 'https://www.douyin.com/',
          },
        }],
      };
    },
  }, {
    siteKey: 'douyin',
    status: 'ready',
    headers: { 'Accept-Language': 'zh-CN' },
  });

  assert.deepEqual(called, ['https://www.douyin.com/video/7321000000000000000']);
  assert.equal(resolved.resources.length, 1);
  assert.equal(resolved.resources[0].url, 'https://v3-web.example.test/native/video.mp4');
  assert.equal(resolved.resources[0].fileName, '0001-Native Douyin Clip.mp4');
  assert.equal(resolved.resources[0].mediaType, 'video');
  assert.equal(resolved.resources[0].headers['Accept-Language'], 'zh-CN');
  assert.equal(resolved.resources[0].headers.Referer, 'https://www.douyin.com/');
  assert.equal(resolved.resources[0].metadata.videoId, '7321000000000000000');
  assert.equal(resolved.resources[0].metadata.sourceType, 'ordinary-video');
  assert.equal(resolved.metadata.resolver.method, 'native-douyin-resource-seeds');
  assert.equal(resolved.metadata.resolution.sourceType, 'ordinary-video');
  assert.equal(resolved.completeness.reason, 'douyin-resource-seeds-provided');
});

test('douyin native resolver enumerates author videos and resolves only missing direct media', async () => {
  const resolvedTargets = [];
  const { resolved } = await resolveDouyin({
    site: 'douyin',
    input: 'https://www.douyin.com/user/MS4wLjABfixture',
    maxItems: 2,
    dryRun: true,
  }, {
    enumerateDouyinAuthorVideos: async ({ limit }) => {
      assert.equal(limit, 2);
      return {
        videos: [
          {
            videoId: '7321000000000000001',
            title: 'Pre Resolved',
            requestedUrl: 'https://www.douyin.com/video/7321000000000000001',
            resolvedMediaUrl: 'https://v3-web.example.test/author/pre.mp4',
          },
          {
            videoId: '7321000000000000002',
            title: 'Needs Resolve',
            url: 'https://www.douyin.com/video/7321000000000000002',
          },
        ],
      };
    },
    resolveDouyinMediaBatch: async (items) => {
      resolvedTargets.push(...items);
      return [{
        videoId: '7321000000000000002',
        requestedUrl: items[0],
        bestUrl: 'https://v3-web.example.test/author/resolved.mp4',
        title: 'Needs Resolve',
      }];
    },
  });

  assert.deepEqual(resolvedTargets, ['https://www.douyin.com/video/7321000000000000002']);
  assert.equal(resolved.resources.length, 2);
  assert.deepEqual(resolved.resources.map((resource) => resource.url), [
    'https://v3-web.example.test/author/pre.mp4',
    'https://v3-web.example.test/author/resolved.mp4',
  ]);
  assert.deepEqual(resolved.resources.map((resource) => resource.metadata.sourceType), ['author', 'author']);
  assert.equal(resolved.metadata.resolution.attemptedVideos, 2);
});

test('douyin native resolver maps injected followed updates without refreshing live state', async () => {
  let queryCalled = false;
  const { resolved } = await resolveDouyin({
    site: 'douyin',
    input: 'followed updates',
    followedUpdates: true,
    window: 'today',
    userFilter: ['creator'],
    titleKeyword: ['clip'],
    updatedOnly: true,
    dryRun: true,
  }, {
    queryDouyinFollow: async (query) => {
      queryCalled = true;
      assert.equal(query.intent, 'list-followed-updates');
      assert.equal(query.window, 'today');
      assert.deepEqual(query.userFilter, ['creator']);
      assert.deepEqual(query.titleKeyword, ['clip']);
      assert.equal(query.updatedOnly, true);
      return {
        videos: [{
          videoId: '7321000000000000003',
          title: 'Followed Clip',
          requestedUrl: 'https://www.douyin.com/video/7321000000000000003',
          resolvedMediaUrl: 'https://v3-web.example.test/followed/clip.mp4',
        }],
      };
    },
  });

  assert.equal(queryCalled, true);
  assert.equal(resolved.resources.length, 1);
  assert.equal(resolved.resources[0].url, 'https://v3-web.example.test/followed/clip.mp4');
  assert.equal(resolved.resources[0].metadata.sourceType, 'followed-updates');
  assert.equal(resolved.metadata.resolution.sourceType, 'followed-updates');
});

test('douyin ordinary inputs still fall back when no fixture or injected resolver is available', async () => {
  const { resolved } = await resolveDouyin({
    site: 'douyin',
    input: 'https://www.douyin.com/video/7321000000000000004',
    dryRun: true,
  });

  assert.equal(resolved.resources.length, 0);
  assert.equal(resolved.completeness.reason, 'legacy-downloader-required');
});
