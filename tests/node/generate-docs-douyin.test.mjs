import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isDouyinContext,
  siteIntentTitlePrefix,
  siteIntentTypeName,
  siteTerminology,
} from '../../src/entrypoints/pipeline/generate-docs.mjs';

const context = {
  host: 'www.douyin.com',
  baseUrl: 'https://www.douyin.com/',
  url: 'https://www.douyin.com/',
};

test('generate-docs uses douyin context detection', () => {
  assert.equal(isDouyinContext(context), true);
});

test('generate-docs uses douyin terminology instead of generic book wording', () => {
  const terms = siteTerminology(context);
  assert.equal(terms.entityLabel, '视频');
  assert.equal(terms.personLabel, '用户');
  assert.equal(terms.searchLabel, '搜索视频');
  assert.equal(terms.openPersonLabel, '打开用户主页');
});

test('generate-docs remaps douyin intent labels to video and user terminology', () => {
  assert.equal(siteIntentTitlePrefix(context, 'search-book'), '搜索视频');
  assert.equal(siteIntentTitlePrefix(context, 'open-work'), '打开视频');
  assert.equal(siteIntentTitlePrefix(context, 'open-author'), '打开用户主页');
  assert.equal(siteIntentTitlePrefix(context, 'open-category'), '打开分类页');

  assert.equal(siteIntentTypeName(context, 'search-work'), 'search-video');
  assert.equal(siteIntentTypeName(context, 'open-book'), 'open-video');
  assert.equal(siteIntentTypeName(context, 'open-up'), 'open-author');
});
