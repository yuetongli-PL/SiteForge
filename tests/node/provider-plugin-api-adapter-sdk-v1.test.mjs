import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import * as runtimeIndex from '../../src/app/runtime/index.mjs';
import {
  PROVIDER_MANIFEST_SCHEMA_VERSION,
  attachProviderManifest,
  createProductionRuntimeProviderRegistry,
  createProductionRuntimeProviders,
  createProviderAdapter,
  createProviderConformanceHarness,
  createRuntimeProviderRegistry,
  createRuntimeProviderRegistryWith,
  runProviderConformance,
  sanitizeProviderResult,
  validateProviderManifest,
  validateProviderRegistration,
  validateProviderRuntimeCompatibility,
} from '../../src/app/runtime/index.mjs';
import {
  createSafeFixtureProvider as createSdkFixtureProvider,
} from '../../src/app/runtime/provider-sdk/index.mjs';

const MANIFEST_URL = new URL('./fixtures/provider-plugin-api-adapter-sdk-v1/valid-provider-manifest.json', import.meta.url);
const PROVIDER_CANARIES = /sf_provider_cookie_secret_123|sf_provider_token_secret_456|sf_provider_env_secret_789|sf_provider_raw_body_secret_000/u;

async function readManifest() {
  return JSON.parse(await readFile(MANIFEST_URL, 'utf8'));
}

function providerWithManifest(manifest, overrides = {}) {
  return {
    id: manifest.providerId,
    providerId: manifest.providerId,
    manifest,
    supports() {
      return true;
    },
    canExecute() {
      return { allowed: true };
    },
    async run() {
      return {
        providerId: manifest.providerId,
        status: 'completed',
        runtimeExecuted: true,
        sideEffectAttempted: false,
        resultSummary: {
          outcome: 'provider_completed',
          providerId: manifest.providerId,
          artifactRefs: [],
          savedMaterial: 'sanitized_summary_only',
          redactionRequired: true,
        },
      };
    },
    ...overrides,
  };
}

function withManifestPatch(manifest, patch) {
  return {
    ...structuredClone(manifest),
    ...patch,
    riskProfile: {
      ...manifest.riskProfile,
      ...(patch.riskProfile ?? {}),
    },
    runtimeServices: {
      ...manifest.runtimeServices,
      ...(patch.runtimeServices ?? {}),
    },
    resultPolicy: {
      ...manifest.resultPolicy,
      ...(patch.resultPolicy ?? {}),
    },
  };
}

function findingCodes(report) {
  return report.findings.map((finding) => finding.reasonCode);
}

test('valid provider manifest is accepted', async () => {
  const manifest = await readManifest();
  const report = validateProviderManifest(manifest, { production: true });

  assert.equal(report.ok, true);
  assert.equal(report.manifest.schemaVersion, PROVIDER_MANIFEST_SCHEMA_VERSION);
  assert.equal(report.manifest.providerId, 'safe_fixture_provider');
});

test('missing providerId and schemaVersion are rejected', async () => {
  const manifest = await readManifest();
  const report = validateProviderManifest({
    ...manifest,
    schemaVersion: undefined,
    providerId: undefined,
  }, { production: true });

  assert.equal(report.ok, false);
  assert.ok(findingCodes(report).includes('provider.manifest.schema_version_invalid'));
  assert.ok(findingCodes(report).includes('provider.manifest.provider_id_required'));
});

test('payment and destructive providers are rejected from production registry by default', async () => {
  const manifest = await readManifest();
  const paymentProvider = providerWithManifest(withManifestPatch(manifest, {
    providerId: 'payment_fixture_provider',
    riskProfile: { sideEffects: 'payment' },
  }));
  const destructiveProvider = providerWithManifest(withManifestPatch(manifest, {
    providerId: 'destructive_fixture_provider',
    riskProfile: { sideEffects: 'destructive' },
  }));

  assert.equal(validateProviderRegistration(paymentProvider, { production: true }).ok, false);
  assert.ok(findingCodes(validateProviderRegistration(paymentProvider, { production: true })).includes('provider.payment_production_registration_forbidden'));
  assert.equal(validateProviderRegistration(destructiveProvider, { production: true }).ok, false);
  assert.ok(findingCodes(validateProviderRegistration(destructiveProvider, { production: true })).includes('provider.destructive_production_registration_forbidden'));
  assert.throws(
    () => createRuntimeProviderRegistry([], { production: true }).register(paymentProvider),
    /payment side effects cannot be registered/u,
  );
});

test('supports side effect is rejected by conformance harness', async () => {
  const manifest = await readManifest();
  const provider = providerWithManifest(manifest, {
    supports() {
      this.mutatedBySupports = true;
      return true;
    },
  });
  const report = runProviderConformance(provider, { production: true });

  assert.equal(report.ok, false);
  assert.ok(findingCodes(report).includes('provider.supports_mutation_forbidden'));
});

test('canExecute vault access is rejected by conformance harness', async () => {
  const manifest = await readManifest();
  const provider = providerWithManifest(manifest, {
    canExecute(options = {}) {
      return options.runtimeContext.sessionVault.inspect();
    },
  });
  const report = createProviderConformanceHarness({ production: true }).run(provider);

  assert.equal(report.ok, false);
  assert.ok(findingCodes(report).includes('provider.canExecute_side_effect_forbidden'));
  assert.doesNotMatch(JSON.stringify(report), PROVIDER_CANARIES);
});

test('provider raw headers body cookie and token output is sanitized', async () => {
  const manifest = await readManifest();
  const sanitized = sanitizeProviderResult({
    providerId: manifest.providerId,
    status: 'completed',
    runtimeExecuted: true,
    sideEffectAttempted: false,
    headers: {
      authorization: 'Bearer sf_provider_token_secret_456',
      cookie: 'sf_provider_cookie_secret_123',
    },
    rawBody: 'sf_provider_raw_body_secret_000',
    resultSummary: {
      outcome: 'provider_completed',
      providerId: manifest.providerId,
      rawHeaders: {
        cookie: 'sf_provider_cookie_secret_123',
      },
      artifactRefs: [],
      savedMaterial: 'sanitized_summary_only',
      redactionRequired: true,
    },
  }, manifest);

  assert.doesNotMatch(JSON.stringify(sanitized), PROVIDER_CANARIES);
  assert.ok(sanitized.warnings.includes('provider.raw_output_field_removed'));
  assert.ok(sanitized.resultSummary.warnings.includes('provider.raw_output_field_removed'));
});

test('provider direct report or audit write access is not exposed during conformance', async () => {
  const manifest = await readManifest();
  const provider = providerWithManifest(manifest, {
    canExecute(options = {}) {
      options.runtimeContext.writeReport({ secret: 'sf_provider_env_secret_789' });
      return { allowed: true };
    },
  });
  const report = runProviderConformance(provider, { production: true });

  assert.equal(report.ok, false);
  assert.ok(findingCodes(report).includes('provider.canExecute_side_effect_forbidden'));
  assert.doesNotMatch(JSON.stringify(report), PROVIDER_CANARIES);
});

test('provider adapter passes only safe context and sanitizes implementation result', async () => {
  const manifest = await readManifest();
  let implementationSawRawContext = false;
  const adapter = createProviderAdapter({
    manifest,
    implementation: {
      supports(context = {}) {
        implementationSawRawContext = implementationSawRawContext
          || Object.hasOwn(context, 'runtimeContext')
          || Object.hasOwn(context, 'sessionVault');
        return true;
      },
      canExecute(context = {}) {
        implementationSawRawContext = implementationSawRawContext
          || Object.hasOwn(context, 'runtimeContext')
          || Object.hasOwn(context.services ?? {}, 'sessionVault');
        return { allowed: true };
      },
      async run(context = {}) {
        implementationSawRawContext = implementationSawRawContext
          || Object.hasOwn(context, 'runtimeContext')
          || Object.hasOwn(context, 'sessionVault')
          || Object.hasOwn(context.services ?? {}, 'sessionVault');
        return {
          providerId: manifest.providerId,
          status: 'completed',
          runtimeExecuted: true,
          sideEffectAttempted: false,
          rawBody: 'sf_provider_raw_body_secret_000',
          resultSummary: {
            outcome: 'provider_completed',
            providerId: manifest.providerId,
            rawHeaders: {
              authorization: 'Bearer sf_provider_token_secret_456',
            },
            artifactRefs: [],
            savedMaterial: 'sanitized_summary_only',
            redactionRequired: true,
          },
        };
      },
    },
  });

  assert.equal(adapter.supports({
    invocationRequest: {
      capabilityId: 'capability:provider-sdk:read',
      rawCookie: 'sf_provider_cookie_secret_123',
    },
    runtimeContext: {
      sessionVault: { raw: 'sf_provider_env_secret_789' },
    },
  }), true);
  assert.deepEqual(adapter.canExecute({
    services: {},
    runtimeContext: {
      sessionVault: { raw: 'sf_provider_env_secret_789' },
    },
  }), { allowed: true });
  const result = await adapter.run({
    services: {},
    runtimeContext: {
      sessionVault: { raw: 'sf_provider_env_secret_789' },
    },
  });

  assert.equal(implementationSawRawContext, false);
  assert.doesNotMatch(JSON.stringify(result), PROVIDER_CANARIES);
  assert.ok(result.warnings.includes('provider.raw_output_field_removed'));
  assert.ok(result.resultSummary.warnings.includes('provider.raw_output_field_removed'));
});

test('browser runtime provider cannot run unless controlled runtime service is provided', async () => {
  const manifest = withManifestPatch(await readManifest(), {
    providerId: 'browser_fixture_provider',
    runtimeServices: {
      requiresBrowserRuntime: true,
    },
    riskProfile: {
      sideEffects: 'external_write',
      requiresControlledRuntime: true,
    },
  });

  assert.equal(validateProviderRuntimeCompatibility(manifest, {}).ok, false);
  assert.ok(findingCodes(validateProviderRuntimeCompatibility(manifest, {})).includes('provider.controlled_browser_runtime_required'));
  assert.equal(validateProviderRuntimeCompatibility(manifest, { controlledBrowserRuntime: true }).ok, true);
});

test('provider requiring auth material cannot access SessionVault directly', async () => {
  const manifest = withManifestPatch(await readManifest(), {
    providerId: 'auth_fixture_provider',
    runtimeServices: {
      requiresSessionMaterial: true,
    },
  });
  const provider = providerWithManifest(manifest);
  const report = validateProviderRegistration(provider, { production: true });

  assert.equal(report.ok, false);
  assert.ok(findingCodes(report).includes('provider.auth_direct_session_material_forbidden'));
  assert.ok(findingCodes(report).includes('provider.session_material_service_forbidden'));
});

test('runtime index exports production SDK helpers but not testing fixture providers', () => {
  assert.equal(typeof runtimeIndex.validateProviderManifest, 'function');
  assert.equal(typeof runtimeIndex.createProviderConformanceHarness, 'function');
  assert.equal(Object.hasOwn(runtimeIndex, 'createSafeFixtureProvider'), false);
  assert.equal(Object.hasOwn(runtimeIndex, 'createRuntimeRegressionSnapshotFixture'), false);
  assert.equal(Object.hasOwn(runtimeIndex, 'createInMemorySessionVaultProvider'), false);
  assert.equal(Object.hasOwn(runtimeIndex, 'createSessionVaultProvider'), false);
  assert.equal(Object.hasOwn(runtimeIndex, 'createInMemoryProductionVaultAdapter'), false);
  assert.equal(Object.hasOwn(runtimeIndex, 'normalizeSessionMaterialGrant'), false);
  assert.deepEqual(
    Object.keys(runtimeIndex).filter((key) => /mock|fake|test|testing|fixture|raw/i.test(key)).sort(),
    [],
  );
  assert.equal(typeof createSdkFixtureProvider, 'function');
});

test('production registry contains only validated providers', () => {
  const providers = createProductionRuntimeProviders();
  assert.equal(providers.length, 3);
  assert.ok(providers.every((provider) => provider.manifest?.schemaVersion === PROVIDER_MANIFEST_SCHEMA_VERSION));

  const registry = createProductionRuntimeProviderRegistry();
  assert.deepEqual(registry.list().map((provider) => provider.id).sort(), [
    'api_read_provider',
    'browser_action_provider',
    'download_provider',
  ]);
});

test('payment and destructive remain blocked by production provider resolution', () => {
  const registry = createProductionRuntimeProviderRegistry();

  assert.equal(registry.resolve({
    executionContract: {
      operationKind: 'payment',
      paymentOrFundsAction: true,
    },
  }), null);
  assert.equal(registry.resolve({
    executionContract: {
      operationKind: 'destructive',
      destructiveAction: true,
    },
  }), null);
});

test('safe fixture provider is available only through provider-sdk and passes conformance', () => {
  const provider = createSdkFixtureProvider({ providerId: 'sdk_fixture_provider' });
  const registry = createRuntimeProviderRegistryWith([provider]);
  const report = runProviderConformance(provider);

  assert.equal(registry.get('sdk_fixture_provider')?.id, 'sdk_fixture_provider');
  assert.equal(report.ok, true);
});

test('provider conformance reports sanitize sample result canaries', async () => {
  const manifest = await readManifest();
  const provider = providerWithManifest(manifest);
  const report = runProviderConformance(provider, {
    production: true,
    sampleResult: {
      providerId: manifest.providerId,
      status: 'completed',
      cookie: 'sf_provider_cookie_secret_123',
      resultSummary: {
        outcome: 'provider_completed',
        rawBody: 'sf_provider_raw_body_secret_000',
      },
    },
  });

  assert.equal(report.ok, false);
  assert.ok(findingCodes(report).includes('provider.result_raw_output_sanitized'));
  assert.doesNotMatch(JSON.stringify(report), PROVIDER_CANARIES);
});

test('attachProviderManifest rejects invalid SDK example manifests', async () => {
  const manifest = await readManifest();
  const provider = providerWithManifest(manifest);
  const attached = attachProviderManifest(provider, manifest);

  assert.equal(attached.manifest.providerId, 'safe_fixture_provider');
  assert.throws(
    () => attachProviderManifest(provider, { ...manifest, providerId: '' }),
    /Provider manifest providerId is required/u,
  );
});
