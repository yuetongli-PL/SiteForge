import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BuildStatus,
  CapabilityEvidenceStatus,
  CallableCapabilityEnablementStatus,
  CapabilityEnablementStatus,
  DownloadStatus,
  EvidenceStatus,
  OutcomeStatus,
  StageStatus,
  isKnownStatus,
} from '../../src/domain/status/status-vocabulary.mjs';

test('status vocabulary defines the public report status sets', () => {
  assert.equal(isKnownStatus('BuildStatus', 'partial_success'), true);
  assert.equal(isKnownStatus('OutcomeStatus', 'failed'), true);
  assert.equal(isKnownStatus('DownloadStatus', 'blocked'), true);
  assert.equal(isKnownStatus('CapabilityEnablementStatus', 'debug_only'), true);
  assert.equal(isKnownStatus('CapabilityEnablementStatus', 'draft_only'), true);
  assert.equal(isKnownStatus('CallableCapabilityEnablementStatus', 'draft_only'), true);
  assert.equal(isKnownStatus('CallableCapabilityEnablementStatus', 'disabled'), false);
  assert.equal(isKnownStatus('EvidenceStatus', 'fixture_only'), true);
  assert.equal(isKnownStatus('CapabilityEvidenceStatus', 'inferred'), true);
  assert.equal(isKnownStatus('CapabilityEvidenceStatus', 'partial'), false);
  assert.equal(isKnownStatus('StageStatus', 'passed'), true);
  assert.equal(isKnownStatus('BuildStatus', 'mystery'), false);
});

test('callable capability enablement status is the callable subset', () => {
  assert.deepEqual(CallableCapabilityEnablementStatus, [
    'enabled',
    'limited_enabled',
    'confirmation_required',
    'draft_only',
  ]);
});

test('status vocabulary stays duplicate-free', () => {
  for (const [name, values] of Object.entries({
    StageStatus,
    BuildStatus,
    OutcomeStatus,
    DownloadStatus,
    CapabilityEnablementStatus,
    CallableCapabilityEnablementStatus,
    EvidenceStatus,
    CapabilityEvidenceStatus,
  })) {
    assert.equal(new Set(values).size, values.length, `${name} contains duplicate values`);
  }
});

test('result_status and legacy_status report contracts share public build outcomes', () => {
  assert.deepEqual(BuildStatus, [
    'success',
    'partial_success',
    'failed',
    'blocked',
  ]);
  assert.deepEqual(OutcomeStatus, [
    ...BuildStatus,
    'skipped',
  ]);
  for (const status of BuildStatus) {
    assert.equal(isKnownStatus('OutcomeStatus', status), true);
  }
});
