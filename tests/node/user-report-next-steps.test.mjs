import test from 'node:test';
import assert from 'node:assert/strict';

import { buildNextSteps } from '../../src/app/pipeline/build/user-report-next-steps.mjs';

const defaultContext = {
  options: {},
  policy: {},
  setupProfile: null,
};

test('user report next steps describe successful builds', () => {
  assert.deepEqual(buildNextSteps({
    resultStatus: 'success',
    context: defaultContext,
    report: {},
    confirmationRequired: [],
    disabledCapabilities: [],
    confirmationPaths: {},
  }), [
    'Use the generated skill for the enabled read-only capabilities.',
  ]);
});

test('user report next steps include partial success review commands', () => {
  const steps = buildNextSteps({
    resultStatus: 'partial_success',
    context: {
      options: {},
      policy: {},
      setupProfile: {
        userAuthorizedEvidence: {
          autoDiscovery: {
            status: 'modeled',
            dynamicEnabled: false,
            networkEnabled: true,
          },
        },
      },
    },
    report: { summary: { verificationStatus: 'bridge_runtime_passed' } },
    confirmationRequired: [{ id: 'draft' }],
    disabledCapabilities: [{ id: 'delete' }],
    confirmationPaths: {
      view_confirmation_required_command: 'siteforge review confirmations',
      sensitive_read: { command: 'siteforge confirm read' },
      draft_write: { command: 'siteforge confirm draft' },
      disabled: { review_command: 'siteforge review disabled' },
    },
  });

  assert.equal(steps.includes('Use the registered runtime-routed Skill: public read-only capabilities can use generic HTTP read, while captured authenticated capabilities require the SiteForge Browser Bridge extension.'), true);
  assert.equal(steps.includes('Review confirmation-required capabilities: siteforge review confirmations.'), true);
  assert.equal(steps.includes('Confirm limited sensitive-read structure scanning: siteforge confirm read.'), true);
  assert.equal(steps.includes('Confirm draft-only preparation: siteforge confirm draft.'), true);
  assert.equal(steps.includes('Review disabled capabilities: siteforge review disabled.'), true);
  assert.equal(steps.includes('Internal operator deep mode: node src/entrypoints/build/run-build.mjs <url> --auto --deep --network.'), true);
});

test('user report next steps distinguish dynamic failures from generic blockers', () => {
  const dynamicSteps = buildNextSteps({
    resultStatus: 'failed',
    context: defaultContext,
    report: { reasonCode: 'dynamic-unsupported' },
    confirmationRequired: [],
    disabledCapabilities: [],
    confirmationPaths: {},
  });
  assert.equal(dynamicSteps.some((step) => /sanitized public rendered structure summary/u.test(step)), true);

  assert.deepEqual(buildNextSteps({
    resultStatus: 'failed',
    context: defaultContext,
    report: { reasonAction: 'Fix robots and rerun.' },
    confirmationRequired: [],
    disabledCapabilities: [],
    confirmationPaths: {},
  }), [
    'Fix robots and rerun.',
  ]);
});
