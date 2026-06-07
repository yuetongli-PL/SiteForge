// @ts-check

import {
  CAPABILITY_GRAPH_DIFF_SCHEMA_VERSION,
  assertCapabilityGraphRegistryOutputSafe,
  sanitizeCapabilityGraphForRegistry,
} from './capability-graph-schema.mjs';
import {
  createStableCapabilityId,
} from './capability-graph-id.mjs';

const SEVERITY_RANK = Object.freeze({
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
});

const OPERATION_RANK = Object.freeze({
  public_read: 1,
  read: 1,
  query: 1,
  api: 1,
  download: 1,
  export: 1,
  write: 2,
  submit: 2,
  form_or_action: 2,
  destructive: 3,
  payment: 3,
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeToken(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

function normalizeList(value) {
  return [...new Set(asArray(value).map(normalizeToken).filter(Boolean))].sort();
}

function normalizeOperation(value) {
  const token = normalizeToken(value);
  if (['readonly', 'read_only', 'read-only'].includes(token)) return 'read';
  if (['form', 'action', 'form_action'].includes(token)) return 'form_or_action';
  if (['pay', 'purchase', 'billing'].includes(token)) return 'payment';
  return token || 'read';
}

function operationRank(value) {
  return OPERATION_RANK[normalizeOperation(value)] ?? 1;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^(true|yes|required|auth|required_by_runtime|concrete)$/iu.test(value)) return true;
    if (/^(false|no|none|public|not_required|not_concrete)$/iu.test(value)) return false;
  }
  return fallback;
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nodeMap(nodes = []) {
  return new Map(asArray(nodes).map((node) => [node.id, node]));
}

function firstNodeByTypeAndRef(nodesById, type, refField, refValue) {
  for (const node of nodesById.values()) {
    if (node.type === type && node[refField] === refValue) return node;
  }
  return null;
}

function resolveRefs(nodesById, refs = []) {
  return normalizeList(refs.flatMap((ref) => {
    const node = nodesById.get(ref);
    return [
      node?.authKind,
      ...(node?.requiredScopes ?? []),
      ...(node?.scopeRefs ?? []),
      ...(node?.allowedMaterial ?? []),
    ];
  }));
}

function descriptorFromCapability(capability = {}, nodesById = new Map()) {
  const id = createStableCapabilityId(capability);
  const executionContract = firstNodeByTypeAndRef(nodesById, 'ExecutionContractNode', 'capabilityRef', capability.id ?? capability.capabilityId);
  const runtimeBinding = executionContract?.runtimeBindingRef
    ? nodesById.get(executionContract.runtimeBindingRef)
    : null;
  const authRefs = [
    ...(capability.authRequirementRefs ?? []),
    executionContract?.authRequirementRef,
  ].filter(Boolean);
  const authFromRefs = resolveRefs(nodesById, authRefs);
  const operationKind = normalizeOperation(
    capability.operationKind
    ?? capability.capabilityKind
    ?? executionContract?.operationKind
    ?? capability.mode,
  );
  const destructiveAction = normalizeBoolean(
    capability.destructiveAction ?? executionContract?.destructiveAction,
    operationKind === 'destructive',
  );
  const paymentOrFundsAction = normalizeBoolean(
    capability.paymentOrFundsAction ?? executionContract?.paymentOrFundsAction,
    operationKind === 'payment',
  );
  const sideEffecting = normalizeBoolean(
    capability.sideEffecting ?? executionContract?.sideEffecting,
    operationRank(operationKind) >= 2 || destructiveAction || paymentOrFundsAction,
  );
  const authRequired = normalizeBoolean(
    capability.authRequired,
    normalizeToken(capability.authRequirement) === 'required'
      || authRefs.some((ref) => !/\bnone\b/iu.test(String(ref)))
      || authFromRefs.some((scope) => !['none', 'public'].includes(scope)),
  );

  return {
    id,
    siteKey: normalizeText(capability.siteKey),
    capabilityKey: normalizeText(capability.capabilityKey),
    operationKind,
    authRequired,
    authScopes: normalizeList([
      ...(capability.authScopes ?? []),
      ...(capability.requiredScopes ?? []),
      ...authFromRefs,
    ]),
    allowedOrigins: normalizeList(capability.allowedOrigins ?? executionContract?.allowedOrigins),
    materialTypes: normalizeList(capability.materialTypes ?? executionContract?.materialTypes ?? runtimeBinding?.allowedMaterial),
    injectionTargets: normalizeList(capability.injectionTargets ?? executionContract?.injectionTargets),
    providerCompatibility: normalizeList(
      capability.providerCompatibility
      ?? capability.providerIds
      ?? capability.compatibleProviders
      ?? executionContract?.providerCompatibility
      ?? runtimeBinding?.providerCompatibility
      ?? runtimeBinding?.providerIds,
    ),
    selectorConfidence: normalizeNumber(capability.selectorConfidence ?? executionContract?.selectorConfidence),
    executionContractConcrete: normalizeBoolean(
      capability.executionContractConcrete ?? capability.contractConcrete ?? executionContract?.executionContractConcrete ?? executionContract?.contractConcrete,
      true,
    ),
    destructiveAction,
    paymentOrFundsAction,
    sideEffecting,
    completionSignals: normalizeList(capability.completionSignals ?? capability.completionSignalRefs ?? executionContract?.completionSignals ?? executionContract?.completionSignalRefs),
  };
}

export function extractCapabilityGraphDescriptors(graph = {}) {
  const sanitized = sanitizeCapabilityGraphForRegistry(graph);
  const nodesById = nodeMap(sanitized.nodes);
  const descriptors = [
    ...asArray(sanitized.capabilities),
    ...asArray(sanitized.nodes).filter((node) => node.type === 'CapabilityNode'),
  ].map((capability) => descriptorFromCapability(capability, nodesById));

  const byId = new Map();
  for (const descriptor of descriptors) {
    byId.set(descriptor.id, descriptor);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function setAdded(previous = [], next = []) {
  const previousSet = new Set(previous);
  return next.filter((value) => !previousSet.has(value));
}

function setRemoved(previous = [], next = []) {
  const nextSet = new Set(next);
  return previous.filter((value) => !nextSet.has(value));
}

function arraysEqual(left = [], right = []) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function valueForReport(value) {
  if (Array.isArray(value)) return [...value];
  if (value === null || value === undefined) return null;
  return value;
}

function addChange(changes, capabilityId, field, severity, reasonCode, before, after, message) {
  changes.push({
    capabilityId,
    field,
    severity,
    reasonCode,
    before: valueForReport(before),
    after: valueForReport(after),
    message,
  });
}

function compareDescriptor(changes, previous, next, options = {}) {
  const threshold = Number.isFinite(options.selectorConfidenceThreshold)
    ? options.selectorConfidenceThreshold
    : 0.8;

  if (!previous.authRequired && next.authRequired) {
    addChange(changes, next.id, 'authRequired', 'high', 'capability.auth_requirement_added', previous.authRequired, next.authRequired, 'Capability changed from public to auth required.');
  }

  const addedScopes = setAdded(previous.authScopes, next.authScopes);
  if (addedScopes.length > 0) {
    addChange(changes, next.id, 'authScopes', 'high', 'capability.auth_scope_widened', previous.authScopes, next.authScopes, 'Capability auth scope widened.');
  }

  const previousRank = operationRank(previous.operationKind);
  const nextRank = operationRank(next.operationKind);
  if (previousRank < 2 && nextRank >= 2) {
    addChange(changes, next.id, 'operationKind', 'high', 'capability.read_to_write', previous.operationKind, next.operationKind, 'Capability changed from read-like to write-like.');
  }
  if (previousRank === 2 && (nextRank >= 3 || next.destructiveAction)) {
    addChange(changes, next.id, 'operationKind', 'critical', 'capability.write_to_destructive', previous.operationKind, next.operationKind, 'Capability changed from write to destructive.');
  }
  if (!previous.destructiveAction && next.destructiveAction) {
    addChange(changes, next.id, 'destructiveAction', 'critical', 'capability.destructive_introduced', previous.destructiveAction, next.destructiveAction, 'Destructive classification was introduced.');
  }
  if (!previous.paymentOrFundsAction && next.paymentOrFundsAction) {
    addChange(changes, next.id, 'paymentOrFundsAction', 'critical', 'capability.payment_introduced', previous.paymentOrFundsAction, next.paymentOrFundsAction, 'Payment classification was introduced.');
  }
  if (!previous.sideEffecting && next.sideEffecting) {
    addChange(changes, next.id, 'sideEffecting', 'high', 'capability.side_effect_introduced', previous.sideEffecting, next.sideEffecting, 'Capability changed from side-effect-free to side-effecting.');
  }

  if (!arraysEqual(previous.providerCompatibility, next.providerCompatibility)) {
    addChange(changes, next.id, 'providerCompatibility', 'high', 'capability.provider_compatibility_changed', previous.providerCompatibility, next.providerCompatibility, 'Provider compatibility changed.');
  }

  if (previous.selectorConfidence !== null && next.selectorConfidence !== null && next.selectorConfidence < previous.selectorConfidence) {
    addChange(
      changes,
      next.id,
      'selectorConfidence',
      next.selectorConfidence < threshold ? 'high' : 'medium',
      'capability.selector_confidence_decreased',
      previous.selectorConfidence,
      next.selectorConfidence,
      'Selector confidence decreased.',
    );
  }

  if (previous.executionContractConcrete && !next.executionContractConcrete) {
    addChange(changes, next.id, 'executionContractConcrete', 'high', 'capability.contract_concreteness_decreased', previous.executionContractConcrete, next.executionContractConcrete, 'Execution contract changed from concrete to not concrete.');
  }

  const addedOrigins = setAdded(previous.allowedOrigins, next.allowedOrigins);
  if (addedOrigins.length > 0 || next.allowedOrigins.includes('*')) {
    addChange(changes, next.id, 'allowedOrigins', 'high', 'capability.allowed_origins_widened', previous.allowedOrigins, next.allowedOrigins, 'Allowed origins widened.');
  }

  const addedMaterialTypes = setAdded(previous.materialTypes, next.materialTypes);
  if (addedMaterialTypes.length > 0) {
    addChange(changes, next.id, 'materialTypes', 'high', 'capability.material_type_widened', previous.materialTypes, next.materialTypes, 'Allowed material types widened.');
  }

  if (!arraysEqual(previous.injectionTargets, next.injectionTargets)) {
    addChange(changes, next.id, 'injectionTargets', 'high', 'capability.injection_target_changed', previous.injectionTargets, next.injectionTargets, 'Injection target changed.');
  }

  const removedSignals = setRemoved(previous.completionSignals, next.completionSignals);
  if (removedSignals.length > 0) {
    addChange(changes, next.id, 'completionSignals', 'high', 'capability.completion_signal_removed', previous.completionSignals, next.completionSignals, 'Completion signal removed.');
  }
}

export function diffCapabilityGraphs(previousGraph = {}, nextGraph = {}, options = {}) {
  const previousDescriptors = extractCapabilityGraphDescriptors(previousGraph);
  const nextDescriptors = extractCapabilityGraphDescriptors(nextGraph);
  const previousById = new Map(previousDescriptors.map((descriptor) => [descriptor.id, descriptor]));
  const nextById = new Map(nextDescriptors.map((descriptor) => [descriptor.id, descriptor]));
  const changes = [];

  for (const [id, previous] of previousById.entries()) {
    const next = nextById.get(id);
    if (!next) {
      addChange(changes, id, 'capability', 'high', 'capability.removed', previous.id, null, 'Capability was removed.');
      continue;
    }
    compareDescriptor(changes, previous, next, options);
  }

  for (const [id, next] of nextById.entries()) {
    if (!previousById.has(id)) {
      addChange(changes, id, 'capability', 'medium', 'capability.added', null, next.id, 'Capability was added.');
    }
  }

  changes.sort((left, right) => (
    (SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity])
    || left.capabilityId.localeCompare(right.capabilityId)
    || left.reasonCode.localeCompare(right.reasonCode)
  ));

  const result = {
    schemaVersion: CAPABILITY_GRAPH_DIFF_SCHEMA_VERSION,
    previousGraphVersion: normalizeText(previousGraph.graphVersion ?? previousGraph.manifest?.graphDataVersion) || null,
    nextGraphVersion: normalizeText(nextGraph.graphVersion ?? nextGraph.manifest?.graphDataVersion) || null,
    summary: {
      previousCapabilityCount: previousDescriptors.length,
      nextCapabilityCount: nextDescriptors.length,
      changeCount: changes.length,
      highRiskChangeCount: changes.filter((change) => change.severity === 'high').length,
      criticalRiskChangeCount: changes.filter((change) => change.severity === 'critical').length,
    },
    changes,
  };
  assertCapabilityGraphRegistryOutputSafe(result, 'CapabilityGraphDiff');
  return result;
}

