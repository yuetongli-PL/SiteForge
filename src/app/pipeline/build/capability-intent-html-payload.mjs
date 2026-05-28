// @ts-check

import path from 'node:path';
import { uniqueSortedStrings } from '../../../shared/normalize.mjs';
import {
  SITEFORGE_CAPABILITY_INTENT_SUMMARY_HTML_FILE as CAPABILITY_INTENT_SUMMARY_HTML_FILE,
  SITEFORGE_DEBUG_REPORT_FILE as DEBUG_REPORT_FILE,
  SITEFORGE_INDEX_REPORT_FILE as INDEX_REPORT_FILE,
  SITEFORGE_USER_REPORT_FILE as USER_REPORT_FILE,
  SITEFORGE_USER_REPORT_MARKDOWN_FILE as USER_REPORT_MARKDOWN_FILE,
} from './artifact-contract.mjs';
import { BUILD_SCHEMA_VERSION } from './models.mjs';
import { normalizeCapabilityEnablementStatus } from './risk-policy.mjs';
import {
  CAPABILITY_INTENT_SUMMARY_HTML_RELATIVE_PATH,
} from './build-debug-report.mjs';
import { buildCoverageReport } from './user-report-coverage.mjs';
import { relativeReportPath } from './user-report-values.mjs';
import {
  HTML_REPORT_MAX_EXAMPLES,
  sanitizeCapabilityIntentHtmlPayload,
} from './capability-intent-html-values.mjs';

function normalizeStatusToken(value) {
  return String(value ?? '').trim().toLowerCase();
}

function nodeSourceLayer(node = /** @type {any} */ ({})) {
  const layer = String(node?.sourceLayer ?? '').trim();
  if (layer === 'authenticated' || layer === 'authenticated_overlay' || layer === 'public_rendered' || layer === 'authorized_source' || layer === 'public') {
    return layer;
  }
  return node?.authRequired === true ? 'authenticated' : 'public';
}

export function capabilityHtmlGroup(capability = /** @type {any} */ ({})) {
  const enabled = normalizeStatusToken(capability.enabled_status ?? capability.enabledStatus ?? capability.default_policy);
  const normalized = enabled || normalizeStatusToken(normalizeCapabilityEnablementStatus(capability));
  const status = normalizeStatusToken(capability.status);
  if (['candidate_debug_only', 'debug_only'].includes(normalized)) return normalized;
  if (status === 'candidate') return 'candidate';
  if (status === 'disabled' || normalized === 'disabled') return 'disabled';
  if (normalized === 'limited_enabled') return 'limited_enabled';
  if (normalized === 'confirmation_required') return 'confirmation_required';
  if (normalized === 'draft_only') return 'draft_only';
  if (status === 'active' || normalized === 'enabled') return 'enabled';
  return normalized || status || 'unknown';
}

export function capabilityHtmlReason(capability = /** @type {any} */ ({})) {
  if (capability.activationBlockedReason === 'missing_auth_evidence') {
    return 'This capability needs authenticated structural evidence; this build did not satisfy the required auth evidence, so it remains a candidate.';
  }
  if (capability.activationBlockedReason === 'capability-evidence-matrix-incomplete') {
    return 'The capability evidence matrix is incomplete, so it is not enabled as a callable capability.';
  }
  if (capability.status === 'disabled' || normalizeStatusToken(capability.enabled_status) === 'disabled') {
    return 'This capability involves a high-risk or restricted action, so it is disabled by default and will not auto-execute.';
  }
  if (normalizeStatusToken(capability.enabled_status) === 'draft_only') {
    return 'This capability can only generate a draft or preview; it will not submit anything.';
  }
  if (normalizeStatusToken(capability.enabled_status) === 'confirmation_required') {
    return 'This capability requires explicit confirmation before execution.';
  }
  if (capability.authRequired === true) {
    return 'This capability may only return sanitized structural summaries; body text and account material are not saved.';
  }
  return capability.reason ?? capability.activationBlockedReason ?? capability.disabledReason ?? capability.reason_code ?? '-';
}

export function capabilityHtmlStrategy(capability = /** @type {any} */ ({})) {
  return capability.user_strategy
    ?? capability.strategy
    ?? capability.default_policy
    ?? capability.enabled_status
    ?? capability.status
    ?? '-';
}

export function intentCallableLabel(intent = /** @type {any} */ ({}), capability = /** @type {any} */ ({})) {
  if (intent.callable === false || capability.status !== 'active') {
    return 'non-callable';
  }
  return 'callable';
}

export function summarizeHtmlCoverage(context, stageResults, capabilities, userReport = null, report = null) {
  return userReport?.coverage
    ?? report?.summary?.coverage
    ?? buildCoverageReport(context, stageResults, capabilities);
}

export function capabilitySourceNodesForHtml(capability = /** @type {any} */ ({}), graphNodeById = new Map()) {
  const ids = uniqueSortedStrings([
    ...(capability.entryNodeIds ?? []),
    ...(capability.requiredNodeIds ?? []),
  ]);
  return ids.map((id) => graphNodeById.get(id)).filter(Boolean);
}

export function routeTemplatesForHtml(capability = /** @type {any} */ ({}), sourceNodes = /** @type {any[]} */ ([])) {
  return uniqueSortedStrings([
    capability.routeTemplate,
    capability.routePattern,
    ...(capability.executionPlan?.steps ?? []).map((step) => step.routeTemplate ?? step.routePath ?? null),
    ...sourceNodes.map((node) => node.instanceRouteTemplate ?? node.routeTemplate ?? node.routePattern ?? null),
  ].filter(Boolean)).slice(0, 8);
}

export function categoryInstancesForHtml(capability = /** @type {any} */ ({}), sourceNodes = /** @type {any[]} */ ([])) {
  const instances = [
    capability.categoryInstance,
    ...sourceNodes.map((node) => node.categoryInstance),
  ].filter(Boolean);
  const seen = new Set();
  return instances.filter((instance) => {
    const key = `${instance.kind ?? ''}:${instance.label ?? ''}:${instance.routeTemplate ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).slice(0, 8).map((instance) => ({
    kind: instance.kind ?? null,
    label: instance.label ?? null,
    routeTemplate: instance.routeTemplate ?? null,
    sourceLayer: instance.sourceLayer ?? null,
    evidenceStatus: instance.evidenceStatus ?? null,
  }));
}

export function htmlCategoryInstanceLabel(instance = /** @type {any} */ ({})) {
  return [
    instance.kind ? `${instance.kind}:` : null,
    instance.label,
    instance.routeTemplate ? `(${instance.routeTemplate})` : null,
  ].filter(Boolean).join(' ');
}

export function buildElementCoverageAuditRows(graph = /** @type {any} */ ({}), capabilityRows = /** @type {any[]} */ ([]), intentRows = /** @type {any[]} */ ([])) {
  const capabilitiesByNodeId = new Map();
  for (const capability of capabilityRows) {
    for (const nodeId of capability.sourceNodeIds ?? []) {
      capabilitiesByNodeId.set(nodeId, [...(capabilitiesByNodeId.get(nodeId) ?? []), capability]);
    }
  }
  const intentsBySourceNodeId = new Map();
  const intentsByCapabilityId = new Map();
  for (const intent of intentRows) {
    if (intent.sourceNodeId) {
      intentsBySourceNodeId.set(intent.sourceNodeId, [...(intentsBySourceNodeId.get(intent.sourceNodeId) ?? []), intent]);
    }
    if (intent.capabilityId) {
      intentsByCapabilityId.set(intent.capabilityId, [...(intentsByCapabilityId.get(intent.capabilityId) ?? []), intent]);
    }
  }
  return (graph.nodes ?? [])
    .filter((node) => (
      ['component', 'operation'].includes(node.type)
      && node.evidenceStatus === 'element_instance_summary_present'
      && ['public', 'public_rendered', 'authenticated', 'authenticated_overlay'].includes(nodeSourceLayer(node))
    ))
    .map((node) => {
      const mappedCapabilities = capabilitiesByNodeId.get(node.id) ?? [];
      const mappedIntents = uniqueSortedStrings([
        ...(intentsBySourceNodeId.get(node.id) ?? []).map((intent) => intent.id),
        ...mappedCapabilities.flatMap((capability) => (intentsByCapabilityId.get(capability.id) ?? []).map((intent) => intent.id)),
      ]);
      const mappedCapabilityIds = mappedCapabilities.map((capability) => capability.id);
      const status = mappedCapabilityIds.length && mappedIntents.length
        ? 'covered'
        : mappedCapabilityIds.length
          ? 'missing_intent'
          : mappedIntents.length
            ? 'graph_intent_only'
            : 'missing_capability';
      return {
        nodeId: node.id,
        status,
        sourceLayer: nodeSourceLayer(node),
        elementRole: node.elementRole ?? node.linkSemanticKind ?? node.instanceKind ?? null,
        elementLabel: node.elementLabel ?? node.linkLabel ?? node.instanceLabel ?? node.title ?? null,
        routeTemplate: node.instanceRouteTemplate ?? node.routeTemplate ?? node.routePattern ?? null,
        categoryInstance: node.categoryInstance ?? null,
        evidenceStatus: node.evidenceStatus ?? null,
        mappedCapabilityIds,
        mappedCapabilityNames: mappedCapabilities.map((capability) => capability.name).filter(Boolean),
        mappedIntentIds: mappedIntents,
      };
    })
    .sort((left, right) => (
      String(left.sourceLayer ?? '').localeCompare(String(right.sourceLayer ?? ''), 'en')
      || String(left.elementRole ?? '').localeCompare(String(right.elementRole ?? ''), 'en')
      || String(left.elementLabel ?? '').localeCompare(String(right.elementLabel ?? ''), 'zh-Hans-CN')
      || String(left.routeTemplate ?? '').localeCompare(String(right.routeTemplate ?? ''), 'en')
    ))
    .slice(0, 160);
}

export function elementCoverageAuditSummary(rows = /** @type {any[]} */ ([])) {
  const counts = {
    total: rows.length,
    covered: 0,
    graphIntentOnly: 0,
    missingCapability: 0,
    missingIntent: 0,
  };
  for (const row of rows) {
    if (row.status === 'covered') counts.covered += 1;
    if (row.status === 'graph_intent_only') counts.graphIntentOnly += 1;
    if (row.status === 'missing_capability') counts.missingCapability += 1;
    if (row.status === 'missing_intent') counts.missingIntent += 1;
  }
  return counts;
}

export function buildCapabilityIntentHtmlPayload(context, stageResults, report, userReport) {
  const capabilities = stageResults.discoverCapabilities?.capabilities ?? [];
  const intents = stageResults.generateIntents?.intents ?? [];
  const graph = stageResults.classifyNodes?.graph ?? stageResults.buildSiteGraph?.graph ?? { nodes: [] };
  const graphNodeById = new Map((graph.nodes ?? []).map((node) => [node.id, node]));
  const verification = stageResults.verifySkill?.verificationReport ?? null;
  const registry = stageResults.registerSkill?.registryReport ?? null;
  const coverage = summarizeHtmlCoverage(context, stageResults, capabilities, userReport, report);
  const capabilityById = new Map(capabilities.map((capability) => [capability.id, capability]));
  const intentsByCapability = new Map();
  for (const intent of intents) {
    const key = intent.capabilityId ?? 'unknown';
    intentsByCapability.set(key, [...(intentsByCapability.get(key) ?? []), intent]);
  }
  const capabilityRows = capabilities.map((capability) => {
    const mappedIntents = intentsByCapability.get(capability.id) ?? [];
    const matrix = capability.evidenceMatrix ?? capability.activationEvidence ?? null;
    const sourceNodes = capabilitySourceNodesForHtml(capability, graphNodeById);
    const primaryNode = sourceNodes[0] ?? {};
    const categoryInstances = categoryInstancesForHtml(capability, sourceNodes);
    return {
      id: capability.id,
      name: capability.name,
      userFacingName: capability.user_facing_name ?? capability.userFacingName ?? null,
      userValue: capability.userValue ?? null,
      action: capability.action ?? null,
      object: capability.object ?? null,
      status: capability.status ?? null,
      enabledStatus: capability.enabled_status ?? capability.enabledStatus ?? normalizeCapabilityEnablementStatus(capability),
      evidenceStatus: capability.evidence_status ?? capability.evidenceStatus ?? null,
      riskLevel: capability.risk_level ?? capability.riskLevel ?? null,
      safetyLevel: capability.safetyLevel ?? capability.safety_level ?? null,
      authRequired: capability.authRequired === true,
      requiredEvidenceLevel: capability.requiredEvidenceLevel ?? matrix?.requiredEvidenceLevel ?? null,
      observedEvidenceLevel: capability.observedEvidenceLevel ?? matrix?.observedEvidenceLevel ?? null,
      sourceLayer: capability.sourceLayer ?? matrix?.sourceLayer ?? 'public',
      evidenceModel: capability.evidenceModel ?? null,
      publicRouteOnly: capability.publicRouteOnly === true,
      elementRole: capability.elementRole ?? primaryNode.elementRole ?? primaryNode.linkSemanticKind ?? null,
      elementLabel: capability.elementLabel ?? primaryNode.elementLabel ?? primaryNode.linkLabel ?? primaryNode.title ?? null,
      sourceNodeIds: sourceNodes.map((node) => node.id).slice(0, 8),
      sourceNodeLabels: sourceNodes.map((node) => node.elementLabel ?? node.linkLabel ?? node.title ?? node.routeTemplate ?? node.routePattern).filter(Boolean).slice(0, 8),
      routeTemplates: routeTemplatesForHtml(capability, sourceNodes),
      categoryInstances,
      activationDecision: matrix?.activationDecision ?? capability.enabled_status ?? capability.status ?? null,
      reason: capabilityHtmlReason(capability),
      strategy: capabilityHtmlStrategy(capability),
      mappedIntentCount: mappedIntents.length,
      group: capabilityHtmlGroup(capability),
      evidenceMatrix: matrix ? {
        requiredEvidence: matrix.requiredEvidence ?? [],
        observedEvidence: matrix.observedEvidence ?? [],
        missingEvidence: matrix.missingEvidence ?? [],
        activationDecision: matrix.activationDecision ?? null,
      } : null,
    };
  });
  const intentRows = intents.map((intent) => {
    const capability = capabilityById.get(intent.capabilityId) ?? {};
    const sourceNode = graphNodeById.get(intent.sourceNodeId) ?? null;
    return {
      id: intent.id,
      capabilityId: intent.capabilityId,
      capabilityName: capability.name ?? intent.name ?? null,
      intentSource: intent.intentSource ?? null,
      sourceNodeId: intent.sourceNodeId ?? null,
      sourceLayer: intent.sourceLayer ?? sourceNode?.sourceLayer ?? null,
      categoryInstance: intent.categoryInstance ?? sourceNode?.categoryInstance ?? null,
      canonicalUtterance: intent.canonicalUtterance ?? intent.name ?? null,
      callable: intentCallableLabel(intent, capability),
      safetyLevel: intent.safetyLevel ?? capability.safetyLevel ?? null,
      enabledStatus: intent.enabled_status ?? capability.enabled_status ?? normalizeCapabilityEnablementStatus(capability),
      utteranceExamples: (intent.utteranceExamples ?? []).slice(0, HTML_REPORT_MAX_EXAMPLES),
      negativeExamples: (intent.negativeExamples ?? []).slice(0, HTML_REPORT_MAX_EXAMPLES),
      reason: intent.reason ?? capabilityHtmlReason(capability),
      safeRemediation: intent.safe_remediation ?? capability.safe_remediation ?? capability.safe_remediation_path ?? null,
    };
  });
  const mappingRows = capabilityRows.map((capability) => {
    const mappedIntents = intentRows.filter((intent) => intent.capabilityId === capability.id);
    return {
      capabilityName: capability.name,
      capabilityId: capability.id,
      capabilityStatus: capability.status,
      enabledStatus: capability.enabledStatus,
      intentCount: mappedIntents.length,
      canonicalUtterances: mappedIntents.map((intent) => intent.canonicalUtterance).filter(Boolean),
      callable: mappedIntents.filter((intent) => intent.callable === 'callable').length,
      nonCallable: mappedIntents.filter((intent) => intent.callable !== 'callable').length,
      riskLevel: capability.riskLevel,
      authVerificationStatus: capability.observedEvidenceLevel ?? capability.requiredEvidenceLevel ?? '-',
      elementLabel: capability.elementLabel ?? null,
      elementRole: capability.elementRole ?? null,
      routeTemplates: capability.routeTemplates ?? [],
      categoryInstances: capability.categoryInstances ?? [],
    };
  });
  const elementCoverageRows = buildElementCoverageAuditRows(graph, capabilityRows, intentRows);
  const elementCoverage = {
    summary: elementCoverageAuditSummary(elementCoverageRows),
    rows: elementCoverageRows,
  };
  const blocked = {
    disabledHighRisk: capabilityRows.filter((capability) => (
      capability.status === 'disabled'
      || ['write_high', 'account_security_critical', 'read_private_high'].includes(normalizeStatusToken(capability.riskLevel))
    )),
    blockedByAuth: coverage.blockedByAuth ?? [],
    requiresLogin: coverage.requiresLoginButMissing ?? [],
    missingEvidence: capabilityRows.filter((capability) => (capability.evidenceMatrix?.missingEvidence ?? []).length > 0),
    candidateOnly: capabilityRows.filter((capability) => ['candidate', 'candidate_debug_only', 'debug_only'].includes(capability.group)),
  };
  const paths = {
    userReport: relativeReportPath(context.cwd, report.artifacts?.[USER_REPORT_FILE] ?? path.join(context.artifactDir, USER_REPORT_FILE)),
    markdownReport: relativeReportPath(context.cwd, report.artifacts?.[USER_REPORT_MARKDOWN_FILE] ?? path.join(context.artifactDir, USER_REPORT_MARKDOWN_FILE)),
    debugReport: relativeReportPath(context.cwd, report.artifacts?.[DEBUG_REPORT_FILE] ?? path.join(context.artifactDir, DEBUG_REPORT_FILE)),
    indexReport: relativeReportPath(context.cwd, report.artifacts?.[INDEX_REPORT_FILE] ?? path.join(context.artifactDir, INDEX_REPORT_FILE)),
    htmlReport: relativeReportPath(context.cwd, report.artifacts?.[CAPABILITY_INTENT_SUMMARY_HTML_FILE] ?? path.join(context.artifactDir, CAPABILITY_INTENT_SUMMARY_HTML_RELATIVE_PATH)),
  };
  return sanitizeCapabilityIntentHtmlPayload({
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-capability-intent-html-summary',
    generatedAt: new Date().toISOString(),
    meta: {
      title: 'SiteForge Build Summary',
      siteUrl: context.site.rootUrl,
      siteId: report.siteId ?? context.site.id,
      buildId: report.buildId ?? context.buildId,
      skillId: report.skillId ?? context.skillId ?? null,
      crawlMode: userReport.crawlMode ?? report.crawlMode ?? context.crawlContract?.crawlMode ?? 'public_only',
      authMethod: userReport.authMethod ?? report.authMethod ?? context.crawlContract?.authMethod ?? 'none',
      authVerificationStatus: userReport.authVerificationStatus ?? report.authVerificationStatus ?? context.authStateReport?.authVerificationStatus ?? 'not_requested',
      resultStatus: userReport.result_status ?? report.result_status ?? null,
      legacyStatus: userReport.legacy_status ?? report.legacy_status ?? report.status ?? null,
      verificationStatus: verification?.status ?? report.summary?.verificationStatus ?? null,
      registryStatus: registry?.status ?? report.summary?.registryStatus ?? null,
      promotionClass: verification?.promotionClass ?? registry?.promotionClass ?? report.summary?.promotionClass ?? null,
      runtimeMode: verification?.runtimeMode ?? registry?.runtimeMode ?? report.summary?.runtimeMode ?? null,
      coverageStatus: verification?.coverageStatus ?? registry?.coverageStatus ?? report.summary?.coverageStatus ?? null,
      generatedAt: new Date().toISOString(),
      completedAt: report.completedAt ?? null,
      paths,
    },
    coverage,
    counts: {
      capabilities: capabilityRows.length,
      intents: intentRows.length,
      nodes: graph.nodes?.length ?? 0,
      elementNodes: elementCoverage.summary.total,
      elementCoverageMissingCapabilities: elementCoverage.summary.missingCapability,
      elementCoverageMissingIntents: elementCoverage.summary.missingIntent,
      riskBlocked: blocked.disabledHighRisk.length,
    },
    capabilities: capabilityRows,
    intents: intentRows,
    mappings: mappingRows,
    elementCoverage,
    blocked,
  });
}
