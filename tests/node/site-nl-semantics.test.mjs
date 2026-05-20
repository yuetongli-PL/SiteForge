import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSiteNlSemantics } from '../../src/sites/registry/core/nl-site-semantics.mjs';

function createDeps() {
  return {
    INTENT_LANGUAGE_LABELS: {},
    ELEMENT_KIND_LABELS: {},
    ZH_STATUS_QUERY_EXAMPLES: {},
    ZH_SEARCH_VERBS: ['搜索'],
    ZH_OPEN_VERBS: ['打开'],
    createSha256(value) {
      return `hash_${value}`;
    },
    cleanDisplayText(value) {
      return String(value ?? '').trim();
    },
  };
}

test('resolveSiteNlSemantics returns the moodyz site hook via canonical site identity', () => {
  const semantics = resolveSiteNlSemantics({
    baseUrl: 'https://moodyz.com/works/detail/example',
    deps: createDeps(),
  });

  assert.equal(semantics?.siteKey, 'moodyz');
  assert.ok(Array.isArray(semantics?.searchVerbTerms));
  assert.equal(typeof semantics?.buildGeneratedPatternExamples, 'function');
});

test('resolveSiteNlSemantics returns the jable site hook and exposes taxonomy aliases', () => {
  const semantics = resolveSiteNlSemantics({
    baseUrl: 'https://jable.tv/tags/cosplay/',
    deps: createDeps(),
  });

  assert.equal(semantics?.siteKey, 'jable');
  assert.equal(typeof semantics?.targetAliases, 'function');
  const aliases = semantics.targetAliases('Cosplay', 'tag');
  assert.ok(aliases.includes('Cosplay'));
  assert.ok(aliases.includes('#Cosplay'));
});

test('resolveSiteNlSemantics returns the xiaohongshu site hook with note, notify, discover, and follow phrasing', () => {
  const semantics = resolveSiteNlSemantics({
    baseUrl: 'https://www.xiaohongshu.com/explore',
    deps: createDeps(),
  });

  assert.equal(semantics?.siteKey, 'xiaohongshu');
  assert.equal(semantics?.intentLabels?.['search-book']?.canonical, '搜索笔记');
  assert.equal(semantics?.intentLabels?.['download-book']?.canonical, '下载笔记');
  assert.equal(semantics?.intentLabels?.['open-category']?.canonical, '打开发现页');
  assert.equal(semantics?.intentLabels?.['open-utility-page']?.canonical, '打开通知页');
  assert.equal(semantics?.intentLabels?.['list-followed-users']?.canonical, '查询关注用户列表');
  assert.equal(semantics?.intentLabels?.['list-followed-updates']?.canonical, '查询关注用户最近更新');
  assert.equal(typeof semantics?.buildGeneratedPatternExamples, 'function');
  assert.equal(typeof semantics?.rewriteClarificationRule, 'function');
});
