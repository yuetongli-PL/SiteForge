// @ts-check

import {
  SITEFORGE_CAPABILITY_INTENT_SUMMARY_HTML_FILE as CAPABILITY_INTENT_SUMMARY_HTML_FILE,
  SITEFORGE_PAGE_RECONCILIATION_REPORT_FILE as PAGE_RECONCILIATION_REPORT_FILE,
} from './artifact-contract.mjs';

export { PAGE_RECONCILIATION_REPORT_FILE };

export const ACCESS_REMEDIATION_PLAN_FILE = 'access_remediation_plan.json';
export const ROBOTS_REMEDIATION_PLAN_FILE = 'robots_remediation_plan.json';

export function capabilityIntentHtmlResultPath(result = /** @type {any} */ ({})) {
  return result.artifacts?.[CAPABILITY_INTENT_SUMMARY_HTML_FILE]
    ?? result.reports?.capability_intent_summary_html
    ?? result.reports?.user?.html_capability_intent_summary
    ?? result.user_report?.reports?.capability_intent_summary_html
    ?? result.user_report?.build_completion?.capability_intent_summary_html
    ?? result.userReport?.reports?.capability_intent_summary_html
    ?? result.userReport?.build_completion?.capability_intent_summary_html
    ?? result.build_completion?.capability_intent_summary_html
    ?? null;
}

export function pageReconciliationResultPath(result = /** @type {any} */ ({})) {
  return result.artifacts?.[PAGE_RECONCILIATION_REPORT_FILE]
    ?? result.reports?.page_reconciliation_report
    ?? result.user_report?.reports?.page_reconciliation_report
    ?? result.userReport?.reports?.page_reconciliation_report
    ?? result.pageReconciliationReport
    ?? null;
}

export function robotsRemediationResultPath(result = /** @type {any} */ ({})) {
  return result.artifacts?.[ROBOTS_REMEDIATION_PLAN_FILE]
    ?? result.reports?.robots_remediation_plan
    ?? result.user_report?.reports?.robots_remediation_plan
    ?? result.userReport?.reports?.robots_remediation_plan
    ?? null;
}

export function accessRemediationResultPath(result = /** @type {any} */ ({})) {
  return result.artifacts?.[ACCESS_REMEDIATION_PLAN_FILE]
    ?? result.reports?.access_remediation_plan
    ?? result.user_report?.reports?.access_remediation_plan
    ?? result.userReport?.reports?.access_remediation_plan
    ?? null;
}
