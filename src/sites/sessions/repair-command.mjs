// @ts-check

const SESSION_REPAIR_PLAN_ENTRYPOINT = 'src/entrypoints/sites/session-repair-plan.mjs';

export function quoteCommandArg(value) {
  const text = String(value ?? '');
  if (!/[\s"]/u.test(text)) {
    return text;
  }
  return `"${text.replace(/"/gu, '\\"')}"`;
}

export function buildSessionRepairPlanCommand({
  site,
  reason = 'blocked',
  auditManifest = null,
} = {}) {
  const siteKey = String(site ?? '').trim();
  if (!siteKey) {
    return null;
  }
  const argv = [
    'node',
    SESSION_REPAIR_PLAN_ENTRYPOINT,
    '--site',
    siteKey,
  ];
  if (auditManifest) {
    argv.push('--audit-manifest', String(auditManifest));
  } else {
    argv.push('--session-gate-reason', String(reason ?? 'blocked'));
  }
  return {
    command: 'session-repair-plan',
    argv,
    commandText: argv.map(quoteCommandArg).join(' '),
    auditManifest: auditManifest ? String(auditManifest) : undefined,
  };
}
