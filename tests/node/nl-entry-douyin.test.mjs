import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSiteSemantics } from '../../src/entrypoints/pipeline/nl-entry.mjs';

test('nl-entry resolves douyin site semantics', () => {
  const semantics = resolveSiteSemantics('https://www.douyin.com/', {
    inputUrl: 'https://www.douyin.com/',
  });

  assert.equal(semantics.siteKey, 'douyin');
  assert.equal(semantics.intentLabels['search-video'].canonical, '\u641c\u7d22\u89c6\u9891');
  assert.equal(semantics.intentLabels['open-video'].canonical, '\u6253\u5f00\u89c6\u9891');
  assert.equal(semantics.intentLabels['open-author'].canonical, '\u6253\u5f00\u7528\u6237\u4e3b\u9875');
  assert.equal(semantics.intentLabels['list-followed-users'].canonical, '\u67e5\u8be2\u5173\u6ce8\u7528\u6237\u5217\u8868');
  assert.equal(semantics.intentLabels['list-followed-updates'].canonical, '\u67e5\u8be2\u5173\u6ce8\u66f4\u65b0\u89c6\u9891');
  assert.equal(semantics.elementLabels['content-link-group'].canonical, '\u89c6\u9891');
  assert.equal(semantics.elementLabels['author-link-group'].canonical, '\u7528\u6237');
  assert.match(semantics.searchQueryNouns.join(','), /\u89c2\u770b\u5386\u53f2/u);
});
