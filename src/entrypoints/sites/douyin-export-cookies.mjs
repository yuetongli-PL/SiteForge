// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { CdpClient } from '../../infra/browser/cdp-client.mjs';
import {
  detectBrowserPath,
  launchBrowser,
  readExistingBrowserDevTools,
  shutdownBrowser,
} from '../../infra/browser/launcher.mjs';
import { initializeCliUtf8, writeJsonStdout } from '../../infra/cli.mjs';
import {
  runSingleStageCliWithProgress,
} from '../../infra/cli/progress-cli.mjs';
import {
  createSessionTarget,
  resolveSidecarPath,
} from '../../sites/douyin/live/export.mjs';
import { ensureDir, writeTextFile } from '../../infra/io.mjs';
import {
  resolveSiteBrowserSessionOptions,
} from '../../infra/auth/site-auth.mjs';
import {
  prepareRedactedArtifactJsonWithAudit,
} from '../../sites/capability/security-guard.mjs';

const DEFAULT_INPUT_URL = 'https://www.douyin.com/';
const DEFAULT_TIMEOUT_MS = 30_000;

function normalizeText(value) {
  return String(value ?? '').trim();
}

export function parseArgs(argv) {
  const args = [...argv];
  const positionals = [];
  const flags = {};
  const appendFlag = (key, value) => {
    if (!(key in flags)) {
      flags[key] = value;
      return;
    }
    if (Array.isArray(flags[key])) {
      flags[key].push(value);
      return;
    }
    flags[key] = [flags[key], value];
  };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const [key, inlineValue] = token.split('=', 2);
    const normalizedKey = key.replace(/^--/, '');
    if (inlineValue !== undefined) {
      appendFlag(normalizedKey, inlineValue);
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      appendFlag(normalizedKey, next);
      index += 1;
    } else {
      appendFlag(normalizedKey, true);
    }
  }
  return {
    inputUrl: positionals[0] ?? DEFAULT_INPUT_URL,
    options: {
      profilePath: flags['profile-path'] ? String(flags['profile-path']) : null,
      browserPath: flags['browser-path'] ? String(flags['browser-path']) : undefined,
      browserProfileRoot: flags['browser-profile-root'] ? String(flags['browser-profile-root']) : undefined,
      userDataDir: flags['user-data-dir'] ? String(flags['user-data-dir']) : undefined,
      outFile: flags['out-file'] ? String(flags['out-file']) : null,
      sidecarFile: flags['sidecar-file'] ? String(flags['sidecar-file']) : null,
      timeoutMs: flags.timeout ? Number(flags.timeout) : DEFAULT_TIMEOUT_MS,
      headless: flags.headless === true ? true : flags['no-headless'] === true ? false : undefined,
      reuseLoginState: flags['no-reuse-login-state'] === true ? false : true,
      autoLogin: flags['no-auto-login'] === true ? false : true,
      json: flags.json === true,
      quiet: flags.quiet === true,
      progressMode: flags.progress ? String(flags.progress) : undefined,
      forceTty: flags['force-tty'] === true,
      noTty: flags['no-tty'] === true,
    },
  };
}

function cookieSummary(cookies) {
  return {
    count: cookies.length,
    names: [...new Set(cookies.map((cookie) => normalizeText(cookie?.name)).filter(Boolean))].sort(),
    domains: [...new Set(cookies.map((cookie) => normalizeText(cookie?.domain)).filter(Boolean))].sort(),
  };
}

function redactionAuditPath(filePath) {
  const resolved = path.resolve(filePath);
  const ext = path.extname(resolved);
  const base = ext ? resolved.slice(0, -ext.length) : resolved;
  return `${base}.redaction-audit.json`;
}

export function prepareDouyinCookieExportArtifacts({
  inputUrl,
  outFile,
  sidecarFile,
  cookies = [],
  liveContext = null,
  liveContextWarning = null,
  authContext = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const summary = cookieSummary(Array.isArray(cookies) ? cookies : []);
  const sidecarPayload = {
    ok: true,
    generatedAt,
    inputUrl,
    mode: 'redacted-cookie-export-summary',
    cookieCount: summary.count,
    cookieSummary: summary,
    liveContextCaptured: Boolean(liveContext),
    browser: liveContext?.browserVersion ?? null,
    navigator: liveContext?.navigator ?? null,
    page: liveContext?.page ?? {
      url: normalizeText(inputUrl),
      origin: null,
      referrer: null,
    },
    headerNames: Object.keys(liveContext?.headers ?? {}).sort(),
    observedRequestHeaderNames: Object.keys(liveContext?.observedRequestHeaders ?? {}).sort(),
    warning: liveContextWarning,
    auth: {
      verificationUrl: authContext?.authConfig?.verificationUrl ?? null,
      userDataDirPresent: Boolean(authContext?.userDataDir),
    },
  };
  const cookieArtifact = prepareRedactedArtifactJsonWithAudit({
    ok: true,
    generatedAt,
    inputUrl,
    mode: 'redacted-cookie-export-summary',
    cookieSummary: summary,
  });
  const sidecar = prepareRedactedArtifactJsonWithAudit(sidecarPayload);
  return {
    cookieArtifact,
    sidecar,
    cookieAuditFile: redactionAuditPath(outFile),
    sidecarAuditFile: redactionAuditPath(sidecarFile),
    summary,
  };
}

async function exportDouyinCookies(inputUrl, options = {}) {
  const authContext = await resolveSiteBrowserSessionOptions(inputUrl, options, {
    profilePath: options.profilePath,
  });

  let client = null;
  let browserInfo = null;
  try {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const connectToBrowser = async (wsUrl) => {
      const nextClient = new CdpClient(wsUrl, { timeoutMs });
      await nextClient.connect();
      return nextClient;
    };
    const launchFreshBrowser = async () => {
      const browserPath = options.browserPath ? path.resolve(options.browserPath) : await detectBrowserPath();
      if (!browserPath) {
        throw new Error('No Chromium/Chrome executable found for Douyin cookie export.');
      }
      browserInfo = await launchBrowser(browserPath, {
        headless: options.headless ?? false,
        timeoutMs,
        userDataDir: authContext.userDataDir,
        cleanupUserDataDirOnShutdown: false,
        startupUrl: 'about:blank',
      });
      return await connectToBrowser(browserInfo.wsUrl);
    };

    const existingDevTools = await readExistingBrowserDevTools(authContext.userDataDir, Math.min(timeoutMs, 5_000));
    if (existingDevTools?.wsUrl) {
      try {
        browserInfo = {
          browserProcess: null,
          wsUrl: existingDevTools.wsUrl,
        };
        client = await connectToBrowser(browserInfo.wsUrl);
      } catch {
        browserInfo = null;
        client = await launchFreshBrowser();
      }
    } else {
      client = await launchFreshBrowser();
    }
    let liveContext = null;
    let liveContextWarning = null;
    try {
      liveContext = await createSessionTarget(
        client,
        inputUrl,
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
    } catch (error) {
      liveContextWarning = error?.message ?? String(error);
    }

    const cookiesResult = await client.send('Storage.getCookies');
    const allCookies = Array.isArray(cookiesResult?.cookies) ? cookiesResult.cookies : [];
    const cookies = allCookies.filter((cookie) => {
      const domain = normalizeText(cookie?.domain).replace(/^\./u, '').toLowerCase();
      return domain.endsWith('douyin.com');
    });
    if (!cookies.length) {
      throw new Error('No Douyin cookies were available in the current browser session.');
    }
    const outFile = path.resolve(options.outFile || path.join(authContext.userDataDir, '.bws', 'douyin-cookies.txt'));
    const sidecarFile = path.resolve(options.sidecarFile || resolveSidecarPath(outFile));
    await ensureDir(path.dirname(outFile));
    await ensureDir(path.dirname(sidecarFile));
    const generatedAt = new Date().toISOString();
    const prepared = prepareDouyinCookieExportArtifacts({
      inputUrl,
      outFile,
      sidecarFile,
      cookies,
      liveContext,
      liveContextWarning,
      authContext,
      generatedAt,
    });
    await writeTextFile(prepared.cookieAuditFile, prepared.cookieArtifact.auditJson);
    await writeTextFile(outFile, prepared.cookieArtifact.json);
    await writeTextFile(prepared.sidecarAuditFile, prepared.sidecar.auditJson);
    await writeTextFile(sidecarFile, prepared.sidecar.json);

    return {
      ok: true,
      path: outFile,
      sidecarPath: sidecarFile,
      redactionAuditPath: prepared.cookieAuditFile,
      sidecarRedactionAuditPath: prepared.sidecarAuditFile,
      mode: 'redacted-cookie-export-summary',
      cookieCount: prepared.summary.count,
      cookieSummary: prepared.summary,
      userAgent: normalizeText(liveContext?.navigator?.userAgent)
        || normalizeText(liveContext?.browserVersion?.userAgent)
        || null,
      headerNames: Object.keys(liveContext?.headers ?? {}).sort(),
      observedRequestHeaderNames: Object.keys(liveContext?.observedRequestHeaders ?? {}).sort(),
      warning: liveContextWarning,
      auth: {
        status: 'redacted-cookie-export-summary',
        verificationUrl: authContext?.authConfig?.verificationUrl ?? null,
        userDataDirPresent: Boolean(authContext.userDataDir),
      },
    };
  } finally {
    client?.close?.();
    if (browserInfo?.browserProcess) {
      await shutdownBrowser(browserInfo.browserProcess, authContext.userDataDir, {
        cleanupUserDataDirOnShutdown: false,
      });
    }
  }
}

export { exportDouyinCookies };

export async function runDouyinExportCookiesCli(argv = process.argv.slice(2)) {
  initializeCliUtf8();
  const parsed = parseArgs(argv);
  const report = await runSingleStageCliWithProgress({
    inputUrl: parsed.inputUrl,
    options: parsed.options,
    taskId: 'douyinExportCookies',
    title: 'Export Douyin cookie summary',
    stageId: 'douyinExportCookies',
    stageTitle: '导出抖音脱敏 Cookie 摘要',
    run: (stageOptions) => exportDouyinCookies(parsed.inputUrl, stageOptions),
    successMessage: (result) => `exported ${result?.cookieCount ?? 0} redacted cookies`,
    artifacts: (result) => [
      result?.path ? { label: 'Cookie summary', path: result.path } : null,
      result?.sidecarPath ? { label: 'Sidecar', path: result.sidecarPath } : null,
      result?.redactionAuditPath ? { label: 'Redaction audit', path: result.redactionAuditPath } : null,
      result?.sidecarRedactionAuditPath ? { label: 'Sidecar audit', path: result.sidecarRedactionAuditPath } : null,
    ].filter(Boolean),
    warningResult: (result) => Boolean(result?.warning),
    failureTitle: 'Douyin cookie export safely stopped',
    nextStep: 'node src/entrypoints/cli.mjs site login https://www.douyin.com/ --no-headless --reuse-login-state',
  });
  writeJsonStdout(report);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  runDouyinExportCookiesCli().catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
