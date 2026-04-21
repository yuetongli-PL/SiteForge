import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { initializeCliUtf8 } from '../../infra/cli.mjs';
import { NETWORK_IDLE_QUIET_MS, openBrowserSession } from '../../infra/browser/session.mjs';
import { ensureAuthenticatedSession, resolveSiteBrowserSessionOptions } from '../../infra/auth/site-auth.mjs';

const DEFAULT_OPTIONS = {
  outDir: path.resolve(process.cwd(), 'captures'),
  browserPath: undefined,
  headless: true,
  timeoutMs: 30_000,
  waitUntil: 'load',
  idleMs: 1_000,
  fullPage: true,
  viewport: {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
  },
  userAgent: undefined,
  profilePath: undefined,
  siteProfile: null,
  reuseLoginState: undefined,
  browserProfileRoot: undefined,
  userDataDir: undefined,
  autoLogin: undefined,
};

function createError(code, message) {
  return { code, message };
}

function normalizeWaitUntil(value) {
  if (value !== 'load' && value !== 'networkidle') {
    throw new Error(`Unsupported waitUntil value: ${value}`);
  }
  return value;
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

function formatTimestampForDir(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1Z');
}

function sanitizeHost(host) {
  return (host || 'unknown-host').replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unknown-host';
}

function summarizeForStdout(manifest) {
  return {
    finalUrl: manifest.finalUrl,
    title: manifest.title,
    capturedAt: manifest.capturedAt,
    outDir: manifest.outDir,
    status: manifest.status,
  };
}

function buildManifest({
  inputUrl,
  capturedAt,
  outDir,
  htmlPath,
  snapshotPath,
  screenshotPath,
  manifestPath,
  viewport,
}) {
  return {
    inputUrl,
    finalUrl: null,
    title: null,
    capturedAt,
    status: 'failed',
    outDir,
    files: {
      html: htmlPath,
      snapshot: snapshotPath,
      screenshot: screenshotPath,
      manifest: manifestPath,
    },
    page: {
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
    },
    error: null,
  };
}

function setManifestError(manifest, code, message) {
  if (!manifest.error) {
    manifest.error = createError(code, message);
  }
}

async function writeManifest(manifest) {
  await writeFile(manifest.files.manifest, JSON.stringify(manifest, null, 2), 'utf8');
}

async function createOutputLayout(inputUrl, outDir) {
  let parsedUrl = null;
  try {
    parsedUrl = new URL(inputUrl);
  } catch {
    // Keep a stable output directory for invalid input too.
  }

  const capturedAt = new Date().toISOString();
  const dirTimestamp = formatTimestampForDir(new Date(capturedAt));
  const host = sanitizeHost(parsedUrl?.hostname ?? 'invalid-url');
  const captureDir = path.resolve(outDir, `${dirTimestamp}_${host}`);
  await mkdir(captureDir, { recursive: true });

  return {
    outDir: captureDir,
    capturedAt,
    htmlPath: path.join(captureDir, 'page.html'),
    snapshotPath: path.join(captureDir, 'dom-snapshot.json'),
    screenshotPath: path.join(captureDir, 'screenshot.png'),
    manifestPath: path.join(captureDir, 'manifest.json'),
  };
}

function mergeOptions(options = {}) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...options,
    viewport: {
      ...DEFAULT_OPTIONS.viewport,
      ...(options.viewport ?? {}),
    },
  };

  merged.outDir = path.resolve(merged.outDir);
  if (merged.profilePath) {
    merged.profilePath = path.resolve(merged.profilePath);
  }
  if (merged.browserProfileRoot) {
    merged.browserProfileRoot = path.resolve(merged.browserProfileRoot);
  }
  if (merged.userDataDir) {
    merged.userDataDir = path.resolve(merged.userDataDir);
  }
  merged.timeoutMs = normalizeNumber(merged.timeoutMs, 'timeoutMs');
  merged.idleMs = normalizeNumber(merged.idleMs, 'idleMs');
  merged.headless = normalizeBoolean(merged.headless, 'headless');
  merged.fullPage = normalizeBoolean(merged.fullPage, 'fullPage');
  if (merged.reuseLoginState !== undefined) {
    merged.reuseLoginState = normalizeBoolean(merged.reuseLoginState, 'reuseLoginState');
  }
  if (merged.autoLogin !== undefined) {
    merged.autoLogin = normalizeBoolean(merged.autoLogin, 'autoLogin');
  }
  merged.waitUntil = normalizeWaitUntil(merged.waitUntil);
  merged.viewport = {
    width: normalizeNumber(merged.viewport.width, 'viewport.width'),
    height: normalizeNumber(merged.viewport.height, 'viewport.height'),
    deviceScaleFactor: normalizeNumber(merged.viewport.deviceScaleFactor, 'viewport.deviceScaleFactor'),
  };

  return merged;
}

export function resolveCaptureSettings(inputUrl, options = {}) {
  return {
    inputUrl,
    settings: mergeOptions(options),
  };
}

function buildCaptureWaitPolicy(settings) {
  return {
    useLoadEvent: true,
    useNetworkIdle: settings.waitUntil === 'networkidle',
    networkQuietMs: NETWORK_IDLE_QUIET_MS,
    networkIdleTimeoutMs: settings.timeoutMs,
    documentReadyTimeoutMs: settings.timeoutMs,
    domQuietTimeoutMs: settings.timeoutMs,
    idleMs: settings.idleMs,
  };
}

async function createCaptureSession(settings, inputUrl) {
  if (typeof settings.runtimeFactory === 'function') {
    return await settings.runtimeFactory(settings, {
      inputUrl,
      purpose: 'capture',
    });
  }

  const authContext = await resolveSiteBrowserSessionOptions(inputUrl, settings, {
    profilePath: settings.profilePath,
    siteProfile: settings.siteProfile,
  });
  const session = await openBrowserSession({
    ...settings,
    userDataDir: authContext.userDataDir,
    cleanupUserDataDirOnShutdown: authContext.cleanupUserDataDirOnShutdown,
    startupUrl: inputUrl,
  }, {
    userDataDirPrefix: 'capture-browser-',
  });
  const shouldEnsureAuth = Boolean(authContext.authConfig)
    && (authContext.reuseLoginState || settings.autoLogin === true || authContext.authConfig.autoLoginByDefault);
  if (shouldEnsureAuth) {
    session.siteAuth = await ensureAuthenticatedSession(session, inputUrl, settings, {
      authContext,
    });
  }
  return session;
}

export async function openInitialPage(session, settings) {
  const parsedUrl = new URL(settings.inputUrl);
  await session.navigateAndWait(parsedUrl.toString(), buildCaptureWaitPolicy(settings));
  return parsedUrl;
}

export async function capturePageEvidence(session, policy) {
  const result = {
    evidence: {},
    artifactCount: 0,
    warnings: [],
    errors: [],
  };

  try {
    result.evidence.html = await session.captureHtml();
    result.artifactCount += 1;
  } catch (error) {
    result.errors.push(createError('HTML_CAPTURE_FAILED', error.message));
  }

  try {
    result.evidence.snapshot = await session.captureSnapshot();
    result.artifactCount += 1;
  } catch (error) {
    result.errors.push(createError('SNAPSHOT_CAPTURE_FAILED', error.message));
  }

  try {
    const screenshot = await session.captureScreenshot({
      fullPage: policy.fullPage,
      allowViewportFallback: true,
    });
    result.evidence.screenshotBase64 = screenshot.data;
    result.artifactCount += 1;
    if (screenshot.usedViewportFallback) {
      result.warnings.push(
        createError(
          'SCREENSHOT_FALLBACK',
          `Full-page screenshot failed and viewport screenshot was used instead: ${screenshot.primaryError?.message ?? 'unknown error'}`,
        ),
      );
    }
  } catch (error) {
    result.errors.push(createError('SCREENSHOT_CAPTURE_FAILED', error.message));
  }

  return result;
}

export async function writeCaptureArtifacts(layout, captureResult) {
  const writes = [];
  if (Object.prototype.hasOwnProperty.call(captureResult.evidence, 'html')) {
    writes.push(writeFile(layout.htmlPath, captureResult.evidence.html ?? '', 'utf8'));
  }
  if (Object.prototype.hasOwnProperty.call(captureResult.evidence, 'snapshot')) {
    writes.push(writeFile(layout.snapshotPath, JSON.stringify(captureResult.evidence.snapshot, null, 2), 'utf8'));
  }
  if (captureResult.evidence.screenshotBase64) {
    writes.push(writeFile(layout.screenshotPath, Buffer.from(captureResult.evidence.screenshotBase64, 'base64')));
  }
  await Promise.all(writes);
}

export async function writeCaptureManifest(manifest) {
  await writeManifest(manifest);
}

export async function capture(inputUrl, options = {}) {
  const { settings } = resolveCaptureSettings(inputUrl, options);
  settings.inputUrl = inputUrl;

  const layout = await createOutputLayout(inputUrl, settings.outDir);
  const manifest = buildManifest({
    inputUrl,
    capturedAt: layout.capturedAt,
    outDir: layout.outDir,
    htmlPath: layout.htmlPath,
    snapshotPath: layout.snapshotPath,
    screenshotPath: layout.screenshotPath,
    manifestPath: layout.manifestPath,
    viewport: settings.viewport,
  });

  let artifactCount = 0;
  let session = null;
  let parsedUrl;

  try {
    try {
      parsedUrl = new URL(inputUrl);
    } catch {
      setManifestError(manifest, 'INVALID_INPUT', `Invalid URL: ${inputUrl}`);
      await writeCaptureManifest(manifest);
      return manifest;
    }

    session = await createCaptureSession(settings, inputUrl);
    await openInitialPage(session, settings);

    const captureResult = await capturePageEvidence(session, {
      fullPage: settings.fullPage,
    });
    artifactCount = captureResult.artifactCount;
    await writeCaptureArtifacts(layout, captureResult);

    for (const warning of captureResult.warnings) {
      setManifestError(manifest, warning.code, warning.message);
    }
    for (const error of captureResult.errors) {
      setManifestError(manifest, error.code, error.message);
    }

    try {
      const metadata = await session.getPageMetadata(parsedUrl.toString());
      manifest.finalUrl = metadata.finalUrl ?? parsedUrl.toString();
      manifest.title = metadata.title ?? '';
      if (typeof metadata.viewportWidth === 'number' && typeof metadata.viewportHeight === 'number') {
        manifest.page.viewportWidth = metadata.viewportWidth;
        manifest.page.viewportHeight = metadata.viewportHeight;
      }
    } catch (error) {
      manifest.finalUrl = manifest.finalUrl ?? parsedUrl.toString();
      setManifestError(manifest, 'PAGE_METADATA_FAILED', error.message);
    }

    manifest.status = manifest.error ? (artifactCount > 0 ? 'partial' : 'failed') : 'success';
    await writeCaptureManifest(manifest);
    return manifest;
  } catch (error) {
    setManifestError(manifest, error?.code ?? 'CAPTURE_FAILED', error.message);
    manifest.status = artifactCount > 0 ? 'partial' : 'failed';
    try {
      await writeCaptureManifest(manifest);
    } catch {
      // Preserve the original failure for the caller.
    }
    return manifest;
  } finally {
    await session?.close?.();
  }
}

export function parseCliArgs(argv) {
  const args = [...argv];
  const options = {};
  let url = null;

  const readValue = (current, index) => {
    const eqIndex = current.indexOf('=');
    if (eqIndex !== -1) {
      return { value: current.slice(eqIndex + 1), nextIndex: index };
    }
    if (index + 1 >= args.length) {
      throw new Error(`Missing value for ${current}`);
    }
    return { value: args[index + 1], nextIndex: index + 1 };
  };

  const readOptionalBooleanValue = (current, index) => {
    const eqIndex = current.indexOf('=');
    if (eqIndex !== -1) {
      return { value: current.slice(eqIndex + 1), nextIndex: index };
    }
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      return { value: next, nextIndex: index + 1 };
    }
    return { value: true, nextIndex: index };
  };

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith('--')) {
      if (url) {
        throw new Error(`Unexpected positional argument: ${current}`);
      }
      url = current;
      continue;
    }

    if (current === '--help' || current === '-h') {
      options.help = true;
      continue;
    }

    if (current.startsWith('--out-dir')) {
      const { value, nextIndex } = readValue(current, index);
      options.outDir = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--browser-path')) {
      const { value, nextIndex } = readValue(current, index);
      options.browserPath = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--profile-path')) {
      const { value, nextIndex } = readValue(current, index);
      options.profilePath = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--browser-profile-root')) {
      const { value, nextIndex } = readValue(current, index);
      options.browserProfileRoot = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--user-data-dir')) {
      const { value, nextIndex } = readValue(current, index);
      options.userDataDir = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--timeout')) {
      const { value, nextIndex } = readValue(current, index);
      options.timeoutMs = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--wait-until')) {
      const { value, nextIndex } = readValue(current, index);
      options.waitUntil = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--idle-ms')) {
      const { value, nextIndex } = readValue(current, index);
      options.idleMs = value;
      index = nextIndex;
      continue;
    }

    if (current === '--full-page' || current.startsWith('--full-page=')) {
      const { value, nextIndex } = readOptionalBooleanValue(current, index);
      options.fullPage = value;
      index = nextIndex;
      continue;
    }

    if (current === '--no-full-page') {
      options.fullPage = false;
      continue;
    }

    if (current === '--headless' || current.startsWith('--headless=')) {
      const { value, nextIndex } = readOptionalBooleanValue(current, index);
      options.headless = value;
      index = nextIndex;
      continue;
    }

    if (current === '--no-headless') {
      options.headless = false;
      continue;
    }

    if (current === '--reuse-login-state' || current.startsWith('--reuse-login-state=')) {
      const { value, nextIndex } = readOptionalBooleanValue(current, index);
      options.reuseLoginState = value;
      index = nextIndex;
      continue;
    }

    if (current === '--no-reuse-login-state') {
      options.reuseLoginState = false;
      continue;
    }

    if (current === '--auto-login' || current.startsWith('--auto-login=')) {
      const { value, nextIndex } = readOptionalBooleanValue(current, index);
      options.autoLogin = value;
      index = nextIndex;
      continue;
    }

    if (current === '--no-auto-login') {
      options.autoLogin = false;
      continue;
    }

    throw new Error(`Unknown option: ${current}`);
  }

  return { url, options };
}

export function printHelp() {
  const helpText = `Usage:
  node src/entrypoints/pipeline/capture.mjs <url> [options]

Options:
  --out-dir <path>         Output root directory
  --browser-path <path>    Explicit Chromium/Chrome executable path
  --profile-path <path>    Explicit site profile for auth/session defaults
  --browser-profile-root <path> Root directory for persistent browser profiles
  --user-data-dir <path>   Explicit Chromium user-data-dir to reuse
  --timeout <ms>           Overall timeout for CDP operations
  --wait-until <mode>      load | networkidle
  --idle-ms <ms>           Extra delay after readiness before capture
  --full-page              Force full-page screenshot
  --no-full-page           Disable full-page screenshot
  --reuse-login-state      Reuse a persistent per-site browser profile
  --no-reuse-login-state   Disable persistent login-state reuse
  --auto-login             Best-effort credential login when credentials exist
  --no-auto-login          Disable credential auto-login
  --headless               Run browser headless (default)
  --no-headless            Run browser with a visible window
  --help                   Show this help
`;

  process.stdout.write(helpText);
}

export async function runCli() {
  initializeCliUtf8();
  try {
    const { url, options } = parseCliArgs(process.argv.slice(2));
    if (options.help || !url) {
      printHelp();
      process.exitCode = options.help ? 0 : 1;
      return;
    }

    const manifest = await capture(url, options);
    process.stdout.write(`${JSON.stringify(summarizeForStdout(manifest), null, 2)}\n`);

    if (manifest.status !== 'success') {
      if (manifest.error) {
        process.stderr.write(`${manifest.error.code}: ${manifest.error.message}\n`);
      }
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

