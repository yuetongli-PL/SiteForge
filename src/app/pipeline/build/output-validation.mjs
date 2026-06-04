// @ts-check

import path from 'node:path';
import {
  assertAffordance,
  assertCapability,
  assertSiteNode,
  assertUserIntent,
  BUILD_SCHEMA_VERSION,
} from './models.mjs';
import { isUrlAllowedByRobots } from './html.mjs';
import { lookupSkillIntentFromRegistry } from './skill-registry.mjs';
import {
  SANITIZED_SUMMARY_ONLY,
  riskPolicySummary,
  safeRemediationPathSummary,
  sanitizeEvidenceRef,
  validateCapabilitySafeRemediationPath,
  validateCapabilityEvidenceList,
  validateExecutionPlanAgainstRiskPolicy,
} from './risk-policy.mjs';
import {
  requireReasonCodeDefinition,
  reasonCodeSummary,
} from '../../../domain/risks/reason-codes.mjs';
import {
  SITEFORGE_REQUIRED_FINAL_ARTIFACTS,
  SITEFORGE_REQUIRED_PRE_PROMOTION_ARTIFACTS,
} from './artifact-contract.mjs';
import {
  canRunAuthenticatedLayer,
  evidenceLevelRank,
} from './auth-state.mjs';

export {
  SITEFORGE_REQUIRED_FINAL_ARTIFACTS,
  SITEFORGE_REQUIRED_PRE_PROMOTION_ARTIFACTS,
} from './artifact-contract.mjs';

export const OUTPUT_VALIDATION_DUPLICATE_RATIO_THRESHOLD = 0.25;

function failureClassForReasonCode(reasonCode, family) {
  if (reasonCode === 'network-fetch-failed') {
    return 'network';
  }
  if (reasonCode === 'robots-unavailable' || reasonCode === 'robots-disallowed') {
    return 'robots';
  }
  if (reasonCode === 'dynamic-unsupported') {
    return 'unsupported';
  }
  if (reasonCode === 'page-reconciliation-failed') {
    return 'validation';
  }
  if (['empty-seed-set', 'empty-crawl', 'empty-graph'].includes(reasonCode)) {
    return 'discovery';
  }
  if (family === 'artifact' || family === 'schema') {
    return 'validation';
  }
  return family ?? 'validation';
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function hasEvidence(value) {
  return Array.isArray(value) && value.length > 0;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map(String))]
    .sort((left, right) => left.localeCompare(right, 'en'));
}

export function normalizeSiteForgeReason(reasonCode) {
  try {
    const definition = requireReasonCodeDefinition(reasonCode);
    return {
      failureClass: failureClassForReasonCode(definition.code, definition.family),
      reasonCode: definition.code,
      action: definition.description,
      reasonRecovery: reasonCodeSummary(definition.code),
    };
  } catch {
    return null;
  }
}

export function classifySiteForgeWarning(message) {
  const text = String(message ?? '');
  if (/robots\.txt unavailable/iu.test(text)) {
    return normalizeSiteForgeReason('robots-unavailable');
  }
  if (/robots(?:-| )disallowed|robots excluded|robots-disallowed/iu.test(text)) {
    return normalizeSiteForgeReason('robots-disallowed');
  }
  if (/Static fetch failed|fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|AbortError|network/iu.test(text)) {
    return normalizeSiteForgeReason('network-fetch-failed');
  }
  if (/Browser-rendered crawl is unavailable|Browser-rendered crawl is not part|Controlled-browser rendered crawl is not used|Network instrumentation is unavailable|Network summary was not requested|raw network tracing is not part|dynamic.*unsupported|rendered.*unavailable/iu.test(text)) {
    return normalizeSiteForgeReason('dynamic-unsupported');
  }
  if (/page[- ]reconciliation|Page reconciliation failed/iu.test(text)) {
    return normalizeSiteForgeReason('page-reconciliation-failed');
  }
  return null;
}

export function classifySiteForgeValidationError(error) {
  const code = String(error?.code ?? error?.reasonCode ?? '');
  const message = String(error?.message ?? '');
  const text = `${code} ${message}`;
  if (/robots_disallowed|robots-disallowed|robots excluded/iu.test(text)) {
    return normalizeSiteForgeReason('robots-disallowed');
  }
  if (code === 'seeds.empty' || code === 'siteforge-seed-discovery-empty') {
    return normalizeSiteForgeReason('empty-seed-set');
  }
  if (code === 'crawl_static.pages_empty' || code === 'siteforge-static-crawl-empty') {
    return normalizeSiteForgeReason('empty-crawl');
  }
  if (/\.nodes_empty$/u.test(code) || code === 'graph.empty' || code === 'siteforge-site-graph-empty') {
    return normalizeSiteForgeReason('empty-graph');
  }
  if (code === 'siteforge-static-evidence-unavailable') {
    return normalizeSiteForgeReason('dynamic-unsupported');
  }
  if (code === 'artifact.missing' || /^skill\.file_/u.test(code)) {
    return normalizeSiteForgeReason('artifact-missing');
  }
  return normalizeSiteForgeReason('validation-failed');
}

const REASON_PRIORITY = Object.freeze([
  'robots-disallowed',
  'robots-unavailable',
  'blocked-by-cloudflare-challenge',
  'anti-crawl-verify',
  'page-reconciliation-failed',
  'network-fetch-failed',
  'empty-seed-set',
  'empty-crawl',
  'empty-graph',
  'user-intent-unresolved',
  'capability-evidence-required',
  'artifact-missing',
  'validation-failed',
  'dynamic-unsupported',
]);

export function selectSiteForgePrimaryReason(entries, fallbackReasonCode = 'validation-failed') {
  const profiles = arrayOf(entries)
    .map((entry) => normalizeSiteForgeReason(entry?.reasonCode) ?? classifySiteForgeWarning(entry?.message) ?? classifySiteForgeValidationError(entry))
    .filter(Boolean);
  for (const reasonCode of REASON_PRIORITY) {
    const profile = profiles.find((candidate) => candidate.reasonCode === reasonCode);
    if (profile) {
      return profile;
    }
  }
  return normalizeSiteForgeReason(fallbackReasonCode);
}

function createValidationAccumulator() {
  const errors = /** @type {any[]} */ ([]);
  const warnings = /** @type {any[]} */ ([]);
  return {
    errors,
    warnings,
    fail(gate, code, message, details = /** @type {any} */ ({})) {
      const profile = details.reasonCode
        ? normalizeSiteForgeReason(details.reasonCode)
        : classifySiteForgeValidationError({ code, message });
      errors.push({
        gate,
        code,
        message,
        ...(profile ?? {}),
        ...details,
      });
    },
    warn(gate, code, message, details = /** @type {any} */ ({})) {
      const profile = details.reasonCode
        ? normalizeSiteForgeReason(details.reasonCode)
        : classifySiteForgeWarning(message);
      warnings.push({
        gate,
        code,
        message,
        ...(profile ?? {}),
        ...details,
      });
    },
  };
}

function normalizeErrorMessages(errors) {
  return errors.map((error) => error.message ?? String(error));
}

function getStage(stageResults, name) {
  return stageResults?.[name] ?? {};
}

function ingestStageWarnings(stageResults, acc) {
  for (const [stageName, stageResult] of Object.entries(stageResults ?? {})) {
    for (const warning of arrayOf(stageResult?.warnings)) {
      const profile = classifySiteForgeWarning(warning);
      acc.warn('stage', profile?.reasonCode ?? 'stage.warning', String(warning), {
        stageName,
        ...(profile ?? {}),
      });
    }
  }
}

function urlPath(urlValue) {
  try {
    return new URL(urlValue).pathname;
  } catch {
    return null;
  }
}

function isAuthorizedSourceRecord(value = /** @type {any} */ ({})) {
  return value?.sourceLayer === 'authorized_source'
    || value?.sourceAuthority
    || value?.sourceAuthorityId
    || value?.collection?.source === 'authorized_source_sanitized_summary'
    || value?.discoveredBy === 'authorized_source';
}

function validateGraphDocument(document, {
  label,
  context,
  homepageReachable,
  robotsPolicy,
  acc,
}) {
  const nodes = arrayOf(document?.nodes);
  const edges = arrayOf(document?.edges);
  const nodeIds = new Set(nodes.map((node) => node.id).filter(Boolean));

  if (!document || typeof document !== 'object') {
    acc.fail('nodes', `${label}.missing`, `${label} is missing.`);
    return {
      nodes,
      edges,
      nodeIds,
      homepagePresent: false,
      robotsAllowed: false,
      edgeRefsValid: false,
    };
  }
  if (!nodes.length) {
    acc.fail('nodes', `${label}.nodes_empty`, `${label} has no nodes.`);
  }

  for (const node of nodes) {
    try {
      assertSiteNode(node);
    } catch (error) {
      acc.fail('nodes', `${label}.node_invalid`, error?.message ?? String(error), {
        nodeId: node?.id ?? null,
      });
    }
    if (!node?.discoveredBy) {
      acc.fail('nodes', `${label}.node_missing_discovered_by`, `${label} node ${node?.id ?? '<unknown>'} is missing discoveredBy.`, {
        nodeId: node?.id ?? null,
      });
    }
    if (!hasEvidence(node?.evidence)) {
      acc.fail('nodes', `${label}.node_missing_evidence`, `${label} node ${node?.id ?? '<unknown>'} is missing evidence.`, {
        nodeId: node?.id ?? null,
      });
    }
  }

  let edgeRefsValid = true;
  for (const edge of edges) {
    if (!nodeIds.has(edge?.from) || !nodeIds.has(edge?.to)) {
      edgeRefsValid = false;
      acc.fail('nodes', `${label}.edge_missing_node`, `${label} edge ${edge?.id ?? '<unknown>'} references a missing node.`, {
        edgeId: edge?.id ?? null,
        from: edge?.from ?? null,
        to: edge?.to ?? null,
      });
    }
  }

  const homepagePresent = nodes.some((node) => (
    node.type === 'page'
    && node.normalizedUrl === context.site.rootUrl
    && (node.classification === 'homepage' || node.routePattern === '/')
  ));
  if (homepageReachable && !homepagePresent) {
    acc.fail('nodes', `${label}.homepage_missing`, `${label} is missing the reachable homepage node.`, {
      rootUrl: context.site.rootUrl,
    });
  }

  let robotsAllowed = true;
  if (robotsPolicy?.disallowPaths?.length) {
    for (const node of nodes) {
      if (isAuthorizedSourceRecord(node)) {
        continue;
      }
      const nodeUrl = node?.normalizedUrl ?? node?.url;
      if (!nodeUrl) {
        continue;
      }
      if (!isUrlAllowedByRobots(nodeUrl, robotsPolicy)) {
        robotsAllowed = false;
        acc.fail('nodes', `${label}.robots_disallowed_node`, `${label} contains robots-disallowed node ${node.id}.`, {
          nodeId: node.id,
          path: urlPath(nodeUrl),
        });
      }
    }
  }

  return {
    nodes,
    edges,
    nodeIds,
    homepagePresent,
    robotsAllowed,
    edgeRefsValid,
  };
}

function isDisabledCapability(capability) {
  return capability?.disabled === true
    || capability?.enabled === false
    || capability?.active === false
    || capability?.status === 'disabled';
}

function normalizeSetupCapabilityId(value) {
  const text = String(value ?? '').toLowerCase().trim();
  if (!text) {
    return '';
  }
  return text
    .replace(/^capability:[^:]+:/u, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

const SETUP_META_CAPABILITY_IDS = Object.freeze(new Set([
  'use-authorized-adapter',
  'unsafe-actions-disabled',
  'account-pages-disabled',
]));

function safeSetupHintForReport(value) {
  const text = String(value ?? '').trim();
  const normalized = text.toLowerCase();
  if (!normalized) {
    return null;
  }
  if (/^(?:capability|unsupported):[a-z0-9-]+$/u.test(normalized) || normalized === 'unmatched-user-hint') {
    return normalized;
  }
  return 'redacted-user-hint';
}

function safeSetupRequestLabel(request) {
  const candidate = normalizeSetupCapabilityId(request?.intentType ?? request?.id ?? request?.requestedCapability ?? request?.label);
  if (candidate && candidate !== 'unmatched-user-hint') {
    return candidate;
  }
  return safeSetupHintForReport(request?.hint) ?? 'unknown-user-hint';
}

function selectedSetupCapabilities(context) {
  return arrayOf(context?.setupProfile?.capabilityScope?.selectedCapabilities)
    .map((capability) => ({
      ...capability,
      normalizedId: normalizeSetupCapabilityId(capability.id ?? capability.name),
    }))
    .filter((capability) => (
      capability.normalizedId
      && !SETUP_META_CAPABILITY_IDS.has(capability.normalizedId)
      && capability.evidenceRequirement === 'capability-specific-evidence'
    ));
}

function capabilityMatchesSetupSelection(capability, selected) {
  const candidates = new Set([
    normalizeSetupCapabilityId(capability?.setupCapabilityId),
    normalizeSetupCapabilityId(capability?.name),
    normalizeSetupCapabilityId(capability?.object),
    normalizeSetupCapabilityId(capability?.id),
  ].filter(Boolean));
  return candidates.has(selected.normalizedId);
}

function validateSetupIntentCoverage({
  context,
  capabilities,
  activeCapabilities,
  acc,
}) {
  const coverage = context?.setupProfile?.userIntentCoverage ?? null;
  if (!coverage && arrayOf(context?.setupProfile?.userHints).length) {
    acc.fail('intents', 'intent.user_hint_coverage_missing', 'Setup profile has user hints but no userIntentCoverage record.', {
      ...normalizeSiteForgeReason('user-intent-unresolved'),
      hints: arrayOf(context?.setupProfile?.userHints)
        .map((hint) => safeSetupHintForReport(hint))
        .filter(Boolean),
    });
    return;
  }
  for (const request of arrayOf(coverage?.unsupportedRequests)) {
    const safeLabel = safeSetupRequestLabel(request);
    acc.fail('intents', 'intent.user_hint_unsupported', `User setup hint is unsupported by current evidence: ${safeLabel}.`, {
      ...normalizeSiteForgeReason('user-intent-unresolved'),
      hint: safeSetupHintForReport(request.hint),
      requestedCapability: safeLabel,
    });
  }
  for (const request of arrayOf(coverage?.unmatchedRequests)) {
    const safeHint = safeSetupHintForReport(request.hint);
    acc.warn('intents', 'intent.user_hint_unmatched', `User setup hint did not map to an evidence-backed capability: ${safeHint ?? 'unknown-user-hint'}.`, {
      reasonCode: 'user-intent-unresolved',
      hint: safeHint,
    });
  }

  for (const selected of selectedSetupCapabilities(context)) {
    const matchingCapabilities = capabilities.filter((capability) => capabilityMatchesSetupSelection(capability, selected));
    const activeMatch = activeCapabilities.find((capability) => capabilityMatchesSetupSelection(capability, selected));
    if (activeMatch) {
      continue;
    }
    const candidate = matchingCapabilities.find((capability) => capability.status === 'candidate');
    if (
      context?.crawlContract?.crawlMode === 'public_only'
      && candidate
      && (
        candidate.authRequired === true
        || ['missing_auth_evidence', 'requires_login'].includes(candidate.activationBlockedReason)
        || candidate.evidenceMatrix?.activationDecision === 'requires_login'
      )
    ) {
      acc.warn('capabilities', 'capability.selected_requires_login_candidate', `Selected setup capability ${selected.id ?? selected.name} requires login evidence and remains a public-only candidate.`, {
        setupCapabilityId: selected.id ?? null,
        candidateCapabilityId: candidate.id ?? null,
        activationBlockedReason: candidate.activationBlockedReason ?? 'missing_auth_evidence',
      });
      continue;
    }
    acc.fail('capabilities', 'capability.selected_not_active', `Selected setup capability ${selected.id ?? selected.name} is not active because it lacks capability-specific evidence.`, {
      ...normalizeSiteForgeReason('capability-evidence-required'),
      setupCapabilityId: selected.id ?? null,
      candidateCapabilityId: candidate?.id ?? null,
      activationBlockedReason: candidate?.activationBlockedReason ?? 'capability-specific-evidence-required',
    });
  }
}

export function isHighRiskCapability(capability) {
  return (
    ['requires_confirmation', 'state_changing', 'payment', 'destructive'].includes(capability?.safetyLevel)
    || ['submit', 'upload', 'book', 'purchase', 'login', 'register', 'manage', 'contact'].includes(capability?.action)
    || /comment|login|account|upload|payment|purchase|checkout|delete|mutation|contact/iu.test(`${capability?.name ?? ''} ${capability?.object ?? ''}`)
  );
}

export function validateCapabilitySafetyForVerification(capability) {
  const errors = /** @type {any[]} */ ([]);
  if (capability?.status !== 'active' || !isHighRiskCapability(capability)) {
    return errors;
  }
  const plan = capability.executionPlan;
  if (!plan?.dryRunOnly && !plan?.requiresConfirmation) {
    errors.push(`High-risk capability ${capability.id} lacks dry-run or confirmation requirement.`);
  }
  if (plan?.autoExecute === true) {
    errors.push(`High-risk capability ${capability.id} attempts unsafe auto-execution.`);
  }
  return errors;
}

function validateCapabilityMap({
  affordances,
  capabilities,
  executionPlans,
  nodeIds,
  successfulBuild,
  context,
  acc,
}) {
  const executionPlanIds = new Set(executionPlans.map((plan) => plan.id).filter(Boolean));
  const capabilityById = new Map(capabilities.map((capability) => [capability.id, capability]));
  const activeCapabilities = capabilities.filter((capability) => capability.status === 'active');
  const disabledCapabilities = capabilities.filter((capability) => capability.status === 'disabled');
  const remediationCapabilities = capabilities.filter((capability) => (
    capability.status !== 'active'
    || capability.enabled_status === 'disabled'
    || capability.activationBlockedReason
    || capability.disabledReason
  ));

  if (!affordances.length) {
    acc.fail('capabilities', 'affordances.empty', 'Affordance map is missing or empty.');
  }
  if (!capabilities.length) {
    acc.fail('capabilities', 'capabilities.empty', 'Capability map is missing or empty.');
  }
  if (successfulBuild && activeCapabilities.length < 1) {
    acc.fail('capabilities', 'capabilities.no_active', 'Successful builds require at least one active capability.');
  }

  for (const affordance of affordances) {
    try {
      assertAffordance(affordance);
    } catch (error) {
      acc.fail('capabilities', 'affordance.invalid', error?.message ?? String(error), {
        affordanceId: affordance?.id ?? null,
      });
    }
    if (affordance?.nodeId && !nodeIds.has(affordance.nodeId)) {
      acc.fail('capabilities', 'affordance.missing_node', `Affordance ${affordance.id} references missing node ${affordance.nodeId}.`, {
        affordanceId: affordance.id,
        nodeId: affordance.nodeId,
      });
    }
  }

  for (const capability of capabilities) {
    try {
      assertCapability(capability);
    } catch (error) {
      acc.fail('capabilities', 'capability.invalid', error?.message ?? String(error), {
        capabilityId: capability?.id ?? null,
      });
    }
    if (capability?.status === 'active' && isDisabledCapability(capability)) {
      acc.fail('capabilities', 'capability.disabled_active', `Disabled capability ${capability.id} must not be active.`, {
        capabilityId: capability.id,
      });
    }
    const matrix = capability?.evidenceMatrix ?? capability?.activationEvidence ?? null;
    if (capability?.status === 'active') {
      if (!matrix || typeof matrix !== 'object') {
        acc.fail('capabilities', 'capability.matrix_missing', `Active capability ${capability.id} lacks an evidence matrix.`, {
          capabilityId: capability.id,
        });
      } else {
        const missingEvidence = arrayOf(matrix.missingEvidence);
        if (missingEvidence.length > 0) {
          acc.fail('capabilities', 'capability.matrix_incomplete', `Active capability ${capability.id} has incomplete evidence matrix.`, {
            capabilityId: capability.id,
            missingEvidence,
          });
        }
        if (matrix.authRequired === true || capability.authRequired === true) {
          if (!canRunAuthenticatedLayer(context?.authStateReport)) {
            acc.fail('capabilities', 'capability.active_missing_auth_state', `Login capability ${capability.id} is active without verified auth state.`, {
              capabilityId: capability.id,
              authVerificationStatus: context?.authStateReport?.authVerificationStatus ?? null,
            });
          }
          if (evidenceLevelRank(matrix.observedEvidenceLevel) < evidenceLevelRank(matrix.requiredEvidenceLevel)) {
            acc.fail('capabilities', 'capability.auth_evidence_too_low', `Login capability ${capability.id} lacks required capability evidence level.`, {
              capabilityId: capability.id,
              requiredEvidenceLevel: matrix.requiredEvidenceLevel ?? null,
              observedEvidenceLevel: matrix.observedEvidenceLevel ?? null,
            });
          }
        }
      }
    }
    for (const evidenceError of validateCapabilityEvidenceList(capability?.evidence)) {
      acc.fail('safety', 'capability.evidence_privacy_policy_invalid', `Capability ${capability?.id ?? '<unknown>'} evidence must be sanitized summary only.`, {
        capabilityId: capability?.id ?? null,
        evidenceIndex: evidenceError.index,
        evidencePolicyCode: evidenceError.code,
        expectedSavedMaterial: SANITIZED_SUMMARY_ONLY,
      });
    }
    for (const policyError of validateExecutionPlanAgainstRiskPolicy(capability)) {
      acc.fail('safety', policyError.code, policyError.message, {
        capabilityId: capability?.id ?? null,
        forcedDisabledActions: policyError.forcedDisabledActions ?? [],
      });
    }
    if (remediationCapabilities.includes(capability)) {
      const explicitRemediation = capability.safe_remediation
        ?? (typeof capability.safe_remediation_path === 'object' ? capability.safe_remediation_path : null)
        ?? (typeof capability.safe_remediation_path === 'string' ? { path: capability.safe_remediation_path } : null)
        ?? null;
      for (const remediationError of validateCapabilitySafeRemediationPath(capability, explicitRemediation ?? undefined)) {
        acc.fail('safety', remediationError.code, remediationError.message, {
          capabilityId: capability?.id ?? null,
          safeRemediationPath: remediationError.path ?? null,
          forcedDisabledActions: remediationError.forcedDisabledActions ?? [],
        });
      }
    }
    if (capability?.status !== 'active') {
      if (capability?.executionPlan) {
        acc.fail('capabilities', 'capability.inactive_has_plan', `Inactive capability ${capability.id} must not carry an executionPlan.`, {
          capabilityId: capability.id,
          status: capability.status ?? null,
          executionPlanId: capability.executionPlan?.id ?? null,
        });
      }
      continue;
    }
    if (!hasEvidence(capability.evidence)) {
      acc.fail('capabilities', 'capability.active_missing_evidence', `Active capability ${capability.id} lacks evidence.`, {
        capabilityId: capability.id,
      });
    }
    if (capability.requiresCapabilityEvidence === true && capability.capabilityVerified !== true) {
      acc.fail('capabilities', 'capability.active_lacks_capability_specific_evidence', `Active capability ${capability.id} requires capability-specific evidence before promotion.`, {
        ...normalizeSiteForgeReason('capability-evidence-required'),
        capabilityId: capability.id,
        setupCapabilityId: capability.setupCapabilityId ?? null,
      });
    }
    if (capability.informational !== true) {
      if (!Array.isArray(capability.entryNodeIds) || capability.entryNodeIds.length === 0) {
        acc.fail('capabilities', 'capability.active_missing_source_nodes', `Active actionable capability ${capability.id} lacks source nodes.`, {
          capabilityId: capability.id,
        });
      }
      if (!capability.executionPlan) {
        acc.fail('capabilities', 'capability.actionable_missing_plan', `Active actionable capability ${capability.id} lacks executionPlan.`, {
          capabilityId: capability.id,
        });
      }
    }
    for (const nodeId of [...arrayOf(capability.entryNodeIds), ...arrayOf(capability.requiredNodeIds)]) {
      if (!nodeIds.has(nodeId)) {
        acc.fail('capabilities', 'capability.missing_node', `Capability ${capability.id} references missing node ${nodeId}.`, {
          capabilityId: capability.id,
          nodeId,
        });
      }
    }
    if (capability.executionPlan && !executionPlanIds.has(capability.executionPlan.id)) {
      acc.fail('capabilities', 'capability.plan_not_in_artifact', `Capability ${capability.id} execution plan is missing from execution_plans.json.`, {
        capabilityId: capability.id,
        executionPlanId: capability.executionPlan.id,
      });
    }
    for (const message of validateCapabilitySafetyForVerification(capability)) {
      acc.fail('safety', 'capability.high_risk_auto_execution', message, {
        capabilityId: capability.id,
      });
    }
  }

  for (const plan of executionPlans) {
    const planCapability = capabilityById.get(plan?.capabilityId);
    if (!plan?.capabilityId || !planCapability) {
      acc.fail('capabilities', 'execution_plan.missing_capability', `Execution plan ${plan?.id ?? '<unknown>'} references a missing capability.`, {
        executionPlanId: plan?.id ?? null,
        capabilityId: plan?.capabilityId ?? null,
      });
    } else if (planCapability.status !== 'active') {
      acc.fail('capabilities', 'execution_plan.inactive_capability', `Execution plan ${plan?.id ?? '<unknown>'} references inactive capability ${planCapability.id}.`, {
        executionPlanId: plan?.id ?? null,
        capabilityId: planCapability.id,
        status: planCapability.status ?? null,
      });
    }
    for (const step of arrayOf(plan?.steps)) {
      if (step?.nodeId && !nodeIds.has(step.nodeId)) {
        acc.fail('capabilities', 'execution_plan.step_missing_node', `Execution plan ${plan.id} step references missing node ${step.nodeId}.`, {
          executionPlanId: plan.id,
          nodeId: step.nodeId,
        });
      }
      if (step?.autoExecute === true) {
        acc.fail('safety', 'execution_plan.step_auto_execute', `Execution plan ${plan.id} contains an auto-execute step.`, {
          executionPlanId: plan.id,
        });
      }
    }
  }

  return {
    activeCapabilities,
    disabledCapabilities,
    executionPlanIds,
    safeRemediation: safeRemediationPathSummary(remediationCapabilities),
  };
}

function validateUserIntents({
  intents,
  capabilities,
  activeCapabilities,
  acc,
}) {
  const capabilityIds = new Set(capabilities.map((capability) => capability.id).filter(Boolean));
  const capabilityById = new Map(capabilities.map((capability) => [capability.id, capability]));
  const activeCapabilityIds = new Set(activeCapabilities.map((capability) => capability.id).filter(Boolean));
  const isAllowedNonCallableIntent = (intent, capability) => {
    const enabledStatus = intent?.enabled_status ?? capability?.enabled_status ?? null;
    return intent?.callable === false
      && ['disabled', 'debug_only', 'candidate_debug_only'].includes(enabledStatus)
      && capability?.status !== 'active';
  };
  const hasExplicitSafePath = (intent, capability) => {
    const remediation = intent?.safe_remediation
      ?? capability?.safe_remediation
      ?? (intent?.safe_remediation_path ? { path: intent.safe_remediation_path } : null)
      ?? (capability?.safe_remediation_path ? { path: capability.safe_remediation_path } : null);
    return Boolean(remediation?.path);
  };

  if (!intents.length) {
    acc.fail('intents', 'intents.empty', 'User intents are missing or empty.');
  }

  for (const intent of intents) {
    try {
      assertUserIntent(intent, capabilityIds);
    } catch (error) {
      acc.fail('intents', 'intent.invalid', error?.message ?? String(error), {
        intentId: intent?.id ?? null,
      });
    }
    if (!Array.isArray(intent?.utteranceExamples) || intent.utteranceExamples.length === 0) {
      acc.fail('intents', 'intent.missing_utterance_examples', `Intent ${intent?.id ?? '<unknown>'} lacks utterance examples.`, {
        intentId: intent?.id ?? null,
      });
    }
    if (!Array.isArray(intent?.negativeExamples) || intent.negativeExamples.length === 0) {
      acc.fail('intents', 'intent.missing_negative_examples', `Intent ${intent?.id ?? '<unknown>'} lacks negative examples.`, {
        intentId: intent?.id ?? null,
      });
    }
    const capability = capabilityById.get(intent?.capabilityId);
    if (capability && intent.safetyLevel !== capability.safetyLevel) {
      acc.fail('intents', 'intent.safety_mismatch', `Intent ${intent.id} safetyLevel does not match capability ${capability.id}.`, {
        intentId: intent.id,
        capabilityId: capability.id,
      });
    }
    if (capability && !activeCapabilityIds.has(capability.id) && !isAllowedNonCallableIntent(intent, capability)) {
      acc.fail('intents', 'intent.references_inactive_capability', `Intent ${intent.id} references inactive capability ${capability.id}.`, {
        intentId: intent.id,
        capabilityId: capability.id,
        status: capability.status ?? null,
      });
    }
    if (capability && intent?.callable === false && !hasExplicitSafePath(intent, capability)) {
      acc.fail('intents', 'intent.non_callable_missing_safe_path', `Non-callable intent ${intent.id} must point to an explicit safe-path capability record.`, {
        intentId: intent.id,
        capabilityId: capability.id,
        enabledStatus: intent.enabled_status ?? capability.enabled_status ?? null,
      });
    }
  }

  for (const capability of activeCapabilities) {
    if (!intents.some((intent) => intent.capabilityId === capability.id)) {
      acc.fail('intents', 'intent.missing_for_active_capability', `No intent maps to active capability ${capability.id}.`, {
        capabilityId: capability.id,
      });
    }
  }
}

function validateRegistryLookup({
  context,
  capabilities,
  executionPlanIds,
  candidateRegistry,
  invocationProbe,
  acc,
}) {
  if (!candidateRegistry) {
    acc.fail('registry', 'registry.missing_candidate', 'Candidate skill registry is missing.');
    return {
      status: 'not_found',
      domain: invocationProbe?.domain ?? null,
      utterance: invocationProbe?.utterance ?? null,
      skillId: null,
      intentId: null,
      capabilityId: null,
    };
  }
  const invocation = lookupSkillIntentFromRegistry(candidateRegistry, {
    domain: invocationProbe?.domain,
    utterance: invocationProbe?.utterance,
  });
  if (invocation.status !== 'found') {
    acc.fail('registry', 'registry.lookup_not_found', 'Registry lookup did not resolve the generated domain and utterance.', {
      domain: invocationProbe?.domain ?? null,
      utterance: invocationProbe?.utterance ?? null,
    });
    return invocation;
  }
  if (invocation.skillId !== context.skillId) {
    acc.fail('registry', 'registry.lookup_wrong_skill', `Registry lookup resolved ${invocation.skillId} instead of ${context.skillId}.`, {
      expectedSkillId: context.skillId,
      actualSkillId: invocation.skillId,
    });
  }
  const capability = capabilities.find((candidate) => candidate.id === invocation.capabilityId);
  if (!capability) {
    acc.fail('registry', 'registry.lookup_missing_capability', `Registry lookup capability ${invocation.capabilityId} is missing.`, {
      capabilityId: invocation.capabilityId,
    });
  }
  if (capability && capability.status !== 'active') {
    acc.fail('registry', 'registry.lookup_inactive_capability', `Registry lookup resolved inactive capability ${capability.id}.`, {
      capabilityId: capability.id,
      status: capability.status ?? null,
      intentId: invocation.intentId ?? null,
    });
  }
  const invocationExecutionPlanId = /** @type {any} */ (invocation).executionPlanId;
  if (capability?.status === 'active' && capability.informational !== true && !executionPlanIds.has(invocationExecutionPlanId)) {
    acc.fail('registry', 'registry.lookup_missing_execution_plan', `Registry lookup execution plan ${invocationExecutionPlanId} is missing.`, {
      executionPlanId: invocationExecutionPlanId,
      capabilityId: invocation.capabilityId,
    });
  }
  return invocation;
}

export async function createSiteForgeOutputValidationReport(context, stageResults, {
  artifactExists,
  requiredArtifacts = SITEFORGE_REQUIRED_PRE_PROMOTION_ARTIFACTS,
  candidateRegistry = null,
  invocationProbe = null,
  successfulBuild = true,
} = /** @type {any} */ ({})) {
  const acc = createValidationAccumulator();
  const exists = artifactExists ?? (async () => false);
  const missingArtifacts = /** @type {any[]} */ ([]);
  for (const artifactName of requiredArtifacts) {
    const artifactPath = path.join(context.artifactDir, artifactName);
    if (!await exists(artifactPath)) {
      missingArtifacts.push(artifactName);
      acc.fail('artifacts', 'artifact.missing', `Required artifact missing: ${artifactName}`, {
        artifactName,
        artifactRef: sanitizeEvidenceRef(artifactPath),
      });
    }
  }

  const crawlStatic = getStage(stageResults, 'crawlStatic');
  const crawlAuthenticated = getStage(stageResults, 'crawlAuthenticated');
  const crawlRendered = getStage(stageResults, 'crawlRendered');
  const discoverSeeds = getStage(stageResults, 'discoverSeeds');
  ingestStageWarnings(stageResults, acc);
  const staticPages = arrayOf(crawlStatic.pages);
  const authenticatedPages = [
    ...arrayOf(crawlAuthenticated.authenticatedPages),
    ...arrayOf(crawlAuthenticated.authenticatedOverlayPages),
  ];
  const publicRenderedPages = arrayOf(crawlRendered.publicRenderedPages).length
    ? arrayOf(crawlRendered.publicRenderedPages)
    : arrayOf(crawlRendered.pages);
  const alternativePageEvidenceCount = authenticatedPages.length + publicRenderedPages.length;
  const authorizedSourcePages = staticPages.filter(isAuthorizedSourceRecord);
  if (!arrayOf(discoverSeeds.seeds).length && !authorizedSourcePages.length) {
    acc.fail('nodes', 'seeds.empty', 'Seed discovery produced no crawlable URLs.', {
      ...(arrayOf(discoverSeeds.robotsExcludedUrls).length ? normalizeSiteForgeReason('robots-disallowed') : normalizeSiteForgeReason('empty-seed-set')),
      excludedUrls: arrayOf(discoverSeeds.robotsExcludedUrls),
    });
  }
  if (!staticPages.length && alternativePageEvidenceCount <= 0) {
    const warningReason = selectSiteForgePrimaryReason(
      arrayOf(crawlStatic.warnings).map((warning) => ({ message: warning })),
      'empty-crawl',
    );
    acc.fail('nodes', 'crawl_static.pages_empty', 'Static crawl produced no pages.', {
      ...(warningReason?.reasonCode === 'validation-failed' ? normalizeSiteForgeReason('empty-crawl') : warningReason),
    });
  }
  const homepageReachable = staticPages.some((page) => page.normalizedUrl === context.site.rootUrl);
  const robotsPolicy = discoverSeeds.robotsPolicy ?? null;
  const robotsStatus = discoverSeeds.robots?.status ?? (robotsPolicy ? 'parsed' : 'unknown');
  const liveRobotsRequired = Boolean(context?.source);
  if (liveRobotsRequired && robotsStatus !== 'parsed') {
    acc.fail('nodes', 'robots.unavailable', `Live build requires fetched robots.txt before validation; status was ${robotsStatus}.`, {
      status: robotsStatus,
      reason: discoverSeeds.robots?.reason ?? null,
      ...normalizeSiteForgeReason('robots-unavailable'),
    });
  }
  if (robotsPolicy?.disallowPaths?.length) {
    for (const seed of arrayOf(discoverSeeds.seeds)) {
      if (isAuthorizedSourceRecord(seed)) {
        continue;
      }
      const seedUrl = seed?.normalizedUrl ?? seed?.url;
      if (seedUrl && !isUrlAllowedByRobots(seedUrl, robotsPolicy)) {
        acc.fail('nodes', 'seeds.robots_disallowed', `Seed list contains robots-disallowed URL ${seedUrl}.`, {
          url: seedUrl,
          path: urlPath(seedUrl),
        });
      }
    }
    for (const page of arrayOf(crawlStatic.pages)) {
      if (isAuthorizedSourceRecord(page)) {
        continue;
      }
      const pageUrl = page?.normalizedUrl ?? page?.url;
      if (pageUrl && !isUrlAllowedByRobots(pageUrl, robotsPolicy)) {
        acc.fail('nodes', 'crawl_static.robots_disallowed', `Crawl output contains robots-disallowed URL ${pageUrl}.`, {
          url: pageUrl,
          path: urlPath(pageUrl),
        });
      }
    }
  }
  const graphGate = validateGraphDocument(getStage(stageResults, 'buildSiteGraph').graph, {
    label: 'graph.json',
    context,
    homepageReachable,
    robotsPolicy,
    acc,
  });
  const classifiedGraphGate = validateGraphDocument(getStage(stageResults, 'classifyNodes').graph, {
    label: 'classified_graph.json',
    context,
    homepageReachable,
    robotsPolicy,
    acc,
  });

  const duplicateRatio = Number(crawlStatic.summary?.duplicateRatio);
  const duplicateRatioComputable = Number.isFinite(duplicateRatio);
  if (duplicateRatioComputable && duplicateRatio > OUTPUT_VALIDATION_DUPLICATE_RATIO_THRESHOLD) {
    acc.fail('nodes', 'nodes.duplicate_ratio_exceeded', `Duplicate ratio ${duplicateRatio} exceeds ${OUTPUT_VALIDATION_DUPLICATE_RATIO_THRESHOLD}.`, {
      duplicateRatio,
      threshold: OUTPUT_VALIDATION_DUPLICATE_RATIO_THRESHOLD,
    });
  }
  const robotsCrawlDelaySeconds = Number(discoverSeeds.robots?.crawlDelaySeconds);
  if (Number.isFinite(robotsCrawlDelaySeconds) && robotsCrawlDelaySeconds > 0) {
    if (Number(crawlStatic.summary?.collectionConcurrency) !== 1) {
      acc.fail('nodes', 'robots.crawl_delay_concurrency', 'Static crawl must serialize requests when robots.txt declares crawl-delay.', {
        crawlDelaySeconds: robotsCrawlDelaySeconds,
        collectionConcurrency: crawlStatic.summary?.collectionConcurrency ?? null,
      });
    }
    if (!Number.isFinite(Number(crawlStatic.summary?.effectiveCrawlFetchDelayMs))) {
      acc.fail('nodes', 'robots.crawl_delay_missing_effective_delay', 'Static crawl summary is missing effective crawl-delay timing.', {
        crawlDelaySeconds: robotsCrawlDelaySeconds,
      });
    }
  }

  const capabilities = arrayOf(getStage(stageResults, 'discoverCapabilities').capabilities);
  const executionPlans = arrayOf(getStage(stageResults, 'discoverCapabilities').executionPlans);
  const affordances = arrayOf(getStage(stageResults, 'extractAffordances').affordances);
  const capabilityGate = validateCapabilityMap({
    affordances,
    capabilities,
    executionPlans,
    nodeIds: classifiedGraphGate.nodeIds.size ? classifiedGraphGate.nodeIds : graphGate.nodeIds,
    successfulBuild,
    context,
    acc,
  });

  const intents = arrayOf(getStage(stageResults, 'generateIntents').intents);
  validateUserIntents({
    intents,
    capabilities,
    activeCapabilities: capabilityGate.activeCapabilities,
    acc,
  });
  validateSetupIntentCoverage({
    context,
    capabilities,
    activeCapabilities: capabilityGate.activeCapabilities,
    acc,
  });

  const skillPaths = getStage(stageResults, 'generateSkill').skillPaths ?? {};
  const missingSkillFiles = /** @type {any[]} */ ([]);
  for (const [name, filePath] of Object.entries(skillPaths)) {
    if (!filePath) {
      missingSkillFiles.push(name);
      acc.fail('skill', 'skill.file_path_missing', `Generated skill path ${name} is missing.`, {
        skillPathName: name,
      });
      continue;
    }
    if (!await exists(filePath)) {
      missingSkillFiles.push(name);
      acc.fail('skill', 'skill.file_missing', `Generated skill file ${name} is missing.`, {
        skillPathName: name,
        fileRef: sanitizeEvidenceRef(filePath),
      });
    }
  }

  const invocation = validateRegistryLookup({
    context,
    capabilities,
    executionPlanIds: capabilityGate.executionPlanIds,
    candidateRegistry,
    invocationProbe,
    acc,
  });

  const activeHighRiskCapabilities = capabilityGate.activeCapabilities.filter(isHighRiskCapability);
  const primaryFailure = acc.errors.length
    ? selectSiteForgePrimaryReason(acc.errors)
    : null;
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    skillId: context.skillId,
    status: acc.errors.length === 0 ? 'passed' : 'failed',
    mode: 'pre_promotion',
    failureClass: primaryFailure?.failureClass ?? null,
    reasonCode: primaryFailure?.reasonCode ?? null,
    reasonAction: primaryFailure?.action ?? null,
    warningCodes: uniqueStrings(acc.warnings.map((warning) => warning.reasonCode)),
    errors: normalizeErrorMessages(acc.errors),
    errorDetails: acc.errors,
    warnings: normalizeErrorMessages(acc.warnings),
    warningDetails: acc.warnings,
    gates: {
      requiredArtifacts: {
        passed: missingArtifacts.length === 0,
        checked: [...requiredArtifacts],
        missing: missingArtifacts,
        finalArtifacts: [...SITEFORGE_REQUIRED_FINAL_ARTIFACTS],
        deferredUntilBuildReport: [
          'verification_report.json',
          'build_report.user.json',
          'build_report.user.md',
          'build_report.debug.json',
          'build_report.json',
          'capability_intent_summary.html',
          'page_reconciliation_report.json',
        ],
      },
      nodeCompleteness: {
        passed: !acc.errors.some((error) => error.gate === 'nodes'),
        graphExists: Boolean(getStage(stageResults, 'buildSiteGraph').graph),
        classifiedGraphExists: Boolean(getStage(stageResults, 'classifyNodes').graph),
        pageEvidenceAvailable: staticPages.length + alternativePageEvidenceCount > 0,
        staticPages: staticPages.length,
        authenticatedPages: authenticatedPages.length,
        publicRenderedPages: publicRenderedPages.length,
        homepageReachable,
        homepagePresent: classifiedGraphGate.homepagePresent || graphGate.homepagePresent,
        edgeRefsValid: graphGate.edgeRefsValid && classifiedGraphGate.edgeRefsValid,
        robotsDisallowedAbsent: graphGate.robotsAllowed && classifiedGraphGate.robotsAllowed,
        duplicateRatio: duplicateRatioComputable ? duplicateRatio : null,
        duplicateRatioThreshold: OUTPUT_VALIDATION_DUPLICATE_RATIO_THRESHOLD,
      },
      capabilityMap: {
        passed: !acc.errors.some((error) => error.gate === 'capabilities'),
        affordanceCount: affordances.length,
        capabilityCount: capabilities.length,
        activeCapabilityCount: capabilityGate.activeCapabilities.length,
        disabledCapabilityCount: capabilityGate.disabledCapabilities.length,
        executionPlanCount: executionPlans.length,
        riskPolicy: riskPolicySummary(capabilities),
        safeRemediation: capabilityGate.safeRemediation,
      },
      userIntents: {
        passed: !acc.errors.some((error) => error.gate === 'intents'),
        intentCount: intents.length,
      },
      skillArtifacts: {
        passed: missingSkillFiles.length === 0,
        missing: missingSkillFiles,
      },
      safety: {
        passed: !acc.errors.some((error) => error.gate === 'safety'),
        highRiskActiveCapabilityCount: activeHighRiskCapabilities.length,
        highRiskAutoExecutable: activeHighRiskCapabilities.some((capability) => capability.executionPlan?.autoExecute === true),
        savedMaterial: SANITIZED_SUMMARY_ONLY,
        rawContentSaved: false,
        privateContentSaved: false,
        disabledHighRiskCapabilityCount: capabilities.filter((capability) => capability.status === 'disabled').length,
      },
      registryLookup: invocation,
    },
  };
}
