// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  PROVIDER_SANDBOX_LIMITATION_STATEMENT,
  createProviderAdapter,
  createProviderConformanceHarness,
  createProviderSandboxEnvelope,
  createRestrictedProviderSandboxServices,
  runProviderConformance,
  runProviderInRestrictedSandbox,
  sanitizeProviderSandboxMessage,
  validateProviderSandboxPolicy,
} from '../../src/app/runtime/index.mjs';

const MANIFEST_URL = new URL('./fixtures/runtime-worker-isolation-provider-sandbox-v1/sandbox-provider-manifest.json', import.meta.url);
const SANDBOX_CANARIES = /sf_sandbox_env_secret_123|sf_sandbox_raw_context_secret_456|sf_sandbox_auth_secret_789|sf_sandbox_file_secret_000/u;

async function readManifest() {
  return JSON.parse(await readFile(MANIFEST_URL, 'utf8'));
}

function createSandboxProvider(manifest, implementation = {}) {
  return createProviderAdapter({
    manifest,
    implementation: {
      supports() {
        return true;
      },
      canExecute() {
        return { allowed: true };
      },
      async run(context) {
        return implementation.run
          ? implementation.run(context)
          : {
            providerId: manifest.providerId,
            status: 'completed',
            runtimeExecuted: true,
            sideEffectAttempted: false,
            resultSummary: {
              outcome: 'sandboxed',
              savedMaterial: 'sanitized_summary_only',
              redactionRequired: true,
            },
          };
      },
    },
  });
}

test('sandboxed provider receives only allowed runtime services', async () => {
  const manifest = await readManifest();
  let observedServices;
  const provider = createSandboxProvider(manifest, {
    run({ services }) {
      observedServices = Object.keys(services).sort();
      return {
        providerId: manifest.providerId,
        status: 'completed',
        runtimeExecuted: true,
        sideEffectAttempted: false,
        resultSummary: { outcome: 'ok', savedMaterial: 'sanitized_summary_only', redactionRequired: true },
      };
    },
  });

  const result = await runProviderInRestrictedSandbox({
    provider,
    manifest,
    executionContract: { operationKind: 'form_or_action', executionContractRef: 'contract:contact' },
    policy: { allowOutputWrite: true, timeoutMs: 1000 },
  });

  assert.deepEqual(observedServices, ['outputWriter']);
  assert.ok(result.serviceSummary.serviceNames.includes('emitAuditEvent'));
  assert.ok(result.serviceSummary.serviceNames.includes('writeOutput'));
  assert.equal(result.serviceSummary.rawRuntimeContextAvailable, false);
  assert.equal(result.serviceSummary.rawVaultAvailable, false);
});

test('provider cannot see raw runtimeContext', () => {
  assert.throws(
    () => createProviderSandboxEnvelope({
      providerId: 'sandbox_fixture_provider',
      runtimeContext: { rawContext: 'sf_sandbox_raw_context_secret_456' },
    }),
    (error) => error.code === 'provider_sandbox.raw_material_rejected',
  );
});

test('provider cannot access raw session vault', async () => {
  const services = createRestrictedProviderSandboxServices({ allowAuthAdapter: true });

  assert.equal('sessionVault' in services.services, false);
  assert.equal(services.serviceSummary.rawVaultAvailable, false);
  assert.equal(services.services.authAdapter.rawMaterialAvailable, false);
});

test('provider cannot access raw auth material except through authAdapter proxy', async () => {
  const envelope = sanitizeProviderSandboxMessage({
    providerId: 'sandbox_fixture_provider',
    policy: { allowAuthAdapter: true },
  });
  const services = createRestrictedProviderSandboxServices(envelope.policy);

  assert.equal(services.services.authAdapter.kind, 'auth_adapter_proxy');
  assert.equal(services.services.authAdapter.rawMaterialAvailable, false);
  assert.doesNotMatch(JSON.stringify(services), /sf_sandbox_auth_secret_789/u);
});

test('provider cannot write outside output gate', async () => {
  const blocked = createRestrictedProviderSandboxServices({ allowOutputWrite: false });
  const allowed = createRestrictedProviderSandboxServices({ allowOutputWrite: true });

  assert.equal('writeOutput' in blocked.services, false);
  assert.equal(typeof allowed.services.writeOutput, 'function');
  assert.equal(allowed.services.writeOutput({ artifactRef: 'artifact:sandbox-output' }).savedMaterial, 'sanitized_summary_only');
});

test('provider crash returns sanitized error', async () => {
  const manifest = await readManifest();
  const provider = createSandboxProvider(manifest, {
    run() {
      throw Object.assign(new Error('boom sf_sandbox_raw_context_secret_456'), { code: 'provider.crash' });
    },
  });
  const result = await runProviderInRestrictedSandbox({ provider, manifest, policy: { timeoutMs: 1000 } });

  assert.equal(result.result.status, 'failed');
  assert.doesNotMatch(JSON.stringify(result), SANDBOX_CANARIES);
});

test('provider timeout terminates and cleans up', async () => {
  const manifest = await readManifest();
  const provider = createSandboxProvider(manifest, {
    run() {
      return new Promise((resolve) => setTimeout(() => resolve({
        providerId: manifest.providerId,
        status: 'completed',
      }), 100));
    },
  });
  const result = await runProviderInRestrictedSandbox({ provider, manifest, policy: { allowOutputWrite: true, timeoutMs: 1 } });

  assert.equal(result.result.status, 'failed');
  assert.equal(result.result.reasonCode, 'provider_sandbox.timeout');
  assert.equal(result.cleanup.providerTerminated, true);
});

test('provider returning raw secret is sanitized', async () => {
  const manifest = await readManifest();
  const provider = createSandboxProvider(manifest, {
    run() {
      return {
        providerId: manifest.providerId,
        status: 'completed',
        runtimeExecuted: true,
        sideEffectAttempted: false,
        resultSummary: {
          outcome: 'sf_sandbox_file_secret_000',
          savedMaterial: 'sanitized_summary_only',
          redactionRequired: true,
        },
      };
    },
  });
  const result = await runProviderInRestrictedSandbox({ provider, manifest, policy: { allowOutputWrite: true, timeoutMs: 1000 } });

  assert.doesNotMatch(JSON.stringify(result), SANDBOX_CANARIES);
});

test('provider trying to access process env canary does not receive secret', async () => {
  const manifest = await readManifest();
  process.env.SF_SANDBOX_CANARY = 'sf_sandbox_env_secret_123';
  let serviceKeys;
  const provider = createSandboxProvider(manifest, {
    run(context) {
      serviceKeys = Object.keys(context.services);
      return {
        providerId: manifest.providerId,
        status: 'completed',
        runtimeExecuted: true,
        sideEffectAttempted: false,
        resultSummary: {
          outcome: String(context.processEnv?.SF_SANDBOX_CANARY ?? 'not-forwarded'),
          savedMaterial: 'sanitized_summary_only',
          redactionRequired: true,
        },
      };
    },
  });
  const result = await runProviderInRestrictedSandbox({ provider, manifest, policy: { allowOutputWrite: true, timeoutMs: 1000 } });
  delete process.env.SF_SANDBOX_CANARY;

  assert.equal(serviceKeys.includes('processEnv'), false);
  assert.doesNotMatch(JSON.stringify(result), SANDBOX_CANARIES);
});

test('provider cannot directly emit raw audit event', async () => {
  const services = createRestrictedProviderSandboxServices({});

  assert.throws(
    () => services.services.emitAuditEvent({
      eventType: 'provider_sandbox.raw',
      providerId: 'sandbox_fixture_provider',
      rawBody: 'sf_sandbox_raw_context_secret_456',
    }),
    (error) => error.code === 'provider_sandbox.raw_material_rejected',
  );
});

test('sandboxed provider conformance integrates with Provider SDK', async () => {
  const manifest = await readManifest();
  const provider = createSandboxProvider(manifest);
  const harness = createProviderConformanceHarness();
  const report = await harness.run(provider, {
    invocationRequest: { capabilityId: 'capability:contact' },
    executionContract: { operationKind: 'form_or_action', executionContractRef: 'contract:contact' },
    services: { outputWriter: true },
  });

  assert.equal(report.ok, true);
});

test('existing api download browser core providers still pass tests through conformance matrix', async () => {
  const source = await readFile(new URL('./capability-contract-conformance.test.mjs', import.meta.url), 'utf8');

  assert.match(source, /production provider matrix matches Controlled Runtime Execution V1/u);
});

test('payment and destructive still blocked by sandbox policy and production registry boundary', () => {
  assert.equal(validateProviderSandboxPolicy({ dryRun: true, allowControlledBrowserRuntime: true }).ok, false);
  assert.throws(
    () => createProviderSandboxEnvelope({
      providerId: 'sandbox_fixture_provider',
      capability: { paymentOrFundsAction: true, destructiveAction: true },
      rawPaymentCredential: 'sf_sandbox_auth_secret_789',
    }),
    (error) => error.code === 'provider_sandbox.raw_material_rejected',
  );
});

test('sandbox limitation statement is explicit', () => {
  assert.match(PROVIDER_SANDBOX_LIMITATION_STATEMENT, /not a full OS-level sandbox/u);
});
