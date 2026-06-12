// @ts-check

import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { assertNoForbiddenPatterns } from '../../../domain/sessions/security-guard.mjs';
import { BUILD_SCHEMA_VERSION, isInternalUrl, normalizeUrl } from './models.mjs';
import { sanitizeEvidenceRef } from './risk-policy.mjs';
import { runBrowserAuthBridge } from './browser-auth-bridge.mjs';
import { isUrlAllowedByRobots } from './html.mjs';

export const AUTH_STATE_REPORT_FILE = 'auth_state_report.json';
export const CRAWL_AUTHENTICATED_FILE = 'crawl_authenticated.json';
export const AUTH_STATE_ARTIFACT_FAMILY = 'siteforge-auth-state-report';

const AUTH_RUNTIME_MATERIAL_SYMBOL = Symbol('siteforge.authRuntimeMaterial');
const MAX_EXTENSION_STAGE_TIMELINE = 384;

function cloneRuntimeMaterial(material = null) {
  if (!material || typeof material !== 'object') {
    return null;
  }
  return {
    authRuntime: material.authRuntime && typeof material.authRuntime === 'object'
      ? { ...material.authRuntime }
      : null,
    authenticatedStructureSummary: material.authenticatedStructureSummary ?? null,
  };
}

export function attachAuthRuntimeMaterial(target, material = null) {
  if (!target || typeof target !== 'object') {
    return target;
  }
  const cloned = cloneRuntimeMaterial(material);
  if (!cloned?.authRuntime && !cloned?.authenticatedStructureSummary) {
    return target;
  }
  Object.defineProperty(target, AUTH_RUNTIME_MATERIAL_SYMBOL, {
    value: cloned,
    enumerable: false,
    configurable: true,
    writable: false,
  });
  return target;
}

export function authRuntimeMaterialFrom(target) {
  return cloneRuntimeMaterial(target?.[AUTH_RUNTIME_MATERIAL_SYMBOL] ?? null);
}

export const AUTH_METHODS = Object.freeze(['none', 'cookie', 'browser', 'authorized_source']);

export const AUTH_VERIFICATION_STATUSES = Object.freeze([
  'not_requested',
  'cookie_missing',
  'cookie_invalid',
  'cookie_verified',
  'cookie_blocked',
  'auth_check_failed',
  'browser_bridge_missing',
  'browser_user_cancelled',
  'browser_verified',
  'browser_verified_partial',
  'browser_blocked',
  'browser_check_failed',
  'authorized_source_verified',
]);

export const CAPABILITY_EVIDENCE_LEVEL_RANK = Object.freeze({
  blocked: -1,
  candidate: 0,
  missing_auth_evidence: 0,
  public_verified: 1,
  public_rendered_verified: 2,
  authorized_source_verified: 2,
  login_user_confirmed: 2,
  browser_structure_verified: 3,
  login_route_verified: 3,
  login_page_verified: 4,
  capability_verified: 5,
});

export function normalizeAuthMethod(value, fallback = 'none') {
  const method = String(value ?? '').trim();
  return AUTH_METHODS.includes(method) ? method : fallback;
}

export function normalizeAuthVerificationStatus(value, fallback = 'not_requested') {
  const status = String(value ?? '').trim();
  return AUTH_VERIFICATION_STATUSES.includes(status) ? status : fallback;
}

export function evidenceLevelRank(value) {
  return CAPABILITY_EVIDENCE_LEVEL_RANK[String(value ?? '').trim()] ?? 0;
}

function browserBridgeRouteResultCaptured(result = /** @type {any} */ ({})) {
  const status = String(result?.status ?? '').trim();
  return ['captured', 'captured_with_warning'].includes(status) && result?.captured !== false;
}

function browserBridgeHasCapturedRouteResult(browserBridge = /** @type {any} */ ({})) {
  return Array.isArray(browserBridge.routeResults)
    && browserBridge.routeResults.some((result) => browserBridgeRouteResultCaptured(result));
}

export function canRunAuthenticatedLayer(authStateReport = null) {
  if (authStateReport?.authMethod === 'cookie') {
    return authStateReport?.authVerificationStatus === 'cookie_verified'
      && authStateReport?.verified === true;
  }
  if (authStateReport?.authMethod === 'browser') {
    const status = String(authStateReport?.authVerificationStatus ?? '');
    if (status === 'browser_verified') {
      return authStateReport?.verified === true;
    }
    return status === 'browser_verified_partial'
      && authStateReport?.verified === true
      && browserBridgeHasCapturedRouteResult(authStateReport?.browserBridge);
  }
  if (authStateReport?.authMethod === 'authorized_source') {
    return authStateReport?.authVerificationStatus === 'authorized_source_verified'
      && authStateReport?.verified === true;
  }
  return false;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'en'));
}

export function sanitizeRouteTargetForPersistence(value, site = null, {
  preserveRelative = true,
} = /** @type {any} */ ({})) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  if (preserveRelative && raw.startsWith('/') && !raw.startsWith('//')) {
    try {
      return new URL(raw, site?.rootUrl ?? 'https://siteforge.local').pathname || '/';
    } catch {
      return null;
    }
  }
  if (site?.rootUrl) {
    try {
      const parsed = new URL(normalizeUrl(raw, site.rootUrl));
      parsed.username = '';
      parsed.password = '';
      parsed.search = '';
      parsed.hash = '';
      const normalized = parsed.toString();
      const allowedDomains = Array.isArray(site.allowedDomains) && site.allowedDomains.length
        ? site.allowedDomains
        : [new URL(site.rootUrl).hostname];
      return isInternalUrl(normalized, allowedDomains) ? normalized : null;
    } catch {
      return null;
    }
  }
  try {
    const parsed = new URL(raw);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    // Fall through to evidence ref sanitization for non-route diagnostic values.
  }
  return sanitizeEvidenceRef(raw);
}

function sanitizedRouteTargetsForPersistence(values, site = null) {
  return uniqueStrings((Array.isArray(values) ? values : [])
    .map((value) => sanitizeRouteTargetForPersistence(value, site))
    .filter(Boolean));
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

function safeBridgeExtensionStage(raw) {
  return BRIDGE_EXTENSION_STAGE_PATTERNS.some((pattern) => pattern.test(raw));
}

function sanitizeBridgeDiagnosticStage(value) {
  const raw = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (!raw || raw.length > 160) {
    return null;
  }
  if (!safeBridgeExtensionStage(raw) || bridgeDiagnosticLooksSensitive(raw)) {
    return null;
  }
  try {
    assertNoForbiddenPatterns(raw);
  } catch {
    return null;
  }
  return raw.slice(0, 160);
}

function sanitizeBridgeDiagnosticToken(value, fallback = null) {
  const raw = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (!raw) {
    return fallback;
  }
  if (bridgeDiagnosticLooksSensitive(raw)) {
    return fallback;
  }
  if (!/^[a-z0-9:_./_-]+$/iu.test(raw)) {
    return fallback;
  }
  try {
    assertNoForbiddenPatterns(raw);
  } catch {
    return fallback;
  }
  return raw.slice(0, 80);
}

function spawnDetached(command, args = /** @type {string[]} */ ([])) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve({ command, args });
    });
  });
}

export async function openSystemDefaultBrowser(urlValue, options = /** @type {any} */ ({})) {
  const targetUrl = String(urlValue ?? '').trim();
  if (!targetUrl) {
    throw new Error('Default browser URL is required');
  }
  if (typeof options.defaultBrowserLauncher === 'function') {
    return await options.defaultBrowserLauncher(targetUrl);
  }
  if (typeof options.externalBrowserLauncher === 'function') {
    return await options.externalBrowserLauncher(targetUrl);
  }
  if (process.platform === 'win32') {
    return await spawnDetached('rundll32.exe', ['url.dll,FileProtocolHandler', targetUrl]);
  }
  if (process.platform === 'darwin') {
    return await spawnDetached('open', [targetUrl]);
  }
  return await spawnDetached('xdg-open', [targetUrl]);
}

function isLoginLikeUrl(urlValue) {
  try {
    const parsed = new URL(urlValue);
    return /\/(?:login|signin|sign-in|auth|oauth|checkpoint|challenge|mfa|2fa)(?:\/|$)/iu.test(parsed.pathname);
  } catch {
    return false;
  }
}

function authDependencySignalsFromBody(text) {
  const body = String(text ?? '').slice(0, 200000);
  if (!body) {
    return { positiveSignals: [], blockingSignals: [] };
  }
  const positiveSignals = [];
  const blockingSignals = [];
  if (/\b(?:csrf|xsrf|authenticity_token|x-csrf-token)\b/iu.test(body)) {
    positiveSignals.push('csrf-token-signal-redacted');
  }
  if (/\b(?:fetch\s*\(|XMLHttpRequest|graphql|\/api\/|data-api)\b/iu.test(body)) {
    positiveSignals.push('dynamic-api-signal-redacted');
  }
  if (/\b(?:fingerprintjs|device fingerprint|device_id|fp_token|device-fingerprint)\b/iu.test(body)) {
    positiveSignals.push('device-fingerprint-signal-redacted');
  }
  if (/\b(?:nonce|x-requested-with|x-signature|x-request-id|one-time)\b/iu.test(body)) {
    positiveSignals.push('one-time-header-signal-redacted');
  }
  if (/\b(?:captcha|recaptcha|hcaptcha|turnstile|cf-chl|cloudflare challenge|verify you are human|js challenge|mfa|two-factor|2fa)\b/iu.test(body)) {
    blockingSignals.push('js-challenge-or-step-up-detected');
  }
  return {
    positiveSignals: uniqueStrings(positiveSignals),
    blockingSignals: uniqueStrings(blockingSignals),
  };
}

function safeRouteRef(urlValue, site) {
  if (!urlValue || !site) {
    return null;
  }
  try {
    const normalized = normalizeUrl(urlValue, site.rootUrl);
    if (!isInternalUrl(normalized, site.allowedDomains)) {
      return null;
    }
    return new URL(normalized).pathname;
  } catch {
    return null;
  }
}

function sanitizedFinalUrl(urlValue, site) {
  if (!urlValue) {
    return null;
  }
  try {
    const normalized = site ? normalizeUrl(urlValue, site.rootUrl) : normalizeUrl(urlValue);
    if (site && !isInternalUrl(normalized, site.allowedDomains)) {
      return null;
    }
    const parsed = new URL(normalized);
    parsed.search = '';
    parsed.hash = '';
    return sanitizeEvidenceRef(parsed.toString()) ?? null;
  } catch {
    return sanitizeEvidenceRef(urlValue) ?? null;
  }
}

function cookiePairCount(cookieHeader) {
  return String(cookieHeader ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => /^[^=;\s]+=[^;]*$/u.test(part))
    .length;
}

export function normalizeCookieHeader(value) {
  const text = String(value ?? '')
    .replace(/\r?\n/gu, '; ')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => /^[^=;\s]+=[^;]*$/u.test(part))
    .join('; ');
  return text;
}

export function parseNetscapeCookieJarToHeader(text) {
  const pairs = [];
  for (const rawLine of String(text ?? '').split(/\r?\n/u)) {
    let line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith('#HttpOnly_')) {
      line = line.replace(/^#HttpOnly_/u, '');
    } else if (line.startsWith('#')) {
      continue;
    }
    const parts = line.split(/\t+/u);
    if (parts.length < 7) {
      continue;
    }
    const name = String(parts[5] ?? '').trim();
    const value = String(parts.slice(6).join('\t') ?? '').trim();
    if (/^[^=;\s]+$/u.test(name)) {
      pairs.push(`${name}=${value}`);
    }
  }
  return normalizeCookieHeader(pairs.join('; '));
}

async function readStdin(input = process.stdin) {
  if (!input || typeof input.on !== 'function') {
    return '';
  }
  const chunks = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function resolveCookieHeader(options = /** @type {any} */ ({})) {
  let raw = null;
  let source = null;
  if (typeof options.cookieHeader === 'string') {
    raw = options.cookieHeader;
    source = 'provider';
  } else if (options.cookieEnv) {
    raw = options.env?.[options.cookieEnv] ?? process.env[String(options.cookieEnv)];
    source = 'env';
  } else if (options.cookieFile) {
    raw = await readFile(String(options.cookieFile), 'utf8');
    source = 'file';
  } else if (options.cookieStdin === true) {
    raw = await readStdin(options.stdin ?? process.stdin);
    source = 'stdin';
  }
  const rawText = String(raw ?? '');
  const cookieHeader = source === 'file' && /\bNetscape HTTP Cookie File\b|^#HttpOnly_|^[^\t\r\n]+\t(?:TRUE|FALSE)\t/imu.test(rawText)
    ? parseNetscapeCookieJarToHeader(rawText)
    : normalizeCookieHeader(rawText);
  const pairCount = cookiePairCount(cookieHeader);
  return {
    cookieHeader,
    source,
    provided: pairCount > 0,
    pairCount,
  };
}

function cookieInputSummary({ provided = false, source = null, pairCount = 0 } = /** @type {any} */ ({})) {
  return {
    provided: provided === true,
    source: source ?? null,
    pairCount: Math.max(0, Number(pairCount ?? 0) || 0),
    persisted: false,
    redacted: true,
  };
}

function browserBridgeCookieInputSummary(options = /** @type {any} */ ({})) {
  const cookieHeader = normalizeCookieHeader(options.apiReplayCookieHeader ?? options.cookieHeader ?? '');
  const pairCount = cookiePairCount(cookieHeader);
  return cookieInputSummary({
    provided: pairCount > 0,
    source: pairCount > 0 ? 'browser_bridge' : null,
    pairCount,
  });
}

function browserBridgeSummary({
  used = false,
  pageCount = 0,
  overlayPageCount = 0,
  routeCount = 0,
  configuredRouteCount = 0,
  eligibleRouteCount = 0,
  scheduledRouteCount = 0,
  routeQueueLimit = 0,
  overflowRouteCount = 0,
  unattemptedRouteCount = 0,
  routeQueueTruncated = false,
  routeQueueStatus = null,
  routeLimitReasonCode = null,
  capturedRouteCount = 0,
  missingRouteCount = 0,
  routeCoverageStatus = null,
  retryStatus = null,
  retryPasses = 0,
  initialCapturedRouteCount = 0,
  retryAttemptedRouteCount = 0,
  retryCapturedRouteCount = 0,
  finalCapturedRouteCount = 0,
  finalMissingRouteCount = 0,
  routeResults = [],
  extensionStages = [],
  extensionStageCount: inputExtensionStageCount = 0,
  extensionStageOmittedCount: inputExtensionStageOmittedCount = 0,
  extensionStageTimeline = [],
  extensionStageTimelineLimit: inputExtensionStageTimelineLimit = MAX_EXTENSION_STAGE_TIMELINE,
  extensionStageTimelineCount: inputExtensionStageTimelineCount = 0,
  extensionStageTimelineOmittedCount: inputExtensionStageTimelineOmittedCount = 0,
} = /** @type {any} */ ({}), {
  site = null,
  includeDiagnosticStages = true,
  includeDiagnosticTimeline = true,
} = /** @type {any} */ ({})) {
  const routeStatuses = ['captured', 'captured_with_warning', 'thin_capture', 'blocked', 'timeout', 'challenge_detected'];
  const sanitizedRouteResults = (Array.isArray(routeResults) ? routeResults : []).map((result) => {
    const status = routeStatuses.includes(String(result?.status ?? '').trim())
      ? String(result.status).trim()
      : 'timeout';
    const initialStatus = routeStatuses.includes(String(result?.initialStatus ?? '').trim()) ? String(result.initialStatus).trim() : null;
    const finalStatus = routeStatuses.includes(String(result?.finalStatus ?? '').trim()) ? String(result.finalStatus).trim() : null;
    return {
      routeId: sanitizeBridgeDiagnosticToken(result?.routeId),
      sourceLayer: result?.sourceLayer === 'authenticated_overlay' ? 'authenticated_overlay' : 'authenticated',
      targetRoute: sanitizeRouteTargetForPersistence(result?.targetRoute, site)
        ?? sanitizeRouteTargetForPersistence(result?.routeTemplate, site)
        ?? null,
      status,
      reasonCode: sanitizeBridgeDiagnosticToken(result?.reasonCode),
      captured: browserBridgeRouteResultCaptured({ status, captured: result?.captured }),
      initialStatus,
      initialReasonCode: sanitizeBridgeDiagnosticToken(result?.initialReasonCode),
      finalStatus,
      finalReasonCode: sanitizeBridgeDiagnosticToken(result?.finalReasonCode),
      retryAttemptCount: Math.max(0, Number(result?.retryAttemptCount ?? 0) || 0),
      retryOutcome: sanitizeBridgeDiagnosticToken(result?.retryOutcome),
    };
  });
  const inferredRouteCount = sanitizedRouteResults.length;
  const inferredCapturedRouteCount = sanitizedRouteResults.filter((result) => result.captured === true).length;
  const inferredMissingRouteCount = Math.max(0, inferredRouteCount - inferredCapturedRouteCount);
  const safeRouteCoverageStatus = ['complete', 'partial', 'none'].includes(String(routeCoverageStatus ?? '').trim())
    && (
      (String(routeCoverageStatus).trim() === 'complete' && inferredRouteCount > 0 && inferredMissingRouteCount === 0)
      || (String(routeCoverageStatus).trim() === 'partial' && inferredCapturedRouteCount > 0 && inferredMissingRouteCount > 0)
      || (String(routeCoverageStatus).trim() === 'none' && inferredCapturedRouteCount === 0)
    )
    ? String(routeCoverageStatus).trim()
    : inferredRouteCount > 0 && inferredMissingRouteCount === 0
    ? 'complete'
    : inferredCapturedRouteCount > 0
    ? 'partial'
    : 'none';
  const safeRetryStatus = ['not_attempted', 'captured_after_retry', 'attempted_no_gain'].includes(String(retryStatus ?? '').trim())
    ? String(retryStatus).trim()
    : 'not_attempted';
  const sanitizedExtensionStages = uniqueStrings((Array.isArray(extensionStages) ? extensionStages : [])
    .map(sanitizeBridgeDiagnosticStage)
    .filter(Boolean));
  const acceptedExtensionStageOmittedCount = 0;
  const reportedExtensionStageCount = sanitizedExtensionStages.length + acceptedExtensionStageOmittedCount;
  const persistedExtensionStages = includeDiagnosticStages === true ? sanitizedExtensionStages : [];
  const sanitizedExtensionStageTimeline = (Array.isArray(extensionStageTimeline) ? extensionStageTimeline : [])
    .map((entry, index) => {
      const stage = sanitizeBridgeDiagnosticStage(entry?.stage);
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
  const persistedExtensionStageTimeline = includeDiagnosticTimeline === true
    ? sanitizedExtensionStageTimeline.slice(0, MAX_EXTENSION_STAGE_TIMELINE)
    : [];
  const inputTimelineOmittedCount = Math.max(0, Number(inputExtensionStageTimelineOmittedCount ?? 0) || 0);
  const inputTimelineCount = Math.max(0, Number(inputExtensionStageTimelineCount ?? 0) || 0);
  const acceptedExtensionStageTimelineOmittedCount = (
    sanitizedExtensionStageTimeline.length === MAX_EXTENSION_STAGE_TIMELINE
    && inputTimelineOmittedCount > 0
    && inputTimelineOmittedCount <= MAX_EXTENSION_STAGE_TIMELINE
    && inputTimelineCount === sanitizedExtensionStageTimeline.length + inputTimelineOmittedCount
  )
    ? inputTimelineOmittedCount
    : 0;
  const reportedExtensionStageTimelineCount = sanitizedExtensionStageTimeline.length
    + acceptedExtensionStageTimelineOmittedCount;
  const safeExtensionStageTimelineLimit = Math.max(
    MAX_EXTENSION_STAGE_TIMELINE,
    Number(inputExtensionStageTimelineLimit ?? 0) || 0,
  );
  const summary = {
    used: used === true,
    persisted: false,
    redacted: true,
    pageCount: Math.max(0, Number(pageCount ?? 0) || 0),
    overlayPageCount: Math.max(0, Number(overlayPageCount ?? 0) || 0),
    routeCount: Math.max(0, inferredRouteCount || 0),
    configuredRouteCount: Math.max(0, Number(configuredRouteCount ?? inferredRouteCount) || 0),
    eligibleRouteCount: Math.max(0, Number(eligibleRouteCount ?? inferredRouteCount) || 0),
    scheduledRouteCount: Math.max(0, Number(scheduledRouteCount ?? inferredRouteCount) || 0),
    routeQueueLimit: Math.max(0, Number(routeQueueLimit ?? 0) || 0),
    overflowRouteCount: Math.max(0, Number(overflowRouteCount ?? 0) || 0),
    unattemptedRouteCount: Math.max(0, Number(unattemptedRouteCount ?? overflowRouteCount) || 0),
    routeQueueTruncated: routeQueueTruncated === true,
    routeQueueStatus: ['complete', 'truncated'].includes(String(routeQueueStatus ?? '').trim())
      ? String(routeQueueStatus).trim()
      : routeQueueTruncated === true
        ? 'truncated'
        : 'complete',
    routeLimitReasonCode: String(routeLimitReasonCode ?? '').trim().slice(0, 80) || null,
    capturedRouteCount: Math.max(0, inferredCapturedRouteCount || 0),
    missingRouteCount: Math.max(0, inferredMissingRouteCount || 0),
    routeCoverageStatus: safeRouteCoverageStatus,
    retryStatus: safeRetryStatus,
    retryPasses: Math.max(0, Number(retryPasses ?? 0) || 0),
    initialCapturedRouteCount: Math.max(0, Number(initialCapturedRouteCount ?? 0) || 0),
    retryAttemptedRouteCount: Math.max(0, Number(retryAttemptedRouteCount ?? 0) || 0),
    retryCapturedRouteCount: Math.max(0, Number(retryCapturedRouteCount ?? 0) || 0),
    finalCapturedRouteCount: inferredCapturedRouteCount,
    finalMissingRouteCount: inferredMissingRouteCount,
    routeResultCount: sanitizedRouteResults.length,
    routeResultOmittedCount: 0,
    routeResults: sanitizedRouteResults,
    extensionStageCount: reportedExtensionStageCount,
    extensionStageOmittedCount: includeDiagnosticStages === true
      ? acceptedExtensionStageOmittedCount
      : reportedExtensionStageCount,
    extensionStages: persistedExtensionStages,
    extensionStageTimelineLimit: safeExtensionStageTimelineLimit,
    extensionStageTimelineCount: reportedExtensionStageTimelineCount,
    extensionStageTimelineOmittedCount: includeDiagnosticTimeline === true
      ? Math.max(0, reportedExtensionStageTimelineCount - persistedExtensionStageTimeline.length)
      : reportedExtensionStageTimelineCount,
    extensionStageTimeline: persistedExtensionStageTimeline,
  };
  assertNoForbiddenPatterns(summary);
  return summary;
}

export function normalizeAuthStateReport(report = /** @type {any} */ ({}), {
  site = null,
  crawlMode = report.crawlMode ?? 'public_only',
  authMethod = report.authMethod ?? 'none',
} = /** @type {any} */ ({})) {
  const method = normalizeAuthMethod(report.authMethod ?? authMethod, 'none');
  const browserBridge = browserBridgeSummary(report.browserBridge, { site });
  const status = normalizeAuthVerificationStatus(
    report.authVerificationStatus,
    method === 'cookie'
      ? 'cookie_missing'
      : method === 'browser'
        ? 'browser_bridge_missing'
        : method === 'authorized_source'
          ? 'authorized_source_verified'
          : 'not_requested',
  );
  const browserPartial = method === 'browser'
    && report.verified === true
    && browserBridge.routeCoverageStatus === 'partial'
    && browserBridge.capturedRouteCount > 0
    && browserBridge.missingRouteCount > 0;
  const verified = ((method === 'cookie' && status === 'cookie_verified')
    || (method === 'browser' && ['browser_verified', 'browser_verified_partial'].includes(status))
    || (method === 'authorized_source' && status === 'authorized_source_verified'))
    && report.verified === true;
  const finalUrl = sanitizedFinalUrl(report.finalUrl, site);
  const verifiedRoutes = Array.isArray(report.verifiedRoutes)
    ? report.verifiedRoutes
      .map((route) => sanitizeRouteTargetForPersistence(route, site))
      .filter(Boolean)
    : [];
  const cookieInput = cookieInputSummary(report.cookieInput ?? {
    provided: method === 'cookie' && status !== 'cookie_missing',
    source: null,
    pairCount: 0,
  });
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: AUTH_STATE_ARTIFACT_FAMILY,
    crawlMode: verified
      ? (method === 'browser'
        ? 'authenticated_browser'
        : method === 'authorized_source'
          ? 'authenticated_authorized_source'
          : 'authenticated_cookie')
      : crawlMode,
    authMethod: method,
    authVerificationStatus: verified
      ? (method === 'browser'
        ? (browserPartial ? 'browser_verified_partial' : status)
        : method === 'authorized_source'
          ? 'authorized_source_verified'
          : 'cookie_verified')
      : status,
    verified,
    source: report.source ?? (method === 'cookie'
      ? 'cookie_header_verification'
      : method === 'browser'
        ? 'default_browser_bridge'
        : method === 'authorized_source'
          ? 'authorized_source_sanitized_summary'
          : 'public_only'),
    finalUrl,
    blockingSignals: uniqueStrings(report.blockingSignals ?? []),
    positiveSignals: uniqueStrings(report.positiveSignals ?? []),
    verifiedRoutes: uniqueStrings(verifiedRoutes),
    capabilityProofs: Array.isArray(report.capabilityProofs) ? report.capabilityProofs.map((proof) => ({
      capabilityId: String(proof?.capabilityId ?? proof?.setupCapabilityId ?? '').trim(),
      evidenceLevel: String(proof?.evidenceLevel ?? 'capability_verified').trim(),
      sampleCount: Math.max(0, Number(proof?.sampleCount ?? proof?.visibleItemCount ?? 0) || 0),
      rawMaterialPersisted: false,
    })).filter((proof) => proof.capabilityId && proof.sampleCount > 0) : [],
    cookieInput,
    browserBridge,
    rawMaterialPersisted: false,
    sessionMaterialPersisted: false,
    cookieMaterialPersisted: false,
    browserProfilePersisted: false,
  };
}

export function createPublicOnlyAuthStateReport({
  site = null,
  authMethod = 'none',
  reasonCode = null,
} = /** @type {any} */ ({})) {
  return normalizeAuthStateReport({
    crawlMode: 'public_only',
    authMethod,
    authVerificationStatus: authMethod === 'cookie' ? 'cookie_missing' : authMethod === 'browser' ? 'browser_bridge_missing' : 'not_requested',
    verified: false,
    source: 'public_only',
    blockingSignals: [reasonCode].filter(Boolean),
    positiveSignals: ['public_only_default'],
    cookieInput: cookieInputSummary(),
    browserBridge: browserBridgeSummary(),
  }, { site, crawlMode: 'public_only', authMethod });
}

function resolveAuthCheckUrl(inputUrl, site, options = /** @type {any} */ ({})) {
  const raw = String(options.authCheckUrl ?? inputUrl ?? site?.rootUrl ?? '').trim();
  return normalizeUrl(raw || site.rootUrl, site.rootUrl);
}

function resolveAuthCheckUrls(inputUrl, site, options = /** @type {any} */ ({})) {
  if (options.authCheckUrl) {
    return [resolveAuthCheckUrl(inputUrl, site, options)];
  }
  const candidates = [];
  try {
    const input = normalizeUrl(inputUrl, site.rootUrl);
    const parsed = new URL(input);
    if (parsed.pathname && parsed.pathname !== '/') {
      candidates.push(input);
    }
  } catch {
    // Fall through to common same-site auth probes.
  }
  for (const route of [
    '/account',
    '/user',
    '/profile',
    '/settings',
    '/me',
    '/my',
    '/member',
    '/notifications',
    '/api/me',
    '/api/user',
  ]) {
    candidates.push(normalizeUrl(route, site.rootUrl));
  }
  return uniqueStrings(candidates).filter((candidate) => isInternalUrl(candidate, site.allowedDomains));
}

function isAuthCheckUrlAllowedByRobots(urlValue, robotsPolicy = null) {
  if (!robotsPolicy) {
    return true;
  }
  return isUrlAllowedByRobots(urlValue, robotsPolicy);
}

function cookieAuthRobotsBlockedVerification({
  finalUrl = null,
  reasonCode = 'auth-check-url-robots-disallowed',
} = /** @type {any} */ ({})) {
  return {
    authVerificationStatus: 'cookie_blocked',
    verified: false,
    finalUrl,
    positiveSignals: ['cookie_header_present'],
    blockingSignals: ['robots-disallowed', reasonCode],
    verifiedRoutes: [],
  };
}

async function verifyCookieAgainstUrl({
  url,
  site,
  cookieHeader,
  options = /** @type {any} */ ({}),
  robotsPolicy = null,
} = /** @type {any} */ ({})) {
  let currentUrl = normalizeUrl(url, site.rootUrl);
  if (!isInternalUrl(currentUrl, site.allowedDomains)) {
    return {
      authVerificationStatus: 'cookie_blocked',
      verified: false,
      finalUrl: null,
      positiveSignals: [],
      blockingSignals: ['auth-check-url-cross-site'],
      verifiedRoutes: [],
    };
  }

  const timeoutMs = Math.max(1, Number(options.fetchTimeoutMs ?? options.timeoutMs ?? 10000));
  const maxRedirects = 5;
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    if (!isAuthCheckUrlAllowedByRobots(currentUrl, robotsPolicy)) {
      return cookieAuthRobotsBlockedVerification({
        finalUrl: currentUrl,
        reasonCode: 'auth-check-url-robots-disallowed',
      });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.1',
          'accept-encoding': 'identity',
          'user-agent': 'SiteForgeBuildCookieAuthVerifier/1.0',
          cookie: cookieHeader,
        },
      });
    } catch (error) {
      return {
        authVerificationStatus: 'auth_check_failed',
        verified: false,
        finalUrl: currentUrl,
        positiveSignals: ['cookie_header_present'],
        blockingSignals: [error?.name === 'AbortError' ? 'auth-check-timeout' : 'auth-check-request-failed'],
        verifiedRoutes: [],
      };
    } finally {
      clearTimeout(timeout);
    }

    const status = response.status;
    const location = response.headers.get('location');
    if ([301, 302, 303, 307, 308].includes(status) && location) {
      const nextUrl = normalizeUrl(location, currentUrl);
      if (!isInternalUrl(nextUrl, site.allowedDomains)) {
        return {
          authVerificationStatus: 'cookie_blocked',
          verified: false,
          finalUrl: currentUrl,
          positiveSignals: ['cookie_header_present'],
          blockingSignals: ['auth-check-redirect-cross-site'],
          verifiedRoutes: [],
        };
      }
      if (!isAuthCheckUrlAllowedByRobots(nextUrl, robotsPolicy)) {
        return cookieAuthRobotsBlockedVerification({
          finalUrl: currentUrl,
          reasonCode: 'auth-check-redirect-robots-disallowed',
        });
      }
      if (isLoginLikeUrl(nextUrl)) {
        return {
          authVerificationStatus: 'cookie_invalid',
          verified: false,
          finalUrl: nextUrl,
          positiveSignals: ['cookie_header_present'],
          blockingSignals: ['redirected-to-login'],
          verifiedRoutes: [],
        };
      }
      currentUrl = nextUrl;
      continue;
    }

    if (status === 401 || status === 403) {
      return {
        authVerificationStatus: 'cookie_invalid',
        verified: false,
        finalUrl: currentUrl,
        positiveSignals: ['cookie_header_present'],
        blockingSignals: [`http_${status}`],
        verifiedRoutes: [],
      };
    }

    if (status >= 200 && status < 300 && isInternalUrl(currentUrl, site.allowedDomains) && !isLoginLikeUrl(currentUrl)) {
      let dependencySignals = { positiveSignals: [], blockingSignals: [] };
      try {
        dependencySignals = authDependencySignalsFromBody(await response.text());
      } catch {
        dependencySignals = { positiveSignals: [], blockingSignals: ['auth-check-body-read-failed'] };
      }
      if (dependencySignals.blockingSignals.length) {
        return {
          authVerificationStatus: 'cookie_blocked',
          verified: false,
          finalUrl: currentUrl,
          positiveSignals: ['cookie_header_present', 'auth_check_http_success', ...dependencySignals.positiveSignals],
          blockingSignals: dependencySignals.blockingSignals,
          verifiedRoutes: [],
        };
      }
      return {
        authVerificationStatus: 'cookie_verified',
        verified: true,
        finalUrl: currentUrl,
        positiveSignals: ['cookie_header_present', 'auth_check_http_success', 'auth_check_not_login_route', ...dependencySignals.positiveSignals],
        blockingSignals: [],
        verifiedRoutes: [safeRouteRef(currentUrl, site)].filter(Boolean),
      };
    }

    return {
      authVerificationStatus: 'cookie_invalid',
      verified: false,
      finalUrl: currentUrl,
      positiveSignals: ['cookie_header_present'],
      blockingSignals: [isLoginLikeUrl(currentUrl) ? 'auth-check-login-route' : `http_${status}`],
      verifiedRoutes: [],
    };
  }

  return {
    authVerificationStatus: 'auth_check_failed',
    verified: false,
    finalUrl: currentUrl,
    positiveSignals: ['cookie_header_present'],
    blockingSignals: ['auth-check-redirect-limit'],
    verifiedRoutes: [],
  };
}

export async function runCookieAuthStateCheck({
  inputUrl,
  site,
  options = /** @type {any} */ ({}),
  robotsPolicy = null,
} = /** @type {any} */ ({})) {
  const cookie = await resolveCookieHeader(options);
  if (!cookie.provided) {
    return normalizeAuthStateReport({
      crawlMode: 'public_only',
      authMethod: 'cookie',
      authVerificationStatus: 'cookie_missing',
      verified: false,
      source: 'cookie_header_verification',
      blockingSignals: ['cookie-missing'],
      positiveSignals: [],
      cookieInput: cookieInputSummary(cookie),
    }, { site, crawlMode: 'public_only', authMethod: 'cookie' });
  }

  let authCheckUrls;
  try {
    authCheckUrls = resolveAuthCheckUrls(inputUrl, site, options);
  } catch {
    return normalizeAuthStateReport({
      crawlMode: 'public_only',
      authMethod: 'cookie',
      authVerificationStatus: 'cookie_blocked',
      verified: false,
      source: 'cookie_header_verification',
      blockingSignals: ['auth-check-url-invalid'],
      positiveSignals: ['cookie_header_present'],
      cookieInput: cookieInputSummary(cookie),
    }, { site, crawlMode: 'public_only', authMethod: 'cookie' });
  }
  if (!authCheckUrls.length || authCheckUrls.some((authCheckUrl) => !isInternalUrl(authCheckUrl, site.allowedDomains))) {
    return normalizeAuthStateReport({
      crawlMode: 'public_only',
      authMethod: 'cookie',
      authVerificationStatus: 'cookie_blocked',
      verified: false,
      source: 'cookie_header_verification',
      finalUrl: null,
      blockingSignals: ['auth-check-url-cross-site'],
      positiveSignals: ['cookie_header_present'],
      cookieInput: cookieInputSummary(cookie),
    }, { site, crawlMode: 'public_only', authMethod: 'cookie' });
  }
  const robotsAllowedAuthCheckUrls = authCheckUrls.filter((authCheckUrl) => (
    isAuthCheckUrlAllowedByRobots(authCheckUrl, robotsPolicy)
  ));
  if (robotsAllowedAuthCheckUrls.length !== authCheckUrls.length && (options.authCheckUrl || robotsAllowedAuthCheckUrls.length === 0)) {
    return normalizeAuthStateReport({
      crawlMode: 'public_only',
      authMethod: 'cookie',
      authVerificationStatus: 'cookie_blocked',
      verified: false,
      source: 'cookie_header_verification',
      finalUrl: null,
      blockingSignals: ['robots-disallowed', 'auth-check-url-robots-disallowed'],
      positiveSignals: ['cookie_header_present'],
      cookieInput: cookieInputSummary(cookie),
    }, { site, crawlMode: 'public_only', authMethod: 'cookie' });
  }

  const attempts = [];
  let verification = null;
  const explicitAuthCheckUrl = Boolean(options.authCheckUrl);
  for (const authCheckUrl of robotsAllowedAuthCheckUrls) {
    const attempt = await verifyCookieAgainstUrl({
      url: authCheckUrl,
      site,
      cookieHeader: cookie.cookieHeader,
      options,
      robotsPolicy,
    });
    attempts.push(attempt);
    if (attempt.verified === true) {
      verification = {
        ...attempt,
        positiveSignals: [
          ...(explicitAuthCheckUrl ? [] : ['auth_check_auto_discovered']),
          ...(attempt.positiveSignals ?? []),
        ],
      };
      break;
    }
  }
  if (!verification) {
    const nonNotFound = explicitAuthCheckUrl
      ? attempts[0]
      : attempts.find((attempt) => !(attempt.blockingSignals ?? []).some((signal) => signal === 'http_404'));
    verification = nonNotFound ?? {
      authVerificationStatus: 'auth_check_failed',
      verified: false,
      finalUrl: site.rootUrl,
      positiveSignals: ['cookie_header_present'],
      blockingSignals: ['auth-check-url-not-discovered'],
      verifiedRoutes: [],
    };
  }
  const report = normalizeAuthStateReport({
    crawlMode: verification.verified ? 'authenticated_cookie' : 'public_only',
    authMethod: 'cookie',
    authVerificationStatus: verification.authVerificationStatus,
    verified: verification.verified,
    source: 'cookie_header_verification',
    finalUrl: verification.finalUrl,
    blockingSignals: verification.blockingSignals,
    positiveSignals: verification.positiveSignals,
    verifiedRoutes: verification.verifiedRoutes,
    cookieInput: cookieInputSummary(cookie),
  }, { site, crawlMode: verification.verified ? 'authenticated_cookie' : 'public_only', authMethod: 'cookie' });
  if (canRunAuthenticatedLayer(report)) {
    attachAuthRuntimeMaterial(report, {
      authRuntime: {
        method: 'cookie',
        cookieHeader: cookie.cookieHeader,
        allowedDomains: [...(site.allowedDomains ?? [])],
      },
    });
  }
  return report;
}

export async function runBrowserAuthStateCheck({
  inputUrl,
  site,
  options = /** @type {any} */ ({}),
  robotsPolicy = null,
} = /** @type {any} */ ({})) {
  const verification = await runBrowserAuthBridge({
    inputUrl,
    site,
    options,
    openBrowser: (targetUrl) => openSystemDefaultBrowser(targetUrl, options),
    robotsPolicy,
  });
  const report = normalizeAuthStateReport({
    crawlMode: verification.verified ? 'authenticated_browser' : 'public_only',
    authMethod: 'browser',
    authVerificationStatus: verification.status,
    verified: verification.verified,
    source: 'default_browser_bridge',
    finalUrl: verification.finalUrl,
    blockingSignals: verification.blockingSignals,
    positiveSignals: verification.positiveSignals,
    verifiedRoutes: verification.verifiedRoutes,
    browserBridge: verification.bridgeSummary,
    cookieInput: browserBridgeCookieInputSummary(options),
  }, { site, crawlMode: verification.verified ? 'authenticated_browser' : 'public_only', authMethod: 'browser' });
  if (verification.verified === true && verification.structureSummary) {
    attachAuthRuntimeMaterial(report, {
      authRuntime: {
        method: 'browser',
        allowedDomains: [...(site.allowedDomains ?? [])],
      },
      authenticatedStructureSummary: verification.structureSummary,
    });
  }
  return report;
}

export async function runDefaultBrowserAuthStateCheck(args = /** @type {any} */ ({})) {
  const { options = /** @type {any} */ ({}) } = args;

  if (typeof options.authStateProvider === 'function') {
    const provided = await options.authStateProvider(args);
    return normalizeAuthStateReport(provided, {
      site: args.site,
      crawlMode: provided?.verified === true
        ? (provided?.authMethod === 'browser' ? 'authenticated_browser' : 'authenticated_cookie')
        : 'public_only',
      authMethod: provided?.authMethod ?? 'none',
    });
  }

  if (options.authMode === 'browser') {
    return await runBrowserAuthStateCheck(args);
  }

  if (options.authMode === 'cookie') {
    return await runCookieAuthStateCheck(args);
  }

  return createPublicOnlyAuthStateReport({
    site: args.site,
    authMethod: 'none',
    reasonCode: 'auth-not-requested',
  });
}

export function createCrawlContract({
  site = null,
  authStateReport = null,
  coverageTargets = /** @type {any} */ ({}),
  sourceMode = null,
} = /** @type {any} */ ({})) {
  const normalizedReport = authStateReport
    ? normalizeAuthStateReport(authStateReport, { site })
    : createPublicOnlyAuthStateReport({ site });
  const authenticated = canRunAuthenticatedLayer(normalizedReport);
  const authenticatedCookie = authenticated && normalizedReport.authMethod === 'cookie';
  const authenticatedBrowser = authenticated && normalizedReport.authMethod === 'browser';
  const authenticatedAuthorizedSource = authenticated && normalizedReport.authMethod === 'authorized_source';
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-crawl-contract',
    crawlMode: authenticated
      ? (authenticatedBrowser
        ? 'authenticated_browser'
        : authenticatedAuthorizedSource
          ? 'authenticated_authorized_source'
          : 'authenticated_cookie')
      : 'public_only',
    sourceMode: sourceMode ?? (authenticated
      ? (authenticatedBrowser
        ? (normalizedReport.authVerificationStatus === 'browser_verified_partial' ? 'browser_bridge_partial' : 'browser_bridge_verified')
        : authenticatedAuthorizedSource
          ? 'authorized_source_sanitized_summary'
          : 'cookie_verified')
      : 'live_static'),
    authMethod: normalizedReport.authMethod,
    authVerificationStatus: normalizedReport.authVerificationStatus,
    coverageTargets: {
      publicRoutes: sanitizedRouteTargetsForPersistence(coverageTargets.publicRoutes ?? [], site),
      authRoutes: sanitizedRouteTargetsForPersistence(coverageTargets.authRoutes ?? [], site),
      publicRevisitRoutes: sanitizedRouteTargetsForPersistence(coverageTargets.publicRevisitRoutes ?? [], site),
      candidateCapabilities: uniqueStrings(coverageTargets.candidateCapabilities ?? []),
      requiresLoginCapabilities: uniqueStrings(coverageTargets.requiresLoginCapabilities ?? []),
    },
    evidencePolicy: {
      allowPublicStatic: true,
      allowAuthenticatedCookie: authenticatedCookie,
      allowAuthenticatedBrowserBridge: authenticatedBrowser,
      allowCookieInput: authenticatedCookie,
      allowCookiePersistence: false,
      allowPublicPageMaterial: true,
      allowPublicRawHtml: true,
      allowPublicRawDom: true,
      allowPublicBodyText: true,
      allowAuthenticatedPageMaterial: false,
      allowRawDom: false,
      allowPrivateBody: false,
      allowBrowserProfile: false,
      allowStorage: false,
      allowRawNetworkPayload: false,
    },
  };
}

export function authSummaryForReport(crawlContract = null, authStateReport = null) {
  const contract = crawlContract ?? createCrawlContract({ authStateReport });
  const report = authStateReport ?? createPublicOnlyAuthStateReport({ authMethod: contract.authMethod });
  return {
    crawlMode: contract.crawlMode,
    authMethod: contract.authMethod ?? report.authMethod ?? 'none',
    authVerificationStatus: contract.authVerificationStatus ?? report.authVerificationStatus ?? 'not_requested',
    verified: report.verified === true,
    sourceMode: contract.sourceMode,
    positiveSignals: report.positiveSignals ?? [],
    blockingSignals: report.blockingSignals ?? [],
    cookieInput: cookieInputSummary(report.cookieInput),
    browserBridge: browserBridgeSummary(report.browserBridge, {
      includeDiagnosticStages: false,
      includeDiagnosticTimeline: false,
    }),
    savedMaterial: {
      rawMaterialPersisted: false,
      sessionMaterialPersisted: false,
      cookieMaterialPersisted: false,
      browserProfilePersisted: false,
      rawDomPersisted: false,
      rawHtmlPersisted: false,
      privateBodyPersisted: false,
      rawNetworkPayloadPersisted: false,
    },
  };
}
