// @ts-check

import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { BUILD_SCHEMA_VERSION, isInternalUrl, normalizeUrl } from './models.mjs';
import { sanitizeEvidenceRef } from './risk-policy.mjs';
import { runBrowserAuthBridge } from './browser-auth-bridge.mjs';

export const AUTH_STATE_REPORT_FILE = 'auth_state_report.json';
export const CRAWL_AUTHENTICATED_FILE = 'crawl_authenticated.json';
export const AUTH_STATE_ARTIFACT_FAMILY = 'siteforge-auth-state-report';

export const AUTH_METHODS = Object.freeze(['none', 'cookie', 'browser']);

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
  'browser_blocked',
  'browser_check_failed',
]);

export const CAPABILITY_EVIDENCE_LEVEL_RANK = Object.freeze({
  blocked: -1,
  candidate: 0,
  missing_auth_evidence: 0,
  public_verified: 1,
  public_rendered_verified: 2,
  authorized_source_verified: 2,
  login_user_confirmed: 2,
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

export function canRunAuthenticatedLayer(authStateReport = null) {
  if (authStateReport?.authMethod === 'cookie') {
    return authStateReport?.authVerificationStatus === 'cookie_verified'
      && authStateReport?.verified === true;
  }
  if (authStateReport?.authMethod === 'browser') {
    return authStateReport?.authVerificationStatus === 'browser_verified'
      && authStateReport?.verified === true;
  }
  return false;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'en'));
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

function browserBridgeSummary({
  used = false,
  pageCount = 0,
  overlayPageCount = 0,
  extensionStages = [],
} = /** @type {any} */ ({})) {
  return {
    used: used === true,
    persisted: false,
    redacted: true,
    pageCount: Math.max(0, Number(pageCount ?? 0) || 0),
    overlayPageCount: Math.max(0, Number(overlayPageCount ?? 0) || 0),
    extensionStages: uniqueStrings(extensionStages).slice(0, 20),
  };
}

export function normalizeAuthStateReport(report = /** @type {any} */ ({}), {
  site = null,
  crawlMode = report.crawlMode ?? 'public_only',
  authMethod = report.authMethod ?? 'none',
} = /** @type {any} */ ({})) {
  const method = normalizeAuthMethod(report.authMethod ?? authMethod, 'none');
  const status = normalizeAuthVerificationStatus(
    report.authVerificationStatus,
    method === 'cookie' ? 'cookie_missing' : method === 'browser' ? 'browser_bridge_missing' : 'not_requested',
  );
  const verified = ((method === 'cookie' && status === 'cookie_verified')
    || (method === 'browser' && status === 'browser_verified'))
    && report.verified === true;
  const finalUrl = sanitizedFinalUrl(report.finalUrl, site);
  const verifiedRoutes = Array.isArray(report.verifiedRoutes)
    ? report.verifiedRoutes.map((route) => String(route ?? '').trim()).filter(Boolean)
    : [];
  const cookieInput = cookieInputSummary(report.cookieInput ?? {
    provided: method === 'cookie' && status !== 'cookie_missing',
    source: null,
    pairCount: 0,
  });
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: AUTH_STATE_ARTIFACT_FAMILY,
    crawlMode: verified ? (method === 'browser' ? 'authenticated_browser' : 'authenticated_cookie') : crawlMode,
    authMethod: method,
    authVerificationStatus: verified ? (method === 'browser' ? 'browser_verified' : 'cookie_verified') : status,
    verified,
    source: report.source ?? (method === 'cookie' ? 'cookie_header_verification' : method === 'browser' ? 'default_browser_bridge' : 'public_only'),
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
    browserBridge: browserBridgeSummary(report.browserBridge),
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

async function verifyCookieAgainstUrl({
  url,
  site,
  cookieHeader,
  options = /** @type {any} */ ({}),
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
} = /** @type {any} */ ({})) {
  const cookie = await resolveCookieHeader(options);
  if (!cookie.provided) {
    delete options.authRuntime;
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
    delete options.authRuntime;
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
    delete options.authRuntime;
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

  const attempts = [];
  let verification = null;
  const explicitAuthCheckUrl = Boolean(options.authCheckUrl);
  for (const authCheckUrl of authCheckUrls) {
    const attempt = await verifyCookieAgainstUrl({
      url: authCheckUrl,
      site,
      cookieHeader: cookie.cookieHeader,
      options,
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
    options.authRuntime = {
      method: 'cookie',
      cookieHeader: cookie.cookieHeader,
      allowedDomains: [...(site.allowedDomains ?? [])],
    };
  } else {
    delete options.authRuntime;
  }
  return report;
}

export async function runBrowserAuthStateCheck({
  inputUrl,
  site,
  options = /** @type {any} */ ({}),
} = /** @type {any} */ ({})) {
  delete options.authRuntime;
  delete options.authenticatedStructureSummary;
  const verification = await runBrowserAuthBridge({
    inputUrl,
    site,
    options,
    openBrowser: (targetUrl) => openSystemDefaultBrowser(targetUrl, options),
  });
  if (verification.verified === true && verification.structureSummary) {
    options.authRuntime = {
      method: 'browser',
      allowedDomains: [...(site.allowedDomains ?? [])],
    };
    options.authenticatedStructureSummary = verification.structureSummary;
  }
  return normalizeAuthStateReport({
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
    cookieInput: cookieInputSummary(),
  }, { site, crawlMode: verification.verified ? 'authenticated_browser' : 'public_only', authMethod: 'browser' });
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
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-crawl-contract',
    crawlMode: authenticated ? (authenticatedBrowser ? 'authenticated_browser' : 'authenticated_cookie') : 'public_only',
    sourceMode: sourceMode ?? (authenticated ? (authenticatedBrowser ? 'browser_bridge_verified' : 'cookie_verified') : 'live_static'),
    authMethod: normalizedReport.authMethod,
    authVerificationStatus: normalizedReport.authVerificationStatus,
    coverageTargets: {
      publicRoutes: uniqueStrings(coverageTargets.publicRoutes ?? []),
      authRoutes: uniqueStrings(coverageTargets.authRoutes ?? []),
      publicRevisitRoutes: uniqueStrings(coverageTargets.publicRevisitRoutes ?? []),
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
    browserBridge: browserBridgeSummary(report.browserBridge),
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
