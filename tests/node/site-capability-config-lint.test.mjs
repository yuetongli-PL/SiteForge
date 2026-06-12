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
import {
  CANONICAL_CAPABILITY_FAMILIES,
  CANONICAL_SUPPORTED_INTENTS,
  explainCapabilityIntentMapping,
} from '../../src/sites/registry/core/capability-intent-mapping.mjs';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8'));
}

const ALLOWED_ACTION_KINDS = new Set([
  'download-book',
  'download-media',
  'navigate',
  'query-ranking',
  'search-submit',
]);

const ALLOWED_DISABLED_ACTION_KINDS = new Set([
  'change_2fa',
  'change_email',
  'change_password',
  'change_payment',
  'change_security_settings',
  'create_dm_draft',
  'create_post_draft',
  'create_reply_draft',
  'delete',
  'edit_profile',
  'follow',
  'like',
  'payment',
  'publish',
  'publish_reply',
  'read_dm',
  'repost',
  'send_dm',
  'unfollow',
  'upload',
]);

const SOCIAL_SITE_KEYS = new Set(['x', 'instagram', 'reddit', 'weibo', 'zhihu']);
const VIDEO_SITE_KEYS = new Set(['123av', 'bilibili', 'douyin', 'jable']);
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
      assert.equal(CANONICAL_SUPPORTED_INTENTS.has(intent), true, `${host} has unknown supportedIntent ${intent}`);
      const mapping = explainCapabilityIntentMapping(intent, site.capabilityFamilies ?? []);
      assert.equal(
        mapping.status,
        'mapped',
        `${host} supportedIntent ${intent} must map to a declared capabilityFamily; got ${mapping.reason}`,
      );
    }
    for (const family of site.capabilityFamilies ?? []) {
      assert.equal(CANONICAL_CAPABILITY_FAMILIES.has(family), true, `${host} has unknown capabilityFamily ${family}`);
    }
    for (const actionKind of [...(site.safeActionKinds ?? []), ...(site.approvalActionKinds ?? [])]) {
      assert.equal(ALLOWED_ACTION_KINDS.has(actionKind), true, `${host} has unknown action kind ${actionKind}`);
    }
    for (const actionKind of site.disabledActionKinds ?? []) {
      assert.equal(ALLOWED_DISABLED_ACTION_KINDS.has(actionKind), true, `${host} has unknown disabled action kind ${actionKind}`);
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
      assert.deepEqual(intents.filter((intent) => /(?:^|-)book(?:-|$)|(?:^|-)chapter(?:-|$)/iu.test(intent)), [], `${host} social intents must not include book/chapter`);
      assert.equal(intents.includes('download-book'), false, `${host} social site must not declare download-book`);
    }
    if (VIDEO_SITE_KEYS.has(siteKey)) {
      assert.deepEqual(intents.filter((intent) => /(?:^|-)book(?:-|$)|(?:^|-)chapter(?:-|$)/iu.test(intent)), [], `${host} video/media intents must not include book/chapter`);
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

test('instagram config is modeled as authenticated social coverage with governed media downloads', async () => {
  const capabilities = await readJson('config/site-capabilities.json');
  const registry = await readJson('config/site-registry.json');
  const capability = capabilities.sites['www.instagram.com'];
  const registrySite = registry.sites['www.instagram.com'];

  assert.equal(capability.primaryArchetype, 'social-content');
  assert.equal(registrySite.siteArchetype, 'social-content');
  assert.equal(registrySite.auth.required, true);
  assert.equal(registrySite.auth.mode, 'browser');
  assert.equal(registrySite.auth.sessionMaterialPersistence, 'forbidden');
  assert.equal(registrySite.auth.evidencePersistence, 'sanitized-structure-only');
  assert.equal(registrySite.downloadSessionRequirement, 'required');
  assert.equal(capability.downloader.requiresLogin, true);
  assert.equal(capability.downloader.status, 'supported');
  assert.equal(capability.downloader.availableTaskTypes.includes('media-bundle'), true);
  assert.deepEqual(capability.downloader.blockedTaskTypes, []);
  assert.deepEqual(registrySite.blockedDownloadTaskTypes, []);

  for (const intent of ['list-profile-content', 'search-posts', 'list-notifications', 'open-auth-page']) {
    assert.equal(capability.supportedIntents.includes(intent), true, `instagram should declare ${intent}`);
  }
  for (const family of ['query-social-content', 'query-social-relations', 'query-notifications', 'open-auth-page']) {
    assert.equal(capability.capabilityFamilies.includes(family), true, `instagram should declare ${family}`);
  }
  for (const actionKind of ['publish', 'follow', 'like', 'send_dm', 'read_dm', 'upload', 'payment', 'delete']) {
    assert.equal(capability.disabledActionKinds.includes(actionKind), true, `instagram should disable ${actionKind}`);
    assert.equal(registrySite.disabledActionKinds.includes(actionKind), true, `instagram registry should disable ${actionKind}`);
  }

  const routeIds = new Set(capability.publicRouteTemplates.map((route) => route.id));
  for (const routeId of [
    'instagram-auth-home',
    'instagram-auth-search',
    'instagram-auth-notifications',
    'instagram-direct-boundary',
    'instagram-profile',
    'instagram-post-detail',
    'instagram-reel-detail',
    'instagram-story-detail',
  ]) {
    assert.equal(routeIds.has(routeId), true, `instagram route template ${routeId} should be declared`);
  }
});

test('blocked download declarations stay compiled and agent-visible with blocked runtime disposition', async () => {
  for (const siteKey of ['jable', 'x']) {
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
    assert.deepEqual(downloadCapabilities.map((capability) => capability.agentExposed), downloadCapabilities.map(() => true));
    assert.deepEqual(downloadCapabilities.map((capability) => capability.executable), downloadCapabilities.map(() => true));
    assert.deepEqual(downloadCapabilities.map((capability) => capability.enablementStatus), downloadCapabilities.map(() => 'disabled'));
    assert.deepEqual(downloadCapabilities.map((capability) => capability.executionDisposition), downloadCapabilities.map(() => 'blocked'));
    assert.deepEqual(downloadCapabilities.map((capability) => capability.runtimeCallable), downloadCapabilities.map(() => false));
  }
});

test('instagram media downloads compile as governed executable capabilities', async () => {
  const manifest = await createStaticSiteCompileManifestFromConfig({
    request: {
      schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
      siteKey: 'instagram',
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
  assert.equal(downloadCapabilities.length > 0, true);
  assert.deepEqual(downloadCapabilities.map((capability) => capability.agentExposed), downloadCapabilities.map(() => true));
  assert.deepEqual(downloadCapabilities.map((capability) => capability.executable), downloadCapabilities.map(() => true));
  assert.deepEqual(downloadCapabilities.map((capability) => capability.enablementStatus), downloadCapabilities.map(() => 'enabled'));
  assert.deepEqual(downloadCapabilities.map((capability) => capability.executionDisposition), downloadCapabilities.map(() => 'allow'));
  assert.deepEqual(downloadCapabilities.map((capability) => capability.runtimeCallable), downloadCapabilities.map(() => true));
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
