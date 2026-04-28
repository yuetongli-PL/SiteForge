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

async function resolveSocial(site, request, sessionLease = null) {
  const definition = await resolveDownloadSiteDefinition({ site }, { workspaceRoot: REPO_ROOT });
  const plan = await createDownloadPlan({
    site,
    ...request,
  }, {
    workspaceRoot: REPO_ROOT,
    definition,
  });
  const resolved = await resolveDownloadResources(plan, sessionLease, {
    request: { site, ...request },
    workspaceRoot: REPO_ROOT,
    definition,
  });
  return { plan, resolved };
}

test('instagram native resolver is gated and maps feed-user payload media when enabled', async () => {
  const { resolved: fallbackResolved } = await resolveSocial('instagram', {
    input: 'https://www.instagram.com/openai/',
    instagramFeedUserPayload: {
      items: [{
        pk: 'ig-1',
        code: 'ABC123',
        caption: null,
        image_versions2: {
          candidates: [{ url: 'https://instagram.example.test/ig-1.jpg' }],
        },
      }],
    },
    dryRun: true,
  });

  assert.equal(fallbackResolved.resources.length, 0);
  assert.equal(fallbackResolved.completeness.reason, 'legacy-downloader-required');

  const { resolved } = await resolveSocial('instagram', {
    input: 'https://www.instagram.com/openai/',
    nativeResolver: true,
    instagramFeedUserPayload: {
      items: [{
        pk: 'ig-1',
        code: 'ABC123',
        caption: null,
        image_versions2: {
          candidates: [{ url: 'https://instagram.example.test/ig-1.jpg' }],
        },
        carousel_media: [{
          pk: 'ig-1-video',
          video_versions: [{ url: 'https://instagram.example.test/ig-1-video.mp4' }],
        }],
      }],
    },
    dryRun: true,
  }, {
    siteKey: 'instagram',
    status: 'ready',
    headers: { Referer: 'https://www.instagram.com/' },
  });

  assert.equal(resolved.resources.length, 2);
  assert.deepEqual(resolved.resources.map((resource) => resource.mediaType), ['image', 'video']);
  assert.equal(resolved.resources[0].url, 'https://instagram.example.test/ig-1.jpg');
  assert.equal(resolved.resources[1].url, 'https://instagram.example.test/ig-1-video.mp4');
  assert.equal(resolved.resources[0].headers.Referer, 'https://www.instagram.com/');
  assert.equal(resolved.resources[0].metadata.archiveStrategy, 'instagram-feed-user');
  assert.equal(resolved.metadata.resolver.method, 'native-instagram-social-resource-seeds');
  assert.equal(resolved.metadata.resolution.archiveStrategy, 'instagram-feed-user');
  assert.equal(resolved.completeness.reason, 'instagram-social-resource-seeds-provided');
});

test('social relation and followed-date actions stay on legacy even when native gate is enabled', async () => {
  const { resolved: relationResolved } = await resolveSocial('instagram', {
    input: 'https://www.instagram.com/openai/followers/',
    nativeResolver: true,
    relation: 'followers',
    mediaItems: [{ url: 'https://instagram.example.test/relation.jpg' }],
    dryRun: true,
  });

  assert.equal(relationResolved.resources.length, 0);
  assert.equal(relationResolved.completeness.reason, 'legacy-downloader-required');

  const { resolved: followedResolved } = await resolveSocial('x', {
    input: 'followed posts',
    nativeResolver: true,
    followedPostsByDate: true,
    date: '2026-04-28',
    mediaItems: [{ url: 'https://video.twimg.example.test/followed.mp4' }],
    dryRun: true,
  });

  assert.equal(followedResolved.resources.length, 0);
  assert.equal(followedResolved.completeness.reason, 'legacy-downloader-required');
});

test('x native resolver maps media candidates and preserves poster-only fallback labels', async () => {
  const { resolved } = await resolveSocial('x', {
    input: 'https://x.com/search?q=codex',
    nativeResolver: true,
    query: 'codex',
    mediaItems: [{
      tweetId: 'tweet-1',
      text: 'X video candidate',
      media: [{
        id: 'media-1',
        type: 'video',
        variants: [
          { contentType: 'video/mp4', bitrate: 256000, url: 'https://video.twimg.example.test/low.mp4' },
          { contentType: 'video/mp4', bitrate: 1024000, url: 'https://video.twimg.example.test/high.mp4' },
        ],
      }],
    }, {
      tweetId: 'tweet-2',
      text: 'Poster fallback',
      media: [{
        id: 'media-2',
        type: 'photo',
        imageUrl: 'https://pbs.twimg.example.test/poster.jpg',
        reason: 'poster-only-video-fallback',
      }],
    }],
    dryRun: true,
  });

  assert.equal(resolved.resources.length, 2);
  assert.equal(resolved.resources[0].url, 'https://video.twimg.example.test/high.mp4');
  assert.equal(resolved.resources[0].mediaType, 'video');
  assert.equal(resolved.resources[1].url, 'https://pbs.twimg.example.test/poster.jpg');
  assert.equal(resolved.resources[1].mediaType, 'image');
  assert.equal(resolved.resources[1].metadata.posterOnlyVideoFallback, true);
  assert.equal(resolved.metadata.resolver.method, 'native-x-social-resource-seeds');
  assert.equal(resolved.completeness.reason, 'x-social-resource-seeds-provided');
});
