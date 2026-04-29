// @ts-check

import { evaluateAuthenticatedSessionReleaseGate } from '../sessions/release-gate.mjs';

function requiresAuthenticatedSession(manifest = {}, plan = null) {
  return plan?.sessionRequirement === 'required'
    || manifest.liveValidation?.authenticated === true
    || manifest.session?.mode === 'authenticated';
}

export function renderSessionTraceabilityLines(manifest = {}, { plan = null } = {}) {
  if (!manifest.session) {
    return [];
  }
  const gate = evaluateAuthenticatedSessionReleaseGate(manifest, {
    requiresAuth: requiresAuthenticatedSession(manifest, plan),
  });
  const lines = [
    `- Session provider: ${manifest.session.provider ?? 'unknown'}`,
    `- Session traceability gate: ${gate.status} (${gate.reason})`,
  ];
  if (manifest.session.healthManifest) {
    lines.push(`- Session health manifest: ${manifest.session.healthManifest}`);
  }
  return lines;
}
