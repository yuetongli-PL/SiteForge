// @ts-check

export const SITEFORGE_ARTIFACT_CONTRACT_SCHEMA_VERSION = 1;
export const SITEFORGE_ARTIFACT_FAMILY = 'siteforge-build';

export const SITEFORGE_REQUIRED_PRE_PROMOTION_ARTIFACTS = Object.freeze([
  'site.json',
  'generated_adapter.json',
  'adapter_contract_tests.json',
  'auth_state_report.json',
  'seeds.json',
  'crawl_static.json',
  'crawl_authenticated.json',
  'crawl_checkpoint.json',
  'graph.json',
  'classified_graph.json',
  'affordances.json',
  'capabilities.json',
  'intents.json',
  'skill.yaml',
  'execution_plans.json',
  'safety_policy.json',
]);

export const SITEFORGE_REQUIRED_FINAL_ARTIFACTS = Object.freeze([
  ...SITEFORGE_REQUIRED_PRE_PROMOTION_ARTIFACTS,
  'verification_report.json',
  'build_report.user.json',
  'build_report.user.md',
  'build_report.debug.json',
  'build_report.json',
  'capability_intent_summary.html',
  'page_reconciliation_report.json',
]);

export const SITEFORGE_REQUIRED_ARTIFACTS = SITEFORGE_REQUIRED_FINAL_ARTIFACTS;

export const SITEFORGE_USER_REPORT_FILE = 'build_report.user.json';
export const SITEFORGE_USER_REPORT_MARKDOWN_FILE = 'build_report.user.md';
export const SITEFORGE_DEBUG_REPORT_FILE = 'build_report.debug.json';
export const SITEFORGE_INDEX_REPORT_FILE = 'build_report.json';
export const SITEFORGE_CAPABILITY_INTENT_SUMMARY_HTML_FILE = 'capability_intent_summary.html';
export const SITEFORGE_PAGE_RECONCILIATION_REPORT_FILE = 'page_reconciliation_report.json';
export const SITEFORGE_USER_REPORT_JSON_ALIAS = 'user.json';
export const SITEFORGE_USER_REPORT_MARKDOWN_ALIAS = 'user.md';
export const SITEFORGE_DEBUG_REPORT_JSON_ALIAS = 'debug.json';
export const SITEFORGE_REDACTION_AUDIT_SUFFIX = '.redaction-audit.json';

export const SITEFORGE_REPORT_ALIASES = Object.freeze({
  [SITEFORGE_USER_REPORT_FILE]: Object.freeze([
    SITEFORGE_USER_REPORT_JSON_ALIAS,
    SITEFORGE_USER_REPORT_MARKDOWN_ALIAS,
  ]),
  [SITEFORGE_DEBUG_REPORT_FILE]: Object.freeze([
    SITEFORGE_DEBUG_REPORT_JSON_ALIAS,
  ]),
});

export const SITEFORGE_REPORT_MODES = Object.freeze([
  'user',
  'debug',
  'both',
]);

export function siteForgeReportModeSet() {
  return new Set(SITEFORGE_REPORT_MODES);
}
