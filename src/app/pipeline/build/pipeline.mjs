// @ts-check

import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import { displayPath } from '../../../infra/cli/path-display.mjs';
import { buildStatusLabel, verificationStatusLabel } from './status-labels.mjs';
import { openBrowserSession } from '../../../infra/browser/session.mjs';
import { pathExists } from '../../../infra/io.mjs';
import { jsonClone } from '../../../shared/clone.mjs';
import { mapWithConcurrency } from '../../../shared/concurrency.mjs';
import { slugifyAscii, uniqueSortedStrings } from '../../../shared/normalize.mjs';
import {
  policySupportsCapabilityFamily,
} from '../../../sites/registry/core/capability-intent-mapping.mjs';
import {
  assertNoForbiddenPatterns,
  prepareRedactedArtifactJsonWithAudit,
} from '../../../domain/sessions/security-guard.mjs';
import {
  summarizeObservedRequestApiCandidateFiltering,
  validateApiCandidateWithAdapter,
  writeApiCandidateArtifactsFromObservedRequests,
} from '../../../domain/capabilities/api-discovery.mjs';
import { resolveSiteAdapter } from '../../../sites/adapters/resolver.mjs';
import {
  ensureBuildDirectories,
  readJsonIfExists,
  writeArtifactJson,
  writeArtifactText,
  writeGeneratedJson,
  writeSkillJson,
  writeSkillText,
} from './artifact-store.mjs';
import { assertBuildProfileSafe } from './build-profile-safety.mjs';
import {
  reusableBuildProfileAuthStateReport,
  reusableBuildProfileCrawlContract,
} from './build-profile-reuse.mjs';
import { siteRecordWithKnownAdapterAllowedDomains } from './site-record-hosts.mjs';
import {
  assertAffordance,
  assertCapability,
  assertSiteNode,
  assertUserIntent,
  assertSafeBuildPathSegment,
  buildArtifactDir,
  buildEvidence,
  BUILD_SCHEMA_VERSION,
  createSiteRecord,
  formatBuildId,
  isInternalUrl,
  isSameSiteUrl,
  mergeBuildPolicy,
  normalizeUrl,
  rootUrlFrom,
  stableCapabilityId,
  stableNodeId,
} from './models.mjs';
import {
  classifySiteForgeWarning,
  createSiteForgeOutputValidationReport,
  isHighRiskCapability,
  normalizeSiteForgeReason,
  selectSiteForgePrimaryReason,
  validateCapabilitySafetyForVerification,
} from './output-validation.mjs';
import { renderSiteForgeUserBuildSummary as renderFriendlySiteForgeUserBuildSummary } from './user-report.mjs';
import {
  enrichAutoCapability,
  generateAutoCapabilities,
  generateAutoIntentRecords,
} from './auto-capabilities.mjs';
import {
  buildConfirmationPaths,
  decorateCapabilityConfirmation,
  shouldSkipInStrictPrivacy,
} from './confirmation-flow.mjs';
import {
  FORCED_DISABLED_ACTIONS,
  SANITIZED_SUMMARY_ONLY,
  applyCapabilityRiskPolicy,
  findForcedDisabledActions,
  isReadOnlyFollowSurface,
  normalizeCapabilityEnablementStatus,
  publicSafeRemediation,
  riskPolicySummary,
  sanitizeEvidenceRef,
} from './risk-policy.mjs';
import {
  AUDIT_LOG_ARTIFACT,
  EXECUTION_CONTRACTS_ARTIFACT,
  EXECUTION_GOVERNANCE_ARTIFACT,
  RUNTIME_DISPATCH_REPORT_ARTIFACT,
  RUNTIME_EXECUTION_REPORT_ARTIFACT,
  attachExecutionContractRefs,
  buildExecutionAuditLog,
  buildExecutionContracts,
  buildRuntimeDispatchReport,
  buildRuntimeExecutionReport,
  evaluateExecutionGovernance,
} from './execution-governance.mjs';
import {
  executeRuntimeInvocation,
} from '../../runtime/index.mjs';
import {
  extractElementInstances,
  isUrlAllowedByRobots,
  parseHtmlDocument,
  parseRobotsPolicy,
  parseRobotsSitemaps,
  parseSitemapUrls,
  robotsDecisionForUrl,
  routePatternForUrl,
  selectRobotsGroups,
  stripHtml,
} from './html.mjs';
import {
  createSocialSpaAutoDiscoverySummary,
  mergeAutoDiscoveryPages,
} from './auto-discovery.mjs';
import { createBuildSource } from './source.mjs';
import {
  createEmptySkillRegistry,
  lookupSkillIntentFromRegistry,
  readSkillRegistry,
  upsertSkillRegistryRecord,
} from './skill-registry.mjs';
import {
  createSiteWorkspace,
  ensureSiteWorkspace,
  finalizeRetainedCurrentPromotion,
  promoteVerifiedBuild,
  readLastSuccessfulBuild,
  rollbackRetainedCurrentPromotion,
  writeLastSuccessfulBuild,
} from './workspace.mjs';
import {
  SITEFORGE_CAPABILITY_INTENT_SUMMARY_HTML_FILE as CAPABILITY_INTENT_SUMMARY_HTML_FILE,
  SITEFORGE_DEBUG_REPORT_FILE as DEBUG_REPORT_FILE,
  SITEFORGE_DEBUG_REPORT_JSON_ALIAS as DEBUG_REPORT_JSON_ALIAS,
  SITEFORGE_INDEX_REPORT_FILE as INDEX_REPORT_FILE,
  SITEFORGE_REQUIRED_ARTIFACTS as REQUIRED_ARTIFACTS,
  SITEFORGE_USER_REPORT_FILE as USER_REPORT_FILE,
  SITEFORGE_USER_REPORT_JSON_ALIAS as USER_REPORT_JSON_ALIAS,
  SITEFORGE_USER_REPORT_MARKDOWN_ALIAS as USER_REPORT_MARKDOWN_ALIAS,
  SITEFORGE_USER_REPORT_MARKDOWN_FILE as USER_REPORT_MARKDOWN_FILE,
} from './artifact-contract.mjs';
import {
  AUTH_STATE_REPORT_FILE,
  CRAWL_AUTHENTICATED_FILE,
  attachAuthRuntimeMaterial,
  authRuntimeMaterialFrom,
  authSummaryForReport,
  canRunAuthenticatedLayer,
  createCrawlContract,
  createPublicOnlyAuthStateReport,
  normalizeAuthStateReport,
  openSystemDefaultBrowser,
  runDefaultBrowserAuthStateCheck,
  sanitizeRouteTargetForPersistence,
} from './auth-state.mjs';
import {
  canUseEvidenceProvider,
  evidenceBundlesFromStageResults,
  evidenceCoverageFromBundles,
  normalizeEvidenceBundle,
} from './evidence-provider.mjs';
import {
  RUNTIME_MODES,
  bridgeRuntimeMetadata,
  genericHttpRuntimeMetadata,
  registryIntentRuntimeMetadata,
} from './runtime-provider.mjs';
import { runBrowserBridgeApiReplay } from './browser-auth-bridge.mjs';
import {
  SITEFORGE_BUILD_STAGE_DEPENDENCIES as STAGE_DEPENDENCIES,
  SITEFORGE_BUILD_STAGE_NAMES,
  assertSiteForgeBuildStagePlan,
} from './stage-plan.mjs';
import {
  createStageSubstepRecords,
  siteForgeBuildStageSubsteps,
} from './stage-substeps.mjs';
import {
  buildReportWarningSummary,
  buildStageRecord,
  classifyBuildFailure,
} from './build-stage-report.mjs';
import {
  AUTHORIZED_SOURCE_MANIFEST_FILE,
  AUTHORIZED_SOURCE_MANIFEST_RELATIVE_PATH,
  CAPABILITY_INTENT_SUMMARY_HTML_RELATIVE_PATH,
  RAW_PAGE_MATERIAL_MANIFEST_FILE,
  RAW_PAGE_MATERIAL_MANIFEST_RELATIVE_PATH,
  buildDebugReport,
  buildReportIndex,
  sanitizedNetworkSummary,
} from './build-debug-report.mjs';
import {
  collectUnsuccessfulCollections,
  collectionOutcomeReason,
  isDebugOnlyCapability,
} from './collection-outcomes.mjs';
import {
  displayBuildWarning,
  renderCollectionOutcomeTable,
} from './build-report-display.mjs';
import {
  buildCapabilityCard,
  buildCapabilityStateModel,
  capabilityCounts,
  sortCapabilitiesForUser,
} from './capability-state-report.mjs';
import {
  buildPartialSuccessOutcome,
} from './partial-success-report.mjs';
import {
  ACCESS_REMEDIATION_PLAN_FILE,
  PAGE_RECONCILIATION_REPORT_FILE,
  accessRemediationResultPath,
  capabilityIntentHtmlResultPath,
  pageReconciliationResultPath,
  robotsRemediationResultPath,
} from './build-summary-paths.mjs';
import {
  buildReportPayloadForMode,
  normalizeReportMode,
} from './build-report-mode.mjs';
import { renderSiteForgePlainBuildSummary } from './build-plain-summary.mjs';
import { buildUserFacingWarnings } from './user-report-warnings.mjs';
import { buildNextSteps } from './user-report-next-steps.mjs';
import {
  ROUTE_CAPTURE_PLAN_FILE,
  buildNextStepWorkflows,
} from './user-report-workflows.mjs';
import { summarizePrivacy } from './user-report-privacy.mjs';
import {
  relativeReportPath,
  sanitizeReportPublicValue,
} from './user-report-values.mjs';
import {
  buildCoverageReport,
  summarizeNodes,
} from './user-report-coverage.mjs';
import { buildCapabilityIntentHtmlPayload } from './capability-intent-html-payload.mjs';
import { renderCapabilityIntentSummaryHtml } from './capability-intent-html-render.mjs';
import { buildPageReconciliationReport } from './page-reconciliation-report.mjs';
import {
  buildAccessRemediationPlan,
  shouldWriteAccessRemediationPlan,
} from './access-remediation-plan.mjs';
import {
  safeStructureHash,
  sanitizedStructureText,
} from './structure-sanitizer.mjs';
import { authorizedSourcesSummaryForReport } from './authorized-sources-report.mjs';
import {
  renderSetupCollectionReviewLines,
  reconcileSetupCollectionReviewWithBuildOutputs,
  setupCollectionReviewReport,
} from './setup-collection-review.mjs';
import {
  setupProfileBuildBlock,
  setupProfileSummary,
} from './setup-profile-report.mjs';
import {
  canonicalCapabilitySemanticToken,
  normalizeSetupCapabilityId,
} from './capability-id.mjs';
import {
  applyCapabilityEvidenceMatrix,
  nodeHasPublicStructureEvidence,
} from './capability-evidence-matrix.mjs';
import {
  browserBridgePageWasCaptured,
  browserBridgeRouteCaptured,
  configuredAuthRouteTemplateSet,
  matchesConfiguredAuthRoute,
  routeCapturePlanFromAuthState,
  routeTemplateComparisonValues,
} from './browser-bridge-route-coverage.mjs';
import { EXPECTED_BROWSER_BRIDGE_EXTENSION_VERSION } from './browser-bridge-version-policy.mjs';
import {
  knownPolicyBusinessAreaForRoute,
  knownPolicyBusinessCoverageModel,
  knownPolicyPublicRouteTemplatePatterns,
  knownPolicyPublicSeedRoutes,
} from './known-site-policy.mjs';
import {
  API_READ_ONLY_CHALLENGE_PATTERN,
  apiEndpointLooksWriteLike,
  hasSensitiveApiQueryMaterial,
  hasSubstantiveApiRequestBody,
  isReadOnlyApiMethod,
  normalizeApiMethod,
} from './api-readonly-policy.mjs';
import {
  SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
  SITE_CAPABILITY_EXECUTION_VERSION,
} from '../../../domain/policies/execution/index.mjs';

export { SITEFORGE_BUILD_STAGE_NAMES } from './stage-plan.mjs';
export { renderCapabilityIntentSummaryHtml } from './capability-intent-html-render.mjs';

assertSiteForgeBuildStagePlan();

const USER_AUTHORIZED_COLLECTION_CONCURRENCY = 4;
const STATIC_CRAWL_COLLECTION_CONCURRENCY = 6;
const clone = jsonClone;

const CHAPTER_CONTENT_CAPABILITY_SEMANTIC_ALIASES = Object.freeze(new Map([
  ['browse-public-categories', 'browse-book-categories'],
  ['browse-catalog-categories', 'browse-book-categories'],
  ['browse-public-collections', 'browse-book-collections'],
  ['browse-catalog-collections', 'browse-book-collections'],
  ['browse-public-rankings', 'browse-book-rankings'],
  ['browse-catalog-rankings', 'browse-book-rankings'],
  ['open-public-detail-pages', 'open-book-detail'],
  ['open-catalog-detail', 'open-book-detail'],
  ['read-public-metadata', 'read-public-book-metadata'],
  ['read-public-catalog-metadata', 'read-public-book-metadata'],
  ['search-public-content', 'search-books'],
  ['search-catalog-content', 'search-books'],
]));

function arrayUniqueBy(values, keyFn) {
  const seen = new Set();
  const result = /** @type {any[]} */ ([]);
  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function contextualCapabilitySemanticToken(value, context = /** @type {any} */ ({})) {
  const token = canonicalCapabilitySemanticToken(value);
  if (!token) {
    return null;
  }
  return isChapterContentContext(context)
    ? (CHAPTER_CONTENT_CAPABILITY_SEMANTIC_ALIASES.get(token) ?? token)
    : token;
}

function capabilitySemanticKey(capability = /** @type {any} */ ({}), context = /** @type {any} */ ({})) {
  const setupToken = contextualCapabilitySemanticToken(capability.setupCapabilityId, context);
  if (setupToken) {
    return `setup:${setupToken}`;
  }
  const intentToken = contextualCapabilitySemanticToken(capability.intentAction, context);
  if (intentToken) {
    return `setup:${intentToken}`;
  }
  const nameToken = contextualCapabilitySemanticToken(capability.name, context);
  if (nameToken) {
    return `setup:${nameToken}`;
  }
  return `id:${capability.id ?? capability.name ?? ''}`;
}

function capabilityPreferenceTuple(capability = /** @type {any} */ ({})) {
  const candidateSupplementalProof = capability.status === 'candidate'
    && capability.capabilityVerified !== true
    && capability.requiresCapabilityEvidence === true
    && capability.pendingSupplementalProof === true;
  const statusRank = capability.status === 'active'
    ? 4
    : candidateSupplementalProof
      ? 5
      : capability.status === 'candidate'
      ? 2
      : capability.status === 'disabled'
        ? 1
        : 0;
  return [
    statusRank,
    capability.capabilityVerified === true ? 3 : 0,
    capability.executionPlan ? 2 : 0,
    capability.selectedBySetup === true ? 1 : 0,
    Number.isFinite(Number(capability.semanticPriority)) ? Number(capability.semanticPriority) : 0,
    Number.isFinite(Number(capability.confidence)) ? Number(capability.confidence) : 0,
    capability.autoGenerated === true ? 0 : 0.1,
  ];
}

function deactivateActiveCapabilityWithoutExecutionPlan(capability = /** @type {any} */ ({})) {
  if (capability.status !== 'active' || capability.executionPlan || capability.informational === true) {
    return capability;
  }
  const remediation = publicSafeRemediation({
    path: 'requires_manual_review',
    reasonCode: 'execution-plan-missing',
    reason: 'Capability was discovered, but no executable plan survived policy and evidence validation.',
    prohibitedActions: ['automatic_enablement'],
  });
  return {
    ...capability,
    status: 'disabled',
    enabled: false,
    enabled_status: 'disabled',
    default_policy: 'disabled',
    disabledByPolicy: true,
    executionDisabledByDefault: true,
    disabledReason: capability.disabledReason ?? 'execution-plan-missing',
    activationBlockedReason: capability.activationBlockedReason ?? 'execution-plan-missing',
    planCallable: false,
    runtimeCallable: false,
    autoExecutable: false,
    safe_remediation_path: remediation.path,
    safe_remediation: remediation,
  };
}

function compareCapabilityPreference(left = /** @type {any} */ ({}), right = /** @type {any} */ ({})) {
  const leftTuple = capabilityPreferenceTuple(left);
  const rightTuple = capabilityPreferenceTuple(right);
  for (let index = 0; index < leftTuple.length; index += 1) {
    if (leftTuple[index] !== rightTuple[index]) {
      return leftTuple[index] - rightTuple[index];
    }
  }
  return String(right.id ?? '').localeCompare(String(left.id ?? ''), 'en');
}

function dedupeSemanticCapabilities(capabilities = /** @type {any[]} */ ([]), context = /** @type {any} */ ({})) {
  const byKey = new Map();
  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    const key = capabilitySemanticKey(capability, context);
    const existing = byKey.get(key);
    if (!existing || compareCapabilityPreference(capability, existing) > 0) {
      byKey.set(key, capability);
    }
  }
  return [...byKey.values()];
}

function sourceToDiscoveredBy(source) {
  if (source === 'sitemap' || source === 'robots' || source === 'form') {
    return source;
  }
  if (source === 'user_authorized_browser') {
    return 'rendered_link';
  }
  if (source === 'canonical') {
    return 'html_link';
  }
  return 'html_link';
}

function createBlockedStageError(code, message, {
  warnings = /** @type {any[]} */ ([]),
  artifactPaths = /** @type {any} */ ({}),
  reasonCodes = /** @type {any[]} */ ([]),
  summary = /** @type {any} */ ({}),
} = /** @type {any} */ ({})) {
  const warningReasons = warnings
    .map((warning) => classifySiteForgeWarning(warning))
    .filter(Boolean)
    .map((reason) => ({ reasonCode: reason.reasonCode }));
  const warningReason = warningReasons.length
    ? selectSiteForgePrimaryReason(warningReasons, 'empty-crawl')
    : null;
  const reason = code === 'robots-unavailable'
    ? normalizeSiteForgeReason('robots-unavailable')
    : code === 'robots-disallowed'
      ? normalizeSiteForgeReason('robots-disallowed')
      : code === 'siteforge-seed-discovery-empty'
        ? (warningReason?.reasonCode === 'robots-disallowed' ? warningReason : normalizeSiteForgeReason('empty-seed-set'))
        : code === 'siteforge-static-evidence-unavailable'
          ? normalizeSiteForgeReason('dynamic-unsupported')
          : code === 'siteforge-rendered-evidence-unavailable'
            ? normalizeSiteForgeReason('dynamic-unsupported')
          : code === 'siteforge-static-crawl-empty'
            ? (warningReason?.reasonCode === 'network-fetch-failed' || warningReason?.reasonCode === 'robots-disallowed'
              ? warningReason
              : normalizeSiteForgeReason('empty-crawl'))
            : warningReason;
  const error = /** @type {Error & Record<string, any>} */ (new Error(reason?.reasonCode ? `${message} [reasonCode=${reason.reasonCode}]` : message));
  error.code = code;
  error.failureClass = reason?.failureClass ?? 'discovery';
  error.reasonCode = reason?.reasonCode ?? 'empty-crawl';
  error.reasonAction = reason?.action ?? null;
  error.reasonCodes = uniqueSortedStrings([code, reason?.reasonCode, ...reasonCodes]);
  error.stageStatus = 'blocked';
  error.buildStatus = 'blocked';
  error.warnings = warnings;
  error.artifactPaths = artifactPaths;
  error.summary = summary;
  return error;
}

function staticDiagnosticWarnings(urlValue, diagnostics) {
  return (diagnostics?.warnings ?? []).map((warning) => {
    const signals = diagnostics.dynamicSignals?.length
      ? ` signals=${diagnostics.dynamicSignals.join(',')}`
      : '';
    return `static-diagnostic ${urlValue}: ${warning}${signals}`;
  });
}

function hasUsableStaticPageEvidence(page) {
  return page?.diagnostics?.staticEvidenceStatus === 'present';
}

function hasPublicRenderedProvider(context) {
  return typeof context?.options?.publicRenderedStructureProvider === 'function'
    || Boolean(context?.options?.publicRenderedStructureSummary);
}

function publicRenderedExplicitlyDisabled(context) {
  return context?.options?.renderJs === false
    || context?.options?.publicRenderedAuto === false;
}

function canAutoAttemptPublicRenderedLayer(context) {
  return !publicRenderedExplicitlyDisabled(context);
}

function canAttemptPublicRenderedLayer(context, { renderedRequired = false } = /** @type {any} */ ({})) {
  return hasPublicRenderedProvider(context)
    || context?.options?.renderJs === true
    || context?.policy?.renderJs === true
    || (renderedRequired && canAutoAttemptPublicRenderedLayer(context));
}

function setupAllowsPublicRenderedRecovery(context) {
  return context?.setupProfile?.buildReadiness?.reasonCode === 'setup-public-rendered-recovery-pending';
}

function requireStage(stageResults, name) {
  const result = stageResults[name];
  if (!result) {
    throw new Error(`Missing required stage result: ${name}`);
  }
  return result;
}

function pageNodeId(urlValue) {
  return stableNodeId('node:page', normalizeUrl(urlValue));
}

function pageIdentity(page) {
  const normalizedUrl = normalizeUrl(page?.normalizedUrl ?? page?.url);
  const stateSuffix = page?.stateKey ? `#state:${page.stateKey}` : '';
  const sourceLayer = pageSourceLayer(page);
  const layerSuffix = sourceLayer && sourceLayer !== 'public' ? `#layer:${sourceLayer}` : '';
  return `${normalizedUrl}${stateSuffix}${layerSuffix}`;
}

function pageNodeIdForPage(page) {
  return stableNodeId('node:page', pageIdentity(page));
}

function pageSourceLayer(page = /** @type {any} */ ({})) {
  const layer = String(page?.sourceLayer ?? '').trim();
  if (layer === 'authenticated' || layer === 'authenticated_overlay' || layer === 'public_rendered' || layer === 'authorized_source' || layer === 'public') {
    return layer;
  }
  return page?.authRequired === true ? 'authenticated' : 'public';
}

function nodeSourceLayer(node = /** @type {any} */ ({})) {
  const layer = String(node?.sourceLayer ?? '').trim();
  if (layer === 'authenticated' || layer === 'authenticated_overlay' || layer === 'public_rendered' || layer === 'authorized_source' || layer === 'public') {
    return layer;
  }
  return node?.authRequired === true ? 'authenticated' : 'public';
}

function isPublicReadSourceLayer(layer) {
  return layer === 'public' || layer === 'public_rendered' || layer === 'authorized_source';
}

function isAuthenticatedSourceLayer(layer) {
  return layer === 'authenticated' || layer === 'authenticated_overlay';
}

function pageEvidenceLevel(page = /** @type {any} */ ({})) {
  if (page?.evidenceLevel) {
    return page.evidenceLevel;
  }
  const layer = pageSourceLayer(page);
  if (layer === 'authenticated_overlay') {
    return 'login_page_verified';
  }
  if (layer === 'authenticated') {
    return 'login_route_verified';
  }
  if (layer === 'public_rendered') {
    return 'public_rendered_verified';
  }
  if (layer === 'authorized_source') {
    return 'authorized_source_verified';
  }
  return 'public_verified';
}

function pagesFromStageResults(stageResults = /** @type {any} */ ({})) {
  const evidenceBundles = evidenceBundlesFromStageResults(stageResults);
  if (evidenceBundles.length) {
    return evidenceBundles.flatMap((bundle) => bundle.pages ?? []);
  }
  return [
    ...(stageResults.crawlStatic?.pages ?? []),
    ...(stageResults.crawlAuthenticated?.authenticatedPages ?? []),
    ...(stageResults.crawlAuthenticated?.authenticatedOverlayPages ?? []),
    ...(stageResults.crawlRendered?.publicRenderedPages ?? stageResults.crawlRendered?.pages ?? []),
  ];
}

function countBy(values = /** @type {any[]} */ ([]), selector = (value) => value) {
  return Object.fromEntries(Object.entries(values.reduce((counts, value) => {
    const key = selector(value) ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {})).sort(([left], [right]) => left.localeCompare(right, 'en')));
}

function formNodeId(pageId, form) {
  return stableNodeId('node:form', `${pageId}:${form.selector}:${form.action}:${form.method}`);
}

function routeNodeId(pattern) {
  return stableNodeId('node:route', pattern);
}

function routeTemplateNodeId(pattern, tabState = '') {
  return stableNodeId('node:route-template', `${pattern}:${tabState}`);
}

function structureNodeId(pageId, item) {
  return stableNodeId('node:structure', `${pageId}:${item.id ?? item.structureType}:${item.structureHash ?? item.labelSummary ?? ''}`);
}

function controlNodeId(pageId, control) {
  return stableNodeId('node:component', `${pageId}:${control.selector}:${control.kind}:${control.label ?? control.name ?? ''}`);
}

function affordanceId(kind, value) {
  return stableNodeId(`affordance:${kind}`, value);
}

function executionPlanId(capabilityId) {
  return `plan:${capabilityId.replace(/^capability:/u, '')}`;
}

function isSearchForm(form) {
  const haystack = [
    form.label,
    form.action,
    form.selector,
    ...form.inputs.map((input) => `${input.name ?? ''} ${input.type ?? ''} ${input.label ?? ''}`),
  ].join(' ').toLowerCase();
  return /search|query|keyword|q\b|find/u.test(haystack);
}

function isContactForm(form) {
  const haystack = [
    form.label,
    form.action,
    form.selector,
    form.textSummary,
    ...form.inputs.map((input) => `${input.name ?? ''} ${input.type ?? ''} ${input.label ?? ''}`),
  ].join(' ').toLowerCase();
  return /contact|support|message|email/u.test(haystack);
}

function catalogRouteClassification(pathname = '', haystack = '') {
  const pathText = String(pathname ?? '').toLowerCase();
  const text = `${pathText} ${String(haystack ?? '').toLowerCase()}`;
  if (/^\/topics?\/:id\/:id\/?$/u.test(pathText)) {
    return 'catalog_topic_archive';
  }
  if (/^\/topics?\/:id\/?$/u.test(pathText)) {
    return 'catalog_topic_detail';
  }
  if (/^\/topics?\/\d+\/?$/u.test(pathText)) {
    return 'catalog_topic_detail';
  }
  if (/^\/topics?(?:\/(?:column|media|event|release|talent-info))?\/\d{4}\/\d{2}\/?$/u.test(pathText)) {
    return 'catalog_topic_archive';
  }
  if (/^\/topics?(?:\/(?:column|media|event|release|talent-info))?(?:\/page\/\d+)?\/?$/u.test(pathText)) {
    return pathText.includes('/page/') ? 'catalog_topic_pagination' : 'catalog_topic_list';
  }
  if (/^\/release(?:\/\d{4}\/\d{2})?(?:\/page\/\d+)?\/?$/u.test(pathText)) {
    return 'catalog_release_list';
  }
  if (/^\/event(?:\/\d{4}\/\d{2}|\/page\/\d+|\/\d+)?\/?$/u.test(pathText)) {
    return 'catalog_event_media';
  }
  if (/\/(?:categories?|category|genres?|genre|channels?|channel)(?:\/|$)/u.test(pathText)) {
    return 'catalog_category';
  }
  if (/\/(?:tags?|tag|topics?|topic)(?:\/|$)/u.test(pathText)) {
    return 'catalog_tag';
  }
  if (/\/(?:models?|model|actors?|actor|actresses?|actress|authors?|author|stars?|star|performers?|performer)(?:\/|$)/u.test(pathText)) {
    return 'catalog_author';
  }
  if (/\/(?:hot|popular|ranking|rank|top|latest-updates|latest|new-releases?|recent|trending)(?:\/|$)/u.test(pathText)) {
    return 'catalog_collection';
  }
  if (/\/(?:page|p)\/\d+(?:\/|$)/u.test(pathText) || /[?&](?:page|p)=\d+/u.test(pathText)) {
    return 'catalog_pagination';
  }
  if (/\/(?:videos?|video|watch|items?|item|details?|detail|works?|work)(?:\/|$)/u.test(pathText)) {
    return 'catalog_detail';
  }
  if (/catalog|directory|collection|listing|browse|AV鍦ㄧ窔鐪媩AV online|video list|content list/iu.test(text)) {
    return 'catalog_collection';
  }
  return null;
}

function policyTextForContext(context = /** @type {any} */ ({})) {
  const policy = context.setupProfile?.knownSitePolicy ?? {};
  return [
    policy.siteArchetype,
    policy.primaryArchetype,
    policy.adapterId,
    policy.siteKey,
    ...(policy.pageTypes ?? []),
    ...(policy.capabilityFamilies ?? []),
    ...(policy.supportedIntents ?? []),
  ].join(' ').toLowerCase();
}

function isChapterContentContext(context = /** @type {any} */ ({})) {
  return /chapter-content|open-book|open-chapter|search-book|navigate-to-chapter/u.test(policyTextForContext(context));
}

function hasKnownPolicyAggregateNavigation(context = /** @type {any} */ ({})) {
  const policy = context.setupProfile?.knownSitePolicy ?? null;
  if (!policy || typeof policy !== 'object') {
    return false;
  }
  const hasKnownPolicyIdentity = Boolean(policy.siteKey || policy.adapterId || (policy.publicRouteTemplates ?? []).length);
  if (!hasKnownPolicyIdentity) {
    return false;
  }
  const families = knownPolicyCapabilityFamilies(context);
  return [
    'browse-site-navigation',
    'navigate-to-author',
    'navigate-to-category',
    'navigate-to-content',
    'query-ranked-content',
    'search-content',
    'switch-in-page-state',
  ].some((family) => families.has(family));
}

function knownPolicyAllowsRobotsUnavailableFallback(context = /** @type {any} */ ({})) {
  const fallback = context.setupProfile?.knownSitePolicy?.robotsUnavailableFallback;
  return fallback?.status === 'enabled'
    && fallback?.usePublicRouteTemplates === true
    && knownPolicyPublicSeedRoutes(context).length > 0;
}

function shouldUseAggregateNavigationCapabilities(context = /** @type {any} */ ({}), graph = /** @type {any} */ ({})) {
  return isChapterContentContext(context)
    || hasChapterContentCoverageSignals(graph.nodes ?? [])
    || hasKnownPolicyAggregateNavigation(context);
}

function isSocialSiteContext(context = /** @type {any} */ ({})) {
  return /social|timeline|post|direct-message|notification|bookmark|following|followers|twitter|instagram|x\.com/u.test(policyTextForContext(context));
}

function chapterContentClassification(pathname = '', pageType = '', context = /** @type {any} */ ({})) {
  const pathText = String(pathname ?? '').toLowerCase().replace(/\/+$/u, '') || '/';
  const pageTypeText = String(pageType ?? '').toLowerCase().replace(/[^a-z0-9]+/gu, '-');
  const hasPolicySignal = isChapterContentContext(context);
  const hasStructureSignal = /book|chapter|novel|fiction|reader|serialized/u.test(`${pathText} ${pageTypeText}`);
  if (!hasPolicySignal && !hasStructureSignal) {
    return null;
  }
  if (pageTypeText === 'home' || (pathText === '/' && !hasStructureSignal)) {
    return hasPolicySignal ? 'chapter_content_home' : null;
  }
  if (/book-detail|content-detail/u.test(pageTypeText) || /^\/(?:book|books|works|work)\/(?:[^/]+|:id)(?:\/)?$/u.test(pathText)) {
    return 'book_detail';
  }
  if (/chapter-page|chapter-detail/u.test(pageTypeText)
    || /^\/(?:chapter|chapters|read|reader)\/(?:[^/]+|:id)\/(?:[^/]+|:id)(?:\/)?$/u.test(pathText)) {
    return 'chapter_detail';
  }
  if (/book-search-results|search-results|search-page/u.test(pageTypeText)
    || (hasPolicySignal && /\/(?:search|soushu|so|booksearch)(?:\/|$)/u.test(pathText))) {
    return 'book_search_results';
  }
  if (/book-search-form/u.test(pageTypeText)) {
    return 'book_search_form';
  }
  if (/book-ranking|ranking-entry/u.test(pageTypeText)
    || (hasPolicySignal && (/ranking|rank/u.test(pageTypeText) || /\/(?:rank|ranking|top|hot)(?:\/|$)/u.test(pathText)))) {
    return 'book_ranking_list';
  }
  if (/book-card|book-list|ranking-entry/u.test(pageTypeText)) {
    return /rank|ranking/u.test(pageTypeText) ? 'book_ranking_list' : 'book_collection_list';
  }
  if (/chapter-link/u.test(pageTypeText)) {
    return 'chapter_detail';
  }
  if (/book-collection|book-recommendation/u.test(pageTypeText)) {
    return 'book_collection_list';
  }
  if (/book-category|book-list/u.test(pageTypeText)
    || (hasPolicySignal && (/category-page|collection|list/u.test(pageTypeText)
      || /^\/(?:all|finish|free|mm|boy|girl|category|categories|genre|genres|bookstore|library)(?:\/|$)/u.test(pathText)))) {
    return 'book_category_list';
  }
  return null;
}

function classificationFromLinkSemanticKind(kind, node = /** @type {any} */ ({})) {
  const normalizedKind = String(kind ?? '').toLowerCase();
  if (!normalizedKind || normalizedKind === 'navigation' || normalizedKind === 'search') {
    return null;
  }
  const text = [
    node.normalizedUrl,
    node.url,
    node.routePattern,
    node.routeTemplate,
    node.title,
    node.textSummary,
    node.structureType,
    node.linkStructureType,
  ].join(' ').toLowerCase();
  const listLike = (
    node.listPresent === true
    || Number(node.visibleItemCount ?? 0) >= 3
    || /(?:^|[/:?\s])(?:list|lists|collection|collections|catalog|index|page|pages|category|categories|tag|tags|rank|ranking|top|hot|popular|latest|new|recent|archive|archives)(?=[/?#:\s]|$)/u.test(text)
  );
  if (normalizedKind === 'category') return 'category_list';
  if (normalizedKind === 'tag') return 'tag_list';
  if (normalizedKind === 'ranking') return 'ranking_list';
  if (normalizedKind === 'following_list' || normalizedKind === 'followed_channel') return 'following_list';
  if (normalizedKind === 'profile') return 'profile_detail';
  if (normalizedKind === 'repository') return listLike ? 'repository_list' : 'repository_detail';
  if (normalizedKind === 'article') return listLike ? 'article_list' : 'article_detail';
  if (normalizedKind === 'work') return listLike ? 'work_list' : 'work_detail';
  if (normalizedKind === 'media' || normalizedKind === 'detail') {
    return listLike ? 'collection_list' : 'entity_detail';
  }
  return null;
}

function genericPublicClassification(pathname = '', pageType = '', haystack = '', node = /** @type {any} */ ({})) {
  const pathText = String(pathname ?? '').toLowerCase().replace(/\/+$/u, '') || '/';
  const pageTypeText = String(pageType ?? '').toLowerCase().replace(/[^a-z0-9]+/gu, '-');
  const text = [
    pathText,
    pageTypeText,
    haystack,
    node.structureType,
    node.linkSemanticKind,
    node.linkStructureType,
    ...(Array.isArray(node.routeTemplates) ? node.routeTemplates : []),
  ].join(' ').toLowerCase();
  const semanticClassification = classificationFromLinkSemanticKind(node.linkSemanticKind, node);
  if (semanticClassification) {
    return semanticClassification;
  }
  const segments = pathText.split('/').filter(Boolean);
  if (/search|query|keyword|find|soushu|so\b|搜索|搜书|检索/u.test(text)) {
    return /results?|result-list/u.test(text) ? 'search_results' : 'search_page';
  }
  if (/分类|类别|频道|书库|书城/u.test(text)) {
    return 'category_list';
  }
  if (/标签|话题/u.test(text)) {
    return 'tag_list';
  }
  if (/排行|榜单|热门|最新|新书/u.test(text)) {
    return 'ranking_list';
  }
  if (/categor|category|categories|genre|genres|channel|channels|section|sections|分类|频道/u.test(text)) {
    return 'category_list';
  }
  if (/\btag\b|tags|topic|topics|标签|话题/u.test(text)) {
    return 'tag_list';
  }
  if (/rank|ranking|top|hot|popular|trending|latest|recent|archive|archives|排行|榜|热门|最新/u.test(text)) {
    return 'ranking_list';
  }
  if (/repositories|repository|\brepos?\b|github|gitlab|source-code|source code|open-source|open source|code search|仓库|项目/u.test(text)) {
    if (/\/(?:repositories|repos|projects|explore|topics?)(?:\/|$)/u.test(pathText)
      || /list|search|collection|explore|topic/u.test(text)) {
      return 'repository_list';
    }
    if (segments.length >= 2 || /detail|readme|source-code|source code|code search/u.test(text)) {
      return 'repository_detail';
    }
  }
  if (/\/works?(?:\/(?:date|rank|ranking|top|hot|popular|latest|new|page|\d{4})(?:\/|$)|$)/u.test(pathText)
    || /\b(?:work|works|book|books|novel|fiction|serialized)\b/u.test(text)
    || /小说|书籍|作品|章节|阅读/u.test(text)) {
    if (/\/works?\/[^/]+/u.test(pathText) && !/\/works?\/(?:date|rank|ranking|top|hot|popular|latest|new|page|\d{4})(?:\/|$)/u.test(pathText)) {
      return 'work_detail';
    }
    return 'work_list';
  }
  if (/文章|资讯|新闻/u.test(text)) {
    if (/详情|正文/u.test(text)) {
      return 'article_detail';
    }
    return 'article_list';
  }
  if (/作者|作家|用户/u.test(text)) {
    return 'profile_detail';
  }
  if (/详情|目录/u.test(text)) {
    if (/列表|list|collection|catalog|index|page/u.test(text) || Number(node.visibleItemCount ?? 0) >= 3 || node.listPresent === true) {
      return 'collection_list';
    }
    return 'entity_detail';
  }
  if (/article|articles|story|stories|news|blog|post|posts|资讯|新闻|文章/u.test(text)) {
    if (/\/(?:article|articles|story|stories|news|blog|posts?)\/[^/]+/u.test(pathText) || /detail|正文/u.test(text)) {
      return 'article_detail';
    }
    return 'article_list';
  }
  if (/author|authors|profile|profiles|user|users|org|organization|people|actor|actors|model|models|作者|用户|组织/u.test(text)) {
    return 'profile_detail';
  }
  if (/detail|details|item|items|product|products|video|videos|watch|content|entity|详情/u.test(text)) {
    if (/list|collection|catalog|index|page|列表/u.test(text) || Number(node.visibleItemCount ?? 0) >= 3 || node.listPresent === true) {
      return 'collection_list';
    }
    return 'entity_detail';
  }
  if (
    node.listPresent === true
    || Number(node.visibleItemCount ?? 0) >= 3
    || /list|collection|catalog|directory|index|feed|cards?|entries|results?|列表|目录/u.test(text)
  ) {
    return 'collection_list';
  }
  return null;
}

function classifyPage(page, context = /** @type {any} */ ({})) {
  const sourceLayer = pageSourceLayer(page);
  if (isAuthenticatedSourceLayer(sourceLayer)) {
    const authText = `${page.routeTemplate ?? ''} ${page.routePattern ?? ''} ${page.pageType ?? ''} ${page.title ?? ''} ${page.textSummary ?? ''}`.toLowerCase();
    if (/notification|mention/u.test(authText)) return 'notification_list';
    if (/bookmark|saved/u.test(authText)) return 'bookmark_list';
    if (/(?:^|[/?#:_\s-])(?:follow|following|followers|followed)(?=$|[/?#:_\s-])/u.test(authText)) return 'following_list';
    if (/direct message|\bdm\b|message/u.test(authText)) return 'direct_message_list_summary';
    if (/account|settings|profile|security/u.test(authText)) return 'account_navigation';
    if (/timeline|feed|home/u.test(authText)) return 'authenticated_timeline';
    if (sourceLayer === 'authenticated_overlay') return 'auth_overlay_control';
    if (/private|sensitive/u.test(authText)) return 'sensitive_read_surface';
    return 'authenticated_home';
  }
  if (page.pageType === 'home') {
    return chapterContentClassification('/', page.pageType, context) ?? 'homepage';
  }
  const parsed = new URL(page.normalizedUrl);
  const chapterClassification = chapterContentClassification(
    page.routeTemplate ?? parsed.pathname,
    page.pageType,
    context,
  );
  if (chapterClassification) {
    return chapterClassification;
  }
  const haystack = `${parsed.pathname} ${page.title ?? ''} ${page.textSummary ?? ''}`.toLowerCase();
  if (parsed.pathname === '/') {
    return 'homepage';
  }
  if (/\/(?:ch|ch2|mobile|channel|news|feed)(?:\/|$)/u.test(parsed.pathname) || /^\/rain\/?$/u.test(parsed.pathname)) {
    return 'news_channel';
  }
  if (/\/(?:omn|d|article|story|a)\//u.test(parsed.pathname) || /\/rain\/a\//u.test(parsed.pathname) || /article|story|news detail|姝ｆ枃|鏂伴椈璇︽儏|绋夸欢/iu.test(haystack)) {
    return 'article_detail';
  }
  const earlyCatalogClassification = catalogRouteClassification(parsed.pathname, '');
  if (earlyCatalogClassification) {
    return earlyCatalogClassification;
  }
  if (/channel|feed|棰戦亾|瑕侀椈|鏂伴椈鍒楄〃|璧勮/iu.test(haystack)) {
    return 'news_channel';
  }
  const pathCatalogClassification = catalogRouteClassification(parsed.pathname, '');
  if (pathCatalogClassification) {
    return pathCatalogClassification;
  }
  if (/product-\d+|\/product\/|detail|item/u.test(haystack)) {
    return 'product_detail';
  }
  if (/products|catalog|collection|shop/u.test(haystack)) {
    return 'product_list';
  }
  const catalogClassification = catalogRouteClassification('', haystack);
  if (catalogClassification) {
    return catalogClassification;
  }
  if (/search/u.test(haystack)) {
    return 'search';
  }
  if (/contact|support/u.test(haystack)) {
    return 'contact';
  }
  const genericClassification = genericPublicClassification(
    page.routeTemplate ?? parsed.pathname,
    page.pageType,
    haystack,
    page,
  );
  if (genericClassification) {
    return genericClassification;
  }
  if (page.pageType) {
    const normalizedPageType = String(page.pageType).replace(/[^a-z0-9_]+/giu, '_').toLowerCase();
    return isSocialSiteContext(context) ? `social_${normalizedPageType}` : `content_${normalizedPageType}`;
  }
  return 'content_page';
}

function formSafety(form) {
  const method = String(form.method ?? 'GET').toUpperCase();
  const haystack = `${form.label ?? ''} ${form.action ?? ''} ${form.textSummary ?? ''}`.toLowerCase();
  const forcedActions = findForcedDisabledActions(haystack);
  if (forcedActions.some((action) => ['pay', 'checkout', 'purchase', 'change_payment'].includes(action))) {
    return 'payment';
  }
  if (forcedActions.length > 0) {
    return 'destructive';
  }
  if (/checkout|payment|purchase|billing|pay|cart|wallet|recharge/u.test(haystack)) {
    return 'payment';
  }
  if (/delete|remove|clear|empty|wipe|overwrite|reset|destroy|revoke|cancel[-_\s]?(?:order|subscription|account)/u.test(haystack)) {
    return 'destructive';
  }
  if (method === 'GET' && isSearchForm(form)) {
    return 'read_only';
  }
  if (method === 'GET') {
    return 'requires_input';
  }
  return 'state_changing';
}

function controlNodeType(control) {
  const role = String(control.attrs?.role ?? '').toLowerCase();
  if (role === 'tab') {
    return 'tab';
  }
  if (role === 'menu' || role === 'menuitem') {
    return 'menu';
  }
  return 'component';
}

function controlAffordanceKind(control) {
  const nodeType = controlNodeType(control);
  if (nodeType === 'menu') {
    return 'menu';
  }
  if (control.kind === 'select') {
    return 'select';
  }
  if (control.kind === 'input') {
    return 'input';
  }
  return 'button';
}

function controlSafety(control) {
  const type = String(control.type ?? '').toLowerCase();
  const haystack = `${control.label ?? ''} ${control.name ?? ''} ${type} ${control.attrs?.role ?? ''}`.toLowerCase();
  const forcedActions = findForcedDisabledActions(haystack);
  if (forcedActions.some((action) => ['pay', 'checkout', 'purchase', 'change_payment'].includes(action))) {
    return 'payment';
  }
  if (forcedActions.length > 0) {
    return 'destructive';
  }
  if (/checkout|payment|purchase|billing|pay|cart|wallet|recharge/u.test(haystack)) {
    return 'payment';
  }
  if (/delete|remove|clear|empty|wipe|overwrite|reset|destroy|revoke|cancel[-_\s]?(?:order|subscription|account)/u.test(haystack)) {
    return 'destructive';
  }
  if (type === 'submit') {
    return /search|query|keyword|find/u.test(haystack) ? 'requires_input' : 'state_changing';
  }
  if (control.kind === 'input' || control.kind === 'select') {
    return 'requires_input';
  }
  return 'safe';
}

function capabilitySafetyFromAffordance(affordance) {
  if (affordance.safety === 'payment') {
    return 'payment';
  }
  if (affordance.safety === 'destructive') {
    return 'destructive';
  }
  if (affordance.safety === 'state_changing') {
    return 'state_changing';
  }
  return 'read_only';
}

function titleCase(value) {
  return String(value ?? '')
    .replace(/[-_]+/gu, ' ')
    .replace(/\b\w/gu, (letter) => letter.toUpperCase())
    .trim();
}

function resolveSkillId(context, graph) {
  const genericSlugs = new Set(['site', 'home', 'index', 'av', 'official', 'welcome', 'top']);
  const knownSiteKey = context.setupProfile?.knownSitePolicy?.siteKey
    ?? context.setupProfile?.knownSitePolicy?.adapterId
    ?? context.site?.siteKey
    ?? context.site?.adapterId;
  const knownSlug = slugifyAscii(knownSiteKey, '');
  if (knownSlug && knownSlug.length >= 3 && !genericSlugs.has(knownSlug)) {
    return knownSlug;
  }
  const homepage = graph.nodes.find((node) => node.classification === 'homepage') ?? graph.nodes.find((node) => node.type === 'page');
  const title = homepage?.title ?? '';
  const slug = slugifyAscii(title.replace(/\bhome\b/giu, '').trim(), '');
  if (slug && slug.length >= 3 && !genericSlugs.has(slug)) {
    return slug;
  }
  const host = new URL(context.site.rootUrl).hostname.replace(/^www\./u, '');
  return slugifyAscii(host, context.site.id);
}

function resolveSkillDir(context) {
  assertSafeBuildPathSegment(context.skillId, 'skillId');
  return context.workspace.paths.buildSkillDir;
}

function resolveActiveSkillDir(context) {
  assertSafeBuildPathSegment(context.skillId, 'skillId');
  return context.workspace.paths.currentDir;
}

function renderYamlScalar(value) {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  const text = String(value);
  if (/^[A-Za-z0-9_./:@ -]+$/u.test(text) && !/^[-?:,[\]{}#&*!|>'"%@`]/u.test(text)) {
    return text;
  }
  return JSON.stringify(text);
}

function toYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    return value.map((item) => (
      item && typeof item === 'object'
        ? `${pad}- ${toYaml(item, indent + 2).trimStart()}`
        : `${pad}- ${renderYamlScalar(item)}`
    )).join('\n');
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return '{}';
    }
    return entries.map(([key, item]) => {
      if (item && typeof item === 'object') {
        const nested = toYaml(item, indent + 2);
        return `${pad}${key}: ${Array.isArray(item) && item.length === 0 ? '[]' : `\n${nested}`}`;
      }
      return `${pad}${key}: ${renderYamlScalar(item)}`;
    }).join('\n');
  }
  return `${pad}${renderYamlScalar(value)}`;
}

function policyFromSetupProfile(profile = /** @type {any} */ ({})) {
  const scope = profile.scope ?? {};
  const safety = profile.safety ?? {};
  return {
    maxDepth: scope.maxDepth,
    maxPages: scope.maxPages,
    maxSeeds: scope.maxSeeds,
    maxSitemaps: scope.maxSitemaps,
    renderJs: scope.renderJs,
    captureNetwork: scope.captureNetwork,
    submitForms: false,
    allowDestructiveActions: safety.allowDestructiveActions === true ? false : false,
    allowPayment: safety.allowPayment === true ? false : false,
    allowAccountMutation: safety.allowAccountMutation === true ? false : false,
    allowContactSubmit: safety.allowContactSubmit === true ? false : false,
  };
}

function userAuthorizedEvidencePages(context) {
  const evidence = context.setupProfile?.userAuthorizedEvidence;
  if (evidence?.status !== 'captured' || !Array.isArray(evidence.pages) || evidence.pages.length === 0) {
    return [];
  }
  const modeledDiscovery = createSocialSpaAutoDiscoverySummary({
    site: context.site,
    knownSitePolicy: context.setupProfile?.knownSitePolicy,
    evidence,
    options: context.options,
  });
  const sourcePages = mergeAutoDiscoveryPages(evidence.pages, modeledDiscovery);
  const browserSeeds = Array.isArray(evidence.browserSeeds) ? evidence.browserSeeds : [];
  const seedByUrl = new Map(browserSeeds
    .map((seed) => [normalizeUrl(seed.normalizedUrl ?? seed.url ?? context.site.rootUrl, context.site.rootUrl), seed]));
  const seedLinks = [...seedByUrl.keys()].sort((left, right) => left.localeCompare(right, 'en'));
  return sourcePages.map((page) => {
    const normalizedUrl = normalizeUrl(page.normalizedUrl ?? page.url ?? context.site.rootUrl, context.site.rootUrl);
    const seed = seedByUrl.get(normalizedUrl) ?? null;
    const links = seedLinks
      .filter((urlValue) => urlValue !== normalizedUrl)
      .slice(0, 20)
      .map((urlValue, index) => ({
        href: urlValue,
        normalizedHref: urlValue,
        label: `Known-site authorized route seed ${index + 1}`,
        selector: `authorized-route-seed:nth-of-type(${index + 1})`,
        attrs: {
          'data-siteforge-source': 'authorized-route-seed',
        },
      }));
    return {
      url: normalizedUrl,
      normalizedUrl,
      depth: 0,
      discoveredBy: 'rendered_link',
      sourcePath: null,
      title: page.title || `${new URL(context.site.rootUrl).hostname} authorized browser surface`,
      textSummary: page.textSummary || (seed
        ? `Known-site authorized route seed: ${seed.routeKind ?? seed.seedType ?? 'authorized-route'}; no raw session material persisted.`
        : 'User-authorized browser evidence was captured without persisting raw session material.'),
      pageType: page.pageType ?? null,
      routeTemplate: page.routeTemplate ?? null,
      routePath: page.routePath ?? null,
      tabState: page.tabState ?? null,
      stateKey: page.stateKey ?? null,
      routeState: {
        source: 'known-social-route-state-model',
        stateId: page.stateKey ?? null,
        routeTemplate: page.routeTemplate ?? null,
        routePath: page.routePath ?? null,
        tabState: page.tabState ?? null,
        pageType: page.pageType ?? null,
        listPresent: page.listPresent === true,
        visibleItemCount: Number(page.visibleItemCount ?? 0) || 0,
      },
      visibleItemCount: Number(page.visibleItemCount ?? 0) || 0,
      listPresent: page.listPresent === true,
      structureHash: page.structureHash ?? null,
      evidenceStatus: page.evidenceStatus ?? null,
      riskLevel: page.riskLevel ?? null,
      canonicalUrl: normalizedUrl,
      links,
      forms: [],
      controls: Array.isArray(page.controls) ? page.controls : [],
      structureItems: Array.isArray(page.structureItems) ? page.structureItems : [],
      authRequired: true,
      diagnostics: {
        staticEvidenceStatus: 'present',
        dynamicSignals: ['user-authorized-browser'],
        warnings: [],
      },
      evidence: [
        buildEvidence({
          type: 'dom',
          source: normalizedUrl,
          text: seed
            ? `Known-site authorized route seed ${seed.routeKind ?? seed.seedType ?? 'authorized-route'}; raw session material was not persisted.`
            : 'User-authorized browser evidence summary; raw session material was not persisted.',
          confidence: 0.86,
        }),
      ],
    };
  });
}

function resolveRuntimeAuthFromOptions(options = /** @type {any} */ ({}), site = null) {
  const material = authRuntimeMaterialFrom(options);
  const authRuntime = material?.authRuntime ?? options.authRuntime ?? null;
  const authenticatedStructureSummary = material?.authenticatedStructureSummary
    ?? options.authenticatedStructureSummary
    ?? null;
  return {
    authRuntime: authRuntime && typeof authRuntime === 'object'
      ? {
        ...authRuntime,
        allowedDomains: authRuntime.allowedDomains ?? site?.allowedDomains ?? [],
      }
      : null,
    authenticatedStructureSummary,
  };
}

function buildSafeRuntimeOptions(options = /** @type {any} */ ({})) {
  const safeOptions = { ...options };
  delete safeOptions.authRuntime;
  delete safeOptions.authenticatedStructureSummary;
  delete safeOptions.apiReplayCookieHeader;
  delete safeOptions.cookieHeader;
  delete safeOptions.cookieEnv;
  delete safeOptions.cookieFile;
  delete safeOptions.cookieStdin;
  delete safeOptions.runtimeProviderRegistry;
  delete safeOptions.runtimeProviderRegistryFactory;
  delete safeOptions.runtimeContext;
  delete safeOptions.runtimeExecutionContext;
  return safeOptions;
}

function clearRuntimeAuthInputOptions(options = /** @type {any} */ ({})) {
  delete options.authRuntime;
  delete options.authenticatedStructureSummary;
  delete options.apiReplayCookieHeader;
  delete options.cookieHeader;
  delete options.cookieEnv;
  delete options.cookieFile;
  delete options.cookieStdin;
  delete options.runtimeProviderRegistry;
  delete options.runtimeProviderRegistryFactory;
  delete options.runtimeContext;
  delete options.runtimeExecutionContext;
  return options;
}

function resolveRuntimeProviderRegistryFromOptions(options = /** @type {any} */ ({}), site = null, buildId = null) {
  if (options.runtimeProviderRegistry && typeof options.runtimeProviderRegistry.resolve === 'function') {
    return options.runtimeProviderRegistry;
  }
  if (typeof options.runtimeProviderRegistryFactory === 'function') {
    const registry = options.runtimeProviderRegistryFactory({
      site,
      buildId,
      runtimeBoundary: 'app/runtime',
    });
    return registry && typeof registry.resolve === 'function' ? registry : null;
  }
  return null;
}

function runtimeExecutionContextFromOptions(options = /** @type {any} */ ({})) {
  const source = options.runtimeExecutionContext ?? options.runtimeContext ?? null;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return {};
  }
  return {
    localFixture: source.localFixture === true,
    controlledBrowserRuntime: source.controlledBrowserRuntime === true,
    slotValues: source.slotValues && typeof source.slotValues === 'object' && !Array.isArray(source.slotValues)
      ? source.slotValues
      : undefined,
    fixtureSlotValues: source.fixtureSlotValues && typeof source.fixtureSlotValues === 'object' && !Array.isArray(source.fixtureSlotValues)
      ? source.fixtureSlotValues
      : undefined,
    fetchImpl: typeof source.fetchImpl === 'function'
      ? source.fetchImpl
      : undefined,
    browserActionDescriptor: source.browserActionDescriptor && typeof source.browserActionDescriptor === 'object' && !Array.isArray(source.browserActionDescriptor)
      ? source.browserActionDescriptor
      : undefined,
    browserActionDescriptors: source.browserActionDescriptors && typeof source.browserActionDescriptors === 'object' && !Array.isArray(source.browserActionDescriptors)
      ? source.browserActionDescriptors
      : undefined,
  };
}

function safeRuntimeSessionRef(value, fallback = 'runtime-session') {
  const text = String(value ?? '').trim();
  const digest = createHash('sha256').update(text || fallback).digest('hex').slice(0, 16);
  return `${fallback}:${digest}`;
}

function runtimeCookieHeaderFromOptions(options = /** @type {any} */ ({})) {
  for (const value of [
    options.apiReplayCookieHeader,
    options.cookieHeader,
  ]) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function createEphemeralCookieSessionVault({
  cookieHeader,
  site,
  buildId,
  origin,
  resources = [],
  scopes: explicitScopes = null,
} = /** @type {any} */ ({})) {
  const sessionHandle = safeRuntimeSessionRef(`${site?.id ?? 'site'}:${buildId}:handle`, 'runtime-session');
  const sessionRef = safeRuntimeSessionRef(`${site?.id ?? 'site'}:${buildId}:ref`, 'auth-session');
  const scopes = Array.isArray(explicitScopes) && explicitScopes.length
    ? explicitScopes
    : [{
      origin,
      operations: ['read', 'query'],
      ...(resources.length ? { resources } : {}),
    }];
  let issuedCount = 0;
  return {
    sessionHandle,
    sessionRef,
    vault: {
      vaultType: 'ephemeral_cookie_runtime_session_v1',
      async inspectSession(request = /** @type {any} */ ({})) {
        if (request.sessionHandle !== sessionHandle) {
          return null;
        }
        return {
          sessionRef,
          status: 'active',
          active: true,
          scopes,
          materialPolicy: 'ephemeral_http_only',
          redactionRequired: true,
        };
      },
      async getScopedSessionMaterial() {
        issuedCount += 1;
        return {
          grantId: `grant:ephemeral-cookie:${issuedCount}`,
          materials: [
            {
              type: 'cookie',
              value: cookieHeader,
            },
          ],
          summary: {
            materialTypes: ['cookie'],
            materialCount: 1,
          },
        };
      },
      async releaseScopedSessionMaterial() {
        return {
          released: true,
          redactionRequired: true,
        };
      },
    },
  };
}

function runtimeSessionAuthFromOptions(options = /** @type {any} */ ({}), site = null, buildId = null) {
  const cookieHeader = runtimeCookieHeaderFromOptions(options);
  if (!cookieHeader || options.execute !== true || !options.executionTask) {
    return null;
  }
  const host = String(site?.host ?? site?.hostname ?? '').toLowerCase();
  const siteKey = String(options.setupProfile?.knownSitePolicy?.siteKey ?? options.knownSitePolicy?.siteKey ?? '').toLowerCase();
  const isWeibo = siteKey === 'weibo' || host === 'weibo.com' || host.endsWith('.weibo.com');
  const origin = isWeibo ? 'https://s.weibo.com' : site?.origin ?? site?.rootUrl ?? site?.normalizedUrl ?? null;
  if (!origin) return null;
  const scopes = isWeibo
    ? [
      {
        origin: 'https://s.weibo.com',
        operations: ['read', 'query'],
        resources: ['/weibo'],
      },
      {
        origin: 'https://weibo.com',
        operations: ['read', 'query'],
        resources: ['/ajax/friendships/friends'],
      },
      {
        origin: 'https://weibo.com',
        operations: ['read', 'query'],
        resources: ['/ajax/statuses/mymblog'],
      },
      {
        origin: 'https://weibo.com',
        operations: ['read', 'query'],
        resources: ['/ajax/profile/getAudioList'],
      },
      {
        origin: 'https://weibo.com',
        operations: ['read', 'query'],
        resources: ['/ajax/side/hotSearch'],
      },
      {
        origin: 'https://weibo.com',
        operations: ['read', 'query'],
        resources: ['/ajax/statuses/hot_band'],
      },
      {
        origin: 'https://weibo.com',
        operations: ['read', 'query'],
        resources: ['/ajax/feed/hottimeline'],
      },
      {
        origin: 'https://photo.weibo.com',
        operations: ['read', 'query'],
        resources: ['/photos/get_all'],
      },
    ]
    : null;
  return createEphemeralCookieSessionVault({
    cookieHeader,
    site,
    buildId,
    origin,
    resources: isWeibo ? ['/weibo'] : [],
    scopes,
  });
}

function sanitizedString(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function sanitizedExecutionRef(value) {
  const text = sanitizedString(value);
  if (!text) return null;
  return text
    .toLowerCase()
    .replace(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/gu, '$1-$2-$3-$4')
    .replace(/[^a-z0-9._:/-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 220) || null;
}

function sanitizeBrowserActionDescriptor(descriptor = null) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    return null;
  }
  const requiredSlots = Array.isArray(descriptor.requiredSlots)
    ? descriptor.requiredSlots.map((slot) => sanitizedString(slot)).filter(Boolean)
    : [];
  return {
    selector: sanitizedString(descriptor.selector ?? descriptor.targetSelector)
      ?.replace(/[?&](?:token|auth|sid|session|cookie|csrf|access_token|refresh_token)=[^"'\]\s&]+/giu, '') ?? null,
    actionRef: sanitizedString(descriptor.actionRef ?? descriptor.actionId),
    routeRef: sanitizedString(descriptor.routeRef ?? descriptor.routeId),
    requiredSlots,
    savedMaterial: SANITIZED_SUMMARY_ONLY,
    redactionRequired: true,
  };
}

function browserActionDescriptorForRuntime(context, selectedContract) {
  const runtimeContext = context?.runtimeExecutionContext ?? {};
  const descriptors = runtimeContext.browserActionDescriptors;
  const explicitDescriptor = selectedContract?.browserActionDescriptor
    ?? descriptors?.[selectedContract?.capabilityId]
    ?? descriptors?.[selectedContract?.id]
    ?? runtimeContext.browserActionDescriptor
    ?? null;
  return sanitizeBrowserActionDescriptor(explicitDescriptor);
}

function browserActionRuntimeContext(context, selectedContract = null) {
  const kind = String(selectedContract?.operationKind ?? selectedContract?.runtimeBinding?.kind ?? '').toLowerCase();
  if (!kind.includes('form_or_action') && !kind.includes('write') && !kind.includes('submit') && selectedContract?.capabilityKind !== 'write') {
    return null;
  }
  const source = context.runtimeExecutionContext ?? {};
  return {
    localFixture: source.localFixture === true,
    controlledBrowserRuntime: source.controlledBrowserRuntime === true,
    slotValues: source.slotValues,
    fixtureSlotValues: source.fixtureSlotValues,
  };
}

function runtimeDownloaderTaskDescriptorForDispatch(descriptor = null) {
  if (!descriptor) {
    return null;
  }
  const result = {
    material: descriptor.material ?? 'descriptor_only',
    networkResolveAllowedAtRuntime: descriptor.networkResolveAllowedAtRuntime === true,
    savedMaterial: descriptor.savedMaterial ?? SANITIZED_SUMMARY_ONLY,
    reportMaterial: descriptor.reportMaterial ?? SANITIZED_SUMMARY_ONLY,
    redactionRequired: true,
  };
  for (const key of ['siteKey', 'adapterId', 'taskType', 'entrypoint', 'scriptLanguage', 'interpreter', 'sessionRequirement', 'artifactMaterial', 'bodyTextPersistence']) {
    if (descriptor[key]) {
      result[key] = String(descriptor[key]);
    }
  }
  for (const key of ['acceptsBookTitle', 'acceptsBookUrl', 'acceptsSearchResult']) {
    if (descriptor[key] === true || descriptor[key] === false) {
      result[key] = descriptor[key] === true;
    }
  }
  for (const key of ['inputSlots', 'outputFields']) {
    if (Array.isArray(descriptor[key])) {
      result[key] = descriptor[key].map((value) => String(value ?? '').trim()).filter(Boolean);
    }
  }
  return result;
}

function runtimeProviderIdForDispatch(runtimeBinding = null) {
  const providerId = String(runtimeBinding?.providerId ?? '').trim();
  if (
    (runtimeBinding?.kind === 'downloader' && providerId === 'known_site_downloader')
    || (runtimeBinding?.kind === 'browser_bridge' && providerId === 'browser_bridge')
    || providerId === 'browser_action_provider'
  ) {
    return providerId;
  }
  return null;
}

function runtimeContractDescriptorForDispatch(selectedContract, dispatchReport, context = null) {
  if (!selectedContract || !dispatchReport.runtimeInvocationRequest) {
    return null;
  }
  const browserActionDescriptor = browserActionDescriptorForRuntime(context, selectedContract);
  return {
    id: dispatchReport.runtimeInvocationRequest.executionContractRef,
    executionContractRef: dispatchReport.runtimeInvocationRequest.executionContractRef,
    capabilityId: selectedContract.capabilityId,
    capabilityKind: selectedContract.capabilityKind ?? null,
    operationKind: selectedContract.operationKind ?? null,
    contractKind: selectedContract.contractKind ?? selectedContract.capabilityKind ?? selectedContract.operationKind ?? 'runtime_contract',
    destructiveAction: selectedContract.destructiveAction === true,
    highRiskAction: selectedContract.highRiskAction === true,
    paymentOrFundsAction: selectedContract.paymentOrFundsAction === true,
    runtimeBinding: selectedContract.runtimeBinding
      ? {
        kind: selectedContract.runtimeBinding.kind ?? null,
        providerId: runtimeProviderIdForDispatch(selectedContract.runtimeBinding),
        downloaderTaskDescriptor: runtimeDownloaderTaskDescriptorForDispatch(selectedContract.runtimeBinding.downloaderTaskDescriptor),
      }
      : null,
    requestSchemaRef: sanitizedExecutionRef(selectedContract.requestSchemaRef),
    responseSchemaRef: sanitizedExecutionRef(selectedContract.responseSchemaRef),
    payloadTemplate: selectedContract.payloadTemplate ?? null,
    authRequirement: selectedContract.authRequirement ?? null,
    browserActionDescriptor,
    runtimeBoundary: 'app/runtime',
    descriptorOnly: true,
    redactionRequired: true,
  };
}

function downloadRuntimeOutputContext(context, selectedContract = null) {
  const kind = String(selectedContract?.operationKind ?? selectedContract?.runtimeBinding?.kind ?? '').toLowerCase();
  if (!kind.includes('download') && !kind.includes('export') && selectedContract?.runtimeBinding?.kind !== 'downloader') {
    return null;
  }
  return {
    outputPolicy: {
      approved: true,
      root: 'build_artifact_dir',
    },
    outputDir: context.artifactDir,
    downloadFilename: 'siteforge-controlled-download.txt',
  };
}

function quotedTaskValue(taskText) {
  const text = String(taskText ?? '');
  for (const pattern of [
    /[《「『“"]([^》」』”"]{1,120})[》」』”"]/u,
    /book_title\s*[:=]\s*([^\s，。；;]{1,120})/iu,
  ]) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return '';
}

function taskBookUrl(taskText, siteRootUrl) {
  const text = String(taskText ?? '');
  const match = text.match(/https?:\/\/[^\s"'<>，。；]+/iu);
  if (!match) {
    return '';
  }
  try {
    const root = new URL(siteRootUrl);
    const url = new URL(match[0]);
    return url.protocol === root.protocol && url.host === root.host ? url.toString() : '';
  } catch {
    return '';
  }
}

function taskBookTitle(taskText) {
  const quoted = quotedTaskValue(taskText);
  if (quoted) {
    return quoted;
  }
  const cleaned = String(taskText ?? '')
    .replace(/https?:\/\/[^\s"'<>，。；]+/giu, ' ')
    .replace(/\b(?:download|export|extract|book|novel|text|txt|please|save)\b/giu, ' ')
    .replace(/(?:请|帮我|把|将|需要|搜索到的作品|搜索到的|进行|下载|提取|导出|保存|小说正文|正文|全书|本地|为|成|和|以及)/gu, ' ')
    .replace(/[，。；;:：、]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return cleaned.length >= 2 && cleaned.length <= 80 ? cleaned : '';
}

function downloadRuntimeSlotValues(context, selectedContract = null) {
  const descriptor = selectedContract?.runtimeBinding?.downloaderTaskDescriptor ?? {};
  if (
    selectedContract?.operationKind !== 'download'
    || selectedContract?.runtimeBinding?.kind !== 'downloader'
    || descriptor.taskType !== 'book'
  ) {
    return null;
  }
  const taskText = String(context.options?.executionTask ?? '');
  const siteRootUrl = context.site?.rootUrl ?? context.site?.normalizedUrl ?? context.inputUrl ?? '';
  const bookUrl = taskBookUrl(taskText, siteRootUrl);
  const bookTitle = taskBookTitle(taskText);
  const values = {};
  if (bookTitle) values.book_title = bookTitle;
  if (bookUrl) values.book_url = bookUrl;
  if (!Object.keys(values).length) {
    return null;
  }
  return values;
}

function downloadRuntimeTaskContext(context, selectedContract = null) {
  const descriptor = selectedContract?.runtimeBinding?.downloaderTaskDescriptor ?? {};
  if (
    selectedContract?.operationKind !== 'download'
    || selectedContract?.runtimeBinding?.kind !== 'downloader'
    || descriptor.taskType !== 'book'
  ) {
    return null;
  }
  return {
    cwd: context.cwd,
    siteRootUrl: context.site?.rootUrl ?? context.site?.normalizedUrl ?? context.inputUrl ?? null,
    slotValues: downloadRuntimeSlotValues(context, selectedContract) ?? {},
  };
}

function createInitialContext(inputUrl, options = /** @type {any} */ ({})) {
  const now = options.now instanceof Date ? options.now : new Date();
  const startedAt = now.toISOString();
  const site = siteRecordWithKnownAdapterAllowedDomains(createSiteRecord(inputUrl, startedAt), inputUrl);
  const buildId = options.buildId ?? formatBuildId(now);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const workspace = createSiteWorkspace({
    cwd,
    workspaceRoot: options.workspaceRoot,
    site,
    buildId,
    startedAt,
  });
  const artifactDir = buildArtifactDir({
    cwd,
    siteDir: workspace.paths.siteDir,
    siteId: site.id,
    buildId,
    buildDir: workspace.paths.buildDir,
  });
  const policy = mergeBuildPolicy({
    maxDepth: options.maxDepth,
    maxPages: options.maxPages,
    maxSeeds: options.maxSeeds,
    maxSitemaps: options.maxSitemaps,
    fetchDelayMs: options.fetchDelayMs,
    fetchTimeoutMs: options.fetchTimeoutMs,
    renderJs: options.renderJs,
    captureNetwork: options.captureNetwork,
    interactive: options.interactive,
    submitForms: options.submitForms,
    allowDestructiveActions: options.allowDestructiveActions,
    allowPayment: options.allowPayment,
    allowAccountMutation: options.allowAccountMutation,
    allowContactSubmit: options.allowContactSubmit,
  });
  const runtimeAuth = resolveRuntimeAuthFromOptions(options, site);
  const apiReplayCookieHeader = typeof options.apiReplayCookieHeader === 'string'
    ? options.apiReplayCookieHeader.trim()
    : null;
  const runtimeProviderRegistry = resolveRuntimeProviderRegistryFromOptions(options, site, buildId);
  const runtimeSessionAuth = runtimeSessionAuthFromOptions(options, site, buildId);
  const runtimeExecutionContext = {
    ...runtimeExecutionContextFromOptions(options),
    ...(runtimeSessionAuth?.vault ? { sessionVault: runtimeSessionAuth.vault } : {}),
  };
  const safeOptions = buildSafeRuntimeOptions(options);
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    siteId: site.id,
    siteDir: workspace.paths.siteDir,
    buildId,
    buildDir: workspace.paths.buildDir,
    inputUrl,
    site,
    cwd,
    workspace,
    artifactDir,
    setupProfile: safeOptions.setupProfile ?? null,
    crawlContract: safeOptions.crawlContract ?? safeOptions.setupProfile?.crawlContract ?? null,
    authStateReport: safeOptions.authStateReport ?? safeOptions.setupProfile?.authStateReport ?? null,
    authStateReportPath: safeOptions.authStateReportPath ?? null,
    siteAdapterProfile: null,
    siteAdapterPaths: null,
    setupCollectionReview: safeOptions.setupCollectionReview ?? null,
    setupCollectionReviewPath: null,
    buildProfilePath: safeOptions.buildProfilePath ?? null,
    artifactStore: {
      type: 'siteforge-per-site-build-dir',
      rootDir: workspace.paths.buildDir,
      buildDir: workspace.paths.buildDir,
      siteDir: workspace.paths.siteDir,
    },
    startedAt,
    policy,
    options: safeOptions,
    apiReplayCookieHeader,
    runtimeProviderRegistry,
    runtimeExecutionContext,
    runtimeSessionAuth: runtimeSessionAuth
      ? {
        sessionHandle: runtimeSessionAuth.sessionHandle,
        sessionRef: runtimeSessionAuth.sessionRef,
        source: 'ephemeral_cookie_runtime_session',
      }
      : null,
    authRuntime: runtimeAuth.authRuntime,
    authenticatedStructureSummary: runtimeAuth.authenticatedStructureSummary,
    source: createBuildSource(inputUrl, {
      ...safeOptions,
      fetchDelayMs: policy.fetchDelayMs,
      fetchTimeoutMs: policy.fetchTimeoutMs,
      authRuntime: null,
    }),
    warnings: [],
    skillId: null,
    skillDir: null,
    draftSkillDir: null,
    activeSkillDir: null,
    registryPath: path.resolve(safeOptions.registryPath ?? workspace.paths.registryPath),
  };
}

async function hydrateSetupCollectionReview(context) {
  if (context.setupCollectionReview) {
    return;
  }
  if (context.setupProfile?.collectionReview) {
    context.setupCollectionReview = context.setupProfile.collectionReview;
    context.setupCollectionReviewPath = context.buildProfilePath;
    return;
  }
  const candidates = [
    context.workspace.paths.setupFiles?.['capability_hints.json'] ?? null,
    context.workspace.paths.setupFiles?.['setup_plan.json'] ?? null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const loaded = await readJsonIfExists(candidate, null);
    if (loaded?.collectionReview) {
      context.setupCollectionReview = loaded.collectionReview;
      context.setupCollectionReviewPath = candidate;
      return;
    }
  }
}

async function hydrateBuildProfile(context) {
  const candidates = [
    context.buildProfilePath,
    context.workspace.paths.buildDirs?.inputs ? path.join(context.workspace.paths.buildDirs.inputs, 'build_profile.json') : null,
    context.workspace.paths.setupFiles?.['build_profile.json'] ?? null,
  ].filter(Boolean);
  let profile = context.setupProfile;
  let profilePath = context.buildProfilePath;
  if (!profile) {
    for (const candidate of candidates) {
      const loaded = await readJsonIfExists(candidate, null);
      if (loaded) {
        profile = loaded;
        profilePath = candidate;
        break;
      }
    }
  }
  if (!profile) {
    await hydrateSetupCollectionReview(context);
    return;
  }
  assertBuildProfileSafe(profile);
  context.buildProfilePath = profilePath;
  context.authStateReport = reusableBuildProfileAuthStateReport({
    options: context.options,
    site: context.site,
    buildProfile: profile,
    fallbackAuthStateReport: context.authStateReport,
  });
  context.crawlContract = reusableBuildProfileCrawlContract({
    options: context.options,
    site: context.site,
    buildProfile: profile,
    authStateReport: context.authStateReport,
    fallbackCrawlContract: context.crawlContract,
  });
  context.setupProfile = {
    ...profile,
    authStateReport: context.authStateReport,
    crawlContract: context.crawlContract,
  };
  if (!context.authStateReport) {
    context.authStateReport = createPublicOnlyAuthStateReport({
      site: context.site,
      authMethod: context.crawlContract?.authMethod ?? 'none',
    });
  }
  if (!context.crawlContract) {
    context.crawlContract = createCrawlContract({
      site: context.site,
      authStateReport: context.authStateReport,
      coverageTargets: {},
    });
  }
  await hydrateSetupCollectionReview(context);
  context.policy = mergeBuildPolicy({
    ...policyFromSetupProfile(profile),
    maxDepth: context.options.maxDepth,
    maxPages: context.options.maxPages,
    maxSeeds: context.options.maxSeeds,
    maxSitemaps: context.options.maxSitemaps,
    fetchDelayMs: context.options.fetchDelayMs,
    fetchTimeoutMs: context.options.fetchTimeoutMs,
    renderJs: context.options.renderJs,
    captureNetwork: context.options.captureNetwork,
    interactive: context.options.interactive,
    submitForms: context.options.submitForms,
    allowDestructiveActions: context.options.allowDestructiveActions,
    allowPayment: context.options.allowPayment,
    allowAccountMutation: context.options.allowAccountMutation,
    allowContactSubmit: context.options.allowContactSubmit,
  });
  context.source = createBuildSource(context.inputUrl, {
    ...context.options,
    fetchDelayMs: context.policy.fetchDelayMs,
    fetchTimeoutMs: context.policy.fetchTimeoutMs,
    authRuntime: null,
  });
}

function updateWebInteractionBuildState(context, stageRecords, stageResults, {
  phase = 'build',
  status = 'running',
  result = null,
} = /** @type {any} */ ({})) {
  const session = context.options?.webInteractionSession;
  if (!session || typeof session.update !== 'function') {
    return;
  }
  try {
    session.update({
      cwd: context.cwd,
      site: context.site,
      phase,
      status,
      stageRecords,
      stageResults,
      ...(result ? { result } : {}),
    });
  } catch {
    // The build must not fail because the optional local interaction page is closed or stale.
  }
}

function stageSubstepSnapshot(context, stageName = context?._stageSubstepRuntime?.stageName) {
  const runtime = context?._stageSubstepRuntime;
  if (!runtime || runtime.stageName !== stageName) {
    return {
      activeSubstep: null,
      substeps: {},
    };
  }
  return {
    activeSubstep: runtime.activeSubstep ?? null,
    substeps: jsonClone(runtime.substeps ?? {}),
  };
}

function beginStageSubsteps(context, stageRecords, stageResults, stageName, startedAt) {
  const substeps = createStageSubstepRecords(stageName);
  const first = siteForgeBuildStageSubsteps(stageName)[0]?.id ?? null;
  if (first && substeps[first]) {
    substeps[first] = {
      ...substeps[first],
      status: 'running',
      startedAt,
    };
  }
  context._stageSubstepRuntime = {
    stageName,
    stageRecords,
    stageResults,
    startedAt,
    activeSubstep: first,
    substeps,
  };
  return stageSubstepSnapshot(context, stageName);
}

function markStageSubstep(context, substepId, status = 'running', details = /** @type {any} */ ({})) {
  const runtime = context?._stageSubstepRuntime;
  if (!runtime || !substepId || !runtime.substeps?.[substepId]) {
    return;
  }
  const now = new Date().toISOString();
  if (status === 'running' && runtime.activeSubstep && runtime.activeSubstep !== substepId) {
    const previous = runtime.substeps[runtime.activeSubstep];
    if (previous?.status === 'running') {
      runtime.substeps[runtime.activeSubstep] = {
        ...previous,
        status: 'success',
        completedAt: previous.completedAt ?? now,
      };
    }
  }
  const previous = runtime.substeps[substepId] ?? {};
  const progressNumber = (key) => {
    if (!Object.prototype.hasOwnProperty.call(details, key)) {
      return previous[key] ?? null;
    }
    const value = details[key];
    if (value === null || value === undefined || value === '') {
      return previous[key] ?? null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : previous[key] ?? null;
  };
  runtime.substeps[substepId] = {
    ...previous,
    status,
    startedAt: previous.startedAt ?? now,
    completedAt: ['success', 'failed', 'blocked', 'skipped'].includes(status)
      ? now
      : previous.completedAt ?? null,
    reasonCode: details.reasonCode ?? previous.reasonCode ?? null,
    message: details.message ?? previous.message ?? null,
    currentItem: details.currentItem ?? previous.currentItem ?? null,
    processedCount: progressNumber('processedCount'),
    totalCount: progressNumber('totalCount'),
    discoveredCount: progressNumber('discoveredCount'),
    skippedCount: progressNumber('skippedCount'),
    elapsedMs: progressNumber('elapsedMs'),
    warnings: Array.isArray(details.warnings) ? details.warnings : previous.warnings ?? [],
    errors: Array.isArray(details.errors) ? details.errors : previous.errors ?? [],
  };
  runtime.activeSubstep = status === 'running' ? substepId : null;
  const payload = stageSubstepSnapshot(context, runtime.stageName);
  runtime.stageRecords[runtime.stageName] = buildStageRecord(
    runtime.stageName,
    'running',
    payload,
    runtime.startedAt,
    null,
    STAGE_DEPENDENCIES,
  );
  updateWebInteractionBuildState(context, runtime.stageRecords, runtime.stageResults, {
    phase: 'build',
    status: `running:${runtime.stageName}.${substepId}`,
  });
}

function markStageSubstepProgress(context, substepId, details = /** @type {any} */ ({})) {
  const runtime = context?._stageSubstepRuntime;
  markStageSubstep(context, substepId, 'running', {
    ...details,
    currentItem: safeSubstepCurrentItem(details.currentItem),
    elapsedMs: details.elapsedMs ?? (runtime?.startedAt ? Date.now() - Date.parse(runtime.startedAt) : null),
  });
}

function safeSubstepCurrentItem(value, maxLength = 320) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (!text) {
    return null;
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function timeoutError(message, reasonCode) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.code = reasonCode;
  return error;
}

async function withOperationTimeout(operation, timeoutMs, message, reasonCode) {
  const ms = Math.max(1, Number(timeoutMs ?? 0));
  let timeout = null;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(timeoutError(message, reasonCode)), ms);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function finishStageSubsteps(context, stageName, finalStatus = 'success') {
  const runtime = context?._stageSubstepRuntime;
  if (!runtime || runtime.stageName !== stageName) {
    return {
      activeSubstep: null,
      substeps: {},
    };
  }
  const now = new Date().toISOString();
  const terminalStatus = finalStatus === 'success' ? 'success' : finalStatus;
  for (const [substepId, record] of Object.entries(runtime.substeps ?? {})) {
    let status = record.status;
    if (status === 'pending') {
      status = finalStatus === 'success' ? 'success' : 'skipped';
    } else if (status === 'running') {
      status = terminalStatus === 'success' ? 'success' : terminalStatus;
    }
    const elapsedMs = Number.isFinite(Number(record.elapsedMs))
      ? Number(record.elapsedMs)
      : Date.now() - Date.parse(record.startedAt ?? runtime.startedAt ?? now);
    const fallbackProcessedCount = Number.isFinite(Number(record.processedCount))
      ? Number(record.processedCount)
      : 0;
    const fallbackTotalCount = Number.isFinite(Number(record.totalCount))
      ? Number(record.totalCount)
      : fallbackProcessedCount;
    const fallbackDiscoveredCount = Number.isFinite(Number(record.discoveredCount))
      ? Number(record.discoveredCount)
      : 0;
    const fallbackSkippedCount = Number.isFinite(Number(record.skippedCount))
      ? Number(record.skippedCount)
      : (status === 'skipped' ? 1 : 0);
    runtime.substeps[substepId] = {
      ...record,
      status,
      completedAt: record.completedAt ?? now,
      processedCount: fallbackProcessedCount,
      totalCount: fallbackTotalCount,
      discoveredCount: fallbackDiscoveredCount,
      skippedCount: fallbackSkippedCount,
      elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : 0,
    };
  }
  runtime.activeSubstep = null;
  const payload = stageSubstepSnapshot(context, stageName);
  delete context._stageSubstepRuntime;
  return payload;
}

function dedicatedSiteAdapterId(context) {
  return `${context.site.id}-site-adapter`;
}

function sourceAdapterIdentity(context) {
  const knownPolicy = context.setupProfile?.knownSitePolicy ?? {};
  return {
    sourceAdapterId: knownPolicy.adapterId ?? null,
    sourceSiteKey: knownPolicy.siteKey ?? null,
  };
}

function normalizedAdapterRouteTemplate(urlValue, rootUrl) {
  try {
    return routePatternForUrl(urlValue);
  } catch {
    return '/';
  }
}

function routeSeedPlanFromSeeds(context, seeds = /** @type {any[]} */ ([])) {
  const groups = new Map();
  for (const seed of seeds) {
    const normalizedUrl = normalizeUrl(seed.normalizedUrl ?? seed.url ?? context.site.rootUrl, context.site.rootUrl);
    const familyKey = routeFamilyKeyForSeed(normalizedUrl, context.site.rootUrl);
    const routeTemplate = normalizedAdapterRouteTemplate(normalizedUrl, context.site.rootUrl);
    const current = groups.get(familyKey) ?? {
      familyKey,
      routeTemplate,
      count: 0,
      sources: new Set(),
      confidence: 0,
    };
    current.count += 1;
    current.sources.add(seed.source ?? 'unknown');
    current.confidence = Math.max(current.confidence, Number(seed.confidence ?? 0) || 0);
    groups.set(familyKey, current);
  }
  const routeFamilies = [...groups.values()]
    .map((group) => ({
      familyKey: group.familyKey,
      routeTemplate: group.routeTemplate,
      count: group.count,
      sources: [...group.sources].sort((left, right) => left.localeCompare(right, 'en')),
      confidence: Number(group.confidence.toFixed(3)),
    }))
    .sort((left, right) => left.familyKey.localeCompare(right.familyKey, 'en'));
  return {
    status: routeFamilies.length ? 'seeded' : 'initialized',
    totalSeeds: seeds.length,
    routeFamilies,
    privacy: {
      exactUserRoutesStored: false,
      routeTemplatesStored: true,
      savedMaterial: SANITIZED_SUMMARY_ONLY,
    },
  };
}

function pageTypeMapFromAdapterProfile(context, routeSeedPlan) {
  const configuredPageTypes = uniqueSortedStrings(context.setupProfile?.knownSitePolicy?.pageTypes ?? []);
  const inferredPageTypes = uniqueSortedStrings((routeSeedPlan.routeFamilies ?? []).map((family) => {
    const key = family.familyKey;
    if (key === 'home') return 'home';
    if (/search/iu.test(key)) return 'search-results-page';
    if (/category|tag|channel|lists?/iu.test(key)) return 'category-page';
    if (/author|profile|users?|actors?|models?/iu.test(key)) return 'author-page';
    if (/detail|status|video|watch|chapter|book|article|content/iu.test(key)) return 'content-detail-page';
    if (/login|account|settings|admin/iu.test(key)) return 'restricted-or-account-page';
    return 'route-family-page';
  }));
  return {
    configured: configuredPageTypes,
    inferred: inferredPageTypes,
    effective: uniqueSortedStrings([...configuredPageTypes, ...inferredPageTypes]),
  };
}

function capabilityTemplateFromAdapterProfile(context, routeSeedPlan) {
  const configuredFamilies = uniqueSortedStrings(context.setupProfile?.knownSitePolicy?.capabilityFamilies ?? []);
  const inferredFamilies = new Set(['browse-site-navigation']);
  for (const family of routeSeedPlan.routeFamilies ?? []) {
    const key = family.familyKey;
    if (/search/iu.test(key)) inferredFamilies.add('search-content');
    if (/category|tag|channel|lists?/iu.test(key)) inferredFamilies.add('navigate-to-category');
    if (/author|profile|users?|actors?|models?/iu.test(key)) inferredFamilies.add('navigate-to-author');
    if (/detail|status|video|watch|chapter|book|article|content/iu.test(key)) inferredFamilies.add('navigate-to-content');
    if (/download/iu.test(key)) inferredFamilies.add('download-content');
    if (/home|timeline|feed/iu.test(key)) inferredFamilies.add('read-feed-summary');
  }
  return {
    configured: configuredFamilies,
    inferred: uniqueSortedStrings([...inferredFamilies]),
    effective: uniqueSortedStrings([...configuredFamilies, ...inferredFamilies]),
  };
}

function adapterContractFromProfile(profile) {
  const routeRules = (profile.routeSeedPlan?.routeFamilies ?? []).map((family) => ({
    id: `route:${family.familyKey}`,
    routeTemplate: family.routeTemplate,
    familyKey: family.familyKey,
    pageTypeHint: family.familyKey === '/'
      ? 'home'
      : /search/iu.test(family.familyKey)
        ? 'search-results-page'
        : /category|tag|channel|lists?/iu.test(family.familyKey)
          ? 'category-page'
          : /author|profile|users?|actors?|models?/iu.test(family.familyKey)
            ? 'author-page'
            : /detail|status|video|watch|chapter|book|article|content/iu.test(family.familyKey)
              ? 'content-detail-page'
              : 'route-family-page',
    evidenceSource: 'sanitized-route-seed-plan',
  }));
  return {
    contractVersion: 1,
    kind: 'site_adapter_contract',
    adapterId: profile.adapterId,
    siteId: profile.siteId,
    routeClassifier: {
      fallback: 'route-family-template',
      rules: routeRules,
    },
    pageTypeRules: (profile.pageTypeMap?.effective ?? []).map((pageType) => ({
      pageType,
      evidenceSource: 'configured-or-inferred-route-family',
    })),
    capabilityRules: (profile.capabilityTemplate?.effective ?? []).map((family) => ({
      capabilityFamily: family,
      evidenceSource: 'configured-or-inferred-route-family',
      requiresEvidenceBackedActivation: true,
    })),
    safetyRules: {
      savedMaterial: SANITIZED_SUMMARY_ONLY,
      rawContentSaved: false,
      privateContentSaved: false,
      highRiskAutoExecuteAllowed: false,
      forcedDisabledActions: [...FORCED_DISABLED_ACTIONS],
    },
    artifacts: {
      generatedAdapter: 'generated_adapter.json',
      adapterContractTests: 'adapter_contract_tests.json',
      crawlCheckpoint: 'crawl_checkpoint.json',
    },
  };
}

function buildGeneratedAdapterContractTests(profile) {
  const tests = [
    {
      id: 'adapter-id-is-site-dedicated',
      type: 'identity',
      status: profile.adapterId && profile.adapterId !== profile.sourceAdapterId ? 'passed' : 'failed',
      message: 'Adapter id must be generated for this site instead of exposing a generic template id.',
    },
    {
      id: 'adapter-kind-is-generated-profile',
      type: 'schema',
      status: profile.adapterKind === 'site_dedicated_generated_profile' ? 'passed' : 'failed',
      message: 'Adapter profile must be a SiteForge generated per-site profile.',
    },
    {
      id: 'privacy-saves-sanitized-summary-only',
      type: 'privacy',
      status: profile.savedMaterial === SANITIZED_SUMMARY_ONLY
        && profile.rawMaterialSaved === false
        && profile.riskPolicy?.rawContentSaved === false
        && profile.riskPolicy?.privateContentSaved === false
        ? 'passed'
        : 'failed',
      message: 'Adapter contract must not persist unsanitized markup, page body text, private content, session material, or browser profiles.',
    },
    {
      id: 'route-classifier-contract-generated',
      type: 'route_classifier',
      status: profile.contract?.routeClassifier?.rules?.length || profile.routeSeedPlan?.status === 'initialized' ? 'passed' : 'failed',
      message: 'Route classifier must be generated from sanitized route families or be explicitly initialized before seed discovery.',
    },
    {
      id: 'capability-rules-require-evidence',
      type: 'capability_policy',
      status: (profile.contract?.capabilityRules ?? []).every((rule) => rule.requiresEvidenceBackedActivation === true) ? 'passed' : 'failed',
      message: 'Capability rules must require evidence-backed activation.',
    },
    {
      id: 'high-risk-actions-are-not-auto-executable',
      type: 'safety',
      status: profile.contract?.safetyRules?.highRiskAutoExecuteAllowed === false ? 'passed' : 'failed',
      message: 'Generated adapter contract must not allow high-risk auto execution.',
    },
  ];
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-site-adapter-contract-tests',
    adapterId: profile.adapterId,
    siteId: profile.siteId,
    generatedAt: new Date().toISOString(),
    tests,
    summary: {
      total: tests.length,
      passed: tests.filter((test) => test.status === 'passed').length,
      failed: tests.filter((test) => test.status === 'failed').length,
    },
  };
}

function buildGeneratedSiteAdapterProfile(context, {
  seeds = /** @type {any[]} */ ([]),
  status = 'initialized',
  stage = 'registerSite',
} = /** @type {any} */ ({})) {
  const routeSeedPlan = routeSeedPlanFromSeeds(context, seeds);
  const pageTypeMap = pageTypeMapFromAdapterProfile(context, routeSeedPlan);
  const capabilityTemplate = capabilityTemplateFromAdapterProfile(context, routeSeedPlan);
  const { sourceAdapterId, sourceSiteKey } = sourceAdapterIdentity(context);
  const profile = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-generated-site-adapter-profile',
    contractVersion: 1,
    adapterKind: 'site_dedicated_generated_profile',
    adapterId: dedicatedSiteAdapterId(context),
    siteId: context.site.id,
    rootUrl: context.site.rootUrl,
    allowedDomains: context.site.allowedDomains,
    status,
    generatedAt: new Date().toISOString(),
    stage,
    sourceAdapterId,
    sourceSiteKey,
    templateSource: sourceAdapterId ? 'known-site-policy-template' : 'route-family-discovery-template',
    executableCodeGenerated: false,
    rawMaterialSaved: false,
    savedMaterial: SANITIZED_SUMMARY_ONLY,
    routeSeedPlan,
    pageTypeMap,
    capabilityTemplate,
    riskPolicy: {
      summary: riskPolicySummary(),
      forcedDisabledActions: [...FORCED_DISABLED_ACTIONS],
      rawContentSaved: false,
      privateContentSaved: false,
      highRiskAutoExecuteAllowed: false,
    },
    validationPlan: {
      requiresRouteSeedPlan: true,
      requiresPageTypeMap: true,
      requiresCapabilityTemplate: true,
      requiresEvidenceBackedCapabilities: true,
      promotesOnlyAfterVerification: true,
      registryUpdatesOnlyAfterVerification: true,
    },
  };
  profile.contract = adapterContractFromProfile(profile);
  return profile;
}

function siteAdapterSummaryForReport(context, { includeSource = false } = /** @type {any} */ ({})) {
  const profile = context.siteAdapterProfile ?? buildGeneratedSiteAdapterProfile(context);
  const summary = {
    adapter_id: profile.adapterId,
    adapter_kind: profile.adapterKind,
    site_id: profile.siteId,
    template_source: profile.templateSource,
    route_family_count: profile.routeSeedPlan?.routeFamilies?.length ?? 0,
    capability_family_count: profile.capabilityTemplate?.effective?.length ?? 0,
    contract_version: profile.contractVersion ?? null,
    contract_test_summary: context.siteAdapterPaths?.build?.adapterContractTests
      ? relativeReportPath(context.cwd, context.siteAdapterPaths.build.adapterContractTests)
      : relativeReportPath(context.cwd, path.join(context.artifactDir, 'adapter_contract_tests.json')),
    generated_adapter: context.siteAdapterPaths?.build?.generatedAdapter
      ? relativeReportPath(context.cwd, context.siteAdapterPaths.build.generatedAdapter)
      : relativeReportPath(context.cwd, path.join(context.artifactDir, 'generated_adapter.json')),
    site_adapter_profile: context.siteAdapterPaths?.site?.generatedAdapter
      ? relativeReportPath(context.cwd, context.siteAdapterPaths.site.generatedAdapter)
      : relativeReportPath(context.cwd, path.join(context.workspace.paths.adapterDir, 'generated_adapter.json')),
    executable_code_generated: false,
    saved_material: SANITIZED_SUMMARY_ONLY,
  };
  if (includeSource) {
    summary.source_adapter_id = profile.sourceAdapterId;
    summary.source_site_key = profile.sourceSiteKey;
  }
  return summary;
}

async function writeGeneratedSiteAdapterProfile(context, args = /** @type {any} */ ({})) {
  const profile = buildGeneratedSiteAdapterProfile(context, args);
  const contractTests = buildGeneratedAdapterContractTests(profile);
  const generatedAdapterPath = await writeArtifactJson(context, 'generated_adapter.json', profile);
  const adapterContractTestsPath = await writeArtifactJson(context, 'adapter_contract_tests.json', contractTests);
  const siteGeneratedAdapterPath = await writeGeneratedJson(
    context,
    path.join(context.workspace.paths.adapterDir, 'generated_adapter.json'),
    profile,
  );
  const siteRouteSeedPlanPath = await writeGeneratedJson(
    context,
    path.join(context.workspace.paths.adapterDir, 'route_seed_plan.json'),
    profile.routeSeedPlan,
  );
  const sitePageTypeMapPath = await writeGeneratedJson(
    context,
    path.join(context.workspace.paths.adapterDir, 'page_type_map.json'),
    profile.pageTypeMap,
  );
  const siteCapabilityTemplatePath = await writeGeneratedJson(
    context,
    path.join(context.workspace.paths.adapterDir, 'capability_template.json'),
    profile.capabilityTemplate,
  );
  const siteRiskPolicyPath = await writeGeneratedJson(
    context,
    path.join(context.workspace.paths.adapterDir, 'risk_policy.json'),
    profile.riskPolicy,
  );
  const siteValidationPlanPath = await writeGeneratedJson(
    context,
    path.join(context.workspace.paths.adapterDir, 'validation_plan.json'),
    profile.validationPlan,
  );
  const siteAdapterTestsPath = await writeGeneratedJson(
    context,
    path.join(context.workspace.paths.adapterDir, 'tests', 'contract_tests.json'),
    contractTests,
  );
  context.siteAdapterProfile = profile;
  context.siteAdapterPaths = {
    build: {
      generatedAdapter: generatedAdapterPath,
      adapterContractTests: adapterContractTestsPath,
    },
    site: {
      generatedAdapter: siteGeneratedAdapterPath,
      routeSeedPlan: siteRouteSeedPlanPath,
      pageTypeMap: sitePageTypeMapPath,
      capabilityTemplate: siteCapabilityTemplatePath,
      riskPolicy: siteRiskPolicyPath,
      validationPlan: siteValidationPlanPath,
      adapterContractTests: siteAdapterTestsPath,
    },
  };
  return {
    profile,
    artifactPaths: {
      generatedAdapter: generatedAdapterPath,
      adapterContractTests: adapterContractTestsPath,
      siteGeneratedAdapter: siteGeneratedAdapterPath,
      siteRouteSeedPlan: siteRouteSeedPlanPath,
      sitePageTypeMap: sitePageTypeMapPath,
      siteCapabilityTemplate: siteCapabilityTemplatePath,
      siteRiskPolicy: siteRiskPolicyPath,
      siteValidationPlan: siteValidationPlanPath,
      siteAdapterContractTests: siteAdapterTestsPath,
    },
    summary: siteAdapterSummaryForReport(context),
  };
}

async function writeCrawlCheckpoint(context, {
  status = 'running',
  mode = 'seed_inventory',
  seeds = /** @type {any[]} */ ([]),
  pages = /** @type {any[]} */ ([]),
  failures = /** @type {any[]} */ ([]),
  queueLength = 0,
  queueIndex = 0,
  visitedCount = 0,
  effectiveMaxPages = 0,
  coveragePlan = null,
  summary = /** @type {any} */ ({}),
  warnings = /** @type {any[]} */ ([]),
} = /** @type {any} */ ({})) {
  const routeFamilies = (coveragePlan?.seeds ?? seeds).map((seed) => ({
    familyKey: routeFamilyKeyForSeed(seed.normalizedUrl ?? seed.url ?? context.site.rootUrl, context.site.rootUrl),
    routeTemplate: normalizedAdapterRouteTemplate(seed.normalizedUrl ?? seed.url ?? context.site.rootUrl, context.site.rootUrl),
    source: seed.source ?? 'unknown',
  }));
  const uniqueRouteFamilies = arrayUniqueBy(routeFamilies, (family) => `${family.familyKey}:${family.routeTemplate}`)
    .sort((left, right) => left.familyKey.localeCompare(right.familyKey, 'en'));
  const checkpoint = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-crawl-checkpoint',
    buildId: context.buildId,
    siteId: context.site.id,
    adapterId: context.siteAdapterProfile?.adapterId ?? dedicatedSiteAdapterId(context),
    status,
    mode,
    updatedAt: new Date().toISOString(),
    resume: {
      supported: true,
      scope: 'same-site-build-artifacts',
      rawMaterialRequired: false,
      savedMaterial: SANITIZED_SUMMARY_ONLY,
      nextQueueIndex: queueIndex,
      queueLength,
      visitedCount,
      effectiveMaxPages,
      unfetchedQueueItems: Math.max(0, queueLength - queueIndex),
    },
    coverage: {
      mode: coveragePlan?.mode ?? mode,
      familyCount: coveragePlan?.familyCount ?? uniqueRouteFamilies.length,
      representativeSeedUrls: coveragePlan?.seeds?.length ?? seeds.length,
      seedInventoryUrls: seeds.length,
      routeFamilies: uniqueRouteFamilies,
    },
    summary: {
      pages: pages.length,
      failures: failures.length,
      warnings: warnings.length,
      ...summary,
    },
    privacy: {
      savedMaterial: SANITIZED_SUMMARY_ONLY,
      rawDomSaved: false,
      rawHtmlSaved: false,
      rawContentSaved: false,
      privateContentSaved: false,
      cookiesSaved: false,
      tokensSaved: false,
      browserProfileSaved: false,
    },
  };
  return await writeArtifactJson(context, 'crawl_checkpoint.json', checkpoint);
}

async function registerSiteStage(context) {
  markStageSubstepProgress(context, 'normalizeInput', {
    message: '规范化输入 URL 和站点根地址。',
    processedCount: 1,
    totalCount: 1,
    discoveredCount: context.site.allowedDomains?.length ?? 0,
    currentItem: context.site.rootUrl,
  });
  markStageSubstepProgress(context, 'resolveIdentity', {
    message: '解析站点标识和主机键。',
    processedCount: 1,
    totalCount: 1,
    discoveredCount: context.site.allowedDomains?.length ?? 0,
    currentItem: context.site.id,
  });
  const sitePath = await writeArtifactJson(context, 'site.json', context.site);
  markStageSubstepProgress(context, 'createWorkspace', {
    message: '创建隔离站点工作区和基础产物。',
    processedCount: 1,
    totalCount: 3,
    discoveredCount: 1,
    currentItem: context.artifactDir,
  });
  const safetyPolicy = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    policy: context.policy,
    crawlContract: context.crawlContract ?? null,
    authState: authSummaryForReport(context.crawlContract, context.authStateReport),
    riskPolicy: {
      schemaVersion: 1,
      savedMaterial: SANITIZED_SUMMARY_ONLY,
      highRiskRule: 'High-risk capabilities may be discovered, but disabled capabilities must stay visible and must never carry execution plans.',
      forcedDisabledActions: [...FORCED_DISABLED_ACTIONS],
      sensitiveReadMaterial: [
        'page_type',
        'item_count',
        'time_range_summary',
        'list_presence',
        'unread_marker_presence',
        'route_template',
        'structure_hash',
      ],
      rawContentSaved: false,
      privateContentSaved: false,
    },
  };
  markStageSubstepProgress(context, 'loadPolicy', {
    message: '合并构建策略、安全策略和抓取契约。',
    processedCount: Object.keys(context.policy ?? {}).length,
    totalCount: Object.keys(context.policy ?? {}).length,
    discoveredCount: FORCED_DISABLED_ACTIONS.length,
  });
  const safetyPolicyPath = await writeArtifactJson(context, 'safety_policy.json', safetyPolicy);
  const generatedAdapter = await writeGeneratedSiteAdapterProfile(context, {
    status: 'initialized',
    stage: 'registerSite',
  });
  return {
    site: context.site,
    safetyPolicy,
    generatedAdapter: generatedAdapter.profile,
    artifactPaths: {
      site: sitePath,
      safetyPolicy: safetyPolicyPath,
      generatedAdapter: generatedAdapter.artifactPaths.generatedAdapter,
      siteGeneratedAdapter: generatedAdapter.artifactPaths.siteGeneratedAdapter,
    },
    summary: {
      siteId: context.site.id,
      rootUrl: context.site.rootUrl,
      allowedDomains: context.site.allowedDomains.length,
      generatedAdapter: generatedAdapter.summary,
    },
  };
}

function routeTargetToUrl(context, routeTarget) {
  const value = String(routeTarget ?? '').trim();
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL(normalizeUrl(value, context.site.rootUrl));
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function seedFromRouteTarget(context, routeTarget, {
  source = 'auth_route',
  confidence = 0.62,
  reasonCode = null,
  sourceLayer = 'authenticated',
  authRequired = true,
} = /** @type {any} */ ({})) {
  const normalizedUrl = routeTargetToUrl(context, routeTarget);
  if (!normalizedUrl || !isInternalUrl(normalizedUrl, context.site.allowedDomains)) {
    return null;
  }
  const pathname = new URL(normalizedUrl).pathname || '/';
  return {
    routeId: `${source}:${pathname}`,
    url: normalizedUrl,
    normalizedUrl,
    source,
    sourceLayer,
    authRequired,
    confidence,
    reasonCode,
    evidence: [
      buildEvidence({
        type: 'text',
        source: context.site.rootUrl,
        text: `${source} seed ${pathname}; session material was not persisted.`,
        confidence,
      }),
    ],
  };
}

function layeredSeedsForContext(context, publicSeeds = /** @type {any[]} */ ([]), robotsExcludedUrls = /** @type {any[]} */ ([]), robotsPolicy = null) {
  const contract = context.crawlContract ?? createCrawlContract({
    site: context.site,
    authStateReport: context.authStateReport,
  });
  const targets = contract.coverageTargets ?? {};
  const configuredAuthRoutes = configuredAuthRouteTemplateSet(context);
  const publicSeedsLayer = publicSeeds
    .filter((seed) => !matchesConfiguredAuthRoute(context, configuredAuthRoutes, [
      seed?.routeTemplate,
      seed?.routePattern,
      seed?.normalizedUrl,
      seed?.url,
    ]))
    .map((seed) => ({
      ...seed,
      sourceLayer: 'public',
      authRequired: false,
    }));
  const authRouteSeeds = (targets.authRoutes ?? [])
    .map((route) => seedFromRouteTarget(context, route, {
      source: 'auth_route',
      sourceLayer: 'authenticated',
      authRequired: true,
      confidence: 0.62,
      reasonCode: ['authenticated_cookie', 'authenticated_browser'].includes(contract.crawlMode) ? null : 'requires_login',
    }))
    .filter(Boolean);
  const revisitRouteSeeds = (targets.publicRevisitRoutes ?? [])
    .map((route) => seedFromRouteTarget(context, route, {
      source: 'authenticated_revisit',
      sourceLayer: 'authenticated_overlay',
      authRequired: true,
      confidence: 0.66,
    }))
    .filter(Boolean);
  const blockedSeedRecords = uniqueSortedStrings(robotsExcludedUrls).map((urlValue) => ({
    url: urlValue,
    normalizedUrl: normalizeUrl(urlValue, context.site.rootUrl),
    source: 'robots',
    sourceLayer: 'public',
    authRequired: false,
    reasonCode: 'robots-disallowed',
  }));
  const robotsAllowedSeed = (seed) => {
    if (!robotsPolicy || !seed?.normalizedUrl) {
      return true;
    }
    const userAuthorizedAuthenticatedSeed = (
      context.options?.userAuthorizedBrowserLive === true
      || context.options?.browserBridgeUserAuthorizedLive === true
    )
      && context.authStateReport?.authMethod === 'browser'
      && canRunAuthenticatedLayer(context.authStateReport)
      && ['authenticated', 'authenticated_overlay'].includes(seed?.sourceLayer);
    if (userAuthorizedAuthenticatedSeed) {
      return true;
    }
    const allowed = isUrlAllowedByRobots(seed.normalizedUrl, robotsPolicy);
    if (!allowed) {
      blockedSeedRecords.push({
        ...seed,
        source: `${seed.source ?? 'seed'}_robots_blocked`,
        reasonCode: 'robots-disallowed',
        activationDecision: 'blocked',
      });
    }
    return allowed;
  };
  const authSeeds = ['authenticated_cookie', 'authenticated_browser'].includes(contract.crawlMode)
    ? authRouteSeeds.filter(robotsAllowedSeed)
    : [];
  const revisitSeeds = ['authenticated_cookie', 'authenticated_browser'].includes(contract.crawlMode)
    ? revisitRouteSeeds.filter(robotsAllowedSeed)
    : [];
  const requiresLoginSeeds = ['authenticated_cookie', 'authenticated_browser'].includes(contract.crawlMode)
    ? []
    : authRouteSeeds.map((seed) => ({
      ...seed,
      sourceLayer: 'authenticated',
      reasonCode: 'missing_auth_evidence',
      activationDecision: 'requires_login',
    }));
  const uniqueByUrl = (items) => arrayUniqueBy(items, (item) => item.normalizedUrl)
    .sort((left, right) => left.normalizedUrl.localeCompare(right.normalizedUrl, 'en'));
  return {
    publicSeeds: uniqueByUrl(publicSeedsLayer),
    authSeeds: uniqueByUrl(authSeeds),
    revisitSeeds: uniqueByUrl(revisitSeeds),
    blockedSeeds: uniqueByUrl(blockedSeedRecords),
    requiresLoginSeeds: uniqueByUrl(requiresLoginSeeds),
  };
}

function layeredSeedsSummary(layeredSeeds) {
  return {
    publicSeeds: layeredSeeds.publicSeeds?.length ?? 0,
    authSeeds: layeredSeeds.authSeeds?.length ?? 0,
    revisitSeeds: layeredSeeds.revisitSeeds?.length ?? 0,
    blockedSeeds: layeredSeeds.blockedSeeds?.length ?? 0,
    requiresLoginSeeds: layeredSeeds.requiresLoginSeeds?.length ?? 0,
  };
}

function firstNonBlankString(values = /** @type {any[]} */ ([])) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizedObservedRouteTemplate(context, normalizedUrl, item = /** @type {any} */ ({})) {
  const explicitTemplate = firstNonBlankString([
    item.routeTemplate,
    item.routePattern,
    item.instanceRouteTemplate,
    item.linkRouteTemplate,
  ]);
  if (explicitTemplate) {
    return explicitTemplate;
  }
  try {
    return normalizedAdapterRouteTemplate(normalizedUrl, context.site.rootUrl);
  } catch {
    return null;
  }
}

function observedRouteSeedUrlValues(item = /** @type {any} */ ({})) {
  return uniqueSortedStrings([
    item.href,
    item.linkHref,
    item.normalizedUrl,
    item.url,
    item.locator,
    item.path,
    item.endpoint?.url,
  ].filter((value) => typeof value === 'string' && value.trim()));
}

function routePathHasParameterPlaceholder(pathname) {
  return /(?:%3A|:[A-Za-z_][A-Za-z0-9_]*|\{[^}]+\})/iu.test(String(pathname ?? ''));
}

function observedRouteSeedKind(context, item = /** @type {any} */ ({}), normalizedUrl, routeTemplate) {
  let pathname = '/';
  try {
    pathname = new URL(normalizedUrl).pathname.replace(/\/+$/u, '') || '/';
  } catch {
    return null;
  }
  if (routePathHasParameterPlaceholder(pathname)) {
    return null;
  }
  const descriptor = [
    item.semanticKind,
    item.linkSemanticKind,
    item.structureType,
    item.linkStructureType,
    item.elementRole,
    item.instanceKind,
    item.pageType,
    item.type,
    item.kind,
    routeTemplate,
  ].map((value) => String(value ?? '')).join(' ');
  if (/^\/book\/\d+$/iu.test(pathname)) {
    return {
      seedKind: 'book-detail',
      source: 'observed_route_seed',
      reasonCode: 'observed-book-link',
      pageType: 'book-detail-page',
      confidence: 0.78,
      priority: 90,
    };
  }
  if (/^\/chapter\/\d+\/\d+$/iu.test(pathname)) {
    return {
      seedKind: 'chapter-detail',
      source: 'observed_route_seed',
      reasonCode: 'observed-chapter-link',
      pageType: 'chapter-page',
      confidence: 0.78,
      priority: 95,
    };
  }
  const contentDescriptor = /\b(?:book|chapter|work|content|article|story|novel)\b/iu.test(descriptor);
  const contentPath = /^\/(?:books?|chapters?|articles?|content|works?|stories?|novels?|detail|item|items)\/[^/?#]+/iu.test(pathname);
  if (contentDescriptor && contentPath) {
    return {
      seedKind: 'content-detail',
      source: 'observed_route_seed',
      reasonCode: 'observed-content-link',
      pageType: /chapter/iu.test(`${pathname} ${routeTemplate}`) ? 'chapter-page' : 'content-detail-page',
      confidence: 0.72,
      priority: 60,
    };
  }
  return null;
}

function observedRouteSeedArtifactItems(payload = /** @type {any} */ ({})) {
  const items = /** @type {any[]} */ ([]);
  if (Array.isArray(payload?.affordances)) {
    items.push(...payload.affordances);
  }
  if (Array.isArray(payload?.nodes)) {
    items.push(...payload.nodes);
  }
  if (Array.isArray(payload?.pages)) {
    for (const page of payload.pages) {
      items.push(page);
      if (Array.isArray(page?.links)) {
        items.push(...page.links);
      }
      if (Array.isArray(page?.elementInstances)) {
        items.push(...page.elementInstances);
      }
    }
  }
  return items.slice(0, OBSERVED_ROUTE_SEED_ITEM_SCAN_LIMIT);
}

function observedRouteSeedsFromArtifactItem(context, item, {
  sourceBuildId,
  sourceArtifact,
} = /** @type {any} */ ({})) {
  const seeds = /** @type {any[]} */ ([]);
  for (const urlValue of observedRouteSeedUrlValues(item)) {
    const normalizedUrl = routeTargetToUrl(context, urlValue);
    if (!normalizedUrl || !isInternalUrl(normalizedUrl, context.site.allowedDomains)) {
      continue;
    }
    const routeTemplate = normalizedObservedRouteTemplate(context, normalizedUrl, item);
    const routeKind = observedRouteSeedKind(context, item, normalizedUrl, routeTemplate);
    if (!routeKind) {
      continue;
    }
    const pathname = new URL(normalizedUrl).pathname || '/';
    seeds.push({
      url: normalizedUrl,
      normalizedUrl,
      source: routeKind.source,
      confidence: routeKind.confidence,
      pageType: routeKind.pageType,
      routeTemplate,
      sourceLayer: 'public',
      authRequired: false,
      reasonCode: routeKind.reasonCode,
      evidenceLevel: 'observed_route_candidate',
      observedSeedKind: routeKind.seedKind,
      observedSourceBuildId: sourceBuildId,
      observedSourceArtifact: sourceArtifact,
      observedSourceLayer: item?.sourceLayer ?? null,
      priority: routeKind.priority,
      evidence: [
        buildEvidence({
          type: 'url',
          source: `build:${sourceBuildId}:${sourceArtifact}`,
          text: `observed ${routeKind.seedKind} route ${pathname} from sanitized prior build artifact; raw page content was not persisted.`,
          confidence: routeKind.confidence,
        }),
      ],
    });
  }
  return seeds;
}

async function previousBuildIdsForObservedRouteSeeds(context) {
  const buildsDir = context.workspace?.paths?.buildsDir;
  if (!buildsDir || !await pathExists(buildsDir)) {
    return [];
  }
  let entries = [];
  try {
    entries = await readdir(buildsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((buildId) => buildId !== context.buildId && /^[A-Za-z0-9._-]+$/u.test(buildId))
    .sort((left, right) => right.localeCompare(left, 'en'))
    .slice(0, OBSERVED_ROUTE_SEED_BUILD_SCAN_LIMIT);
}

async function observedRouteSeedPromotionForContext(context, {
  maxSeeds = OBSERVED_ROUTE_SEED_BUDGET,
} = /** @type {any} */ ({})) {
  const limit = Math.max(0, Math.min(OBSERVED_ROUTE_SEED_BUDGET, Number(maxSeeds) || 0));
  if (!limit) {
    return {
      status: 'skipped',
      reasonCode: 'observed-route-seed-budget-empty',
      scannedBuildIds: [],
      candidateCount: 0,
      promotedCount: 0,
      truncatedCount: 0,
      seeds: [],
    };
  }
  const buildIds = await previousBuildIdsForObservedRouteSeeds(context);
  const candidates = /** @type {any[]} */ ([]);
  const scannedArtifacts = [];
  for (const buildId of buildIds) {
    for (const artifactName of OBSERVED_ROUTE_SEED_ARTIFACT_NAMES) {
      const artifactPath = path.join(context.workspace.paths.buildsDir, buildId, artifactName);
      const payload = await readJsonIfExists(artifactPath, null);
      if (!payload) {
        continue;
      }
      scannedArtifacts.push({ buildId, artifactName });
      for (const item of observedRouteSeedArtifactItems(payload)) {
        candidates.push(...observedRouteSeedsFromArtifactItem(context, item, {
          sourceBuildId: buildId,
          sourceArtifact: artifactName,
        }));
      }
    }
  }
  const deduped = arrayUniqueBy(
    candidates
      .sort((left, right) => (
        Number(right.priority ?? 0) - Number(left.priority ?? 0)
        || String(right.observedSourceBuildId ?? '').localeCompare(String(left.observedSourceBuildId ?? ''), 'en')
        || String(left.normalizedUrl).localeCompare(String(right.normalizedUrl), 'en')
      )),
    (seed) => seed.normalizedUrl,
  );
  const seeds = deduped.slice(0, limit).map(({ priority, ...seed }) => seed);
  return {
    status: seeds.length ? 'promoted' : buildIds.length ? 'empty' : 'no_prior_builds',
    scannedBuildIds: buildIds,
    scannedArtifactCount: scannedArtifacts.length,
    candidateCount: candidates.length,
    uniqueCandidateCount: deduped.length,
    promotedCount: seeds.length,
    truncatedCount: Math.max(0, deduped.length - seeds.length),
    seeds,
  };
}

function setupProfileRobotsPolicy(context = /** @type {any} */ ({})) {
  const robots = context.setupProfile?.robots;
  if (robots?.status !== 'parsed') {
    return null;
  }
  return {
    userAgent: 'SiteForgeBuildStaticCrawler',
    baseUrl: context.site.rootUrl,
    sitemaps: uniqueSortedStrings(robots.sitemaps ?? []),
    groups: [{
      agents: ['*'],
      rules: (robots.disallowPaths ?? [])
        .filter(Boolean)
        .map((pathValue) => ({
          type: 'disallow',
          path: String(pathValue),
        })),
    }],
    disallowPaths: uniqueSortedStrings(robots.disallowPaths ?? []),
  };
}

function buildRobotsDiscoveryReport(context, {
  robotsPolicy = null,
  robotsStatus = 'unavailable',
  robotsUnavailableReason = null,
  sitemapUrls = /** @type {Set<string>|string[]} */ ([]),
  processedSitemaps = /** @type {Set<string>|string[]} */ ([]),
  robotsExcludedUrls = /** @type {any[]} */ ([]),
  robotsDecisionRecords = /** @type {any[]} */ ([]),
} = /** @type {any} */ ({})) {
  const sitemapList = robotsPolicy?.sitemaps ?? [...sitemapUrls].sort((left, right) => left.localeCompare(right, 'en'));
  const processedSitemapList = [...processedSitemaps].sort((left, right) => left.localeCompare(right, 'en'));
  const selected = robotsPolicy ? selectRobotsGroups(robotsPolicy) : {
    userAgent: 'siteforgebuildstaticcrawler',
    groups: [],
    matchType: 'none',
    fallbackToWildcard: false,
  };
  const selectedRules = selected.groups.flatMap((group) => group.rules ?? []);
  const selectedCrawlDelaySeconds = selected.groups
    .map((group) => Number(group.crawlDelaySeconds))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const crawlDelaySeconds = selectedCrawlDelaySeconds.length
    ? Math.max(...selectedCrawlDelaySeconds)
    : null;
  const effectiveFetchDelayMs = Math.max(
    Number(context.policy?.fetchDelayMs ?? 0) || 0,
    crawlDelaySeconds === null ? 0 : crawlDelaySeconds * 1000,
  );
  const dedupedDecisions = arrayUniqueBy(
    robotsDecisionRecords
      .filter((record) => record?.url)
      .map((record) => ({
        url: normalizeUrl(record.url, context.site.rootUrl),
        source: String(record.source ?? 'planned').slice(0, 80),
        allowed: record.allowed === true,
        matchedRule: record.matchedRule ?? null,
      })),
    (record) => `${record.url}:${record.source}`,
  ).sort((left, right) => `${left.source}:${left.url}`.localeCompare(`${right.source}:${right.url}`, 'en'));
  const allowedCount = dedupedDecisions.filter((record) => record.allowed).length;
  const deniedCount = dedupedDecisions.filter((record) => !record.allowed).length;
  const policyClassification = robotsStatus === 'unavailable'
    ? 'robots_unavailable'
    : !dedupedDecisions.length
      ? 'no_planned_urls'
      : deniedCount > 0 && allowedCount === 0
        ? 'siteforge_scope_disallowed'
        : deniedCount > 0
          ? 'partial_allowed'
          : 'all_allowed';
  return {
    status: robotsStatus,
    reason: robotsUnavailableReason,
    source: robotsStatus === 'parsed' ? 'live_robots_txt' : robotsStatus,
    userAgent: robotsPolicy?.userAgent ?? 'SiteForgeBuildStaticCrawler',
    selectedGroup: {
      agents: uniqueSortedStrings(selected.groups.flatMap((group) => group.agents ?? [])),
      matchType: selected.matchType,
      fallbackToWildcard: selected.fallbackToWildcard,
    },
    policyClassification,
    crawlDelaySeconds,
    effectiveFetchDelayMs,
    rulePrecedence: 'longest_path_then_allow_tie',
    rules: {
      allow: selectedRules.filter((rule) => rule.type === 'allow' && rule.path).length,
      disallow: selectedRules.filter((rule) => rule.type === 'disallow' && rule.path).length,
      emptyDisallow: selectedRules.filter((rule) => rule.type === 'disallow' && !rule.path).length,
    },
    sitemaps: sitemapList,
    sitemapSummary: {
      declared: sitemapList,
      processed: processedSitemapList.length,
      processedUrls: processedSitemapList,
    },
    disallowPaths: robotsPolicy?.disallowPaths ?? [],
    excludedUrls: uniqueSortedStrings(robotsExcludedUrls),
    decisions: {
      planned: dedupedDecisions.length,
      allowed: allowedCount,
      denied: deniedCount,
      deniedSamples: dedupedDecisions
        .filter((record) => !record.allowed)
        .slice(0, 20),
    },
  };
}

function knownPolicyBusinessCoverageForContext(context = /** @type {any} */ ({})) {
  return context.setupProfile?.knownSitePolicy?.businessCoverageModel
    ?? knownPolicyBusinessCoverageModel(context.setupProfile?.knownSitePolicy)
    ?? null;
}

function seedBusinessCoverageGroup(context, seed = /** @type {any} */ ({})) {
  const explicit = String(seed.businessCoverageGroup ?? seed.coverageGroup ?? seed.businessArea ?? '').trim();
  if (explicit) {
    return explicit;
  }
  const pathText = (() => {
    try {
      return new URL(seed.normalizedUrl ?? seed.url, context.site.rootUrl).pathname.toLowerCase();
    } catch {
      return String(seed.normalizedUrl ?? seed.url ?? '').toLowerCase();
    }
  })();
  const text = [
    pathText,
    seed.pageType,
    seed.routeTemplate,
    seed.reasonCode,
    seed.source,
  ].join(' ').toLowerCase();
  const policyRoute = (context.setupProfile?.knownSitePolicy?.publicRouteTemplates ?? []).find((route) => {
    const target = route.path ?? route.route ?? route.pathTemplate ?? route.routeTemplate ?? null;
    if (!target) return false;
    try {
      const routePath = new URL(normalizeUrl(target, context.site.rootUrl)).pathname.replace(/\/+$/u, '') || '/';
      return routePath === (pathText.replace(/\/+$/u, '') || '/');
    } catch {
      return false;
    }
  });
  if (policyRoute) return knownPolicyBusinessAreaForRoute(policyRoute);
  if (pathText === '/' || /home/u.test(text)) return 'home';
  if (/search|keyword|query/u.test(text)) return 'search';
  if (/reserve/u.test(text)) return 'reserve-listings';
  if (/newrelease|release|archive|date/u.test(text)) return 'release-listings';
  if (/news|blog|column|article/u.test(text)) return 'news-updates';
  if (/series/u.test(text)) return 'series-directory';
  if (/label/u.test(text)) return 'label-directory';
  if (/maker|studio/u.test(text)) return 'maker-directory';
  if (/tag|topic/u.test(text)) return 'topic-directory';
  if (/ranking|rank|top|hot|popular|latest|recent|trending/u.test(text)) return 'ranking-lists';
  if (/event|media/u.test(text)) return 'event-media';
  if (/actress|performer|actor|model|talent|author|girls|profile/u.test(text)) return 'person-directory';
  if (/genre|categor|channel/u.test(text)) return 'genre-directory';
  if (/works?\/detail|details?|content-detail|book-detail|videos?\/[^/]+/u.test(text)) return 'detail-pages';
  if (/sitemap/u.test(text)) return 'sitemap';
  if (/help|support|faq/u.test(text)) return 'help';
  if (/contact|inquiry/u.test(text)) return 'contact-boundary';
  if (/privacy|policy|terms/u.test(text)) return 'policy-pages';
  if (/company|about|contents|link|recruit|download|utility/u.test(text)) return 'utility-pages';
  return routeFamilyKeyForSeed(seed.normalizedUrl ?? seed.url, context.site.rootUrl);
}

function seedBusinessPriority(seed = /** @type {any} */ ({})) {
  const source = String(seed.source ?? '');
  if (source === 'input') return 1000;
  if (source === 'input_path') return 990;
  if (source === 'known_site_public_route_template') return 900;
  if (source === 'coverage_target_public_route') return 880;
  if (source === 'observed_route_seed') return 760;
  if (source === 'sitemap') return 700;
  if (source === 'canonical') return 680;
  if (source === 'homepage_link') return 660;
  return 500;
}

function dedupeSeedsByUrl(seeds = /** @type {any[]} */ ([])) {
  return arrayUniqueBy(seeds, (seed) => seed.normalizedUrl)
    .sort((left, right) => left.normalizedUrl.localeCompare(right.normalizedUrl, 'en'));
}

function comprehensiveCoverageSeedSelection(context, seeds = /** @type {any[]} */ ([]), maxSeeds = 0) {
  const inventory = dedupeSeedsByUrl(seeds);
  const limit = Math.max(1, Number(maxSeeds) || 1);
  const model = knownPolicyBusinessCoverageForContext(context);
  const groupPriority = new Map((model?.groups ?? []).map((group) => [group.id, Number(group.priority ?? 0) || 0]));
  const requiredGroups = new Set(model?.requiredGroupIds ?? []);
  const decorated = inventory.map((seed, index) => {
    const group = seedBusinessCoverageGroup(context, seed);
    return {
      seed: { ...seed, businessCoverageGroup: group },
      index,
      group,
      sourcePriority: seedBusinessPriority(seed),
      groupPriority: groupPriority.get(group) ?? 0,
    };
  }).sort((left, right) => (
    right.sourcePriority - left.sourcePriority
    || right.groupPriority - left.groupPriority
    || left.seed.normalizedUrl.localeCompare(right.seed.normalizedUrl, 'en')
    || left.index - right.index
  ));
  if (decorated.length <= limit) {
    const selected = decorated.map((entry) => entry.seed)
      .sort((left, right) => left.normalizedUrl.localeCompare(right.normalizedUrl, 'en'));
    const selectedGroups = new Set(selected.map((seed) => seed.businessCoverageGroup).filter(Boolean));
    return {
      seeds: selected,
      inventory,
      model,
      truncatedCount: 0,
      requiredGroups: [...requiredGroups].sort(),
      selectedGroups: [...selectedGroups].sort(),
      missingRequiredGroups: [...requiredGroups].filter((group) => !selectedGroups.has(group)).sort(),
      warnings: [],
    };
  }
  const selectedByUrl = new Map();
  const add = (entry) => {
    if (selectedByUrl.size >= limit || !entry?.seed?.normalizedUrl || selectedByUrl.has(entry.seed.normalizedUrl)) {
      return false;
    }
    selectedByUrl.set(entry.seed.normalizedUrl, entry.seed);
    return true;
  };
  for (const entry of decorated.filter((candidate) => candidate.sourcePriority >= 990)) add(entry);
  for (const group of [...requiredGroups].sort((left, right) => (groupPriority.get(right) ?? 0) - (groupPriority.get(left) ?? 0) || left.localeCompare(right, 'en'))) {
    add(decorated.find((candidate) => candidate.group === group));
  }
  for (const entry of decorated.filter((candidate) => candidate.sourcePriority >= 880)) add(entry);
  const selectedGroupCounts = new Map();
  for (const seed of selectedByUrl.values()) {
    const group = seed.businessCoverageGroup ?? 'unknown';
    selectedGroupCounts.set(group, (selectedGroupCounts.get(group) ?? 0) + 1);
  }
  for (const entry of decorated) {
    if (selectedByUrl.size >= limit) break;
    const count = selectedGroupCounts.get(entry.group) ?? 0;
    if (count >= Math.max(1, Math.min(4, representativeLimitForRouteFamily(entry.group)))) {
      continue;
    }
    if (add(entry)) {
      selectedGroupCounts.set(entry.group, count + 1);
    }
  }
  for (const entry of decorated) {
    if (selectedByUrl.size >= limit) break;
    add(entry);
  }
  const selected = [...selectedByUrl.values()]
    .sort((left, right) => left.normalizedUrl.localeCompare(right.normalizedUrl, 'en'));
  const selectedGroups = new Set(selected.map((seed) => seed.businessCoverageGroup).filter(Boolean));
  const missingRequiredGroups = [...requiredGroups].filter((group) => !selectedGroups.has(group)).sort();
  return {
    seeds: selected,
    inventory,
    model,
    truncatedCount: Math.max(0, decorated.length - selected.length),
    requiredGroups: [...requiredGroups].sort(),
    selectedGroups: [...selectedGroups].sort(),
    missingRequiredGroups,
    warnings: [
      `business coverage seed selection preserved ${selectedGroups.size} coverage groups from ${decorated.length} candidate seeds under maxSeeds=${limit}.`,
      ...(missingRequiredGroups.length ? [`business coverage seed selection missed required groups: ${missingRequiredGroups.join(', ')}`] : []),
    ],
  };
}

async function discoverSeedsStage(context) {
  markStageSubstepProgress(context, 'loadKnownPolicy', {
    message: '加载已知站点策略和 robots 候选。',
    processedCount: 0,
    totalCount: context.site.allowedDomains?.length ?? 1,
    discoveredCount: knownPolicyPublicSeedRoutes(context).length,
    currentItem: context.site.rootUrl,
  });
  const seeds = /** @type {any[]} */ ([]);
  const warnings = /** @type {any[]} */ ([]);
  const reasonCodes = new Set();
  const robotsExcludedUrls = /** @type {any[]} */ ([]);
  let robotsPolicy = null;
  let robotsStatus = 'unavailable';
  let robotsUnavailableReason = null;
  const robotsDecisionRecords = /** @type {any[]} */ ([]);
  const isRobotsAllowed = (urlValue, source = 'planned') => {
    if (!robotsPolicy) {
      return true;
    }
    const normalized = normalizeUrl(urlValue, context.site.rootUrl);
    const decision = robotsDecisionForUrl(normalized, robotsPolicy);
    robotsDecisionRecords.push({
      url: normalized,
      source,
      allowed: decision.allowed,
      matchedRule: decision.matchedRule,
    });
    if (!decision.allowed) {
      robotsExcludedUrls.push(normalized);
      reasonCodes.add('robots-disallowed');
    }
    return decision.allowed;
  };
  const addSeed = (urlValue, source, confidence, evidence, metadata = /** @type {any} */ ({})) => {
    const normalizedUrl = normalizeUrl(urlValue, context.site.rootUrl);
    if (!isInternalUrl(normalizedUrl, context.site.allowedDomains)) {
      return false;
    }
    if (!isRobotsAllowed(normalizedUrl, source)) {
      return false;
    }
    seeds.push({
      url: urlValue,
      normalizedUrl,
      source,
      confidence,
      evidence,
      ...metadata,
    });
    return true;
  };
  const sitemapUrls = new Set();
  const processedSitemaps = new Set();
  const sitemapProgressStartedAt = Date.now();
  let skippedSitemapCount = 0;
  const sitemapReadTimeoutMs = Math.max(1_000, Number(
    context.options.sitemapReadTimeoutMs
    ?? context.options.sitemapTimeoutMs
    ?? Math.min(Number(context.policy.fetchTimeoutMs ?? 10_000) || 10_000, 15_000),
  ));
  const sitemapDiscoveryTimeoutMs = Math.max(sitemapReadTimeoutMs, Number(
    context.options.sitemapDiscoveryTimeoutMs
    ?? context.options.sitemapTotalTimeoutMs
    ?? 90_000,
  ));
  const markSitemapProgress = (message, currentItem = null, totalCount = sitemapUrls.size) => {
    markStageSubstep(context, 'readSitemaps', 'running', {
      message,
      currentItem: safeSubstepCurrentItem(currentItem),
      processedCount: processedSitemaps.size,
      totalCount,
      discoveredCount: seeds.length,
      skippedCount: skippedSitemapCount,
      elapsedMs: Date.now() - sitemapProgressStartedAt,
    });
  };
  markSitemapProgress('准备读取 robots 和 sitemap 候选。');
  const writeBlockedSeedsAndThrow = async (code, message) => {
    const deduped = arrayUniqueBy(seeds, (seed) => seed.normalizedUrl)
      .sort((left, right) => left.normalizedUrl.localeCompare(right.normalizedUrl, 'en'));
    const layeredSeeds = layeredSeedsForContext(context, deduped, robotsExcludedUrls, robotsPolicy);
    const payload = {
      schemaVersion: BUILD_SCHEMA_VERSION,
      buildId: context.buildId,
      siteId: context.site.id,
      status: 'blocked',
      seeds: deduped,
      ...layeredSeeds,
      robots: buildRobotsDiscoveryReport(context, {
        robotsPolicy,
        robotsStatus,
        robotsUnavailableReason,
        sitemapUrls,
        processedSitemaps,
        robotsExcludedUrls,
        robotsDecisionRecords,
      }),
      summary: layeredSeedsSummary(layeredSeeds),
      warnings,
    };
    markStageSubstepProgress(context, 'emitBoundary', {
      message: '写入阻断状态的 seed 边界产物。',
      processedCount: deduped.length,
      totalCount: deduped.length,
      discoveredCount: deduped.length,
      skippedCount: robotsExcludedUrls.length,
      currentItem: code,
    });
    const seedsPath = await writeArtifactJson(context, 'seeds.json', payload);
    const generatedAdapter = await writeGeneratedSiteAdapterProfile(context, {
      seeds: deduped,
      status: 'blocked_seed_plan',
      stage: 'discoverSeeds',
    });
    throw createBlockedStageError(code, message, {
      warnings,
      artifactPaths: {
        seeds: seedsPath,
        generatedAdapter: generatedAdapter.artifactPaths.generatedAdapter,
        siteGeneratedAdapter: generatedAdapter.artifactPaths.siteGeneratedAdapter,
      },
      reasonCodes: uniqueSortedStrings([...reasonCodes]),
      summary: {
        seeds: deduped.length,
        layeredSeeds: layeredSeedsSummary(layeredSeeds),
        generatedAdapter: generatedAdapter.summary,
      },
    });
  };
  try {
    const robotsUrl = new URL('/robots.txt', context.site.rootUrl).toString();
    const robots = await context.source.read(robotsUrl);
    robotsPolicy = parseRobotsPolicy(robots.body, context.site.rootUrl);
    robotsStatus = 'parsed';
    for (const sitemapUrl of robotsPolicy.sitemaps) {
      sitemapUrls.add(sitemapUrl);
    }
  } catch (error) {
    robotsUnavailableReason = error?.message ?? String(error);
    const setupPolicy = setupProfileRobotsPolicy(context);
    if (setupPolicy) {
      robotsPolicy = setupPolicy;
      robotsStatus = 'setup_profile';
      warnings.push(`robots.txt unavailable during seed discovery; reused parsed setup robots policy. ${robotsUnavailableReason}`);
      reasonCodes.add('robots-reused-from-setup');
      for (const sitemapUrl of robotsPolicy.sitemaps) {
        sitemapUrls.add(sitemapUrl);
      }
    } else if (knownPolicyAllowsRobotsUnavailableFallback(context)) {
      robotsPolicy = parseRobotsPolicy('User-agent: *\nAllow: /\n', context.site.rootUrl);
      robotsStatus = 'known_policy_fallback';
      warnings.push(`robots.txt unavailable; using explicit known-site public route templates under conservative read-only fallback. ${robotsUnavailableReason}`);
      reasonCodes.add('robots-unavailable');
    } else {
      const warning = `robots.txt unavailable: ${robotsUnavailableReason}`;
      warnings.push(warning);
      reasonCodes.add('robots-unavailable');
      await writeBlockedSeedsAndThrow(
        'robots-unavailable',
        `robots.txt unavailable for live SiteForge build: ${robotsUnavailableReason}`,
      );
    }
  }

  const homepageEvidence = [
    buildEvidence({
      type: 'url',
      source: context.site.rootUrl,
      confidence: 1,
    }),
  ];
  addSeed(context.site.rootUrl, 'input', 1, homepageEvidence);
  const normalizedInputUrl = normalizeUrl(context.site.normalizedUrl ?? context.site.rootUrl, context.site.rootUrl);
  const normalizedRootUrl = normalizeUrl(context.site.rootUrl, context.site.rootUrl);
  if (normalizedInputUrl !== normalizedRootUrl) {
    addSeed(normalizedInputUrl, 'input_path', 1, [
      buildEvidence({
        type: 'url',
        source: normalizedInputUrl,
        text: `original build URL path ${new URL(normalizedInputUrl).pathname}; raw page content was not persisted.`,
        confidence: 1,
      }),
    ], {
      sourceLayer: 'public',
      authRequired: false,
      reasonCode: 'input-path-seed',
      evidenceLevel: 'public_verified',
    });
  }
  for (const route of knownPolicyPublicSeedRoutes(context)) {
    if (route.normalizedUrl === normalizeUrl(context.site.rootUrl, context.site.rootUrl)) {
      continue;
    }
    addSeed(route.normalizedUrl, route.source, 0.68, [
      buildEvidence({
        type: 'url',
        source: context.site.rootUrl,
        text: `known-site public route seed ${new URL(route.normalizedUrl).pathname}; raw page content was not persisted.`,
        confidence: 0.68,
      }),
    ], {
      pageType: route.pageType,
      sourceLayer: 'public',
      authRequired: false,
      reasonCode: route.reasonCode,
      evidenceLevel: 'template_candidate',
      businessCoverageGroup: seedBusinessCoverageGroup(context, route),
    });
  }
  sitemapUrls.add(new URL('/sitemap.xml', context.site.rootUrl).toString());

  const maxSitemaps = Math.max(1, Number(context.policy.maxSitemaps ?? 10));
  const pendingSitemaps = [...sitemapUrls].sort((left, right) => left.localeCompare(right, 'en'));
  for (let index = 0; index < pendingSitemaps.length && processedSitemaps.size < maxSitemaps; index += 1) {
    if (Date.now() - sitemapProgressStartedAt > sitemapDiscoveryTimeoutMs) {
      const warning = `sitemap discovery timed out after ${sitemapDiscoveryTimeoutMs}ms; ${Math.max(0, pendingSitemaps.length - processedSitemaps.size)} sitemap URLs were left out.`;
      warnings.push(warning);
      reasonCodes.add('sitemap-discovery-timeout');
      markSitemapProgress('sitemap 发现达到总耗时保护，跳过剩余 sitemap。', null, pendingSitemaps.length);
      break;
    }
    const sitemapUrl = pendingSitemaps[index];
    if (processedSitemaps.has(sitemapUrl)) {
      skippedSitemapCount += 1;
      markSitemapProgress('跳过已处理 sitemap。', sitemapUrl, pendingSitemaps.length);
      continue;
    }
    markSitemapProgress('正在读取 sitemap。', sitemapUrl, pendingSitemaps.length);
    processedSitemaps.add(sitemapUrl);
    try {
      const sitemap = await withOperationTimeout(
        context.source.read(sitemapUrl),
        sitemapReadTimeoutMs,
        `sitemap read timed out after ${sitemapReadTimeoutMs}ms: ${sitemapUrl}`,
        'sitemap-read-timeout',
      );
      const locs = parseSitemapUrls(sitemap.body, context.site.rootUrl);
      if (/<sitemapindex\b/iu.test(sitemap.body)) {
        for (const loc of locs) {
          const normalizedLoc = normalizeUrl(loc, context.site.rootUrl);
          if (
            isInternalUrl(normalizedLoc, context.site.allowedDomains)
            && !processedSitemaps.has(normalizedLoc)
            && !pendingSitemaps.includes(normalizedLoc)
          ) {
            pendingSitemaps.push(normalizedLoc);
          }
        }
        pendingSitemaps.sort((left, right) => left.localeCompare(right, 'en'));
        markSitemapProgress(`读取 sitemap 索引，新增 ${locs.length} 个候选。`, sitemapUrl, pendingSitemaps.length);
        continue;
      }
      let addedFromSitemap = 0;
      for (const loc of locs) {
        const added = addSeed(loc, 'sitemap', 0.95, [
          buildEvidence({
            type: 'url',
            source: sitemap.sourcePath ?? sitemapUrl,
            text: loc,
            confidence: 0.95,
          }),
        ]);
        if (added) {
          addedFromSitemap += 1;
        }
      }
      markSitemapProgress(`读取 sitemap 完成，新增 ${addedFromSitemap} 个 seed。`, sitemapUrl, pendingSitemaps.length);
    } catch (error) {
      skippedSitemapCount += 1;
      const warning = `sitemap unavailable: ${sitemapUrl}: ${error?.message ?? String(error)}`;
      warnings.push(warning);
      const classified = classifySiteForgeWarning(warning);
      if (classified?.reasonCode) {
        reasonCodes.add(classified.reasonCode);
      }
      if (error?.reasonCode) {
        reasonCodes.add(error.reasonCode);
      }
      markSitemapProgress(`sitemap 读取失败：${error?.reasonCode ?? error?.message ?? 'unavailable'}`, sitemapUrl, pendingSitemaps.length);
    }
  }
  markSitemapProgress('sitemap 发现完成。', null, pendingSitemaps.length);
  if (pendingSitemaps.length > processedSitemaps.size) {
    warnings.push(`sitemap discovery truncated at maxSitemaps=${maxSitemaps}; ${pendingSitemaps.length - processedSitemaps.size} sitemap URLs were left out.`);
  }

  try {
    if (robotsPolicy && !isRobotsAllowed(context.site.rootUrl, 'homepage_link_discovery')) {
      warnings.push('robots excluded homepage link discovery before crawl.');
      throw Object.assign(new Error('homepage link discovery blocked by robots.txt'), {
        code: 'robots-disallowed',
        reasonCode: 'robots-disallowed',
      });
    }
    const homepage = await context.source.read(context.site.rootUrl);
    const parsed = parseHtmlDocument(homepage.body, context.site.rootUrl);
    warnings.push(...staticDiagnosticWarnings(context.site.rootUrl, parsed.diagnostics));
    if (parsed.canonicalUrl) {
      addSeed(parsed.canonicalUrl, 'canonical', 0.9, [
        buildEvidence({
          type: 'dom',
          source: homepage.sourcePath ?? context.site.rootUrl,
          selector: 'link[rel="canonical"]',
          text: parsed.canonicalUrl,
          confidence: 0.9,
        }),
      ]);
    }
    for (const link of parsed.links) {
      addSeed(link.href, 'homepage_link', 0.75, [
        buildEvidence({
          type: 'dom',
          source: homepage.sourcePath ?? context.site.rootUrl,
          selector: link.selector,
          text: link.label,
          confidence: 0.75,
        }),
      ]);
    }
  } catch (error) {
    const warning = `homepage link discovery failed: ${error?.message ?? String(error)}`;
    warnings.push(warning);
    const classified = classifySiteForgeWarning(warning);
    if (classified?.reasonCode) {
      reasonCodes.add(classified.reasonCode);
    }
  }

  const maxSeeds = Math.max(1, Number(context.policy.maxSeeds ?? 100));
  const observedRouteSeedCapacity = Math.max(0, maxSeeds - arrayUniqueBy(seeds, (seed) => seed.normalizedUrl).length);
  const observedRouteSeedPromotion = await observedRouteSeedPromotionForContext(context, {
    maxSeeds: observedRouteSeedCapacity,
  });
  let observedRouteSeedAddedCount = 0;
  for (const seed of observedRouteSeedPromotion.seeds ?? []) {
    const added = addSeed(seed.normalizedUrl, seed.source, seed.confidence, seed.evidence, {
      pageType: seed.pageType,
      routeTemplate: seed.routeTemplate,
      sourceLayer: seed.sourceLayer,
      authRequired: seed.authRequired,
      reasonCode: seed.reasonCode,
      evidenceLevel: seed.evidenceLevel,
      observedSeedKind: seed.observedSeedKind,
      observedSourceBuildId: seed.observedSourceBuildId,
      observedSourceArtifact: seed.observedSourceArtifact,
      observedSourceLayer: seed.observedSourceLayer,
    });
    if (added) {
      observedRouteSeedAddedCount += 1;
    }
  }
  if (observedRouteSeedAddedCount > 0) {
    warnings.push(`observed route seed promotion added ${observedRouteSeedAddedCount} previously observed content routes from sanitized same-site build artifacts.`);
  }
  if (observedRouteSeedPromotion.truncatedCount > 0) {
    warnings.push(`observed route seed promotion truncated ${observedRouteSeedPromotion.truncatedCount} candidate routes at maxSeeds=${maxSeeds}.`);
  }

  markStageSubstepProgress(context, 'rankSeeds', {
    message: '排序、去重并限制种子 URL。',
    processedCount: seeds.length,
    totalCount: seeds.length,
    discoveredCount: observedRouteSeedAddedCount,
    skippedCount: robotsExcludedUrls.length + (observedRouteSeedPromotion.truncatedCount ?? 0),
  });
  const seedSelection = comprehensiveCoverageSeedSelection(context, seeds, maxSeeds);
  const dedupedAll = seedSelection.inventory;
  const deduped = seedSelection.seeds;
  warnings.push(...seedSelection.warnings);
  markStageSubstepProgress(context, 'rankSeeds', {
    message: '种子 URL 排序完成。',
    processedCount: deduped.length,
    totalCount: dedupedAll.length,
    discoveredCount: deduped.length,
    skippedCount: Math.max(0, dedupedAll.length - deduped.length) + robotsExcludedUrls.length,
  });
  if (deduped.length < dedupedAll.length) {
    warnings.push(`seed discovery truncated at maxSeeds=${maxSeeds}; ${dedupedAll.length - deduped.length} seeds were left out.`);
  }
  const publicRoutesFromSeeds = deduped
    .map((seed) => {
      try {
        return sanitizeRouteTargetForPersistence(new URL(seed.normalizedUrl ?? seed.url).pathname || '/', context.site);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const currentCoverageTargets = context.crawlContract?.coverageTargets ?? {};
  const publicRoutes = uniqueSortedStrings([
    ...(currentCoverageTargets.publicRoutes ?? []),
    ...publicRoutesFromSeeds,
  ]);
  const configuredAuthRoutes = uniqueSortedStrings([
    ...(currentCoverageTargets.authRoutes ?? []),
    ...(context.options.authRoutes ?? []),
    ...(context.options.localBuildConfig?.authRoutes ?? []),
  ]);
  const cookieAuthenticatedCrawl = context.authRuntime?.method === 'cookie'
    || context.authStateReport?.authMethod === 'cookie'
    || context.options?.authMode === 'cookie';
  const automaticPublicRevisitRoutes = cookieAuthenticatedCrawl
    ? []
    : publicRoutes.slice(
      0,
      Math.max(0, AUTO_PUBLIC_REVISIT_ROUTE_BUDGET - configuredAuthRoutes.length),
    );
  const configuredPublicRevisitRoutes = currentCoverageTargets.publicRevisitRoutes ?? [];
  const explicitPublicRevisitRoutes = [
    ...(context.options.publicRevisitRoutes ?? []),
    ...(context.options.localBuildConfig?.publicRevisitRoutes ?? []),
  ];
  context.crawlContract = {
    ...(context.crawlContract ?? createCrawlContract({
      site: context.site,
      authStateReport: context.authStateReport,
      coverageTargets: {},
    })),
    coverageTargets: {
      ...currentCoverageTargets,
      publicRoutes,
      publicRevisitRoutes: uniqueSortedStrings([
        ...configuredPublicRevisitRoutes,
        ...(explicitPublicRevisitRoutes.length ? explicitPublicRevisitRoutes : automaticPublicRevisitRoutes),
      ]),
    },
  };
  const hasAuthorizedSourceEvidence = hasAuthorizedSourceStructureEvidence(context);
  const layeredSeeds = layeredSeedsForContext(context, deduped, robotsExcludedUrls, robotsPolicy);
  const authenticatedSeedCount = (layeredSeeds.authSeeds?.length ?? 0) + (layeredSeeds.revisitSeeds?.length ?? 0);
  const hasUserAuthorizedBrowserSeedEvidence = authenticatedSeedCount > 0
    && (
      context.options?.userAuthorizedBrowserLive === true
      || context.options?.browserBridgeUserAuthorizedLive === true
    )
    && context.authStateReport?.authMethod === 'browser'
    && canRunAuthenticatedLayer(context.authStateReport);
  const authenticatedProviderId = context.crawlContract?.authMethod === 'browser' ? 'browser_bridge' : 'cookie_http';
  const evidenceTargets = {
    public_http: (layeredSeeds.publicSeeds ?? []).map((seed) => seed.normalizedUrl ?? seed.url).filter(Boolean),
    [authenticatedProviderId]: [
      ...(layeredSeeds.authSeeds ?? []),
      ...(layeredSeeds.revisitSeeds ?? []),
    ].map((seed) => seed.normalizedUrl ?? seed.url).filter(Boolean),
    authorized_summary: hasAuthorizedSourceEvidence ? ['configured-authorized-sources'] : [],
    public_rendered: [],
  };
  const payload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    status: deduped.length
      ? 'success'
      : hasAuthorizedSourceEvidence
        ? 'authorized_source_only'
        : hasUserAuthorizedBrowserSeedEvidence
          ? 'authenticated_route_only'
          : 'blocked',
    seeds: deduped,
    ...layeredSeeds,
    robots: buildRobotsDiscoveryReport(context, {
      robotsPolicy,
      robotsStatus,
      robotsUnavailableReason,
      sitemapUrls,
      processedSitemaps,
      robotsExcludedUrls,
      robotsDecisionRecords,
    }),
    evidenceTargets,
    businessCoverageSeedSelection: {
      schemaVersion: seedSelection.model?.schemaVersion ?? 1,
      status: seedSelection.model ? 'configured' : 'not_configured',
      configuredGroupCount: seedSelection.model?.groupCount ?? 0,
      requiredGroups: seedSelection.requiredGroups,
      selectedGroups: seedSelection.selectedGroups,
      missingRequiredGroups: seedSelection.missingRequiredGroups,
      candidateSeedCount: dedupedAll.length,
      selectedSeedCount: deduped.length,
      truncatedSeedCount: seedSelection.truncatedCount,
      model: seedSelection.model,
    },
    observedRouteSeedPromotion: {
      ...observedRouteSeedPromotion,
      seeds: undefined,
      addedCount: observedRouteSeedAddedCount,
    },
    summary: layeredSeedsSummary(layeredSeeds),
    warnings,
  };
  markStageSubstepProgress(context, 'emitBoundary', {
    message: '写入抓取边界、seed 和 adapter 产物。',
    processedCount: deduped.length,
    totalCount: dedupedAll.length,
    discoveredCount: (layeredSeeds.publicSeeds?.length ?? 0) + (layeredSeeds.authSeeds?.length ?? 0) + (layeredSeeds.revisitSeeds?.length ?? 0),
    skippedCount: Math.max(0, dedupedAll.length - deduped.length) + robotsExcludedUrls.length,
    currentItem: payload.status,
  });
  const seedsPath = await writeArtifactJson(context, 'seeds.json', payload);
  const generatedAdapter = await writeGeneratedSiteAdapterProfile(context, {
    seeds: deduped,
    status: payload.status === 'blocked' ? 'blocked_seed_plan' : 'route_seeded',
    stage: 'discoverSeeds',
  });
  if (!deduped.length && !hasAuthorizedSourceEvidence && !hasUserAuthorizedBrowserSeedEvidence) {
    const blockedCode = reasonCodes.has('robots-disallowed')
      ? 'robots-disallowed'
      : 'siteforge-seed-discovery-empty';
    const blockedMessage = blockedCode === 'robots-disallowed'
      ? 'robots.txt disallows all planned seed URLs for this build.'
      : 'Seed discovery produced no crawlable URLs; build stopped before draft skill generation.';
    throw createBlockedStageError(
      blockedCode,
      blockedMessage,
      {
        warnings,
        artifactPaths: {
          seeds: seedsPath,
          generatedAdapter: generatedAdapter.artifactPaths.generatedAdapter,
          siteGeneratedAdapter: generatedAdapter.artifactPaths.siteGeneratedAdapter,
        },
        reasonCodes: uniqueSortedStrings([...reasonCodes]),
        summary: {
          seeds: 0,
          layeredSeeds: layeredSeedsSummary(layeredSeeds),
          generatedAdapter: generatedAdapter.summary,
        },
      },
    );
  }
  return {
    seeds: deduped,
    ...layeredSeeds,
    robots: payload.robots,
    robotsPolicy,
    robotsExcludedUrls: uniqueSortedStrings(robotsExcludedUrls),
    evidenceTargets,
    businessCoverageSeedSelection: payload.businessCoverageSeedSelection,
    warnings,
    authorizedSourceOnly: !deduped.length && hasAuthorizedSourceEvidence,
    authenticatedRouteOnly: !deduped.length && hasUserAuthorizedBrowserSeedEvidence,
    generatedAdapter: generatedAdapter.profile,
    artifactPaths: {
      seeds: seedsPath,
      generatedAdapter: generatedAdapter.artifactPaths.generatedAdapter,
      siteGeneratedAdapter: generatedAdapter.artifactPaths.siteGeneratedAdapter,
    },
    reasonCodes: uniqueSortedStrings([...reasonCodes]),
    summary: {
      seeds: deduped.length,
      layeredSeeds: layeredSeedsSummary(layeredSeeds),
      observedRouteSeeds: {
        status: observedRouteSeedPromotion.status,
        candidates: observedRouteSeedPromotion.uniqueCandidateCount ?? observedRouteSeedPromotion.candidateCount ?? 0,
        added: observedRouteSeedAddedCount,
        truncated: observedRouteSeedPromotion.truncatedCount ?? 0,
      },
      businessCoverage: {
        configuredGroups: seedSelection.model?.groupCount ?? 0,
        requiredGroups: seedSelection.requiredGroups.length,
        selectedGroups: seedSelection.selectedGroups.length,
        missingRequiredGroups: seedSelection.missingRequiredGroups,
      },
      generatedAdapter: generatedAdapter.summary,
    },
  };
}

const REPRESENTATIVE_ROUTE_FAMILY_MIN_SEEDS = 500;
const REPRESENTATIVE_ROUTE_FAMILY_LIVE_MIN_SEEDS = 80;
const REPRESENTATIVE_ROUTE_FAMILY_MAX_PAGES = 240;
const REPRESENTATIVE_ROUTE_FAMILY_LIVE_MAX_PAGES = 80;
const AUTO_PUBLIC_REVISIT_ROUTE_BUDGET = 31;
const OBSERVED_ROUTE_SEED_BUDGET = 120;
const OBSERVED_ROUTE_SEED_BUILD_SCAN_LIMIT = 12;
const OBSERVED_ROUTE_SEED_ITEM_SCAN_LIMIT = 800;
const OBSERVED_ROUTE_SEED_ARTIFACT_NAMES = Object.freeze([
  'affordances.json',
  'graph.json',
  'crawl_authenticated.json',
  'crawl_rendered.json',
  'crawl_static.json',
]);
const ROUTE_FAMILY_ROOTS = new Set([
  'actors',
  'actress',
  'actresses',
  'article',
  'articles',
  'author',
  'authors',
  'books',
  'categories',
  'category',
  'catalog',
  'collections',
  'detail',
  'item',
  'items',
  'latest',
  'latest-updates',
  'model',
  'models',
  'new',
  'new-release',
  'page',
  'product',
  'products',
  'ranking',
  'rankings',
  'search',
  'tag',
  'tags',
  'topic',
  'topics',
  'top-rated',
  'video',
  'videos',
  'watch',
  'work',
  'works',
]);
const ROUTE_FAMILY_SINGLETONS = new Set([
  'hot',
  'latest',
  'latest-updates',
  'new',
  'new-release',
  'ranking',
  'rankings',
  'search',
  'top-rated',
]);
const ROUTE_FAMILY_PAIR_ROOTS = new Set([
  's1',
  'series',
  'studios',
]);

function routeFamilyKeyForSeed(urlValue, rootUrl) {
  let parsed;
  try {
    parsed = new URL(urlValue, rootUrl);
  } catch {
    return String(urlValue ?? '');
  }
  const segments = parsed.pathname.split('/').filter(Boolean).map((segment) => segment.toLowerCase());
  if (!segments.length) {
    return '/';
  }
  const [first, second] = segments;
  if (ROUTE_FAMILY_SINGLETONS.has(first)) {
    return `/${first}`;
  }
  if (ROUTE_FAMILY_PAIR_ROOTS.has(first) && second) {
    return segments.length === 2 ? `/${first}/${second}` : `/${first}/${second}/:item`;
  }
  if (ROUTE_FAMILY_ROOTS.has(first)) {
    return segments.length === 1 ? `/${first}` : `/${first}/:item`;
  }
  return routePatternForUrl(parsed.toString());
}

function representativeLimitForRouteFamily(familyKey) {
  if (familyKey === '/') {
    return 1;
  }
  if (/\/(?:videos?|items?|works?|products?|detail|watch)\b/u.test(familyKey)) {
    return 18;
  }
  if (/\/(?:models?|actors?|actresses?|authors?)\b/u.test(familyKey)) {
    return 12;
  }
  if (/\/(?:categories?|tags?|topics?|catalog|collections?)\b/u.test(familyKey)) {
    return 12;
  }
  if (/\/(?:page|ranking|rankings|hot|latest|latest-updates|new-release|top-rated)\b/u.test(familyKey)) {
    return 8;
  }
  return 6;
}

function isConcreteObservedRouteSeed(seed = /** @type {any} */ ({})) {
  if (seed.source !== 'observed_route_seed' && !seed.observedSeedKind) {
    return false;
  }
  try {
    const pathname = new URL(seed.normalizedUrl ?? seed.url).pathname;
    return !routePathHasParameterPlaceholder(pathname);
  } catch {
    return false;
  }
}

function planRepresentativeCrawlCoverage(context, seeds, { maxPages }) {
  const seedList = Array.isArray(seeds) ? seeds : [];
  const routeFamilyThreshold = REPRESENTATIVE_ROUTE_FAMILY_LIVE_MIN_SEEDS;
  if (seedList.length <= routeFamilyThreshold) {
    return {
      mode: 'seed_inventory',
      seeds: seedList,
      familyCount: seedList.length,
      maxPages,
      warnings: [],
    };
  }
  const observedFrontierCount = seedList.filter(isConcreteObservedRouteSeed).length;
  const maxRepresentativePages = Math.max(
    1,
    Math.min(
      maxPages,
      observedFrontierCount > 0
        ? maxPages
        : Number(context.policy.maxRepresentativePages ?? (
          REPRESENTATIVE_ROUTE_FAMILY_LIVE_MAX_PAGES
        )),
    ),
  );
  const countsByFamily = new Map();
  const selected = /** @type {any[]} */ ([]);
  for (const seed of seedList) {
    if (selected.length >= maxRepresentativePages) {
      break;
    }
    const familyKey = routeFamilyKeyForSeed(seed.normalizedUrl, context.site.rootUrl);
    const familyCount = countsByFamily.get(familyKey) ?? 0;
    const concreteObserved = isConcreteObservedRouteSeed(seed);
    if (!concreteObserved && familyCount >= representativeLimitForRouteFamily(familyKey)) {
      continue;
    }
    countsByFamily.set(familyKey, familyCount + 1);
    selected.push({
      ...seed,
      representativeRouteFamily: familyKey,
      representativeObservedFrontier: concreteObserved,
    });
  }
  const selectedObservedFrontierCount = selected.filter((seed) => seed.representativeObservedFrontier === true).length;
  return {
    mode: 'route_family',
    seeds: selected,
    familyCount: countsByFamily.size,
    maxPages: Math.min(maxRepresentativePages, selected.length || 1),
    warnings: [
      `full coverage seed inventory collapsed to route-family representatives: ${seedList.length} seeds -> ${selected.length} representative crawl URLs; full seed inventory remains in seeds.json.`,
      ...(observedFrontierCount > 0
        ? [`observed route frontier preserved ${selectedObservedFrontierCount}/${observedFrontierCount} concrete observed route seeds in the crawl queue.`]
        : []),
    ],
  };
}

function configuredAuthorizedSources(context = /** @type {any} */ ({})) {
  const direct = context.options?.authorizedSources;
  const setup = context.setupProfile?.localBuildConfig?.authorizedSources;
  return Array.isArray(direct) && direct.length
    ? direct
    : Array.isArray(setup)
      ? setup
      : [];
}

function authorizedSourcePageInputs(source = /** @type {any} */ ({})) {
  const candidates = [
    source.structurePages,
    source.pages,
    source.structureSummary?.pages,
    source.structureSummary?.page ? [source.structureSummary.page] : null,
    source.structureSummary && !Array.isArray(source.structureSummary) ? [source.structureSummary] : null,
  ];
  return candidates.find((items) => Array.isArray(items) && items.length) ?? [];
}

function hasAuthorizedSourceStructureEvidence(context = /** @type {any} */ ({})) {
  return configuredAuthorizedSources(context).some((source) => authorizedSourcePageInputs(source).length > 0);
}

function authorizedSourceDeclaresAuthenticatedEvidence(source = /** @type {any} */ ({})) {
  const text = [
    source.id,
    source.kind,
    source.type,
    source.accessBasis,
    source.authorizationBasis,
    source.permissionScope,
    source.description,
  ].map((value) => String(value ?? '')).join(' ');
  return /\b(?:auth|authenticated|login|session|browser)\b/iu.test(text);
}

function authenticatedAuthorizedSourcePages(context = /** @type {any} */ ({}), stageResults = /** @type {any} */ ({})) {
  const authenticatedSourceIds = new Set(configuredAuthorizedSources(context)
    .filter((source) => authorizedSourceDeclaresAuthenticatedEvidence(source))
    .map((source) => sanitizedStructureText(source?.id, 80, null))
    .filter(Boolean));
  if (!authenticatedSourceIds.size) {
    return [];
  }
  const pages = Array.isArray(stageResults.crawlStatic?.authorizedSource?.pages)
    ? stageResults.crawlStatic.authorizedSource.pages
    : Array.isArray(stageResults.crawlStatic?.pages)
      ? stageResults.crawlStatic.pages.filter((page) => pageSourceLayer(page) === 'authorized_source')
      : [];
  return pages
    .filter((page) => authenticatedSourceIds.has(String(page?.sourceAuthorityId ?? '').trim()))
    .map((page) => ({
      ...page,
      authRequired: true,
      authVerificationStatus: 'authorized_source_verified',
      evidenceLevel: page.evidenceLevel ?? 'authorized_source_verified',
      textSummary: 'user-authorized authenticated structure summary; generic live crawl was not used for this evidence',
      collection: {
        ...(page.collection ?? {}),
        status: 'success',
        source: 'authorized_source_authenticated_sanitized_summary',
        genericLiveCrawlUsed: false,
      },
    }));
}

function authenticatedStructurePageInputs(summary = null) {
  return [
    ...(Array.isArray(summary?.authenticatedPages) ? summary.authenticatedPages : []),
    ...(Array.isArray(summary?.pages) ? summary.pages : []),
    ...(Array.isArray(summary?.authenticatedOverlayPages) ? summary.authenticatedOverlayPages : []),
    ...(Array.isArray(summary?.overlayPages) ? summary.overlayPages : []),
  ];
}

function hasAuthenticatedBrowserStructureEvidence(context = /** @type {any} */ ({})) {
  return context.authStateReport?.authMethod === 'browser'
    && canRunAuthenticatedLayer(context.authStateReport)
    && authenticatedStructurePageInputs(context.authenticatedStructureSummary).length > 0;
}

function normalizeAuthorizedSourceStructurePage(context, source, page, index = 0) {
  const fallbackUrl = page?.url ?? page?.normalizedUrl ?? source?.url ?? context.site.rootUrl;
  const authenticatedEvidence = authorizedSourceDeclaresAuthenticatedEvidence(source);
  const normalized = normalizePublicRenderedStructurePage(context, {
    ...page,
    url: fallbackUrl,
    normalizedUrl: page?.normalizedUrl ?? page?.url ?? fallbackUrl,
    pageType: page?.pageType ?? page?.page_type ?? 'authorized_source_summary',
    structureItems: Array.isArray(page?.structureItems) ? page.structureItems : page?.structureItem ? [page.structureItem] : [],
    routeTemplates: page?.routeTemplates ?? page?.route_templates ?? [],
  }, { fallbackUrl, respectRobots: false });
  if (!normalized || normalized.blocked === true) {
    return null;
  }
  const sourceId = sanitizedStructureText(source?.id, 80, `authorized-source-${index + 1}`);
  const sourceKind = sanitizedStructureText(source?.kind ?? source?.type, 80, 'user_sanitized_summary');
  const stateKey = `authorized_source:${sourceId}:${normalized.routeTemplate ?? normalized.routePath ?? index}`;
  return {
    ...normalized,
    sourceLayer: 'authorized_source',
    sourceAuthority: sourceKind,
    sourceAuthorityId: sourceId,
    authRequired: authenticatedEvidence,
    authVerificationStatus: authenticatedEvidence ? 'authorized_source_verified' : 'not_requested',
    evidenceLevel: normalized.evidenceStatus === 'structure_summary_present' ? 'authorized_source_verified' : 'candidate',
    discoveredBy: 'authorized_source',
    sourcePath: sourceId,
    title: normalized.title || `authorized source ${sourceId}`,
    textSummary: authenticatedEvidence
      ? 'user-authorized authenticated structure summary; generic live crawl was not used for this evidence'
      : 'authorized source sanitized structure summary; generic live crawl was not used for this evidence',
    elementInstances: Array.isArray(normalized.elementInstances)
      ? normalized.elementInstances.map((element) => ({
        ...element,
        evidenceLevel: 'authorized_source_verified',
      }))
      : [],
    routeState: {
      ...(normalized.routeState ?? {}),
      source: 'authorized-source-structure-summary',
      stateId: stateKey,
    },
    stateKey,
    diagnostics: {
      ...(normalized.diagnostics ?? {}),
      publicEvidenceStatus: normalized.evidenceStatus === 'structure_summary_present'
        ? 'authorized_source_structured'
        : 'authorized_source_route_seed_only',
      dynamicSignals: uniqueSortedStrings([
        ...(normalized.diagnostics?.dynamicSignals ?? []),
        'authorized-source-sanitized-summary',
      ]),
    },
    collection: {
      status: 'success',
      source: 'authorized_source_sanitized_summary',
      concurrent: false,
      genericLiveCrawlUsed: false,
    },
    evidence: [
      buildEvidence({
        type: 'text',
        source: sourceId,
        text: `${sourceKind} authorized source sanitized structure summary${authenticatedEvidence ? ' for authenticated site structure' : ''}; no cookie, token, raw HTML, raw DOM, private body, or browser profile was persisted.`,
        confidence: 0.74,
      }),
    ],
  };
}

function buildAuthorizedSourceManifest(context) {
  const sources = configuredAuthorizedSources(context);
  const warnings = [];
  const pages = [];
  const sourceRows = sources.slice(0, 20).map((source, sourceIndex) => {
    const pageInputs = authorizedSourcePageInputs(source);
    const normalizedPages = pageInputs
      .slice(0, 40)
      .map((page, pageIndex) => normalizeAuthorizedSourceStructurePage(context, source, page, pageIndex))
      .filter(Boolean);
    pages.push(...normalizedPages);
    if (pageInputs.length && !normalizedPages.length) {
      warnings.push(`authorized source ${source?.id ?? sourceIndex + 1} had no usable same-site sanitized structure pages.`);
    }
    return sanitizeReportPublicValue({
      id: source?.id ?? `authorized-source-${sourceIndex + 1}`,
      kind: source?.kind ?? source?.type ?? 'authorized_source',
      url: source?.url ?? null,
      accessBasis: source?.accessBasis ?? 'user_provided_contract',
      permissionScope: source?.permissionScope ?? 'sanitized_summary_only',
      allowedEvidence: uniqueSortedStrings(source?.allowedEvidence ?? []),
      genericCrawlAllowed: false,
      promotionAllowed: false,
      structurePagesProvided: pageInputs.length,
      structurePagesAccepted: normalizedPages.length,
    });
  });
  const manifest = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-authorized-source-manifest',
    buildId: context.buildId,
    siteId: context.site.id,
    status: pages.length ? 'structure_summary_available' : sources.length ? 'configured_without_structure_summary' : 'not_configured',
    sources: sourceRows,
    pages,
    summary: {
      configuredSources: sourceRows.length,
      structurePages: pages.length,
      genericCrawlAllowed: false,
      promotionAllowed: false,
      rawHtmlPersisted: false,
      rawDomPersisted: false,
      privateBodyPersisted: false,
      cookiePersisted: false,
      tokenPersisted: false,
      browserProfilePersisted: false,
    },
    warnings,
  };
  return { manifest, pages, warnings };
}

const RAW_PAGE_MATERIAL_DIR = 'raw_pages';

function pageMaterialIdForUrl(urlValue) {
  return stableNodeId('page-material', urlValue).replace(/[^A-Za-z0-9._-]/gu, '-');
}

function redactSensitiveHtmlTagAttributes(tag) {
  if (!/(?:csrf|xsrf|token|auth|authorization|cookie|session|sid|uid|password|secret)/iu.test(tag)) {
    return tag;
  }
  return tag.replace(/\s([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|[^\s"'=<>`]+)/gu, (match, name) => (
    /(?:csrf|xsrf|token|auth|authorization|cookie|session|sid|uid|password|secret|value|content)/iu.test(name)
      ? (/^(?:value|content)$/iu.test(name) ? ` ${name}="[REDACTED]"` : ' data-siteforge-redacted="[REDACTED]"')
      : match
  ));
}

function sanitizePersistedPageMaterialText(value) {
  return String(value ?? '')
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/giu, '$1[SITEFORGE_SCRIPT_BODY_REDACTED]$2')
    .replace(/<[^>]+>/gu, (tag) => redactSensitiveHtmlTagAttributes(tag))
    .replace(/"(token|api[_-]?key|secret|password|raw[_-]?body)"\s*:\s*"(?:\\.|[^"\\])*"/giu, '"$1":"[REDACTED]"')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu, '[REDACTED_AUTH]')
    .replace(/\bauthorization\s*[:=]\s*[^\r\n<>"']+/giu, '[REDACTED_AUTH_HEADER]')
    .replace(/\b(?:cookie|set-cookie)\s*[:=]\s*[^;\s<>"']+/giu, '[REDACTED_COOKIE_HEADER]')
    .replace(/\b(?:sid|uid|session(?:id)?|session[_-]?id|sessdata|access[_-]?token|refresh[_-]?token|token|csrf(?:[_-]?token)?|xsrf(?:[_-]?token)?|auth|api[_-]?key|secret|password)\s*[:=]\s*[^&;\s<>"']+/giu, '[REDACTED_SENSITIVE_ASSIGNMENT]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[REDACTED_EMAIL]')
    .replace(/\bsynthetic-[A-Za-z0-9._-]*(?:token|secret|private)[A-Za-z0-9._-]*\b/giu, '[REDACTED_SYNTHETIC_SECRET]')
    .replace(/\b(?:localStorage|sessionStorage)\b/gu, '[REDACTED_BROWSER_STORAGE]')
    .replace(/\b(?:userDataDir|browserProfile|browser profile)\b/giu, '[REDACTED_BROWSER_STATE]');
}

function sanitizePersistedPageHtml(html) {
  const sanitized = sanitizePersistedPageMaterialText(html);
  assertNoForbiddenPatterns(sanitized);
  return sanitized;
}

function sanitizePersistedPageBodyText(html) {
  const sanitized = sanitizePersistedPageMaterialText(stripHtml(html));
  assertNoForbiddenPatterns(sanitized);
  return sanitized;
}

async function writePublicRawPageMaterialArtifacts(context, pages = /** @type {any[]} */ ([]), materialByUrl = new Map()) {
  const manifestPages = [];
  const byNormalizedUrl = new Map();
  for (const page of pages) {
    const material = materialByUrl.get(page.normalizedUrl);
    if (!material?.html) {
      continue;
    }
    const materialId = pageMaterialIdForUrl(page.normalizedUrl);
    const htmlRelativePath = `${RAW_PAGE_MATERIAL_DIR}/${materialId}.html`;
    const domRelativePath = `${RAW_PAGE_MATERIAL_DIR}/${materialId}.dom.html`;
    const bodyTextRelativePath = `${RAW_PAGE_MATERIAL_DIR}/${materialId}.body.txt`;
    const html = sanitizePersistedPageHtml(material.html);
    const dom = sanitizePersistedPageHtml(material.html);
    const bodyText = sanitizePersistedPageBodyText(material.html);
    const htmlPath = await writeArtifactText(context, htmlRelativePath, html);
    const domPath = await writeArtifactText(context, domRelativePath, dom);
    const bodyTextPath = await writeArtifactText(context, bodyTextRelativePath, bodyText);
    const descriptor = {
      materialId,
      url: sanitizeEvidenceRef(page.normalizedUrl) ?? null,
      finalUrl: sanitizeEvidenceRef(material.finalUrl ?? page.normalizedUrl) ?? null,
      sourceLayer: 'public',
      sourceType: material.sourceType ?? 'live_website',
      fetchedAt: material.fetchedAt ?? null,
      htmlPath: htmlRelativePath,
      domPath: domRelativePath,
      bodyTextPath: bodyTextRelativePath,
      htmlBytes: Buffer.byteLength(html, 'utf8'),
      domBytes: Buffer.byteLength(dom, 'utf8'),
      bodyTextBytes: Buffer.byteLength(bodyText, 'utf8'),
      redacted: true,
      scriptBodiesRedacted: true,
      cookieMaterialPersisted: false,
      tokenMaterialPersisted: false,
      authHeaderMaterialPersisted: false,
      browserProfilePersisted: false,
      storagePersisted: false,
      absolutePathsPersisted: false,
    };
    manifestPages.push(descriptor);
    byNormalizedUrl.set(page.normalizedUrl, {
      ...descriptor,
      htmlPath: relativeReportPath(context.cwd, htmlPath),
      domPath: relativeReportPath(context.cwd, domPath),
      bodyTextPath: relativeReportPath(context.cwd, bodyTextPath),
    });
  }
  const manifest = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-raw-page-material-manifest',
    buildId: context.buildId,
    siteId: context.site.id,
    status: 'success',
    sourceLayer: 'public',
    summary: {
      pages: manifestPages.length,
      htmlFiles: manifestPages.length,
      domFiles: manifestPages.length,
      bodyTextFiles: manifestPages.length,
      authenticatedPagesPersisted: 0,
    },
    policy: {
      publicPageHtmlPersisted: true,
      publicPageDomPersisted: true,
      publicPageBodyTextPersisted: true,
      authenticatedPageMaterialPersisted: false,
      cookieMaterialPersisted: false,
      tokenMaterialPersisted: false,
      authHeaderMaterialPersisted: false,
      browserProfilePersisted: false,
      storageMaterialPersisted: false,
      rawNetworkPayloadPersisted: false,
      sensitiveAssignmentsRedacted: true,
      scriptBodiesRedacted: true,
    },
    pages: manifestPages,
  };
  const write = await writeRedactedArtifactJson(context, RAW_PAGE_MATERIAL_MANIFEST_RELATIVE_PATH, manifest);
  return {
    artifactPath: write.artifactPath,
    value: write.value,
    byNormalizedUrl,
  };
}

async function crawlStaticStage(context, stageResults) {
  const discoverSeedResult = requireStage(stageResults, 'discoverSeeds');
  const {
    robotsPolicy = null,
    robots = null,
  } = discoverSeedResult;
  const publicSeedInputs = discoverSeedResult.publicSeeds ?? discoverSeedResult.seeds ?? [];
  const configuredAuthRoutes = configuredAuthRouteTemplateSet(context);
  const matchesConfiguredAuthPublicRoute = (...values) => matchesConfiguredAuthRoute(context, configuredAuthRoutes, values);
  const authorizedSourceManifest = buildAuthorizedSourceManifest(context);
  const maxDepth = Number(context.policy.maxDepth ?? 2);
  const maxPages = Math.max(1, Number(context.policy.maxPages ?? 50));
  const robotsCrawlDelaySeconds = Number(robots?.crawlDelaySeconds);
  const robotsCrawlDelayActive = Number.isFinite(robotsCrawlDelaySeconds) && robotsCrawlDelaySeconds > 0;
  const crawlConcurrency = robotsCrawlDelayActive ? 1 : STATIC_CRAWL_COLLECTION_CONCURRENCY;
  const effectiveCrawlFetchDelayMs = robotsCrawlDelayActive
    ? Math.max(0, Number(robots?.effectiveFetchDelayMs ?? 0) || 0)
    : 0;
  const publicCrawlSeeds = publicSeedInputs.filter((seed) => !matchesConfiguredAuthPublicRoute(
    seed?.routeTemplate,
    seed?.routePattern,
    seed?.normalizedUrl,
    seed?.url,
  ));
  markStageSubstepProgress(context, 'prepareQueue', {
    message: '准备公开抓取队列。',
    processedCount: 0,
    totalCount: publicSeedInputs.length,
    discoveredCount: publicCrawlSeeds.length,
    skippedCount: Math.max(0, publicSeedInputs.length - publicCrawlSeeds.length),
    currentItem: publicCrawlSeeds[0]?.normalizedUrl ?? publicCrawlSeeds[0]?.url ?? null,
  });
  markStageSubstepProgress(context, 'checkRobots', {
    message: '检查公开种子与 robots 抓取策略。',
    processedCount: 0,
    totalCount: publicCrawlSeeds.length,
    discoveredCount: publicCrawlSeeds.length,
  });
  const coveragePlan = planRepresentativeCrawlCoverage(context, publicCrawlSeeds, { maxPages });
  const queue = coveragePlan.seeds.map((seed) => ({
    url: seed.normalizedUrl,
    depth: 0,
    discoveredBy: sourceToDiscoveredBy(seed.source),
    seed,
  }));
  const effectiveMaxPages = coveragePlan.mode === 'route_family'
    ? Math.min(maxPages, coveragePlan.maxPages)
    : maxPages;
  const visited = new Set();
  const queued = new Set(queue.map((entry) => entry.url));
  const pages = /** @type {any[]} */ ([]);
  const failures = /** @type {any[]} */ ([]);
  const rawPageMaterialByUrl = new Map();
  const warnings = [
    ...coveragePlan.warnings,
    ...authorizedSourceManifest.warnings,
  ];
  const reasonCodes = new Set();
  const robotsExcludedUrls = /** @type {any[]} */ ([]);
  const markStaticCrawlProgress = (message, currentItem = null) => {
    markStageSubstepProgress(context, 'fetchPages', {
      message,
      currentItem,
      processedCount: visited.size,
      totalCount: Math.min(effectiveMaxPages, Math.max(queue.length, coveragePlan.seeds.length)),
      discoveredCount: pages.length,
      skippedCount: failures.length + robotsExcludedUrls.length,
    });
  };
  let lastCrawlFetchStartedAt = 0;
  const waitForRobotsCrawlDelay = async () => {
    if (!effectiveCrawlFetchDelayMs || !lastCrawlFetchStartedAt) {
      lastCrawlFetchStartedAt = Date.now();
      return;
    }
    const elapsedMs = Date.now() - lastCrawlFetchStartedAt;
    if (effectiveCrawlFetchDelayMs > elapsedMs) {
      await new Promise((resolve) => setTimeout(resolve, effectiveCrawlFetchDelayMs - elapsedMs));
    }
    lastCrawlFetchStartedAt = Date.now();
  };
  const canCrawl = (urlValue, collection = { robotsExcludedUrls, reasonCodes }) => {
    if (!robotsPolicy) {
      return true;
    }
    const allowed = isUrlAllowedByRobots(urlValue, robotsPolicy);
    if (!allowed) {
      collection.robotsExcludedUrls.push(normalizeUrl(urlValue, context.site.rootUrl));
      collection.reasonCodes.add('robots-disallowed');
    }
    return allowed;
  };
  const normalizeSameOriginStaticUrl = (value, baseUrl, sourceSameOrigin = false) => {
    const normalized = normalizeUrl(value, baseUrl);
    if (isInternalUrl(normalized, context.site.allowedDomains)) {
      return normalized;
    }
    if (sourceSameOrigin !== true || /(?:\[REDACTED\]|%5BREDACTED%5D)/iu.test(normalized)) {
      return normalized;
    }
    try {
      const redacted = new URL(normalized);
      const restored = normalizeUrl(`${redacted.pathname}${redacted.search}`, baseUrl);
      return isInternalUrl(restored, context.site.allowedDomains) ? restored : normalized;
    } catch {
      return normalized;
    }
  };

  const crawlEntry = async (entry) => {
    const entryWarnings = /** @type {any[]} */ ([]);
    const entryReasonCodes = new Set();
    const entryRobotsExcludedUrls = /** @type {any[]} */ ([]);
    try {
      await waitForRobotsCrawlDelay();
      const pageSource = await context.source.read(entry.url);
      const parsed = parseHtmlDocument(pageSource.body, entry.url);
      entryWarnings.push(...staticDiagnosticWarnings(entry.url, parsed.diagnostics));
      const normalizedUrl = normalizeUrl(parsed.canonicalUrl ?? entry.url);
      rawPageMaterialByUrl.set(normalizedUrl, {
        html: pageSource.body,
        finalUrl: pageSource.finalUrl ?? pageSource.sourcePath ?? normalizedUrl,
        sourceType: pageSource.sourceType ?? 'live_website',
        fetchedAt: pageSource.fetchedAt ?? null,
      });
      const links = parsed.links
        .map((link) => {
          const { sourceSameOrigin, ...safeLink } = link;
          return {
            ...safeLink,
            normalizedHref: normalizeSameOriginStaticUrl(link.href, entry.url, sourceSameOrigin),
          };
        })
        .filter((link) => (
          isInternalUrl(link.normalizedHref, context.site.allowedDomains)
          && !matchesConfiguredAuthPublicRoute(link.routeTemplate, link.normalizedHref)
          && canCrawl(link.normalizedHref, {
            robotsExcludedUrls: entryRobotsExcludedUrls,
            reasonCodes: entryReasonCodes,
          })
        ));
      const allowedRouteTemplates = uniqueSortedStrings(links.map((link) => {
        if (link.routeTemplate) {
          return link.routeTemplate;
        }
        try {
          return routePatternForUrl(link.normalizedHref);
        } catch {
          return null;
        }
      }).filter(Boolean));
      const allowedRouteTemplateSet = new Set(allowedRouteTemplates);
      const page = {
        url: entry.url,
        normalizedUrl,
        depth: entry.depth,
        discoveredBy: entry.discoveredBy,
        sourceLayer: 'public',
        authRequired: false,
        authVerificationStatus: null,
        evidenceLevel: 'public_verified',
        sourcePath: pageSource.sourcePath,
        title: parsed.title,
        textSummary: parsed.textSummary,
        canonicalUrl: parsed.canonicalUrl,
        pageType: entry.seed?.pageType ?? null,
        routeTemplate: entry.seed?.routeTemplate ?? null,
        visibleItemCount: Number(parsed.visibleItemCount ?? 0) || 0,
        listPresent: parsed.listPresent === true,
        emptyStatePresent: parsed.emptyStatePresent === true,
        routeTemplates: uniqueSortedStrings((parsed.routeTemplates ?? [])
          .filter((template) => allowedRouteTemplateSet.has(template))),
        structureItems: (parsed.structureItems ?? []).map((item, itemIndex) => ({
          ...item,
          routeTemplates: uniqueSortedStrings((item.routeTemplates ?? [])
            .filter((template) => allowedRouteTemplateSet.has(template))),
          structureHash: stableNodeId(
            'static-structure',
            `${entry.url}:${item.structureType ?? 'structure'}:${item.visibleItemCount ?? 0}:${item.listPresent === true}:${item.routeTemplates?.join('|') ?? ''}:${itemIndex}`,
          ),
        })),
        structureHash: stableNodeId(
          'static-page-structure',
          `${entry.url}:${parsed.visibleItemCount ?? 0}:${parsed.listPresent === true}:${(parsed.routeTemplates ?? []).join('|')}`,
        ),
        links,
        forms: parsed.forms,
        controls: parsed.controls,
        elementInstances: (parsed.elementInstances ?? [])
          .map((element) => {
            const { sourceSameOrigin, ...safeElement } = element;
            return {
              ...safeElement,
              href: element.href ? normalizeSameOriginStaticUrl(element.href, entry.url, sourceSameOrigin) : null,
              action: element.action ? normalizeSameOriginStaticUrl(element.action, entry.url, sourceSameOrigin) : null,
            };
          })
          .filter((element) => (
            !element.href || isInternalUrl(element.href, context.site.allowedDomains)
          ))
          .filter((element) => (
            !element.href || !matchesConfiguredAuthPublicRoute(element.routeTemplate, element.href)
          ))
          .filter((element) => (
            !element.href || canCrawl(element.href, {
              robotsExcludedUrls: entryRobotsExcludedUrls,
              reasonCodes: entryReasonCodes,
            })
          )),
        diagnostics: parsed.diagnostics,
        collection: {
          status: 'success',
          source: 'url',
          concurrent: true,
        },
        evidence: [
          buildEvidence({
            type: 'url',
            source: pageSource.sourcePath ?? entry.url,
            confidence: 1,
          }),
        ],
      };
      return {
        entry,
        page,
        warnings: entryWarnings,
        reasonCodes: entryReasonCodes,
        robotsExcludedUrls: entryRobotsExcludedUrls,
      };
    } catch (error) {
      const warning = `crawl failed: ${entry.url}: ${error?.message ?? String(error)}`;
      const classified = classifySiteForgeWarning(warning);
      if (classified?.reasonCode) {
        entryReasonCodes.add(classified.reasonCode);
      }
      return {
        entry,
        page: null,
        failure: {
          url: entry.url,
          normalizedUrl: normalizeUrl(entry.url, context.site.rootUrl),
          depth: entry.depth,
          discoveredBy: entry.discoveredBy,
          message: error?.message ?? String(error),
          reasonCode: classified?.reasonCode ?? error?.reasonCode ?? error?.code ?? 'crawl-failed',
        },
        warnings: [warning],
        reasonCodes: entryReasonCodes,
        robotsExcludedUrls: entryRobotsExcludedUrls,
      };
    }
  };

  markStaticCrawlProgress('准备抓取静态页面。', queue[0]?.url ?? null);
  let index = 0;
  while (index < queue.length && visited.size < effectiveMaxPages) {
    const batch = /** @type {any[]} */ ([]);
    while (index < queue.length && batch.length < crawlConcurrency && visited.size < effectiveMaxPages) {
      const entry = queue[index];
      index += 1;
      if (visited.has(entry.url)) {
        continue;
      }
      if (!canCrawl(entry.url)) {
        warnings.push(`robots excluded crawl URL: ${entry.url}`);
        continue;
      }
      visited.add(entry.url);
      batch.push(entry);
    }
    if (!batch.length) {
      continue;
    }
    markStaticCrawlProgress(`正在抓取 ${batch.length} 个静态页面。`, batch.map((entry) => entry.url).join(', '));
    const results = await mapWithConcurrency(batch, crawlConcurrency, crawlEntry);
    for (const result of results) {
      warnings.push(...result.warnings);
      for (const reasonCode of result.reasonCodes) {
        reasonCodes.add(reasonCode);
      }
      robotsExcludedUrls.push(...result.robotsExcludedUrls);
      if (!result.page) {
        if (result.failure) {
          failures.push(result.failure);
        }
        continue;
      }
      pages.push(result.page);
      if (result.entry.depth >= maxDepth || coveragePlan.mode === 'route_family') {
        continue;
      }
      for (const link of result.page.links) {
        if (queued.has(link.normalizedHref)) {
          continue;
        }
        queued.add(link.normalizedHref);
        queue.push({
          url: link.normalizedHref,
          depth: result.entry.depth + 1,
          discoveredBy: 'html_link',
          seed: null,
        });
      }
    }
    markStaticCrawlProgress('静态页面批次抓取完成。', batch[batch.length - 1]?.url ?? null);
  }
  if (index < queue.length && visited.size >= effectiveMaxPages) {
    warnings.push(`crawl truncated at maxPages=${effectiveMaxPages}; ${queue.length - index} queued URLs were not fetched.`);
  }

  markStageSubstepProgress(context, 'sanitizeMaterial', {
    message: '清洗并去重静态页面材料。',
    processedCount: pages.length,
    totalCount: pages.length + authorizedSourceManifest.pages.length,
    discoveredCount: rawPageMaterialByUrl.size,
    skippedCount: failures.length,
  });
  const dedupedPages = arrayUniqueBy([...pages, ...authorizedSourceManifest.pages], (page) => pageIdentity(page))
    .sort((left, right) => left.normalizedUrl.localeCompare(right.normalizedUrl, 'en'));
  const dedupedFailures = arrayUniqueBy(failures, (failure) => failure.normalizedUrl)
    .sort((left, right) => left.normalizedUrl.localeCompare(right.normalizedUrl, 'en'));
  markStageSubstepProgress(context, 'writeManifests', {
    message: '写入页面材料和授权来源清单。',
    processedCount: 0,
    totalCount: dedupedPages.length,
    discoveredCount: dedupedPages.length,
    skippedCount: dedupedFailures.length,
  });
  const rawPageMaterialWrite = await writePublicRawPageMaterialArtifacts(context, dedupedPages, rawPageMaterialByUrl);
  const authorizedSourceWrite = await writeRedactedArtifactJson(context, AUTHORIZED_SOURCE_MANIFEST_RELATIVE_PATH, authorizedSourceManifest.manifest);
  for (const page of dedupedPages) {
    const descriptor = rawPageMaterialWrite.byNormalizedUrl.get(page.normalizedUrl);
    if (descriptor) {
      page.rawPageMaterial = descriptor;
    }
  }
  const staticDiagnosticSummary = {
    empty: dedupedPages.filter((page) => page.diagnostics?.staticEvidenceStatus === 'empty').length,
    dynamicShell: dedupedPages.filter((page) => page.diagnostics?.staticEvidenceStatus === 'dynamic_shell').length,
    present: dedupedPages.filter((page) => page.diagnostics?.staticEvidenceStatus === 'present').length,
  };
  const blockedReason = dedupedPages.length === 0
    ? 'siteforge-static-crawl-empty'
    : dedupedPages.every((page) => !hasUsableStaticPageEvidence(page))
      ? 'siteforge-static-evidence-unavailable'
      : null;
  const renderedEvidenceRequired = (
    blockedReason === 'siteforge-static-evidence-unavailable'
      && staticDiagnosticSummary.dynamicShell > 0
  ) || (
    blockedReason === 'siteforge-static-crawl-empty'
      && setupAllowsPublicRenderedRecovery(context)
  )
    ? canAttemptPublicRenderedLayer(context, { renderedRequired: true })
    : false;
  const continueWithAuthenticatedRoutes = discoverSeedResult.authenticatedRouteOnly === true;
  const continueWithBrowserBridgeStructureEvidence = hasAuthenticatedBrowserStructureEvidence(context);
  const shouldBlockStatic = Boolean(blockedReason
    && !renderedEvidenceRequired
    && !continueWithAuthenticatedRoutes
    && !continueWithBrowserBridgeStructureEvidence);
  if (blockedReason && continueWithBrowserBridgeStructureEvidence) {
    warnings.push('Static crawl produced no usable public page evidence; continuing with verified Browser Bridge structure evidence.');
  }
  const errors = shouldBlockStatic
    ? [
      blockedReason === 'siteforge-static-crawl-empty'
        ? 'Static crawl produced no pages with evidence; build stopped before draft skill generation.'
        : 'Static crawl found only empty or dynamic-shell pages; build stopped before draft skill generation.',
    ]
    : [];
  const duplicateUrls = pages.length - arrayUniqueBy(pages, (page) => page.url).length;
  const duplicateRatio = pages.length === 0
    ? 0
    : duplicateUrls / pages.length;
  const publicHttpEvidenceBundle = normalizeEvidenceBundle({
    providerId: 'public_http',
    status: blockedReason ? (shouldBlockStatic ? 'blocked' : 'skipped') : 'success',
    authMethod: 'none',
    authVerificationStatus: null,
    sourceLayer: 'public',
    pages: dedupedPages.filter((page) => pageSourceLayer(page) === 'public'),
    warnings,
    reasonCodes: uniqueSortedStrings([...reasonCodes]),
    coverage: {
      publicSeedUrls: publicCrawlSeeds.length,
      fetchedUrls: visited.size,
      failedUrls: dedupedFailures.length,
      robotsExcludedUrls: uniqueSortedStrings(robotsExcludedUrls).length,
    },
    privacy: {
      rawDomSaved: false,
      rawHtmlSaved: false,
      rawContentSaved: false,
      privateContentSaved: false,
      cookiesSaved: false,
      tokensSaved: false,
      browserProfileSaved: false,
    },
  });
  const authorizedSummaryEvidenceBundle = normalizeEvidenceBundle({
    providerId: 'authorized_summary',
    status: authorizedSourceManifest.pages.length ? 'success' : 'skipped',
    authMethod: 'none',
    authVerificationStatus: null,
    sourceLayer: 'authorized_source',
    pages: authorizedSourceManifest.pages,
    warnings: authorizedSourceManifest.warnings,
    reasonCodes: authorizedSourceManifest.pages.length ? [] : ['authorized-summary-empty'],
    coverage: {
      configuredSources: authorizedSourceManifest.manifest?.sources?.length ?? 0,
    },
  });
  const evidenceBundles = [publicHttpEvidenceBundle, authorizedSummaryEvidenceBundle];
  const evidenceCoverage = evidenceCoverageFromBundles(evidenceBundles);
  const payload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    status: shouldBlockStatic ? 'blocked' : blockedReason ? 'skipped' : 'success',
    pages: dedupedPages,
    failures: dedupedFailures,
    errors,
    diagnostics: {
      staticEvidence: staticDiagnosticSummary,
    },
    summary: {
      pages: dedupedPages.length,
      publicPages: pages.length,
      sourceLayer: 'public',
      duplicateUrls,
      duplicateRatio,
      maxDepth,
      maxPages,
      effectiveMaxPages,
      seedInventoryUrls: publicCrawlSeeds.length,
      representativeCoverageMode: coveragePlan.mode,
      representativeFamilyCount: coveragePlan.familyCount,
      representativeSeedUrls: coveragePlan.seeds.length,
      representativeUnfetchedSeeds: Math.max(0, publicCrawlSeeds.length - coveragePlan.seeds.length),
      fetchedUrls: visited.size,
      failedUrls: dedupedFailures.length,
      rawPageMaterial: rawPageMaterialWrite.value.summary,
      queuedUrls: queue.length,
      unfetchedUrls: Math.max(0, queue.length - index),
      collectionConcurrency: crawlConcurrency,
      robotsCrawlDelaySeconds: robotsCrawlDelayActive ? robotsCrawlDelaySeconds : null,
      effectiveCrawlFetchDelayMs: robotsCrawlDelayActive ? effectiveCrawlFetchDelayMs : null,
      robotsExcludedUrls: uniqueSortedStrings(robotsExcludedUrls),
      authorizedSource: authorizedSourceWrite.value.summary,
      authorizedSourcePages: authorizedSourceManifest.pages.length,
      browserBridgeStructurePages: continueWithBrowserBridgeStructureEvidence
        ? authenticatedStructurePageInputs(context.authenticatedStructureSummary).length
        : 0,
      blockedReason: shouldBlockStatic ? blockedReason : null,
      staticBlockedReason: blockedReason,
      renderedEvidenceRequired,
    },
    warnings,
    rawPageMaterial: rawPageMaterialWrite.value,
    authorizedSource: authorizedSourceWrite.value,
    evidenceBundles,
    evidenceCoverage,
  };
  const crawlStaticPath = await writeArtifactJson(context, 'crawl_static.json', payload);
  const crawlCheckpointPath = await writeCrawlCheckpoint(context, {
    status: shouldBlockStatic ? 'blocked' : 'completed',
    mode: coveragePlan.mode,
    seeds: publicCrawlSeeds,
    pages: dedupedPages,
    failures: dedupedFailures,
    queueLength: queue.length,
    queueIndex: index,
    visitedCount: visited.size,
    effectiveMaxPages,
    coveragePlan,
    summary: payload.summary,
    warnings,
  });
  if (shouldBlockStatic) {
    throw createBlockedStageError(
      blockedReason,
      errors[0],
      {
        warnings,
        artifactPaths: {
          crawlStatic: crawlStaticPath,
          crawlCheckpoint: crawlCheckpointPath,
          rawPageMaterialManifest: rawPageMaterialWrite.artifactPath,
          authorizedSourceManifest: authorizedSourceWrite.artifactPath,
        },
        reasonCodes: uniqueSortedStrings([...reasonCodes]),
        summary: payload.summary,
      },
    );
  }
  return {
    pages: dedupedPages,
    evidenceBundles,
    evidenceCoverage,
    warnings,
    artifactPaths: {
      crawlStatic: crawlStaticPath,
      crawlCheckpoint: crawlCheckpointPath,
      rawPageMaterialManifest: rawPageMaterialWrite.artifactPath,
      authorizedSourceManifest: authorizedSourceWrite.artifactPath,
    },
    reasonCodes: uniqueSortedStrings([...reasonCodes]),
    summary: payload.summary,
    rawPageMaterial: rawPageMaterialWrite.value,
    authorizedSource: authorizedSourceWrite.value,
  };
}

function mergedBrowserBridgeCoverageTargets(context = /** @type {any} */ ({})) {
  const contractTargets = context.crawlContract?.coverageTargets ?? {};
  const optionTargets = context.options?.coverageTargets ?? {};
  return {
    ...contractTargets,
    ...optionTargets,
    authRoutes: uniqueSortedStrings([
      ...(contractTargets.authRoutes ?? []),
      ...(optionTargets.authRoutes ?? []),
      ...(context.options?.authRoutes ?? []),
      ...(context.options?.localBuildConfig?.authRoutes ?? []),
    ]),
    publicRoutes: uniqueSortedStrings([
      ...(contractTargets.publicRoutes ?? []),
      ...(optionTargets.publicRoutes ?? []),
    ]),
    publicRevisitRoutes: uniqueSortedStrings([
      ...(contractTargets.publicRevisitRoutes ?? []),
      ...(optionTargets.publicRevisitRoutes ?? []),
      ...(context.options?.publicRevisitRoutes ?? []),
      ...(context.options?.localBuildConfig?.publicRevisitRoutes ?? []),
    ]),
  };
}

function browserBridgeDesiredCoverageRoutes(context = /** @type {any} */ ({})) {
  const coverageTargets = mergedBrowserBridgeCoverageTargets(context);
  return [
    ...(coverageTargets.authRoutes ?? []).map((route) => ({ route, sourceLayer: 'authenticated' })),
    ...(coverageTargets.publicRevisitRoutes ?? []).map((route) => ({ route, sourceLayer: 'authenticated_overlay' })),
  ];
}

function browserBridgeRouteResultMatchesTarget(context, result = /** @type {any} */ ({}), target = /** @type {any} */ ({})) {
  if (!result || result.sourceLayer !== target.sourceLayer) {
    return false;
  }
  const resultVariants = new Set(routeTemplateComparisonValues(context, [
    result.targetRoute,
    result.routeTemplate,
    result.targetUrl,
    result.url,
    result.normalizedUrl,
  ]));
  return routeTemplateComparisonValues(context, [target.route]).some((variant) => resultVariants.has(variant));
}

function annotateMissingBrowserBridgeCoverageTargets(context, report = /** @type {any} */ ({})) {
  const desiredRoutes = browserBridgeDesiredCoverageRoutes(context);
  const existingResults = Array.isArray(report?.browserBridge?.routeResults)
    ? report.browserBridge.routeResults
    : [];
  const missingResults = [];
  for (const target of desiredRoutes) {
    if (existingResults.some((result) => browserBridgeRouteResultMatchesTarget(context, result, target))) {
      continue;
    }
    const targetRoute = sanitizeRouteTargetForPersistence(target.route, context.site)
      ?? String(target.route ?? '').trim()
      ?? null;
    if (!targetRoute) {
      continue;
    }
    missingResults.push({
      routeId: `coverage-target-missing-${missingResults.length + 1}`,
      sourceLayer: target.sourceLayer,
      targetRoute,
      status: 'timeout',
      reasonCode: 'browser-bridge-route-refresh-failed',
      captured: false,
      finalStatus: 'timeout',
      finalReasonCode: 'browser-bridge-route-refresh-failed',
      retryAttemptCount: 0,
      retryOutcome: 'not_attempted',
    });
  }
  if (!missingResults.length) {
    return report;
  }
  return {
    ...report,
    browserBridge: {
      ...(report.browserBridge ?? {}),
      routeResults: [
        ...existingResults,
        ...missingResults,
      ],
    },
  };
}

function browserBridgeRouteResultKey(context, result = /** @type {any} */ ({})) {
  const sourceLayer = result?.sourceLayer === 'authenticated_overlay'
    ? 'authenticated_overlay'
    : 'authenticated';
  for (const value of [
    result?.targetRoute,
    result?.routeTemplate,
    result?.targetUrl,
    result?.url,
    result?.normalizedUrl,
  ]) {
    const variants = routeTemplateComparisonValues(context, [value]).filter(Boolean);
    if (variants.length) {
      return `${sourceLayer}\u0000${variants[0]}`;
    }
  }
  const routeId = String(result?.routeId ?? '').trim();
  return routeId ? `${sourceLayer}\u0000id:${routeId}` : null;
}

function mergeBrowserBridgeRouteResults(context, previousResults = [], freshResults = []) {
  const byKey = new Map();
  for (const result of [...previousResults, ...freshResults]) {
    const key = browserBridgeRouteResultKey(context, result);
    if (!key) {
      continue;
    }
    const existing = byKey.get(key);
    if (!existing || browserBridgeRouteCaptured(result) || !browserBridgeRouteCaptured(existing)) {
      byKey.set(key, result);
    }
  }
  return [...byKey.values()];
}

function mergeBrowserBridgeRefreshReport(context, previousReport = /** @type {any} */ ({}), freshReport = /** @type {any} */ ({})) {
  const routeResults = mergeBrowserBridgeRouteResults(
    context,
    previousReport?.browserBridge?.routeResults ?? [],
    freshReport?.browserBridge?.routeResults ?? [],
  );
  const merged = {
    ...freshReport,
    crawlMode: 'authenticated_browser',
    authMethod: 'browser',
    authVerificationStatus: 'browser_verified_partial',
    verified: true,
    blockingSignals: uniqueSortedStrings([
      ...(previousReport?.blockingSignals ?? []),
      ...(freshReport?.blockingSignals ?? []),
    ]),
    positiveSignals: uniqueSortedStrings([
      ...(previousReport?.positiveSignals ?? []),
      ...(freshReport?.positiveSignals ?? []),
    ]),
    verifiedRoutes: uniqueSortedStrings([
      ...(previousReport?.verifiedRoutes ?? []),
      ...(freshReport?.verifiedRoutes ?? []),
    ]),
    browserBridge: {
      ...(freshReport?.browserBridge ?? {}),
      routeResults,
    },
  };
  const freshMaterial = authRuntimeMaterialFrom(freshReport);
  if (freshMaterial) {
    attachAuthRuntimeMaterial(merged, freshMaterial);
  }
  return merged;
}

function browserBridgeRefreshAuthOptions(context, coverageTargets = /** @type {any} */ ({}), previousAuthStateReport = null) {
  const publicRevisitRoutes = coverageTargets.publicRevisitRoutes ?? [];
  if (!publicRevisitRoutes.length || !canRunAuthenticatedLayer(previousAuthStateReport)) {
    return {
      ...context.options,
      coverageTargets,
    };
  }
  return {
    ...context.options,
    publicRevisitRoutes: [],
    localBuildConfig: {
      ...(context.options.localBuildConfig ?? {}),
      publicRevisitRoutes: [],
    },
    coverageTargets,
  };
}

function matchesMissingAuthenticatedBrowserBridgeRoute(context, values = /** @type {any[]} */ ([]), {
  nonRoot = false,
} = /** @type {any} */ ({})) {
  const routeResults = Array.isArray(context.authStateReport?.browserBridge?.routeResults)
    ? context.authStateReport.browserBridge.routeResults
    : [];
  return routeResults.some((result) => {
    if (result?.sourceLayer === 'authenticated_overlay' || browserBridgeRouteCaptured(result)) {
      return false;
    }
    const resultVariants = new Set(routeTemplateComparisonValues(context, [
      result?.targetRoute,
      result?.routeTemplate,
      result?.targetUrl,
      result?.url,
      result?.normalizedUrl,
    ]));
    return routeTemplateComparisonValues(context, values)
      .some((variant) => (!nonRoot || variant !== '/') && resultVariants.has(variant));
  });
}

function matchesMissingBrowserBridgeRouteForSourceLayer(context, sourceLayer, values = /** @type {any[]} */ ([]), {
  nonRoot = false,
} = /** @type {any} */ ({})) {
  const layer = sourceLayer === 'authenticated_overlay'
    ? 'authenticated_overlay'
    : sourceLayer === 'authenticated'
      ? 'authenticated'
      : isPublicReadSourceLayer(sourceLayer)
        ? 'authenticated'
        : null;
  if (!layer) {
    return false;
  }
  const routeResults = Array.isArray(context.authStateReport?.browserBridge?.routeResults)
    ? context.authStateReport.browserBridge.routeResults
    : [];
  return routeResults.some((result) => {
    if (result?.sourceLayer !== layer || browserBridgeRouteCaptured(result)) {
      return false;
    }
    const resultVariants = new Set(routeTemplateComparisonValues(context, [
      result?.targetRoute,
      result?.routeTemplate,
      result?.targetUrl,
      result?.url,
      result?.normalizedUrl,
    ]));
    return routeTemplateComparisonValues(context, values)
      .some((variant) => (!nonRoot || variant !== '/') && resultVariants.has(variant));
  });
}

function browserBridgeCoverageNeedsRefresh(context = /** @type {any} */ ({})) {
  const desiredRoutes = browserBridgeDesiredCoverageRoutes(context);
  if (!desiredRoutes.length || context.authStateReport?.authMethod !== 'browser') {
    return false;
  }
  const routeResults = Array.isArray(context.authStateReport?.browserBridge?.routeResults)
    ? context.authStateReport.browserBridge.routeResults
    : [];
  const capturedRouteResults = routeResults.filter(browserBridgeRouteCaptured);
  if (!capturedRouteResults.length) {
    return true;
  }
  return desiredRoutes.some((target) => !capturedRouteResults
    .some((result) => browserBridgeRouteResultMatchesTarget(context, result, target)));
}

async function authStateCheckStage(context, stageResults = /** @type {any} */ ({})) {
  markStageSubstepProgress(context, 'readSetupProfile', {
    message: '读取设置档案和认证提示。',
    processedCount: context.setupProfile ? 1 : 0,
    totalCount: 1,
    discoveredCount: context.setupProfile?.collectionReview ? 1 : 0,
  });
  const setupBlockedApiDiscoveryOnly = context.options.allowSetupBlockedApiDiscovery === true
    && context.options.authMode === 'browser';
  const browserBridgeNeedsRouteRefresh = context.options.authMode === 'browser'
    && browserBridgeCoverageNeedsRefresh(context);
  const previousAuthStateReport = context.authStateReport;
  const previousAuthRuntime = context.authRuntime;
  const previousAuthenticatedStructureSummary = context.authenticatedStructureSummary;
  const needsAuthCheck = !setupBlockedApiDiscoveryOnly && ['cookie', 'browser'].includes(context.options.authMode) && (
    !canRunAuthenticatedLayer(context.authStateReport)
    || context.authRuntime?.method !== context.options.authMode
    || browserBridgeNeedsRouteRefresh
  );
  const robotsPolicy = stageResults.discoverSeeds?.robotsPolicy ?? setupProfileRobotsPolicy(context);
  const mergedCoverageTargets = mergedBrowserBridgeCoverageTargets(context);
  const authOptions = needsAuthCheck
    ? browserBridgeRefreshAuthOptions(context, mergedCoverageTargets, previousAuthStateReport)
    : null;
  let routeRefreshFallbackUsed = false;
  markStageSubstepProgress(context, 'classifyAccess', {
    message: needsAuthCheck ? '运行认证状态检查。' : '复用已有认证状态。',
    currentItem: context.options.authMode ?? context.authStateReport?.authMethod ?? 'none',
    processedCount: 0,
    totalCount: 1,
    discoveredCount: mergedCoverageTargets.authRoutes?.length ?? 0,
  });
  let baseReport = needsAuthCheck
    ? await runDefaultBrowserAuthStateCheck({
      inputUrl: context.inputUrl,
      site: context.site,
      options: authOptions,
      robotsPolicy,
    })
    : context.authStateReport ?? createPublicOnlyAuthStateReport({ site: context.site, authMethod: 'none' });
  const authenticatedAuthorizedPages = authenticatedAuthorizedSourcePages(context, stageResults);
  if (
    !needsAuthCheck
    && authenticatedAuthorizedPages.length
    && !canRunAuthenticatedLayer(baseReport)
  ) {
    baseReport = normalizeAuthStateReport({
      crawlMode: 'authenticated_authorized_source',
      authMethod: 'authorized_source',
      authVerificationStatus: 'authorized_source_verified',
      verified: true,
      source: 'authorized_source_sanitized_summary',
      finalUrl: context.site.rootUrl,
      blockingSignals: [],
      positiveSignals: [
        'authorized_source_authenticated_structure_summary',
        'session_material_not_persisted',
      ],
      verifiedRoutes: authenticatedAuthorizedPages
        .map((page) => page.normalizedUrl ?? page.url ?? page.routeTemplate)
        .filter(Boolean),
      capabilityProofs: authenticatedAuthorizedPages.map((page) => ({
        capabilityId: `authorized-source:${page.sourceAuthorityId ?? page.routeTemplate ?? page.normalizedUrl}`,
        evidenceLevel: 'authorized_source_verified',
        sampleCount: Number(page.visibleItemCount ?? 0) || (page.listPresent === true ? 1 : 0),
      })),
    }, {
      site: context.site,
      crawlMode: 'authenticated_authorized_source',
      authMethod: 'authorized_source',
    });
  }
  markStageSubstepProgress(context, 'detectBlockers', {
    message: '识别认证阻断和路由覆盖缺口。',
    currentItem: baseReport?.authVerificationStatus ?? baseReport?.crawlMode ?? 'public_only',
    processedCount: 1,
    totalCount: 1,
    discoveredCount: baseReport?.verifiedRoutes?.length ?? 0,
    skippedCount: baseReport?.blockingSignals?.length ?? 0,
  });
  if (
    browserBridgeNeedsRouteRefresh
    && canRunAuthenticatedLayer(previousAuthStateReport)
    && canRunAuthenticatedLayer(baseReport)
  ) {
    baseReport = mergeBrowserBridgeRefreshReport(context, previousAuthStateReport, baseReport);
  }
  if (
    browserBridgeNeedsRouteRefresh
    && canRunAuthenticatedLayer(previousAuthStateReport)
    && !canRunAuthenticatedLayer(baseReport)
  ) {
    routeRefreshFallbackUsed = true;
    baseReport = annotateMissingBrowserBridgeCoverageTargets(context, previousAuthStateReport);
  }
  if (authOptions) {
    const runtimeMaterial = authRuntimeMaterialFrom(baseReport);
    context.authRuntime = runtimeMaterial?.authRuntime
      ?? (browserBridgeNeedsRouteRefresh ? previousAuthRuntime : null);
    context.authenticatedStructureSummary = runtimeMaterial?.authenticatedStructureSummary
      ?? (browserBridgeNeedsRouteRefresh ? previousAuthenticatedStructureSummary : null);
  }
  const normalizedReport = normalizeAuthStateReport(baseReport, {
    site: context.site,
    crawlMode: baseReport?.crawlMode ?? context.crawlContract?.crawlMode ?? 'public_only',
    authMethod: baseReport?.authMethod ?? context.crawlContract?.authMethod ?? 'none',
  });
  const coverageTargets = { ...(context.crawlContract?.coverageTargets ?? {}) };
  if (canRunAuthenticatedLayer(normalizedReport)) {
    const verifiedAuthRoutes = uniqueSortedStrings((normalizedReport.verifiedRoutes ?? [])
      .map((route) => {
        try {
          const normalized = sanitizeRouteTargetForPersistence(route, context.site, { preserveRelative: false });
          return normalized && isInternalUrl(normalized, context.site.allowedDomains) && !/\/api(?:\/|$)/iu.test(new URL(normalized).pathname)
            ? normalized
            : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean));
    coverageTargets.authRoutes = uniqueSortedStrings([
      ...(coverageTargets.authRoutes ?? []),
      ...verifiedAuthRoutes,
    ]);
  }
  markStageSubstepProgress(context, 'planRoutes', {
    message: '生成认证和公开重访路由计划。',
    processedCount: coverageTargets.authRoutes?.length ?? 0,
    totalCount: (coverageTargets.authRoutes?.length ?? 0) + (coverageTargets.publicRevisitRoutes?.length ?? 0),
    discoveredCount: coverageTargets.publicRoutes?.length ?? 0,
    skippedCount: normalizedReport.browserBridge?.missingRouteCount ?? 0,
  });
  const nextContract = createCrawlContract({
    site: context.site,
    authStateReport: normalizedReport,
    coverageTargets,
  });
  context.authStateReport = normalizedReport;
  context.crawlContract = nextContract;
  clearRuntimeAuthInputOptions(context.options);
  context.source = createBuildSource(context.inputUrl, {
    ...context.options,
    fetchDelayMs: context.policy.fetchDelayMs,
    fetchTimeoutMs: context.policy.fetchTimeoutMs,
    authRuntime: null,
  });
  markStageSubstepProgress(context, 'writeAuthReport', {
    message: '写入认证状态报告。',
    currentItem: AUTH_STATE_REPORT_FILE,
    processedCount: 0,
    totalCount: 1,
    discoveredCount: canRunAuthenticatedLayer(normalizedReport) ? 1 : 0,
    skippedCount: normalizedReport.blockingSignals?.length ?? 0,
  });
  const authStateReportPath = await writeArtifactJson(context, AUTH_STATE_REPORT_FILE, normalizedReport);
  if (context.options.strictCookieAuth === true && context.options.authMode === 'cookie' && !canRunAuthenticatedLayer(normalizedReport)) {
    const status = normalizedReport.authVerificationStatus ?? 'auth_check_failed';
    const error = /** @type {Error & Record<string, any>} */ (new Error(
      `Configured cookie authentication did not verify; build stopped instead of falling back to public-only mode. [reasonCode=${status}]`,
    ));
    error.code = 'cookie-auth-verification-failed';
    error.reasonCode = status;
    error.reasonCodes = uniqueSortedStrings([status, ...(normalizedReport.blockingSignals ?? [])]);
    error.stageStatus = 'blocked';
    error.buildStatus = 'failed';
    error.artifactPaths = { authStateReport: authStateReportPath };
    error.summary = authSummaryForReport(nextContract, normalizedReport);
    throw error;
  }
  if (context.options.strictBrowserAuth === true && context.options.authMode === 'browser' && !canRunAuthenticatedLayer(normalizedReport)) {
    const status = normalizedReport.authVerificationStatus ?? 'browser_check_failed';
    const error = /** @type {Error & Record<string, any>} */ (new Error(
      `Configured default-browser authentication bridge did not verify; build stopped instead of falling back to public-only mode. [reasonCode=${status}]`,
    ));
    error.code = 'browser-auth-verification-failed';
    error.reasonCode = status;
    error.reasonCodes = uniqueSortedStrings([status, ...(normalizedReport.blockingSignals ?? [])]);
    error.stageStatus = 'blocked';
    error.buildStatus = 'failed';
    error.artifactPaths = { authStateReport: authStateReportPath };
    error.summary = authSummaryForReport(nextContract, normalizedReport);
    throw error;
  }
  if (
    context.options.strictBrowserAuth === true
    && context.options.authMode === 'browser'
    && canRunAuthenticatedLayer(normalizedReport)
    && Number(normalizedReport.browserBridge?.missingRouteCount ?? 0) > 0
  ) {
    normalizedReport.blockingSignals = uniqueSortedStrings([
      ...(normalizedReport.blockingSignals ?? []),
      ...((normalizedReport.browserBridge?.routeResults ?? [])
        .filter((result) => !browserBridgeRouteCaptured(result))
        .map((result) => result.reasonCode ?? result.status)
        .filter(Boolean)),
    ]);
  }
  const partialBrowserRouteCoverage = context.options.authMode === 'browser'
    && canRunAuthenticatedLayer(normalizedReport)
    && Number(normalizedReport.browserBridge?.capturedRouteCount ?? 0) > 0
    && Number(normalizedReport.browserBridge?.missingRouteCount ?? 0) > 0;
  const partialBrowserRouteReasonCodes = partialBrowserRouteCoverage
    ? uniqueSortedStrings([
      'browser-auth-route-coverage-partial',
      ...((normalizedReport.browserBridge?.routeResults ?? [])
        .filter((result) => !browserBridgeRouteCaptured(result))
        .map((result) => result.reasonCode ?? result.status)
        .filter(Boolean)),
    ])
    : [];
  const routeCapturePlan = routeCapturePlanFromAuthState(context, normalizedReport);
  const routeCapturePlanPath = routeCapturePlan
    ? await writeArtifactJson(context, ROUTE_CAPTURE_PLAN_FILE, routeCapturePlan)
    : null;
  return {
    authStateReport: normalizedReport,
    crawlContract: nextContract,
    routeCapturePlan,
    artifactPaths: {
      authStateReport: authStateReportPath,
      ...(routeCapturePlanPath ? { routeCapturePlan: routeCapturePlanPath } : {}),
    },
    reasonCodes: normalizedReport.verified === true
      ? partialBrowserRouteReasonCodes
      : uniqueSortedStrings(normalizedReport.blockingSignals ?? []),
    warnings: normalizedReport.verified === true
      ? [
        ...(partialBrowserRouteCoverage ? ['browser-auth-route-coverage-partial'] : []),
        ...(routeRefreshFallbackUsed ? ['browser-auth-route-refresh-failed-preserved-previous-verification'] : []),
      ]
      : [context.options.authMode === 'browser'
        ? 'Default-browser authentication bridge did not verify successfully; authenticated crawl remains disabled for this build.'
        : 'Cookie authentication did not verify successfully; authenticated crawl remains disabled for this build.'],
    summary: authSummaryForReport(nextContract, normalizedReport),
  };
}

function sanitizedControl(control = /** @type {any} */ ({}), index = 0, {
  fallbackPrefix = 'auth',
  redactLabelText = false,
} = /** @type {any} */ ({})) {
  return {
    kind: String(control.kind ?? control.controlType ?? 'button').slice(0, 40),
    type: control.type ? String(control.type).slice(0, 40) : null,
    label: redactLabelText
      ? `${fallbackPrefix}-control-${index + 1}`
      : sanitizedStructureText(control.label, 80),
    name: redactLabelText ? null : sanitizedStructureText(control.name, 80),
    selector: sanitizedStructureText(control.selector, 120, `${fallbackPrefix}-control-${index}`),
    attrs: control.attrs && typeof control.attrs === 'object'
      ? {
        role: sanitizedStructureText(control.attrs.role, 40),
      }
      : {},
  };
}

function sanitizedForm(form = /** @type {any} */ ({}), index = 0, {
  fallbackPrefix = 'auth',
  redactLabelText = false,
} = /** @type {any} */ ({})) {
  const method = String(form.method ?? 'GET').toUpperCase();
  return {
    label: redactLabelText
      ? `${fallbackPrefix}-form-${index + 1}`
      : sanitizedStructureText(form.label, 80, `${fallbackPrefix}-form-${index}`),
    selector: sanitizedStructureText(form.selector, 120, `${fallbackPrefix}-form-${index}`),
    method,
    action: sanitizedStructureText(form.action, 200),
    textSummary: 'sanitized form structure only',
    inputs: Array.isArray(form.inputs)
      ? form.inputs.slice(0, 20).map((input, inputIndex) => ({
        name: redactLabelText ? null : sanitizedStructureText(input?.name, 80),
        type: input?.type ? String(input.type).slice(0, 40) : null,
        selector: sanitizedStructureText(input?.selector, 120, `${fallbackPrefix}-input-${inputIndex}`),
        label: redactLabelText ? `${fallbackPrefix}-input-${inputIndex + 1}` : sanitizedStructureText(input?.label, 80),
        tagName: input?.tagName ? String(input.tagName).slice(0, 20) : null,
      }))
      : [],
  };
}

function sanitizeRenderedInternalUrl(context, value, baseUrl = context.site.rootUrl) {
  const normalized = normalizeUrl(value, baseUrl);
  if (!isInternalUrl(normalized, context.site.allowedDomains)) {
    return null;
  }
  const parsed = new URL(normalized);
  parsed.search = '';
  parsed.hash = '';
  parsed.username = '';
  parsed.password = '';
  return parsed.toString();
}

const STATIC_ROUTE_SEGMENTS_PRESERVED_DURING_TEMPLATE_SANITIZATION = new Set([
  'bookmarks',
  'communities',
  'explore',
  'following',
  'followers',
  'notifications',
  'verified_followers',
]);

function sanitizeLongRouteSegment(match, segment) {
  return STATIC_ROUTE_SEGMENTS_PRESERVED_DURING_TEMPLATE_SANITIZATION.has(String(segment ?? '').toLowerCase())
    ? `/${segment}`
    : '/:slug';
}

function sanitizeRenderedRouteTemplate(value) {
  const text = String(value ?? '').trim();
  if (!text || /[?#<>"'{}]|(?:authorization|bearer|cookie|sid|uid|token|secret|session|password)/iu.test(text)) {
    return null;
  }
  const pathOnly = text.startsWith('http')
    ? (() => {
      try {
        return new URL(text).pathname;
      } catch {
        return null;
      }
    })()
    : text;
  if (!pathOnly || !pathOnly.startsWith('/')) {
    return null;
  }
  return pathOnly
    .replace(/\/\d+(?=\/|$)/gu, '/:id')
    .replace(/\/([a-z0-9_]{12,})(?=\/|$)/giu, sanitizeLongRouteSegment)
    .slice(0, 160);
}

const X_STATIC_AUTH_ROUTE_SEGMENTS = new Set([
  'compose',
  'explore',
  'following',
  'home',
  'i',
  'jobs',
  'messages',
  'notifications',
  'search',
  'settings',
]);

function usesKnownSocialAuthenticatedPrivacy(context) {
  const policy = context.setupProfile?.knownSitePolicy ?? {};
  const siteKey = String(policy.siteKey ?? policy.adapterId ?? context.site?.id ?? '').toLowerCase();
  const host = String(policy.host ?? context.site?.allowedDomains?.[0] ?? '').toLowerCase();
  return siteKey === 'x'
    || siteKey === 'twitter'
    || host === 'x.com'
    || host === 'twitter.com';
}

function sanitizeKnownSocialAuthenticatedPathname(context, pathname) {
  const normalizedPath = String(pathname ?? '/').replace(/\/{2,}/gu, '/') || '/';
  if (!usesKnownSocialAuthenticatedPrivacy(context)) {
    return normalizedPath;
  }
  const trailingSlash = normalizedPath.length > 1 && normalizedPath.endsWith('/');
  const segments = normalizedPath.split('/').filter(Boolean);
  if (!segments.length) {
    return '/';
  }
  const sanitized = segments.map((segment, index) => {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      decoded = segment;
    }
    const lower = decoded.toLowerCase();
    if (/^[:{]/u.test(decoded)) {
      return decoded;
    }
    if (/^\d{4,}$/u.test(decoded)) {
      return ':id';
    }
    if (index === 0 && !X_STATIC_AUTH_ROUTE_SEGMENTS.has(lower)) {
      return ':account';
    }
    return decoded;
  });
  return `/${sanitized.join('/')}${trailingSlash ? '/' : ''}`;
}

function sanitizeAuthenticatedSummaryUrl(context, normalizedUrl, sourceLayer = 'authenticated') {
  const parsed = new URL(normalizedUrl);
  parsed.search = '';
  parsed.hash = '';
  parsed.username = '';
  parsed.password = '';
  if (/^authenticated/iu.test(String(sourceLayer ?? ''))) {
    parsed.pathname = sanitizeKnownSocialAuthenticatedPathname(context, parsed.pathname);
  }
  return parsed.toString();
}

function sanitizeAuthenticatedRouteTemplate(context, value, normalizedUrl, sourceLayer = 'authenticated') {
  const routeTemplate = sanitizeRenderedRouteTemplate(value)
    ?? routePatternForUrl(normalizedUrl);
  if (!/^authenticated/iu.test(String(sourceLayer ?? ''))) {
    return routeTemplate;
  }
  return sanitizeKnownSocialAuthenticatedPathname(context, routeTemplate);
}

function normalizedRenderedStructureItems(page = /** @type {any} */ ({}), {
  routeTemplate,
  pageType,
  visibleItemCount,
  listPresent,
  emptyStatePresent,
  unreadMarkerPresent,
  structureHash,
  formsLength,
  controlsLength,
} = /** @type {any} */ ({})) {
  const rawItems = Array.isArray(page.structureItems) && page.structureItems.length
    ? page.structureItems
    : [{
      nodeType: page.modalPresence === true ? 'modal' : 'content',
      structureType: page.structureType ?? pageType,
      visibleItemCount,
      listPresent,
      emptyStatePresent,
      unreadMarkerPresent,
      routeTemplates: page.routeTemplates ?? [],
    }];
  return rawItems.slice(0, 24).map((item, index) => {
    const itemVisibleCount = Math.max(0, Number(item?.visibleItemCount ?? visibleItemCount ?? 0) || 0);
    const itemListPresent = item?.listPresent === true || item?.listPresence === true;
    const itemEmptyState = item?.emptyStatePresent === true || item?.empty_state_present === true;
    const routeTemplates = uniqueSortedStrings((item?.routeTemplates ?? item?.route_templates ?? page.routeTemplates ?? [])
      .map(sanitizeRenderedRouteTemplate)
      .filter(Boolean))
      .slice(0, 20);
    const itemStructureType = sanitizedStructureText(item?.structureType ?? item?.structure_type ?? pageType, 80, pageType);
    const itemHash = safeStructureHash(
      'public-rendered-structure-item',
      item?.structureHash,
      `${routeTemplate}:${itemStructureType}:${itemVisibleCount}:${itemListPresent}:${itemEmptyState}:${routeTemplates.join('|')}:${index}`,
    );
    const itemEvidenceStatus = itemVisibleCount > 0
      || itemListPresent
      || itemEmptyState
      || routeTemplates.length > 0
      || Number(item?.formCount ?? 0) > 0
      || formsLength > 0
      || controlsLength > 0
      ? 'structure_summary_present'
      : 'route_seed_only';
    return {
      id: stableNodeId('public-rendered-structure-item', `public_rendered:${routeTemplate}:${itemHash}:${index}`),
      nodeType: ['content', 'operation', 'modal'].includes(item?.nodeType) ? item.nodeType : 'content',
      structureType: itemStructureType,
      labelSummary: `${itemStructureType} sanitized public rendered structure`,
      structureHash: itemHash,
      visibleItemCount: itemVisibleCount,
      listPresent: itemListPresent,
      emptyStatePresent: itemEmptyState,
      unreadMarkerPresent: item?.unreadMarkerPresent === true || unreadMarkerPresent === true,
      routeTemplates,
      evidenceStatus: itemEvidenceStatus,
      riskLevel: page.riskLevel ?? 'read_public_low',
      evidenceLevel: itemEvidenceStatus === 'structure_summary_present' ? 'public_rendered_verified' : 'candidate',
    };
  });
}

function normalizeAuthenticatedStructurePage(context, page = /** @type {any} */ ({}), {
  sourceLayer = 'authenticated',
  authStateReport = context.authStateReport,
  fallbackUrl = context.site.rootUrl,
  overlayFor = null,
} = /** @type {any} */ ({})) {
  const sourceUrl = normalizeUrl(page.normalizedUrl ?? page.url ?? fallbackUrl, context.site.rootUrl);
  if (!isInternalUrl(sourceUrl, context.site.allowedDomains)) {
    return null;
  }
  const normalizedUrl = sanitizeAuthenticatedSummaryUrl(context, sourceUrl, sourceLayer);
  const routeTemplate = sanitizeAuthenticatedRouteTemplate(context, page.routeTemplate ?? page.routePattern, sourceUrl, sourceLayer);
  const visibleItemCount = Math.max(0, Number(page.visibleItemCount ?? 0) || 0);
  const listPresent = page.listPresent === true || page.listPresence === true;
  const emptyStatePresent = page.emptyStatePresent === true || page.empty_state_present === true;
  const unreadMarkerPresent = page.unreadMarkerPresent === true || page.unread_marker_present === true;
  const pageType = page.pageType ?? page.page_type ?? 'authenticated_summary';
  const redactAuthenticatedLabels = /^authenticated/iu.test(String(sourceLayer ?? ''))
    && (context.options?.privacy === 'strict' || authStateReport?.authMethod === 'browser');
  const internalLinks = Array.isArray(page.links)
    ? page.links
      .map((link, index) => {
        try {
          const sourceHref = sanitizeRenderedInternalUrl(context, link?.normalizedHref ?? link?.href, sourceUrl);
          if (!sourceHref) {
            return null;
          }
          const normalizedHref = sanitizeAuthenticatedSummaryUrl(context, sourceHref, sourceLayer);
          return {
            href: normalizedHref,
            normalizedHref,
            label: redactAuthenticatedLabels
              ? `auth-link-${index + 1}`
              : sanitizedStructureText(link?.label, 80, `auth-link-${index + 1}`),
            selector: sanitizedStructureText(link?.selector, 120, `auth-link-${index + 1}`),
            semanticKind: sanitizedStructureText(link?.semanticKind ?? link?.role, 60, null),
            structureType: sanitizedStructureText(link?.structureType ?? link?.structure_type, 100, null),
            routeTemplate: sanitizeAuthenticatedRouteTemplate(context, link?.routeTemplate ?? link?.routePattern, sourceHref, sourceLayer),
            attrs: {},
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
    : [];
  const structureHash = String(page.structureHash ?? page.structure_hash ?? stableNodeId('auth-structure', `${routeTemplate}:${pageType}:${visibleItemCount}:${listPresent}:${emptyStatePresent}:${unreadMarkerPresent}`));
  const forms = Array.isArray(page.forms)
    ? page.forms.slice(0, 12).map((form, index) => sanitizedForm(form, index, { redactLabelText: redactAuthenticatedLabels }))
    : [];
  const controls = Array.isArray(page.controls)
    ? page.controls.slice(0, 40).map((control, index) => sanitizedControl(control, index, { redactLabelText: redactAuthenticatedLabels }))
    : [];
  const elementInstances = extractElementInstances({ links: internalLinks, forms, controls })
    .map((element) => ({
      ...element,
      evidenceLevel: page.evidenceLevel ?? (authStateReport?.authMethod === 'browser' ? 'browser_structure_verified' : 'login_page_verified'),
    }));
  const routeTemplates = uniqueSortedStrings([
    ...(page.routeTemplates ?? page.route_templates ?? []),
    ...internalLinks.map((link) => link.routeTemplate),
  ].map(sanitizeRenderedRouteTemplate).filter(Boolean)).slice(0, 80);
  return {
    routeId: page.routeId ?? null,
    routeProofOnly: page.routeProofOnly === true,
    url: normalizedUrl,
    normalizedUrl,
    depth: 0,
    discoveredBy: 'rendered_link',
    sourceLayer,
    authRequired: true,
    authVerificationStatus: authStateReport?.authVerificationStatus ?? null,
    evidenceLevel: page.evidenceLevel ?? (authStateReport?.authMethod === 'browser'
      ? 'browser_structure_verified'
      : (visibleItemCount > 0 || listPresent || emptyStatePresent ? 'login_page_verified' : 'login_route_verified')),
    sourcePath: normalizedUrl,
    title: page.title ? String(page.title).slice(0, 120) : `${sourceLayer} route ${routeTemplate}`,
    textSummary: 'sanitized authenticated structure summary; no page body persisted',
    canonicalUrl: normalizedUrl,
    routeTemplate,
    routePath: new URL(normalizedUrl).pathname,
    tabState: page.tabState ?? page.tab_state ?? null,
    pageType,
    routeState: {
      source: sourceLayer === 'authenticated_overlay' ? 'authenticated-overlay-summary' : 'authenticated-structure-summary',
      stateId: page.stateKey ?? page.stateId ?? `${sourceLayer}:${routeTemplate}:${page.tabState ?? 'default'}`,
      routeTemplate,
      routePath: new URL(normalizedUrl).pathname,
      tabState: page.tabState ?? page.tab_state ?? null,
      pageType,
    },
    stateKey: page.stateKey ?? page.stateId ?? `${sourceLayer}:${routeTemplate}:${page.tabState ?? 'default'}`,
    visibleItemCount,
    listPresent,
    emptyStatePresent,
    unreadMarkerPresent,
    modalPresence: page.modalPresence === true || page.modal_present === true,
    structureHash,
    evidenceStatus: page.evidenceStatus ?? (visibleItemCount > 0 || listPresent || emptyStatePresent ? 'structure_summary_present' : 'route_seed_only'),
    riskLevel: page.riskLevel ?? 'read_personal_medium',
    links: internalLinks,
    routeTemplates,
    forms,
    controls,
    elementInstances,
    structureItems: page.routeProofOnly === true ? [] : [
      {
        id: stableNodeId('auth-structure-item', `${sourceLayer}:${routeTemplate}:${structureHash}`),
        nodeType: page.modalPresence === true ? 'modal' : 'content',
        structureType: page.structureType ?? pageType,
        labelSummary: page.structureLabel ?? `${pageType} sanitized structure`,
        structureHash,
        visibleItemCount,
        listPresent,
        emptyStatePresent,
        unreadMarkerPresent,
        evidenceStatus: page.evidenceStatus ?? (visibleItemCount > 0 || listPresent || emptyStatePresent ? 'structure_summary_present' : 'route_seed_only'),
        riskLevel: page.riskLevel ?? 'read_personal_medium',
      },
    ],
    overlayFor,
    diagnostics: {
      staticEvidenceStatus: 'present',
      dynamicSignals: [authStateReport?.authMethod === 'browser' ? 'browser-auth-sanitized-summary' : 'cookie-auth-sanitized-summary'],
      warnings: [],
    },
    collection: {
      status: 'success',
      source: authStateReport?.authMethod === 'browser' ? 'browser_auth_sanitized_summary' : 'cookie_auth_sanitized_summary',
      concurrent: false,
    },
    evidence: [
      buildEvidence({
        type: 'text',
        source: normalizedUrl,
        text: `${sourceLayer} sanitized route and structure summary; no session material, unsanitized markup, page body, profile, or private content persisted.`,
        confidence: page.evidenceLevel === 'capability_verified' ? 0.88 : 0.74,
      }),
    ],
  };
}

function browserBridgeRouteProofPage(context, result = /** @type {any} */ ({})) {
  if (!browserBridgeRouteCaptured(result)) {
    return null;
  }
  const targetRoute = result.targetUrl
    ?? result.url
    ?? result.normalizedUrl
    ?? result.targetRoute
    ?? result.routeTemplate;
  if (!targetRoute) {
    return null;
  }
  let sourceUrl;
  try {
    sourceUrl = normalizeUrl(targetRoute, context.site.rootUrl);
  } catch {
    return null;
  }
  if (!isInternalUrl(sourceUrl, context.site.allowedDomains)) {
    return null;
  }
  const sourceLayer = result.sourceLayer === 'authenticated_overlay' ? 'authenticated_overlay' : 'authenticated';
  const normalizedUrl = sanitizeAuthenticatedSummaryUrl(context, sourceUrl, sourceLayer);
  const routeTemplate = sanitizeAuthenticatedRouteTemplate(context, result.routeTemplate, sourceUrl, sourceLayer);
  const pathname = new URL(normalizedUrl).pathname || '/';
  const routeProofTabState = (() => {
    if (sourceLayer === 'authenticated_overlay' && pathname === '/') {
      return 'home';
    }
    const segments = pathname.split('/').map((segment) => segment.trim()).filter(Boolean);
    const last = segments.at(-1);
    return last && !/^\{.+\}$/u.test(last) ? last : null;
  })();
  return {
    routeId: result.routeId ?? null,
    routeProofOnly: true,
    url: normalizedUrl,
    normalizedUrl,
    routeTemplate,
    tabState: routeProofTabState,
    pageType: 'authenticated_route_proof',
    sourceLayer,
    visibleItemCount: 0,
    listPresent: false,
    emptyStatePresent: false,
    unreadMarkerPresent: false,
    modalPresence: false,
    evidenceLevel: 'browser_route_verified',
    evidenceStatus: 'route_capture_present',
    riskLevel: 'read_personal_medium',
    links: [],
    controls: [],
    forms: [],
    structureItems: [],
    structureHash: stableNodeId('browser-route-proof', `${sourceLayer}:${routeTemplate}:${normalizedUrl}`),
  };
}

function browserBridgeRouteProofPages(context, sourceLayer) {
  const routeResults = Array.isArray(context.authStateReport?.browserBridge?.routeResults)
    ? context.authStateReport.browserBridge.routeResults
    : [];
  return routeResults
    .filter((result) => (sourceLayer === 'authenticated_overlay'
      ? result?.sourceLayer === 'authenticated_overlay'
      : result?.sourceLayer !== 'authenticated_overlay'))
    .map((result) => browserBridgeRouteProofPage(context, result))
    .filter(Boolean);
}

function authenticatedRouteCoverageKeys(page = /** @type {any} */ ({})) {
  const sourceLayer = pageSourceLayer(page) === 'authenticated_overlay'
    ? 'authenticated_overlay'
    : 'authenticated';
  const keys = [];
  const routeTemplate = sanitizeRenderedRouteTemplate(page.routeTemplate ?? page.routePattern);
  if (routeTemplate) {
    keys.push(`${sourceLayer}\u0000template:${routeTemplate}`);
  }
  try {
    const normalizedUrl = normalizeUrl(page.normalizedUrl ?? page.url);
    const pathName = new URL(normalizedUrl).pathname.replace(/\/+$/u, '') || '/';
    keys.push(`${sourceLayer}\u0000path:${pathName}`);
  } catch {
    // Route-template matching above is sufficient for non-URL synthetic pages.
  }
  return keys;
}

function authenticatedPageHasStructureEvidence(page = /** @type {any} */ ({})) {
  return page.routeProofOnly !== true && Boolean(
    Number(page.visibleItemCount ?? 0) > 0
    || page.listPresent === true
    || page.emptyStatePresent === true
    || (Array.isArray(page.structureItems) && page.structureItems.length > 0)
    || (Array.isArray(page.links) && page.links.length > 0)
    || (Array.isArray(page.controls) && page.controls.length > 0)
    || (Array.isArray(page.forms) && page.forms.length > 0)
  );
}

function dropCoveredRouteProofPages(pages = /** @type {any[]} */ ([])) {
  const covered = new Set();
  for (const page of pages) {
    if (!authenticatedPageHasStructureEvidence(page)) {
      continue;
    }
    for (const key of authenticatedRouteCoverageKeys(page)) {
      covered.add(key);
    }
  }
  if (!covered.size) {
    return pages;
  }
  return pages.filter((page) => (
    page.routeProofOnly !== true
    || !authenticatedRouteCoverageKeys(page).some((key) => covered.has(key))
  ));
}

function authenticatedStructurePageFromHtml(context, response, {
  sourceLayer = 'authenticated',
  fallbackUrl = context.site.rootUrl,
  overlayFor = null,
} = /** @type {any} */ ({})) {
  const normalizedUrl = normalizeUrl(response?.finalUrl ?? response?.sourcePath ?? response?.requestedUrl ?? fallbackUrl, context.site.rootUrl);
  const body = String(response?.body ?? '');
  const routeTemplate = routePatternForUrl(normalizedUrl);
  const listPresent = /<(?:ul|ol|table)\b|role=["']list["']|data-[^=]*list/iu.test(body);
  const visibleItemCount = (body.match(/<(?:li|article|tr)\b|role=["']listitem["']/giu) ?? []).length;
  const emptyStatePresent = /\b(?:empty|no\s+(?:items|results|messages|notifications|bookmarks))\b/iu.test(body);
  const unreadMarkerPresent = /\b(?:unread|aria-label=["'][^"']*unread)/iu.test(body);
  return normalizeAuthenticatedStructurePage(context, {
    url: normalizedUrl,
    routeTemplate,
    pageType: sourceLayer === 'authenticated_overlay' ? 'authenticated_overlay_summary' : 'authenticated_cookie_summary',
    visibleItemCount,
    listPresent,
    emptyStatePresent,
    unreadMarkerPresent,
    structureHash: stableNodeId('auth-cookie-structure', `${routeTemplate}:${visibleItemCount}:${listPresent}:${emptyStatePresent}:${unreadMarkerPresent}`),
    evidenceLevel: visibleItemCount > 0 || listPresent || emptyStatePresent ? 'login_page_verified' : 'login_route_verified',
  }, { sourceLayer, fallbackUrl: normalizedUrl, overlayFor });
}

async function collectAuthenticatedStructurePages(context, seeds, {
  sourceLayer = 'authenticated',
  overlay = false,
  warnings = /** @type {string[]} */ ([]),
  robotsPolicy = null,
} = /** @type {any} */ ({})) {
  const limit = Math.max(0, Math.min(Number(context.policy.maxPages ?? 20) || 20, seeds.length));
  const pages = [];
  const readSource = context.authRuntime?.method === 'cookie'
    ? createBuildSource(context.inputUrl, {
      ...context.options,
      fetchDelayMs: context.policy.fetchDelayMs,
      fetchTimeoutMs: context.policy.fetchTimeoutMs,
      authRuntime: {
        ...context.authRuntime,
        allowedDomains: context.authRuntime.allowedDomains ?? context.site.allowedDomains,
      },
      robotsPolicy,
    })
    : context.source;
  for (const seed of seeds.slice(0, limit)) {
    try {
      const response = await readSource.read(seed.normalizedUrl ?? seed.url);
      const page = authenticatedStructurePageFromHtml(context, response, {
        sourceLayer,
        fallbackUrl: seed.normalizedUrl ?? seed.url,
        overlayFor: overlay ? seed.normalizedUrl ?? seed.url : null,
      });
      if (page) {
        pages.push(page);
      }
    } catch (error) {
      warnings.push(`authenticated cookie crawl skipped ${sanitizeEvidenceRef(seed.normalizedUrl ?? seed.url) ?? '<url>'}: ${error?.code ?? error?.reasonCode ?? 'fetch_failed'}`);
    }
  }
  return pages;
}

async function crawlAuthenticatedStage(context, stageResults) {
  const authStateReport = context.authStateReport ?? requireStage(stageResults, 'authStateCheck').authStateReport;
  const crawlContract = context.crawlContract ?? requireStage(stageResults, 'authStateCheck').crawlContract;
  const authorizedSourceAuth = crawlContract?.crawlMode === 'authenticated_authorized_source'
    && canRunAuthenticatedLayer(authStateReport);
  const canRunAuth = (['authenticated_cookie', 'authenticated_browser'].includes(crawlContract?.crawlMode) || authorizedSourceAuth)
    && canRunAuthenticatedLayer(authStateReport);
  const warnings = /** @type {string[]} */ ([]);
  markStageSubstepProgress(context, 'prepareSession', {
    message: authorizedSourceAuth ? '准备授权结构摘要认证证据。' : canRunAuth ? '准备认证采集运行时。' : '认证采集未启用或未验证。',
    currentItem: authStateReport?.authMethod ?? 'none',
    processedCount: canRunAuth ? 1 : 0,
    totalCount: 1,
    discoveredCount: authStateReport?.verifiedRoutes?.length ?? 0,
    skippedCount: canRunAuth ? 0 : 1,
  });
  if (authorizedSourceAuth) {
    const authenticatedPages = arrayUniqueBy(authenticatedAuthorizedSourcePages(context, stageResults), (page) => pageIdentity(page))
      .sort((left, right) => pageIdentity(left).localeCompare(pageIdentity(right), 'en'));
    markStageSubstepProgress(context, 'openRoutes', {
      message: '读取授权结构摘要认证页。',
      processedCount: authenticatedPages.length,
      totalCount: authenticatedPages.length,
      discoveredCount: authenticatedPages.length,
      skippedCount: 0,
    });
    markStageSubstepProgress(context, 'collectStructure', {
      message: '使用已授权的 sanitized 结构摘要。',
      processedCount: authenticatedPages.length,
      totalCount: authenticatedPages.length,
      discoveredCount: authenticatedPages.length,
      skippedCount: 0,
    });
    markStageSubstepProgress(context, 'mergeBridgeDiagnostics', {
      message: '授权结构摘要不需要浏览器桥接诊断。',
      processedCount: authenticatedPages.length,
      totalCount: authenticatedPages.length,
      discoveredCount: authenticatedPages.length,
      skippedCount: 0,
    });
    markStageSubstepProgress(context, 'summarizeAuthenticatedPages', {
      message: '汇总授权结构摘要认证证据。',
      processedCount: authenticatedPages.length,
      totalCount: authenticatedPages.length,
      discoveredCount: authenticatedPages.length,
      skippedCount: 0,
    });
    const authCoverageSummary = {
      authenticatedPages: authenticatedPages.length,
      authenticatedOverlayPages: 0,
      authorizedSourcePages: authenticatedPages.length,
      authVerificationStatus: authStateReport.authVerificationStatus,
      verified: authStateReport.verified === true,
      rawMaterialPersisted: false,
      sessionMaterialPersisted: false,
      browserProfilePersisted: false,
    };
    const evidenceBundles = [
      normalizeEvidenceBundle({
        providerId: 'authorized_summary',
        status: authenticatedPages.length ? 'success' : 'skipped',
        authMethod: 'authorized_source',
        authVerificationStatus: authStateReport?.authVerificationStatus ?? null,
        sourceLayer: 'authorized_source',
        pages: authenticatedPages,
        routeResults: [],
        coverage: authCoverageSummary,
        warnings,
        reasonCodes: authenticatedPages.length ? [] : ['authorized-summary-empty'],
        privacy: {
          rawDomSaved: false,
          rawHtmlSaved: false,
          rawContentSaved: false,
          privateContentSaved: false,
          cookiesSaved: false,
          tokensSaved: false,
          browserProfileSaved: false,
        },
      }),
    ];
    const evidenceCoverage = evidenceCoverageFromBundles(evidenceBundles);
    const payload = {
      schemaVersion: BUILD_SCHEMA_VERSION,
      buildId: context.buildId,
      siteId: context.site.id,
      status: authenticatedPages.length ? 'success' : 'skipped',
      reason: authenticatedPages.length ? null : 'Authorized source authentication evidence was configured but no sanitized structure pages were accepted.',
      reasonCode: authenticatedPages.length ? null : 'authorized-summary-empty',
      authenticatedPages,
      authenticatedOverlayPages: [],
      authCoverageSummary,
      warnings,
      evidenceBundles,
      evidenceCoverage,
      privacy: {
        rawDomSaved: false,
        rawHtmlSaved: false,
        rawContentSaved: false,
        privateContentSaved: false,
        cookiesSaved: false,
        tokensSaved: false,
        browserProfileSaved: false,
      },
    };
    const crawlAuthenticatedPath = await writeArtifactJson(context, CRAWL_AUTHENTICATED_FILE, payload);
    return {
      status: payload.status,
      authenticatedPages,
      authenticatedOverlayPages: [],
      evidenceBundles,
      evidenceCoverage,
      authCoverageSummary,
      warnings,
      reasonCode: payload.reasonCode,
      reasonCodes: payload.reasonCode ? [payload.reasonCode] : [],
      artifactPaths: { crawlAuthenticated: crawlAuthenticatedPath },
      summary: authCoverageSummary,
    };
  }
  if (!canRunAuth) {
    markStageSubstepProgress(context, 'summarizeAuthenticatedPages', {
      message: '认证页面采集跳过。',
      processedCount: 0,
      totalCount: 0,
      discoveredCount: 0,
      skippedCount: 1,
    });
    const reason = 'Authenticated crawl skipped because runtime authentication was not requested or did not verify successfully.';
    warnings.push(reason);
    const skippedProviderId = authStateReport?.authMethod === 'browser'
      ? 'browser_bridge'
      : authStateReport?.authMethod === 'cookie'
        ? 'cookie_http'
        : null;
    const evidenceBundles = skippedProviderId ? [
      normalizeEvidenceBundle({
        providerId: skippedProviderId,
        status: 'skipped',
        authMethod: authStateReport?.authMethod ?? 'none',
        authVerificationStatus: authStateReport?.authVerificationStatus ?? null,
        sourceLayer: 'authenticated',
        pages: [],
        warnings,
        reasonCodes: ['missing_auth_evidence'],
      }),
    ] : [];
    const payload = {
      schemaVersion: BUILD_SCHEMA_VERSION,
      buildId: context.buildId,
      siteId: context.site.id,
      status: 'skipped',
      reason,
      reasonCode: 'missing_auth_evidence',
      authenticatedPages: [],
      authenticatedOverlayPages: [],
      authCoverageSummary: {
        authenticatedPages: 0,
        authenticatedOverlayPages: 0,
        authVerificationStatus: authStateReport?.authVerificationStatus ?? null,
        verified: authStateReport?.verified === true,
      },
      privacy: {
        rawDomSaved: false,
        rawHtmlSaved: false,
        rawContentSaved: false,
        privateContentSaved: false,
        cookiesSaved: false,
        tokensSaved: false,
        browserProfileSaved: false,
      },
      evidenceBundles,
      evidenceCoverage: evidenceCoverageFromBundles(evidenceBundles),
    };
    const crawlAuthenticatedPath = await writeArtifactJson(context, CRAWL_AUTHENTICATED_FILE, payload);
    return {
      status: 'skipped',
      authenticatedPages: [],
      authenticatedOverlayPages: [],
      evidenceBundles,
      evidenceCoverage: payload.evidenceCoverage,
      authCoverageSummary: payload.authCoverageSummary,
      warnings,
      reasonCode: 'missing_auth_evidence',
      reasonCodes: ['missing_auth_evidence'],
      artifactPaths: { crawlAuthenticated: crawlAuthenticatedPath },
      summary: payload.authCoverageSummary,
    };
  }

  let provided = null;
  if (typeof context.options.authenticatedStructureProvider === 'function') {
    markStageSubstepProgress(context, 'openRoutes', {
      message: '调用认证结构提供器。',
      processedCount: 0,
      totalCount: 1,
      discoveredCount: 0,
    });
    provided = await context.options.authenticatedStructureProvider({
      context,
      site: context.site,
      authStateReport,
      crawlContract,
      seeds: stageResults.discoverSeeds,
    });
  } else if (context.authenticatedStructureSummary) {
    provided = context.authenticatedStructureSummary;
  }
  const authSeeds = stageResults.discoverSeeds?.authSeeds ?? [];
  const revisitSeeds = stageResults.discoverSeeds?.revisitSeeds ?? [];
  const robotsPolicy = stageResults.discoverSeeds?.robotsPolicy ?? setupProfileRobotsPolicy(context);
  markStageSubstepProgress(context, 'openRoutes', {
    message: '打开认证和重访路由队列。',
    processedCount: 0,
    totalCount: authSeeds.length + revisitSeeds.length,
    discoveredCount: authSeeds.length,
    skippedCount: 0,
  });
  if (!provided) {
    markStageSubstepProgress(context, 'collectStructure', {
      message: '采集认证页面结构。',
      processedCount: 0,
      totalCount: authSeeds.length + revisitSeeds.length,
      discoveredCount: 0,
      skippedCount: 0,
    });
    provided = {
      authenticatedPages: await collectAuthenticatedStructurePages(context, authSeeds, {
        sourceLayer: 'authenticated',
        warnings,
        robotsPolicy,
      }),
      authenticatedOverlayPages: await collectAuthenticatedStructurePages(context, revisitSeeds, {
        sourceLayer: 'authenticated_overlay',
        overlay: true,
        warnings,
        robotsPolicy,
      }),
    };
  }
  markStageSubstepProgress(context, 'mergeBridgeDiagnostics', {
    message: '合并认证桥接诊断。',
    processedCount: (provided.authenticatedPages ?? provided.pages ?? []).length,
    totalCount: (provided.authenticatedPages ?? provided.pages ?? []).length + (provided.authenticatedOverlayPages ?? provided.overlayPages ?? []).length,
    discoveredCount: authSeeds.length + revisitSeeds.length,
    skippedCount: warnings.length,
  });
  const authenticatedSourcePages = [
    ...(provided.authenticatedPages ?? provided.pages ?? []),
    ...browserBridgeRouteProofPages(context, 'authenticated'),
  ];
  const authenticatedOverlaySourcePages = [
    ...(provided.authenticatedOverlayPages ?? provided.overlayPages ?? []),
    ...browserBridgeRouteProofPages(context, 'authenticated_overlay'),
  ];
  const authenticatedPages = arrayUniqueBy(dropCoveredRouteProofPages(authenticatedSourcePages
    .map((page, index) => normalizeAuthenticatedStructurePage(context, page, {
      sourceLayer: 'authenticated',
      authStateReport,
      fallbackUrl: authSeeds[index]?.normalizedUrl ?? context.site.rootUrl,
    }))
    .filter((page) => {
      if (!page) {
        return false;
      }
      if (!browserBridgePageWasCaptured(context, page)) {
        warnings.push(`browser bridge authenticated summary ignored for uncaptured route ${sanitizeEvidenceRef(page.routeTemplate ?? page.normalizedUrl) ?? '<route>'}`);
        return false;
      }
      return true;
    })), (page) => pageIdentity(page))
    .sort((left, right) => pageIdentity(left).localeCompare(pageIdentity(right), 'en'));
  const authenticatedOverlayPages = arrayUniqueBy(dropCoveredRouteProofPages(authenticatedOverlaySourcePages
    .map((page, index) => normalizeAuthenticatedStructurePage(context, page, {
      sourceLayer: 'authenticated_overlay',
      authStateReport,
      fallbackUrl: revisitSeeds[index]?.normalizedUrl ?? context.site.rootUrl,
      overlayFor: page.overlayFor ?? page.publicUrl ?? revisitSeeds[index]?.normalizedUrl ?? null,
    }))
    .filter((page) => {
      if (!page) {
        return false;
      }
      if (!browserBridgePageWasCaptured(context, page)) {
        warnings.push(`browser bridge authenticated overlay summary ignored for uncaptured route ${sanitizeEvidenceRef(page.routeTemplate ?? page.normalizedUrl) ?? '<route>'}`);
        return false;
      }
      return true;
    })), (page) => pageIdentity(page))
    .sort((left, right) => pageIdentity(left).localeCompare(pageIdentity(right), 'en'));
  warnings.push(...(Array.isArray(provided.warnings) ? provided.warnings.map(String) : []));
  markStageSubstepProgress(context, 'summarizeAuthenticatedPages', {
    message: '汇总认证页面证据。',
    processedCount: authenticatedPages.length + authenticatedOverlayPages.length,
    totalCount: authSeeds.length + revisitSeeds.length,
    discoveredCount: authenticatedPages.length + authenticatedOverlayPages.length,
    skippedCount: warnings.length,
  });
  const authCoverageSummary = {
    authenticatedPages: authenticatedPages.length,
    authenticatedOverlayPages: authenticatedOverlayPages.length,
    authVerificationStatus: authStateReport.authVerificationStatus,
    verified: authStateReport.verified === true,
    rawMaterialPersisted: false,
    sessionMaterialPersisted: false,
    browserProfilePersisted: false,
  };
  const authenticatedProviderId = authStateReport?.authMethod === 'browser' ? 'browser_bridge' : 'cookie_http';
  const evidenceBundles = canUseEvidenceProvider(context, authenticatedProviderId)
    ? [
      normalizeEvidenceBundle({
        providerId: authenticatedProviderId,
        status: 'success',
        authMethod: authStateReport?.authMethod ?? (authenticatedProviderId === 'browser_bridge' ? 'browser' : 'cookie'),
        authVerificationStatus: authStateReport?.authVerificationStatus ?? null,
        sourceLayer: 'authenticated',
        pages: [...authenticatedPages, ...authenticatedOverlayPages],
        routeResults: authenticatedProviderId === 'browser_bridge'
          ? (authStateReport?.browserBridge?.routeResults ?? [])
          : [],
        coverage: authCoverageSummary,
        warnings,
        reasonCodes: [],
      }),
    ]
    : [];
  const evidenceCoverage = evidenceCoverageFromBundles(evidenceBundles);
  const payload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    status: 'success',
    authenticatedPages,
    authenticatedOverlayPages,
    authCoverageSummary,
    warnings,
    evidenceBundles,
    evidenceCoverage,
    privacy: {
      rawDomSaved: false,
      rawHtmlSaved: false,
      rawContentSaved: false,
      privateContentSaved: false,
      cookiesSaved: false,
      tokensSaved: false,
      browserProfileSaved: false,
    },
  };
  const crawlAuthenticatedPath = await writeArtifactJson(context, CRAWL_AUTHENTICATED_FILE, payload);
  return {
    authenticatedPages,
    authenticatedOverlayPages,
    evidenceBundles,
    evidenceCoverage,
    authCoverageSummary,
    warnings,
    artifactPaths: { crawlAuthenticated: crawlAuthenticatedPath },
    summary: authCoverageSummary,
  };
}

function publicRenderedStructureSummaryFromPage(maxItems = 40) {
  const bounded = Math.max(1, Number(maxItems) || 40);
  const attr = (node, name) => String(node?.getAttribute?.(name) || '').trim();
  const role = (node) => attr(node, 'role').toLowerCase();
  const templateFromUrl = (value) => {
    try {
      const url = new URL(value, window.location.href);
      if (url.origin !== window.location.origin) return null;
      return url.pathname
        .replace(/\/\d+(?=\/|$)/gu, '/:id')
        .replace(/\/[a-z0-9]{12,}(?=\/|$)/giu, '/:slug')
        .replace(/\/+$/u, '/') || '/';
    } catch {
      return null;
    }
  };
  const label = (node, fallback) => String(
    attr(node, 'aria-label')
    || attr(node, 'title')
    || attr(node, 'placeholder')
    || attr(node, 'name')
    || fallback
    || '',
  ).trim().slice(0, 80);
  const hrefOf = (node) => String(node?.href || attr(node, 'href') || '').trim();
  const listContainers = [
    ...document.querySelectorAll('ul, ol, table, [role="list"], [role="feed"], [data-list], [class*="list"], [class*="grid"], [class*="feed"]'),
  ];
  const itemNodes = [
    ...document.querySelectorAll('article, li, tr, [role="listitem"], [class*="item"], [class*="card"], [data-item]'),
  ];
  const bodyText = String(document.body?.innerText || '').slice(0, 4000);
  const routePath = `${window.location.pathname || '/'}${window.location.search || ''}`;
  const routeTemplates = [...new Set([...document.querySelectorAll('a[href], area[href]')]
    .map((node) => templateFromUrl(hrefOf(node)))
    .filter(Boolean))].slice(0, bounded);
  const categoryRouteTemplates = routeTemplates.filter((route) => /\/(?:all|finish|free|mm|boy|girl|category|categories|genre|genres|rank|ranking|top|hot)(?:\/|$)/iu.test(route));
  const bookRouteTemplates = routeTemplates.filter((route) => /\/(?:book|books|work|works)\/(?::id|:slug)(?:\/|$)/iu.test(route));
  const chapterRouteTemplates = routeTemplates.filter((route) => /\/chapter\/(?::id|:slug)\/(?::id|:slug)(?:\/|$)/iu.test(route));
  const searchForms = [...document.querySelectorAll('form')].filter((form) => /search|soushu|query|keyword|q\b/iu.test(`${form.action || ''} ${form.method || ''} ${form.textContent || ''} ${[...form.querySelectorAll('input, select, textarea')].map((input) => `${attr(input, 'name')} ${attr(input, 'type')}`).join(' ')}`));
  const structureItems = [];
  if (categoryRouteTemplates.length) {
    structureItems.push({
      nodeType: 'content',
      structureType: categoryRouteTemplates.some((route) => /rank|top|hot/iu.test(route)) ? 'book_ranking_list' : 'book_category_list',
      visibleItemCount: categoryRouteTemplates.length,
      listPresent: true,
      routeTemplates: categoryRouteTemplates.slice(0, 20),
    });
  }
  if (bookRouteTemplates.length) {
    structureItems.push({
      nodeType: 'content',
      structureType: 'book_card',
      visibleItemCount: bookRouteTemplates.length,
      listPresent: true,
      routeTemplates: bookRouteTemplates.slice(0, 20),
    });
  }
  if (chapterRouteTemplates.length) {
    structureItems.push({
      nodeType: 'content',
      structureType: 'chapter_link',
      visibleItemCount: chapterRouteTemplates.length,
      listPresent: true,
      routeTemplates: chapterRouteTemplates.slice(0, 20),
    });
  }
  if (searchForms.length) {
    structureItems.push({
      nodeType: 'operation',
      structureType: 'book_search_form',
      visibleItemCount: 0,
      listPresent: false,
      formCount: searchForms.length,
    });
  }
  const loginLike = /(?:^|\/)(?:login|signin|sign-in|account\/login)(?:\/|$)/iu.test(window.location.pathname)
    || /\b(?:log in|sign in|please authenticate|account required)\b/iu.test(bodyText);
  const challengeLike = /\b(?:captcha|verify you are human|checking your browser|security check|challenge|anti[-\s]?bot)\b/iu.test(bodyText);
  return {
    url: window.location.href,
    finalUrl: window.location.href,
    title: String(document.title || '').slice(0, 120),
    routePath,
    pageType: window.location.pathname === '/' ? 'home' : 'public_rendered_summary',
    listPresent: listContainers.length > 0,
    visibleItemCount: Math.min(itemNodes.length, 999),
    emptyStatePresent: /\b(?:no results|no items|empty|nothing found)\b/iu.test(bodyText),
    modalPresence: document.querySelector('[role="dialog"], dialog, [class*="modal"]') !== null,
    unreadMarkerPresent: document.querySelector('[aria-label*="unread" i], [class*="unread" i]') !== null,
    loginLike,
    challengeLike,
    routeTemplates,
    structureItems,
    links: [...document.querySelectorAll('a[href], area[href]')].slice(0, bounded).map((node, index) => ({
      href: hrefOf(node),
      label: label(node, `link-${index + 1}`),
      selector: `a[href]:nth-of-type(${index + 1})`,
    })),
    forms: [...document.querySelectorAll('form')].slice(0, Math.min(12, bounded)).map((form, index) => ({
      label: label(form, `form-${index + 1}`),
      selector: `form:nth-of-type(${index + 1})`,
      method: String(form.method || 'GET').toUpperCase(),
      action: String(form.action || window.location.href),
      inputs: [...form.querySelectorAll('input, select, textarea')].slice(0, 20).map((input, inputIndex) => ({
        name: attr(input, 'name'),
        type: attr(input, 'type') || input.tagName.toLowerCase(),
        selector: `${input.tagName.toLowerCase()}:nth-of-type(${inputIndex + 1})`,
        label: label(input, `input-${inputIndex + 1}`),
        tagName: input.tagName.toLowerCase(),
      })),
    })),
    controls: [...document.querySelectorAll('button, input, select, textarea, [role="button"], [role="tab"], [role="menuitem"]')]
      .slice(0, bounded)
      .map((node, index) => ({
        kind: role(node) || node.tagName.toLowerCase(),
        type: attr(node, 'type') || null,
        label: label(node, `control-${index + 1}`),
        name: attr(node, 'name') || null,
        selector: `${node.tagName.toLowerCase()}:nth-of-type(${index + 1})`,
        attrs: { role: role(node) || null },
      })),
  };
}

function normalizePublicRenderedStructurePage(context, page = /** @type {any} */ ({}), {
  fallbackUrl = context.site.rootUrl,
  respectRobots = true,
} = /** @type {any} */ ({})) {
  const normalizedUrl = sanitizeRenderedInternalUrl(context, page.normalizedUrl ?? page.finalUrl ?? page.url ?? fallbackUrl, context.site.rootUrl);
  if (!normalizedUrl) {
    return null;
  }
  const robotsPolicy = respectRobots === false ? null : setupProfileRobotsPolicy(context);
  if (robotsPolicy && !isUrlAllowedByRobots(normalizedUrl, robotsPolicy)) {
    return {
      blocked: true,
      url: normalizedUrl,
      normalizedUrl,
      reasonCode: 'robots-disallowed',
    };
  }
  const routeTemplate = page.routeTemplate ?? routePatternForUrl(normalizedUrl);
  if (matchesMissingAuthenticatedBrowserBridgeRoute(context, [routeTemplate, normalizedUrl], { nonRoot: true })) {
    return {
      blocked: true,
      url: normalizedUrl,
      normalizedUrl,
      reasonCode: 'browser-auth-route-coverage-partial',
    };
  }
  const visibleItemCount = Math.max(0, Number(page.visibleItemCount ?? 0) || 0);
  const listPresent = page.listPresent === true || page.listPresence === true;
  const emptyStatePresent = page.emptyStatePresent === true || page.empty_state_present === true;
  const unreadMarkerPresent = page.unreadMarkerPresent === true || page.unread_marker_present === true;
  const pageType = page.pageType ?? page.page_type ?? (new URL(normalizedUrl).pathname === '/' ? 'home' : 'public_rendered_summary');
  const normalizedPath = new URL(normalizedUrl).pathname.toLowerCase();
  const blockedByChallenge = page.challengeLike === true
    || page.blockerCategory === 'challenge_or_probe'
    || /(?:^|\/)(?:challenge|captcha|checkpoint|verify)(?:\/|$)/u.test(normalizedPath);
  const blockedByAuth = page.loginLike === true
    || page.blockerCategory === 'auth_required'
    || /(?:^|\/)(?:login|signin|sign-in|auth|account\/login)(?:\/|$)/u.test(normalizedPath);
  if (blockedByChallenge || blockedByAuth) {
    return {
      blocked: true,
      url: normalizedUrl,
      normalizedUrl,
      reasonCode: blockedByChallenge ? 'blocked_by_challenge' : 'blocked_by_auth',
    };
  }
  const internalLinks = Array.isArray(page.links)
    ? page.links
      .map((link, index) => {
        try {
          const normalizedHref = sanitizeRenderedInternalUrl(context, link?.normalizedHref ?? link?.href, normalizedUrl);
          if (!normalizedHref) {
            return null;
          }
          if (robotsPolicy && !isUrlAllowedByRobots(normalizedHref, robotsPolicy)) {
            return null;
          }
          if (matchesMissingAuthenticatedBrowserBridgeRoute(context, [link?.routeTemplate, link?.routePattern, normalizedHref], { nonRoot: true })) {
            return null;
          }
          return {
            href: normalizedHref,
            normalizedHref,
            label: sanitizedStructureText(link?.label, 80, `rendered-link-${index + 1}`),
            selector: sanitizedStructureText(link?.selector, 120, `rendered-link-${index + 1}`),
            semanticKind: sanitizedStructureText(link?.semanticKind ?? link?.role, 60, null),
            structureType: sanitizedStructureText(link?.structureType ?? link?.structure_type, 100, null),
            routeTemplate: sanitizeRenderedRouteTemplate(link?.routeTemplate ?? link?.routePattern),
            attrs: {},
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
    : [];
  const forms = Array.isArray(page.forms)
    ? page.forms.slice(0, 12).map((form, index) => {
      const next = sanitizedForm(form, index, { fallbackPrefix: 'public-rendered' });
      try {
        next.action = next.action ? sanitizeRenderedInternalUrl(context, next.action, normalizedUrl) : normalizedUrl;
      } catch {
        next.action = null;
      }
      next.textSummary = 'sanitized public rendered form structure only';
      return next;
    })
    : [];
  const controls = Array.isArray(page.controls)
    ? page.controls.slice(0, 40).map((control, index) => sanitizedControl(control, index, { fallbackPrefix: 'public-rendered' }))
    : [];
  const routeTemplates = uniqueSortedStrings((page.routeTemplates ?? page.route_templates ?? [])
    .map(sanitizeRenderedRouteTemplate)
    .filter(Boolean))
    .slice(0, 40);
  const elementInstances = extractElementInstances({ links: internalLinks, forms, controls })
    .map((element) => ({
      ...element,
      evidenceLevel: 'public_rendered_verified',
    }));
  const structureHash = safeStructureHash(
    'public-rendered-structure',
    page.structureHash ?? page.structure_hash,
    `${routeTemplate}:${pageType}:${visibleItemCount}:${listPresent}:${emptyStatePresent}:${unreadMarkerPresent}:${forms.length}:${controls.length}:${routeTemplates.join('|')}`,
  );
  const structureItems = normalizedRenderedStructureItems(page, {
    routeTemplate,
    pageType,
    visibleItemCount,
    listPresent,
    emptyStatePresent,
    unreadMarkerPresent,
    structureHash,
    formsLength: forms.length,
    controlsLength: controls.length,
  });
  const structurePresent = visibleItemCount > 0
    || listPresent
    || emptyStatePresent
    || forms.length > 0
    || controls.length > 0
    || routeTemplates.length > 0
    || structureItems.some((item) => item.evidenceStatus === 'structure_summary_present');
  return {
    url: normalizedUrl,
    normalizedUrl,
    depth: 0,
    discoveredBy: 'rendered_link',
    sourceLayer: 'public_rendered',
    authRequired: false,
    authVerificationStatus: 'not_requested',
    evidenceLevel: structurePresent ? 'public_rendered_verified' : 'candidate',
    sourcePath: normalizedUrl,
    title: sanitizedStructureText(page.title, 120, `public rendered route ${routeTemplate}`),
    textSummary: 'sanitized public rendered structure summary; no page body persisted',
    canonicalUrl: normalizedUrl,
    routeTemplate,
    routePath: new URL(normalizedUrl).pathname,
    tabState: page.tabState ?? page.tab_state ?? null,
    pageType,
    routeState: {
      source: 'public-rendered-structure-summary',
      stateId: page.stateKey ?? page.stateId ?? `public_rendered:${routeTemplate}:${page.tabState ?? 'default'}`,
      routeTemplate,
      routePath: new URL(normalizedUrl).pathname,
      tabState: page.tabState ?? page.tab_state ?? null,
      pageType,
    },
    stateKey: page.stateKey ?? page.stateId ?? `public_rendered:${routeTemplate}:${page.tabState ?? 'default'}`,
    visibleItemCount,
    listPresent,
    emptyStatePresent,
    unreadMarkerPresent,
    modalPresence: page.modalPresence === true || page.modal_present === true,
    structureHash,
    evidenceStatus: structurePresent ? 'structure_summary_present' : 'route_seed_only',
    riskLevel: page.riskLevel ?? 'read_public_low',
    links: internalLinks,
    forms,
    controls,
    elementInstances,
    routeTemplates,
    structureItems,
    diagnostics: {
      staticEvidenceStatus: 'present',
      publicEvidenceStatus: structurePresent ? 'public_rendered_structured' : 'public_rendered_route_seed_only',
      blockerCategory: null,
      dynamicSignals: ['public-rendered-structure-summary'],
      warnings: [],
    },
    collection: {
      status: 'success',
      source: 'public_rendered_sanitized_summary',
      concurrent: false,
    },
    evidence: [
      buildEvidence({
        type: 'text',
        source: normalizedUrl,
        text: 'public rendered sanitized route and structure summary; no session material, unsanitized markup, network payload, profile, or page body persisted.',
        confidence: 0.76,
      }),
    ],
  };
}

function renderedTargetKind(context, entry = /** @type {any} */ ({})) {
  let urlValue = typeof entry === 'string'
    ? entry
    : (entry.normalizedUrl ?? entry.url ?? '');
  let pathname = '';
  try {
    pathname = new URL(urlValue, context.site.rootUrl).pathname.toLowerCase().replace(/\/+$/u, '') || '/';
  } catch {
    pathname = String(urlValue ?? '').toLowerCase();
  }
  const text = [
    pathname,
    typeof entry === 'string' ? '' : entry.classification,
    typeof entry === 'string' ? '' : entry.pageType,
    typeof entry === 'string' ? '' : entry.structureType,
  ].join(' ').toLowerCase();
  if (pathname === '/') return 'home';
  if (/book_ranking_list|ranking_list|\b(?:rank|ranking|top|hot|popular)\b|\/(?:rank|ranking|top|hot)(?:\/|$)/u.test(text)) return 'ranking';
  if (/book_search|search_results|search_page|search|\/(?:search|soushu|so|booksearch)(?:\/|$)/u.test(text)) return 'search';
  if (/chapter_detail|chapter-page|\/(?:chapter|chapters|reader|read)(?:\/|$)/u.test(text)) return 'chapter';
  if (/book_detail|content-detail|entity_detail|\/(?:book|books|works|work)(?:\/|$)/u.test(text)) return 'detail';
  if (/book_category_list|category_list|catalog_category|\/(?:all|finish|free|mm|boy|girl|category|categories|genre|genres|bookstore|library)(?:\/|$)/u.test(text)) return 'category';
  if (/book_collection_list|collection_list|catalog_collection|chapter_content_home|\/(?:strongrec|coverrec|sanjiang|library|bookstore)(?:\/|$)/u.test(text)) return 'collection';
  return 'other';
}

function renderedTargetPriority(context, entry = /** @type {any} */ ({})) {
  const kind = renderedTargetKind(context, entry);
  return renderedTargetKindPriority(context, kind);
}

function renderedTargetKindPriority(context, kind) {
  const chapterContent = isChapterContentContext(context);
  const order = chapterContent
    ? ['home', 'ranking', 'search', 'detail', 'chapter', 'category', 'collection', 'other']
    : ['home', 'search', 'ranking', 'category', 'collection', 'detail', 'chapter', 'other'];
  const index = order.indexOf(kind);
  return index === -1 ? order.length : index;
}

function prioritizedRenderedTargets(context, entries = /** @type {any[]} */ ([])) {
  const normalizedEntries = entries
    .map((entry, index) => {
      const urlValue = typeof entry === 'string'
        ? entry
        : (entry.normalizedUrl ?? entry.url ?? null);
      if (!urlValue) {
        return null;
      }
      return {
        entry,
        index,
        url: urlValue,
        kind: renderedTargetKind(context, entry),
        priority: renderedTargetPriority(context, entry),
      };
    })
    .filter(Boolean);
  const deduped = arrayUniqueBy(normalizedEntries, (entry) => entry.url);
  const byKind = new Map();
  for (const entry of deduped) {
    const bucket = byKind.get(entry.kind) ?? [];
    bucket.push(entry);
    byKind.set(entry.kind, bucket);
  }
  const compareTargets = (left, right) => (
    left.priority - right.priority
    || left.index - right.index
    || String(left.url).localeCompare(String(right.url), 'en')
  );
  for (const bucket of byKind.values()) {
    bucket.sort(compareTargets);
  }
  const orderedKinds = deduped
    .map((entry) => entry.kind)
    .filter((kind, index, kinds) => kinds.indexOf(kind) === index)
    .sort((left, right) => renderedTargetKindPriority(context, left) - renderedTargetKindPriority(context, right));
  const representatives = orderedKinds
    .map((kind) => byKind.get(kind)?.shift())
    .filter(Boolean);
  const remaining = [...byKind.values()].flat().sort(compareTargets);
  return arrayUniqueBy([...representatives, ...remaining], (entry) => entry.url)
    .map((entry) => entry.url)
    .filter((urlValue) => isInternalUrl(urlValue, context.site.allowedDomains));
}

export function renderedTargetsFromStageResults(context, stageResults) {
  const staticPages = stageResults.crawlStatic?.pages ?? [];
  const dynamicPages = staticPages.filter((page) => !hasUsableStaticPageEvidence(page));
  const seedUrls = (stageResults.discoverSeeds?.publicSeeds ?? stageResults.discoverSeeds?.seeds ?? [])
    .map((seed) => seed.normalizedUrl ?? seed.url)
    .filter(Boolean);
  const targets = dynamicPages.length ? dynamicPages : seedUrls;
  return prioritizedRenderedTargets(context, targets)
    .slice(0, Math.max(1, Math.min(Number(context.policy.maxPages ?? 10) || 10, 10)));
}

async function collectPublicRenderedStructurePagesWithBrowser(context, targets, warnings) {
  if (!targets.length) {
    return [];
  }
  let session = null;
  try {
    session = await openBrowserSession({
      browserPath: context.options.browserPath,
      headless: context.options.headless !== false,
      timeoutMs: Math.min(Number(context.options.timeoutMs ?? context.policy.fetchTimeoutMs ?? 10_000) || 10_000, 20_000),
      startupUrl: 'about:blank',
      userDataDir: null,
      cleanupUserDataDirOnShutdown: true,
      userDataDirPrefix: 'siteforge-public-render-',
      userAgent: context.options.publicRenderedUserAgent,
      viewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
      fullPage: false,
      sessionOpenRetries: 1,
      networkCapture: {
        rawNetworkCapture: context.options.internalRawNetwork === true,
        maxRawNetworkTraces: context.options.rawNetworkTraceLimit ?? 100,
        maxRawResponseBodyBytes: context.options.rawNetworkBodyMaxBytes ?? 256 * 1024,
      },
    }, {
      userDataDirPrefix: 'siteforge-public-render-',
      userDataDir: null,
      cleanupUserDataDirOnShutdown: true,
    }, context.options.publicRenderedBrowserDeps ?? {});
    const pages = [];
    for (const target of targets.slice(0, Math.max(1, Math.min(Number(context.policy.maxPages ?? 5) || 5, 10)))) {
      try {
        await session.navigateAndWait(target, {
          useLoadEvent: false,
          useNetworkIdle: false,
          documentReadyTimeoutMs: Math.min(Number(context.policy.fetchTimeoutMs ?? 10_000) || 10_000, 12_000),
          domQuietMs: 500,
          domQuietTimeoutMs: 3_000,
          idleMs: 250,
        });
        const summary = await session.callPageFunction(publicRenderedStructureSummaryFromPage, 60);
        pages.push(summary);
      } catch (error) {
        warnings.push(`public rendered collection skipped ${sanitizeEvidenceRef(target) ?? '<url>'}: ${error?.code ?? error?.message ?? 'render_failed'}`);
      }
    }
    if (context.options.internalRawNetwork === true) {
      await session.waitForRawNetworkBodies?.();
      const siteKey = context.site?.id ?? 'site';
      context.internalRawNetworkCapture = {
        status: 'captured',
        rawTraces: session.getRawNetworkTraces?.({ limit: 100 }) ?? [],
        observedRequests: session.getObservedNetworkRequests?.({ siteKey, limit: 100 }) ?? [],
        observedResponseSummaries: session.getObservedNetworkResponseSummaries?.({ siteKey, limit: 100 }) ?? [],
      };
    }
    return pages;
  } catch (error) {
    warnings.push(`public rendered collection unavailable: ${error?.code ?? error?.message ?? 'browser_unavailable'}`);
    return [];
  } finally {
    await session?.close?.();
  }
}

async function crawlRenderedStage(context, stageResults) {
  const warnings = /** @type {string[]} */ ([]);
  const renderedRequired = stageResults.crawlStatic?.summary?.renderedEvidenceRequired === true;
  const targets = renderedTargetsFromStageResults(context, stageResults);
  const hasPublicStaticGaps = (stageResults.crawlStatic?.pages ?? []).some((page) => !hasUsableStaticPageEvidence(page));
  const renderRequested = canAttemptPublicRenderedLayer(context, { renderedRequired })
    || (hasPublicStaticGaps && targets.length > 0 && canAutoAttemptPublicRenderedLayer(context));
  markStageSubstepProgress(context, 'selectRenderedTargets', {
    message: '选择需要浏览器渲染的公开页面。',
    processedCount: 0,
    totalCount: targets.length,
    discoveredCount: targets.length,
    skippedCount: renderRequested ? 0 : targets.length,
  });
  if (!renderRequested) {
    markStageSubstepProgress(context, 'dedupeRenderedPages', {
      message: '渲染采集未请求，跳过渲染页面去重。',
      processedCount: 0,
      totalCount: targets.length,
      discoveredCount: 0,
      skippedCount: targets.length,
    });
    const evidenceBundles = [
      normalizeEvidenceBundle({
        providerId: 'public_rendered',
        status: 'skipped',
        authMethod: 'none',
        sourceLayer: 'public_rendered',
        pages: [],
        warnings: ['Public rendered crawl was not requested; static-only public evidence remains the activation boundary.'],
        reasonCodes: ['dynamic-unsupported'],
      }),
    ];
    const payload = {
      schemaVersion: BUILD_SCHEMA_VERSION,
      buildId: context.buildId,
      siteId: context.site.id,
      status: 'skipped',
      reason: 'Public rendered crawl was not requested; static-only public evidence remains the activation boundary.',
      publicRenderedPages: [],
      pages: [],
      publicRenderedCoverageSummary: {
        pages: 0,
        sourceLayer: 'public_rendered',
        renderedRequired,
        rawDomSaved: false,
        rawHtmlSaved: false,
        rawContentSaved: false,
        cookiesSaved: false,
        tokensSaved: false,
        browserProfileSaved: false,
      },
      evidenceBundles,
      evidenceCoverage: evidenceCoverageFromBundles(evidenceBundles),
    };
    const crawlRenderedPath = await writeArtifactJson(context, 'crawl_rendered.json', payload);
    return {
      status: 'skipped',
      reasonCode: 'dynamic-unsupported',
      reasonCodes: ['dynamic-unsupported'],
      warnings: [payload.reason],
      publicRenderedPages: [],
      evidenceBundles,
      evidenceCoverage: payload.evidenceCoverage,
      artifactPaths: { crawlRendered: crawlRenderedPath },
      summary: payload.publicRenderedCoverageSummary,
    };
  }
  let provided = null;
  markStageSubstepProgress(context, 'launchBrowserRuntime', {
    message: '准备浏览器渲染运行时。',
    processedCount: 0,
    totalCount: targets.length,
    discoveredCount: 0,
  });
  if (typeof context.options.publicRenderedStructureProvider === 'function') {
    provided = await context.options.publicRenderedStructureProvider({
      context,
      site: context.site,
      seeds: stageResults.discoverSeeds,
      staticPages: stageResults.crawlStatic?.pages ?? [],
      renderedRequired,
    });
  } else if (context.options.publicRenderedStructureSummary) {
    provided = context.options.publicRenderedStructureSummary;
  }
  if (!provided) {
    markStageSubstepProgress(context, 'captureRenderedFacts', {
      message: '采集浏览器渲染结构事实。',
      currentItem: targets[0] ?? null,
      processedCount: 0,
      totalCount: targets.length,
      discoveredCount: 0,
    });
    provided = {
      publicRenderedPages: await collectPublicRenderedStructurePagesWithBrowser(context, targets, warnings),
    };
  }
  markStageSubstepProgress(context, 'dedupeRenderedPages', {
    message: '去重并清洗渲染页面证据。',
    processedCount: (provided.publicRenderedPages ?? provided.pages ?? []).length,
    totalCount: targets.length,
    discoveredCount: (provided.publicRenderedPages ?? provided.pages ?? []).length,
    skippedCount: warnings.length,
  });
  const blockedPages = [];
  const publicRenderedPages = arrayUniqueBy((provided.publicRenderedPages ?? provided.pages ?? [])
    .map((page, index) => normalizePublicRenderedStructurePage(context, page, {
      fallbackUrl: targets[index] ?? context.site.rootUrl,
    }))
    .filter((page) => {
      if (page?.blocked === true) {
        blockedPages.push(page);
        return false;
      }
      return Boolean(page);
    }), (page) => pageIdentity(page))
    .sort((left, right) => pageIdentity(left).localeCompare(pageIdentity(right), 'en'));
  warnings.push(...(Array.isArray(provided.warnings) ? provided.warnings.map(String) : []));
  if (blockedPages.length) {
    warnings.push(`public rendered collection blocked on ${blockedPages.length} route(s): ${uniqueSortedStrings(blockedPages.map((page) => page.reasonCode)).join(',')}`);
  }
  const publicRenderedCoverageSummary = {
    pages: publicRenderedPages.length,
    sourceLayer: 'public_rendered',
    renderedRequired,
    blockedByChallenge: blockedPages.filter((page) => page.reasonCode === 'blocked_by_challenge').length,
    blockedByAuth: blockedPages.filter((page) => page.reasonCode === 'blocked_by_auth').length,
    rawDomSaved: false,
    rawHtmlSaved: false,
    rawContentSaved: false,
    cookiesSaved: false,
    tokensSaved: false,
    browserProfileSaved: false,
  };
  const evidenceBundles = [
    normalizeEvidenceBundle({
      providerId: 'public_rendered',
      status: publicRenderedPages.length ? 'success' : (renderedRequired ? 'blocked' : 'skipped'),
      authMethod: 'none',
      sourceLayer: 'public_rendered',
      pages: publicRenderedPages,
      warnings,
      reasonCodes: publicRenderedPages.length ? [] : ['dynamic-unsupported', ...uniqueSortedStrings(blockedPages.map((page) => page.reasonCode).filter(Boolean))],
      coverage: publicRenderedCoverageSummary,
    }),
  ];
  const evidenceCoverage = evidenceCoverageFromBundles(evidenceBundles);
  const payload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    status: publicRenderedPages.length ? 'success' : (renderedRequired ? 'blocked' : 'skipped'),
    reason: publicRenderedPages.length
      ? null
      : renderedRequired
        ? 'Public rendered structural evidence was required but no sanitized structure summary was collected.'
        : 'Public rendered crawl produced no additional sanitized structure summary.',
    publicRenderedPages,
    pages: publicRenderedPages,
    blockedPages,
    publicRenderedCoverageSummary,
    privacy: {
      rawDomSaved: false,
      rawHtmlSaved: false,
      rawContentSaved: false,
      privateContentSaved: false,
      cookiesSaved: false,
      tokensSaved: false,
      browserProfileSaved: false,
    },
    warnings,
    evidenceBundles,
    evidenceCoverage,
  };
  const crawlRenderedPath = await writeArtifactJson(context, 'crawl_rendered.json', payload);
  if (renderedRequired && !publicRenderedPages.length) {
    throw createBlockedStageError(
      'siteforge-rendered-evidence-unavailable',
      payload.reason,
      {
        warnings,
        artifactPaths: { crawlRendered: crawlRenderedPath },
        reasonCodes: ['dynamic-unsupported', ...uniqueSortedStrings(blockedPages.map((page) => page.reasonCode))],
        summary: publicRenderedCoverageSummary,
      },
    );
  }
  return {
    status: payload.status,
    reasonCode: publicRenderedPages.length ? null : 'dynamic-unsupported',
    reasonCodes: publicRenderedPages.length ? [] : ['dynamic-unsupported'],
    publicRenderedPages,
    pages: publicRenderedPages,
    blockedPages,
    evidenceBundles,
    evidenceCoverage,
    warnings,
    artifactPaths: { crawlRendered: crawlRenderedPath },
    summary: publicRenderedCoverageSummary,
  };
}

async function discoverInteractionsStage(context, stageResults) {
  const pages = pagesFromStageResults(stageResults);
  const interactions = /** @type {any[]} */ ([]);
  const totalLinkCount = pages.reduce((sum, page) => sum + (page.links?.length ?? 0), 0);
  const totalControlCount = pages.reduce((sum, page) => sum + (page.controls?.length ?? 0) + (page.forms?.length ?? 0), 0);
  markStageSubstepProgress(context, 'scanLinks', {
    message: '扫描页面链接和导航入口。',
    processedCount: 0,
    totalCount: pages.length,
    discoveredCount: totalLinkCount,
  });
  markStageSubstepProgress(context, 'scanControls', {
    message: '扫描按钮、表单和可操作控件。',
    processedCount: 0,
    totalCount: pages.length,
    discoveredCount: totalControlCount,
  });
  let scannedPages = 0;
  for (const page of pages) {
    for (const form of page.forms) {
      const safety = formSafety(form);
      interactions.push({
        id: stableNodeId('interaction:form', `${pageIdentity(page)}:${form.selector}`),
        pageUrl: page.normalizedUrl,
        kind: 'form',
        label: form.label,
        selector: form.selector,
        method: form.method,
        endpoint: form.action,
        safety,
        sourceLayer: pageSourceLayer(page),
        providerId: page.providerId ?? null,
        runtimeMode: page.runtimeMode ?? null,
        authRequired: page.authRequired === true,
        authVerificationStatus: page.authVerificationStatus ?? null,
        evidenceLevel: pageEvidenceLevel(page),
        riskLevel: safety === 'read_only' ? page.riskLevel ?? 'read_public_low' : 'write_low',
        evidence: [
          buildEvidence({
            type: 'form',
            source: page.sourcePath ?? page.normalizedUrl,
            selector: form.selector,
            endpoint: form.action,
            method: form.method,
            confidence: 0.9,
          }),
        ],
      });
    }
    for (const control of page.controls) {
      const role = String(control.attrs?.role ?? '').toLowerCase();
      const kind = role === 'tab'
        ? 'tab'
        : role === 'menuitem'
          ? 'menu'
          : control.kind;
      interactions.push({
        id: stableNodeId(`interaction:${kind}`, `${pageIdentity(page)}:${control.selector}`),
        pageUrl: page.normalizedUrl,
        kind,
        label: control.label,
        selector: control.selector,
        safety: ['tab', 'menu', 'button'].includes(kind) ? 'safe' : 'requires_input',
        sourceLayer: pageSourceLayer(page),
        providerId: page.providerId ?? null,
        runtimeMode: page.runtimeMode ?? null,
        authRequired: page.authRequired === true,
        authVerificationStatus: page.authVerificationStatus ?? null,
        evidenceLevel: pageEvidenceLevel(page),
        riskLevel: ['tab', 'menu', 'button'].includes(kind) ? page.riskLevel ?? 'read_public_low' : 'write_low',
        evidence: [
          buildEvidence({
            type: 'dom',
            source: page.sourcePath ?? page.normalizedUrl,
            selector: control.selector,
            text: control.label,
            confidence: 0.8,
          }),
        ],
      });
    }
    scannedPages += 1;
    markStageSubstepProgress(context, 'scanControls', {
      message: '扫描页面交互控件。',
      currentItem: page.normalizedUrl ?? page.url ?? null,
      processedCount: scannedPages,
      totalCount: pages.length,
      discoveredCount: interactions.length,
    });
  }
  markStageSubstepProgress(context, 'classifySafeActions', {
    message: '分类安全交互候选。',
    processedCount: interactions.length,
    totalCount: interactions.length,
    discoveredCount: interactions.filter((interaction) => ['safe', 'read_only'].includes(interaction.safety)).length,
    skippedCount: interactions.filter((interaction) => !['safe', 'read_only'].includes(interaction.safety)).length,
  });
  const payload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    interactions,
    summary: { interactions: interactions.length },
  };
  markStageSubstepProgress(context, 'writeDiagnostics', {
    message: '写入交互诊断产物。',
    processedCount: interactions.length,
    totalCount: interactions.length,
    discoveredCount: interactions.length,
    skippedCount: 0,
  });
  const interactionsPath = await writeArtifactJson(context, 'interactions.json', payload);
  return {
    interactions,
    artifactPaths: { interactions: interactionsPath },
    summary: payload.summary,
  };
}

function apiAdapterArtifactName(prefix, index) {
  return `${prefix}-${String(index + 1).padStart(4, '0')}.json`;
}

async function writeRedactedArtifactWithAudit(context, artifactRelativePath, auditRelativePath, payload) {
  const prepared = prepareRedactedArtifactJsonWithAudit(payload);
  const artifactPath = await writeArtifactText(context, artifactRelativePath, prepared.json);
  const redactionAuditPath = await writeArtifactText(context, auditRelativePath, prepared.auditJson);
  return {
    artifactPath,
    redactionAuditPath,
    value: prepared.value,
    audit: prepared.auditValue,
  };
}

function apiCandidateEndpointUrl(candidate = /** @type {any} */ ({})) {
  return String(candidate?.endpoint?.url ?? candidate?.url ?? '').trim();
}

function apiCandidateRuntime(candidate = /** @type {any} */ ({})) {
  return candidate?.runtime && typeof candidate.runtime === 'object' && !Array.isArray(candidate.runtime)
    ? candidate.runtime
    : {};
}

function safeApiReplayOperationName(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 80) {
    return '';
  }
  if (/^(?:\d+|[a-f0-9]{8,}|[A-Za-z0-9_-]{24,})$/u.test(text)) {
    return '';
  }
  if (/(?:auth|bearer|cookie|csrf|ct0|token|secret|session|password|key|signature)/iu.test(text)) {
    return '';
  }
  return text;
}

function apiReplayEndpointOperationRef({
  candidate = null,
  runtimeEndpoint = null,
  method = 'GET',
  apiSemantics = null,
} = /** @type {any} */ ({})) {
  const runtime = apiCandidateRuntime(candidate);
  let semanticKind = String(
    apiSemantics?.semanticKind
    ?? runtime?.semanticKind
    ?? candidate?.evidence?.semanticKind
    ?? 'api-read',
  ).trim() || 'api-read';
  let operationName = '';
  const operationEndpoint = apiCandidateEndpointUrl(candidate) || runtimeEndpoint;
  try {
    const parsed = new URL(String(operationEndpoint ?? ''));
    const graphqlMatch = parsed.pathname.match(/\/i\/api\/graphql\/[^/]+\/([^/?#]+)/iu);
    operationName = safeApiReplayOperationName(graphqlMatch?.[1]
      ?? parsed.pathname.split('/').filter(Boolean).at(-1)
      ?? '');
  } catch {
    operationName = '';
  }
  if (semanticKind === 'api-read') {
    if (operationName === 'hashflags.json') {
      semanticKind = 'read-hashflags';
    } else if (operationName === 'badge_count.json') {
      semanticKind = 'read-badge-count-summary';
    }
  }
  const operationSlug = slugifyAscii([semanticKind, operationName].filter(Boolean).join('-') || 'api-read') || 'api-read';
  const operationHash = stableNodeId('api-operation', [
    String(method ?? 'GET').toUpperCase(),
    semanticKind,
    operationName || 'operation',
    sanitizeEvidenceRef(runtimeEndpoint) ?? 'endpoint',
  ].join('\u0000')).split(':').pop();
  return `api-operation:${operationSlug}:${operationHash}`;
}

function apiCandidateMethod(candidate = /** @type {any} */ ({}), rawTrace = null) {
  return normalizeApiMethod(candidate?.endpoint?.method ?? candidate?.method ?? rawTrace?.request?.method);
}

function apiReplayRawEndpointUrl(candidate = /** @type {any} */ ({}), rawTrace = null) {
  return String(rawTrace?.request?.url ?? rawTrace?.response?.url ?? apiCandidateEndpointUrl(candidate) ?? '').trim();
}

function parseCandidateUrl(context, candidate = /** @type {any} */ ({}), rawTrace = null) {
  try {
    const urlValue = normalizeUrl(apiReplayRawEndpointUrl(candidate, rawTrace), context.site?.rootUrl);
    return new URL(urlValue);
  } catch {
    return null;
  }
}

function apiCandidateHasSensitiveReplayQuery(candidate = /** @type {any} */ ({}), rawTrace = null) {
  const candidateUrl = apiCandidateEndpointUrl(candidate);
  const rawUrl = rawTrace?.request?.url ?? rawTrace?.url ?? null;
  const riskText = [
    candidate?.target?.riskClass,
    candidate?.target?.endpointKind,
    candidate?.target?.roleHint,
    ...(candidate?.target?.queryKeys ?? []),
  ].join(' ');
  return hasSensitiveApiQueryMaterial(candidateUrl)
    || hasSensitiveApiQueryMaterial(rawUrl)
    || /request-protection|auth-session|risk-or-access-control|csrf|xsrf|token|secret|signature|session/iu.test(riskText);
}

function apiCandidateHasRequestBody(candidate = /** @type {any} */ ({}), rawTrace = null) {
  const candidateBody = candidate?.request?.body ?? candidate?.body;
  const rawBody = rawTrace?.request?.body ?? rawTrace?.request?.postData ?? rawTrace?.postData;
  return hasSubstantiveApiRequestBody(candidateBody)
    || hasSubstantiveApiRequestBody(rawBody)
    || rawTrace?.request?.hasPostData === true;
}

function apiCandidateLooksWriteLike(candidate = /** @type {any} */ ({}), rawTrace = null) {
  const endpointUrl = apiCandidateEndpointUrl(candidate) || rawTrace?.request?.url || '';
  const extraText = [
    candidate?.target?.endpointKind,
    candidate?.target?.roleHint,
    rawTrace?.request?.body,
  ].filter(Boolean).join(' ');
  return apiEndpointLooksWriteLike({
    url: endpointUrl,
    method: apiCandidateMethod(candidate, rawTrace),
    extraText,
  });
}

function rawTraceForApiCandidate(candidate = /** @type {any} */ ({}), rawTraces = []) {
  const candidateId = String(candidate?.id ?? '').trim();
  if (candidateId) {
    const byId = rawTraces.find((trace) => String(trace?.requestId ?? trace?.id ?? '').trim() === candidateId);
    if (byId) {
      return byId;
    }
  }
  const endpointUrl = apiCandidateEndpointUrl(candidate);
  const method = apiCandidateMethod(candidate);
  return rawTraces.find((trace) => {
    const traceMethod = String(trace?.request?.method ?? 'GET').trim().toUpperCase();
    const traceUrl = String(trace?.request?.url ?? trace?.response?.url ?? '').trim();
    if (traceMethod !== method || !traceUrl || !endpointUrl) {
      return false;
    }
    try {
      const left = new URL(traceUrl);
      const right = new URL(endpointUrl);
      return left.hostname === right.hostname && left.pathname === right.pathname;
    } catch {
      return traceUrl === endpointUrl;
    }
  }) ?? null;
}

const QIDIAN_PUBLIC_PAGE_CONTEXT_API_SEMANTICS = new Set([
  'read-book-catalog',
  'read-book-copyright-info',
  'read-chapter-recommended-books',
  'read-portal-advertising',
  'read-portal-game-records',
  'read-search-autocomplete',
  'read-site-system-time',
]);

const QIDIAN_PUBLIC_BROWSER_BRIDGE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function qidianPublicPageContextBridgeBlockReason(context, candidate = /** @type {any} */ ({})) {
  const runtime = apiCandidateRuntime(candidate);
  const parameterKind = String(runtime?.parameterSource?.kind ?? '').trim();
  if (parameterKind !== 'qidian_yuew_sign') {
    return 'runtime_parameter_source_not_qidian_yuew_sign';
  }
  const siteKey = String(candidate?.siteKey ?? context.siteAdapterProfile?.siteKey ?? '').trim().toLowerCase();
  if (!['qidian', 'www.qidian.com'].includes(siteKey)) {
    return 'site_not_qidian';
  }
  if (String(candidate?.source ?? '').trim() !== 'site-adapter.build-api-seed') {
    return 'not_site_adapter_build_api_seed';
  }
  const semanticKind = String(runtime?.semanticKind ?? candidate?.evidence?.semanticKind ?? '').trim();
  if (!QIDIAN_PUBLIC_PAGE_CONTEXT_API_SEMANTICS.has(semanticKind)) {
    return 'qidian_api_semantic_requires_account_or_review';
  }
  return null;
}

function canReplayQidianPublicPageContextApi(context, candidate = /** @type {any} */ ({})) {
  return qidianPublicPageContextBridgeBlockReason(context, candidate) === null;
}

function isBrowserBridgeReplayBoundary(value) {
  return ['browser_bridge', 'public_browser_bridge'].includes(String(value ?? '').trim());
}

function browserBridgeReplayCredentialsMode(value) {
  return String(value ?? '').trim() === 'public_browser_bridge' ? 'same-origin' : 'include';
}

function apiReplayAuthBoundary(context, candidate = /** @type {any} */ ({})) {
  const report = context.authStateReport ?? {};
  if (report.authMethod === 'browser' && canRunAuthenticatedLayer(report)) {
    return 'browser_bridge';
  }
  if (report.authMethod === 'cookie' && canRunAuthenticatedLayer(report)) {
    return 'cookie_replay_only';
  }
  if (
    context.options?.allowSetupBlockedApiDiscovery === true
    && report.authMethod === 'browser'
    && apiReplayCookieHeader(context)
  ) {
    return 'cookie_replay_only';
  }
  if (canReplayQidianPublicPageContextApi(context, candidate)) {
    return 'public_browser_bridge';
  }
  return 'none';
}

function canReplayRobotsDisallowedUserAuthorizedApi(
  context,
  candidate = /** @type {any} */ ({}),
  authBoundary = 'none',
) {
  const runtime = apiCandidateRuntime(candidate);
  const parameterKind = String(runtime?.parameterSource?.kind ?? '').trim();
  const semanticKind = String(runtime?.semanticKind ?? candidate?.evidence?.semanticKind ?? '').trim();
  const authorizedXRuntime = parameterKind === 'x_web_auth_headers'
    || (semanticKind === 'read-hashflags' && !parameterKind);
  return authBoundary === 'browser_bridge'
    && context.authStateReport?.authMethod === 'browser'
    && canRunAuthenticatedLayer(context.authStateReport)
    && String(candidate?.source ?? '').trim() === 'site-adapter.build-api-seed'
    && String(candidate?.siteKey ?? '').trim() === 'x'
    && authorizedXRuntime;
}

function apiReplayEligibility(context, candidate = /** @type {any} */ ({}), rawTrace = null, robotsPolicy = null) {
  const method = apiCandidateMethod(candidate, rawTrace);
  const parsed = parseCandidateUrl(context, candidate, rawTrace);
  const replayEndpoint = parsed ? parsed.toString() : null;
  const endpoint = replayEndpoint ? sanitizeEvidenceRef(replayEndpoint) : (apiCandidateEndpointUrl(candidate) || '');
  if (!isReadOnlyApiMethod(method)) {
    return { eligible: false, reasonCode: 'method_not_read_only', method, endpoint, authBoundary: 'none' };
  }
  if (apiCandidateHasRequestBody(candidate, rawTrace)) {
    return { eligible: false, reasonCode: 'request_body_present', method, endpoint, authBoundary: 'none' };
  }
  if (!parsed || !isSameSiteUrl(parsed.toString(), context.site.allowedDomains)) {
    return { eligible: false, reasonCode: 'cross_site_endpoint', method, endpoint, authBoundary: 'none' };
  }
  const authBoundary = apiReplayAuthBoundary(context, candidate);
  const qidianPublicPageContextBlockReason = qidianPublicPageContextBridgeBlockReason(context, candidate);
  const robotsAllowed = isUrlAllowedByRobots(parsed.toString(), robotsPolicy ?? setupProfileRobotsPolicy(context));
  const robotsUserAuthorizedBypass = !robotsAllowed
    && canReplayRobotsDisallowedUserAuthorizedApi(context, candidate, authBoundary);
  if (
    !robotsAllowed
    && !robotsUserAuthorizedBypass
  ) {
    return { eligible: false, reasonCode: 'robots_disallowed', method, endpoint, authBoundary: 'none' };
  }
  if (apiCandidateHasSensitiveReplayQuery(candidate, rawTrace)) {
    return { eligible: false, reasonCode: 'sensitive_query_material', method, endpoint, authBoundary: 'none' };
  }
  if (apiCandidateLooksWriteLike(candidate, rawTrace)) {
    return { eligible: false, reasonCode: 'write_like_endpoint', method, endpoint, authBoundary: 'none' };
  }
  const transport = String(candidate?.target?.transport ?? candidate?.transport ?? 'http').trim().toLowerCase();
  if (transport && transport !== 'http') {
    return { eligible: false, reasonCode: 'unsupported_transport', method, endpoint, authBoundary: 'none' };
  }
  if (authBoundary === 'none') {
    return {
      eligible: false,
      reasonCode: qidianPublicPageContextBlockReason && qidianPublicPageContextBlockReason !== 'runtime_parameter_source_not_qidian_yuew_sign'
        ? qidianPublicPageContextBlockReason
        : 'authenticated_browser_bridge_unavailable',
      method,
      endpoint,
      authBoundary,
    };
  }
  if (authBoundary === 'cookie_replay_only') {
    if (!apiReplayCookieHeader(context)) {
      return { eligible: false, reasonCode: 'cookie_replay_unavailable', method, endpoint, authBoundary };
    }
    return {
      eligible: true,
      reasonCode: null,
      method,
      endpoint,
      replayEndpoint,
      authBoundary,
      robotsUserAuthorizedBypass,
    };
  }
  if (authBoundary === 'public_browser_bridge') {
    return {
      eligible: true,
      reasonCode: null,
      method,
      endpoint,
      replayEndpoint,
      authBoundary,
      robotsUserAuthorizedBypass,
    };
  }
  if (authBoundary !== 'browser_bridge') {
    return { eligible: false, reasonCode: 'cookie_replay_not_registered_for_runtime', method, endpoint, authBoundary };
  }
  return {
    eligible: true,
    reasonCode: null,
    method,
    endpoint,
    replayEndpoint,
    authBoundary,
    robotsUserAuthorizedBypass,
  };
}

function replayResponseEvidenceMatches(rawResult = /** @type {any} */ ({}), responseEvidence = null) {
  if (!responseEvidence || typeof responseEvidence !== 'object') {
    return true;
  }
  const evidenceStatus = String(rawResult?.responseEvidenceStatus ?? '').trim().toLowerCase();
  if (['matched', 'verified', 'passed'].includes(evidenceStatus)) {
    return true;
  }
  if (['failed', 'mismatched', 'missing'].includes(evidenceStatus)) {
    return false;
  }
  const bodyText = String(rawResult?.bodyText ?? rawResult?.text ?? '').trim();
  if (!bodyText) {
    return false;
  }
  let json = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return false;
  }
  if (Object.hasOwn(responseEvidence, 'statusCode')) {
    const actual = Number(json?.status_code ?? json?.statusCode ?? json?.code);
    const expected = Number(responseEvidence.statusCode);
    if (!Number.isFinite(actual) || actual !== expected) {
      return false;
    }
  }
  const arrayField = String(responseEvidence.arrayField ?? '').trim();
  if (arrayField && !Array.isArray(json?.[arrayField])) {
    return false;
  }
  const objectField = String(responseEvidence.objectField ?? '').trim();
  if (objectField && (!json?.[objectField] || typeof json[objectField] !== 'object' || Array.isArray(json[objectField]))) {
    return false;
  }
  return true;
}

function summarizeApiReplayResult(rawResult = /** @type {any} */ ({}), responseEvidence = null) {
  const statusText = String(rawResult?.status ?? rawResult?.result ?? '').trim().toLowerCase();
  const httpStatus = Number(rawResult?.httpStatus ?? rawResult?.statusCode ?? rawResult?.response?.status ?? 0) || null;
  const contentType = String(rawResult?.contentType ?? rawResult?.response?.contentType ?? rawResult?.headers?.['content-type'] ?? '').trim();
  const probeText = [
    rawResult?.responseKind,
    rawResult?.statusText,
    rawResult?.reason,
    rawResult?.reasonCode,
    rawResult?.bodyText,
    rawResult?.text,
  ].filter(Boolean).join(' ');
  const challengeLike = API_READ_ONLY_CHALLENGE_PATTERN.test(probeText)
    || [401, 403, 407, 419, 429].includes(Number(httpStatus));
  const httpOk = httpStatus === null || (httpStatus >= 200 && httpStatus < 300) || httpStatus === 304;
  const evidenceOk = replayResponseEvidenceMatches(rawResult, responseEvidence);
  const skipped = statusText === 'skipped';
  const verified = !challengeLike && httpOk && evidenceOk && ['verified', 'success', 'passed'].includes(statusText || 'verified');
  const explicitFailureReason = String(rawResult?.reasonCode ?? '').trim() || null;
  return {
    status: verified ? 'verified' : (skipped ? 'skipped' : 'failed'),
    reasonCode: challengeLike
      ? 'challenge_or_login_wall_response'
      : skipped
        ? (rawResult?.reasonCode ?? null)
        : !evidenceOk
        ? (explicitFailureReason ?? 'api_replay_response_evidence_failed')
        : (explicitFailureReason ?? (httpOk ? null : 'api_replay_http_failed')),
    httpStatus,
    contentType: contentType || null,
    responseKind: String(rawResult?.responseKind ?? rawResult?.kind ?? '').trim() || null,
  };
}

function apiReplayCookieHeader(context = /** @type {any} */ ({})) {
  const cookie = String(context.apiReplayCookieHeader ?? '').trim();
  return cookie || null;
}

function browserBridgeRuntimeExtensionStages(context = /** @type {any} */ ({})) {
  const bridge = context.authStateReport?.browserBridge ?? {};
  const extensionStages = Array.isArray(bridge.extensionStages)
    ? bridge.extensionStages
    : [];
  const timelineStages = Array.isArray(bridge.extensionStageTimeline)
    ? bridge.extensionStageTimeline.map((entry) => entry?.stage)
    : [];
  return uniqueSortedStrings([
    ...extensionStages,
    ...timelineStages,
  ]);
}

function browserBridgeRuntimeVersionEvidence(context = /** @type {any} */ ({})) {
  const stages = browserBridgeRuntimeExtensionStages(context);
  const observedBridgeVersions = [];
  const observedContentVersions = [];
  const observedCollectorVersions = [];
  for (const stage of stages) {
    const value = String(stage ?? '').trim();
    const bridgeMatch = /^bridge-version:(.+)$/u.exec(value);
    if (bridgeMatch?.[1]) {
      observedBridgeVersions.push(bridgeMatch[1]);
      continue;
    }
    const contentMatch = /^bridge-content-version:(.+)$/u.exec(value);
    if (contentMatch?.[1]) {
      observedContentVersions.push(contentMatch[1]);
      continue;
    }
    const collectorMatch = /^collector-version:(?:[^:]+:)?(.+)$/u.exec(value);
    if (collectorMatch?.[1]) {
      observedCollectorVersions.push(collectorMatch[1]);
    }
  }
  const bridgeVersions = uniqueSortedStrings(observedBridgeVersions);
  const contentVersions = uniqueSortedStrings(observedContentVersions);
  const collectorVersions = uniqueSortedStrings(observedCollectorVersions);
  const expectedObserved = bridgeVersions.includes(EXPECTED_BROWSER_BRIDGE_EXTENSION_VERSION)
    && contentVersions.includes(EXPECTED_BROWSER_BRIDGE_EXTENSION_VERSION)
    && collectorVersions.includes(EXPECTED_BROWSER_BRIDGE_EXTENSION_VERSION);
  return {
    expectedBrowserBridgeExtensionVersion: EXPECTED_BROWSER_BRIDGE_EXTENSION_VERSION,
    observedBridgeVersions: bridgeVersions,
    observedContentVersions: contentVersions,
    observedCollectorVersions: collectorVersions,
    observedStageCount: stages.length,
    versionStatus: stages.length
      ? (expectedObserved ? 'expected_observed' : 'stale_or_incompatible_observed')
      : 'not_observed',
  };
}

function apiReplayRuntimeRemediation(context = /** @type {any} */ ({}), {
  candidate = null,
  eligibility = /** @type {any} */ ({}),
  runtimeResolution = /** @type {any} */ ({}),
  reasonCode = null,
} = /** @type {any} */ ({})) {
  const reason = String(reasonCode ?? '').trim();
  const runtimeParameterSource = runtimeResolution.runtimeParameterSource ?? null;
  const sourceKind = String(runtimeParameterSource?.kind ?? '').trim();
  if (
    reason !== 'runtime_parameter_source_unsupported'
    || sourceKind !== 'x_web_auth_headers'
    || String(candidate?.siteKey ?? '').trim() !== 'x'
  ) {
    return null;
  }
  const cookieFallbackAvailable = canUseCookieApiReplayFallback(context, eligibility, runtimeParameterSource);
  return {
    status: 'blocked',
    reasonCode: reason,
    runtimeParameterSourceKind: sourceKind,
    ...browserBridgeRuntimeVersionEvidence(context),
    fallback: {
      authMaterialFallbackSupported: true,
      authMaterialFallbackConfigured: Boolean(apiReplayCookieHeader(context)),
      authMaterialFallbackAvailable: cookieFallbackAvailable,
      rawMaterialPersisted: false,
      savedCookieMaterial: false,
      savedStorageMaterial: false,
      rawResponseBodyPersisted: false,
    },
    requiredAction: cookieFallbackAvailable
      ? 'retry_with_governed_auth_material_fallback'
      : 'reload_browser_bridge_extension_or_configure_governed_auth_material_fallback',
  };
}

function canUseCookieApiReplayFallback(
  context = /** @type {any} */ ({}),
  eligibility = /** @type {any} */ ({}),
  runtimeParameterSource = null,
) {
  const sourceKind = String(runtimeParameterSource?.kind ?? '').trim();
  if (sourceKind && !['douyin_self_user_render_data', 'x_web_auth_headers'].includes(sourceKind)) {
    return false;
  }
  return eligibility.authBoundary === 'browser_bridge'
    && canRunAuthenticatedLayer(context.authStateReport)
    && Boolean(apiReplayCookieHeader(context));
}

function shouldRetryCookieApiReplayFallback(
  context = /** @type {any} */ ({}),
  eligibility = /** @type {any} */ ({}),
  runtimeParameterSource = null,
  reasonCode = null,
) {
  const reason = String(reasonCode ?? '').trim();
  const sourceKind = String(runtimeParameterSource?.kind ?? '').trim();
  return canUseCookieApiReplayFallback(context, eligibility, runtimeParameterSource)
    && (
      /^browser_bridge_replay_/u.test(reason)
      || (sourceKind === 'x_web_auth_headers' && reason === 'runtime_parameter_source_unsupported')
    );
}

function cookieHeaderValue(cookieHeader = '', name = '') {
  const wanted = String(name ?? '').trim();
  if (!wanted) {
    return '';
  }
  return String(cookieHeader ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${wanted}=`))
    ?.slice(wanted.length + 1)
    .trim() || '';
}

function apiReplayOptionsForRuntimeResolution(context = /** @type {any} */ ({}), runtimeResolution = /** @type {any} */ ({})) {
  if (!runtimeResolution.runtimeParameterSource) {
    const cookie = apiReplayCookieHeader(context);
    return cookie
      ? { ...context.options, apiReplayCookieHeader: cookie }
      : context.options;
  }
  const configured = Number(context.options?.browserBridgeApiReplayTimeoutMs);
  const cookie = apiReplayCookieHeader(context);
  const parameterKind = String(runtimeResolution.runtimeParameterSource?.kind ?? '').trim();
  const configuredTimeoutMs = Number.isFinite(configured) && configured > 0 ? configured : null;
  const runtimeTimeoutMs = parameterKind === 'qidian_yuew_sign'
    ? Math.max(configuredTimeoutMs ?? 0, 75_000)
    : Math.min(Math.max(configuredTimeoutMs ?? 0, 30_000), 45_000);
  const options = {
    ...context.options,
    browserBridgeApiReplayTimeoutMs: runtimeTimeoutMs,
  };
  if (parameterKind === 'qidian_yuew_sign' && !options.browserBridgeUserAgent && !options.userAgent) {
    options.browserBridgeUserAgent = QIDIAN_PUBLIC_BROWSER_BRIDGE_USER_AGENT;
  }
  if (cookie) {
    options.apiReplayCookieHeader = cookie;
  }
  if (context.options?.browserBridgeApiReplayManaged === true) {
    options.browserBridgeManaged = true;
  }
  return options;
}

function maxBrowserBridgeApiReplayCalls(context = /** @type {any} */ ({})) {
  const configured = Number(context.options?.maxBrowserBridgeApiReplayCalls);
  if (Number.isFinite(configured) && configured >= 0) {
    return Math.trunc(configured);
  }
  try {
    const host = new URL(context.site?.rootUrl ?? '').hostname;
    if (/(^|\.)douyin\.com$/iu.test(host)) {
      return 2;
    }
  } catch {
    // Use the unrestricted default for non-URL test fixtures.
  }
  return Number.POSITIVE_INFINITY;
}

function consumeBrowserBridgeApiReplayBudget(context = /** @type {any} */ ({})) {
  const maxCalls = maxBrowserBridgeApiReplayCalls(context);
  const used = Number(context.browserBridgeApiReplayCallCount ?? 0) || 0;
  if (used >= maxCalls) {
    return false;
  }
  context.browserBridgeApiReplayCallCount = used + 1;
  return true;
}

function apiReplayResponseKind(contentType) {
  const value = String(contentType ?? '').trim();
  if (/json/iu.test(value)) return 'json';
  if (/html/iu.test(value)) return 'html';
  if (/text\//iu.test(value)) return 'text';
  return value ? 'other' : null;
}

function bodyLooksJson(text) {
  const value = String(text ?? '').trim();
  if (!value || !/^[{[]/u.test(value)) {
    return false;
  }
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function parseDouyinRenderDataFromHtml(html) {
  const match = String(html ?? '').match(/<script[^>]+id=["']RENDER_DATA["'][^>]*>([\s\S]*?)<\/script>/iu);
  if (!match?.[1]) {
    return null;
  }
  const encoded = String(match[1]);
  const decodeAttempts = [
    encoded,
    (() => {
      try {
        return decodeURIComponent(encoded);
      } catch {
        return null;
      }
    })(),
    encoded.replace(/%([0-9a-f]{2})/giu, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16))),
  ];
  for (const attempt of decodeAttempts) {
    if (!attempt) {
      continue;
    }
    try {
      return JSON.parse(attempt);
    } catch {
      // Try the next decoding strategy; Douyin can include malformed UTF-8 in otherwise parseable JSON.
    }
  }
  return null;
}

async function resolveDouyinSelfRuntimeParameters(context, parameterSource = /** @type {any} */ ({})) {
  const cookie = apiReplayCookieHeader(context);
  if (!cookie) {
    return { status: 'skipped', reasonCode: 'cookie_replay_unavailable', parameters: null };
  }
  const pageUrl = normalizeUrl(parameterSource.pageUrl ?? '/user/self', context.site.rootUrl);
  const controller = new AbortController();
  const configuredTimeout = Number(context.options?.browserBridgeApiReplayTimeoutMs);
  const timeoutMs = Math.max(1000, Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 8000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(pageUrl, {
      method: 'GET',
      headers: {
        cookie,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        referer: context.site.rootUrl,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
      },
      signal: controller.signal,
    });
    const html = await response.text();
    const renderData = parseDouyinRenderDataFromHtml(html);
    const userInfo = renderData?.app?.user?.info ?? null;
    const uid = String(userInfo?.uid ?? '').trim();
    const secUid = String(userInfo?.secUid ?? userInfo?.sec_uid ?? '').trim();
    if (!uid || !secUid) {
      return { status: 'skipped', reasonCode: 'runtime_parameter_source_unavailable', parameters: null };
    }
    return {
      status: 'verified',
      reasonCode: null,
      parameters: {
        uid,
        secUid,
      },
    };
  } catch (error) {
    return {
      status: 'failed',
      reasonCode: error?.name === 'AbortError' ? 'api_replay_timeout' : 'runtime_parameter_source_unavailable',
      parameters: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function applyDouyinSelfRuntimeParameters(endpointTemplate, parameters = /** @type {any} */ ({})) {
  const uid = encodeURIComponent(String(parameters.uid ?? ''));
  const secUid = encodeURIComponent(String(parameters.secUid ?? ''));
  return String(endpointTemplate ?? '')
    .replace(/\{self\.uid\}/gu, uid)
    .replace(/\{self\.secUid\}/gu, secUid)
    .replace(/\{self\.sec_uid\}/gu, secUid);
}

function qidianApiReplayRuntimePageUrl(context = /** @type {any} */ ({})) {
  const routeResults = Array.isArray(context.authStateReport?.browserBridge?.routeResults)
    ? context.authStateReport.browserBridge.routeResults
    : [];
  const priority = new Map([
    ['/soushu/', 0],
    ['/rank/', 1],
    ['/free/', 2],
  ]);
  const candidates = routeResults
    .filter((result) => result?.sourceLayer === 'authenticated_overlay' && browserBridgeRouteCaptured(result))
    .map((result) => {
      const route = String(result.targetRoute ?? result.routeTemplate ?? '').trim();
      const routeWithSlash = route && route !== '/' && !route.endsWith('/') ? `${route}/` : route;
      return {
        result,
        route: routeWithSlash,
        priority: priority.get(routeWithSlash) ?? 100,
      };
    })
    .sort((left, right) => left.priority - right.priority || String(left.route).localeCompare(String(right.route), 'en'));
  for (const candidate of candidates) {
    try {
      const pageUrl = normalizeUrl(
        candidate.result.targetUrl
          ?? candidate.result.normalizedUrl
          ?? candidate.result.url
          ?? candidate.route
          ?? context.site.rootUrl,
        context.site.rootUrl,
      );
      if (isInternalUrl(pageUrl, context.site.allowedDomains)) {
        return pageUrl;
      }
    } catch {
      // Try the next captured overlay route.
    }
  }
  return null;
}

function qidianRuntimeParameterSource(context, parameterSource = /** @type {any} */ ({})) {
  if (parameterSource?.pageUrl) {
    return parameterSource;
  }
  const pageUrl = qidianApiReplayRuntimePageUrl(context);
  return pageUrl
    ? { ...parameterSource, pageUrl }
    : parameterSource;
}

async function resolveApiReplayEndpointForCandidate(context, candidate, eligibility) {
  const runtime = apiCandidateRuntime(candidate);
  const parameterSource = runtime.parameterSource ?? null;
  const endpointTemplate = String(runtime.endpointTemplate ?? '').trim();
  if (!parameterSource || !endpointTemplate) {
    return {
      status: 'ready',
      reasonCode: null,
      replayEndpoint: eligibility.replayEndpoint ?? eligibility.endpoint,
      runtimeEndpoint: eligibility.replayEndpoint ?? eligibility.endpoint,
      runtimeParameterSource: null,
      buildTimeAuthBoundary: eligibility.authBoundary,
    };
  }
  if (parameterSource.kind === 'qidian_yuew_sign') {
    const runtimeParameterSource = qidianRuntimeParameterSource(context, parameterSource);
    return {
      status: 'ready',
      reasonCode: null,
      replayEndpoint: endpointTemplate,
      runtimeEndpoint: sanitizeEvidenceRef(endpointTemplate),
      bridgeRuntimeEndpoint: endpointTemplate,
      runtimeParameterSource,
      buildTimeAuthBoundary: eligibility.authBoundary,
    };
  }
  if (parameterSource.kind === 'x_web_auth_headers') {
    return {
      status: 'ready',
      reasonCode: null,
      replayEndpoint: endpointTemplate,
      runtimeEndpoint: sanitizeEvidenceRef(endpointTemplate),
      bridgeRuntimeEndpoint: endpointTemplate,
      runtimeParameterSource: parameterSource,
      buildTimeAuthBoundary: eligibility.authBoundary,
    };
  }
  if (parameterSource.kind !== 'douyin_self_user_render_data') {
    return {
      status: 'skipped',
      reasonCode: 'runtime_parameter_source_unsupported',
      replayEndpoint: null,
      runtimeEndpoint: sanitizeEvidenceRef(endpointTemplate),
      runtimeParameterSource: parameterSource,
      buildTimeAuthBoundary: eligibility.authBoundary,
    };
  }
  return {
    status: 'ready',
    reasonCode: null,
    replayEndpoint: endpointTemplate,
    runtimeEndpoint: sanitizeEvidenceRef(endpointTemplate),
    runtimeParameterSource: parameterSource,
    buildTimeAuthBoundary: eligibility.authBoundary,
  };
}

async function resolveCookieReplayEndpointForCandidate(context, candidate, eligibility) {
  const runtime = apiCandidateRuntime(candidate);
  const parameterSource = runtime.parameterSource ?? null;
  const endpointTemplate = String(runtime.endpointTemplate ?? '').trim();
  if (!parameterSource || !endpointTemplate) {
    return {
      status: 'ready',
      reasonCode: null,
      replayEndpoint: eligibility.replayEndpoint ?? eligibility.endpoint,
    };
  }
  if (parameterSource.kind === 'x_web_auth_headers') {
    return {
      status: 'ready',
      reasonCode: null,
      replayEndpoint: endpointTemplate,
    };
  }
  if (parameterSource.kind !== 'douyin_self_user_render_data') {
    return {
      status: 'skipped',
      reasonCode: 'runtime_parameter_source_unsupported',
      replayEndpoint: null,
    };
  }
  const resolved = await resolveDouyinSelfRuntimeParameters(context, parameterSource);
  if (!resolved.parameters) {
    return {
      status: resolved.status,
      reasonCode: resolved.reasonCode,
      replayEndpoint: null,
    };
  }
  return {
    status: 'ready',
    reasonCode: null,
    replayEndpoint: applyDouyinSelfRuntimeParameters(endpointTemplate, resolved.parameters),
  };
}

async function runCookieApiReplayFallback(context, {
  endpoint,
  method,
  responseEvidence = null,
  runtimeParameterSource = null,
} = /** @type {any} */ ({})) {
  const cookie = apiReplayCookieHeader(context);
  if (!cookie) {
    return {
      status: 'skipped',
      reasonCode: 'cookie_replay_unavailable',
      httpStatus: null,
      contentType: null,
      responseKind: null,
      authBoundary: 'cookie_replay_only',
    };
  }
  const sourceKind = String(runtimeParameterSource?.kind ?? '').trim();
  const headers = {
    cookie,
    accept: 'application/json, text/plain;q=0.8, */*;q=0.1',
  };
  if (sourceKind === 'x_web_auth_headers') {
    const csrfCookieName = String(runtimeParameterSource?.csrfCookieName ?? 'ct0').trim() || 'ct0';
    const csrf = cookieHeaderValue(cookie, csrfCookieName);
    if (!csrf) {
      return {
        status: 'skipped',
        reasonCode: 'x_csrf_unavailable',
        httpStatus: null,
        contentType: null,
        responseKind: null,
        authBoundary: 'cookie_replay_only',
      };
    }
    headers.accept = 'application/json, text/plain, */*';
    headers['x-csrf-token'] = csrf;
    headers['x-twitter-active-user'] = 'yes';
    headers['x-twitter-auth-type'] = 'OAuth2Session';
    headers['x-twitter-client-language'] = 'en';
  }
  const controller = new AbortController();
  const configuredTimeout = Number(context.options?.browserBridgeApiReplayTimeoutMs);
  const timeoutMs = Math.max(1000, Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 8000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method,
      redirect: 'manual',
      headers,
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    const bodyText = method === 'HEAD'
      ? ''
      : await response.text().then((text) => text.slice(0, 600)).catch(() => '');
    const responseKind = bodyLooksJson(bodyText) ? 'json' : apiReplayResponseKind(contentType);
    const redirect = response.status >= 300 && response.status < 400;
    const verified = response.ok && responseKind === 'json';
    return summarizeApiReplayResult({
      status: verified ? 'verified' : 'failed',
      reasonCode: redirect
        ? 'cross_site_redirect'
        : verified
          ? null
          : response.ok
            ? 'api_replay_non_json_response'
            : 'api_replay_http_failed',
      httpStatus: response.status,
      contentType,
      responseKind,
      bodyText,
      authBoundary: 'cookie_replay_only',
    }, responseEvidence);
  } catch (error) {
    return {
      status: 'failed',
      reasonCode: error?.name === 'AbortError' ? 'api_replay_timeout' : 'api_replay_http_failed',
      httpStatus: null,
      contentType: null,
      responseKind: null,
      authBoundary: 'cookie_replay_only',
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveApiAdapterForCandidate(context, candidate) {
  if (typeof context.options.apiAdapterResolver === 'function') {
    return await context.options.apiAdapterResolver({
      context,
      candidate,
      site: context.site,
      profile: context.siteAdapterProfile,
    });
  }
  const endpointUrl = apiCandidateEndpointUrl(candidate);
  let host = candidate?.siteKey ?? context.site?.id;
  try {
    host = new URL(endpointUrl).hostname;
  } catch {
    // Keep the site key fallback.
  }
  return resolveSiteAdapter({
    host,
    inputUrl: endpointUrl || context.site.rootUrl,
    siteContext: context.site,
    profile: context.siteAdapterProfile,
  });
}

async function validateApiAdapterCandidate(context, candidateResult, index) {
  const candidate = candidateResult?.candidate ?? null;
  const artifactName = apiAdapterArtifactName('decision', index);
  const decisionRelativePath = path.join('discovery', 'api-adapter-decisions', artifactName);
  const auditRelativePath = path.join(
    'discovery',
    'api-adapter-decision-redaction-audits',
    artifactName.replace(/\.json$/u, '.redaction-audit.json'),
  );
  let adapter = null;
  let siteAdapterDecision = null;
  let catalogUpgradePolicy = null;
  let apiSemantics = null;
  let status = 'skipped';
  let reasonCode = 'site_adapter_validation_unavailable';
  try {
    adapter = await resolveApiAdapterForCandidate(context, candidate);
    if (typeof adapter?.validateApiCandidate !== 'function') {
      reasonCode = 'site_adapter_validation_unavailable';
    } else {
      if (typeof adapter.describeApiCandidateSemantics === 'function') {
        try {
          apiSemantics = adapter.describeApiCandidateSemantics({
            candidate,
            context,
            site: context.site,
            profile: context.siteAdapterProfile,
          }) ?? null;
        } catch {
          apiSemantics = null;
        }
      }
      siteAdapterDecision = validateApiCandidateWithAdapter(candidate, adapter, {
        validatedAt: context.startedAt,
        scope: {
          validationMode: 'siteforge-build-api-adapter-replay',
          candidateArtifact: relativeReportPath(context.cwd, candidateResult?.artifactPath),
        },
        evidence: {
          source: 'api-candidate-artifact',
          artifactPath: relativeReportPath(context.cwd, candidateResult?.artifactPath),
        },
      });
      status = siteAdapterDecision.decision === 'accepted' ? 'accepted' : 'rejected';
      reasonCode = siteAdapterDecision.reasonCode ?? null;
      if (typeof adapter.getApiCatalogUpgradePolicy === 'function') {
        try {
          catalogUpgradePolicy = adapter.getApiCatalogUpgradePolicy({
            candidate,
            siteAdapterDecision,
            decidedAt: context.startedAt,
            scope: {
              policyMode: 'siteforge-build-api-adapter-replay',
              candidateArtifact: relativeReportPath(context.cwd, candidateResult?.artifactPath),
              siteAdapterDecisionArtifact: decisionRelativePath,
            },
            evidence: {
              source: 'api-candidate-artifact',
              candidateArtifact: relativeReportPath(context.cwd, candidateResult?.artifactPath),
              siteAdapterDecisionArtifact: decisionRelativePath,
            },
          });
        } catch (error) {
          catalogUpgradePolicy = {
            status: 'failed',
            reasonCode: error?.reasonCode ?? error?.message ?? 'api_catalog_upgrade_policy_failed',
          };
        }
      }
    }
  } catch (error) {
    status = 'failed';
    reasonCode = error?.reasonCode ?? error?.message ?? 'site_adapter_validation_failed';
  }
  const payload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-api-adapter-decision',
    buildId: context.buildId,
    siteId: context.site.id,
    candidateId: candidate?.id ?? null,
    candidateRef: relativeReportPath(context.cwd, candidateResult?.artifactPath),
    status,
    reasonCode,
    adapterId: adapter?.id ?? siteAdapterDecision?.adapterId ?? null,
    adapterVersion: adapter?.version ?? siteAdapterDecision?.adapterVersion ?? null,
    siteAdapterDecision,
    catalogUpgradePolicy,
    apiSemantics,
  };
  const write = await writeRedactedArtifactWithAudit(context, decisionRelativePath, auditRelativePath, payload);
  return {
    index,
    candidate,
    status,
    reasonCode,
    adapterId: payload.adapterId,
    adapterVersion: payload.adapterVersion,
    decision: siteAdapterDecision,
    catalogUpgradePolicy,
    apiSemantics,
    artifactPath: write.artifactPath,
    redactionAuditPath: write.redactionAuditPath,
    value: write.value,
  };
}

async function replayApiAdapterCandidate(context, decisionRecord, rawTrace, robotsPolicy) {
  const { candidate, index } = decisionRecord;
  const artifactName = apiAdapterArtifactName('replay', index);
  const replayRelativePath = path.join('discovery', 'api-replay-verifications', artifactName);
  const auditRelativePath = path.join(
    'discovery',
    'api-replay-verification-redaction-audits',
    artifactName.replace(/\.json$/u, '.redaction-audit.json'),
  );
  const eligibility = apiReplayEligibility(context, candidate, rawTrace, robotsPolicy);
  let status = 'skipped';
  let reasonCode = eligibility.reasonCode;
  let replaySummary = {
    status,
    reasonCode,
    httpStatus: null,
    contentType: null,
    responseKind: null,
  };
  const runtime = apiCandidateRuntime(candidate);
  const responseEvidence = runtime.responseEvidence && typeof runtime.responseEvidence === 'object'
    ? runtime.responseEvidence
    : null;
  let runtimeResolution = {
    status: eligibility.eligible ? 'ready' : 'skipped',
    reasonCode: eligibility.reasonCode,
    replayEndpoint: eligibility.replayEndpoint ?? eligibility.endpoint,
    runtimeEndpoint: eligibility.replayEndpoint ?? eligibility.endpoint,
    runtimeParameterSource: null,
    buildTimeAuthBoundary: eligibility.authBoundary,
  };
  let buildTimeAuthBoundary = eligibility.authBoundary;
  if (decisionRecord.status !== 'accepted') {
    reasonCode = decisionRecord.reasonCode ?? 'adapter_rejected';
    replaySummary = {
      ...replaySummary,
      reasonCode,
    };
  } else if (eligibility.eligible) {
    runtimeResolution = await resolveApiReplayEndpointForCandidate(context, candidate, eligibility);
    buildTimeAuthBoundary = runtimeResolution.buildTimeAuthBoundary ?? eligibility.authBoundary;
    if (runtimeResolution.status !== 'ready' || !runtimeResolution.replayEndpoint) {
      status = runtimeResolution.status === 'failed' ? 'failed' : 'skipped';
      reasonCode = runtimeResolution.reasonCode ?? 'runtime_parameter_source_unavailable';
      replaySummary = {
        status,
        reasonCode,
        httpStatus: null,
        contentType: null,
        responseKind: null,
      };
    } else if (
      runtimeResolution.runtimeParameterSource
      && runtimeResolution.runtimeParameterSource.kind === 'douyin_self_user_render_data'
      && canUseCookieApiReplayFallback(context, eligibility, runtimeResolution.runtimeParameterSource)
    ) {
      const cookieEndpoint = await resolveCookieReplayEndpointForCandidate(context, candidate, eligibility);
      if (cookieEndpoint.status === 'ready' && cookieEndpoint.replayEndpoint) {
        runtimeResolution = {
          ...runtimeResolution,
          replayEndpoint: cookieEndpoint.replayEndpoint,
          bridgeRuntimeEndpoint: cookieEndpoint.replayEndpoint,
          bridgeRuntimeParameterSource: null,
          runtimeParameterResolutionBoundary: 'cookie_replay_only',
        };
      }
    }
    if (replaySummary.status === 'skipped' && replaySummary.reasonCode) {
      // Keep the earlier runtime-resolution skip.
    } else if (buildTimeAuthBoundary === 'cookie_replay_only') {
      const cookieEndpoint = await resolveCookieReplayEndpointForCandidate(context, candidate, eligibility);
      if (cookieEndpoint.status !== 'ready' || !cookieEndpoint.replayEndpoint) {
        replaySummary = {
          status: cookieEndpoint.status === 'failed' ? 'failed' : 'skipped',
          reasonCode: cookieEndpoint.reasonCode ?? 'runtime_parameter_source_unavailable',
          httpStatus: null,
          contentType: null,
          responseKind: null,
        };
      } else {
        replaySummary = await runCookieApiReplayFallback(context, {
          endpoint: cookieEndpoint.replayEndpoint,
          method: eligibility.method,
          responseEvidence,
          runtimeParameterSource: runtimeResolution.runtimeParameterSource,
        });
      }
      buildTimeAuthBoundary = 'cookie_replay_only';
      status = replaySummary.status;
      reasonCode = replaySummary.reasonCode;
    } else if (typeof context.options.apiAdapterReplayProvider === 'function') {
      try {
        const providerResult = await context.options.apiAdapterReplayProvider({
          context,
          site: context.site,
          candidate,
          decision: decisionRecord.decision,
          rawTrace,
          endpoint: runtimeResolution.replayEndpoint,
          redactedEndpoint: runtimeResolution.runtimeEndpoint ?? eligibility.endpoint,
          runtimeEndpoint: runtimeResolution.bridgeRuntimeEndpoint ?? runtimeResolution.runtimeEndpoint ?? eligibility.endpoint,
          runtimeParameterSource: runtimeResolution.bridgeRuntimeParameterSource === undefined
            ? runtimeResolution.runtimeParameterSource
            : runtimeResolution.bridgeRuntimeParameterSource,
          responseEvidence,
          method: eligibility.method,
          authBoundary: eligibility.authBoundary,
          fetchOptions: {
            credentials: isBrowserBridgeReplayBoundary(eligibility.authBoundary)
              ? browserBridgeReplayCredentialsMode(eligibility.authBoundary)
              : 'none',
            method: eligibility.method,
            body: null,
            persistCookies: false,
            persistStorage: false,
            persistResponseBody: false,
          },
        });
        replaySummary = summarizeApiReplayResult(providerResult, responseEvidence);
        status = replaySummary.status;
        reasonCode = replaySummary.reasonCode;
        if (shouldRetryCookieApiReplayFallback(context, eligibility, runtimeResolution.runtimeParameterSource, reasonCode)) {
          const cookieEndpoint = await resolveCookieReplayEndpointForCandidate(context, candidate, eligibility);
          if (cookieEndpoint.status !== 'ready' || !cookieEndpoint.replayEndpoint) {
            replaySummary = {
              status: cookieEndpoint.status === 'failed' ? 'failed' : 'skipped',
              reasonCode: cookieEndpoint.reasonCode ?? 'runtime_parameter_source_unavailable',
              httpStatus: null,
              contentType: null,
              responseKind: null,
            };
          } else {
            replaySummary = await runCookieApiReplayFallback(context, {
              endpoint: cookieEndpoint.replayEndpoint,
              method: eligibility.method,
              responseEvidence,
              runtimeParameterSource: runtimeResolution.runtimeParameterSource,
            });
          }
          buildTimeAuthBoundary = 'cookie_replay_only';
          status = replaySummary.status;
          reasonCode = replaySummary.reasonCode;
        }
      } catch (error) {
        status = 'failed';
        reasonCode = error?.reasonCode ?? error?.message ?? 'api_replay_failed';
        replaySummary = {
          status,
          reasonCode,
          httpStatus: null,
          contentType: null,
          responseKind: null,
        };
      }
    } else if (context.apiAdapterReplayBrowserBridgeUnavailableReason && !runtimeResolution.runtimeParameterSource) {
      if (canUseCookieApiReplayFallback(context, eligibility)) {
        const cookieEndpoint = await resolveCookieReplayEndpointForCandidate(context, candidate, eligibility);
        if (cookieEndpoint.status !== 'ready' || !cookieEndpoint.replayEndpoint) {
          replaySummary = {
            status: cookieEndpoint.status === 'failed' ? 'failed' : 'skipped',
            reasonCode: cookieEndpoint.reasonCode ?? 'runtime_parameter_source_unavailable',
            httpStatus: null,
            contentType: null,
            responseKind: null,
          };
        } else {
          replaySummary = await runCookieApiReplayFallback(context, {
            endpoint: cookieEndpoint.replayEndpoint,
            method: eligibility.method,
            responseEvidence,
            runtimeParameterSource: runtimeResolution.runtimeParameterSource,
          });
        }
        buildTimeAuthBoundary = 'cookie_replay_only';
        status = replaySummary.status;
        reasonCode = replaySummary.reasonCode;
      } else {
        status = 'skipped';
        reasonCode = context.apiAdapterReplayBrowserBridgeUnavailableReason;
        replaySummary = {
          status,
          reasonCode,
          httpStatus: null,
          contentType: null,
          responseKind: null,
        };
      }
    } else {
      if (!consumeBrowserBridgeApiReplayBudget(context)) {
        replaySummary = {
          status: 'skipped',
          reasonCode: 'api_replay_budget_deferred',
          httpStatus: null,
          contentType: null,
          responseKind: null,
        };
      } else {
        replaySummary = summarizeApiReplayResult(await runBrowserBridgeApiReplay({
          inputUrl: context.site.rootUrl,
          site: context.site,
          endpoint: runtimeResolution.replayEndpoint,
          method: eligibility.method,
          runtimeEndpoint: runtimeResolution.bridgeRuntimeEndpoint ?? runtimeResolution.runtimeEndpoint ?? eligibility.endpoint,
          runtimeParameterSource: runtimeResolution.bridgeRuntimeParameterSource === undefined
            ? runtimeResolution.runtimeParameterSource
            : runtimeResolution.bridgeRuntimeParameterSource,
          responseEvidence,
          authBoundary: eligibility.authBoundary,
          options: apiReplayOptionsForRuntimeResolution(context, runtimeResolution),
          robotsPolicy: eligibility.robotsUserAuthorizedBypass === true ? null : robotsPolicy,
          openBrowser: (targetUrl) => openSystemDefaultBrowser(targetUrl, context.options),
        }), responseEvidence);
      }
      status = replaySummary.status;
      reasonCode = replaySummary.reasonCode;
      if (
        /^browser_bridge_replay_/u.test(String(reasonCode ?? ''))
        || shouldRetryCookieApiReplayFallback(context, eligibility, runtimeResolution.runtimeParameterSource, reasonCode)
      ) {
        if (/^browser_bridge_replay_/u.test(String(reasonCode ?? ''))) {
          context.apiAdapterReplayBrowserBridgeUnavailableReason = reasonCode;
        }
        if (shouldRetryCookieApiReplayFallback(context, eligibility, runtimeResolution.runtimeParameterSource, reasonCode)) {
          const cookieEndpoint = await resolveCookieReplayEndpointForCandidate(context, candidate, eligibility);
          if (cookieEndpoint.status !== 'ready' || !cookieEndpoint.replayEndpoint) {
            replaySummary = {
              status: cookieEndpoint.status === 'failed' ? 'failed' : 'skipped',
              reasonCode: cookieEndpoint.reasonCode ?? 'runtime_parameter_source_unavailable',
              httpStatus: null,
              contentType: null,
              responseKind: null,
            };
          } else {
            replaySummary = await runCookieApiReplayFallback(context, {
              endpoint: cookieEndpoint.replayEndpoint,
              method: eligibility.method,
              responseEvidence,
              runtimeParameterSource: runtimeResolution.runtimeParameterSource,
            });
          }
          buildTimeAuthBoundary = 'cookie_replay_only';
          status = replaySummary.status;
          reasonCode = replaySummary.reasonCode;
        }
      }
    }
  }
  const activated = decisionRecord.status === 'accepted'
    && eligibility.eligible === true
    && replaySummary.status === 'verified'
    && isBrowserBridgeReplayBoundary(eligibility.authBoundary);
  const runtimeEndpoint = runtimeResolution.runtimeEndpoint ?? eligibility.replayEndpoint ?? eligibility.endpoint;
  const executableRuntimeEndpoint = runtimeResolution.bridgeRuntimeEndpoint ?? runtimeEndpoint;
  const runtimeBindingId = activated
    ? stableNodeId('api-adapter-runtime-binding', `${context.site.id}:${candidate?.id ?? index}:${executableRuntimeEndpoint}`)
    : null;
  const runtimeRemediation = apiReplayRuntimeRemediation(context, {
    candidate,
    eligibility,
    runtimeResolution,
    reasonCode: activated ? null : reasonCode,
  });
  const endpointPatternSource = runtimeResolution.bridgeRuntimeEndpoint ?? runtimeEndpoint;
  const endpointPattern = sanitizeEvidenceRef(endpointPatternSource);
  const endpointOperationRef = apiReplayEndpointOperationRef({
    candidate,
    runtimeEndpoint: endpointPatternSource,
    method: eligibility.method,
    apiSemantics: decisionRecord.apiSemantics ?? null,
  });
  const payload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-api-replay-verification',
    buildId: context.buildId,
    siteId: context.site.id,
    candidateId: candidate?.id ?? null,
    adapterDecisionRef: relativeReportPath(context.cwd, decisionRecord.artifactPath),
    status: activated ? 'verified' : replaySummary.status,
    reasonCode: activated ? null : reasonCode,
    activated,
    runtimeBindingId,
    method: eligibility.method,
    endpoint: endpointPattern,
    redactedEndpoint: endpointPattern,
    endpointPattern,
    endpointOperationRef,
    endpointExecutable: false,
    authBoundary: eligibility.authBoundary,
    replayPolicy: {
      buildTimeAuthBoundary,
      credentials: isBrowserBridgeReplayBoundary(eligibility.authBoundary)
        ? browserBridgeReplayCredentialsMode(eligibility.authBoundary)
        : 'none',
      requestBodyAllowed: false,
      savedCookieMaterial: false,
      savedStorageMaterial: false,
      rawResponseBodyPersisted: false,
      responseMaterial: SANITIZED_SUMMARY_ONLY,
      runtimeRegistration: activated ? 'browser_bridge_required' : 'not_registered',
      genericHttpRuntimeAllowed: false,
      robotsUserAuthorizedBypass: eligibility.robotsUserAuthorizedBypass === true,
      publicPageContextOnly: eligibility.authBoundary === 'public_browser_bridge',
      runtimeParameterSource: runtimeResolution.runtimeParameterSource,
      responseEvidence,
    },
    response: {
      httpStatus: replaySummary.httpStatus,
      contentType: replaySummary.contentType,
      responseKind: replaySummary.responseKind,
      challengeOrLoginWallBlocked: reasonCode === 'challenge_or_login_wall_response',
    },
    runtimeRemediation,
  };
  const write = await writeRedactedArtifactWithAudit(context, replayRelativePath, auditRelativePath, payload);
  return {
    index,
    candidate,
    status: payload.status,
    reasonCode: payload.reasonCode,
    activated,
    runtimeBindingId,
    runtimeEndpoint: activated ? executableRuntimeEndpoint : null,
    runtimeParameterSource: runtimeResolution.runtimeParameterSource,
    responseEvidence,
    apiSemantics: decisionRecord.apiSemantics ?? null,
    method: eligibility.method,
    endpoint: payload.endpointPattern,
    redactedEndpoint: payload.redactedEndpoint,
    endpointPattern: payload.endpointPattern,
    endpointOperationRef: payload.endpointOperationRef,
    authBoundary: eligibility.authBoundary,
    artifactPath: write.artifactPath,
    redactionAuditPath: write.redactionAuditPath,
    value: write.value,
  };
}

function countByReason(records = []) {
  const counts = {};
  for (const record of records) {
    const reasonCode = String(record?.reasonCode ?? '').trim();
    if (!reasonCode) {
      continue;
    }
    counts[reasonCode] = (counts[reasonCode] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right, 'en')));
}

async function writeApiAdapterRuntimeBindings(context, activatedAdapters = []) {
  const bindings = activatedAdapters
    .filter((adapter) => adapter?.runtimeBindingId && adapter?.runtimeEndpoint)
    .map((adapter) => ({
      id: adapter.runtimeBindingId,
      candidateId: adapter.candidateId ?? null,
      adapterId: adapter.adapterId ?? null,
      adapterVersion: adapter.adapterVersion ?? null,
      method: adapter.method,
      endpoint: adapter.runtimeEndpoint,
      redactedEndpoint: adapter.endpoint,
      runtimeParameterSource: adapter.runtimeParameterSource ?? null,
      responseEvidence: adapter.responseEvidence ?? null,
      authBoundary: adapter.authBoundary ?? 'browser_bridge',
      runtimeMode: BRIDGE_RUNTIME_MODE,
      responseMaterial: SANITIZED_SUMMARY_ONLY,
      requestPolicy: {
        credentials: browserBridgeReplayCredentialsMode(adapter.authBoundary ?? 'browser_bridge'),
        requestBodyAllowed: false,
        genericHttpRuntimeAllowed: false,
        persistCookies: false,
        persistStorage: false,
        persistResponseBody: false,
      },
      evidence: {
        candidateRef: adapter.candidateRef,
        adapterDecisionRef: adapter.adapterDecisionRef,
        replayVerificationRef: adapter.replayVerificationRef,
      },
    }));
  if (!bindings.length) {
    return null;
  }
  return await writeArtifactJson(context, path.join('runtime', 'api-adapter-bindings.internal.json'), {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-api-adapter-runtime-bindings',
    buildId: context.buildId,
    siteId: context.site.id,
    internalOnly: true,
    containsSensitiveMaterial: true,
    cookieMaterialPersisted: false,
    storageMaterialPersisted: false,
    rawResponseBodyPersisted: false,
    bindingCount: bindings.length,
    bindings,
  });
}

function apiCatalogPromotionEvidenceFor(context, candidateId) {
  const configured = context.options?.apiCatalogPromotionEvidence;
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
    return {};
  }
  const byCandidate = candidateId && configured[candidateId] && typeof configured[candidateId] === 'object'
    ? configured[candidateId]
    : null;
  const byDefault = configured.default && typeof configured.default === 'object'
    ? configured.default
    : null;
  return byCandidate ?? byDefault ?? configured;
}

function evaluateApiCatalogPromotionGate(context, decisionRecord, replayRecord) {
  const candidateId = decisionRecord?.candidate?.id ?? replayRecord?.candidate?.id ?? null;
  const promotionEvidence = apiCatalogPromotionEvidenceFor(context, candidateId);
  const schemaEvidenceRef = String(promotionEvidence.schemaEvidenceRef ?? promotionEvidence.schemaRef ?? '').trim() || null;
  const policyEvidenceRef = String(promotionEvidence.policyEvidenceRef ?? promotionEvidence.policyRef ?? '').trim() || null;
  const testEvidenceRefs = Array.isArray(promotionEvidence.testEvidenceRefs ?? promotionEvidence.testRefs)
    ? (promotionEvidence.testEvidenceRefs ?? promotionEvidence.testRefs).map((ref) => String(ref ?? '').trim()).filter(Boolean)
    : [];
  const explicitPromotionGate = context.options?.apiCatalogPromotion === true
    || promotionEvidence.explicitPromotionGate === true;
  const policyAllowsCatalogUpgrade = decisionRecord?.catalogUpgradePolicy?.allowCatalogUpgrade === true;
  const adapterAccepted = decisionRecord?.status === 'accepted';
  const replayVerified = replayRecord?.status === 'verified';
  const schemaEvidencePresent = Boolean(schemaEvidenceRef);
  const policyEvidencePresent = Boolean(policyEvidenceRef);
  const testEvidencePresent = testEvidenceRefs.length > 0;
  let reasonCode = null;
  if (!adapterAccepted) {
    reasonCode = decisionRecord?.reasonCode ?? 'site_adapter_validation_failed';
  } else if (!replayVerified) {
    reasonCode = replayRecord?.reasonCode ?? 'api_replay_not_verified';
  } else if (!policyAllowsCatalogUpgrade) {
    reasonCode = decisionRecord?.catalogUpgradePolicy?.reasonCode ?? 'api-catalog-entry-blocked';
  } else if (!explicitPromotionGate) {
    reasonCode = 'explicit_promotion_gate_required';
  } else if (!schemaEvidencePresent || !policyEvidencePresent || !testEvidencePresent) {
    reasonCode = 'api_catalog_promotion_evidence_missing';
  }
  const readyForCatalog = reasonCode === null;
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-api-catalog-promotion-gate',
    buildId: context.buildId,
    siteId: context.site.id,
    candidateId,
    status: readyForCatalog ? 'ready_for_catalog' : 'blocked',
    canEnterCatalog: readyForCatalog,
    reasonCode,
    observedApiAutoPromotionAllowed: false,
    catalogWriteStatus: 'not_written',
    requirements: {
      candidateStatus: replayVerified ? 'replay_verified' : (decisionRecord?.candidate?.status ?? 'observed'),
      adapterAccepted,
      replayVerified,
      policyAllowsCatalogUpgrade,
      explicitPromotionGate,
      schemaEvidencePresent,
      policyEvidencePresent,
      testEvidencePresent,
      redactionAuditRequired: true,
    },
    evidence: {
      candidateRef: decisionRecord?.value?.candidateRef ?? null,
      adapterDecisionRef: decisionRecord?.artifactPath ? relativeReportPath(context.cwd, decisionRecord.artifactPath) : null,
      replayVerificationRef: replayRecord?.artifactPath ? relativeReportPath(context.cwd, replayRecord.artifactPath) : null,
      schemaEvidenceRef,
      policyEvidenceRef,
      testEvidenceRefs,
    },
  };
}

async function writeApiCatalogPromotionGate(context, decisionRecord, replayRecord) {
  const artifactName = apiAdapterArtifactName('gate', decisionRecord?.index ?? replayRecord?.index ?? 0);
  const gateRelativePath = path.join('discovery', 'api-catalog-promotion-gates', artifactName);
  const auditRelativePath = path.join(
    'discovery',
    'api-catalog-promotion-gate-redaction-audits',
    artifactName.replace(/\.json$/u, '.redaction-audit.json'),
  );
  const payload = evaluateApiCatalogPromotionGate(context, decisionRecord, replayRecord);
  const write = await writeRedactedArtifactWithAudit(context, gateRelativePath, auditRelativePath, payload);
  return {
    index: decisionRecord?.index ?? replayRecord?.index ?? 0,
    status: write.value.status,
    reasonCode: write.value.reasonCode,
    canEnterCatalog: write.value.canEnterCatalog,
    artifactPath: write.artifactPath,
    redactionAuditPath: write.redactionAuditPath,
    value: write.value,
  };
}

async function mergeApiAdapterReplayIntoNetworkSummary(context, replaySummary) {
  const networkPath = path.join(context.artifactDir, 'network_traces.json');
  const networkPayload = await readJsonIfExists(networkPath, null);
  if (!networkPayload) {
    return null;
  }
  const adapterFields = {
    adapterValidationCount: replaySummary.adapterDecisionCount,
    adapterAcceptedCount: replaySummary.adapterAcceptedCount,
    replayVerifiedCount: replaySummary.replayVerifiedCount,
    activatedApiAdapterCount: replaySummary.activatedApiAdapterCount,
    adapterSkippedReasonCounts: replaySummary.skippedReasonCounts,
    adapterDecisionArtifacts: replaySummary.decisionArtifacts,
    replayVerificationArtifacts: replaySummary.replayVerificationArtifacts,
    catalogPromotionGateCount: replaySummary.catalogPromotionGateCount ?? 0,
    catalogPromotionReadyCount: replaySummary.catalogPromotionReadyCount ?? 0,
    catalogPromotionBlockedReasonCounts: replaySummary.catalogPromotionBlockedReasonCounts ?? {},
    catalogPromotionGateArtifacts: replaySummary.catalogPromotionGateArtifacts ?? [],
    runtimeBindingArtifact: replaySummary.runtimeBindingArtifact ?? null,
    rawTracesPersistedForReplay: replaySummary.rawTracesPersisted === true,
  };
  const updated = {
    ...networkPayload,
    apiAdapterReplay: adapterFields,
    sanitizedSummary: {
      ...(networkPayload.sanitizedSummary ?? {}),
      ...adapterFields,
    },
  };
  return await writeArtifactJson(context, 'network_traces.json', updated);
}

function apiDiscoveryRequestKey(request = /** @type {any} */ ({})) {
  const method = String(request?.method ?? request?.endpoint?.method ?? 'GET').trim().toUpperCase();
  const url = String(request?.url ?? request?.endpoint?.url ?? '').trim();
  return `${method} ${url}`;
}

function siteAdapterBuildApiDiscoveryRequests(context = /** @type {any} */ ({})) {
  let adapter = null;
  try {
    const rootUrl = context.site?.rootUrl ?? context.setupProfile?.site?.rootUrl;
    const host = rootUrl ? new URL(rootUrl).hostname : context.site?.allowedDomains?.[0];
    adapter = resolveSiteAdapter({
      host,
      inputUrl: rootUrl,
      siteContext: context.site,
      profile: context.siteAdapterProfile,
    });
  } catch {
    adapter = null;
  }
  if (typeof adapter?.getBuildApiDiscoverySeeds !== 'function') {
    return [];
  }
  const seeds = adapter.getBuildApiDiscoverySeeds({
    context,
    site: context.site,
    profile: context.siteAdapterProfile,
    setupProfile: context.setupProfile,
  });
  if (!Array.isArray(seeds)) {
    return [];
  }
  return seeds
    .filter((seed) => seed && typeof seed === 'object')
    .map((seed, index) => ({
      ...seed,
      id: seed.id ?? `site-adapter-api-seed-${index + 1}`,
      siteKey: seed.siteKey ?? context.site?.id,
      status: 'observed',
      source: seed.source ?? 'site-adapter.build-api-seed',
      observedAt: seed.observedAt ?? context.startedAt,
    }));
}

function mergeObservedApiRequests(...groups) {
  const seen = new Set();
  const merged = [];
  for (const request of groups.flat()) {
    const key = apiDiscoveryRequestKey(request);
    if (!key.trim() || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(request);
  }
  return merged;
}

async function captureNetworkTracesStage(context) {
  const networkRequested = context.policy.captureNetwork === true || context.options.network === true;
  const internalRawRequested = context.options.internalRawNetwork === true;
  const apiExtractionDisabledReason = context.options.apiExtractionDisabledReason ?? null;
  const sourceDiagnostics = context.setupProfile?.sourceDiagnostics ?? [];
  const internalCapture = context.internalRawNetworkCapture ?? {};
  const rawTraces = Array.isArray(internalCapture.rawTraces) ? internalCapture.rawTraces : [];
  const capturedObservedRequests = Array.isArray(internalCapture.observedRequests) ? internalCapture.observedRequests : [];
  const apiSeedRequests = networkRequested ? siteAdapterBuildApiDiscoveryRequests(context) : [];
  const observedRequests = mergeObservedApiRequests(apiSeedRequests, capturedObservedRequests);
  const observedResponseSummaries = Array.isArray(internalCapture.observedResponseSummaries)
    ? internalCapture.observedResponseSummaries
    : [];
  const apiCandidateFilterSummary = summarizeObservedRequestApiCandidateFiltering(observedRequests, {
    allowedDomains: context.site?.allowedDomains ?? [],
  });
  const rawTraceCount = rawTraces.length;
  const rawResponseBodyCount = rawTraces.filter((trace) => trace?.responseBody?.body !== null && trace?.responseBody?.body !== undefined).length;
  const rawTruncatedBodyCount = rawTraces.filter((trace) => trace?.responseBody?.truncated === true).length;
  const rawSkippedBodyCount = rawTraces.filter((trace) => String(trace?.responseBodyStatus ?? '').startsWith('skipped')).length;
  let rawNetworkPath = null;
  let apiCandidateArtifacts = /** @type {any[]} */ ([]);
  let apiCandidateSummary = {
    status: 'not_requested',
    count: 0,
    artifacts: [],
    redactionAuditArtifacts: [],
  };
  const warnings = /** @type {string[]} */ ([]);
  markStageSubstepProgress(context, 'checkCapturePolicy', {
    message: networkRequested ? '网络摘要采集已请求。' : '网络摘要未请求。',
    processedCount: networkRequested ? 1 : 0,
    totalCount: 1,
    discoveredCount: observedRequests.length,
    skippedCount: networkRequested ? 0 : 1,
  });

  markStageSubstepProgress(context, 'collectRequests', {
    message: '汇总已观察请求和 site-adapter API 种子。',
    processedCount: capturedObservedRequests.length,
    totalCount: observedRequests.length,
    discoveredCount: observedRequests.length,
    skippedCount: 0,
  });
  if (internalRawRequested) {
    warnings.push('Raw network capture was enabled for in-memory API replay only; raw trace artifacts were not persisted.');
  }

  markStageSubstepProgress(context, 'redactSensitiveHeaders', {
    message: '脱敏请求摘要并生成 API 候选。',
    processedCount: 0,
    totalCount: observedRequests.length,
    discoveredCount: 0,
    skippedCount: 0,
  });
  if (observedRequests.length) {
    try {
      apiCandidateArtifacts = await writeApiCandidateArtifactsFromObservedRequests(observedRequests, {
        outputDir: path.join(context.artifactDir, 'discovery', 'api-candidates'),
        redactionAuditDir: path.join(context.artifactDir, 'discovery', 'api-candidate-redaction-audits'),
        allowedDomains: context.site?.allowedDomains ?? [],
      });
      apiCandidateSummary = {
        status: apiCandidateArtifacts.length ? 'written' : 'empty',
        count: apiCandidateArtifacts.length,
        artifacts: apiCandidateArtifacts.map((artifact) => relativeReportPath(context.cwd, artifact.artifactPath)),
        redactionAuditArtifacts: apiCandidateArtifacts.map((artifact) => relativeReportPath(context.cwd, artifact.redactionAuditPath)),
      };
      markStageSubstepProgress(context, 'redactSensitiveHeaders', {
        message: 'API 候选脱敏完成。',
        processedCount: observedRequests.length,
        totalCount: observedRequests.length,
        discoveredCount: apiCandidateArtifacts.length,
        skippedCount: Math.max(0, observedRequests.length - apiCandidateArtifacts.length),
      });
    } catch (error) {
      apiCandidateSummary = {
        status: 'failed',
        count: 0,
        artifacts: [],
        redactionAuditArtifacts: [],
        reason: error?.reasonCode ?? error?.message ?? 'api_candidate_generation_failed',
      };
      warnings.push(`api-candidate-generation:${apiCandidateSummary.reason}`);
    }
  } else if (networkRequested) {
    apiCandidateSummary = {
      status: 'empty',
      count: 0,
      artifacts: [],
      redactionAuditArtifacts: [],
    };
  }

  const candidateArtifactsWritten = apiCandidateArtifacts.length > 0;
  const captureSucceeded = internalRawRequested || candidateArtifactsWritten;
  const reason = internalRawRequested
    ? 'Raw network capture was enabled for controlled in-memory replay; raw headers, bodies, cookies, and tokens were not persisted.'
    : candidateArtifactsWritten
      ? 'Network summary requested; site-adapter API seeds were materialized as redacted candidates without raw network persistence.'
      : apiExtractionDisabledReason
        ? `API extraction skipped because ${apiExtractionDisabledReason}.`
        : networkRequested
          ? 'Network summary requested; raw network traces were not captured or persisted.'
          : 'Network summary was not requested; raw network tracing is not part of the public build path.';
  if (candidateArtifactsWritten && !internalRawRequested) {
    warnings.push('Site-adapter API seeds were materialized as redacted candidates without raw network trace persistence.');
  }

  markStageSubstepProgress(context, 'summarizeOperations', {
    message: '汇总网络 API 发现结果。',
    processedCount: observedRequests.length,
    totalCount: observedRequests.length,
    discoveredCount: apiCandidateSummary.count,
    skippedCount: warnings.length,
  });
  const sanitizedSummary = {
    requested: networkRequested,
    internalRawNetworkEnabled: internalRawRequested,
    rawTracesPersisted: Boolean(rawNetworkPath),
    savedSummaryOnly: !rawNetworkPath,
    rawArtifactPresent: Boolean(rawNetworkPath),
    rawArtifactPath: rawNetworkPath ? relativeReportPath(context.cwd, rawNetworkPath) : null,
    rawTraceCount,
    rawResponseBodyCount,
    rawTruncatedBodyCount,
    rawSkippedBodyCount,
    observedRequestCount: observedRequests.length,
    observedNetworkRequestCount: capturedObservedRequests.length,
    siteAdapterApiSeedCount: apiSeedRequests.length,
    observedResponseSummaryCount: observedResponseSummaries.length,
    apiCandidateArtifacts: apiCandidateSummary.artifacts,
    apiCandidateCount: apiCandidateSummary.count,
    apiCandidateStatus: apiCandidateSummary.status,
    apiCandidateFilterSummary,
    apiExtractionDisabledReason,
    sourceDiagnosticCount: sourceDiagnostics.length,
    observedStatusCodes: uniqueSortedStrings(sourceDiagnostics.map((item) => item?.statusCode).filter(Boolean)),
    observedHosts: uniqueSortedStrings(sourceDiagnostics.map((item) => {
      try {
        return new URL(item?.sourcePath ?? '').hostname;
      } catch {
        return null;
      }
    }).filter(Boolean)),
  };
  const payload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    status: captureSucceeded ? 'success' : 'skipped',
    reason,
    traces: [],
    observedRequests: [],
    observedResponseSummaries: [],
    apiCandidateArtifacts: apiCandidateSummary.artifacts,
    apiCandidateRedactionAuditArtifacts: apiCandidateSummary.redactionAuditArtifacts,
    sanitizedSummary,
  };
  const networkPath = await writeArtifactJson(context, 'network_traces.json', payload);
  if (captureSucceeded) {
    return {
      status: 'success',
      warnings,
      artifactPaths: {
        networkTraces: networkPath,
        rawNetworkTraces: rawNetworkPath,
        apiCandidateArtifacts: apiCandidateSummary.artifacts,
      },
      apiCandidateResults: apiCandidateArtifacts,
      summary: {
        traces: 0,
        rawTraces: rawTraceCount,
        rawTracesPersisted: Boolean(rawNetworkPath),
        rawArtifactPath: rawNetworkPath ? relativeReportPath(context.cwd, rawNetworkPath) : null,
        rawResponseBodyCount,
        rawTruncatedBodyCount,
        apiCandidateCount: apiCandidateSummary.count,
        apiCandidateArtifacts: apiCandidateSummary.artifacts,
        sanitizedSummary,
      },
    };
  }
  return {
    status: 'skipped',
    reasonCode: 'dynamic-unsupported',
    reasonCodes: ['dynamic-unsupported'],
    warnings: [payload.reason],
    artifactPaths: { networkTraces: networkPath },
    summary: {
      traces: 0,
      sanitizedSummary,
    },
  };
}

async function apiAdapterReplayStage(context, stageResults) {
  const captureStage = stageResults.captureNetworkTraces ?? {};
  const candidateResults = Array.isArray(captureStage.apiCandidateResults)
    ? captureStage.apiCandidateResults
    : [];
  const rawTraces = Array.isArray(context.internalRawNetworkCapture?.rawTraces)
    ? context.internalRawNetworkCapture.rawTraces
    : [];
  const robotsPolicy = stageResults.discoverSeeds?.robotsPolicy ?? setupProfileRobotsPolicy(context);
  const warnings = /** @type {string[]} */ ([]);
  const decisions = /** @type {any[]} */ ([]);
  const replayVerifications = /** @type {any[]} */ ([]);
  const activatedAdapters = /** @type {any[]} */ ([]);
  markStageSubstepProgress(context, 'loadCandidates', {
    message: '加载 API adapter 候选。',
    processedCount: 0,
    totalCount: candidateResults.length,
    discoveredCount: candidateResults.length,
  });

  markStageSubstepProgress(context, 'applyReadonlyPolicy', {
    message: '应用只读 adapter 验证策略。',
    processedCount: 0,
    totalCount: candidateResults.length,
    discoveredCount: 0,
  });
  for (const [index, candidateResult] of candidateResults.entries()) {
    try {
      const decision = await validateApiAdapterCandidate(context, candidateResult, index);
      decisions.push(decision);
      const rawTrace = rawTraceForApiCandidate(decision.candidate, rawTraces);
      markStageSubstepProgress(context, 'replayRequests', {
        message: '回放符合条件的 API 请求。',
        currentItem: decision.candidate?.endpoint?.url ?? decision.candidate?.url ?? decision.candidate?.id ?? null,
        processedCount: replayVerifications.length,
        totalCount: candidateResults.length,
        discoveredCount: activatedAdapters.length,
        skippedCount: decisions.filter((item) => item.status !== 'accepted').length,
      });
      const replay = await replayApiAdapterCandidate(context, decision, rawTrace, robotsPolicy);
      replayVerifications.push(replay);
      if (replay.activated) {
        activatedAdapters.push({
          candidateId: decision.candidate?.id ?? null,
          siteKey: decision.candidate?.siteKey ?? context.site.id,
          adapterId: decision.adapterId,
          adapterVersion: decision.adapterVersion,
          runtimeBindingId: replay.runtimeBindingId,
          runtimeEndpoint: replay.runtimeEndpoint,
          runtimeParameterSource: replay.runtimeParameterSource ?? null,
          responseEvidence: replay.responseEvidence ?? null,
          apiSemantics: replay.apiSemantics ?? decision.apiSemantics ?? null,
          method: replay.method,
          endpoint: replay.endpoint,
          authBoundary: replay.authBoundary,
          candidateRef: relativeReportPath(context.cwd, candidateResult.artifactPath),
          adapterDecisionRef: relativeReportPath(context.cwd, decision.artifactPath),
          replayVerificationRef: relativeReportPath(context.cwd, replay.artifactPath),
          responsePolicy: SANITIZED_SUMMARY_ONLY,
        });
      }
    } catch (error) {
      warnings.push(`api-adapter-replay:${error?.reasonCode ?? error?.message ?? 'failed'}`);
    }
    markStageSubstepProgress(context, 'applyReadonlyPolicy', {
      message: 'API adapter 策略验证进行中。',
      processedCount: index + 1,
      totalCount: candidateResults.length,
      discoveredCount: decisions.filter((decision) => decision.status === 'accepted').length,
      skippedCount: warnings.length,
    });
  }

  const skippedRecords = [
    ...decisions.filter((decision) => decision.status !== 'accepted'),
    ...replayVerifications.filter((verification) => verification.status !== 'verified'),
  ];
  markStageSubstepProgress(context, 'validateBindings', {
    message: '验证 API runtime binding。',
    processedCount: replayVerifications.length,
    totalCount: candidateResults.length,
    discoveredCount: activatedAdapters.length,
    skippedCount: skippedRecords.length,
  });
  const runtimeBindingsPath = await writeApiAdapterRuntimeBindings(context, activatedAdapters);
  const promotionGates = [];
  for (const replay of replayVerifications) {
    const decision = decisions.find((candidate) => candidate.index === replay.index) ?? null;
    if (!decision) {
      continue;
    }
    promotionGates.push(await writeApiCatalogPromotionGate(context, decision, replay));
  }
  const summary = {
    status: candidateResults.length ? 'completed' : 'skipped',
    candidateCount: candidateResults.length,
    adapterDecisionCount: decisions.length,
    adapterAcceptedCount: decisions.filter((decision) => decision.status === 'accepted').length,
    replayAttemptedCount: replayVerifications.filter((verification) => verification.reasonCode !== 'adapter_rejected').length,
    replayVerifiedCount: replayVerifications.filter((verification) => verification.status === 'verified').length,
    activatedApiAdapterCount: activatedAdapters.length,
    skippedReasonCounts: countByReason(skippedRecords),
    catalogPromotionGateCount: promotionGates.length,
    catalogPromotionReadyCount: promotionGates.filter((gate) => gate.canEnterCatalog === true).length,
    catalogPromotionBlockedReasonCounts: countByReason(promotionGates.filter((gate) => gate.canEnterCatalog !== true)),
    rawTracesPersisted: captureStage.summary?.rawTracesPersisted === true,
    decisionArtifacts: decisions.map((decision) => relativeReportPath(context.cwd, decision.artifactPath)),
    replayVerificationArtifacts: replayVerifications.map((verification) => relativeReportPath(context.cwd, verification.artifactPath)),
    catalogPromotionGateArtifacts: promotionGates.map((gate) => relativeReportPath(context.cwd, gate.artifactPath)),
    runtimeBindingArtifact: runtimeBindingsPath ? relativeReportPath(context.cwd, runtimeBindingsPath) : null,
  };
  const summaryPayload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-api-adapter-replay-summary',
    buildId: context.buildId,
    siteId: context.site.id,
    status: summary.status,
    summary,
    activatedAdapters,
  };
  const adapterSummaryFields = {
    adapterValidationCount: summary.adapterDecisionCount,
    adapterAcceptedCount: summary.adapterAcceptedCount,
    replayVerifiedCount: summary.replayVerifiedCount,
    activatedApiAdapterCount: summary.activatedApiAdapterCount,
    adapterSkippedReasonCounts: summary.skippedReasonCounts,
    adapterDecisionArtifacts: summary.decisionArtifacts,
    replayVerificationArtifacts: summary.replayVerificationArtifacts,
    catalogPromotionGateCount: summary.catalogPromotionGateCount,
    catalogPromotionReadyCount: summary.catalogPromotionReadyCount,
    catalogPromotionBlockedReasonCounts: summary.catalogPromotionBlockedReasonCounts,
    catalogPromotionGateArtifacts: summary.catalogPromotionGateArtifacts,
    runtimeBindingArtifact: summary.runtimeBindingArtifact,
  };
  if (captureStage.summary) {
    Object.assign(captureStage.summary, adapterSummaryFields);
    if (captureStage.summary.sanitizedSummary) {
      Object.assign(captureStage.summary.sanitizedSummary, adapterSummaryFields);
    }
  }
  const summaryWrite = await writeRedactedArtifactWithAudit(
    context,
    path.join('discovery', 'api_adapter_replay.json'),
    path.join('discovery', 'api-adapter-replay-redaction-audits', 'api_adapter_replay.redaction-audit.json'),
    summaryPayload,
  );
  await mergeApiAdapterReplayIntoNetworkSummary(context, summary);
  return {
    status: 'success',
    warnings,
    decisions,
    replayVerifications,
    promotionGates,
    activatedAdapters,
    artifactPaths: {
      apiAdapterReplay: summaryWrite.artifactPath,
      apiAdapterReplayRedactionAudit: summaryWrite.redactionAuditPath,
      decisions: summary.decisionArtifacts,
      replayVerifications: summary.replayVerificationArtifacts,
      catalogPromotionGates: summary.catalogPromotionGateArtifacts,
      runtimeBindings: runtimeBindingsPath,
    },
    summary,
  };
}

async function buildSiteGraphStage(context, stageResults) {
  const pages = pagesFromStageResults(stageResults);
  const nodes = /** @type {any[]} */ ([]);
  const edges = /** @type {any[]} */ ([]);
  const nodeByPageKey = new Map();
  const routeNodes = new Map();
  const apiAdapters = stageResults.apiAdapterReplay?.activatedAdapters ?? [];
  const graphProgress = (substepId, message, extra = /** @type {any} */ ({})) => markStageSubstepProgress(context, substepId, {
    message,
    processedCount: extra.processedCount ?? nodes.length,
    totalCount: extra.totalCount ?? Math.max(pages.length, nodes.length),
    discoveredCount: extra.discoveredCount ?? nodes.length,
    skippedCount: extra.skippedCount ?? 0,
    currentItem: extra.currentItem ?? null,
  });
  graphProgress('mergePages', '合并静态、渲染和认证页面证据。', {
    processedCount: 0,
    totalCount: pages.length,
    discoveredCount: pages.length,
  });
  const isMissingBrowserBridgeRoute = (sourceLayer, ...values) => (
    isAuthenticatedSourceLayer(sourceLayer)
      ? matchesMissingBrowserBridgeRouteForSourceLayer(context, sourceLayer, values)
      : isPublicReadSourceLayer(sourceLayer)
        ? matchesMissingBrowserBridgeRouteForSourceLayer(context, sourceLayer, values, { nonRoot: true })
        : false
  );
  const attachRouteTemplateNode = ({
    parentNode,
    page,
    pattern,
    sourceLayer,
    authRequired,
    evidenceLevel,
    evidenceStatus = null,
    routeOnly = false,
    linkSemanticKind = null,
    linkStructureType = null,
    linkLabel = null,
    linkHref = null,
  }) => {
    if (!parentNode || !pattern || pattern === '/') {
      return;
    }
    if (isMissingBrowserBridgeRoute(sourceLayer, pattern, linkHref)) {
      return;
    }
    const resolvedEvidenceStatus = routeOnly ? (evidenceStatus ?? 'link_route_template') : evidenceStatus;
    const sanitizedLinkLabel = sanitizedStructureText(linkLabel, 80);
    const sanitizedLinkHref = linkHref ? sanitizeEvidenceRef(linkHref) : null;
    const categoryInstance = ['search', 'category', 'tag', 'ranking', 'work', 'article', 'media', 'detail', 'profile', 'following_list', 'followed_channel'].includes(String(linkSemanticKind ?? '').toLowerCase())
      ? {
        kind: String(linkSemanticKind).toLowerCase(),
        label: sanitizedLinkLabel ?? String(linkSemanticKind),
        routeTemplate: pattern,
        normalizedUrl: sanitizedLinkHref,
        selector: null,
        sourceLayer,
        evidenceStatus: resolvedEvidenceStatus,
      }
      : null;
    const confidence = resolvedEvidenceStatus === 'route_seed_only'
      ? 0.56
      : routeOnly
        ? 0.66
        : 0.72;
    const routeKey = `${pattern}:route-template:${sourceLayer}`;
    if (!routeNodes.has(routeKey)) {
      const routeId = sourceLayer === 'public'
        ? routeTemplateNodeId(pattern, null)
        : stableNodeId('node:route-template', `${pattern}:${sourceLayer}`);
      routeNodes.set(routeKey, {
        schemaVersion: BUILD_SCHEMA_VERSION,
        id: routeId,
        siteId: context.site.id,
        type: 'route_template',
        routePattern: pattern,
        routeTemplate: pattern,
        tabState: null,
        pageType: null,
        stateKey: null,
        title: `Route template ${pattern}`,
        textSummary: linkSemanticKind
          ? `Sanitized ${linkSemanticKind} route template discovered from link on ${page.normalizedUrl}`
          : `Sanitized route template discovered from ${page.normalizedUrl}`,
        discoveredBy: page.discoveredBy,
        sourceLayer,
        providerId: page.providerId ?? null,
        runtimeMode: page.runtimeMode ?? null,
        authVerificationStatus: page.authVerificationStatus ?? null,
        evidenceLevel,
        evidenceStatus: resolvedEvidenceStatus,
        staticEvidenceStatus: routeOnly ? null : (page.diagnostics?.staticEvidenceStatus ?? null),
        publicEvidenceStatus: routeOnly ? null : (page.diagnostics?.publicEvidenceStatus ?? null),
        linkSemanticKind: linkSemanticKind ?? null,
        linkStructureType: linkStructureType ?? null,
        linkLabel: sanitizedLinkLabel,
        linkHref: sanitizedLinkHref,
        categoryInstance,
        categoryInstances: categoryInstance ? [categoryInstance] : [],
        parentNodeIds: [],
        childNodeIds: [],
        authRequired,
        confidence,
        evidence: [
          buildEvidence({
            type: 'url',
            source: page.sourcePath ?? page.normalizedUrl,
            text: sanitizedLinkLabel ? `${sanitizedLinkLabel} ${pattern}` : pattern,
            confidence,
          }),
        ],
      });
    } else if (linkSemanticKind || sanitizedLinkLabel || sanitizedLinkHref) {
      const existingRouteNode = routeNodes.get(routeKey);
      existingRouteNode.linkSemanticKind = existingRouteNode.linkSemanticKind ?? linkSemanticKind;
      existingRouteNode.linkStructureType = existingRouteNode.linkStructureType ?? linkStructureType ?? null;
      existingRouteNode.linkLabel = existingRouteNode.linkLabel ?? sanitizedLinkLabel;
      existingRouteNode.linkHref = existingRouteNode.linkHref ?? sanitizedLinkHref;
      existingRouteNode.categoryInstance = existingRouteNode.categoryInstance ?? categoryInstanceForNode(existingRouteNode);
      if (categoryInstance) {
        const currentInstances = Array.isArray(existingRouteNode.categoryInstances)
          ? existingRouteNode.categoryInstances
          : existingRouteNode.categoryInstance
            ? [existingRouteNode.categoryInstance]
            : [];
        const key = `${categoryInstance.kind}:${categoryInstance.label}:${categoryInstance.routeTemplate}:${categoryInstance.normalizedUrl ?? ''}`;
        if (!currentInstances.some((item) => `${item.kind}:${item.label}:${item.routeTemplate}:${item.normalizedUrl ?? ''}` === key)) {
          existingRouteNode.categoryInstances = [...currentInstances, categoryInstance].slice(0, 80);
        }
      }
      existingRouteNode.confidence = Math.max(Number(existingRouteNode.confidence ?? 0), confidence);
    }
    const routeNode = routeNodes.get(routeKey);
    if (!parentNode.childNodeIds.includes(routeNode.id)) {
      parentNode.childNodeIds.push(routeNode.id);
    }
    if (!routeNode.parentNodeIds.includes(parentNode.id)) {
      routeNode.parentNodeIds.push(parentNode.id);
    }
    const edgeId = stableNodeId('edge:route-template', `${parentNode.id}:${routeNode.id}`);
    if (!edges.some((edge) => edge.id === edgeId)) {
      edges.push({
        id: edgeId,
        type: 'exposes_route_template',
        from: parentNode.id,
        to: routeNode.id,
        evidence: routeNode.evidence,
      });
    }
  };

  graphProgress('mergeInteractions', '附加页面链接、控件、表单和结构节点。', {
    processedCount: 0,
    totalCount: pages.length,
    discoveredCount: nodes.length,
  });
  for (const [pageIndex, page] of pages.entries()) {
    const sourceLayer = pageSourceLayer(page);
    if (isMissingBrowserBridgeRoute(sourceLayer, page.routeTemplate, page.routePattern, page.normalizedUrl, page.url)) {
      continue;
    }
    const authRequired = page.authRequired === true || isAuthenticatedSourceLayer(sourceLayer);
    const evidenceLevel = pageEvidenceLevel(page);
    const id = pageNodeIdForPage(page);
    const node = {
      schemaVersion: BUILD_SCHEMA_VERSION,
      id,
      siteId: context.site.id,
      type: 'page',
      url: page.url,
      normalizedUrl: page.normalizedUrl,
      routePattern: page.routeTemplate ?? routePatternForUrl(page.normalizedUrl),
      routeTemplate: page.routeTemplate ?? null,
      routeProofOnly: page.routeProofOnly === true,
      tabState: page.tabState ?? null,
      stateKey: page.stateKey ?? null,
      routeState: page.routeState ?? {
        source: page.stateKey ? 'known-social-route-state-model' : 'static-route',
        stateId: page.stateKey ?? null,
        routeTemplate: page.routeTemplate ?? null,
        routePath: page.routePath ?? null,
        tabState: page.tabState ?? null,
        pageType: page.pageType ?? null,
      },
      pageType: page.pageType ?? null,
      visibleItemCount: Number(page.visibleItemCount ?? 0) || 0,
      listPresent: page.listPresent === true,
      emptyStatePresent: page.emptyStatePresent === true,
      routeTemplates: uniqueSortedStrings(page.routeTemplates ?? []),
      structureHash: page.structureHash ?? null,
      evidenceStatus: page.evidenceStatus ?? null,
      staticEvidenceStatus: page.diagnostics?.staticEvidenceStatus ?? null,
      publicEvidenceStatus: page.diagnostics?.publicEvidenceStatus ?? null,
      riskLevel: page.riskLevel ?? null,
      sourceLayer,
      providerId: page.providerId ?? null,
      runtimeMode: page.runtimeMode ?? null,
      authVerificationStatus: page.authVerificationStatus ?? null,
      evidenceLevel,
      title: page.title,
      textSummary: page.textSummary,
      domFingerprint: stableNodeId('dom', `${page.title}:${page.textSummary}:${page.links.length}:${page.forms.length}:${page.stateKey ?? ''}:${page.structureHash ?? ''}`),
      discoveredBy: page.discoveredBy,
      parentNodeIds: [],
      childNodeIds: [],
      authRequired,
      overlayFor: page.overlayFor ?? null,
      confidence: 0.9,
      evidence: page.evidence,
    };
    nodeByPageKey.set(pageIdentity(page), node);
    nodes.push(node);

    const pageElementInstances = Array.isArray(page.elementInstances) ? page.elementInstances.slice(0, 120) : [];
    for (const [elementIndex, element] of pageElementInstances.entries()) {
      const elementUrl = element.href ?? element.action ?? null;
      const routeTemplate = element.routeTemplate ?? (elementUrl ? routePatternForUrl(elementUrl) : page.routeTemplate ?? null);
      if (isMissingBrowserBridgeRoute(sourceLayer, routeTemplate, elementUrl)) {
        continue;
      }
      const elementLabel = sanitizedStructureText(element.label, 120, `${element.kind ?? 'element'}-${elementIndex + 1}`);
      const elementRole = sanitizedStructureText(element.role ?? element.semanticKind ?? 'navigation', 60, 'navigation');
      const elementId = stableNodeId(
        'node:element',
        `${id}:${element.kind ?? 'element'}:${element.selector ?? elementIndex}:${elementLabel}:${elementUrl ?? ''}`,
      );
      const elementNode = {
        schemaVersion: BUILD_SCHEMA_VERSION,
        id: elementId,
        siteId: context.site.id,
        type: element.kind === 'form' || elementRole === 'search' ? 'operation' : 'component',
        url: elementUrl,
        normalizedUrl: elementUrl,
        routePattern: routeTemplate,
        routeTemplate,
        tabState: page.tabState ?? null,
        stateKey: `${page.stateKey ?? page.normalizedUrl}:element:${elementIndex}`,
        pageType: element.structureType ?? `${elementRole}_element`,
        structureType: element.structureType ?? `${elementRole}_element`,
        elementKind: element.kind ?? 'element',
        elementRole,
        elementLabel,
        elementSelector: element.selector ?? null,
        linkSemanticKind: element.semanticKind ?? elementRole,
        linkStructureType: element.structureType ?? null,
        linkLabel: elementLabel,
        linkHref: element.href ?? null,
        instanceKind: elementRole,
        instanceLabel: elementLabel,
        instanceRouteTemplate: routeTemplate,
        formAction: element.action ?? null,
        formMethod: element.method ?? null,
        visibleItemCount: 1,
        listPresent: false,
        emptyStatePresent: false,
        routeTemplates: routeTemplate ? [routeTemplate] : [],
        structureHash: stableNodeId('element-structure', `${elementId}:${routeTemplate ?? ''}`),
        evidenceStatus: element.evidenceStatus ?? 'element_instance_summary_present',
        staticEvidenceStatus: page.diagnostics?.staticEvidenceStatus ?? null,
        publicEvidenceStatus: page.diagnostics?.publicEvidenceStatus ?? null,
        riskLevel: page.riskLevel ?? 'read_public_low',
        sourceLayer,
        providerId: element.providerId ?? page.providerId ?? null,
        runtimeMode: element.runtimeMode ?? page.runtimeMode ?? null,
        authVerificationStatus: page.authVerificationStatus ?? null,
        evidenceLevel: element.evidenceLevel ?? evidenceLevel,
        title: elementLabel,
        textSummary: `Sanitized ${elementRole} ${element.kind ?? 'element'} instance; session material, unsanitized markup, page body, and profile material were not persisted.`,
        discoveredBy: element.kind === 'form' ? 'form' : 'html_link',
        parentNodeIds: [node.id],
        childNodeIds: [],
        authRequired,
        overlayFor: page.overlayFor ?? null,
        confidence: 0.78,
        evidence: [
          buildEvidence({
            type: 'dom',
            source: page.sourcePath ?? page.normalizedUrl,
            selector: element.selector ?? null,
            text: `${elementLabel} ${routeTemplate ?? elementUrl ?? ''}`.trim(),
            confidence: 0.78,
          }),
        ],
      };
      elementNode.categoryInstance = categoryInstanceForNode(elementNode);
      nodes.push(elementNode);
      if (!node.childNodeIds.includes(elementNode.id)) {
        node.childNodeIds.push(elementNode.id);
      }
      edges.push({
        id: stableNodeId('edge:element', `${node.id}:${elementNode.id}`),
        type: 'exposes_element_instance',
        from: node.id,
        to: elementNode.id,
        evidence: elementNode.evidence,
      });
    }
    graphProgress('mergeInteractions', '页面交互证据合并中。', {
      processedCount: pageIndex + 1,
      totalCount: pages.length,
      discoveredCount: nodes.length,
      currentItem: page.normalizedUrl ?? page.url ?? null,
    });
  }

  for (const page of pages) {
    const from = nodeByPageKey.get(pageIdentity(page));
    if (!from) {
      continue;
    }
    for (const link of page.links) {
      const target = [...nodeByPageKey.values()].find((node) => node.normalizedUrl === link.normalizedHref);
      if (!target) {
        const sourceLayer = pageSourceLayer(page);
        let linkRouteTemplate = link.routeTemplate ?? null;
        if (!linkRouteTemplate && link.normalizedHref) {
          try {
            linkRouteTemplate = routePatternForUrl(link.normalizedHref);
          } catch {
            linkRouteTemplate = null;
          }
        }
        if (linkRouteTemplate && (isPublicReadSourceLayer(sourceLayer) || isAuthenticatedSourceLayer(sourceLayer))) {
          if (isMissingBrowserBridgeRoute(sourceLayer, linkRouteTemplate, link.normalizedHref ?? link.href)) {
            continue;
          }
          attachRouteTemplateNode({
            parentNode: from,
            page,
            pattern: linkRouteTemplate,
            sourceLayer,
            authRequired: page.authRequired === true || isAuthenticatedSourceLayer(sourceLayer),
            evidenceLevel: pageEvidenceLevel(page),
            evidenceStatus: link.semanticKind ? 'link_semantic_route_template' : 'link_route_template',
            routeOnly: true,
            linkSemanticKind: link.semanticKind ?? null,
            linkStructureType: link.structureType ?? null,
            linkLabel: link.label ?? null,
            linkHref: link.normalizedHref ?? link.href ?? null,
          });
        }
        continue;
      }
      const linkKind = String(link.semanticKind ?? '').toLowerCase();
      if (['search', 'category', 'tag', 'ranking', 'work', 'article', 'media', 'detail', 'profile', 'following_list', 'followed_channel'].includes(linkKind)) {
        const linkRouteTemplate = link.routeTemplate ?? (() => {
          try {
            return link.normalizedHref ? routePatternForUrl(link.normalizedHref) : null;
          } catch {
            return null;
          }
        })();
        const linkLabel = sanitizedStructureText(link.label, 80) ?? linkKind;
        const linkHref = link.normalizedHref ?? link.href ?? null;
        const targetCategoryInstance = {
          kind: linkKind,
          label: linkLabel,
          routeTemplate: linkRouteTemplate ?? target.routeTemplate ?? target.routePattern ?? null,
          normalizedUrl: linkHref ? sanitizeEvidenceRef(linkHref) : (target.normalizedUrl ?? target.url ?? null),
          selector: link.selector ?? null,
          sourceLayer: nodeSourceLayer(target),
          evidenceStatus: 'link_semantic_route_template',
        };
        target.linkSemanticKind = target.linkSemanticKind ?? linkKind;
        target.linkStructureType = target.linkStructureType ?? link.structureType ?? null;
        target.linkLabel = target.linkLabel ?? linkLabel;
        target.linkHref = target.linkHref ?? (linkHref ? sanitizeEvidenceRef(linkHref) : null);
        target.categoryInstance = target.categoryInstance ?? targetCategoryInstance;
        target.categoryInstances = Array.isArray(target.categoryInstances) ? target.categoryInstances : [];
        if (!target.categoryInstances.some((entry) => (
          entry?.kind === targetCategoryInstance.kind
          && entry?.routeTemplate === targetCategoryInstance.routeTemplate
          && entry?.label === targetCategoryInstance.label
        ))) {
          target.categoryInstances.push(targetCategoryInstance);
        }
      }
      from.childNodeIds.push(target.id);
      target.parentNodeIds.push(from.id);
      edges.push({
        id: stableNodeId('edge:link', `${from.id}:${target.id}:${link.selector}`),
        type: 'links_to',
        from: from.id,
        to: target.id,
        linkSemanticKind: link.semanticKind ?? null,
        linkStructureType: link.structureType ?? null,
        linkRouteTemplate: link.routeTemplate ?? null,
        evidence: [
          buildEvidence({
            type: 'dom',
            source: page.sourcePath ?? page.normalizedUrl,
            selector: link.selector,
            text: link.label,
            confidence: 0.85,
          }),
        ],
      });
    }
    const pattern = page.routeTemplate ?? routePatternForUrl(page.normalizedUrl);
    const sourceLayer = pageSourceLayer(page);
    const authRequired = page.authRequired === true || isAuthenticatedSourceLayer(sourceLayer);
    const evidenceLevel = pageEvidenceLevel(page);
    const routeKeyBase = page.tabState ? `${pattern}:${page.tabState}` : pattern;
    const routeKey = sourceLayer === 'public' ? routeKeyBase : `${routeKeyBase}:${sourceLayer}`;
    if (!routeNodes.has(routeKey)) {
      const routeId = sourceLayer === 'public'
        ? (page.routeTemplate ? routeTemplateNodeId(pattern, page.tabState) : routeNodeId(pattern))
        : stableNodeId(page.routeTemplate ? 'node:route-template' : 'node:route', `${pattern}:${page.tabState ?? ''}:${sourceLayer}`);
      routeNodes.set(routeKey, {
        schemaVersion: BUILD_SCHEMA_VERSION,
        id: routeId,
        siteId: context.site.id,
        type: page.routeTemplate ? 'route_template' : 'route',
        routePattern: pattern,
        routeTemplate: page.routeTemplate ?? null,
        routeProofOnly: page.routeProofOnly === true,
        tabState: page.tabState ?? null,
        pageType: page.pageType ?? null,
        stateKey: page.stateKey ?? null,
        title: page.tabState ? `Route ${pattern} ${page.tabState}` : `Route ${pattern}`,
        textSummary: page.tabState
          ? `Route template ${pattern} with SPA state ${page.tabState}`
          : `Route pattern discovered from ${page.normalizedUrl}`,
        discoveredBy: page.discoveredBy,
        sourceLayer,
        providerId: page.providerId ?? null,
        runtimeMode: page.runtimeMode ?? null,
        authVerificationStatus: page.authVerificationStatus ?? null,
        evidenceLevel,
        staticEvidenceStatus: page.diagnostics?.staticEvidenceStatus ?? null,
        publicEvidenceStatus: page.diagnostics?.publicEvidenceStatus ?? null,
        parentNodeIds: [],
        childNodeIds: [],
        authRequired,
        confidence: 0.8,
        evidence: [
          buildEvidence({
            type: 'url',
            source: page.normalizedUrl,
            text: page.tabState ? `${pattern} ${page.tabState}` : pattern,
            confidence: 0.8,
          }),
        ],
      });
    }
    const routeNode = routeNodes.get(routeKey);
    from.childNodeIds.push(routeNode.id);
    routeNode.parentNodeIds.push(from.id);
    edges.push({
      id: stableNodeId('edge:route', `${from.id}:${routeNode.id}`),
      type: 'has_route_pattern',
      from: from.id,
      to: routeNode.id,
      evidence: routeNode.evidence,
    });
    for (const template of uniqueSortedStrings(page.routeTemplates ?? [])) {
      if (isMissingBrowserBridgeRoute(sourceLayer, template)) {
        continue;
      }
      attachRouteTemplateNode({
        parentNode: from,
        page,
        pattern: template,
        sourceLayer,
        authRequired,
        evidenceLevel,
        evidenceStatus: page.evidenceStatus ?? null,
      });
    }

    for (const form of page.forms) {
      const formId = formNodeId(from.id, form);
      const formNode = {
        schemaVersion: BUILD_SCHEMA_VERSION,
        id: formId,
        siteId: context.site.id,
        type: 'form',
        url: page.normalizedUrl,
        normalizedUrl: page.normalizedUrl,
        title: form.label,
        textSummary: form.textSummary,
        discoveredBy: 'form',
        sourceLayer,
        authVerificationStatus: page.authVerificationStatus ?? null,
        evidenceLevel,
        parentNodeIds: [from.id],
        childNodeIds: [],
        authRequired,
        confidence: 0.9,
        evidence: [
          buildEvidence({
            type: 'form',
            source: page.sourcePath ?? page.normalizedUrl,
            selector: form.selector,
            endpoint: form.action,
            method: form.method,
            confidence: 0.9,
          }),
        ],
      };
      from.childNodeIds.push(formId);
      nodes.push(formNode);
      edges.push({
        id: stableNodeId('edge:form', `${from.id}:${formId}`),
        type: 'contains_form',
        from: from.id,
        to: formId,
        evidence: formNode.evidence,
      });
    }

    for (const control of page.controls) {
      const controlId = controlNodeId(from.id, control);
      const controlType = controlNodeType(control);
      const controlNode = {
        schemaVersion: BUILD_SCHEMA_VERSION,
        id: controlId,
        siteId: context.site.id,
        type: controlType,
        url: page.normalizedUrl,
        normalizedUrl: page.normalizedUrl,
        title: control.label || control.name || titleCase(control.kind),
        textSummary: `${control.kind}${control.type ? ` ${control.type}` : ''} ${control.label ?? control.name ?? ''}`.trim(),
        discoveredBy: 'interaction',
        sourceLayer,
        authVerificationStatus: page.authVerificationStatus ?? null,
        evidenceLevel,
        parentNodeIds: [from.id],
        childNodeIds: [],
        authRequired,
        confidence: 0.78,
        evidence: [
          buildEvidence({
            type: 'dom',
            source: page.sourcePath ?? page.normalizedUrl,
            selector: control.selector,
            text: control.label || control.name,
            confidence: 0.78,
          }),
        ],
      };
      from.childNodeIds.push(controlId);
      nodes.push(controlNode);
      edges.push({
        id: stableNodeId('edge:control', `${from.id}:${controlId}`),
        type: 'contains_control',
        from: from.id,
        to: controlId,
        evidence: controlNode.evidence,
      });
    }

    for (const item of page.structureItems ?? []) {
      const structureId = structureNodeId(from.id, item);
      const nodeType = ['content', 'operation', 'modal'].includes(item.nodeType) ? item.nodeType : 'content';
      const structureNode = {
        schemaVersion: BUILD_SCHEMA_VERSION,
        id: structureId,
        siteId: context.site.id,
        type: nodeType,
        url: page.normalizedUrl,
        normalizedUrl: page.normalizedUrl,
        routePattern: page.routeTemplate ?? routePatternForUrl(page.normalizedUrl),
        routeTemplate: page.routeTemplate ?? null,
        tabState: page.tabState ?? null,
        pageType: page.pageType ?? null,
        title: item.labelSummary || item.structureType || nodeType,
        textSummary: `${item.structureType ?? nodeType}; visibleItems=${Number(item.visibleItemCount ?? 0) || 0}; listPresent=${item.listPresent === true}`,
        structureType: item.structureType ?? null,
        structureHash: item.structureHash ?? null,
        visibleItemCount: Number(item.visibleItemCount ?? 0) || 0,
        listPresent: item.listPresent === true,
        emptyStatePresent: item.emptyStatePresent === true,
        routeTemplates: uniqueSortedStrings(item.routeTemplates ?? []),
        evidenceStatus: item.evidenceStatus ?? page.evidenceStatus ?? null,
        riskLevel: item.riskLevel ?? page.riskLevel ?? null,
        discoveredBy: 'interaction',
        sourceLayer,
        authVerificationStatus: page.authVerificationStatus ?? null,
        evidenceLevel: item.evidenceLevel ?? evidenceLevel,
        parentNodeIds: [from.id],
        childNodeIds: [],
        authRequired,
        confidence: item.evidenceStatus === 'route_seed_only' ? 0.56 : 0.72,
        evidence: [
          buildEvidence({
            type: 'dom',
            source: page.sourcePath ?? page.normalizedUrl,
            selector: `auto-discovery-structure:${item.structureType ?? nodeType}`,
            text: item.labelSummary || item.structureType || nodeType,
            confidence: item.evidenceStatus === 'route_seed_only' ? 0.56 : 0.72,
          }),
        ],
      };
      from.childNodeIds.push(structureId);
      nodes.push(structureNode);
      edges.push({
        id: stableNodeId('edge:structure', `${from.id}:${structureId}`),
        type: `contains_${nodeType}`,
        from: from.id,
        to: structureId,
        evidence: structureNode.evidence,
      });
      for (const template of uniqueSortedStrings(item.routeTemplates ?? [])) {
        attachRouteTemplateNode({
          parentNode: structureNode,
          page,
          pattern: template,
          sourceLayer,
          authRequired,
          evidenceLevel: item.evidenceLevel ?? evidenceLevel,
          evidenceStatus: item.evidenceStatus ?? page.evidenceStatus ?? null,
        });
      }
    }
  }

  for (const page of pages.filter((candidate) => pageSourceLayer(candidate) === 'authenticated_overlay')) {
    const overlayNode = nodeByPageKey.get(pageIdentity(page));
    if (!overlayNode) {
      continue;
    }
    const overlayTargetUrl = page.overlayFor ? normalizeUrl(page.overlayFor, context.site.rootUrl) : page.normalizedUrl;
    const publicNode = [...nodeByPageKey.values()].find((node) => (
      node.sourceLayer === 'public'
      && node.normalizedUrl === overlayTargetUrl
    ));
    if (!publicNode) {
      continue;
    }
    overlayNode.parentNodeIds.push(publicNode.id);
    publicNode.childNodeIds.push(overlayNode.id);
    overlayNode.overlayForNodeId = publicNode.id;
    edges.push({
      id: stableNodeId('edge:auth-overlay', `${publicNode.id}:${overlayNode.id}`),
      type: 'auth_overlay_for',
      from: publicNode.id,
      to: overlayNode.id,
      evidence: overlayNode.evidence,
    });
  }

  for (const route of knownPolicyPublicRouteTemplatePatterns(context)) {
    if (route.pattern === '/') {
      continue;
    }
    const routeKey = `${route.pattern}:policy-route-template:public`;
    if (routeNodes.has(routeKey)) {
      continue;
    }
    routeNodes.set(routeKey, {
      schemaVersion: BUILD_SCHEMA_VERSION,
      id: routeTemplateNodeId(route.pattern, 'policy'),
      siteId: context.site.id,
      type: 'route_template',
      routePattern: route.pattern,
      routeTemplate: route.pattern,
      tabState: null,
      pageType: route.pageType,
      stateKey: null,
      title: `Known public route template ${route.pattern}`,
      textSummary: 'Sanitized public route template from site policy; no concrete page body was persisted.',
      discoveredBy: sourceToDiscoveredBy(route.source),
      sourceLayer: 'public',
      authVerificationStatus: context.authStateReport?.authVerificationStatus ?? null,
      evidenceLevel: 'public_verified',
      evidenceStatus: 'policy_route_template',
      businessCoverageGroup: seedBusinessCoverageGroup(context, {
        normalizedUrl: new URL(route.pattern, context.site.rootUrl).toString(),
        pageType: route.pageType,
        routeTemplate: route.pattern,
        source: route.source,
      }),
      staticEvidenceStatus: null,
      publicEvidenceStatus: 'policy_route_template',
      parentNodeIds: [],
      childNodeIds: [],
      authRequired: false,
      confidence: route.seedable ? 0.72 : 0.62,
      evidence: [
        buildEvidence({
          type: 'url',
          source: context.site.rootUrl,
          text: route.pattern,
          confidence: route.seedable ? 0.72 : 0.62,
        }),
      ],
    });
  }

  graphProgress('mergeApiEvidence', '合并 API 回放证据和路由模板。', {
    processedCount: apiAdapters.length,
    totalCount: apiAdapters.length,
    discoveredCount: routeNodes.size,
    skippedCount: 0,
  });
  nodes.push(...routeNodes.values());
  graphProgress('validateGraph', '验证图谱节点和边。', {
    processedCount: 0,
    totalCount: nodes.length,
    discoveredCount: edges.length,
  });
  for (const [nodeIndex, node] of nodes.entries()) {
    node.parentNodeIds = uniqueSortedStrings(node.parentNodeIds);
    node.childNodeIds = uniqueSortedStrings(node.childNodeIds);
    assertSiteNode(node);
    if (nodeIndex === 0 || nodeIndex === nodes.length - 1 || nodeIndex % 50 === 0) {
      graphProgress('validateGraph', '图谱节点验证中。', {
        processedCount: nodeIndex + 1,
        totalCount: nodes.length,
        discoveredCount: edges.length,
        currentItem: node.id,
      });
    }
  }
  const payload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    site: context.site,
    status: nodes.length ? 'success' : 'blocked',
    nodes: nodes.sort((left, right) => left.id.localeCompare(right.id, 'en')),
    edges: edges.sort((left, right) => left.id.localeCompare(right.id, 'en')),
    errors: nodes.length ? [] : ['Site graph contains no nodes; build stopped before draft skill generation.'],
    summary: {
      nodes: nodes.length,
      edges: edges.length,
      pages: pages.length,
      bySourceLayer: countBy(nodes, (node) => nodeSourceLayer(node)),
      blockedReason: nodes.length ? null : 'siteforge-site-graph-empty',
    },
  };
  const graphPath = await writeArtifactJson(context, 'graph.json', payload);
  if (!nodes.length) {
    throw createBlockedStageError(
      'siteforge-site-graph-empty',
      'Site graph contains no nodes; build stopped before draft skill generation.',
      {
        artifactPaths: { graph: graphPath },
        summary: payload.summary,
      },
    );
  }
  return {
    graph: payload,
    artifactPaths: { graph: graphPath },
    summary: payload.summary,
  };
}

async function classifyNodesStage(context, stageResults) {
  const graph = clone(requireStage(stageResults, 'buildSiteGraph').graph);
  markStageSubstepProgress(context, 'assignPageTypes', {
    message: '为图谱节点分配页面、路由和组件类型。',
    processedCount: 0,
    totalCount: graph.nodes.length,
    discoveredCount: 0,
  });
  for (const [nodeIndex, node] of graph.nodes.entries()) {
    if (node.type === 'page') {
      node.classification = classifyPage(node, context);
    } else if (node.type === 'form') {
      node.classification = /contact|support|message/iu.test(`${node.title ?? ''} ${node.textSummary ?? ''}`)
        ? 'contact_form'
        : /search|query|keyword/iu.test(`${node.title ?? ''} ${node.textSummary ?? ''}`)
          ? 'search_form'
          : 'form';
    } else if (node.type === 'content') {
      node.classification = chapterContentClassification(node.routeTemplate ?? node.routePattern ?? '', node.structureType ?? node.pageType ?? '', context)
        ?? genericPublicClassification(node.routeTemplate ?? node.routePattern ?? '', node.structureType ?? node.pageType ?? '', `${node.title ?? ''} ${node.textSummary ?? ''}`, node)
        ?? `content_${node.structureType ?? node.pageType ?? 'summary'}`;
    } else if (node.type === 'operation') {
      node.classification = chapterContentClassification(node.routeTemplate ?? node.routePattern ?? '', node.structureType ?? node.pageType ?? '', context)
        ?? genericPublicClassification(node.routeTemplate ?? node.routePattern ?? '', node.structureType ?? node.pageType ?? '', `${node.title ?? ''} ${node.textSummary ?? ''}`, node)
        ?? `operation_${node.structureType ?? node.pageType ?? 'summary'}`;
    } else if (node.type === 'component') {
      node.classification = chapterContentClassification(node.routeTemplate ?? node.routePattern ?? '', node.structureType ?? node.pageType ?? '', context)
        ?? classificationFromLinkSemanticKind(node.linkSemanticKind ?? node.elementRole, node)
        ?? genericPublicClassification(node.routeTemplate ?? node.routePattern ?? '', node.structureType ?? node.pageType ?? '', `${node.title ?? ''} ${node.textSummary ?? ''}`, node)
        ?? `component_${node.structureType ?? node.pageType ?? 'summary'}`;
    } else if (node.type === 'modal') {
      node.classification = `modal_${node.structureType ?? node.pageType ?? 'summary'}`;
    } else if (node.type === 'route_template') {
      node.classification = isAuthenticatedSourceLayer(nodeSourceLayer(node))
        ? classifyPage(node, context)
        : chapterContentClassification(node.routePattern ?? '', node.pageType ?? '', context)
        ?? classificationFromLinkSemanticKind(node.linkSemanticKind, node)
        ?? catalogRouteClassification(node.routePattern ?? '', `${node.title ?? ''} ${node.textSummary ?? ''}`)
        ?? genericPublicClassification(node.routePattern ?? '', node.pageType ?? '', `${node.title ?? ''} ${node.textSummary ?? ''}`, node)
        ?? 'route_template';
    } else if (node.type === 'route') {
      node.classification = isAuthenticatedSourceLayer(nodeSourceLayer(node))
        ? classifyPage(node, context)
        : chapterContentClassification(node.routePattern ?? '', node.pageType ?? '', context)
        ?? classificationFromLinkSemanticKind(node.linkSemanticKind, node)
        ?? catalogRouteClassification(node.routePattern ?? '', `${node.title ?? ''} ${node.textSummary ?? ''}`)
        ?? genericPublicClassification(node.routePattern ?? '', node.pageType ?? '', `${node.title ?? ''} ${node.textSummary ?? ''}`, node)
        ?? (/product-\d+|:id/u.test(node.routePattern ?? '') ? 'entity_route' : 'route');
    }
    if (nodeIndex === 0 || nodeIndex === graph.nodes.length - 1 || nodeIndex % 50 === 0) {
      markStageSubstepProgress(context, 'assignPageTypes', {
        message: '节点类型分类中。',
        processedCount: nodeIndex + 1,
        totalCount: graph.nodes.length,
        discoveredCount: new Set(graph.nodes.slice(0, nodeIndex + 1).map((candidate) => candidate.classification ?? candidate.type)).size,
        currentItem: node.id,
      });
    }
  }
  markStageSubstepProgress(context, 'mapRiskVocabulary', {
    message: '映射风险词表和来源层级。',
    processedCount: graph.nodes.filter((node) => node.riskLevel).length,
    totalCount: graph.nodes.length,
    discoveredCount: Object.keys(countBy(graph.nodes, (node) => nodeSourceLayer(node))).length,
  });
  graph.summary = {
    ...graph.summary,
    classifications: Object.fromEntries(
      Object.entries(graph.nodes.reduce((counts, node) => {
        counts[node.classification ?? node.type] = (counts[node.classification ?? node.type] ?? 0) + 1;
        return counts;
      }, {})).sort(([left], [right]) => left.localeCompare(right, 'en')),
    ),
  };
  markStageSubstepProgress(context, 'summarizeCoverage', {
    message: '汇总图谱覆盖和分类分布。',
    processedCount: graph.nodes.length,
    totalCount: graph.nodes.length,
    discoveredCount: Object.keys(graph.summary.classifications ?? {}).length,
  });
  context.skillId = resolveSkillId(context, graph);
  context.skillDir = resolveSkillDir(context);
  context.draftSkillDir = context.skillDir;
  context.activeSkillDir = resolveActiveSkillDir(context);
  markStageSubstepProgress(context, 'emitClassifiedGraph', {
    message: '写入分类后的图谱。',
    processedCount: graph.nodes.length,
    totalCount: graph.nodes.length,
    discoveredCount: graph.edges?.length ?? 0,
    currentItem: context.skillId,
  });
  const classifiedGraphPath = await writeArtifactJson(context, 'classified_graph.json', graph);
  return {
    graph,
    artifactPaths: { classifiedGraph: classifiedGraphPath },
    summary: graph.summary,
  };
}

async function extractAffordancesStage(context, stageResults) {
  const pages = pagesFromStageResults(stageResults);
  const graph = requireStage(stageResults, 'classifyNodes').graph;
  const totalRawControls = pages.reduce((count, page) => (
    count
    + (Array.isArray(page.links) ? page.links.length : 0)
    + (Array.isArray(page.forms) ? page.forms.length : 0)
    + (Array.isArray(page.controls) ? page.controls.length : 0)
  ), 0);
  markStageSubstepProgress(context, 'normalizeControls', {
    message: '规范化页面链接、表单和控件。',
    processedCount: 0,
    totalCount: pages.length,
    discoveredCount: totalRawControls,
  });
  const pageNodeByKey = new Map(graph.nodes.filter((node) => node.type === 'page').map((node) => [
    pageIdentity(node),
    node,
  ]));
  const affordances = /** @type {any[]} */ ([]);
  let skippedAffordancePages = 0;
  markStageSubstepProgress(context, 'bindEvidence', {
    message: '绑定页面节点和可操作证据。',
    processedCount: 0,
    totalCount: pages.length,
    discoveredCount: affordances.length,
  });
  const commonAffordanceMetadata = (page, safety = 'read_only') => {
    const defaultBlocked = ['destructive', 'payment'].includes(safety);
    const sourceLayer = pageSourceLayer(page);
    return {
      sourceLayer,
      authRequired: page.authRequired === true || isAuthenticatedSourceLayer(sourceLayer),
      authVerificationStatus: page.authVerificationStatus ?? null,
      evidenceLevel: pageEvidenceLevel(page),
      riskLevel: safety === 'payment'
        ? 'write_high'
        : safety === 'destructive'
          ? 'write_high'
          : safety === 'state_changing'
            ? 'write_low'
            : page.riskLevel ?? 'read_public_low',
      activationDecision: defaultBlocked
        ? 'disabled'
        : 'candidate_evidence',
    };
  };

  for (const [pageIndex, page] of pages.entries()) {
    const pageNode = pageNodeByKey.get(pageIdentity(page));
    if (!pageNode) {
      skippedAffordancePages += 1;
      markStageSubstepProgress(context, 'bindEvidence', {
        message: '跳过缺少图谱节点的页面。',
        processedCount: pageIndex + 1,
        totalCount: pages.length,
        discoveredCount: affordances.length,
        skippedCount: skippedAffordancePages,
        currentItem: page.normalizedUrl ?? page.url ?? null,
      });
      continue;
    }
    for (const link of page.links) {
      const isDownload = /(?:download|\.pdf$|\.zip$|\.csv$|\.txt$)/iu.test(`${link.label ?? ''} ${link.href}`);
      affordances.push({
        id: affordanceId(isDownload ? 'download' : 'link', `${page.normalizedUrl}:${link.normalizedHref}:${link.selector}`),
        nodeId: pageNode.id,
        kind: isDownload ? 'download' : 'link',
        label: link.label,
        selector: link.selector,
        href: link.normalizedHref,
        semanticKind: link.semanticKind ?? null,
        structureType: link.structureType ?? null,
        safety: 'read_only',
        ...commonAffordanceMetadata(page, 'read_only'),
        evidence: [
          buildEvidence({
            type: 'dom',
            source: page.sourcePath ?? page.normalizedUrl,
            selector: link.selector,
            text: link.label,
            confidence: 0.85,
          }),
        ],
        confidence: 0.85,
      });
    }
    for (const form of page.forms) {
      const safety = formSafety(form);
      affordances.push({
        id: affordanceId('form', `${page.normalizedUrl}:${form.selector}:${form.action}:${form.method}`),
        nodeId: pageNode.id,
        kind: 'form',
        label: form.label,
        selector: form.selector,
        method: form.method,
        endpoint: form.action,
        safety,
        ...commonAffordanceMetadata(page, safety),
        evidence: [
          buildEvidence({
            type: 'form',
            source: page.sourcePath ?? page.normalizedUrl,
            selector: form.selector,
            endpoint: form.action,
            method: form.method,
            text: form.textSummary,
            confidence: 0.9,
          }),
        ],
        confidence: safety === 'state_changing' ? 0.75 : 0.9,
        inputs: form.inputs.map((input) => ({
          name: input.name,
          type: input.type,
          selector: input.selector,
          label: input.label,
        })),
      });
      for (const input of form.inputs) {
        const kind = input.tagName === 'select' ? 'select' : 'input';
        affordances.push({
          id: affordanceId(kind, `${page.normalizedUrl}:${form.selector}:${input.selector}`),
          nodeId: pageNode.id,
          kind,
          label: input.label || input.name,
          selector: input.selector,
          safety: 'requires_input',
          ...commonAffordanceMetadata(page, 'requires_input'),
          evidence: [
            buildEvidence({
              type: 'dom',
              source: page.sourcePath ?? page.normalizedUrl,
              selector: input.selector,
              text: input.label || input.name,
              confidence: 0.75,
            }),
          ],
          confidence: 0.75,
        });
      }
    }
    for (const control of page.controls) {
      const kind = controlAffordanceKind(control);
      const safety = controlSafety(control);
      affordances.push({
        id: affordanceId(kind, `${page.normalizedUrl}:${control.selector}:${control.kind}:${control.label ?? control.name ?? ''}`),
        nodeId: controlNodeId(pageNode.id, control),
        kind,
        label: control.label || control.name || titleCase(control.kind),
        selector: control.selector,
        safety,
        ...commonAffordanceMetadata(page, safety),
        evidence: [
          buildEvidence({
            type: 'dom',
            source: page.sourcePath ?? page.normalizedUrl,
            selector: control.selector,
            text: control.label || control.name,
            confidence: 0.78,
          }),
        ],
        confidence: safety === 'safe' ? 0.78 : 0.7,
      });
    }
    markStageSubstepProgress(context, 'bindEvidence', {
      message: '页面可操作项提取中。',
      processedCount: pageIndex + 1,
      totalCount: pages.length,
      discoveredCount: affordances.length,
      currentItem: page.normalizedUrl ?? page.url ?? null,
    });
  }

  for (const routeNode of graph.nodes.filter((node) => node.type === 'route' || node.type === 'route_template')) {
    affordances.push({
      id: affordanceId('route', `${routeNode.id}:${routeNode.routePattern}`),
      nodeId: routeNode.id,
      kind: 'route',
      label: routeNode.title,
      href: routeNode.routePattern,
      safety: 'read_only',
      evidence: routeNode.evidence,
      confidence: routeNode.confidence,
      routeTemplate: routeNode.routeTemplate ?? null,
      tabState: routeNode.tabState ?? null,
      sourceLayer: nodeSourceLayer(routeNode),
      authRequired: routeNode.authRequired === true,
      authVerificationStatus: routeNode.authVerificationStatus ?? null,
      evidenceLevel: routeNode.evidenceLevel ?? 'public_verified',
      riskLevel: routeNode.riskLevel ?? 'read_public_low',
      activationDecision: 'candidate_evidence',
    });
  }

  markStageSubstepProgress(context, 'dedupeAffordances', {
    message: '去重并验证可操作项。',
    processedCount: affordances.length,
    totalCount: affordances.length,
    discoveredCount: 0,
  });
  const deduped = arrayUniqueBy(affordances, (affordance) => affordance.id)
    .sort((left, right) => left.id.localeCompare(right.id, 'en'));
  for (const affordance of deduped) {
    assertAffordance(affordance);
  }
  const payload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    affordances: deduped,
    summary: {
      affordances: deduped.length,
      byKind: Object.fromEntries(Object.entries(deduped.reduce((counts, affordance) => {
        counts[affordance.kind] = (counts[affordance.kind] ?? 0) + 1;
        return counts;
      }, {})).sort(([left], [right]) => left.localeCompare(right, 'en'))),
    },
  };
  markStageSubstepProgress(context, 'emitAffordances', {
    message: '写入可操作项列表。',
    processedCount: deduped.length,
    totalCount: affordances.length,
    discoveredCount: deduped.length,
    skippedCount: Math.max(0, affordances.length - deduped.length),
  });
  const affordancesPath = await writeArtifactJson(context, 'affordances.json', payload);
  return {
    affordances: deduped,
    artifactPaths: { affordances: affordancesPath },
    summary: payload.summary,
  };
}

function capabilityUserFacingName(name, userValue, metadata = /** @type {any} */ ({})) {
  const explicit = metadata.user_facing_name ?? metadata.userFacingName;
  if (explicit !== undefined && explicit !== null && String(explicit).trim()) {
    return explicit;
  }
  const label = String(userValue ?? name ?? '').trim();
  if (/[\u3400-\u9fff]/u.test(label)) {
    return label;
  }
  return label ? `${label}（公开只读）` : null;
}

function makeCapability(context, {
  name,
  description,
  action,
  object,
  userValue,
  entryNodeIds,
  requiredNodeIds = /** @type {any[]} */ ([]),
  inputs = /** @type {any[]} */ ([]),
  outputs = /** @type {any[]} */ ([]),
  safetyLevel = 'read_only',
  executionPlan = null,
  evidence,
  confidence,
  status = 'active',
  informational = false,
  ...metadata
}) {
  const id = stableCapabilityId(context.site.id, name);
  const adapterProfile = context.siteAdapterProfile ?? null;
  const { sourceAdapterId, sourceSiteKey } = sourceAdapterIdentity(context);
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    id,
    siteId: context.site.id,
    adapterProfileId: adapterProfile?.adapterId ?? dedicatedSiteAdapterId(context),
    adapterProfileRef: context.siteAdapterPaths?.build?.generatedAdapter
      ? relativeReportPath(context.cwd, context.siteAdapterPaths.build.generatedAdapter)
      : 'generated_adapter.json',
    sourceAdapterId: adapterProfile?.sourceAdapterId ?? sourceAdapterId,
    sourceSiteKey: adapterProfile?.sourceSiteKey ?? sourceSiteKey,
    name,
    description,
    action,
    object,
    userValue,
    user_facing_name: capabilityUserFacingName(name, userValue, metadata),
    entryNodeIds,
    requiredNodeIds,
    inputs,
    outputs,
    safetyLevel,
    executionPlan,
    evidence,
    confidence,
    status,
    informational,
    ...metadata,
  };
}

function buildExecutionPlan(capabilityId, {
  mode = 'read_only',
  steps = /** @type {any[]} */ ([]),
  dryRunOnly = false,
  requiresConfirmation = false,
  autoExecute = false,
  governedExecution = false,
  executionDisposition = null,
  limitedOutputOnly = false,
  savedMaterial = null,
} = /** @type {any} */ ({})) {
  const sourceSteps = Array.isArray(steps) ? steps : [];
  const hasStateChangingStep = sourceSteps.some((step) => (
    step?.submit === true
    || step?.finalSubmit === true
    || step?.upload === true
    || step?.selectSensitiveRecipient === true
  ));
  const effectiveGovernedExecution = governedExecution === true || hasStateChangingStep;
  const effectiveRequiresConfirmation = requiresConfirmation === true || hasStateChangingStep;
  const effectiveDryRunOnly = dryRunOnly === true || hasStateChangingStep;
  const effectiveExecutionDisposition = executionDisposition
    ?? (hasStateChangingStep ? 'confirm_required' : null);
  const effectiveMode = hasStateChangingStep && mode !== 'read_only' ? 'dry_run' : mode;
  const effectiveSteps = hasStateChangingStep
    ? sourceSteps.map((step) => ({
      ...step,
      plannedSubmit: step?.plannedSubmit ?? (step?.submit === true),
      plannedFinalSubmit: step?.plannedFinalSubmit ?? (step?.finalSubmit === true),
      plannedUpload: step?.plannedUpload ?? (step?.upload === true),
      submit: false,
      finalSubmit: false,
      upload: false,
      selectSensitiveRecipient: false,
      autoExecute: false,
      governedExecution: true,
      executionDisposition: step?.executionDisposition && step.executionDisposition !== 'allow'
        ? step.executionDisposition
        : 'confirm_required',
    }))
    : sourceSteps;
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    id: executionPlanId(capabilityId),
    capabilityId,
    mode: effectiveMode,
    dryRunOnly: effectiveDryRunOnly,
    requiresConfirmation: effectiveRequiresConfirmation,
    autoExecute: hasStateChangingStep ? false : autoExecute,
    governedExecution: effectiveGovernedExecution,
    executionDisposition: effectiveExecutionDisposition,
    limitedOutputOnly,
    savedMaterial,
    steps: effectiveSteps,
  };
}

function disabledActionForAffordance(affordance) {
  const isReadOnlyLink = ['link', 'download'].includes(String(affordance?.kind ?? '').toLowerCase())
    && ['read_only', 'safe'].includes(String(affordance?.safety ?? '').toLowerCase());
  const text = isReadOnlyLink
    ? [
      affordance?.kind,
      affordance?.method,
      affordance?.endpoint,
      affordance?.href,
      affordance?.semanticKind,
      affordance?.structureType,
      affordance?.safety,
    ].filter(Boolean).join(' ')
    : [
      affordance?.kind,
      affordance?.label,
      affordance?.method,
      affordance?.endpoint,
      affordance?.href,
      affordance?.safety,
    ].filter(Boolean).join(' ');
  const forced = isReadOnlyFollowSurface(affordance)
    ? findForcedDisabledActions(text).filter((action) => action !== 'follow' && action !== 'unfollow')
    : findForcedDisabledActions(text);
  if (affordance?.safety === 'payment') {
    forced.push(/checkout/iu.test(text) ? 'checkout' : 'pay');
  }
  if (affordance?.safety === 'destructive') {
    forced.push('delete');
  }
  return uniqueSortedStrings(forced);
}

function affordanceInputSummary(affordance = /** @type {any} */ ({})) {
  return (Array.isArray(affordance.inputs) ? affordance.inputs : [])
    .flatMap((input) => [
      input?.name,
      input?.type,
      input?.label,
      input?.placeholder,
      input?.selector,
    ])
    .filter(Boolean)
    .join(' ');
}

function affordanceActionText(affordance = /** @type {any} */ ({})) {
  return [
    affordance?.kind,
    affordance?.label,
    affordance?.text,
    affordance?.ariaLabel,
    affordance?.name,
    affordance?.method,
    affordance?.endpoint,
    affordance?.href,
    affordance?.selector,
    affordance?.semanticKind,
    affordance?.structureType,
    affordance?.safety,
    affordanceInputSummary(affordance),
  ].filter(Boolean).join(' ');
}

function restrictAffordancePersistentText(context, affordance = /** @type {any} */ ({})) {
  return isAuthenticatedSourceLayer(affordance?.sourceLayer)
    || (context.options?.privacy === 'strict' && affordance?.providerId === 'browser_bridge');
}

function affordancePersistentLabel(context, affordance = /** @type {any} */ ({})) {
  if (restrictAffordancePersistentText(context, affordance)) {
    return null;
  }
  return String(
    affordance?.label
    ?? affordance?.text
    ?? affordance?.ariaLabel
    ?? affordance?.name
    ?? '',
  ).trim() || null;
}

function affordancePersistentEvidence(context, affordance = /** @type {any} */ ({}), blockedAction = 'action') {
  if (!restrictAffordancePersistentText(context, affordance)) {
    return affordance?.evidence ?? [];
  }
  return [
    buildEvidence({
      type: 'text',
      source: affordance?.nodeId ?? 'authenticated-control',
      text: `Authenticated ${blockedActionDisplayLabel(blockedAction)} control label redacted; only disabled safety boundary metadata persisted.`,
      confidence: Math.min(0.7, Number(affordance?.confidence ?? 0.55) || 0.55),
    }),
  ];
}

function affordancePersistentInputs(context, affordance = /** @type {any} */ ({})) {
  return restrictAffordancePersistentText(context, affordance) ? [] : (affordance?.inputs ?? []);
}

function affordancePersistentSelector(context, affordance = /** @type {any} */ ({})) {
  return restrictAffordancePersistentText(context, affordance) ? null : (affordance?.selector ?? null);
}

function affordancePersistentEndpoint(context, affordance = /** @type {any} */ ({})) {
  return restrictAffordancePersistentText(context, affordance) ? null : (affordance?.endpoint ?? null);
}

function isReadOnlyNavigationAffordance(affordance = /** @type {any} */ ({})) {
  const kind = String(affordance?.kind ?? '').toLowerCase();
  const semanticKind = String(affordance?.semanticKind ?? '').toLowerCase();
  const structureType = String(affordance?.structureType ?? '').toLowerCase();
  return affordance?.safety === 'read_only'
    || kind === 'link'
    || semanticKind === 'navigation'
    || structureType.includes('navigation');
}

function isSearchLikeWriteAffordance(affordance = /** @type {any} */ ({})) {
  const text = affordanceActionText(affordance).toLowerCase();
  return /\b(?:search|query|keyword|keywords|find|lookup|soushu|so|q)\b|searchkey|\u641c\u7d22|\u641c\u4e66|\u53ef\u641c|\u4e66\u540d|\u4f5c\u8005|\u5173\u952e\u8bcd/u.test(text);
}

function writeActionForAffordance(affordance) {
  const text = affordanceActionText(affordance).toLowerCase();
  if (!text || isReadOnlyFollowSurface(affordance) || ['payment', 'destructive'].includes(String(affordance?.safety ?? ''))) {
    return null;
  }
  if (isReadOnlyNavigationAffordance(affordance)) {
    return null;
  }
  if (affordance?.kind === 'form' && isSearchLikeWriteAffordance(affordance)) {
    return null;
  }
  if (affordance?.kind === 'upload' || /\bupload\b|\u4e0a\u4f20/u.test(text)) return 'upload';
  if (/\bpublish(?:\s+post)?\b|\u53d1\u5e03|\u53d1\u5e16|\u53d1\u52a8\u6001|\u53d1\u5fae\u535a/u.test(text)) return 'publish';
  if (/\b(?:comment|reply)\b|\u8bc4\u8bba|\u56de\u590d/u.test(text)) return 'publish_reply';
  if (/\b(?:send\s+dm|direct\s+message|private\s+message)\b|\u53d1\u9001\u79c1\u4fe1|\u79c1\u4fe1/u.test(text)) return 'send_dm';
  if (/\bsend\b|\u53d1\u9001/u.test(text)) return 'send';
  if (/\bunfollow\b|\u53d6\u6d88\u5173\u6ce8|\u53d6\u5173/u.test(text)) return 'unfollow';
  if (/\bfollow\b|\u5173\u6ce8/u.test(text)) return 'follow';
  if (/\blike\b|\u70b9\u8d5e/u.test(text)) return 'like';
  if (/\brepost\b|\bretweet\b|\u8f6c\u53d1/u.test(text)) return 'repost';
  if (/\bchange[-_\s]?password\b|\u4fee\u6539\u5bc6\u7801|\u66f4\u6539\u5bc6\u7801/u.test(text)) return 'change_password';
  if (affordance?.kind === 'form' && affordance?.safety === 'state_changing') return 'submit';
  return null;
}

function capabilityActionForBlockedAction(action) {
  if (action === 'pay' || action === 'checkout' || action === 'purchase' || action === 'change_payment') return 'purchase';
  if (action === 'upload') return 'upload';
  if (action === 'publish' || action === 'publish_reply' || action === 'send' || action === 'send_dm' || action === 'submit') return 'submit';
  if (action === 'follow' || action === 'unfollow' || action === 'like' || action === 'repost') return 'submit';
  return 'manage';
}

function blockedActionDisplayLabel(action) {
  const labels = {
    checkout: 'checkout',
    change_payment: 'change payment',
    change_password: 'change password',
    clear: 'clear',
    destroy: 'destroy',
    delete: 'delete',
    empty: 'empty',
    erase: 'erase',
    overwrite: 'overwrite',
    pay: 'pay',
    publish: 'publish',
    publish_reply: 'publish reply',
    purchase: 'purchase',
    purge: 'purge',
    repost: 'repost',
    reset: 'reset',
    revoke: 'revoke',
    send: 'send',
    send_dm: 'send direct message',
    submit: 'submit form',
    follow: 'follow',
    unfollow: 'unfollow',
    like: 'like',
    upload: 'upload',
    void: 'void',
  };
  return labels[action] ?? String(action ?? 'high risk action').replace(/_/gu, ' ');
}

function addDisabledRiskCapabilities(context, capabilities, affordances = /** @type {any[]} */ ([])) {
  const seen = new Set(capabilities.map((capability) => capability.id));
  for (const affordance of affordances) {
    const blockedActions = disabledActionForAffordance(affordance);
    for (const blockedAction of blockedActions) {
      const name = `disabled ${blockedAction.replace(/_/gu, ' ')} action`;
      const id = stableCapabilityId(context.site.id, name);
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      const blockedLabel = blockedActionDisplayLabel(blockedAction);
      const sourceLabel = affordancePersistentLabel(context, affordance);
      const displayLabel = sourceLabel || blockedLabel;
      const capability = makeCapability(context, {
        name,
        description: 'Runtime policy keeps this payment or destructive action visible as blocked and non-executable by default.',
        action: capabilityActionForBlockedAction(blockedAction),
        object: 'high-risk action',
        userValue: `Blocked payment or destructive action: ${displayLabel}`,
        entryNodeIds: affordance?.nodeId ? [affordance.nodeId] : [],
        requiredNodeIds: affordance?.nodeId ? [affordance.nodeId] : [],
        inputs: affordancePersistentInputs(context, affordance),
        outputs: [{ name: 'blocked_action', type: 'safety_boundary' }],
        safetyLevel: blockedAction === 'pay' || blockedAction === 'checkout' || blockedAction === 'purchase' || blockedAction === 'change_payment'
          ? 'payment'
          : 'destructive',
        evidence: affordancePersistentEvidence(context, affordance, blockedAction),
        confidence: Math.min(0.7, Number(affordance?.confidence ?? 0.5) || 0.5),
        status: 'disabled',
        informational: true,
        blockedAction,
        sourceLabel: sourceLabel || null,
        activationBlockedReason: 'forced-action-disabled',
        intents: [
          ...(sourceLabel ? [{
            canonicalUtterance: sourceLabel,
            utteranceExamples: [sourceLabel],
            invocationScore: 1.2,
          }] : []),
          ...(sourceLabel && ['follow', 'unfollow'].includes(blockedAction) ? [
            {
              canonicalUtterance: `${sourceLabel}\u8d26\u53f7`,
              utteranceExamples: [`${sourceLabel}\u8d26\u53f7`],
              invocationScore: 1.2,
            },
            {
              canonicalUtterance: `${sourceLabel}\u7528\u6237`,
              utteranceExamples: [`${sourceLabel}\u7528\u6237`],
              invocationScore: 1.2,
            },
          ] : []),
          `why ${blockedLabel} is blocked`,
          `${blockedLabel} safety boundary`,
          `keep ${blockedLabel} blocked`,
        ],
      });
      capability.executionPlan = buildExecutionPlan(capability.id, {
        mode: 'dry_run',
        dryRunOnly: true,
        requiresConfirmation: true,
        autoExecute: false,
        governedExecution: true,
        executionDisposition: 'blocked',
        steps: [{
          kind: 'governed_action_contract',
          action: blockedAction,
          nodeId: affordance?.nodeId ?? null,
          endpoint: affordancePersistentEndpoint(context, affordance),
          method: affordance?.method ?? null,
          submit: false,
          finalSubmit: false,
          autoExecute: false,
          governedExecution: true,
          executionDisposition: 'blocked',
          savedMaterial: SANITIZED_SUMMARY_ONLY,
        }],
      });
      capabilities.push(capability);
    }
    if (blockedActions.length > 0) {
      continue;
    }
    const writeAction = writeActionForAffordance(affordance);
    if (!writeAction) {
      continue;
    }
    const sourceLabel = affordancePersistentLabel(context, affordance);
    const actionLabel = blockedActionDisplayLabel(writeAction);
    const displayLabel = sourceLabel || actionLabel;
    const name = `${writeAction.replace(/_/gu, ' ')} action`;
    const id = stableCapabilityId(context.site.id, `${name}:${displayLabel}`);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const capability = makeCapability(context, {
      name,
      description: 'Compile this site write control as a directly callable runtime action.',
      action: capabilityActionForBlockedAction(writeAction),
      object: displayLabel,
      userValue: displayLabel,
      entryNodeIds: affordance?.nodeId ? [affordance.nodeId] : [],
      requiredNodeIds: affordance?.nodeId ? [affordance.nodeId] : [],
      inputs: affordancePersistentInputs(context, affordance),
      outputs: [{ name: 'action_result', type: 'runtime_action_result' }],
      safetyLevel: 'state_changing',
      evidence: affordancePersistentEvidence(context, affordance, writeAction),
      confidence: Math.min(0.78, Number(affordance?.confidence ?? 0.62) || 0.62),
      status: 'active',
      informational: false,
      intentAction: writeAction,
      sourceLabel: sourceLabel || null,
      intents: [
        ...(sourceLabel ? [sourceLabel] : []),
        ...(sourceLabel && ['follow', 'unfollow'].includes(writeAction) ? [
          `${sourceLabel}\u8d26\u53f7`,
          `${sourceLabel}\u7528\u6237`,
        ] : []),
        actionLabel,
        `${actionLabel} action`,
      ],
    });
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'action',
      dryRunOnly: false,
      requiresConfirmation: false,
      autoExecute: false,
      governedExecution: false,
      executionDisposition: 'allow',
      steps: [{
        kind: 'site_action',
        action: writeAction,
        nodeId: affordance?.nodeId ?? null,
        selector: affordancePersistentSelector(context, affordance),
        endpoint: affordancePersistentEndpoint(context, affordance),
        method: affordance?.method ?? null,
        submit: true,
        finalSubmit: false,
        upload: writeAction === 'upload',
        autoExecute: false,
        governedExecution: false,
        executionDisposition: 'allow',
        savedMaterial: SANITIZED_SUMMARY_ONLY,
      }],
    });
    capabilities.push(capability);
  }
}

function knownPolicyPageTypes(context) {
  return new Set(context.setupProfile?.knownSitePolicy?.pageTypes ?? []);
}

function knownPolicySupportedIntents(context) {
  return new Set(context.setupProfile?.knownSitePolicy?.supportedIntents ?? []);
}

const sitePolicyConfigCache = new Map();

function readSitePolicyConfigFile(cwd, relativePath) {
  const fullPath = path.resolve(cwd, relativePath);
  if (sitePolicyConfigCache.has(fullPath)) {
    return sitePolicyConfigCache.get(fullPath);
  }
  try {
    const parsed = JSON.parse(readFileSync(fullPath, 'utf8'));
    sitePolicyConfigCache.set(fullPath, parsed);
    return parsed;
  } catch {
    sitePolicyConfigCache.set(fullPath, null);
    return null;
  }
}

function hostForSitePolicy(context = /** @type {any} */ ({})) {
  try {
    return new URL(context.site?.rootUrl ?? context.site?.normalizedUrl ?? context.site?.inputUrl).hostname;
  } catch {
    return null;
  }
}

function configuredSiteDisabledActionKinds(context) {
  const cwd = context.options?.cwd ?? process.cwd();
  const host = hostForSitePolicy(context);
  if (!host) {
    return [];
  }
  const capabilityConfig = readSitePolicyConfigFile(cwd, 'config/site-capabilities.json');
  const registryConfig = readSitePolicyConfigFile(cwd, 'config/site-registry.json');
  return [
    ...(capabilityConfig?.sites?.[host]?.disabledActionKinds ?? []),
    ...(registryConfig?.sites?.[host]?.disabledActionKinds ?? []),
  ];
}

function knownPolicyDisabledActionKinds(context) {
  return new Set([
    ...(context.setupProfile?.knownSitePolicy?.disabledActionKinds ?? []),
    ...configuredSiteDisabledActionKinds(context),
  ]
    .map((value) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, ''))
    .filter(Boolean));
}

const SITE_POLICY_DISABLED_ACTION_PATTERNS = Object.freeze({
  change_2fa: /\bchange account 2fa\b|\bchange 2fa\b|\bchange mfa\b/iu,
  change_email: /\bchange account email\b|\bchange email\b/iu,
  change_password: /\bchange account password\b|\bchange password\b/iu,
  change_payment: /\bchange payment settings\b|\bchange payment\b|\bpayment settings\b/iu,
  change_security_settings: /\bchange account security settings\b|\bchange account settings\b|\baccount settings\b|\bsecurity settings\b/iu,
  create_dm_draft: /\bcreate direct message draft\b|\bcreate dm draft\b/iu,
  create_post_draft: /\bcreate post draft\b|\bdraft post\b|\bdraft quote post\b|\bquote[-_\s]?post draft\b|\bpost draft\b/iu,
  create_reply_draft: /\bcreate reply draft\b/iu,
  delete: /\bdelete\b/iu,
  edit_profile: /\bedit profile\b/iu,
  follow: /\bfollow user\b|\bfollow account\b|\bfollow action\b/iu,
  like: /\blike post\b|\blike action\b/iu,
  payment: /\bpayment\b|\bpay\b|\bcheckout\b|\bpurchase\b/iu,
  publish: /\bpublish post\b|\bpublish action\b|\bpublish\b|\u53d1\u5e16/iu,
  publish_reply: /\bpublish reply\b/iu,
  read_dm: /\bread direct message\b|\bread dm\b|\bdirect message detail\b|\bdirect message conversation\b/iu,
  repost: /\brepost post\b|\brepost action\b/iu,
  send_dm: /\bsend direct message\b|\bsend dm\b/iu,
  unfollow: /\bunfollow user\b|\bunfollow account\b/iu,
  upload: /\bupload\b/iu,
});

function capabilityTextForSitePolicy(capability = /** @type {any} */ ({})) {
  const executionPlan = capability.executionPlan ?? capability.execution_plan ?? {};
  const steps = Array.isArray(executionPlan.steps) ? executionPlan.steps : [];
  return [
    capability.name,
    capability.action,
    capability.intentAction,
    capability.object,
    capability.description,
    capability.userValue,
    capability.setupCapabilityId,
    capability.blockedAction,
    capability.safetyLevel,
    ...steps.flatMap((step) => [
      step?.kind,
      step?.action,
      step?.operation,
      step?.operationKind,
      step?.submit === true ? 'submit' : null,
      step?.upload === true ? 'upload' : null,
    ]),
  ].filter(Boolean).join(' ');
}

function sitePolicyDisabledActionsForCapability(context, capability = /** @type {any} */ ({})) {
  const configured = knownPolicyDisabledActionKinds(context);
  if (!configured.size) {
    return [];
  }
  const text = capabilityTextForSitePolicy(capability);
  const hits = [];
  for (const action of configured) {
    const pattern = SITE_POLICY_DISABLED_ACTION_PATTERNS[action];
    if (pattern?.test(text)) {
      hits.push(action);
    }
  }
  return uniqueSortedStrings(hits);
}

function applyKnownSiteDisabledActionPolicy(context, capability = /** @type {any} */ ({})) {
  const sitePolicyDisabledActions = sitePolicyDisabledActionsForCapability(context, capability);
  if (!sitePolicyDisabledActions.length) {
    return capability;
  }
  return {
    ...capability,
    status: 'disabled',
    enabled: false,
    sitePolicyDisabled: true,
    sitePolicyDisabledActions,
    activationBlockedReason: 'site-policy-disabled-action',
    disabledReason: 'site-policy-disabled-action',
    default_policy: 'disabled',
    enabled_status: 'disabled',
    executionDisposition: 'blocked',
    executionDisabledByDefault: true,
    disabledByPolicy: true,
    runtimeCallable: false,
    autoExecutable: false,
    planCallable: false,
  };
}

function knownPolicyCapabilityFamilies(context) {
  return new Set(context.setupProfile?.knownSitePolicy?.capabilityFamilies ?? []);
}

function knownPolicyDownloadReasonCode(context) {
  const policy = context.setupProfile?.knownSitePolicy ?? {};
  return policy.downloader?.reasonCode
    ?? policy.downloader?.unsupportedLiveReasonCode
    ?? policy.downloadSupport?.reasonCode
    ?? policy.downloadSupport?.unsupportedLiveReasonCode
    ?? 'site-adapter-required';
}

function knownPolicyChapterDownloaderDescriptor(context) {
  const policy = context.setupProfile?.knownSitePolicy ?? {};
  return {
    material: 'descriptor_only',
    siteKey: policy.siteKey ?? context.skillId ?? context.site?.id ?? null,
    adapterId: policy.adapterId ?? 'chapter-content',
    taskType: 'book',
    entrypoint: policy.downloadEntrypoint ?? 'src/sites/known-sites/chapter-content/download/python/book.py',
    scriptLanguage: policy.scriptLanguage ?? 'python',
    interpreter: policy.interpreterRequired ?? 'pypy3',
    sessionRequirement: policy.downloadSessionRequirement ?? 'none',
    acceptsBookTitle: true,
    acceptsBookUrl: true,
    acceptsSearchResult: true,
    inputSlots: ['book_title', 'book_url', 'output_dir'],
    outputFields: ['downloadFile', 'manifestPath', 'chapterCount', 'finalUrl'],
    networkResolveAllowedAtRuntime: true,
    reportMaterial: SANITIZED_SUMMARY_ONLY,
    savedMaterial: SANITIZED_SUMMARY_ONLY,
    artifactMaterial: 'public_chapter_text_txt',
    bodyTextPersistence: 'download_artifact_only',
    redactionRequired: true,
  };
}

function knownPolicySupportsBookDownload(context) {
  const policy = context.setupProfile?.knownSitePolicy ?? {};
  if (!knownPolicyCapabilityFamilies(context).has('download-content')) {
    return false;
  }
  if (policy.downloadSupport?.supported === false) {
    return false;
  }
  const blockedTaskTypes = new Set(policy.downloadSupport?.blockedTaskTypes ?? []);
  if (blockedTaskTypes.has('book')) {
    return false;
  }
  const declaredTaskTypes = [
    ...(policy.downloadTaskTypes ?? []),
    ...(policy.downloadSupport?.taskTypes ?? []),
    ...(policy.downloadSupport?.availableTaskTypes ?? []),
  ];
  return declaredTaskTypes.length === 0 || declaredTaskTypes.includes('book');
}

function knownPolicySupportsCatalogDownload(context) {
  const policy = context.setupProfile?.knownSitePolicy ?? {};
  if (!knownPolicyCapabilityFamilies(context).has('download-content')) {
    return false;
  }
  const downloadPolicy = policy.downloadSupport ?? policy.downloader ?? {};
  if (downloadPolicy?.supported === false) {
    return false;
  }
  const declaredTaskTypes = [
    ...(policy.downloadTaskTypes ?? []),
    ...(policy.declaredDownloadTaskTypes ?? []),
    ...(downloadPolicy?.taskTypes ?? []),
    ...(downloadPolicy?.declaredTaskTypes ?? []),
  ].filter(Boolean);
  const availableTaskTypes = [
    ...(policy.availableDownloadTaskTypes ?? []),
    ...(downloadPolicy?.availableTaskTypes ?? []),
  ].filter(Boolean);
  const blockedTaskTypes = new Set([
    ...(policy.blockedDownloadTaskTypes ?? []),
    ...(downloadPolicy?.blockedTaskTypes ?? []),
  ].filter(Boolean));
  if (declaredTaskTypes.length && declaredTaskTypes.every((taskType) => blockedTaskTypes.has(taskType))) {
    return false;
  }
  if (declaredTaskTypes.length && availableTaskTypes.length === 0 && blockedTaskTypes.size > 0) {
    return false;
  }
  return true;
}

function siteContextText(context = /** @type {any} */ ({}), nodes = /** @type {any[]} */ ([])) {
  const site = context.site ?? {};
  const policy = context.setupProfile?.knownSitePolicy ?? {};
  return [
    site.rootUrl,
    site.requestedUrl,
    site.finalUrl,
    policy.siteArchetype,
    policy.primaryArchetype,
    policy.adapterId,
    policy.siteKey,
    ...(policy.pageTypes ?? []),
    ...(policy.capabilityFamilies ?? []),
    ...nodes.slice(0, 20).map((node) => `${node.normalizedUrl ?? node.routePattern ?? ''} ${node.title ?? ''} ${node.textSummary ?? ''}`),
  ].join(' ').toLowerCase();
}

function classificationCount(nodes = /** @type {any[]} */ ([]), pattern) {
  return nodes.reduce((count, node) => count + (pattern.test(String(node.classification ?? '')) ? 1 : 0), 0);
}

function isRepositoryCoverageSite(context, nodes = /** @type {any[]} */ ([])) {
  const text = siteContextText(context, nodes);
  if (/github|gitlab|sourceforge|bitbucket|repository|repositories|\brepos?\b|source-code|source code|open-source|open source|code search/u.test(text)) {
    return true;
  }
  const repositoryListCount = classificationCount(nodes, /^repository_list$/u);
  const repositoryDetailCount = classificationCount(nodes, /^repository_detail$/u);
  return repositoryListCount >= 1 && repositoryDetailCount >= 2 && /repository|repositories|\brepos?\b/u.test(text);
}

function isNewsCoverageSite(context, nodes = /** @type {any[]} */ ([]), homepage = null) {
  const text = siteContextText(context, [homepage, ...nodes].filter(Boolean));
  const explicitNewsContext = /(^|[./-])news([./-]|$)|newspaper|article|articles|新闻|资讯/u.test(text);
  const newsCount = classificationCount(nodes, /^(news_channel|article_list|article_detail)$/u);
  const catalogOrWorkCount = classificationCount(nodes, /^(catalog_|book_|work_|product_|chapter_)/u);
  const repositoryCount = classificationCount(nodes, /^repository_/u);
  if (repositoryCount > 0 && isRepositoryCoverageSite(context, nodes)) {
    return false;
  }
  if (explicitNewsContext) {
    return true;
  }
  return newsCount >= 2 && newsCount > catalogOrWorkCount;
}

function selectedSetupCapabilityIds(context) {
  return new Set((context.setupProfile?.capabilityScope?.selectedCapabilities ?? [])
    .map((capability) => normalizeSetupCapabilityId(capability.id ?? capability.name))
    .filter(Boolean));
}

function userAuthorizedCapabilityProofs(context) {
  const evidence = context.setupProfile?.userAuthorizedEvidence;
  return Array.isArray(evidence?.capabilityProofs) ? evidence.capabilityProofs : [];
}

function findCapabilityProof(context, setupCapabilityId, intentAction) {
  const wanted = new Set([
    normalizeSetupCapabilityId(setupCapabilityId),
    normalizeSetupCapabilityId(intentAction),
  ].filter(Boolean));
  return userAuthorizedCapabilityProofs(context).find((proof) => {
    if (!proof || proof.status !== 'verified') {
      return false;
    }
    const sampleCount = Number(proof.sampleCount ?? proof.itemCount ?? proof.evidenceCount ?? 0);
    if (!Number.isFinite(sampleCount) || sampleCount < 1) {
      return false;
    }
    const proofIds = [
      proof.capabilityId,
      proof.setupCapabilityId,
      proof.intentType,
      proof.action,
    ].map(normalizeSetupCapabilityId).filter(Boolean);
    return proofIds.some((id) => wanted.has(id));
  }) ?? null;
}

function userAuthorizedBrowserSeedCapabilityIds(context) {
  const seeds = context.setupProfile?.userAuthorizedEvidence?.browserSeeds;
  const ids = new Set();
  for (const seed of Array.isArray(seeds) ? seeds : []) {
    for (const value of [
      seed?.capabilityId,
      seed?.setupCapabilityId,
      seed?.intentType,
      seed?.action,
      ...(Array.isArray(seed?.capabilityIds) ? seed.capabilityIds : []),
    ]) {
      const normalized = normalizeSetupCapabilityId(value);
      if (normalized) {
        ids.add(normalized);
      }
    }
  }
  return ids;
}

function isCatalogCoverageSite(context, pageNodes = /** @type {any[]} */ ([]), routeNodes = /** @type {any[]} */ ([])) {
  const policy = context.setupProfile?.knownSitePolicy ?? {};
  const pageTypes = knownPolicyPageTypes(context);
  const families = knownPolicyCapabilityFamilies(context);
  const policySignals = [
    policy.siteArchetype,
    policy.primaryArchetype,
    policy.siteKey,
    policy.adapterId,
    ...pageTypes,
    ...families,
  ].join(' ').toLowerCase();
  if (/catalog|author|category|tag|video|book|product/u.test(policySignals)) {
    return true;
  }
  const nodes = [...pageNodes, ...routeNodes];
  if (isRepositoryCoverageSite(context, nodes)) {
    return false;
  }
  const hasCatalogSpecificEvidence = nodes.some((node) => (
    /^(catalog_(category|tag|collection|topic|release|event|pagination|detail)|product_|book_)|^chapter_detail$/u
      .test(String(node.classification ?? ''))
  ));
  if (isNewsCoverageSite(context, nodes) && !hasCatalogSpecificEvidence) {
    return false;
  }
  return hasCatalogSpecificEvidence;
}

function hasChapterContentCoverageSignals(nodes = /** @type {any[]} */ ([])) {
  const classifications = nodes.map((node) => String(node.classification ?? ''));
  if (classifications.includes('chapter_detail')) {
    return true;
  }
  if (!classifications.includes('chapter_content_home')) {
    return false;
  }
  const bookSignals = classifications.filter((classification) => [
    'chapter_content_home',
    'book_category_list',
    'book_ranking_list',
    'book_collection_list',
    'book_search_results',
    'book_search_form',
    'book_detail',
  ].includes(classification));
  return bookSignals.length >= 2;
}

function catalogCoverageNodes(pageNodes = /** @type {any[]} */ ([]), routeNodes = /** @type {any[]} */ ([]), classifications = /** @type {any[]} */ ([])) {
  const wanted = new Set(classifications);
  return [...pageNodes, ...routeNodes]
    .filter((node) => wanted.has(node.classification))
    .filter((node) => !isPublicUtilityRouteNode(node))
    .sort((left, right) => String(left.normalizedUrl ?? left.routePattern ?? left.id).localeCompare(
      String(right.normalizedUrl ?? right.routePattern ?? right.id),
      'en',
    ));
}

function catalogCoverageEvidence(context, nodes = /** @type {any[]} */ ([]), label = 'catalog coverage') {
  const evidence = nodes.flatMap((node) => Array.isArray(node.evidence) ? node.evidence : []).slice(0, 8);
  if (evidence.length) {
    return evidence;
  }
  return [
    buildEvidence({
      type: 'text',
      source: context.site.rootUrl,
      text: `${label} inferred from sanitized route and site policy evidence; raw page content was not persisted.`,
      confidence: 0.58,
    }),
  ];
}

function catalogCoverageSteps(nodes = /** @type {any[]} */ ([])) {
  return nodes.slice(0, 12).map((node) => {
    if (node.normalizedUrl) {
      return { kind: 'navigate', url: node.normalizedUrl, nodeId: node.id };
    }
    return {
      kind: 'route_template',
      routeTemplate: node.routePattern ?? node.routeTemplate,
      nodeId: node.id,
    };
  });
}

function catalogRouteOnlySteps(nodes = /** @type {any[]} */ ([])) {
  return nodes.slice(0, 12).map((node) => ({
    kind: 'route_template',
    routeTemplate: node.routePattern ?? node.routeTemplate ?? null,
    routePath: node.normalizedUrl ?? node.url ?? null,
    nodeId: node.id,
  }));
}

function catalogCoverageRouteState(nodes = /** @type {any[]} */ ([])) {
  const candidates = (Array.isArray(nodes) ? nodes : [])
    .map((node, index) => {
      const routeTemplate = node.routeTemplate ?? node.routePattern ?? null;
      const routePath = node.routePath ?? node.normalizedUrl ?? node.url ?? null;
      const tabState = node.tabState ?? node.routeState?.tabState ?? null;
      const pageKind = node.pageType ?? node.routeState?.pageKind ?? node.routeState?.pageType ?? node.classification ?? null;
      let score = 0;
      if (routeTemplate) score += 8;
      if (routePath) score += 4;
      if (tabState) score += 3;
      if (pageKind) score += 2;
      if (node.type === 'page') score += 2;
      if (node.type === 'route_template') score += 1;
      return {
        node,
        index,
        score,
        routeTemplate,
        routePath,
        tabState,
        pageKind,
      };
    })
    .filter((candidate) => candidate.routeTemplate || candidate.routePath)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = candidates[0];
  if (!selected) {
    return null;
  }
  const stateId = [
    selected.pageKind ?? 'catalog',
    selected.routeTemplate ?? selected.routePath ?? 'route',
    selected.tabState ?? 'default',
  ].join(':').toLowerCase().replace(/[^a-z0-9:]+/gu, '-').replace(/-+/gu, '-').replace(/^-+|-+$/gu, '');
  return {
    source: 'catalog-route-state-model',
    stateId,
    routeTemplate: selected.routeTemplate,
    routePath: selected.routePath,
    tabState: selected.tabState,
    pageKind: selected.pageKind,
    pageType: selected.pageKind,
  };
}

function addCatalogCoverageCapability(context, capabilities, {
  name,
  description,
  object,
  userValue,
  nodes,
  outputs,
  intents,
  confidence = 0.72,
  status = 'active',
  action = 'view',
  informational = false,
  activationBlockedReason = null,
  riskLevel = 'read_public_low',
  evidenceModel = 'public_structure',
  publicRouteOnly = false,
  allowRouteOnlyEvidence = false,
  semanticPriority = 0,
}) {
  if (!Array.isArray(nodes) || !nodes.length) {
    return;
  }
  const routeState = catalogCoverageRouteState(nodes);
  const hasStructureEvidence = nodes.some((node) => nodeHasPublicStructureEvidence(node));
  const canUseRouteOnlyEvidence = (
    status === 'active'
    && allowRouteOnlyEvidence === true
    && !hasStructureEvidence
    && /^(browse|open|view)\b/u.test(String(name ?? '').toLowerCase())
    && !/\b(?:read|metadata|summary|summarize)\b/u.test(String(name ?? '').toLowerCase())
    && nodes.some((node) => nodeHasRouteOnlyPublicEvidence(node))
    && nodes.some((node) => ['page', 'route', 'route_template'].includes(node.type) || node.normalizedUrl || node.routePattern || node.routeTemplate)
  );
  const resolvedEvidenceModel = canUseRouteOnlyEvidence ? 'public_route_navigation' : evidenceModel;
  const resolvedPublicRouteOnly = publicRouteOnly || canUseRouteOnlyEvidence;
  const resolvedOutputs = canUseRouteOnlyEvidence
    ? [{ name: 'routes', type: 'route_summary' }]
    : outputs;
  const capability = makeCapability(context, {
    name,
    description,
    action,
    object,
    userValue,
    entryNodeIds: nodes.slice(0, 20).map((node) => node.id),
    requiredNodeIds: status === 'active' ? nodes.slice(0, 20).map((node) => node.id) : [],
    outputs: resolvedOutputs,
    safetyLevel: 'read_only',
    evidence: catalogCoverageEvidence(context, nodes, name),
    confidence,
    status,
    informational,
    autoGenerated: true,
    category: 'catalog',
    risk_level: riskLevel,
    enabled_status: status === 'active' ? 'enabled' : 'disabled',
    evidence_status: status === 'active' ? 'verified' : 'disabled',
    default_policy: status === 'active' ? 'read_only' : 'disabled',
    evidenceModel: resolvedEvidenceModel,
    publicRouteOnly: resolvedPublicRouteOnly,
    ...(semanticPriority ? { semanticPriority } : {}),
    routeTemplate: routeState?.routeTemplate ?? null,
    routePath: routeState?.routePath ?? null,
    routeState,
    routeStateId: routeState?.stateId ?? null,
    tabState: routeState?.tabState ?? null,
    pageKind: routeState?.pageKind ?? null,
    intents,
    ...(activationBlockedReason ? { activationBlockedReason } : {}),
  });
  if (status === 'active' && !informational && riskLevel === 'download_high') {
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'download',
      dryRunOnly: false,
      requiresConfirmation: false,
      autoExecute: false,
      governedExecution: false,
      executionDisposition: 'allow',
      steps: [{
        kind: 'downloader_task_descriptor',
        nodeIds: nodes.slice(0, 20).map((node) => node.id),
        routeTemplate: routeState?.routeTemplate ?? null,
        routePath: routeState?.routePath ?? null,
        submit: true,
        finalSubmit: false,
        autoExecute: false,
        governedExecution: false,
        executionDisposition: 'allow',
        savedMaterial: SANITIZED_SUMMARY_ONLY,
      }],
    });
  } else if (status === 'active' && !informational) {
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'read_only',
      steps: canUseRouteOnlyEvidence ? catalogRouteOnlySteps(nodes) : catalogCoverageSteps(nodes),
    });
  } else if (riskLevel === 'download_high') {
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'download',
      dryRunOnly: false,
      requiresConfirmation: false,
      autoExecute: false,
      governedExecution: false,
      executionDisposition: 'allow',
      steps: [{
        kind: 'downloader_task_descriptor',
        nodeIds: nodes.slice(0, 20).map((node) => node.id),
        routeTemplate: routeState?.routeTemplate ?? null,
        routePath: routeState?.routePath ?? null,
        submit: true,
        finalSubmit: false,
        autoExecute: false,
        governedExecution: false,
        executionDisposition: 'allow',
        savedMaterial: SANITIZED_SUMMARY_ONLY,
      }],
    });
  }
  capabilities.push(capability);
}

function publicReadableNodes(graph, classifications = /** @type {any[]} */ ([])) {
  const wanted = new Set(classifications);
  return (graph?.nodes ?? [])
    .filter((node) => !node.authRequired && isPublicReadSourceLayer(nodeSourceLayer(node)))
    .filter((node) => wanted.size === 0 || wanted.has(node.classification))
    .filter((node) => ['page', 'content', 'operation', 'route', 'route_template', 'form', 'menu', 'tab', 'component'].includes(node.type))
    .filter((node) => node.classification === 'homepage' || !isPublicUtilityRouteNode(node))
    .sort((left, right) => String(left.normalizedUrl ?? left.routePattern ?? left.id).localeCompare(
      String(right.normalizedUrl ?? right.routePattern ?? right.id),
      'en',
    ));
}

function nodeHasRouteOnlyPublicEvidence(node = /** @type {any} */ ({})) {
  return ['link_route_template', 'link_semantic_route_template', 'route_seed_only', 'policy_route_template'].includes(node.evidenceStatus)
    || ['public_rendered_route_seed_only', 'policy_route_template'].includes(node.publicEvidenceStatus);
}

function hasActiveAggregateRouteOnlyCapability(capabilities = /** @type {any[]} */ ([])) {
  return capabilities.some((capability) => (
    capability?.status === 'active'
    && capability.publicRouteOnly === true
    && !/^open public route\b/u.test(String(capability.name ?? '').toLowerCase())
    && !String(capability.id ?? '').includes(':open-public-route-')
  ));
}

function authenticatedReadRouteTargetSet(context = /** @type {any} */ ({})) {
  const targets = context.crawlContract?.coverageTargets ?? {};
  return new Set([
    ...(targets.authRoutes ?? []),
    ...(targets.publicRevisitRoutes ?? []),
  ].map((value) => {
    try {
      return normalizeUrl(value, context.site.rootUrl);
    } catch {
      return null;
    }
  }).filter(Boolean));
}

function isAuthenticatedReadRiskRoute(node = /** @type {any} */ ({})) {
  const text = [
    node.normalizedUrl,
    node.url,
    node.routePattern,
    node.routeTemplate,
    node.title,
    node.textSummary,
    node.classification,
  ].join(' ').toLowerCase();
  return /(?:^|[/:?\s])(?:wallet|pay|payment|checkout|cart|order|recharge|vip|member)(?=[/?#:\s]|$)|钱包|支付|付款|充值|订单/iu.test(text);
}

function hasAuthenticatedSanitizedStructureEvidence(node = /** @type {any} */ ({})) {
  return node.listPresent === true
    || node.emptyStatePresent === true
    || Number(node.visibleItemCount ?? 0) > 0;
}

function authenticatedNodeMatchesTarget(context, node, targetSet) {
  const normalizedUrl = node.normalizedUrl ? normalizeUrl(node.normalizedUrl, context.site.rootUrl) : null;
  if (normalizedUrl && targetSet.has(normalizedUrl)) {
    return true;
  }
  const routePattern = String(node.routePattern ?? node.routeTemplate ?? '').replace(/\/+$/u, '') || '/';
  return [...targetSet].some((target) => {
    try {
      const targetPath = new URL(target).pathname.replace(/\/+$/u, '') || '/';
      return targetPath === routePattern;
    } catch {
      return false;
    }
  });
}

function isBoundedAuthenticatedRouteNode(context, node, targetSet) {
  if (!['authenticated', 'authenticated_overlay'].includes(nodeSourceLayer(node))) {
    return false;
  }
  if (!['page', 'content', 'operation', 'route', 'route_template'].includes(node.type)) {
    return false;
  }
  if (isAuthenticatedReadRiskRoute(node)) {
    return false;
  }
  return authenticatedNodeMatchesTarget(context, node, targetSet);
}

function isBoundedAuthenticatedReadNode(context, node, targetSet) {
  if (!isBoundedAuthenticatedRouteNode(context, node, targetSet)) {
    return false;
  }
  if (!hasAuthenticatedSanitizedStructureEvidence(node)) {
    return false;
  }
  return true;
}

function isZhihuKnownSiteContext(context = /** @type {any} */ ({})) {
  const policy = context?.setupProfile?.knownSitePolicy ?? {};
  const siteKey = String(policy.siteKey ?? context?.site?.siteKey ?? '').trim().toLowerCase();
  const adapterId = String(policy.adapterId ?? context?.site?.adapterId ?? '').trim().toLowerCase();
  let host = '';
  try {
    host = new URL(context?.site?.rootUrl ?? context?.site?.normalizedUrl ?? '').hostname.toLowerCase();
  } catch {
    host = '';
  }
  return siteKey === 'zhihu'
    || adapterId === 'zhihu'
    || host === 'www.zhihu.com'
    || host === 'zhihu.com'
    || host.endsWith('.zhihu.com');
}

function addAuthenticatedReadCoverageCapabilities(context, capabilities, graph) {
  if (!canRunAuthenticatedLayer(context.authStateReport)) {
    return;
  }
  if (isZhihuKnownSiteContext(context)) {
    return;
  }
  const targetSet = authenticatedReadRouteTargetSet(context);
  if (!targetSet.size) {
    return;
  }
  const routeNodes = (graph?.nodes ?? [])
    .filter((node) => isBoundedAuthenticatedRouteNode(context, node, targetSet))
    .sort((left, right) => String(left.normalizedUrl ?? left.routePattern ?? left.id).localeCompare(
      String(right.normalizedUrl ?? right.routePattern ?? right.id),
      'en',
    ));
  const nodes = routeNodes.filter((node) => hasAuthenticatedSanitizedStructureEvidence(node));
  const routeOnlyNodes = routeNodes.filter((node) => !hasAuthenticatedSanitizedStructureEvidence(node));
  const byLayer = new Map([
    ['authenticated', nodes.filter((node) => nodeSourceLayer(node) === 'authenticated')],
    ['authenticated_overlay', nodes.filter((node) => nodeSourceLayer(node) === 'authenticated_overlay')],
  ]);
  for (const [layer, layerNodes] of byLayer) {
    if (!layerNodes.length) {
      continue;
    }
    const isOverlay = layer === 'authenticated_overlay';
    const name = isOverlay ? 'read authenticated overlay summaries' : 'read authenticated route summaries';
    if (hasCapabilityNamed(capabilities, name)) {
      continue;
    }
    const capability = makeCapability(context, {
      name,
      description: isOverlay
        ? 'Read only sanitized structural overlay summaries from configured authenticated revisits.'
        : 'Read only sanitized structural summaries from configured authenticated routes.',
      action: 'view',
      object: isOverlay ? 'authenticated overlay summaries' : 'authenticated route summaries',
      userValue: isOverlay ? '查看登录态 overlay 的脱敏结构摘要' : '查看登录态页面的脱敏结构摘要',
      entryNodeIds: layerNodes.slice(0, 20).map((node) => node.id),
      requiredNodeIds: layerNodes.slice(0, 20).map((node) => node.id),
      outputs: [{ name: 'summary', type: 'sanitized_summary' }],
      safetyLevel: 'read_only',
      evidence: layerNodes.flatMap((node) => node.evidence ?? []).slice(0, 8),
      confidence: 0.78,
      status: 'active',
      informational: false,
      sourceLayer: layer,
      authRequired: true,
      risk_level: 'read_personal_medium',
      enabled_status: 'enabled',
      default_policy: 'enabled',
      evidence_status: 'verified',
      saved_material: ['sanitized_summary_only'],
      raw_content_saved: false,
      private_content_saved: false,
      raw_dom_saved: false,
      raw_html_saved: false,
      cookie_material_saved: false,
      evidenceModel: 'authenticated_sanitized_structure',
      intents: isOverlay
        ? ['查看登录态覆盖摘要', 'read authenticated overlay summaries', 'show authenticated overlay structure']
        : ['查看登录态页面摘要', 'read authenticated route summaries', 'show authenticated route structure'],
    });
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'read_only',
      dryRunOnly: false,
      requiresConfirmation: false,
      autoExecute: false,
      steps: layerNodes.slice(0, 12).map((node) => ({
        kind: 'read_sanitized_summary',
        nodeId: node.id,
        routeTemplate: node.routeTemplate ?? node.routePattern ?? null,
        routePath: node.normalizedUrl ?? node.url ?? null,
        sourceLayer: layer,
        savedMaterial: 'sanitized_summary_only',
      })),
    });
    capabilities.push(capability);
  }
  const routeOnlyByLayer = new Map([
    ['authenticated', routeOnlyNodes.filter((node) => nodeSourceLayer(node) === 'authenticated')],
    ['authenticated_overlay', routeOnlyNodes.filter((node) => nodeSourceLayer(node) === 'authenticated_overlay')],
  ]);
  for (const [layer, layerNodes] of routeOnlyByLayer) {
    if (!layerNodes.length) {
      continue;
    }
    const isOverlay = layer === 'authenticated_overlay';
    const name = isOverlay ? 'open authenticated overlay routes' : 'open authenticated configured routes';
    if (hasCapabilityNamed(capabilities, name)) {
      continue;
    }
    const capability = makeCapability(context, {
      name,
      description: isOverlay
        ? 'Open configured authenticated revisit routes using only sanitized route-access evidence.'
        : 'Open configured authenticated routes using only sanitized route-access evidence.',
      action: 'view',
      object: isOverlay ? 'authenticated overlay routes' : 'configured authenticated routes',
      userValue: isOverlay
        ? 'Open authenticated overlay routes without saving private content.'
        : 'Open configured authenticated routes without saving private content.',
      entryNodeIds: layerNodes.slice(0, 20).map((node) => node.id),
      requiredNodeIds: layerNodes.slice(0, 20).map((node) => node.id),
      outputs: [{ name: 'routes', type: 'route_access_summary' }],
      safetyLevel: 'read_only',
      evidence: layerNodes.flatMap((node) => node.evidence ?? []).slice(0, 8),
      confidence: 0.7,
      status: 'active',
      informational: false,
      sourceLayer: layer,
      authRequired: true,
      risk_level: 'read_personal_medium',
      enabled_status: 'enabled',
      default_policy: 'enabled',
      evidence_status: 'verified',
      saved_material: ['sanitized_route_access_only'],
      raw_content_saved: false,
      private_content_saved: false,
      raw_dom_saved: false,
      raw_html_saved: false,
      cookie_material_saved: false,
      evidenceModel: 'authenticated_route_only',
      intents: isOverlay
        ? ['open authenticated overlay routes', 'show authenticated overlay route access']
        : ['open authenticated routes', 'show authenticated route access'],
    });
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'read_only',
      dryRunOnly: false,
      requiresConfirmation: false,
      autoExecute: false,
      steps: layerNodes.slice(0, 12).map((node) => ({
        kind: 'open_configured_authenticated_route',
        nodeId: node.id,
        routeTemplate: node.routeTemplate ?? node.routePattern ?? null,
        routePath: node.normalizedUrl ?? node.url ?? null,
        sourceLayer: layer,
        savedMaterial: 'sanitized_route_access_only',
      })),
    });
    capabilities.push(capability);
  }
}

function hasCapabilityNamed(capabilities = /** @type {any[]} */ ([]), name) {
  const normalizedName = String(name ?? '').toLowerCase();
  return capabilities.some((capability) => String(capability.name ?? '').toLowerCase() === normalizedName);
}

function isPublicUtilityRouteNode(node = /** @type {any} */ ({})) {
  const text = [
    node.normalizedUrl,
    node.url,
    node.routePattern,
    node.routeTemplate,
    node.title,
    node.textSummary,
    node.classification,
  ].join(' ').toLowerCase();
  return /(?:^|[/:?\s])(?:login|signin|sign-in|signup|sign-up|register|passport|account|settings|wallet|pay|payment|checkout|cart|order|recharge|vip|member)(?=[/?#:\s]|$)|登录|登入|注册|账号|设置|钱包|支付|付款|充值|会员|订单/iu.test(text);
}

function isStructureElementInstanceNode(node = /** @type {any} */ ({})) {
  const layer = nodeSourceLayer(node);
  return ['component', 'operation'].includes(node.type)
    && (isPublicReadSourceLayer(layer) || isAuthenticatedSourceLayer(layer))
    && node.evidenceStatus === 'element_instance_summary_present'
    && !isPublicUtilityRouteNode(node);
}

function hasMeaningfulElementLabel(node = /** @type {any} */ ({})) {
  const label = sanitizedPromotableCapabilityLabel(node.elementLabel ?? node.linkLabel ?? node.title, 80, null);
  return Boolean(label) && !/^(?:link|control|element)-\d+$/iu.test(label);
}

function capabilityLabelStats(value) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  const compact = text.replace(/\s+/gu, '');
  return {
    text,
    charCount: Array.from(compact).length,
    cjkCount: (compact.match(/[\u3400-\u9fff]/gu) ?? []).length,
    asciiWordCount: (text.match(/[a-z0-9][a-z0-9'-]*/giu) ?? []).length,
    sentencePunctuationCount: (text.match(/[。！？!?；;，、]/gu) ?? []).length,
    hasLineBreak: /[\r\n]/u.test(String(value ?? '')),
  };
}

function isProseLikeCapabilityLabel(value) {
  const stats = capabilityLabelStats(value);
  if (!stats.text || stats.text === '[REDACTED]') {
    return true;
  }
  return stats.cjkCount >= 36
    || stats.charCount >= 96
    || (stats.charCount >= 72 && stats.sentencePunctuationCount >= 1)
    || (stats.charCount >= 42 && stats.sentencePunctuationCount >= 2)
    || (stats.asciiWordCount >= 18 && stats.charCount >= 90)
    || (stats.hasLineBreak && stats.charCount >= 32);
}

function sanitizedPromotableCapabilityLabel(value, maxLength = 80, fallback = null) {
  const label = sanitizedStructureText(value, maxLength, null);
  if (!label || isProseLikeCapabilityLabel(label)) {
    return fallback;
  }
  return label;
}

function elementCapabilityLabel(node = /** @type {any} */ ({}), fallback = 'page element') {
  return sanitizedPromotableCapabilityLabel(
    node.elementLabel ?? node.linkLabel ?? node.title,
    80,
    fallback,
  );
}

function categoryInstanceForNode(node = /** @type {any} */ ({})) {
  const role = String(node.elementRole ?? node.linkSemanticKind ?? '').toLowerCase();
  if (!['search', 'category', 'tag', 'ranking', 'work', 'article', 'media', 'detail', 'profile', 'following_list', 'followed_channel'].includes(role)) {
    return null;
  }
  const label = sanitizedPromotableCapabilityLabel(node.elementLabel ?? node.linkLabel ?? node.title, 80, null);
  if (!label) {
    return null;
  }
  return {
    kind: role,
    label,
    routeTemplate: node.routeTemplate ?? node.routePattern ?? null,
    normalizedUrl: node.normalizedUrl ?? node.url ?? node.linkHref ?? null,
    selector: node.elementSelector ?? null,
    sourceLayer: nodeSourceLayer(node),
    evidenceStatus: node.evidenceStatus ?? null,
  };
}

function chineseElementVerb(role) {
  const normalizedRole = String(role ?? '').toLowerCase();
  if (normalizedRole === 'search') return '\u641c\u7d22';
  if (normalizedRole === 'ranking') return '\u67e5\u770b\u699c\u5355';
  if (normalizedRole === 'following_list' || normalizedRole === 'followed_channel') return '\u67e5\u770b';
  if (normalizedRole === 'category' || normalizedRole === 'tag') return '\u6d4f\u89c8';
  if (['work', 'article', 'media', 'detail'].includes(normalizedRole)) return '\u6253\u5f00';
  if (normalizedRole === 'profile') return '\u67e5\u770b';
  return '\u6253\u5f00';
  if (role === 'search') return '搜索';
  if (role === 'ranking') return '查看榜单';
  if (role === 'category' || role === 'tag') return '浏览';
  if (role === 'work' || role === 'article' || role === 'media' || role === 'detail') return '打开';
  if (role === 'profile') return '查看';
  return '打开';
}

function chineseElementCanonicalUtterance(role, objectLabel) {
  const normalizedRole = String(role ?? '').toLowerCase();
  const label = String(objectLabel ?? '').trim() || '\u9875\u9762\u5165\u53e3';
  if (normalizedRole === 'ranking' && /[\u3400-\u9fff]/u.test(label)) {
    return /(?:榜|排行|热搜|热门|最新)/u.test(label)
      ? `\u67e5\u770b${label}`
      : `\u67e5\u770b${label}\u699c\u5355`;
  }
  return `${chineseElementVerb(normalizedRole)}${label}`;
}

function chineseElementIntentExamples(role, objectLabel) {
  const normalizedRole = String(role ?? '').toLowerCase();
  const label = String(objectLabel ?? '').trim() || '\u9875\u9762\u5165\u53e3';
  const examples = [
    chineseElementCanonicalUtterance(normalizedRole, label),
    `\u6253\u5f00${label}`,
    `\u67e5\u770b${label}`,
    `open ${label}`,
  ];
  if (normalizedRole === 'category') {
    examples.push(`\u6253\u5f00${label}\u5206\u7c7b`, `\u67e5\u770b${label}\u5206\u7c7b`);
  } else if (normalizedRole === 'tag') {
    examples.push(`\u6253\u5f00${label}\u6807\u7b7e`, `\u67e5\u770b${label}\u6807\u7b7e`);
  } else if (normalizedRole === 'ranking') {
    examples.push(`\u6253\u5f00${label}\u6392\u884c`, `\u67e5\u770b${label}\u699c\u5355`);
  } else if (normalizedRole === 'following_list' || normalizedRole === 'followed_channel') {
    examples.push(`\u6253\u5f00${label}`, `\u67e5\u770b${label}\u5217\u8868`);
  } else if (normalizedRole === 'search') {
    examples.push(`\u4f7f\u7528${label}\u641c\u7d22`, `\u5728${label}\u91cc\u641c\u7d22`);
  } else if (normalizedRole === 'article') {
    examples.push(`\u9605\u8bfb${label}`, `\u6253\u5f00${label}\u6587\u7ae0`);
  } else if (['work', 'media', 'detail'].includes(normalizedRole)) {
    examples.push(`\u6253\u5f00${label}\u8be6\u60c5`, `\u67e5\u770b${label}\u4fe1\u606f`);
  } else if (normalizedRole === 'profile') {
    examples.push(`\u67e5\u770b${label}\u4e3b\u9875`, `\u6253\u5f00${label}\u8d44\u6599`);
  }
  return uniqueSortedStrings(examples);
}

function elementCapabilityName(node = /** @type {any} */ ({}), index = 0) {
  const role = String(node.elementRole ?? node.linkSemanticKind ?? 'navigation').toLowerCase();
  const label = elementCapabilityLabel(node, role);
  const labelSlug = slugifyAscii(label, '');
  const routeSlug = slugifyAscii(node.routeTemplate ?? node.routePattern ?? node.normalizedUrl ?? '', '');
  const stableSuffix = node.id?.slice(-8) || `element-${index + 1}`;
  const suffix = labelSlug || (routeSlug ? `${routeSlug}-${stableSuffix}` : stableSuffix);
  return role === 'search'
    ? `search with page element ${suffix}`
    : `open ${role} element ${suffix}`;
}

function elementCapabilityIntentSeeds(node = /** @type {any} */ ({}), labelOverride = null) {
  const role = String(node.elementRole ?? node.linkSemanticKind ?? 'navigation').toLowerCase();
  const label = String(labelOverride ?? '').trim()
    || elementCapabilityLabel(node, null)
    || String(node.routeTemplate ?? node.routePattern ?? '\u9875\u9762\u5165\u53e3');
  const canonicalUtterance = chineseElementCanonicalUtterance(role, label);
  return [
    {
      canonicalUtterance,
      utteranceExamples: chineseElementIntentExamples(role, label),
      negativeExamples: ['\u81ea\u52a8\u652f\u4ed8', '\u5220\u9664\u6570\u636e', '\u63d0\u4ea4\u8868\u5355'],
      slots: role === 'search' ? [{ name: 'query', type: 'string', required: false }] : [],
      invocationScore: 0.82,
    },
    {
      canonicalUtterance: `open ${label}`,
      utteranceExamples: [`open ${label}`],
      negativeExamples: ['submit a payment', 'delete account data'],
      slots: [],
      invocationScore: 0.72,
    },
  ];
}

function addPublicElementInstanceCapabilities(context, capabilities, graph, robotsPolicy = null) {
  const existingNames = new Set(capabilities.map((capability) => String(capability.name ?? '').toLowerCase()));
  const nodes = (graph?.nodes ?? [])
    .filter((node) => (
      isStructureElementInstanceNode(node)
      && hasMeaningfulElementLabel(node)
      && nodeTargetAllowedByRobots(context, node, robotsPolicy)
    ))
    .sort((left, right) => (
      String(left.elementRole ?? left.linkSemanticKind ?? '').localeCompare(String(right.elementRole ?? right.linkSemanticKind ?? ''), 'en')
      || String(left.elementLabel ?? left.title ?? '').localeCompare(String(right.elementLabel ?? right.title ?? ''), 'zh-Hans-CN')
      || String(left.routeTemplate ?? left.routePattern ?? '').localeCompare(String(right.routeTemplate ?? right.routePattern ?? ''), 'en')
    ))
    .slice(0, 80);
  for (const [index, node] of nodes.entries()) {
    const name = elementCapabilityName(node, index);
    if (existingNames.has(name.toLowerCase())) {
      continue;
    }
    existingNames.add(name.toLowerCase());
    const role = String(node.elementRole ?? node.linkSemanticKind ?? 'navigation').toLowerCase();
    const label = elementCapabilityLabel(node, null);
    if (!label) {
      continue;
    }
    const action = role === 'search' ? 'search' : 'view';
    const layer = nodeSourceLayer(node);
    const authRequired = node.authRequired === true || isAuthenticatedSourceLayer(layer);
    const capability = makeCapability(context, {
      name,
      description: `Use the ${authRequired ? 'authenticated' : 'public'} page element "${label}" discovered from sanitized element evidence.`,
      action,
      object: label,
      userValue: chineseElementCanonicalUtterance(role, label),
      entryNodeIds: [node.id],
      requiredNodeIds: [node.id],
      inputs: action === 'search' ? [{ name: 'query', type: 'text', required: false }] : [],
      outputs: [{ name: 'element', type: 'sanitized_element_summary' }],
      safetyLevel: 'read_only',
      evidence: node.evidence ?? [],
      confidence: 0.74,
      status: 'active',
      sourceLayer: layer,
      authRequired,
      risk_level: authRequired ? 'read_personal_medium' : 'read_public_low',
      enabled_status: 'enabled',
      default_policy: 'enabled',
      evidence_status: 'verified',
      evidenceModel: authRequired ? 'authenticated_route_only' : 'public_element_summary',
      elementKind: node.elementKind ?? null,
      elementRole: role,
      elementLabel: label,
      saved_material: ['sanitized_element_summary_only'],
      raw_content_saved: false,
      raw_dom_saved: false,
      raw_html_saved: false,
      private_content_saved: false,
      intents: elementCapabilityIntentSeeds(node, label),
    });
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'read_only',
      steps: [{
        kind: action === 'search' ? 'element_search_summary' : 'open_element_route',
        nodeId: node.id,
        label,
        routeTemplate: node.routeTemplate ?? node.routePattern ?? null,
        url: node.normalizedUrl ?? node.url ?? null,
        sourceLayer: layer,
        savedMaterial: 'sanitized_element_summary_only',
      }],
    });
    capabilities.push(capability);
  }
}

function routeInstanceCapabilityName(node = /** @type {any} */ ({}), index = 0) {
  const route = node.routeTemplate ?? node.routePattern ?? node.normalizedUrl ?? `route-${index + 1}`;
  const safeLabel = sanitizedPromotableCapabilityLabel(node.linkLabel ?? node.title, 48, '');
  const suffix = slugifyAscii(`${safeLabel} ${route}`, `route-${index + 1}`);
  return `open public route ${suffix}`;
}

function publicRouteCapabilityLabel(node = /** @type {any} */ ({}), fallback = 'public route') {
  return sanitizedPromotableCapabilityLabel(node.linkLabel ?? node.title, 80, null)
    ?? sanitizedStructureText(node.routeTemplate ?? node.routePattern ?? node.normalizedUrl, 80, fallback);
}

function routeInstanceIntents(node = /** @type {any} */ ({})) {
  const label = publicRouteCapabilityLabel(node, '\u516c\u5f00\u5165\u53e3');
  return uniqueSortedStrings([
    `\u6253\u5f00${label}`,
    `\u67e5\u770b${label}`,
    `\u6d4f\u89c8${label}`,
    `open ${label}`,
  ]);
}

function addPublicRouteTemplateInstanceCapabilities(
  context,
  capabilities,
  graph,
  robotsPolicy = null,
  { allowRouteSeedOnly = false } = /** @type {any} */ ({}),
) {
  const existingNames = new Set(capabilities.map((capability) => String(capability.name ?? '').toLowerCase()));
  const seenRoutes = new Set();
  const nodes = (graph?.nodes ?? [])
    .filter((node) => (
      ['route', 'route_template'].includes(node.type)
      && node.authRequired !== true
      && isPublicReadSourceLayer(nodeSourceLayer(node))
      && (node.routeTemplate || node.routePattern || node.normalizedUrl)
      && (node.routeTemplate ?? node.routePattern) !== '/'
      && !isPublicUtilityRouteNode(node)
      && hasPublicRouteNavigationCapabilityEvidence(context, node, robotsPolicy, { allowRouteSeedOnly })
      && nodeTargetAllowedByRobots(context, node, robotsPolicy)
    ))
    .sort((left, right) => String(left.routeTemplate ?? left.routePattern ?? '').localeCompare(
      String(right.routeTemplate ?? right.routePattern ?? ''),
      'en',
    ));
  for (const node of nodes) {
    const routeKey = `${nodeSourceLayer(node)}:${node.routeTemplate ?? node.routePattern ?? node.normalizedUrl}`;
    if (seenRoutes.has(routeKey)) {
      continue;
    }
    seenRoutes.add(routeKey);
    if (seenRoutes.size > 80) {
      break;
    }
    const name = routeInstanceCapabilityName(node, seenRoutes.size - 1);
    if (existingNames.has(name.toLowerCase())) {
      continue;
    }
    existingNames.add(name.toLowerCase());
    const routeLabel = publicRouteCapabilityLabel(node, 'public route');
    const capability = makeCapability(context, {
      name,
      description: `Open public route "${routeLabel}" using route-template evidence only.`,
      action: 'view',
      object: routeLabel,
      userValue: `Open public route ${routeLabel}`,
      entryNodeIds: [node.id],
      requiredNodeIds: [node.id],
      outputs: [{ name: 'route', type: 'route_summary' }],
      safetyLevel: 'read_only',
      evidence: node.evidence ?? [],
      confidence: node.evidenceStatus === 'route_seed_only' ? 0.62 : 0.7,
      status: 'active',
      sourceLayer: nodeSourceLayer(node),
      evidenceModel: 'public_route_navigation',
      publicRouteOnly: true,
      saved_material: ['sanitized_route_summary_only'],
      raw_content_saved: false,
      raw_dom_saved: false,
      raw_html_saved: false,
      private_content_saved: false,
      intents: routeInstanceIntents(node),
    });
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'read_only',
      steps: [{
        kind: 'route_template',
        nodeId: node.id,
        routeTemplate: node.routeTemplate ?? node.routePattern ?? null,
        url: node.normalizedUrl ?? node.url ?? null,
        savedMaterial: 'sanitized_route_summary_only',
      }],
    });
    capabilities.push(capability);
  }
}

function hasPublicRouteNavigationCapabilityEvidence(
  context = /** @type {any} */ ({}),
  node = /** @type {any} */ ({}),
  robotsPolicy = null,
  { allowRouteSeedOnly = false } = /** @type {any} */ ({}),
) {
  const evidenceStatus = String(node.evidenceStatus ?? '');
  const publicEvidenceStatus = String(node.publicEvidenceStatus ?? '');
  if (publicEvidenceStatus === 'public_rendered_route_seed_only') {
    return allowRouteSeedOnly === true && nodeTargetAllowedByRobots(context, node, robotsPolicy);
  }
  if (evidenceStatus === 'route_seed_only') {
    return allowRouteSeedOnly === true && nodeTargetAllowedByRobots(context, node, robotsPolicy);
  }
  if (['link_route_template', 'link_semantic_route_template', 'policy_route_template'].includes(evidenceStatus)) {
    return true;
  }
  if (['public_static_structured', 'public_rendered_structured', 'policy_route_template'].includes(publicEvidenceStatus)) {
    return true;
  }
  if (node.categoryInstance && nodeTargetAllowedByRobots(context, node, robotsPolicy)) {
    return true;
  }
  return evidenceStatus === 'structure_summary_present';
}

function nodeTargetAllowedByRobots(context = /** @type {any} */ ({}), node = /** @type {any} */ ({}), robotsPolicyOverride = null) {
  if (nodeSourceLayer(node) === 'authorized_source' || node.sourceAuthority || node.sourceAuthorityId) {
    return true;
  }
  const robotsPolicy = robotsPolicyOverride ?? setupProfileRobotsPolicy(context);
  if (!robotsPolicy) {
    return true;
  }
  const targets = uniqueSortedStrings([
    node.normalizedUrl,
    node.url,
    node.linkHref,
    node.href,
    node.formAction,
  ].filter(Boolean));
  if (targets.length === 0) {
    return true;
  }
  return targets.every((target) => {
    try {
      const urlValue = normalizeUrl(target, context.site?.rootUrl);
      return isInternalUrl(urlValue, context.site?.allowedDomains ?? [])
        && isUrlAllowedByRobots(urlValue, robotsPolicy);
    } catch {
      return false;
    }
  });
}

function publicSearchNodes(graph) {
  return publicReadableNodes(graph, [
    'search',
    'search_page',
    'search_results',
    'search_form',
    'book_search_results',
    'book_search_form',
  ]);
}

function publicSearchObject(context, graph) {
  if (isSocialSiteContext(context)) {
    return 'posts';
  }
  const text = [
    context.site?.rootUrl,
    ...(graph?.nodes ?? []).slice(0, 80).flatMap((node) => [
      node.classification,
      node.title,
      node.textSummary,
      node.routePattern,
      node.structureType,
    ]),
  ].join(' ').toLowerCase();
  if (/repositories|repository|\brepos?\b|github|code search|project/u.test(text)) return 'repositories';
  if (/video|media|watch/u.test(text)) return 'media items';
  if (/book|novel|fiction|chapter|works?|serialized/u.test(text)) return 'books and works';
  if (/article|story|news|channel/u.test(text)) return 'articles and news';
  if (/product|shop|catalog/u.test(text)) return 'catalog content';
  return 'public content';
}

function isProductCommerceContext(context, graph, productList = null, productDetail = null) {
  if (!productList && !productDetail) {
    return false;
  }
  const text = [
    context.site?.rootUrl,
    productList?.title,
    productList?.textSummary,
    productDetail?.title,
    productDetail?.textSummary,
    ...(graph?.nodes ?? []).slice(0, 60).flatMap((node) => [
      node.classification,
      node.title,
      node.textSummary,
      node.routePattern,
    ]),
  ].join(' ').toLowerCase();
  if (/github|repository|repositories|\brepos?\b|code search/u.test(text)) {
    return false;
  }
  return /shop|store|product|products|catalog|cart|checkout|commerce/u.test(text);
}

function addGenericPublicSearchCapability(context, capabilities, graph, searchForm) {
  if (hasCapabilityNamed(capabilities, 'search public content')) {
    return;
  }
  const nodes = searchForm
    ? (graph.nodes ?? []).filter((node) => node.id === searchForm.nodeId)
    : publicSearchNodes(graph);
  if (!searchForm && !nodes.length) {
    return;
  }
  const hasSearchRouteFallbackEvidence = !searchForm
    && nodes.length > 0
    && (graph.nodes ?? []).some((node) => !node.authRequired && isPublicReadSourceLayer(nodeSourceLayer(node)) && nodeHasPublicStructureEvidence(node));
  const object = publicSearchObject(context, graph);
  const capability = makeCapability(context, {
    name: 'search public content',
    description: `Search public ${object} using discovered read-only search evidence.`,
    action: 'search',
    object,
    userValue: `Search ${object} without submitting state-changing actions.`,
    entryNodeIds: nodes.slice(0, 10).map((node) => node.id),
    requiredNodeIds: nodes.slice(0, 10).map((node) => node.id),
    inputs: searchForm?.inputs?.length ? searchForm.inputs : [{ name: 'query', type: 'string', required: true }],
    outputs: [{ name: 'results', type: 'sanitized_summary' }],
    safetyLevel: 'read_only',
    evidence: searchForm?.evidence ?? catalogCoverageEvidence(context, nodes, 'search public content'),
    confidence: searchForm ? 0.88 : 0.72,
    autoGenerated: true,
    category: 'public-search',
    risk_level: 'read_public_low',
    enabled_status: 'enabled',
    evidence_status: 'verified',
    default_policy: 'read_only',
    evidenceModel: hasSearchRouteFallbackEvidence ? 'public_route_navigation' : 'public_structure',
    publicRouteOnly: hasSearchRouteFallbackEvidence,
    intents: [
      '\u641c\u7d22\u516c\u5f00\u5185\u5bb9',
      '\u641c\u7d22\u7ad9\u5185\u5185\u5bb9',
      '\u6309\u5173\u952e\u8bcd\u67e5\u627e\u516c\u5f00\u5185\u5bb9',
      'search public content',
      `search ${object}`,
      'find public site content by keyword',
    ],
  });
  if (searchForm) {
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'read_only',
      steps: [{
        kind: 'form_get',
        nodeId: searchForm.nodeId,
        selector: searchForm.selector,
        endpoint: searchForm.endpoint,
        method: searchForm.method,
        submit: false,
        querySlot: searchForm.inputs?.find((input) => input.name)?.name ?? 'q',
      }],
    });
  } else if (nodes.length) {
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'read_only',
      steps: catalogCoverageSteps(nodes),
    });
  }
  capabilities.push(capability);
}

function addGenericPublicCoverageCapabilities(context, capabilities, graph, searchForm) {
  const routeNodes = publicReadableNodes(graph, []).filter((node) => node.type === 'route' || node.type === 'route_template');
  const nonRootRouteNodes = routeNodes.filter((node) => !['/', null, undefined].includes(node.routePattern ?? node.routeTemplate));
  const homepageNodes = publicReadableNodes(graph, ['homepage']).filter((node) => nodeHasPublicStructureEvidence(node)).slice(0, 3);
  const repositoryCoverageSite = isRepositoryCoverageSite(context, graph?.nodes ?? []);
  const collectionClassifications = [
    'collection_list',
    'ranking_list',
    'work_list',
    'article_list',
    'search_results',
    'product_list',
    'catalog_collection',
    'catalog_topic_list',
    'catalog_topic_pagination',
    'catalog_release_list',
    'catalog_event_media',
    'book_collection_list',
    'book_ranking_list',
    ...(repositoryCoverageSite ? ['repository_list'] : []),
  ];
  const categoryNodes = publicReadableNodes(graph, [
    'category_list',
    'tag_list',
    'news_channel',
    'catalog_category',
    'catalog_tag',
    'book_category_list',
  ]);
  const collectionNodes = publicReadableNodes(graph, collectionClassifications);
  const articleListNodes = publicReadableNodes(graph, [
    'article_list',
    'news_channel',
  ]);
  const rankingNodes = publicReadableNodes(graph, [
    'ranking_list',
    'book_ranking_list',
  ]);
  const tagNodes = publicReadableNodes(graph, [
    'tag_list',
    'catalog_tag',
  ]);
  const profileNodes = publicReadableNodes(graph, [
    'profile_detail',
    'catalog_author',
  ]);
  const detailNodes = publicReadableNodes(graph, [
    'entity_detail',
    'work_detail',
    'repository_detail',
    'article_detail',
    'profile_detail',
    'product_detail',
    'catalog_detail',
    'catalog_topic_detail',
    'book_detail',
    'chapter_detail',
    'entity_route',
  ]);
  const repositoryListNodes = repositoryCoverageSite ? publicReadableNodes(graph, ['repository_list']) : [];
  const repositoryDetailNodes = repositoryCoverageSite ? publicReadableNodes(graph, ['repository_detail']) : [];
  const categoryCoverageNodes = categoryNodes.filter((node) => nodeHasRouteOnlyPublicEvidence(node));
  const rankingCoverageNodes = rankingNodes.filter((node) => nodeHasRouteOnlyPublicEvidence(node));
  const detailCoverageNodes = detailNodes.filter((node) => nodeHasRouteOnlyPublicEvidence(node));
  const profileCoverageNodes = profileNodes.filter((node) => nodeHasRouteOnlyPublicEvidence(node));
  const metadataNodes = publicReadableNodes(graph, [])
    .filter((node) => (
      nodeHasPublicStructureEvidence(node)
      || ['collection_list', 'category_list', 'tag_list', 'ranking_list', 'repository_list', 'article_list', 'work_list'].includes(node.classification)
    ))
    .slice(0, 80);

  if (!hasCapabilityNamed(capabilities, 'browse public navigation')) {
    addCatalogCoverageCapability(context, capabilities, {
      name: 'browse public navigation',
      description: 'Browse public navigation, route templates, and linked site areas discovered from sanitized evidence.',
      action: 'view',
      object: 'public navigation',
      userValue: '浏览公开站点入口、导航和栏目路由。',
      nodes: [...homepageNodes, ...nonRootRouteNodes].slice(0, 80),
      outputs: [{ name: 'routes', type: 'route_summary' }],
      intents: ['浏览站点导航', '打开公开入口', '查看公开栏目', '查看站点路由', 'browse public navigation', 'open public entry points', 'view public sections', 'view site routes'],
      confidence: 0.7,
      allowRouteOnlyEvidence: true,
    });
  }

  if (!hasCapabilityNamed(capabilities, 'browse public categories')) {
    addCatalogCoverageCapability(context, capabilities, {
      name: 'browse public categories',
      description: 'Browse discovered public category, tag, channel, or section routes.',
      action: 'view',
      object: 'public categories and channels',
      userValue: '\u6d4f\u89c8\u516c\u5f00\u5206\u7c7b\u3001\u6807\u7b7e\u548c\u9891\u9053\u3002',
      nodes: categoryCoverageNodes.length ? categoryCoverageNodes : categoryNodes,
      outputs: [{ name: 'categories', type: 'list' }],
      intents: [
        '\u6d4f\u89c8\u516c\u5f00\u5206\u7c7b',
        '\u6253\u5f00\u5206\u7c7b\u9875\u9762',
        '\u67e5\u770b\u516c\u5f00\u9891\u9053\u548c\u6807\u7b7e',
        'browse public categories',
        'open category pages',
      ],
      confidence: 0.74,
      allowRouteOnlyEvidence: true,
    });
  }

  if (!hasCapabilityNamed(capabilities, 'browse public collections') && collectionNodes.length) {
    addCatalogCoverageCapability(context, capabilities, {
      name: 'browse public collections',
      description: 'Browse discovered public list, ranking, archive, repository, article, work, and collection routes.',
      action: 'view',
      object: 'public collections',
      userValue: '浏览公开列表、榜单和合集。',
      nodes: collectionNodes,
      outputs: [{ name: 'items', type: 'list' }],
      intents: ['浏览公开列表', '打开公开合集', '查看最新公开内容', 'browse public collections', 'open public lists', 'view rankings and latest public items'],
      confidence: 0.74,
      allowRouteOnlyEvidence: true,
    });
  }

  if (!hasCapabilityNamed(capabilities, 'open public detail pages') && detailNodes.length) {
    addCatalogCoverageCapability(context, capabilities, {
      name: 'open public detail pages',
      description: 'Open discovered public detail pages such as articles, works, repositories, profiles, products, or catalog entries.',
      action: 'view',
      object: 'public detail pages',
      userValue: '打开公开详情页，不保存原始正文。',
      nodes: detailCoverageNodes.length ? detailCoverageNodes : detailNodes,
      outputs: [{ name: 'detail', type: 'entity' }],
      intents: ['打开公开详情页', '查看公开作品详情', '打开公开内容详情', 'open public detail pages', 'view public detail page', 'open article work repository or item detail'],
      confidence: 0.72,
      allowRouteOnlyEvidence: true,
    });
  }

  if (!hasCapabilityNamed(capabilities, 'browse public articles') && articleListNodes.length) {
    addCatalogCoverageCapability(context, capabilities, {
      name: 'browse public articles',
      description: 'Browse discovered public article, news, or story list routes.',
      action: 'view',
      object: 'public articles and news lists',
      userValue: '浏览公开文章和新闻列表。',
      nodes: articleListNodes,
      outputs: [{ name: 'articles', type: 'list' }],
      intents: ['浏览公开文章', '打开文章列表', '查看公开新闻列表', 'browse public articles', 'open article lists', 'show public news lists'],
      confidence: 0.75,
      allowRouteOnlyEvidence: true,
    });
  }

  if (!hasCapabilityNamed(capabilities, 'browse public rankings') && rankingNodes.length) {
    addCatalogCoverageCapability(context, capabilities, {
      name: 'browse public rankings',
      description: 'Browse discovered public ranking, trending, popular, or latest routes.',
      action: 'view',
      object: 'public rankings',
      userValue: '浏览公开榜单和最新列表。',
      nodes: rankingCoverageNodes.length ? rankingCoverageNodes : rankingNodes,
      outputs: [{ name: 'ranked_items', type: 'list' }],
      intents: ['浏览公开榜单', '查看公开排行榜', '打开热门或最新列表', 'browse public rankings', 'view public ranking lists', 'open trending or latest lists'],
      confidence: 0.75,
      allowRouteOnlyEvidence: true,
    });
  }

  if (!hasCapabilityNamed(capabilities, 'browse public tags') && tagNodes.length) {
    addCatalogCoverageCapability(context, capabilities, {
      name: 'browse public tags',
      description: 'Browse discovered public tag or topic routes.',
      action: 'view',
      object: 'public tags and topics',
      userValue: '浏览公开标签和话题页面。',
      nodes: tagNodes,
      outputs: [{ name: 'tags', type: 'list' }],
      intents: ['浏览公开标签', '打开公开话题页', '查看公开主题', 'browse public tags', 'open public tag pages', 'show public topics'],
      confidence: 0.74,
      allowRouteOnlyEvidence: true,
    });
  }

  if (!hasCapabilityNamed(capabilities, 'open public profiles') && profileNodes.length) {
    addCatalogCoverageCapability(context, capabilities, {
      name: 'open public profiles',
      description: 'Open discovered public profile, author, model, creator, or organization pages.',
      action: 'view',
      object: 'public profiles',
      userValue: '打开公开作者、创作者或资料页。',
      nodes: profileCoverageNodes.length ? profileCoverageNodes : profileNodes,
      outputs: [{ name: 'profile', type: 'entity' }],
      intents: ['打开公开资料页', '查看公开作者页面', '打开创作者页面', 'open public profiles', 'view public profile pages', 'open author or creator pages'],
      confidence: 0.74,
      allowRouteOnlyEvidence: true,
    });
  }

  if (!hasCapabilityNamed(capabilities, 'browse public repositories')) {
    addCatalogCoverageCapability(context, capabilities, {
      name: 'browse public repositories',
      description: 'Browse discovered public repository or project list routes.',
      action: 'view',
      object: 'public repositories',
      userValue: '浏览公开仓库和项目列表。',
      nodes: repositoryListNodes,
      outputs: [{ name: 'repositories', type: 'list' }],
      intents: ['浏览公开仓库', '查看项目列表', '打开公开项目', 'browse public repositories', 'show repository lists', 'open public projects'],
      confidence: 0.76,
      allowRouteOnlyEvidence: true,
    });
  }

  if (!hasCapabilityNamed(capabilities, 'open public repository details')) {
    addCatalogCoverageCapability(context, capabilities, {
      name: 'open public repository details',
      description: 'Open discovered public repository or project detail pages.',
      action: 'view',
      object: 'public repository details',
      userValue: '打开公开仓库详情页。',
      nodes: repositoryDetailNodes,
      outputs: [{ name: 'repository', type: 'entity' }],
      intents: ['打开公开仓库详情', '查看仓库详情', '打开公开项目页', 'open public repository details', 'view repository detail', 'open public project page'],
      confidence: 0.76,
      allowRouteOnlyEvidence: true,
    });
  }

  if (!hasCapabilityNamed(capabilities, 'read public metadata')) {
    addCatalogCoverageCapability(context, capabilities, {
      name: 'read public metadata',
      description: 'Read sanitized public metadata from discovered pages, lists, controls, and route summaries without storing raw page bodies.',
      action: 'view',
      object: 'public metadata',
      userValue: '读取脱敏后的公开页面和列表元数据。',
      nodes: metadataNodes,
      outputs: [{ name: 'metadata', type: 'sanitized_summary' }],
      intents: ['读取公开元数据', '总结公开站点元数据', '查看公开页面摘要', 'read public metadata', 'summarize public site metadata', 'show public page summaries'],
      confidence: 0.72,
    });
  }

  addGenericPublicSearchCapability(context, capabilities, graph, searchForm);
}

const BUSINESS_COVERAGE_CAPABILITY_SPECS = Object.freeze({
  'release-listings': {
    name: 'browse release listings',
    description: 'Browse public release and archive listing routes configured for this site.',
    object: 'release listings',
    outputs: [{ name: 'release_routes', type: 'route_summary' }],
    intents: ['浏览发行列表', '查看发布归档', '打开最新发布入口', 'browse release listings', 'view release archive'],
  },
  'reserve-listings': {
    name: 'browse reserve listings',
    description: 'Browse public reservation or upcoming listing routes configured for this site.',
    object: 'reserve listings',
    outputs: [{ name: 'reserve_routes', type: 'route_summary' }],
    intents: ['浏览预约列表', '查看预约作品入口', '打开即将发布列表', 'browse reserve listings', 'view upcoming listings'],
  },
  'news-updates': {
    name: 'browse news updates',
    description: 'Browse public news, blog, column, and article update routes configured for this site.',
    object: 'news updates',
    outputs: [{ name: 'news_routes', type: 'route_summary' }],
    intents: ['浏览新闻更新', '查看博客或专栏入口', '打开资讯列表', 'browse news updates', 'open news or blog updates'],
  },
  'genre-directory': {
    name: 'browse genre directory',
    description: 'Browse public genre and category directory routes configured for this site.',
    object: 'genre directory',
    outputs: [{ name: 'genre_routes', type: 'route_summary' }],
    intents: ['浏览类型目录', '按分类查看目录', '打开类型索引', 'browse genre directory', 'open category directory'],
  },
  'series-directory': {
    name: 'browse series directory',
    description: 'Browse public series directory routes configured for this site.',
    object: 'series directory',
    outputs: [{ name: 'series_routes', type: 'route_summary' }],
    intents: ['浏览系列目录', '按系列查看目录', '打开系列索引', 'browse series directory', 'open series directory'],
  },
  'label-directory': {
    name: 'browse label directory',
    description: 'Browse public label or brand directory routes configured for this site.',
    object: 'label directory',
    outputs: [{ name: 'label_routes', type: 'route_summary' }],
    intents: ['浏览厂牌目录', '按厂牌查看目录', '打开厂牌索引', 'browse label directory', 'open label directory'],
  },
  'maker-directory': {
    name: 'browse maker directory',
    description: 'Browse public maker or studio directory routes configured for this site.',
    object: 'maker directory',
    outputs: [{ name: 'maker_routes', type: 'route_summary' }],
    intents: ['浏览制作方目录', '按制作方查看目录', '打开 maker 索引', 'browse maker directory', 'open maker directory'],
  },
  'person-directory': {
    name: 'browse performer directory',
    description: 'Browse public performer, actress, model, talent, or author directory routes configured for this site.',
    object: 'performer directory',
    outputs: [{ name: 'person_routes', type: 'route_summary' }],
    intents: ['浏览演员目录', '打开作者或模特目录', '查看人物索引', 'browse performer directory', 'open talent directory'],
  },
  'topic-directory': {
    name: 'browse topic directory',
    description: 'Browse public topic, tag, and update directory routes configured for this site.',
    object: 'topic directory',
    outputs: [{ name: 'topic_routes', type: 'route_summary' }],
    intents: ['浏览主题目录', '打开标签或话题入口', '查看更新主题', 'browse topic directory', 'open topic directory'],
  },
  'ranking-lists': {
    name: 'browse ranking lists',
    description: 'Browse public ranking, popular, top, and latest listing routes configured for this site.',
    object: 'ranking lists',
    outputs: [{ name: 'ranking_routes', type: 'route_summary' }],
    intents: ['浏览榜单列表', '查看热门或最新榜单', '打开排行入口', 'browse ranking lists', 'open ranking lists'],
  },
  'event-media': {
    name: 'browse event and media listings',
    description: 'Browse public event and media listing routes configured for this site.',
    object: 'event and media listings',
    outputs: [{ name: 'event_media_routes', type: 'route_summary' }],
    intents: ['浏览活动媒体列表', '查看活动或媒体入口', '打开活动信息', 'browse event and media listings'],
  },
  'special-pages': {
    name: 'browse special pages',
    description: 'Browse public special, campaign, or feature routes configured for this site.',
    object: 'special pages',
    outputs: [{ name: 'special_routes', type: 'route_summary' }],
    intents: ['浏览专题页面', '查看特设入口', '打开专题列表', 'browse special pages', 'open feature pages'],
  },
  'vr-catalog': {
    name: 'browse VR catalog',
    description: 'Browse public VR catalog routes configured for this site.',
    object: 'VR catalog',
    outputs: [{ name: 'vr_routes', type: 'route_summary' }],
    intents: ['浏览 VR 目录', '打开 VR 列表', '查看 VR 内容入口', 'browse VR catalog'],
  },
  'sales-catalog': {
    name: 'browse sales catalog',
    description: 'Browse public sales or shop catalog routes configured for this site.',
    object: 'sales catalog',
    outputs: [{ name: 'sales_routes', type: 'route_summary' }],
    intents: ['浏览销售目录', '打开销售列表', '查看销售入口', 'browse sales catalog'],
  },
  help: {
    name: 'open help pages',
    description: 'Open public help and support information pages without submitting forms.',
    object: 'help pages',
    outputs: [{ name: 'help_routes', type: 'route_summary' }],
    intents: ['打开帮助页面', '查看帮助信息', '浏览支持说明', 'open help pages', 'view help information'],
  },
  'contact-boundary': {
    name: 'open inquiry boundary pages',
    description: 'Open public contact or inquiry pages as read-only boundary evidence without submitting forms.',
    object: 'inquiry boundary pages',
    outputs: [{ name: 'inquiry_boundary_routes', type: 'route_summary' }],
    intents: ['打开咨询边界页面', '查看联系或咨询入口但不提交', '浏览咨询说明', 'open inquiry boundary pages', 'view inquiry pages without submitting'],
  },
  'policy-pages': {
    name: 'open policy pages',
    description: 'Open public policy, privacy, and terms pages configured for this site.',
    object: 'policy pages',
    outputs: [{ name: 'policy_routes', type: 'route_summary' }],
    intents: ['打开政策页面', '查看隐私或条款页面', '浏览规则说明', 'open policy pages', 'view privacy policy'],
  },
  'utility-pages': {
    name: 'open utility pages',
    description: 'Open public company, link, sitemap, recruit, and informational utility pages configured for this site.',
    object: 'utility pages',
    outputs: [{ name: 'utility_routes', type: 'route_summary' }],
    intents: ['打开实用页面', '查看公司或链接页面', '浏览站点说明入口', 'open utility pages', 'view public utility pages'],
  },
  sitemap: {
    name: 'open sitemap',
    description: 'Open public sitemap routes configured for this site.',
    object: 'sitemap',
    outputs: [{ name: 'sitemap_routes', type: 'route_summary' }],
    intents: ['打开站点地图', '查看 sitemap', '浏览站点索引', 'open sitemap', 'view site map'],
  },
});

function nodeBusinessCoverageGroup(context, node = /** @type {any} */ ({})) {
  if (node.businessCoverageGroup) {
    return String(node.businessCoverageGroup);
  }
  return seedBusinessCoverageGroup(context, {
    normalizedUrl: node.normalizedUrl ?? node.url ?? null,
    pageType: node.pageType ?? node.classification ?? null,
    routeTemplate: node.routeTemplate ?? node.routePattern ?? null,
    source: node.discoveredBy ?? node.sourceLayer ?? null,
  });
}

function businessCoverageNodes(context, graph, groupId) {
  return (graph.nodes ?? [])
    .filter((node) => !node.authRequired && isPublicReadSourceLayer(nodeSourceLayer(node)))
    .filter((node) => ['page', 'route', 'route_template', 'content', 'component'].includes(node.type))
    .filter((node) => nodeBusinessCoverageGroup(context, node) === groupId)
    .filter((node) => !isPublicUtilityRouteNode(node) || ['help', 'policy-pages', 'utility-pages', 'sitemap'].includes(groupId))
    .sort((left, right) => String(left.normalizedUrl ?? left.routePattern ?? left.id).localeCompare(
      String(right.normalizedUrl ?? right.routePattern ?? right.id),
      'en',
    ));
}

function addKnownSiteBusinessCoverageCapabilities(context, capabilities, graph) {
  const model = knownPolicyBusinessCoverageForContext(context);
  if (!model || !Array.isArray(model.groups) || isSocialSiteContext(context)) {
    return;
  }
  for (const group of model.groups) {
    const spec = BUSINESS_COVERAGE_CAPABILITY_SPECS[group.id];
    if (!spec || hasCapabilityNamed(capabilities, spec.name)) {
      continue;
    }
    const nodes = businessCoverageNodes(context, graph, group.id);
    if (!nodes.length) {
      continue;
    }
    addCatalogCoverageCapability(context, capabilities, {
      name: spec.name,
      description: spec.description,
      object: spec.object,
      userValue: spec.description,
      nodes,
      outputs: spec.outputs,
      intents: spec.intents,
      confidence: nodes.some((node) => nodeHasPublicStructureEvidence(node)) ? 0.74 : 0.64,
      evidenceModel: 'known_site_business_coverage',
      allowRouteOnlyEvidence: true,
      publicRouteOnly: true,
      semanticPriority: Number(group.priority ?? 0) || 0,
    });
  }
}

function addGenericCatalogCoverageCapabilities(context, capabilities, graph, searchForm) {
  if (isSocialSiteContext(context)) {
    return;
  }
  const pageNodes = graph.nodes.filter((node) => node.type === 'page');
  const routeNodes = graph.nodes.filter((node) => node.type === 'route' || node.type === 'route_template');
  if (!isCatalogCoverageSite(context, pageNodes, routeNodes)) {
    return;
  }
  const collections = catalogCoverageNodes(pageNodes, routeNodes, ['product_list', 'catalog_collection']);
  const categories = catalogCoverageNodes(pageNodes, routeNodes, ['catalog_category']);
  const tags = catalogCoverageNodes(pageNodes, routeNodes, ['catalog_tag']);
  const topicLists = catalogCoverageNodes(pageNodes, routeNodes, ['catalog_topic_list', 'catalog_topic_pagination']);
  const topicArchives = catalogCoverageNodes(pageNodes, routeNodes, ['catalog_topic_archive']);
  const topicDetails = catalogCoverageNodes(pageNodes, routeNodes, ['catalog_topic_detail']);
  const releaseLists = catalogCoverageNodes(pageNodes, routeNodes, ['catalog_release_list']);
  const eventMedia = catalogCoverageNodes(pageNodes, routeNodes, ['catalog_event_media']);
  const topicCategoryNodes = topicLists.filter((node) => /\/topics\/(?:column|media|event|release|talent-info)(?:\/|$)/iu.test(`${node.normalizedUrl ?? ''} ${node.routePattern ?? ''}`));
  const topicCategoryEvidenceNodes = topicCategoryNodes.length
    ? topicCategoryNodes
    : topicLists.filter((node) => /銈炽儵銉爘銉°儑銈ｃ偄|銈ゃ儥銉炽儓|銉儶銉笺偣|銈裤儸銉炽儓鎯呭牨|TOPICS|鏇存柊鎯呭牨/iu.test(`${node.title ?? ''} ${node.textSummary ?? ''}`));
  const authors = catalogCoverageNodes(pageNodes, routeNodes, ['catalog_author']);
  const rankings = catalogCoverageNodes(pageNodes, routeNodes, ['catalog_collection']).filter((node) => /hot|popular|ranking|rank|top|latest|recent|trending/iu.test(`${node.normalizedUrl ?? ''} ${node.routePattern ?? ''} ${node.title ?? ''}`));
  const details = catalogCoverageNodes(pageNodes, routeNodes, ['product_detail', 'catalog_detail', 'entity_route']);
  const pagination = catalogCoverageNodes(pageNodes, routeNodes, ['catalog_pagination']);
  const fallbackCollections = pageNodes.filter((node) => node.classification === 'content_page').slice(0, 20);
  const publicMetadataNodes = [
    ...details,
    ...collections,
    ...categories,
    ...tags,
    ...topicLists,
    ...topicArchives,
    ...topicDetails,
    ...releaseLists,
    ...eventMedia,
    ...authors,
  ].slice(0, 80);

  addCatalogCoverageCapability(context, capabilities, {
    name: 'browse topic updates',
    description: 'Browse discovered public TOPICS update routes using site-visible labels.',
    object: 'topic updates',
    userValue: 'Browse TOPICS update lists.',
    nodes: topicLists,
    outputs: [{ name: 'topic_updates', type: 'list' }],
    intents: [
      'browse topic updates',
      'view TOPICS updates',
      'open all update lists',
    ],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'filter topic updates by category',
    description: 'Browse discovered TOPICS category routes such as column, media, release, and talent information.',
    object: 'topic update categories',
    userValue: 'Filter topic updates by category.',
    nodes: topicCategoryEvidenceNodes,
    outputs: [{ name: 'topic_categories', type: 'list' }],
    intents: [
      'filter topic updates by category',
      'browse media topic updates',
      'browse release topic updates',
      'browse talent topic updates',
    ],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'browse topic update archive',
    description: 'Browse discovered TOPICS ARCHIVE month routes.',
    object: 'topic archive routes',
    userValue: 'Browse update archives by month.',
    nodes: topicArchives,
    outputs: [{ name: 'topic_archive_months', type: 'list' }],
    intents: [
      'browse update archive',
      'view TOPICS by month',
      'open monthly update archive',
      'browse archived updates',
    ],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'open topic update detail',
    description: 'Open discovered public TOPICS update detail pages.',
    object: 'topic update detail',
    userValue: '\u67e5\u770b\u66f4\u65b0\u4fe1\u606f\u8be6\u60c5\u3002',
    nodes: topicDetails,
    outputs: [{ name: 'topic_update_detail', type: 'entity' }],
    intents: [
      'open topic update detail',
      'view update detail',
      'open TOPICS detail',
      'view event or announcement detail',
    ],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'browse event and media updates',
    description: 'Browse discovered public EVENT / MEDIA routes surfaced by the site.',
    object: 'event and media updates',
    userValue: '\u67e5\u770b\u6d3b\u52a8\u548c\u5a92\u4f53\u66f4\u65b0\u5165\u53e3\u3002',
    nodes: eventMedia,
    outputs: [{ name: 'event_media_entries', type: 'list' }],
    intents: [
      'browse event and media updates',
      'view EVENT and MEDIA',
      'open event media entries',
      'browse activity media information',
    ],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'browse release updates',
    description: 'Browse discovered public RELEASE routes surfaced by the site.',
    object: 'release updates',
    userValue: '\u67e5\u770b\u53d1\u5e03\u4fe1\u606f\u5217\u8868\u3002',
    nodes: releaseLists,
    outputs: [{ name: 'release_entries', type: 'list' }],
    intents: [
      'browse release updates',
      'view RELEASE list',
      'open release information',
      'view release page',
    ],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'browse catalog collections',
    description: 'Browse all discovered public catalog, list, latest, and collection routes.',
    object: 'catalog collections',
    userValue: '\u6d4f\u89c8\u76ee\u5f55\u5217\u8868\u3002',
    nodes: collections.length ? collections : fallbackCollections,
    outputs: [{ name: 'catalog_entries', type: 'list' }],
    intents: ['浏览目录合集', '查看全部内容列表', '打开站点目录', '查看最新内容', 'browse catalog collections', 'view all content lists', 'open site catalog', 'view latest content'],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'browse catalog categories',
    description: 'Browse every discovered public category route.',
    object: 'catalog categories',
    userValue: '\u6d4f\u89c8\u5168\u90e8\u516c\u5f00\u5206\u7c7b\u8def\u7531\u3002',
    nodes: categories,
    outputs: [{ name: 'categories', type: 'list' }],
    intents: [
      '\u6d4f\u89c8\u5206\u7c7b\u76ee\u5f55',
      '\u67e5\u770b\u5168\u90e8\u5206\u7c7b',
      '\u6253\u5f00\u5206\u7c7b\u9875\u9762',
      '\u6309\u5206\u7c7b\u67e5\u770b\u5185\u5bb9',
      'browse catalog categories',
    ],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'browse catalog tags',
    description: 'Browse every discovered public tag or topic route.',
    object: 'catalog tags',
    userValue: '\u6d4f\u89c8\u5168\u90e8\u516c\u5f00\u6807\u7b7e\u6216\u4e3b\u9898\u8def\u7531\u3002',
    nodes: tags,
    outputs: [{ name: 'tags', type: 'list' }],
    intents: [
      '\u6d4f\u89c8\u6807\u7b7e\u76ee\u5f55',
      '\u67e5\u770b\u6807\u7b7e\u5185\u5bb9',
      '\u6309\u6807\u7b7e\u7b5b\u9009\u5185\u5bb9',
      '\u6253\u5f00\u6807\u7b7e\u9875\u9762',
      'browse catalog tags',
    ],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'browse catalog rankings',
    description: 'Browse discovered public ranking, hot, popular, and latest routes.',
    object: 'catalog ranking routes',
    userValue: '\u6d4f\u89c8\u76ee\u5f55\u699c\u5355\u548c\u6700\u65b0\u5217\u8868\u3002',
    nodes: rankings,
    outputs: [{ name: 'ranked_entries', type: 'list' }],
    intents: ['浏览目录榜单', '查看热门内容', '查看最近更新', '打开最新内容列表', 'browse catalog rankings', 'view popular content', 'view recent updates', 'open latest content list'],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'open catalog detail',
    description: 'Open discovered public detail pages from catalog evidence.',
    object: 'catalog detail pages',
    userValue: '\u6253\u5f00\u76ee\u5f55\u8be6\u60c5\u3002',
    nodes: details,
    outputs: [{ name: 'detail', type: 'entity' }],
    intents: ['打开目录详情', '查看公开详情页', '打开条目详情', '查看站点公开详情', 'open catalog detail', 'view public detail page', 'open item detail', 'view site public detail'],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'open catalog author profile',
    description: 'Open discovered public author, model, actor, performer, or profile routes.',
    object: 'catalog author profiles',
    userValue: '\u6253\u5f00\u4f5c\u8005\u6216\u6f14\u5458\u9875\u9762\u3002',
    nodes: authors,
    outputs: [{ name: 'profile', type: 'entity' }],
    intents: ['open author profile', 'view performer profile', 'view author information', 'browse content by author'],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'browse catalog pagination',
    description: 'Follow discovered read-only pagination routes inside the catalog.',
    object: 'catalog pagination',
    userValue: '\u6d4f\u89c8\u5206\u9875\u3002',
    nodes: pagination,
    outputs: [{ name: 'page', type: 'list' }],
    intents: ['browse next page', 'view paginated content', 'continue pagination', 'open more list pages'],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'read public catalog metadata',
    description: 'Read public metadata structure from discovered catalog routes without storing raw page bodies.',
    object: 'public catalog metadata',
    userValue: '读取公开目录元数据。',
    nodes: publicMetadataNodes,
    outputs: [{ name: 'metadata', type: 'sanitized_summary' }],
    intents: ['读取公开目录元数据', '总结目录元数据', '查看公开条目信息', '提取公开列表摘要', 'read public catalog metadata', 'summarize catalog metadata', 'view public item information', 'extract public list summary'],
  });

  if (searchForm && !capabilities.some((capability) => capability.name === 'search catalog content')) {
    const capability = makeCapability(context, {
      name: 'search catalog content',
      description: 'Prepare a read-only search query against the discovered catalog search form.',
      action: 'search',
      object: 'catalog content',
      userValue: '搜索站内目录内容。',
      entryNodeIds: [searchForm.nodeId],
      requiredNodeIds: [searchForm.nodeId],
      inputs: searchForm.inputs?.length ? searchForm.inputs : [{ name: 'q', type: 'text', required: true }],
      outputs: [{ name: 'results', type: 'list' }],
      safetyLevel: 'read_only',
      evidence: searchForm.evidence,
      confidence: 0.9,
      autoGenerated: true,
      category: 'catalog',
      risk_level: 'read_public_low',
      enabled_status: 'enabled',
      evidence_status: 'verified',
      default_policy: 'read_only',
      intents: ['搜索目录内容', '搜索视频或作品', '按关键词查找内容', '查找目录条目', 'search catalog content', 'search videos or works', 'find content by keyword', 'find catalog item'],
    });
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'read_only',
      steps: [{
        kind: 'form_get',
        nodeId: searchForm.nodeId,
        selector: searchForm.selector,
        endpoint: searchForm.endpoint,
        method: searchForm.method,
        submit: false,
        querySlot: searchForm.inputs?.find((input) => input.name)?.name ?? 'q',
      }],
    });
    capabilities.push(capability);
  }

  if (knownPolicySupportsCatalogDownload(context) && !isChapterContentContext(context)) {
    addCatalogCoverageCapability(context, capabilities, {
      name: 'download catalog content',
      description: 'Compile discovered download-capable content as a direct downloader task descriptor.',
      action: 'download',
      object: 'catalog content',
      userValue: 'Download catalog content through the compiled downloader capability.',
      nodes: details.length ? details : publicMetadataNodes,
      outputs: [{ name: 'download_task', type: 'downloader_task_descriptor' }],
      intents: ['download catalog content', 'download video', 'save catalog item', 'download work'],
      confidence: 0.5,
      status: 'active',
      riskLevel: 'download_high',
    });
  }
}

function addChapterContentCoverageCapabilities(context, capabilities, graph, searchForm) {
  if (!isChapterContentContext(context) && !hasChapterContentCoverageSignals(graph.nodes ?? [])) {
    return;
  }
  const readableNodes = graph.nodes.filter((node) => ['page', 'content', 'route', 'route_template', 'form'].includes(node.type));
  const categories = catalogCoverageNodes(readableNodes, [], ['book_category_list']);
  const rankings = catalogCoverageNodes(readableNodes, [], ['book_ranking_list']);
  const collections = catalogCoverageNodes(readableNodes, [], ['book_collection_list', 'chapter_content_home']);
  const bookDetails = catalogCoverageNodes(readableNodes, [], ['book_detail']);
  const chapterDetails = catalogCoverageNodes(readableNodes, [], ['chapter_detail']);
  const searchNodes = catalogCoverageNodes(readableNodes, [], ['book_search_results', 'book_search_form']);
  const metadataNodes = [
    ...collections,
    ...categories,
    ...rankings,
    ...bookDetails,
    ...chapterDetails,
    ...searchNodes,
  ].slice(0, 80);
  const hasChapterStructureEvidence = metadataNodes.some((node) => nodeHasPublicStructureEvidence(node));
  const chapterSemanticPriority = 2;

  addCatalogCoverageCapability(context, capabilities, {
    name: 'browse book categories',
    description: 'Browse discovered public book category routes using sanitized route and structure evidence.',
    object: 'book categories',
    userValue: '\u6d4f\u89c8\u516c\u5f00\u56fe\u4e66\u5206\u7c7b\u8def\u7531\u3002',
    nodes: categories,
    outputs: [{ name: 'book_categories', type: 'list' }],
    intents: [
      '\u6d4f\u89c8\u56fe\u4e66\u5206\u7c7b',
      '\u6253\u5f00\u56fe\u4e66\u5206\u7c7b',
      '\u6309\u5206\u7c7b\u67e5\u770b\u5c0f\u8bf4',
      'browse book categories',
    ],
    allowRouteOnlyEvidence: hasChapterStructureEvidence,
    semanticPriority: chapterSemanticPriority,
  });
  addCatalogCoverageCapability(context, capabilities, {
    name: 'browse book rankings',
    description: 'Browse discovered public ranking routes for books and serialized works.',
    object: 'book rankings',
    userValue: '\u67e5\u770b\u516c\u5f00\u56fe\u4e66\u699c\u5355\u548c\u6392\u884c\u8def\u7531\u3002',
    nodes: rankings,
    outputs: [{ name: 'book_rankings', type: 'list' }],
    intents: ['\u67e5\u770b\u56fe\u4e66\u699c\u5355', '\u6253\u5f00\u5c0f\u8bf4\u6392\u884c', '\u67e5\u770b\u70ed\u95e8\u4f5c\u54c1', 'browse book rankings', 'view ranking list', 'open popular books'],
    allowRouteOnlyEvidence: hasChapterStructureEvidence,
    semanticPriority: chapterSemanticPriority,
  });
  addCatalogCoverageCapability(context, capabilities, {
    name: 'browse book collections',
    description: 'Browse discovered public book collection or recommendation lists without saving book body text.',
    object: 'book collections',
    userValue: '\u6d4f\u89c8\u516c\u5f00\u56fe\u4e66\u4e66\u5e93\u3001\u63a8\u8350\u548c\u5217\u8868\u8def\u7531\u3002',
    nodes: collections,
    outputs: [{ name: 'book_entries', type: 'list' }],
    intents: ['\u6d4f\u89c8\u5c0f\u8bf4\u4e66\u5e93', '\u67e5\u770b\u56fe\u4e66\u5217\u8868', '\u6253\u5f00\u516c\u5f00\u4f5c\u54c1\u5217\u8868', 'browse book collections', 'view book lists', 'open public novel list'],
    allowRouteOnlyEvidence: hasChapterStructureEvidence,
    semanticPriority: chapterSemanticPriority,
  });
  addCatalogCoverageCapability(context, capabilities, {
    name: 'open book detail',
    description: 'Open discovered public book detail routes from sanitized route-template evidence.',
    object: 'book detail',
    userValue: '\u6253\u5f00\u516c\u5f00\u56fe\u4e66\u8be6\u60c5\u9875\u3002',
    nodes: bookDetails,
    outputs: [{ name: 'book_detail', type: 'entity' }],
    intents: ['\u6253\u5f00\u56fe\u4e66\u8be6\u60c5', '\u67e5\u770b\u5c0f\u8bf4\u9875\u9762', '\u6253\u5f00\u4f5c\u54c1\u4fe1\u606f', 'open book detail', 'view book detail', 'open novel page'],
    allowRouteOnlyEvidence: hasChapterStructureEvidence,
    semanticPriority: chapterSemanticPriority,
  });
  addCatalogCoverageCapability(context, capabilities, {
    name: 'open chapter',
    description: 'Open discovered public chapter routes without storing chapter body text.',
    object: 'chapter route',
    userValue: '\u6253\u5f00\u516c\u5f00\u7ae0\u8282\u8def\u7531\uff0c\u4e0d\u4fdd\u5b58\u7ae0\u8282\u6b63\u6587\u3002',
    nodes: chapterDetails,
    outputs: [{ name: 'chapter_route', type: 'entity' }],
    intents: ['\u6253\u5f00\u7ae0\u8282', '\u67e5\u770b\u7ae0\u8282\u9875', '\u6253\u5f00\u516c\u5f00\u7ae0\u8282', 'open chapter', 'view chapter page', 'open public chapter'],
    allowRouteOnlyEvidence: hasChapterStructureEvidence,
    semanticPriority: chapterSemanticPriority,
  });
  addCatalogCoverageCapability(context, capabilities, {
    name: 'read public book metadata',
    description: 'Read public book-list and detail metadata structure without storing page body or chapter text.',
    object: 'public book metadata',
    userValue: '\u8bfb\u53d6\u516c\u5f00\u56fe\u4e66\u5143\u6570\u636e\u548c\u5217\u8868\u6458\u8981\u3002',
    nodes: metadataNodes,
    outputs: [{ name: 'book_metadata', type: 'sanitized_summary' }],
    intents: ['\u8bfb\u53d6\u516c\u5f00\u56fe\u4e66\u5143\u6570\u636e', '\u603b\u7ed3\u4e66\u7c4d\u5217\u8868\u6458\u8981', '\u67e5\u770b\u516c\u5f00\u5c0f\u8bf4\u4fe1\u606f', 'read public book metadata', 'summarize book list metadata', 'view public novel metadata'],
    semanticPriority: chapterSemanticPriority,
  });

  if ((searchForm || searchNodes.length) && !capabilities.some((capability) => capability.name === 'search books')) {
    const nodes = searchForm
      ? graph.nodes.filter((node) => node.id === searchForm.nodeId)
      : searchNodes;
    const capability = makeCapability(context, {
      name: 'search books',
      description: 'Prepare a read-only public book search using a discovered GET search form or search route.',
      action: 'search',
      object: 'books',
      userValue: '\u6309\u5173\u952e\u8bcd\u641c\u7d22\u516c\u5f00\u56fe\u4e66\u6216\u5c0f\u8bf4\u3002',
      entryNodeIds: nodes.slice(0, 10).map((node) => node.id),
      requiredNodeIds: nodes.slice(0, 10).map((node) => node.id),
      inputs: searchForm?.inputs?.length ? searchForm.inputs : [{ name: 'q', type: 'text', required: true }],
      outputs: [{ name: 'book_results', type: 'list' }],
      safetyLevel: 'read_only',
      evidence: searchForm?.evidence ?? catalogCoverageEvidence(context, nodes, 'search books'),
      confidence: searchForm ? 0.9 : 0.72,
      autoGenerated: true,
      category: 'chapter-content',
      semanticPriority: chapterSemanticPriority,
      risk_level: 'read_public_low',
      enabled_status: 'enabled',
      evidence_status: 'verified',
      default_policy: 'read_only',
      evidenceModel: !searchForm && hasChapterStructureEvidence ? 'public_route_navigation' : 'public_structure',
      publicRouteOnly: !searchForm && hasChapterStructureEvidence,
      intents: ['\u641c\u7d22\u56fe\u4e66', '\u6309\u5173\u952e\u8bcd\u627e\u5c0f\u8bf4', '\u641c\u7d22\u8fde\u8f7d\u4f5c\u54c1', 'search books', 'find novels by keyword', 'search serialized works'],
    });
    if (searchForm) {
      capability.executionPlan = buildExecutionPlan(capability.id, {
        mode: 'read_only',
        steps: [{
          kind: 'form_get',
          nodeId: searchForm.nodeId,
          selector: searchForm.selector,
          endpoint: searchForm.endpoint,
          method: searchForm.method,
          submit: false,
          querySlot: searchForm.inputs?.find((input) => input.name)?.name ?? 'q',
        }],
      });
    } else if (nodes.length) {
      capability.executionPlan = buildExecutionPlan(capability.id, {
        mode: 'read_only',
        steps: catalogCoverageSteps(nodes),
      });
    }
    capabilities.push(capability);
  }

  if (knownPolicySupportsBookDownload(context) && !capabilities.some((capability) => capability.name === 'download book')) {
    const nodes = arrayUniqueBy([
      ...bookDetails,
      ...chapterDetails,
      ...searchNodes,
      ...metadataNodes,
    ], (node) => node.id).slice(0, 80);
    if (nodes.length) {
      const descriptor = knownPolicyChapterDownloaderDescriptor(context);
      const capability = makeCapability(context, {
        name: 'download book',
        description: 'Resolve a public book from a search result, book URL, or title and write extracted chapter body text to local TXT artifacts.',
        action: 'download',
        object: 'public book text',
        userValue: '\u4e0b\u8f7d\u641c\u7d22\u5230\u7684\u516c\u5f00\u5c0f\u8bf4\u6b63\u6587\u4e3a\u672c\u5730 TXT\u3002',
        entryNodeIds: nodes.slice(0, 20).map((node) => node.id),
        requiredNodeIds: nodes.slice(0, 20).map((node) => node.id),
        inputs: [
          { name: 'book_title', type: 'text', required: false },
          { name: 'book_url', type: 'url', required: false },
          { name: 'output_dir', type: 'path', required: false },
        ],
        outputs: [
          { name: 'download_file', type: 'file_path' },
          { name: 'manifest_path', type: 'file_path' },
          { name: 'chapter_count', type: 'number' },
          { name: 'final_url', type: 'url' },
        ],
        safetyLevel: 'read_only',
        evidence: catalogCoverageEvidence(context, nodes, 'download book'),
        confidence: 0.84,
        autoGenerated: true,
        category: 'chapter-content',
        mode: 'download',
        providerId: 'known_site_downloader',
        risk_level: 'download_high',
        enabled_status: 'enabled',
        evidence_status: 'verified',
        default_policy: 'read_only',
        evidenceModel: 'public_chapter_content_downloader',
        publicRouteOnly: false,
        downloaderTaskDescriptor: descriptor,
        intents: [
          '\u4e0b\u8f7d\u5c0f\u8bf4',
          '\u4e0b\u8f7d\u641c\u7d22\u5230\u7684\u4f5c\u54c1',
          '\u63d0\u53d6\u5c0f\u8bf4\u6b63\u6587',
          '\u5bfc\u51fa\u5168\u4e66 TXT',
          'download book',
          'download searched novel',
          'extract book text',
        ],
      });
      capability.executionPlan = buildExecutionPlan(capability.id, {
        mode: 'download',
        dryRunOnly: false,
        requiresConfirmation: false,
        autoExecute: false,
        governedExecution: false,
        executionDisposition: 'allow',
        savedMaterial: SANITIZED_SUMMARY_ONLY,
        steps: [{
          kind: 'downloader_task_descriptor',
          siteKey: descriptor.siteKey,
          adapterId: descriptor.adapterId,
          taskType: descriptor.taskType,
          nodeIds: nodes.slice(0, 20).map((node) => node.id),
          slotNames: ['book_title', 'book_url', 'output_dir'],
          submit: true,
          finalSubmit: false,
          autoExecute: false,
          governedExecution: false,
          executionDisposition: 'allow',
          savedMaterial: SANITIZED_SUMMARY_ONLY,
          artifactMaterial: descriptor.artifactMaterial,
          downloaderTaskDescriptor: descriptor,
        }],
      });
      capabilities.push(capability);
    }
  }
}

function authenticatedKnownSiteRouteStructureScore(node = /** @type {any} */ ({})) {
  if (!node) {
    return 0;
  }
  if (node.routeProofOnly === true) {
    return 0;
  }
  if (!['authenticated', 'authenticated_overlay'].includes(nodeSourceLayer(node))) {
    return 0;
  }
  return [
    Number(node.visibleItemCount ?? 0) || 0,
    node.listPresent === true ? 4 : 0,
    node.emptyStatePresent === true ? 3 : 0,
    node.evidenceStatus === 'structure_summary_present' ? 2 : 0,
    node.evidenceLevel === 'browser_structure_verified' ? 2 : 0,
    node.providerId === 'browser_bridge' ? 1 : 0,
  ].reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
}

function knownSiteCapabilityRouteTargets(setupCapabilityId, intentAction, name) {
  const tokens = [
    setupCapabilityId,
    intentAction,
    name,
  ].map(normalizeSetupCapabilityId).filter(Boolean);
  const has = (...values) => values.some((value) => tokens.includes(normalizeSetupCapabilityId(value)));
  if (has('list-followed-users', 'followed-users')) return ['/:account/following', '/follow'];
  if (has('list-user-following', 'user-following')) return ['/people/:account/following', '/people/{urlToken}/following'];
  if (has('list-notifications', 'notifications')) return ['/notifications'];
  if (has('list-bookmarks', 'bookmarks')) return ['/i/bookmarks'];
  if (has('list-lists', 'lists')) return ['/i/lists'];
  if (has('list-hot-posts', 'hot-posts', 'hot-list', 'open-category')) return ['/hot'];
  if (has('list-hot-broadcasts', 'hot-broadcasts')) return ['/drama/feed'];
  if (has('list-topic-discussions', 'topic-discussions')) return ['/topic/:topicId/hot', '/topic/{topicId}/hot'];
  if (has('list-topic-featured', 'topic-featured')) return ['/topic/:topicId/top-answers', '/topic/{topicId}/top-answers'];
  if (has('recommended-timeline-posts', 'list-recommended-timeline-posts')) return ['/home', '/'];
  if (has('list-explore-topics', 'explore-topics')) return ['/explore'];
  if (has('search-posts', 'search', 'search-users', 'search-latest-posts', 'search-media-posts', 'read-search-result-summaries', 'open-search-result-detail')) return ['/search'];
  if (has('list-user-activities', 'user-activities')) return ['/people/:account/activities', '/people/{urlToken}/activities'];
  if (has('list-user-answers', 'user-answers')) return ['/people/:account/answers', '/people/{urlToken}/answers'];
  if (has('list-user-questions', 'user-questions')) return ['/people/:account/asks', '/people/{urlToken}/asks'];
  if (has('list-user-articles', 'user-articles')) return ['/people/:account/posts', '/people/{urlToken}/posts'];
  if (has('list-user-columns', 'user-columns')) return ['/people/:account/columns', '/people/{urlToken}/columns'];
  if (has('list-user-pins', 'user-pins')) return ['/people/:account/pins', '/people/{urlToken}/pins'];
  if (has('list-user-collections', 'user-collections')) return ['/people/:account/collections', '/people/{urlToken}/collections'];
  if (has('list-user-videos', 'user-videos')) return ['/people/:account/zvideos', '/people/{urlToken}/zvideos'];
  if (has('list-profile-content', 'profile-content', 'read-user-recent-posts', 'read-followers', 'open-author')) return ['/people/:account', '/org/:account'];
  if (has('read-media-summary', 'media-summary')) return ['/people/:account/zvideos', '/people/{urlToken}/zvideos', '/people/:account', '/org/:account'];
  if (has('view-question-detail', 'question-detail')) return ['/question/:questionId'];
  if (has('view-answer-detail', 'answer-detail')) return ['/question/:questionId/answer/:answerId', '/answer/:answerId'];
  if (has('view-post-detail', 'post-detail', 'view-post-replies', 'post-replies')) return [
    '/question/:questionId',
    '/question/:questionId/answer/:answerId',
    '/answer/:answerId',
    '/p/:postId',
    '/zvideo/:videoId',
  ];
  return [];
}

function comparableKnownSiteRouteTarget(value) {
  return String(value ?? '')
    .replace(/\/+$/u, '')
    .replace(/:[^/]+/gu, ':param')
    .replace(/\{[^/}]+\}/gu, ':param')
    || '/';
}

function knownSiteRouteTargetPath(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  try {
    return new URL(raw).pathname.replace(/\/+$/u, '') || '/';
  } catch {
    const pathOnly = raw.split(/[?#]/u)[0].trim();
    return (pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`).replace(/\/+$/u, '') || '/';
  }
}

function isKnownSiteParameterizedSegment(segment) {
  return /^:[^/]+$/u.test(String(segment ?? '')) || /^\{[^/}]+\}$/u.test(String(segment ?? ''));
}

function knownSiteRouteTargetMatches(targetValue, candidateValue) {
  const target = knownSiteRouteTargetPath(targetValue);
  const candidate = knownSiteRouteTargetPath(candidateValue);
  if (!target || !candidate) {
    return false;
  }
  if (comparableKnownSiteRouteTarget(target) === comparableKnownSiteRouteTarget(candidate)) {
    return true;
  }
  const targetSegments = target.split('/').filter(Boolean);
  const candidateSegments = candidate.split('/').filter(Boolean);
  if (targetSegments.length !== candidateSegments.length) {
    return false;
  }
  return targetSegments.every((targetSegment, index) => {
    const candidateSegment = candidateSegments[index];
    const targetParameterized = isKnownSiteParameterizedSegment(targetSegment);
    const candidateParameterized = isKnownSiteParameterizedSegment(candidateSegment);
    return targetSegment === candidateSegment
      || (targetParameterized && (candidateParameterized || String(candidateSegment ?? '').trim().length > 0));
  });
}

function knownSiteCapabilityRouteNode(graph, targets = /** @type {string[]} */ ([])) {
  if (!targets.length) {
    return null;
  }
  const routePath = (node) => {
    try {
      return new URL(node.normalizedUrl ?? node.url).pathname;
    } catch {
      return null;
    }
  };
  return (graph?.nodes ?? [])
    .filter((node) => node.type === 'page')
    .filter((node) => {
      const routeTemplate = node.routeTemplate ?? node.routePattern;
      const path = routePath(node);
      return targets.some((target) => (
        knownSiteRouteTargetMatches(target, routeTemplate)
        || knownSiteRouteTargetMatches(target, path)
      ));
    })
    .sort((left, right) => (
      authenticatedKnownSiteRouteStructureScore(right) - authenticatedKnownSiteRouteStructureScore(left)
      || String(left.id ?? '').localeCompare(String(right.id ?? ''), 'en')
    ))[0] ?? null;
}

function addUserAuthorizedKnownSiteCapabilities(context, capabilities, homepage, graph) {
  const setupEvidencePages = userAuthorizedEvidencePages(context);
  const authenticatedGraphPages = (graph?.nodes ?? [])
    .filter((node) => node.type === 'page')
    .filter((node) => authenticatedKnownSiteRouteStructureScore(node) > 0);
  const evidenceHomepage = setupEvidencePages.find((page) => page.pageType === 'home' || page.routeTemplate === '/')
    ?? setupEvidencePages[0]
    ?? authenticatedGraphPages.find((page) => page.pageType === 'home' || page.routeTemplate === '/')
    ?? authenticatedGraphPages[0]
    ?? null;
  const entryHomepage = homepage ?? evidenceHomepage;
  const hasSetupEvidencePages = setupEvidencePages.length > 0;
  const hasAuthenticatedGraphEvidencePages = authenticatedGraphPages.length > 0;
  const hasBrowserBridgeEvidencePage = entryHomepage?.providerId === 'browser_bridge'
    || /^authenticated/iu.test(String(entryHomepage?.sourceLayer ?? ''));
  if (
    !entryHomepage
    || !context.setupProfile?.knownSitePolicy
    || (!hasSetupEvidencePages && !hasAuthenticatedGraphEvidencePages && !hasBrowserBridgeEvidencePage)
  ) {
    return;
  }
  const supported = knownPolicySupportedIntents(context);
  const knownSitePolicy = context.setupProfile.knownSitePolicy;
  const supportsSocialContent = policySupportsCapabilityFamily(knownSitePolicy, 'query-social-content');
  const supportsSocialRelations = policySupportsCapabilityFamily(knownSitePolicy, 'query-social-relations');
  const supportsAccountProfile = policySupportsCapabilityFamily(knownSitePolicy, 'query-account-profile');
  const selected = selectedSetupCapabilityIds(context);
  const browserSeedCapabilities = userAuthorizedBrowserSeedCapabilityIds(context);
  const siteKey = context.setupProfile.knownSitePolicy.siteKey ?? context.setupProfile.knownSitePolicy.adapterId ?? context.site.id;
  const useZhihuPersonalRisk = isZhihuKnownSiteContext(context);
  if (!useZhihuPersonalRisk) {
    return;
  }
  const canExposeSeededCapability = (...ids) => ids
    .map(normalizeSetupCapabilityId)
    .some((id) => id && (supported.has(id) || browserSeedCapabilities.has(id)));
  const baseEvidence = [
    ...(entryHomepage.evidence ?? []),
    buildEvidence({
      type: 'text',
      source: entryHomepage.normalizedUrl,
      text: 'Known-site policy combined with user-authorized browser evidence summary; no raw session material persisted.',
      confidence: 0.82,
    }),
  ];
  const add = ({
    name,
    description,
    action = 'view',
    object,
    userValue,
    intentAction,
    setupCapabilityId,
    inputs = /** @type {any[]} */ ([]),
    outputs = [{ name: 'items', type: 'list' }],
    safetyLevel = 'read_only',
    riskLevel = null,
  }) => {
    const routeNode = knownSiteCapabilityRouteNode(
      graph,
      knownSiteCapabilityRouteTargets(setupCapabilityId, intentAction, name),
    );
    const entryNode = authenticatedKnownSiteRouteStructureScore(routeNode) > 0 ? routeNode : entryHomepage;
    const routeStructureVerified = entryNode && entryNode !== entryHomepage;
    const proof = findCapabilityProof(context, setupCapabilityId, intentAction);
    const capabilityVerified = Boolean(proof) || routeStructureVerified;
    const normalizedSetupCapabilityId = normalizeSetupCapabilityId(setupCapabilityId);
    const normalizedIntentAction = normalizeSetupCapabilityId(intentAction);
    const pendingSupplementalProof = userAuthorizedCapabilityProofs(context).some((candidateProof) => {
      if (!candidateProof || candidateProof.status === 'verified') {
        return false;
      }
      const proofIds = [
        candidateProof.capabilityId,
        candidateProof.setupCapabilityId,
        candidateProof.intentType,
        candidateProof.action,
      ].map(normalizeSetupCapabilityId).filter(Boolean);
      return proofIds.includes(normalizedSetupCapabilityId)
        || proofIds.includes(normalizedIntentAction);
    });
    const selectedBySetup = selected.has(normalizedSetupCapabilityId);
    const browserSeedBacked = browserSeedCapabilities.has(normalizedSetupCapabilityId)
      || browserSeedCapabilities.has(normalizedIntentAction);
    const activationBlockedReason = capabilityVerified
      ? null
      : selectedBySetup
        ? 'capability-specific-evidence-required'
        : browserSeedBacked
          ? 'authorized-route-seed-only'
          : 'not-selected-by-setup';
    const capability = makeCapability(context, {
      name,
      description,
      action,
      object,
      userValue,
      entryNodeIds: [entryNode.id].filter(Boolean),
      inputs,
      outputs,
      safetyLevel,
      ...(riskLevel ? { risk_level: riskLevel } : {}),
      evidence: entryNode === entryHomepage
        ? baseEvidence
        : [
          ...(entryNode.evidence ?? []),
          buildEvidence({
            type: 'text',
            source: entryNode.normalizedUrl,
            text: 'Known-site capability matched to a sanitized Browser Bridge route structure summary; no raw session material or private body text persisted.',
            confidence: 0.84,
          }),
        ],
      confidence: capabilityVerified ? 0.86 : 0.58,
      status: capabilityVerified ? 'active' : 'candidate',
      setupCapabilityId,
      requiresCapabilityEvidence: true,
      capabilityVerified,
      pendingSupplementalProof,
      selectedBySetup,
      browserSeedBacked,
      activationBlockedReason,
      proofSummary: proof ? {
        status: proof.status,
        evidenceType: proof.evidenceType ?? proof.type ?? null,
        sampleCount: Number(proof.sampleCount ?? proof.itemCount ?? proof.evidenceCount ?? 0),
      } : routeStructureVerified ? {
        status: 'verified',
        evidenceType: 'browser_bridge_route_structure',
        sampleCount: Math.max(0, Number(entryNode.visibleItemCount ?? 0) || 0),
      } : null,
    });
    if (capabilityVerified) {
      const requiresConfirmation = safetyLevel !== 'read_only';
      capability.executionPlan = buildExecutionPlan(capability.id, {
        mode: requiresConfirmation ? 'dry_run' : 'read_only',
        dryRunOnly: requiresConfirmation,
        requiresConfirmation,
        autoExecute: false,
        steps: [{
          kind: 'site_action',
          siteKey,
          action: intentAction,
          url: entryNode.normalizedUrl,
          nodeId: entryNode.id,
          routeTemplate: entryNode.routeTemplate ?? null,
          routeStateId: entryNode.routeState?.stateId ?? entryNode.stateKey ?? null,
          tabState: entryNode.tabState ?? null,
          pageKind: entryNode.pageType ?? null,
          requiresUserAuthorization: true,
          submit: false,
          autoExecute: false,
        }],
      });
    }
    capabilities.push(capability);
  };
  if (supportsSocialRelations) {
    add({
      name: 'list followed users',
      description: 'List followed users through the bounded known-site adapter using user-authorized browser state.',
      object: 'followed users',
      userValue: 'Inspect followed accounts without account mutation.',
      intentAction: 'followed-users',
      setupCapabilityId: 'list-followed-users',
      riskLevel: useZhihuPersonalRisk ? 'read_personal_medium' : null,
    });
  }
  if (supportsSocialContent) {
    add({
      name: 'list followed updates',
      description: 'List followed updates through the bounded known-site adapter using user-authorized browser state.',
      object: 'followed updates',
      userValue: 'Read updates from followed accounts without posting or mutating account state.',
      intentAction: 'followed-posts-by-date',
      setupCapabilityId: 'list-followed-updates',
      riskLevel: useZhihuPersonalRisk ? 'read_personal_medium' : null,
    });
  }
  if (supportsSocialContent) {
    add({
      name: 'list recommended timeline posts',
      description: 'List recommended timeline posts through a bounded user-authorized known-site adapter path.',
      object: 'recommended timeline posts',
      userValue: 'Read personalized recommended timeline posts without posting, liking, following, or account mutation.',
      intentAction: 'recommended-timeline-posts',
      setupCapabilityId: 'recommended-timeline-posts',
      riskLevel: useZhihuPersonalRisk ? 'read_personal_medium' : null,
    });
  }
  if (supportsSocialContent || supported.has('list-hot-posts') || supported.has('open-category')) {
    add({
      name: 'list hot posts',
      description: 'List hot posts through a bounded user-authorized known-site adapter path.',
      object: 'hot posts',
      userValue: 'Read Zhihu hot-list summaries without voting, following, collecting, commenting, or storing answer bodies.',
      intentAction: 'hot-posts',
      setupCapabilityId: 'list-hot-posts',
      outputs: [{ name: 'hot_posts', type: 'list' }],
    });
  }
  if (supportsSocialContent || supported.has('list-hot-broadcasts')) {
    add({
      name: 'list hot broadcasts',
      description: 'List hot broadcast summaries through a bounded user-authorized known-site adapter path.',
      object: 'hot broadcasts',
      userValue: 'Read Zhihu hot broadcast summaries without downloading media, posting, liking, following, or account mutation.',
      intentAction: 'hot-broadcasts',
      setupCapabilityId: 'list-hot-broadcasts',
      outputs: [{ name: 'hot_broadcasts', type: 'list' }],
      riskLevel: useZhihuPersonalRisk ? 'read_personal_medium' : null,
    });
  }
  if (supportsSocialContent || supported.has('list-topic-discussions')) {
    add({
      name: 'list topic discussions',
      description: 'List topic discussion summaries through a bounded known-site read-only path.',
      object: 'topic discussions',
      userValue: 'Read Zhihu topic discussion summaries without posting, following, voting, or storing body text.',
      intentAction: 'topic-discussions',
      setupCapabilityId: 'list-topic-discussions',
      inputs: [{ name: 'topic_id', type: 'string', required: false }],
      outputs: [{ name: 'topic_discussions', type: 'list' }],
    });
  }
  if (supportsSocialContent || supported.has('list-topic-featured')) {
    add({
      name: 'list topic featured',
      description: 'List topic featured answer summaries through a bounded known-site read-only path.',
      object: 'topic featured answers',
      userValue: 'Read Zhihu topic featured answer summaries without posting, following, voting, or storing answer bodies.',
      intentAction: 'topic-featured',
      setupCapabilityId: 'list-topic-featured',
      inputs: [{ name: 'topic_id', type: 'string', required: false }],
      outputs: [{ name: 'topic_featured_answers', type: 'list' }],
    });
  }
  if (canExposeSeededCapability('list-explore-topics', 'explore-topics')) {
    add({
      name: 'list explore topics',
      description: 'List explore topics through a bounded user-authorized known-site adapter path.',
      object: 'explore topics',
      userValue: 'Read Explore topic summaries without posting, following, or account mutation.',
      intentAction: 'explore-topics',
      setupCapabilityId: 'list-explore-topics',
    });
  }
  if (supportsSocialContent || supportsAccountProfile) {
    add({
      name: 'list profile content',
      description: 'List profile content through the bounded known-site adapter.',
      object: 'profile content',
      userValue: 'Read profile content without posting or account mutation.',
      intentAction: 'profile-content',
      setupCapabilityId: 'list-profile-content',
      inputs: [{ name: 'account', type: 'string', required: false }],
      riskLevel: useZhihuPersonalRisk ? 'read_personal_medium' : null,
    });
  }
  for (const profileCapability of [
    {
      name: 'list user activities',
      object: 'user activities',
      setupCapabilityId: 'list-user-activities',
      intentAction: 'user-activities',
      outputName: 'user_activities',
      riskLevel: 'read_personal_medium',
    },
    {
      name: 'list user answers',
      object: 'user answers',
      setupCapabilityId: 'list-user-answers',
      intentAction: 'user-answers',
      outputName: 'user_answers',
    },
    {
      name: 'list user questions',
      object: 'user questions',
      setupCapabilityId: 'list-user-questions',
      intentAction: 'user-questions',
      outputName: 'user_questions',
    },
    {
      name: 'list user articles',
      object: 'user articles',
      setupCapabilityId: 'list-user-articles',
      intentAction: 'user-articles',
      outputName: 'user_articles',
    },
    {
      name: 'list user columns',
      object: 'user columns',
      setupCapabilityId: 'list-user-columns',
      intentAction: 'user-columns',
      outputName: 'user_columns',
    },
    {
      name: 'list user pins',
      object: 'user pins',
      setupCapabilityId: 'list-user-pins',
      intentAction: 'user-pins',
      outputName: 'user_pins',
      riskLevel: 'read_personal_medium',
    },
    {
      name: 'list user collections',
      object: 'user collections',
      setupCapabilityId: 'list-user-collections',
      intentAction: 'user-collections',
      outputName: 'user_collections',
      riskLevel: 'read_personal_medium',
    },
    {
      name: 'list user videos',
      object: 'user videos',
      setupCapabilityId: 'list-user-videos',
      intentAction: 'user-videos',
      outputName: 'user_videos',
    },
    {
      name: 'list user following',
      object: 'user following',
      setupCapabilityId: 'list-user-following',
      intentAction: 'user-following',
      outputName: 'user_following',
      riskLevel: 'read_personal_medium',
    },
  ]) {
    if (supportsSocialContent || supportsAccountProfile || supported.has(profileCapability.setupCapabilityId)) {
      add({
        name: profileCapability.name,
        description: `List Zhihu ${profileCapability.object} through the bounded known-site adapter.`,
        object: profileCapability.object,
        userValue: `Read sanitized Zhihu ${profileCapability.object} summaries without posting, following, voting, or account mutation.`,
        intentAction: profileCapability.intentAction,
        setupCapabilityId: profileCapability.setupCapabilityId,
        inputs: [{ name: 'account', type: 'string', required: false }],
        outputs: [{ name: profileCapability.outputName, type: 'list' }],
        riskLevel: useZhihuPersonalRisk ? profileCapability.riskLevel ?? 'read_public_low' : null,
      });
    }
  }
  if (supportsSocialContent) {
    add({
      name: 'read media summary',
      description: 'Read media summaries through the bounded known-site adapter without storing media bodies.',
      object: 'media summary',
      userValue: 'Read sanitized media summaries without downloading media or mutating account state.',
      intentAction: 'media-summary',
      setupCapabilityId: 'read-media-summary',
      inputs: [{ name: 'account', type: 'string', required: false }],
      outputs: [{ name: 'summary', type: 'sanitized_summary' }],
    });
    add({
      name: 'view post detail',
      description: 'View post detail through the bounded known-site adapter.',
      object: 'post detail',
      userValue: 'Open a sanitized post-detail summary without replying, liking, reposting, or storing body text.',
      intentAction: 'post-detail',
      setupCapabilityId: 'view-post-detail',
      inputs: [
        { name: 'account', type: 'string', required: false },
        { name: 'status_id', type: 'string', required: false },
      ],
      outputs: [{ name: 'summary', type: 'sanitized_summary' }],
    });
    add({
      name: 'view post replies',
      description: 'View post replies through the bounded known-site adapter.',
      object: 'post replies',
      userValue: 'Open sanitized reply summaries without replying, liking, reposting, or storing body text.',
      intentAction: 'post-replies',
      setupCapabilityId: 'view-post-replies',
      inputs: [
        { name: 'account', type: 'string', required: false },
        { name: 'status_id', type: 'string', required: false },
      ],
      outputs: [{ name: 'summary', type: 'sanitized_summary' }],
    });
  }
  if (supported.has('search-posts') || supported.has('search-content')) {
    add({
      name: 'search posts',
      description: 'Search posts through a bounded known-site read-only action.',
      action: 'search',
      object: 'posts',
      userValue: 'Search posts without submitting state-changing actions.',
      intentAction: 'search',
      setupCapabilityId: 'search-posts',
      inputs: [{ name: 'query', type: 'string', required: true }],
    });
    add({
      name: 'search users',
      description: 'Search users through a bounded known-site read-only action.',
      action: 'search',
      object: 'users',
      userValue: 'Search Zhihu user profiles without following, messaging, or account mutation.',
      intentAction: 'search-users',
      setupCapabilityId: 'search-users',
      inputs: [{ name: 'query', type: 'string', required: true }],
    });
    add({
      name: 'search latest posts',
      description: 'Search latest posts through a bounded known-site read-only action.',
      action: 'search',
      object: 'latest posts',
      userValue: 'Search recent Zhihu content without submitting state-changing actions.',
      intentAction: 'search-latest-posts',
      setupCapabilityId: 'search-latest-posts',
      inputs: [{ name: 'query', type: 'string', required: true }],
    });
    add({
      name: 'search media posts',
      description: 'Search media posts through a bounded known-site read-only action.',
      action: 'search',
      object: 'media posts',
      userValue: 'Search Zhihu media result summaries without downloading media or mutating account state.',
      intentAction: 'search-media-posts',
      setupCapabilityId: 'search-media-posts',
      inputs: [{ name: 'query', type: 'string', required: true }],
    });
    add({
      name: 'read search result summaries',
      description: 'Read search result summaries through a bounded known-site read-only action.',
      object: 'search result summaries',
      userValue: 'Read sanitized Zhihu search result summaries without storing result bodies.',
      intentAction: 'read-search-result-summaries',
      setupCapabilityId: 'read-search-result-summaries',
      inputs: [{ name: 'query', type: 'string', required: true }],
      outputs: [{ name: 'summaries', type: 'sanitized_summary' }],
    });
    add({
      name: 'open search result detail',
      description: 'Open a search result detail through the bounded known-site read-only path.',
      object: 'search result detail',
      userValue: 'Open a sanitized Zhihu search result detail without voting, commenting, or storing body text.',
      intentAction: 'open-search-result-detail',
      setupCapabilityId: 'open-search-result-detail',
      inputs: [{ name: 'result_url', type: 'string', required: false }],
      outputs: [{ name: 'summary', type: 'sanitized_summary' }],
    });
  }
  if (supported.has('open-post') || supported.has('view-question-detail')) {
    add({
      name: 'view question detail',
      description: 'View question detail through a bounded known-site read-only action.',
      object: 'question detail',
      userValue: 'Open a sanitized Zhihu question-detail summary without voting, commenting, following, or storing answer bodies.',
      intentAction: 'question-detail',
      setupCapabilityId: 'view-question-detail',
      inputs: [{ name: 'question_id', type: 'string', required: false }],
      outputs: [{ name: 'summary', type: 'sanitized_summary' }],
    });
  }
  if (supported.has('open-post') || supported.has('view-answer-detail')) {
    add({
      name: 'view answer detail',
      description: 'View answer detail through a bounded known-site read-only action.',
      object: 'answer detail',
      userValue: 'Open a sanitized Zhihu answer-detail summary without voting, commenting, collecting, or storing answer bodies.',
      intentAction: 'answer-detail',
      setupCapabilityId: 'view-answer-detail',
      inputs: [
        { name: 'question_id', type: 'string', required: false },
        { name: 'answer_id', type: 'string', required: false },
      ],
      outputs: [{ name: 'summary', type: 'sanitized_summary' }],
    });
  }
  if (canExposeSeededCapability('list-notifications', 'notifications')) {
    add({
      name: 'list notifications',
      description: 'List notifications through a bounded known-site read-only action after explicit capability evidence.',
      object: 'notifications',
      userValue: 'Read notification summaries without replying, following, liking, or mutating account state.',
      intentAction: 'notifications',
      setupCapabilityId: 'list-notifications',
      riskLevel: useZhihuPersonalRisk ? 'read_personal_medium' : null,
    });
  }
  if (canExposeSeededCapability('list-bookmarks', 'bookmarks')) {
    add({
      name: 'list bookmarks',
      description: 'List bookmarks through a bounded known-site read-only action after explicit capability evidence.',
      object: 'bookmarks',
      userValue: 'Read saved bookmark entries without posting or mutating account state.',
      intentAction: 'bookmarks',
      setupCapabilityId: 'list-bookmarks',
    });
  }
  if (canExposeSeededCapability('list-lists', 'lists')) {
    add({
      name: 'list lists',
      description: 'List user lists through a bounded known-site read-only action after explicit capability evidence.',
      object: 'lists',
      userValue: 'Read list metadata without following, creating, deleting, or mutating lists.',
      intentAction: 'lists',
      setupCapabilityId: 'list-lists',
    });
  }
  if (canExposeSeededCapability('list-direct-messages', 'direct-messages', 'messages')) {
    add({
      name: 'list direct messages',
      description: 'List direct-message conversation summaries only after explicit evidence; message text is not collected by setup.',
      object: 'direct message summaries',
      userValue: 'Inspect private message conversation counts without sending messages or storing message content.',
      intentAction: 'direct-messages',
      setupCapabilityId: 'list-direct-messages',
      safetyLevel: 'requires_confirmation',
    });
  }
}

function apiCandidateCapabilityMetadata(stageResults = /** @type {any} */ ({})) {
  const networkSummary = stageResults.captureNetworkTraces?.summary?.sanitizedSummary
    ?? stageResults.captureNetworkTraces?.summary
    ?? {};
  const replaySummary = stageResults.apiAdapterReplay?.summary ?? {};
  const apiCandidateCount = Math.max(0, Number(networkSummary.apiCandidateCount ?? 0) || 0);
  const apiCandidateArtifacts = Array.isArray(networkSummary.apiCandidateArtifacts)
    ? networkSummary.apiCandidateArtifacts
    : [];
  const evidence = apiCandidateArtifacts.slice(0, 5).map((artifactPath, index) => buildEvidence({
    type: 'network',
    source: artifactPath,
    text: `API candidate artifact ${index + 1} of ${apiCandidateCount}`,
    confidence: 0.72,
  }));
  const rawTracesPersisted = networkSummary.rawTracesPersisted === true;
  const captureStatus = networkSummary.apiCandidateStatus ?? 'not_requested';
  return {
    apiCandidateCount,
    apiCandidateArtifacts,
    evidence,
    rawTracesPersisted,
    captureStatus,
    adapterValidationCount: Number(replaySummary.adapterDecisionCount ?? networkSummary.adapterValidationCount ?? 0) || 0,
    adapterAcceptedCount: Number(replaySummary.adapterAcceptedCount ?? networkSummary.adapterAcceptedCount ?? 0) || 0,
    replayVerifiedCount: Number(replaySummary.replayVerifiedCount ?? networkSummary.replayVerifiedCount ?? 0) || 0,
    activatedApiAdapterCount: Number(replaySummary.activatedApiAdapterCount ?? networkSummary.activatedApiAdapterCount ?? 0) || 0,
    adapterSkippedReasonCounts: replaySummary.skippedReasonCounts ?? networkSummary.adapterSkippedReasonCounts ?? {},
    description: apiCandidateCount > 0
      ? `Observed ${apiCandidateCount} redacted API candidate artifact(s) from network capture.`
      : rawTracesPersisted
        ? 'Raw network capture ran, but no API candidate artifacts were generated.'
        : 'Network API capture did not produce API candidate artifacts for this build.',
    userValue: apiCandidateCount > 0
      ? `Review ${apiCandidateCount} discovered API candidate(s)`
      : 'Review network API capture status',
    confidence: apiCandidateCount > 0 ? 0.55 : 0,
  };
}

function apiEndpointShortPath(endpoint) {
  try {
    const parsed = new URL(String(endpoint ?? ''));
    const pathPart = parsed.pathname.replace(/\/+/gu, '/').replace(/\/$/u, '') || '/';
    const queryKeys = [...parsed.searchParams.keys()].slice(0, 3);
    return `${pathPart}${queryKeys.length ? `?${queryKeys.join('&')}` : ''}`.slice(0, 80);
  } catch {
    return String(endpoint ?? '/api').replace(/^https?:\/\/[^/]+/iu, '').slice(0, 80) || '/api';
  }
}

function executableApiAdapterCapabilities(context, stageResults = /** @type {any} */ ({}), graph = /** @type {any} */ ({}), homepage = null) {
  const activatedAdapters = Array.isArray(stageResults.apiAdapterReplay?.activatedAdapters)
    ? stageResults.apiAdapterReplay.activatedAdapters
    : [];
  if (!activatedAdapters.length) {
    return [];
  }
  const pageNodes = graph.nodes?.filter((node) => node.type === 'page') ?? [];
  const authNode = pageNodes.find((node) => node.authRequired === true || isAuthenticatedSourceLayer(nodeSourceLayer(node)));
  const entryNode = authNode ?? homepage ?? pageNodes[0] ?? null;
  return activatedAdapters.map((adapter, index) => {
    const semantics = adapter.apiSemantics && typeof adapter.apiSemantics === 'object'
      ? adapter.apiSemantics
      : null;
    const shortPath = apiEndpointShortPath(adapter.endpoint);
    const capabilityName = String(semantics?.name ?? '').trim() || `read API endpoint ${shortPath}`;
    const capabilityObject = String(semantics?.object ?? '').trim() || 'API endpoint';
    const outputName = String(semantics?.outputName ?? '').trim() || 'response';
    const outputType = String(semantics?.outputType ?? '').trim() || 'api_response_summary';
    const intentExamples = Array.isArray(semantics?.intentExamples) && semantics.intentExamples.length
      ? semantics.intentExamples.map((example) => String(example ?? '').trim()).filter(Boolean).slice(0, 6)
      : [
        `read API endpoint ${shortPath}`,
        `call replay verified API endpoint ${shortPath}`,
        `read replay verified API ${shortPath}`,
      ];
    const capability = makeCapability(context, {
      name: capabilityName,
      description: String(semantics?.description ?? '').trim()
        || `Read replay-verified same-site API endpoint ${shortPath} through the Browser Bridge runtime.`,
      action: 'view',
      object: capabilityObject,
      userValue: String(semantics?.userValue ?? '').trim() || `Read API endpoint ${shortPath}`,
      entryNodeIds: entryNode ? [entryNode.id] : [],
      outputs: [{ name: outputName, type: outputType }],
      safetyLevel: 'read_only',
      evidence: [
        buildEvidence({
          type: 'network',
          source: adapter.candidateRef,
          text: `API candidate ${adapter.candidateId ?? index + 1} was observed and redacted.`,
          confidence: 0.72,
        }),
        buildEvidence({
          type: 'network',
          source: adapter.adapterDecisionRef,
          text: 'SiteAdapter accepted the API candidate as same-site read-only candidate evidence.',
          confidence: 0.78,
        }),
        buildEvidence({
          type: 'network',
          source: adapter.replayVerificationRef,
          text: 'Build-time browser-auth replay verified this API candidate; response body was not persisted.',
          confidence: 0.84,
        }),
      ],
      confidence: 0.78,
      status: 'active',
      informational: false,
      authRequired: true,
      sourceLayer: 'authenticated',
      providerId: 'browser_bridge',
      evidenceModel: 'api_adapter_replay_verified',
      apiReplayVerified: true,
      enabled_status: 'enabled',
      default_policy: 'enabled',
      evidence_status: 'verified',
      risk_level: 'read_personal_medium',
      apiAdapter: {
        candidateRef: adapter.candidateRef,
        adapterDecisionRef: adapter.adapterDecisionRef,
        replayVerificationRef: adapter.replayVerificationRef,
        runtimeBindingId: adapter.runtimeBindingId,
        semanticKind: semantics?.semanticKind ?? null,
        method: adapter.method,
        redactedEndpoint: adapter.endpoint,
        authBoundary: adapter.authBoundary,
        responsePolicy: adapter.responsePolicy,
        runtimeParameterSource: adapter.runtimeParameterSource ?? null,
        responseEvidence: adapter.responseEvidence ?? null,
        runtime: 'browser_bridge_required',
        requiresFreshBridgeEvidence: true,
        genericHttpRuntimeAllowed: false,
      },
      intents: [{
        canonicalUtterance: capabilityName,
        utteranceExamples: intentExamples,
        negativeExamples: ['submit API request', 'update account settings', 'send a POST request'],
        slots: [],
        invocationScore: 0.74,
      }],
    });
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'limited_read',
      dryRunOnly: false,
      requiresConfirmation: false,
      autoExecute: false,
      steps: [{
        kind: 'api_request',
        method: adapter.method,
        endpoint: adapter.endpoint,
        runtimeBindingId: adapter.runtimeBindingId,
        candidateRef: adapter.candidateRef,
        adapterDecisionRef: adapter.adapterDecisionRef,
        replayVerificationRef: adapter.replayVerificationRef,
        runtimeParameterSource: adapter.runtimeParameterSource ?? null,
        responseEvidence: adapter.responseEvidence ?? null,
        authBoundary: adapter.authBoundary ?? 'browser_bridge',
        mode: 'limited_read',
        autoExecute: false,
        requiresConfirmation: false,
        responseMaterial: SANITIZED_SUMMARY_ONLY,
      }],
    });
    capability.executionPlan.limitedOutputOnly = true;
    capability.executionPlan.responseMaterial = SANITIZED_SUMMARY_ONLY;
    return capability;
  });
}

async function discoverCapabilitiesStage(context, stageResults) {
  const graph = requireStage(stageResults, 'classifyNodes').graph;
  const { affordances } = requireStage(stageResults, 'extractAffordances');
  const capabilities = /** @type {any[]} */ ([]);
  const pageNodes = graph.nodes.filter((node) => node.type === 'page');
  const isSocialSite = isSocialSiteContext(context);
  const publicEvidenceScore = (node) => (
    nodeSourceLayer(node) === 'public_rendered'
      ? 4
      : node.publicEvidenceStatus === 'public_static_structured' || node.staticEvidenceStatus === 'present'
        ? 3
        : node.evidenceStatus === 'structure_summary_present'
          ? 2
          : 1
  );
  const isSiteRootPage = (node) => {
    try {
      const parsed = new URL(node.normalizedUrl ?? node.url ?? '', context.site.rootUrl);
      const root = new URL(context.site.rootUrl);
      return parsed.origin === root.origin && (parsed.pathname.replace(/\/+$/u, '') || '/') === '/';
    } catch {
      return false;
    }
  };
  const homepage = pageNodes
    .filter((node) => node.classification === 'homepage' || isSiteRootPage(node))
    .sort((left, right) => (
      (isSiteRootPage(right) ? 100 : 0) - (isSiteRootPage(left) ? 100 : 0)
      || publicEvidenceScore(right) - publicEvidenceScore(left)
    ))[0]
    ?? pageNodes.sort((left, right) => publicEvidenceScore(right) - publicEvidenceScore(left))[0];
  const newsChannels = isSocialSite ? [] : publicReadableNodes(graph, ['news_channel', 'article_list'])
    .filter((node) => nodeHasPublicStructureEvidence(node) && node.normalizedUrl);
  const newsArticle = isSocialSite ? null : pageNodes.find((node) => node.classification === 'article_detail');
  const isRepositorySite = isRepositoryCoverageSite(context, pageNodes);
  const isNewsSite = !isSocialSite && !isRepositorySite && isNewsCoverageSite(context, pageNodes, homepage);
  const hasAnyPublicStructureEvidence = graph.nodes.some((node) => (
    node.id !== homepage?.id
    && !node.authRequired
    && isPublicReadSourceLayer(nodeSourceLayer(node))
    && nodeHasPublicStructureEvidence(node)
  ));
  const isChapterSite = isChapterContentContext(context) || hasChapterContentCoverageSignals(graph.nodes ?? []);
  const productList = isSocialSite || isChapterSite || isRepositorySite ? null : pageNodes.find((node) => node.classification === 'product_list');
  const productDetail = isSocialSite || isChapterSite || isRepositorySite ? null : pageNodes.find((node) => node.classification === 'product_detail');
  const searchForm = affordances.find((affordance) => affordance.kind === 'form' && affordance.safety === 'read_only' && /search/iu.test(`${affordance.label ?? ''} ${affordance.endpoint ?? ''}`));
  const contactForm = affordances.find((affordance) => affordance.kind === 'form' && affordance.safety === 'state_changing' && /contact|support|message/iu.test(`${affordance.label ?? ''} ${affordance.endpoint ?? ''} ${affordance.evidence?.[0]?.text ?? ''}`));

  if (homepage) {
    const capability = makeCapability(context, {
      name: isNewsSite ? 'view news homepage' : 'view homepage',
      description: isNewsSite ? 'Open and inspect the public news homepage.' : 'Open and inspect the public homepage.',
      action: 'view',
      object: isNewsSite ? 'news homepage' : 'homepage',
      userValue: isNewsSite ? '\u67e5\u770b\u65b0\u95fb\u7ad9\u70b9\u9996\u9875\u548c\u516c\u5f00\u5bfc\u822a\u3002' : 'Understand the site entry point and navigation.',
      entryNodeIds: [homepage.id],
      outputs: [{ name: 'page', type: 'html' }],
      safetyLevel: 'read_only',
      evidence: homepage.evidence,
      confidence: 0.95,
      informational: true,
      evidenceModel: hasAnyPublicStructureEvidence ? 'public_route_navigation' : 'public_structure',
      publicRouteOnly: hasAnyPublicStructureEvidence,
      intents: isNewsSite ? [{
        canonicalUtterance: 'view news homepage',
        utteranceExamples: ['\u67e5\u770b\u65b0\u95fb\u9996\u9875', '\u6253\u5f00\u65b0\u95fb\u9996\u9875', 'view news homepage', 'open the news homepage'],
        negativeExamples: ['submit a comment', 'log in to my account'],
        slots: [],
        invocationScore: 0.96,
      }] : undefined,
    });
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'read_only',
      steps: [{ kind: 'navigate', url: homepage.normalizedUrl, nodeId: homepage.id }],
    });
    capabilities.push(capability);
  }

  if (newsChannels.length && isNewsSite) {
    const primaryChannel = newsChannels[0];
    const capability = makeCapability(context, {
      name: 'browse news channels',
      description: 'Open public news channel or feed pages discovered from site evidence.',
      action: 'view',
      object: 'news channels',
      userValue: '\u6d4f\u89c8\u65b0\u95fb\u9891\u9053\u3001\u680f\u76ee\u548c\u516c\u5f00\u4fe1\u606f\u6d41\u3002',
      entryNodeIds: newsChannels.map((node) => node.id),
      outputs: [{ name: 'articles', type: 'list' }],
      safetyLevel: 'read_only',
      evidence: newsChannels.flatMap((node) => node.evidence).slice(0, 5),
      confidence: 0.86,
      intents: [{
        canonicalUtterance: 'browse news channels',
        utteranceExamples: ['\u6d4f\u89c8\u65b0\u95fb\u9891\u9053', '\u6253\u5f00\u65b0\u95fb\u680f\u76ee', '\u67e5\u770b\u9891\u9053\u65b0\u95fb', 'browse news channels', 'show news channel pages'],
        negativeExamples: ['post a comment', 'upload a video'],
        slots: [],
        invocationScore: 0.9,
      }],
    });
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'read_only',
      steps: newsChannels.slice(0, 5).map((node) => ({ kind: 'navigate', url: node.normalizedUrl, nodeId: node.id })),
    });
    if (!capability.executionPlan.steps.length && primaryChannel) {
      capability.executionPlan.steps.push({ kind: 'navigate', url: primaryChannel.normalizedUrl, nodeId: primaryChannel.id });
    }
    capabilities.push(capability);
  }

  if (newsArticle && isNewsSite) {
    const capability = makeCapability(context, {
      name: 'view news article details',
      description: 'Open a public news article page and inspect the article content.',
      action: 'view',
      object: 'news article',
      userValue: '\u6253\u5f00\u5e76\u9605\u8bfb\u516c\u5f00\u65b0\u95fb\u6587\u7ae0\u8be6\u60c5\u3002',
      entryNodeIds: [newsArticle.id],
      outputs: [{ name: 'article', type: 'entity' }],
      safetyLevel: 'read_only',
      evidence: newsArticle.evidence,
      confidence: 0.84,
      intents: [{
        canonicalUtterance: 'view news article details',
        utteranceExamples: ['\u6253\u5f00\u65b0\u95fb\u6587\u7ae0', '\u9605\u8bfb\u65b0\u95fb\u8be6\u60c5', 'open a news article', 'read a news article detail page'],
        negativeExamples: ['subscribe me to alerts', 'pay for this article'],
        slots: [{ name: 'article', type: 'string', required: false }],
        invocationScore: 0.84,
      }],
    });
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'read_only',
      steps: [{ kind: 'navigate', url: newsArticle.normalizedUrl, nodeId: newsArticle.id }],
    });
    capabilities.push(capability);
  }

  if (productList) {
    const capability = makeCapability(context, {
      name: 'browse products',
      description: 'Navigate to the product listing and inspect available products.',
      action: 'view',
      object: 'products',
      userValue: 'Browse the product catalog.',
      entryNodeIds: [productList.id],
      outputs: [{ name: 'products', type: 'list' }],
      safetyLevel: 'read_only',
      evidence: productList.evidence,
      confidence: 0.88,
    });
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'read_only',
      steps: [{ kind: 'navigate', url: productList.normalizedUrl, nodeId: productList.id }],
    });
    capabilities.push(capability);
  }

  if (searchForm && !isChapterSite && isProductCommerceContext(context, graph, productList, productDetail)) {
    const capability = makeCapability(context, {
      name: 'search products',
      description: 'Prepare a read-only GET search query against the product search form.',
      action: 'search',
      object: 'products',
      userValue: 'Find matching products by query.',
      entryNodeIds: [searchForm.nodeId],
      requiredNodeIds: [searchForm.nodeId],
      inputs: searchForm.inputs?.length ? searchForm.inputs : [{ name: 'q', type: 'text', required: true }],
      outputs: [{ name: 'results', type: 'list' }],
      safetyLevel: 'read_only',
      evidence: searchForm.evidence,
      confidence: 0.9,
    });
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'read_only',
      steps: [{
        kind: 'form_get',
        nodeId: searchForm.nodeId,
        selector: searchForm.selector,
        endpoint: searchForm.endpoint,
        method: searchForm.method,
        submit: false,
        querySlot: searchForm.inputs?.find((input) => input.name)?.name ?? 'q',
      }],
    });
    capabilities.push(capability);
  }

  if (productDetail) {
    const capability = makeCapability(context, {
      name: 'view product detail',
      description: 'Open a product detail page and inspect public product information.',
      action: 'view',
      object: 'product detail',
      userValue: 'Read product detail information.',
      entryNodeIds: [productDetail.id],
      outputs: [{ name: 'product', type: 'entity' }],
      safetyLevel: 'read_only',
      evidence: productDetail.evidence,
      confidence: 0.86,
    });
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'read_only',
      steps: [{ kind: 'navigate', url: productDetail.normalizedUrl, nodeId: productDetail.id }],
    });
    capabilities.push(capability);
  }

  if (contactForm) {
    const safetyLevel = capabilitySafetyFromAffordance(contactForm);
    const capability = makeCapability(context, {
      name: 'contact support',
      description: 'Submit a contact-support form through the compiled site action capability.',
      action: 'contact',
      object: 'support',
      userValue: 'Submit a contact support message.',
      entryNodeIds: [contactForm.nodeId],
      requiredNodeIds: [contactForm.nodeId],
      inputs: contactForm.inputs ?? [],
      outputs: [{ name: 'action_result', type: 'runtime_action_result' }],
      safetyLevel,
      evidence: contactForm.evidence,
      confidence: 0.75,
      intents: [
        'contact support',
        'submit contact form',
        'send support message',
      ],
    });
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'action',
      dryRunOnly: false,
      requiresConfirmation: false,
      autoExecute: false,
      governedExecution: false,
      executionDisposition: 'allow',
      steps: [{
        kind: 'form_submit',
        nodeId: contactForm.nodeId,
        selector: contactForm.selector,
        endpoint: contactForm.endpoint,
        method: contactForm.method,
        submit: true,
        finalSubmit: false,
        autoExecute: false,
        governedExecution: false,
        executionDisposition: 'allow',
      }],
    });
    capabilities.push(capability);
  }

  const robotsPolicy = stageResults.discoverSeeds?.robotsPolicy ?? null;
  markStageSubstepProgress(context, 'promoteAffordances', {
    message: '将页面、可操作项和 API 证据提升为能力候选。',
    processedCount: capabilities.length,
    totalCount: affordances.length + graph.nodes.length,
    discoveredCount: capabilities.length,
  });
  if (!isZhihuKnownSiteContext(context)) {
    addGenericPublicCoverageCapabilities(context, capabilities, graph, searchForm);
  }
  addAuthenticatedReadCoverageCapabilities(context, capabilities, graph);
  addKnownSiteBusinessCoverageCapabilities(context, capabilities, graph);
  if (!isZhihuKnownSiteContext(context)) {
    addGenericCatalogCoverageCapabilities(context, capabilities, graph, searchForm);
  }
  addChapterContentCoverageCapabilities(context, capabilities, graph, searchForm);
  const useAggregateNavigationCapabilities = shouldUseAggregateNavigationCapabilities(context, graph);
  if (!useAggregateNavigationCapabilities && !isZhihuKnownSiteContext(context)) {
    addPublicElementInstanceCapabilities(context, capabilities, graph, robotsPolicy);
    addPublicRouteTemplateInstanceCapabilities(context, capabilities, graph, robotsPolicy);
  } else if (!isZhihuKnownSiteContext(context) && !hasAnyPublicStructureEvidence && !hasActiveAggregateRouteOnlyCapability(capabilities)) {
    addPublicRouteTemplateInstanceCapabilities(context, capabilities, graph, robotsPolicy, { allowRouteSeedOnly: true });
  }
  addUserAuthorizedKnownSiteCapabilities(context, capabilities, homepage, graph);
  addDisabledRiskCapabilities(context, capabilities, affordances);
  capabilities.push(...generateAutoCapabilities(context, {
    graph,
    affordances,
    existingCapabilities: capabilities,
  }));
  capabilities.push(...executableApiAdapterCapabilities(context, stageResults, graph, homepage));

  const apiCandidateMetadata = apiCandidateCapabilityMetadata(stageResults);
  const apiCandidateActivationBlockedReason = apiCandidateMetadata.activatedApiAdapterCount > 0
    ? null
    : apiCandidateMetadata.adapterSkippedReasonCounts?.authenticated_browser_bridge_unavailable
      ? 'authenticated-browser-bridge-unavailable'
      : apiCandidateMetadata.apiCandidateCount > 0
        ? 'api-candidate-review-only'
        : 'no-api-candidates-observed';
  capabilities.push(makeCapability(context, {
    name: 'capture network APIs',
    description: apiCandidateMetadata.description,
    action: 'track',
    object: 'network API candidates',
    userValue: apiCandidateMetadata.userValue,
    entryNodeIds: homepage ? [homepage.id] : [],
    safetyLevel: 'read_only',
    evidence: apiCandidateMetadata.evidence,
    confidence: apiCandidateMetadata.confidence,
    status: 'candidate',
    informational: true,
    enabled_status: 'candidate_debug_only',
    default_policy: 'candidate_debug_only',
    activationBlockedReason: apiCandidateActivationBlockedReason,
    reason: apiCandidateActivationBlockedReason === 'authenticated-browser-bridge-unavailable'
      ? 'API candidates require a fresh browser-bridge signing context and remain debug-only in no-login builds.'
      : 'API candidates remain debug-only until replay verification and runtime binding evidence are available.',
    evidence_status: apiCandidateMetadata.apiCandidateCount > 0 ? 'observed_sanitized' : 'candidate',
    apiCandidateCount: apiCandidateMetadata.apiCandidateCount,
    apiCandidateArtifacts: apiCandidateMetadata.apiCandidateArtifacts,
    rawNetworkTracesPersisted: apiCandidateMetadata.rawTracesPersisted,
    networkCaptureStatus: apiCandidateMetadata.captureStatus,
    adapterValidationCount: apiCandidateMetadata.adapterValidationCount,
    adapterAcceptedCount: apiCandidateMetadata.adapterAcceptedCount,
    replayVerifiedCount: apiCandidateMetadata.replayVerifiedCount,
    activatedApiAdapterCount: apiCandidateMetadata.activatedApiAdapterCount,
    adapterSkippedReasonCounts: apiCandidateMetadata.adapterSkippedReasonCounts,
  }));

  markStageSubstepProgress(context, 'promoteAffordances', {
    message: '能力候选生成完成。',
    processedCount: affordances.length + graph.nodes.length,
    totalCount: affordances.length + graph.nodes.length,
    discoveredCount: capabilities.length,
    skippedCount: apiCandidateMetadata.adapterSkippedReasonCounts
      ? Object.values(apiCandidateMetadata.adapterSkippedReasonCounts).reduce((sum, count) => sum + Number(count ?? 0), 0)
      : 0,
  });
  markStageSubstepProgress(context, 'evaluatePolicy', {
    message: '评估能力安全策略和证据矩阵。',
    processedCount: 0,
    totalCount: capabilities.length,
    discoveredCount: 0,
  });
  const policyApplied = dedupeSemanticCapabilities(arrayUniqueBy(capabilities, (capability) => capability.id)
    .map((capability) => enrichAutoCapability(context, capability))
    .map((capability) => applyKnownSiteDisabledActionPolicy(context, capability))
    .map((capability) => applyCapabilityRiskPolicy(capability))
    .map((capability) => applyCapabilityEvidenceMatrix(context, capability, graph)), context)
    .map((capability) => deactivateActiveCapabilityWithoutExecutionPlan(capability))
    .sort((left, right) => left.id.localeCompare(right.id, 'en'));
  const privacyMode = context.options?.privacyMode ?? context.options?.privacy ?? 'limited';
  const privacyFiltered = privacyMode === 'strict'
    ? policyApplied.filter((capability) => !shouldSkipInStrictPrivacy(capability))
    : policyApplied;
  const merged = privacyFiltered
    .map((capability) => decorateCapabilityRuntime(
      context,
      capability,
      graph,
      stageResults.discoverSeeds?.robotsPolicy ?? null,
    ));
  const mergedCounts = capabilityCounts(merged);
  markStageSubstepProgress(context, 'evaluatePolicy', {
    message: '能力策略评估完成。',
    processedCount: capabilities.length,
    totalCount: capabilities.length,
    discoveredCount: mergedCounts.active,
    skippedCount: Math.max(0, policyApplied.length - privacyFiltered.length),
  });
  for (const capability of merged) {
    assertCapability(capability);
  }
  markStageSubstepProgress(context, 'buildEvidenceMatrix', {
    message: '构建可执行能力的证据和执行计划。',
    processedCount: merged.filter((capability) => capability.executionPlan).length,
    totalCount: merged.length,
    discoveredCount: mergedCounts.active,
    skippedCount: mergedCounts.disabled ?? 0,
  });
  const executionPlans = merged
    .filter((capability) => capability.executionPlan)
    .map((capability) => capability.executionPlan)
    .sort((left, right) => left.id.localeCompare(right.id, 'en'));
  const payload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    status: mergedCounts.active > 0 ? 'success' : 'blocked',
    capabilities: merged,
    errors: mergedCounts.active > 0 ? [] : ['Capability discovery produced no active capabilities; build stopped before draft skill generation.'],
    summary: mergedCounts,
  };
  const plansPayload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    executionPlans,
  };
  markStageSubstepProgress(context, 'writeStateReport', {
    message: '写入能力和执行计划产物。',
    processedCount: merged.length,
    totalCount: merged.length,
    discoveredCount: executionPlans.length,
    skippedCount: mergedCounts.disabled ?? 0,
  });
  const capabilitiesPath = await writeArtifactJson(context, 'capabilities.json', payload);
  const executionPlansPath = await writeArtifactJson(context, 'execution_plans.json', plansPayload);
  if (payload.summary.active === 0) {
    throw createBlockedStageError(
      'siteforge-capability-discovery-empty',
      'Capability discovery produced no active capabilities; build stopped before draft skill generation.',
      {
        artifactPaths: {
          capabilities: capabilitiesPath,
          executionPlans: executionPlansPath,
        },
        summary: {
          ...payload.summary,
          executionPlans: executionPlans.length,
        },
      },
    );
  }
  return {
    capabilities: merged,
    executionPlans,
    artifactPaths: {
      capabilities: capabilitiesPath,
      executionPlans: executionPlansPath,
    },
    summary: {
      ...payload.summary,
      executionPlans: executionPlans.length,
    },
  };
}

function intentTemplates(capability) {
  if (capability.name === 'view news homepage') {
    return {
      canonicalUtterance: 'view news homepage',
      utteranceExamples: ['\u67e5\u770b\u65b0\u95fb\u9996\u9875', '\u6253\u5f00\u65b0\u95fb\u9996\u9875', 'view news homepage', 'open the news homepage', 'show the news homepage'],
      negativeExamples: ['submit a comment', 'log in to my account'],
      slots: [],
      invocationScore: 0.96,
    };
  }
  if (capability.name === 'browse news channels') {
    return {
      canonicalUtterance: 'browse news channels',
      utteranceExamples: ['\u6d4f\u89c8\u65b0\u95fb\u9891\u9053', '\u6253\u5f00\u65b0\u95fb\u680f\u76ee', '\u67e5\u770b\u9891\u9053\u65b0\u95fb', 'browse news channels', 'show news channel pages'],
      negativeExamples: ['post a comment', 'upload a video'],
      slots: [],
      invocationScore: 0.9,
    };
  }
  if (capability.name === 'view news article details') {
    return {
      canonicalUtterance: 'view news article details',
      utteranceExamples: ['\u6253\u5f00\u65b0\u95fb\u6587\u7ae0', '\u9605\u8bfb\u65b0\u95fb\u8be6\u60c5', 'open a news article', 'read a news article detail page', 'follow an internal news article link'],
      negativeExamples: ['subscribe me to alerts', 'pay for this article'],
      slots: [{ name: 'article', type: 'string', required: false }],
      invocationScore: 0.84,
    };
  }
  if (capability.name === 'search products') {
    return {
      canonicalUtterance: 'search products',
      utteranceExamples: ['search for wireless headphones', 'find products matching wireless headphones', 'look up headphones in the shop'],
      negativeExamples: ['delete my account', 'submit a support request'],
      slots: [{ name: 'query', type: 'string', required: true }],
      invocationScore: 0.95,
    };
  }
  if (capability.name === 'browse products') {
    return {
      canonicalUtterance: 'browse products',
      utteranceExamples: ['show me the products', 'open the product catalog', 'browse the shop catalog'],
      negativeExamples: ['buy this product', 'send a contact form'],
      slots: [],
      invocationScore: 0.85,
    };
  }
  if (capability.name === 'view product detail') {
    return {
      canonicalUtterance: 'view product detail',
      utteranceExamples: ['open a product detail page', 'show the product details', 'inspect this product'],
      negativeExamples: ['checkout now', 'change account settings'],
      slots: [{ name: 'product', type: 'string', required: false }],
      invocationScore: 0.8,
    };
  }
  if (capability.name === 'contact support') {
    return {
      canonicalUtterance: 'contact support',
      utteranceExamples: ['send a support message', 'submit a contact form', 'contact support about an order'],
      negativeExamples: ['delete my profile', 'make a payment'],
      slots: [
        { name: 'name', type: 'string', required: false },
        { name: 'email', type: 'string', required: false },
        { name: 'message', type: 'string', required: true },
      ],
      invocationScore: 0.72,
    };
  }
  if (capability.name === 'list followed users') {
    return {
      canonicalUtterance: 'list followed users',
      utteranceExamples: ['list followed users', 'show followed accounts', 'who do I follow'],
      negativeExamples: ['follow this account', 'send a direct message'],
      slots: [],
      invocationScore: 0.93,
    };
  }
  if (capability.name === 'list followed updates') {
    return {
      canonicalUtterance: 'list followed updates',
      utteranceExamples: ['list followed updates', 'show followed account posts', 'show updates from followed users'],
      negativeExamples: ['post a tweet', 'like these posts automatically'],
      slots: [{ name: 'date', type: 'string', required: false }],
      invocationScore: 0.9,
    };
  }
  if (capability.name === 'list recommended timeline posts') {
    return {
      canonicalUtterance: 'list recommended timeline posts',
      utteranceExamples: [
        'read recommended timeline posts',
        'show recommended timeline summaries',
        'show recommended timeline posts',
        'show For You timeline posts',
      ],
      negativeExamples: ['like these posts automatically', 'follow recommended accounts', 'post a tweet'],
      slots: [{ name: 'limit', type: 'number', required: false }],
      invocationScore: 0.88,
    };
  }
  if (capability.name === 'list profile content') {
    return {
      canonicalUtterance: 'list profile content',
      utteranceExamples: ['list profile content', 'show account posts', 'open profile posts'],
      negativeExamples: ['change account settings', 'delete a post'],
      slots: [{ name: 'account', type: 'string', required: false }],
      invocationScore: 0.86,
    };
  }
  if (capability.name === 'list hot broadcasts') {
    return {
      canonicalUtterance: 'list hot broadcasts',
      utteranceExamples: ['list hot broadcasts', 'show hot broadcast summaries', 'read hot broadcast feed'],
      negativeExamples: ['download these videos', 'publish a live comment'],
      slots: [{ name: 'limit', type: 'number', required: false }],
      invocationScore: 0.84,
    };
  }
  if (capability.name === 'list topic discussions') {
    return {
      canonicalUtterance: 'list topic discussions',
      utteranceExamples: ['list topic discussions', 'show discussions for this topic', 'read topic discussion summaries'],
      negativeExamples: ['follow this topic', 'post a topic answer'],
      slots: [{ name: 'topic_id', type: 'string', required: false }],
      invocationScore: 0.85,
    };
  }
  if (capability.name === 'list topic featured') {
    return {
      canonicalUtterance: 'list topic featured answers',
      utteranceExamples: ['list topic featured answers', 'show topic featured content', 'read topic top answer summaries'],
      negativeExamples: ['vote on these answers', 'follow this topic'],
      slots: [{ name: 'topic_id', type: 'string', required: false }],
      invocationScore: 0.85,
    };
  }
  if (/^list user (?:activities|answers|questions|articles|columns|pins|collections|videos|following)$/u.test(capability.name)) {
    return {
      canonicalUtterance: capability.name,
      utteranceExamples: [capability.name, `show ${capability.object}`, `read ${capability.object} summaries`],
      negativeExamples: ['follow this user', 'change account settings'],
      slots: [{ name: 'account', type: 'string', required: false }],
      invocationScore: 0.84,
    };
  }
  if (capability.name === 'search posts') {
    return {
      canonicalUtterance: 'search posts',
      utteranceExamples: ['search posts', 'find posts about a topic', 'search social posts'],
      negativeExamples: ['post this text', 'message this user'],
      slots: [{ name: 'query', type: 'string', required: true }],
      invocationScore: 0.88,
    };
  }
  if (capability.name === 'list notifications') {
    return {
      canonicalUtterance: 'list notifications',
      utteranceExamples: ['list notifications', 'show notifications', 'read notification summaries'],
      negativeExamples: ['reply to this notification', 'follow this account automatically'],
      slots: [{ name: 'limit', type: 'number', required: false }],
      invocationScore: 0.82,
    };
  }
  if (capability.name === 'list bookmarks') {
    return {
      canonicalUtterance: 'list bookmarks',
      utteranceExamples: ['list bookmarks', 'show saved posts', 'read bookmark summaries'],
      negativeExamples: ['delete a bookmark', 'post this bookmark'],
      slots: [{ name: 'limit', type: 'number', required: false }],
      invocationScore: 0.82,
    };
  }
  if (capability.name === 'list lists') {
    return {
      canonicalUtterance: 'list lists',
      utteranceExamples: ['list lists', 'show user lists', 'read list summaries'],
      negativeExamples: ['create a list', 'delete a list'],
      slots: [{ name: 'account', type: 'string', required: false }],
      invocationScore: 0.8,
    };
  }
  if (capability.name === 'list direct messages') {
    return {
      canonicalUtterance: 'list direct messages',
      utteranceExamples: ['list direct messages', 'show message conversation summaries', 'count visible dm conversations'],
      negativeExamples: ['send a direct message', 'paste message contents'],
      slots: [{ name: 'limit', type: 'number', required: false }],
      invocationScore: 0.74,
    };
  }
  return {
    canonicalUtterance: capability.name,
    utteranceExamples: [capability.name, `open ${capability.object}`],
    negativeExamples: ['make a payment', 'delete data'],
    slots: [],
    invocationScore: 0.7,
  };
}

function capabilityBySourceNodeId(capabilities = /** @type {any[]} */ ([])) {
  const byNodeId = new Map();
  const intentPreference = (capability = /** @type {any} */ ({})) => (
    (capability.evidenceModel === 'public_element_summary' ? 4 : 0)
    + (capability.publicRouteOnly === true ? 2 : 0)
    + (capability.status === 'active' ? 1 : 0)
  );
  for (const capability of capabilities) {
    for (const nodeId of [
      ...(capability.entryNodeIds ?? []),
      ...(capability.requiredNodeIds ?? []),
    ]) {
      const existing = byNodeId.get(nodeId);
      if (!existing || intentPreference(capability) > intentPreference(existing)) {
        byNodeId.set(nodeId, capability);
      }
    }
  }
  return byNodeId;
}

function graphIntentLabelForNode(node = /** @type {any} */ ({})) {
  return graphIntentPromotableLabelForNode(node) ?? '页面入口';
}

function graphIntentPromotableLabelForNode(node = /** @type {any} */ ({})) {
  const label = sanitizedPromotableCapabilityLabel(
    node.categoryInstance?.label
      ?? node.instanceLabel
      ?? node.elementLabel
      ?? node.linkLabel
      ?? node.title,
    80,
    null,
  );
  if (label) {
    return label;
  }
  return sanitizedStructureText(node.routeTemplate ?? node.routePattern, 80, null);
}

function graphIntentRoleForNode(node = /** @type {any} */ ({})) {
  return String(
    node.categoryInstance?.kind
    ?? node.instanceKind
    ?? node.elementRole
    ?? node.linkSemanticKind
    ?? 'navigation',
  ).toLowerCase();
}

function graphIntentCanonicalUtterance(node = /** @type {any} */ ({})) {
  const label = graphIntentLabelForNode(node);
  return `${chineseElementVerb(graphIntentRoleForNode(node))}${label}`;
}

function graphIntentExamples(node = /** @type {any} */ ({})) {
  const label = graphIntentLabelForNode(node);
  return chineseElementIntentExamples(graphIntentRoleForNode(node), label);
}

function graphIntentCandidateNodes(context, graph, robotsPolicy = null) {
  if (shouldUseAggregateNavigationCapabilities(context, graph)) {
    return [];
  }
  return (graph?.nodes ?? [])
    .filter((node) => {
      const layer = nodeSourceLayer(node);
      const routeNode = ['route', 'route_template'].includes(node.type);
      const publicRouteNode = routeNode
        && node.authRequired !== true
        && isPublicReadSourceLayer(layer);
      const authenticatedRouteNode = routeNode
        && isAuthenticatedSourceLayer(layer)
        && canRunAuthenticatedLayer(context.authStateReport)
        && !isAuthenticatedReadRiskRoute(node);
      return (
        (
          isStructureElementInstanceNode(node)
          || (
            (publicRouteNode || authenticatedRouteNode)
            && (node.categoryInstance || node.linkLabel || node.routeTemplate || node.routePattern)
            && !isPublicUtilityRouteNode(node)
          )
        )
        && Boolean(graphIntentPromotableLabelForNode(node))
        && nodeTargetAllowedByRobots(context, node, robotsPolicy)
      );
    })
    .sort((left, right) => (
      graphIntentRoleForNode(left).localeCompare(graphIntentRoleForNode(right), 'en')
      || graphIntentLabelForNode(left).localeCompare(graphIntentLabelForNode(right), 'zh-Hans-CN')
      || String(left.routeTemplate ?? left.routePattern ?? '').localeCompare(String(right.routeTemplate ?? right.routePattern ?? ''), 'en')
    ))
    .slice(0, 120);
}

function generateGraphElementIntentRecords(context, graph, capabilities = /** @type {any[]} */ ([]), robotsPolicy = null) {
  const byNodeId = capabilityBySourceNodeId(capabilities);
  return graphIntentCandidateNodes(context, graph, robotsPolicy).map((node) => {
    const capability = byNodeId.get(node.id) ?? null;
    const callable = capability?.status === 'active' && capability.enabled_status !== 'candidate_debug_only';
    const safeRemediation = callable ? null : publicSafeRemediation({ path: 'requires_manual_review' });
    const canonicalUtterance = graphIntentCanonicalUtterance(node);
    return {
      schemaVersion: BUILD_SCHEMA_VERSION,
      id: stableNodeId('intent:graph-element', `${context.skillId}:${node.id}:${canonicalUtterance}`),
      capabilityId: capability?.id ?? null,
      skillId: context.skillId,
      name: capability?.name ?? `graph element intent: ${graphIntentLabelForNode(node)}`,
      description: 'Intent generated directly from sanitized graph element evidence, independent of capability discovery.',
      canonicalUtterance,
      utteranceExamples: graphIntentExamples(node),
      slots: [],
      negativeExamples: ['\u81ea\u52a8\u652f\u4ed8', '\u5220\u9664\u6570\u636e', '\u63d0\u4ea4\u8868\u5355'],
      safetyLevel: capability?.safetyLevel ?? 'read_only',
      invocationScore: capability ? 0.78 : 0.58,
      evidence: node.evidence ?? [],
      callable,
      enabled_status: callable ? (capability.enabled_status ?? 'enabled') : 'candidate_debug_only',
      safe_remediation_path: safeRemediation?.path ?? null,
      safe_remediation: safeRemediation,
      evidence_status: callable ? 'verified' : 'candidate',
      default_policy: callable ? 'read_only' : 'candidate_debug_only',
      category: capability?.category ?? graphIntentRoleForNode(node),
      risk_level: capability?.risk_level ?? node.riskLevel ?? 'read_public_low',
      intentSource: 'graph_element',
      sourceNodeId: node.id,
      sourceLayer: nodeSourceLayer(node),
      providerId: capability?.providerId ?? node.providerId ?? null,
      categoryInstance: node.categoryInstance ?? null,
      graphOnly: capability ? false : true,
    };
  });
}

async function generateIntentsStage(context, stageResults) {
  const { capabilities } = requireStage(stageResults, 'discoverCapabilities');
  const graph = requireStage(stageResults, 'classifyNodes').graph;
  const activeCapabilities = capabilities.filter((capability) => capability.status === 'active');
  markStageSubstepProgress(context, 'mapIntents', {
    message: '将能力和图谱元素映射为用户意图。',
    processedCount: 0,
    totalCount: capabilities.length + graph.nodes.length,
    discoveredCount: activeCapabilities.length,
  });
  const intents = arrayUniqueBy([
    ...generateAutoIntentRecords(context, capabilities, { includeCandidateDebug: true }),
    ...generateGraphElementIntentRecords(context, graph, capabilities, stageResults.discoverSeeds?.robotsPolicy ?? null),
  ], (intent) => `${intent.id}:${intent.capabilityId ?? intent.sourceNodeId ?? ''}`);
  markStageSubstepProgress(context, 'mapIntents', {
    message: '用户意图候选生成完成。',
    processedCount: capabilities.length + graph.nodes.length,
    totalCount: capabilities.length + graph.nodes.length,
    discoveredCount: intents.length,
  });
  markStageSubstepProgress(context, 'buildPayloads', {
    message: '构造意图运行时载荷。',
    processedCount: 0,
    totalCount: intents.length,
    discoveredCount: 0,
  });
  const capabilitiesById = new Map(capabilities.map((capability) => [capability.id, capability]));
  const runtimeDecoratedIntents = intents.map((intent) => {
    const capability = capabilitiesById.get(intent.capabilityId);
    const runtimeMetadata = registryIntentRuntimeMetadata(intent, capability);
    return runtimeMetadata && intent.callable !== false
      ? { ...intent, ...runtimeMetadata }
      : intent;
  });
  const capabilityIds = new Set(capabilities.map((capability) => capability.id));
  for (const intent of runtimeDecoratedIntents) {
    assertUserIntent(intent, capabilityIds);
  }
  const callableIntentCount = runtimeDecoratedIntents.filter((intent) => intent.callable !== false).length;
  markStageSubstepProgress(context, 'buildPayloads', {
    message: '意图运行时载荷构造完成。',
    processedCount: runtimeDecoratedIntents.length,
    totalCount: intents.length,
    discoveredCount: callableIntentCount,
    skippedCount: runtimeDecoratedIntents.filter((intent) => intent.callable === false).length,
  });
  markStageSubstepProgress(context, 'renderSummary', {
    message: '渲染能力和意图摘要。',
    processedCount: runtimeDecoratedIntents.length,
    totalCount: runtimeDecoratedIntents.length,
    discoveredCount: callableIntentCount,
  });
  const payload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    skillId: context.skillId,
    intents: runtimeDecoratedIntents,
    summary: {
      intents: runtimeDecoratedIntents.length,
      activeCapabilities: activeCapabilities.length,
      callableIntents: callableIntentCount,
      nonCallableIntents: runtimeDecoratedIntents.filter((intent) => intent.callable === false).length,
    },
  };
  markStageSubstepProgress(context, 'writeIntentArtifacts', {
    message: '写入意图产物。',
    processedCount: runtimeDecoratedIntents.length,
    totalCount: runtimeDecoratedIntents.length,
    discoveredCount: callableIntentCount,
    skippedCount: runtimeDecoratedIntents.filter((intent) => intent.callable === false).length,
  });
  const intentsPath = await writeArtifactJson(context, 'intents.json', payload);
  return {
    intents: runtimeDecoratedIntents,
    artifactPaths: { intents: intentsPath },
    summary: payload.summary,
  };
}

async function compileExecutionContractsStage(context, stageResults) {
  const discoverResult = requireStage(stageResults, 'discoverCapabilities');
  const intentResult = requireStage(stageResults, 'generateIntents');
  const { capabilities, executionPlans } = discoverResult;
  const { intents } = intentResult;
  markStageSubstepProgress(context, 'collectPlans', {
    message: 'Collecting capability execution plans for governed contract compilation.',
    processedCount: 0,
    totalCount: capabilities.length,
    discoveredCount: executionPlans.length,
  });
  const { contracts, byCapabilityId } = buildExecutionContracts({
    context,
    capabilities,
    intents,
  });
  markStageSubstepProgress(context, 'buildContracts', {
    message: 'Compiled redacted execution contracts from capability plans.',
    processedCount: contracts.length,
    totalCount: executionPlans.length,
    discoveredCount: contracts.length,
  });
  const attached = attachExecutionContractRefs({
    capabilities,
    intents,
    contractsByCapabilityId: byCapabilityId,
  });
  discoverResult.capabilities = attached.capabilities;
  intentResult.intents = attached.intents;
  discoverResult.summary = {
    ...(discoverResult.summary ?? {}),
    executionContracts: contracts.length,
    planCallable: attached.capabilities.filter((capability) => capability.planCallable === true).length,
    runtimeCallable: attached.capabilities.filter((capability) => capability.runtimeCallable === true).length,
  };
  intentResult.summary = {
    ...(intentResult.summary ?? {}),
    planCallableIntents: attached.intents.filter((intent) => intent.planCallable === true).length,
    runtimeCallableIntents: attached.intents.filter((intent) => intent.runtimeCallable === true).length,
  };
  markStageSubstepProgress(context, 'attachGraphRefs', {
    message: 'Attached execution contract references to capabilities and intents.',
    processedCount: attached.capabilities.length + attached.intents.length,
    totalCount: attached.capabilities.length + attached.intents.length,
    discoveredCount: contracts.length,
  });
  const capabilitiesPayload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    status: attached.capabilities.some((capability) => capability.status === 'active') ? 'success' : 'blocked',
    capabilities: attached.capabilities,
    errors: [],
    summary: {
      ...(discoverResult.summary ?? {}),
      ...capabilityCounts(attached.capabilities),
      executionContracts: contracts.length,
    },
  };
  const intentsPayload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    skillId: context.skillId,
    intents: attached.intents,
    summary: intentResult.summary,
  };
  const contractsPayload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    executionContracts: contracts,
    summary: {
      total: contracts.length,
      planCallable: contracts.filter((contract) => contract.planCallable === true).length,
      runtimeCallable: contracts.filter((contract) => contract.runtimeCallable === true).length,
      autoExecutable: contracts.filter((contract) => contract.autoExecutable === true).length,
    },
  };
  markStageSubstepProgress(context, 'writeContractArtifacts', {
    message: 'Writing execution contract artifacts.',
    processedCount: 0,
    totalCount: 3,
    discoveredCount: contracts.length,
  });
  const capabilitiesPath = await writeArtifactJson(context, 'capabilities.json', capabilitiesPayload);
  const intentsPath = await writeArtifactJson(context, 'intents.json', intentsPayload);
  const executionContractsPath = await writeArtifactJson(context, EXECUTION_CONTRACTS_ARTIFACT, contractsPayload);
  discoverResult.artifactPaths = {
    ...(discoverResult.artifactPaths ?? {}),
    capabilities: capabilitiesPath,
  };
  intentResult.artifactPaths = {
    ...(intentResult.artifactPaths ?? {}),
    intents: intentsPath,
  };
  markStageSubstepProgress(context, 'writeContractArtifacts', {
    message: 'Execution contract artifacts written.',
    processedCount: 3,
    totalCount: 3,
    discoveredCount: contracts.length,
    currentItem: EXECUTION_CONTRACTS_ARTIFACT,
  });
  return {
    executionContracts: contracts,
    artifactPaths: {
      executionContracts: executionContractsPath,
      capabilities: capabilitiesPath,
      intents: intentsPath,
    },
    summary: contractsPayload.summary,
  };
}

async function evaluateExecutionGovernanceStage(context, stageResults) {
  const { executionContracts } = requireStage(stageResults, 'compileExecutionContracts');
  markStageSubstepProgress(context, 'evaluateRuntimePolicy', {
    message: 'Evaluating runtime governance for execution contracts.',
    processedCount: 0,
    totalCount: executionContracts.length,
    discoveredCount: 0,
  });
  const governance = evaluateExecutionGovernance({
    context,
    contracts: executionContracts,
  });
  markStageSubstepProgress(context, 'classifyDestructiveActions', {
    message: 'Classified destructive and confirmation-gated execution contracts.',
    processedCount: governance.decisions.length,
    totalCount: executionContracts.length,
    discoveredCount: governance.summary.runtimeCallable,
    skippedCount: governance.summary.destructiveBlocked,
  });
  const governancePath = await writeArtifactJson(context, EXECUTION_GOVERNANCE_ARTIFACT, governance);
  markStageSubstepProgress(context, 'writeGovernanceArtifact', {
    message: 'Execution governance artifact written.',
    processedCount: governance.decisions.length,
    totalCount: governance.decisions.length,
    discoveredCount: governance.summary.runtimeCallable,
    skippedCount: governance.decisions.filter((decision) => decision.runtimeDispatchAllowed !== true).length,
    currentItem: EXECUTION_GOVERNANCE_ARTIFACT,
  });
  return {
    governance,
    artifactPaths: {
      executionGovernance: governancePath,
    },
    summary: governance.summary,
  };
}

function compositionExecutionReportFromSteps({
  context,
  dispatchReport,
  stepReports = /** @type {any[]} */ ([]),
} = /** @type {any} */ ({})) {
  const finalReport = stepReports.at(-1) ?? null;
  const completed = stepReports.length > 0 && stepReports.every((report) => report?.status === 'completed');
  const compositionRef = stableNodeId('runtime-composition', context?.buildId ?? 'build');
  return {
    ...(finalReport ?? {}),
    schemaVersion: finalReport?.schemaVersion ?? SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
    executionVersion: finalReport?.executionVersion ?? SITE_CAPABILITY_EXECUTION_VERSION,
    reportType: 'RuntimeExecutionReport',
    runtimeBoundary: 'app/runtime',
    requestId: compositionRef,
    executionId: stableNodeId('runtime-composition-execution', context?.buildId ?? 'build'),
    capabilityId: finalReport?.capabilityId ?? dispatchReport?.selectedCapabilityId ?? null,
    executionContractRef: finalReport?.executionContractRef ?? dispatchReport?.selectedContractRef ?? null,
    policyDecisionRef: finalReport?.policyDecisionRef ?? dispatchReport?.runtimeInvocationRequest?.policyDecisionRef ?? null,
    status: completed ? 'completed' : 'partial_success',
    dispatchStatus: dispatchReport?.status ?? null,
    runtimeDispatchAllowed: dispatchReport?.runtimeDispatchAllowed === true,
    providerInvoked: stepReports.some((report) => report?.providerInvoked === true),
    executionAttempted: stepReports.some((report) => report?.executionAttempted === true),
    runtimeExecuted: stepReports.every((report) => report?.runtimeExecuted === true),
    sideEffectAttempted: stepReports.some((report) => report?.sideEffectAttempted === true),
    sideEffectSucceeded: stepReports.every((report) => report?.sideEffectSucceeded === true),
    sideEffectFailed: stepReports.some((report) => report?.sideEffectFailed === true),
    blockedReason: completed ? null : 'runtime.composition_step_failed',
    resultSummary: {
      outcome: completed ? 'composition_completed' : 'composition_partial_success',
      providerId: finalReport?.providerId ?? null,
      capabilityId: finalReport?.capabilityId ?? dispatchReport?.selectedCapabilityId ?? null,
      executionContractRef: finalReport?.executionContractRef ?? dispatchReport?.selectedContractRef ?? null,
      runtimeMode: 'governed_composition',
      contractKind: finalReport?.resultSummary?.contractKind ?? null,
      stepCount: stepReports.length,
      artifactRefs: stepReports.flatMap((report) => Array.isArray(report?.artifactRefs) ? report.artifactRefs : []),
      savedMaterial: 'sanitized_summary_only',
      redactionRequired: true,
      contextTransfer: {
        status: completed ? 'completed' : 'partial',
        fields: [
          'capabilityId',
          'executionContractRef',
          'resultSummary',
          'artifactRefs',
        ],
      },
    },
    compositionExecution: {
      status: completed ? 'completed' : 'partial_success',
      task: dispatchReport?.task ?? null,
      stepCount: stepReports.length,
      steps: stepReports.map((report, index) => ({
        index: index + 1,
        taskSegment: dispatchReport?.taskCompositionPlan?.steps?.[index]?.taskSegment ?? null,
        capabilityId: report?.capabilityId ?? null,
        executionContractRef: report?.executionContractRef ?? null,
        status: report?.status ?? null,
        providerId: report?.providerId ?? null,
        outcome: report?.resultSummary?.outcome ?? null,
        savedMaterial: report?.resultSummary?.savedMaterial ?? null,
        contextInput: index === 0 ? null : {
          fromStep: index,
          fields: ['capabilityId', 'executionContractRef', 'resultSummary', 'artifactRefs'],
        },
        contextOutput: index === stepReports.length - 1 ? null : {
          toStep: index + 2,
          fields: ['capabilityId', 'executionContractRef', 'resultSummary', 'artifactRefs'],
        },
      })),
    },
  };
}

async function dispatchGovernedRuntimeStage(context, stageResults) {
  const { capabilities } = requireStage(stageResults, 'discoverCapabilities');
  const { executionContracts } = requireStage(stageResults, 'compileExecutionContracts');
  const { intents } = requireStage(stageResults, 'generateIntents');
  const { governance } = requireStage(stageResults, 'evaluateExecutionGovernance');
  markStageSubstepProgress(context, 'selectTaskContract', {
    message: 'Selecting governed runtime task contract.',
    processedCount: 0,
    totalCount: executionContracts.length,
    discoveredCount: 0,
    currentItem: context.options?.executionTask ?? null,
  });
  const dispatchReport = buildRuntimeDispatchReport({
    context,
    contracts: executionContracts,
    intents,
    capabilities,
    governance,
  });
  const selectedContract = dispatchReport.selectedContractRef
    ? executionContracts.find((contract) => contract.id === dispatchReport.selectedContractRef) ?? null
    : null;
  const runtimeContractDescriptor = runtimeContractDescriptorForDispatch(selectedContract, dispatchReport, context);
  markStageSubstepProgress(context, 'preflightRuntimeDispatch', {
    message: 'Runtime dispatch preflight completed under governance policy.',
    processedCount: dispatchReport.selectedContractRef ? 1 : 0,
    totalCount: context.options?.executionTask ? 1 : 0,
    discoveredCount: ['ready_for_direct_runtime', 'ready_for_controlled_runtime', 'planned_no_execute_flag'].includes(dispatchReport.status) ? 1 : 0,
    skippedCount: ['ready_for_direct_runtime', 'ready_for_controlled_runtime', 'planned_no_execute_flag'].includes(dispatchReport.status) ? 0 : 1,
    currentItem: dispatchReport.status,
  });
  const compositionSteps = Array.isArray(dispatchReport.taskCompositionPlan?.steps)
    ? dispatchReport.taskCompositionPlan.steps.filter((step) => (
      step?.runtimeInvocationRequest
      && step?.runtimePolicyDecision
      && step?.runtimeDispatchAllowed === true
    ))
    : [];
  const runtimeExecutionReport = context.options?.execute === true
    && compositionSteps.length > 1
    && dispatchReport.status === 'ready_for_composed_runtime'
    ? buildRuntimeExecutionReport({
      context,
      dispatchReport,
      executionReport: compositionExecutionReportFromSteps({
        context,
        dispatchReport,
        stepReports: await mapWithConcurrency(compositionSteps, 1, async (step) => {
          const stepContract = executionContracts.find((contract) => contract.id === step.selectedContractRef) ?? null;
          const stepDispatchReport = {
            ...dispatchReport,
            status: step.status,
            runtimeInvocationRequest: step.runtimeInvocationRequest,
            runtimePolicyDecision: step.runtimePolicyDecision,
            runtimeDecision: step.runtimeDecision,
            selectedContractRef: step.selectedContractRef,
            selectedCapabilityId: step.selectedCapabilityId,
            selectedGateStatus: step.selectedGateStatus,
            runtimeDispatchAllowed: step.runtimeDispatchAllowed === true,
          };
          return await executeRuntimeInvocation({
            invocationRequest: step.runtimeInvocationRequest,
            policyDecision: step.runtimePolicyDecision,
            gateStatus: step.selectedGateStatus ?? null,
            executionContract: runtimeContractDescriptorForDispatch(stepContract, stepDispatchReport, context),
            providerRegistry: context.runtimeProviderRegistry ?? null,
            runtimeContext: {
              ...(context.runtimeExecutionContext ?? {}),
              siteKey: context.setupProfile?.knownSitePolicy?.siteKey ?? null,
              siteHost: context.site?.host ?? null,
              executionTask: context.options?.executionTask ?? null,
              capabilityKind: stepContract?.capabilityKind ?? stepContract?.operationKind ?? null,
              operationKind: stepContract?.operationKind ?? null,
              runtimeBindingKind: stepContract?.runtimeBinding?.kind ?? null,
              ...(downloadRuntimeOutputContext(context, stepContract) ?? {}),
              ...(downloadRuntimeTaskContext(context, stepContract) ?? {}),
              ...(browserActionRuntimeContext(context, stepContract) ?? {}),
            },
          });
        }),
      }),
    })
    : context.options?.execute === true
      && dispatchReport.runtimeInvocationRequest
      && dispatchReport.runtimePolicyDecision
      && dispatchReport.runtimeDispatchAllowed === true
      && !String(dispatchReport.status ?? '').startsWith('blocked_composition')
      ? buildRuntimeExecutionReport({
        context,
        dispatchReport,
        executionReport: await executeRuntimeInvocation({
          invocationRequest: dispatchReport.runtimeInvocationRequest,
          policyDecision: dispatchReport.runtimePolicyDecision,
          gateStatus: dispatchReport.selectedGateStatus ?? null,
          executionContract: runtimeContractDescriptor,
          providerRegistry: context.runtimeProviderRegistry ?? null,
          runtimeContext: {
            ...(context.runtimeExecutionContext ?? {}),
            siteKey: context.setupProfile?.knownSitePolicy?.siteKey ?? null,
            siteHost: context.site?.host ?? null,
            executionTask: context.options?.executionTask ?? null,
            capabilityKind: selectedContract?.capabilityKind ?? selectedContract?.operationKind ?? null,
            operationKind: selectedContract?.operationKind ?? null,
            runtimeBindingKind: selectedContract?.runtimeBinding?.kind ?? null,
            ...(downloadRuntimeOutputContext(context, selectedContract) ?? {}),
            ...(downloadRuntimeTaskContext(context, selectedContract) ?? {}),
            ...(browserActionRuntimeContext(context, selectedContract) ?? {}),
          },
        }),
      })
      : buildRuntimeExecutionReport({
        context,
        dispatchReport,
      });
  const auditLog = buildExecutionAuditLog({
    context,
    governance,
    dispatchReport,
    runtimeExecutionReport,
  });
  const dispatchPath = await writeArtifactJson(context, RUNTIME_DISPATCH_REPORT_ARTIFACT, dispatchReport);
  const executionPath = await writeArtifactJson(context, RUNTIME_EXECUTION_REPORT_ARTIFACT, runtimeExecutionReport);
  const auditLogPath = await writeArtifactJson(context, AUDIT_LOG_ARTIFACT, auditLog);
  markStageSubstepProgress(context, 'writeDispatchAudit', {
    message: 'Runtime dispatch, execution report, and redacted audit log written.',
    processedCount: 3,
    totalCount: 3,
    discoveredCount: auditLog.decisions.length,
    currentItem: RUNTIME_DISPATCH_REPORT_ARTIFACT,
  });
  return {
    dispatchReport,
    runtimeExecutionReport,
    auditLog,
    artifactPaths: {
      runtimeDispatchReport: dispatchPath,
      runtimeExecutionReport: executionPath,
      auditLog: auditLogPath,
    },
    summary: {
      status: dispatchReport.status,
      selectedContractRef: dispatchReport.selectedContractRef,
      runtimeExecuted: runtimeExecutionReport.runtimeExecuted === true,
      sideEffectAttempted: runtimeExecutionReport.sideEffectAttempted === true,
      auditDecisions: auditLog.decisions.length,
    },
  };
}

function selectInvocationProbe(context, capabilities = /** @type {any[]} */ ([]), intents = /** @type {any[]} */ ([]), options = /** @type {any} */ ({})) {
  const priorityNames = [
    'list followed users',
    'list followed updates',
    'list recommended timeline posts',
    'search posts',
    'list notifications',
    'list bookmarks',
    'list lists',
    'list direct messages',
    'search products',
    'view news homepage',
    'browse news channels',
    'view news article details',
    'view homepage',
    'browse products',
    'view product detail',
  ];
  const activeCapabilityIds = new Set(
    capabilities
      .filter((capability) => capability.status === 'active')
      .filter((capability) => (
        !options.capabilityIds
        || options.capabilityIds.has?.(capability.id)
        || (Array.isArray(options.capabilityIds) && options.capabilityIds.includes(capability.id))
      ))
      .map((capability) => capability.id),
  );
  const activeIntents = intents.filter((intent) => activeCapabilityIds.has(intent.capabilityId) && intent.callable !== false);
  const selected = priorityNames
    .map((name) => activeIntents.find((intent) => intent.name === name))
    .find(Boolean)
    ?? activeIntents[0]
    ?? intents[0]
    ?? null;
  const capability = selected
    ? capabilities.find((candidate) => candidate.id === selected.capabilityId)
    : null;
  return {
    domain: new URL(context.site.rootUrl).hostname,
    utterance: selected?.utteranceExamples?.[0] ?? selected?.canonicalUtterance ?? 'view homepage',
    expectedSkill: context.skillId,
    expectedIntent: selected?.name ?? null,
    expectedCapability: capability?.name ?? selected?.name ?? null,
    intentId: selected?.id ?? null,
    capabilityId: capability?.id ?? selected?.capabilityId ?? null,
  };
}

function buildSkillManifest(context, stageResults) {
  const graph = requireStage(stageResults, 'classifyNodes').graph;
  const { capabilities, executionPlans } = requireStage(stageResults, 'discoverCapabilities');
  const { intents } = requireStage(stageResults, 'generateIntents');
  const { executionContracts } = requireStage(stageResults, 'compileExecutionContracts');
  const { governance } = requireStage(stageResults, 'evaluateExecutionGovernance');
  const { runtimeExecutionReport } = requireStage(stageResults, 'dispatchGovernedRuntime');
  const activeCapabilities = capabilities.filter((capability) => capability.status === 'active');
  const activeSkillDir = context.activeSkillDir ?? context.workspace.paths.currentDir;
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    skillId: context.skillId,
    site: {
      id: context.site.id,
      rootUrl: context.site.rootUrl,
      normalizedUrl: context.site.normalizedUrl,
    },
    domains: context.site.allowedDomains,
    capabilityIds: activeCapabilities.map((capability) => capability.id),
    governedCapabilityIds: capabilities
      .filter((capability) => capability.planCallable === true)
      .map((capability) => capability.id),
    intentIndex: 'intents.json',
    router: {
      registry: path.relative(activeSkillDir, context.registryPath).replace(/\\/gu, '/'),
      domainLookup: context.site.allowedDomains,
      utteranceMatcher: 'deterministic-token-overlap-v1',
    },
    executionEngine: {
      type: 'siteforge-governed-runtime',
      dryRunDefault: true,
      autoExecuteHighRisk: false,
      executionContracts: EXECUTION_CONTRACTS_ARTIFACT,
      executionGovernance: EXECUTION_GOVERNANCE_ARTIFACT,
      runtimeDispatchReport: RUNTIME_DISPATCH_REPORT_ARTIFACT,
      runtimeExecutionReport: RUNTIME_EXECUTION_REPORT_ARTIFACT,
    },
    safetyPolicy: 'safety_policy.json',
    artifacts: {
      site: path.relative(activeSkillDir, context.workspace.paths.siteRecordPath).replace(/\\/gu, '/'),
      graph: 'graph.json',
      capabilities: 'capabilities.json',
      intents: 'intents.json',
      executionPlans: 'execution_plans.json',
      executionContracts: EXECUTION_CONTRACTS_ARTIFACT,
      executionGovernance: EXECUTION_GOVERNANCE_ARTIFACT,
      runtimeDispatchReport: RUNTIME_DISPATCH_REPORT_ARTIFACT,
      auditLog: AUDIT_LOG_ARTIFACT,
      verificationReport: 'verification_report.json',
    },
    optionalArtifacts: {
      runtimeExecutionReport: RUNTIME_EXECUTION_REPORT_ARTIFACT,
      runtimeExecutionStatus: runtimeExecutionReport?.status ?? null,
      runtimeExecutionAttempted: runtimeExecutionReport?.executionAttempted === true,
    },
    verification: {
      status: 'pending',
      requiredArtifacts: REQUIRED_ARTIFACTS,
    },
    metadata: {
      generatedAt: new Date().toISOString(),
      nodeCount: graph.nodes.length,
      activeCapabilityCount: activeCapabilities.length,
      executionPlanCount: executionPlans.length,
      executionContractCount: executionContracts.length,
      runtimeCallableCapabilityCount: capabilities.filter((capability) => capability.runtimeCallable === true).length,
      governanceBlockedCount: governance.decisions.filter((decision) => decision.runtimeDispatchAllowed !== true).length,
      intentCount: intents.length,
    },
  };
}

async function generateSkillStage(context, stageResults) {
  context.skillDir = resolveSkillDir(context);
  await ensureBuildDirectories(context);
  const graph = requireStage(stageResults, 'classifyNodes').graph;
  const { capabilities, executionPlans } = requireStage(stageResults, 'discoverCapabilities');
  const { intents } = requireStage(stageResults, 'generateIntents');
  const { executionContracts } = requireStage(stageResults, 'compileExecutionContracts');
  const { governance } = requireStage(stageResults, 'evaluateExecutionGovernance');
  const { dispatchReport, runtimeExecutionReport, auditLog } = requireStage(stageResults, 'dispatchGovernedRuntime');
  markStageSubstepProgress(context, 'compileDescriptor', {
    message: '编译 Skill 描述、能力、意图和执行计划。',
    processedCount: 0,
    totalCount: capabilities.length + intents.length + executionPlans.length + executionContracts.length,
    discoveredCount: graph.nodes.length,
    currentItem: context.skillId ?? null,
  });
  const capabilitiesPayload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    capabilities,
  };
  const intentsPayload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    intents,
  };
  const executionPlansPayload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    executionPlans,
  };
  const executionContractsPayload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    executionContracts,
  };
  const safetyPolicy = requireStage(stageResults, 'registerSite').safetyPolicy;
  const manifest = buildSkillManifest(context, stageResults);
  const skillYaml = `${toYaml(manifest)}\n`;
  const invocationProbe = selectInvocationProbe(context, capabilities, intents);

  markStageSubstepProgress(context, 'compileDescriptor', {
    message: 'Skill 描述编译完成。',
    processedCount: capabilities.length + intents.length + executionPlans.length + executionContracts.length,
    totalCount: capabilities.length + intents.length + executionPlans.length + executionContracts.length,
    discoveredCount: Object.keys(manifest.artifacts ?? {}).length,
    currentItem: context.skillId,
  });
  markStageSubstepProgress(context, 'writeRuntimeFiles', {
    message: '写入 Skill 运行时文件。',
    processedCount: 0,
    totalCount: 13,
    discoveredCount: 0,
    currentItem: context.skillDir,
  });
  const artifactSkillPath = await writeArtifactText(context, 'skill.yaml', skillYaml);
  const skillPaths = {
    skillYaml: await writeSkillText(context, 'skill.yaml', skillYaml),
    graph: await writeSkillJson(context, 'graph.json', graph),
    capabilities: await writeSkillJson(context, 'capabilities.json', capabilitiesPayload),
    intents: await writeSkillJson(context, 'intents.json', intentsPayload),
    executionPlans: await writeSkillJson(context, 'execution_plans.json', executionPlansPayload),
    executionContracts: await writeSkillJson(context, EXECUTION_CONTRACTS_ARTIFACT, executionContractsPayload),
    executionGovernance: await writeSkillJson(context, EXECUTION_GOVERNANCE_ARTIFACT, governance),
    runtimeDispatchReport: await writeSkillJson(context, RUNTIME_DISPATCH_REPORT_ARTIFACT, dispatchReport),
    runtimeExecutionReport: await writeSkillJson(context, RUNTIME_EXECUTION_REPORT_ARTIFACT, runtimeExecutionReport),
    auditLog: await writeSkillJson(context, AUDIT_LOG_ARTIFACT, auditLog),
    safetyPolicy: await writeSkillJson(context, 'safety_policy.json', safetyPolicy),
    invocationTest: await writeSkillJson(context, path.join('tests', 'invocation.test.json'), {
      schemaVersion: BUILD_SCHEMA_VERSION,
      ...invocationProbe,
    }),
    dryRunTest: await writeSkillJson(context, path.join('tests', 'dry_run.test.json'), {
      schemaVersion: BUILD_SCHEMA_VERSION,
      highRiskAutoExecuteAllowed: false,
      contactSubmitAutoExecuted: false,
      expectedHighRiskMode: 'dry_run',
    }),
  };
  markStageSubstepProgress(context, 'writeRuntimeFiles', {
    message: 'Skill 运行时文件写入完成。',
    processedCount: Object.keys(skillPaths).length,
    totalCount: Object.keys(skillPaths).length,
    discoveredCount: Object.keys(skillPaths).length,
    currentItem: context.skillDir,
  });
  markStageSubstepProgress(context, 'copyVerifiedEvidence', {
    message: '引用已验证证据产物。',
    processedCount: Object.keys(skillPaths).length,
    totalCount: REQUIRED_ARTIFACTS.length,
    discoveredCount: REQUIRED_ARTIFACTS.length,
  });
  markStageSubstepProgress(context, 'sealDraftSkill', {
    message: '封存草稿 Skill 目录。',
    processedCount: Object.keys(skillPaths).length,
    totalCount: Object.keys(skillPaths).length,
    discoveredCount: capabilities.filter((capability) => capability.status === 'active').length,
    currentItem: context.skillDir,
  });
  return {
    skillId: context.skillId,
    skillDir: context.skillDir,
    manifest,
    skillPaths,
    artifactPaths: {
      skillYaml: artifactSkillPath,
      ...skillPaths,
    },
    summary: {
      skillId: context.skillId,
      skillDir: context.skillDir,
      promotion: 'pending_validation',
    },
  };
}

const BRIDGE_RUNTIME_MODE = RUNTIME_MODES.browserBridgeRequired;
const HTTP_RUNTIME_MODE = RUNTIME_MODES.genericHttpRead;

function isBrowserBridgeSourceCapability(capability = /** @type {any} */ ({})) {
  return ['authenticated', 'authenticated_overlay'].includes(nodeSourceLayer(capability));
}

function isBridgeRuntimeSafeCapability(capability = /** @type {any} */ ({})) {
  if (capability.status !== 'active' || !isBrowserBridgeSourceCapability(capability)) {
    return false;
  }
  const safetyLevel = normalizeStatusToken(capability.safetyLevel ?? capability.safety);
  if (safetyLevel && !['read_only', 'safe'].includes(safetyLevel)) {
    return false;
  }
  const riskLevel = normalizeStatusToken(capability.risk_level ?? capability.riskLevel ?? capability.riskPolicy?.riskLevel);
  if (['write_low', 'write_high', 'account_security_critical', 'read_private_high'].includes(riskLevel)) {
    return false;
  }
  if (isHighRiskCapability(capability)) {
    return false;
  }
  const plan = capability.executionPlan;
  if (!plan || plan.autoExecute === true || plan.requiresConfirmation === true) {
    return false;
  }
  const mode = normalizeStatusToken(plan.mode);
  return !mode || ['read_only', 'limited_read', 'limited_read_summary'].includes(mode);
}

function graphNodeById(graph = /** @type {any} */ ({})) {
  return new Map((graph.nodes ?? []).map((node) => [node.id, node]));
}

function capabilityNodes(capability = /** @type {any} */ ({}), graph = /** @type {any} */ ({})) {
  const nodesById = graphNodeById(graph);
  return uniqueSortedStrings([
    ...(capability.entryNodeIds ?? []),
    ...(capability.requiredNodeIds ?? []),
    ...(capability.executionPlan?.steps ?? []).map((step) => step?.nodeId).filter(Boolean),
  ]).map((id) => nodesById.get(id)).filter(Boolean);
}

function capabilitySourceLayers(capability = /** @type {any} */ ({}), graph = /** @type {any} */ ({})) {
  const layers = uniqueSortedStrings([
    capability.sourceLayer,
    ...capabilityNodes(capability, graph).map((node) => nodeSourceLayer(node)),
  ].filter(Boolean));
  return layers.length ? layers : [nodeSourceLayer(capability)];
}

function planStepTargetAllowedByRobots(context, step = /** @type {any} */ ({}), graph = /** @type {any} */ ({}), robotsPolicy = null) {
  const nodesById = graphNodeById(graph);
  const node = step.nodeId ? nodesById.get(step.nodeId) : null;
  if (node && !nodeTargetAllowedByRobots(context, node, robotsPolicy)) {
    return false;
  }
  const targets = uniqueSortedStrings([
    step.url,
    step.routePath,
    step.endpoint,
  ].filter(Boolean));
  if (!targets.length) {
    return true;
  }
  return targets.every((target) => {
    try {
      const normalized = normalizeUrl(target, context.site.rootUrl);
      return isInternalUrl(normalized, context.site.allowedDomains)
        && isUrlAllowedByRobots(normalized, robotsPolicy ?? setupProfileRobotsPolicy(context));
    } catch {
      return false;
    }
  });
}

function isGenericHttpReadSafeCapability(context, capability = /** @type {any} */ ({}), graph = /** @type {any} */ ({}), robotsPolicy = null) {
  if (capability.status !== 'active' || capability.authRequired === true || isHighRiskCapability(capability)) {
    return false;
  }
  if (normalizeStatusToken(capability.action) === 'download' || normalizeStatusToken(capability.mode) === 'download') {
    return false;
  }
  const layers = capabilitySourceLayers(capability, graph);
  if (!layers.length || !layers.every((layer) => layer === 'public')) {
    return false;
  }
  const safetyLevel = normalizeStatusToken(capability.safetyLevel ?? capability.safety);
  if (safetyLevel && !['read_only', 'safe'].includes(safetyLevel)) {
    return false;
  }
  const riskLevel = normalizeStatusToken(capability.risk_level ?? capability.riskLevel ?? capability.riskPolicy?.riskLevel);
  if (['write_low', 'write_high', 'download_high', 'account_security_critical', 'read_private_high'].includes(riskLevel)) {
    return false;
  }
  const plan = capability.executionPlan;
  if (!plan || plan.autoExecute === true || plan.requiresConfirmation === true) {
    return false;
  }
  const mode = normalizeStatusToken(plan.mode);
  if (mode && !['read_only', 'limited_read'].includes(mode)) {
    return false;
  }
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  if (!steps.length) {
    return false;
  }
  return steps.every((step) => {
    const kind = normalizeStatusToken(step.kind);
    if (!['navigate', 'route_template', 'form_get', 'api_request'].includes(kind)) {
      return false;
    }
    if (kind === 'form_get' && String(step.method ?? 'GET').toUpperCase() !== 'GET') {
      return false;
    }
    if (kind === 'api_request' && !isReadOnlyApiMethod(step.method)) {
      return false;
    }
    return planStepTargetAllowedByRobots(context, step, graph, robotsPolicy);
  });
}

function capabilityRuntimeMetadata(context, capability = /** @type {any} */ ({}), graph = /** @type {any} */ ({}), robotsPolicy = null) {
  if (isBridgeRuntimeSafeCapability(capability)) {
    return bridgeRuntimeMetadata(context.authStateReport);
  }
  if (isGenericHttpReadSafeCapability(context, capability, graph, robotsPolicy)) {
    return genericHttpRuntimeMetadata();
  }
  return null;
}

function decorateCapabilityRuntime(context, capability = /** @type {any} */ ({}), graph = /** @type {any} */ ({}), robotsPolicy = null) {
  const metadata = capabilityRuntimeMetadata(context, capability, graph, robotsPolicy);
  if (!metadata) {
    return capability;
  }
  const next = {
    ...capability,
    ...metadata,
  };
  if (next.executionPlan) {
    next.executionPlan = {
      ...next.executionPlan,
      ...metadata,
      runtimeSafety: {
        readOnly: true,
        cookieMaterialAllowed: false,
        savedMaterial: SANITIZED_SUMMARY_ONLY,
      },
    };
  }
  return next;
}

function bridgeRuntimeCapabilityIds(stageResults = /** @type {any} */ ({})) {
  return new Set((stageResults.discoverCapabilities?.capabilities ?? [])
    .filter(isBridgeRuntimeSafeCapability)
    .map((capability) => capability.id)
    .filter(Boolean));
}

function promotableRuntimeCapabilityIds(context, stageResults = /** @type {any} */ ({})) {
  const graph = stageResults.classifyNodes?.graph ?? stageResults.buildSiteGraph?.graph ?? {};
  const robotsPolicy = stageResults.discoverSeeds?.robotsPolicy ?? setupProfileRobotsPolicy(context);
  return new Set((stageResults.discoverCapabilities?.capabilities ?? [])
    .filter((capability) => (
      isBridgeRuntimeSafeCapability(capability)
      || isGenericHttpReadSafeCapability(context, capability, graph, robotsPolicy)
    ))
    .map((capability) => capability.id)
    .filter(Boolean));
}

function bridgeRuntimeRegistryOptions(context, stageResults) {
  return {
    ...bridgeRuntimeMetadata(context.authStateReport),
    verificationStatus: 'bridge_runtime_passed',
    capabilityIds: promotableRuntimeCapabilityIds(context, stageResults),
  };
}

function buildRegistryRecord(context, stageResults, options = /** @type {any} */ ({})) {
  const { capabilities } = requireStage(stageResults, 'discoverCapabilities');
  const { intents } = requireStage(stageResults, 'generateIntents');
  const allowedCapabilityIds = options.capabilityIds instanceof Set
    ? options.capabilityIds
    : Array.isArray(options.capabilityIds)
      ? new Set(options.capabilityIds)
      : null;
  const activeCapabilitiesById = new Map(capabilities
    .filter((capability) => capability.status === 'active' || capability.planCallable === true)
    .filter((capability) => !allowedCapabilityIds || allowedCapabilityIds.has(capability.id))
    .map((capability) => [capability.id, capability]));
  const callableIntents = intents.filter((intent) => activeCapabilitiesById.has(intent.capabilityId) && intent.callable !== false);
  const runtimeMetadata = options.runtimeMode ? {
    promotionClass: options.promotionClass ?? null,
    runtimeMode: options.runtimeMode,
    requiresFreshBridgeEvidence: options.requiresFreshBridgeEvidence === true,
    genericHttpRuntimeAllowed: options.genericHttpRuntimeAllowed === true,
    coverageStatus: options.coverageStatus ?? null,
    runtimeRequirements: options.runtimeRequirements ?? null,
  } : null;
  const intentRuntimeRows = callableIntents.map((intent) => {
    const capability = activeCapabilitiesById.get(intent.capabilityId);
    return registryIntentRuntimeMetadata(intent, capability, runtimeMetadata);
  });
  const runtimeModes = uniqueSortedStrings(intentRuntimeRows.map((metadata) => metadata?.runtimeMode).filter(Boolean));
  const runtimeSummary = {
    genericHttpReadIntents: intentRuntimeRows.filter((metadata) => metadata?.runtimeMode === HTTP_RUNTIME_MODE).length,
    browserBridgeRequiredIntents: intentRuntimeRows.filter((metadata) => metadata?.runtimeMode === BRIDGE_RUNTIME_MODE).length,
    runtimeIneligibleIntents: intentRuntimeRows.filter((metadata) => !metadata?.runtimeMode).length,
  };
  return {
    skillId: context.skillId,
    siteId: context.site.id,
    domains: context.site.allowedDomains,
    skillDir: path.relative(context.cwd, options.skillDir ?? context.skillDir).replace(/\\/gu, '/'),
    artifactDir: path.relative(context.cwd, context.artifactDir).replace(/\\/gu, '/'),
    ...(runtimeMetadata ? runtimeMetadata : {}),
    runtimeModes,
    runtimeSummary,
    intents: callableIntents.map((intent) => {
      const capability = activeCapabilitiesById.get(intent.capabilityId);
      const perIntentRuntimeMetadata = registryIntentRuntimeMetadata(intent, capability, runtimeMetadata);
      return {
        intentId: intent.id,
        name: intent.name,
        capabilityId: intent.capabilityId,
        capabilityName: capability?.name ?? intent.name,
        capabilityAction: capability?.action ?? null,
        executionPlanId: capability?.executionPlan?.id ?? null,
        planCallable: capability?.planCallable === true || intent.planCallable === true,
        runtimeCallable: capability?.runtimeCallable === true || intent.runtimeCallable === true,
        autoExecutable: capability?.autoExecutable === true && intent.autoExecutable === true,
        executionDisposition: capability?.executionDisposition ?? intent.executionDisposition ?? null,
        executionContractRef: capability?.executionContractRef ?? intent.executionContractRef ?? null,
        runtimeBindingId: capability?.apiAdapter?.runtimeBindingId ?? capability?.executionPlan?.steps?.find((step) => step?.runtimeBindingId)?.runtimeBindingId ?? null,
        canonicalUtterance: intent.canonicalUtterance,
        utteranceExamples: intent.utteranceExamples,
        safetyLevel: intent.safetyLevel,
        invocationScore: intent.invocationScore,
        ...(perIntentRuntimeMetadata ? perIntentRuntimeMetadata : {}),
      };
    }),
    verificationStatus: options.verificationStatus ?? 'passed',
  };
}

const REPORT_ONLY_VERIFICATION_REASON_CODES = Object.freeze(new Set([
  'anti-crawl-verify',
  'robots-disallowed',
]));

function canUseReportOnlyVerification(report = /** @type {any} */ ({}), stageResults = /** @type {any} */ ({})) {
  const reasonCode = String(report.reasonCode ?? '').trim();
  if (!REPORT_ONLY_VERIFICATION_REASON_CODES.has(reasonCode)) {
    return false;
  }
  const graphNodes = stageResults.classifyNodes?.graph?.nodes
    ?? stageResults.buildSiteGraph?.graph?.nodes
    ?? [];
  const capabilities = stageResults.discoverCapabilities?.capabilities ?? [];
  const intents = stageResults.generateIntents?.intents ?? [];
  return graphNodes.length > 0 && capabilities.length > 0 && intents.length > 0;
}

function canUseBridgeRuntimePromotion(report = /** @type {any} */ ({}), stageResults = /** @type {any} */ ({}), context = /** @type {any} */ ({})) {
  if (!canUseReportOnlyVerification(report, stageResults)) {
    return false;
  }
  if (String(report.reasonCode ?? '').trim() === 'robots-disallowed') {
    return false;
  }
  const authState = context.authStateReport ?? {};
  if (
    authState.authMethod !== 'browser'
    || !['browser_verified', 'browser_verified_partial'].includes(String(authState.authVerificationStatus ?? ''))
    || authState.verified !== true
  ) {
    return false;
  }
  const bridge = authState.browserBridge ?? {};
  if (bridge.used !== true || Number(bridge.capturedRouteCount ?? 0) <= 0) {
    return false;
  }
  const allowedCapabilityIds = bridgeRuntimeCapabilityIds(stageResults);
  if (allowedCapabilityIds.size === 0) {
    return false;
  }
  const intents = stageResults.generateIntents?.intents ?? [];
  return intents.some((intent) => allowedCapabilityIds.has(intent.capabilityId) && intent.callable !== false);
}

async function verifySkillStage(context, stageResults) {
  const { capabilities, executionPlans } = requireStage(stageResults, 'discoverCapabilities');
  const { intents } = requireStage(stageResults, 'generateIntents');
  markStageSubstepProgress(context, 'validateSchemas', {
    message: '验证能力、意图、执行计划和必需产物 schema。',
    processedCount: 0,
    totalCount: capabilities.length + intents.length + executionPlans.length + REQUIRED_ARTIFACTS.length,
    discoveredCount: REQUIRED_ARTIFACTS.length,
  });
  const candidateRegistry = upsertSkillRegistryRecord(
    createEmptySkillRegistry(context.startedAt),
    buildRegistryRecord(context, stageResults),
    context.startedAt,
  );
  markStageSubstepProgress(context, 'validateSchemas', {
    message: 'schema 验证输入准备完成。',
    processedCount: capabilities.length + intents.length + executionPlans.length,
    totalCount: capabilities.length + intents.length + executionPlans.length + REQUIRED_ARTIFACTS.length,
    discoveredCount: REQUIRED_ARTIFACTS.length,
  });
  markStageSubstepProgress(context, 'checkRedaction', {
    message: '检查脱敏和产物保护。',
    processedCount: 0,
    totalCount: REQUIRED_ARTIFACTS.length,
    discoveredCount: 0,
  });
  const invocationProbe = selectInvocationProbe(context, capabilities, intents);
  markStageSubstepProgress(context, 'runContractChecks', {
    message: '运行注册表、调用探针和运行时契约检查。',
    processedCount: 0,
    totalCount: REQUIRED_ARTIFACTS.length,
    discoveredCount: capabilities.filter((capability) => capability.status === 'active').length,
    currentItem: invocationProbe.expectedIntent ?? invocationProbe.utterance,
  });
  const report = await createSiteForgeOutputValidationReport(context, stageResults, {
    artifactExists: pathExists,
    readArtifactText: async (filePath) => await readFile(filePath, 'utf8'),
    candidateRegistry,
    invocationProbe,
    successfulBuild: true,
  });
  const pageReconciliation = buildPageReconciliationReport(context, stageResults, report);
  if (!report.gates) {
    /** @type {any} */ (report).gates = {};
  }
  /** @type {any} */ (report.gates).pageReconciliation = {
    status: pageReconciliation.status,
    reasonCodes: pageReconciliation.summary.reasonCodes,
    challengeLikePages: pageReconciliation.summary.challengeLikePages,
    expectedCategoryLinks: pageReconciliation.summary.expectedCategoryLinks,
    missingCategoryLinks: pageReconciliation.summary.missingCategoryLinks,
    categoryCapabilities: pageReconciliation.summary.categoryCapabilities,
    categoryIntents: pageReconciliation.summary.categoryIntents,
    blockerClass: pageReconciliation.summary.blockerClass,
    primaryReasonCode: pageReconciliation.summary.primaryReasonCode,
    retryDisposition: pageReconciliation.summary.retryDisposition,
  };
  report.pageReconciliation = pageReconciliation.summary;
  if (pageReconciliation.status === 'failed' || pageReconciliation.status === 'blocked') {
    report.status = pageReconciliation.status === 'blocked' ? 'blocked' : 'failed';
    report.reasonCode = pageReconciliation.summary.primaryReasonCode ?? 'page-reconciliation-failed';
    report.failureClass = pageReconciliation.status === 'blocked' ? 'blocked' : 'validation';
    report.reasonAction = pageReconciliation.status === 'blocked' ? 'respect-external-access-boundary' : 'review-page-reconciliation-report';
    report.errors = uniqueSortedStrings([
      ...(report.errors ?? []),
      `Page reconciliation failed: ${pageReconciliation.summary.reasonCodes.join(',') || 'unknown'}.`,
    ]);
  } else if (pageReconciliation.status === 'warning') {
    report.warnings = uniqueSortedStrings([
      ...(report.warnings ?? []),
      `Page reconciliation warning: ${pageReconciliation.summary.reasonCodes.join(',') || pageReconciliation.status}.`,
    ]);
  }
  if (report.status !== 'passed' && canUseBridgeRuntimePromotion(report, stageResults, context)) {
    const metadata = bridgeRuntimeMetadata(context.authStateReport);
    report.originalStatus = report.status;
    report.status = 'bridge_runtime_passed';
    report.promotionAllowed = true;
    report.reportOnly = false;
    report.reasonAction = 'browser-bridge-runtime-required';
    Object.assign(report, metadata);
    report.warnings = uniqueSortedStrings([
      ...(report.warnings ?? []),
      'Browser bridge runtime promotion: generated read-only capabilities can be registered, but live use requires fresh default-browser bridge evidence.',
    ]);
  } else if (report.status !== 'passed' && canUseReportOnlyVerification(report, stageResults)) {
    report.originalStatus = report.status;
    report.status = 'report_only_blocked';
    report.promotionAllowed = false;
    report.reportOnly = true;
    report.reasonAction = report.reasonAction ?? 'report-only-no-promotion';
    report.warnings = uniqueSortedStrings([
      ...(report.warnings ?? []),
      'Report-only partial success: generated capabilities and intents are available, but promotion is blocked by external access policy.',
    ]);
  }
  markStageSubstepProgress(context, 'runContractChecks', {
    message: '运行时契约检查完成。',
    processedCount: Object.keys(report.gates ?? {}).length,
    totalCount: Math.max(Object.keys(report.gates ?? {}).length, REQUIRED_ARTIFACTS.length),
    discoveredCount: report.status === 'passed' || report.status === 'bridge_runtime_passed' ? 1 : 0,
    skippedCount: (report.errors?.length ?? 0) + (report.warnings?.length ?? 0),
    currentItem: report.status,
  });
  markStageSubstepProgress(context, 'checkRedaction', {
    message: '脱敏和产物保护检查完成。',
    processedCount: REQUIRED_ARTIFACTS.length,
    totalCount: REQUIRED_ARTIFACTS.length,
    discoveredCount: Object.keys(report.artifacts ?? {}).length,
    skippedCount: report.errors?.length ?? 0,
  });
  markStageSubstepProgress(context, 'writeVerificationReport', {
    message: '写入验证报告。',
    processedCount: Object.keys(report.gates ?? {}).length,
    totalCount: Math.max(Object.keys(report.gates ?? {}).length, 1),
    discoveredCount: report.status === 'passed' || report.status === 'bridge_runtime_passed' ? 1 : 0,
    skippedCount: report.errors?.length ?? 0,
    currentItem: report.status,
  });
  const verificationPath = await writeArtifactJson(context, 'verification_report.json', report);
  if (report.status !== 'passed' && report.status !== 'report_only_blocked' && report.status !== 'bridge_runtime_passed') {
    const error = /** @type {Error & Record<string, any>} */ (new Error(`Skill verification failed [${report.reasonCode ?? 'validation-failed'}]: ${report.errors?.[0] ?? 'unknown error'}`));
    error.code = 'skill-verification-failed';
    error.failureClass = report.failureClass ?? 'validation';
    error.reasonCode = report.reasonCode ?? 'validation-failed';
    error.reasonAction = report.reasonAction ?? null;
    error.stageStatus = report.status;
    error.buildStatus = report.status;
    error.verificationReport = report;
    error.verificationReportPath = verificationPath;
    throw error;
  }
  const generatedSkill = requireStage(stageResults, 'generateSkill');
  generatedSkill.manifest.verification = {
    status: report.status === 'bridge_runtime_passed' ? 'bridge_runtime_passed' : 'passed',
    report: 'verification_report.json',
    invocationLookup: report.gates.registryLookup,
    ...(report.status === 'bridge_runtime_passed' ? bridgeRuntimeMetadata(context.authStateReport) : {}),
  };
  if (report.status === 'bridge_runtime_passed') {
    const capabilities = stageResults.discoverCapabilities?.capabilities ?? [];
    generatedSkill.manifest.executionEngine = {
      ...(generatedSkill.manifest.executionEngine ?? {}),
      type: 'siteforge-runtime-router',
      browserBridgeRequired: true,
      genericHttpRuntimeAllowed: false,
      runtimeRouting: {
        genericHttpReadCapabilities: capabilities.filter((capability) => capability.runtimeMode === HTTP_RUNTIME_MODE).length,
        browserBridgeRequiredCapabilities: capabilities.filter((capability) => capability.runtimeMode === BRIDGE_RUNTIME_MODE).length,
      },
      savedMaterial: SANITIZED_SUMMARY_ONLY,
    };
  }
  const verifiedSkillYaml = `${toYaml(generatedSkill.manifest)}\n`;
  await writeArtifactText(context, 'skill.yaml', verifiedSkillYaml);
  generatedSkill.skillPaths.skillYaml = await writeSkillText(context, 'skill.yaml', verifiedSkillYaml);
  return {
    verificationReport: report,
    artifactPaths: { verificationReport: verificationPath },
    summary: {
      status: report.status,
      errors: report.errors?.length ?? 0,
      warnings: report.warnings?.length ?? 0,
    },
  };
}

function siteForgeWriteMode(context) {
  return context.setupProfile?.setupConfiguration?.writeMode
    ?? context.setupProfile?.scope?.writeMode
    ?? context.options?.writeMode
    ?? 'promote_verified';
}

async function writeNonRegisteredRegistryReport(context, status, reasonCode, extra = /** @type {any} */ ({})) {
  const registryReport = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    skillId: context.skillId,
    status,
    reasonCode,
    registryPath: context.registryPath,
    lastSuccessfulBuildPath: null,
    lookup: {
      status: 'skipped',
      reasonCode,
    },
    promotion: null,
    ...extra,
  };
  const registryReportPath = await writeArtifactJson(context, 'registry_report.json', registryReport);
  return {
    registryReport,
    promotion: extra.promotion ?? null,
    artifactPaths: {
      registryReport: registryReportPath,
    },
    summary: {
      status: registryReport.status,
      lookup: registryReport.lookup.status,
      currentDir: extra.promotion?.currentDir ?? null,
    },
  };
}

async function noteRecoveryFailure(error, label, operation) {
  try {
    await operation();
  } catch (recoveryError) {
    error.recoveryErrors = [
      ...(error.recoveryErrors ?? []),
      {
        label,
        message: recoveryError?.message ?? String(recoveryError),
      },
    ];
  }
}

async function removeRegistryReportArtifacts(context) {
  await rm(path.join(context.artifactDir, 'registry_report.json'), { force: true }).catch(() => {});
  await rm(path.join(context.artifactDir, 'reports', 'registry_report.json'), { force: true }).catch(() => {});
}

async function registerSkillStage(context, stageResults) {
  const verification = requireStage(stageResults, 'verifySkill').verificationReport;
  markStageSubstepProgress(context, 'promoteCurrent', {
    message: '检查验证状态并准备提升当前 Skill。',
    processedCount: verification.status === 'passed' || verification.status === 'bridge_runtime_passed' ? 1 : 0,
    totalCount: 1,
    discoveredCount: 0,
    currentItem: verification.status,
  });
  if (verification.status === 'report_only_blocked') {
    markStageSubstepProgress(context, 'summarizePromotion', {
      message: '验证结果为仅报告，跳过注册。',
      processedCount: 1,
      totalCount: 1,
      discoveredCount: 0,
      skippedCount: 1,
      currentItem: verification.reasonCode ?? verification.status,
    });
    return await writeNonRegisteredRegistryReport(context, 'promotion-blocked', verification.reasonCode ?? 'verification-report-only-blocked', {
      reportOnly: true,
      verificationStatus: verification.status,
      promotionAllowed: false,
      writeMode: siteForgeWriteMode(context),
    });
  }
  if (verification.status !== 'passed' && verification.status !== 'bridge_runtime_passed') {
    throw new Error('Registry update blocked because verification did not pass.');
  }
  const bridgeRuntime = verification.status === 'bridge_runtime_passed';
  const registryOptions = bridgeRuntime ? bridgeRuntimeRegistryOptions(context, stageResults) : {};
  const writeMode = siteForgeWriteMode(context);
  if (writeMode === 'preview_only' || writeMode === 'draft_only') {
    markStageSubstepProgress(context, 'summarizePromotion', {
      message: '写入模式不更新注册表。',
      processedCount: 1,
      totalCount: 1,
      discoveredCount: 0,
      skippedCount: 1,
      currentItem: writeMode,
    });
    return await writeNonRegisteredRegistryReport(
      context,
      writeMode === 'draft_only' ? 'draft' : 'preview',
      writeMode === 'draft_only' ? 'write-mode-draft-only' : 'write-mode-preview-only',
      { writeMode, ...(bridgeRuntime ? bridgeRuntimeMetadata(context.authStateReport) : {}) },
    );
  }
  if (writeMode === 'current_only') {
    const lastSuccessfulBefore = await readLastSuccessfulBuild(context.workspace);
    const previousSkillDir = context.skillDir;
    let promotion = null;
    try {
      promotion = await promoteVerifiedBuild(context, stageResults, { retainCurrentBackup: true });
      context.skillDir = promotion.activeSkillDir ?? promotion.currentDir;
      const lastSuccessfulBuildPath = await writeLastSuccessfulBuild(context.workspace, promotion.lastSuccessfulBuild);
      const result = await writeNonRegisteredRegistryReport(context, 'current-updated', 'write-mode-current-only', {
        writeMode,
        lastSuccessfulBuildPath,
        promotion,
        ...(bridgeRuntime ? bridgeRuntimeMetadata(context.authStateReport) : {}),
      });
      await finalizeRetainedCurrentPromotion(context.workspace, promotion);
      markStageSubstepProgress(context, 'summarizePromotion', {
        message: '当前 Skill 目录更新完成。',
        processedCount: 1,
        totalCount: 1,
        discoveredCount: 1,
        currentItem: promotion.currentDir ?? promotion.activeSkillDir ?? null,
      });
      return result;
    } catch (error) {
      if (promotion) {
        await noteRecoveryFailure(error, 'current', () => rollbackRetainedCurrentPromotion(context.workspace, promotion));
      }
      if (lastSuccessfulBefore) {
        await noteRecoveryFailure(error, 'last_successful_build', () => writeLastSuccessfulBuild(context.workspace, lastSuccessfulBefore));
      }
      context.skillDir = previousSkillDir;
      await removeRegistryReportArtifacts(context);
      throw error;
    }
  }
  markStageSubstepProgress(context, 'updateRegistry', {
    message: '读取并更新运行时注册表。',
    processedCount: 0,
    totalCount: 1,
    discoveredCount: 0,
    currentItem: context.registryPath,
  });
  const registry = await readSkillRegistry(context.registryPath);
  const record = buildRegistryRecord(context, stageResults, {
    ...registryOptions,
    skillDir: context.workspace.paths.currentDir,
  });
  const nextRegistry = upsertSkillRegistryRecord(registry, record, new Date().toISOString());
  const capabilities = requireStage(stageResults, 'discoverCapabilities').capabilities;
  const intents = requireStage(stageResults, 'generateIntents').intents;
  const registryRecordCount = Array.isArray(nextRegistry?.skills)
    ? nextRegistry.skills.length
    : Object.keys(nextRegistry?.skills ?? nextRegistry?.records ?? {}).length;
  markStageSubstepProgress(context, 'updateRegistry', {
    message: '注册表记录已生成。',
    processedCount: 1,
    totalCount: 1,
    discoveredCount: registryRecordCount,
    currentItem: context.skillId,
  });
  const invocationProbe = selectInvocationProbe(context, capabilities, intents, {
    capabilityIds: registryOptions.capabilityIds,
  });
  markStageSubstepProgress(context, 'writeLookup', {
    message: '验证 Skill lookup 元数据。',
    processedCount: 0,
    totalCount: intents.length,
    discoveredCount: capabilities.filter((capability) => capability.status === 'active').length,
    currentItem: invocationProbe.utterance,
  });
  const lookup = lookupSkillIntentFromRegistry(nextRegistry, {
    domain: invocationProbe.domain,
    utterance: invocationProbe.utterance,
  });
  if (lookup.status !== 'found') {
    throw new Error('Registry lookup failed after registration.');
  }
  markStageSubstepProgress(context, 'writeLookup', {
    message: 'Skill lookup 验证通过。',
    processedCount: intents.length,
    totalCount: intents.length,
    discoveredCount: 1,
    currentItem: lookup.intentId ?? lookup.capabilityId ?? lookup.status,
  });
  const lastSuccessfulBefore = await readLastSuccessfulBuild(context.workspace);
  const previousSkillDir = context.skillDir;
  let promotion = null;
  let registryWritten = false;
  try {
    promotion = await promoteVerifiedBuild(context, stageResults, { retainCurrentBackup: true });
    context.skillDir = promotion.activeSkillDir ?? promotion.currentDir;
    await writeGeneratedJson(context, context.registryPath, nextRegistry);
    registryWritten = true;
    const lastSuccessfulBuildPath = await writeLastSuccessfulBuild(context.workspace, promotion.lastSuccessfulBuild);
    const registryReport = {
      schemaVersion: BUILD_SCHEMA_VERSION,
      buildId: context.buildId,
      siteId: context.site.id,
      skillId: context.skillId,
      status: 'registered',
      registryPath: context.registryPath,
      lastSuccessfulBuildPath,
      lookup,
      promotion,
      ...(bridgeRuntime ? bridgeRuntimeMetadata(context.authStateReport) : {}),
    };
    markStageSubstepProgress(context, 'summarizePromotion', {
      message: '汇总注册和提升结果。',
      processedCount: 1,
      totalCount: 1,
      discoveredCount: 1,
      currentItem: promotion.currentDir ?? promotion.activeSkillDir ?? registryReport.status,
    });
    const registryReportPath = await writeArtifactJson(context, 'registry_report.json', registryReport);
    await finalizeRetainedCurrentPromotion(context.workspace, promotion);
    return {
      registryReport,
      promotion,
      artifactPaths: {
        registry: context.registryPath,
        registryReport: registryReportPath,
      },
      summary: {
        status: registryReport.status,
        lookup: lookup.status,
        currentDir: promotion.currentDir,
      },
    };
  } catch (error) {
    if (promotion) {
      await noteRecoveryFailure(error, 'current', () => rollbackRetainedCurrentPromotion(context.workspace, promotion));
    }
    if (registryWritten) {
      await noteRecoveryFailure(error, 'registry', () => writeGeneratedJson(context, context.registryPath, registry));
    }
    if (lastSuccessfulBefore) {
      await noteRecoveryFailure(error, 'last_successful_build', () => writeLastSuccessfulBuild(context.workspace, lastSuccessfulBefore));
    }
    context.skillDir = previousSkillDir;
    await removeRegistryReportArtifacts(context);
    throw error;
  }
}

function normalizeStatusToken(value) {
  return String(value ?? '').trim().toLowerCase();
}

function buildUserReport(context, stageResults, report) {
  const capabilities = stageResults.discoverCapabilities?.capabilities ?? [];
  const userVisibleCapabilities = capabilities.filter((capability) => !isDebugOnlyCapability(capability));
  const debugOnlyCapabilities = capabilities.filter(isDebugOnlyCapability);
  const intents = stageResults.generateIntents?.intents ?? [];
  const nodesSummary = summarizeNodes(stageResults);
  const skillId = report.skillId ?? context.skillId ?? null;
  const capabilityState = buildCapabilityStateModel(userVisibleCapabilities);
  const enabledCapabilities = sortCapabilitiesForUser(capabilityState.groups.enabled)
    .map(buildCapabilityCard)
    .map((capability) => sanitizeReportPublicValue(capability));
  const limitedEnabledCapabilities = sortCapabilitiesForUser(capabilityState.groups.limited_enabled)
    .map(buildCapabilityCard)
    .map((capability) => sanitizeReportPublicValue(capability));
  const confirmationRequiredCapabilities = sortCapabilitiesForUser(capabilityState.groups.confirmation_required)
    .map(buildCapabilityCard)
    .map((capability) => sanitizeReportPublicValue(capability))
    .map((capability) => decorateCapabilityConfirmation(capability, { skillId }));
  const disabledCapabilities = sortCapabilitiesForUser(capabilityState.groups.disabled)
    .map(buildCapabilityCard)
    .map((capability) => sanitizeReportPublicValue(capability));
  const decoratedDisabledCapabilities = disabledCapabilities.map((capability) => (
    decorateCapabilityConfirmation(capability, { skillId })
  ));
  const confirmationPaths = buildConfirmationPaths({
    skillId,
    confirmationRequiredCapabilities,
    disabledCapabilities: decoratedDisabledCapabilities,
  });
  const fullCapabilityState = buildCapabilityStateModel(capabilities);
  const defaultPartialSuccessOutcome = buildPartialSuccessOutcome({
    legacyStatus: report.status,
    context,
    report,
    setupCollectionReview: report.setupCollectionReview,
    capabilityState: fullCapabilityState,
  });
  const partialSuccessReasons = report.partial_success_reasons
    ?? defaultPartialSuccessOutcome.partial_success_reasons;
  const resultStatus = report.result_status ?? defaultPartialSuccessOutcome.result_status;
  const capabilitySummary = {
    ...(report.summary?.capabilities ?? capabilityCounts(capabilities)),
    enabled: enabledCapabilities.length,
    limited_enabled: limitedEnabledCapabilities.length,
    confirmation_required: confirmationRequiredCapabilities.length,
    candidate: capabilityState.groups.candidate?.length ?? 0,
    disabled: disabledCapabilities.length,
    capabilities_total: capabilities.length,
    intents_total: intents.length,
    user_visible: userVisibleCapabilities.length,
    debug_only: debugOnlyCapabilities.length,
    candidate_debug_only: debugOnlyCapabilities.filter((capability) => (
      normalizeStatusToken(capability.enabled_status) === 'candidate_debug_only'
      || normalizeStatusToken(capability.default_policy) === 'candidate_debug_only'
      || normalizeStatusToken(capability.status) === 'candidate'
    )).length,
    read_public_low: userVisibleCapabilities.filter((capability) => capability.risk_level === 'read_public_low').length,
    read_personal_medium: userVisibleCapabilities.filter((capability) => capability.risk_level === 'read_personal_medium').length,
    read_private_high: userVisibleCapabilities.filter((capability) => capability.risk_level === 'read_private_high').length,
    write_low: userVisibleCapabilities.filter((capability) => capability.risk_level === 'write_low').length,
    write_high: userVisibleCapabilities.filter((capability) => capability.risk_level === 'write_high').length,
    account_security_critical: userVisibleCapabilities.filter((capability) => capability.risk_level === 'account_security_critical').length,
    high_risk_auto_executed: report.summary?.highRiskAutoExecuted === true,
    enablement_status: fullCapabilityState.enablement_status_counts,
    evidence_status: fullCapabilityState.evidence_status_summary,
  };
  const counts = {
    nodes_total: nodesSummary.nodes_total ?? nodesSummary.total ?? 0,
    actionable_elements: stageResults.extractAffordances?.affordances?.length
      ?? nodesSummary.actionable_elements
      ?? 0,
    capabilities_total: capabilities.length,
    intents_total: intents.length,
  };
  const authSummary = authSummaryForReport(context.crawlContract, context.authStateReport);
  const coverage = buildCoverageReport(context, stageResults, capabilities);
  const htmlReportPath = relativeReportPath(
    context.cwd,
    report.artifacts?.[CAPABILITY_INTENT_SUMMARY_HTML_FILE] ?? capabilityIntentSummaryHtmlPath(context),
  );
  const rawPageMaterialManifestPath = report.artifacts?.[RAW_PAGE_MATERIAL_MANIFEST_FILE]
    ? relativeReportPath(context.cwd, report.artifacts[RAW_PAGE_MATERIAL_MANIFEST_FILE])
    : null;
  const authorizedSourceManifestPath = report.artifacts?.[AUTHORIZED_SOURCE_MANIFEST_FILE]
    ? relativeReportPath(context.cwd, report.artifacts[AUTHORIZED_SOURCE_MANIFEST_FILE])
    : null;
  const routeCapturePlanPath = report.artifacts?.[ROUTE_CAPTURE_PLAN_FILE]
    ? relativeReportPath(context.cwd, report.artifacts[ROUTE_CAPTURE_PLAN_FILE])
    : null;
  const rawPageMaterialSummary = report.summary?.rawPageMaterial ?? null;
  const networkSummary = sanitizedNetworkSummary(context, stageResults);
  return {
    // Migration: status remains the legacy stage/build field; result_status is the stable user-facing outcome.
    result_status: resultStatus,
    legacy_status: report.status ?? null,
    failure_class: report.failureClass ?? null,
    reason_code: report.reasonCode ?? null,
    reason_action: report.reasonAction ?? null,
    reason: report.reason ?? null,
    site: {
      id: report.siteId ?? context.site.id,
      input_url: report.inputUrl ?? context.site.normalizedUrl,
      root_url: context.site.rootUrl,
      allowed_domains: context.site.allowedDomains ?? [],
    },
    site_adapter: siteAdapterSummaryForReport(context),
    skill_id: skillId,
    build_id: report.buildId ?? context.buildId,
    crawlMode: authSummary.crawlMode,
    authMethod: authSummary.authMethod,
    authVerificationStatus: authSummary.authVerificationStatus,
    auth_summary: authSummary,
    coverage,
    requires_login_candidates: coverage.requiresLoginButMissing,
    blocked_by_risk: coverage.blockedByRisk,
    blocked_by_auth: coverage.blockedByAuth,
    counts,
    api_discovery_summary: {
      requested: networkSummary.requested,
      raw_network_traces_persisted: networkSummary.raw_traces_persisted,
      raw_trace_count: networkSummary.raw_trace_count,
      api_candidate_count: networkSummary.api_candidate_count,
      adapter_validation_count: networkSummary.adapter_validation_count,
      adapter_accepted_count: networkSummary.adapter_accepted_count,
      replay_verified_count: networkSummary.replay_verified_count,
      activated_api_adapter_count: networkSummary.activated_api_adapter_count,
      skipped_reason_counts: networkSummary.adapter_skipped_reason_counts,
      catalog_promotion_gate_count: networkSummary.catalog_promotion_gate_count,
      catalog_promotion_ready_count: networkSummary.catalog_promotion_ready_count,
      catalog_promotion_blocked_reason_counts: networkSummary.catalog_promotion_blocked_reason_counts,
      api_extraction_disabled_reason: networkSummary.api_extraction_disabled_reason,
      collector_status: networkSummary.collector_status?.sanitizedSummary?.apiCandidateStatus
        ?? networkSummary.collector_status?.apiCandidateStatus
        ?? null,
    },
    enabled_capabilities: enabledCapabilities,
    limited_enabled_capabilities: limitedEnabledCapabilities,
    limited_capabilities: limitedEnabledCapabilities,
    confirmation_required_capabilities: confirmationRequiredCapabilities,
    disabled_capabilities: decoratedDisabledCapabilities,
    discovered_nodes_summary: nodesSummary,
    capability_summary: capabilitySummary,
    capability_state_summary: fullCapabilityState.enablement_status_counts,
    capability_evidence_summary: fullCapabilityState.evidence_status_summary,
    partial_success_reasons: partialSuccessReasons,
    riskLevelDefaults: {
      low: 'enabled',
      medium: 'enabled',
      high: 'enabled',
      critical: 'enabled',
      read_public_low: 'enabled',
      read_personal_medium: 'enabled',
      read_private_high: 'enabled',
      write_low: 'enabled',
      write_high: 'enabled',
      download_high: 'enabled',
      account_security_critical: 'enabled',
    },
    auto_discovery_summary: context.setupProfile?.userAuthorizedEvidence?.autoDiscovery ? {
      mode: context.setupProfile.userAuthorizedEvidence.autoDiscovery.mode ?? 'default',
      dynamic_enabled: context.setupProfile.userAuthorizedEvidence.autoDiscovery.dynamicEnabled === true,
      network_enabled: context.setupProfile.userAuthorizedEvidence.autoDiscovery.networkEnabled === true,
      summary: context.setupProfile.userAuthorizedEvidence.autoDiscovery.summary ?? null,
    } : null,
    auth_explanation_zh: [
      authSummary.crawlMode === 'authenticated_browser'
        ? `本次使用默认浏览器 Bridge 认证采集；认证状态为 ${authSummary.authVerificationStatus}。`
        : authSummary.crawlMode === 'authenticated_cookie'
        ? `本次使用 Cookie 认证采集；认证状态为 ${authSummary.authVerificationStatus}。`
        : authSummary.crawlMode === 'authenticated_authorized_source' || authSummary.authMethod === 'authorized_source'
        ? `本次使用用户授权的脱敏结构摘要作为登录态证据；认证状态为 ${authSummary.authVerificationStatus}，未保存 cookie、token、浏览器 profile、原始 HTML、原始 DOM、原始网络 payload 或私密正文。`
        : '本次未使用认证采集，只构建公开页面和公开能力。',
      authSummary.browserBridge?.missingRouteCount > 0
        ? `默认浏览器 Bridge 最终采集 ${authSummary.browserBridge.capturedRouteCount}/${authSummary.browserBridge.routeCount} 条配置路由；已自动温和重试 ${authSummary.browserBridge.retryAttemptedRouteCount ?? 0} 条路由，未采集路由不生成能力。`
        : null,
      report.summary?.verificationStatus === 'bridge_runtime_passed'
        ? `本次已注册为运行态分流 Skill：${coverage.runtime.httpRuntimeCapabilities} 个公开只读能力使用普通 HTTP 只读运行态，${coverage.runtime.browserBridgeRuntimeCapabilities} 个认证或 overlay 能力需要重新通过默认浏览器 Bridge 提交脱敏结构证据。`
        : null,
      report.summary?.verificationStatus === 'report_only_blocked'
        ? '本次仅生成报告：能力和意图已产出，但 current/ 更新和 registry 注册被外部访问策略阻断。'
        : null,
      coverage.requiresLoginButMissing.length
        ? `${coverage.requiresLoginButMissing.length} 个登录相关能力因为缺少认证结构证据保留为候选。`
        : '未发现缺少登录证据的候选能力。',
      coverage.authenticated.capabilities
        ? `${coverage.authenticated.capabilities} 个认证能力已有限启用。`
        : '没有认证能力被有限启用。',
      coverage.blockedByRisk.length
        ? `${coverage.blockedByRisk.length} 个能力因风险策略被禁用或限制。`
        : '未额外启用高风险能力。',
      rawPageMaterialSummary?.pages
        ? `已保存 ${rawPageMaterialSummary.pages} 个公开页面的受控页面材料，并已脱敏敏感赋值和脚本正文。`
        : '未保存公开页面原始材料。',
      context.options?.internalRawNetwork === true
        ? 'Raw network capture was enabled; user report omits raw artifact paths and raw contents.'
        : '没有保存 cookie、token、Authorization header、浏览器 profile、storage 材料、原始网络 payload 或私密正文。',
    ].filter(Boolean),
    debug_candidate_summary: {
      count: debugOnlyCapabilities.length,
      report: 'debug',
    },
    build_completion: {
      status: resultStatus,
      build_status: report.status ?? null,
      verification_status: report.summary?.verificationStatus ?? null,
      current_updated: report.summary?.currentUpdated === true,
      current_dir: relativeReportPath(context.cwd, report.summary?.currentDir ?? context.workspace.paths.currentDir),
      registry_registered: report.summary?.registryRegistered === true,
      registry_status: report.summary?.registryStatus ?? null,
      registry_path: relativeReportPath(context.cwd, report.summary?.registryPath ?? context.registryPath),
      promotion_class: report.summary?.promotionClass ?? null,
      runtime_mode: report.summary?.runtimeMode ?? null,
      runtime_counts: coverage.runtime,
      requires_fresh_bridge_evidence: report.summary?.requiresFreshBridgeEvidence === true,
      generic_http_runtime_allowed: report.summary?.genericHttpRuntimeAllowed === true,
      coverage_status: report.summary?.coverageStatus ?? null,
      skill_id: skillId,
      report_path: relativeReportPath(context.cwd, report.artifacts?.[USER_REPORT_FILE] ?? path.join(context.artifactDir, USER_REPORT_FILE)),
      capability_intent_summary_html: htmlReportPath,
      ...(routeCapturePlanPath ? { route_capture_plan: routeCapturePlanPath } : {}),
      ...(rawPageMaterialManifestPath ? { raw_page_material_manifest: rawPageMaterialManifestPath } : {}),
      ...(authorizedSourceManifestPath ? { authorized_source_manifest: authorizedSourceManifestPath } : {}),
    },
    reports: {
      capability_intent_summary_html: htmlReportPath,
      ...(routeCapturePlanPath ? { route_capture_plan: routeCapturePlanPath } : {}),
      ...(rawPageMaterialManifestPath ? { raw_page_material_manifest: rawPageMaterialManifestPath } : {}),
      ...(authorizedSourceManifestPath ? { authorized_source_manifest: authorizedSourceManifestPath } : {}),
    },
    privacy_summary: summarizePrivacy(context, report),
    saved_material: rawPageMaterialSummary?.pages ? 'controlled_public_page_material' : SANITIZED_SUMMARY_ONLY,
    page_structure_source_saved: Boolean(rawPageMaterialSummary?.pages),
    page_source_saved: Boolean(rawPageMaterialSummary?.pages),
    page_content_saved: Boolean(rawPageMaterialSummary?.pages),
    private_content_saved: false,
    browser_state_saved: false,
    secret_material_saved: false,
    confirmation_paths: confirmationPaths,
    next_steps: buildNextSteps({
      resultStatus,
      context,
      report,
      confirmationRequired: confirmationRequiredCapabilities,
      disabledCapabilities: decoratedDisabledCapabilities,
      confirmationPaths,
    }),
    next_step_workflows: buildNextStepWorkflows({
      resultStatus,
      report,
    }),
    warnings_user_facing: buildUserFacingWarnings(report, resultStatus, context, partialSuccessReasons),
  };
}

async function writeRedactedArtifactJson(context, fileName, payload) {
  const prepared = prepareRedactedArtifactJsonWithAudit(payload);
  const artifactPath = await writeArtifactJson(context, fileName, prepared.value);
  return {
    artifactPath,
    value: prepared.value,
    audit: prepared.auditValue,
  };
}

function renderLegacySiteForgeBuildSummary(result, options = /** @type {any} */ ({})) {
  return renderSiteForgeBuildDebugSummary(result, options);
}

function renderBuildUserMarkdown(userReport, report, options = /** @type {any} */ ({})) {
  return renderFriendlySiteForgeUserBuildSummary({
    ...report,
    user_report: userReport,
  }, options);
}

function capabilityIntentSummaryHtmlPath(context) {
  return path.join(context.artifactDir, CAPABILITY_INTENT_SUMMARY_HTML_RELATIVE_PATH);
}

async function writeCapabilityIntentHtmlReport(context, stageResults, report, userReport) {
  const payload = buildCapabilityIntentHtmlPayload(context, stageResults, report, userReport);
  const html = renderCapabilityIntentSummaryHtml(payload);
  return await writeArtifactText(context, CAPABILITY_INTENT_SUMMARY_HTML_RELATIVE_PATH, html);
}

async function writePageReconciliationReport(context, stageResults, report) {
  const reconciliation = buildPageReconciliationReport(context, stageResults, report);
  const write = await writeRedactedArtifactJson(context, PAGE_RECONCILIATION_REPORT_FILE, reconciliation);
  return write;
}

async function writeAccessRemediationPlanIfNeeded(context, stageResults, pageReconciliation) {
  if (!shouldWriteAccessRemediationPlan(pageReconciliation)) {
    return null;
  }
  const plan = buildAccessRemediationPlan(context, stageResults, pageReconciliation);
  const write = await writeRedactedArtifactJson(context, ACCESS_REMEDIATION_PLAN_FILE, plan);
  return write;
}

function buildBuildReport(context, stageResults, stageRecords, status = 'success', error = null) {
  const capabilities = stageResults.discoverCapabilities?.capabilities ?? [];
  const activeCapabilities = capabilities.filter((capability) => capability.status === 'active');
  const intents = stageResults.generateIntents?.intents ?? [];
  const failureReason = status === 'success' ? null : classifyBuildFailure(error, stageRecords);
  const safeFailureReason = status === 'success'
    ? null
    : collectionOutcomeReason(failureReason?.reasonCode ?? error?.reasonCode ?? error?.code ?? 'build-failed');
  const collectionOutcomes = collectUnsuccessfulCollections(stageResults, stageRecords, status, error);
  const setupCollectionReviewSource = reconcileSetupCollectionReviewWithBuildOutputs(
    context.setupCollectionReview,
    capabilities,
    intents,
  );
  const setupCollectionReview = setupCollectionReviewReport(
    setupCollectionReviewSource,
    context.setupCollectionReviewPath,
  );
  const {
    warningCodes,
    reportWarnings,
  } = buildReportWarningSummary(stageRecords, context.warnings);
  const capabilityState = buildCapabilityStateModel(capabilities);
  const partialSuccessReport = {
    warnings: reportWarnings,
    failureClass: failureReason?.failureClass ?? null,
    reasonCode: failureReason?.reasonCode ?? null,
    summary: {
      verificationStatus: stageResults.verifySkill?.verificationReport?.status ?? null,
      verificationReasonCode: stageResults.verifySkill?.verificationReport?.reasonCode ?? null,
    },
  };
  const partialSuccessOutcome = buildPartialSuccessOutcome({
    legacyStatus: status,
    context,
    report: partialSuccessReport,
    setupCollectionReview,
    capabilityState,
  });
  const { result_status, partial_success_reasons: partialSuccessReasons } = partialSuccessOutcome;
  const registryReport = stageResults.registerSkill?.registryReport ?? null;
  const promotion = stageResults.registerSkill?.promotion ?? registryReport?.promotion ?? null;
  const verificationReport = stageResults.verifySkill?.verificationReport ?? null;
  const runtimeMetadata = verificationReport?.runtimeMode ? {
    promotionClass: verificationReport.promotionClass ?? null,
    runtimeMode: verificationReport.runtimeMode ?? null,
    requiresFreshBridgeEvidence: verificationReport.requiresFreshBridgeEvidence === true,
    genericHttpRuntimeAllowed: verificationReport.genericHttpRuntimeAllowed === true,
    coverageStatus: verificationReport.coverageStatus ?? null,
    runtimeRequirements: verificationReport.runtimeRequirements ?? null,
  } : null;
  const coverage = buildCoverageReport(context, stageResults, capabilities);
  const authSummary = authSummaryForReport(context.crawlContract, context.authStateReport);
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    build_id: context.buildId,
    siteId: context.site.id,
    inputUrl: context.site.normalizedUrl,
    artifactDir: context.artifactDir,
    skillId: context.skillId,
    skill_id: context.skillId,
    skillDir: context.skillDir,
    draftSkillDir: context.draftSkillDir,
    workspace: {
      siteDir: context.workspace.paths.siteDir,
      buildDir: context.workspace.paths.buildDir,
      currentDir: context.workspace.paths.currentDir,
      activeSkillDir: context.activeSkillDir,
      registryPath: context.registryPath,
      lastSuccessfulBuildPath: context.workspace.paths.lastSuccessfulBuildPath,
    },
    buildProfilePath: context.buildProfilePath,
    setupProfile: setupProfileSummary(context.setupProfile),
    crawlContract: context.crawlContract ?? null,
    authStateReport: context.authStateReport ?? null,
    crawlMode: authSummary.crawlMode,
    authMethod: authSummary.authMethod,
    authVerificationStatus: authSummary.authVerificationStatus,
    siteAdapter: siteAdapterSummaryForReport(context, { includeSource: true }),
    setupCollectionReview,
    artifactStore: context.artifactStore,
    status,
    // Migration: keep legacy_status during report consumers' transition to result_status.
    result_status,
    partial_success_reasons: partialSuccessReasons,
    legacy_status: status,
    startedAt: context.startedAt,
    completedAt: new Date().toISOString(),
    failedStage: error?.stage ?? null,
    failureClass: failureReason?.failureClass ?? null,
    reasonCode: failureReason?.reasonCode ?? null,
    reasonAction: failureReason?.action ?? error?.reasonAction ?? null,
    reason: safeFailureReason,
    warningCodes,
    stages: stageRecords,
    summary: {
      seeds: stageResults.discoverSeeds?.seeds?.length ?? 0,
      nodes: stageResults.classifyNodes?.graph?.nodes?.length ?? 0,
      affordances: stageResults.extractAffordances?.affordances?.length ?? 0,
      capabilities: capabilityCounts(capabilities),
      coverage,
      auth: authSummary,
      robots: stageResults.discoverSeeds?.robots ?? null,
      network: stageResults.captureNetworkTraces?.summary ?? null,
      authorizedSources: authorizedSourcesSummaryForReport(context),
      rawPageMaterial: stageResults.crawlStatic?.rawPageMaterial?.summary ?? null,
      activeCapabilities: activeCapabilities.length,
      intents: intents.length,
      verificationStatus: stageResults.verifySkill?.verificationReport?.status ?? null,
      verificationReasonCode: stageResults.verifySkill?.verificationReport?.reasonCode ?? error?.verificationReport?.reasonCode ?? null,
      registryStatus: stageResults.registerSkill?.registryReport?.status ?? null,
      registryRegistered: registryReport?.status === 'registered',
      ...(runtimeMetadata ? runtimeMetadata : {}),
      registryPath: context.registryPath,
      currentUpdated: Boolean(promotion?.currentDir),
      currentDir: promotion?.currentDir ?? context.workspace.paths.currentDir,
      skillId: context.skillId,
      reportPath: path.join(context.artifactDir, USER_REPORT_FILE),
      relativeReportPath: relativeReportPath(context.cwd, path.join(context.artifactDir, USER_REPORT_FILE)),
      capabilityState: capabilityState.enablement_status_counts,
      capabilityEvidence: capabilityState.evidence_status_summary,
      partialSuccessReasons,
      highRiskAutoExecuted: activeCapabilities.some((capability) => isHighRiskCapability(capability) && capability.executionPlan?.autoExecute === true),
      executionGovernance: stageResults.evaluateExecutionGovernance?.summary ?? null,
      runtimeDispatch: stageResults.dispatchGovernedRuntime?.summary ?? null,
      unsuccessfulCollections: collectionOutcomes.total,
      setupCollectionReviewMissing: setupCollectionReview?.missingRecordCount ?? 0,
      setupCollectionReviewCapabilitiesMissing: setupCollectionReview?.summary?.capabilities?.missing ?? 0,
      setupCollectionReviewIntentsMissing: setupCollectionReview?.summary?.intents?.missing ?? 0,
      autoDiscovery: context.setupProfile?.userAuthorizedEvidence?.autoDiscovery?.summary ?? null,
      autoDiscoveryMode: context.setupProfile?.userAuthorizedEvidence?.autoDiscovery?.mode ?? null,
      autoDiscoveryDynamicEnabled: context.setupProfile?.userAuthorizedEvidence?.autoDiscovery?.dynamicEnabled === true,
      autoDiscoveryNetworkEnabled: context.setupProfile?.userAuthorizedEvidence?.autoDiscovery?.networkEnabled === true,
      siteAdapter: siteAdapterSummaryForReport(context, { includeSource: true }),
    },
    collectionOutcomes,
    warnings: reportWarnings,
    artifacts: Object.fromEntries(
      REQUIRED_ARTIFACTS.map((name) => [name, path.join(context.artifactDir, name)]),
    ),
  };
}

async function writeBuildReportStage(context, stageResults, stageRecords) {
  markStageSubstepProgress(context, 'buildUserReport', {
    message: '生成用户报告和页面重建报告。',
    processedCount: 0,
    totalCount: Object.keys(stageRecords ?? {}).length,
    discoveredCount: 0,
  });
  const report = buildBuildReport(context, stageResults, stageRecords, 'success');
  report.artifacts[CAPABILITY_INTENT_SUMMARY_HTML_FILE] = capabilityIntentSummaryHtmlPath(context);
  if (stageResults.crawlStatic?.artifactPaths?.rawPageMaterialManifest) {
    report.artifacts[RAW_PAGE_MATERIAL_MANIFEST_FILE] = stageResults.crawlStatic.artifactPaths.rawPageMaterialManifest;
  }
  if (stageResults.crawlStatic?.artifactPaths?.authorizedSourceManifest) {
    report.artifacts[AUTHORIZED_SOURCE_MANIFEST_FILE] = stageResults.crawlStatic.artifactPaths.authorizedSourceManifest;
  }
  const pageReconciliationWrite = await writePageReconciliationReport(context, stageResults, report);
  report.pageReconciliation = pageReconciliationWrite.value;
  /** @type {any} */ (report.summary).pageReconciliation = pageReconciliationWrite.value.summary;
  report.artifacts[PAGE_RECONCILIATION_REPORT_FILE] = pageReconciliationWrite.artifactPath;
  const accessRemediationWrite = await writeAccessRemediationPlanIfNeeded(context, stageResults, pageReconciliationWrite.value);
  if (accessRemediationWrite) {
    report.accessRemediationPlan = accessRemediationWrite.value;
    report.artifacts[ACCESS_REMEDIATION_PLAN_FILE] = accessRemediationWrite.artifactPath;
  }
  if (stageResults.authStateCheck?.artifactPaths?.routeCapturePlan) {
    report.routeCapturePlan = stageResults.authStateCheck.routeCapturePlan ?? null;
    /** @type {any} */ (report.summary).routeCapturePlan = stageResults.authStateCheck.routeCapturePlan ? {
      status: stageResults.authStateCheck.routeCapturePlan.status,
      routeCoverageStatus: stageResults.authStateCheck.routeCapturePlan.routeCoverageStatus,
      retryStatus: stageResults.authStateCheck.routeCapturePlan.retryStatus,
      retryPasses: stageResults.authStateCheck.routeCapturePlan.retryPasses,
      routeCount: stageResults.authStateCheck.routeCapturePlan.routeCount,
      capturedRouteCount: stageResults.authStateCheck.routeCapturePlan.capturedRouteCount,
      missingRouteCount: stageResults.authStateCheck.routeCapturePlan.missingRouteCount,
    } : null;
    report.artifacts[ROUTE_CAPTURE_PLAN_FILE] = stageResults.authStateCheck.artifactPaths.routeCapturePlan;
  }
  if (pageReconciliationWrite.value.status !== 'passed') {
    report.warnings = uniqueSortedStrings([
      ...(report.warnings ?? []),
      `page-reconciliation:${pageReconciliationWrite.value.summary.reasonCodes.join(',') || pageReconciliationWrite.value.status}`,
    ]);
  }
  const userReport = buildUserReport(context, stageResults, report);
  /** @type {any} */ (userReport).reports = {
    ...(/** @type {any} */ (userReport).reports ?? {}),
    page_reconciliation_report: PAGE_RECONCILIATION_REPORT_FILE,
    ...(accessRemediationWrite ? { access_remediation_plan: ACCESS_REMEDIATION_PLAN_FILE } : {}),
    ...(report.artifacts?.[ROUTE_CAPTURE_PLAN_FILE] ? { route_capture_plan: ROUTE_CAPTURE_PLAN_FILE } : {}),
  };
  /** @type {any} */ (userReport).build_completion = {
    ...(/** @type {any} */ (userReport).build_completion ?? {}),
    page_reconciliation_report: PAGE_RECONCILIATION_REPORT_FILE,
    ...(accessRemediationWrite ? { access_remediation_plan: ACCESS_REMEDIATION_PLAN_FILE } : {}),
    ...(report.artifacts?.[ROUTE_CAPTURE_PLAN_FILE] ? { route_capture_plan: ROUTE_CAPTURE_PLAN_FILE } : {}),
  };
  report.result_status = userReport.result_status;
  markStageSubstepProgress(context, 'buildUserReport', {
    message: '用户报告生成完成。',
    processedCount: Object.keys(stageRecords ?? {}).length,
    totalCount: Object.keys(stageRecords ?? {}).length,
    discoveredCount: (userReport.capabilities?.enabled?.length ?? 0)
      + (userReport.capabilities?.limited_enabled?.length ?? 0)
      + (userReport.capabilities?.confirmation_required?.length ?? 0),
    skippedCount: report.warnings?.length ?? 0,
    currentItem: userReport.result_status ?? report.status ?? null,
  });
  const userReportWrite = await writeRedactedArtifactJson(context, USER_REPORT_FILE, userReport);
  report.artifacts[USER_REPORT_FILE] = userReportWrite.artifactPath;
  const userReportAliasWrite = await writeRedactedArtifactJson(context, USER_REPORT_JSON_ALIAS, userReportWrite.value);
  report.artifacts[USER_REPORT_JSON_ALIAS] = userReportAliasWrite.artifactPath;
  markStageSubstepProgress(context, 'writeMarkdown', {
    message: '写入用户 Markdown 摘要。',
    processedCount: 0,
    totalCount: 2,
    discoveredCount: 0,
  });
  const userMarkdown = renderBuildUserMarkdown(userReportWrite.value, report, { cwd: context.cwd });
  const userMarkdownPath = await writeArtifactText(context, USER_REPORT_MARKDOWN_FILE, userMarkdown);
  report.artifacts[USER_REPORT_MARKDOWN_FILE] = userMarkdownPath;
  const userMarkdownAliasPath = await writeArtifactText(context, USER_REPORT_MARKDOWN_ALIAS, userMarkdown);
  report.artifacts[USER_REPORT_MARKDOWN_ALIAS] = userMarkdownAliasPath;
  markStageSubstepProgress(context, 'writeMarkdown', {
    message: '用户 Markdown 摘要写入完成。',
    processedCount: 2,
    totalCount: 2,
    discoveredCount: 2,
    currentItem: USER_REPORT_MARKDOWN_FILE,
  });
  markStageSubstepProgress(context, 'buildDebugReport', {
    message: '生成调试报告和脱敏审计。',
    processedCount: 0,
    totalCount: Object.keys(report.artifacts ?? {}).length,
    discoveredCount: 0,
  });
  const debugBase = buildDebugReport(context, stageResults, stageRecords, report, userReportWrite.value, {
    siteAdapter: siteAdapterSummaryForReport(context, { includeSource: true }),
  });
  const debugPrepared = prepareRedactedArtifactJsonWithAudit(debugBase);
  const debugReport = {
    ...debugPrepared.value,
    sanitization_report: debugPrepared.auditValue,
  };
  const debugReportWrite = await writeRedactedArtifactJson(context, DEBUG_REPORT_FILE, debugReport);
  report.artifacts[DEBUG_REPORT_FILE] = debugReportWrite.artifactPath;
  const debugReportAliasWrite = await writeRedactedArtifactJson(context, DEBUG_REPORT_JSON_ALIAS, debugReportWrite.value);
  report.artifacts[DEBUG_REPORT_JSON_ALIAS] = debugReportAliasWrite.artifactPath;
  const htmlReportPath = await writeCapabilityIntentHtmlReport(context, stageResults, report, userReportWrite.value);
  report.artifacts[CAPABILITY_INTENT_SUMMARY_HTML_FILE] = htmlReportPath;
  report.artifacts[INDEX_REPORT_FILE] = path.join(context.artifactDir, INDEX_REPORT_FILE);
  markStageSubstepProgress(context, 'buildDebugReport', {
    message: '调试报告和能力意图 HTML 生成完成。',
    processedCount: 3,
    totalCount: 3,
    discoveredCount: Object.keys(debugReportWrite.value?.stages ?? stageRecords ?? {}).length,
    currentItem: DEBUG_REPORT_FILE,
  });
  markStageSubstepProgress(context, 'writeIndexReport', {
    message: '写入报告索引。',
    processedCount: Object.keys(report.artifacts ?? {}).length,
    totalCount: Object.keys(report.artifacts ?? {}).length,
    discoveredCount: Object.keys(report.artifacts ?? {}).length,
    currentItem: INDEX_REPORT_FILE,
  });
  const indexReport = buildReportIndex(report, userReportWrite.value, debugReportWrite.value);
  const buildReportWrite = await writeRedactedArtifactJson(context, INDEX_REPORT_FILE, indexReport);
  report.artifacts[INDEX_REPORT_FILE] = buildReportWrite.artifactPath;
  const returnedBuildReport = {
    ...buildReportWrite.value,
    user_report: userReportWrite.value,
    debug_report: debugReportWrite.value,
  };
  return {
    buildReport: returnedBuildReport,
    artifactPaths: {
      buildReport: buildReportWrite.artifactPath,
      userReport: userReportWrite.artifactPath,
      userMarkdown: userMarkdownPath,
      debugReport: debugReportWrite.artifactPath,
      capabilityIntentSummaryHtml: htmlReportPath,
      pageReconciliationReport: pageReconciliationWrite.artifactPath,
      userReportAlias: userReportAliasWrite.artifactPath,
      userMarkdownAlias: userMarkdownAliasPath,
      debugReportAlias: debugReportAliasWrite.artifactPath,
    },
    summary: report.summary,
  };
}

async function writeFailedBuildReport(context, stageResults, stageRecords, status, error) {
  const failedReport = buildBuildReport(context, stageResults, stageRecords, status, error);
  failedReport.artifacts[CAPABILITY_INTENT_SUMMARY_HTML_FILE] = capabilityIntentSummaryHtmlPath(context);
  if (stageResults.crawlStatic?.artifactPaths?.rawPageMaterialManifest) {
    failedReport.artifacts[RAW_PAGE_MATERIAL_MANIFEST_FILE] = stageResults.crawlStatic.artifactPaths.rawPageMaterialManifest;
  }
  if (stageResults.crawlStatic?.artifactPaths?.authorizedSourceManifest) {
    failedReport.artifacts[AUTHORIZED_SOURCE_MANIFEST_FILE] = stageResults.crawlStatic.artifactPaths.authorizedSourceManifest;
  }
  try {
    const pageReconciliationWrite = await writePageReconciliationReport(context, stageResults, failedReport);
    failedReport.pageReconciliation = pageReconciliationWrite.value;
    /** @type {any} */ (failedReport.summary).pageReconciliation = pageReconciliationWrite.value.summary;
    failedReport.artifacts[PAGE_RECONCILIATION_REPORT_FILE] = pageReconciliationWrite.artifactPath;
    const accessRemediationWrite = await writeAccessRemediationPlanIfNeeded(context, stageResults, pageReconciliationWrite.value);
    if (accessRemediationWrite) {
      failedReport.accessRemediationPlan = accessRemediationWrite.value;
      failedReport.artifacts[ACCESS_REMEDIATION_PLAN_FILE] = accessRemediationWrite.artifactPath;
    }
    if (stageResults.authStateCheck?.artifactPaths?.routeCapturePlan) {
      failedReport.routeCapturePlan = stageResults.authStateCheck.routeCapturePlan ?? null;
      /** @type {any} */ (failedReport.summary).routeCapturePlan = stageResults.authStateCheck.routeCapturePlan ? {
        status: stageResults.authStateCheck.routeCapturePlan.status,
        routeCoverageStatus: stageResults.authStateCheck.routeCapturePlan.routeCoverageStatus,
        retryStatus: stageResults.authStateCheck.routeCapturePlan.retryStatus,
        retryPasses: stageResults.authStateCheck.routeCapturePlan.retryPasses,
        routeCount: stageResults.authStateCheck.routeCapturePlan.routeCount,
        capturedRouteCount: stageResults.authStateCheck.routeCapturePlan.capturedRouteCount,
        missingRouteCount: stageResults.authStateCheck.routeCapturePlan.missingRouteCount,
      } : null;
      failedReport.artifacts[ROUTE_CAPTURE_PLAN_FILE] = stageResults.authStateCheck.artifactPaths.routeCapturePlan;
    }
    if (pageReconciliationWrite.value.status !== 'passed') {
      failedReport.warnings = uniqueSortedStrings([
        ...(failedReport.warnings ?? []),
        `page-reconciliation:${pageReconciliationWrite.value.summary.reasonCodes.join(',') || pageReconciliationWrite.value.status}`,
      ]);
    }
  } catch (reconciliationError) {
    failedReport.warnings = uniqueSortedStrings([
      ...(failedReport.warnings ?? []),
      `page-reconciliation-skipped:${reconciliationError?.reasonCode ?? reconciliationError?.code ?? 'report-generation-failed'}`,
    ]);
  }
  const userReport = buildUserReport(context, stageResults, failedReport);
  /** @type {any} */ (userReport).reports = {
    ...(/** @type {any} */ (userReport).reports ?? {}),
    page_reconciliation_report: PAGE_RECONCILIATION_REPORT_FILE,
    ...(failedReport.artifacts?.[ACCESS_REMEDIATION_PLAN_FILE] ? { access_remediation_plan: ACCESS_REMEDIATION_PLAN_FILE } : {}),
    ...(failedReport.artifacts?.[ROUTE_CAPTURE_PLAN_FILE] ? { route_capture_plan: ROUTE_CAPTURE_PLAN_FILE } : {}),
  };
  /** @type {any} */ (userReport).build_completion = {
    ...(/** @type {any} */ (userReport).build_completion ?? {}),
    page_reconciliation_report: PAGE_RECONCILIATION_REPORT_FILE,
    ...(failedReport.artifacts?.[ACCESS_REMEDIATION_PLAN_FILE] ? { access_remediation_plan: ACCESS_REMEDIATION_PLAN_FILE } : {}),
    ...(failedReport.artifacts?.[ROUTE_CAPTURE_PLAN_FILE] ? { route_capture_plan: ROUTE_CAPTURE_PLAN_FILE } : {}),
  };
  failedReport.result_status = userReport.result_status;
  const userReportWrite = await writeRedactedArtifactJson(context, USER_REPORT_FILE, userReport);
  failedReport.artifacts[USER_REPORT_FILE] = userReportWrite.artifactPath;
  const userReportAliasWrite = await writeRedactedArtifactJson(context, USER_REPORT_JSON_ALIAS, userReportWrite.value);
  failedReport.artifacts[USER_REPORT_JSON_ALIAS] = userReportAliasWrite.artifactPath;
  const userMarkdown = renderBuildUserMarkdown(userReportWrite.value, failedReport, { cwd: context.cwd });
  const userMarkdownPath = await writeArtifactText(context, USER_REPORT_MARKDOWN_FILE, userMarkdown);
  failedReport.artifacts[USER_REPORT_MARKDOWN_FILE] = userMarkdownPath;
  const userMarkdownAliasPath = await writeArtifactText(context, USER_REPORT_MARKDOWN_ALIAS, userMarkdown);
  failedReport.artifacts[USER_REPORT_MARKDOWN_ALIAS] = userMarkdownAliasPath;
  const debugBase = buildDebugReport(context, stageResults, stageRecords, failedReport, userReportWrite.value, {
    siteAdapter: siteAdapterSummaryForReport(context, { includeSource: true }),
  });
  const debugPrepared = prepareRedactedArtifactJsonWithAudit(debugBase);
  const debugReport = {
    ...debugPrepared.value,
    sanitization_report: debugPrepared.auditValue,
  };
  const debugReportWrite = await writeRedactedArtifactJson(context, DEBUG_REPORT_FILE, debugReport);
  failedReport.artifacts[DEBUG_REPORT_FILE] = debugReportWrite.artifactPath;
  const debugReportAliasWrite = await writeRedactedArtifactJson(context, DEBUG_REPORT_JSON_ALIAS, debugReportWrite.value);
  failedReport.artifacts[DEBUG_REPORT_JSON_ALIAS] = debugReportAliasWrite.artifactPath;
  try {
    const htmlReportPath = await writeCapabilityIntentHtmlReport(context, stageResults, failedReport, userReportWrite.value);
    failedReport.artifacts[CAPABILITY_INTENT_SUMMARY_HTML_FILE] = htmlReportPath;
  } catch (htmlError) {
    failedReport.warnings = uniqueSortedStrings([
      ...(failedReport.warnings ?? []),
      `capability-intent-html-report-skipped:${htmlError?.reasonCode ?? htmlError?.code ?? 'report-generation-failed'}`,
    ]);
    delete failedReport.artifacts[CAPABILITY_INTENT_SUMMARY_HTML_FILE];
  }
  failedReport.artifacts[INDEX_REPORT_FILE] = path.join(context.artifactDir, INDEX_REPORT_FILE);
  const indexReport = buildReportIndex(failedReport, userReportWrite.value, debugReportWrite.value);
  const buildReportWrite = await writeRedactedArtifactJson(context, INDEX_REPORT_FILE, indexReport);
  failedReport.artifacts[INDEX_REPORT_FILE] = buildReportWrite.artifactPath;
  const returnedBuildReport = {
    ...buildReportWrite.value,
    user_report: userReportWrite.value,
    debug_report: debugReportWrite.value,
  };
  error.buildReport = returnedBuildReport;
  error.buildReportPath = buildReportWrite.artifactPath;
  error.artifactDir = context.artifactDir;
  return returnedBuildReport;
}

const STAGE_IMPLS = Object.freeze({
  registerSite: registerSiteStage,
  discoverSeeds: discoverSeedsStage,
  crawlStatic: crawlStaticStage,
  authStateCheck: authStateCheckStage,
  crawlAuthenticated: crawlAuthenticatedStage,
  crawlRendered: crawlRenderedStage,
  discoverInteractions: discoverInteractionsStage,
  captureNetworkTraces: captureNetworkTracesStage,
  apiAdapterReplay: apiAdapterReplayStage,
  buildSiteGraph: buildSiteGraphStage,
  classifyNodes: classifyNodesStage,
  extractAffordances: extractAffordancesStage,
  discoverCapabilities: discoverCapabilitiesStage,
  generateIntents: generateIntentsStage,
  compileExecutionContracts: compileExecutionContractsStage,
  evaluateExecutionGovernance: evaluateExecutionGovernanceStage,
  dispatchGovernedRuntime: dispatchGovernedRuntimeStage,
  generateSkill: generateSkillStage,
  verifySkill: verifySkillStage,
  registerSkill: registerSkillStage,
  writeBuildReport: writeBuildReportStage,
});

export async function runSiteForgeBuild(inputUrl, options = /** @type {any} */ ({})) {
  const context = createInitialContext(inputUrl, options);
  await hydrateBuildProfile(context);
  if (!context.authStateReport) {
    context.authStateReport = createPublicOnlyAuthStateReport({
      site: context.site,
      authMethod: context.crawlContract?.authMethod ?? 'none',
    });
  }
  if (!context.crawlContract) {
    context.crawlContract = createCrawlContract({
      site: context.site,
      authStateReport: context.authStateReport,
    });
  }
  await ensureSiteWorkspace(context.workspace, context.site, { nowIso: context.startedAt });
  await ensureBuildDirectories(context);
  const stageResults = /** @type {any} */ ({});
  const stageRecords = /** @type {any} */ ({});
  const setupBlock = setupProfileBuildBlock(context.setupProfile, context.options);
  if (setupBlock) {
    const startedAt = new Date().toISOString();
    const error = createBlockedStageError(setupBlock.code, setupBlock.message, {
      warnings: setupBlock.warnings,
      reasonCodes: setupBlock.reasonCodes,
      summary: setupBlock.summary,
    });
    error.stage = 'registerSite';
    stageRecords.registerSite = buildStageRecord('registerSite', 'blocked', {
      errors: [error.message],
      warnings: error.warnings ?? [],
      reasonCode: error.reasonCode,
      reasonCodes: error.reasonCodes ?? [],
      summary: error.summary ?? {},
    }, startedAt, new Date().toISOString(), STAGE_DEPENDENCIES);
    for (const skipped of SITEFORGE_BUILD_STAGE_NAMES.slice(1)) {
      stageRecords[skipped] = buildStageRecord(skipped, 'skipped', {
        warnings: ['Skipped because setup profile is not buildable.'],
      }, new Date().toISOString(), new Date().toISOString(), STAGE_DEPENDENCIES);
    }
    await writeFailedBuildReport(context, stageResults, stageRecords, error.buildStatus ?? 'blocked', error);
    throw error;
  }

  for (const stageName of SITEFORGE_BUILD_STAGE_NAMES) {
    for (const dependency of STAGE_DEPENDENCIES[stageName] ?? []) {
      if (!stageResults[dependency]) {
        throw new Error(`Stage ${stageName} missing dependency ${dependency}`);
      }
    }
    const startedAt = new Date().toISOString();
    const initialSubstepState = beginStageSubsteps(context, stageRecords, stageResults, stageName, startedAt);
    updateWebInteractionBuildState(
      context,
      {
        ...stageRecords,
        [stageName]: buildStageRecord(stageName, 'running', initialSubstepState, startedAt, null, STAGE_DEPENDENCIES),
      },
      stageResults,
      { phase: 'build', status: `running:${stageName}` },
    );
    try {
      const result = await STAGE_IMPLS[stageName](context, stageResults, stageRecords);
      stageResults[stageName] = result;
      const status = result.status ?? 'success';
      stageRecords[stageName] = buildStageRecord(stageName, status, {
        ...result,
        ...finishStageSubsteps(context, stageName, status),
      }, startedAt, new Date().toISOString(), STAGE_DEPENDENCIES);
      updateWebInteractionBuildState(context, stageRecords, stageResults, {
        phase: 'build',
        status: status === 'success' ? `completed:${stageName}` : status,
      });
    } catch (error) {
      error.stage = stageName;
      const stageStatus = error?.stageStatus ?? 'failed';
      stageRecords[stageName] = buildStageRecord(stageName, stageStatus, {
        errors: [error?.message ?? String(error)],
        warnings: error?.warnings ?? [],
        reasonCode: error?.reasonCode ?? null,
        reasonCodes: [
          error?.reasonCode,
          ...(error?.reasonCodes ?? []),
        ].filter(Boolean),
        artifactPaths: {
          ...(error?.artifactPaths ?? {}),
          ...(error?.verificationReportPath ? { verificationReport: error.verificationReportPath } : {}),
        },
        summary: error?.summary ?? {},
        ...finishStageSubsteps(context, stageName, stageStatus),
      }, startedAt, new Date().toISOString(), STAGE_DEPENDENCIES);
      for (const skipped of SITEFORGE_BUILD_STAGE_NAMES.slice(SITEFORGE_BUILD_STAGE_NAMES.indexOf(stageName) + 1)) {
        stageRecords[skipped] = buildStageRecord(skipped, 'skipped', {
          warnings: [`Skipped because ${stageName} ${stageStatus}.`],
        }, new Date().toISOString(), new Date().toISOString(), STAGE_DEPENDENCIES);
      }
      await writeFailedBuildReport(context, stageResults, stageRecords, error?.buildStatus ?? 'failed', error);
      updateWebInteractionBuildState(context, stageRecords, stageResults, {
        phase: 'outputs',
        status: stageStatus,
      });
      throw error;
    }
  }

  const result = {
    ...stageResults.writeBuildReport.buildReport,
    buildContext: {
      buildId: context.buildId,
      siteId: context.site.id,
      siteDir: context.workspace.paths.siteDir,
      buildDir: context.workspace.paths.buildDir,
      site: context.site,
      artifactDir: context.artifactDir,
      workspace: context.workspace,
      setupProfile: setupProfileSummary(context.setupProfile),
      setupCollectionReview: setupCollectionReviewReport(context.setupCollectionReview, context.setupCollectionReviewPath),
      artifactStore: context.artifactStore,
      startedAt: context.startedAt,
      policy: context.policy,
    },
    stageResults,
    stages: stageRecords,
    stageRecords,
  };
  updateWebInteractionBuildState(context, stageRecords, stageResults, {
    phase: 'capabilities',
    status: 'waiting_for_capability_decisions',
    result,
  });
  return result;
}

export function siteForgeBuildCliJson(result, options = /** @type {any} */ ({})) {
  return `${prepareRedactedArtifactJsonWithAudit(buildReportPayloadForMode(result, options)).json}\n`;
}

function renderSiteForgeUserBuildSummary(result, options = /** @type {any} */ ({})) {
  return renderFriendlySiteForgeUserBuildSummary(result, options);
}

export function renderSiteForgeBuildSummary(result, options = /** @type {any} */ ({})) {
  const mode = normalizeReportMode(
    options.reportMode ?? options.report ?? (options.debug || options.verbose ? 'debug' : 'user'),
  );
  const userSummary = renderSiteForgePlainBuildSummary(result, options);
  if (mode === 'user') {
    return userSummary;
  }
  const debugPath = result.artifacts?.[DEBUG_REPORT_FILE]
    ?? result.artifacts?.[DEBUG_REPORT_JSON_ALIAS]
    ?? DEBUG_REPORT_FILE;
  const indexPath = result.artifacts?.[INDEX_REPORT_FILE] ?? INDEX_REPORT_FILE;
  return `${userSummary}\nDeveloper report:\n  - Debug JSON: ${displayPath(debugPath, options.cwd)}\n  - Report index: ${displayPath(indexPath, options.cwd)}\n`;
}

export function renderSiteForgeBuildDebugSummary(result, options = /** @type {any} */ ({})) {
  const counts = result.summary ?? {};
  const capabilityCountsSummary = counts.capabilities ?? {};
  const lines = [
    `SiteForge build ${buildStatusLabel(result.status)}`,
    '',
    `Site ID: ${result.siteId}`,
    `Build ID: ${result.buildId}`,
    `Seeds: ${counts.seeds ?? 0}`,
    `Nodes: ${counts.nodes ?? 0}`,
    `Affordances: ${counts.affordances ?? 0}`,
    `Capabilities: active=${capabilityCountsSummary.active ?? 0} candidate=${capabilityCountsSummary.candidate ?? 0} discarded=${capabilityCountsSummary.discarded ?? 0}`,
    `Intents: ${counts.intents ?? 0}`,
    `Skill ID: ${result.skillId ?? '-'}`,
    `Verification: ${verificationStatusLabel(counts.verificationStatus)}`,
    `Registry: ${verificationStatusLabel(counts.registryStatus)}`,
    '',
    'Artifacts:',
    `  Build: ${displayPath(result.artifactDir, options.cwd)}`,
    `  Skill: ${displayPath(result.skillDir, options.cwd)}`,
    `  Report: ${displayPath(result.artifacts?.['build_report.json'], options.cwd)}`,
  ];
  if (counts.autoDiscovery) {
    lines.push(
      '',
      'Auto-discovery:',
      `  mode=${counts.autoDiscoveryMode ?? 'default'} nodes_total=${counts.autoDiscovery.nodes_total ?? 0} actionable_elements=${counts.autoDiscovery.actionable_elements ?? 0} route_templates=${counts.autoDiscovery.route_templates ?? 0}`,
      `  dynamic=${counts.autoDiscoveryDynamicEnabled ? 'enabled' : 'not-enabled'} network=${counts.autoDiscoveryNetworkEnabled ? 'enabled' : 'not-enabled'}`,
    );
    if (!counts.autoDiscoveryDynamicEnabled || !counts.autoDiscoveryNetworkEnabled) {
      lines.push('  Impact: SPA route/state structure was modeled from sanitized summaries; browser-rendered crawl and raw network trace capture are not enabled.');
      lines.push('  Internal sanitized check: node src/entrypoints/build/run-build.mjs <url> --auto --deep --network');
    }
  }
  const warnings = result.warnings ?? [];
  if (warnings.length) {
    lines.push('', 'Warnings:');
    for (const warning of warnings) {
      lines.push(`  - ${displayBuildWarning(warning)}`);
    }
  }
  const setupCollectionReviewLines = renderSetupCollectionReviewLines(result.setupCollectionReview);
  if (setupCollectionReviewLines.length) {
    lines.push('', ...setupCollectionReviewLines);
  }
  const unsuccessful = result.collectionOutcomes?.unsuccessful ?? [];
  if (unsuccessful.length) {
    lines.push('', 'Unsuccessful collection:', ...renderCollectionOutcomeTable(unsuccessful));
    if (result.collectionOutcomes?.truncated) {
      lines.push(`  (Showing first ${result.collectionOutcomes.limit ?? unsuccessful.length} items; see build_report.json for the full list.)`);
    }
  }
  return `${lines.join('\n')}\n`;
}
