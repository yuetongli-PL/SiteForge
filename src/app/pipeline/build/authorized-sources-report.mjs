// @ts-check

import { uniqueSortedStrings } from '../../../shared/normalize.mjs';
import { sanitizeReportPublicValue } from './user-report-values.mjs';

export function authorizedSourcesSummaryForReport(context = /** @type {any} */ ({})) {
  const sources = context.options?.authorizedSources
    ?? context.setupProfile?.localBuildConfig?.authorizedSources
    ?? [];
  const rows = (Array.isArray(sources) ? sources : [])
    .slice(0, 20)
    .map((source, index) => sanitizeReportPublicValue({
      id: source?.id ?? `authorized-source-${index + 1}`,
      kind: source?.kind ?? source?.type ?? 'authorized_source',
      url: source?.url ?? null,
      accessBasis: source?.accessBasis ?? source?.authorizationBasis ?? 'user_provided_contract',
      permissionScope: source?.permissionScope ?? 'sanitized_summary_only',
      allowedEvidence: uniqueSortedStrings(source?.allowedEvidence ?? []),
      genericCrawlAllowed: false,
      promotionAllowed: false,
    }));
  return {
    configured: rows.length,
    sources: rows,
    note: rows.length
      ? 'Authorized sources are evidence inputs, not robots/challenge bypasses; promotion remains gated by source authority and evidence policy.'
      : null,
  };
}
