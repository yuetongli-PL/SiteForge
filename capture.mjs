import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initializeCliUtf8 } from './lib/cli.mjs';

const DEFAULT_BROWSER_PATHS = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome for Testing\\chrome.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome for Testing', 'chrome.exe'),
    'C:\\Program Files\\Chromium\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Chromium', 'Application', 'chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
  ],
};

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
};

const SNAPSHOT_STYLES = ['display', 'visibility', 'opacity', 'position', 'z-index'];
const NETWORK_IDLE_QUIET_MS = 500;
const DEVTOOLS_POLL_INTERVAL_MS = 100;
const NETWORK_IDLE_POLL_INTERVAL_MS = 100;

class CdpClient {
  constructor(wsUrl, { timeoutMs = DEFAULT_OPTIONS.timeoutMs } = {}) {
    this.wsUrl = wsUrl;
    this.defaultTimeoutMs = timeoutMs;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = false;
  }

  async connect() {
    if (this.ws) {
      return;
    }

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      let settled = false;

      const cleanup = () => {
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onError);
      };

      const onOpen = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        this.ws = ws;
        ws.addEventListener('message', (event) => this.#handleMessage(event));
        ws.addEventListener('close', (event) => this.#handleClose(event));
        ws.addEventListener('error', (event) => this.#handleSocketError(event));
        resolve();
      };

      const onError = (event) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new Error(`Failed to connect to CDP websocket: ${event?.message ?? 'unknown error'}`));
      };

      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onError);
    });
  }

  async send(method, params = {}, sessionId, timeoutMs = this.defaultTimeoutMs) {
    if (!this.ws || this.closed) {
      throw new Error('CDP socket is not connected');
    }

    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) {
      payload.sessionId = sessionId;
    }

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout for ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify(payload));
    });
  }

  on(method, handler, { sessionId } = {}) {
    const listener = { method, handler, sessionId: sessionId ?? null };
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  waitForEvent(method, { sessionId, predicate, timeoutMs = this.defaultTimeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      let timer = null;
      const off = this.on(
        method,
        (event) => {
          try {
            if (predicate && !predicate(event.params, event)) {
              return;
            }
            clearTimeout(timer);
            off();
            resolve(event);
          } catch (error) {
            clearTimeout(timer);
            off();
            reject(error);
          }
        },
        { sessionId },
      );

      timer = setTimeout(() => {
        off();
        reject(new Error(`Timed out waiting for event ${method}`));
      }, timeoutMs);
    });
  }

  close() {
    if (!this.ws || this.closed) {
      return;
    }
    this.closed = true;
    this.ws.close();
  }

  #handleMessage(event) {
    let message;
    try {
      message = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8'));
    } catch (error) {
      return;
    }

    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`CDP ${pending.method} failed: ${message.error.message}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (!message.method) {
      return;
    }

    const sessionId = message.sessionId ?? null;
    for (const listener of this.listeners) {
      if (listener.method !== message.method) {
        continue;
      }
      if (listener.sessionId !== null && listener.sessionId !== sessionId) {
        continue;
      }
      listener.handler({ method: message.method, params: message.params ?? {}, sessionId });
    }
  }

  #handleClose(event) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const error = new Error(`CDP socket closed: ${event.code} ${event.reason || ''}`.trim());
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  #handleSocketError(_event) {
    if (this.closed) {
      return;
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectBrowserPath() {
  const envCandidates = [process.env.BROWSER_PATH, process.env.CHROME_PATH, process.env.CHROMIUM_PATH].filter(Boolean);
  const platformCandidates = DEFAULT_BROWSER_PATHS[process.platform] ?? [];
  for (const candidate of [...envCandidates, ...platformCandidates]) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function waitForDevToolsPort(userDataDir, browserProcess, timeoutMs, getLaunchError = () => null) {
  const filePath = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const launchError = getLaunchError();
    if (launchError) {
      throw launchError;
    }

    if (browserProcess.exitCode !== null) {
      throw new Error(`Browser exited before DevTools became ready (code ${browserProcess.exitCode})`);
    }

    try {
      const content = await readFile(filePath, 'utf8');
      const [portLine] = content.trim().split(/\r?\n/);
      const port = Number(portLine);
      if (Number.isInteger(port) && port > 0) {
        return port;
      }
    } catch {
      // Keep polling until the file is populated.
    }
    await delay(DEVTOOLS_POLL_INTERVAL_MS);
  }

  throw new Error('Timed out waiting for DevToolsActivePort');
}

async function waitForBrowserWsUrl(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(2_000, timeoutMs))),
      });
      if (response.ok) {
        const payload = await response.json();
        if (payload?.webSocketDebuggerUrl) {
          return payload.webSocketDebuggerUrl;
        }
      }
    } catch {
      // Browser is still warming up.
    }
    await delay(DEVTOOLS_POLL_INTERVAL_MS);
  }

  throw new Error('Timed out waiting for browser websocket endpoint');
}

async function launchBrowser(browserPath, { headless, timeoutMs }) {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'capture-browser-'));
  const args = [
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--disable-gpu',
    '--disable-popup-blocking',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-sync',
    '--metrics-recording-only',
    '--mute-audio',
    'about:blank',
  ];

  if (headless) {
    args.unshift('--headless=new');
  }

  const browserProcess = spawn(browserPath, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });

  let stderr = '';
  let launchError = null;
  browserProcess.stderr?.setEncoding('utf8');
  browserProcess.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-8_192);
  });

  browserProcess.once('error', (error) => {
    launchError = error;
  });

  try {
    if (launchError) {
      throw launchError;
    }
    const port = await waitForDevToolsPort(userDataDir, browserProcess, timeoutMs, () => launchError);
    if (launchError) {
      throw launchError;
    }
    const wsUrl = await waitForBrowserWsUrl(port, timeoutMs);
    return { browserProcess, userDataDir, port, wsUrl, stderr };
  } catch (error) {
    await shutdownBrowser(browserProcess, userDataDir);
    throw new Error(`${error.message}${stderr ? `\n${stderr.trim()}` : ''}`.trim());
  }
}

async function shutdownBrowser(browserProcess, userDataDir) {
  if (browserProcess && browserProcess.exitCode === null) {
    browserProcess.kill();
    await Promise.race([
      new Promise((resolve) => browserProcess.once('exit', resolve)),
      delay(2_000),
    ]);
    if (browserProcess.exitCode === null) {
      browserProcess.kill('SIGKILL');
      await Promise.race([
        new Promise((resolve) => browserProcess.once('exit', resolve)),
        delay(2_000),
      ]);
    }
  }

  if (userDataDir) {
    await rm(userDataDir, { recursive: true, force: true });
  }
}

function createNetworkTracker(client, sessionId) {
  const inflight = new Set();
  let lastActivityAt = Date.now();

  const markActivity = () => {
    lastActivityAt = Date.now();
  };

  const offRequest = client.on(
    'Network.requestWillBeSent',
    ({ params }) => {
      if (!params?.requestId) {
        return;
      }
      inflight.add(params.requestId);
      markActivity();
    },
    { sessionId },
  );

  const finishRequest = ({ params }) => {
    if (!params?.requestId) {
      return;
    }
    inflight.delete(params.requestId);
    markActivity();
  };

  const offFinished = client.on('Network.loadingFinished', finishRequest, { sessionId });
  const offFailed = client.on('Network.loadingFailed', finishRequest, { sessionId });

  return {
    async waitForIdle({ quietMs, timeoutMs }) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (inflight.size === 0 && Date.now() - lastActivityAt >= quietMs) {
          return;
        }
        await delay(NETWORK_IDLE_POLL_INTERVAL_MS);
      }
      throw new Error(`Timed out waiting for network idle (${inflight.size} inflight requests remained)`);
    },
    dispose() {
      offRequest();
      offFinished();
      offFailed();
    },
  };
}

async function evaluateValue(client, sessionId, expression) {
  const result = await client.send(
    'Runtime.evaluate',
    {
      expression,
      returnByValue: true,
      awaitPromise: true,
    },
    sessionId,
  );

  if (result.exceptionDetails) {
    throw new Error(`Evaluation failed for expression: ${expression}`);
  }

  return result.result?.value;
}

async function getFrameTree(client, sessionId) {
  return await client.send('Page.getFrameTree', {}, sessionId);
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
  merged.timeoutMs = normalizeNumber(merged.timeoutMs, 'timeoutMs');
  merged.idleMs = normalizeNumber(merged.idleMs, 'idleMs');
  merged.headless = normalizeBoolean(merged.headless, 'headless');
  merged.fullPage = normalizeBoolean(merged.fullPage, 'fullPage');
  merged.waitUntil = normalizeWaitUntil(merged.waitUntil);
  merged.viewport = {
    width: normalizeNumber(merged.viewport.width, 'viewport.width'),
    height: normalizeNumber(merged.viewport.height, 'viewport.height'),
    deviceScaleFactor: normalizeNumber(merged.viewport.deviceScaleFactor, 'viewport.deviceScaleFactor'),
  };

  return merged;
}

export async function capture(inputUrl, options = {}) {
  const settings = mergeOptions(options);
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
  let browserProcess = null;
  let userDataDir = null;
  let client = null;
  let targetId = null;
  let sessionId = null;
  let networkTracker = null;

  try {
    let parsedUrl;
    try {
      parsedUrl = new URL(inputUrl);
    } catch (error) {
      setManifestError(manifest, 'INVALID_INPUT', `Invalid URL: ${inputUrl}`);
      await writeManifest(manifest);
      return manifest;
    }

    const browserPath = settings.browserPath ? path.resolve(settings.browserPath) : await detectBrowserPath();
    if (!browserPath) {
      setManifestError(
        manifest,
        'BROWSER_NOT_FOUND',
        'No Chromium/Chrome executable found. Pass browserPath or --browser-path explicitly.',
      );
      await writeManifest(manifest);
      return manifest;
    }

    const browserInfo = await launchBrowser(browserPath, settings);
    browserProcess = browserInfo.browserProcess;
    userDataDir = browserInfo.userDataDir;

    client = new CdpClient(browserInfo.wsUrl, { timeoutMs: settings.timeoutMs });
    await client.connect();

    const targetResult = await client.send('Target.createTarget', { url: 'about:blank' });
    targetId = targetResult.targetId;

    const attachResult = await client.send('Target.attachToTarget', { targetId, flatten: true });
    sessionId = attachResult.sessionId;

    await client.send('Page.enable', {}, sessionId);
    await client.send('Runtime.enable', {}, sessionId);
    await client.send('Network.enable', {}, sessionId);
    await client.send('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId);

    if (settings.userAgent) {
      await client.send('Emulation.setUserAgentOverride', { userAgent: settings.userAgent }, sessionId);
    }

    await client.send(
      'Emulation.setDeviceMetricsOverride',
      {
        width: settings.viewport.width,
        height: settings.viewport.height,
        deviceScaleFactor: settings.viewport.deviceScaleFactor,
        mobile: false,
      },
      sessionId,
    );

    networkTracker = createNetworkTracker(client, sessionId);

    const loadPromise = client.waitForEvent('Page.loadEventFired', {
      sessionId,
      timeoutMs: settings.timeoutMs,
    });

    const navigateResult = await client.send('Page.navigate', { url: parsedUrl.toString() }, sessionId);
    if (navigateResult.errorText) {
      throw new Error(`Navigation failed: ${navigateResult.errorText}`);
    }

    await loadPromise;

    if (settings.waitUntil === 'networkidle') {
      await networkTracker.waitForIdle({
        quietMs: NETWORK_IDLE_QUIET_MS,
        timeoutMs: settings.timeoutMs,
      });
    }

    if (settings.idleMs > 0) {
      await delay(settings.idleMs);
    }

    try {
      const html = await evaluateValue(client, sessionId, 'document.documentElement.outerHTML');
      await writeFile(layout.htmlPath, html ?? '', 'utf8');
      artifactCount += 1;
    } catch (error) {
      setManifestError(manifest, 'HTML_CAPTURE_FAILED', error.message);
    }

    try {
      const snapshot = await client.send(
        'DOMSnapshot.captureSnapshot',
        {
          computedStyles: SNAPSHOT_STYLES,
          includeDOMRects: true,
          includePaintOrder: true,
        },
        sessionId,
      );
      await writeFile(layout.snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');
      artifactCount += 1;
    } catch (error) {
      setManifestError(manifest, 'SNAPSHOT_CAPTURE_FAILED', error.message);
    }

    try {
      const screenshot = await client.send(
        'Page.captureScreenshot',
        {
          format: 'png',
          captureBeyondViewport: settings.fullPage,
          fromSurface: true,
        },
        sessionId,
      );
      await writeFile(layout.screenshotPath, Buffer.from(screenshot.data, 'base64'));
      artifactCount += 1;
    } catch (error) {
      if (settings.fullPage) {
        try {
          const fallback = await client.send(
            'Page.captureScreenshot',
            {
              format: 'png',
              captureBeyondViewport: false,
              fromSurface: true,
            },
            sessionId,
          );
          await writeFile(layout.screenshotPath, Buffer.from(fallback.data, 'base64'));
          artifactCount += 1;
          setManifestError(
            manifest,
            'SCREENSHOT_FALLBACK',
            `Full-page screenshot failed and viewport screenshot was used instead: ${error.message}`,
          );
        } catch (fallbackError) {
          setManifestError(manifest, 'SCREENSHOT_CAPTURE_FAILED', fallbackError.message);
        }
      } else {
        setManifestError(manifest, 'SCREENSHOT_CAPTURE_FAILED', error.message);
      }
    }

    try {
      const [frameTree, title, innerWidth, innerHeight] = await Promise.all([
        getFrameTree(client, sessionId),
        evaluateValue(client, sessionId, 'document.title'),
        evaluateValue(client, sessionId, 'window.innerWidth'),
        evaluateValue(client, sessionId, 'window.innerHeight'),
      ]);

      manifest.finalUrl = frameTree?.frameTree?.frame?.url ?? parsedUrl.toString();
      manifest.title = title ?? '';
      if (typeof innerWidth === 'number' && typeof innerHeight === 'number') {
        manifest.page.viewportWidth = innerWidth;
        manifest.page.viewportHeight = innerHeight;
      }
    } catch (error) {
      manifest.finalUrl = manifest.finalUrl ?? parsedUrl.toString();
      setManifestError(manifest, 'PAGE_METADATA_FAILED', error.message);
    }

    manifest.status = manifest.error ? (artifactCount > 0 ? 'partial' : 'failed') : 'success';
    await writeManifest(manifest);
    return manifest;
  } catch (error) {
    setManifestError(manifest, 'CAPTURE_FAILED', error.message);
    manifest.status = artifactCount > 0 ? 'partial' : 'failed';
    try {
      await writeManifest(manifest);
    } catch {
      // Preserve the original failure for the caller.
    }
    return manifest;
  } finally {
    networkTracker?.dispose();

    if (client && targetId) {
      try {
        await client.send('Target.closeTarget', { targetId });
      } catch {
        // Browser shutdown will clean up if the target is already gone.
      }
    }

    client?.close();
    await shutdownBrowser(browserProcess, userDataDir);
  }
}

function parseCliArgs(argv) {
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

    throw new Error(`Unknown option: ${current}`);
  }

  return { url, options };
}

function printHelp() {
  const helpText = `Usage:
  node capture.mjs <url> [options]

Options:
  --out-dir <path>         Output root directory
  --browser-path <path>    Explicit Chromium/Chrome executable path
  --timeout <ms>           Overall timeout for CDP operations
  --wait-until <mode>      load | networkidle
  --idle-ms <ms>           Extra delay after readiness before capture
  --full-page              Force full-page screenshot
  --no-full-page           Disable full-page screenshot
  --headless               Run browser headless (default)
  --no-headless            Run browser with a visible window
  --help                   Show this help
`;

  process.stdout.write(helpText);
}

async function runCli() {
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

const isCliEntrypoint = (() => {
  if (!process.argv[1]) {
    return false;
  }
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
})();

if (isCliEntrypoint) {
  await runCli();
}
