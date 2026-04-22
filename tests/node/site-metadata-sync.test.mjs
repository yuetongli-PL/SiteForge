import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { syncKnowledgeBaseSiteMetadata } from '../../src/pipeline/stages/kb/site-metadata.mjs';
import { readJsonFile } from '../../src/infra/io.mjs';
import { syncPublishedSiteMetadata } from '../../src/skills/generation/sync-site-metadata.mjs';
import { buildSiteCapabilitiesPath } from '../../src/sites/catalog/capabilities.mjs';
import { buildSiteRegistryPath } from '../../src/sites/catalog/registry.mjs';
import { assertRepoMetadataUnchanged, captureRepoMetadataSnapshot, createSiteMetadataSandbox } from './helpers/site-metadata-sandbox.mjs';

function createSiteContext(siteKey, adapterId) {
  return {
    host: 'example.invalid',
    capabilitiesRecord: {
      siteKey,
      adapterId,
      supportedIntents: ['search-video'],
      safeActionKinds: ['search-submit'],
    },
  };
}

test('syncKnowledgeBaseSiteMetadata prefers canonical site identity from siteContext', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-metadata-sync-'));
  const repoMetadataSnapshot = await captureRepoMetadataSnapshot();
  const metadataSandbox = createSiteMetadataSandbox(workspace);

  try {
    await syncKnowledgeBaseSiteMetadata({
      cwd: workspace,
      host: 'example.invalid',
      baseUrl: 'https://example.invalid/',
      generatedAt: '2026-04-21T00:00:00.000Z',
      kbDir: path.join(workspace, 'knowledge-base', 'example.invalid'),
      kbFiles: { sources: 'index/sources.json' },
      lintSummary: { passed: true, errorCount: 0, warningCount: 0 },
      siteContext: createSiteContext('douyin', 'douyin'),
      model: {
        siteProfile: {
          host: 'www.douyin.com',
          primaryArchetype: 'navigation-hub',
          capabilityFamilies: ['search-content'],
          pageTypes: {
            homeExact: ['/'],
            searchResultsPrefixes: ['/search'],
            contentDetailPrefixes: ['/video/'],
            authorPrefixes: ['/user/'],
            authorListPrefixes: ['/follow'],
            categoryPrefixes: ['/shipin/'],
          },
        },
        intents: [{ intentType: 'search-video', actionId: 'search-submit' }],
        approvalRules: [],
      },
      siteProfilePath: path.join(workspace, 'profiles', 'www.douyin.com.json'),
      siteMetadataOptions: metadataSandbox.siteMetadataOptions,
    });

    const registry = await readJsonFile(buildSiteRegistryPath(workspace, metadataSandbox.siteMetadataOptions));
    const capabilities = await readJsonFile(buildSiteCapabilitiesPath(workspace, metadataSandbox.siteMetadataOptions));

    assert.equal(registry.sites['example.invalid'].siteKey, 'douyin');
    assert.equal(registry.sites['example.invalid'].adapterId, 'douyin');
    assert.equal(capabilities.sites['example.invalid'].siteKey, 'douyin');
    assert.equal(capabilities.sites['example.invalid'].adapterId, 'douyin');
    await assertRepoMetadataUnchanged(repoMetadataSnapshot);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('syncPublishedSiteMetadata prefers canonical site identity from siteContext for skill publishing', async () => {
  const registryCalls = [];
  const capabilityCalls = [];

  await syncPublishedSiteMetadata('skill', {
    cwd: 'C:\\workspace',
    host: 'example.invalid',
    inputUrl: 'https://example.invalid/',
    baseUrl: 'https://example.invalid/',
    generatedAt: '2026-04-21T00:00:00.000Z',
    skillDir: 'C:\\workspace\\skills\\douyin',
    profilePath: 'C:\\workspace\\profiles\\www.douyin.com.json',
    kbDir: 'C:\\workspace\\knowledge-base\\example.invalid',
    siteContext: createSiteContext('douyin', 'douyin'),
    siteProfile: {
      host: 'www.douyin.com',
      pageTypes: {
        homeExact: ['/'],
        searchResultsPrefixes: ['/search'],
        contentDetailPrefixes: ['/video/'],
        authorPrefixes: ['/user/'],
        authorListPrefixes: ['/follow'],
        categoryPrefixes: ['/shipin/'],
      },
    },
    primaryArchetype: 'navigation-hub',
    capabilityFamilies: ['search-content'],
    supportedIntents: ['search-video'],
  }, {
    upsertSiteRegistryRecord: async (...args) => {
      registryCalls.push(args);
    },
    upsertSiteCapabilities: async (...args) => {
      capabilityCalls.push(args);
    },
  });

  assert.equal(registryCalls.length, 1);
  assert.equal(capabilityCalls.length, 1);
  assert.equal(registryCalls[0][2].siteKey, 'douyin');
  assert.equal(registryCalls[0][2].adapterId, 'douyin');
  assert.equal(capabilityCalls[0][2].siteKey, 'douyin');
  assert.equal(capabilityCalls[0][2].adapterId, 'douyin');
});
