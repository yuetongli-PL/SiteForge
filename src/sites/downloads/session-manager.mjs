// @ts-check

import { maybeLoadValidatedProfileForHost } from '../core/profiles.mjs';
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
  const lease = await acquireSessionLease(siteKey, 'health-check', options, deps);
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
