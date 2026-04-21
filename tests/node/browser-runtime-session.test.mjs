import test from 'node:test';
import assert from 'node:assert/strict';

import { BrowserSession, openBrowserSession } from '../../src/infra/browser/session.mjs';

class FakeCdpClient {
  constructor(_wsUrl, _options = {}) {
    this.calls = [];
    this.targetInfos = [];
    this.closed = false;
  }

  async connect() {}

  async send(method, params = {}, sessionId) {
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
    assert.equal(clientInstance.calls.some((call) => call.method === 'Target.createTarget'), false);
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
    assert.equal(clientInstance.calls.some((call) => call.method === 'Target.createTarget'), false);
  } finally {
    await session.close();
  }
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

      async send(method, params = {}, sessionId) {
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
