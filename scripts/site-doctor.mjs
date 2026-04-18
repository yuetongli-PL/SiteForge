// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { initializeCliUtf8, writeJsonStdout } from '../lib/cli.mjs';
import { openBrowserSession } from '../lib/browser-runtime/session.mjs';
import { ensureDir, pathExists, readJsonFile, writeJsonFile, writeTextFile } from '../lib/io.mjs';
import { sanitizeHost, toArray, uniqueSortedStrings } from '../lib/normalize.mjs';
import { PROFILE_ARCHETYPES } from '../lib/sites/archetypes.mjs';
import { resolveSite } from '../lib/sites/adapters/resolver.mjs';
import { resolveProfilePathForUrl } from '../lib/sites/profiles.mjs';
import { inferPageTypeFromUrl, toSemanticPageType } from '../lib/sites/page-types.mjs';
import { validateProfileFile } from '../lib/profile-validation.mjs';
import { inspectLoginState, resolveSiteAuthProfile, resolveSiteBrowserSessionOptions } from '../lib/site-auth.mjs';
import { diagnoseBilibiliSurfaceState } from '../lib/bilibili-diagnosis.mjs';
import { ensureCrawlerScript } from '../generate-crawler-script.mjs';
import { capture } from '../capture.mjs';
import { derivePageFacts, expandStates } from '../expand-states.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');
const DEFAULT_OPTIONS = {
  outDir: path.join(REPO_ROOT, 'archive', 'site-doctor'),
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
  node scripts/site-doctor.mjs <url> [--query "<sample>"] [--profile-path <path>] [--out-dir <dir>] [--crawler-scripts-dir <dir>] [--knowledge-base-dir <dir>] [--browser-path <path>] [--browser-profile-root <dir>] [--user-data-dir <dir>] [--timeout <ms>] [--headless|--no-headless] [--reuse-login-state|--no-reuse-login-state] [--auto-login|--no-auto-login] [--max-triggers <n>] [--max-captured-states <n>] [--check-download]
`;

const AUTH_PROBE_WAIT_POLICY = {
  useLoadEvent: false,
  useNetworkIdle: false,
  documentReadyTimeoutMs: 8_000,
  domQuietTimeoutMs: 8_000,
  domQuietMs: 400,
  idleMs: 250,
};

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
  merged.headless = normalizeBoolean(merged.headless, 'headless');
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

function isBilibiliProfile(profile = null) {
  return String(profile?.host ?? '').toLowerCase() === 'www.bilibili.com';
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
    note: details.note ?? null,
    error: details.error ? { message: details.error.message ?? String(details.error) } : null,
    diagnosis: details.diagnosis ?? null,
  };
}

function extractAntiCrawlSignals(state = null) {
  return uniqueSortedStrings(toArray(state?.pageFacts?.antiCrawlSignals).filter(Boolean));
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
      if (report.authSession.probeFailed) {
        lines.push('- Probe failed: yes');
        lines.push(`- Probe error: ${report.authSession.probeError ?? 'unknown'}`);
      }
    }
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
      lines.push(`- ${scenario.id}: ${scenario.status}${scenario.finalUrl ? ` -> ${scenario.finalUrl}` : ''}${observed ? ` [${observed}]` : ''}${reason}${antiCrawl}${scenario.note ? ` (${scenario.note})` : ''}${scenario.error?.message ? ` (${scenario.error.message})` : ''}`);
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
  };
}

async function runCaptureExpandScenario(startUrl, scenarioId, settings, runtime, validatedProfile, searchQueries = []) {
  const scenarioDir = path.join(settings.reportDir, 'scenarios', scenarioId);
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
  if (!captureManifest?.files?.manifest) {
    throw new Error(`Scenario ${scenarioId} did not produce an initial capture manifest.`);
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
    maxTriggers: settings.maxTriggers,
    maxCapturedStates: settings.maxCapturedStates,
    searchQueries,
  });
  const states = await collectExpandedStates(expandManifest, validatedProfile.profile, runtime);
  return { captureManifest, expandManifest, states };
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
    autoLogin: false,
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
    };
  }

  const session = await runtime.openBrowserSession({
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
    startupUrl: authContext.authConfig.postLoginUrl || inputUrl,
  }, {
    userDataDirPrefix: 'site-doctor-auth-probe-',
  });

  try {
    const probeUrl = authContext.authConfig.postLoginUrl || inputUrl;
    await session.navigateAndWait(probeUrl, AUTH_PROBE_WAIT_POLICY);
    const loginState = await runtime.inspectLoginState(session, authContext.authConfig);
    return {
      attempted: true,
      authAvailable: loginState?.identityConfirmed === true,
      loginStateDetected: loginState?.loginStateDetected === true || loginState?.loggedIn === true,
      identityConfirmed: loginState?.identityConfirmed === true,
      identitySource: loginState?.identitySource ?? null,
      currentUrl: loginState?.currentUrl ?? null,
      title: loginState?.title ?? null,
    };
  } finally {
    await session.close();
  }
}

async function validateBilibiliScenarioMatrix(report, inputUrl, settings, runtime, validatedProfile, primaryContext, authProbe = null) {
  const samples = validatedProfile.profile?.validationSamples ?? {};
  const authSamples = validatedProfile.profile?.authValidationSamples ?? {};
  const profile = validatedProfile.profile ?? null;
  const scenarios = [];
  const scenarioWarnings = [];
  const missingScenarioFields = [];

  const primaryScenarioError = primaryContext?.error
    ? primaryContext.error
    : !primaryContext?.searchState
      ? new Error('Primary bilibili scenario did not capture any search-results state.')
      : !primaryContext?.detailState
        ? new Error('Primary bilibili scenario reached search but did not capture a content detail state.')
        : !primaryContext?.authorState
          ? new Error('Primary bilibili scenario reached content detail but did not capture an author page.')
          : null;
  const primaryObserved = primaryContext?.authorState ?? primaryContext?.detailState ?? primaryContext?.searchState ?? null;
  scenarios.push(buildScenarioResult(
    'home-search-video-detail-author',
    inputUrl,
    primaryScenarioError ? 'fail' : 'pass',
    {
      stateId: primaryObserved?.state_id ?? primaryObserved?.stateId ?? null,
      finalUrl: primaryObserved?.finalUrl ?? null,
      pageType: primaryObserved?.pageType ?? null,
      semanticPageType: primaryObserved?.semanticPageType ?? (primaryObserved?.pageType ? toSemanticPageType(primaryObserved.pageType) : null),
      expectedSemanticPageType: 'author-page',
      authRequired: false,
      antiCrawlSignals: extractAntiCrawlSignals(primaryObserved),
      note: 'Expected chain: home -> search-results -> content-detail -> author-page.',
      error: primaryScenarioError,
    },
  ));

  const scenarioDefinitions = [
    {
      id: 'category-popular-to-detail',
      sampleField: 'categoryPopularUrl',
      sampleContainer: 'validationSamples',
      searchQueries: [],
      authRequired: false,
      expectedSemanticPageType: 'content-detail-page',
      resolveResult(states) {
        return findFirstDetailState(states);
      },
    },
    {
      id: 'bangumi-detail',
      sampleField: 'bangumiDetailUrl',
      sampleContainer: 'validationSamples',
      searchQueries: [],
      authRequired: false,
      expectedSemanticPageType: 'content-detail-page',
      resolveResult(states) {
        return findFirstState(states, (state) => {
          const url = String(state.finalUrl ?? '');
          return url.includes('/bangumi/play/') || String(state.pageFacts?.contentType ?? '') === 'bangumi';
        });
      },
    },
    {
      id: 'author-videos-to-detail',
      sampleField: 'authorVideosUrl',
      sampleContainer: 'validationSamples',
      searchQueries: [],
      authRequired: false,
      expectedSemanticPageType: 'content-detail-page',
      resolveResult(states) {
        return findFirstDetailState(states);
      },
    },
    {
      id: 'author-dynamic-feed',
      sampleField: 'dynamicUrl',
      fallbackSampleField: 'authorDynamicUrl',
      sampleContainer: 'authValidationSamples',
      searchQueries: [],
      authRequired: isAuthRequiredAuthorSubpage(profile, 'dynamic'),
      expectedSemanticPageType: 'author-list-page',
      resolveResult(states) {
        return findFirstState(states, (state) => (
          String(state.pageType ?? '') === 'author-list-page'
          && String(state.pageFacts?.authorSubpage ?? '') === 'dynamic'
        ));
      },
    },
    {
      id: 'author-follow-list',
      sampleField: 'followListUrl',
      sampleContainer: 'authValidationSamples',
      searchQueries: [],
      authRequired: isAuthRequiredAuthorSubpage(profile, 'fans/follow'),
      expectedSemanticPageType: 'author-list-page',
      resolveResult(states) {
        return findFirstState(states, (state) => (
          String(state.pageType ?? '') === 'author-list-page'
          && String(state.pageFacts?.authorSubpage ?? '') === 'follow'
        ));
      },
    },
    {
      id: 'author-fans-list',
      sampleField: 'fansListUrl',
      sampleContainer: 'authValidationSamples',
      searchQueries: [],
      authRequired: isAuthRequiredAuthorSubpage(profile, 'fans/fans'),
      expectedSemanticPageType: 'author-list-page',
      resolveResult(states) {
        return findFirstState(states, (state) => (
          String(state.pageType ?? '') === 'author-list-page'
          && String(state.pageFacts?.authorSubpage ?? '') === 'fans'
        ));
      },
    },
  ];

  for (const definition of scenarioDefinitions) {
    const sampleBag = definition.sampleContainer === 'authValidationSamples' ? authSamples : samples;
    const startUrl = String(
      sampleBag?.[definition.sampleField]
      ?? (definition.fallbackSampleField ? samples?.[definition.fallbackSampleField] : '')
      ?? '',
    ).trim();
    if (!startUrl) {
      scenarios.push(buildScenarioResult(definition.id, null, 'skipped', {
        expectedSemanticPageType: definition.expectedSemanticPageType,
        authRequired: definition.authRequired,
        note: `Expected to validate ${definition.expectedSemanticPageType}.`,
        error: new Error(`Missing profile.${definition.sampleContainer}.${definition.sampleField}${definition.fallbackSampleField ? ` or profile.validationSamples.${definition.fallbackSampleField}` : ''}`),
      }));
      missingScenarioFields.push(`profile.${definition.sampleContainer}.${definition.sampleField}`);
      scenarioWarnings.push(`Skipped bilibili scenario ${definition.id} because profile.${definition.sampleContainer}.${definition.sampleField} is missing.`);
      continue;
    }

    if (definition.authRequired && authProbe?.attempted && authProbe.authAvailable !== true) {
      scenarios.push(buildScenarioResult(definition.id, startUrl, 'skipped', {
        expectedSemanticPageType: definition.expectedSemanticPageType,
        authRequired: true,
        reasonCode: 'not-logged-in',
        note: `Expected to validate ${definition.expectedSemanticPageType}.`,
        error: new Error('Reusable bilibili login state is unavailable for this authenticated scenario.'),
      }));
      scenarioWarnings.push(`Skipped bilibili scenario ${definition.id} because no reusable logged-in bilibili session was detected.`);
      continue;
    }

    try {
      const { states } = await runCaptureExpandScenario(startUrl, definition.id, settings, runtime, validatedProfile, definition.searchQueries);
      const matchedState = definition.resolveResult(states);
      if (!matchedState) {
        scenarios.push(buildScenarioResult(definition.id, startUrl, 'fail', {
          expectedSemanticPageType: definition.expectedSemanticPageType,
          authRequired: definition.authRequired,
          reasonCode: 'matching-state-missing',
          note: `Expected to validate ${definition.expectedSemanticPageType}.`,
          error: new Error(`Scenario ${definition.id} did not capture any matching state.`),
        }));
        continue;
      }
      const diagnosis = diagnoseBilibiliSurfaceState(matchedState, {
        authRequired: definition.authRequired,
        authAvailable: authProbe?.authAvailable,
      });
      const antiCrawlSignals = diagnosis.antiCrawlSignals ?? extractAntiCrawlSignals(matchedState);
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
        note: `Expected to validate ${definition.expectedSemanticPageType}.`,
        diagnosis: summarizeScenarioDiagnosis(diagnosis),
      }));
      if (diagnosis.reasonCode !== 'ok') {
        scenarioWarnings.push(`bilibili scenario ${definition.id} diagnosed as ${diagnosis.reasonCode}.`);
      }
      if (antiCrawlSignals.length > 0) {
        scenarioWarnings.push(`bilibili scenario ${definition.id} observed anti-crawl signals: ${antiCrawlSignals.join(', ') || 'unknown'}.`);
      }
    } catch (error) {
      scenarios.push(buildScenarioResult(definition.id, startUrl, 'fail', {
        expectedSemanticPageType: definition.expectedSemanticPageType,
        authRequired: definition.authRequired,
        reasonCode: 'upstream-error',
        note: `Expected to validate ${definition.expectedSemanticPageType}.`,
        error,
      }));
      scenarioWarnings.push(`bilibili scenario ${definition.id} failed: ${error.message ?? String(error)}`);
    }
  }

  return {
    scenarios,
    warnings: scenarioWarnings,
    missingFields: missingScenarioFields,
  };
}

function buildAdapterRecommendation(resolvedSite) {
  const adapterId = resolvedSite?.adapter?.id ?? null;
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

    const args = [path.join(REPO_ROOT, 'download_bilibili.py'), ...downloaderInputs, '--dry-run'];
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
    const args = [path.join(REPO_ROOT, 'download_book.py'), inputUrl, '--book-title', sample.title];
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
    openBrowserSession,
    pathExists,
    readJsonFile,
    resolveSiteAuthProfile,
    resolveSiteBrowserSessionOptions,
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
  let sample = null;
  let authProbe = null;

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
    report.adapterRecommendation = buildAdapterRecommendation(resolvedSite);
    if (report.adapterRecommendation.startsWith('site-specific-adapter:')) {
      report.warnings.push(`Using existing site-specific adapter ${resolvedSite.adapter.id}.`);
    }
    if (isBilibiliProfile(validatedProfile.profile)) {
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
            }
          : null;
        if (authProbe.attempted && !authProbe.authAvailable) {
          report.warnings.push('No reusable logged-in bilibili session was detected; authenticated-only scenarios may be skipped.');
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
        };
        report.warnings.push(`Could not probe reusable bilibili login state: ${error.message ?? String(error)}`);
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

      if (isBilibiliProfile(validatedProfile.profile)) {
        const scenarioMatrix = await validateBilibiliScenarioMatrix(report, inputUrl, settings, runtime, validatedProfile, {
          searchState,
          detailState,
          authorState,
        }, authProbe);
        report.scenarios = scenarioMatrix.scenarios;
        report.warnings.push(...scenarioMatrix.warnings);
        report.missingFields.push(...scenarioMatrix.missingFields);
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
      if (isBilibiliProfile(validatedProfile.profile)) {
        report.scenarios = [
          buildScenarioResult('home-search-video-detail-author', inputUrl, 'fail', { error }),
        ];
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
    if (isBilibiliProfile(validatedProfile.profile)) {
      report.scenarios = [
        buildScenarioResult('home-search-video-detail-author', inputUrl, 'fail', {
          error: new Error('Capture failed before bilibili scenario validation could run.'),
        }),
      ];
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
