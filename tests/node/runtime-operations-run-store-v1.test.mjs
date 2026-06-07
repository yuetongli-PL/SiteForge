// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  RUNTIME_RUN_STORE_SCHEMA_VERSION,
  createRunStoreIntegrityDigest,
  createRunStoreManifest,
  createRunStoreQueryIndex,
  loadRuntimeRunStore,
  queryRunStoreIndex,
  resolveRunStorePath,
  sanitizeRunStoreManifest,
  writeRuntimeRunStore,
} from '../../src/app/runtime/index.mjs';

const RUNSTORE_CANARIES = /sf_runstore_cookie_secret_123|sf_runstore_token_secret_456|sf_runstore_artifact_secret_789/u;

async function tempRoot() {
  return mkdtemp(path.join(tmpdir(), 'siteforge-run-store-'));
}

function sanitizedRun(overrides = {}) {
  return {
    runId: 'run:phase17',
    createdAt: '2026-06-07T00:00:00.000Z',
    invocationRef: 'invocation:phase17',
    capabilityRef: 'sitepkg:example.com/contact-submit@1.0.0',
    executionContractRef: 'sitepkg:example.com/contract/contact-submit@1.0.0',
    providerId: 'browser_action_provider',
    packageId: 'sitepkg:example.com',
    status: 'completed',
    sideEffectAttempted: true,
    runtimeExecutionReport: {
      status: 'completed',
      providerId: 'browser_action_provider',
      sideEffectAttempted: true,
      redactionRequired: true,
    },
    auditEvents: [{
      eventType: 'runtime_execution_report',
      providerId: 'browser_action_provider',
      status: 'completed',
      redactionRequired: true,
    }],
    auditView: {
      runId: 'run:phase17',
      providerId: 'browser_action_provider',
      status: 'completed',
      redactionRequired: true,
    },
    artifactMetadata: [{
      artifactRef: 'artifact:phase17:safe-output',
      kind: 'runtime-output',
      digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      savedMaterial: 'sanitized_summary_only',
    }],
    policyDecisionSummary: {
      decisionId: 'policy-decision:phase17',
      policyId: 'policy-pack:siteforge-safe-defaults',
      reason: 'policy.controlled_browser_write_allowed',
      allowed: true,
    },
    vaultLedgerSummary: {
      eventCount: 0,
      rawMaterialPersisted: false,
    },
    retention: {
      retentionClass: 'standard',
      ttlDays: 30,
      purgeEligible: false,
    },
    redaction: {
      status: 'ok',
      sensitiveInputDetected: false,
    },
    sourceDigests: ['sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
    ...overrides,
  };
}

test('create run store manifest from sanitized run', () => {
  const manifest = createRunStoreManifest(sanitizedRun());

  assert.equal(manifest.schemaVersion, RUNTIME_RUN_STORE_SCHEMA_VERSION);
  assert.equal(manifest.runId, 'run:phase17');
  assert.equal(manifest.retention.rawMaterialRetentionAllowed, false);
  assert.equal(manifest.redaction.status, 'ok');
});

test('load run store into audit viewer shape', async () => {
  const root = await tempRoot();
  const manifest = await writeRuntimeRunStore(root, sanitizedRun());
  const loaded = await loadRuntimeRunStore(root, 'run-phase17/run_manifest.json');

  assert.equal(loaded.manifest.runId, manifest.runId);
  assert.equal(loaded.auditView.status, 'completed');
  assert.equal(loaded.providerInvoked, false);
});

test('query run store via audit query API shape', async () => {
  const root = await tempRoot();
  const manifest = await writeRuntimeRunStore(root, sanitizedRun());
  const index = createRunStoreQueryIndex([manifest]);
  const result = queryRunStoreIndex(index, { policyId: 'policy-pack:siteforge-safe-defaults' });

  assert.equal(result.count, 1);
  assert.equal(result.runs[0].providerId, 'browser_action_provider');
});

test('path traversal is rejected', async () => {
  const root = await tempRoot();
  assert.throws(
    () => resolveRunStorePath(root, '../outside.json'),
    (error) => error.code === 'run_store.path_rejected',
  );
});

test('absolute path is rejected', async () => {
  const root = await tempRoot();
  assert.throws(
    () => resolveRunStorePath(root, path.resolve(root, 'outside.json')),
    (error) => error.code === 'run_store.path_rejected',
  );
});

test('oversized file is rejected fail closed', async () => {
  const root = await tempRoot();
  await mkdir(path.join(root, 'run-oversized'), { recursive: true });
  await writeFile(path.join(root, 'run-oversized', 'run_manifest.json'), 'x'.repeat(100), 'utf8');

  await assert.rejects(
    () => loadRuntimeRunStore(root, 'run-oversized/run_manifest.json', { maxBytes: 10 }),
    (error) => error.code === 'run_store.file_too_large',
  );
});

test('missing optional files produce warning not crash', async () => {
  const root = await tempRoot();
  await mkdir(path.join(root, 'run-missing'), { recursive: true });
  const manifest = createRunStoreManifest({
    ...sanitizedRun({ runId: 'run:missing' }),
    files: [],
  });
  await writeFile(path.join(root, 'run-missing', 'run_manifest.json'), JSON.stringify(manifest), 'utf8');
  const loaded = await loadRuntimeRunStore(root, 'run-missing/run_manifest.json');

  assert.ok(loaded.warnings.includes('run_store.audit_view_missing'));
  assert.ok(loaded.warnings.includes('run_store.query_index_missing'));
});

test('integrity digest mismatch warning', async () => {
  const root = await tempRoot();
  await mkdir(path.join(root, 'run-digest'), { recursive: true });
  const manifest = {
    ...createRunStoreManifest(sanitizedRun({ runId: 'run:digest' })),
    integrityDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  };
  await writeFile(path.join(root, 'run-digest', 'run_manifest.json'), JSON.stringify(manifest), 'utf8');
  const loaded = await loadRuntimeRunStore(root, 'run-digest/run_manifest.json');

  assert.ok(loaded.warnings.includes('run_store.integrity_digest_mismatch'));
});

test('retention metadata is recorded', () => {
  const manifest = createRunStoreManifest(sanitizedRun({ retention: { retentionClass: 'short', ttlDays: 7 } }));

  assert.equal(manifest.retention.retentionClass, 'short');
  assert.equal(manifest.retention.ttlDays, 7);
  assert.equal(manifest.retention.rawMaterialRetentionAllowed, false);
});

test('raw artifact content is not read', async () => {
  const root = await tempRoot();
  const manifest = await writeRuntimeRunStore(root, sanitizedRun({
    files: [{
      kind: 'artifact_metadata',
      path: 'run-phase17/raw-artifact.txt',
      digest: createRunStoreIntegrityDigest(createRunStoreManifest(sanitizedRun())),
      sizeBytes: 99,
    }],
  }));
  await writeFile(path.join(root, 'run-phase17', 'raw-artifact.txt'), 'sf_runstore_artifact_secret_789', 'utf8');
  const loaded = await loadRuntimeRunStore(root, 'run-phase17/run_manifest.json');

  assert.equal(loaded.rawArtifactContentRead, false);
  assert.doesNotMatch(JSON.stringify(loaded), RUNSTORE_CANARIES);
  assert.equal(manifest.artifactMetadata[0].savedMaterial, 'sanitized_summary_only');
});

test('raw material canaries are not stored', async () => {
  assert.throws(
    () => sanitizeRunStoreManifest({
      ...sanitizedRun(),
      cookie: 'sf_runstore_cookie_secret_123',
      token: 'sf_runstore_token_secret_456',
    }),
    (error) => error.code === 'run_store.raw_material_rejected',
  );
});

test('run store does not execute provider vault browser or network', async () => {
  const root = await tempRoot();
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = () => {
    fetchCalled = true;
    throw new Error('run store must not fetch');
  };
  try {
    await writeRuntimeRunStore(root, sanitizedRun());
    const loaded = await loadRuntimeRunStore(root, 'run-phase17/run_manifest.json');
    assert.equal(loaded.providerInvoked, false);
    assert.equal(loaded.browserInvoked, false);
    assert.equal(loaded.vaultAccessed, false);
    assert.equal(loaded.networkInvoked, false);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
