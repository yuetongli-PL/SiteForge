import test from 'node:test';
import assert from 'node:assert/strict';

import { BrowserSession } from '../../src/infra/browser/session.mjs';

test('BrowserSession metrics count protocol and helper activity without changing caller APIs', async () => {
  const sentMethods = /** @type {any[]} */ ([]);
  const fakeClient = {
    async send(method, params) {
      sentMethods.push(method);
      if (method === 'Runtime.evaluate') {
        const expression = String(params.expression || '');
        if (expression.includes('__BENCH__')) {
          return { result: { value: true } };
        }
        if (expression.includes('globalThis["__BENCH__"]["method"](')) {
          return { result: { value: { helper: true } } };
        }
        return { result: { value: 'ok' } };
      }
      if (method === 'Page.navigate') {
        return {};
      }
      if (method === 'Page.captureScreenshot') {
        return { data: Buffer.from('image').toString('base64') };
      }
      if (method === 'DOMSnapshot.captureSnapshot') {
        return { documents: [] };
      }
      if (method === 'Page.getFrameTree') {
        return { frameTree: { frame: { url: 'https://example.com/' } } };
      }
      if (method === 'Target.closeTarget') {
        return {};
      }
      throw new Error(`Unexpected method: ${method}`);
    },
    on() {
      return () => undefined;
    },
    waitForEvent() {
      return Promise.resolve({});
    },
    close() {},
  };

  const session = new BrowserSession({
    client: fakeClient,
    sessionId: 'session-1',
    targetId: 'target-1',
    networkTracker: {
      dispose() {},
      async waitForIdle() {},
    },
  });

  await session.navigateAndWait('https://example.com/', {
    useLoadEvent: true,
    useNetworkIdle: false,
    documentReadyTimeoutMs: 100,
    idleMs: 0,
  });
  await session.captureHtml();
  await session.captureSnapshot();
  await session.captureScreenshot();
  await session.invokeHelperMethod('method', [], {
    namespace: '__BENCH__',
    bundleSource: '(() => { globalThis["__BENCH__"] = { __version: 1, method: () => ({ helper: true }) }; return globalThis["__BENCH__"]; })()',
    fallbackFn: () => ({ helper: false }),
  });
  await session.close();

  const metrics = session.getMetrics();
  assert.equal(metrics.counts.navigateAndWait, 1);
  assert.equal(metrics.counts.captureHtml, 1);
  assert.equal(metrics.counts.captureSnapshot, 1);
  assert.equal(metrics.counts.captureScreenshot, 1);
  assert.equal(metrics.counts.helperEnsure, 1);
  assert.equal(metrics.counts.helperInvoke, 1);
  assert.equal(metrics.protocol.byMethod['Page.navigate'], 1);
  assert.ok(sentMethods.includes('Runtime.evaluate'));
});
