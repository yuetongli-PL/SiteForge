import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalizeDouyinAuthorUrl,
  canonicalizeDouyinVideoUrl,
  enumerateDouyinAuthorVideos,
  isLikelyDouyinAuthorShellSurface,
} from '../../src/sites/douyin/download/enumerator.mjs';

test('enumerateDouyinAuthorVideos applies a default viewport before opening the browser session', async () => {
  let capturedViewport = null;

  await assert.rejects(
    enumerateDouyinAuthorVideos(
      'https://www.douyin.com/user/MS4wLjABAAAA-example?showTab=post',
      {
        profilePath: 'profiles/www.douyin.com.json',
        reuseLoginState: true,
        timeoutMs: 60000,
      },
      {
        async resolveSiteAuthProfile() {
          return {
            profile: { host: 'www.douyin.com' },
          };
        },
        async resolveSiteBrowserSessionOptions() {
          return {
            userDataDir: 'C:/profiles/douyin.com',
            cleanupUserDataDirOnShutdown: false,
            authConfig: {},
          };
        },
        async prepareSiteSessionGovernance() {
          return {
            policyDecision: { allowed: true },
            lease: null,
          };
        },
        async openBrowserSession(settings) {
          capturedViewport = settings?.viewport ?? null;
          throw new Error('stop-after-open');
        },
      },
    ),
    /stop-after-open/u,
  );

  assert.deepEqual(capturedViewport, {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
  });
});

test('public author enumerator canonicalizes Douyin author and video urls', () => {
  assert.equal(
    canonicalizeDouyinAuthorUrl('https://www.douyin.com/user/MS4wLjABAAAAD_rgoQxZ?showTab=post'),
    'https://www.douyin.com/user/MS4wLjABAAAAD_rgoQxZ',
  );
  assert.equal(
    canonicalizeDouyinVideoUrl('https://www.douyin.com/video/7298014036069813513?source=Baiduspider'),
    'https://www.douyin.com/video/7298014036069813513',
  );
});

test('public author enumerator recognizes Douyin shell surfaces before trusting embedded author state', () => {
  assert.equal(
    isLikelyDouyinAuthorShellSurface({
      title: '的抖音 - 抖音',
      h1: null,
      bodyText: '精选 推荐 搜索 关注 朋友 我的 下载抖音精选',
      videoAnchorCount: 0,
    }),
    true,
  );
  assert.equal(
    isLikelyDouyinAuthorShellSurface({
      title: 'yuetong.l的抖音 - 抖音',
      h1: 'yuetong.l',
      bodyText: '作品 喜欢 收藏 历史',
      videoAnchorCount: 12,
    }),
    false,
  );
});
