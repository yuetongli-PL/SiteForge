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

async function resolveXiaohongshu(request, sessionLease = null, extraContext = {}) {
  const definition = await resolveDownloadSiteDefinition({ site: 'xiaohongshu' }, { workspaceRoot: REPO_ROOT });
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

test('xiaohongshu native resolver maps offline note image payload to image resources', async () => {
  const { resolved } = await resolveXiaohongshu({
    site: 'xiaohongshu',
    input: 'https://www.xiaohongshu.com/explore/662233445566778899aabbcc',
    title: 'Fixture Note',
    xiaohongshuNotePayload: {
      note_card: {
        note_id: '662233445566778899aabbcc',
        display_title: 'Fixture Note',
        image_list: [
          { trace_id: 'image-1', url_default: 'https://ci.xiaohongshu.example.test/note/image-1.jpg' },
          { trace_id: 'image-2', info_list: [{ url: 'https://ci.xiaohongshu.example.test/note/image-2.png' }] },
        ],
      },
    },
    dryRun: true,
  }, {
    siteKey: 'xiaohongshu',
    status: 'ready',
    headers: { Referer: 'https://www.xiaohongshu.com/' },
  });

  assert.equal(resolved.siteKey, 'xiaohongshu');
  assert.equal(resolved.resources.length, 2);
  assert.deepEqual(resolved.resources.map((resource) => resource.url), [
    'https://ci.xiaohongshu.example.test/note/image-1.jpg',
    'https://ci.xiaohongshu.example.test/note/image-2.png',
  ]);
  assert.deepEqual(resolved.resources.map((resource) => resource.mediaType), ['image', 'image']);
  assert.equal(resolved.resources[0].headers.Referer, 'https://www.xiaohongshu.com/');
  assert.equal(resolved.resources[0].sourceUrl, 'https://www.xiaohongshu.com/explore/662233445566778899aabbcc');
  assert.equal(resolved.resources[0].referer, 'https://www.xiaohongshu.com/explore/662233445566778899aabbcc');
  assert.equal(resolved.resources[0].metadata.noteId, '662233445566778899aabbcc');
  assert.equal(resolved.resources[0].metadata.assetType, 'image');
  assert.equal(resolved.metadata.resolver.method, 'native-xiaohongshu-resource-seeds');
  assert.equal(resolved.completeness.complete, true);
  assert.equal(resolved.completeness.reason, 'xiaohongshu-resource-seeds-provided');
});

test('xiaohongshu native resolver maps offline note video payload to a video resource', async () => {
  const { resolved } = await resolveXiaohongshu({
    site: 'xiaohongshu',
    input: 'https://www.xiaohongshu.com/explore/662233445566778899aabbcd',
    notePayload: {
      note: {
        id: '662233445566778899aabbcd',
        title: 'Fixture Video Note',
        video: {
          media: {
            stream: {
              h264: [{
                master_url: 'https://sns-video.example.test/note/video.mp4',
              }],
            },
          },
        },
      },
    },
    dryRun: true,
  });

  assert.equal(resolved.resources.length, 1);
  assert.equal(resolved.resources[0].url, 'https://sns-video.example.test/note/video.mp4');
  assert.equal(resolved.resources[0].mediaType, 'video');
  assert.equal(resolved.resources[0].metadata.noteId, '662233445566778899aabbcd');
  assert.equal(resolved.resources[0].metadata.assetType, 'video');
  assert.equal(resolved.completeness.reason, 'xiaohongshu-resource-seeds-provided');
});

test('xiaohongshu native resolver maps ordinary note fixture page facts to image and video resources', async () => {
  const { resolved } = await resolveXiaohongshu({
    site: 'xiaohongshu',
    input: 'https://www.xiaohongshu.com/explore/662233445566778899aabbcf',
    pageFacts: {
      noteId: '662233445566778899aabbcf',
      title: 'Fixture Page Facts',
      authorName: 'Fixture Author',
      contentImages: [
        {
          assetId: 'image-1',
          url: 'https://ci.xiaohongshu.example.test/page-facts/image-1.jpg',
          previewUrl: 'https://ci.xiaohongshu.example.test/page-facts/image-1-preview.jpg',
          width: 1080,
          height: 1440,
        },
      ],
      contentVideos: [
        {
          id: 'video-1',
          media: {
            stream: {
              h265: [{ url: 'https://sns-video.example.test/page-facts/video.mp4' }],
            },
          },
        },
      ],
    },
    dryRun: true,
  });

  assert.equal(resolved.resources.length, 2);
  assert.deepEqual(resolved.resources.map((resource) => resource.mediaType), ['image', 'video']);
  assert.equal(resolved.resources[0].url, 'https://ci.xiaohongshu.example.test/page-facts/image-1.jpg');
  assert.equal(resolved.resources[1].url, 'https://sns-video.example.test/page-facts/video.mp4');
  assert.equal(resolved.resources[0].metadata.noteId, '662233445566778899aabbcf');
  assert.equal(resolved.resources[0].metadata.noteTitle, 'Fixture Page Facts');
  assert.equal(resolved.resources[0].metadata.authorName, 'Fixture Author');
  assert.equal(resolved.resources[0].metadata.previewUrl, 'https://ci.xiaohongshu.example.test/page-facts/image-1-preview.jpg');
  assert.equal(resolved.resources[1].metadata.assetType, 'video');
  assert.equal(resolved.metadata.resolution.sourceType, 'page-facts');
  assert.equal(resolved.completeness.reason, 'xiaohongshu-resource-seeds-provided');
});

test('xiaohongshu native resolver records missing header freshness evidence without secrets', async () => {
  const { resolved } = await resolveXiaohongshu({
    site: 'xiaohongshu',
    input: 'https://www.xiaohongshu.com/explore/662233445566778899aabbfa',
    requiredHeaderNames: ['x-s'],
    pageFacts: {
      noteId: '662233445566778899aabbfa',
      title: 'Missing Header Evidence',
      contentImages: [
        'https://ci.xiaohongshu.example.test/page-facts/missing-header.jpg',
      ],
    },
    dryRun: true,
  });

  const freshness = resolved.metadata.resolution.headerFreshness;
  assert.equal(freshness.freshnessStatus, 'missing-required');
  assert.deepEqual(freshness.requiredHeaderNames, ['User-Agent', 'x-s']);
  assert.deepEqual(freshness.missingRequiredHeaders, ['x-s']);
  assert.equal(freshness.riskCauseCode, 'header-evidence-incomplete');
  assert.deepEqual(freshness.resolverHeaderNames, ['User-Agent']);
  assert.equal(JSON.stringify(freshness).includes('secret'), false);
});

test('xiaohongshu native resolver maps fixture HTML media without live navigation', async () => {
  const { resolved } = await resolveXiaohongshu({
    site: 'xiaohongshu',
    input: 'https://www.xiaohongshu.com/explore/662233445566778899aabbd0',
    title: 'Fixture HTML',
    fixtureHtml: `
      <html>
        <body>
          <img src="https://ci.xiaohongshu.example.test/html/image.webp">
          <video src="https://sns-video.example.test/html/video.mp4"></video>
        </body>
      </html>
    `,
    dryRun: true,
  });

  assert.equal(resolved.resources.length, 2);
  assert.deepEqual(resolved.resources.map((resource) => resource.url), [
    'https://ci.xiaohongshu.example.test/html/image.webp',
    'https://sns-video.example.test/html/video.mp4',
  ]);
  assert.equal(resolved.resources[0].metadata.sourceType, 'fixture-html');
  assert.equal(resolved.metadata.resolution.sourceType, 'fixture-html');
});

test('xiaohongshu fetched HTML stays behind network gate and supports injected fetch', async () => {
  const originalFetch = globalThis.fetch;
  let globalFetchCalls = 0;
  globalThis.fetch = async () => {
    globalFetchCalls += 1;
    throw new Error('global fetch should stay behind the network gate');
  };
  try {
    const { resolved: gatedResolved } = await resolveXiaohongshu({
      site: 'xiaohongshu',
      input: 'https://www.xiaohongshu.com/explore/662233445566778899aabbd1',
      dryRun: true,
    });

    assert.equal(globalFetchCalls, 0);
    assert.equal(gatedResolved.resources.length, 0);
    assert.equal(gatedResolved.completeness.reason, 'legacy-downloader-required');
  } finally {
    globalThis.fetch = originalFetch;
  }

  let injectedFetchUrl = '';
  const { resolved } = await resolveXiaohongshu({
    site: 'xiaohongshu',
    input: 'https://www.xiaohongshu.com/explore/662233445566778899aabbd1',
    title: 'Fetched HTML',
    headers: { 'x-s': 'fresh-signature' },
    headersFresh: true,
    requiredHeaderNames: ['x-s'],
    dryRun: true,
  }, {
    siteKey: 'xiaohongshu',
    status: 'ready',
    headers: {
      Cookie: 'a1=secret-cookie',
      Referer: 'https://www.xiaohongshu.com/',
    },
  }, {
    mockFetchImpl: async (url) => {
      injectedFetchUrl = url;
      return {
        ok: true,
        url,
        async text() {
          return `
            <html>
              <body>
                <img src="https://ci.xiaohongshu.example.test/fetched/image.jpg">
                <source src="https://sns-video.example.test/fetched/video.mp4">
              </body>
            </html>
          `;
        },
      };
    },
  });

  assert.equal(injectedFetchUrl, 'https://www.xiaohongshu.com/explore/662233445566778899aabbd1');
  assert.equal(resolved.resources.length, 2);
  assert.deepEqual(resolved.resources.map((resource) => resource.url), [
    'https://ci.xiaohongshu.example.test/fetched/image.jpg',
    'https://sns-video.example.test/fetched/video.mp4',
  ]);
  assert.equal(resolved.resources[0].metadata.sourceType, 'fetched-html');
  assert.equal(resolved.metadata.resolution.sourceType, 'fetched-html');
  assert.equal(resolved.metadata.resolution.fetchSource, 'injected-fetch');
  assert.equal(resolved.metadata.resolution.networkGateUsed, false);
  assert.equal(resolved.metadata.resolution.fetchedUrlPresent, true);
  assert.deepEqual(resolved.metadata.resolution.headerFreshness.headerNames, ['Cookie', 'Referer', 'User-Agent', 'x-s']);
  assert.deepEqual(resolved.metadata.resolution.headerFreshness.requiredHeaderNames, ['User-Agent', 'x-s']);
  assert.deepEqual(resolved.metadata.resolution.headerFreshness.missingRequiredHeaders, []);
  assert.equal(resolved.metadata.resolution.headerFreshness.freshnessStatus, 'claimed-fresh');
  assert.equal(resolved.metadata.resolution.headerFreshness.cookieEvidence, true);
  assert.equal(resolved.metadata.resolution.headerFreshness.freshnessClaimed, true);
  assert.equal(JSON.stringify(resolved.metadata.resolution.headerFreshness).includes('secret-cookie'), false);
});

test('xiaohongshu native resolver maps search, author, and followed mock notes to resources', async () => {
  const { resolved: searchResolved } = await resolveXiaohongshu({
    site: 'xiaohongshu',
    input: 'coffee',
    query: 'coffee',
    searchNotes: [{
      noteId: 'search-note-1',
      title: 'Search Note',
      imageList: [{ url: 'https://ci.xiaohongshu.example.test/search/image.jpg' }],
      user: { nickname: 'Search Author', userId: 'user-search' },
    }],
    dryRun: true,
  });

  assert.equal(searchResolved.resources.length, 1);
  assert.equal(searchResolved.resources[0].url, 'https://ci.xiaohongshu.example.test/search/image.jpg');
  assert.equal(searchResolved.resources[0].metadata.sourceType, 'search');
  assert.equal(searchResolved.resources[0].metadata.queryText, 'coffee');

  const { resolved: authorResolved } = await resolveXiaohongshu({
    site: 'xiaohongshu',
    input: 'https://www.xiaohongshu.com/user/profile/mock-author',
    authorNotes: [{
      noteId: 'author-note-1',
      title: 'Author Note',
      image_list: [{ url_default: 'https://ci.xiaohongshu.example.test/author/image.jpg' }],
      authorName: 'Author Name',
    }],
    dryRun: true,
  });

  assert.equal(authorResolved.resources.length, 1);
  assert.equal(authorResolved.resources[0].metadata.sourceType, 'author');
  assert.equal(authorResolved.resources[0].metadata.authorName, 'Author Name');

  let queryCalled = false;
  const { resolved: followedResolved } = await resolveXiaohongshu({
    site: 'xiaohongshu',
    input: 'followed users',
    followedUsers: true,
    dryRun: true,
  }, null, {
    queryXiaohongshuFollow: async (query) => {
      queryCalled = true;
      assert.equal(query.contractVersion, 'xiaohongshu-native-resolver-deps-v1');
      assert.equal(query.intent, 'list-followed-users');
      assert.equal(query.sourceType, 'followed-users');
      assert.equal(query.allowNetworkResolve, false);
      assert.equal(query.headerFreshness.contractVersion, 'xiaohongshu-header-freshness-v1');
      return {
        notes: [{
          noteId: 'followed-note-1',
          title: 'Followed Note',
          images: [{ url: 'https://ci.xiaohongshu.example.test/followed/image.jpg' }],
        }],
      };
    },
  });

  assert.equal(queryCalled, true);
  assert.equal(followedResolved.resources.length, 1);
  assert.equal(followedResolved.resources[0].metadata.sourceType, 'followed-users');
});

test('xiaohongshu ordinary note input without fixture payload still falls back to legacy resolution', async () => {
  const { plan, resolved } = await resolveXiaohongshu({
    site: 'xiaohongshu',
    input: 'https://www.xiaohongshu.com/explore/662233445566778899aabbce',
    dryRun: true,
  });

  assert.equal(resolved.resources.length, 0);
  assert.equal(resolved.completeness.reason, 'legacy-downloader-required');
  assert.equal(plan.legacy.entrypoint.endsWith(path.join('src', 'entrypoints', 'sites', 'xiaohongshu-action.mjs')), true);
});
