import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CapabilityEvidenceStatus,
  CallableCapabilityEnablementStatus,
  CapabilityEnablementStatus,
  isKnownStatus,
} from '../../src/domain/status/status-vocabulary.mjs';
import {
  CAPABILITY_EVIDENCE_STATUSES,
  CAPABILITY_ENABLEMENT_STATUSES,
  CALLABLE_ENABLEMENT_STATUSES,
  capabilityEnablementStatusCounts,
  capabilityEvidenceStatusSummary,
  isCallableCapabilityEnablementStatus,
  normalizeCapabilityEnablementStatusFromPolicy,
  normalizeCapabilityEvidenceStatus,
} from '../../src/domain/status/capability-status.mjs';

test('capability status helpers use the shared domain status vocabulary', () => {
  assert.deepEqual(CAPABILITY_ENABLEMENT_STATUSES, CapabilityEnablementStatus);
  assert.deepEqual(CALLABLE_ENABLEMENT_STATUSES, CallableCapabilityEnablementStatus);
  assert.deepEqual(CAPABILITY_EVIDENCE_STATUSES, CapabilityEvidenceStatus);

  assert.equal(isCallableCapabilityEnablementStatus('enabled'), true);
  assert.equal(isCallableCapabilityEnablementStatus('draft_only'), true);
  assert.equal(isCallableCapabilityEnablementStatus('disabled'), false);
});

test('capability enablement normalization stays pure and policy driven', () => {
  assert.equal(
    normalizeCapabilityEnablementStatusFromPolicy({ status: 'candidate' }, { limited: true }),
    'candidate_debug_only',
  );
  assert.equal(
    normalizeCapabilityEnablementStatusFromPolicy({ status: 'discarded', enabled_status: 'candidate_debug_only' }),
    'candidate_debug_only',
  );
  assert.equal(
    normalizeCapabilityEnablementStatusFromPolicy({ enabled_status: 'enabled' }, { limited: true }),
    'limited_enabled',
  );
  assert.equal(
    normalizeCapabilityEnablementStatusFromPolicy({ enabled_status: 'enabled' }, { draftOnly: true }),
    'draft_only',
  );
  assert.equal(
    normalizeCapabilityEnablementStatusFromPolicy({ safetyLevel: 'requires_confirmation' }),
    'confirmation_required',
  );
  assert.equal(
    normalizeCapabilityEnablementStatusFromPolicy({ enabled_status: 'enabled' }, { limited: false, draftOnly: false }),
    'enabled',
  );
});

test('capability evidence normalization returns only capability evidence statuses', () => {
  const cases = /** @type {Array<[any, string]>} */ ([
    [{}, 'enabled'],
    [{ evidence_status: 'candidate' }, 'enabled'],
    [{ capabilityVerified: false }, 'enabled'],
    [{}, 'confirmation_required'],
    [{}, 'disabled'],
    [{}, 'candidate_debug_only'],
  ]);

  for (const [capability, enablementStatus] of cases) {
    const status = normalizeCapabilityEvidenceStatus(capability, enablementStatus);
    assert.equal(isKnownStatus('CapabilityEvidenceStatus', status), true);
  }
});

test('capability status summaries count normalized enablement and evidence states', () => {
  const capabilities = [
    { enabled_status: 'enabled' },
    { enabled_status: 'limited_enabled' },
    { default_policy: 'confirmation_required' },
    { status: 'candidate' },
    { enabled: false },
  ];

  assert.deepEqual(capabilityEnablementStatusCounts(capabilities), {
    enabled: 1,
    limited_enabled: 1,
    confirmation_required: 1,
    draft_only: 0,
    disabled: 1,
    debug_only: 0,
    candidate_debug_only: 1,
    countedTotal: 4,
  });
  assert.deepEqual(capabilityEvidenceStatusSummary(capabilities), {
    verified: 2,
    inferred: 0,
    confirmation_required: 1,
    disabled: 1,
    debug_only: 1,
    total: 5,
  });
});
