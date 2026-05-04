// @ts-check

import { normalizeText } from '../../shared/normalize.mjs';

export const REASON_CODE_SCHEMA_VERSION = 1;
export const REASON_CODE_COMPATIBLE_SCHEMA_VERSIONS = Object.freeze([
  REASON_CODE_SCHEMA_VERSION,
]);
export const REASON_CODE_SCHEMA_COMPATIBILITY = Object.freeze({
  name: 'reasonCode',
  currentVersion: REASON_CODE_SCHEMA_VERSION,
  compatibleVersions: REASON_CODE_COMPATIBLE_SCHEMA_VERSIONS,
});

export const REASON_CODE_FAMILIES = Object.freeze([
  'capture',
  'session',
  'risk',
  'download',
  'artifact',
  'schema',
  'api',
]);

export const CATALOG_ACTIONS = Object.freeze([
  'none',
  'deprecate',
  'block',
]);

function defineReasonCode(definition) {
  return Object.freeze({
    schemaVersion: REASON_CODE_SCHEMA_VERSION,
    catalogAction: 'none',
    artifactWriteAllowed: true,
    retryable: false,
    cooldownNeeded: false,
    isolationNeeded: false,
    manualRecoveryNeeded: false,
    degradable: false,
    ...definition,
  });
}

export const REASON_CODE_CATALOG = Object.freeze([
  defineReasonCode({
    code: 'INVALID_INPUT',
    family: 'capture',
    source: 'src/pipeline/stages/capture.mjs',
    retryable: false,
    artifactWriteAllowed: true,
    description: 'The requested capture URL or input was invalid before browser execution.',
  }),
  defineReasonCode({
    code: 'HTML_CAPTURE_FAILED',
    family: 'capture',
    source: 'src/pipeline/stages/capture.mjs',
    retryable: true,
    degradable: true,
    artifactWriteAllowed: true,
    description: 'The page HTML capture step failed.',
  }),
  defineReasonCode({
    code: 'SNAPSHOT_CAPTURE_FAILED',
    family: 'capture',
    source: 'src/pipeline/stages/capture.mjs',
    retryable: true,
    degradable: true,
    artifactWriteAllowed: true,
    description: 'The DOM snapshot capture step failed.',
  }),
  defineReasonCode({
    code: 'SCREENSHOT_FALLBACK',
    family: 'capture',
    source: 'src/pipeline/stages/capture.mjs',
    retryable: false,
    degradable: true,
    artifactWriteAllowed: true,
    description: 'Full-page screenshot failed, but viewport screenshot fallback was used.',
  }),
  defineReasonCode({
    code: 'SCREENSHOT_CAPTURE_FAILED',
    family: 'capture',
    source: 'src/pipeline/stages/capture.mjs',
    retryable: true,
    degradable: true,
    artifactWriteAllowed: true,
    description: 'All screenshot capture attempts failed.',
  }),
  defineReasonCode({
    code: 'PAGE_METADATA_FAILED',
    family: 'capture',
    source: 'src/pipeline/stages/capture.mjs',
    retryable: false,
    degradable: true,
    artifactWriteAllowed: true,
    description: 'Page metadata extraction failed after capture artifacts were attempted.',
  }),
  defineReasonCode({
    code: 'CAPTURE_FAILED',
    family: 'capture',
    source: 'src/pipeline/stages/capture.mjs',
    retryable: true,
    artifactWriteAllowed: true,
    description: 'The capture stage failed without a more specific error code.',
  }),
  defineReasonCode({
    code: 'ANTI_CRAWL_CHALLENGE',
    family: 'capture',
    source: 'src/pipeline/stages/capture.mjs',
    retryable: false,
    cooldownNeeded: true,
    isolationNeeded: true,
    manualRecoveryNeeded: true,
    degradable: true,
    artifactWriteAllowed: true,
    description: 'Capture detected a platform challenge or verification page and stopped automated traversal.',
  }),
  defineReasonCode({
    code: 'session-invalid',
    family: 'session',
    source: 'src/infra/auth/site-session-governance.mjs',
    retryable: true,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'The reusable authenticated session is missing, expired, or not identity-confirmed.',
  }),
  defineReasonCode({
    code: 'login-required',
    family: 'session',
    source: 'src/sites/downloads/session-manager.mjs',
    retryable: true,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'The current task requires login before it can continue.',
  }),
  defineReasonCode({
    code: 'reusable-profile-unavailable',
    family: 'session',
    source: 'src/sites/downloads/session-manager.mjs',
    retryable: true,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A reusable local browser profile was expected but unavailable.',
  }),
  defineReasonCode({
    code: 'missing-user-data-dir',
    family: 'session',
    source: 'src/infra/auth/site-auth.mjs',
    retryable: true,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'The browser user data directory required for session reuse was not available.',
  }),
  defineReasonCode({
    code: 'profile-missing',
    family: 'session',
    source: 'src/infra/browser/profile-store.mjs',
    retryable: true,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'The persistent browser profile directory has not been created yet and needs visible login initialization.',
  }),
  defineReasonCode({
    code: 'profile-uninitialized',
    family: 'session',
    source: 'src/infra/browser/profile-store.mjs',
    retryable: true,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'The persistent browser profile exists but has not finished first-run login initialization.',
  }),
  defineReasonCode({
    code: 'reuse-login-state-disabled',
    family: 'session',
    source: 'src/infra/auth/site-auth.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'Session reuse was disabled by request or policy.',
  }),
  defineReasonCode({
    code: 'session-required',
    family: 'session',
    source: 'src/sites/downloads/session-manager.mjs',
    retryable: true,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'The operation cannot continue without a ready session lease.',
  }),
  defineReasonCode({
    code: 'session-health-manifest-missing',
    family: 'session',
    source: 'src/sites/downloads/session-report.mjs',
    retryable: true,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A required unified session health manifest was not supplied or could not be found.',
  }),
  defineReasonCode({
    code: 'approval-required',
    family: 'session',
    source: 'src/entrypoints/sites/session-repair-plan.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'The suggested recovery action requires explicit approval before execution.',
  }),
  defineReasonCode({
    code: 'session-revocation-handle-missing',
    family: 'session',
    source: 'src/sites/capability/session-view.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A materialized SessionView audit has no durable revocation handle and must not be treated as fully governed session materialization.',
  }),
  defineReasonCode({
    code: 'session-revocation-invalid',
    family: 'session',
    source: 'src/sites/sessions/runner.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: false,
    description: 'Session materialization failed because the revocation handle was unknown, expired, or revoked, so artifact writes must fail closed.',
  }),
  defineReasonCode({
    code: 'concurrent-profile-use',
    family: 'risk',
    source: 'src/infra/auth/site-session-governance.mjs',
    retryable: true,
    cooldownNeeded: true,
    isolationNeeded: true,
    artifactWriteAllowed: true,
    description: 'Another process is using the same browser profile and the task must wait or stop.',
  }),
  defineReasonCode({
    code: 'profile-health-risk',
    family: 'risk',
    source: 'src/infra/auth/site-session-governance.mjs',
    retryable: true,
    isolationNeeded: true,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'The persistent browser profile health is unsafe for automated reuse.',
  }),
  defineReasonCode({
    code: 'network-identity-drift',
    family: 'risk',
    source: 'src/infra/auth/site-session-governance.mjs',
    retryable: true,
    cooldownNeeded: true,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'The current network identity differs from the previously healthy session context.',
  }),
  defineReasonCode({
    code: 'request-burst',
    family: 'risk',
    source: 'src/infra/auth/site-session-governance.mjs',
    retryable: true,
    cooldownNeeded: true,
    artifactWriteAllowed: true,
    description: 'The site indicated rate limiting or excessive request pressure.',
  }),
  defineReasonCode({
    code: 'browser-fingerprint-risk',
    family: 'risk',
    source: 'src/infra/auth/site-session-governance.mjs',
    retryable: true,
    cooldownNeeded: true,
    isolationNeeded: true,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'The browser/profile/network tuple should be treated as challenged or risky.',
  }),
  defineReasonCode({
    code: 'unknown-risk',
    family: 'risk',
    source: 'src/infra/auth/site-session-governance.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A risk gate blocked execution without a more specific mapped cause.',
  }),
  defineReasonCode({
    code: 'anti-crawl-verify',
    family: 'risk',
    source: 'src/shared/xiaohongshu-risk.mjs',
    retryable: false,
    cooldownNeeded: true,
    isolationNeeded: true,
    manualRecoveryNeeded: true,
    degradable: true,
    artifactWriteAllowed: true,
    description: 'A verification or challenge page was detected.',
  }),
  defineReasonCode({
    code: 'blocked-by-cloudflare-challenge',
    family: 'risk',
    source: 'src/sites/downloads/legacy-executor.mjs',
    retryable: false,
    cooldownNeeded: true,
    isolationNeeded: true,
    manualRecoveryNeeded: true,
    degradable: true,
    artifactWriteAllowed: true,
    description: 'A public download request encountered a Cloudflare challenge and stopped without bypassing it.',
  }),
  defineReasonCode({
    code: 'self-profile-captcha',
    family: 'risk',
    source: 'src/sites/xiaohongshu/queries/follow-query.mjs',
    retryable: false,
    cooldownNeeded: true,
    isolationNeeded: true,
    manualRecoveryNeeded: true,
    degradable: true,
    artifactWriteAllowed: true,
    description: 'The Xiaohongshu self-profile follow probe was redirected to a captcha gate.',
  }),
  defineReasonCode({
    code: 'dry-run',
    family: 'download',
    source: 'src/sites/downloads/executor.mjs',
    retryable: false,
    degradable: true,
    artifactWriteAllowed: true,
    description: 'The download runner intentionally wrote planned artifacts without fetching resources.',
  }),
  defineReasonCode({
    code: 'no-resolved-resources',
    family: 'download',
    source: 'src/sites/downloads/runner.mjs',
    retryable: true,
    degradable: true,
    artifactWriteAllowed: true,
    description: 'The download resolver did not produce any concrete downloadable resources.',
  }),
  defineReasonCode({
    code: 'bilibili-api-evidence-unavailable',
    family: 'download',
    source: 'src/sites/downloads/site-modules/bilibili.mjs',
    retryable: true,
    degradable: true,
    artifactWriteAllowed: true,
    description: 'The Bilibili native resolver could not produce the required list, view, or playurl evidence.',
  }),
  defineReasonCode({
    code: 'download-policy-generation-failed',
    family: 'download',
    source: 'src/sites/capability/planner-policy-handoff.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    degradable: true,
    artifactWriteAllowed: false,
    description: 'DownloadPolicy generation failed before a valid planner/downloader handoff artifact could be written.',
  }),
  defineReasonCode({
    code: 'existing-file',
    family: 'download',
    source: 'src/sites/downloads/executor.mjs',
    retryable: false,
    degradable: true,
    artifactWriteAllowed: true,
    description: 'A target file already exists and was skipped by policy.',
  }),
  defineReasonCode({
    code: 'verification-failed',
    family: 'download',
    source: 'src/sites/downloads/executor.mjs',
    retryable: true,
    artifactWriteAllowed: true,
    description: 'Downloaded output failed integrity or verification checks.',
  }),
  defineReasonCode({
    code: 'fetch-error',
    family: 'download',
    source: 'src/sites/downloads/executor.mjs',
    retryable: true,
    artifactWriteAllowed: true,
    description: 'A resource fetch failed during downloader execution.',
  }),
  defineReasonCode({
    code: 'download-failed',
    family: 'download',
    source: 'src/sites/downloads/executor.mjs',
    retryable: true,
    artifactWriteAllowed: true,
    description: 'A download resource failed without a more specific reason.',
  }),
  defineReasonCode({
    code: 'download-failures',
    family: 'download',
    source: 'src/sites/downloads/executor.mjs',
    retryable: true,
    artifactWriteAllowed: true,
    description: 'One or more resources failed during a download run.',
  }),
  defineReasonCode({
    code: 'http-500',
    family: 'download',
    source: 'src/sites/downloads/executor.mjs',
    retryable: true,
    artifactWriteAllowed: true,
    description: 'A generic downloader resource request failed with HTTP 500.',
  }),
  defineReasonCode({
    code: 'retry-state-missing',
    family: 'download',
    source: 'src/sites/downloads/executor.mjs',
    retryable: false,
    artifactWriteAllowed: true,
    description: 'Retry mode could not find previous run state to recover from.',
  }),
  defineReasonCode({
    code: 'retry-failed-none',
    family: 'download',
    source: 'src/sites/downloads/executor.mjs',
    retryable: false,
    degradable: true,
    artifactWriteAllowed: true,
    description: 'Retry-failed mode found no failed resources in the previous queue.',
  }),
  defineReasonCode({
    code: 'retry-queue-missing',
    family: 'download',
    source: 'src/sites/downloads/executor.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'Retry-failed mode found previous state but no usable queue artifact.',
  }),
  defineReasonCode({
    code: 'queue-invalid-json',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A retry/recovery queue artifact exists but cannot be parsed as JSON.',
  }),
  defineReasonCode({
    code: 'media-queue-invalid-json',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A retry/recovery media queue artifact exists but cannot be parsed as JSON.',
  }),
  defineReasonCode({
    code: 'queue-invalid-shape',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A retry/recovery queue artifact exists but is not an array or object with a queue array.',
  }),
  defineReasonCode({
    code: 'media-queue-invalid-shape',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A retry/recovery media queue artifact exists but is not an array or object with a queue array.',
  }),
  defineReasonCode({
    code: 'source-queue-invalid-shape',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A source retry/recovery queue artifact exists but is not an array or object with a queue array.',
  }),
  defineReasonCode({
    code: 'source-queue-invalid-json',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A source retry/recovery queue artifact exists but cannot be parsed as JSON.',
  }),
  defineReasonCode({
    code: 'source-queue-missing',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A source retry/recovery queue artifact reference exists but the target artifact is missing.',
  }),
  defineReasonCode({
    code: 'source-manifest-missing',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A source retry/recovery manifest artifact reference exists but the target artifact is missing.',
  }),
  defineReasonCode({
    code: 'source-manifest-invalid-json',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A source retry/recovery manifest artifact exists but cannot be parsed as JSON.',
  }),
  defineReasonCode({
    code: 'source-media-queue-invalid-shape',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A source retry/recovery media queue artifact exists but is not an array or object with a queue array.',
  }),
  defineReasonCode({
    code: 'source-media-queue-invalid-json',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A source retry/recovery media queue artifact exists but cannot be parsed as JSON.',
  }),
  defineReasonCode({
    code: 'source-media-queue-missing',
    family: 'download',
    source: 'src/sites/downloads/legacy-executor.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'Legacy recovery could not find the source media queue required to retry safely.',
  }),
  defineReasonCode({
    code: 'source-media-manifest-missing',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A source media manifest artifact reference exists but the target artifact is missing.',
  }),
  defineReasonCode({
    code: 'source-media-manifest-invalid-json',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A source media manifest artifact exists but cannot be parsed as JSON.',
  }),
  defineReasonCode({
    code: 'manifest-invalid-json',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A retry/recovery manifest artifact exists but cannot be parsed as JSON.',
  }),
  defineReasonCode({
    code: 'media-manifest-invalid-json',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A retry/recovery media manifest artifact exists but cannot be parsed as JSON.',
  }),
  defineReasonCode({
    code: 'downloads-invalid-jsonl',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A retry/recovery downloads JSONL artifact exists but contains an invalid JSON line.',
  }),
  defineReasonCode({
    code: 'source-downloads-invalid-jsonl',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A source downloads JSONL artifact exists but contains an invalid JSON line.',
  }),
  defineReasonCode({
    code: 'downloads-read-failed',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A retry/recovery downloads JSONL artifact exists but cannot be read.',
  }),
  defineReasonCode({
    code: 'source-downloads-read-failed',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A source downloads JSONL artifact exists but cannot be read.',
  }),
  defineReasonCode({
    code: 'legacy-retry-failed-unsupported',
    family: 'download',
    source: 'src/sites/downloads/legacy-executor.mjs',
    retryable: false,
    degradable: true,
    artifactWriteAllowed: true,
    description: 'Legacy retry-failed mode is unavailable because the legacy command lacks a supported retry flag.',
  }),
  defineReasonCode({
    code: 'resume-state-missing',
    family: 'download',
    source: 'src/sites/downloads/legacy-executor.mjs',
    retryable: false,
    artifactWriteAllowed: true,
    description: 'Legacy resume mode could not find previous run state to recover from.',
  }),
  defineReasonCode({
    code: 'legacy-resume-unsupported',
    family: 'download',
    source: 'src/sites/downloads/legacy-executor.mjs',
    retryable: false,
    degradable: true,
    artifactWriteAllowed: true,
    description: 'Legacy resume mode is unavailable because the legacy command lacks a supported resume flag.',
  }),
  defineReasonCode({
    code: 'manifest-queue-count-mismatch',
    family: 'download',
    source: 'src/sites/downloads/executor.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'The manifest and queue counts disagree for a resumable download run.',
  }),
  defineReasonCode({
    code: 'manifest-queue-resource-mismatch',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'The manifest references a recovered file that is not present in the retry queue.',
  }),
  defineReasonCode({
    code: 'queue-downloads-resource-mismatch',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'The downloads JSONL history references a resource that is not present in the retry queue.',
  }),
  defineReasonCode({
    code: 'recovery-artifact-missing',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A previous successful download cannot be reused because its recorded artifact is missing.',
  }),
  defineReasonCode({
    code: 'recovery-artifact-not-file',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A previous successful download cannot be reused because its recorded artifact path is not a file.',
  }),
  defineReasonCode({
    code: 'recovery-artifact-size-mismatch',
    family: 'download',
    source: 'src/sites/downloads/recovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: true,
    description: 'A previous successful download cannot be reused because its recorded artifact size differs from the file on disk.',
  }),
  defineReasonCode({
    code: 'retry-failed-not-failed',
    family: 'download',
    source: 'src/sites/downloads/executor.mjs',
    retryable: false,
    degradable: true,
    artifactWriteAllowed: true,
    description: 'Retry-failed mode skipped a resource because its previous queue status was not failed.',
  }),
  defineReasonCode({
    code: 'mux-failed',
    family: 'download',
    source: 'src/sites/downloads/executor.mjs',
    retryable: true,
    artifactWriteAllowed: true,
    description: 'Derived audio/video muxing failed.',
  }),
  defineReasonCode({
    code: 'mux-error',
    family: 'download',
    source: 'src/sites/downloads/executor.mjs',
    retryable: true,
    artifactWriteAllowed: true,
    description: 'A muxing subprocess or helper returned an error.',
  }),
  defineReasonCode({
    code: 'schema-version-incompatible',
    family: 'schema',
    source: 'CONTRIBUTING.md',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: false,
    description: 'Execution must stop because a schema or compatibility version is unsupported.',
  }),
  defineReasonCode({
    code: 'redaction-failed',
    family: 'artifact',
    source: 'CONTRIBUTING.md',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: false,
    description: 'Persistent writing must fail closed because redaction did not complete safely.',
  }),
  defineReasonCode({
    code: 'lifecycle-artifact-write-failed',
    family: 'artifact',
    source: 'src/sites/capability/lifecycle-events.mjs',
    retryable: true,
    degradable: true,
    artifactWriteAllowed: false,
    description: 'A lifecycle event or redaction-audit artifact could not be written after compatibility and redaction checks.',
  }),
  defineReasonCode({
    code: 'api-candidate-generation-failed',
    family: 'api',
    source: 'CONTRIBUTING.md',
    retryable: true,
    artifactWriteAllowed: true,
    description: 'API candidate generation failed before candidate persistence.',
  }),
  defineReasonCode({
    code: 'site-adapter-core-api-unidentified',
    family: 'api',
    source: 'src/sites/capability/api-discovery.mjs',
    retryable: false,
    manualRecoveryNeeded: true,
    artifactWriteAllowed: false,
    description: 'A SiteAdapter did not expose a core API validation path for an observed API candidate.',
  }),
  defineReasonCode({
    code: 'api-verification-failed',
    family: 'api',
    source: 'CONTRIBUTING.md',
    retryable: true,
    catalogAction: 'deprecate',
    artifactWriteAllowed: true,
    description: 'An API candidate or catalog entry failed verification.',
  }),
  defineReasonCode({
    code: 'api-catalog-endpoint-expired',
    family: 'api',
    source: 'CONTRIBUTING.md',
    retryable: true,
    catalogAction: 'deprecate',
    artifactWriteAllowed: true,
    description: 'A previously verified API catalog endpoint is stale or expired and should be revalidated before reuse.',
  }),
  defineReasonCode({
    code: 'api-auth-verification-failed',
    family: 'api',
    source: 'CONTRIBUTING.md',
    retryable: true,
    catalogAction: 'deprecate',
    artifactWriteAllowed: true,
    description: 'An API candidate failed authentication or CSRF verification without exposing raw credentials.',
  }),
  defineReasonCode({
    code: 'api-csrf-validation-failed',
    family: 'api',
    source: 'CONTRIBUTING.md',
    retryable: true,
    catalogAction: 'deprecate',
    artifactWriteAllowed: true,
    description: 'A SiteAdapter rejected API use because CSRF validation failed without exposing the raw token.',
  }),
  defineReasonCode({
    code: 'api-request-signature-invalid',
    family: 'api',
    source: 'CONTRIBUTING.md',
    retryable: true,
    catalogAction: 'deprecate',
    artifactWriteAllowed: true,
    description: 'A SiteAdapter rejected API use because the request signature was missing, stale, or invalid.',
  }),
  defineReasonCode({
    code: 'api-permission-denied',
    family: 'api',
    source: 'CONTRIBUTING.md',
    retryable: false,
    manualRecoveryNeeded: true,
    catalogAction: 'block',
    artifactWriteAllowed: true,
    description: 'A SiteAdapter or verified endpoint reported insufficient permission for the requested API task.',
  }),
  defineReasonCode({
    code: 'api-pagination-verification-failed',
    family: 'api',
    source: 'CONTRIBUTING.md',
    retryable: true,
    catalogAction: 'deprecate',
    artifactWriteAllowed: true,
    description: 'An API candidate failed pagination model verification.',
  }),
  defineReasonCode({
    code: 'api-risk-verification-failed',
    family: 'api',
    source: 'CONTRIBUTING.md',
    retryable: true,
    catalogAction: 'deprecate',
    artifactWriteAllowed: true,
    description: 'An API candidate failed risk-state verification.',
  }),
  defineReasonCode({
    code: 'api-catalog-entry-blocked',
    family: 'api',
    source: 'CONTRIBUTING.md',
    retryable: false,
    catalogAction: 'block',
    artifactWriteAllowed: true,
    description: 'An API catalog entry is blocked by policy, safety, permission, or risk constraints.',
  }),
  defineReasonCode({
    code: 'api-catalog-write-failed',
    family: 'api',
    source: 'CONTRIBUTING.md',
    retryable: true,
    manualRecoveryNeeded: true,
    degradable: true,
    artifactWriteAllowed: false,
    description: 'An API catalog update could not be persisted after verification and must fail closed for further artifact writes.',
  }),
]);

const CATALOG_BY_CODE = new Map(REASON_CODE_CATALOG.map((definition) => [definition.code, definition]));

export function listReasonCodeDefinitions() {
  return REASON_CODE_CATALOG.map((definition) => ({ ...definition }));
}

export function findReasonCodeDefinition(code) {
  return CATALOG_BY_CODE.get(normalizeText(code)) ?? null;
}

export function isKnownReasonCode(code) {
  return findReasonCodeDefinition(code) !== null;
}

export function normalizeReasonCode(code) {
  const normalized = normalizeText(code);
  if (!normalized) {
    return undefined;
  }
  return findReasonCodeDefinition(normalized)?.code ?? normalized;
}

export function requireReasonCodeDefinition(code, { family } = {}) {
  const definition = findReasonCodeDefinition(code);
  if (!definition) {
    throw new Error(`Unknown reasonCode: ${code}`);
  }
  if (family && definition.family !== family) {
    throw new Error(`reasonCode ${code} belongs to ${definition.family}, not ${family}`);
  }
  return { ...definition };
}

export function reasonCodeSummary(code) {
  const definition = requireReasonCodeDefinition(code);
  return {
    code: definition.code,
    family: definition.family,
    retryable: definition.retryable,
    cooldownNeeded: definition.cooldownNeeded,
    isolationNeeded: definition.isolationNeeded,
    manualRecoveryNeeded: definition.manualRecoveryNeeded,
    degradable: definition.degradable,
    artifactWriteAllowed: definition.artifactWriteAllowed,
    catalogAction: definition.catalogAction,
  };
}

export function isReasonCodeSchemaVersionCompatible(value) {
  const version = Number(value);
  return Number.isInteger(version)
    && REASON_CODE_COMPATIBLE_SCHEMA_VERSIONS.includes(version);
}

function reasonCodeCatalogEntriesFromPayload(payload = REASON_CODE_CATALOG) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === 'object' && Array.isArray(payload.entries)) {
    return payload.entries;
  }
  throw new Error('reasonCode catalog entries are required');
}

export function assertReasonCodeCatalogCompatible(payload = REASON_CODE_CATALOG) {
  if (!Array.isArray(payload)) {
    if (payload?.schemaVersion === undefined || payload?.schemaVersion === null) {
      throw new Error('reasonCode catalog schemaVersion is required');
    }
    if (!isReasonCodeSchemaVersionCompatible(payload.schemaVersion)) {
      throw new Error(
        `reasonCode catalog schemaVersion ${payload.schemaVersion} is not compatible with ${REASON_CODE_SCHEMA_VERSION}`,
      );
    }
  }
  assertReasonCodeCatalogValid(reasonCodeCatalogEntriesFromPayload(payload));
  return true;
}

export function assertReasonCodeCatalogValid(catalog = REASON_CODE_CATALOG) {
  const seen = new Set();
  const errors = [];
  for (const [index, definition] of catalog.entries()) {
    const prefix = `reasonCode[${index}]`;
    const code = normalizeText(definition?.code);
    if (!code) {
      errors.push(`${prefix} missing code`);
      continue;
    }
    if (seen.has(code)) {
      errors.push(`${prefix} duplicate code: ${code}`);
    }
    seen.add(code);
    if (definition.schemaVersion !== REASON_CODE_SCHEMA_VERSION) {
      errors.push(`${prefix} ${code} has unsupported schemaVersion`);
    }
    if (!REASON_CODE_FAMILIES.includes(definition.family)) {
      errors.push(`${prefix} ${code} has invalid family`);
    }
    if (!normalizeText(definition.source)) {
      errors.push(`${prefix} ${code} missing source`);
    }
    if (!normalizeText(definition.description)) {
      errors.push(`${prefix} ${code} missing description`);
    }
    if (!CATALOG_ACTIONS.includes(definition.catalogAction)) {
      errors.push(`${prefix} ${code} has invalid catalogAction`);
    }
    for (const key of [
      'retryable',
      'cooldownNeeded',
      'isolationNeeded',
      'manualRecoveryNeeded',
      'degradable',
      'artifactWriteAllowed',
    ]) {
      if (typeof definition[key] !== 'boolean') {
        errors.push(`${prefix} ${code} has non-boolean ${key}`);
      }
    }
  }
  if (errors.length) {
    throw new Error(`Invalid reasonCode catalog:\n${errors.join('\n')}`);
  }
  return true;
}
