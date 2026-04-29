// @ts-check

import { evaluateAuthenticatedSessionReleaseGate } from '../sessions/release-gate.mjs';
import { buildSessionRepairPlanCommand } from '../sessions/repair-command.mjs';

function requiresAuthenticatedSession(manifest = {}, plan = null) {
  return plan?.sessionRequirement === 'required'
    || manifest.liveValidation?.authenticated === true
    || manifest.session?.mode === 'authenticated';
}

function buildSessionRepairCommand(manifest = {}, gate = {}) {
  if (gate.status !== 'blocked') {
    return null;
  }
  const site = manifest.siteKey ?? manifest.site;
  if (!site) {
    return null;
  }
  return buildSessionRepairPlanCommand({ site, reason: gate.reason })?.commandText ?? null;
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
