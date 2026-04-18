import test from 'node:test';
import assert from 'node:assert/strict';

import { planBilibiliAction, runBilibiliAction } from '../../lib/bilibili-action-router.mjs';

test('planBilibiliAction routes public bilibili pages to the built-in browser', async () => {
  const plan = await planBilibiliAction({
    action: 'open',
    targetUrl: 'https://www.bilibili.com/video/BV1WjDDBGE3p/',
  }, {
    async resolveBilibiliOpenDecision() {
      return {
        authRequired: false,
        openMode: 'builtin-browser',
        reason: 'public',
        profilePath: 'profiles/www.bilibili.com.json',
      };
    },
  });

  assert.equal(plan.route, 'builtin-browser');
  assert.equal(plan.authRequired, false);
});

test('planBilibiliAction routes authenticated bilibili pages through login bootstrap when no reusable session exists', async () => {
  const plan = await planBilibiliAction({
    action: 'open',
    targetUrl: 'https://space.bilibili.com/1202350411/fans/follow',
    reuseLoginState: true,
  }, {
    async resolveBilibiliOpenDecision() {
      return {
        authRequired: true,
        openMode: 'local-profile-browser',
        reason: 'auth-required',
        profilePath: 'profiles/www.bilibili.com.json',
      };
    },
    async resolveSiteBrowserSessionOptions() {
      return {
        reuseLoginState: true,
        userDataDir: 'C:/profiles/bilibili.com',
        authProfile: { filePath: 'profiles/www.bilibili.com.json' },
      };
    },
    async inspectPersistentProfileHealth() {
      return {
        usableForCookies: false,
      };
    },
  });

  assert.equal(plan.route, 'site-login');
  assert.equal(plan.authRequired, true);
});

test('planBilibiliAction routes watch-later downloads through login bootstrap when reusable auth is missing', async () => {
  const plan = await planBilibiliAction({
    action: 'download',
    items: ['https://www.bilibili.com/watchlater/#/list'],
    reuseLoginState: true,
  }, {
    async resolveSiteBrowserSessionOptions() {
      return {
        reuseLoginState: true,
        userDataDir: 'C:/profiles/bilibili.com',
        authProfile: { filePath: 'profiles/www.bilibili.com.json' },
      };
    },
    async inspectPersistentProfileHealth() {
      return {
        usableForCookies: false,
      };
    },
  });

  assert.equal(plan.route, 'download-after-login');
  assert.equal(plan.authRequired, true);
  assert.equal(plan.classifications[0].inputKind, 'watch-later-list');
});

test('runBilibiliAction triggers site-login before authenticated downloads', async () => {
  const result = await runBilibiliAction({
    action: 'download',
    items: ['https://www.bilibili.com/watchlater/#/list'],
    reuseLoginState: true,
  }, {
    async resolveSiteBrowserSessionOptions() {
      return {
        reuseLoginState: true,
        userDataDir: 'C:/profiles/bilibili.com',
        authProfile: { filePath: 'profiles/www.bilibili.com.json' },
      };
    },
    async inspectPersistentProfileHealth() {
      return {
        usableForCookies: false,
      };
    },
    async siteLogin() {
      return {
        auth: {
          status: 'session-reused',
          persistenceVerified: true,
        },
      };
    },
    async spawnJsonCommand() {
      return {
        code: 0,
        stdout: JSON.stringify({ summary: { total: 1 }, usedLoginState: true }),
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.plan.route, 'download-after-login');
  assert.equal(result.reasonCode, 'download-started');
  assert.equal(result.loginReport.auth.status, 'session-reused');
});
