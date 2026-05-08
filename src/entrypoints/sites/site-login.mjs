// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { initializeCliUtf8, writeJsonStdout } from '../../infra/cli.mjs';
import {
  parseProgressCliOption,
  runSingleStageCliWithProgress,
} from '../../infra/cli/progress-cli.mjs';
import { ensureDir, writeTextFile } from '../../infra/io.mjs';
import { sanitizeHost } from '../../shared/normalize.mjs';
import { openBrowserSession } from '../../infra/browser/session.mjs';
import { inspectPersistentProfileHealth } from '../../infra/browser/profile-store.mjs';
import {
  DEFAULT_LOGIN_WAIT_TIMEOUT_MS,
  ensureAuthenticatedSession,
  inspectLoginState,
  resolveAuthKeepaliveUrl,
  resolveAuthVerificationUrl,
  resolveSiteAuthProfile,
  resolveSiteBrowserSessionOptions,
  waitForAuthenticatedSession,
} from '../../infra/auth/site-auth.mjs';
import {
  finalizeSiteSessionGovernance,
  prepareSiteSessionGovernance,
  releaseSessionLease,
} from '../../infra/auth/site-session-governance.mjs';
import { resolveProfilePathForUrl } from '../../sites/core/profiles.mjs';
import {
  REDACTION_PLACEHOLDER,
  SECURITY_GUARD_SCHEMA_VERSION,
  assertNoForbiddenPatterns,
  prepareRedactedArtifactJson,
  prepareRedactedArtifactJsonWithAudit,
  redactValue,
} from '../../sites/capability/security-guard.mjs';
import { reasonCodeSummary } from '../../sites/capability/reason-codes.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..');

const SITE_LOGIN_REPORT_PROFILE_KEYS = Object.freeze(new Set([
  'profilePath',
  'browserProfileRoot',
  'userDataDir',
  'networkIdentityFingerprint',
  'sessionLeaseId',
  'fingerprint',
]));

const DEFAULT_OPTIONS = {
  outDir: path.join(REPO_ROOT, 'runs', 'sites', 'site-login'),
  profilePath: null,
  browserPath: undefined,
  browserProfileRoot: undefined,
  userDataDir: undefined,
  timeoutMs: 30_000,
  manualLoginTimeoutMs: DEFAULT_LOGIN_WAIT_TIMEOUT_MS,
  headless: false,
  reuseLoginState: true,
  autoLogin: true,
  waitForManualLogin: true,
  runtimePurpose: 'login',
  verificationUrl: undefined,
  keepaliveUrl: undefined,
  loginUsername: undefined,
  loginPassword: undefined,
};

const HELP = `Usage:
  node src/entrypoints/sites/site-login.mjs <url> [--profile-path <path>] [--browser-path <path>] [--browser-profile-root <dir>] [--user-data-dir <dir>] [--timeout <ms>] [--manual-timeout <ms>] [--headless|--no-headless] [--auto-login|--no-auto-login] [--reuse-login-state|--no-reuse-login-state] [--wait-for-manual-login|--no-wait-for-manual-login] [--username <value>] [--password <value>] [--json] [--quiet] [--progress auto|interactive|plain]

Notes:
  - Explicit --username / --password overrides WinCred and environment variables.
  - On Windows, this command also reads credentials from Windows Credential Manager when a site profile defines or derives a credential target.
  - This command reuses a persistent Chromium profile so later capture/expand/pipeline runs can reuse the same login state.
`;

function createWaitPolicy(timeoutMs) {
  return {
    useLoadEvent: false,
    useNetworkIdle: false,
    documentReadyTimeoutMs: timeoutMs,
    domQuietTimeoutMs: timeoutMs,
    domQuietMs: 400,
    idleMs: 250,
  };
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
  merged.outDir = path.resolve(merged.outDir);
  merged.profilePath = merged.profilePath
    ? path.resolve(merged.profilePath)
    : resolveProfilePathForUrl(inputUrl, { profilesDir: path.join(REPO_ROOT, 'profiles') });
  merged.browserProfileRoot = merged.browserProfileRoot ? path.resolve(merged.browserProfileRoot) : undefined;
  merged.userDataDir = merged.userDataDir ? path.resolve(merged.userDataDir) : undefined;
  merged.timeoutMs = normalizeNumber(merged.timeoutMs, 'timeoutMs');
  merged.manualLoginTimeoutMs = normalizeNumber(merged.manualLoginTimeoutMs, 'manualLoginTimeoutMs');
  merged.headless = normalizeBoolean(merged.headless, 'headless');
  merged.reuseLoginState = normalizeBoolean(merged.reuseLoginState, 'reuseLoginState');
  merged.autoLogin = normalizeBoolean(merged.autoLogin, 'autoLogin');
  merged.waitForManualLogin = normalizeBoolean(merged.waitForManualLogin, 'waitForManualLogin');
  merged.runtimePurpose = String(merged.runtimePurpose ?? 'login').trim() || 'login';
  if (!['login', 'keepalive'].includes(merged.runtimePurpose)) {
    throw new Error(`Invalid runtimePurpose: ${merged.runtimePurpose}`);
  }
  merged.verificationUrl = merged.verificationUrl ? String(merged.verificationUrl).trim() : undefined;
  merged.keepaliveUrl = merged.keepaliveUrl ? String(merged.keepaliveUrl).trim() : undefined;
  merged.loginUsername = merged.loginUsername ? String(merged.loginUsername).trim() : undefined;
  merged.loginPassword = merged.loginPassword ? String(merged.loginPassword).trim() : undefined;
  return merged;
}

function buildReportMarkdown(report) {
  const lines = [
    '# Site Login',
    '',
    `- URL: ${report.site.url}`,
    `- Host: ${report.site.host}`,
    `- Profile path: ${report.site.profilePath}`,
    `- User data dir: ${report.site.userDataDir ?? 'none'}`,
    `- Login URL: ${report.site.loginUrl ?? 'none'}`,
    `- Post-login URL: ${report.site.postLoginUrl ?? 'none'}`,
    `- Browser start URL: ${report.site.browserStartUrl ?? 'none'}`,
    `- Browser attached via: ${report.site.browserAttachedVia ?? 'unknown'}`,
    `- Reused browser instance: ${report.site.reusedBrowserInstance ? 'yes' : 'no'}`,
    `- Runtime purpose: ${report.site.runtimePurpose ?? 'login'}`,
    `- Session lease ID: ${report.site.sessionLeaseId ?? 'none'}`,
    '',
    '## Auth',
    '',
    `- Status: ${report.auth.status}`,
    `- Credential source: ${report.auth.credentialsSource ?? 'none'}`,
    `- Auto login: ${report.auth.autoLogin ? 'yes' : 'no'}`,
    `- Waited for manual login: ${report.auth.waitedForManualLogin ? 'yes' : 'no'}`,
    `- Login state detected: ${report.auth.loginStateDetected ? 'yes' : 'no'}`,
    `- Identity confirmed: ${report.auth.identityConfirmed ? 'yes' : 'no'}`,
    `- Identity source: ${report.auth.identitySource ?? 'none'}`,
    `- Persistence verified: ${report.auth.persistenceVerified === null ? 'n/a' : report.auth.persistenceVerified ? 'yes' : 'no'}`,
    `- Reopen verification passed: ${report.auth.reopenVerificationPassed ? 'yes' : 'no'}`,
    `- Shutdown mode: ${report.auth.shutdownMode ?? 'unknown'}`,
    `- Challenge required: ${report.auth.challengeRequired ? 'yes' : 'no'}`,
    `- Current URL: ${report.auth.currentUrl ?? 'unknown'}`,
    `- Runtime URL: ${report.auth.runtimeUrl ?? 'unknown'}`,
    `- Warm-up attempted: ${report.auth.warmupSummary?.attempted ? 'yes' : 'no'}`,
    `- Warm-up completed: ${report.auth.warmupSummary?.attempted ? (report.auth.warmupSummary?.completed ? 'yes' : 'no') : 'n/a'}`,
    `- Warm-up URLs: ${Array.isArray(report.auth.warmupSummary?.urls) && report.auth.warmupSummary.urls.length ? report.auth.warmupSummary.urls.join(', ') : 'none'}`,
    `- Keepalive URL: ${report.auth.keepaliveUrl ?? 'unknown'}`,
    `- Verification URL: ${report.auth.verificationUrl ?? 'unknown'}`,
    `- Keepalive interval (minutes): ${report.auth.keepaliveIntervalMinutes ?? 'unknown'}`,
    `- Cooldown after risk (minutes): ${report.auth.cooldownMinutesAfterRisk ?? 'unknown'}`,
    `- Prefer visible browser: ${report.auth.preferVisibleBrowserForAuthenticatedFlows ? 'yes' : 'no'}`,
    `- Require stable network: ${report.auth.requireStableNetworkForAuthenticatedFlows ? 'yes' : 'no'}`,
    `- Risk cause code: ${report.auth.riskCauseCode ?? 'none'}`,
    `- Risk action: ${report.auth.riskAction ?? 'none'}`,
    `- Network identity fingerprint: ${report.auth.networkIdentityFingerprint?.fingerprint ?? 'none'}`,
    `- Profile quarantined: ${report.auth.profileQuarantined ? 'yes' : 'no'}`,
    `- Title: ${report.auth.title ?? 'unknown'}`,
    `- Manual timeout: ${report.auth.manualLoginTimeoutMs}`,
    '',
    '## Session Health',
    '',
    `- Last healthy at: ${report.auth.sessionHealthSummary?.lastHealthyAt ?? 'none'}`,
    `- Last keepalive at: ${report.auth.sessionHealthSummary?.lastKeepaliveAt ?? 'none'}`,
    `- Last login at: ${report.auth.sessionHealthSummary?.lastLoginAt ?? 'none'}`,
    `- Next suggested keepalive at: ${report.auth.sessionHealthSummary?.nextSuggestedKeepaliveAt ?? 'none'}`,
    `- Keepalive due: ${report.auth.sessionHealthSummary?.keepaliveDue ? 'yes' : 'no'}`,
    `- Minutes until suggested keepalive: ${report.auth.sessionHealthSummary?.minutesUntilSuggestedKeepalive ?? 'unknown'}`,
    `- Successful keepalives: ${report.auth.sessionHealthSummary?.successfulKeepalives ?? 0}`,
    `- Successful logins: ${report.auth.sessionHealthSummary?.successfulLogins ?? 0}`,
    `- Session reuse verifications: ${report.auth.sessionHealthSummary?.sessionReuseVerifications ?? 0}`,
    `- Failed keepalives: ${report.auth.sessionHealthSummary?.failedKeepalives ?? 0}`,
    '',
    '## Warnings',
    '',
    ...(report.warnings.length > 0 ? report.warnings.map((warning) => `- ${warning}`) : ['- none']),
  ];
  return lines.join('\n');
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function auditPath(pathParts) {
  return pathParts.join('.');
}

function redactSiteLoginProfileRefs(value, pathParts = [], audit = {
  schemaVersion: SECURITY_GUARD_SCHEMA_VERSION,
  redactedPaths: [],
  findings: [],
}) {
  if (Array.isArray(value)) {
    return {
      value: value.map((item, index) => redactSiteLoginProfileRefs(item, [...pathParts, String(index)], audit).value),
      audit,
    };
  }
  if (!isPlainObject(value)) {
    return { value, audit };
  }
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathParts, key];
    if (SITE_LOGIN_REPORT_PROFILE_KEYS.has(key)) {
      output[key] = REDACTION_PLACEHOLDER;
      audit.redactedPaths.push(auditPath(childPath));
      continue;
    }
    output[key] = redactSiteLoginProfileRefs(child, childPath, audit).value;
  }
  return { value: output, audit };
}

function mergeRedactionAudits(...audits) {
  const redactedPaths = [];
  const findings = [];
  for (const audit of audits) {
    if (!audit || typeof audit !== 'object') {
      continue;
    }
    redactedPaths.push(...(Array.isArray(audit.redactedPaths) ? audit.redactedPaths : []));
    findings.push(...(Array.isArray(audit.findings) ? audit.findings : []));
  }
  return {
    schemaVersion: SECURITY_GUARD_SCHEMA_VERSION,
    redactedPaths: [...new Set(redactedPaths)],
    findings,
  };
}

function createSiteLoginReportRedactionFailure(error) {
  const recovery = reasonCodeSummary('redaction-failed');
  const causeSummary = redactValue({
    name: error instanceof Error ? error.name : undefined,
    code: error && typeof error === 'object' ? error.code : undefined,
  }).value;
  const failure = new Error('Redaction failed for site-login report; persistent report write blocked');
  failure.name = 'SiteLoginReportRedactionFailure';
  failure.code = 'redaction-failed';
  failure.reasonCode = 'redaction-failed';
  failure.retryable = recovery.retryable;
  failure.cooldownNeeded = recovery.cooldownNeeded;
  failure.isolationNeeded = recovery.isolationNeeded;
  failure.manualRecoveryNeeded = recovery.manualRecoveryNeeded;
  failure.degradable = recovery.degradable;
  failure.artifactWriteAllowed = recovery.artifactWriteAllowed;
  failure.catalogAction = recovery.catalogAction;
  failure.causeSummary = causeSummary;
  return failure;
}

export function prepareSiteLoginReportArtifacts(report) {
  try {
    const profileRedacted = redactSiteLoginProfileRefs(report);
    const preparedJson = prepareRedactedArtifactJsonWithAudit(profileRedacted.value);
    const markdown = buildReportMarkdown(preparedJson.value);
    const redactedMarkdown = redactValue(String(markdown ?? ''));
    const markdownText = String(redactedMarkdown.value ?? '');
    assertNoForbiddenPatterns(markdownText);
    const jsonAudit = mergeRedactionAudits(profileRedacted.audit, preparedJson.auditValue);
    const markdownAudit = mergeRedactionAudits(profileRedacted.audit, redactedMarkdown.audit);
    return {
      json: preparedJson.json,
      jsonAudit: prepareRedactedArtifactJson(jsonAudit).json,
      markdown: markdownText,
      markdownAudit: prepareRedactedArtifactJson(markdownAudit).json,
      value: preparedJson.value,
    };
  } catch (error) {
    throw createSiteLoginReportRedactionFailure(error);
  }
}

export async function writeSiteLoginReportArtifacts(report, {
  reportDir,
  jsonPath,
  jsonAuditPath,
  markdownPath,
  markdownAuditPath,
}) {
  const prepared = prepareSiteLoginReportArtifacts(report);
  await ensureDir(reportDir);
  await writeTextFile(jsonPath, prepared.json);
  await writeTextFile(jsonAuditPath, prepared.jsonAudit);
  await writeTextFile(markdownPath, prepared.markdown);
  await writeTextFile(markdownAuditPath, prepared.markdownAudit);
  return prepared.value;
}

function uniqueUrls(values = []) {
  const deduped = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}

function resolveRuntimeNavigationPlan(inputUrl, settings, authProfile, authContext) {
  const authConfig = authContext?.authConfig;
  if (!authConfig) {
    return {
      browserStartUrl: inputUrl,
      runtimeUrl: inputUrl,
      verificationUrl: null,
      keepaliveUrl: null,
      warmupUrls: [],
    };
  }

  const verificationUrl = settings.verificationUrl
    || resolveAuthVerificationUrl(inputUrl, authProfile, {
      ...authConfig,
      verificationUrl: settings.verificationUrl ?? authConfig.verificationUrl ?? null,
    });
  const keepaliveUrl = settings.keepaliveUrl
    || resolveAuthKeepaliveUrl(inputUrl, authProfile, {
      ...authConfig,
      keepaliveUrl: settings.keepaliveUrl ?? authConfig.keepaliveUrl ?? null,
      verificationUrl: settings.verificationUrl ?? authConfig.verificationUrl ?? null,
    });

  const wantsInteractiveLogin = !settings.headless && settings.waitForManualLogin;
  if (wantsInteractiveLogin) {
    return {
      browserStartUrl: authConfig.loginUrl || inputUrl,
      runtimeUrl: authConfig.loginUrl || inputUrl,
      verificationUrl,
      keepaliveUrl,
      warmupUrls: [],
    };
  }

  if (settings.runtimePurpose === 'keepalive') {
    const warmupStartUrl = authConfig.postLoginUrl || inputUrl;
    const warmupUrls = uniqueUrls([warmupStartUrl, keepaliveUrl]);
    return {
      browserStartUrl: warmupUrls[0] ?? keepaliveUrl ?? inputUrl,
      runtimeUrl: keepaliveUrl ?? verificationUrl ?? inputUrl,
      verificationUrl: keepaliveUrl ?? verificationUrl,
      keepaliveUrl: keepaliveUrl ?? verificationUrl,
      warmupUrls,
    };
  }

  return {
    browserStartUrl: verificationUrl ?? inputUrl,
    runtimeUrl: verificationUrl ?? inputUrl,
    verificationUrl,
    keepaliveUrl,
    warmupUrls: [],
  };
}

async function performRuntimeWarmup(session, navigationPlan, settings) {
  const urls = uniqueUrls(navigationPlan?.warmupUrls ?? []);
  if (settings.runtimePurpose !== 'keepalive' || !urls.length) {
    return {
      attempted: false,
      completed: false,
      urls: [],
      steps: [],
      warning: null,
    };
  }

  const waitPolicy = createWaitPolicy(Math.min(settings.timeoutMs, 12_000));
  const steps = [];
  let completed = true;
  let previousUrl = String(session?.browserStartUrl ?? '').trim() || null;

  for (const [index, url] of urls.entries()) {
    if (index === 0 && previousUrl && previousUrl === url) {
      steps.push({
        url,
        status: 'startup',
      });
      continue;
    }
    try {
      await session.navigateAndWait(url, waitPolicy);
      steps.push({
        url,
        status: 'navigated',
      });
      previousUrl = url;
    } catch (error) {
      completed = false;
      steps.push({
        url,
        status: 'failed',
        error: error?.message ?? String(error),
      });
      break;
    }
  }

  const failedStep = steps.find((step) => step.status === 'failed');
  return {
    attempted: true,
    completed,
    urls,
    steps,
    warning: failedStep ? `Warm-up failed before keepalive verification at ${failedStep.url}: ${failedStep.error}` : null,
  };
}

function shouldSuppressHistoricalProfileWarning(warning, reopenVerification, primaryCloseSummary) {
  if (!warning || !/Persistent browser profile last exit type was /u.test(String(warning))) {
    return false;
  }
  return reopenVerification?.attempted === true
    && reopenVerification?.passed === true
    && primaryCloseSummary?.shutdownMode === 'graceful';
}

async function verifyPersistentLoginReuse(inputUrl, settings, authContext, runtime, authProfile, navigationPlan) {
  if (!authContext.userDataDir || !authContext.reuseLoginState) {
    return {
      attempted: false,
      passed: false,
      loginState: null,
      verificationUrl: null,
      warmupSummary: {
        attempted: false,
        completed: false,
        urls: [],
        steps: [],
        warning: null,
      },
    };
  }

  const verificationUrl = navigationPlan?.verificationUrl ?? navigationPlan?.runtimeUrl ?? inputUrl;
  const reopenSession = await runtime.openBrowserSession({
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
    startupUrl: navigationPlan?.browserStartUrl ?? verificationUrl,
  }, {
    userDataDirPrefix: 'site-login-browser-',
  });

  let closeSummary = null;
  try {
    const warmupSummary = await performRuntimeWarmup(reopenSession, navigationPlan, settings);
    if (verificationUrl) {
      await reopenSession.navigateAndWait(verificationUrl, createWaitPolicy(settings.timeoutMs));
    }
    const shouldEnsureAuth = Boolean(authContext.authConfig)
      && (settings.autoLogin === true || authContext.authConfig.autoLoginByDefault === true);
    const ensuredAuth = shouldEnsureAuth
      ? await runtime.ensureAuthenticatedSession(reopenSession, inputUrl, settings, { authContext })
      : null;
    const retryLoginState = ensuredAuth?.loginState
      ? null
      : await inspectConfirmedLoginStateWithRetry(runtime, reopenSession, authContext.authConfig, {
        timeoutMs: Math.min(20_000, settings.timeoutMs),
        pollMs: 800,
      });
    const loginState = ensuredAuth?.loginState
      ?? retryLoginState
      ?? await runtime.inspectLoginState(reopenSession, authContext.authConfig);
    closeSummary = await reopenSession.close();
    return {
      attempted: true,
      passed: loginState?.identityConfirmed === true,
      loginState,
      verificationUrl,
      closeSummary,
      warmupSummary,
    };
  } finally {
    if (!closeSummary) {
      await reopenSession.close();
    }
  }
}

async function inspectConfirmedLoginStateWithRetry(runtime, session, authConfig, {
  timeoutMs = 20_000,
  pollMs = 800,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      lastState = await runtime.inspectLoginState(session, authConfig);
      lastError = null;
      if (lastState?.identityConfirmed === true) {
        return lastState;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  if (lastState) {
    return lastState;
  }
  if (lastError) {
    throw lastError;
  }
  return await runtime.inspectLoginState(session, authConfig);
}

export function parseCliArgs(argv) {
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
    const progressOption = parseProgressCliOption(rest, token, index, options);
    if (progressOption.handled) {
      index = progressOption.nextIndex;
      continue;
    }
    switch (token) {
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
      case '--manual-timeout': {
        const { value, nextIndex } = readValue(index);
        options.manualLoginTimeoutMs = value;
        index = nextIndex;
        break;
      }
      case '--username': {
        const { value, nextIndex } = readValue(index);
        options.loginUsername = value;
        index = nextIndex;
        break;
      }
      case '--password': {
        const { value, nextIndex } = readValue(index);
        options.loginPassword = value;
        index = nextIndex;
        break;
      }
      case '--headless':
        options.headless = true;
        break;
      case '--no-headless':
        options.headless = false;
        break;
      case '--auto-login':
        options.autoLogin = true;
        break;
      case '--no-auto-login':
        options.autoLogin = false;
        break;
      case '--reuse-login-state':
        options.reuseLoginState = true;
        break;
      case '--no-reuse-login-state':
        options.reuseLoginState = false;
        break;
      case '--wait-for-manual-login':
        options.waitForManualLogin = true;
        break;
      case '--no-wait-for-manual-login':
        options.waitForManualLogin = false;
        break;
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  return { help: false, inputUrl, options };
}

function deriveReportedAuthStatus(authResult, finalLoginState, reopenVerification) {
  const hasConfirmedIdentity = finalLoginState?.identityConfirmed === true;
  if (authResult.challengeRequired) {
    return 'challenge-required';
  }
  if (authResult.status === 'already-authenticated' && reopenVerification?.passed === true) {
    return 'session-reused';
  }
  if (authResult.waitedForManualLogin && hasConfirmedIdentity) {
    return 'manual-login-complete';
  }
  if (authResult.waitedForManualLogin && authResult.waitStatus === 'timeout') {
    return 'manual-login-timeout';
  }
  if (authResult.waitedForManualLogin && authResult.waitStatus === 'session-unavailable') {
    return 'manual-login-unavailable';
  }
  if (authResult.status === 'credentials-unavailable') {
    return 'credentials-unavailable';
  }
  if (hasConfirmedIdentity) {
    return 'authenticated';
  }
  return authResult.status;
}

async function probeReusableSessionBeforeManualWait(session, inputUrl, settings, authContext, authResult, navigationPlan, runtime) {
  if (!settings.waitForManualLogin || settings.headless) {
    return null;
  }
  if (!authContext?.reuseLoginState || !authContext?.userDataDir || !authContext?.authConfig) {
    return null;
  }
  if (!['credentials-unavailable', 'unauthenticated'].includes(String(authResult?.status ?? ''))) {
    return null;
  }
  if (authResult?.challengeRequired) {
    return null;
  }

  const candidateUrls = uniqueUrls([
    navigationPlan?.verificationUrl,
    authContext.authConfig.postLoginUrl,
    navigationPlan?.runtimeUrl,
  ]);

  for (const url of candidateUrls) {
    try {
      await session.navigateAndWait(url, createWaitPolicy(settings.timeoutMs));
      const loginState = await runtime.inspectLoginState(session, authContext.authConfig);
      if (loginState?.identityConfirmed === true) {
        return {
          ...authResult,
          status: 'already-authenticated',
          loginState,
          reusedLoginStateDetected: true,
        };
      }
    } catch {
      // Ignore transient navigation failures and keep checking the next auth surface.
    }
  }

  return null;
}

export async function siteLogin(inputUrl, options = {}, deps = {}) {
  const settings = mergeOptions(inputUrl, options);
  const reportDir = path.join(settings.outDir, `${formatTimestampForDir()}_${sanitizeHost(settings.host)}`);
  const reportJsonPath = path.join(reportDir, 'site-login-report.json');
  const reportJsonAuditPath = path.join(reportDir, 'site-login-report.redaction-audit.json');
  const reportMarkdownPath = path.join(reportDir, 'site-login-report.md');
  const reportMarkdownAuditPath = path.join(reportDir, 'site-login-report.md.redaction-audit.json');
  const runtime = {
    openBrowserSession,
    resolveSiteAuthProfile,
    resolveSiteBrowserSessionOptions,
    ensureAuthenticatedSession,
    waitForAuthenticatedSession,
    inspectLoginState,
    inspectPersistentProfileHealth,
    prepareSiteSessionGovernance,
    finalizeSiteSessionGovernance,
    releaseSessionLease,
    ...deps,
  };

  const authProfile = await runtime.resolveSiteAuthProfile(inputUrl, {
    profilePath: settings.profilePath,
  });
  const authContext = await runtime.resolveSiteBrowserSessionOptions(inputUrl, settings, {
    profilePath: settings.profilePath,
    authProfile,
  });
  const warnings = [...(authProfile?.warnings ?? [])];
  const authConfig = authContext.authConfig;
  if (!authConfig?.loginUrl) {
    throw new Error(`Site profile ${settings.profilePath} does not define authSession.loginUrl.`);
  }

  const profileHealthBefore = authContext.userDataDir
    ? await runtime.inspectPersistentProfileHealth(authContext.userDataDir)
    : null;
  if (profileHealthBefore?.warnings?.length) {
    warnings.push(...profileHealthBefore.warnings);
  }

  const governance = await runtime.prepareSiteSessionGovernance(inputUrl, authContext, settings, {
    operation: settings.runtimePurpose === 'keepalive' ? 'site-keepalive' : 'site-login',
    profileHealth: profileHealthBefore,
    networkOptions: {
      disableExternalLookup: true,
    },
  }, deps.siteSessionGovernanceDeps ?? {});
  if (!governance.policyDecision.allowed) {
    const blockedError = new Error(
      governance.policyDecision.riskCauseCode === 'concurrent-profile-use'
        ? 'Persistent browser profile is already in use by another active authenticated session.'
        : `Site login blocked by runtime governance: ${governance.policyDecision.riskCauseCode ?? 'unknown-risk'}.`,
    );
    blockedError.code = governance.policyDecision.riskCauseCode ?? 'SITE_LOGIN_BLOCKED';
    if (governance.lease) {
      await runtime.releaseSessionLease(governance.lease);
    }
    throw blockedError;
  }
  if (governance.policyDecision.riskCauseCode) {
    warnings.push(
      `Runtime governance observed ${governance.policyDecision.riskCauseCode}${governance.policyDecision.riskAction ? ` (${governance.policyDecision.riskAction})` : ''}.`,
    );
  }

  const navigationPlan = resolveRuntimeNavigationPlan(inputUrl, settings, authProfile, authContext);
  let session = null;
  let authResult = null;
  let closed = false;
  let governanceSummary = null;
  let governanceFinalized = false;

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
      startupUrl: navigationPlan.browserStartUrl,
    }, {
      userDataDirPrefix: 'site-login-browser-',
    });
    const warmupSummary = await performRuntimeWarmup(session, navigationPlan, settings);
    if (warmupSummary.warning) {
      warnings.push(warmupSummary.warning);
    }
    authResult = await runtime.ensureAuthenticatedSession(session, inputUrl, settings, {
      authContext,
    });
    const reusableSessionProbe = await probeReusableSessionBeforeManualWait(
      session,
      inputUrl,
      settings,
      authContext,
      authResult,
      navigationPlan,
      runtime,
    );
    if (reusableSessionProbe) {
      authResult = reusableSessionProbe;
    }

    let waitedForManualLogin = false;
    if (
      authResult.status !== 'authenticated'
      && authResult.status !== 'already-authenticated'
      && settings.waitForManualLogin
      && !settings.headless
    ) {
      waitedForManualLogin = true;
      try {
        if (authConfig.loginUrl) {
          await session.navigateAndWait(authConfig.loginUrl, {
            useLoadEvent: false,
            useNetworkIdle: false,
            documentReadyTimeoutMs: settings.timeoutMs,
            domQuietTimeoutMs: settings.timeoutMs,
            domQuietMs: 400,
            idleMs: 250,
          });
        }
      } catch {
        // Keep the current page if the site already redirected.
      }
      const manualWait = await runtime.waitForAuthenticatedSession(session, authConfig, {
        assistManualLogin: true,
        timeoutMs: settings.manualLoginTimeoutMs,
      });
      if (manualWait.status === 'authenticated') {
        authResult = {
          ...authResult,
          status: 'authenticated',
          loginState: manualWait.loginState ?? authResult.loginState,
        };
      } else {
        authResult = {
          ...authResult,
          loginState: manualWait.loginState ?? authResult.loginState,
          waitStatus: manualWait.status,
        };
      }
      authResult.waitedForManualLogin = waitedForManualLogin;
    }

    const finalLoginState = authResult.loginState
      ?? await runtime.inspectLoginState(session, authConfig);
    const primaryCloseSummary = await session.close();
    closed = true;
    const reopenVerification = finalLoginState?.identityConfirmed === true
      ? await verifyPersistentLoginReuse(
        inputUrl,
        settings,
        authContext,
        runtime,
        {
          ...authProfile,
          verificationUrl: settings.verificationUrl ?? null,
          keepaliveUrl: settings.keepaliveUrl ?? null,
        },
        navigationPlan,
      )
      : {
        attempted: false,
        passed: false,
        loginState: null,
        verificationUrl: null,
        warmupSummary: {
          attempted: false,
          completed: false,
          urls: [],
          steps: [],
          warning: null,
        },
      };
    const reportedStatus = deriveReportedAuthStatus(authResult, finalLoginState, reopenVerification);
    governanceSummary = await runtime.finalizeSiteSessionGovernance(governance, {
      antiCrawlSignals: authResult.challengeRequired ? ['verify'] : [],
      authRequired: true,
      authAvailable: finalLoginState?.identityConfirmed === true,
      identityConfirmed: finalLoginState?.identityConfirmed === true,
      loginStateDetected: finalLoginState?.loginStateDetected === true || finalLoginState?.loggedIn === true,
      profileHealth: profileHealthBefore,
      persistedHealthySession: finalLoginState?.identityConfirmed === true && reopenVerification.passed === true,
      sessionReuseVerified: reopenVerification.passed === true,
      warmupSummary,
      note: authResult.challengeText ?? null,
    });
    governanceFinalized = true;
    const report = {
      site: {
        url: inputUrl,
        host: settings.host,
        profilePath: settings.profilePath,
        userDataDir: authContext.userDataDir,
        loginUrl: authConfig.loginUrl,
        postLoginUrl: authConfig.postLoginUrl,
        runtimePurpose: settings.runtimePurpose,
        browserStartUrl: session.browserStartUrl,
        browserAttachedVia: session.browserAttachedVia,
        reusedBrowserInstance: session.reusedBrowserInstance === true,
        sessionLeaseId: governanceSummary?.sessionLeaseId ?? governance.lease?.leaseId ?? null,
      },
      auth: {
        status: reportedStatus,
        autoLogin: settings.autoLogin,
        waitedForManualLogin: authResult.waitedForManualLogin === true,
        waitStatus: authResult.waitStatus ?? null,
        credentialsSource: authResult.credentials?.source ?? null,
        loginStateDetected: finalLoginState?.loginStateDetected === true || finalLoginState?.loggedIn === true,
        identityConfirmed: finalLoginState?.identityConfirmed === true,
        identitySource: finalLoginState?.identitySource ?? null,
        reopenVerificationPassed: reopenVerification.passed === true,
        persistenceVerified: reopenVerification.attempted ? reopenVerification.passed === true : null,
        shutdownMode: primaryCloseSummary?.shutdownMode ?? 'forced',
        challengeRequired: authResult.challengeRequired === true,
        challengeText: authResult.challengeText ?? null,
        currentUrl: finalLoginState?.currentUrl ?? null,
        runtimeUrl: navigationPlan.runtimeUrl ?? navigationPlan.browserStartUrl,
        warmupSummary,
        keepaliveUrl: settings.keepaliveUrl
          || authConfig.keepaliveUrl
          || (settings.runtimePurpose === 'keepalive' ? reopenVerification.verificationUrl ?? null : null),
        keepaliveIntervalMinutes: authConfig.keepaliveIntervalMinutes ?? null,
        cooldownMinutesAfterRisk: authConfig.cooldownMinutesAfterRisk ?? null,
        preferVisibleBrowserForAuthenticatedFlows: authConfig.preferVisibleBrowserForAuthenticatedFlows === true,
        requireStableNetworkForAuthenticatedFlows: authConfig.requireStableNetworkForAuthenticatedFlows === true,
        riskCauseCode: governanceSummary?.riskCauseCode ?? null,
        riskAction: governanceSummary?.riskAction ?? null,
        networkIdentityFingerprint: governanceSummary?.networkIdentityFingerprint ?? null,
        profileQuarantined: governanceSummary?.profileQuarantined === true,
        networkDriftDetected: governanceSummary?.networkDrift?.driftDetected === true,
        networkDriftReasons: governanceSummary?.networkDrift?.reasons ?? [],
        sessionHealthSummary: governanceSummary?.authSessionStateSummary ?? governance.authSessionSummary ?? null,
        title: finalLoginState?.title ?? null,
        manualLoginTimeoutMs: settings.manualLoginTimeoutMs,
        verificationUrl: reopenVerification.verificationUrl ?? navigationPlan.verificationUrl ?? null,
        reopenedCurrentUrl: reopenVerification.loginState?.currentUrl ?? null,
      },
      warnings,
      reports: {
        json: reportJsonPath,
        jsonRedactionAudit: reportJsonAuditPath,
        markdown: reportMarkdownPath,
        markdownRedactionAudit: reportMarkdownAuditPath,
      },
    };

    if (reportedStatus === 'credentials-unavailable') {
      warnings.push('No site credentials were found. Store them in Windows Credential Manager, set the configured environment variables, or complete login manually in the visible browser.');
    }
    if (authResult.challengeRequired) {
      warnings.push(`The site requested additional verification${authResult.challengeText ? `: ${authResult.challengeText}` : ''}.`);
    }
    if (authResult.waitStatus === 'timeout') {
      warnings.push(`Timed out waiting ${settings.manualLoginTimeoutMs} ms for manual login to finish.`);
    }
    if (primaryCloseSummary?.shutdownMode === 'forced') {
      warnings.push('Browser did not exit cleanly and had to be force-terminated; persisted login state may be unreliable.');
    }
    if (session.reusedBrowserInstance) {
      warnings.push('profile-in-use: attached to an existing browser instance that was already using this persistent profile.');
    }
    if (reopenVerification.attempted && !reopenVerification.passed) {
      warnings.push('A second browser session could not confirm persisted login state after closing the original window.');
    }
    if (reopenVerification.warmupSummary?.warning) {
      warnings.push(`Reopen verification warm-up warning: ${reopenVerification.warmupSummary.warning}`);
    }

    report.warnings = report.warnings.filter(
      (warning) => !shouldSuppressHistoricalProfileWarning(warning, reopenVerification, primaryCloseSummary),
    );

    await writeSiteLoginReportArtifacts(report, {
      reportDir,
      jsonPath: reportJsonPath,
      jsonAuditPath: reportJsonAuditPath,
      markdownPath: reportMarkdownPath,
      markdownAuditPath: reportMarkdownAuditPath,
    });
    return report;
  } finally {
    if (!closed && session) {
      await session.close();
    }
    if (!governanceFinalized && governance?.lease) {
      await runtime.releaseSessionLease(governance.lease);
    }
  }
}

async function runCli() {
  initializeCliUtf8();
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const report = await runSingleStageCliWithProgress({
    inputUrl: parsed.inputUrl,
    options: parsed.options,
    taskId: 'siteLogin',
    title: 'Site login',
    stageId: 'siteLogin',
    stageTitle: 'Check login state',
    run: (stageOptions) => siteLogin(parsed.inputUrl, stageOptions),
    successMessage: (result) => result?.auth?.status,
    artifacts: (result) => [
      result?.reports?.json ? { label: 'report', path: result.reports.json } : null,
      result?.reports?.markdown ? { label: 'markdown', path: result.reports.markdown } : null,
    ].filter(Boolean),
    isFailureResult: (result) => !['authenticated', 'session-reused', 'manual-login-complete'].includes(result?.auth?.status),
    failureReason: (result) => result?.auth?.riskCauseCode ?? result?.auth?.status ?? 'login failed',
    failureTitle: 'Site login requires manual recovery',
    nextStep: `node src/entrypoints/sites/site-doctor.mjs ${parsed.inputUrl} --no-headless --reuse-login-state`,
  });
  writeJsonStdout(report);
  if (!['authenticated', 'session-reused', 'manual-login-complete'].includes(report.auth.status)) {
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
