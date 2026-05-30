import test from 'node:test';
import assert from 'node:assert/strict';

import { BrowserSession, openBrowserSession } from '../../src/infra/browser/session.mjs';

class FakeCdpClient {
  constructor(_wsUrl, _options = /** @type {any} */ ({})) {
    this.calls = /** @type {any[]} */ ([]);
    this.targetInfos = /** @type {any[]} */ ([]);
    this.closed = false;
  }

  async connect() {}

  async send(method, params = /** @type {any} */ ({}), sessionId) {
    this.calls.push({ method, params, sessionId });
    switch (method) {
      case 'Target.getTargets':
        return { targetInfos: this.targetInfos };
      case 'Target.attachToTarget':
        return { sessionId: 'session-1' };
      case 'Target.createTarget':
        return { targetId: 'created-target-1' };
      case 'Page.enable':
      case 'Runtime.enable':
      case 'Network.enable':
      case 'Page.setLifecycleEventsEnabled':
      case 'Emulation.setDeviceMetricsOverride':
        return {};
      default:
        throw new Error(`Unexpected CDP method: ${method}`);
    }
  }

  on() {
    return () => {};
  }

  close() {
    this.closed = true;
  }
}

function createSettledWaitSession({ domQuietError }) {
  return new BrowserSession({
    client: {
      async send(method, params) {
        assert.equal(method, 'Runtime.evaluate');
        if (params.expression === 'document.readyState') {
          return {
            result: {
              value: 'complete',
            },
          };
        }
        if (String(params.expression).includes('MutationObserver')) {
          throw domQuietError;
        }
        throw new Error(`Unexpected Runtime.evaluate expression: ${params.expression}`);
      },
    },
    sessionId: 'session-1',
    targetId: 'target-1',
    timeoutMs: 50,
    networkTracker: {
      async waitForIdle() {
        throw new Error('network idle should not be called in this regression test');
      },
      dispose() {},
    },
  });
}

test('openBrowserSession attaches to the existing startup page target before creating a target', async () => {
  let clientInstance = null;

  const session = await openBrowserSession({
    headless: false,
    timeoutMs: 250,
    fullPage: false,
    viewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    },
    startupUrl: 'https://www.bilibili.com/',
  }, {}, {
    detectBrowserPath: async () => 'C:\\Chrome\\chrome.exe',
    launchBrowser: async () => ({
      browserProcess: null,
      userDataDir: 'C:\\profiles\\bilibili.com',
      cleanupUserDataDirOnShutdown: false,
      wsUrl: 'ws://127.0.0.1:9222/devtools/browser/test',
      startupUrl: 'https://www.bilibili.com/',
    }),
    CdpClient: class extends FakeCdpClient {
      constructor(wsUrl, options) {
        super(wsUrl, options);
        this.targetInfos = [{ targetId: 'existing-target-1', type: 'page', url: 'https://www.bilibili.com/' }];
        clientInstance = this;
      }
    },
  });

  try {
    assert.equal(session.targetId, 'existing-target-1');
    assert.equal(session.browserAttachedVia, 'existing-target');
    assert.equal(session.browserStartUrl, 'https://www.bilibili.com/');
    // @ts-ignore
    assert.equal(clientInstance.calls.some((call) => call.method === 'Target.createTarget'), false);
  } finally {
    await session.close();
  }

});

test('openBrowserSession forwards launch args to the browser launcher', async () => {
  let launchOptions = null;

  const session = await openBrowserSession({
    headless: false,
    timeoutMs: 250,
    fullPage: false,
    viewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    },
    startupUrl: 'about:blank',
    launchArgs: ['--load-extension=C:\\SiteForge\\bridge', '--disable-extensions-except=C:\\SiteForge\\bridge'],
  }, {}, {
    detectBrowserPath: async () => 'C:\\Chrome\\chrome.exe',
    launchBrowser: async (_browserPath, options) => {
      launchOptions = options;
      return {
        browserProcess: null,
        userDataDir: 'C:\\profiles\\bridge',
        cleanupUserDataDirOnShutdown: true,
        wsUrl: 'ws://127.0.0.1:9222/devtools/browser/test',
        startupUrl: 'about:blank',
      };
    },
    CdpClient: class extends FakeCdpClient {
      constructor(wsUrl, options) {
        super(wsUrl, options);
        this.targetInfos = [{ targetId: 'existing-target-1', type: 'page', url: 'about:blank' }];
      }
    },
  });

  try {
    assert.deepEqual(launchOptions.launchArgs, [
      '--load-extension=C:\\SiteForge\\bridge',
      '--disable-extensions-except=C:\\SiteForge\\bridge',
    ]);
  } finally {
    await session.close();
  }
});

test('openBrowserSession falls back to createTarget when no initial page target becomes available', async () => {
  let clientInstance = null;

  const session = await openBrowserSession({
    headless: false,
    timeoutMs: 20,
    fullPage: false,
    viewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    },
    startupUrl: 'https://space.bilibili.com/1202350411/dynamic',
  }, {}, {
    detectBrowserPath: async () => 'C:\\Chrome\\chrome.exe',
    launchBrowser: async () => ({
      browserProcess: null,
      userDataDir: 'C:\\profiles\\bilibili.com',
      cleanupUserDataDirOnShutdown: false,
      wsUrl: 'ws://127.0.0.1:9222/devtools/browser/test',
      startupUrl: 'https://space.bilibili.com/1202350411/dynamic',
    }),
    CdpClient: class extends FakeCdpClient {
      constructor(wsUrl, options) {
        super(wsUrl, options);
        clientInstance = this;
      }
    },
  });

  try {
    assert.equal(session.targetId, 'created-target-1');
    assert.equal(session.browserAttachedVia, 'created-target');
    // @ts-ignore
    const createTargetCall = clientInstance.calls.find((call) => call.method === 'Target.createTarget');
    assert.deepEqual(createTargetCall?.params, {
      url: 'https://space.bilibili.com/1202350411/dynamic',
    });
  } finally {
    await session.close();
  }

});

test('openBrowserSession reuses an existing browser instance for the same persistent profile when DevToolsActivePort is available', async () => {
  let clientInstance = null;
  let launchCalled = false;

  const session = await openBrowserSession({
    headless: false,
    timeoutMs: 250,
    fullPage: false,
    viewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    },
    userDataDir: 'C:\\profiles\\bilibili.com',
    cleanupUserDataDirOnShutdown: false,
    startupUrl: 'https://space.bilibili.com/1202350411/dynamic',
  }, {}, {
    detectBrowserPath: async () => 'C:\\Chrome\\chrome.exe',
    launchBrowser: async () => {
      launchCalled = true;
      throw new Error('launchBrowser should not be called when an existing browser instance is reusable');
    },
    readExistingBrowserDevTools: async () => ({
      port: 9222,
      wsUrl: 'ws://127.0.0.1:9222/devtools/browser/reused',
    }),
    CdpClient: class extends FakeCdpClient {
      constructor(wsUrl, options) {
        super(wsUrl, options);
        this.targetInfos = [{ targetId: 'existing-target-2', type: 'page', url: 'https://space.bilibili.com/1202350411/dynamic' }];
        clientInstance = this;
      }
    },
  });

  try {
    assert.equal(launchCalled, false);
    assert.equal(session.targetId, 'existing-target-2');
    assert.equal(session.browserAttachedVia, 'existing-target');
    assert.equal(session.reusedBrowserInstance, true);
    // @ts-ignore
    assert.equal(clientInstance.calls.some((call) => call.method === 'Target.createTarget'), false);
  } finally {
    await session.close();
  }

  // @ts-ignore
  assert.equal(clientInstance.calls.some((call) => call.method === 'Target.closeTarget'), false);
  // @ts-ignore
  assert.equal(clientInstance.closed, true);
});

test('openBrowserSession falls back to launching a fresh browser when DevToolsActivePort is stale', async () => {
  let launchCalled = false;
  let clientInstances = 0;

  const session = await openBrowserSession({
    headless: false,
    timeoutMs: 500,
    fullPage: false,
    viewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    },
    userDataDir: 'C:\\profiles\\bilibili.com',
    cleanupUserDataDirOnShutdown: false,
    startupUrl: 'https://space.bilibili.com/1202350411/dynamic',
  }, {}, {
    detectBrowserPath: async () => 'C:\\Chrome\\chrome.exe',
    readExistingBrowserDevTools: async () => ({
      port: 9222,
      wsUrl: 'ws://127.0.0.1:9222/devtools/browser/stale',
    }),
    launchBrowser: async () => {
      launchCalled = true;
      return {
        browserProcess: null,
        userDataDir: 'C:\\profiles\\bilibili.com',
        cleanupUserDataDirOnShutdown: false,
        wsUrl: 'ws://127.0.0.1:9223/devtools/browser/fresh',
        startupUrl: 'https://space.bilibili.com/1202350411/dynamic',
      };
    },
    CdpClient: class extends FakeCdpClient {
      constructor(wsUrl, options) {
        super(wsUrl, options);
        clientInstances += 1;
        this.wsUrl = wsUrl;
        this.targetInfos = [{ targetId: 'fresh-target-1', type: 'page', url: 'https://space.bilibili.com/1202350411/dynamic' }];
      }

      async connect() {
        if (this.wsUrl.includes('/stale')) {
          throw new Error('stale devtools');
        }
      }
    },
  });

  try {
    assert.equal(launchCalled, true);
    assert.equal(clientInstances, 2);
    assert.equal(session.reusedBrowserInstance, false);
    assert.equal(session.targetId, 'fresh-target-1');
  } finally {
    await session.close();
  }
});

test('openBrowserSession retries a transient browser startup failure before DevTools becomes ready', async () => {
  let launchCalls = 0;

  const session = await openBrowserSession({
    headless: false,
    timeoutMs: 500,
    fullPage: false,
    viewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    },
    userDataDir: 'C:\\profiles\\douyin.com',
    cleanupUserDataDirOnShutdown: false,
    startupUrl: 'https://www.douyin.com/',
  }, {}, {
    detectBrowserPath: async () => 'C:\\Chrome\\chrome.exe',
    readExistingBrowserDevTools: async () => null,
    launchBrowser: async () => {
      launchCalls += 1;
      if (launchCalls === 1) {
        throw new Error('Browser exited before DevTools became ready (code 0)');
      }
      return {
        browserProcess: null,
        userDataDir: 'C:\\profiles\\douyin.com',
        cleanupUserDataDirOnShutdown: false,
        wsUrl: 'ws://127.0.0.1:9224/devtools/browser/retry',
        startupUrl: 'https://www.douyin.com/',
      };
    },
    CdpClient: class extends FakeCdpClient {
      constructor(wsUrl, options) {
        super(wsUrl, options);
        this.targetInfos = [{ targetId: 'retry-target-1', type: 'page', url: 'https://www.douyin.com/' }];
      }
    },
  });

  try {
    assert.equal(launchCalls, 2);
    assert.equal(session.targetId, 'retry-target-1');
    assert.equal(session.browserAttachedVia, 'existing-target');
  } finally {
    await session.close();
  }
});

test('openBrowserSession retries a transient CDP socket failure during target attachment', async () => {
  let launchCalls = 0;
  let clientConstructions = 0;

  const session = await openBrowserSession({
    headless: false,
    timeoutMs: 500,
    fullPage: false,
    viewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    },
    userDataDir: 'C:\\profiles\\douyin.com',
    cleanupUserDataDirOnShutdown: false,
    startupUrl: 'https://www.douyin.com/',
    sessionOpenRetries: 2,
  }, {}, {
    detectBrowserPath: async () => 'C:\\Chrome\\chrome.exe',
    readExistingBrowserDevTools: async () => null,
    launchBrowser: async () => {
      launchCalls += 1;
      return {
        browserProcess: null,
        userDataDir: 'C:\\profiles\\douyin.com',
        cleanupUserDataDirOnShutdown: false,
        wsUrl: `ws://127.0.0.1:9224/devtools/browser/retry-${launchCalls}`,
        startupUrl: 'https://www.douyin.com/',
      };
    },
    CdpClient: class extends FakeCdpClient {
      constructor(wsUrl, options) {
        super(wsUrl, options);
        clientConstructions += 1;
        this.wsUrl = wsUrl;
        this.targetInfos = [{ targetId: 'retry-target-2', type: 'page', url: 'https://www.douyin.com/' }];
      }

      async send(method, params = /** @type {any} */ ({}), sessionId) {
        if (clientConstructions === 1 && method === 'Target.attachToTarget') {
          throw new Error('CDP socket closed: 1006');
        }
        return await super.send(method, params, sessionId);
      }
    },
  });

  try {
    assert.equal(launchCalls, 2);
    assert.equal(session.targetId, 'retry-target-2');
    assert.equal(session.browserAttachedVia, 'existing-target');
  } finally {
    await session.close();
  }
});

test('openBrowserSession does not attach to an unrelated existing page when startupUrl is a specific URL', async () => {
  let clientInstance = null;

  const session = await openBrowserSession({
    headless: false,
    timeoutMs: 20,
    fullPage: false,
    viewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    },
    startupUrl: 'https://www.douyin.com/?recommend=1',
  }, {}, {
    detectBrowserPath: async () => 'C:\\Chrome\\chrome.exe',
    launchBrowser: async () => ({
      browserProcess: null,
      userDataDir: 'C:\\profiles\\douyin.com',
      cleanupUserDataDirOnShutdown: false,
      wsUrl: 'ws://127.0.0.1:9225/devtools/browser/test',
      startupUrl: 'https://www.douyin.com/?recommend=1',
    }),
    CdpClient: class extends FakeCdpClient {
      constructor(wsUrl, options) {
        super(wsUrl, options);
        this.targetInfos = [{ targetId: 'existing-follow-tab', type: 'page', url: 'https://www.douyin.com/follow?tab=user' }];
        clientInstance = this;
      }
    },
  });

  try {
    assert.equal(session.targetId, 'created-target-1');
    assert.equal(session.browserAttachedVia, 'created-target');
    // @ts-ignore
    const createTargetCall = clientInstance.calls.find((call) => call.method === 'Target.createTarget');
    assert.deepEqual(createTargetCall?.params, {
      url: 'https://www.douyin.com/?recommend=1',
    });
  } finally {
    await session.close();
  }
});

test('BrowserSession evaluateValue retries a transient Runtime.evaluate timeout once', async () => {
  let attempts = 0;
  const session = new BrowserSession({
    client: {
      async send(method, params) {
        attempts += 1;
        assert.equal(method, 'Runtime.evaluate');
        assert.equal(params.expression, 'document.title');
        if (attempts === 1) {
          throw new Error('CDP timeout for Runtime.evaluate');
        }
        return {
          result: {
            value: 'Douyin',
          },
        };
      },
    },
    sessionId: 'session-1',
    targetId: 'target-1',
    timeoutMs: 50,
    networkTracker: { dispose() {} },
  });

  const value = await session.evaluateValue('document.title');
  assert.equal(value, 'Douyin');
  assert.equal(attempts, 2);
});

test('BrowserSession collects redacted page resource API hints from performance entries', async () => {
  const session = new BrowserSession({
    client: {
      async send(method, params) {
        assert.equal(method, 'Runtime.evaluate');
        assert.match(params.expression, /performance\.getEntriesByType\('resource'\)/u);
        assert.match(params.expression, /form\[action\]/u);
        assert.match(params.expression, /data-api-url/u);
        assert.equal(params.expression.includes('formData'), false);
        assert.equal(params.expression.includes('localStorage'), false);
        assert.equal(params.expression.includes('sessionStorage'), false);
        assert.equal(params.expression.includes('document.cookie'), false);
        assert.equal(params.expression.includes('headers'), false);
        assert.equal(params.expression.includes('Authorization'), false);
        assert.equal(params.expression.includes('sourceMap'), false);
        assert.equal(params.expression.includes("querySelectorAll('input"), false);
        return {
          result: {
            value: [
              {
                name: 'https://example.invalid/static/app.js',
                initiatorType: 'script',
              },
              {
                name: 'https://example.invalid/api?access_token=synthetic-resource-token',
                initiatorType: 'img',
              },
              {
                name: 'https://example.invalid/metrics/beacon',
                initiatorType: 'beacon',
              },
              {
                name: 'https://example.invalid/events?session_id=synthetic-event-session',
                initiatorType: 'eventsource',
              },
              {
                name: 'https://example.invalid/data/config.json?token=synthetic-json-token',
                initiatorType: 'link',
              },
              {
                name: 'https://example.invalid/api/hidden-search?csrf=synthetic-dom-api-csrf',
                initiatorType: 'dom-endpoint',
                method: 'POST',
                source: 'browser.dom.api-hint',
                descriptorSource: 'data-api-url',
                headers: {
                  authorization: 'Bearer synthetic-api-auth',
                },
                profileDescriptor: 'synthetic-profile-marker',
              },
              {
                name: 'https://example.invalid/static/logo.png',
                initiatorType: 'dom-endpoint',
                method: 'TRACE',
                source: 'browser.dom.api-hint',
                descriptorSource: 'data-url',
              },
            ],
          },
        };
      },
    },
    sessionId: 'session-1',
    targetId: 'target-1',
    timeoutMs: 50,
    networkTracker: { dispose() {} },
  });

  const hints = await session.getObservedPageResourceApiHints({
    siteKey: 'example',
  });

  assert.equal(hints.length, 5);
  assert.deepEqual(
    hints.map((hint) => [hint.method, hint.resourceType, hint.source, hint.status]),
    [
      ['GET', 'Other', 'browser.performance.resource', 'observed'],
      ['GET', 'Beacon', 'browser.performance.resource', 'observed'],
      ['GET', 'EventSource', 'browser.performance.resource', 'observed'],
      ['GET', 'Other', 'browser.performance.resource', 'observed'],
      ['POST', 'Other', 'browser.dom.api-hint', 'observed'],
    ],
  );
  assert.equal(hints[2].transport, 'sse');
  assert.equal(hints[4].evidence.initiatorType, 'dom-endpoint');
  assert.equal(JSON.stringify(hints).includes('synthetic-resource-token'), false);
  assert.equal(JSON.stringify(hints).includes('synthetic-event-session'), false);
  assert.equal(JSON.stringify(hints).includes('synthetic-json-token'), false);
  assert.equal(JSON.stringify(hints).includes('synthetic-dom-api-csrf'), false);
  assert.equal(JSON.stringify(hints).includes('synthetic-api-auth'), false);
  assert.equal(JSON.stringify(hints).includes('synthetic-profile-marker'), false);
  assert.equal(hints.some((hint) => hint.url.includes('/static/app.js')), false);
  assert.equal(hints.some((hint) => hint.url.includes('/static/logo.png')), false);
});

test('BrowserSession collects redacted DOM route hints from descriptors without script source', async () => {
  const session = new BrowserSession({
    client: {
      async send(method, params) {
        assert.equal(method, 'Runtime.evaluate');
        assert.match(params.expression, /querySelectorAll/u);
        assert.match(params.expression, /__NEXT_DATA__/u);
        assert.match(params.expression, /history\.state/u);
        assert.equal(params.expression.includes('rawSource'), false);
        assert.equal(params.expression.includes('textContent'), true);
        assert.equal(params.expression.includes('localStorage'), false);
        assert.equal(params.expression.includes('sessionStorage'), false);
        assert.equal(params.expression.includes('document.cookie'), false);
        assert.equal(params.expression.includes('sourceMap'), false);
        return {
          result: {
            value: {
              jsRoutes: [
                {
                  routePath: 'https://example.invalid/works/42?access_token=synthetic-route-token',
                  label: 'Profile Alice alice@example.invalid 203.0.113.7 BrowserProfile run-handler.mjs',
                  descriptorSource: 'href',
                },
                {
                  routePath: '/settings?session_id=synthetic-data-route-session',
                  label: 'Settings',
                  descriptorSource: 'data-route',
                },
                {
                  routePath: '/profile/me?access_token=synthetic-runtime-route-token',
                  label: 'window.location.pathname',
                  nodeKind: 'runtime-route',
                  descriptorSource: 'window.location.pathname',
                },
                {
                  routePath: '/checkout/review?session_id=synthetic-history-route-session',
                  label: 'window.history.state.location.pathname',
                  nodeKind: 'runtime-route',
                  descriptorSource: 'window.history.state.location.pathname',
                  rawState: {
                    token: 'synthetic-history-raw-token',
                  },
                },
                {
                  routePath: `/search/${'x'.repeat(700)}?access_token=synthetic-overlong-history-token`,
                  label: 'window.history.state.route',
                  nodeKind: 'runtime-route',
                  descriptorSource: 'window.history.state.route',
                },
                {
                  routePath: 'https://example.invalid/static/site.css',
                  label: 'stylesheet',
                  descriptorSource: 'link.stylesheet',
                },
              ],
              scriptRoutes: [
                {
                  scriptUrl: 'https://example.invalid/assets/app.js?token=synthetic-script-token',
                  label: 'Signed in as Alice alice@example.invalid 203.0.113.7 BrowserProfile run-handler.mjs',
                  descriptorSource: 'script.src',
                },
              ],
            },
          },
        };
      },
    },
    sessionId: 'session-1',
    targetId: 'target-1',
    timeoutMs: 50,
    networkTracker: { dispose() {} },
  });

  const hints = await session.getObservedPageDomRouteHints({
    siteKey: 'example',
  });

  assert.equal(hints.jsRoutes.length, 5);
  assert.equal(hints.scriptRoutes.length, 1);
  assert.equal(hints.jsRoutes.every((entry) => entry.status === 'observed'), true);
  assert.equal(hints.jsRoutes.filter((entry) => entry.source === 'browser.dom.route-hint').length, 2);
  assert.equal(hints.jsRoutes.filter((entry) => entry.source === 'browser.runtime.route-hint').length, 3);
  assert.equal(hints.jsRoutes[2].nodeKind, 'runtime-route');
  assert.equal(hints.jsRoutes[3].descriptorSource, 'window.history.state.location.pathname');
  assert.equal(hints.jsRoutes[4].descriptorSource, 'window.history.state.route');
  assert.equal(hints.jsRoutes[4].routePath.length <= 500, true);
  assert.equal(hints.scriptRoutes[0].source, 'browser.dom.script-src-route-hint');
  assert.equal(Object.hasOwn(hints.jsRoutes[0], 'rawSource'), false);
  assert.equal(Object.hasOwn(hints.jsRoutes[3], 'rawState'), false);
  assert.equal(Object.hasOwn(hints.scriptRoutes[0], 'sourceText'), false);
  assert.equal(JSON.stringify(hints).includes('synthetic-route-token'), false);
  assert.equal(JSON.stringify(hints).includes('synthetic-data-route-session'), false);
  assert.equal(JSON.stringify(hints).includes('synthetic-runtime-route-token'), false);
  assert.equal(JSON.stringify(hints).includes('synthetic-history-route-session'), false);
  assert.equal(JSON.stringify(hints).includes('synthetic-history-raw-token'), false);
  assert.equal(JSON.stringify(hints).includes('synthetic-overlong-history-token'), false);
  assert.equal(JSON.stringify(hints).includes('synthetic-script-token'), false);
  assert.equal(JSON.stringify(hints).includes('Alice'), false);
  assert.equal(JSON.stringify(hints).includes('alice@example.invalid'), false);
  assert.equal(JSON.stringify(hints).includes('203.0.113.7'), false);
  assert.equal(JSON.stringify(hints).includes('BrowserProfile'), false);
  assert.equal(JSON.stringify(hints).includes('run-handler.mjs'), false);
  assert.equal(hints.jsRoutes.some((entry) => String(entry.routePath).includes('site.css')), false);
});

test('BrowserSession callPageFunction retries a transient Runtime.evaluate timeout once', async () => {
  let attempts = 0;
  const session = new BrowserSession({
    client: {
      async send(method, params) {
        attempts += 1;
        assert.equal(method, 'Runtime.evaluate');
        assert.match(params.expression, /^\(\(\) => 7\)\(\)$/);
        if (attempts === 1) {
          throw new Error('CDP timeout for Runtime.evaluate');
        }
        return {
          result: {
            value: 7,
          },
        };
      },
    },
    sessionId: 'session-1',
    targetId: 'target-1',
    timeoutMs: 50,
    networkTracker: { dispose() {} },
  });

  const value = await session.callPageFunction(() => 7);
  assert.equal(value, 7);
  assert.equal(attempts, 2);
});

test('BrowserSession waitForSettled degrades after document ready when dom quiet hits an inspected-target-navigated Runtime.evaluate failure', async () => {
  const session = createSettledWaitSession({
    domQuietError: new Error('CDP Runtime.evaluate failed: Inspected target navigated or closed'),
  });

  await assert.doesNotReject(async () => {
    await session.waitForSettled({
      useLoadEvent: false,
      useNetworkIdle: false,
      documentReadyTimeoutMs: 25,
      domQuietMs: 20,
      domQuietTimeoutMs: 30,
    });
  });

  const metrics = session.getMetrics();
  assert.equal(metrics.counts.waitForSettled, 1);
  assert.equal(metrics.counts.waitForDocumentReady, 3);
  assert.equal(metrics.counts.waitForDomQuiet, 1);
  assert.equal(metrics.counts.callPageFunction, 2);
  assert.equal(metrics.counts.evaluateValue, 3);
  assert.deepEqual(metrics.waitPolicies, [{
    useLoadEvent: false,
    useNetworkIdle: false,
    documentReadyTimeoutMs: 25,
    domQuietTimeoutMs: 30,
    domQuietMs: 20,
    networkQuietMs: null,
    networkIdleTimeoutMs: null,
    idleMs: null,
  }]);
});

test('BrowserSession waitForSettled does not swallow a non-target dom quiet Runtime.evaluate failure after document ready', async () => {
  const session = createSettledWaitSession({
    domQuietError: new Error('CDP Runtime.evaluate failed: Execution context was destroyed'),
  });

  await assert.rejects(
    () => session.waitForSettled({
      useLoadEvent: false,
      useNetworkIdle: false,
      documentReadyTimeoutMs: 25,
      domQuietMs: 20,
      domQuietTimeoutMs: 30,
    }),
    /Execution context was destroyed/u,
  );

  const metrics = session.getMetrics();
  assert.equal(metrics.counts.waitForSettled, 1);
  assert.equal(metrics.counts.waitForDocumentReady, 1);
  assert.equal(metrics.counts.waitForDomQuiet, 1);
  assert.equal(metrics.counts.callPageFunction, 1);
  assert.equal(metrics.counts.evaluateValue, 1);
});
