// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { initializeCliUtf8, writeJsonStdout } from '../../infra/cli.mjs';
import { projectDouyinFollowResult, queryDouyinFollow } from '../../sites/douyin/queries/follow-query.mjs';
import { resolveProfilePathForUrl } from '../../sites/core/profiles.mjs';
import { siteLogin } from './site-login.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..');

const DEFAULT_OPTIONS = {
  outDir: path.join(REPO_ROOT, 'runs', 'sites', 'site-keepalive'),
  profilePath: null,
  browserPath: undefined,
  browserProfileRoot: undefined,
  userDataDir: undefined,
  timeoutMs: 30_000,
  manualLoginTimeoutMs: 0,
  headless: false,
  reuseLoginState: true,
  autoLogin: true,
  waitForManualLogin: false,
  refreshFollowCache: false,
  recentActiveDays: 3,
  recentActiveUsersLimit: 48,
};

const HELP = `Usage:
  node src/entrypoints/sites/site-keepalive.mjs <url> [--profile-path <path>] [--browser-path <path>] [--browser-profile-root <dir>] [--user-data-dir <dir>] [--timeout <ms>] [--headless|--no-headless] [--auto-login|--no-auto-login] [--reuse-login-state|--no-reuse-login-state] [--refresh-follow-cache] [--recent-active-days <n>] [--recent-active-users-limit <n>]

Notes:
  - This command opens the site's verification page, reuses the persistent browser profile, and refreshes login state when possible.
  - --refresh-follow-cache performs a Douyin follow-cache prewarm after a successful keepalive.
  - On Windows, stored WinCred credentials are used automatically before environment-variable fallbacks.
`;

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
  merged.refreshFollowCache = normalizeBoolean(merged.refreshFollowCache, 'refreshFollowCache');
  merged.recentActiveDays = normalizeNumber(merged.recentActiveDays, 'recentActiveDays');
  merged.recentActiveUsersLimit = normalizeNumber(merged.recentActiveUsersLimit, 'recentActiveUsersLimit');
  return merged;
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
      case '--refresh-follow-cache':
        options.refreshFollowCache = true;
        break;
      case '--no-refresh-follow-cache':
        options.refreshFollowCache = false;
        break;
      case '--recent-active-days': {
        const { value, nextIndex } = readValue(index);
        options.recentActiveDays = value;
        index = nextIndex;
        break;
      }
      case '--recent-active-users-limit': {
        const { value, nextIndex } = readValue(index);
        options.recentActiveUsersLimit = value;
        index = nextIndex;
        break;
      }
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  return { help: false, inputUrl, options };
}

function deriveKeepaliveStatus(loginReport) {
  if (loginReport?.auth?.challengeRequired === true) {
    return 'challenge-required';
  }
  if (loginReport?.auth?.persistenceVerified === true) {
    return 'kept-alive';
  }
  if (loginReport?.auth?.status === 'credentials-unavailable') {
    return 'credentials-unavailable';
  }
  return loginReport?.auth?.status ?? 'unknown';
}

function shouldRunDouyinFollowCachePrewarm(inputUrl, settings, loginReport) {
  if (settings.refreshFollowCache !== true) {
    return false;
  }
  if (deriveKeepaliveStatus(loginReport) !== 'kept-alive') {
    return false;
  }
  const host = String(loginReport?.site?.host ?? '');
  return /douyin\.com$/iu.test(host || inputUrl);
}

export async function siteKeepalive(inputUrl, options = {}, deps = {}) {
  const settings = mergeOptions(inputUrl, options);
  const loginReport = await (deps.siteLogin ?? siteLogin)(
    inputUrl,
    {
      ...settings,
      runtimePurpose: 'keepalive',
      waitForManualLogin: false,
      reuseLoginState: true,
    },
    deps.siteLoginDeps ?? {},
  );
  const warnings = Array.isArray(loginReport.warnings) ? [...loginReport.warnings] : [];
  let followCachePrewarm = null;
  if (shouldRunDouyinFollowCachePrewarm(inputUrl, settings, loginReport)) {
    try {
      const prewarmReport = await (deps.queryDouyinFollow ?? queryDouyinFollow)(
        inputUrl,
        {
          profilePath: settings.profilePath,
          browserPath: settings.browserPath,
          browserProfileRoot: settings.browserProfileRoot,
          userDataDir: settings.userDataDir,
          timeoutMs: settings.timeoutMs,
          headless: settings.headless,
          reuseLoginState: settings.reuseLoginState,
          autoLogin: settings.autoLogin,
          intent: 'prewarm-follow-cache',
          recentActiveDays: settings.recentActiveDays,
          recentActiveUsersLimit: settings.recentActiveUsersLimit,
        },
      );
      followCachePrewarm = {
        status: prewarmReport?.result?.partial === true ? 'partial' : 'completed',
        result: prewarmReport?.result
          ? {
            ...projectDouyinFollowResult(prewarmReport.result, 'summary'),
            prewarm: prewarmReport.result.prewarm ?? null,
          }
          : null,
        cache: prewarmReport?.cache ?? null,
      };
    } catch (error) {
      followCachePrewarm = {
        status: 'failed',
        error: error?.message ?? String(error),
      };
      warnings.push(`Douyin follow-cache prewarm failed: ${error?.message ?? String(error)}`);
    }
  }

  return {
    site: loginReport.site,
    keepalive: {
      status: deriveKeepaliveStatus(loginReport),
      runtimePurpose: loginReport.site?.runtimePurpose ?? 'keepalive',
      authStatus: loginReport.auth?.status ?? null,
      persistenceVerified: loginReport.auth?.persistenceVerified === true,
      autoLogin: loginReport.auth?.autoLogin === true,
      runtimeUrl: loginReport.auth?.runtimeUrl ?? null,
      browserStartUrl: loginReport.site?.browserStartUrl ?? null,
      warmupSummary: loginReport.auth?.warmupSummary ?? null,
      keepaliveUrl: loginReport.auth?.keepaliveUrl ?? loginReport.auth?.verificationUrl ?? null,
      verificationUrl: loginReport.auth?.verificationUrl ?? null,
      keepaliveIntervalMinutes: loginReport.auth?.keepaliveIntervalMinutes ?? null,
      cooldownMinutesAfterRisk: loginReport.auth?.cooldownMinutesAfterRisk ?? null,
      preferVisibleBrowserForAuthenticatedFlows: loginReport.auth?.preferVisibleBrowserForAuthenticatedFlows === true,
      requireStableNetworkForAuthenticatedFlows: loginReport.auth?.requireStableNetworkForAuthenticatedFlows === true,
      riskCauseCode: loginReport.auth?.riskCauseCode ?? null,
      riskAction: loginReport.auth?.riskAction ?? null,
      networkIdentityFingerprint: loginReport.auth?.networkIdentityFingerprint ?? null,
      profileQuarantined: loginReport.auth?.profileQuarantined === true,
      sessionHealthSummary: loginReport.auth?.sessionHealthSummary ?? null,
      credentialsSource: loginReport.auth?.credentialsSource ?? null,
      challengeRequired: loginReport.auth?.challengeRequired === true,
      followCachePrewarm,
    },
    warnings,
    reports: loginReport.reports ?? null,
    loginReport,
  };
}

async function runCli() {
  initializeCliUtf8();
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const report = await siteKeepalive(parsed.inputUrl, parsed.options);
  writeJsonStdout(report);
  if (report.keepalive.status !== 'kept-alive') {
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
