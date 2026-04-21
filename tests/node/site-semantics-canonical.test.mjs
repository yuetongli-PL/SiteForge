import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isBilibiliContext,
  isDouyinContext,
  remapSupportedIntent,
} from '../../src/sites/core/site-semantics.mjs';
import { resolveKnownSiteKey } from '../../src/skills/generation/site-render-inputs.mjs';

test('canonical siteKey from siteContext drives douyin skill/docs routing before host matching', () => {
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

  assert.equal(resolveKnownSiteKey(context), 'douyin');
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

  assert.equal(resolveKnownSiteKey(context), 'bilibili');
  assert.equal(isBilibiliContext(context), true);
  assert.equal(remapSupportedIntent('search-work', context), 'search-video');
  assert.equal(remapSupportedIntent('open-work', context), 'open-video');
  assert.equal(remapSupportedIntent('open-up', context), 'open-author');
});
