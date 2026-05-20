import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { capture, writeCaptureManifest } from '../../src/entrypoints/pipeline/capture.mjs';
import { derivePageFacts, expandStates } from '../../src/entrypoints/pipeline/expand-states.mjs';
import { BrowserSession } from '../../src/infra/browser/session.mjs';
import { API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION } from '../../src/domain/capabilities/api-candidates.mjs';
import { requireReasonCodeDefinition } from '../../src/domain/risks/reason-codes.mjs';
import { REDACTION_PLACEHOLDER } from '../../src/domain/sessions/security-guard.mjs';

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

test('expand top-level manifest redacts synthetic query secrets before persisting', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-expand-top-redaction-'));
  const sensitiveUrl = 'https://example.com/?refresh_token=synthetic-expand-token';
  const manifestPath = await createInitialManifest(workspace, sensitiveUrl);
  const fakeSession = {
    currentViewKey: sensitiveUrl,
    async navigateAndWait(url) {
      this.currentViewKey = url;
    },
    async invokeHelperMethod(methodName) {
      if (methodName === 'pageComputeStateSignature') {
        return {
          finalUrl: sensitiveUrl,
          title: 'Initial Page',
          viewportWidth: 1280,
          viewportHeight: 720,
          pageType: 'home',
          fingerprint: {
            url: sensitiveUrl,
            title: 'Initial Page',
            bodyText: 'initial',
          },
          pageFacts: null,
        };
      }
      if (methodName === 'pageDiscoverTriggers') {
        return [];
      }
      throw new Error(`unexpected helper method: ${methodName}`);
    },
    async close() {},
  };

  try {
    const manifest = await expandStates(sensitiveUrl, {
      initialManifestPath: manifestPath,
      outDir: path.join(workspace, 'expanded'),
      runtimeFactory: async () => fakeSession,
      maxTriggers: 0,
      maxCapturedStates: 0,
      searchQueries: [],
      captureChapterArtifacts: false,
    });

    const persisted = JSON.parse(await readFile(path.join(manifest.outDir, 'states-manifest.json'), 'utf8'));
    assert.equal(JSON.stringify(persisted).includes('synthetic-expand-token'), false);
    assert.match(persisted.inputUrl, /\[REDACTED\]/u);
    assert.equal(typeof persisted.redactionAudit, 'string');
    const audit = JSON.parse(await readFile(persisted.redactionAudit, 'utf8'));
    assert.equal(JSON.stringify(audit).includes('synthetic-expand-token'), false);
    assert.equal(audit.redactedPaths.includes('inputUrl'), true);
    assert.equal(audit.redactedPaths.includes('baseUrl'), true);
    const initialState = JSON.parse(await readFile(persisted.states[0].files.manifest, 'utf8'));
    assert.equal(JSON.stringify(initialState).includes('synthetic-expand-token'), false);
    assert.match(initialState.inputUrl, /\[REDACTED\]/u);
    assert.equal(typeof initialState.files.redactionAudit, 'string');
    const initialAudit = JSON.parse(await readFile(initialState.files.redactionAudit, 'utf8'));
    assert.equal(JSON.stringify(initialAudit).includes('synthetic-expand-token'), false);
    assert.equal(initialAudit.redactedPaths.includes('inputUrl'), true);
    assert.equal(initialAudit.redactedPaths.includes('finalUrl'), true);
    assert.equal(manifest.inputUrl.includes('synthetic-expand-token'), true);
    assert.equal(manifest.states[0].files.redactionAudit, initialState.files.redactionAudit);
    assert.equal(manifest.redactionAudit, persisted.redactionAudit);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('expand captured state manifest redacts synthetic query secrets before persisting', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-expand-captured-redaction-'));
  const baseUrl = 'https://example.com/';
  const detailUrl = 'https://example.com/books/1?refresh_token=synthetic-expand-token';
  const manifestPath = await createInitialManifest(workspace, baseUrl);
  const screenshotBase64 = Buffer.from('expand-redaction-image').toString('base64');
  const views = {
    [baseUrl]: {
      signature: {
        finalUrl: baseUrl,
        title: 'Home',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'home',
        fingerprint: { state: 'home' },
        pageFacts: null,
      },
      triggers: [{
        kind: 'content-link',
        label: 'Open Detail',
        href: detailUrl,
        locator: { tagName: 'a', role: 'link' },
      }],
    },
    [detailUrl]: {
      signature: {
        finalUrl: detailUrl,
        title: 'Detail',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'content-detail',
        fingerprint: { state: 'detail' },
        pageFacts: null,
      },
      triggers: [],
    },
  };
  const fakeSession = {
    currentViewKey: baseUrl,
    async navigateAndWait(url) {
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
      maxTriggers: 1,
      maxCapturedStates: 1,
      searchQueries: [],
      captureChapterArtifacts: false,
    });

    const capturedState = manifest.states.find((state) => state.status === 'captured');
    assert.ok(capturedState);
    const persisted = JSON.parse(await readFile(capturedState.files.manifest, 'utf8'));
    assert.equal(JSON.stringify(persisted).includes('synthetic-expand-token'), false);
    assert.match(persisted.finalUrl, /\[REDACTED\]/u);
    assert.equal(typeof persisted.files.redactionAudit, 'string');
    const audit = JSON.parse(await readFile(persisted.files.redactionAudit, 'utf8'));
    assert.equal(JSON.stringify(audit).includes('synthetic-expand-token'), false);
    assert.equal(audit.redactedPaths.includes('finalUrl'), true);
    assert.equal(audit.redactedPaths.includes('trigger.href'), true);
    assert.equal(capturedState.finalUrl.includes('synthetic-expand-token'), true);
    assert.equal(capturedState.files.redactionAudit, persisted.files.redactionAudit);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('expandStates persists DOM trigger outcome inventories for budgeted unattempted triggers', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-expand-trigger-outcomes-'));
  const baseUrl = 'https://example.com/';
  const detailOneUrl = 'https://example.com/detail/1?access_token=synthetic-expand-trigger-token';
  const detailTwoUrl = 'https://example.com/detail/2?csrf_token=synthetic-expand-trigger-csrf';
  const detailThreeUrl = 'https://example.com/detail/3?session_id=synthetic-expand-trigger-session';
  const manifestPath = await createInitialManifest(workspace, baseUrl);
  const screenshotBase64 = Buffer.from('expand-trigger-outcomes-image').toString('base64');
  const views = {
    [baseUrl]: {
      signature: {
        finalUrl: baseUrl,
        title: 'Home',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'home',
        fingerprint: { state: 'home' },
        pageFacts: null,
      },
      triggers: [
        {
          kind: 'content-link',
          label: 'Detail One',
          href: detailOneUrl,
          locator: {
            primary: 'dom',
            tagName: 'a',
            role: 'link',
            href: detailOneUrl,
            domPath: 'body > main:nth-of-type(1) > a:nth-of-type(1)',
            textSnippet: 'Detail One',
          },
        },
        {
          kind: 'content-link',
          label: 'Detail Two',
          href: detailTwoUrl,
          locator: {
            primary: 'dom',
            tagName: 'a',
            role: 'link',
            href: detailTwoUrl,
            domPath: 'body > main:nth-of-type(1) > a:nth-of-type(2)',
            textSnippet: 'Detail Two',
          },
        },
        {
          kind: 'content-link',
          label: 'Detail Three',
          href: detailThreeUrl,
          locator: {
            primary: 'a11y',
            tagName: 'a',
            role: 'link',
            href: detailThreeUrl,
            domPath: 'body > main:nth-of-type(1) > a:nth-of-type(3)',
            textSnippet: 'Detail Three',
          },
        },
      ],
    },
    [detailOneUrl]: {
      signature: {
        finalUrl: detailOneUrl,
        title: 'Detail One',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'content-detail-page',
        fingerprint: { state: 'detail-one' },
        pageFacts: null,
      },
      triggers: [],
    },
  };
  const fakeSession = {
    currentViewKey: baseUrl,
    async navigateAndWait(url) {
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
      maxTriggers: 6,
      maxCapturedStates: 1,
      searchQueries: [],
      captureChapterArtifacts: false,
    });

    assert.equal(manifest.candidateTriggers.length, 3);
    assert.equal(manifest.budgetSkippedTriggers.length, 2);
    assert.equal(manifest.unattemptedTriggers.length, 2);
    assert.equal(manifest.budgetSkippedTriggers.every((entry) => entry.discoveryStatus === 'skipped_by_budget'), true);
    assert.equal(manifest.unattemptedTriggers.every((entry) => entry.discoveryStatus === 'unattempted'), true);
    assert.equal(manifest.unattemptedTriggers.some((entry) => entry.locator?.primary === 'a11y'), true);
    assert.equal(
      JSON.stringify([
        ...manifest.candidateTriggers,
        ...manifest.budgetSkippedTriggers,
        ...manifest.unattemptedTriggers,
      ]).includes('synthetic-expand-trigger'),
      false,
    );
    const persisted = JSON.parse(await readFile(path.join(manifest.outDir, 'states-manifest.json'), 'utf8'));
    assert.equal(JSON.stringify(persisted).includes('synthetic-expand-trigger'), false);
    assert.equal(persisted.unattemptedTriggers.length, 2);
    assert.equal(persisted.budgetSkippedTriggers[0].href.includes('[REDACTED]'), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

function createXiaohongshuSiteProfile() {
  return {
    host: 'www.xiaohongshu.com',
    pageTypes: {
      homeExact: ['/explore'],
      homePrefixes: [],
      searchResultsPrefixes: ['/search_result'],
      contentDetailPrefixes: ['/explore/'],
      authorPrefixes: ['/user/profile/'],
      authorListExact: [],
      authorListPrefixes: [],
      authorDetailPrefixes: ['/user/profile/'],
      chapterPrefixes: [],
      historyPrefixes: [],
      authPrefixes: ['/login', '/register'],
      categoryPrefixes: ['/explore'],
    },
    search: {
      formSelectors: ['.search-layout', '.search-layout__top', '.search-input-box'],
      inputSelectors: [
        'input#search-input',
        'input.search-input',
        'input[placeholder*="搜索"]',
        'input[type="search"]',
      ],
      submitSelectors: [
        '[aria-label*="搜索"]',
        '.search-icon',
        'button[type="submit"]',
      ],
      queryParamNames: ['keyword', 'searchkey'],
      resultBookSelectors: [
        'section.note-item a[href*="/explore/"]',
        'a.cover[href*="/explore/"]',
        'a.title[href*="/explore/"]',
        'a[href*="/explore/"]',
      ],
    },
    contentDetail: {
      titleSelectors: [
        '.note-content .title',
        '.note-content .desc',
        'h1',
        'title',
      ],
      authorLinkSelectors: ['a[href*="/user/profile/"]'],
    },
    author: {
      workLinkSelectors: [
        'section.note-item a[href*="/explore/"]',
        'a.cover[href*="/explore/"]',
        'a.title[href*="/explore/"]',
        'a[href*="/explore/"]',
      ],
    },
  };
}

class FakeDomElement {
  constructor(tagName = 'div', attributes = {}, queryMap = {}) {
    this.tagName = String(tagName).toUpperCase();
    this.attributes = { ...attributes };
    this.id = String(attributes.id ?? '');
    this.innerText = String(attributes.innerText ?? '');
    this.textContent = String(attributes.textContent ?? this.innerText);
    this.isConnected = true;
    this.hidden = false;
    this._queryMap = new Map(Object.entries(queryMap));
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') {
      this.id = String(value);
    }
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  querySelector(selector) {
    return this._queryMap.get(selector) ?? null;
  }

  closest() {
    return null;
  }

  getBoundingClientRect() {
    return { width: 16, height: 16 };
  }
}

class FakeDomHTMLElement extends FakeDomElement {
  constructor(tagName = 'div', attributes = {}, queryMap = {}) {
    super(tagName, attributes, queryMap);
  }
}

class FakeDomFormElement extends FakeDomHTMLElement {
  constructor(attributes = {}, queryMap = {}) {
    super('form', attributes, queryMap);
    this.elements = [];
  }

  addElement(element) {
    this.elements.push(element);
    element.form = this;
  }

  submit() {
    this.submitted = true;
  }

  requestSubmit() {
    this.requestedSubmit = true;
  }
}

class FakeDomInputElement extends FakeDomHTMLElement {
  constructor(attributes = {}, value = '') {
    super('input', attributes);
    this.value = value;
    this.type = String(attributes.type ?? 'text');
    this.form = null;
  }

  focus() {}

  dispatchEvent() {
    return true;
  }
}

class FakeDomTextareaElement extends FakeDomHTMLElement {
  constructor(attributes = {}, value = '') {
    super('textarea', attributes);
    this.value = value;
    this.form = null;
  }

  focus() {}

  dispatchEvent() {
    return true;
  }
}

class FakeDomSelectElement extends FakeDomHTMLElement {
  constructor(attributes = {}, value = '') {
    super('select', attributes);
    this.value = value;
    this.form = null;
  }
}

async function withGlobalOverrides(overrides, callback) {
  const originals = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals.entries()) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete globalThis[key];
      }
    }
  }
}

async function runWithFakeXiaohongshuSearchDom({
  currentUrl,
  formAction,
  inputName = '',
}, callback) {
  const input = new FakeDomInputElement({ id: 'search-input', type: 'search', name: inputName });
  const submit = new FakeDomHTMLElement('button', { 'aria-label': 'Search', type: 'submit' });
  const form = new FakeDomFormElement({ action: formAction, method: 'get' }, {
    '[aria-label*="搜索"]': submit,
    '.search-icon': submit,
    'button[type="submit"]': submit,
  });
  form.addElement(input);

  const queryMap = new Map([
    ['.search-layout', form],
    ['.search-layout__top', form],
    ['.search-input-box', form],
    ['input#search-input', input],
    ['input.search-input', input],
    ['input[placeholder*="搜索"]', input],
    ['input[type="search"]', input],
    ['[aria-label*="搜索"]', submit],
    ['.search-icon', submit],
    ['button[type="submit"]', submit],
  ]);

  const document = {
    baseURI: currentUrl,
    body: {},
    querySelector(selector) {
      return queryMap.get(selector) ?? null;
    },
  };

  const location = {
    href: currentUrl,
    hostname: new URL(currentUrl).hostname,
    assign(nextUrl) {
      const resolved = new URL(nextUrl, this.href).toString();
      this.href = resolved;
      this.hostname = new URL(resolved).hostname;
    },
  };

  return await withGlobalOverrides({
    document,
    location,
    Element: FakeDomElement,
    HTMLElement: FakeDomHTMLElement,
    HTMLFormElement: FakeDomFormElement,
    HTMLInputElement: FakeDomInputElement,
    HTMLTextAreaElement: FakeDomTextareaElement,
    HTMLSelectElement: FakeDomSelectElement,
  }, callback);
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

test('capture writes runtime observed network requests into redacted api candidates', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-runtime-network-'));
  const screenshotBase64 = Buffer.from('network-image').toString('base64');
  const observedSiteKeys = [];
  const observedResponseSiteKeys = [];
  const observedResourceHintSiteKeys = [];
  const observedRouteHintSiteKeys = [];

  const fakeSession = {
    async navigateAndWait() {},
    async captureHtml() {
      return '<html><body>captured network</body></html>';
    },
    async captureSnapshot() {
      return { documents: [{ nodes: [] }] };
    },
    async captureScreenshot() {
      return {
        data: screenshotBase64,
        usedViewportFallback: false,
        primaryError: null,
      };
    },
    async getPageMetadata() {
      return {
        finalUrl: 'https://example.com/final',
        title: 'Captured Network',
        viewportWidth: 1200,
        viewportHeight: 800,
      };
    },
    async getObservedNetworkRequests({ siteKey }) {
      observedSiteKeys.push(siteKey);
      return [
        {
          siteKey,
          method: 'GET',
          url: 'https://example.com/api/feed?access_token=synthetic-capture-runtime-token&safe=1',
          headers: {
            authorization: 'Bearer synthetic-capture-runtime-token',
            accept: 'application/json',
          },
          body: {
            csrf: 'synthetic-capture-runtime-csrf',
            safe: true,
          },
          source: 'browser-network-tracker',
        },
      ];
    },
    async getObservedNetworkResponseSummaries({ siteKey }) {
      observedResponseSiteKeys.push(siteKey);
      return [
        {
          schemaVersion: API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION,
          candidateId: 'synthetic-runtime-response-candidate',
          siteKey,
          statusCode: 200,
          contentType: 'application/json',
          headerNames: ['content-type'],
          metadata: {
            requestId: 'synthetic-runtime-response-request',
            resourceType: 'XHR',
          },
        },
      ];
    },
    async getObservedPageResourceApiHints({ siteKey }) {
      observedResourceHintSiteKeys.push(siteKey);
      return [
        {
          siteKey,
          method: 'GET',
          url: 'https://example.com/api/hidden-feed.json?session_id=synthetic-resource-session',
          headers: {},
          source: 'browser.performance.resource',
          resourceType: 'Fetch',
          evidence: {
            resourceType: 'Fetch',
            initiatorType: 'resource-timing',
          },
        },
        {
          siteKey,
          method: 'POST',
          url: 'https://example.com/api/hidden-form?csrf=synthetic-dom-api-csrf',
          headers: {},
          source: 'browser.dom.api-hint',
          resourceType: 'Other',
          evidence: {
            resourceType: 'Other',
            initiatorType: 'dom-endpoint',
            descriptorSource: 'data-api-url',
          },
        },
      ];
    },
    async getObservedPageDomRouteHints({ siteKey }) {
      observedRouteHintSiteKeys.push(siteKey);
      return {
        jsRoutes: [
          {
            id: 'dom-route-detail',
            routePath: 'https://example.com/works/42?access_token=synthetic-dom-route-token',
            label: 'Profile Alice alice@example.invalid 203.0.113.7 BrowserProfile run-handler.mjs',
            source: 'browser.dom.route-hint',
            descriptorSource: 'href',
            status: 'observed',
            siteKey,
          },
          {
            id: 'dom-route-settings',
            routePath: '/settings?session_id=synthetic-dom-route-session',
            label: 'Settings Route',
            source: 'browser.dom.route-hint',
            descriptorSource: 'data-route',
            status: 'observed',
            siteKey,
          },
        ],
        scriptRoutes: [
          {
            id: 'script-route-app',
            routePath: 'https://example.com/assets/app.js?token=synthetic-script-route-token',
            scriptUrl: 'https://example.com/assets/app.js?token=synthetic-script-route-token',
            label: 'Signed in as Alice alice@example.invalid 203.0.113.7 BrowserProfile run-handler.mjs',
            source: 'browser.dom.script-src-route-hint',
            descriptorSource: 'script.src',
            status: 'observed',
            siteKey,
          },
        ],
      };
    },
    async close() {},
  };

  try {
    const manifest = await capture('https://example.com/', {
      outDir: workspace,
      siteProfile: {
        siteKey: 'example',
      },
      runtimeFactory: async () => fakeSession,
    });

    assert.equal(manifest.status, 'success');
    assert.deepEqual(observedSiteKeys, ['example']);
    assert.deepEqual(observedResponseSiteKeys, ['example']);
    assert.deepEqual(observedResourceHintSiteKeys, ['example']);
    assert.deepEqual(observedRouteHintSiteKeys, ['example']);
    assert.equal(manifest.networkRequests[0].headers.authorization, REDACTION_PLACEHOLDER);
    assert.equal(manifest.networkRequests[0].body.csrf, REDACTION_PLACEHOLDER);
    assert.equal(manifest.networkRequests[1].source, 'browser.performance.resource');
    assert.equal(manifest.networkRequests[1].url.includes('synthetic-resource-session'), false);
    assert.equal(manifest.networkRequests[2].source, 'browser.dom.api-hint');
    assert.equal(manifest.networkRequests[2].method, 'POST');
    assert.equal(manifest.networkRequests[2].url.includes('synthetic-dom-api-csrf'), false);
    assert.equal(manifest.jsRoutes.length, 2);
    assert.equal(manifest.scriptRoutes.length, 1);
    assert.equal(manifest.jsRoutes[0].source, 'browser.dom.route-hint');
    assert.equal(manifest.scriptRoutes[0].source, 'browser.dom.script-src-route-hint');
    assert.equal(Object.hasOwn(manifest.jsRoutes[0], 'rawSource'), false);
    assert.equal(JSON.stringify(manifest.jsRoutes).includes('synthetic-dom-route'), false);
    assert.equal(JSON.stringify(manifest.scriptRoutes).includes('synthetic-script-route-token'), false);
    assert.equal(JSON.stringify(manifest.jsRoutes).includes('Alice'), false);
    assert.equal(JSON.stringify(manifest.jsRoutes).includes('alice@example.invalid'), false);
    assert.equal(JSON.stringify(manifest.jsRoutes).includes('203.0.113.7'), false);
    assert.equal(JSON.stringify(manifest.jsRoutes).includes('BrowserProfile'), false);
    assert.equal(JSON.stringify(manifest.scriptRoutes).includes('run-handler.mjs'), false);
    assert.equal(manifest.networkResponseSummaries[0].siteKey, 'example');
    assert.equal(manifest.networkResponseSummaries[0].statusCode, 200);
    assert.equal(Object.hasOwn(manifest.networkResponseSummaries[0], 'headers'), false);
    assert.equal(Object.hasOwn(manifest.networkResponseSummaries[0], 'endpoint'), false);
    assert.equal(Object.hasOwn(manifest.networkResponseSummaries[0], 'catalogEntry'), false);
    assert.equal(JSON.stringify(manifest).includes('synthetic-capture-runtime-token'), false);
    assert.equal(JSON.stringify(manifest).includes('synthetic-capture-runtime-csrf'), false);

    const written = JSON.parse(await readFile(manifest.files.manifest, 'utf8'));
    assert.equal(written.networkRequests.length, 3);
    assert.equal(written.networkResponseSummaries.length, 1);
    assert.equal(written.networkRequests[0].siteKey, 'example');
    assert.equal(written.networkRequests[1].source, 'browser.performance.resource');
    assert.equal(written.networkRequests[1].url.includes('synthetic-resource-session'), false);
    assert.equal(written.networkRequests[2].source, 'browser.dom.api-hint');
    assert.equal(written.networkRequests[2].url.includes('synthetic-dom-api-csrf'), false);
    assert.equal(written.jsRoutes.length, 2);
    assert.equal(written.scriptRoutes.length, 1);
    assert.equal(written.jsRoutes[0].source, 'browser.dom.route-hint');
    assert.equal(written.scriptRoutes[0].source, 'browser.dom.script-src-route-hint');
    assert.equal(Object.hasOwn(written.jsRoutes[0], 'rawSource'), false);
    assert.equal(Object.hasOwn(written.scriptRoutes[0], 'sourceText'), false);
    assert.equal(written.networkResponseSummaries[0].siteKey, 'example');
    assert.equal(written.networkResponseSummaries[0].candidateId, 'synthetic-runtime-response-candidate');
    assert.equal(Object.hasOwn(written.networkResponseSummaries[0], 'headers'), false);
    assert.equal(Object.hasOwn(written.networkResponseSummaries[0], 'endpoint'), false);
    assert.equal(Object.hasOwn(written.networkResponseSummaries[0], 'catalogEntry'), false);
    assert.equal(written.networkRequests[0].headers.authorization, REDACTION_PLACEHOLDER);
    assert.equal(written.networkRequests[0].body.csrf, REDACTION_PLACEHOLDER);
    assert.equal(written.files.apiCandidates.length, 3);
    assert.equal(written.files.apiCandidateRedactionAudits.length, 3);
    assert.equal(JSON.stringify(written).includes('synthetic-capture-runtime-token'), false);
    assert.equal(JSON.stringify(written).includes('synthetic-capture-runtime-csrf'), false);
    assert.equal(JSON.stringify(written).includes('synthetic-resource-session'), false);
    assert.equal(JSON.stringify(written).includes('synthetic-dom-api-csrf'), false);
    assert.equal(JSON.stringify(written).includes('synthetic-dom-route'), false);
    assert.equal(JSON.stringify(written).includes('synthetic-script-route-token'), false);
    assert.equal(JSON.stringify(written).includes('Alice'), false);
    assert.equal(JSON.stringify(written).includes('alice@example.invalid'), false);
    assert.equal(JSON.stringify(written).includes('203.0.113.7'), false);
    assert.equal(JSON.stringify(written).includes('BrowserProfile'), false);
    assert.equal(JSON.stringify(written).includes('run-handler.mjs'), false);

    const candidate = JSON.parse(await readFile(written.files.apiCandidates[0], 'utf8'));
    assert.equal(candidate.status, 'observed');
    assert.equal(candidate.siteKey, 'example');
    assert.equal(candidate.source, 'browser-network-tracker');
    assert.equal(candidate.request.headers.authorization, REDACTION_PLACEHOLDER);
    assert.equal(candidate.request.body.csrf, REDACTION_PLACEHOLDER);
    const resourceCandidate = JSON.parse(await readFile(written.files.apiCandidates[1], 'utf8'));
    assert.equal(resourceCandidate.status, 'observed');
    assert.equal(resourceCandidate.source, 'browser.performance.resource');
    assert.equal(resourceCandidate.target.endpointKind, 'rest-json');
    assert.equal(resourceCandidate.endpoint.url.includes('synthetic-resource-session'), false);
    const domHintCandidate = JSON.parse(await readFile(written.files.apiCandidates[2], 'utf8'));
    assert.equal(domHintCandidate.status, 'observed');
    assert.equal(domHintCandidate.source, 'browser.dom.api-hint');
    assert.equal(domHintCandidate.endpoint.method, 'POST');
    assert.equal(domHintCandidate.target.observedApiAutoPromotionAllowed, false);
    assert.equal(domHintCandidate.endpoint.url.includes('synthetic-dom-api-csrf'), false);
    assert.equal(Object.hasOwn(written.files, 'apiCatalog'), false);
    assert.equal(Object.hasOwn(written.files, 'apiCatalogEntry'), false);
    await assert.rejects(
      () => access(path.join(path.dirname(manifest.files.manifest), 'api-catalog')),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(path.dirname(manifest.files.manifest), 'catalog')),
      /ENOENT/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('capture skips automatic response schema verification summaries without body evidence', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-response-schema-skip-'));
  const manifestPath = path.join(workspace, 'manifest.json');

  try {
    const manifest = {
      traceId: 'capture:test:response-schema-skip',
      correlationId: 'capture:test',
      inputUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      title: 'Response Schema Skip',
      capturedAt: '2026-05-05T00:00:00.000Z',
      status: 'success',
      outDir: workspace,
      files: {
        html: path.join(workspace, 'page.html'),
        snapshot: path.join(workspace, 'dom-snapshot.json'),
        screenshot: path.join(workspace, 'screenshot.png'),
        manifest: manifestPath,
      },
      page: {
        viewportWidth: 1200,
        viewportHeight: 800,
      },
      pageFacts: null,
      runtimeEvidence: null,
      error: null,
      responseSchemaVerification: {
        enabled: true,
        verifierId: 'focused-test',
        verifiedAt: '2026-05-05T00:00:00.000Z',
      },
      networkRequests: [
        {
          siteKey: 'example',
          method: 'GET',
          url: 'https://example.com/api/feed',
          headers: {
            accept: 'application/json',
          },
          source: 'browser-network-tracker',
        },
      ],
      networkResponseSummaries: [
        {
          schemaVersion: API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION,
          candidateId: 'response-without-body-evidence',
          siteKey: 'example',
          capturedAt: '2026-05-05T00:00:00.000Z',
          source: 'cdp.Network.responseReceived',
          statusCode: 200,
          contentType: 'text/html;charset=utf-8',
          headerNames: ['content-type'],
          metadata: {
            requestId: 'response-without-body-evidence',
            resourceType: 'Document',
          },
        },
      ],
    };

    await writeFile(manifest.files.html, '<html><body>ok</body></html>', 'utf8');
    await writeFile(manifest.files.snapshot, JSON.stringify({ documents: [] }, null, 2), 'utf8');
    await writeFile(manifest.files.screenshot, Buffer.from('image'));

    await writeCaptureManifest(manifest);

    const written = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(written.status, 'success');
    assert.equal(written.files.apiCandidates.length, 1);
    assert.equal(Object.hasOwn(written.files, 'apiResponseSchemaVerifications'), false);
    assert.equal(Object.hasOwn(written.files, 'apiResponseSchemaVerificationRedactionAudits'), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('capture preserves Douyin challenge evidence and marks the manifest as anti-crawl partial', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-douyin-challenge-'));
  const screenshotBase64 = Buffer.from('douyin-image').toString('base64');
  let closed = false;

  const fakeSession = {
    async navigateAndWait() {},
    async callPageFunction() {
      return {
        title: '验证码中间页',
        documentText: '验证码中间页 middle_page_loading',
        readyCount: 0,
        pageType: 'home',
      };
    },
    async captureHtml() {
      return '<html><body>challenge</body></html>';
    },
    async captureSnapshot() {
      return { documents: [{ nodes: [] }] };
    },
    async captureScreenshot() {
      return {
        data: screenshotBase64,
        usedViewportFallback: false,
        primaryError: null,
      };
    },
    async getPageMetadata() {
      return {
        finalUrl: 'https://www.douyin.com/',
        title: '验证码中间页',
        viewportWidth: 1200,
        viewportHeight: 800,
      };
    },
    async close() {
      closed = true;
    },
  };

  try {
    const manifest = await capture('https://www.douyin.com/?recommend=1', {
      outDir: workspace,
      siteProfile: {
        host: 'www.douyin.com',
      },
      runtimeFactory: async () => fakeSession,
    });

    assert.equal(manifest.status, 'partial');
    assert.equal(manifest.error?.code, 'ANTI_CRAWL_CHALLENGE');
    assert.equal(requireReasonCodeDefinition(manifest.error?.code, { family: 'capture' }).code, 'ANTI_CRAWL_CHALLENGE');
    assert.match(manifest.error?.message ?? '', /anti-crawl challenge/i);
    assert.equal(manifest.finalUrl, 'https://www.douyin.com/');
    assert.equal(manifest.title, '验证码中间页');
    assert.equal(closed, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('capture falls back to the input URL when a fatal Douyin CDP timeout occurs before page metadata is read', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-douyin-fatal-timeout-'));
  let closed = false;

  const fakeSession = {
    async navigateAndWait() {},
    async callPageFunction() {
      throw new Error('CDP timeout for Runtime.evaluate');
    },
    async close() {
      closed = true;
    },
  };

  try {
    const manifest = await capture('https://www.douyin.com/user/self?showTab=post', {
      outDir: workspace,
      siteProfile: {
        host: 'www.douyin.com',
      },
      runtimeFactory: async () => fakeSession,
    });

    assert.equal(manifest.status, 'failed');
    assert.equal(manifest.finalUrl, 'https://www.douyin.com/user/self?showTab=post');
    assert.equal(manifest.title, '');
    assert.equal(manifest.error?.code, 'HTML_CAPTURE_FAILED');
    assert.equal(requireReasonCodeDefinition(manifest.error?.code, { family: 'capture' }).code, 'HTML_CAPTURE_FAILED');
    assert.match(manifest.error?.message ?? '', /captureHtml is not a function/u);
    assert.equal(closed, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('capture retries a transient Douyin Runtime.evaluate timeout with a fresh session', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-douyin-retry-'));
  const screenshotBase64 = Buffer.from('douyin-retry-image').toString('base64');
  const sessionCreations = [];
  const sessionClosures = [];

  const runtimeFactory = async () => {
    const attempt = sessionCreations.length + 1;
    sessionCreations.push(attempt);
    if (attempt === 1) {
      throw new Error('CDP timeout for Runtime.evaluate');
    }
    return {
      async navigateAndWait() {},
      async callPageFunction() {
        return {
          title: '抖音',
          documentText: '抖音 推荐',
          readyCount: 1,
          pageType: 'home',
        };
      },
      async captureHtml() {
        return '<html><body>captured after retry</body></html>';
      },
      async captureSnapshot() {
        return { documents: [{ nodes: [] }] };
      },
      async captureScreenshot() {
        return {
          data: screenshotBase64,
          usedViewportFallback: false,
          primaryError: null,
        };
      },
      async getPageMetadata() {
        return {
          finalUrl: 'https://www.douyin.com/?recommend=1',
          title: '抖音-记录美好生活',
          viewportWidth: 1280,
          viewportHeight: 720,
        };
      },
      async close() {
        sessionClosures.push(`closed-${attempt}`);
      },
    };
  };

  try {
    const manifest = await capture('https://www.douyin.com/?recommend=1', {
      outDir: workspace,
      siteProfile: {
        host: 'www.douyin.com',
      },
      runtimeFactory,
    });

    assert.equal(manifest.status, 'success');
    assert.equal(manifest.finalUrl, 'https://www.douyin.com/?recommend=1');
    assert.equal(manifest.title, '抖音-记录美好生活');
    assert.equal(sessionCreations.length, 2);
    assert.equal(sessionClosures.includes('closed-2'), true);
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

test('expandStates recovers Douyin home navigations from document-ready timeouts by waiting for ready markers', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-expand-douyin-home-timeout-'));
  const baseUrl = 'https://www.douyin.com/';
  const manifestPath = await createInitialManifest(workspace, baseUrl);
  const navigateCalls = [];
  const readyMarkerChecks = [];
  let closed = false;
  let timeoutCount = 0;

  const fakeSession = {
    currentViewKey: baseUrl,
    async navigateAndWait(url, waitPolicy) {
      navigateCalls.push({ url, waitPolicy });
      this.currentViewKey = url;
      if (url === baseUrl && timeoutCount < 2) {
        timeoutCount += 1;
        throw new Error('Timed out waiting for document ready');
      }
    },
    async callPageFunction(_fn, selectors) {
      readyMarkerChecks.push(selectors);
      return Array.isArray(selectors) && selectors.some((selector) => /search|\/video\/|\/user\//iu.test(String(selector)))
        ? 2
        : 0;
    },
    async invokeHelperMethod(methodName) {
      if (methodName === 'pageComputeStateSignature') {
        return {
          finalUrl: baseUrl,
          title: '抖音',
          viewportWidth: 1280,
          viewportHeight: 720,
          pageType: 'home',
          pageFacts: null,
          fingerprint: { state: `home-${navigateCalls.length}` },
        };
      }
      if (methodName === 'pageDiscoverTriggers') {
        return [];
      }
      throw new Error(`unexpected helper method: ${methodName}`);
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
      siteProfile: {
        host: 'www.douyin.com',
      },
      maxTriggers: 1,
      searchQueries: [],
      captureChapterArtifacts: false,
    });

    assert.equal(manifest.summary.capturedStates, 0);
    assert.equal(navigateCalls.length, 2);
    assert.equal(timeoutCount, 2);
    assert.ok(readyMarkerChecks.length >= 4);
    assert.equal(closed, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('expandStates recovers Xiaohongshu explore navigations from document-ready timeouts by waiting for ready markers', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-expand-xiaohongshu-explore-timeout-'));
  const baseUrl = 'https://www.xiaohongshu.com/explore';
  const manifestPath = await createInitialManifest(workspace, baseUrl);
  const navigateCalls = [];
  const readyMarkerChecks = [];
  let closed = false;
  let timeoutCount = 0;

  const fakeSession = {
    currentViewKey: baseUrl,
    async navigateAndWait(url, waitPolicy) {
      navigateCalls.push({ url, waitPolicy });
      this.currentViewKey = url;
      if (url === baseUrl && timeoutCount < 1) {
        timeoutCount += 1;
        throw new Error('Timed out waiting for document ready');
      }
    },
    async callPageFunction(_fn, selectors) {
      readyMarkerChecks.push({ url: this.currentViewKey, selectors });
      return Array.isArray(selectors) && selectors.some((selector) => /note-item|\/explore\//iu.test(String(selector)))
        ? 2
        : 0;
    },
    async invokeHelperMethod(methodName) {
      if (methodName === 'pageComputeStateSignature') {
        return {
          finalUrl: baseUrl,
          title: 'Xiaohongshu Explore',
          viewportWidth: 1280,
          viewportHeight: 720,
          pageType: 'home',
          pageFacts: null,
          fingerprint: { state: `xhs-home-${navigateCalls.length}` },
        };
      }
      if (methodName === 'pageDiscoverTriggers') {
        return [];
      }
      throw new Error(`unexpected helper method: ${methodName}`);
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
      siteProfile: createXiaohongshuSiteProfile(),
      maxTriggers: 1,
      searchQueries: [],
      captureChapterArtifacts: false,
    });

    assert.equal(manifest.summary.capturedStates, 0);
    assert.equal(timeoutCount, 1);
    assert.ok(navigateCalls.length >= 1);
    assert.equal(navigateCalls[0].waitPolicy.useLoadEvent, false);
    assert.equal(navigateCalls[0].waitPolicy.useNetworkIdle, false);
    assert.ok(readyMarkerChecks.length >= 2);
    assert.equal(
      readyMarkerChecks.some((entry) => Array.isArray(entry.selectors) && entry.selectors.some((selector) => /note-item|\/explore\//iu.test(String(selector)))),
      true,
    );
    assert.equal(closed, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('expandStates retries the initial bootstrap with a fresh session after a transient CDP disconnect', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-expand-initial-retry-'));
  const baseUrl = 'https://www.douyin.com/';
  const manifestPath = await createInitialManifest(workspace, baseUrl);
  const sessionCreations = [];
  const sessionClosures = [];

  const runtimeFactory = async () => {
    const attempt = sessionCreations.length + 1;
    sessionCreations.push(attempt);
    if (attempt === 1) {
      return {
        async navigateAndWait() {
          throw new Error('CDP socket closed: 1006');
        },
        async close() {
          sessionClosures.push(`closed-${attempt}`);
        },
      };
    }
    return {
      async navigateAndWait() {},
      async invokeHelperMethod(methodName) {
        if (methodName === 'pageComputeStateSignature') {
          return {
            finalUrl: baseUrl,
            title: '抖音',
            viewportWidth: 1280,
            viewportHeight: 720,
            pageType: 'home',
            pageFacts: null,
            fingerprint: { state: 'retry-success' },
          };
        }
        if (methodName === 'pageDiscoverTriggers') {
          return [];
        }
        throw new Error(`unexpected helper method: ${methodName}`);
      },
      async close() {
        sessionClosures.push(`closed-${attempt}`);
      },
    };
  };

  try {
    const manifest = await expandStates(baseUrl, {
      initialManifestPath: manifestPath,
      outDir: path.join(workspace, 'expanded'),
      runtimeFactory,
      siteProfile: {
        host: 'www.douyin.com',
      },
      maxTriggers: 1,
      searchQueries: [],
      captureChapterArtifacts: false,
    });

    assert.equal(manifest.states.some((state) => state.state_id === 's0000'), true);
    assert.equal(sessionCreations.length, 2);
    assert.equal(sessionClosures.includes('closed-1'), true);
    assert.match(manifest.warnings.join('\n'), /Transient browser session failure occurred during initial expand bootstrap/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('expandStates retries the initial bootstrap with a fresh session after a transient Runtime.evaluate timeout', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-expand-initial-evaluate-retry-'));
  const baseUrl = 'https://www.douyin.com/';
  const manifestPath = await createInitialManifest(workspace, baseUrl);
  const sessionCreations = [];
  const sessionClosures = [];

  const runtimeFactory = async () => {
    const attempt = sessionCreations.length + 1;
    sessionCreations.push(attempt);
    if (attempt === 1) {
      return {
        async navigateAndWait() {},
        async invokeHelperMethod(methodName) {
          if (methodName === 'pageComputeStateSignature') {
            throw new Error('CDP timeout for Runtime.evaluate');
          }
          throw new Error(`unexpected helper method: ${methodName}`);
        },
        async close() {
          sessionClosures.push(`closed-${attempt}`);
        },
      };
    }
    return {
      async navigateAndWait() {},
      async invokeHelperMethod(methodName) {
        if (methodName === 'pageComputeStateSignature') {
          return {
            finalUrl: baseUrl,
            title: '抖音',
            viewportWidth: 1280,
            viewportHeight: 720,
            pageType: 'home',
            pageFacts: null,
            fingerprint: { state: 'runtime-evaluate-retry-success' },
          };
        }
        if (methodName === 'pageDiscoverTriggers') {
          return [];
        }
        throw new Error(`unexpected helper method: ${methodName}`);
      },
      async close() {
        sessionClosures.push(`closed-${attempt}`);
      },
    };
  };

  try {
    const manifest = await expandStates(baseUrl, {
      initialManifestPath: manifestPath,
      outDir: path.join(workspace, 'expanded'),
      runtimeFactory,
      siteProfile: {
        host: 'www.douyin.com',
      },
      maxTriggers: 1,
      searchQueries: [],
      captureChapterArtifacts: false,
    });

    assert.equal(manifest.states.some((state) => state.state_id === 's0000'), true);
    assert.equal(sessionCreations.length, 2);
    assert.equal(sessionClosures.includes('closed-1'), true);
    assert.match(manifest.warnings.join('\n'), /Transient browser session failure occurred during initial expand bootstrap/u);
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

test('expandStates falls back Xiaohongshu explore search submissions to /search_result and waits for hydrated note cards', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-expand-xiaohongshu-search-wait-'));
  const baseUrl = 'https://www.xiaohongshu.com/explore';
  const searchUrl = 'https://www.xiaohongshu.com/search_result?keyword=outfit&type=51';
  const manifestPath = await createInitialManifest(workspace, baseUrl);
  const screenshotBase64 = Buffer.from('xiaohongshu-search-image').toString('base64');
  const navigateCalls = [];
  const readyMarkerChecks = [];

  const views = {
    [baseUrl]: {
      signature: {
        finalUrl: baseUrl,
        title: 'Xiaohongshu Explore',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'home',
        pageFacts: null,
        fingerprint: { state: 'xhs-home' },
      },
      triggers: [
        {
          kind: 'search-form',
          label: 'Search: outfit',
          queryText: 'outfit',
          locator: { tagName: 'form', role: 'search' },
        },
      ],
    },
    [searchUrl]: {
      signature: {
        finalUrl: searchUrl,
        title: 'outfit - Xiaohongshu Search',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'search-results-page',
        pageFacts: { queryText: 'outfit' },
        fingerprint: { state: 'xhs-search' },
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
    async callPageFunction(_fn, selectors) {
      readyMarkerChecks.push({ url: this.currentViewKey, selectors });
      if (this.currentViewKey === searchUrl) {
        return Array.isArray(selectors) && selectors.some((selector) => /note-item|\/explore\//iu.test(String(selector)))
          ? 3
          : 0;
      }
      return Array.isArray(selectors) && selectors.some((selector) => /note-item|\/explore\//iu.test(String(selector)))
        ? 2
        : 0;
    },
    async invokeHelperMethod(methodName, args, options) {
      if (methodName === 'pageComputeStateSignature') {
        return views[this.currentViewKey].signature;
      }
      if (methodName === 'pageDiscoverTriggers') {
        return views[this.currentViewKey].triggers;
      }
      if (methodName === 'pageExecuteTrigger') {
        const result = await runWithFakeXiaohongshuSearchDom({
          currentUrl: baseUrl,
          formAction: baseUrl,
          inputName: '',
        }, async () => await options.fallbackFn(...args));
        if (result?.navigationUrl) {
          this.currentViewKey = result.navigationUrl;
        }
        return result;
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
      siteProfile: createXiaohongshuSiteProfile(),
      maxTriggers: 1,
      searchQueries: ['outfit'],
      captureChapterArtifacts: false,
    });

    assert.equal(manifest.summary.capturedStates, 1);
    assert.equal(manifest.states.some((state) => state.finalUrl === searchUrl), true);
    assert.equal(
      navigateCalls.some((entry) => entry.url === baseUrl && entry.waitPolicy.useLoadEvent === false && entry.waitPolicy.useNetworkIdle === false),
      true,
    );
    assert.equal(
      navigateCalls.some(
        (entry) => entry.url === searchUrl
          && entry.waitPolicy.useLoadEvent === true
          && entry.waitPolicy.useNetworkIdle === false
          && entry.waitPolicy.documentReadyTimeoutMs === 5_800
          && entry.waitPolicy.domQuietMs === 180,
      ),
      true,
    );
    assert.equal(
      readyMarkerChecks.some(
        (entry) => entry.url === searchUrl
          && Array.isArray(entry.selectors)
          && entry.selectors.some((selector) => /note-item|\/explore\//iu.test(String(selector))),
      ),
      true,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('expandStates retries Xiaohongshu tourist_search landings with a canonical /search_result navigation', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-expand-xiaohongshu-tourist-search-'));
  const baseUrl = 'https://www.xiaohongshu.com/explore';
  const touristSearchUrl = 'https://www.xiaohongshu.com/explore?source=tourist_search';
  const searchUrl = 'https://www.xiaohongshu.com/search_result?keyword=outfit&type=51';
  const manifestPath = await createInitialManifest(workspace, baseUrl);
  const screenshotBase64 = Buffer.from('xiaohongshu-tourist-search-image').toString('base64');
  const navigateCalls = [];

  const views = {
    [baseUrl]: {
      signature: {
        finalUrl: baseUrl,
        title: 'Xiaohongshu Explore',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'home',
        pageFacts: null,
        fingerprint: { state: 'xhs-home' },
      },
      triggers: [
        {
          kind: 'search-form',
          label: 'Search: outfit',
          queryText: 'outfit',
          locator: { tagName: 'form', role: 'search' },
        },
      ],
    },
    [touristSearchUrl]: {
      signature: {
        finalUrl: touristSearchUrl,
        title: 'Xiaohongshu Explore Tourist Search',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'home',
        pageFacts: null,
        fingerprint: { state: 'xhs-tourist-search' },
      },
      triggers: [],
    },
    [searchUrl]: {
      signature: {
        finalUrl: searchUrl,
        title: 'outfit - Xiaohongshu Search',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'search-results-page',
        pageFacts: {
          queryText: 'outfit',
          resultCount: 1,
          resultUrls: ['https://www.xiaohongshu.com/explore/note-1'],
        },
        fingerprint: { state: 'xhs-search-result' },
      },
      triggers: [],
    },
  };

  const fakeSession = {
    currentViewKey: baseUrl,
    routedThroughTouristSearch: false,
    async navigateAndWait(url, waitPolicy) {
      navigateCalls.push({ url, waitPolicy, from: this.currentViewKey });
      if (url === searchUrl && !this.routedThroughTouristSearch) {
        this.routedThroughTouristSearch = true;
        this.currentViewKey = touristSearchUrl;
        return;
      }
      this.currentViewKey = url;
    },
    async waitForSettled() {},
    async callPageFunction() {
      return this.currentViewKey === searchUrl ? 2 : 0;
    },
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
      siteProfile: createXiaohongshuSiteProfile(),
      maxTriggers: 1,
      searchQueries: ['outfit'],
      captureChapterArtifacts: false,
    });

    assert.equal(fakeSession.routedThroughTouristSearch, true);
    assert.equal(manifest.states.some((state) => state.finalUrl === searchUrl), true);
    assert.equal(manifest.states.some((state) => state.finalUrl === touristSearchUrl), false);
    assert.equal(navigateCalls.filter((entry) => entry.url === searchUrl).length >= 2, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('expandStates chains Xiaohongshu search-results detail selection into detail author selection via page-facts triggers', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-expand-xiaohongshu-selection-chain-'));
  const baseUrl = 'https://www.xiaohongshu.com/explore';
  const searchUrl = 'https://www.xiaohongshu.com/search_result?keyword=outfit&type=51';
  const detailUrl = 'https://www.xiaohongshu.com/explore/6718e70f0000000021031147';
  const relatedUrl = 'https://www.xiaohongshu.com/explore/6718e70f0000000021031148';
  const authorUrl = 'https://www.xiaohongshu.com/user/profile/5f123456000000000100abcd';
  const utilityUrl = 'https://www.xiaohongshu.com/login';
  const manifestPath = await createInitialManifest(workspace, baseUrl);
  const screenshotBase64 = Buffer.from('xiaohongshu-selection-chain-image').toString('base64');
  const navigateCalls = [];

  const views = {
    [baseUrl]: {
      signature: {
        finalUrl: baseUrl,
        title: 'Xiaohongshu Explore',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'home',
        pageFacts: null,
        fingerprint: { state: 'xhs-home' },
      },
      triggers: [
        {
          kind: 'search-form',
          label: 'Search: outfit',
          queryText: 'outfit',
          locator: { tagName: 'form', role: 'search', primary: 'search-url-template' },
        },
        {
          kind: 'safe-nav-link',
          label: 'Login',
          href: utilityUrl,
          semanticRole: 'auth',
          locator: { tagName: 'a', role: 'link', primary: 'nav-link' },
        },
      ],
    },
    [searchUrl]: {
      signature: {
        finalUrl: searchUrl,
        title: 'outfit - Xiaohongshu Search',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'search-results-page',
        pageFacts: {
          queryText: 'outfit',
          resultCount: 1,
          resultUrls: [detailUrl],
        },
        fingerprint: { state: 'xhs-search' },
      },
      triggers: [
        {
          kind: 'safe-nav-link',
          label: 'Stylist Lab',
          href: authorUrl,
          semanticRole: 'author',
          locator: { tagName: 'a', role: 'link', primary: 'result-author' },
        },
        {
          kind: 'safe-nav-link',
          label: 'Login',
          href: utilityUrl,
          semanticRole: 'auth',
          locator: { tagName: 'a', role: 'link', primary: 'result-utility' },
        },
      ],
    },
    [detailUrl]: {
      signature: {
        finalUrl: detailUrl,
        title: 'Spring Outfit Guide',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'content-detail-page',
        pageFacts: {
          contentTitle: 'Spring Outfit Guide',
          authorName: 'Stylist Lab',
          authorUrl,
        },
        fingerprint: { state: 'xhs-detail' },
      },
      triggers: [
        {
          kind: 'content-link',
          label: 'Related Note',
          href: relatedUrl,
          semanticRole: 'content',
          locator: { tagName: 'a', role: 'link', primary: 'detail-related' },
        },
      ],
    },
    [authorUrl]: {
      signature: {
        finalUrl: authorUrl,
        title: 'Stylist Lab',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'author-page',
        pageFacts: {
          authorName: 'Stylist Lab',
          featuredContentCount: 2,
        },
        fingerprint: { state: 'xhs-author' },
      },
      triggers: [],
    },
    [relatedUrl]: {
      signature: {
        finalUrl: relatedUrl,
        title: 'Related Note',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'content-detail-page',
        pageFacts: null,
        fingerprint: { state: 'xhs-related' },
      },
      triggers: [],
    },
    [utilityUrl]: {
      signature: {
        finalUrl: utilityUrl,
        title: 'Login',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'auth-page',
        pageFacts: null,
        fingerprint: { state: 'xhs-login' },
      },
      triggers: [],
    },
  };

  const fakeSession = {
    currentViewKey: baseUrl,
    async navigateAndWait(url, waitPolicy) {
      navigateCalls.push({ url, waitPolicy, from: this.currentViewKey });
      this.currentViewKey = url;
    },
    async waitForSettled() {},
    async callPageFunction() {
      return 2;
    },
    async invokeHelperMethod(methodName, args, options) {
      if (methodName === 'pageComputeStateSignature') {
        return views[this.currentViewKey].signature;
      }
      if (methodName === 'pageDiscoverTriggers') {
        return views[this.currentViewKey].triggers;
      }
      if (methodName === 'pageExecuteTrigger') {
        const [trigger] = args;
        assert.equal(trigger.kind, 'search-form');
        const result = await runWithFakeXiaohongshuSearchDom({
          currentUrl: baseUrl,
          formAction: baseUrl,
          inputName: '',
        }, async () => await options.fallbackFn(...args));
        if (result?.navigationUrl) {
          this.currentViewKey = result.navigationUrl;
        }
        return result;
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
      siteProfile: createXiaohongshuSiteProfile(),
      maxTriggers: 6,
      maxCapturedStates: 3,
      searchQueries: ['outfit'],
      captureChapterArtifacts: false,
    });

    const searchState = manifest.states.find((state) => state.finalUrl === searchUrl);
    const detailState = manifest.states.find((state) => state.finalUrl === detailUrl);
    const authorState = manifest.states.find((state) => state.finalUrl === authorUrl);
    const capturedStates = manifest.states
      .filter((state) => state.status === 'captured')
      .map((state) => ({
        finalUrl: state.finalUrl,
        fromState: state.from_state,
        triggerKind: state.trigger?.kind ?? null,
        semanticRole: state.trigger?.semanticRole ?? null,
        locatorPrimary: state.trigger?.locator?.primary ?? null,
      }));

    assert.equal(manifest.summary.capturedStates, 3);
    assert.deepEqual(capturedStates, [
      {
        finalUrl: searchUrl,
        fromState: manifest.initialStateId,
        triggerKind: 'search-form',
        semanticRole: null,
        locatorPrimary: 'search-url-template',
      },
      {
        finalUrl: detailUrl,
        fromState: searchState?.state_id ?? null,
        triggerKind: 'content-link',
        semanticRole: 'content',
        locatorPrimary: 'page-facts',
      },
      {
        finalUrl: authorUrl,
        fromState: detailState?.state_id ?? null,
        triggerKind: 'safe-nav-link',
        semanticRole: 'author',
        locatorPrimary: 'page-facts',
      },
    ]);
    assert.equal(manifest.states.some((state) => state.finalUrl === relatedUrl), false);
    assert.equal(manifest.states.some((state) => state.finalUrl === utilityUrl), false);
    assert.equal(navigateCalls.some((entry) => entry.url === detailUrl), true);
    assert.equal(navigateCalls.some((entry) => entry.url === authorUrl), true);
    assert.equal(navigateCalls.some((entry) => entry.url === relatedUrl), false);
    assert.equal(navigateCalls.some((entry) => entry.url === utilityUrl), false);
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

test('capture surfaces runtimeEvidence for Douyin anti-crawl challenge captures', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-runtime-evidence-'));
  const screenshotBase64 = Buffer.from('douyin-runtime-image').toString('base64');

  const fakeSession = {
    async navigateAndWait() {},
    async callPageFunction() {
      return {
        title: '验证码中间页',
        documentText: '验证码中间页 middle_page_loading',
        readyCount: 0,
        pageType: 'home',
      };
    },
    async captureHtml() {
      return '<html><body>challenge</body></html>';
    },
    async captureSnapshot() {
      return { documents: [{ nodes: [] }] };
    },
    async captureScreenshot() {
      return {
        data: screenshotBase64,
        usedViewportFallback: false,
        primaryError: null,
      };
    },
    async getPageMetadata() {
      return {
        finalUrl: 'https://www.douyin.com/',
        title: '验证码中间页',
        viewportWidth: 1200,
        viewportHeight: 800,
      };
    },
    async close() {},
  };

  try {
    const manifest = await capture('https://www.douyin.com/?recommend=1', {
      outDir: workspace,
      siteProfile: {
        host: 'www.douyin.com',
      },
      runtimeFactory: async () => fakeSession,
    });

    assert.equal(manifest.pageFacts?.antiCrawlDetected, true);
    assert.equal(manifest.runtimeEvidence?.antiCrawlDetected, true);
    assert.equal(manifest.runtimeEvidence?.networkRiskDetected, true);
    assert.equal(manifest.runtimeEvidence?.noDedicatedIpRiskDetected, true);
    assert.equal(manifest.runtimeEvidence?.noDedicatedIpRiskEvidence?.governanceCategory, 'no-dedicated-ip');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('expandStates prioritizes Douyin detail author triggers from page facts ahead of spider-like author links', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-expand-douyin-author-priority-'));
  const detailUrl = 'https://www.douyin.com/video/7487317288315258152';
  const goodAuthorUrl = 'https://www.douyin.com/user/MS4wLjABAAAArealAuthor';
  const badAuthorUrl = 'https://www.douyin.com/user/baiduspider';
  const manifestPath = await createInitialManifest(workspace, detailUrl);
  const screenshotBase64 = Buffer.from('douyin-author-image').toString('base64');
  const navigateCalls = [];

  const views = {
    [detailUrl]: {
      signature: {
        finalUrl: detailUrl,
        title: 'Video Detail',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'content-detail-page',
        pageFacts: {
          contentTitle: '示例视频',
          authorName: '真实作者',
          authorUrl: goodAuthorUrl,
        },
        fingerprint: { state: 'douyin-detail' },
      },
      triggers: [{
        kind: 'safe-nav-link',
        label: 'baiduspider',
        semanticRole: 'author',
        href: badAuthorUrl,
        locator: { tagName: 'a', role: 'link', primary: 'dom' },
      }],
    },
    [goodAuthorUrl]: {
      signature: {
        finalUrl: goodAuthorUrl,
        title: '真实作者',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'author-page',
        pageFacts: {
          authorName: '真实作者',
          authorUrl: goodAuthorUrl,
          featuredContentCount: 1,
        },
        fingerprint: { state: 'douyin-author-good' },
      },
      triggers: [],
    },
    [badAuthorUrl]: {
      signature: {
        finalUrl: badAuthorUrl,
        title: 'baiduspider',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'author-page',
        pageFacts: {
          authorName: 'baiduspider',
          authorUrl: badAuthorUrl,
        },
        fingerprint: { state: 'douyin-author-bad' },
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
    async callPageFunction() {
      return 2;
    },
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
    const manifest = await expandStates(detailUrl, {
      initialManifestPath: manifestPath,
      outDir: path.join(workspace, 'expanded'),
      runtimeFactory: async () => fakeSession,
      siteProfile: {
        host: 'www.douyin.com',
        sampling: {
          authorContentLimit: 10,
        },
      },
      maxTriggers: 3,
      maxCapturedStates: 1,
      searchQueries: [],
      captureChapterArtifacts: false,
    });

    assert.equal(manifest.summary.capturedStates, 1);
    assert.equal(navigateCalls.some((entry) => entry.url === goodAuthorUrl), true);
    assert.equal(navigateCalls.some((entry) => entry.url === badAuthorUrl), false);
    assert.equal(manifest.states.some((state) => state.finalUrl === goodAuthorUrl && state.status === 'captured'), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('expandStates favors Douyin search and author states ahead of home utility links when search queries are present', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-expand-douyin-search-priority-'));
  const baseUrl = 'https://www.douyin.com/';
  const searchUrl = 'https://www.douyin.com/search/%E6%96%B0%E9%97%BB?type=general';
  const detailUrl = 'https://www.douyin.com/video/7487317288315258152';
  const authorUrl = 'https://www.douyin.com/user/MS4wLjABAAAArealAuthor';
  const utilityUrl = 'https://www.douyin.com/jingxuan?from_nav=1';
  const manifestPath = await createInitialManifest(workspace, baseUrl);
  const screenshotBase64 = Buffer.from('douyin-search-priority-image').toString('base64');
  const navigateCalls = [];

  const views = {
    [baseUrl]: {
      signature: {
        finalUrl: baseUrl,
        title: 'Douyin Home',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'home',
        pageFacts: null,
        fingerprint: { state: 'douyin-home' },
      },
      triggers: [
        {
          kind: 'search-form',
          label: 'Search: 新闻',
          queryText: '新闻',
          href: searchUrl,
          locator: { tagName: 'form', role: 'search', primary: 'search-url-template' },
        },
        {
          kind: 'content-link',
          label: '新闻',
          href: detailUrl,
          locator: { tagName: 'a', role: 'link', primary: 'known-query' },
        },
        {
          kind: 'safe-nav-link',
          label: '精选',
          href: utilityUrl,
          semanticRole: 'utility',
          locator: { tagName: 'a', role: 'link', primary: 'role-label' },
        },
      ],
    },
    [searchUrl]: {
      signature: {
        finalUrl: searchUrl,
        title: '新闻 - Douyin Search',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'search-results-page',
        pageFacts: { queryText: '新闻', resultCount: 1, firstResultUrl: detailUrl },
        fingerprint: { state: 'douyin-search' },
      },
      triggers: [],
    },
    [detailUrl]: {
      signature: {
        finalUrl: detailUrl,
        title: 'Video Detail',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'content-detail-page',
        pageFacts: {
          contentTitle: 'Sample Video',
          authorName: 'Real Author',
          authorUrl,
        },
        fingerprint: { state: 'douyin-detail' },
      },
      triggers: [],
    },
    [authorUrl]: {
      signature: {
        finalUrl: authorUrl,
        title: 'Real Author',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'author-page',
        pageFacts: {
          authorName: 'Real Author',
          authorUrl,
          featuredContentCount: 1,
        },
        fingerprint: { state: 'douyin-author' },
      },
      triggers: [],
    },
    [utilityUrl]: {
      signature: {
        finalUrl: utilityUrl,
        title: 'Utility',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'category-page',
        pageFacts: null,
        fingerprint: { state: 'douyin-utility' },
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
    async waitForSettled() {
      if (this.currentViewKey === baseUrl) {
        this.currentViewKey = searchUrl;
      }
    },
    async callPageFunction() {
      return 2;
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
    const manifest = await expandStates(baseUrl, {
      initialManifestPath: manifestPath,
      outDir: path.join(workspace, 'expanded'),
      runtimeFactory: async () => fakeSession,
      siteProfile: {
        host: 'www.douyin.com',
      },
      maxTriggers: 6,
      maxCapturedStates: 3,
      searchQueries: ['新闻'],
      captureChapterArtifacts: false,
    });

    assert.equal(manifest.summary.capturedStates, 3);
    assert.equal(manifest.states.some((state) => state.finalUrl === searchUrl), true);
    assert.equal(manifest.states.some((state) => state.finalUrl === detailUrl), true);
    assert.equal(manifest.states.some((state) => state.finalUrl === authorUrl), true);
    assert.equal(manifest.states.some((state) => state.finalUrl === utilityUrl), false);
    assert.equal(navigateCalls.includes(utilityUrl), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('derivePageFacts augments bilibili anti-crawl surfaces with stable risk-governance evidence', () => {
  const pageFacts = derivePageFacts({
    pageType: 'author-page',
    siteProfile: {
      host: 'www.bilibili.com',
    },
    finalUrl: 'https://space.bilibili.com/1/fans/follow',
    title: '安全验证',
    queryInputValue: '',
    textFromSelectors: () => null,
    hrefFromSelectors: () => null,
    textsFromSelectors: () => [],
    hrefsFromSelectors: () => [],
    metaContent: () => null,
    documentText: '访问频繁 请稍后再试 安全验证',
  });

  assert.equal(pageFacts?.antiCrawlDetected, true);
  assert.equal(Array.isArray(pageFacts?.antiCrawlSignals), true);
  assert.ok(pageFacts?.antiCrawlSignals.includes('verify') || pageFacts?.antiCrawlSignals.includes('rate-limit'));
  assert.ok(pageFacts?.antiCrawlReasonCode);
  assert.equal(pageFacts?.networkRiskDetected, true);
  assert.equal(pageFacts?.noDedicatedIpRiskDetected, true);
  assert.ok(pageFacts?.antiCrawlEvidence);
  assert.equal(pageFacts?.noDedicatedIpRiskEvidence?.governanceCategory, 'no-dedicated-ip');
});

test('expandStates carries runtimeEvidence from state signatures into manifests', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-expand-runtime-evidence-'));
  const baseUrl = 'https://www.douyin.com/';
  const authorUrl = 'https://www.douyin.com/user/example';
  const manifestPath = await createInitialManifest(workspace, baseUrl);
  const screenshotBase64 = Buffer.from('douyin-expand-image').toString('base64');

  const views = {
    [baseUrl]: {
      signature: {
        finalUrl: baseUrl,
        title: 'Douyin Home',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'home',
        pageFacts: null,
        fingerprint: { state: 'douyin-home' },
      },
      triggers: [
        {
          kind: 'safe-nav-link',
          label: 'Creator',
          href: authorUrl,
          locator: { tagName: 'a', role: 'link' },
        },
      ],
    },
    [authorUrl]: {
      signature: {
        finalUrl: authorUrl,
        title: '验证码中间页',
        viewportWidth: 1280,
        viewportHeight: 720,
        pageType: 'author-page',
        pageFacts: {
          antiCrawlDetected: true,
          antiCrawlSignals: ['verify'],
          antiCrawlReasonCode: 'anti-crawl-verify',
        },
        fingerprint: { state: 'douyin-author-risk' },
      },
      triggers: [],
    },
  };

  const fakeSession = {
    currentViewKey: baseUrl,
    async navigateAndWait(url) {
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
      siteProfile: {
        host: 'www.douyin.com',
      },
      maxTriggers: 2,
      searchQueries: [],
      captureChapterArtifacts: false,
    });

    const capturedState = manifest.states.find((state) => state.finalUrl === authorUrl);
    assert.equal(capturedState?.runtimeEvidence?.noDedicatedIpRiskDetected, true);
    assert.equal(capturedState?.runtimeEvidence?.antiCrawlReasonCode, 'anti-crawl-verify');

    const stateManifest = JSON.parse(await readFile(capturedState.files.manifest, 'utf8'));
    assert.equal(stateManifest.runtimeEvidence?.noDedicatedIpRiskDetected, true);
    assert.equal(stateManifest.pageFacts?.noDedicatedIpRiskDetected, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('expandStates copies live initial Douyin page facts into the initial state manifest', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-expand-douyin-initial-facts-'));
  const baseUrl = 'https://www.douyin.com/follow?tab=feed';
  const manifestPath = await createInitialManifest(workspace, baseUrl);
  const initialCaptureManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await rm(initialCaptureManifest.files.html, { force: true });
  let closed = false;

  const fakeSession = {
    currentViewKey: baseUrl,
    async navigateAndWait(url) {
      this.currentViewKey = url;
    },
    async waitForSettled() {},
    async invokeHelperMethod(methodName) {
      if (methodName === 'pageComputeStateSignature') {
        return {
          finalUrl: baseUrl,
          title: '鍏虫敞 - 鎶栭煶',
          viewportWidth: 1280,
          viewportHeight: 720,
          pageType: 'author-list-page',
          pageFacts: {
            authorSubpage: 'follow-feed',
            featuredContentCount: 3,
            featuredContentComplete: true,
            loginStateDetected: true,
            identityConfirmed: true,
            authenticatedSessionConfirmed: true,
          },
          runtimeEvidence: null,
          fingerprint: { state: 'douyin-follow-feed' },
        };
      }
      if (methodName === 'pageExhaustDouyinSurface') {
        return null;
      }
      if (methodName === 'pageDiscoverTriggers') {
        return [];
      }
      throw new Error(`Unexpected helper method: ${methodName}`);
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
      siteProfile: {
        host: 'www.douyin.com',
      },
      maxTriggers: 2,
      maxCapturedStates: 1,
      searchQueries: [],
      captureChapterArtifacts: false,
    });

    const initialState = manifest.states.find((state) => state.state_id === 's0000');
    assert.match(manifest.warnings.join('\n'), /Initial capture artifacts were missing \(html\)/u);
    assert.equal(initialState?.pageFacts?.authorSubpage, 'follow-feed');
    assert.equal(initialState?.pageFacts?.featuredContentCount, 3);
    assert.equal(initialState?.pageFacts?.identityConfirmed, true);

    const initialStateManifest = JSON.parse(await readFile(initialState.files.manifest, 'utf8'));
    assert.equal(initialStateManifest.pageFacts?.authorSubpage, 'follow-feed');
    assert.equal(initialStateManifest.pageFacts?.featuredContentComplete, true);
    assert.equal(initialStateManifest.pageFacts?.authenticatedSessionConfirmed, true);
    assert.equal(closed, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
