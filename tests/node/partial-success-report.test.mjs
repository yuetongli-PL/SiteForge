import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPartialSuccessOutcome,
  buildPartialSuccessReasons,
  partialSuccessReasonFromWarning,
  resultStatusFromBuild,
  safePublicReasonCode,
} from '../../src/app/pipeline/build/partial-success-report.mjs';

test('partial success report maps warnings to user-facing reasons', () => {
  assert.equal(
    partialSuccessReasonFromWarning('robots-disallowed'),
    'robots.txt blocked the candidate crawl scope.',
  );
  assert.equal(
    partialSuccessReasonFromWarning('crawl warning maxPages=3'),
    'Static crawl reached its configured page limit; remaining pages were not collected.',
  );
  assert.equal(partialSuccessReasonFromWarning('debug-only detail'), null);
  assert.equal(safePublicReasonCode(' Validation-Failed '), 'validation-failed');
  assert.equal(safePublicReasonCode('bad reason with spaces'), null);
});

test('partial success report reasons combine verification, setup, and capability state', () => {
  const reasons = buildPartialSuccessReasons({
    context: {
      options: { privacyMode: 'strict' },
      policy: {},
    },
    report: {
      reasonCode: 'validation-failed',
      summary: { verificationStatus: 'passed' },
      warnings: ['robots-unavailable', 'debug-only warning'],
    },
    setupCollectionReview: {
      summary: {
        capabilities: { missing: 1 },
        intents: { missing: 0 },
      },
    },
    capabilityState: {
      evidence_status_summary: { inferred: 2 },
      groups: {
        confirmation_required: [{ id: 'draft' }],
        limited_enabled: [{ id: 'read-private' }],
        disabled: [
          { id: 'publish', report_group: 'disabled', risk_level: 'write_high', action: 'submit' },
          { id: 'hidden-nav', report_group: 'disabled', risk_level: 'read_public_low', action: 'view' },
        ],
      },
    },
  });

  assert.deepEqual(new Set(reasons), new Set([
    '1 capabilities require user confirmation or draft-only handling.',
    '1 high-risk write, private, or account capabilities are disabled by default.',
    '1 sensitive read-only capabilities are limited to sanitized structural summaries.',
    '2 capabilities still rely on inferred evidence.',
    'Deep browser exploration was not enabled for this build.',
    'robots.txt could not be fetched, so the live build stopped safely.',
    'Sanitized network summary discovery was not enabled for this build.',
    'Some capabilities still lack confirmation or capability-level evidence.',
    'Strict privacy mode skips sensitive personal capabilities.',
  ]));
  assert.equal(reasons.some((reason) => /verification_report/u.test(reason)), false);
});

test('partial success report ignores non-recommended setup review gaps', () => {
  const reasons = buildPartialSuccessReasons({
    context: {
      options: { deep: true, privacyMode: 'standard' },
      policy: { captureNetwork: true },
    },
    report: {
      summary: { verificationStatus: 'passed' },
      warnings: [],
    },
    setupCollectionReview: {
      summary: {
        capabilities: { missing: 3 },
        intents: { missing: 2 },
      },
      missingRecordCount: 5,
      missingRecords: [
        { kind: 'capabilities', id: 'download-media', recommended: false },
        { kind: 'intents', id: 'open-settings-page', recommended: false },
      ],
    },
    capabilityState: {
      evidence_status_summary: {},
      groups: {},
    },
  });

  assert.equal(reasons.some((reason) => /lack confirmation/u.test(reason)), false);
});

test('partial success report derives user-facing result status from reasons', () => {
  assert.equal(resultStatusFromBuild({
    legacyStatus: 'failed',
    context: { options: { deep: true }, policy: { captureNetwork: true } },
    report: {},
    setupCollectionReview: null,
    capabilityState: { groups: {}, evidence_status_summary: {} },
  }), 'failed');

  assert.equal(resultStatusFromBuild({
    legacyStatus: 'success',
    context: { options: { deep: true }, policy: { captureNetwork: true } },
    report: { summary: { verificationStatus: 'passed' }, warnings: [] },
    setupCollectionReview: null,
    capabilityState: { groups: {}, evidence_status_summary: {} },
  }), 'success');

  assert.equal(resultStatusFromBuild({
    legacyStatus: 'success',
    context: { options: {}, policy: {} },
    report: { summary: { verificationStatus: 'passed' }, warnings: [] },
    setupCollectionReview: null,
    capabilityState: { groups: {}, evidence_status_summary: {} },
  }), 'partial_success');
});

test('partial success report outcome returns status and reasons from one input model', () => {
  const outcome = buildPartialSuccessOutcome({
    legacyStatus: 'success',
    context: {
      options: {},
      policy: {},
    },
    report: {
      summary: { verificationStatus: 'passed' },
      warnings: ['robots-disallowed'],
    },
    setupCollectionReview: null,
    capabilityState: {
      evidence_status_summary: {},
      groups: {},
    },
  });

  assert.equal(outcome.result_status, 'partial_success');
  assert.deepEqual(new Set(outcome.partial_success_reasons), new Set([
    'Deep browser exploration was not enabled for this build.',
    'robots.txt blocked the candidate crawl scope.',
    'Sanitized network summary discovery was not enabled for this build.',
  ]));

  assert.deepEqual(buildPartialSuccessOutcome({
    legacyStatus: 'failed',
    context: { options: { deep: true }, policy: { captureNetwork: true } },
    report: { summary: { verificationStatus: 'passed' }, warnings: [] },
    setupCollectionReview: null,
    capabilityState: { evidence_status_summary: {}, groups: {} },
  }), {
    result_status: 'failed',
    partial_success_reasons: [],
  });
});
