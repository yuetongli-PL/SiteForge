import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canContinueSetupBlockedForApiDiscovery,
  isApiDiscoveryRequested,
  isBrowserSetupBlockedReason,
  SETUP_BLOCKED_API_DISCOVERY_BOUNDARY,
  SETUP_BLOCKED_API_DISCOVERY_STATUS,
  SETUP_BLOCKED_API_DISCOVERY_WARNING,
  setupBlockedApiDiscoveryOptions,
  setupBlockedApiDiscoveryPlan,
} from '../../src/app/pipeline/build/api-discovery-setup-fallback.mjs';

test('setup-blocked API discovery fallback recognizes only strict browser auth API discovery requests', () => {
  const setupPlan = {
    buildReadiness: {
      reasonCode: 'browser_blocked',
    },
  };
  const options = {
    authMode: 'browser',
    strictBrowserAuth: true,
    renderJs: true,
    internalRawNetwork: true,
  };

  assert.equal(SETUP_BLOCKED_API_DISCOVERY_STATUS, 'api_discovery_setup_blocked');
  assert.equal(isBrowserSetupBlockedReason('browser_blocked'), true);
  assert.equal(isBrowserSetupBlockedReason('browser-route-challenge'), true);
  assert.equal(isBrowserSetupBlockedReason('cookie_invalid'), false);
  assert.equal(isApiDiscoveryRequested({ network: true }), true);
  assert.equal(isApiDiscoveryRequested({ captureNetwork: true }), true);
  assert.equal(isApiDiscoveryRequested({ internalRawNetwork: true }), true);
  assert.equal(isApiDiscoveryRequested({}), false);
  assert.equal(canContinueSetupBlockedForApiDiscovery(setupPlan, options), true);
  assert.equal(canContinueSetupBlockedForApiDiscovery(setupPlan, { ...options, authMode: 'cookie' }), false);
  assert.equal(canContinueSetupBlockedForApiDiscovery(setupPlan, { ...options, strictBrowserAuth: false }), false);
  assert.equal(canContinueSetupBlockedForApiDiscovery(setupPlan, { ...options, renderJs: false }), false);
  assert.equal(canContinueSetupBlockedForApiDiscovery(setupPlan, { ...options, internalRawNetwork: false }), false);
  assert.equal(canContinueSetupBlockedForApiDiscovery({
    buildReadiness: { reasonCode: 'robots-disallowed' },
  }, options), false);
});

test('setup-blocked API discovery options disable strict browser auth but preserve request scope', () => {
  const options = {
    authMode: 'browser',
    strictBrowserAuth: true,
    renderJs: true,
    internalRawNetwork: true,
    buildId: 'setup-fallback',
  };

  assert.deepEqual(
    setupBlockedApiDiscoveryOptions(options, {
      buildReadiness: { reasonCode: 'browser_blocked' },
    }),
    {
      authMode: 'browser',
      strictBrowserAuth: false,
      renderJs: true,
      internalRawNetwork: true,
      buildId: 'setup-fallback',
      allowSetupBlockedApiDiscovery: true,
      setupBlockedApiDiscoveryReasonCode: 'browser_blocked',
    },
  );
  assert.deepEqual(
    setupBlockedApiDiscoveryOptions({}, null),
    {
      strictBrowserAuth: false,
      allowSetupBlockedApiDiscovery: true,
      setupBlockedApiDiscoveryReasonCode: 'browser_check_failed',
    },
  );
});

test('setup-blocked API discovery plan marks a bounded non-buildable fallback without mutating the plan', () => {
  const setupPlan = {
    site: { rootUrl: 'https://example.test/' },
    warnings: ['existing-warning', SETUP_BLOCKED_API_DISCOVERY_WARNING],
    buildReadiness: {
      buildable: false,
      reasonCode: 'browser_blocked',
    },
  };

  const fallbackPlan = setupBlockedApiDiscoveryPlan(setupPlan);

  assert.notEqual(fallbackPlan, setupPlan);
  assert.deepEqual(setupPlan.warnings, ['existing-warning', SETUP_BLOCKED_API_DISCOVERY_WARNING]);
  assert.deepEqual(fallbackPlan.warnings, [
    'existing-warning',
    SETUP_BLOCKED_API_DISCOVERY_WARNING,
  ]);
  assert.deepEqual(fallbackPlan.apiDiscoverySetupFallback, {
    status: 'enabled',
    reasonCode: 'browser_blocked',
    boundary: SETUP_BLOCKED_API_DISCOVERY_BOUNDARY,
  });
  assert.equal(fallbackPlan.buildReadiness.buildable, false);
});
