// @ts-check

import { uniqueSortedStrings } from '../../../shared/normalize.mjs';
import { displayBuildWarning } from './build-report-display.mjs';

export function buildUserFacingWarnings(report, resultStatus, context = null, partialSuccessReasons = /** @type {any[]} */ ([])) {
  const warnings = uniqueSortedStrings((report?.warnings ?? []).map((warning) => displayBuildWarning(warning)));
  if (resultStatus === 'partial_success') {
    warnings.push(...partialSuccessReasons);
  }
  if (
    context?.setupProfile?.userAuthorizedEvidence?.autoDiscovery?.status === 'modeled'
    && (
      context.setupProfile.userAuthorizedEvidence.autoDiscovery.dynamicEnabled !== true
      || context.setupProfile.userAuthorizedEvidence.autoDiscovery.networkEnabled !== true
    )
  ) {
    warnings.push('Auto-discovery used sanitized SPA route/state summaries; browser-rendered crawl and raw network tracing are not enabled in this public build path.');
  }
  if (context?.options?.internalRawNetwork === true) {
    warnings.push('Raw network capture was enabled; raw artifacts are kept out of generated Skill, current outputs, and registry.');
  }
  if (resultStatus === 'failed' && report?.reason) {
    warnings.push(report.reason);
  }
  return uniqueSortedStrings(warnings);
}
