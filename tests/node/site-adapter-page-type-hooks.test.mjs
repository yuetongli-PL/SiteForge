import test from 'node:test';
import assert from 'node:assert/strict';

import { oneTwoThreeAvAdapter } from '../../src/sites/adapters/123av.mjs';
import { attackersAdapter } from '../../src/sites/adapters/attackers.mjs';
import { bilibiliAdapter } from '../../src/sites/adapters/bilibili.mjs';
import { dahliaAdapter } from '../../src/sites/adapters/dahlia.mjs';
import { dogmaAdapter } from '../../src/sites/adapters/dogma.mjs';
import { douyinAdapter } from '../../src/sites/adapters/douyin.mjs';
import { eightmanAdapter } from '../../src/sites/adapters/eightman.mjs';
import { instagramAdapter } from '../../src/sites/adapters/instagram.mjs';
import { jableAdapter } from '../../src/sites/adapters/jable.mjs';
import { kmProduceAdapter } from '../../src/sites/adapters/km-produce.mjs';
import { madonnaAdapter } from '../../src/sites/adapters/madonna.mjs';
import { maxingAdapter } from '../../src/sites/adapters/maxing.mjs';
import { moodyzAdapter } from '../../src/sites/adapters/moodyz.mjs';
import { rookieAdapter } from '../../src/sites/adapters/rookie.mjs';
import { s1Adapter } from '../../src/sites/adapters/s1.mjs';
import { soAgentAdapter } from '../../src/sites/adapters/so-agent.mjs';
import { sodAdapter } from '../../src/sites/adapters/sod.mjs';
import { tPowersAdapter } from '../../src/sites/adapters/t-powers.mjs';
import { weiboAdapter } from '../../src/sites/adapters/weibo.mjs';
import { resolveSiteAdapter } from '../../src/sites/adapters/resolver.mjs';

function candidate(id, siteKey, method, url) {
  return {
    id,
    siteKey,
    endpoint: {
      method,
      url,
    },
  };
}

function assertApiGate(adapter, { siteKey, acceptedUrl, rejectedUrl }) {
  const accepted = adapter.validateApiCandidate({
    candidate: candidate(`${adapter.id}-accepted`, siteKey, 'GET', acceptedUrl),
  });
  const rejected = adapter.validateApiCandidate({
    candidate: candidate(`${adapter.id}-rejected`, siteKey, 'GET', rejectedUrl),
  });
  const wrongMethod = adapter.validateApiCandidate({
    candidate: candidate(`${adapter.id}-post`, siteKey, 'POST', acceptedUrl),
  });

  assert.equal(accepted.decision, 'accepted', `${adapter.id} should accept explicit read-only API candidates`);
  assert.equal(rejected.decision, 'rejected', `${adapter.id} should reject ordinary HTML routes as API candidates`);
  assert.equal(wrongMethod.decision, 'rejected', `${adapter.id} should reject write-like methods`);
}

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

test('dedicated catalog adapters expose site-specific page-type and read-only API gates', () => {
  const cases = [
    {
      adapter: oneTwoThreeAvAdapter,
      host: '123av.com',
      siteKey: '123av',
      page: ['/zh/dm9', 'category-page'],
      acceptedUrl: null,
      rejectedUrl: 'https://123av.com/api/videos.json',
    },
    {
      adapter: tPowersAdapter,
      host: 'www.t-powers.co.jp',
      siteKey: 't-powers',
      page: ['/talent', 'author-list-page'],
      acceptedUrl: 'https://www.t-powers.co.jp/wp-json/wp/v2/posts',
      rejectedUrl: 'https://www.t-powers.co.jp/release/',
    },
    {
      adapter: soAgentAdapter,
      host: 'so-agent.jp',
      siteKey: 'so-agent',
      page: ['/model.php', 'author-list-page'],
      acceptedUrl: null,
      rejectedUrl: 'http://so-agent.jp/model.php',
    },
    {
      adapter: eightmanAdapter,
      host: 'www.8man.jp',
      siteKey: 'eightman',
      page: ['/model', 'author-list-page'],
      acceptedUrl: null,
      rejectedUrl: 'https://www.8man.jp/api/models.json',
    },
    {
      adapter: jableAdapter,
      host: 'jable.tv',
      siteKey: 'jable',
      page: ['/models/', 'author-list-page'],
      acceptedUrl: 'https://jable.tv/api/videos',
      rejectedUrl: 'https://jable.tv/search',
    },
    {
      adapter: moodyzAdapter,
      host: 'moodyz.com',
      siteKey: 'moodyz',
      page: ['/works/detail/ABC123', 'book-detail-page'],
      acceptedUrl: 'https://moodyz.com/api/works',
      rejectedUrl: 'https://moodyz.com/search/test',
    },
    {
      adapter: dahliaAdapter,
      host: 'dahlia-av.jp',
      siteKey: 'dahlia',
      page: ['/works/dldss497', 'book-detail-page'],
      acceptedUrl: 'https://dahlia-av.jp/wp-json/wp/v2/works',
      rejectedUrl: 'https://dahlia-av.jp/work/',
    },
    {
      adapter: sodAdapter,
      host: 'www.sod.co.jp',
      siteKey: 'sod',
      page: ['/newreleases/archive/', 'category-page'],
      acceptedUrl: 'https://www.sod.co.jp/api/releases.json',
      rejectedUrl: 'https://www.sod.co.jp/newreleases/archive/',
    },
    {
      adapter: s1Adapter,
      host: 's1s1s1.com',
      siteKey: 's1',
      page: ['/works', 'category-page'],
      acceptedUrl: 'https://s1s1s1.com/api/works.json',
      rejectedUrl: 'https://s1s1s1.com/top',
    },
    {
      adapter: attackersAdapter,
      host: 'attackers.net',
      siteKey: 'attackers',
      page: ['/top', 'category-page'],
      acceptedUrl: 'https://attackers.net/api/works.json',
      rejectedUrl: 'https://attackers.net/top',
    },
    {
      adapter: kmProduceAdapter,
      host: 'www.km-produce.com',
      siteKey: 'km-produce',
      page: ['/ranking', 'category-page'],
      acceptedUrl: 'https://www.km-produce.com/wp-json/wp/v2/works',
      rejectedUrl: 'https://www.km-produce.com/label/page/2?works=bazooka',
    },
    {
      adapter: rookieAdapter,
      host: 'rookie-av.jp',
      siteKey: 'rookie',
      page: ['/works/detail/RKI736', 'book-detail-page'],
      acceptedUrl: 'https://rookie-av.jp/api/works.json',
      rejectedUrl: 'https://rookie-av.jp/search/test',
    },
    {
      adapter: madonnaAdapter,
      host: 'madonna-av.com',
      siteKey: 'madonna',
      page: ['/works/detail/JUVR294', 'book-detail-page'],
      acceptedUrl: 'https://madonna-av.com/api/works.json',
      rejectedUrl: 'https://madonna-av.com/search/test',
    },
    {
      adapter: maxingAdapter,
      host: 'www.maxing.jp',
      siteKey: 'maxing',
      page: ['/shop/now_release.html', 'category-page'],
      acceptedUrl: 'https://www.maxing.jp/api/works.json',
      rejectedUrl: 'https://www.maxing.jp/shop_search',
    },
    {
      adapter: dogmaAdapter,
      host: 'www.dogma.co.jp',
      siteKey: 'dogma',
      page: ['/13-download', 'utility-page'],
      acceptedUrl: 'https://www.dogma.co.jp/wp-json/wp/v2/works.json',
      rejectedUrl: 'https://www.dogma.co.jp/13-download',
    },
  ];

  for (const entry of cases) {
    assert.equal(resolveSiteAdapter({ host: entry.host }).id, entry.adapter.id);
    assert.equal(
      entry.adapter.inferPageType({
        pathname: entry.page[0],
        hostname: entry.host,
        siteProfile: { host: entry.host },
      }),
      entry.page[1],
    );

    if (entry.acceptedUrl) {
      assertApiGate(entry.adapter, entry);
    } else {
      const rejected = entry.adapter.validateApiCandidate({
        candidate: candidate(`${entry.adapter.id}-rejected`, entry.siteKey, 'GET', entry.rejectedUrl),
      });
      assert.equal(rejected.decision, 'rejected');
    }
  }

  assert.equal(rookieAdapter.inferPageType({ pathname: '/recruit/1' }), 'utility-page');
  assert.equal(s1Adapter.inferPageType({ pathname: '/works/list/genre/215' }), 'category-page');
  assert.equal(s1Adapter.inferPageType({ pathname: '/top' }), 'category-page');
  assert.equal(jableAdapter.inferPageType({ pathname: '/videos/abc-123/' }), 'book-detail-page');
  assert.equal(jableAdapter.inferPageType({ pathname: '/tags/library/' }), 'category-page');
  assert.equal(tPowersAdapter.inferPageType({ pathname: '/recruit/contact' }), 'utility-page');
  assert.equal(soAgentAdapter.inferPageType({ pathname: '/model/mino_suzume/' }), 'author-page');
  assert.equal(soAgentAdapter.inferPageType({ pathname: '/news.php' }), 'category-page');
  assert.equal(attackersAdapter.inferPageType({ pathname: '/actress' }), 'author-list-page');
  assert.equal(kmProduceAdapter.inferPageType({ pathname: '/kmp_movies' }), 'category-page');
  assert.equal(madonnaAdapter.inferPageType({ pathname: '/privacy' }), 'utility-page');
  assert.equal(maxingAdapter.inferPageType({ pathname: '/shop/sr/123.html' }), 'search-results-page');
  assert.equal(maxingAdapter.inferPageType({ pathname: '/event/2026-05.html' }), 'utility-page');
  assert.equal(dahliaAdapter.inferPageType({ inputUrl: 'https://dahlia-av.jp/?s=query' }), 'search-results-page');
  assert.equal(oneTwoThreeAvAdapter.inferPageType({ pathname: '/zh/v/example-slug' }), 'book-detail-page');
  assert.equal(oneTwoThreeAvAdapter.inferPageType({ pathname: '/zh/tags/sample' }), 'category-page');
  assert.equal(oneTwoThreeAvAdapter.inferPageType({ pathname: '/zh/dm9/weekly-hot' }), 'category-page');
  assert.equal(oneTwoThreeAvAdapter.inferPageType({ pathname: '/zh/actresses' }), 'author-list-page');
  assert.equal(oneTwoThreeAvAdapter.inferPageType({ pathname: '/zh/actresses/sample' }), 'author-page');
  assert.equal(oneTwoThreeAvAdapter.inferPageType({ pathname: '/zh/search' }), 'search-results-page');
  assert.equal(oneTwoThreeAvAdapter.inferPageType({ pathname: '/zh/2257' }), 'utility-page');
  assert.equal(
    oneTwoThreeAvAdapter.normalizeDisplayLabel({
      value: 'Sensitive source title must not echo',
      url: 'https://123av.com/zh/v/example-slug',
      pageType: 'book-detail-page',
    }),
    '影片详情',
  );
});

test('weibo adapter exposes social page-type inference and read-only API gates', () => {
  assert.equal(resolveSiteAdapter({ host: 'weibo.com' }).id, 'weibo');
  assert.equal(resolveSiteAdapter({ host: 's.weibo.com' }).id, 'weibo');

  assert.equal(weiboAdapter.inferPageType({ pathname: '/', hostname: 'weibo.com' }), 'home');
  assert.equal(weiboAdapter.inferPageType({ pathname: '/u/123456', hostname: 'weibo.com' }), 'author-page');
  assert.equal(weiboAdapter.inferPageType({ pathname: '/n/example', hostname: 'weibo.com' }), 'author-page');
  assert.equal(weiboAdapter.inferPageType({ pathname: '/123456/ABCDefGhI', hostname: 'weibo.com' }), 'content-detail-page');
  assert.equal(weiboAdapter.inferPageType({ inputUrl: 'https://s.weibo.com/weibo?q=test', hostname: 's.weibo.com' }), 'search-results-page');
  assert.equal(weiboAdapter.inferPageType({ pathname: '/messages', hostname: 'weibo.com' }), 'message-page');
  assert.equal(weiboAdapter.inferPageType({ pathname: '/notifications', hostname: 'weibo.com' }), 'notification-page');
  assert.equal(weiboAdapter.inferPageType({ pathname: '/settings/account', hostname: 'weibo.com' }), 'settings-page');
  assert.equal(weiboAdapter.inferPageType({ pathname: '/compose', hostname: 'weibo.com' }), 'write-entry-disabled');

  assertApiGate(weiboAdapter, {
    siteKey: 'weibo',
    acceptedUrl: 'https://weibo.com/ajax/statuses/mymblog?uid=123456',
    rejectedUrl: 'https://weibo.com/u/123456',
  });
});

test('instagram adapter exposes authenticated social page-type inference and read-only API gates', () => {
  assert.equal(resolveSiteAdapter({ host: 'www.instagram.com' }).id, 'instagram');
  assert.equal(resolveSiteAdapter({ host: 'instagram.com' }).id, 'instagram');

  assert.equal(instagramAdapter.inferPageType({ pathname: '/', hostname: 'www.instagram.com' }), 'home');
  assert.equal(instagramAdapter.inferPageType({ pathname: '/accounts/login/', hostname: 'www.instagram.com' }), 'auth-page');
  assert.equal(instagramAdapter.inferPageType({ pathname: '/accounts/activity/', hostname: 'www.instagram.com' }), 'notification-page');
  assert.equal(instagramAdapter.inferPageType({ pathname: '/accounts/edit/', hostname: 'www.instagram.com' }), 'settings-page');
  assert.equal(instagramAdapter.inferPageType({ pathname: '/direct/inbox/', hostname: 'www.instagram.com' }), 'message-page');
  assert.equal(instagramAdapter.inferPageType({ pathname: '/explore/search/', hostname: 'www.instagram.com' }), 'search-results-page');
  assert.equal(instagramAdapter.inferPageType({ pathname: '/explore/tags/siteforge/', hostname: 'www.instagram.com' }), 'category-page');
  assert.equal(instagramAdapter.inferPageType({ pathname: '/openai/', hostname: 'www.instagram.com' }), 'author-page');
  assert.equal(instagramAdapter.inferPageType({ pathname: '/openai/reels/', hostname: 'www.instagram.com' }), 'author-page');
  assert.equal(instagramAdapter.inferPageType({ pathname: '/openai/following/', hostname: 'www.instagram.com' }), 'author-list-page');
  assert.equal(instagramAdapter.inferPageType({ pathname: '/p/ABC123/', hostname: 'www.instagram.com' }), 'content-detail-page');
  assert.equal(instagramAdapter.inferPageType({ pathname: '/reel/ABC123/', hostname: 'www.instagram.com' }), 'content-detail-page');
  assert.equal(instagramAdapter.inferPageType({ pathname: '/stories/openai/123456/', hostname: 'www.instagram.com' }), 'content-detail-page');

  assertApiGate(instagramAdapter, {
    siteKey: 'instagram',
    acceptedUrl: 'https://www.instagram.com/api/v1/users/web_profile_info/?username=openai',
    rejectedUrl: 'https://www.instagram.com/openai/',
  });
});
