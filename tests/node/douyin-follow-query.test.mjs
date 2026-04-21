import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import {
  isDouyinFollowIndexFresh,
  isDouyinUserCacheWindowCovered,
  normalizeDouyinPublishFields,
  normalizeDouyinTimeWindow,
  parseDouyinFollowQueryArgs,
  parseDouyinCreateTimeMapFromHtml,
  projectDouyinFollowResult,
  queryDouyinFollow,
  readDouyinFollowCache,
  renderDouyinFollowResultMarkdown,
  resolveDouyinFollowCachePath,
  sortDouyinFollowUsers,
  updateDouyinFollowIndexCache,
  updateDouyinUserVideoCache,
  writeDouyinFollowCache,
} from '../../src/sites/douyin/queries/follow-query.mjs';

test('normalizeDouyinTimeWindow resolves today and explicit ranges in Asia/Shanghai natural days', () => {
  const now = new Date('2026-04-19T10:30:00.000+08:00');
  const today = normalizeDouyinTimeWindow('今天', { now });
  assert.equal(today.startAt, '2026-04-18T16:00:00.000Z');
  assert.equal(today.endAt, '2026-04-19T02:30:00.000Z');
  assert.equal(today.startDayKey, '2026-04-19');
  assert.equal(today.includesToday, true);

  const range = normalizeDouyinTimeWindow('2026-04-15 到 2026-04-17', { now });
  assert.equal(range.startAt, '2026-04-14T16:00:00.000Z');
  assert.equal(range.endAt, '2026-04-17T16:00:00.000Z');
  assert.deepEqual(range.dayKeys, ['2026-04-15', '2026-04-16', '2026-04-17']);
});

test('normalizeDouyinPublishFields supports exact createTime and relative Chinese time text', () => {
  const now = new Date('2026-04-19T10:30:00.000+08:00');
  const exact = normalizeDouyinPublishFields({ createTime: 1776450600 }, { now });
  assert.equal(exact.publishedAt, '2026-04-17T18:30:00.000Z');
  assert.equal(exact.publishedDayKey, '2026-04-18');
  assert.equal(exact.timeSource, 'create-time');
  assert.equal(exact.timeConfidence, 'high');

  const relative = normalizeDouyinPublishFields({ timeText: '昨天 09:12' }, { now });
  assert.equal(relative.publishedAt, '2026-04-18T01:12:00.000Z');
  assert.equal(relative.publishedDayKey, '2026-04-18');
  assert.equal(relative.timeSource, 'relative-time-text');
  assert.equal(relative.timeConfidence, 'medium');
  assert.equal(relative.timeText, '昨天 09:12');
});

test('parseDouyinCreateTimeMapFromHtml extracts aweme createTime values by video id', () => {
  const html = '<script>{"awemeId":"7627403877511417129","createTime":1775893963}</script>';
  const map = parseDouyinCreateTimeMapFromHtml(html, ['7627403877511417129']);
  assert.equal(map.get('7627403877511417129'), 1775893963);
});

test('parseDouyinFollowQueryArgs accepts output modes, filters, and refresh flags', () => {
  const parsed = parseDouyinFollowQueryArgs([
    'https://www.douyin.com/?recommend=1',
    '--intent', 'list-followed-updates',
    '--window', '浠婂ぉ',
    '--output', 'videos',
    '--format', 'markdown',
    '--user', 'User A,User B',
    '--keyword', '演唱会',
    '--limit', '10',
    '--updated-only',
    '--refresh-follow-index',
    '--refresh-user-cache',
    '--scan-concurrency', '4',
    '--session-lease-wait-ms', '20000',
    '--session-lease-poll-interval-ms', '100',
    '--session-open-retries', '5',
    '--user-scan-retries', '3',
    '--recent-active-days', '5',
    '--recent-active-users-limit', '20',
  ]);

  assert.equal(parsed.options.output, 'videos');
  assert.equal(parsed.options.format, 'markdown');
  assert.deepEqual(parsed.options.userFilter, ['User A', 'User B']);
  assert.deepEqual(parsed.options.titleKeyword, ['演唱会']);
  assert.equal(parsed.options.limit, 10);
  assert.equal(parsed.options.updatedOnly, true);
  assert.equal(parsed.options.forceRefreshFollowIndex, true);
  assert.equal(parsed.options.forceRefreshUserCache, true);
  assert.equal(parsed.options.scanConcurrency, 4);
  assert.equal(parsed.options.sessionLeaseWaitMs, 20000);
  assert.equal(parsed.options.sessionLeasePollIntervalMs, 100);
  assert.equal(parsed.options.sessionOpenRetries, 5);
  assert.equal(parsed.options.userScanRetries, 3);
  assert.equal(parsed.options.recentActiveDays, 5);
  assert.equal(parsed.options.recentActiveUsersLimit, 20);
});

test('follow cache persists follow index and same-day user coverage', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'douyin-follow-cache-'));
  try {
    const now = new Date('2026-04-19T10:30:00.000+08:00');
    let cache = await readDouyinFollowCache(tempDir);
    cache = updateDouyinFollowIndexCache(cache, [
      { name: 'B User', userId: 'u-b', url: 'https://www.douyin.com/user/u-b' },
      { name: 'A User', userId: 'u-a', url: 'https://www.douyin.com/user/u-a' },
    ], { now });
    cache = updateDouyinUserVideoCache(cache, {
      name: 'A User',
      userId: 'u-a',
      url: 'https://www.douyin.com/user/u-a',
    }, [
      {
        title: 'Video One',
        url: 'https://www.douyin.com/video/111',
        videoId: '111',
        createTime: 1776820800,
      },
    ], { now });

    await writeDouyinFollowCache(tempDir, cache);
    const persisted = await readDouyinFollowCache(tempDir);
    const window = normalizeDouyinTimeWindow('今天', { now });

    assert.equal(resolveDouyinFollowCachePath(tempDir), path.join(tempDir, '.bws', 'douyin-follow-cache.json'));
    assert.equal(isDouyinFollowIndexFresh(persisted, { now }), true);
    assert.equal(isDouyinUserCacheWindowCovered(persisted, 'u-a', window, { now }), true);
    assert.deepEqual(sortDouyinFollowUsers(persisted.followIndex.users).map((item) => item.name), ['A User', 'B User']);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('queryDouyinFollow applies default browser viewport for follow-user queries', async () => {
  /** @type {any} */
  let capturedSettings = null;
  let tempDir = null;
  const report = await queryDouyinFollow('https://www.douyin.com/?recommend=1', {
    intent: 'list-followed-users',
    profilePath: 'profiles/www.douyin.com.json',
    headless: true,
    autoLogin: false,
  }, {
    resolveSiteAuthProfile: async () => ({
      profile: { host: 'www.douyin.com' },
      authConfig: {},
    }),
    resolveSiteBrowserSessionOptions: async () => ({
      userDataDir: tempDir ??= await mkdtemp(path.join(os.tmpdir(), 'douyin-follow-query-')),
      cleanupUserDataDirOnShutdown: true,
      authConfig: {
        postLoginUrl: 'https://www.douyin.com/user/self?showTab=like',
        keepaliveUrl: 'https://www.douyin.com/user/self?showTab=like',
      },
      siteProfile: {
        authValidationSamples: {
          followUsersUrl: 'https://www.douyin.com/follow?tab=user',
        },
      },
    }),
    prepareSiteSessionGovernance: async () => ({
      policyDecision: { allowed: true },
      lease: null,
    }),
    openBrowserSession: async (settings) => {
      capturedSettings = settings;
      return {
        navigateAndWait: async () => {},
        callPageFunction: async (_fn, ...args) => {
          if (args.length > 0 && Array.isArray(args[0])) {
            return true;
          }
          return {
            users: [
              { name: 'User B', userId: 'u-b', url: 'https://www.douyin.com/user/u-b' },
              { name: 'User A', userId: 'u-a', url: 'https://www.douyin.com/user/u-a' },
            ],
            terminalReached: true,
            exhausted: true,
          };
        },
        close: async () => {},
      };
    },
    ensureAuthenticatedSession: async () => ({
      status: 'already-authenticated',
      loginState: {
        identityConfirmed: true,
        loginStateDetected: true,
        loggedIn: true,
      },
    }),
    finalizeSiteSessionGovernance: async () => ({ policyDecision: { allowed: true } }),
    releaseSessionLease: async () => {},
  });

  try {
    assert.deepEqual(capturedSettings.viewport, {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    });
    assert.equal(report.result.queryType, 'list-followed-users');
    assert.equal(report.result.matchedUsers, 2);
    assert.deepEqual(report.result.users.map((item) => item.name), ['User A', 'User B']);
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

test('queryDouyinFollow counts scanned users correctly and avoids per-user navigations when posts API succeeds', async () => {
  /** @type {any} */
  let capturedSettings = null;
  /** @type {string[]} */
  const navigatedUrls = [];
  let tempDir = null;
  let callIndex = 0;
  const report = await queryDouyinFollow('https://www.douyin.com/?recommend=1', {
    intent: 'list-followed-updates',
    timeWindow: '浠婂ぉ',
    now: new Date('2026-04-19T10:30:00.000+08:00'),
    profilePath: 'profiles/www.douyin.com.json',
    headless: true,
    autoLogin: false,
  }, {
    resolveSiteAuthProfile: async () => ({
      profile: { host: 'www.douyin.com' },
      authConfig: {},
    }),
    resolveSiteBrowserSessionOptions: async () => ({
      userDataDir: tempDir ??= await mkdtemp(path.join(os.tmpdir(), 'douyin-follow-query-updates-')),
      cleanupUserDataDirOnShutdown: true,
      authConfig: {
        postLoginUrl: 'https://www.douyin.com/user/self?showTab=like',
        keepaliveUrl: 'https://www.douyin.com/user/self?showTab=like',
      },
      siteProfile: {
        authValidationSamples: {
          followUsersUrl: 'https://www.douyin.com/follow?tab=user',
        },
      },
    }),
    prepareSiteSessionGovernance: async () => ({
      policyDecision: { allowed: true },
      lease: null,
    }),
    openBrowserSession: async (settings) => {
      capturedSettings = settings;
      return {
        navigateAndWait: async (url) => {
          navigatedUrls.push(url);
        },
        callPageFunction: async (_fn, ...args) => {
          if (args.length > 0 && Array.isArray(args[0])) {
            return true;
          }
          callIndex += 1;
          if (callIndex === 1) {
            return {
              users: [
                { name: 'User B', userId: 'u-b', uid: 'uid-b', secUid: 'u-b', url: 'https://www.douyin.com/user/u-b' },
                { name: 'User A', userId: 'u-a', uid: 'uid-a', secUid: 'u-a', url: 'https://www.douyin.com/user/u-a' },
              ],
              hasMore: false,
              nextOffset: 2,
              total: 2,
              error: null,
            };
          }
          if (callIndex === 2) {
            return {
              videos: [
                {
                  title: 'Video One',
                  url: 'https://www.douyin.com/video/111',
                  videoId: '111',
                  authorName: 'User A',
                  authorUrl: 'https://www.douyin.com/user/u-a',
                  userId: 'u-a',
                  uid: 'uid-a',
                  secUid: 'u-a',
                  createTime: 1776529800,
                },
              ],
              hasMore: false,
              nextCursor: 0,
              error: null,
            };
          }
          return {
            videos: [],
            hasMore: false,
            nextCursor: 0,
            error: null,
          };
        },
        close: async () => {},
      };
    },
    ensureAuthenticatedSession: async () => ({
      status: 'already-authenticated',
      loginState: {
        identityConfirmed: true,
        loginStateDetected: true,
        loggedIn: true,
      },
    }),
    finalizeSiteSessionGovernance: async () => ({ policyDecision: { allowed: true } }),
    releaseSessionLease: async () => {},
  });

  try {
    assert.deepEqual(capturedSettings.viewport, {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    });
    assert.ok(navigatedUrls.length >= 1);
    assert.equal(navigatedUrls[0], 'https://www.douyin.com/user/self?showTab=like');
    assert.equal(navigatedUrls.some((url) => /\?showTab=post$/u.test(String(url))), false);
    assert.equal(report.result.queryType, 'list-followed-updates');
    assert.equal(report.result.totalFollowedUsers, 2);
    assert.equal(report.result.scannedUsers, 2);
    assert.equal(report.result.matchedUsers, 1);
    assert.equal(report.result.matchedVideos, 1);
    assert.equal(report.result.partial, false);
    assert.equal(report.result.groups[0].authorName, 'User A');
    assert.equal(report.result.videos[0].videoId, '111');
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

test('queryDouyinFollow opens a small worker pool and scans followed users concurrently', async () => {
  let tempDir = null;
  let sessionOpenCount = 0;
  let maxConcurrentCalls = 0;
  let activeCalls = 0;
  const report = await queryDouyinFollow('https://www.douyin.com/?recommend=1', {
    intent: 'list-followed-updates',
    timeWindow: '2026-04-19',
    now: new Date('2026-04-20T10:30:00.000+08:00'),
    profilePath: 'profiles/www.douyin.com.json',
    headless: true,
    autoLogin: false,
    scanConcurrency: 3,
  }, {
    resolveSiteAuthProfile: async () => ({
      profile: { host: 'www.douyin.com' },
      authConfig: {},
    }),
    resolveSiteBrowserSessionOptions: async () => ({
      userDataDir: tempDir ??= await mkdtemp(path.join(os.tmpdir(), 'douyin-follow-query-concurrent-')),
      cleanupUserDataDirOnShutdown: true,
      authConfig: {
        postLoginUrl: 'https://www.douyin.com/user/self?showTab=like',
        keepaliveUrl: 'https://www.douyin.com/user/self?showTab=like',
      },
      siteProfile: {
        authValidationSamples: {
          followUsersUrl: 'https://www.douyin.com/follow?tab=user',
        },
      },
    }),
    prepareSiteSessionGovernance: async () => ({
      policyDecision: { allowed: true },
      lease: null,
    }),
    openBrowserSession: async () => {
      sessionOpenCount += 1;
      return {
        navigateAndWait: async () => {},
        callPageFunction: async (_fn, ...args) => {
          if (args.length > 0 && Array.isArray(args[0])) {
            return true;
          }
          const request = args[0] ?? {};
          if (request && typeof request === 'object' && Object.hasOwn(request, 'offset')) {
            return {
              users: [
                { name: 'User A', userId: 'u-a', uid: 'uid-a', secUid: 'u-a', url: 'https://www.douyin.com/user/u-a' },
                { name: 'User B', userId: 'u-b', uid: 'uid-b', secUid: 'u-b', url: 'https://www.douyin.com/user/u-b' },
                { name: 'User C', userId: 'u-c', uid: 'uid-c', secUid: 'u-c', url: 'https://www.douyin.com/user/u-c' },
              ],
              hasMore: false,
              nextOffset: 3,
              total: 3,
              error: null,
            };
          }
          activeCalls += 1;
          maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls);
          await new Promise((resolve) => setTimeout(resolve, 40));
          activeCalls -= 1;
          return {
            videos: [
              {
                title: `Video ${request.userId ?? 'unknown'}`,
                url: `https://www.douyin.com/video/${request.userId ?? '000'}`,
                videoId: `${request.userId ?? '000'}`,
                authorName: `Author ${request.userId ?? 'unknown'}`,
                authorUrl: `https://www.douyin.com/user/${request.userId ?? 'unknown'}`,
                userId: `${request.userId ?? 'unknown'}`,
                createTime: 1776529800,
              },
            ],
            hasMore: false,
            nextCursor: 0,
            error: null,
          };
        },
        close: async () => {},
      };
    },
    ensureAuthenticatedSession: async () => ({
      status: 'already-authenticated',
      loginState: {
        identityConfirmed: true,
        loginStateDetected: true,
        loggedIn: true,
      },
    }),
    finalizeSiteSessionGovernance: async () => ({ policyDecision: { allowed: true } }),
    releaseSessionLease: async () => {},
  });

  try {
    assert.equal(report.result.totalFollowedUsers, 3);
    assert.equal(report.result.scannedUsers, 3);
    assert.equal(report.result.partial, false);
    assert.ok(sessionOpenCount >= 2);
    assert.ok(maxConcurrentCalls >= 2);
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

test('queryDouyinFollow retries a transient top-level browser startup failure once', async () => {
  let tempDir = null;
  let openAttempts = 0;
  const report = await queryDouyinFollow('https://www.douyin.com/?recommend=1', {
    intent: 'list-followed-users',
    profilePath: 'profiles/www.douyin.com.json',
    headless: true,
    autoLogin: false,
  }, {
    resolveSiteAuthProfile: async () => ({
      profile: { host: 'www.douyin.com' },
      authConfig: {},
    }),
    resolveSiteBrowserSessionOptions: async () => ({
      userDataDir: tempDir ??= await mkdtemp(path.join(os.tmpdir(), 'douyin-follow-query-retry-')),
      cleanupUserDataDirOnShutdown: true,
      authConfig: {
        postLoginUrl: 'https://www.douyin.com/user/self?showTab=like',
        keepaliveUrl: 'https://www.douyin.com/user/self?showTab=like',
      },
      siteProfile: {
        authValidationSamples: {
          followUsersUrl: 'https://www.douyin.com/follow?tab=user',
        },
      },
    }),
    prepareSiteSessionGovernance: async () => ({
      policyDecision: { allowed: true },
      lease: null,
    }),
    openBrowserSession: async () => {
      openAttempts += 1;
      if (openAttempts === 1) {
        throw new Error('CDP timeout for Runtime.evaluate');
      }
      return {
        navigateAndWait: async () => {},
        callPageFunction: async (_fn, ...args) => {
          if (args.length > 0 && Array.isArray(args[0])) {
            return true;
          }
          return {
            users: [
              { name: 'User A', userId: 'u-a', url: 'https://www.douyin.com/user/u-a' },
            ],
            terminalReached: true,
            exhausted: true,
          };
        },
        close: async () => {},
      };
    },
    ensureAuthenticatedSession: async () => ({
      status: 'already-authenticated',
      loginState: {
        identityConfirmed: true,
        loginStateDetected: true,
        loggedIn: true,
      },
    }),
    finalizeSiteSessionGovernance: async () => ({ policyDecision: { allowed: true } }),
    releaseSessionLease: async () => {},
  });

  try {
    assert.equal(openAttempts, 2);
    assert.equal(report.result.queryType, 'list-followed-users');
    assert.equal(report.result.matchedUsers, 1);
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

test('queryDouyinFollow filters target users and applies title keyword, updated-only, and global limit after sorting', async () => {
  let tempDir = null;
  let callIndex = 0;
  const report = await queryDouyinFollow('https://www.douyin.com/?recommend=1', {
    intent: 'list-followed-updates',
    timeWindow: '浠婂ぉ',
    now: new Date('2026-04-19T10:30:00.000+08:00'),
    profilePath: 'profiles/www.douyin.com.json',
    headless: true,
    autoLogin: false,
    userFilter: ['User B'],
    titleKeyword: ['Concert'],
    limit: 1,
    updatedOnly: true,
  }, {
    resolveSiteAuthProfile: async () => ({
      profile: { host: 'www.douyin.com' },
      authConfig: {},
    }),
    resolveSiteBrowserSessionOptions: async () => ({
      userDataDir: tempDir ??= await mkdtemp(path.join(os.tmpdir(), 'douyin-follow-query-filtered-')),
      cleanupUserDataDirOnShutdown: true,
      authConfig: {
        postLoginUrl: 'https://www.douyin.com/user/self?showTab=like',
        keepaliveUrl: 'https://www.douyin.com/user/self?showTab=like',
      },
      siteProfile: {
        authValidationSamples: {
          followUsersUrl: 'https://www.douyin.com/follow?tab=user',
        },
      },
    }),
    prepareSiteSessionGovernance: async () => ({
      policyDecision: { allowed: true },
      lease: null,
    }),
    openBrowserSession: async () => ({
      navigateAndWait: async () => {},
      callPageFunction: async (_fn, ...args) => {
        if (args.length > 0 && Array.isArray(args[0])) {
          return true;
        }
        callIndex += 1;
        if (callIndex === 1) {
          return {
            users: [
              { name: 'User A', userId: 'u-a', uid: 'uid-a', secUid: 'u-a', url: 'https://www.douyin.com/user/u-a' },
              { name: 'User B', userId: 'u-b', uid: 'uid-b', secUid: 'u-b', url: 'https://www.douyin.com/user/u-b' },
            ],
            hasMore: false,
            nextOffset: 2,
            total: 2,
            error: null,
          };
        }
        return {
          videos: [
            {
              title: 'Concert One',
              url: 'https://www.douyin.com/video/201',
              videoId: '201',
              authorName: 'User B',
              authorUrl: 'https://www.douyin.com/user/u-b',
              userId: 'u-b',
              uid: 'uid-b',
              secUid: 'u-b',
              createTime: 1776530000,
            },
            {
              title: 'Daily Vlog',
              url: 'https://www.douyin.com/video/202',
              videoId: '202',
              authorName: 'User B',
              authorUrl: 'https://www.douyin.com/user/u-b',
              userId: 'u-b',
              uid: 'uid-b',
              secUid: 'u-b',
              createTime: 1776531000,
            },
            {
              title: 'Concert Two',
              url: 'https://www.douyin.com/video/203',
              videoId: '203',
              authorName: 'User B',
              authorUrl: 'https://www.douyin.com/user/u-b',
              userId: 'u-b',
              uid: 'uid-b',
              secUid: 'u-b',
              createTime: 1776532000,
            },
          ],
          hasMore: false,
          nextCursor: 0,
          error: null,
        };
      },
      close: async () => {},
    }),
    ensureAuthenticatedSession: async () => ({
      status: 'already-authenticated',
      loginState: {
        identityConfirmed: true,
        loginStateDetected: true,
        loggedIn: true,
      },
    }),
    finalizeSiteSessionGovernance: async () => ({ policyDecision: { allowed: true } }),
    releaseSessionLease: async () => {},
  });

  try {
    assert.equal(report.result.totalFollowedUsers, 2);
    assert.equal(report.result.scannedUsers, 1);
    assert.equal(report.result.matchedUsers, 1);
    assert.equal(report.result.matchedVideos, 1);
    assert.equal(report.result.users.length, 1);
    assert.equal(report.result.users[0].name, 'User B');
    assert.equal(report.result.videos.length, 1);
    assert.equal(report.result.videos[0].title, 'Concert Two');
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

test('queryDouyinFollow reuses cached user videos when headVideoId is unchanged', async () => {
  let tempDir = null;
  let callIndex = 0;
  const now = new Date('2026-04-20T10:30:00.000+08:00');
  const report = await queryDouyinFollow('https://www.douyin.com/?recommend=1', {
    intent: 'list-followed-updates',
    timeWindow: '2026-04-19',
    now,
    profilePath: 'profiles/www.douyin.com.json',
    headless: true,
    autoLogin: false,
  }, {
    resolveSiteAuthProfile: async () => ({
      profile: { host: 'www.douyin.com' },
      authConfig: {},
    }),
    resolveSiteBrowserSessionOptions: async () => {
      tempDir ??= await mkdtemp(path.join(os.tmpdir(), 'douyin-follow-query-head-cache-'));
      let cache = await readDouyinFollowCache(tempDir);
      cache = updateDouyinFollowIndexCache(cache, [
        { name: 'User A', userId: 'u-a', uid: 'uid-a', secUid: 'u-a', url: 'https://www.douyin.com/user/u-a' },
      ], { now: new Date('2026-04-19T10:30:00.000+08:00') });
      cache = updateDouyinUserVideoCache(cache, {
        name: 'User A',
        userId: 'u-a',
        uid: 'uid-a',
        secUid: 'u-a',
        url: 'https://www.douyin.com/user/u-a',
      }, [
        {
          title: 'Cached Concert',
          url: 'https://www.douyin.com/video/111',
          videoId: '111',
          authorName: 'User A',
          authorUrl: 'https://www.douyin.com/user/u-a',
          userId: 'u-a',
          createTime: 1776529800,
          source: 'posts-api',
        },
      ], { now: new Date('2026-04-19T10:30:00.000+08:00') });
      await writeDouyinFollowCache(tempDir, cache);
      return {
        userDataDir: tempDir,
        cleanupUserDataDirOnShutdown: true,
        authConfig: {
          postLoginUrl: 'https://www.douyin.com/user/self?showTab=like',
          keepaliveUrl: 'https://www.douyin.com/user/self?showTab=like',
        },
        siteProfile: {
          authValidationSamples: {
            followUsersUrl: 'https://www.douyin.com/follow?tab=user',
          },
        },
      };
    },
    prepareSiteSessionGovernance: async () => ({
      policyDecision: { allowed: true },
      lease: null,
    }),
    openBrowserSession: async () => ({
      navigateAndWait: async () => {},
      callPageFunction: async (_fn, ...args) => {
        if (args.length > 0 && Array.isArray(args[0])) {
          return true;
        }
        callIndex += 1;
        return {
          videos: [
            {
              title: 'Cached Concert',
              url: 'https://www.douyin.com/video/111',
              videoId: '111',
              authorName: 'User A',
              authorUrl: 'https://www.douyin.com/user/u-a',
              userId: 'u-a',
              uid: 'uid-a',
              secUid: 'u-a',
              createTime: 1776529800,
            },
          ],
          hasMore: true,
          nextCursor: 123,
          error: null,
        };
      },
      close: async () => {},
    }),
    ensureAuthenticatedSession: async () => ({
      status: 'already-authenticated',
      loginState: {
        identityConfirmed: true,
        loginStateDetected: true,
        loggedIn: true,
      },
    }),
    finalizeSiteSessionGovernance: async () => ({ policyDecision: { allowed: true } }),
    releaseSessionLease: async () => {},
  });

  try {
    assert.equal(report.result.totalFollowedUsers, 1);
    assert.equal(report.result.scannedUsers, 1);
    assert.equal(report.result.matchedVideos, 1);
    assert.equal(report.result.videos[0].videoId, '111');
    assert.equal(report.result.videos[0].source, 'posts-api');
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

test('queryDouyinFollow resumes from checkpoint and only scans remaining followed users', async () => {
  let tempDir = null;
  let callIndex = 0;
  const now = new Date('2026-04-20T10:30:00.000+08:00');
  const report = await queryDouyinFollow('https://www.douyin.com/?recommend=1', {
    intent: 'list-followed-updates',
    timeWindow: '2026-04-19',
    now,
    profilePath: 'profiles/www.douyin.com.json',
    headless: true,
    autoLogin: false,
  }, {
    resolveSiteAuthProfile: async () => ({
      profile: { host: 'www.douyin.com' },
      authConfig: {},
    }),
    resolveSiteBrowserSessionOptions: async () => {
      tempDir ??= await mkdtemp(path.join(os.tmpdir(), 'douyin-follow-query-resume-'));
      let cache = await readDouyinFollowCache(tempDir);
      cache = updateDouyinFollowIndexCache(cache, [
        { name: 'User A', userId: 'u-a', uid: 'uid-a', secUid: 'u-a', url: 'https://www.douyin.com/user/u-a' },
        { name: 'User B', userId: 'u-b', uid: 'uid-b', secUid: 'u-b', url: 'https://www.douyin.com/user/u-b' },
      ], { now: new Date('2026-04-20T09:30:00.000+08:00') });
      cache.queryState = {
        lastCheckpointAt: new Date('2026-04-20T09:45:00.000+08:00').toISOString(),
        lastIntent: 'list-followed-updates',
        lastWindow: '2026-04-18T16:00:00.000Z::2026-04-19T16:00:00.000Z::2026-04-19',
        lastProcessedUserId: 'u-a',
        completedUsersCount: 1,
        totalUsers: 2,
      };
      await writeDouyinFollowCache(tempDir, cache);
      return {
        userDataDir: tempDir,
        cleanupUserDataDirOnShutdown: true,
        authConfig: {
          postLoginUrl: 'https://www.douyin.com/user/self?showTab=like',
          keepaliveUrl: 'https://www.douyin.com/user/self?showTab=like',
        },
        siteProfile: {
          authValidationSamples: {
            followUsersUrl: 'https://www.douyin.com/follow?tab=user',
          },
        },
      };
    },
    prepareSiteSessionGovernance: async () => ({
      policyDecision: { allowed: true },
      lease: null,
    }),
    openBrowserSession: async () => ({
      navigateAndWait: async () => {},
      callPageFunction: async (_fn, ...args) => {
        if (args.length > 0 && Array.isArray(args[0])) {
          return true;
        }
        callIndex += 1;
        return {
          videos: [
            {
              title: 'Resume Video',
              url: 'https://www.douyin.com/video/211',
              videoId: '211',
              authorName: 'User B',
              authorUrl: 'https://www.douyin.com/user/u-b',
              userId: 'u-b',
              uid: 'uid-b',
              secUid: 'u-b',
              createTime: 1776529800,
            },
          ],
          hasMore: false,
          nextCursor: 0,
          error: null,
        };
      },
      close: async () => {},
    }),
    ensureAuthenticatedSession: async () => ({
      status: 'already-authenticated',
      loginState: {
        identityConfirmed: true,
        loginStateDetected: true,
        loggedIn: true,
      },
    }),
    finalizeSiteSessionGovernance: async () => ({ policyDecision: { allowed: true } }),
    releaseSessionLease: async () => {},
  });

  try {
    assert.equal(callIndex, 1);
    assert.equal(report.result.totalFollowedUsers, 2);
    assert.equal(report.result.scannedUsers, 2);
    assert.equal(report.result.matchedUsers, 1);
    assert.equal(report.result.videos[0].videoId, '211');
    assert.equal(report.cache.queryState.lastProcessedUserId, 'u-b');
    assert.equal(report.cache.queryState.completedUsersCount, 2);
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

test('projectDouyinFollowResult and markdown rendering support summary and groups output', () => {
  const full = {
    queryType: 'list-followed-updates',
    window: { label: '浠婂ぉ' },
    totalFollowedUsers: 5,
    scannedUsers: 3,
    matchedUsers: 1,
    matchedVideos: 2,
    partial: false,
    errors: [],
    users: [{ name: 'User A', userId: 'u-a' }],
    groups: [{
      authorName: 'User A',
      authorUrl: 'https://www.douyin.com/user/u-a',
      userId: 'u-a',
      videos: [{
        title: 'Concert One',
        videoId: '111',
        publishedDateLocal: '2026-04-19 10:00:00',
        source: 'posts-api',
        timeConfidence: 'high',
      }],
    }],
    videos: [{
      title: 'Concert One',
      videoId: '111',
      authorName: 'User A',
      publishedDateLocal: '2026-04-19 10:00:00',
      source: 'posts-api',
      timeConfidence: 'high',
    }],
  };
  const summary = projectDouyinFollowResult(full, 'summary');
  const groups = projectDouyinFollowResult(full, 'groups');
  const markdown = renderDouyinFollowResultMarkdown({ site: { url: 'https://www.douyin.com/?recommend=1' } }, groups);

  assert.equal(summary.queryType, 'list-followed-updates');
  assert.equal(summary.totalFollowedUsers, 5);
  assert.equal(Array.isArray(summary.groups), false);
  assert.equal(groups.groups.length, 1);
  assert.match(markdown, /Douyin list-followed-updates/u);
  assert.match(markdown, /User A/u);
  assert.match(markdown, /posts-api/u);
});
