import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CapabilityEvidenceStatus,
  CallableCapabilityEnablementStatus,
  CapabilityEnablementStatus,
  isKnownStatus,
} from '../../src/domain/status/status-vocabulary.mjs';
import {
  CALLABLE_ENABLEMENT_STATUSES,
  CAPABILITY_ENABLEMENT_STATUSES,
  CAPABILITY_EVIDENCE_STATUSES,
  capabilityEnablementStatusCounts,
  capabilityEvidenceStatusSummary,
  createCapabilityRiskPolicy,
  normalizeCapabilityEnablementStatus,
  normalizeCapabilityEvidenceStatus,
} from '../../src/app/pipeline/build/risk-policy.mjs';
import {
  normalizeCapabilityEnablementStatusFromPolicy,
} from '../../src/domain/status/capability-status.mjs';

test('pipeline risk-policy status exports stay aligned with shared vocabulary', () => {
  assert.deepEqual(CAPABILITY_ENABLEMENT_STATUSES, CapabilityEnablementStatus);
  assert.deepEqual(CALLABLE_ENABLEMENT_STATUSES, CallableCapabilityEnablementStatus);
  assert.deepEqual(CAPABILITY_EVIDENCE_STATUSES, CapabilityEvidenceStatus);
});

test('capability evidence normalization only returns capability evidence vocabulary values', () => {
  for (const [capability, enablementStatus] of /** @type {Array<[any, string]>} */ ([
    [{}, 'enabled'],
    [{ evidence_status: 'candidate' }, 'enabled'],
    [{ capabilityVerified: false }, 'enabled'],
    [{}, 'confirmation_required'],
    [{}, 'disabled'],
    [{}, 'debug_only'],
  ])) {
    const status = normalizeCapabilityEvidenceStatus(capability, enablementStatus);
    assert.equal(isKnownStatus('CapabilityEvidenceStatus', status), true);
  }
});

test('capability evidence summary keys are derived from capability evidence vocabulary', () => {
  assert.deepEqual(Object.keys(capabilityEvidenceStatusSummary([])), [
    ...CapabilityEvidenceStatus,
    'total',
  ]);
});

test('pipeline risk-policy status wrappers keep app risk-policy defaults', () => {
  const capability = { riskLevel: 'write_low' };
  const policy = createCapabilityRiskPolicy(capability);

  assert.equal(normalizeCapabilityEnablementStatus(capability), 'enabled');
  assert.equal(
    normalizeCapabilityEnablementStatus(capability, policy),
    normalizeCapabilityEnablementStatusFromPolicy(capability, policy),
  );
  assert.deepEqual(capabilityEnablementStatusCounts([capability]), {
    enabled: 1,
    limited_enabled: 0,
    confirmation_required: 0,
    draft_only: 0,
    disabled: 0,
    debug_only: 0,
    candidate_debug_only: 0,
    countedTotal: 1,
  });
});
