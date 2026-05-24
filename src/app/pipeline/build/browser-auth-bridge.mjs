// @ts-check

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeEvidenceRef } from './risk-policy.mjs';
import { assertNoForbiddenPatterns } from '../../../domain/sessions/security-guard.mjs';
import { isInternalUrl, normalizeUrl } from './models.mjs';
import { browserStructureCollectorScript } from './browser-structure-collector.mjs';

const MAX_BRIDGE_BODY_BYTES = 256 * 1024;
const BROWSER_BRIDGE_EXTENSION_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'browser-bridge-extension');
const BRIDGE_CORS_HEADERS = Object.freeze({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
});

export function browserBridgeExtensionDirectory() {
  return BROWSER_BRIDGE_EXTENSION_DIR;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function boundedText(value, fallback = null, maxLength = 160) {
  const raw = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (!raw) {
    return fallback;
  }
  if (/[<>{}]|=|\b(?:authorization|bearer|cookie|sid|uid|user[_-]?id|account[_-]?id|token|secret|session|password|localStorage|sessionStorage|userDataDir|raw\s+dom|raw\s+html|script)\b/iu.test(raw)) {
    return fallback;
  }
  if (!/[\\/]|^https?:/iu.test(raw)) {
    return raw.slice(0, maxLength);
  }
  const safe = sanitizeEvidenceRef(raw);
  if (!safe) return fallback;
  return String(safe).slice(0, maxLength);
}

function safeBoolean(value) {
  return value === true;
}

function safeNumber(value) {
  return Math.max(0, Number(value ?? 0) || 0);
}

function sanitizeRouteTemplate(value) {
  const text = boundedText(value, null, 240);
  if (!text || !text.startsWith('/') || /[?#<>"'{}]|(?:authorization|bearer|cookie|token|secret|session|password|localStorage|sessionStorage|raw\s+dom|raw\s+html)/iu.test(text)) {
    return null;
  }
  return text;
}

function sanitizeControls(value) {
  return (Array.isArray(value) ? value : []).slice(0, 40).map((control, index) => ({
    kind: boundedText(control?.kind ?? control?.controlType, 'button', 40),
    type: boundedText(control?.type, null, 40),
    label: boundedText(control?.label, null, 80),
    name: boundedText(control?.name, null, 80),
    selector: boundedText(control?.selector, `browser-control-${index + 1}`, 120),
    attrs: control?.attrs && typeof control.attrs === 'object'
      ? { role: boundedText(control.attrs.role, null, 40) }
      : {},
  }));
}

function sanitizeForms(value) {
  return (Array.isArray(value) ? value : []).slice(0, 12).map((form, index) => ({
    label: boundedText(form?.label, `browser-form-${index + 1}`, 80),
    selector: boundedText(form?.selector, `browser-form-${index + 1}`, 120),
    method: String(form?.method ?? 'GET').toUpperCase().slice(0, 16),
    action: boundedText(form?.action, null, 200),
    inputs: (Array.isArray(form?.inputs) ? form.inputs : []).slice(0, 20).map((input, inputIndex) => ({
      name: boundedText(input?.name, null, 80),
      type: boundedText(input?.type, null, 40),
      selector: boundedText(input?.selector, `browser-input-${inputIndex + 1}`, 120),
      label: boundedText(input?.label, null, 80),
      tagName: boundedText(input?.tagName, null, 20),
    })),
  }));
}

function sanitizeStructureItems(value) {
  return (Array.isArray(value) ? value : []).slice(0, 24).map((item) => ({
    nodeType: boundedText(item?.nodeType ?? item?.type, 'content', 40),
    structureType: boundedText(item?.structureType ?? item?.structure_type, null, 100),
    labelSummary: boundedText(item?.labelSummary ?? item?.label, null, 160),
    visibleItemCount: safeNumber(item?.visibleItemCount ?? item?.itemCount),
    listPresent: safeBoolean(item?.listPresent ?? item?.listPresence),
    emptyStatePresent: safeBoolean(item?.emptyStatePresent ?? item?.empty_state_present),
    unreadMarkerPresent: safeBoolean(item?.unreadMarkerPresent ?? item?.unread_marker_present),
    routeTemplates: uniqueStrings((item?.routeTemplates ?? item?.route_templates ?? []).map(sanitizeRouteTemplate).filter(Boolean)).slice(0, 20),
  }));
}

function sanitizeBridgeLink(link, site, fallbackUrl, index) {
  if (!link || typeof link !== 'object') {
    return null;
  }
  let normalizedHref;
  try {
    normalizedHref = normalizeUrl(link.normalizedHref ?? link.normalizedUrl ?? link.href ?? link.url, fallbackUrl);
  } catch {
    return null;
  }
  if (!isInternalUrl(normalizedHref, site.allowedDomains)) {
    return null;
  }
  let routeTemplate = sanitizeRouteTemplate(link.routeTemplate ?? link.routePattern);
  if (!routeTemplate) {
    try {
      routeTemplate = new URL(normalizedHref).pathname.replace(/\/+$/u, '') || '/';
    } catch {
      routeTemplate = null;
    }
  }
  return {
    href: normalizedHref,
    normalizedHref,
    label: boundedText(link.label, `browser-link-${index + 1}`, 80),
    selector: boundedText(link.selector, `browser-link-${index + 1}`, 120),
    semanticKind: boundedText(link.semanticKind ?? link.role, null, 60),
    structureType: boundedText(link.structureType ?? link.structure_type, null, 100),
    routeTemplate,
    attrs: {},
  };
}

function sanitizeBridgeLinks(value, site, fallbackUrl) {
  return (Array.isArray(value) ? value : [])
    .map((link, index) => sanitizeBridgeLink(link, site, fallbackUrl, index))
    .filter(Boolean)
    .slice(0, 160);
}

function sanitizeBridgePage(page, site, fallbackUrl) {
  if (!page || typeof page !== 'object') {
    return null;
  }
  let normalizedUrl;
  try {
    normalizedUrl = normalizeUrl(page.normalizedUrl ?? page.url ?? fallbackUrl, site.rootUrl);
  } catch {
    return null;
  }
  if (!isInternalUrl(normalizedUrl, site.allowedDomains)) {
    return null;
  }
  const routeTemplate = sanitizeRouteTemplate(page.routeTemplate ?? page.route_pattern);
  const sanitized = {
    url: normalizedUrl,
    normalizedUrl,
    routeTemplate,
    pageType: boundedText(page.pageType ?? page.page_type, 'browser_authenticated_summary', 100),
    visibleItemCount: safeNumber(page.visibleItemCount ?? page.itemCount),
    listPresent: safeBoolean(page.listPresent ?? page.listPresence),
    emptyStatePresent: safeBoolean(page.emptyStatePresent ?? page.empty_state_present),
    unreadMarkerPresent: safeBoolean(page.unreadMarkerPresent ?? page.unread_marker_present),
    modalPresence: safeBoolean(page.modalPresence ?? page.modal_present),
    tabState: boundedText(page.tabState ?? page.tab_state, null, 80),
    structureHash: boundedText(page.structureHash ?? page.structure_hash, null, 160),
    evidenceLevel: boundedText(page.evidenceLevel, 'browser_structure_verified', 80),
    evidenceStatus: boundedText(page.evidenceStatus, 'structure_summary_present', 80),
    riskLevel: boundedText(page.riskLevel, 'read_personal_medium', 80),
    links: sanitizeBridgeLinks(page.links, site, normalizedUrl),
    routeTemplates: uniqueStrings((page.routeTemplates ?? page.route_templates ?? []).map(sanitizeRouteTemplate).filter(Boolean)).slice(0, 80),
    controls: sanitizeControls(page.controls),
    forms: sanitizeForms(page.forms),
    structureItems: sanitizeStructureItems(page.structureItems),
    overlayFor: page.overlayFor ? boundedText(page.overlayFor, null, 240) : null,
  };
  assertNoForbiddenPatterns(sanitized);
  return sanitized;
}

export function sanitizeBrowserAuthBridgePayload(payload = /** @type {any} */ ({}), {
  site,
  fallbackUrl,
} = /** @type {any} */ ({})) {
  assertNoForbiddenPatterns(payload);
  const authenticatedPages = (payload.authenticatedPages ?? payload.pages ?? [])
    .map((page) => sanitizeBridgePage(page, site, fallbackUrl))
    .filter(Boolean)
    .slice(0, 80);
  const authenticatedOverlayPages = (payload.authenticatedOverlayPages ?? payload.overlayPages ?? [])
    .map((page) => sanitizeBridgePage(page, site, fallbackUrl))
    .filter(Boolean)
    .slice(0, 80);
  const sanitized = {
    authenticatedPages,
    authenticatedOverlayPages,
    warnings: uniqueStrings(payload.warnings ?? []).slice(0, 20),
  };
  assertNoForbiddenPatterns(sanitized);
  return sanitized;
}

function bridgeSession({ nonce, targetUrl, submitUrl, collectorUrl, extensionStatusUrl, sourceLayer = 'authenticated' }) {
  const parsedTarget = new URL(targetUrl);
  return {
    schemaVersion: 1,
    artifactFamily: 'siteforge-browser-bridge-session',
    nonce,
    targetUrl,
    submitUrl,
    collectorUrl,
    extensionStatusUrl,
    allowedHost: parsedTarget.hostname,
    allowedOrigin: parsedTarget.origin,
    sourceLayer,
    privacy: {
      rawDom: false,
      rawHtml: false,
      bodyText: false,
      cookieRead: false,
      cookiePersisted: false,
      tokenPersisted: false,
      browserProfilePersisted: false,
      storageRead: false,
    },
  };
}

function bridgePageHtml({ nonce, targetUrl, submitUrl, collectorUrl, sessionUrl, extensionDir }) {
  const safeTargetUrl = escapeHtml(sanitizeEvidenceRef(targetUrl) ?? targetUrl);
  const safeSubmitUrl = escapeHtml(submitUrl);
  const safeCollectorUrl = escapeHtml(collectorUrl);
  const safeSessionUrl = escapeHtml(sessionUrl);
  const safeExtensionDir = escapeHtml(extensionDir);
  const safeNonce = escapeHtml(nonce);
  const bookmarklet = `javascript:(()=>{const s=document.createElement('script');s.src=${JSON.stringify(collectorUrl)};document.documentElement.appendChild(s);})()`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>SiteForge Browser Auth Bridge</title>
<meta name="siteforge-browser-bridge" content="1">
<meta name="siteforge-bridge-nonce" content="${safeNonce}">
<meta name="siteforge-bridge-session" content="${safeSessionUrl}">
</head>
<body>
<main>
<h1>SiteForge Browser Auth Bridge</h1>
<p>Open the target site in this browser and submit only sanitized structure summaries to this local one-time endpoint.</p>
<p>If the SiteForge Browser Bridge extension is installed, it will use this one-time session automatically.</p>
<p><a href="${safeTargetUrl}">Open target site</a></p>
<p>Collector script for a SiteForge browser bridge extension or one-time bookmarklet:</p>
<p><a href="${escapeHtml(bookmarklet)}">Collect SiteForge structure summary</a></p>
<pre>nonce: ${safeNonce}
submit: ${safeSubmitUrl}
collector: ${safeCollectorUrl}
session: ${safeSessionUrl}
extension: ${safeExtensionDir}</pre>
</main>
</body></html>`;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BRIDGE_BODY_BYTES) {
        reject(new Error('browser bridge payload too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function bridgeHeaders(extra = /** @type {Record<string, string>} */ ({})) {
  return {
    ...BRIDGE_CORS_HEADERS,
    'cache-control': 'no-store',
    ...extra,
  };
}

export async function runBrowserAuthBridge({
  inputUrl,
  site,
  options = /** @type {any} */ ({}),
  openBrowser,
} = /** @type {any} */ ({})) {
  const targetUrl = normalizeUrl(options.authCheckUrl ?? inputUrl ?? site?.rootUrl, site.rootUrl);
  if (!isInternalUrl(targetUrl, site.allowedDomains)) {
    return {
      status: 'browser_blocked',
      verified: false,
      finalUrl: null,
      positiveSignals: [],
      blockingSignals: ['browser-auth-url-cross-site'],
      verifiedRoutes: [],
      structureSummary: null,
      bridgeSummary: { used: false, persisted: false, redacted: true, pageCount: 0, overlayPageCount: 0 },
    };
  }

  const nonce = randomBytes(16).toString('hex');
  if (typeof options.browserAuthBridgeProvider === 'function') {
    try {
      const provided = await options.browserAuthBridgeProvider({ inputUrl, site, targetUrl, nonce, options });
      const structureSummary = sanitizeBrowserAuthBridgePayload(provided ?? {}, { site, fallbackUrl: targetUrl });
      const pageCount = structureSummary.authenticatedPages.length;
      const overlayPageCount = structureSummary.authenticatedOverlayPages.length;
      return {
        status: pageCount || overlayPageCount ? 'browser_verified' : 'browser_bridge_missing',
        verified: Boolean(pageCount || overlayPageCount),
        finalUrl: targetUrl,
        positiveSignals: pageCount || overlayPageCount ? ['browser_bridge_payload_received', 'browser_structure_summary_present'] : [],
        blockingSignals: pageCount || overlayPageCount ? [] : ['browser-bridge-empty-summary'],
        verifiedRoutes: uniqueStrings([...structureSummary.authenticatedPages, ...structureSummary.authenticatedOverlayPages].map((page) => page.routeTemplate).filter(Boolean)),
        structureSummary,
        bridgeSummary: { used: true, persisted: false, redacted: true, pageCount, overlayPageCount },
      };
    } catch (error) {
      return {
        status: error?.code === 'redaction-failed' ? 'browser_blocked' : 'browser_check_failed',
        verified: false,
        finalUrl: targetUrl,
        positiveSignals: [],
        blockingSignals: [error?.code === 'redaction-failed' ? 'browser-bridge-sensitive-payload' : 'browser-bridge-request-failed'],
        verifiedRoutes: [],
        structureSummary: null,
        bridgeSummary: { used: true, persisted: false, redacted: true, pageCount: 0, overlayPageCount: 0 },
      };
    }
  }

  const timeoutMs = Math.max(1000, Number(options.browserBridgeTimeoutMs ?? options.timeoutMs ?? 30000) || 30000);
  const extensionStages = new Set();
  let resolveSubmission;
  let rejectSubmission;
  const submission = new Promise((resolve, reject) => {
    resolveSubmission = resolve;
    rejectSubmission = reject;
  });

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'OPTIONS') {
        response.writeHead(204, bridgeHeaders());
        response.end();
        return;
      }
      if (request.method === 'GET') {
        const sourceLayer = requestUrl.searchParams.get('sourceLayer') === 'authenticated_overlay'
          ? 'authenticated_overlay'
          : 'authenticated';
        const submitUrl = `http://127.0.0.1:${server.address().port}/submit?nonce=${nonce}`;
        const collectorUrl = `http://127.0.0.1:${server.address().port}/collector.js?nonce=${nonce}&sourceLayer=${sourceLayer}`;
        const sessionUrl = `http://127.0.0.1:${server.address().port}/session.json?nonce=${nonce}&sourceLayer=${sourceLayer}`;
        const extensionStatusUrl = `http://127.0.0.1:${server.address().port}/extension-status?nonce=${nonce}`;
        if (requestUrl.pathname === '/collector.js') {
          response.writeHead(200, bridgeHeaders({
            'content-type': 'application/javascript; charset=utf-8',
          }));
          response.end(browserStructureCollectorScript({
            nonce,
            submitUrl,
            sourceLayer: requestUrl.searchParams.get('sourceLayer') ?? 'authenticated',
          }));
          return;
        }
        if (requestUrl.pathname === '/session.json') {
          if (requestUrl.searchParams.get('nonce') !== nonce) {
            response.writeHead(403, bridgeHeaders({ 'content-type': 'application/json; charset=utf-8' }));
            response.end(JSON.stringify({ ok: false }));
            return;
          }
          response.writeHead(200, bridgeHeaders({ 'content-type': 'application/json; charset=utf-8' }));
          response.end(JSON.stringify(bridgeSession({ nonce, targetUrl, submitUrl, collectorUrl, extensionStatusUrl, sourceLayer })));
          return;
        }
        if (requestUrl.pathname === '/extension-status') {
          if (requestUrl.searchParams.get('nonce') !== nonce) {
            response.writeHead(403, bridgeHeaders({ 'content-type': 'application/json; charset=utf-8' }));
            response.end(JSON.stringify({ ok: false }));
            return;
          }
          const stage = boundedText(requestUrl.searchParams.get('stage'), 'extension-active', 80);
          extensionStages.add(stage);
          response.writeHead(200, bridgeHeaders({ 'content-type': 'application/json; charset=utf-8' }));
          response.end(JSON.stringify({ ok: true }));
          return;
        }
        response.writeHead(200, bridgeHeaders({ 'content-type': 'text/html; charset=utf-8' }));
        response.end(bridgePageHtml({
          nonce,
          targetUrl,
          submitUrl,
          collectorUrl,
          sessionUrl,
          extensionDir: BROWSER_BRIDGE_EXTENSION_DIR,
        }));
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/extension-status') {
        if (requestUrl.searchParams.get('nonce') !== nonce) {
          response.writeHead(403, bridgeHeaders({ 'content-type': 'application/json; charset=utf-8' }));
          response.end(JSON.stringify({ ok: false }));
          return;
        }
        const stage = boundedText(requestUrl.searchParams.get('stage'), 'extension-active', 80);
        extensionStages.add(stage);
        response.writeHead(200, bridgeHeaders({ 'content-type': 'application/json; charset=utf-8' }));
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/submit' && requestUrl.searchParams.get('nonce') === nonce) {
        const body = await readRequestBody(request);
        const payload = JSON.parse(body);
        if (payload?.nonce && payload.nonce !== nonce) {
          throw new Error('browser bridge nonce mismatch');
        }
        const structureSummary = sanitizeBrowserAuthBridgePayload(payload, { site, fallbackUrl: targetUrl });
        response.writeHead(200, bridgeHeaders({ 'content-type': 'application/json; charset=utf-8' }));
        response.end(JSON.stringify({ ok: true }));
        resolveSubmission(structureSummary);
        return;
      }
      response.writeHead(404, bridgeHeaders({ 'content-type': 'application/json; charset=utf-8' }));
      response.end(JSON.stringify({ ok: false }));
    } catch (error) {
      response.writeHead(400, bridgeHeaders({ 'content-type': 'application/json; charset=utf-8' }));
      response.end(JSON.stringify({ ok: false }));
      rejectSubmission(error);
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const bridgeUrl = `http://127.0.0.1:${server.address().port}/?nonce=${nonce}`;
  try {
    if (typeof openBrowser === 'function') {
      await openBrowser(bridgeUrl);
    }
    const structureSummary = await Promise.race([
      submission,
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!structureSummary) {
        const extensionActive = extensionStages.size > 0;
        return {
          status: 'browser_bridge_missing',
          verified: false,
          finalUrl: targetUrl,
          positiveSignals: ['default_browser_opened'],
          blockingSignals: extensionActive
            ? ['browser-bridge-timeout', 'browser-bridge-extension-active-no-summary']
            : ['browser-bridge-timeout', 'browser-bridge-extension-missing-or-inactive'],
          verifiedRoutes: [],
          structureSummary: null,
          bridgeSummary: { used: true, persisted: false, redacted: true, pageCount: 0, overlayPageCount: 0, extensionStages: [...extensionStages].sort() },
        };
    }
    const pageCount = structureSummary.authenticatedPages.length;
    const overlayPageCount = structureSummary.authenticatedOverlayPages.length;
    return {
      status: pageCount || overlayPageCount ? 'browser_verified' : 'browser_bridge_missing',
      verified: Boolean(pageCount || overlayPageCount),
      finalUrl: targetUrl,
      positiveSignals: ['default_browser_opened', 'browser_bridge_payload_received', 'browser_structure_summary_present'],
      blockingSignals: pageCount || overlayPageCount ? [] : ['browser-bridge-empty-summary'],
      verifiedRoutes: uniqueStrings([...structureSummary.authenticatedPages, ...structureSummary.authenticatedOverlayPages].map((page) => page.routeTemplate).filter(Boolean)),
      structureSummary,
      bridgeSummary: { used: true, persisted: false, redacted: true, pageCount, overlayPageCount },
    };
  } catch (error) {
    return {
      status: error?.code === 'redaction-failed' ? 'browser_blocked' : 'browser_check_failed',
      verified: false,
      finalUrl: targetUrl,
      positiveSignals: [],
      blockingSignals: [error?.code === 'redaction-failed' ? 'browser-bridge-sensitive-payload' : 'browser-bridge-request-failed'],
      verifiedRoutes: [],
      structureSummary: null,
      bridgeSummary: { used: true, persisted: false, redacted: true, pageCount: 0, overlayPageCount: 0 },
    };
  } finally {
    server.closeAllConnections?.();
    server.closeIdleConnections?.();
    await new Promise((resolve) => server.close(() => resolve()));
  }
}
