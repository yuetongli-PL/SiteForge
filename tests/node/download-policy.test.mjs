import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOWNLOAD_POLICY_SCHEMA_VERSION,
  assertDownloadPolicyCompatible,
  normalizeDownloadPolicy,
} from '../../src/sites/capability/download-policy.mjs';

test('DownloadPolicy normalizes a minimal low-permission policy', () => {
  const policy = normalizeDownloadPolicy({
    siteKey: 'instagram',
    taskType: 'social-archive',
    dryRun: false,
    allowNetworkResolve: true,
    retries: 2.8,
    retryBackoffMs: '1000',
    cache: true,
    dedup: { enabled: false },
    sessionRequirement: 'required',
    reasonCode: 'download-failed',
  });

  assert.equal(policy.schemaVersion, DOWNLOAD_POLICY_SCHEMA_VERSION);
  assert.equal(policy.siteKey, 'instagram');
  assert.equal(policy.taskType, 'social-archive');
  assert.equal(policy.dryRun, false);
  assert.equal(policy.allowNetworkResolve, true);
  assert.equal(policy.retries, 2);
  assert.equal(policy.retryBackoffMs, 1000);
  assert.deepEqual(policy.cache, { enabled: true });
  assert.deepEqual(policy.dedup, { enabled: false });
  assert.equal(policy.sessionRequirement, 'required');
  assert.equal(policy.reasonCode, 'download-failed');
});

test('DownloadPolicy applies safe defaults without enabling network access', () => {
  const policy = normalizeDownloadPolicy({ siteKey: 'bilibili' });

  assert.equal(policy.dryRun, true);
  assert.equal(policy.allowNetworkResolve, false);
  assert.equal(policy.retries, 0);
  assert.equal(policy.retryBackoffMs, 0);
  assert.deepEqual(policy.cache, { enabled: true });
  assert.deepEqual(policy.dedup, { enabled: true });
  assert.equal(policy.sessionRequirement, 'none');
});

test('DownloadPolicy rejects invalid required fields and values', () => {
  assert.throws(
    () => normalizeDownloadPolicy({}),
    /siteKey is required/u,
  );
  assert.throws(
    () => normalizeDownloadPolicy({ siteKey: 'x', retries: -1 }),
    /retries must be a non-negative number/u,
  );
  assert.throws(
    () => normalizeDownloadPolicy({ siteKey: 'x', sessionRequirement: 'admin' }),
    /Unsupported DownloadPolicy sessionRequirement/u,
  );
});

test('DownloadPolicy compatibility guard requires the current schema version', () => {
  assert.equal(assertDownloadPolicyCompatible({ schemaVersion: DOWNLOAD_POLICY_SCHEMA_VERSION }), true);
  assert.throws(
    () => assertDownloadPolicyCompatible({}),
    /schemaVersion is required/u,
  );
  assert.throws(
    () => assertDownloadPolicyCompatible({ schemaVersion: DOWNLOAD_POLICY_SCHEMA_VERSION + 1 }),
    /not compatible/u,
  );
  assert.throws(
    () => normalizeDownloadPolicy({
      schemaVersion: DOWNLOAD_POLICY_SCHEMA_VERSION + 1,
      siteKey: 'x',
    }),
    /not compatible/u,
  );
});
