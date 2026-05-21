// @ts-check

import { siteLogin } from './site-login-service.mjs';

function deriveKeepaliveStatus(loginReport) {
  if (loginReport?.auth?.challengeRequired === true) {
    return 'challenge-required';
  }
  if (loginReport?.auth?.persistenceVerified === true) {
    return 'kept-alive';
  }
  if (loginReport?.auth?.status === 'credentials-unavailable') {
    return 'credentials-unavailable';
  }
  return loginReport?.auth?.status ?? 'unknown';
}

export async function siteKeepalive(inputUrl, options = /** @type {any} */ ({}), deps = /** @type {any} */ ({})) {
  const loginReport = await (deps.siteLogin ?? siteLogin)(
    inputUrl,
    {
      ...options,
      runtimePurpose: 'keepalive',
      waitForManualLogin: false,
      reuseLoginState: true,
    },
    deps.siteLoginDeps ?? {},
  );
  const warnings = Array.isArray(loginReport.warnings) ? [...loginReport.warnings] : [];

  return {
    site: loginReport.site ?? {
      url: inputUrl,
      profilePath: options.profilePath ?? null,
      runtimePurpose: 'keepalive',
    },
    keepalive: {
      status: deriveKeepaliveStatus(loginReport),
      runtimePurpose: loginReport.site?.runtimePurpose ?? 'keepalive',
      authStatus: loginReport.auth?.status ?? null,
      persistenceVerified: loginReport.auth?.persistenceVerified === true,
      autoLogin: loginReport.auth?.autoLogin === true,
      runtimeUrl: loginReport.auth?.runtimeUrl ?? null,
      browserStartUrl: loginReport.site?.browserStartUrl ?? null,
      warmupSummary: loginReport.auth?.warmupSummary ?? null,
      keepaliveUrl: loginReport.auth?.keepaliveUrl ?? loginReport.auth?.verificationUrl ?? null,
      verificationUrl: loginReport.auth?.verificationUrl ?? null,
      keepaliveIntervalMinutes: loginReport.auth?.keepaliveIntervalMinutes ?? null,
      cooldownMinutesAfterRisk: loginReport.auth?.cooldownMinutesAfterRisk ?? null,
      preferVisibleBrowserForAuthenticatedFlows: loginReport.auth?.preferVisibleBrowserForAuthenticatedFlows === true,
      requireStableNetworkForAuthenticatedFlows: loginReport.auth?.requireStableNetworkForAuthenticatedFlows === true,
      riskCauseCode: loginReport.auth?.riskCauseCode ?? null,
      riskAction: loginReport.auth?.riskAction ?? null,
      networkIdentityFingerprint: loginReport.auth?.networkIdentityFingerprint ?? null,
      profileQuarantined: loginReport.auth?.profileQuarantined === true,
      sessionHealthSummary: loginReport.auth?.sessionHealthSummary ?? null,
      credentialsSource: loginReport.auth?.credentialsSource ?? null,
      challengeRequired: loginReport.auth?.challengeRequired === true,
      followCachePrewarm: null,
    },
    warnings,
    reports: loginReport.reports ?? null,
    loginReport,
  };
}
