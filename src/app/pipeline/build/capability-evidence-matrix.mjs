// @ts-check

import { uniqueSortedStrings } from '../../../shared/normalize.mjs';
import {
  canRunAuthenticatedLayer,
  evidenceLevelRank,
} from './auth-state.mjs';
import {
  canonicalCapabilitySemanticToken,
  normalizeSetupCapabilityId,
} from './capability-id.mjs';
import {
  findForcedDisabledActions,
  isReadOnlyFollowSurface,
} from './risk-policy.mjs';

const DEFAULT_DESTRUCTIVE_ACTION_PATTERN = /\b(?:delete|remove|clear|empty|wipe|overwrite|reset|cancel[-_\s]?(?:order|subscription)|void|destroy|purge|erase|revoke|delete_account|delete_file|delete_data|delete_order|delete_record)\b|\u5220\u9664|\u79fb\u9664|\u6e05\u7a7a|\u8986\u76d6|\u91cd\u7f6e|\u6ce8\u9500|\u53d6\u6d88\u8ba2\u5355|\u9500\u6bc1|\u62b9\u9664|\u64a4\u9500|\u4f5c\u5e9f/u;
const PAYMENT_ACTION_PATTERN = /\b(?:pay|payment|checkout|purchase|billing|invoice|charge|recharge|wallet|cart|change[-_\s]?payment|payment[-_\s]?method|funds?)\b|\u652f\u4ed8|\u4ed8\u6b3e|\u4ed8\u8d39|\u5145\u503c|\u7ed3\u8d26|\u4e0b\u5355|\u4ed8\u6b3e\u65b9\u5f0f|\u94f6\u884c\u5361/u;

const DESTRUCTIVE_ACTION_PATTERN = /\b(?:delete|remove|clear|empty|wipe|overwrite|reset|cancel|void|destroy|purge|erase|delete_account|delete_file|delete_data|delete_order|delete_record)\b|删除|移除|清空|覆盖|重置|注销|取消订单|销毁|抹除/u;

function nodeSourceLayer(node = /** @type {any} */ ({})) {
  const layer = String(node?.sourceLayer ?? '').trim();
  if (layer === 'authenticated' || layer === 'authenticated_overlay' || layer === 'public_rendered' || layer === 'authorized_source' || layer === 'public') {
    return layer;
  }
  return node?.authRequired === true ? 'authenticated' : 'public';
}

function isPublicReadSourceLayer(layer) {
  return layer === 'public' || layer === 'public_rendered' || layer === 'authorized_source';
}

function isAuthenticatedSourceLayer(layer) {
  return layer === 'authenticated' || layer === 'authenticated_overlay';
}

export function capabilityRequiresLogin(context, capability = /** @type {any} */ ({}), nodesById = new Map()) {
  if (capability.authRequired === true) {
    return true;
  }
  const nodes = [
    ...(capability.entryNodeIds ?? []),
    ...(capability.requiredNodeIds ?? []),
  ].map((id) => nodesById.get(id)).filter(Boolean);
  if (nodes.some((node) => node.authRequired === true || isAuthenticatedSourceLayer(nodeSourceLayer(node)))) {
    return true;
  }
  const text = [
    capability.name,
    capability.object,
    capability.description,
    capability.category,
    capability.setupCapabilityId,
    capability.intentAction,
  ].join(' ').toLowerCase();
  if (/notification|bookmark|list-lists|\buser lists?\b|\blist lists\b|lists summary|direct message|\bdm\b|following timeline|followed updates|followed users|recommended timeline|account followers/u.test(text)) {
    return true;
  }
  const requiredLoginIds = new Set(context.crawlContract?.coverageTargets?.requiresLoginCapabilities ?? []);
  return requiredLoginIds.has(canonicalCapabilitySemanticToken(capability.setupCapabilityId))
    || requiredLoginIds.has(canonicalCapabilitySemanticToken(capability.name));
}

export function sourceLayerForCapability(capability = /** @type {any} */ ({}), nodesById = new Map()) {
  const nodes = [
    ...(capability.entryNodeIds ?? []),
    ...(capability.requiredNodeIds ?? []),
  ].map((id) => nodesById.get(id)).filter(Boolean);
  if (nodes.some((node) => nodeSourceLayer(node) === 'authenticated_overlay')) {
    return 'authenticated_overlay';
  }
  if (nodes.some((node) => nodeSourceLayer(node) === 'authenticated')) {
    return 'authenticated';
  }
  if (nodes.some((node) => nodeSourceLayer(node) === 'authorized_source')) {
    return 'authorized_source';
  }
  if (capability.authRequired === true) {
    return 'authenticated';
  }
  if (nodes.some((node) => nodeSourceLayer(node) === 'public_rendered')) {
    return 'public_rendered';
  }
  return 'public';
}

export function providerIdForCapability(capability = /** @type {any} */ ({}), nodesById = new Map()) {
  const explicitProviderId = String(capability.providerId ?? '').trim();
  if (explicitProviderId === 'known_site_downloader' && capability.downloaderTaskDescriptor?.taskType === 'book') {
    return explicitProviderId;
  }
  const nodes = [
    ...(capability.entryNodeIds ?? []),
    ...(capability.requiredNodeIds ?? []),
  ].map((id) => nodesById.get(id)).filter(Boolean);
  const providerIds = uniqueSortedStrings(nodes.map((node) => node.providerId).filter(Boolean));
  if (providerIds.includes('browser_bridge')) return 'browser_bridge';
  if (providerIds.includes('cookie_http')) return 'cookie_http';
  if (providerIds.includes('authorized_summary')) return 'authorized_summary';
  if (providerIds.includes('public_rendered')) return 'public_rendered';
  if (providerIds.includes('public_http')) return 'public_http';
  const sourceLayer = sourceLayerForCapability(capability, nodesById);
  if (sourceLayer === 'authenticated' || sourceLayer === 'authenticated_overlay') {
    return 'browser_bridge';
  }
  if (sourceLayer === 'authorized_source') {
    return 'authorized_summary';
  }
  if (sourceLayer === 'public_rendered') {
    return 'public_rendered';
  }
  return 'public_http';
}

export function observedCapabilityEvidenceLevel(capability = /** @type {any} */ ({}), nodesById = new Map(), authStateReport = null) {
  const nodes = [
    ...(capability.entryNodeIds ?? []),
    ...(capability.requiredNodeIds ?? []),
  ].map((id) => nodesById.get(id)).filter(Boolean);
  const levels = nodes.map((node) => {
    if (node.evidenceLevel) {
      return node.evidenceLevel;
    }
    if (nodeSourceLayer(node) === 'public_rendered') {
      return 'public_rendered_verified';
    }
    if (nodeSourceLayer(node) === 'authorized_source') {
      return 'authorized_source_verified';
    }
    return node.authRequired ? 'login_route_verified' : 'public_verified';
  });
  if (
    canRunAuthenticatedLayer(authStateReport)
    && nodes.some((node) => node.authRequired === true || isAuthenticatedSourceLayer(nodeSourceLayer(node)))
    && nodes.some((node) => node.listPresent === true || Number(node.visibleItemCount ?? 0) > 0 || node.emptyStatePresent === true)
  ) {
    levels.push('capability_verified');
  }
  if (capability.capabilityVerified === true || (authStateReport?.capabilityProofs ?? []).some((proof) => {
    const capabilityId = normalizeSetupCapabilityId(proof.capabilityId);
    return capabilityId && [
      capability.setupCapabilityId,
      capability.name,
      capability.id,
    ].map(normalizeSetupCapabilityId).includes(capabilityId);
  })) {
    levels.push('capability_verified');
  }
  if (capability.apiReplayVerified === true || capability.evidenceModel === 'api_adapter_replay_verified') {
    levels.push('capability_verified');
  }
  return levels.sort((left, right) => evidenceLevelRank(right) - evidenceLevelRank(left))[0] ?? 'candidate';
}

export function nodeHasPublicStructureEvidence(node = /** @type {any} */ ({})) {
  const layer = nodeSourceLayer(node);
  if (['route_seed_only', 'link_route_template', 'link_semantic_route_template'].includes(node.evidenceStatus)
    || node.publicEvidenceStatus === 'public_rendered_route_seed_only') {
    return false;
  }
  if (node.evidenceStatus === 'structure_summary_present') {
    return true;
  }
  if (node.publicEvidenceStatus === 'public_static_structured' || node.staticEvidenceStatus === 'present') {
    return true;
  }
  if (node.listPresent === true || Number(node.visibleItemCount ?? 0) > 0 || node.emptyStatePresent === true) {
    return true;
  }
  if (Array.isArray(node.routeTemplates) && node.routeTemplates.length > 0) {
    return true;
  }
  if (layer === 'public_rendered' || layer === 'authorized_source') {
    return ['form', 'component', 'menu', 'tab'].includes(node.type);
  }
  return layer === 'public' && ['form', 'component', 'menu', 'tab'].includes(node.type);
}

export function buildCapabilityEvidenceMatrix(context, capability = /** @type {any} */ ({}), nodesById = new Map()) {
  const authRequired = capabilityRequiresLogin(context, capability, nodesById);
  const sourceLayer = sourceLayerForCapability({ ...capability, authRequired }, nodesById);
  const providerId = providerIdForCapability({ ...capability, authRequired }, nodesById);
  const publicRouteNavigationOnly = capability.evidenceModel === 'public_route_navigation' || capability.publicRouteOnly === true;
  const publicElementSummary = capability.evidenceModel === 'public_element_summary';
  const authenticatedRouteOnly = capability.evidenceModel === 'authenticated_route_only';
  const apiAdapterReplayVerified = capability.evidenceModel === 'api_adapter_replay_verified';
  const nodes = [
    ...(capability.entryNodeIds ?? []),
    ...(capability.requiredNodeIds ?? []),
  ].map((id) => nodesById.get(id)).filter(Boolean);
  const observedEvidence = new Set();
  if (nodes.length > 0) observedEvidence.add('source_node_present');
  if (Array.isArray(capability.evidence) && capability.evidence.length > 0) observedEvidence.add('sanitized_evidence_present');
  if (capability.executionPlan?.autoExecute !== true) observedEvidence.add('risk_policy_passed');
  if (!authRequired) {
    observedEvidence.add('public_route_accessible');
  }
  const hasPublicRouteReference = nodes.some((node) => (
    isPublicReadSourceLayer(nodeSourceLayer(node))
    && (
      ['page', 'route', 'route_template'].includes(node.type)
      || Boolean(node.normalizedUrl)
      || Boolean(node.routePattern)
      || Boolean(node.routeTemplate)
    )
  ));
  if (!authRequired && hasPublicRouteReference) {
    observedEvidence.add('public_route_template_present');
  }
  if (!authRequired && nodes.some((node) => node.evidenceStatus === 'element_instance_summary_present')) {
    observedEvidence.add('public_element_instance_present');
  }
  const hasPublicStructure = nodes.some((node) => nodeHasPublicStructureEvidence(node));
  if (!authRequired && hasPublicStructure) {
    if (nodes.some((node) => nodeSourceLayer(node) === 'authorized_source' && nodeHasPublicStructureEvidence(node))) {
      observedEvidence.add('authorized_source_structure_present');
    } else if (nodes.some((node) => nodeSourceLayer(node) === 'public_rendered' && nodeHasPublicStructureEvidence(node))) {
      observedEvidence.add('public_rendered_structure_present');
    } else {
      observedEvidence.add('public_structure_present');
    }
  }
  const hasAuthNode = nodes.some((node) => node.authRequired === true || isAuthenticatedSourceLayer(nodeSourceLayer(node)));
  if (authRequired && hasAuthNode) observedEvidence.add('route_accessible');
  if (authRequired && canRunAuthenticatedLayer(context.authStateReport)) observedEvidence.add('not_login_wall');
  if (apiAdapterReplayVerified && capability.apiReplayVerified === true) observedEvidence.add('api_replay_verified');
  const hasListContainer = nodes.some((node) => (
    node.listPresent === true
    || node.emptyStatePresent === true
    || /list|timeline|notification|bookmark|direct_message|following/u.test(String(node.classification ?? node.pageType ?? node.structureType ?? ''))
  ));
  if (authRequired && hasListContainer) observedEvidence.add('list_container_present');
  const hasVisibleItemsOrEmptyState = nodes.some((node) => Number(node.visibleItemCount ?? 0) > 0 || node.emptyStatePresent === true);
  if (authRequired && hasVisibleItemsOrEmptyState) observedEvidence.add('visible_item_count_or_empty_state');
  const actionRequiresEntryEvidenceOnly = ['create', 'submit', 'upload', 'download', 'manage'].includes(String(capability.action ?? '').toLowerCase())
    || ['state_changing', 'payment', 'destructive'].includes(String(capability.safetyLevel ?? '').toLowerCase());
  const requiredEvidence = authRequired
    ? apiAdapterReplayVerified
      ? ['source_node_present', 'not_login_wall', 'sanitized_evidence_present', 'api_replay_verified', 'risk_policy_passed']
      : authenticatedRouteOnly || actionRequiresEntryEvidenceOnly
      ? ['source_node_present', 'route_accessible', 'not_login_wall', 'sanitized_evidence_present', 'risk_policy_passed']
      : ['source_node_present', 'route_accessible', 'not_login_wall', 'list_container_present', 'visible_item_count_or_empty_state', 'risk_policy_passed']
    : apiAdapterReplayVerified
      ? ['source_node_present', 'public_route_accessible', 'sanitized_evidence_present', 'api_replay_verified', 'risk_policy_passed']
      : publicRouteNavigationOnly
      ? ['source_node_present', 'public_route_accessible', 'sanitized_evidence_present', 'public_route_template_present', 'risk_policy_passed']
      : publicElementSummary
        ? ['source_node_present', 'public_route_accessible', 'sanitized_evidence_present', 'public_element_instance_present', 'risk_policy_passed']
        : ['source_node_present', 'public_route_accessible', 'sanitized_evidence_present', 'public_structure_present', 'risk_policy_passed'];
  const observed = uniqueSortedStrings([...observedEvidence]);
  const missingEvidence = requiredEvidence.filter((item) => (
    item === 'public_structure_present'
      ? !observedEvidence.has('public_structure_present') && !observedEvidence.has('public_rendered_structure_present') && !observedEvidence.has('authorized_source_structure_present')
      : !observedEvidence.has(item)
  ));
  const observedEvidenceLevel = observedCapabilityEvidenceLevel(capability, nodesById, context.authStateReport);
  const requiredEvidenceLevel = authRequired
    ? (authenticatedRouteOnly && !apiAdapterReplayVerified) ? 'login_route_verified' : 'capability_verified'
    : 'public_verified';
  return {
    capabilityId: capability.id,
    authRequired,
    requiredEvidenceLevel,
    observedEvidenceLevel,
    sourceLayer,
    providerId,
    requiredEvidence,
    observedEvidence: observed,
    missingEvidence,
    activationDecision: missingEvidence.length === 0 ? 'active' : 'candidate',
  };
}

export function applyCapabilityEvidenceMatrix(context, capability = /** @type {any} */ ({}), graph) {
  const nodesById = new Map((graph?.nodes ?? []).map((node) => [node.id, node]));
  const matrix = buildCapabilityEvidenceMatrix(context, capability, nodesById);
  const next = {
    ...capability,
    authRequired: matrix.authRequired,
    sourceLayer: matrix.sourceLayer,
    providerId: matrix.providerId,
    requiredEvidenceLevel: matrix.requiredEvidenceLevel,
    observedEvidenceLevel: matrix.observedEvidenceLevel,
    evidenceMatrix: matrix,
    activationEvidence: matrix,
  };
  const text = `${next.name ?? ''} ${next.object ?? ''} ${next.action ?? ''} ${next.blockedAction ?? ''}`;
  const forcedRiskDisabled = ['payment', 'destructive'].includes(next.safetyLevel)
    || DEFAULT_DESTRUCTIVE_ACTION_PATTERN.test(text)
    || PAYMENT_ACTION_PATTERN.test(text)
    || (isReadOnlyFollowSurface(next)
      ? findForcedDisabledActions(`${next.name ?? ''} ${next.object ?? ''} ${next.action ?? ''}`).filter((action) => action !== 'follow' && action !== 'unfollow').length > 0
      : findForcedDisabledActions(`${next.name ?? ''} ${next.object ?? ''} ${next.action ?? ''}`).length > 0);
  if (forcedRiskDisabled) {
    const disposition = 'blocked';
    if (next.executionPlan) {
      next.executionPlan = {
        ...next.executionPlan,
        governedExecution: true,
        executionDisposition: disposition,
        mode: next.executionPlan.mode === 'read_only' ? 'dry_run' : next.executionPlan.mode,
        dryRunOnly: true,
        requiresConfirmation: true,
        autoExecute: false,
        steps: (Array.isArray(next.executionPlan.steps) ? next.executionPlan.steps : []).map((step) => ({
          ...step,
          governedExecution: true,
          executionDisposition: disposition,
          submit: false,
          finalSubmit: false,
          autoExecute: false,
        })),
      };
    }
    next.status = 'active';
    next.enabled_status = 'disabled';
    next.default_policy = next.enabled_status;
    next.evidence_status = 'disabled';
    next.activationBlockedReason = next.activationBlockedReason ?? 'forced-action-disabled';
    next.planCallable = Boolean(next.executionPlan);
    next.runtimeCallable = disposition !== 'blocked';
    next.autoExecutable = false;
    next.executionDisposition = disposition;
    next.evidenceMatrix = {
      ...matrix,
      activationDecision: next.enabled_status,
    };
    next.activationEvidence = next.evidenceMatrix;
    return next;
  }
  if (matrix.authRequired && !canRunAuthenticatedLayer(context.authStateReport)) {
    if (!next.executionPlan) {
      next.status = 'candidate';
      next.enabled_status = 'candidate_debug_only';
      next.default_policy = 'candidate_debug_only';
      next.evidence_status = 'candidate';
      next.activationBlockedReason = 'missing_auth_evidence';
      next.planCallable = false;
      next.runtimeCallable = false;
      next.autoExecutable = false;
      next.executionDisposition = next.executionDisposition ?? 'controlled';
      next.executionGates = [...new Set([...(Array.isArray(next.executionGates) ? next.executionGates : []), 'session_required'])];
      next.evidenceMatrix = {
        ...matrix,
        activationDecision: 'requires_login',
      };
      next.activationEvidence = next.evidenceMatrix;
      return next;
    }
    const disposition = next.executionDisposition === 'blocked' ? 'blocked' : 'controlled';
    next.executionPlan = {
      ...next.executionPlan,
      governedExecution: true,
      executionDisposition: disposition,
      autoExecute: false,
      steps: (Array.isArray(next.executionPlan.steps) ? next.executionPlan.steps : []).map((step) => ({
        ...step,
        governedExecution: true,
        executionDisposition: disposition,
        autoExecute: false,
      })),
    };
    next.status = 'active';
    next.enabled_status = next.enabled_status === 'disabled' ? 'disabled' : 'enabled';
    next.default_policy = next.default_policy === 'disabled' ? 'disabled' : 'enabled';
    next.evidence_status = next.evidence_status === 'verified' ? 'verified' : 'inferred';
    next.activationBlockedReason = 'missing_auth_evidence';
    next.planCallable = Boolean(next.executionPlan);
    next.runtimeCallable = Boolean(next.executionPlan) && disposition !== 'blocked';
    next.autoExecutable = false;
    next.executionDisposition = disposition;
    next.executionGates = [...new Set([...(Array.isArray(next.executionGates) ? next.executionGates : []), 'session_required'])];
    next.evidenceMatrix = {
      ...matrix,
      activationDecision: 'requires_login',
    };
    next.activationEvidence = next.evidenceMatrix;
    return next;
  }
  if (matrix.missingEvidence.length > 0) {
    delete next.executionPlan;
    next.status = next.status === 'disabled' ? 'disabled' : 'candidate';
    next.enabled_status = next.enabled_status === 'disabled' ? 'disabled' : 'candidate_debug_only';
    next.default_policy = next.enabled_status;
    next.evidence_status = 'candidate';
    next.activationBlockedReason = next.activationBlockedReason ?? 'capability-evidence-matrix-incomplete';
    return next;
  }
  if (matrix.authRequired && next.status === 'active') {
    next.enabled_status = next.enabled_status ?? 'enabled';
    next.default_policy = next.default_policy === 'read_only' ? 'enabled' : (next.default_policy ?? 'enabled');
    next.evidence_status = 'verified';
  }
  return next;
}
