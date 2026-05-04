import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REDACTION_PLACEHOLDER,
} from '../../src/sites/capability/security-guard.mjs';
import {
  NON_GOALS_BOUNDARY_SCHEMA_VERSION,
  assertNonGoalBoundary,
  scanNonGoalBoundary,
} from '../../src/sites/capability/non-goals-boundary.mjs';

test('NonGoalsBoundary allows site-agnostic Kernel descriptors with redacted payloads', () => {
  const result = assertNonGoalBoundary({
    owner: 'Kernel',
    responsibility: 'coordinate lifecycle, reason codes, schema gates, and policy handoff',
    payload: {
      reasonCode: 'policy-gated',
      sessionSummary: {
        status: 'ready',
        authorization: REDACTION_PLACEHOLDER,
      },
    },
    imports: [
      {
        specifier: 'src/sites/capability/reason-codes.mjs',
        imported: ['reasonCodes'],
      },
    ],
  });

  assert.equal(result.schemaVersion, NON_GOALS_BOUNDARY_SCHEMA_VERSION);
  assert.equal(result.owner, 'Kernel');
  assert.equal(result.allowed, true);
  assert.deepEqual(result.findings, []);
});

test('NonGoalsBoundary allows SiteAdapter to own concrete site interpretation without raw material', () => {
  const result = assertNonGoalBoundary({
    owner: 'SiteAdapter',
    responsibilities: [
      'bilibili page type interpretation',
      'douyin endpoint validation with redacted evidence',
    ],
    payload: {
      siteDecision: 'video-page',
      evidence: {
        cookie: REDACTION_PLACEHOLDER,
      },
    },
  });

  assert.equal(result.owner, 'SiteAdapter');
  assert.equal(result.allowed, true);
});

test('NonGoalsBoundary rejects Kernel concrete site semantics', () => {
  assert.throws(
    () => assertNonGoalBoundary({
      owner: 'Kernel',
      responsibility: 'bilibili page type interpretation and endpoint validation',
      payload: {
        reasonCode: 'site-specific-decision',
      },
    }),
    /concrete-site-semantics/u,
  );
});

test('NonGoalsBoundary rejects CapabilityService raw credential ownership by sensitive field', () => {
  const result = scanNonGoalBoundary({
    owner: 'CapabilityService',
    responsibility: 'normalize cross-site evidence',
    payload: {
      sessionMaterial: 'synthetic fixture value',
      nested: {
        csrfToken: 'synthetic fixture value',
      },
    },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.findings.length, 2);
  assert.deepEqual(
    result.findings.map((finding) => finding.rule),
    ['raw-sensitive-material', 'raw-sensitive-material'],
  );
  assert.deepEqual(
    result.findings.map((finding) => finding.path),
    ['payload.sessionMaterial', 'payload.nested.csrfToken'],
  );
});

test('NonGoalsBoundary rejects downloader raw session reads from imports', () => {
  assert.throws(
    () => assertNonGoalBoundary({
      owner: 'downloader',
      responsibility: 'execute low-permission file transfer from planned resources',
      imports: [
        {
          specifier: 'src/infra/browser/session.mjs',
          imported: ['readRawSessionMaterial'],
        },
      ],
    }),
    /downloader-raw-session-read/u,
  );
});

test('NonGoalsBoundary rejects API auto-promotion for every owner', () => {
  for (const owner of ['Kernel', 'CapabilityService', 'SiteAdapter', 'downloader']) {
    assert.throws(
      () => assertNonGoalBoundary({
        owner,
        responsibility: 'auto-promote API candidate into catalog',
        payload: {
          apiAutoPromotion: true,
        },
      }),
      /api-auto-promotion/u,
    );
  }
});

test('NonGoalsBoundary fails closed for unknown owners and malformed import descriptors', () => {
  assert.throws(
    () => scanNonGoalBoundary({
      owner: 'UnknownLayer',
      responsibility: 'schema gate',
    }),
    /Unknown NonGoalsBoundary owner/u,
  );

  const result = scanNonGoalBoundary({
    owner: 'Kernel',
    responsibility: 'schema gate',
    imports: [{}],
  });

  assert.equal(result.allowed, false);
  assert.deepEqual(result.findings.map((finding) => finding.rule), ['invalid-import-descriptor']);
});
