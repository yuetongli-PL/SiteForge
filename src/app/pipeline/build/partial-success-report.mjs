// @ts-check

import { uniqueSortedStrings } from '../../../shared/normalize.mjs';
import {
  classifySiteForgeWarning,
  normalizeSiteForgeReason,
} from './output-validation.mjs';
import { isHighRiskOrAccountDisabled } from './capability-state-report.mjs';

export function partialSuccessReasonFromWarning(warning) {
  const text = String(warning ?? '').trim();
  if (!text || /debug/iu.test(text)) {
    return null;
  }
  const reasonCode = (classifySiteForgeWarning(text) ?? normalizeSiteForgeReason(text))?.reasonCode ?? text;
  if (reasonCode === 'robots-unavailable') {
    return 'robots.txt could not be fetched, so the live build stopped safely.';
  }
  if (reasonCode === 'robots-disallowed') {
    return 'robots.txt blocked the candidate crawl scope.';
  }
  if (reasonCode === 'network-fetch-failed') {
    return 'Network fetch failed; raw error details were not saved.';
  }
  if (reasonCode === 'dynamic-unsupported') {
    return 'The route appears to require dynamic collection, which was not enabled for this build.';
  }
  if (reasonCode === 'validation-failed') {
    return 'Verification did not pass; see verification_report.json for gate details.';
  }
  if (reasonCode === 'report-only-verification-blocked' || /report-only|report_only_blocked/iu.test(text)) {
    return 'Generated capabilities and intents are available as a report-only partial result; promotion was blocked by external access policy.';
  }
  if (/maxSeeds=/u.test(text)) {
    return 'Seed discovery reached its configured limit; remaining entry points were not collected.';
  }
  if (/maxSitemaps=/u.test(text)) {
    return 'Sitemap discovery reached its configured limit; remaining sitemaps were not collected.';
  }
  if (/maxPages=/u.test(text)) {
    return 'Static crawl reached its configured page limit; remaining pages were not collected.';
  }
  if (reasonCode === 'browser-auth-route-coverage-partial' || /browser-auth-route-coverage-partial/iu.test(text)) {
    return 'Default-browser bridge captured only reachable configured routes; missing routes are reported as authenticated coverage gaps.';
  }
  if (/user-authorized browser evidence|sanitized user-authorized browser evidence/iu.test(text)) {
    return 'Only limited sanitized user-authorized browser evidence summaries were used.';
  }
  return null;
}

export function safePublicReasonCode(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,120}$/u.test(text) ? text : null;
}

function setupReviewHasActionableMissingEvidence(setupCollectionReview) {
  const records = Array.isArray(setupCollectionReview?.missingRecords)
    ? setupCollectionReview.missingRecords
    : null;
  if (records) {
    return records.some((record) => record?.recommended !== false);
  }
  return Number(setupCollectionReview?.missingRecordCount ?? 0) > 0
    || Number(setupCollectionReview?.summary?.capabilities?.missing ?? 0) > 0
    || Number(setupCollectionReview?.summary?.intents?.missing ?? 0) > 0;
}

export function buildPartialSuccessReasons({
  context,
  report,
  setupCollectionReview,
  capabilityState,
} = /** @type {any} */ ({})) {
  const groups = capabilityState?.groups ?? {};
  const evidenceSummary = capabilityState?.evidence_status_summary ?? {};
  const reasons = /** @type {any[]} */ ([]);
  const verificationPassed = report?.summary?.verificationStatus === 'passed'
    || report?.verificationStatus === 'passed'
    || report?.verificationReport?.status === 'passed';
  if (report?.summary?.verificationStatus === 'report_only_blocked'
    || report?.verificationStatus === 'report_only_blocked'
    || report?.verificationReport?.status === 'report_only_blocked') {
    reasons.push('Generated capabilities and intents are available as a report-only partial result; promotion was blocked by external access policy.');
  }
  if (report?.summary?.verificationStatus === 'bridge_runtime_passed'
    || report?.verificationStatus === 'bridge_runtime_passed'
    || report?.verificationReport?.status === 'bridge_runtime_passed') {
    reasons.push('Registered as a runtime-routed Skill: captured authenticated capabilities require fresh default-browser bridge evidence; eligible public read-only capabilities can use generic HTTP read.');
  }
  const reportReasonCode = safePublicReasonCode(report?.reasonCode);
  if (reportReasonCode && !(verificationPassed && reportReasonCode === 'validation-failed')) {
    const publicReason = partialSuccessReasonFromWarning(reportReasonCode);
    if (publicReason) {
      reasons.push(publicReason);
    }
  }
  if ((groups.confirmation_required ?? []).length > 0) {
    reasons.push(`${groups.confirmation_required.length} capabilities require user confirmation or draft-only handling.`);
  }
  const highRiskDisabled = (groups.disabled ?? []).filter(isHighRiskOrAccountDisabled).length;
  if (highRiskDisabled > 0) {
    reasons.push(`${highRiskDisabled} high-risk write, private, or account capabilities are disabled by default.`);
  }
  if (context?.options?.deep !== true) {
    reasons.push('Deep browser exploration was not enabled for this build.');
  }
  if (context?.policy?.captureNetwork !== true) {
    reasons.push('Sanitized network summary discovery was not enabled for this build.');
  }
  const privacyMode = String(context?.options?.privacyMode ?? context?.options?.privacy ?? '').toLowerCase();
  if (privacyMode === 'strict') {
    reasons.push('Strict privacy mode skips sensitive personal capabilities.');
  }
  if (Number(evidenceSummary.inferred ?? 0) > 0) {
    reasons.push(`${Number(evidenceSummary.inferred ?? 0)} capabilities still rely on inferred evidence.`);
  }
  if ((groups.limited_enabled ?? []).length > 0) {
    reasons.push(`${groups.limited_enabled.length} sensitive read-only capabilities are limited to sanitized structural summaries.`);
  }
  const missingSetupEvidence = setupReviewHasActionableMissingEvidence(setupCollectionReview);
  if (missingSetupEvidence) {
    reasons.push('Some capabilities still lack confirmation or capability-level evidence.');
  }
  const warningReasons = uniqueSortedStrings((report?.warnings ?? [])
    .map((warning) => {
      const reasonCode = safePublicReasonCode(warning);
      if (verificationPassed && reasonCode === 'validation-failed') {
        return null;
      }
      return partialSuccessReasonFromWarning(warning);
    })
    .filter(Boolean));
  if (warningReasons.length) {
    reasons.push(...warningReasons);
  } else if ((report?.warnings ?? []).some((warning) => String(warning).trim() && !/debug/iu.test(String(warning)))) {
    reasons.push('The build has sanitized collection or verification warnings.');
  }
  return uniqueSortedStrings(reasons);
}

export function resultStatusFromBuild({
  legacyStatus,
  context,
  report,
  setupCollectionReview,
  capabilityState,
}) {
  return buildPartialSuccessOutcome({
    legacyStatus,
    context,
    report,
    setupCollectionReview,
    capabilityState,
  }).result_status;
}

export function buildPartialSuccessOutcome({
  legacyStatus,
  context,
  report,
  setupCollectionReview,
  capabilityState,
} = /** @type {any} */ ({})) {
  const partial_success_reasons = buildPartialSuccessReasons({
    context,
    report,
    setupCollectionReview,
    capabilityState,
  });
  const result_status = legacyStatus !== 'success'
    ? 'failed'
    : partial_success_reasons.length ? 'partial_success' : 'success';
  return {
    result_status,
    partial_success_reasons,
  };
}
