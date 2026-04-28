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

async function resolveBilibili(request, sessionLease = null) {
  const definition = await resolveDownloadSiteDefinition({ site: 'bilibili' }, { workspaceRoot: REPO_ROOT });
  const plan = await createDownloadPlan(request, {
    workspaceRoot: REPO_ROOT,
    definition,
  });
  const resolved = await resolveDownloadResources(plan, sessionLease, {
    request,
    workspaceRoot: REPO_ROOT,
    definition,
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
