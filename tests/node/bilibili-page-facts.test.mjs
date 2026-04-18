import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { readJsonFile } from '../../lib/io.mjs';
import { derivePageFacts } from '../../expand-states.mjs';

function createSelectorReaders({ textMap = {}, hrefMap = {}, textsMap = {}, hrefsMap = {}, metaMap = {} } = {}) {
  return {
    textFromSelectors(selectors) {
      for (const selector of selectors) {
        const value = textMap[selector];
        if (value) {
          return value;
        }
      }
      return null;
    },
    hrefFromSelectors(selectors) {
      for (const selector of selectors) {
        const value = hrefMap[selector];
        if (value) {
          return value;
        }
      }
      return null;
    },
    textsFromSelectors(selectors) {
      for (const selector of selectors) {
        const value = textsMap[selector];
        if (value) {
          return value;
        }
      }
      return [];
    },
    hrefsFromSelectors(selectors) {
      for (const selector of selectors) {
        const value = hrefsMap[selector];
        if (value) {
          return value;
        }
      }
      return [];
    },
    metaContent(name) {
      return metaMap[name] ?? null;
    },
  };
}

test('bilibili profile keeps stable search selectors and validation samples', async () => {
  const profile = await readJsonFile(path.resolve('profiles/www.bilibili.com.json'));

  assert.equal(profile.host, 'www.bilibili.com');
  assert.equal(profile.archetype, 'navigation-catalog');
  assert.ok(profile.search.formSelectors.includes('form#nav-searchform'));
  assert.ok(profile.search.inputSelectors.includes('input[name="keyword"]'));
  assert.ok(profile.search.resultBookSelectors.includes('a[href*="/bangumi/play/"]'));
  assert.deepEqual(profile.pageTypes.searchResultsPrefixes, ['/all', '/video', '/bangumi', '/upuser']);
  assert.deepEqual(profile.navigation.authorListPathPrefixes, ['/video', '/upload/video', '/dynamic', '/fans/follow', '/fans/fans']);
  assert.equal(profile.validationSamples.videoSearchQuery, 'BV1WjDDBGE3p');
  assert.equal(profile.validationSamples.videoDetailUrl, 'https://www.bilibili.com/video/BV1WjDDBGE3p/');
  assert.equal(profile.validationSamples.authorVideosUrl, 'https://space.bilibili.com/1202350411/video');
  assert.equal(profile.validationSamples.authorDynamicUrl, 'https://space.bilibili.com/1202350411/dynamic');
  assert.equal(profile.validationSamples.categoryPopularUrl, 'https://www.bilibili.com/v/popular/all/');
  assert.equal(profile.validationSamples.categoryAnimeUrl, 'https://www.bilibili.com/anime/');
  assert.equal(profile.validationSamples.bangumiDetailUrl, 'https://www.bilibili.com/bangumi/play/ep508404');
  assert.equal(profile.authValidationSamples.dynamicUrl, 'https://space.bilibili.com/1202350411/dynamic');
  assert.equal(profile.authValidationSamples.followListUrl, 'https://space.bilibili.com/1202350411/fans/follow');
  assert.equal(profile.authValidationSamples.fansListUrl, 'https://space.bilibili.com/1202350411/fans/fans');
  assert.equal(profile.authSession.loginUrl, 'https://passport.bilibili.com/login');
});

test('derivePageFacts normalizes bilibili title fallbacks for content and author pages', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.bilibili.com.json'));

  const detailFacts = derivePageFacts({
    pageType: 'book-detail-page',
    siteProfile,
    finalUrl: 'https://www.bilibili.com/video/BV1WjDDBGE3p',
    title: 'Test Video Title-哔哩哔哩_bilibili',
  });
  assert.equal(detailFacts.contentTitle, 'Test Video Title');
  assert.equal(detailFacts.bookTitle, 'Test Video Title');

  const authorFacts = derivePageFacts({
    pageType: 'author-page',
    siteProfile,
    finalUrl: 'https://space.bilibili.com/1202350411',
    title: '君在西安的个人空间-君在西安个人主页-哔哩哔哩视频',
  });
  assert.equal(authorFacts.authorName, '君在西安');
});

test('derivePageFacts extracts stronger bilibili video-search facts', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.bilibili.com.json'));
  const readers = createSelectorReaders({
    textsMap: {
      'a[href*="//www.bilibili.com/video/"]': ['Video One', 'Video Two'],
    },
    hrefsMap: {
      'a[href*="//www.bilibili.com/video/"]': [
        'https://www.bilibili.com/video/BV1WjDDBGE3p',
        'https://www.bilibili.com/video/BV1uT41147VW',
      ],
      'a[href*="//space.bilibili.com/"]': [
        'https://space.bilibili.com/1202350411',
      ],
    },
  });

  const facts = derivePageFacts({
    pageType: 'search-results-page',
    siteProfile,
    finalUrl: 'https://search.bilibili.com/video?keyword=BV1WjDDBGE3p',
    title: 'BV1WjDDBGE3p - bilibili',
    queryInputValue: 'BV1WjDDBGE3p',
    ...readers,
  });

  assert.equal(facts.queryText, 'BV1WjDDBGE3p');
  assert.equal(facts.searchSection, 'video');
  assert.equal(facts.resultCount, 2);
  assert.deepEqual(facts.resultTitles, ['Video One', 'Video Two']);
  assert.deepEqual(facts.resultContentTypes, ['video', 'video']);
  assert.deepEqual(facts.resultAuthorUrls, ['https://space.bilibili.com/1202350411']);
  assert.deepEqual(facts.resultAuthorMids, ['1202350411']);
  assert.deepEqual(facts.resultBvids, ['BV1WjDDBGE3p', 'BV1uT41147VW']);
  assert.equal(facts.firstResultUrl, 'https://www.bilibili.com/video/BV1WjDDBGE3p');
  assert.equal(facts.firstResultContentType, 'video');
  assert.equal(facts.resultEntries[0]?.title, 'Video One');
  assert.equal(facts.resultEntries[0]?.bvid, 'BV1WjDDBGE3p');
  assert.equal(facts.resultEntries[0]?.authorMid, '1202350411');
});

test('derivePageFacts extracts bilibili search sub-scenario facts for bangumi and UP results', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.bilibili.com.json'));
  const readers = createSelectorReaders({
    hrefsMap: {
      'a[href*="//www.bilibili.com/video/"]': [
        'https://www.bilibili.com/bangumi/play/ep508404',
      ],
      'a[href*="//space.bilibili.com/"]': [
        'https://space.bilibili.com/1202350411',
        'https://space.bilibili.com/987654321',
      ],
    },
  });

  const facts = derivePageFacts({
    pageType: 'search-results-page',
    siteProfile,
    finalUrl: 'https://search.bilibili.com/bangumi?keyword=bangumi',
    title: 'bangumi search - bilibili',
    queryInputValue: 'bangumi',
    ...readers,
  });

  assert.equal(facts.searchSection, 'bangumi');
  assert.deepEqual(facts.resultContentTypes, ['bangumi']);
  assert.deepEqual(facts.resultAuthorUrls, [
    'https://space.bilibili.com/1202350411',
    'https://space.bilibili.com/987654321',
  ]);
  assert.deepEqual(facts.resultAuthorMids, ['1202350411', '987654321']);
});

test('derivePageFacts extracts stronger bilibili video detail facts', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.bilibili.com.json'));
  const readers = createSelectorReaders({
    textMap: {
      'h1.video-title': 'Test Video Title',
      'a.up-name': 'Test Uploader',
      '.video-info-detail a': 'Knowledge',
      time: '2026-04-16 10:00:00',
    },
    hrefMap: {
      'a.up-name[href*="space.bilibili.com/"]': 'https://space.bilibili.com/1202350411',
    },
    textsMap: {
      '.tag-link': ['Tutorial', 'Knowledge'],
    },
  });

  const facts = derivePageFacts({
    pageType: 'book-detail-page',
    siteProfile,
    finalUrl: 'https://www.bilibili.com/video/BV1WjDDBGE3p',
    title: 'Test Video Title - bilibili',
    documentText: '"aid":987654321,"bvid":"BV1WjDDBGE3p","mid":1202350411',
    ...readers,
  });

  assert.equal(facts.contentType, 'video');
  assert.equal(facts.contentTitle, 'Test Video Title');
  assert.equal(facts.bookTitle, 'Test Video Title');
  assert.equal(facts.authorName, 'Test Uploader');
  assert.equal(facts.authorUrl, 'https://space.bilibili.com/1202350411');
  assert.equal(facts.authorMid, '1202350411');
  assert.equal(facts.bvid, 'BV1WjDDBGE3p');
  assert.equal(facts.aid, '987654321');
  assert.equal(facts.publishedAt, '2026-04-16 10:00:00');
  assert.equal(facts.categoryName, 'Knowledge');
  assert.deepEqual(facts.tagNames, ['Tutorial', 'Knowledge']);
});

test('derivePageFacts extracts stronger bilibili bangumi detail facts', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.bilibili.com.json'));
  const readers = createSelectorReaders({
    textMap: {
      '.media-title': 'Test Bangumi Series',
      '.episode-title': 'Episode 3',
      'a.up-name': 'Bangumi Publisher',
      '.first-channel': 'Bangumi',
    },
    hrefMap: {
      'a.up-name[href*="space.bilibili.com/"]': 'https://space.bilibili.com/2345678901',
    },
    textsMap: {
      '.tag-link': ['Action', 'Adventure'],
    },
  });

  const facts = derivePageFacts({
    pageType: 'book-detail-page',
    siteProfile,
    finalUrl: 'https://www.bilibili.com/bangumi/play/ep508404',
    title: 'Episode 3 - bilibili',
    documentText: '"season_id":123456,"ep_id":508404,"mid":2345678901',
    ...readers,
  });

  assert.equal(facts.contentType, 'bangumi');
  assert.equal(facts.seasonId, '123456');
  assert.equal(facts.episodeId, '508404');
  assert.equal(facts.seriesTitle, 'Test Bangumi Series');
  assert.ok(facts.episodeTitle);
  assert.equal(facts.authorMid, '2345678901');
  assert.equal(facts.categoryName, 'Bangumi');
  assert.deepEqual(facts.tagNames, ['Action', 'Adventure']);
});

test('derivePageFacts extracts stronger bilibili author facts', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.bilibili.com.json'));
  const readers = createSelectorReaders({
    textMap: {
      '.nickname': 'Test Uploader',
    },
    textsMap: {
      'a[href*="//www.bilibili.com/video/"]': [
        'Video One',
        'Video Two',
      ],
    },
    hrefsMap: {
      'a[href*="//www.bilibili.com/video/"]': [
        'https://www.bilibili.com/video/BV1WjDDBGE3p',
        'https://www.bilibili.com/video/BV1uT41147VW',
      ],
    },
  });

  const facts = derivePageFacts({
    pageType: 'author-page',
    siteProfile,
    finalUrl: 'https://space.bilibili.com/1202350411',
    title: 'Test Uploader profile - bilibili',
    ...readers,
  });

  assert.equal(facts.authorName, 'Test Uploader');
  assert.equal(facts.authorMid, '1202350411');
  assert.equal(facts.authorUrl, 'https://space.bilibili.com/1202350411');
  assert.equal(facts.authorSubpage, 'home');
  assert.equal(facts.authorSubpagePath, '/1202350411');
  assert.equal(facts.featuredContentCount, 2);
  assert.deepEqual(facts.featuredContentTitles, ['Video One', 'Video Two']);
  assert.deepEqual(facts.featuredContentBvids, ['BV1WjDDBGE3p', 'BV1uT41147VW']);
});

test('derivePageFacts extracts stronger bilibili author video subpage facts', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.bilibili.com.json'));
  const readers = createSelectorReaders({
    textMap: {
      '.nickname': 'Test Uploader',
    },
    textsMap: {
      'a[href*="//www.bilibili.com/video/"]': [
        'Video One',
        'Bangumi One',
      ],
    },
    hrefsMap: {
      'a[href*="//www.bilibili.com/video/"]': [
        'https://www.bilibili.com/video/BV1WjDDBGE3p',
        'https://www.bilibili.com/bangumi/play/ep508404',
      ],
    },
  });

  const facts = derivePageFacts({
    pageType: 'author-list-page',
    siteProfile,
    finalUrl: 'https://space.bilibili.com/1202350411/video',
    title: 'Test Uploader videos - bilibili',
    ...readers,
  });

  assert.equal(facts.authorSubpage, 'video');
  assert.equal(facts.authorSubpagePath, '/1202350411/video');
  assert.equal(facts.featuredContentCount, 2);
  assert.deepEqual(facts.featuredContentTitles, ['Video One', 'Bangumi One']);
  assert.deepEqual(facts.featuredContentTypes, ['video', 'bangumi']);
});

test('derivePageFacts classifies bilibili dynamic author subpages and anti-crawl signals', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.bilibili.com.json'));

  const facts = derivePageFacts({
    pageType: 'author-list-page',
    siteProfile,
    finalUrl: 'https://space.bilibili.com/1202350411/dynamic',
    title: 'Test Uploader dynamic - bilibili',
    documentText: '访问频繁，请稍后再试，完成安全验证后继续访问',
    hrefsFromSelectors: () => ['https://www.bilibili.com/video/BV1WjDDBGE3p'],
    textsFromSelectors: () => ['Dynamic Video One'],
  });

  assert.equal(facts.authorSubpage, 'dynamic');
  assert.equal(facts.authorSubpagePath, '/1202350411/dynamic');
  assert.deepEqual(facts.featuredContentBvids, ['BV1WjDDBGE3p']);
  assert.equal(facts.antiCrawlDetected, true);
  assert.deepEqual(facts.antiCrawlSignals, ['rate-limit', 'verify', 'retry-later']);
});

test('derivePageFacts distinguishes bilibili follow and fans author subpages', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.bilibili.com.json'));

  const followFacts = derivePageFacts({
    pageType: 'author-list-page',
    siteProfile,
    finalUrl: 'https://space.bilibili.com/1202350411/fans/follow',
    title: 'Follow list - bilibili',
  });
  const fansFacts = derivePageFacts({
    pageType: 'author-list-page',
    siteProfile,
    finalUrl: 'https://space.bilibili.com/1202350411/fans/fans',
    title: 'Fans list - bilibili',
  });

  assert.equal(followFacts.authorSubpage, 'follow');
  assert.equal(followFacts.authorSubpagePath, '/1202350411/fans/follow');
  assert.equal(fansFacts.authorSubpage, 'fans');
  assert.equal(fansFacts.authorSubpagePath, '/1202350411/fans/fans');
});

test('derivePageFacts builds bilibili author-list cards and derives compatibility arrays from them', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.bilibili.com.json'));

  const facts = derivePageFacts({
    pageType: 'author-list-page',
    siteProfile,
    finalUrl: 'https://space.bilibili.com/1202350411/fans/follow',
    title: 'Follow list - bilibili',
    extractStructuredBilibiliAuthorCards() {
      return {
        authorCards: [
          {
            name: 'UP One',
            url: 'https://space.bilibili.com/2',
            mid: '2',
          },
          {
            name: 'UP Two',
            url: 'https://space.bilibili.com/364185321',
            mid: '364185321',
          },
        ],
        contentCards: [
          {
            title: 'Video One',
            url: 'https://www.bilibili.com/video/BV1WjDDBGE3p',
            bvid: 'BV1WjDDBGE3p',
            authorMid: '2',
            contentType: 'video',
          },
        ],
      };
    },
  });

  assert.equal(facts.authorSubpage, 'follow');
  assert.equal(facts.featuredAuthorCards.length, 2);
  assert.equal(facts.featuredAuthorCards[0].authorSubpage, 'follow');
  assert.deepEqual(facts.featuredAuthorNames, ['UP One', 'UP Two']);
  assert.deepEqual(facts.featuredAuthorMids, ['2', '364185321']);
  assert.equal(facts.featuredContentCards.length, 1);
  assert.deepEqual(facts.featuredContentBvids, ['BV1WjDDBGE3p']);
  assert.deepEqual(facts.featuredContentAuthorMids, ['2']);
});

test('derivePageFacts extracts stronger bilibili category facts', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.bilibili.com.json'));
  const readers = createSelectorReaders({
    hrefsMap: {
      'a[href*="//www.bilibili.com/video/"]': [
        'https://www.bilibili.com/video/BV1WjDDBGE3p',
        'https://www.bilibili.com/bangumi/play/ep508404',
      ],
      'a[href*="//www.bilibili.com/bangumi/play/"]': [
        'https://www.bilibili.com/bangumi/play/ep508404',
      ],
    },
    textsMap: {
      '.rank-item .num': ['1', '2'],
      'a[href*="//www.bilibili.com/video/"]': [
        'Hot Video',
        'Hot Bangumi',
      ],
    },
  });

  const facts = derivePageFacts({
    pageType: 'category-page',
    siteProfile,
    finalUrl: 'https://www.bilibili.com/v/popular/all/',
    title: 'Popular - bilibili',
    ...readers,
  });

  assert.ok(facts.categoryName);
  assert.equal(facts.categoryPath, '/v/popular/all/');
  assert.equal(facts.featuredContentCount, 2);
  assert.deepEqual(facts.featuredContentTitles, ['Hot Video', 'Hot Bangumi']);
  assert.deepEqual(facts.featuredContentTypes, ['video', 'bangumi']);
  assert.deepEqual(facts.featuredContentBvids, ['BV1WjDDBGE3p']);
  assert.deepEqual(facts.rankingLabels, ['1', '2']);
});
