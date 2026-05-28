// @ts-check

import {
  CapabilityEvidenceStatus,
  CapabilityEnablementStatus,
  CallableCapabilityEnablementStatus,
} from './status-vocabulary.mjs';

export const CAPABILITY_ENABLEMENT_STATUSES = CapabilityEnablementStatus;
export const CALLABLE_ENABLEMENT_STATUSES = CallableCapabilityEnablementStatus;
export const CAPABILITY_EVIDENCE_STATUSES = CapabilityEvidenceStatus;

const CAPABILITY_ENABLEMENT_STATUS_SET = new Set(CAPABILITY_ENABLEMENT_STATUSES);
const CALLABLE_ENABLEMENT_STATUS_SET = new Set(CALLABLE_ENABLEMENT_STATUSES);

function normalizeEnablementToken(value) {
  const text = String(value ?? '').trim();
  return CAPABILITY_ENABLEMENT_STATUS_SET.has(text) ? text : null;
}

export function isCallableCapabilityEnablementStatus(value) {
  return CALLABLE_ENABLEMENT_STATUS_SET.has(String(value ?? ''));
}

export function normalizeCapabilityEnablementStatusFromPolicy(
  capability = /** @type {any} */ ({}),
  policy = capability.riskPolicy ?? {},
) {
  const explicit = normalizeEnablementToken(capability.enabled_status);
  const lifecycleStatus = String(capability.status ?? '').trim().toLowerCase();
  if (lifecycleStatus === 'candidate') {
    return explicit === 'debug_only' || explicit === 'candidate_debug_only'
      ? explicit
      : 'candidate_debug_only';
  }
  if (lifecycleStatus === 'discarded') {
    return explicit === 'candidate_debug_only' ? 'candidate_debug_only' : 'debug_only';
  }
  if (explicit === 'disabled' || explicit === 'debug_only' || explicit === 'candidate_debug_only') {
    return explicit;
  }
  if (
    policy.disabled === true
    || capability.disabledByPolicy === true
    || capability.enabled === false
    || lifecycleStatus === 'disabled'
    || capability.default_policy === 'disabled'
  ) {
    return 'disabled';
  }
  if (explicit === 'limited_enabled' || explicit === 'draft_only') {
    return explicit;
  }
  if (explicit === 'confirmation_required') {
    return explicit;
  }
  if (explicit === 'enabled' && policy.limited !== true && policy.draftOnly !== true) {
    return explicit;
  }
  if (policy.draftOnly === true || capability.default_policy === 'draft_only') {
    return 'draft_only';
  }
  if (policy.limited === true || capability.default_policy === 'confirm_or_limited') {
    return 'limited_enabled';
  }
  if (capability.safetyLevel === 'requires_confirmation' || capability.default_policy === 'confirmation_required') {
    return 'confirmation_required';
  }
  return 'enabled';
}

export function normalizeCapabilityEvidenceStatus(
  capability = /** @type {any} */ ({}),
  enablementStatus = normalizeCapabilityEnablementStatusFromPolicy(capability),
) {
  if (enablementStatus === 'debug_only' || enablementStatus === 'candidate_debug_only') {
    return 'debug_only';
  }
  if (enablementStatus === 'disabled') {
    return 'disabled';
  }
  if (enablementStatus === 'confirmation_required' || enablementStatus === 'draft_only') {
    return 'confirmation_required';
  }
  if (capability.evidence_status === 'inferred' || capability.capabilityVerified === false) {
    return 'inferred';
  }
  if (capability.evidence_status === 'verified') {
    return 'verified';
  }
  if (capability.evidence_status === 'candidate') {
    return 'inferred';
  }
  return 'verified';
}

export function capabilityEvidenceStatusSummary(
  capabilities = /** @type {any[]} */ ([]),
  options = /** @type {any} */ ({}),
) {
  const normalizeEnablementStatus =
    options.normalizeEnablementStatus ?? normalizeCapabilityEnablementStatusFromPolicy;
  const summary = Object.fromEntries(CAPABILITY_EVIDENCE_STATUSES.map((status) => [status, 0]));
  summary.total = 0;
  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    const enablementStatus = normalizeEnablementStatus(capability);
    const evidenceStatus = normalizeCapabilityEvidenceStatus(capability, enablementStatus);
    summary[evidenceStatus] = (summary[evidenceStatus] ?? 0) + 1;
    summary.total += 1;
  }
  return summary;
}

export function capabilityEnablementStatusCounts(
  capabilities = /** @type {any[]} */ ([]),
  options = /** @type {any} */ ({}),
) {
  const normalizeEnablementStatus =
    options.normalizeEnablementStatus ?? normalizeCapabilityEnablementStatusFromPolicy;
  const counts = Object.fromEntries(CAPABILITY_ENABLEMENT_STATUSES.map((status) => [status, 0]));
  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    const status = normalizeEnablementStatus(capability);
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return {
    ...counts,
    countedTotal: counts.enabled
      + counts.limited_enabled
      + counts.confirmation_required
      + counts.draft_only
      + counts.disabled,
  };
}
