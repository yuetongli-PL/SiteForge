import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
  createStaticSiteCompileManifestFromConfig,
} from '../../src/app/compiler/index.mjs';
import { isKnownReasonCode } from '../../src/domain/risks/reason-codes.mjs';
import {
  canExposeDownloadCapability,
  isDownloadIntent,
  normalizeDownloadAvailability,
} from '../../src/sites/availability.mjs';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8'));
}

const ALLOWED_SUPPORTED_INTENTS = new Set([
  'account-info',
  'download-book',
  'download-media',
  'download-note',
  'download-video',
  'full-archive',
  'list-author-following',
  'list-category-videos',
  'list-followed-updates',
  'list-followed-users',
  'list-profile-content',
  'open-actress',
  'open-auth-page',
  'open-author',
  'open-book',
  'open-category',
  'open-chapter',
  'open-model',
  'open-note',
  'open-post',
  'open-reel',
  'open-utility-page',
  'open-video',
  'open-work',
  'profile-content',
  'search-book',
  'search-content',
  'search-note',
  'search-posts',
  'search-video',
  'search-work',
]);

const ALLOWED_CAPABILITY_FAMILIES = new Set([
  'download-content',
  'navigate-to-author',
  'navigate-to-category',
  'navigate-to-chapter',
  'navigate-to-content',
  'navigate-to-utility-page',
  'open-auth-page',
  'query-account-profile',
  'query-social-content',
  'query-social-relations',
  'search-content',
  'switch-in-page-state',
]);

const ALLOWED_ACTION_KINDS = new Set([
  'download-book',
  'download-media',
  'navigate',
  'query-ranking',
  'search-submit',
]);

const SOCIAL_SITE_KEYS = new Set(['x', 'instagram']);
const VIDEO_SITE_KEYS = new Set(['bilibili', 'douyin', 'jable']);
const CHAPTER_ADAPTERS = new Set(['chapter-content']);

function collectConfigReasonCodes(value, path = /** @type {any[]} */ ([])) {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectConfigReasonCodes(item, [...path, index]));
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  const hits = /** @type {any[]} */ ([]);
  for (const [key, child] of Object.entries(value)) {
    if (key === 'reasonCode' || key === 'unsupportedLiveReasonCode') {
      hits.push({ path: [...path, key].join('.'), code: child });
    }
    if (key === 'reasonCodes' && Array.isArray(child)) {
      hits.push(...child.map((code) => ({ path: [...path, key].join('.'), code })));
    }
    hits.push(...collectConfigReasonCodes(child, [...path, key]));
  }
  return hits;
}

test('site capability config uses typed intents, families, action kinds, and canonical reason codes', async () => {
  const capabilities = await readJson('config/site-capabilities.json');
  const registry = await readJson('config/site-registry.json');

  assert.deepEqual(Object.keys(capabilities.sites), Object.keys(registry.sites));

  for (const [host, site] of Object.entries(capabilities.sites)) {
    for (const intent of site.supportedIntents ?? []) {
      assert.equal(ALLOWED_SUPPORTED_INTENTS.has(intent), true, `${host} has unknown supportedIntent ${intent}`);
    }
    for (const family of site.capabilityFamilies ?? []) {
      assert.equal(ALLOWED_CAPABILITY_FAMILIES.has(family), true, `${host} has unknown capabilityFamily ${family}`);
    }
    for (const actionKind of [...(site.safeActionKinds ?? []), ...(site.approvalActionKinds ?? [])]) {
      assert.equal(ALLOWED_ACTION_KINDS.has(actionKind), true, `${host} has unknown action kind ${actionKind}`);
    }
  }

  for (const { path, code } of [
    ...collectConfigReasonCodes(capabilities),
    ...collectConfigReasonCodes(registry),
  ]) {
    assert.equal(isKnownReasonCode(code), true, `${path} uses unknown reasonCode ${code}`);
  }
});

test('site archetypes reject drifted book, chapter, social, and media intents', async () => {
  const capabilities = await readJson('config/site-capabilities.json');
  const registry = await readJson('config/site-registry.json');

  for (const [host, site] of Object.entries(capabilities.sites)) {
    const registrySite = registry.sites[host];
    const intents = site.supportedIntents ?? [];
    const siteKey = site.siteKey ?? registrySite.siteKey;
    const adapterId = site.adapterId ?? registrySite.adapterId;

    if (SOCIAL_SITE_KEYS.has(siteKey)) {
      assert.deepEqual(intents.filter((intent) => /book|chapter/iu.test(intent)), [], `${host} social intents must not include book/chapter`);
      assert.equal(intents.includes('download-book'), false, `${host} social site must not declare download-book`);
    }
    if (VIDEO_SITE_KEYS.has(siteKey)) {
      assert.deepEqual(intents.filter((intent) => /book|chapter/iu.test(intent)), [], `${host} video/media intents must not include book/chapter`);
    }
    if (CHAPTER_ADAPTERS.has(adapterId)) {
      assert.deepEqual(intents.filter((intent) => /social|archive|media|video|post|note/iu.test(intent)), [], `${host} chapter-content intents must stay chapter/book scoped`);
    }
    if (intents.includes('download-book')) {
      assert.equal(CHAPTER_ADAPTERS.has(adapterId), true, `${host} download-book is only allowed on chapter/book adapters`);
      assert.deepEqual(normalizeDownloadAvailability(registrySite, site).declaredTaskTypes, ['book']);
    }
  }
});

test('blocked download declarations do not become executable or agent exposed capabilities', async () => {
  for (const siteKey of ['jable', 'x', 'instagram']) {
    const manifest = await createStaticSiteCompileManifestFromConfig({
      request: {
        schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
        siteKey,
        compileScope: {
          schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
          coverageMode: 'declared_only',
          coverageCompleteness: 'partial',
          allowedCaptureModes: ['static'],
          sourceTypes: ['site-registry', 'site-capabilities'],
          redactionRequired: true,
        },
        sourceTypes: ['site-registry', 'site-capabilities'],
        redactionRequired: true,
      },
    });
    const downloadCapabilities = manifest.inventories.capabilities.filter((capability) => isDownloadIntent(capability.normalizedIntent));
    assert.equal(downloadCapabilities.length > 0, true, `${siteKey} should keep descriptor-only blocked download capabilities`);
    assert.deepEqual(downloadCapabilities.map((capability) => capability.agentExposed), downloadCapabilities.map(() => false));
  }
});

test('availability model gates executable download capabilities', async () => {
  const capabilities = await readJson('config/site-capabilities.json');
  const registry = await readJson('config/site-registry.json');
  const xAvailability = normalizeDownloadAvailability(registry.sites['x.com'], capabilities.sites['x.com']);
  const jableAvailability = normalizeDownloadAvailability(registry.sites['jable.tv'], capabilities.sites['jable.tv']);
  const bilibiliAvailability = normalizeDownloadAvailability(registry.sites['www.bilibili.com'], capabilities.sites['www.bilibili.com']);

  assert.equal(canExposeDownloadCapability(xAvailability), false);
  assert.equal(canExposeDownloadCapability(jableAvailability), false);
  assert.equal(canExposeDownloadCapability({ ...bilibiliAvailability, availableTaskTypes: [] }), false);
  assert.equal(canExposeDownloadCapability(bilibiliAvailability), true);
});
