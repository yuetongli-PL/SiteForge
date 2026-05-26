// @ts-check

import path from 'node:path';
import process from 'node:process';
import { rm } from 'node:fs/promises';
import { displayPath, displayReportPath } from '../../../infra/cli/path-display.mjs';
import { buildStatusLabel, collectionStatusLabel, verificationStatusLabel } from '../../../infra/cli/status-labels.mjs';
import { openBrowserSession } from '../../../infra/browser/session.mjs';
import { pathExists } from '../../../infra/io.mjs';
import { jsonClone } from '../../../shared/clone.mjs';
import { mapWithConcurrency } from '../../../shared/concurrency.mjs';
import { slugifyAscii, uniqueSortedStrings } from '../../../shared/normalize.mjs';
import { sanitizePublicUrl } from '../../../shared/url-safety.mjs';
import {
  policySupportsCapabilityFamily,
} from '../../../sites/registry/core/capability-intent-mapping.mjs';
import {
  assertNoForbiddenPatterns,
  prepareRedactedArtifactJsonWithAudit,
} from '../../../domain/sessions/security-guard.mjs';
import {
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
  capabilityEnabledStatusCounts,
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
  buildCapabilitySafeRemediationPath,
  capabilityEnablementStatusCounts,
  capabilityEvidenceStatusSummary,
  findForcedDisabledActions,
  isReadOnlyFollowSurface,
  normalizeCapabilityEnablementStatus,
  normalizeCapabilityEvidenceStatus,
  publicSafeRemediation,
  riskPolicySummary,
  sanitizeEvidenceRef,
} from './risk-policy.mjs';
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
  siteForgeReportModeSet,
} from './artifact-contract.mjs';
import {
  AUTH_STATE_REPORT_FILE,
  CRAWL_AUTHENTICATED_FILE,
  authRuntimeMaterialFrom,
  authSummaryForReport,
  canRunAuthenticatedLayer,
  createCrawlContract,
  createPublicOnlyAuthStateReport,
  evidenceLevelRank,
  normalizeAuthStateReport,
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
  runtimeProviderPromotionMetadata,
} from './runtime-provider.mjs';
import { runBrowserBridgeApiReplay } from './browser-auth-bridge.mjs';

export const SITEFORGE_BUILD_STAGE_NAMES = Object.freeze([
  'registerSite',
  'discoverSeeds',
  'crawlStatic',
  'authStateCheck',
  'crawlAuthenticated',
  'crawlRendered',
  'discoverInteractions',
  'captureNetworkTraces',
  'apiAdapterReplay',
  'buildSiteGraph',
  'classifyNodes',
  'extractAffordances',
  'discoverCapabilities',
  'generateIntents',
  'generateSkill',
  'verifySkill',
  'registerSkill',
  'writeBuildReport',
]);

const STAGE_DEPENDENCIES = Object.freeze({
  registerSite: [],
  discoverSeeds: ['registerSite'],
  crawlStatic: ['discoverSeeds'],
  authStateCheck: ['crawlStatic'],
  crawlAuthenticated: ['authStateCheck'],
  crawlRendered: ['crawlAuthenticated'],
  discoverInteractions: ['crawlStatic', 'crawlAuthenticated'],
  captureNetworkTraces: ['crawlRendered'],
  apiAdapterReplay: ['captureNetworkTraces'],
  buildSiteGraph: ['crawlStatic', 'crawlAuthenticated', 'discoverInteractions', 'apiAdapterReplay'],
  classifyNodes: ['buildSiteGraph'],
  extractAffordances: ['classifyNodes', 'discoverInteractions'],
  discoverCapabilities: ['extractAffordances'],
  generateIntents: ['discoverCapabilities'],
  generateSkill: ['classifyNodes', 'discoverCapabilities', 'generateIntents'],
  verifySkill: ['generateSkill'],
  registerSkill: ['verifySkill'],
  writeBuildReport: ['registerSkill'],
});

const REPORT_MODES = siteForgeReportModeSet();

const USER_AUTHORIZED_COLLECTION_CONCURRENCY = 4;
const STATIC_CRAWL_COLLECTION_CONCURRENCY = 6;
const COLLECTION_OUTCOME_LIMIT = 40;
const COLLECTION_OUTCOME_STAGE_STATUSES = Object.freeze(['blocked', 'failed', 'skipped']);
const COLLECTION_OUTCOME_STAGE_KINDS = Object.freeze({
  buildSiteGraph: 'node',
  classifyNodes: 'node',
  discoverInteractions: 'affordance',
  extractAffordances: 'affordance',
  discoverCapabilities: 'capability',
  generateIntents: 'capability',
});
const SETUP_COLLECTION_REVIEW_KINDS = Object.freeze(['seeds', 'nodes', 'affordances', 'capabilities', 'intents']);
const ROUTE_CAPTURE_PLAN_FILE = 'route_capture_plan.json';

const clone = jsonClone;

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

const CAPABILITY_SEMANTIC_ALIASES = Object.freeze(new Map([
  ['followed-users', 'list-followed-users'],
  ['read-followed-users', 'list-followed-users'],
  ['following-accounts', 'list-followed-users'],
  ['followed-posts-by-date', 'list-followed-updates'],
  ['followed-updates', 'list-followed-updates'],
  ['following-posts', 'list-followed-updates'],
  ['read-following-timeline', 'list-followed-updates'],
  ['list-recommended-timeline-posts', 'recommended-timeline-posts'],
  ['recommended-timeline', 'recommended-timeline-posts'],
  ['read-recommended-timeline', 'recommended-timeline-posts'],
  ['profile-content', 'list-profile-content'],
  ['read-profile-content', 'list-profile-content'],
  ['account-posts', 'list-profile-content'],
  ['read-followers', 'read-followers'],
  ['list-account-followers', 'read-followers'],
  ['notifications', 'list-notifications'],
  ['notification-summaries', 'list-notifications'],
  ['list-notifications', 'list-notifications'],
  ['read-all-notifications-summary', 'list-notifications'],
  ['bookmarks', 'list-bookmarks'],
  ['bookmark-summaries', 'list-bookmarks'],
  ['list-bookmarks', 'list-bookmarks'],
  ['read-bookmarks-summary', 'list-bookmarks'],
  ['lists', 'list-lists'],
  ['list-summaries', 'list-lists'],
  ['list-lists', 'list-lists'],
  ['read-lists-summary', 'list-lists'],
  ['direct-messages', 'list-direct-messages'],
  ['message-conversation-summaries', 'list-direct-messages'],
  ['list-direct-messages', 'list-direct-messages'],
  ['read-direct-message-conversation-summaries', 'list-direct-messages'],
  ['view-post-detail', 'read-post-detail'],
  ['read-post-detail', 'read-post-detail'],
  ['view-post-replies', 'read-reply-tree-summary'],
  ['read-reply-tree-summary', 'read-reply-tree-summary'],
  ['view-post-media', 'read-media-summary'],
  ['read-media-summary', 'read-media-summary'],
  ['draft-post', 'create-post-draft'],
  ['create-post-draft', 'create-post-draft'],
  ['draft-reply', 'create-reply-draft'],
  ['create-reply-draft', 'create-reply-draft'],
  ['follow-user', 'follow-account'],
  ['follow-account', 'follow-account'],
  ['unfollow-user', 'unfollow-account'],
  ['unfollow-account', 'unfollow-account'],
]));

function canonicalCapabilitySemanticToken(value) {
  const normalized = normalizeSetupCapabilityId(value);
  if (!normalized) {
    return null;
  }
  return CAPABILITY_SEMANTIC_ALIASES.get(normalized) ?? normalized;
}

function capabilitySemanticKey(capability = /** @type {any} */ ({})) {
  const setupToken = canonicalCapabilitySemanticToken(capability.setupCapabilityId);
  if (setupToken) {
    return `setup:${setupToken}`;
  }
  const intentToken = canonicalCapabilitySemanticToken(capability.intentAction);
  if (intentToken) {
    return `setup:${intentToken}`;
  }
  const nameToken = canonicalCapabilitySemanticToken(capability.name);
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
    Number.isFinite(Number(capability.confidence)) ? Number(capability.confidence) : 0,
    capability.autoGenerated === true ? 0 : 0.1,
  ];
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

function dedupeSemanticCapabilities(capabilities = /** @type {any[]} */ ([])) {
  const byKey = new Map();
  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    const key = capabilitySemanticKey(capability);
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

function capabilityCounts(capabilities = /** @type {any[]} */ ([])) {
  const enabledStatus = capabilityEnabledStatusCounts(capabilities);
  return sanitizeReportPublicValue({
    active: capabilities.filter((capability) => capability.status === 'active').length,
    candidate: capabilities.filter((capability) => capability.status === 'candidate').length,
    discarded: capabilities.filter((capability) => capability.status === 'discarded').length,
    disabled: capabilities.filter((capability) => capability.status === 'disabled').length,
    total: capabilities.length,
    enabledStatus,
    countedTotal: enabledStatus.countedTotal,
    embeddedIntents: capabilities.reduce((sum, capability) => sum + (capability.intents?.length ?? 0), 0),
    riskPolicy: riskPolicySummary(capabilities),
  });
}

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

function safeBuildWarningForReport(message, fallbackReasonCode = 'validation-failed') {
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

function safeBuildMessagesForReport(messages, fallbackReasonCode = 'validation-failed') {
  return uniqueSortedStrings((messages ?? [])
    .map((message) => safeBuildWarningForReport(message, fallbackReasonCode))
    .filter(Boolean));
}

function buildStageRecord(name, status, result = /** @type {any} */ ({}), startedAt, completedAt) {
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
    deps: STAGE_DEPENDENCIES[name] ?? [],
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
  if (forcedActions.some((action) => ['pay', 'checkout', 'change_payment'].includes(action))) {
    return 'payment';
  }
  if (forcedActions.some((action) => action === 'delete' || action.startsWith('change_') || action === 'edit_profile')) {
    return 'destructive';
  }
  if (forcedActions.length > 0) {
    return 'state_changing';
  }
  if (/checkout|payment|purchase|order|billing/u.test(haystack)) {
    return 'payment';
  }
  if (/delete|remove|destroy|cancel account/u.test(haystack)) {
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
  if (forcedActions.some((action) => ['pay', 'checkout', 'change_payment'].includes(action))) {
    return 'payment';
  }
  if (forcedActions.some((action) => action === 'delete' || action.startsWith('change_') || action === 'edit_profile')) {
    return 'destructive';
  }
  if (forcedActions.length > 0) {
    return 'state_changing';
  }
  if (/checkout|payment|purchase|order|billing/u.test(haystack)) {
    return 'payment';
  }
  if (/delete|remove|destroy|cancel account/u.test(haystack)) {
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
    return 'requires_confirmation';
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
  const homepage = graph.nodes.find((node) => node.classification === 'homepage') ?? graph.nodes.find((node) => node.type === 'page');
  const title = homepage?.title ?? '';
  const slug = slugifyAscii(title.replace(/\bhome\b/giu, '').trim(), '');
  const genericSlugs = new Set(['site', 'home', 'index', 'av', 'official', 'welcome', 'top']);
  if (slug && slug.length >= 3 && !genericSlugs.has(slug)) {
    return slug;
  }
  const knownSiteKey = context.setupProfile?.knownSitePolicy?.siteKey
    ?? context.setupProfile?.knownSitePolicy?.adapterId
    ?? context.site?.siteKey
    ?? context.site?.adapterId;
  const knownSlug = slugifyAscii(knownSiteKey, '');
  if (knownSlug && knownSlug.length >= 3 && !genericSlugs.has(knownSlug)) {
    return knownSlug;
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

function setupProfileSummary(profile = null) {
  if (!profile) {
    return null;
  }
  const knownSitePolicy = profile.knownSitePolicy ? {
    status: profile.knownSitePolicy.status ?? null,
    host: profile.knownSitePolicy.host ?? null,
    siteKey: profile.knownSitePolicy.siteKey ?? null,
    adapterId: profile.knownSitePolicy.adapterId ?? null,
    siteArchetype: profile.knownSitePolicy.siteArchetype ?? null,
    primaryArchetype: profile.knownSitePolicy.primaryArchetype ?? null,
    sources: clone(profile.knownSitePolicy.sources ?? []),
    pageTypes: clone(profile.knownSitePolicy.pageTypes ?? []),
    publicRouteTemplates: clone(profile.knownSitePolicy.publicRouteTemplates ?? []),
    capabilityFamilies: clone(profile.knownSitePolicy.capabilityFamilies ?? []),
    supportedIntents: clone(profile.knownSitePolicy.supportedIntents ?? []),
    downloadTaskTypes: clone(profile.knownSitePolicy.downloadTaskTypes ?? []),
    downloadSupport: clone(profile.knownSitePolicy.downloadSupport ?? null),
    downloader: clone(profile.knownSitePolicy.downloader ?? null),
  } : null;
  const evidenceQuality = profile.evidenceQuality ? {
    sourceAvailability: clone(profile.evidenceQuality.sourceAvailability ?? {}),
    sourceStatus: clone(profile.evidenceQuality.sourceStatus ?? {}),
    actualPageEvidenceCount: profile.evidenceQuality.actualPageEvidenceCount ?? 0,
    syntheticPageEvidenceCount: profile.evidenceQuality.syntheticPageEvidenceCount ?? 0,
    robotsExcludedPageEvidenceCount: profile.evidenceQuality.robotsExcludedPageEvidenceCount ?? 0,
    allPrimarySourcesUnavailable: profile.evidenceQuality.allPrimarySourcesUnavailable === true,
    syntheticFallbackOnly: profile.evidenceQuality.syntheticFallbackOnly === true,
    robotsExcludedAllCandidateEvidence: profile.evidenceQuality.robotsExcludedAllCandidateEvidence === true,
    knownPolicyCapabilityPressure: profile.evidenceQuality.knownPolicyCapabilityPressure ? clone(profile.evidenceQuality.knownPolicyCapabilityPressure) : null,
  } : null;
  return {
    artifactFamily: profile.artifactFamily ?? null,
    source: profile.source ?? null,
    knownSitePolicy,
    evidenceQuality,
    crawlContract: profile.crawlContract ? {
      crawlMode: profile.crawlContract.crawlMode ?? null,
      sourceMode: profile.crawlContract.sourceMode ?? null,
      authMethod: profile.crawlContract.authMethod ?? null,
      authVerificationStatus: profile.crawlContract.authVerificationStatus ?? null,
      coverageTargets: clone(profile.crawlContract.coverageTargets ?? {}),
      evidencePolicy: clone(profile.crawlContract.evidencePolicy ?? {}),
    } : null,
    authState: profile.authStateReport ? {
      crawlMode: profile.authStateReport.crawlMode ?? null,
      authMethod: profile.authStateReport.authMethod ?? null,
      authVerificationStatus: profile.authStateReport.authVerificationStatus ?? null,
      verified: profile.authStateReport.verified === true,
      source: profile.authStateReport.source ?? null,
      rawMaterialPersisted: profile.authStateReport.rawMaterialPersisted === true,
      sessionMaterialPersisted: profile.authStateReport.sessionMaterialPersisted === true,
      browserProfilePersisted: profile.authStateReport.browserProfilePersisted === true,
    } : null,
    userAuthorizedEvidence: profile.userAuthorizedEvidence ? {
      status: profile.userAuthorizedEvidence.status ?? null,
      source: profile.userAuthorizedEvidence.source ?? null,
      authorizationMode: profile.userAuthorizedEvidence.authorizationMode ?? null,
      pageCount: profile.userAuthorizedEvidence.pages?.length ?? 0,
      browserSeedCount: profile.userAuthorizedEvidence.browserSeeds?.length ?? 0,
      capabilityProofCount: profile.userAuthorizedEvidence.capabilityProofs?.length ?? 0,
      sessionMaterialPersisted: profile.userAuthorizedEvidence.sessionMaterialPersisted === true,
      browserProfilePersisted: profile.userAuthorizedEvidence.browserProfilePersisted === true,
      pageSourcePersisted: profile.userAuthorizedEvidence.rawHtmlPersisted === true,
    } : null,
    buildReadiness: profile.buildReadiness ? clone(profile.buildReadiness) : null,
    partialCoverage: profile.partialCoverage ? clone(profile.partialCoverage) : null,
    profileUsability: profile.profileUsability ? clone(profile.profileUsability) : null,
    scope: profile.scope ?? null,
    safety: profile.safety ? {
      submitForms: profile.safety.submitForms === true,
      allowDestructiveActions: profile.safety.allowDestructiveActions === true,
      allowPayment: profile.safety.allowPayment === true,
      allowAccountMutation: profile.safety.allowAccountMutation === true,
      allowContactSubmit: profile.safety.allowContactSubmit === true,
    } : null,
    selectedCapabilityCount: profile.capabilityScope?.selectedCapabilities?.length ?? 0,
  };
}

function collectionReviewCount(review, kind, status) {
  const explicit = review?.summary?.[kind]?.[status];
  if (Number.isFinite(Number(explicit))) {
    return Number(explicit);
  }
  const bucket = review?.[kind]?.[status];
  return Array.isArray(bucket) ? bucket.length : 0;
}

function collectionReviewBucketSummary(review = null) {
  return Object.fromEntries(SETUP_COLLECTION_REVIEW_KINDS.map((kind) => [kind, {
    collected: collectionReviewCount(review, kind, 'collected'),
    missing: collectionReviewCount(review, kind, 'missing'),
  }]));
}

function collectionReviewMissingRecords(review = null) {
  const records = /** @type {any[]} */ ([]);
  for (const kind of ['capabilities', 'intents']) {
    for (const item of review?.[kind]?.missing ?? []) {
      records.push({
        kind,
        id: normalizeSetupCapabilityId(item?.id ?? item?.label),
        label: item?.label ?? item?.id ?? null,
        source: item?.source ?? null,
        reasonCode: item?.reasonCode ?? null,
        requiresUserAuthorization: item?.requiresUserAuthorization === true,
        requiresCapabilityEvidence: item?.requiresCapabilityEvidence === true,
        evidenceRequirement: item?.extra?.evidenceRequirement ?? null,
        recommended: item?.extra?.recommended === true,
      });
    }
  }
  return records.filter((record) => record.id || record.label);
}

const FINAL_REVIEW_GENERIC_TOKENS = new Set([
  'a',
  'an',
  'and',
  'browse',
  'capability',
  'content',
  'list',
  'navigate',
  'open',
  'page',
  'pages',
  'policy',
  'public',
  'read',
  'site',
  'to',
  'view',
]);

function finalReviewTokens(value) {
  return normalizeSetupCapabilityId(value)
    .split('-')
    .filter((token) => token.length > 1);
}

function finalReviewDistinctiveTokens(value) {
  const tokens = finalReviewTokens(value);
  const distinctive = tokens.filter((token) => !FINAL_REVIEW_GENERIC_TOKENS.has(token));
  return distinctive.length ? distinctive : tokens;
}

function finalReviewAliases(record = /** @type {any} */ ({})) {
  const id = normalizeSetupCapabilityId(record.id ?? record.label);
  const aliases = [finalReviewDistinctiveTokens(id)];
  if (/categor/u.test(id)) aliases.push(['category'], ['categories']);
  if (/chapter/u.test(id)) aliases.push(['chapter']);
  if (/book/u.test(id)) aliases.push(['book']);
  if (/search/u.test(id)) aliases.push(['search']);
  if (/rank/u.test(id)) aliases.push(['ranking'], ['rank']);
  if (/profile|author/u.test(id)) aliases.push(['profile'], ['author']);
  if (/repository|repo/u.test(id)) aliases.push(['repository'], ['repositories']);
  if (/article|news/u.test(id)) aliases.push(['article'], ['news']);
  if (/utility|navigation/u.test(id)) aliases.push(['navigation'], ['route']);
  if (/content/u.test(id)) aliases.push(['detail'], ['book'], ['work'], ['article'], ['repository'], ['content']);
  return aliases.filter((tokens) => Array.isArray(tokens) && tokens.length > 0);
}

function finalReviewSignalRecords(capabilities = /** @type {any[]} */ ([]), intents = /** @type {any[]} */ ([])) {
  const callableCapabilityIds = new Set((intents ?? [])
    .filter((intent) => intent.callable !== false)
    .map((intent) => normalizeSetupCapabilityId(intent.capabilityId))
    .filter(Boolean));
  const capabilitySignals = (capabilities ?? [])
    .filter((capability) => (
      capability.status === 'active'
      || capability.enabled_status === 'enabled'
      || capability.enabled_status === 'limited_enabled'
      || callableCapabilityIds.has(normalizeSetupCapabilityId(capability.id))
    ))
    .flatMap((capability) => [
      capability.id,
      capability.name,
      capability.user_facing_name,
      capability.userFacingName,
      capability.userValue,
      capability.action,
      capability.object,
      capability.category,
      capability.setupCapabilityId,
      capability.intentAction,
      capability.routeTemplate,
      capability.routePath,
      ...(capability.intents ?? []),
    ]);
  const intentSignals = (intents ?? [])
    .filter((intent) => intent.callable !== false)
    .flatMap((intent) => [
      intent.id,
      intent.name,
      intent.capabilityId,
      intent.canonicalUtterance,
      ...(intent.utteranceExamples ?? []),
    ]);
  return uniqueSortedStrings([...capabilitySignals, ...intentSignals]
    .map(normalizeSetupCapabilityId)
    .filter(Boolean));
}

function finalReviewSignalCovers(record, signals = /** @type {any[]} */ ([])) {
  const target = normalizeSetupCapabilityId(record?.id ?? record?.label);
  if (!target || !signals.length) {
    return false;
  }
  if (signals.some((signal) => signal === target || signal.includes(target) || target.includes(signal))) {
    return true;
  }
  return finalReviewAliases(record).some((aliasTokens) => signals.some((signal) => {
    const signalTokens = new Set(finalReviewTokens(signal));
    return aliasTokens.every((token) => signalTokens.has(token) || signal.includes(token));
  }));
}

function reconcileSetupCollectionReviewWithBuildOutputs(
  review = null,
  capabilities = /** @type {any[]} */ ([]),
  intents = /** @type {any[]} */ ([]),
) {
  if (!review || typeof review !== 'object') {
    return review;
  }
  const signals = finalReviewSignalRecords(capabilities, intents);
  if (!signals.length) {
    return review;
  }
  const next = clone(review);
  for (const kind of ['capabilities', 'intents']) {
    const bucket = next?.[kind];
    if (!bucket || !Array.isArray(bucket.missing)) {
      continue;
    }
    const collected = Array.isArray(bucket.collected) ? bucket.collected : [];
    const missing = [];
    for (const item of bucket.missing) {
      if (finalReviewSignalCovers(item, signals)) {
        collected.push({
          ...item,
          status: 'collected',
          reasonCode: null,
          reason: null,
          collectedBy: 'final-build-capability-or-intent',
          evidence_status: item.evidence_status ?? 'observed_sanitized',
        });
      } else {
        missing.push(item);
      }
    }
    bucket.collected = collected;
    bucket.missing = missing;
  }
  next.summary = {
    ...(next.summary ?? {}),
    ...Object.fromEntries(SETUP_COLLECTION_REVIEW_KINDS.map((kind) => [kind, {
      collected: Array.isArray(next?.[kind]?.collected) ? next[kind].collected.length : 0,
      missing: Array.isArray(next?.[kind]?.missing) ? next[kind].missing.length : 0,
    }])),
  };
  return next;
}

function setupCollectionReviewReport(review = null, sourcePath = null) {
  if (!review || typeof review !== 'object') {
    return null;
  }
  const missingRecords = collectionReviewMissingRecords(review);
  const summary = collectionReviewBucketSummary(review);
  return {
    schemaVersion: review.schemaVersion ?? null,
    artifactFamily: review.artifactFamily ?? 'siteforge-collection-review',
    buildId: review.buildId ?? null,
    siteId: review.siteId ?? null,
    sourceRef: sanitizeEvidenceRef(sourcePath),
    knownSitePolicy: review.knownSitePolicy ? {
      status: review.knownSitePolicy.status ?? null,
      siteKey: review.knownSitePolicy.siteKey ?? null,
      adapterId: review.knownSitePolicy.adapterId ?? null,
      sources: clone(review.knownSitePolicy.sources ?? []),
    } : null,
    userAuthorizedEvidence: review.userAuthorizedEvidence ? {
      status: review.userAuthorizedEvidence.status ?? null,
      pageCount: review.userAuthorizedEvidence.pageCount ?? 0,
      browserSeedCount: review.userAuthorizedEvidence.browserSeedCount ?? 0,
      capabilityProofCount: review.userAuthorizedEvidence.capabilityProofCount ?? 0,
      sessionMaterialPersisted: review.userAuthorizedEvidence.sessionMaterialPersisted === true,
      browserProfilePersisted: review.userAuthorizedEvidence.browserProfilePersisted === true,
      pageSourcePersisted: review.userAuthorizedEvidence.rawHtmlPersisted === true,
    } : null,
    summary,
    missingRecordCount: missingRecords.length,
    missingRecords: missingRecords.slice(0, COLLECTION_OUTCOME_LIMIT),
    truncated: missingRecords.length > COLLECTION_OUTCOME_LIMIT,
    limit: COLLECTION_OUTCOME_LIMIT,
    safetyBoundary: review.safetyBoundary
      ?? 'Collection review is report-only; candidate capabilities still require verified capability-specific proof before activation.',
  };
}

function setupProfileBlockCode(reasonCode) {
  if (String(reasonCode ?? '').includes('robots-disallowed')) {
    return 'robots-disallowed';
  }
  if (reasonCode === 'setup-primary-sources-unavailable') {
    return 'robots-unavailable';
  }
  return 'siteforge-seed-discovery-empty';
}

function setupProfileBuildBlock(profile = null) {
  const blocked = profile?.profileUsability?.buildable === false
    || profile?.profileUsability?.status === 'unusable'
    || profile?.buildReadiness?.buildable === false
    || profile?.buildReadiness?.status === 'not_ready';
  if (!blocked) {
    return null;
  }
  const setupReasonCode = profile?.buildReadiness?.reasonCode
    ?? profile?.profileUsability?.reasonCode
    ?? 'setup-profile-unusable';
  const knownPolicy = profile?.knownSitePolicy ?? null;
  const policySources = clone(knownPolicy?.sources ?? []);
  return {
    code: setupProfileBlockCode(setupReasonCode),
    setupReasonCode,
    message: `Setup profile is not buildable: ${profile?.buildReadiness?.reason ?? profile?.profileUsability?.reason ?? setupReasonCode}.`,
    reasonCodes: uniqueSortedStrings([
      setupReasonCode,
      profile?.profileUsability?.reasonCode,
    ].filter(Boolean)),
    warnings: [
      `setup profile marked unusable; build skipped before activating capabilities (reasonCode=${setupReasonCode}).`,
    ],
    summary: {
      setupProfileBuildable: false,
      setupReasonCode,
      knownSitePolicy: knownPolicy ? {
        siteKey: knownPolicy.siteKey ?? null,
        adapterId: knownPolicy.adapterId ?? null,
        sources: policySources,
      } : null,
    },
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
  return safeOptions;
}

function clearRuntimeAuthInputOptions(options = /** @type {any} */ ({})) {
  delete options.authRuntime;
  delete options.authenticatedStructureSummary;
  delete options.cookieHeader;
  delete options.cookieEnv;
  delete options.cookieFile;
  delete options.cookieStdin;
  return options;
}

function createInitialContext(inputUrl, options = /** @type {any} */ ({})) {
  const now = options.now instanceof Date ? options.now : new Date();
  const startedAt = now.toISOString();
  const site = createSiteRecord(inputUrl, startedAt);
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
  const sitePath = await writeArtifactJson(context, 'site.json', context.site);
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

function knownPolicyPublicSeedRoutes(context) {
  const policyRoutes = context.setupProfile?.knownSitePolicy?.publicRouteTemplates ?? [];
  const contractRoutes = context.crawlContract?.coverageTargets?.publicRoutes ?? [];
  const routes = [
    ...policyRoutes
      .filter((route) => route?.seedable === true && route.path)
      .map((route) => ({
        path: route.path,
        pageType: route.pageType ?? null,
        source: 'known_site_public_route_template',
        reasonCode: 'known-site-public-route',
      })),
    ...contractRoutes.map((path) => ({
      path,
      pageType: null,
      source: 'coverage_target_public_route',
      reasonCode: 'coverage-target-public-route',
    })),
  ];
  return arrayUniqueBy(routes
    .map((route) => {
      const normalizedUrl = routeTargetToUrl(context, route.path);
      if (!normalizedUrl || !isInternalUrl(normalizedUrl, context.site.allowedDomains)) {
        return null;
      }
      return {
        ...route,
        normalizedUrl,
      };
    })
    .filter(Boolean), (route) => route.normalizedUrl)
    .sort((left, right) => left.normalizedUrl.localeCompare(right.normalizedUrl, 'en'));
}

function knownPolicyPublicRouteTemplatePattern(route = /** @type {any} */ ({})) {
  const raw = String(route.pathTemplate ?? route.routeTemplate ?? route.path ?? '').trim();
  if (!raw || /[?#<>"']|(?:authorization|bearer|cookie|sid|uid|token|secret|session|password)/iu.test(raw)) {
    return null;
  }
  const normalized = raw
    .replace(/\{[^}/]+\}/gu, ':id')
    .replace(/\/+/gu, '/');
  if (!normalized.startsWith('/')) {
    return null;
  }
  return normalized.length > 1 ? normalized.replace(/\/$/u, '') : normalized;
}

function knownPolicyPublicRouteTemplates(context) {
  const policyRoutes = context.setupProfile?.knownSitePolicy?.publicRouteTemplates ?? [];
  return arrayUniqueBy(policyRoutes
    .map((route) => {
      const pattern = knownPolicyPublicRouteTemplatePattern(route);
      if (!pattern) {
        return null;
      }
      return {
        pattern,
        pageType: route.pageType ?? null,
        source: route.seedable === true ? 'known_site_public_seed_route_template' : 'known_site_public_route_template',
        seedable: route.seedable === true,
      };
    })
    .filter(Boolean), (route) => `${route.pattern}:${route.pageType ?? ''}`)
    .sort((left, right) => left.pattern.localeCompare(right.pattern, 'en'));
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
  return {
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
        text: `${source} seed ${new URL(normalizedUrl).pathname}; session material was not persisted.`,
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

async function discoverSeedsStage(context) {
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
      return;
    }
    if (!isRobotsAllowed(normalizedUrl, source)) {
      return;
    }
    seeds.push({
      url: urlValue,
      normalizedUrl,
      source,
      confidence,
      evidence,
      ...metadata,
    });
  };
  const sitemapUrls = new Set();
  const processedSitemaps = new Set();
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
    });
  }
  sitemapUrls.add(new URL('/sitemap.xml', context.site.rootUrl).toString());

  const maxSitemaps = Math.max(1, Number(context.policy.maxSitemaps ?? 10));
  const pendingSitemaps = [...sitemapUrls].sort((left, right) => left.localeCompare(right, 'en'));
  for (let index = 0; index < pendingSitemaps.length && processedSitemaps.size < maxSitemaps; index += 1) {
    const sitemapUrl = pendingSitemaps[index];
    if (processedSitemaps.has(sitemapUrl)) {
      continue;
    }
    processedSitemaps.add(sitemapUrl);
    try {
      const sitemap = await context.source.read(sitemapUrl);
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
        continue;
      }
      for (const loc of locs) {
        addSeed(loc, 'sitemap', 0.95, [
          buildEvidence({
            type: 'url',
            source: sitemap.sourcePath ?? sitemapUrl,
            text: loc,
            confidence: 0.95,
          }),
        ]);
      }
    } catch (error) {
      const warning = `sitemap unavailable: ${sitemapUrl}: ${error?.message ?? String(error)}`;
      warnings.push(warning);
      const classified = classifySiteForgeWarning(warning);
      if (classified?.reasonCode) {
        reasonCodes.add(classified.reasonCode);
      }
    }
  }
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

  const dedupedAll = arrayUniqueBy(seeds, (seed) => seed.normalizedUrl)
    .sort((left, right) => left.normalizedUrl.localeCompare(right.normalizedUrl, 'en'));
  const maxSeeds = Math.max(1, Number(context.policy.maxSeeds ?? 100));
  const deduped = dedupedAll.slice(0, maxSeeds);
  if (deduped.length < dedupedAll.length) {
    warnings.push(`seed discovery truncated at maxSeeds=${maxSeeds}; ${dedupedAll.length - deduped.length} seeds were left out.`);
  }
  const hasAuthorizedSourceEvidence = hasAuthorizedSourceStructureEvidence(context);
  const layeredSeeds = layeredSeedsForContext(context, deduped, robotsExcludedUrls, robotsPolicy);
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
    status: deduped.length ? 'success' : hasAuthorizedSourceEvidence ? 'authorized_source_only' : 'blocked',
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
    summary: layeredSeedsSummary(layeredSeeds),
    warnings,
  };
  const seedsPath = await writeArtifactJson(context, 'seeds.json', payload);
  const generatedAdapter = await writeGeneratedSiteAdapterProfile(context, {
    seeds: deduped,
    status: payload.status === 'blocked' ? 'blocked_seed_plan' : 'route_seeded',
    stage: 'discoverSeeds',
  });
  if (!deduped.length && !hasAuthorizedSourceEvidence) {
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
    warnings,
    authorizedSourceOnly: !deduped.length && hasAuthorizedSourceEvidence,
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
      generatedAdapter: generatedAdapter.summary,
    },
  };
}

const REPRESENTATIVE_ROUTE_FAMILY_MIN_SEEDS = 500;
const REPRESENTATIVE_ROUTE_FAMILY_LIVE_MIN_SEEDS = 80;
const REPRESENTATIVE_ROUTE_FAMILY_MAX_PAGES = 240;
const REPRESENTATIVE_ROUTE_FAMILY_LIVE_MAX_PAGES = 80;
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
  const maxRepresentativePages = Math.max(
    1,
    Math.min(
      maxPages,
      Number(context.policy.maxRepresentativePages ?? (
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
    if (familyCount >= representativeLimitForRouteFamily(familyKey)) {
      continue;
    }
    countsByFamily.set(familyKey, familyCount + 1);
    selected.push({
      ...seed,
      representativeRouteFamily: familyKey,
    });
  }
  return {
    mode: 'route_family',
    seeds: selected,
    familyCount: countsByFamily.size,
    maxPages: Math.min(maxRepresentativePages, selected.length || 1),
    warnings: [
      `full coverage seed inventory collapsed to route-family representatives: ${seedList.length} seeds -> ${selected.length} representative crawl URLs; full seed inventory remains in seeds.json.`,
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

function normalizeAuthorizedSourceStructurePage(context, source, page, index = 0) {
  const fallbackUrl = page?.url ?? page?.normalizedUrl ?? source?.url ?? context.site.rootUrl;
  const normalized = normalizePublicRenderedStructurePage(context, {
    ...page,
    url: fallbackUrl,
    normalizedUrl: page?.normalizedUrl ?? page?.url ?? fallbackUrl,
    pageType: page?.pageType ?? page?.page_type ?? 'authorized_source_summary',
    structureItems: Array.isArray(page?.structureItems) ? page.structureItems : page?.structureItem ? [page.structureItem] : [],
    routeTemplates: page?.routeTemplates ?? page?.route_templates ?? [],
  }, { fallbackUrl });
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
    authRequired: false,
    authVerificationStatus: 'not_requested',
    evidenceLevel: normalized.evidenceStatus === 'structure_summary_present' ? 'authorized_source_verified' : 'candidate',
    discoveredBy: 'authorized_source',
    sourcePath: sourceId,
    title: normalized.title || `authorized source ${sourceId}`,
    textSummary: 'authorized source sanitized structure summary; generic live crawl was not used for this evidence',
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
        text: `${sourceKind} authorized source sanitized structure summary; no cookie, token, raw HTML, raw DOM, private body, or browser profile was persisted.`,
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
const RAW_PAGE_MATERIAL_MANIFEST_FILE = 'raw_page_material_manifest.json';
const RAW_PAGE_MATERIAL_MANIFEST_RELATIVE_PATH = `reports/${RAW_PAGE_MATERIAL_MANIFEST_FILE}`;
const AUTHORIZED_SOURCE_MANIFEST_FILE = 'authorized_source_manifest.json';
const AUTHORIZED_SOURCE_MANIFEST_RELATIVE_PATH = `reports/${AUTHORIZED_SOURCE_MANIFEST_FILE}`;

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
  }
  if (index < queue.length && visited.size >= effectiveMaxPages) {
    warnings.push(`crawl truncated at maxPages=${effectiveMaxPages}; ${queue.length - index} queued URLs were not fetched.`);
  }

  const dedupedPages = arrayUniqueBy([...pages, ...authorizedSourceManifest.pages], (page) => pageIdentity(page))
    .sort((left, right) => left.normalizedUrl.localeCompare(right.normalizedUrl, 'en'));
  const dedupedFailures = arrayUniqueBy(failures, (failure) => failure.normalizedUrl)
    .sort((left, right) => left.normalizedUrl.localeCompare(right.normalizedUrl, 'en'));
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
  const renderedEvidenceRequired = blockedReason === 'siteforge-static-evidence-unavailable'
    && staticDiagnosticSummary.dynamicShell > 0
    && canAttemptPublicRenderedLayer(context, { renderedRequired: true });
  const shouldBlockStatic = Boolean(blockedReason && !renderedEvidenceRequired);
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
    status: shouldBlockStatic ? 'blocked' : 'success',
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
    status: shouldBlockStatic ? 'blocked' : 'success',
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

function browserBridgeRouteCaptured(result = /** @type {any} */ ({})) {
  return ['captured', 'captured_with_warning'].includes(String(result?.status ?? '').trim())
    && result?.captured !== false;
}

function browserBridgeRouteRetryable(result = /** @type {any} */ ({})) {
  const status = String(result?.status ?? '').trim();
  const reasonCode = String(result?.reasonCode ?? '').trim();
  if (status === 'challenge_detected' && reasonCode === 'browser-bridge-definite-challenge') {
    return false;
  }
  if (['timeout', 'challenge_detected', 'thin_capture'].includes(status)) {
    return true;
  }
  if (status !== 'blocked') {
    return false;
  }
  return [
    'browser-bridge-collector-injection-failed',
    'browser-bridge-route-open-failed',
    'execute-script-failed',
    'collector-message-failed',
    'navigation-in-progress',
    'tab-missing',
  ].includes(reasonCode);
}

function routeTemplateComparisonValues(context = /** @type {any} */ ({}), values = /** @type {any[]} */ ([])) {
  const variants = new Set();
  const addVariant = (value) => {
    const text = String(value ?? '').trim();
    if (!text) {
      return;
    }
    variants.add(text);
    if (text !== '/' && text.endsWith('/')) {
      variants.add(text.replace(/\/+$/u, ''));
    } else if (text !== '/') {
      variants.add(`${text}/`);
    }
  };
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text) {
      continue;
    }
    addVariant(text.split(/[?#]/u)[0] || text);
    try {
      const normalizedUrl = normalizeUrl(text, context.site?.rootUrl);
      const parsed = new URL(normalizedUrl);
      addVariant(parsed.pathname || '/');
      addVariant(routePatternForUrl(normalizedUrl));
    } catch {
      // Non-URL route templates are handled through the raw path variants above.
    }
  }
  return [...variants].filter(Boolean);
}

function configuredAuthRouteTemplateSet(context = /** @type {any} */ ({})) {
  const targets = [
    ...(context.crawlContract?.coverageTargets?.authRoutes ?? []),
    ...(context.options?.authRoutes ?? []),
    ...(context.options?.localBuildConfig?.authRoutes ?? []),
  ];
  const configured = new Set();
  for (const target of targets) {
    for (const variant of routeTemplateComparisonValues(context, [target])) {
      if (variant && variant !== '/') {
        configured.add(variant);
      }
    }
  }
  return configured;
}

function matchesConfiguredAuthRoute(context = /** @type {any} */ ({}), configuredRouteTemplates = new Set(), values = /** @type {any[]} */ ([])) {
  if (!configuredRouteTemplates?.size) {
    return false;
  }
  return routeTemplateComparisonValues(context, values).some((variant) => variant !== '/' && configuredRouteTemplates.has(variant));
}

function browserBridgeMissingRouteTemplateSet(context = /** @type {any} */ ({})) {
  const bridge = context.authStateReport?.browserBridge ?? {};
  const routeResults = Array.isArray(bridge.routeResults) ? bridge.routeResults : [];
  const missing = new Set();
  for (const result of routeResults) {
    if (browserBridgeRouteCaptured(result)) {
      continue;
    }
    for (const variant of routeTemplateComparisonValues(context, [
      result?.targetRoute,
      result?.routeTemplate,
      result?.targetUrl,
      result?.url,
      result?.normalizedUrl,
    ])) {
      missing.add(variant);
    }
  }
  return missing;
}

function browserBridgeCapturedRouteTemplateSet(context = /** @type {any} */ ({})) {
  const bridge = context.authStateReport?.browserBridge ?? {};
  const routeResults = Array.isArray(bridge.routeResults) ? bridge.routeResults : [];
  const captured = new Set();
  for (const result of routeResults) {
    if (!browserBridgeRouteCaptured(result)) {
      continue;
    }
    for (const variant of routeTemplateComparisonValues(context, [
      result?.targetRoute,
      result?.routeTemplate,
      result?.targetUrl,
      result?.url,
      result?.normalizedUrl,
    ])) {
      captured.add(variant);
    }
  }
  return captured;
}

function matchesBrowserBridgeMissingRoute(context = /** @type {any} */ ({}), missingRouteTemplates = new Set(), values = /** @type {any[]} */ ([])) {
  if (!missingRouteTemplates?.size) {
    return false;
  }
  return routeTemplateComparisonValues(context, values).some((variant) => missingRouteTemplates.has(variant));
}

function matchesBrowserBridgeMissingNonRootRoute(context = /** @type {any} */ ({}), missingRouteTemplates = new Set(), values = /** @type {any[]} */ ([])) {
  if (!missingRouteTemplates?.size) {
    return false;
  }
  return routeTemplateComparisonValues(context, values).some((variant) => variant !== '/' && missingRouteTemplates.has(variant));
}

function browserBridgePageWasCaptured(context = /** @type {any} */ ({}), page = /** @type {any} */ ({})) {
  if (context.authStateReport?.authMethod !== 'browser') {
    return true;
  }
  const routeResults = Array.isArray(context.authStateReport?.browserBridge?.routeResults)
    ? context.authStateReport.browserBridge.routeResults
    : [];
  if (!routeResults.length) {
    return true;
  }
  const routeId = String(page?.routeId ?? '').trim();
  if (routeId) {
    const routeResult = routeResults.find((result) => String(result?.routeId ?? '').trim() === routeId);
    if (routeResult) {
      return browserBridgeRouteCaptured(routeResult);
    }
  }
  const values = [
    page?.routeTemplate,
    page?.routePattern,
    page?.normalizedUrl,
    page?.url,
  ];
  if (matchesBrowserBridgeMissingRoute(context, browserBridgeMissingRouteTemplateSet(context), values)) {
    return false;
  }
  const capturedRoutes = browserBridgeCapturedRouteTemplateSet(context);
  return capturedRoutes.size === 0 || routeTemplateComparisonValues(context, values).some((variant) => capturedRoutes.has(variant));
}

function routeCapturePlanFromAuthState(context, authStateReport = /** @type {any} */ ({})) {
  const bridge = authStateReport?.browserBridge ?? {};
  const routeResults = Array.isArray(bridge.routeResults) ? bridge.routeResults : [];
  const missingRoutes = routeResults
    .filter((result) => !browserBridgeRouteCaptured(result))
    .map((result) => {
      const retryable = browserBridgeRouteRetryable(result);
      const finalReasonCode = result?.finalReasonCode ?? result?.reasonCode ?? result?.status ?? 'browser-auth-route-not-captured';
      const routeLimitExceeded = finalReasonCode === 'browser-bridge-route-limit-exceeded';
      return {
        routeId: result?.routeId ?? null,
        sourceLayer: result?.sourceLayer === 'authenticated_overlay' ? 'authenticated_overlay' : 'authenticated',
        targetRoute: result?.targetRoute ?? null,
        status: result?.status ?? 'timeout',
        reasonCode: result?.reasonCode ?? result?.status ?? 'browser-auth-route-not-captured',
        initialStatus: result?.initialStatus ?? result?.status ?? 'timeout',
        finalStatus: result?.finalStatus ?? result?.status ?? 'timeout',
        finalReasonCode,
        retryAttemptCount: Math.max(0, Number(result?.retryAttemptCount ?? 0) || 0),
        retryOutcome: result?.retryOutcome ?? 'not_attempted',
        recommendedRetryMode: routeLimitExceeded
          ? 'split_browser_bridge_route_batch'
          : retryable ? 'browser_bridge_missing_route_retry' : 'access_boundary_no_automatic_retry',
        retryable,
        capabilityGenerated: false,
      };
    });
  const unattemptedRoutes = missingRoutes.filter((route) => route.finalReasonCode === 'browser-bridge-route-limit-exceeded');
  if (
    authStateReport?.authMethod !== 'browser'
    || !['browser_verified', 'browser_verified_partial'].includes(String(authStateReport?.authVerificationStatus ?? ''))
    || Number(bridge.capturedRouteCount ?? 0) <= 0
  ) {
    return null;
  }
  const routeCoverageStatus = ['complete', 'partial', 'none'].includes(String(bridge.routeCoverageStatus ?? '').trim())
    ? String(bridge.routeCoverageStatus).trim()
    : missingRoutes.length > 0
      ? 'partial'
      : 'complete';
  return sanitizeReportPublicValue({
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-route-capture-plan',
    siteId: context.site.id,
    buildId: context.buildId,
    status: routeCoverageStatus,
    routeCoverageStatus,
    retryStatus: bridge.retryStatus ?? 'not_attempted',
    retryPasses: Math.max(0, Number(bridge.retryPasses ?? 0) || 0),
    initialCapturedRouteCount: Math.max(0, Number(bridge.initialCapturedRouteCount ?? 0) || 0),
    retryAttemptedRouteCount: Math.max(0, Number(bridge.retryAttemptedRouteCount ?? 0) || 0),
    retryCapturedRouteCount: Math.max(0, Number(bridge.retryCapturedRouteCount ?? 0) || 0),
    finalCapturedRouteCount: Math.max(0, Number(bridge.finalCapturedRouteCount ?? bridge.capturedRouteCount ?? 0) || 0),
    finalMissingRouteCount: Math.max(0, Number(bridge.finalMissingRouteCount ?? missingRoutes.length) || 0),
    routeQueueLimit: Math.max(0, Number(bridge.routeQueueLimit ?? 0) || 0),
    scheduledRouteCount: Math.max(0, Number(bridge.scheduledRouteCount ?? 0) || 0),
    overflowRouteCount: Math.max(0, Number(bridge.overflowRouteCount ?? 0) || 0),
    unattemptedRouteCount: Math.max(0, Number(bridge.unattemptedRouteCount ?? unattemptedRoutes.length) || 0),
    routeQueueTruncated: bridge.routeQueueTruncated === true,
    routeQueueStatus: bridge.routeQueueStatus ?? (bridge.routeQueueTruncated === true ? 'truncated' : 'complete'),
    routeLimitReasonCode: bridge.routeLimitReasonCode ?? null,
    routeCount: Number(bridge.routeCount ?? routeResults.length ?? 0) || 0,
    capturedRouteCount: Number(bridge.capturedRouteCount ?? 0) || 0,
    missingRouteCount: Math.max(0, Number(bridge.missingRouteCount ?? missingRoutes.length) || 0),
    missingRoutes,
    unattemptedRoutes,
    safety: {
      cookiePersisted: false,
      browserProfilePersisted: false,
      storageRead: false,
      rawDomPersisted: false,
      rawHtmlPersisted: false,
      privateBodyPersisted: false,
    },
  });
}

async function authStateCheckStage(context, stageResults = /** @type {any} */ ({})) {
  const needsAuthCheck = ['cookie', 'browser'].includes(context.options.authMode) && (
    !canRunAuthenticatedLayer(context.authStateReport)
    || context.authRuntime?.method !== context.options.authMode
  );
  const robotsPolicy = stageResults.discoverSeeds?.robotsPolicy ?? setupProfileRobotsPolicy(context);
  const authOptions = needsAuthCheck ? { ...context.options } : null;
  const baseReport = needsAuthCheck
    ? await runDefaultBrowserAuthStateCheck({
      inputUrl: context.inputUrl,
      site: context.site,
      options: authOptions,
      robotsPolicy,
    })
    : context.authStateReport ?? createPublicOnlyAuthStateReport({ site: context.site, authMethod: 'none' });
  if (authOptions) {
    const runtimeMaterial = authRuntimeMaterialFrom(baseReport);
    context.authRuntime = runtimeMaterial?.authRuntime ?? null;
    context.authenticatedStructureSummary = runtimeMaterial?.authenticatedStructureSummary ?? null;
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
      ? (partialBrowserRouteCoverage
        ? ['browser-auth-route-coverage-partial']
        : [])
      : [context.options.authMode === 'browser'
        ? 'Default-browser authentication bridge did not verify successfully; authenticated crawl remains disabled for this build.'
        : 'Cookie authentication did not verify successfully; authenticated crawl remains disabled for this build.'],
    summary: authSummaryForReport(nextContract, normalizedReport),
  };
}

function sanitizedStructureText(value, maxLength = 80, fallback = null) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return fallback;
  }
  if (/[<>{}]|=|\b(?:authorization|bearer|cookie|sid|uid|user[_-]?id|account[_-]?id|token|secret|session|password|localStorage|sessionStorage|userDataDir|raw\s+dom|raw\s+html|html|script)\b/iu.test(raw)) {
    return '[REDACTED]';
  }
  const safe = sanitizeEvidenceRef(value);
  if (!safe) {
    return fallback;
  }
  if (/\b(?:authorization|bearer|cookie|sid|uid|token|secret|session|password|localStorage|sessionStorage|userDataDir)\b/iu.test(String(safe))) {
    return '[REDACTED]';
  }
  return String(safe).slice(0, maxLength);
}

function safeStructureHash(prefix, providedValue, fallbackValue) {
  const provided = String(providedValue ?? '').trim();
  if (/^(?:[a-z][a-z0-9_-]*:)?[a-f0-9]{12,128}$/iu.test(provided)) {
    return provided.slice(0, 160);
  }
  return stableNodeId(prefix, fallbackValue);
}

function sanitizedControl(control = /** @type {any} */ ({}), index = 0, {
  fallbackPrefix = 'auth',
} = /** @type {any} */ ({})) {
  return {
    kind: String(control.kind ?? control.controlType ?? 'button').slice(0, 40),
    type: control.type ? String(control.type).slice(0, 40) : null,
    label: sanitizedStructureText(control.label, 80),
    name: sanitizedStructureText(control.name, 80),
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
} = /** @type {any} */ ({})) {
  const method = String(form.method ?? 'GET').toUpperCase();
  return {
    label: sanitizedStructureText(form.label, 80, `${fallbackPrefix}-form-${index}`),
    selector: sanitizedStructureText(form.selector, 120, `${fallbackPrefix}-form-${index}`),
    method,
    action: sanitizedStructureText(form.action, 200),
    textSummary: 'sanitized form structure only',
    inputs: Array.isArray(form.inputs)
      ? form.inputs.slice(0, 20).map((input, inputIndex) => ({
        name: sanitizedStructureText(input?.name, 80),
        type: input?.type ? String(input.type).slice(0, 40) : null,
        selector: sanitizedStructureText(input?.selector, 120, `${fallbackPrefix}-input-${inputIndex}`),
        label: sanitizedStructureText(input?.label, 80),
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
    .replace(/\/[a-z0-9]{12,}(?=\/|$)/giu, '/:slug')
    .slice(0, 160);
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
  const normalizedUrl = normalizeUrl(page.normalizedUrl ?? page.url ?? fallbackUrl, context.site.rootUrl);
  if (!isInternalUrl(normalizedUrl, context.site.allowedDomains)) {
    return null;
  }
  const routeTemplate = page.routeTemplate ?? routePatternForUrl(normalizedUrl);
  const visibleItemCount = Math.max(0, Number(page.visibleItemCount ?? 0) || 0);
  const listPresent = page.listPresent === true || page.listPresence === true;
  const emptyStatePresent = page.emptyStatePresent === true || page.empty_state_present === true;
  const unreadMarkerPresent = page.unreadMarkerPresent === true || page.unread_marker_present === true;
  const pageType = page.pageType ?? page.page_type ?? 'authenticated_summary';
  const internalLinks = Array.isArray(page.links)
    ? page.links
      .map((link, index) => {
        try {
          const normalizedHref = sanitizeRenderedInternalUrl(context, link?.normalizedHref ?? link?.href, normalizedUrl);
          if (!normalizedHref) {
            return null;
          }
          return {
            href: normalizedHref,
            normalizedHref,
            label: sanitizedStructureText(link?.label, 80, `auth-link-${index + 1}`),
            selector: sanitizedStructureText(link?.selector, 120, `auth-link-${index + 1}`),
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
  const structureHash = String(page.structureHash ?? page.structure_hash ?? stableNodeId('auth-structure', `${routeTemplate}:${pageType}:${visibleItemCount}:${listPresent}:${emptyStatePresent}:${unreadMarkerPresent}`));
  const forms = Array.isArray(page.forms) ? page.forms.slice(0, 12).map((form, index) => sanitizedForm(form, index)) : [];
  const controls = Array.isArray(page.controls) ? page.controls.slice(0, 40).map((control, index) => sanitizedControl(control, index)) : [];
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
    structureItems: [
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
  const canRunAuth = ['authenticated_cookie', 'authenticated_browser'].includes(crawlContract?.crawlMode) && canRunAuthenticatedLayer(authStateReport);
  const warnings = /** @type {string[]} */ ([]);
  if (!canRunAuth) {
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
  if (!provided) {
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
  const authenticatedPages = arrayUniqueBy((provided.authenticatedPages ?? provided.pages ?? [])
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
    }), (page) => pageIdentity(page))
    .sort((left, right) => pageIdentity(left).localeCompare(pageIdentity(right), 'en'));
  const authenticatedOverlayPages = arrayUniqueBy((provided.authenticatedOverlayPages ?? provided.overlayPages ?? [])
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
    }), (page) => pageIdentity(page))
    .sort((left, right) => pageIdentity(left).localeCompare(pageIdentity(right), 'en'));
  warnings.push(...(Array.isArray(provided.warnings) ? provided.warnings.map(String) : []));
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
} = /** @type {any} */ ({})) {
  const normalizedUrl = sanitizeRenderedInternalUrl(context, page.normalizedUrl ?? page.finalUrl ?? page.url ?? fallbackUrl, context.site.rootUrl);
  if (!normalizedUrl) {
    return null;
  }
  const routeTemplate = page.routeTemplate ?? routePatternForUrl(normalizedUrl);
  if (matchesBrowserBridgeMissingNonRootRoute(context, browserBridgeMissingRouteTemplateSet(context), [routeTemplate, normalizedUrl])) {
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
          if (matchesBrowserBridgeMissingNonRootRoute(context, browserBridgeMissingRouteTemplateSet(context), [link?.routeTemplate, link?.routePattern, normalizedHref])) {
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

function renderedTargetsFromStageResults(context, stageResults) {
  const staticPages = stageResults.crawlStatic?.pages ?? [];
  const dynamicPages = staticPages.filter((page) => !hasUsableStaticPageEvidence(page));
  const seedUrls = (stageResults.discoverSeeds?.publicSeeds ?? stageResults.discoverSeeds?.seeds ?? [])
    .map((seed) => seed.normalizedUrl ?? seed.url)
    .filter(Boolean);
  const targets = dynamicPages.length
    ? dynamicPages.map((page) => page.normalizedUrl)
    : seedUrls.slice(0, Math.max(1, Math.min(Number(context.policy.maxPages ?? 5) || 5, 5)));
  return uniqueSortedStrings(targets)
    .filter((urlValue) => isInternalUrl(urlValue, context.site.allowedDomains));
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
      userAgent: 'SiteForgeBuildPublicRenderedCrawler/1.0',
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
  if (!renderRequested) {
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
    provided = {
      publicRenderedPages: await collectPublicRenderedStructurePagesWithBrowser(context, targets, warnings),
    };
  }
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
  }
  const payload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    interactions,
    summary: { interactions: interactions.length },
  };
  const interactionsPath = await writeArtifactJson(context, 'interactions.json', payload);
  return {
    interactions,
    artifactPaths: { interactions: interactionsPath },
    summary: payload.summary,
  };
}

const API_ADAPTER_SAFE_METHODS = new Set(['GET', 'HEAD']);
const API_REPLAY_SENSITIVE_QUERY_PATTERN = /^(?:auth|authorization|sid|sessdata|csrf|xsrf|secret|password|pass|signature|sign|access[_-]?token|refresh[_-]?token|session(?:[_-]?id)?|api[_-]?key|xsec[_-]?token)$/iu;
const API_REPLAY_WRITE_PATH_PATTERN = /(?:^|[/_.-])(?:create|delete|destroy|remove|update|edit|mutate|mutation|post|publish|submit|send|upload|follow|unfollow|like|repost|checkout|pay|order|login|logout|signin|signout)(?:$|[/_.-])/iu;
const API_REPLAY_CHALLENGE_PATTERN = /(?:captcha|challenge|verify|verification|required login|login required|sign in|signin|log in|forbidden|access denied|permission denied|risk|anti[- ]?bot|blocked)/iu;

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

function apiCandidateMethod(candidate = /** @type {any} */ ({}), rawTrace = null) {
  return String(candidate?.endpoint?.method ?? candidate?.method ?? rawTrace?.request?.method ?? 'GET').trim().toUpperCase();
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

function hasSensitiveQueryMaterial(urlValue) {
  try {
    const parsed = new URL(String(urlValue ?? ''));
    for (const key of parsed.searchParams.keys()) {
      if (API_REPLAY_SENSITIVE_QUERY_PATTERN.test(key)) {
        return true;
      }
    }
    return /(?:%5Bredacted%5D|\[redacted\]|redacted)/iu.test(parsed.search);
  } catch {
    return false;
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
  return hasSensitiveQueryMaterial(candidateUrl)
    || hasSensitiveQueryMaterial(rawUrl)
    || /request-protection|auth-session|risk-or-access-control|csrf|xsrf|token|secret|signature|session/iu.test(riskText);
}

function hasSubstantiveApiRequestBody(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    return Boolean(text) && !['[REDACTED]', 'null', 'undefined'].includes(text);
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  return true;
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
  const bodyText = [
    candidate?.target?.endpointKind,
    candidate?.target?.roleHint,
    rawTrace?.request?.body,
  ].filter(Boolean).join(' ');
  try {
    const parsed = new URL(endpointUrl);
    return API_REPLAY_WRITE_PATH_PATTERN.test(`${parsed.pathname} ${parsed.search} ${bodyText}`);
  } catch {
    return API_REPLAY_WRITE_PATH_PATTERN.test(`${endpointUrl} ${bodyText}`);
  }
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

function apiReplayAuthBoundary(context) {
  const report = context.authStateReport ?? {};
  if (report.authMethod === 'browser' && canRunAuthenticatedLayer(report)) {
    return 'browser_bridge';
  }
  if (report.authMethod === 'cookie' && canRunAuthenticatedLayer(report)) {
    return 'cookie_replay_only';
  }
  return 'none';
}

function apiReplayEligibility(context, candidate = /** @type {any} */ ({}), rawTrace = null, robotsPolicy = null) {
  const method = apiCandidateMethod(candidate, rawTrace);
  const parsed = parseCandidateUrl(context, candidate, rawTrace);
  const replayEndpoint = parsed ? parsed.toString() : null;
  const endpoint = replayEndpoint ? sanitizeEvidenceRef(replayEndpoint) : (apiCandidateEndpointUrl(candidate) || '');
  if (!API_ADAPTER_SAFE_METHODS.has(method)) {
    return { eligible: false, reasonCode: 'method_not_read_only', method, endpoint, authBoundary: 'none' };
  }
  if (apiCandidateHasRequestBody(candidate, rawTrace)) {
    return { eligible: false, reasonCode: 'request_body_present', method, endpoint, authBoundary: 'none' };
  }
  if (!parsed || !isInternalUrl(parsed.toString(), context.site.allowedDomains)) {
    return { eligible: false, reasonCode: 'cross_site_endpoint', method, endpoint, authBoundary: 'none' };
  }
  if (!isUrlAllowedByRobots(parsed.toString(), robotsPolicy ?? setupProfileRobotsPolicy(context))) {
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
  const authBoundary = apiReplayAuthBoundary(context);
  if (authBoundary === 'none') {
    return { eligible: false, reasonCode: 'authenticated_browser_bridge_unavailable', method, endpoint, authBoundary };
  }
  if (authBoundary !== 'browser_bridge') {
    return { eligible: false, reasonCode: 'cookie_replay_not_registered_for_runtime', method, endpoint, authBoundary };
  }
  return { eligible: true, reasonCode: null, method, endpoint, replayEndpoint, authBoundary };
}

function summarizeApiReplayResult(rawResult = /** @type {any} */ ({})) {
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
  const challengeLike = API_REPLAY_CHALLENGE_PATTERN.test(probeText)
    || [401, 403, 407, 419, 429].includes(Number(httpStatus));
  const httpOk = httpStatus === null || (httpStatus >= 200 && httpStatus < 300) || httpStatus === 304;
  const verified = !challengeLike && httpOk && ['verified', 'success', 'passed'].includes(statusText || 'verified');
  return {
    status: verified ? 'verified' : (statusText === 'skipped' ? 'skipped' : 'failed'),
    reasonCode: challengeLike ? 'challenge_or_login_wall_response' : (rawResult?.reasonCode ?? (httpOk ? null : 'api_replay_http_failed')),
    httpStatus,
    contentType: contentType || null,
    responseKind: String(rawResult?.responseKind ?? rawResult?.kind ?? '').trim() || null,
  };
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
  let status = 'skipped';
  let reasonCode = 'site_adapter_validation_unavailable';
  try {
    adapter = await resolveApiAdapterForCandidate(context, candidate);
    if (typeof adapter?.validateApiCandidate !== 'function') {
      reasonCode = 'site_adapter_validation_unavailable';
    } else {
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
  if (decisionRecord.status !== 'accepted') {
    reasonCode = decisionRecord.reasonCode ?? 'adapter_rejected';
    replaySummary = {
      ...replaySummary,
      reasonCode,
    };
  } else if (eligibility.eligible) {
    const replayEndpoint = eligibility.replayEndpoint ?? eligibility.endpoint;
    if (typeof context.options.apiAdapterReplayProvider === 'function') {
      try {
        const providerResult = await context.options.apiAdapterReplayProvider({
          context,
          site: context.site,
          candidate,
          decision: decisionRecord.decision,
          rawTrace,
          endpoint: replayEndpoint,
          redactedEndpoint: eligibility.endpoint,
          method: eligibility.method,
          authBoundary: eligibility.authBoundary,
          fetchOptions: {
            credentials: 'include',
            method: eligibility.method,
            body: null,
            persistCookies: false,
            persistStorage: false,
            persistResponseBody: false,
          },
        });
        replaySummary = summarizeApiReplayResult(providerResult);
        status = replaySummary.status;
        reasonCode = replaySummary.reasonCode;
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
    } else {
      replaySummary = summarizeApiReplayResult(await runBrowserBridgeApiReplay({
        inputUrl: context.site.rootUrl,
        site: context.site,
        endpoint: replayEndpoint,
        method: eligibility.method,
        options: context.options,
        robotsPolicy,
      }));
      status = replaySummary.status;
      reasonCode = replaySummary.reasonCode;
    }
  }
  const activated = decisionRecord.status === 'accepted'
    && eligibility.eligible === true
    && replaySummary.status === 'verified'
    && eligibility.authBoundary === 'browser_bridge';
  const runtimeBindingId = activated
    ? stableNodeId('api-adapter-runtime-binding', `${context.site.id}:${candidate?.id ?? index}:${eligibility.replayEndpoint ?? eligibility.endpoint}`)
    : null;
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
    endpoint: sanitizeEvidenceRef(eligibility.endpoint),
    authBoundary: eligibility.authBoundary,
    replayPolicy: {
      credentials: eligibility.authBoundary === 'browser_bridge' ? 'include' : 'none',
      requestBodyAllowed: false,
      savedCookieMaterial: false,
      savedStorageMaterial: false,
      rawResponseBodyPersisted: false,
      responseMaterial: SANITIZED_SUMMARY_ONLY,
      runtimeRegistration: activated ? 'browser_bridge_required' : 'not_registered',
      genericHttpRuntimeAllowed: false,
    },
    response: {
      httpStatus: replaySummary.httpStatus,
      contentType: replaySummary.contentType,
      responseKind: replaySummary.responseKind,
      challengeOrLoginWallBlocked: reasonCode === 'challenge_or_login_wall_response',
    },
  };
  const write = await writeRedactedArtifactWithAudit(context, replayRelativePath, auditRelativePath, payload);
  return {
    index,
    candidate,
    status: payload.status,
    reasonCode: payload.reasonCode,
    activated,
    runtimeBindingId,
    runtimeEndpoint: activated ? eligibility.replayEndpoint : null,
    method: eligibility.method,
    endpoint: payload.endpoint,
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
      authBoundary: 'browser_bridge',
      runtimeMode: BRIDGE_RUNTIME_MODE,
      responseMaterial: SANITIZED_SUMMARY_ONLY,
      requestPolicy: {
        credentials: 'include',
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

async function captureNetworkTracesStage(context) {
  const networkRequested = context.policy.captureNetwork === true || context.options.network === true;
  const internalRawRequested = context.options.internalRawNetwork === true;
  const apiExtractionDisabledReason = context.options.apiExtractionDisabledReason ?? null;
  const sourceDiagnostics = context.setupProfile?.sourceDiagnostics ?? [];
  const internalCapture = context.internalRawNetworkCapture ?? {};
  const rawTraces = Array.isArray(internalCapture.rawTraces) ? internalCapture.rawTraces : [];
  const observedRequests = Array.isArray(internalCapture.observedRequests) ? internalCapture.observedRequests : [];
  const observedResponseSummaries = Array.isArray(internalCapture.observedResponseSummaries)
    ? internalCapture.observedResponseSummaries
    : [];
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

  if (internalRawRequested) {
    const rawPayload = {
      schemaVersion: BUILD_SCHEMA_VERSION,
      artifactFamily: 'siteforge-internal-raw-network-traces',
      buildId: context.buildId,
      siteId: context.site.id,
      internalOnly: true,
      redactionApplied: false,
      containsSensitiveMaterial: true,
      captureScope: 'api-json-text',
      limits: {
        maxTraces: 100,
        maxResponseBodyBytes: 256 * 1024,
      },
      captureStatus: internalCapture.status ?? 'unavailable',
      traces: rawTraces,
      summary: {
        traces: rawTraceCount,
        responseBodies: rawResponseBodyCount,
        truncatedBodies: rawTruncatedBodyCount,
        skippedBodies: rawSkippedBodyCount,
      },
    };
    rawNetworkPath = await writeArtifactJson(context, path.join('discovery', 'network_traces.raw.json'), rawPayload);
    warnings.push('Raw network capture was enabled; raw trace artifacts may contain sensitive material.');

    if (observedRequests.length) {
      try {
        apiCandidateArtifacts = await writeApiCandidateArtifactsFromObservedRequests(observedRequests, {
          outputDir: path.join(context.artifactDir, 'discovery', 'api-candidates'),
          redactionAuditDir: path.join(context.artifactDir, 'discovery', 'api-candidate-redaction-audits'),
        });
        apiCandidateSummary = {
          status: 'written',
          count: apiCandidateArtifacts.length,
          artifacts: apiCandidateArtifacts.map((artifact) => relativeReportPath(context.cwd, artifact.artifactPath)),
          redactionAuditArtifacts: apiCandidateArtifacts.map((artifact) => relativeReportPath(context.cwd, artifact.redactionAuditPath)),
        };
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
    } else {
      apiCandidateSummary = {
        status: 'empty',
        count: 0,
        artifacts: [],
        redactionAuditArtifacts: [],
      };
    }
  }

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
    observedResponseSummaryCount: observedResponseSummaries.length,
    apiCandidateArtifacts: apiCandidateSummary.artifacts,
    apiCandidateCount: apiCandidateSummary.count,
    apiCandidateStatus: apiCandidateSummary.status,
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
    status: internalRawRequested ? 'success' : 'skipped',
    reason: internalRawRequested
      ? 'Raw network capture was enabled; public summary excludes raw headers, bodies, cookies, and tokens.'
      : apiExtractionDisabledReason
        ? `API extraction skipped because ${apiExtractionDisabledReason}.`
        : networkRequested
          ? 'Network summary requested; raw network traces were not captured or persisted.'
          : 'Network summary was not requested; raw network tracing is not part of the public build path.',
    traces: [],
    observedRequests: [],
    observedResponseSummaries: [],
    apiCandidateArtifacts: apiCandidateSummary.artifacts,
    apiCandidateRedactionAuditArtifacts: apiCandidateSummary.redactionAuditArtifacts,
    sanitizedSummary,
  };
  const networkPath = await writeArtifactJson(context, 'network_traces.json', payload);
  if (internalRawRequested) {
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

  for (const [index, candidateResult] of candidateResults.entries()) {
    try {
      const decision = await validateApiAdapterCandidate(context, candidateResult, index);
      decisions.push(decision);
      const rawTrace = rawTraceForApiCandidate(decision.candidate, rawTraces);
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
  }

  const skippedRecords = [
    ...decisions.filter((decision) => decision.status !== 'accepted'),
    ...replayVerifications.filter((verification) => verification.status !== 'verified'),
  ];
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
  const missingBrowserBridgeRouteTemplates = browserBridgeMissingRouteTemplateSet(context);
  const isMissingBrowserBridgeRoute = (sourceLayer, ...values) => (
    isAuthenticatedSourceLayer(sourceLayer)
      ? matchesBrowserBridgeMissingRoute(context, missingBrowserBridgeRouteTemplates, values)
      : isPublicReadSourceLayer(sourceLayer)
        ? matchesBrowserBridgeMissingNonRootRoute(context, missingBrowserBridgeRouteTemplates, values)
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

  for (const page of pages) {
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

  for (const route of knownPolicyPublicRouteTemplates(context).filter((candidate) => candidate.seedable !== true)) {
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

  nodes.push(...routeNodes.values());
  for (const node of nodes) {
    node.parentNodeIds = uniqueSortedStrings(node.parentNodeIds);
    node.childNodeIds = uniqueSortedStrings(node.childNodeIds);
    assertSiteNode(node);
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
  for (const node of graph.nodes) {
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
  }
  graph.summary = {
    ...graph.summary,
    classifications: Object.fromEntries(
      Object.entries(graph.nodes.reduce((counts, node) => {
        counts[node.classification ?? node.type] = (counts[node.classification ?? node.type] ?? 0) + 1;
        return counts;
      }, {})).sort(([left], [right]) => left.localeCompare(right, 'en')),
    ),
  };
  context.skillId = resolveSkillId(context, graph);
  context.skillDir = resolveSkillDir(context);
  context.draftSkillDir = context.skillDir;
  context.activeSkillDir = resolveActiveSkillDir(context);
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
  const pageNodeByKey = new Map(graph.nodes.filter((node) => node.type === 'page').map((node) => [
    pageIdentity(node),
    node,
  ]));
  const affordances = /** @type {any[]} */ ([]);
  const commonAffordanceMetadata = (page, safety = 'read_only') => {
    const highRisk = ['state_changing', 'destructive', 'payment'].includes(safety);
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
      activationDecision: highRisk
        ? (safety === 'state_changing' ? 'confirmation_required' : 'disabled')
        : 'candidate_evidence',
    };
  };

  for (const page of pages) {
    const pageNode = pageNodeByKey.get(pageIdentity(page));
    if (!pageNode) {
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
} = /** @type {any} */ ({})) {
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    id: executionPlanId(capabilityId),
    capabilityId,
    mode,
    dryRunOnly,
    requiresConfirmation,
    autoExecute,
    steps,
  };
}

function disabledActionForAffordance(affordance) {
  const text = [
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
  if (affordance?.kind === 'upload') {
    forced.push('upload');
  }
  if (affordance?.safety === 'payment') {
    forced.push(/checkout/iu.test(text) ? 'checkout' : 'pay');
  }
  if (affordance?.safety === 'destructive') {
    forced.push('delete');
  }
  if (affordance?.kind === 'form' && affordance?.safety === 'state_changing') {
    forced.push('submit');
  }
  return uniqueSortedStrings(forced);
}

function capabilityActionForBlockedAction(action) {
  if (action === 'upload') return 'upload';
  if (action === 'pay' || action === 'checkout' || action === 'change_payment') return 'purchase';
  if (action === 'submit' || action === 'send' || action === 'send_dm') return 'submit';
  return 'manage';
}

function blockedActionDisplayLabel(action) {
  const labels = {
    checkout: 'checkout',
    change_2fa: 'change 2FA',
    change_email: 'change email',
    change_password: 'change password',
    change_payment: 'change payment',
    delete: 'delete',
    pay: 'pay',
    send: 'send',
    send_dm: 'send direct message',
    submit: 'submit form',
    upload: 'upload',
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
      capabilities.push(makeCapability(context, {
        name,
        description: 'Risk policy keeps this high-risk action visible as disabled and non-executable.',
        action: capabilityActionForBlockedAction(blockedAction),
        object: 'high-risk action',
        userValue: `Disabled high-risk action: ${blockedLabel}`,
        entryNodeIds: affordance?.nodeId ? [affordance.nodeId] : [],
        requiredNodeIds: affordance?.nodeId ? [affordance.nodeId] : [],
        inputs: affordance?.inputs ?? [],
        outputs: [{ name: 'blocked_action', type: 'safety_boundary' }],
        safetyLevel: blockedAction === 'pay' || blockedAction === 'checkout' || blockedAction === 'change_payment'
          ? 'payment'
          : blockedAction.startsWith('change_') || blockedAction === 'delete'
            ? 'destructive'
            : 'state_changing',
        evidence: affordance?.evidence ?? [],
        confidence: Math.min(0.7, Number(affordance?.confidence ?? 0.5) || 0.5),
        status: 'disabled',
        informational: true,
        blockedAction,
        activationBlockedReason: 'forced-action-disabled',
        intents: [
          `why ${blockedLabel} is disabled`,
          `${blockedLabel} safety boundary`,
          `keep ${blockedLabel} disabled`,
        ],
      }));
    }
  }
}

function knownPolicyPageTypes(context) {
  return new Set(context.setupProfile?.knownSitePolicy?.pageTypes ?? []);
}

function knownPolicySupportedIntents(context) {
  return new Set(context.setupProfile?.knownSitePolicy?.supportedIntents ?? []);
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

function normalizeSetupCapabilityId(value) {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/^capability:[^:]+:/u, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
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
    entryNodeIds: status === 'active' ? nodes.slice(0, 20).map((node) => node.id) : [],
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
    routeTemplate: routeState?.routeTemplate ?? null,
    routePath: routeState?.routePath ?? null,
    routeState,
    routeStateId: routeState?.stateId ?? null,
    tabState: routeState?.tabState ?? null,
    pageKind: routeState?.pageKind ?? null,
    intents,
    ...(activationBlockedReason ? { activationBlockedReason } : {}),
  });
  if (status === 'active' && !informational) {
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'read_only',
      steps: canUseRouteOnlyEvidence ? catalogRouteOnlySteps(nodes) : catalogCoverageSteps(nodes),
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
  return ['link_route_template', 'link_semantic_route_template'].includes(node.evidenceStatus);
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

function addAuthenticatedReadCoverageCapabilities(context, capabilities, graph) {
  if (!canRunAuthenticatedLayer(context.authStateReport)) {
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
      enabled_status: 'limited_enabled',
      default_policy: 'limited_enabled',
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
      mode: 'limited_read',
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
      enabled_status: 'limited_enabled',
      default_policy: 'limited_enabled',
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
      mode: 'limited_read',
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
  const label = String(node.elementLabel ?? node.linkLabel ?? node.title ?? '').trim();
  return label.length >= 2 && !/^(?:link|control|element)-\d+$/iu.test(label);
}

function categoryInstanceForNode(node = /** @type {any} */ ({})) {
  const role = String(node.elementRole ?? node.linkSemanticKind ?? '').toLowerCase();
  if (!['search', 'category', 'tag', 'ranking', 'work', 'article', 'media', 'detail', 'profile', 'following_list', 'followed_channel'].includes(role)) {
    return null;
  }
  const label = sanitizedStructureText(node.elementLabel ?? node.linkLabel ?? node.title, 120, role);
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
  const label = String(node.elementLabel ?? node.title ?? role).trim();
  const labelSlug = slugifyAscii(label, '');
  const routeSlug = slugifyAscii(node.routeTemplate ?? node.routePattern ?? node.normalizedUrl ?? '', '');
  const stableSuffix = node.id?.slice(-8) || `element-${index + 1}`;
  const suffix = labelSlug || (routeSlug ? `${routeSlug}-${stableSuffix}` : stableSuffix);
  return role === 'search'
    ? `search with page element ${suffix}`
    : `open ${role} element ${suffix}`;
}

function elementCapabilityIntentSeeds(node = /** @type {any} */ ({})) {
  const role = String(node.elementRole ?? node.linkSemanticKind ?? 'navigation').toLowerCase();
  const label = String(node.elementLabel ?? node.title ?? '').trim()
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
    const label = String(node.elementLabel ?? node.title ?? name).trim();
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
      enabled_status: authRequired ? 'limited_enabled' : 'enabled',
      default_policy: authRequired ? 'limited_enabled' : 'read_only',
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
      intents: elementCapabilityIntentSeeds(node),
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
  const suffix = slugifyAscii(`${node.linkLabel ?? node.title ?? ''} ${route}`, `route-${index + 1}`);
  return `open public route ${suffix}`;
}

function routeInstanceIntents(node = /** @type {any} */ ({})) {
  const label = String(node.linkLabel ?? node.title ?? node.routeTemplate ?? node.routePattern ?? '\u516c\u5f00\u5165\u53e3').trim();
  return uniqueSortedStrings([
    `\u6253\u5f00${label}`,
    `\u67e5\u770b${label}`,
    `\u6d4f\u89c8${label}`,
    `open ${label}`,
  ]);
}

function addPublicRouteTemplateInstanceCapabilities(context, capabilities, graph, robotsPolicy = null) {
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
      && hasPublicRouteNavigationCapabilityEvidence(context, node, robotsPolicy)
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
    const routeLabel = String(node.linkLabel ?? node.title ?? node.routeTemplate ?? node.routePattern ?? '公开入口').trim();
    const capability = makeCapability(context, {
      name,
      description: `Open public route "${routeLabel}" using route-template evidence only.`,
      action: 'view',
      object: routeLabel,
      userValue: `打开公开入口：${routeLabel}`,
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

function hasPublicRouteNavigationCapabilityEvidence(context = /** @type {any} */ ({}), node = /** @type {any} */ ({}), robotsPolicy = null) {
  const evidenceStatus = String(node.evidenceStatus ?? '');
  const publicEvidenceStatus = String(node.publicEvidenceStatus ?? '');
  if (publicEvidenceStatus === 'public_rendered_route_seed_only') {
    return false;
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
  if (/book|novel|fiction|chapter|works?|serialized/u.test(text)) return 'books and works';
  if (/article|story|news|channel/u.test(text)) return 'articles and news';
  if (/video|media|watch/u.test(text)) return 'media items';
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

function addGenericCatalogCoverageCapabilities(context, capabilities, graph, searchForm) {
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

  if (knownPolicyCapabilityFamilies(context).has('download-content')) {
    addCatalogCoverageCapability(context, capabilities, {
      name: 'download catalog content',
      description: 'Keep discovered download-capable content visible, but disabled until a safety-reviewed site adapter exists.',
      action: 'download',
      object: 'catalog content',
      userValue: 'Download content is disabled until a reviewed site adapter exists.',
      nodes: details.length ? details : publicMetadataNodes,
      outputs: [{ name: 'download_task', type: 'disabled_safety_boundary' }],
      intents: ['download catalog content', 'download video', 'save catalog item', 'download work'],
      confidence: 0.5,
      status: 'disabled',
      riskLevel: 'download_high',
      activationBlockedReason: knownPolicyDownloadReasonCode(context),
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
  });
  addCatalogCoverageCapability(context, capabilities, {
    name: 'read public book metadata',
    description: 'Read public book-list and detail metadata structure without storing page body or chapter text.',
    object: 'public book metadata',
    userValue: '\u8bfb\u53d6\u516c\u5f00\u56fe\u4e66\u5143\u6570\u636e\u548c\u5217\u8868\u6458\u8981\u3002',
    nodes: metadataNodes,
    outputs: [{ name: 'book_metadata', type: 'sanitized_summary' }],
    intents: ['\u8bfb\u53d6\u516c\u5f00\u56fe\u4e66\u5143\u6570\u636e', '\u603b\u7ed3\u4e66\u7c4d\u5217\u8868\u6458\u8981', '\u67e5\u770b\u516c\u5f00\u5c0f\u8bf4\u4fe1\u606f', 'read public book metadata', 'summarize book list metadata', 'view public novel metadata'],
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
}

function addUserAuthorizedKnownSiteCapabilities(context, capabilities, homepage) {
  if (!homepage || !userAuthorizedEvidencePages(context).length || !context.setupProfile?.knownSitePolicy) {
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
  const canExposeSeededCapability = (...ids) => ids
    .map(normalizeSetupCapabilityId)
    .some((id) => id && (supported.has(id) || browserSeedCapabilities.has(id)));
  const baseEvidence = [
    ...(homepage.evidence ?? []),
    buildEvidence({
      type: 'text',
      source: homepage.normalizedUrl,
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
  }) => {
    const proof = findCapabilityProof(context, setupCapabilityId, intentAction);
    const capabilityVerified = Boolean(proof);
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
      entryNodeIds: [homepage.id],
      inputs,
      outputs,
      safetyLevel,
      evidence: baseEvidence,
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
          url: homepage.normalizedUrl,
          nodeId: homepage.id,
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
  }
  if (canExposeSeededCapability('list-notifications', 'notifications')) {
    add({
      name: 'list notifications',
      description: 'List notifications through a bounded known-site read-only action after explicit capability evidence.',
      object: 'notifications',
      userValue: 'Read notification summaries without replying, following, liking, or mutating account state.',
      intentAction: 'notifications',
      setupCapabilityId: 'list-notifications',
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

function capabilityRequiresLogin(context, capability = /** @type {any} */ ({}), nodesById = new Map()) {
  if (capability.authRequired === true) {
    return true;
  }
  const nodes = [
    ...(capability.entryNodeIds ?? []),
    ...(capability.requiredNodeIds ?? []),
  ].map((id) => nodesById.get(id)).filter(Boolean);
  if (nodes.some((node) => node.authRequired === true || isAuthenticatedSourceLayer(nodeSourceLayer(node)))) {
    return true;
  }
  const text = [
    capability.name,
    capability.object,
    capability.description,
    capability.category,
    capability.setupCapabilityId,
    capability.intentAction,
  ].join(' ').toLowerCase();
  if (/notification|bookmark|list-lists|\buser lists?\b|\blist lists\b|lists summary|direct message|\bdm\b|following timeline|followed updates|followed users|recommended timeline|account followers/u.test(text)) {
    return true;
  }
  const requiredLoginIds = new Set(context.crawlContract?.coverageTargets?.requiresLoginCapabilities ?? []);
  return requiredLoginIds.has(canonicalCapabilitySemanticToken(capability.setupCapabilityId))
    || requiredLoginIds.has(canonicalCapabilitySemanticToken(capability.name));
}

function sourceLayerForCapability(capability = /** @type {any} */ ({}), nodesById = new Map()) {
  const nodes = [
    ...(capability.entryNodeIds ?? []),
    ...(capability.requiredNodeIds ?? []),
  ].map((id) => nodesById.get(id)).filter(Boolean);
  if (nodes.some((node) => nodeSourceLayer(node) === 'authenticated_overlay')) {
    return 'authenticated_overlay';
  }
  if (nodes.some((node) => nodeSourceLayer(node) === 'authenticated')) {
    return 'authenticated';
  }
  if (nodes.some((node) => nodeSourceLayer(node) === 'authorized_source')) {
    return 'authorized_source';
  }
  if (capability.authRequired === true) {
    return 'authenticated';
  }
  if (nodes.some((node) => nodeSourceLayer(node) === 'public_rendered')) {
    return 'public_rendered';
  }
  return 'public';
}

function providerIdForCapability(capability = /** @type {any} */ ({}), nodesById = new Map()) {
  const nodes = [
    ...(capability.entryNodeIds ?? []),
    ...(capability.requiredNodeIds ?? []),
  ].map((id) => nodesById.get(id)).filter(Boolean);
  const providerIds = uniqueSortedStrings(nodes.map((node) => node.providerId).filter(Boolean));
  if (providerIds.includes('browser_bridge')) return 'browser_bridge';
  if (providerIds.includes('cookie_http')) return 'cookie_http';
  if (providerIds.includes('authorized_summary')) return 'authorized_summary';
  if (providerIds.includes('public_rendered')) return 'public_rendered';
  if (providerIds.includes('public_http')) return 'public_http';
  const sourceLayer = sourceLayerForCapability(capability, nodesById);
  if (sourceLayer === 'authenticated' || sourceLayer === 'authenticated_overlay') {
    return 'browser_bridge';
  }
  if (sourceLayer === 'authorized_source') {
    return 'authorized_summary';
  }
  if (sourceLayer === 'public_rendered') {
    return 'public_rendered';
  }
  return 'public_http';
}

function observedCapabilityEvidenceLevel(capability = /** @type {any} */ ({}), nodesById = new Map(), authStateReport = null) {
  const nodes = [
    ...(capability.entryNodeIds ?? []),
    ...(capability.requiredNodeIds ?? []),
  ].map((id) => nodesById.get(id)).filter(Boolean);
  const levels = nodes.map((node) => {
    if (node.evidenceLevel) {
      return node.evidenceLevel;
    }
    if (nodeSourceLayer(node) === 'public_rendered') {
      return 'public_rendered_verified';
    }
    if (nodeSourceLayer(node) === 'authorized_source') {
      return 'authorized_source_verified';
    }
    return node.authRequired ? 'login_route_verified' : 'public_verified';
  });
  if (
    canRunAuthenticatedLayer(authStateReport)
    && nodes.some((node) => node.authRequired === true || isAuthenticatedSourceLayer(nodeSourceLayer(node)))
    && nodes.some((node) => node.listPresent === true || Number(node.visibleItemCount ?? 0) > 0 || node.emptyStatePresent === true)
  ) {
    levels.push('capability_verified');
  }
  if (capability.capabilityVerified === true || (authStateReport?.capabilityProofs ?? []).some((proof) => {
    const capabilityId = normalizeSetupCapabilityId(proof.capabilityId);
    return capabilityId && [
      capability.setupCapabilityId,
      capability.name,
      capability.id,
    ].map(normalizeSetupCapabilityId).includes(capabilityId);
  })) {
    levels.push('capability_verified');
  }
  if (capability.apiReplayVerified === true || capability.evidenceModel === 'api_adapter_replay_verified') {
    levels.push('capability_verified');
  }
  return levels.sort((left, right) => evidenceLevelRank(right) - evidenceLevelRank(left))[0] ?? 'candidate';
}

function nodeHasPublicStructureEvidence(node = /** @type {any} */ ({})) {
  const layer = nodeSourceLayer(node);
  if (['route_seed_only', 'link_route_template', 'link_semantic_route_template'].includes(node.evidenceStatus)
    || node.publicEvidenceStatus === 'public_rendered_route_seed_only') {
    return false;
  }
  if (node.evidenceStatus === 'structure_summary_present') {
    return true;
  }
  if (node.publicEvidenceStatus === 'public_static_structured' || node.staticEvidenceStatus === 'present') {
    return true;
  }
  if (node.listPresent === true || Number(node.visibleItemCount ?? 0) > 0 || node.emptyStatePresent === true) {
    return true;
  }
  if (Array.isArray(node.routeTemplates) && node.routeTemplates.length > 0) {
    return true;
  }
  if (layer === 'public_rendered' || layer === 'authorized_source') {
    return ['form', 'component', 'menu', 'tab'].includes(node.type);
  }
  return layer === 'public' && ['form', 'component', 'menu', 'tab'].includes(node.type);
}

function buildCapabilityEvidenceMatrix(context, capability = /** @type {any} */ ({}), nodesById = new Map()) {
  const authRequired = capabilityRequiresLogin(context, capability, nodesById);
  const sourceLayer = sourceLayerForCapability({ ...capability, authRequired }, nodesById);
  const providerId = providerIdForCapability({ ...capability, authRequired }, nodesById);
  const publicRouteNavigationOnly = capability.evidenceModel === 'public_route_navigation' || capability.publicRouteOnly === true;
  const publicElementSummary = capability.evidenceModel === 'public_element_summary';
  const authenticatedRouteOnly = capability.evidenceModel === 'authenticated_route_only';
  const apiAdapterReplayVerified = capability.evidenceModel === 'api_adapter_replay_verified';
  const nodes = [
    ...(capability.entryNodeIds ?? []),
    ...(capability.requiredNodeIds ?? []),
  ].map((id) => nodesById.get(id)).filter(Boolean);
  const observedEvidence = new Set();
  if (nodes.length > 0) observedEvidence.add('source_node_present');
  if (Array.isArray(capability.evidence) && capability.evidence.length > 0) observedEvidence.add('sanitized_evidence_present');
  if (capability.executionPlan?.autoExecute !== true) observedEvidence.add('risk_policy_passed');
  if (!authRequired) {
    observedEvidence.add('public_route_accessible');
  }
  const hasPublicRouteReference = nodes.some((node) => (
    isPublicReadSourceLayer(nodeSourceLayer(node))
    && (
      ['page', 'route', 'route_template'].includes(node.type)
      || Boolean(node.normalizedUrl)
      || Boolean(node.routePattern)
      || Boolean(node.routeTemplate)
    )
  ));
  if (!authRequired && hasPublicRouteReference) {
    observedEvidence.add('public_route_template_present');
  }
  if (!authRequired && nodes.some((node) => node.evidenceStatus === 'element_instance_summary_present')) {
    observedEvidence.add('public_element_instance_present');
  }
  const hasPublicStructure = nodes.some((node) => nodeHasPublicStructureEvidence(node));
  if (!authRequired && hasPublicStructure) {
    if (nodes.some((node) => nodeSourceLayer(node) === 'authorized_source' && nodeHasPublicStructureEvidence(node))) {
      observedEvidence.add('authorized_source_structure_present');
    } else if (nodes.some((node) => nodeSourceLayer(node) === 'public_rendered' && nodeHasPublicStructureEvidence(node))) {
      observedEvidence.add('public_rendered_structure_present');
    } else {
      observedEvidence.add('public_structure_present');
    }
  }
  const hasAuthNode = nodes.some((node) => node.authRequired === true || isAuthenticatedSourceLayer(nodeSourceLayer(node)));
  if (authRequired && hasAuthNode) observedEvidence.add('route_accessible');
  if (authRequired && canRunAuthenticatedLayer(context.authStateReport)) observedEvidence.add('not_login_wall');
  if (apiAdapterReplayVerified && capability.apiReplayVerified === true) observedEvidence.add('api_replay_verified');
  const hasListContainer = nodes.some((node) => (
    node.listPresent === true
    || node.emptyStatePresent === true
    || /list|timeline|notification|bookmark|direct_message|following/u.test(String(node.classification ?? node.pageType ?? node.structureType ?? ''))
  ));
  if (authRequired && hasListContainer) observedEvidence.add('list_container_present');
  const hasVisibleItemsOrEmptyState = nodes.some((node) => Number(node.visibleItemCount ?? 0) > 0 || node.emptyStatePresent === true);
  if (authRequired && hasVisibleItemsOrEmptyState) observedEvidence.add('visible_item_count_or_empty_state');
  const requiredEvidence = authRequired
    ? apiAdapterReplayVerified
      ? ['source_node_present', 'not_login_wall', 'sanitized_evidence_present', 'api_replay_verified', 'risk_policy_passed']
      : authenticatedRouteOnly
      ? ['source_node_present', 'route_accessible', 'not_login_wall', 'sanitized_evidence_present', 'risk_policy_passed']
      : ['source_node_present', 'route_accessible', 'not_login_wall', 'list_container_present', 'visible_item_count_or_empty_state', 'risk_policy_passed']
    : apiAdapterReplayVerified
      ? ['source_node_present', 'public_route_accessible', 'sanitized_evidence_present', 'api_replay_verified', 'risk_policy_passed']
      : publicRouteNavigationOnly
      ? ['source_node_present', 'public_route_accessible', 'sanitized_evidence_present', 'public_route_template_present', 'risk_policy_passed']
      : publicElementSummary
        ? ['source_node_present', 'public_route_accessible', 'sanitized_evidence_present', 'public_element_instance_present', 'risk_policy_passed']
        : ['source_node_present', 'public_route_accessible', 'sanitized_evidence_present', 'public_structure_present', 'risk_policy_passed'];
  const observed = uniqueSortedStrings([...observedEvidence]);
  const missingEvidence = requiredEvidence.filter((item) => (
    item === 'public_structure_present'
      ? !observedEvidence.has('public_structure_present') && !observedEvidence.has('public_rendered_structure_present') && !observedEvidence.has('authorized_source_structure_present')
      : !observedEvidence.has(item)
  ));
  const observedEvidenceLevel = observedCapabilityEvidenceLevel(capability, nodesById, context.authStateReport);
  const requiredEvidenceLevel = authRequired
    ? (authenticatedRouteOnly && !apiAdapterReplayVerified) ? 'login_route_verified' : 'capability_verified'
    : 'public_verified';
  return {
    capabilityId: capability.id,
    authRequired,
    requiredEvidenceLevel,
    observedEvidenceLevel,
    sourceLayer,
    providerId,
    requiredEvidence,
    observedEvidence: observed,
    missingEvidence,
    activationDecision: missingEvidence.length === 0 ? (authRequired ? 'limited_enabled' : 'active') : 'candidate',
  };
}

function applyCapabilityEvidenceMatrix(context, capability = /** @type {any} */ ({}), graph) {
  const nodesById = new Map((graph?.nodes ?? []).map((node) => [node.id, node]));
  const matrix = buildCapabilityEvidenceMatrix(context, capability, nodesById);
  const next = {
    ...capability,
    authRequired: matrix.authRequired,
    sourceLayer: matrix.sourceLayer,
    providerId: matrix.providerId,
    requiredEvidenceLevel: matrix.requiredEvidenceLevel,
    observedEvidenceLevel: matrix.observedEvidenceLevel,
    evidenceMatrix: matrix,
    activationEvidence: matrix,
  };
  const forcedRiskDisabled = ['write_high', 'account_security_critical'].includes(next.risk_level)
    || ['payment', 'destructive'].includes(next.safetyLevel)
    || (isReadOnlyFollowSurface(next)
      ? findForcedDisabledActions(`${next.name ?? ''} ${next.object ?? ''} ${next.action ?? ''}`).filter((action) => action !== 'follow' && action !== 'unfollow').length > 0
      : findForcedDisabledActions(`${next.name ?? ''} ${next.object ?? ''} ${next.action ?? ''}`).length > 0);
  const confirmationRisk = isHighRiskCapability(next) || next.risk_level === 'write_low';
  if (forcedRiskDisabled) {
    delete next.executionPlan;
    next.status = 'disabled';
    next.enabled_status = 'disabled';
    next.default_policy = next.enabled_status;
    next.evidence_status = 'disabled';
    next.activationBlockedReason = next.activationBlockedReason ?? 'forced-action-disabled';
    next.evidenceMatrix = {
      ...matrix,
      activationDecision: next.enabled_status,
    };
    next.activationEvidence = next.evidenceMatrix;
    return next;
  }
  if (confirmationRisk && next.status === 'active') {
    if (next.executionPlan) {
      next.executionPlan = {
        ...next.executionPlan,
        mode: next.executionPlan.mode === 'read_only' ? 'dry_run' : next.executionPlan.mode,
        dryRunOnly: true,
        requiresConfirmation: true,
        autoExecute: false,
      };
    }
    next.enabled_status = next.enabled_status === 'draft_only' ? 'draft_only' : 'confirmation_required';
    next.default_policy = next.enabled_status;
    next.evidenceMatrix = {
      ...matrix,
      activationDecision: next.enabled_status,
    };
    next.activationEvidence = next.evidenceMatrix;
  }
  if (matrix.authRequired && !canRunAuthenticatedLayer(context.authStateReport)) {
    delete next.executionPlan;
    next.status = 'candidate';
    next.enabled_status = 'candidate_debug_only';
    next.default_policy = 'candidate_debug_only';
    next.evidence_status = 'candidate';
    next.activationBlockedReason = 'missing_auth_evidence';
    next.evidenceMatrix = {
      ...matrix,
      activationDecision: 'requires_login',
    };
    next.activationEvidence = next.evidenceMatrix;
    return next;
  }
  if (matrix.missingEvidence.length > 0) {
    delete next.executionPlan;
    next.status = next.status === 'disabled' ? 'disabled' : 'candidate';
    next.enabled_status = next.enabled_status === 'disabled' ? 'disabled' : 'candidate_debug_only';
    next.default_policy = next.enabled_status;
    next.evidence_status = 'candidate';
    next.activationBlockedReason = next.activationBlockedReason ?? 'capability-evidence-matrix-incomplete';
    return next;
  }
  if (matrix.authRequired && next.status === 'active') {
    next.enabled_status = next.enabled_status === 'enabled' ? 'limited_enabled' : (next.enabled_status ?? 'limited_enabled');
    next.default_policy = next.default_policy === 'read_only' ? 'limited_enabled' : (next.default_policy ?? 'limited_enabled');
    next.evidence_status = 'verified';
  }
  return next;
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
    const shortPath = apiEndpointShortPath(adapter.endpoint);
    const capability = makeCapability(context, {
      name: `read API endpoint ${shortPath}`,
      description: `Read replay-verified same-site API endpoint ${shortPath} through the Browser Bridge runtime.`,
      action: 'view',
      object: 'API endpoint',
      userValue: `Read API endpoint ${shortPath}`,
      entryNodeIds: entryNode ? [entryNode.id] : [],
      outputs: [{ name: 'response', type: 'api_response_summary' }],
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
      enabled_status: 'limited_enabled',
      default_policy: 'limited_enabled',
      evidence_status: 'verified',
      risk_level: 'read_personal_medium',
      apiAdapter: {
        candidateRef: adapter.candidateRef,
        adapterDecisionRef: adapter.adapterDecisionRef,
        replayVerificationRef: adapter.replayVerificationRef,
        runtimeBindingId: adapter.runtimeBindingId,
        method: adapter.method,
        redactedEndpoint: adapter.endpoint,
        authBoundary: adapter.authBoundary,
        responsePolicy: adapter.responsePolicy,
        runtime: 'browser_bridge_required',
        requiresFreshBridgeEvidence: true,
        genericHttpRuntimeAllowed: false,
      },
      intents: [{
        canonicalUtterance: `read API endpoint ${shortPath}`,
        utteranceExamples: [
          `read API endpoint ${shortPath}`,
          `call replay verified API endpoint ${shortPath}`,
          `读取已验证 API 接口 ${shortPath}`,
        ],
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
        authBoundary: 'browser_bridge',
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
  const publicEvidenceScore = (node) => (
    nodeSourceLayer(node) === 'public_rendered'
      ? 4
      : node.publicEvidenceStatus === 'public_static_structured' || node.staticEvidenceStatus === 'present'
        ? 3
        : node.evidenceStatus === 'structure_summary_present'
          ? 2
          : 1
  );
  const homepage = pageNodes
    .filter((node) => node.classification === 'homepage')
    .sort((left, right) => publicEvidenceScore(right) - publicEvidenceScore(left))[0]
    ?? pageNodes.sort((left, right) => publicEvidenceScore(right) - publicEvidenceScore(left))[0];
  const newsChannels = publicReadableNodes(graph, ['news_channel', 'article_list'])
    .filter((node) => nodeHasPublicStructureEvidence(node) && node.normalizedUrl);
  const newsArticle = pageNodes.find((node) => node.classification === 'article_detail');
  const isRepositorySite = isRepositoryCoverageSite(context, pageNodes);
  const isNewsSite = !isRepositorySite && isNewsCoverageSite(context, pageNodes, homepage);
  const hasAnyPublicStructureEvidence = graph.nodes.some((node) => (
    node.id !== homepage?.id
    && !node.authRequired
    && isPublicReadSourceLayer(nodeSourceLayer(node))
    && nodeHasPublicStructureEvidence(node)
  ));
  const isChapterSite = isChapterContentContext(context) || hasChapterContentCoverageSignals(graph.nodes ?? []);
  const productList = isChapterSite || isRepositorySite ? null : pageNodes.find((node) => node.classification === 'product_list');
  const productDetail = isChapterSite || isRepositorySite ? null : pageNodes.find((node) => node.classification === 'product_detail');
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
      description: 'Prepare a contact-support form submission as confirmation-required dry-run only.',
      action: 'contact',
      object: 'support',
      userValue: 'Prepare a contact form draft without submitting it.',
      entryNodeIds: [contactForm.nodeId],
      requiredNodeIds: [contactForm.nodeId],
      inputs: contactForm.inputs ?? [],
      outputs: [{ name: 'draft', type: 'form_submission_preview' }],
      safetyLevel,
      evidence: contactForm.evidence,
      confidence: 0.75,
      intents: [
        'create contact form draft',
        'preview contact form',
        'prepare support message without submitting',
      ],
    });
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'dry_run',
      dryRunOnly: true,
      requiresConfirmation: true,
      autoExecute: false,
      steps: [{
        kind: 'form_post_preview',
        nodeId: contactForm.nodeId,
        selector: contactForm.selector,
        endpoint: contactForm.endpoint,
        method: contactForm.method,
        submit: false,
      }],
    });
    capabilities.push(capability);
  }

  const robotsPolicy = stageResults.discoverSeeds?.robotsPolicy ?? null;
  addGenericPublicCoverageCapabilities(context, capabilities, graph, searchForm);
  addPublicElementInstanceCapabilities(context, capabilities, graph, robotsPolicy);
  addPublicRouteTemplateInstanceCapabilities(context, capabilities, graph, robotsPolicy);
  addAuthenticatedReadCoverageCapabilities(context, capabilities, graph);
  addGenericCatalogCoverageCapabilities(context, capabilities, graph, searchForm);
  addChapterContentCoverageCapabilities(context, capabilities, graph, searchForm);
  addUserAuthorizedKnownSiteCapabilities(context, capabilities, homepage);
  addDisabledRiskCapabilities(context, capabilities, affordances);
  capabilities.push(...generateAutoCapabilities(context, {
    graph,
    affordances,
    existingCapabilities: capabilities,
  }));
  capabilities.push(...executableApiAdapterCapabilities(context, stageResults, graph, homepage));

  const apiCandidateMetadata = apiCandidateCapabilityMetadata(stageResults);
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

  const policyApplied = dedupeSemanticCapabilities(arrayUniqueBy(capabilities, (capability) => capability.id)
    .map((capability) => enrichAutoCapability(context, capability))
    .map((capability) => applyCapabilityRiskPolicy(capability))
    .map((capability) => applyCapabilityEvidenceMatrix(context, capability, graph)))
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
  for (const capability of merged) {
    assertCapability(capability);
  }
  const executionPlans = merged
    .filter((capability) => capability.executionPlan)
    .map((capability) => capability.executionPlan)
    .sort((left, right) => left.id.localeCompare(right.id, 'en'));
  const payload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    status: capabilityCounts(merged).active > 0 ? 'success' : 'blocked',
    capabilities: merged,
    errors: capabilityCounts(merged).active > 0 ? [] : ['Capability discovery produced no active capabilities; build stopped before draft skill generation.'],
    summary: capabilityCounts(merged),
  };
  const plansPayload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    executionPlans,
  };
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
      canonicalUtterance: 'draft contact support message',
      utteranceExamples: ['draft a support message', 'prepare a contact form', 'contact support about an order'],
      negativeExamples: ['submit the form automatically', 'delete my profile'],
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
  if (capability.name === 'search posts') {
    return {
      canonicalUtterance: 'search posts',
      utteranceExamples: ['search posts', 'find posts about a topic', 'search X posts'],
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
  return String(
    node.categoryInstance?.label
    ?? node.instanceLabel
    ?? node.elementLabel
    ?? node.linkLabel
    ?? node.title
    ?? node.routeTemplate
    ?? node.routePattern
    ?? '页面入口',
  ).trim();
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
        && (hasMeaningfulElementLabel(node) || node.categoryInstance || node.routeTemplate || node.routePattern)
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
  const intents = arrayUniqueBy([
    ...generateAutoIntentRecords(context, capabilities, { includeCandidateDebug: true }),
    ...generateGraphElementIntentRecords(context, graph, capabilities, stageResults.discoverSeeds?.robotsPolicy ?? null),
  ], (intent) => `${intent.id}:${intent.capabilityId ?? intent.sourceNodeId ?? ''}`);
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
  const payload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    skillId: context.skillId,
    intents: runtimeDecoratedIntents,
    summary: {
      intents: runtimeDecoratedIntents.length,
      activeCapabilities: activeCapabilities.length,
      callableIntents: runtimeDecoratedIntents.filter((intent) => intent.callable !== false).length,
      nonCallableIntents: runtimeDecoratedIntents.filter((intent) => intent.callable === false).length,
    },
  };
  const intentsPath = await writeArtifactJson(context, 'intents.json', payload);
  return {
    intents: runtimeDecoratedIntents,
    artifactPaths: { intents: intentsPath },
    summary: payload.summary,
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
    intentIndex: 'intents.json',
    router: {
      registry: path.relative(activeSkillDir, context.registryPath).replace(/\\/gu, '/'),
      domainLookup: context.site.allowedDomains,
      utteranceMatcher: 'deterministic-token-overlap-v1',
    },
    executionEngine: {
      type: 'siteforge-static-plan',
      dryRunDefault: true,
      autoExecuteHighRisk: false,
    },
    safetyPolicy: 'safety_policy.json',
    artifacts: {
      site: path.relative(activeSkillDir, context.workspace.paths.siteRecordPath).replace(/\\/gu, '/'),
      graph: 'graph.json',
      capabilities: 'capabilities.json',
      intents: 'intents.json',
      executionPlans: 'execution_plans.json',
      verificationReport: 'verification_report.json',
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
  const safetyPolicy = requireStage(stageResults, 'registerSite').safetyPolicy;
  const manifest = buildSkillManifest(context, stageResults);
  const skillYaml = `${toYaml(manifest)}\n`;
  const invocationProbe = selectInvocationProbe(context, capabilities, intents);

  const artifactSkillPath = await writeArtifactText(context, 'skill.yaml', skillYaml);
  const skillPaths = {
    skillYaml: await writeSkillText(context, 'skill.yaml', skillYaml),
    graph: await writeSkillJson(context, 'graph.json', graph),
    capabilities: await writeSkillJson(context, 'capabilities.json', capabilitiesPayload),
    intents: await writeSkillJson(context, 'intents.json', intentsPayload),
    executionPlans: await writeSkillJson(context, 'execution_plans.json', executionPlansPayload),
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

function bridgeRuntimeMetadata(context) {
  return runtimeProviderPromotionMetadata('browser_bridge', {
    authStateReport: context.authStateReport,
  });
}

function genericHttpRuntimeMetadata() {
  return runtimeProviderPromotionMetadata('public_http');
}

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
  const layers = capabilitySourceLayers(capability, graph);
  if (!layers.length || !layers.every((layer) => layer === 'public')) {
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
    if (kind === 'api_request' && !['GET', 'HEAD'].includes(String(step.method ?? 'GET').toUpperCase())) {
      return false;
    }
    return planStepTargetAllowedByRobots(context, step, graph, robotsPolicy);
  });
}

function capabilityRuntimeMetadata(context, capability = /** @type {any} */ ({}), graph = /** @type {any} */ ({}), robotsPolicy = null) {
  if (isBridgeRuntimeSafeCapability(capability)) {
    return bridgeRuntimeMetadata(context);
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
    ...bridgeRuntimeMetadata(context),
    verificationStatus: 'bridge_runtime_passed',
    capabilityIds: promotableRuntimeCapabilityIds(context, stageResults),
  };
}

function registryIntentRuntimeMetadata(intent = /** @type {any} */ ({}), capability = /** @type {any} */ ({}), fallback = /** @type {any} */ (null)) {
  const runtimeMode = intent.runtimeMode ?? capability.runtimeMode ?? fallback?.runtimeMode ?? null;
  if (!runtimeMode) {
    return null;
  }
  return {
    promotionClass: intent.promotionClass ?? capability.promotionClass ?? fallback?.promotionClass ?? null,
    runtimeMode,
    requiresFreshBridgeEvidence: Boolean(intent.requiresFreshBridgeEvidence ?? capability.requiresFreshBridgeEvidence ?? fallback?.requiresFreshBridgeEvidence),
    genericHttpRuntimeAllowed: Boolean(intent.genericHttpRuntimeAllowed ?? capability.genericHttpRuntimeAllowed ?? fallback?.genericHttpRuntimeAllowed),
    coverageStatus: intent.coverageStatus ?? capability.coverageStatus ?? fallback?.coverageStatus ?? null,
    runtimeRequirements: intent.runtimeRequirements ?? capability.runtimeRequirements ?? fallback?.runtimeRequirements ?? null,
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
    .filter((capability) => capability.status === 'active')
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
  const candidateRegistry = upsertSkillRegistryRecord(
    createEmptySkillRegistry(context.startedAt),
    buildRegistryRecord(context, stageResults),
    context.startedAt,
  );
  const invocationProbe = selectInvocationProbe(context, capabilities, intents);
  const report = await createSiteForgeOutputValidationReport(context, stageResults, {
    artifactExists: pathExists,
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
    const metadata = bridgeRuntimeMetadata(context);
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
    ...(report.status === 'bridge_runtime_passed' ? bridgeRuntimeMetadata(context) : {}),
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
  if (verification.status === 'report_only_blocked') {
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
    return await writeNonRegisteredRegistryReport(
      context,
      writeMode === 'draft_only' ? 'draft' : 'preview',
      writeMode === 'draft_only' ? 'write-mode-draft-only' : 'write-mode-preview-only',
      { writeMode, ...(bridgeRuntime ? bridgeRuntimeMetadata(context) : {}) },
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
        ...(bridgeRuntime ? bridgeRuntimeMetadata(context) : {}),
      });
      await finalizeRetainedCurrentPromotion(context.workspace, promotion);
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
  const registry = await readSkillRegistry(context.registryPath);
  const record = buildRegistryRecord(context, stageResults, {
    ...registryOptions,
    skillDir: context.workspace.paths.currentDir,
  });
  const nextRegistry = upsertSkillRegistryRecord(registry, record, new Date().toISOString());
  const capabilities = requireStage(stageResults, 'discoverCapabilities').capabilities;
  const intents = requireStage(stageResults, 'generateIntents').intents;
  const invocationProbe = selectInvocationProbe(context, capabilities, intents, {
    capabilityIds: registryOptions.capabilityIds,
  });
  const lookup = lookupSkillIntentFromRegistry(nextRegistry, {
    domain: invocationProbe.domain,
    utterance: invocationProbe.utterance,
  });
  if (lookup.status !== 'found') {
    throw new Error('Registry lookup failed after registration.');
  }
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
      ...(bridgeRuntime ? bridgeRuntimeMetadata(context) : {}),
    };
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

function classifyBuildFailure(error, stageRecords) {
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

function collectionOutcomeReason(value, stageName = '') {
  const reason = String(value ?? '');
  const stage = String(stageName ?? '');
  if (reason === 'capability-specific-evidence-required') {
    return 'Capability was discovered, but capability-specific evidence is still required before activation.';
  }
  if (reason === 'authorized-route-seed-only') {
    return 'Only an authorized route seed was captured; SiteForge still needs capability-specific content evidence.';
  }
  if (reason === 'not-selected-by-setup') {
    return 'Capability is known for this site policy but was not selected in this setup run.';
  }
  if (reason === 'stage-skipped') {
    return 'Collection stage was skipped in this deterministic build path.';
  }
  if (reason === 'stage-failed') {
    return 'Collection stage failed before producing verified output.';
  }
  if (reason === 'stage-blocked') {
    return 'Collection stage was blocked before producing verified output.';
  }
  if (reason === 'dynamic-unsupported' && stage === 'crawlRendered') {
    return 'Public rendered structural evidence was needed but was not collected; install or point SiteForge at a Chromium browser with --browser-path, or provide a sanitized publicRenderedStructureProvider in tests.';
  }
  if (reason === 'dynamic-unsupported' && stage === 'captureNetworkTraces') {
    return 'Network summary was not requested; raw network tracing is not part of the public build path.';
  }
  if (reason === 'build-failed') {
    return 'Build failed before producing verified output.';
  }
  return reason || 'Not enough verified evidence to promote this item.';
}

function collectionOutcomeKindForStage(stageName) {
  return COLLECTION_OUTCOME_STAGE_KINDS[stageName] ?? 'stage';
}

function collectionOutcomeReasonCodeForStage(record) {
  if (record.reasonCode) {
    return record.reasonCode;
  }
  if (record.status === 'failed') {
    return 'stage-failed';
  }
  if (record.status === 'blocked') {
    return 'stage-blocked';
  }
  return 'stage-skipped';
}

function collectionOutcomePriority(outcome) {
  if (outcome.kind === 'build') {
    return 0;
  }
  if (outcome.kind === 'stage') {
    return 1;
  }
  if (outcome.kind === 'node') {
    return 2;
  }
  if (outcome.kind === 'affordance') {
    return 3;
  }
  if (outcome.kind === 'capability' && outcome.status === 'candidate') {
    return 4;
  }
  if (outcome.kind === 'capability') {
    return 5;
  }
  return 6;
}

function compareCollectionOutcomes(left, right) {
  const priorityDelta = collectionOutcomePriority(left) - collectionOutcomePriority(right);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }
  return String(left.target ?? '').localeCompare(String(right.target ?? ''), 'en');
}

function collectUnsuccessfulCollections(stageResults, stageRecords, status = 'success', error = null) {
  const outcomes = /** @type {any[]} */ ([]);
  const capabilities = stageResults.discoverCapabilities?.capabilities ?? [];
  for (const capability of capabilities) {
    if (capability.status === 'active') {
      continue;
    }
    if (isDebugOnlyCapability(capability)) {
      continue;
    }
    const reasonCode = capability.activationBlockedReason ?? `capability-${capability.status ?? 'inactive'}`;
    outcomes.push({
      kind: 'capability',
      target: capability.name,
      status: capability.status ?? 'unknown',
      reasonCode,
      reason: collectionOutcomeReason(reasonCode),
      selectedBySetup: capability.selectedBySetup === true,
      browserSeedBacked: capability.browserSeedBacked === true,
      safetyLevel: capability.safetyLevel ?? null,
    });
  }
  for (const [stageName, record] of Object.entries(stageRecords ?? {})) {
    if (!record || !COLLECTION_OUTCOME_STAGE_STATUSES.includes(record.status)) {
      continue;
    }
    const reasonCode = collectionOutcomeReasonCodeForStage(record);
    outcomes.push({
      kind: collectionOutcomeKindForStage(stageName),
      target: stageName,
      status: record.status,
      reasonCode,
      reason: collectionOutcomeReason(reasonCode, stageName),
    });
  }
  if (status !== 'success' && error) {
    const reasonCode = error.reasonCode ?? error.code ?? 'build-failed';
    outcomes.push({
      kind: 'build',
      target: error.stage ?? 'build',
      status,
      reasonCode,
      reason: collectionOutcomeReason(reasonCode),
    });
  }
  const uniqueOutcomes = arrayUniqueBy(
    outcomes,
    (item) => `${item.kind}:${item.target}:${item.status}:${item.reasonCode}`,
  ).sort(compareCollectionOutcomes);
  const unsuccessful = uniqueOutcomes.slice(0, COLLECTION_OUTCOME_LIMIT);
  return {
    unsuccessful,
    total: uniqueOutcomes.length,
    truncated: uniqueOutcomes.length > COLLECTION_OUTCOME_LIMIT,
    limit: COLLECTION_OUTCOME_LIMIT,
  };
}

function normalizeReportMode(value, fallback = 'user') {
  const mode = String(value ?? fallback).trim().toLowerCase();
  return REPORT_MODES.has(mode) ? mode : fallback;
}

const DEBUG_ONLY_STATUS_VALUES = new Set(['debug_only', 'candidate_debug_only']);

function normalizeStatusToken(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isDebugOnlyCapability(capability = /** @type {any} */ ({})) {
  if (capability.debug_only === true || capability.debugOnly === true || capability.candidate_debug_only === true) {
    return true;
  }
  if (
    capability.autoGenerated === true
    && capability.informational === true
    && normalizeStatusToken(capability.enabled_status) === 'disabled'
    && ['read_public_low', 'read_personal_medium'].includes(normalizeStatusToken(capability.risk_level ?? capability.riskPolicy?.riskLevel))
  ) {
    return true;
  }
  const statusFields = [
    capability.enabled_status,
    capability.enabledStatus,
    capability.default_policy,
    capability.defaultPolicy,
    capability.strategy,
    capability.user_strategy,
    capability.reason_code,
    capability.reasonCode,
    capability.activationBlockedReason,
    capability.evidence_status,
    capability.evidenceStatus,
  ].map(normalizeStatusToken);
  if (statusFields.some((value) => DEBUG_ONLY_STATUS_VALUES.has(value))) {
    return true;
  }
  return normalizeStatusToken(capability.status) === 'candidate';
}

function capabilitySortText(capability = /** @type {any} */ ({})) {
  return [
    capability.category,
    capability.name,
    capability.user_facing_name,
    capability.userFacingName,
    capability.userValue,
    capability.description,
    capability.action,
    capability.object,
    capability.setupCapabilityId,
  ].filter(Boolean).join(' ').toLowerCase();
}

function capabilityUserSortRank(capability = /** @type {any} */ ({})) {
  const text = capabilitySortText(capability);
  const riskLevel = normalizeStatusToken(capability.risk_level ?? capability.riskPolicy?.riskLevel);
  const defaultPolicy = normalizeStatusToken(capability.default_policy);
  const enabledStatus = normalizeStatusToken(capability.enabled_status);
  const status = normalizeStatusToken(capability.status);
  if (
    ['write_high', 'account_security_critical'].includes(riskLevel)
    || (enabledStatus === 'disabled' && /account|security|settings|delete|follow|like|repost|upload|payment|checkout|publish|send/u.test(text))
  ) {
    return 80;
  }
  if (riskLevel === 'write_low' || defaultPolicy === 'draft_only' || /draft|compose|reply draft|quote-post draft|post draft/u.test(text)) {
    return 60;
  }
  if (/notification|bookmark|\blists?\b|direct message|\bdm\b|following|followers|personal|account profile|timeline/u.test(text)) {
    return 50;
  }
  if (/post detail|post thread|reply tree|replies|quote|media|article detail|product detail|detail/u.test(text)) {
    return 40;
  }
  if (/profile|author|creator|homepage content/u.test(text)) {
    return 30;
  }
  if (/search|query|filter/u.test(text)) {
    return 20;
  }
  if (/homepage|home page|view|browse|timeline|feed|article|product|news|content/u.test(text)) {
    return 10;
  }
  if (status === 'disabled' || enabledStatus === 'disabled') {
    return 70;
  }
  if (/nav|navigate|route|menu|tab|modal|external|explore|open/u.test(text)) {
    return 65;
  }
  return 55;
}

function sortCapabilitiesForUser(capabilities = /** @type {any[]} */ ([])) {
  return [...(Array.isArray(capabilities) ? capabilities : [])]
    .sort((left, right) => (
      capabilityUserSortRank(left) - capabilityUserSortRank(right)
      || String(left.user_facing_name ?? left.userFacingName ?? left.userValue ?? left.name ?? left.id ?? '')
        .localeCompare(String(right.user_facing_name ?? right.userFacingName ?? right.userValue ?? right.name ?? right.id ?? ''), 'zh-Hans')
      || String(left.id ?? '').localeCompare(String(right.id ?? ''), 'en')
    ));
}

const REPORT_ABSOLUTE_PATH_PATTERN = /(?:[A-Za-z]:\\Users\\|\/Users\/|\/home\/)[^\s"',;)]*/giu;
const REPORT_EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const REPORT_PHONE_PATTERN = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b|\b1[3-9]\d{9}\b/gu;
const REPORT_HANDLE_PATTERN = /(^|[^\w/])@[A-Za-z0-9_]{2,15}\b/gu;
const REPORT_BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gu;
const REPORT_SECRET_ASSIGNMENT_PATTERN = /\b(?:access_token|refresh_token|token|auth|api[_-]?key|secret|password|session(?:[_-]?id)?|sid)\s*[:=]\s*(?!\[REDACTED\]|%5BREDACTED%5D)[^&\s;'",]+/giu;
const REPORT_COOKIE_PATTERN = /\bcookie\s*[:=]\s*(?!\[REDACTED\]|%5BREDACTED%5D)[^;\s&'",]+/giu;
const REPORT_AUTH_HEADER_PATTERN = /\bauthorization\s*[:=]\s*(?!\[REDACTED\]|%5BREDACTED%5D)[^\r\n]+/giu;
const REPORT_RAW_MARKUP_PATTERN = /<html[\s>]|<\/html>|<!doctype\s+html|raw[-_\s]*(?:dom|html|body)/iu;

function sanitizeReportString(value) {
  let text = String(value ?? '');
  if (REPORT_RAW_MARKUP_PATTERN.test(text)) {
    text = text.replace(REPORT_RAW_MARKUP_PATTERN, '[REDACTED_HTML]');
  }
  return text
    .replace(REPORT_ABSOLUTE_PATH_PATTERN, '[REDACTED_PATH]')
    .replace(REPORT_EMAIL_PATTERN, '[REDACTED_EMAIL]')
    .replace(REPORT_PHONE_PATTERN, '[REDACTED_PHONE]')
    .replace(REPORT_BEARER_PATTERN, '[REDACTED_AUTH]')
    .replace(REPORT_SECRET_ASSIGNMENT_PATTERN, '[REDACTED_SECRET]')
    .replace(REPORT_COOKIE_PATTERN, 'cookie=[REDACTED]')
    .replace(REPORT_AUTH_HEADER_PATTERN, 'authorization=[REDACTED]')
    .replace(REPORT_HANDLE_PATTERN, '$1[REDACTED_HANDLE]');
}

function sanitizeReportPublicValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeReportPublicValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeReportPublicValue(item)]));
  }
  return typeof value === 'string' ? sanitizeReportString(value) : value;
}

function relativeReportPath(cwd, value) {
  if (!value) {
    return null;
  }
  const relative = path.relative(cwd, value);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative.replace(/\\/gu, '/')
    : String(value).replace(/\\/gu, '/');
}

function userReportGroupForCapability(capability = /** @type {any} */ ({})) {
  const status = normalizeCapabilityEnablementStatus(capability);
  if (status === 'enabled') return 'enabled';
  if (status === 'limited_enabled') return 'limited_enabled';
  if (status === 'confirmation_required' || status === 'draft_only') return 'confirmation_required';
  return 'disabled';
}

function userCapabilityReason(capability = /** @type {any} */ ({})) {
  if (capability.user_reason) {
    return capability.user_reason;
  }
  const text = `${capability.name ?? ''} ${capability.object ?? ''}`.toLowerCase();
  if (isDebugOnlyCapability(capability)) {
    return 'Candidate capability only; evidence is incomplete, so it is not enabled by default.';
  }
  if (capability.risk_level === 'account_security_critical') {
    return 'Account security or payment settings are involved, so the capability is disabled by default.';
  }
  if (capability.risk_level === 'write_high') {
    if (/direct message|dm/u.test(text)) {
      return 'Direct messages, recipients, or sending actions are involved, so the capability is disabled by default.';
    }
    return 'Publishing, interaction, deletion, upload, or follow-style write actions are involved, so the capability is disabled by default.';
  }
  if (capability.risk_level === 'read_private_high') {
    return 'Private body text or personal conversations may be involved, so the capability is disabled by default.';
  }
  if (capability.risk_level === 'read_personal_medium') {
    return 'Personalized or login-only information requires limited summaries or explicit confirmation.';
  }
  if (capability.risk_level === 'write_low') {
    return 'Only draft preview is allowed; SiteForge will not submit the action.';
  }
  return 'Only sanitized structural summaries are retained; body text and account-private material are not saved.';
}

function userCapabilityStrategy(capability = /** @type {any} */ ({})) {
  if (capability.user_strategy) {
    return capability.user_strategy;
  }
  const status = normalizeCapabilityEnablementStatus(capability);
  if (status === 'limited_enabled') {
    return 'Return only limited sanitized summaries.';
  }
  if (status === 'confirmation_required') {
    return 'Require user confirmation before execution.';
  }
  if (status === 'draft_only' || capability.default_policy === 'draft_only') {
    return 'Generate drafts only; do not submit, upload, or select sensitive recipients.';
  }
  if (status === 'disabled' || capability.default_policy === 'disabled' || capability.status !== 'active') {
    return 'Disabled by default and never auto-executed.';
  }
  return 'Read-only by default with sanitized output.';
}

function safeExecutionPlanRoute(value) {
  if (!value) return null;
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/^https?:\/\//iu.test(text)) {
    try {
      return new URL(text).pathname || '/';
    } catch {
      return null;
    }
  }
  if (/^[/?#]/u.test(text)) {
    return text.split(/[?#]/u)[0] || '/';
  }
  return /^[A-Za-z0-9_./:@-]{1,160}$/u.test(text) ? text : null;
}

function executionPlanCard(plan = null) {
  if (!plan || typeof plan !== 'object') return {};
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const firstRoute = steps
    .map((step) => safeExecutionPlanRoute(step?.routeTemplate ?? step?.route ?? step?.routePath ?? step?.url ?? step?.href ?? step?.endpoint))
    .find(Boolean);
  const stepKinds = uniqueSortedStrings(steps
    .map((step) => String(step?.kind ?? step?.type ?? '').replace(/[^a-z0-9_.:-]+/giu, '_'))
    .filter(Boolean));
  return {
    execution_plan_id: plan.id ?? null,
    execution_plan_mode: plan.mode ?? null,
    execution_plan_dry_run_only: plan.dryRunOnly === true,
    execution_plan_requires_confirmation: plan.requiresConfirmation === true,
    execution_plan_auto_execute: plan.autoExecute === true,
    execution_plan_requires_user_approval: plan.requiresUserAuthorization === true
      || plan.requiresUserApproval === true
      || steps.some((step) => (
        step?.requiresUserAuthorization === true
        || step?.requiresUserApproval === true
        || step?.reusesExistingLoginState === true
      )),
    execution_plan_step_kinds: stepKinds,
    execution_plan_step_count: steps.length,
    route_template: safeExecutionPlanRoute(plan.routeTemplate ?? plan.route) ?? firstRoute,
  };
}

function buildCapabilityCard(capability = /** @type {any} */ ({})) {
  const enabledStatus = normalizeCapabilityEnablementStatus(capability);
  const evidenceStatus = normalizeCapabilityEvidenceStatus(capability, enabledStatus);
  const safeRemediation = capability.safe_remediation
    ?? capability.safeRemediation
    ?? publicSafeRemediation(buildCapabilitySafeRemediationPath(capability));
  return {
    id: capability.id ?? null,
    name: capability.name ?? null,
    user_facing_name: capability.user_facing_name ?? capability.userValue ?? capability.name ?? null,
    risk_level: capability.risk_level ?? capability.riskPolicy?.riskLevel ?? null,
    enabled_status: enabledStatus,
    report_group: userReportGroupForCapability(capability),
    default_policy: capability.default_policy ?? null,
    evidence_status: evidenceStatus,
    action: capability.action ?? null,
    status: capability.status ?? null,
    safety_level: capability.safetyLevel ?? capability.safety ?? null,
    selected_by_setup: capability.selectedBySetup === true,
    setup_capability_id: capability.setupCapabilityId ?? null,
    requires_capability_evidence: capability.requiresCapabilityEvidence === true,
    capability_verified: capability.capabilityVerified === true,
    browser_seed_backed: capability.browserSeedBacked === true,
    proof_summary: capability.proofSummary ?? null,
    safe_remediation_path: safeRemediation?.path ?? null,
    safe_remediation: safeRemediation ?? null,
    ...executionPlanCard(capability.executionPlan),
    reason: userCapabilityReason(capability),
    strategy: userCapabilityStrategy(capability),
  };
}

function buildCapabilityStateModel(capabilities = /** @type {any[]} */ ([])) {
  const groups = {
    enabled: [],
    limited_enabled: [],
    confirmation_required: [],
    disabled: [],
  };
  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    const card = buildCapabilityCard(capability);
    groups[card.report_group].push(card);
  }
  return {
    groups,
    enablement_status_counts: capabilityEnablementStatusCounts(capabilities),
    evidence_status_summary: capabilityEvidenceStatusSummary(capabilities),
  };
}

function isHighRiskOrAccountDisabled(card = /** @type {any} */ ({})) {
  return card.report_group === 'disabled'
    && (
      ['write_high', 'account_security_critical'].includes(card.risk_level)
      || ['submit', 'upload', 'book', 'purchase', 'login', 'register', 'manage', 'contact'].includes(card.action)
    );
}

function partialSuccessReasonFromWarning(warning) {
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

function safePublicReasonCode(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,120}$/u.test(text) ? text : null;
}

function buildPartialSuccessReasons({
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
  const missingSetupEvidence = Number(setupCollectionReview?.missingRecordCount ?? 0) > 0
    || Number(setupCollectionReview?.summary?.capabilities?.missing ?? 0) > 0
    || Number(setupCollectionReview?.summary?.intents?.missing ?? 0) > 0;
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

function resultStatusFromBuild({
  legacyStatus,
  context,
  report,
  setupCollectionReview,
  capabilityState,
}) {
  if (legacyStatus !== 'success') {
    return 'failed';
  }
  return buildPartialSuccessReasons({
    context,
    report,
    setupCollectionReview,
    capabilityState,
  }).length ? 'partial_success' : 'success';
}

function browserBridgeCoverageGaps(authStateReport = /** @type {any} */ ({})) {
  const bridge = authStateReport?.browserBridge ?? {};
  const routeResults = Array.isArray(bridge.routeResults) ? bridge.routeResults : [];
  return routeResults
    .filter((result) => !browserBridgeRouteCaptured(result))
    .map((result) => ({
      id: result?.routeId ?? null,
      name: result?.targetRoute ?? result?.routeId ?? 'browser-auth-route',
      authRequired: true,
      routeTemplate: result?.targetRoute ?? null,
      sourceLayer: result?.sourceLayer === 'authenticated_overlay' ? 'authenticated_overlay' : 'authenticated',
      status: result?.status ?? 'timeout',
      reason: result?.reasonCode ?? result?.status ?? 'browser-auth-route-not-captured',
      missingEvidence: ['browser_structure_summary'],
    }));
}

function summarizeNodes(stageResults = /** @type {any} */ ({})) {
  const nodes = stageResults.classifyNodes?.graph?.nodes
    ?? stageResults.buildSiteGraph?.graph?.nodes
    ?? [];
  const byType = /** @type {any} */ ({});
  const byClassification = /** @type {any} */ ({});
  const bySourceLayer = /** @type {any} */ ({});
  let authRequired = 0;
  for (const node of nodes) {
    const type = node.type ?? 'unknown';
    const classification = node.classification ?? 'unclassified';
    const sourceLayer = nodeSourceLayer(node);
    byType[type] = (byType[type] ?? 0) + 1;
    byClassification[classification] = (byClassification[classification] ?? 0) + 1;
    bySourceLayer[sourceLayer] = (bySourceLayer[sourceLayer] ?? 0) + 1;
    if (node.authRequired === true) {
      authRequired += 1;
    }
  }
  return {
    total: nodes.length,
    nodes_total: nodes.length,
    page_nodes: byType.page ?? 0,
    content_nodes: byType.content ?? 0,
    operation_nodes: byType.operation ?? byType.component ?? byType.action ?? 0,
    modal_nodes: byType.modal ?? 0,
    route_templates: (byType.route_template ?? 0) + (byType.route ?? 0),
    actionable_elements: stageResults.extractAffordances?.affordances?.length
      ?? stageResults.discoverInteractions?.interactions?.length
      ?? 0,
    by_type: byType,
    by_classification: byClassification,
    by_source_layer: bySourceLayer,
    auth_required: authRequired,
  };
}

function summarizePrivacy(context, report) {
  const privacyMode = context.options?.privacyMode ?? context.options?.privacy ?? 'limited';
  const networkRequested = context.policy?.captureNetwork === true || context.options?.network === true;
  const rawNetworkTracesPersisted = report.summary?.network?.sanitizedSummary?.rawTracesPersisted === true
    || report.summary?.network?.rawTracesPersisted === true;
  const rawPageMaterialPages = Number(report.summary?.rawPageMaterial?.pages ?? 0);
  return {
    mode: privacyMode,
    credential_material_persisted: false,
    runtime_sensitive_material_persisted: false,
    browser_state_material_persisted: false,
    public_page_material_persisted: rawPageMaterialPages > 0,
    public_page_material_pages: rawPageMaterialPages,
    public_page_material_redacted: rawPageMaterialPages > 0,
    private_page_material_persisted: false,
    raw_network_traces_persisted: rawNetworkTracesPersisted,
    sanitized_reports: true,
    network_capture_requested: networkRequested,
    network_summary_only: networkRequested && !rawNetworkTracesPersisted,
    redaction_required: true,
    warning_codes: report.warningCodes ?? [],
  };
}

function buildUserFacingWarnings(report, resultStatus, context = null, partialSuccessReasons = /** @type {any[]} */ ([])) {
  const warnings = uniqueSortedStrings((report.warnings ?? []).map((warning) => displayBuildWarning(warning)));
  if (resultStatus === 'partial_success') {
    warnings.push(...partialSuccessReasons);
  }
  if (
    context?.setupProfile?.userAuthorizedEvidence?.autoDiscovery?.status === 'modeled'
    && (
      context.setupProfile.userAuthorizedEvidence.autoDiscovery.dynamicEnabled !== true
      || context.setupProfile.userAuthorizedEvidence.autoDiscovery.networkEnabled !== true
    )
  ) {
    warnings.push('Auto-discovery used sanitized SPA route/state summaries; browser-rendered crawl and raw network tracing are not enabled in this public build path.');
  }
  if (context?.options?.internalRawNetwork === true) {
    warnings.push('Raw network capture was enabled; raw artifacts are kept out of generated Skill, current outputs, and registry.');
  }
  if (resultStatus === 'failed' && report.reason) {
    warnings.push(report.reason);
  }
  return uniqueSortedStrings(warnings);
}

function buildNextSteps({ resultStatus, context, report, confirmationRequired, disabledCapabilities, confirmationPaths }) {
  const steps = /** @type {any[]} */ ([]);
  if (resultStatus === 'success') {
    steps.push('Use the generated skill for the enabled read-only capabilities.');
  } else if (resultStatus === 'partial_success') {
    if (report.summary?.verificationStatus === 'bridge_runtime_passed') {
      steps.push('Use the registered runtime-routed Skill: public read-only capabilities can use generic HTTP read, while captured authenticated capabilities require the SiteForge Browser Bridge extension.');
    } else if (report.summary?.verificationStatus === 'report_only_blocked') {
      steps.push('Review the report-only capabilities and intents; promotion was blocked by external access policy and runtime registry/current outputs were not updated.');
    } else {
      steps.push('Use the enabled low-risk read-only capabilities now.');
    }
    if (confirmationRequired.length) {
      if (confirmationPaths?.view_confirmation_required_command) {
        steps.push(`Review confirmation-required capabilities: ${confirmationPaths.view_confirmation_required_command}.`);
      }
      if (confirmationPaths?.sensitive_read?.command) {
        steps.push(`Confirm limited sensitive-read structure scanning: ${confirmationPaths.sensitive_read.command}.`);
      }
      if (confirmationPaths?.draft_write?.command) {
        steps.push(`Confirm draft-only preparation: ${confirmationPaths.draft_write.command}.`);
      }
    }
    if (context.options?.deep !== true) {
      steps.push('Run with --deep when you need broader static and sanitized structure discovery; this does not enable browser-rendered crawling.');
    }
    if (context.policy?.captureNetwork !== true) {
      steps.push('Enable rendered discovery when API/network capture evidence is needed; raw network capture is enabled by default for the public build command.');
    }
    if (
      context.setupProfile?.userAuthorizedEvidence?.autoDiscovery?.status === 'modeled'
      && (
        context.setupProfile.userAuthorizedEvidence.autoDiscovery.dynamicEnabled !== true
        || context.setupProfile.userAuthorizedEvidence.autoDiscovery.networkEnabled !== true
      )
    ) {
      steps.push('Internal operator deep mode: node src/entrypoints/build/run-build.mjs <url> --auto --deep --network.');
    }
    if (disabledCapabilities.length) {
      steps.push('For disabled capabilities, write a safe remediation plan: immediate entries use limited summaries or draft previews; adapter entries need explicit site adapter validation before use.');
      if (confirmationPaths?.disabled?.review_command) {
        steps.push(`Review disabled capabilities: ${confirmationPaths.disabled.review_command}.`);
      }
    }
  } else {
    const dynamicBlocked = report.reasonCode === 'dynamic-unsupported'
      || Object.values(report.stages ?? {}).some((stage) => (stage.reasonCodes ?? []).includes('dynamic-unsupported'));
    if (dynamicBlocked) {
      steps.push('For public dynamic pages, SiteForge now attempts a sanitized public rendered structure summary automatically; if the browser cannot launch, rerun with --browser-path pointing to Chrome or Chromium.');
      steps.push('If the rendered route is a challenge, CAPTCHA, login wall, or access-control page, SiteForge will keep it blocked and will not bypass it.');
    } else {
      steps.push(report.reasonAction ?? report.reason ?? 'Fix the reported blocker and rerun the build.');
    }
  }
  return uniqueSortedStrings(steps);
}

function buildNextStepWorkflows({ resultStatus, report }) {
  const workflows = /** @type {any[]} */ ([]);
  const routeCapturePlanPath = report.artifacts?.[ROUTE_CAPTURE_PLAN_FILE] ? ROUTE_CAPTURE_PLAN_FILE : null;
  if (report.summary?.verificationStatus === 'bridge_runtime_passed') {
    workflows.push({
      id: 'browser-bridge-runtime',
      status: 'registered',
      purpose: 'Invoke captured read-only capabilities through the default-browser Bridge with fresh sanitized structure evidence.',
      promotionAllowed: true,
      updatesCurrent: true,
      updatesRegistry: true,
      runtimeMode: BRIDGE_RUNTIME_MODE,
      requiresFreshBridgeEvidence: true,
      genericHttpRuntimeAllowed: false,
    });
    workflows.push({
      id: 'generic-http-read-runtime',
      status: 'registered-when-eligible',
      purpose: 'Invoke eligible public read-only capabilities through same-site GET or route navigation without cookies or form submission.',
      promotionAllowed: true,
      updatesCurrent: true,
      updatesRegistry: true,
      runtimeMode: HTTP_RUNTIME_MODE,
      requiresFreshBridgeEvidence: false,
      genericHttpRuntimeAllowed: true,
    });
  }
  if (routeCapturePlanPath && Number(report.summary?.routeCapturePlan?.missingRouteCount ?? 0) > 0) {
    workflows.push({
      id: 'browser-bridge-route-retry',
      status: 'available-for-missing-routes',
      report: routeCapturePlanPath,
      purpose: 'Retry only the browser-bridge routes that were not captured; successful retries can update coverage without fabricating blocked routes.',
      promotionAllowed: false,
      updatesCurrent: false,
      updatesRegistry: false,
      runtimeMode: BRIDGE_RUNTIME_MODE,
      requiresFreshBridgeEvidence: true,
    });
  }
  const accessPlanPath = report.artifacts?.[ACCESS_REMEDIATION_PLAN_FILE] ? ACCESS_REMEDIATION_PLAN_FILE : null;
  if (accessPlanPath) {
    workflows.push(
      {
        id: 'access-remediation-plan',
        status: 'available',
        report: accessPlanPath,
        purpose: 'Use compliant alternatives after robots, challenge, or access-boundary blocks generic live crawling.',
        promotionAllowed: false,
        updatesCurrent: false,
        updatesRegistry: false,
      },
      {
        id: 'official-api-or-feed',
        status: 'requires-user-input',
        allowedEvidence: ['response_shape', 'schema_hash', 'rate_limit_policy', 'permission_scope'],
        promotionAllowed: false,
      },
      {
        id: 'manual-summary',
        status: 'requires-sanitized-structure-source',
        allowedEvidence: ['route_template', 'page_type', 'visible_item_count', 'control_type', 'structure_hash'],
        promotionAllowed: false,
      },
      {
        id: 'local-http-validation',
        status: 'available-for-tests-only',
        promotionAllowed: false,
        liveSupportClaimAllowed: false,
      },
    );
  }
  if (!workflows.length && resultStatus === 'failed') {
    workflows.push({
      id: 'rerun-after-blocker-fixed',
      status: 'available-after-input-change',
      promotionAllowed: false,
      updatesCurrent: false,
      updatesRegistry: false,
    });
  }
  return workflows;
}

function buildCoverageReport(context, stageResults = /** @type {any} */ ({}), capabilities = /** @type {any[]} */ ([])) {
  const nodes = stageResults.classifyNodes?.graph?.nodes
    ?? stageResults.buildSiteGraph?.graph?.nodes
    ?? [];
  const publicStaticNodes = nodes.filter((node) => nodeSourceLayer(node) === 'public');
  const publicRenderedNodes = nodes.filter((node) => nodeSourceLayer(node) === 'public_rendered');
  const authorizedSourceNodes = nodes.filter((node) => nodeSourceLayer(node) === 'authorized_source');
  const publicNodes = [...publicStaticNodes, ...publicRenderedNodes];
  const authNodes = nodes.filter((node) => nodeSourceLayer(node) === 'authenticated');
  const overlayNodes = nodes.filter((node) => nodeSourceLayer(node) === 'authenticated_overlay');
  const publicCapabilities = capabilities.filter((capability) => capability.authRequired !== true);
  const publicCrawlCapabilities = publicCapabilities.filter((capability) => capability.sourceLayer !== 'authorized_source');
  const authCapabilities = capabilities.filter((capability) => capability.authRequired === true);
  const requiresLoginButMissing = authCapabilities
    .filter((capability) => capability.status !== 'active' && capability.activationBlockedReason === 'missing_auth_evidence')
    .map((capability) => ({
      id: capability.id,
      name: capability.name,
      missingEvidence: capability.evidenceMatrix?.missingEvidence ?? [],
    }));
  const blockedByRisk = capabilities
    .filter((capability) => capability.status === 'disabled' || ['disabled', 'draft_only', 'confirmation_required'].includes(normalizeStatusToken(capability.enabled_status)))
    .filter((capability) => isHighRiskCapability(capability) || ['write_low', 'write_high', 'account_security_critical'].includes(capability.risk_level))
    .map((capability) => ({
      id: capability.id,
      name: capability.name,
      riskLevel: capability.risk_level ?? null,
      enabledStatus: capability.enabled_status ?? null,
      reason: capability.activationBlockedReason ?? capability.disabledReason ?? null,
    }));
  const blockedByAuth = [
    ...browserBridgeCoverageGaps(context.authStateReport),
    ...authCapabilities
    .filter((capability) => capability.status !== 'active')
    .filter((capability) => !(
      isHighRiskCapability(capability)
      || ['write_low', 'write_high', 'account_security_critical'].includes(capability.risk_level)
      || ['forced-action-disabled', 'risk-policy-disabled'].includes(capability.activationBlockedReason)
    ))
    .map((capability) => ({
      id: capability.id,
      name: capability.name,
      authRequired: true,
      missingEvidence: capability.evidenceMatrix?.missingEvidence ?? [],
      reason: capability.activationBlockedReason ?? null,
    })),
  ];
  const browserBridge = authSummaryForReport(context.crawlContract, context.authStateReport).browserBridge;
  const providerCoverage = evidenceCoverageFromBundles(evidenceBundlesFromStageResults(stageResults));
  const runtimeCapabilities = {
    httpRuntimeCapabilities: capabilities.filter((capability) => capability.runtimeMode === HTTP_RUNTIME_MODE).length,
    browserBridgeRuntimeCapabilities: capabilities.filter((capability) => capability.runtimeMode === BRIDGE_RUNTIME_MODE).length,
    runtimeIneligibleCapabilities: capabilities.filter((capability) => (
      capability.status === 'active'
      && !capability.runtimeMode
    )).length,
    blockedChallengeOrRuntimeIneligible: blockedByAuth.length + capabilities.filter((capability) => (
      capability.status === 'active'
      && !capability.runtimeMode
      && ['authenticated', 'authenticated_overlay', 'public_rendered', 'authorized_source'].includes(nodeSourceLayer(capability))
    )).length,
  };
  return {
    crawlMode: context.crawlContract?.crawlMode ?? 'public_only',
    authMethod: context.crawlContract?.authMethod ?? context.authStateReport?.authMethod ?? 'none',
    authVerificationStatus: context.crawlContract?.authVerificationStatus ?? context.authStateReport?.authVerificationStatus ?? null,
    browserBridge,
    providers: providerCoverage.providers,
    evidenceProviders: providerCoverage,
    runtime: runtimeCapabilities,
    public: {
      pages: stageResults.crawlStatic?.summary?.publicPages
        ?? (stageResults.crawlStatic?.pages ?? []).filter((page) => pageSourceLayer(page) === 'public').length,
      nodes: publicNodes.length,
      capabilities: publicCrawlCapabilities.filter((capability) => capability.status === 'active').length,
    },
    publicRendered: {
      pages: stageResults.crawlRendered?.publicRenderedPages?.length ?? 0,
      nodes: publicRenderedNodes.length,
      capabilities: publicCapabilities
        .filter((capability) => capability.status === 'active' && capability.sourceLayer === 'public_rendered').length,
    },
    authorizedSource: {
      pages: stageResults.crawlStatic?.summary?.authorizedSourcePages ?? 0,
      nodes: authorizedSourceNodes.length,
      capabilities: publicCapabilities
        .filter((capability) => capability.status === 'active' && capability.sourceLayer === 'authorized_source').length,
    },
    authenticated: {
      pages: stageResults.crawlAuthenticated?.authenticatedPages?.length ?? 0,
      nodes: authNodes.length,
      capabilities: authCapabilities.filter((capability) => capability.status === 'active').length,
    },
    overlay: {
      pagesRevisited: stageResults.crawlAuthenticated?.authenticatedOverlayPages?.length ?? 0,
      newNodes: overlayNodes.length,
      newAffordances: (stageResults.extractAffordances?.affordances ?? [])
        .filter((affordance) => affordance.sourceLayer === 'authenticated_overlay').length,
    },
    requiresLoginButMissing,
    blockedByRisk,
    blockedByAuth,
  };
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
  const partialSuccessReasons = report.partial_success_reasons ?? buildPartialSuccessReasons({
    context,
    report,
    setupCollectionReview: report.setupCollectionReview,
    capabilityState: fullCapabilityState,
  });
  const resultStatus = report.result_status ?? resultStatusFromBuild({
    legacyStatus: report.status,
    context,
    report,
    setupCollectionReview: report.setupCollectionReview,
    capabilityState: fullCapabilityState,
  });
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
      medium: 'limited_enabled',
      high: 'disabled',
      critical: 'disabled',
      read_public_low: 'enabled',
      read_personal_medium: 'limited_enabled',
      read_private_high: 'disabled',
      write_low: 'draft_only',
      write_high: 'disabled',
      account_security_critical: 'disabled',
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

function summarizeStageRecords(stageRecords = /** @type {any} */ ({})) {
  return Object.fromEntries(Object.entries(stageRecords).map(([name, record]) => [name, {
    status: record.status ?? null,
    reasonCode: record.reasonCode ?? null,
    reasonCodes: record.reasonCodes ?? [],
    warnings: record.warnings ?? [],
    errors: record.errors ?? [],
    summary: record.summary ?? {},
  }]));
}

function sanitizedNetworkSummary(context, stageResults = /** @type {any} */ ({})) {
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

function buildRouteStateGraph(stageResults = /** @type {any} */ ({})) {
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

function buildDebugReport(context, stageResults, stageRecords, report, userReport) {
  return sanitizeReportPublicValue({
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-build-debug-report',
    result_status: userReport.result_status,
    legacy_status: report.status,
    build_id: report.buildId,
    site_id: report.siteId,
    skill_id: report.skillId,
    site_adapter: siteAdapterSummaryForReport(context, { includeSource: true }),
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

function buildReportIndex(report, userReport, debugReport) {
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

const CAPABILITY_INTENT_SUMMARY_HTML_RELATIVE_PATH = `reports/${CAPABILITY_INTENT_SUMMARY_HTML_FILE}`;
const PAGE_RECONCILIATION_REPORT_FILE = 'page_reconciliation_report.json';
const ACCESS_REMEDIATION_PLAN_FILE = 'access_remediation_plan.json';
const HTML_REPORT_MAX_EXAMPLES = 3;
const HTML_REPORT_FORBIDDEN_PATTERNS = Object.freeze([
  { code: 'authorization', pattern: /\bauthorization\b/iu },
  { code: 'bearer', pattern: /\bbearer\b/iu },
  { code: 'local-storage', pattern: /\blocalStorage\b/u },
  { code: 'session-storage', pattern: /\bsessionStorage\b/u },
  { code: 'user-data-dir', pattern: /\buserDataDir\b/u },
  { code: 'browser-profile', pattern: /\bbrowser profile\b/iu },
  { code: 'secret-fixture', pattern: /synthetic-secret/iu },
  { code: 'session-id', pattern: /sessionid\s*=/iu },
  { code: 'cookie-value', pattern: /\b(?:cookie|sid|uid|session|token)\s*=/iu },
  { code: 'script-tag', pattern: /<script\b/iu },
]);

function capabilityIntentSummaryHtmlPath(context) {
  return path.join(context.artifactDir, CAPABILITY_INTENT_SUMMARY_HTML_RELATIVE_PATH);
}

function sanitizeHtmlReportUrl(value) {
  const text = String(value ?? '');
  try {
    const parsed = new URL(text);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return text;
  }
}

function sanitizeHtmlReportString(value) {
  let text = sanitizeReportString(value);
  text = text.replace(/https?:\/\/[^\s<>"')]+/giu, (match) => sanitizeHtmlReportUrl(match));
  text = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu, '[REDACTED_AUTH]')
    .replace(/\bauthorization\s*[:=]\s*[^\r\n]+/giu, '[REDACTED_AUTH_HEADER]')
    .replace(/\bauthorization\b/giu, '[REDACTED_AUTH_HEADER]')
    .replace(/\bcookies?\s*[:=]\s*[^;\s&'",]+/giu, '[REDACTED_BROWSER_SESSION]')
    .replace(/\b(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|secret|password|session[_-]?id|sid)\s*[:=]\s*[^&\s;'",]+/giu, '[REDACTED_SECRET]')
    .replace(/\bBearer\b/giu, '[REDACTED_AUTH]')
    .replace(/\blocalStorage\b/gu, '[REDACTED_BROWSER_STORAGE]')
    .replace(/\bsessionStorage\b/gu, '[REDACTED_BROWSER_STORAGE]')
    .replace(/\buserDataDir\b/gu, '[REDACTED_BROWSER_STATE]')
    .replace(/\bbrowser\s+profile\b/giu, '[REDACTED_BROWSER_STATE]')
    .replace(/raw[-_\s]*(?:dom|html|body)/giu, '[REDACTED_PAGE_SOURCE]')
    .replace(/<\/?html(?:\s[^>]*)?>/giu, '[REDACTED_PAGE_SOURCE]');
  return text;
}

function sanitizeHtmlReportValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeHtmlReportValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/^(?:cookies?|headers?|authorization|token|tokens|profile|userDataDir|localStorage|sessionStorage)$/iu.test(key))
      .map(([key, item]) => [sanitizeHtmlReportString(key), sanitizeHtmlReportValue(item)]));
  }
  return typeof value === 'string' ? sanitizeHtmlReportString(value) : value;
}

function sanitizeCapabilityIntentHtmlPayload(payload) {
  return sanitizeHtmlReportValue(sanitizeReportPublicValue(payload));
}

function escapeHtml(value) {
  const text = value === null || value === undefined || value === '' ? '-' : sanitizeHtmlReportString(value);
  return String(text)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function htmlCell(value, { code = false } = /** @type {any} */ ({})) {
  const escaped = escapeHtml(value);
  return code ? `<code>${escaped}</code>` : escaped;
}

function htmlList(values = /** @type {any[]} */ ([]), { code = true, limit = 8 } = /** @type {any} */ ({})) {
  const items = Array.isArray(values) ? values.filter((item) => item !== null && item !== undefined && item !== '') : [];
  if (!items.length) {
    return '<span class="muted">-</span>';
  }
  const rendered = items.slice(0, limit).map((item) => (
    code ? `<code>${escapeHtml(item)}</code>` : `<span>${escapeHtml(item)}</span>`
  ));
  if (items.length > limit) {
    rendered.push(`<span class="muted">+${items.length - limit}</span>`);
  }
  return rendered.join(' ');
}

function htmlBadge(value, kind = 'muted') {
  const safeKind = /^[a-z0-9_-]+$/u.test(String(kind ?? '')) ? kind : 'muted';
  return `<span class="badge badge-${safeKind}">${escapeHtml(value ?? '-')}</span>`;
}

function htmlStatusBadge(value) {
  const status = normalizeStatusToken(value);
  if (['active', 'enabled', 'success', 'passed'].includes(status)) return htmlBadge(value, 'success');
  if (['limited_enabled'].includes(status)) return htmlBadge(value, 'limited');
  if (['confirmation_required', 'draft_only', 'candidate', 'candidate_debug_only', 'partial_success'].includes(status)) return htmlBadge(value, 'warning');
  if (['disabled', 'failed', 'blocked'].includes(status)) return htmlBadge(value, 'danger');
  return htmlBadge(value ?? '-', 'muted');
}

function htmlRiskBadge(value) {
  const risk = normalizeStatusToken(value);
  if (['write_high', 'account_security_critical', 'read_private_high'].includes(risk)) return htmlBadge(value, 'risk');
  if (['write_low', 'read_personal_medium'].includes(risk)) return htmlBadge(value, 'warning');
  if (['read_public_low'].includes(risk)) return htmlBadge(value, 'success');
  return htmlBadge(value ?? '-', 'muted');
}

function htmlAuthBadge(value) {
  return htmlBadge(value ?? '-', 'auth');
}

function capabilityHtmlGroup(capability = /** @type {any} */ ({})) {
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

function capabilityHtmlReason(capability = /** @type {any} */ ({})) {
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

function capabilityHtmlStrategy(capability = /** @type {any} */ ({})) {
  return capability.user_strategy
    ?? capability.strategy
    ?? capability.default_policy
    ?? capability.enabled_status
    ?? capability.status
    ?? '-';
}

function intentCallableLabel(intent = /** @type {any} */ ({}), capability = /** @type {any} */ ({})) {
  if (intent.callable === false || capability.status !== 'active') {
    return 'non-callable';
  }
  return 'callable';
}

function summarizeHtmlCoverage(context, stageResults, capabilities, userReport = null, report = null) {
  return userReport?.coverage
    ?? report?.summary?.coverage
    ?? buildCoverageReport(context, stageResults, capabilities);
}

function capabilitySourceNodesForHtml(capability = /** @type {any} */ ({}), graphNodeById = new Map()) {
  const ids = uniqueSortedStrings([
    ...(capability.entryNodeIds ?? []),
    ...(capability.requiredNodeIds ?? []),
  ]);
  return ids.map((id) => graphNodeById.get(id)).filter(Boolean);
}

function routeTemplatesForHtml(capability = /** @type {any} */ ({}), sourceNodes = /** @type {any[]} */ ([])) {
  return uniqueSortedStrings([
    capability.routeTemplate,
    capability.routePattern,
    ...(capability.executionPlan?.steps ?? []).map((step) => step.routeTemplate ?? step.routePath ?? null),
    ...sourceNodes.map((node) => node.instanceRouteTemplate ?? node.routeTemplate ?? node.routePattern ?? null),
  ].filter(Boolean)).slice(0, 8);
}

function categoryInstancesForHtml(capability = /** @type {any} */ ({}), sourceNodes = /** @type {any[]} */ ([])) {
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

function htmlCategoryInstanceLabel(instance = /** @type {any} */ ({})) {
  return [
    instance.kind ? `${instance.kind}:` : null,
    instance.label,
    instance.routeTemplate ? `(${instance.routeTemplate})` : null,
  ].filter(Boolean).join(' ');
}

function buildElementCoverageAuditRows(graph = /** @type {any} */ ({}), capabilityRows = /** @type {any[]} */ ([]), intentRows = /** @type {any[]} */ ([])) {
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

function elementCoverageAuditSummary(rows = /** @type {any[]} */ ([])) {
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

function buildCapabilityIntentHtmlPayload(context, stageResults, report, userReport) {
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
    htmlReport: relativeReportPath(context.cwd, report.artifacts?.[CAPABILITY_INTENT_SUMMARY_HTML_FILE] ?? capabilityIntentSummaryHtmlPath(context)),
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

function renderCapabilityRows(rows = /** @type {any[]} */ ([]), emptyMessage = 'No capabilities available.') {
  if (!rows.length) {
    return `<p class="empty">${escapeHtml(emptyMessage)}</p>`;
  }
  return `<div class="table-wrapper"><table>
    <thead><tr>
      <th>Capability</th><th>ID</th><th>Action</th><th>Element / category</th><th>Status</th><th>Risk</th><th>Auth</th><th>Evidence matrix</th><th>Reason / strategy</th><th>Intent count</th>
    </tr></thead>
    <tbody>
      ${rows.map((capability) => `<tr>
        <td><strong>${htmlCell(capability.name)}</strong><br><span class="muted">${htmlCell(capability.userValue ?? capability.userFacingName)}</span></td>
        <td>${htmlCell(capability.id, { code: true })}</td>
        <td>${htmlCell(capability.action)}<br><span class="muted">${htmlCell(capability.object)}</span></td>
        <td>
          <div class="matrix-line"><span>evidenceModel</span>${htmlCell(capability.evidenceModel ?? '-', { code: true })}</div>
          <div class="matrix-line"><span>element</span>${htmlCell([capability.elementRole, capability.elementLabel].filter(Boolean).join(': ') || '-')}</div>
          <div class="matrix-line"><span>routeTemplates</span>${htmlList(capability.routeTemplates ?? [], { code: true, limit: 4 })}</div>
          <div class="matrix-line"><span>categoryInstances</span>${htmlList((capability.categoryInstances ?? []).map(htmlCategoryInstanceLabel), { code: false, limit: 4 })}</div>
          <div class="matrix-line"><span>sourceNodes</span>${htmlList(capability.sourceNodeIds ?? [], { code: true, limit: 4 })}</div>
          ${capability.publicRouteOnly ? htmlBadge('route-only summary', 'limited') : ''}
        </td>
        <td>${htmlStatusBadge(capability.status)} ${htmlStatusBadge(capability.enabledStatus)}<br><span class="muted">${htmlCell(capability.evidenceStatus)}</span></td>
        <td>${htmlRiskBadge(capability.riskLevel)}<br><span class="muted">${htmlCell(capability.safetyLevel)}</span></td>
        <td>${htmlAuthBadge(capability.authRequired ? 'required' : 'public')}<br><code>${escapeHtml(capability.sourceLayer)}</code><br><span class="muted">${htmlCell(capability.requiredEvidenceLevel)} / ${htmlCell(capability.observedEvidenceLevel)}</span></td>
        <td><div class="matrix-line"><span>requiredEvidence</span>${htmlList(capability.evidenceMatrix?.requiredEvidence ?? [])}</div><div class="matrix-line"><span>observedEvidence</span>${htmlList(capability.evidenceMatrix?.observedEvidence ?? [])}</div><div class="matrix-line"><span>missingEvidence</span>${htmlList(capability.evidenceMatrix?.missingEvidence ?? [])}</div><div>${htmlStatusBadge(capability.activationDecision)}</div></td>
        <td>${htmlCell(capability.reason)}<br><span class="muted">${htmlCell(capability.strategy)}</span></td>
        <td>${htmlCell(capability.mappedIntentCount)}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

function renderIntentRows(rows = /** @type {any[]} */ ([])) {
  if (!rows.length) {
    return '<p class="empty">No intents are available; the build may have failed before intent generation.</p>';
  }
  return `<div class="table-wrapper"><table>
    <thead><tr>
      <th>Intent</th><th>Capability</th><th>Source</th><th>Callable</th><th>Examples</th><th>Negative examples</th><th>Reason</th>
    </tr></thead>
    <tbody>
      ${rows.map((intent) => `<tr>
        <td><strong>${htmlCell(intent.canonicalUtterance)}</strong><br>${htmlCell(intent.id, { code: true })}</td>
        <td>${htmlCell(intent.capabilityName)}<br>${htmlCell(intent.capabilityId, { code: true })}</td>
        <td>
          <div class="matrix-line"><span>intentSource</span>${htmlCell(intent.intentSource ?? '-', { code: true })}</div>
          <div class="matrix-line"><span>sourceNode</span>${htmlCell(intent.sourceNodeId ?? '-', { code: true })}</div>
          <div class="matrix-line"><span>sourceLayer</span>${htmlCell(intent.sourceLayer ?? '-', { code: true })}</div>
          <div class="matrix-line"><span>categoryInstance</span>${htmlCell(intent.categoryInstance ? htmlCategoryInstanceLabel(intent.categoryInstance) : '-')}</div>
        </td>
        <td>${htmlStatusBadge(intent.callable)}<br><span class="muted">${htmlCell(intent.safetyLevel)} / ${htmlCell(intent.enabledStatus)}</span></td>
        <td>${htmlList(intent.utteranceExamples, { code: false, limit: HTML_REPORT_MAX_EXAMPLES })}</td>
        <td>${htmlList(intent.negativeExamples, { code: false, limit: HTML_REPORT_MAX_EXAMPLES })}</td>
        <td>${htmlCell(intent.reason)}${intent.safeRemediation ? `<br><span class="muted">${htmlCell(JSON.stringify(intent.safeRemediation))}</span>` : ''}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

function renderMappingRows(rows = /** @type {any[]} */ ([])) {
  if (!rows.length) {
    return '<p class="empty">No capability-intent mappings are available.</p>';
  }
  return `<div class="table-wrapper"><table>
    <thead><tr>
      <th>Capability</th><th>Status</th><th>Intent count</th><th>Canonical utterances</th><th>Element / route</th><th>Callable</th><th>Risk</th><th>Auth status</th>
    </tr></thead>
    <tbody>
      ${rows.map((row) => `<tr>
        <td><strong>${htmlCell(row.capabilityName)}</strong><br>${htmlCell(row.capabilityId, { code: true })}</td>
        <td>${htmlStatusBadge(row.capabilityStatus)} ${htmlStatusBadge(row.enabledStatus)}</td>
        <td>${htmlCell(row.intentCount)}</td>
        <td>${htmlList(row.canonicalUtterances, { code: false, limit: 6 })}</td>
        <td>${htmlCell([row.elementRole, row.elementLabel].filter(Boolean).join(': ') || '-')}<br>${htmlList(row.routeTemplates ?? [], { code: true, limit: 4 })}<br>${htmlList((row.categoryInstances ?? []).map(htmlCategoryInstanceLabel), { code: false, limit: 4 })}</td>
        <td>${htmlStatusBadge(`${row.callable} callable`)} ${htmlStatusBadge(`${row.nonCallable} non-callable`)}</td>
        <td>${htmlRiskBadge(row.riskLevel)}</td>
        <td>${htmlAuthBadge(row.authVerificationStatus)}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

function renderBrowserBridgeRouteCoverage(coverage = /** @type {any} */ ({})) {
  const bridge = coverage.browserBridge ?? {};
  if (bridge.used !== true && Number(bridge.routeCount ?? 0) <= 0) {
    return '<p class="empty">本次没有使用默认浏览器 Bridge 路由采集。</p>';
  }
  const routeResults = Array.isArray(bridge.routeResults) ? bridge.routeResults : [];
  const missing = routeResults.filter((result) => !['captured', 'captured_with_warning'].includes(String(result?.status ?? '')));
  const displayedMissing = missing.slice(0, 40);
  const omittedMissingCount = Math.max(0, missing.length - displayedMissing.length);
  const notes = [
    `默认浏览器 Bridge 最终采集 ${bridge.capturedRouteCount ?? 0}/${bridge.routeCount ?? 0} 条配置路由。`,
    `系统已自动温和重试 ${bridge.retryAttemptedRouteCount ?? 0} 条路由，重试后新增采集 ${bridge.retryCapturedRouteCount ?? 0} 条。`,
    '未采集路由只进入覆盖缺口和 route_capture_plan.json，不生成能力或意图，不声明全覆盖。',
    '系统不会绕过 robots、验证码、MFA、JS challenge、登录墙或访问控制。',
    omittedMissingCount > 0
      ? `This HTML table shows the first ${displayedMissing.length} missing routes; the full ${missing.length} route gap list is in route_capture_plan.json.`
      : null,
  ].filter(Boolean);
  const rows = [
    ['routeCoverageStatus', bridge.routeCoverageStatus ?? '-'],
    ['retryStatus', bridge.retryStatus ?? '-'],
    ['retryPasses', bridge.retryPasses ?? 0],
    ['routeQueueLimit', bridge.routeQueueLimit ?? 0],
    ['scheduledRouteCount', bridge.scheduledRouteCount ?? 0],
    ['overflowRouteCount', bridge.overflowRouteCount ?? 0],
    ['unattemptedRouteCount', bridge.unattemptedRouteCount ?? 0],
    ['routeQueueTruncated', bridge.routeQueueTruncated === true ? 'true' : 'false'],
    ['initialCapturedRouteCount', bridge.initialCapturedRouteCount ?? 0],
    ['finalCapturedRouteCount', bridge.finalCapturedRouteCount ?? bridge.capturedRouteCount ?? 0],
    ['finalMissingRouteCount', bridge.finalMissingRouteCount ?? bridge.missingRouteCount ?? 0],
  ];
  const missingTable = missing.length
    ? `<h3>未采集路由</h3><div class="table-wrapper"><table>
      <thead><tr><th>Route</th><th>Layer</th><th>Initial</th><th>Final</th><th>Reason</th><th>Retry</th></tr></thead>
      <tbody>${displayedMissing.map((route) => `<tr>
        <td>${htmlCell(route.targetRoute ?? route.routeId ?? '-', { code: true })}</td>
        <td>${htmlCell(route.sourceLayer ?? '-', { code: true })}</td>
        <td>${htmlStatusBadge(route.initialStatus ?? route.status ?? '-')}</td>
        <td>${htmlStatusBadge(route.finalStatus ?? route.status ?? '-')}</td>
        <td>${htmlCell(route.finalReasonCode ?? route.reasonCode ?? '-')}</td>
        <td>${htmlCell(`${route.retryAttemptCount ?? 0} / ${route.retryOutcome ?? 'not_attempted'}`)}</td>
      </tr>`).join('')}</tbody>
    </table></div>${omittedMissingCount > 0 ? `<p class="muted">Only the first ${displayedMissing.length} missing routes are shown here; ${omittedMissingCount} more are listed in <code>route_capture_plan.json</code>.</p>` : ''}`
    : '<p class="empty">没有未采集的 Browser Bridge 路由。</p>';
  return `
    <div class="summary-row">
      ${htmlBadge(`captured ${bridge.capturedRouteCount ?? 0}/${bridge.routeCount ?? 0}`, bridge.missingRouteCount ? 'warning' : 'success')}
      ${htmlBadge(`retry ${bridge.retryStatus ?? 'not_attempted'}`, bridge.retryCapturedRouteCount ? 'limited' : 'muted')}
      ${htmlBadge(`missing ${bridge.missingRouteCount ?? 0}`, bridge.missingRouteCount ? 'warning' : 'success')}
      ${Number(bridge.unattemptedRouteCount ?? 0) > 0 ? htmlBadge(`unattempted ${bridge.unattemptedRouteCount}`, 'warning') : ''}
    </div>
    <div class="notice-list">
      ${notes.map((note) => `<div class="notice"><p>${htmlCell(note)}</p></div>`).join('')}
    </div>
    <div class="table-wrapper compact"><table>
      <thead><tr><th>Metric</th><th>Value</th></tr></thead>
      <tbody>${rows.map(([metric, value]) => `<tr><td>${htmlCell(metric)}</td><td>${htmlCell(value)}</td></tr>`).join('')}</tbody>
    </table></div>
    ${missingTable}`;
}

function renderCoverageTable(coverage = /** @type {any} */ ({})) {
  const rows = [
    ['public pages', coverage.public?.pages ?? 0],
    ['public nodes', coverage.public?.nodes ?? 0],
    ['public capabilities', coverage.public?.capabilities ?? 0],
    ['public rendered pages', coverage.publicRendered?.pages ?? 0],
    ['public rendered nodes', coverage.publicRendered?.nodes ?? 0],
    ['public rendered capabilities', coverage.publicRendered?.capabilities ?? 0],
    ['authenticated pages', coverage.authenticated?.pages ?? 0],
    ['authenticated nodes', coverage.authenticated?.nodes ?? 0],
    ['authenticated capabilities', coverage.authenticated?.capabilities ?? 0],
    ['browser bridge routes', coverage.browserBridge?.routeCount ?? 0],
    ['browser bridge captured routes', coverage.browserBridge?.capturedRouteCount ?? 0],
    ['browser bridge missing routes', coverage.browserBridge?.missingRouteCount ?? 0],
    ['browser bridge route queue limit', coverage.browserBridge?.routeQueueLimit ?? 0],
    ['browser bridge scheduled routes', coverage.browserBridge?.scheduledRouteCount ?? 0],
    ['browser bridge overflow routes', coverage.browserBridge?.overflowRouteCount ?? 0],
    ['browser bridge unattempted routes', coverage.browserBridge?.unattemptedRouteCount ?? 0],
    ['browser bridge route queue truncated', coverage.browserBridge?.routeQueueTruncated === true ? 'true' : 'false'],
    ['browser bridge route coverage status', coverage.browserBridge?.routeCoverageStatus ?? '-'],
    ['browser bridge retry status', coverage.browserBridge?.retryStatus ?? '-'],
    ['browser bridge retry passes', coverage.browserBridge?.retryPasses ?? 0],
    ['browser bridge retry attempted routes', coverage.browserBridge?.retryAttemptedRouteCount ?? 0],
    ['browser bridge retry captured routes', coverage.browserBridge?.retryCapturedRouteCount ?? 0],
    ['overlay pages revisited', coverage.overlay?.pagesRevisited ?? 0],
    ['overlay new nodes', coverage.overlay?.newNodes ?? 0],
    ['overlay new affordances', coverage.overlay?.newAffordances ?? 0],
    ['requires-login candidates', coverage.requiresLoginButMissing?.length ?? 0],
    ['blocked by risk', coverage.blockedByRisk?.length ?? 0],
    ['blocked by auth', coverage.blockedByAuth?.length ?? 0],
  ];
  return `<div class="table-wrapper compact"><table>
    <thead><tr><th>Metric</th><th>Value</th></tr></thead>
    <tbody>${rows.map(([metric, value]) => `<tr><td>${htmlCell(metric)}</td><td>${htmlCell(value)}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

function renderProviderCoverageTable(coverage = /** @type {any} */ ({})) {
  const providers = Object.entries(coverage.providers ?? {});
  if (!providers.length) {
    return '<p class="empty">No normalized evidence provider bundles were recorded.</p>';
  }
  return `<div class="table-wrapper compact"><table>
    <thead><tr><th>Provider</th><th>Status</th><th>Pages</th><th>Routes</th><th>Captured</th><th>Missing</th><th>Source layer</th><th>Auth</th><th>Runtime</th></tr></thead>
    <tbody>${providers.map(([providerId, row]) => `<tr>
      <td>${htmlCell(providerId, { code: true })}</td>
      <td>${htmlStatusBadge(row.status ?? '-')}</td>
      <td>${htmlCell(row.pages ?? 0)}</td>
      <td>${htmlCell(row.routeResults ?? 0)}</td>
      <td>${htmlCell(row.capturedRouteCount ?? 0)}</td>
      <td>${htmlCell(row.missingRouteCount ?? 0)}</td>
      <td>${htmlCell(row.sourceLayer ?? '-', { code: true })}</td>
      <td>${htmlCell(row.authMethod ?? '-', { code: true })}</td>
      <td>${htmlCell(row.runtimeMode ?? '-', { code: true })}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function renderElementCoverageAudit(elementCoverage = /** @type {any} */ ({})) {
  const rows = elementCoverage.rows ?? [];
  const summary = elementCoverage.summary ?? {};
  if (!rows.length) {
    return '<p class="empty">No sanitized page element instances were available for coverage auditing.</p>';
  }
  return `
    <div class="summary-row">
      ${htmlBadge(`total ${summary.total ?? rows.length}`, 'muted')}
      ${htmlBadge(`covered ${summary.covered ?? 0}`, 'success')}
      ${htmlBadge(`graph-only ${summary.graphIntentOnly ?? 0}`, 'limited')}
      ${htmlBadge(`missing capability ${summary.missingCapability ?? 0}`, (summary.missingCapability ?? 0) ? 'warning' : 'success')}
      ${htmlBadge(`missing intent ${summary.missingIntent ?? 0}`, (summary.missingIntent ?? 0) ? 'warning' : 'success')}
    </div>
    <div class="table-wrapper"><table>
      <thead><tr>
        <th>Element</th><th>Source</th><th>Category instance</th><th>Coverage status</th><th>Mapped capabilities</th><th>Mapped intents</th>
      </tr></thead>
      <tbody>
        ${rows.map((row) => `<tr>
          <td><strong>${htmlCell([row.elementRole, row.elementLabel].filter(Boolean).join(': ') || '-')}</strong><br>${htmlCell(row.routeTemplate, { code: true })}</td>
          <td>${htmlCell(row.sourceLayer, { code: true })}<br>${htmlCell(row.nodeId, { code: true })}<br><span class="muted">${htmlCell(row.evidenceStatus)}</span></td>
          <td>${htmlCell(row.categoryInstance ? htmlCategoryInstanceLabel(row.categoryInstance) : '-')}</td>
          <td>${htmlStatusBadge(row.status)}</td>
          <td>${htmlList(row.mappedCapabilityNames?.length ? row.mappedCapabilityNames : row.mappedCapabilityIds, { code: false, limit: 5 })}</td>
          <td>${htmlList(row.mappedIntentIds ?? [], { code: true, limit: 5 })}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
}

function renderBlockedList(payload) {
  const blocked = payload.blocked ?? {};
  const items = [
    ...(blocked.requiresLogin ?? []).map((item) => ({
      title: item.name ?? item.id,
      text: 'This capability requires authenticated structural evidence. It remains a candidate because login was not used or not verified.',
    })),
    ...(blocked.disabledHighRisk ?? []).map((item) => ({
      title: item.name ?? item.id,
      text: 'This capability involves write actions, account changes, or high-sensitivity reads. It is disabled by default and will not auto-execute.',
    })),
    ...(blocked.missingEvidence ?? []).map((item) => ({
      title: item.name ?? item.id,
      text: 'The evidence matrix still has gaps, so this is not a callable capability.',
    })),
    ...(blocked.candidateOnly ?? []).map((item) => ({
      title: item.name ?? item.id,
      text: 'This capability is shown only as a candidate or debug summary and was not promoted into a callable Skill.',
    })),
  ];
  if (!items.length) {
    return '<p class="empty">No risk blocks or missing-evidence items were reported.</p>';
  }
  return `<div class="notice-list">${items.slice(0, 40).map((item) => `<div class="notice">
    <strong>${htmlCell(item.title)}</strong>
    <p>${htmlCell(item.text)}</p>
  </div>`).join('')}</div>`;
}

export function renderCapabilityIntentSummaryHtml(payload, options = /** @type {any} */ ({})) {
  const safe = sanitizeCapabilityIntentHtmlPayload(payload);
  const grouped = new Map();
  for (const capability of safe.capabilities ?? []) {
    const group = capability.group ?? 'unknown';
    grouped.set(group, [...(grouped.get(group) ?? []), capability]);
  }
  const groupOrder = [
    ['enabled', 'enabled'],
    ['limited_enabled', 'limited_enabled'],
    ['confirmation_required', 'confirmation_required'],
    ['draft_only', 'draft_only'],
    ['candidate', 'candidate'],
    ['disabled', 'disabled'],
    ['candidate_debug_only', 'debug_only / candidate_debug_only'],
    ['debug_only', 'debug_only'],
    ['unknown', 'other'],
  ];
  const meta = safe.meta ?? {};
  const capabilities = safe.capabilities ?? [];
  const intents = safe.intents ?? [];
  const noCapabilityIntent = capabilities.length === 0 && intents.length === 0;
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(meta.title ?? 'SiteForge Build Summary')}</title>
  <style>
    :root {
      --bg: #f6f8fb;
      --panel: #ffffff;
      --text: #182230;
      --muted: #667085;
      --border: #d9e2ec;
      --shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
      --success: #0f766e;
      --limited: #2563eb;
      --warning: #b45309;
      --danger: #b91c1c;
      --auth: #6d28d9;
      --risk: #be123c;
      --code-bg: #eef2f7;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font: 14px/1.55 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: var(--bg); }
    header { background: linear-gradient(135deg, #111827, #1f3a5f); color: #fff; padding: 28px 20px; }
    .container { max-width: 1180px; margin: 0 auto; padding: 0 20px 32px; }
    header .container { padding-bottom: 0; }
    h1 { margin: 0 0 6px; font-size: 30px; letter-spacing: 0; }
    h2 { margin: 0 0 14px; font-size: 20px; letter-spacing: 0; }
    h3 { margin: 20px 0 10px; font-size: 16px; letter-spacing: 0; }
    .subtitle { margin: 0; color: rgba(255,255,255,0.78); }
    nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 0; }
    nav a { color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,0.28); border-radius: 8px; padding: 6px 10px; }
    section { margin-top: 22px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--shadow); padding: 18px; }
    section > h2 { position: sticky; top: 0; background: var(--panel); padding: 4px 0 10px; z-index: 1; }
    .summary-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-top: 18px; }
    .summary-card { background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.22); border-radius: 8px; padding: 12px; }
    .summary-card span { display: block; color: rgba(255,255,255,0.72); font-size: 12px; }
    .summary-card strong { display: block; margin-top: 4px; font-size: 18px; word-break: break-word; }
    .meta-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .meta-item { border: 1px solid var(--border); border-radius: 8px; padding: 10px; background: #fbfdff; }
    .meta-item span { display: block; color: var(--muted); font-size: 12px; }
    .badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 8px; margin: 1px 2px 1px 0; font-size: 12px; font-weight: 650; background: #eef2f7; color: #344054; }
    .badge-success { background: #ccfbf1; color: var(--success); }
    .badge-limited { background: #dbeafe; color: var(--limited); }
    .badge-warning { background: #fef3c7; color: var(--warning); }
    .badge-danger { background: #fee2e2; color: var(--danger); }
    .badge-muted { background: #eef2f7; color: #475467; }
    .badge-auth { background: #ede9fe; color: var(--auth); }
    .badge-risk { background: #ffe4e6; color: var(--risk); }
    .table-wrapper { width: 100%; overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
    .table-wrapper.compact { max-width: 720px; }
    table { width: 100%; border-collapse: collapse; min-width: 900px; background: #fff; }
    th, td { text-align: left; vertical-align: top; border-bottom: 1px solid var(--border); padding: 10px; word-break: break-word; }
    th { background: #f2f6fb; color: #344054; font-size: 12px; text-transform: uppercase; letter-spacing: 0; }
    tbody tr:nth-child(even) { background: #fbfdff; }
    tbody tr:hover { background: #f8fafc; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; background: var(--code-bg); border-radius: 4px; padding: 1px 4px; }
    .muted { color: var(--muted); }
    .empty { color: var(--muted); margin: 8px 0; }
    .matrix-line { margin: 2px 0; }
    .matrix-line > span:first-child { display: inline-block; min-width: 64px; color: var(--muted); }
    .summary-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 12px; }
    .notice-list { display: grid; gap: 10px; }
    .notice { border: 1px solid var(--border); border-left: 4px solid var(--warning); border-radius: 8px; padding: 10px 12px; background: #fffdf7; }
    .notice p { margin: 4px 0 0; color: var(--muted); }
    @media (max-width: 860px) {
      .summary-grid, .meta-grid { grid-template-columns: 1fr; }
      header { padding: 22px 0; }
      .container { padding-left: 12px; padding-right: 12px; }
      section { padding: 14px; }
      h1 { font-size: 24px; }
    }
    @media print {
      body { background: #fff; }
      header { background: #fff; color: #000; border-bottom: 1px solid #ccc; }
      nav { display: none; }
      section { box-shadow: none; break-inside: avoid; }
      .summary-card { color: #000; border-color: #ccc; }
      .summary-card span { color: #444; }
    }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <h1>${escapeHtml(meta.title ?? 'SiteForge Build Summary')}</h1>
      <p class="subtitle">${escapeHtml(meta.siteUrl)} 路 ${escapeHtml(meta.buildId)}</p>
      <nav>
        <a href="#overview">Overview</a>
        <a href="#coverage">Coverage</a>
        <a href="#evidence-providers">Evidence providers</a>
        <a href="#browser-bridge-route-coverage">Browser Bridge route coverage</a>
        <a href="#element-coverage">Element coverage</a>
        <a href="#capabilities">Capabilities</a>
        <a href="#intents">Intents</a>
        <a href="#mapping">Mapping</a>
        <a href="#blocked">Risk and gaps</a>
      </nav>
      <div class="summary-grid">
        <div class="summary-card"><span>result_status</span><strong>${escapeHtml(meta.resultStatus)}</strong></div>
        <div class="summary-card"><span>capabilities</span><strong>${escapeHtml(safe.counts?.capabilities ?? 0)}</strong></div>
        <div class="summary-card"><span>intents</span><strong>${escapeHtml(safe.counts?.intents ?? 0)}</strong></div>
        <div class="summary-card"><span>auth verification status</span><strong>${escapeHtml(meta.authVerificationStatus)}</strong></div>
        <div class="summary-card"><span>risk blocked</span><strong>${escapeHtml(safe.counts?.riskBlocked ?? 0)}</strong></div>
      </div>
    </div>
  </header>
  <main class="container">
    <section id="overview">
      <h2>构建概览</h2>
      <div class="meta-grid">
        ${[
          ['站点 URL', meta.siteUrl],
          ['siteId', meta.siteId],
          ['buildId', meta.buildId],
          ['skillId', meta.skillId],
          ['crawlMode', meta.crawlMode],
          ['authMethod', meta.authMethod],
          ['authVerificationStatus', meta.authVerificationStatus],
          ['result_status', meta.resultStatus],
          ['legacy_status', meta.legacyStatus],
          ['verification status', meta.verificationStatus],
          ['promotionClass', meta.promotionClass],
          ['runtimeMode', meta.runtimeMode],
          ['coverageStatus', meta.coverageStatus],
          ['generatedAt', meta.generatedAt],
          ['completedAt', meta.completedAt],
          ['user report', meta.paths?.userReport],
          ['debug report', meta.paths?.debugReport],
          ['index report', meta.paths?.indexReport],
          ['HTML report', meta.paths?.htmlReport],
        ].map(([label, value]) => `<div class="meta-item"><span>${escapeHtml(label)}</span><strong>${htmlCell(value)}</strong></div>`).join('')}
      </div>
    </section>
    <section id="coverage">
      <h2>覆盖率概览</h2>
      ${renderCoverageTable(safe.coverage ?? {})}
    </section>
    <section id="evidence-providers">
      <h2>Evidence Providers</h2>
      ${renderProviderCoverageTable(safe.coverage ?? {})}
    </section>
    <section id="browser-bridge-route-coverage">
      <h2>Browser Bridge Route Coverage</h2>
      ${renderBrowserBridgeRouteCoverage(safe.coverage ?? {})}
    </section>
    <section id="element-coverage">
      <h2>页面元素覆盖审计</h2>
      <p class="muted">逐项列出已保存的脱敏页面元素摘要，并标记是否已经映射为能力和意图。</p>
      ${renderElementCoverageAudit(safe.elementCoverage ?? {})}
    </section>
    <section id="capabilities">
      <h2>能力汇总</h2>
      ${noCapabilityIntent ? '<p class="empty">暂无能力和意图，构建在上游阶段失败。</p>' : ''}
      ${groupOrder.map(([group, label]) => {
        const rows = grouped.get(group) ?? [];
        if (!rows.length) return '';
        return `<h3>${escapeHtml(label)} (${rows.length})</h3>${renderCapabilityRows(rows)}`;
      }).join('')}
    </section>
    <section id="intents">
      <h2>意图汇总</h2>
      ${renderIntentRows(intents)}
    </section>
    <section id="mapping">
      <h2>Capability -> Intents</h2>
      ${renderMappingRows(safe.mappings ?? [])}
    </section>
    <section id="blocked">
      <h2>风险与阻断说明</h2>
      <p class="muted">本页只展示脱敏结构摘要。涉及写入、账号变更或证据不足的能力不会自动执行。</p>
      ${renderBlockedList(safe)}
    </section>
  </main>
</body>
</html>`;
  assertCapabilityIntentHtmlSafe(html, options);
  return html;
}

function assertCapabilityIntentHtmlSafe(html, options = /** @type {any} */ ({})) {
  if (options.skipSafetyScan === true) {
    return;
  }
  for (const { code, pattern } of HTML_REPORT_FORBIDDEN_PATTERNS) {
    if (pattern.test(html)) {
      const error = /** @type {Error & Record<string, any>} */ (new Error(`capability-intent-html-report-unsafe: forbidden pattern ${code}`));
      error.code = 'capability-intent-html-report-unsafe';
      error.reasonCode = code;
      throw error;
    }
  }
}

async function writeCapabilityIntentHtmlReport(context, stageResults, report, userReport) {
  const payload = buildCapabilityIntentHtmlPayload(context, stageResults, report, userReport);
  const html = renderCapabilityIntentSummaryHtml(payload);
  return await writeArtifactText(context, CAPABILITY_INTENT_SUMMARY_HTML_RELATIVE_PATH, html);
}

function reconciliationRouteKey(urlValue, rootUrl = null) {
  try {
    const normalized = rootUrl ? normalizeUrl(urlValue, rootUrl) : normalizeUrl(urlValue);
    const parsed = new URL(normalized);
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/$/u, '');
  } catch {
    return String(urlValue ?? '').trim().replace(/[?#].*$/u, '').replace(/\/$/u, '');
  }
}

function reconciliationLinkUrl(link) {
  return link?.normalizedHref ?? link?.normalizedUrl ?? link?.href ?? link?.url ?? null;
}

function reconciliationLinkLabel(link) {
  return String(link?.text ?? link?.label ?? link?.title ?? '').trim();
}

function isReconciliationCategoryLink(link) {
  const url = String(reconciliationLinkUrl(link) ?? '');
  const label = reconciliationLinkLabel(link);
  const kind = String(link?.kind ?? link?.semanticKind ?? link?.structureType ?? '').toLowerCase();
  const haystack = `${url} ${label} ${kind}`.toLowerCase();
  return /category|categories|genre|genres|channel|channels|section|sections|classify|\bcat\b|分类|类目|類別|频道|頻道|分区|标签|榜单/u.test(haystack);
}

function isChallengeLikePage(page) {
  const text = [
    page?.title,
    page?.pageType,
    page?.publicEvidenceStatus,
    page?.blockerCategory,
    page?.diagnostics?.publicEvidenceStatus,
    page?.diagnostics?.blockerCategory,
    ...(Array.isArray(page?.diagnostics?.warnings) ? page.diagnostics.warnings : []),
  ].join(' ');
  return /验证码|验证|风控|安全校验|中间页|captcha|challenge|turnstile|verify|checkpoint|cf-mitigated|cdn-cgi\/challenge-platform|cloudflare/iu.test(text);
}

function classifyPageReconciliationOutcome(reasonCodes = /** @type {string[]} */ ([]), challengePages = /** @type {any[]} */ ([])) {
  const codes = new Set(reasonCodes);
  if (codes.has('challenge_or_probe_detected')) {
    const challengeText = challengePages.map((page) => `${page.url ?? ''} ${page.title ?? ''}`).join(' ');
    const primaryReasonCode = /cloudflare|cf-mitigated|cdn-cgi\/challenge-platform/iu.test(challengeText)
      ? 'blocked-by-cloudflare-challenge'
      : 'anti-crawl-verify';
    return {
      status: 'blocked',
      blockerClass: 'external_challenge',
      primaryReasonCode,
      retryDisposition: 'blocked_no_bypass',
    };
  }
  const internalMissingCodes = [
    'category_links_missing_from_graph',
    'category_capability_missing',
    'category_intent_missing',
  ];
  if (internalMissingCodes.some((code) => codes.has(code))) {
    return {
      status: 'failed',
      blockerClass: 'internal_missing',
      primaryReasonCode: 'page-reconciliation-failed',
      retryDisposition: 'retryable_internal',
    };
  }
  if (reasonCodes.length) {
    return {
      status: 'warning',
      blockerClass: 'none',
      primaryReasonCode: null,
      retryDisposition: 'no_retry',
    };
  }
  return {
    status: 'passed',
    blockerClass: 'none',
    primaryReasonCode: null,
    retryDisposition: 'no_retry',
  };
}

function reconciliationGraphUrlSet(graph, context) {
  const urls = new Set();
  for (const node of graph?.nodes ?? []) {
    const urlValue = node.normalizedUrl ?? node.url ?? null;
    if (urlValue) {
      urls.add(reconciliationRouteKey(urlValue, context.site.rootUrl));
    }
    const route = node.routePattern ?? node.routeTemplate ?? null;
    if (route && String(route).startsWith('/')) {
      urls.add(reconciliationRouteKey(route, context.site.rootUrl));
    }
  }
  return urls;
}

function hasChineseText(value) {
  return /[\u3400-\u9fff]/u.test(String(value ?? ''));
}

const PAGE_RECONCILIATION_CATEGORY_TEXT_PATTERN = /categor|category|categories|channel|genre|tag|topic|section|navigation|collections?|lists?|rankings?|classif|book_categories|catalog categories|\u5206\u7c7b|\u6807\u7b7e|\u9891\u9053|\u985e\u5225|\u983b\u9053/iu;

function buildPageReconciliationReport(context, stageResults, report = /** @type {any} */ ({})) {
  const staticPages = stageResults.crawlStatic?.pages ?? [];
  const renderedPages = stageResults.crawlRendered?.publicRenderedPages ?? stageResults.crawlRendered?.pages ?? [];
  const authPages = stageResults.crawlAuthenticated?.authenticatedPages ?? [];
  const overlayPages = stageResults.crawlAuthenticated?.authenticatedOverlayPages ?? [];
  const allPages = [...staticPages, ...renderedPages, ...authPages, ...overlayPages];
  const challengePages = allPages.filter(isChallengeLikePage).map((page) => ({
    url: sanitizeEvidenceRef(page.normalizedUrl ?? page.url ?? page.sourcePath ?? context.site.rootUrl) ?? null,
    title: sanitizedStructureText(page.title ?? page.pageType ?? 'challenge-like-page', 80, 'challenge-like-page'),
    sourceLayer: page.sourceLayer ?? null,
    reasonCode: 'challenge_or_probe_detected',
  }));
  const expectedCategoryLinks = [];
  const seenCategoryKeys = new Set();
  const addExpectedCategoryLink = (urlValue, labelValue = '-') => {
    if (!urlValue) {
      return;
    }
    const key = reconciliationRouteKey(urlValue, context.site.rootUrl);
    if (seenCategoryKeys.has(key)) {
      return;
    }
    seenCategoryKeys.add(key);
    expectedCategoryLinks.push({
      url: sanitizeEvidenceRef(urlValue) ?? null,
      routeKey: key,
      label: sanitizedStructureText(labelValue, 80, '-'),
    });
  };
  for (const page of allPages) {
    const pageUrl = page.normalizedUrl ?? page.url ?? null;
    const pageLabel = page.pageType ?? page.routeTemplate ?? page.title ?? '-';
    if (pageUrl && isReconciliationCategoryLink({ href: pageUrl, label: pageLabel, kind: page.pageType })) {
      addExpectedCategoryLink(pageUrl, pageLabel);
    }
    for (const link of page.links ?? []) {
      const urlValue = reconciliationLinkUrl(link);
      if (!urlValue || !isReconciliationCategoryLink(link)) {
        continue;
      }
      addExpectedCategoryLink(urlValue, reconciliationLinkLabel(link));
    }
  }
  const graph = stageResults.classifyNodes?.graph ?? stageResults.buildSiteGraph?.graph ?? null;
  const graphUrls = reconciliationGraphUrlSet(graph, context);
  const missingCategoryLinks = expectedCategoryLinks
    .filter((link) => !graphUrls.has(link.routeKey))
    .map(({ routeKey, ...link }) => link);
  const capabilities = stageResults.discoverCapabilities?.capabilities ?? [];
  const intents = stageResults.generateIntents?.intents ?? [];
  const categoryCapabilityRecords = capabilities.filter((capability) => PAGE_RECONCILIATION_CATEGORY_TEXT_PATTERN.test([
    capability.name,
    capability.user_facing_name,
    capability.userFacingName,
    capability.userValue,
    capability.object,
    capability.category,
  ].join(' ')));
  const categoryCapabilityIds = new Set(categoryCapabilityRecords
    .map((capability) => capability.id ?? capability.capabilityId)
    .filter(Boolean));
  const categoryCapabilities = categoryCapabilityRecords.map((capability) => ({
    id: capability.id ?? capability.capabilityId ?? null,
    name: sanitizedStructureText(capability.user_facing_name ?? capability.userFacingName ?? capability.userValue ?? capability.name, 100, '-'),
    status: capability.status ?? null,
    enabled_status: capability.enabled_status ?? capability.enabledStatus ?? null,
    hasChineseName: hasChineseText(capability.user_facing_name ?? capability.userFacingName ?? capability.userValue ?? capability.name),
  }));
  const categoryIntentRows = intents.filter((intent) => (
    categoryCapabilityIds.has(intent.capabilityId ?? intent.capability_id)
    || PAGE_RECONCILIATION_CATEGORY_TEXT_PATTERN.test([
      intent.canonicalUtterance,
      intent.canonical_utterance,
      intent.capabilityName,
      intent.capabilityId,
    ].join(' '))
  )).map((intent) => ({
    id: intent.intentId ?? intent.id ?? null,
    capabilityId: intent.capabilityId ?? intent.capability_id ?? null,
    canonicalUtterance: sanitizedStructureText(intent.canonicalUtterance ?? intent.canonical_utterance, 100, '-'),
    callable: intent.callable === true,
    hasChineseUtterance: hasChineseText(intent.canonicalUtterance ?? intent.canonical_utterance),
  }));
  const reasonCodes = [];
  if (challengePages.length) reasonCodes.push('challenge_or_probe_detected');
  if (expectedCategoryLinks.length && missingCategoryLinks.length) reasonCodes.push('category_links_missing_from_graph');
  if (expectedCategoryLinks.length && !categoryCapabilities.length) reasonCodes.push('category_capability_missing');
  if (expectedCategoryLinks.length && categoryCapabilities.length && !categoryIntentRows.length) reasonCodes.push('category_intent_missing');
  if (categoryCapabilities.length && !categoryCapabilities.some((capability) => capability.hasChineseName)) reasonCodes.push('category_capability_missing_chinese_name');
  if (categoryIntentRows.length && !categoryIntentRows.some((intent) => intent.hasChineseUtterance)) reasonCodes.push('category_intent_missing_chinese_utterance');
  if (challengePages.length && !expectedCategoryLinks.length && !categoryCapabilities.length) reasonCodes.push('category_links_not_observed');
  const outcome = classifyPageReconciliationOutcome(reasonCodes, challengePages);
  const { status } = outcome;
  const summary = {
    status,
    blockerClass: outcome.blockerClass,
    primaryReasonCode: outcome.primaryReasonCode,
    retryDisposition: outcome.retryDisposition,
    challengeLikePages: challengePages.length,
    expectedCategoryLinks: expectedCategoryLinks.length,
    missingCategoryLinks: missingCategoryLinks.length,
    categoryCapabilities: categoryCapabilities.length,
    categoryIntents: categoryIntentRows.length,
    reasonCodes: uniqueSortedStrings(reasonCodes),
    needsRerun: outcome.retryDisposition === 'retryable_internal',
    rerunBlocked: outcome.status === 'blocked',
  };
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-page-reconciliation-report',
    buildId: context.buildId,
    siteId: context.site.id,
    inputUrl: sanitizeEvidenceRef(context.inputUrl ?? context.site.rootUrl) ?? null,
    status,
    resultStatus: report.result_status ?? report.status ?? null,
    summary,
    challengePages,
    expectedCategoryLinks: expectedCategoryLinks.map(({ routeKey, ...link }) => link),
    missingCategoryLinks,
    categoryCapabilities,
    categoryIntents: categoryIntentRows,
    safety: {
      rawHtmlPersisted: false,
      bodyTextPersisted: false,
      cookiePersisted: false,
      tokenPersisted: false,
      browserProfilePersisted: false,
    },
  };
}

async function writePageReconciliationReport(context, stageResults, report) {
  const reconciliation = buildPageReconciliationReport(context, stageResults, report);
  const write = await writeRedactedArtifactJson(context, PAGE_RECONCILIATION_REPORT_FILE, reconciliation);
  return write;
}

function shouldWriteAccessRemediationPlan(pageReconciliation = /** @type {any} */ ({})) {
  const summary = pageReconciliation.summary ?? pageReconciliation ?? {};
  const reasonText = [
    summary.primaryReasonCode,
    summary.blockerClass,
    summary.retryDisposition,
    ...(summary.reasonCodes ?? []),
  ].join(' ');
  return summary.retryDisposition === 'blocked_no_bypass'
    || /robots|challenge|anti-crawl|verify|external_challenge/iu.test(reasonText);
}

function buildAccessRemediationPlan(context, stageResults, pageReconciliation = /** @type {any} */ ({})) {
  const summary = pageReconciliation.summary ?? pageReconciliation ?? {};
  const capabilities = stageResults.discoverCapabilities?.capabilities ?? [];
  const routeOnlyCapabilities = capabilities
    .filter((capability) => capability.status === 'active' && (
      capability.publicRouteOnly === true
      || capability.evidenceModel === 'authenticated_route_only'
      || capability.evidenceModel === 'public_route_navigation'
    ))
    .slice(0, 20)
    .map((capability) => ({
      id: capability.id ?? capability.capabilityId ?? null,
      name: sanitizedStructureText(capability.name ?? capability.userValue ?? 'route-only capability', 120, 'route-only capability'),
      evidenceModel: capability.evidenceModel ?? null,
      enabled_status: capability.enabled_status ?? capability.enabledStatus ?? null,
      sourceLayer: capability.sourceLayer ?? null,
    }));
  const remainingUnverified = capabilities
    .filter((capability) => capability.status !== 'active' && capability.evidenceMatrix?.missingEvidence?.length)
    .slice(0, 20)
    .map((capability) => ({
      id: capability.id ?? capability.capabilityId ?? null,
      name: sanitizedStructureText(capability.name ?? capability.userValue ?? 'candidate capability', 120, 'candidate capability'),
      status: capability.status ?? null,
      enabled_status: capability.enabled_status ?? capability.enabledStatus ?? null,
      missingEvidence: uniqueSortedStrings(capability.evidenceMatrix?.missingEvidence ?? []),
    }));
  return sanitizeReportPublicValue({
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-access-remediation-plan',
    buildId: context.buildId,
    siteId: context.site.id,
    inputUrl: sanitizeEvidenceRef(context.inputUrl ?? context.site.rootUrl) ?? null,
    status: 'blocked',
    reasonCode: summary.primaryReasonCode ?? 'access-boundary',
    blockerClass: summary.blockerClass ?? null,
    retryDisposition: summary.retryDisposition ?? 'blocked_no_bypass',
    reasonCodes: uniqueSortedStrings(summary.reasonCodes ?? []),
    partialRouteOnly: {
      enabledCapabilities: routeOnlyCapabilities,
      note: 'Route-only capabilities can open or navigate configured/public routes; they do not prove list contents, metadata, or private page bodies.',
    },
    remainingUnverified,
    authorizedSourceManifestTemplate: {
      artifactFamily: 'siteforge-authorized-source-manifest',
      schemaVersion: BUILD_SCHEMA_VERSION,
      sources: [
        {
          id: 'official-feed-or-api',
          kind: 'official_api_or_feed',
          url: 'https://example.com/feed-or-api',
          accessBasis: 'site_docs_or_contract',
          permissionScope: 'public_metadata_or_sanitized_summary_only',
          allowedEvidence: ['response_shape', 'schema_hash', 'permission_scope', 'rate_limit_policy'],
          genericCrawlAllowed: false,
          promotionAllowed: false,
        },
        {
          id: 'user-structure-summary',
          kind: 'user_sanitized_summary',
          url: null,
          accessBasis: 'user_provided_redacted_structure',
          permissionScope: 'route_template,page_type,visible_item_count,control_type,structure_hash',
          allowedEvidence: ['route_template', 'page_type', 'visible_item_count', 'structure_hash'],
          genericCrawlAllowed: false,
          promotionAllowed: false,
        },
      ],
    },
    workflows: [
      {
        workflowId: 'access:official-api-or-feed',
        kind: 'official_api_or_feed',
        status: 'available_if_site_provides_authorized_source',
        allowedEvidence: ['response_shape', 'schema_hash', 'rate_limit_policy', 'permission_scope'],
        genericCrawlAllowed: false,
        promotionAllowed: false,
        updatesCurrent: false,
        updatesRegistry: false,
      },
      {
        workflowId: 'access:user-supplied-structure-summary',
        kind: 'manual_summary',
        status: 'requires_sanitized_structure_source',
        allowedEvidence: ['route_template', 'page_type', 'visible_item_count', 'control_type', 'structure_hash'],
        genericCrawlAllowed: false,
        promotionAllowed: false,
        updatesCurrent: false,
        updatesRegistry: false,
      },
      {
        workflowId: 'access:local-http-validation',
        kind: 'local_http_validation',
        status: 'available_for_tests_only',
        allowedEvidence: ['fixture_http_response', 'fixture_robots_allow'],
        genericCrawlAllowed: false,
        liveSupportClaimAllowed: false,
        promotionAllowed: false,
        updatesCurrent: false,
        updatesRegistry: false,
      },
    ],
    safety: {
      bypassRobots: false,
      bypassChallenge: false,
      readBrowserProfile: false,
      persistCookie: false,
      persistToken: false,
      saveRawHtml: false,
      savePrivateBody: false,
      rawNetworkPayloadPersisted: false,
    },
  });
}

async function writeAccessRemediationPlanIfNeeded(context, stageResults, pageReconciliation) {
  if (!shouldWriteAccessRemediationPlan(pageReconciliation)) {
    return null;
  }
  const plan = buildAccessRemediationPlan(context, stageResults, pageReconciliation);
  const write = await writeRedactedArtifactJson(context, ACCESS_REMEDIATION_PLAN_FILE, plan);
  return write;
}

function authorizedSourcesSummaryForReport(context) {
  const sources = context.options?.authorizedSources
    ?? context.setupProfile?.localBuildConfig?.authorizedSources
    ?? [];
  const rows = (Array.isArray(sources) ? sources : [])
    .slice(0, 20)
    .map((source, index) => sanitizeReportPublicValue({
      id: source?.id ?? `authorized-source-${index + 1}`,
      kind: source?.kind ?? source?.type ?? 'authorized_source',
      url: source?.url ?? null,
      accessBasis: source?.accessBasis ?? source?.authorizationBasis ?? 'user_provided_contract',
      permissionScope: source?.permissionScope ?? 'sanitized_summary_only',
      allowedEvidence: uniqueSortedStrings(source?.allowedEvidence ?? []),
      genericCrawlAllowed: false,
      promotionAllowed: false,
    }));
  return {
    configured: rows.length,
    sources: rows,
    note: rows.length
      ? 'Authorized sources are evidence inputs, not robots/challenge bypasses; promotion remains gated by source authority and evidence policy.'
      : null,
  };
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
  const warningCodes = uniqueSortedStrings(Object.values(stageRecords)
    .flatMap((stage) => [
      ...(stage.reasonCodes ?? []),
      ...(stage.warnings ?? []).map((warning) => classifySiteForgeWarning(warning)?.reasonCode),
    ]));
  const reportWarnings = uniqueSortedStrings([
    ...context.warnings,
    ...Object.values(stageRecords).flatMap((stage) => stage.warnings ?? []),
  ].map((warning) => safeBuildWarningForReport(warning)).filter(Boolean));
  const capabilityState = buildCapabilityStateModel(capabilities);
  const partialSuccessReasons = buildPartialSuccessReasons({
    context,
    report: {
      warnings: reportWarnings,
      failureClass: failureReason?.failureClass ?? null,
      reasonCode: failureReason?.reasonCode ?? null,
      summary: {
        verificationStatus: stageResults.verifySkill?.verificationReport?.status ?? null,
        verificationReasonCode: stageResults.verifySkill?.verificationReport?.reasonCode ?? null,
      },
    },
    setupCollectionReview,
    capabilityState,
  });
  const result_status = resultStatusFromBuild({
    legacyStatus: status,
    context,
    report: {
      warnings: reportWarnings,
      failureClass: failureReason?.failureClass ?? null,
      reasonCode: failureReason?.reasonCode ?? null,
      summary: {
        verificationStatus: stageResults.verifySkill?.verificationReport?.status ?? null,
        verificationReasonCode: stageResults.verifySkill?.verificationReport?.reasonCode ?? null,
      },
    },
    setupCollectionReview,
    capabilityState,
  });
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
  const userReportWrite = await writeRedactedArtifactJson(context, USER_REPORT_FILE, userReport);
  report.artifacts[USER_REPORT_FILE] = userReportWrite.artifactPath;
  const userReportAliasWrite = await writeRedactedArtifactJson(context, USER_REPORT_JSON_ALIAS, userReportWrite.value);
  report.artifacts[USER_REPORT_JSON_ALIAS] = userReportAliasWrite.artifactPath;
  const userMarkdown = renderBuildUserMarkdown(userReportWrite.value, report, { cwd: context.cwd });
  const userMarkdownPath = await writeArtifactText(context, USER_REPORT_MARKDOWN_FILE, userMarkdown);
  report.artifacts[USER_REPORT_MARKDOWN_FILE] = userMarkdownPath;
  const userMarkdownAliasPath = await writeArtifactText(context, USER_REPORT_MARKDOWN_ALIAS, userMarkdown);
  report.artifacts[USER_REPORT_MARKDOWN_ALIAS] = userMarkdownAliasPath;
  const debugBase = buildDebugReport(context, stageResults, stageRecords, report, userReportWrite.value);
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
  const debugBase = buildDebugReport(context, stageResults, stageRecords, failedReport, userReportWrite.value);
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
  const setupBlock = setupProfileBuildBlock(context.setupProfile);
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
    }, startedAt, new Date().toISOString());
    for (const skipped of SITEFORGE_BUILD_STAGE_NAMES.slice(1)) {
      stageRecords[skipped] = buildStageRecord(skipped, 'skipped', {
        warnings: ['Skipped because setup profile is not buildable.'],
      }, new Date().toISOString(), new Date().toISOString());
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
    updateWebInteractionBuildState(
      context,
      {
        ...stageRecords,
        [stageName]: buildStageRecord(stageName, 'running', {}, startedAt, null),
      },
      stageResults,
      { phase: 'build', status: `running:${stageName}` },
    );
    try {
      const result = await STAGE_IMPLS[stageName](context, stageResults, stageRecords);
      stageResults[stageName] = result;
      const status = result.status ?? 'success';
      stageRecords[stageName] = buildStageRecord(stageName, status, result, startedAt, new Date().toISOString());
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
      }, startedAt, new Date().toISOString());
      for (const skipped of SITEFORGE_BUILD_STAGE_NAMES.slice(SITEFORGE_BUILD_STAGE_NAMES.indexOf(stageName) + 1)) {
        stageRecords[skipped] = buildStageRecord(skipped, 'skipped', {
          warnings: [`Skipped because ${stageName} ${stageStatus}.`],
        }, new Date().toISOString(), new Date().toISOString());
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
  };
  updateWebInteractionBuildState(context, stageRecords, stageResults, {
    phase: 'capabilities',
    status: 'waiting_for_capability_decisions',
    result,
  });
  return result;
}

function buildReportPayloadForMode(result, options = /** @type {any} */ ({})) {
  const mode = normalizeReportMode(options.reportMode ?? options.report);
  if (mode === 'user') {
    return result.user_report ?? result.userReport ?? result;
  }
  if (mode === 'debug') {
    return result.debug_report ?? result.debugReport ?? result;
  }
  return {
    result_status: result.result_status ?? result.status ?? null,
    build_id: result.build_id ?? result.buildId ?? null,
    skill_id: result.skill_id ?? result.skillId ?? null,
    user: result.user_report ?? result.userReport ?? null,
    debug: result.debug_report ?? result.debugReport ?? null,
    index: result,
  };
}

export function siteForgeBuildCliJson(result, options = /** @type {any} */ ({})) {
  return `${prepareRedactedArtifactJsonWithAudit(buildReportPayloadForMode(result, options)).json}\n`;
}

function displayBuildWarning(value) {
  const text = String(value ?? '');
  const translations = new Map([
    ['Browser-rendered crawl is unavailable for this deterministic static build path.', 'Browser-rendered crawl is unavailable for this deterministic static build path.'],
    ['Browser-rendered crawl is not part of the public build path; this run used static and sanitized setup evidence only.', 'This build used static and sanitized setup evidence only; browser-rendered crawl is not part of the public build path.'],
    ['Network summary was not requested; raw network tracing is not part of the public build path.', 'Network summary was not requested; raw network tracing is not part of the public build path.'],
    ['Network capture requested; raw network traces were not persisted, and this build path only writes a sanitized network summary.', 'Network capture requested; only a sanitized network summary was saved.'],
    ['Network summary requested; raw network traces were not captured or persisted.', 'Network summary requested; raw network traces were not captured or persisted.'],
    ['Raw network capture was enabled; raw trace artifacts may contain sensitive material.', 'Raw network capture was enabled; raw trace artifacts may contain sensitive material.'],
    ['Raw network capture was enabled; raw artifacts are kept out of generated Skill, current outputs, and registry.', 'Raw network capture was enabled; raw artifacts are kept out of generated Skill, current outputs, and registry.'],
    ['network-fetch-failed', 'Network fetch failed; raw error details were not saved.'],
    ['validation-failed', 'Verification did not pass; see verification_report.json.'],
    ['robots-unavailable', 'robots.txt could not be fetched, so the live build stopped safely.'],
    ['robots-disallowed', 'robots.txt blocked the candidate crawl scope.'],
    ['dynamic-unsupported', 'The route appears to require dynamic collection, which was not enabled.'],
    ['browser-auth-route-coverage-partial', 'Default-browser bridge captured only reachable configured routes; missing routes are reported as authenticated coverage gaps.'],
    ['Skipped because setup profile is not buildable.', 'Skipped because the setup profile is not buildable.'],
  ]);
  if (translations.has(text)) {
    return translations.get(text);
  }
  const skipped = text.match(/^Skipped because ([A-Za-z][A-Za-z0-9]*) ([a-z_]+)\.$/u);
  if (skipped) return `Skipped because stage ${skipped[1]} status is ${collectionStatusLabel(skipped[2])}.`;
  const crawlFailed = text.match(/^crawl failed: (.+)$/u);
  if (crawlFailed) return `Crawl failed: ${crawlFailed[1]}`;
  return text;
}

function displayCollectionKind(value) {
  if (value === 'capability') return 'capability';
  if (value === 'node') return 'node';
  if (value === 'affordance') return 'affordance';
  if (value === 'stage') return 'stage';
  if (value === 'build') return 'build';
  return String(value ?? '-');
}

function displayCollectionTarget(value) {
  return String(value ?? '') || '-';
}

function displayCollectionReason(item) {
  const reasonCode = String(item?.reasonCode ?? '');
  if (reasonCode === 'capability-specific-evidence-required') return 'Capability-specific evidence is missing.';
  if (reasonCode === 'authorized-route-seed-only') return 'Only an authorized route seed was collected; page content is not verified.';
  if (reasonCode === 'not-selected-by-setup') return 'Not selected during setup; kept as a candidate capability.';
  if (reasonCode === 'capability-candidate') return 'Candidate capability does not yet meet activation criteria.';
  if (reasonCode === 'stage-skipped') return 'Upstream stage did not complete; this stage was skipped.';
  if (reasonCode === 'stage-failed') return 'This stage failed and did not produce a verifiable result.';
  if (reasonCode === 'stage-blocked') return 'This stage was blocked by a safety or evidence gate.';
  if (reasonCode === 'empty-crawl') return 'Static crawl did not collect verifiable page evidence.';
  if (reasonCode === 'robots-disallowed') return 'robots.txt blocked the candidate crawl scope.';
  if (reasonCode === 'robots-unavailable') return 'robots.txt could not be fetched, so the live build stopped safely.';
  if (reasonCode === 'dynamic-unsupported') return 'The route appears to require dynamic collection, which was not enabled.';
  if (reasonCode === 'network-fetch-failed') return 'Network fetch failed; no verifiable page evidence was collected.';
  return displayBuildWarning(item?.reason ?? reasonCode);
}

function markdownTableCell(value, maxLength = 72) {
  const text = String(value ?? '-')
    .replace(/\r?\n/gu, ' ')
    .replace(/\|/gu, '\\|')
    .trim();
  if (text.length <= maxLength) {
    return text || '-';
  }
  return `${text.slice(0, Math.max(1, maxLength - 1))}...`;
}

function renderCollectionOutcomeTable(outcomes = /** @type {any[]} */ ([])) {
  const rows = [
    '  | Type | Target | Status | Reason |',
    '  | --- | --- | --- | --- |',
  ];
  for (const item of outcomes) {
    rows.push(`  | ${markdownTableCell(displayCollectionKind(item.kind), 12)} | ${markdownTableCell(displayCollectionTarget(item.target), 30)} | ${markdownTableCell(collectionStatusLabel(item.status), 12)} | ${markdownTableCell(displayCollectionReason(item), 88)} |`);
  }
  return rows;
}

function renderSetupCollectionReviewLines(review = null) {
  if (!review) {
    return [];
  }
  const summary = review.summary ?? {};
  const capabilityMissing = summary.capabilities?.missing ?? 0;
  const intentMissing = summary.intents?.missing ?? 0;
  const lines = [
    'Collection review:',
    `  Collected: seeds=${summary.seeds?.collected ?? 0} nodes=${summary.nodes?.collected ?? 0} affordances=${summary.affordances?.collected ?? 0} capabilities=${summary.capabilities?.collected ?? 0} intents=${summary.intents?.collected ?? 0}`,
    `  Needs more evidence: capabilities=${capabilityMissing} intents=${intentMissing}`,
  ];
  const missingRecords = review.missingRecords ?? [];
  if (missingRecords.length) {
    lines.push('  Missing evidence:');
    for (const record of missingRecords.slice(0, 5)) {
      lines.push(`    - ${record.kind}:${record.label ?? record.id ?? '-'} (${record.reasonCode ?? 'missing-evidence'})`);
    }
    if (review.truncated || missingRecords.length > 5) {
      lines.push('    - See build_report.json for the full collection review.');
    }
  }
  return lines;
}

function renderSiteForgeUserBuildSummary(result, options = /** @type {any} */ ({})) {
  return renderFriendlySiteForgeUserBuildSummary(result, options);
}

function numberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function renderSiteForgePlainBuildSummary(result = /** @type {any} */ ({}), options = /** @type {any} */ ({})) {
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
  if (pageReconciliationPath) {
    lines.push(`Page reconciliation report: ${displayReportPath(pageReconciliationPath, options)}`);
  }
  const robotsRemediationPath = robotsRemediationResultPath(result);
  if (robotsRemediationPath) {
    lines.push(`Robots remediation plan: ${displayReportPath(robotsRemediationPath, options)}`);
  }
  const accessRemediationPath = accessRemediationResultPath(result);
  if (accessRemediationPath) {
    lines.push(`Access remediation plan: ${displayReportPath(accessRemediationPath, options)}`);
  }
  if (htmlPath) {
    lines.push(`HTML report: ${displayReportPath(htmlPath, options)}`);
  }
  return `${lines.join('\n')}\n`;
}

function capabilityIntentHtmlResultPath(result = /** @type {any} */ ({})) {
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

function pageReconciliationResultPath(result = /** @type {any} */ ({})) {
  return result.artifacts?.[PAGE_RECONCILIATION_REPORT_FILE]
    ?? result.reports?.page_reconciliation_report
    ?? result.user_report?.reports?.page_reconciliation_report
    ?? result.userReport?.reports?.page_reconciliation_report
    ?? result.pageReconciliationReport
    ?? null;
}

function robotsRemediationResultPath(result = /** @type {any} */ ({})) {
  return result.artifacts?.['robots_remediation_plan.json']
    ?? result.reports?.robots_remediation_plan
    ?? result.user_report?.reports?.robots_remediation_plan
    ?? result.userReport?.reports?.robots_remediation_plan
    ?? null;
}

function accessRemediationResultPath(result = /** @type {any} */ ({})) {
  return result.artifacts?.[ACCESS_REMEDIATION_PLAN_FILE]
    ?? result.reports?.access_remediation_plan
    ?? result.user_report?.reports?.access_remediation_plan
    ?? result.userReport?.reports?.access_remediation_plan
    ?? null;
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
