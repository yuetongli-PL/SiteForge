// @ts-check

import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { inspectPersistentProfileHealth } from '../../../infra/browser/profile-store.mjs';
import { resolveSiteBrowserSessionOptions } from '../../../infra/auth/site-auth.mjs';
import { siteLogin } from '../../../infra/auth/site-login-service.mjs';
import { openBilibiliPageInLocalBrowser, resolveBilibiliOpenDecision } from '../navigation/open.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..', '..');
const BILIBILI_DOWNLOAD_PYTHON_ENTRY = path.join(REPO_ROOT, 'src', 'sites', 'bilibili', 'download', 'python', 'bilibili.py');
const BILIBILI_DOWNLOAD_PYTHON_ENTRY_LABEL = 'src/sites/bilibili/download/python/bilibili.py';
const BILIBILI_HOME_URL = 'https://www.bilibili.com/';
const BV_PATTERN = /^BV[0-9A-Za-z]+$/u;

function normalizeBoolean(value, defaultValue = false) {
  return typeof value === 'boolean' ? value : defaultValue;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function classifyDownloadInput(raw) {
  const value = normalizeText(raw);
  if (!value) {
    return { source: value, inputKind: 'unknown', authRequired: false };
  }
  if (BV_PATTERN.test(value)) {
    return { source: value, inputKind: 'video-detail', authRequired: false };
  }
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname || '/';
    if (host === 'www.bilibili.com') {
      if (pathname.startsWith('/video/')) {
        return { source: value, inputKind: 'video-detail', authRequired: false };
      }
      if (pathname.startsWith('/bangumi/play/')) {
        return { source: value, inputKind: 'bangumi-detail', authRequired: false };
      }
      if (pathname.startsWith('/watchlater')) {
        return { source: value, inputKind: 'watch-later-list', authRequired: true };
      }
      if (pathname.startsWith('/v/') || pathname.startsWith('/anime') || pathname.startsWith('/movie')) {
        return { source: value, inputKind: 'channel-list', authRequired: false };
      }
    }
    if (host === 'space.bilibili.com') {
      if (/^\/\d+\/(?:video|upload\/video)(?:\/|$)/u.test(pathname)) {
        return { source: value, inputKind: 'author-video-list', authRequired: false };
      }
      if (/^\/\d+\/favlist(?:\/|$)/u.test(pathname)) {
        return { source: value, inputKind: 'favorite-list', authRequired: true };
      }
      if (/^\/\d+\/channel\/(?:collectiondetail|seriesdetail)(?:\/|$)/u.test(pathname) || /^\/list\//u.test(pathname)) {
        return { source: value, inputKind: 'collection-list', authRequired: false };
      }
    }
    return { source: value, inputKind: 'unknown', authRequired: false };
  } catch {
    return { source: value, inputKind: 'unknown', authRequired: false };
  }
}

function buildLoginFailureResult(plan, report) {
  return {
    ok: false,
    action: plan.action,
    plan,
    reasonCode: 'login-bootstrap-failed',
    loginReport: report,
  };
}

function definedEntries(input) {
  return Object.fromEntries(
    Object.entries(input || {}).filter(([, value]) => value !== undefined),
  );
}

async function inspectReusableBilibiliSession(request, deps = {}) {
  const sessionOptions = await (deps.resolveSiteBrowserSessionOptions ?? resolveSiteBrowserSessionOptions)(
    request.targetUrl || BILIBILI_HOME_URL,
    {
      browserProfileRoot: request.browserProfileRoot,
      userDataDir: request.userDataDir,
      reuseLoginState: request.reuseLoginState ?? true,
    },
    {
      profilePath: request.profilePath,
      siteProfile: request.siteProfile,
    },
  );
  const profileHealth = sessionOptions.userDataDir
    ? await (deps.inspectPersistentProfileHealth ?? inspectPersistentProfileHealth)(sessionOptions.userDataDir)
    : null;
  return {
    authAvailable: Boolean(sessionOptions.reuseLoginState && profileHealth?.usableForCookies),
    userDataDir: sessionOptions.userDataDir ?? null,
    profileHealth,
    profilePath: sessionOptions.authProfile?.filePath ?? null,
  };
}

export async function planBilibiliAction(request, deps = {}) {
  const action = normalizeText(request?.action) || 'open';
  const reuseLoginState = request?.reuseLoginState !== false;
  if (action === 'open') {
    const decision = await (deps.resolveBilibiliOpenDecision ?? resolveBilibiliOpenDecision)(
      request.targetUrl,
      {
        profilePath: request.profilePath,
        browserProfileRoot: request.browserProfileRoot,
        userDataDir: request.userDataDir,
        reuseLoginState,
        siteProfile: request.siteProfile,
      },
      deps.openDecisionDeps ?? {},
    );
    const sessionState = decision.authRequired
      ? await inspectReusableBilibiliSession({ ...request, reuseLoginState }, deps)
      : { authAvailable: false, userDataDir: null, profileHealth: null, profilePath: decision.profilePath ?? null };
    return {
      action,
      targetUrl: request.targetUrl,
      authRequired: decision.authRequired,
      openMode: decision.openMode,
      route: decision.authRequired
        ? (sessionState.authAvailable ? 'local-profile-browser' : 'site-login')
        : 'builtin-browser',
      reason: decision.reason,
      authAvailable: sessionState.authAvailable,
      userDataDir: sessionState.userDataDir,
      profileHealth: sessionState.profileHealth,
      profilePath: decision.profilePath ?? sessionState.profilePath,
      decision,
    };
  }
  if (action === 'download') {
    const items = Array.isArray(request.items) ? request.items.map((item) => normalizeText(item)).filter(Boolean) : [];
    const classifications = items.map(classifyDownloadInput);
    const authRequired = classifications.some((item) => item.authRequired);
    const sessionState = authRequired
      ? await inspectReusableBilibiliSession({ ...request, targetUrl: BILIBILI_HOME_URL, reuseLoginState }, deps)
      : { authAvailable: false, userDataDir: null, profileHealth: null, profilePath: request.profilePath ?? null };
    return {
      action,
      items,
      classifications,
      authRequired,
      route: authRequired && reuseLoginState && !sessionState.authAvailable ? 'download-after-login' : 'download-direct',
      reason: authRequired
        ? (sessionState.authAvailable
            ? 'Authenticated bilibili download inputs can reuse the local persistent profile.'
            : 'Authenticated bilibili download inputs require a reusable local session before downloading.')
        : 'Public bilibili download inputs can run directly.',
      authAvailable: sessionState.authAvailable,
      userDataDir: sessionState.userDataDir,
      profileHealth: sessionState.profileHealth,
      profilePath: sessionState.profilePath,
    };
  }
  if (action === 'preflight') {
    const openPlan = await planBilibiliAction({ ...request, action: 'open' }, deps);
    return {
      action,
      targetUrl: request.targetUrl,
      route: openPlan.route,
      reason: openPlan.reason,
      authRequired: openPlan.authRequired,
      authAvailable: openPlan.authAvailable,
      profileHealth: openPlan.profileHealth,
      profilePath: openPlan.profilePath,
      openMode: openPlan.openMode,
    };
  }
  if (action === 'login') {
    const sessionState = await inspectReusableBilibiliSession({ ...request, targetUrl: request.targetUrl || BILIBILI_HOME_URL, reuseLoginState }, deps);
    return {
      action,
      targetUrl: request.targetUrl || BILIBILI_HOME_URL,
      route: 'site-login',
      reason: 'Login bootstrap always runs through the local site-login helper.',
      authRequired: true,
      authAvailable: sessionState.authAvailable,
      userDataDir: sessionState.userDataDir,
      profileHealth: sessionState.profileHealth,
      profilePath: sessionState.profilePath,
    };
  }
  throw new Error(`Unsupported bilibili action: ${action}`);
}

async function spawnJsonCommand(command, args, { cwd = REPO_ROOT } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        PYTHONIOENCODING: process.env.PYTHONIOENCODING || 'utf-8',
        PYTHONUTF8: process.env.PYTHONUTF8 || '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      resolve({ code: Number(code ?? 1), stdout, stderr });
    });
  });
}

async function invokeDownloadCli(request, deps = {}) {
  const pythonPath = request.pythonPath || 'python';
  const scriptPath = BILIBILI_DOWNLOAD_PYTHON_ENTRY;
  const args = [scriptPath, ...(request.items || [])];
  if (request.reuseLoginState !== false) {
    args.push('--reuse-login-state');
  } else {
    args.push('--no-reuse-login-state');
  }
  if (request.allowAutoLoginBootstrap !== false) {
    args.push('--auto-login-bootstrap');
  } else {
    args.push('--no-auto-login-bootstrap');
  }
  if (request.profilePath) {
    args.push('--profile-path', request.profilePath);
  }
  if (request.browserProfileRoot) {
    args.push('--profile-root', request.browserProfileRoot);
  }
  if (request.browserPath) {
    args.push('--browser-path', request.browserPath);
  }
  if (request.outDir) {
    args.push('--out-dir', request.outDir);
  }
  const download = request.download || {};
  if (download.dryRun) {
    args.push('--dry-run');
  }
  if (download.concurrency) {
    args.push('--concurrency', String(download.concurrency));
  }
  if (download.maxPlaylistItems) {
    args.push('--max-playlist-items', String(download.maxPlaylistItems));
  }
  if (download.skipExisting) {
    args.push('--skip-existing');
  }
  if (download.retryFailedOnly) {
    args.push('--retry-failed-only');
  }
  if (download.resume === false) {
    args.push('--no-resume');
  }
  if (download.downloadArchivePath) {
    args.push('--download-archive', String(download.downloadArchivePath));
  }

  const completed = await (deps.spawnJsonCommand ?? spawnJsonCommand)(pythonPath, args);
  if (completed.code !== 0) {
    return {
      ok: false,
      reasonCode: 'download-failed',
      error: completed.stderr.trim() || completed.stdout.trim() || `${BILIBILI_DOWNLOAD_PYTHON_ENTRY_LABEL} exited with code ${completed.code}`,
      stdout: completed.stdout,
      stderr: completed.stderr,
    };
  }
  try {
    const manifest = JSON.parse(completed.stdout || '{}');
    return {
      ok: true,
      reasonCode: 'download-started',
      manifest,
      stdout: completed.stdout,
      stderr: completed.stderr,
    };
  } catch (error) {
    return {
      ok: false,
      reasonCode: 'download-invalid-json',
      error: `Failed to parse ${BILIBILI_DOWNLOAD_PYTHON_ENTRY_LABEL} output: ${error}`,
      stdout: completed.stdout,
      stderr: completed.stderr,
    };
  }
}

export async function runBilibiliAction(request, deps = {}) {
  const plan = await planBilibiliAction(request, deps);
  if (plan.action === 'open') {
    let loginReport = null;
    if (plan.route === 'site-login') {
      loginReport = await (deps.siteLogin ?? siteLogin)(
        request.targetUrl || BILIBILI_HOME_URL,
        definedEntries({
          profilePath: request.profilePath,
          browserPath: request.browserPath,
          browserProfileRoot: request.browserProfileRoot,
          userDataDir: request.userDataDir,
          reuseLoginState: request.reuseLoginState ?? true,
          autoLogin: true,
          headless: false,
          waitForManualLogin: true,
          outDir: request.outDir,
          timeoutMs: request.timeoutMs,
        }),
        deps.siteLoginDeps ?? {},
      );
      if ((loginReport?.auth?.persistenceVerified) !== true) {
        return buildLoginFailureResult(plan, loginReport);
      }
    }
    const openReport = await (deps.openBilibiliPage ?? openBilibiliPageInLocalBrowser)(
      request.targetUrl,
      {
        profilePath: request.profilePath,
        browserPath: request.browserPath,
        browserProfileRoot: request.browserProfileRoot,
        userDataDir: request.userDataDir,
        reuseLoginState: request.reuseLoginState ?? true,
        allowAutoLoginBootstrap: false,
        outDir: request.outDir,
        timeoutMs: request.timeoutMs,
      },
      deps.openDeps ?? {},
    );
    return {
      ok: openReport?.result?.opened === true,
      action: 'open',
      plan,
      reasonCode: openReport?.result?.reasonCode ?? 'startup-navigation-failed',
      loginReport,
      openReport,
    };
  }

  if (plan.action === 'login') {
    const loginReport = await (deps.siteLogin ?? siteLogin)(
      request.targetUrl || BILIBILI_HOME_URL,
      definedEntries({
        profilePath: request.profilePath,
        browserPath: request.browserPath,
        browserProfileRoot: request.browserProfileRoot,
        userDataDir: request.userDataDir,
        reuseLoginState: request.reuseLoginState ?? true,
        autoLogin: true,
        headless: false,
        waitForManualLogin: true,
        outDir: request.outDir,
        timeoutMs: request.timeoutMs,
      }),
      deps.siteLoginDeps ?? {},
    );
    return {
      ok: loginReport?.auth?.persistenceVerified === true,
      action: 'login',
      plan,
      reasonCode: loginReport?.auth?.status ?? 'login-failed',
      loginReport,
    };
  }

  if (plan.action === 'download') {
    let loginReport = null;
    if (plan.route === 'download-after-login') {
      loginReport = await (deps.siteLogin ?? siteLogin)(
        BILIBILI_HOME_URL,
        definedEntries({
          profilePath: request.profilePath,
          browserPath: request.browserPath,
          browserProfileRoot: request.browserProfileRoot,
          userDataDir: request.userDataDir,
          reuseLoginState: request.reuseLoginState ?? true,
          autoLogin: true,
          headless: false,
          waitForManualLogin: true,
          outDir: request.outDir,
          timeoutMs: request.timeoutMs,
        }),
        deps.siteLoginDeps ?? {},
      );
      if ((loginReport?.auth?.persistenceVerified) !== true) {
        return buildLoginFailureResult(plan, loginReport);
      }
    }
    const downloadResult = await invokeDownloadCli(request, deps);
    return {
      ok: downloadResult.ok,
      action: 'download',
      plan,
      reasonCode: downloadResult.reasonCode,
      loginReport,
      downloadResult,
    };
  }

  return {
    ok: true,
    action: 'preflight',
    plan,
    reasonCode: 'preflight-only',
  };
}
