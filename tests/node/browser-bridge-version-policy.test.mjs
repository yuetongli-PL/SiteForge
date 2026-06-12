import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPATIBLE_BROWSER_BRIDGE_EXTENSION_VERSIONS,
  EXPECTED_BROWSER_BRIDGE_EXTENSION_VERSION,
  bridgeExtensionVersionBlockingSignals,
  bridgeVersionCompatible,
} from '../../src/app/pipeline/build/browser-bridge-version-policy.mjs';

test('browser bridge version policy accepts current and compatible extension versions', () => {
  assert.equal(EXPECTED_BROWSER_BRIDGE_EXTENSION_VERSION, 'route-queue-x-api-runtime-v8');
  assert.deepEqual(COMPATIBLE_BROWSER_BRIDGE_EXTENSION_VERSIONS, [
    'route-queue-x-api-runtime-v8',
    'route-queue-chinese-semantic-v7',
    'route-queue-chinese-semantic-v6',
  ]);
  assert.equal(bridgeVersionCompatible('route-queue-x-api-runtime-v8'), true);
  assert.equal(bridgeVersionCompatible('route-queue-chinese-semantic-v7'), true);
  assert.equal(bridgeVersionCompatible('route-queue-chinese-semantic-v6'), true);
  assert.equal(bridgeVersionCompatible('route-queue-chinese-semantic-v5'), false);
});

test('browser bridge version policy classifies stale and mixed extension signals', () => {
  assert.deepEqual(bridgeExtensionVersionBlockingSignals([], []), []);
  assert.deepEqual(bridgeExtensionVersionBlockingSignals([
    'bridge-content-version:route-queue-x-api-runtime-v8',
    'bridge-version:route-queue-x-api-runtime-v8',
    'collector-version:route-1:route-queue-x-api-runtime-v8',
    'collector-submit-ok:route-1',
  ], [{
    routeId: 'route-1',
    status: 'captured',
  }]), []);
  assert.deepEqual(bridgeExtensionVersionBlockingSignals([
    'bridge-content-version:route-queue-chinese-semantic-v7',
    'bridge-version:route-queue-chinese-semantic-v7',
    'collector-version:route-1:route-queue-chinese-semantic-v7',
    'collector-submit-ok:route-1',
  ], [{
    routeId: 'route-1',
    status: 'captured',
  }]), []);
  assert.deepEqual(bridgeExtensionVersionBlockingSignals([
    'bridge-content-version:route-queue-chinese-semantic-v6',
    'bridge-version:route-queue-chinese-semantic-v6',
    'collector-version:route-1:route-queue-chinese-semantic-v6',
    'collector-submit-ok:route-1',
  ], [{
    routeId: 'route-1',
    status: 'captured',
  }]), []);
  assert.deepEqual(bridgeExtensionVersionBlockingSignals([
    'bridge-content-version:route-queue-x-api-runtime-v8',
    'bridge-version:route-queue-chinese-semantic-v6',
    'collector-version:route-1:route-queue-x-api-runtime-v8',
    'collector-submit-ok:route-1',
  ], [{
    routeId: 'route-1',
    status: 'captured',
  }]), ['browser-bridge-extension-stale-or-incompatible']);
  assert.deepEqual(bridgeExtensionVersionBlockingSignals([
    'bridge-content-version:route-queue-x-api-runtime-v8',
    'bridge-version:route-queue-x-api-runtime-v8',
    'collector-submit-ok:route-1',
  ], [{
    routeId: 'route-1',
    status: 'captured',
  }]), ['browser-bridge-extension-stale-or-incompatible']);
});
