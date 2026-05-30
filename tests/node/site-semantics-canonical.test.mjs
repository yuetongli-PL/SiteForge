import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isBilibiliContext,
  isDouyinContext,
  remapSupportedIntent,
  resolveSemanticSiteKey,
} from '../../src/sites/registry/core/site-semantics.mjs';

test('canonical siteKey from siteContext drives douyin semantics before host matching', () => {
  const context = {
    host: 'example.invalid',
    url: 'https://example.invalid/',
    baseUrl: 'https://example.invalid/',
    siteContext: {
      host: 'example.invalid',
      capabilitiesRecord: {
        siteKey: 'douyin',
        adapterId: 'douyin',
      },
    },
  };

  assert.equal(resolveSemanticSiteKey(context), 'douyin');
  assert.equal(isDouyinContext(context), true);
  assert.equal(remapSupportedIntent('search-book', context), 'search-video');
  assert.equal(remapSupportedIntent('open-book', context), 'open-video');
});

test('canonical bilibili siteKey keeps cross-host remapping independent from raw host regexes', () => {
  const context = {
    host: 'example.invalid',
    url: 'https://example.invalid/placeholder',
    baseUrl: 'https://example.invalid/placeholder',
    siteContext: {
      host: 'example.invalid',
      registryRecord: {
        siteKey: 'bilibili',
        adapterId: 'bilibili',
      },
    },
  };

  assert.equal(resolveSemanticSiteKey(context), 'bilibili');
  assert.equal(isBilibiliContext(context), true);
  assert.equal(remapSupportedIntent('search-work', context), 'search-video');
  assert.equal(remapSupportedIntent('open-work', context), 'open-video');
  assert.equal(remapSupportedIntent('open-up', context), 'open-author');
});
