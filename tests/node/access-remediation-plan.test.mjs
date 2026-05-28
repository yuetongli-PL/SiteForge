import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAccessRemediationPlan,
  shouldWriteAccessRemediationPlan,
} from '../../src/app/pipeline/build/access-remediation-plan.mjs';

const context = {
  buildId: 'build-1',
  inputUrl: 'https://example.test/?token=synthetic-secret',
  site: {
    id: 'example-test',
    rootUrl: 'https://example.test/',
  },
};

test('access remediation plan write gate follows external access blockers', () => {
  assert.equal(shouldWriteAccessRemediationPlan({
    summary: {
      retryDisposition: 'blocked_no_bypass',
    },
  }), true);
  assert.equal(shouldWriteAccessRemediationPlan({
    primaryReasonCode: 'blocked-by-cloudflare-challenge',
    retryDisposition: 'no_retry',
  }), true);
  assert.equal(shouldWriteAccessRemediationPlan({
    summary: {
      primaryReasonCode: null,
      retryDisposition: 'no_retry',
      reasonCodes: [],
    },
  }), false);
});

test('access remediation plan summarizes route-only and remaining unverified capabilities safely', () => {
  const plan = buildAccessRemediationPlan(context, {
    discoverCapabilities: {
      capabilities: [
        {
          id: 'cap-route',
          name: 'Open category route',
          status: 'active',
          publicRouteOnly: true,
          evidenceModel: 'public_route_navigation',
          enabled_status: 'limited_enabled',
          sourceLayer: 'public',
        },
        {
          id: 'cap-candidate',
          name: 'Private token=synthetic-secret profile',
          status: 'candidate',
          enabled_status: 'candidate',
          evidenceMatrix: {
            missingEvidence: ['auth_summary', 'auth_summary'],
          },
        },
      ],
    },
  }, {
    summary: {
      primaryReasonCode: 'blocked-by-cloudflare-challenge',
      blockerClass: 'external_challenge',
      retryDisposition: 'blocked_no_bypass',
      reasonCodes: ['challenge_or_probe_detected'],
    },
  });

  assert.equal(plan.artifactFamily, 'siteforge-access-remediation-plan');
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.reasonCode, 'blocked-by-cloudflare-challenge');
  assert.equal(plan.partialRouteOnly.enabledCapabilities.length, 1);
  assert.equal(plan.partialRouteOnly.enabledCapabilities[0].id, 'cap-route');
  assert.equal(plan.remainingUnverified.length, 1);
  assert.equal(plan.remainingUnverified[0].name, '[REDACTED]');
  assert.deepEqual(plan.remainingUnverified[0].missingEvidence, ['auth_summary']);
  assert.equal(plan.authorizedSourceManifestTemplate.sources.length, 2);
  assert.equal(plan.safety.bypassChallenge, false);
  assert.equal(JSON.stringify(plan).includes('synthetic-secret'), false);
});
