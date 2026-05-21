// @ts-check

import {
  formatCommand,
  unifiedCliArgv,
} from '../../infra/cli/command-map.mjs';

export { quoteCommandArg } from '../../infra/cli/command-map.mjs';

/** @param {Record<string, any>} options */
export function buildSessionRepairPlanCommand({
  site,
  reason = 'blocked',
  auditManifest = null,
} = {}) {
  const siteKey = String(site ?? '').trim();
  if (!siteKey) {
    return null;
  }
  const argv = unifiedCliArgv(['build', '<url>']);
  return {
    command: 'siteforge-build',
    argv,
    commandText: formatCommand(argv),
    site: siteKey,
    reason: auditManifest ? undefined : String(reason ?? 'blocked'),
    auditManifest: auditManifest ? String(auditManifest) : undefined,
  };
}
