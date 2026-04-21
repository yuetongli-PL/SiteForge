import test from 'node:test';
import assert from 'node:assert/strict';

import { runDouyinAction } from '../../src/sites/douyin/actions/router.mjs';

test('runDouyinAction exposes actionSummary and markdown for clearer download output', async () => {
  const result = await runDouyinAction({
    action: 'download',
    items: ['https://www.douyin.com/video/7592547346870620763'],
    reuseLoginState: true,
    profilePath: 'profiles/www.douyin.com.json',
    download: {
      dryRun: true,
      maxItems: 1,
    },
  }, {
    async resolveSiteBrowserSessionOptions() {
      return {
        reuseLoginState: true,
        userDataDir: 'C:/profiles/douyin.com',
        authProfile: { filePath: 'profiles/www.douyin.com.json' },
      };
    },
    async inspectPersistentProfileHealth() {
      return {
        usableForCookies: true,
      };
    },
    async resolveDouyinMediaBatch() {
      return {
        results: [
          {
            requestedUrl: 'https://www.douyin.com/video/7592547346870620763',
            videoId: '7592547346870620763',
            resolved: true,
            source: 'detail',
            bestUrl: 'https://v26-web.douyinvod.com/example/direct.m3u8',
            title: 'Direct Video',
          },
        ],
      };
    },
    async spawnJsonCommand() {
      return {
        code: 0,
        stdout: JSON.stringify({
          runDir: 'C:/tmp/run',
          summary: { total: 1, successful: 0, failed: 0, skipped: 0, planned: 1 },
          statistics: { pathStats: { 'yt-dlp-direct-hls': 1 } },
        }),
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.actionSummary.total, 1);
  assert.equal(result.actionSummary.pathStats['yt-dlp-direct-hls'], 1);
  assert.equal(result.mediaResolution?.pathStats?.detail, 1);
  assert.match(result.markdown, /Douyin Download Action/u);
  assert.match(result.markdown, /yt-dlp-direct-hls/u);
});
