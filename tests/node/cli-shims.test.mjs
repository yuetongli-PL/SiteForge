import test from 'node:test';
import assert from 'node:assert/strict';

import * as douyinActionEntrypoint from '../../src/entrypoints/sites/douyin-action.mjs';
import * as douyinFollowEntrypoint from '../../src/entrypoints/sites/douyin-query-follow.mjs';
import * as douyinResolveEntrypoint from '../../src/entrypoints/sites/douyin-resolve-media.mjs';
import * as douyinCookiesEntrypoint from '../../src/entrypoints/sites/douyin-export-cookies.mjs';
import * as bilibiliActionEntrypoint from '../../src/entrypoints/sites/bilibili-action.mjs';
import * as bilibiliOpenEntrypoint from '../../src/entrypoints/sites/bilibili-open-page.mjs';
import * as bilibiliExtractEntrypoint from '../../src/entrypoints/sites/bilibili-extract-links.mjs';
import * as xiaohongshuActionEntrypoint from '../../src/entrypoints/sites/xiaohongshu-action.mjs';
import * as xiaohongshuFollowEntrypoint from '../../src/entrypoints/sites/xiaohongshu-query-follow.mjs';
import * as buildEntrypoint from '../../src/entrypoints/pipeline/run-pipeline.mjs';

test('canonical site CLI entrypoints expose the expected Douyin handlers', () => {
  assert.equal(typeof douyinActionEntrypoint.runDouyinActionCli, 'function');
  assert.equal(typeof douyinFollowEntrypoint.runDouyinFollowQueryCli, 'function');
  assert.equal(typeof douyinResolveEntrypoint.runDouyinMediaResolverCli, 'function');
  assert.equal(typeof douyinCookiesEntrypoint.runDouyinExportCookiesCli, 'function');
});

test('Douyin cookie export artifact helper writes only redacted summaries', () => {
  const prepared = douyinCookiesEntrypoint.prepareDouyinCookieExportArtifacts({
    inputUrl: 'https://www.douyin.com/',
    outFile: 'C:/tmp/douyin-cookies.txt',
    sidecarFile: 'C:/tmp/douyin-cookies.sidecar.json',
    generatedAt: '2026-05-03T00:00:00.000Z',
    cookies: [{
      name: 'sessionid',
      value: 'synthetic-douyin-cookie-secret',
      domain: '.douyin.com',
      path: '/',
    }],
    liveContext: {
      headers: {
        Cookie: 'sessionid=synthetic-douyin-cookie-secret',
        Authorization: 'Bearer synthetic-douyin-auth-secret',
      },
      observedRequestHeaders: {
        cookie: 'sessionid=synthetic-douyin-cookie-secret',
      },
    },
    authContext: {
      userDataDir: 'C:/synthetic/douyin/profile',
      authConfig: {
        verificationUrl: 'https://www.douyin.com/',
      },
    },
  });

  const persisted = `${prepared.cookieArtifact.json}\n${prepared.cookieArtifact.auditJson}\n${prepared.sidecar.json}\n${prepared.sidecar.auditJson}`;
  assert.equal(prepared.summary.count, 1);
  assert.deepEqual(prepared.summary.names, ['sessionid']);
  assert.deepEqual(prepared.summary.domains, ['.douyin.com']);
  assert.doesNotMatch(
    persisted,
    /synthetic-douyin-cookie-secret|synthetic-douyin-auth-secret|sessionid=|Bearer synthetic|C:\/synthetic\/douyin\/profile|C:\/tmp\/douyin-cookies/iu,
  );
  assert.match(persisted, /redacted-cookie-export-summary/u);
});

test('canonical site CLI entrypoints expose the expected bilibili handlers', () => {
  assert.equal(typeof bilibiliActionEntrypoint.cli, 'function');
  assert.equal(typeof bilibiliOpenEntrypoint.openBilibiliPage, 'function');
  assert.equal(typeof bilibiliOpenEntrypoint.runBilibiliOpenCli, 'function');
  assert.equal(typeof bilibiliExtractEntrypoint.runBilibiliExtractLinksCli, 'function');
});

test('canonical site CLI entrypoints expose the expected Xiaohongshu handlers', () => {
  assert.equal(typeof xiaohongshuActionEntrypoint.runXiaohongshuActionCli, 'function');
  assert.equal(typeof xiaohongshuFollowEntrypoint.runXiaohongshuFollowQueryCli, 'function');
});

test('build CLI entrypoint exposes only the supported parser export', () => {
  assert.deepEqual(Object.keys(buildEntrypoint).sort(), ['parseCliArgs']);
  assert.equal(typeof buildEntrypoint.parseCliArgs, 'function');
});
