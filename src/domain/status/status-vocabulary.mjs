// @ts-check

export const StageStatus = Object.freeze([
  'pending',
  'running',
  'passed',
  'failed',
  'blocked',
  'skipped',
]);

export const BuildStatus = Object.freeze([
  'success',
  'partial_success',
  'failed',
  'blocked',
]);

export const OutcomeStatus = Object.freeze([
  'success',
  'partial_success',
  'failed',
  'blocked',
  'skipped',
]);

export const DownloadStatus = Object.freeze([
  'available',
  'blocked',
  'declared',
  'downloaded',
  'failed',
  'fixtureOnly',
  'planned',
  'skipped',
  'unavailable',
]);

export const CapabilityEnablementStatus = Object.freeze([
  'enabled',
  'limited_enabled',
  'confirmation_required',
  'disabled',
  'debug_only',
  'candidate_debug_only',
]);

export const EvidenceStatus = Object.freeze([
  'verified',
  'partial',
  'missing',
  'fixture_only',
  'unavailable',
]);

export const STATUS_VOCABULARY = Object.freeze({
  StageStatus,
  BuildStatus,
  OutcomeStatus,
  DownloadStatus,
  CapabilityEnablementStatus,
  EvidenceStatus,
});

export function statusVocabularySet(name) {
  const values = STATUS_VOCABULARY[name];
  if (!values) {
    throw new Error(`Unknown status vocabulary: ${name}`);
  }
  return new Set(values);
}

export function isKnownStatus(name, value) {
  return statusVocabularySet(name).has(String(value ?? ''));
}
