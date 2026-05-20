// @ts-check

import { normalizeText } from '../../shared/normalize.mjs';

function pickFirstText(...values) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function inferAuthRequirement(manifest = {}, options = {}) {
  if (typeof options.requiresAuth === 'boolean') {
    return options.requiresAuth;
  }
  if (typeof manifest.requiresAuth === 'boolean') {
    return manifest.requiresAuth;
  }
  if (manifest.authHealth?.required === true) {
    return true;
  }
  return normalizeText(manifest.plan?.sessionRequirement) === 'required'
    || normalizeText(manifest.session?.requirement) === 'required';
}

function pickSessionHealth(manifest = {}, options = {}) {
  return options.sessionHealth
    ?? manifest.sessionHealth
    ?? manifest.session?.health
    ?? {};
}

export function evaluateAuthenticatedSessionReleaseGate(manifest = {}, options = {}) {
  const requiresAuth = inferAuthRequirement(manifest, options);
  const sessionHealth = pickSessionHealth(manifest, options);
  const provider = pickFirstText(
    options.sessionProvider,
    manifest.sessionProvider,
    manifest.session?.provider,
    manifest.session?.sessionProvider,
  );
  const healthManifest = pickFirstText(
    options.healthManifest,
    options.sessionHealthManifest,
    manifest.healthManifest,
    manifest.sessionHealthManifest,
    manifest.session?.healthManifest,
    manifest.sessionHealth?.artifacts?.manifest,
    manifest.sessionHealth?.manifest,
  );

  if (!requiresAuth) {
    return {
      ok: true,
      status: 'passed',
      reason: 'session-not-required',
      requiresAuth,
      provider,
      healthManifest,
    };
  }

  if (!provider) {
    return {
      ok: false,
      status: 'blocked',
      reason: 'session-provider-missing',
      requiresAuth,
      provider: null,
      healthManifest,
    };
  }

  if (provider === 'legacy-session-provider') {
    return {
      ok: true,
      status: 'passed',
      reason: 'legacy-session-provider',
      requiresAuth,
      provider,
      healthManifest,
    };
  }

  if (provider !== 'unified-session-runner') {
    return {
      ok: false,
      status: 'blocked',
      reason: 'session-provider-unknown',
      requiresAuth,
      provider,
      healthManifest,
    };
  }

  if (!healthManifest) {
    return {
      ok: false,
      status: 'blocked',
      reason: 'session-health-manifest-missing',
      requiresAuth,
      provider,
      healthManifest: null,
    };
  }
  const healthStatus = pickFirstText(sessionHealth.healthStatus, sessionHealth.status);
  if (healthStatus && healthStatus !== 'ready' && healthStatus !== 'passed') {
    return {
      ok: false,
      status: 'blocked',
      reason: pickFirstText(sessionHealth.reason, sessionHealth.riskCauseCode, healthStatus),
      requiresAuth,
      provider,
      healthManifest,
    };
  }

  return {
    ok: true,
    status: 'passed',
    reason: 'unified-session-health-manifest',
    requiresAuth,
    provider,
    healthManifest,
  };
}
