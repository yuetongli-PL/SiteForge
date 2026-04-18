import test from 'node:test';
import assert from 'node:assert/strict';

import { openBrowserSession } from '../../lib/browser-runtime/session.mjs';

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
