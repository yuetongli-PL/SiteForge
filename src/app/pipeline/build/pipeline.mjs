// @ts-check

import path from 'node:path';
import process from 'node:process';
import { displayPath } from '../../../infra/cli/path-display.mjs';
import { buildStatusLabel, collectionStatusLabel, verificationStatusLabel } from '../../../infra/cli/status-labels.mjs';
import { pathExists } from '../../../infra/io.mjs';
import { jsonClone } from '../../../shared/clone.mjs';
import { mapWithConcurrency } from '../../../shared/concurrency.mjs';
import { slugifyAscii, uniqueSortedStrings } from '../../../shared/normalize.mjs';
import { prepareRedactedArtifactJsonWithAudit } from '../../../domain/sessions/security-guard.mjs';
import {
  ensureBuildDirectories,
  readJsonIfExists,
  writeArtifactJson,
  writeArtifactText,
  writeGeneratedJson,
  writeSkillJson,
  writeSkillText,
} from './artifact-store.mjs';
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
  normalizeCapabilityEnablementStatus,
  normalizeCapabilityEvidenceStatus,
  publicSafeRemediation,
  riskPolicySummary,
  sanitizeEvidenceRef,
} from './risk-policy.mjs';
import {
  isUrlAllowedByRobots,
  parseHtmlDocument,
  parseRobotsPolicy,
  parseRobotsSitemaps,
  parseSitemapUrls,
  routePatternForUrl,
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
  promoteVerifiedBuild,
  writeLastSuccessfulBuild,
} from './workspace.mjs';
import {
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

export const SITEFORGE_BUILD_STAGE_NAMES = Object.freeze([
  'registerSite',
  'discoverSeeds',
  'crawlStatic',
  'crawlRendered',
  'discoverInteractions',
  'captureNetworkTraces',
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
  crawlRendered: ['crawlStatic'],
  discoverInteractions: ['crawlStatic'],
  captureNetworkTraces: ['crawlRendered'],
  buildSiteGraph: ['crawlStatic', 'discoverInteractions', 'captureNetworkTraces'],
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

const clone = jsonClone;

function arrayUniqueBy(values, keyFn) {
  const seen = new Set();
  const result = [];
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

function capabilitySemanticKey(capability = {}) {
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

function capabilityPreferenceTuple(capability = {}) {
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

function compareCapabilityPreference(left = {}, right = {}) {
  const leftTuple = capabilityPreferenceTuple(left);
  const rightTuple = capabilityPreferenceTuple(right);
  for (let index = 0; index < leftTuple.length; index += 1) {
    if (leftTuple[index] !== rightTuple[index]) {
      return leftTuple[index] - rightTuple[index];
    }
  }
  return String(right.id ?? '').localeCompare(String(left.id ?? ''), 'en');
}

function dedupeSemanticCapabilities(capabilities = []) {
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
  if (source === 'sitemap' || source === 'robots' || source === 'form' || source === 'fixture') {
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

function capabilityCounts(capabilities = []) {
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

function buildStageRecord(name, status, result = {}, startedAt, completedAt) {
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
  warnings = [],
  artifactPaths = {},
  reasonCodes = [],
  summary = {},
} = {}) {
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
          : code === 'siteforge-static-crawl-empty'
            ? (warningReason?.reasonCode === 'network-fetch-failed' || warningReason?.reasonCode === 'robots-disallowed'
              ? warningReason
              : normalizeSiteForgeReason('empty-crawl'))
            : warningReason;
  const error = new Error(reason?.reasonCode ? `${message} [reasonCode=${reason.reasonCode}]` : message);
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
  return page?.stateKey ? `${normalizedUrl}#state:${page.stateKey}` : normalizedUrl;
}

function pageNodeIdForPage(page) {
  return stableNodeId('node:page', pageIdentity(page));
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
  if (/catalog|directory|collection|listing|browse|AV在線看|AV online|video list|content list/iu.test(text)) {
    return 'catalog_collection';
  }
  return null;
}

function classifyPage(page) {
  if (page.pageType === 'home') {
    return 'homepage';
  }
  if (page.pageType) {
    return `social_${String(page.pageType).replace(/[^a-z0-9_]+/giu, '_').toLowerCase()}`;
  }
  const parsed = new URL(page.normalizedUrl);
  const haystack = `${parsed.pathname} ${page.title ?? ''} ${page.textSummary ?? ''}`.toLowerCase();
  if (parsed.pathname === '/') {
    return 'homepage';
  }
  if (/\/(?:ch|ch2|mobile|channel|news|feed)(?:\/|$)/u.test(parsed.pathname) || /^\/rain\/?$/u.test(parsed.pathname)) {
    return 'news_channel';
  }
  if (/\/(?:omn|d|article|story|a)\//u.test(parsed.pathname) || /\/rain\/a\//u.test(parsed.pathname) || /article|story|news detail|正文|新闻详情|稿件/iu.test(haystack)) {
    return 'article_detail';
  }
  const earlyCatalogClassification = catalogRouteClassification(parsed.pathname, '');
  if (earlyCatalogClassification) {
    return earlyCatalogClassification;
  }
  if (/channel|feed|list|频道|要闻|新闻列表|资讯/iu.test(haystack)) {
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
  return 'content_page';
}

function formSafety(form) {
  const method = String(form.method ?? 'GET').toUpperCase();
  const haystack = `${form.label ?? ''} ${form.action ?? ''} ${form.textSummary ?? ''}`.toLowerCase();
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
  if (/checkout|payment|purchase|order|billing/u.test(haystack)) {
    return 'payment';
  }
  if (/delete|remove|destroy|cancel account/u.test(haystack)) {
    return 'destructive';
  }
  if (control.kind === 'input' || control.kind === 'select' || type === 'submit') {
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

const SENSITIVE_BUILD_PROFILE_KEY_PATTERN = /^(?:cookie|cookies|csrf|authorization|authHeader|authHeaders|header|headers|accessToken|access_token|refreshToken|refresh_token|sessdata|sessionId|session_id|sid|token|tokens|profilePath|browserProfile|browserProfileRoot|userDataDir|user_data_dir)$/iu;

function findSensitiveBuildProfileKeys(value, pathParts = []) {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const hits = [];
  for (const [key, item] of Object.entries(value)) {
    const nextPath = [...pathParts, key];
    if (SENSITIVE_BUILD_PROFILE_KEY_PATTERN.test(key)) {
      hits.push(nextPath.join('.'));
      continue;
    }
    hits.push(...findSensitiveBuildProfileKeys(item, nextPath));
  }
  return hits;
}

function assertBuildProfileSafe(profile) {
  const sensitiveKeys = findSensitiveBuildProfileKeys(profile);
  if (sensitiveKeys.length) {
    throw new Error(`build_profile.json contains sensitive fields: ${sensitiveKeys.join(', ')}`);
  }
}

function policyFromSetupProfile(profile = {}) {
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
    sources: clone(profile.knownSitePolicy.sources ?? []),
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
  const records = [];
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
        rawHref: urlValue,
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

function createInitialContext(inputUrl, options = {}) {
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
    setupProfile: options.setupProfile ?? null,
    siteAdapterProfile: null,
    siteAdapterPaths: null,
    setupCollectionReview: options.setupCollectionReview ?? null,
    setupCollectionReviewPath: null,
    buildProfilePath: options.buildProfilePath ?? null,
    artifactStore: {
      type: 'siteforge-per-site-build-dir',
      rootDir: workspace.paths.buildDir,
      buildDir: workspace.paths.buildDir,
      siteDir: workspace.paths.siteDir,
    },
    startedAt,
    policy,
    options,
    source: createBuildSource(inputUrl, {
      ...options,
      fetchDelayMs: policy.fetchDelayMs,
      fetchTimeoutMs: policy.fetchTimeoutMs,
    }),
    warnings: [],
    skillId: null,
    skillDir: null,
    draftSkillDir: null,
    activeSkillDir: null,
    registryPath: path.resolve(options.registryPath ?? workspace.paths.registryPath),
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
  context.setupProfile = profile;
  context.buildProfilePath = profilePath;
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
  });
}

function updateWebInteractionBuildState(context, stageRecords, stageResults, {
  phase = 'build',
  status = 'running',
  result = null,
} = {}) {
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
    return routePatternForUrl(urlValue, rootUrl);
  } catch {
    return '/';
  }
}

function routeSeedPlanFromSeeds(context, seeds = []) {
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
      message: 'Adapter contract must not persist raw DOM, raw HTML, body text, private content, cookies, tokens, or browser profiles.',
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
  seeds = [],
  status = 'initialized',
  stage = 'registerSite',
} = {}) {
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

function siteAdapterSummaryForReport(context, { includeSource = false } = {}) {
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

async function writeGeneratedSiteAdapterProfile(context, args = {}) {
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
  seeds = [],
  pages = [],
  failures = [],
  queueLength = 0,
  queueIndex = 0,
  visitedCount = 0,
  effectiveMaxPages = 0,
  coveragePlan = null,
  summary = {},
  warnings = [],
} = {}) {
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

async function discoverSeedsStage(context) {
  const authorizedPages = userAuthorizedEvidencePages(context);
  if (authorizedPages.length) {
    const seeds = arrayUniqueBy(authorizedPages.map((page) => ({
      url: page.url,
      normalizedUrl: page.normalizedUrl,
      source: 'user_authorized_browser',
      confidence: 0.86,
      evidence: page.evidence,
    })), (seed) => seed.normalizedUrl)
      .sort((left, right) => left.normalizedUrl.localeCompare(right.normalizedUrl, 'en'));
    const payload = {
      schemaVersion: BUILD_SCHEMA_VERSION,
      buildId: context.buildId,
      siteId: context.site.id,
      status: 'success',
      mode: 'user_authorized_browser',
      seeds,
      robots: {
        status: 'not_applicable_user_authorized',
        reason: 'Seed evidence came from a user-authorized browser surface, not the generic crawler.',
        sitemaps: [],
        processedSitemaps: [],
        disallowPaths: [],
        excludedUrls: [],
      },
      warnings: ['generic crawler skipped; using bounded user-authorized browser evidence summary.'],
    };
    const seedsPath = await writeArtifactJson(context, 'seeds.json', payload);
    const generatedAdapter = await writeGeneratedSiteAdapterProfile(context, {
      seeds,
      status: 'route_seeded',
      stage: 'discoverSeeds',
    });
    return {
      seeds,
      robots: payload.robots,
      robotsPolicy: null,
      robotsExcludedUrls: [],
      warnings: payload.warnings,
      generatedAdapter: generatedAdapter.profile,
      artifactPaths: {
        seeds: seedsPath,
        generatedAdapter: generatedAdapter.artifactPaths.generatedAdapter,
        siteGeneratedAdapter: generatedAdapter.artifactPaths.siteGeneratedAdapter,
      },
      reasonCodes: ['user-authorized-browser-evidence'],
      summary: {
        seeds: seeds.length,
        mode: payload.mode,
        generatedAdapter: generatedAdapter.summary,
      },
    };
  }
  const seeds = [];
  const warnings = [];
  const reasonCodes = new Set();
  const robotsExcludedUrls = [];
  let robotsPolicy = null;
  let robotsStatus = 'unavailable';
  let robotsUnavailableReason = null;
  const isRobotsAllowed = (urlValue) => {
    if (!robotsPolicy) {
      return true;
    }
    const allowed = isUrlAllowedByRobots(urlValue, robotsPolicy);
    if (!allowed) {
      robotsExcludedUrls.push(normalizeUrl(urlValue, context.site.rootUrl));
      reasonCodes.add('robots-disallowed');
    }
    return allowed;
  };
  const addSeed = (urlValue, source, confidence, evidence) => {
    const normalizedUrl = normalizeUrl(urlValue, context.site.rootUrl);
    if (!isInternalUrl(normalizedUrl, context.site.allowedDomains)) {
      return;
    }
    if (!isRobotsAllowed(normalizedUrl)) {
      return;
    }
    seeds.push({
      url: urlValue,
      normalizedUrl,
      source,
      confidence,
      evidence,
    });
  };
  const sitemapUrls = new Set();
  const processedSitemaps = new Set();
  const writeBlockedSeedsAndThrow = async (code, message) => {
    const deduped = arrayUniqueBy(seeds, (seed) => seed.normalizedUrl)
      .sort((left, right) => left.normalizedUrl.localeCompare(right.normalizedUrl, 'en'));
    const payload = {
      schemaVersion: BUILD_SCHEMA_VERSION,
      buildId: context.buildId,
      siteId: context.site.id,
      status: 'blocked',
      seeds: deduped,
      robots: {
        status: robotsStatus,
        reason: robotsUnavailableReason,
        sitemaps: robotsPolicy?.sitemaps ?? [...sitemapUrls].sort((left, right) => left.localeCompare(right, 'en')),
        processedSitemaps: [...processedSitemaps].sort((left, right) => left.localeCompare(right, 'en')),
        disallowPaths: robotsPolicy?.disallowPaths ?? [],
        excludedUrls: uniqueSortedStrings(robotsExcludedUrls),
      },
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
    const warning = `robots.txt unavailable: ${robotsUnavailableReason}`;
    warnings.push(warning);
    reasonCodes.add('robots-unavailable');
    if (!context.source.fixture) {
      await writeBlockedSeedsAndThrow(
        'robots-unavailable',
        `robots.txt unavailable for live SiteForge build: ${robotsUnavailableReason}`,
      );
    }
  }

  const homepageEvidence = [
    buildEvidence({
      type: context.source.fixture ? 'fixture' : 'url',
      source: context.source.fixture?.fixtureDir ?? context.site.rootUrl,
      confidence: 1,
    }),
  ];
  addSeed(context.site.rootUrl, context.source.fixture ? 'fixture' : 'input', 1, homepageEvidence);
  if (!context.source.fixture && robotsPolicy && !seeds.length && robotsExcludedUrls.length) {
    warnings.push('robots excluded all planned seed URLs before crawl.');
    await writeBlockedSeedsAndThrow(
      'robots-disallowed',
      'robots.txt disallows all planned seed URLs for live SiteForge build.',
    );
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
            && isRobotsAllowed(normalizedLoc)
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
            type: context.source.fixture ? 'fixture' : 'url',
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
  const payload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    status: deduped.length ? 'success' : 'blocked',
    seeds: deduped,
    robots: {
      status: robotsStatus,
      reason: robotsUnavailableReason,
      sitemaps: robotsPolicy?.sitemaps ?? [...sitemapUrls].sort((left, right) => left.localeCompare(right, 'en')),
      processedSitemaps: [...processedSitemaps].sort((left, right) => left.localeCompare(right, 'en')),
      disallowPaths: robotsPolicy?.disallowPaths ?? [],
      excludedUrls: uniqueSortedStrings(robotsExcludedUrls),
    },
    warnings,
  };
  const seedsPath = await writeArtifactJson(context, 'seeds.json', payload);
  const generatedAdapter = await writeGeneratedSiteAdapterProfile(context, {
    seeds: deduped,
    status: payload.status === 'blocked' ? 'blocked_seed_plan' : 'route_seeded',
    stage: 'discoverSeeds',
  });
  if (!deduped.length) {
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
          generatedAdapter: generatedAdapter.summary,
        },
      },
    );
  }
  return {
    seeds: deduped,
    robots: payload.robots,
    robotsPolicy,
    robotsExcludedUrls: uniqueSortedStrings(robotsExcludedUrls),
    warnings,
    generatedAdapter: generatedAdapter.profile,
    artifactPaths: {
      seeds: seedsPath,
      generatedAdapter: generatedAdapter.artifactPaths.generatedAdapter,
      siteGeneratedAdapter: generatedAdapter.artifactPaths.siteGeneratedAdapter,
    },
    reasonCodes: uniqueSortedStrings([...reasonCodes]),
    summary: {
      seeds: deduped.length,
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
  const isFixtureSource = Boolean(context.source?.fixture);
  const routeFamilyThreshold = isFixtureSource
    ? Math.max(REPRESENTATIVE_ROUTE_FAMILY_MIN_SEEDS, maxPages * 2)
    : REPRESENTATIVE_ROUTE_FAMILY_LIVE_MIN_SEEDS;
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
        isFixtureSource ? REPRESENTATIVE_ROUTE_FAMILY_MAX_PAGES : REPRESENTATIVE_ROUTE_FAMILY_LIVE_MAX_PAGES
      )),
    ),
  );
  const countsByFamily = new Map();
  const selected = [];
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

async function crawlStaticStage(context, stageResults) {
  const authorizedPages = userAuthorizedEvidencePages(context);
  if (authorizedPages.length) {
    const collectedPages = await mapWithConcurrency(
      authorizedPages,
      USER_AUTHORIZED_COLLECTION_CONCURRENCY,
      async (page) => ({
        ...page,
        collection: {
          status: 'success',
          source: 'user_authorized_browser',
          concurrent: true,
        },
      }),
    );
    const pages = arrayUniqueBy(collectedPages, (page) => pageIdentity(page))
      .sort((left, right) => pageIdentity(left).localeCompare(pageIdentity(right), 'en'));
    const payload = {
      schemaVersion: BUILD_SCHEMA_VERSION,
      buildId: context.buildId,
      siteId: context.site.id,
      status: 'success',
      mode: 'user_authorized_browser',
      pages,
      errors: [],
      diagnostics: {
        staticEvidence: {
          empty: 0,
          dynamicShell: 0,
          present: pages.length,
        },
      },
      summary: {
        pages: pages.length,
        duplicateUrls: 0,
        duplicateRatio: 0,
        maxDepth: 0,
        maxPages: pages.length,
        collectionConcurrency: Math.min(USER_AUTHORIZED_COLLECTION_CONCURRENCY, authorizedPages.length),
        robotsExcludedUrls: [],
        blockedReason: null,
        mode: 'user_authorized_browser',
      },
      warnings: ['using sanitized user-authorized browser evidence; unredacted page structure and session material were not persisted.'],
    };
    const autoDiscovery = context.setupProfile?.userAuthorizedEvidence?.autoDiscovery ?? null;
    const autoDiscoveryPath = autoDiscovery
      ? await writeArtifactJson(context, path.join('discovery', 'auto_discovery.json'), {
        ...autoDiscovery,
        buildId: context.buildId,
        siteId: context.site.id,
      })
      : null;
    const crawlStaticPath = await writeArtifactJson(context, 'crawl_static.json', payload);
    const crawlCheckpointPath = await writeCrawlCheckpoint(context, {
      status: 'completed',
      mode: 'user_authorized_browser',
      seeds: authorizedPages.map((page) => ({
        url: page.url,
        normalizedUrl: page.normalizedUrl,
        source: 'user_authorized_browser',
      })),
      pages,
      queueLength: authorizedPages.length,
      queueIndex: authorizedPages.length,
      visitedCount: pages.length,
      effectiveMaxPages: pages.length,
      summary: payload.summary,
      warnings: payload.warnings,
    });
    return {
      pages,
      warnings: payload.warnings,
      artifactPaths: {
        crawlStatic: crawlStaticPath,
        crawlCheckpoint: crawlCheckpointPath,
        ...(autoDiscoveryPath ? { autoDiscovery: autoDiscoveryPath } : {}),
      },
      reasonCodes: ['user-authorized-browser-evidence'],
      summary: {
        ...payload.summary,
        autoDiscovery: autoDiscovery?.summary ?? null,
      },
    };
  }
  const { seeds, robotsPolicy = null } = requireStage(stageResults, 'discoverSeeds');
  const maxDepth = Number(context.policy.maxDepth ?? 2);
  const maxPages = Math.max(1, Number(context.policy.maxPages ?? 50));
  const coveragePlan = planRepresentativeCrawlCoverage(context, seeds, { maxPages });
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
  const pages = [];
  const failures = [];
  const warnings = [...coveragePlan.warnings];
  const reasonCodes = new Set();
  const robotsExcludedUrls = [];
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

  const crawlEntry = async (entry) => {
    const entryWarnings = [];
    const entryReasonCodes = new Set();
    const entryRobotsExcludedUrls = [];
    try {
      const pageSource = await context.source.read(entry.url);
      const parsed = parseHtmlDocument(pageSource.body, entry.url);
      entryWarnings.push(...staticDiagnosticWarnings(entry.url, parsed.diagnostics));
      const normalizedUrl = normalizeUrl(parsed.canonicalUrl ?? entry.url);
      const page = {
        url: entry.url,
        normalizedUrl,
        depth: entry.depth,
        discoveredBy: entry.discoveredBy,
        sourcePath: pageSource.sourcePath,
        title: parsed.title,
        textSummary: parsed.textSummary,
        canonicalUrl: parsed.canonicalUrl,
        links: parsed.links
          .map((link) => ({ ...link, normalizedHref: normalizeUrl(link.href, entry.url) }))
          .filter((link) => (
            isInternalUrl(link.normalizedHref, context.site.allowedDomains)
            && canCrawl(link.normalizedHref, {
              robotsExcludedUrls: entryRobotsExcludedUrls,
              reasonCodes: entryReasonCodes,
            })
          )),
        forms: parsed.forms,
        controls: parsed.controls,
        diagnostics: parsed.diagnostics,
        collection: {
          status: 'success',
          source: pageSource.fixtureName ? 'fixture' : 'url',
          concurrent: true,
        },
        evidence: [
          buildEvidence({
            type: pageSource.fixtureName ? 'fixture' : 'url',
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
    const batch = [];
    while (index < queue.length && batch.length < STATIC_CRAWL_COLLECTION_CONCURRENCY && visited.size < effectiveMaxPages) {
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
    const results = await mapWithConcurrency(batch, STATIC_CRAWL_COLLECTION_CONCURRENCY, crawlEntry);
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

  const dedupedPages = arrayUniqueBy(pages, (page) => page.normalizedUrl)
    .sort((left, right) => left.normalizedUrl.localeCompare(right.normalizedUrl, 'en'));
  const dedupedFailures = arrayUniqueBy(failures, (failure) => failure.normalizedUrl)
    .sort((left, right) => left.normalizedUrl.localeCompare(right.normalizedUrl, 'en'));
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
  const errors = blockedReason
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
  const payload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    status: blockedReason ? 'blocked' : 'success',
    pages: dedupedPages,
    failures: dedupedFailures,
    errors,
    diagnostics: {
      staticEvidence: staticDiagnosticSummary,
    },
    summary: {
      pages: dedupedPages.length,
      duplicateUrls,
      duplicateRatio,
      maxDepth,
      maxPages,
      effectiveMaxPages,
      seedInventoryUrls: seeds.length,
      representativeCoverageMode: coveragePlan.mode,
      representativeFamilyCount: coveragePlan.familyCount,
      representativeSeedUrls: coveragePlan.seeds.length,
      representativeUnfetchedSeeds: Math.max(0, seeds.length - coveragePlan.seeds.length),
      fetchedUrls: visited.size,
      failedUrls: dedupedFailures.length,
      queuedUrls: queue.length,
      unfetchedUrls: Math.max(0, queue.length - index),
      collectionConcurrency: STATIC_CRAWL_COLLECTION_CONCURRENCY,
      robotsExcludedUrls: uniqueSortedStrings(robotsExcludedUrls),
      blockedReason,
    },
    warnings,
  };
  const crawlStaticPath = await writeArtifactJson(context, 'crawl_static.json', payload);
  const crawlCheckpointPath = await writeCrawlCheckpoint(context, {
    status: blockedReason ? 'blocked' : 'completed',
    mode: coveragePlan.mode,
    seeds,
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
  if (blockedReason) {
    throw createBlockedStageError(
      blockedReason,
      errors[0],
      {
        warnings,
        artifactPaths: {
          crawlStatic: crawlStaticPath,
          crawlCheckpoint: crawlCheckpointPath,
        },
        reasonCodes: uniqueSortedStrings([...reasonCodes]),
        summary: payload.summary,
      },
    );
  }
  return {
    pages: dedupedPages,
    warnings,
    artifactPaths: {
      crawlStatic: crawlStaticPath,
      crawlCheckpoint: crawlCheckpointPath,
    },
    reasonCodes: uniqueSortedStrings([...reasonCodes]),
    summary: payload.summary,
  };
}

async function crawlRenderedStage(context) {
  const payload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    status: 'skipped',
    reason: 'Browser-rendered crawl is not part of the public build path; this run used static and sanitized setup evidence only.',
    pages: [],
  };
  const crawlRenderedPath = await writeArtifactJson(context, 'crawl_rendered.json', payload);
  return {
    status: 'skipped',
    reasonCode: 'dynamic-unsupported',
    reasonCodes: ['dynamic-unsupported'],
    warnings: [payload.reason],
    artifactPaths: { crawlRendered: crawlRenderedPath },
    summary: { pages: 0 },
  };
}

async function discoverInteractionsStage(context, stageResults) {
  const { pages } = requireStage(stageResults, 'crawlStatic');
  const interactions = [];
  for (const page of pages) {
    for (const form of page.forms) {
      interactions.push({
        id: stableNodeId('interaction:form', `${pageIdentity(page)}:${form.selector}`),
        pageUrl: page.normalizedUrl,
        kind: 'form',
        label: form.label,
        selector: form.selector,
        method: form.method,
        endpoint: form.action,
        safety: formSafety(form),
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

async function captureNetworkTracesStage(context) {
  const networkRequested = context.policy.captureNetwork === true || context.options.network === true;
  const sourceDiagnostics = context.setupProfile?.sourceDiagnostics ?? [];
  const sanitizedSummary = {
    requested: networkRequested,
    rawTracesPersisted: false,
    savedSummaryOnly: true,
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
    status: 'skipped',
    reason: networkRequested
      ? 'Network summary requested; raw network traces were not captured or persisted.'
      : 'Network summary was not requested; raw network tracing is not part of the public build path.',
    traces: [],
    sanitizedSummary,
  };
  const networkPath = await writeArtifactJson(context, 'network_traces.json', payload);
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

async function buildSiteGraphStage(context, stageResults) {
  const { pages } = requireStage(stageResults, 'crawlStatic');
  const nodes = [];
  const edges = [];
  const nodeByPageKey = new Map();
  const routeNodes = new Map();

  for (const page of pages) {
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
      structureHash: page.structureHash ?? null,
      evidenceStatus: page.evidenceStatus ?? null,
      riskLevel: page.riskLevel ?? null,
      title: page.title,
      textSummary: page.textSummary,
      domFingerprint: stableNodeId('dom', `${page.title}:${page.textSummary}:${page.links.length}:${page.forms.length}:${page.stateKey ?? ''}:${page.structureHash ?? ''}`),
      discoveredBy: page.discoveredBy,
      parentNodeIds: [],
      childNodeIds: [],
      authRequired: page.authRequired === true,
      confidence: 0.9,
      evidence: page.evidence,
    };
    nodeByPageKey.set(pageIdentity(page), node);
    nodes.push(node);
  }

  for (const page of pages) {
    const from = nodeByPageKey.get(pageIdentity(page));
    if (!from) {
      continue;
    }
    for (const link of page.links) {
      const target = [...nodeByPageKey.values()].find((node) => node.normalizedUrl === link.normalizedHref);
      if (!target) {
        continue;
      }
      from.childNodeIds.push(target.id);
      target.parentNodeIds.push(from.id);
      edges.push({
        id: stableNodeId('edge:link', `${from.id}:${target.id}:${link.selector}`),
        type: 'links_to',
        from: from.id,
        to: target.id,
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
    const routeKey = page.tabState ? `${pattern}:${page.tabState}` : pattern;
    if (!routeNodes.has(routeKey)) {
      const routeId = page.routeTemplate ? routeTemplateNodeId(pattern, page.tabState) : routeNodeId(pattern);
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
        parentNodeIds: [],
        childNodeIds: [],
        authRequired: false,
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
        parentNodeIds: [from.id],
        childNodeIds: [],
        authRequired: false,
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
        parentNodeIds: [from.id],
        childNodeIds: [],
        authRequired: false,
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
        evidenceStatus: item.evidenceStatus ?? page.evidenceStatus ?? null,
        riskLevel: item.riskLevel ?? page.riskLevel ?? null,
        discoveredBy: 'interaction',
        parentNodeIds: [from.id],
        childNodeIds: [],
        authRequired: page.authRequired === true,
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
    }
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
      node.classification = classifyPage(node);
    } else if (node.type === 'form') {
      node.classification = /contact|support|message/iu.test(`${node.title ?? ''} ${node.textSummary ?? ''}`)
        ? 'contact_form'
        : /search|query|keyword/iu.test(`${node.title ?? ''} ${node.textSummary ?? ''}`)
          ? 'search_form'
          : 'form';
    } else if (node.type === 'content') {
      node.classification = `content_${node.structureType ?? node.pageType ?? 'summary'}`;
    } else if (node.type === 'operation') {
      node.classification = `operation_${node.structureType ?? node.pageType ?? 'summary'}`;
    } else if (node.type === 'modal') {
      node.classification = `modal_${node.structureType ?? node.pageType ?? 'summary'}`;
    } else if (node.type === 'route_template') {
      node.classification = catalogRouteClassification(node.routePattern ?? '', `${node.title ?? ''} ${node.textSummary ?? ''}`)
        ?? 'route_template';
    } else if (node.type === 'route') {
      node.classification = catalogRouteClassification(node.routePattern ?? '', `${node.title ?? ''} ${node.textSummary ?? ''}`)
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
  const { pages } = requireStage(stageResults, 'crawlStatic');
  const graph = requireStage(stageResults, 'classifyNodes').graph;
  const pageNodeByKey = new Map(graph.nodes.filter((node) => node.type === 'page').map((node) => [
    node.stateKey ? `${node.normalizedUrl}#state:${node.stateKey}` : node.normalizedUrl,
    node,
  ]));
  const affordances = [];

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
        safety: 'read_only',
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

function makeCapability(context, {
  name,
  description,
  action,
  object,
  userValue,
  entryNodeIds,
  requiredNodeIds = [],
  inputs = [],
  outputs = [],
  safetyLevel = 'read_only',
  executionPlan,
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
  steps = [],
  dryRunOnly = false,
  requiresConfirmation = false,
  autoExecute = false,
} = {}) {
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
  const forced = findForcedDisabledActions(text);
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
    checkout: '结账',
    change_2fa: '修改两步验证',
    change_email: '修改账号邮箱',
    change_password: '修改账号密码',
    change_payment: '修改付款设置',
    delete: '删除内容',
    pay: '支付',
    send: '发送内容',
    send_dm: '发送私信',
    submit: '提交表单',
    upload: '上传文件',
  };
  return labels[action] ?? String(action ?? '高风险操作').replace(/_/gu, ' ');
}

function addDisabledRiskCapabilities(context, capabilities, affordances = []) {
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
        userValue: `已禁用${blockedLabel}操作`,
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
          `查看为什么不能${blockedLabel}`,
          `查看${blockedLabel}的安全边界`,
          `保留${blockedLabel}为禁用状态`,
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

function isCatalogCoverageSite(context, pageNodes = [], routeNodes = []) {
  const policy = context.setupProfile?.knownSitePolicy ?? {};
  const pageTypes = knownPolicyPageTypes(context);
  const families = knownPolicyCapabilityFamilies(context);
  const policySignals = [
    policy.primaryArchetype,
    policy.siteKey,
    policy.adapterId,
    ...pageTypes,
    ...families,
  ].join(' ').toLowerCase();
  if (/catalog|author|category|tag|video|book|product/u.test(policySignals)) {
    return true;
  }
  return [...pageNodes, ...routeNodes].some((node) => /^catalog_|product_/u.test(node.classification ?? ''));
}

function catalogCoverageNodes(pageNodes = [], routeNodes = [], classifications = []) {
  const wanted = new Set(classifications);
  return [...pageNodes, ...routeNodes]
    .filter((node) => wanted.has(node.classification))
    .sort((left, right) => String(left.normalizedUrl ?? left.routePattern ?? left.id).localeCompare(
      String(right.normalizedUrl ?? right.routePattern ?? right.id),
      'en',
    ));
}

function catalogCoverageEvidence(context, nodes = [], label = 'catalog coverage') {
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

function catalogCoverageSteps(nodes = []) {
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

function catalogCoverageRouteState(nodes = []) {
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
}) {
  if (!Array.isArray(nodes) || !nodes.length) {
    return;
  }
  const routeState = catalogCoverageRouteState(nodes);
  const capability = makeCapability(context, {
    name,
    description,
    action,
    object,
    userValue,
    entryNodeIds: status === 'active' ? nodes.slice(0, 20).map((node) => node.id) : [],
    requiredNodeIds: status === 'active' ? nodes.slice(0, 20).map((node) => node.id) : [],
    outputs,
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
      steps: catalogCoverageSteps(nodes),
    });
  }
  capabilities.push(capability);
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
    : topicLists.filter((node) => /コラム|メディア|イベント|リリース|タレント情報|TOPICS|更新情報/iu.test(`${node.title ?? ''} ${node.textSummary ?? ''}`));
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
    userValue: '查看更新信息列表（TOPICS 更新情報）',
    nodes: topicLists,
    outputs: [{ name: 'topic_updates', type: 'list' }],
    intents: [
      '查看 TOPICS 更新情報',
      '查看更新信息列表',
      '查看 ALL 更新情報',
    ],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'filter topic updates by category',
    description: 'Browse discovered TOPICS category routes such as コラム, メディア, イベント, リリース, and タレント情報.',
    object: 'topic update categories',
    userValue: '按分类查看更新信息（コラム/メディア/イベント/リリース/タレント情報）',
    nodes: topicCategoryEvidenceNodes,
    outputs: [{ name: 'topic_categories', type: 'list' }],
    intents: [
      '按 コラム 分类查看更新信息',
      '查看 メディア 更新情報',
      '查看 イベント 更新情報',
      '查看 リリース 和 タレント情報',
    ],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'browse topic update archive',
    description: 'Browse discovered TOPICS ARCHIVE month routes.',
    object: 'topic archive routes',
    userValue: '按月份查看更新归档（ARCHIVE）',
    nodes: topicArchives,
    outputs: [{ name: 'topic_archive_months', type: 'list' }],
    intents: [
      '查看 ARCHIVE 更新归档',
      '按月份查看 TOPICS',
      '查看某个月的更新情報',
      '浏览更新信息归档',
    ],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'open topic update detail',
    description: 'Open discovered public TOPICS update detail pages.',
    object: 'topic update detail',
    userValue: '查看更新信息详情（更新情報詳細）',
    nodes: topicDetails,
    outputs: [{ name: 'topic_update_detail', type: 'entity' }],
    intents: [
      '打开更新情報詳細',
      '查看某条更新信息详情',
      '打开 TOPICS 详情',
      '查看活动或公告详情',
    ],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'browse event and media updates',
    description: 'Browse discovered public EVENT / MEDIA routes surfaced by the site.',
    object: 'event and media updates',
    userValue: '查看活动/媒体更新入口（EVENT / MEDIA イベント・メディア情報）',
    nodes: eventMedia,
    outputs: [{ name: 'event_media_entries', type: 'list' }],
    intents: [
      '查看 EVENT / MEDIA',
      '查看イベント・メディア情報',
      '浏览活动媒体信息',
      '打开活动或媒体更新入口',
    ],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'browse release updates',
    description: 'Browse discovered public RELEASE routes surfaced by the site.',
    object: 'release updates',
    userValue: '查看リリース信息列表（RELEASE リリース一覧）',
    nodes: releaseLists,
    outputs: [{ name: 'release_entries', type: 'list' }],
    intents: [
      '查看 RELEASE リリース一覧',
      '浏览リリース信息',
      '查看发布更新列表',
      '打开リリース页面',
    ],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'browse catalog collections',
    description: 'Browse all discovered public catalog, list, latest, and collection routes.',
    object: 'catalog collections',
    userValue: '浏览目录列表',
    nodes: collections.length ? collections : fallbackCollections,
    outputs: [{ name: 'catalog_entries', type: 'list' }],
    intents: ['浏览目录列表', '查看全部内容列表', '打开站点内容目录', '查看最新内容'],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'browse catalog categories',
    description: 'Browse every discovered public category route.',
    object: 'catalog categories',
    userValue: '浏览分类',
    nodes: categories,
    outputs: [{ name: 'categories', type: 'list' }],
    intents: ['浏览分类', '查看所有分类', '打开分类页面', '按分类查看内容'],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'browse catalog tags',
    description: 'Browse every discovered public tag or topic route.',
    object: 'catalog tags',
    userValue: '浏览标签',
    nodes: tags,
    outputs: [{ name: 'tags', type: 'list' }],
    intents: ['浏览标签', '查看标签内容', '按标签筛选内容', '打开标签页面'],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'browse catalog rankings',
    description: 'Browse discovered public ranking, hot, popular, and latest routes.',
    object: 'catalog ranking routes',
    userValue: '浏览排行和最新内容',
    nodes: rankings,
    outputs: [{ name: 'ranked_entries', type: 'list' }],
    intents: ['浏览排行', '查看热门内容', '查看最近更新', '打开最新内容列表'],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'open catalog detail',
    description: 'Open discovered public detail pages from catalog evidence.',
    object: 'catalog detail pages',
    userValue: '打开目录详情',
    nodes: details,
    outputs: [{ name: 'detail', type: 'entity' }],
    intents: ['打开内容详情', '查看公开详情页', '打开条目详情', '查看站点公开详情'],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'open catalog author profile',
    description: 'Open discovered public author, model, actor, performer, or profile routes.',
    object: 'catalog author profiles',
    userValue: '打开作者或演员页面',
    nodes: authors,
    outputs: [{ name: 'profile', type: 'entity' }],
    intents: ['打开作者页面', '查看演员页面', '查看作者资料', '按作者浏览内容'],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'browse catalog pagination',
    description: 'Follow discovered read-only pagination routes inside the catalog.',
    object: 'catalog pagination',
    userValue: '浏览分页',
    nodes: pagination,
    outputs: [{ name: 'page', type: 'list' }],
    intents: ['浏览下一页', '查看分页内容', '继续翻页', '打开更多列表页'],
  });

  addCatalogCoverageCapability(context, capabilities, {
    name: 'read public catalog metadata',
    description: 'Read public metadata structure from discovered catalog routes without storing raw page bodies.',
    object: 'public catalog metadata',
    userValue: '读取公开目录元数据',
    nodes: publicMetadataNodes,
    outputs: [{ name: 'metadata', type: 'sanitized_summary' }],
    intents: ['读取公开内容元数据', '汇总目录元数据', '查看公开条目信息', '提取公开列表摘要'],
  });

  if (searchForm && !capabilities.some((capability) => capability.name === 'search catalog content')) {
    const capability = makeCapability(context, {
      name: 'search catalog content',
      description: 'Prepare a read-only search query against the discovered catalog search form.',
      action: 'search',
      object: 'catalog content',
      userValue: '搜索站内内容',
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
      intents: ['搜索站内内容', '搜索视频或作品', '按关键词查找内容', '查找目录条目'],
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
      userValue: '下载内容（需安全适配器）',
      nodes: details.length ? details : publicMetadataNodes,
      outputs: [{ name: 'download_task', type: 'disabled_safety_boundary' }],
      intents: ['下载内容', '下载视频', '保存目录条目', '下载作品'],
      confidence: 0.5,
      status: 'disabled',
      riskLevel: 'download_high',
      activationBlockedReason: knownPolicyDownloadReasonCode(context),
    });
  }
}

function addUserAuthorizedKnownSiteCapabilities(context, capabilities, homepage) {
  if (!homepage || !userAuthorizedEvidencePages(context).length || !context.setupProfile?.knownSitePolicy) {
    return;
  }
  const supported = knownPolicySupportedIntents(context);
  const families = knownPolicyCapabilityFamilies(context);
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
    inputs = [],
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
  if (supported.has('list-followed-users') || families.has('query-social-relations')) {
    add({
      name: 'list followed users',
      description: 'List followed users through the bounded known-site adapter using user-authorized browser state.',
      object: 'followed users',
      userValue: 'Inspect followed accounts without account mutation.',
      intentAction: 'followed-users',
      setupCapabilityId: 'list-followed-users',
    });
  }
  if (supported.has('list-followed-updates') || families.has('query-social-content')) {
    add({
      name: 'list followed updates',
      description: 'List followed updates through the bounded known-site adapter using user-authorized browser state.',
      object: 'followed updates',
      userValue: 'Read updates from followed accounts without posting or mutating account state.',
      intentAction: 'followed-posts-by-date',
      setupCapabilityId: 'list-followed-updates',
    });
  }
  if (supported.has('recommended-timeline-posts') || supported.has('list-recommended-timeline-posts') || families.has('query-social-content')) {
    add({
      name: 'list recommended timeline posts',
      description: 'List recommended timeline posts through a bounded user-authorized known-site adapter path.',
      object: 'recommended timeline posts',
      userValue: 'Read personalized recommended timeline posts without posting, liking, following, or account mutation.',
      intentAction: 'recommended-timeline-posts',
      setupCapabilityId: 'recommended-timeline-posts',
    });
  }
  if (supported.has('profile-content') || supported.has('list-profile-content') || families.has('query-social-content') || families.has('query-account-profile')) {
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

async function discoverCapabilitiesStage(context, stageResults) {
  const graph = requireStage(stageResults, 'classifyNodes').graph;
  const { affordances } = requireStage(stageResults, 'extractAffordances');
  const capabilities = [];
  const pageNodes = graph.nodes.filter((node) => node.type === 'page');
  const homepage = pageNodes.find((node) => node.classification === 'homepage') ?? pageNodes[0];
  const newsChannels = pageNodes.filter((node) => node.classification === 'news_channel');
  const newsArticle = pageNodes.find((node) => node.classification === 'article_detail');
  const isNewsSite = Boolean(newsChannels.length || newsArticle || /news|新闻/iu.test(`${context.site.rootUrl} ${homepage?.title ?? ''} ${homepage?.textSummary ?? ''}`));
  const productList = pageNodes.find((node) => node.classification === 'product_list');
  const productDetail = pageNodes.find((node) => node.classification === 'product_detail');
  const searchForm = affordances.find((affordance) => affordance.kind === 'form' && affordance.safety === 'read_only' && /search/iu.test(`${affordance.label ?? ''} ${affordance.endpoint ?? ''}`));
  const contactForm = affordances.find((affordance) => affordance.kind === 'form' && affordance.safety === 'state_changing' && /contact|support|message/iu.test(`${affordance.label ?? ''} ${affordance.endpoint ?? ''} ${affordance.evidence?.[0]?.text ?? ''}`));

  if (homepage) {
    const capability = makeCapability(context, {
      name: isNewsSite ? 'view news homepage' : 'view homepage',
      description: isNewsSite ? 'Open and inspect the public news homepage.' : 'Open and inspect the public homepage.',
      action: 'view',
      object: isNewsSite ? 'news homepage' : 'homepage',
      userValue: 'Understand the site entry point and navigation.',
      entryNodeIds: [homepage.id],
      outputs: [{ name: 'page', type: 'html' }],
      safetyLevel: 'read_only',
      evidence: homepage.evidence,
      confidence: 0.95,
      informational: true,
    });
    capability.executionPlan = buildExecutionPlan(capability.id, {
      mode: 'read_only',
      steps: [{ kind: 'navigate', url: homepage.normalizedUrl, nodeId: homepage.id }],
    });
    capabilities.push(capability);
  }

  if (newsChannels.length) {
    const primaryChannel = newsChannels[0];
    const capability = makeCapability(context, {
      name: 'browse news channels',
      description: 'Open public news channel or feed pages discovered from site evidence.',
      action: 'view',
      object: 'news channels',
      userValue: 'Browse channel-level news lists and feeds.',
      entryNodeIds: newsChannels.map((node) => node.id),
      outputs: [{ name: 'articles', type: 'list' }],
      safetyLevel: 'read_only',
      evidence: newsChannels.flatMap((node) => node.evidence).slice(0, 5),
      confidence: 0.86,
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

  if (newsArticle) {
    const capability = makeCapability(context, {
      name: 'view news article details',
      description: 'Open a public news article page and inspect the article content.',
      action: 'view',
      object: 'news article',
      userValue: 'Read article-level news details.',
      entryNodeIds: [newsArticle.id],
      outputs: [{ name: 'article', type: 'entity' }],
      safetyLevel: 'read_only',
      evidence: newsArticle.evidence,
      confidence: 0.84,
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

  if (searchForm) {
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
      userValue: '创建联系表单草稿（不自动提交）',
      entryNodeIds: [contactForm.nodeId],
      requiredNodeIds: [contactForm.nodeId],
      inputs: contactForm.inputs ?? [],
      outputs: [{ name: 'draft', type: 'form_submission_preview' }],
      safetyLevel,
      evidence: contactForm.evidence,
      confidence: 0.75,
      intents: [
        '创建联系表单草稿',
        '预览 CONTACT / FAN LETTER 表单',
        '准备客服消息但不提交',
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

  addGenericCatalogCoverageCapabilities(context, capabilities, graph, searchForm);
  addUserAuthorizedKnownSiteCapabilities(context, capabilities, homepage);
  addDisabledRiskCapabilities(context, capabilities, affordances);
  capabilities.push(...generateAutoCapabilities(context, {
    graph,
    affordances,
    existingCapabilities: capabilities,
  }));

  capabilities.push(makeCapability(context, {
    name: 'capture network APIs',
    description: 'Network API capture was not available in this static build.',
    action: 'track',
    object: 'network traces',
    userValue: 'Candidate only until instrumentation exists.',
    entryNodeIds: homepage ? [homepage.id] : [],
    safetyLevel: 'read_only',
    evidence: [],
    confidence: 0,
    status: 'candidate',
    informational: true,
  }));

  const policyApplied = dedupeSemanticCapabilities(arrayUniqueBy(capabilities, (capability) => capability.id)
    .map((capability) => enrichAutoCapability(context, capability))
    .map((capability) => applyCapabilityRiskPolicy(capability)))
    .sort((left, right) => left.id.localeCompare(right.id, 'en'));
  const privacyMode = context.options?.privacyMode ?? context.options?.privacy ?? 'limited';
  const merged = privacyMode === 'strict'
    ? policyApplied.filter((capability) => !shouldSkipInStrictPrivacy(capability))
    : policyApplied;
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
      utteranceExamples: ['帮我看新闻首页', 'open the news homepage', 'show the news homepage'],
      negativeExamples: ['submit a comment', 'log in to my account'],
      slots: [],
      invocationScore: 0.96,
    };
  }
  if (capability.name === 'browse news channels') {
    return {
      canonicalUtterance: 'browse news channels',
      utteranceExamples: ['帮我浏览新闻频道', 'browse news channels', 'show news channel pages'],
      negativeExamples: ['post a comment', 'upload a video'],
      slots: [],
      invocationScore: 0.9,
    };
  }
  if (capability.name === 'view news article details') {
    return {
      canonicalUtterance: 'view news article details',
      utteranceExamples: ['open a news article', 'read a news article detail page', 'follow an internal news article link'],
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
        '读取时间线上被推荐的帖子',
        '读取推荐时间线帖子',
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

async function generateIntentsStage(context, stageResults) {
  const { capabilities } = requireStage(stageResults, 'discoverCapabilities');
  const activeCapabilities = capabilities.filter((capability) => capability.status === 'active');
  const intents = generateAutoIntentRecords(context, capabilities, { includeCandidateDebug: false });
  const capabilityIds = new Set(capabilities.map((capability) => capability.id));
  for (const intent of intents) {
    assertUserIntent(intent, capabilityIds);
  }
  const payload = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    siteId: context.site.id,
    skillId: context.skillId,
    intents,
    summary: {
      intents: intents.length,
      activeCapabilities: activeCapabilities.length,
      callableIntents: intents.filter((intent) => intent.callable !== false).length,
      nonCallableIntents: intents.filter((intent) => intent.callable === false).length,
    },
  };
  const intentsPath = await writeArtifactJson(context, 'intents.json', payload);
  return {
    intents,
    artifactPaths: { intents: intentsPath },
    summary: payload.summary,
  };
}

function selectInvocationProbe(context, capabilities = [], intents = []) {
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

function buildRegistryRecord(context, stageResults) {
  const { capabilities } = requireStage(stageResults, 'discoverCapabilities');
  const { intents } = requireStage(stageResults, 'generateIntents');
  const activeCapabilitiesById = new Map(capabilities.filter((capability) => capability.status === 'active').map((capability) => [capability.id, capability]));
  const callableIntents = intents.filter((intent) => activeCapabilitiesById.has(intent.capabilityId) && intent.callable !== false);
  return {
    skillId: context.skillId,
    siteId: context.site.id,
    domains: context.site.allowedDomains,
    skillDir: path.relative(context.cwd, context.skillDir).replace(/\\/gu, '/'),
    artifactDir: path.relative(context.cwd, context.artifactDir).replace(/\\/gu, '/'),
    intents: callableIntents.map((intent) => {
      const capability = activeCapabilitiesById.get(intent.capabilityId);
      return {
        intentId: intent.id,
        name: intent.name,
        capabilityId: intent.capabilityId,
        capabilityName: capability?.name ?? intent.name,
        capabilityAction: capability?.action ?? null,
        executionPlanId: capability?.executionPlan?.id ?? null,
        canonicalUtterance: intent.canonicalUtterance,
        utteranceExamples: intent.utteranceExamples,
        safetyLevel: intent.safetyLevel,
        invocationScore: intent.invocationScore,
      };
    }),
    verificationStatus: 'passed',
  };
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
  const errors = report.errors ?? [];
  const warnings = report.warnings ?? [];
  const verificationPath = await writeArtifactJson(context, 'verification_report.json', report);
  if (report.status !== 'passed') {
    const error = new Error(`Skill verification failed [${report.reasonCode ?? 'validation-failed'}]: ${report.errors?.[0] ?? 'unknown error'}`);
    error.code = 'skill-verification-failed';
    error.failureClass = report.failureClass ?? 'validation';
    error.reasonCode = report.reasonCode ?? 'validation-failed';
    error.reasonAction = report.reasonAction ?? null;
    error.verificationReport = report;
    error.verificationReportPath = verificationPath;
    throw error;
  }
  const generatedSkill = requireStage(stageResults, 'generateSkill');
  generatedSkill.manifest.verification = {
    status: 'passed',
    report: 'verification_report.json',
    invocationLookup: report.gates.registryLookup,
  };
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

async function writeNonRegisteredRegistryReport(context, status, reasonCode, extra = {}) {
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

async function registerSkillStage(context, stageResults) {
  const verification = requireStage(stageResults, 'verifySkill').verificationReport;
  if (verification.status !== 'passed') {
    throw new Error('Registry update blocked because verification did not pass.');
  }
  const writeMode = siteForgeWriteMode(context);
  if (writeMode === 'preview_only' || writeMode === 'draft_only') {
    return await writeNonRegisteredRegistryReport(
      context,
      writeMode === 'draft_only' ? 'draft' : 'preview',
      writeMode === 'draft_only' ? 'write-mode-draft-only' : 'write-mode-preview-only',
      { writeMode },
    );
  }
  const promotion = await promoteVerifiedBuild(context, stageResults);
  context.skillDir = promotion.activeSkillDir ?? promotion.currentDir;
  if (writeMode === 'current_only') {
    const lastSuccessfulBuildPath = await writeLastSuccessfulBuild(context.workspace, promotion.lastSuccessfulBuild);
    return await writeNonRegisteredRegistryReport(context, 'current-updated', 'write-mode-current-only', {
      writeMode,
      lastSuccessfulBuildPath,
      promotion,
    });
  }
  const registry = await readSkillRegistry(context.registryPath);
  const record = buildRegistryRecord(context, stageResults);
  const nextRegistry = upsertSkillRegistryRecord(registry, record, new Date().toISOString());
  const capabilities = requireStage(stageResults, 'discoverCapabilities').capabilities;
  const intents = requireStage(stageResults, 'generateIntents').intents;
  const invocationProbe = selectInvocationProbe(context, capabilities, intents);
  const lookup = lookupSkillIntentFromRegistry(nextRegistry, {
    domain: invocationProbe.domain,
    utterance: invocationProbe.utterance,
  });
  if (lookup.status !== 'found') {
    throw new Error('Registry lookup failed after registration.');
  }
  await writeGeneratedJson(context, context.registryPath, nextRegistry);
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
  };
  const registryReportPath = await writeArtifactJson(context, 'registry_report.json', registryReport);
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
}

function classifyBuildFailure(error, stageRecords) {
  const reasonEntries = [
    ...Object.values(stageRecords ?? {}).flatMap((stage) => (stage.reasonCodes ?? []).map((reasonCode) => ({ reasonCode }))),
    ...(error?.reasonCode ? [{ reasonCode: error.reasonCode }] : []),
    ...(error?.verificationReport?.reasonCode ? [{ reasonCode: error.verificationReport.reasonCode }] : []),
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
    return 'Browser-rendered crawl is not part of the public build path; this run used static and sanitized setup evidence only.';
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
  const outcomes = [];
  const capabilities = stageResults.discoverCapabilities?.capabilities ?? [];
  for (const capability of capabilities) {
    if (capability.status === 'active') {
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

function isDebugOnlyCapability(capability = {}) {
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

function capabilitySortText(capability = {}) {
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

function capabilityUserSortRank(capability = {}) {
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

function sortCapabilitiesForUser(capabilities = []) {
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

function userReportGroupForCapability(capability = {}) {
  const status = normalizeCapabilityEnablementStatus(capability);
  if (status === 'enabled') return 'enabled';
  if (status === 'limited_enabled') return 'limited_enabled';
  if (status === 'confirmation_required' || status === 'draft_only') return 'confirmation_required';
  return 'disabled';
}

function userCapabilityReason(capability = {}) {
  if (capability.user_reason) {
    return capability.user_reason;
  }
  const text = `${capability.name ?? ''} ${capability.object ?? ''}`.toLowerCase();
  if (isDebugOnlyCapability(capability)) {
    return '只是候选能力，证据还不够，默认不会启用。';
  }
  if (capability.risk_level === 'account_security_critical') {
    return '涉及账号安全或付款设置，默认禁用。';
  }
  if (capability.risk_level === 'write_high') {
    if (/direct message|dm/u.test(text)) {
      return '涉及私信、收件人或发送动作，默认禁用。';
    }
    return '涉及发布、互动、删除、上传或关注等写入动作，默认禁用。';
  }
  if (capability.risk_level === 'read_private_high') {
    return '可能包含私密正文或私人会话内容，默认禁用。';
  }
  if (capability.risk_level === 'read_personal_medium') {
    return '属于个人化或登录后可见的信息，需要受限摘要或确认。';
  }
  if (capability.risk_level === 'write_low') {
    return '只允许生成草稿预览，不会提交。';
  }
  return '只保存脱敏结构摘要，不保存正文或账号私密材料。';
}

function userCapabilityStrategy(capability = {}) {
  if (capability.user_strategy) {
    return capability.user_strategy;
  }
  const status = normalizeCapabilityEnablementStatus(capability);
  if (status === 'limited_enabled') {
    return '仅返回受限脱敏摘要。';
  }
  if (status === 'confirmation_required') {
    return '执行前需要用户确认。';
  }
  if (status === 'draft_only' || capability.default_policy === 'draft_only') {
    return '只生成草稿，不提交、不上传、不选择敏感收件人。';
  }
  if (status === 'disabled' || capability.default_policy === 'disabled' || capability.status !== 'active') {
    return '默认禁用，不会自动执行。';
  }
  return '默认只读，输出保持脱敏。';
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

function buildCapabilityCard(capability = {}) {
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

function buildCapabilityStateModel(capabilities = []) {
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

function isHighRiskOrAccountDisabled(card = {}) {
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
    return '无法取得 robots.txt，实时构建已安全停止';
  }
  if (reasonCode === 'robots-disallowed') {
    return 'robots.txt 阻止了本次候选采集范围';
  }
  if (reasonCode === 'network-fetch-failed') {
    return '网络抓取失败，未保存原始错误详情';
  }
  if (reasonCode === 'dynamic-unsupported') {
    return '当前路径需要动态采集能力，本次未启用';
  }
  if (reasonCode === 'validation-failed') {
    return '验证未通过，详细门禁结果见 verification_report.json';
  }
  if (/maxSeeds=/u.test(text)) {
    return '种子发现达到上限，剩余入口未采集';
  }
  if (/maxSitemaps=/u.test(text)) {
    return '站点地图发现达到上限，剩余 sitemap 未采集';
  }
  if (/maxPages=/u.test(text)) {
    return '静态抓取达到页面上限，剩余页面未采集';
  }
  if (/user-authorized browser evidence|sanitized user-authorized browser evidence/iu.test(text)) {
    return '只使用受限的用户授权浏览器证据摘要';
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
} = {}) {
  const groups = capabilityState?.groups ?? {};
  const evidenceSummary = capabilityState?.evidence_status_summary ?? {};
  const reasons = [];
  const reportReasonCode = safePublicReasonCode(report?.reasonCode);
  if (reportReasonCode) {
    const publicReason = partialSuccessReasonFromWarning(reportReasonCode);
    if (publicReason) {
      reasons.push(publicReason);
    }
  }
  if ((groups.confirmation_required ?? []).length > 0) {
    reasons.push(`${groups.confirmation_required.length} 个能力需要用户确认后才能启用或只能生成草稿`);
  }
  const highRiskDisabled = (groups.disabled ?? []).filter(isHighRiskOrAccountDisabled).length;
  if (highRiskDisabled > 0) {
    reasons.push(`${highRiskDisabled} 个高风险写入、私密或账号能力已默认禁用`);
  }
  if (context?.options?.deep !== true) {
    reasons.push('本次未启用深度浏览器探索');
  }
  if (context?.policy?.captureNetwork !== true) {
    reasons.push('本次未启用脱敏网络摘要探索');
  }
  const privacyMode = String(context?.options?.privacyMode ?? context?.options?.privacy ?? '').toLowerCase();
  if (privacyMode === 'strict') {
    reasons.push('strict privacy 会跳过敏感个人能力');
  }
  if (Number(evidenceSummary.inferred ?? 0) > 0) {
    reasons.push(`${Number(evidenceSummary.inferred ?? 0)} 个能力仍是推断证据`);
  }
  if ((groups.limited_enabled ?? []).length > 0) {
    reasons.push(`${groups.limited_enabled.length} 个敏感只读能力仅以脱敏结构摘要方式有限启用`);
  }
  const missingSetupEvidence = Number(setupCollectionReview?.missingRecordCount ?? 0) > 0
    || Number(setupCollectionReview?.summary?.capabilities?.missing ?? 0) > 0
    || Number(setupCollectionReview?.summary?.intents?.missing ?? 0) > 0;
  if (missingSetupEvidence) {
    reasons.push('有能力还缺少确认或能力级证据');
  }
  const warningReasons = uniqueSortedStrings((report?.warnings ?? [])
    .map((warning) => partialSuccessReasonFromWarning(warning))
    .filter(Boolean));
  if (warningReasons.length) {
    reasons.push(...warningReasons);
  } else if ((report?.warnings ?? []).some((warning) => String(warning).trim() && !/debug/iu.test(String(warning)))) {
    reasons.push('构建存在已脱敏的采集或验证警告');
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

function summarizeNodes(stageResults = {}) {
  const nodes = stageResults.classifyNodes?.graph?.nodes
    ?? stageResults.buildSiteGraph?.graph?.nodes
    ?? [];
  const byType = {};
  const byClassification = {};
  let authRequired = 0;
  for (const node of nodes) {
    const type = node.type ?? 'unknown';
    const classification = node.classification ?? 'unclassified';
    byType[type] = (byType[type] ?? 0) + 1;
    byClassification[classification] = (byClassification[classification] ?? 0) + 1;
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
    auth_required: authRequired,
  };
}

function summarizePrivacy(context, report) {
  const privacyMode = context.options?.privacyMode ?? context.options?.privacy ?? 'limited';
  const networkRequested = context.policy?.captureNetwork === true || context.options?.network === true;
  return {
    mode: privacyMode,
    credential_material_persisted: false,
    runtime_sensitive_material_persisted: false,
    browser_state_material_persisted: false,
    raw_network_traces_persisted: false,
    sanitized_reports: true,
    network_capture_requested: networkRequested,
    network_summary_only: networkRequested,
    redaction_required: true,
    warning_codes: report.warningCodes ?? [],
  };
}

function buildUserFacingWarnings(report, resultStatus, context = null, partialSuccessReasons = []) {
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
  if (resultStatus === 'failed' && report.reason) {
    warnings.push(report.reason);
  }
  return uniqueSortedStrings(warnings);
}

function buildNextSteps({ resultStatus, context, report, confirmationRequired, disabledCapabilities, confirmationPaths }) {
  const steps = [];
  if (resultStatus === 'success') {
    steps.push('Use the generated skill for the enabled read-only capabilities.');
  } else if (resultStatus === 'partial_success') {
    steps.push('Use the enabled low-risk read-only capabilities now.');
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
      steps.push('Run with --network only when a sanitized network summary is needed; raw traces are not saved.');
    }
    if (
      context.setupProfile?.userAuthorizedEvidence?.autoDiscovery?.status === 'modeled'
      && (
        context.setupProfile.userAuthorizedEvidence.autoDiscovery.dynamicEnabled !== true
        || context.setupProfile.userAuthorizedEvidence.autoDiscovery.networkEnabled !== true
      )
    ) {
      steps.push('Internal operator deep mode: node src/entrypoints/pipeline/run-pipeline.mjs <url> --auto --deep --network.');
    }
    if (disabledCapabilities.length) {
      steps.push('For disabled capabilities, write a safe remediation plan: immediate entries use limited summaries or draft previews; adapter entries need explicit site adapter validation before use.');
      if (confirmationPaths?.disabled?.review_command) {
        steps.push(`Review disabled capabilities: ${confirmationPaths.disabled.review_command}.`);
      }
    }
  } else {
    steps.push(report.reasonAction ?? report.reason ?? 'Fix the reported blocker and rerun the build.');
  }
  return uniqueSortedStrings(steps);
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
    counts,
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
      skill_id: skillId,
      report_path: relativeReportPath(context.cwd, report.artifacts?.[USER_REPORT_FILE] ?? path.join(context.artifactDir, USER_REPORT_FILE)),
    },
    privacy_summary: summarizePrivacy(context, report),
    saved_material: SANITIZED_SUMMARY_ONLY,
    page_structure_source_saved: false,
    page_source_saved: false,
    page_content_saved: false,
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
    warnings_user_facing: buildUserFacingWarnings(report, resultStatus, context, partialSuccessReasons),
  };
}

function summarizeStageRecords(stageRecords = {}) {
  return Object.fromEntries(Object.entries(stageRecords).map(([name, record]) => [name, {
    status: record.status ?? null,
    reasonCode: record.reasonCode ?? null,
    reasonCodes: record.reasonCodes ?? [],
    warnings: record.warnings ?? [],
    errors: record.errors ?? [],
    summary: record.summary ?? {},
  }]));
}

function sanitizedNetworkSummary(context, stageResults = {}) {
  const sourceDiagnostics = context.setupProfile?.sourceDiagnostics ?? [];
  const networkStage = stageResults.captureNetworkTraces ?? null;
  return {
    requested: context.policy?.captureNetwork === true || context.options?.network === true,
    raw_traces_persisted: false,
    saved_summary_only: true,
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
  };
}

function buildRouteStateGraph(stageResults = {}) {
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
    },
    report_index: {
      default_report: 'user',
      available_reports: ['user', 'debug'],
      user_report: USER_REPORT_FILE,
      user_markdown: USER_REPORT_MARKDOWN_FILE,
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

function renderLegacySiteForgeBuildSummary(result, options = {}) {
  return renderSiteForgeBuildDebugSummary(result, options);
}

function renderBuildUserMarkdown(userReport, report, options = {}) {
  return renderFriendlySiteForgeUserBuildSummary({
    ...report,
    user_report: userReport,
  }, options);
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
  const setupCollectionReview = setupCollectionReviewReport(
    context.setupCollectionReview,
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
    },
    setupCollectionReview,
    capabilityState,
  });
  const registryReport = stageResults.registerSkill?.registryReport ?? null;
  const promotion = stageResults.registerSkill?.promotion ?? registryReport?.promotion ?? null;
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
      activeCapabilities: activeCapabilities.length,
      intents: intents.length,
      verificationStatus: stageResults.verifySkill?.verificationReport?.status ?? null,
      verificationReasonCode: stageResults.verifySkill?.verificationReport?.reasonCode ?? error?.verificationReport?.reasonCode ?? null,
      registryStatus: stageResults.registerSkill?.registryReport?.status ?? null,
      registryRegistered: registryReport?.status === 'registered',
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
  const userReport = buildUserReport(context, stageResults, report);
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
      userReportAlias: userReportAliasWrite.artifactPath,
      userMarkdownAlias: userMarkdownAliasPath,
      debugReportAlias: debugReportAliasWrite.artifactPath,
    },
    summary: report.summary,
  };
}

async function writeFailedBuildReport(context, stageResults, stageRecords, status, error) {
  const failedReport = buildBuildReport(context, stageResults, stageRecords, status, error);
  const userReport = buildUserReport(context, stageResults, failedReport);
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
  crawlRendered: crawlRenderedStage,
  discoverInteractions: discoverInteractionsStage,
  captureNetworkTraces: captureNetworkTracesStage,
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

export async function runSiteForgeBuild(inputUrl, options = {}) {
  const context = createInitialContext(inputUrl, options);
  await hydrateBuildProfile(context);
  await ensureSiteWorkspace(context.workspace, context.site, { nowIso: context.startedAt });
  await ensureBuildDirectories(context);
  const stageResults = {};
  const stageRecords = {};
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

function buildReportPayloadForMode(result, options = {}) {
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

export function siteForgeBuildCliJson(result, options = {}) {
  return `${prepareRedactedArtifactJsonWithAudit(buildReportPayloadForMode(result, options)).json}\n`;
}

function displayBuildWarning(value) {
  const text = String(value ?? '');
  if (text === 'Browser-rendered crawl is unavailable for this deterministic static build path.') {
    return '确定性静态构建路径中无法使用浏览器渲染采集。';
  }
  if (text === 'Browser-rendered crawl is not part of the public build path; this run used static and sanitized setup evidence only.') {
    return '本次使用静态和脱敏设置证据；公开构建路径不进行浏览器渲染采集。';
  }
  if (text === 'Network instrumentation is unavailable in the static fixture build path.') {
    return '静态 fixture 构建路径中无法使用网络监听。';
  }
  if (text === 'Network summary was not requested; raw network tracing is not part of the public build path.') {
    return '未请求脱敏网络摘要；公开构建路径不保存原始网络 trace。';
  }
  if (text === 'Network capture requested; raw network traces were not persisted, and this build path only writes a sanitized network summary.') {
    return 'Network capture requested; only a sanitized network summary was saved.';
  }
  if (text === 'Network summary requested; raw network traces were not captured or persisted.') {
    return '已请求脱敏网络摘要；未捕获或保存原始网络 trace。';
  }
  if (text === 'Auto-discovery used sanitized SPA route/state summaries; browser-rendered crawl and raw network tracing are not enabled in this public build path.') {
    return '自动探索使用脱敏 SPA 路由/状态摘要；公开构建路径不启用浏览器渲染采集或原始网络 trace。';
  }
  if (text === 'generic crawler skipped; using bounded user-authorized browser evidence summary.') {
    return '已跳过通用采集器，改用受限的用户授权浏览器证据摘要。';
  }
  if (text === 'using sanitized user-authorized browser evidence; unredacted page structure and session material were not persisted.') {
    return '正在使用已清洗的用户授权浏览器证据；未保存页面结构原文或会话材料。';
  }
  if (text === 'network-fetch-failed') {
    return '网络抓取失败；未保存原始错误详情。';
  }
  if (text === 'validation-failed') {
    return '验证未通过；详细门禁结果见 verification_report.json。';
  }
  if (text === 'robots-unavailable') {
    return '无法取得 robots.txt，实时构建已安全停止。';
  }
  if (text === 'robots-disallowed') {
    return 'robots.txt 阻止了本次候选采集范围。';
  }
  if (text === 'dynamic-unsupported') {
    return '当前路径需要动态采集能力，本次未启用。';
  }
  const setupProfile = text.match(/^setup profile marked unusable; build skipped before activating capabilities \(reasonCode=([^)]+)\)\.$/u);
  if (setupProfile) {
    return `设置资料标记为不可用，已在激活能力前跳过构建（reasonCode=${setupProfile[1]}）。`;
  }
  if (text === 'Skipped because setup profile is not buildable.') {
    return '已跳过，因为设置资料当前不可用于构建。';
  }
  const skipped = text.match(/^Skipped because ([A-Za-z][A-Za-z0-9]*) ([a-z_]+)\.$/u);
  if (skipped) {
    return `已跳过，因为阶段 ${skipped[1]} 状态为 ${collectionStatusLabel(skipped[2])}。`;
  }
  const crawlFailed = text.match(/^crawl failed: (.+)$/u);
  if (crawlFailed) {
    return `采集失败：${crawlFailed[1]}`;
  }
  return text;
}

function displayCollectionKind(value) {
  if (value === 'capability') return '能力';
  if (value === 'node') return '节点';
  if (value === 'affordance') return '可操作元素';
  if (value === 'stage') return '阶段';
  if (value === 'build') return '构建';
  return String(value ?? '-');
}

function displayCollectionTarget(value) {
  const text = String(value ?? '');
  if (text === 'list followed users') return '读取关注列表';
  if (text === 'list followed updates') return '读取关注动态';
  if (text === 'list recommended timeline posts') return '读取推荐时间线帖子';
  if (text === 'list profile content') return '读取个人主页内容';
  if (text === 'search posts') return '搜索帖子';
  if (text === 'list notifications') return '读取通知摘要';
  if (text === 'list bookmarks') return '读取书签摘要';
  if (text === 'list lists') return '读取列表摘要';
  if (text === 'list direct messages') return '读取私信会话摘要';
  if (text === 'capture network APIs') return '脱敏网络摘要候选';
  if (text === 'registerSite') return '站点注册';
  if (text === 'discoverSeeds') return '种子发现';
  if (text === 'crawlStatic') return '静态页面采集';
  if (text === 'captureNetworkTraces') return '网络监听采集';
  if (text === 'crawlRendered') return '浏览器渲染采集';
  if (text === 'discoverInteractions') return '交互发现';
  if (text === 'buildSiteGraph') return '站点图谱构建';
  if (text === 'classifyNodes') return '节点分类';
  if (text === 'extractAffordances') return '可操作元素提取';
  if (text === 'discoverCapabilities') return '能力发现';
  if (text === 'generateIntents') return '意图生成';
  if (text === 'generateSkill') return 'Skill 生成';
  if (text === 'verifySkill') return 'Skill 验证';
  if (text === 'registerSkill') return 'Skill 注册';
  if (text === 'writeBuildReport') return '构建报告写入';
  return text || '-';
}

function displayCollectionReason(item) {
  const reasonCode = String(item?.reasonCode ?? '');
  if (reasonCode === 'capability-specific-evidence-required') {
    return '已识别，但缺少该能力的内容级证据。';
  }
  if (reasonCode === 'authorized-route-seed-only') {
    return '只采集到授权路由种子，尚未验证该页面内容。';
  }
  if (reasonCode === 'not-selected-by-setup') {
    return '本次设置未选择，保留为候选能力。';
  }
  if (reasonCode === 'capability-candidate') {
    return '候选能力尚未满足激活条件。';
  }
  if (String(item?.reason ?? '') === 'Browser-rendered crawl is unavailable for this deterministic static build path.') {
    return '当前确定性构建路径不能进行浏览器渲染采集。';
  }
  if (String(item?.reason ?? '') === 'Browser-rendered crawl is not part of the public build path; this run used static and sanitized setup evidence only.') {
    return '当前公开构建路径不进行浏览器渲染采集。';
  }
  if (String(item?.reason ?? '') === 'Network instrumentation is unavailable in the static fixture build path.') {
    return '当前静态构建路径不能进行网络监听。';
  }
  if (String(item?.reason ?? '') === 'Network summary requested; raw network traces were not captured or persisted.') {
    return '只保存脱敏网络摘要；未捕获或保存原始网络 trace。';
  }
  if (reasonCode === 'stage-skipped') {
    return '上游阶段未完成，已跳过本阶段。';
  }
  if (reasonCode === 'stage-failed') {
    return '本阶段失败，未产出可验证结果。';
  }
  if (reasonCode === 'stage-blocked') {
    return '本阶段被安全或证据门禁阻止，未产出可验证结果。';
  }
  if (reasonCode === 'empty-crawl') {
    return '静态采集没有获得可验证页面证据。';
  }
  if (reasonCode === 'robots-disallowed') {
    return 'robots.txt 阻止了本次候选采集范围。';
  }
  if (reasonCode === 'robots-unavailable') {
    return '无法取得 robots.txt，实时构建已安全停止。';
  }
  if (reasonCode === 'dynamic-unsupported') {
    return displayBuildWarning(item?.reason ?? '当前路径需要动态采集能力，本次未激活。');
  }
  if (reasonCode === 'network-fetch-failed') {
    return '网络抓取失败，未获得可验证页面证据。';
  }
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
  return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
}

function renderCollectionOutcomeTable(outcomes = []) {
  const rows = [
    '  | 类型 | 对象 | 状态 | 原因 |',
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
    '采集复核：',
    `  已采集：种子=${summary.seeds?.collected ?? 0} 节点=${summary.nodes?.collected ?? 0} 可操作元素=${summary.affordances?.collected ?? 0} 能力=${summary.capabilities?.collected ?? 0} 意图=${summary.intents?.collected ?? 0}`,
    `  需要补采：能力=${capabilityMissing} 意图=${intentMissing}`,
  ];
  const missingRecords = review.missingRecords ?? [];
  if (missingRecords.length) {
    lines.push('  未采集证据：');
    for (const record of missingRecords.slice(0, 5)) {
      lines.push(`    - ${record.kind}:${record.label ?? record.id ?? '-'} (${record.reasonCode ?? 'missing-evidence'})`);
    }
    if (review.truncated || missingRecords.length > 5) {
      lines.push('    - 完整采集复核见 build_report.json。');
    }
  }
  return lines;
}

function renderSiteForgeUserBuildSummary(result, options = {}) {
  return renderFriendlySiteForgeUserBuildSummary(result, options);
}

export function renderSiteForgeBuildSummary(result, options = {}) {
  const mode = normalizeReportMode(
    options.reportMode ?? options.report ?? (options.debug || options.verbose ? 'debug' : 'user'),
  );
  const userSummary = renderSiteForgeUserBuildSummary(result, options);
  if (mode === 'user') {
    return userSummary;
  }
  const debugPath = result.artifacts?.[DEBUG_REPORT_FILE]
    ?? result.artifacts?.[DEBUG_REPORT_JSON_ALIAS]
    ?? DEBUG_REPORT_FILE;
  const indexPath = result.artifacts?.[INDEX_REPORT_FILE] ?? INDEX_REPORT_FILE;
  return `${userSummary}\n开发者详情报告\n  - Debug JSON: ${displayPath(debugPath, options.cwd)}\n  - 报告索引: ${displayPath(indexPath, options.cwd)}\n`;
}

export function renderSiteForgeBuildDebugSummary(result, options = {}) {
  const counts = result.summary ?? {};
  const capabilityCountsSummary = counts.capabilities ?? {};
  const lines = [
    `SiteForge 构建${buildStatusLabel(result.status)}`,
    '',
    `站点 ID：${result.siteId}`,
    `构建 ID：${result.buildId}`,
    `种子：${counts.seeds ?? 0}`,
    `节点：${counts.nodes ?? 0}`,
    `可操作元素：${counts.affordances ?? 0}`,
    `能力：活跃=${capabilityCountsSummary.active ?? 0} 候选=${capabilityCountsSummary.candidate ?? 0} 丢弃=${capabilityCountsSummary.discarded ?? 0}`,
    `意图：${counts.intents ?? 0}`,
    `Skill ID：${result.skillId ?? '-'}`,
    `验证：${verificationStatusLabel(counts.verificationStatus)}`,
    `注册表：${verificationStatusLabel(counts.registryStatus)}`,
    '',
    '产物：',
    `  构建：${displayPath(result.artifactDir, options.cwd)}`,
    `  Skill：${displayPath(result.skillDir, options.cwd)}`,
    `  报告：${displayPath(result.artifacts?.['build_report.json'], options.cwd)}`,
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
      lines.push('  Internal sanitized check: node src/entrypoints/pipeline/run-pipeline.mjs <url> --auto --deep --network');
    }
  }
  const warnings = result.warnings ?? [];
  if (warnings.length) {
    lines.push('', '警告：');
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
    lines.push('', '未成功采集：', ...renderCollectionOutcomeTable(unsuccessful));
    if (result.collectionOutcomes?.truncated) {
      lines.push(`  （仅显示前 ${result.collectionOutcomes.limit ?? unsuccessful.length} 项，完整列表见 build_report.json）`);
    }
  }
  return `${lines.join('\n')}\n`;
}
