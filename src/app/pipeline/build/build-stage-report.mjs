// @ts-check

import { uniqueSortedStrings } from '../../../shared/normalize.mjs';
import {
  classifySiteForgeWarning,
  normalizeSiteForgeReason,
  selectSiteForgePrimaryReason,
} from './output-validation.mjs';

const SAFE_BUILD_WARNING_PATTERNS = Object.freeze([
  /^generic crawler skipped; using bounded user-authorized browser evidence summary\.$/u,
  /^using sanitized user-authorized browser evidence; unredacted page structure and session material were not persisted\.$/u,
  /^Browser-rendered crawl is not part of the public build path; this run used static and sanitized setup evidence only\.$/u,
  /^Network summary was not requested; raw network tracing is not part of the public build path\.$/u,
  /^Network summary requested; raw network traces were not captured or persisted\.$/u,
  /^robots excluded all planned seed URLs before crawl\.$/u,
  /^seed discovery truncated at maxSeeds=\d+; \d+ seeds were left out\.$/u,
  /^sitemap discovery truncated at maxSitemaps=\d+; \d+ sitemap URLs were left out\.$/u,
  /^crawl truncated at maxPages=\d+; \d+ queued URLs were not fetched\.$/u,
  /^browser-auth-route-coverage-partial$/u,
  /^Report-only partial success: generated capabilities and intents are available, but promotion is blocked by external access policy\.$/u,
  /^Skipped because [a-zA-Z0-9]+ (?:skipped|failed|blocked)\.$/u,
]);

export function safeBuildWarningForReport(message, fallbackReasonCode = 'validation-failed') {
  const text = String(message ?? '').trim();
  if (!text) {
    return null;
  }
  if (SAFE_BUILD_WARNING_PATTERNS.some((pattern) => pattern.test(text))) {
    return text;
  }
  const reason = classifySiteForgeWarning(text) ?? normalizeSiteForgeReason(fallbackReasonCode);
  return reason?.reasonCode ?? 'stage-message-redacted';
}

export function safeBuildMessagesForReport(messages, fallbackReasonCode = 'validation-failed') {
  return uniqueSortedStrings((messages ?? [])
    .map((message) => safeBuildWarningForReport(message, fallbackReasonCode))
    .filter(Boolean));
}

export function buildReportWarningSummary(
  stageRecords = /** @type {Record<string, any>} */ ({}),
  contextWarnings = /** @type {any[]} */ ([]),
) {
  const warningCodes = uniqueSortedStrings(Object.values(stageRecords)
    .flatMap((stage) => [
      ...(stage.reasonCodes ?? []),
      ...(stage.warnings ?? []).map((warning) => classifySiteForgeWarning(warning)?.reasonCode),
    ]));
  const reportWarnings = uniqueSortedStrings([
    ...contextWarnings,
    ...Object.values(stageRecords).flatMap((stage) => stage.warnings ?? []),
  ].map((warning) => safeBuildWarningForReport(warning)).filter(Boolean));
  return {
    warningCodes,
    reportWarnings,
  };
}

export function buildStageRecord(
  name,
  status,
  result = /** @type {any} */ ({}),
  startedAt,
  completedAt,
  stageDependencies = /** @type {Record<string, readonly any[]>} */ ({}),
) {
  const warningReasons = (result.warnings ?? [])
    .map((warning) => classifySiteForgeWarning(warning))
    .filter(Boolean);
  const explicitReason = result.reasonCode ? normalizeSiteForgeReason(result.reasonCode) : null;
  const primaryReason = explicitReason
    ?? (status === 'failed' ? selectSiteForgePrimaryReason([
      ...(result.errors ?? []).map((message) => ({ message })),
      ...(result.warnings ?? []).map((message) => ({ message })),
    ]) : null);
  const reasonCodes = uniqueSortedStrings([
    ...(result.reasonCodes ?? []),
    explicitReason?.reasonCode,
    primaryReason?.reasonCode,
    ...warningReasons.map((reason) => reason.reasonCode),
  ]);
  return {
    name,
    deps: stageDependencies[name] ?? [],
    status,
    startedAt,
    completedAt,
    failureClass: primaryReason?.failureClass ?? null,
    reasonCode: primaryReason?.reasonCode ?? null,
    reasonCodes,
    warnings: safeBuildMessagesForReport(result.warnings, primaryReason?.reasonCode ?? explicitReason?.reasonCode ?? 'validation-failed'),
    errors: safeBuildMessagesForReport(result.errors, primaryReason?.reasonCode ?? explicitReason?.reasonCode ?? 'validation-failed'),
    artifactPaths: result.artifactPaths ?? {},
    summary: result.summary ?? {},
  };
}

export function classifyBuildFailure(error, stageRecords) {
  const explicitErrorReason = error?.reasonCode ? normalizeSiteForgeReason(error.reasonCode) : null;
  if (explicitErrorReason) {
    return explicitErrorReason;
  }
  const reasonEntries = [
    ...(error?.verificationReport?.reasonCode ? [{ reasonCode: error.verificationReport.reasonCode }] : []),
    ...Object.values(stageRecords ?? {}).flatMap((stage) => (stage.reasonCodes ?? []).map((reasonCode) => ({ reasonCode }))),
  ];
  if (reasonEntries.length) {
    return selectSiteForgePrimaryReason(reasonEntries, error?.reasonCode ?? 'validation-failed');
  }
  if (error?.reasonCode) {
    return normalizeSiteForgeReason(error.reasonCode) ?? {
      failureClass: error.failureClass ?? 'internal',
      reasonCode: error.reasonCode,
      action: error.reasonAction ?? null,
    };
  }
  const verificationReason = error?.verificationReport?.reasonCode
    ? normalizeSiteForgeReason(error.verificationReport.reasonCode)
    : null;
  if (verificationReason) {
    return verificationReason;
  }
  const failedStage = Object.values(stageRecords ?? {}).find((stage) => stage.status === 'failed' && stage.reasonCode);
  if (failedStage?.reasonCode) {
    return normalizeSiteForgeReason(failedStage.reasonCode) ?? {
      failureClass: failedStage.failureClass ?? 'internal',
      reasonCode: failedStage.reasonCode,
      action: null,
    };
  }
  return selectSiteForgePrimaryReason(
    Object.values(stageRecords ?? {}).flatMap((stage) => [
      ...(stage.errors ?? []).map((message) => ({ message })),
      ...(stage.warnings ?? []).map((message) => ({ message })),
    ]),
    'validation-failed',
  );
}
