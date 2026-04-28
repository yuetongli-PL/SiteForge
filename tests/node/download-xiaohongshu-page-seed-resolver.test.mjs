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

async function resolveXiaohongshu(request, sessionLease = null) {
  const definition = await resolveDownloadSiteDefinition({ site: 'xiaohongshu' }, { workspaceRoot: REPO_ROOT });
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
