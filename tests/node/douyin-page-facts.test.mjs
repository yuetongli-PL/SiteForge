import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { readJsonFile } from '../../src/infra/io.mjs';
import { derivePageFacts } from '../../src/entrypoints/pipeline/expand-states.mjs';
import { diagnoseDouyinSurfaceState } from '../../src/sites/douyin/model/diagnosis.mjs';

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

test('derivePageFacts extracts Douyin public author works with full-card counts and completeness', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.douyin.com.json'));
  const readers = createSelectorReaders({
    textMap: {
      h1: 'Sample Creator',
    },
    textsMap: {
      'a[href*="/video/"]': ['Video One', 'Video Two'],
    },
    hrefsMap: {
      'a[href*="/video/"]': [
        'https://www.douyin.com/video/7487317288315258152',
        'https://www.douyin.com/video/7487317288315258153',
      ],
    },
  });

  const facts = derivePageFacts({
    pageType: 'author-page',
    siteProfile,
    finalUrl: 'https://www.douyin.com/user/MS4wLjABAAAAexample',
    title: 'Sample Creator - Douyin',
    documentText: 'Sample Creator no more content',
    rawHtml: '<script>{"awemeId":"7487317288315258152","createTime":1776450600}{"awemeId":"7487317288315258153","createTime":1776537000}</script>',
    ...readers,
  });

  assert.equal(facts.authorName, 'Sample Creator');
  assert.equal(facts.authorUrl, 'https://www.douyin.com/user/MS4wLjABAAAAexample');
  assert.equal(facts.authorSubpage, 'home');
  assert.equal(facts.featuredContentCount, 2);
  assert.equal(facts.featuredContentComplete, true);
  assert.deepEqual(facts.featuredContentTitles, ['Video One', 'Video Two']);
  assert.deepEqual(facts.featuredContentVideoIds, ['7487317288315258152', '7487317288315258153']);
  assert.equal(facts.featuredContentCards[0].publishedAt, '2026-04-17T18:30:00.000Z');
  assert.equal(facts.featuredContentCards[0].publishedDayKey, '2026-04-18');
  assert.deepEqual(facts.featuredContentPublishedDayKeys, ['2026-04-18', '2026-04-19']);
});

test('derivePageFacts extracts Douyin follow-users surfaces as author cards', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.douyin.com.json'));
  const readers = createSelectorReaders({
    textMap: {
      h1: 'Following',
    },
    textsMap: {
      'a[href*="/user/"]': ['User A', 'User B'],
    },
    hrefsMap: {
      'a[href*="/user/"]': [
        'https://www.douyin.com/user/MS4wLjABAAAAfollowA',
        'https://www.douyin.com/user/MS4wLjABAAAAfollowB',
      ],
    },
  });

  const facts = derivePageFacts({
    pageType: 'author-list-page',
    siteProfile,
    finalUrl: 'https://www.douyin.com/follow?tab=user',
    title: 'Following - Douyin',
    documentText: 'Following no more users',
    ...readers,
  });

  assert.equal(facts.authorSubpage, 'follow-users');
  assert.equal(facts.featuredAuthorCount, 2);
  assert.equal(facts.featuredAuthorComplete, true);
  assert.deepEqual(facts.featuredAuthorNames, ['User A', 'User B']);
  assert.deepEqual(facts.featuredAuthorUserIds, ['MS4wLjABAAAAfollowA', 'MS4wLjABAAAAfollowB']);
});

test('derivePageFacts detects Douyin anti-crawl challenges on authenticated surfaces', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.douyin.com.json'));

  const facts = derivePageFacts({
    pageType: 'author-list-page',
    siteProfile,
    finalUrl: 'https://www.douyin.com/user/self?showTab=like',
    title: '验证码中间页',
    documentText: '验证码中间页 middle_page_loading',
  });

  assert.equal(facts.authorSubpage, 'like');
  assert.equal(facts.antiCrawlDetected, true);
  assert.deepEqual(facts.antiCrawlSignals, ['challenge', 'middle-page-loading', 'verify']);
  assert.equal(facts.antiCrawlReasonCode, 'anti-crawl-verify');
});

test('derivePageFacts normalizes Douyin record subpages as history', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.douyin.com.json'));

  const facts = derivePageFacts({
    pageType: 'author-list-page',
    siteProfile,
    finalUrl: 'https://www.douyin.com/user/self?showTab=record',
    title: 'History - Douyin',
    documentText: 'History',
  });

  assert.equal(facts.authorSubpage, 'history');
});

test('derivePageFacts ignores Douyin self-nav author links on content detail pages', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.douyin.com.json'));
  const readers = createSelectorReaders({
    textMap: {
      h1: 'Sample Video',
      'a[href*="/user/"]:not([href*="/user/self"])': 'Real Author',
    },
    hrefMap: {
      'a[href*="/user/"]:not([href*="/user/self"])': 'https://www.douyin.com/user/MS4wLjABAAAArealAuthor',
    },
  });

  const facts = derivePageFacts({
    pageType: 'content-detail-page',
    siteProfile,
    finalUrl: 'https://www.douyin.com/video/7487317288315258152',
    title: 'Sample Video - Douyin',
    documentText: 'Sample Video',
    ...readers,
  });

  assert.equal(facts.authorUrl, 'https://www.douyin.com/user/MS4wLjABAAAArealAuthor');
  assert.equal(facts.authorUserId, 'MS4wLjABAAAArealAuthor');
  assert.equal(facts.authorName, 'Real Author');
});

test('derivePageFacts extracts Douyin embedded author info from encoded SSR payloads', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.douyin.com.json'));

  const facts = derivePageFacts({
    pageType: 'content-detail-page',
    siteProfile,
    finalUrl: 'https://www.douyin.com/video/7487317288315258152',
    title: 'Sample Video - Douyin',
    documentText: 'Sample Video',
    rawHtml: '<script>var payload="%22nickname%22%3A%22yuetong.l%22%2C%22sec_uid%22%3A%22MS4wLjABAAAAD_rgoQxZRb5ZZdRaJIEEaRVq2h3_1YwTXfUhFGJPDhL0-oL-nDOYSn-y_wsCnjsZ%22";</script>',
  });

  assert.equal(facts.authorName, 'yuetong.l');
  assert.equal(facts.authorUserId, 'MS4wLjABAAAAD_rgoQxZRb5ZZdRaJIEEaRVq2h3_1YwTXfUhFGJPDhL0-oL-nDOYSn-y_wsCnjsZ');
  assert.equal(facts.authorUrl, 'https://www.douyin.com/user/MS4wLjABAAAAD_rgoQxZRb5ZZdRaJIEEaRVq2h3_1YwTXfUhFGJPDhL0-oL-nDOYSn-y_wsCnjsZ');
});

test('derivePageFacts reads Douyin path-based search keywords', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.douyin.com.json'));

  const facts = derivePageFacts({
    pageType: 'search-results-page',
    siteProfile,
    finalUrl: 'https://www.douyin.com/search/%E6%96%B0%E9%97%BB?type=general',
    title: '新闻 - Douyin Search',
    documentText: '新闻',
  });

  assert.equal(facts.queryText, '新闻');
  assert.equal(facts.searchSection, 'general');
});

test('diagnoseDouyinSurfaceState treats authenticated empty follow-feed surfaces as valid', () => {
  const diagnosis = diagnoseDouyinSurfaceState({
    pageType: 'author-list-page',
    pageFacts: {
      authorSubpage: 'follow-feed',
      loginStateDetected: true,
      identityConfirmed: true,
      authenticatedSessionConfirmed: true,
      featuredAuthorCount: 0,
      featuredContentCount: 0,
    },
  }, {
    authRequired: true,
    authAvailable: true,
  });

  assert.equal(diagnosis.reasonCode, 'ok');
  assert.equal(diagnosis.emptyShell, false);
});
