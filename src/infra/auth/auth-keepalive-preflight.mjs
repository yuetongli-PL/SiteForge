import {
  resolveSiteAuthProfile,
  resolveSiteBrowserSessionOptions,
} from './site-auth.mjs';
import {
  readAuthSessionState,
  summarizeAuthSessionState,
} from './site-session-governance.mjs';

export const DEFAULT_KEEPALIVE_PREFLIGHT_THRESHOLD_MINUTES = 15;

function normalizePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildKeepaliveDecision(sessionHealthSummary, thresholdMinutes) {
  if (!sessionHealthSummary) {
    return {
      shouldRun: false,
      trigger: null,
      reason: 'no-session-health',
    };
  }

  if (sessionHealthSummary.keepaliveDue === true) {
    return {
      shouldRun: true,
      trigger: 'keepalive-due',
      reason: 'keepalive-due',
    };
  }

  if (
    typeof sessionHealthSummary.minutesUntilSuggestedKeepalive === 'number'
    && sessionHealthSummary.minutesUntilSuggestedKeepalive <= thresholdMinutes
  ) {
    return {
      shouldRun: true,
      trigger: 'keepalive-window',
      reason: 'within-preflight-threshold',
    };
  }

  return {
    shouldRun: false,
    trigger: null,
    reason: sessionHealthSummary.nextSuggestedKeepaliveAt ? 'not-due' : 'no-keepalive-schedule',
  };
}

export async function maybeRunAuthenticatedKeepalivePreflight(inputUrl, options = {}, deps = {}) {
  const authProfile = deps.authProfile ?? await (deps.resolveSiteAuthProfile ?? resolveSiteAuthProfile)(inputUrl, {
    profilePath: options.profilePath,
    siteProfile: deps.siteProfile ?? null,
  });
  const authContext = deps.authContext ?? await (deps.resolveSiteBrowserSessionOptions ?? resolveSiteBrowserSessionOptions)(inputUrl, {
    profilePath: options.profilePath,
    browserProfileRoot: options.browserProfileRoot,
    userDataDir: options.userDataDir,
    reuseLoginState: options.reuseLoginState,
    autoLogin: options.autoLogin,
  }, {
    profilePath: options.profilePath,
    authProfile,
  });

  if (!authContext.authConfig?.loginUrl || !authContext.reuseLoginState || !authContext.userDataDir) {
    return {
      attempted: false,
      ran: false,
      reason: 'auth-session-unavailable',
      trigger: null,
      thresholdMinutes: normalizePositiveNumber(
        options.keepalivePreflightThresholdMinutes,
        DEFAULT_KEEPALIVE_PREFLIGHT_THRESHOLD_MINUTES,
      ),
      sessionHealthSummary: null,
      sessionHealthSummaryAfter: null,
      keepaliveReport: null,
      authProfile,
      authContext,
    };
  }

  const thresholdMinutes = normalizePositiveNumber(
    options.keepalivePreflightThresholdMinutes,
    DEFAULT_KEEPALIVE_PREFLIGHT_THRESHOLD_MINUTES,
  );
  const authSessionState = await readAuthSessionState(authContext.userDataDir);
  const sessionHealthSummary = summarizeAuthSessionState(authSessionState, authContext.authConfig);
  const decision = buildKeepaliveDecision(sessionHealthSummary, thresholdMinutes);

  if (!decision.shouldRun) {
    return {
      attempted: false,
      ran: false,
      reason: decision.reason,
      trigger: decision.trigger,
      thresholdMinutes,
      sessionHealthSummary,
      sessionHealthSummaryAfter: sessionHealthSummary,
      keepaliveReport: null,
      authProfile,
      authContext,
    };
  }

  const siteKeepaliveImpl = deps.siteKeepaliveImpl;
  if (typeof siteKeepaliveImpl !== 'function') {
    throw new Error('Keepalive preflight requires a siteKeepalive implementation.');
  }

  const keepaliveReport = await siteKeepaliveImpl(inputUrl, {
    profilePath: options.profilePath,
    browserPath: options.browserPath,
    browserProfileRoot: options.browserProfileRoot,
    userDataDir: options.userDataDir,
    timeoutMs: options.timeoutMs,
    headless: options.headless,
    reuseLoginState: options.reuseLoginState,
    autoLogin: options.autoLogin,
    outDir: options.keepaliveOutDir,
  }, deps.siteKeepaliveDeps ?? {});

  return {
    attempted: true,
    ran: true,
    reason: decision.reason,
    trigger: decision.trigger,
    thresholdMinutes,
    sessionHealthSummary,
    sessionHealthSummaryAfter: keepaliveReport?.keepalive?.sessionHealthSummary
      ?? keepaliveReport?.loginReport?.auth?.sessionHealthSummary
      ?? sessionHealthSummary,
    keepaliveReport,
    authProfile,
    authContext,
  };
}
