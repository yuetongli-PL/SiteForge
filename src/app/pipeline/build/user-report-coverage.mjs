// @ts-check

import { authSummaryForReport } from './auth-state.mjs';
import {
  evidenceBundlesFromStageResults,
  evidenceCoverageFromBundles,
} from './evidence-provider.mjs';
import { isHighRiskCapability } from './output-validation.mjs';
import { RUNTIME_MODES } from './runtime-provider.mjs';

const BRIDGE_RUNTIME_MODE = RUNTIME_MODES.browserBridgeRequired;
const HTTP_RUNTIME_MODE = RUNTIME_MODES.genericHttpRead;

function normalizeStatusToken(value) {
  return String(value ?? '').trim().toLowerCase();
}

function sourceLayerFor(record = /** @type {any} */ ({})) {
  const layer = String(record?.sourceLayer ?? '').trim();
  if (layer === 'authenticated' || layer === 'authenticated_overlay' || layer === 'public_rendered' || layer === 'authorized_source' || layer === 'public') {
    return layer;
  }
  return record?.authRequired === true ? 'authenticated' : 'public';
}

function pageSourceLayer(page = /** @type {any} */ ({})) {
  return sourceLayerFor(page);
}

function nodeSourceLayer(node = /** @type {any} */ ({})) {
  return sourceLayerFor(node);
}

function browserBridgeRouteCaptured(result = /** @type {any} */ ({})) {
  return ['captured', 'captured_with_warning'].includes(String(result?.status ?? '').trim())
    && result?.captured !== false;
}

export function browserBridgeCoverageGaps(authStateReport = /** @type {any} */ ({})) {
  const bridge = authStateReport?.browserBridge ?? {};
  const routeResults = Array.isArray(bridge.routeResults) ? bridge.routeResults : [];
  return routeResults
    .filter((result) => !browserBridgeRouteCaptured(result))
    .map((result) => ({
      id: result?.routeId ?? null,
      name: result?.targetRoute ?? result?.routeId ?? 'browser-auth-route',
      authRequired: true,
      routeTemplate: result?.targetRoute ?? null,
      sourceLayer: result?.sourceLayer === 'authenticated_overlay' ? 'authenticated_overlay' : 'authenticated',
      status: result?.status ?? 'timeout',
      reason: result?.reasonCode ?? result?.status ?? 'browser-auth-route-not-captured',
      missingEvidence: ['browser_structure_summary'],
    }));
}

export function summarizeNodes(stageResults = /** @type {any} */ ({})) {
  const nodes = stageResults.classifyNodes?.graph?.nodes
    ?? stageResults.buildSiteGraph?.graph?.nodes
    ?? [];
  const byType = /** @type {any} */ ({});
  const byClassification = /** @type {any} */ ({});
  const bySourceLayer = /** @type {any} */ ({});
  let authRequired = 0;
  for (const node of nodes) {
    const type = node.type ?? 'unknown';
    const classification = node.classification ?? 'unclassified';
    const sourceLayer = nodeSourceLayer(node);
    byType[type] = (byType[type] ?? 0) + 1;
    byClassification[classification] = (byClassification[classification] ?? 0) + 1;
    bySourceLayer[sourceLayer] = (bySourceLayer[sourceLayer] ?? 0) + 1;
    if (node.authRequired === true) {
      authRequired += 1;
    }
  }
  return {
    total: nodes.length,
    nodes_total: nodes.length,
    page_nodes: byType.page ?? 0,
    content_nodes: byType.content ?? 0,
    operation_nodes: byType.operation ?? byType.component ?? byType.action ?? 0,
    modal_nodes: byType.modal ?? 0,
    route_templates: (byType.route_template ?? 0) + (byType.route ?? 0),
    actionable_elements: stageResults.extractAffordances?.affordances?.length
      ?? stageResults.discoverInteractions?.interactions?.length
      ?? 0,
    by_type: byType,
    by_classification: byClassification,
    by_source_layer: bySourceLayer,
    auth_required: authRequired,
  };
}

export function buildCoverageReport(
  context = /** @type {any} */ ({}),
  stageResults = /** @type {any} */ ({}),
  capabilities = /** @type {any[]} */ ([]),
) {
  const nodes = stageResults.classifyNodes?.graph?.nodes
    ?? stageResults.buildSiteGraph?.graph?.nodes
    ?? [];
  const publicStaticNodes = nodes.filter((node) => nodeSourceLayer(node) === 'public');
  const publicRenderedNodes = nodes.filter((node) => nodeSourceLayer(node) === 'public_rendered');
  const authorizedSourceNodes = nodes.filter((node) => nodeSourceLayer(node) === 'authorized_source');
  const publicNodes = [...publicStaticNodes, ...publicRenderedNodes];
  const authNodes = nodes.filter((node) => nodeSourceLayer(node) === 'authenticated');
  const overlayNodes = nodes.filter((node) => nodeSourceLayer(node) === 'authenticated_overlay');
  const publicCapabilities = capabilities.filter((capability) => capability.authRequired !== true);
  const publicCrawlCapabilities = publicCapabilities.filter((capability) => capability.sourceLayer !== 'authorized_source');
  const authCapabilities = capabilities.filter((capability) => capability.authRequired === true);
  const requiresLoginButMissing = authCapabilities
    .filter((capability) => capability.status !== 'active' && capability.activationBlockedReason === 'missing_auth_evidence')
    .map((capability) => ({
      id: capability.id,
      name: capability.name,
      missingEvidence: capability.evidenceMatrix?.missingEvidence ?? [],
    }));
  const blockedByRisk = capabilities
    .filter((capability) => capability.status === 'disabled' || ['disabled', 'draft_only', 'confirmation_required'].includes(normalizeStatusToken(capability.enabled_status)))
    .filter((capability) => isHighRiskCapability(capability) || ['write_low', 'write_high', 'account_security_critical'].includes(capability.risk_level))
    .map((capability) => ({
      id: capability.id,
      name: capability.name,
      riskLevel: capability.risk_level ?? null,
      enabledStatus: capability.enabled_status ?? null,
      reason: capability.activationBlockedReason ?? capability.disabledReason ?? null,
    }));
  const blockedByAuth = [
    ...browserBridgeCoverageGaps(context.authStateReport),
    ...authCapabilities
      .filter((capability) => capability.status !== 'active')
      .filter((capability) => !(
        isHighRiskCapability(capability)
        || ['write_low', 'write_high', 'account_security_critical'].includes(capability.risk_level)
        || ['forced-action-disabled', 'risk-policy-disabled'].includes(capability.activationBlockedReason)
      ))
      .map((capability) => ({
        id: capability.id,
        name: capability.name,
        authRequired: true,
        missingEvidence: capability.evidenceMatrix?.missingEvidence ?? [],
        reason: capability.activationBlockedReason ?? null,
      })),
  ];
  const browserBridge = authSummaryForReport(context.crawlContract, context.authStateReport).browserBridge;
  const providerCoverage = evidenceCoverageFromBundles(evidenceBundlesFromStageResults(stageResults));
  const runtimeCapabilities = {
    httpRuntimeCapabilities: capabilities.filter((capability) => capability.runtimeMode === HTTP_RUNTIME_MODE).length,
    browserBridgeRuntimeCapabilities: capabilities.filter((capability) => capability.runtimeMode === BRIDGE_RUNTIME_MODE).length,
    runtimeIneligibleCapabilities: capabilities.filter((capability) => (
      capability.status === 'active'
      && !capability.runtimeMode
    )).length,
    blockedChallengeOrRuntimeIneligible: blockedByAuth.length + capabilities.filter((capability) => (
      capability.status === 'active'
      && !capability.runtimeMode
      && ['authenticated', 'authenticated_overlay', 'public_rendered', 'authorized_source'].includes(nodeSourceLayer(capability))
    )).length,
  };
  return {
    crawlMode: context.crawlContract?.crawlMode ?? 'public_only',
    authMethod: context.crawlContract?.authMethod ?? context.authStateReport?.authMethod ?? 'none',
    authVerificationStatus: context.crawlContract?.authVerificationStatus ?? context.authStateReport?.authVerificationStatus ?? null,
    browserBridge,
    providers: providerCoverage.providers,
    evidenceProviders: providerCoverage,
    runtime: runtimeCapabilities,
    public: {
      pages: stageResults.crawlStatic?.summary?.publicPages
        ?? (stageResults.crawlStatic?.pages ?? []).filter((page) => pageSourceLayer(page) === 'public').length,
      nodes: publicNodes.length,
      capabilities: publicCrawlCapabilities.filter((capability) => capability.status === 'active').length,
    },
    publicRendered: {
      pages: stageResults.crawlRendered?.publicRenderedPages?.length ?? 0,
      nodes: publicRenderedNodes.length,
      capabilities: publicCapabilities
        .filter((capability) => capability.status === 'active' && capability.sourceLayer === 'public_rendered').length,
    },
    authorizedSource: {
      pages: stageResults.crawlStatic?.summary?.authorizedSourcePages ?? 0,
      nodes: authorizedSourceNodes.length,
      capabilities: publicCapabilities
        .filter((capability) => capability.status === 'active' && capability.sourceLayer === 'authorized_source').length,
    },
    authenticated: {
      pages: stageResults.crawlAuthenticated?.authenticatedPages?.length ?? 0,
      nodes: authNodes.length,
      capabilities: authCapabilities.filter((capability) => capability.status === 'active').length,
    },
    overlay: {
      pagesRevisited: stageResults.crawlAuthenticated?.authenticatedOverlayPages?.length ?? 0,
      newNodes: overlayNodes.length,
      newAffordances: (stageResults.extractAffordances?.affordances ?? [])
        .filter((affordance) => affordance.sourceLayer === 'authenticated_overlay').length,
    },
    requiresLoginButMissing,
    blockedByRisk,
    blockedByAuth,
  };
}
