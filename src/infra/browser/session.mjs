import path from 'node:path';

import { CdpClient } from './cdp-client.mjs';
import {
  delay,
  detectBrowserPath,
  launchBrowser,
  readExistingBrowserDevTools,
  shutdownBrowser,
} from './launcher.mjs';
import {
  observedRequestFromNetworkCaptureEvent,
  responseSummaryFromNetworkCaptureEvent,
} from '../../domain/artifacts/network-capture.mjs';
import { redactPublicIdentifierText, redactValue } from '../../domain/sessions/security-guard.mjs';
import { jsonClone } from '../../shared/clone.mjs';

export const SNAPSHOT_STYLES = ['display', 'visibility', 'opacity', 'position', 'z-index'];
export const NETWORK_IDLE_QUIET_MS = 500;
const NETWORK_IDLE_POLL_INTERVAL_MS = 100;
const DOCUMENT_READY_POLL_INTERVAL_MS = 100;
const TARGET_POLL_INTERVAL_MS = 100;
const RUNTIME_EVALUATE_RETRY_DELAY_MS = 150;
const SESSION_OPEN_RETRY_DELAY_MS = 250;
const DEFAULT_SESSION_OPEN_RETRIES = 2;
const DOM_QUIET_RECOVERY_READY_TIMEOUT_MS = 2_000;
const DEFAULT_NETWORK_CAPTURE_REQUEST_LIMIT = 100;
const DEFAULT_RAW_NETWORK_TRACE_LIMIT = 100;
const DEFAULT_RAW_NETWORK_BODY_MAX_BYTES = 256 * 1024;
const PENDING_NETWORK_CAPTURE_SITE_KEY = 'pending-site';
const RESOURCE_HINT_API_PATTERN = /(?:\/api(?:\/|$|[?#])|\/graphql\b|graphql|\.json(?:$|[?#])|\/ajax\/|\/xhr\/|\/v\d+\/|\/web\/v\d+\/)/iu;
const RESOURCE_HINT_INITIATOR_TYPES = new Set(['beacon', 'eventsource', 'fetch', 'xmlhttprequest']);
const RAW_NETWORK_API_RESOURCE_TYPES = new Set(['eventsource', 'fetch', 'xhr', 'xmlhttprequest']);
const RAW_NETWORK_TEXT_MIME_PATTERN = /(?:json|text\/|javascript|ecmascript|xml|x-www-form-urlencoded|graphql)/iu;
const RAW_NETWORK_SKIP_MIME_PATTERN = /(?:^image\/|^video\/|^audio\/|^font\/|application\/octet-stream|application\/pdf|mpegurl|dash\+xml)/iu;
const RAW_NETWORK_SKIP_URL_PATTERN = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp|mp4|m4v|mov|webm|mp3|aac|wav|ogg|flac|woff2?|ttf|otf|eot|pdf|m3u8|mpd)(?:$|[?#])/iu;
const ROUTE_HINT_PATTERN = /(?:^\/(?!\/)|\/(?:app|detail|item|search|profile|user|work|works|book|video|author|creator|tag|category|settings|login|vip|paywall|checkout|account)(?:\/|$|[?#])|[?&](?:route|page|tab|view)=|route|router|\.m?js(?:$|[?#]))/iu;

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

const cloneJson = jsonClone;

function shouldTrackRequestForNetworkIdle(event = /** @type {any} */ ({})) {
  const params = event.params ?? event;
  const request = params.request ?? {};
  const resourceType = String(params.type ?? '').trim().toLowerCase();
  const url = String(request.url ?? params.url ?? '').trim().toLowerCase();
  if (resourceType === 'eventsource' || resourceType === 'websocket') {
    return false;
  }
  if (url.startsWith('ws:') || url.startsWith('wss:')) {
    return false;
  }
  return true;
}

function isLikelyApiResourceHint(entry = /** @type {any} */ ({})) {
  const url = String(entry.name ?? entry.url ?? '').trim();
  const initiatorType = String(entry.initiatorType ?? entry.resourceType ?? '').trim().toLowerCase();
  return Boolean(url) && (
    RESOURCE_HINT_INITIATOR_TYPES.has(initiatorType)
    || RESOURCE_HINT_API_PATTERN.test(url)
  );
}

function resourceTypeFromInitiatorType(value) {
  const initiatorType = String(value ?? '').trim().toLowerCase();
  if (initiatorType === 'xmlhttprequest') {
    return 'XHR';
  }
  if (initiatorType === 'eventsource') {
    return 'EventSource';
  }
  if (initiatorType === 'beacon') {
    return 'Beacon';
  }
  if (initiatorType === 'fetch') {
    return 'Fetch';
  }
  return 'Other';
}

function safeApiHintMethod(value) {
  const method = String(value ?? '').trim().toUpperCase();
  return /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/u.test(method) ? method : 'GET';
}

function rawHeaderValue(headers = /** @type {any} */ ({}), name) {
  const wanted = String(name ?? '').toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (String(key).toLowerCase() === wanted) {
      return Array.isArray(value) ? value.join(', ') : String(value ?? '');
    }
  }
  return '';
}

function utf8ByteLength(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8');
}

function truncateRawNetworkText(value, maxBytes) {
  const text = String(value ?? '');
  const totalBytes = utf8ByteLength(text);
  if (totalBytes <= maxBytes) {
    return { text, totalBytes, truncated: false };
  }
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (utf8ByteLength(text.slice(0, mid)) <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return {
    text: text.slice(0, low),
    totalBytes,
    truncated: true,
  };
}

function shouldStartRawNetworkTrace(params = /** @type {any} */ ({})) {
  const request = params.request ?? {};
  const url = String(request.url ?? params.url ?? '').trim();
  if (!url || RAW_NETWORK_SKIP_URL_PATTERN.test(url)) {
    return false;
  }
  const resourceType = String(params.type ?? '').trim().toLowerCase();
  const accept = rawHeaderValue(request.headers, 'accept');
  return RAW_NETWORK_API_RESOURCE_TYPES.has(resourceType)
    || RESOURCE_HINT_API_PATTERN.test(url)
    || RAW_NETWORK_TEXT_MIME_PATTERN.test(accept);
}

function shouldCaptureRawResponseBody(trace = /** @type {any} */ ({})) {
  const url = String(trace.response?.url ?? trace.request?.url ?? '').trim();
  const mimeType = String(trace.response?.mimeType ?? '').trim();
  const resourceType = String(trace.resourceType ?? '').trim().toLowerCase();
  if (!url || RAW_NETWORK_SKIP_URL_PATTERN.test(url) || RAW_NETWORK_SKIP_MIME_PATTERN.test(mimeType)) {
    return false;
  }
  return RAW_NETWORK_TEXT_MIME_PATTERN.test(mimeType)
    || RAW_NETWORK_API_RESOURCE_TYPES.has(resourceType)
    || RESOURCE_HINT_API_PATTERN.test(url);
}

function isLikelyRouteHint(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return false;
  }
  return ROUTE_HINT_PATTERN.test(text);
}

function routeHintId(prefix, index) {
  return `${prefix}-${String(index + 1).padStart(3, '0')}`;
}

function boundedRouteHintText(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return undefined;
  }
  const redacted = String(redactPublicIdentifierText(/** @type {any} */ (text), {
    path: ['routeHint'],
    maxLength: 500,
  }).value ?? '').trim();
  return redacted || undefined;
}

export function createNetworkTracker(client, sessionId, {
  maxObservedRequests = DEFAULT_NETWORK_CAPTURE_REQUEST_LIMIT,
  maxObservedResponseSummaries = maxObservedRequests,
  rawNetworkCapture = false,
  maxRawNetworkTraces = rawNetworkCapture ? DEFAULT_RAW_NETWORK_TRACE_LIMIT : 0,
  maxRawResponseBodyBytes = DEFAULT_RAW_NETWORK_BODY_MAX_BYTES,
} = /** @type {any} */ ({})) {
  const inflight = new Set();
  const observedRequests = /** @type {any[]} */ ([]);
  const observedRequestsById = new Map();
  const observedResponseSummaries = /** @type {any[]} */ ([]);
  const rawTraces = /** @type {any[]} */ ([]);
  const rawTracesById = new Map();
  const rawBodyPromises = new Set();
  let lastActivityAt = Date.now();
  const observedRequestLimit = Math.max(0, Number(maxObservedRequests) || 0);
  const observedResponseSummaryLimit = Math.max(0, Number(maxObservedResponseSummaries) || 0);
  const rawTraceLimit = rawNetworkCapture === true
    ? Math.max(0, Number(maxRawNetworkTraces) || 0)
    : 0;
  const rawResponseBodyMaxBytes = Math.max(0, Number(maxRawResponseBodyBytes) || 0);

  const markActivity = () => {
    lastActivityAt = Date.now();
  };

  const appendObservedRequest = (event) => {
    if (observedRequestLimit <= 0) {
      return;
    }
    try {
      const observed = observedRequestFromNetworkCaptureEvent(event, {
        siteKey: PENDING_NETWORK_CAPTURE_SITE_KEY,
      });
      observedRequests.push(observed);
      if (observed.id) {
        observedRequestsById.set(observed.id, observed);
      }
    } catch {
      return;
    }
    if (observedRequests.length > observedRequestLimit) {
      const removed = observedRequests.splice(0, observedRequests.length - observedRequestLimit);
      for (const request of removed) {
        if (request.id) {
          observedRequestsById.delete(request.id);
        }
      }
    }
  };

  const appendRawTraceRequest = (event) => {
    if (rawTraceLimit <= 0 || rawTraces.length >= rawTraceLimit) {
      return;
    }
    const { params } = event ?? {};
    if (!params?.requestId || !shouldStartRawNetworkTrace(params)) {
      return;
    }
    const request = params.request ?? {};
    const requestBody = request.postData === undefined ? null : String(request.postData);
    const requestBodyCapture = requestBody === null
      ? { text: null, totalBytes: 0, truncated: false }
      : truncateRawNetworkText(requestBody, rawResponseBodyMaxBytes);
    const trace = {
      requestId: params.requestId,
      resourceType: params.type ?? null,
      wallTime: params.wallTime ?? null,
      timestamp: params.timestamp ?? null,
      documentURL: params.documentURL ?? null,
      initiator: cloneJson(params.initiator ?? null),
      request: {
        method: request.method ?? null,
        url: request.url ?? params.url ?? null,
        headers: cloneJson(request.headers ?? {}),
        body: requestBodyCapture.text,
        bodySizeBytes: requestBodyCapture.totalBytes,
        truncated: requestBodyCapture.truncated,
        hasPostData: request.hasPostData === true || requestBody !== null,
      },
      response: null,
      responseBody: null,
      responseBodyStatus: 'pending',
      loading: {
        status: 'pending',
        encodedDataLength: null,
        failedText: null,
      },
    };
    rawTraces.push(trace);
    rawTracesById.set(params.requestId, trace);
  };

  const appendObservedResponseSummary = (event) => {
    if (observedResponseSummaryLimit <= 0) {
      return;
    }
    const { params } = event ?? {};
    const requestId = params?.requestId;
    const observedRequest = requestId ? observedRequestsById.get(requestId) : null;
    if (!observedRequest || Object.hasOwn(params ?? {}, 'body')) {
      return;
    }
    try {
      observedResponseSummaries.push(responseSummaryFromNetworkCaptureEvent({
        method: 'Network.responseReceived',
        params: {
          requestId: params.requestId,
          type: params.type,
          timestamp: params.timestamp,
          response: params.response,
        },
      }, {
        observedRequest,
      }));
    } catch {
      return;
    }
    if (observedResponseSummaries.length > observedResponseSummaryLimit) {
      observedResponseSummaries.splice(0, observedResponseSummaries.length - observedResponseSummaryLimit);
    }
  };

  const appendRawTraceResponse = (event) => {
    const { params } = event ?? {};
    const trace = params?.requestId ? rawTracesById.get(params.requestId) : null;
    if (!trace) {
      return;
    }
    const response = params.response ?? {};
    trace.response = {
      url: response.url ?? trace.request?.url ?? null,
      status: response.status ?? null,
      statusText: response.statusText ?? null,
      mimeType: response.mimeType ?? null,
      headers: cloneJson(response.headers ?? {}),
      remoteIPAddress: response.remoteIPAddress ?? null,
      remotePort: response.remotePort ?? null,
      encodedDataLength: response.encodedDataLength ?? null,
      fromDiskCache: response.fromDiskCache === true,
      fromServiceWorker: response.fromServiceWorker === true,
    };
    trace.responseBodyStatus = shouldCaptureRawResponseBody(trace) ? 'pending' : 'skipped_non_text_or_non_api';
  };

  const captureRawTraceResponseBody = async (params = /** @type {any} */ ({})) => {
    const trace = params?.requestId ? rawTracesById.get(params.requestId) : null;
    if (!trace) {
      return;
    }
    trace.loading = {
      status: 'finished',
      encodedDataLength: params.encodedDataLength ?? null,
      failedText: null,
    };
    if (trace.responseBodyStatus !== 'pending' || !shouldCaptureRawResponseBody(trace)) {
      if (trace.responseBodyStatus === 'pending') {
        trace.responseBodyStatus = 'skipped_non_text_or_non_api';
      }
      return;
    }
    if (typeof client.send !== 'function') {
      trace.responseBodyStatus = 'unavailable';
      return;
    }
    try {
      const result = await client.send('Network.getResponseBody', { requestId: params.requestId }, sessionId);
      if (result?.base64Encoded === true) {
        trace.responseBodyStatus = 'skipped_base64';
        trace.responseBody = {
          base64Encoded: true,
          body: null,
          bodySizeBytes: 0,
          truncated: false,
        };
        return;
      }
      const captured = truncateRawNetworkText(result?.body ?? '', rawResponseBodyMaxBytes);
      trace.responseBody = {
        base64Encoded: false,
        body: captured.text,
        bodySizeBytes: captured.totalBytes,
        truncated: captured.truncated,
      };
      trace.responseBodyStatus = captured.truncated ? 'captured_truncated' : 'captured';
    } catch (error) {
      trace.responseBodyStatus = 'unavailable';
      trace.responseBodyError = error?.message ?? String(error);
    }
  };

  const queueRawResponseBodyCapture = (params) => {
    const promise = captureRawTraceResponseBody(params)
      .catch(() => {})
      .finally(() => {
        rawBodyPromises.delete(promise);
      });
    rawBodyPromises.add(promise);
  };

  const offRequest = client.on(
    'Network.requestWillBeSent',
    (event) => {
      const { params } = event ?? {};
      if (!params?.requestId) {
        return;
      }
      if (shouldTrackRequestForNetworkIdle(event)) {
        inflight.add(params.requestId);
      }
      appendObservedRequest(event);
      appendRawTraceRequest(event);
      markActivity();
    },
    { sessionId },
  );

  const offResponse = client.on(
    'Network.responseReceived',
    (event) => {
      appendObservedResponseSummary(event);
      appendRawTraceResponse(event);
      markActivity();
    },
    { sessionId },
  );

  const offWebSocketCreated = client.on(
    'Network.webSocketCreated',
    (event) => {
      appendObservedRequest({
        method: 'Network.webSocketCreated',
        params: event?.params ?? event,
      });
      markActivity();
    },
    { sessionId },
  );

  const finishRequest = ({ params }) => {
    if (!params?.requestId) {
      return;
    }
    inflight.delete(params.requestId);
    queueRawResponseBodyCapture(params);
    markActivity();
  };

  const offFinished = client.on('Network.loadingFinished', finishRequest, { sessionId });
  const offFailed = client.on('Network.loadingFailed', ({ params }) => {
    if (!params?.requestId) {
      return;
    }
    const trace = rawTracesById.get(params.requestId);
    if (trace) {
      trace.loading = {
        status: 'failed',
        encodedDataLength: null,
        failedText: params.errorText ?? null,
      };
      trace.responseBodyStatus = 'loading_failed';
    }
    inflight.delete(params.requestId);
    markActivity();
  }, { sessionId });

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
    getObservedRequests({ siteKey, limit } = /** @type {any} */ ({})) {
      const normalizedSiteKey = String(siteKey ?? '').trim();
      if (!normalizedSiteKey) {
        throw new Error('Network tracker observed request siteKey is required');
      }
      const readLimit = limit === undefined ? observedRequests.length : Math.max(0, Number(limit) || 0);
      if (readLimit <= 0) {
        return [];
      }
      return observedRequests.slice(-readLimit).map((request) => ({
        ...cloneJson(request),
        siteKey: normalizedSiteKey,
      }));
    },
    getObservedResponseSummaries({ siteKey, limit } = /** @type {any} */ ({})) {
      const normalizedSiteKey = String(siteKey ?? '').trim();
      if (!normalizedSiteKey) {
        throw new Error('Network tracker observed response summary siteKey is required');
      }
      const readLimit = limit === undefined ? observedResponseSummaries.length : Math.max(0, Number(limit) || 0);
      if (readLimit <= 0) {
        return [];
      }
      return observedResponseSummaries.slice(-readLimit).map((summary) => ({
        ...cloneJson(summary),
        siteKey: normalizedSiteKey,
      }));
    },
    getRawNetworkTraces({ limit } = /** @type {any} */ ({})) {
      const readLimit = limit === undefined ? rawTraces.length : Math.max(0, Number(limit) || 0);
      if (readLimit <= 0) {
        return [];
      }
      return rawTraces.slice(-readLimit).map((trace) => cloneJson(trace));
    },
    async waitForRawBodies() {
      await Promise.allSettled([...rawBodyPromises]);
    },
    clearObservedRequests() {
      observedRequests.length = 0;
      observedRequestsById.clear();
      observedResponseSummaries.length = 0;
    },
    clearObservedResponseSummaries() {
      observedResponseSummaries.length = 0;
    },
    dispose() {
      offRequest();
      offResponse();
      offWebSocketCreated();
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

  getObservedNetworkRequests(options = /** @type {any} */ ({})) {
    return this.networkTracker?.getObservedRequests?.(options) ?? [];
  }

  getObservedNetworkResponseSummaries(options = /** @type {any} */ ({})) {
    return this.networkTracker?.getObservedResponseSummaries?.(options) ?? [];
  }

  getRawNetworkTraces(options = /** @type {any} */ ({})) {
    return this.networkTracker?.getRawNetworkTraces?.(options) ?? [];
  }

  async waitForRawNetworkBodies() {
    await this.networkTracker?.waitForRawBodies?.();
  }

  async getObservedPageResourceApiHints({ siteKey, limit = DEFAULT_NETWORK_CAPTURE_REQUEST_LIMIT } = /** @type {any} */ ({})) {
    const normalizedSiteKey = String(siteKey ?? '').trim();
    if (!normalizedSiteKey) {
      throw new Error('Page resource API hints siteKey is required');
    }
    const readLimit = Math.max(0, Number(limit) || 0);
    if (readLimit <= 0) {
      return [];
    }

    let resourceHints = /** @type {any[]} */ ([]);
    try {
      resourceHints = await this.callPageFunction((maxHints) => {
        const attr = (node, name) => node?.getAttribute?.(name) || '';
        const endpointAttrs = [
          'action',
          'data-api',
          'data-api-url',
          'data-endpoint',
          'data-endpoint-url',
          'data-request-url',
          'data-fetch-url',
          'data-url',
        ];
        const resourceEntries = typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function'
          ? performance.getEntriesByType('resource')
          : [];
        const linkEntries = /** @type {any[]} */ (typeof document !== 'undefined'
          ? [...document.querySelectorAll('link[href][rel], script[src]')]
          .map((node) => ({
            name: /** @type {any} */ (node).href || /** @type {any} */ (node).src,
            initiatorType: node.tagName === 'SCRIPT' ? 'script' : String(/** @type {any} */ (node).rel || 'link'),
          }))
          : []);
        const domEndpointEntries = /** @type {any[]} */ (typeof document !== 'undefined'
          ? [...document.querySelectorAll('form[action], [data-api], [data-api-url], [data-endpoint], [data-endpoint-url], [data-request-url], [data-fetch-url], [data-url]')]
          .flatMap((node) => endpointAttrs
            .map((name) => ({
              name: attr(node, name),
              initiatorType: 'dom-endpoint',
              method: node.tagName === 'FORM' ? String(/** @type {any} */ (node).method || 'GET') : 'GET',
              source: 'browser.dom.api-hint',
              descriptorSource: name,
            })))
          : []);
        return /** @type {any[]} */ ([...resourceEntries, ...linkEntries, ...domEndpointEntries])
          .map((entry) => ({
            name: String(entry.name || ''),
            initiatorType: String(entry.initiatorType || ''),
            method: String(entry.method || 'GET'),
            source: String(entry.source || 'browser.performance.resource'),
            descriptorSource: String(entry.descriptorSource || entry.initiatorType || ''),
          }))
          .filter((entry) => entry.name)
          .slice(-maxHints);
      }, readLimit);
    } catch {
      return [];
    }

    if (!Array.isArray(resourceHints) || resourceHints.length === 0) {
      return [];
    }
    return resourceHints
      .filter(isLikelyApiResourceHint)
      .slice(-readLimit)
      .map((entry, index) => observedRequestFromNetworkCaptureEvent({
        method: 'Network.requestWillBeSent',
        params: {
          requestId: `resource-hint-${index + 1}`,
          type: resourceTypeFromInitiatorType(entry.initiatorType),
          request: {
            method: safeApiHintMethod(entry.method),
            url: entry.name,
            headers: {},
          },
          initiator: {
            type: entry.initiatorType === 'dom-endpoint' ? 'dom-endpoint' : 'resource-timing',
            descriptorSource: entry.descriptorSource,
          },
        },
      }, {
        siteKey: normalizedSiteKey,
        source: entry.source || 'browser.performance.resource',
      }));
  }

  async getObservedPageDomRouteHints({ siteKey, limit = DEFAULT_NETWORK_CAPTURE_REQUEST_LIMIT } = /** @type {any} */ ({})) {
    const normalizedSiteKey = String(siteKey ?? '').trim();
    if (!normalizedSiteKey) {
      throw new Error('Page DOM route hints siteKey is required');
    }
    const readLimit = Math.max(0, Number(limit) || 0);
    if (readLimit <= 0) {
      return {
        jsRoutes: [],
        scriptRoutes: [],
      };
    }

    let routeHints = /** @type {any} */ ({});
    try {
      routeHints = await this.callPageFunction((maxHints) => {
        const attr = (node, name) => node?.getAttribute?.(name) || '';
        const text = (node) => String(node?.textContent || node?.getAttribute?.('aria-label') || '').trim().slice(0, 120);
        const routeAttrs = [
          'data-route',
          'data-router-path',
          'data-path',
          'data-href',
          'data-url',
          'to',
        ];
        const jsRoutes = /** @type {any[]} */ ([]);
        const scriptRoutes = /** @type {any[]} */ ([]);
        const pushRoute = (raw, source, node, { nodeKind = 'js-route', label } = /** @type {any} */ ({})) => {
          if (jsRoutes.length >= maxHints) {
            return;
          }
          const value = String(raw || '').trim().slice(0, 500);
          if (!value) {
            return;
          }
          jsRoutes.push({
            routePath: value,
            label: String(label || '').trim().slice(0, 120) || text(node) || value,
            nodeKind,
            descriptorSource: source,
          });
        };
        const pushRuntimeRoute = (raw, source) => {
          pushRoute(raw, source, document.body, {
            nodeKind: 'runtime-route',
            label: source,
          });
        };
        const routeStateKey = /^(?:as|href|page|path|pathname|route|url)$/iu;
        const routeStateContainerKey = /(?:location|page|route|router|state|transition|view)$/iu;
        const pushRuntimeRoutesFromState = (record, source, depth = 0) => {
          if (!record || typeof record !== 'object' || depth > 2 || jsRoutes.length >= maxHints) {
            return;
          }
          for (const [key, value] of Object.entries(record)) {
            if (jsRoutes.length >= maxHints) {
              return;
            }
            if (typeof value === 'string' && routeStateKey.test(key)) {
              pushRuntimeRoute(value, `${source}.${key}`);
              continue;
            }
            if (
              value
              && typeof value === 'object'
              && !Array.isArray(value)
              && routeStateContainerKey.test(key)
            ) {
              pushRuntimeRoutesFromState(value, `${source}.${key}`, depth + 1);
            }
          }
        };
        for (const node of [...document.querySelectorAll('a[href], area[href]')]) {
          pushRoute(/** @type {any} */ (node).href || attr(node, 'href'), 'href', node);
        }
        for (const node of [...document.querySelectorAll(routeAttrs.map((name) => `[${name}]`).join(','))]) {
          for (const name of routeAttrs) {
            pushRoute(attr(node, name), name, node);
          }
        }
        for (const node of [...document.querySelectorAll('link[href][rel]')]) {
          const rel = String(attr(node, 'rel')).toLowerCase();
          if (/\\b(?:modulepreload|prefetch|preload|prerender)\\b/u.test(rel)) {
            pushRoute(/** @type {any} */ (node).href || attr(node, 'href'), `link.${rel}`, node);
          }
        }
        for (const node of [...document.querySelectorAll('script[src]')]) {
          const src = /** @type {any} */ (node).src || attr(node, 'src');
          if (src) {
            scriptRoutes.push({
              routePath: src,
              scriptUrl: src,
              label: src,
              descriptorSource: 'script.src',
            });
          }
        }
        if (typeof window !== 'undefined' && window.location) {
          pushRuntimeRoute(window.location.pathname, 'window.location.pathname');
          pushRuntimeRoute(window.location.hash, 'window.location.hash');
        }
        const nextPage = typeof window !== 'undefined'
          ? /** @type {any} */ (window).__NEXT_DATA__?.page
          : '';
        pushRuntimeRoute(nextPage, 'window.__NEXT_DATA__.page');
        const remixPath = typeof window !== 'undefined'
          ? /** @type {any} */ (window).__remixContext?.state?.location?.pathname
          : '';
        pushRuntimeRoute(remixPath, 'window.__remixContext.state.location.pathname');
        const historyState = typeof window !== 'undefined'
          ? window.history?.state
          : null;
        pushRuntimeRoutesFromState(historyState, 'window.history.state');
        return {
          jsRoutes: jsRoutes.slice(-maxHints),
          scriptRoutes: scriptRoutes.slice(-maxHints),
        };
      }, readLimit);
    } catch {
      return {
        jsRoutes: [],
        scriptRoutes: [],
      };
    }

    const jsRoutes = Array.isArray(routeHints?.jsRoutes) ? routeHints.jsRoutes : [];
    const scriptRoutes = Array.isArray(routeHints?.scriptRoutes) ? routeHints.scriptRoutes : [];
    const cleanRoutes = jsRoutes
      .filter((entry) => isLikelyRouteHint(entry?.routePath ?? entry?.href ?? entry?.path))
      .slice(-readLimit)
      .map((entry, index) => ({
        id: routeHintId('dom-route-hint', index),
        routePath: boundedRouteHintText(entry.routePath ?? entry.href ?? entry.path),
        label: boundedRouteHintText(entry.label),
        nodeKind: entry.nodeKind ?? 'js-route',
        source: entry.nodeKind === 'runtime-route' ? 'browser.runtime.route-hint' : 'browser.dom.route-hint',
        descriptorSource: boundedRouteHintText(entry.descriptorSource),
        status: 'observed',
        siteKey: normalizedSiteKey,
      }));
    const cleanScriptRoutes = scriptRoutes
      .filter((entry) => isLikelyRouteHint(entry?.scriptUrl ?? entry?.routePath ?? entry?.src))
      .slice(-readLimit)
      .map((entry, index) => ({
        id: routeHintId('script-route-hint', index),
        routePath: boundedRouteHintText(entry.routePath ?? entry.scriptUrl ?? entry.src),
        scriptUrl: boundedRouteHintText(entry.scriptUrl ?? entry.routePath ?? entry.src),
        label: boundedRouteHintText(entry.label),
        nodeKind: 'script-route',
        source: 'browser.dom.script-src-route-hint',
        descriptorSource: boundedRouteHintText(entry.descriptorSource),
        status: 'observed',
        siteKey: normalizedSiteKey,
      }));
    return redactValue({
      jsRoutes: cleanRoutes,
      scriptRoutes: cleanScriptRoutes,
    }).value;
  }

  async send(method, params = /** @type {any} */ ({}), timeoutMs = this.timeoutMs) {
    incrementCounter(this.metrics.counts, 'send');
    incrementCounter(this.metrics.protocol, 'total');
    incrementCounter(this.metrics.protocol.byMethod, method);
    return await this.client.send(method, params, this.sessionId, timeoutMs);
  }

  async #sendRuntimeEvaluateWithRetry(params, timeoutMs = this.timeoutMs) {
    try {
      return await this.send('Runtime.evaluate', params, timeoutMs);
    } catch (error) {
      if (!isTransientRuntimeEvaluateTimeout(error)) {
        throw error;
      }
      await delay(RUNTIME_EVALUATE_RETRY_DELAY_MS);
      return await this.send('Runtime.evaluate', params, timeoutMs);
    }
  }

  async evaluate(expression, { returnByValue = true, awaitPromise = true } = /** @type {any} */ ({})) {
    incrementCounter(this.metrics.counts, 'evaluate');
    const result = await this.#sendRuntimeEvaluateWithRetry({ expression, returnByValue, awaitPromise });
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
    const result = await this.#sendRuntimeEvaluateWithRetry({
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
    const recoveryReadyTimeoutMs = Math.min(timeoutMs, DOM_QUIET_RECOVERY_READY_TIMEOUT_MS);

    try {
      return await this.callPageFunction(defaultDomQuietFunction, quietMs, timeoutMs);
    } catch (error) {
      if (!isTransientDomQuietNavigationError(error)) {
        throw error;
      }

      try {
        await this.waitForDocumentReady(recoveryReadyTimeoutMs);
      } catch {
        throw error;
      }

      try {
        return await this.callPageFunction(defaultDomQuietFunction, quietMs, timeoutMs);
      } catch (retryError) {
        if (!isTransientDomQuietNavigationError(retryError)) {
          throw retryError;
        }

        try {
          await this.waitForDocumentReady(recoveryReadyTimeoutMs);
        } catch {
          throw retryError;
        }
        // DOM quiet is advisory once the page has reached document ready again.
        return {
          reason: 'transient-navigation-skip',
          degraded: true,
          recoveredAfterRetries: 1,
        };
      }
    }
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

  async navigateAndWait(url, waitPolicy, navigationOptions = /** @type {any} */ ({})) {
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

  async captureScreenshot({ fullPage = this.defaultFullPage, allowViewportFallback = true } = /** @type {any} */ ({})) {
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

  async captureEvidence({ html = true, snapshot = true, screenshot = true, fullPage = this.defaultFullPage } = /** @type {any} */ ({})) {
    const evidence = /** @type {any} */ ({});
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

  async ensureHelperBundle(bundleSource, { namespace } = /** @type {any} */ ({})) {
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

  async invokeHelperMethod(methodName, args = /** @type {any[]} */ ([]), { namespace = '__BWS_EXPAND__', bundleSource, fallbackFn } = /** @type {any} */ ({})) {
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
        if (this.client && this.targetId && this.reusedBrowserInstance !== true) {
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

function isTransientRuntimeEvaluateTimeout(error) {
  const message = String(error?.message ?? '');
  return /CDP timeout for Runtime\.evaluate/iu.test(message);
}

function isTransientDomQuietNavigationError(error) {
  const message = String(error?.message ?? '');
  return /CDP Runtime\.evaluate failed: Inspected target navigated or closed/iu.test(message);
}

function isTransientBrowserLaunchError(error) {
  const source = String(error?.message ?? '');
  return /Browser exited before DevTools became ready/iu.test(source)
    || /Timed out waiting for DevToolsActivePort/iu.test(source)
    || /Timed out waiting for browser websocket endpoint/iu.test(source);
}

function isTransientBrowserSessionOpenError(error) {
  const source = String(error?.message ?? '');
  return isTransientBrowserLaunchError(error)
    || /CDP socket closed/iu.test(source)
    || /WebSocket is not open/iu.test(source)
    || /Target closed/iu.test(source)
    || /Inspector\.detached/iu.test(source)
    || /ECONNRESET|EPIPE|socket hang up/iu.test(source);
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
    if (!/^about:blank$/iu.test(comparableStartupUrl)) {
      return null;
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
} = /** @type {any} */ ({})) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.send('Target.getTargets');
    const targetInfo = selectInitialPageTarget(result?.targetInfos, startupUrl);
    if (targetInfo?.targetId) {
      return targetInfo;
    }
    await delay(TARGET_POLL_INTERVAL_MS);
  }

  const error = /** @type {Error & Record<string, any>} */ (new Error('Timed out waiting for initial page target'));
  error.code = 'BROWSER_ATTACH_TIMEOUT';
  throw error;
}

async function openBrowserSessionOnce(
  settings,
  {
    browserPath = settings.browserPath,
    userDataDirPrefix = 'browser-runtime-',
    userDataDir = settings.userDataDir,
    cleanupUserDataDirOnShutdown = settings.cleanupUserDataDirOnShutdown ?? !userDataDir,
  } = /** @type {any} */ ({}),
  deps = /** @type {any} */ ({}),
) {
  const detectBrowserPathImpl = deps.detectBrowserPath ?? detectBrowserPath;
  const launchBrowserImpl = deps.launchBrowser ?? launchBrowser;
  const readExistingBrowserDevToolsImpl = deps.readExistingBrowserDevTools ?? readExistingBrowserDevTools;
  const CdpClientImpl = deps.CdpClient ?? CdpClient;
  const resolvedBrowserPath = browserPath ? path.resolve(browserPath) : await detectBrowserPathImpl();
  if (!resolvedBrowserPath) {
    const error = /** @type {Error & Record<string, any>} */ (new Error('No Chromium/Chrome executable found. Pass browserPath or --browser-path explicitly.'));
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
    const maxLaunchRetries = 1;
    for (let launchAttempt = 0; launchAttempt <= maxLaunchRetries; launchAttempt += 1) {
      try {
        browserInfo = await launchBrowserImpl(resolvedBrowserPath, {
          headless: settings.headless,
          timeoutMs: settings.timeoutMs,
          userDataDirPrefix,
          userDataDir,
          cleanupUserDataDirOnShutdown,
          startupUrl,
          launchArgs: settings.launchArgs,
        });
        client = new CdpClientImpl(browserInfo.wsUrl, { timeoutMs: settings.timeoutMs });
        await client.connect();
        break;
      } catch (error) {
        client?.close?.();
        client = null;

        const existingDevToolsAfterFailure = userDataDir
          ? await readExistingBrowserDevToolsImpl(userDataDir, existingBrowserConnectTimeoutMs)
          : null;
        if (existingDevToolsAfterFailure?.wsUrl) {
          client = new CdpClientImpl(existingDevToolsAfterFailure.wsUrl, { timeoutMs: existingBrowserConnectTimeoutMs });
          await client.connect();
          reusedBrowserInstance = true;
          browserInfo = {
            browserProcess: null,
            userDataDir: path.resolve(userDataDir),
            cleanupUserDataDirOnShutdown,
            wsUrl: existingDevToolsAfterFailure.wsUrl,
            startupUrl,
          };
          break;
        }

        const shouldRetryLaunch = launchAttempt < maxLaunchRetries && isTransientBrowserLaunchError(error);
        if (!shouldRetryLaunch) {
          throw error;
        }
        await delay(250);
      }
    }
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

  const networkTracker = createNetworkTracker(client, sessionId, settings.networkCapture ?? {});

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

export async function openBrowserSession(
  settings,
  runtimeOptions = /** @type {any} */ ({}),
  deps = /** @type {any} */ ({}),
) {
  const maxSessionOpenRetries = Math.max(
    0,
    Number.isFinite(Number(settings?.sessionOpenRetries))
      ? Number(settings.sessionOpenRetries)
      : DEFAULT_SESSION_OPEN_RETRIES,
  );
  let lastError = null;
  for (let attempt = 0; attempt <= maxSessionOpenRetries; attempt += 1) {
    try {
      return await openBrowserSessionOnce(settings, runtimeOptions, deps);
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < maxSessionOpenRetries && isTransientBrowserSessionOpenError(error);
      if (!shouldRetry) {
        throw error;
      }
      await delay(SESSION_OPEN_RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError;
}
