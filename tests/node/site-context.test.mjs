import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { readSiteContext, resolveCapabilityFamiliesFromSiteContext, resolvePrimaryArchetypeFromSiteContext, resolveSafeActionKindsFromSiteContext, resolveSupportedIntentsFromSiteContext } from '../../lib/site-context.mjs';
import { upsertSiteCapabilities } from '../../lib/site-capabilities.mjs';
import { upsertSiteRegistryRecord } from '../../lib/site-registry.mjs';

test('site context reads isolated host records and resolves merged facts', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-context-'));
  try {
    await upsertSiteRegistryRecord(workspace, 'moodyz.com', {
      canonicalBaseUrl: 'https://moodyz.com/',
      siteArchetype: 'catalog-detail',
      capabilityFamilies: ['navigate-to-content'],
    });
    await upsertSiteCapabilities(workspace, 'moodyz.com', {
      baseUrl: 'https://moodyz.com/',
      primaryArchetype: 'navigation-hub',
      capabilityFamilies: ['search-content', 'navigate-to-author'],
      supportedIntents: ['search-work', 'open-work'],
      safeActionKinds: ['navigate'],
    });
    await upsertSiteRegistryRecord(workspace, 'www.22biqu.com', {
      canonicalBaseUrl: 'https://www.22biqu.com/',
      siteArchetype: 'navigation-hub',
    });

    const context = await readSiteContext(workspace, 'moodyz.com');

    assert.equal(context.host, 'moodyz.com');
    assert.equal(context.registryRecord.canonicalBaseUrl, 'https://moodyz.com/');
    assert.equal(context.capabilitiesRecord.primaryArchetype, 'navigation-hub');
    assert.equal(resolvePrimaryArchetypeFromSiteContext(context, []), 'navigation-hub');
    assert.deepEqual(resolveCapabilityFamiliesFromSiteContext(context, []), ['navigate-to-author', 'navigate-to-content', 'search-content']);
    assert.deepEqual(resolveSupportedIntentsFromSiteContext(context, []), ['open-work', 'search-work']);
    assert.deepEqual(resolveSafeActionKindsFromSiteContext(context, []), ['navigate']);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
