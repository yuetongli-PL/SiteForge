// @ts-check

import { normalizeText } from '../../shared/normalize.mjs';
import { normalizeSessionHealth } from './contracts.mjs';

export function buildSessionRepairPlan(health = {}) {
  const reason = normalizeText(health.reason ?? health.riskCauseCode ?? health.status);
  const riskSignals = [
    reason,
    ...(Array.isArray(health.riskSignals) ? health.riskSignals : []),
  ].map((value) => normalizeText(value)).filter(Boolean);
  const action = (() => {
    if (['network-identity-drift'].includes(reason) || riskSignals.includes('run-keepalive-before-auth')) {
      return 'site-keepalive';
    }
    if ([
      'session-invalid',
      'login-required',
      'reusable-profile-unavailable',
      'missing-user-data-dir',
      'profile-missing',
      'profile-uninitialized',
    ].includes(reason)) {
      return 'site-login';
    }
    if (['profile-health-risk'].includes(reason)) {
      return 'rebuild-profile';
    }
    if (['browser-fingerprint-risk', 'request-burst'].includes(reason) || health.status === 'quarantine') {
      return 'cooldown-and-retry-later';
    }
    if (health.status === 'expired') {
      return 'site-keepalive';
    }
    if (health.status === 'manual-required') {
      return 'manual-login';
    }
    return health.status && health.status !== 'ready' ? 'inspect-session-health' : '';
  })();
  if (!action) {
    return undefined;
  }
  const command = (() => {
    if (action === 'site-keepalive') {
      return 'site-keepalive';
    }
    if (action === 'site-login' || action === 'manual-login') {
      return 'site-login';
    }
    if (action === 'inspect-session-health') {
      return 'site-doctor';
    }
    return action;
  })();
  return Object.fromEntries(Object.entries({
    action,
    command,
    reason,
    riskSignals: [...new Set(riskSignals)],
    requiresApproval: true,
    notBefore: health.expiresAt,
  }).filter(([, value]) => value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0)));
}

function timestampMs(value) {
  const time = Date.parse(String(value ?? ''));
  return Number.isFinite(time) ? time : null;
}

function isProfileHealthRecoveredBySessionReuse(profileHealth = {}, authSummary = {}) {
  if (profileHealth?.profileLifecycle === 'uninitialized' || profileHealth?.profileLifecycle === 'missing') {
    return false;
  }
  if (profileHealth?.usableForCookies !== true) {
    return false;
  }
  const reuseVerifiedAt = timestampMs(authSummary?.lastSessionReuseVerifiedAt);
  if (!reuseVerifiedAt) {
    return false;
  }
  if (profileHealth?.profileLifecycle !== 'crashed') {
    return true;
  }
  const snapshotTimes = Array.isArray(profileHealth?.snapshots)
    ? profileHealth.snapshots.map((snapshot) => Number(snapshot?.mtimeMs)).filter(Number.isFinite)
    : [];
  return snapshotTimes.length > 0 && snapshotTimes.every((mtimeMs) => reuseVerifiedAt > mtimeMs);
}

export async function inspectSessionHealth(siteKey, options = {}, deps = {}) {
  if (typeof deps.inspectSessionHealth === 'function') {
    return await deps.inspectSessionHealth(siteKey, options);
  }
  if (typeof deps.inspectReusableSiteSession === 'function') {
    const reusable = await deps.inspectReusableSiteSession(siteKey, options);
    const userDataDir = normalizeText(reusable?.userDataDir ?? options.userDataDir);
    const authConfig = reusable?.authConfig ?? reusable?.sessionOptions?.authConfig ?? options.profile?.authSession ?? null;
    let status = reusable?.authAvailable === true || options.sessionRequirement !== 'required'
      ? 'ready'
      : 'manual-required';
    let reason = status === 'ready' ? 'session-ready' : 'login-required';
    const riskSignals = [];
    const lifecycle = normalizeText(reusable?.profileHealth?.profileLifecycle);
    if (lifecycle === 'uninitialized') {
      status = 'manual-required';
      reason = 'profile-uninitialized';
      riskSignals.push('profile-uninitialized');
    } else if (lifecycle === 'missing' || reusable?.profileHealth?.exists === false) {
      status = 'manual-required';
      reason = 'profile-missing';
      riskSignals.push('profile-missing');
    }

    if (typeof deps.prepareSiteSessionGovernance === 'function') {
      const governance = await deps.prepareSiteSessionGovernance(
        authConfig?.verificationUrl ?? options.profile?.authSession?.verificationUrl ?? options.host ?? siteKey,
        {
          siteKey,
          host: options.host ?? siteKey,
          authConfig,
          userDataDir,
        },
        {
          userDataDir,
          reuseLoginState: reusable?.reuseLoginState ?? options.reuseLoginState,
        },
        {
          operation: options.operation ?? 'session-health',
          siteKey,
          networkOptions: {
            disableExternalLookup: true,
          },
        },
      );
      if (governance?.lease && typeof deps.releaseGovernanceSessionLease === 'function') {
        await deps.releaseGovernanceSessionLease(governance.lease);
      }
      const decision = governance?.policyDecision;
      if (decision && decision.allowed === false) {
        const authSummary = governance?.authSessionSummary ?? reusable?.authSessionStateSummary ?? {};
        if (
          decision.riskCauseCode === 'profile-health-risk'
          && isProfileHealthRecoveredBySessionReuse(reusable?.profileHealth, authSummary)
        ) {
          status = 'ready';
          reason = null;
          riskSignals.length = 0;
          riskSignals.push('profile-health-recovered-after-session-reuse');
        } else {
          status = decision.riskCauseCode === 'network-identity-drift' ? 'quarantine' : 'manual-required';
          reason = decision.riskCauseCode ?? reason;
          riskSignals.push(
            decision.riskCauseCode,
            decision.riskAction,
            ...(Array.isArray(governance?.networkDrift?.reasons) ? governance.networkDrift.reasons : []),
          );
        }
      }
    }

    const health = normalizeSessionHealth({
      siteKey,
      host: options.host ?? siteKey,
      status,
      reason,
      riskCauseCode: reason,
      riskSignals,
      authStatus: reusable?.authAvailable === true ? 'authenticated' : 'unknown',
      identityConfirmed: reusable?.identityConfirmed,
    });
    return {
      ...health,
      repairPlan: health.repairPlan ?? buildSessionRepairPlan(health),
    };
  }
  const health = normalizeSessionHealth({
    siteKey,
    host: options.host ?? siteKey,
    status: options.status ?? 'manual-required',
    reason: options.reason ?? options.riskCauseCode ?? 'session-inspection-unavailable',
    riskCauseCode: options.riskCauseCode,
    riskSignals: options.riskSignals ?? ['session-inspection-unavailable'],
    authStatus: options.authStatus,
    identityConfirmed: options.identityConfirmed,
    expiresAt: options.expiresAt,
  });
  return {
    ...health,
    repairPlan: health.repairPlan ?? buildSessionRepairPlan(health),
  };
}
