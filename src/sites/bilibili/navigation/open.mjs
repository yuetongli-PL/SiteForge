import path from 'node:path';
import { spawn } from 'node:child_process';

import { ensureDir, writeJsonFile, writeTextFile } from '../../../infra/io.mjs';
import { CdpClient } from '../../../infra/browser/cdp-client.mjs';
import { delay, detectBrowserPath, readExistingBrowserDevTools } from '../../../infra/browser/launcher.mjs';
import { resolveSiteAuthProfile, resolveSiteBrowserSessionOptions } from '../../../infra/auth/site-auth.mjs';
import { inferPageTypeFromUrl } from '../../core/page-types.mjs';

const AUTH_REQUIRED_DEFAULT_SUBPAGES = Object.freeze([
  'dynamic',
  'fans/follow',
  'fans/fans',
]);

const AUTH_REQUIRED_DEFAULT_PATH_PREFIXES = Object.freeze([
  '/watchlater',
  '/favlist',
]);

function formatTimestampForDir(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1Z');
}

function normalizeHostname(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeSubpageList(values) {
  return Array.isArray(values)
    ? values.map((value) => String(value ?? '').trim().replace(/^\/+|\/+$/gu, '')).filter(Boolean)
    : [];
}

function readBilibiliAuthorSubpage(url) {
  try {
    const parsed = new URL(url);
    if (normalizeHostname(parsed.hostname) !== 'space.bilibili.com') {
      return null;
    }
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 2) {
      return null;
    }
    if (!/^\d+$/u.test(segments[0])) {
      return null;
    }
    return segments.slice(1).join('/');
  } catch {
    return null;
  }
}

function readPathname(url) {
  try {
    return {
      hostname: normalizeHostname(new URL(url).hostname),
      pathname: new URL(url).pathname,
    };
  } catch {
    return null;
  }
}

function isPathPrefixMatch(pathname, prefix) {
  const normalizedPath = String(pathname ?? '').replace(/\/+$/u, '') || '/';
  const normalizedPrefix = `/${String(prefix ?? '').replace(/^\/+|\/+$/gu, '')}`;
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
}

function isPathFamilyMatch(pathname, prefix) {
  if (isPathPrefixMatch(pathname, prefix)) {
    return true;
  }
  const normalizedPath = String(pathname ?? '').replace(/\/+$/u, '') || '/';
  const normalizedPrefix = `/${String(prefix ?? '').replace(/^\/+|\/+$/gu, '')}`;
  return normalizedPath.includes(normalizedPrefix);
}

function authSamplePathPrefixes(profile = null) {
  const samples = profile?.authValidationSamples ?? {};
  const prefixes = [];
  for (const value of Object.values(samples)) {
    const parsed = readPathname(value);
    if (parsed?.pathname) {
      prefixes.push({
        hostname: parsed.hostname,
        pathname: parsed.pathname,
      });
    }
  }
  return prefixes;
}

function authRequiredPathPrefixes(profile = null) {
  const configured = Array.isArray(profile?.authSession?.authRequiredPathPrefixes)
    ? profile.authSession.authRequiredPathPrefixes
    : [];
  const normalized = configured
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : [...AUTH_REQUIRED_DEFAULT_PATH_PREFIXES];
}

function isAuthenticatedBilibiliPage(targetUrl, profile = null) {
  const authorSubpage = readBilibiliAuthorSubpage(targetUrl);
  if (authorSubpage) {
    const configured = normalizeSubpageList(profile?.authSession?.authRequiredAuthorSubpages);
    const allowed = configured.length > 0 ? configured : AUTH_REQUIRED_DEFAULT_SUBPAGES;
    if (allowed.some((value) => authorSubpage === value || authorSubpage.startsWith(`${value}/`))) {
      return true;
    }
  }

  const parsedTarget = readPathname(targetUrl);
  if (!parsedTarget) {
    return false;
  }
  if (authRequiredPathPrefixes(profile).some((prefix) => isPathFamilyMatch(parsedTarget.pathname, prefix))) {
    return true;
  }
  return authSamplePathPrefixes(profile).some((entry) => (
    entry.hostname === parsedTarget.hostname
      && isPathPrefixMatch(parsedTarget.pathname, entry.pathname)
  ));
}

function normalizeComparableUrl(value) {
  try {
    const parsed = new URL(String(value ?? ''));
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(value ?? '').split('#')[0];
  }
}

async function waitForTargetUrl(client, {
  targetId = null,
  expectedUrl,
  timeoutMs = 5_000,
}) {
  const expected = normalizeComparableUrl(expectedUrl);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await client.send('Target.getTargets');
    const targetInfos = Array.isArray(targets?.targetInfos) ? targets.targetInfos : [];
    const match = targetInfos.find((info) => (
      info?.type === 'page'
      && (targetId ? info.targetId === targetId : normalizeComparableUrl(info.url) === expected)
    ));
    if (match && normalizeComparableUrl(match.url) === expected) {
      return match;
    }
    await delay(150);
  }
  return null;
}

function buildDecisionReason({ authRequired, pageType }) {
  if (authRequired) {
    return `Authenticated bilibili page detected (${pageType || 'unknown-page'}). Open in local persistent Chrome profile.`;
  }
  return `Public bilibili page detected (${pageType || 'unknown-page'}). Keep using the built-in browser.`;
}

function buildMarkdownReport(report) {
  const lines = [
    '# Bilibili Open',
    '',
    `- Target URL: ${report.site.targetUrl}`,
    `- Page type: ${report.site.pageType ?? 'unknown-page'}`,
    `- Auth required: ${report.site.authRequired ? 'yes' : 'no'}`,
    `- Open mode: ${report.site.openMode}`,
    `- Reason: ${report.site.reason}`,
    `- Profile path: ${report.site.profilePath ?? 'none'}`,
    `- User data dir: ${report.site.userDataDir ?? 'none'}`,
    `- Browser path: ${report.site.browserPath ?? 'none'}`,
    '',
    '## Result',
    '',
    `- Opened locally: ${report.result.opened ? 'yes' : 'no'}`,
    `- Opened target URL: ${report.result.openedTargetUrl ?? 'none'}`,
    `- Browser attached via: ${report.result.browserAttachedVia ?? 'none'}`,
    `- Reused browser instance: ${report.result.reusedBrowserInstance ? 'yes' : 'no'}`,
    `- Result reason: ${report.result.reasonCode ?? 'none'}`,
    `- Result detail: ${report.result.reasonDetail ?? 'none'}`,
    '',
    '## Auth bootstrap',
    '',
    `- Attempted: ${report.authBootstrap.attempted ? 'yes' : 'no'}`,
    `- Triggered interactive login: ${report.authBootstrap.triggeredInteractiveLogin ? 'yes' : 'no'}`,
    `- Status: ${report.authBootstrap.status ?? 'none'}`,
    `- Persistence verified: ${report.authBootstrap.persistenceVerified === null ? 'n/a' : report.authBootstrap.persistenceVerified ? 'yes' : 'no'}`,
    '',
    '## Warnings',
    '',
    ...(report.warnings.length > 0 ? report.warnings.map((warning) => `- ${warning}`) : ['- none']),
  ];
  return lines.join('\n');
}

export async function resolveBilibiliOpenDecision(targetUrl, options = {}, deps = {}) {
  const authProfile = await (deps.resolveSiteAuthProfile ?? resolveSiteAuthProfile)(targetUrl, {
    profilePath: options.profilePath,
    siteProfile: options.siteProfile,
  });
  const profile = authProfile?.profile ?? null;
  const pageType = inferPageTypeFromUrl(targetUrl, profile);
  const authRequired = isAuthenticatedBilibiliPage(targetUrl, profile);
  const openMode = authRequired ? 'local-profile-browser' : 'builtin-browser';
  const reason = buildDecisionReason({ authRequired, pageType });
  return {
    targetUrl,
    pageType,
    authRequired,
    openMode,
    reason,
    profilePath: authProfile?.filePath ?? null,
    profile,
    warnings: [...(authProfile?.warnings ?? [])],
  };
}

export async function openBilibiliPageInLocalBrowser(targetUrl, options = {}, deps = {}) {
  const browserPath = options.browserPath ?? await (deps.detectBrowserPath ?? detectBrowserPath)();
  if (!browserPath) {
    const error = new Error('Unable to locate a Chromium-compatible browser for bilibili local browsing.');
    error.code = 'browser-not-found';
    throw error;
  }

  const sessionOptions = await (deps.resolveSiteBrowserSessionOptions ?? resolveSiteBrowserSessionOptions)(
    targetUrl,
    {
      browserPath,
      browserProfileRoot: options.browserProfileRoot,
      userDataDir: options.userDataDir,
      reuseLoginState: options.reuseLoginState ?? true,
      autoLogin: false,
      waitForManualLogin: false,
    },
    {
      profilePath: options.profilePath,
      siteProfile: options.siteProfile,
    },
  );

  const userDataDir = sessionOptions.userDataDir;
  if (!userDataDir) {
    const error = new Error('Missing persistent bilibili user-data-dir for local authenticated browsing.');
    error.code = 'missing-user-data-dir';
    throw error;
  }
  const devtools = userDataDir
    ? await (deps.readExistingBrowserDevTools ?? readExistingBrowserDevTools)(userDataDir, options.timeoutMs ?? 2_000)
    : null;

  if (devtools?.wsUrl) {
    const client = new (deps.CdpClient ?? CdpClient)(devtools.wsUrl, {
      timeoutMs: options.timeoutMs ?? 30_000,
    });
    try {
      await client.connect();
      const created = await client.send('Target.createTarget', { url: targetUrl });
      const targetInfo = await waitForTargetUrl(client, {
        targetId: created?.targetId ?? null,
        expectedUrl: targetUrl,
        timeoutMs: Math.min(options.timeoutMs ?? 30_000, 5_000),
      });
      if (!targetInfo) {
        const error = new Error(`Timed out while confirming the bilibili browser opened ${targetUrl}.`);
        error.code = 'attach-timeout';
        throw error;
      }
      return {
        opened: true,
        openedTargetUrl: targetInfo.url ?? targetUrl,
        browserAttachedVia: 'existing-target',
        reusedBrowserInstance: true,
        userDataDir,
        browserPath,
        targetId: created?.targetId ?? null,
      };
    } finally {
      client.close();
    }
  }

  const args = [
    `--user-data-dir=${path.resolve(userDataDir)}`,
    '--no-first-run',
    '--no-default-browser-check',
    String(targetUrl),
  ];
  const browserProcess = (deps.spawnImpl ?? spawn)(browserPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  browserProcess.unref();
  const startupTimeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? 30_000, 5_000));
  const startupDeadline = Date.now() + startupTimeoutMs;
  let startupVerified = false;

  while (Date.now() < startupDeadline) {
    if (browserProcess.exitCode !== null) {
      const error = new Error(`Local bilibili browser exited before the target page opened (code ${browserProcess.exitCode}).`);
      error.code = 'browser-exited-before-open';
      throw error;
    }
    const activeDevtools = await (deps.readExistingBrowserDevTools ?? readExistingBrowserDevTools)(userDataDir, 500);
    if (activeDevtools?.wsUrl) {
      const client = new (deps.CdpClient ?? CdpClient)(activeDevtools.wsUrl, {
        timeoutMs: options.timeoutMs ?? 30_000,
      });
      try {
        await client.connect();
        const targetInfo = await waitForTargetUrl(client, {
          expectedUrl: targetUrl,
          timeoutMs: Math.min(options.timeoutMs ?? 30_000, 5_000),
        });
        if (targetInfo) {
          startupVerified = true;
          break;
        }
      } catch {
        // Keep polling until the browser target becomes visible.
      } finally {
        client.close();
      }
    }
    await delay(150);
  }

  if (!startupVerified) {
    const error = new Error(`Timed out while waiting for the local bilibili browser to open ${targetUrl}.`);
    error.code = 'startup-navigation-failed';
    throw error;
  }

  return {
    opened: true,
    openedTargetUrl: targetUrl,
    browserAttachedVia: 'created-target',
    reusedBrowserInstance: false,
    userDataDir,
    browserPath,
    targetId: null,
    startupVerified,
  };
}

export const openBilibiliPage = openBilibiliPageInLocalBrowser;

export async function writeBilibiliOpenReport(report, outDir) {
  const reportDir = path.resolve(outDir, `${formatTimestampForDir()}_bilibili-open`);
  await ensureDir(reportDir);
  const jsonPath = path.join(reportDir, 'bilibili-open-report.json');
  const markdownPath = path.join(reportDir, 'bilibili-open-report.md');
  await writeJsonFile(jsonPath, report);
  await writeTextFile(markdownPath, buildMarkdownReport(report));
  return {
    dir: reportDir,
    json: jsonPath,
    markdown: markdownPath,
  };
}
