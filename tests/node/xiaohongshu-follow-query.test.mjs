import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import {
  parseXiaohongshuFollowQueryArgs,
  queryXiaohongshuFollow,
  renderXiaohongshuFollowResultMarkdown,
} from '../../src/sites/known-sites/xiaohongshu/queries/follow-query.mjs';

const NOTIFICATION_URL = 'https://www.xiaohongshu.com/notification';
const PROFILE_PATH = 'profiles/www.xiaohongshu.com.json';
const AUTH_TITLE = 'Notification - Xiaohongshu';
const SELF_PROFILE_URL = 'https://www.xiaohongshu.com/user/profile/6947ebe90000000037002ccb';

function createBaseDeps(tempDirFactory) {
  return {
    resolveSiteAuthProfile: async () => ({
      profile: { host: 'www.xiaohongshu.com' },
      warnings: [],
    }),
    resolveSiteBrowserSessionOptions: async () => ({
      userDataDir: await tempDirFactory(),
      cleanupUserDataDirOnShutdown: true,
      authConfig: {
        verificationUrl: NOTIFICATION_URL,
      },
    }),
    prepareSiteSessionGovernance: async () => ({
      policyDecision: { allowed: true },
      lease: null,
    }),
    ensureAuthenticatedSession: async () => ({
      status: 'already-authenticated',
      loginState: {
        loginStateDetected: true,
      },
    }),
    finalizeSiteSessionGovernance: async () => ({ policyDecision: { allowed: true } }),
    releaseSessionLease: async () => {},
  };
}

function createAuthenticatedSnapshot(overrides = /** @type {any} */ ({})) {
  return {
    currentUrl: NOTIFICATION_URL,
    title: AUTH_TITLE,
    guest: false,
    rawLoggedIn: true,
    currentUser: {
      name: 'ytL',
      userId: '6947ebe90000000037002ccb',
      redId: '63526358290',
      url: SELF_PROFILE_URL,
    },
    followedUsers: [],
    notificationCount: {
      unreadCount: 0,
      mentions: 0,
      likes: 0,
      connections: 0,
    },
    ...overrides,
  };
}

test('parseXiaohongshuFollowQueryArgs accepts explicit format and auth flags', () => {
  const parsed = parseXiaohongshuFollowQueryArgs([
    NOTIFICATION_URL,
    '--intent', 'list-followed-updates',
    '--format', 'markdown',
    '--timeout', '45000',
    '--limit', '5',
    '--per-user-limit', '2',
    '--headless',
    '--auto-login',
    '--no-reuse-login-state',
  ]);

  assert.equal(parsed.help, false);
  assert.equal(parsed.inputUrl, NOTIFICATION_URL);
  assert.equal(parsed.options.intent, 'list-followed-updates');
  assert.equal(parsed.options.format, 'markdown');
  assert.equal(parsed.options.timeoutMs, '45000');
  assert.equal(parsed.options.limit, '5');
  assert.equal(parsed.options.perUserLimit, '2');
  assert.equal(parsed.options.headless, true);
  assert.equal(parsed.options.autoLogin, true);
  assert.equal(parsed.options.reuseLoginState, false);
});

test('queryXiaohongshuFollow reports guest sessions as unauthenticated', async () => {
  let tempDir = null;
  const deps = createBaseDeps(async () => (tempDir ??= await mkdtemp(path.join(os.tmpdir(), 'xhs-follow-query-guest-'))));
  const report = await queryXiaohongshuFollow(NOTIFICATION_URL, {
    profilePath: PROFILE_PATH,
    headless: true,
    autoLogin: false,
  }, {
    ...deps,
    openBrowserSession: async () => ({
      navigateAndWait: async () => {},
      callPageFunction: async (fn) => {
        if (fn.name === 'pageFetchXiaohongshuAuthSnapshot') {
          return {
            currentUrl: NOTIFICATION_URL,
            title: AUTH_TITLE,
            guest: true,
            rawLoggedIn: false,
            currentUser: null,
            followedUsers: [],
            notificationCount: {
              unreadCount: 0,
              mentions: 0,
              likes: 0,
              connections: 0,
            },
          };
        }
        throw new Error(`Unexpected page function ${fn.name}`);
      },
      close: async () => {},
    }),
    ensureAuthenticatedSession: async () => ({
      status: 'credentials-unavailable',
      loginState: {
        loginStateDetected: false,
      },
    }),
  });

  try {
    assert.equal(report.auth.status, 'guest');
    assert.equal(report.result.status, 'unauthenticated');
    assert.equal(report.result.reasonCode, 'guest-session');
    assert.deepEqual(report.result.users, []);
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

test('queryXiaohongshuFollow returns followed users directly from authenticated page state', async () => {
  let tempDir = null;
  /** @type {string[]} */
  const navigatedUrls = /** @type {any[]} */ ([]);
  const deps = createBaseDeps(async () => (tempDir ??= await mkdtemp(path.join(os.tmpdir(), 'xhs-follow-query-state-'))));
  const report = await queryXiaohongshuFollow(NOTIFICATION_URL, {
    profilePath: PROFILE_PATH,
    headless: true,
    autoLogin: false,
  }, {
    ...deps,
    openBrowserSession: async () => ({
      navigateAndWait: async (url) => {
        navigatedUrls.push(url);
      },
      callPageFunction: async (fn) => {
        if (fn.name === 'pageFetchXiaohongshuAuthSnapshot') {
          return createAuthenticatedSnapshot({
            followedUsers: [
              {
                name: 'Author B',
                userId: 'u-2',
                redId: 'red-2',
                url: 'https://www.xiaohongshu.com/user/profile/u-2',
                source: 'state-user-follow',
              },
              {
                name: 'Author A',
                userId: 'u-1',
                redId: 'red-1',
                url: 'https://www.xiaohongshu.com/user/profile/u-1',
                source: 'state-user-follow',
              },
            ],
          });
        }
        throw new Error(`Unexpected page function ${fn.name}`);
      },
      close: async () => {},
    }),
  });

  try {
    assert.deepEqual(navigatedUrls, [NOTIFICATION_URL]);
    assert.equal(report.auth.status, 'authenticated');
    assert.equal(report.result.status, 'success');
    assert.equal(report.result.followedUsersSource, 'state-user-follow');
    assert.deepEqual(report.result.users.map((item) => item.name), ['Author A', 'Author B']);
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

test('queryXiaohongshuFollow prefers the official webpack follow api before self-profile fallback', async () => {
  let tempDir = null;
  /** @type {string[]} */
  const navigatedUrls = /** @type {any[]} */ ([]);
  const deps = createBaseDeps(async () => (tempDir ??= await mkdtemp(path.join(os.tmpdir(), 'xhs-follow-query-official-api-'))));
  const report = await queryXiaohongshuFollow(NOTIFICATION_URL, {
    profilePath: PROFILE_PATH,
    headless: true,
    autoLogin: false,
  }, {
    ...deps,
    openBrowserSession: async () => ({
      navigateAndWait: async (url) => {
        navigatedUrls.push(url);
      },
      callPageFunction: async (fn) => {
        if (fn.name === 'pageFetchXiaohongshuAuthSnapshot') {
          return createAuthenticatedSnapshot();
        }
        if (fn.name === 'pageFetchXiaohongshuOfficialFollowList') {
          return {
            status: 'success',
            matchedUsers: 2,
            users: [
              {
                name: 'Alpha',
                userId: 'u-2',
                url: 'https://www.xiaohongshu.com/user/profile/u-2',
                source: 'official-follow-api',
              },
              {
                name: 'Beta',
                userId: 'u-1',
                url: 'https://www.xiaohongshu.com/user/profile/u-1',
                source: 'official-follow-api',
              },
            ],
          };
        }
        if (fn.name === 'pageExtractXiaohongshuSelfProfileFollowState') {
          throw new Error('Self-profile fallback should not run when the official api succeeds');
        }
        throw new Error(`Unexpected page function ${fn.name}`);
      },
      close: async () => {},
    }),
  });

  try {
    assert.deepEqual(navigatedUrls, [NOTIFICATION_URL]);
    assert.equal(report.auth.status, 'authenticated');
    assert.equal(report.result.status, 'success');
    assert.equal(report.result.followedUsersSource, 'official-api-intimacy-list');
    assert.deepEqual(report.result.users.map((item) => item.name), ['Alpha', 'Beta']);
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

test('queryXiaohongshuFollow collects followed-user updates from author pages', async () => {
  let tempDir = null;
  let currentUrl = NOTIFICATION_URL;
  const deps = createBaseDeps(async () => (tempDir ??= await mkdtemp(path.join(os.tmpdir(), 'xhs-follow-query-updates-'))));
  const report = await queryXiaohongshuFollow(NOTIFICATION_URL, {
    profilePath: PROFILE_PATH,
    intent: 'list-followed-updates',
    limit: 2,
    perUserLimit: 2,
    headless: true,
    autoLogin: false,
  }, {
    ...deps,
    openBrowserSession: async () => ({
      navigateAndWait: async (url) => {
        currentUrl = String(url);
      },
      callPageFunction: async (fn) => {
        if (fn.name === 'pageFetchXiaohongshuAuthSnapshot') {
          return createAuthenticatedSnapshot();
        }
        if (fn.name === 'pageFetchXiaohongshuOfficialFollowList') {
          return {
            status: 'success',
            matchedUsers: 2,
            users: [
              {
                name: 'Alpha',
                userId: 'u-1',
                redId: 'red-1',
                url: 'https://www.xiaohongshu.com/user/profile/u-1',
                source: 'official-follow-api',
              },
              {
                name: 'Beta',
                userId: 'u-2',
                redId: 'red-2',
                url: 'https://www.xiaohongshu.com/user/profile/u-2',
                source: 'official-follow-api',
              },
            ],
          };
        }
        if (fn.name === 'pageExtractXiaohongshuAuthorPageNotes') {
          if (currentUrl.endsWith('/u-1')) {
            return {
              status: 'success',
              currentUrl,
              title: 'Alpha profile',
              hasMore: false,
              notes: [
                {
                  noteId: 'note-alpha-1',
                  title: 'Alpha commute note',
                  url: 'https://www.xiaohongshu.com/explore/note-alpha-1',
                  imageCount: 3,
                  publishedAt: '2026-04-23T10:00:00.000Z',
                  authorName: 'Alpha',
                  authorUserId: 'u-1',
                  authorUrl: 'https://www.xiaohongshu.com/user/profile/u-1',
                },
              ],
            };
          }
          if (currentUrl.endsWith('/u-2')) {
            return {
              status: 'success',
              currentUrl,
              title: 'Beta profile',
              hasMore: false,
              notes: [
                {
                  noteId: 'note-beta-2',
                  title: 'Beta late update',
                  url: 'https://www.xiaohongshu.com/explore/note-beta-2',
                  imageCount: 2,
                  publishedAt: '2026-04-24T02:00:00.000Z',
                  authorName: 'Beta',
                  authorUserId: 'u-2',
                  authorUrl: 'https://www.xiaohongshu.com/user/profile/u-2',
                },
                {
                  noteId: 'note-beta-1',
                  title: 'Beta early update',
                  url: 'https://www.xiaohongshu.com/explore/note-beta-1',
                  imageCount: 1,
                  publishedAt: '2026-04-22T03:00:00.000Z',
                  authorName: 'Beta',
                  authorUserId: 'u-2',
                  authorUrl: 'https://www.xiaohongshu.com/user/profile/u-2',
                },
              ],
            };
          }
          throw new Error(`Unexpected author-page currentUrl ${currentUrl}`);
        }
        throw new Error(`Unexpected page function ${fn.name}`);
      },
      close: async () => {},
    }),
  });

  try {
    assert.equal(report.auth.status, 'authenticated');
    assert.equal(report.result.queryType, 'list-followed-updates');
    assert.equal(report.result.status, 'success');
    assert.equal(report.result.followedUsersSource, 'official-api-intimacy-list');
    assert.equal(report.result.totalFollowedUsers, 2);
    assert.equal(report.result.scannedUsers, 2);
    assert.equal(report.result.matchedUsers, 2);
    assert.equal(report.result.matchedNotes, 3);
    assert.equal(report.result.groups.length, 2);
    assert.deepEqual(report.result.notes.map((note) => note.noteId), [
      'note-beta-2',
      'note-alpha-1',
      'note-beta-1',
    ]);
    const markdown = renderXiaohongshuFollowResultMarkdown(report);
    assert.match(markdown, /## Updates/u);
    assert.match(markdown, /Alpha commute note/u);
    assert.match(markdown, /Beta late update/u);
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

test('queryXiaohongshuFollow marks self-profile captcha redirects explicitly', async () => {
  let tempDir = null;
  const deps = createBaseDeps(async () => (tempDir ??= await mkdtemp(path.join(os.tmpdir(), 'xhs-follow-query-captcha-'))));
  const report = await queryXiaohongshuFollow(NOTIFICATION_URL, {
    profilePath: PROFILE_PATH,
    headless: true,
    autoLogin: false,
  }, {
    ...deps,
    openBrowserSession: async () => ({
      navigateAndWait: async () => {},
      evaluateValue: async () => 'https://www.xiaohongshu.com/website-login/captcha?redirectPath=self',
      callPageFunction: async (fn) => {
        if (fn.name === 'pageFetchXiaohongshuAuthSnapshot') {
          return createAuthenticatedSnapshot({
            followedUsers: [],
            notificationCount: null,
          });
        }
        if (fn.name === 'pageFetchXiaohongshuOfficialFollowList') {
          return {
            status: 'error',
            matchedUsers: 0,
            users: [],
            errorMessage: 'official-api-unavailable',
          };
        }
        if (fn.name === 'pageExtractXiaohongshuSelfProfileFollowState') {
          return {
            status: 'captcha',
            currentUrl: 'https://www.xiaohongshu.com/website-login/captcha?redirectPath=self',
            title: 'Security Check',
            followCount: null,
            users: [],
            openedFollowSurface: false,
          };
        }
        throw new Error(`Unexpected page function ${fn.name}`);
      },
      close: async () => {},
    }),
  });

  try {
    assert.equal(report.result.status, 'captcha-gated');
    assert.equal(report.result.reasonCode, 'self-profile-captcha');
    assert.equal(report.result.captchaDetected, true);
    assert.equal(report.runtimeRisk.schemaVersion, 1);
    assert.equal(report.runtimeRisk.state, 'captcha_required');
    assert.equal(report.runtimeRisk.reasonCode, 'self-profile-captcha');
    assert.equal(report.runtimeRisk.siteKey, 'xiaohongshu');
    assert.equal(report.runtimeRisk.taskId, 'xiaohongshu-follow-query:list-followed-users');
    assert.equal(report.runtimeRisk.scope, 'profile');
    assert.equal(report.runtimeRisk.transition.from, 'normal');
    assert.equal(report.runtimeRisk.transition.to, 'captcha_required');
    assert.equal(report.runtimeRisk.recovery.retryable, false);
    assert.equal(report.runtimeRisk.recovery.cooldownNeeded, true);
    assert.equal(report.runtimeRisk.recovery.isolationNeeded, true);
    assert.equal(report.runtimeRisk.recovery.manualRecoveryNeeded, true);
    assert.equal(report.runtimeRisk.recovery.degradable, true);
    assert.equal(report.runtimeRisk.recovery.artifactWriteAllowed, true);
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

test('renderXiaohongshuFollowResultMarkdown includes users and auth status', () => {
  const markdown = renderXiaohongshuFollowResultMarkdown({
    site: {
      url: NOTIFICATION_URL,
      profilePath: PROFILE_PATH,
      userDataDir: 'C:/profiles/xiaohongshu.com',
    },
    auth: {
      status: 'authenticated',
      guest: false,
      currentUrl: NOTIFICATION_URL,
      title: AUTH_TITLE,
      nickname: 'ytL',
      userId: '6947ebe90000000037002ccb',
      redId: '63526358290',
    },
    result: {
      queryType: 'list-followed-users',
      status: 'success',
      reasonCode: null,
      matchedUsers: 1,
      followedUsersSource: 'official-api-intimacy-list',
      selfProfileAttempted: false,
      selfProfileFinalUrl: null,
      captchaDetected: false,
      users: [
        {
          name: 'Alpha',
          userId: 'u-2',
          redId: 'red-2',
          url: 'https://www.xiaohongshu.com/user/profile/u-2',
        },
      ],
    },
    warnings: [],
  });

  assert.match(markdown, /Xiaohongshu Follow Query/u);
  assert.match(markdown, /authenticated/u);
  assert.match(markdown, /Alpha/u);
  assert.match(markdown, /red-2/u);
});
