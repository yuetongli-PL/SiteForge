import test from 'node:test';
import assert from 'node:assert/strict';

import { createSiteRecord } from '../../src/app/pipeline/build/models.mjs';
import { siteRecordWithKnownAdapterAllowedDomains } from '../../src/app/pipeline/build/site-record-hosts.mjs';

test('site record allowed domains include known adapter alternate hosts', () => {
  const site = createSiteRecord('https://www.8man.jp/', '2026-06-01T00:00:00.000Z');
  const enriched = siteRecordWithKnownAdapterAllowedDomains(site, 'https://www.8man.jp/');

  assert.equal(enriched.id, site.id);
  assert.equal(enriched.rootUrl, site.rootUrl);
  assert.equal(enriched.allowedDomains.includes('8man.jp'), true);
  assert.equal(enriched.allowedDomains.includes('www.8man.jp'), true);
  assert.equal(enriched.allowedDomains.includes('so-agent.jp'), true);
  assert.equal(enriched.allowedDomains.includes('www.so-agent.jp'), true);
});

test('site record allowed domains stay narrow for generic sites', () => {
  const site = createSiteRecord('https://example.invalid/', '2026-06-01T00:00:00.000Z');
  const enriched = siteRecordWithKnownAdapterAllowedDomains(site, 'https://example.invalid/');

  assert.deepEqual(enriched.allowedDomains, ['example.invalid', 'www.example.invalid']);
});
