import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { capture } from '../../capture.mjs';
import { expandStates } from '../../expand-states.mjs';
import { BrowserSession } from '../../lib/browser-runtime/session.mjs';

async function createInitialManifest(workspace, url) {
  const captureDir = path.join(workspace, 'initial-capture');
  await mkdir(captureDir, { recursive: true });

  const htmlPath = path.join(captureDir, 'page.html');
  const snapshotPath = path.join(captureDir, 'dom-snapshot.json');
  const screenshotPath = path.join(captureDir, 'screenshot.png');
  const manifestPath = path.join(captureDir, 'manifest.json');

  await writeFile(htmlPath, '<html><body>initial</body></html>', 'utf8');
  await writeFile(snapshotPath, JSON.stringify({ documents: [] }, null, 2), 'utf8');
  await writeFile(screenshotPath, Buffer.from('seed'));

  const manifest = {
    inputUrl: url,
    finalUrl: url,
    title: 'Initial Page',
    capturedAt: '2026-04-15T00:00:00.000Z',
    files: {
      html: htmlPath,
      snapshot: snapshotPath,
      screenshot: screenshotPath,
      manifest: manifestPath,
    },
    page: {
      viewportWidth: 1280,
      viewportHeight: 720,
    },
    pageFacts: null,
  };

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return manifestPath;
}

test('capture keeps manifest shape and screenshot fallback behavior when runtime falls back to viewport capture', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-contract-'));
  const screenshotBase64 = Buffer.from('fake-image').toString('base64');
  const navigateCalls = [];
  let closed = false;

  const fakeSession = {
    async navigateAndWait(url, waitPolicy) {
      navigateCalls.push({ url, waitPolicy });
    },
    async captureHtml() {
      return '<html><body>captured</body></html>';
    },
    async captureSnapshot() {
      return { documents: [{ nodes: [] }] };
    },
    async captureScreenshot() {
      return {
        data: screenshotBase64,
        usedViewportFallback: true,
        primaryError: new Error('full page unsupported'),
      };
    },
    async getPageMetadata() {
      return {
        finalUrl: 'https://example.com/final',
        title: 'Captured Title',
        viewportWidth: 1200,
        viewportHeight: 800,
      };
    },
    async close() {
      closed = true;
    },
  };

  try {
    const manifest = await capture('https://example.com/', {
      outDir: workspace,
      waitUntil: 'networkidle',
      runtimeFactory: async () => fakeSession,
    });

    assert.equal(manifest.status, 'partial');
    assert.equal(manifest.error?.code, 'SCREENSHOT_FALLBACK');
    assert.equal(manifest.finalUrl, 'https://example.com/final');
    assert.equal(manifest.title, 'Captured Title');
    assert.equal(navigateCalls.length, 1);
    assert.equal(navigateCalls[0].waitPolicy.useNetworkIdle, true);
    assert.equal(closed, true);

    const writtenManifest = JSON.parse(await readFile(manifest.files.manifest, 'utf8'));
    assert.equal(writtenManifest.files.html.endsWith('page.html'), true);
    assert.equal(writtenManifest.files.snapshot.endsWith('dom-snapshot.json'), true);
    assert.equal(writtenManifest.files.screenshot.endsWith('screenshot.png'), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('expandStates keeps consecutive direct-nav triggers off the source DOM and restores only before same-document triggers', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-expand-contract-'));
  const baseUrl = 'https://example.com/';
  const detailUrl = 'https://example.com/books/1';
  const detailUrlTwo = 'https://example.com/books/2';
  const manifestPath = await createInitialManifest(workspace, baseUrl);
  const screenshotBase64 = Buffer.from('expand-image').toString('base64');
  const helperCalls = [];
  const navigateCalls = [];
  const postTriggerWaitPolicies = [];
  const captureCalls = [];
  let closed = false;

  const views = {
    [baseUrl]: {
      signature: {
        finalUrl: baseUrl,
        title: 'Home',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'home',
        pageFacts: null,
        fingerprint: { state: 'home' },
      },
      triggers: [
        {
          kind: 'safe-nav-link',
          label: 'Open Book One',
          href: detailUrl,
          locator: { tagName: 'a', role: 'link' },
        },
        {
          kind: 'safe-nav-link',
          label: 'Open Book Two',
          href: detailUrlTwo,
          locator: { tagName: 'a', role: 'link' },
        },
        {
          kind: 'tab',
          label: 'Details',
          locator: { tagName: 'button', role: 'tab' },
        },
      ],
    },
    [detailUrl]: {
      signature: {
        finalUrl: detailUrl,
        title: 'Book Detail One',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'auth-page',
        pageFacts: { bookTitle: 'Example Book One' },
        fingerprint: { state: 'detail-1' },
      },
      triggers: [],
    },
    [detailUrlTwo]: {
      signature: {
        finalUrl: detailUrlTwo,
        title: 'Book Detail Two',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'auth-page',
        pageFacts: { bookTitle: 'Example Book Two' },
        fingerprint: { state: 'detail-2' },
      },
      triggers: [],
    },
    '__tab__': {
      signature: {
        finalUrl: baseUrl,
        title: 'Home Details',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'auth-page',
        pageFacts: { tab: 'details' },
        fingerprint: { state: 'home-tab' },
      },
      triggers: [],
    },
  };

  const fakeSession = {
    currentViewKey: baseUrl,
    async navigateAndWait(url, waitPolicy) {
      navigateCalls.push({ url, waitPolicy });
      this.currentViewKey = url;
    },
    async waitForSettled(waitPolicy) {
      postTriggerWaitPolicies.push(waitPolicy);
    },
    async invokeHelperMethod(methodName, args) {
      helperCalls.push(methodName);
      if (methodName === 'pageComputeStateSignature') {
        return views[this.currentViewKey].signature;
      }
      if (methodName === 'pageDiscoverTriggers') {
        return views[this.currentViewKey].triggers;
      }
      if (methodName === 'pageExecuteTrigger') {
        const [trigger] = args;
        if (trigger.kind === 'tab') {
          this.currentViewKey = '__tab__';
          return {
            clicked: true,
            label: trigger.label,
            tagName: 'button',
            role: 'tab',
          };
        }
        throw new Error(`unexpected trigger kind: ${trigger.kind}`);
      }
      if (methodName === 'pageExtractChapterPayload') {
        throw new Error('chapter payload should not be requested in this test');
      }
      throw new Error(`unexpected helper method: ${methodName}`);
    },
    async captureHtml() {
      captureCalls.push('html');
      return `<html><body>${this.currentViewKey}</body></html>`;
    },
    async captureSnapshot() {
      captureCalls.push('snapshot');
      return { view: this.currentViewKey };
    },
    async captureScreenshot() {
      captureCalls.push('screenshot');
      return {
        data: screenshotBase64,
        usedViewportFallback: false,
        primaryError: null,
      };
    },
    async close() {
      closed = true;
    },
  };

  try {
    const manifest = await expandStates(baseUrl, {
      initialManifestPath: manifestPath,
      outDir: path.join(workspace, 'expanded'),
      runtimeFactory: async () => fakeSession,
      maxTriggers: 4,
      searchQueries: [],
      captureChapterArtifacts: false,
    });

    assert.equal(manifest.summary.capturedStates, 3);
    assert.equal(manifest.states.length, 4);
    assert.equal(helperCalls.filter((name) => name === 'pageExecuteTrigger').length, 1);
    assert.equal(navigateCalls.length, 5);
    assert.deepEqual(navigateCalls.map((entry) => entry.url), [baseUrl, baseUrl, detailUrl, detailUrlTwo, baseUrl]);
    assert.equal(postTriggerWaitPolicies.at(-1)?.useLoadEvent, false);
    assert.equal(postTriggerWaitPolicies.at(-1)?.useNetworkIdle, false);
    assert.equal(captureCalls.length, 9);
    assert.equal(closed, true);

    const directNavState = manifest.states.find((state) => state.finalUrl === detailUrl);
    assert.equal(directNavState?.status, 'captured');
    const secondDirectNavState = manifest.states.find((state) => state.finalUrl === detailUrlTwo);
    assert.equal(secondDirectNavState?.status, 'captured');
    const tabState = manifest.states.find((state) => state.title === 'Home Details');
    assert.equal(tabState?.status, 'captured');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('expandStates enforces maxCapturedStates as a hard limit beyond the initial state', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-expand-budget-contract-'));
  const baseUrl = 'https://example.com/';
  const detailUrl = 'https://example.com/books/1';
  const detailUrlTwo = 'https://example.com/books/2';
  const detailUrlThree = 'https://example.com/books/3';
  const manifestPath = await createInitialManifest(workspace, baseUrl);
  const screenshotBase64 = Buffer.from('budget-image').toString('base64');
  const navigateCalls = [];

  const views = {
    [baseUrl]: {
      signature: {
        finalUrl: baseUrl,
        title: 'Home',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'home',
        pageFacts: null,
        fingerprint: { state: 'home' },
      },
      triggers: [
        { kind: 'safe-nav-link', label: 'One', href: detailUrl, locator: { tagName: 'a', role: 'link' } },
        { kind: 'safe-nav-link', label: 'Two', href: detailUrlTwo, locator: { tagName: 'a', role: 'link' } },
        { kind: 'safe-nav-link', label: 'Three', href: detailUrlThree, locator: { tagName: 'a', role: 'link' } },
      ],
    },
    [detailUrl]: {
      signature: {
        finalUrl: detailUrl,
        title: 'Book One',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'auth-page',
        pageFacts: null,
        fingerprint: { state: 'detail-1' },
      },
      triggers: [],
    },
    [detailUrlTwo]: {
      signature: {
        finalUrl: detailUrlTwo,
        title: 'Book Two',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'auth-page',
        pageFacts: null,
        fingerprint: { state: 'detail-2' },
      },
      triggers: [],
    },
    [detailUrlThree]: {
      signature: {
        finalUrl: detailUrlThree,
        title: 'Book Three',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'auth-page',
        pageFacts: null,
        fingerprint: { state: 'detail-3' },
      },
      triggers: [],
    },
  };

  const fakeSession = {
    currentViewKey: baseUrl,
    async navigateAndWait(url) {
      navigateCalls.push(url);
      this.currentViewKey = url;
    },
    async waitForSettled() {},
    async invokeHelperMethod(methodName) {
      if (methodName === 'pageComputeStateSignature') {
        return views[this.currentViewKey].signature;
      }
      if (methodName === 'pageDiscoverTriggers') {
        return views[this.currentViewKey].triggers;
      }
      throw new Error(`unexpected helper method: ${methodName}`);
    },
    async captureHtml() {
      return `<html><body>${this.currentViewKey}</body></html>`;
    },
    async captureSnapshot() {
      return { view: this.currentViewKey };
    },
    async captureScreenshot() {
      return {
        data: screenshotBase64,
        usedViewportFallback: false,
        primaryError: null,
      };
    },
    async close() {},
  };

  try {
    const manifest = await expandStates(baseUrl, {
      initialManifestPath: manifestPath,
      outDir: path.join(workspace, 'expanded'),
      runtimeFactory: async () => fakeSession,
      maxTriggers: 4,
      maxCapturedStates: 1,
      searchQueries: [],
      captureChapterArtifacts: false,
    });

    assert.equal(manifest.summary.capturedStates, 1);
    assert.equal(manifest.states.filter((state) => state.status === 'captured').length, 1);
    assert.equal(manifest.states.length, 2);
    assert.equal(manifest.budget.hit, true);
    assert.match(manifest.budget.stopReason, /maxCapturedStates=1/u);
    assert.match(manifest.warnings.join('\n'), /maxCapturedStates=1/u);
    assert.deepEqual(navigateCalls, [baseUrl, baseUrl, detailUrl]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('expandStates uses lighter wait policies for moodyz direct-nav href triggers', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-expand-moodyz-wait-'));
  const baseUrl = 'https://www.moodyz.com/works/date/';
  const detailUrl = 'https://www.moodyz.com/works/detail/abc001';
  const manifestPath = await createInitialManifest(workspace, baseUrl);
  const screenshotBase64 = Buffer.from('moodyz-image').toString('base64');
  const navigateCalls = [];

  const views = {
    [baseUrl]: {
      signature: {
        finalUrl: baseUrl,
        title: 'Works Date',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'category-page',
        pageFacts: null,
        fingerprint: { state: 'moodyz-home' },
      },
      triggers: [
        {
          kind: 'content-link',
          label: 'Work Detail',
          href: detailUrl,
          locator: { tagName: 'a', role: 'link' },
        },
      ],
    },
    [detailUrl]: {
      signature: {
        finalUrl: detailUrl,
        title: 'Work Detail',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'auth-page',
        pageFacts: null,
        fingerprint: { state: 'moodyz-detail' },
      },
      triggers: [],
    },
  };

  const fakeSession = {
    currentViewKey: baseUrl,
    async navigateAndWait(url, waitPolicy) {
      navigateCalls.push({ url, waitPolicy });
      this.currentViewKey = url;
    },
    async waitForSettled() {},
    async invokeHelperMethod(methodName) {
      if (methodName === 'pageComputeStateSignature') {
        return views[this.currentViewKey].signature;
      }
      if (methodName === 'pageDiscoverTriggers') {
        return views[this.currentViewKey].triggers;
      }
      throw new Error(`unexpected helper method: ${methodName}`);
    },
    async captureHtml() {
      return `<html><body>${this.currentViewKey}</body></html>`;
    },
    async captureSnapshot() {
      return { view: this.currentViewKey };
    },
    async captureScreenshot() {
      return {
        data: screenshotBase64,
        usedViewportFallback: false,
        primaryError: null,
      };
    },
    async close() {},
  };

  try {
    await expandStates(baseUrl, {
      initialManifestPath: manifestPath,
      outDir: path.join(workspace, 'expanded'),
      runtimeFactory: async () => fakeSession,
      maxTriggers: 2,
      searchQueries: [],
      captureChapterArtifacts: false,
    });

    assert.equal(navigateCalls.length, 3);
    assert.equal(navigateCalls[2].url, detailUrl);
    assert.equal(navigateCalls[2].waitPolicy.useLoadEvent, false);
    assert.equal(navigateCalls[2].waitPolicy.useNetworkIdle, false);
    assert.equal(navigateCalls[2].waitPolicy.domQuietMs, 120);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('expandStates uses lighter wait policies for bilibili direct-nav author links', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-expand-bilibili-author-wait-'));
  const detailUrl = 'https://www.bilibili.com/video/BV1WjDDBGE3p';
  const authorUrl = 'https://space.bilibili.com/1202350411';
  const manifestPath = await createInitialManifest(workspace, detailUrl);
  const screenshotBase64 = Buffer.from('bilibili-author-image').toString('base64');
  const navigateCalls = [];

  const views = {
    [detailUrl]: {
      signature: {
        finalUrl: detailUrl,
        title: 'Video Detail',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'book-detail-page',
        pageFacts: { bookTitle: 'Video Detail' },
        fingerprint: { state: 'bilibili-detail' },
      },
      triggers: [
        {
          kind: 'safe-nav-link',
          label: 'Uploader',
          semanticRole: 'author',
          href: authorUrl,
          locator: { tagName: 'a', role: 'link' },
        },
      ],
    },
    [authorUrl]: {
      signature: {
        finalUrl: authorUrl,
        title: 'Uploader Space',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'author-page',
        pageFacts: { authorName: 'Uploader' },
        fingerprint: { state: 'bilibili-author' },
      },
      triggers: [],
    },
  };

  const fakeSession = {
    currentViewKey: detailUrl,
    async navigateAndWait(url, waitPolicy) {
      navigateCalls.push({ url, waitPolicy });
      this.currentViewKey = url;
    },
    async waitForSettled() {},
    async invokeHelperMethod(methodName) {
      if (methodName === 'pageComputeStateSignature') {
        return views[this.currentViewKey].signature;
      }
      if (methodName === 'pageDiscoverTriggers') {
        return views[this.currentViewKey].triggers;
      }
      throw new Error(`unexpected helper method: ${methodName}`);
    },
    async captureHtml() {
      return `<html><body>${this.currentViewKey}</body></html>`;
    },
    async captureSnapshot() {
      return { view: this.currentViewKey };
    },
    async captureScreenshot() {
      return {
        data: screenshotBase64,
        usedViewportFallback: false,
        primaryError: null,
      };
    },
    async close() {},
  };

  try {
    await expandStates(detailUrl, {
      initialManifestPath: manifestPath,
      outDir: path.join(workspace, 'expanded'),
      runtimeFactory: async () => fakeSession,
      maxTriggers: 2,
      searchQueries: [],
      captureChapterArtifacts: false,
    });

    const authorNavigation = navigateCalls.find((entry) => entry.url === authorUrl);
    assert.ok(authorNavigation);
    assert.equal(authorNavigation.waitPolicy.useLoadEvent, false);
    assert.equal(authorNavigation.waitPolicy.useNetworkIdle, false);
    assert.equal(authorNavigation.waitPolicy.domQuietMs, 140);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('expandStates uses bilibili search wait policy after submitted search-form triggers', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-expand-bilibili-search-wait-'));
  const baseUrl = 'https://www.bilibili.com/';
  const searchUrl = 'https://search.bilibili.com/all?keyword=BV1WjDDBGE3p';
  const manifestPath = await createInitialManifest(workspace, baseUrl);
  const screenshotBase64 = Buffer.from('bilibili-search-image').toString('base64');
  const postTriggerWaitPolicies = [];

  const views = {
    [baseUrl]: {
      signature: {
        finalUrl: baseUrl,
        title: 'bilibili',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'home',
        pageFacts: null,
        fingerprint: { state: 'bilibili-home' },
      },
      triggers: [
        {
          kind: 'search-form',
          label: 'Search: BV1WjDDBGE3p',
          queryText: 'BV1WjDDBGE3p',
          locator: { tagName: 'form', role: 'search' },
        },
      ],
    },
    [searchUrl]: {
      signature: {
        finalUrl: searchUrl,
        title: 'BV1WjDDBGE3p - bilibili search',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'search-results-page',
        pageFacts: { queryText: 'BV1WjDDBGE3p' },
        fingerprint: { state: 'bilibili-search' },
      },
      triggers: [],
    },
  };

  const fakeSession = {
    currentViewKey: baseUrl,
    async navigateAndWait(url) {
      this.currentViewKey = url;
    },
    async waitForSettled(waitPolicy) {
      postTriggerWaitPolicies.push(waitPolicy);
      this.currentViewKey = searchUrl;
    },
    async invokeHelperMethod(methodName, args) {
      if (methodName === 'pageComputeStateSignature') {
        return views[this.currentViewKey].signature;
      }
      if (methodName === 'pageDiscoverTriggers') {
        return views[this.currentViewKey].triggers;
      }
      if (methodName === 'pageExecuteTrigger') {
        const [trigger] = args;
        assert.equal(trigger.kind, 'search-form');
        return {
          clicked: true,
          label: trigger.label,
          tagName: 'form',
          role: 'search',
          submitted: true,
          directNavigation: true,
          navigationUrl: searchUrl,
        };
      }
      throw new Error(`unexpected helper method: ${methodName}`);
    },
    async captureHtml() {
      return `<html><body>${this.currentViewKey}</body></html>`;
    },
    async captureSnapshot() {
      return { view: this.currentViewKey };
    },
    async captureScreenshot() {
      return {
        data: screenshotBase64,
        usedViewportFallback: false,
        primaryError: null,
      };
    },
    async close() {},
  };

  try {
    await expandStates(baseUrl, {
      initialManifestPath: manifestPath,
      outDir: path.join(workspace, 'expanded'),
      runtimeFactory: async () => fakeSession,
      maxTriggers: 1,
      searchQueries: ['BV1WjDDBGE3p'],
      captureChapterArtifacts: false,
    });

    assert.equal(postTriggerWaitPolicies.length, 1);
    assert.equal(postTriggerWaitPolicies[0].useLoadEvent, false);
    assert.equal(postTriggerWaitPolicies[0].useNetworkIdle, false);
    assert.equal(postTriggerWaitPolicies[0].domQuietMs, 160);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('BrowserSession reinjects helper bundle when a stale helper namespace disappears after navigation', async () => {
  let installed = false;
  let helperCallCount = 0;
  let installCount = 0;

  const fakeClient = {
    async send(method, params) {
      assert.equal(method, 'Runtime.evaluate');
      const expression = String(params.expression || '');
      if (expression.includes('__version') && expression.includes('pageComputeStateSignature')) {
        installed = true;
        installCount += 1;
        return { result: { value: true } };
      }
      if (expression.includes('globalThis["__BWS_EXPAND__"]["pageComputeStateSignature"](')) {
        helperCallCount += 1;
        if (!installed) {
          return { exceptionDetails: { text: 'Cannot read properties of undefined' } };
        }
        return { result: { value: { ok: true } } };
      }
      throw new Error(`Unexpected expression: ${expression}`);
    },
    on() {
      return () => undefined;
    },
    waitForEvent() {
      throw new Error('waitForEvent should not be used in this test');
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
  session.helperReady.add('__BWS_EXPAND__');

  const bundleSource = `(() => {
    const api = {
      __version: 1,
      pageComputeStateSignature: () => ({ ok: true }),
    };
    globalThis["__BWS_EXPAND__"] = api;
    return api;
  })()`;

  const result = await session.invokeHelperMethod('pageComputeStateSignature', [], {
    namespace: '__BWS_EXPAND__',
    bundleSource,
    fallbackFn: () => ({ ok: false }),
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(helperCallCount, 2);
  assert.equal(installCount, 1);
});
