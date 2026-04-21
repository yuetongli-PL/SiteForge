import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSiteNlSemantics } from '../../src/sites/core/nl-site-semantics.mjs';

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
