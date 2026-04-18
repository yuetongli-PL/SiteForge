import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { readJsonFile } from '../../lib/io.mjs';
import { inferPageTypeFromUrl, isContentDetailPageType, resolveConfiguredPageTypes, toSemanticPageType } from '../../lib/sites/page-types.mjs';

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
