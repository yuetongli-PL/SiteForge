// @ts-check

import { maybeLoadValidatedProfileForHost } from '../core/profiles.mjs';
import { inspectReusableSiteSession } from '../../infra/auth/site-auth.mjs';
import {
  prepareSiteSessionGovernance,
  releaseSessionLease as releaseGovernanceSessionLease,
} from '../../infra/auth/site-session-governance.mjs';
import { normalizeText } from '../../shared/normalize.mjs';
import {
  createAnonymousSessionLease,
  createBlockedSessionLease,
  inferSiteKeyFromHost,
  normalizeSessionLease,
} from './contracts.mjs';

function hasSessionMaterial(options = {}) {
  return Boolean(
    Object.keys(options.headers ?? {}).length
      || Object.keys(options.downloadHeaders ?? {}).length
      || Array.isArray(options.cookies) && options.cookies.length
      || options.browserProfileRoot
      || options.userDataDir
      || options.reuseLoginState === true
  );
}

async function loadProfile(host, options = {}) {
  if (options.profile) {
    return options.profile;
  }
  if (!host) {
    return null;
  }
  try {
    const loaded = await maybeLoadValidatedProfileForHost(host, {
      profilePath: options.profilePath,
    });
    return loaded?.json ?? null;
  } catch {
    return null;
  }
}

function resolveReuseLoginState(options = {}, profile = null) {
  if (options.reuseLoginState !== undefined) {
    return options.reuseLoginState === true;
  }
  if (profile?.authSession?.reuseLoginStateByDefault !== undefined) {
    return profile.authSession.reuseLoginStateByDefault === true;
  }
  return true;
}

function fallbackInputUrl(host, options = {}, profile = null) {
  const explicit = normalizeText(
    options.inputUrl
      ?? options.url
      ?? options.sourceUrl
      ?? options.siteContext?.url
      ?? options.siteContext?.inputUrl
      ?? profile?.authSession?.verificationUrl
      ?? profile?.authSession?.postLoginUrl
      ?? profile?.authSession?.loginUrl,
  );
  if (explicit) {
    return explicit;
  }
  return host ? `https://${host}/` : '';
}

function governanceStatusFromDecision({ governance = null, reusableSession = null, requirement = 'optional' } = {}) {
  const policyDecision = governance?.policyDecision ?? {};
  const riskCauseCode = normalizeText(policyDecision.riskCauseCode);
  if (policyDecision.allowed === false) {
    if (
      policyDecision.profileQuarantined === true
      || ['browser-fingerprint-risk', 'network-identity-drift', 'request-burst'].includes(riskCauseCode)
    ) {
      return 'quarantine';
    }
    if (['session-invalid', 'profile-health-risk'].includes(riskCauseCode)) {
      return 'manual-required';
    }
    return 'blocked';
  }
  if (reusableSession?.authAvailable === true || reusableSession?.reusableProfile === true) {
    return 'ready';
  }
  return requirement === 'required' ? 'manual-required' : 'blocked';
}

function governanceReasonFromDecision({ governance = null, reusableSession = null } = {}) {
  const policyDecision = governance?.policyDecision ?? {};
  const profileHealth = reusableSession?.profileHealth ?? null;
  return normalizeText(
    policyDecision.riskCauseCode
      ?? policyDecision.riskAction
      ?? (reusableSession?.reuseLoginState === false ? 'reuse-login-state-disabled' : null)
      ?? (!reusableSession?.userDataDir ? 'missing-user-data-dir' : null)
      ?? (profileHealth?.exists === false ? 'profile-missing' : null)
      ?? (profileHealth?.healthy === false ? 'profile-health-risk' : null)
      ?? (reusableSession?.authAvailable === false ? 'reusable-profile-unavailable' : null),
  ) || undefined;
}

function governanceRiskSignals({ governance = null, reusableSession = null } = {}) {
  return [
    governance?.policyDecision?.riskCauseCode,
    governance?.policyDecision?.riskAction,
    ...(governance?.policyDecision?.driftReasons ?? []),
    ...(governance?.networkDrift?.reasons ?? []),
    ...(reusableSession?.profileHealth?.warnings ?? []),
  ].map((value) => normalizeText(value)).filter(Boolean);
}

async function releaseGovernanceLease(lease, deps = {}) {
  if (!lease) {
    return;
  }
  if (typeof deps.releaseGovernanceSessionLease === 'function') {
    await deps.releaseGovernanceSessionLease(lease);
    return;
  }
  await releaseGovernanceSessionLease(lease);
}

async function resolveGovernanceBackedSessionLease(siteKey, purpose, options = {}, deps = {}, { preflightOnly = false } = {}) {
  const host = options.host ?? options.siteContext?.host ?? options.profile?.host ?? siteKey;
  const resolvedSiteKey = siteKey || inferSiteKeyFromHost(host);
  const requirement = options.sessionRequirement ?? 'none';
  const forcedStatus = options.sessionStatus ?? options.status;
  if (forcedStatus && forcedStatus !== 'ready') {
    return createBlockedSessionLease({
      siteKey: resolvedSiteKey,
      host,
      purpose,
      status: forcedStatus,
      reason: options.sessionReason ?? options.reason ?? forcedStatus,
      riskSignals: options.riskSignals ?? [],
    });
  }
  if (options.dryRun === true) {
    return createAnonymousSessionLease({
      siteKey: resolvedSiteKey,
      host,
      purpose,
    });
  }
  const profile = await loadProfile(host, options);
  const reuseLoginState = resolveReuseLoginState(options, profile);
  if (!reuseLoginState) {
    return requirement === 'required'
      ? createBlockedSessionLease({
        siteKey: resolvedSiteKey,
        host,
        purpose,
        status: 'manual-required',
        reason: 'reuse-login-state-disabled',
        riskSignals: ['reuse-login-state-disabled'],
      })
      : createAnonymousSessionLease({ siteKey: resolvedSiteKey, host, purpose });
  }

  const inputUrl = fallbackInputUrl(host, options, profile);
  if (!inputUrl) {
    return null;
  }

  const inspectReusable = deps.inspectReusableSiteSession ?? inspectReusableSiteSession;
  const settings = {
    profilePath: options.profilePath,
    browserProfileRoot: options.browserProfileRoot,
    userDataDir: options.userDataDir,
    reuseLoginState,
    sessionLeaseWaitMs: options.sessionLeaseWaitMs,
    sessionLeasePollIntervalMs: options.sessionLeasePollIntervalMs,
  };
  const reusableSession = await inspectReusable(inputUrl, settings, {
    profilePath: options.profilePath,
    siteProfile: profile,
  }, deps.reusableSessionDeps ?? deps);

  if (!reusableSession?.authConfig && !reusableSession?.userDataDir && !profile?.authSession) {
    return null;
  }

  const authContext = reusableSession.sessionOptions ?? {
    authProfile: reusableSession.authProfile ?? null,
    siteProfile: reusableSession.siteProfile ?? profile ?? null,
    authConfig: reusableSession.authConfig ?? profile?.authSession ?? null,
    reuseLoginState: reusableSession.reuseLoginState !== false,
    userDataDir: reusableSession.userDataDir ?? options.userDataDir ?? null,
    cleanupUserDataDirOnShutdown: reusableSession.cleanupUserDataDirOnShutdown === true,
  };
  const prepareGovernance = deps.prepareSiteSessionGovernance ?? prepareSiteSessionGovernance;
  const governance = await prepareGovernance(inputUrl, authContext, settings, {
    operation: normalizeText(options.operation) || purpose || 'download',
    now: options.now,
    networkOptions: {
      ...(options.networkOptions ?? {}),
      disableExternalLookup: options.networkOptions?.disableExternalLookup ?? true,
    },
  }, deps.siteSessionGovernanceDeps ?? deps);

  const status = governanceStatusFromDecision({ governance, reusableSession, requirement });
  const reason = status === 'ready'
    ? undefined
    : governanceReasonFromDecision({ governance, reusableSession });
  const lease = normalizeSessionLease({
    siteKey: resolvedSiteKey,
    host,
    purpose,
    mode: requirement === 'required' ? 'authenticated' : 'reusable-profile',
    status,
    reason,
    riskSignals: governanceRiskSignals({ governance, reusableSession }),
    browserProfileRoot: options.browserProfileRoot,
    userDataDir: reusableSession.userDataDir ?? authContext.userDataDir ?? options.userDataDir,
    expiresAt: reusableSession.authSessionStateSummary?.nextSuggestedKeepaliveAt
      ?? governance.authSessionSummary?.nextSuggestedKeepaliveAt
      ?? undefined,
    quarantineKey: options.quarantineKey ?? `${host}:download`,
  });

  if (preflightOnly) {
    await releaseGovernanceLease(governance?.lease, deps);
    return lease;
  }
  return {
    ...lease,
    governanceLease: governance?.lease ?? null,
  };
}

export async function acquireSessionLease(siteKey, purpose = 'download', options = {}, deps = {}) {
  if (typeof deps.acquireSessionLease === 'function') {
    return normalizeSessionLease(await deps.acquireSessionLease(siteKey, purpose, options), {
      siteKey,
      purpose,
    });
  }

  const host = options.host ?? options.siteContext?.host ?? options.profile?.host ?? siteKey;
  const resolvedSiteKey = siteKey || inferSiteKeyFromHost(host);
  const requirement = options.sessionRequirement ?? 'none';
  const forcedStatus = options.sessionStatus ?? options.status;
  if (forcedStatus && forcedStatus !== 'ready') {
    return createBlockedSessionLease({
      siteKey: resolvedSiteKey,
      host,
      purpose,
      status: forcedStatus,
      reason: options.sessionReason ?? options.reason ?? forcedStatus,
      riskSignals: options.riskSignals ?? [],
    });
  }
  if (requirement === 'none') {
    return createAnonymousSessionLease({
      siteKey: resolvedSiteKey,
      host,
      purpose,
    });
  }

  const governanceLease = await resolveGovernanceBackedSessionLease(siteKey, purpose, options, deps);
  if (governanceLease) {
    if (governanceLease.status === 'ready' || requirement === 'required') {
      return governanceLease;
    }
    await releaseGovernanceLease(governanceLease.governanceLease, deps);
    return createAnonymousSessionLease({
      siteKey: resolvedSiteKey,
      host,
      purpose,
    });
  }

  const profile = await loadProfile(host, options);
  const reuseLoginState = resolveReuseLoginState(options, profile);
  const headers = {
    ...(options.headers ?? {}),
    ...(options.downloadHeaders ?? {}),
  };
  const sessionMaterial = hasSessionMaterial({
    ...options,
    headers,
    reuseLoginState,
  });

  if (requirement === 'required' && !sessionMaterial) {
    return createBlockedSessionLease({
      siteKey: resolvedSiteKey,
      host,
      purpose,
      status: 'manual-required',
      reason: 'session-required',
    });
  }

  return normalizeSessionLease({
    siteKey: resolvedSiteKey,
    host,
    purpose,
    mode: requirement === 'required' ? 'authenticated' : 'reusable-profile',
    status: 'ready',
    browserProfileRoot: options.browserProfileRoot,
    userDataDir: options.userDataDir,
    headers,
    cookies: options.cookies ?? [],
    riskSignals: [],
    expiresAt: options.expiresAt,
    quarantineKey: options.quarantineKey ?? `${host}:download`,
  });
}

export async function inspectSessionHealth(siteKey, options = {}, deps = {}) {
  if (typeof deps.inspectSessionHealth === 'function') {
    return await deps.inspectSessionHealth(siteKey, options);
  }
  const lease = await resolveGovernanceBackedSessionLease(siteKey, 'health-check', options, deps, {
    preflightOnly: true,
  }) ?? await acquireSessionLease(siteKey, 'health-check', options, deps);
  return {
    siteKey: lease.siteKey,
    host: lease.host,
    status: lease.status,
    mode: lease.mode,
    riskSignals: lease.riskSignals,
    reason: lease.reason,
  };
}

export async function releaseSessionLease(lease, deps = {}) {
  if (typeof deps.releaseSessionLease === 'function') {
    return await deps.releaseSessionLease(lease);
  }
  if (lease?.governanceLease) {
    await releaseGovernanceLease(lease.governanceLease, deps);
  }
  return {
    released: true,
    siteKey: lease?.siteKey ?? null,
    host: lease?.host ?? null,
  };
}

export async function quarantineSession(lease, reason, deps = {}) {
  if (typeof deps.quarantineSession === 'function') {
    return await deps.quarantineSession(lease, reason);
  }
  return normalizeSessionLease({
    ...lease,
    status: 'blocked',
    reason,
    riskSignals: [...(lease?.riskSignals ?? []), reason].filter(Boolean),
  });
}
