// @ts-check

import { uniqueSortedStrings } from '../../../shared/normalize.mjs';
import { BUILD_SCHEMA_VERSION } from './models.mjs';
import { sanitizeEvidenceRef } from './risk-policy.mjs';
import { sanitizedStructureText } from './structure-sanitizer.mjs';
import { sanitizeReportPublicValue } from './user-report-values.mjs';

export function shouldWriteAccessRemediationPlan(pageReconciliation = /** @type {any} */ ({})) {
  const summary = pageReconciliation.summary ?? pageReconciliation ?? {};
  const reasonText = [
    summary.primaryReasonCode,
    summary.blockerClass,
    summary.retryDisposition,
    ...(summary.reasonCodes ?? []),
  ].join(' ');
  return summary.retryDisposition === 'blocked_no_bypass'
    || /robots|challenge|anti-crawl|verify|external_challenge/iu.test(reasonText);
}

export function buildAccessRemediationPlan(context, stageResults, pageReconciliation = /** @type {any} */ ({})) {
  const summary = pageReconciliation.summary ?? pageReconciliation ?? {};
  const capabilities = stageResults.discoverCapabilities?.capabilities ?? [];
  const routeOnlyCapabilities = capabilities
    .filter((capability) => capability.status === 'active' && (
      capability.publicRouteOnly === true
      || capability.evidenceModel === 'authenticated_route_only'
      || capability.evidenceModel === 'public_route_navigation'
    ))
    .slice(0, 20)
    .map((capability) => ({
      id: capability.id ?? capability.capabilityId ?? null,
      name: sanitizedStructureText(capability.name ?? capability.userValue ?? 'route-only capability', 120, 'route-only capability'),
      evidenceModel: capability.evidenceModel ?? null,
      enabled_status: capability.enabled_status ?? capability.enabledStatus ?? null,
      sourceLayer: capability.sourceLayer ?? null,
    }));
  const remainingUnverified = capabilities
    .filter((capability) => capability.status !== 'active' && capability.evidenceMatrix?.missingEvidence?.length)
    .slice(0, 20)
    .map((capability) => ({
      id: capability.id ?? capability.capabilityId ?? null,
      name: sanitizedStructureText(capability.name ?? capability.userValue ?? 'candidate capability', 120, 'candidate capability'),
      status: capability.status ?? null,
      enabled_status: capability.enabled_status ?? capability.enabledStatus ?? null,
      missingEvidence: uniqueSortedStrings(capability.evidenceMatrix?.missingEvidence ?? []),
    }));
  return sanitizeReportPublicValue({
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-access-remediation-plan',
    buildId: context.buildId,
    siteId: context.site.id,
    inputUrl: sanitizeEvidenceRef(context.inputUrl ?? context.site.rootUrl) ?? null,
    status: 'blocked',
    reasonCode: summary.primaryReasonCode ?? 'access-boundary',
    blockerClass: summary.blockerClass ?? null,
    retryDisposition: summary.retryDisposition ?? 'blocked_no_bypass',
    reasonCodes: uniqueSortedStrings(summary.reasonCodes ?? []),
    partialRouteOnly: {
      enabledCapabilities: routeOnlyCapabilities,
      note: 'Route-only capabilities can open or navigate configured/public routes; they do not prove list contents, metadata, or private page bodies.',
    },
    remainingUnverified,
    authorizedSourceManifestTemplate: {
      artifactFamily: 'siteforge-authorized-source-manifest',
      schemaVersion: BUILD_SCHEMA_VERSION,
      sources: [
        {
          id: 'official-feed-or-api',
          kind: 'official_api_or_feed',
          url: 'https://example.com/feed-or-api',
          accessBasis: 'site_docs_or_contract',
          permissionScope: 'public_metadata_or_sanitized_summary_only',
          allowedEvidence: ['response_shape', 'schema_hash', 'permission_scope', 'rate_limit_policy'],
          genericCrawlAllowed: false,
          promotionAllowed: false,
        },
        {
          id: 'user-structure-summary',
          kind: 'user_sanitized_summary',
          url: null,
          accessBasis: 'user_provided_redacted_structure',
          permissionScope: 'route_template,page_type,visible_item_count,control_type,structure_hash',
          allowedEvidence: ['route_template', 'page_type', 'visible_item_count', 'structure_hash'],
          genericCrawlAllowed: false,
          promotionAllowed: false,
        },
      ],
    },
    workflows: [
      {
        workflowId: 'access:official-api-or-feed',
        kind: 'official_api_or_feed',
        status: 'available_if_site_provides_authorized_source',
        allowedEvidence: ['response_shape', 'schema_hash', 'rate_limit_policy', 'permission_scope'],
        genericCrawlAllowed: false,
        promotionAllowed: false,
        updatesCurrent: false,
        updatesRegistry: false,
      },
      {
        workflowId: 'access:user-supplied-structure-summary',
        kind: 'manual_summary',
        status: 'requires_sanitized_structure_source',
        allowedEvidence: ['route_template', 'page_type', 'visible_item_count', 'control_type', 'structure_hash'],
        genericCrawlAllowed: false,
        promotionAllowed: false,
        updatesCurrent: false,
        updatesRegistry: false,
      },
      {
        workflowId: 'access:local-http-validation',
        kind: 'local_http_validation',
        status: 'available_for_tests_only',
        allowedEvidence: ['fixture_http_response', 'fixture_robots_allow'],
        genericCrawlAllowed: false,
        liveSupportClaimAllowed: false,
        promotionAllowed: false,
        updatesCurrent: false,
        updatesRegistry: false,
      },
    ],
    safety: {
      bypassRobots: false,
      bypassChallenge: false,
      readBrowserProfile: false,
      persistCookie: false,
      persistToken: false,
      saveRawHtml: false,
      savePrivateBody: false,
      rawNetworkPayloadPersisted: false,
    },
  });
}
