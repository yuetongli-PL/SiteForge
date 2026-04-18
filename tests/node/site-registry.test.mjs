import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import { buildSiteCapabilitiesPath, readSiteCapabilities, upsertSiteCapabilities } from '../../lib/site-capabilities.mjs';
import { buildSiteRegistryPath, readSiteRegistry, upsertSiteRegistryRecord } from '../../lib/site-registry.mjs';

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
      crawlerScriptPath: 'crawler-scripts/www.22biqu.com/crawler.py',
      knowledgeBaseDir: 'knowledge-base/www.22biqu.com',
    });
    await upsertSiteRegistryRecord(workspace, 'www.22biqu.com', {
      latestDownloadMode: 'artifact-hit',
    });

    const registry = JSON.parse(await readFile(buildSiteRegistryPath(workspace), 'utf8'));
    assert.equal(registry.sites['www.22biqu.com'].canonicalBaseUrl, 'https://www.22biqu.com/');
    assert.equal(registry.sites['www.22biqu.com'].latestDownloadMode, 'artifact-hit');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site capabilities replace array facts with the latest host truth', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capabilities-'));
  try {
    await upsertSiteCapabilities(workspace, 'moodyz.com', {
      baseUrl: 'https://moodyz.com/',
      pageTypes: ['category-page', 'search-results-page'],
      capabilityFamilies: ['search-content', 'navigate-to-content'],
      supportedIntents: ['search-work'],
    });
    await upsertSiteCapabilities(workspace, 'moodyz.com', {
      pageTypes: ['author-page'],
      supportedIntents: ['open-work', 'open-actress'],
    });

    const capabilities = JSON.parse(await readFile(buildSiteCapabilitiesPath(workspace), 'utf8'));
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
