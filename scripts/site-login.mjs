// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { initializeCliUtf8, writeJsonStdout } from '../lib/cli.mjs';
import { ensureDir, writeJsonFile, writeTextFile } from '../lib/io.mjs';
import { sanitizeHost } from '../lib/normalize.mjs';
import { openBrowserSession } from '../lib/browser-runtime/session.mjs';
import { inspectPersistentProfileHealth } from '../lib/browser-runtime/profile-store.mjs';
import {
  DEFAULT_LOGIN_WAIT_TIMEOUT_MS,
  ensureAuthenticatedSession,
  inspectLoginState,
  resolveSiteAuthProfile,
  resolveSiteBrowserSessionOptions,
  waitForAuthenticatedSession,
} from '../lib/site-auth.mjs';
import { resolveProfilePathForUrl } from '../lib/sites/profiles.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');

const DEFAULT_OPTIONS = {
  outDir: path.join(REPO_ROOT, 'archive', 'site-login'),
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
  loginUsername: undefined,
  loginPassword: undefined,
};

const HELP = `Usage:
  node scripts/site-login.mjs <url> [--profile-path <path>] [--browser-path <path>] [--browser-profile-root <dir>] [--user-data-dir <dir>] [--timeout <ms>] [--manual-timeout <ms>] [--headless|--no-headless] [--auto-login|--no-auto-login] [--reuse-login-state|--no-reuse-login-state] [--wait-for-manual-login|--no-wait-for-manual-login] [--username <value>] [--password <value>]

Notes:
  - Prefer environment variables such as BILIBILI_USERNAME / BILIBILI_PASSWORD over --username / --password.
  - This command reuses a persistent Chromium profile so later capture/expand/pipeline runs can reuse the same login state.
`;

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
    `- Verification URL: ${report.auth.verificationUrl ?? 'unknown'}`,
    `- Title: ${report.auth.title ?? 'unknown'}`,
    `- Manual timeout: ${report.auth.manualLoginTimeoutMs}`,
    '',
    '## Warnings',
    '',
    ...(report.warnings.length > 0 ? report.warnings.map((warning) => `- ${warning}`) : ['- none']),
  ];
  return lines.join('\n');
}

function resolveAuthVerificationUrl(inputUrl, authProfile, authConfig) {
  const preferred = String(authProfile?.verificationUrl ?? '').trim();
  if (preferred) {
    return preferred;
  }
  const samples = authProfile?.profile?.authValidationSamples ?? {};
  const candidate = String(
    samples.dynamicUrl
    ?? authConfig?.postLoginUrl
    ?? inputUrl,
  ).trim();
  return candidate || inputUrl;
}

function resolveBrowserStartUrl(inputUrl, settings, authProfile, authContext) {
  const authConfig = authContext?.authConfig;
  if (!authConfig) {
    return inputUrl;
  }

  const wantsInteractiveLogin = !settings.headless && settings.waitForManualLogin;
  if (wantsInteractiveLogin) {
    return authConfig.loginUrl || inputUrl;
  }

  return resolveAuthVerificationUrl(inputUrl, authProfile, authConfig);
}

function shouldSuppressHistoricalProfileWarning(warning, reopenVerification, primaryCloseSummary) {
  if (!warning || !/Persistent browser profile last exit type was /u.test(String(warning))) {
    return false;
  }
  return reopenVerification?.attempted === true
    && reopenVerification?.passed === true
    && primaryCloseSummary?.shutdownMode === 'graceful';
}

async function verifyPersistentLoginReuse(inputUrl, settings, authContext, runtime, authProfile) {
  if (!authContext.userDataDir || !authContext.reuseLoginState) {
    return {
      attempted: false,
      passed: false,
      loginState: null,
      verificationUrl: null,
    };
  }

  const verificationUrl = resolveAuthVerificationUrl(inputUrl, authProfile, authContext.authConfig);
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
    startupUrl: verificationUrl,
  }, {
    userDataDirPrefix: 'site-login-browser-',
  });

  let closeSummary = null;
  try {
    await reopenSession.navigateAndWait(verificationUrl, {
      useLoadEvent: false,
      useNetworkIdle: false,
      documentReadyTimeoutMs: settings.timeoutMs,
      domQuietTimeoutMs: settings.timeoutMs,
      domQuietMs: 400,
      idleMs: 250,
    });
    const loginState = await runtime.inspectLoginState(reopenSession, authContext.authConfig);
    closeSummary = await reopenSession.close();
    return {
      attempted: true,
      passed: loginState?.identityConfirmed === true,
      loginState,
      verificationUrl,
      closeSummary,
    };
  } finally {
    if (!closeSummary) {
      await reopenSession.close();
    }
  }
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
  if (authResult.status === 'credentials-unavailable') {
    return 'credentials-unavailable';
  }
  if (authResult.waitedForManualLogin && hasConfirmedIdentity) {
    return 'manual-login-complete';
  }
  if (hasConfirmedIdentity) {
    return 'authenticated';
  }
  return authResult.status;
}

export async function siteLogin(inputUrl, options = {}, deps = {}) {
  const settings = mergeOptions(inputUrl, options);
  const reportDir = path.join(settings.outDir, `${formatTimestampForDir()}_${sanitizeHost(settings.host)}`);
  const reportJsonPath = path.join(reportDir, 'site-login-report.json');
  const reportMarkdownPath = path.join(reportDir, 'site-login-report.md');
  const runtime = {
    openBrowserSession,
    resolveSiteAuthProfile,
    resolveSiteBrowserSessionOptions,
    ensureAuthenticatedSession,
    waitForAuthenticatedSession,
    inspectLoginState,
    inspectPersistentProfileHealth,
    ...deps,
  };

  await ensureDir(reportDir);

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

  const browserStartUrl = resolveBrowserStartUrl(inputUrl, settings, authProfile, authContext);
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
    startupUrl: browserStartUrl,
  }, {
    userDataDirPrefix: 'site-login-browser-',
  });

  let authResult = null;
  let closed = false;

  try {
    authResult = await runtime.ensureAuthenticatedSession(session, inputUrl, settings, {
      authContext,
    });

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
        },
      )
      : {
        attempted: false,
        passed: false,
        loginState: null,
        verificationUrl: null,
      };
    const reportedStatus = deriveReportedAuthStatus(authResult, finalLoginState, reopenVerification);
    const report = {
      site: {
        url: inputUrl,
        host: settings.host,
        profilePath: settings.profilePath,
        userDataDir: authContext.userDataDir,
        loginUrl: authConfig.loginUrl,
        postLoginUrl: authConfig.postLoginUrl,
        browserStartUrl: session.browserStartUrl,
        browserAttachedVia: session.browserAttachedVia,
        reusedBrowserInstance: session.reusedBrowserInstance === true,
      },
      auth: {
        status: reportedStatus,
        autoLogin: settings.autoLogin,
        waitedForManualLogin: authResult.waitedForManualLogin === true,
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
        title: finalLoginState?.title ?? null,
        manualLoginTimeoutMs: settings.manualLoginTimeoutMs,
        verificationUrl: reopenVerification.verificationUrl ?? null,
        reopenedCurrentUrl: reopenVerification.loginState?.currentUrl ?? null,
      },
      warnings,
      reports: {
        json: reportJsonPath,
        markdown: reportMarkdownPath,
      },
    };

    if (reportedStatus === 'credentials-unavailable') {
      warnings.push('No site credentials were found. Set the configured environment variables or complete login manually in the visible browser.');
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
      warnings.push('A second browser session could not confirm bilibili login persistence after closing the original window.');
    }

    report.warnings = report.warnings.filter(
      (warning) => !shouldSuppressHistoricalProfileWarning(warning, reopenVerification, primaryCloseSummary),
    );

    await writeJsonFile(reportJsonPath, report);
    await writeTextFile(reportMarkdownPath, buildReportMarkdown(report));
    return report;
  } finally {
    if (!closed) {
      await session.close();
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
  const report = await siteLogin(parsed.inputUrl, parsed.options);
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
