import path from 'node:path';

import { CdpClient } from './cdp-client.mjs';
import {
  delay,
  detectBrowserPath,
  launchBrowser,
  readExistingBrowserDevTools,
  shutdownBrowser,
} from './launcher.mjs';

export const SNAPSHOT_STYLES = ['display', 'visibility', 'opacity', 'position', 'z-index'];
export const NETWORK_IDLE_QUIET_MS = 500;
const NETWORK_IDLE_POLL_INTERVAL_MS = 100;
const DOCUMENT_READY_POLL_INTERVAL_MS = 100;
const TARGET_POLL_INTERVAL_MS = 100;

function formatEvaluationError(result, fallback) {
  return (
    result?.exceptionDetails?.exception?.description
    || result?.exceptionDetails?.text
    || fallback
    || 'Page evaluation failed'
  );
}

function serializeArgs(args) {
  return args.map((arg) => JSON.stringify(arg)).join(', ');
}

function createEmptyMetrics() {
  return {
    createdAt: new Date().toISOString(),
    closedAt: null,
    counts: {
      send: 0,
      evaluate: 0,
      evaluateValue: 0,
      callPageFunction: 0,
      navigateAndWait: 0,
      waitForSettled: 0,
      waitForDocumentReady: 0,
      waitForDomQuiet: 0,
      captureHtml: 0,
      captureSnapshot: 0,
      captureScreenshot: 0,
      helperEnsure: 0,
      helperInvoke: 0,
      helperRetry: 0,
      helperFallback: 0,
      networkIdleWait: 0,
    },
    protocol: {
      total: 0,
      byMethod: {},
    },
    waitPolicies: [],
    helperMethods: {},
  };
}

function incrementCounter(target, key, amount = 1) {
  target[key] = (target[key] ?? 0) + amount;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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

function defaultDomQuietFunction(innerQuietMs, innerTimeoutMs) {
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
}

export class BrowserSession {
  constructor({
    client,
    sessionId,
    targetId,
    browserProcess = null,
    userDataDir = null,
    cleanupUserDataDirOnShutdown = true,
    timeoutMs = 30_000,
    networkTracker,
    defaultFullPage = true,
    browserStartUrl = 'about:blank',
    browserAttachedVia = 'created-target',
    reusedBrowserInstance = false,
  }) {
    this.client = client;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.browserProcess = browserProcess;
    this.userDataDir = userDataDir;
    this.cleanupUserDataDirOnShutdown = cleanupUserDataDirOnShutdown;
    this.timeoutMs = timeoutMs;
    this.networkTracker = networkTracker;
    this.defaultFullPage = defaultFullPage;
    this.browserStartUrl = browserStartUrl;
    this.browserAttachedVia = browserAttachedVia;
    this.reusedBrowserInstance = reusedBrowserInstance;
    this.helperReady = new Set();
    this.closed = false;
    this.metrics = createEmptyMetrics();
  }

  async send(method, params = {}, timeoutMs = this.timeoutMs) {
    incrementCounter(this.metrics.counts, 'send');
    incrementCounter(this.metrics.protocol, 'total');
    incrementCounter(this.metrics.protocol.byMethod, method);
    return await this.client.send(method, params, this.sessionId, timeoutMs);
  }

  async evaluate(expression, { returnByValue = true, awaitPromise = true } = {}) {
    incrementCounter(this.metrics.counts, 'evaluate');
    const result = await this.send('Runtime.evaluate', { expression, returnByValue, awaitPromise });
    if (result.exceptionDetails) {
      throw new Error(formatEvaluationError(result, `Evaluation failed for expression: ${expression}`));
    }
    return result;
  }

  async evaluateValue(expression) {
    incrementCounter(this.metrics.counts, 'evaluateValue');
    return (await this.evaluate(expression)).result?.value;
  }

  async callPageFunction(fn, ...args) {
    incrementCounter(this.metrics.counts, 'callPageFunction');
    const expression = `(${fn.toString()})(${serializeArgs(args)})`;
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(formatEvaluationError(result, `Page function failed: ${fn.name || 'anonymous'}`));
    }
    return result.result?.value;
  }

  async waitForDocumentReady(timeoutMs = this.timeoutMs) {
    incrementCounter(this.metrics.counts, 'waitForDocumentReady');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const readyState = await this.evaluateValue('document.readyState');
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

  async waitForDomQuiet(quietMs, timeoutMs = this.timeoutMs) {
    incrementCounter(this.metrics.counts, 'waitForDomQuiet');
    return await this.callPageFunction(defaultDomQuietFunction, quietMs, timeoutMs);
  }

  async waitForSettled(waitPolicy) {
    if (!waitPolicy) {
      return;
    }

    incrementCounter(this.metrics.counts, 'waitForSettled');
    this.metrics.waitPolicies.push({
      useLoadEvent: Boolean(waitPolicy.useLoadEvent),
      useNetworkIdle: Boolean(waitPolicy.useNetworkIdle),
      documentReadyTimeoutMs: waitPolicy.documentReadyTimeoutMs ?? null,
      domQuietTimeoutMs: waitPolicy.domQuietTimeoutMs ?? null,
      domQuietMs: waitPolicy.domQuietMs ?? null,
      networkQuietMs: waitPolicy.networkQuietMs ?? null,
      networkIdleTimeoutMs: waitPolicy.networkIdleTimeoutMs ?? null,
      idleMs: waitPolicy.idleMs ?? null,
    });

    const loadPromise = waitPolicy.useLoadEvent
      ? this.client.waitForEvent('Page.loadEventFired', {
        sessionId: this.sessionId,
        timeoutMs: waitPolicy.documentReadyTimeoutMs ?? this.timeoutMs,
      })
      : null;

    if (loadPromise) {
      await loadPromise;
    } else {
      await this.waitForDocumentReady(waitPolicy.documentReadyTimeoutMs ?? this.timeoutMs);
      await this.waitForDomQuiet(
        waitPolicy.domQuietMs ?? 0,
        waitPolicy.domQuietTimeoutMs ?? waitPolicy.documentReadyTimeoutMs ?? this.timeoutMs,
      );
    }

    if (waitPolicy.useNetworkIdle) {
      incrementCounter(this.metrics.counts, 'networkIdleWait');
      await this.networkTracker.waitForIdle({
        quietMs: waitPolicy.networkQuietMs ?? NETWORK_IDLE_QUIET_MS,
        timeoutMs: waitPolicy.networkIdleTimeoutMs ?? this.timeoutMs,
      });
    }

    if (waitPolicy.idleMs > 0) {
      await delay(waitPolicy.idleMs);
    }
  }

  async navigateAndWait(url, waitPolicy, navigationOptions = {}) {
    incrementCounter(this.metrics.counts, 'navigateAndWait');
    const request = {
      url,
    };
    if (navigationOptions?.referrer) {
      request.referrer = navigationOptions.referrer;
    }
    const navigateResult = await this.send('Page.navigate', request);
    if (navigateResult.errorText) {
      throw new Error(`Navigation failed: ${navigateResult.errorText}`);
    }
    this.helperReady.clear();
    await this.waitForSettled(waitPolicy);
    return navigateResult;
  }

  async captureHtml() {
    incrementCounter(this.metrics.counts, 'captureHtml');
    return await this.evaluateValue('document.documentElement.outerHTML');
  }

  async captureSnapshot() {
    incrementCounter(this.metrics.counts, 'captureSnapshot');
    return await this.send('DOMSnapshot.captureSnapshot', {
      computedStyles: SNAPSHOT_STYLES,
      includeDOMRects: true,
      includePaintOrder: true,
    });
  }

  async captureScreenshot({ fullPage = this.defaultFullPage, allowViewportFallback = true } = {}) {
    incrementCounter(this.metrics.counts, 'captureScreenshot');
    try {
      const primary = await this.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: fullPage,
        fromSurface: true,
      });
      return {
        data: primary.data,
        usedViewportFallback: false,
        attemptedFullPage: fullPage,
        primaryError: null,
      };
    } catch (error) {
      if (!fullPage || !allowViewportFallback) {
        throw error;
      }
      const fallback = await this.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        fromSurface: true,
      });
      return {
        data: fallback.data,
        usedViewportFallback: true,
        attemptedFullPage: true,
        primaryError: error,
      };
    }
  }

  async captureEvidence({ html = true, snapshot = true, screenshot = true, fullPage = this.defaultFullPage } = {}) {
    const evidence = {};
    if (html) {
      evidence.html = await this.captureHtml();
    }
    if (snapshot) {
      evidence.snapshot = await this.captureSnapshot();
    }
    if (screenshot) {
      const screenshotResult = await this.captureScreenshot({ fullPage });
      evidence.screenshotBase64 = screenshotResult.data;
      evidence.screenshotUsedViewportFallback = screenshotResult.usedViewportFallback;
      evidence.screenshotPrimaryError = screenshotResult.primaryError;
    }
    return evidence;
  }

  async getFrameTree() {
    return await this.send('Page.getFrameTree');
  }

  async getPageMetadata(fallbackUrl = null) {
    const [frameTree, title, innerWidth, innerHeight] = await Promise.all([
      this.getFrameTree(),
      this.evaluateValue('document.title'),
      this.evaluateValue('window.innerWidth'),
      this.evaluateValue('window.innerHeight'),
    ]);

    return {
      finalUrl: frameTree?.frameTree?.frame?.url ?? fallbackUrl,
      title: title ?? '',
      viewportWidth: typeof innerWidth === 'number' ? innerWidth : null,
      viewportHeight: typeof innerHeight === 'number' ? innerHeight : null,
    };
  }

  async ensureHelperBundle(bundleSource, { namespace } = {}) {
    if (!bundleSource) {
      return;
    }
    const namespaceKey = namespace ?? '__helper__';
    if (this.helperReady.has(namespaceKey)) {
      return;
    }
    incrementCounter(this.metrics.counts, 'helperEnsure');
    await this.evaluate(bundleSource);
    this.helperReady.add(namespaceKey);
  }

  async invokeHelperMethod(methodName, args = [], { namespace = '__BWS_EXPAND__', bundleSource, fallbackFn } = {}) {
    incrementCounter(this.metrics.counts, 'helperInvoke');
    incrementCounter(this.metrics.helperMethods, methodName);
    const attemptInvoke = async () => {
      const expression = `globalThis[${JSON.stringify(namespace)}][${JSON.stringify(methodName)}](${serializeArgs(args)})`;
      return await this.evaluateValue(expression);
    };

    const retryWithFreshBundle = async () => {
      if (!bundleSource) {
        throw null;
      }
      this.helperReady.delete(namespace);
      await this.ensureHelperBundle(bundleSource, { namespace });
      return await attemptInvoke();
    };

    if (bundleSource) {
      await this.ensureHelperBundle(bundleSource, { namespace });
    }

    try {
      return await attemptInvoke();
    } catch (error) {
      try {
        incrementCounter(this.metrics.counts, 'helperRetry');
        return await retryWithFreshBundle();
      } catch {
        if (fallbackFn) {
          incrementCounter(this.metrics.counts, 'helperFallback');
          return await this.callPageFunction(fallbackFn, ...args);
        }
        throw error;
      }
    }
  }

  async close() {
    if (this.closed) {
      return {
        shutdownMode: 'graceful',
        profileFlush: null,
      };
    }
    this.closed = true;
    this.metrics.closedAt = new Date().toISOString();

    this.networkTracker?.dispose?.();
    let shutdownSummary = {
      shutdownMode: 'graceful',
      profileFlush: null,
    };

    try {
      if (this.client && this.browserProcess) {
        shutdownSummary = await shutdownBrowser(this.browserProcess, this.userDataDir, {
          cleanupUserDataDirOnShutdown: this.cleanupUserDataDirOnShutdown,
          gracefulClose: async () => {
            await this.client.send('Browser.close');
          },
        });
      } else {
        if (this.client && this.targetId) {
          try {
            await this.client.send('Target.closeTarget', { targetId: this.targetId });
          } catch {
            // Target cleanup is best-effort only.
          }
        }
        shutdownSummary = await shutdownBrowser(this.browserProcess, this.userDataDir, {
          cleanupUserDataDirOnShutdown: this.cleanupUserDataDirOnShutdown,
        });
      }
    } finally {
      this.client?.close?.();
    }

    return shutdownSummary;
  }

  getMetrics() {
    return cloneJson(this.metrics);
  }
}

function normalizeComparableUrl(value) {
  try {
    return new URL(String(value ?? '')).toString();
  } catch {
    return String(value ?? '').trim();
  }
}

function selectInitialPageTarget(targetInfos, startupUrl) {
  const pageTargets = (Array.isArray(targetInfos) ? targetInfos : []).filter((target) => target?.type === 'page');
  if (pageTargets.length === 0) {
    return null;
  }

  const comparableStartupUrl = normalizeComparableUrl(startupUrl);
  if (comparableStartupUrl) {
    const exactMatch = pageTargets.find((target) => normalizeComparableUrl(target.url) === comparableStartupUrl);
    if (exactMatch) {
      return exactMatch;
    }
  }

  const nonBlank = pageTargets.find((target) => !/^about:blank$/iu.test(String(target?.url ?? '')));
  if (nonBlank) {
    return nonBlank;
  }

  return pageTargets[0] ?? null;
}

async function waitForInitialPageTarget(client, {
  startupUrl,
  timeoutMs,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.send('Target.getTargets');
    const targetInfo = selectInitialPageTarget(result?.targetInfos, startupUrl);
    if (targetInfo?.targetId) {
      return targetInfo;
    }
    await delay(TARGET_POLL_INTERVAL_MS);
  }

  const error = new Error('Timed out waiting for initial page target');
  error.code = 'BROWSER_ATTACH_TIMEOUT';
  throw error;
}

export async function openBrowserSession(
  settings,
  {
    browserPath = settings.browserPath,
    userDataDirPrefix = 'browser-runtime-',
    userDataDir = settings.userDataDir,
    cleanupUserDataDirOnShutdown = settings.cleanupUserDataDirOnShutdown ?? !userDataDir,
  } = {},
  deps = {},
) {
  const detectBrowserPathImpl = deps.detectBrowserPath ?? detectBrowserPath;
  const launchBrowserImpl = deps.launchBrowser ?? launchBrowser;
  const readExistingBrowserDevToolsImpl = deps.readExistingBrowserDevTools ?? readExistingBrowserDevTools;
  const CdpClientImpl = deps.CdpClient ?? CdpClient;
  const resolvedBrowserPath = browserPath ? path.resolve(browserPath) : await detectBrowserPathImpl();
  if (!resolvedBrowserPath) {
    const error = new Error('No Chromium/Chrome executable found. Pass browserPath or --browser-path explicitly.');
    error.code = 'BROWSER_NOT_FOUND';
    throw error;
  }

  const startupUrl = String(settings.startupUrl || 'about:blank');
  let browserInfo = null;
  let reusedBrowserInstance = false;
  const existingBrowserConnectTimeoutMs = Math.min(
    2_000,
    Math.max(750, Math.floor((settings.timeoutMs ?? 30_000) / 5)),
  );

  const existingDevTools = userDataDir
    ? await readExistingBrowserDevToolsImpl(userDataDir, existingBrowserConnectTimeoutMs)
    : null;

  let client = null;
  if (existingDevTools?.wsUrl) {
    try {
      client = new CdpClientImpl(existingDevTools.wsUrl, { timeoutMs: existingBrowserConnectTimeoutMs });
      await client.connect();
      reusedBrowserInstance = true;
      browserInfo = {
        browserProcess: null,
        userDataDir: path.resolve(userDataDir),
        cleanupUserDataDirOnShutdown,
        wsUrl: existingDevTools.wsUrl,
        startupUrl,
      };
    } catch {
      client?.close?.();
      client = null;
    }
  }

  if (!client) {
    browserInfo = await launchBrowserImpl(resolvedBrowserPath, {
      headless: settings.headless,
      timeoutMs: settings.timeoutMs,
      userDataDirPrefix,
      userDataDir,
      cleanupUserDataDirOnShutdown,
      startupUrl,
    });
    client = new CdpClientImpl(browserInfo.wsUrl, { timeoutMs: settings.timeoutMs });
    await client.connect();
  }

  let targetId = null;
  let browserAttachedVia = 'created-target';

  try {
    const initialTarget = await waitForInitialPageTarget(client, {
      startupUrl,
      timeoutMs: settings.timeoutMs,
    });
    targetId = initialTarget.targetId;
    browserAttachedVia = 'existing-target';
  } catch (error) {
    if (error?.code !== 'BROWSER_ATTACH_TIMEOUT') {
      throw error;
    }
    const targetResult = await client.send('Target.createTarget', { url: startupUrl });
    targetId = targetResult.targetId;
    browserAttachedVia = 'created-target';
  }

  const attachResult = await client.send('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = attachResult.sessionId;

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

  const networkTracker = createNetworkTracker(client, sessionId);

  return new BrowserSession({
    client,
    sessionId,
    targetId,
    browserProcess: browserInfo.browserProcess,
    userDataDir: browserInfo.userDataDir,
    cleanupUserDataDirOnShutdown: browserInfo.cleanupUserDataDirOnShutdown,
    timeoutMs: settings.timeoutMs,
    networkTracker,
    defaultFullPage: settings.fullPage,
    browserStartUrl: browserInfo.startupUrl ?? startupUrl,
    browserAttachedVia,
    reusedBrowserInstance,
  });
}
