import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REDACTION_PLACEHOLDER,
} from '../../src/sites/capability/security-guard.mjs';
import {
  TRUST_BOUNDARY_CROSSING_SCHEMA_VERSION,
  TRUST_BOUNDARY_IDS,
  TRUST_BOUNDARY_REGISTRY_SCHEMA_VERSION,
  assertTrustBoundaryCrossing,
  assertTrustBoundaryRegistryComplete,
  getTrustBoundary,
  listTrustBoundaries,
  normalizeTrustBoundaryCrossing,
} from '../../src/sites/capability/trust-boundary.mjs';

test('TrustBoundary registry declares the required Section 13 boundaries', () => {
  assert.equal(TRUST_BOUNDARY_REGISTRY_SCHEMA_VERSION, 1);
  assert.equal(assertTrustBoundaryRegistryComplete(), true);
  assert.deepEqual(
    listTrustBoundaries().map((boundary) => boundary.id),
    TRUST_BOUNDARY_IDS,
  );

  for (const id of [
    'BrowserProfile',
    'RawCookieJar',
    'SessionView',
    'Artifact',
    'downloader',
    'SiteAdapter',
    'api-candidates',
    'api-catalog',
    'RiskState',
    'SecurityGuard',
  ]) {
    const boundary = getTrustBoundary(id);
    assert.equal(boundary.id, id);
    assert.ok(boundary.role);
    assert.ok(boundary.trustLevel);
    assert.ok(Array.isArray(boundary.requiredInboundControls));
    assert.ok(Array.isArray(boundary.requiredOutboundControls));
  }
});

test('TrustBoundary crossing helper records required controls for downloader handoff', () => {
  const crossing = assertTrustBoundaryCrossing({
    from: 'SessionView',
    to: 'downloader',
    purpose: 'download media handoff',
    controls: ['permission-checked', 'minimized'],
    payload: {
      siteKey: 'example.test',
      scope: ['download-media'],
      permission: ['download'],
      ttlSeconds: 120,
      status: 'ready',
      reasonCode: 'download-failed',
    },
  });

  assert.deepEqual(crossing, {
    schemaVersion: TRUST_BOUNDARY_CROSSING_SCHEMA_VERSION,
    from: 'SessionView',
    to: 'downloader',
    purpose: 'download media handoff',
    controls: ['minimized', 'permission-checked'],
    requiredControls: ['minimized', 'permission-checked'],
  });
});

test('TrustBoundary crossing into Artifact requires redaction and rejects missing controls', () => {
  assert.throws(
    () => assertTrustBoundaryCrossing({
      from: 'RiskState',
      to: 'Artifact',
      controls: ['minimized'],
      payload: {
        state: 'blocked',
        reasonCode: 'redaction-failed',
      },
    }),
    /missing required controls: redacted/u,
  );

  assert.equal(assertTrustBoundaryCrossing({
    from: 'RiskState',
    to: 'Artifact',
    controls: ['redacted', 'minimized'],
    payload: {
      state: 'blocked',
      reasonCode: 'redaction-failed',
      recovery: {
        artifactWriteAllowed: false,
      },
    },
  }).to, 'Artifact');
});

test('TrustBoundary crossing fails closed for unknown boundaries and controls', () => {
  assert.throws(
    () => normalizeTrustBoundaryCrossing({
      from: 'RawCookieJar',
      to: 'UnknownBoundary',
      controls: ['redacted', 'minimized', 'permission-checked'],
    }),
    /Unknown TrustBoundary to/u,
  );
  assert.throws(
    () => normalizeTrustBoundaryCrossing({
      from: 'RawCookieJar',
      to: 'SessionView',
      controls: ['redacted', 'minimized', 'permission-checked', 'trusted'],
    }),
    /Unsupported TrustBoundary crossing control/u,
  );
});

test('TrustBoundary crossing rejects raw sensitive material even when controls are claimed', () => {
  assert.throws(
    () => assertTrustBoundaryCrossing({
      from: 'RawCookieJar',
      to: 'SessionView',
      controls: ['redacted', 'minimized', 'permission-checked'],
      payload: {
        cookie: 'SESSDATA=synthetic-sessdata-value; sid=synthetic-session',
        authorization: 'Bearer synthetic-bearer-token',
        browserProfile: 'C:/Users/example/AppData/Local/Browser-Wiki-Skill/browser-profiles/example',
        safe: 'kept',
      },
    }),
    /raw sensitive material/u,
  );
});

test('TrustBoundary crossing allows redacted placeholders without raw material', () => {
  const crossing = assertTrustBoundaryCrossing({
    from: 'RawCookieJar',
    to: 'SessionView',
    controls: ['redacted', 'minimized', 'permission-checked'],
    payload: {
      cookie: REDACTION_PLACEHOLDER,
      authorization: REDACTION_PLACEHOLDER,
      cookieSummary: {
        count: 2,
        expiresAt: '2026-05-03T00:00:00.000Z',
      },
      siteKey: 'example.test',
    },
  });

  assert.equal(crossing.from, 'RawCookieJar');
  assert.equal(crossing.to, 'SessionView');
});
