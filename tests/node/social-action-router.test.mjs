import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import {
  buildCursorPageUrl,
  buildCursorReplayRequest,
  buildSocialActionPlan,
  normalizeSocialAccount,
  parseSocialApiPayload,
  parseSocialActionArgs,
  runSocialAction,
  sanitizeSocialApiRequestTemplate,
} from '../../src/sites/social/actions/router.mjs';

test('social action planner builds X user content, relation, and date search routes', () => {
  assert.equal(normalizeSocialAccount('https://x.com/opensource/status/1646527756281315330', 'x'), 'opensource');

  const replies = buildSocialActionPlan({
    site: 'x',
    action: 'replies',
    account: '@opensource',
  });
  assert.equal(replies.action, 'profile-content');
  assert.equal(replies.contentType, 'replies');
  assert.equal(replies.url, 'https://x.com/opensource/with_replies');

  const media = buildSocialActionPlan({
    site: 'x',
    action: 'profile-content',
    account: 'opensource',
    contentType: 'media',
  });
  assert.equal(media.url, 'https://x.com/opensource/media');

  const following = buildSocialActionPlan({
    site: 'x',
    action: 'profile-following',
    account: 'opensource',
  });
  assert.equal(following.url, 'https://x.com/opensource/following');

  const followedUpdates = buildSocialActionPlan({
    site: 'x',
    action: 'list-followed-updates',
    query: 'open source',
    date: '2026-04-26',
  });
  const parsed = new URL(followedUpdates.url);
  assert.equal(parsed.origin + parsed.pathname, 'https://x.com/search');
  assert.match(parsed.searchParams.get('q') || '', /filter:follows/u);
  assert.match(parsed.searchParams.get('q') || '', /since:2026-04-26/u);
  assert.match(parsed.searchParams.get('q') || '', /until:2026-04-27/u);
  assert.equal(parsed.searchParams.get('f'), 'live');
});

test('social action planner builds Instagram profile, relation, and feed-scan routes', () => {
  assert.equal(normalizeSocialAccount('https://www.instagram.com/instagram/reels/', 'instagram'), 'instagram');

  const reels = buildSocialActionPlan({
    site: 'instagram',
    action: 'profile-content',
    account: 'instagram',
    contentType: 'reels',
  });
  assert.equal(reels.url, 'https://www.instagram.com/instagram/reels/');

  const following = buildSocialActionPlan({
    site: 'instagram',
    action: 'list-author-following',
    account: 'instagram',
  });
  assert.equal(following.action, 'profile-following');
  assert.equal(following.url, 'https://www.instagram.com/instagram/following/');

  const updates = buildSocialActionPlan({
    site: 'instagram',
    action: 'followed-posts-by-date',
    date: '2026-04-26',
  });
  assert.equal(updates.url, 'https://www.instagram.com/');
  assert.equal(updates.plannerNotes.some((note) => /expands the authenticated following list/u.test(note)), true);
});

test('social API parser extracts X timeline tweets and cursor values', () => {
  const payload = {
    data: {
      timeline: {
        instructions: [{
          entries: [
            {
              content: {
                itemContent: {
                  tweet_results: {
                    result: {
                      rest_id: '123',
                      core: { user_results: { result: { legacy: { screen_name: 'openai' } } } },
                      legacy: {
                        created_at: 'Fri Apr 24 18:24:52 +0000 2026',
                        full_text: 'hello from api',
                        extended_entities: {
                          media: [{ media_url_https: 'https://pbs.twimg.com/media/example.jpg' }],
                        },
                      },
                    },
                  },
                },
              },
            },
            { content: { cursorType: 'Bottom', value: 'CURSOR_NEXT' } },
          ],
        }],
      },
    },
  };

  const parsed = parseSocialApiPayload('x', payload);

  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].url, 'https://x.com/openai/status/123');
  assert.equal(parsed.items[0].timestamp, '2026-04-24T18:24:52.000Z');
  assert.equal(parsed.items[0].media[0].url, 'https://pbs.twimg.com/media/example.jpg?format=jpg&name=orig');
  assert.equal(parsed.nextCursor, 'CURSOR_NEXT');
});

test('social API parser prefers X top-level timeline tweets over nested quoted tweets', () => {
  const payload = {
    data: {
      user: {
        result: {
          timeline: {
            timeline: {
              instructions: [{
                entries: [
                  {
                    entryId: 'tweet-111',
                    content: {
                      itemContent: {
                        tweet_results: {
                          result: {
                            rest_id: '111',
                            core: { user_results: { result: { core: { screen_name: 'openai' } } } },
                            legacy: {
                              created_at: 'Fri Apr 24 18:24:52 +0000 2026',
                              full_text: 'top level post',
                              quoted_status_result: {
                                result: {
                                  rest_id: '222',
                                  core: { user_results: { result: { core: { screen_name: 'other' } } } },
                                  legacy: {
                                    created_at: 'Fri Apr 24 18:00:00 +0000 2026',
                                    full_text: 'nested quoted post',
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                  { entryId: 'cursor-bottom-0', content: { cursorType: 'Bottom', value: 'CURSOR_NEXT' } },
                ],
              }],
            },
          },
        },
      },
    },
  };

  const parsed = parseSocialApiPayload('x', payload);

  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].url, 'https://x.com/openai/status/111');
  assert.equal(parsed.items[0].author.handle, 'openai');
  assert.equal(parsed.items[0].text, 'top level post');
  assert.equal(parsed.nextCursor, 'CURSOR_NEXT');
});

test('social API parser keeps X high quality video variant metadata', () => {
  const payload = {
    data: {
      timeline: {
        instructions: [{
          entries: [{
            content: {
              itemContent: {
                tweet_results: {
                  result: {
                    rest_id: '456',
                    core: { user_results: { result: { legacy: { screen_name: 'openai' } } } },
                    legacy: {
                      created_at: 'Fri Apr 24 18:24:52 +0000 2026',
                      full_text: 'video from api',
                      extended_entities: {
                        media: [{
                          media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/456/pu/img/poster.jpg',
                          video_info: {
                            duration_millis: 1234,
                            variants: [
                              { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/ext_tw_video/456/pu/pl/playlist.m3u8' },
                              { content_type: 'video/mp4', bitrate: 256000, url: 'https://video.twimg.com/ext_tw_video/456/pu/vid/320x320/low.mp4' },
                              { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/ext_tw_video/456/pu/vid/1280x720/high.mp4' },
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
  };

  const parsed = parseSocialApiPayload('x', payload);
  const media = parsed.items[0].media[0];

  assert.equal(media.type, 'video');
  assert.equal(media.url, 'https://video.twimg.com/ext_tw_video/456/pu/vid/1280x720/high.mp4');
  assert.equal(media.width, 1280);
  assert.equal(media.height, 720);
  assert.equal(media.bitrate, 2176000);
  assert.equal(media.durationMillis, 1234);
  assert.equal(media.variants.length, 2);
});

test('social API parser marks X retweets without treating quoted tweets as retweets', () => {
  const payload = {
    data: {
      timeline: {
        instructions: [{
          entries: [
            {
              content: {
                itemContent: {
                  tweet_results: {
                    result: {
                      rest_id: 'rt',
                      core: { user_results: { result: { legacy: { screen_name: 'openai' } } } },
                      legacy: {
                        created_at: 'Fri Apr 24 18:24:52 +0000 2026',
                        full_text: 'retweeted item',
                        retweeted_status_id_str: 'source',
                      },
                    },
                  },
                },
              },
            },
            {
              content: {
                itemContent: {
                  tweet_results: {
                    result: {
                      rest_id: 'quote',
                      core: { user_results: { result: { legacy: { screen_name: 'openai' } } } },
                      legacy: {
                        created_at: 'Fri Apr 24 19:24:52 +0000 2026',
                        full_text: 'quoted item',
                        quoted_status_result: {
                          result: {
                            rest_id: 'quoted',
                            core: { user_results: { result: { legacy: { screen_name: 'other' } } } },
                            legacy: {
                              created_at: 'Fri Apr 24 18:00:00 +0000 2026',
                              full_text: 'nested quote',
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          ],
        }],
      },
    },
  };

  const parsed = parseSocialApiPayload('x', payload);

  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].isRetweet, true);
  assert.equal(parsed.items[1].isRetweet, false);
});

test('buildCursorPageUrl updates nested GraphQL variables cursor', () => {
  const original = new URL('https://x.com/i/api/graphql/abc/UserTweets');
  original.searchParams.set('variables', JSON.stringify({
    userId: '1',
    cursor: 'OLD',
    nested: { after: 'OLD_AFTER' },
  }));

  const next = new URL(buildCursorPageUrl(original.toString(), 'NEW_CURSOR'));
  const variables = JSON.parse(next.searchParams.get('variables'));

  assert.equal(variables.cursor, 'NEW_CURSOR');
  assert.equal(variables.nested.after, 'NEW_CURSOR');
});

test('buildCursorPageUrl uses max_id for Instagram API v1 feeds', () => {
  const next = new URL(buildCursorPageUrl('https://www.instagram.com/api/v1/feed/user/1/?count=12', 'IG_NEXT'));

  assert.equal(next.searchParams.get('max_id'), 'IG_NEXT');
  assert.equal(next.searchParams.get('cursor'), null);
});

test('social API request template redacts auth headers and exposes X variables', () => {
  const url = new URL('https://x.com/i/api/graphql/abc/UserTweets');
  url.searchParams.set('variables', JSON.stringify({ userId: '1', cursor: 'OLD' }));
  const template = sanitizeSocialApiRequestTemplate({
    url: url.toString(),
    method: 'GET',
    headers: {
      authorization: 'Bearer SECRET',
      'x-csrf-token': 'CSRF_SECRET',
      cookie: 'auth_token=SECRET_COOKIE',
      accept: 'application/json',
      'x-twitter-active-user': 'yes',
    },
  });

  assert.equal(template.operationName, 'UserTweets');
  assert.equal(template.variables.cursor, 'OLD');
  assert.equal(template.headers.authorization, '<redacted>');
  assert.equal(template.headers['x-csrf-token'], '<redacted>');
  assert.equal(template.headers.cookie, '<redacted>');
  assert.equal(template.headers['x-twitter-active-user'], 'yes');
  assert.deepEqual(template.headerNames, [
    'accept',
    'authorization',
    'cookie',
    'x-csrf-token',
    'x-twitter-active-user',
  ]);
  assert.doesNotMatch(JSON.stringify(template), /SECRET|CSRF_SECRET|SECRET_COOKIE/u);
});

test('buildCursorReplayRequest updates URL, JSON body, form body, and filters forbidden headers', () => {
  const xUrl = new URL('https://x.com/i/api/graphql/abc/UserTweets');
  xUrl.searchParams.set('variables', JSON.stringify({ userId: '1', cursor: 'OLD' }));
  const nextX = buildCursorReplayRequest({
    url: xUrl.toString(),
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': '12',
      cookie: 'auth=secret',
      'user-agent': 'browser',
      'x-csrf-token': 'CSRF',
      'x-twitter-active-user': 'yes',
    },
    body: JSON.stringify({ variables: { cursor: 'OLD', after: 'OLD' }, count: 20 }),
  }, 'NEW');
  const nextXUrl = new URL(nextX.url);
  const nextXVariables = JSON.parse(nextXUrl.searchParams.get('variables'));
  const nextXBody = JSON.parse(nextX.body);

  assert.equal(nextX.method, 'POST');
  assert.equal(nextXVariables.cursor, 'NEW');
  assert.equal(nextXBody.variables.cursor, 'NEW');
  assert.equal(nextXBody.variables.after, 'NEW');
  assert.equal(nextX.headers['x-csrf-token'], 'CSRF');
  assert.equal(nextX.headers.cookie, undefined);
  assert.equal(nextX.headers['content-length'], undefined);
  assert.equal(nextX.headers['user-agent'], undefined);

  const nextIg = buildCursorReplayRequest({
    url: 'https://www.instagram.com/api/v1/feed/user/1/?max_id=OLD',
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'max_id=OLD&count=12',
  }, 'NEW_IG');
  assert.equal(new URL(nextIg.url).searchParams.get('max_id'), 'NEW_IG');
  assert.equal(new URLSearchParams(nextIg.body).get('max_id'), 'NEW_IG');
});

test('social API parser extracts Instagram media and page cursor', () => {
  const payload = {
    data: {
      user: {
        edge_owner_to_timeline_media: {
          page_info: { has_next_page: true, end_cursor: 'IG_CURSOR' },
          edges: [{
            node: {
              id: '1',
              shortcode: 'ABC123',
              taken_at_timestamp: 1777053600,
              display_url: 'https://scontent.cdninstagram.com/post.jpg',
              edge_media_to_caption: { edges: [{ node: { text: 'caption' } }] },
            },
          }],
        },
      },
    },
  };

  const parsed = parseSocialApiPayload('instagram', payload);

  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].url, 'https://www.instagram.com/p/ABC123/');
  assert.equal(parsed.items[0].text, 'caption');
  assert.equal(parsed.items[0].media[0].url, 'https://scontent.cdninstagram.com/post.jpg');
  assert.equal(parsed.nextCursor, 'IG_CURSOR');
});

test('social API parser extracts Instagram carousel media without user-node false positives', () => {
  const payload = {
    items: [{
      pk: 'parent',
      code: 'CAR123',
      taken_at: 1777053600,
      caption: { text: 'carousel caption' },
      image_versions2: { candidates: [{ url: 'https://cdninstagram.com/parent-cover.jpg', width: 100, height: 100 }] },
      carousel_media: [
        {
          pk: 'child-image',
          image_versions2: {
            candidates: [
              { url: 'https://cdninstagram.com/child-image-small.jpg', width: 320, height: 320 },
              { url: 'https://cdninstagram.com/child-image-large.jpg', width: 1440, height: 1440 },
            ],
          },
        },
        {
          pk: 'child-video',
          image_versions2: { candidates: [{ url: 'https://cdninstagram.com/video-poster.jpg', width: 640, height: 640 }] },
          video_versions: [
            { url: 'https://cdninstagram.com/video-small.mp4', width: 480, height: 480 },
            { url: 'https://cdninstagram.com/video-large.mp4', width: 1080, height: 1920 },
          ],
        },
      ],
    }],
    user: {
      pk: 'not-media',
      username: 'instagram',
    },
    more_available: true,
    next_max_id: 'NEXT_MAX',
  };

  const parsed = parseSocialApiPayload('instagram', payload);

  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].url, 'https://www.instagram.com/p/CAR123/');
  assert.equal(parsed.items[0].media.length, 2);
  assert.equal(parsed.items[0].media[0].url, 'https://cdninstagram.com/child-image-large.jpg');
  assert.equal(parsed.items[0].media[1].type, 'video');
  assert.equal(parsed.items[0].media[1].url, 'https://cdninstagram.com/video-large.mp4');
  assert.equal(parsed.items[0].media[1].posterUrl, 'https://cdninstagram.com/video-poster.jpg');
  assert.equal(parsed.nextCursor, 'NEXT_MAX');
});

test('social API parser extracts Instagram clips author, timestamp, and video variants', () => {
  const payload = {
    items: [{
      media: {
        pk: 'clip-1',
        code: 'REEL123',
        product_type: 'clips',
        taken_at: 1777053600,
        video_duration: 12.5,
        user: { pk: '25025320', username: 'instagram', full_name: 'Instagram' },
        caption: { text: 'clip caption' },
        image_versions2: {
          candidates: [{ url: 'https://cdninstagram.com/reel-poster.jpg', width: 720, height: 1280 }],
        },
        video_versions: [
          { url: 'https://cdninstagram.com/reel-low.mp4', width: 360, height: 640 },
          { url: 'https://cdninstagram.com/reel-high.mp4', width: 1080, height: 1920 },
        ],
      },
    }],
    paging_info: { max_id: 'CLIPS_NEXT' },
  };

  const parsed = parseSocialApiPayload('instagram', payload);
  const item = parsed.items[0];
  const video = item.media[0];

  assert.equal(item.url, 'https://www.instagram.com/reel/REEL123/');
  assert.equal(item.timestamp, '2026-04-24T18:00:00.000Z');
  assert.equal(item.author.handle, 'instagram');
  assert.equal(item.sourceAccount, 'instagram');
  assert.equal(video.type, 'video');
  assert.equal(video.url, 'https://cdninstagram.com/reel-high.mp4');
  assert.equal(video.posterUrl, 'https://cdninstagram.com/reel-poster.jpg');
  assert.equal(video.width, 1080);
  assert.equal(video.height, 1920);
  assert.equal(video.durationMillis, 12500);
  assert.equal(video.variants.length, 2);
  assert.equal(parsed.nextCursor, 'CLIPS_NEXT');
});

test('runSocialAction dry-run treats full-archive action as API cursor archive mode', async () => {
  const result = await runSocialAction({
    site: 'instagram',
    action: 'full-archive',
    account: 'instagram',
    dryRun: true,
  });

  assert.equal(result.plan.action, 'profile-content');
  assert.equal(result.settings.fullArchive, true);
  assert.equal(result.settings.apiCursor, true);
  assert.equal(result.settings.maxScrolls, 250);
  assert.equal(result.settings.maxItems, 2_000);
});

test('runSocialAction suppresses API cursor for Instagram relation actions', async () => {
  const result = await runSocialAction({
    site: 'instagram',
    action: 'followed-users',
    account: 'me',
    apiCursor: true,
    dryRun: true,
  });

  assert.equal(result.plan.action, 'followed-users');
  assert.equal(result.settings.apiCursor, false);
  assert.equal(result.settings.apiCursorSuppressed, true);
});

test('runSocialAction archives Instagram profile content through api v1 feed user fallback', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-ig-feed-user-'));
  t.after(async () => {
    await rm(runDir, { recursive: true, force: true });
  });
  const requests = [];
  const fakeSession = {
    async navigateAndWait() {},
    async evaluateValue() {
      return 'https://www.instagram.com/instagram/';
    },
    async callPageFunction(fn, ...args) {
      const source = String(fn);
      if (source.includes('pageFetchJson')) {
        const request = args[0] || {};
        const url = String(request.url || request);
        requests.push(url);
        if (url.includes('/api/v1/users/web_profile_info/')) {
          return {
            ok: true,
            status: 200,
            headers: {},
            json: {
              data: {
                user: {
                  id: '25025320',
                  username: 'instagram',
                  full_name: 'Instagram',
                  edge_owner_to_timeline_media: { count: 2 },
                },
              },
            },
          };
        }
        if (url.includes('/api/v1/feed/user/25025320/') && !url.includes('max_id=')) {
          return {
            ok: true,
            status: 200,
            headers: {},
            json: {
              items: [{
                pk: 'feed-1',
                code: 'FEEDONE',
                taken_at: 1777053600,
                user: { pk: '25025320', username: 'instagram' },
                caption: null,
                image_versions2: { candidates: [{ url: 'https://cdninstagram.com/feed-one.jpg', width: 1080, height: 1350 }] },
              }],
              more_available: true,
              next_max_id: 'NEXT_MAX_ID',
            },
          };
        }
        if (url.includes('/api/v1/feed/user/25025320/') && url.includes('max_id=NEXT_MAX_ID')) {
          return {
            ok: true,
            status: 200,
            headers: {},
            json: {
              items: [{
                pk: 'feed-2',
                code: 'FEEDTWO',
                taken_at: 1777140000,
                user: { pk: '25025320', username: 'instagram' },
                caption: { text: 'second feed item' },
                video_versions: [{ url: 'https://cdninstagram.com/feed-two.mp4', width: 1080, height: 1920 }],
                image_versions2: { candidates: [{ url: 'https://cdninstagram.com/feed-two.jpg', width: 1080, height: 1920 }] },
              }],
              more_available: false,
            },
          };
        }
      }
      if (source.includes('pageExtractSocialState')) {
        return {
          url: 'https://www.instagram.com/instagram/',
          title: 'Instagram',
          currentAccount: 'me',
          account: { handle: 'instagram', displayName: 'Instagram' },
          items: [],
          relations: [],
          media: [],
        };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() {
      return {};
    },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'instagram',
    action: 'full-archive',
    account: 'instagram',
    maxApiPages: 3,
    maxScrolls: 0,
    scrollWaitMs: 0,
    timeoutMs: 1000,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() {
      return { userDataDir: null, cleanupUserDataDirOnShutdown: true };
    },
    async openBrowserSession() {
      return fakeSession;
    },
    async ensureAuthenticatedSession() {
      return { loggedIn: true };
    },
  });

  const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
  const indexCsv = await readFile(path.join(runDir, 'index.csv'), 'utf8');
  const indexHtml = await readFile(path.join(runDir, 'index.html'), 'utf8');
  assert.equal(result.result.archive.strategy, 'instagram-feed-user');
  assert.equal(result.result.archive.userId, '25025320');
  assert.equal(result.result.archive.pages, 2);
  assert.equal(result.result.archive.complete, true);
  assert.equal(result.result.items.length, 2);
  assert.equal(result.result.items[0].text, '');
  assert.equal(result.result.items[1].media[0].type, 'video');
  assert.ok(requests.some((url) => url.includes('/api/v1/feed/user/25025320/')));
  assert.equal(manifest.archive.strategy, 'instagram-feed-user');
  assert.equal(manifest.completeness.apiItemCount, 2);
  assert.match(indexCsv, /FEEDONE/u);
  assert.match(indexHtml, /second feed item/u);
});

test('runSocialAction opens a blank page before API cursor capture navigation', async () => {
  let startupUrl = null;
  const navigations = [];
  const fakeSession = {
    async navigateAndWait(url) {
      navigations.push(url);
    },
    async evaluateValue() {
      return 'https://x.com/openai';
    },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        return {
          url: 'https://x.com/openai',
          title: 'OpenAI / X',
          currentAccount: 'me',
          account: { handle: 'openai', displayName: 'OpenAI' },
          items: [],
          relations: [],
          media: [],
        };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() {
      return {};
    },
    async close() {},
  };

  await runSocialAction({
    site: 'x',
    action: 'full-archive',
    account: 'openai',
    timeoutMs: 1000,
    maxScrolls: 0,
  }, {
    async resolveSiteBrowserSessionOptions() {
      return { userDataDir: null, cleanupUserDataDirOnShutdown: true };
    },
    async openBrowserSession(settings) {
      startupUrl = settings.startupUrl;
      return fakeSession;
    },
    async ensureAuthenticatedSession() {
      return { loggedIn: true };
    },
  });

  assert.equal(startupUrl, 'about:blank');
  assert.equal(navigations[0], 'https://x.com/openai');
});

test('runSocialAction reports resume-only archive completion as unknown', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-unknown-complete-'));
  t.after(async () => {
    await rm(runDir, { recursive: true, force: true });
  });
  await writeFile(path.join(runDir, 'items.jsonl'), JSON.stringify({
    kind: 'item',
    id: 'legacy',
    url: 'https://x.com/openai/status/legacy',
    text: 'legacy item',
    timestamp: '2026-04-24T00:00:00.000Z',
    sourceAccount: 'openai',
  }), 'utf8');
  await writeFile(path.join(runDir, 'state.json'), JSON.stringify({
    schemaVersion: 1,
    archive: {
      strategy: 'api-cursor',
      complete: false,
      pages: 1,
      nextCursor: 'CURSOR_NEXT',
      seedUrl: 'https://x.com/i/api/graphql/abc/UserTweets',
      requestTemplate: { url: 'https://x.com/i/api/graphql/abc/UserTweets', method: 'GET' },
    },
  }), 'utf8');

  const fakeSession = {
    client: {
      on() {
        return () => {};
      },
    },
    sessionId: 'session-unknown',
    async send() {
      return {};
    },
    async navigateAndWait() {},
    async evaluateValue() {
      return 'https://x.com/openai';
    },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        return {
          url: 'https://x.com/openai',
          title: 'OpenAI / X',
          currentAccount: 'me',
          account: { handle: 'openai', displayName: 'OpenAI' },
          items: [],
          relations: [],
          media: [],
        };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() {
      return {};
    },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'full-archive',
    account: 'openai',
    timeoutMs: 1000,
    maxScrolls: 0,
    scrollWaitMs: 0,
    runDir,
    resume: true,
  }, {
    async resolveSiteBrowserSessionOptions() {
      return { userDataDir: null, cleanupUserDataDirOnShutdown: true };
    },
    async openBrowserSession() {
      return fakeSession;
    },
    async ensureAuthenticatedSession() {
      return { loggedIn: true };
    },
  });

  const report = await readFile(path.join(runDir, 'report.md'), 'utf8');
  const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
  assert.equal(result.result.archive.complete, null);
  assert.match(report, /- Archive complete: unknown/u);
  assert.equal(manifest.completeness.archiveStatus, 'unknown');
});

test('runSocialAction captures API debug summary and replays cursor fixture pages', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-api-replay-'));
  t.after(async () => {
    await rm(runDir, { recursive: true, force: true });
  });
  const seedPayload = {
    data: {
      timeline: {
        instructions: [{
          entries: [
            {
              content: {
                itemContent: {
                  tweet_results: {
                    result: {
                      rest_id: 'seed',
                      core: { user_results: { result: { legacy: { screen_name: 'openai' } } } },
                      legacy: {
                        created_at: 'Fri Apr 24 18:24:52 +0000 2026',
                        full_text: 'seed from api',
                      },
                    },
                  },
                },
              },
            },
            { content: { cursorType: 'Bottom', value: 'CURSOR_NEXT' } },
          ],
        }],
      },
    },
  };
  const replayPayload = {
    data: {
      timeline: {
        instructions: [{
          entries: [{
            content: {
              itemContent: {
                tweet_results: {
                  result: {
                    rest_id: 'replay',
                    core: { user_results: { result: { legacy: { screen_name: 'openai' } } } },
                    legacy: {
                      created_at: 'Sat Apr 25 18:24:52 +0000 2026',
                      full_text: 'replay from api',
                    },
                  },
                },
              },
            },
          }],
        }],
      },
    },
  };
  const listeners = new Map();
  const seedUrl = new URL('https://x.com/i/api/graphql/abc/UserTweets');
  seedUrl.searchParams.set('variables', JSON.stringify({ userId: '1', cursor: 'OLD' }));
  let emitted = false;
  const fakeSession = {
    client: {
      on(eventName, callback) {
        listeners.set(eventName, callback);
        return () => {};
      },
    },
    sessionId: 'session-api',
    async send(command) {
      if (command === 'Network.getResponseBody') {
        return { body: JSON.stringify(seedPayload), base64Encoded: false };
      }
      return {};
    },
    async navigateAndWait(url) {
      if (emitted || !String(url).includes('/openai')) {
        return;
      }
      emitted = true;
      listeners.get('Network.requestWillBeSent')?.({
        params: {
          requestId: 'api-1',
          type: 'XHR',
          request: {
            url: seedUrl.toString(),
            method: 'GET',
            headers: { accept: 'application/json' },
          },
        },
      });
      listeners.get('Network.responseReceived')?.({
        params: {
          requestId: 'api-1',
          type: 'XHR',
          response: {
            url: seedUrl.toString(),
            status: 200,
            mimeType: 'application/json',
          },
        },
      });
      listeners.get('Network.loadingFinished')?.({ params: { requestId: 'api-1' } });
    },
    async evaluateValue() {
      return 'https://x.com/openai';
    },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageFetchJson')) {
        return replayPayload;
      }
      if (source.includes('pageExtractSocialState')) {
        return {
          url: 'https://x.com/openai',
          title: 'OpenAI / X',
          currentAccount: 'me',
          account: { handle: 'openai', displayName: 'OpenAI' },
          items: [],
          relations: [],
          media: [],
        };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() {
      return {};
    },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'full-archive',
    account: 'openai',
    timeoutMs: 1000,
    maxScrolls: 0,
    scrollWaitMs: 0,
    maxApiPages: 3,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() {
      return { userDataDir: null, cleanupUserDataDirOnShutdown: true };
    },
    async openBrowserSession() {
      return fakeSession;
    },
    async ensureAuthenticatedSession() {
      return { loggedIn: true };
    },
  });

  const debug = JSON.parse(await readFile(path.join(runDir, 'api-capture-debug.json'), 'utf8'));
  assert.equal(result.result.archive.strategy, 'api-cursor');
  assert.equal(result.result.archive.pages, 2);
  assert.equal(result.result.archive.complete, true);
  assert.equal(result.result.items.length, 2);
  assert.equal(debug.capture.parsedResponseCount, 1);
  assert.equal(debug.capture.samples[0].itemCount, 1);
  assert.equal(debug.capture.samples[0].hasNextCursor, true);
  assert.equal(debug.capture.driftSamples.length, 0);
});

test('runSocialAction filters X profile API archive to requested original posts', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-x-profile-filter-'));
  t.after(async () => {
    await rm(runDir, { recursive: true, force: true });
  });
  const seedPayload = {
    data: {
      timeline: {
        instructions: [{
          entries: [
            {
              content: {
                itemContent: {
                  tweet_results: {
                    result: {
                      rest_id: 'keep',
                      core: { user_results: { result: { legacy: { screen_name: 'OpenAI' } } } },
                      legacy: { created_at: 'Fri Apr 24 18:24:52 +0000 2026', full_text: 'keep original' },
                    },
                  },
                },
              },
            },
            {
              content: {
                itemContent: {
                  tweet_results: {
                    result: {
                      rest_id: 'other',
                      core: { user_results: { result: { legacy: { screen_name: 'other' } } } },
                      legacy: { created_at: 'Fri Apr 24 18:25:52 +0000 2026', full_text: 'recommendation' },
                    },
                  },
                },
              },
            },
            {
              content: {
                itemContent: {
                  tweet_results: {
                    result: {
                      rest_id: 'retweet',
                      core: { user_results: { result: { legacy: { screen_name: 'openai' } } } },
                      legacy: {
                        created_at: 'Fri Apr 24 18:26:52 +0000 2026',
                        full_text: 'retweet',
                        retweeted_status_id_str: 'source',
                      },
                    },
                  },
                },
              },
            },
          ],
        }],
      },
    },
  };
  const listeners = new Map();
  const seedUrl = new URL('https://x.com/i/api/graphql/abc/UserTweets');
  let emitted = false;
  const fakeSession = {
    client: { on(eventName, callback) { listeners.set(eventName, callback); return () => {}; } },
    sessionId: 'session-x-profile-filter',
    async send(command) {
      if (command === 'Network.getResponseBody') {
        return { body: JSON.stringify(seedPayload), base64Encoded: false };
      }
      return {};
    },
    async navigateAndWait(url) {
      if (emitted || !String(url).includes('/OpenAI')) {
        return;
      }
      emitted = true;
      listeners.get('Network.requestWillBeSent')?.({
        params: { requestId: 'api-1', type: 'XHR', request: { url: seedUrl.toString(), method: 'GET', headers: { accept: 'application/json' } } },
      });
      listeners.get('Network.responseReceived')?.({
        params: { requestId: 'api-1', type: 'XHR', response: { url: seedUrl.toString(), status: 200, mimeType: 'application/json' } },
      });
      listeners.get('Network.loadingFinished')?.({ params: { requestId: 'api-1' } });
    },
    async evaluateValue() { return 'https://x.com/OpenAI'; },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        return { url: 'https://x.com/OpenAI', title: 'OpenAI / X', currentAccount: 'me', account: { handle: 'OpenAI' }, items: [], relations: [], media: [] };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() { return {}; },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'profile-content',
    account: '@OpenAI',
    apiCursor: true,
    timeoutMs: 1000,
    maxScrolls: 0,
    scrollWaitMs: 0,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() { return { userDataDir: null, cleanupUserDataDirOnShutdown: true }; },
    async openBrowserSession() { return fakeSession; },
    async ensureAuthenticatedSession() { return { loggedIn: true }; },
  });

  assert.equal(result.result.items.length, 1);
  assert.equal(result.result.items[0].id, 'keep');
  assert.equal(result.result.items[0].author.handle, 'OpenAI');
});

test('runSocialAction treats X cursor 404 after seed results as degraded partial result', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-x-soft-cursor-'));
  t.after(async () => {
    await rm(runDir, { recursive: true, force: true });
  });
  const seedPayload = {
    data: {
      timeline: {
        instructions: [{
          entries: [
            {
              content: {
                itemContent: {
                  tweet_results: {
                    result: {
                      rest_id: 'seed',
                      core: { user_results: { result: { legacy: { screen_name: 'openai' } } } },
                      legacy: { created_at: 'Fri Apr 24 18:24:52 +0000 2026', full_text: 'seed' },
                    },
                  },
                },
              },
            },
            { content: { cursorType: 'Bottom', value: 'CURSOR_NEXT' } },
          ],
        }],
      },
    },
  };
  const listeners = new Map();
  const seedUrl = new URL('https://x.com/i/api/graphql/abc/UserTweets');
  seedUrl.searchParams.set('variables', JSON.stringify({ userId: '1', cursor: 'OLD' }));
  let emitted = false;
  const fakeSession = {
    client: { on(eventName, callback) { listeners.set(eventName, callback); return () => {}; } },
    sessionId: 'session-x-soft-cursor',
    async send(command) {
      if (command === 'Network.getResponseBody') {
        return { body: JSON.stringify(seedPayload), base64Encoded: false };
      }
      return {};
    },
    async navigateAndWait(url) {
      if (emitted || !String(url).includes('/openai')) {
        return;
      }
      emitted = true;
      listeners.get('Network.requestWillBeSent')?.({
        params: { requestId: 'api-1', type: 'XHR', request: { url: seedUrl.toString(), method: 'GET', headers: { accept: 'application/json' } } },
      });
      listeners.get('Network.responseReceived')?.({
        params: { requestId: 'api-1', type: 'XHR', response: { url: seedUrl.toString(), status: 200, mimeType: 'application/json' } },
      });
      listeners.get('Network.loadingFinished')?.({ params: { requestId: 'api-1' } });
    },
    async evaluateValue() { return 'https://x.com/openai'; },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageFetchJson')) {
        return { ok: false, status: 404, headers: {}, json: { errors: [{ message: 'not found' }] }, text: '' };
      }
      if (source.includes('pageExtractSocialState')) {
        return { url: 'https://x.com/openai', title: 'OpenAI / X', currentAccount: 'me', account: { handle: 'openai' }, items: [], relations: [], media: [] };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() { return {}; },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'full-archive',
    account: 'openai',
    timeoutMs: 1000,
    maxScrolls: 0,
    scrollWaitMs: 0,
    maxApiPages: 3,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() { return { userDataDir: null, cleanupUserDataDirOnShutdown: true }; },
    async openBrowserSession() { return fakeSession; },
    async ensureAuthenticatedSession() { return { loggedIn: true }; },
  });

  assert.equal(result.result.items.length, 1);
  assert.equal(result.result.archive.reason, 'soft-cursor-exhausted');
  assert.equal(result.result.archive.complete, null);
  assert.equal(result.result.archive.nextCursor, null);
  assert.equal(result.result.archive.diagnosticCursor, 'CURSOR_NEXT');
  assert.equal(result.completeness.status, 'degraded');
  assert.equal(result.outcome.ok, true);
  assert.equal(result.outcome.status, 'degraded');
  assert.equal(result.outcome.resumable, false);
  assert.equal(result.runtimeRisk.hardStop, false);
});

test('runSocialAction does not select X home timeline as profile archive seed', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-api-target-seed-'));
  t.after(async () => {
    await rm(runDir, { recursive: true, force: true });
  });
  const bodies = new Map([
    ['api-home', {
      data: {
        home: {
          home_timeline_urt: {
            instructions: [{
              entries: [
                {
                  content: {
                    itemContent: {
                      tweet_results: {
                        result: {
                          rest_id: 'home',
                          core: { user_results: { result: { legacy: { screen_name: 'other' } } } },
                          legacy: { created_at: 'Sun Apr 26 12:00:00 +0000 2026', full_text: 'home timeline post' },
                        },
                      },
                    },
                  },
                },
                { content: { cursorType: 'Bottom', value: 'HOME_CURSOR' } },
              ],
            }],
          },
        },
      },
    }],
    ['api-profile', {
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
                            rest_id: 'profile',
                            core: { user_results: { result: { legacy: { screen_name: 'openai' } } } },
                            legacy: { created_at: 'Sun Apr 26 13:00:00 +0000 2026', full_text: 'profile timeline post' },
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
    }],
  ]);
  const listeners = new Map();
  const homeUrl = new URL('https://x.com/i/api/graphql/abc/HomeTimeline');
  homeUrl.searchParams.set('variables', JSON.stringify({ count: 20, cursor: 'HOME_OLD' }));
  const profileUrl = new URL('https://x.com/i/api/graphql/abc/UserTweets');
  profileUrl.searchParams.set('variables', JSON.stringify({ userId: '1' }));
  let emitted = false;
  const fakeSession = {
    client: { on(eventName, callback) { listeners.set(eventName, callback); return () => {}; } },
    sessionId: 'session-target-seed',
    async send(command, params) {
      if (command === 'Network.getResponseBody') {
        return { body: JSON.stringify(bodies.get(params.requestId)), base64Encoded: false };
      }
      return {};
    },
    async navigateAndWait(url) {
      if (emitted || !String(url).includes('/openai')) {
        return;
      }
      emitted = true;
      for (const [requestId, apiUrl] of [['api-home', homeUrl.toString()], ['api-profile', profileUrl.toString()]]) {
        listeners.get('Network.requestWillBeSent')?.({
          params: { requestId, type: 'XHR', request: { url: apiUrl, method: 'GET', headers: { accept: 'application/json' } } },
        });
        listeners.get('Network.responseReceived')?.({
          params: { requestId, type: 'XHR', response: { url: apiUrl, status: 200, mimeType: 'application/json' } },
        });
        listeners.get('Network.loadingFinished')?.({ params: { requestId } });
      }
    },
    async evaluateValue() { return 'https://x.com/openai'; },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        return { url: 'https://x.com/openai', title: 'OpenAI / X', currentAccount: 'me', account: { handle: 'openai' }, items: [], relations: [], media: [] };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() { return {}; },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'full-archive',
    account: 'openai',
    timeoutMs: 1000,
    maxScrolls: 0,
    scrollWaitMs: 0,
    maxApiPages: 3,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() { return { userDataDir: null, cleanupUserDataDirOnShutdown: true }; },
    async openBrowserSession() { return fakeSession; },
    async ensureAuthenticatedSession() { return { loggedIn: true }; },
  });

  assert.equal(result.result.archive.seedUrl, profileUrl.toString());
  assert.equal(result.result.items.length, 1);
  assert.equal(result.result.items[0].url, 'https://x.com/openai/status/profile');
  assert.equal(result.result.items[0].text, 'profile timeline post');
});

test('runSocialAction writes drift samples only for target timeline API schema issues', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-api-drift-target-'));
  t.after(async () => {
    await rm(runDir, { recursive: true, force: true });
  });
  const bodies = new Map([
    ['api-profile', { data: { user: { result: { rest_id: '1', legacy: { screen_name: 'openai' } } } } }],
    ['api-home', { data: { home: { home_timeline_urt: { instructions: [] } } } }],
    ['api-timeline', {
      data: {
        timeline: {
          instructions: [{
            entries: [
              {
                content: {
                  itemContent: {
                    tweet_results: {
                      result: {
                        rest_id: 'seed',
                        core: { user_results: { result: { legacy: { screen_name: 'openai' } } } },
                        legacy: { created_at: 'Fri Apr 24 18:24:52 +0000 2026', full_text: 'seed' },
                      },
                    },
                  },
                },
              },
              { content: { cursorType: 'Bottom', value: 'CURSOR_NEXT' } },
            ],
          }],
        },
      },
    }],
  ]);
  const listeners = new Map();
  const profileUrl = 'https://x.com/i/api/graphql/abc/UserByScreenName';
  const homeUrl = 'https://x.com/i/api/graphql/abc/HomeTimeline';
  const timelineUrl = new URL('https://x.com/i/api/graphql/abc/UserTweets');
  timelineUrl.searchParams.set('variables', JSON.stringify({ userId: '1', cursor: 'OLD' }));
  let emitted = false;
  const fakeSession = {
    client: { on(eventName, callback) { listeners.set(eventName, callback); return () => {}; } },
    sessionId: 'session-api-drift-target',
    async send(command, params) {
      if (command === 'Network.getResponseBody') {
        return { body: JSON.stringify(bodies.get(params.requestId)), base64Encoded: false };
      }
      return {};
    },
    async navigateAndWait(url) {
      if (emitted || !String(url).includes('/openai')) {
        return;
      }
      emitted = true;
      for (const [requestId, apiUrl] of [['api-profile', profileUrl], ['api-home', homeUrl], ['api-timeline', timelineUrl.toString()]]) {
        listeners.get('Network.requestWillBeSent')?.({
          params: { requestId, type: 'XHR', request: { url: apiUrl, method: 'GET', headers: { accept: 'application/json' } } },
        });
        listeners.get('Network.responseReceived')?.({
          params: { requestId, type: 'XHR', response: { url: apiUrl, status: 200, mimeType: 'application/json' } },
        });
        listeners.get('Network.loadingFinished')?.({ params: { requestId } });
      }
    },
    async evaluateValue() { return 'https://x.com/openai'; },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        return { url: 'https://x.com/openai', title: 'OpenAI / X', currentAccount: 'me', account: { handle: 'openai' }, items: [], relations: [], media: [] };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() { return {}; },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'full-archive',
    account: 'openai',
    timeoutMs: 1000,
    maxScrolls: 0,
    scrollWaitMs: 0,
    maxApiPages: 1,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() { return { userDataDir: null, cleanupUserDataDirOnShutdown: true }; },
    async openBrowserSession() { return fakeSession; },
    async ensureAuthenticatedSession() { return { loggedIn: true }; },
  });

  const debug = JSON.parse(await readFile(path.join(runDir, 'api-capture-debug.json'), 'utf8'));
  assert.equal(result.completeness.status, 'bounded');
  assert.equal(debug.capture.parsedResponseCount, 3);
  assert.equal(debug.capture.driftSamples.length, 0);
  await assert.rejects(
    readFile(path.join(runDir, 'api-drift-samples.json'), 'utf8'),
    /ENOENT/u,
  );
});

test('runSocialAction classifies API drift samples with category and reason', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-api-drift-category-'));
  t.after(async () => {
    await rm(runDir, { recursive: true, force: true });
  });
  const listeners = new Map();
  const timelineUrl = new URL('https://x.com/i/api/graphql/abc/UserTweets');
  timelineUrl.searchParams.set('variables', JSON.stringify({ userId: '1', cursor: 'OLD' }));
  let emitted = false;
  const fakeSession = {
    client: { on(eventName, callback) { listeners.set(eventName, callback); return () => {}; } },
    sessionId: 'session-api-drift-category',
    async send(command) {
      if (command === 'Network.getResponseBody') {
        return { body: JSON.stringify({ data: { timeline: { instructions: [] } } }), base64Encoded: false };
      }
      return {};
    },
    async navigateAndWait(url) {
      if (emitted || !String(url).includes('/openai')) {
        return;
      }
      emitted = true;
      listeners.get('Network.requestWillBeSent')?.({
        params: { requestId: 'api-empty', type: 'XHR', request: { url: timelineUrl.toString(), method: 'GET', headers: { accept: 'application/json' } } },
      });
      listeners.get('Network.responseReceived')?.({
        params: { requestId: 'api-empty', type: 'XHR', response: { url: timelineUrl.toString(), status: 200, mimeType: 'application/json' } },
      });
      listeners.get('Network.loadingFinished')?.({ params: { requestId: 'api-empty' } });
    },
    async evaluateValue() { return 'https://x.com/openai'; },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        return { url: 'https://x.com/openai', title: 'OpenAI / X', currentAccount: 'me', account: { handle: 'openai' }, items: [], relations: [], media: [] };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() { return {}; },
    async close() {},
  };

  await runSocialAction({
    site: 'x',
    action: 'full-archive',
    account: 'openai',
    timeoutMs: 1000,
    maxScrolls: 0,
    scrollWaitMs: 0,
    maxApiPages: 1,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() { return { userDataDir: null, cleanupUserDataDirOnShutdown: true }; },
    async openBrowserSession() { return fakeSession; },
    async ensureAuthenticatedSession() { return { loggedIn: true }; },
  });

  const debug = JSON.parse(await readFile(path.join(runDir, 'api-capture-debug.json'), 'utf8'));
  const samples = JSON.parse(await readFile(path.join(runDir, 'api-drift-samples.json'), 'utf8'));
  assert.equal(debug.capture.driftSamples[0].category, 'target-empty');
  assert.equal(debug.capture.driftSamples[0].driftReason, 'target timeline parsed no items');
  assert.equal(samples.samples[0].summary.category, 'target-empty');
});

test('runSocialAction retries API cursor replay after rate limit response', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-api-429-'));
  t.after(async () => {
    await rm(runDir, { recursive: true, force: true });
  });
  const seedPayload = {
    data: {
      timeline: {
        instructions: [{
          entries: [
            {
              content: {
                itemContent: {
                  tweet_results: {
                    result: {
                      rest_id: 'seed',
                      core: { user_results: { result: { legacy: { screen_name: 'openai' } } } },
                      legacy: { created_at: 'Fri Apr 24 18:24:52 +0000 2026', full_text: 'seed' },
                    },
                  },
                },
              },
            },
            { content: { cursorType: 'Bottom', value: 'CURSOR_NEXT' } },
          ],
        }],
      },
    },
  };
  const replayPayload = {
    data: {
      timeline: {
        instructions: [{
          entries: [{
            content: {
              itemContent: {
                tweet_results: {
                  result: {
                    rest_id: 'replay',
                    core: { user_results: { result: { legacy: { screen_name: 'openai' } } } },
                    legacy: { created_at: 'Sat Apr 25 18:24:52 +0000 2026', full_text: 'replay' },
                  },
                },
              },
            },
          }],
        }],
      },
    },
  };
  const listeners = new Map();
  const seedUrl = new URL('https://x.com/i/api/graphql/abc/UserTweets');
  seedUrl.searchParams.set('variables', JSON.stringify({ userId: '1', cursor: 'OLD' }));
  let emitted = false;
  let fetchCalls = 0;
  const fakeSession = {
    client: { on(eventName, callback) { listeners.set(eventName, callback); return () => {}; } },
    sessionId: 'session-api-429',
    async send(command) {
      if (command === 'Network.getResponseBody') {
        return { body: JSON.stringify(seedPayload), base64Encoded: false };
      }
      return {};
    },
    async navigateAndWait(url) {
      if (emitted || !String(url).includes('/openai')) {
        return;
      }
      emitted = true;
      listeners.get('Network.requestWillBeSent')?.({
        params: { requestId: 'api-1', type: 'XHR', request: { url: seedUrl.toString(), method: 'GET', headers: { accept: 'application/json' } } },
      });
      listeners.get('Network.responseReceived')?.({
        params: { requestId: 'api-1', type: 'XHR', response: { url: seedUrl.toString(), status: 200, mimeType: 'application/json', headers: { 'x-rate-limit-remaining': '1' } } },
      });
      listeners.get('Network.loadingFinished')?.({ params: { requestId: 'api-1' } });
    },
    async evaluateValue() { return 'https://x.com/openai'; },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageFetchJson')) {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          return { ok: false, status: 429, headers: { 'retry-after': '0' }, json: { errors: [{ message: 'rate limit' }] }, text: '' };
        }
        return { ok: true, status: 200, headers: {}, json: replayPayload, text: '' };
      }
      if (source.includes('pageExtractSocialState')) {
        return { url: 'https://x.com/openai', title: 'OpenAI / X', currentAccount: 'me', account: { handle: 'openai' }, items: [], relations: [], media: [] };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() { return {}; },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'full-archive',
    account: 'openai',
    timeoutMs: 1000,
    maxScrolls: 0,
    scrollWaitMs: 0,
    maxApiPages: 3,
    riskBackoffMs: 0,
    apiRetries: 1,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() { return { userDataDir: null, cleanupUserDataDirOnShutdown: true }; },
    async openBrowserSession() { return fakeSession; },
    async ensureAuthenticatedSession() { return { loggedIn: true }; },
  });

  assert.equal(fetchCalls, 2);
  assert.equal(result.result.archive.complete, true);
  assert.equal(result.result.archive.riskEvents[0].status, 429);
  assert.equal(result.result.archive.riskEvents[0].retryable, true);
  assert.equal(result.runtimeRisk.adaptiveThrottleLevel, 1);
  const debug = JSON.parse(await readFile(path.join(runDir, 'api-capture-debug.json'), 'utf8'));
  assert.equal(Object.prototype.hasOwnProperty.call(debug.capture.samples[0], 'responseHeaders'), true);
});

test('runSocialAction increases adaptive throttle across consecutive API rate limits', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-api-adaptive-429-'));
  t.after(async () => {
    await rm(runDir, { recursive: true, force: true });
  });
  const seedPayload = {
    data: {
      timeline: {
        instructions: [{
          entries: [
            {
              content: {
                itemContent: {
                  tweet_results: {
                    result: {
                      rest_id: 'seed',
                      core: { user_results: { result: { legacy: { screen_name: 'openai' } } } },
                      legacy: { created_at: 'Fri Apr 24 18:24:52 +0000 2026', full_text: 'seed' },
                    },
                  },
                },
              },
            },
            { content: { cursorType: 'Bottom', value: 'CURSOR_NEXT' } },
          ],
        }],
      },
    },
  };
  const replayPayload = {
    data: {
      timeline: {
        instructions: [{
          entries: [{
            content: {
              itemContent: {
                tweet_results: {
                  result: {
                    rest_id: 'replay',
                    core: { user_results: { result: { legacy: { screen_name: 'openai' } } } },
                    legacy: { created_at: 'Sat Apr 25 18:24:52 +0000 2026', full_text: 'replay' },
                  },
                },
              },
            },
          }],
        }],
      },
    },
  };
  const listeners = new Map();
  const seedUrl = new URL('https://x.com/i/api/graphql/abc/UserTweets');
  seedUrl.searchParams.set('variables', JSON.stringify({ userId: '1', cursor: 'OLD' }));
  let emitted = false;
  let fetchCalls = 0;
  const fakeSession = {
    client: { on(eventName, callback) { listeners.set(eventName, callback); return () => {}; } },
    sessionId: 'session-api-adaptive-429',
    async send(command) {
      if (command === 'Network.getResponseBody') {
        return { body: JSON.stringify(seedPayload), base64Encoded: false };
      }
      return {};
    },
    async navigateAndWait(url) {
      if (emitted || !String(url).includes('/openai')) {
        return;
      }
      emitted = true;
      listeners.get('Network.requestWillBeSent')?.({
        params: { requestId: 'api-1', type: 'XHR', request: { url: seedUrl.toString(), method: 'GET', headers: { accept: 'application/json' } } },
      });
      listeners.get('Network.responseReceived')?.({
        params: { requestId: 'api-1', type: 'XHR', response: { url: seedUrl.toString(), status: 200, mimeType: 'application/json' } },
      });
      listeners.get('Network.loadingFinished')?.({ params: { requestId: 'api-1' } });
    },
    async evaluateValue() { return 'https://x.com/openai'; },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageFetchJson')) {
        fetchCalls += 1;
        if (fetchCalls <= 2) {
          return { ok: false, status: 429, headers: {}, json: { errors: [{ message: 'rate limit' }] }, text: '' };
        }
        return { ok: true, status: 200, headers: {}, json: replayPayload, text: '' };
      }
      if (source.includes('pageExtractSocialState')) {
        return { url: 'https://x.com/openai', title: 'OpenAI / X', currentAccount: 'me', account: { handle: 'openai' }, items: [], relations: [], media: [] };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() { return {}; },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'full-archive',
    account: 'openai',
    timeoutMs: 1000,
    maxScrolls: 0,
    scrollWaitMs: 0,
    maxApiPages: 3,
    riskBackoffMs: 1,
    apiRetries: 2,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() { return { userDataDir: null, cleanupUserDataDirOnShutdown: true }; },
    async openBrowserSession() { return fakeSession; },
    async ensureAuthenticatedSession() { return { loggedIn: true }; },
  });

  assert.equal(result.result.archive.complete, true);
  assert.equal(result.runtimeRisk.adaptiveThrottleLevel, 2);
  assert.equal(result.runtimeRisk.adaptiveBackoffMs >= 2, true);
  assert.deepEqual(result.result.archive.riskEvents.slice(0, 2).map((entry) => entry.adaptiveThrottleLevel), [1, 2]);
});

test('runSocialAction pauses X full archive with resumable cursor after API rate limit exhaustion', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-api-429-paused-'));
  t.after(async () => {
    await rm(runDir, { recursive: true, force: true });
  });
  const seedPayload = {
    data: {
      timeline: {
        instructions: [{
          entries: [
            {
              content: {
                itemContent: {
                  tweet_results: {
                    result: {
                      rest_id: 'seed',
                      core: { user_results: { result: { legacy: { screen_name: 'openai' } } } },
                      legacy: { created_at: 'Fri Apr 24 18:24:52 +0000 2026', full_text: 'seed' },
                    },
                  },
                },
              },
            },
            { content: { cursorType: 'Bottom', value: 'CURSOR_NEXT' } },
          ],
        }],
      },
    },
  };
  const listeners = new Map();
  const seedUrl = new URL('https://x.com/i/api/graphql/abc/UserTweets');
  seedUrl.searchParams.set('variables', JSON.stringify({ userId: '1', cursor: 'OLD' }));
  let emitted = false;
  const fakeSession = {
    client: { on(eventName, callback) { listeners.set(eventName, callback); return () => {}; } },
    sessionId: 'session-api-429-paused',
    async send(command) {
      if (command === 'Network.getResponseBody') {
        return { body: JSON.stringify(seedPayload), base64Encoded: false };
      }
      return {};
    },
    async navigateAndWait(url) {
      if (emitted || !String(url).includes('/openai')) {
        return;
      }
      emitted = true;
      listeners.get('Network.requestWillBeSent')?.({
        params: { requestId: 'api-1', type: 'XHR', request: { url: seedUrl.toString(), method: 'GET', headers: { accept: 'application/json' } } },
      });
      listeners.get('Network.responseReceived')?.({
        params: { requestId: 'api-1', type: 'XHR', response: { url: seedUrl.toString(), status: 200, mimeType: 'application/json' } },
      });
      listeners.get('Network.loadingFinished')?.({ params: { requestId: 'api-1' } });
    },
    async evaluateValue() { return 'https://x.com/openai'; },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageFetchJson')) {
        return { ok: false, status: 429, headers: { 'retry-after': '0' }, json: { errors: [{ message: 'rate limit' }] }, text: '' };
      }
      if (source.includes('pageExtractSocialState')) {
        return { url: 'https://x.com/openai', title: 'OpenAI / X', currentAccount: 'me', account: { handle: 'openai' }, items: [], relations: [], media: [] };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() { return {}; },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'full-archive',
    account: 'openai',
    timeoutMs: 1000,
    maxScrolls: 0,
    scrollWaitMs: 0,
    maxApiPages: 3,
    riskBackoffMs: 0,
    apiRetries: 0,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() { return { userDataDir: null, cleanupUserDataDirOnShutdown: true }; },
    async openBrowserSession() { return fakeSession; },
    async ensureAuthenticatedSession() { return { loggedIn: true }; },
  });

  const state = JSON.parse(await readFile(path.join(runDir, 'state.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
  assert.equal(result.ok, false);
  assert.equal(result.outcome.resumable, true);
  assert.equal(result.result.archive.reason, 'api-rate-limited');
  assert.equal(result.result.archive.nextCursor, 'CURSOR_NEXT');
  assert.equal(state.status, 'paused');
  assert.equal(state.archive.nextCursor, 'CURSOR_NEXT');
  assert.equal(state.archive.riskSignals.includes('rate-limited'), true);
  assert.equal(manifest.recoveryRunbook.status, 'actionable');
  assert.equal(manifest.recoveryRunbook.commands.some((entry) => entry.id === 'resume-after-cooldown'), true);
});

test('runSocialAction classifies API auth payload as recoverable login wall', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-api-auth-'));
  t.after(async () => {
    await rm(runDir, { recursive: true, force: true });
  });
  const seedPayload = {
    data: {
      timeline: {
        instructions: [{
          entries: [
            {
              content: {
                itemContent: {
                  tweet_results: {
                    result: {
                      rest_id: 'seed',
                      core: { user_results: { result: { legacy: { screen_name: 'openai' } } } },
                      legacy: { created_at: 'Fri Apr 24 18:24:52 +0000 2026', full_text: 'seed' },
                    },
                  },
                },
              },
            },
            { content: { cursorType: 'Bottom', value: 'CURSOR_NEXT' } },
          ],
        }],
      },
    },
  };
  const listeners = new Map();
  const seedUrl = new URL('https://x.com/i/api/graphql/abc/UserTweets');
  seedUrl.searchParams.set('variables', JSON.stringify({ userId: '1', cursor: 'OLD' }));
  let emitted = false;
  const fakeSession = {
    client: { on(eventName, callback) { listeners.set(eventName, callback); return () => {}; } },
    sessionId: 'session-api-auth',
    async send(command) {
      if (command === 'Network.getResponseBody') {
        return { body: JSON.stringify(seedPayload), base64Encoded: false };
      }
      return {};
    },
    async navigateAndWait(url) {
      if (emitted || !String(url).includes('/openai')) {
        return;
      }
      emitted = true;
      listeners.get('Network.requestWillBeSent')?.({
        params: { requestId: 'api-1', type: 'XHR', request: { url: seedUrl.toString(), method: 'GET', headers: { accept: 'application/json' } } },
      });
      listeners.get('Network.responseReceived')?.({
        params: { requestId: 'api-1', type: 'XHR', response: { url: seedUrl.toString(), status: 200, mimeType: 'application/json' } },
      });
      listeners.get('Network.loadingFinished')?.({ params: { requestId: 'api-1' } });
    },
    async evaluateValue() { return 'https://x.com/openai'; },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageFetchJson')) {
        return { ok: false, status: 401, headers: {}, json: { errors: [{ message: 'login_required' }] }, text: '' };
      }
      if (source.includes('pageExtractSocialState')) {
        return { url: 'https://x.com/openai', title: 'OpenAI / X', currentAccount: 'me', account: { handle: 'openai' }, items: [], relations: [], media: [] };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() { return {}; },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'full-archive',
    account: 'openai',
    timeoutMs: 1000,
    maxScrolls: 0,
    scrollWaitMs: 0,
    maxApiPages: 3,
    riskBackoffMs: 0,
    apiRetries: 0,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() { return { userDataDir: null, cleanupUserDataDirOnShutdown: true }; },
    async openBrowserSession() { return fakeSession; },
    async ensureAuthenticatedSession() { return { status: 'already-authenticated', loginState: { loggedIn: true, identityConfirmed: true } }; },
  });

  assert.equal(result.ok, false);
  assert.equal(result.result.archive.complete, false);
  assert.equal(result.result.archive.reason, 'api-auth-required');
  assert.equal(result.runtimeRisk.stopReason, 'login-wall');
  assert.equal(result.authHealth.recoveryReason, 'session-login-wall');
  await assert.rejects(
    readFile(path.join(runDir, 'api-drift-samples.json'), 'utf8'),
    /ENOENT/u,
  );
});

test('runSocialAction keeps Instagram followed profile scan incomplete unless pagination is verified', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-ig-followed-incomplete-'));
  t.after(async () => {
    await rm(runDir, { recursive: true, force: true });
  });
  const fakeSession = {
    async navigateAndWait() {},
    async evaluateValue() {
      return 'https://www.instagram.com/';
    },
    async waitForSettled() {},
    async callPageFunction(fn, config, request = {}) {
      const source = String(fn);
      if (source.includes('pageOpenSocialRelationSurface')) {
        return { clicked: true, relation: 'following', href: '/me/following/' };
      }
      if (source.includes('pageExtractSocialState')) {
        if (request.action === 'followed-users') {
          return {
            url: 'https://www.instagram.com/me/following/',
            title: 'Following',
            currentAccount: 'me',
            account: { handle: 'me', displayName: 'Me' },
            items: [],
            relations: [{ handle: 'friend', url: 'https://www.instagram.com/friend/' }],
            media: [],
          };
        }
        if (request.account === 'friend') {
          return {
            url: 'https://www.instagram.com/friend/',
            title: 'Friend',
            currentAccount: 'me',
            account: { handle: 'friend', displayName: 'Friend' },
            items: [{
              id: 'ig-post-1',
              url: 'https://www.instagram.com/p/ig-post-1/',
              text: 'matching post',
              timestamp: '2026-04-26T08:00:00.000Z',
              media: [],
            }],
            relations: [],
            media: [],
          };
        }
        return {
          url: 'https://www.instagram.com/',
          title: 'Instagram',
          currentAccount: 'me',
          account: { handle: 'me', displayName: 'Me' },
          items: [],
          relations: [],
          media: [],
        };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() {
      return {};
    },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'instagram',
    action: 'followed-posts-by-date',
    account: 'me',
    date: '2026-04-26',
    maxScrolls: 0,
    maxUsers: 5,
    maxItems: 10,
    riskBackoffMs: 0,
    timeoutMs: 1000,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() {
      return { userDataDir: null, cleanupUserDataDirOnShutdown: true };
    },
    async openBrowserSession() {
      return fakeSession;
    },
    async ensureAuthenticatedSession() {
      return { loggedIn: true };
    },
  });

  assert.equal(result.result.items.length, 1);
  assert.equal(result.result.archive.complete, false);
  assert.equal(result.result.archive.reason, 'unverified-following-pagination');
  assert.equal(result.result.archive.confidence, 'verified-complete');
  assert.equal(result.completeness.confidence, 'verified-complete');
});

test('runSocialAction scrolls Instagram followed-users until profile count is reached', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-ig-following-count-'));
  t.after(async () => {
    await rm(runDir, { recursive: true, force: true });
  });
  const firstPage = Array.from({ length: 10 }, (_, index) => ({
    handle: `friend${index + 1}`,
    url: `https://www.instagram.com/friend${index + 1}/`,
  }));
  const fullPage = [
    ...firstPage,
    { handle: 'friend11', url: 'https://www.instagram.com/friend11/' },
    { handle: 'friend12', url: 'https://www.instagram.com/friend12/' },
    { handle: 'friend13', url: 'https://www.instagram.com/friend13/' },
  ];
  let extractCalls = 0;
  let scrollCalls = 0;
  let startupUrl = null;
  const navigations = [];
  const fakeSession = {
    async navigateAndWait(url) {
      navigations.push(url);
    },
    async evaluateValue() {
      return 'https://www.instagram.com/me/following/';
    },
    async waitForSettled() {},
    async callPageFunction(fn, config, request = {}) {
      const source = String(fn);
      if (source.includes('pageOpenSocialRelationSurface')) {
        return { clicked: true, relation: 'following', href: '/me/following/' };
      }
      if (source.includes('pageExtractSocialState')) {
        extractCalls += 1;
        const relations = extractCalls >= 4 ? fullPage : firstPage;
        return {
          url: 'https://www.instagram.com/me/following/',
          title: 'Following',
          currentAccount: 'me',
          account: {
            handle: 'me',
            displayName: 'Me',
            stats: [{ text: '13 following', url: 'https://www.instagram.com/me/following/' }],
          },
          relationExpectedCount: 13,
          items: [],
          relations,
          media: [],
        };
      }
      if (source.includes('pageScrollToBottom')) {
        scrollCalls += 1;
        return { target: 'dialog', before: scrollCalls * 100, after: scrollCalls * 100 + 80, height: 1000, changed: true };
      }
      return null;
    },
    getMetrics() {
      return {};
    },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'instagram',
    action: 'followed-users',
    account: 'me',
    maxItems: 100,
    maxScrolls: 10,
    scrollWaitMs: 0,
    timeoutMs: 1000,
    apiCursor: true,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() {
      return { userDataDir: null, cleanupUserDataDirOnShutdown: true };
    },
    async openBrowserSession(settings) {
      startupUrl = settings.startupUrl;
      return fakeSession;
    },
    async ensureAuthenticatedSession() {
      return { status: 'already-authenticated', loginState: { loggedIn: true, identityConfirmed: true } };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(scrollCalls >= 1, true);
  assert.equal(result.result.users.length, 13);
  assert.equal(result.result.users[12].handle, 'friend13');
  assert.equal(result.result.archive.strategy, 'dom-relation-scroll');
  assert.equal(result.result.archive.complete, true);
  assert.equal(result.result.archive.expectedRelationCount, 13);
  assert.equal(result.result.archive.domRelationCount, 13);
  assert.equal(result.completeness.status, 'complete');
  assert.equal(result.completeness.userCount, 13);
  assert.equal(result.outcome.status, 'passed');
  assert.equal(startupUrl, 'https://www.instagram.com/me/');
  assert.equal(navigations.includes('https://www.instagram.com/me/following/'), false);
});

test('runSocialAction does not mark empty Instagram relation surface as complete', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-ig-empty-relation-'));
  t.after(async () => {
    await rm(runDir, { recursive: true, force: true });
  });
  const fakeSession = {
    async navigateAndWait() {},
    async evaluateValue() {
      return 'https://www.instagram.com/me/';
    },
    async waitForSettled() {},
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageOpenSocialRelationSurface')) {
        return { clicked: false, relation: 'following', reason: 'relation-link-not-found' };
      }
      if (source.includes('pageExtractSocialState')) {
        return {
          url: 'https://www.instagram.com/me/',
          title: 'Me',
          currentAccount: 'me',
          account: { handle: 'me', displayName: 'Me', stats: [] },
          relationExpectedCount: null,
          items: [],
          relations: [],
          media: [],
        };
      }
      if (source.includes('pageScrollToBottom')) {
        return { target: 'window', before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() {
      return {};
    },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'instagram',
    action: 'followed-users',
    account: 'me',
    maxItems: 100,
    maxScrolls: 3,
    scrollWaitMs: 0,
    timeoutMs: 1000,
    apiCursor: true,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() {
      return { userDataDir: null, cleanupUserDataDirOnShutdown: true };
    },
    async openBrowserSession() {
      return fakeSession;
    },
    async ensureAuthenticatedSession() {
      return { status: 'already-authenticated', loginState: { loggedIn: true, identityConfirmed: true } };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.result.users.length, 0);
  assert.equal(result.result.archive.complete, false);
  assert.equal(result.result.archive.reason, 'relation-surface-empty');
  assert.equal(result.completeness.status, 'incomplete');
  assert.equal(result.outcome.status, 'incomplete');
});

test('runSocialAction stops Instagram followed scan when a profile hits rate limit', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-ig-followed-risk-'));
  const navigations = [];
  t.after(async () => {
    await rm(runDir, { recursive: true, force: true });
  });
  const fakeSession = {
    async navigateAndWait(url) {
      navigations.push(url);
    },
    async evaluateValue() {
      return 'https://www.instagram.com/';
    },
    async waitForSettled() {},
    async callPageFunction(fn, config, request = {}) {
      const source = String(fn);
      if (source.includes('pageOpenSocialRelationSurface')) {
        return { clicked: true, relation: 'following', href: '/me/following/' };
      }
      if (source.includes('pageExtractSocialState')) {
        if (request.action === 'followed-users') {
          return {
            url: 'https://www.instagram.com/me/following/',
            title: 'Following',
            currentAccount: 'me',
            account: { handle: 'me', displayName: 'Me' },
            items: [],
            relations: [
              { handle: 'friend1', url: 'https://www.instagram.com/friend1/' },
              { handle: 'friend2', url: 'https://www.instagram.com/friend2/' },
            ],
            media: [],
          };
        }
        if (request.account === 'friend1') {
          return {
            url: 'https://www.instagram.com/friend1/',
            title: 'Friend 1',
            currentAccount: 'me',
            account: { handle: 'friend1', displayName: 'Friend 1' },
            items: [],
            relations: [],
            media: [],
            riskSignals: ['rate-limited'],
          };
        }
        return {
          url: 'https://www.instagram.com/',
          title: 'Instagram',
          currentAccount: 'me',
          account: { handle: 'me', displayName: 'Me' },
          items: [],
          relations: [],
          media: [],
        };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() { return {}; },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'instagram',
    action: 'followed-posts-by-date',
    account: 'me',
    date: '2026-04-26',
    maxScrolls: 0,
    maxUsers: 5,
    maxItems: 10,
    riskBackoffMs: 0,
    riskRetries: 0,
    timeoutMs: 1000,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() { return { userDataDir: null, cleanupUserDataDirOnShutdown: true }; },
    async openBrowserSession() { return fakeSession; },
    async ensureAuthenticatedSession() { return { loggedIn: true }; },
  });

  assert.equal(navigations.some((url) => String(url).includes('/friend2/')), false);
  assert.equal(result.result.archive.reason, 'rate-limited');
  assert.equal(result.result.archive.confidence, 'risk-blocked');
  assert.equal(result.completeness.confidence, 'risk-blocked');
  assert.equal(result.runtimeRisk.stopReason, 'rate-limited');
  assert.equal(result.ok, false);
});

test('social action CLI parser keeps site defaults and maps common flags', () => {
  const parsed = parseSocialActionArgs([
    'profile-content',
    '@opensource',
    '--content-type',
    'media',
    '--max-items',
    '25',
    '--max-media-downloads',
    '40',
    '--risk-backoff-ms',
    '2500',
    '--risk-retries',
    '3',
    '--api-retries',
    '4',
    '--media-download-concurrency',
    '8',
    '--media-download-retries',
    '5',
    '--media-download-backoff-ms',
    '1500',
    '--download-media',
    '--run-dir',
    'runs/social/manual',
    '--resume',
    '--dry-run',
  ], { site: 'x' });

  assert.equal(parsed.site, 'x');
  assert.equal(parsed.action, 'profile-content');
  assert.equal(parsed.account, '@opensource');
  assert.equal(parsed.contentType, 'media');
  assert.equal(parsed.maxItems, '25');
  assert.equal(parsed.maxMediaDownloads, '40');
  assert.equal(parsed.riskBackoffMs, '2500');
  assert.equal(parsed.riskRetries, '3');
  assert.equal(parsed.apiRetries, '4');
  assert.equal(parsed.mediaDownloadConcurrency, '8');
  assert.equal(parsed.mediaDownloadRetries, '5');
  assert.equal(parsed.mediaDownloadBackoffMs, '1500');
  assert.equal(parsed.downloadMedia, true);
  assert.equal(parsed.runDir, 'runs/social/manual');
  assert.equal(parsed.resume, true);
  assert.equal(parsed.dryRun, true);
});

test('social action CLI parser handles explicit API cursor booleans', () => {
  assert.equal(parseSocialActionArgs(['profile-content', 'openai', '--api-cursor=true'], { site: 'x' }).apiCursor, true);
  assert.equal(parseSocialActionArgs(['profile-content', 'openai', '--api-cursor=false'], { site: 'x' }).apiCursor, false);
  assert.equal(parseSocialActionArgs(['profile-content', 'openai', '--api-cursor'], { site: 'x' }).apiCursor, true);
  assert.equal(parseSocialActionArgs(['profile-content', 'openai', '--api-cursor=true', '--no-api-cursor'], { site: 'x' }).apiCursor, false);
});

function makeInstagramNode({ tagName = 'a', attrs = {}, text = '', children = [] } = {}) {
  const upperTagName = tagName.toUpperCase();
  const href = attrs.href ? new URL(attrs.href, 'https://www.instagram.com').toString() : '';
  return {
    tagName: upperTagName,
    textContent: text,
    href,
    currentSrc: '',
    src: '',
    getAttribute(name) {
      return attrs[name] ?? null;
    },
    querySelectorAll(selector) {
      return children.filter((child) => child.matches(selector));
    },
    matches(selector) {
      return selector.split(',').some((part) => {
        const trimmed = part.trim();
        if (upperTagName !== 'A') {
          return false;
        }
        if (/^a\[href[*^]="\/p\/"\]/u.test(trimmed)) {
          return attrs.href?.includes('/p/') ?? false;
        }
        if (/^a\[href[*^]="\/reel\/"\]/u.test(trimmed)) {
          return attrs.href?.includes('/reel/') ?? false;
        }
        if (/^a\[href[*^]="\/tv\/"\]/u.test(trimmed)) {
          return attrs.href?.includes('/tv/') ?? false;
        }
        if (/^a\[href\^="\/"\]\[role="link"\]/u.test(trimmed)) {
          return (attrs.href?.startsWith('/') ?? false) && attrs.role === 'link';
        }
        return false;
      });
    },
  };
}

test('runSocialAction extracts Instagram post links when the item node is the matching anchor', async () => {
  const postLink = makeInstagramNode({ attrs: { href: '/p/root-node-post/' } });
  const currentProfile = makeInstagramNode({ attrs: { href: '/me/', role: 'link' }, text: 'Me' });
  const fakeDocument = {
    title: 'Instagram',
    querySelectorAll(selector) {
      if (selector === 'article, a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]') {
        return [postLink];
      }
      if (selector === 'a[href^="/"][role="link"]') {
        return [currentProfile];
      }
      return [];
    },
  };
  const fakeWindow = {
    location: {
      href: 'https://www.instagram.com/instagram/',
      origin: 'https://www.instagram.com',
    },
  };
  const fakeSession = {
    async navigateAndWait() {},
    async evaluateValue() {
      return fakeWindow.location.href;
    },
    async callPageFunction(fn, ...args) {
      const source = String(fn);
      if (!source.includes('pageExtractSocialState')) {
        return { before: 0, after: 0, height: 0 };
      }
      const previousDocument = globalThis.document;
      const previousWindow = globalThis.window;
      try {
        globalThis.document = fakeDocument;
        globalThis.window = fakeWindow;
        return fn(...args);
      } finally {
        if (previousDocument === undefined) {
          delete globalThis.document;
        } else {
          globalThis.document = previousDocument;
        }
        if (previousWindow === undefined) {
          delete globalThis.window;
        } else {
          globalThis.window = previousWindow;
        }
      }
    },
    getMetrics() {
      return {};
    },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'instagram',
    action: 'profile-content',
    account: 'instagram',
    maxScrolls: 0,
    timeoutMs: 1000,
  }, {
    async resolveSiteBrowserSessionOptions() {
      return { userDataDir: null, cleanupUserDataDirOnShutdown: true };
    },
    async openBrowserSession() {
      return fakeSession;
    },
    async ensureAuthenticatedSession() {
      return { loggedIn: true };
    },
  });

  assert.equal(result.result.items.length, 1);
  assert.equal(result.result.items[0].url, 'https://www.instagram.com/p/root-node-post/');
  assert.equal(result.result.items[0].sourceAccount, 'instagram');
  assert.equal(result.result.items[0].author.handle, 'instagram');
});

test('runSocialAction falls back to Instagram content media when profile links are hidden', async () => {
  const postImage = makeInstagramNode({
    tagName: 'img',
    attrs: {
      src: 'https://scontent.cdninstagram.com/v/t51.82787-15/post.jpg',
      alt: 'Visible post caption',
    },
  });
  const highlightImage = makeInstagramNode({
    tagName: 'img',
    attrs: {
      src: 'https://scontent.cdninstagram.com/v/t51.71878-15/highlight.jpg',
      alt: 'instagram的精选快拍照片',
    },
  });
  const currentProfile = makeInstagramNode({ attrs: { href: '/me/', role: 'link' }, text: 'Me' });
  const fakeDocument = {
    title: 'Instagram',
    querySelectorAll(selector) {
      if (selector === 'img, video, source') {
        return [highlightImage, postImage];
      }
      if (selector === 'a[href^="/"][role="link"]') {
        return [currentProfile];
      }
      return [];
    },
  };
  const fakeWindow = {
    location: {
      href: 'https://www.instagram.com/instagram/',
      origin: 'https://www.instagram.com',
    },
  };
  const fakeSession = {
    async navigateAndWait() {},
    async evaluateValue() {
      return fakeWindow.location.href;
    },
    async callPageFunction(fn, ...args) {
      const source = String(fn);
      if (!source.includes('pageExtractSocialState')) {
        return { before: 0, after: 0, height: 0 };
      }
      const previousDocument = globalThis.document;
      const previousWindow = globalThis.window;
      try {
        globalThis.document = fakeDocument;
        globalThis.window = fakeWindow;
        return fn(...args);
      } finally {
        if (previousDocument === undefined) {
          delete globalThis.document;
        } else {
          globalThis.document = previousDocument;
        }
        if (previousWindow === undefined) {
          delete globalThis.window;
        } else {
          globalThis.window = previousWindow;
        }
      }
    },
    getMetrics() {
      return {};
    },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'instagram',
    action: 'profile-content',
    account: 'instagram',
    maxScrolls: 0,
    timeoutMs: 1000,
  }, {
    async resolveSiteBrowserSessionOptions() {
      return { userDataDir: null, cleanupUserDataDirOnShutdown: true };
    },
    async openBrowserSession() {
      return fakeSession;
    },
    async ensureAuthenticatedSession() {
      return { loggedIn: true };
    },
  });

  assert.equal(result.result.items.length, 1);
  assert.equal(result.result.items[0].source, 'media-fallback');
  assert.equal(result.result.items[0].text, 'Visible post caption');
  assert.equal(result.result.items[0].sourceAccount, 'instagram');
  assert.equal(result.result.items[0].author.handle, 'instagram');
  assert.equal(result.result.media.length, 1);
});

test('runSocialAction follows the inferred X current account for own following list', async () => {
  const navigations = [];
  let extractCalls = 0;
  const fakeSession = {
    async navigateAndWait(url) {
      navigations.push(url);
    },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        extractCalls += 1;
        if (extractCalls === 1) {
          return {
            url: 'https://x.com/home',
            title: 'Home / X',
            currentAccount: 'me',
            account: { handle: 'me' },
            items: [],
            relations: [],
            media: [],
          };
        }
        return {
          url: 'https://x.com/me/following',
          title: 'Following / X',
          currentAccount: 'me',
          account: { handle: 'me' },
          items: [],
          relations: [{ handle: 'openai', url: 'https://x.com/openai', label: 'OpenAI' }],
          media: [],
        };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() {
      return {};
    },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'followed-users',
    maxScrolls: 0,
    timeoutMs: 1000,
  }, {
    async resolveSiteBrowserSessionOptions() {
      return { userDataDir: null, cleanupUserDataDirOnShutdown: true };
    },
    async openBrowserSession() {
      return fakeSession;
    },
    async ensureAuthenticatedSession() {
      return { loggedIn: true };
    },
  });

  assert.deepEqual(navigations, ['https://x.com/home', 'https://x.com/me/following']);
  assert.equal(result.plan.account, 'me');
  assert.equal(result.result.users[0].handle, 'openai');
});

test('runSocialAction returns to the requested profile after auth verification navigation', async () => {
  const navigations = [];
  const fakeSession = {
    async navigateAndWait(url) {
      navigations.push(url);
    },
    async evaluateValue() {
      return navigations.length === 1
        ? 'https://www.instagram.com/'
        : 'https://www.instagram.com/instagram/';
    },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        return {
          url: 'https://www.instagram.com/instagram/',
          title: 'Instagram profile',
          currentAccount: 'me',
          account: { handle: 'instagram', displayName: 'Instagram' },
          items: [],
          relations: [],
          media: [],
        };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() {
      return {};
    },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'instagram',
    action: 'account-info',
    account: 'instagram',
    maxScrolls: 0,
    timeoutMs: 1000,
  }, {
    async resolveSiteBrowserSessionOptions() {
      return { userDataDir: null, cleanupUserDataDirOnShutdown: true };
    },
    async openBrowserSession() {
      return fakeSession;
    },
    async ensureAuthenticatedSession() {
      return { loggedIn: true };
    },
  });

  assert.deepEqual(navigations, [
    'https://www.instagram.com/instagram/',
    'https://www.instagram.com/instagram/',
  ]);
  assert.equal(result.result.account.displayName, 'Instagram');
});

test('runSocialAction marks mid-run login wall as recoverable auth failure', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-login-wall-'));
  t.after(async () => {
    await rm(runDir, { recursive: true, force: true });
  });
  const fakeSession = {
    async navigateAndWait() {},
    async evaluateValue() {
      return 'https://x.com/openai';
    },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        return {
          url: 'https://x.com/i/flow/login',
          title: 'Log in to X',
          currentAccount: null,
          account: null,
          items: [],
          relations: [],
          media: [],
          riskSignals: ['login-wall'],
        };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() {
      return {};
    },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'profile-content',
    account: 'openai',
    maxScrolls: 0,
    timeoutMs: 1000,
    riskBackoffMs: 0,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() {
      return { userDataDir: null, cleanupUserDataDirOnShutdown: true };
    },
    async openBrowserSession() {
      return fakeSession;
    },
    async ensureAuthenticatedSession() {
      return { status: 'already-authenticated', loginState: { loggedIn: true, identityConfirmed: true } };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.runtimeRisk.stopReason, 'login-wall');
  assert.equal(result.authHealth.needsRecovery, true);
  assert.equal(result.authHealth.recoveryReason, 'session-login-wall');
  assert.match(result.markdown, /Runtime action: refresh-login-session/u);
  const state = JSON.parse(await readFile(path.join(runDir, 'state.json'), 'utf8'));
  assert.equal(state.status, 'failed');
  assert.equal(state.runtimeRisk.stopReason, 'login-wall');
});

test('runSocialAction resumes successfully after a recoverable login-wall failure', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-auth-resume-'));
  t.after(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  const partialItem = {
    id: 'partial-before-login-wall',
    url: 'https://x.com/openai/status/0',
    text: 'partial item before session expired',
    timestamp: '2026-04-25T00:00:00.000Z',
    sourceAccount: 'openai',
  };
  let firstExtractCalls = 0;
  const loginWallSession = {
    async navigateAndWait() {},
    async evaluateValue() {
      return 'https://x.com/openai';
    },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        firstExtractCalls += 1;
        if (firstExtractCalls === 1) {
          return {
            url: 'https://x.com/openai',
            title: 'OpenAI / X',
            currentAccount: 'me',
            account: { handle: 'openai', displayName: 'OpenAI' },
            items: [partialItem],
            relations: [],
            media: [],
            riskSignals: [],
          };
        }
        return {
          url: 'https://x.com/i/flow/login',
          title: 'Log in to X',
          currentAccount: null,
          account: null,
          items: [],
          relations: [],
          media: [],
          riskSignals: ['login-wall'],
        };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() {
      return {};
    },
    async close() {},
  };

  const first = await runSocialAction({
    site: 'x',
    action: 'profile-content',
    account: 'openai',
    maxScrolls: 1,
    timeoutMs: 1000,
    riskBackoffMs: 0,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() {
      return { userDataDir: null, cleanupUserDataDirOnShutdown: true };
    },
    async openBrowserSession() {
      return loginWallSession;
    },
    async ensureAuthenticatedSession() {
      return { status: 'already-authenticated', loginState: { loggedIn: true, identityConfirmed: true } };
    },
  });

  assert.equal(first.ok, false);
  assert.equal(first.authHealth.needsRecovery, true);
  assert.match(first.markdown, /Runtime action: refresh-login-session/u);
  const firstItemsText = await readFile(path.join(runDir, 'items.jsonl'), 'utf8');
  assert.match(firstItemsText, /partial item before session expired/u);

  const recoveredItem = {
    id: 'recovered-1',
    url: 'https://x.com/openai/status/1',
    text: 'recovered after session refresh',
    timestamp: '2026-04-26T00:00:00.000Z',
    sourceAccount: 'openai',
  };
  const recoveredSession = {
    async navigateAndWait() {},
    async evaluateValue() {
      return 'https://x.com/openai';
    },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        return {
          url: 'https://x.com/openai',
          title: 'OpenAI / X',
          currentAccount: 'me',
          account: { handle: 'openai', displayName: 'OpenAI' },
          items: [recoveredItem],
          relations: [],
          media: [],
          riskSignals: [],
        };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 1000, after: 1000, height: 1000 };
      }
      return null;
    },
    getMetrics() {
      return {};
    },
    async close() {},
  };

  const second = await runSocialAction({
    site: 'x',
    action: 'profile-content',
    account: 'openai',
    maxScrolls: 0,
    timeoutMs: 1000,
    runDir,
    resume: true,
  }, {
    async resolveSiteBrowserSessionOptions() {
      return { userDataDir: null, cleanupUserDataDirOnShutdown: true };
    },
    async openBrowserSession() {
      return recoveredSession;
    },
    async ensureAuthenticatedSession() {
      return { loggedIn: true, identityConfirmed: true };
    },
  });

  const state = JSON.parse(await readFile(path.join(runDir, 'state.json'), 'utf8'));
  const itemsText = await readFile(path.join(runDir, 'items.jsonl'), 'utf8');
  assert.equal(second.ok, true);
  assert.equal(second.authHealth.needsRecovery, false);
  assert.notEqual(second.runtimeRisk.stopReason, 'login-wall');
  assert.equal(state.status, 'completed');
  assert.notEqual(state.runtimeRisk.stopReason, 'login-wall');
  assert.equal(state.counts.items, 2);
  assert.match(itemsText, /partial item before session expired/u);
  assert.match(itemsText, /recovered after session refresh/u);
});

test('runSocialAction writes standard social archive artifacts', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-artifacts-'));
  t.after(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  const item = {
    url: 'https://x.com/openai/status/1',
    text: 'artifact item',
    timestamp: '2026-04-26T00:00:00.000Z',
    media: [{ type: 'image', url: 'https://pbs.twimg.com/media/example.jpg' }],
  };
  const fakeSession = {
    async navigateAndWait() {},
    async evaluateValue() {
      return 'https://x.com/openai';
    },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        return {
          url: 'https://x.com/openai',
          title: 'OpenAI / X',
          currentAccount: 'me',
          account: { handle: 'openai', displayName: 'OpenAI' },
          items: [item],
          relations: [],
          media: item.media,
        };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() {
      return {};
    },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'profile-content',
    account: 'openai',
    maxScrolls: 0,
    timeoutMs: 1000,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() {
      return { userDataDir: null, cleanupUserDataDirOnShutdown: true };
    },
    async openBrowserSession() {
      return fakeSession;
    },
    async ensureAuthenticatedSession() {
      return { loggedIn: true };
    },
  });

  const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
  const state = JSON.parse(await readFile(path.join(runDir, 'state.json'), 'utf8'));
  const itemsText = await readFile(path.join(runDir, 'items.jsonl'), 'utf8');
  const report = await readFile(path.join(runDir, 'report.md'), 'utf8');
  const indexCsv = await readFile(path.join(runDir, 'index.csv'), 'utf8');
  const indexHtml = await readFile(path.join(runDir, 'index.html'), 'utf8');

  assert.equal(result.artifacts.runDir, runDir);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.counts.items, 1);
  assert.equal(manifest.artifacts.indexCsv, path.join(runDir, 'index.csv'));
  assert.equal(manifest.artifacts.indexHtml, path.join(runDir, 'index.html'));
  assert.equal(state.status, 'completed');
  assert.equal(state.counts.items, 1);
  assert.equal(state.settings.apiCursorSuppressed, false);
  assert.match(itemsText, /"kind":"item"/u);
  assert.match(itemsText, /https:\/\/x\.com\/openai\/status\/1/u);
  assert.match(report, /- Items: 1/u);
  assert.match(indexCsv, /artifact item/u);
  assert.match(indexHtml, /artifact item/u);
});

test('runSocialAction uses X API media variants for downloads even when apiCursor is not requested', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-x-download-api-media-'));
  const previousFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = previousFetch;
    await rm(runDir, { recursive: true, force: true });
  });
  let fetchedUrl = null;
  globalThis.fetch = async (url) => {
    fetchedUrl = String(url);
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return String(name).toLowerCase() === 'content-type' ? 'video/mp4' : '';
        },
      },
      async arrayBuffer() {
        return new TextEncoder().encode(`video:${url}`).buffer;
      },
    };
  };

  const seedPayload = {
    data: {
      timeline: {
        instructions: [{
          entries: [{
            content: {
              itemContent: {
                tweet_results: {
                  result: {
                    rest_id: '1',
                    core: { user_results: { result: { legacy: { screen_name: 'openai' } } } },
                    legacy: {
                      created_at: 'Fri Apr 24 18:24:52 +0000 2026',
                      full_text: 'video from api',
                      extended_entities: {
                        media: [{
                          media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/poster.jpg',
                          video_info: {
                            duration_millis: 1234,
                            variants: [
                              { content_type: 'video/mp4', bitrate: 256000, url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/320x180/low.mp4' },
                              { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/1024x576/high.mp4' },
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
  };
  const domItem = {
    id: '1',
    url: 'https://x.com/openai/status/1',
    text: 'video from dom',
    timestamp: '2026-04-24T18:24:52.000Z',
    author: { handle: 'openai' },
    media: [{ type: 'image', url: 'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/poster.jpg' }],
  };
  const listeners = new Map();
  const seedUrl = new URL('https://x.com/i/api/graphql/abc/UserTweets');
  let emitted = false;
  const fakeSession = {
    client: { on(eventName, callback) { listeners.set(eventName, callback); return () => {}; } },
    sessionId: 'session-x-download-api-media',
    async send(command) {
      if (command === 'Network.getResponseBody') {
        return { body: JSON.stringify(seedPayload), base64Encoded: false };
      }
      return {};
    },
    async navigateAndWait(url) {
      if (emitted || !String(url).includes('/openai')) {
        return;
      }
      emitted = true;
      listeners.get('Network.requestWillBeSent')?.({
        params: { requestId: 'api-1', type: 'XHR', request: { url: seedUrl.toString(), method: 'GET', headers: { accept: 'application/json' } } },
      });
      listeners.get('Network.responseReceived')?.({
        params: { requestId: 'api-1', type: 'XHR', response: { url: seedUrl.toString(), status: 200, mimeType: 'application/json' } },
      });
      listeners.get('Network.loadingFinished')?.({ params: { requestId: 'api-1' } });
    },
    async evaluateValue() { return 'https://x.com/openai'; },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        return { url: 'https://x.com/openai', title: 'OpenAI / X', currentAccount: 'me', account: { handle: 'openai' }, items: [domItem], relations: [], media: domItem.media };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() { return {}; },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'profile-content',
    account: 'openai',
    maxItems: 1,
    maxScrolls: 0,
    timeoutMs: 1000,
    scrollWaitMs: 0,
    downloadMedia: true,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() { return { userDataDir: null, cleanupUserDataDirOnShutdown: true }; },
    async openBrowserSession() { return fakeSession; },
    async ensureAuthenticatedSession() { return { loggedIn: true }; },
    async exportDownloadSessionPassthrough() { return {}; },
  });

  assert.equal(result.result.items[0].media[0].type, 'video');
  assert.equal(result.result.items[0].media[0].url, 'https://video.twimg.com/ext_tw_video/1/pu/vid/1024x576/high.mp4');
  assert.equal(result.download.expectedMedia[0].type, 'video');
  assert.equal(result.download.expectedMedia[0].bitrate, 2176000);
  assert.equal(fetchedUrl, 'https://video.twimg.com/ext_tw_video/1/pu/vid/1024x576/high.mp4');
});

test('runSocialAction uses X API media variants for search downloads without apiCursor', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-x-search-download-api-media-'));
  const previousFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = previousFetch;
    await rm(runDir, { recursive: true, force: true });
  });
  let fetchedUrl = null;
  globalThis.fetch = async (url) => {
    fetchedUrl = String(url);
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return String(name).toLowerCase() === 'content-type' ? 'video/mp4' : '';
        },
      },
      async arrayBuffer() {
        return new TextEncoder().encode(`video:${url}`).buffer;
      },
    };
  };

  const seedPayload = {
    data: {
      search_by_raw_query: {
        search_timeline: {
          timeline: {
            instructions: [{
              entries: [{
                content: {
                  itemContent: {
                    tweet_results: {
                      result: {
                        rest_id: 'search-1',
                        core: { user_results: { result: { legacy: { screen_name: 'openai' } } } },
                        legacy: {
                          created_at: 'Fri Apr 24 18:24:52 +0000 2026',
                          full_text: 'search video from api',
                          extended_entities: {
                            media: [{
                              media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/search-1/pu/img/poster.jpg',
                              video_info: {
                                duration_millis: 2345,
                                variants: [
                                  { content_type: 'video/mp4', bitrate: 256000, url: 'https://video.twimg.com/ext_tw_video/search-1/pu/vid/320x180/low.mp4' },
                                  { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/ext_tw_video/search-1/pu/vid/1024x576/high.mp4' },
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
  };
  const domItem = {
    id: 'search-1',
    url: 'https://x.com/openai/status/search-1',
    text: 'search video from dom',
    timestamp: '2026-04-24T18:24:52.000Z',
    author: { handle: 'openai' },
    media: [{ type: 'image', url: 'https://pbs.twimg.com/ext_tw_video_thumb/search-1/pu/img/poster.jpg' }],
  };
  const listeners = new Map();
  const seedUrl = new URL('https://x.com/i/api/graphql/abc/SearchTimeline');
  let emitted = false;
  const fakeSession = {
    client: { on(eventName, callback) { listeners.set(eventName, callback); return () => {}; } },
    sessionId: 'session-x-search-download-api-media',
    async send(command) {
      if (command === 'Network.getResponseBody') {
        return { body: JSON.stringify(seedPayload), base64Encoded: false };
      }
      return {};
    },
    async navigateAndWait(url) {
      if (emitted || !String(url).includes('/search')) {
        return;
      }
      emitted = true;
      listeners.get('Network.requestWillBeSent')?.({
        params: { requestId: 'api-1', type: 'XHR', request: { url: seedUrl.toString(), method: 'GET', headers: { accept: 'application/json' } } },
      });
      listeners.get('Network.responseReceived')?.({
        params: { requestId: 'api-1', type: 'XHR', response: { url: seedUrl.toString(), status: 200, mimeType: 'application/json' } },
      });
      listeners.get('Network.loadingFinished')?.({ params: { requestId: 'api-1' } });
    },
    async evaluateValue() { return 'https://x.com/search?q=from%3Aopenai'; },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        return { url: 'https://x.com/search?q=from%3Aopenai', title: 'Search / X', currentAccount: 'me', account: null, items: [domItem], relations: [], media: domItem.media };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() { return {}; },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'search',
    query: 'from:openai filter:videos',
    maxItems: 1,
    maxScrolls: 0,
    timeoutMs: 1000,
    scrollWaitMs: 0,
    downloadMedia: true,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() { return { userDataDir: null, cleanupUserDataDirOnShutdown: true }; },
    async openBrowserSession() { return fakeSession; },
    async ensureAuthenticatedSession() { return { loggedIn: true }; },
    async exportDownloadSessionPassthrough() { return {}; },
  });

  assert.equal(result.result.archive.strategy, 'api-seed');
  assert.equal(result.result.archive.reason, 'api-seed-only');
  assert.equal(result.result.items[0].media[0].type, 'video');
  assert.equal(result.result.items[0].media[0].url, 'https://video.twimg.com/ext_tw_video/search-1/pu/vid/1024x576/high.mp4');
  assert.equal(result.download.expectedMedia[0].type, 'video');
  assert.equal(result.download.expectedMedia[0].bitrate, 2176000);
  assert.equal(fetchedUrl, 'https://video.twimg.com/ext_tw_video/search-1/pu/vid/1024x576/high.mp4');
});

test('runSocialAction marks X DOM poster-only video fallbacks in media artifacts', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-x-poster-fallback-'));
  const previousFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = previousFetch;
    await rm(runDir, { recursive: true, force: true });
  });
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'image/jpeg' : '';
      },
    },
    async arrayBuffer() {
      return new TextEncoder().encode(`poster:${url}`).buffer;
    },
  });

  const item = {
    id: 'post-1',
    url: 'https://x.com/openai/status/1',
    text: 'dom poster fallback',
    timestamp: '2026-04-26T00:00:00.000Z',
    media: [{ type: 'image', url: 'https://pbs.twimg.com/ext_tw_video_thumb/post-1/pu/img/poster.jpg' }],
  };
  const fakeSession = {
    async navigateAndWait() {},
    async evaluateValue() { return 'https://x.com/openai'; },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        return { url: 'https://x.com/openai', title: 'OpenAI / X', currentAccount: 'me', account: { handle: 'openai' }, items: [item], relations: [], media: item.media };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() { return {}; },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'profile-content',
    account: 'openai',
    maxItems: 1,
    maxScrolls: 0,
    timeoutMs: 1000,
    downloadMedia: true,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() { return { userDataDir: null, cleanupUserDataDirOnShutdown: true }; },
    async openBrowserSession() { return fakeSession; },
    async ensureAuthenticatedSession() { return { loggedIn: true }; },
    async exportDownloadSessionPassthrough() { return {}; },
  });

  const mediaManifest = JSON.parse(await readFile(path.join(runDir, 'media-manifest.json'), 'utf8'));
  const queue = JSON.parse(await readFile(path.join(runDir, 'media-queue.json'), 'utf8'));

  assert.equal(result.download.expectedMedia[0].fallbackFrom, 'poster-only-video-fallback');
  assert.equal(result.download.expectedMedia[0].expectedType, 'video');
  assert.equal(result.download.expectedMedia[0].type, 'image');
  assert.equal(result.download.downloads[0].fallbackFrom, 'poster-only-video-fallback');
  assert.equal(queue.queue[0].fallbackFrom, 'poster-only-video-fallback');
  assert.equal(mediaManifest.summary.posterOnlyVideoFallbacks, 1);
  assert.equal(mediaManifest.entries[0].fallbackFrom, 'poster-only-video-fallback');
  assert.equal(mediaManifest.entries[0].expectedType, 'video');
  assert.equal(mediaManifest.entries[0].type, 'image');
});

test('runSocialAction downloads every media entry from a single item when maxItems is one', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-download-media-'));
  const previousFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = previousFetch;
    await rm(runDir, { recursive: true, force: true });
  });
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'image/jpeg' : '';
      },
    },
    async arrayBuffer() {
      return new TextEncoder().encode(String(url)).buffer;
    },
  });

  const item = {
    id: 'post-1',
    url: 'https://x.com/openai/status/1',
    text: 'media item',
    timestamp: '2026-04-26T00:00:00.000Z',
    media: [
      { type: 'image', url: 'https://pbs.twimg.com/media/one.jpg' },
      { type: 'image', url: 'https://pbs.twimg.com/media/two.jpg' },
      { type: 'image', url: 'https://pbs.twimg.com/media/three.jpg' },
    ],
  };
  const fakeSession = {
    async navigateAndWait() {},
    async evaluateValue() {
      return 'https://x.com/openai';
    },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        return {
          url: 'https://x.com/openai',
          title: 'OpenAI / X',
          currentAccount: 'me',
          account: { handle: 'openai', displayName: 'OpenAI' },
          items: [item],
          relations: [],
          media: item.media,
        };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() {
      return {};
    },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'profile-content',
    account: 'openai',
    maxItems: 1,
    maxScrolls: 0,
    timeoutMs: 1000,
    downloadMedia: true,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() {
      return { userDataDir: null, cleanupUserDataDirOnShutdown: true };
    },
    async openBrowserSession() {
      return fakeSession;
    },
    async ensureAuthenticatedSession() {
      return { loggedIn: true };
    },
    async exportDownloadSessionPassthrough() {
      return {};
    },
  });

  assert.equal(result.result.items.length, 1);
  assert.equal(result.download.downloads.length, 3);
  assert.equal(result.download.bounded, false);
  assert.equal(result.download.downloads.filter((entry) => entry.ok).length, 3);
  assert.equal(result.download.downloads[0].itemId, 'post-1');
  assert.match(path.basename(result.download.downloads[0].filePath), /^0001-x-openai-post-1-m0-image-[a-f0-9]{10}\.jpg$/u);
  const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
  const mediaManifest = JSON.parse(await readFile(path.join(runDir, 'media-manifest.json'), 'utf8'));
  const downloadsJsonl = await readFile(path.join(runDir, 'downloads.jsonl'), 'utf8');
  const queue = JSON.parse(await readFile(path.join(runDir, 'media-queue.json'), 'utf8'));
  assert.equal(manifest.downloads.expectedMedia, 3);
  assert.equal(manifest.downloads.physicalCandidates, 3);
  assert.equal(manifest.downloads.queue.done, 3);
  assert.equal(manifest.downloads.hashManifest, path.join(runDir, 'media-manifest.json'));
  assert.equal(manifest.downloads.validation.total, 3);
  assert.equal(mediaManifest.summary.hashed, 3);
  assert.match(mediaManifest.entries[0].sha256, /^[a-f0-9]{64}$/u);
  assert.equal(mediaManifest.entries[0].hashMatchesDeclared, true);
  assert.equal(queue.counts.done, 3);
  assert.match(downloadsJsonl, /"referenceCount":1/u);
});

test('runSocialAction treats maxMediaDownloads as media-download bound, not item bound', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-download-media-bound-'));
  const previousFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = previousFetch;
    await rm(runDir, { recursive: true, force: true });
  });
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'image/jpeg' : '';
      },
    },
    async arrayBuffer() {
      return new TextEncoder().encode(String(url)).buffer;
    },
  });

  const item = {
    id: 'post-1',
    url: 'https://x.com/openai/status/1',
    text: 'media item',
    timestamp: '2026-04-26T00:00:00.000Z',
    media: [
      { type: 'image', url: 'https://pbs.twimg.com/media/one.jpg' },
      { type: 'image', url: 'https://pbs.twimg.com/media/two.jpg' },
      { type: 'image', url: 'https://pbs.twimg.com/media/three.jpg' },
    ],
  };
  const fakeSession = {
    async navigateAndWait() {},
    async evaluateValue() { return 'https://x.com/openai'; },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        return { url: 'https://x.com/openai', title: 'OpenAI / X', currentAccount: 'me', account: { handle: 'openai' }, items: [item], relations: [], media: item.media };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() { return {}; },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'profile-content',
    account: 'openai',
    maxItems: 1,
    maxScrolls: 0,
    maxMediaDownloads: 2,
    timeoutMs: 1000,
    downloadMedia: true,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() { return { userDataDir: null, cleanupUserDataDirOnShutdown: true }; },
    async openBrowserSession() { return fakeSession; },
    async ensureAuthenticatedSession() { return { loggedIn: true }; },
    async exportDownloadSessionPassthrough() { return {}; },
  });

  assert.equal(result.result.items.length, 1);
  assert.equal(result.download.downloads.length, 2);
  assert.equal(result.download.expectedMedia.length, 3);
  assert.equal(result.download.skippedMedia, 1);
  assert.equal(result.download.bounded, true);
  assert.equal(result.download.boundedBy, 'max-media-downloads');
  assert.equal(result.completeness.status, 'bounded');
  assert.deepEqual(result.completeness.boundedReasons, ['max-media-downloads']);
  assert.equal(result.outcome.status, 'bounded');
});

test('runSocialAction downloads media with bounded concurrency', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-download-concurrency-'));
  const previousFetch = globalThis.fetch;
  let active = 0;
  let maxActive = 0;
  t.after(async () => {
    globalThis.fetch = previousFetch;
    await rm(runDir, { recursive: true, force: true });
  });
  globalThis.fetch = async (url) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 25));
    active -= 1;
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return String(name).toLowerCase() === 'content-type' ? 'image/jpeg' : '';
        },
      },
      async arrayBuffer() {
        return new TextEncoder().encode(String(url)).buffer;
      },
    };
  };

  const item = {
    id: 'post-1',
    url: 'https://x.com/openai/status/1',
    text: 'media item',
    timestamp: '2026-04-26T00:00:00.000Z',
    media: [1, 2, 3, 4].map((index) => ({ type: 'image', url: `https://pbs.twimg.com/media/${index}.jpg` })),
  };
  const fakeSession = {
    async navigateAndWait() {},
    async evaluateValue() { return 'https://x.com/openai'; },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        return { url: 'https://x.com/openai', title: 'OpenAI / X', currentAccount: 'me', account: { handle: 'openai' }, items: [item], relations: [], media: item.media };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() { return {}; },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'profile-content',
    account: 'openai',
    maxScrolls: 0,
    timeoutMs: 1000,
    downloadMedia: true,
    mediaDownloadConcurrency: 2,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() { return { userDataDir: null, cleanupUserDataDirOnShutdown: true }; },
    async openBrowserSession() { return fakeSession; },
    async ensureAuthenticatedSession() { return { loggedIn: true }; },
    async exportDownloadSessionPassthrough() { return {}; },
  });

  assert.equal(maxActive, 2);
  assert.equal(result.download.downloads.length, 4);
  assert.equal(result.download.concurrency, 2);
  const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.downloads.concurrency, 2);
});

test('runSocialAction lowers media download concurrency after previous failures', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-download-adaptive-concurrency-'));
  const previousFetch = globalThis.fetch;
  let active = 0;
  let maxActive = 0;
  t.after(async () => {
    globalThis.fetch = previousFetch;
    await rm(runDir, { recursive: true, force: true });
  });
  await writeFile(path.join(runDir, 'media-queue.json'), JSON.stringify({
    schemaVersion: 1,
    queue: [
      { key: 'image:https://pbs.twimg.com/media/one.jpg', status: 'failed', result: { ok: false } },
      { key: 'image:https://pbs.twimg.com/media/two.jpg', status: 'failed', result: { ok: false } },
      { key: 'image:https://pbs.twimg.com/media/three.jpg', status: 'done', result: { ok: true, filePath: path.join(runDir, 'missing-three.jpg') } },
      { key: 'image:https://pbs.twimg.com/media/four.jpg', status: 'done', result: { ok: true, filePath: path.join(runDir, 'missing-four.jpg') } },
    ],
  }), 'utf8');
  globalThis.fetch = async (url) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return String(name).toLowerCase() === 'content-type' ? 'image/jpeg' : '';
        },
      },
      async arrayBuffer() {
        return new TextEncoder().encode(String(url)).buffer;
      },
    };
  };

  const item = {
    id: 'post-1',
    url: 'https://x.com/openai/status/1',
    text: 'adaptive media item',
    timestamp: '2026-04-26T00:00:00.000Z',
    media: [
      { type: 'image', url: 'https://pbs.twimg.com/media/one.jpg' },
      { type: 'image', url: 'https://pbs.twimg.com/media/two.jpg' },
      { type: 'image', url: 'https://pbs.twimg.com/media/three.jpg' },
      { type: 'image', url: 'https://pbs.twimg.com/media/four.jpg' },
    ],
  };
  const fakeSession = {
    async navigateAndWait() {},
    async evaluateValue() { return 'https://x.com/openai'; },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        return { url: 'https://x.com/openai', title: 'OpenAI / X', currentAccount: 'me', account: { handle: 'openai' }, items: [item], relations: [], media: item.media };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() { return {}; },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'profile-content',
    account: 'openai',
    maxScrolls: 0,
    timeoutMs: 1000,
    downloadMedia: true,
    mediaDownloadConcurrency: 4,
    resume: true,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() { return { userDataDir: null, cleanupUserDataDirOnShutdown: true }; },
    async openBrowserSession() { return fakeSession; },
    async ensureAuthenticatedSession() { return { loggedIn: true }; },
    async exportDownloadSessionPassthrough() { return {}; },
  });

  const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
  assert.equal(maxActive, 2);
  assert.equal(result.download.requestedConcurrency, 4);
  assert.equal(result.download.concurrency, 2);
  assert.equal(result.download.adaptiveConcurrency.adjusted, true);
  assert.equal(result.download.adaptiveConcurrency.reason, 'previous-failure-rate-high');
  assert.equal(manifest.downloads.requestedConcurrency, 4);
  assert.equal(manifest.downloads.concurrency, 2);
  assert.equal(manifest.downloads.adaptiveConcurrency.previous.failed, 2);
});

test('runSocialAction resume reuses existing media downloads', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-download-resume-'));
  const previousFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = previousFetch;
    await rm(runDir, { recursive: true, force: true });
  });
  const mediaDir = path.join(runDir, 'media');
  await mkdir(mediaDir, { recursive: true });
  const existingPath = path.join(mediaDir, 'already.jpg');
  await writeFile(existingPath, 'existing', 'utf8');
  await writeFile(path.join(runDir, 'downloads.jsonl'), `${JSON.stringify({
    ok: true,
    url: 'https://pbs.twimg.com/media/one.jpg',
    type: 'image',
    itemId: 'post-1',
    pageUrl: 'https://x.com/openai/status/1',
    mediaIndex: 0,
    filePath: existingPath,
    bytes: 8,
    transport: 'fetch',
  })}\n`, 'utf8');
  globalThis.fetch = async () => {
    throw new Error('fetch should not run for existing media');
  };

  const item = {
    id: 'post-1',
    url: 'https://x.com/openai/status/1',
    text: 'media item',
    timestamp: '2026-04-26T00:00:00.000Z',
    media: [{ type: 'image', url: 'https://pbs.twimg.com/media/one.jpg' }],
  };
  const fakeSession = {
    async navigateAndWait() {},
    async evaluateValue() { return 'https://x.com/openai'; },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        return { url: 'https://x.com/openai', title: 'OpenAI / X', currentAccount: 'me', account: { handle: 'openai' }, items: [item], relations: [], media: item.media };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() { return {}; },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'profile-content',
    account: 'openai',
    maxScrolls: 0,
    timeoutMs: 1000,
    downloadMedia: true,
    resume: true,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() { return { userDataDir: null, cleanupUserDataDirOnShutdown: true }; },
    async openBrowserSession() { return fakeSession; },
    async ensureAuthenticatedSession() { return { loggedIn: true }; },
    async exportDownloadSessionPassthrough() { return {}; },
  });

  assert.equal(result.download.downloads.length, 1);
  assert.equal(result.download.downloads[0].skipped, true);
  assert.equal(result.download.downloads[0].filePath, existingPath);
  const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.downloads.skippedExisting, 1);
});

test('runSocialAction resume reads completed media queue and skips completed downloads', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-download-queue-resume-'));
  const previousFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = previousFetch;
    await rm(runDir, { recursive: true, force: true });
  });
  const mediaDir = path.join(runDir, 'media');
  await mkdir(mediaDir, { recursive: true });
  const existingPath = path.join(mediaDir, 'queued.jpg');
  await writeFile(existingPath, 'queued', 'utf8');
  await writeFile(path.join(runDir, 'media-queue.json'), JSON.stringify({
    schemaVersion: 1,
    queue: [{
      key: 'image:https://pbs.twimg.com/media/queued.jpg',
      status: 'done',
      url: 'https://pbs.twimg.com/media/queued.jpg',
      type: 'image',
      result: {
        ok: true,
        url: 'https://pbs.twimg.com/media/queued.jpg',
        type: 'image',
        itemId: 'post-queued',
        pageUrl: 'https://x.com/openai/status/queued',
        mediaIndex: 0,
        filePath: existingPath,
        bytes: 6,
        transport: 'fetch',
      },
    }],
  }), 'utf8');
  globalThis.fetch = async () => {
    throw new Error('fetch should not run for completed queue item');
  };

  const item = {
    id: 'post-queued',
    url: 'https://x.com/openai/status/queued',
    text: 'queued media item',
    timestamp: '2026-04-26T00:00:00.000Z',
    media: [{ type: 'image', url: 'https://pbs.twimg.com/media/queued.jpg' }],
  };
  const fakeSession = {
    async navigateAndWait() {},
    async evaluateValue() { return 'https://x.com/openai'; },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        return { url: 'https://x.com/openai', title: 'OpenAI / X', currentAccount: 'me', account: { handle: 'openai' }, items: [item], relations: [], media: item.media };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() { return {}; },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'profile-content',
    account: 'openai',
    maxScrolls: 0,
    timeoutMs: 1000,
    downloadMedia: true,
    resume: true,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() { return { userDataDir: null, cleanupUserDataDirOnShutdown: true }; },
    async openBrowserSession() { return fakeSession; },
    async ensureAuthenticatedSession() { return { loggedIn: true }; },
    async exportDownloadSessionPassthrough() { return {}; },
  });

  const queue = JSON.parse(await readFile(path.join(runDir, 'media-queue.json'), 'utf8'));
  assert.equal(result.download.downloads.length, 1);
  assert.equal(result.download.downloads[0].skipped, true);
  assert.equal(result.download.downloads[0].filePath, existingPath);
  assert.equal(queue.counts.skipped, 1);
});

test('runSocialAction dedupes reused CDN URL but preserves per-post media completeness', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-download-dedupe-'));
  const previousFetch = globalThis.fetch;
  let fetchCount = 0;
  t.after(async () => {
    globalThis.fetch = previousFetch;
    await rm(runDir, { recursive: true, force: true });
  });
  globalThis.fetch = async (url) => {
    fetchCount += 1;
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return String(name).toLowerCase() === 'content-type' ? 'image/jpeg' : '';
        },
      },
      async arrayBuffer() {
        return new TextEncoder().encode(String(url)).buffer;
      },
    };
  };

  const reusedUrl = 'https://scontent.cdninstagram.com/shared.jpg';
  const items = [
    {
      id: 'post-1',
      url: 'https://www.instagram.com/p/ONE/',
      text: 'one',
      timestamp: '2026-04-26T00:00:00.000Z',
      media: [{ type: 'image', url: reusedUrl, width: 1080, height: 1350 }],
    },
    {
      id: 'post-2',
      url: 'https://www.instagram.com/p/TWO/',
      text: 'two',
      timestamp: '2026-04-26T00:01:00.000Z',
      media: [{ type: 'image', url: reusedUrl, width: 1080, height: 1350 }],
    },
  ];
  const fakeSession = {
    async navigateAndWait() {},
    async evaluateValue() {
      return 'https://www.instagram.com/instagram/';
    },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        return {
          url: 'https://www.instagram.com/instagram/',
          title: 'Instagram',
          currentAccount: 'me',
          account: { handle: 'instagram', displayName: 'Instagram' },
          items,
          relations: [],
          media: items.flatMap((item) => item.media),
        };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() {
      return {};
    },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'instagram',
    action: 'profile-content',
    account: 'instagram',
    maxItems: 10,
    maxScrolls: 0,
    timeoutMs: 1000,
    downloadMedia: true,
    runDir,
  }, {
    async resolveSiteBrowserSessionOptions() {
      return { userDataDir: null, cleanupUserDataDirOnShutdown: true };
    },
    async openBrowserSession() {
      return fakeSession;
    },
    async ensureAuthenticatedSession() {
      return { loggedIn: true };
    },
    async exportDownloadSessionPassthrough() {
      return {};
    },
  });

  assert.equal(fetchCount, 1);
  assert.equal(result.download.expectedMedia.length, 2);
  assert.equal(result.download.downloads.length, 1);
  assert.equal(result.download.downloads[0].referenceCount, 2);
  assert.match(result.download.downloads[0].contentHash, /^[a-f0-9]{64}$/u);
  assert.equal(result.completeness.download.expectedMediaCount, 2);
  assert.equal(result.completeness.download.physicalCandidateCount, 1);
  assert.equal(result.completeness.download.incompleteItemCount, 0);
  assert.equal(result.completeness.download.largestImageArea, 1080 * 1350);
  assert.deepEqual(result.completeness.download.itemCompleteness.map((entry) => entry.complete), [true, true]);
  assert.deepEqual(result.completeness.download.itemQuality.map((entry) => entry.quality), ['complete', 'complete']);
  assert.equal(result.completeness.download.highestVariantHit, true);
  assert.equal(result.completeness.download.qualityScore, 1);
  const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.downloads.expectedMedia, 2);
  assert.equal(manifest.downloads.physicalCandidates, 1);
  assert.equal(manifest.downloads.qualityScore, 1);
});

test('runSocialAction resume ignores non-item artifact rows', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bws-social-resume-'));
  t.after(async () => {
    await rm(runDir, { recursive: true, force: true });
  });
  await writeFile(path.join(runDir, 'items.jsonl'), [
    JSON.stringify({ kind: 'account', handle: 'me' }),
    JSON.stringify({ kind: 'item', handle: 'legacy-account-row' }),
    '',
  ].join('\n'), 'utf8');
  await writeFile(path.join(runDir, 'state.json'), JSON.stringify({
    schemaVersion: 1,
    archive: {
      strategy: 'api-cursor',
      complete: false,
      nextCursor: null,
      scannedUsers: [],
    },
  }), 'utf8');

  const fakeSession = {
    async navigateAndWait() {},
    async evaluateValue() {
      return 'https://x.com/openai';
    },
    async callPageFunction(fn) {
      const source = String(fn);
      if (source.includes('pageExtractSocialState')) {
        return {
          url: 'https://x.com/openai',
          title: 'OpenAI / X',
          currentAccount: 'me',
          account: { handle: 'openai', displayName: 'OpenAI' },
          items: [],
          relations: [],
          media: [],
        };
      }
      if (source.includes('pageScrollToBottom')) {
        return { before: 0, after: 0, height: 0 };
      }
      return null;
    },
    getMetrics() {
      return {};
    },
    async close() {},
  };

  const result = await runSocialAction({
    site: 'x',
    action: 'profile-content',
    account: 'openai',
    maxScrolls: 0,
    timeoutMs: 1000,
    runDir,
    resume: true,
  }, {
    async resolveSiteBrowserSessionOptions() {
      return { userDataDir: null, cleanupUserDataDirOnShutdown: true };
    },
    async openBrowserSession() {
      return fakeSession;
    },
    async ensureAuthenticatedSession() {
      return { loggedIn: true };
    },
  });

  assert.equal(result.result.items.length, 0);
});
