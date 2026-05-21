import path from 'node:path';
import process from 'node:process';

import { validateProfileFile } from '../../sites/registry/core/profile-validation.mjs';
import { maybeLoadValidatedProfileForUrl } from '../../sites/registry/core/profiles.mjs';
import { inspectPersistentProfileHealth, resolvePersistentUserDataDir } from '../browser/profile-store.mjs';
import { openBrowserSession } from '../browser/session.mjs';
import { ensureDir, writeTextFile } from '../io.mjs';
import { normalizeText } from '../../shared/normalize.mjs';
import { prepareRedactedArtifactJsonWithAudit } from '../../domain/sessions/security-guard.mjs';
import { getWindowsCredential, resolveWindowsCredentialTarget } from './windows-credential-manager.mjs';

export const DEFAULT_LOGIN_WAIT_TIMEOUT_MS = 5 * 60_000;

const AUTH_READY_IDLE_MS = 250;
const DOWNLOAD_AUTH_STATE_DIR = '.bws';

function buildAuthWaitPolicy(timeoutMs) {
  return {
    useLoadEvent: false,
    useNetworkIdle: false,
    documentReadyTimeoutMs: timeoutMs,
    domQuietTimeoutMs: timeoutMs,
    domQuietMs: 400,
    idleMs: AUTH_READY_IDLE_MS,
  };
}

function normalizeSelectors(selectors) {
  return Array.isArray(selectors)
    ? selectors.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
}

function normalizeHostToken(host) {
  return String(host ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

function normalizeComparableHost(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizePathPrefix(value) {
  const normalized = String(value ?? '').trim().replace(/^\/+|\/+$/gu, '');
  return normalized ? `/${normalized}` : '/';
}

function normalizePathname(value) {
  const normalized = String(value ?? '').trim().replace(/\/+$/u, '');
  return normalized || '/';
}

function isPathPrefixMatch(pathname, prefix) {
  const normalizedPath = normalizePathname(pathname);
  const normalizedPrefix = normalizePathPrefix(prefix);
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
}

function isPathFamilyMatch(pathname, prefix) {
  return isPathPrefixMatch(pathname, prefix)
    || normalizePathname(pathname).includes(normalizePathPrefix(prefix));
}

function readPathname(inputUrl) {
  try {
    return new URL(String(inputUrl ?? '')).pathname;
  } catch {
    return null;
  }
}

function isXiaohongshuHostValue(value) {
  const host = normalizeComparableHost(value);
  return host === 'www.xiaohongshu.com' || host === 'xiaohongshu.com';
}

function normalizeComparableUrl(value) {
  try {
    return new URL(String(value ?? '')).toString();
  } catch {
    return String(value ?? '').trim();
  }
}

export async function resolveCredentialSource(authConfig, options = /** @type {any} */ ({}), deps = /** @type {any} */ ({})) {
  const username = String(options.loginUsername ?? '').trim();
  const password = String(options.loginPassword ?? '').trim();
  if (username && password) {
    return {
      username,
      password,
      source: 'explicit-options',
      available: true,
    };
  }

  const credentialTarget = resolveWindowsCredentialTarget(authConfig?.host ?? '', {
    credentialTarget: options.credentialTarget ?? authConfig?.credentialTarget ?? null,
  });
  if (credentialTarget && options.disableCredentialManager !== true) {
    try {
      const winCredential = await (deps.getWindowsCredential ?? getWindowsCredential)(credentialTarget, deps.credentialManagerDeps ?? {});
      if (winCredential?.found && winCredential.username && typeof winCredential.password === 'string' && winCredential.password.length > 0) {
        return {
          username: winCredential.username,
          password: winCredential.password,
          source: `wincred:${credentialTarget}`,
          available: true,
          target: credentialTarget,
        };
      }
    } catch {
      // Fall back to environment variables when WinCred is unavailable or unreadable.
    }
  }

  const hostToken = normalizeHostToken(String(authConfig?.host ?? '').replace(/^www\./iu, '').replace(/\.[^.]+$/u, ''));
  const usernameEnvCandidates = [
    authConfig?.usernameEnv,
    hostToken ? `${hostToken}_USERNAME` : null,
    'SITE_LOGIN_USERNAME',
  ].filter(Boolean);
  const passwordEnvCandidates = [
    authConfig?.passwordEnv,
    hostToken ? `${hostToken}_PASSWORD` : null,
    'SITE_LOGIN_PASSWORD',
  ].filter(Boolean);

  for (let index = 0; index < Math.max(usernameEnvCandidates.length, passwordEnvCandidates.length); index += 1) {
    const usernameEnv = usernameEnvCandidates[index];
    const passwordEnv = passwordEnvCandidates[index];
    const envUsername = String(process.env[usernameEnv] ?? '').trim();
    const envPassword = String(process.env[passwordEnv] ?? '').trim();
    if (envUsername && envPassword) {
      return {
        username: envUsername,
        password: envPassword,
        source: `env:${usernameEnv}/${passwordEnv}`,
        available: true,
      };
    }
  }

  return {
    username: null,
    password: null,
    source: null,
    available: false,
  };
}

function buildResolvedAuthConfig(profile = null) {
  const authConfig = profile?.authSession ?? null;
  if (!authConfig) {
    return null;
  }

  return {
    host: String(profile?.host ?? '').trim(),
    loginUrl: String(authConfig.loginUrl ?? '').trim() || null,
    postLoginUrl: String(authConfig.postLoginUrl ?? '').trim() || null,
    verificationUrl: String(authConfig.verificationUrl ?? '').trim() || null,
    keepaliveUrl: String(authConfig.keepaliveUrl ?? '').trim() || null,
    keepaliveIntervalMinutes: Number(authConfig.keepaliveIntervalMinutes ?? 0) || null,
    cooldownMinutesAfterRisk: Number(authConfig.cooldownMinutesAfterRisk ?? 0) || null,
    reuseLoginStateByDefault: authConfig.reuseLoginStateByDefault === true,
    autoLoginByDefault: authConfig.autoLoginByDefault === true,
    preferVisibleBrowserForAuthenticatedFlows: authConfig.preferVisibleBrowserForAuthenticatedFlows === true,
    requireStableNetworkForAuthenticatedFlows: authConfig.requireStableNetworkForAuthenticatedFlows === true,
    credentialTarget: String(authConfig.credentialTarget ?? '').trim() || null,
    usernameEnv: String(authConfig.usernameEnv ?? '').trim() || null,
    passwordEnv: String(authConfig.passwordEnv ?? '').trim() || null,
    loginIndicatorSelectors: normalizeSelectors(authConfig.loginIndicatorSelectors),
    loginEntrySelectors: normalizeSelectors(authConfig.loginEntrySelectors),
    loggedOutIndicatorSelectors: normalizeSelectors(authConfig.loggedOutIndicatorSelectors),
    passwordLoginTabSelectors: normalizeSelectors(authConfig.passwordLoginTabSelectors),
    usernameSelectors: normalizeSelectors(authConfig.usernameSelectors),
    passwordSelectors: normalizeSelectors(authConfig.passwordSelectors),
    submitSelectors: normalizeSelectors(authConfig.submitSelectors),
    challengeSelectors: normalizeSelectors(authConfig.challengeSelectors),
    validationSamplePriority: normalizeSelectors(authConfig.validationSamplePriority),
    reusableSessionSignals: normalizeSelectors(authConfig.reusableSessionSignals),
    authRequiredAuthorSubpages: normalizeSelectors(authConfig.authRequiredAuthorSubpages),
    authRequiredPathPrefixes: normalizeSelectors(authConfig.authRequiredPathPrefixes),
  };
}

function resolveAuthValidationSamplePriority(_inputUrl, siteProfile = null) {
  const resolvedAuthConfig = buildResolvedAuthConfig(siteProfile);
  if (resolvedAuthConfig?.validationSamplePriority?.length) {
    return resolvedAuthConfig.validationSamplePriority;
  }
  return Object.keys(siteProfile?.authValidationSamples ?? {});
}

export function resolveAuthVerificationUrl(inputUrl, authProfile = null, authConfig = null) {
  const siteProfile = authProfile?.profile ?? null;
  const resolvedAuthConfig = authConfig ?? buildResolvedAuthConfig(siteProfile);
  const preferred = String(resolvedAuthConfig?.verificationUrl ?? '').trim();
  if (preferred) {
    return preferred;
  }

  const samples = siteProfile?.authValidationSamples ?? {};
  const orderedCandidates = /** @type {any[]} */ ([]);
  const seen = new Set();
  const pushCandidate = (value) => {
    const normalized = String(value ?? '').trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    orderedCandidates.push(normalized);
  };

  for (const key of resolveAuthValidationSamplePriority(inputUrl, siteProfile)) {
    pushCandidate(samples?.[key]);
  }
  for (const value of Object.values(samples ?? {})) {
    pushCandidate(value);
  }
  pushCandidate(resolvedAuthConfig?.postLoginUrl);
  pushCandidate(inputUrl);

  return orderedCandidates[0] ?? (String(inputUrl ?? '').trim() || null);
}

export function resolveAuthKeepaliveUrl(inputUrl, authProfile = null, authConfig = null) {
  const siteProfile = authProfile?.profile ?? null;
  const resolvedAuthConfig = authConfig ?? buildResolvedAuthConfig(siteProfile);
  const preferred = String(resolvedAuthConfig?.keepaliveUrl ?? '').trim();
  if (preferred) {
    return preferred;
  }

  const verificationUrl = resolveAuthVerificationUrl(inputUrl, authProfile, resolvedAuthConfig);
  if (verificationUrl) {
    return verificationUrl;
  }

  return String(resolvedAuthConfig?.postLoginUrl ?? '').trim() || String(inputUrl ?? '').trim() || null;
}

export function isAuthRequiredNavigationTarget(inputUrl, { authConfig = null, siteProfile = null } = /** @type {any} */ ({})) {
  const resolvedAuthConfig = authConfig ?? buildResolvedAuthConfig(siteProfile);
  const pathname = readPathname(inputUrl);
  if (!resolvedAuthConfig?.authRequiredPathPrefixes?.length || !pathname) {
    return false;
  }
  return resolvedAuthConfig.authRequiredPathPrefixes.some((prefix) => isPathFamilyMatch(pathname, prefix));
}

export function shouldUsePersistentProfileForNavigation(inputUrl, settings = /** @type {any} */ ({}), context = /** @type {any} */ ({})) {
  if (context.reuseLoginState !== true) {
    return false;
  }
  if (settings?.userDataDir) {
    return true;
  }
  const resolvedAuthConfig = context.authConfig ?? buildResolvedAuthConfig(context.siteProfile ?? null);
  if (isXiaohongshuHostValue(resolvedAuthConfig?.host ?? context.siteProfile?.host)) {
    return isAuthRequiredNavigationTarget(inputUrl, {
      authConfig: resolvedAuthConfig,
      siteProfile: context.siteProfile ?? null,
    });
  }
  return true;
}

export function shouldEnsureAuthenticatedNavigationSession(inputUrl, settings = /** @type {any} */ ({}), context = /** @type {any} */ ({})) {
  const resolvedAuthConfig = context.authConfig ?? buildResolvedAuthConfig(context.siteProfile ?? null);
  if (!resolvedAuthConfig?.loginUrl) {
    return false;
  }
  if (settings?.autoLogin === true) {
    return true;
  }
  if (!isXiaohongshuHostValue(resolvedAuthConfig.host ?? context.siteProfile?.host)) {
    return Boolean(context.reuseLoginState || resolvedAuthConfig.autoLoginByDefault);
  }
  return isAuthRequiredNavigationTarget(inputUrl, {
    authConfig: resolvedAuthConfig,
    siteProfile: context.siteProfile ?? null,
  }) && Boolean(context.reuseLoginState || resolvedAuthConfig.autoLoginByDefault);
}

async function pageInspectLoginState(config) {
  const normalize = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
  const selectors = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
  const isXiaohongshu = /(^|\.)xiaohongshu\.com$/iu.test(String(config?.host ?? window.location.hostname ?? ''));
  const isVisible = (node) => {
    if (!(node instanceof Element)) {
      return false;
    }
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) {
      return false;
    }
    const rect = node.getBoundingClientRect();
    return rect.width >= 4 && rect.height >= 4;
  };
  const firstVisible = (selectorList) => {
    for (const selector of selectors(selectorList)) {
      try {
        const node = document.querySelector(selector);
        if (isVisible(node)) {
          return { node, selector };
        }
      } catch {
        // Ignore invalid selectors and keep checking.
      }
    }
    return null;
  };
  const currentUrl = window.location.href;
  const title = document.title || '';
  const loginIndicator = firstVisible(config.loginIndicatorSelectors);
  const loggedOutIndicator = firstVisible(config.loggedOutIndicatorSelectors);
  const usernameInput = firstVisible(config.usernameSelectors);
  const passwordInput = firstVisible(config.passwordSelectors);
  const challengeNode = firstVisible(config.challengeSelectors);
  const challengeText = challengeNode ? normalize(challengeNode.node.textContent || challengeNode.node.getAttribute?.('placeholder') || '') : null;
  const onLoginPage = Boolean(config.loginUrl && currentUrl.startsWith(config.loginUrl));
  let xiaohongshuAuthProbe = null;
  if (isXiaohongshu) {
    try {
      const response = await fetch('https://edith.xiaohongshu.com/api/sns/web/v2/user/me', {
        credentials: 'include',
      });
      const text = await response.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      const userId = normalize(body?.data?.user_id || body?.data?.userId || '');
      xiaohongshuAuthProbe = {
        status: response.status,
        ok: response.ok,
        guest: Boolean(body?.data?.guest),
        userId: userId || null,
      };
      if (response.ok && xiaohongshuAuthProbe.guest === true) {
        return {
          currentUrl,
          title,
          onLoginPage,
          loggedIn: false,
          loginStateDetected: false,
          identityConfirmed: false,
          identitySource: 'api:v2-user-me:guest',
          hasLoginForm: Boolean(usernameInput?.node && passwordInput?.node),
          hasChallenge: Boolean(challengeNode?.node),
          challengeText,
          xiaohongshuAuthProbe,
        };
      }
      if (response.ok && xiaohongshuAuthProbe.guest === false && xiaohongshuAuthProbe.userId) {
        return {
          currentUrl,
          title,
          onLoginPage,
          loggedIn: true,
          loginStateDetected: true,
          identityConfirmed: true,
          identitySource: 'api:v2-user-me',
          hasLoginForm: Boolean(usernameInput?.node && passwordInput?.node),
          hasChallenge: Boolean(challengeNode?.node),
          challengeText,
          xiaohongshuAuthProbe,
        };
      }
    } catch (error) {
      xiaohongshuAuthProbe = {
        status: null,
        ok: false,
        guest: null,
        userId: null,
        error: normalize(error?.message ?? String(error)),
      };
    }
  }
  const heuristicLoggedIn = !loggedOutIndicator && !usernameInput && !passwordInput && !onLoginPage;
  const loggedIn = Boolean(loginIndicator) || heuristicLoggedIn;
  const identityConfirmed = Boolean(loginIndicator);
  const identitySource = loginIndicator
    ? `selector:${loginIndicator.selector}`
    : heuristicLoggedIn
      ? 'heuristic:no-login-form-or-logged-out-indicator'
      : null;

  return {
    currentUrl,
    title,
    onLoginPage,
    loggedIn,
    loginStateDetected: loggedIn,
    identityConfirmed,
    identitySource,
    hasLoginForm: Boolean(usernameInput?.node && passwordInput?.node),
    hasChallenge: Boolean(challengeNode?.node),
    challengeText,
    xiaohongshuAuthProbe,
  };
}

function isConfirmedLoginState(loginState) {
  return loginState?.identityConfirmed === true;
}

async function assistManualLoginStep(session, authConfig) {
  return await session.callPageFunction(pageAssistManualLoginStep, {
    usernameSelectors: authConfig.usernameSelectors,
    passwordSelectors: authConfig.passwordSelectors,
    challengeSelectors: authConfig.challengeSelectors,
  });
}

function dedupeSortedStrings(values) {
  return [...new Set((values ?? []).map((value) => String(value ?? '').trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'en'));
}

function buildAcceptLanguage(navigatorInfo = /** @type {any} */ ({})) {
  const languages = Array.isArray(navigatorInfo.languages)
    ? navigatorInfo.languages.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
  if (languages.length > 0) {
    return languages.join(',');
  }
  return String(navigatorInfo.language ?? '').trim();
}

function normalizeCookieDomain(value) {
  return normalizeComparableHost(String(value ?? '').replace(/^\./u, ''));
}

function buildCookieHostCandidates(...values) {
  const candidates = new Set();
  for (const value of values) {
    let host = '';
    try {
      host = new URL(String(value ?? '')).hostname;
    } catch {
      host = String(value ?? '').trim();
    }
    const normalizedHost = normalizeComparableHost(host);
    if (!normalizedHost) {
      continue;
    }
    candidates.add(normalizedHost);
    const parts = normalizedHost.split('.').filter(Boolean);
    if (parts.length >= 2) {
      candidates.add(parts.slice(-2).join('.'));
    }
  }
  return [...candidates];
}

function cookieMatchesHost(cookieDomain, host) {
  return cookieDomain === host
    || cookieDomain.endsWith(`.${host}`)
    || host.endsWith(`.${cookieDomain}`);
}

function filterCookiesForHosts(cookies, hosts) {
  const normalizedHosts = dedupeSortedStrings(hosts);
  const filtered = /** @type {any[]} */ ([]);
  const seen = new Set();
  for (const cookie of Array.isArray(cookies) ? cookies : []) {
    const name = String(cookie?.name ?? '').trim();
    const domain = normalizeCookieDomain(cookie?.domain);
    const cookiePath = String(cookie?.path ?? '/').trim() || '/';
    if (!name || !domain || !normalizedHosts.some((host) => cookieMatchesHost(domain, host))) {
      continue;
    }
    const key = `${domain}\t${cookiePath}\t${name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    filtered.push({
      ...cookie,
      name,
      domain: String(cookie?.domain ?? '').trim(),
      path: cookiePath,
      value: String(cookie?.value ?? ''),
    });
  }
  return filtered.sort((left, right) => {
    const leftKey = `${normalizeCookieDomain(left.domain)}\t${left.path}\t${left.name}`;
    const rightKey = `${normalizeCookieDomain(right.domain)}\t${right.path}\t${right.name}`;
    return leftKey.localeCompare(rightKey, 'en');
  });
}

function buildCookieHeader(cookies) {
  return (Array.isArray(cookies) ? cookies : [])
    .map((cookie) => {
      const name = String(cookie?.name ?? '').trim();
      if (!name) {
        return '';
      }
      return `${name}=${String(cookie?.value ?? '')}`;
    })
    .filter(Boolean)
    .join('; ');
}

function toFileStem(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    || 'site-download';
}

function deriveOrigin(value) {
  try {
    const parsed = new URL(String(value ?? ''));
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
  } catch {
    // Ignore invalid origins.
  }
  return null;
}

function pageReadDownloadPassthroughContext() {
  return {
    navigatorUserAgent: navigator.userAgent || '',
    navigatorLanguage: navigator.language || '',
    navigatorLanguages: Array.isArray(navigator.languages) ? navigator.languages : [],
    navigatorPlatform: navigator.platform || '',
    locationHref: location.href || '',
    locationOrigin: location.origin || '',
    documentReferrer: document.referrer || '',
    documentTitle: document.title || '',
  };
}

function createDownloadPassthroughResult(overrides = /** @type {any} */ ({})) {
  return {
    available: false,
    reasonCode: null,
    passthroughMode: 'unavailable',
    sessionProfileAvailable: false,
    cookieHeaderAvailable: false,
    cookieCount: 0,
    cookieNames: [],
    cookieDomains: [],
    headerNames: [],
    sidecarPath: null,
    cookieFile: null,
    userDataDir: null,
    verificationUrl: null,
    currentUrl: null,
    title: null,
    loginStateDetected: false,
    identityConfirmed: false,
    identitySource: null,
    env: {},
    error: null,
    ...overrides,
  };
}

function buildDownloadPassthroughEnv(envToken, payload = /** @type {any} */ ({})) {
  const normalizedToken = normalizeHostToken(envToken).replace(/_COM$/u, '') || 'SITE';
  const env = /** @type {any} */ ({});
  if (payload.sidecarPath) {
    env[`BWS_${normalizedToken}_DOWNLOAD_AUTH_SIDECAR`] = payload.sidecarPath;
  }
  if (payload.passthroughMode) {
    env[`BWS_${normalizedToken}_DOWNLOAD_PASSTHROUGH_MODE`] = payload.passthroughMode;
  }
  return env;
}

async function pageAttemptCredentialLogin(config, credentials) {
  const selectors = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
  const normalize = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isVisible = (node) => {
    if (!(node instanceof Element)) {
      return false;
    }
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) {
      return false;
    }
    const rect = node.getBoundingClientRect();
    return rect.width >= 4 && rect.height >= 4;
  };
  const firstVisible = (selectorList) => {
    for (const selector of selectors(selectorList)) {
      try {
        const node = document.querySelector(selector);
        if (isVisible(node)) {
          return { node, selector };
        }
      } catch {
        // Ignore invalid selectors.
      }
    }
    return null;
  };
  const clickNode = (node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    node.focus?.();
    const events = ['mouseover', 'mousedown', 'mouseup', 'click'];
    for (const eventName of events) {
      node.dispatchEvent(new MouseEvent(eventName, { bubbles: true }));
    }
    node.click?.();
    return true;
  };
  const setInputValue = (input, value) => {
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    input.focus();
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const clickVisible = (selectorList) => {
    const match = firstVisible(selectorList);
    if (!match?.node) {
      return false;
    }
    return clickNode(match.node);
  };
  const submitWithEnter = (input) => {
    if (!(input instanceof HTMLElement)) {
      return false;
    }
    input.focus?.();
    for (const eventName of ['keydown', 'keypress', 'keyup']) {
      input.dispatchEvent(new KeyboardEvent(eventName, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
      }));
    }
    return true;
  };

  const ensureCredentialForm = async () => {
    let activated = false;
    const hasFields = () => Boolean(firstVisible(config.usernameSelectors)?.node && firstVisible(config.passwordSelectors)?.node);
    if (hasFields()) {
      return activated;
    }

    if (clickVisible(config.loginEntrySelectors)) {
      activated = true;
      await delay(350);
    }
    if (!firstVisible(config.passwordSelectors)?.node && clickVisible(config.passwordLoginTabSelectors)) {
      activated = true;
      await delay(350);
    }
    if (!hasFields() && clickVisible(config.loggedOutIndicatorSelectors)) {
      activated = true;
      await delay(350);
    }
    if (!firstVisible(config.passwordSelectors)?.node && clickVisible(config.passwordLoginTabSelectors)) {
      activated = true;
      await delay(350);
    }
    return activated;
  };

  await ensureCredentialForm();

  const usernameInput = firstVisible(config.usernameSelectors)?.node ?? null;
  const passwordInput = firstVisible(config.passwordSelectors)?.node ?? null;
  const challengeNode = firstVisible(config.challengeSelectors)?.node ?? null;
  if (!(usernameInput instanceof HTMLInputElement) || !(passwordInput instanceof HTMLInputElement)) {
    return {
      status: 'fields-not-found',
      hasChallenge: Boolean(challengeNode),
      challengeText: challengeNode ? normalize(challengeNode.textContent || challengeNode.getAttribute?.('placeholder') || '') : null,
    };
  }

  setInputValue(usernameInput, credentials.username);
  setInputValue(passwordInput, credentials.password);

  const submitNode = firstVisible(config.submitSelectors)?.node ?? null;
  const challengeText = challengeNode ? normalize(challengeNode.textContent || challengeNode.getAttribute?.('placeholder') || '') : null;
  if (challengeNode) {
    return {
      status: 'challenge-required',
      hasChallenge: true,
      challengeText,
    };
  }

  if (!(submitNode instanceof HTMLElement)) {
    if (submitWithEnter(passwordInput)) {
      return {
        status: 'submitted',
        hasChallenge: false,
        challengeText,
      };
    }
    return {
      status: 'submit-not-found',
      hasChallenge: false,
      challengeText,
    };
  }

  const disabled = submitNode.hasAttribute('disabled')
    || submitNode.getAttribute('aria-disabled') === 'true'
    || String(submitNode.className || '').includes('disabled');
  if (disabled) {
    return {
      status: 'submit-disabled',
      hasChallenge: false,
      challengeText,
    };
  }

  submitNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  submitNode.click?.();
  return {
    status: 'submitted',
    hasChallenge: false,
    challengeText,
  };
}

function redactionAuditPath(filePath) {
  const resolved = path.resolve(filePath);
  if (/\.json$/iu.test(resolved)) {
    return resolved.replace(/\.json$/iu, '.redaction-audit.json');
  }
  return `${resolved}.redaction-audit.json`;
}

async function writeRedactedDownloadPassthroughSummary(filePath, payload) {
  const prepared = prepareRedactedArtifactJsonWithAudit(payload);
  const auditPath = redactionAuditPath(filePath);
  await ensureDir(path.dirname(filePath));
  await ensureDir(path.dirname(auditPath));
  await writeTextFile(auditPath, prepared.auditJson);
  await writeTextFile(filePath, prepared.json);
  return {
    filePath,
    auditPath,
    value: prepared.value,
  };
}

export async function pageAssistManualLoginStep(config) {
  const selectors = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
  const normalize = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
  const isVisible = (node) => {
    if (!(node instanceof Element)) {
      return false;
    }
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) {
      return false;
    }
    const rect = node.getBoundingClientRect();
    return rect.width >= 4 && rect.height >= 4;
  };
  const firstVisible = (selectorList) => {
    for (const selector of selectors(selectorList)) {
      try {
        const node = document.querySelector(selector);
        if (isVisible(node)) {
          return { node, selector };
        }
      } catch {
        // Ignore invalid selectors.
      }
    }
    return null;
  };
  const clickNode = (node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    node.focus?.();
    for (const eventName of ['mouseover', 'mousedown', 'mouseup', 'click']) {
      node.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true }));
    }
    node.click?.();
    return true;
  };
  const submitWithEnter = (input) => {
    if (!(input instanceof HTMLElement)) {
      return false;
    }
    input.focus?.();
    for (const eventName of ['keydown', 'keypress', 'keyup']) {
      input.dispatchEvent(new KeyboardEvent(eventName, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      }));
    }
    return true;
  };

  const passwordInput = firstVisible(config.passwordSelectors)?.node ?? null;
  if (passwordInput instanceof HTMLInputElement) {
    return { status: 'password-visible' };
  }

  const usernameMatch = firstVisible(config.usernameSelectors);
  const usernameInput = usernameMatch?.node ?? null;
  const challengeNode = firstVisible(config.challengeSelectors)?.node ?? null;
  const challengeIsUsernameStep = usernameInput instanceof HTMLInputElement
    && (challengeNode === usernameInput || challengeNode?.contains?.(usernameInput));
  if (challengeNode && !challengeIsUsernameStep) {
    return {
      status: 'challenge-visible',
      challengeText: normalize(challengeNode.textContent || challengeNode.getAttribute?.('placeholder') || ''),
    };
  }

  if (!(usernameInput instanceof HTMLInputElement)) {
    return { status: 'username-not-visible' };
  }
  if (!normalize(usernameInput.value)) {
    return { status: 'username-empty', selector: usernameMatch.selector };
  }

  const buttonCandidates = Array.from(document.querySelectorAll('button, div[role="button"], [data-testid]'))
    .filter(isVisible)
    .filter((node) => {
      const text = normalize(node.textContent || node.getAttribute?.('aria-label') || node.getAttribute?.('data-testid') || '');
      if (!text) {
        return false;
      }
      return /^(next|continue)$/iu.test(text)
        || /^(下一步|继续|繼續|次へ)$/iu.test(text)
        || /next/iu.test(text)
        || /continue/iu.test(text)
        || /下一步|继续|繼續|次へ/iu.test(text)
        || /LoginForm_Login_Button/u.test(text);
    });

  for (const node of buttonCandidates) {
    const disabled = node.hasAttribute?.('disabled')
      || node.getAttribute?.('aria-disabled') === 'true'
      || String(node.className || '').includes('disabled');
    if (disabled) {
      continue;
    }
    if (clickNode(node)) {
      return {
        status: 'next-clicked',
        selector: usernameMatch.selector,
        buttonText: normalize(node.textContent || node.getAttribute?.('aria-label') || node.getAttribute?.('data-testid') || ''),
      };
    }
  }

  if (submitWithEnter(usernameInput)) {
    return {
      status: 'next-submitted-with-enter',
      selector: usernameMatch.selector,
    };
  }

  return { status: 'next-control-not-found', selector: usernameMatch.selector };
}

export async function resolveSiteAuthProfile(inputUrl, options = /** @type {any} */ ({})) {
  if (options.siteProfile) {
    return {
      profile: options.siteProfile,
      warnings: [],
      filePath: options.profilePath ? path.resolve(options.profilePath) : null,
    };
  }
  if (options.profilePath) {
    return await validateProfileFile(path.resolve(options.profilePath));
  }
  return await maybeLoadValidatedProfileForUrl(inputUrl);
}

export async function resolveSiteBrowserSessionOptions(inputUrl, settings = /** @type {any} */ ({}), options = /** @type {any} */ ({})) {
  const authProfile = options.authProfile ?? await resolveSiteAuthProfile(inputUrl, options);
  const siteProfile = authProfile?.profile ?? null;
  const authConfig = buildResolvedAuthConfig(siteProfile);
  const explicitUserDataDir = settings.userDataDir ? path.resolve(settings.userDataDir) : null;
  const reuseLoginState = typeof settings.reuseLoginState === 'boolean'
    ? settings.reuseLoginState
    : Boolean(authConfig?.reuseLoginStateByDefault);
  const userDataDir = explicitUserDataDir
    || (reuseLoginState ? resolvePersistentUserDataDir(siteProfile?.host ?? inputUrl, { rootDir: settings.browserProfileRoot }) : null);

  return {
    authProfile,
    siteProfile,
    authConfig,
    reuseLoginState,
    userDataDir,
    cleanupUserDataDirOnShutdown: !userDataDir,
  };
}

function hasNoMissingProfilePaths(profileHealth) {
  return profileHealth.exists === true
    && Array.isArray(profileHealth.missingPaths)
    && profileHealth.missingPaths.length === 0;
}

function resolveReusableSessionSignals({ authConfig = null, siteProfile = null } = /** @type {any} */ ({})) {
  const resolvedAuthConfig = authConfig ?? buildResolvedAuthConfig(siteProfile);
  if (resolvedAuthConfig?.reusableSessionSignals?.length) {
    return resolvedAuthConfig.reusableSessionSignals;
  }
  return ['usableForCookies'];
}

export function isReusableLoginStateAvailable(profileHealth, { authConfig = null, siteProfile = null } = /** @type {any} */ ({})) {
  if (!profileHealth || typeof profileHealth !== 'object') {
    return false;
  }

  for (const signal of resolveReusableSessionSignals({ authConfig, siteProfile })) {
    switch (signal) {
      case 'usableForCookies':
        if (profileHealth.usableForCookies === true) {
          return true;
        }
        break;
      case 'healthy':
        if (profileHealth.healthy === true) {
          return true;
        }
        break;
      case 'loginStateLikelyAvailable':
        if (profileHealth.loginStateLikelyAvailable === true) {
          return true;
        }
        break;
      case 'presentWithoutMissingPaths':
        if (hasNoMissingProfilePaths(profileHealth)) {
          return true;
        }
        break;
      default:
        break;
    }
  }
  return false;
}

export async function inspectReusableSiteSession(inputUrl, settings = /** @type {any} */ ({}), options = /** @type {any} */ ({}), deps = /** @type {any} */ ({})) {
  const sessionOptions = await (deps.resolveSiteBrowserSessionOptions ?? resolveSiteBrowserSessionOptions)(
    inputUrl,
    settings,
    options,
  );
  const profileHealth = sessionOptions.userDataDir
    ? await (deps.inspectPersistentProfileHealth ?? inspectPersistentProfileHealth)(sessionOptions.userDataDir)
    : null;
  const authAvailable = Boolean(
    sessionOptions.reuseLoginState
    && isReusableLoginStateAvailable(profileHealth, {
      authConfig: sessionOptions.authConfig ?? null,
      siteProfile: sessionOptions.siteProfile ?? null,
    }),
  );

  return {
    authAvailable,
    reusableProfile: authAvailable,
    userDataDir: sessionOptions.userDataDir ?? null,
    profileHealth,
    profilePath: sessionOptions.authProfile?.filePath ?? null,
    authProfile: sessionOptions.authProfile ?? null,
    siteProfile: sessionOptions.siteProfile ?? null,
    authConfig: sessionOptions.authConfig ?? null,
    reuseLoginState: sessionOptions.reuseLoginState === true,
    cleanupUserDataDirOnShutdown: sessionOptions.cleanupUserDataDirOnShutdown === true,
    sessionOptions,
  };
}

export async function exportDownloadSessionPassthrough(session, inputUrl, authContext = /** @type {any} */ ({}), options = /** @type {any} */ ({}), _deps = /** @type {any} */ ({})) {
  const authProfile = authContext.authProfile ?? null;
  const authConfig = authContext.authConfig ?? null;
  const siteProfile = authContext.siteProfile ?? null;
  const verificationUrl = resolveAuthVerificationUrl(inputUrl, authProfile, authConfig)
    || String(authConfig?.postLoginUrl ?? '').trim()
    || String(inputUrl ?? '').trim()
    || null;
  const userDataDir = authContext.userDataDir ? path.resolve(authContext.userDataDir) : null;
  const loginState = options.loginState ?? null;
  const sessionProfileAvailable = Boolean(userDataDir && authContext.reuseLoginState === true);
  if (!sessionProfileAvailable) {
    return createDownloadPassthroughResult({
      reasonCode: authContext.reuseLoginState === true ? 'missing-user-data-dir' : 'reuse-login-state-disabled',
      userDataDir,
      verificationUrl,
      loginStateDetected: loginState?.loginStateDetected === true || loginState?.loggedIn === true,
      identityConfirmed: loginState?.identityConfirmed === true,
      identitySource: loginState?.identitySource ?? null,
    });
  }

  const pageContext = await session.callPageFunction(pageReadDownloadPassthroughContext);
  const cookiesResult = await session.send('Storage.getCookies');
  const hostCandidates = buildCookieHostCandidates(
    inputUrl,
    verificationUrl,
    authConfig?.postLoginUrl,
    authConfig?.loginUrl,
    siteProfile?.host,
  );
  const cookies = filterCookiesForHosts(cookiesResult?.cookies, hostCandidates);
  const cookieHeader = buildCookieHeader(cookies);
  const navigatorInfo = {
    userAgent: String(pageContext?.navigatorUserAgent ?? '').trim(),
    language: String(pageContext?.navigatorLanguage ?? '').trim(),
    languages: Array.isArray(pageContext?.navigatorLanguages) ? pageContext.navigatorLanguages : [],
    platform: String(pageContext?.navigatorPlatform ?? '').trim(),
  };
  const currentUrl = String(pageContext?.locationHref ?? '').trim()
    || String(verificationUrl ?? '').trim()
    || String(inputUrl ?? '').trim()
    || null;
  const origin = String(pageContext?.locationOrigin ?? '').trim()
    || deriveOrigin(currentUrl)
    || deriveOrigin(verificationUrl)
    || deriveOrigin(inputUrl);
  const headers = /** @type {any} */ ({});
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }
  if (navigatorInfo.userAgent) {
    headers['User-Agent'] = navigatorInfo.userAgent;
  }
  const acceptLanguage = buildAcceptLanguage(navigatorInfo);
  if (acceptLanguage) {
    headers['Accept-Language'] = acceptLanguage;
  }
  if (currentUrl) {
    headers.Referer = currentUrl;
  }
  if (origin) {
    headers.Origin = origin;
  }

  const loginStateDetected = loginState?.loginStateDetected === true || loginState?.loggedIn === true;
  const identityConfirmed = loginState?.identityConfirmed === true;
  const available = sessionProfileAvailable && (cookieHeader.length > 0 || loginStateDetected || identityConfirmed);
  const passthroughMode = cookieHeader.length > 0
    ? 'cookie-header'
    : sessionProfileAvailable
      ? 'browser-profile'
      : 'unavailable';
  const artifactStem = toFileStem(options.artifactStem ?? options.siteKey ?? siteProfile?.host ?? inputUrl);
  const sidecarPath = path.join(userDataDir, DOWNLOAD_AUTH_STATE_DIR, `${artifactStem}-auth-summary.json`);
  let sidecarRedactionAuditPath = null;

  if (available) {
    const sidecarPayload = {
      ok: true,
      generatedAt: new Date().toISOString(),
      inputUrl: String(inputUrl ?? '').trim() || null,
      verificationUrl,
      userDataDirPresent: Boolean(userDataDir),
      passthroughMode: 'redacted-session-view',
      rawExportSuppressed: true,
      cookieCount: cookies.length,
      cookieNames: dedupeSortedStrings(cookies.map((cookie) => cookie.name)),
      cookieDomains: dedupeSortedStrings(cookies.map((cookie) => cookie.domain)),
      headerNames: dedupeSortedStrings(Object.keys(headers)),
      page: {
        url: currentUrl,
        origin,
        referrer: String(pageContext?.documentReferrer ?? '').trim() || null,
        title: String(pageContext?.documentTitle ?? '').trim() || null,
      },
      navigator: navigatorInfo,
      auth: {
        loginStateDetected,
        identityConfirmed,
        identitySource: loginState?.identitySource ?? null,
      },
    };
    const writeResult = await writeRedactedDownloadPassthroughSummary(sidecarPath, sidecarPayload);
    sidecarRedactionAuditPath = writeResult.auditPath;
  }

  return createDownloadPassthroughResult({
    available,
    reasonCode: available ? null : 'not-logged-in',
    passthroughMode: available ? 'redacted-session-view' : passthroughMode,
    sessionProfileAvailable,
    cookieHeaderAvailable: cookieHeader.length > 0,
    cookieCount: cookies.length,
    cookieNames: dedupeSortedStrings(cookies.map((cookie) => cookie.name)),
    cookieDomains: dedupeSortedStrings(cookies.map((cookie) => cookie.domain)),
    headerNames: dedupeSortedStrings(Object.keys(headers)),
    sidecarPath: available ? sidecarPath : null,
    cookieFile: null,
    sidecarRedactionAuditPath,
    userDataDir: null,
    userDataDirPresent: Boolean(userDataDir),
    verificationUrl,
    currentUrl,
    title: String(pageContext?.documentTitle ?? '').trim() || null,
    loginStateDetected,
    identityConfirmed,
    identitySource: loginState?.identitySource ?? null,
    env: available
      ? buildDownloadPassthroughEnv(options.envToken ?? options.siteKey ?? siteProfile?.host ?? inputUrl, {
          sidecarPath,
          passthroughMode: 'redacted-session-view',
        })
      : {},
  });
}

export async function exportSiteDownloadPassthrough(inputUrl, settings = /** @type {any} */ ({}), options = /** @type {any} */ ({}), deps = /** @type {any} */ ({})) {
  const authContext = options.authContext ?? await (deps.resolveSiteBrowserSessionOptions ?? resolveSiteBrowserSessionOptions)(
    inputUrl,
    settings,
    options,
  );
  const authConfig = authContext?.authConfig ?? null;
  if (!authConfig?.loginUrl) {
    return createDownloadPassthroughResult({
      reasonCode: 'unsupported',
      userDataDir: authContext?.userDataDir ?? null,
      verificationUrl: resolveAuthVerificationUrl(inputUrl, authContext?.authProfile ?? null, authConfig),
    });
  }
  if (authContext.reuseLoginState !== true) {
    return createDownloadPassthroughResult({
      reasonCode: 'reuse-login-state-disabled',
      userDataDir: authContext.userDataDir ?? null,
      verificationUrl: resolveAuthVerificationUrl(inputUrl, authContext.authProfile ?? null, authConfig),
    });
  }
  if (!authContext.userDataDir) {
    return createDownloadPassthroughResult({
      reasonCode: 'missing-user-data-dir',
      verificationUrl: resolveAuthVerificationUrl(inputUrl, authContext.authProfile ?? null, authConfig),
    });
  }

  const probeUrl = resolveAuthVerificationUrl(inputUrl, authContext.authProfile ?? null, authConfig)
    || authConfig.postLoginUrl
    || inputUrl;
  let session = options.session ?? null;
  const createdSession = !session;
  try {
    if (!session) {
      const prefersVisibleAuthFlow = authConfig.preferVisibleBrowserForAuthenticatedFlows === true;
      session = await (deps.openBrowserSession ?? openBrowserSession)({
        browserPath: settings.browserPath,
        headless: prefersVisibleAuthFlow ? false : settings.headless,
        timeoutMs: settings.timeoutMs,
        fullPage: false,
        viewport: {
          width: 1440,
          height: 900,
          deviceScaleFactor: 1,
        },
        userDataDir: authContext.userDataDir,
        cleanupUserDataDirOnShutdown: authContext.cleanupUserDataDirOnShutdown,
        startupUrl: probeUrl,
      }, {
        userDataDirPrefix: 'site-download-auth-',
      });
    }

    if (options.navigate !== false) {
      await session.navigateAndWait(probeUrl, buildAuthWaitPolicy(Math.min(settings.timeoutMs ?? 30_000, 12_000)));
    }
    const loginState = options.loginState ?? await (deps.inspectLoginState ?? inspectLoginState)(session, authConfig);
    return await exportDownloadSessionPassthrough(session, inputUrl, authContext, {
      ...options,
      loginState,
    }, deps);
  } catch (error) {
    return createDownloadPassthroughResult({
      reasonCode: 'probe-failed',
      userDataDir: authContext.userDataDir ?? null,
      verificationUrl: probeUrl,
      error: error?.message ?? String(error),
    });
  } finally {
    if (createdSession && session) {
      await session.close();
    }
  }
}

export async function inspectLoginState(session, authConfig) {
  return await session.callPageFunction(pageInspectLoginState, {
    host: authConfig.host,
    loginUrl: authConfig.loginUrl,
    loginIndicatorSelectors: authConfig.loginIndicatorSelectors,
    loggedOutIndicatorSelectors: authConfig.loggedOutIndicatorSelectors,
    usernameSelectors: authConfig.usernameSelectors,
    passwordSelectors: authConfig.passwordSelectors,
    challengeSelectors: authConfig.challengeSelectors,
  });
}

export async function waitForAuthenticatedSession(
  session,
  authConfig,
  {
    assistManualLogin = false,
    timeoutMs = DEFAULT_LOGIN_WAIT_TIMEOUT_MS,
    pollMs = 1_000,
  } = /** @type {any} */ ({}),
) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  let lastError = null;
  while (Date.now() < deadline) {
    if (assistManualLogin) {
      try {
        await assistManualLoginStep(session, authConfig);
      } catch {
        // Manual login assistance is best effort; keep polling for completed auth.
      }
    }
    try {
      lastState = await inspectLoginState(session, authConfig);
      lastError = null;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      continue;
    }
    if (isConfirmedLoginState(lastState)) {
      return {
        status: 'authenticated',
        loginState: lastState,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  return {
    status: 'timeout',
    loginState: lastState,
    error: lastError,
  };
}

export async function attemptCredentialLogin(session, authConfig, credentials, settings = /** @type {any} */ ({})) {
  const loginUrl = authConfig?.loginUrl;
  if (!loginUrl) {
    return {
      status: 'unsupported',
      reason: 'Missing authSession.loginUrl',
    };
  }

  await session.navigateAndWait(loginUrl, buildAuthWaitPolicy(settings.timeoutMs ?? 30_000));
  const attempt = await session.callPageFunction(pageAttemptCredentialLogin, {
    loginEntrySelectors: authConfig.loginEntrySelectors.length > 0
      ? authConfig.loginEntrySelectors
      : authConfig.loggedOutIndicatorSelectors,
    loggedOutIndicatorSelectors: authConfig.loggedOutIndicatorSelectors,
    passwordLoginTabSelectors: authConfig.passwordLoginTabSelectors,
    usernameSelectors: authConfig.usernameSelectors,
    passwordSelectors: authConfig.passwordSelectors,
    submitSelectors: authConfig.submitSelectors,
    challengeSelectors: authConfig.challengeSelectors,
  }, credentials);

  if (attempt?.status !== 'submitted') {
    return attempt;
  }

  await session.waitForSettled(buildAuthWaitPolicy(Math.min(settings.timeoutMs ?? 30_000, 12_000)));
  if (authConfig.postLoginUrl) {
    try {
      await session.navigateAndWait(authConfig.postLoginUrl, buildAuthWaitPolicy(Math.min(settings.timeoutMs ?? 30_000, 12_000)));
    } catch {
      // Keep the current page if navigation is blocked by an intermediate verification step.
    }
  }

  const waited = await waitForAuthenticatedSession(session, authConfig, {
    timeoutMs: Math.min(20_000, settings.timeoutMs ?? 30_000),
    pollMs: 800,
  });
  return {
    ...attempt,
    waitStatus: waited.status,
    loginState: waited.loginState ?? null,
  };
}

export async function ensureAuthenticatedSession(session, inputUrl, settings = /** @type {any} */ ({}), options = /** @type {any} */ ({})) {
  const { authProfile, authConfig } = options.authContext
    ? options.authContext
    : await resolveSiteBrowserSessionOptions(inputUrl, settings, options);

  if (!authConfig?.loginUrl) {
    return {
      status: 'unsupported',
      authProfile,
      authConfig,
      loginState: null,
      credentials: null,
    };
  }

  let initialState = await inspectLoginState(session, authConfig);
  const currentUrl = normalizeComparableUrl(initialState?.currentUrl);
  const postLoginUrl = normalizeComparableUrl(authConfig.postLoginUrl);
  const shouldNavigateToPostLogin = Boolean(
    authConfig.postLoginUrl
    && !initialState?.onLoginPage
    && currentUrl
    && postLoginUrl
    && currentUrl !== postLoginUrl,
  );

  if (shouldNavigateToPostLogin) {
    await session.navigateAndWait(authConfig.postLoginUrl, buildAuthWaitPolicy(settings.timeoutMs ?? 30_000));
    initialState = await inspectLoginState(session, authConfig);
  }
  if (
    !isConfirmedLoginState(initialState)
    && (initialState?.loginStateDetected === true || initialState?.loggedIn === true)
    && initialState?.hasLoginForm !== true
    && initialState?.hasChallenge !== true
  ) {
    const waited = await waitForAuthenticatedSession(session, authConfig, {
      timeoutMs: Math.min(20_000, settings.timeoutMs ?? 30_000),
      pollMs: 800,
    });
    initialState = waited.loginState ?? initialState;
  }
  if (isConfirmedLoginState(initialState)) {
    return {
      status: 'already-authenticated',
      authProfile,
      authConfig,
      loginState: initialState,
      credentials: null,
    };
  }

  const credentials = await resolveCredentialSource(authConfig, settings, options);
  const shouldAutoLogin = typeof settings.autoLogin === 'boolean'
    ? settings.autoLogin
    : Boolean(authConfig.autoLoginByDefault);
  if (!shouldAutoLogin || !credentials.available) {
    return {
      status: credentials.available ? 'unauthenticated' : 'credentials-unavailable',
      authProfile,
      authConfig,
      loginState: initialState,
      credentials,
    };
  }

  const attempt = await attemptCredentialLogin(session, authConfig, credentials, settings);
  const finalState = attempt.loginState ?? await inspectLoginState(session, authConfig);
  const normalizedChallengeText = normalizeText(attempt.challengeText);
  const attemptStatus = String(attempt.status ?? '');
  const authenticated = attempt.waitStatus === 'authenticated' || isConfirmedLoginState(finalState);

  return {
    status: authenticated ? 'authenticated' : attemptStatus || 'unauthenticated',
    authProfile,
    authConfig,
    loginState: finalState,
    credentials,
    challengeRequired: attemptStatus === 'challenge-required' || Boolean(normalizedChallengeText),
    challengeText: normalizedChallengeText || null,
  };
}
