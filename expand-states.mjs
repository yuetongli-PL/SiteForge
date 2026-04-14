import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initializeCliUtf8 } from './lib/cli.mjs';
import { classifyJableModelsPath } from './lib/site-path-classifiers.mjs';

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
  initialManifestPath: undefined,
  initialEvidenceDir: undefined,
  outDir: path.resolve(process.cwd(), 'expanded-states'),
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
  maxTriggers: 12,
  searchQueries: [],
  captureChapterArtifacts: false,
};

const SNAPSHOT_STYLES = ['display', 'visibility', 'opacity', 'position', 'z-index'];
const NETWORK_IDLE_QUIET_MS = 500;
const DOM_QUIET_MS = 500;
const DEVTOOLS_POLL_INTERVAL_MS = 100;
const NETWORK_IDLE_POLL_INTERVAL_MS = 100;
const DOCUMENT_READY_POLL_INTERVAL_MS = 100;
const MAX_FALLBACK_BOOKS = 1;
const CHAPTER_CHAIN_LIMIT = 100;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

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
    } catch {
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

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(
    value
      .map((item) => String(item ?? '').trim())
      .filter(Boolean),
  )];
}

function mergeStringArrays(...values) {
  return normalizeStringArray(values.flatMap((value) => normalizeStringArray(value)));
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

function normalizePathname(input) {
  const normalized = normalizeUrlNoFragment(input);
  if (!normalized) {
    return '/';
  }

  try {
    const parsed = new URL(normalized);
    return parsed.pathname || '/';
  } catch {
    return String(normalized || '/');
  }
}

function matchesExactPath(pathname, values = []) {
  const normalizedPath = String(pathname || '/').toLowerCase();
  return values.some((value) => String(value || '').toLowerCase() === normalizedPath);
}

function matchesPathPrefix(pathname, values = []) {
  const normalizedPath = String(pathname || '/').toLowerCase();
  return values.some((value) => {
    const normalizedValue = String(value || '').toLowerCase();
    return normalizedValue && (normalizedPath === normalizedValue || normalizedPath.startsWith(normalizedValue));
  });
}

function inferProfilePageTypeFromPathname(pathname, siteProfile = null) {
  const pageTypes = siteProfile?.pageTypes ?? null;
  if (!pageTypes) {
    return null;
  }

  if (String(siteProfile?.host ?? '').toLowerCase() === 'jable.tv') {
    const modelsPathKind = classifyJableModelsPath(pathname);
    if (modelsPathKind === 'list') {
      return 'author-list-page';
    }
    if (modelsPathKind === 'detail') {
      return 'author-page';
    }
  }

  if (matchesExactPath(pathname, pageTypes.homeExact) || matchesPathPrefix(pathname, pageTypes.homePrefixes)) {
    return 'home';
  }
  if (matchesPathPrefix(pathname, pageTypes.searchResultsPrefixes)) {
    return 'search-results-page';
  }
  if (matchesPathPrefix(pathname, pageTypes.contentDetailPrefixes)) {
    return 'book-detail-page';
  }
  if (matchesPathPrefix(pathname, pageTypes.authorPrefixes)) {
    return 'author-page';
  }
  if (matchesPathPrefix(pathname, pageTypes.chapterPrefixes)) {
    return 'chapter-page';
  }
  if (matchesPathPrefix(pathname, pageTypes.historyPrefixes)) {
    return 'history-page';
  }
  if (matchesPathPrefix(pathname, pageTypes.authPrefixes)) {
    return 'auth-page';
  }
  if (matchesPathPrefix(pathname, pageTypes.categoryPrefixes)) {
    return 'category-page';
  }
  return null;
}

function inferPageTypeFromUrl(input, siteProfile = null) {
  const normalized = normalizeUrlNoFragment(input);
  if (!normalized) {
    return 'unknown-page';
  }

  try {
    const parsed = new URL(normalized);
    const pathname = parsed.pathname || '/';
    const profileType = inferProfilePageTypeFromPathname(pathname, siteProfile);
    if (profileType) {
      return profileType;
    }
    if (pathname === '/' || pathname === '') {
      return 'home';
    }
    if (/\/ss(?:\/|$)/i.test(pathname)) {
      return 'search-results-page';
    }
    if (/\/fenlei\//i.test(pathname)) {
      return 'category-page';
    }
    if (/\/biqu\d+\/?$/i.test(pathname)) {
      return 'book-detail-page';
    }
    if (/\/author\//i.test(pathname)) {
      return 'author-page';
    }
    if (/\/biqu\d+\/\d+(?:_\d+)?\.html$/i.test(pathname)) {
      return 'chapter-page';
    }
    if (/history/i.test(pathname)) {
      return 'history-page';
    }
    if (/login|register|sign-?in|sign-?up/i.test(pathname)) {
      return 'auth-page';
    }
    return 'unknown-page';
  } catch {
    return 'unknown-page';
  }
}

function isJableSiteProfile(siteProfile = null, baseUrl = '') {
  const profileHost = String(siteProfile?.host ?? '').toLowerCase();
  const urlHost = (() => {
    try {
      return new URL(String(baseUrl || '')).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  return profileHost === 'jable.tv' || profileHost === 'www.jable.tv' || urlHost === 'jable.tv' || urlHost === 'www.jable.tv';
}

function resolveNavigationWaitPolicy(settings, siteProfile = null, baseUrl = '') {
  if (isJableSiteProfile(siteProfile, baseUrl)) {
    return {
      useLoadEvent: false,
      useNetworkIdle: false,
      documentReadyTimeoutMs: Math.min(settings.timeoutMs, 8_000),
      domQuietTimeoutMs: Math.min(settings.timeoutMs, 3_000),
      domQuietMs: 150,
      idleMs: Math.min(settings.idleMs, 250),
    };
  }

  return {
    useLoadEvent: true,
    useNetworkIdle: settings.waitUntil === 'networkidle',
    documentReadyTimeoutMs: settings.timeoutMs,
    domQuietTimeoutMs: settings.timeoutMs,
    domQuietMs: DOM_QUIET_MS,
    idleMs: settings.idleMs,
  };
}

function chapterChainBaseUrl(input) {
  const normalized = normalizeUrlNoFragment(input);
  if (!normalized) {
    return null;
  }
  return normalized.replace(/_(\d+)(\.html)$/i, '$2');
}

function isChapterPaginationUrl(currentUrl, nextUrl) {
  const currentBase = chapterChainBaseUrl(currentUrl);
  const nextBase = chapterChainBaseUrl(nextUrl);
  if (!currentBase || !nextBase) {
    return false;
  }
  if (currentBase !== nextBase) {
    return false;
  }
  return normalizeUrlNoFragment(currentUrl) !== normalizeUrlNoFragment(nextUrl);
}

async function loadSiteProfile(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    const hostnames = [parsed.hostname];
    if (parsed.hostname.startsWith('www.')) {
      hostnames.push(parsed.hostname.slice(4));
    } else {
      hostnames.push(`www.${parsed.hostname}`);
    }
    for (const hostname of hostnames) {
      const profilePath = path.join(MODULE_DIR, 'profiles', `${hostname}.json`);
      if (await fileExists(profilePath)) {
        return JSON.parse(await readFile(profilePath, 'utf8'));
      }
    }
    return null;
  } catch {
    return null;
  }
}

function formatTimestampForDir(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1Z');
}

function sanitizeHost(host) {
  return (host || 'unknown-host').replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unknown-host';
}

function slugify(value, fallback = 'state') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || fallback;
}

function emptyFiles() {
  return {
    html: null,
    snapshot: null,
    screenshot: null,
    manifest: null,
    chapterPages: null,
    chapterText: null,
  };
}

function nextStateId(index) {
  return `s${String(index).padStart(4, '0')}`;
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

function hashFingerprint(fingerprint) {
  return createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');
}

function resolveManifestLinkedPath(manifestPath, linkedPath) {
  if (!linkedPath) {
    return linkedPath;
  }
  if (path.isAbsolute(linkedPath)) {
    return linkedPath;
  }
  return path.resolve(path.dirname(manifestPath), linkedPath);
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
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'expand-states-browser-'));
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
    const port = await waitForDevToolsPort(userDataDir, browserProcess, timeoutMs, () => launchError);
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

function formatEvaluationError(result, fallback) {
  return (
    result?.exceptionDetails?.exception?.description ||
    result?.exceptionDetails?.text ||
    fallback ||
    'Page evaluation failed'
  );
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
    throw new Error(formatEvaluationError(result, `Evaluation failed for expression: ${expression}`));
  }

  return result.result?.value;
}

async function callPageFunction(client, sessionId, fn, ...args) {
  const serializedArgs = args.map((arg) => JSON.stringify(arg)).join(', ');
  const expression = `(${fn.toString()})(${serializedArgs})`;
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
    throw new Error(formatEvaluationError(result, `Page function failed: ${fn.name || 'anonymous'}`));
  }

  return result.result?.value;
}

async function waitForDocumentReady(client, sessionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const readyState = await evaluateValue(client, sessionId, 'document.readyState');
      if (readyState === 'interactive' || readyState === 'complete') {
        return readyState;
      }
    } catch {
      // Navigation may still be in progress.
    }
    await delay(DOCUMENT_READY_POLL_INTERVAL_MS);
  }

  throw new Error('Timed out waiting for document ready');
}

async function waitForDomQuiet(client, sessionId, quietMs, timeoutMs) {
  return await callPageFunction(
    client,
    sessionId,
    function pageWaitForDomQuiet(innerQuietMs, innerTimeoutMs) {
      return new Promise((resolve) => {
        const root = document.documentElement || document.body || document;
        const start = performance.now();
        let lastMutationAt = start;
        let settled = false;

        const finish = (reason) => {
          if (settled) {
            return;
          }
          settled = true;
          observer.disconnect();
          clearInterval(interval);
          clearTimeout(timeoutHandle);
          resolve({
            reason,
            elapsedMs: Math.round(performance.now() - start),
          });
        };

        const observer = new MutationObserver(() => {
          lastMutationAt = performance.now();
        });

        observer.observe(root, {
          attributes: true,
          childList: true,
          subtree: true,
          characterData: true,
        });

        const interval = setInterval(() => {
          if (performance.now() - lastMutationAt >= innerQuietMs) {
            finish('quiet');
          }
        }, 50);

        const timeoutHandle = setTimeout(() => {
          finish('timeout');
        }, innerTimeoutMs);
      });
    },
    quietMs,
    timeoutMs,
  );
}

async function navigateAndWaitReady(client, sessionId, url, settings, networkTracker, siteProfile = null) {
  const waitPolicy = resolveNavigationWaitPolicy(settings, siteProfile, url);
  const loadPromise = waitPolicy.useLoadEvent
    ? client.waitForEvent('Page.loadEventFired', {
      sessionId,
      timeoutMs: waitPolicy.documentReadyTimeoutMs,
    })
    : null;

  const navigateResult = await client.send('Page.navigate', { url }, sessionId);
  if (navigateResult.errorText) {
    throw new Error(`Navigation failed: ${navigateResult.errorText}`);
  }

  if (loadPromise) {
    await loadPromise;
  } else {
    await waitForDocumentReady(client, sessionId, waitPolicy.documentReadyTimeoutMs);
    await waitForDomQuiet(client, sessionId, waitPolicy.domQuietMs, waitPolicy.domQuietTimeoutMs);
  }

  if (waitPolicy.useNetworkIdle) {
    await networkTracker.waitForIdle({
      quietMs: NETWORK_IDLE_QUIET_MS,
      timeoutMs: settings.timeoutMs,
    });
  }

  if (waitPolicy.idleMs > 0) {
    await delay(waitPolicy.idleMs);
  }
}

function buildStateFiles(stateDir) {
  return {
    html: path.join(stateDir, 'page.html'),
    snapshot: path.join(stateDir, 'dom-snapshot.json'),
    screenshot: path.join(stateDir, 'screenshot.png'),
    manifest: path.join(stateDir, 'manifest.json'),
    chapterPages: path.join(stateDir, 'chapter-pages.json'),
    chapterText: path.join(stateDir, 'chapter-text.txt'),
  };
}

function pageExtractChapterPayload(siteProfile = null) {
  const profileConfig = {
    contentSelectors: siteProfile?.chapter?.contentSelectors ?? ['#content', '.content', '.reader-main .content'],
    titleSelectors: siteProfile?.chapter?.titleSelectors ?? ['.reader-main .title', 'h1.title', '.content_read h1', 'h1'],
    prevSelectors: [siteProfile?.chapter?.prevSelector, '#prev_url', 'a#prev_url'].filter(Boolean),
    nextSelectors: [siteProfile?.chapter?.nextSelector, '#next_url', 'a#next_url'].filter(Boolean),
  };

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalizeUrlNoFragmentLocal(value) {
    try {
      const parsed = new URL(value, document.baseURI);
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return String(value ?? '').split('#')[0];
    }
  }

  function firstText(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const text = normalizeText(element?.textContent || element?.innerText || '');
      if (text) {
        return text;
      }
    }
    return null;
  }

  function hrefOf(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const href = element?.getAttribute('href');
      if (href) {
        return normalizeUrlNoFragmentLocal(href);
      }
    }
    return null;
  }

  const paragraphSelectors = profileConfig.contentSelectors.map((selector) => `${selector} p`).join(', ');
  const paragraphs = Array.from(document.querySelectorAll(paragraphSelectors))
    .map((node) => normalizeText(node.textContent || node.innerText || ''))
    .filter(Boolean);
  const rawContent = paragraphs.length > 0
    ? paragraphs.join('\n\n')
    : normalizeText(
      profileConfig.contentSelectors
        .map((selector) => document.querySelector(selector))
        .find(Boolean)?.textContent || '',
    );

  const chapterTitle = firstText(profileConfig.titleSelectors);
  const bookTitle = firstText([
    '.crumbs a[href*="/biqu"]',
    '.bread-crumbs a[href*="/biqu"]',
    '.reader-nav a[href*="/biqu"]',
    '#info_url',
  ]);
  const authorName = normalizeText(
    document.querySelector('meta[property="og:novel:author"]')?.getAttribute('content')
    || document.querySelector('meta[name="og:novel:author"]')?.getAttribute('content')
    || '',
  ) || null;
  const previousUrl = hrefOf(profileConfig.prevSelectors);
  const nextUrl = hrefOf(profileConfig.nextSelectors);

  return {
    url: normalizeUrlNoFragmentLocal(location.href),
    pageTitle: document.title || '',
    bookTitle,
    authorName,
    chapterTitle,
    contentText: rawContent,
    contentLength: rawContent.length,
    previousUrl,
    nextUrl,
  };
}

async function captureChapterArtifacts({ client, sessionId, stateDir, currentUrl, settings, siteProfile }) {
  const files = buildStateFiles(stateDir);
  const pages = [];
  const chunks = [];
  const visited = new Set();
  let cursor = normalizeUrlNoFragment(currentUrl);
  let lastPayload = null;

  for (let index = 0; index < CHAPTER_CHAIN_LIMIT && cursor; index += 1) {
    const normalizedCursor = normalizeUrlNoFragment(cursor);
    if (!normalizedCursor || visited.has(normalizedCursor)) {
      break;
    }
    visited.add(normalizedCursor);

    if (index > 0) {
      await navigateAndWaitReady(client, sessionId, normalizedCursor, settings, {
        waitForIdle: async () => undefined,
      }, siteProfile);
    }

    const payload = await callPageFunction(client, sessionId, pageExtractChapterPayload, siteProfile);
    lastPayload = payload;
    pages.push({
      index: index + 1,
      url: payload.url,
      pageTitle: payload.pageTitle,
      chapterTitle: payload.chapterTitle,
      contentLength: payload.contentLength,
    });
    if (payload.contentText) {
      chunks.push(payload.contentText);
    }

    const nextUrl = normalizeUrlNoFragment(payload.nextUrl);
    if (!nextUrl || !isChapterPaginationUrl(normalizedCursor, nextUrl)) {
      break;
    }
    cursor = nextUrl;
  }

  if (pages.length > 0) {
    await writeFile(files.chapterPages, JSON.stringify(pages, null, 2), 'utf8');
  }
  if (chunks.length > 0) {
    await writeFile(files.chapterText, `${chunks.join('\n\n')}\n`, 'utf8');
  }

  return {
    chapterPagesPath: pages.length > 0 ? files.chapterPages : null,
    chapterTextPath: chunks.length > 0 ? files.chapterText : null,
    chapterPayload: lastPayload,
  };
}

async function createExpandOutputLayout(baseUrl, fallbackUrl, outDir) {
  let parsedUrl = null;
  try {
    parsedUrl = new URL(baseUrl || fallbackUrl);
  } catch {
    // Keep a stable output layout for invalid URLs too.
  }

  const generatedAt = new Date().toISOString();
  const dirTimestamp = formatTimestampForDir(new Date(generatedAt));
  const host = sanitizeHost(parsedUrl?.hostname ?? 'invalid-url');
  const rootDir = path.resolve(outDir, `${dirTimestamp}_${host}_expanded`);
  const statesDir = path.join(rootDir, 'states');
  await mkdir(statesDir, { recursive: true });

  return {
    rootDir,
    statesDir,
    generatedAt,
    manifestPath: path.join(rootDir, 'states-manifest.json'),
  };
}

function buildTopLevelManifest(inputUrl, baseUrl, layout) {
  return {
    inputUrl,
    baseUrl,
    generatedAt: layout.generatedAt,
    initialStateId: 's0000',
    outDir: layout.rootDir,
    summary: {
      discoveredTriggers: 0,
      attemptedTriggers: 0,
      capturedStates: 0,
      duplicateStates: 0,
      noopTriggers: 0,
      failedTriggers: 0,
    },
    warnings: [],
    states: [],
  };
}

async function writeTopLevelManifest(manifestPath, manifest) {
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

async function resolveInitialManifest(options) {
  const initialManifestPath = options.initialManifestPath ? path.resolve(options.initialManifestPath) : null;
  const initialEvidenceDir = options.initialEvidenceDir ? path.resolve(options.initialEvidenceDir) : null;

  if (initialManifestPath && initialEvidenceDir) {
    throw new Error('Specify only one of initialManifestPath or initialEvidenceDir');
  }
  if (!initialManifestPath && !initialEvidenceDir) {
    throw new Error('One of initialManifestPath or initialEvidenceDir is required');
  }

  const manifestPath = initialManifestPath ?? path.join(initialEvidenceDir, 'manifest.json');
  if (!(await fileExists(manifestPath))) {
    throw new Error(`Initial manifest not found: ${manifestPath}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    throw new Error(`Failed to parse initial manifest: ${manifestPath}`);
  }

  const requiredStringFields = ['finalUrl', 'capturedAt'];
  for (const field of requiredStringFields) {
    if (typeof manifest[field] !== 'string' || manifest[field].length === 0) {
      throw new Error(`Initial manifest is missing required field: ${field}`);
    }
  }
  if (typeof manifest.title !== 'string') {
    throw new Error('Initial manifest is missing required field: title');
  }
  if (!manifest.files || typeof manifest.files !== 'object') {
    throw new Error('Initial manifest is missing files metadata');
  }

  const normalizedFiles = {
    html: resolveManifestLinkedPath(manifestPath, manifest.files.html),
    snapshot: resolveManifestLinkedPath(manifestPath, manifest.files.snapshot),
    screenshot: resolveManifestLinkedPath(manifestPath, manifest.files.screenshot),
    manifest: manifestPath,
  };

  for (const [name, filePath] of Object.entries(normalizedFiles)) {
    if (!filePath || !(await fileExists(filePath))) {
      throw new Error(`Initial manifest file is missing: ${name}`);
    }
  }

  return {
    sourceManifestPath: manifestPath,
    manifest: {
      ...manifest,
      files: normalizedFiles,
    },
  };
}

async function captureCurrentState({
  client,
  sessionId,
  inputUrl,
  stateId,
  fromState,
  stateName,
  dedupKey,
  trigger,
  stateDir,
  pageMetadata,
  settings,
  siteProfile,
}) {
  const files = buildStateFiles(stateDir);
  const capturedAt = new Date().toISOString();
  let hardFailure = null;
  let warning = null;
  let pageFacts = pageMetadata.pageFacts ?? null;

  await mkdir(stateDir, { recursive: true });

  try {
    const html = await evaluateValue(client, sessionId, 'document.documentElement.outerHTML');
    await writeFile(files.html, html ?? '', 'utf8');
  } catch (error) {
    hardFailure = createError('HTML_CAPTURE_FAILED', error.message);
  }

  if (!hardFailure) {
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
      await writeFile(files.snapshot, JSON.stringify(snapshot, null, 2), 'utf8');
    } catch (error) {
      hardFailure = createError('SNAPSHOT_CAPTURE_FAILED', error.message);
    }
  }

  if (!hardFailure) {
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
      await writeFile(files.screenshot, Buffer.from(screenshot.data, 'base64'));
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
          await writeFile(files.screenshot, Buffer.from(fallback.data, 'base64'));
          warning = createError(
            'SCREENSHOT_FALLBACK',
            `Full-page screenshot failed and viewport screenshot was used instead: ${error.message}`,
          );
        } catch (fallbackError) {
          hardFailure = createError('SCREENSHOT_CAPTURE_FAILED', fallbackError.message);
        }
      } else {
        hardFailure = createError('SCREENSHOT_CAPTURE_FAILED', error.message);
      }
    }
  }

  if (!hardFailure && settings.captureChapterArtifacts && pageMetadata.pageType === 'chapter-page') {
    try {
      const chapterArtifacts = await captureChapterArtifacts({
        client,
        sessionId,
        stateDir,
        currentUrl: pageMetadata.finalUrl,
        settings,
        siteProfile,
      });
      files.chapterPages = chapterArtifacts.chapterPagesPath;
      files.chapterText = chapterArtifacts.chapterTextPath;
      if (chapterArtifacts.chapterPayload) {
        pageFacts = {
          ...(pageFacts ?? {}),
          bookTitle: chapterArtifacts.chapterPayload.bookTitle ?? pageFacts?.bookTitle ?? null,
          authorName: chapterArtifacts.chapterPayload.authorName ?? pageFacts?.authorName ?? null,
          chapterTitle: chapterArtifacts.chapterPayload.chapterTitle ?? pageFacts?.chapterTitle ?? null,
          chapterHref: chapterArtifacts.chapterPayload.url ?? pageMetadata.finalUrl,
          bodyTextLength: chapterArtifacts.chapterPayload.contentLength ?? pageFacts?.bodyTextLength ?? null,
          bodyExcerpt: chapterArtifacts.chapterPayload.contentText
            ? chapterArtifacts.chapterPayload.contentText.slice(0, 160)
            : pageFacts?.bodyExcerpt ?? null,
          prevChapterUrl: chapterArtifacts.chapterPayload.previousUrl ?? pageFacts?.prevChapterUrl ?? null,
          nextChapterUrl: chapterArtifacts.chapterPayload.nextUrl ?? pageFacts?.nextChapterUrl ?? null,
        };
      }
    } catch (error) {
      warning = warning ?? createError('CHAPTER_ARTIFACTS_FAILED', error.message);
    }
  }

  const manifest = {
    state_id: stateId,
    from_state: fromState,
    state_name: stateName,
    dedup_key: dedupKey,
    trigger,
    inputUrl,
    finalUrl: pageMetadata.finalUrl,
    title: pageMetadata.title,
    capturedAt,
    status: hardFailure ? 'failed' : 'captured',
    outDir: stateDir,
    files,
    page: {
      viewportWidth: pageMetadata.viewportWidth,
      viewportHeight: pageMetadata.viewportHeight,
    },
    pageFacts,
    error: hardFailure ?? warning,
  };

  await writeFile(files.manifest, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

async function copyInitialState(initialManifest, layout, dedupKey) {
  const stateId = 's0000';
  const stateDir = path.join(layout.statesDir, `${stateId}_initial`);
  const files = buildStateFiles(stateDir);

  await mkdir(stateDir, { recursive: true });
  await copyFile(initialManifest.files.html, files.html);
  await copyFile(initialManifest.files.snapshot, files.snapshot);
  await copyFile(initialManifest.files.screenshot, files.screenshot);

  const manifest = {
    state_id: stateId,
    from_state: null,
    state_name: 'Initial State',
    dedup_key: dedupKey,
    trigger: null,
    inputUrl: initialManifest.inputUrl,
    finalUrl: initialManifest.finalUrl,
    title: initialManifest.title,
    capturedAt: initialManifest.capturedAt,
    status: 'initial',
    outDir: stateDir,
    files,
    page: {
      viewportWidth: initialManifest.page?.viewportWidth ?? null,
      viewportHeight: initialManifest.page?.viewportHeight ?? null,
    },
    pageFacts: initialManifest.pageFacts ?? null,
    error: null,
    source_manifest_path: initialManifest.files.manifest,
  };

  await writeFile(files.manifest, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

function topLevelStateEntryFromManifest(manifest) {
  return {
    state_id: manifest.state_id,
    from_state: manifest.from_state,
    state_name: manifest.state_name,
    dedup_key: manifest.dedup_key,
    trigger: manifest.trigger,
    finalUrl: manifest.finalUrl,
    title: manifest.title,
    capturedAt: manifest.capturedAt,
    status: manifest.status,
    duplicate_of: null,
    files: manifest.files,
    pageFacts: manifest.pageFacts ?? null,
    error: manifest.error,
  };
}

function createStateIndexEntry({
  stateId,
  fromState,
  stateName,
  dedupKey,
  trigger,
  finalUrl,
  title,
  capturedAt,
  status,
  duplicateOf = null,
  files = emptyFiles(),
  pageFacts = null,
  error = null,
}) {
  return {
    state_id: stateId,
    from_state: fromState,
    state_name: stateName,
    dedup_key: dedupKey,
    trigger,
    finalUrl,
    title,
    capturedAt,
    status,
    duplicate_of: duplicateOf,
    files,
    pageFacts,
    error,
  };
}

function buildStateName(trigger) {
  const label = trigger?.label || 'Unknown';
  switch (trigger?.kind) {
    case 'details-toggle':
      return `Details Toggle: ${label}`;
    case 'expanded-toggle':
      return `Expanded Toggle: ${label}`;
    case 'tab':
      return `Tab: ${label}`;
    case 'menu-button':
      return `Menu Button: ${label}`;
    case 'dialog-open':
      return `Dialog Open: ${label}`;
    case 'safe-nav-link':
      switch (trigger?.semanticRole) {
        case 'home':
          return `Home Link: ${label}`;
        case 'category':
          return `Category Link: ${label}`;
        case 'author':
          return `Author Link: ${label}`;
        default:
          return `Safe Nav Link: ${label}`;
      }
    case 'content-link':
      return `Content Link: ${label}`;
    case 'auth-link':
      return `Auth Link: ${label}`;
    case 'pagination-link':
      return `Pagination Link: ${label}`;
    case 'form-submit':
      return `Form Submit: ${label}`;
    case 'search-form':
      return `Search: ${label}`;
    case 'chapter-link':
      return `Chapter: ${label}`;
    default:
      return `State: ${label}`;
  }
}

function summarizeForStdout(manifest) {
  return {
    initialStateId: manifest.initialStateId,
    discoveredTriggers: manifest.summary.discoveredTriggers,
    capturedStates: manifest.summary.capturedStates,
    duplicateStates: manifest.summary.duplicateStates,
    noopTriggers: manifest.summary.noopTriggers,
    failedTriggers: manifest.summary.failedTriggers,
    outDir: manifest.outDir,
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
  if (merged.initialManifestPath) {
    merged.initialManifestPath = path.resolve(merged.initialManifestPath);
  }
  if (merged.initialEvidenceDir) {
    merged.initialEvidenceDir = path.resolve(merged.initialEvidenceDir);
  }
  merged.timeoutMs = normalizeNumber(merged.timeoutMs, 'timeoutMs');
  merged.idleMs = normalizeNumber(merged.idleMs, 'idleMs');
  merged.headless = normalizeBoolean(merged.headless, 'headless');
  merged.fullPage = normalizeBoolean(merged.fullPage, 'fullPage');
  merged.waitUntil = normalizeWaitUntil(merged.waitUntil);
  merged.maxTriggers = Math.max(0, Math.floor(normalizeNumber(merged.maxTriggers, 'maxTriggers')));
  merged.searchQueries = normalizeStringArray(merged.searchQueries);
  merged.viewport = {
    width: normalizeNumber(merged.viewport.width, 'viewport.width'),
    height: normalizeNumber(merged.viewport.height, 'viewport.height'),
    deviceScaleFactor: normalizeNumber(merged.viewport.deviceScaleFactor, 'viewport.deviceScaleFactor'),
  };

  return merged;
}

function pageDiscoverTriggers(maxTriggers, searchQueries = [], siteProfile = null) {
  const profileConfig = {
    pageTypes: siteProfile?.pageTypes ?? {},
    searchFormSelectors: siteProfile?.search?.formSelectors ?? ['form[name="t_frmsearch"]', 'form[action*="/ss/"]', 'form[role="search"]'],
    searchInputSelectors: siteProfile?.search?.inputSelectors ?? ['#searchkey', 'input[name="searchkey"]', 'input[type="search"]'],
    searchSubmitSelectors: siteProfile?.search?.submitSelectors ?? ['#search_btn', 'button[type="submit"]', 'input[type="submit"]'],
    searchQueryParamNames: Array.isArray(siteProfile?.search?.queryParamNames) ? siteProfile.search.queryParamNames : ['searchkey', 'keyword', 'q'],
    knownQueries: Array.isArray(siteProfile?.search?.knownQueries) ? siteProfile.search.knownQueries : [],
    chapterLinkSelectors: siteProfile?.bookDetail?.chapterLinkSelectors ?? ['#list a[href]', '.listmain a[href]', 'dd a[href]', '.book_last a[href]'],
    authorMetaNames: siteProfile?.bookDetail?.authorMetaNames ?? ['og:novel:author'],
    authorLinkMetaNames: siteProfile?.bookDetail?.authorLinkMetaNames ?? ['og:novel:author_link'],
    latestChapterMetaNames: siteProfile?.bookDetail?.latestChapterMetaNames ?? ['og:novel:lastest_chapter_url'],
    detailTitleSelectors: Array.isArray(siteProfile?.contentDetail?.titleSelectors) ? siteProfile.contentDetail.titleSelectors : ['h1', '.book h1', '#bookinfo h1'],
    detailAuthorNameSelectors: Array.isArray(siteProfile?.contentDetail?.authorNameSelectors) ? siteProfile.contentDetail.authorNameSelectors : ['a[href*="/author/"]', '.small span a'],
    detailAuthorLinkSelectors: Array.isArray(siteProfile?.contentDetail?.authorLinkSelectors) ? siteProfile.contentDetail.authorLinkSelectors : ['a[href*="/author/"]'],
    contentPathPrefixes: Array.isArray(siteProfile?.navigation?.contentPathPrefixes) ? siteProfile.navigation.contentPathPrefixes : [],
    authorPathPrefixes: Array.isArray(siteProfile?.navigation?.authorPathPrefixes) ? siteProfile.navigation.authorPathPrefixes : [],
    categoryPathPrefixes: Array.isArray(siteProfile?.navigation?.categoryPathPrefixes) ? siteProfile.navigation.categoryPathPrefixes : [],
    utilityPathPrefixes: Array.isArray(siteProfile?.navigation?.utilityPathPrefixes) ? siteProfile.navigation.utilityPathPrefixes : [],
    authPathPrefixes: Array.isArray(siteProfile?.navigation?.authPathPrefixes) ? siteProfile.navigation.authPathPrefixes : [],
    categoryLabelKeywords: Array.isArray(siteProfile?.navigation?.categoryLabelKeywords) ? siteProfile.navigation.categoryLabelKeywords : [],
    allowedHosts: Array.isArray(siteProfile?.navigation?.allowedHosts) ? siteProfile.navigation.allowedHosts : [],
    defaultQueries: Array.isArray(siteProfile?.search?.defaultQueries) ? siteProfile.search.defaultQueries : [],
    searchResultContentLimit: Number.isFinite(Number(siteProfile?.sampling?.searchResultContentLimit))
      ? Math.max(1, Math.floor(Number(siteProfile.sampling.searchResultContentLimit)))
      : 1,
    authorContentLimit: Number.isFinite(Number(siteProfile?.sampling?.authorContentLimit))
      ? Math.max(1, Math.floor(Number(siteProfile.sampling.authorContentLimit)))
      : 4,
    categoryContentLimit: Number.isFinite(Number(siteProfile?.sampling?.categoryContentLimit))
      ? Math.max(1, Math.floor(Number(siteProfile.sampling.categoryContentLimit)))
      : 4,
    fallbackContentLimitWithSearch: Number.isFinite(Number(siteProfile?.sampling?.fallbackContentLimitWithSearch))
      ? Math.max(1, Math.floor(Number(siteProfile.sampling.fallbackContentLimitWithSearch)))
      : MAX_FALLBACK_BOOKS,
  };
  const PRIORITY = {
    'search-form': 0,
    'details-toggle': 0,
    'expanded-toggle': 1,
    tab: 2,
    'menu-button': 3,
    'dialog-open': 3,
    'safe-nav-link': 4,
    'content-link': 5,
    'chapter-link': 5,
    'auth-link': 6,
    'pagination-link': 7,
    'form-submit': 8,
  };
  const SEMANTIC_PRIORITY = {
    home: 0,
    history: 1,
    category: 2,
    utility: 3,
    author: 4,
    unknown: 9,
  };
  const KIND_QUOTA = {
    'search-form': Math.max(searchQueries.length, 1),
    'details-toggle': maxTriggers,
    'expanded-toggle': maxTriggers,
    tab: maxTriggers,
    'menu-button': maxTriggers,
    'dialog-open': maxTriggers,
    'safe-nav-link': 6,
    'content-link': 4,
    'chapter-link': maxTriggers,
    'auth-link': 2,
    'pagination-link': 2,
    'form-submit': 2,
  };
  const RISK_WORDS = ['delete', 'remove', 'logout', 'sign out', 'purchase', 'pay', 'submit'];
  const AUTH_WORDS = ['login', 'log in', 'sign in', 'register', 'sign up', '授权', '登录', '注册'];
  const CATEGORY_WORDS = ['分类', '小说', '栏目', '玄幻', '武侠', '都市', '历史', '科幻', '游戏', '女生', '完本'];
  const HISTORY_WORDS = ['history', '阅读记录', '最近阅读'];

  function classifyJableModelsPathLocal(pathname) {
    const normalized = String(pathname || '/').trim().toLowerCase() || '/';
    if (normalized === '/models' || normalized === '/models/') {
      return 'list';
    }
    if (!normalized.startsWith('/models/')) {
      return null;
    }
    const remainder = normalized.slice('/models/'.length).replace(/^\/+|\/+$/g, '');
    if (!remainder) {
      return 'list';
    }
    const [firstSegment] = remainder.split('/');
    if (!firstSegment) {
      return 'list';
    }
    if (/^\d+$/u.test(firstSegment)) {
      return 'list';
    }
    return 'detail';
  }

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalizeUrlLike(value) {
    if (!value) {
      return null;
    }
    try {
      return new URL(value, document.baseURI).toString();
    } catch {
      return String(value);
    }
  }

  function textFromSelectors(selectors) {
    for (const selector of selectors || []) {
      try {
        const node = document.querySelector(selector);
        const text = normalizeText(node?.textContent || node?.innerText || '');
        if (text) {
          return text;
        }
      } catch {
        // Ignore invalid selectors from site profile.
      }
    }
    return null;
  }

  function hrefFromSelectors(selectors) {
    for (const selector of selectors || []) {
      try {
        const node = document.querySelector(selector);
        const href = node?.getAttribute?.('href');
        if (href) {
          return normalizeUrlLike(href);
        }
      } catch {
        // Ignore invalid selectors from site profile.
      }
    }
    return null;
  }

  function pathnameMatchesExact(pathname, values) {
    const normalizedPath = String(pathname || '/').toLowerCase();
    return (values || []).some((value) => String(value || '').toLowerCase() === normalizedPath);
  }

  function pathnameMatchesPrefix(pathname, values) {
    const normalizedPath = String(pathname || '/').toLowerCase();
    return (values || []).some((value) => {
      const normalizedValue = String(value || '').toLowerCase();
      return normalizedValue && (normalizedPath === normalizedValue || normalizedPath.startsWith(normalizedValue));
    });
  }

  function currentPathname() {
    try {
      const parsed = new URL(location.href, document.baseURI);
      return parsed.pathname || '/';
    } catch {
      return location.pathname || '/';
    }
  }

  function inferProfilePageType(pathname) {
    if (String(siteProfile?.host ?? '').toLowerCase() === 'jable.tv') {
      const modelsPathKind = classifyJableModelsPathLocal(pathname);
      if (modelsPathKind === 'list') {
        return 'author-list-page';
      }
      if (modelsPathKind === 'detail') {
        return 'author-page';
      }
    }
    if (pathnameMatchesExact(pathname, profileConfig.pageTypes.homeExact) || pathnameMatchesPrefix(pathname, profileConfig.pageTypes.homePrefixes)) {
      return 'home';
    }
    if (pathnameMatchesPrefix(pathname, profileConfig.pageTypes.searchResultsPrefixes)) {
      return 'search-results-page';
    }
    if (pathnameMatchesPrefix(pathname, profileConfig.pageTypes.contentDetailPrefixes)) {
      return 'book-detail-page';
    }
    if (pathnameMatchesPrefix(pathname, profileConfig.pageTypes.authorPrefixes)) {
      return 'author-page';
    }
    if (pathnameMatchesPrefix(pathname, profileConfig.pageTypes.chapterPrefixes)) {
      return 'chapter-page';
    }
    if (pathnameMatchesPrefix(pathname, profileConfig.pageTypes.historyPrefixes)) {
      return 'history-page';
    }
    if (pathnameMatchesPrefix(pathname, profileConfig.pageTypes.authPrefixes)) {
      return 'auth-page';
    }
    if (pathnameMatchesPrefix(pathname, profileConfig.pageTypes.categoryPrefixes)) {
      return 'category-page';
    }
    return null;
  }

  function currentPageType() {
    const pathname = currentPathname();
    const profilePageType = inferProfilePageType(pathname);
    if (profilePageType) {
      return profilePageType;
    }
    if (pathname === '/' || pathname === '') {
      return 'home';
    }
    if (/\/ss(?:\/|$)/i.test(pathname)) {
      return 'search-results-page';
    }
    if (/\/fenlei\//i.test(pathname)) {
      return 'category-page';
    }
    if (/\/biqu\d+\/?$/i.test(pathname)) {
      return 'book-detail-page';
    }
    if (/\/author\//i.test(pathname)) {
      return 'author-page';
    }
    if (/\/biqu\d+\/\d+(?:_\d+)?\.html$/i.test(pathname)) {
      return 'chapter-page';
    }
    if (/history/i.test(pathname)) {
      return 'history-page';
    }
    if (/login|register|sign-?in|sign-?up/i.test(pathname)) {
      return 'auth-page';
    }
    return 'unknown-page';
  }

  function getLabel(element) {
    const ariaLabel = normalizeText(element.getAttribute('aria-label'));
    if (ariaLabel) {
      return ariaLabel;
    }

    const labelledBy = normalizeText(element.getAttribute('aria-labelledby'));
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => normalizeText(node.textContent || node.innerText || ''))
        .filter(Boolean);
      if (parts.length > 0) {
        return normalizeText(parts.join(' '));
      }
    }

    const title = normalizeText(element.getAttribute('title'));
    if (title) {
      return title;
    }

    const alt = normalizeText(element.getAttribute('alt'));
    if (alt) {
      return alt;
    }

    const text = normalizeText(element.innerText || element.textContent || '');
    if (text) {
      return text.slice(0, 80);
    }

    return normalizeText(element.id || element.getAttribute('name') || element.tagName.toLowerCase());
  }

  function getRole(element) {
    const explicit = normalizeText(element.getAttribute('role'));
    if (explicit) {
      return explicit.toLowerCase();
    }
    const tag = element.tagName.toLowerCase();
    if (tag === 'button') {
      return 'button';
    }
    if (tag === 'summary') {
      return 'button';
    }
    if (tag === 'a' && element.hasAttribute('href')) {
      return 'link';
    }
    return '';
  }

  function isHidden(element) {
    if (!element || !element.isConnected) {
      return true;
    }
    if (element.hidden || element.closest('[hidden], [inert]')) {
      return true;
    }
    if (element.getAttribute('aria-hidden') === 'true') {
      return true;
    }
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      return true;
    }
    const rect = element.getBoundingClientRect();
    return rect.width <= 0 || rect.height <= 0;
  }

  function isInteractable(element) {
    if (isHidden(element)) {
      return false;
    }
    if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.pointerEvents === 'none') {
      return false;
    }
    return true;
  }

  function isNavigationalAnchor(element) {
    if (element.tagName.toLowerCase() !== 'a') {
      return false;
    }
    const href = normalizeText(element.getAttribute('href'));
    if (!href) {
      return false;
    }
    if (href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) {
      return false;
    }
    if (getRole(element) === 'tab') {
      return false;
    }
    return true;
  }

  function hrefPathInfo(element) {
    const href = normalizeText(element.getAttribute('href'));
    if (!href) {
      return {
        href: null,
        normalizedHref: null,
        pathname: '',
      };
    }

    try {
      const parsed = new URL(href, document.baseURI);
      return {
        href,
        normalizedHref: parsed.toString(),
        pathname: parsed.pathname || '/',
        hostname: parsed.hostname || '',
      };
    } catch {
      return {
        href,
        normalizedHref: href,
        pathname: href,
        hostname: '',
      };
    }
  }

  function isAllowedHost(hostname) {
    const normalizedHost = String(hostname || '').toLowerCase();
    if (!normalizedHost) {
      return false;
    }
    const currentHost = String(location.hostname || '').toLowerCase();
    if (normalizedHost === currentHost) {
      return true;
    }
    if (normalizedHost === currentHost.replace(/^www\./, '') || `www.${normalizedHost}` === currentHost) {
      return true;
    }
    return profileConfig.allowedHosts.some((value) => String(value || '').toLowerCase() === normalizedHost);
  }

  function isFormSubmit(element) {
    const tag = element.tagName.toLowerCase();
    if (tag === 'button') {
      const type = normalizeText(element.getAttribute('type')).toLowerCase();
      return type === 'submit';
    }
    if (tag === 'input') {
      const type = normalizeText(element.getAttribute('type')).toLowerCase();
      return type === 'submit' || type === 'image';
    }
    return false;
  }

  function isFileUpload(element) {
    if (element.tagName.toLowerCase() === 'input') {
      return normalizeText(element.getAttribute('type')).toLowerCase() === 'file';
    }
    return false;
  }

  function isDownloadLike(element) {
    return element.tagName.toLowerCase() === 'a' && element.hasAttribute('download');
  }

  function isMediaControl(element) {
    return Boolean(element.closest('audio, video'));
  }

  function hasRiskText(label) {
    const lower = label.toLowerCase();
    return RISK_WORDS.some((word) => lower.includes(word));
  }

  function isAuthCandidate(label, hrefInfo) {
    const lowerLabel = label.toLowerCase();
    const lowerHref = String(hrefInfo.pathname || hrefInfo.normalizedHref || '').toLowerCase();
    if (pathnameMatchesPrefix(lowerHref, profileConfig.authPathPrefixes)) {
      return true;
    }
    return AUTH_WORDS.some((word) => lowerLabel.includes(word) || lowerHref.includes(word));
  }

  function isPaginationCandidate(label, hrefInfo, element) {
    const lowerLabel = label.toLowerCase();
    const lowerHref = String(hrefInfo.pathname || hrefInfo.normalizedHref || '').toLowerCase();
    if (element.getAttribute('rel') === 'next' || element.getAttribute('rel') === 'prev') {
      return true;
    }
    if (/^(?:\d+|next|prev|previous|上一页|下一页|上一章|下一章)$/i.test(lowerLabel)) {
      return true;
    }
    return /page|p=|_2\.html|_3\.html|下一页|上一页/i.test(lowerHref);
  }

  function semanticRoleForSafeNav(label, hrefInfo) {
    const lowerLabel = label.toLowerCase();
    const lowerHref = String(hrefInfo.pathname || hrefInfo.normalizedHref || '').toLowerCase();

    if (isJableSite) {
      const modelsPathKind = classifyJableModelsPathLocal(lowerHref);
      if (modelsPathKind === 'list') {
        return 'category';
      }
      if (modelsPathKind === 'detail') {
        return 'author';
      }
    }

    if (
      lowerHref === '/'
      || lowerHref === ''
      || lowerLabel === '首页'
      || pathnameMatchesExact(lowerHref, profileConfig.pageTypes.homeExact)
      || pathnameMatchesPrefix(lowerHref, profileConfig.pageTypes.homePrefixes)
    ) {
      return 'home';
    }
    if (HISTORY_WORDS.some((word) => lowerLabel.includes(word) || lowerHref.includes(word))) {
      return 'history';
    }
    if (pathnameMatchesPrefix(lowerHref, profileConfig.authorPathPrefixes) || lowerHref.includes('/author/')) {
      return 'author';
    }
    if (
      pathnameMatchesPrefix(lowerHref, profileConfig.categoryPathPrefixes)
      || lowerHref.includes('/fenlei/')
      || CATEGORY_WORDS.some((word) => lowerLabel.includes(word))
      || profileConfig.categoryLabelKeywords.some((word) => lowerLabel.includes(String(word).toLowerCase()))
    ) {
      return 'category';
    }
    if (pathnameMatchesPrefix(lowerHref, profileConfig.utilityPathPrefixes)) {
      return 'utility';
    }
    return 'utility';
  }

  function isContentCandidate(label, hrefInfo) {
    const lowerHref = String(hrefInfo.pathname || hrefInfo.normalizedHref || '').toLowerCase();
    if (pathnameMatchesPrefix(lowerHref, profileConfig.contentPathPrefixes)) {
      return true;
    }
    if (/\/biqu\d+\/?$/i.test(lowerHref)) {
      return true;
    }
    return /book|novel|article|detail/i.test(lowerHref) && label.length >= 2;
  }

  function isChapterCandidate(hrefInfo) {
    const lowerHref = String(hrefInfo.pathname || hrefInfo.normalizedHref || '').toLowerCase();
    return /\/biqu\d+\/\d+\.html$/i.test(lowerHref);
  }

  function metaContentByNames(names) {
    for (const name of names) {
      const selector = `meta[property="${name}"], meta[name="${name}"]`;
      const meta = document.querySelector(selector);
      const content = normalizeText(meta?.getAttribute('content') || '');
      if (content) {
        return content;
      }
    }
    return null;
  }

  function buildDomPath(element) {
    const segments = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body && segments.length < 8) {
      const tagName = current.tagName.toLowerCase();
      let index = 1;
      let sibling = current;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName.toLowerCase() === tagName) {
          index += 1;
        }
      }
      segments.unshift(`${tagName}:nth-of-type(${index})`);
      current = current.parentElement;
    }
    return segments.join(' > ');
  }

  function buildLocator(element, label, role) {
    const ariaControls = normalizeText(element.getAttribute('aria-controls'));
    const hrefInfo = hrefPathInfo(element);
    return {
      primary: element.id ? 'id' : ariaControls ? 'aria-controls' : role && label ? 'role-label' : 'dom-path',
      id: element.id || null,
      ariaControls: ariaControls || null,
      role: role || null,
      label,
      tagName: element.tagName.toLowerCase(),
      href: hrefInfo.normalizedHref || null,
      textSnippet: normalizeText(element.innerText || element.textContent || '').slice(0, 80) || null,
      domPath: buildDomPath(element),
    };
  }

  function labelQuality(label, locator) {
    const normalizedLabel = normalizeText(label).toLowerCase();
    const textSnippet = normalizeText(locator?.textSnippet || '');
    let score = 0;
    if (normalizedLabel && !['a', 'link', 'button'].includes(normalizedLabel)) {
      score += Math.min(normalizedLabel.length, 24);
    }
    if (textSnippet && textSnippet !== normalizedLabel) {
      score += Math.min(textSnippet.length, 16);
    }
    if (locator?.href) {
      score += 4;
    }
    if (normalizedLabel === 'a') {
      score -= 12;
    }
    return score;
  }

  function getControlledIds(value) {
    return normalizeText(value).split(/\s+/).filter(Boolean);
  }

  function targetIsHidden(controlledTarget) {
    const ids = getControlledIds(controlledTarget);
    if (ids.length === 0) {
      return false;
    }
    return ids.some((id) => {
      const target = document.getElementById(id);
      return !target || isHidden(target);
    });
  }

  function findSearchForm() {
    const form = profileConfig.searchFormSelectors
      .map((selector) => {
        try {
          return document.querySelector(selector);
        } catch {
          return null;
        }
      })
      .find(Boolean);
    const input = profileConfig.searchInputSelectors
      .map((selector) => {
        try {
          return document.querySelector(selector);
        } catch {
          return null;
        }
      })
      .find(Boolean);
    const resolvedForm = form instanceof HTMLFormElement ? form : input?.form ?? null;
    const submit = profileConfig.searchSubmitSelectors
      .map((selector) => {
        try {
          return (resolvedForm || document).querySelector(selector);
        } catch {
          return null;
        }
      })
      .find(Boolean);
    if (!resolvedForm && !input) {
      return null;
    }
    return {
      form: resolvedForm,
      input: input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input : null,
      submit: submit instanceof Element ? submit : null,
    };
  }

  const candidates = [];
  const seen = new Map();

  function buildRecord(kind, label, locator, controlledTarget, extra = {}) {
    return {
      kind,
      label,
      locator,
      controlledTarget: controlledTarget || locator.ariaControls || null,
      href: locator.href ?? null,
      queryText: extra.queryText ?? null,
      semanticRole: extra.semanticRole || 'unknown',
      ordinal: candidates.length + 1,
      _priority: PRIORITY[kind] ?? 99,
      _semanticPriority: SEMANTIC_PRIORITY[extra.semanticRole || 'unknown'] ?? 99,
      _labelQuality: labelQuality(label, locator),
    };
  }

  function upsertCandidate(record) {
    const dedupe = JSON.stringify([
      record.kind,
      record.locator?.id || null,
      record.locator?.ariaControls || null,
      record.href || null,
      record.queryText || null,
      !record.kind.endsWith('link') ? record.label : null,
      !record.kind.endsWith('link') ? record.locator?.domPath : null,
    ]);
    const existingIndex = seen.get(dedupe);
    if (existingIndex !== undefined) {
      const existing = candidates[existingIndex];
      if ((existing?._labelQuality ?? 0) >= record._labelQuality) {
        return;
      }
      candidates[existingIndex] = record;
      return;
    }
    seen.set(dedupe, candidates.length);
    candidates.push(record);
  }

  function addCandidate(element, kind, controlledTarget, extra = {}) {
    if (!(element instanceof Element)) {
      return;
    }
    if (!isInteractable(element)) {
      return;
    }

    const label = getLabel(element);
    if (!label || hasRiskText(label)) {
      return;
    }
    const navigationalAnchor = isNavigationalAnchor(element);
    const formSubmit = isFormSubmit(element);
    if ((!extra.allowNavigation && navigationalAnchor) || (!extra.allowSubmit && formSubmit) || isFileUpload(element) || isDownloadLike(element) || isMediaControl(element)) {
      return;
    }

    const role = getRole(element);
    upsertCandidate(buildRecord(kind, label, buildLocator(element, label, role), controlledTarget, extra));
  }

  function addSyntheticCandidate(kind, label, href, extra = {}) {
    if (!label && !href) {
      return;
    }
    const locator = {
      primary: extra.primary || 'href-direct',
      id: extra.id ?? null,
      ariaControls: extra.ariaControls ?? null,
      role: extra.role ?? null,
      label: label || extra.label || null,
      tagName: extra.tagName ?? 'a',
      href: href ? normalizeUrlLike(href) : null,
      textSnippet: extra.textSnippet ?? null,
      domPath: extra.domPath ?? null,
      inputName: extra.inputName ?? null,
      formAction: extra.formAction ? normalizeUrlLike(extra.formAction) : null,
      submitSelector: extra.submitSelector ?? null,
    };
    upsertCandidate(buildRecord(kind, label || href || kind, locator, extra.controlledTarget ?? null, extra));
  }

  const pageType = currentPageType();
  const isJableSite = String(siteProfile?.host ?? '').toLowerCase() === 'jable.tv';

  function shouldKeepCandidateForCurrentPage(candidate) {
    if (!isJableSite) {
      return true;
    }

    if (candidate.kind === 'search-form') {
      return true;
    }

    if (pageType === 'book-detail-page') {
      if (candidate.kind === 'safe-nav-link' && candidate.semanticRole === 'author') {
        return true;
      }
      if (candidate.kind === 'content-link' && candidate.semanticRole === 'content') {
        return false;
      }
      if (candidate.kind === 'safe-nav-link' && candidate.semanticRole === 'category') {
        return false;
      }
    }

    if (pageType === 'author-page') {
      return candidate.kind === 'content-link' || candidate.kind === 'pagination-link';
    }

    if (pageType === 'author-list-page') {
      if (candidate.kind === 'safe-nav-link') {
        return candidate.semanticRole === 'author' || candidate.semanticRole === 'category';
      }
      return candidate.kind === 'pagination-link';
    }

    if (pageType === 'search-results-page' || pageType === 'category-page' || pageType === 'home') {
      if (candidate.kind === 'content-link' || candidate.kind === 'pagination-link') {
        return true;
      }
      if (candidate.kind === 'safe-nav-link') {
        return candidate.semanticRole === 'category' || candidate.semanticRole === 'utility' || candidate.semanticRole === 'home';
      }
      return false;
    }

    return true;
  }

  function quotaForCandidate(candidate) {
    if (!isJableSite) {
      return KIND_QUOTA[candidate.kind] ?? maxTriggers;
    }

    if (pageType === 'book-detail-page') {
      if (candidate.kind === 'safe-nav-link' && candidate.semanticRole === 'author') {
        return 2;
      }
      if (candidate.kind === 'chapter-link') {
        return 0;
      }
      return 0;
    }

    if (pageType === 'author-page') {
      if (candidate.kind === 'content-link') {
        return 4;
      }
      if (candidate.kind === 'pagination-link') {
        return 1;
      }
      return 0;
    }

    if (pageType === 'author-list-page') {
      if (candidate.kind === 'safe-nav-link' && candidate.semanticRole === 'author') {
        return 4;
      }
      if (candidate.kind === 'safe-nav-link' && candidate.semanticRole === 'category') {
        return 1;
      }
      if (candidate.kind === 'pagination-link') {
        return 1;
      }
      return 0;
    }

    if (pageType === 'search-results-page' || pageType === 'category-page' || pageType === 'home') {
      if (candidate.kind === 'content-link') {
        return 4;
      }
      if (candidate.kind === 'pagination-link') {
        return 1;
      }
      if (candidate.kind === 'safe-nav-link') {
        return 2;
      }
      return KIND_QUOTA[candidate.kind] ?? maxTriggers;
    }

    return KIND_QUOTA[candidate.kind] ?? maxTriggers;
  }

  if (searchQueries.length > 0) {
    const searchForm = findSearchForm();
    if (searchForm?.input || searchForm?.form) {
      const baseLabel = getLabel(searchForm.submit || searchForm.input || searchForm.form) || 'Search';
      for (const queryText of searchQueries) {
        addSyntheticCandidate('search-form', `${baseLabel}: ${queryText}`, searchForm.form?.action || location.href, {
          semanticRole: 'search',
          queryText,
          primary: 'search-form',
          id: searchForm.input?.id || searchForm.form?.id || null,
          inputName: searchForm.input?.getAttribute('name') || 'searchkey',
          formAction: searchForm.form?.action || location.href,
          submitSelector: searchForm.submit?.id ? `#${searchForm.submit.id}` : null,
          domPath: buildDomPath(searchForm.input || searchForm.form),
          tagName: 'form',
        });
      }
    }

    for (const queryText of searchQueries) {
      const normalizedQuery = normalizeText(queryText).toLowerCase();
      const knownMatches = profileConfig.knownQueries.filter((entry) => normalizeText(entry?.query).toLowerCase() === normalizedQuery);
      for (const entry of knownMatches) {
        if (!entry?.url) {
          continue;
        }
        addSyntheticCandidate('content-link', entry.title || entry.query || queryText, entry.url, {
          semanticRole: 'content',
          queryText,
          primary: 'known-query',
          textSnippet: entry.title || entry.query || queryText,
        });
      }
    }
  }

  for (const summary of document.querySelectorAll('details:not([open]) > summary')) {
    addCandidate(summary, 'details-toggle', summary.parentElement?.id || null);
  }

  for (const element of document.querySelectorAll('[aria-expanded="false"]')) {
    const tag = element.tagName.toLowerCase();
    const role = getRole(element);
    if (element.hasAttribute('aria-haspopup')) {
      continue;
    }
    if (tag === 'button' || tag === 'a' || role === 'button') {
      addCandidate(element, 'expanded-toggle', element.getAttribute('aria-controls'));
    }
  }

  for (const tab of document.querySelectorAll('[role="tab"][aria-selected="false"]')) {
    addCandidate(tab, 'tab', tab.getAttribute('aria-controls'));
  }

  for (const element of document.querySelectorAll('[aria-haspopup]')) {
    const popup = normalizeText(element.getAttribute('aria-haspopup')).toLowerCase();
    if (popup === 'dialog') {
      addCandidate(element, 'dialog-open', element.getAttribute('aria-controls'));
    } else if (popup === 'menu' || popup === 'listbox') {
      addCandidate(element, 'menu-button', element.getAttribute('aria-controls'));
    }
  }

  for (const element of document.querySelectorAll('[aria-controls]')) {
    if (element.getAttribute('aria-expanded') === 'false') {
      continue;
    }
    if (element.hasAttribute('aria-haspopup')) {
      continue;
    }
    if (getRole(element) === 'tab') {
      continue;
    }
    const controlledTarget = normalizeText(element.getAttribute('aria-controls'));
    if (!controlledTarget) {
      continue;
    }
    if (targetIsHidden(controlledTarget)) {
      addCandidate(element, 'expanded-toggle', controlledTarget);
    }
  }

  for (const element of document.querySelectorAll('a[href]')) {
    if (!isInteractable(element)) {
      continue;
    }
    const label = getLabel(element);
    if (!label || hasRiskText(label)) {
      continue;
    }
    const hrefInfo = hrefPathInfo(element);
    if (!hrefInfo.normalizedHref) {
      continue;
    }
    if (!isAllowedHost(hrefInfo.hostname)) {
      continue;
    }
    if (isAuthCandidate(label, hrefInfo)) {
      addCandidate(element, 'auth-link', null, { allowNavigation: true, semanticRole: 'auth' });
      continue;
    }
    if (isPaginationCandidate(label, hrefInfo, element)) {
      addCandidate(element, 'pagination-link', null, { allowNavigation: true, semanticRole: 'pagination' });
      continue;
    }
    if (pageType === 'book-detail-page' && isChapterCandidate(hrefInfo)) {
      addCandidate(element, 'chapter-link', null, { allowNavigation: true, semanticRole: 'chapter' });
      continue;
    }
    if (isContentCandidate(label, hrefInfo)) {
      addCandidate(element, 'content-link', null, { allowNavigation: true, semanticRole: 'content' });
      continue;
    }
    addCandidate(element, 'safe-nav-link', null, {
      allowNavigation: true,
      semanticRole: semanticRoleForSafeNav(label, hrefInfo),
    });
  }

  for (const element of document.querySelectorAll('button[type="submit"], input[type="submit"], input[type="image"]')) {
    addCandidate(element, 'form-submit', null, { allowSubmit: true, semanticRole: 'submit' });
  }

  if (pageType === 'book-detail-page') {
    const authorName = metaContentByNames(profileConfig.authorMetaNames)
      || textFromSelectors(profileConfig.detailAuthorNameSelectors);
    const authorHref = metaContentByNames(profileConfig.authorLinkMetaNames)
      || hrefFromSelectors(profileConfig.detailAuthorLinkSelectors);
    if (authorName && authorHref) {
      addSyntheticCandidate('safe-nav-link', authorName, authorHref, {
        semanticRole: 'author',
        primary: 'href-direct',
        textSnippet: authorName,
      });
    }

    const chapterAnchors = [];
    for (const selector of profileConfig.chapterLinkSelectors) {
      try {
        chapterAnchors.push(...document.querySelectorAll(selector));
      } catch {
        // Ignore invalid selectors in profile.
      }
    }
    for (const anchor of chapterAnchors) {
      if (!(anchor instanceof HTMLAnchorElement) || !isInteractable(anchor)) {
        continue;
      }
      const hrefInfo = hrefPathInfo(anchor);
      if (!isChapterCandidate(hrefInfo)) {
        continue;
      }
      const label = getLabel(anchor);
      addSyntheticCandidate('chapter-link', label || hrefInfo.normalizedHref, hrefInfo.normalizedHref, {
        semanticRole: 'chapter',
        primary: 'href-direct',
        id: anchor.id || null,
        domPath: buildDomPath(anchor),
        textSnippet: label,
      });
    }

    const latestChapterHref = metaContentByNames(profileConfig.latestChapterMetaNames);
    if (latestChapterHref && /\/biqu\d+\/\d+\.html$/i.test(String(latestChapterHref))) {
      addSyntheticCandidate('chapter-link', 'Latest Chapter', latestChapterHref, {
        semanticRole: 'chapter',
        primary: 'href-direct',
        textSnippet: 'Latest Chapter',
      });
    }
  }

  const filteredCandidates = candidates.filter((candidate) => shouldKeepCandidateForCurrentPage(candidate));

  filteredCandidates.sort((left, right) => {
    if (left._priority !== right._priority) {
      return left._priority - right._priority;
    }
    if (left._semanticPriority !== right._semanticPriority) {
      return left._semanticPriority - right._semanticPriority;
    }
    if (left._labelQuality !== right._labelQuality) {
      return right._labelQuality - left._labelQuality;
    }
    return left.ordinal - right.ordinal;
  });

  const selected = [];
  const selectedCounts = new Map();
  for (const candidate of filteredCandidates) {
    if (selected.length >= maxTriggers) {
      break;
    }
    const quota = quotaForCandidate(candidate);
    if (quota <= 0) {
      continue;
    }
    const count = selectedCounts.get(candidate.kind) ?? 0;
    if (count >= quota) {
      continue;
    }
    selected.push(candidate);
    selectedCounts.set(candidate.kind, count + 1);
  }

  if (selected.length < maxTriggers) {
    const selectedKeys = new Set(selected.map((candidate) => JSON.stringify([candidate.kind, candidate.label, candidate.locator.domPath, candidate.href, candidate.queryText])));
    for (const candidate of filteredCandidates) {
      if (selected.length >= maxTriggers) {
        break;
      }
      const quota = quotaForCandidate(candidate);
      if (quota <= 0) {
        continue;
      }
      const key = JSON.stringify([candidate.kind, candidate.label, candidate.locator.domPath, candidate.href, candidate.queryText]);
      if (selectedKeys.has(key)) {
        continue;
      }
      selected.push(candidate);
      selectedKeys.add(key);
    }
  }

  return selected.slice(0, maxTriggers).map(({ _priority, _semanticPriority, _labelQuality, ...candidate }) => candidate);
}

function pageExecuteTrigger(trigger, siteProfile = null) {
  const locator = trigger?.locator ?? {};
  const profileConfig = {
    searchFormSelectors: siteProfile?.search?.formSelectors ?? ['form[name="t_frmsearch"]', 'form[action*="/ss/"]', 'form[role="search"]'],
    searchInputSelectors: siteProfile?.search?.inputSelectors ?? ['#searchkey', 'input[name="searchkey"]', 'input[type="search"]'],
    searchSubmitSelectors: siteProfile?.search?.submitSelectors ?? ['#search_btn', 'button[type="submit"]', 'input[type="submit"]'],
  };

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalizeUrlLike(value) {
    if (!value) {
      return null;
    }
    try {
      return new URL(value, document.baseURI).toString();
    } catch {
      return String(value);
    }
  }

  function getLabel(element) {
    const ariaLabel = normalizeText(element.getAttribute('aria-label'));
    if (ariaLabel) {
      return ariaLabel;
    }
    const text = normalizeText(element.innerText || element.textContent || '');
    if (text) {
      return text.slice(0, 80);
    }
    return normalizeText(element.id || element.getAttribute('name') || element.tagName.toLowerCase());
  }

  function getRole(element) {
    const explicit = normalizeText(element.getAttribute('role'));
    if (explicit) {
      return explicit.toLowerCase();
    }
    const tag = element.tagName.toLowerCase();
    if (tag === 'button' || tag === 'summary') {
      return 'button';
    }
    if (tag === 'a' && element.hasAttribute('href')) {
      return 'link';
    }
    return '';
  }

  function buildDomPath(element) {
    const segments = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body && segments.length < 8) {
      const tagName = current.tagName.toLowerCase();
      let index = 1;
      let sibling = current;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName.toLowerCase() === tagName) {
          index += 1;
        }
      }
      segments.unshift(`${tagName}:nth-of-type(${index})`);
      current = current.parentElement;
    }
    return segments.join(' > ');
  }

  function isClickable(element) {
    if (!element || !element.isConnected) {
      return false;
    }
    if (element.hidden || element.closest('[hidden], [inert]')) {
      return false;
    }
    if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.pointerEvents === 'none') {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findByDomPath(domPath) {
    if (!domPath) {
      return null;
    }
    try {
      return document.querySelector(domPath);
    } catch {
      return null;
    }
  }

  function scoreCandidate(element, inputLocator) {
    let score = 0;
    if (inputLocator.id && element.id === inputLocator.id) {
      score += 1_000;
    }
    if (inputLocator.ariaControls && normalizeText(element.getAttribute('aria-controls')) === inputLocator.ariaControls) {
      score += 400;
    }
    if (inputLocator.href && normalizeUrlLike(element.getAttribute('href')) === inputLocator.href) {
      score += 500;
    }
    if (inputLocator.role && getRole(element) === inputLocator.role) {
      score += 120;
    }
    if (inputLocator.tagName && element.tagName.toLowerCase() === inputLocator.tagName) {
      score += 60;
    }
    if (inputLocator.label && getLabel(element) === inputLocator.label) {
      score += 220;
    }
    if (inputLocator.textSnippet) {
      const text = normalizeText(element.innerText || element.textContent || '');
      if (text.includes(inputLocator.textSnippet)) {
        score += 80;
      }
    }
    if (inputLocator.domPath && buildDomPath(element) === inputLocator.domPath) {
      score += 40;
    }
    return score;
  }

  function findBestElement(inputLocator) {
    if (inputLocator.id) {
      const exact = document.getElementById(inputLocator.id);
      if (isClickable(exact)) {
        return exact;
      }
    }

    if (inputLocator.href) {
      const byHref = Array.from(document.querySelectorAll('a[href]')).find((candidate) => isClickable(candidate) && normalizeUrlLike(candidate.getAttribute('href')) === inputLocator.href);
      if (isClickable(byHref)) {
        return byHref;
      }
    }

    const domPathMatch = findByDomPath(inputLocator.domPath);
    if (isClickable(domPathMatch)) {
      return domPathMatch;
    }

    const selector = [
      'summary',
      'button',
      'a',
      '[role="button"]',
      '[role="tab"]',
      'form button[type="submit"]',
      'form input[type="submit"]',
      'input[type="image"]',
      '[aria-haspopup]',
      '[aria-controls]',
      '[aria-expanded]',
    ].join(', ');

    let best = null;
    let bestScore = -1;
    for (const candidate of document.querySelectorAll(selector)) {
      if (!isClickable(candidate)) {
        continue;
      }
      const score = scoreCandidate(candidate, inputLocator);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return bestScore > 0 ? best : null;
  }

  function findSearchFormElements() {
    const form = profileConfig.searchFormSelectors
      .map((selector) => {
        try {
          return document.querySelector(selector);
        } catch {
          return null;
        }
      })
      .find(Boolean);
    const input = profileConfig.searchInputSelectors
      .map((selector) => {
        try {
          return document.querySelector(selector);
        } catch {
          return null;
        }
      })
      .find(Boolean);
    const resolvedForm = form instanceof HTMLFormElement ? form : input?.form ?? null;
    const submit = profileConfig.searchSubmitSelectors
      .map((selector) => {
        try {
          return (resolvedForm || document).querySelector(selector);
        } catch {
          return null;
        }
      })
      .find(Boolean);
    return {
      form: resolvedForm,
      input: input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input : null,
      submit: submit instanceof Element ? submit : null,
    };
  }

  if (trigger?.kind === 'search-form') {
    const queryText = normalizeText(trigger.queryText || locator.textSnippet || '');
    const search = findSearchFormElements();
    if (!queryText) {
      return {
        clicked: false,
        reason: 'missing-query',
      };
    }
    if (!search.form && !search.input) {
      return {
        clicked: false,
        reason: 'search-form-not-found',
      };
    }

    try {
      if (search.input) {
        search.input.focus();
        search.input.value = queryText;
        search.input.dispatchEvent(new Event('input', { bubbles: true }));
        search.input.dispatchEvent(new Event('change', { bubbles: true }));
      }

      if (search.form instanceof HTMLFormElement) {
        search.form.setAttribute('target', '_self');
      } else if (search.input?.form instanceof HTMLFormElement) {
        search.input.form.setAttribute('target', '_self');
      }

      if (search.submit instanceof HTMLElement) {
        search.submit.click();
      } else if (search.form instanceof HTMLFormElement) {
        if (typeof search.form.requestSubmit === 'function') {
          search.form.requestSubmit();
        } else {
          search.form.submit();
        }
      } else if (search.input?.form instanceof HTMLFormElement) {
        if (typeof search.input.form.requestSubmit === 'function') {
          search.input.form.requestSubmit();
        } else {
          search.input.form.submit();
        }
      }

      return {
        clicked: true,
        label: queryText,
        tagName: 'form',
        role: 'search',
        submitted: true,
      };
    } catch (error) {
      return {
        clicked: false,
        reason: error.message,
      };
    }
  }

  const element = findBestElement(locator);
  if (!element) {
    if (trigger?.href) {
      try {
        location.assign(trigger.href);
        return {
          clicked: true,
          label: trigger.label || trigger.href,
          tagName: locator.tagName || 'a',
          role: locator.role || 'link',
          directNavigation: true,
        };
      } catch (error) {
        return {
          clicked: false,
          reason: error.message,
        };
      }
    }
    return {
      clicked: false,
      reason: 'not-found',
    };
  }

  try {
    element.scrollIntoView({
      block: 'center',
      inline: 'center',
      behavior: 'instant',
    });
  } catch {
    // Ignore scroll errors and still try the click.
  }

  try {
    element.click();
    return {
      clicked: true,
      label: getLabel(element),
      tagName: element.tagName.toLowerCase(),
      role: getRole(element),
    };
  } catch (error) {
    return {
      clicked: false,
      reason: error.message,
    };
  }
}

function pageComputeStateSignature(siteProfile = null) {
  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function classifyJableModelsPathLocal(pathname) {
    const normalized = String(pathname || '/').trim().toLowerCase() || '/';
    if (normalized === '/models' || normalized === '/models/') {
      return 'list';
    }
    if (!normalized.startsWith('/models/')) {
      return null;
    }
    const remainder = normalized.slice('/models/'.length).replace(/^\/+|\/+$/g, '');
    if (!remainder) {
      return 'list';
    }
    const [firstSegment] = remainder.split('/');
    if (!firstSegment) {
      return 'list';
    }
    if (/^\d+$/u.test(firstSegment)) {
      return 'list';
    }
    return 'detail';
  }

  function normalizeUrlNoFragmentLocal(value) {
    try {
      const parsed = new URL(value, document.baseURI);
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return String(value ?? '').split('#')[0];
    }
  }

  function getLabel(element) {
    const ariaLabel = normalizeText(element.getAttribute('aria-label'));
    if (ariaLabel) {
      return ariaLabel;
    }
    const labelledBy = normalizeText(element.getAttribute('aria-labelledby'));
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => normalizeText(node.textContent || node.innerText || ''))
        .filter(Boolean);
      if (parts.length > 0) {
        return normalizeText(parts.join(' '));
      }
    }
    const text = normalizeText(element.innerText || element.textContent || '');
    if (text) {
      return text.slice(0, 80);
    }
    return normalizeText(element.id || element.getAttribute('name') || element.tagName.toLowerCase());
  }

  function getRole(element) {
    const explicit = normalizeText(element.getAttribute('role'));
    if (explicit) {
      return explicit.toLowerCase();
    }
    const tag = element.tagName.toLowerCase();
    if (tag === 'button' || tag === 'summary') {
      return 'button';
    }
    if (tag === 'a' && element.hasAttribute('href')) {
      return 'link';
    }
    return '';
  }

  function isVisible(element) {
    if (!element || !element.isConnected) {
      return false;
    }
    if (element.hidden || element.closest('[hidden], [inert]')) {
      return false;
    }
    if (element.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function descriptor(element) {
    return [
      element.tagName.toLowerCase(),
      element.id ? `#${element.id}` : '',
      getRole(element) ? `[${getRole(element)}]` : '',
      getLabel(element),
    ]
      .filter(Boolean)
      .join('');
  }

  function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort();
  }

  function controlledIdsFromElement(element) {
    return normalizeText(element.getAttribute('aria-controls')).split(/\s+/).filter(Boolean);
  }

  function textFromSelectors(selectors) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const text = normalizeText(node?.textContent || node?.innerText || '');
      if (text) {
        return text;
      }
    }
    return null;
  }

  function hrefFromSelectors(selectors) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const href = node?.getAttribute?.('href');
      if (href) {
        return normalizeUrlNoFragmentLocal(href);
      }
    }
    return null;
  }

  function metaContent(name) {
    return normalizeText(
      document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content') || '',
    ) || null;
  }

  function uniqueTexts(elements) {
    return uniqueSorted(elements.map((node) => normalizeText(node?.textContent || node?.innerText || '')).filter(Boolean));
  }

  const detailsOpen = uniqueSorted(
    Array.from(document.querySelectorAll('details[open]')).map((element) => descriptor(element)),
  );

  const expandedTriggers = Array.from(document.querySelectorAll('[aria-expanded="true"]')).filter(isVisible);
  const expandedTrue = uniqueSorted(expandedTriggers.map((element) => descriptor(element)));

  const activeTabs = Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]')).filter(isVisible);
  const activeTabDescriptors = uniqueSorted(activeTabs.map((element) => descriptor(element)));

  const controlledIds = new Set();
  for (const element of [...expandedTriggers, ...activeTabs]) {
    for (const id of controlledIdsFromElement(element)) {
      controlledIds.add(id);
    }
  }

  const controlledVisible = uniqueSorted(
    [...controlledIds]
      .map((id) => document.getElementById(id))
      .filter((element) => isVisible(element))
      .map((element) => descriptor(element)),
  );

  const openDialogs = uniqueSorted(
    Array.from(document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]'))
      .filter(isVisible)
      .map((element) => descriptor(element)),
  );

  const openMenus = uniqueSorted(
    [...controlledIds]
      .map((id) => document.getElementById(id))
      .filter((element) => isVisible(element) && (getRole(element) === 'menu' || getRole(element) === 'menubar'))
      .map((element) => descriptor(element)),
  );

  const openListboxes = uniqueSorted(
    [...controlledIds]
      .map((id) => document.getElementById(id))
      .filter((element) => isVisible(element) && getRole(element) === 'listbox')
      .map((element) => descriptor(element)),
  );

  const openPopovers = uniqueSorted(
    Array.from(document.querySelectorAll('[popover]'))
      .filter((element) => {
        try {
          return element.matches(':popover-open') && isVisible(element);
        } catch {
          return false;
        }
      })
      .map((element) => descriptor(element)),
  );

  const finalUrl = normalizeUrlNoFragmentLocal(location.href);
  const title = document.title || '';
  const pageType = (() => {
    try {
      const parsed = new URL(finalUrl, document.baseURI);
      const pathname = parsed.pathname || '/';
      const profilePageTypes = siteProfile?.pageTypes ?? {};
      const matchesProfilePrefix = (values) => Array.isArray(values) && values.some((value) => {
        const normalizedValue = String(value || '').toLowerCase();
        const normalizedPath = String(pathname || '/').toLowerCase();
        return normalizedValue && (normalizedPath === normalizedValue || normalizedPath.startsWith(normalizedValue));
      });
      const matchesProfileExact = (values) => Array.isArray(values)
        && values.some((value) => String(value || '').toLowerCase() === String(pathname || '/').toLowerCase());
      if (matchesProfileExact(profilePageTypes.homeExact) || matchesProfilePrefix(profilePageTypes.homePrefixes)) {
        return 'home';
      }
      if (String(siteProfile?.host ?? '').toLowerCase() === 'jable.tv') {
        const modelsPathKind = classifyJableModelsPathLocal(pathname);
        if (modelsPathKind === 'list') {
          return 'author-list-page';
        }
        if (modelsPathKind === 'detail') {
          return 'author-page';
        }
      }
      if (matchesProfilePrefix(profilePageTypes.searchResultsPrefixes)) {
        return 'search-results-page';
      }
      if (matchesProfilePrefix(profilePageTypes.contentDetailPrefixes)) {
        return 'book-detail-page';
      }
      if (matchesProfilePrefix(profilePageTypes.authorPrefixes)) {
        return 'author-page';
      }
      if (matchesProfilePrefix(profilePageTypes.chapterPrefixes)) {
        return 'chapter-page';
      }
      if (matchesProfilePrefix(profilePageTypes.historyPrefixes)) {
        return 'history-page';
      }
      if (matchesProfilePrefix(profilePageTypes.authPrefixes)) {
        return 'auth-page';
      }
      if (matchesProfilePrefix(profilePageTypes.categoryPrefixes)) {
        return 'category-page';
      }
      if (pathname === '/' || pathname === '') {
        return 'home';
      }
      if (/\/ss(?:\/|$)/i.test(pathname)) {
        return 'search-results-page';
      }
      if (/\/fenlei\//i.test(pathname)) {
        return 'category-page';
      }
      if (/\/biqu\d+\/?$/i.test(pathname)) {
        return 'book-detail-page';
      }
      if (/\/author\//i.test(pathname)) {
        return 'author-page';
      }
      if (/\/biqu\d+\/\d+(?:_\d+)?\.html$/i.test(pathname)) {
        return 'chapter-page';
      }
      if (/history/i.test(pathname)) {
        return 'history-page';
      }
      if (/login|register|sign-?in|sign-?up/i.test(pathname)) {
        return 'auth-page';
      }
      return 'unknown-page';
    } catch {
      return 'unknown-page';
    }
  })();

  const pageFacts = (() => {
    if (pageType === 'search-results-page') {
      const profileResultTitleSelectors = Array.isArray(siteProfile?.search?.resultTitleSelectors)
        ? siteProfile.search.resultTitleSelectors
        : ['.layout-co18 .layout-tit', '.layout2 .layout-tit'];
      const profileResultBookSelectors = Array.isArray(siteProfile?.search?.resultBookSelectors)
        ? siteProfile.search.resultBookSelectors
        : ['.txt-list-row5 li .s2 a[href]', '.layout-co18 .txt-list a[href]'];
      const queryParamNames = Array.isArray(siteProfile?.search?.queryParamNames)
        ? siteProfile.search.queryParamNames
        : ['searchkey', 'keyword', 'q'];
      const resultAnchors = [];
      for (const selector of profileResultBookSelectors) {
        try {
          resultAnchors.push(...document.querySelectorAll(selector));
        } catch {
          // Ignore invalid selectors from site profile.
        }
      }
      const queryFromTitle = (() => {
        const headingText = textFromSelectors(profileResultTitleSelectors) || '';
        const matched = headingText.match(/搜索\s*["“]?(.+?)["”]?\s*共有/i);
        return normalizeText(matched?.[1] || '');
      })();
      const derivedQuery = (() => {
        try {
          const parsed = new URL(finalUrl, document.baseURI);
          for (const name of queryParamNames) {
            const value = normalizeText(parsed.searchParams.get(name) || '');
            if (value) {
              return value;
            }
          }
          const fromPath = parsed.pathname.match(/\/ss\/(.+?)(?:\.html)?$/i)?.[1] || '';
          const fromPathText = decodeURIComponent(fromPath).replace(/\.html$/i, '');
          if (normalizeText(fromPathText)) {
            return fromPathText;
          }
        } catch {
          // Ignore URL parse failures.
        }
        return queryFromTitle;
      })();
      return {
        queryText: normalizeText(
          document.querySelector('#searchkey, input[name="searchkey"], input[name="keyword"], #s')?.value || derivedQuery,
        ),
        resultCount: [...new Set(resultAnchors.map((anchor) => normalizeText(anchor.textContent || '')).filter(Boolean))].length,
        resultTitles: uniqueTexts(resultAnchors).slice(0, 20),
      };
    }
    if (pageType === 'book-detail-page') {
      const chapterLinkSelectors = Array.isArray(siteProfile?.bookDetail?.chapterLinkSelectors)
        ? siteProfile.bookDetail.chapterLinkSelectors
        : ['#list a[href]', '.listmain a[href]', 'dd a[href]', '.book_last a[href]'];
      const chapterAnchors = [];
      for (const selector of chapterLinkSelectors) {
        try {
          chapterAnchors.push(...document.querySelectorAll(selector));
        } catch {
          // Ignore invalid selectors from site profile.
        }
      }
      const latestChapterLink = chapterAnchors[0] ?? null;
      return {
        bookTitle: metaContent('og:novel:book_name')
          || textFromSelectors(
            Array.isArray(siteProfile?.contentDetail?.titleSelectors)
              ? siteProfile.contentDetail.titleSelectors
              : ['h1', '.book h1', '#bookinfo h1', 'h2'],
          ),
        authorName: metaContent('og:novel:author')
          || textFromSelectors(
            Array.isArray(siteProfile?.contentDetail?.authorNameSelectors)
              ? siteProfile.contentDetail.authorNameSelectors
              : ['a[href*="/author/"]', '.small span a'],
          ),
        authorUrl: (() => {
          const value = metaContent('og:novel:author_link')
            || hrefFromSelectors(
              Array.isArray(siteProfile?.contentDetail?.authorLinkSelectors)
                ? siteProfile.contentDetail.authorLinkSelectors
                : ['a[href*="/author/"]'],
            );
          return value ? normalizeUrlNoFragmentLocal(value) : null;
        })(),
        chapterCount: chapterAnchors.length,
        latestChapterTitle: normalizeText(latestChapterLink?.textContent || '') || textFromSelectors(['.book_last a', '#list a']),
        latestChapterUrl: (() => {
          const value = metaContent('og:novel:lastest_chapter_url') || latestChapterLink?.getAttribute('href') || '';
          return value ? normalizeUrlNoFragmentLocal(value) : null;
        })(),
      };
    }
    if (pageType === 'author-page') {
      return {
        authorName: metaContent('og:novel:author')
          || textFromSelectors(
            Array.isArray(siteProfile?.author?.titleSelectors)
              ? siteProfile.author.titleSelectors
              : ['h1', '.author h1', '.title h1', 'h2'],
          ),
      };
    }
    if (pageType === 'chapter-page') {
      const contentText = normalizeText(
        document.querySelector('#content, .content, .reader-main .content')?.textContent || '',
      );
      return {
        bookTitle: textFromSelectors(['#info_url', '.crumbs a[href*="/biqu"]', '.bread-crumbs a[href*="/biqu"]']),
        authorName: metaContent('og:novel:author'),
        chapterTitle: textFromSelectors(['.reader-main .title', 'h1.title', '.content_read h1', 'h1']),
        chapterHref: finalUrl,
        prevChapterUrl: hrefFromSelectors(['#prev_url', 'a#prev_url']),
        nextChapterUrl: hrefFromSelectors(['#next_url', 'a#next_url']),
        bodyTextLength: contentText.length,
        bodyExcerpt: contentText.slice(0, 160) || null,
      };
    }
    return null;
  })();

  return {
    finalUrl,
    title,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    pageType,
    pageFacts,
    fingerprint: {
      finalUrl,
      title,
      pageType,
      pageFacts,
      detailsOpen,
      expandedTrue,
      activeTabs: activeTabDescriptors,
      controlledVisible,
      openDialogs,
      openMenus,
      openListboxes,
      openPopovers,
    },
  };
}

async function collectStateSignature(client, sessionId, siteProfile = null) {
  return await callPageFunction(client, sessionId, pageComputeStateSignature, siteProfile);
}

async function waitForPostTriggerSettled(client, sessionId, settings, networkTracker, siteProfile = null, currentUrl = '') {
  const waitPolicy = resolveNavigationWaitPolicy(settings, siteProfile, currentUrl);
  await waitForDocumentReady(client, sessionId, waitPolicy.documentReadyTimeoutMs);
  await waitForDomQuiet(client, sessionId, waitPolicy.domQuietMs, waitPolicy.domQuietTimeoutMs);
  if (waitPolicy.useNetworkIdle) {
    await networkTracker.waitForIdle({
      quietMs: NETWORK_IDLE_QUIET_MS,
      timeoutMs: settings.timeoutMs,
    });
  }
  if (waitPolicy.idleMs > 0) {
    await delay(waitPolicy.idleMs);
  }
}

function shouldExpandPageType(pageType) {
  return ['home', 'category-page', 'author-list-page', 'history-page', 'search-results-page', 'book-detail-page', 'author-page'].includes(pageType);
}

function selectTriggersForPage(pageType, triggers, settings, siteProfile = null, { includeSearchQueries = false } = {}) {
  const selected = [];
  let bookCount = 0;
  let searchResultBookCount = 0;
  let safeNavCount = 0;
  let searchFormCount = 0;
  const sampling = {
    searchResultContentLimit: Number.isFinite(Number(siteProfile?.sampling?.searchResultContentLimit))
      ? Math.max(1, Math.floor(Number(siteProfile.sampling.searchResultContentLimit)))
      : 1,
    authorContentLimit: Number.isFinite(Number(siteProfile?.sampling?.authorContentLimit))
      ? Math.max(1, Math.floor(Number(siteProfile.sampling.authorContentLimit)))
      : 4,
    categoryContentLimit: Number.isFinite(Number(siteProfile?.sampling?.categoryContentLimit))
      ? Math.max(1, Math.floor(Number(siteProfile.sampling.categoryContentLimit)))
      : 4,
    fallbackContentLimitWithSearch: Number.isFinite(Number(siteProfile?.sampling?.fallbackContentLimitWithSearch))
      ? Math.max(1, Math.floor(Number(siteProfile.sampling.fallbackContentLimitWithSearch)))
      : MAX_FALLBACK_BOOKS,
  };
  const isJableSite = String(siteProfile?.host ?? '').toLowerCase() === 'jable.tv';
  const pageSelectionLimit = (() => {
    if (!isJableSite) {
      return Number.POSITIVE_INFINITY;
    }
    if (pageType === 'book-detail-page') {
      return 1;
    }
    if (pageType === 'author-page') {
      return 2;
    }
    if (pageType === 'author-list-page') {
      return 4;
    }
    if (pageType === 'search-results-page') {
      return 4;
    }
    if (['home', 'category-page', 'history-page', 'unknown-page'].includes(pageType)) {
      return 7;
    }
    return 4;
  })();

  const orderedTriggers = (() => {
    if (!isJableSite) {
      return triggers;
    }
    const priorityFor = (trigger) => {
      if (pageType === 'author-list-page') {
        if (trigger.kind === 'safe-nav-link' && trigger.semanticRole === 'author') {
          return 0;
        }
        if (trigger.kind === 'pagination-link') {
          return 1;
        }
        if (trigger.kind === 'safe-nav-link' && trigger.semanticRole === 'category') {
          return 2;
        }
        return 9;
      }
      if (pageType === 'author-page') {
        if (trigger.kind === 'content-link') {
          return 0;
        }
        if (trigger.kind === 'pagination-link') {
          return 1;
        }
        return 9;
      }
      if (pageType === 'search-results-page') {
        if (trigger.kind === 'search-form') {
          return 0;
        }
        if (trigger.kind === 'content-link') {
          return 1;
        }
        if (trigger.kind === 'pagination-link') {
          return 2;
        }
        if (trigger.kind === 'safe-nav-link' && ['category', 'utility', 'home'].includes(trigger.semanticRole)) {
          return 3;
        }
        return 9;
      }
      if (pageType === 'home' || pageType === 'category-page') {
        if (trigger.kind === 'search-form') {
          return 0;
        }
        if (trigger.kind === 'safe-nav-link' && ['category', 'utility', 'home'].includes(trigger.semanticRole)) {
          return 1;
        }
        if (trigger.kind === 'content-link') {
          return 2;
        }
        if (trigger.kind === 'pagination-link') {
          return 3;
        }
        return 9;
      }
      return 0;
    };
    return [...triggers].sort((left, right) => {
      const priorityDiff = priorityFor(left) - priorityFor(right);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return (left.ordinal ?? 0) - (right.ordinal ?? 0);
    });
  })();

  for (const trigger of orderedTriggers) {
    if (selected.length >= pageSelectionLimit) {
      break;
    }

    if (pageType === 'book-detail-page') {
      if (trigger.kind === 'safe-nav-link' && trigger.semanticRole === 'author') {
        selected.push(trigger);
      }
      continue;
    }

    if (pageType === 'search-results-page') {
      if (trigger.kind === 'content-link') {
        if (searchResultBookCount >= sampling.searchResultContentLimit) {
          continue;
        }
        searchResultBookCount += 1;
        selected.push(trigger);
      }
      if (isJableSite && trigger.kind === 'pagination-link') {
        selected.push(trigger);
      }
      continue;
    }

    if (pageType === 'author-page') {
      if (trigger.kind === 'content-link') {
        const authorLimit = isJableSite
          ? Math.min(sampling.authorContentLimit, 2)
          : sampling.authorContentLimit;
        if (bookCount >= authorLimit) {
          continue;
        }
        bookCount += 1;
        selected.push(trigger);
      }
      if (isJableSite && trigger.kind === 'pagination-link') {
        selected.push(trigger);
      }
      continue;
    }

    if (pageType === 'author-list-page') {
      if (trigger.kind === 'safe-nav-link' && trigger.semanticRole === 'author') {
        if (safeNavCount >= 4) {
          continue;
        }
        safeNavCount += 1;
        selected.push(trigger);
      }
      if (isJableSite && trigger.kind === 'pagination-link') {
        selected.push(trigger);
      }
      continue;
    }

    if (['home', 'category-page', 'history-page', 'unknown-page'].includes(pageType)) {
      if (trigger.kind === 'search-form') {
        if (includeSearchQueries) {
          if (isJableSite && searchFormCount >= 3) {
            continue;
          }
          searchFormCount += 1;
          selected.push(trigger);
        }
        continue;
      }
        if (trigger.kind === 'content-link') {
          const bookLimit = settings.searchQueries.length > 0
            ? (isJableSite ? Math.min(sampling.fallbackContentLimitWithSearch, 2) : sampling.fallbackContentLimitWithSearch)
            : (isJableSite ? Math.min(sampling.categoryContentLimit, 2) : sampling.categoryContentLimit);
          if (bookCount >= bookLimit) {
            continue;
          }
          bookCount += 1;
          selected.push(trigger);
          continue;
        }
        if (trigger.kind === 'safe-nav-link') {
          if (isJableSite) {
            if (!['category', 'home', 'utility'].includes(trigger.semanticRole)) {
              continue;
            }
            if (safeNavCount >= 2) {
              continue;
            }
            safeNavCount += 1;
          }
          selected.push(trigger);
          continue;
        }
        if (trigger.kind === 'auth-link') {
          selected.push(trigger);
        }
      }
  }

  return selected;
}

export async function expandStates(inputUrl, options = {}) {
  const settings = mergeOptions(options);
  const { manifest: initialManifest } = await resolveInitialManifest(settings);
  const baseUrl = initialManifest.finalUrl || inputUrl;
  const layout = await createExpandOutputLayout(baseUrl, inputUrl, settings.outDir);
  const topManifest = buildTopLevelManifest(inputUrl, baseUrl, layout);

  let browserProcess = null;
  let userDataDir = null;
  let client = null;
  let targetId = null;
  let sessionId = null;
  let networkTracker = null;
  let stateCounter = 1;

  try {
    const browserPath = settings.browserPath ? path.resolve(settings.browserPath) : await detectBrowserPath();
    if (!browserPath) {
      throw new Error('No Chromium/Chrome executable found. Pass browserPath or --browser-path explicitly.');
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

    const siteProfile = await loadSiteProfile(baseUrl);
    const effectiveSearchQueries = mergeStringArrays(
      settings.searchQueries,
      siteProfile?.search?.defaultQueries,
    );
    await navigateAndWaitReady(client, sessionId, baseUrl, settings, networkTracker, siteProfile);

    const liveInitialSignature = await collectStateSignature(client, sessionId, siteProfile);
    const initialDedupKey = hashFingerprint(liveInitialSignature.fingerprint);

    if (normalizeUrlNoFragment(initialManifest.finalUrl) !== normalizeUrlNoFragment(liveInitialSignature.finalUrl)) {
      topManifest.warnings.push(
        `Initial evidence finalUrl differs from live DOM: evidence=${initialManifest.finalUrl} live=${liveInitialSignature.finalUrl}`,
      );
    }
    if (initialManifest.title !== liveInitialSignature.title) {
      topManifest.warnings.push(
        `Initial evidence title differs from live DOM: evidence=${initialManifest.title} live=${liveInitialSignature.title}`,
      );
    }

    const initialStateManifest = await copyInitialState(initialManifest, layout, initialDedupKey);
    topManifest.states.push(topLevelStateEntryFromManifest(initialStateManifest));

    const capturedDedupKeys = new Map([[initialDedupKey, 's0000']]);
    const expansionQueue = [
      {
        stateId: 's0000',
        sourceUrl: baseUrl,
        includeSearchQueries: true,
      },
    ];
    const expandedStates = new Set();

    while (expansionQueue.length > 0) {
      const context = expansionQueue.shift();
      if (!context || expandedStates.has(context.stateId)) {
        continue;
      }
      expandedStates.add(context.stateId);

      await navigateAndWaitReady(client, sessionId, context.sourceUrl, settings, networkTracker, siteProfile);
      const sourceSignature = await collectStateSignature(client, sessionId, siteProfile);
      const sourceFingerprintJson = JSON.stringify(sourceSignature.fingerprint);
      const discoveryLimit = sourceSignature.pageType === 'book-detail-page'
        ? 1_000
        : Math.max(settings.maxTriggers, settings.maxTriggers + effectiveSearchQueries.length);
      const discoveredTriggers = await callPageFunction(
        client,
        sessionId,
        pageDiscoverTriggers,
        discoveryLimit,
        context.includeSearchQueries ? effectiveSearchQueries : [],
        siteProfile,
      );
      topManifest.summary.discoveredTriggers += discoveredTriggers.length;
      const triggers = selectTriggersForPage(
        sourceSignature.pageType,
        discoveredTriggers,
        settings,
        siteProfile,
        { includeSearchQueries: context.includeSearchQueries },
      );

      for (const trigger of triggers) {
        topManifest.summary.attemptedTriggers += 1;
        const stateId = nextStateId(stateCounter);
        stateCounter += 1;
        const stateName = buildStateName(trigger);
        const attemptedAt = new Date().toISOString();

        try {
          await navigateAndWaitReady(client, sessionId, context.sourceUrl, settings, networkTracker, siteProfile);

          const executeResult = await callPageFunction(client, sessionId, pageExecuteTrigger, trigger, siteProfile);
          if (!executeResult?.clicked) {
            topManifest.summary.failedTriggers += 1;
            topManifest.states.push(
              createStateIndexEntry({
                stateId,
                fromState: context.stateId,
                stateName,
                dedupKey: null,
                trigger,
                finalUrl: context.sourceUrl,
                title: null,
                capturedAt: attemptedAt,
                status: 'failed',
                error: createError('TRIGGER_NOT_FOUND', executeResult?.reason || 'Trigger could not be resolved'),
              }),
            );
            continue;
          }

          await waitForPostTriggerSettled(client, sessionId, settings, networkTracker, siteProfile, context.sourceUrl);

          const postSignature = await collectStateSignature(client, sessionId, siteProfile);
          const dedupKey = hashFingerprint(postSignature.fingerprint);
          const postFingerprintJson = JSON.stringify(postSignature.fingerprint);

          if (postFingerprintJson === sourceFingerprintJson) {
            topManifest.summary.noopTriggers += 1;
            topManifest.states.push(
              createStateIndexEntry({
                stateId,
                fromState: context.stateId,
                stateName,
                dedupKey,
                trigger,
                finalUrl: postSignature.finalUrl,
                title: postSignature.title,
                capturedAt: attemptedAt,
                status: 'noop',
                pageFacts: postSignature.pageFacts ?? null,
                error: null,
              }),
            );
            continue;
          }

          if (capturedDedupKeys.has(dedupKey)) {
            topManifest.summary.duplicateStates += 1;
            topManifest.states.push(
              createStateIndexEntry({
                stateId,
                fromState: context.stateId,
                stateName,
                dedupKey,
                trigger,
                finalUrl: postSignature.finalUrl,
                title: postSignature.title,
                capturedAt: attemptedAt,
                status: 'duplicate',
                duplicateOf: capturedDedupKeys.get(dedupKey),
                pageFacts: postSignature.pageFacts ?? null,
                error: null,
              }),
            );
            continue;
          }

          const stateDir = path.join(layout.statesDir, `${stateId}_${slugify(stateName, stateId)}`);
      const stateManifest = await captureCurrentState({
        client,
        sessionId,
        inputUrl,
            stateId,
            fromState: context.stateId,
            stateName,
            dedupKey,
            trigger,
        stateDir,
        pageMetadata: postSignature,
        settings,
        siteProfile,
      });

          if (stateManifest.status === 'captured') {
            topManifest.summary.capturedStates += 1;
            capturedDedupKeys.set(dedupKey, stateId);
            if (shouldExpandPageType(postSignature.pageType)) {
              expansionQueue.push({
                stateId,
                sourceUrl: postSignature.finalUrl,
                includeSearchQueries: false,
              });
            }
          } else {
            topManifest.summary.failedTriggers += 1;
          }

          topManifest.states.push(topLevelStateEntryFromManifest(stateManifest));
        } catch (error) {
          topManifest.summary.failedTriggers += 1;
          topManifest.states.push(
            createStateIndexEntry({
              stateId,
              fromState: context.stateId,
              stateName,
              dedupKey: null,
              trigger,
              finalUrl: context.sourceUrl,
              title: null,
              capturedAt: attemptedAt,
              status: 'failed',
              error: createError('TRIGGER_EXECUTION_FAILED', error.message),
            }),
          );
        }
      }
    }

    await writeTopLevelManifest(layout.manifestPath, topManifest);
    return topManifest;
  } catch (error) {
    topManifest.warnings.push(`Expansion failed: ${error.message}`);
    await writeTopLevelManifest(layout.manifestPath, topManifest);
    throw error;
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

    if (current.startsWith('--initial-manifest')) {
      const { value, nextIndex } = readValue(current, index);
      options.initialManifestPath = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--initial-dir')) {
      const { value, nextIndex } = readValue(current, index);
      options.initialEvidenceDir = value;
      index = nextIndex;
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

    if (current.startsWith('--max-triggers')) {
      const { value, nextIndex } = readValue(current, index);
      options.maxTriggers = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--search-query')) {
      const { value, nextIndex } = readValue(current, index);
      options.searchQueries = [...normalizeStringArray(options.searchQueries), value];
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
  node expand-states.mjs <url> --initial-manifest <path> [options]
  node expand-states.mjs <url> --initial-dir <dir> [options]

Options:
  --initial-manifest <path> Initial capture manifest.json path
  --initial-dir <path>      Initial capture directory containing manifest.json
  --out-dir <path>          Output root directory
  --browser-path <path>     Explicit Chromium/Chrome executable path
  --timeout <ms>            Overall timeout for CDP operations
  --wait-until <mode>       load | networkidle
  --idle-ms <ms>            Extra delay after readiness before capture
  --max-triggers <n>        Maximum discovered triggers to expand
  --search-query <text>     Repeatable search query seed injected into site search
  --full-page               Force full-page screenshot
  --no-full-page            Disable full-page screenshot
  --headless                Run browser headless (default)
  --no-headless             Run browser with a visible window
  --help                    Show this help
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

    const manifest = await expandStates(url, options);
    process.stdout.write(`${JSON.stringify(summarizeForStdout(manifest), null, 2)}\n`);
    if (manifest.summary.failedTriggers > 0 && manifest.summary.capturedStates === 0) {
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
