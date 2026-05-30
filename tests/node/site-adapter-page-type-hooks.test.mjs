import test from 'node:test';
import assert from 'node:assert/strict';

import { attackersAdapter } from '../../src/sites/adapters/attackers.mjs';
import { bilibiliAdapter } from '../../src/sites/adapters/bilibili.mjs';
import { dahliaAdapter } from '../../src/sites/adapters/dahlia.mjs';
import { dogmaAdapter } from '../../src/sites/adapters/dogma.mjs';
import { douyinAdapter } from '../../src/sites/adapters/douyin.mjs';
import { eightmanAdapter } from '../../src/sites/adapters/eightman.mjs';
import { jableAdapter } from '../../src/sites/adapters/jable.mjs';
import { kmProduceAdapter } from '../../src/sites/adapters/km-produce.mjs';
import { madonnaAdapter } from '../../src/sites/adapters/madonna.mjs';
import { maxingAdapter } from '../../src/sites/adapters/maxing.mjs';
import { moodyzAdapter } from '../../src/sites/adapters/moodyz.mjs';
import { rookieAdapter } from '../../src/sites/adapters/rookie.mjs';
import { s1Adapter } from '../../src/sites/adapters/s1.mjs';
import { sodAdapter } from '../../src/sites/adapters/sod.mjs';
import { tPowersAdapter } from '../../src/sites/adapters/t-powers.mjs';
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
      adapter: tPowersAdapter,
      host: 'www.t-powers.co.jp',
      siteKey: 't-powers',
      page: ['/talent', 'author-list-page'],
      acceptedUrl: 'https://www.t-powers.co.jp/wp-json/wp/v2/posts',
      rejectedUrl: 'https://www.t-powers.co.jp/release/',
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
  assert.equal(attackersAdapter.inferPageType({ pathname: '/actress' }), 'author-list-page');
  assert.equal(kmProduceAdapter.inferPageType({ pathname: '/kmp_movies' }), 'category-page');
  assert.equal(madonnaAdapter.inferPageType({ pathname: '/privacy' }), 'utility-page');
  assert.equal(maxingAdapter.inferPageType({ pathname: '/shop/sr/123.html' }), 'search-results-page');
  assert.equal(maxingAdapter.inferPageType({ pathname: '/event/2026-05.html' }), 'utility-page');
  assert.equal(dahliaAdapter.inferPageType({ inputUrl: 'https://dahlia-av.jp/?s=query' }), 'search-results-page');
});
