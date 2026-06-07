// @ts-check

import {
  sanitizeRuntimeRegressionSnapshot,
} from './runtime-regression-sanitizer.mjs';

export function createRuntimeRegressionSnapshotFixture(overrides = {}) {
  return sanitizeRuntimeRegressionSnapshot({
    snapshotId: 'runtime-ci-regression:fixture:baseline',
    runtime: {
      status: 'blocked',
      reasonCode: 'runtime.policy_blocked',
      providerId: 'api_read_provider',
      capabilityKind: 'read',
      providerInvoked: false,
      executionAttempted: false,
      sideEffectAttempted: false,
      paymentBlocked: false,
      destructiveBlocked: false,
      executionContractConcrete: true,
    },
    auth: {
      required: true,
      used: false,
      scopes: ['orders.read'],
      materialTypes: ['bearer_token'],
    },
    browserGuard: {
      present: true,
      allowedOrigins: ['https://example.com'],
    },
    policy: {
      policyId: 'policy:safe-defaults',
      verdict: 'blocked',
      reason: 'runtime.policy_blocked',
      allowed: false,
    },
    metadata: {
      label: 'baseline',
    },
    ...overrides,
  });
}
