import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
  createStaticSiteCompileManifestFromConfig,
  loadCompilerConfigSources,
} from '../../../src/app/compiler/index.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));

function createRequest(overrides = /** @type {any} */ ({})) {
  return {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    siteKey: 'qidian',
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
    ...overrides,
  };
}

test('config-backed loader emits sanitized registry and capability descriptors', async () => {
  const sources = await loadCompilerConfigSources({
    repoRoot: root,
    siteKey: 'bz888',
  });

  const serialized = JSON.stringify(sources);
  assert.equal(sources.siteKey, 'bz888');
  assert.equal(sources.sourceRefs.length, 2);
  assert.match(sources.sourceDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(sources.capabilityConfig.capabilities.length > 0, true);
  assert.doesNotMatch(serialized, /profilePath|browserProfilePath|userDataDir|SESSDATA|Authorization/u);
});

test('config-backed loader default repoRoot resolves to the repository root', async () => {
  const sources = await loadCompilerConfigSources({
    siteKey: 'bz888',
  });

  assert.deepEqual(
    sources.sourceRefs.map((sourceRef) => sourceRef.ref),
    [
      'config/site-registry.json',
      'config/site-capabilities.json',
    ],
  );
});

test('config-backed loader rejects absolute or escaped config paths', async () => {
  await assert.rejects(
    () => loadCompilerConfigSources({
      repoRoot: root,
      siteKey: 'qidian',
      registryPath: '../outside.json',
    }),
    /registryPath must stay inside the repository root/u,
  );
  await assert.rejects(
    () => loadCompilerConfigSources({
      repoRoot: root,
      siteKey: 'qidian',
      capabilitiesPath: fileURLToPath(new URL('../../../config/site-capabilities.json', import.meta.url)),
    }),
    /capabilitiesPath must not be an absolute path/u,
  );
});

test('config-backed static compiler records digest and incremental summary', async () => {
  const first = await createStaticSiteCompileManifestFromConfig({
    repoRoot: root,
    request: createRequest(),
  });
  const second = await createStaticSiteCompileManifestFromConfig({
    repoRoot: root,
    request: createRequest(),
    previousSourceDigest: first.sourceDigest,
  });

  assert.match(first.sourceDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(first.manifestDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(first.sourceRefs.every((sourceRef) => sourceRef.digest === first.sourceDigest), true);
  assert.equal(second.incrementalCompile.unchanged, true);
  assert.equal(second.incrementalCompile.changed, false);
  assert.deepEqual(second.incrementalCompile.changedSourceRefs, []);
  assert.equal(second.inventories.capabilities.length > 0, true);
});

test('config-backed static compiler default repoRoot resolves to the repository root', async () => {
  const manifest = await createStaticSiteCompileManifestFromConfig({
    request: createRequest({ siteKey: 'bz888' }),
  });

  assert.deepEqual(
    manifest.sourceRefs.map((sourceRef) => sourceRef.ref),
    [
      'config/site-registry.json',
      'config/site-capabilities.json',
    ],
  );
  assert.equal(manifest.inventories.capabilities.length > 0, true);
});

test('config-backed loader rejects repoRoot values that are not the repository root', async () => {
  await assert.rejects(
    () => loadCompilerConfigSources({
      repoRoot: path.join(root, 'src'),
      siteKey: 'bz888',
    }),
    /Invalid repository root: .* is missing package\.json/u,
  );
});

test('config-backed compiler maps download capability requirements and blocked risk', async () => {
  const manifest = await createStaticSiteCompileManifestFromConfig({
    repoRoot: root,
    request: createRequest({ siteKey: 'bz888' }),
  });
  const downloadCapability = manifest.inventories.capabilities
    .find((capability) => capability.normalizedIntent === 'download-book');
  const blockedRisk = manifest.inventories.nodes
    .find((node) => node.type === 'RiskPolicyNode' && node.state === 'blocked');

  assert.equal(downloadCapability.mode, 'download');
  assert.equal(downloadCapability.requiresApproval, true);
  assert.equal(blockedRisk.reasonCodeRefs.includes('blocked-by-cloudflare-challenge'), true);
});
