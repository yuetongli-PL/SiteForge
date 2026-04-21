// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { initializeCliUtf8, writeJsonStdout } from '../../infra/cli.mjs';
import {
  openBilibiliPageInLocalBrowser,
  resolveBilibiliOpenDecision,
  writeBilibiliOpenReport,
} from '../../sites/bilibili/navigation/open.mjs';
import { siteLogin } from './site-login.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..');

const DEFAULT_OPTIONS = {
  outDir: path.join(REPO_ROOT, 'runs', 'sites', 'bilibili-open-page'),
  profilePath: null,
  browserPath: undefined,
  browserProfileRoot: undefined,
  userDataDir: undefined,
  timeoutMs: 30_000,
  reuseLoginState: true,
  allowAutoLoginBootstrap: true,
  headlessProbe: true,
  localFallbackForBuiltinBrowser: true,
};

const HELP = `Usage:
  node src/entrypoints/sites/bilibili-open-page.mjs <url> [--profile-path <path>] [--browser-path <path>] [--browser-profile-root <dir>] [--user-data-dir <dir>] [--out-dir <dir>] [--timeout <ms>] [--reuse-login-state|--no-reuse-login-state] [--auto-login-bootstrap|--no-auto-login-bootstrap]

Notes:
  - Public bilibili pages are still classified as builtin-browser targets; when this local helper is invoked directly, it opens them locally as a fallback because the built-in browser cannot be controlled from this CLI.
  - Authenticated bilibili pages are opened in the local persistent Chrome profile.
  - If the authenticated page needs login bootstrap and --auto-login-bootstrap is enabled, this helper automatically runs site-login first.
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

function mergeOptions(options = {}) {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    outDir: path.resolve(options.outDir ?? DEFAULT_OPTIONS.outDir),
    profilePath: options.profilePath ? path.resolve(options.profilePath) : null,
    browserProfileRoot: options.browserProfileRoot ? path.resolve(options.browserProfileRoot) : undefined,
    userDataDir: options.userDataDir ? path.resolve(options.userDataDir) : undefined,
    timeoutMs: normalizeNumber(options.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs, 'timeoutMs'),
    reuseLoginState: normalizeBoolean(options.reuseLoginState ?? DEFAULT_OPTIONS.reuseLoginState, 'reuseLoginState'),
    allowAutoLoginBootstrap: normalizeBoolean(
      options.allowAutoLoginBootstrap ?? DEFAULT_OPTIONS.allowAutoLoginBootstrap,
      'allowAutoLoginBootstrap',
    ),
    headlessProbe: normalizeBoolean(options.headlessProbe ?? DEFAULT_OPTIONS.headlessProbe, 'headlessProbe'),
    localFallbackForBuiltinBrowser: normalizeBoolean(
      options.localFallbackForBuiltinBrowser ?? DEFAULT_OPTIONS.localFallbackForBuiltinBrowser,
      'localFallbackForBuiltinBrowser',
    ),
  };
}

function parseCliArgs(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    return { help: true };
  }

  const [targetUrl, ...rest] = argv;
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
      case '--out-dir': {
        const { value, nextIndex } = readValue(index);
        options.outDir = value;
        index = nextIndex;
        break;
      }
      case '--timeout': {
        const { value, nextIndex } = readValue(index);
        options.timeoutMs = value;
        index = nextIndex;
        break;
      }
      case '--reuse-login-state':
        options.reuseLoginState = true;
        break;
      case '--no-reuse-login-state':
        options.reuseLoginState = false;
        break;
      case '--auto-login-bootstrap':
        options.allowAutoLoginBootstrap = true;
        break;
      case '--no-auto-login-bootstrap':
        options.allowAutoLoginBootstrap = false;
        break;
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  return {
    help: false,
    targetUrl,
    options,
  };
}

function isReusableAuthStatus(status) {
  return ['session-reused', 'authenticated', 'manual-login-complete', 'already-authenticated'].includes(String(status ?? ''));
}

function buildBootstrapFailureError(reasonCode, message, report = null) {
  const error = new Error(message);
  error.code = reasonCode;
  if (report) {
    error.report = report;
  }
  return error;
}

function mapLoginBootstrapReason(report) {
  const status = String(report?.auth?.status ?? '');
  if (status === 'challenge-required') {
    return 'login-bootstrap-challenge-required';
  }
  if (status === 'credentials-unavailable') {
    return 'login-bootstrap-required';
  }
  if (report?.auth?.persistenceVerified !== true) {
    return 'login-bootstrap-failed';
  }
  return 'login-bootstrap-failed';
}

function classifyOpenResult(decision, result, authBootstrap) {
  if (result?.opened !== true) {
    return {
      reasonCode: result?.reasonCode ?? 'startup-navigation-failed',
      reasonDetail: result?.error?.message ?? 'Failed to open the requested bilibili page locally.',
    };
  }
  if (decision?.authRequired) {
    return {
      reasonCode: 'opened-authenticated-page',
      reasonDetail: authBootstrap?.status
        ? `Opened authenticated bilibili page after ${authBootstrap.status}.`
        : 'Opened authenticated bilibili page in the local persistent profile browser.',
    };
  }
  return {
    reasonCode: 'opened-public-page',
    reasonDetail: result?.localFallbackUsed
      ? 'Opened public bilibili page in the local browser because this CLI cannot control the built-in browser directly.'
      : 'Opened public bilibili page.',
  };
}

async function bootstrapLocalLogin(targetUrl, options, deps) {
  const probeReport = await (deps.siteLogin ?? siteLogin)(targetUrl, {
    outDir: options.outDir,
    profilePath: options.profilePath,
    browserPath: options.browserPath,
    browserProfileRoot: options.browserProfileRoot,
    userDataDir: options.userDataDir,
    timeoutMs: options.timeoutMs,
    headless: options.headlessProbe,
    autoLogin: false,
    waitForManualLogin: false,
    reuseLoginState: options.reuseLoginState,
  }, deps.siteLoginDeps ?? {});

  if (isReusableAuthStatus(probeReport?.auth?.status) && probeReport?.auth?.persistenceVerified === true) {
    return {
      attempted: true,
      triggeredInteractiveLogin: false,
      status: probeReport.auth.status,
      persistenceVerified: true,
      report: probeReport,
    };
  }

  if (!options.allowAutoLoginBootstrap) {
    throw buildBootstrapFailureError(
      'login-bootstrap-required',
      'This bilibili page requires a reusable local login session, and automatic login bootstrap is disabled.',
      probeReport,
    );
  }

  const interactiveReport = await (deps.siteLogin ?? siteLogin)(targetUrl, {
    outDir: options.outDir,
    profilePath: options.profilePath,
    browserPath: options.browserPath,
    browserProfileRoot: options.browserProfileRoot,
    userDataDir: options.userDataDir,
    timeoutMs: options.timeoutMs,
    headless: false,
    autoLogin: true,
    waitForManualLogin: true,
    reuseLoginState: options.reuseLoginState,
  }, deps.siteLoginDeps ?? {});

  if (!isReusableAuthStatus(interactiveReport?.auth?.status) || interactiveReport?.auth?.persistenceVerified !== true) {
    throw buildBootstrapFailureError(
      mapLoginBootstrapReason(interactiveReport),
      'Automatic bilibili login bootstrap did not produce a reusable local session.',
      interactiveReport,
    );
  }

  return {
    attempted: true,
    triggeredInteractiveLogin: true,
    status: interactiveReport.auth.status,
    persistenceVerified: true,
    report: interactiveReport,
  };
}

export async function openBilibiliPage(targetUrl, options = {}, deps = {}) {
  const settings = mergeOptions(options);
  const decision = await (deps.resolveBilibiliOpenDecision ?? resolveBilibiliOpenDecision)(targetUrl, settings, deps.decisionDeps ?? {});
  const warnings = [...(decision.warnings ?? [])];
  let authBootstrap = {
    attempted: false,
    triggeredInteractiveLogin: false,
    status: null,
    persistenceVerified: null,
    report: null,
  };
  let result = {
    opened: false,
    openedTargetUrl: null,
    browserAttachedVia: null,
    reusedBrowserInstance: false,
    reasonCode: null,
    reasonDetail: null,
  };
  let failure = null;

  try {
    if (decision.openMode === 'local-profile-browser') {
      authBootstrap = await bootstrapLocalLogin(targetUrl, settings, deps);
      warnings.push(...(authBootstrap.report?.warnings ?? []));
      result = await (deps.openBilibiliPageInLocalBrowser ?? openBilibiliPageInLocalBrowser)(targetUrl, settings, deps.openDeps ?? {});
    } else if (settings.localFallbackForBuiltinBrowser) {
      warnings.push('This helper cannot control the Codex built-in browser directly; the public bilibili page was opened in the local browser as a fallback.');
      result = await (deps.openBilibiliPageInLocalBrowser ?? openBilibiliPageInLocalBrowser)(targetUrl, settings, deps.openDeps ?? {});
      result.localFallbackUsed = true;
    }
  } catch (error) {
    failure = error;
    result = {
      ...result,
      opened: false,
      reasonCode: error?.code ?? 'startup-navigation-failed',
      reasonDetail: error?.message ?? String(error),
    };
  }

  if (!failure) {
    Object.assign(result, classifyOpenResult(decision, result, authBootstrap));
  } else if (failure?.report?.warnings) {
    warnings.push(...failure.report.warnings);
  }

  const report = {
    site: {
      targetUrl,
      pageType: decision.pageType,
      authRequired: decision.authRequired,
      openMode: decision.openMode,
      reason: decision.reason,
      profilePath: decision.profilePath,
      userDataDir: result.userDataDir ?? authBootstrap.report?.site?.userDataDir ?? null,
      browserPath: result.browserPath ?? settings.browserPath ?? null,
    },
    authBootstrap: {
      attempted: authBootstrap.attempted,
      triggeredInteractiveLogin: authBootstrap.triggeredInteractiveLogin,
      status: authBootstrap.status,
      persistenceVerified: authBootstrap.persistenceVerified,
      sessionReused: authBootstrap.report?.auth?.status === 'session-reused',
      openedTargetUrl: result.openedTargetUrl,
      usedProfileDir: result.userDataDir ?? authBootstrap.report?.site?.userDataDir ?? null,
    },
    result,
    warnings,
  };
  const reports = await (deps.writeBilibiliOpenReport ?? writeBilibiliOpenReport)(report, settings.outDir);
  return {
    ...report,
    reports,
  };
}

export async function runBilibiliOpenCli() {
  initializeCliUtf8();
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const report = await openBilibiliPage(parsed.targetUrl, parsed.options);
  writeJsonStdout(report);
  if (report.result.opened !== true) {
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  runBilibiliOpenCli().catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
