// @ts-check

import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { initializeCliUtf8, writeJsonStdout } from '../../infra/cli.mjs';
import { openBrowserSession } from '../../infra/browser/session.mjs';
import { ensureDir, pathExists, readJsonFile, writeJsonFile, writeTextFile } from '../../infra/io.mjs';
import { sanitizeHost, toArray, uniqueSortedStrings } from '../../shared/normalize.mjs';
import { PROFILE_ARCHETYPES } from '../../sites/core/archetypes.mjs';
import { resolveSite } from '../../sites/core/adapters/resolver.mjs';
import { resolveProfilePathForUrl } from '../../sites/core/profiles.mjs';
import { inferPageTypeFromUrl, toSemanticPageType } from '../../sites/core/page-types.mjs';
import { validateProfileFile } from '../../sites/core/profile-validation.mjs';
import { maybeRunAuthenticatedKeepalivePreflight } from '../../infra/auth/auth-keepalive-preflight.mjs';
import {
  ensureAuthenticatedSession,
  inspectLoginState,
  resolveAuthVerificationUrl,
  resolveSiteAuthProfile,
  resolveSiteBrowserSessionOptions,
} from '../../infra/auth/site-auth.mjs';
import { classifyRiskFromContext } from '../../infra/auth/site-session-governance.mjs';
import { resolveCanonicalSiteIdentity, resolveCanonicalSiteKey } from '../../sites/core/site-identity.mjs';
import { resolveSiteDoctorScenarioSuite } from '../../sites/core/site-doctor-scenarios.mjs';
import { ensureCrawlerScript } from '../pipeline/generate-crawler-script.mjs';
import { capture } from '../pipeline/capture.mjs';
import { derivePageFacts, expandStates } from '../pipeline/expand-states.mjs';
import { siteKeepalive } from './site-keepalive.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..');
const BILIBILI_DOWNLOAD_PYTHON_ENTRY = path.join(REPO_ROOT, 'src', 'sites', 'bilibili', 'download', 'python', 'bilibili.py');
const BOOK_DOWNLOAD_PYTHON_ENTRY = path.join(REPO_ROOT, 'src', 'sites', 'chapter-content', 'download', 'python', 'book.py');
const DEFAULT_OPTIONS = {
  outDir: path.join(REPO_ROOT, 'runs', 'sites', 'site-doctor'),
  profilePath: null,
  query: null,
  browserPath: undefined,
  browserProfileRoot: undefined,
  userDataDir: undefined,
  timeoutMs: 30_000,
  headless: true,
  reuseLoginState: undefined,
  autoLogin: undefined,
  maxTriggers: 6,
  maxCapturedStates: 3,
  crawlerScriptsDir: path.join(REPO_ROOT, 'crawler-scripts'),
  knowledgeBaseDir: undefined,
  checkDownload: false,
  pythonCommand: 'pypy3',
};

const HELP = `Usage:
  node src/entrypoints/sites/site-doctor.mjs <url> [--query "<sample>"] [--profile-path <path>] [--out-dir <dir>] [--crawler-scripts-dir <dir>] [--knowledge-base-dir <dir>] [--browser-path <path>] [--browser-profile-root <dir>] [--user-data-dir <dir>] [--timeout <ms>] [--headless|--no-headless] [--reuse-login-state|--no-reuse-login-state] [--auto-login|--no-auto-login] [--max-triggers <n>] [--max-captured-states <n>] [--check-download]
`;

const AUTH_PROBE_WAIT_POLICY = {
  useLoadEvent: false,
  useNetworkIdle: false,
  documentReadyTimeoutMs: 8_000,
  domQuietTimeoutMs: 8_000,
  domQuietMs: 400,
  idleMs: 250,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTimestampForDir(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1Z');
}

function normalizeBoolean(value, flagName) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true') {
      return true;
    }
    if (lower === 'false') {
      return false;
    }
  }
  throw new Error(`Invalid boolean for ${flagName}: ${value}`);
}

function normalizeNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid number for ${flagName}: ${value}`);
  }
  return parsed;
}

function mergeOptions(inputUrl, options = {}) {
  const merged = { ...DEFAULT_OPTIONS, ...options };
  const parsed = new URL(inputUrl);
  merged.host = parsed.hostname;
  merged.profilePath = merged.profilePath
    ? path.resolve(merged.profilePath)
    : resolveProfilePathForUrl(inputUrl, { profilesDir: path.join(REPO_ROOT, 'profiles') });
  merged.outDir = path.resolve(merged.outDir);
  merged.crawlerScriptsDir = path.resolve(merged.crawlerScriptsDir);
  merged.knowledgeBaseDir = merged.knowledgeBaseDir ? path.resolve(merged.knowledgeBaseDir) : undefined;
  merged.browserProfileRoot = merged.browserProfileRoot ? path.resolve(merged.browserProfileRoot) : undefined;
  merged.userDataDir = merged.userDataDir ? path.resolve(merged.userDataDir) : undefined;
  merged.timeoutMs = normalizeNumber(merged.timeoutMs, 'timeoutMs');
  merged.maxTriggers = normalizeNumber(merged.maxTriggers, 'maxTriggers');
  merged.maxCapturedStates = normalizeNumber(merged.maxCapturedStates, 'maxCapturedStates');
  const hasExplicitHeadless = Object.prototype.hasOwnProperty.call(options, 'headless');
  merged.headless = normalizeBoolean(
    hasExplicitHeadless
      ? merged.headless
      : (resolveCanonicalSiteKey({ inputUrl }) === 'douyin' ? false : DEFAULT_OPTIONS.headless),
    'headless',
  );
  merged.checkDownload = normalizeBoolean(merged.checkDownload, 'checkDownload');
  if (merged.reuseLoginState !== undefined) {
    merged.reuseLoginState = normalizeBoolean(merged.reuseLoginState, 'reuseLoginState');
  }
  if (merged.autoLogin !== undefined) {
    merged.autoLogin = normalizeBoolean(merged.autoLogin, 'autoLogin');
  }
  return merged;
}

function createCheck(name) {
  return {
    name,
    valid: false,
    status: 'pending',
    details: null,
    error: null,
  };
}

function markPass(check, details = null) {
  check.valid = true;
  check.status = 'pass';
  check.details = details;
  check.error = null;
}

function markFail(check, error, details = null) {
  check.valid = false;
  check.status = 'fail';
  check.details = details;
  check.error = {
    message: error?.message ?? String(error),
  };
}

function markSkipped(check, reason, details = null) {
  check.valid = false;
  check.status = 'skipped';
  check.details = details;
  check.error = reason ? { message: reason } : null;
}

function chooseSample(profile, explicitQuery) {
  const validationQuery = String(profile?.validationSamples?.videoSearchQuery ?? '').trim();
  if (validationQuery) {
    return {
      source: 'profile.validationSamples.videoSearchQuery',
      query: validationQuery,
      title: null,
      url: String(profile?.validationSamples?.videoDetailUrl ?? '').trim() || null,
      authorName: null,
    };
  }
  if (explicitQuery) {
    return {
      source: '--query',
      query: explicitQuery,
      title: null,
      url: null,
      authorName: null,
    };
  }
  const knownQuery = Array.isArray(profile?.search?.knownQueries) ? profile.search.knownQueries[0] : null;
  if (knownQuery?.query) {
    return {
      source: 'profile.search.knownQueries[0]',
      query: knownQuery.query,
      title: knownQuery.title ?? null,
      url: knownQuery.url ?? null,
      authorName: knownQuery.authorName ?? null,
    };
  }
  return null;
}

function isDouyinProfile(profile = null, inputUrl = '') {
  return resolveCanonicalSiteKey({
    profile,
    inputUrl,
  }) === 'douyin';
}

function buildScenarioResult(id, startUrl, status, details = {}) {
  return {
    id,
    status,
    startUrl,
    stateId: details.stateId ?? null,
    finalUrl: details.finalUrl ?? null,
    pageType: details.pageType ?? null,
    semanticPageType: details.semanticPageType ?? (details.pageType ? toSemanticPageType(details.pageType) : null),
    expectedSemanticPageType: details.expectedSemanticPageType ?? null,
    authRequired: details.authRequired === true,
    reasonCode: details.reasonCode ?? null,
    antiCrawlSignals: uniqueSortedStrings(toArray(details.antiCrawlSignals).filter(Boolean)),
    emptyShell: details.emptyShell === true,
    featuredAuthorCount: Number(details.featuredAuthorCount ?? 0),
    featuredContentCount: Number(details.featuredContentCount ?? 0),
    riskCauseCode: details.riskCauseCode ?? null,
    riskAction: details.riskAction ?? null,
    networkIdentityFingerprint: details.networkIdentityFingerprint ?? null,
    profileQuarantined: details.profileQuarantined === true,
    note: details.note ?? null,
    error: details.error ? { message: details.error.message ?? String(details.error) } : null,
    diagnosis: details.diagnosis ?? null,
  };
}

function extractAntiCrawlSignals(state = null) {
  return uniqueSortedStrings(toArray(state?.pageFacts?.antiCrawlSignals).filter(Boolean));
}

function resolveScenarioSampleUrl(definition, samples, authSamples) {
  const resolveValue = (containerName, fieldName) => {
    if (!containerName || !fieldName) {
      return '';
    }
    const source = containerName === 'authValidationSamples' ? authSamples : samples;
    return String(source?.[fieldName] ?? '').trim();
  };

  const primaryValue = resolveValue(definition.sampleContainer, definition.sampleField);
  if (primaryValue) {
    return {
      startUrl: primaryValue,
      missingFieldPaths: [],
      missingFieldMessage: null,
    };
  }

  const fallbackRefs = Array.isArray(definition.fallbackSamples) ? definition.fallbackSamples : [];
  for (const fallback of fallbackRefs) {
    const fallbackValue = resolveValue(fallback.container, fallback.field);
    if (fallbackValue) {
      return {
        startUrl: fallbackValue,
        missingFieldPaths: [],
        missingFieldMessage: null,
      };
    }
  }

  const missingFieldPaths = [
    definition.sampleContainer && definition.sampleField ? `profile.${definition.sampleContainer}.${definition.sampleField}` : null,
    ...fallbackRefs.map((fallback) => `profile.${fallback.container}.${fallback.field}`),
  ].filter(Boolean);

  return {
    startUrl: '',
    missingFieldPaths,
    missingFieldMessage: missingFieldPaths.join(' or '),
  };
}

function buildNetworkIdentityFingerprint(inputUrl, userDataDir = null) {
  const normalizedUrl = String(inputUrl ?? '').trim();
  const normalizedUserDataDir = String(userDataDir ?? '').trim();
  if (!normalizedUrl && !normalizedUserDataDir) {
    return null;
  }
  const fingerprintSource = [normalizedUrl, normalizedUserDataDir].filter(Boolean).join('|');
  return createHash('sha1').update(fingerprintSource).digest('hex').slice(0, 16);
}

function deriveNoDedicatedIpRiskAssessment({
  reasonCode = null,
  authRequired = false,
  networkIdentityFingerprint = null,
  profileQuarantined = false,
  antiCrawlSignals = [],
} = {}) {
  const normalizedSignals = uniqueSortedStrings([
    ...toArray(antiCrawlSignals).filter(Boolean),
    ...(reasonCode === 'anti-crawl-rate-limit' ? ['rate-limit'] : []),
    ...(reasonCode === 'anti-crawl-verify' ? ['verify'] : []),
    ...(reasonCode === 'anti-crawl-challenge' || reasonCode === 'anti-crawl' ? ['challenge'] : []),
  ]);
  const classified = classifyRiskFromContext({
    antiCrawlSignals: normalizedSignals,
    authRequired,
    authAvailable: reasonCode !== 'not-logged-in',
    identityConfirmed: authRequired ? !['not-logged-in', 'content-quality-unknown'].includes(String(reasonCode ?? '')) : true,
    loginStateDetected: authRequired ? reasonCode !== 'not-logged-in' : true,
  });
  const quarantined = profileQuarantined === true
    || (
      ['browser-fingerprint-risk', 'session-invalid'].includes(String(classified.riskCauseCode ?? ''))
      && normalizedSignals.some((signal) => /verify|captcha|challenge|middle/u.test(signal))
    );
  return {
    riskCauseCode: classified.riskCauseCode ?? null,
    riskAction: classified.riskAction ?? null,
    networkIdentityFingerprint: networkIdentityFingerprint ?? null,
    profileQuarantined: quarantined,
  };
}

function mergeRiskAssessment(base = {}, override = {}) {
  return {
    riskCauseCode: override.riskCauseCode ?? base.riskCauseCode ?? null,
    riskAction: override.riskAction ?? base.riskAction ?? null,
    networkIdentityFingerprint: override.networkIdentityFingerprint ?? base.networkIdentityFingerprint ?? null,
    profileQuarantined: override.profileQuarantined === true || base.profileQuarantined === true,
  };
}

function riskPriority(riskCauseCode = null) {
  switch (String(riskCauseCode ?? '')) {
    case 'concurrent-profile-use':
      return 6;
    case 'profile-health-risk':
      return 5;
    case 'request-burst':
      return 4;
    case 'session-invalid':
      return 3;
    case 'browser-fingerprint-risk':
      return 2;
    case 'network-identity-drift':
      return 1;
    default:
      return 0;
  }
}

function summarizeReportRisk(report) {
  const scenarioCandidates = Array.isArray(report?.scenarios) ? report.scenarios : [];
  const authCandidate = report?.authSession ? {
    riskCauseCode: report.authSession.riskCauseCode ?? null,
    riskAction: report.authSession.riskAction ?? null,
    networkIdentityFingerprint: report.authSession.networkIdentityFingerprint ?? null,
    profileQuarantined: report.authSession.profileQuarantined === true,
  } : null;
  const ranked = [...scenarioCandidates, authCandidate].filter(Boolean);
  let selected = null;
  for (const candidate of ranked) {
    if (!selected || riskPriority(candidate.riskCauseCode) > riskPriority(selected.riskCauseCode)) {
      selected = candidate;
    }
  }
  const anyQuarantined = ranked.some((candidate) => candidate?.profileQuarantined === true);
  return {
    riskCauseCode: selected?.riskCauseCode ?? null,
    riskAction: selected?.riskAction ?? null,
    networkIdentityFingerprint: selected?.networkIdentityFingerprint ?? authCandidate?.networkIdentityFingerprint ?? null,
    profileQuarantined: anyQuarantined,
  };
}

function summarizeDoctorBudget(expandManifest, settings) {
  const stopReason = (expandManifest?.warnings ?? []).find((warning) => /Expansion stopped after reaching /u.test(String(warning))) ?? null;
  return {
    maxTriggers: settings.maxTriggers,
    maxCapturedStates: settings.maxCapturedStates,
    hit: Boolean(stopReason),
    stopReason,
  };
}

function buildReportMarkdown(report) {
  const lines = [
    '# Site Doctor',
    '',
    `- URL: ${report.site.url}`,
    `- Host: ${report.site.host}`,
    `- Archetype: ${report.site.archetype ?? 'unknown'}`,
    `- Profile path: ${report.site.profilePath}`,
    `- Adapter recommendation: ${report.adapterRecommendation ?? 'unknown'}`,
    '',
    '## Validation sample',
    '',
    `- Source: ${report.sample?.source ?? 'none'}`,
    `- Query: ${report.sample?.query ?? 'none'}`,
    `- Title: ${report.sample?.title ?? 'none'}`,
    `- URL: ${report.sample?.url ?? 'none'}`,
    `- Author: ${report.sample?.authorName ?? 'none'}`,
    '',
    '## Checks',
    '',
  ];

  for (const key of ['profile', 'crawler', 'capture', 'expand', 'search', 'detail', 'author', 'chapter', 'download']) {
    const check = report[key];
    if (!check) {
      continue;
    }
    lines.push(`- ${key}: ${check.status}${check.error?.message ? ` (${check.error.message})` : ''}`);
  }

  if (report.expand?.details?.budget) {
    lines.push('', '## Expansion budget', '');
    lines.push(`- maxTriggers: ${report.expand.details.budget.maxTriggers}`);
    lines.push(`- maxCapturedStates: ${report.expand.details.budget.maxCapturedStates}`);
    lines.push(`- hit budget: ${report.expand.details.budget.hit ? 'yes' : 'no'}`);
    lines.push(`- stop reason: ${report.expand.details.budget.stopReason ?? 'none'}`);
  }

  lines.push('', '## Missing fields', '');
  lines.push(...(report.missingFields.length ? report.missingFields.map((field) => `- ${field}`) : ['- none']));
  lines.push('', '## Next actions', '');
  lines.push(...(report.nextActions.length ? report.nextActions.map((step) => `- ${step}`) : ['- none']));
  lines.push('', '## Warnings', '');
  lines.push(...(report.warnings.length ? report.warnings.map((warning) => `- ${warning}`) : ['- none']));
  if (report.sessionReuseWorked !== null) {
    lines.push('', '## Auth Session', '');
    lines.push(`- Session reuse worked: ${report.sessionReuseWorked ? 'yes' : 'no'}`);
    if (report.authSession) {
      lines.push(`- Login state detected: ${report.authSession.loginStateDetected ? 'yes' : 'no'}`);
      lines.push(`- Identity confirmed: ${report.authSession.identityConfirmed ? 'yes' : 'no'}`);
      lines.push(`- Identity source: ${report.authSession.identitySource ?? 'none'}`);
      lines.push(`- Current URL: ${report.authSession.currentUrl ?? 'unknown'}`);
      lines.push(`- Title: ${report.authSession.title ?? 'unknown'}`);
      lines.push(`- Keepalive preflight: ${report.authSession.keepalivePreflight?.ran ? 'ran' : 'skipped'}`);
      lines.push(`- Keepalive preflight trigger: ${report.authSession.keepalivePreflight?.trigger ?? 'none'}`);
      lines.push(`- Keepalive preflight status: ${report.authSession.keepalivePreflight?.status ?? 'none'}`);
      lines.push(`- Keepalive threshold (minutes): ${report.authSession.keepalivePreflight?.thresholdMinutes ?? 'unknown'}`);
      lines.push(`- Last healthy at: ${report.authSession.sessionHealthSummary?.lastHealthyAt ?? 'none'}`);
      lines.push(`- Next suggested keepalive at: ${report.authSession.sessionHealthSummary?.nextSuggestedKeepaliveAt ?? 'none'}`);
      lines.push(`- Keepalive due: ${report.authSession.sessionHealthSummary?.keepaliveDue ? 'yes' : 'no'}`);
      lines.push(`- Network identity fingerprint: ${report.authSession.networkIdentityFingerprint ?? 'none'}`);
      lines.push(`- Risk cause code: ${report.authSession.riskCauseCode ?? 'none'}`);
      lines.push(`- Risk action: ${report.authSession.riskAction ?? 'none'}`);
      lines.push(`- Profile quarantined: ${report.authSession.profileQuarantined ? 'yes' : 'no'}`);
      if (report.authSession.probeFailed) {
        lines.push('- Probe failed: yes');
        lines.push(`- Probe error: ${report.authSession.probeError ?? 'unknown'}`);
      }
    }
  }
  if (report.riskCauseCode || report.riskAction || report.networkIdentityFingerprint || report.profileQuarantined) {
    lines.push('', '## Risk Governance', '');
    lines.push(`- Risk cause code: ${report.riskCauseCode ?? 'none'}`);
    lines.push(`- Risk action: ${report.riskAction ?? 'none'}`);
    lines.push(`- Network identity fingerprint: ${report.networkIdentityFingerprint ?? 'none'}`);
    lines.push(`- Profile quarantined: ${report.profileQuarantined ? 'yes' : 'no'}`);
  }
  if (Array.isArray(report.scenarios) && report.scenarios.length > 0) {
    lines.push('', '## Scenarios', '');
    for (const scenario of report.scenarios) {
      const observed = [
        scenario.stateId ? `state=${scenario.stateId}` : null,
        scenario.semanticPageType ? `observed=${scenario.semanticPageType}` : null,
        scenario.expectedSemanticPageType ? `expected=${scenario.expectedSemanticPageType}` : null,
        scenario.authRequired ? 'auth=required' : null,
      ].filter(Boolean).join(', ');
      const antiCrawl = Array.isArray(scenario.antiCrawlSignals) && scenario.antiCrawlSignals.length > 0
        ? ` [anti-crawl=${scenario.antiCrawlSignals.join(', ')}]`
        : '';
      const reason = scenario.reasonCode ? ` [reason=${scenario.reasonCode}]` : '';
      const risk = scenario.riskCauseCode ? ` [risk=${scenario.riskCauseCode}]` : '';
      const action = scenario.riskAction ? ` [action=${scenario.riskAction}]` : '';
      const quarantine = scenario.profileQuarantined ? ' [profile-quarantined=yes]' : '';
      const fingerprint = scenario.networkIdentityFingerprint ? ` [fingerprint=${scenario.networkIdentityFingerprint}]` : '';
      lines.push(`- ${scenario.id}: ${scenario.status}${scenario.finalUrl ? ` -> ${scenario.finalUrl}` : ''}${observed ? ` [${observed}]` : ''}${reason}${antiCrawl}${risk}${action}${quarantine}${fingerprint}${scenario.note ? ` (${scenario.note})` : ''}${scenario.error?.message ? ` (${scenario.error.message})` : ''}`);
    }
  }
  return lines.join('\n');
}

async function maybeReadStateManifest(entry, deps) {
  const manifestPath = entry?.files?.manifest;
  if (!manifestPath || !await deps.pathExists(manifestPath)) {
    return null;
  }
  return deps.readJsonFile(manifestPath);
}

async function collectExpandedStates(expandManifest, siteProfile, deps) {
  const states = [];
  for (const entry of expandManifest?.states ?? []) {
    const persisted = await maybeReadStateManifest(entry, deps);
    const finalUrl = persisted?.finalUrl ?? entry.finalUrl ?? null;
    const title = persisted?.title ?? entry.title ?? null;
    const pageType = persisted?.pageType
      ?? entry.pageType
      ?? inferPageTypeFromUrl(finalUrl, siteProfile);
    const pageFacts = persisted?.pageFacts
      ?? entry.pageFacts
      ?? (finalUrl && pageType
        ? derivePageFacts({
            pageType,
            siteProfile,
            finalUrl,
            title,
          })
        : null);
    states.push({
      ...entry,
      persisted,
      finalUrl,
      title,
      pageType,
      semanticPageType: toSemanticPageType(pageType),
      pageFacts,
    });
  }
  return states;
}

function findFirstState(states, predicate) {
  return states.find((state) => predicate(state) && ['initial', 'captured', 'duplicate', 'noop'].includes(String(state.status ?? ''))) ?? null;
}

function findFirstDetailState(states) {
  return findFirstState(states, (state) => ['book-detail-page', 'content-detail-page'].includes(String(state.pageType ?? '')));
}

function normalizeUrlNoFragment(input) {
  if (!input) {
    return input;
  }
  try {
    const parsed = new URL(input);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(input).split('#')[0];
  }
}

function normalizeAuthRequiredAuthorSubpages(profile = null) {
  const values = profile?.authSession?.authRequiredAuthorSubpages;
  return Array.isArray(values)
    ? values.map((value) => String(value ?? '').trim().replace(/^\/+|\/+$/gu, '')).filter(Boolean)
    : [];
}

function isAuthRequiredAuthorSubpage(profile = null, subpage = '') {
  const normalizedSubpage = String(subpage ?? '').trim().replace(/^\/+|\/+$/gu, '');
  if (!normalizedSubpage) {
    return false;
  }
  const configured = normalizeAuthRequiredAuthorSubpages(profile);
  return configured.some((value) => (
    normalizedSubpage === value
      || normalizedSubpage.startsWith(`${value}/`)
      || (value === 'fans/follow' && normalizedSubpage === 'follow')
      || (value === 'fans/fans' && normalizedSubpage === 'fans')
  ));
}

function findStateByUrl(states, expectedUrl) {
  const normalizedExpected = normalizeUrlNoFragment(expectedUrl);
  if (!normalizedExpected) {
    return null;
  }
  return findFirstState(states, (state) => normalizeUrlNoFragment(state.finalUrl) === normalizedExpected);
}

function summarizeScenarioDiagnosis(diagnosis) {
  if (!diagnosis) {
    return null;
  }
  return {
    reasonCode: diagnosis.reasonCode ?? null,
    antiCrawlSignals: uniqueSortedStrings(toArray(diagnosis.antiCrawlSignals).filter(Boolean)),
    emptyShell: diagnosis.emptyShell === true,
    featuredAuthorCount: Number(diagnosis.featuredAuthorCount ?? 0),
    featuredContentCount: Number(diagnosis.featuredContentCount ?? 0),
    authorSubpage: diagnosis.authorSubpage ?? null,
    identityConfirmed: diagnosis.identityConfirmed === true,
    loginStateDetected: diagnosis.loginStateDetected === true,
    authenticatedSessionConfirmed: diagnosis.authenticatedSessionConfirmed === true,
    riskCauseCode: diagnosis.riskCauseCode ?? null,
    riskAction: diagnosis.riskAction ?? null,
    networkIdentityFingerprint: diagnosis.networkIdentityFingerprint ?? null,
    profileQuarantined: diagnosis.profileQuarantined === true,
  };
}

async function runCaptureExpandScenario(startUrl, scenarioId, settings, runtime, validatedProfile, searchQueries = []) {
  const scenarioBudget = resolveScenarioDoctorBudget(settings, validatedProfile?.profile, scenarioId);
  const scenarioDir = path.join(settings.reportDir, 'scenarios', scenarioId);
  const maxAttempts = isDouyinProfile(validatedProfile?.profile) ? 3 : 2;
  for (let attempt = 0; ; attempt += 1) {
    const captureManifest = await runtime.capture(startUrl, {
      outDir: path.join(scenarioDir, 'capture'),
      browserPath: settings.browserPath,
      browserProfileRoot: settings.browserProfileRoot,
      userDataDir: settings.userDataDir,
      timeoutMs: settings.timeoutMs,
      headless: settings.headless,
      reuseLoginState: settings.reuseLoginState,
      autoLogin: settings.autoLogin,
    });
    const retryableCaptureFailure = isRetryableScenarioCaptureFailure(captureManifest);
    if (retryableCaptureFailure && attempt + 1 < maxAttempts) {
      await sleep(400 * (attempt + 1));
      continue;
    }
    if (!captureManifest?.files?.manifest) {
      throw new Error(`Scenario ${scenarioId} did not produce an initial capture manifest.`);
    }
    if (captureManifest?.status === 'failed') {
      const error = new Error(captureManifest?.error?.message ?? `Scenario ${scenarioId} capture failed.`);
      error.code = captureManifest?.error?.code ?? 'SCENARIO_CAPTURE_FAILED';
      error.runtimeGovernance = captureManifest?.runtimeGovernance ?? null;
      throw error;
    }
    const expandManifest = await runtime.expandStates(startUrl, {
      initialManifestPath: captureManifest.files.manifest,
      outDir: path.join(scenarioDir, 'expand'),
      profilePath: validatedProfile.filePath,
      browserPath: settings.browserPath,
      browserProfileRoot: settings.browserProfileRoot,
      userDataDir: settings.userDataDir,
      timeoutMs: settings.timeoutMs,
      headless: settings.headless,
      reuseLoginState: settings.reuseLoginState,
      autoLogin: settings.autoLogin,
      maxTriggers: scenarioBudget.maxTriggers,
      maxCapturedStates: scenarioBudget.maxCapturedStates,
      searchQueries,
    });
    const states = await collectExpandedStates(expandManifest, validatedProfile.profile, runtime);
    return { captureManifest, expandManifest, states };
  }
}

function resolveScenarioDoctorBudget(settings, profile = null, scenarioId = '') {
  const defaults = {
    maxTriggers: settings.maxTriggers,
    maxCapturedStates: settings.maxCapturedStates,
  };
  if (!isDouyinProfile(profile)) {
    return defaults;
  }
  const lightweightScenarioIds = new Set([
    'public-author-posts',
    'self-posts',
    'self-likes',
    'self-collections',
    'self-history',
    'follow-feed',
    'follow-users',
  ]);
  if (!lightweightScenarioIds.has(String(scenarioId ?? ''))) {
    return defaults;
  }
  return {
    maxTriggers: Math.min(defaults.maxTriggers, 1),
    maxCapturedStates: Math.min(defaults.maxCapturedStates, 1),
  };
}

function isRetryableScenarioCaptureFailure(captureManifest = null) {
  const code = String(captureManifest?.error?.code ?? '').trim();
  const message = String(captureManifest?.error?.message ?? '').trim();
  return code === 'concurrent-profile-use'
    || /Browser exited before DevTools became ready/iu.test(message)
    || /Timed out waiting for DevToolsActivePort/iu.test(message)
    || /Timed out waiting for browser websocket endpoint/iu.test(message);
}

function isRetryableAuthProbeFailure(error) {
  const message = String(error?.message ?? error ?? '').trim();
  return /CDP socket closed:/iu.test(message)
    || /Browser exited before DevTools became ready/iu.test(message)
    || /Timed out waiting for DevToolsActivePort/iu.test(message)
    || /Timed out waiting for browser websocket endpoint/iu.test(message)
    || /Target closed/iu.test(message)
    || /Inspector\.detached/iu.test(message)
    || /CDP timeout for Runtime\.evaluate/iu.test(message);
}

function buildKeepaliveProbeResult(keepaliveReport, fallbackFingerprint = null) {
  const keepalive = keepaliveReport?.keepalive ?? {};
  const loginReportAuth = keepaliveReport?.loginReport?.auth ?? {};
  const authStatus = String(keepalive.authStatus ?? loginReportAuth.status ?? '').trim();
  const authAvailable = keepalive.persistenceVerified === true
    || authStatus === 'already-authenticated'
    || authStatus === 'authenticated'
    || authStatus === 'session-reused';
  return {
    attempted: true,
    authAvailable,
    loginStateDetected: loginReportAuth.loginStateDetected === true || authAvailable,
    identityConfirmed: loginReportAuth.identityConfirmed === true || authAvailable,
    identitySource: loginReportAuth.identitySource ?? null,
    currentUrl: loginReportAuth.currentUrl ?? keepalive.runtimeUrl ?? keepalive.keepaliveUrl ?? null,
    title: loginReportAuth.currentTitle ?? loginReportAuth.title ?? null,
    networkIdentityFingerprint: keepalive.networkIdentityFingerprint ?? loginReportAuth.networkIdentityFingerprint ?? fallbackFingerprint,
    riskCauseCode: keepalive.riskCauseCode ?? loginReportAuth.riskCauseCode ?? null,
    riskAction: keepalive.riskAction ?? loginReportAuth.riskAction ?? null,
    profileQuarantined: keepalive.profileQuarantined === true || loginReportAuth.profileQuarantined === true,
  };
}

async function probeReusableLoginSession(inputUrl, settings, runtime, validatedProfile) {
  const authProfile = await runtime.resolveSiteAuthProfile(inputUrl, {
    profilePath: settings.profilePath,
    siteProfile: validatedProfile.profile,
  });
  const authContext = await runtime.resolveSiteBrowserSessionOptions(inputUrl, {
    profilePath: settings.profilePath,
    browserProfileRoot: settings.browserProfileRoot,
    userDataDir: settings.userDataDir,
    reuseLoginState: settings.reuseLoginState,
    autoLogin: settings.autoLogin,
  }, {
    profilePath: settings.profilePath,
    authProfile,
  });

  if (!authContext.authConfig?.loginUrl || !authContext.reuseLoginState || !authContext.userDataDir) {
    return {
      attempted: false,
      authAvailable: null,
      loginStateDetected: false,
      identityConfirmed: false,
      identitySource: null,
      networkIdentityFingerprint: null,
      riskCauseCode: null,
      riskAction: null,
      profileQuarantined: false,
    };
  }

  const probeUrl = resolveAuthVerificationUrl(inputUrl, authProfile, authContext.authConfig)
    || authContext.authConfig.postLoginUrl
    || inputUrl;
  const networkIdentityFingerprint = buildNetworkIdentityFingerprint(inputUrl, authContext.userDataDir);
  const maxAttempts = isDouyinProfile(validatedProfile?.profile) ? 3 : 2;
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let session = null;
    try {
      session = await runtime.openBrowserSession({
        browserPath: settings.browserPath,
        headless: settings.headless,
        timeoutMs: settings.timeoutMs,
        fullPage: false,
        viewport: {
          width: 1440,
          height: 900,
          deviceScaleFactor: 1,
        },
        userDataDir: authContext.userDataDir,
        cleanupUserDataDirOnShutdown: authContext.cleanupUserDataDirOnShutdown,
        startupUrl: probeUrl,
      }, {
        userDataDirPrefix: 'site-doctor-auth-probe-',
      });

      await session.navigateAndWait(probeUrl, AUTH_PROBE_WAIT_POLICY);
      const shouldEnsureAuth = Boolean(authContext.authConfig)
        && (settings.autoLogin === true || authContext.authConfig.autoLoginByDefault === true);
      const ensuredAuth = shouldEnsureAuth
        ? await runtime.ensureAuthenticatedSession(session, inputUrl, settings, { authContext })
        : null;
      const loginState = ensuredAuth?.loginState ?? await runtime.inspectLoginState(session, authContext.authConfig);
      const probeRisk = deriveNoDedicatedIpRiskAssessment({
        reasonCode: loginState?.challengeDetected ? 'anti-crawl-verify' : null,
        authRequired: false,
        networkIdentityFingerprint: loginState?.networkIdentityFingerprint ?? networkIdentityFingerprint,
        profileQuarantined: loginState?.profileQuarantined === true,
      });
      return {
        attempted: true,
        authAvailable: loginState?.identityConfirmed === true,
        loginStateDetected: loginState?.loginStateDetected === true || loginState?.loggedIn === true,
        identityConfirmed: loginState?.identityConfirmed === true,
        identitySource: loginState?.identitySource ?? null,
        currentUrl: loginState?.currentUrl ?? null,
        title: loginState?.title ?? null,
        networkIdentityFingerprint: probeRisk.networkIdentityFingerprint,
        riskCauseCode: probeRisk.riskCauseCode,
        riskAction: probeRisk.riskAction,
        profileQuarantined: probeRisk.profileQuarantined,
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableAuthProbeFailure(error) || attempt + 1 >= maxAttempts) {
        break;
      }
      await sleep(400 * (attempt + 1));
    } finally {
      if (session) {
        await session.close();
      }
    }
  }

  if (lastError && isRetryableAuthProbeFailure(lastError) && typeof runtime.siteKeepalive === 'function') {
    const keepaliveReport = await runtime.siteKeepalive(inputUrl, {
      profilePath: settings.profilePath,
      outDir: path.join(settings.reportDir, 'auth-probe-keepalive'),
      browserPath: settings.browserPath,
      browserProfileRoot: settings.browserProfileRoot,
      userDataDir: settings.userDataDir,
      timeoutMs: settings.timeoutMs,
      headless: settings.headless,
      reuseLoginState: true,
      autoLogin: settings.autoLogin,
    });
    return buildKeepaliveProbeResult(keepaliveReport, networkIdentityFingerprint);
  }

  throw lastError ?? new Error('Could not probe reusable login session.');
}

async function validateScenarioMatrix(inputUrl, settings, runtime, validatedProfile, primaryContext, authProbe = null) {
  const suite = resolveSiteDoctorScenarioSuite({
    siteKey: primaryContext?.siteIdentity?.siteKey ?? null,
    profile: validatedProfile.profile,
    helpers: {
      buildScenarioResult,
      extractAntiCrawlSignals,
      findFirstDetailState,
      findFirstState,
      findStateByUrl,
      isAuthRequiredAuthorSubpage,
      toSemanticPageType,
    },
  });
  if (!suite) {
    return {
      scenarios: [],
      warnings: [],
      missingFields: [],
    };
  }

  const samples = validatedProfile.profile?.validationSamples ?? {};
  const authSamples = validatedProfile.profile?.authValidationSamples ?? {};
  const authFingerprint = authProbe?.networkIdentityFingerprint ?? null;
  const primaryScenario = suite.buildPrimaryScenario(primaryContext, inputUrl);
  const primaryRisk = deriveNoDedicatedIpRiskAssessment({
    reasonCode: primaryScenario.reasonCode,
    authRequired: primaryScenario.authRequired,
    networkIdentityFingerprint: primaryScenario.networkIdentityFingerprint ?? authFingerprint,
    profileQuarantined: primaryScenario.profileQuarantined === true,
  });
  const scenarios = [buildScenarioResult(primaryScenario.id, primaryScenario.startUrl, primaryScenario.status, {
    ...primaryScenario,
    ...primaryRisk,
  })];
  const scenarioWarnings = [];
  const missingScenarioFields = [];

  for (const definition of suite.scenarioDefinitions) {
    const sampleResolution = resolveScenarioSampleUrl(definition, samples, authSamples);
    const startUrl = sampleResolution.startUrl;
    if (!startUrl) {
      scenarios.push(buildScenarioResult(definition.id, null, 'skipped', {
        expectedSemanticPageType: definition.expectedSemanticPageType,
        authRequired: definition.authRequired,
        networkIdentityFingerprint: authFingerprint,
        note: `Expected to validate ${definition.expectedSemanticPageType}.`,
        error: new Error(`Missing ${sampleResolution.missingFieldMessage}`),
      }));
      missingScenarioFields.push(...sampleResolution.missingFieldPaths);
      scenarioWarnings.push(`Skipped ${suite.siteLabel} scenario ${definition.id} because ${sampleResolution.missingFieldMessage} is missing.`);
      continue;
    }

    if (definition.authRequired && authProbe?.attempted && authProbe.authAvailable !== true) {
      scenarios.push(buildScenarioResult(definition.id, startUrl, 'skipped', {
        expectedSemanticPageType: definition.expectedSemanticPageType,
        authRequired: true,
        reasonCode: 'not-logged-in',
        networkIdentityFingerprint: authFingerprint,
        note: `Expected to validate ${definition.expectedSemanticPageType}.`,
        error: new Error(`Reusable ${suite.siteLabel} login state is unavailable for this authenticated scenario.`),
      }));
      scenarioWarnings.push(`Skipped ${suite.siteLabel} scenario ${definition.id} because no reusable logged-in ${suite.siteLabel} session was detected.`);
      continue;
    }

    try {
      const { states } = await runCaptureExpandScenario(startUrl, definition.id, settings, runtime, validatedProfile, definition.searchQueries);
      const matchedState = definition.resolveResult(states, startUrl);
      if (!matchedState) {
        const risk = deriveNoDedicatedIpRiskAssessment({
          reasonCode: 'matching-state-missing',
          authRequired: definition.authRequired,
          networkIdentityFingerprint: authFingerprint,
        });
        scenarios.push(buildScenarioResult(definition.id, startUrl, 'fail', {
          expectedSemanticPageType: definition.expectedSemanticPageType,
          authRequired: definition.authRequired,
          reasonCode: 'matching-state-missing',
          ...risk,
          note: `Expected to validate ${definition.expectedSemanticPageType}.`,
          error: new Error(`Scenario ${definition.id} did not capture any matching state.`),
        }));
        continue;
      }

      const diagnosis = suite.diagnoseState(matchedState, {
        authRequired: definition.authRequired,
        authAvailable: authProbe?.authAvailable,
      });
      const antiCrawlSignals = diagnosis.antiCrawlSignals ?? extractAntiCrawlSignals(matchedState);
      const risk = mergeRiskAssessment(
        deriveNoDedicatedIpRiskAssessment({
          reasonCode: diagnosis.reasonCode,
          authRequired: definition.authRequired,
          networkIdentityFingerprint: diagnosis.networkIdentityFingerprint ?? matchedState?.pageFacts?.networkIdentityFingerprint ?? authFingerprint,
          profileQuarantined: diagnosis.profileQuarantined === true || matchedState?.pageFacts?.profileQuarantined === true,
        }),
        {
          riskCauseCode: diagnosis.riskCauseCode ?? matchedState?.pageFacts?.riskCauseCode ?? null,
          riskAction: diagnosis.riskAction ?? matchedState?.pageFacts?.riskAction ?? null,
          networkIdentityFingerprint: diagnosis.networkIdentityFingerprint ?? matchedState?.pageFacts?.networkIdentityFingerprint ?? authFingerprint,
          profileQuarantined: diagnosis.profileQuarantined === true || matchedState?.pageFacts?.profileQuarantined === true,
        },
      );
      scenarios.push(buildScenarioResult(definition.id, startUrl, diagnosis.reasonCode === 'ok' ? 'pass' : 'fail', {
        stateId: matchedState.state_id ?? matchedState.stateId ?? null,
        finalUrl: matchedState.finalUrl,
        pageType: matchedState.pageType,
        semanticPageType: matchedState.semanticPageType ?? (matchedState.pageType ? toSemanticPageType(matchedState.pageType) : null),
        expectedSemanticPageType: definition.expectedSemanticPageType,
        authRequired: definition.authRequired,
        reasonCode: diagnosis.reasonCode,
        antiCrawlSignals,
        emptyShell: diagnosis.emptyShell,
        featuredAuthorCount: diagnosis.featuredAuthorCount,
        featuredContentCount: diagnosis.featuredContentCount,
        ...risk,
        note: `Expected to validate ${definition.expectedSemanticPageType}.`,
        diagnosis: summarizeScenarioDiagnosis({ ...diagnosis, ...risk }),
      }));
      if (diagnosis.reasonCode !== 'ok') {
        scenarioWarnings.push(`${suite.siteLabel} scenario ${definition.id} diagnosed as ${diagnosis.reasonCode}.`);
      }
      if (antiCrawlSignals.length > 0) {
        scenarioWarnings.push(`${suite.siteLabel} scenario ${definition.id} observed anti-crawl signals: ${antiCrawlSignals.join(', ') || 'unknown'}.`);
      }
      if (risk.profileQuarantined) {
        scenarioWarnings.push(`${suite.siteLabel} scenario ${definition.id} quarantined the reusable profile for fingerprint ${risk.networkIdentityFingerprint ?? 'unknown'}.`);
      }
    } catch (error) {
      const risk = deriveNoDedicatedIpRiskAssessment({
        reasonCode: 'upstream-error',
        authRequired: definition.authRequired,
        networkIdentityFingerprint: authFingerprint,
      });
      scenarios.push(buildScenarioResult(definition.id, startUrl, 'fail', {
        expectedSemanticPageType: definition.expectedSemanticPageType,
        authRequired: definition.authRequired,
        reasonCode: 'upstream-error',
        ...risk,
        note: `Expected to validate ${definition.expectedSemanticPageType}.`,
        error,
      }));
      scenarioWarnings.push(`${suite.siteLabel} scenario ${definition.id} failed: ${error.message ?? String(error)}`);
    }
  }

  return {
    scenarios,
    warnings: scenarioWarnings,
    missingFields: missingScenarioFields,
  };
}

function buildAdapterRecommendation(adapterId) {
  if (adapterId === 'generic-navigation') {
    return 'reuse-generic';
  }
  if (adapterId === 'chapter-content') {
    return 'reuse-chapter-content';
  }
  if (adapterId) {
    return `site-specific-adapter:${adapterId}`;
  }
  return 'unknown';
}

function buildNextActions(report, sample) {
  return uniqueSortedStrings([
    report.profile.status === 'fail' ? 'Fix profile validation errors before rerunning site-doctor.' : null,
    !sample ? 'Add profile.validationSamples.videoSearchQuery, profile.search.knownQueries[0], or pass --query for search validation.' : null,
    report.search?.status === 'fail' ? 'Update search selectors or the sample query until a search-results page is reachable.' : null,
    report.detail?.status === 'fail' ? 'Confirm content/detail path prefixes and result link selectors.' : null,
    report.author?.status === 'fail' ? 'Verify author path prefixes and author link selectors.' : null,
    report.chapter?.status === 'fail' ? 'Verify chapter selectors and chapter path detection.' : null,
    report.download?.status === 'fail' ? 'Ensure downloader dependencies are installed and the bilibili login state is reusable before rerunning --check-download.' : null,
    report.adapterRecommendation === 'unknown' ? 'Resolve site adapter selection before onboarding this host.' : null,
  ].filter(Boolean));
}

async function runDownloadCheck(inputUrl, sample, settings, siteProfile, deps) {
  if (typeof deps.runDownloadCheck === 'function') {
    return await deps.runDownloadCheck(inputUrl, sample, settings, siteProfile);
  }

  if (siteProfile?.downloader) {
    const downloaderInputs = [];
    if (sample?.url) {
      downloaderInputs.push(sample.url);
    }
    const authorVideosUrl = String(siteProfile?.validationSamples?.authorVideosUrl ?? '').trim();
    if (authorVideosUrl) {
      downloaderInputs.push(authorVideosUrl);
    }
    for (const extraUrl of [
      siteProfile?.validationSamples?.collectionUrl,
      siteProfile?.validationSamples?.channelUrl,
      siteProfile?.authValidationSamples?.favoriteListUrl,
      siteProfile?.authValidationSamples?.watchLaterUrl,
    ]) {
      const normalized = String(extraUrl ?? '').trim();
      if (normalized) {
        downloaderInputs.push(normalized);
      }
    }
    if (downloaderInputs.length === 0) {
      return { ok: false, error: 'No bilibili downloader validation sample was available.' };
    }

    const args = [BILIBILI_DOWNLOAD_PYTHON_ENTRY, ...downloaderInputs, '--dry-run'];
    if (settings.reuseLoginState !== undefined) {
      args.push(settings.reuseLoginState ? '--reuse-login-state' : '--no-reuse-login-state');
    }
    if (settings.browserPath) {
      args.push('--browser-path', settings.browserPath);
    }
    if (settings.browserProfileRoot) {
      args.push('--profile-root', settings.browserProfileRoot);
    } else if (settings.userDataDir) {
      args.push('--profile-root', path.dirname(settings.userDataDir));
    }
    if (settings.profilePath) {
      args.push('--profile-path', settings.profilePath);
    }
    return await new Promise((resolve) => {
      const child = spawn(settings.pythonCommand, args, {
        cwd: REPO_ROOT,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        resolve({ ok: false, error: error.message, stdout, stderr });
      });
      child.on('close', (code) => {
        let details = null;
        let warnings = [];
        try {
          const parsed = JSON.parse(stdout || '{}');
          const diagnostics = Array.isArray(parsed.resolvedItems)
            ? parsed.resolvedItems
                .map((item) => ({
                  inputKind: item?.inputKind ?? null,
                  reasonCode: item?.diagnostics?.reasonCode ?? null,
                  status: item?.diagnostics?.status ?? null,
                  antiCrawlSignals: Array.isArray(item?.diagnostics?.antiCrawlSignals) ? item.diagnostics.antiCrawlSignals : [],
                }))
                .filter((item) => item.reasonCode || item.status)
            : [];
          const inputSources = (parsed.resolvedItems || [])
            .map((item) => item.inputKind)
            .filter(Boolean)
            .map((value) => {
              if (value === 'watch-later-list') return 'watch-later';
              if (value === 'collection-list') return 'collection';
              if (value === 'channel-list') return 'channel';
              return value;
            });
          details = {
            inputSources,
            filters: parsed.filters ?? null,
            usedLoginState: parsed.usedLoginState,
            reasonCodes: uniqueSortedStrings(diagnostics.map((item) => item.reasonCode).filter(Boolean)),
            diagnostics,
            qualityWarning: parsed.qualityPolicy?.requiresLoginForHighestQuality && !parsed.usedLoginState
              ? 'highest-quality-degraded'
              : null,
          };
          warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
        } catch {}
        resolve({ ok: code === 0, code, stdout, stderr, details, warnings });
      });
    });
  }

  return await new Promise((resolve) => {
    const args = [BOOK_DOWNLOAD_PYTHON_ENTRY, inputUrl, '--book-title', sample.title];
    const child = spawn(settings.pythonCommand, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      resolve({ ok: false, error: error.message, stdout, stderr });
    });
    child.on('close', (code) => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

export async function siteDoctor(inputUrl, options = {}, deps = {}) {
  const settings = mergeOptions(inputUrl, options);
  const reportDir = path.join(settings.outDir, `${formatTimestampForDir()}_${sanitizeHost(settings.host)}`);
  settings.reportDir = reportDir;
  const reportJsonPath = path.join(reportDir, 'doctor-report.json');
  const reportMarkdownPath = path.join(reportDir, 'doctor-report.md');
  const runtime = {
    capture,
    ensureCrawlerScript,
    expandStates,
    inspectLoginState,
    ensureAuthenticatedSession,
    openBrowserSession,
    pathExists,
    readJsonFile,
    resolveSiteAuthProfile,
    resolveSiteBrowserSessionOptions,
    runAuthenticatedKeepalivePreflight: maybeRunAuthenticatedKeepalivePreflight,
    siteKeepalive,
    validateProfileFile,
    resolveSite,
    ...deps,
  };

  await ensureDir(reportDir);

  const report = {
    site: {
      url: inputUrl,
      host: settings.host,
      profilePath: settings.profilePath,
      archetype: null,
    },
    sample: null,
    profile: createCheck('profile'),
    crawler: createCheck('crawler'),
    capture: createCheck('capture'),
    expand: createCheck('expand'),
    search: createCheck('search'),
    detail: createCheck('detail'),
    author: null,
    chapter: null,
    download: null,
    adapterRecommendation: null,
    scenarios: [],
    sessionReuseWorked: null,
    authSession: null,
    riskCauseCode: null,
    riskAction: null,
    networkIdentityFingerprint: null,
    profileQuarantined: false,
    warnings: [],
    missingFields: [],
    nextActions: [],
    reports: {
      json: reportJsonPath,
      markdown: reportMarkdownPath,
    },
  };

  let validatedProfile = null;
  let resolvedSite = null;
  let siteIdentity = null;
  let sample = null;
  let authProbe = null;
  let keepalivePreflight = null;
  let scenarioSuite = null;

  try {
    if (!await runtime.pathExists(settings.profilePath)) {
      throw new Error(`Missing site profile: ${settings.profilePath}`);
    }

    validatedProfile = await runtime.validateProfileFile(settings.profilePath);
    report.site.archetype = validatedProfile.archetype ?? validatedProfile.profile?.archetype ?? null;
    report.warnings.push(...(validatedProfile.warnings ?? []));
    markPass(report.profile, {
      schemaId: validatedProfile.schemaId,
      archetype: report.site.archetype,
      warnings: validatedProfile.warnings ?? [],
    });
    sample = chooseSample(validatedProfile.profile, settings.query);
    report.sample = sample ? { ...sample } : null;
    if (!sample) {
      report.missingFields.push('profile.validationSamples.videoSearchQuery');
      report.missingFields.push('profile.search.knownQueries[0].query');
      markSkipped(report.search, 'No validationSamples.videoSearchQuery, knownQueries sample, or --query was provided.');
    }

    resolvedSite = await runtime.resolveSite({
      inputUrl,
      profile: validatedProfile.profile,
      profilePath: validatedProfile.filePath,
      workspaceRoot: REPO_ROOT,
    });
    siteIdentity = resolveCanonicalSiteIdentity({
      host: resolvedSite?.host ?? settings.host,
      inputUrl,
      siteContext: resolvedSite?.siteContext ?? null,
      profile: validatedProfile.profile,
      adapter: resolvedSite?.adapter ?? null,
    });
    report.adapterRecommendation = buildAdapterRecommendation(siteIdentity.adapterId);
    if (report.adapterRecommendation.startsWith('site-specific-adapter:')) {
      report.warnings.push(`Using existing site-specific adapter ${siteIdentity.adapterId}.`);
    }
    scenarioSuite = resolveSiteDoctorScenarioSuite({
      siteKey: siteIdentity.siteKey,
      profile: validatedProfile.profile,
      helpers: {
        buildScenarioResult,
        extractAntiCrawlSignals,
        findFirstDetailState,
        findFirstState,
        findStateByUrl,
        isAuthRequiredAuthorSubpage,
        toSemanticPageType,
      },
    });
    if (scenarioSuite) {
      try {
        keepalivePreflight = await runtime.runAuthenticatedKeepalivePreflight(inputUrl, {
          profilePath: settings.profilePath,
          browserPath: settings.browserPath,
          browserProfileRoot: settings.browserProfileRoot,
          userDataDir: settings.userDataDir,
          timeoutMs: settings.timeoutMs,
          headless: settings.headless,
          reuseLoginState: settings.reuseLoginState,
          autoLogin: settings.autoLogin,
          keepaliveOutDir: path.join(reportDir, 'keepalive-preflight'),
        }, {
          siteKeepaliveImpl: runtime.siteKeepalive,
          resolveSiteAuthProfile: runtime.resolveSiteAuthProfile,
          resolveSiteBrowserSessionOptions: runtime.resolveSiteBrowserSessionOptions,
          siteProfile: validatedProfile.profile,
        });
        if (keepalivePreflight?.ran) {
          report.warnings.push(
            `Ran ${scenarioSuite.siteLabel} keepalive preflight (${keepalivePreflight.trigger ?? keepalivePreflight.reason ?? 'keepalive'}) before doctor validation; status=${keepalivePreflight.keepaliveReport?.keepalive?.status ?? 'unknown'}.`,
          );
        }
      } catch (error) {
        keepalivePreflight = {
          attempted: true,
          ran: false,
          reason: 'preflight-failed',
          trigger: null,
          thresholdMinutes: null,
          sessionHealthSummary: null,
          sessionHealthSummaryAfter: null,
          keepaliveReport: null,
          error: error?.message ?? String(error),
        };
        report.warnings.push(`Could not run ${scenarioSuite.siteLabel} keepalive preflight: ${error.message ?? String(error)}`);
      }

      try {
        authProbe = await probeReusableLoginSession(inputUrl, settings, runtime, validatedProfile);
        report.sessionReuseWorked = authProbe.attempted ? authProbe.authAvailable : null;
        report.authSession = authProbe.attempted
          ? {
              loginStateDetected: authProbe.loginStateDetected === true,
              identityConfirmed: authProbe.identityConfirmed === true,
              identitySource: authProbe.identitySource ?? null,
              currentUrl: authProbe.currentUrl ?? null,
              title: authProbe.title ?? null,
              riskCauseCode: authProbe.riskCauseCode ?? null,
              riskAction: authProbe.riskAction ?? null,
              networkIdentityFingerprint: authProbe.networkIdentityFingerprint ?? null,
              profileQuarantined: authProbe.profileQuarantined === true,
              sessionHealthSummary: keepalivePreflight?.sessionHealthSummaryAfter ?? keepalivePreflight?.sessionHealthSummary ?? null,
              keepalivePreflight: {
                ran: keepalivePreflight?.ran === true,
                trigger: keepalivePreflight?.trigger ?? null,
                reason: keepalivePreflight?.reason ?? keepalivePreflight?.error ?? null,
                status: keepalivePreflight?.keepaliveReport?.keepalive?.status ?? null,
                thresholdMinutes: keepalivePreflight?.thresholdMinutes ?? null,
              },
            }
          : null;
        if (authProbe.attempted && !authProbe.authAvailable) {
          report.warnings.push(`No reusable logged-in ${scenarioSuite.siteLabel} session was detected; authenticated-only scenarios may be skipped.`);
        }
        if (authProbe.attempted && authProbe.profileQuarantined) {
          report.warnings.push(`Reusable ${scenarioSuite.siteLabel} profile was quarantined for fingerprint ${authProbe.networkIdentityFingerprint ?? 'unknown'}.`);
        }
      } catch (error) {
        authProbe = {
          attempted: true,
          authAvailable: false,
          loginStateDetected: false,
          identityConfirmed: false,
          identitySource: null,
          probeFailed: true,
          probeError: error?.message ?? String(error),
          networkIdentityFingerprint: null,
          riskCauseCode: null,
          riskAction: null,
          profileQuarantined: false,
        };
        report.sessionReuseWorked = false;
        report.authSession = {
          loginStateDetected: false,
          identityConfirmed: false,
          identitySource: null,
          currentUrl: null,
          title: null,
          probeFailed: true,
          probeError: error?.message ?? String(error),
          riskCauseCode: null,
          riskAction: null,
          networkIdentityFingerprint: null,
          profileQuarantined: false,
          sessionHealthSummary: keepalivePreflight?.sessionHealthSummaryAfter ?? keepalivePreflight?.sessionHealthSummary ?? null,
          keepalivePreflight: {
            ran: keepalivePreflight?.ran === true,
            trigger: keepalivePreflight?.trigger ?? null,
            reason: keepalivePreflight?.reason ?? keepalivePreflight?.error ?? null,
            status: keepalivePreflight?.keepaliveReport?.keepalive?.status ?? null,
            thresholdMinutes: keepalivePreflight?.thresholdMinutes ?? null,
          },
        };
        report.warnings.push(`Could not probe reusable ${scenarioSuite.siteLabel} login state: ${error.message ?? String(error)}`);
      }
    }
  } catch (error) {
    markFail(report.profile, error);
    if (Array.isArray(error?.errors)) {
      report.missingFields.push(...error.errors.map((entry) => entry.path));
    }
    report.nextActions = buildNextActions(report, sample);
    await writeJsonFile(reportJsonPath, report);
    await writeTextFile(reportMarkdownPath, buildReportMarkdown(report));
    return report;
  }

  try {
    const crawlerResult = await runtime.ensureCrawlerScript(inputUrl, {
      profilePath: settings.profilePath,
      crawlerScriptsDir: settings.crawlerScriptsDir,
      knowledgeBaseDir: settings.knowledgeBaseDir,
    });
    markPass(report.crawler, {
      status: crawlerResult.status,
      scriptPath: crawlerResult.scriptPath,
      metaPath: crawlerResult.metaPath,
    });
  } catch (error) {
    markFail(report.crawler, error);
  }

  let captureManifest = null;
  try {
    captureManifest = await runtime.capture(inputUrl, {
      outDir: path.join(reportDir, 'capture'),
      profilePath: settings.profilePath,
      browserPath: settings.browserPath,
      browserProfileRoot: settings.browserProfileRoot,
      userDataDir: settings.userDataDir,
      timeoutMs: settings.timeoutMs,
      headless: settings.headless,
      reuseLoginState: settings.reuseLoginState,
      autoLogin: settings.autoLogin,
    });
    if (['success', 'partial'].includes(captureManifest.status)) {
      markPass(report.capture, {
        status: captureManifest.status,
        finalUrl: captureManifest.finalUrl,
        manifestPath: captureManifest.files.manifest,
      });
      if (captureManifest.error?.message) {
        report.warnings.push(captureManifest.error.message);
      }
    } else {
      markFail(report.capture, captureManifest.error?.message ?? 'Capture failed', {
        manifestPath: captureManifest.files?.manifest ?? null,
      });
    }
  } catch (error) {
    markFail(report.capture, error);
  }

  const isChapter = report.site.archetype === PROFILE_ARCHETYPES.CHAPTER_CONTENT;
  const hasDownloader = Boolean(validatedProfile.profile?.downloader);
  report.author = isChapter ? null : createCheck('author');
  report.chapter = isChapter ? createCheck('chapter') : null;
  report.download = (isChapter || hasDownloader) ? createCheck('download') : null;

  if (captureManifest?.files?.manifest) {
    try {
      const expandManifest = await runtime.expandStates(inputUrl, {
        initialManifestPath: captureManifest.files.manifest,
        outDir: path.join(reportDir, 'expand'),
        profilePath: validatedProfile.filePath,
        browserPath: settings.browserPath,
        browserProfileRoot: settings.browserProfileRoot,
        userDataDir: settings.userDataDir,
        timeoutMs: settings.timeoutMs,
        headless: settings.headless,
        reuseLoginState: settings.reuseLoginState,
        autoLogin: settings.autoLogin,
        maxTriggers: settings.maxTriggers,
        maxCapturedStates: settings.maxCapturedStates,
        searchQueries: sample?.query ? [sample.query] : [],
      });
      const states = await collectExpandedStates(expandManifest, validatedProfile.profile, runtime);
      const budget = summarizeDoctorBudget(expandManifest, settings);
      const searchState = sample
        ? findFirstState(states, (state) => state.pageType === 'search-results-page' || state.trigger?.kind === 'search-form')
        : null;
      const detailState = findFirstDetailState(states);
      const authorState = findFirstState(states, (state) => ['author-page', 'author-list-page'].includes(String(state.pageType ?? '')));
      const chapterState = findFirstState(states, (state) => state.pageType === 'chapter-page');

      markPass(report.expand, {
        manifestPath: expandManifest.outDir ? path.join(expandManifest.outDir, 'states-manifest.json') : null,
        capturedStates: expandManifest.summary?.capturedStates ?? 0,
        discoveredTriggers: expandManifest.summary?.discoveredTriggers ?? 0,
        attemptedTriggers: expandManifest.summary?.attemptedTriggers ?? 0,
        duplicateStates: expandManifest.summary?.duplicateStates ?? 0,
        noopTriggers: expandManifest.summary?.noopTriggers ?? 0,
        failedTriggers: expandManifest.summary?.failedTriggers ?? 0,
        budget,
        warnings: expandManifest.warnings ?? [],
      });
      if (budget.hit && budget.stopReason) {
        report.warnings.push(`Doctor expansion hit its configured budget: ${budget.stopReason}`);
      }

      if (sample) {
        if (searchState) {
          markPass(report.search, {
            stateId: searchState.state_id ?? searchState.stateId ?? null,
            finalUrl: searchState.finalUrl,
            pageType: searchState.pageType,
          });
        } else {
          markFail(report.search, new Error('No search-results state was captured from the provided sample query.'));
        }
      }

      if (detailState) {
        markPass(report.detail, {
          stateId: detailState.state_id ?? detailState.stateId ?? null,
          finalUrl: detailState.finalUrl,
          pageType: detailState.pageType,
        });
      } else {
        markFail(report.detail, new Error('No content/detail page was captured during doctor expansion.'));
      }

      if (report.author) {
        if (authorState) {
          markPass(report.author, {
            stateId: authorState.state_id ?? authorState.stateId ?? null,
            finalUrl: authorState.finalUrl,
            pageType: authorState.pageType,
          });
        } else {
          markFail(report.author, new Error('No author page was captured during navigation validation.'));
        }
      }

      if (report.chapter) {
        if (chapterState) {
          markPass(report.chapter, {
            stateId: chapterState.state_id ?? chapterState.stateId ?? null,
            finalUrl: chapterState.finalUrl,
            pageType: chapterState.pageType,
          });
        } else {
          markFail(report.chapter, new Error('No chapter page was captured during chapter validation.'));
        }
      }

      if (scenarioSuite) {
        const scenarioMatrix = await validateScenarioMatrix(inputUrl, settings, runtime, validatedProfile, {
          siteIdentity,
          searchState,
          detailState,
          authorState,
        }, authProbe);
        report.scenarios = scenarioMatrix.scenarios;
        report.warnings.push(...scenarioMatrix.warnings);
        report.missingFields.push(...scenarioMatrix.missingFields);
        Object.assign(report, summarizeReportRisk(report));
      }
    } catch (error) {
      markFail(report.expand, error);
      if (report.detail.status === 'pending') {
        markSkipped(report.detail, 'Expansion failed before detail validation could run.');
      }
      if (report.author && report.author.status === 'pending') {
        markSkipped(report.author, 'Expansion failed before author validation could run.');
      }
      if (report.chapter && report.chapter.status === 'pending') {
        markSkipped(report.chapter, 'Expansion failed before chapter validation could run.');
      }
      if (report.search.status === 'pending') {
        markSkipped(report.search, 'Expansion failed before search validation could run.');
      }
      if (scenarioSuite) {
        report.scenarios = [
          buildScenarioResult(scenarioSuite.primaryScenarioId, inputUrl, 'fail', { error }),
        ];
        Object.assign(report, summarizeReportRisk(report));
      }
    }
  } else {
    markSkipped(report.expand, 'Capture did not produce a manifest for expansion.');
    if (report.detail.status === 'pending') {
      markSkipped(report.detail, 'Capture failed before detail validation could run.');
    }
    if (report.author && report.author.status === 'pending') {
      markSkipped(report.author, 'Capture failed before author validation could run.');
    }
    if (report.chapter && report.chapter.status === 'pending') {
      markSkipped(report.chapter, 'Capture failed before chapter validation could run.');
    }
    if (scenarioSuite) {
      report.scenarios = [
        buildScenarioResult(scenarioSuite.primaryScenarioId, inputUrl, 'fail', {
          error: new Error(`Capture failed before ${scenarioSuite.siteLabel} scenario validation could run.`),
        }),
      ];
      Object.assign(report, summarizeReportRisk(report));
    }
  }

  if (report.download) {
    if (!settings.checkDownload) {
      markSkipped(report.download, 'Download validation is disabled by default. Pass --check-download to enable it.');
    } else if (!isChapter && !sample?.url && !validatedProfile.profile?.downloader) {
      markSkipped(report.download, 'Sample URL is missing; provide validationSamples.videoDetailUrl before enabling bilibili download validation.');
      report.missingFields.push('profile.validationSamples.videoDetailUrl');
    } else if (isChapter && !sample?.title) {
      markSkipped(report.download, 'Sample title is missing; provide a knownQueries entry with title before enabling download validation.');
      report.missingFields.push('profile.search.knownQueries[0].title');
    } else {
      const downloadResult = await runDownloadCheck(inputUrl, sample, settings, validatedProfile.profile, runtime);
      if (downloadResult.ok) {
        const downloadDetails = {
          ...(sample?.title ? { title: sample.title } : {}),
          ...(sample?.url ? { url: sample.url } : {}),
          ...(downloadResult.details ?? {}),
        };
        markPass(report.download, {
          ...downloadDetails,
        });
        report.warnings.push(...(downloadResult.warnings ?? []));
      } else {
        markFail(report.download, new Error(downloadResult.error ?? `download validation exited with code ${downloadResult.code ?? 'unknown'}`), {
          stderr: downloadResult.stderr,
          ...(downloadResult.details ?? {}),
        });
      }
    }
  }

  report.nextActions = buildNextActions(report, sample);
  report.warnings = uniqueSortedStrings(report.warnings);
  report.missingFields = uniqueSortedStrings(report.missingFields);
  Object.assign(report, summarizeReportRisk(report));

  await writeJsonFile(reportJsonPath, report);
  await writeTextFile(reportMarkdownPath, buildReportMarkdown(report));
  return report;
}

function parseCliArgs(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    return { help: true };
  }

  const [inputUrl, ...rest] = argv;
  const options = {};
  const readValue = (index) => {
    if (index + 1 >= rest.length) {
      throw new Error(`Missing value for ${rest[index]}`);
    }
    return { value: rest[index + 1], nextIndex: index + 1 };
  };

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    switch (token) {
      case '--query': {
        const { value, nextIndex } = readValue(index);
        options.query = value;
        index = nextIndex;
        break;
      }
      case '--profile-path': {
        const { value, nextIndex } = readValue(index);
        options.profilePath = value;
        index = nextIndex;
        break;
      }
      case '--out-dir': {
        const { value, nextIndex } = readValue(index);
        options.outDir = value;
        index = nextIndex;
        break;
      }
      case '--crawler-scripts-dir': {
        const { value, nextIndex } = readValue(index);
        options.crawlerScriptsDir = value;
        index = nextIndex;
        break;
      }
      case '--knowledge-base-dir': {
        const { value, nextIndex } = readValue(index);
        options.knowledgeBaseDir = value;
        index = nextIndex;
        break;
      }
      case '--browser-path': {
        const { value, nextIndex } = readValue(index);
        options.browserPath = value;
        index = nextIndex;
        break;
      }
      case '--browser-profile-root': {
        const { value, nextIndex } = readValue(index);
        options.browserProfileRoot = value;
        index = nextIndex;
        break;
      }
      case '--user-data-dir': {
        const { value, nextIndex } = readValue(index);
        options.userDataDir = value;
        index = nextIndex;
        break;
      }
      case '--timeout': {
        const { value, nextIndex } = readValue(index);
        options.timeoutMs = value;
        index = nextIndex;
        break;
      }
      case '--max-triggers': {
        const { value, nextIndex } = readValue(index);
        options.maxTriggers = value;
        index = nextIndex;
        break;
      }
      case '--max-captured-states': {
        const { value, nextIndex } = readValue(index);
        options.maxCapturedStates = value;
        index = nextIndex;
        break;
      }
      case '--check-download':
        options.checkDownload = true;
        break;
      case '--headless':
        options.headless = true;
        break;
      case '--no-headless':
        options.headless = false;
        break;
      case '--reuse-login-state':
        options.reuseLoginState = true;
        break;
      case '--no-reuse-login-state':
        options.reuseLoginState = false;
        break;
      case '--auto-login':
        options.autoLogin = true;
        break;
      case '--no-auto-login':
        options.autoLogin = false;
        break;
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  return {
    help: false,
    inputUrl,
    options,
  };
}

async function runCli() {
  initializeCliUtf8();
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const result = await siteDoctor(parsed.inputUrl, parsed.options);
  writeJsonStdout(result);
  const failingChecks = ['profile', 'crawler', 'capture', 'expand', 'search', 'detail', 'author', 'chapter', 'download']
    .map((key) => result[key])
    .filter(Boolean)
    .filter((check) => check.status === 'fail');
  if (failingChecks.length > 0) {
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
