import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { readJsonFile } from '../../src/infra/io.mjs';
import { inferPageTypeFromUrl, isContentDetailPageType, resolveConfiguredPageTypes, toSemanticPageType } from '../../src/sites/core/page-types.mjs';

test('inferPageTypeFromUrl recognizes bilibili cross-host search, detail, and author pages', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.bilibili.com.json'));

  assert.equal(
    inferPageTypeFromUrl('https://search.bilibili.com/all?keyword=%E5%8E%9F%E7%A5%9E', siteProfile),
    'search-results-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://search.bilibili.com/video?keyword=BV1WjDDBGE3p', siteProfile),
    'search-results-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://search.bilibili.com/bangumi?keyword=%E7%95%AA%E5%89%A7', siteProfile),
    'search-results-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://search.bilibili.com/upuser?keyword=%E6%95%99%E7%A8%8B', siteProfile),
    'search-results-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://www.bilibili.com/video/BV1WjDDBGE3p', siteProfile),
    'book-detail-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://www.bilibili.com/bangumi/play/ep508404', siteProfile),
    'book-detail-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://space.bilibili.com/1202350411', siteProfile),
    'author-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://space.bilibili.com/1202350411/video', siteProfile),
    'author-list-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://space.bilibili.com/1202350411/upload/video', siteProfile),
    'author-list-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://space.bilibili.com/1202350411/dynamic', siteProfile),
    'author-list-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://space.bilibili.com/1202350411/fans/follow', siteProfile),
    'author-list-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://www.bilibili.com/v/popular/all/', siteProfile),
    'category-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://www.bilibili.com/anime/', siteProfile),
    'category-page',
  );
});

test('inferPageTypeFromUrl recognizes Douyin public, authenticated, and category routes', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.douyin.com.json'));

  assert.equal(
    inferPageTypeFromUrl('https://www.douyin.com/?recommend=1', siteProfile),
    'home',
  );
  assert.equal(
    inferPageTypeFromUrl('https://www.douyin.com/search/%E6%96%B0%E9%97%BB', siteProfile),
    'search-results-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://www.douyin.com/video/7487317288315258152', siteProfile),
    'book-detail-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://www.douyin.com/shipin/', siteProfile),
    'category-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://www.douyin.com/shipin/7487317288315258152', siteProfile),
    'book-detail-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://www.douyin.com/user/MS4wLjABAAAA_douyin_public_author', siteProfile),
    'author-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://www.douyin.com/user/MS4wLjABAAAA_douyin_public_author?showTab=post', siteProfile),
    'author-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://www.douyin.com/user/self?showTab=like', siteProfile),
    'author-list-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://www.douyin.com/user/self?showTab=collect', siteProfile),
    'author-list-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://www.douyin.com/follow?tab=feed', siteProfile),
    'author-list-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://www.douyin.com/follow?tab=user', siteProfile),
    'author-list-page',
  );
});

test('inferPageTypeFromUrl uses adapter-aware Jable model routes while keeping profile-configured routes', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/jable.tv.json'));

  assert.equal(
    inferPageTypeFromUrl('https://jable.tv/models/', siteProfile),
    'author-list-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://jable.tv/models/123', siteProfile),
    'author-list-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://jable.tv/models/meguri', siteProfile),
    'author-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://jable.tv/videos/ipx-238-c/', siteProfile),
    'book-detail-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://jable.tv/search/MOMO/', siteProfile),
    'search-results-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://jable.tv/categories/chinese-subtitle/', siteProfile),
    'category-page',
  );
});

test('inferPageTypeFromUrl preserves legacy chapter-content route fallbacks', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.22biqu.com.json'));

  assert.equal(
    inferPageTypeFromUrl('https://www.22biqu.com/', siteProfile),
    'home',
  );
  assert.equal(
    inferPageTypeFromUrl('https://www.22biqu.com/ss/%E7%8E%84%E9%89%B4%E4%BB%99%E6%97%8F.html', siteProfile),
    'search-results-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://www.22biqu.com/biqu5735/', siteProfile),
    'book-detail-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://www.22biqu.com/author/123.html', siteProfile),
    'author-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://www.22biqu.com/biqu5735/10482970.html', siteProfile),
    'chapter-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://www.22biqu.com/history.html', siteProfile),
    'history-page',
  );
  assert.equal(
    inferPageTypeFromUrl('https://www.22biqu.com/login.php', siteProfile),
    'auth-page',
  );
});

test('content-detail alias keeps legacy detail page outputs compatible', () => {
  assert.equal(isContentDetailPageType('book-detail-page'), true);
  assert.equal(isContentDetailPageType('content-detail-page'), true);
  assert.equal(isContentDetailPageType('author-page'), false);
  assert.equal(toSemanticPageType('book-detail-page'), 'content-detail-page');
  assert.equal(toSemanticPageType('content-detail-page'), 'content-detail-page');
  assert.equal(toSemanticPageType('search-results-page'), 'search-results-page');
});

test('resolveConfiguredPageTypes exposes both legacy and semantic detail page types', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.bilibili.com.json'));
  const pageTypes = resolveConfiguredPageTypes(siteProfile);

  assert.ok(pageTypes.includes('book-detail-page'));
  assert.ok(pageTypes.includes('content-detail-page'));
  assert.ok(pageTypes.includes('author-page'));
});

test('resolveConfiguredPageTypes exposes Douyin author-list and detail page types', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.douyin.com.json'));
  const pageTypes = resolveConfiguredPageTypes(siteProfile);

  assert.ok(pageTypes.includes('home'));
  assert.ok(pageTypes.includes('search-results-page'));
  assert.ok(pageTypes.includes('book-detail-page'));
  assert.ok(pageTypes.includes('content-detail-page'));
  assert.ok(pageTypes.includes('author-page'));
  assert.ok(pageTypes.includes('author-list-page'));
  assert.ok(pageTypes.includes('category-page'));
});
