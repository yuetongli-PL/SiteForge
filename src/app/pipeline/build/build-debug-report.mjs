// @ts-check

import { uniqueSortedStrings } from '../../../shared/normalize.mjs';
import { BUILD_SCHEMA_VERSION } from './models.mjs';
import { sanitizeEvidenceRef } from './risk-policy.mjs';
import {
  SITEFORGE_CAPABILITY_INTENT_SUMMARY_HTML_FILE as CAPABILITY_INTENT_SUMMARY_HTML_FILE,
  SITEFORGE_DEBUG_REPORT_FILE as DEBUG_REPORT_FILE,
  SITEFORGE_DEBUG_REPORT_JSON_ALIAS as DEBUG_REPORT_JSON_ALIAS,
  SITEFORGE_INDEX_REPORT_FILE as INDEX_REPORT_FILE,
  SITEFORGE_USER_REPORT_FILE as USER_REPORT_FILE,
  SITEFORGE_USER_REPORT_JSON_ALIAS as USER_REPORT_JSON_ALIAS,
  SITEFORGE_USER_REPORT_MARKDOWN_ALIAS as USER_REPORT_MARKDOWN_ALIAS,
  SITEFORGE_USER_REPORT_MARKDOWN_FILE as USER_REPORT_MARKDOWN_FILE,
} from './artifact-contract.mjs';
import {
  ACCESS_REMEDIATION_PLAN_FILE,
  PAGE_RECONCILIATION_REPORT_FILE,
} from './build-summary-paths.mjs';
import { normalizeReportMode } from './build-report-mode.mjs';
import { buildCoverageReport } from './user-report-coverage.mjs';
import { sanitizeReportPublicValue } from './user-report-values.mjs';

export const RAW_PAGE_MATERIAL_MANIFEST_FILE = 'raw_page_material_manifest.json';
export const RAW_PAGE_MATERIAL_MANIFEST_RELATIVE_PATH = `reports/${RAW_PAGE_MATERIAL_MANIFEST_FILE}`;
export const AUTHORIZED_SOURCE_MANIFEST_FILE = 'authorized_source_manifest.json';
export const AUTHORIZED_SOURCE_MANIFEST_RELATIVE_PATH = `reports/${AUTHORIZED_SOURCE_MANIFEST_FILE}`;
export const CAPABILITY_INTENT_SUMMARY_HTML_RELATIVE_PATH = `reports/${CAPABILITY_INTENT_SUMMARY_HTML_FILE}`;

export function summarizeStageRecords(stageRecords = /** @type {any} */ ({})) {
  return Object.fromEntries(Object.entries(stageRecords).map(([name, record]) => [name, {
    status: record.status ?? null,
    reasonCode: record.reasonCode ?? null,
    reasonCodes: record.reasonCodes ?? [],
    warnings: record.warnings ?? [],
    errors: record.errors ?? [],
    summary: record.summary ?? {},
  }]));
}

export function sanitizedNetworkSummary(context, stageResults = /** @type {any} */ ({})) {
  const sourceDiagnostics = context.setupProfile?.sourceDiagnostics ?? [];
  const networkStage = stageResults.captureNetworkTraces ?? null;
  const stageSummary = networkStage?.summary?.sanitizedSummary ?? networkStage?.summary ?? null;
  const replaySummary = stageResults.apiAdapterReplay?.summary ?? {};
  return {
    requested: context.policy?.captureNetwork === true || context.options?.network === true,
    raw_traces_persisted: stageSummary?.rawTracesPersisted === true,
    saved_summary_only: stageSummary?.savedSummaryOnly !== false,
    raw_artifact_path: stageSummary?.rawArtifactPath ?? null,
    raw_trace_count: stageSummary?.rawTraceCount ?? stageSummary?.rawTraces ?? 0,
    raw_truncated_body_count: stageSummary?.rawTruncatedBodyCount ?? 0,
    api_candidate_count: stageSummary?.apiCandidateCount ?? 0,
    api_candidate_artifacts: stageSummary?.apiCandidateArtifacts ?? [],
    adapter_validation_count: replaySummary.adapterDecisionCount ?? stageSummary?.adapterValidationCount ?? 0,
    adapter_accepted_count: replaySummary.adapterAcceptedCount ?? stageSummary?.adapterAcceptedCount ?? 0,
    replay_verified_count: replaySummary.replayVerifiedCount ?? stageSummary?.replayVerifiedCount ?? 0,
    activated_api_adapter_count: replaySummary.activatedApiAdapterCount ?? stageSummary?.activatedApiAdapterCount ?? 0,
    adapter_skipped_reason_counts: replaySummary.skippedReasonCounts ?? stageSummary?.adapterSkippedReasonCounts ?? {},
    catalog_promotion_gate_count: replaySummary.catalogPromotionGateCount ?? stageSummary?.catalogPromotionGateCount ?? 0,
    catalog_promotion_ready_count: replaySummary.catalogPromotionReadyCount ?? stageSummary?.catalogPromotionReadyCount ?? 0,
    catalog_promotion_blocked_reason_counts: replaySummary.catalogPromotionBlockedReasonCounts ?? stageSummary?.catalogPromotionBlockedReasonCounts ?? {},
    api_extraction_disabled_reason: stageSummary?.apiExtractionDisabledReason ?? null,
    source_diagnostic_count: sourceDiagnostics.length,
    observed_status_codes: uniqueSortedStrings(sourceDiagnostics.map((item) => item?.statusCode).filter(Boolean)),
    observed_hosts: uniqueSortedStrings(sourceDiagnostics.map((item) => {
      try {
        return new URL(item?.sourcePath ?? '').hostname;
      } catch {
        return null;
      }
    }).filter(Boolean)),
    collector_status: networkStage?.summary ?? null,
    adapter_replay_status: stageResults.apiAdapterReplay?.summary ?? null,
  };
}

export function buildRouteStateGraph(stageResults = /** @type {any} */ ({})) {
  const nodes = stageResults.classifyNodes?.graph?.nodes
    ?? stageResults.buildSiteGraph?.graph?.nodes
    ?? [];
  return {
    routes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      routePattern: node.routePattern ?? null,
      routeTemplate: node.routeTemplate ?? null,
      tabState: node.tabState ?? null,
      pageType: node.pageType ?? null,
      classification: node.classification ?? null,
      authRequired: node.authRequired === true,
      childNodeIds: node.childNodeIds ?? [],
    })),
  };
}

export function buildDebugReport(
  context,
  stageResults,
  stageRecords,
  report,
  userReport,
  { siteAdapter = null } = /** @type {any} */ ({}),
) {
  return sanitizeReportPublicValue({
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-build-debug-report',
    result_status: userReport.result_status,
    legacy_status: report.status,
    build_id: report.buildId,
    site_id: report.siteId,
    skill_id: report.skillId,
    site_adapter: siteAdapter,
    site_adapter_profile: context.siteAdapterProfile ?? null,
    crawl_contract: context.crawlContract ?? null,
    auth_state_report: context.authStateReport ?? null,
    coverage: buildCoverageReport(context, stageResults, stageResults.discoverCapabilities?.capabilities ?? []),
    seeds: stageResults.discoverSeeds?.seeds ?? [],
    nodes: stageResults.classifyNodes?.graph?.nodes ?? stageResults.buildSiteGraph?.graph?.nodes ?? [],
    actions: stageResults.extractAffordances?.affordances ?? stageResults.discoverInteractions?.interactions ?? [],
    capabilities: stageResults.discoverCapabilities?.capabilities ?? [],
    intents: stageResults.generateIntents?.intents ?? [],
    evidence_review: {
      setup_collection_review: report.setupCollectionReview ?? null,
      collection_outcomes: report.collectionOutcomes ?? null,
      verification: stageResults.verifySkill?.verificationReport ?? null,
      registry: stageResults.registerSkill?.registryReport ?? null,
    },
    warnings: {
      codes: report.warningCodes ?? [],
      messages: report.warnings ?? [],
      stage_records: summarizeStageRecords(stageRecords),
    },
    policy_failures: {
      failed_stage: report.failedStage ?? null,
      failure_class: report.failureClass ?? null,
      reason_code: report.reasonCode ?? null,
      reason_action: report.reasonAction ?? null,
      unsuccessful: report.collectionOutcomes?.unsuccessful ?? [],
    },
    collector_status: {
      stages: summarizeStageRecords(stageRecords),
      network: sanitizedNetworkSummary(context, stageResults),
    },
    discovery_graph: stageResults.classifyNodes?.graph ?? stageResults.buildSiteGraph?.graph ?? null,
    route_state_graph: buildRouteStateGraph(stageResults),
    sanitization_report: {
      redaction_required: true,
      status: 'pending',
    },
    test_metadata: {
      generated_at: new Date().toISOString(),
      build_id: context.buildId,
      site_id: context.site.id,
      artifact_dir: sanitizeEvidenceRef(context.artifactDir),
      stage_count: Object.keys(stageRecords ?? {}).length,
      report_mode: normalizeReportMode(context.options?.reportMode),
      privacy_mode: context.options?.privacyMode ?? 'limited',
    },
  });
}

export function buildReportIndex(report, userReport, debugReport) {
  const htmlReportPath = report.artifacts?.[CAPABILITY_INTENT_SUMMARY_HTML_FILE] ?? null;
  const pageReconciliationReportPath = report.artifacts?.[PAGE_RECONCILIATION_REPORT_FILE] ?? null;
  const accessRemediationPlanPath = report.artifacts?.[ACCESS_REMEDIATION_PLAN_FILE] ?? null;
  const rawPageMaterialManifestPath = report.artifacts?.[RAW_PAGE_MATERIAL_MANIFEST_FILE] ?? null;
  const authorizedSourceManifestPath = report.artifacts?.[AUTHORIZED_SOURCE_MANIFEST_FILE] ?? null;
  return {
    ...report,
    artifactFamily: 'siteforge-build-report-index',
    result_status: userReport.result_status,
    legacy_status: report.status,
    skill_id: userReport.skill_id,
    build_id: userReport.build_id,
    site: userReport.site,
    reports: {
      user: {
        json: report.artifacts?.[USER_REPORT_FILE] ?? null,
        markdown: report.artifacts?.[USER_REPORT_MARKDOWN_FILE] ?? null,
        html_capability_intent_summary: htmlReportPath,
        alias_json: report.artifacts?.[USER_REPORT_JSON_ALIAS] ?? null,
        alias_markdown: report.artifacts?.[USER_REPORT_MARKDOWN_ALIAS] ?? null,
      },
      debug: {
        json: report.artifacts?.[DEBUG_REPORT_FILE] ?? null,
        alias_json: report.artifacts?.[DEBUG_REPORT_JSON_ALIAS] ?? null,
      },
      index: {
        json: report.artifacts?.[INDEX_REPORT_FILE] ?? null,
      },
      capability_intent_summary_html: htmlReportPath,
      page_reconciliation_report: pageReconciliationReportPath,
      raw_page_material_manifest: rawPageMaterialManifestPath,
      authorized_source_manifest: authorizedSourceManifestPath,
      ...(accessRemediationPlanPath ? { access_remediation_plan: accessRemediationPlanPath } : {}),
    },
    report_index: {
      default_report: 'user',
      available_reports: [
        'user',
        'debug',
        'capability_intent_summary_html',
        'page_reconciliation_report',
        ...(rawPageMaterialManifestPath ? ['raw_page_material_manifest'] : []),
        ...(authorizedSourceManifestPath ? ['authorized_source_manifest'] : []),
        ...(accessRemediationPlanPath ? ['access_remediation_plan'] : []),
      ],
      user_report: USER_REPORT_FILE,
      user_markdown: USER_REPORT_MARKDOWN_FILE,
      capability_intent_summary_html: CAPABILITY_INTENT_SUMMARY_HTML_RELATIVE_PATH,
      page_reconciliation_report: PAGE_RECONCILIATION_REPORT_FILE,
      ...(rawPageMaterialManifestPath ? { raw_page_material_manifest: RAW_PAGE_MATERIAL_MANIFEST_RELATIVE_PATH } : {}),
      ...(authorizedSourceManifestPath ? { authorized_source_manifest: AUTHORIZED_SOURCE_MANIFEST_RELATIVE_PATH } : {}),
      ...(accessRemediationPlanPath ? { access_remediation_plan: ACCESS_REMEDIATION_PLAN_FILE } : {}),
      debug_report: DEBUG_REPORT_FILE,
      user_report_alias: USER_REPORT_JSON_ALIAS,
      user_markdown_alias: USER_REPORT_MARKDOWN_ALIAS,
      debug_report_alias: DEBUG_REPORT_JSON_ALIAS,
      privacy_mode: userReport.privacy_summary.mode,
      redacted: true,
    },
    user_report: userReport,
    debug_report_summary: {
      result_status: debugReport.result_status,
      seed_count: debugReport.seeds.length,
      node_count: debugReport.nodes.length,
      action_count: debugReport.actions.length,
      capability_count: debugReport.capabilities.length,
      intent_count: debugReport.intents.length,
      sanitization_report: debugReport.sanitization_report,
    },
  };
}
