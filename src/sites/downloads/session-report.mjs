// @ts-check

import { evaluateAuthenticatedSessionReleaseGate } from '../sessions/release-gate.mjs';

function requiresAuthenticatedSession(manifest = {}, plan = null) {
  return plan?.sessionRequirement === 'required'
    || manifest.liveValidation?.authenticated === true
    || manifest.session?.mode === 'authenticated';
}

function quoteCommandArg(value) {
  const text = String(value ?? '');
  if (!/[\s"]/u.test(text)) {
    return text;
  }
  return `"${text.replace(/"/gu, '\\"')}"`;
}

function buildSessionRepairCommand(manifest = {}, gate = {}) {
  if (gate.status !== 'blocked') {
    return null;
  }
  const site = manifest.siteKey ?? manifest.site;
  if (!site) {
    return null;
  }
  const argv = [
    'node',
    'src/entrypoints/sites/session-repair-plan.mjs',
    '--site',
    site,
    '--session-gate-reason',
    gate.reason ?? 'blocked',
  ];
  return argv.map(quoteCommandArg).join(' ');
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
  const repairCommand = buildSessionRepairCommand(manifest, gate);
  if (repairCommand) {
    lines.push(`- Next session repair command: ${repairCommand}`);
  }
  return lines;
}
