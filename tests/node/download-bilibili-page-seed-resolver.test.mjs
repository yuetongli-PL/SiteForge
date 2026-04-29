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

async function resolveBilibili(request, sessionLease = null, extraContext = {}) {
  const definition = await resolveDownloadSiteDefinition({ site: 'bilibili' }, { workspaceRoot: REPO_ROOT });
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

test('bilibili native resolver maps offline dash playurl payload to video and audio resources', async () => {
  const { resolved } = await resolveBilibili({
    site: 'bilibili',
    input: 'https://www.bilibili.com/video/BV1fixturePage/',
    title: 'Fixture Bilibili Video',
    bilibiliVideoPayload: {
      data: {
        title: 'Fixture Bilibili Video',
        dash: {
          video: [{
            id: 80,
            baseUrl: 'https://upos.example.test/BV1fixturePage/video-1080p.m4s',
            mimeType: 'video/mp4',
            bandwidth: 2400000,
            codecs: 'avc1.640032',
            width: 1920,
            height: 1080,
            size: 4096,
          }],
          audio: [{
            id: 30280,
            base_url: 'https://upos.example.test/BV1fixturePage/audio.m4s',
            mime_type: 'audio/mp4',
            bandwidth: 128000,
            codecs: 'mp4a.40.2',
          }],
        },
      },
    },
    dryRun: true,
  }, {
    siteKey: 'bilibili',
    status: 'ready',
    headers: { Referer: 'https://www.bilibili.com/' },
  });

  assert.equal(resolved.siteKey, 'bilibili');
  assert.equal(resolved.resources.length, 2);
  assert.deepEqual(resolved.resources.map((resource) => resource.url), [
    'https://upos.example.test/BV1fixturePage/video-1080p.m4s',
    'https://upos.example.test/BV1fixturePage/audio.m4s',
  ]);
  assert.deepEqual(resolved.resources.map((resource) => resource.mediaType), ['video', 'audio']);
  assert.equal(resolved.resources[0].expectedBytes, 4096);
  assert.equal(resolved.resources[0].headers.Referer, 'https://www.bilibili.com/');
  assert.equal(resolved.resources[0].sourceUrl, 'https://www.bilibili.com/video/BV1fixturePage/');
  assert.equal(resolved.resources[0].referer, 'https://www.bilibili.com/video/BV1fixturePage/');
  assert.equal(resolved.resources[0].metadata.streamType, 'video');
  assert.equal(resolved.resources[1].metadata.streamType, 'audio');
  assert.equal(resolved.resources[0].metadata.muxRole, 'video');
  assert.equal(resolved.resources[1].metadata.muxRole, 'audio');
  assert.equal(resolved.resources[0].metadata.muxKind, 'dash-audio-video');
  assert.equal(resolved.metadata.resolver.method, 'native-bilibili-resource-seeds');
  assert.equal(resolved.completeness.complete, true);
  assert.equal(resolved.completeness.reason, 'bilibili-resource-seeds-provided');
});

test('bilibili native resolver maps offline durl payload to a video resource', async () => {
  const { resolved } = await resolveBilibili({
    site: 'bilibili',
    input: 'https://www.bilibili.com/video/BV1fixtureDurl/',
    metadata: {
      playUrlPayload: {
        data: {
          durl: [{
            order: 1,
            url: 'https://upos.example.test/BV1fixtureDurl/part-1.flv',
            size: 2048,
          }],
        },
      },
    },
    dryRun: true,
  });

  assert.equal(resolved.resources.length, 1);
  assert.equal(resolved.resources[0].url, 'https://upos.example.test/BV1fixtureDurl/part-1.flv');
  assert.equal(resolved.resources[0].mediaType, 'video');
  assert.equal(resolved.resources[0].expectedBytes, 2048);
  assert.equal(resolved.completeness.reason, 'bilibili-resource-seeds-provided');
});

test('bilibili native resolver expands offline BV view payload with multi-page playurl payloads', async () => {
  const { resolved } = await resolveBilibili({
    site: 'bilibili',
    input: 'https://www.bilibili.com/video/BV1fixtureMulti/',
    bilibiliViewPayload: {
      data: {
        bvid: 'BV1fixtureMulti',
        aid: 10001,
        title: 'Multi Page Fixture',
        pages: [
          { cid: 111, page: 1, part: 'Part One' },
          { cid: 222, page: 2, part: 'Part Two' },
        ],
      },
    },
    playUrlPayloads: {
      111: {
        cid: 111,
        data: {
          dash: {
            video: [{ id: 80, baseUrl: 'https://upos.example.test/BV1fixtureMulti/p1-video.m4s', mimeType: 'video/mp4' }],
            audio: [{ id: 30280, baseUrl: 'https://upos.example.test/BV1fixtureMulti/p1-audio.m4s', mimeType: 'audio/mp4' }],
          },
        },
      },
      222: {
        cid: 222,
        data: {
          dash: {
            video: [{ id: 80, baseUrl: 'https://upos.example.test/BV1fixtureMulti/p2-video.m4s', mimeType: 'video/mp4' }],
            audio: [{ id: 30280, baseUrl: 'https://upos.example.test/BV1fixtureMulti/p2-audio.m4s', mimeType: 'audio/mp4' }],
          },
        },
      },
    },
    dryRun: true,
  });

  assert.equal(resolved.resources.length, 4);
  assert.deepEqual(resolved.resources.map((resource) => resource.url), [
    'https://upos.example.test/BV1fixtureMulti/p1-video.m4s',
    'https://upos.example.test/BV1fixtureMulti/p1-audio.m4s',
    'https://upos.example.test/BV1fixtureMulti/p2-video.m4s',
    'https://upos.example.test/BV1fixtureMulti/p2-audio.m4s',
  ]);
  assert.deepEqual([...new Set(resolved.resources.map((resource) => resource.groupId))], [
    'bilibili:BV1fixtureMulti:p1',
    'bilibili:BV1fixtureMulti:p2',
  ]);
  assert.equal(resolved.resources[0].metadata.bvid, 'BV1fixtureMulti');
  assert.equal(resolved.resources[0].metadata.cid, '111');
  assert.equal(resolved.resources[0].metadata.page, 1);
  assert.equal(resolved.resources[2].metadata.partTitle, 'Part Two');
  assert.equal(resolved.metadata.resolution.expectedVideos, 2);
  assert.equal(resolved.completeness.reason, 'bilibili-resource-seeds-provided');
});

test('bilibili native resolver expands offline collection and UP archive payloads', async () => {
  const { resolved: collectionResolved } = await resolveBilibili({
    site: 'bilibili',
    input: 'https://space.bilibili.com/100/channel/collectiondetail?sid=200',
    bilibiliCollectionPayload: {
      data: {
        sid: '200',
        title: 'Fixture Collection',
        items: [
          { bvid: 'BV1collectionA', title: 'Collection A', cid: 3001 },
          { bvid: 'BV1collectionB', title: 'Collection B', cid: 3002 },
        ],
      },
    },
    playUrlPayloads: {
      BV1collectionA: { bvid: 'BV1collectionA', data: { durl: [{ url: 'https://upos.example.test/collection/a.flv' }] } },
      BV1collectionB: { bvid: 'BV1collectionB', data: { durl: [{ url: 'https://upos.example.test/collection/b.flv' }] } },
    },
    dryRun: true,
  });

  assert.equal(collectionResolved.resources.length, 2);
  assert.deepEqual(collectionResolved.resources.map((resource) => resource.url), [
    'https://upos.example.test/collection/a.flv',
    'https://upos.example.test/collection/b.flv',
  ]);
  assert.equal(collectionResolved.resources[0].metadata.playlistKind, 'collection');
  assert.equal(collectionResolved.resources[0].metadata.playlistTitle, 'Fixture Collection');

  const { resolved: upResolved } = await resolveBilibili({
    site: 'bilibili',
    input: 'https://space.bilibili.com/100/video',
    maxItems: 1,
    bilibiliSpaceArchivesPayload: {
      data: {
        list: {
          vlist: [
            { bvid: 'BV1upA', title: 'UP A', cid: 4001 },
            { bvid: 'BV1upB', title: 'UP B', cid: 4002 },
          ],
        },
      },
    },
    playUrlPayloads: {
      BV1upA: { bvid: 'BV1upA', data: { durl: [{ url: 'https://upos.example.test/up/a.flv' }] } },
      BV1upB: { bvid: 'BV1upB', data: { durl: [{ url: 'https://upos.example.test/up/b.flv' }] } },
    },
    dryRun: true,
  });

  assert.equal(upResolved.resources.length, 1);
  assert.equal(upResolved.resources[0].url, 'https://upos.example.test/up/a.flv');
  assert.equal(upResolved.resources[0].metadata.playlistKind, 'space-archives');
});

test('bilibili ordinary BV input can resolve through injected API evidence contract', async () => {
  const evidenceRequests = [];
  const { resolved } = await resolveBilibili({
    site: 'bilibili',
    input: 'https://www.bilibili.com/video/BV1injectedEvidence/',
    dryRun: true,
  }, null, {
    resolveBilibiliApiEvidence: async (evidenceRequest, options) => {
      evidenceRequests.push(evidenceRequest);
      assert.equal(evidenceRequest.contractVersion, 'bilibili-native-api-evidence-v1');
      assert.equal(evidenceRequest.inputKind, 'video-detail');
      assert.equal(evidenceRequest.bvid, 'BV1injectedEvidence');
      assert.deepEqual(evidenceRequest.requiredPayloads, ['view', 'playurl']);
      assert.equal(evidenceRequest.allowNetworkResolve, false);
      assert.equal(options.allowNetworkResolve, false);
      return {
        viewPayload: {
          data: {
            bvid: 'BV1injectedEvidence',
            title: 'Injected Evidence Video',
            pages: [{ cid: 9101, page: 1, part: 'Injected Part' }],
          },
        },
        playUrlPayloads: {
          9101: {
            cid: 9101,
            data: {
              durl: [{ url: 'https://upos.example.test/injected/video.flv' }],
            },
          },
        },
      };
    },
  });

  assert.equal(evidenceRequests.length, 1);
  assert.equal(resolved.resources.length, 1);
  assert.equal(resolved.resources[0].url, 'https://upos.example.test/injected/video.flv');
  assert.equal(resolved.resources[0].metadata.bvid, 'BV1injectedEvidence');
  assert.equal(resolved.resources[0].metadata.cid, '9101');
  assert.equal(resolved.metadata.resolution.inputKind, 'video-detail');
});

test('bilibili ordinary collection input can resolve from request-injected API evidence', async () => {
  const { resolved } = await resolveBilibili({
    site: 'bilibili',
    input: 'https://space.bilibili.com/100/channel/collectiondetail?sid=700',
    bilibiliApiEvidence: {
      collectionPayload: {
        data: {
          sid: '700',
          title: 'Injected Collection Evidence',
          items: [{ bvid: 'BV1collectionEvidence', title: 'Evidence Item', cid: 7001 }],
        },
      },
      playUrlPayloads: {
        BV1collectionEvidence: {
          bvid: 'BV1collectionEvidence',
          data: {
            durl: [{ url: 'https://upos.example.test/injected/collection.flv' }],
          },
        },
      },
    },
    dryRun: true,
  });

  assert.equal(resolved.resources.length, 1);
  assert.equal(resolved.resources[0].url, 'https://upos.example.test/injected/collection.flv');
  assert.equal(resolved.resources[0].metadata.playlistKind, 'collection');
  assert.equal(resolved.resources[0].metadata.playlistId, '700');
  assert.equal(resolved.metadata.resolution.inputKind, 'playlist');
});

test('bilibili injected API evidence stays legacy when playurl evidence is partial', async () => {
  const { resolved } = await resolveBilibili({
    site: 'bilibili',
    input: 'https://www.bilibili.com/video/BV1partialEvidence/',
    bilibiliApiEvidence: {
      viewPayload: {
        data: {
          bvid: 'BV1partialEvidence',
          pages: [{ cid: 9901, page: 1 }],
        },
      },
    },
    dryRun: true,
  });

  assert.equal(resolved.resources.length, 0);
  assert.equal(resolved.completeness.reason, 'legacy-downloader-required');
});

test('bilibili native API fetch is disabled without network gate or injected fetch', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('global fetch should stay behind the network gate');
  };
  try {
    const { resolved } = await resolveBilibili({
      site: 'bilibili',
      input: 'https://www.bilibili.com/video/BV1fetchGateOff/',
      dryRun: true,
    });

    assert.equal(fetchCalls, 0);
    assert.equal(resolved.resources.length, 0);
    assert.equal(resolved.completeness.reason, 'legacy-downloader-required');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('bilibili native resolver fetches view and playurl evidence through injected fetch', async () => {
  const fetchedUrls = [];
  const mockFetchImpl = async (url) => {
    fetchedUrls.push(url);
    const parsed = new URL(url);
    if (parsed.pathname === '/x/web-interface/view') {
      assert.equal(parsed.searchParams.get('bvid'), 'BV1fetchInjected');
      return {
        ok: true,
        async json() {
          return {
            code: 0,
            data: {
              bvid: 'BV1fetchInjected',
              title: 'Fetch Injected Video',
              pages: [{ cid: 7301, page: 1, part: 'Fetched Part' }],
            },
          };
        },
      };
    }
    if (parsed.pathname === '/x/player/playurl') {
      assert.equal(parsed.searchParams.get('bvid'), 'BV1fetchInjected');
      assert.equal(parsed.searchParams.get('cid'), '7301');
      return {
        ok: true,
        async json() {
          return {
            code: 0,
            data: {
              durl: [{ url: 'https://upos.example.test/fetched/bv.flv', size: 8192 }],
            },
          };
        },
      };
    }
    throw new Error(`unexpected Bilibili API URL: ${url}`);
  };

  const { resolved } = await resolveBilibili({
    site: 'bilibili',
    input: 'https://www.bilibili.com/video/BV1fetchInjected/',
    dryRun: true,
  }, null, {
    mockFetchImpl,
  });

  assert.deepEqual(fetchedUrls.map((url) => new URL(url).pathname), [
    '/x/web-interface/view',
    '/x/player/playurl',
  ]);
  assert.equal(resolved.resources.length, 1);
  assert.equal(resolved.resources[0].url, 'https://upos.example.test/fetched/bv.flv');
  assert.equal(resolved.resources[0].metadata.bvid, 'BV1fetchInjected');
  assert.equal(resolved.resources[0].metadata.cid, '7301');
  assert.equal(resolved.metadata.resolution.inputKind, 'video-detail');
});

test('bilibili native API fetch can expand collection evidence through injected fetch', async () => {
  const mockFetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/x/polymer/web-space/seasons_archives_list') {
      assert.equal(parsed.searchParams.get('mid'), '100');
      assert.equal(parsed.searchParams.get('season_id'), '700');
      assert.equal(parsed.searchParams.get('page_size'), '1');
      return {
        ok: true,
        async json() {
          return {
            code: 0,
            data: {
              meta: { id: 700, name: 'Fetched Collection' },
              archives: [
                { bvid: 'BV1fetchCollection', title: 'Fetched Collection Item', cid: 7401 },
              ],
            },
          };
        },
      };
    }
    if (parsed.pathname === '/x/player/playurl') {
      assert.equal(parsed.searchParams.get('bvid'), 'BV1fetchCollection');
      assert.equal(parsed.searchParams.get('cid'), '7401');
      return {
        ok: true,
        async json() {
          return {
            code: 0,
            data: {
              durl: [{ url: 'https://upos.example.test/fetched/collection.flv' }],
            },
          };
        },
      };
    }
    throw new Error(`unexpected Bilibili API URL: ${url}`);
  };

  const { resolved } = await resolveBilibili({
    site: 'bilibili',
    input: 'https://space.bilibili.com/100/channel/collectiondetail?sid=700',
    maxItems: 1,
    dryRun: true,
  }, null, {
    mockFetchImpl,
  });

  assert.equal(resolved.resources.length, 1);
  assert.equal(resolved.resources[0].url, 'https://upos.example.test/fetched/collection.flv');
  assert.equal(resolved.resources[0].metadata.playlistKind, 'collection');
  assert.equal(resolved.resources[0].metadata.playlistTitle, 'Fetched Collection');
  assert.equal(resolved.metadata.resolution.inputKind, 'playlist');
});

test('bilibili native API fetch only uses global fetch when network gate is enabled', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async (url) => {
    fetchCalls += 1;
    const parsed = new URL(url);
    if (parsed.pathname === '/x/web-interface/view') {
      return {
        ok: true,
        async json() {
          return {
            code: 0,
            data: {
              bvid: 'BV1fetchGateOn',
              pages: [{ cid: 7501, page: 1 }],
            },
          };
        },
      };
    }
    if (parsed.pathname === '/x/player/playurl') {
      return {
        ok: true,
        async json() {
          return {
            code: 0,
            data: {
              durl: [{ url: 'https://upos.example.test/fetched/gate-on.flv' }],
            },
          };
        },
      };
    }
    throw new Error(`unexpected Bilibili API URL: ${url}`);
  };
  try {
    const { resolved } = await resolveBilibili({
      site: 'bilibili',
      input: 'https://www.bilibili.com/video/BV1fetchGateOn/',
      dryRun: true,
    }, null, {
      allowNetworkResolve: true,
    });

    assert.equal(fetchCalls, 2);
    assert.equal(resolved.resources.length, 1);
    assert.equal(resolved.resources[0].url, 'https://upos.example.test/fetched/gate-on.flv');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('bilibili ordinary input without fixture payload still falls back to legacy resolution', async () => {
  const { plan, resolved } = await resolveBilibili({
    site: 'bilibili',
    input: 'BV1stillLegacy',
    dryRun: true,
  });

  assert.equal(resolved.resources.length, 0);
  assert.equal(resolved.completeness.reason, 'legacy-downloader-required');
  assert.equal(plan.legacy.entrypoint.endsWith(path.join('src', 'entrypoints', 'sites', 'bilibili-action.mjs')), true);
});
