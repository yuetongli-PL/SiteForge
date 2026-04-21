import test from 'node:test';
import assert from 'node:assert/strict';

import { bilibiliAdapter } from '../../src/sites/core/adapters/bilibili.mjs';
import { douyinAdapter } from '../../src/sites/core/adapters/douyin.mjs';
import { jableAdapter } from '../../src/sites/core/adapters/jable.mjs';

test('site adapters expose site-specific page-type inference hooks', () => {
  assert.equal(
    bilibiliAdapter.inferPageType({
      inputUrl: 'https://search.bilibili.com/all?keyword=test',
      pathname: '/all',
      hostname: 'search.bilibili.com',
      siteProfile: { host: 'www.bilibili.com' },
    }),
    'search-results-page',
  );
  assert.equal(
    bilibiliAdapter.inferPageType({
      inputUrl: 'https://space.bilibili.com/1202350411/video',
      pathname: '/1202350411/video',
      hostname: 'space.bilibili.com',
      siteProfile: { host: 'www.bilibili.com' },
    }),
    'author-list-page',
  );

  assert.equal(
    douyinAdapter.inferPageType({
      inputUrl: 'https://www.douyin.com/user/self?showTab=like',
      pathname: '/user/self',
      hostname: 'www.douyin.com',
      siteProfile: { host: 'www.douyin.com' },
    }),
    'author-list-page',
  );
  assert.equal(
    douyinAdapter.inferPageType({
      inputUrl: 'https://www.douyin.com/video/7487317288315258152',
      pathname: '/video/7487317288315258152',
      hostname: 'www.douyin.com',
      siteProfile: { host: 'www.douyin.com' },
    }),
    'content-detail-page',
  );

  assert.equal(
    jableAdapter.inferPageType({
      inputUrl: 'https://jable.tv/models/',
      pathname: '/models/',
      hostname: 'jable.tv',
      siteProfile: { host: 'jable.tv' },
    }),
    'author-list-page',
  );
  assert.equal(
    jableAdapter.inferPageType({
      inputUrl: 'https://jable.tv/models/kaede-karen/',
      pathname: '/models/kaede-karen/',
      hostname: 'jable.tv',
      siteProfile: { host: 'jable.tv' },
    }),
    'author-page',
  );
});
