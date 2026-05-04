import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  REDACTION_PLACEHOLDER,
} from '../../src/sites/capability/security-guard.mjs';
import {
  SESSION_VIEW_SCHEMA_VERSION,
  SESSION_VIEW_MATERIALIZATION_AUDIT_SCHEMA_VERSION,
  SESSION_REVOCATION_STORE_SCHEMA_VERSION,
  assertSessionViewCompatible,
  assertSessionViewMaterializationAuditCompatible,
  assertSessionRevocationAllowed,
  assertSessionRevocationStoreCompatible,
  assertSessionViewSafe,
  createSessionRevocationStore,
  createSessionViewMaterializationAudit,
  normalizeSessionView,
  registerSessionRevocationHandle,
  revokeSessionRevocationHandle,
} from '../../src/sites/capability/session-view.mjs';

test('SessionView normalizes minimal access fields and redacts sensitive context', () => {
  const view = normalizeSessionView({
    siteKey: 'example.test',
    profileRef: 'C:/Users/example/browser-profile-1',
    purpose: 'downloader',
    scope: ['media', 'timeline'],
    permission: ['read'],
    ttlSeconds: 60.8,
    expiresAt: '2026-04-30T12:00:00.000Z',
    status: 'ready',
    reasonCode: 'session-invalid',
    riskSignals: ['refresh_token=synthetic-session-token'],
    networkContext: {
      authorization: 'Bearer syntheticNetworkToken',
      headers: { authorization: 'Bearer syntheticNestedToken' },
      cookies: [{ name: 'sid', value: 'synthetic-cookie' }],
      csrf: 'synthetic-csrf-token',
      token: 'synthetic-token',
      safe: 'kept',
    },
    cookies: [{ name: 'sid', value: 'synthetic-cookie' }],
    headers: { authorization: 'Bearer syntheticHeaderToken' },
    csrf: 'synthetic-csrf-token',
    token: 'synthetic-token',
  });

  assert.equal(view.schemaVersion, SESSION_VIEW_SCHEMA_VERSION);
  assert.equal(view.siteKey, 'example.test');
  assert.equal(view.profileRef, REDACTION_PLACEHOLDER);
  assert.equal(view.purpose, 'downloader');
  assert.deepEqual(view.scope, ['media', 'timeline']);
  assert.deepEqual(view.permission, ['read']);
  assert.equal(view.ttlSeconds, 60);
  assert.equal(view.status, 'ready');
  assert.equal(view.reasonCode, 'session-invalid');
  assert.equal(view.networkContext.safe, 'kept');
  assert.equal(Object.hasOwn(view.networkContext, 'authorization'), false);
  assert.equal(Object.hasOwn(view.networkContext, 'headers'), false);
  assert.equal(Object.hasOwn(view.networkContext, 'cookies'), false);
  assert.equal(Object.hasOwn(view.networkContext, 'csrf'), false);
  assert.equal(Object.hasOwn(view.networkContext, 'token'), false);
  assert.deepEqual(view.riskSignals, [REDACTION_PLACEHOLDER]);
  assert.equal(Object.hasOwn(view, 'cookies'), false);
  assert.equal(Object.hasOwn(view, 'headers'), false);
  assert.equal(Object.hasOwn(view, 'csrf'), false);
  assert.equal(Object.hasOwn(view, 'token'), false);
  assert.doesNotMatch(JSON.stringify(view), /synthetic-(?:cookie|token|csrf|session)/u);
});

test('SessionView rejects missing site keys and invalid TTL values', () => {
  assert.throws(
    () => normalizeSessionView({ ttlSeconds: 60 }),
    /siteKey is required/u,
  );
  assert.throws(
    () => normalizeSessionView({ siteKey: 'example.test', ttlSeconds: 0 }),
    /ttlSeconds must be a positive number/u,
  );
});

test('SessionView rejects unsafe diagnostic materialization requests', () => {
  assert.throws(
    () => normalizeSessionView({
      siteKey: 'example.test',
      purpose: 'diagnostic',
      permission: ['write'],
      ttlSeconds: 60,
    }),
    /diagnostic permission write is not least-privilege/u,
  );
  assert.throws(
    () => normalizeSessionView({
      siteKey: 'example.test',
      purpose: 'diagnostic',
      scope: ['raw-session-material'],
      permission: ['read'],
      ttlSeconds: 60,
    }),
    /diagnostic scope raw-session-material crosses the trust boundary/u,
  );
  assert.throws(
    () => normalizeSessionView({
      siteKey: 'example.test',
      purpose: 'diagnostic',
      scope: ['network-observation'],
      permission: ['read'],
      ttlSeconds: 301,
    }),
    /diagnostic ttlSeconds must not exceed 300/u,
  );

  assert.equal(normalizeSessionView({
    siteKey: 'example.test',
    purpose: 'diagnostic',
    scope: ['network-observation'],
    permission: ['read'],
    ttlSeconds: 300,
  }).ttlSeconds, 300);
});

test('SessionView rejects diagnostic identity crossings and redacts nested identity context', () => {
  for (const scope of [
    'artifact-profile-ref',
    'api-candidate-account-id',
    'downloader-session-id',
    'network-identity',
  ]) {
    assert.throws(
      () => normalizeSessionView({
        siteKey: 'example.test',
        purpose: 'diagnostic',
        scope: [scope],
        permission: ['read'],
        ttlSeconds: 60,
      }),
      /diagnostic scope .* (?:exposes identity-like trust-boundary material|crosses the trust boundary)/u,
    );
  }

  const view = normalizeSessionView({
    siteKey: 'example.test',
    purpose: 'diagnostic',
    scope: ['artifact-summary', 'api-candidate-summary', 'network-observation'],
    permission: ['read'],
    ttlSeconds: 60,
    networkContext: {
      accountId: 'synthetic-account-id',
      browserProfile: 'C:/Users/example/browser-profile-1',
      deviceFingerprint: 'synthetic-device-fingerprint',
      ipAddress: '203.0.113.10',
      networkIdentity: 'synthetic-network-identity',
      profileId: 'synthetic-profile-id',
      sessionRef: 'synthetic-session-ref',
      userHandle: 'synthetic-user-handle',
      safe: 'kept',
    },
  });

  assert.deepEqual(view.scope, ['artifact-summary', 'api-candidate-summary', 'network-observation']);
  assert.equal(view.networkContext.safe, 'kept');
  for (const key of [
    'accountId',
    'browserProfile',
    'deviceFingerprint',
    'ipAddress',
    'networkIdentity',
    'profileId',
    'sessionRef',
    'userHandle',
  ]) {
    assert.equal(Object.hasOwn(view.networkContext, key), false);
  }
  assert.doesNotMatch(
    JSON.stringify(view),
    /synthetic-(?:account|device|network|profile|session|user)|browser-profile|203\.0\.113\.10/u,
  );
});

test('SessionView purpose isolation blocks non-download purposes from download access and broad scopes', () => {
  assert.throws(
    () => normalizeSessionView({
      siteKey: 'example.test',
      purpose: 'archive',
      scope: ['archive'],
      permission: ['download'],
      ttlSeconds: 120,
    }),
    /archive permission download cannot request download access/u,
  );
  assert.throws(
    () => normalizeSessionView({
      siteKey: 'example.test',
      purpose: 'followed',
      scope: ['download-media'],
      permission: ['read'],
      ttlSeconds: 120,
    }),
    /followed scope download-media cannot request download access/u,
  );
  assert.throws(
    () => normalizeSessionView({
      siteKey: 'example.test',
      purpose: 'keepalive',
      scope: ['all-sites'],
      permission: ['read'],
      ttlSeconds: 120,
    }),
    /keepalive scope all-sites is broader than its purpose/u,
  );

  const view = normalizeSessionView({
    siteKey: 'example.test',
    purpose: 'download',
    scope: ['download-media'],
    permission: ['download'],
    ttlSeconds: 120,
  });
  assert.deepEqual(view.scope, ['download-media']);
  assert.deepEqual(view.permission, ['download']);
});

test('SessionView rejects raw profile or session references in materialization scope', () => {
  assert.throws(
    () => normalizeSessionView({
      siteKey: 'example.test',
      purpose: 'download',
      scope: ['C:/Users/example/browser-profiles/example.test'],
      permission: ['read'],
      ttlSeconds: 120,
    }),
    /must not expose raw profile\/session refs/u,
  );
  assert.throws(
    () => createSessionViewMaterializationAudit({
      siteKey: 'example.test',
      purpose: 'download',
      scope: ['opaque-session-ref'],
      permission: ['read'],
      ttlSeconds: 120,
    }),
    /must not expose raw profile\/session refs/u,
  );
});

test('SessionView safety guard rejects raw credential containers and secret-like values', () => {
  assert.throws(
    () => assertSessionViewSafe({ siteKey: 'example.test', headers: {} }),
    /must not expose raw headers/u,
  );
  assert.throws(
    () => assertSessionViewSafe({ siteKey: 'example.test', networkContext: { cookies: [] } }),
    /must not expose raw cookies/u,
  );
  assert.throws(
    () => assertSessionViewSafe({ siteKey: 'example.test', networkContext: { headers: { authorization: 'safe' } } }),
    /must not expose raw headers/u,
  );
  assert.throws(
    () => assertSessionViewSafe({ siteKey: 'example.test', networkContext: { csrf: 'safe' } }),
    /must not expose raw csrf/u,
  );
  assert.throws(
    () => assertSessionViewSafe({ siteKey: 'example.test', networkContext: { token: 'safe' } }),
    /must not expose raw token/u,
  );
  assert.throws(
    () => assertSessionViewSafe({ siteKey: 'example.test', note: 'synthetic-token' }),
    /contains synthetic secret material/u,
  );
  assert.throws(
    () => assertSessionViewSafe({ siteKey: 'example.test', networkContext: { accountId: 'safe' } }),
    /must not expose trust-boundary identity field accountId/u,
  );
  assert.throws(
    () => assertSessionViewSafe({ siteKey: 'example.test', networkContext: { networkIdentity: 'safe' } }),
    /must not expose trust-boundary identity field networkIdentity/u,
  );
});

test('SessionView materialization audit summarizes minimal access without raw material', () => {
  const audit = createSessionViewMaterializationAudit({
    siteKey: 'example.test',
    profileRef: 'C:/Users/example/browser-profile-1',
    purpose: 'download',
    scope: ['media'],
    permission: ['read'],
    ttlSeconds: 120,
    expiresAt: '2026-04-30T12:00:00.000Z',
    status: 'ready',
    reasonCode: 'session-invalid',
    networkContext: {
      host: 'example.test',
      headers: { authorization: 'Bearer synthetic-audit-token' },
      cookies: ['synthetic-audit-cookie'],
    },
    riskSignals: ['rate-limit'],
  }, {
    materializedAt: '2026-04-30T11:59:00.000Z',
  });

  assert.equal(audit.schemaVersion, SESSION_VIEW_MATERIALIZATION_AUDIT_SCHEMA_VERSION);
  assert.equal(audit.sessionViewSchemaVersion, SESSION_VIEW_SCHEMA_VERSION);
  assert.equal(audit.eventType, 'session.materialized');
  assert.equal(audit.boundary, 'SessionView');
  assert.equal(audit.siteKey, 'example.test');
  assert.equal(audit.profileRef, REDACTION_PLACEHOLDER);
  assert.equal(audit.purpose, 'download');
  assert.deepEqual(audit.scope, ['media']);
  assert.deepEqual(audit.permission, ['read']);
  assert.equal(audit.ttlSeconds, 120);
  assert.equal(audit.materializedAt, '2026-04-30T11:59:00.000Z');
  assert.equal(audit.rawCredentialAccess, false);
  assert.equal(audit.artifactPersistenceAllowed, false);
  assert.deepEqual(audit.purposeIsolation, {
    enforced: true,
    purpose: 'download',
    scope: ['media'],
  });
  assert.deepEqual(audit.revocation, {
    boundary: 'SessionProvider',
    handlePresent: false,
    reasonCode: 'session-revocation-handle-missing',
  });
  assert.doesNotMatch(
    JSON.stringify(audit),
    /synthetic-audit-|authorization|cookie|headers|Bearer|C:\/Users\/example/iu,
  );
});

test('SessionView materialization audit omits raw profile and session refs from summaries', () => {
  const audit = createSessionViewMaterializationAudit({
    siteKey: 'example.test',
    profileRef: 'C:/Users/example/browser-profiles/example.test',
    purpose: 'archive',
    scope: ['archive-item'],
    permission: ['read'],
    ttlSeconds: 120,
    networkContext: {
      host: 'example.test',
      profileRef: 'profile-ref-raw',
      sessionRef: 'session-ref-raw',
      nested: {
        browserProfile: 'C:/Users/example/browser-profiles/example.test',
      },
    },
    riskSignals: ['profile reference was available'],
  });

  assert.equal(audit.profileRef, REDACTION_PLACEHOLDER);
  assert.deepEqual(audit.scope, ['archive-item']);
  assert.deepEqual(audit.purposeIsolation, {
    enforced: true,
    purpose: 'archive',
    scope: ['archive-item'],
  });
  assert.doesNotMatch(
    JSON.stringify(audit),
    /profile-ref-raw|session-ref-raw|browser-profiles|C:\/Users\/example|browserProfile|sessionRef/iu,
  );
});

test('SessionView materialization audit accepts only safe revocation handle refs', () => {
  const audit = createSessionViewMaterializationAudit({
    siteKey: 'example.test',
    purpose: 'download',
    scope: ['media'],
    permission: ['read'],
    ttlSeconds: 120,
  }, {
    revocationHandleRef: 'revocation-handle-001',
  });

  assert.deepEqual(audit.revocation, {
    boundary: 'SessionProvider',
    handlePresent: true,
    handleRef: 'revocation-handle-001',
  });
  assert.doesNotMatch(JSON.stringify(audit), /synthetic-|cookie|authorization|csrf|token|Bearer|C:\/Users\/example/iu);

  assert.throws(
    () => createSessionViewMaterializationAudit({
      siteKey: 'example.test',
      ttlSeconds: 120,
    }, {
      revocationHandleRef: 'C:/Users/example/browser-profile-1',
    }),
    /safe opaque reference/u,
  );
  assert.throws(
    () => createSessionViewMaterializationAudit({
      siteKey: 'example.test',
      ttlSeconds: 120,
    }, {
      revocationHandleRef: 'access_token=synthetic-revocation-token',
    }),
    /safe opaque reference/u,
  );
});

test('SessionView revocation store persists opaque handles and enforces revocation lifecycle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'session-view-revocation-'));
  const filePath = join(directory, 'revocations.json');
  const now = new Date('2026-04-30T00:00:00.000Z');
  const store = createSessionRevocationStore({ filePath, now });

  const record = registerSessionRevocationHandle(store, {
    revocationHandleRef: 'revocation-handle-abc',
    ttlSeconds: 60,
  }, { now });

  assert.deepEqual(record, {
    handle: 'revocation-handle-abc',
    status: 'ready',
    ttlSeconds: 60,
    expiresAt: '2026-04-30T00:01:00.000Z',
  });
  assert.equal(assertSessionRevocationAllowed(store, 'revocation-handle-abc', {
    now: new Date('2026-04-30T00:00:30.000Z'),
  }), true);

  const persisted = JSON.parse(await readFile(filePath, 'utf8'));
  assert.equal(persisted.schemaVersion, SESSION_REVOCATION_STORE_SCHEMA_VERSION);
  assert.deepEqual(Object.keys(persisted.records[0]).sort(), [
    'expiresAt',
    'handle',
    'status',
    'ttlSeconds',
  ]);
  assert.doesNotMatch(
    JSON.stringify(persisted),
    /synthetic-|cookie|authorization|csrf|token|Bearer|C:\/Users\/example|browserProfile|sessionId/iu,
  );

  const reloaded = createSessionRevocationStore({ filePath, now });
  assert.equal(assertSessionRevocationAllowed(reloaded, 'revocation-handle-abc', {
    now: new Date('2026-04-30T00:00:30.000Z'),
  }), true);

  const revoked = revokeSessionRevocationHandle(reloaded, 'revocation-handle-abc', {
    reasonCode: 'session-invalid',
    now: new Date('2026-04-30T00:00:40.000Z'),
  });
  assert.deepEqual(revoked, {
    handle: 'revocation-handle-abc',
    status: 'revoked',
    ttlSeconds: 60,
    expiresAt: '2026-04-30T00:01:00.000Z',
    reasonCode: 'session-invalid',
  });
  assert.throws(
    () => assertSessionRevocationAllowed(reloaded, 'revocation-handle-abc', {
      now: new Date('2026-04-30T00:00:41.000Z'),
    }),
    /revocation handle is revoked/u,
  );

  const persistedRevoked = JSON.parse(await readFile(filePath, 'utf8'));
  assert.equal(assertSessionRevocationStoreCompatible(persistedRevoked), true);
  assert.deepEqual(Object.keys(persistedRevoked.records[0]).sort(), [
    'expiresAt',
    'handle',
    'reasonCode',
    'status',
    'ttlSeconds',
  ]);
  assert.doesNotMatch(
    JSON.stringify(persistedRevoked),
    /synthetic-|cookie|authorization|csrf|token|Bearer|C:\/Users\/example|browserProfile|sessionId/iu,
  );
});

test('SessionView revocation store fails closed for incompatible, expired, and unsafe records', async () => {
  const now = new Date('2026-04-30T00:00:00.000Z');
  const store = createSessionRevocationStore({ records: [], now });
  registerSessionRevocationHandle(store, {
    handle: 'revocation-handle-expiring',
    ttlSeconds: 1,
  }, { now });

  assert.throws(
    () => assertSessionRevocationAllowed(store, 'revocation-handle-missing', { now }),
    /revocation handle is not registered/u,
  );
  assert.throws(
    () => assertSessionRevocationAllowed(store, 'revocation-handle-expiring', {
      now: new Date('2026-04-30T00:00:02.000Z'),
    }),
    /revocation handle is expired/u,
  );
  assert.throws(
    () => assertSessionRevocationStoreCompatible({
      schemaVersion: SESSION_REVOCATION_STORE_SCHEMA_VERSION + 1,
      records: [],
    }),
    /schemaVersion .* is not compatible/u,
  );
  assert.throws(
    () => assertSessionRevocationStoreCompatible({
      schemaVersion: SESSION_REVOCATION_STORE_SCHEMA_VERSION,
      records: [{
        handle: 'revocation-handle-unsafe',
        status: 'ready',
        ttlSeconds: 60,
        expiresAt: '2026-04-30T00:01:00.000Z',
        cookie: 'synthetic-cookie',
      }],
    }),
    /field cookie is not compatible/u,
  );
  assert.throws(
    () => assertSessionRevocationStoreCompatible({
      schemaVersion: SESSION_REVOCATION_STORE_SCHEMA_VERSION,
      records: [
        {
          handle: 'revocation-handle-duplicate',
          status: 'revoked',
          ttlSeconds: 60,
          expiresAt: '2026-04-30T00:01:00.000Z',
          reasonCode: 'session-invalid',
        },
        {
          handle: 'revocation-handle-duplicate',
          status: 'ready',
          ttlSeconds: 60,
          expiresAt: '2026-04-30T00:01:00.000Z',
        },
      ],
    }),
    /duplicate handles/u,
  );
  assert.throws(
    () => registerSessionRevocationHandle(store, {
      handle: 'synthetic-token',
      ttlSeconds: 60,
    }, { now }),
    /safe opaque reference/u,
  );

  store.records.set('revocation-handle-mutated', {
    handle: 'revocation-handle-mutated',
    status: 'ready',
    ttlSeconds: 60,
    expiresAt: '2026-04-30T00:01:00.000Z',
    token: 'synthetic-token',
  });
  assert.throws(
    () => assertSessionRevocationAllowed(store, 'revocation-handle-mutated', { now }),
    /field token is not compatible/u,
  );

  const directory = await mkdtemp(join(tmpdir(), 'session-view-revocation-invalid-'));
  const filePath = join(directory, 'revocations.json');
  await writeFile(filePath, '{invalid-json', 'utf8');
  assert.throws(
    () => createSessionRevocationStore({ filePath, now }),
    /could not be read safely/u,
  );
});

test('SessionView compatibility guard requires the current schema version', () => {
  assert.equal(assertSessionViewCompatible({ schemaVersion: SESSION_VIEW_SCHEMA_VERSION }), true);
  assert.throws(
    () => assertSessionViewCompatible({}),
    /schemaVersion is required/u,
  );
  assert.throws(
    () => assertSessionViewCompatible({ schemaVersion: SESSION_VIEW_SCHEMA_VERSION + 1 }),
    /not compatible/u,
  );
});

test('SessionView materialization audit compatibility guard checks schema and revocation reasonCode', () => {
  const audit = createSessionViewMaterializationAudit({
    siteKey: 'example.test',
    purpose: 'download',
    scope: ['media'],
    permission: ['read'],
    ttlSeconds: 120,
    status: 'manual-required',
    reasonCode: 'session-invalid',
  });

  assert.equal(assertSessionViewMaterializationAuditCompatible(audit), true);
  assert.throws(
    () => assertSessionViewMaterializationAuditCompatible({
      ...audit,
      schemaVersion: SESSION_VIEW_MATERIALIZATION_AUDIT_SCHEMA_VERSION + 1,
    }),
    /schemaVersion .* is not compatible/u,
  );
  assert.throws(
    () => assertSessionViewMaterializationAuditCompatible({
      ...audit,
      sessionViewSchemaVersion: SESSION_VIEW_SCHEMA_VERSION + 1,
    }),
    /sessionViewSchemaVersion .* is not compatible/u,
  );
  assert.throws(
    () => assertSessionViewMaterializationAuditCompatible({
      ...audit,
      revocation: {
        boundary: 'SessionProvider',
        handlePresent: false,
        reasonCode: 'legacy-missing-revocation',
      },
    }),
    /Unknown reasonCode: legacy-missing-revocation/u,
  );
  assert.throws(
    () => assertSessionViewMaterializationAuditCompatible({
      ...audit,
      revocation: {
        boundary: 'SessionProvider',
        handlePresent: true,
        handleRef: 'C:/Users/example/browser-profile-1',
      },
    }),
    /safe opaque reference/u,
  );
});
