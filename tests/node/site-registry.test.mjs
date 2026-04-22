import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import {
  buildSiteCapabilitiesPath,
  buildSiteRuntimeCapabilitiesPath,
  readSiteCapabilities,
  upsertSiteCapabilities,
} from '../../src/sites/catalog/capabilities.mjs';
import {
  buildSiteRegistryPath,
  buildSiteRuntimeRegistryPath,
  readSiteRegistry,
  upsertSiteRegistryRecord,
} from '../../src/sites/catalog/registry.mjs';
import { createSiteMetadataSandbox } from './helpers/site-metadata-sandbox.mjs';

test('site registry and capabilities return default empty documents before first write', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-index-defaults-'));
  try {
    const registry = await readSiteRegistry(workspace);
    const capabilities = await readSiteCapabilities(workspace);

    assert.deepEqual(registry, {
      version: 1,
      generatedAt: null,
      sites: {},
    });
    assert.deepEqual(capabilities, {
      version: 1,
      generatedAt: null,
      sites: {},
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site registry upserts host operational metadata', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-registry-'));
  try {
    await upsertSiteRegistryRecord(workspace, 'www.22biqu.com', {
      canonicalBaseUrl: 'https://www.22biqu.com/',
      siteKey: '22biqu',
      adapterId: 'chapter-content',
      crawlerScriptPath: 'crawler-scripts/www.22biqu.com/crawler.py',
      knowledgeBaseDir: 'knowledge-base/www.22biqu.com',
    });
    await upsertSiteRegistryRecord(workspace, 'www.22biqu.com', {
      latestDownloadMode: 'artifact-hit',
    });

    const stableRegistry = JSON.parse(await readFile(buildSiteRegistryPath(workspace), 'utf8'));
    const runtimeRegistry = JSON.parse(await readFile(buildSiteRuntimeRegistryPath(workspace), 'utf8'));
    const mergedRegistry = await readSiteRegistry(workspace);
    assert.equal(stableRegistry.sites['www.22biqu.com'].canonicalBaseUrl, 'https://www.22biqu.com/');
    assert.equal(stableRegistry.sites['www.22biqu.com'].siteKey, '22biqu');
    assert.equal(stableRegistry.sites['www.22biqu.com'].adapterId, 'chapter-content');
    assert.equal(stableRegistry.sites['www.22biqu.com'].latestDownloadMode, undefined);
    assert.equal(runtimeRegistry.sites['www.22biqu.com'].latestDownloadMode, 'artifact-hit');
    assert.equal(mergedRegistry.sites['www.22biqu.com'].latestDownloadMode, 'artifact-hit');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site capabilities replace array facts with the latest host truth', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capabilities-'));
  try {
    await upsertSiteCapabilities(workspace, 'moodyz.com', {
      baseUrl: 'https://moodyz.com/',
      siteKey: 'moodyz',
      adapterId: 'moodyz',
      pageTypes: ['category-page', 'search-results-page'],
      capabilityFamilies: ['search-content', 'navigate-to-content'],
      supportedIntents: ['search-work'],
    });
    await upsertSiteCapabilities(workspace, 'moodyz.com', {
      pageTypes: ['author-page'],
      supportedIntents: ['open-work', 'open-actress'],
    });

    const capabilities = JSON.parse(await readFile(buildSiteCapabilitiesPath(workspace), 'utf8'));
    assert.equal(capabilities.sites['moodyz.com'].siteKey, 'moodyz');
    assert.equal(capabilities.sites['moodyz.com'].adapterId, 'moodyz');
    assert.deepEqual(capabilities.sites['moodyz.com'].pageTypes, ['author-page']);
    assert.deepEqual(capabilities.sites['moodyz.com'].supportedIntents, ['open-actress', 'open-work']);
    assert.deepEqual(capabilities.sites['moodyz.com'].capabilityFamilies, ['navigate-to-content', 'search-content']);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site registry and capabilities keep hosts isolated', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-isolation-'));
  try {
    await upsertSiteRegistryRecord(workspace, 'www.22biqu.com', {
      canonicalBaseUrl: 'https://www.22biqu.com/',
      crawlerScriptPath: 'crawler-scripts/www.22biqu.com/crawler.py',
    });
    await upsertSiteRegistryRecord(workspace, 'moodyz.com', {
      canonicalBaseUrl: 'https://moodyz.com/',
      repoSkillDir: 'skills/moodyz-works',
    });
    await upsertSiteCapabilities(workspace, 'www.22biqu.com', {
      capabilityFamilies: ['search-content', 'navigate-to-chapter'],
      supportedIntents: ['download-book'],
    });
    await upsertSiteCapabilities(workspace, 'moodyz.com', {
      capabilityFamilies: ['search-content', 'navigate-to-author'],
      supportedIntents: ['open-work', 'open-actress'],
    });

    const registry = JSON.parse(await readFile(buildSiteRegistryPath(workspace), 'utf8'));
    const capabilities = JSON.parse(await readFile(buildSiteCapabilitiesPath(workspace), 'utf8'));

    assert.equal(registry.sites['www.22biqu.com'].canonicalBaseUrl, 'https://www.22biqu.com/');
    assert.equal(registry.sites['moodyz.com'].canonicalBaseUrl, 'https://moodyz.com/');
    assert.equal(registry.sites['www.22biqu.com'].repoSkillDir, undefined);
    assert.equal(registry.sites['moodyz.com'].crawlerScriptPath, undefined);

    assert.deepEqual(capabilities.sites['www.22biqu.com'].supportedIntents, ['download-book']);
    assert.deepEqual(capabilities.sites['moodyz.com'].supportedIntents, ['open-actress', 'open-work']);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site index upserts sanitize hosts and normalize array fields by module strategy', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-index-normalize-'));
  try {
    await upsertSiteRegistryRecord(workspace, 'moodyz com', {
      capabilityFamilies: ['search-content', 'navigate-to-author', 'search-content'],
    });
    await upsertSiteRegistryRecord(workspace, 'moodyz com', {
      capabilityFamilies: ['navigate-to-content'],
    });
    await upsertSiteCapabilities(workspace, 'moodyz com', {
      capabilityFamilies: ['search-content', 'navigate-to-author', 'search-content'],
      supportedIntents: ['open-work', 'open-work'],
    });
    await upsertSiteCapabilities(workspace, 'moodyz com', {
      capabilityFamilies: ['navigate-to-content'],
    });

    const registry = JSON.parse(await readFile(buildSiteRegistryPath(workspace), 'utf8'));
    const capabilities = JSON.parse(await readFile(buildSiteCapabilitiesPath(workspace), 'utf8'));

    assert.deepEqual(Object.keys(registry.sites), ['moodyz-com']);
    assert.deepEqual(registry.sites['moodyz-com'].capabilityFamilies, [
      'navigate-to-author',
      'navigate-to-content',
      'search-content',
    ]);
    assert.deepEqual(capabilities.sites['moodyz-com'].capabilityFamilies, ['navigate-to-content']);
    assert.deepEqual(capabilities.sites['moodyz-com'].supportedIntents, ['open-work']);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site index path overrides can isolate metadata writes from the workspace root config directory', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-index-override-'));
  const metadataSandbox = createSiteMetadataSandbox(workspace);
  try {
    await upsertSiteRegistryRecord(workspace, 'example.com', {
      canonicalBaseUrl: 'https://example.com/',
    }, metadataSandbox.siteMetadataOptions);
    await upsertSiteCapabilities(workspace, 'example.com', {
      capabilityFamilies: ['search-content'],
    }, metadataSandbox.siteMetadataOptions);

    assert.equal(buildSiteRegistryPath(workspace, metadataSandbox.siteMetadataOptions).startsWith(metadataSandbox.configDir), true);
    assert.equal(buildSiteCapabilitiesPath(workspace, metadataSandbox.siteMetadataOptions).startsWith(metadataSandbox.configDir), true);

    const registry = await readSiteRegistry(workspace, metadataSandbox.siteMetadataOptions);
    const capabilities = await readSiteCapabilities(workspace, metadataSandbox.siteMetadataOptions);
    assert.equal(registry.sites['example.com'].canonicalBaseUrl, 'https://example.com/');
    assert.deepEqual(capabilities.sites['example.com'].capabilityFamilies, ['search-content']);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site registry stores volatile runtime fields outside stable config while merged reads stay compatible', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-registry-runtime-split-'));
  try {
    await upsertSiteRegistryRecord(workspace, 'www.22biqu.com', {
      canonicalBaseUrl: 'https://www.22biqu.com/',
      siteKey: '22biqu',
      adapterId: 'chapter-content',
      knowledgeBaseDir: path.join(workspace, 'knowledge-base', 'www.22biqu.com'),
      latestDownloadMode: 'crawler-generated',
    });

    const stableRegistry = JSON.parse(await readFile(buildSiteRegistryPath(workspace), 'utf8'));
    const runtimeRegistry = JSON.parse(await readFile(buildSiteRuntimeRegistryPath(workspace), 'utf8'));
    const mergedRegistry = await readSiteRegistry(workspace);

    assert.equal(stableRegistry.sites['www.22biqu.com'].canonicalBaseUrl, 'https://www.22biqu.com/');
    assert.equal(stableRegistry.sites['www.22biqu.com'].knowledgeBaseDir, undefined);
    assert.equal(stableRegistry.sites['www.22biqu.com'].latestDownloadMode, undefined);

    assert.equal(runtimeRegistry.sites['www.22biqu.com'].knowledgeBaseDir, path.join(workspace, 'knowledge-base', 'www.22biqu.com'));
    assert.equal(runtimeRegistry.sites['www.22biqu.com'].latestDownloadMode, 'crawler-generated');
    assert.equal(typeof runtimeRegistry.sites['www.22biqu.com'].updatedAt, 'string');

    assert.equal(mergedRegistry.sites['www.22biqu.com'].siteKey, '22biqu');
    assert.equal(mergedRegistry.sites['www.22biqu.com'].knowledgeBaseDir, path.join(workspace, 'knowledge-base', 'www.22biqu.com'));
    assert.equal(mergedRegistry.sites['www.22biqu.com'].latestDownloadMode, 'crawler-generated');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site capabilities keep stable facts in config and timestamps in runtime snapshot', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-capabilities-runtime-split-'));
  try {
    await upsertSiteCapabilities(workspace, 'jable.tv', {
      baseUrl: 'https://jable.tv/',
      siteKey: 'jable',
      adapterId: 'jable',
      capabilityFamilies: ['search-content'],
      supportedIntents: ['search-video'],
    });

    const stableCapabilities = JSON.parse(await readFile(buildSiteCapabilitiesPath(workspace), 'utf8'));
    const runtimeCapabilities = JSON.parse(await readFile(buildSiteRuntimeCapabilitiesPath(workspace), 'utf8'));
    const mergedCapabilities = await readSiteCapabilities(workspace);

    assert.equal(stableCapabilities.sites['jable.tv'].baseUrl, 'https://jable.tv/');
    assert.equal(stableCapabilities.sites['jable.tv'].siteKey, 'jable');
    assert.equal(stableCapabilities.sites['jable.tv'].updatedAt, undefined);

    assert.equal(typeof runtimeCapabilities.sites['jable.tv'].updatedAt, 'string');
    assert.equal(mergedCapabilities.sites['jable.tv'].siteKey, 'jable');
    assert.deepEqual(mergedCapabilities.sites['jable.tv'].supportedIntents, ['search-video']);
    assert.equal(typeof mergedCapabilities.sites['jable.tv'].updatedAt, 'string');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
