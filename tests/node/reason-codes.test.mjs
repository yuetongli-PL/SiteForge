import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REASON_CODE_CATALOG,
  REASON_CODE_SCHEMA_VERSION,
  assertReasonCodeCatalogValid,
  findReasonCodeDefinition,
  isKnownReasonCode,
  listReasonCodeDefinitions,
  normalizeReasonCode,
  reasonCodeSummary,
  requireReasonCodeDefinition,
} from '../../src/sites/capability/reason-codes.mjs';

const CURRENT_CAPTURE_CODES = [
  'INVALID_INPUT',
  'HTML_CAPTURE_FAILED',
  'SNAPSHOT_CAPTURE_FAILED',
  'SCREENSHOT_FALLBACK',
  'SCREENSHOT_CAPTURE_FAILED',
  'PAGE_METADATA_FAILED',
  'CAPTURE_FAILED',
  'ANTI_CRAWL_CHALLENGE',
];

const CURRENT_SESSION_CODES = [
  'session-invalid',
  'login-required',
  'reusable-profile-unavailable',
  'missing-user-data-dir',
  'reuse-login-state-disabled',
  'session-required',
  'session-health-manifest-missing',
  'approval-required',
  'session-revocation-handle-missing',
  'session-revocation-invalid',
];

const CURRENT_RISK_CODES = [
  'concurrent-profile-use',
  'profile-health-risk',
  'network-identity-drift',
  'request-burst',
  'browser-fingerprint-risk',
  'unknown-risk',
  'anti-crawl-verify',
  'blocked-by-cloudflare-challenge',
  'self-profile-captcha',
];

const CURRENT_DOWNLOAD_CODES = [
  'dry-run',
  'no-resolved-resources',
  'bilibili-api-evidence-unavailable',
  'download-policy-generation-failed',
  'existing-file',
  'verification-failed',
  'fetch-error',
  'download-failed',
  'download-failures',
  'http-500',
  'retry-state-missing',
  'retry-failed-none',
  'retry-queue-missing',
  'queue-invalid-json',
  'media-queue-invalid-json',
  'queue-invalid-shape',
  'media-queue-invalid-shape',
  'source-queue-invalid-shape',
  'source-queue-invalid-json',
  'source-queue-missing',
  'source-manifest-missing',
  'source-manifest-invalid-json',
  'source-media-queue-invalid-shape',
  'source-media-queue-invalid-json',
  'source-media-queue-missing',
  'source-media-manifest-missing',
  'source-media-manifest-invalid-json',
  'manifest-invalid-json',
  'media-manifest-invalid-json',
  'downloads-invalid-jsonl',
  'source-downloads-invalid-jsonl',
  'downloads-read-failed',
  'source-downloads-read-failed',
  'legacy-retry-failed-unsupported',
  'resume-state-missing',
  'legacy-resume-unsupported',
  'manifest-queue-count-mismatch',
  'manifest-queue-resource-mismatch',
  'queue-downloads-resource-mismatch',
  'recovery-artifact-missing',
  'recovery-artifact-not-file',
  'recovery-artifact-size-mismatch',
  'retry-failed-not-failed',
  'mux-failed',
  'mux-error',
];

const CURRENT_ARTIFACT_CODES = [
  'redaction-failed',
  'lifecycle-artifact-write-failed',
];

const CURRENT_SCHEMA_CODES = [
  'schema-version-incompatible',
];

const CURRENT_API_CODES = [
  'api-candidate-generation-failed',
  'site-adapter-core-api-unidentified',
  'api-verification-failed',
  'api-catalog-endpoint-expired',
  'api-auth-verification-failed',
  'api-csrf-validation-failed',
  'api-request-signature-invalid',
  'api-permission-denied',
  'api-pagination-verification-failed',
  'api-risk-verification-failed',
  'api-catalog-entry-blocked',
  'api-catalog-write-failed',
];

test('reasonCode catalog is versioned and internally valid', () => {
  assert.equal(REASON_CODE_SCHEMA_VERSION, 1);
  assert.equal(assertReasonCodeCatalogValid(), true);
  assert.equal(REASON_CODE_CATALOG.length, listReasonCodeDefinitions().length);
});

test('reasonCode catalog covers current capture, session, risk, downloader, and API codes', () => {
  for (const code of [
    ...CURRENT_CAPTURE_CODES,
    ...CURRENT_SESSION_CODES,
    ...CURRENT_RISK_CODES,
    ...CURRENT_DOWNLOAD_CODES,
    ...CURRENT_ARTIFACT_CODES,
    ...CURRENT_SCHEMA_CODES,
    ...CURRENT_API_CODES,
  ]) {
    assert.equal(isKnownReasonCode(code), true, `${code} should be in the reasonCode catalog`);
  }
});

test('reasonCode lookups preserve family and recovery semantics', () => {
  assert.equal(requireReasonCodeDefinition('ANTI_CRAWL_CHALLENGE', { family: 'capture' }).manualRecoveryNeeded, true);
  assert.equal(requireReasonCodeDefinition('session-invalid', { family: 'session' }).retryable, true);
  assert.equal(requireReasonCodeDefinition('request-burst', { family: 'risk' }).cooldownNeeded, true);
  assert.equal(requireReasonCodeDefinition('self-profile-captcha', { family: 'risk' }).manualRecoveryNeeded, true);
  const cloudflareChallenge = reasonCodeSummary('blocked-by-cloudflare-challenge');
  assert.equal(requireReasonCodeDefinition('blocked-by-cloudflare-challenge', { family: 'risk' }).manualRecoveryNeeded, true);
  assert.equal(cloudflareChallenge.retryable, false);
  assert.equal(cloudflareChallenge.cooldownNeeded, true);
  assert.equal(cloudflareChallenge.isolationNeeded, true);
  assert.equal(cloudflareChallenge.manualRecoveryNeeded, true);
  assert.equal(cloudflareChallenge.degradable, true);
  assert.equal(cloudflareChallenge.artifactWriteAllowed, true);
  assert.equal(requireReasonCodeDefinition('dry-run', { family: 'download' }).degradable, true);
  const policyGenerationFailed = reasonCodeSummary('download-policy-generation-failed');
  assert.equal(
    requireReasonCodeDefinition('download-policy-generation-failed', { family: 'download' }).manualRecoveryNeeded,
    true,
  );
  assert.equal(policyGenerationFailed.retryable, false);
  assert.equal(policyGenerationFailed.cooldownNeeded, false);
  assert.equal(policyGenerationFailed.isolationNeeded, false);
  assert.equal(policyGenerationFailed.manualRecoveryNeeded, true);
  assert.equal(policyGenerationFailed.degradable, true);
  assert.equal(policyGenerationFailed.artifactWriteAllowed, false);
  const missingRevocationHandle = reasonCodeSummary('session-revocation-handle-missing');
  assert.equal(requireReasonCodeDefinition('session-revocation-handle-missing', { family: 'session' }).manualRecoveryNeeded, true);
  assert.equal(missingRevocationHandle.retryable, false);
  assert.equal(missingRevocationHandle.cooldownNeeded, false);
  assert.equal(missingRevocationHandle.isolationNeeded, false);
  assert.equal(missingRevocationHandle.manualRecoveryNeeded, true);
  assert.equal(missingRevocationHandle.artifactWriteAllowed, true);
  const invalidRevocation = reasonCodeSummary('session-revocation-invalid');
  assert.equal(requireReasonCodeDefinition('session-revocation-invalid', { family: 'session' }).manualRecoveryNeeded, true);
  assert.equal(invalidRevocation.retryable, false);
  assert.equal(invalidRevocation.cooldownNeeded, false);
  assert.equal(invalidRevocation.isolationNeeded, false);
  assert.equal(invalidRevocation.manualRecoveryNeeded, true);
  assert.equal(invalidRevocation.artifactWriteAllowed, false);
  const missingSourceQueue = reasonCodeSummary('source-media-queue-missing');
  assert.equal(requireReasonCodeDefinition('source-media-queue-missing', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(missingSourceQueue.retryable, false);
  assert.equal(missingSourceQueue.cooldownNeeded, false);
  assert.equal(missingSourceQueue.isolationNeeded, false);
  assert.equal(missingSourceQueue.manualRecoveryNeeded, true);
  assert.equal(missingSourceQueue.artifactWriteAllowed, true);
  const sourceMediaManifestMissing = reasonCodeSummary('source-media-manifest-missing');
  assert.equal(requireReasonCodeDefinition('source-media-manifest-missing', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(sourceMediaManifestMissing.retryable, false);
  assert.equal(sourceMediaManifestMissing.cooldownNeeded, false);
  assert.equal(sourceMediaManifestMissing.isolationNeeded, false);
  assert.equal(sourceMediaManifestMissing.manualRecoveryNeeded, true);
  assert.equal(sourceMediaManifestMissing.degradable, false);
  assert.equal(sourceMediaManifestMissing.artifactWriteAllowed, true);
  const sourceMediaManifestInvalidJson = reasonCodeSummary('source-media-manifest-invalid-json');
  assert.equal(requireReasonCodeDefinition('source-media-manifest-invalid-json', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(sourceMediaManifestInvalidJson.retryable, false);
  assert.equal(sourceMediaManifestInvalidJson.cooldownNeeded, false);
  assert.equal(sourceMediaManifestInvalidJson.isolationNeeded, false);
  assert.equal(sourceMediaManifestInvalidJson.manualRecoveryNeeded, true);
  assert.equal(sourceMediaManifestInvalidJson.degradable, false);
  assert.equal(sourceMediaManifestInvalidJson.artifactWriteAllowed, true);
  const manifestInvalidJson = reasonCodeSummary('manifest-invalid-json');
  assert.equal(requireReasonCodeDefinition('manifest-invalid-json', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(manifestInvalidJson.retryable, false);
  assert.equal(manifestInvalidJson.cooldownNeeded, false);
  assert.equal(manifestInvalidJson.isolationNeeded, false);
  assert.equal(manifestInvalidJson.manualRecoveryNeeded, true);
  assert.equal(manifestInvalidJson.degradable, false);
  assert.equal(manifestInvalidJson.artifactWriteAllowed, true);
  const mediaManifestInvalidJson = reasonCodeSummary('media-manifest-invalid-json');
  assert.equal(requireReasonCodeDefinition('media-manifest-invalid-json', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(mediaManifestInvalidJson.retryable, false);
  assert.equal(mediaManifestInvalidJson.cooldownNeeded, false);
  assert.equal(mediaManifestInvalidJson.isolationNeeded, false);
  assert.equal(mediaManifestInvalidJson.manualRecoveryNeeded, true);
  assert.equal(mediaManifestInvalidJson.degradable, false);
  assert.equal(mediaManifestInvalidJson.artifactWriteAllowed, true);
  const downloadsInvalidJsonl = reasonCodeSummary('downloads-invalid-jsonl');
  assert.equal(requireReasonCodeDefinition('downloads-invalid-jsonl', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(downloadsInvalidJsonl.retryable, false);
  assert.equal(downloadsInvalidJsonl.cooldownNeeded, false);
  assert.equal(downloadsInvalidJsonl.isolationNeeded, false);
  assert.equal(downloadsInvalidJsonl.manualRecoveryNeeded, true);
  assert.equal(downloadsInvalidJsonl.degradable, false);
  assert.equal(downloadsInvalidJsonl.artifactWriteAllowed, true);
  const sourceDownloadsInvalidJsonl = reasonCodeSummary('source-downloads-invalid-jsonl');
  assert.equal(requireReasonCodeDefinition('source-downloads-invalid-jsonl', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(sourceDownloadsInvalidJsonl.retryable, false);
  assert.equal(sourceDownloadsInvalidJsonl.cooldownNeeded, false);
  assert.equal(sourceDownloadsInvalidJsonl.isolationNeeded, false);
  assert.equal(sourceDownloadsInvalidJsonl.manualRecoveryNeeded, true);
  assert.equal(sourceDownloadsInvalidJsonl.degradable, false);
  assert.equal(sourceDownloadsInvalidJsonl.artifactWriteAllowed, true);
  const downloadsReadFailed = reasonCodeSummary('downloads-read-failed');
  assert.equal(requireReasonCodeDefinition('downloads-read-failed', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(downloadsReadFailed.retryable, false);
  assert.equal(downloadsReadFailed.cooldownNeeded, false);
  assert.equal(downloadsReadFailed.isolationNeeded, false);
  assert.equal(downloadsReadFailed.manualRecoveryNeeded, true);
  assert.equal(downloadsReadFailed.degradable, false);
  assert.equal(downloadsReadFailed.artifactWriteAllowed, true);
  const sourceDownloadsReadFailed = reasonCodeSummary('source-downloads-read-failed');
  assert.equal(requireReasonCodeDefinition('source-downloads-read-failed', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(sourceDownloadsReadFailed.retryable, false);
  assert.equal(sourceDownloadsReadFailed.cooldownNeeded, false);
  assert.equal(sourceDownloadsReadFailed.isolationNeeded, false);
  assert.equal(sourceDownloadsReadFailed.manualRecoveryNeeded, true);
  assert.equal(sourceDownloadsReadFailed.degradable, false);
  assert.equal(sourceDownloadsReadFailed.artifactWriteAllowed, true);
  const manifestQueueResourceMismatch = reasonCodeSummary('manifest-queue-resource-mismatch');
  assert.equal(requireReasonCodeDefinition('manifest-queue-resource-mismatch', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(manifestQueueResourceMismatch.retryable, false);
  assert.equal(manifestQueueResourceMismatch.cooldownNeeded, false);
  assert.equal(manifestQueueResourceMismatch.isolationNeeded, false);
  assert.equal(manifestQueueResourceMismatch.manualRecoveryNeeded, true);
  assert.equal(manifestQueueResourceMismatch.degradable, false);
  assert.equal(manifestQueueResourceMismatch.artifactWriteAllowed, true);
  const queueDownloadsResourceMismatch = reasonCodeSummary('queue-downloads-resource-mismatch');
  assert.equal(requireReasonCodeDefinition('queue-downloads-resource-mismatch', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(queueDownloadsResourceMismatch.retryable, false);
  assert.equal(queueDownloadsResourceMismatch.cooldownNeeded, false);
  assert.equal(queueDownloadsResourceMismatch.isolationNeeded, false);
  assert.equal(queueDownloadsResourceMismatch.manualRecoveryNeeded, true);
  assert.equal(queueDownloadsResourceMismatch.degradable, false);
  assert.equal(queueDownloadsResourceMismatch.artifactWriteAllowed, true);
  const recoveryArtifactMissing = reasonCodeSummary('recovery-artifact-missing');
  assert.equal(requireReasonCodeDefinition('recovery-artifact-missing', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(recoveryArtifactMissing.retryable, false);
  assert.equal(recoveryArtifactMissing.cooldownNeeded, false);
  assert.equal(recoveryArtifactMissing.isolationNeeded, false);
  assert.equal(recoveryArtifactMissing.manualRecoveryNeeded, true);
  assert.equal(recoveryArtifactMissing.degradable, false);
  assert.equal(recoveryArtifactMissing.artifactWriteAllowed, true);
  const recoveryArtifactNotFile = reasonCodeSummary('recovery-artifact-not-file');
  assert.equal(requireReasonCodeDefinition('recovery-artifact-not-file', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(recoveryArtifactNotFile.retryable, false);
  assert.equal(recoveryArtifactNotFile.cooldownNeeded, false);
  assert.equal(recoveryArtifactNotFile.isolationNeeded, false);
  assert.equal(recoveryArtifactNotFile.manualRecoveryNeeded, true);
  assert.equal(recoveryArtifactNotFile.degradable, false);
  assert.equal(recoveryArtifactNotFile.artifactWriteAllowed, true);
  const recoveryArtifactSizeMismatch = reasonCodeSummary('recovery-artifact-size-mismatch');
  assert.equal(requireReasonCodeDefinition('recovery-artifact-size-mismatch', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(recoveryArtifactSizeMismatch.retryable, false);
  assert.equal(recoveryArtifactSizeMismatch.cooldownNeeded, false);
  assert.equal(recoveryArtifactSizeMismatch.isolationNeeded, false);
  assert.equal(recoveryArtifactSizeMismatch.manualRecoveryNeeded, true);
  assert.equal(recoveryArtifactSizeMismatch.degradable, false);
  assert.equal(recoveryArtifactSizeMismatch.artifactWriteAllowed, true);
  const fetchError = reasonCodeSummary('fetch-error');
  assert.equal(requireReasonCodeDefinition('fetch-error', { family: 'download' }).retryable, true);
  assert.equal(fetchError.retryable, true);
  assert.equal(fetchError.cooldownNeeded, false);
  assert.equal(fetchError.isolationNeeded, false);
  assert.equal(fetchError.manualRecoveryNeeded, false);
  assert.equal(fetchError.degradable, false);
  assert.equal(fetchError.artifactWriteAllowed, true);
  const downloadFailures = reasonCodeSummary('download-failures');
  assert.equal(requireReasonCodeDefinition('download-failures', { family: 'download' }).retryable, true);
  assert.equal(downloadFailures.retryable, true);
  assert.equal(downloadFailures.cooldownNeeded, false);
  assert.equal(downloadFailures.isolationNeeded, false);
  assert.equal(downloadFailures.manualRecoveryNeeded, false);
  assert.equal(downloadFailures.degradable, false);
  assert.equal(downloadFailures.artifactWriteAllowed, true);
  const http500 = reasonCodeSummary('http-500');
  assert.equal(requireReasonCodeDefinition('http-500', { family: 'download' }).retryable, true);
  assert.equal(http500.retryable, true);
  assert.equal(http500.cooldownNeeded, false);
  assert.equal(http500.isolationNeeded, false);
  assert.equal(http500.manualRecoveryNeeded, false);
  assert.equal(http500.degradable, false);
  assert.equal(http500.artifactWriteAllowed, true);
  const retryFailedNotFailed = reasonCodeSummary('retry-failed-not-failed');
  assert.equal(requireReasonCodeDefinition('retry-failed-not-failed', { family: 'download' }).degradable, true);
  assert.equal(retryFailedNotFailed.retryable, false);
  assert.equal(retryFailedNotFailed.cooldownNeeded, false);
  assert.equal(retryFailedNotFailed.isolationNeeded, false);
  assert.equal(retryFailedNotFailed.manualRecoveryNeeded, false);
  assert.equal(retryFailedNotFailed.degradable, true);
  assert.equal(retryFailedNotFailed.artifactWriteAllowed, true);
  const legacyRetryUnsupported = reasonCodeSummary('legacy-retry-failed-unsupported');
  assert.equal(requireReasonCodeDefinition('legacy-retry-failed-unsupported', { family: 'download' }).degradable, true);
  assert.equal(legacyRetryUnsupported.retryable, false);
  assert.equal(legacyRetryUnsupported.cooldownNeeded, false);
  assert.equal(legacyRetryUnsupported.isolationNeeded, false);
  assert.equal(legacyRetryUnsupported.manualRecoveryNeeded, false);
  assert.equal(legacyRetryUnsupported.degradable, true);
  assert.equal(legacyRetryUnsupported.artifactWriteAllowed, true);
  const resumeStateMissing = reasonCodeSummary('resume-state-missing');
  assert.equal(requireReasonCodeDefinition('resume-state-missing', { family: 'download' }).retryable, false);
  assert.equal(resumeStateMissing.retryable, false);
  assert.equal(resumeStateMissing.cooldownNeeded, false);
  assert.equal(resumeStateMissing.isolationNeeded, false);
  assert.equal(resumeStateMissing.manualRecoveryNeeded, false);
  assert.equal(resumeStateMissing.degradable, false);
  assert.equal(resumeStateMissing.artifactWriteAllowed, true);
  const legacyResumeUnsupported = reasonCodeSummary('legacy-resume-unsupported');
  assert.equal(requireReasonCodeDefinition('legacy-resume-unsupported', { family: 'download' }).degradable, true);
  assert.equal(legacyResumeUnsupported.retryable, false);
  assert.equal(legacyResumeUnsupported.cooldownNeeded, false);
  assert.equal(legacyResumeUnsupported.isolationNeeded, false);
  assert.equal(legacyResumeUnsupported.manualRecoveryNeeded, false);
  assert.equal(legacyResumeUnsupported.degradable, true);
  assert.equal(legacyResumeUnsupported.artifactWriteAllowed, true);
  const retryQueueMissing = reasonCodeSummary('retry-queue-missing');
  assert.equal(requireReasonCodeDefinition('retry-queue-missing', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(retryQueueMissing.retryable, false);
  assert.equal(retryQueueMissing.cooldownNeeded, false);
  assert.equal(retryQueueMissing.isolationNeeded, false);
  assert.equal(retryQueueMissing.manualRecoveryNeeded, true);
  assert.equal(retryQueueMissing.degradable, false);
  assert.equal(retryQueueMissing.artifactWriteAllowed, true);
  const queueInvalidJson = reasonCodeSummary('queue-invalid-json');
  assert.equal(requireReasonCodeDefinition('queue-invalid-json', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(queueInvalidJson.retryable, false);
  assert.equal(queueInvalidJson.cooldownNeeded, false);
  assert.equal(queueInvalidJson.isolationNeeded, false);
  assert.equal(queueInvalidJson.manualRecoveryNeeded, true);
  assert.equal(queueInvalidJson.degradable, false);
  assert.equal(queueInvalidJson.artifactWriteAllowed, true);
  const mediaQueueInvalidJson = reasonCodeSummary('media-queue-invalid-json');
  assert.equal(requireReasonCodeDefinition('media-queue-invalid-json', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(mediaQueueInvalidJson.retryable, false);
  assert.equal(mediaQueueInvalidJson.cooldownNeeded, false);
  assert.equal(mediaQueueInvalidJson.isolationNeeded, false);
  assert.equal(mediaQueueInvalidJson.manualRecoveryNeeded, true);
  assert.equal(mediaQueueInvalidJson.degradable, false);
  assert.equal(mediaQueueInvalidJson.artifactWriteAllowed, true);
  const queueInvalidShape = reasonCodeSummary('queue-invalid-shape');
  assert.equal(requireReasonCodeDefinition('queue-invalid-shape', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(queueInvalidShape.retryable, false);
  assert.equal(queueInvalidShape.cooldownNeeded, false);
  assert.equal(queueInvalidShape.isolationNeeded, false);
  assert.equal(queueInvalidShape.manualRecoveryNeeded, true);
  assert.equal(queueInvalidShape.degradable, false);
  assert.equal(queueInvalidShape.artifactWriteAllowed, true);
  const mediaQueueInvalidShape = reasonCodeSummary('media-queue-invalid-shape');
  assert.equal(requireReasonCodeDefinition('media-queue-invalid-shape', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(mediaQueueInvalidShape.retryable, false);
  assert.equal(mediaQueueInvalidShape.cooldownNeeded, false);
  assert.equal(mediaQueueInvalidShape.isolationNeeded, false);
  assert.equal(mediaQueueInvalidShape.manualRecoveryNeeded, true);
  assert.equal(mediaQueueInvalidShape.degradable, false);
  assert.equal(mediaQueueInvalidShape.artifactWriteAllowed, true);
  const sourceQueueInvalidShape = reasonCodeSummary('source-queue-invalid-shape');
  assert.equal(requireReasonCodeDefinition('source-queue-invalid-shape', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(sourceQueueInvalidShape.retryable, false);
  assert.equal(sourceQueueInvalidShape.cooldownNeeded, false);
  assert.equal(sourceQueueInvalidShape.isolationNeeded, false);
  assert.equal(sourceQueueInvalidShape.manualRecoveryNeeded, true);
  assert.equal(sourceQueueInvalidShape.degradable, false);
  assert.equal(sourceQueueInvalidShape.artifactWriteAllowed, true);
  const sourceQueueInvalidJson = reasonCodeSummary('source-queue-invalid-json');
  assert.equal(requireReasonCodeDefinition('source-queue-invalid-json', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(sourceQueueInvalidJson.retryable, false);
  assert.equal(sourceQueueInvalidJson.cooldownNeeded, false);
  assert.equal(sourceQueueInvalidJson.isolationNeeded, false);
  assert.equal(sourceQueueInvalidJson.manualRecoveryNeeded, true);
  assert.equal(sourceQueueInvalidJson.degradable, false);
  assert.equal(sourceQueueInvalidJson.artifactWriteAllowed, true);
  const sourceQueueMissing = reasonCodeSummary('source-queue-missing');
  assert.equal(requireReasonCodeDefinition('source-queue-missing', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(sourceQueueMissing.retryable, false);
  assert.equal(sourceQueueMissing.cooldownNeeded, false);
  assert.equal(sourceQueueMissing.isolationNeeded, false);
  assert.equal(sourceQueueMissing.manualRecoveryNeeded, true);
  assert.equal(sourceQueueMissing.degradable, false);
  assert.equal(sourceQueueMissing.artifactWriteAllowed, true);
  const sourceManifestMissing = reasonCodeSummary('source-manifest-missing');
  assert.equal(requireReasonCodeDefinition('source-manifest-missing', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(sourceManifestMissing.retryable, false);
  assert.equal(sourceManifestMissing.cooldownNeeded, false);
  assert.equal(sourceManifestMissing.isolationNeeded, false);
  assert.equal(sourceManifestMissing.manualRecoveryNeeded, true);
  assert.equal(sourceManifestMissing.degradable, false);
  assert.equal(sourceManifestMissing.artifactWriteAllowed, true);
  const sourceManifestInvalidJson = reasonCodeSummary('source-manifest-invalid-json');
  assert.equal(requireReasonCodeDefinition('source-manifest-invalid-json', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(sourceManifestInvalidJson.retryable, false);
  assert.equal(sourceManifestInvalidJson.cooldownNeeded, false);
  assert.equal(sourceManifestInvalidJson.isolationNeeded, false);
  assert.equal(sourceManifestInvalidJson.manualRecoveryNeeded, true);
  assert.equal(sourceManifestInvalidJson.degradable, false);
  assert.equal(sourceManifestInvalidJson.artifactWriteAllowed, true);
  const sourceMediaQueueInvalidShape = reasonCodeSummary('source-media-queue-invalid-shape');
  assert.equal(requireReasonCodeDefinition('source-media-queue-invalid-shape', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(sourceMediaQueueInvalidShape.retryable, false);
  assert.equal(sourceMediaQueueInvalidShape.cooldownNeeded, false);
  assert.equal(sourceMediaQueueInvalidShape.isolationNeeded, false);
  assert.equal(sourceMediaQueueInvalidShape.manualRecoveryNeeded, true);
  assert.equal(sourceMediaQueueInvalidShape.degradable, false);
  assert.equal(sourceMediaQueueInvalidShape.artifactWriteAllowed, true);
  const sourceMediaQueueInvalidJson = reasonCodeSummary('source-media-queue-invalid-json');
  assert.equal(requireReasonCodeDefinition('source-media-queue-invalid-json', { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(sourceMediaQueueInvalidJson.retryable, false);
  assert.equal(sourceMediaQueueInvalidJson.cooldownNeeded, false);
  assert.equal(sourceMediaQueueInvalidJson.isolationNeeded, false);
  assert.equal(sourceMediaQueueInvalidJson.manualRecoveryNeeded, true);
  assert.equal(sourceMediaQueueInvalidJson.degradable, false);
  assert.equal(sourceMediaQueueInvalidJson.artifactWriteAllowed, true);
  const manifestQueueMismatch = reasonCodeSummary('manifest-queue-count-mismatch');
  assert.equal(manifestQueueMismatch.retryable, false);
  assert.equal(manifestQueueMismatch.cooldownNeeded, false);
  assert.equal(manifestQueueMismatch.isolationNeeded, false);
  assert.equal(manifestQueueMismatch.manualRecoveryNeeded, true);
  assert.equal(manifestQueueMismatch.artifactWriteAllowed, true);
  const schemaIncompatible = reasonCodeSummary('schema-version-incompatible');
  assert.equal(requireReasonCodeDefinition('schema-version-incompatible', { family: 'schema' }).manualRecoveryNeeded, true);
  assert.equal(schemaIncompatible.retryable, false);
  assert.equal(schemaIncompatible.cooldownNeeded, false);
  assert.equal(schemaIncompatible.isolationNeeded, false);
  assert.equal(schemaIncompatible.manualRecoveryNeeded, true);
  assert.equal(schemaIncompatible.artifactWriteAllowed, false);
  assert.equal(reasonCodeSummary('redaction-failed').artifactWriteAllowed, false);
  const catalogExpired = reasonCodeSummary('api-catalog-endpoint-expired');
  assert.equal(requireReasonCodeDefinition('api-catalog-endpoint-expired', { family: 'api' }).catalogAction, 'deprecate');
  assert.equal(catalogExpired.retryable, true);
  assert.equal(catalogExpired.catalogAction, 'deprecate');
  assert.equal(catalogExpired.artifactWriteAllowed, true);
  assert.equal(findReasonCodeDefinition('missing-code'), null);
  assert.equal(normalizeReasonCode('session-invalid'), 'session-invalid');
  assert.equal(normalizeReasonCode('legacy-site-specific-reason'), 'legacy-site-specific-reason');
  assert.equal(normalizeReasonCode(''), undefined);
});

test('risk governance reasonCodes expose cooldown isolation and recovery semantics', () => {
  assert.deepEqual(reasonCodeSummary('concurrent-profile-use'), {
    code: 'concurrent-profile-use',
    family: 'risk',
    retryable: true,
    cooldownNeeded: true,
    isolationNeeded: true,
    manualRecoveryNeeded: false,
    degradable: false,
    artifactWriteAllowed: true,
    catalogAction: 'none',
  });
  assert.deepEqual(reasonCodeSummary('network-identity-drift'), {
    code: 'network-identity-drift',
    family: 'risk',
    retryable: true,
    cooldownNeeded: true,
    isolationNeeded: false,
    manualRecoveryNeeded: true,
    degradable: false,
    artifactWriteAllowed: true,
    catalogAction: 'none',
  });
  assert.deepEqual(reasonCodeSummary('browser-fingerprint-risk'), {
    code: 'browser-fingerprint-risk',
    family: 'risk',
    retryable: true,
    cooldownNeeded: true,
    isolationNeeded: true,
    manualRecoveryNeeded: true,
    degradable: false,
    artifactWriteAllowed: true,
    catalogAction: 'none',
  });
  assert.deepEqual(reasonCodeSummary('profile-health-risk'), {
    code: 'profile-health-risk',
    family: 'risk',
    retryable: true,
    cooldownNeeded: false,
    isolationNeeded: true,
    manualRecoveryNeeded: true,
    degradable: false,
    artifactWriteAllowed: true,
    catalogAction: 'none',
  });
});

test('api verification reasonCodes expose catalog recovery semantics', () => {
  assert.deepEqual(reasonCodeSummary('api-candidate-generation-failed'), {
    code: 'api-candidate-generation-failed',
    family: 'api',
    retryable: true,
    cooldownNeeded: false,
    isolationNeeded: false,
    manualRecoveryNeeded: false,
    degradable: false,
    artifactWriteAllowed: true,
    catalogAction: 'none',
  });

  assert.deepEqual(reasonCodeSummary('site-adapter-core-api-unidentified'), {
    code: 'site-adapter-core-api-unidentified',
    family: 'api',
    retryable: false,
    cooldownNeeded: false,
    isolationNeeded: false,
    manualRecoveryNeeded: true,
    degradable: false,
    artifactWriteAllowed: false,
    catalogAction: 'none',
  });

  for (const code of [
    'api-verification-failed',
    'api-auth-verification-failed',
    'api-csrf-validation-failed',
    'api-request-signature-invalid',
    'api-pagination-verification-failed',
    'api-risk-verification-failed',
  ]) {
    assert.deepEqual(reasonCodeSummary(code), {
      code,
      family: 'api',
      retryable: true,
      cooldownNeeded: false,
      isolationNeeded: false,
      manualRecoveryNeeded: false,
      degradable: false,
      artifactWriteAllowed: true,
      catalogAction: 'deprecate',
    });
  }

  assert.deepEqual(reasonCodeSummary('api-permission-denied'), {
    code: 'api-permission-denied',
    family: 'api',
    retryable: false,
    cooldownNeeded: false,
    isolationNeeded: false,
    manualRecoveryNeeded: true,
    degradable: false,
    artifactWriteAllowed: true,
    catalogAction: 'block',
  });

  assert.deepEqual(reasonCodeSummary('api-catalog-entry-blocked'), {
    code: 'api-catalog-entry-blocked',
    family: 'api',
    retryable: false,
    cooldownNeeded: false,
    isolationNeeded: false,
    manualRecoveryNeeded: false,
    degradable: false,
    artifactWriteAllowed: true,
    catalogAction: 'block',
  });

  assert.deepEqual(reasonCodeSummary('api-catalog-write-failed'), {
    code: 'api-catalog-write-failed',
    family: 'api',
    retryable: true,
    cooldownNeeded: false,
    isolationNeeded: false,
    manualRecoveryNeeded: true,
    degradable: true,
    artifactWriteAllowed: false,
    catalogAction: 'none',
  });
  assert.equal(
    requireReasonCodeDefinition('api-catalog-write-failed', { family: 'api' }).artifactWriteAllowed,
    false,
  );
});

test('schema incompatibility reasonCode fails closed and requires manual recovery', () => {
  assert.deepEqual(reasonCodeSummary('schema-version-incompatible'), {
    code: 'schema-version-incompatible',
    family: 'schema',
    retryable: false,
    cooldownNeeded: false,
    isolationNeeded: false,
    manualRecoveryNeeded: true,
    degradable: false,
    artifactWriteAllowed: false,
    catalogAction: 'none',
  });
  assert.equal(
    requireReasonCodeDefinition('schema-version-incompatible', { family: 'schema' }).artifactWriteAllowed,
    false,
  );
});

test('redaction failure reasonCode fails closed and requires manual recovery', () => {
  assert.deepEqual(reasonCodeSummary('redaction-failed'), {
    code: 'redaction-failed',
    family: 'artifact',
    retryable: false,
    cooldownNeeded: false,
    isolationNeeded: false,
    manualRecoveryNeeded: true,
    degradable: false,
    artifactWriteAllowed: false,
    catalogAction: 'none',
  });
  assert.equal(
    requireReasonCodeDefinition('redaction-failed', { family: 'artifact' }).artifactWriteAllowed,
    false,
  );
});

test('lifecycle artifact write failure reasonCode is retryable but fails closed for further artifact writes', () => {
  assert.deepEqual(reasonCodeSummary('lifecycle-artifact-write-failed'), {
    code: 'lifecycle-artifact-write-failed',
    family: 'artifact',
    retryable: true,
    cooldownNeeded: false,
    isolationNeeded: false,
    manualRecoveryNeeded: false,
    degradable: true,
    artifactWriteAllowed: false,
    catalogAction: 'none',
  });
  assert.equal(
    requireReasonCodeDefinition('lifecycle-artifact-write-failed', { family: 'artifact' }).artifactWriteAllowed,
    false,
  );
});

test('reasonCode catalog validation rejects duplicates and malformed entries', () => {
  const valid = listReasonCodeDefinitions();
  assert.throws(
    () => assertReasonCodeCatalogValid([
      ...valid,
      { ...valid[0] },
    ]),
    /duplicate code/u,
  );

  assert.throws(
    () => assertReasonCodeCatalogValid([
      {
        ...valid[0],
        code: 'synthetic-malformed-code',
        family: 'not-a-family',
      },
    ]),
    /invalid family/u,
  );

  assert.throws(
    () => requireReasonCodeDefinition('dry-run', { family: 'session' }),
    /belongs to download/u,
  );
});
