import path from 'node:path';
import process from 'node:process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initializeCliUtf8 } from '../../infra/cli.mjs';
import {
  renderCapabilityIntentSummaryHtml,
  renderSiteForgeBuildSummary,
  runSiteForgeBuild,
  siteForgeReportModeSet,
  siteForgeBuildCliJson,
} from '../../app/pipeline/build/index.mjs';
import { prepareSiteForgeBuildSetup } from '../../app/pipeline/build/setup-assistant.mjs';
import {
  parseIntegerOption,
  readCliValue,
} from '../../infra/cli/parse-values.mjs';
import { sanitizePublicUrl } from '../../shared/url-safety.mjs';
import { prepareRedactedArtifactJsonWithAudit } from '../../domain/sessions/security-guard.mjs';

const SITEFORGE_PRIVACY_MODES = new Set(['limited', 'strict']);
const SITEFORGE_REPORT_MODES = siteForgeReportModeSet();
const SITEFORGE_PROGRESS_MODES = new Set(['auto', 'interactive', 'plain']);
const SITEFORGE_AUTH_MODES = new Set(['none', 'cookie', 'browser']);
const SITEFORGE_LOCAL_CONFIG_FILE = 'siteforge.local.json';
const CAPABILITY_INTENT_SUMMARY_HTML_FILE = 'capability_intent_summary.html';
const BUILD_SCHEMA_VERSION = 1;

async function readJsonIfExists(filePath) {
  if (!filePath) {
    return null;
  }
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath, value) {
  const prepared = prepareRedactedArtifactJsonWithAudit(value);
  const auditPath = `${filePath}.redaction-audit.json`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(auditPath, prepared.auditJson, 'utf8');
  await writeFile(filePath, `${prepared.json.trimEnd()}\n`, 'utf8');
}

function setupFailureClass(reasonCode) {
  if (String(reasonCode ?? '').includes('robots')) {
    return 'robots';
  }
  return 'setup';
}

function buildSetupBlockedPageReconciliation(inputUrl, setupPlan, error) {
  const reasonCode = error?.reasonCode ?? setupPlan?.buildReadiness?.reasonCode ?? 'setup-not-buildable';
  const robotsBlocked = String(reasonCode).includes('robots');
  const status = robotsBlocked ? 'blocked' : 'failed';
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-page-reconciliation-report',
    buildId: setupPlan?.buildId ?? null,
    siteId: setupPlan?.site?.id ?? null,
    inputUrl: sanitizePublicUrl(inputUrl, { fallback: '<url>', keepPath: true }),
    status,
    resultStatus: 'failed',
    setupBlocked: true,
    setupReasonCode: reasonCode,
    summary: {
      status,
      setupBlocked: true,
      blockerClass: robotsBlocked ? 'robots_policy' : 'setup',
      primaryReasonCode: reasonCode,
      retryDisposition: robotsBlocked ? 'blocked_no_bypass' : 'manual_recovery',
      challengeLikePages: 0,
      expectedCategoryLinks: 0,
      missingCategoryLinks: 0,
      categoryCapabilities: 0,
      categoryIntents: 0,
      reasonCodes: ['setup_blocked_before_crawl', reasonCode].filter(Boolean).sort(),
      needsRerun: false,
      rerunBlocked: true,
    },
    challengePages: [],
    expectedCategoryLinks: [],
    missingCategoryLinks: [],
    categoryCapabilities: [],
    categoryIntents: [],
    safety: {
      rawHtmlPersisted: false,
      bodyTextPersisted: false,
      cookiePersisted: false,
      tokenPersisted: false,
      browserProfilePersisted: false,
    },
  };
}

function buildSetupBlockedCapabilityIntentHtmlPayload(inputUrl, setupPlan, reportPaths = {}) {
  const reasonCode = setupPlan?.buildReadiness?.reasonCode ?? 'setup-not-buildable';
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-capability-intent-html-summary',
    meta: {
      title: 'SiteForge Build Summary',
      siteUrl: sanitizePublicUrl(inputUrl, { fallback: '<url>', keepPath: true }),
      siteId: setupPlan?.site?.id ?? null,
      buildId: setupPlan?.buildId ?? null,
      skillId: null,
      crawlMode: setupPlan?.crawlContract?.crawlMode ?? setupPlan?.authStateReport?.crawlMode ?? 'public_only',
      authMethod: setupPlan?.crawlContract?.authMethod ?? setupPlan?.authStateReport?.authMethod ?? 'none',
      authVerificationStatus: setupPlan?.crawlContract?.authVerificationStatus ?? setupPlan?.authStateReport?.authVerificationStatus ?? 'not_requested',
      resultStatus: 'failed',
      legacyStatus: 'failed',
      verificationStatus: null,
      generatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      paths: reportPaths,
    },
    coverage: {
      public: { pages: 0, nodes: 0, capabilities: 0 },
      authenticated: { pages: 0, nodes: 0, capabilities: 0 },
      overlay: { pagesRevisited: 0, newNodes: 0, newAffordances: 0 },
      requiresLoginButMissing: [],
      blockedByRisk: [],
      blockedByAuth: [],
      blockedByAccess: [reasonCode],
    },
    counts: {
      capabilities: 0,
      intents: 0,
      nodes: 0,
      riskBlocked: 0,
    },
    capabilities: [],
    intents: [],
    mappings: [],
    blocked: {
      disabledHighRisk: [],
      blockedByAuth: [],
      blockedByAccess: [reasonCode],
      requiresLogin: [],
      missingEvidence: [],
      candidateOnly: [],
    },
  };
}

function buildAccessRemediationPlan(inputUrl, setupPlan, reasonCode) {
  const policy = setupPlan?.knownSitePolicy ?? {};
  const alternatives = [
    ...(policy.genericLiveBuild?.alternativeAccessPaths ?? []),
    ...(policy.setupConstraints?.alternativeAccessPaths ?? []),
    ...(policy.routingNotes ?? []),
  ].map((item) => typeof item === 'string'
    ? { type: 'policy_note', label: item, allowedEvidence: 'sanitized_summary_only' }
    : {
      type: String(item?.type ?? item?.kind ?? 'alternative').slice(0, 80),
      label: String(item?.label ?? item?.description ?? item?.path ?? item?.url ?? 'Alternative access path').slice(0, 240),
      requires: item?.requires ? String(item.requires).slice(0, 160) : null,
      allowedEvidence: item?.allowedEvidence ? String(item.allowedEvidence).slice(0, 120) : 'sanitized_summary_only',
      updatesRegistry: item?.updatesRegistry === true,
    });
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-access-remediation-plan',
    inputUrl: sanitizePublicUrl(inputUrl, { fallback: '<url>', keepPath: true }),
    siteId: setupPlan?.site?.id ?? null,
    buildId: setupPlan?.buildId ?? null,
    reasonCode,
    status: 'blocked',
    retryDisposition: String(reasonCode ?? '').includes('robots') || /challenge|verify/iu.test(String(reasonCode ?? ''))
      ? 'blocked_no_bypass'
      : 'manual_recovery',
    recommendedPaths: [
      {
        type: 'official_api_or_feed',
        label: 'Use an official API, RSS/sitemap, JSON-LD, or documented public endpoint if the site provides one.',
        allowedEvidence: 'sanitized_summary_only',
        updatesRegistry: false,
      },
      {
        type: 'user_supplied_structure_summary',
        label: 'Provide a same-site, redacted structure summary or configured auth route; SiteForge will not read browser profiles or cookies.',
        allowedEvidence: 'route_template,page_type,visible_item_count,list_presence,control_type,structure_hash',
        updatesRegistry: false,
      },
      {
        type: 'local_http_validation',
        label: 'Validate adapter logic against a deterministic local HTTP server without claiming live-site support.',
        allowedEvidence: 'test_fixture_http_responses',
        updatesRegistry: false,
      },
      ...alternatives,
    ],
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
        workflowId: 'robots:official-api-or-feed',
        kind: 'official_api_or_feed',
        status: 'available_if_site_provides_authorized_source',
        command: null,
        allowedEvidence: ['response_shape', 'schema_hash', 'rate_limit_policy', 'permission_scope'],
        genericCrawlAllowed: false,
        updatesCurrent: false,
        updatesRegistry: false,
      },
      {
        workflowId: 'robots:user-supplied-structure-summary',
        kind: 'manual_summary',
        status: 'requires_sanitized_structure_source',
        command: null,
        allowedEvidence: ['route_template', 'page_type', 'visible_item_count', 'control_type', 'structure_hash'],
        genericCrawlAllowed: false,
        updatesCurrent: false,
        updatesRegistry: false,
      },
      {
        workflowId: 'robots:local-http-validation',
        kind: 'local_http_validation',
        status: 'available_for_tests_only',
        command: 'node --test tests/node/siteforge-robots-remediation-workflow.test.mjs',
        allowedEvidence: ['fixture_http_response', 'fixture_robots_allow'],
        genericCrawlAllowed: false,
        liveSupportClaimAllowed: false,
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
    },
  };
}

async function writeSetupBlockedBuildArtifacts(inputUrl, error) {
  if (!error?.artifactDir || error?.buildReportPath) {
    return;
  }
  const setupPlan = await readJsonIfExists(error.setupPlanPath);
  const reasonCode = error?.reasonCode ?? setupPlan?.buildReadiness?.reasonCode ?? error?.code ?? 'setup-not-buildable';
  const pageReconciliation = buildSetupBlockedPageReconciliation(inputUrl, setupPlan, error);
  const pageReconciliationPath = path.join(error.artifactDir, 'page_reconciliation_report.json');
  const reportsDir = path.join(error.artifactDir, 'reports');
  const reportsPageReconciliationPath = path.join(reportsDir, 'page_reconciliation_report.json');
  const remediationPath = path.join(reportsDir, 'robots_remediation_plan.json');
  const htmlReportPath = path.join(reportsDir, CAPABILITY_INTENT_SUMMARY_HTML_FILE);
  const buildReportPath = path.join(error.artifactDir, 'build_report.json');
  const userReportPath = path.join(error.artifactDir, 'build_report.user.json');
  await writeJsonFile(pageReconciliationPath, pageReconciliation);
  await writeJsonFile(reportsPageReconciliationPath, pageReconciliation);
  const remediationPlan = buildAccessRemediationPlan(inputUrl, setupPlan, reasonCode);
  await writeJsonFile(remediationPath, remediationPlan);
  const htmlReport = renderCapabilityIntentSummaryHtml(buildSetupBlockedCapabilityIntentHtmlPayload(inputUrl, setupPlan, {
    userReport: 'build_report.user.json',
    indexReport: 'build_report.json',
    pageReconciliationReport: 'reports/page_reconciliation_report.json',
    remediationPlan: 'reports/robots_remediation_plan.json',
    htmlReport: `reports/${CAPABILITY_INTENT_SUMMARY_HTML_FILE}`,
  }));
  await mkdir(reportsDir, { recursive: true });
  await writeFile(htmlReportPath, `${htmlReport.trimEnd()}\n`, 'utf8');
  const report = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-build-report-index',
    buildId: setupPlan?.buildId ?? null,
    build_id: setupPlan?.buildId ?? null,
    siteId: setupPlan?.site?.id ?? null,
    inputUrl: sanitizePublicUrl(inputUrl, { fallback: '<url>', keepPath: true }),
    artifactDir: error.artifactDir,
    status: 'failed',
    result_status: 'failed',
    legacy_status: 'failed',
    failedStage: 'setup',
    failureClass: setupFailureClass(reasonCode),
    reasonCode,
    reason: setupPlan?.buildReadiness?.reason ?? reasonCode,
    crawlMode: setupPlan?.crawlContract?.crawlMode ?? setupPlan?.authStateReport?.crawlMode ?? 'public_only',
    authMethod: setupPlan?.crawlContract?.authMethod ?? setupPlan?.authStateReport?.authMethod ?? null,
    authVerificationStatus: setupPlan?.crawlContract?.authVerificationStatus ?? setupPlan?.authStateReport?.authVerificationStatus ?? null,
    authStateReport: setupPlan?.authStateReport ?? null,
    crawlContract: setupPlan?.crawlContract ?? null,
    summary: {
      seeds: 0,
      nodes: 0,
      affordances: 0,
      capabilities: {
        active: 0,
        candidate: 0,
        discarded: 0,
        disabled: 0,
      },
      coverage: {
        public: { pages: 0, nodes: 0, capabilities: 0 },
        authenticated: { pages: 0, nodes: 0, capabilities: 0 },
        overlay: { pagesRevisited: 0, newNodes: 0, newAffordances: 0 },
        requiresLoginButMissing: [],
        blockedByRisk: [],
        blockedByAuth: [],
      },
      auth: {
        crawlMode: setupPlan?.crawlContract?.crawlMode ?? setupPlan?.authStateReport?.crawlMode ?? 'public_only',
        authMethod: setupPlan?.crawlContract?.authMethod ?? setupPlan?.authStateReport?.authMethod ?? null,
        authVerificationStatus: setupPlan?.crawlContract?.authVerificationStatus ?? setupPlan?.authStateReport?.authVerificationStatus ?? null,
        verified: setupPlan?.authStateReport?.verified === true,
      },
      activeCapabilities: 0,
      intents: 0,
      verificationStatus: null,
      verificationReasonCode: reasonCode,
      registryStatus: null,
      pageReconciliation: pageReconciliation.summary,
    },
    collectionOutcomes: {
      unsuccessful: [{
        kind: 'stage',
        target: 'setup',
        status: 'failed',
        reasonCode,
        reason: setupPlan?.buildReadiness?.reason ?? reasonCode,
      }],
      total: 1,
      truncated: false,
      limit: 40,
    },
    warnings: ['setup-blocked-before-crawl', reasonCode],
    warningCodes: [reasonCode],
    artifacts: {
      'auth_state_report.json': error.artifactDir ? path.join(error.artifactDir, 'auth_state_report.json') : null,
      'build_report.json': buildReportPath,
      'build_report.user.json': userReportPath,
      'page_reconciliation_report.json': pageReconciliationPath,
      'robots_remediation_plan.json': remediationPath,
      [CAPABILITY_INTENT_SUMMARY_HTML_FILE]: htmlReportPath,
      setupPlan: error.setupPlanPath ?? null,
    },
    reports: {
      capability_intent_summary_html: `reports/${CAPABILITY_INTENT_SUMMARY_HTML_FILE}`,
      page_reconciliation_report: 'reports/page_reconciliation_report.json',
      robots_remediation_plan: 'reports/robots_remediation_plan.json',
    },
    report_index: {
      default_report: 'user',
      available_reports: ['user', 'capability_intent_summary_html', 'page_reconciliation_report', 'robots_remediation_plan'],
      user_report: 'build_report.user.json',
      capability_intent_summary_html: `reports/${CAPABILITY_INTENT_SUMMARY_HTML_FILE}`,
      page_reconciliation_report: 'reports/page_reconciliation_report.json',
      robots_remediation_plan: 'reports/robots_remediation_plan.json',
      redacted: true,
    },
    setupAssistant: {
      setupPlan: error.setupPlanPath ?? null,
      userChoices: error.userChoicesPath ?? null,
      capabilityHints: error.capabilityHintsPath ?? null,
      profile: error.buildProfilePath ?? null,
      savedProfile: error.savedBuildProfilePath ?? null,
    },
    pageReconciliation,
    privacy_summary: {
      rawMaterialPersisted: false,
      sessionMaterialPersisted: false,
      cookieMaterialPersisted: false,
      browserProfilePersisted: false,
    },
  };
  const userReport = {
    result_status: 'failed',
    legacy_status: 'failed',
    failure_class: report.failureClass,
    reason_code: reasonCode,
    reason: report.reason,
    site: {
      id: report.siteId,
      input_url: report.inputUrl,
      root_url: setupPlan?.site?.rootUrl ?? null,
    },
    build_id: report.buildId,
    crawlMode: report.crawlMode,
    authMethod: report.authMethod,
    authVerificationStatus: report.authVerificationStatus,
    coverage: report.summary.coverage,
    counts: { capabilities: 0, intents: 0 },
    build_completion: {
      status: 'failed',
      verification_status: null,
      current_updated: false,
      registry_registered: false,
      capability_intent_summary_html: `reports/${CAPABILITY_INTENT_SUMMARY_HTML_FILE}`,
    },
    reports: {
      page_reconciliation_report: 'page_reconciliation_report.json',
      capability_intent_summary_html: `reports/${CAPABILITY_INTENT_SUMMARY_HTML_FILE}`,
      robots_remediation_plan: 'reports/robots_remediation_plan.json',
    },
    next_steps: [
      'Review reports/robots_remediation_plan.json for compliant alternatives.',
      'Use official APIs, documented feeds, or a redacted structure summary when robots/challenge blocks generic crawling.',
    ],
    next_step_workflows: [
      {
        id: 'robots-remediation-plan',
        status: 'available',
        report: 'reports/robots_remediation_plan.json',
        promotionAllowed: false,
        updatesCurrent: false,
        updatesRegistry: false,
      },
      {
        id: 'official-api-or-feed',
        status: 'requires-user-input',
        promotionAllowed: false,
      },
      {
        id: 'manual-summary',
        status: 'requires-sanitized-structure-source',
        promotionAllowed: false,
      },
      {
        id: 'local-http-validation',
        status: 'available-for-tests-only',
        promotionAllowed: false,
        liveSupportClaimAllowed: false,
      },
    ],
    warnings_user_facing: [
      'Setup blocked before crawl; no page capability claims were activated.',
      `Reason: ${reasonCode}`,
    ],
    privacy_summary: report.privacy_summary,
  };
  await writeJsonFile(userReportPath, userReport);
  await writeJsonFile(buildReportPath, report);
  error.buildReport = report;
  error.buildReportPath = buildReportPath;
  return {
    report,
    userReport,
    remediationPlan,
    remediationPath,
  };
}

function buildSiteForgeCliFailureResult(inputUrl, error) {
  const report = error?.buildReport && typeof error.buildReport === 'object'
    ? error.buildReport
    : {};
  return {
    ...report,
    inputUrl: report.inputUrl ?? sanitizePublicUrl(inputUrl, { fallback: '<url>', keepPath: true }),
    status: report.status ?? 'failed',
    result_status: report.result_status ?? 'failed',
    legacy_status: report.legacy_status ?? report.status ?? 'failed',
    siteId: report.siteId ?? null,
    buildId: report.buildId ?? null,
    skillId: report.skillId ?? null,
    skillDir: report.skillDir ?? null,
    artifactDir: report.artifactDir ?? error?.artifactDir ?? null,
    failedStage: report.failedStage ?? error?.stage ?? null,
    reasonCode: report.reasonCode ?? error?.reasonCode ?? error?.code ?? 'build-failed',
    reason: report.reason ?? null,
    warningCodes: report.warningCodes ?? [],
    warnings: report.warnings ?? [],
    summary: report.summary ?? {
      seeds: 0,
      nodes: 0,
      affordances: 0,
      capabilities: {
        active: 0,
        candidate: 0,
        discarded: 0,
      },
      activeCapabilities: 0,
      intents: 0,
      verificationStatus: null,
      registryStatus: null,
    },
    collectionOutcomes: report.collectionOutcomes ?? {
      unsuccessful: [],
      total: 0,
      truncated: false,
      limit: 0,
    },
    artifacts: {
      ...(report.artifacts ?? {}),
      'build_report.json': report.artifacts?.['build_report.json'] ?? error?.buildReportPath ?? null,
    },
    setupAssistant: {
      ...(report.setupAssistant ?? {}),
      setupPlan: report.setupAssistant?.setupPlan ?? error?.setupPlanPath ?? null,
      userChoices: report.setupAssistant?.userChoices ?? error?.userChoicesPath ?? null,
      capabilityHints: report.setupAssistant?.capabilityHints ?? error?.capabilityHintsPath ?? null,
      profile: report.setupAssistant?.profile ?? error?.buildProfilePath ?? null,
      savedProfile: report.setupAssistant?.savedProfile ?? error?.savedBuildProfilePath ?? null,
    },
  };
}

function normalizeChoice(value, allowed, flagName) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!allowed.has(normalized)) {
    throw new Error(`${flagName} must be one of: ${[...allowed].join(', ')}`);
  }
  return normalized;
}

function normalizePositiveInteger(value, flagName) {
  return parseIntegerOption(value, flagName, { min: 1 });
}

function applySiteForgeCliDefaults(options) {
  const next = { ...options };
  if (next.manual === true) {
    next.auto = true;
    next.manual = false;
    next.setupInteractive = false;
    next.interactive = false;
    next.disableManualCapabilityProofPrompt = true;
    next.manualSupplementalCollection = false;
  } else {
    next.auto = true;
    next.setupInteractive = false;
    next.interactive = false;
    next.disableManualCapabilityProofPrompt = true;
  }
  next.privacyMode = normalizeChoice(next.privacyMode ?? 'limited', SITEFORGE_PRIVACY_MODES, '--privacy');
  const explicitMaxPages = next.maxPages !== undefined;
  const explicitMaxSeeds = next.maxSeeds !== undefined;
  const explicitMaxSitemaps = next.maxSitemaps !== undefined;
  next.maxDepth = next.maxDepth ?? 3;
  next.maxPages = next.maxPages ?? 120;
  next.maxSeeds = next.maxSeeds ?? 500;
  next.maxSitemaps = next.maxSitemaps ?? 20;
  if (next.deep === true) {
    if (!explicitMaxPages) {
      next.maxPages = 160;
    }
    if (!explicitMaxSeeds) {
      next.maxSeeds = 800;
    }
    if (!explicitMaxSitemaps) {
      next.maxSitemaps = 50;
    }
    next.renderJs = next.renderJs ?? true;
  }
  if (next.network === true) {
    next.captureNetwork = true;
  }
  if (next.internalRawNetwork === true) {
    next.network = true;
    next.captureNetwork = true;
    next.renderJs = true;
  }
  next.authMode = normalizeChoice(next.authMode ?? 'none', SITEFORGE_AUTH_MODES, '--auth');
  if (!next.reportMode) {
    next.reportMode = next.debug || next.verbose ? 'debug' : 'user';
  }
  next.reportMode = normalizeChoice(next.reportMode, SITEFORGE_REPORT_MODES, '--report');
  next.webInteraction = false;
  return next;
}

async function closeSiteForgeWebInteraction(options = /** @type {any} */ ({})) {
  const session = options.webInteractionSession;
  delete options.webInteractionSession;
  if (typeof session?.close === 'function') {
    await session.close();
  }
}

function readValue(args, current, index, options = /** @type {any} */ ({})) {
  return readCliValue(args, current, index, options);
}

export function parseCliArgs(argv) {
  const args = [...argv];
  const options = /** @type {any} */ ({});
  let url = null;

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith('--')) {
      if (url !== null) {
        throw new Error(`未知参数: ${current}`);
      }
      url = current;
      continue;
    }

    switch (current.split('=')[0]) {
      case '--browser-path': {
        const { value, nextIndex } = readValue(args, current, index);
        options.browserPath = value;
        index = nextIndex;
        break;
      }
      case '--timeout': {
        const { value, nextIndex } = readValue(args, current, index);
        options.timeoutMs = normalizePositiveInteger(value, '--timeout');
        index = nextIndex;
        break;
      }
      case '--max-depth': {
        const { value, nextIndex } = readValue(args, current, index);
        options.maxDepth = normalizePositiveInteger(value, '--max-depth');
        options.maxDepthExplicit = true;
        index = nextIndex;
        break;
      }
      case '--max-pages': {
        const { value, nextIndex } = readValue(args, current, index);
        options.maxPages = normalizePositiveInteger(value, '--max-pages');
        options.maxPagesExplicit = true;
        index = nextIndex;
        break;
      }
      case '--max-seeds': {
        const { value, nextIndex } = readValue(args, current, index);
        options.maxSeeds = normalizePositiveInteger(value, '--max-seeds');
        options.maxSeedsExplicit = true;
        index = nextIndex;
        break;
      }
      case '--max-sitemaps': {
        const { value, nextIndex } = readValue(args, current, index);
        options.maxSitemaps = normalizePositiveInteger(value, '--max-sitemaps');
        options.maxSitemapsExplicit = true;
        index = nextIndex;
        break;
      }
      case '--auto':
        options.auto = true;
        options.manual = false;
        options.setupInteractive = false;
        break;
      case '--manual':
        options.manual = true;
        options.auto = false;
        options.setupInteractive = true;
        break;
      case '--deep':
        options.deep = true;
        options.deepExplicit = true;
        break;
      case '--network':
        options.network = true;
        options.captureNetwork = true;
        break;
      case '--internal-raw-network':
        options.internalRawNetwork = true;
        options.network = true;
        options.captureNetwork = true;
        options.renderJs = true;
        options.renderJsExplicit = true;
        break;
      case '--auth': {
        const { value, nextIndex } = readValue(args, current, index);
        options.authMode = normalizeChoice(value, SITEFORGE_AUTH_MODES, '--auth');
        options.authModeExplicit = true;
        if (options.authMode === 'none') {
          options.ignoreLocalCookieConfig = true;
        }
        index = nextIndex;
        break;
      }
      case '--cookie-env': {
        const { value, nextIndex } = readValue(args, current, index);
        options.cookieEnv = value;
        index = nextIndex;
        break;
      }
      case '--cookie-file': {
        const { value, nextIndex } = readValue(args, current, index);
        options.cookieFile = value;
        index = nextIndex;
        break;
      }
      case '--cookie-stdin':
        options.cookieStdin = true;
        break;
      case '--robots-plan':
        options.robotsPlan = true;
        options.json = true;
        break;
      case '--auth-check-url': {
        const { value, nextIndex } = readValue(args, current, index);
        options.authCheckUrl = value;
        index = nextIndex;
        break;
      }
      case '--login-enhanced':
        options.authMode = 'cookie';
        options.authModeExplicit = true;
        break;
      case '--public-only':
        options.authMode = 'none';
        options.authModeExplicit = true;
        options.ignoreLocalCookieConfig = true;
        break;
      case '--render-js':
        options.renderJs = true;
        options.renderJsExplicit = true;
        break;
      case '--no-render-js':
        options.renderJs = false;
        options.renderJsExplicit = true;
        break;
      case '--privacy': {
        const { value, nextIndex } = readValue(args, current, index);
        options.privacyMode = normalizeChoice(value, SITEFORGE_PRIVACY_MODES, '--privacy');
        index = nextIndex;
        break;
      }
      case '--explain':
        options.explain = true;
        break;
      case '--report': {
        const { value, nextIndex } = readValue(args, current, index);
        options.reportMode = normalizeChoice(value, SITEFORGE_REPORT_MODES, '--report');
        index = nextIndex;
        break;
      }
      case '--help':
        options.help = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--quiet':
        options.quiet = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--debug':
        options.debug = true;
        break;
      case '--no-color':
        options.noColor = true;
        break;
      case '--ascii':
        options.ascii = true;
        break;
      case '--compact':
        options.compact = true;
        break;
      case '--progress': {
        const { value, nextIndex } = readValue(args, current, index);
        options.progressMode = normalizeChoice(value, SITEFORGE_PROGRESS_MODES, '--progress');
        index = nextIndex;
        break;
      }
      case '--no-tty':
        options.noTty = true;
        break;
      case '--force-tty':
        options.forceTty = true;
        break;
      default:
        throw new Error(`未知参数: ${current}`);
    }
  }

  return { url, options: applySiteForgeCliDefaults(options) };
}

function normalizeConfigUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  const withProtocol = /^[a-z][a-z0-9+.-]*:/iu.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    parsed.hash = '';
    parsed.search = '';
    if (!parsed.pathname) {
      parsed.pathname = '/';
    }
    return parsed;
  } catch {
    return null;
  }
}

function configSiteMatches(inputUrl, configuredUrl) {
  const input = normalizeConfigUrl(inputUrl);
  const configured = normalizeConfigUrl(configuredUrl);
  if (!input || !configured) {
    return false;
  }
  return input.origin === configured.origin;
}

function matchingLocalSiteConfig(config, inputUrl) {
  const sites = Array.isArray(config?.sites) ? config.sites : [];
  return sites.find((site) => site && configSiteMatches(inputUrl, site.url)) ?? null;
}

function localBuildConfigPaths(cwd) {
  const paths = [path.join(cwd, SITEFORGE_LOCAL_CONFIG_FILE)];
  const homeDir = process.env.USERPROFILE || process.env.HOME;
  if (homeDir) {
    paths.push(path.join(homeDir, '.siteforge', SITEFORGE_LOCAL_CONFIG_FILE));
  }
  return [...new Set(paths)];
}

async function readLocalBuildConfigFile(configPath) {
  try {
    return JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw new Error(`${SITEFORGE_LOCAL_CONFIG_FILE} is not valid JSON`);
    }
    throw new Error(`${SITEFORGE_LOCAL_CONFIG_FILE} could not be read`);
  }
}

function stringList(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
}

function boundedText(value, fallback = null, maxLength = 160) {
  const text = String(value ?? '').trim();
  if (!text) {
    return fallback;
  }
  return text.slice(0, maxLength);
}

function normalizeAuthorizedRouteTemplates(value) {
  return stringList(value).slice(0, 40).map((route) => route.slice(0, 240));
}

function normalizeAuthorizedLinkTarget(value) {
  const rawTarget = String(value ?? '').trim();
  if (!rawTarget) {
    return null;
  }
  return /^\//u.test(rawTarget)
    ? rawTarget.slice(0, 240)
    : sanitizePublicUrl(rawTarget, { fallback: '<redacted-url>', keepPath: true });
}

function normalizeAuthorizedLinks(value, {
  semanticKind = null,
  fallbackPrefix = 'authorized-link',
} = {}) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry, index) => {
      const link = typeof entry === 'string' ? { label: entry, href: entry } : entry;
      if (!link || typeof link !== 'object') {
        return null;
      }
      const href = normalizeAuthorizedLinkTarget(link.href ?? link.url ?? link.path ?? link.route);
      const routeTemplate = boundedText(link.routeTemplate ?? link.routePattern ?? link.route, null, 240);
      if (!href && !routeTemplate) {
        return null;
      }
      return {
        href: href ?? routeTemplate,
        label: boundedText(link.label ?? link.title ?? link.name, `${fallbackPrefix}-${index + 1}`, 120),
        selector: boundedText(link.selector, `${fallbackPrefix}-${index + 1}`, 120),
        semanticKind: boundedText(link.semanticKind ?? link.role ?? semanticKind, semanticKind, 60),
        structureType: boundedText(link.structureType ?? link.structure_type, null, 100),
        routeTemplate,
      };
    })
    .filter(Boolean)
    .slice(0, 160);
}

function normalizeAuthorizedStructureLinks(page) {
  return [
    ...normalizeAuthorizedLinks(page.links ?? page.navigationLinks ?? page.navLinks),
    ...normalizeAuthorizedLinks(page.channels, { semanticKind: 'category', fallbackPrefix: 'authorized-channel' }),
    ...normalizeAuthorizedLinks(page.categories, { semanticKind: 'category', fallbackPrefix: 'authorized-category' }),
    ...normalizeAuthorizedLinks(page.rankings, { semanticKind: 'ranking', fallbackPrefix: 'authorized-ranking' }),
    ...normalizeAuthorizedLinks(page.lists, { semanticKind: 'ranking', fallbackPrefix: 'authorized-list' }),
  ].slice(0, 160);
}

function normalizeAuthorizedStructureItems(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      return {
        nodeType: boundedText(item.nodeType ?? item.type, 'component', 80),
        structureType: boundedText(item.structureType ?? item.kind, null, 100),
        labelSummary: boundedText(item.labelSummary ?? item.label ?? item.title, null, 160),
        visibleItemCount: Number.isFinite(Number(item.visibleItemCount ?? item.itemCount))
          ? Math.max(0, Number(item.visibleItemCount ?? item.itemCount))
          : 0,
        listPresent: item.listPresent === true,
        emptyStatePresent: item.emptyStatePresent === true,
        routeTemplates: normalizeAuthorizedRouteTemplates(item.routeTemplates ?? item.routes),
      };
    })
    .filter(Boolean)
    .slice(0, 120);
}

function normalizeAuthorizedStructurePage(page, index = 0) {
  if (!page || typeof page !== 'object') {
    return null;
  }
  const rawUrl = String(page.url ?? page.path ?? page.route ?? '').trim();
  const routeTemplate = boundedText(page.routeTemplate ?? page.routePattern ?? page.path, null, 240);
  return {
    id: boundedText(page.id, `authorized-page-${index + 1}`, 80),
    url: rawUrl ? (/^\//u.test(rawUrl) ? rawUrl.slice(0, 240) : sanitizePublicUrl(rawUrl, { fallback: '<redacted-url>', keepPath: true })) : null,
    title: boundedText(page.title ?? page.name, null, 160),
    pageType: boundedText(page.pageType ?? page.page_type ?? page.type, 'authorized_source_summary', 100),
    routeTemplate,
    visibleItemCount: Number.isFinite(Number(page.visibleItemCount ?? page.itemCount))
      ? Math.max(0, Number(page.visibleItemCount ?? page.itemCount))
      : 0,
    listPresent: page.listPresent === true,
    emptyStatePresent: page.emptyStatePresent === true,
    routeTemplates: normalizeAuthorizedRouteTemplates(page.routeTemplates ?? page.routes),
    links: normalizeAuthorizedStructureLinks(page),
    structureItems: normalizeAuthorizedStructureItems(page.structureItems ?? page.nodes ?? page.elements),
  };
}

function normalizeAuthorizedStructurePages(source) {
  const candidates = [];
  if (Array.isArray(source?.structurePages)) {
    candidates.push(...source.structurePages);
  }
  if (Array.isArray(source?.pages)) {
    candidates.push(...source.pages);
  }
  if (Array.isArray(source?.structureSummary?.pages)) {
    candidates.push(...source.structureSummary.pages);
  }
  if (source?.structureSummary && typeof source.structureSummary === 'object' && !Array.isArray(source.structureSummary)) {
    candidates.push(source.structureSummary);
  }
  if (source?.page && typeof source.page === 'object') {
    candidates.push(source.page);
  }
  return candidates
    .map((page, index) => normalizeAuthorizedStructurePage(page, index))
    .filter(Boolean)
    .slice(0, 80);
}

function normalizeAuthorizedSources(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((source, index) => {
      if (!source || typeof source !== 'object') {
        return null;
      }
      const kind = String(source.kind ?? source.type ?? '').trim().toLowerCase();
      if (!kind || !['api', 'official_api', 'rss', 'feed', 'sitemap', 'structure-summary', 'structure_summary', 'user_export', 'site_authorized_endpoint'].includes(kind)) {
        return null;
      }
      const rawUrl = String(source.url ?? source.endpoint ?? '').trim();
      return {
        id: String(source.id ?? `authorized-source-${index + 1}`).trim().slice(0, 80),
        kind,
        url: rawUrl ? (/^\//u.test(rawUrl) ? rawUrl.slice(0, 240) : sanitizePublicUrl(rawUrl, { fallback: '<redacted-url>', keepPath: true })) : null,
        accessBasis: String(source.accessBasis ?? source.authorizationBasis ?? 'user_provided_contract').trim().slice(0, 120),
        permissionScope: String(source.permissionScope ?? source.scope ?? 'sanitized_summary_only').trim().slice(0, 160),
        allowedEvidence: stringList(source.allowedEvidence).slice(0, 20),
        structurePages: normalizeAuthorizedStructurePages(source),
        genericCrawlAllowed: false,
        promotionAllowed: false,
      };
    })
    .filter(Boolean);
}

function pickLocalBuildSiteConfig(configs, inputUrl) {
  for (const entry of configs) {
    const site = matchingLocalSiteConfig(entry.config, inputUrl);
    if (site) {
      return {
        ...site,
        __configSource: entry.source,
      };
    }
  }
  return null;
}

async function applyLocalBuildConfig(inputUrl, options, {
  cwd = process.cwd(),
} = /** @type {any} */ ({})) {
  const hasExplicitCookieSource = Boolean(options.cookieEnv || options.cookieFile || options.cookieStdin || options.cookieHeader);
  const configs = [];
  for (const configPath of localBuildConfigPaths(cwd)) {
    const config = await readLocalBuildConfigFile(configPath);
    if (config) {
      configs.push({
        config,
        source: path.resolve(configPath) === path.resolve(cwd, SITEFORGE_LOCAL_CONFIG_FILE) ? 'cwd' : 'home',
      });
    }
  }
  const site = pickLocalBuildSiteConfig(configs, inputUrl);
  if (!site) {
    return options;
  }
  const auth = site.auth && typeof site.auth === 'object' ? site.auth : {};
  const build = site.build && typeof site.build === 'object' ? site.build : {};
  const configuredAuthRoutes = stringList(auth.authRoutes ?? site.authRoutes);
  const configuredPublicRevisitRoutes = stringList(auth.publicRevisitRoutes ?? site.publicRevisitRoutes);
  const configuredAuthorizedSources = normalizeAuthorizedSources(site.authorizedSources ?? site.alternativeDataSources);
  const localBuildConfig = {
    source: site.__configSource,
    authMode: auth.mode === 'browser' ? 'browser' : auth.mode === 'cookie' ? 'cookie' : null,
    authCheckUrl: String(auth.authCheckUrl ?? site.authCheckUrl ?? '').trim() || null,
    authRoutes: configuredAuthRoutes,
    publicRevisitRoutes: configuredPublicRevisitRoutes,
    authorizedSources: configuredAuthorizedSources,
    build: {
      deep: build.deep === true,
      renderJs: build.renderJs === true ? true : build.renderJs === false ? false : null,
      maxDepth: Number.isFinite(Number(build.maxDepth)) ? Number(build.maxDepth) : null,
      maxPages: Number.isFinite(Number(build.maxPages)) ? Number(build.maxPages) : null,
      maxSeeds: Number.isFinite(Number(build.maxSeeds)) ? Number(build.maxSeeds) : null,
      maxSitemaps: Number.isFinite(Number(build.maxSitemaps)) ? Number(build.maxSitemaps) : null,
    },
  };
  const next = {
    ...options,
    localBuildConfig,
  };
  if (build.deep === true && options.deepExplicit !== true) next.deep = true;
  if ((build.renderJs === true || build.renderJs === false) && options.renderJsExplicit !== true) next.renderJs = build.renderJs;
  if (Number.isFinite(Number(build.maxDepth)) && options.maxDepthExplicit !== true) next.maxDepth = Math.max(1, Number(build.maxDepth));
  if (Number.isFinite(Number(build.maxPages)) && options.maxPagesExplicit !== true) next.maxPages = Math.max(1, Number(build.maxPages));
  if (Number.isFinite(Number(build.maxSeeds)) && options.maxSeedsExplicit !== true) next.maxSeeds = Math.max(1, Number(build.maxSeeds));
  if (Number.isFinite(Number(build.maxSitemaps)) && options.maxSitemapsExplicit !== true) next.maxSitemaps = Math.max(1, Number(build.maxSitemaps));
  if (configuredAuthorizedSources.length) {
    next.authorizedSources = configuredAuthorizedSources;
  }
  const cookie = typeof site?.cookie === 'string' ? site.cookie.trim() : '';
  const cookieEnv = String(auth.cookieEnv ?? site.cookieEnv ?? '').trim();
  const cookieFile = String(auth.cookieFile ?? site.cookieFile ?? '').trim();
  const authRequested = auth.mode === 'cookie' || auth.mode === 'browser' || cookie || cookieEnv || cookieFile;
  if (localBuildConfig.authCheckUrl && !options.authCheckUrl && options.ignoreLocalCookieConfig !== true && (authRequested || ['cookie', 'browser'].includes(options.authMode))) {
    next.authCheckUrl = localBuildConfig.authCheckUrl;
  }
  if (auth.mode === 'browser' && options.ignoreLocalCookieConfig !== true && options.authModeExplicit !== true) {
    next.authMode = 'browser';
    next.strictBrowserAuth = true;
    if (localBuildConfig.authCheckUrl && !options.authCheckUrl) {
      next.authCheckUrl = localBuildConfig.authCheckUrl;
    }
  }
  if (authRequested && options.ignoreLocalCookieConfig !== true && !hasExplicitCookieSource) {
    if (auth.mode === 'browser') {
      return next;
    }
    next.authMode = 'cookie';
    next.strictCookieAuth = true;
    if (cookieEnv) next.cookieEnv = cookieEnv;
    else if (cookieFile) next.cookieFile = cookieFile;
    else if (cookie) next.cookieHeader = cookie;
  }
  return next;
}

function printHelp() {
  process.stdout.write(`用法:
  node src/entrypoints/build/run-build.mjs <url> [build options]

公开命令:
  siteforge build <url>

选项:
  --auto                       Non-interactive build mode (default)
  --manual                     Accepted for compatibility; build still runs without prompts
  --deep                       Request broader/deeper discovery
  --network                    Save a sanitized network summary only
  --auth <mode>                none | cookie | browser
  --cookie-env <name>          Read Cookie header from environment variable
  --cookie-file <path>         Read Cookie header or Netscape cookie jar from file
  --cookie-stdin               Read Cookie header from stdin
  --robots-plan                Print compliant recovery workflows for robots/setup blocks as JSON
  --auth-check-url <url/path>  Same-site URL/path used to verify Cookie or browser bridge auth
  --login-enhanced             Compatibility alias for --auth cookie; still requires cookie input
  --public-only                Compatibility alias for --auth none
  --privacy <mode>             limited | strict
  --explain                    Include explanatory user-facing output
  --report <mode>              user | debug | both
  --browser-path <path>        指定 Chromium/Chrome 可执行文件路径
  --timeout <ms>               浏览器授权步骤超时时间
  --max-depth <n>              Discovery depth for deep builds
  --max-pages <n>              Maximum pages for deep builds
  --max-seeds <n>              Maximum seeds for deep builds
  --max-sitemaps <n>           Maximum sitemap files to inspect during seed discovery
  --render-js                  Enable rendered-page discovery
  --no-render-js               Disable rendered-page discovery
  --json                       stdout 保持 JSON，并关闭进度输出
  --quiet                      抑制 stderr 的人类可读进度
  --verbose                    显示更多细节和完整路径
  --debug                      显示堆栈和原始诊断 JSON
  --no-color                   禁用 ANSI 颜色
  --ascii                      禁用 Unicode 符号
  --compact                    使用紧凑单行输出
  --progress <mode>            auto | interactive | plain
  --no-tty                     强制普通进度输出
  --force-tty                  强制交互式进度输出
  --help                       显示帮助
`);
}

async function runCli() {
  initializeCliUtf8();
  const { url, options } = parseCliArgs(process.argv.slice(2));
  if (options.help || !url) {
    printHelp();
    if (!options.help && !url) {
      process.exitCode = 1;
    }
    return;
  }

  const startedAt = Date.now();
  let buildOptions = options;
  let result;
  let setup;
  try {
    buildOptions = await applyLocalBuildConfig(url, options);
    setup = await prepareSiteForgeBuildSetup(url, buildOptions);
    result = await runSiteForgeBuild(url, setup.buildOptions);
    result.setupAssistant = {
      status: setup.status,
      profile: setup.paths.buildProfilePath,
      savedProfile: setup.paths.savedBuildProfilePath,
      setupPlan: setup.paths.setupPlanPath,
      userChoices: setup.paths.userChoicesPath,
      capabilityHints: setup.paths.capabilityHintsPath,
    };
  } catch (error) {
    await closeSiteForgeWebInteraction(buildOptions);
    const setupArtifacts = await writeSetupBlockedBuildArtifacts(url, error);
    const failureResult = buildSiteForgeCliFailureResult(url, error);
    const renderOptions = {
      ...buildOptions,
      durationMs: Date.now() - startedAt,
      columns: process.stdout.columns,
      cwd: process.cwd(),
    };
    if (buildOptions.robotsPlan && buildOptions.json && setupArtifacts?.remediationPlan) {
      process.stdout.write(`${JSON.stringify(setupArtifacts.remediationPlan, null, 2)}\n`);
    } else if (buildOptions.json) {
      process.stdout.write(siteForgeBuildCliJson(failureResult, buildOptions));
    } else if (buildOptions.quiet) {
      process.stdout.write('Skill：-\n');
    } else {
      process.stdout.write(renderSiteForgeBuildSummary(failureResult, renderOptions));
      if (buildOptions.debug) {
        process.stdout.write('\n调试报告已写入构建目录；如需机器可读输出，请使用 --json --report debug。\n');
      }
    }
    if (buildOptions.debug && error?.stack) {
      process.stderr.write(`${error.stack}\n`);
    }
    process.exitCode = 1;
    return;
  }
  if (buildOptions.json) {
    await closeSiteForgeWebInteraction(buildOptions);
    process.stdout.write(siteForgeBuildCliJson(result, buildOptions));
    return;
  }
  if (buildOptions.quiet) {
    await closeSiteForgeWebInteraction(buildOptions);
    process.stdout.write(`Skill：${result.skillDir}\n`);
    return;
  }
  process.stdout.write(renderSiteForgeBuildSummary(result, {
    ...buildOptions,
    durationMs: Date.now() - startedAt,
    columns: process.stdout.columns,
    cwd: process.cwd(),
  }));
  await closeSiteForgeWebInteraction(buildOptions);
  if (buildOptions.debug) {
    process.stdout.write('\n调试报告已写入构建目录；如需机器可读输出，请使用 --json --report debug。\n');
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  runCli().catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
