import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';

import {
  readSiteContext,
  resolveAdapterIdFromSiteContext,
  resolveCapabilityFamiliesFromSiteContext,
  resolvePageTypesFromSiteContext,
  resolvePrimaryArchetypeFromSiteContext,
  resolveSafeActionKindsFromSiteContext,
  resolveSiteKeyFromSiteContext,
  resolveSupportedIntentsFromSiteContext,
} from '../../src/sites/catalog/context.mjs';
import { upsertSiteCapabilities } from '../../src/sites/catalog/capabilities.mjs';
import { upsertSiteRegistryRecord } from '../../src/sites/catalog/registry.mjs';
import { resolveSite, resolveSiteIdentity } from '../../src/sites/core/adapters/resolver.mjs';
import {
  remapSupportedIntent,
  resolveSocialNaturalLanguageSemantics,
} from '../../src/sites/core/site-semantics.mjs';

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
    const registryDocument = JSON.parse(await readFile(path.join(workspace, 'config', 'site-registry.json'), 'utf8'));
    const capabilitiesDocument = JSON.parse(await readFile(path.join(workspace, 'config', 'site-capabilities.json'), 'utf8'));

    assert.equal(context.host, 'moodyz.com');
    assert.equal(context.registryRecord.canonicalBaseUrl, 'https://moodyz.com/');
    assert.equal(context.capabilitiesRecord.primaryArchetype, 'navigation-hub');
    assert.equal(resolvePrimaryArchetypeFromSiteContext(context, []), 'navigation-hub');
    assert.deepEqual(resolveCapabilityFamiliesFromSiteContext(context, []), ['navigate-to-author', 'navigate-to-content', 'search-content']);
    assert.deepEqual(resolveSupportedIntentsFromSiteContext(context, []), ['open-work', 'search-work']);
    assert.deepEqual(resolveSafeActionKindsFromSiteContext(context, []), ['navigate']);
    assert.ok(registryDocument.sites['moodyz.com']);
    assert.ok(capabilitiesDocument.sites['moodyz.com']);
    await assert.rejects(access(path.join(workspace, 'site-registry.json')));
    await assert.rejects(access(path.join(workspace, 'site-capabilities.json')));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site context fallback arrays override stale stored capability arrays', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-context-fallbacks-'));
  try {
    await upsertSiteCapabilities(workspace, 'jable.tv', {
      baseUrl: 'https://jable.tv/',
      capabilityFamilies: ['navigate-to-content', 'search-content'],
      supportedIntents: ['open-video', 'download-book'],
      safeActionKinds: ['navigate', 'download-book'],
      pageTypes: ['category-page', 'book-detail-page'],
    });

    const context = await readSiteContext(workspace, 'jable.tv');

    assert.deepEqual(resolveCapabilityFamiliesFromSiteContext(context, [['query-ranked-content']]), ['query-ranked-content']);
    assert.deepEqual(resolveSupportedIntentsFromSiteContext(context, [['list-category-videos']]), ['list-category-videos']);
    assert.deepEqual(resolveSafeActionKindsFromSiteContext(context, [['navigate', 'query-ranking']]), ['navigate', 'query-ranking']);
    assert.deepEqual(resolvePageTypesFromSiteContext(context, [['ranking-page']]), ['ranking-page']);
    assert.deepEqual(resolveCapabilityFamiliesFromSiteContext(context, []), ['navigate-to-content', 'search-content']);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site context resolves siteKey and adapterId with capabilities precedence', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-context-identity-'));
  try {
    await upsertSiteRegistryRecord(workspace, 'www.22biqu.com', {
      canonicalBaseUrl: 'https://www.22biqu.com/',
      siteArchetype: 'chapter-content',
      siteKey: 'chapter-content-registry',
      adapterId: 'chapter-content-registry',
    });
    await upsertSiteCapabilities(workspace, 'www.22biqu.com', {
      baseUrl: 'https://www.22biqu.com/',
      primaryArchetype: 'chapter-content',
      siteKey: '22biqu',
      adapterId: 'chapter-content',
    });

    const context = await readSiteContext(workspace, 'www.22biqu.com');

    assert.equal(resolveSiteKeyFromSiteContext(context, []), '22biqu');
    assert.equal(resolveAdapterIdFromSiteContext(context, []), 'chapter-content');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('resolveSiteIdentity derives canonical adapterId and siteKey when stored metadata is unavailable', () => {
  const identity = resolveSiteIdentity({
    host: 'www.22biqu.com',
    profile: {
      host: 'www.22biqu.com',
      primaryArchetype: 'chapter-content',
      bookDetail: {},
      chapter: {},
    },
  });

  assert.equal(identity.adapterId, 'chapter-content');
  assert.equal(identity.siteKey, '22biqu');
});

test('resolveSite preserves stored site identity metadata from site context', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-context-resolve-site-'));
  try {
    await upsertSiteRegistryRecord(workspace, 'www.douyin.com', {
      canonicalBaseUrl: 'https://www.douyin.com/',
      siteKey: 'douyin-registry',
      adapterId: 'douyin-registry',
    });
    await upsertSiteCapabilities(workspace, 'www.douyin.com', {
      baseUrl: 'https://www.douyin.com/',
      siteKey: 'douyin',
      adapterId: 'douyin',
      primaryArchetype: 'navigation-hub',
    });

    const resolved = await resolveSite({
      workspaceRoot: workspace,
      inputUrl: 'https://www.douyin.com/?recommend=1',
      profile: { host: 'www.douyin.com' },
    });

    assert.equal(resolved.adapterId, 'douyin');
    assert.equal(resolved.siteKey, 'douyin');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('resolveSite uses configured X and Instagram adapter identities', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-context-social-sites-'));
  try {
    await upsertSiteRegistryRecord(workspace, 'x.com', {
      canonicalBaseUrl: 'https://x.com/home',
      siteKey: 'x',
      adapterId: 'x',
    });
    await upsertSiteCapabilities(workspace, 'x.com', {
      baseUrl: 'https://x.com/home',
      siteKey: 'x',
      adapterId: 'x',
      primaryArchetype: 'catalog-detail',
    });
    await upsertSiteRegistryRecord(workspace, 'www.instagram.com', {
      canonicalBaseUrl: 'https://www.instagram.com/',
      siteKey: 'instagram',
      adapterId: 'instagram',
    });
    await upsertSiteCapabilities(workspace, 'www.instagram.com', {
      baseUrl: 'https://www.instagram.com/',
      siteKey: 'instagram',
      adapterId: 'instagram',
      primaryArchetype: 'catalog-detail',
    });

    const xResolved = await resolveSite({
      workspaceRoot: workspace,
      inputUrl: 'https://x.com/home',
      profile: { host: 'x.com' },
    });
    const instagramResolved = await resolveSite({
      workspaceRoot: workspace,
      inputUrl: 'https://www.instagram.com/',
      profile: { host: 'www.instagram.com' },
    });

    assert.equal(xResolved.adapterId, 'x');
    assert.equal(xResolved.siteKey, 'x');
    assert.equal(instagramResolved.adapterId, 'instagram');
    assert.equal(instagramResolved.siteKey, 'instagram');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('social site semantics expose X and Instagram operational natural language aliases', async () => {
  const xProfile = JSON.parse(await readFile(path.resolve('profiles/x.com.json'), 'utf8'));
  const instagramProfile = JSON.parse(await readFile(path.resolve('profiles/www.instagram.com.json'), 'utf8'));

  const xContext = {
    host: 'x.com',
    baseUrl: 'https://x.com/home',
    profile: xProfile,
  };
  const instagramContext = {
    host: 'www.instagram.com',
    baseUrl: 'https://www.instagram.com/',
    profile: instagramProfile,
  };

  assert.equal(remapSupportedIntent('continue-full-archive', xContext), 'resume-full-archive');
  assert.equal(remapSupportedIntent('cooldown-resume', xContext), 'resume-after-cooldown');
  assert.equal(remapSupportedIntent('high-speed-media-download', instagramContext), 'media-fast-download');
  assert.equal(remapSupportedIntent('verification-report', instagramContext), 'live-acceptance-report');
  assert.equal(remapSupportedIntent('knowledge-base-refresh', instagramContext), 'kb-refresh');

  const xSemantics = resolveSocialNaturalLanguageSemantics(xContext);
  const instagramSemantics = resolveSocialNaturalLanguageSemantics(instagramContext);

  assert.ok(xSemantics?.siteAliases.includes('twitter'));
  assert.ok(xSemantics?.intentAliases['resume-after-cooldown'].includes('限流冷却后继续'));
  assert.match(xSemantics?.commandMappings['kb-refresh'] ?? '', /social-kb-refresh\.mjs --execute --site x/u);
  assert.ok(instagramSemantics?.siteAliases.includes('ig'));
  assert.ok(instagramSemantics?.intentAliases['media-fast-download'].includes('媒体高速下载'));
  assert.match(instagramSemantics?.commandMappings['live-acceptance-report'] ?? '', /social-live-verify\.mjs --execute --site instagram/u);
});
