// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  CAPABILITY_PACKAGE_SCHEMA_VERSION,
  assessCapabilityPackageCompatibility,
  buildCapabilityPackageFromGraph,
  createCapabilityPackageDigest,
  createCapabilityPackageRegistry,
  createSiteAdapterRegistry,
  diffCapabilityPackages,
  exportCapabilityPackageSafeJson,
  importCapabilityPackageSafeJson,
  resolvePackageCapabilityRef,
  resolvePackageExecutionContractRef,
  resolveSiteAdapterDescriptor,
  sanitizeSiteAdapterDescriptor,
  validateCapabilityPackageManifest,
} from '../../src/domain/capability-packages/index.mjs';

const FIXTURE_URL = new URL('./fixtures/capability-package-site-adapter-registry-v1/compiled-graph.json', import.meta.url);
const PACKAGE_CANARIES = /sf_package_cookie_secret_123|sf_package_private_form_secret_456|sf_package_session_secret_789/u;

async function readGraphFixture() {
  return JSON.parse(await readFile(FIXTURE_URL, 'utf8'));
}

async function buildPackage(overrides = {}) {
  const graph = await readGraphFixture();
  return buildCapabilityPackageFromGraph(graph, {
    version: '1.2.0',
    compiledAt: '2026-06-07T00:00:00.000Z',
    ...overrides,
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('builds package from capability graph', async () => {
  const manifest = await buildPackage();

  assert.equal(manifest.schemaVersion, CAPABILITY_PACKAGE_SCHEMA_VERSION);
  assert.equal(manifest.packageId, 'sitepkg:example.com');
  assert.equal(manifest.version, '1.2.0');
  assert.equal(manifest.capabilities.length, 1);
  assert.equal(manifest.capabilities[0].capabilityRef, 'sitepkg:example.com/contact-submit@1.2.0');
  assert.equal(manifest.capabilities[0].kind, 'form_or_action');
});

test('validates package schema', async () => {
  const manifest = await buildPackage();
  const report = validateCapabilityPackageManifest(manifest);

  assert.equal(report.ok, true);
  assert.equal(report.sanitized.schemaVersion, CAPABILITY_PACKAGE_SCHEMA_VERSION);
  assert.equal(report.sanitized.redactionRequired, true);
});

test('resolves capabilityRef', async () => {
  const manifest = await buildPackage();
  const result = resolvePackageCapabilityRef(manifest, 'sitepkg:example.com/contact-submit@1.2.0');

  assert.equal(result.found, true);
  assert.equal(result.capability.capabilityId, 'contact-submit');
});

test('resolves executionContractRef', async () => {
  const manifest = await buildPackage();
  const result = resolvePackageExecutionContractRef(manifest, manifest.capabilities[0].executionContractRef);

  assert.equal(result.found, true);
  assert.equal(result.contract.sourceExecutionContractId, 'execution-contract:example.com:contact-submit');
});

test('package digest is stable', async () => {
  const first = await buildPackage();
  const reordered = {
    ...first,
    capabilities: [...first.capabilities].reverse(),
    executionContracts: [...first.executionContracts].reverse(),
  };

  assert.equal(createCapabilityPackageDigest(first), createCapabilityPackageDigest(reordered));
});

test('package provenance is included', async () => {
  const manifest = await buildPackage();

  assert.equal(manifest.provenance.compiledAt, '2026-06-07T00:00:00.000Z');
  assert.equal(manifest.provenance.graphDigest, manifest.graphDigest);
  assert.equal(manifest.provenance.material, 'descriptor_only');
});

test('package diff detects risk widening', async () => {
  const previous = await buildPackage();
  const next = clone(previous);
  next.capabilities[0].risk = 'destructive';
  next.capabilities[0].runtimeCallable = false;
  next.capabilities[0].executableByDefault = false;
  next.capabilities[0].riskClassification = {
    ...next.capabilities[0].riskClassification,
    level: 'destructive',
    destructive: true,
    sideEffecting: true,
  };

  const diff = diffCapabilityPackages(previous, next);
  assert.ok(diff.changes.some((change) => change.kind === 'risk_widened' && change.severity === 'critical'));
});

test('package diff detects auth scope widening', async () => {
  const previous = await buildPackage();
  const next = clone(previous);
  next.capabilities[0].authRequirement = {
    required: true,
    scopes: ['orders.read'],
    material: 'descriptor_only',
    grantsAuthorization: false,
  };

  const diff = diffCapabilityPackages(previous, next);
  assert.ok(diff.changes.some((change) => change.kind === 'auth_requirement_widened'));
  assert.ok(diff.changes.some((change) => change.kind === 'auth_scope_widened'));
});

test('package diff detects provider compatibility change', async () => {
  const previous = await buildPackage();
  const next = clone(previous);
  next.capabilities[0].providerCompatibility = ['browser_action_provider', 'api_read_provider'];

  const diff = diffCapabilityPackages(previous, next);
  assert.ok(diff.changes.some((change) => change.kind === 'provider_compatibility_changed'));
});

test('skill invocation can reference capability package', async () => {
  const manifest = await buildPackage();
  const skillInvocation = {
    packageId: manifest.packageId,
    packageVersion: manifest.version,
    capabilityRef: manifest.capabilities[0].capabilityRef,
    taskTextGrantsAuthorization: false,
  };
  const resolved = resolvePackageCapabilityRef(manifest, skillInvocation.capabilityRef);

  assert.equal(resolved.found, true);
  assert.equal(skillInvocation.taskTextGrantsAuthorization, false);
  assert.equal(resolved.capability.authRequirement.grantsAuthorization, false);
});

test('runtime invocation uses contract from package', async () => {
  const manifest = await buildPackage();
  const capability = manifest.capabilities[0];
  const contract = resolvePackageExecutionContractRef(manifest, capability.executionContractRef);
  const runtimeInvocation = {
    packageId: manifest.packageId,
    packageVersion: manifest.version,
    capabilityRef: capability.capabilityRef,
    executionContractRef: capability.executionContractRef,
    dryRun: true,
  };

  assert.equal(contract.found, true);
  assert.equal(contract.contract.kind, 'form_or_action');
  assert.equal(runtimeInvocation.executionContractRef, contract.contract.executionContractRef);
});

test('audit view can include package metadata', async () => {
  const manifest = await buildPackage();
  const auditView = {
    package: manifest.auditMetadata,
    providerInvoked: false,
    sideEffectAttempted: false,
  };

  assert.equal(auditView.package.packageId, manifest.packageId);
  assert.equal(auditView.package.version, manifest.version);
  assert.equal(auditView.package.packageDigest, manifest.packageDigest);
  assert.equal(auditView.providerInvoked, false);
  assert.equal(auditView.sideEffectAttempted, false);
});

test('package registry rejects raw secret fields and canaries', async () => {
  const manifest = await buildPackage();
  const registry = createCapabilityPackageRegistry({ registeredAt: '2026-06-07T00:00:00.000Z' });
  const entry = registry.register(manifest, { source: 'test' });

  assert.equal(entry.manifest.packageId, manifest.packageId);
  assert.doesNotMatch(JSON.stringify(entry), PACKAGE_CANARIES);
  assert.throws(
    () => registry.register({
      ...manifest,
      rawSessionMaterial: 'sf_package_session_secret_789',
    }),
    (error) => error.code === 'capability_package.raw_material_rejected',
  );
});

test('package validator rejects unknown provider compatibility metadata', async () => {
  const manifest = await buildPackage();
  const invalid = clone(manifest);
  invalid.capabilities[0].providerCompatibility = ['unknown_provider'];

  const report = validateCapabilityPackageManifest(invalid);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => String(error).includes('unknownProviderCompatibility')));
});

test('site adapter descriptor registry is descriptor-only', async () => {
  const manifest = await buildPackage();
  const registry = createSiteAdapterRegistry({ registeredAt: '2026-06-07T00:00:00.000Z' });
  const descriptor = sanitizeSiteAdapterDescriptor({
    adapterId: 'adapter:example.com:static',
    siteKey: 'example.com',
    version: '1.2.0',
    packageId: manifest.packageId,
    supportedCapabilityRefs: [manifest.capabilities[0].capabilityRef],
    providerCompatibility: ['browser_action_provider'],
  });
  const entry = registry.register(descriptor);
  const resolved = resolveSiteAdapterDescriptor(registry, 'adapter:example.com:static');

  assert.equal(entry.descriptor.material, 'descriptor_only');
  assert.equal(resolved.packageId, manifest.packageId);
  assert.throws(
    () => sanitizeSiteAdapterDescriptor({
      ...descriptor,
      artifactPath: 'C:/tmp/raw-artifact.json',
      requestHeaders: { cookie: 'sf_package_cookie_secret_123' },
    }),
    (error) => error.code === 'site_adapter_descriptor.raw_material_rejected',
  );
});

test('safe JSON import/export preserves sanitized package only', async () => {
  const manifest = await buildPackage();
  const json = exportCapabilityPackageSafeJson(manifest);
  const imported = importCapabilityPackageSafeJson(json);

  assert.equal(imported.packageDigest, manifest.packageDigest);
  assert.doesNotMatch(json, PACKAGE_CANARIES);
  assert.throws(
    () => importCapabilityPackageSafeJson(JSON.stringify({
      ...manifest,
      cookie: 'sf_package_cookie_secret_123',
      privateFormValue: 'sf_package_private_form_secret_456',
    })),
    (error) => error.code === 'capability_package.manifest_invalid',
  );
});

test('package compatibility requires review for widening changes', async () => {
  const previous = await buildPackage();
  const next = clone(previous);
  next.capabilities[0].authRequirement.required = true;
  const compatibility = assessCapabilityPackageCompatibility(previous, next);

  assert.equal(compatibility.compatible, false);
  assert.equal(compatibility.result, 'review_required');
});

test('package modules do not execute provider vault browser or network hooks', async () => {
  const manifest = await buildPackage();
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = () => {
    fetchCalled = true;
    throw new Error('package registry must not fetch');
  };
  try {
    const registry = createCapabilityPackageRegistry();
    registry.register(manifest);
    resolvePackageCapabilityRef(manifest, manifest.capabilities[0].capabilityRef);
    resolvePackageExecutionContractRef(manifest, manifest.capabilities[0].executionContractRef);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
