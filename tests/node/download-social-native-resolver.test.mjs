import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  assert.equal(relationResolved.metadata.resolution.unsupportedReason, 'relation-flow-legacy-only');

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
  assert.equal(followedResolved.metadata.resolution.unsupportedReason, 'followed-date-legacy-only');
});

test('social native resolver reports cursor discovery fallback when gated without archive media payloads', async () => {
  const { resolved: xResolved } = await resolveSocial('x', {
    input: 'https://x.com/openai',
    nativeResolver: true,
    fullArchive: true,
    dryRun: true,
  });

  assert.equal(xResolved.resources.length, 0);
  assert.equal(xResolved.completeness.reason, 'legacy-downloader-required');
  assert.equal(xResolved.metadata.resolution.unsupportedReason, 'requires-social-cursor-discovery');

  const { resolved: instagramResolved } = await resolveSocial('instagram', {
    input: 'https://www.instagram.com/openai/',
    nativeResolver: true,
    fullArchive: true,
    dryRun: true,
  });

  assert.equal(instagramResolved.resources.length, 0);
  assert.equal(instagramResolved.completeness.reason, 'legacy-downloader-required');
  assert.equal(instagramResolved.metadata.resolution.unsupportedReason, 'requires-authenticated-feed-user-discovery');
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

test('x native resolver maps nested timeline archive payload media variants', async () => {
  const { resolved } = await resolveSocial('x', {
    input: 'https://x.com/openai',
    nativeResolver: true,
    xTimelinePayload: {
      data: {
        user: {
          result: {
            timeline_v2: {
              timeline: {
                instructions: [{
                  entries: [{
                    content: {
                      itemContent: {
                        tweet_results: {
                          result: {
                            rest_id: 'tweet-archive-1',
                            legacy: {
                              id_str: 'tweet-archive-1',
                              full_text: 'Nested archive tweet',
                              extended_entities: {
                                media: [{
                                  id_str: 'media-archive-1',
                                  type: 'video',
                                  video_info: {
                                    variants: [
                                      { content_type: 'application/x-mpegURL', url: 'https://video.twimg.example.test/archive/master.m3u8' },
                                      { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.example.test/archive/low.mp4' },
                                      { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.example.test/archive/high.mp4' },
                                    ],
                                  },
                                }],
                              },
                            },
                          },
                        },
                      },
                    },
                  }],
                }],
              },
            },
          },
        },
      },
    },
    dryRun: true,
  });

  assert.equal(resolved.resources.length, 1);
  assert.equal(resolved.resources[0].url, 'https://video.twimg.example.test/archive/high.mp4');
  assert.equal(resolved.resources[0].mediaType, 'video');
  assert.equal(resolved.resources[0].metadata.postId, 'tweet-archive-1');
  assert.equal(resolved.metadata.resolution.archiveStrategy, 'social-media-candidates');
});

test('x native resolver consumes captured social API replay payloads without cursor execution', async () => {
  const { resolved } = await resolveSocial('x', {
    input: 'https://x.com/openai',
    nativeResolver: true,
    fullArchive: true,
    socialApiPayloads: [{
      nextCursor: 'cursor-page-2',
      items: [{
        id: 'tweet-api-1',
        full_text: 'API replay item one',
        media: [{
          id: 'api-media-1',
          type: 'video',
          variants: [
            { content_type: 'video/mp4', bitrate: 256000, url: 'https://video.twimg.example.test/api/low.mp4' },
            { content_type: 'video/mp4', bitrate: 2048000, url: 'https://video.twimg.example.test/api/high.mp4' },
          ],
        }],
      }],
    }, {
      items: [{
        id: 'tweet-api-2',
        full_text: 'API replay item two',
        media: [{
          id: 'api-media-2',
          type: 'photo',
          media_url_https: 'https://pbs.twimg.example.test/api/photo.jpg',
        }],
      }],
    }],
    dryRun: true,
  });

  assert.equal(resolved.resources.length, 2);
  assert.deepEqual(resolved.resources.map((resource) => resource.url), [
    'https://video.twimg.example.test/api/high.mp4',
    'https://pbs.twimg.example.test/api/photo.jpg',
  ]);
  assert.equal(resolved.metadata.resolution.cursorReplayAvailable, true);
  assert.equal(resolved.metadata.resolution.nextCursorAvailable, true);
  assert.equal(resolved.metadata.resolution.nextCursor, undefined);
  assert.equal(resolved.completeness.reason, 'x-social-resource-seeds-provided');
});

test('social native resolver consumes local archive artifacts without live replay', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-native-artifacts-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const itemsPath = path.join(runDir, 'items.jsonl');
  const statePath = path.join(runDir, 'state.json');
  const manifestPath = path.join(runDir, 'manifest.json');
  await writeFile(itemsPath, [
    JSON.stringify({
      kind: 'item',
      id: 'artifact-post-1',
      url: 'https://x.com/openai/status/artifact-post-1',
      text: 'Artifact item',
      media: [{
        id: 'artifact-media-1',
        type: 'photo',
        media_url_https: 'https://pbs.twimg.example.test/artifacts/photo.jpg',
        headers: {
          Referer: 'https://x.com/',
          Cookie: 'auth=secret',
          Authorization: 'Bearer secret',
        },
      }],
    }),
    JSON.stringify({ kind: 'account', handle: 'openai' }),
  ].join('\n'), 'utf8');
  await writeFile(statePath, JSON.stringify({
    schemaVersion: 1,
    archive: {
      nextCursor: 'artifact-cursor',
      requestTemplate: {
        url: 'https://x.com/i/api/graphql/timeline',
      },
    },
  }), 'utf8');
  await writeFile(manifestPath, JSON.stringify({
    artifacts: {
      items: itemsPath,
      state: statePath,
    },
  }), 'utf8');

  const { resolved } = await resolveSocial('x', {
    input: 'https://x.com/openai',
    nativeResolver: true,
    fullArchive: true,
    socialRunDir: runDir,
    dryRun: true,
  });

  assert.equal(resolved.resources.length, 1);
  assert.equal(resolved.resources[0].url, 'https://pbs.twimg.example.test/artifacts/photo.jpg');
  assert.equal(resolved.resources[0].sourceUrl, 'https://x.com/openai/status/artifact-post-1');
  assert.equal(resolved.resources[0].headers.Referer, 'https://x.com/');
  assert.equal(resolved.resources[0].headers.Cookie, undefined);
  assert.equal(resolved.resources[0].headers.Authorization, undefined);
  assert.equal(resolved.metadata.resolution.cursorReplayAvailable, true);
  assert.equal(resolved.metadata.resolution.nextCursorAvailable, true);
  assert.equal(resolved.metadata.resolution.requestTemplateAvailable, true);
  assert.equal(resolved.metadata.resolution.nextCursor, undefined);
  assert.equal(resolved.metadata.resolution.requestTemplate, undefined);
  assert.deepEqual(resolved.metadata.resolution.artifactSource, {
    runDir: true,
    manifest: true,
    items: true,
    state: true,
  });
  assert.equal(resolved.completeness.reason, 'x-social-resource-seeds-provided');
});

test('instagram native resolver maps GraphQL sidecar archive media', async () => {
  const { resolved } = await resolveSocial('instagram', {
    input: 'https://www.instagram.com/openai/',
    nativeResolver: true,
    instagramGraphqlPayload: {
      data: {
        user: {
          edge_owner_to_timeline_media: {
            edges: [{
              node: {
                id: 'ig-archive-1',
                shortcode: 'IGARCHIVE1',
                edge_media_to_caption: {
                  edges: [{ node: { text: 'Nested Instagram archive' } }],
                },
                edge_sidecar_to_children: {
                  edges: [{
                    node: {
                      id: 'ig-archive-image',
                      display_url: 'https://instagram.example.test/archive/image.jpg',
                    },
                  }, {
                    node: {
                      id: 'ig-archive-video',
                      is_video: true,
                      video_url: 'https://instagram.example.test/archive/video.mp4',
                    },
                  }],
                },
              },
            }],
          },
        },
      },
    },
    dryRun: true,
  });

  assert.equal(resolved.resources.length, 2);
  assert.deepEqual(resolved.resources.map((resource) => resource.url), [
    'https://instagram.example.test/archive/image.jpg',
    'https://instagram.example.test/archive/video.mp4',
  ]);
  assert.deepEqual(resolved.resources.map((resource) => resource.mediaType), ['image', 'video']);
  assert.equal(resolved.resources[0].metadata.archiveStrategy, 'instagram-feed-user');
  assert.equal(resolved.resources[1].metadata.shortcode, 'IGARCHIVE1');
});
