import test from 'node:test';
import assert from 'node:assert/strict';

import { displayIntentName, resolveSiteTerminology } from '../../src/sites/core/terminology.mjs';

test('resolveSiteTerminology returns douyin video and user labels', () => {
  const terms = resolveSiteTerminology({ host: 'www.douyin.com' }, 'https://www.douyin.com/');
  assert.equal(terms.entityLabel, '视频');
  assert.equal(terms.personLabel, '用户');
  assert.equal(terms.searchLabel, '搜索视频');
  assert.equal(terms.openPersonLabel, '打开用户主页');
});

test('displayIntentName localizes douyin intents', () => {
  assert.equal(displayIntentName('search-video', { host: 'www.douyin.com' }, 'https://www.douyin.com/'), '搜索视频');
  assert.equal(displayIntentName('open-video', { host: 'www.douyin.com' }, 'https://www.douyin.com/'), '打开视频');
  assert.equal(displayIntentName('open-author', { host: 'www.douyin.com' }, 'https://www.douyin.com/'), '打开用户主页');
  assert.equal(displayIntentName('open-category', { host: 'www.douyin.com' }, 'https://www.douyin.com/'), '打开分类页');
});
