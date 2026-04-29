import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertLiveSmokeBoundary,
  buildMatrix,
  classifyDoctorReport,
  classifyKbRefreshManifest,
  classifySocialActionManifest,
  evaluateLiveSmokeBoundary,
  parseArgs,
} from '../../scripts/social-live-verify.mjs';

function boundedArgs(extra = []) {
  return [
    '--live',
    '--site',
    'all',
    '--x-account',
    'openai',
    '--ig-account',
    'instagram',
    '--date',
    '2026-04-26',
    '--max-items',
    '10',
    '--max-users',
    '5',
    '--max-media-downloads',
    '3',
    '--timeout',
    '120000',
    '--case-timeout',
    '600000',
    '--run-root',
    'C:\\tmp\\social-live-verify',
    ...extra,
  ];
}

test('social-live-verify defaults to not-run until live boundaries are explicit', () => {
  const boundary = evaluateLiveSmokeBoundary(parseArgs([]));

  assert.equal(boundary.mode, 'not-run');
  assert.equal(boundary.ok, false);
  assert.deepEqual(boundary.missing, [
    'live',
    'site',
    'max-items',
    'timeout',
    'case-timeout',
    'run-root',
  ]);
});

test('social-live-verify requires explicit live, site, account, limit, timeout, and run root before planning', () => {
  assert.throws(
    () => assertLiveSmokeBoundary(parseArgs([
      '--live',
      '--site',
      'x',
      '--x-account',
      'openai',
      '--timeout',
      '120000',
      '--case-timeout',
      '600000',
      '--run-root',
      'C:\\tmp\\social-live-verify',
    ])),
    /missing --max-items/u,
  );
});

test('social-live-verify refuses execute without explicit live acknowledgement', () => {
  assert.throws(
    () => parseArgs([
      '--execute',
      '--site',
      'x',
      '--x-account',
      'openai',
      '--max-items',
      '10',
      '--timeout',
      '120000',
      '--case-timeout',
      '600000',
      '--run-root',
      'C:\\tmp\\social-live-verify',
    ]),
    /--execute requires --live/u,
  );
});

test('social-live-verify forwards case timeout into KB refresh commands', () => {
  const options = parseArgs(boundedArgs(['--case-timeout', '1234']));
  const matrix = buildMatrix(options, 'run-1');
  const xKbRefresh = matrix.find((entry) => entry.id === 'x-kb-refresh');

  assert.ok(xKbRefresh);
  const timeoutIndex = xKbRefresh.args.indexOf('--case-timeout');
  assert.notEqual(timeoutIndex, -1);
  assert.equal(xKbRefresh.args[timeoutIndex + 1], '1234');
});

test('social-live-verify includes unified session health before auth doctor cases', () => {
  const options = parseArgs(boundedArgs(['--case', 'x-session-health', '--case', 'x-auth-doctor']));
  const matrix = buildMatrix(options, 'run-1');
  const sessionHealth = matrix.find((entry) => entry.id === 'x-session-health');
  const authDoctor = matrix.find((entry) => entry.id === 'x-auth-doctor');

  assert.ok(sessionHealth);
  assert.ok(authDoctor);
  assert.match(sessionHealth.args.join(' '), /session\.mjs health --site x/u);
  assert.match(sessionHealth.args.join(' '), /--run-dir .*x-session-health/u);
  assert.match(authDoctor.args.join(' '), /--session-manifest .*x-session-health.*manifest\.json/u);
});

test('social-live-verify selected default matrix includes social session health cases', () => {
  const options = parseArgs(boundedArgs());
  const ids = buildMatrix(options, 'run-1').map((entry) => entry.id);

  assert.equal(ids.includes('x-session-health'), true);
  assert.equal(ids.includes('instagram-session-health'), true);
});

test('social-live-verify forwards media download tuning into media cases', () => {
  const options = parseArgs([
    ...boundedArgs(['--case', 'x-media-download']),
    '--media-download-concurrency',
    '9',
    '--media-download-retries',
    '4',
    '--media-download-backoff-ms',
    '2500',
  ]);
  const matrix = buildMatrix(options, 'run-1');
  const mediaCase = matrix.find((entry) => entry.id === 'x-media-download');

  assert.ok(mediaCase);
  assert.equal(mediaCase.args[mediaCase.args.indexOf('--media-download-concurrency') + 1], '9');
  assert.equal(mediaCase.args[mediaCase.args.indexOf('--media-download-retries') + 1], '4');
  assert.equal(mediaCase.args[mediaCase.args.indexOf('--media-download-backoff-ms') + 1], '2500');
});

test('social-live-verify classifies site-doctor fail statuses as failed', () => {
  const classification = classifyDoctorReport({
    authHealth: { available: true },
    scenarios: [
      { id: 'home-search-post-detail-profile', status: 'fail', reasonCode: null },
      { id: 'profile-post-detail', status: 'pass', reasonCode: 'ok' },
    ],
  });

  assert.deepEqual(classification, {
    verdict: 'failed',
    reason: 'home-search-post-detail-profile',
  });
});

test('social-live-verify classifies auth-only skipped scenarios as blocked', () => {
  const classification = classifyDoctorReport({
    authHealth: { available: true },
    scenarios: [
      { id: 'home-auth', status: 'skipped', reasonCode: 'not-logged-in' },
    ],
  });

  assert.deepEqual(classification, {
    verdict: 'blocked',
    reason: 'not-logged-in',
  });
});

test('social-live-verify classifies KB refresh timeout manifest as blocked', () => {
  const classification = classifyKbRefreshManifest({
    status: 'blocked',
    results: [{
      id: 'instagram-kb-refresh',
      status: 'blocked',
      exitCode: 1,
      timeout: { timedOut: true },
      blocked: { status: true, reason: 'timeout' },
    }],
  });

  assert.equal(classification.verdict, 'blocked');
  assert.equal(classification.reason, 'timeout');
});

test('social-live-verify classifies Instagram action missing login as skipped', () => {
  assert.deepEqual(classifySocialActionManifest({
    status: 'failed',
    outcome: {
      status: 'credentials-unavailable',
      ok: false,
      reason: 'not-logged-in',
    },
  }), {
    verdict: 'skipped',
    reason: 'not-logged-in',
  });
});

test('social-live-verify classifies Instagram auth recovery needs as blocked', () => {
  assert.deepEqual(classifySocialActionManifest({
    status: 'completed',
    authHealth: {
      status: 'authenticated',
      needsRecovery: true,
      recoveryReason: 'login-wall',
    },
    runtimeRisk: {
      authExpired: true,
      stopReason: 'session-invalid',
    },
  }), {
    verdict: 'blocked',
    reason: 'login-wall',
  });
});

test('social-live-verify classifies Instagram media download skipped by login as skipped', () => {
  assert.deepEqual(classifySocialActionManifest({
    status: 'completed',
    downloads: {
      status: 'skipped',
      reason: 'no-reusable-session',
      expectedMedia: 0,
      ok: 0,
    },
  }), {
    verdict: 'skipped',
    reason: 'no-reusable-session',
  });
});
