import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  buildRecoveryPlan,
  classifyAuthRecoveryReport,
  parseArgs,
} from '../../scripts/social-auth-recover.mjs';

test('social-auth-recover builds X keepalive, manual login, and verification commands', () => {
  const runRoot = path.join('C:', 'tmp', 'bwk-social-auth-recover-test');
  const options = parseArgs([
    '--site',
    'x',
    '--manual',
    '--verify',
    '--run-root',
    runRoot,
    '--timeout',
    '12345',
    '--manual-timeout',
    '67890',
    '--case-timeout',
    '22222',
    '--user-data-dir',
    path.join('C:', 'ChromeProfiles', 'X'),
  ]);
  const plan = buildRecoveryPlan(options, 'run-1');
  const site = plan.sites[0];

  assert.equal(site.site, 'x');
  assert.match(site.commandLines.keepalive, /src\/entrypoints\/cli\.mjs site keepalive/u);
  assert.match(site.commandLines.keepalive, /--no-auto-login/u);
  assert.match(site.commandLines.keepalive, /--user-data-dir/u);
  assert.match(site.commandLines.manualLogin, /src\/entrypoints\/cli\.mjs site login/u);
  assert.match(site.commandLines.manualLogin, /--wait-for-manual-login/u);
  assert.match(site.commandLines.manualLogin, /--manual-timeout 67890/u);
  assert.equal(site.commandLines.verify[0].caseId, 'x-auth-doctor');
  assert.match(site.commandLines.verify[0].command, /src\/entrypoints\/cli\.mjs social live-verify/u);
  assert.match(site.commandLines.verify[0].command, /--case-timeout 22222/u);
});

test('social-auth-recover filters verification cases by selected site', () => {
  const options = parseArgs([
    '--site',
    'instagram',
    '--verify-case',
    'x-auth-doctor',
    '--verify-case',
    'instagram-media-download',
  ]);
  const plan = buildRecoveryPlan(options, 'run-2');

  assert.deepEqual(plan.sites.map((site) => site.site), ['instagram']);
  assert.deepEqual(plan.sites[0].commandLines.verify.map((entry) => entry.caseId), [
    'instagram-auth-doctor',
    'instagram-media-download',
  ]);
});

test('social-auth-recover classifies reusable, manual-required, and challenge states', () => {
  assert.deepEqual(
    classifyAuthRecoveryReport({ keepalive: { status: 'kept-alive', identityConfirmed: true } }),
    {
      status: 'recovered',
      reason: 'kept-alive',
      reusable: true,
      identityConfirmed: true,
    },
  );
  assert.deepEqual(
    classifyAuthRecoveryReport({ auth: { status: 'credentials-unavailable' } }),
    {
      status: 'needs-manual-login',
      reason: 'credentials-unavailable',
      reusable: false,
      identityConfirmed: false,
    },
  );
  assert.deepEqual(
    classifyAuthRecoveryReport({ auth: { status: 'challenge-required', challengeRequired: true } }),
    {
      status: 'blocked',
      reason: 'challenge-required',
      reusable: false,
      identityConfirmed: false,
    },
  );
});
