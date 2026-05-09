// @ts-check

import {
  formatCommand,
  unifiedCliArgv,
} from '../../infra/cli/command-map.mjs';

export { quoteCommandArg } from '../../infra/cli/command-map.mjs';

export function buildSessionRepairPlanCommand({
  site,
  reason = 'blocked',
  auditManifest = null,
} = {}) {
  const siteKey = String(site ?? '').trim();
  if (!siteKey) {
    return null;
  }
  const argv = unifiedCliArgv([
    'site',
    'repair-plan',
    '--site',
    siteKey,
  ]);
  if (auditManifest) {
    argv.push('--audit-manifest', String(auditManifest));
  } else {
    argv.push('--session-gate-reason', String(reason ?? 'blocked'));
  }
  return {
    command: 'session-repair-plan',
    argv,
    commandText: formatCommand(argv),
    auditManifest: auditManifest ? String(auditManifest) : undefined,
  };
}
