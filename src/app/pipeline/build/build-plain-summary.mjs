// @ts-check

import { displayReportPath } from '../../../infra/cli/path-display.mjs';
import { sanitizePublicUrl } from '../../../shared/url-safety.mjs';
import {
  SITEFORGE_USER_REPORT_FILE as USER_REPORT_FILE,
} from './artifact-contract.mjs';
import {
  accessRemediationResultPath,
  capabilityIntentHtmlResultPath,
  pageReconciliationResultPath,
  robotsRemediationResultPath,
} from './build-summary-paths.mjs';

function numberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function renderSiteForgePlainBuildSummary(result = /** @type {any} */ ({}), options = /** @type {any} */ ({})) {
  const report = result.user_report ?? result.userReport ?? {};
  const summary = result.summary ?? {};
  const capabilitySummary = report.capability_summary ?? summary.capabilities ?? {};
  const enabledStatus = capabilitySummary.enabledStatus ?? report.capability_summary?.enabled_status ?? {};
  const coverage = summary.coverage ?? report.coverage ?? {};
  const sourceUrl = report.site?.root_url
    ?? report.site?.input_url
    ?? result.inputUrl
    ?? result.site?.rootUrl
    ?? result.site?.root_url
    ?? null;
  const publicUrl = sourceUrl
    ? sanitizePublicUrl(sourceUrl, { fallback: '<url>', keepPath: false })
    : '-';
  const resultStatus = report.result_status ?? result.result_status ?? result.status ?? 'unknown';
  const legacyStatus = result.status ?? report.legacy_status ?? resultStatus;
  const skillId = report.skill_id ?? summary.skillId ?? result.skillId ?? '-';
  const activeCount = numberOrZero(capabilitySummary.active ?? summary.activeCapabilities ?? report.enabled_capabilities?.length);
  const limitedCount = numberOrZero(enabledStatus.limited_enabled ?? report.limited_enabled_capabilities?.length ?? report.limited_capabilities?.length);
  const candidateCount = numberOrZero(capabilitySummary.candidate ?? report.debug_candidate_summary?.count);
  const disabledCount = numberOrZero(capabilitySummary.disabled ?? report.disabled_capabilities?.length);
  const publicPages = numberOrZero(coverage.public?.pages ?? report.coverage?.public?.pages);
  const authenticatedPages = numberOrZero(coverage.authenticated?.pages ?? report.coverage?.authenticated?.pages);
  const overlayPages = numberOrZero(coverage.overlay?.pagesRevisited ?? report.coverage?.overlay?.pagesRevisited);
  const verificationStatus = summary.verificationStatus ?? report.build_completion?.verification_status ?? '-';
  const registryStatus = summary.registryStatus ?? (
    report.build_completion?.registry_registered === true ? 'registered' : 'not_registered'
  );
  const reportPath = result.artifacts?.[USER_REPORT_FILE]
    ?? result.reports?.user?.json
    ?? report.build_completion?.report_path
    ?? USER_REPORT_FILE;
  const htmlPath = capabilityIntentHtmlResultPath(result);
  const pageReconciliation = result.pageReconciliation
    ?? result.summary?.pageReconciliation
    ?? report.pageReconciliation
    ?? report.summary?.pageReconciliation
    ?? null;
  const pageReconciliationPath = pageReconciliationResultPath(result);
  const lines = [
    `${legacyStatus === 'success' ? '✓' : '✗'} SiteForge build: ${resultStatus}`,
    `URL: ${publicUrl}`,
    `Skill: ${skillId}`,
    `Capabilities: active ${activeCount} / limited ${limitedCount} / candidate ${candidateCount} / disabled ${disabledCount}`,
    `Coverage: public ${publicPages} pages / authenticated ${authenticatedPages} pages / overlay ${overlayPages} pages`,
    `Verification: ${verificationStatus}`,
    `Registry: ${registryStatus}`,
    `Report: ${displayReportPath(reportPath, options)}`,
  ];
  if (pageReconciliation) {
    const status = pageReconciliation.status ?? pageReconciliation.summary?.status ?? '-';
    const reasonCodes = pageReconciliation.reasonCodes ?? pageReconciliation.summary?.reasonCodes ?? [];
    const suffix = Array.isArray(reasonCodes) && reasonCodes.length
      ? ` (${reasonCodes.slice(0, 4).join(',')})`
      : '';
    lines.push(`Page reconciliation: ${status}${suffix}`);
  }
  const reportPaths = [
    ['Page reconciliation report', pageReconciliationPath],
    ['Robots remediation plan', robotsRemediationResultPath(result)],
    ['Access remediation plan', accessRemediationResultPath(result)],
    ['HTML report', htmlPath],
  ];
  for (const [label, reportValue] of reportPaths) {
    if (reportValue) {
      lines.push(`${label}: ${displayReportPath(reportValue, options)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
