import path from 'node:path';
import process from 'node:process';

import { validateProfileFile } from '../../sites/core/profile-validation.mjs';
import { maybeLoadValidatedProfileForUrl } from '../../sites/core/profiles.mjs';
import { resolvePersistentUserDataDir } from '../browser/profile-store.mjs';
import { normalizeText } from '../../shared/normalize.mjs';
import { getWindowsCredential, resolveWindowsCredentialTarget } from './windows-credential-manager.mjs';
import {
  DOUYIN_AUTH_VALIDATION_SAMPLE_PRIORITY,
  isDouyinSiteProfile,
} from '../../sites/douyin/model/site.mjs';

export const DEFAULT_LOGIN_WAIT_TIMEOUT_MS = 5 * 60_000;

const AUTH_READY_IDLE_MS = 250;

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

function normalizeComparableUrl(value) {
  try {
    return new URL(String(value ?? '')).toString();
  } catch {
    return String(value ?? '').trim();
  }
}

export async function resolveCredentialSource(authConfig, options = {}, deps = {}) {
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

function defaultLoggedOutSelectors() {
  return [
    '.go-login-btn',
    '.header-login-entry',
    '.login-btn',
    'a[href*="passport.bilibili.com/login"]',
  ];
}

function defaultLoggedInSelectors() {
  return [
    'a[href*="space.bilibili.com/"] img',
    '.bili-avatar img',
    '.header-entry-mini img',
    '.header-avatar-wrap--container img',
    '.v-img.avatar',
  ];
}

function defaultLoginEntrySelectors() {
  return [
    'button[aria-label*="登录"]',
    'button[class*="login"]',
    '[data-e2e*="login"]',
    '[class*="login"] button',
    '[class*="login"]',
  ];
}

function defaultPasswordLoginTabSelectors() {
  return [
    '.tabs_wp > div:first-child',
  ];
}

function defaultUsernameSelectors() {
  return [
    '.tab__form input[type="text"]:not(.body__captcha-input)',
    'input[placeholder*="账号"]',
    'input[name="username"]',
    'input[type="email"]',
  ];
}

function defaultPasswordSelectors() {
  return [
    '.tab__form input[type="password"]',
    'input[placeholder*="密码"]',
    'input[name="password"]',
  ];
}

function defaultSubmitSelectors() {
  return [
    '.btn_primary',
    'button[type="submit"]',
    'input[type="submit"]',
  ];
}

function defaultChallengeSelectors() {
  return [
    '.body__captcha-input',
    '[class*="captcha"]',
    '[class*="geetest"]',
    '[class*="verify"]',
    'input[placeholder*="图片"]',
  ];
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
    authRequiredAuthorSubpages: normalizeSelectors(authConfig.authRequiredAuthorSubpages),
    authRequiredPathPrefixes: normalizeSelectors(authConfig.authRequiredPathPrefixes),
  };
}

function resolveAuthValidationSamplePriority(inputUrl, siteProfile = null) {
  if (isDouyinSiteProfile(siteProfile, inputUrl)) {
    return DOUYIN_AUTH_VALIDATION_SAMPLE_PRIORITY;
  }
  return ['dynamicUrl', 'followListUrl', 'fansListUrl', 'favoriteListUrl', 'watchLaterUrl'];
}

export function resolveAuthVerificationUrl(inputUrl, authProfile = null, authConfig = null) {
  const siteProfile = authProfile?.profile ?? null;
  const resolvedAuthConfig = authConfig ?? buildResolvedAuthConfig(siteProfile);
  const preferred = String(resolvedAuthConfig?.verificationUrl ?? '').trim();
  if (preferred) {
    return preferred;
  }

  const samples = siteProfile?.authValidationSamples ?? {};
  const orderedCandidates = [];
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

function pageInspectLoginState(config) {
  const normalize = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
  const selectors = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
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
  };
}

function isConfirmedLoginState(loginState) {
  return loginState?.identityConfirmed === true;
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

export async function resolveSiteAuthProfile(inputUrl, options = {}) {
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

export async function resolveSiteBrowserSessionOptions(inputUrl, settings = {}, options = {}) {
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

export async function inspectLoginState(session, authConfig) {
  return await session.callPageFunction(pageInspectLoginState, {
    loginUrl: authConfig.loginUrl,
    loginIndicatorSelectors: authConfig.loginIndicatorSelectors.length > 0
      ? authConfig.loginIndicatorSelectors
      : defaultLoggedInSelectors(),
    loggedOutIndicatorSelectors: authConfig.loggedOutIndicatorSelectors.length > 0
      ? authConfig.loggedOutIndicatorSelectors
      : defaultLoggedOutSelectors(),
    usernameSelectors: authConfig.usernameSelectors.length > 0
      ? authConfig.usernameSelectors
      : defaultUsernameSelectors(),
    passwordSelectors: authConfig.passwordSelectors.length > 0
      ? authConfig.passwordSelectors
      : defaultPasswordSelectors(),
    challengeSelectors: authConfig.challengeSelectors.length > 0
      ? authConfig.challengeSelectors
      : defaultChallengeSelectors(),
  });
}

export async function waitForAuthenticatedSession(
  session,
  authConfig,
  {
    timeoutMs = DEFAULT_LOGIN_WAIT_TIMEOUT_MS,
    pollMs = 1_000,
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    try {
      lastState = await inspectLoginState(session, authConfig);
    } catch (error) {
      return {
        status: 'session-unavailable',
        loginState: lastState,
        error,
      };
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
  };
}

export async function attemptCredentialLogin(session, authConfig, credentials, settings = {}) {
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
      : (authConfig.loggedOutIndicatorSelectors.length > 0
        ? authConfig.loggedOutIndicatorSelectors
        : defaultLoginEntrySelectors()),
    loggedOutIndicatorSelectors: authConfig.loggedOutIndicatorSelectors.length > 0
      ? authConfig.loggedOutIndicatorSelectors
      : defaultLoggedOutSelectors(),
    passwordLoginTabSelectors: authConfig.passwordLoginTabSelectors.length > 0
      ? authConfig.passwordLoginTabSelectors
      : defaultPasswordLoginTabSelectors(),
    usernameSelectors: authConfig.usernameSelectors.length > 0
      ? authConfig.usernameSelectors
      : defaultUsernameSelectors(),
    passwordSelectors: authConfig.passwordSelectors.length > 0
      ? authConfig.passwordSelectors
      : defaultPasswordSelectors(),
    submitSelectors: authConfig.submitSelectors.length > 0
      ? authConfig.submitSelectors
      : defaultSubmitSelectors(),
    challengeSelectors: authConfig.challengeSelectors.length > 0
      ? authConfig.challengeSelectors
      : defaultChallengeSelectors(),
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

export async function ensureAuthenticatedSession(session, inputUrl, settings = {}, options = {}) {
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
