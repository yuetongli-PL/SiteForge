import test from 'node:test';
import assert from 'node:assert/strict';

import { displayIntentName, normalizeDisplayLabel, resolveSiteTerminology } from '../../src/sites/registry/core/terminology.mjs';

test('resolveSiteTerminology returns bilibili video and up labels', () => {
  const terms = resolveSiteTerminology({ host: 'www.bilibili.com' }, 'https://www.bilibili.com/');
  assert.equal(terms.entityLabel, '视频');
  assert.equal(terms.personLabel, 'UP主');
});

test('displayIntentName localizes bilibili intents', () => {
  assert.equal(displayIntentName('search-video', { host: 'www.bilibili.com' }, 'https://www.bilibili.com/'), '搜索视频');
  assert.equal(displayIntentName('open-video', { host: 'www.bilibili.com' }, 'https://www.bilibili.com/'), '打开视频');
  assert.equal(displayIntentName('open-author', { host: 'www.bilibili.com' }, 'https://www.bilibili.com/'), '打开UP主主页');
});

test('resolveSiteTerminology returns jable Chinese labels', () => {
  const terms = resolveSiteTerminology({ host: 'jable.tv' }, 'https://jable.tv/');
  assert.equal(terms.entityLabel, '影片');
  assert.equal(terms.personLabel, '演员');
});

test('resolveSiteTerminology returns Xiaohongshu note and user labels', () => {
  const terms = resolveSiteTerminology({ host: 'www.xiaohongshu.com' }, 'https://www.xiaohongshu.com/explore');
  assert.equal(terms.entityLabel, '笔记');
  assert.equal(terms.personLabel, '用户');
});

test('normalizeDisplayLabel strips jable site suffix and keeps code', () => {
  const label = normalizeDisplayLabel(
    'JUR-652 性慾が歓迎される彼女の母がストライクな僕は...- Jable.TV',
    { siteContext: { host: 'jable.tv' }, inputUrl: 'https://jable.tv/', url: 'https://jable.tv/videos/jur-652/', pageType: 'book-detail-page' },
  );
  assert.match(label, /^JUR-652 /u);
  assert.doesNotMatch(label, /Jable/iu);
});

test('normalizeDisplayLabel maps jable models root to actor list', () => {
  const label = normalizeDisplayLabel('👯 按女优', {
    siteContext: { host: 'jable.tv' },
    inputUrl: 'https://jable.tv/',
    url: 'https://jable.tv/models/',
    pageType: 'author-list-page',
  });
  assert.equal(label, '演员列表');
});

test('normalizeDisplayLabel keeps jable models pagination as actor list', () => {
  const label = normalizeDisplayLabel('2', {
    siteContext: { host: 'jable.tv' },
    inputUrl: 'https://jable.tv/',
    url: 'https://jable.tv/models/2/',
    pageType: 'author-list-page',
  });
  assert.equal(label, '演员列表');
});

test('normalizeDisplayLabel localizes jable category pages', () => {
  assert.equal(
    normalizeDisplayLabel('latest-updates', {
      siteContext: { host: 'jable.tv' },
      inputUrl: 'https://jable.tv/',
      url: 'https://jable.tv/latest-updates/',
      pageType: 'category-page',
    }),
    '最新更新',
  );
  assert.equal(
    normalizeDisplayLabel('hot', {
      siteContext: { host: 'jable.tv' },
      inputUrl: 'https://jable.tv/',
      url: 'https://jable.tv/hot/',
      pageType: 'category-page',
    }),
    '热门影片',
  );
});

test('normalizeDisplayLabel extracts jable actor name from author page title', () => {
  assert.equal(
    normalizeDisplayLabel('愈々あき 出演的AV在线观看- Jable.TV | 免費高清AV在线观看| JAPORN.TV', {
      siteContext: { host: 'jable.tv' },
      inputUrl: 'https://jable.tv/',
      url: 'https://jable.tv/models/95898564176258a0cff5ef1f3e45431e/',
      pageType: 'author-page',
    }),
    '愈々あき',
  );
});

test('normalizeDisplayLabel extracts jable category label from page title', () => {
  assert.equal(
    normalizeDisplayLabel('Cosplay AV在线观看- Jable.TV | 免費高清AV在线观看| JAPORN.TV', {
      siteContext: { host: 'jable.tv' },
      inputUrl: 'https://jable.tv/',
      url: 'https://jable.tv/tags/Cosplay/',
      pageType: 'category-page',
    }),
    '标签：Cosplay',
  );
});

test('displayIntentName localizes jable intents', () => {
  assert.equal(displayIntentName('search-video', { host: 'jable.tv' }, 'https://jable.tv/'), '搜索影片');
  assert.equal(displayIntentName('open-video', { host: 'jable.tv' }, 'https://jable.tv/'), '打开影片');
  assert.equal(displayIntentName('open-model', { host: 'jable.tv' }, 'https://jable.tv/'), '打开演员页');
  assert.equal(displayIntentName('open-category', { host: 'jable.tv' }, 'https://jable.tv/'), '打开分类页');
});

test('displayIntentName localizes Xiaohongshu intents', () => {
  assert.equal(displayIntentName('search-book', { host: 'www.xiaohongshu.com' }, 'https://www.xiaohongshu.com/explore'), '搜索笔记');
  assert.equal(displayIntentName('open-book', { host: 'www.xiaohongshu.com' }, 'https://www.xiaohongshu.com/explore'), '打开笔记');
  assert.equal(displayIntentName('open-author', { host: 'www.xiaohongshu.com' }, 'https://www.xiaohongshu.com/explore'), '打开用户主页');
  assert.equal(displayIntentName('open-category', { host: 'www.xiaohongshu.com' }, 'https://www.xiaohongshu.com/explore'), '打开发现页');
  assert.equal(displayIntentName('open-utility-page', { host: 'www.xiaohongshu.com' }, 'https://www.xiaohongshu.com/explore'), '打开通知页');
  assert.equal(displayIntentName('download-book', { host: 'www.xiaohongshu.com' }, 'https://www.xiaohongshu.com/explore'), '下载笔记');
  assert.equal(displayIntentName('list-followed-users', { host: 'www.xiaohongshu.com' }, 'https://www.xiaohongshu.com/explore'), '查询关注用户列表');
  assert.equal(displayIntentName('list-followed-updates', { host: 'www.xiaohongshu.com' }, 'https://www.xiaohongshu.com/explore'), '查询关注用户最近更新');
});
