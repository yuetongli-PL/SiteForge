import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REDACTION_PLACEHOLDER,
  STANDARD_TASK_LIST_SCHEMA_VERSION,
  assertStandardTaskListCompatible,
  normalizeStandardTaskList,
} from '../../src/sites/capability/standard-task-list.mjs';

test('StandardTaskList normalizes versioned low-permission task items', () => {
  const list = normalizeStandardTaskList({
    siteKey: 'instagram',
    taskType: 'social-archive',
    policyRef: 'download-policy:instagram:1',
    items: [{
      id: 'item-1',
      kind: 'download',
      endpoint: 'https://example.test/api/media?access_token=synthetic-token&cursor=1',
      method: 'get',
      capability: 'media.read',
      mode: 'read',
      pagination: {
        type: 'cursor',
        cursorField: 'next',
        pageSize: '20',
      },
      retry: {
        retries: 2.6,
        retryBackoffMs: '500',
      },
      cacheKey: 'media:1',
      dedupKey: 'media:1',
      reasonCode: 'download-failed',
    }],
  });

  assert.equal(list.schemaVersion, STANDARD_TASK_LIST_SCHEMA_VERSION);
  assert.equal(list.siteKey, 'instagram');
  assert.equal(list.taskType, 'social-archive');
  assert.equal(list.policyRef, 'download-policy:instagram:1');
  assert.equal(list.items[0].kind, 'download');
  assert.equal(list.items[0].method, 'GET');
  assert.equal(list.items[0].capability, 'media.read');
  assert.equal(list.items[0].mode, 'read');
  assert.equal(
    list.items[0].endpoint.includes(REDACTION_PLACEHOLDER)
      || list.items[0].endpoint.includes(encodeURIComponent(REDACTION_PLACEHOLDER)),
    true,
  );
  assert.equal(list.items[0].endpoint.includes('synthetic-token'), false);
  assert.deepEqual(list.items[0].pagination, {
    type: 'cursor',
    cursorField: 'next',
    pageSize: 20,
  });
  assert.deepEqual(list.items[0].retry, {
    retries: 2,
    retryBackoffMs: 500,
  });
  assert.equal(list.items[0].reasonCode, 'download-failed');
});

test('StandardTaskList preserves redacted SiteHealthExecutionGate decisions', () => {
  const list = normalizeStandardTaskList({
    siteKey: 'x',
    taskType: 'post-write',
    items: [{
      id: 'post-1',
      kind: 'request',
      endpoint: 'https://example.test/api/post',
      capability: 'post.write',
      mode: 'write',
      healthGate: {
        schemaVersion: 1,
        allowed: false,
        mode: 'readonly',
        capability: 'post.write',
        status: 'blocked',
        reason: 'profilePath=C:/Users/example/Profile 1',
        artifactWriteAllowed: false,
        blockedCapabilities: ['post.write'],
        recommendedActions: ['switch-to-readonly-mode'],
        capabilityState: 'healthy',
        siteStatus: 'degraded',
      },
    }],
  });

  assert.equal(list.items[0].healthGate.allowed, false);
  assert.equal(list.items[0].healthGate.reason.includes('Profile 1'), false);
  assert.deepEqual(list.items[0].healthGate.blockedCapabilities, ['post.write']);
});

test('StandardTaskList rejects raw credential containers and invalid fields', () => {
  assert.throws(
    () => normalizeStandardTaskList({ items: [] }),
    /siteKey is required/u,
  );
  assert.throws(
    () => normalizeStandardTaskList({ siteKey: 'x', items: {} }),
    /items must be an array/u,
  );
  assert.throws(
    () => normalizeStandardTaskList({
      siteKey: 'x',
      items: [{ endpoint: 'https://example.test/', headers: { authorization: 'Bearer syntheticHeaderToken' } }],
    }),
    /must not expose raw headers/u,
  );
  assert.throws(
    () => normalizeStandardTaskList({
      siteKey: 'x',
      items: [{ endpoint: 'https://example.test/', retry: { retries: -1 } }],
    }),
    /retry\.retries must be a non-negative number/u,
  );
});

test('StandardTaskList requires endpoints and supported item kinds', () => {
  assert.throws(
    () => normalizeStandardTaskList({ siteKey: 'x', items: [{}] }),
    /item endpoint is required/u,
  );
  assert.throws(
    () => normalizeStandardTaskList({
      siteKey: 'x',
      items: [{ kind: 'admin', endpoint: 'https://example.test/' }],
    }),
    /Unsupported StandardTaskList item kind/u,
  );
});

test('StandardTaskList compatibility guard requires the current schema version', () => {
  assert.equal(assertStandardTaskListCompatible({ schemaVersion: STANDARD_TASK_LIST_SCHEMA_VERSION }), true);
  assert.throws(
    () => assertStandardTaskListCompatible({}),
    /schemaVersion is required/u,
  );
  assert.throws(
    () => assertStandardTaskListCompatible({ schemaVersion: STANDARD_TASK_LIST_SCHEMA_VERSION + 1 }),
    /not compatible/u,
  );
  assert.throws(
    () => normalizeStandardTaskList({
      schemaVersion: STANDARD_TASK_LIST_SCHEMA_VERSION + 1,
      siteKey: 'x',
      items: [{ endpoint: 'https://example.test/' }],
    }),
    /not compatible/u,
  );
});
