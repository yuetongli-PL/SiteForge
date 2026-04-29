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
    resolveDouyinMediaBatch: async (items, options) => {
      assert.equal(options.contractVersion, 'douyin-native-resolver-deps-v1');
      assert.equal(options.intent, 'resolve-media-batch');
      assert.equal(options.sourceType, 'media-batch');
      assert.equal(options.allowNetworkResolve, false);
      assert.equal(options.evidenceInput.contractVersion, 'douyin-native-evidence-v1');
      assert.deepEqual(options.evidenceInput.session.headerNames, ['Accept-Language']);
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
  assert.equal(resolved.resources[0].metadata.evidenceId, 'douyin-native-evidence-v1:ordinary-video');
  assert.equal(resolved.metadata.resolver.method, 'native-douyin-resource-seeds');
  assert.equal(resolved.metadata.resolution.sourceType, 'ordinary-video');
  assert.equal(resolved.metadata.resolution.evidence.contractVersion, 'douyin-native-evidence-v1');
  assert.equal(resolved.metadata.resolution.evidence.payload.complete, true);
  assert.equal(resolved.completeness.reason, 'douyin-native-complete');
});

test('douyin native resolver enumerates author videos and resolves only missing direct media', async () => {
  const resolvedTargets = [];
  const { resolved } = await resolveDouyin({
    site: 'douyin',
    input: 'https://www.douyin.com/user/MS4wLjABfixture',
    maxItems: 2,
    dryRun: true,
  }, {
    enumerateDouyinAuthorVideos: async ({ contractVersion, intent, sourceType, allowNetworkResolve, limit }) => {
      assert.equal(contractVersion, 'douyin-native-resolver-deps-v1');
      assert.equal(intent, 'enumerate-author-videos');
      assert.equal(sourceType, 'author');
      assert.equal(allowNetworkResolve, false);
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
    resolveDouyinMediaBatch: async (items, options) => {
      assert.equal(options.contractVersion, 'douyin-native-resolver-deps-v1');
      assert.equal(options.intent, 'resolve-media-batch');
      assert.equal(options.sourceType, 'media-batch');
      assert.equal(options.allowNetworkResolve, false);
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
      assert.equal(query.contractVersion, 'douyin-native-resolver-deps-v1');
      assert.equal(query.intent, 'list-followed-updates');
      assert.equal(query.sourceType, 'followed-updates');
      assert.equal(query.allowNetworkResolve, false);
      assert.equal(query.refreshAllowed, false);
      assert.equal(query.evidenceInput.contractVersion, 'douyin-native-evidence-v1');
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

test('douyin native resolver maps fixture API detail payload without live signing', async () => {
  const { resolved } = await resolveDouyin({
    site: 'douyin',
    input: 'https://www.douyin.com/video/7321000000000000100',
    awemeDetailPayload: {
      aweme_detail: {
        aweme_id: '7321000000000000100',
        desc: 'Fixture API Clip',
        video: {
          play_addr: {
            url_list: ['https://v3-web.example.test/fixture/detail.mp4'],
          },
          cover: {
            url_list: ['https://p3.example.test/fixture/detail.jpg'],
          },
        },
        author: { nickname: 'fixture creator' },
      },
    },
    dryRun: true,
  });

  assert.equal(resolved.resources.length, 2);
  assert.equal(resolved.resources[0].url, 'https://v3-web.example.test/fixture/detail.mp4');
  assert.equal(resolved.resources[0].metadata.videoId, '7321000000000000100');
  assert.equal(resolved.resources[0].metadata.sourceType, 'fixture-api');
  assert.equal(resolved.resources[1].mediaType, 'image');
  assert.equal(resolved.metadata.resolution.sourceType, 'fixture-api');
  assert.equal(resolved.metadata.resolution.evidence.contractVersion, 'douyin-native-evidence-v1');
  assert.deepEqual(resolved.metadata.resolution.evidence.payload, {
    expectedVideos: 1,
    parsedEntries: 1,
    videoSeeds: 1,
    coverSeeds: 1,
    unresolvedVideoIds: [],
    complete: true,
  });
  assert.equal(resolved.completeness.reason, 'douyin-native-complete');
});

test('douyin native resolver consumes injected fetch API payload without global network', async () => {
  const fetchCalls = [];
  const { resolved } = await resolveDouyin({
    site: 'douyin',
    input: 'https://www.douyin.com/video/7321000000000000101',
    douyinApiUrl: 'https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=7321000000000000101',
    dryRun: true,
  }, {
    fetchImpl: async (url) => {
      fetchCalls.push(url);
      return {
        ok: true,
        async json() {
          return {
            aweme_detail: {
              aweme_id: '7321000000000000101',
              desc: 'Injected Fetch Clip',
              video: {
                download_addr: {
                  url_list: ['https://v3-web.example.test/injected/detail.mp4'],
                },
              },
            },
          };
        },
      };
    },
  });

  assert.deepEqual(fetchCalls, ['https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=7321000000000000101']);
  assert.equal(resolved.resources.length, 1);
  assert.equal(resolved.resources[0].url, 'https://v3-web.example.test/injected/detail.mp4');
  assert.equal(resolved.metadata.resolution.sourceType, 'fixture-api');
  assert.equal(resolved.metadata.resolution.evidence.request.signedApiProvided, undefined);
});

test('douyin native resolver maps fixture HTML JSON payloads without page navigation', async () => {
  const { resolved } = await resolveDouyin({
    site: 'douyin',
    input: 'https://www.douyin.com/video/7321000000000000102',
    fixtureHtml: `<html><body><script type="application/json">${JSON.stringify({
      aweme_detail: {
        aweme_id: '7321000000000000102',
        desc: 'Fixture HTML Clip',
        video: {
          play_addr: {
            url_list: ['https://v3-web.example.test/html/detail.mp4'],
          },
        },
      },
    })}</script></body></html>`,
    dryRun: true,
  });

  assert.equal(resolved.resources.length, 1);
  assert.equal(resolved.resources[0].url, 'https://v3-web.example.test/html/detail.mp4');
  assert.equal(resolved.metadata.resolution.sourceType, 'fixture-api');
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

test('douyin native resolver records sanitized signed API and header evidence only', async () => {
  const { resolved } = await resolveDouyin({
    site: 'douyin',
    input: 'https://www.douyin.com/video/7321000000000000103',
    douyinApiUrl: 'https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=7321000000000000103&a_bogus=secret-a&msToken=secret-m&verifyFp=secret-v',
    fetchHeaders: {
      Cookie: 'sessionid=secret',
      'User-Agent': 'Browser-Wiki-Skill test',
    },
    dryRun: true,
  }, {
    mockFetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          aweme_detail: {
            aweme_id: '7321000000000000103',
            desc: 'Signed Evidence Clip',
            video: {
              play_addr: {
                url_list: ['https://v3-web.example.test/signed/detail.mp4'],
              },
            },
          },
        };
      },
    }),
  });

  const evidence = resolved.metadata.resolution.evidence;
  assert.equal(evidence.request.signedApiProvided, true);
  assert.deepEqual(evidence.request.signatureParamsPresent, ['a_bogus', 'msToken', 'verifyFp']);
  assert.deepEqual(evidence.request.headersPresent, ['Cookie', 'User-Agent']);
  assert.equal(evidence.request.cookieEvidence, true);
  assert.equal(JSON.stringify(evidence).includes('secret'), false);
});

test('douyin followed refresh is allowed only with explicit network gate and refresh request', async () => {
  let observedRefreshAllowed = null;
  const { resolved } = await resolveDouyin({
    site: 'douyin',
    input: 'followed updates',
    followedUpdates: true,
    refreshCache: true,
    dryRun: true,
  }, {
    allowNetworkResolve: true,
    queryDouyinFollow: async (query) => {
      observedRefreshAllowed = query.refreshAllowed;
      return {
        videos: [{
          videoId: '7321000000000000104',
          title: 'Refresh Allowed Clip',
          requestedUrl: 'https://www.douyin.com/video/7321000000000000104',
          resolvedMediaUrl: 'https://v3-web.example.test/followed/refresh.mp4',
        }],
      };
    },
  });

  assert.equal(observedRefreshAllowed, true);
  assert.equal(resolved.metadata.resolution.evidence.cache.refreshAllowed, true);
});

test('douyin fixture payload with cover only is native but incomplete', async () => {
  const { resolved } = await resolveDouyin({
    site: 'douyin',
    input: 'https://www.douyin.com/video/7321000000000000105',
    awemeDetailPayload: {
      aweme_detail: {
        aweme_id: '7321000000000000105',
        desc: 'Cover Only Clip',
        video: {
          cover: {
            url_list: ['https://p3.example.test/cover-only.jpg'],
          },
        },
      },
    },
    dryRun: true,
  });

  assert.equal(resolved.resources.length, 1);
  assert.equal(resolved.resources[0].mediaType, 'image');
  assert.equal(resolved.metadata.resolution.evidence.payload.expectedVideos, 1);
  assert.deepEqual(resolved.metadata.resolution.evidence.payload.unresolvedVideoIds, ['7321000000000000105']);
  assert.equal(resolved.metadata.resolution.evidence.payload.complete, false);
  assert.equal(resolved.completeness.complete, false);
  assert.equal(resolved.completeness.reason, 'douyin-native-payload-incomplete');
});
