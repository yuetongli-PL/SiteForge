import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CANONICAL_CAPABILITY_FAMILIES,
  CANONICAL_SUPPORTED_INTENTS,
  explainCapabilityIntentMapping,
  policySupportsCapabilityFamily,
  resolveCapabilityFamilyForIntent,
} from '../../src/sites/registry/core/capability-intent-mapping.mjs';

test('canonical supported intents resolve to declared capability families', () => {
  const families = [...CANONICAL_CAPABILITY_FAMILIES];

  for (const intent of CANONICAL_SUPPORTED_INTENTS) {
    assert.ok(
      resolveCapabilityFamilyForIntent(intent, families, { allowFallback: false }),
      `${intent} should map to a canonical capability family`,
    );
  }
});

test('capability family as intent keeps exact-match compatibility', () => {
  const family = resolveCapabilityFamilyForIntent('query-social-content', ['query-social-content'], {
    allowFallback: false,
  });

  assert.equal(family, 'query-social-content');
  assert.deepEqual(explainCapabilityIntentMapping('query-social-content', ['query-social-content']), {
    status: 'mapped',
    intent: 'query-social-content',
    capabilityFamily: 'query-social-content',
    reason: 'exact-family-match',
  });
});

test('search-posts prefers search-content and falls back to query-social-content', () => {
  assert.equal(
    resolveCapabilityFamilyForIntent('search-posts', ['query-social-content', 'search-content'], {
      allowFallback: false,
    }),
    'search-content',
  );
  assert.equal(
    resolveCapabilityFamilyForIntent('search-posts', ['query-social-content'], {
      allowFallback: false,
    }),
    'query-social-content',
  );
});

test('unknown intents fail strict resolution but keep runtime fallback compatibility', () => {
  assert.equal(
    resolveCapabilityFamilyForIntent('custom-local-intent', ['search-content'], { allowFallback: false }),
    null,
  );
  assert.equal(
    resolveCapabilityFamilyForIntent('custom-local-intent', ['search-content']),
    'search-content',
  );
});

test('policy family support derives from declared families and mapped intents', () => {
  assert.equal(policySupportsCapabilityFamily({
    capabilityFamilies: ['query-social-relations'],
    supportedIntents: ['list-followed-users'],
  }, 'query-social-relations'), true);

  assert.equal(policySupportsCapabilityFamily({
    capabilityFamilies: ['query-social-content'],
    supportedIntents: ['search-posts'],
  }, 'query-social-content'), true);

  assert.equal(policySupportsCapabilityFamily({
    capabilityFamilies: ['search-content'],
    supportedIntents: ['list-followed-users'],
  }, 'query-social-relations'), false);
});
