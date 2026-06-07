// @ts-check

import {
  createStableCapabilityId,
} from './capability-graph-id.mjs';

export const CAPABILITY_GRAPH_SCHEMA_VERSION = 1;
export const CAPABILITY_GRAPH_REGISTRY_ENTRY_SCHEMA_VERSION = 1;
export const CAPABILITY_GRAPH_DIFF_SCHEMA_VERSION = 1;
export const CAPABILITY_GRAPH_COMPATIBILITY_SCHEMA_VERSION = 1;

const FORBIDDEN_KEY_PATTERN = /(?:^|[_-])(?:raw|cookie|cookies|token|tokens|authorization|headers?|credential|password|sessionhandle|session[_-]?object|vault[_-]?response|material[_-]?grant|grantid|request|response|body|storagestate|localstorage|sessionstorage|indexeddb|dom|screenshot|video|trace|cdp|submittedvalues|confirmationtoken|confirmationphrase|paymentcredential|card|bank|secret)(?:$|[_-])/iu;
const FORBIDDEN_KEY_TOKEN_PATTERN = /(?:raw|cookie|cookies|token|tokens|authorization|header|headers|credential|credentials|password|private|sessionhandle|sessionobject|sessionmaterial|vaultresponse|materialgrant|grantid|requestheader|responseheader|requestbody|responsebody|rawbody|storagestate|localstorage|sessionstorage|indexeddb|rawdom|screenshot|video|trace|cdp|submittedvalues|confirmationtoken|confirmationphrase|paymentcredential|card|bank|secret)/iu;
const FORBIDDEN_VALUE_PATTERN = /(?:sf_(?:global|graph)_[a-z0-9_]*secret|authorization:\s*bearer|cookie:|set-cookie:|raw\s+(?:cookie|token|body|dom|headers?|session)|storageState|localStorage|sessionStorage|IndexedDB|payment\s+credential|confirmation\s+(?:token|phrase))/iu;
const FORBIDDEN_OUTPUT_PATTERN = /(?:sf_(?:global|graph)_[a-z0-9_]*secret|rawCookie|sessionHandle|privateFormValue|paymentCredential|confirmationToken|storageState|localStorage|sessionStorage|IndexedDB|rawDom|screenshot|video|trace)/iu;

const GRAPH_ALLOWED_KEYS = Object.freeze(new Set([
  'schemaVersion',
  'graphVersion',
  'manifest',
  'nodes',
  'edges',
  'capabilities',
  'provenance',
  'sourceRefs',
  'generatedAt',
]));

const MANIFEST_ALLOWED_KEYS = Object.freeze(new Set([
  'schemaVersion',
  'graphSchemaVersion',
  'graphDataVersion',
  'layerCompatibility',
  'sourceInventories',
  'provenance',
  'generatedAt',
]));

const NODE_ALLOWED_KEYS = Object.freeze(new Set([
  'schemaVersion',
  'id',
  'type',
  'siteKey',
  'capabilityKey',
  'capabilityFamily',
  'mode',
  'operationKind',
  'requiresApproval',
  'supportedTaskTypes',
  'routeRefs',
  'authRequirementRefs',
  'sessionRequirementRefs',
  'riskPolicyRef',
  'sourceRefs',
  'testEvidenceRefs',
  'agentExposed',
  'endpointKind',
  'lifecycleState',
  'methodFamily',
  'capabilityRefs',
  'capabilityRef',
  'authRequirementRef',
  'sessionRequirementRef',
  'signerRef',
  'requestSchemaRef',
  'responseSchemaRef',
  'runtimeBindingRef',
  'governancePolicyRef',
  'versionRef',
  'state',
  'allowedActions',
  'blockedActions',
  'cooldownRequired',
  'isolationRequired',
  'manualRecoveryRequired',
  'degradable',
  'artifactWriteAllowed',
  'reasonCodeRefs',
  'executionDisposition',
  'executionVerdict',
  'executionGates',
  'auditRequired',
  'confirmationRequired',
  'destructiveConfirmationRequired',
  'paymentConfirmationRequired',
  'strongConfirmationRequired',
  'sitePolicyExplicitAllowRequired',
  'runtimeConstraintRequired',
  'naturalLanguageRequestGrantsExecution',
  'runtimeDispatchAllowedByDefault',
  'destructiveAction',
  'highRiskAction',
  'paymentOrFundsAction',
  'planCallable',
  'runtimeCallable',
  'autoExecutable',
  'redactionRequired',
  'authKind',
  'requiredFor',
  'requiredScopes',
  'scopeRefs',
  'allowedOrigins',
  'materialTypes',
  'injectionTargets',
  'providerCompatibility',
  'providerIds',
  'compatibleProviders',
  'selectorConfidence',
  'executionContractConcrete',
  'contractConcrete',
  'completionSignals',
  'completionSignalRefs',
  'bindingKind',
  'allowedMaterial',
  'forbiddenMaterial',
  'credentialMaterialPolicy',
]));

const EDGE_ALLOWED_KEYS = Object.freeze(new Set([
  'schemaVersion',
  'id',
  'type',
  'from',
  'to',
  'sourceRefs',
  'testEvidenceRefs',
]));

const CAPABILITY_ALLOWED_KEYS = Object.freeze(new Set([
  'schemaVersion',
  'id',
  'capabilityId',
  'siteKey',
  'capabilityKey',
  'capabilityFamily',
  'name',
  'mode',
  'operationKind',
  'capabilityKind',
  'authRequired',
  'authRequirement',
  'authScopes',
  'requiredScopes',
  'allowedOrigins',
  'materialTypes',
  'injectionTargets',
  'providerCompatibility',
  'providerIds',
  'compatibleProviders',
  'selectorConfidence',
  'executionContractConcrete',
  'contractConcrete',
  'destructiveAction',
  'paymentOrFundsAction',
  'sideEffecting',
  'completionSignals',
  'completionSignalRefs',
  'sourceRefs',
  'testEvidenceRefs',
  'provenance',
]));

const FLEXIBLE_SAFE_OBJECT_KEYS = Object.freeze(new Set([
  'layerCompatibility',
  'provenance',
]));

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function isForbiddenKey(key) {
  const text = String(key ?? '');
  const compact = text.toLowerCase().replace(/[^a-z0-9]+/gu, '');
  return FORBIDDEN_KEY_PATTERN.test(text) || FORBIDDEN_KEY_TOKEN_PATTERN.test(compact);
}

function isForbiddenScalar(value) {
  return typeof value === 'string' && FORBIDDEN_VALUE_PATTERN.test(value);
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function sanitizeScalar(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const text = normalizeText(value);
    return text && !isForbiddenScalar(text) ? text : undefined;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  return undefined;
}

function sanitizeFlexibleObject(value) {
  if (!isPlainObject(value)) return undefined;
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (isForbiddenKey(key)) continue;
    const sanitized = sanitizeGraphValue(key, value[key], null);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function sanitizeArray(key, value) {
  if (!Array.isArray(value)) return undefined;
  const output = value
    .map((item) => sanitizeGraphValue(key, item, null))
    .filter((item) => item !== undefined);
  return output.length > 0 ? output : [];
}

function sanitizeGraphValue(key, value, allowedKeys) {
  if (isForbiddenKey(key)) return undefined;
  if (Array.isArray(value)) return sanitizeArray(key, value);
  if (isPlainObject(value)) {
    if (FLEXIBLE_SAFE_OBJECT_KEYS.has(key)) return sanitizeFlexibleObject(value);
    return sanitizeFlexibleObject(value);
  }
  return sanitizeScalar(value);
}

function sanitizeAllowedObject(value, allowedKeys) {
  if (!isPlainObject(value)) return undefined;
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (!allowedKeys.has(key) || isForbiddenKey(key)) continue;
    const sanitized = sanitizeGraphValue(key, value[key], allowedKeys);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

function sanitizeList(value, allowedKeys) {
  return Array.isArray(value)
    ? value.map((item) => sanitizeAllowedObject(item, allowedKeys)).filter((item) => item && Object.keys(item).length > 0)
    : [];
}

function capabilityFromNode(node) {
  return {
    schemaVersion: node.schemaVersion,
    id: node.id,
    capabilityId: node.id,
    siteKey: node.siteKey,
    capabilityKey: node.capabilityKey,
    capabilityFamily: node.capabilityFamily,
    mode: node.mode,
    operationKind: node.operationKind,
    authRequired: Array.isArray(node.authRequirementRefs) && node.authRequirementRefs.some((ref) => !/\bnone\b/iu.test(String(ref))),
    sourceRefs: node.sourceRefs,
    testEvidenceRefs: node.testEvidenceRefs,
  };
}

export function sanitizeCapabilityGraphForRegistry(graph = {}) {
  if (!isPlainObject(graph)) {
    throw new TypeError('Capability graph must be a plain object');
  }

  const output = {
    schemaVersion: CAPABILITY_GRAPH_SCHEMA_VERSION,
    graphVersion: normalizeText(graph.graphVersion ?? graph.manifest?.graphDataVersion) || 'unversioned',
  };

  const manifest = sanitizeAllowedObject(graph.manifest, MANIFEST_ALLOWED_KEYS);
  if (manifest && Object.keys(manifest).length > 0) output.manifest = manifest;

  const nodes = sanitizeList(graph.nodes, NODE_ALLOWED_KEYS);
  if (nodes.length > 0) output.nodes = nodes;

  const edges = sanitizeList(graph.edges, EDGE_ALLOWED_KEYS);
  if (edges.length > 0) output.edges = edges;

  const capabilities = [
    ...sanitizeList(graph.capabilities, CAPABILITY_ALLOWED_KEYS).map((capability) => ({
      ...capability,
      capabilityId: capability.capabilityId ?? capability['id'] ?? createStableCapabilityId(capability),
    })),
    ...nodes.filter((node) => node.type === 'CapabilityNode').map(capabilityFromNode),
  ];
  if (capabilities.length > 0) {
    const byId = new Map();
    for (const capability of capabilities) {
      const id = normalizeText(capability.capabilityId ?? capability['id']);
      if (!id) continue;
      byId.set(id, sanitizeAllowedObject(capability, CAPABILITY_ALLOWED_KEYS));
    }
    output.capabilities = [...byId.values()];
  }

  const provenance = sanitizeFlexibleObject(graph.provenance);
  if (provenance) output.provenance = provenance;

  const sourceRefs = sanitizeArray('sourceRefs', graph.sourceRefs);
  if (sourceRefs) output.sourceRefs = sourceRefs;

  const generatedAt = sanitizeScalar(graph.generatedAt);
  if (generatedAt !== undefined) output.generatedAt = generatedAt;

  assertCapabilityGraphRegistryOutputSafe(output, 'CapabilityGraphRegistryOutput');
  return output;
}

export function assertCapabilityGraphRegistryOutputSafe(value, label = 'CapabilityGraphRegistryOutput') {
  const serialized = JSON.stringify(value);
  if (FORBIDDEN_VALUE_PATTERN.test(serialized) || FORBIDDEN_OUTPUT_PATTERN.test(serialized)) {
    throw new Error(`${label} contains forbidden raw material`);
  }
  return true;
}

export function listCapabilityGraphRegistrySchemaDefinitions() {
  return [
    {
      name: 'CapabilityGraphRegistryGraph',
      version: CAPABILITY_GRAPH_SCHEMA_VERSION,
      sourcePath: 'src/domain/capabilities/graph-registry/capability-graph-schema.mjs',
    },
    {
      name: 'CapabilityGraphRegistryEntry',
      version: CAPABILITY_GRAPH_REGISTRY_ENTRY_SCHEMA_VERSION,
      sourcePath: 'src/domain/capabilities/graph-registry/capability-graph-schema.mjs',
    },
    {
      name: 'CapabilityGraphDiff',
      version: CAPABILITY_GRAPH_DIFF_SCHEMA_VERSION,
      sourcePath: 'src/domain/capabilities/graph-registry/capability-graph-schema.mjs',
    },
    {
      name: 'CapabilityGraphCompatibility',
      version: CAPABILITY_GRAPH_COMPATIBILITY_SCHEMA_VERSION,
      sourcePath: 'src/domain/capabilities/graph-registry/capability-graph-schema.mjs',
    },
  ];
}
