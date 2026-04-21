import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { siteKeepalive } from '../../scripts/site-keepalive.mjs';

test('siteKeepalive delegates to siteLogin with non-interactive defaults and surfaces keepalive status', async () => {
  const calls = [];

  const report = await siteKeepalive('https://www.douyin.com/?recommend=1', {
    profilePath: 'profiles/www.douyin.com.json',
  }, {
    async siteLogin(url, options) {
      calls.push({ url, options });
      return {
        site: {
          url,
          host: 'www.douyin.com',
          profilePath: options.profilePath,
          userDataDir: 'C:\\profiles\\douyin.com',
          browserStartUrl: 'https://www.douyin.com/',
        },
        auth: {
          status: 'authenticated',
          persistenceVerified: true,
          autoLogin: true,
          runtimeUrl: 'https://www.douyin.com/follow?tab=feed',
          warmupSummary: {
            attempted: true,
            completed: true,
            urls: [
              'https://www.douyin.com/',
              'https://www.douyin.com/follow?tab=feed',
            ],
            steps: [
              { url: 'https://www.douyin.com/', status: 'startup' },
              { url: 'https://www.douyin.com/follow?tab=feed', status: 'navigated' },
            ],
            warning: null,
          },
          keepaliveUrl: 'https://www.douyin.com/follow?tab=feed',
          verificationUrl: 'https://www.douyin.com/user/self?showTab=like',
          keepaliveIntervalMinutes: 120,
          cooldownMinutesAfterRisk: 120,
          preferVisibleBrowserForAuthenticatedFlows: true,
          requireStableNetworkForAuthenticatedFlows: true,
          sessionHealthSummary: {
            lastHealthyAt: '2026-04-18T14:27:48.215Z',
            nextSuggestedKeepaliveAt: '2026-04-18T16:27:48.215Z',
            keepaliveDue: false,
            successfulKeepalives: 4,
            successfulLogins: 1,
            sessionReuseVerifications: 3,
            failedKeepalives: 0,
          },
          credentialsSource: 'wincred:BrowserWikiSkill:douyin.com',
          challengeRequired: false,
        },
        warnings: [],
        reports: {
          json: 'login.json',
          markdown: 'login.md',
        },
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://www.douyin.com/?recommend=1');
  assert.equal(calls[0].options.waitForManualLogin, false);
  assert.equal(calls[0].options.autoLogin, true);
  assert.equal(calls[0].options.reuseLoginState, true);
  assert.equal(calls[0].options.runtimePurpose, 'keepalive');
  assert.equal(calls[0].options.outDir, path.resolve(process.cwd(), 'runs', 'sites', 'site-keepalive'));
  assert.equal(report.keepalive.status, 'kept-alive');
  assert.equal(report.keepalive.runtimePurpose, 'keepalive');
  assert.equal(report.keepalive.runtimeUrl, 'https://www.douyin.com/follow?tab=feed');
  assert.equal(report.keepalive.browserStartUrl, 'https://www.douyin.com/');
  assert.equal(report.keepalive.keepaliveUrl, 'https://www.douyin.com/follow?tab=feed');
  assert.equal(report.keepalive.keepaliveIntervalMinutes, 120);
  assert.equal(report.keepalive.cooldownMinutesAfterRisk, 120);
  assert.equal(report.keepalive.preferVisibleBrowserForAuthenticatedFlows, true);
  assert.equal(report.keepalive.requireStableNetworkForAuthenticatedFlows, true);
  assert.equal(report.keepalive.warmupSummary?.attempted, true);
  assert.equal(report.keepalive.warmupSummary?.completed, true);
  assert.equal(report.keepalive.sessionHealthSummary?.successfulKeepalives, 4);
  assert.equal(report.keepalive.credentialsSource, 'wincred:BrowserWikiSkill:douyin.com');
  assert.equal(report.loginReport.auth.persistenceVerified, true);
});

test('siteKeepalive can trigger Douyin follow-cache prewarm after a successful keepalive', async () => {
  const followCalls = [];

  const report = await siteKeepalive('https://www.douyin.com/?recommend=1', {
    profilePath: 'profiles/www.douyin.com.json',
    refreshFollowCache: true,
    recentActiveDays: 5,
    recentActiveUsersLimit: 20,
  }, {
    async siteLogin(url, options) {
      return {
        site: {
          url,
          host: 'www.douyin.com',
          profilePath: options.profilePath,
          userDataDir: 'C:\\profiles\\douyin.com',
          browserStartUrl: 'https://www.douyin.com/',
        },
        auth: {
          status: 'authenticated',
          persistenceVerified: true,
          autoLogin: true,
          runtimeUrl: 'https://www.douyin.com/user/self?showTab=like',
        },
        warnings: [],
        reports: null,
      };
    },
    async queryDouyinFollow(url, options) {
      followCalls.push({ url, options });
      return {
        cache: {
          path: 'C:\\profiles\\douyin.com\\.bws\\douyin-follow-cache.json',
        },
        result: {
          queryType: 'prewarm-follow-cache',
          partial: false,
          scannedUsers: 20,
          matchedVideos: 42,
        },
      };
    },
  });

  assert.equal(followCalls.length, 1);
  assert.equal(followCalls[0].url, 'https://www.douyin.com/?recommend=1');
  assert.equal(followCalls[0].options.intent, 'prewarm-follow-cache');
  assert.equal(followCalls[0].options.recentActiveDays, 5);
  assert.equal(followCalls[0].options.recentActiveUsersLimit, 20);
  assert.equal(report.keepalive.followCachePrewarm?.status, 'completed');
  assert.equal(report.keepalive.followCachePrewarm?.result?.queryType, 'prewarm-follow-cache');
  assert.equal(report.keepalive.followCachePrewarm?.result?.matchedVideos, 42);
});
