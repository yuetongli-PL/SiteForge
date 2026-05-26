// @ts-check

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SANITIZED_SUMMARY_ONLY, sanitizeEvidenceRef } from './risk-policy.mjs';
import {
  assertNoForbiddenPatterns,
  scanForbiddenPatterns,
} from '../../../domain/sessions/security-guard.mjs';
import { isInternalUrl, isSameSiteUrl, normalizeUrl } from './models.mjs';
import { browserStructureCollectorScript } from './browser-structure-collector.mjs';
import { isUrlAllowedByRobots } from './html.mjs';

const MAX_BRIDGE_BODY_BYTES = 256 * 1024;
const MAX_BRIDGE_ROUTES = 32;
const MAX_EXTENSION_STAGE_TIMELINE = MAX_BRIDGE_ROUTES * 12;
const EXPECTED_BROWSER_BRIDGE_EXTENSION_VERSION = 'route-queue-chinese-semantic-v6';
const BROWSER_BRIDGE_EXTENSION_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'browser-bridge-extension');
const ROUTE_RESULT_MATCH_URL_SYMBOL = Symbol('siteforge.browserBridge.routeResultMatchUrl');
const API_REPLAY_SAFE_METHODS = new Set(['GET', 'HEAD']);
const DEFAULT_API_REPLAY_TIMEOUT_MS = 8_000;
const API_REPLAY_CHALLENGE_PATTERN = /(?:captcha|challenge|verify|verification|required login|login required|sign in|signin|log in|forbidden|access denied|permission denied|risk|anti[- ]?bot|blocked)/iu;
const BRIDGE_CORS_HEADERS = Object.freeze({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
});
const ROUTE_CAPTURE_STATUSES = new Set([
  'captured',
  'captured_with_warning',
  'thin_capture',
  'blocked',
  'timeout',
  'challenge_detected',
]);
const ROUTE_CAPTURED_STATUSES = new Set(['captured', 'captured_with_warning']);
const RETRYABLE_ROUTE_STATUSES = new Set(['timeout', 'challenge_detected', 'thin_capture']);
const RETRYABLE_BLOCKED_REASON_CODES = new Set([
  'browser-bridge-collector-injection-failed',
  'browser-bridge-route-open-failed',
  'execute-script-failed',
  'collector-message-failed',
  'navigation-in-progress',
  'tab-missing',
]);

export function browserBridgeExtensionDirectory() {
  return BROWSER_BRIDGE_EXTENSION_DIR;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function bridgeExtensionVersionSignals(extensionStages = []) {
  const stages = Array.isArray(extensionStages) ? extensionStages : [];
  const contentVersions = stages
    .map((stage) => /^bridge-content-version:(.+)$/u.exec(String(stage ?? '').trim())?.[1])
    .filter(Boolean);
  const backgroundVersions = stages
    .map((stage) => /^bridge-version:(.+)$/u.exec(String(stage ?? '').trim())?.[1])
    .filter(Boolean);
  const collectorVersionsByRouteId = new Map();
  for (const stage of stages) {
    const match = /^collector-version:([^:]+):(.+)$/u.exec(String(stage ?? '').trim());
    if (!match) {
      continue;
    }
    const routeId = String(match[1] ?? '').trim();
    const version = String(match[2] ?? '').trim();
    if (!routeId || !version) {
      continue;
    }
    collectorVersionsByRouteId.set(routeId, uniqueStrings([
      ...(collectorVersionsByRouteId.get(routeId) ?? []),
      version,
    ]));
  }
  const collectorVersions = stages
    .map((stage) => /^collector-version:(.+)$/u.exec(String(stage ?? '').trim())?.[1])
    .filter(Boolean);
  return {
    contentVersions: uniqueStrings(contentVersions),
    backgroundVersions: uniqueStrings(backgroundVersions),
    collectorVersions: uniqueStrings(collectorVersions),
    collectorVersionsByRouteId,
  };
}

function collectorVersionMatches(routeResult = /** @type {any} */ ({}), collectorVersionsByRouteId = new Map()) {
  const routeId = String(routeResult?.routeId ?? '').trim();
  const payloadVersion = String(routeResult?.collectorVersion ?? '').trim();
  if (payloadVersion === EXPECTED_BROWSER_BRIDGE_EXTENSION_VERSION) {
    return true;
  }
  return routeId
    ? (collectorVersionsByRouteId.get(routeId) ?? []).includes(EXPECTED_BROWSER_BRIDGE_EXTENSION_VERSION)
    : false;
}

function bridgeExtensionVersionBlockingSignals(extensionStages = [], routeResults = []) {
  const stages = uniqueStrings(extensionStages);
  if (!stages.length || !stages.some((stage) => /^bridge(?:-content)?-version:/u.test(stage))) {
    return [];
  }
  const { contentVersions, backgroundVersions, collectorVersionsByRouteId } = bridgeExtensionVersionSignals(stages);
  const submittedRouteIds = stages
    .map((stage) => /^collector-submit-ok:([^:]+)$/u.exec(String(stage ?? '').trim())?.[1])
    .filter(Boolean);
  const capturedRouteResults = (Array.isArray(routeResults) ? routeResults : [])
    .filter((result) => routeResultCaptured(result) && result?.routeId);
  const routeIdsRequiringCollectorVersion = uniqueStrings([
    ...submittedRouteIds,
    ...capturedRouteResults.map((result) => result.routeId),
  ]);
  if (
    contentVersions.includes(EXPECTED_BROWSER_BRIDGE_EXTENSION_VERSION)
    && backgroundVersions.includes(EXPECTED_BROWSER_BRIDGE_EXTENSION_VERSION)
    && routeIdsRequiringCollectorVersion.every((routeId) => collectorVersionMatches(
      (Array.isArray(routeResults) ? routeResults : []).find((result) => result?.routeId === routeId) ?? { routeId },
      collectorVersionsByRouteId,
    ))
  ) {
    return [];
  }
  return ['browser-bridge-extension-stale-or-incompatible'];
}

function routeStatus(value, fallback = 'timeout') {
  const status = String(value ?? '').trim();
  return ROUTE_CAPTURE_STATUSES.has(status) ? status : fallback;
}

function browserBridgeRequestedTimeoutMs(options = /** @type {any} */ ({})) {
  return Math.max(1000, Number(options.browserBridgeTimeoutMs ?? options.timeoutMs ?? 30000) || 30000);
}

function browserBridgeApiReplayTimeoutMs(options = /** @type {any} */ ({})) {
  const configured = Number(options.browserBridgeApiReplayTimeoutMs);
  return Math.max(1000, Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_API_REPLAY_TIMEOUT_MS);
}

function browserBridgeMaxRetryPasses(options = /** @type {any} */ ({})) {
  return Math.max(0, Number(options.browserBridgeMaxRetryPasses ?? 2) || 0);
}

function browserBridgePerPassTimeoutMs(options = /** @type {any} */ ({})) {
  return Math.max(1000, Number(options.browserBridgePerPassTimeoutMs ?? browserBridgeRequestedTimeoutMs(options)) || 30000);
}

function browserBridgeRetryPassTimeoutMs(options = /** @type {any} */ ({}), routeCount = 1) {
  const requestedTimeoutMs = browserBridgeRequestedTimeoutMs(options);
  const routeBudgetMs = Math.max(15000, Math.min(requestedTimeoutMs, Math.max(1, Number(routeCount) || 1) * 9000));
  return Math.max(1000, Number(options.browserBridgeRetryPassTimeoutMs ?? routeBudgetMs) || routeBudgetMs);
}

function routeStatusCaptured(value) {
  return ROUTE_CAPTURED_STATUSES.has(routeStatus(value, 'timeout'));
}

function routeResultCaptured(result) {
  return routeStatusCaptured(result?.status) && result?.captured !== false;
}

function routeResultRetryable(result) {
  const status = routeStatus(result?.status, 'timeout');
  const reasonCode = String(result?.reasonCode ?? '').trim();
  if (status === 'challenge_detected' && reasonCode === 'browser-bridge-definite-challenge') {
    return false;
  }
  if (RETRYABLE_ROUTE_STATUSES.has(status)) {
    return true;
  }
  if (status !== 'blocked') {
    return false;
  }
  return RETRYABLE_BLOCKED_REASON_CODES.has(reasonCode);
}

function routeRetryPriority(result) {
  const status = routeStatus(result?.status, 'timeout');
  const reasonCode = String(result?.reasonCode ?? '').trim();
  if (status === 'timeout' || reasonCode === 'navigation-in-progress') {
    return 0;
  }
  if (/open-failed|execute-script-failed|collector-message-failed|injection-failed|tab-missing/u.test(reasonCode)) {
    return 1;
  }
  if (status === 'thin_capture') {
    return 2;
  }
  if (status === 'challenge_detected') {
    return 3;
  }
  return 4;
}

function routeSourceLayer(value) {
  return value === 'authenticated_overlay' ? 'authenticated_overlay' : 'authenticated';
}

function routeTemplateFromUrl(urlValue) {
  try {
    return new URL(urlValue).pathname.replace(/\/+$/u, '') || '/';
  } catch {
    return null;
  }
}

function normalizeRouteUrl(value, site) {
  const raw = typeof value === 'string'
    ? value
    : value?.targetUrl ?? value?.url ?? value?.href ?? value?.path ?? value?.route;
  const normalized = normalizeUrl(raw, site.rootUrl);
  if (!isInternalUrl(normalized, site.allowedDomains)) {
    return null;
  }
  const parsed = new URL(normalized);
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function browserBridgeRouteAllowedByRobots(urlValue, options = /** @type {any} */ ({})) {
  const robotsPolicy = options.browserBridgeRobotsPolicy ?? null;
  return !robotsPolicy || isUrlAllowedByRobots(urlValue, robotsPolicy);
}

function browserBridgeRouteDescriptor(urlValue, sourceLayer, id, reasonCode = null) {
  const parsed = new URL(urlValue);
  return {
    id,
    targetUrl: urlValue,
    sourceLayer,
    allowedHost: parsed.hostname,
    allowedOrigin: parsed.origin,
    routeTemplate: routeTemplateFromUrl(urlValue),
    reasonCode,
  };
}

function routeQueueFromConfiguredRoutes({
  site,
  inputUrl,
  targetUrl,
  options = /** @type {any} */ ({}),
} = /** @type {any} */ ({})) {
  const authRoutes = [
    ...(options.authRoutes ?? []),
    ...(options.localBuildConfig?.authRoutes ?? []),
  ];
  const revisitRoutes = [
    ...(options.publicRevisitRoutes ?? []),
    ...(options.localBuildConfig?.publicRevisitRoutes ?? []),
  ];
  const routeEntries = [];
  for (const value of authRoutes) {
    routeEntries.push({ value, sourceLayer: 'authenticated' });
  }
  for (const value of revisitRoutes) {
    routeEntries.push({ value, sourceLayer: 'authenticated_overlay' });
  }
  if (!routeEntries.length) {
    routeEntries.push({ value: targetUrl ?? inputUrl ?? site.rootUrl, sourceLayer: 'authenticated' });
  }

  const seen = new Set();
  const routes = [];
  const blockedRoutes = [];
  for (const entry of routeEntries) {
    let normalizedUrl = null;
    try {
      normalizedUrl = normalizeRouteUrl(entry.value, site);
    } catch {
      continue;
    }
    if (!normalizedUrl) {
      continue;
    }
    const sourceLayer = routeSourceLayer(entry.sourceLayer);
    const key = `${sourceLayer}\u0000${normalizedUrl}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (!browserBridgeRouteAllowedByRobots(normalizedUrl, options)) {
      blockedRoutes.push(browserBridgeRouteDescriptor(
        normalizedUrl,
        sourceLayer,
        `robots-blocked-route-${blockedRoutes.length + 1}`,
        'robots-disallowed',
      ));
      continue;
    }
    if (routes.length >= MAX_BRIDGE_ROUTES) {
      blockedRoutes.push(browserBridgeRouteDescriptor(
        normalizedUrl,
        sourceLayer,
        `route-limit-exceeded-${blockedRoutes.length + 1}`,
        'browser-bridge-route-limit-exceeded',
      ));
      continue;
    }
    routes.push(browserBridgeRouteDescriptor(normalizedUrl, sourceLayer, `route-${routes.length + 1}`));
  }
  return { routes, blockedRoutes };
}

function requestedRouteMatchers(options = /** @type {any} */ ({})) {
  const values = [
    ...(options.browserBridgeRouteIds ?? []),
    ...(options.browserBridgeRetryRouteIds ?? []),
    ...(options.browserBridgeRouteTemplates ?? []),
    ...(options.browserBridgeRetryRouteTemplates ?? []),
  ].map((value) => String(value ?? '').trim()).filter(Boolean);
  return new Set(values);
}

function filterRoutesForRetry(routes = /** @type {any[]} */ ([]), options = /** @type {any} */ ({})) {
  const matchers = requestedRouteMatchers(options);
  if (!matchers.size) {
    return routes;
  }
  const filtered = routes.filter((route) => (
    matchers.has(route.id)
    || matchers.has(route.routeTemplate)
    || matchers.has(route.targetUrl)
  ));
  return filtered.length ? filtered : routes;
}

function routeKey(route) {
  return `${routeSourceLayer(route?.sourceLayer)}\u0000${String(route?.targetUrl ?? '').trim()}`;
}

function safeRouteStatusRef(urlValue, site) {
  try {
    const normalized = normalizeRouteUrl(urlValue, site);
    return new URL(normalized).pathname || '/';
  } catch {
    return null;
  }
}

function routeResultMatchUrl(value, site) {
  try {
    return normalizeRouteUrl(value, site);
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

const BRIDGE_STAGE_TOKEN_PATTERN = '[a-z0-9][a-z0-9._-]{0,79}';
const BRIDGE_EXTENSION_STAGE_PATTERNS = Object.freeze([
  /^(?:bridge-content-active|background-session-accepted|background-session-rejected|target-route-queue-started|target-tab-created|session-complete|extension-active)$/u,
  new RegExp(`^(?:bridge-content-version|bridge-version):${BRIDGE_STAGE_TOKEN_PATTERN}$`, 'u'),
  new RegExp(`^(?:route-opened|route-complete|route-open-failed|route-load-fallback|route-tab-settling|route-tab-stable|route-tab-usable-while-loading|navigation-in-progress|route-host-mismatch|route-login-wall|route-url-canonicalized|route-status-submit-failed|collector-injecting|collector-reinjecting):${BRIDGE_STAGE_TOKEN_PATTERN}$`, 'u'),
  new RegExp(`^collector-version:${BRIDGE_STAGE_TOKEN_PATTERN}:${BRIDGE_STAGE_TOKEN_PATTERN}$`, 'u'),
  new RegExp(`^collector-submit-ok:${BRIDGE_STAGE_TOKEN_PATTERN}$`, 'u'),
  new RegExp(`^execute-script-failed:${BRIDGE_STAGE_TOKEN_PATTERN}:attempt-[0-9]{1,2}$`, 'u'),
  new RegExp(`^collector-message-failed:${BRIDGE_STAGE_TOKEN_PATTERN}(?::${BRIDGE_STAGE_TOKEN_PATTERN})?:attempt-[0-9]{1,2}$`, 'u'),
  new RegExp(`^route-collect-failed:${BRIDGE_STAGE_TOKEN_PATTERN}:${BRIDGE_STAGE_TOKEN_PATTERN}$`, 'u'),
]);

function bridgeDiagnosticLooksSensitive(raw) {
  return /[<>{}=]|\b(?:authorization|bearer|cookie|sid|uid|user[_-]?id|account[_-]?id|token|secret|password|localStorage|sessionStorage|userDataDir|raw\s+dom|raw\s+html)\b/iu.test(raw);
}

function sanitizeBridgeExtensionStage(value, fallback = null, maxLength = 160) {
  const raw = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (!raw || raw.length > maxLength || bridgeDiagnosticLooksSensitive(raw)) {
    return fallback;
  }
  if (!BRIDGE_EXTENSION_STAGE_PATTERNS.some((pattern) => pattern.test(raw))) {
    return fallback;
  }
  try {
    assertNoForbiddenPatterns(raw);
  } catch {
    return fallback;
  }
  return raw.slice(0, maxLength);
}

function boundedText(value, fallback = null, maxLength = 160) {
  const raw = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (!raw) {
    return fallback;
  }
  if (sanitizeBridgeExtensionStage(raw, null, maxLength)) {
    return raw.slice(0, maxLength);
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

function isRawUrlFinding(finding) {
  const pathText = String(finding?.path ?? '').toLowerCase();
  return /(?:^|\.)(?:href|normalizedhref|normalizedurl|url|targeturl|action)$/u.test(pathText);
}

function assertNoForbiddenPatternsExceptRawUrls(value) {
  const findings = scanForbiddenPatterns(value).filter((finding) => !isRawUrlFinding(finding));
  if (!findings.length) {
    return true;
  }
  /** @type {Error & Record<string, any>} */
  const error = new Error('Forbidden sensitive pattern detected');
  error.code = 'redaction-failed';
  error.findings = findings;
  throw error;
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
  const parsedHref = new URL(normalizedHref);
  parsedHref.username = '';
  parsedHref.password = '';
  parsedHref.search = '';
  parsedHref.hash = '';
  let routeTemplate = sanitizeRouteTemplate(link.routeTemplate ?? link.routePattern);
  if (!routeTemplate) {
    try {
      routeTemplate = parsedHref.pathname.replace(/\/+$/u, '') || '/';
    } catch {
      routeTemplate = null;
    }
  }
  const safeHref = routeTemplate ? `${parsedHref.origin}${routeTemplate}` : parsedHref.toString();
  return {
    href: safeHref,
    normalizedHref: safeHref,
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

function sanitizeRouteResult(result, site, fallback = /** @type {any} */ ({})) {
  if (!result || typeof result !== 'object') {
    return null;
  }
  const routeId = boundedText(result.routeId ?? result.id ?? fallback.routeId, null, 80);
  const sourceLayer = routeSourceLayer(result.sourceLayer ?? fallback.sourceLayer);
  const status = routeStatus(result.status ?? fallback.status);
  const reasonCode = boundedText(
    result.reasonCode ?? result.reason ?? fallback.reasonCode,
    routeStatusCaptured(status) ? null : status,
    80,
  );
  const targetRoute = safeRouteStatusRef(result.targetUrl ?? result.url ?? fallback.targetUrl, site)
    ?? sanitizeRouteTemplate(result.routeTemplate ?? fallback.routeTemplate);
  const retryAttemptCount = safeNumber(result.retryAttemptCount ?? fallback.retryAttemptCount);
  const sanitized = {
    routeId,
    sourceLayer,
    targetRoute,
    status,
    reasonCode,
    captured: routeStatusCaptured(status),
  };
  if (result.initialStatus ?? fallback.initialStatus) {
    sanitized.initialStatus = routeStatus(result.initialStatus ?? fallback.initialStatus, status);
  }
  if (result.initialReasonCode ?? fallback.initialReasonCode) {
    sanitized.initialReasonCode = boundedText(result.initialReasonCode ?? fallback.initialReasonCode, null, 80);
  }
  if (result.finalStatus ?? fallback.finalStatus) {
    sanitized.finalStatus = routeStatus(result.finalStatus ?? fallback.finalStatus, status);
  }
  if (result.finalReasonCode ?? fallback.finalReasonCode) {
    sanitized.finalReasonCode = boundedText(result.finalReasonCode ?? fallback.finalReasonCode, null, 80);
  }
  if (retryAttemptCount > 0) {
    sanitized.retryAttemptCount = retryAttemptCount;
    sanitized.retryOutcome = boundedText(result.retryOutcome ?? fallback.retryOutcome, null, 80);
  }
  if (result.collectorVersion ?? fallback.collectorVersion) {
    sanitized.collectorVersion = boundedText(result.collectorVersion ?? fallback.collectorVersion, null, 120);
  }
  const matchUrl = routeResultMatchUrl(
    result.normalizedUrl
      ?? result.targetUrl
      ?? result.url
      ?? result.targetRoute
      ?? result.routeTemplate
      ?? result.path
      ?? result.route,
    site,
  );
  if (matchUrl) {
    Object.defineProperty(sanitized, ROUTE_RESULT_MATCH_URL_SYMBOL, {
      value: matchUrl,
      enumerable: false,
      configurable: false,
    });
  }
  return sanitized;
}

function sanitizeRouteResults(value, site) {
  return (Array.isArray(value) ? value : [])
    .map((result) => sanitizeRouteResult(result, site))
    .filter(Boolean)
    .slice(0, MAX_BRIDGE_ROUTES * 2);
}

function routeCollectorVersionKey(payload = /** @type {any} */ ({})) {
  const routeId = String(payload?.routeId ?? '').trim();
  if (!routeId) {
    return null;
  }
  return `${routeSourceLayer(payload.sourceLayer)}\u0000${routeId}`;
}

function collectorVersionsFromRouteResults(routeResults = []) {
  const versions = new Map();
  for (const result of routeResults) {
    const key = routeCollectorVersionKey(result);
    if (!key || !result?.collectorVersion) {
      continue;
    }
    versions.set(key, result.collectorVersion);
  }
  return versions;
}

function pageWithCollectorVersion(page, collectorVersions) {
  const key = routeCollectorVersionKey(page);
  const collectorVersion = key ? collectorVersions.get(key) : null;
  return collectorVersion && !page.collectorVersion
    ? { ...page, collectorVersion }
    : page;
}

function routeResultMergeKey(result) {
  if (result?.routeId) {
    return `id:${result.routeId}`;
  }
  if (result?.sourceLayer || result?.targetRoute) {
    return `route:${routeSourceLayer(result.sourceLayer)}:${String(result.targetRoute ?? '').trim()}`;
  }
  return null;
}

function routeResultSpecificity(result) {
  const status = routeStatus(result?.status, 'timeout');
  if (routeResultCaptured(result)) {
    return 5;
  }
  if (status === 'challenge_detected') {
    return 4;
  }
  if (status === 'thin_capture') {
    return 3;
  }
  if (status === 'blocked') {
    return 2;
  }
  return 1;
}

function mergeRouteResults(results = []) {
  const byKey = new Map();
  const unkeyed = [];
  for (const result of results) {
    if (!result) {
      continue;
    }
    const key = routeResultMergeKey(result);
    if (!key) {
      unkeyed.push(result);
      continue;
    }
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, result);
      continue;
    }
    if (routeResultCaptured(existing) && !routeResultCaptured(result)) {
      continue;
    }
    if (
      routeResultCaptured(result)
      || routeResultSpecificity(result) >= routeResultSpecificity(existing)
    ) {
      byKey.set(key, result);
    }
  }
  return [...byKey.values(), ...unkeyed].slice(0, MAX_BRIDGE_ROUTES * 4);
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
  const parsedPageUrl = new URL(normalizedUrl);
  parsedPageUrl.username = '';
  parsedPageUrl.password = '';
  parsedPageUrl.search = '';
  parsedPageUrl.hash = '';
  normalizedUrl = parsedPageUrl.toString();
  const routeTemplate = sanitizeRouteTemplate(page.routeTemplate ?? page.route_pattern);
  const sanitized = {
    routeId: boundedText(page.routeId, null, 80),
    url: normalizedUrl,
    normalizedUrl,
    routeTemplate,
    pageType: boundedText(page.pageType ?? page.page_type, 'browser_authenticated_summary', 100),
    sourceLayer: routeSourceLayer(page.sourceLayer),
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
  assertNoForbiddenPatternsExceptRawUrls(payload);
  const routeResults = sanitizeRouteResults(payload.routeResults ?? payload.routeStatuses, site);
  const collectorVersions = collectorVersionsFromRouteResults(routeResults);
  const authenticatedPages = (payload.authenticatedPages ?? payload.pages ?? [])
    .map((page) => sanitizeBridgePage(page, site, fallbackUrl))
    .filter(Boolean)
    .map((page) => ({ ...page, sourceLayer: 'authenticated' }))
    .map((page) => pageWithCollectorVersion(page, collectorVersions))
    .slice(0, 80);
  const authenticatedOverlayPages = (payload.authenticatedOverlayPages ?? payload.overlayPages ?? [])
    .map((page) => sanitizeBridgePage(page, site, fallbackUrl))
    .filter(Boolean)
    .map((page) => ({ ...page, sourceLayer: 'authenticated_overlay' }))
    .map((page) => pageWithCollectorVersion(page, collectorVersions))
    .slice(0, 80);
  const sanitized = {
    authenticatedPages,
    authenticatedOverlayPages,
    routeResults,
    warnings: uniqueStrings(payload.warnings ?? []).slice(0, 20),
  };
  assertNoForbiddenPatterns(sanitized);
  return sanitized;
}

function pageStructureScore(page = /** @type {any} */ ({})) {
  return [
    page.links?.length ?? 0,
    page.routeTemplates?.length ?? 0,
    page.controls?.length ?? 0,
    page.forms?.length ?? 0,
    page.structureItems?.length ?? 0,
    Number(page.visibleItemCount ?? 0) || 0,
    page.listPresent === true ? 1 : 0,
  ].reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
}

function pageRouteCaptureStatus(page = /** @type {any} */ ({})) {
  if (pageStructureScore(page) <= 0) {
    return {
      status: 'thin_capture',
      reasonCode: 'browser-bridge-low-structure-evidence',
    };
  }
  const evidenceText = [
    page.evidenceStatus,
    page.evidenceLevel,
    page.routeCaptureStatus,
    page.captureStatus,
  ].join(' ');
  if (/captured_with_warning|possible[_-]challenge|warning/iu.test(evidenceText)) {
    return {
      status: 'captured_with_warning',
      reasonCode: 'browser-bridge-possible-challenge-with-structure',
    };
  }
  return {
    status: 'captured',
    reasonCode: null,
  };
}

function expectedRouteMaps(routes) {
  const expected = routes.map((route) => ({
    ...route,
    key: routeKey(route),
  }));
  return {
    expected,
    byId: new Map(expected.map((route) => [route.id, route])),
    byKey: new Map(expected.map((route) => [route.key, route])),
  };
}

function matchedRouteForPayload(payload, site, routeMaps) {
  const rawUrl = payload?.[ROUTE_RESULT_MATCH_URL_SYMBOL]
    ?? payload?.normalizedUrl
    ?? payload?.targetUrl
    ?? payload?.url
    ?? payload?.href
    ?? payload?.targetRoute
    ?? payload?.routeTemplate
    ?? payload?.path
    ?? payload?.route;
  const hasPayloadUrl = typeof rawUrl === 'string' && rawUrl.trim() !== '';
  let normalizedUrl = null;
  if (hasPayloadUrl) {
    try {
      normalizedUrl = normalizeRouteUrl(rawUrl, site);
    } catch {
      normalizedUrl = null;
    }
  }
  const routeById = payload?.routeId ? routeMaps.byId.get(payload.routeId) : null;
  if (routeById && !hasPayloadUrl) {
    return routeById;
  }
  if (routeById && normalizedUrl) {
    if (routeById.key === `${routeSourceLayer(payload?.sourceLayer)}\u0000${normalizedUrl}`) {
      return routeById;
    }
    if (
      payload?.collectorVersion === EXPECTED_BROWSER_BRIDGE_EXTENSION_VERSION
      && routeSourceLayer(payload?.sourceLayer) === routeById.sourceLayer
      && isInternalUrl(normalizedUrl, site.allowedDomains)
    ) {
      return routeById;
    }
    return null;
  }
  if (!normalizedUrl) {
    return null;
  }
  return routeMaps.byKey.get(`${routeSourceLayer(payload?.sourceLayer)}\u0000${normalizedUrl}`) ?? null;
}

function routeResultsFromSummary(routes, structureSummary, site) {
  const routeMaps = expectedRouteMaps(routes);
  const { expected } = routeMaps;
  const results = new Map(expected.map((route) => [route.id, sanitizeRouteResult({
    routeId: route.id,
    sourceLayer: route.sourceLayer,
    targetUrl: route.targetUrl,
    routeTemplate: route.routeTemplate,
    status: 'timeout',
    reasonCode: 'browser-bridge-route-timeout',
  }, site)]));

  const pageResults = new Map();
  for (const page of [
    ...(structureSummary.authenticatedPages ?? []),
    ...(structureSummary.authenticatedOverlayPages ?? []),
  ]) {
    const matched = matchedRouteForPayload(page, site, routeMaps);
    if (!matched) {
      continue;
    }
    const capture = pageRouteCaptureStatus(page);
    pageResults.set(matched.id, sanitizeRouteResult({
      routeId: matched.id,
      sourceLayer: matched.sourceLayer,
      targetUrl: matched.targetUrl,
      routeTemplate: matched.routeTemplate,
      status: capture.status,
      reasonCode: capture.reasonCode,
    }, site));
  }

  const explicitRouteIds = new Set();
  for (const explicit of structureSummary.routeResults ?? []) {
    const matched = matchedRouteForPayload(explicit, site, routeMaps);
    if (!matched) {
      continue;
    }
    const sanitized = sanitizeRouteResult({
      ...explicit,
      routeId: matched.id,
      sourceLayer: matched.sourceLayer,
      targetUrl: matched.targetUrl,
      routeTemplate: matched.routeTemplate,
    }, site, matched);
    if (sanitized?.routeId) {
      explicitRouteIds.add(sanitized.routeId);
      const pageResult = pageResults.get(sanitized.routeId);
      if (routeResultCaptured(sanitized) && !routeResultCaptured(pageResult)) {
        results.set(sanitized.routeId, pageResult ?? sanitizeRouteResult({
          ...sanitized,
          status: 'blocked',
          reasonCode: 'browser-bridge-captured-without-summary',
          captured: false,
        }, site, matched));
        continue;
      }
      results.set(sanitized.routeId, sanitized);
    }
  }

  for (const [routeId, pageResult] of pageResults) {
    if (explicitRouteIds.has(routeId)) {
      continue;
    }
    const current = results.get(routeId);
    if (!routeResultCaptured(current)) {
      results.set(routeId, pageResult);
    }
  }
  return [...results.values()].filter(Boolean);
}

function mergeStructureSummary(base, next) {
  base.authenticatedPages.push(...(next.authenticatedPages ?? []));
  base.authenticatedOverlayPages.push(...(next.authenticatedOverlayPages ?? []));
  base.warnings.push(...(next.warnings ?? []));
  base.routeResults = mergeRouteResults([
    ...(base.routeResults ?? []),
    ...(next.routeResults ?? []),
  ]);
  base.authenticatedPages = base.authenticatedPages.slice(0, 80);
  base.authenticatedOverlayPages = base.authenticatedOverlayPages.slice(0, 80);
  base.warnings = uniqueStrings(base.warnings).slice(0, 20);
  return base;
}

function finalizeStructureSummary(routes, structureSummary, site) {
  const routeMaps = expectedRouteMaps(routes);
  const dedupedPages = (pages) => {
    const byKey = new Map();
    for (const page of pages) {
      const key = `${page.sourceLayer}\u0000${page.routeId ?? page.normalizedUrl ?? page.url ?? page.routeTemplate}`;
      const existing = byKey.get(key);
      if (!existing || pageStructureScore(page) > pageStructureScore(existing)) {
        byKey.set(key, page);
      }
    }
    return [...byKey.values()];
  };
  const routeMatched = (page) => Boolean(matchedRouteForPayload(page, site, routeMaps));
  const allAuthenticatedPages = dedupedPages(structureSummary.authenticatedPages ?? []).filter(routeMatched).slice(0, 80);
  const allAuthenticatedOverlayPages = dedupedPages(structureSummary.authenticatedOverlayPages ?? []).filter(routeMatched).slice(0, 80);
  const finalized = {
    authenticatedPages: allAuthenticatedPages
      .filter((page) => pageRouteCaptureStatus(page).status !== 'thin_capture')
      .slice(0, 80),
    authenticatedOverlayPages: allAuthenticatedOverlayPages
      .filter((page) => pageRouteCaptureStatus(page).status !== 'thin_capture')
      .slice(0, 80),
    routeResults: [],
    warnings: uniqueStrings(structureSummary.warnings ?? []).slice(0, 20),
  };
  finalized.routeResults = routeResultsFromSummary(routes, {
    authenticatedPages: allAuthenticatedPages,
    authenticatedOverlayPages: allAuthenticatedOverlayPages,
    routeResults: structureSummary.routeResults ?? [],
  }, site);
  return finalized;
}

function stripCollectorVersionFromRouteResult(result = /** @type {any} */ ({})) {
  const { collectorVersion, ...publicResult } = result;
  return publicResult;
}

function stripCollectorVersionFromPage(page = /** @type {any} */ ({})) {
  const { collectorVersion, ...publicPage } = page;
  return publicPage;
}

function stripCollectorVersionsFromSummary(summary = null) {
  if (!summary) {
    return summary;
  }
  return {
    ...summary,
    authenticatedPages: (summary.authenticatedPages ?? []).map(stripCollectorVersionFromPage),
    authenticatedOverlayPages: (summary.authenticatedOverlayPages ?? []).map(stripCollectorVersionFromPage),
    routeResults: (summary.routeResults ?? []).map(stripCollectorVersionFromRouteResult),
  };
}

function stripCollectorVersionsFromResult(result = /** @type {any} */ ({})) {
  return {
    ...result,
    structureSummary: stripCollectorVersionsFromSummary(result.structureSummary),
    bridgeSummary: result.bridgeSummary
      ? {
        ...result.bridgeSummary,
        routeResults: (result.bridgeSummary.routeResults ?? []).map(stripCollectorVersionFromRouteResult),
      }
      : result.bridgeSummary,
  };
}

function bridgeSummaryFromRoutes(structureSummary, {
  routes = [],
  used = true,
  extensionStages = [],
  extensionStageTimeline = [],
  retrySummary = {},
} = /** @type {any} */ ({})) {
  const routeResults = structureSummary?.routeResults ?? [];
  const routeCount = routes.length || routeResults.length;
  const capturedRouteCount = routeResults.filter(routeResultCaptured).length;
  const missingRouteCount = Math.max(0, routeCount - capturedRouteCount);
  const scheduledRouteCount = routes.filter((route) => !route?.reasonCode).length;
  const overflowRouteCount = routes.filter((route) => route?.reasonCode === 'browser-bridge-route-limit-exceeded').length;
  const retryPasses = Math.max(0, Number(retrySummary.retryPasses ?? 0) || 0);
  const retryAttemptedRouteCount = Math.max(0, Number(retrySummary.retryAttemptedRouteCount ?? 0) || 0);
  const retryCapturedRouteCount = Math.max(0, Number(retrySummary.retryCapturedRouteCount ?? 0) || 0);
  const sanitizedExtensionStages = uniqueStrings((Array.isArray(extensionStages) ? extensionStages : [])
    .map((stage) => sanitizeBridgeExtensionStage(stage))
    .filter(Boolean));
  const sanitizedExtensionStageTimeline = (Array.isArray(extensionStageTimeline) ? extensionStageTimeline : [])
    .map((entry, index) => {
      const stage = sanitizeBridgeExtensionStage(entry?.stage);
      if (!stage) {
        return null;
      }
      const eventIndex = Math.max(0, Number(entry?.eventIndex ?? entry?.index ?? index) || 0);
      return {
        index: eventIndex,
        eventIndex,
        passIndex: Math.max(0, Number(entry?.passIndex ?? 0) || 0),
        stage,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.eventIndex - right.eventIndex);
  const persistedExtensionStageTimeline = sanitizedExtensionStageTimeline.slice(0, MAX_EXTENSION_STAGE_TIMELINE);
  return {
    used: used === true,
    persisted: false,
    redacted: true,
    pageCount: Math.max(0, Number(structureSummary?.authenticatedPages?.length ?? 0) || 0),
    overlayPageCount: Math.max(0, Number(structureSummary?.authenticatedOverlayPages?.length ?? 0) || 0),
    routeCount,
    configuredRouteCount: routeCount,
    eligibleRouteCount: routeCount,
    scheduledRouteCount,
    routeQueueLimit: MAX_BRIDGE_ROUTES,
    overflowRouteCount,
    unattemptedRouteCount: overflowRouteCount,
    routeQueueTruncated: overflowRouteCount > 0,
    routeQueueStatus: overflowRouteCount > 0 ? 'truncated' : 'complete',
    routeLimitReasonCode: overflowRouteCount > 0 ? 'browser-bridge-route-limit-exceeded' : null,
    capturedRouteCount,
    missingRouteCount,
    routeCoverageStatus: routeCount > 0 && missingRouteCount === 0
      ? 'complete'
      : capturedRouteCount > 0
      ? 'partial'
      : 'none',
    retryStatus: retryPasses <= 0
      ? 'not_attempted'
      : retryCapturedRouteCount > 0
      ? 'captured_after_retry'
      : retryAttemptedRouteCount > 0
      ? 'attempted_no_gain'
      : 'not_attempted',
    retryPasses,
    initialCapturedRouteCount: Math.max(0, Number(retrySummary.initialCapturedRouteCount ?? capturedRouteCount) || 0),
    retryAttemptedRouteCount,
    retryCapturedRouteCount,
    finalCapturedRouteCount: capturedRouteCount,
    finalMissingRouteCount: missingRouteCount,
    routeResults: routeResults.map(stripCollectorVersionFromRouteResult),
    extensionStageCount: sanitizedExtensionStages.length,
    extensionStageOmittedCount: 0,
    extensionStages: sanitizedExtensionStages,
    extensionStageTimelineLimit: MAX_EXTENSION_STAGE_TIMELINE,
    extensionStageTimelineCount: sanitizedExtensionStageTimeline.length,
    extensionStageTimelineOmittedCount: Math.max(0, sanitizedExtensionStageTimeline.length - persistedExtensionStageTimeline.length),
    extensionStageTimeline: persistedExtensionStageTimeline,
  };
}

function missingRouteSignals(routeResults) {
  const signals = [];
  for (const result of routeResults ?? []) {
    if (routeResultCaptured(result)) {
      continue;
    }
    if (result.status === 'challenge_detected') {
      signals.push('browser-bridge-route-challenge-detected');
    } else if (result.status === 'thin_capture') {
      signals.push('browser-bridge-low-structure-evidence');
    } else if (result.status === 'blocked') {
      signals.push('browser-bridge-route-blocked');
      if (result.reasonCode) {
        signals.push(result.reasonCode);
      }
      if (result.reasonCode === 'browser-bridge-route-url-mismatch') {
        signals.push('browser-bridge-extension-stale-or-incompatible');
      }
    } else {
      signals.push('browser-bridge-route-timeout');
    }
  }
  return uniqueStrings(signals);
}

function browserBridgeHasCapturedRoute(bridgeSummary) {
  return Number(bridgeSummary?.capturedRouteCount ?? 0) > 0;
}

function browserBridgeVerificationStatus({ challengeBlocked, bridgeSummary }) {
  if (!browserBridgeHasCapturedRoute(bridgeSummary)) {
    return challengeBlocked ? 'browser_blocked' : 'browser_bridge_missing';
  }
  return bridgeSummary?.routeCoverageStatus === 'partial' && Number(bridgeSummary?.missingRouteCount ?? 0) > 0
    ? 'browser_verified_partial'
    : 'browser_verified';
}

function emptyStructureSummary(routeResults = []) {
  return {
    authenticatedPages: [],
    authenticatedOverlayPages: [],
    routeResults,
    warnings: [],
  };
}

function routeResultsById(routeResults = []) {
  return new Map((Array.isArray(routeResults) ? routeResults : [])
    .filter((result) => result?.routeId)
    .map((result) => [result.routeId, result]));
}

function annotateRetryResults(finalSummary, {
  initialRouteResults = [],
  retryAttemptCounts = new Map(),
} = /** @type {any} */ ({})) {
  const initialById = routeResultsById(initialRouteResults);
  finalSummary.routeResults = (finalSummary.routeResults ?? []).map((result) => {
    const initial = initialById.get(result.routeId) ?? result;
    const retryAttemptCount = Math.max(0, Number(retryAttemptCounts.get(result.routeId) ?? 0) || 0);
    return {
      ...result,
      initialStatus: initial.status ?? result.status,
      initialReasonCode: initial.reasonCode ?? null,
      finalStatus: result.status,
      finalReasonCode: result.reasonCode ?? null,
      ...(retryAttemptCount > 0 ? {
        retryAttemptCount,
        retryOutcome: routeResultCaptured(result) ? 'captured_after_retry' : 'still_missing',
      } : {
        retryAttemptCount: 0,
        retryOutcome: routeResultCaptured(result) ? 'not_needed' : 'not_attempted',
      }),
    };
  });
  return finalSummary;
}

async function maybeRetryBrowserBridge(baseResult, {
  inputUrl,
  site,
  options,
  openBrowser,
  routes,
  targetUrl,
} = /** @type {any} */ ({})) {
  const maxRetryPasses = browserBridgeMaxRetryPasses(options);
  if (maxRetryPasses <= 0 || options.browserBridgeRetryPass === true) {
    return stripCollectorVersionsFromResult(baseResult);
  }
  if ((baseResult.blockingSignals ?? []).some((signal) => /extension-missing|stale-or-incompatible|sensitive-payload|cross-site|nonce|login-wall|host-mismatch/iu.test(signal))) {
    return stripCollectorVersionsFromResult(baseResult);
  }
  const initialSummary = baseResult.structureSummary ?? emptyStructureSummary(baseResult.bridgeSummary?.routeResults ?? []);
  const initialRouteResults = initialSummary.routeResults ?? [];
  const initialCapturedIds = new Set(initialRouteResults.filter(routeResultCaptured).map((result) => result.routeId));
  const aggregateSummary = {
    authenticatedPages: [...(initialSummary.authenticatedPages ?? [])],
    authenticatedOverlayPages: [...(initialSummary.authenticatedOverlayPages ?? [])],
    routeResults: [...initialRouteResults],
    warnings: [...(initialSummary.warnings ?? [])],
  };
  const extensionStages = new Set(baseResult.bridgeSummary?.extensionStages ?? []);
  const extensionStageTimeline = [...(baseResult.bridgeSummary?.extensionStageTimeline ?? [])];
  const retryAttemptCounts = new Map();
  let retryPasses = 0;

  for (let passIndex = 1; passIndex <= maxRetryPasses; passIndex += 1) {
    const current = finalizeStructureSummary(routes, aggregateSummary, site);
    const retryRouteIds = current.routeResults
      .filter((result) => !routeResultCaptured(result) && routeResultRetryable(result))
      .sort((left, right) => routeRetryPriority(left) - routeRetryPriority(right))
      .map((result) => result.routeId)
      .filter(Boolean);
    if (!retryRouteIds.length) {
      break;
    }
    retryPasses = passIndex;
    for (const routeId of retryRouteIds) {
      retryAttemptCounts.set(routeId, (retryAttemptCounts.get(routeId) ?? 0) + 1);
    }
    const retryResult = await runBrowserAuthBridge({
      inputUrl,
      site,
      options: {
        ...options,
        browserBridgeRouteIds: retryRouteIds,
        browserBridgeRetryRouteIds: retryRouteIds,
        browserBridgeMaxRetryPasses: 0,
        browserBridgePerPassTimeoutMs: browserBridgeRetryPassTimeoutMs(options, retryRouteIds.length),
        browserBridgePassIndex: passIndex,
        browserBridgeRetryPass: true,
      },
      openBrowser,
    });
    for (const stage of retryResult.bridgeSummary?.extensionStages ?? []) {
      extensionStages.add(stage);
    }
    const currentTimelineLength = extensionStageTimeline.length;
    for (const [index, entry] of (retryResult.bridgeSummary?.extensionStageTimeline ?? []).entries()) {
      const eventIndex = currentTimelineLength + index;
      extensionStageTimeline.push({
        index: eventIndex,
        eventIndex,
        passIndex,
        stage: entry?.stage,
      });
    }
    const retrySummary = retryResult.structureSummary
      ?? emptyStructureSummary(retryResult.bridgeSummary?.routeResults ?? []);
    mergeStructureSummary(aggregateSummary, retrySummary);
  }

  const finalSummary = annotateRetryResults(
    finalizeStructureSummary(routes, aggregateSummary, site),
    { initialRouteResults, retryAttemptCounts },
  );
  const finalCapturedIds = new Set(finalSummary.routeResults.filter(routeResultCaptured).map((result) => result.routeId));
  const retryCapturedRouteCount = [...finalCapturedIds].filter((routeId) => !initialCapturedIds.has(routeId)).length;
  const retryAttemptedRouteCount = retryAttemptCounts.size;
  const bridgeSummary = bridgeSummaryFromRoutes(finalSummary, {
    routes,
    extensionStages: [...extensionStages].sort(),
    extensionStageTimeline,
    retrySummary: {
      retryPasses,
      initialCapturedRouteCount: initialCapturedIds.size,
      retryAttemptedRouteCount,
      retryCapturedRouteCount,
    },
  });
  const pageCount = finalSummary.authenticatedPages.length;
  const overlayPageCount = finalSummary.authenticatedOverlayPages.length;
  const hasStructure = Boolean(pageCount || overlayPageCount);
  const missingSignals = missingRouteSignals(finalSummary.routeResults);
  const challengeBlocked = missingSignals.includes('browser-bridge-route-challenge-detected');
  const hasCapturedRoute = browserBridgeHasCapturedRoute(bridgeSummary);
  return {
    ...baseResult,
    status: browserBridgeVerificationStatus({ challengeBlocked, bridgeSummary }),
    verified: hasCapturedRoute,
    finalUrl: targetUrl,
    positiveSignals: hasCapturedRoute
      ? uniqueStrings([...(baseResult.positiveSignals ?? []), 'browser_bridge_retry_completed', 'browser_structure_summary_present'])
      : uniqueStrings(baseResult.positiveSignals ?? []),
    blockingSignals: hasCapturedRoute ? missingSignals : uniqueStrings([
      'browser-bridge-no-captured-route',
      ...(hasStructure ? [] : ['browser-bridge-empty-summary']),
      ...missingSignals,
    ]),
    verifiedRoutes: hasCapturedRoute
      ? uniqueStrings([...finalSummary.authenticatedPages, ...finalSummary.authenticatedOverlayPages].map((page) => page.routeTemplate).filter(Boolean))
      : [],
    structureSummary: hasCapturedRoute ? stripCollectorVersionsFromSummary(finalSummary) : null,
    bridgeSummary,
  };
}

function bridgeSession({
  nonce,
  targetUrl,
  submitUrl,
  collectorUrl,
  extensionStatusUrl,
  sourceLayer = 'authenticated',
  routes = [],
  apiReplay = null,
}) {
  const parsedTarget = new URL(targetUrl);
  const sessionRoutes = routes.length ? routes : [{
    id: 'route-1',
    targetUrl,
    sourceLayer,
    allowedHost: parsedTarget.hostname,
    allowedOrigin: parsedTarget.origin,
    routeTemplate: routeTemplateFromUrl(targetUrl),
  }];
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
    routes: sessionRoutes,
    ...(apiReplay ? { apiReplay } : {}),
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

function bridgePageHtml({ nonce, targetUrl, submitUrl, collectorUrl, sessionUrl, extensionDir, routeCount = 1 }) {
  const safeTargetUrl = escapeHtml(sanitizeEvidenceRef(targetUrl) ?? targetUrl);
  const safeSubmitUrl = escapeHtml(submitUrl);
  const safeCollectorUrl = escapeHtml(collectorUrl);
  const safeSessionUrl = escapeHtml(sessionUrl);
  const safeExtensionDir = escapeHtml(extensionDir);
  const safeNonce = escapeHtml(nonce);
  const safeRouteCount = escapeHtml(routeCount);
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
<p>Configured same-site routes in this session: ${safeRouteCount}</p>
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

function browserBridgeServerPort(server) {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Browser bridge server did not bind to a TCP port.');
  }
  return address.port;
}

function replayHeaderValue(headers, name) {
  if (!headers || typeof headers !== 'object') {
    return null;
  }
  const wanted = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === wanted) {
      return String(Array.isArray(value) ? value.join(', ') : value ?? '').trim();
    }
  }
  return null;
}

function sanitizeBrowserBridgeApiReplayResult(payload = /** @type {any} */ ({})) {
  const httpStatus = Number(payload.httpStatus ?? payload.statusCode ?? payload.status ?? payload.response?.status ?? 0) || null;
  const headers = payload.headers ?? payload.response?.headers ?? {};
  const contentType = String(payload.contentType ?? replayHeaderValue(headers, 'content-type') ?? '').trim() || null;
  const probeText = [
    payload.statusText,
    payload.reason,
    payload.reasonCode,
    payload.responseKind,
    payload.bodyText,
    payload.text,
    typeof payload.body === 'string' ? payload.body.slice(0, 600) : '',
  ].filter(Boolean).join(' ');
  const challengeLike = API_REPLAY_CHALLENGE_PATTERN.test(probeText)
    || [401, 403, 407, 419, 429].includes(Number(httpStatus));
  const httpOk = httpStatus === null || (httpStatus >= 200 && httpStatus < 300) || httpStatus === 304;
  const statusText = String(payload.status ?? payload.result ?? '').trim().toLowerCase();
  const verified = !challengeLike && httpOk && ['verified', 'success', 'passed', ''].includes(statusText);
  const result = {
    status: verified ? 'verified' : (statusText === 'skipped' ? 'skipped' : 'failed'),
    reasonCode: challengeLike ? 'challenge_or_login_wall_response' : (verified ? null : (payload.reasonCode ?? 'api_replay_http_failed')),
    httpStatus,
    contentType,
    responseKind: String(payload.responseKind ?? payload.kind ?? '').trim() || (contentType?.includes('json') ? 'json' : null),
    responsePolicy: {
      responseMaterial: SANITIZED_SUMMARY_ONLY,
      bodyPersisted: false,
      cookieMaterialPersisted: false,
      storageMaterialPersisted: false,
      profileMaterialPersisted: false,
    },
  };
  assertNoForbiddenPatterns(result);
  return result;
}

function apiReplayPageUrl(endpoint) {
  const parsed = new URL(endpoint);
  return `${parsed.origin}/`;
}

async function runBrowserBridgeApiReplayWithExtension({
  inputUrl,
  site,
  endpoint,
  method,
  options = /** @type {any} */ ({}),
  openBrowser,
} = /** @type {any} */ ({})) {
  if (typeof openBrowser !== 'function') {
    return {
      status: 'skipped',
      reasonCode: 'browser_bridge_replay_unavailable',
      httpStatus: null,
      contentType: null,
      responseKind: null,
    };
  }
  const replayEndpoint = normalizeUrl(endpoint, site?.rootUrl ?? inputUrl);
  const parsedEndpoint = new URL(replayEndpoint);
  const nonce = randomBytes(16).toString('hex');
  const extensionStages = new Set();
  let resolveSubmission;
  let rejectSubmission;
  const submission = new Promise((resolve, reject) => {
    resolveSubmission = resolve;
    rejectSubmission = reject;
  });
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, bridgeHeaders());
        response.end();
        return;
      }
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (requestUrl.searchParams.get('nonce') !== nonce) {
        response.writeHead(403, bridgeHeaders({ 'content-type': 'application/json; charset=utf-8' }));
        response.end(JSON.stringify({ ok: false }));
        return;
      }
      if (request.method === 'GET' && requestUrl.pathname === '/session.json') {
        const submitUrl = `http://127.0.0.1:${browserBridgeServerPort(server)}/api-replay-submit?nonce=${nonce}`;
        const extensionStatusUrl = `http://127.0.0.1:${browserBridgeServerPort(server)}/extension-status?nonce=${nonce}`;
        response.writeHead(200, bridgeHeaders({ 'content-type': 'application/json; charset=utf-8' }));
        response.end(JSON.stringify(bridgeSession({
          nonce,
          targetUrl: apiReplayPageUrl(replayEndpoint),
          submitUrl,
          collectorUrl: submitUrl,
          extensionStatusUrl,
          routes: [],
          apiReplay: {
            id: 'api-replay-1',
            endpoint: replayEndpoint,
            method,
            pageUrl: apiReplayPageUrl(replayEndpoint),
            allowedHost: parsedEndpoint.hostname,
            allowedOrigin: parsedEndpoint.origin,
          },
        })));
        return;
      }
      if (request.method === 'GET') {
        const serverPort = browserBridgeServerPort(server);
        const submitUrl = `http://127.0.0.1:${serverPort}/api-replay-submit?nonce=${nonce}`;
        const sessionUrl = `http://127.0.0.1:${serverPort}/session.json?nonce=${nonce}`;
        response.writeHead(200, bridgeHeaders({ 'content-type': 'text/html; charset=utf-8' }));
        response.end(bridgePageHtml({
          nonce,
          targetUrl: apiReplayPageUrl(replayEndpoint),
          submitUrl,
          collectorUrl: submitUrl,
          sessionUrl,
          extensionDir: browserBridgeExtensionDirectory(),
          routeCount: 1,
        }));
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/extension-status') {
        const stage = sanitizeBridgeExtensionStage(requestUrl.searchParams.get('stage'));
        if (stage) {
          extensionStages.add(stage);
        }
        response.writeHead(200, bridgeHeaders({ 'content-type': 'application/json; charset=utf-8' }));
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/api-replay-submit') {
        const body = await readRequestBody(request);
        const payload = JSON.parse(body || '{}');
        if (payload?.nonce !== nonce) {
          response.writeHead(403, bridgeHeaders({ 'content-type': 'application/json; charset=utf-8' }));
          response.end(JSON.stringify({ ok: false }));
          return;
        }
        response.writeHead(200, bridgeHeaders({ 'content-type': 'application/json; charset=utf-8' }));
        response.end(JSON.stringify({ ok: true }));
        resolveSubmission?.(payload.apiReplay ?? payload);
        return;
      }
      response.writeHead(404, bridgeHeaders({ 'content-type': 'application/json; charset=utf-8' }));
      response.end(JSON.stringify({ ok: false }));
    } catch (error) {
      response.writeHead(400, bridgeHeaders({ 'content-type': 'application/json; charset=utf-8' }));
      response.end(JSON.stringify({ ok: false }));
      rejectSubmission?.(error);
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port: 0, host: '127.0.0.1' }, () => resolve(undefined));
  });

  try {
    const bridgeUrl = `http://127.0.0.1:${browserBridgeServerPort(server)}/?nonce=${nonce}`;
    await openBrowser(bridgeUrl);
    const timeoutMs = browserBridgeApiReplayTimeoutMs(options);
    const replayResult = await Promise.race([
      submission,
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!replayResult) {
      return {
        status: 'skipped',
        reasonCode: extensionStages.size ? 'browser_bridge_replay_timeout' : 'browser_bridge_replay_unavailable',
        httpStatus: null,
        contentType: null,
        responseKind: null,
      };
    }
    return sanitizeBrowserBridgeApiReplayResult(replayResult);
  } catch (error) {
    return {
      status: 'failed',
      reasonCode: error?.reasonCode ?? error?.message ?? 'api_replay_failed',
      httpStatus: null,
      contentType: null,
      responseKind: null,
    };
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
}

export async function runBrowserBridgeApiReplay({
  inputUrl,
  site,
  endpoint,
  method = 'GET',
  options = /** @type {any} */ ({}),
  robotsPolicy = null,
  openBrowser = null,
} = /** @type {any} */ ({})) {
  const normalizedMethod = String(method ?? 'GET').trim().toUpperCase();
  if (!API_REPLAY_SAFE_METHODS.has(normalizedMethod)) {
    return {
      status: 'skipped',
      reasonCode: 'method_not_read_only',
      httpStatus: null,
      contentType: null,
      responseKind: null,
    };
  }
  let replayEndpoint;
  try {
    replayEndpoint = normalizeUrl(endpoint, site?.rootUrl ?? inputUrl);
  } catch {
    return {
      status: 'skipped',
      reasonCode: 'endpoint_not_runtime_resolvable',
      httpStatus: null,
      contentType: null,
      responseKind: null,
    };
  }
  if (!isSameSiteUrl(replayEndpoint, site?.allowedDomains ?? [])) {
    return {
      status: 'skipped',
      reasonCode: 'cross_site_endpoint',
      httpStatus: null,
      contentType: null,
      responseKind: null,
    };
  }
  if (robotsPolicy && !isUrlAllowedByRobots(replayEndpoint, robotsPolicy)) {
    return {
      status: 'skipped',
      reasonCode: 'robots_disallowed',
      httpStatus: null,
      contentType: null,
      responseKind: null,
    };
  }
  if (typeof options.browserBridgeApiReplayProvider !== 'function') {
    return await runBrowserBridgeApiReplayWithExtension({
      inputUrl,
      site,
      endpoint: replayEndpoint,
      method: normalizedMethod,
      options,
      openBrowser,
    });
  }
  try {
    const provided = await options.browserBridgeApiReplayProvider({
      inputUrl,
      site,
      endpoint: replayEndpoint,
      method: normalizedMethod,
      authBoundary: 'browser_bridge',
      runtimeBoundary: 'browser_bridge_page_context_fetch',
      fetchOptions: {
        credentials: 'include',
        method: normalizedMethod,
        body: null,
        persistCookies: false,
        persistStorage: false,
        persistResponseBody: false,
        responseMaterial: SANITIZED_SUMMARY_ONLY,
      },
    });
    return sanitizeBrowserBridgeApiReplayResult(provided ?? {});
  } catch (error) {
    return {
      status: 'failed',
      reasonCode: error?.reasonCode ?? error?.message ?? 'api_replay_failed',
      httpStatus: null,
      contentType: null,
      responseKind: null,
    };
  }
}

export async function runBrowserAuthBridge({
  inputUrl,
  site,
  options = /** @type {any} */ ({}),
  openBrowser,
  robotsPolicy = null,
} = /** @type {any} */ ({})) {
  const effectiveOptions = robotsPolicy && !options.browserBridgeRobotsPolicy
    ? { ...options, browserBridgeRobotsPolicy: robotsPolicy }
    : options;
  const requestedTargetUrl = normalizeUrl(options.authCheckUrl ?? inputUrl ?? site?.rootUrl, site.rootUrl);
  if (!isInternalUrl(requestedTargetUrl, site.allowedDomains)) {
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
  const routeQueue = routeQueueFromConfiguredRoutes({
    site,
    inputUrl,
    targetUrl: requestedTargetUrl,
    options: effectiveOptions,
  });
  const routes = filterRoutesForRetry(routeQueue.routes, effectiveOptions);
  const blockedRoutes = routeQueue.blockedRoutes ?? [];
  const coverageRoutes = [...routes, ...blockedRoutes];
  const blockedRouteResults = blockedRoutes.map((route) => sanitizeRouteResult({
    routeId: route.id,
    sourceLayer: route.sourceLayer,
    targetUrl: route.targetUrl,
    status: 'blocked',
    reasonCode: route.reasonCode ?? 'robots-disallowed',
    finalStatus: 'blocked',
    finalReasonCode: route.reasonCode ?? 'robots-disallowed',
  }, site)).filter(Boolean);
  if (!routes.length && blockedRoutes.length) {
    const blockedSummary = finalizeStructureSummary(blockedRoutes, emptyStructureSummary(blockedRouteResults), site);
    return {
      status: 'browser_blocked',
      verified: false,
      finalUrl: null,
      positiveSignals: [],
      blockingSignals: ['robots-disallowed', 'browser-bridge-robots-disallowed', 'browser-bridge-all-routes-robots-disallowed'],
      verifiedRoutes: [],
      structureSummary: null,
      bridgeSummary: bridgeSummaryFromRoutes(blockedSummary, { routes: blockedRoutes, used: false }),
    };
  }
  const targetUrl = routes[0]?.targetUrl ?? requestedTargetUrl;

  const nonce = randomBytes(16).toString('hex');
  if (typeof effectiveOptions.browserAuthBridgeProvider === 'function') {
    try {
      const provided = await effectiveOptions.browserAuthBridgeProvider({
        inputUrl,
        site,
        targetUrl,
        routes,
        nonce,
        options: effectiveOptions,
        passIndex: Math.max(0, Number(effectiveOptions.browserBridgePassIndex ?? 0) || 0),
        retryPass: effectiveOptions.browserBridgeRetryPass === true,
      });
      const aggregateSummary = mergeStructureSummary(
        emptyStructureSummary(blockedRouteResults),
        sanitizeBrowserAuthBridgePayload(provided ?? {}, { site, fallbackUrl: targetUrl }),
      );
      const structureSummary = finalizeStructureSummary(coverageRoutes, aggregateSummary, site);
      const pageCount = structureSummary.authenticatedPages.length;
      const overlayPageCount = structureSummary.authenticatedOverlayPages.length;
      const bridgeSummary = bridgeSummaryFromRoutes(structureSummary, { routes: coverageRoutes });
      const missingSignals = missingRouteSignals(structureSummary.routeResults);
      const challengeBlocked = missingSignals.includes('browser-bridge-route-challenge-detected');
      const hasStructure = Boolean(pageCount || overlayPageCount);
      const hasCapturedRoute = browserBridgeHasCapturedRoute(bridgeSummary);
      return await maybeRetryBrowserBridge({
        status: browserBridgeVerificationStatus({ challengeBlocked, bridgeSummary }),
        verified: hasCapturedRoute,
        finalUrl: targetUrl,
        positiveSignals: hasCapturedRoute ? ['browser_bridge_payload_received', 'browser_structure_summary_present'] : [],
        blockingSignals: hasCapturedRoute ? missingSignals : uniqueStrings([
          'browser-bridge-no-captured-route',
          ...(hasStructure ? [] : ['browser-bridge-empty-summary']),
          ...missingSignals,
        ]),
        verifiedRoutes: hasCapturedRoute
          ? uniqueStrings([...structureSummary.authenticatedPages, ...structureSummary.authenticatedOverlayPages].map((page) => page.routeTemplate).filter(Boolean))
          : [],
        structureSummary: hasCapturedRoute ? structureSummary : null,
        bridgeSummary,
      }, { inputUrl, site, options: effectiveOptions, openBrowser, routes: coverageRoutes, targetUrl });
    } catch (error) {
      return {
        status: error?.code === 'redaction-failed' ? 'browser_blocked' : 'browser_check_failed',
        verified: false,
        finalUrl: targetUrl,
        positiveSignals: [],
        blockingSignals: [error?.code === 'redaction-failed' ? 'browser-bridge-sensitive-payload' : 'browser-bridge-request-failed'],
        verifiedRoutes: [],
        structureSummary: null,
        bridgeSummary: bridgeSummaryFromRoutes({ authenticatedPages: [], authenticatedOverlayPages: [], routeResults: blockedRouteResults, warnings: [] }, { routes: coverageRoutes }),
      };
    }
  }

  const timeoutMs = browserBridgePerPassTimeoutMs(effectiveOptions);
  const extensionStages = new Set();
  const extensionStageTimeline = [];
  const passIndex = Math.max(0, Number(effectiveOptions.browserBridgePassIndex ?? 0) || 0);
  const recordExtensionStage = (stageValue) => {
    const stage = sanitizeBridgeExtensionStage(stageValue);
    if (!stage) {
      return null;
    }
    extensionStages.add(stage);
    const eventIndex = extensionStageTimeline.length;
    extensionStageTimeline.push({
      index: eventIndex,
      eventIndex,
      passIndex,
      stage,
    });
    return stage;
  };
  const aggregateSummary = {
    authenticatedPages: [],
    authenticatedOverlayPages: [],
    routeResults: [...blockedRouteResults],
    warnings: [],
  };
  let resolveSubmission = /** @type {null | ((value: any) => void)} */ (null);
  let rejectSubmission = /** @type {null | ((error: Error) => void)} */ (null);
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
        const serverPort = browserBridgeServerPort(server);
        const submitUrl = `http://127.0.0.1:${serverPort}/submit?nonce=${nonce}`;
        const collectorUrl = `http://127.0.0.1:${serverPort}/collector.js?nonce=${nonce}&sourceLayer=${sourceLayer}`;
        const sessionUrl = `http://127.0.0.1:${serverPort}/session.json?nonce=${nonce}`;
        const extensionStatusUrl = `http://127.0.0.1:${serverPort}/extension-status?nonce=${nonce}`;
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
          response.end(JSON.stringify(bridgeSession({ nonce, targetUrl, submitUrl, collectorUrl, extensionStatusUrl, sourceLayer, routes })));
          return;
        }
        if (requestUrl.pathname === '/extension-status') {
          if (requestUrl.searchParams.get('nonce') !== nonce) {
            response.writeHead(403, bridgeHeaders({ 'content-type': 'application/json; charset=utf-8' }));
            response.end(JSON.stringify({ ok: false }));
            return;
          }
          recordExtensionStage(requestUrl.searchParams.get('stage')) ?? recordExtensionStage('extension-active');
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
          routeCount: routes.length,
        }));
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/extension-status') {
        if (requestUrl.searchParams.get('nonce') !== nonce) {
          response.writeHead(403, bridgeHeaders({ 'content-type': 'application/json; charset=utf-8' }));
          response.end(JSON.stringify({ ok: false }));
          return;
        }
        recordExtensionStage(requestUrl.searchParams.get('stage')) ?? recordExtensionStage('extension-active');
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
        mergeStructureSummary(aggregateSummary, structureSummary);
        const finalized = finalizeStructureSummary(coverageRoutes, aggregateSummary, site);
        response.writeHead(200, bridgeHeaders({ 'content-type': 'application/json; charset=utf-8' }));
        response.end(JSON.stringify({ ok: true }));
        const allRoutesSettled = finalized.routeResults.length >= coverageRoutes.length
          && finalized.routeResults.every((result) => result.status !== 'timeout');
        if (allRoutesSettled) {
          resolveSubmission?.(finalized);
        }
        return;
      }
      response.writeHead(404, bridgeHeaders({ 'content-type': 'application/json; charset=utf-8' }));
      response.end(JSON.stringify({ ok: false }));
    } catch (error) {
      response.writeHead(400, bridgeHeaders({ 'content-type': 'application/json; charset=utf-8' }));
      response.end(JSON.stringify({ ok: false }));
      rejectSubmission?.(error);
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port: 0, host: '127.0.0.1' }, () => resolve(undefined));
  });

  const bridgeUrl = `http://127.0.0.1:${browserBridgeServerPort(server)}/?nonce=${nonce}`;
  try {
    if (typeof openBrowser === 'function') {
      await openBrowser(bridgeUrl);
    }
    const structureSummary = await Promise.race([
      submission,
      new Promise((resolve) => setTimeout(() => {
        const finalized = finalizeStructureSummary(coverageRoutes, aggregateSummary, site);
        const hasAnyPage = finalized.authenticatedPages.length || finalized.authenticatedOverlayPages.length;
        const hasAnyRouteStatus = (finalized.routeResults ?? []).some((result) => result?.status && result.status !== 'timeout');
        resolve(hasAnyPage || hasAnyRouteStatus ? finalized : null);
      }, timeoutMs)),
    ]);
    if (!structureSummary) {
        const extensionStageList = [...extensionStages].sort();
        const extensionActive = extensionStageList.length > 0;
        const emptyRouteResults = routeResultsFromSummary(
          coverageRoutes,
          { authenticatedPages: [], authenticatedOverlayPages: [], routeResults: [], warnings: [] },
          site,
        );
        const versionBlockingSignals = bridgeExtensionVersionBlockingSignals(extensionStageList, emptyRouteResults);
        const staleExtension = extensionStageList.includes('target-tab-created')
          && !extensionStageList.some((stage) => stage === 'target-route-queue-started' || stage.startsWith('route-opened:'));
        return await maybeRetryBrowserBridge({
          status: 'browser_bridge_missing',
          verified: false,
          finalUrl: targetUrl,
          positiveSignals: ['default_browser_opened'],
          blockingSignals: extensionActive
            ? uniqueStrings([
              'browser-bridge-timeout',
              ...(versionBlockingSignals.length ? versionBlockingSignals : [staleExtension ? 'browser-bridge-extension-stale-or-incompatible' : 'browser-bridge-extension-active-no-summary']),
            ])
            : ['browser-bridge-timeout', 'browser-bridge-extension-missing-or-inactive'],
          verifiedRoutes: [],
          structureSummary: null,
          bridgeSummary: bridgeSummaryFromRoutes({
            authenticatedPages: [],
            authenticatedOverlayPages: [],
            routeResults: emptyRouteResults,
            warnings: [],
          }, { routes: coverageRoutes, extensionStages: extensionStageList, extensionStageTimeline }),
        }, { inputUrl, site, options: effectiveOptions, openBrowser, routes: coverageRoutes, targetUrl });
    }
    const pageCount = structureSummary.authenticatedPages.length;
    const overlayPageCount = structureSummary.authenticatedOverlayPages.length;
    const extensionStageList = [...extensionStages].sort();
    const bridgeSummary = bridgeSummaryFromRoutes(structureSummary, { routes: coverageRoutes, extensionStages: extensionStageList, extensionStageTimeline });
    const versionBlockingSignals = bridgeExtensionVersionBlockingSignals(extensionStageList, structureSummary.routeResults);
    if (versionBlockingSignals.length) {
      return await maybeRetryBrowserBridge({
        status: 'browser_bridge_missing',
        verified: false,
        finalUrl: targetUrl,
        positiveSignals: ['default_browser_opened', 'browser_bridge_payload_received'],
        blockingSignals: versionBlockingSignals,
        verifiedRoutes: [],
        structureSummary: null,
        bridgeSummary,
      }, { inputUrl, site, options: effectiveOptions, openBrowser, routes: coverageRoutes, targetUrl });
    }
    const missingSignals = missingRouteSignals(structureSummary.routeResults);
    const challengeBlocked = missingSignals.includes('browser-bridge-route-challenge-detected');
    const hasStructure = Boolean(pageCount || overlayPageCount);
    const hasCapturedRoute = browserBridgeHasCapturedRoute(bridgeSummary);
    return await maybeRetryBrowserBridge({
      status: browserBridgeVerificationStatus({ challengeBlocked, bridgeSummary }),
      verified: hasCapturedRoute,
      finalUrl: targetUrl,
      positiveSignals: hasCapturedRoute
        ? ['default_browser_opened', 'browser_bridge_payload_received', 'browser_structure_summary_present']
        : ['default_browser_opened', 'browser_bridge_payload_received'],
      blockingSignals: hasCapturedRoute ? missingSignals : uniqueStrings([
        'browser-bridge-no-captured-route',
        ...(hasStructure ? [] : ['browser-bridge-empty-summary']),
        ...missingSignals,
      ]),
      verifiedRoutes: hasCapturedRoute
        ? uniqueStrings([...structureSummary.authenticatedPages, ...structureSummary.authenticatedOverlayPages].map((page) => page.routeTemplate).filter(Boolean))
        : [],
      structureSummary: hasCapturedRoute ? structureSummary : null,
      bridgeSummary,
    }, { inputUrl, site, options: effectiveOptions, openBrowser, routes: coverageRoutes, targetUrl });
  } catch (error) {
    return {
      status: error?.code === 'redaction-failed' ? 'browser_blocked' : 'browser_check_failed',
      verified: false,
      finalUrl: targetUrl,
      positiveSignals: [],
      blockingSignals: [error?.code === 'redaction-failed' ? 'browser-bridge-sensitive-payload' : 'browser-bridge-request-failed'],
      verifiedRoutes: [],
      structureSummary: null,
      bridgeSummary: bridgeSummaryFromRoutes({ authenticatedPages: [], authenticatedOverlayPages: [], routeResults: blockedRouteResults, warnings: [] }, { routes: coverageRoutes, extensionStages: [...extensionStages].sort(), extensionStageTimeline }),
    };
  } finally {
    server.closeAllConnections?.();
    server.closeIdleConnections?.();
    await new Promise((resolve) => server.close(() => resolve()));
  }
}
