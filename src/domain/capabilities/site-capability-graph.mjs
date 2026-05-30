// @ts-check

import { jsonClone } from '../../shared/clone.mjs';
import { assertNoForbiddenPatterns } from '../sessions/security-guard.mjs';
import {
  assertLifecycleEventObservabilityFields,
  assertLifecycleEventProducerInventoryCompatible,
  createLifecycleEventProducerInventory,
  createLifecycleEventSubscriberRegistry,
  normalizeLifecycleEvent,
  summarizeLifecycleEventProducerInventory,
  writeLifecycleEventArtifact,
} from '../lifecycle/lifecycle-events.mjs';
import { requireReasonCodeDefinition } from '../risks/reason-codes.mjs';

export const SITE_CAPABILITY_GRAPH_SCHEMA_VERSION = 1;
export const GRAPH_MANIFEST_SCHEMA_VERSION = 1;
export const GRAPH_NODE_SCHEMA_VERSION = 1;
export const GRAPH_EDGE_SCHEMA_VERSION = 1;
export const GRAPH_VALIDATION_REPORT_SCHEMA_VERSION = 1;
export const GRAPH_QUERY_RESULT_SCHEMA_VERSION = 1;
export const GRAPH_DOCS_SUMMARY_SCHEMA_VERSION = 1;
export const GRAPH_DOCS_GENERATION_EVENT_TYPE = 'graph.docs.summary.generated';
export const GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE = 'graph-runtime-consumer-disabled';
const FAILURE_MODE_CATALOG_ACTIONS = Object.freeze(['none', 'deprecate', 'block']);

export const GRAPH_DOCS_GENERATION_OBSERVABILITY_PROFILE = Object.freeze({
  requiredFields: Object.freeze([
    'traceId',
    'correlationId',
    'taskId',
    'siteKey',
    'taskType',
    'adapterVersion',
    'reasonCode',
  ]),
  requiredDetailFields: Object.freeze([
    'graphVersion',
    'capabilityId',
    'capabilityKey',
    'lifecycleEvent',
    'validationResult',
    'redactionResult',
    'riskState',
    'queryName',
    'artifactFamily',
    'redactionRequired',
  ]),
});

function createGraphRuntimeConsumerDisabledReason(message) {
  // @ts-ignore
  const definition = requireReasonCodeDefinition(GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE, {
    family: 'graph',
  });
  return {
    code: definition.code,
    message,
    retryable: definition.retryable,
    cooldownNeeded: definition.cooldownNeeded,
    isolationNeeded: definition.isolationNeeded,
    manualRecoveryNeeded: definition.manualRecoveryNeeded,
    artifactWriteAllowed: definition.artifactWriteAllowed,
  };
}

const GRAPH_DOCS_GENERATION_LIFECYCLE_RUNTIME_PRODUCT_KEYS = Object.freeze([
  'artifactPath',
  'artifactPayload',
  'auditPath',
  'dispatch',
  'downloadPolicy',
  'externalTelemetry',
  'externalTelemetryDispatch',
  'externalTelemetryDispatchEnabled',
  'handler',
  'rawArtifact',
  'sessionView',
  'subscriberResults',
  'subscribers',
  'taskList',
  'telemetrySink',
]);

const GRAPH_DOCS_LIFECYCLE_DISPATCH_DESIGN_RUNTIME_PRODUCT_KEYS = Object.freeze([
  'artifactPath',
  'artifactPayload',
  'auditPath',
  'dispatch',
  'dispatchLifecycleEvent',
  'downloadPolicy',
  'eventPath',
  'externalTelemetry',
  'handler',
  'outputPath',
  'rawArtifact',
  'repoArtifactPath',
  'sessionView',
  'subscriber',
  'subscriberResults',
  'subscribers',
  'taskList',
  'telemetrySink',
  'writePath',
]);

const GRAPH_DOCS_LIFECYCLE_DISPATCH_PREFLIGHT_DISABLED_FLAG_KEYS = Object.freeze([
  'runtimeDispatchEnabled',
  'externalTelemetryEnabled',
  'externalTelemetryDispatchEnabled',
  'subscriberRegistrationEnabled',
  'runtimeSubscriberEnabled',
  'runtimeDispatchProducerEnabled',
  'repoArtifactWriteEnabled',
  'runtimeArtifactWriteEnabled',
  'artifactWriteEnabled',
  'runtimeLogWriteEnabled',
  'sessionMaterializationEnabled',
]);

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_IMPLEMENTATION_PREFLIGHT_DISABLED_FLAG_KEYS = Object.freeze([
  'featureEnabled',
  'runtimeImplementationEnabled',
  'runtimeRegistrationAllowed',
  'runtimeRegistrationEnabled',
  'registrationAllowed',
  'integrationAllowed',
  'adapterWiringEnabled',
  'adapterWiringAllowed',
  'consumerIntegrationEnabled',
  'runtimeConsumerEnabled',
  'producerRegistrationAllowed',
  'producerRegistrationEnabled',
  'subscriberRegistrationAllowed',
  'telemetryDispatchAllowed',
  'telemetryDispatchEnabled',
  'runtimeDispatchAllowed',
  'dispatchWriteAllowed',
  'dispatchWriteEnabled',
  'logWriteAllowed',
  'logWriteEnabled',
  'artifactWriteAllowed',
  'externalTelemetryEnabled',
  'sessionMaterializationEnabled',
  'runtimeDispatchEnabled',
  'externalTelemetryDispatchEnabled',
  'subscriberRegistrationEnabled',
  'runtimeSubscriberEnabled',
  'runtimeDispatchProducerEnabled',
  'repoArtifactWriteEnabled',
  'runtimeArtifactWriteEnabled',
  'artifactWriteEnabled',
  'runtimeLogWriteEnabled',
]);

const GRAPH_DOCS_LIFECYCLE_DISPATCH_PREFLIGHT_RUNTIME_PRODUCT_KEYS = Object.freeze([
  'artifactPath',
  'auditPath',
  'dispatch',
  'dispatchLifecycleEvent',
  'downloadPolicy',
  'downloader',
  'eventPath',
  'externalTelemetry',
  'externalTelemetrySink',
  'handler',
  'logPath',
  'publisher',
  'runtimeArtifact',
  'runtimeLog',
  'sessionView',
  'siteAdapter',
  'standardTaskList',
  'subscriber',
  'subscriberResults',
  'subscribers',
  'taskList',
  'telemetrySink',
  'writePath',
]);

const DISABLED_GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_ADAPTER_RUNTIME_PRODUCT_KEYS = Object.freeze([
  'consumer',
  'runtimeConsumer',
  'registration',
  'subscriber',
  'subscribers',
  'subscriberResults',
  'subscriberRegistration',
  'registerProducer',
  'registerSubscriber',
  'producer',
  'producerRegistration',
  'telemetrySink',
  'externalTelemetry',
  'externalTelemetrySink',
  'dispatch',
  'dispatchLifecycleEvent',
  'event',
  'lifecycleEvent',
  'payload',
  'runtimeDispatch',
  'runtimePayload',
  'sourceRuntimePayload',
  'telemetryPayload',
  'dispatchPayload',
  'writePayload',
  'eventPath',
  'artifactPayload',
  'artifactPath',
  'auditPath',
  'writePath',
  'runtimeArtifact',
  'runtimeLog',
  'logPath',
  'sessionView',
  'siteAdapter',
  'siteAdapterPayload',
  'downloader',
  'downloadPolicy',
  'standardTaskList',
  'taskList',
  'handler',
  'publisher',
]);

export const GRAPH_NODE_TYPES = Object.freeze([
  'SiteNode',
  'CapabilityNode',
  'RouteNode',
  'EndpointNode',
  'AuthRequirementNode',
  'SessionRequirementNode',
  'SignerNode',
  'RiskPolicyNode',
  'SchemaNode',
  'ArtifactContractNode',
  'ArtifactNode',
  'TestEvidenceNode',
  'TestNode',
  'VersionNode',
  'FailureModeNode',
  'ObservabilityNode',
]);

export const GRAPH_EDGE_TYPES = Object.freeze([
  'site_declares_capability',
  'capability_exposed_on_route',
  'route_resolves_endpoint',
  'capability_requires_auth',
  'endpoint_requires_auth',
  'capability_requires_session',
  'endpoint_requires_session',
  'endpoint_requires_signer',
  'capability_guarded_by_risk_policy',
  'endpoint_guarded_by_risk_policy',
  'node_validated_by_schema',
  'node_produces_artifact',
  'artifact_guarded_by_redaction',
  'node_covered_by_test',
  'node_has_version',
  'node_fails_with',
  'observability_emits',
  'derived_from_layer_source',
]);

export const GRAPH_CAPABILITY_MODES = Object.freeze([
  'readOnly',
  'write',
  'download',
  'auth',
  'diagnostic',
  'maintenance',
]);

export const GRAPH_ENDPOINT_LIFECYCLE_STATES = Object.freeze([
  'observed',
  'candidate',
  'verified',
  'cataloged',
  'deprecated',
  'blocked',
]);

export const GRAPH_RISK_STATES = Object.freeze([
  'normal',
  'suspicious',
  'rate_limited',
  'captcha_required',
  'auth_expired',
  'permission_denied',
  'cooldown',
  'isolated',
  'manual_recovery_required',
  'blocked',
]);

export const GRAPH_VALIDATION_RESULT_VALUES = Object.freeze([
  'passed',
  'failed',
]);

const FORBIDDEN_GRAPH_FIELDS = Object.freeze([
  'cookie',
  'cookies',
  'csrf',
  'csrfToken',
  'authorization',
  'authorizationHeader',
  'SESSDATA',
  'accessToken',
  'refreshToken',
  'sessionId',
  'rawSession',
  'rawSessionMaterial',
  'browserProfile',
  'browserProfilePath',
  'userDataDir',
  'deviceFingerprint',
  'accountId',
  'ipAddress',
  'networkIdentifier',
  'handler',
  'execute',
  'executor',
  'taskRunner',
]);

const GRAPH_DOCS_FORBIDDEN_LIVE_RUNTIME_WORDINGS = Object.freeze([
  Object.freeze({ pattern: /\blive route execution\b/iu, label: 'live route execution' }),
  Object.freeze({ pattern: /\blive runtime\b/iu, label: 'live runtime' }),
  Object.freeze({ pattern: /\bruntime writes? enabled\b/iu, label: 'runtime write enabled' }),
  Object.freeze({ pattern: /\bruntime artifact writes? enabled\b/iu, label: 'runtime artifact write enabled' }),
  Object.freeze({ pattern: /\brepo writes? enabled\b/iu, label: 'repo write enabled' }),
  Object.freeze({ pattern: /\bexternal telemetry enabled\b/iu, label: 'external telemetry enabled' }),
  Object.freeze({ pattern: /\broute execution enabled\b/iu, label: 'route execution enabled' }),
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[-_]/gu, '');
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertCurrentSchemaVersion(value, expected, label) {
  const version = Number(value);
  if (!Number.isInteger(version)) {
    throw new Error(`${label} schemaVersion is required`);
  }
  if (version !== expected) {
    throw new Error(`${label} schemaVersion ${version} is not compatible with ${expected}`);
  }
}

function assertRequiredText(value, fieldName, label) {
  const text = normalizeText(value);
  if (!text) {
    throw new Error(`${label} ${fieldName} is required`);
  }
  return text;
}

function assertEnumValue(value, allowedValues, fieldName, label) {
  const text = assertRequiredText(value, fieldName, label);
  if (!allowedValues.includes(text)) {
    throw new Error(`${label} ${fieldName} is unsupported: ${text}`);
  }
  return text;
}

function assertOptionalEnumValue(value, allowedValues, fieldName, label) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const text = assertRequiredText(value, fieldName, label);
  if (!allowedValues.includes(text)) {
    throw new Error(`${label} ${fieldName} is unsupported`);
  }
  return text;
}

function assertStringArray(value, fieldName, label, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) {
      throw new Error(`${label} ${fieldName} is required`);
    }
    return true;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} ${fieldName} must be an array`);
  }
  for (const entry of value) {
    if (!normalizeText(entry)) {
      throw new Error(`${label} ${fieldName} entries must be non-empty strings`);
    }
  }
  return true;
}

function assertLayerSourceRiskPolicySourceRefs(value, label) {
  if (value === undefined || value === null) {
    throw new Error(`${label} sourceRefs must include at least one approved Layer config source`);
  }
  assertStringArray(value, 'sourceRefs', label);
  if (value.length === 0) {
    throw new Error(`${label} sourceRefs must include at least one approved Layer config source`);
  }
  for (const sourceRef of value) {
    if (![LAYER_SOURCE_SITE_CAPABILITIES_REF, LAYER_SOURCE_SITE_REGISTRY_REF].includes(sourceRef)) {
      throw new Error(`${label} sourceRefs contains unsupported Layer config source`);
    }
  }
  return true;
}

function assertBoolean(value, fieldName, label) {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} ${fieldName} must be a boolean`);
  }
}

function assertOptionalObject(value, fieldName, label) {
  if (value !== undefined && value !== null && !isPlainObject(value)) {
    throw new Error(`${label} ${fieldName} must be an object`);
  }
}

function assertNoForbiddenGraphFields(value, label, path = label) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenGraphFields(entry, label, `${path}[${index}]`));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_GRAPH_FIELDS.includes(key)) {
      throw new Error(`${label} must not contain forbidden field: ${path}.${key}`);
    }
    assertNoForbiddenGraphFields(entry, label, `${path}.${key}`);
  }
  return true;
}

function assertNoGraphDocsLiveRuntimeWording(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const { pattern, label: wordingLabel } of GRAPH_DOCS_FORBIDDEN_LIVE_RUNTIME_WORDINGS) {
    if (pattern.test(text)) {
      throw new Error(`${label} must not describe Graph docs output as live runtime: ${wordingLabel}`);
    }
  }
  return true;
}

function assertGraphRef(value, fieldName, label, { required = false } = {}) {
  const text = normalizeText(value);
  if (!text && required) {
    throw new Error(`${label} ${fieldName} is required`);
  }
  return true;
}

/** @param {Record<string, any>} options */
function publicFinding({
  reasonCode,
  message,
  nodeId,
  edgeId,
  field,
}) {
  return Object.fromEntries(
    Object.entries({
      reasonCode,
      message,
      nodeId,
      edgeId,
      field,
    }).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function graphNodeType(node) {
  return isPlainObject(node) ? normalizeText(node.type) : undefined;
}

function findGraphNode(nodeById, id, expectedType) {
  const node = nodeById.get(id);
  if (!node || graphNodeType(node) !== expectedType) {
    return null;
  }
  return node;
}

const cloneDescriptor = jsonClone;

function hasGraphEdge(edges, type, from, to) {
  return edges.some((edge) => edge.type === type && edge.from === from && edge.to === to);
}

function assertCommonNodeFields(node, label) {
  assertPlainObject(node, label);
  assertCurrentSchemaVersion(node.schemaVersion, GRAPH_NODE_SCHEMA_VERSION, label);
  assertRequiredText(node.id, 'id', label);
  assertEnumValue(node.type, GRAPH_NODE_TYPES, 'type', label);
  assertNoForbiddenGraphFields(node, label);
}

export function listSiteCapabilityGraphSchemaDefinitions() {
  return [
    ['SiteCapabilityGraph', SITE_CAPABILITY_GRAPH_SCHEMA_VERSION],
    ['GraphManifest', GRAPH_MANIFEST_SCHEMA_VERSION],
    ['GraphNode', GRAPH_NODE_SCHEMA_VERSION],
    ['GraphEdge', GRAPH_EDGE_SCHEMA_VERSION],
    ['GraphValidationReport', GRAPH_VALIDATION_REPORT_SCHEMA_VERSION],
    ['GraphQueryResult', GRAPH_QUERY_RESULT_SCHEMA_VERSION],
    ['GraphDocsSummary', GRAPH_DOCS_SUMMARY_SCHEMA_VERSION],
    ...GRAPH_NODE_TYPES.map((name) => [name, GRAPH_NODE_SCHEMA_VERSION]),
  ].map(([name, version]) => ({
    name,
    version,
    sourcePath: 'src/domain/capabilities/site-capability-graph.mjs',
  }));
}

/** @param {Record<string, any>} [manifest] */
export function assertGraphManifestCompatible(manifest = {}) {
  assertPlainObject(manifest, 'GraphManifest');
  assertCurrentSchemaVersion(manifest.schemaVersion, GRAPH_MANIFEST_SCHEMA_VERSION, 'GraphManifest');
  assertCurrentSchemaVersion(
    manifest.graphSchemaVersion,
    SITE_CAPABILITY_GRAPH_SCHEMA_VERSION,
    'GraphManifest graphSchemaVersion',
  );
  assertRequiredText(manifest.graphDataVersion, 'graphDataVersion', 'GraphManifest');
  assertOptionalObject(manifest.layerCompatibility, 'layerCompatibility', 'GraphManifest');
  assertStringArray(manifest.sourceInventories, 'sourceInventories', 'GraphManifest');
  assertNoForbiddenGraphFields(manifest, 'GraphManifest');
  return true;
}

/** @param {Record<string, any>} [node] */
export function assertSiteNodeCompatible(node = {}) {
  assertCommonNodeFields(node, 'SiteNode');
  assertEnumValue(node.type, ['SiteNode'], 'type', 'SiteNode');
  assertRequiredText(node.siteKey, 'siteKey', 'SiteNode');
  assertStringArray(node.hostFamily, 'hostFamily', 'SiteNode', { required: true });
  assertOptionalObject(node.adapterRef, 'adapterRef', 'SiteNode');
  return true;
}

/** @param {Record<string, any>} [node] */
export function assertCapabilityNodeCompatible(node = {}) {
  assertCommonNodeFields(node, 'CapabilityNode');
  assertEnumValue(node.type, ['CapabilityNode'], 'type', 'CapabilityNode');
  assertRequiredText(node.siteKey, 'siteKey', 'CapabilityNode');
  assertRequiredText(node.capabilityKey, 'capabilityKey', 'CapabilityNode');
  assertRequiredText(node.capabilityFamily, 'capabilityFamily', 'CapabilityNode');
  assertEnumValue(node.mode, GRAPH_CAPABILITY_MODES, 'mode', 'CapabilityNode');
  assertBoolean(node.requiresApproval, 'requiresApproval', 'CapabilityNode');
  assertStringArray(node.supportedTaskTypes, 'supportedTaskTypes', 'CapabilityNode', { required: true });
  assertStringArray(node.routeRefs, 'routeRefs', 'CapabilityNode', { required: true });
  assertStringArray(node.authRequirementRefs, 'authRequirementRefs', 'CapabilityNode');
  assertStringArray(node.sessionRequirementRefs, 'sessionRequirementRefs', 'CapabilityNode');
  assertGraphRef(node.riskPolicyRef, 'riskPolicyRef', 'CapabilityNode', { required: true });
  assertStringArray(node.sourceRefs, 'sourceRefs', 'CapabilityNode');
  assertStringArray(node.testEvidenceRefs, 'testEvidenceRefs', 'CapabilityNode');
  if (node.agentExposed !== undefined && node.agentExposed !== null) {
    assertBoolean(node.agentExposed, 'agentExposed', 'CapabilityNode');
  }
  return true;
}

/** @param {Record<string, any>} [node] */
export function assertRouteNodeCompatible(node = {}) {
  assertCommonNodeFields(node, 'RouteNode');
  assertEnumValue(node.type, ['RouteNode'], 'type', 'RouteNode');
  assertRequiredText(node.siteKey, 'siteKey', 'RouteNode');
  assertRequiredText(node.routeKind, 'routeKind', 'RouteNode');
  if (!normalizeText(node.urlPattern) && !normalizeText(node.commandPattern)) {
    throw new Error('RouteNode urlPattern or commandPattern is required');
  }
  assertRequiredText(node.pageType, 'pageType', 'RouteNode');
  assertStringArray(node.capabilityRefs, 'capabilityRefs', 'RouteNode', { required: true });
  assertStringArray(node.fallbackRouteRefs, 'fallbackRouteRefs', 'RouteNode');
  assertOptionalObject(node.adapterRef, 'adapterRef', 'RouteNode');
  assertGraphRef(node.riskPolicyRef, 'riskPolicyRef', 'RouteNode', { required: true });
  assertStringArray(node.sourceRefs, 'sourceRefs', 'RouteNode');
  assertStringArray(node.testEvidenceRefs, 'testEvidenceRefs', 'RouteNode');
  return true;
}

/** @param {Record<string, any>} [node] */
export function assertEndpointNodeCompatible(node = {}) {
  assertCommonNodeFields(node, 'EndpointNode');
  assertEnumValue(node.type, ['EndpointNode'], 'type', 'EndpointNode');
  assertRequiredText(node.siteKey, 'siteKey', 'EndpointNode');
  assertRequiredText(node.endpointKind, 'endpointKind', 'EndpointNode');
  assertEnumValue(
    node.lifecycleState ?? node.status,
    GRAPH_ENDPOINT_LIFECYCLE_STATES,
    'lifecycleState',
    'EndpointNode',
  );
  assertRequiredText(node.methodFamily, 'methodFamily', 'EndpointNode');
  assertStringArray(node.routeRefs, 'routeRefs', 'EndpointNode', { required: true });
  assertStringArray(node.capabilityRefs, 'capabilityRefs', 'EndpointNode', { required: true });
  assertGraphRef(node.authRequirementRef, 'authRequirementRef', 'EndpointNode', { required: true });
  assertGraphRef(node.sessionRequirementRef, 'sessionRequirementRef', 'EndpointNode', { required: true });
  assertGraphRef(node.signerRef, 'signerRef', 'EndpointNode', { required: true });
  assertGraphRef(node.requestSchemaRef, 'requestSchemaRef', 'EndpointNode', { required: true });
  assertGraphRef(node.responseSchemaRef, 'responseSchemaRef', 'EndpointNode', { required: true });
  assertGraphRef(node.riskPolicyRef, 'riskPolicyRef', 'EndpointNode', { required: true });
  assertGraphRef(node.versionRef, 'versionRef', 'EndpointNode', { required: true });
  assertStringArray(node.sourceRefs, 'sourceRefs', 'EndpointNode');
  assertStringArray(node.testEvidenceRefs, 'testEvidenceRefs', 'EndpointNode');
  return true;
}

/** @param {Record<string, any>} [node] */
export function assertAuthRequirementNodeCompatible(node = {}) {
  assertCommonNodeFields(node, 'AuthRequirementNode');
  assertEnumValue(node.type, ['AuthRequirementNode'], 'type', 'AuthRequirementNode');
  assertRequiredText(node.authKind, 'authKind', 'AuthRequirementNode');
  assertStringArray(node.requiredFor, 'requiredFor', 'AuthRequirementNode', { required: true });
  assertRequiredText(node.proofType, 'proofType', 'AuthRequirementNode');
  assertStringArray(node.allowedMaterial, 'allowedMaterial', 'AuthRequirementNode');
  assertStringArray(node.forbiddenMaterial, 'forbiddenMaterial', 'AuthRequirementNode');
  assertStringArray(node.reasonCodeRefs, 'reasonCodeRefs', 'AuthRequirementNode');
  return true;
}

/** @param {Record<string, any>} [node] */
export function assertSessionRequirementNodeCompatible(node = {}) {
  assertCommonNodeFields(node, 'SessionRequirementNode');
  assertEnumValue(node.type, ['SessionRequirementNode'], 'type', 'SessionRequirementNode');
  assertRequiredText(node.purpose, 'purpose', 'SessionRequirementNode');
  assertRequiredText(node.scope, 'scope', 'SessionRequirementNode');
  assertRequiredText(node.ttlClass, 'ttlClass', 'SessionRequirementNode');
  assertRequiredText(node.permissionClass, 'permissionClass', 'SessionRequirementNode');
  assertRequiredText(node.profileIsolation, 'profileIsolation', 'SessionRequirementNode');
  assertRequiredText(node.networkContextClass, 'networkContextClass', 'SessionRequirementNode');
  assertBoolean(node.auditRequired, 'auditRequired', 'SessionRequirementNode');
  assertBoolean(node.revocationRequired, 'revocationRequired', 'SessionRequirementNode');
  return true;
}

/** @param {Record<string, any>} [node] */
export function assertSignerNodeCompatible(node = {}) {
  assertCommonNodeFields(node, 'SignerNode');
  assertEnumValue(node.type, ['SignerNode'], 'type', 'SignerNode');
  assertRequiredText(node.siteKey, 'siteKey', 'SignerNode');
  assertRequiredText(node.signerKind, 'signerKind', 'SignerNode');
  assertOptionalObject(node.adapterRef, 'adapterRef', 'SignerNode');
  assertGraphRef(node.versionRef, 'versionRef', 'SignerNode', { required: true });
  assertStringArray(node.supportedEndpointRefs, 'supportedEndpointRefs', 'SignerNode', { required: true });
  assertStringArray(node.testEvidenceRefs, 'testEvidenceRefs', 'SignerNode');
  assertStringArray(node.failureModeRefs, 'failureModeRefs', 'SignerNode');
  return true;
}

/** @param {Record<string, any>} [node] */
export function assertRiskPolicyNodeCompatible(node = {}) {
  assertCommonNodeFields(node, 'RiskPolicyNode');
  assertEnumValue(node.type, ['RiskPolicyNode'], 'type', 'RiskPolicyNode');
  assertEnumValue(node.state, GRAPH_RISK_STATES, 'state', 'RiskPolicyNode');
  assertStringArray(node.allowedActions, 'allowedActions', 'RiskPolicyNode');
  assertStringArray(node.blockedActions, 'blockedActions', 'RiskPolicyNode');
  assertBoolean(node.requiresApproval, 'requiresApproval', 'RiskPolicyNode');
  assertBoolean(node.cooldownRequired, 'cooldownRequired', 'RiskPolicyNode');
  assertBoolean(node.isolationRequired, 'isolationRequired', 'RiskPolicyNode');
  assertBoolean(node.manualRecoveryRequired, 'manualRecoveryRequired', 'RiskPolicyNode');
  assertBoolean(node.degradable, 'degradable', 'RiskPolicyNode');
  assertBoolean(node.artifactWriteAllowed, 'artifactWriteAllowed', 'RiskPolicyNode');
  assertLayerSourceRiskPolicySourceRefs(node.sourceRefs, 'RiskPolicyNode');
  assertStringArray(node.reasonCodeRefs, 'reasonCodeRefs', 'RiskPolicyNode');
  return true;
}

/** @param {Record<string, any>} [node] */
export function assertSchemaNodeCompatible(node = {}) {
  assertCommonNodeFields(node, 'SchemaNode');
  assertEnumValue(node.type, ['SchemaNode'], 'type', 'SchemaNode');
  assertRequiredText(node.schemaName, 'schemaName', 'SchemaNode');
  assertCurrentSchemaVersion(node.governedVersion, GRAPH_NODE_SCHEMA_VERSION, 'SchemaNode governedVersion');
  assertRequiredText(node.owner, 'owner', 'SchemaNode');
  assertRequiredText(node.sourcePath, 'sourcePath', 'SchemaNode');
  return true;
}

/** @param {Record<string, any>} [node] */
export function assertArtifactNodeCompatible(node = {}) {
  const label = node?.type === 'ArtifactContractNode' ? 'ArtifactContractNode' : 'ArtifactNode';
  assertCommonNodeFields(node, label);
  assertEnumValue(node.type, ['ArtifactContractNode', 'ArtifactNode'], 'type', label);
  assertRequiredText(node.artifactFamily, 'artifactFamily', 'ArtifactNode');
  assertBoolean(node.redactionRequired, 'redactionRequired', 'ArtifactNode');
  assertGraphRef(node.schemaRef, 'schemaRef', 'ArtifactNode', { required: true });
  assertRequiredText(node.writeGuard, 'writeGuard', 'ArtifactNode');
  assertBoolean(node.auditRequired, 'auditRequired', 'ArtifactNode');
  return true;
}

export const assertArtifactContractNodeCompatible = assertArtifactNodeCompatible;

/** @param {Record<string, any>} [node] */
export function assertTestNodeCompatible(node = {}) {
  const label = node?.type === 'TestEvidenceNode' ? 'TestEvidenceNode' : 'TestNode';
  assertCommonNodeFields(node, label);
  assertEnumValue(node.type, ['TestEvidenceNode', 'TestNode'], 'type', label);
  assertRequiredText(node.testPath, 'testPath', label);
  assertRequiredText(node.command, 'command', label);
  assertRequiredText(node.result, 'result', label);
  assertRequiredText(node.fixtureType, 'fixtureType', label);
  return true;
}

export const assertTestEvidenceNodeCompatible = assertTestNodeCompatible;

/** @param {Record<string, any>} [node] */
export function assertVersionNodeCompatible(node = {}) {
  assertCommonNodeFields(node, 'VersionNode');
  assertEnumValue(node.type, ['VersionNode'], 'type', 'VersionNode');
  assertRequiredText(node.versionKind, 'versionKind', 'VersionNode');
  assertRequiredText(node.version, 'version', 'VersionNode');
  return true;
}

/** @param {Record<string, any>} [node] */
export function assertFailureModeNodeCompatible(node = {}) {
  assertCommonNodeFields(node, 'FailureModeNode');
  assertEnumValue(node.type, ['FailureModeNode'], 'type', 'FailureModeNode');
  assertRequiredText(node.reasonCode, 'reasonCode', 'FailureModeNode');
  assertBoolean(node.retryable, 'retryable', 'FailureModeNode');
  assertBoolean(node.cooldownRequired, 'cooldownRequired', 'FailureModeNode');
  assertBoolean(node.isolationRequired, 'isolationRequired', 'FailureModeNode');
  assertBoolean(node.manualRecoveryRequired, 'manualRecoveryRequired', 'FailureModeNode');
  assertBoolean(node.degradable, 'degradable', 'FailureModeNode');
  assertBoolean(node.artifactWriteAllowed, 'artifactWriteAllowed', 'FailureModeNode');
  assertOptionalEnumValue(
    node.catalogAction,
    FAILURE_MODE_CATALOG_ACTIONS,
    'catalogAction',
    'FailureModeNode',
  );
  return true;
}

/** @param {Record<string, any>} [node] */
export function assertObservabilityNodeCompatible(node = {}) {
  assertCommonNodeFields(node, 'ObservabilityNode');
  assertEnumValue(node.type, ['ObservabilityNode'], 'type', 'ObservabilityNode');
  assertRequiredText(node.eventName, 'eventName', 'ObservabilityNode');
  assertStringArray(node.requiredFields, 'requiredFields', 'ObservabilityNode', { required: true });
  assertStringArray(node.producerRefs, 'producerRefs', 'ObservabilityNode');
  return true;
}

const NODE_ASSERTIONS = Object.freeze({
  SiteNode: assertSiteNodeCompatible,
  CapabilityNode: assertCapabilityNodeCompatible,
  RouteNode: assertRouteNodeCompatible,
  EndpointNode: assertEndpointNodeCompatible,
  AuthRequirementNode: assertAuthRequirementNodeCompatible,
  SessionRequirementNode: assertSessionRequirementNodeCompatible,
  SignerNode: assertSignerNodeCompatible,
  RiskPolicyNode: assertRiskPolicyNodeCompatible,
  SchemaNode: assertSchemaNodeCompatible,
  ArtifactContractNode: assertArtifactContractNodeCompatible,
  ArtifactNode: assertArtifactNodeCompatible,
  TestEvidenceNode: assertTestEvidenceNodeCompatible,
  TestNode: assertTestNodeCompatible,
  VersionNode: assertVersionNodeCompatible,
  FailureModeNode: assertFailureModeNodeCompatible,
  ObservabilityNode: assertObservabilityNodeCompatible,
});

/** @param {Record<string, any>} [node] */
export function assertGraphNodeCompatible(node = {}) {
  assertCommonNodeFields(node, 'GraphNode');
  NODE_ASSERTIONS[node.type](node);
  return true;
}

/** @param {Record<string, any>} [edge] */
export function assertGraphEdgeCompatible(edge = {}) {
  assertPlainObject(edge, 'GraphEdge');
  assertCurrentSchemaVersion(edge.schemaVersion, GRAPH_EDGE_SCHEMA_VERSION, 'GraphEdge');
  assertRequiredText(edge.id, 'id', 'GraphEdge');
  assertEnumValue(edge.type, GRAPH_EDGE_TYPES, 'type', 'GraphEdge');
  assertGraphRef(edge.from, 'from', 'GraphEdge', { required: true });
  assertGraphRef(edge.to, 'to', 'GraphEdge', { required: true });
  assertStringArray(edge.sourceRefs, 'sourceRefs', 'GraphEdge');
  assertStringArray(edge.testEvidenceRefs, 'testEvidenceRefs', 'GraphEdge');
  assertNoForbiddenGraphFields(edge, 'GraphEdge');
  return true;
}

/** @param {Record<string, any>} [graph] */
export function assertSiteCapabilityGraphCompatible(graph = {}) {
  assertPlainObject(graph, 'SiteCapabilityGraph');
  assertCurrentSchemaVersion(graph.schemaVersion, SITE_CAPABILITY_GRAPH_SCHEMA_VERSION, 'SiteCapabilityGraph');
  assertRequiredText(graph.graphVersion, 'graphVersion', 'SiteCapabilityGraph');
  assertGraphManifestCompatible(graph.manifest);
  if (!Array.isArray(graph.nodes)) {
    throw new Error('SiteCapabilityGraph nodes must be an array');
  }
  if (!Array.isArray(graph.edges)) {
    throw new Error('SiteCapabilityGraph edges must be an array');
  }
  graph.nodes.forEach((node) => assertGraphNodeCompatible(node));
  graph.edges.forEach((edge) => assertGraphEdgeCompatible(edge));
  assertNoForbiddenGraphFields(graph, 'SiteCapabilityGraph');
  return true;
}

/** @param {Record<string, any>} [report] */
export function assertGraphValidationReportCompatible(report = {}) {
  assertPlainObject(report, 'GraphValidationReport');
  assertCurrentSchemaVersion(
    report.schemaVersion,
    GRAPH_VALIDATION_REPORT_SCHEMA_VERSION,
    'GraphValidationReport',
  );
  assertRequiredText(report.graphVersion, 'graphVersion', 'GraphValidationReport');
  assertRequiredText(report.result, 'result', 'GraphValidationReport');
  if (!Array.isArray(report.findings)) {
    throw new Error('GraphValidationReport findings must be an array');
  }
  assertNoForbiddenGraphFields(report, 'GraphValidationReport');
  return true;
}

/** @param {Record<string, any>} [result] */
export function assertGraphQueryResultCompatible(result = {}) {
  assertPlainObject(result, 'GraphQueryResult');
  assertCurrentSchemaVersion(result.schemaVersion, GRAPH_QUERY_RESULT_SCHEMA_VERSION, 'GraphQueryResult');
  assertRequiredText(result.graphVersion, 'graphVersion', 'GraphQueryResult');
  assertRequiredText(result.queryName, 'queryName', 'GraphQueryResult');
  if (!Array.isArray(result.items)) {
    throw new Error('GraphQueryResult items must be an array');
  }
  assertNoForbiddenGraphFields(result, 'GraphQueryResult');
  return true;
}

/** @param {Record<string, any>} [summary] */
export function assertGraphDocsSummaryCompatible(summary = {}) {
  assertPlainObject(summary, 'GraphDocsSummary');
  assertCurrentSchemaVersion(summary.schemaVersion, GRAPH_DOCS_SUMMARY_SCHEMA_VERSION, 'GraphDocsSummary');
  assertRequiredText(summary.graphVersion, 'graphVersion', 'GraphDocsSummary');
  assertRequiredText(summary.artifactFamily, 'artifactFamily', 'GraphDocsSummary');
  assertBoolean(summary.redactionRequired, 'redactionRequired', 'GraphDocsSummary');
  if (summary.redactionRequired !== true) {
    throw new Error('GraphDocsSummary redactionRequired must be true');
  }
  assertPlainObject(summary.sections, 'GraphDocsSummary.sections');
  for (const sectionName of [
    'capabilityList',
    'dependencyMap',
    'dependencyMapByEdgeType',
    'routeDependencySummary',
    'endpointImpactMap',
    'authRequirementSummary',
    'signerDependencySummary',
    'riskPolicySummary',
    'failureModeSummary',
    'agentExposedCapabilityList',
    'testCoverageSummary',
    'layerDesignSourceReferences',
  ]) {
    if (!Array.isArray(summary.sections[sectionName])) {
      throw new Error(`GraphDocsSummary sections.${sectionName} must be an array`);
    }
  }
  assertNoGraphDocsLiveRuntimeWording(summary, 'GraphDocsSummary');
  assertNoForbiddenGraphFields(summary, 'GraphDocsSummary');
  return true;
}

/** @param {Record<string, any>} [artifact] */
function detectGraphDerivedArtifactKind(artifact = {}) {
  if (artifact.type === 'ArtifactNode' || artifact.type === 'ArtifactContractNode') {
    return artifact.type;
  }
  if (artifact.sections) {
    return 'GraphDocsSummary';
  }
  if (Array.isArray(artifact.findings)) {
    return 'GraphValidationReport';
  }
  if (Array.isArray(artifact.items) && normalizeText(artifact.queryName)) {
    return 'GraphQueryResult';
  }
  return null;
}

function assertNoGraphMetricFields(value, path = 'GraphObservabilityEvent') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoGraphMetricFields(entry, `${path}[${index}]`));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:metrics?|metricName|counter|durationMs|latencyMs|timingMs)$/iu.test(key)) {
      throw new Error(`Graph observability fixture must not include fake metric field: ${path}.${key}`);
    }
    assertNoGraphMetricFields(child, `${path}.${key}`);
  }
  return true;
}

const GRAPH_LIFECYCLE_PRODUCER_INVENTORY_OBSERVABILITY_COVERAGE_QUERY_NAME =
  'createGraphLifecycleProducerInventoryObservabilityCoverage';
const GRAPH_LIFECYCLE_PRODUCER_INVENTORY_OBSERVABILITY_COVERAGE_ARTIFACT_FAMILY =
  'site-capability-graph-lifecycle-producer-inventory-observability-coverage';

const GRAPH_LIFECYCLE_PRODUCER_INVENTORY_OBSERVABILITY_COVERAGE_DISABLED_FLAG_KEYS = Object.freeze([
  'externalTelemetryEnabled',
  'externalTelemetryDispatchEnabled',
  'externalTelemetrySinkEnabled',
  'runtimeDispatchEnabled',
  'runtimeDispatchProducerEnabled',
  'runtimeSubscriberEnabled',
  'subscriberRegistrationEnabled',
  'telemetryEnabled',
  'telemetrySinkEnabled',
  'writesArtifacts',
  'writesLogs',
  'artifactWriteEnabled',
  'repoArtifactWriteEnabled',
  'runtimeArtifactWriteEnabled',
  'logWriteEnabled',
  'runtimeLogWriteEnabled',
  'sessionMaterializationEnabled',
  'siteAdapterInvocationEnabled',
  'downloaderInvocationEnabled',
]);

const GRAPH_LIFECYCLE_PRODUCER_INVENTORY_OBSERVABILITY_COVERAGE_RUNTIME_PRODUCT_KEYS = Object.freeze([
  'accessToken',
  'authorization',
  'authorizationHeader',
  'browserProfile',
  'cookie',
  'cookies',
  'csrf',
  'csrfToken',
  'dispatch',
  'dispatchLifecycleEvent',
  'downloader',
  'externalTelemetry',
  'externalTelemetryDispatch',
  'externalTelemetrySink',
  'handler',
  'rawCredentials',
  'rawSession',
  'rawSessionMaterial',
  'refreshToken',
  'SESSDATA',
  'sessionId',
  'sessionView',
  'siteAdapter',
  'subscriber',
  'subscriberResults',
  'subscribers',
  'telemetrySink',
  'token',
]);

const GRAPH_LIFECYCLE_PRODUCER_INVENTORY_OBSERVABILITY_COVERAGE_DISABLED_FLAG_KEY_SET = new Set(
  GRAPH_LIFECYCLE_PRODUCER_INVENTORY_OBSERVABILITY_COVERAGE_DISABLED_FLAG_KEYS
    .map((key) => normalizeKey(key)),
);

const GRAPH_LIFECYCLE_PRODUCER_INVENTORY_OBSERVABILITY_COVERAGE_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_LIFECYCLE_PRODUCER_INVENTORY_OBSERVABILITY_COVERAGE_RUNTIME_PRODUCT_KEYS
    .map((key) => normalizeKey(key)),
);

function assertNoGraphLifecycleProducerInventoryObservabilityCoverageRuntimeProducts(
  value,
  label = 'GraphLifecycleProducerInventoryObservabilityCoverage',
  path = label,
) {
  if (typeof value === 'function') {
    throw new Error(`${label} descriptor-only rejected executable function at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoGraphLifecycleProducerInventoryObservabilityCoverageRuntimeProducts(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (
      normalizedKey.startsWith('externaltelemetry')
      || normalizedKey.startsWith('runtimedispatch')
      || GRAPH_LIFECYCLE_PRODUCER_INVENTORY_OBSERVABILITY_COVERAGE_DISABLED_FLAG_KEY_SET.has(normalizedKey)
    ) {
      if (entry !== false && entry !== undefined) {
        throw new Error(`${label} ${key} must remain false`);
      }
    } else if (
      GRAPH_LIFECYCLE_PRODUCER_INVENTORY_OBSERVABILITY_COVERAGE_RUNTIME_PRODUCT_KEY_SET
        .has(normalizedKey)
    ) {
      throw new Error(`${label} descriptor-only rejected runtime field: ${path}.${key}`);
    }
    assertNoGraphLifecycleProducerInventoryObservabilityCoverageRuntimeProducts(
      entry,
      label,
      `${path}.${key}`,
    );
  }
  return true;
}

function assertGraphLifecycleProducerInventoryObservabilityCoverageSummary(summary, label) {
  assertPlainObject(summary, label);
  if (!Number.isInteger(summary.eventTypeCount) || summary.eventTypeCount < 1) {
    throw new Error(`${label} eventTypeCount is required`);
  }
  if (!Number.isInteger(summary.profiledEventTypeCount) || summary.profiledEventTypeCount < 1) {
    throw new Error(`${label} profiledEventTypeCount is required`);
  }
  assertStringArray(summary.profiledEventTypes, 'profiledEventTypes', label, { required: true });
  assertStringArray(summary.inventoriedOnlyEventTypes, 'inventoriedOnlyEventTypes', label, { required: true });
  assertPlainObject(summary.producerModuleCounts, `${label}.producerModuleCounts`);
  for (const [modulePath, count] of Object.entries(summary.producerModuleCounts)) {
    if (!normalizeText(modulePath) || !modulePath.startsWith('src/') || !modulePath.endsWith('.mjs')) {
      throw new Error(`${label} producerModuleCounts contains unsupported module path`);
    }
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`${label} producerModuleCounts values must be positive integers`);
    }
  }
  if (summary.profiledEventTypes.includes(GRAPH_DOCS_GENERATION_EVENT_TYPE)) {
    throw new Error(`${label} must not treat graph.docs.summary.generated as a runtime producer profile`);
  }
  return true;
}

export function assertGraphLifecycleProducerInventoryObservabilityCoverageCompatibility(
  coverage = {},
) {
  assertPlainObject(coverage, 'GraphLifecycleProducerInventoryObservabilityCoverage');
  assertNoGraphLifecycleProducerInventoryObservabilityCoverageRuntimeProducts(coverage);
  assertNoForbiddenGraphFields(coverage, 'GraphLifecycleProducerInventoryObservabilityCoverage');
  assertNoForbiddenPatterns(coverage);
  assertNoGraphMetricFields(coverage, 'GraphLifecycleProducerInventoryObservabilityCoverage');
  assertGraphQueryResultCompatible(coverage);
  if (coverage.queryName !== GRAPH_LIFECYCLE_PRODUCER_INVENTORY_OBSERVABILITY_COVERAGE_QUERY_NAME) {
    throw new Error(
      'GraphLifecycleProducerInventoryObservabilityCoverage queryName must be '
      + GRAPH_LIFECYCLE_PRODUCER_INVENTORY_OBSERVABILITY_COVERAGE_QUERY_NAME,
    );
  }
  if (
    coverage.artifactFamily
    !== GRAPH_LIFECYCLE_PRODUCER_INVENTORY_OBSERVABILITY_COVERAGE_ARTIFACT_FAMILY
  ) {
    throw new Error(
      'GraphLifecycleProducerInventoryObservabilityCoverage artifactFamily must be '
      + GRAPH_LIFECYCLE_PRODUCER_INVENTORY_OBSERVABILITY_COVERAGE_ARTIFACT_FAMILY,
    );
  }
  if (coverage.redactionRequired !== true) {
    throw new Error('GraphLifecycleProducerInventoryObservabilityCoverage redactionRequired must be true');
  }
  if (coverage.descriptorOnly !== true) {
    throw new Error('GraphLifecycleProducerInventoryObservabilityCoverage descriptorOnly must be true');
  }
  if (!Array.isArray(coverage.items) || coverage.items.length !== 1) {
    throw new Error('GraphLifecycleProducerInventoryObservabilityCoverage must contain one item');
  }
  const [item] = coverage.items;
  assertPlainObject(item, 'GraphLifecycleProducerInventoryObservabilityCoverage.items[0]');
  if (item.schemaVersion !== 1) {
    throw new Error('GraphLifecycleProducerInventoryObservabilityCoverage item schemaVersion must be 1');
  }
  if (item.descriptorOnly !== true) {
    throw new Error('GraphLifecycleProducerInventoryObservabilityCoverage item descriptorOnly must be true');
  }
  if (item.redactionRequired !== true) {
    throw new Error('GraphLifecycleProducerInventoryObservabilityCoverage item redactionRequired must be true');
  }
  if (item.coverageMode !== 'descriptor-only-lifecycle-producer-inventory-summary') {
    throw new Error('GraphLifecycleProducerInventoryObservabilityCoverage coverageMode is unsupported');
  }
  for (const fieldName of GRAPH_LIFECYCLE_PRODUCER_INVENTORY_OBSERVABILITY_COVERAGE_DISABLED_FLAG_KEYS) {
    if (item[fieldName] !== false) {
      throw new Error(`GraphLifecycleProducerInventoryObservabilityCoverage ${fieldName} must be false`);
    }
  }
  if (item.docsGenerationEventType !== GRAPH_DOCS_GENERATION_EVENT_TYPE) {
    throw new Error('GraphLifecycleProducerInventoryObservabilityCoverage docsGenerationEventType is required');
  }
  if (item.docsGenerationRuntimeProducerProfile !== false) {
    throw new Error(
      'GraphLifecycleProducerInventoryObservabilityCoverage graph.docs.summary.generated is not a runtime producer profile',
    );
  }
  if (item.docsGenerationProfileSource !== 'graph-descriptor-only-event-fixture') {
    throw new Error('GraphLifecycleProducerInventoryObservabilityCoverage docsGenerationProfileSource is unsupported');
  }
  assertGraphLifecycleProducerInventoryObservabilityCoverageSummary(item.summary, 'GraphLifecycleProducerInventoryObservabilityCoverage.summary');
  return true;
}

/** @param {Record<string, any>} options */
export function createGraphLifecycleProducerInventoryObservabilityCoverage(options = {}) {
  assertPlainObject(options, 'GraphLifecycleProducerInventoryObservabilityCoverageOptions');
  assertNoGraphLifecycleProducerInventoryObservabilityCoverageRuntimeProducts(
    options,
    'GraphLifecycleProducerInventoryObservabilityCoverageOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphLifecycleProducerInventoryObservabilityCoverageOptions');
  assertNoForbiddenPatterns(options);
  assertNoGraphMetricFields(options, 'GraphLifecycleProducerInventoryObservabilityCoverageOptions');
  const {
    inventory = createLifecycleEventProducerInventory(),
    graphVersion = 'graph-lifecycle-producer-inventory-observability-coverage-v1',
    coverageName = 'site-capability-graph-lifecycle-producer-inventory-observability-coverage',
  } = options;
  assertLifecycleEventProducerInventoryCompatible(inventory);
  const summary = summarizeLifecycleEventProducerInventory({ inventory });
  const disabledFlags = Object.fromEntries(
    GRAPH_LIFECYCLE_PRODUCER_INVENTORY_OBSERVABILITY_COVERAGE_DISABLED_FLAG_KEYS
      .map((fieldName) => [fieldName, false]),
  );
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: assertRequiredText(
      graphVersion,
      'graphVersion',
      'GraphLifecycleProducerInventoryObservabilityCoverage',
    ),
    queryName: GRAPH_LIFECYCLE_PRODUCER_INVENTORY_OBSERVABILITY_COVERAGE_QUERY_NAME,
    artifactFamily: GRAPH_LIFECYCLE_PRODUCER_INVENTORY_OBSERVABILITY_COVERAGE_ARTIFACT_FAMILY,
    redactionRequired: true,
    descriptorOnly: true,
    items: [{
      schemaVersion: 1,
      coverageName: assertRequiredText(
        coverageName,
        'coverageName',
        'GraphLifecycleProducerInventoryObservabilityCoverage',
      ),
      coverageMode: 'descriptor-only-lifecycle-producer-inventory-summary',
      descriptorOnly: true,
      redactionRequired: true,
      summary,
      docsGenerationEventType: GRAPH_DOCS_GENERATION_EVENT_TYPE,
      docsGenerationRuntimeProducerProfile: false,
      docsGenerationProfileSource: 'graph-descriptor-only-event-fixture',
      docsGenerationProfileNote:
        'graph.docs.summary.generated is Graph descriptor-only observability evidence, not an inventoried runtime producer profile',
      ...disabledFlags,
    }],
  };
  assertGraphLifecycleProducerInventoryObservabilityCoverageCompatibility(result);
  return cloneDescriptor(result);
}

const GRAPH_DOCS_GENERATION_LIFECYCLE_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_DOCS_GENERATION_LIFECYCLE_RUNTIME_PRODUCT_KEYS.map((key) => normalizeKey(key)),
);

const GRAPH_DOCS_LIFECYCLE_DISPATCH_DESIGN_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_DOCS_LIFECYCLE_DISPATCH_DESIGN_RUNTIME_PRODUCT_KEYS.map((key) => normalizeKey(key)),
);

const GRAPH_DOCS_LIFECYCLE_DISPATCH_PREFLIGHT_DISABLED_FLAG_KEY_SET = new Set(
  GRAPH_DOCS_LIFECYCLE_DISPATCH_PREFLIGHT_DISABLED_FLAG_KEYS.map((key) => normalizeKey(key)),
);

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_IMPLEMENTATION_PREFLIGHT_DISABLED_FLAG_KEY_SET = new Set(
  GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_IMPLEMENTATION_PREFLIGHT_DISABLED_FLAG_KEYS
    .map((key) => normalizeKey(key)),
);

const GRAPH_DOCS_LIFECYCLE_DISPATCH_PREFLIGHT_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_DOCS_LIFECYCLE_DISPATCH_PREFLIGHT_RUNTIME_PRODUCT_KEYS.map((key) => normalizeKey(key)),
);

const DISABLED_GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_ADAPTER_RUNTIME_PRODUCT_KEY_SET = new Set(
  DISABLED_GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_ADAPTER_RUNTIME_PRODUCT_KEYS.map((key) => normalizeKey(key)),
);

function assertNoGraphDocsGenerationLifecycleRuntimeProducts(
  value,
  label = 'GraphDocsGenerationLifecycleEventConsumer',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoGraphDocsGenerationLifecycleRuntimeProducts(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (GRAPH_DOCS_GENERATION_LIFECYCLE_RUNTIME_PRODUCT_KEY_SET.has(normalizeKey(key))) {
      throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${path}.${key}`);
    }
    assertNoGraphDocsGenerationLifecycleRuntimeProducts(entry, label, `${path}.${key}`);
  }
  return true;
}

function assertNoGraphDocsLifecycleDispatchDesignRuntimeProducts(
  value,
  label = 'GraphDocsLifecycleDispatchDesign',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoGraphDocsLifecycleDispatchDesignRuntimeProducts(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (GRAPH_DOCS_LIFECYCLE_DISPATCH_DESIGN_RUNTIME_PRODUCT_KEY_SET.has(normalizeKey(key))) {
      throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${path}.${key}`);
    }
    assertNoGraphDocsLifecycleDispatchDesignRuntimeProducts(entry, label, `${path}.${key}`);
  }
  return true;
}

function assertNoGraphDocsLifecycleDispatchPreflightRuntimeProducts(
  value,
  label = 'GraphDocsLifecycleDispatchPreflight',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoGraphDocsLifecycleDispatchPreflightRuntimeProducts(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (GRAPH_DOCS_LIFECYCLE_DISPATCH_PREFLIGHT_DISABLED_FLAG_KEY_SET.has(normalizedKey)) {
      if (entry !== false && entry !== undefined) {
        throw new Error(`${label} ${key} must remain false`);
      }
    } else if (GRAPH_DOCS_LIFECYCLE_DISPATCH_PREFLIGHT_RUNTIME_PRODUCT_KEY_SET.has(normalizedKey)) {
      throw new Error(`${label} must remain descriptor-only and rejected unsafe runtime option: ${path}.${key}`);
    }
    assertNoGraphDocsLifecycleDispatchPreflightRuntimeProducts(entry, label, `${path}.${key}`);
  }
  return true;
}

function assertNoDisabledGraphDocsLifecycleObservabilityAdapterRuntimeProducts(
  value,
  label = 'DisabledGraphDocsLifecycleObservabilityAdapterHandshake',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoDisabledGraphDocsLifecycleObservabilityAdapterRuntimeProducts(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (GRAPH_DOCS_LIFECYCLE_DISPATCH_PREFLIGHT_DISABLED_FLAG_KEY_SET.has(normalizedKey)) {
      if (entry !== false && entry !== undefined) {
        throw new Error(`${label} descriptor-only ${key} must remain false`);
      }
    } else if (DISABLED_GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_ADAPTER_RUNTIME_PRODUCT_KEY_SET.has(normalizedKey)) {
      throw new Error(`${label} descriptor-only rejected runtime field: ${path}.${key}`);
    }
    assertNoDisabledGraphDocsLifecycleObservabilityAdapterRuntimeProducts(entry, label, `${path}.${key}`);
  }
  return true;
}

function assertNoGraphDocsLifecycleObservabilityRuntimeImplementationPreflightRuntimeProducts(
  value,
  label = 'GraphDocsLifecycleObservabilityRuntimeImplementationPreflight',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => (
      assertNoGraphDocsLifecycleObservabilityRuntimeImplementationPreflightRuntimeProducts(
        entry,
        label,
        `${path}[${index}]`,
      )
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (
      GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_IMPLEMENTATION_PREFLIGHT_DISABLED_FLAG_KEY_SET
        .has(normalizedKey)
    ) {
      if (entry !== false && entry !== undefined) {
        throw new Error(`${label} descriptor-only ${key} must remain false`);
      }
    } else if (DISABLED_GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_ADAPTER_RUNTIME_PRODUCT_KEY_SET.has(normalizedKey)) {
      throw new Error(`${label} descriptor-only rejected runtime field: ${path}.${key}`);
    }
    assertNoGraphDocsLifecycleObservabilityRuntimeImplementationPreflightRuntimeProducts(
      entry,
      label,
      `${path}.${key}`,
    );
  }
  return true;
}

/** @param {Record<string, any>} [event] */
export function assertGraphDocsGenerationObservabilityEvent(event = {}) {
  const normalized = normalizeLifecycleEvent(event, {
    eventType: GRAPH_DOCS_GENERATION_EVENT_TYPE,
    taskType: 'site-capability-graph-docs',
  });
  assertLifecycleEventObservabilityFields(normalized, GRAPH_DOCS_GENERATION_OBSERVABILITY_PROFILE);
  assertNoForbiddenGraphFields(normalized, 'GraphDocsGenerationObservabilityEvent');
  assertNoForbiddenPatterns(normalized);
  assertNoGraphMetricFields(normalized);
  return true;
}

/** @param {Record<string, any>} [event] */
export function assertGraphDocsGenerationLifecycleEventConsumerCompatibility(event = {}) {
  assertNoGraphDocsGenerationLifecycleRuntimeProducts(event);
  assertNoForbiddenGraphFields(event, 'GraphDocsGenerationLifecycleEventConsumer');
  assertNoForbiddenPatterns(event);
  assertNoGraphMetricFields(event, 'GraphDocsGenerationLifecycleEventConsumer');
  const normalized = normalizeLifecycleEvent(event, {
    eventType: GRAPH_DOCS_GENERATION_EVENT_TYPE,
    taskType: 'site-capability-graph-docs',
  });
  assertNoGraphDocsGenerationLifecycleRuntimeProducts(normalized);
  assertGraphDocsGenerationObservabilityEvent(normalized);
  if (normalized.eventType !== GRAPH_DOCS_GENERATION_EVENT_TYPE) {
    throw new Error(`GraphDocsGenerationLifecycleEventConsumer eventType must be ${GRAPH_DOCS_GENERATION_EVENT_TYPE}`);
  }
  if (normalized.taskType !== 'site-capability-graph-docs') {
    throw new Error('GraphDocsGenerationLifecycleEventConsumer taskType must be site-capability-graph-docs');
  }
  if (normalized.details.lifecycleEvent !== GRAPH_DOCS_GENERATION_EVENT_TYPE) {
    throw new Error('GraphDocsGenerationLifecycleEventConsumer lifecycleEvent detail is required');
  }
  if (normalized.details.queryName !== 'generateGraphDocsSummary') {
    throw new Error('GraphDocsGenerationLifecycleEventConsumer queryName must be generateGraphDocsSummary');
  }
  if (normalized.details.redactionRequired !== true) {
    throw new Error('GraphDocsGenerationLifecycleEventConsumer redactionRequired must be true');
  }
  return true;
}

/** @param {Record<string, any>} options */
export function createGraphDocsGenerationLifecycleEvent({
  summary,
  traceId,
  correlationId,
  taskId,
  siteKey,
  capabilityId,
  capabilityKey,
  routeId,
  adapterVersion,
  reasonCode = 'graph-docs-generation-failed',
  validationResult = 'failed',
  redactionResult = 'blocked',
  riskState = 'normal',
  plannerDecision = 'not-dispatched',
  createdAt,
  details = {},
} = {}) {
  assertGraphDocsSummaryCompatible(summary);
  const [firstCapability = {}] = summary.sections.capabilityList;
  const event = normalizeLifecycleEvent({
    eventType: GRAPH_DOCS_GENERATION_EVENT_TYPE,
    traceId,
    correlationId,
    taskId,
    siteKey: siteKey ?? firstCapability.siteKey,
    taskType: 'site-capability-graph-docs',
    adapterVersion,
    reasonCode,
    createdAt,
    details: {
      graphVersion: summary.graphVersion,
      capabilityId: capabilityId ?? firstCapability.id,
      capabilityKey: capabilityKey ?? firstCapability.capabilityKey,
      routeId,
      lifecycleEvent: GRAPH_DOCS_GENERATION_EVENT_TYPE,
      validationResult,
      redactionResult,
      riskState,
      plannerDecision,
      queryName: 'generateGraphDocsSummary',
      artifactFamily: summary.artifactFamily,
      redactionRequired: summary.redactionRequired,
      ...details,
    },
  });
  assertGraphDocsGenerationObservabilityEvent(event);
  assertGraphDocsGenerationLifecycleEventConsumerCompatibility(event);
  return event;
}

/** @param {Record<string, any>} [preflight] */
export function assertGraphDocsLifecycleDispatchPreflightCompatibility(preflight = {}) {
  assertPlainObject(preflight, 'GraphDocsLifecycleDispatchPreflight');
  assertNoGraphDocsLifecycleDispatchPreflightRuntimeProducts(preflight);
  assertNoForbiddenGraphFields(preflight, 'GraphDocsLifecycleDispatchPreflight');
  assertNoForbiddenPatterns(preflight);
  assertNoGraphMetricFields(preflight, 'GraphDocsLifecycleDispatchPreflight');
  assertGraphQueryResultCompatible(preflight);
  if (preflight.queryName !== 'createGraphDocsLifecycleDispatchPreflightContract') {
    throw new Error('GraphDocsLifecycleDispatchPreflight queryName must be createGraphDocsLifecycleDispatchPreflightContract');
  }
  if (preflight.artifactFamily !== 'site-capability-graph-lifecycle-dispatch-preflight-contract') {
    throw new Error('GraphDocsLifecycleDispatchPreflight artifactFamily must be site-capability-graph-lifecycle-dispatch-preflight-contract');
  }
  if (preflight.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleDispatchPreflight redactionRequired must be true');
  }
  if (!Array.isArray(preflight.items) || preflight.items.length === 0) {
    throw new Error('GraphDocsLifecycleDispatchPreflight items are required');
  }
  for (const [index, item] of preflight.items.entries()) {
    assertPlainObject(item, `GraphDocsLifecycleDispatchPreflight.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphDocsLifecycleDispatchPreflight item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.preflightMode !== 'contract-only') {
      throw new Error('GraphDocsLifecycleDispatchPreflight preflightMode must be contract-only');
    }
    if (item.phase !== 'descriptor-only-preflight') {
      throw new Error('GraphDocsLifecycleDispatchPreflight phase must be descriptor-only-preflight');
    }
    if (item.consumerMode !== 'disabled') {
      throw new Error('GraphDocsLifecycleDispatchPreflight consumerMode must be disabled');
    }
    if (item.result !== 'blocked') {
      throw new Error('GraphDocsLifecycleDispatchPreflight result must be blocked');
    }
    if (item.integrationAllowed !== false) {
      throw new Error('GraphDocsLifecycleDispatchPreflight integrationAllowed must be false');
    }
    for (const fieldName of GRAPH_DOCS_LIFECYCLE_DISPATCH_PREFLIGHT_DISABLED_FLAG_KEYS) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphDocsLifecycleDispatchPreflight ${fieldName} must be false`);
      }
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`GraphDocsLifecycleDispatchPreflight reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(item.reason, `GraphDocsLifecycleDispatchPreflight.items[${index}].reason`);
    if (item.reason.code !== item.reasonCode) {
      throw new Error('GraphDocsLifecycleDispatchPreflight reason code must match reasonCode');
    }
    if (item.requiredRuntimeGuard !== 'assertGraphDocsLifecycleDispatchPreflightCompatibility') {
      throw new Error('GraphDocsLifecycleDispatchPreflight requiredRuntimeGuard must be assertGraphDocsLifecycleDispatchPreflightCompatibility');
    }
    if (item.requiredSubscriberGuard !== 'assertGraphDocsLifecycleDispatchPreflightCompatibility') {
      throw new Error('GraphDocsLifecycleDispatchPreflight requiredSubscriberGuard must be assertGraphDocsLifecycleDispatchPreflightCompatibility');
    }
  }
  return true;
}

/** @param {Record<string, any>} options */
export function createGraphDocsLifecycleDispatchPreflightContract(options = {}) {
  assertPlainObject(options, 'GraphDocsLifecycleDispatchPreflightOptions');
  assertNoGraphDocsLifecycleDispatchPreflightRuntimeProducts(
    options,
    'GraphDocsLifecycleDispatchPreflightOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphDocsLifecycleDispatchPreflightOptions');
  assertNoForbiddenPatterns(options);
  assertNoGraphMetricFields(options, 'GraphDocsLifecycleDispatchPreflightOptions');
  const {
    graphVersion = 'graph-docs-lifecycle-dispatch-preflight-v1',
    preflightName = 'site-capability-graph-docs-lifecycle-dispatch-preflight',
    consumerName = 'site-capability-graph-docs-lifecycle-dispatch-consumer',
  } = options;
  const disabledFlags = Object.fromEntries(
    GRAPH_DOCS_LIFECYCLE_DISPATCH_PREFLIGHT_DISABLED_FLAG_KEYS.map((fieldName) => [fieldName, false]),
  );
  const preflight = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: assertRequiredText(
      graphVersion,
      'graphVersion',
      'GraphDocsLifecycleDispatchPreflight',
    ),
    queryName: 'createGraphDocsLifecycleDispatchPreflightContract',
    artifactFamily: 'site-capability-graph-lifecycle-dispatch-preflight-contract',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      preflightName: assertRequiredText(
        preflightName,
        'preflightName',
        'GraphDocsLifecycleDispatchPreflight',
      ),
      consumerName: assertRequiredText(
        consumerName,
        'consumerName',
        'GraphDocsLifecycleDispatchPreflight',
      ),
      preflightMode: 'contract-only',
      phase: 'descriptor-only-preflight',
      consumerMode: 'disabled',
      result: 'blocked',
      integrationAllowed: false,
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph docs lifecycle dispatch runtime observability integration is disabled by contract',
      ),
      requiredRuntimeGuard: 'assertGraphDocsLifecycleDispatchPreflightCompatibility',
      requiredSubscriberGuard: 'assertGraphDocsLifecycleDispatchPreflightCompatibility',
      forbiddenRuntimeOptions: GRAPH_DOCS_LIFECYCLE_DISPATCH_PREFLIGHT_RUNTIME_PRODUCT_KEYS,
      ...disabledFlags,
    }],
  };
  assertGraphDocsLifecycleDispatchPreflightCompatibility(preflight);
  return cloneDescriptor(preflight);
}

/** @param {Record<string, any>} [design] */
export function assertGraphDocsLifecycleDispatchDesignCompatibility(design = {}) {
  assertPlainObject(design, 'GraphDocsLifecycleDispatchDesign');
  assertNoGraphDocsLifecycleDispatchDesignRuntimeProducts(design);
  assertNoForbiddenGraphFields(design, 'GraphDocsLifecycleDispatchDesign');
  assertNoForbiddenPatterns(design);
  assertNoGraphMetricFields(design, 'GraphDocsLifecycleDispatchDesign');
  assertGraphQueryResultCompatible(design);
  if (design.queryName !== 'createGraphDocsLifecycleDispatchDesign') {
    throw new Error('GraphDocsLifecycleDispatchDesign queryName must be createGraphDocsLifecycleDispatchDesign');
  }
  if (design.artifactFamily !== 'site-capability-graph-lifecycle-dispatch-design') {
    throw new Error('GraphDocsLifecycleDispatchDesign artifactFamily must be site-capability-graph-lifecycle-dispatch-design');
  }
  if (design.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleDispatchDesign redactionRequired must be true');
  }
  if (!Array.isArray(design.items) || design.items.length === 0) {
    throw new Error('GraphDocsLifecycleDispatchDesign items are required');
  }
  for (const [index, item] of design.items.entries()) {
    assertPlainObject(item, `GraphDocsLifecycleDispatchDesign.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphDocsLifecycleDispatchDesign item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.dispatchMode !== 'design-only') {
      throw new Error('GraphDocsLifecycleDispatchDesign dispatchMode must be design-only');
    }
    for (const fieldName of [
      'runtimeDispatchEnabled',
      'externalTelemetryDispatchEnabled',
      'subscriberRegistrationEnabled',
      'repoArtifactWriteEnabled',
      'sessionMaterializationEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphDocsLifecycleDispatchDesign ${fieldName} must be false`);
      }
    }
    assertPlainObject(item.lifecycleEvent, `GraphDocsLifecycleDispatchDesign.items[${index}].lifecycleEvent`);
    assertGraphDocsGenerationLifecycleEventConsumerCompatibility(item.lifecycleEvent);
    if (item.requiredPreflightGuard !== 'assertGraphDocsLifecycleDispatchPreflightCompatibility') {
      throw new Error('GraphDocsLifecycleDispatchDesign requiredPreflightGuard must be assertGraphDocsLifecycleDispatchPreflightCompatibility');
    }
    assertPlainObject(item.sourcePreflight, `GraphDocsLifecycleDispatchDesign.items[${index}].sourcePreflight`);
    if (item.sourcePreflight.queryName !== 'createGraphDocsLifecycleDispatchPreflightContract') {
      throw new Error('GraphDocsLifecycleDispatchDesign sourcePreflight queryName must be createGraphDocsLifecycleDispatchPreflightContract');
    }
    if (item.sourcePreflight.artifactFamily !== 'site-capability-graph-lifecycle-dispatch-preflight-contract') {
      throw new Error('GraphDocsLifecycleDispatchDesign sourcePreflight artifactFamily must be site-capability-graph-lifecycle-dispatch-preflight-contract');
    }
    if (item.sourcePreflight.result !== 'blocked') {
      throw new Error('GraphDocsLifecycleDispatchDesign sourcePreflight result must be blocked');
    }
    if (item.sourcePreflight.integrationAllowed !== false) {
      throw new Error('GraphDocsLifecycleDispatchDesign sourcePreflight integrationAllowed must be false');
    }
    if (item.sourcePreflight.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`GraphDocsLifecycleDispatchDesign sourcePreflight reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
  }
  return true;
}

/** @param {Record<string, any>} options */
export function createGraphDocsLifecycleDispatchDesign(options = {}) {
  assertPlainObject(options, 'GraphDocsLifecycleDispatchDesignOptions');
  assertNoGraphDocsLifecycleDispatchDesignRuntimeProducts(
    options,
    'GraphDocsLifecycleDispatchDesignOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphDocsLifecycleDispatchDesignOptions');
  assertNoForbiddenPatterns(options);
  assertNoGraphMetricFields(options, 'GraphDocsLifecycleDispatchDesignOptions');
  const {
    dispatchName = 'site-capability-graph-docs-lifecycle-dispatch-design',
    runtimeDispatchEnabled,
    externalTelemetryDispatchEnabled,
    subscriberRegistrationEnabled,
    repoArtifactWriteEnabled,
    sessionMaterializationEnabled,
    preflight,
    sourcePreflight,
    ...eventOptions
  } = options;
  const lifecycleEvent = createGraphDocsGenerationLifecycleEvent(eventOptions);
  const preflightContract = preflight ?? sourcePreflight ?? createGraphDocsLifecycleDispatchPreflightContract({
    graphVersion: lifecycleEvent.details.graphVersion,
  });
  assertGraphDocsLifecycleDispatchPreflightCompatibility(preflightContract);
  const sourcePreflightItem = preflightContract.items[0];
  const design = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: lifecycleEvent.details.graphVersion,
    queryName: 'createGraphDocsLifecycleDispatchDesign',
    artifactFamily: 'site-capability-graph-lifecycle-dispatch-design',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      dispatchName: assertRequiredText(dispatchName, 'dispatchName', 'GraphDocsLifecycleDispatchDesign'),
      dispatchMode: 'design-only',
      runtimeDispatchEnabled: assertDisabledFlag(
        runtimeDispatchEnabled,
        'runtimeDispatchEnabled',
        'GraphDocsLifecycleDispatchDesign',
      ),
      externalTelemetryDispatchEnabled: assertDisabledFlag(
        externalTelemetryDispatchEnabled,
        'externalTelemetryDispatchEnabled',
        'GraphDocsLifecycleDispatchDesign',
      ),
      subscriberRegistrationEnabled: assertDisabledFlag(
        subscriberRegistrationEnabled,
        'subscriberRegistrationEnabled',
        'GraphDocsLifecycleDispatchDesign',
      ),
      repoArtifactWriteEnabled: assertDisabledFlag(
        repoArtifactWriteEnabled,
        'repoArtifactWriteEnabled',
        'GraphDocsLifecycleDispatchDesign',
      ),
      sessionMaterializationEnabled: assertDisabledFlag(
        sessionMaterializationEnabled,
        'sessionMaterializationEnabled',
        'GraphDocsLifecycleDispatchDesign',
      ),
      requiredConsumer: 'assertGraphDocsGenerationLifecycleEventConsumerCompatibility',
      requiredPreflightGuard: 'assertGraphDocsLifecycleDispatchPreflightCompatibility',
      requiredArtifactGuard: 'SecurityGuard/Redaction before graph-derived artifact writes',
      forbiddenRuntimeProducts: [
        'LifecycleSubscriberRegistration',
        'ExternalTelemetryDispatch',
        'RuntimeLifecycleDispatch',
        'SessionView',
        'StandardTaskList',
        'DownloadPolicy',
      ],
      sourcePreflight: {
        queryName: preflightContract.queryName,
        artifactFamily: preflightContract.artifactFamily,
        preflightMode: sourcePreflightItem.preflightMode,
        consumerMode: sourcePreflightItem.consumerMode,
        result: sourcePreflightItem.result,
        integrationAllowed: sourcePreflightItem.integrationAllowed,
        reasonCode: sourcePreflightItem.reasonCode,
        requiredRuntimeGuard: sourcePreflightItem.requiredRuntimeGuard,
        requiredSubscriberGuard: sourcePreflightItem.requiredSubscriberGuard,
      },
      lifecycleEvent,
    }],
  };
  assertGraphDocsLifecycleDispatchDesignCompatibility(design);
  return cloneDescriptor(design);
}

/** @param {Record<string, any>} [result] */
export function assertDisabledGraphDocsLifecycleDispatchConsumerResultCompatibility(result = {}) {
  assertPlainObject(result, 'DisabledGraphDocsLifecycleDispatchConsumerResult');
  assertNoGraphDocsLifecycleDispatchDesignRuntimeProducts(
    result,
    'DisabledGraphDocsLifecycleDispatchConsumerResult',
  );
  assertNoForbiddenGraphFields(result, 'DisabledGraphDocsLifecycleDispatchConsumerResult');
  assertNoForbiddenPatterns(result);
  assertNoGraphMetricFields(result, 'DisabledGraphDocsLifecycleDispatchConsumerResult');
  assertGraphQueryResultCompatible(result);
  if (result.queryName !== 'createDisabledGraphDocsLifecycleDispatchConsumerResult') {
    throw new Error('DisabledGraphDocsLifecycleDispatchConsumerResult queryName must be createDisabledGraphDocsLifecycleDispatchConsumerResult');
  }
  if (result.artifactFamily !== 'site-capability-graph-lifecycle-dispatch-consumer-result') {
    throw new Error('DisabledGraphDocsLifecycleDispatchConsumerResult artifactFamily must be site-capability-graph-lifecycle-dispatch-consumer-result');
  }
  if (result.redactionRequired !== true) {
    throw new Error('DisabledGraphDocsLifecycleDispatchConsumerResult redactionRequired must be true');
  }
  if (!Array.isArray(result.items) || result.items.length === 0) {
    throw new Error('DisabledGraphDocsLifecycleDispatchConsumerResult items are required');
  }
  for (const [index, item] of result.items.entries()) {
    assertPlainObject(item, `DisabledGraphDocsLifecycleDispatchConsumerResult.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`DisabledGraphDocsLifecycleDispatchConsumerResult item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.consumerMode !== 'disabled-feature-flag') {
      throw new Error('DisabledGraphDocsLifecycleDispatchConsumerResult consumerMode must be disabled-feature-flag');
    }
    if (item.featureEnabled !== false) {
      throw new Error('DisabledGraphDocsLifecycleDispatchConsumerResult featureEnabled must be false');
    }
    if (item.result !== 'blocked') {
      throw new Error('DisabledGraphDocsLifecycleDispatchConsumerResult result must be blocked');
    }
    if (item.dispatchAllowed !== false) {
      throw new Error('DisabledGraphDocsLifecycleDispatchConsumerResult dispatchAllowed must be false');
    }
    for (const fieldName of [
      'runtimeDispatchEnabled',
      'externalTelemetryEnabled',
      'externalTelemetryDispatchEnabled',
      'subscriberRegistrationEnabled',
      'runtimeSubscriberEnabled',
      'runtimeDispatchProducerEnabled',
      'repoArtifactWriteEnabled',
      'runtimeArtifactWriteEnabled',
      'artifactWriteEnabled',
      'runtimeLogWriteEnabled',
      'sessionMaterializationEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`DisabledGraphDocsLifecycleDispatchConsumerResult ${fieldName} must be false`);
      }
    }
    const reasonCode = assertRequiredText(
      item.reasonCode,
      'reasonCode',
      'DisabledGraphDocsLifecycleDispatchConsumerResult',
    );
    assertPlainObject(item.reason, `DisabledGraphDocsLifecycleDispatchConsumerResult.items[${index}].reason`);
    if (item.reason.code !== reasonCode) {
      throw new Error('DisabledGraphDocsLifecycleDispatchConsumerResult reason code must match reasonCode');
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`DisabledGraphDocsLifecycleDispatchConsumerResult reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(item.sourceDesign, `DisabledGraphDocsLifecycleDispatchConsumerResult.items[${index}].sourceDesign`);
    if (item.sourceDesign.queryName !== 'createGraphDocsLifecycleDispatchDesign') {
      throw new Error('DisabledGraphDocsLifecycleDispatchConsumerResult sourceDesign queryName must be createGraphDocsLifecycleDispatchDesign');
    }
    if (item.sourceDesign.artifactFamily !== 'site-capability-graph-lifecycle-dispatch-design') {
      throw new Error('DisabledGraphDocsLifecycleDispatchConsumerResult sourceDesign artifactFamily must be site-capability-graph-lifecycle-dispatch-design');
    }
    if (item.requiredPreflightGuard !== 'assertGraphDocsLifecycleDispatchPreflightCompatibility') {
      throw new Error('DisabledGraphDocsLifecycleDispatchConsumerResult requiredPreflightGuard must be assertGraphDocsLifecycleDispatchPreflightCompatibility');
    }
    assertPlainObject(item.sourcePreflight, `DisabledGraphDocsLifecycleDispatchConsumerResult.items[${index}].sourcePreflight`);
    if (item.sourcePreflight.queryName !== 'createGraphDocsLifecycleDispatchPreflightContract') {
      throw new Error('DisabledGraphDocsLifecycleDispatchConsumerResult sourcePreflight queryName must be createGraphDocsLifecycleDispatchPreflightContract');
    }
    if (item.sourcePreflight.artifactFamily !== 'site-capability-graph-lifecycle-dispatch-preflight-contract') {
      throw new Error('DisabledGraphDocsLifecycleDispatchConsumerResult sourcePreflight artifactFamily must be site-capability-graph-lifecycle-dispatch-preflight-contract');
    }
    if (item.sourcePreflight.result !== 'blocked') {
      throw new Error('DisabledGraphDocsLifecycleDispatchConsumerResult sourcePreflight result must be blocked');
    }
    if (item.sourcePreflight.integrationAllowed !== false) {
      throw new Error('DisabledGraphDocsLifecycleDispatchConsumerResult sourcePreflight integrationAllowed must be false');
    }
    if (item.sourcePreflight.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`DisabledGraphDocsLifecycleDispatchConsumerResult sourcePreflight reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(item.lifecycleEvent, `DisabledGraphDocsLifecycleDispatchConsumerResult.items[${index}].lifecycleEvent`);
    assertGraphDocsGenerationLifecycleEventConsumerCompatibility(item.lifecycleEvent);
    if (item.sourceLifecycleReasonCode !== item.lifecycleEvent.reasonCode) {
      throw new Error('DisabledGraphDocsLifecycleDispatchConsumerResult sourceLifecycleReasonCode must preserve lifecycle event reasonCode');
    }
  }
  return true;
}

/** @param {Record<string, any>} [design] */
export function createDisabledGraphDocsLifecycleDispatchConsumerResult(design = {}, options = {}) {
  assertGraphDocsLifecycleDispatchDesignCompatibility(design);
  assertPlainObject(options, 'DisabledGraphDocsLifecycleDispatchConsumerOptions');
  assertNoGraphDocsLifecycleDispatchDesignRuntimeProducts(
    options,
    'DisabledGraphDocsLifecycleDispatchConsumerOptions',
  );
  assertNoForbiddenGraphFields(options, 'DisabledGraphDocsLifecycleDispatchConsumerOptions');
  assertNoForbiddenPatterns(options);
  assertNoGraphMetricFields(options, 'DisabledGraphDocsLifecycleDispatchConsumerOptions');
  const {
    consumerName = 'site-capability-graph-docs-lifecycle-dispatch-consumer',
    featureEnabled,
    runtimeDispatchEnabled,
    externalTelemetryEnabled,
    externalTelemetryDispatchEnabled,
    subscriberRegistrationEnabled,
    runtimeSubscriberEnabled,
    runtimeDispatchProducerEnabled,
    repoArtifactWriteEnabled,
    runtimeArtifactWriteEnabled,
    artifactWriteEnabled,
    runtimeLogWriteEnabled,
    sessionMaterializationEnabled,
  } = options;
  assertDisabledFlag(
    featureEnabled,
    'featureEnabled',
    'DisabledGraphDocsLifecycleDispatchConsumerResult',
  );
  assertDisabledFlag(
    runtimeDispatchEnabled,
    'runtimeDispatchEnabled',
    'DisabledGraphDocsLifecycleDispatchConsumerResult',
  );
  assertDisabledFlag(
    externalTelemetryEnabled,
    'externalTelemetryEnabled',
    'DisabledGraphDocsLifecycleDispatchConsumerResult',
  );
  assertDisabledFlag(
    externalTelemetryDispatchEnabled,
    'externalTelemetryDispatchEnabled',
    'DisabledGraphDocsLifecycleDispatchConsumerResult',
  );
  assertDisabledFlag(
    subscriberRegistrationEnabled,
    'subscriberRegistrationEnabled',
    'DisabledGraphDocsLifecycleDispatchConsumerResult',
  );
  assertDisabledFlag(
    runtimeSubscriberEnabled,
    'runtimeSubscriberEnabled',
    'DisabledGraphDocsLifecycleDispatchConsumerResult',
  );
  assertDisabledFlag(
    runtimeDispatchProducerEnabled,
    'runtimeDispatchProducerEnabled',
    'DisabledGraphDocsLifecycleDispatchConsumerResult',
  );
  assertDisabledFlag(
    repoArtifactWriteEnabled,
    'repoArtifactWriteEnabled',
    'DisabledGraphDocsLifecycleDispatchConsumerResult',
  );
  assertDisabledFlag(
    runtimeArtifactWriteEnabled,
    'runtimeArtifactWriteEnabled',
    'DisabledGraphDocsLifecycleDispatchConsumerResult',
  );
  assertDisabledFlag(
    artifactWriteEnabled,
    'artifactWriteEnabled',
    'DisabledGraphDocsLifecycleDispatchConsumerResult',
  );
  assertDisabledFlag(
    runtimeLogWriteEnabled,
    'runtimeLogWriteEnabled',
    'DisabledGraphDocsLifecycleDispatchConsumerResult',
  );
  assertDisabledFlag(
    sessionMaterializationEnabled,
    'sessionMaterializationEnabled',
    'DisabledGraphDocsLifecycleDispatchConsumerResult',
  );
  const sourceItem = design.items[0];
  const lifecycleEvent = sourceItem.lifecycleEvent;
  const sourceLifecycleReasonCode = assertRequiredText(
    lifecycleEvent.reasonCode,
    'reasonCode',
    'DisabledGraphDocsLifecycleDispatchConsumerResult',
  );
  const reasonCode = GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE;
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: design.graphVersion,
    queryName: 'createDisabledGraphDocsLifecycleDispatchConsumerResult',
    artifactFamily: 'site-capability-graph-lifecycle-dispatch-consumer-result',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      consumerName: assertRequiredText(
        consumerName,
        'consumerName',
        'DisabledGraphDocsLifecycleDispatchConsumerResult',
      ),
      consumerMode: 'disabled-feature-flag',
      featureFlag: 'siteCapabilityGraphLifecycleDispatchEnabled',
      featureEnabled: false,
      result: 'blocked',
      reasonCode,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph docs lifecycle dispatch consumer is disabled by feature flag',
      ),
      sourceLifecycleReasonCode,
      dispatchAllowed: false,
      runtimeDispatchEnabled: false,
      externalTelemetryEnabled: false,
      externalTelemetryDispatchEnabled: false,
      subscriberRegistrationEnabled: false,
      runtimeSubscriberEnabled: false,
      runtimeDispatchProducerEnabled: false,
      repoArtifactWriteEnabled: false,
      runtimeArtifactWriteEnabled: false,
      artifactWriteEnabled: false,
      runtimeLogWriteEnabled: false,
      sessionMaterializationEnabled: false,
      requiredPreflightGuard: 'assertGraphDocsLifecycleDispatchPreflightCompatibility',
      sourceDesign: {
        queryName: design.queryName,
        artifactFamily: design.artifactFamily,
        dispatchMode: sourceItem.dispatchMode,
      },
      sourcePreflight: cloneDescriptor(sourceItem.sourcePreflight),
      lifecycleEvent,
    }],
  };
  assertDisabledGraphDocsLifecycleDispatchConsumerResultCompatibility(result);
  return cloneDescriptor(result);
}

function summarizeGraphDocsLifecycleDispatchPreflight(preflight) {
  assertGraphDocsLifecycleDispatchPreflightCompatibility(preflight);
  const sourcePreflightItem = preflight.items[0];
  return {
    queryName: preflight.queryName,
    artifactFamily: preflight.artifactFamily,
    graphVersion: preflight.graphVersion,
    redactionRequired: preflight.redactionRequired,
    preflightMode: sourcePreflightItem.preflightMode,
    consumerMode: sourcePreflightItem.consumerMode,
    result: sourcePreflightItem.result,
    integrationAllowed: sourcePreflightItem.integrationAllowed,
    reasonCode: sourcePreflightItem.reasonCode,
    requiredRuntimeGuard: sourcePreflightItem.requiredRuntimeGuard,
    requiredSubscriberGuard: sourcePreflightItem.requiredSubscriberGuard,
  };
}

function summarizeGraphDocsLifecycleDispatchDesignSourcePreflight(design) {
  assertGraphDocsLifecycleDispatchDesignCompatibility(design);
  const sourcePreflight = design.items[0].sourcePreflight;
  assertPlainObject(
    sourcePreflight,
    'DisabledGraphDocsLifecycleObservabilityAdapterHandshake sourcePreflight',
  );
  if (sourcePreflight.queryName !== 'createGraphDocsLifecycleDispatchPreflightContract') {
    throw new Error('DisabledGraphDocsLifecycleObservabilityAdapterHandshake sourcePreflight queryName must be createGraphDocsLifecycleDispatchPreflightContract');
  }
  if (sourcePreflight.artifactFamily !== 'site-capability-graph-lifecycle-dispatch-preflight-contract') {
    throw new Error('DisabledGraphDocsLifecycleObservabilityAdapterHandshake sourcePreflight artifactFamily must be site-capability-graph-lifecycle-dispatch-preflight-contract');
  }
  if (sourcePreflight.result !== 'blocked') {
    throw new Error('DisabledGraphDocsLifecycleObservabilityAdapterHandshake sourcePreflight result must be blocked');
  }
  if (sourcePreflight.integrationAllowed !== false) {
    throw new Error('DisabledGraphDocsLifecycleObservabilityAdapterHandshake sourcePreflight integrationAllowed must be false');
  }
  if (sourcePreflight.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
    throw new Error(`DisabledGraphDocsLifecycleObservabilityAdapterHandshake sourcePreflight reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  return cloneDescriptor(sourcePreflight);
}

function summarizeGraphDocsLifecycleDispatchPreflightSource(source) {
  assertPlainObject(source, 'DisabledGraphDocsLifecycleObservabilityAdapterHandshakeSource');
  assertNoDisabledGraphDocsLifecycleObservabilityAdapterRuntimeProducts(
    source,
    'DisabledGraphDocsLifecycleObservabilityAdapterHandshakeSource',
  );
  assertNoForbiddenGraphFields(
    source,
    'DisabledGraphDocsLifecycleObservabilityAdapterHandshakeSource',
  );
  assertNoForbiddenPatterns(source);
  assertNoGraphMetricFields(source, 'DisabledGraphDocsLifecycleObservabilityAdapterHandshakeSource');
  if (source.queryName === 'createGraphDocsLifecycleDispatchPreflightContract') {
    return summarizeGraphDocsLifecycleDispatchPreflight(source);
  }
  if (source.queryName === 'createGraphDocsLifecycleDispatchDesign') {
    return summarizeGraphDocsLifecycleDispatchDesignSourcePreflight(source);
  }
  throw new Error('DisabledGraphDocsLifecycleObservabilityAdapterHandshake source must be descriptor-only preflight or dispatch design');
}

export function assertDisabledGraphDocsLifecycleObservabilityAdapterHandshakeCompatibility(
  handshake = {},
) {
  assertPlainObject(handshake, 'DisabledGraphDocsLifecycleObservabilityAdapterHandshake');
  assertNoDisabledGraphDocsLifecycleObservabilityAdapterRuntimeProducts(handshake);
  assertNoForbiddenGraphFields(
    handshake,
    'DisabledGraphDocsLifecycleObservabilityAdapterHandshake',
  );
  assertNoForbiddenPatterns(handshake);
  assertNoGraphMetricFields(handshake, 'DisabledGraphDocsLifecycleObservabilityAdapterHandshake');
  assertGraphQueryResultCompatible(handshake);
  if (handshake.queryName !== 'createDisabledGraphDocsLifecycleObservabilityAdapterHandshake') {
    throw new Error('DisabledGraphDocsLifecycleObservabilityAdapterHandshake queryName must be createDisabledGraphDocsLifecycleObservabilityAdapterHandshake');
  }
  if (handshake.artifactFamily !== 'site-capability-graph-docs-lifecycle-observability-adapter-handshake') {
    throw new Error('DisabledGraphDocsLifecycleObservabilityAdapterHandshake artifactFamily must be site-capability-graph-docs-lifecycle-observability-adapter-handshake');
  }
  if (handshake.redactionRequired !== true) {
    throw new Error('DisabledGraphDocsLifecycleObservabilityAdapterHandshake redactionRequired must be true');
  }
  if (!Array.isArray(handshake.items) || handshake.items.length === 0) {
    throw new Error('DisabledGraphDocsLifecycleObservabilityAdapterHandshake items are required');
  }
  for (const [index, item] of handshake.items.entries()) {
    assertPlainObject(item, `DisabledGraphDocsLifecycleObservabilityAdapterHandshake.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`DisabledGraphDocsLifecycleObservabilityAdapterHandshake item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.handshakeMode !== 'disabled-layer-adapter-handshake') {
      throw new Error('DisabledGraphDocsLifecycleObservabilityAdapterHandshake handshakeMode must be disabled-layer-adapter-handshake');
    }
    assertRequiredText(
      item.adapterName,
      'adapterName',
      'DisabledGraphDocsLifecycleObservabilityAdapterHandshake',
    );
    if (item.featureEnabled !== false) {
      throw new Error('DisabledGraphDocsLifecycleObservabilityAdapterHandshake featureEnabled must be false');
    }
    if (item.result !== 'blocked') {
      throw new Error('DisabledGraphDocsLifecycleObservabilityAdapterHandshake result must be blocked');
    }
    for (const fieldName of [
      'registrationAllowed',
      'producerRegistrationAllowed',
      'subscriberRegistrationAllowed',
      'telemetryDispatchAllowed',
      'runtimeDispatchAllowed',
      ...GRAPH_DOCS_LIFECYCLE_DISPATCH_PREFLIGHT_DISABLED_FLAG_KEYS,
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`DisabledGraphDocsLifecycleObservabilityAdapterHandshake ${fieldName} must be false`);
      }
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`DisabledGraphDocsLifecycleObservabilityAdapterHandshake reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(item.reason, `DisabledGraphDocsLifecycleObservabilityAdapterHandshake.items[${index}].reason`);
    if (item.reason.code !== item.reasonCode) {
      throw new Error('DisabledGraphDocsLifecycleObservabilityAdapterHandshake reason code must match reasonCode');
    }
    if (item.requiredPreflightGuard !== 'assertGraphDocsLifecycleDispatchPreflightCompatibility') {
      throw new Error('DisabledGraphDocsLifecycleObservabilityAdapterHandshake requiredPreflightGuard must be assertGraphDocsLifecycleDispatchPreflightCompatibility');
    }
    assertPlainObject(
      item.sourcePreflight,
      `DisabledGraphDocsLifecycleObservabilityAdapterHandshake.items[${index}].sourcePreflight`,
    );
    if (item.sourcePreflight.queryName !== 'createGraphDocsLifecycleDispatchPreflightContract') {
      throw new Error('DisabledGraphDocsLifecycleObservabilityAdapterHandshake sourcePreflight queryName must be createGraphDocsLifecycleDispatchPreflightContract');
    }
    if (item.sourcePreflight.artifactFamily !== 'site-capability-graph-lifecycle-dispatch-preflight-contract') {
      throw new Error('DisabledGraphDocsLifecycleObservabilityAdapterHandshake sourcePreflight artifactFamily must be site-capability-graph-lifecycle-dispatch-preflight-contract');
    }
    if (item.sourcePreflight.result !== 'blocked') {
      throw new Error('DisabledGraphDocsLifecycleObservabilityAdapterHandshake sourcePreflight result must be blocked');
    }
    if (item.sourcePreflight.integrationAllowed !== false) {
      throw new Error('DisabledGraphDocsLifecycleObservabilityAdapterHandshake sourcePreflight integrationAllowed must be false');
    }
    if (item.sourcePreflight.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`DisabledGraphDocsLifecycleObservabilityAdapterHandshake sourcePreflight reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
  }
  return true;
}

export function createDisabledGraphDocsLifecycleObservabilityAdapterHandshake(
  sourceOrOptions = {},
  maybeOptions,
) {
  const source = maybeOptions === undefined && !normalizeText(sourceOrOptions.queryName)
    ? createGraphDocsLifecycleDispatchPreflightContract({
      graphVersion: sourceOrOptions.graphVersion,
    })
    : sourceOrOptions;
  const options = maybeOptions === undefined && !normalizeText(sourceOrOptions.queryName)
    ? sourceOrOptions
    : maybeOptions ?? {};
  assertPlainObject(options, 'DisabledGraphDocsLifecycleObservabilityAdapterHandshakeOptions');
  assertNoDisabledGraphDocsLifecycleObservabilityAdapterRuntimeProducts(
    options,
    'DisabledGraphDocsLifecycleObservabilityAdapterHandshakeOptions',
  );
  assertNoForbiddenGraphFields(
    options,
    'DisabledGraphDocsLifecycleObservabilityAdapterHandshakeOptions',
  );
  assertNoForbiddenPatterns(options);
  assertNoGraphMetricFields(options, 'DisabledGraphDocsLifecycleObservabilityAdapterHandshakeOptions');
  const {
    adapterName = 'site-capability-graph-docs-lifecycle-observability-adapter',
    featureEnabled,
    runtimeDispatchEnabled,
    externalTelemetryEnabled,
    externalTelemetryDispatchEnabled,
    subscriberRegistrationEnabled,
    runtimeSubscriberEnabled,
    runtimeDispatchProducerEnabled,
    repoArtifactWriteEnabled,
    runtimeArtifactWriteEnabled,
    artifactWriteEnabled,
    runtimeLogWriteEnabled,
    sessionMaterializationEnabled,
  } = options;
  for (const [fieldName, value] of Object.entries({
    featureEnabled,
    runtimeDispatchEnabled,
    externalTelemetryEnabled,
    externalTelemetryDispatchEnabled,
    subscriberRegistrationEnabled,
    runtimeSubscriberEnabled,
    runtimeDispatchProducerEnabled,
    repoArtifactWriteEnabled,
    runtimeArtifactWriteEnabled,
    artifactWriteEnabled,
    runtimeLogWriteEnabled,
    sessionMaterializationEnabled,
  })) {
    assertDisabledFlag(
      value,
      fieldName,
      'DisabledGraphDocsLifecycleObservabilityAdapterHandshake',
    );
  }
  const sourcePreflight = summarizeGraphDocsLifecycleDispatchPreflightSource(source);
  const disabledFlags = Object.fromEntries(
    GRAPH_DOCS_LIFECYCLE_DISPATCH_PREFLIGHT_DISABLED_FLAG_KEYS.map((fieldName) => [fieldName, false]),
  );
  const handshake = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: source.graphVersion,
    queryName: 'createDisabledGraphDocsLifecycleObservabilityAdapterHandshake',
    artifactFamily: 'site-capability-graph-docs-lifecycle-observability-adapter-handshake',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      handshakeMode: 'disabled-layer-adapter-handshake',
      adapterName: assertRequiredText(
        adapterName,
        'adapterName',
        'DisabledGraphDocsLifecycleObservabilityAdapterHandshake',
      ),
      featureEnabled: false,
      result: 'blocked',
      registrationAllowed: false,
      producerRegistrationAllowed: false,
      subscriberRegistrationAllowed: false,
      telemetryDispatchAllowed: false,
      runtimeDispatchAllowed: false,
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph docs lifecycle observability adapter handshake is disabled by contract',
      ),
      requiredPreflightGuard: 'assertGraphDocsLifecycleDispatchPreflightCompatibility',
      sourcePreflight,
      ...disabledFlags,
    }],
  };
  assertDisabledGraphDocsLifecycleObservabilityAdapterHandshakeCompatibility(handshake);
  return cloneDescriptor(handshake);
}

function summarizeDisabledGraphDocsLifecycleObservabilityAdapterHandshake(handshake) {
  assertDisabledGraphDocsLifecycleObservabilityAdapterHandshakeCompatibility(handshake);
  const sourceHandshakeItem = handshake.items[0];
  return {
    queryName: handshake.queryName,
    artifactFamily: handshake.artifactFamily,
    handshakeMode: sourceHandshakeItem.handshakeMode,
    adapterName: sourceHandshakeItem.adapterName,
    featureEnabled: sourceHandshakeItem.featureEnabled,
    result: sourceHandshakeItem.result,
    registrationAllowed: sourceHandshakeItem.registrationAllowed,
    producerRegistrationAllowed: sourceHandshakeItem.producerRegistrationAllowed,
    subscriberRegistrationAllowed: sourceHandshakeItem.subscriberRegistrationAllowed,
    telemetryDispatchAllowed: sourceHandshakeItem.telemetryDispatchAllowed,
    runtimeDispatchAllowed: sourceHandshakeItem.runtimeDispatchAllowed,
    reasonCode: sourceHandshakeItem.reasonCode,
    requiredPreflightGuard: sourceHandshakeItem.requiredPreflightGuard,
  };
}

export function assertDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesignCompatibility(
  design = {},
) {
  assertPlainObject(design, 'DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign');
  assertNoDisabledGraphDocsLifecycleObservabilityAdapterRuntimeProducts(
    design,
    'DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign',
  );
  assertNoForbiddenGraphFields(
    design,
    'DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign',
  );
  assertNoForbiddenPatterns(design);
  assertNoGraphMetricFields(design, 'DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign');
  assertGraphQueryResultCompatible(design);
  if (design.queryName !== 'createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign') {
    throw new Error('DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign queryName must be createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign');
  }
  if (design.artifactFamily !== 'site-capability-graph-docs-lifecycle-observability-consumer-integration-design') {
    throw new Error('DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign artifactFamily must be site-capability-graph-docs-lifecycle-observability-consumer-integration-design');
  }
  if (design.redactionRequired !== true) {
    throw new Error('DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign redactionRequired must be true');
  }
  if (!Array.isArray(design.items) || design.items.length === 0) {
    throw new Error('DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign items are required');
  }
  for (const [index, item] of design.items.entries()) {
    assertPlainObject(
      item,
      `DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign.items[${index}]`,
    );
    if (item.schemaVersion !== 1) {
      throw new Error(`DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.integrationMode !== 'disabled-no-op-layer-observability-consumer') {
      throw new Error('DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign integrationMode must be disabled-no-op-layer-observability-consumer');
    }
    assertRequiredText(
      item.consumerName,
      'consumerName',
      'DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign',
    );
    if (item.featureEnabled !== false) {
      throw new Error('DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign featureEnabled must be false');
    }
    if (item.result !== 'blocked') {
      throw new Error('DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign result must be blocked');
    }
    for (const fieldName of [
      'consumerIntegrationEnabled',
      'runtimeConsumerEnabled',
      'registrationAllowed',
      'producerRegistrationAllowed',
      'subscriberRegistrationAllowed',
      'telemetryDispatchAllowed',
      'runtimeDispatchAllowed',
      ...GRAPH_DOCS_LIFECYCLE_DISPATCH_PREFLIGHT_DISABLED_FLAG_KEYS,
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign ${fieldName} must be false`);
      }
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(
      item.reason,
      `DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign.items[${index}].reason`,
    );
    if (item.reason.code !== item.reasonCode) {
      throw new Error('DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign reason code must match reasonCode');
    }
    if (item.requiredHandshakeGuard !== 'assertDisabledGraphDocsLifecycleObservabilityAdapterHandshakeCompatibility') {
      throw new Error('DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign requiredHandshakeGuard must be assertDisabledGraphDocsLifecycleObservabilityAdapterHandshakeCompatibility');
    }
    if (item.requiredPreflightGuard !== 'assertGraphDocsLifecycleDispatchPreflightCompatibility') {
      throw new Error('DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign requiredPreflightGuard must be assertGraphDocsLifecycleDispatchPreflightCompatibility');
    }
    assertPlainObject(
      item.sourceHandshake,
      `DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign.items[${index}].sourceHandshake`,
    );
    if (item.sourceHandshake.queryName !== 'createDisabledGraphDocsLifecycleObservabilityAdapterHandshake') {
      throw new Error('DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign sourceHandshake queryName must be createDisabledGraphDocsLifecycleObservabilityAdapterHandshake');
    }
    if (item.sourceHandshake.artifactFamily !== 'site-capability-graph-docs-lifecycle-observability-adapter-handshake') {
      throw new Error('DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign sourceHandshake artifactFamily must be site-capability-graph-docs-lifecycle-observability-adapter-handshake');
    }
    if (item.sourceHandshake.result !== 'blocked') {
      throw new Error('DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign sourceHandshake result must be blocked');
    }
    if (item.sourceHandshake.registrationAllowed !== false) {
      throw new Error('DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign sourceHandshake registrationAllowed must be false');
    }
    if (item.sourceHandshake.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign sourceHandshake reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(
      item.sourcePreflight,
      `DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign.items[${index}].sourcePreflight`,
    );
    if (item.sourcePreflight.queryName !== 'createGraphDocsLifecycleDispatchPreflightContract') {
      throw new Error('DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign sourcePreflight queryName must be createGraphDocsLifecycleDispatchPreflightContract');
    }
    if (item.sourcePreflight.artifactFamily !== 'site-capability-graph-lifecycle-dispatch-preflight-contract') {
      throw new Error('DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign sourcePreflight artifactFamily must be site-capability-graph-lifecycle-dispatch-preflight-contract');
    }
    if (item.sourcePreflight.result !== 'blocked') {
      throw new Error('DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign sourcePreflight result must be blocked');
    }
    if (item.sourcePreflight.integrationAllowed !== false) {
      throw new Error('DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign sourcePreflight integrationAllowed must be false');
    }
    if (item.sourcePreflight.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign sourcePreflight reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
  }
  return true;
}

export function createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign(
  sourceOrOptions = {},
  maybeOptions,
) {
  const calledWithOptions = maybeOptions === undefined && !normalizeText(sourceOrOptions.queryName);
  const options = calledWithOptions
    ? sourceOrOptions
    : maybeOptions ?? {};
  const sourceHandshake = calledWithOptions
    ? sourceOrOptions.handshake ?? createDisabledGraphDocsLifecycleObservabilityAdapterHandshake(
      sourceOrOptions.preflight ?? {
        graphVersion: sourceOrOptions.graphVersion,
      },
      options,
    )
    : sourceOrOptions;
  assertDisabledGraphDocsLifecycleObservabilityAdapterHandshakeCompatibility(sourceHandshake);
  assertPlainObject(options, 'DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesignOptions');
  assertNoDisabledGraphDocsLifecycleObservabilityAdapterRuntimeProducts(
    options,
    'DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesignOptions',
  );
  assertNoForbiddenGraphFields(
    options,
    'DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesignOptions',
  );
  assertNoForbiddenPatterns(options);
  assertNoGraphMetricFields(
    options,
    'DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesignOptions',
  );
  const {
    consumerName = 'site-capability-graph-docs-lifecycle-observability-consumer',
    featureEnabled,
    consumerIntegrationEnabled,
    runtimeConsumerEnabled,
    registrationAllowed,
    producerRegistrationAllowed,
    subscriberRegistrationAllowed,
    telemetryDispatchAllowed,
    runtimeDispatchAllowed,
    runtimeDispatchEnabled,
    externalTelemetryEnabled,
    externalTelemetryDispatchEnabled,
    subscriberRegistrationEnabled,
    runtimeSubscriberEnabled,
    runtimeDispatchProducerEnabled,
    repoArtifactWriteEnabled,
    runtimeArtifactWriteEnabled,
    artifactWriteEnabled,
    runtimeLogWriteEnabled,
    sessionMaterializationEnabled,
  } = options;
  for (const [fieldName, value] of Object.entries({
    featureEnabled,
    consumerIntegrationEnabled,
    runtimeConsumerEnabled,
    registrationAllowed,
    producerRegistrationAllowed,
    subscriberRegistrationAllowed,
    telemetryDispatchAllowed,
    runtimeDispatchAllowed,
    runtimeDispatchEnabled,
    externalTelemetryEnabled,
    externalTelemetryDispatchEnabled,
    subscriberRegistrationEnabled,
    runtimeSubscriberEnabled,
    runtimeDispatchProducerEnabled,
    repoArtifactWriteEnabled,
    runtimeArtifactWriteEnabled,
    artifactWriteEnabled,
    runtimeLogWriteEnabled,
    sessionMaterializationEnabled,
  })) {
    assertDisabledFlag(
      value,
      fieldName,
      'DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign',
    );
  }
  const sourceHandshakeItem = sourceHandshake.items[0];
  const sourcePreflight = cloneDescriptor(sourceHandshakeItem.sourcePreflight);
  assertGraphDocsLifecycleDispatchPreflightCompatibility({
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceHandshake.graphVersion,
    queryName: sourcePreflight.queryName,
    artifactFamily: sourcePreflight.artifactFamily,
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      preflightName: 'source-preflight-summary',
      consumerName: 'source-preflight-summary',
      preflightMode: sourcePreflight.preflightMode,
      phase: 'descriptor-only-preflight',
      consumerMode: sourcePreflight.consumerMode,
      result: sourcePreflight.result,
      integrationAllowed: sourcePreflight.integrationAllowed,
      reasonCode: sourcePreflight.reasonCode,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph docs lifecycle source preflight remains disabled by contract',
      ),
      requiredRuntimeGuard: sourcePreflight.requiredRuntimeGuard,
      requiredSubscriberGuard: sourcePreflight.requiredSubscriberGuard,
      forbiddenRuntimeOptions: GRAPH_DOCS_LIFECYCLE_DISPATCH_PREFLIGHT_RUNTIME_PRODUCT_KEYS,
      ...Object.fromEntries(
        GRAPH_DOCS_LIFECYCLE_DISPATCH_PREFLIGHT_DISABLED_FLAG_KEYS.map((fieldName) => [fieldName, false]),
      ),
    }],
  });
  const disabledFlags = Object.fromEntries(
    GRAPH_DOCS_LIFECYCLE_DISPATCH_PREFLIGHT_DISABLED_FLAG_KEYS.map((fieldName) => [fieldName, false]),
  );
  const design = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceHandshake.graphVersion,
    queryName: 'createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign',
    artifactFamily: 'site-capability-graph-docs-lifecycle-observability-consumer-integration-design',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      integrationMode: 'disabled-no-op-layer-observability-consumer',
      consumerName: assertRequiredText(
        consumerName,
        'consumerName',
        'DisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign',
      ),
      featureEnabled: false,
      consumerIntegrationEnabled: false,
      runtimeConsumerEnabled: false,
      result: 'blocked',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph docs lifecycle observability consumer integration is disabled by descriptor-only contract',
      ),
      requiredHandshakeGuard: 'assertDisabledGraphDocsLifecycleObservabilityAdapterHandshakeCompatibility',
      requiredPreflightGuard: 'assertGraphDocsLifecycleDispatchPreflightCompatibility',
      sourceHandshake: summarizeDisabledGraphDocsLifecycleObservabilityAdapterHandshake(sourceHandshake),
      sourcePreflight,
      registrationAllowed: false,
      producerRegistrationAllowed: false,
      subscriberRegistrationAllowed: false,
      telemetryDispatchAllowed: false,
      runtimeDispatchAllowed: false,
      ...disabledFlags,
    }],
  };
  assertDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesignCompatibility(design);
  return cloneDescriptor(design);
}

function summarizeDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign(design) {
  assertDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesignCompatibility(design);
  const sourceItem = design.items[0];
  return {
    queryName: design.queryName,
    artifactFamily: design.artifactFamily,
    graphVersion: design.graphVersion,
    redactionRequired: design.redactionRequired,
    integrationMode: sourceItem.integrationMode,
    consumerName: sourceItem.consumerName,
    featureEnabled: sourceItem.featureEnabled,
    consumerIntegrationEnabled: sourceItem.consumerIntegrationEnabled,
    runtimeConsumerEnabled: sourceItem.runtimeConsumerEnabled,
    result: sourceItem.result,
    registrationAllowed: sourceItem.registrationAllowed,
    producerRegistrationAllowed: sourceItem.producerRegistrationAllowed,
    subscriberRegistrationAllowed: sourceItem.subscriberRegistrationAllowed,
    telemetryDispatchAllowed: sourceItem.telemetryDispatchAllowed,
    runtimeDispatchAllowed: sourceItem.runtimeDispatchAllowed,
    reasonCode: sourceItem.reasonCode,
    requiredHandshakeGuard: sourceItem.requiredHandshakeGuard,
    requiredPreflightGuard: sourceItem.requiredPreflightGuard,
  };
}

export function assertGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignCompatibility(
  design = {},
) {
  assertPlainObject(design, 'GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign');
  assertNoDisabledGraphDocsLifecycleObservabilityAdapterRuntimeProducts(
    design,
    'GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign',
  );
  assertNoForbiddenGraphFields(
    design,
    'GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign',
  );
  assertNoForbiddenPatterns(design);
  assertNoGraphMetricFields(design, 'GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign');
  assertGraphQueryResultCompatible(design);
  if (design.queryName !== 'createGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign') {
    throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign queryName must be createGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign');
  }
  if (design.artifactFamily !== 'site-capability-graph-docs-lifecycle-observability-adapter-wiring-boundary-design') {
    throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign artifactFamily must be site-capability-graph-docs-lifecycle-observability-adapter-wiring-boundary-design');
  }
  if (design.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign redactionRequired must be true');
  }
  if (!Array.isArray(design.items) || design.items.length === 0) {
    throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign items are required');
  }
  for (const [index, item] of design.items.entries()) {
    assertPlainObject(
      item,
      `GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign.items[${index}]`,
    );
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.boundaryMode !== 'descriptor-only-disabled-adapter-wiring') {
      throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign boundaryMode must be descriptor-only-disabled-adapter-wiring');
    }
    if (item.futureWiringBoundary !== 'future-live-observability-producer-subscriber-path') {
      throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign futureWiringBoundary must describe the future producer/subscriber path');
    }
    if (item.result !== 'blocked') {
      throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign result must be blocked');
    }
    for (const fieldName of [
      'featureEnabled',
      'adapterWiringEnabled',
      'registrationAllowed',
      'producerRegistrationAllowed',
      'subscriberRegistrationAllowed',
      'externalTelemetryEnabled',
      'telemetryDispatchAllowed',
      'runtimeDispatchAllowed',
      ...GRAPH_DOCS_LIFECYCLE_DISPATCH_PREFLIGHT_DISABLED_FLAG_KEYS,
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign ${fieldName} must be false`);
      }
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(
      item.reason,
      `GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign.items[${index}].reason`,
    );
    if (item.reason.code !== item.reasonCode) {
      throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign reason code must match reasonCode');
    }
    assertPlainObject(
      item.requiredGuards,
      `GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign.items[${index}].requiredGuards`,
    );
    if (
      item.requiredGuards.consumerIntegrationGuard
        !== 'assertDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesignCompatibility'
    ) {
      throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign consumerIntegrationGuard is required');
    }
    if (
      item.requiredGuards.handshakeGuard
        !== 'assertDisabledGraphDocsLifecycleObservabilityAdapterHandshakeCompatibility'
    ) {
      throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign handshakeGuard is required');
    }
    if (item.requiredGuards.preflightGuard !== 'assertGraphDocsLifecycleDispatchPreflightCompatibility') {
      throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign preflightGuard is required');
    }
    if (
      item.requiredHandshakeGuard
        !== 'assertDisabledGraphDocsLifecycleObservabilityAdapterHandshakeCompatibility'
    ) {
      throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign requiredHandshakeGuard is required');
    }
    if (item.requiredPreflightGuard !== 'assertGraphDocsLifecycleDispatchPreflightCompatibility') {
      throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign requiredPreflightGuard is required');
    }
    if (
      item.requiredBoundaryGuard
        !== 'assertGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignCompatibility'
    ) {
      throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign requiredBoundaryGuard is required');
    }
    assertPlainObject(
      item.sourceDesign,
      `GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign.items[${index}].sourceDesign`,
    );
    if (item.sourceDesign.queryName !== 'createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign') {
      throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign sourceDesign queryName must be createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign');
    }
    if (item.sourceDesign.artifactFamily !== 'site-capability-graph-docs-lifecycle-observability-consumer-integration-design') {
      throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign sourceDesign artifactFamily must be site-capability-graph-docs-lifecycle-observability-consumer-integration-design');
    }
    if (item.sourceDesign.result !== 'blocked') {
      throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign sourceDesign result must be blocked');
    }
    for (const fieldName of [
      'consumerIntegrationEnabled',
      'runtimeConsumerEnabled',
      'registrationAllowed',
      'producerRegistrationAllowed',
      'subscriberRegistrationAllowed',
      'telemetryDispatchAllowed',
      'runtimeDispatchAllowed',
    ]) {
      if (item.sourceDesign[fieldName] !== false) {
        throw new Error(`GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign sourceDesign ${fieldName} must be false`);
      }
    }
    if (item.sourceDesign.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign sourceDesign reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    if (
      item.sourceDesign.requiredHandshakeGuard
        !== 'assertDisabledGraphDocsLifecycleObservabilityAdapterHandshakeCompatibility'
    ) {
      throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign sourceDesign requiredHandshakeGuard is required');
    }
    if (item.sourceDesign.requiredPreflightGuard !== 'assertGraphDocsLifecycleDispatchPreflightCompatibility') {
      throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign sourceDesign requiredPreflightGuard is required');
    }
    assertPlainObject(
      item.sourceHandshake,
      `GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign.items[${index}].sourceHandshake`,
    );
    if (item.sourceHandshake.queryName !== 'createDisabledGraphDocsLifecycleObservabilityAdapterHandshake') {
      throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign sourceHandshake queryName must be createDisabledGraphDocsLifecycleObservabilityAdapterHandshake');
    }
    if (item.sourceHandshake.result !== 'blocked') {
      throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign sourceHandshake result must be blocked');
    }
    for (const fieldName of [
      'registrationAllowed',
      'producerRegistrationAllowed',
      'subscriberRegistrationAllowed',
      'telemetryDispatchAllowed',
      'runtimeDispatchAllowed',
    ]) {
      if (item.sourceHandshake[fieldName] !== false) {
        throw new Error(`GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign sourceHandshake ${fieldName} must be false`);
      }
    }
    if (item.sourceHandshake.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign sourceHandshake reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(
      item.sourcePreflight,
      `GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign.items[${index}].sourcePreflight`,
    );
    if (item.sourcePreflight.queryName !== 'createGraphDocsLifecycleDispatchPreflightContract') {
      throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign sourcePreflight queryName must be createGraphDocsLifecycleDispatchPreflightContract');
    }
    if (item.sourcePreflight.result !== 'blocked') {
      throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign sourcePreflight result must be blocked');
    }
    if (item.sourcePreflight.integrationAllowed !== false) {
      throw new Error('GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign sourcePreflight integrationAllowed must be false');
    }
    if (item.sourcePreflight.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign sourcePreflight reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
  }
  return true;
}

export function createGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign(
  sourceOrOptions = {},
  maybeOptions,
) {
  const calledWithOptions = maybeOptions === undefined && !normalizeText(sourceOrOptions.queryName);
  const options = calledWithOptions
    ? sourceOrOptions
    : maybeOptions ?? {};
  assertPlainObject(options, 'GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignOptions');
  assertNoDisabledGraphDocsLifecycleObservabilityAdapterRuntimeProducts(
    options,
    'GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignOptions',
  );
  assertNoForbiddenGraphFields(
    options,
    'GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignOptions',
  );
  assertNoForbiddenPatterns(options);
  assertNoGraphMetricFields(
    options,
    'GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignOptions',
  );
  const sourceIntegrationDesign = options.integrationDesign ?? options.consumerIntegrationDesign;
  const sourceHandshake = calledWithOptions && !sourceIntegrationDesign
    ? options.handshake ?? createDisabledGraphDocsLifecycleObservabilityAdapterHandshake(
      options.preflight ?? createGraphDocsLifecycleDispatchPreflightContract({
        graphVersion: options.graphVersion,
      }),
      options,
    )
    : undefined;
  const integrationDesign = calledWithOptions
    ? sourceIntegrationDesign
      ?? createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign(sourceHandshake, options)
    : sourceOrOptions;
  assertDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesignCompatibility(integrationDesign);
  const {
    adapterBoundaryName = 'site-capability-graph-docs-lifecycle-observability-adapter-wiring-boundary',
    featureEnabled,
    adapterWiringEnabled,
    registrationAllowed,
    producerRegistrationAllowed,
    subscriberRegistrationAllowed,
    telemetryDispatchAllowed,
    runtimeDispatchAllowed,
    runtimeDispatchEnabled,
    externalTelemetryEnabled,
    externalTelemetryDispatchEnabled,
    subscriberRegistrationEnabled,
    runtimeSubscriberEnabled,
    runtimeDispatchProducerEnabled,
    repoArtifactWriteEnabled,
    runtimeArtifactWriteEnabled,
    artifactWriteEnabled,
    runtimeLogWriteEnabled,
    sessionMaterializationEnabled,
  } = options;
  for (const [fieldName, value] of Object.entries({
    featureEnabled,
    adapterWiringEnabled,
    registrationAllowed,
    producerRegistrationAllowed,
    subscriberRegistrationAllowed,
    telemetryDispatchAllowed,
    runtimeDispatchAllowed,
    runtimeDispatchEnabled,
    externalTelemetryEnabled,
    externalTelemetryDispatchEnabled,
    subscriberRegistrationEnabled,
    runtimeSubscriberEnabled,
    runtimeDispatchProducerEnabled,
    repoArtifactWriteEnabled,
    runtimeArtifactWriteEnabled,
    artifactWriteEnabled,
    runtimeLogWriteEnabled,
    sessionMaterializationEnabled,
  })) {
    assertDisabledFlag(
      value,
      fieldName,
      'GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign',
    );
  }
  const sourceItem = integrationDesign.items[0];
  const disabledFlags = Object.fromEntries(
    GRAPH_DOCS_LIFECYCLE_DISPATCH_PREFLIGHT_DISABLED_FLAG_KEYS.map((fieldName) => [fieldName, false]),
  );
  const design = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: integrationDesign.graphVersion,
    queryName: 'createGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign',
    artifactFamily: 'site-capability-graph-docs-lifecycle-observability-adapter-wiring-boundary-design',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      queryName: 'createGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign',
      artifactFamily: 'site-capability-graph-docs-lifecycle-observability-adapter-wiring-boundary-design',
      redactionRequired: true,
      adapterBoundaryName: assertRequiredText(
        adapterBoundaryName,
        'adapterBoundaryName',
        'GraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign',
      ),
      consumerName: sourceItem.consumerName,
      adapterName: sourceItem.sourceHandshake.adapterName,
      boundaryMode: 'descriptor-only-disabled-adapter-wiring',
      futureWiringBoundary: 'future-live-observability-producer-subscriber-path',
      featureEnabled: false,
      adapterWiringEnabled: false,
      result: 'blocked',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph docs lifecycle observability adapter wiring boundary is descriptor-only and disabled',
      ),
      requiredBoundaryGuard: 'assertGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignCompatibility',
      requiredHandshakeGuard: sourceItem.requiredHandshakeGuard,
      requiredPreflightGuard: sourceItem.requiredPreflightGuard,
      requiredGuards: {
        consumerIntegrationGuard:
          'assertDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesignCompatibility',
        handshakeGuard: sourceItem.requiredHandshakeGuard,
        preflightGuard: sourceItem.requiredPreflightGuard,
      },
      sourceDesign: summarizeDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign(
        integrationDesign,
      ),
      sourceHandshake: cloneDescriptor(sourceItem.sourceHandshake),
      sourcePreflight: cloneDescriptor(sourceItem.sourcePreflight),
      registrationAllowed: false,
      producerRegistrationAllowed: false,
      subscriberRegistrationAllowed: false,
      telemetryDispatchAllowed: false,
      runtimeDispatchAllowed: false,
      ...disabledFlags,
    }],
  };
  assertGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignCompatibility(design);
  return cloneDescriptor(design);
}

function summarizeGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign(design) {
  assertGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignCompatibility(design);
  const item = design.items[0];
  return {
    queryName: design.queryName,
    artifactFamily: design.artifactFamily,
    graphVersion: design.graphVersion,
    redactionRequired: design.redactionRequired,
    adapterBoundaryName: item.adapterBoundaryName,
    adapterName: item.adapterName,
    consumerName: item.consumerName,
    boundaryMode: item.boundaryMode,
    futureWiringBoundary: item.futureWiringBoundary,
    featureEnabled: item.featureEnabled,
    adapterWiringEnabled: item.adapterWiringEnabled,
    result: item.result,
    registrationAllowed: item.registrationAllowed,
    producerRegistrationAllowed: item.producerRegistrationAllowed,
    subscriberRegistrationAllowed: item.subscriberRegistrationAllowed,
    telemetryDispatchAllowed: item.telemetryDispatchAllowed,
    runtimeDispatchAllowed: item.runtimeDispatchAllowed,
    reasonCode: item.reasonCode,
    requiredBoundaryGuard: item.requiredBoundaryGuard,
    requiredHandshakeGuard: item.requiredHandshakeGuard,
    requiredPreflightGuard: item.requiredPreflightGuard,
    requiredGuards: cloneDescriptor(item.requiredGuards),
  };
}

function assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightSourceBoundary(
  sourceBoundary,
  label,
) {
  assertPlainObject(sourceBoundary, `${label}.sourceBoundary`);
  if (sourceBoundary.queryName !== 'createGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign') {
    throw new Error(`${label} sourceBoundary queryName must be createGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign`);
  }
  if (sourceBoundary.artifactFamily !== 'site-capability-graph-docs-lifecycle-observability-adapter-wiring-boundary-design') {
    throw new Error(`${label} sourceBoundary artifactFamily must be site-capability-graph-docs-lifecycle-observability-adapter-wiring-boundary-design`);
  }
  if (sourceBoundary.redactionRequired !== true) {
    throw new Error(`${label} sourceBoundary redactionRequired must be true`);
  }
  if (sourceBoundary.boundaryMode !== 'descriptor-only-disabled-adapter-wiring') {
    throw new Error(`${label} sourceBoundary boundaryMode must remain descriptor-only-disabled-adapter-wiring`);
  }
  if (sourceBoundary.result !== 'blocked') {
    throw new Error(`${label} sourceBoundary result must be blocked`);
  }
  for (const fieldName of [
    'featureEnabled',
    'adapterWiringEnabled',
    'registrationAllowed',
    'producerRegistrationAllowed',
    'subscriberRegistrationAllowed',
    'telemetryDispatchAllowed',
    'runtimeDispatchAllowed',
  ]) {
    if (sourceBoundary[fieldName] !== false) {
      throw new Error(`${label} sourceBoundary ${fieldName} must be false`);
    }
  }
  if (
    sourceBoundary.requiredBoundaryGuard
      !== 'assertGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignCompatibility'
  ) {
    throw new Error(`${label} sourceBoundary requiredBoundaryGuard is required`);
  }
  if (
    sourceBoundary.requiredHandshakeGuard
      !== 'assertDisabledGraphDocsLifecycleObservabilityAdapterHandshakeCompatibility'
  ) {
    throw new Error(`${label} sourceBoundary requiredHandshakeGuard is required`);
  }
  if (sourceBoundary.requiredPreflightGuard !== 'assertGraphDocsLifecycleDispatchPreflightCompatibility') {
    throw new Error(`${label} sourceBoundary requiredPreflightGuard is required`);
  }
  return true;
}

function assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightOwnershipPlan(
  registrationOwnershipPlan,
  label,
) {
  assertPlainObject(registrationOwnershipPlan, `${label}.registrationOwnershipPlan`);
  for (const fieldName of [
    'producerRegistrationOwner',
    'subscriberRegistrationOwner',
    'telemetryDispatchGate',
    'dispatchWriteGate',
    'logWriteGate',
    'artifactWriteGate',
  ]) {
    assertRequiredText(registrationOwnershipPlan[fieldName], fieldName, label);
  }
  return true;
}

export function assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightCompatibility(
  preflight = {},
) {
  assertPlainObject(preflight, 'GraphDocsLifecycleObservabilityRuntimeImplementationPreflight');
  assertNoGraphDocsLifecycleObservabilityRuntimeImplementationPreflightRuntimeProducts(
    preflight,
    'GraphDocsLifecycleObservabilityRuntimeImplementationPreflight',
  );
  assertNoForbiddenGraphFields(
    preflight,
    'GraphDocsLifecycleObservabilityRuntimeImplementationPreflight',
  );
  assertNoForbiddenPatterns(preflight);
  assertNoGraphMetricFields(preflight, 'GraphDocsLifecycleObservabilityRuntimeImplementationPreflight');
  assertGraphQueryResultCompatible(preflight);
  if (preflight.queryName !== 'createGraphDocsLifecycleObservabilityRuntimeImplementationPreflight') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeImplementationPreflight queryName must be createGraphDocsLifecycleObservabilityRuntimeImplementationPreflight');
  }
  if (preflight.artifactFamily !== 'site-capability-graph-docs-lifecycle-observability-runtime-implementation-preflight') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeImplementationPreflight artifactFamily must be site-capability-graph-docs-lifecycle-observability-runtime-implementation-preflight');
  }
  if (preflight.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeImplementationPreflight redactionRequired must be true');
  }
  if (!Array.isArray(preflight.items) || preflight.items.length === 0) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeImplementationPreflight items are required');
  }
  for (const [index, item] of preflight.items.entries()) {
    const itemLabel = `GraphDocsLifecycleObservabilityRuntimeImplementationPreflight.items[${index}]`;
    assertPlainObject(item, itemLabel);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphDocsLifecycleObservabilityRuntimeImplementationPreflight item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.preflightMode !== 'contract-only') {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeImplementationPreflight preflightMode must be contract-only');
    }
    if (item.implementationMode !== 'disabled') {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeImplementationPreflight implementationMode must be disabled');
    }
    if (item.runtimeMode !== 'not-registered') {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeImplementationPreflight runtimeMode must be not-registered');
    }
    if (item.result !== 'blocked') {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeImplementationPreflight result must be blocked');
    }
    for (const fieldName of GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_IMPLEMENTATION_PREFLIGHT_DISABLED_FLAG_KEYS) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphDocsLifecycleObservabilityRuntimeImplementationPreflight ${fieldName} must be false`);
      }
    }
    assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightOwnershipPlan(
      item.registrationOwnershipPlan,
      itemLabel,
    );
    for (const fieldName of [
      'producerRegistrationOwner',
      'subscriberRegistrationOwner',
      'telemetryDispatchGate',
      'dispatchWriteGate',
      'logWriteGate',
      'artifactWriteGate',
    ]) {
      if (item[fieldName] !== item.registrationOwnershipPlan[fieldName]) {
        throw new Error(`GraphDocsLifecycleObservabilityRuntimeImplementationPreflight ${fieldName} must match registrationOwnershipPlan`);
      }
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`GraphDocsLifecycleObservabilityRuntimeImplementationPreflight reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(item.reason, `${itemLabel}.reason`);
    if (item.reason.code !== item.reasonCode) {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeImplementationPreflight reason code must match reasonCode');
    }
    assertPlainObject(item.requiredGuards, `${itemLabel}.requiredGuards`);
    if (
      item.requiredGuards.boundaryGuard
        !== 'assertGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignCompatibility'
    ) {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeImplementationPreflight boundaryGuard is required');
    }
    if (
      item.requiredGuards.runtimeImplementationPreflightGuard
        !== 'assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightCompatibility'
    ) {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeImplementationPreflight runtimeImplementationPreflightGuard is required');
    }
    if (
      item.requiredBoundaryGuard
        !== 'assertGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignCompatibility'
    ) {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeImplementationPreflight requiredBoundaryGuard is required');
    }
    if (
      item.requiredRuntimeImplementationPreflightGuard
        !== 'assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightCompatibility'
    ) {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeImplementationPreflight requiredRuntimeImplementationPreflightGuard is required');
    }
    assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightSourceBoundary(
      item.sourceBoundary,
      itemLabel,
    );
    assertPlainObject(item.sourceDesign, `${itemLabel}.sourceDesign`);
    if (item.sourceDesign.queryName !== 'createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign') {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeImplementationPreflight sourceDesign queryName must be createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign');
    }
    if (item.sourceDesign.result !== 'blocked') {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeImplementationPreflight sourceDesign result must be blocked');
    }
    for (const fieldName of [
      'consumerIntegrationEnabled',
      'runtimeConsumerEnabled',
      'registrationAllowed',
      'producerRegistrationAllowed',
      'subscriberRegistrationAllowed',
      'telemetryDispatchAllowed',
      'runtimeDispatchAllowed',
    ]) {
      if (item.sourceDesign[fieldName] !== false) {
        throw new Error(`GraphDocsLifecycleObservabilityRuntimeImplementationPreflight sourceDesign ${fieldName} must be false`);
      }
    }
    assertPlainObject(item.sourceHandshake, `${itemLabel}.sourceHandshake`);
    if (item.sourceHandshake.queryName !== 'createDisabledGraphDocsLifecycleObservabilityAdapterHandshake') {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeImplementationPreflight sourceHandshake queryName must be createDisabledGraphDocsLifecycleObservabilityAdapterHandshake');
    }
    if (item.sourceHandshake.result !== 'blocked') {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeImplementationPreflight sourceHandshake result must be blocked');
    }
    for (const fieldName of [
      'registrationAllowed',
      'producerRegistrationAllowed',
      'subscriberRegistrationAllowed',
      'telemetryDispatchAllowed',
      'runtimeDispatchAllowed',
    ]) {
      if (item.sourceHandshake[fieldName] !== false) {
        throw new Error(`GraphDocsLifecycleObservabilityRuntimeImplementationPreflight sourceHandshake ${fieldName} must be false`);
      }
    }
    assertPlainObject(item.sourcePreflight, `${itemLabel}.sourcePreflight`);
    if (item.sourcePreflight.queryName !== 'createGraphDocsLifecycleDispatchPreflightContract') {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeImplementationPreflight sourcePreflight queryName must be createGraphDocsLifecycleDispatchPreflightContract');
    }
    if (item.sourcePreflight.result !== 'blocked') {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeImplementationPreflight sourcePreflight result must be blocked');
    }
    if (item.sourcePreflight.integrationAllowed !== false) {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeImplementationPreflight sourcePreflight integrationAllowed must be false');
    }
    if (!Array.isArray(item.forbiddenRuntimeFields) || item.forbiddenRuntimeFields.length === 0) {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeImplementationPreflight forbiddenRuntimeFields are required');
    }
  }
  return true;
}

/** @param {Record<string, any>} [preflight] */
export function assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility(preflight = {}) {
  assertPlainObject(preflight, 'GraphDocsLifecycleObservabilityRegistrationOwnerPreflight');
  assertNoGraphDocsLifecycleObservabilityRuntimeImplementationPreflightRuntimeProducts(
    preflight,
    'GraphDocsLifecycleObservabilityRegistrationOwnerPreflight',
  );
  assertNoForbiddenGraphFields(preflight, 'GraphDocsLifecycleObservabilityRegistrationOwnerPreflight');
  assertNoForbiddenPatterns(preflight);
  assertNoGraphMetricFields(preflight, 'GraphDocsLifecycleObservabilityRegistrationOwnerPreflight');
  assertGraphQueryResultCompatible(preflight);
  if (preflight.queryName !== 'createGraphDocsLifecycleObservabilityRegistrationOwnerPreflight') {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerPreflight queryName must be createGraphDocsLifecycleObservabilityRegistrationOwnerPreflight');
  }
  if (preflight.artifactFamily !== 'site-capability-graph-docs-lifecycle-observability-registration-owner-preflight') {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerPreflight artifactFamily must be site-capability-graph-docs-lifecycle-observability-registration-owner-preflight');
  }
  if (preflight.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerPreflight redactionRequired must be true');
  }
  if (!Array.isArray(preflight.items) || preflight.items.length === 0) {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerPreflight items are required');
  }
  for (const [index, item] of preflight.items.entries()) {
    const itemLabel = `GraphDocsLifecycleObservabilityRegistrationOwnerPreflight.items[${index}]`;
    assertPlainObject(item, itemLabel);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphDocsLifecycleObservabilityRegistrationOwnerPreflight item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.ownerPreflightMode !== 'descriptor-only') {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerPreflight ownerPreflightMode must be descriptor-only');
    }
    if (item.registrationOwnerMode !== 'disabled') {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerPreflight registrationOwnerMode must be disabled');
    }
    if (item.runtimeMode !== 'not-registered') {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerPreflight runtimeMode must be not-registered');
    }
    if (item.result !== 'blocked') {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerPreflight result must be blocked');
    }
    for (const fieldName of GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_IMPLEMENTATION_PREFLIGHT_DISABLED_FLAG_KEYS) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphDocsLifecycleObservabilityRegistrationOwnerPreflight ${fieldName} must be false`);
      }
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`GraphDocsLifecycleObservabilityRegistrationOwnerPreflight reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(item.reason, `${itemLabel}.reason`);
    if (item.reason.code !== item.reasonCode) {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerPreflight reason code must match reasonCode');
    }
    assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightOwnershipPlan(
      item.registrationOwnershipPlan,
      itemLabel,
    );
    for (const fieldName of [
      'producerRegistrationOwner',
      'subscriberRegistrationOwner',
      'telemetryDispatchGate',
      'dispatchWriteGate',
      'logWriteGate',
      'artifactWriteGate',
    ]) {
      if (item[fieldName] !== item.registrationOwnershipPlan[fieldName]) {
        throw new Error(`GraphDocsLifecycleObservabilityRegistrationOwnerPreflight ${fieldName} must match registrationOwnershipPlan`);
      }
    }
    assertPlainObject(item.registrationOwners, `${itemLabel}.registrationOwners`);
    for (const ownerName of ['producerOwner', 'subscriberOwner']) {
      assertPlainObject(item.registrationOwners[ownerName], `${itemLabel}.registrationOwners.${ownerName}`);
      if (item.registrationOwners[ownerName].registrationAllowed !== false) {
        throw new Error(`GraphDocsLifecycleObservabilityRegistrationOwnerPreflight ${ownerName} registrationAllowed must be false`);
      }
      if (item.registrationOwners[ownerName].registrationEnabled !== false) {
        throw new Error(`GraphDocsLifecycleObservabilityRegistrationOwnerPreflight ${ownerName} registrationEnabled must be false`);
      }
    }
    assertPlainObject(item.requiredGuards, `${itemLabel}.requiredGuards`);
    if (
      item.requiredGuards.runtimeImplementationPreflightGuard
        !== 'assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightCompatibility'
    ) {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerPreflight runtimeImplementationPreflightGuard is required');
    }
    if (
      item.requiredGuards.registrationOwnerPreflightGuard
        !== 'assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility'
    ) {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerPreflight registrationOwnerPreflightGuard is required');
    }
    if (
      item.requiredRuntimeImplementationPreflightGuard
        !== 'assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightCompatibility'
    ) {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerPreflight requiredRuntimeImplementationPreflightGuard is required');
    }
    if (
      item.requiredRegistrationOwnerPreflightGuard
        !== 'assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility'
    ) {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerPreflight requiredRegistrationOwnerPreflightGuard is required');
    }
    assertPlainObject(item.sourceRuntimeImplementationPreflight, `${itemLabel}.sourceRuntimeImplementationPreflight`);
    if (
      item.sourceRuntimeImplementationPreflight.queryName
        !== 'createGraphDocsLifecycleObservabilityRuntimeImplementationPreflight'
    ) {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerPreflight sourceRuntimeImplementationPreflight queryName is required');
    }
    if (item.sourceRuntimeImplementationPreflight.result !== 'blocked') {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerPreflight sourceRuntimeImplementationPreflight result must be blocked');
    }
    if (item.sourceRuntimeImplementationPreflight.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`GraphDocsLifecycleObservabilityRegistrationOwnerPreflight sourceRuntimeImplementationPreflight reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    if (!Array.isArray(item.forbiddenRuntimeFields) || item.forbiddenRuntimeFields.length === 0) {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerPreflight forbiddenRuntimeFields are required');
    }
  }
  return true;
}

export function createGraphDocsLifecycleObservabilityRuntimeImplementationPreflight(
  sourceOrOptions = {},
  maybeOptions,
) {
  const calledWithOptions = maybeOptions === undefined && !normalizeText(sourceOrOptions.queryName);
  const options = calledWithOptions
    ? sourceOrOptions
    : maybeOptions ?? {};
  assertPlainObject(options, 'GraphDocsLifecycleObservabilityRuntimeImplementationPreflightOptions');
  assertNoGraphDocsLifecycleObservabilityRuntimeImplementationPreflightRuntimeProducts(
    options,
    'GraphDocsLifecycleObservabilityRuntimeImplementationPreflightOptions',
  );
  assertNoForbiddenGraphFields(
    options,
    'GraphDocsLifecycleObservabilityRuntimeImplementationPreflightOptions',
  );
  assertNoForbiddenPatterns(options);
  assertNoGraphMetricFields(
    options,
    'GraphDocsLifecycleObservabilityRuntimeImplementationPreflightOptions',
  );
  const sourceBoundary = calledWithOptions
    ? options.boundaryDesign
      ?? options.adapterWiringBoundaryDesign
      ?? createGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign(options)
    : sourceOrOptions;
  assertGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignCompatibility(sourceBoundary);
  const {
    preflightName = 'site-capability-graph-docs-lifecycle-observability-runtime-implementation-preflight',
    featureEnabled,
    runtimeImplementationEnabled,
    runtimeRegistrationAllowed,
    runtimeRegistrationEnabled,
    registrationAllowed,
    integrationAllowed,
    adapterWiringEnabled,
    adapterWiringAllowed,
    consumerIntegrationEnabled,
    runtimeConsumerEnabled,
    producerRegistrationAllowed,
    producerRegistrationEnabled,
    subscriberRegistrationAllowed,
    telemetryDispatchAllowed,
    telemetryDispatchEnabled,
    runtimeDispatchAllowed,
    dispatchWriteAllowed,
    dispatchWriteEnabled,
    logWriteAllowed,
    logWriteEnabled,
    artifactWriteAllowed,
    externalTelemetryEnabled,
    sessionMaterializationEnabled,
    runtimeDispatchEnabled,
    externalTelemetryDispatchEnabled,
    subscriberRegistrationEnabled,
    runtimeSubscriberEnabled,
    runtimeDispatchProducerEnabled,
    repoArtifactWriteEnabled,
    runtimeArtifactWriteEnabled,
    artifactWriteEnabled,
    runtimeLogWriteEnabled,
  } = options;
  for (const [fieldName, value] of Object.entries({
    featureEnabled,
    runtimeImplementationEnabled,
    runtimeRegistrationAllowed,
    runtimeRegistrationEnabled,
    registrationAllowed,
    integrationAllowed,
    adapterWiringEnabled,
    adapterWiringAllowed,
    consumerIntegrationEnabled,
    runtimeConsumerEnabled,
    producerRegistrationAllowed,
    producerRegistrationEnabled,
    subscriberRegistrationAllowed,
    telemetryDispatchAllowed,
    telemetryDispatchEnabled,
    runtimeDispatchAllowed,
    dispatchWriteAllowed,
    dispatchWriteEnabled,
    logWriteAllowed,
    logWriteEnabled,
    artifactWriteAllowed,
    externalTelemetryEnabled,
    sessionMaterializationEnabled,
    runtimeDispatchEnabled,
    externalTelemetryDispatchEnabled,
    subscriberRegistrationEnabled,
    runtimeSubscriberEnabled,
    runtimeDispatchProducerEnabled,
    repoArtifactWriteEnabled,
    runtimeArtifactWriteEnabled,
    artifactWriteEnabled,
    runtimeLogWriteEnabled,
  })) {
    assertDisabledFlag(
      value,
      fieldName,
      'GraphDocsLifecycleObservabilityRuntimeImplementationPreflight',
    );
  }
  const sourceItem = sourceBoundary.items[0];
  const disabledFlags = Object.fromEntries(
    GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_IMPLEMENTATION_PREFLIGHT_DISABLED_FLAG_KEYS
      .map((fieldName) => [fieldName, false]),
  );
  const registrationOwnershipPlan = {
    producerRegistrationOwner: 'site-capability-layer-runtime-producer-registry-disabled',
    subscriberRegistrationOwner: 'site-capability-layer-runtime-subscriber-registry-disabled',
    telemetryDispatchGate: 'telemetryDispatchAllowed=false',
    dispatchWriteGate: 'dispatchWriteAllowed=false',
    logWriteGate: 'logWriteAllowed=false',
    artifactWriteGate: 'artifactWriteAllowed=false',
  };
  const preflight = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceBoundary.graphVersion,
    queryName: 'createGraphDocsLifecycleObservabilityRuntimeImplementationPreflight',
    artifactFamily: 'site-capability-graph-docs-lifecycle-observability-runtime-implementation-preflight',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      queryName: 'createGraphDocsLifecycleObservabilityRuntimeImplementationPreflight',
      artifactFamily: 'site-capability-graph-docs-lifecycle-observability-runtime-implementation-preflight',
      redactionRequired: true,
      adapterBoundaryName: sourceItem.adapterBoundaryName,
      consumerName: sourceItem.consumerName,
      adapterName: sourceItem.adapterName,
      boundaryMode: sourceItem.boundaryMode,
      preflightName: assertRequiredText(
        preflightName,
        'preflightName',
        'GraphDocsLifecycleObservabilityRuntimeImplementationPreflight',
      ),
      preflightMode: 'contract-only',
      implementationMode: 'disabled',
      runtimeMode: 'not-registered',
      result: 'blocked',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph docs lifecycle observability runtime implementation is contract-only, disabled, and not registered',
      ),
      registrationOwnershipPlan,
      ...registrationOwnershipPlan,
      requiredBoundaryGuard: 'assertGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignCompatibility',
      requiredRuntimeImplementationPreflightGuard:
        'assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightCompatibility',
      requiredGuards: {
        boundaryGuard: 'assertGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignCompatibility',
        consumerIntegrationGuard: sourceItem.requiredGuards.consumerIntegrationGuard,
        handshakeGuard: sourceItem.requiredHandshakeGuard,
        preflightGuard: sourceItem.requiredPreflightGuard,
        runtimeImplementationPreflightGuard:
          'assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightCompatibility',
      },
      sourceBoundary: summarizeGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign(sourceBoundary),
      sourceDesign: cloneDescriptor(sourceItem.sourceDesign),
      sourceHandshake: cloneDescriptor(sourceItem.sourceHandshake),
      sourcePreflight: cloneDescriptor(sourceItem.sourcePreflight),
      forbiddenRuntimeFields: [
        'producer',
        'subscriber',
        'registerProducer',
        'registerSubscriber',
        'dispatch',
        'dispatchLifecycleEvent',
        'lifecycleEvent',
        'telemetrySink',
        'externalTelemetry',
        'externalTelemetrySink',
        'event',
        'payload',
        'runtimePayload',
        'sourceRuntimePayload',
        'sessionView',
        'siteAdapter',
        'downloader',
        'taskList',
        'artifactPayload',
        'artifactPath',
        'logPath',
      ],
      ...disabledFlags,
    }],
  };
  assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightCompatibility(preflight);
  return cloneDescriptor(preflight);
}

export function createGraphDocsLifecycleObservabilityRegistrationOwnerPreflight(
  sourceOrOptions = {},
  maybeOptions,
) {
  const calledWithOptions = maybeOptions === undefined && !normalizeText(sourceOrOptions.queryName);
  const options = calledWithOptions
    ? sourceOrOptions
    : maybeOptions ?? {};
  assertPlainObject(options, 'GraphDocsLifecycleObservabilityRegistrationOwnerPreflightOptions');
  assertNoGraphDocsLifecycleObservabilityRuntimeImplementationPreflightRuntimeProducts(
    options,
    'GraphDocsLifecycleObservabilityRegistrationOwnerPreflightOptions',
  );
  assertNoForbiddenGraphFields(
    options,
    'GraphDocsLifecycleObservabilityRegistrationOwnerPreflightOptions',
  );
  assertNoForbiddenPatterns(options);
  assertNoGraphMetricFields(
    options,
    'GraphDocsLifecycleObservabilityRegistrationOwnerPreflightOptions',
  );
  const sourceRuntimeImplementationPreflight = calledWithOptions
    ? options.runtimeImplementationPreflight
      ?? options.sourceRuntimeImplementationPreflight
      ?? createGraphDocsLifecycleObservabilityRuntimeImplementationPreflight(options)
    : sourceOrOptions;
  assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightCompatibility(
    sourceRuntimeImplementationPreflight,
  );
  const {
    preflightName = 'site-capability-graph-docs-lifecycle-observability-registration-owner-preflight',
  } = options;
  const sourceItem = sourceRuntimeImplementationPreflight.items[0];
  const disabledFlags = Object.fromEntries(
    GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_IMPLEMENTATION_PREFLIGHT_DISABLED_FLAG_KEYS
      .map((fieldName) => [fieldName, false]),
  );
  const registrationOwnershipPlan = cloneDescriptor(sourceItem.registrationOwnershipPlan);
  const preflight = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceRuntimeImplementationPreflight.graphVersion,
    queryName: 'createGraphDocsLifecycleObservabilityRegistrationOwnerPreflight',
    artifactFamily: 'site-capability-graph-docs-lifecycle-observability-registration-owner-preflight',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      queryName: 'createGraphDocsLifecycleObservabilityRegistrationOwnerPreflight',
      artifactFamily: 'site-capability-graph-docs-lifecycle-observability-registration-owner-preflight',
      redactionRequired: true,
      preflightName: assertRequiredText(
        preflightName,
        'preflightName',
        'GraphDocsLifecycleObservabilityRegistrationOwnerPreflight',
      ),
      ownerPreflightMode: 'descriptor-only',
      registrationOwnerMode: 'disabled',
      runtimeMode: 'not-registered',
      result: 'blocked',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph docs lifecycle observability registration owner preflight is disabled and not registered',
      ),
      consumerName: sourceItem.consumerName,
      adapterName: sourceItem.adapterName,
      registrationOwnershipPlan,
      ...registrationOwnershipPlan,
      registrationOwners: {
        producerOwner: {
          owner: registrationOwnershipPlan.producerRegistrationOwner,
          registrationAllowed: false,
          registrationEnabled: false,
          guard: 'producerRegistrationAllowed=false',
        },
        subscriberOwner: {
          owner: registrationOwnershipPlan.subscriberRegistrationOwner,
          registrationAllowed: false,
          registrationEnabled: false,
          guard: 'subscriberRegistrationAllowed=false',
        },
      },
      requiredRuntimeImplementationPreflightGuard:
        'assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightCompatibility',
      requiredRegistrationOwnerPreflightGuard:
        'assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility',
      requiredGuards: {
        ...cloneDescriptor(sourceItem.requiredGuards),
        registrationOwnerPreflightGuard:
          'assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility',
      },
      sourceRuntimeImplementationPreflight: {
        queryName: sourceRuntimeImplementationPreflight.queryName,
        artifactFamily: sourceRuntimeImplementationPreflight.artifactFamily,
        graphVersion: sourceRuntimeImplementationPreflight.graphVersion,
        result: sourceItem.result,
        reasonCode: sourceItem.reasonCode,
        preflightName: sourceItem.preflightName,
        runtimeMode: sourceItem.runtimeMode,
        implementationMode: sourceItem.implementationMode,
        registrationOwnershipPlan: cloneDescriptor(sourceItem.registrationOwnershipPlan),
      },
      forbiddenRuntimeFields: [
        'registration',
        'producerRegistration',
        'subscriberRegistration',
        'producer',
        'subscriber',
        'registerProducer',
        'registerSubscriber',
        'telemetrySink',
        'externalTelemetry',
        'dispatch',
        'dispatchLifecycleEvent',
        'lifecycleEvent',
        'event',
        'payload',
        'runtimePayload',
        'sessionView',
        'siteAdapter',
        'downloader',
        'taskList',
        'artifactPayload',
        'artifactPath',
        'logPath',
      ],
      ...disabledFlags,
    }],
  };
  assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility(preflight);
  return cloneDescriptor(preflight);
}

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_REGISTRATION_OWNER_HANDOFF_DISABLED_FLAG_KEYS = Object.freeze([
  ...GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_IMPLEMENTATION_PREFLIGHT_DISABLED_FLAG_KEYS,
  'registrationHandoffAllowed',
  'registrationHandoffEnabled',
  'producerHandoffAllowed',
  'producerHandoffEnabled',
  'subscriberHandoffAllowed',
  'subscriberHandoffEnabled',
  'telemetryHandoffAllowed',
  'telemetryHandoffEnabled',
  'dispatchHandoffAllowed',
  'dispatchHandoffEnabled',
  'logHandoffAllowed',
  'logHandoffEnabled',
  'artifactHandoffAllowed',
  'artifactHandoffEnabled',
  'writeAllowed',
  'writeEnabled',
  'runtimeWriteAllowed',
  'runtimeWriteEnabled',
  'repoWriteAllowed',
  'repoWriteEnabled',
  'sessionViewEnabled',
  'downloaderEnabled',
  'siteAdapterEnabled',
]);

function summarizeGraphDocsLifecycleObservabilityRegistrationOwnerPreflight(preflight) {
  assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility(preflight);
  const item = preflight.items[0];
  return {
    queryName: preflight.queryName,
    artifactFamily: preflight.artifactFamily,
    graphVersion: preflight.graphVersion,
    redactionRequired: preflight.redactionRequired,
    preflightName: item.preflightName,
    ownerPreflightMode: item.ownerPreflightMode,
    registrationOwnerMode: item.registrationOwnerMode,
    runtimeMode: item.runtimeMode,
    result: item.result,
    reasonCode: item.reasonCode,
    consumerName: item.consumerName,
    adapterName: item.adapterName,
    registrationOwnershipPlan: cloneDescriptor(item.registrationOwnershipPlan),
    producerRegistrationOwner: item.producerRegistrationOwner,
    subscriberRegistrationOwner: item.subscriberRegistrationOwner,
    telemetryDispatchGate: item.telemetryDispatchGate,
    dispatchWriteGate: item.dispatchWriteGate,
    logWriteGate: item.logWriteGate,
    artifactWriteGate: item.artifactWriteGate,
    requiredRuntimeImplementationPreflightGuard: item.requiredRuntimeImplementationPreflightGuard,
    requiredRegistrationOwnerPreflightGuard: item.requiredRegistrationOwnerPreflightGuard,
  };
}

function assertGraphDocsLifecycleObservabilityRegistrationOwnerHandoffSourcePreflight(
  sourcePreflight,
  label,
) {
  assertPlainObject(sourcePreflight, `${label}.sourceRegistrationOwnerPreflight`);
  if (sourcePreflight.queryName !== 'createGraphDocsLifecycleObservabilityRegistrationOwnerPreflight') {
    throw new Error(`${label} sourceRegistrationOwnerPreflight queryName must be createGraphDocsLifecycleObservabilityRegistrationOwnerPreflight`);
  }
  if (
    sourcePreflight.artifactFamily
      !== 'site-capability-graph-docs-lifecycle-observability-registration-owner-preflight'
  ) {
    throw new Error(`${label} sourceRegistrationOwnerPreflight artifactFamily must be site-capability-graph-docs-lifecycle-observability-registration-owner-preflight`);
  }
  if (sourcePreflight.redactionRequired !== true) {
    throw new Error(`${label} sourceRegistrationOwnerPreflight redactionRequired must be true`);
  }
  if (sourcePreflight.ownerPreflightMode !== 'descriptor-only') {
    throw new Error(`${label} sourceRegistrationOwnerPreflight ownerPreflightMode must be descriptor-only`);
  }
  if (sourcePreflight.registrationOwnerMode !== 'disabled') {
    throw new Error(`${label} sourceRegistrationOwnerPreflight registrationOwnerMode must be disabled`);
  }
  if (sourcePreflight.runtimeMode !== 'not-registered') {
    throw new Error(`${label} sourceRegistrationOwnerPreflight runtimeMode must be not-registered`);
  }
  if (sourcePreflight.result !== 'blocked') {
    throw new Error(`${label} sourceRegistrationOwnerPreflight result must be blocked`);
  }
  if (sourcePreflight.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
    throw new Error(`${label} sourceRegistrationOwnerPreflight reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightOwnershipPlan(
    sourcePreflight.registrationOwnershipPlan,
    label,
  );
  for (const fieldName of [
    'producerRegistrationOwner',
    'subscriberRegistrationOwner',
    'telemetryDispatchGate',
    'dispatchWriteGate',
    'logWriteGate',
    'artifactWriteGate',
  ]) {
    if (sourcePreflight[fieldName] !== sourcePreflight.registrationOwnershipPlan[fieldName]) {
      throw new Error(`${label} sourceRegistrationOwnerPreflight ${fieldName} must match registrationOwnershipPlan`);
    }
  }
  if (
    sourcePreflight.requiredRegistrationOwnerPreflightGuard
      !== 'assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility'
  ) {
    throw new Error(`${label} sourceRegistrationOwnerPreflight requiredRegistrationOwnerPreflightGuard is required`);
  }
  return true;
}

export function assertGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardCompatibility(
  guard = {},
) {
  assertPlainObject(guard, 'GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard');
  assertNoForbiddenGraphFields(
    guard,
    'GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard',
  );
  assertNoForbiddenPatterns(guard);
  assertNoGraphMetricFields(
    guard,
    'GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard',
  );
  assertGraphQueryResultCompatible(guard);
  if (guard.queryName !== 'createGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard') {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard queryName must be createGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard');
  }
  if (
    guard.artifactFamily
      !== 'site-capability-graph-docs-lifecycle-observability-registration-owner-handoff-guard'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard artifactFamily must be site-capability-graph-docs-lifecycle-observability-registration-owner-handoff-guard');
  }
  if (guard.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard redactionRequired must be true');
  }
  if (!Array.isArray(guard.items) || guard.items.length === 0) {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard items are required');
  }
  for (const [index, item] of guard.items.entries()) {
    const itemLabel = `GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard.items[${index}]`;
    assertPlainObject(item, itemLabel);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.handoffMode !== 'descriptor-only') {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard handoffMode must be descriptor-only');
    }
    if (item.registrationOwnerMode !== 'disabled') {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard registrationOwnerMode must be disabled');
    }
    if (item.runtimeMode !== 'not-registered') {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard runtimeMode must be not-registered');
    }
    if (item.result !== 'blocked') {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard result must be blocked');
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(item.reason, `${itemLabel}.reason`);
    if (item.reason.code !== item.reasonCode) {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard reason code must match reasonCode');
    }
    for (const fieldName of GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_REGISTRATION_OWNER_HANDOFF_DISABLED_FLAG_KEYS) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard ${fieldName} must be false`);
      }
    }
    assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightOwnershipPlan(
      item.registrationOwnershipPlan,
      itemLabel,
    );
    for (const fieldName of [
      'producerRegistrationOwner',
      'subscriberRegistrationOwner',
      'telemetryDispatchGate',
      'dispatchWriteGate',
      'logWriteGate',
      'artifactWriteGate',
    ]) {
      if (item[fieldName] !== item.registrationOwnershipPlan[fieldName]) {
        throw new Error(`GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard ${fieldName} must match registrationOwnershipPlan`);
      }
    }
    assertPlainObject(item.requiredGuards, `${itemLabel}.requiredGuards`);
    if (
      item.requiredGuards.registrationOwnerPreflightGuard
        !== 'assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility'
    ) {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard registrationOwnerPreflightGuard is required');
    }
    if (
      item.requiredGuards.registrationOwnerHandoffGuard
        !== 'assertGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardCompatibility'
    ) {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard registrationOwnerHandoffGuard is required');
    }
    if (
      item.requiredRegistrationOwnerPreflightGuard
        !== 'assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility'
    ) {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard requiredRegistrationOwnerPreflightGuard is required');
    }
    if (
      item.requiredRegistrationOwnerHandoffGuard
        !== 'assertGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardCompatibility'
    ) {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard requiredRegistrationOwnerHandoffGuard is required');
    }
    assertGraphDocsLifecycleObservabilityRegistrationOwnerHandoffSourcePreflight(
      item.sourceRegistrationOwnerPreflight,
      itemLabel,
    );
    if (!Array.isArray(item.forbiddenRuntimeFields) || item.forbiddenRuntimeFields.length === 0) {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard forbiddenRuntimeFields are required');
    }
  }
  assertNoGraphDocsLifecycleObservabilityRuntimeImplementationPreflightRuntimeProducts(
    guard,
    'GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard',
  );
  return true;
}

export function createGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard(
  sourceOrOptions = {},
  maybeOptions,
) {
  const calledWithOptions = maybeOptions === undefined && !normalizeText(sourceOrOptions.queryName);
  const options = calledWithOptions
    ? sourceOrOptions
    : maybeOptions ?? {};
  assertPlainObject(options, 'GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardOptions');
  assertNoGraphDocsLifecycleObservabilityRuntimeImplementationPreflightRuntimeProducts(
    options,
    'GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardOptions',
  );
  assertNoForbiddenGraphFields(
    options,
    'GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardOptions',
  );
  assertNoForbiddenPatterns(options);
  assertNoGraphMetricFields(
    options,
    'GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardOptions',
  );
  const sourceRegistrationOwnerPreflight = calledWithOptions
    ? options.registrationOwnerPreflight
      ?? options.sourceRegistrationOwnerPreflight
      ?? createGraphDocsLifecycleObservabilityRegistrationOwnerPreflight(options)
    : sourceOrOptions;
  assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility(
    sourceRegistrationOwnerPreflight,
  );
  const {
    handoffName = 'site-capability-graph-docs-lifecycle-observability-registration-owner-handoff-guard',
  } = options;
  const sourceItem = sourceRegistrationOwnerPreflight.items[0];
  for (const fieldName of GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_REGISTRATION_OWNER_HANDOFF_DISABLED_FLAG_KEYS) {
    assertDisabledFlag(
      options[fieldName],
      fieldName,
      'GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard',
    );
  }
  const disabledFlags = Object.fromEntries(
    GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_REGISTRATION_OWNER_HANDOFF_DISABLED_FLAG_KEYS
      .map((fieldName) => [fieldName, false]),
  );
  const registrationOwnershipPlan = cloneDescriptor(sourceItem.registrationOwnershipPlan);
  const guard = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceRegistrationOwnerPreflight.graphVersion,
    queryName: 'createGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard',
    artifactFamily:
      'site-capability-graph-docs-lifecycle-observability-registration-owner-handoff-guard',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      queryName: 'createGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard',
      artifactFamily:
        'site-capability-graph-docs-lifecycle-observability-registration-owner-handoff-guard',
      redactionRequired: true,
      handoffName: assertRequiredText(
        handoffName,
        'handoffName',
        'GraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard',
      ),
      handoffMode: 'descriptor-only',
      registrationOwnerMode: 'disabled',
      runtimeMode: 'not-registered',
      result: 'blocked',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph docs lifecycle observability registration owner handoff is descriptor-only, blocked, and not registered',
      ),
      consumerName: sourceItem.consumerName,
      adapterName: sourceItem.adapterName,
      registrationOwnershipPlan,
      ...registrationOwnershipPlan,
      requiredRegistrationOwnerPreflightGuard:
        'assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility',
      requiredRegistrationOwnerHandoffGuard:
        'assertGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardCompatibility',
      requiredGuards: {
        ...cloneDescriptor(sourceItem.requiredGuards),
        registrationOwnerPreflightGuard:
          'assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility',
        registrationOwnerHandoffGuard:
          'assertGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardCompatibility',
      },
      sourceRegistrationOwnerPreflight:
        summarizeGraphDocsLifecycleObservabilityRegistrationOwnerPreflight(
          sourceRegistrationOwnerPreflight,
        ),
      forbiddenRuntimeFields: [
        'registration',
        'producerRegistration',
        'subscriberRegistration',
        'producer',
        'subscriber',
        'registerProducer',
        'registerSubscriber',
        'telemetrySink',
        'externalTelemetry',
        'externalTelemetrySink',
        'dispatch',
        'dispatchLifecycleEvent',
        'lifecycleEvent',
        'event',
        'payload',
        'runtimePayload',
        'sourceRuntimePayload',
        'sessionView',
        'siteAdapter',
        'siteAdapterPayload',
        'downloader',
        'downloadPolicy',
        'standardTaskList',
        'taskList',
        'artifactPayload',
        'artifactPath',
        'runtimeArtifact',
        'runtimeLog',
        'logPath',
        'writePath',
        'handler',
        'publisher',
      ],
      ...disabledFlags,
    }],
  };
  assertGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardCompatibility(guard);
  return cloneDescriptor(guard);
}

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_REGISTRATION_CONSUMER_GUARD_DISABLED_FLAG_KEYS = Object.freeze([
  ...GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_REGISTRATION_OWNER_HANDOFF_DISABLED_FLAG_KEYS,
  'runtimeRegistrationConsumerEnabled',
  'runtimeRegistrationConsumerAllowed',
  'runtimeRegistrationEnabled',
  'runtimeRegistrationAllowed',
  'producerRegistrationEnabled',
  'producerRegistrationAllowed',
  'subscriberRegistrationEnabled',
  'subscriberRegistrationAllowed',
  'externalTelemetryEnabled',
  'runtimeDispatchEnabled',
  'dispatchWriteEnabled',
  'logWriteEnabled',
  'artifactWriteEnabled',
  'repoWriteEnabled',
  'runtimeWriteEnabled',
  'runtimeArtifactWriteEnabled',
  'sessionViewEnabled',
  'downloaderEnabled',
  'siteAdapterEnabled',
  'runtimeConsumerEnabled',
  'statusPromotionAllowed',
  'statusPromotionEnabled',
  'verifiedPromotionAllowed',
  'verifiedPromotionEnabled',
]);

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_REGISTRATION_CONSUMER_GUARD_DISABLED_FLAG_KEY_SET = new Set(
  GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_REGISTRATION_CONSUMER_GUARD_DISABLED_FLAG_KEYS
    .map((key) => normalizeKey(key)),
);

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_REGISTRATION_CONSUMER_GUARD_RUNTIME_PRODUCT_KEYS = Object.freeze([
  ...DISABLED_GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_ADAPTER_RUNTIME_PRODUCT_KEYS,
  'registration',
  'runtimeRegistration',
  'producerRegistration',
  'subscriberRegistration',
  'registerProducer',
  'registerSubscriber',
  'producer',
  'subscriber',
  'telemetrySink',
  'externalTelemetry',
  'dispatch',
  'dispatchLifecycleEvent',
  'lifecycleEvent',
  'event',
  'payload',
  'runtimePayload',
  'sourceRuntimePayload',
  'telemetryPayload',
  'dispatchPayload',
  'writePayload',
  'sessionView',
  'siteAdapter',
  'siteAdapterPayload',
  'downloader',
  'downloadPolicy',
  'standardTaskList',
  'taskList',
  'artifactPayload',
  'artifactPath',
  'runtimeArtifact',
  'runtimeLog',
  'logPath',
  'writePath',
  'outputPath',
  'handler',
  'publisher',
  'statusPromotion',
  'verifiedPromotion',
  'authorizationHeader',
  'cookie',
  'token',
  'sessionId',
  'browserProfile',
]);

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_REGISTRATION_CONSUMER_GUARD_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_REGISTRATION_CONSUMER_GUARD_RUNTIME_PRODUCT_KEYS
    .map((key) => normalizeKey(key)),
);

function assertNoGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardRuntimeProducts(
  value,
  label = 'GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => (
      assertNoGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardRuntimeProducts(
        entry,
        label,
        `${path}[${index}]`,
      )
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (
      GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_REGISTRATION_CONSUMER_GUARD_DISABLED_FLAG_KEY_SET
        .has(normalizedKey)
    ) {
      if (entry !== false && entry !== undefined) {
        throw new Error(`${label} descriptor-only ${key} must remain false`);
      }
    } else if (
      GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_REGISTRATION_CONSUMER_GUARD_RUNTIME_PRODUCT_KEY_SET
        .has(normalizedKey)
    ) {
      throw new Error(`${label} descriptor-only rejected runtime field: ${path}.${key}`);
    }
    assertNoGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardRuntimeProducts(
      entry,
      label,
      `${path}.${key}`,
    );
  }
  return true;
}

function summarizeGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard(handoffGuard) {
  assertGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardCompatibility(handoffGuard);
  const item = handoffGuard.items[0];
  return {
    queryName: handoffGuard.queryName,
    artifactFamily: handoffGuard.artifactFamily,
    graphVersion: handoffGuard.graphVersion,
    redactionRequired: handoffGuard.redactionRequired,
    handoffName: item.handoffName,
    handoffMode: item.handoffMode,
    registrationOwnerMode: item.registrationOwnerMode,
    runtimeMode: item.runtimeMode,
    result: item.result,
    reasonCode: item.reasonCode,
    consumerName: item.consumerName,
    adapterName: item.adapterName,
    registrationOwnershipPlan: cloneDescriptor(item.registrationOwnershipPlan),
    requiredGuards: cloneDescriptor(item.requiredGuards),
    sourceRegistrationOwnerPreflight: cloneDescriptor(item.sourceRegistrationOwnerPreflight),
  };
}

function assertGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardSourceHandoff(
  sourceHandoff,
  label,
) {
  assertPlainObject(sourceHandoff, `${label}.sourceRegistrationOwnerHandoffGuard`);
  if (sourceHandoff.queryName !== 'createGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard') {
    throw new Error(`${label} sourceRegistrationOwnerHandoffGuard queryName must be createGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard`);
  }
  if (
    sourceHandoff.artifactFamily
      !== 'site-capability-graph-docs-lifecycle-observability-registration-owner-handoff-guard'
  ) {
    throw new Error(`${label} sourceRegistrationOwnerHandoffGuard artifactFamily must be site-capability-graph-docs-lifecycle-observability-registration-owner-handoff-guard`);
  }
  if (sourceHandoff.redactionRequired !== true) {
    throw new Error(`${label} sourceRegistrationOwnerHandoffGuard redactionRequired must be true`);
  }
  if (sourceHandoff.handoffMode !== 'descriptor-only') {
    throw new Error(`${label} sourceRegistrationOwnerHandoffGuard handoffMode must be descriptor-only`);
  }
  if (sourceHandoff.registrationOwnerMode !== 'disabled') {
    throw new Error(`${label} sourceRegistrationOwnerHandoffGuard registrationOwnerMode must be disabled`);
  }
  if (sourceHandoff.runtimeMode !== 'not-registered') {
    throw new Error(`${label} sourceRegistrationOwnerHandoffGuard runtimeMode must be not-registered`);
  }
  if (sourceHandoff.result !== 'blocked') {
    throw new Error(`${label} sourceRegistrationOwnerHandoffGuard result must be blocked`);
  }
  if (sourceHandoff.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
    throw new Error(`${label} sourceRegistrationOwnerHandoffGuard reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightOwnershipPlan(
    sourceHandoff.registrationOwnershipPlan,
    label,
  );
  assertPlainObject(sourceHandoff.requiredGuards, `${label}.sourceRegistrationOwnerHandoffGuard.requiredGuards`);
  if (
    sourceHandoff.requiredGuards.registrationOwnerPreflightGuard
      !== 'assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility'
  ) {
    throw new Error(`${label} sourceRegistrationOwnerHandoffGuard registrationOwnerPreflightGuard is required`);
  }
  if (
    sourceHandoff.requiredGuards.registrationOwnerHandoffGuard
      !== 'assertGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardCompatibility'
  ) {
    throw new Error(`${label} sourceRegistrationOwnerHandoffGuard registrationOwnerHandoffGuard is required`);
  }
  return true;
}

export function assertGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardCompatibility(
  guard = {},
) {
  assertPlainObject(guard, 'GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard');
  assertNoGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardRuntimeProducts(
    guard,
    'GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard',
  );
  assertNoForbiddenGraphFields(
    guard,
    'GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard',
  );
  assertNoForbiddenPatterns(guard);
  assertNoGraphMetricFields(
    guard,
    'GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard',
  );
  assertGraphQueryResultCompatible(guard);
  if (guard.queryName !== 'createGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard queryName must be createGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard');
  }
  if (
    guard.artifactFamily
      !== 'site-capability-graph-docs-lifecycle-observability-runtime-registration-consumer-guard'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard artifactFamily must be site-capability-graph-docs-lifecycle-observability-runtime-registration-consumer-guard');
  }
  if (guard.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard redactionRequired must be true');
  }
  if (!Array.isArray(guard.items) || guard.items.length === 0) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard items are required');
  }
  for (const [index, item] of guard.items.entries()) {
    const itemLabel = `GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard.items[${index}]`;
    assertPlainObject(item, itemLabel);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.guardMode !== 'descriptor-only') {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard guardMode must be descriptor-only');
    }
    if (item.runtimeRegistrationMode !== 'disabled') {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard runtimeRegistrationMode must be disabled');
    }
    if (item.runtimeMode !== 'not-registered') {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard runtimeMode must be not-registered');
    }
    if (item.result !== 'blocked') {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard result must be blocked');
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(item.reason, `${itemLabel}.reason`);
    if (item.reason.code !== item.reasonCode) {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard reason code must match reasonCode');
    }
    for (const fieldName of GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_REGISTRATION_CONSUMER_GUARD_DISABLED_FLAG_KEYS) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard ${fieldName} must be false`);
      }
    }
    assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightOwnershipPlan(
      item.registrationOwnershipPlan,
      itemLabel,
    );
    for (const fieldName of [
      'producerRegistrationOwner',
      'subscriberRegistrationOwner',
      'telemetryDispatchGate',
      'dispatchWriteGate',
      'logWriteGate',
      'artifactWriteGate',
    ]) {
      if (item[fieldName] !== item.registrationOwnershipPlan[fieldName]) {
        throw new Error(`GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard ${fieldName} must match registrationOwnershipPlan`);
      }
    }
    assertPlainObject(item.requiredGuards, `${itemLabel}.requiredGuards`);
    if (
      item.requiredGuards.registrationOwnerPreflightGuard
        !== 'assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility'
    ) {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard registrationOwnerPreflightGuard is required');
    }
    if (
      item.requiredGuards.registrationOwnerHandoffGuard
        !== 'assertGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardCompatibility'
    ) {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard registrationOwnerHandoffGuard is required');
    }
    if (
      item.requiredGuards.runtimeRegistrationConsumerGuard
        !== 'assertGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardCompatibility'
    ) {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard runtimeRegistrationConsumerGuard is required');
    }
    assertGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardSourceHandoff(
      item.sourceRegistrationOwnerHandoffGuard,
      itemLabel,
    );
    if (!Array.isArray(item.forbiddenRuntimeFields) || item.forbiddenRuntimeFields.length === 0) {
      throw new Error('GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard forbiddenRuntimeFields are required');
    }
  }
  return true;
}

export function createGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard(
  sourceOrOptions = {},
  maybeOptions,
) {
  const calledWithOptions = maybeOptions === undefined && !normalizeText(sourceOrOptions.queryName);
  const options = calledWithOptions
    ? sourceOrOptions
    : maybeOptions ?? {};
  assertPlainObject(options, 'GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardOptions');
  assertNoGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardRuntimeProducts(
    options,
    'GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardOptions',
  );
  assertNoForbiddenGraphFields(
    options,
    'GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardOptions',
  );
  assertNoForbiddenPatterns(options);
  assertNoGraphMetricFields(
    options,
    'GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardOptions',
  );
  const sourceRegistrationOwnerHandoffGuard = calledWithOptions
    ? options.registrationOwnerHandoffGuard
      ?? options.sourceRegistrationOwnerHandoffGuard
      ?? createGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard(options)
    : sourceOrOptions;
  assertGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardCompatibility(
    sourceRegistrationOwnerHandoffGuard,
  );
  const {
    guardName = 'site-capability-graph-docs-lifecycle-observability-runtime-registration-consumer-guard',
  } = options;
  const sourceItem = sourceRegistrationOwnerHandoffGuard.items[0];
  for (const fieldName of GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_REGISTRATION_CONSUMER_GUARD_DISABLED_FLAG_KEYS) {
    assertDisabledFlag(
      options[fieldName],
      fieldName,
      'GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard',
    );
  }
  const disabledFlags = Object.fromEntries(
    GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_REGISTRATION_CONSUMER_GUARD_DISABLED_FLAG_KEYS
      .map((fieldName) => [fieldName, false]),
  );
  const registrationOwnershipPlan = cloneDescriptor(sourceItem.registrationOwnershipPlan);
  const guard = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceRegistrationOwnerHandoffGuard.graphVersion,
    queryName: 'createGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard',
    artifactFamily:
      'site-capability-graph-docs-lifecycle-observability-runtime-registration-consumer-guard',
    redactionRequired: true,
    items: [({
      schemaVersion: 1,
      queryName: 'createGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard',
      artifactFamily:
        'site-capability-graph-docs-lifecycle-observability-runtime-registration-consumer-guard',
      redactionRequired: true,
      guardName: assertRequiredText(
        guardName,
        'guardName',
        'GraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard',
      ),
      guardMode: 'descriptor-only',
      runtimeRegistrationMode: 'disabled',
      runtimeMode: 'not-registered',
      result: 'blocked',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph docs lifecycle observability runtime registration consumer guard is descriptor-only, blocked, and not registered',
      ),
      consumerName: sourceItem.consumerName,
      adapterName: sourceItem.adapterName,
      registrationOwnershipPlan,
      ...registrationOwnershipPlan,
      requiredGuards: {
        ...cloneDescriptor(sourceItem.requiredGuards),
        registrationOwnerPreflightGuard:
          'assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility',
        registrationOwnerHandoffGuard:
          'assertGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardCompatibility',
        runtimeRegistrationConsumerGuard:
          'assertGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardCompatibility',
      },
      sourceRegistrationOwnerHandoffGuard:
        summarizeGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard(
          sourceRegistrationOwnerHandoffGuard,
        ),
      forbiddenRuntimeFields: [
        'registration',
        'runtimeRegistration',
        'producerRegistration',
        'subscriberRegistration',
        'registerProducer',
        'registerSubscriber',
        'producer',
        'subscriber',
        'telemetrySink',
        'externalTelemetry',
        'dispatch',
        'dispatchLifecycleEvent',
        'lifecycleEvent',
        'event',
        'payload',
        'runtimePayload',
        'sourceRuntimePayload',
        'telemetryPayload',
        'dispatchPayload',
        'writePayload',
        'sessionView',
        'siteAdapter',
        'siteAdapterPayload',
        'downloader',
        'downloadPolicy',
        'standardTaskList',
        'taskList',
        'artifactPayload',
        'artifactPath',
        'runtimeArtifact',
        'runtimeLog',
        'logPath',
        'writePath',
        'outputPath',
        'handler',
        'publisher',
        'statusPromotion',
        'verifiedPromotion',
      ],
      ...disabledFlags,
    })],
  };
  assertGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardCompatibility(guard);
  return cloneDescriptor(guard);
}

/** @param {Record<string, any>} options */
export function createGraphDocsGenerationLifecycleEventRegistrySubscriber(options = {}) {
  assertPlainObject(options, 'GraphDocsGenerationLifecycleEventRegistrySubscriberOptions');
  assertNoGraphDocsGenerationLifecycleRuntimeProducts(
    options,
    'GraphDocsGenerationLifecycleEventRegistrySubscriberOptions',
  );
  assertNoForbiddenGraphFields(
    options,
    'GraphDocsGenerationLifecycleEventRegistrySubscriberOptions',
  );
  assertNoForbiddenPatterns(options);
  assertNoGraphMetricFields(
    options,
    'GraphDocsGenerationLifecycleEventRegistrySubscriberOptions',
  );
  if (options.redactionRequired !== undefined && options.redactionRequired !== true) {
    throw new Error('GraphDocsGenerationLifecycleEventRegistrySubscriber redactionRequired must be true');
  }
  for (const fieldName of [
    'writesArtifacts',
    'writesLogs',
    'externalDispatch',
    'siteAdapterInvocation',
    'downloaderInvocation',
    'sessionMaterialization',
    'graphExecution',
  ]) {
    if (options[fieldName] !== undefined && options[fieldName] !== false) {
      throw new Error(`GraphDocsGenerationLifecycleEventRegistrySubscriber ${fieldName} must be false`);
    }
  }
  const subscriberId = assertRequiredText(
    options.subscriberId ?? 'site-capability-graph-docs-lifecycle-event-consumer',
    'subscriberId',
    'GraphDocsGenerationLifecycleEventRegistrySubscriber',
  );
  const descriptor = {
    subscriberId,
    eventTypes: [GRAPH_DOCS_GENERATION_EVENT_TYPE],
    redactionRequired: true,
    externalTelemetry: false,
    writesArtifacts: false,
    writesLogs: false,
  };
  assertNoForbiddenGraphFields(
    descriptor,
    'GraphDocsGenerationLifecycleEventRegistrySubscriber',
  );
  assertNoForbiddenPatterns(descriptor);
  assertNoGraphMetricFields(
    descriptor,
    'GraphDocsGenerationLifecycleEventRegistrySubscriber',
  );
  return {
    ...descriptor,
    async subscriber(event) {
      assertGraphDocsGenerationLifecycleEventConsumerCompatibility(event);
      const normalized = normalizeLifecycleEvent(event, {
        eventType: GRAPH_DOCS_GENERATION_EVENT_TYPE,
        taskType: 'site-capability-graph-docs',
      });
      return {
        accepted: true,
        subscriberId,
        eventType: normalized.eventType,
        graphVersion: normalized.details.graphVersion,
        reasonCode: normalized.reasonCode,
        redactionRequired: true,
      };
    },
  };
}

function assertGraphDocsGenerationLifecycleEventRegistrySubscriberDescriptor(
  descriptor = {},
  label = 'GraphDocsGenerationLifecycleEventRegistrySubscriber',
) {
  assertPlainObject(descriptor, label);
  if (typeof descriptor.subscriber !== 'function') {
    throw new Error(`${label} subscriber must be a function`);
  }
  if (!normalizeText(descriptor.subscriberId)) {
    throw new Error(`${label} subscriberId is required`);
  }
  if (
    !Array.isArray(descriptor.eventTypes)
    || descriptor.eventTypes.length !== 1
    || descriptor.eventTypes[0] !== GRAPH_DOCS_GENERATION_EVENT_TYPE
  ) {
    throw new Error(`${label} eventTypes must target ${GRAPH_DOCS_GENERATION_EVENT_TYPE}`);
  }
  if (descriptor.redactionRequired !== true) {
    throw new Error(`${label} redactionRequired must be true`);
  }
  for (const fieldName of [
    'externalTelemetry',
    'writesArtifacts',
    'writesLogs',
  ]) {
    if (descriptor[fieldName] !== false) {
      throw new Error(`${label} ${fieldName} must be false`);
    }
  }
  const safeDescriptor = {
    subscriberId: descriptor.subscriberId,
    eventTypes: descriptor.eventTypes,
    redactionRequired: descriptor.redactionRequired,
    externalTelemetry: descriptor.externalTelemetry,
    writesArtifacts: descriptor.writesArtifacts,
    writesLogs: descriptor.writesLogs,
  };
  assertNoForbiddenGraphFields(safeDescriptor, label);
  assertNoForbiddenPatterns(safeDescriptor);
  assertNoGraphMetricFields(safeDescriptor, label);
  return true;
}

/** @param {Record<string, any>} [descriptor] */
function createGraphDocsGenerationLifecycleEventRegistrySubscriberSummary(descriptor = {}) {
  assertGraphDocsGenerationLifecycleEventRegistrySubscriberDescriptor(descriptor);
  return {
    subscriberId: descriptor.subscriberId,
    eventTypes: [...descriptor.eventTypes],
    redactionRequired: true,
    externalTelemetry: false,
    writesArtifacts: false,
    writesLogs: false,
  };
}

/** @param {Record<string, any>} options */
function assertGraphDocsLifecycleObservabilityRegistrationOwnerIntegrationOptions(options = {}) {
  assertPlainObject(options, 'GraphDocsLifecycleObservabilityRegistrationOwnerIntegrationOptions');
  const {
    registry,
    subscriberRegistry,
    registrySubscriber,
    runtimeRegistrationConsumerGuard,
    sourceRuntimeRegistrationConsumerGuard,
    ...guardedOptions
  } = options;
  void registry;
  void subscriberRegistry;
  void registrySubscriber;
  void runtimeRegistrationConsumerGuard;
  void sourceRuntimeRegistrationConsumerGuard;
  assertNoGraphDocsGenerationLifecycleRuntimeProducts(
    guardedOptions,
    'GraphDocsLifecycleObservabilityRegistrationOwnerIntegrationOptions',
  );
  assertNoGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardRuntimeProducts(
    guardedOptions,
    'GraphDocsLifecycleObservabilityRegistrationOwnerIntegrationOptions',
  );
  assertNoForbiddenGraphFields(
    guardedOptions,
    'GraphDocsLifecycleObservabilityRegistrationOwnerIntegrationOptions',
  );
  assertNoForbiddenPatterns(guardedOptions);
  assertNoGraphMetricFields(
    guardedOptions,
    'GraphDocsLifecycleObservabilityRegistrationOwnerIntegrationOptions',
  );
  if (options.redactionRequired !== undefined && options.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerIntegration redactionRequired must be true');
  }
  for (const fieldName of [
    'externalTelemetry',
    'externalTelemetryEnabled',
    'runtimeDispatchEnabled',
    'writesArtifacts',
    'writesLogs',
    'writesDocs',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'siteAdapterInvocation',
    'downloaderInvocation',
    'sessionMaterialization',
    'graphExecution',
  ]) {
    if (options[fieldName] !== undefined && options[fieldName] !== false) {
      throw new Error(`GraphDocsLifecycleObservabilityRegistrationOwnerIntegration ${fieldName} must be false`);
    }
  }
  return true;
}

export function assertGraphDocsLifecycleObservabilityRegistrationOwnerIntegrationCompatibility(
  result = {},
) {
  assertPlainObject(result, 'GraphDocsLifecycleObservabilityRegistrationOwnerIntegration');
  assertNoForbiddenGraphFields(
    result,
    'GraphDocsLifecycleObservabilityRegistrationOwnerIntegration',
  );
  assertNoForbiddenPatterns(result);
  assertNoGraphMetricFields(
    result,
    'GraphDocsLifecycleObservabilityRegistrationOwnerIntegration',
  );
  assertGraphQueryResultCompatible(result);
  if (result.queryName !== 'createGraphDocsLifecycleObservabilityRegistrationOwnerIntegration') {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerIntegration queryName must be createGraphDocsLifecycleObservabilityRegistrationOwnerIntegration');
  }
  if (
    result.artifactFamily
      !== 'site-capability-graph-docs-lifecycle-observability-registration-owner-integration'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerIntegration artifactFamily must be site-capability-graph-docs-lifecycle-observability-registration-owner-integration');
  }
  if (result.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerIntegration redactionRequired must be true');
  }
  if (!Array.isArray(result.items) || result.items.length !== 1) {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerIntegration requires exactly one item');
  }
  const item = result.items[0];
  assertPlainObject(item, 'GraphDocsLifecycleObservabilityRegistrationOwnerIntegration.items[0]');
  if (item.schemaVersion !== 1) {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerIntegration item schemaVersion is not compatible');
  }
  if (item.registrationOwner !== 'Layer') {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerIntegration registrationOwner must be Layer');
  }
  if (item.registryType !== 'in-memory-lifecycle-subscriber-registry') {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerIntegration registryType is not supported');
  }
  if (!normalizeText(item.registeredSubscriberId)) {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerIntegration registeredSubscriberId is required');
  }
  if (
    !Array.isArray(item.eventTypes)
    || item.eventTypes.length !== 1
    || item.eventTypes[0] !== GRAPH_DOCS_GENERATION_EVENT_TYPE
  ) {
    throw new Error(`GraphDocsLifecycleObservabilityRegistrationOwnerIntegration eventTypes must target ${GRAPH_DOCS_GENERATION_EVENT_TYPE}`);
  }
  if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
    throw new Error(`GraphDocsLifecycleObservabilityRegistrationOwnerIntegration reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  for (const fieldName of [
    'externalTelemetry',
    'runtimeDispatchEnabled',
    'writesLogs',
    'writesArtifacts',
    'writesDocs',
    'siteAdapterInvocation',
    'downloaderInvocation',
    'sessionMaterialization',
    'graphExecutionEnabled',
  ]) {
    if (item[fieldName] !== false) {
      throw new Error(`GraphDocsLifecycleObservabilityRegistrationOwnerIntegration ${fieldName} must be false`);
    }
  }
  if (item.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerIntegration item redactionRequired must be true');
  }
  assertPlainObject(
    item.sourceRuntimeRegistrationConsumerGuard,
    'GraphDocsLifecycleObservabilityRegistrationOwnerIntegration sourceRuntimeRegistrationConsumerGuard',
  );
  if (
    item.sourceRuntimeRegistrationConsumerGuard.queryName
      !== 'createGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerIntegration source guard queryName is not supported');
  }
  if (
    item.sourceRuntimeRegistrationConsumerGuard.artifactFamily
      !== 'site-capability-graph-docs-lifecycle-observability-runtime-registration-consumer-guard'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerIntegration source guard artifactFamily is not supported');
  }
  if (item.sourceRuntimeRegistrationConsumerGuard.result !== 'blocked') {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerIntegration source guard result must be blocked');
  }
  return true;
}

export function createGraphDocsLifecycleObservabilityRegistrationOwnerIntegration(
  subscriberRegistryOrOptions = {},
  maybeOptions,
) {
  const calledWithRegistry =
    maybeOptions !== undefined
    || typeof subscriberRegistryOrOptions?.registerSubscriber === 'function';
  const options = calledWithRegistry
    ? {
      ...(maybeOptions ?? {}),
      subscriberRegistry: subscriberRegistryOrOptions,
    }
    : subscriberRegistryOrOptions;
  assertGraphDocsLifecycleObservabilityRegistrationOwnerIntegrationOptions(options);
  const subscriberRegistry = options.subscriberRegistry ?? options.registry;
  const registrySubscriber = options.registrySubscriber
    ?? createGraphDocsGenerationLifecycleEventRegistrySubscriber({
      subscriberId: options.subscriberId,
    });
  const runtimeRegistrationConsumerGuard = options.runtimeRegistrationConsumerGuard
    ?? options.sourceRuntimeRegistrationConsumerGuard
    ?? createGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard();
  assertPlainObject(
    subscriberRegistry,
    'GraphDocsLifecycleObservabilityRegistrationOwnerIntegration subscriberRegistry',
  );
  if (typeof subscriberRegistry.registerSubscriber !== 'function') {
    throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerIntegration subscriberRegistry.registerSubscriber is required');
  }
  assertGraphDocsGenerationLifecycleEventRegistrySubscriberDescriptor(registrySubscriber);
  assertGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardCompatibility(
    runtimeRegistrationConsumerGuard,
  );
  const registeredDescriptor = subscriberRegistry.registerSubscriber(registrySubscriber);
  if (registeredDescriptor !== undefined) {
    assertPlainObject(
      registeredDescriptor,
      'GraphDocsLifecycleObservabilityRegistrationOwnerIntegration registeredDescriptor',
    );
    if (typeof registeredDescriptor.subscriber === 'function') {
      throw new Error('GraphDocsLifecycleObservabilityRegistrationOwnerIntegration registeredDescriptor must not include subscriber function');
    }
    assertNoForbiddenGraphFields(
      registeredDescriptor,
      'GraphDocsLifecycleObservabilityRegistrationOwnerIntegration registeredDescriptor',
    );
    assertNoForbiddenPatterns(registeredDescriptor);
  }
  const sourceGuardItem = runtimeRegistrationConsumerGuard.items[0];
  const subscriberSummary =
    createGraphDocsGenerationLifecycleEventRegistrySubscriberSummary(registrySubscriber);
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: runtimeRegistrationConsumerGuard.graphVersion,
    queryName: 'createGraphDocsLifecycleObservabilityRegistrationOwnerIntegration',
    artifactFamily:
      'site-capability-graph-docs-lifecycle-observability-registration-owner-integration',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      registeredSubscriberId: subscriberSummary.subscriberId,
      eventTypes: subscriberSummary.eventTypes,
      registrationOwner: 'Layer',
      registryType: 'in-memory-lifecycle-subscriber-registry',
      redactionRequired: true,
      externalTelemetry: false,
      runtimeDispatchEnabled: false,
      writesLogs: false,
      writesArtifacts: false,
      writesDocs: false,
      siteAdapterInvocation: false,
      downloaderInvocation: false,
      sessionMaterialization: false,
      graphExecutionEnabled: false,
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      sourceRuntimeRegistrationConsumerGuard: {
        queryName: runtimeRegistrationConsumerGuard.queryName,
        artifactFamily: runtimeRegistrationConsumerGuard.artifactFamily,
        graphVersion: runtimeRegistrationConsumerGuard.graphVersion,
        redactionRequired: runtimeRegistrationConsumerGuard.redactionRequired,
        result: sourceGuardItem.result,
        reasonCode: sourceGuardItem.reasonCode,
      },
    }],
  };
  assertGraphDocsLifecycleObservabilityRegistrationOwnerIntegrationCompatibility(result);
  return cloneDescriptor(result);
}

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_DRY_RUN_ADAPTER_FALSE_FLAG_KEYS =
  Object.freeze([
    'externalTelemetry',
    'externalTelemetryEnabled',
    'runtimeDispatchEnabled',
    'runtimeDispatchWriteEnabled',
    'runtimeWriteEnabled',
    'writesLogs',
    'writesArtifacts',
    'writesDocs',
    'docsWriteEnabled',
    'repoWrite',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'artifactWriteEnabled',
    'logWriteEnabled',
    'siteAdapterInvocation',
    'siteAdapterInvocationEnabled',
    'downloaderInvocation',
    'downloaderInvocationEnabled',
    'sessionMaterialization',
    'sessionMaterializationEnabled',
    'sessionViewMaterialized',
    'graphExecution',
    'graphExecutionEnabled',
    'taskRunnerEnabled',
    'runtimePayloadEnabled',
    'rawPayloadEnabled',
    'statusPromotionAllowed',
    'verifiedPromotionAllowed',
  ]);

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_DRY_RUN_ADAPTER_RUNTIME_PRODUCT_KEYS =
  Object.freeze([
    'Authorization',
    'artifactPath',
    'artifactPayload',
    'auditPath',
    'authorizationHeader',
    'browserProfile',
    'callback',
    'cookie',
    'credential',
    'credentials',
    'csrf',
    'dispatchLifecycleEvent',
    'dispatchPayload',
    'downloadPolicy',
    'downloader',
    'eventPath',
    'externalTelemetry',
    'handler',
    'logPath',
    'outputPath',
    'repoArtifactPath',
    'rawPayload',
    'repoPath',
    'runtimeArtifact',
    'runtimeLog',
    'runtimePayload',
    'sessionId',
    'sessionView',
    'siteAdapter',
    'standardTaskList',
    'task',
    'subscriber',
    'subscribers',
    'taskList',
    'taskRunner',
    'telemetryPayload',
    'telemetrySink',
    'token',
    'unredactedPayload',
    'writePath',
    'writesArtifacts',
    'writesDocs',
    'writesLogs',
  ]);

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_DRY_RUN_ADAPTER_RUNTIME_PRODUCT_KEY_SET =
  new Set(
    GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_DRY_RUN_ADAPTER_RUNTIME_PRODUCT_KEYS
      .map((key) => normalizeKey(key)),
  );

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_LAYER_ADAPTER_HANDOFF_GUARD_FALSE_FLAG_KEYS =
  Object.freeze([
    'externalTelemetryEnabled',
    'runtimeDispatchEnabled',
    'runtimeWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'runtimeLogWriteEnabled',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'sessionMaterializationEnabled',
    'statusPromotionAllowed',
  ]);

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_LAYER_ADAPTER_HANDOFF_GUARD_RUNTIME_PRODUCT_KEYS =
  Object.freeze([
    'Authorization',
    'adapter',
    'adapterCallback',
    'adapterEntrypoint',
    'adapterRuntime',
    'artifactPath',
    'artifactPayload',
    'auditPath',
    'authorization',
    'authorizationHeader',
    'browserProfile',
    'callback',
    'consumer',
    'cookie',
    'credential',
    'credentials',
    'csrf',
    'dispatch',
    'dispatchLifecycleEvent',
    'dispatchPayload',
    'downloadPolicy',
    'downloader',
    'eventPath',
    'externalTelemetry',
    'externalTelemetrySink',
    'handler',
    'logPath',
    'outputPath',
    'rawPayload',
    'registry',
    'repoArtifactPath',
    'runtimeArtifact',
    'runtimeLog',
    'runtimePayload',
    'sessionId',
    'sessionView',
    'siteAdapter',
    'standardTaskList',
    'subscriber',
    'subscribers',
    'subscriberCallback',
    'subscriberRegistry',
    'subscriberResults',
    'task',
    'taskList',
    'taskRunner',
    'telemetryPayload',
    'telemetrySink',
    'token',
    'unredactedPayload',
    'writePath',
    'writesArtifacts',
    'writesDocs',
    'writesLogs',
  ]);

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_LAYER_ADAPTER_HANDOFF_GUARD_FALSE_FLAG_KEY_SET =
  new Set(
    GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_LAYER_ADAPTER_HANDOFF_GUARD_FALSE_FLAG_KEYS
      .map((key) => normalizeKey(key)),
  );

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_LAYER_ADAPTER_HANDOFF_GUARD_RUNTIME_PRODUCT_KEY_SET =
  new Set(
    GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_LAYER_ADAPTER_HANDOFF_GUARD_RUNTIME_PRODUCT_KEYS
      .map((key) => normalizeKey(key)),
  );

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LAYER_ADAPTER_COMPATIBILITY_REVIEW_GATE_FALSE_FLAG_KEYS =
  Object.freeze([
    'liveAdapterWiringEnabled',
    'adapterWiringEnabled',
    'runtimeDispatchEnabled',
    'runtimeWriteEnabled',
    'runtimeWritesEnabled',
    'runtimeArtifactWriteEnabled',
    'runtimeLogWriteEnabled',
    'externalTelemetryEnabled',
    'externalTelemetryDispatchEnabled',
    'siteAdapterInvocationEnabled',
    'siteAdapterEnabled',
    'downloaderInvocationEnabled',
    'downloaderEnabled',
    'sessionViewEnabled',
    'sessionMaterializationEnabled',
    'sessionViewMaterialized',
    'statusPromotionAllowed',
    'verifiedPromotionAllowed',
  ]);

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LAYER_ADAPTER_COMPATIBILITY_REVIEW_GATE_RUNTIME_PRODUCT_KEYS =
  Object.freeze([
    ...GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_LAYER_ADAPTER_HANDOFF_GUARD_RUNTIME_PRODUCT_KEYS,
    'runtimeAdapterProduct',
    'runtimeAdapterProducts',
    'runtimeAdapterResult',
    'runtimeAdapterResults',
    'runtimeAdapter',
    'adapterProduct',
    'adapterProducts',
    'subscriberProduct',
    'subscriberProducts',
    'telemetrySinkProduct',
    'telemetrySinkProducts',
  ]);

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LAYER_ADAPTER_COMPATIBILITY_REVIEW_GATE_FALSE_FLAG_KEY_SET =
  new Set(
    GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LAYER_ADAPTER_COMPATIBILITY_REVIEW_GATE_FALSE_FLAG_KEYS
      .map((key) => normalizeKey(key)),
  );

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LAYER_ADAPTER_COMPATIBILITY_REVIEW_GATE_RUNTIME_PRODUCT_KEY_SET =
  new Set(
    GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LAYER_ADAPTER_COMPATIBILITY_REVIEW_GATE_RUNTIME_PRODUCT_KEYS
      .map((key) => normalizeKey(key)),
  );

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_WRITE_INTENT_PREFLIGHT_FALSE_FLAG_KEYS =
  Object.freeze([
    'runtimeWriteEnabled',
    'runtimeLogWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'runtimeDocsWriteEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'externalTelemetryEnabled',
    'externalTelemetryDispatchEnabled',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'downloaderEnabled',
    'sessionMaterializationEnabled',
    'sessionViewMaterialized',
    'statusPromotionAllowed',
  ]);

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_WRITE_INTENT_PREFLIGHT_RUNTIME_PRODUCT_KEYS =
  Object.freeze([
    ...GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LAYER_ADAPTER_COMPATIBILITY_REVIEW_GATE_RUNTIME_PRODUCT_KEYS,
    'artifactWriter',
    'artifactWritePath',
    'docsWriter',
    'docsWritePath',
    'logSink',
    'repoWriter',
    'repoWritePath',
    'SessionView',
    'sessionViewMaterializer',
    'telemetrySink',
    'writeIntent',
    'writeIntentPayload',
    'writePath',
  ]);

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_WRITE_INTENT_PREFLIGHT_FALSE_FLAG_KEY_SET =
  new Set(
    GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_WRITE_INTENT_PREFLIGHT_FALSE_FLAG_KEYS
      .map((key) => normalizeKey(key)),
  );

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_WRITE_INTENT_PREFLIGHT_RUNTIME_PRODUCT_KEY_SET =
  new Set(
    GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_WRITE_INTENT_PREFLIGHT_RUNTIME_PRODUCT_KEYS
      .map((key) => normalizeKey(key)),
  );

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_WRITE_BOUNDARY_GUARD_FALSE_FLAG_KEYS =
  Object.freeze([
    ...GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_WRITE_INTENT_PREFLIGHT_FALSE_FLAG_KEYS,
    'artifactWriteEnabled',
    'docsRuntimeWriteEnabled',
    'externalTelemetryWriteEnabled',
    'liveWriteEnabled',
    'liveDispatchEnabled',
    'liveRouteExecutionEnabled',
    'liveRuntimeDispatchEnabled',
    'liveRuntimeEnabled',
    'logWriteEnabled',
    'repoArtifactWriteEnabled',
    'routeExecutionEnabled',
    'runtimeLogEnabled',
    'runtimePayloadEnabled',
    'sessionViewEnabled',
    'siteAdapterEnabled',
    'statusPromotionEnabled',
    'taskRunnerInvocationEnabled',
    'taskRunnerEnabled',
    'telemetryPayloadEnabled',
    'verifiedPromotionAllowed',
  ]);

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_WRITE_BOUNDARY_GUARD_RUNTIME_PRODUCT_KEYS =
  Object.freeze([
    ...GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_WRITE_INTENT_PREFLIGHT_RUNTIME_PRODUCT_KEYS,
    'artifact',
    'artifactWrite',
    'artifactWritePayload',
    'docsPayload',
    'docsWrite',
    'externalTelemetryPayload',
    'liveDispatch',
    'liveDispatchPayload',
    'liveRouteExecution',
    'logPayload',
    'logWrite',
    'repoPayload',
    'repoWrite',
    'routeExecution',
    'runtimeDispatch',
    'runtimeDispatchPayload',
    'runtimeWriter',
    'siteAdapterPayload',
    'statusPromotion',
    'statusPromotionPayload',
    'taskRunnerPayload',
    'taskRunnerStatusPromotion',
    'telemetryWrite',
  ]);

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_WRITE_BOUNDARY_GUARD_FALSE_FLAG_KEY_SET =
  new Set(
    GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_WRITE_BOUNDARY_GUARD_FALSE_FLAG_KEYS
      .map((key) => normalizeKey(key)),
  );

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_WRITE_BOUNDARY_GUARD_RUNTIME_PRODUCT_KEY_SET =
  new Set(
    GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_WRITE_BOUNDARY_GUARD_RUNTIME_PRODUCT_KEYS
      .map((key) => normalizeKey(key)),
  );

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_ADAPTER_WRITE_BOUNDARY_GUARD_FALSE_FLAG_KEYS =
  Object.freeze([
    ...GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_WRITE_BOUNDARY_GUARD_FALSE_FLAG_KEYS,
    'adapterDispatchEnabled',
    'adapterRuntimeDispatchEnabled',
    'adapterWriteEnabled',
    'graphExecutes',
    'graphExecutionEnabled',
    'liveAdapterDispatchEnabled',
    'liveAdapterEnabled',
    'liveAdapterRuntimeDispatchEnabled',
    'liveAdapterWriteEnabled',
    'routeExecutionEnabled',
    'siteAdapterDispatchEnabled',
    'siteAdapterRuntimeDispatchEnabled',
    'siteAdapterWriteEnabled',
    'telemetryDispatchEnabled',
  ]);

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_ADAPTER_WRITE_BOUNDARY_GUARD_RUNTIME_PRODUCT_KEYS =
  Object.freeze([
    ...GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_WRITE_BOUNDARY_GUARD_RUNTIME_PRODUCT_KEYS,
    'adapter',
    'adapterCallback',
    'adapterDispatch',
    'adapterDispatchPayload',
    'adapterEntrypoint',
    'adapterPayload',
    'adapterRuntime',
    'adapterWrite',
    'adapterWritePayload',
    'downloaderPayload',
    'externalTelemetryDispatch',
    'liveAdapter',
    'liveAdapterDispatch',
    'liveAdapterDispatchPayload',
    'liveAdapterPayload',
    'liveAdapterRuntime',
    'liveAdapterWrite',
    'liveAdapterWritePayload',
    'route',
    'runtimeArtifactWriter',
    'runtimeLogWriter',
    'sessionViewPayload',
    'siteAdapterDispatch',
    'siteAdapterDispatchPayload',
    'siteAdapterRuntime',
    'siteAdapterWrite',
    'siteAdapterWritePayload',
    'taskRunnerPayload',
  ]);

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_ADAPTER_WRITE_BOUNDARY_GUARD_FALSE_FLAG_KEY_SET =
  new Set(
    GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_ADAPTER_WRITE_BOUNDARY_GUARD_FALSE_FLAG_KEYS
      .map((key) => normalizeKey(key)),
  );

const GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_ADAPTER_WRITE_BOUNDARY_GUARD_RUNTIME_PRODUCT_KEY_SET =
  new Set(
    GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_ADAPTER_WRITE_BOUNDARY_GUARD_RUNTIME_PRODUCT_KEYS
      .map((key) => normalizeKey(key)),
  );

function assertNoGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterProducts(
  value,
  label = 'GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => (
      assertNoGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterProducts(
        entry,
        label,
        `${path}[${index}]`,
      )
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (
      GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_DRY_RUN_ADAPTER_FALSE_FLAG_KEYS
        .map((fieldName) => normalizeKey(fieldName))
        .includes(normalizedKey)
    ) {
      if (entry !== false && entry !== undefined) {
        throw new Error(`${label} ${key} must remain false`);
      }
    } else if (
      GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_DRY_RUN_ADAPTER_RUNTIME_PRODUCT_KEY_SET
        .has(normalizedKey)
    ) {
      throw new Error(`${label} dry-run rejected runtime field: ${path}.${key}`);
    }
    assertNoGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterProducts(
      entry,
      label,
      `${path}.${key}`,
    );
  }
  return true;
}

function assertNoGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardProducts(
  value,
  label = 'GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => (
      assertNoGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardProducts(
        entry,
        label,
        `${path}[${index}]`,
      )
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (
      GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_LAYER_ADAPTER_HANDOFF_GUARD_FALSE_FLAG_KEY_SET
        .has(normalizedKey)
    ) {
      if (entry !== false && entry !== undefined) {
        throw new Error(`${label} ${key} must remain false`);
      }
    } else if (
      GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_LAYER_ADAPTER_HANDOFF_GUARD_RUNTIME_PRODUCT_KEY_SET
        .has(normalizedKey)
    ) {
      throw new Error(`${label} descriptor-only rejected runtime field: ${path}.${key}`);
    }
    assertNoGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardProducts(
      entry,
      label,
      `${path}.${key}`,
    );
  }
  return true;
}

function assertNoGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateProducts(
  value,
  label = 'GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => (
      assertNoGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateProducts(
        entry,
        label,
        `${path}[${index}]`,
      )
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (
      GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LAYER_ADAPTER_COMPATIBILITY_REVIEW_GATE_FALSE_FLAG_KEY_SET
        .has(normalizedKey)
    ) {
      if (entry !== false && entry !== undefined) {
        throw new Error(`${label} ${key} must remain false`);
      }
    } else if (
      GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LAYER_ADAPTER_COMPATIBILITY_REVIEW_GATE_RUNTIME_PRODUCT_KEY_SET
        .has(normalizedKey)
    ) {
      throw new Error(`${label} descriptor-only rejected runtime field: ${path}.${key}`);
    }
    assertNoGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateProducts(
      entry,
      label,
      `${path}.${key}`,
    );
  }
  return true;
}

function assertNoGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightProducts(
  value,
  label = 'GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => (
      assertNoGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightProducts(
        entry,
        label,
        `${path}[${index}]`,
      )
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (
      GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_WRITE_INTENT_PREFLIGHT_FALSE_FLAG_KEY_SET
        .has(normalizedKey)
    ) {
      if (entry !== false && entry !== undefined) {
        throw new Error(`${label} ${key} must remain false`);
      }
    } else if (
      GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_WRITE_INTENT_PREFLIGHT_RUNTIME_PRODUCT_KEY_SET
        .has(normalizedKey)
    ) {
      throw new Error(`${label} descriptor-only rejected runtime field: ${path}.${key}`);
    }
    assertNoGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightProducts(
      entry,
      label,
      `${path}.${key}`,
    );
  }
  return true;
}

function assertNoGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardProducts(
  value,
  label = 'GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => (
      assertNoGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardProducts(
        entry,
        label,
        `${path}[${index}]`,
      )
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (
      GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_WRITE_BOUNDARY_GUARD_FALSE_FLAG_KEY_SET
        .has(normalizedKey)
    ) {
      if (entry !== false && entry !== undefined) {
        throw new Error(`${label} ${key} must remain false`);
      }
    } else if (
      GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_WRITE_BOUNDARY_GUARD_RUNTIME_PRODUCT_KEY_SET
        .has(normalizedKey)
    ) {
      throw new Error(`${label} descriptor-only rejected runtime field: ${path}.${key}`);
    }
    assertNoGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardProducts(
      entry,
      label,
      `${path}.${key}`,
    );
  }
  return true;
}

function assertNoGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardProducts(
  value,
  label = 'GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => (
      assertNoGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardProducts(
        entry,
        label,
        `${path}[${index}]`,
      )
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (
      GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_ADAPTER_WRITE_BOUNDARY_GUARD_FALSE_FLAG_KEY_SET
        .has(normalizedKey)
    ) {
      if (entry !== false && entry !== undefined) {
        throw new Error(`${label} ${key} must remain false`);
      }
    } else if (
      GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_ADAPTER_WRITE_BOUNDARY_GUARD_RUNTIME_PRODUCT_KEY_SET
        .has(normalizedKey)
    ) {
      throw new Error(`${label} descriptor-only rejected runtime field: ${path}.${key}`);
    }
    assertNoGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardProducts(
      entry,
      label,
      `${path}.${key}`,
    );
  }
  return true;
}

function summarizeGraphDocsLifecycleObservabilityRegistrationOwnerIntegrationForDispatchDryRun(
  sourceIntegration,
) {
  assertGraphDocsLifecycleObservabilityRegistrationOwnerIntegrationCompatibility(sourceIntegration);
  const item = sourceIntegration.items[0];
  return {
    queryName: sourceIntegration.queryName,
    artifactFamily: sourceIntegration.artifactFamily,
    graphVersion: sourceIntegration.graphVersion,
    redactionRequired: sourceIntegration.redactionRequired,
    registeredSubscriberId: item.registeredSubscriberId,
    eventTypes: [...item.eventTypes],
    registrationOwner: item.registrationOwner,
    registryType: item.registryType,
    reasonCode: item.reasonCode,
    externalTelemetry: item.externalTelemetry,
    runtimeDispatchEnabled: item.runtimeDispatchEnabled,
    writesLogs: item.writesLogs,
    writesArtifacts: item.writesArtifacts,
    writesDocs: item.writesDocs,
    siteAdapterInvocation: item.siteAdapterInvocation,
    downloaderInvocation: item.downloaderInvocation,
    sessionMaterialization: item.sessionMaterialization,
    graphExecutionEnabled: item.graphExecutionEnabled,
  };
}

function summarizeGraphDocsLifecycleDispatchDryRunEvent(event) {
  assertGraphDocsGenerationLifecycleEventConsumerCompatibility(event);
  const normalized = normalizeLifecycleEvent(event, {
    eventType: GRAPH_DOCS_GENERATION_EVENT_TYPE,
    taskType: 'site-capability-graph-docs',
  });
  return {
    schemaVersion: normalized.schemaVersion,
    eventType: normalized.eventType,
    graphVersion: normalized.details.graphVersion,
    reasonCode: normalized.reasonCode,
    redactionRequired: normalized.details.redactionRequired,
    queryName: normalized.details.queryName,
    artifactFamily: normalized.details.artifactFamily,
    details: {
      graphVersion: normalized.details.graphVersion,
      queryName: normalized.details.queryName,
      artifactFamily: normalized.details.artifactFamily,
      redactionRequired: normalized.details.redactionRequired,
    },
  };
}

/** @param {Record<string, any>} [result] */
function summarizeGraphDocsLifecycleDispatchDryRunSubscriberResult(result = {}) {
  assertPlainObject(
    result,
    'GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapter subscriberResult',
  );
  assertNoForbiddenGraphFields(
    result,
    'GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapter subscriberResult',
  );
  assertNoForbiddenPatterns(result);
  return {
    accepted: result.accepted === true,
    subscriberId: normalizeText(result.subscriberId),
    eventType: normalizeText(result.eventType),
    graphVersion: normalizeText(result.graphVersion),
    reasonCode: normalizeText(result.reasonCode),
    redactionRequired: result.redactionRequired === true,
  };
}

export function assertGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultCompatibility(
  result = {},
) {
  assertPlainObject(
    result,
    'GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult',
  );
  assertNoGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterProducts(result);
  assertNoForbiddenGraphFields(
    result,
    'GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult',
  );
  assertNoForbiddenPatterns(result);
  assertNoGraphMetricFields(
    result,
    'GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult',
  );
  assertGraphQueryResultCompatible(result);
  if (result.queryName !== 'createGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult queryName must be createGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult');
  }
  if (
    result.artifactFamily
      !== 'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-dry-run-adapter-result'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult artifactFamily is not supported');
  }
  if (result.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult redactionRequired must be true');
  }
  if (!Array.isArray(result.items) || result.items.length !== 1) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult requires exactly one item');
  }
  const item = result.items[0];
  assertPlainObject(
    item,
    'GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult.items[0]',
  );
  if (item.schemaVersion !== 1) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult item schemaVersion is not compatible');
  }
  if (item.dryRun !== true || item.descriptorOnly !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult item must be descriptor-only dry-run');
  }
  if (item.registrationOwner !== 'Layer') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult registrationOwner must be Layer');
  }
  if (item.registryType !== 'in-memory-lifecycle-subscriber-registry') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult registryType is not supported');
  }
  if (item.eventType !== GRAPH_DOCS_GENERATION_EVENT_TYPE) {
    throw new Error(`GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult eventType must be ${GRAPH_DOCS_GENERATION_EVENT_TYPE}`);
  }
  if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
    throw new Error(`GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  for (
    const fieldName
    of GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_DRY_RUN_ADAPTER_FALSE_FLAG_KEYS
  ) {
    if (item[fieldName] !== false) {
      throw new Error(`GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult ${fieldName} must be false`);
    }
  }
  assertPlainObject(
    item.sourceRegistrationOwnerIntegration,
    'GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult sourceRegistrationOwnerIntegration',
  );
  if (
    item.sourceRegistrationOwnerIntegration.queryName
      !== 'createGraphDocsLifecycleObservabilityRegistrationOwnerIntegration'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult source integration queryName is not supported');
  }
  assertPlainObject(
    item.lifecycleEvent,
    'GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult lifecycleEvent',
  );
  if (!Array.isArray(item.subscriberResultSummaries)) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult subscriberResultSummaries must be an array');
  }
  if (item.subscriberResultCount !== item.subscriberResultSummaries.length) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult subscriberResultCount must match summaries');
  }
  return true;
}

export async function createGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult(
  options = {},
) {
  assertPlainObject(
    options,
    'GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultOptions',
  );
  const {
    subscriberRegistry,
    registry = subscriberRegistry,
    registrationOwnerIntegration,
    sourceRegistrationOwnerIntegration = registrationOwnerIntegration,
    lifecycleEvent,
    event = lifecycleEvent,
    summary,
    traceId,
    correlationId,
    taskId,
    siteKey,
    capabilityId,
    capabilityKey,
    routeId,
    adapterVersion,
    createdAt,
    details,
    ...guardedOptions
  } = options;
  assertNoGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterProducts(
    guardedOptions,
    'GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultOptions',
  );
  assertNoForbiddenGraphFields(
    guardedOptions,
    'GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultOptions',
  );
  assertNoForbiddenPatterns(guardedOptions);
  assertNoGraphMetricFields(
    guardedOptions,
    'GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultOptions',
  );
  for (
    const fieldName
    of GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_DRY_RUN_ADAPTER_FALSE_FLAG_KEYS
  ) {
    if (options[fieldName] !== undefined && options[fieldName] !== false) {
      throw new Error(`GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult ${fieldName} must remain false`);
    }
  }

  const dispatchRegistry = registry ?? createLifecycleEventSubscriberRegistry();
  assertPlainObject(
    dispatchRegistry,
    'GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult subscriberRegistry',
  );
  if (typeof dispatchRegistry.dispatch !== 'function') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult subscriberRegistry.dispatch is required');
  }

  const sourceIntegration = sourceRegistrationOwnerIntegration
    ?? createGraphDocsLifecycleObservabilityRegistrationOwnerIntegration({
      subscriberRegistry: dispatchRegistry,
    });
  assertGraphDocsLifecycleObservabilityRegistrationOwnerIntegrationCompatibility(
    sourceIntegration,
  );

  const normalizedEvent = event === undefined
    ? createGraphDocsGenerationLifecycleEvent({
      summary,
      traceId,
      correlationId,
      taskId,
      siteKey,
      capabilityId,
      capabilityKey,
      routeId,
      adapterVersion,
      createdAt,
      details,
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      validationResult: 'blocked',
      redactionResult: 'blocked',
    })
    : normalizeLifecycleEvent(event, {
      eventType: GRAPH_DOCS_GENERATION_EVENT_TYPE,
      taskType: 'site-capability-graph-docs',
    });
  assertGraphDocsGenerationLifecycleEventConsumerCompatibility(normalizedEvent);

  const dispatchResult = await dispatchRegistry.dispatch(normalizedEvent);
  assertPlainObject(
    dispatchResult,
    'GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult dispatchResult',
  );
  assertNoForbiddenGraphFields(
    dispatchResult,
    'GraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult dispatchResult',
  );
  assertNoForbiddenPatterns(dispatchResult);
  const subscriberResultSummaries = Array.isArray(dispatchResult.subscriberResults)
    ? dispatchResult.subscriberResults
      .map((subscriberResult) => (
        summarizeGraphDocsLifecycleDispatchDryRunSubscriberResult(subscriberResult)
      ))
    : [];
  const eventSummary = summarizeGraphDocsLifecycleDispatchDryRunEvent(
    dispatchResult.event ?? normalizedEvent,
  );
  const sourceIntegrationSummary =
    summarizeGraphDocsLifecycleObservabilityRegistrationOwnerIntegrationForDispatchDryRun(
      sourceIntegration,
    );
  const disabledFlags = Object.fromEntries(
    GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_DRY_RUN_ADAPTER_FALSE_FLAG_KEYS
      .map((fieldName) => [fieldName, false]),
  );
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceIntegration.graphVersion,
    queryName: 'createGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult',
    artifactFamily:
      'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-dry-run-adapter-result',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      dryRun: true,
      descriptorOnly: true,
      registrationOwner: 'Layer',
      registryType: 'in-memory-lifecycle-subscriber-registry',
      eventType: eventSummary.eventType,
      lifecycleEvent: eventSummary,
      sourceRegistrationOwnerIntegration: sourceIntegrationSummary,
      subscriberResultCount: subscriberResultSummaries.length,
      subscriberResultSummaries,
      result: 'blocked',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph docs lifecycle observability runtime dispatch dry-run adapter records an in-memory dispatch summary without telemetry or writes',
      ),
      ...disabledFlags,
    }],
  };
  assertGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultCompatibility(result);
  return cloneDescriptor(result);
}

function summarizeGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultForLayerAdapterHandoffGuard(
  sourceResult,
) {
  assertGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultCompatibility(sourceResult);
  const item = sourceResult.items[0];
  return {
    queryName: sourceResult.queryName,
    artifactFamily: sourceResult.artifactFamily,
    graphVersion: sourceResult.graphVersion,
    redactionRequired: sourceResult.redactionRequired,
    schemaVersion: sourceResult.schemaVersion,
    dryRun: item.dryRun,
    descriptorOnly: item.descriptorOnly,
    registrationOwner: item.registrationOwner,
    eventType: item.eventType,
    result: item.result,
    reasonCode: item.reasonCode,
    subscriberResultCount: item.subscriberResultCount,
    sourceRegistrationOwnerIntegration: {
      queryName: item.sourceRegistrationOwnerIntegration.queryName,
      artifactFamily: item.sourceRegistrationOwnerIntegration.artifactFamily,
      graphVersion: item.sourceRegistrationOwnerIntegration.graphVersion,
      redactionRequired: item.sourceRegistrationOwnerIntegration.redactionRequired,
      registrationOwner: item.sourceRegistrationOwnerIntegration.registrationOwner,
      reasonCode: item.sourceRegistrationOwnerIntegration.reasonCode,
    },
  };
}

export function assertGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardCompatibility(
  guard = {},
) {
  assertPlainObject(
    guard,
    'GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard',
  );
  assertNoGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardProducts(guard);
  assertNoForbiddenGraphFields(
    guard,
    'GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard',
  );
  assertNoForbiddenPatterns(guard);
  assertNoGraphMetricFields(
    guard,
    'GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard',
  );
  assertGraphQueryResultCompatible(guard);
  if (guard.queryName !== 'createGraphDocsLifecycleObservabilityLayerAdapterHandoffGuard') {
    throw new Error('GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard queryName must be createGraphDocsLifecycleObservabilityLayerAdapterHandoffGuard');
  }
  if (
    guard.artifactFamily
      !== 'site-capability-graph-docs-lifecycle-observability-layer-adapter-handoff-guard'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard artifactFamily is not supported');
  }
  if (guard.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard redactionRequired must be true');
  }
  if (!Array.isArray(guard.items) || guard.items.length !== 1) {
    throw new Error('GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard requires exactly one item');
  }
  const item = guard.items[0];
  assertPlainObject(
    item,
    'GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard.items[0]',
  );
  if (item.schemaVersion !== 1) {
    throw new Error('GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard item schemaVersion is not compatible');
  }
  if (item.handoffMode !== 'descriptor-only') {
    throw new Error('GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard handoffMode must be descriptor-only');
  }
  if (item.result !== 'blocked') {
    throw new Error('GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard result must be blocked');
  }
  if (item.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard item redactionRequired must be true');
  }
  if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
    throw new Error(`GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  assertPlainObject(
    item.reason,
    'GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard reason',
  );
  if (item.reason.code !== item.reasonCode) {
    throw new Error('GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard reason code must match reasonCode');
  }
  for (
    const fieldName
    of GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_LAYER_ADAPTER_HANDOFF_GUARD_FALSE_FLAG_KEYS
  ) {
    if (item[fieldName] !== false) {
      throw new Error(`GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard ${fieldName} must be false`);
    }
  }
  assertPlainObject(
    item.sourceRuntimeDispatchDryRunAdapterResult,
    'GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard sourceRuntimeDispatchDryRunAdapterResult',
  );
  if (
    item.sourceRuntimeDispatchDryRunAdapterResult.queryName
      !== 'createGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard source must be runtime dispatch dry-run adapter result');
  }
  if (
    item.sourceRuntimeDispatchDryRunAdapterResult.artifactFamily
      !== 'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-dry-run-adapter-result'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard source artifactFamily is not supported');
  }
  if (item.sourceRuntimeDispatchDryRunAdapterResult.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard source redactionRequired must be true');
  }
  if (item.sourceRuntimeDispatchDryRunAdapterResult.dryRun !== true) {
    throw new Error('GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard source dryRun must be true');
  }
  if (item.sourceRuntimeDispatchDryRunAdapterResult.descriptorOnly !== true) {
    throw new Error('GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard source descriptorOnly must be true');
  }
  if (item.sourceRuntimeDispatchDryRunAdapterResult.result !== 'blocked') {
    throw new Error('GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard source result must be blocked');
  }
  if (
    item.sourceRuntimeDispatchDryRunAdapterResult.reasonCode
      !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE
  ) {
    throw new Error(`GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard source reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  assertPlainObject(
    item.requiredGuards,
    'GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard requiredGuards',
  );
  if (
    item.requiredGuards.runtimeDispatchDryRunAdapterResult
      !== 'assertGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultCompatibility'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard runtimeDispatchDryRunAdapterResult guard is required');
  }
  if (
    item.requiredGuards.layerAdapterHandoffGuard
      !== 'assertGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardCompatibility'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard layerAdapterHandoffGuard guard is required');
  }
  if (!Array.isArray(item.forbiddenRuntimeFields) || item.forbiddenRuntimeFields.length === 0) {
    throw new Error('GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard forbiddenRuntimeFields are required');
  }
  return true;
}

export function createGraphDocsLifecycleObservabilityLayerAdapterHandoffGuard(
  sourceRuntimeDispatchDryRunAdapterResultOrOptions = {},
  maybeOptions,
) {
  const calledWithSource =
    maybeOptions !== undefined
    || sourceRuntimeDispatchDryRunAdapterResultOrOptions?.queryName
      === 'createGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult';
  const options = calledWithSource
    ? {
      ...(maybeOptions ?? {}),
      sourceRuntimeDispatchDryRunAdapterResult:
        sourceRuntimeDispatchDryRunAdapterResultOrOptions,
      runtimeDispatchDryRunAdapterResult:
        sourceRuntimeDispatchDryRunAdapterResultOrOptions,
    }
    : sourceRuntimeDispatchDryRunAdapterResultOrOptions;
  assertPlainObject(
    options,
    'GraphDocsLifecycleObservabilityLayerAdapterHandoffGuardOptions',
  );
  const {
    runtimeDispatchDryRunAdapterResult,
    sourceRuntimeDispatchDryRunAdapterResult = runtimeDispatchDryRunAdapterResult,
    graphVersion,
    handoffName = 'site-capability-graph-docs-lifecycle-observability-layer-adapter-handoff-guard',
    ...guardedOptions
  } = options;
  assertNoGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardProducts(
    guardedOptions,
    'GraphDocsLifecycleObservabilityLayerAdapterHandoffGuardOptions',
  );
  assertNoForbiddenGraphFields(
    guardedOptions,
    'GraphDocsLifecycleObservabilityLayerAdapterHandoffGuardOptions',
  );
  assertNoForbiddenPatterns(guardedOptions);
  assertNoGraphMetricFields(
    guardedOptions,
    'GraphDocsLifecycleObservabilityLayerAdapterHandoffGuardOptions',
  );
  for (
    const fieldName
    of GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_LAYER_ADAPTER_HANDOFF_GUARD_FALSE_FLAG_KEYS
  ) {
    if (options[fieldName] !== undefined && options[fieldName] !== false) {
      throw new Error(`GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard ${fieldName} must remain false`);
    }
  }

  const sourceAliasEntries = [
    ['runtimeDispatchDryRunAdapterResult', runtimeDispatchDryRunAdapterResult],
    ['sourceRuntimeDispatchDryRunAdapterResult', sourceRuntimeDispatchDryRunAdapterResult],
  ].filter(([, sourceAlias]) => sourceAlias !== undefined);
  for (const [, sourceAlias] of sourceAliasEntries) {
    assertGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultCompatibility(
      sourceAlias,
    );
  }
  const firstSourceAlias = sourceAliasEntries[0]?.[1];
  for (const [aliasName, sourceAlias] of sourceAliasEntries.slice(1)) {
    if (sourceAlias !== firstSourceAlias) {
      throw new Error(
        'GraphDocsLifecycleObservabilityLayerAdapterHandoffGuardOptions '
          + `must not provide multiple distinct source aliases: ${aliasName}`,
      );
    }
  }

  const sourceSummary =
    summarizeGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultForLayerAdapterHandoffGuard(
      firstSourceAlias,
    );
  const disabledFlags = Object.fromEntries(
    GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_LAYER_ADAPTER_HANDOFF_GUARD_FALSE_FLAG_KEYS
      .map((fieldName) => [fieldName, false]),
  );
  const guard = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: assertRequiredText(
      graphVersion ?? sourceSummary.graphVersion,
      'graphVersion',
      'GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard',
    ),
    queryName: 'createGraphDocsLifecycleObservabilityLayerAdapterHandoffGuard',
    artifactFamily:
      'site-capability-graph-docs-lifecycle-observability-layer-adapter-handoff-guard',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      handoffName: assertRequiredText(
        handoffName,
        'handoffName',
        'GraphDocsLifecycleObservabilityLayerAdapterHandoffGuard',
      ),
      handoffMode: 'descriptor-only',
      result: 'blocked',
      redactionRequired: true,
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph docs lifecycle observability Layer adapter handoff remains descriptor-only until live adapter wiring is explicitly enabled',
      ),
      sourceRuntimeDispatchDryRunAdapterResult: sourceSummary,
      requiredGuards: {
        runtimeDispatchDryRunAdapterResult:
          'assertGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultCompatibility',
        layerAdapterHandoffGuard:
          'assertGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardCompatibility',
        redactionGuard: 'SecurityGuard/Redaction before any future Layer adapter handoff',
      },
      forbiddenRuntimeFields: [
        'adapter',
        'callback',
        'subscriber',
        'telemetrySink',
        'runtimePayload',
        'siteAdapter',
        'downloader',
        'sessionView',
        'artifactPath',
        'writePath',
      ],
      ...disabledFlags,
    }],
  };
  assertGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardCompatibility(guard);
  return cloneDescriptor(guard);
}

function summarizeGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardForRuntimeDispatchLayerAdapterCompatibilityReviewGate(
  sourceGuard,
) {
  assertGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardCompatibility(sourceGuard);
  const item = sourceGuard.items[0];
  return {
    queryName: sourceGuard.queryName,
    artifactFamily: sourceGuard.artifactFamily,
    graphVersion: sourceGuard.graphVersion,
    redactionRequired: sourceGuard.redactionRequired,
    schemaVersion: sourceGuard.schemaVersion,
    handoffMode: item.handoffMode,
    result: item.result,
    reasonCode: item.reasonCode,
    sourceRuntimeDispatchDryRunAdapterResult: {
      queryName: item.sourceRuntimeDispatchDryRunAdapterResult.queryName,
      artifactFamily: item.sourceRuntimeDispatchDryRunAdapterResult.artifactFamily,
      graphVersion: item.sourceRuntimeDispatchDryRunAdapterResult.graphVersion,
      redactionRequired: item.sourceRuntimeDispatchDryRunAdapterResult.redactionRequired,
      dryRun: item.sourceRuntimeDispatchDryRunAdapterResult.dryRun,
      descriptorOnly: item.sourceRuntimeDispatchDryRunAdapterResult.descriptorOnly,
      result: item.sourceRuntimeDispatchDryRunAdapterResult.result,
      reasonCode: item.sourceRuntimeDispatchDryRunAdapterResult.reasonCode,
    },
  };
}

export function assertGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateCompatibility(
  gate = {},
) {
  assertPlainObject(
    gate,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate',
  );
  assertNoGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateProducts(gate);
  assertNoForbiddenGraphFields(
    gate,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate',
  );
  assertNoForbiddenPatterns(gate);
  assertNoGraphMetricFields(
    gate,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate',
  );
  assertGraphQueryResultCompatible(gate);
  if (
    gate.queryName
      !== 'createGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate queryName must be createGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate');
  }
  if (
    gate.artifactFamily
      !== 'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-layer-adapter-compatibility-review-gate'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate artifactFamily is not supported');
  }
  if (gate.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate redactionRequired must be true');
  }
  if (!Array.isArray(gate.items) || gate.items.length !== 1) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate requires exactly one item');
  }
  const item = gate.items[0];
  assertPlainObject(
    item,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate.items[0]',
  );
  if (item.schemaVersion !== 1) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate item schemaVersion is not compatible');
  }
  if (item.reviewMode !== 'descriptor-only') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate reviewMode must be descriptor-only');
  }
  if (item.result !== 'blocked') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate result must be blocked');
  }
  if (item.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate item redactionRequired must be true');
  }
  if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
    throw new Error(`GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  assertPlainObject(
    item.reason,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate reason',
  );
  if (item.reason.code !== item.reasonCode) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate reason code must match reasonCode');
  }
  for (
    const fieldName
    of GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LAYER_ADAPTER_COMPATIBILITY_REVIEW_GATE_FALSE_FLAG_KEYS
  ) {
    if (item[fieldName] !== false) {
      throw new Error(`GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate ${fieldName} must be false`);
    }
  }
  assertPlainObject(
    item.sourceLayerAdapterHandoffGuard,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate sourceLayerAdapterHandoffGuard',
  );
  if (
    item.sourceLayerAdapterHandoffGuard.queryName
      !== 'createGraphDocsLifecycleObservabilityLayerAdapterHandoffGuard'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate source must be Layer adapter handoff guard');
  }
  if (
    item.sourceLayerAdapterHandoffGuard.artifactFamily
      !== 'site-capability-graph-docs-lifecycle-observability-layer-adapter-handoff-guard'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate source artifactFamily is not supported');
  }
  if (item.sourceLayerAdapterHandoffGuard.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate source redactionRequired must be true');
  }
  if (item.sourceLayerAdapterHandoffGuard.handoffMode !== 'descriptor-only') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate source handoffMode must be descriptor-only');
  }
  if (item.sourceLayerAdapterHandoffGuard.result !== 'blocked') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate source result must be blocked');
  }
  if (
    item.sourceLayerAdapterHandoffGuard.reasonCode
      !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE
  ) {
    throw new Error(`GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate source reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  assertPlainObject(
    item.requiredGuards,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate requiredGuards',
  );
  if (
    item.requiredGuards.layerAdapterHandoffGuard
      !== 'assertGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardCompatibility'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate layerAdapterHandoffGuard guard is required');
  }
  if (
    item.requiredGuards.runtimeDispatchLayerAdapterCompatibilityReviewGate
      !== 'assertGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateCompatibility'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate compatibility review gate guard is required');
  }
  if (!Array.isArray(item.forbiddenRuntimeFields) || item.forbiddenRuntimeFields.length === 0) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate forbiddenRuntimeFields are required');
  }
  return true;
}

export function createGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate(
  layerAdapterHandoffGuardOrOptions = {},
  maybeOptions,
) {
  const calledWithSource =
    maybeOptions !== undefined
    || layerAdapterHandoffGuardOrOptions?.queryName
      === 'createGraphDocsLifecycleObservabilityLayerAdapterHandoffGuard';
  const options = calledWithSource
    ? {
      ...(maybeOptions ?? {}),
      layerAdapterHandoffGuard: layerAdapterHandoffGuardOrOptions,
      sourceLayerAdapterHandoffGuard: layerAdapterHandoffGuardOrOptions,
      handoffGuard: layerAdapterHandoffGuardOrOptions,
    }
    : layerAdapterHandoffGuardOrOptions;
  assertPlainObject(
    options,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateOptions',
  );
  const {
    layerAdapterHandoffGuard,
    sourceLayerAdapterHandoffGuard,
    handoffGuard,
    graphVersion,
    reviewGateName =
      'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-layer-adapter-compatibility-review-gate',
    ...guardedOptions
  } = options;
  assertNoGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateProducts(
    guardedOptions,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateOptions',
  );
  assertNoForbiddenGraphFields(
    guardedOptions,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateOptions',
  );
  assertNoForbiddenPatterns(guardedOptions);
  assertNoGraphMetricFields(
    guardedOptions,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateOptions',
  );
  for (
    const fieldName
    of GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LAYER_ADAPTER_COMPATIBILITY_REVIEW_GATE_FALSE_FLAG_KEYS
  ) {
    if (options[fieldName] !== undefined && options[fieldName] !== false) {
      throw new Error(`GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate ${fieldName} must remain false`);
    }
  }

  const sourceAliasEntries = [
    ['layerAdapterHandoffGuard', layerAdapterHandoffGuard],
    ['sourceLayerAdapterHandoffGuard', sourceLayerAdapterHandoffGuard],
    ['handoffGuard', handoffGuard],
  ].filter(([, sourceAlias]) => sourceAlias !== undefined);
  if (sourceAliasEntries.length === 0) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateOptions requires a layerAdapterHandoffGuard source');
  }
  for (const [, sourceAlias] of sourceAliasEntries) {
    assertGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardCompatibility(
      sourceAlias,
    );
  }
  const firstSourceAlias = sourceAliasEntries[0][1];
  for (const [aliasName, sourceAlias] of sourceAliasEntries.slice(1)) {
    if (sourceAlias !== firstSourceAlias) {
      throw new Error(
        'GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateOptions '
          + `must not provide multiple distinct source aliases: ${aliasName}`,
      );
    }
  }

  const sourceSummary =
    summarizeGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardForRuntimeDispatchLayerAdapterCompatibilityReviewGate(
      firstSourceAlias,
    );
  const disabledFlags = Object.fromEntries(
    GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LAYER_ADAPTER_COMPATIBILITY_REVIEW_GATE_FALSE_FLAG_KEYS
      .map((fieldName) => [fieldName, false]),
  );
  const gate = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: assertRequiredText(
      graphVersion ?? sourceSummary.graphVersion,
      'graphVersion',
      'GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate',
    ),
    queryName:
      'createGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate',
    artifactFamily:
      'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-layer-adapter-compatibility-review-gate',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      reviewGateName: assertRequiredText(
        reviewGateName,
        'reviewGateName',
        'GraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate',
      ),
      reviewMode: 'descriptor-only',
      result: 'blocked',
      redactionRequired: true,
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph docs lifecycle observability runtime dispatch Layer adapter compatibility review remains descriptor-only until live adapter wiring is explicitly enabled',
      ),
      sourceLayerAdapterHandoffGuard: sourceSummary,
      requiredGuards: {
        layerAdapterHandoffGuard:
          'assertGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardCompatibility',
        runtimeDispatchLayerAdapterCompatibilityReviewGate:
          'assertGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateCompatibility',
        redactionGuard: 'SecurityGuard/Redaction before any future runtime dispatch Layer adapter compatibility review',
      },
      forbiddenRuntimeFields: [
        'runtimeAdapterProducts',
        'callback',
        'subscriber',
        'telemetrySink',
        'runtimePayload',
        'siteAdapter',
        'downloader',
        'sessionView',
        'artifactPath',
        'writePath',
        'logPath',
      ],
      ...disabledFlags,
    }],
  };
  assertGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateCompatibility(
    gate,
  );
  return cloneDescriptor(gate);
}

function summarizeGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateForWriteIntentPreflight(
  sourceGate,
) {
  assertGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateCompatibility(
    sourceGate,
  );
  const item = sourceGate.items[0];
  return {
    queryName: sourceGate.queryName,
    artifactFamily: sourceGate.artifactFamily,
    graphVersion: sourceGate.graphVersion,
    redactionRequired: sourceGate.redactionRequired,
    schemaVersion: sourceGate.schemaVersion,
    reviewGateName: item.reviewGateName,
    reviewMode: item.reviewMode,
    result: item.result,
    reasonCode: item.reasonCode,
    sourceLayerAdapterHandoffGuard: cloneDescriptor(item.sourceLayerAdapterHandoffGuard),
  };
}

export function assertGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightCompatibility(
  preflight = {},
) {
  assertPlainObject(
    preflight,
    'GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight',
  );
  assertNoGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightProducts(preflight);
  assertNoForbiddenGraphFields(
    preflight,
    'GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight',
  );
  assertNoForbiddenPatterns(preflight);
  assertNoGraphMetricFields(
    preflight,
    'GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight',
  );
  assertGraphQueryResultCompatible(preflight);
  if (
    preflight.queryName
      !== 'createGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight queryName must be createGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight');
  }
  if (
    preflight.artifactFamily
      !== 'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-write-intent-preflight'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight artifactFamily is not supported');
  }
  if (preflight.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight redactionRequired must be true');
  }
  if (!Array.isArray(preflight.items) || preflight.items.length !== 1) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight requires exactly one item');
  }
  const item = preflight.items[0];
  assertPlainObject(
    item,
    'GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight.items[0]',
  );
  if (item.schemaVersion !== 1) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight item schemaVersion is not compatible');
  }
  if (item.preflightMode !== 'descriptor-only') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight preflightMode must be descriptor-only');
  }
  if (item.result !== 'blocked') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight result must be blocked');
  }
  if (item.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight item redactionRequired must be true');
  }
  if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
    throw new Error(`GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  assertPlainObject(
    item.reason,
    'GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight reason',
  );
  if (item.reason.code !== item.reasonCode) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight reason code must match reasonCode');
  }
  for (
    const fieldName
    of GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_WRITE_INTENT_PREFLIGHT_FALSE_FLAG_KEYS
  ) {
    if (item[fieldName] !== false) {
      throw new Error(`GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight ${fieldName} must be false`);
    }
  }
  assertPlainObject(
    item.sourceCompatibilityReviewGate,
    'GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight sourceCompatibilityReviewGate',
  );
  if (
    item.sourceCompatibilityReviewGate.queryName
      !== 'createGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight source must be runtime dispatch Layer adapter compatibility review gate');
  }
  if (
    item.sourceCompatibilityReviewGate.artifactFamily
      !== 'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-layer-adapter-compatibility-review-gate'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight source artifactFamily is not supported');
  }
  if (item.sourceCompatibilityReviewGate.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight source redactionRequired must be true');
  }
  if (item.sourceCompatibilityReviewGate.reviewMode !== 'descriptor-only') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight source reviewMode must be descriptor-only');
  }
  if (item.sourceCompatibilityReviewGate.result !== 'blocked') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight source result must be blocked');
  }
  if (
    item.sourceCompatibilityReviewGate.reasonCode
      !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE
  ) {
    throw new Error(`GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight source reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  assertPlainObject(
    item.requiredGuards,
    'GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight requiredGuards',
  );
  if (
    item.requiredGuards.runtimeDispatchLayerAdapterCompatibilityReviewGate
      !== 'assertGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateCompatibility'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight compatibility review gate guard is required');
  }
  if (
    item.requiredGuards.runtimeDispatchWriteIntentPreflight
      !== 'assertGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightCompatibility'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight write-intent preflight guard is required');
  }
  if (!Array.isArray(item.forbiddenRuntimeFields) || item.forbiddenRuntimeFields.length === 0) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight forbiddenRuntimeFields are required');
  }
  return true;
}

export function createGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight(
  compatibilityReviewGateOrOptions = {},
  maybeOptions,
) {
  const calledWithSource =
    maybeOptions !== undefined
    || compatibilityReviewGateOrOptions?.queryName
      === 'createGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate';
  const options = calledWithSource
    ? {
      ...(maybeOptions ?? {}),
      compatibilityReviewGate: compatibilityReviewGateOrOptions,
      sourceCompatibilityReviewGate: compatibilityReviewGateOrOptions,
      runtimeDispatchLayerAdapterCompatibilityReviewGate: compatibilityReviewGateOrOptions,
    }
    : compatibilityReviewGateOrOptions;
  assertPlainObject(
    options,
    'GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightOptions',
  );
  const {
    compatibilityReviewGate,
    sourceCompatibilityReviewGate,
    runtimeDispatchLayerAdapterCompatibilityReviewGate,
    graphVersion,
    preflightName =
      'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-write-intent-preflight',
    ...guardedOptions
  } = options;
  assertNoGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightProducts(
    guardedOptions,
    'GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightOptions',
  );
  assertNoForbiddenGraphFields(
    guardedOptions,
    'GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightOptions',
  );
  assertNoForbiddenPatterns(guardedOptions);
  assertNoGraphMetricFields(
    guardedOptions,
    'GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightOptions',
  );
  for (
    const fieldName
    of GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_WRITE_INTENT_PREFLIGHT_FALSE_FLAG_KEYS
  ) {
    if (options[fieldName] !== undefined && options[fieldName] !== false) {
      throw new Error(`GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight ${fieldName} must remain false`);
    }
  }

  const sourceAliasEntries = [
    ['compatibilityReviewGate', compatibilityReviewGate],
    ['sourceCompatibilityReviewGate', sourceCompatibilityReviewGate],
    [
      'runtimeDispatchLayerAdapterCompatibilityReviewGate',
      runtimeDispatchLayerAdapterCompatibilityReviewGate,
    ],
  ].filter(([, sourceAlias]) => sourceAlias !== undefined);
  if (sourceAliasEntries.length === 0) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightOptions requires a compatibilityReviewGate source');
  }
  for (const [, sourceAlias] of sourceAliasEntries) {
    assertGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateCompatibility(
      sourceAlias,
    );
  }
  const firstSourceAlias = sourceAliasEntries[0][1];
  for (const [aliasName, sourceAlias] of sourceAliasEntries.slice(1)) {
    if (sourceAlias !== firstSourceAlias) {
      throw new Error(
        'GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightOptions '
          + `must not provide multiple distinct source aliases: ${aliasName}`,
      );
    }
  }

  const sourceSummary =
    summarizeGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateForWriteIntentPreflight(
      firstSourceAlias,
    );
  const disabledFlags = Object.fromEntries(
    GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_WRITE_INTENT_PREFLIGHT_FALSE_FLAG_KEYS
      .map((fieldName) => [fieldName, false]),
  );
  const preflight = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: assertRequiredText(
      graphVersion ?? sourceSummary.graphVersion,
      'graphVersion',
      'GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight',
    ),
    queryName:
      'createGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight',
    artifactFamily:
      'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-write-intent-preflight',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      preflightName: assertRequiredText(
        preflightName,
        'preflightName',
        'GraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight',
      ),
      preflightMode: 'descriptor-only',
      result: 'blocked',
      redactionRequired: true,
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph docs lifecycle observability runtime dispatch write-intent preflight blocks writes until a safe runtime write boundary is explicitly enabled',
      ),
      sourceCompatibilityReviewGate: sourceSummary,
      requiredGuards: {
        runtimeDispatchLayerAdapterCompatibilityReviewGate:
          'assertGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateCompatibility',
        runtimeDispatchWriteIntentPreflight:
          'assertGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightCompatibility',
        redactionGuard: 'SecurityGuard/Redaction before any future runtime dispatch write-intent boundary',
      },
      forbiddenRuntimeFields: [
        'writePath',
        'logSink',
        'artifactWriter',
        'repoWriter',
        'docsWriter',
        'subscriber',
        'callback',
        'handler',
        'siteAdapter',
        'downloader',
        'SessionView',
        'sessionView',
        'runtimePayload',
        'telemetrySink',
      ],
      ...disabledFlags,
    }],
  };
  assertGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightCompatibility(
    preflight,
  );
  return cloneDescriptor(preflight);
}

function summarizeGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightForLiveWriteBoundaryGuard(
  sourcePreflight,
) {
  assertGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightCompatibility(
    sourcePreflight,
  );
  const item = sourcePreflight.items[0];
  return {
    queryName: sourcePreflight.queryName,
    artifactFamily: sourcePreflight.artifactFamily,
    graphVersion: sourcePreflight.graphVersion,
    redactionRequired: sourcePreflight.redactionRequired,
    schemaVersion: sourcePreflight.schemaVersion,
    preflightName: item.preflightName,
    preflightMode: item.preflightMode,
    result: item.result,
    reasonCode: item.reasonCode,
    sourceCompatibilityReviewGate: cloneDescriptor(item.sourceCompatibilityReviewGate),
  };
}

export function assertGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardCompatibility(
  guard = {},
) {
  assertPlainObject(
    guard,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard',
  );
  assertNoGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardProducts(
    guard,
  );
  assertNoForbiddenGraphFields(
    guard,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard',
  );
  assertNoForbiddenPatterns(guard);
  assertNoGraphMetricFields(
    guard,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard',
  );
  assertGraphQueryResultCompatible(guard);
  if (
    guard.queryName
      !== 'createGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard queryName must be createGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard');
  }
  if (
    guard.artifactFamily
      !== 'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-live-write-boundary-guard'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard artifactFamily is not supported');
  }
  if (guard.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard redactionRequired must be true');
  }
  if (!Array.isArray(guard.items) || guard.items.length !== 1) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard requires exactly one item');
  }
  const item = guard.items[0];
  assertPlainObject(
    item,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard.items[0]',
  );
  if (item.schemaVersion !== 1) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard item schemaVersion is not compatible');
  }
  if (item.guardMode !== 'descriptor-only') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard guardMode must be descriptor-only');
  }
  if (item.descriptorOnly !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard descriptorOnly must be true');
  }
  if (item.result !== 'blocked') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard result must be blocked');
  }
  if (item.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard item redactionRequired must be true');
  }
  if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
    throw new Error(`GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  assertPlainObject(
    item.reason,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard reason',
  );
  if (item.reason.code !== item.reasonCode) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard reason code must match reasonCode');
  }
  for (
    const fieldName
    of GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_WRITE_BOUNDARY_GUARD_FALSE_FLAG_KEYS
  ) {
    if (item[fieldName] !== false) {
      throw new Error(`GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard ${fieldName} must be false`);
    }
  }
  assertPlainObject(
    item.sourceWriteIntentPreflight,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard sourceWriteIntentPreflight',
  );
  if (
    item.sourceWriteIntentPreflight.queryName
      !== 'createGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard source must be write-intent preflight');
  }
  if (
    item.sourceWriteIntentPreflight.artifactFamily
      !== 'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-write-intent-preflight'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard source artifactFamily is not supported');
  }
  if (item.sourceWriteIntentPreflight.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard source redactionRequired must be true');
  }
  if (item.sourceWriteIntentPreflight.preflightMode !== 'descriptor-only') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard source preflightMode must be descriptor-only');
  }
  if (item.sourceWriteIntentPreflight.result !== 'blocked') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard source result must be blocked');
  }
  if (
    item.sourceWriteIntentPreflight.reasonCode
      !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE
  ) {
    throw new Error(`GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard source reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  assertPlainObject(
    item.requiredGuards,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard requiredGuards',
  );
  if (
    item.requiredGuards.runtimeDispatchWriteIntentPreflight
      !== 'assertGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightCompatibility'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard write-intent preflight guard is required');
  }
  if (
    item.requiredGuards.runtimeDispatchLiveWriteBoundaryGuard
      !== 'assertGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardCompatibility'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard live write boundary guard is required');
  }
  if (item.requiredGuards.redactionGuard !== 'SecurityGuard/Redaction before runtime dispatch live-write boundary') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard redaction guard is required');
  }
  if (!Array.isArray(item.forbiddenRuntimeFields) || item.forbiddenRuntimeFields.length === 0) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard forbiddenRuntimeFields are required');
  }
  return true;
}

export function createGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard(
  writeIntentPreflightOrOptions = {},
  maybeOptions,
) {
  const calledWithSource =
    maybeOptions !== undefined
    || writeIntentPreflightOrOptions?.queryName
      === 'createGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight';
  const options = calledWithSource
    ? {
      ...(maybeOptions ?? {}),
      writeIntentPreflight: writeIntentPreflightOrOptions,
      sourceWriteIntentPreflight: writeIntentPreflightOrOptions,
      runtimeDispatchWriteIntentPreflight: writeIntentPreflightOrOptions,
    }
    : writeIntentPreflightOrOptions;
  assertPlainObject(
    options,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardOptions',
  );
  const {
    writeIntentPreflight,
    sourceWriteIntentPreflight,
    runtimeDispatchWriteIntentPreflight,
    preflight,
    graphVersion,
    guardName =
      'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-live-write-boundary-guard',
    ...guardedOptions
  } = options;
  assertNoGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardProducts(
    guardedOptions,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardOptions',
  );
  assertNoForbiddenGraphFields(
    guardedOptions,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardOptions',
  );
  assertNoForbiddenPatterns(guardedOptions);
  assertNoGraphMetricFields(
    guardedOptions,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardOptions',
  );
  for (
    const fieldName
    of GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_WRITE_BOUNDARY_GUARD_FALSE_FLAG_KEYS
  ) {
    if (options[fieldName] !== undefined && options[fieldName] !== false) {
      throw new Error(`GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard ${fieldName} must remain false`);
    }
  }

  const sourceAliasEntries = [
    ['writeIntentPreflight', writeIntentPreflight],
    ['sourceWriteIntentPreflight', sourceWriteIntentPreflight],
    ['runtimeDispatchWriteIntentPreflight', runtimeDispatchWriteIntentPreflight],
    ['preflight', preflight],
  ].filter(([, sourceAlias]) => sourceAlias !== undefined);
  if (sourceAliasEntries.length === 0) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardOptions requires a writeIntentPreflight source');
  }
  for (const [, sourceAlias] of sourceAliasEntries) {
    assertGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightCompatibility(
      sourceAlias,
    );
  }
  const firstSourceAlias = sourceAliasEntries[0][1];
  for (const [aliasName, sourceAlias] of sourceAliasEntries.slice(1)) {
    if (sourceAlias !== firstSourceAlias) {
      throw new Error(
        'GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardOptions '
          + `must not provide multiple distinct source aliases: ${aliasName}`,
      );
    }
  }

  const sourceSummary =
    summarizeGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightForLiveWriteBoundaryGuard(
      firstSourceAlias,
    );
  const disabledFlags = Object.fromEntries(
    GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_WRITE_BOUNDARY_GUARD_FALSE_FLAG_KEYS
      .map((fieldName) => [fieldName, false]),
  );
  const guard = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: assertRequiredText(
      graphVersion ?? sourceSummary.graphVersion,
      'graphVersion',
      'GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard',
    ),
    queryName:
      'createGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard',
    artifactFamily:
      'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-live-write-boundary-guard',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      guardName: assertRequiredText(
        guardName,
        'guardName',
        'GraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard',
      ),
      guardMode: 'descriptor-only',
      descriptorOnly: true,
      result: 'blocked',
      redactionRequired: true,
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph docs lifecycle observability runtime dispatch live-write boundary remains descriptor-only and blocks runtime dispatch, writes, telemetry, adapters, downloader, SessionView, task runner, route execution, and status promotion',
      ),
      sourceWriteIntentPreflight: sourceSummary,
      requiredGuards: {
        runtimeDispatchWriteIntentPreflight:
          'assertGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightCompatibility',
        runtimeDispatchLiveWriteBoundaryGuard:
          'assertGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardCompatibility',
        redactionGuard: 'SecurityGuard/Redaction before runtime dispatch live-write boundary',
      },
      forbiddenRuntimeFields: [
        'runtimeDispatch',
        'runtimePayload',
        'runtimeWriter',
        'runtimeLog',
        'logSink',
        'artifactWriter',
        'artifactWritePayload',
        'docsWriter',
        'docsPayload',
        'repoWriter',
        'repoPayload',
        'externalTelemetry',
        'externalTelemetryPayload',
        'telemetrySink',
        'telemetryPayload',
        'siteAdapter',
        'siteAdapterPayload',
        'downloader',
        'SessionView',
        'sessionView',
        'taskRunner',
        'routeExecution',
        'statusPromotion',
        'statusPromotionPayload',
      ],
      ...disabledFlags,
    }],
  };
  assertGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardCompatibility(
    guard,
  );
  return cloneDescriptor(guard);
}

function summarizeGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardForLiveAdapterWriteBoundaryGuard(
  sourceGuard,
) {
  assertGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardCompatibility(
    sourceGuard,
  );
  const item = sourceGuard.items[0];
  return {
    queryName: sourceGuard.queryName,
    artifactFamily: sourceGuard.artifactFamily,
    graphVersion: sourceGuard.graphVersion,
    redactionRequired: sourceGuard.redactionRequired,
    schemaVersion: sourceGuard.schemaVersion,
    guardName: item.guardName,
    guardMode: item.guardMode,
    descriptorOnly: item.descriptorOnly,
    result: item.result,
    reasonCode: item.reasonCode,
    sourceWriteIntentPreflight: cloneDescriptor(item.sourceWriteIntentPreflight),
  };
}

export function assertGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardCompatibility(
  guard = {},
) {
  assertPlainObject(
    guard,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard',
  );
  assertNoGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardProducts(
    guard,
  );
  assertNoForbiddenGraphFields(
    guard,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard',
  );
  assertNoForbiddenPatterns(guard);
  assertNoGraphMetricFields(
    guard,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard',
  );
  assertGraphQueryResultCompatible(guard);
  if (
    guard.queryName
      !== 'createGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard queryName must be createGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard');
  }
  if (
    guard.artifactFamily
      !== 'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-live-adapter-write-boundary-guard'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard artifactFamily is not supported');
  }
  if (guard.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard redactionRequired must be true');
  }
  if (!Array.isArray(guard.items) || guard.items.length !== 1) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard requires exactly one item');
  }
  const item = guard.items[0];
  assertPlainObject(
    item,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard.items[0]',
  );
  if (item.schemaVersion !== 1) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard item schemaVersion is not compatible');
  }
  if (item.guardMode !== 'descriptor-only') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard guardMode must be descriptor-only');
  }
  if (item.descriptorOnly !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard descriptorOnly must be true');
  }
  if (item.result !== 'blocked') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard result must be blocked');
  }
  if (item.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard item redactionRequired must be true');
  }
  if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
    throw new Error(`GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  assertPlainObject(
    item.reason,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard reason',
  );
  if (item.reason.code !== item.reasonCode) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard reason code must match reasonCode');
  }
  for (
    const fieldName
    of GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_ADAPTER_WRITE_BOUNDARY_GUARD_FALSE_FLAG_KEYS
  ) {
    if (item[fieldName] !== false) {
      throw new Error(`GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard ${fieldName} must be false`);
    }
  }
  assertPlainObject(
    item.sourceLiveWriteBoundaryGuard,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard sourceLiveWriteBoundaryGuard',
  );
  if (
    item.sourceLiveWriteBoundaryGuard.queryName
      !== 'createGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard source must be live write boundary guard');
  }
  if (
    item.sourceLiveWriteBoundaryGuard.artifactFamily
      !== 'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-live-write-boundary-guard'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard source artifactFamily is not supported');
  }
  if (item.sourceLiveWriteBoundaryGuard.redactionRequired !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard source redactionRequired must be true');
  }
  if (item.sourceLiveWriteBoundaryGuard.guardMode !== 'descriptor-only') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard source guardMode must be descriptor-only');
  }
  if (item.sourceLiveWriteBoundaryGuard.descriptorOnly !== true) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard source descriptorOnly must be true');
  }
  if (item.sourceLiveWriteBoundaryGuard.result !== 'blocked') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard source result must be blocked');
  }
  if (
    item.sourceLiveWriteBoundaryGuard.reasonCode
      !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE
  ) {
    throw new Error(`GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard source reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  assertPlainObject(
    item.requiredGuards,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard requiredGuards',
  );
  if (
    item.requiredGuards.runtimeDispatchLiveWriteBoundaryGuard
      !== 'assertGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardCompatibility'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard live write boundary guard is required');
  }
  if (
    item.requiredGuards.runtimeDispatchLiveAdapterWriteBoundaryGuard
      !== 'assertGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardCompatibility'
  ) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard live adapter write boundary guard is required');
  }
  if (item.requiredGuards.redactionGuard !== 'SecurityGuard/Redaction before runtime dispatch live adapter write boundary') {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard redaction guard is required');
  }
  if (!Array.isArray(item.forbiddenRuntimeFields) || item.forbiddenRuntimeFields.length === 0) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard forbiddenRuntimeFields are required');
  }
  return true;
}

export function createGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard(
  liveWriteBoundaryGuardOrOptions = {},
  maybeOptions,
) {
  const calledWithSource =
    maybeOptions !== undefined
    || liveWriteBoundaryGuardOrOptions?.queryName
      === 'createGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard';
  const options = calledWithSource
    ? {
      ...(maybeOptions ?? {}),
      liveWriteBoundaryGuard: liveWriteBoundaryGuardOrOptions,
      sourceLiveWriteBoundaryGuard: liveWriteBoundaryGuardOrOptions,
      runtimeDispatchLiveWriteBoundaryGuard: liveWriteBoundaryGuardOrOptions,
    }
    : liveWriteBoundaryGuardOrOptions;
  assertPlainObject(
    options,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardOptions',
  );
  const {
    liveWriteBoundaryGuard,
    sourceLiveWriteBoundaryGuard,
    runtimeDispatchLiveWriteBoundaryGuard,
    sourceRuntimeDispatchLiveWriteBoundaryGuard,
    guard,
    graphVersion,
    guardName =
      'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-live-adapter-write-boundary-guard',
    ...guardedOptions
  } = options;
  assertNoGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardProducts(
    guardedOptions,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardOptions',
  );
  assertNoForbiddenGraphFields(
    guardedOptions,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardOptions',
  );
  assertNoForbiddenPatterns(guardedOptions);
  assertNoGraphMetricFields(
    guardedOptions,
    'GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardOptions',
  );
  for (
    const fieldName
    of GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_ADAPTER_WRITE_BOUNDARY_GUARD_FALSE_FLAG_KEYS
  ) {
    if (options[fieldName] !== undefined && options[fieldName] !== false) {
      throw new Error(`GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard ${fieldName} must remain false`);
    }
  }

  const sourceAliasEntries = [
    ['liveWriteBoundaryGuard', liveWriteBoundaryGuard],
    ['sourceLiveWriteBoundaryGuard', sourceLiveWriteBoundaryGuard],
    ['runtimeDispatchLiveWriteBoundaryGuard', runtimeDispatchLiveWriteBoundaryGuard],
    ['sourceRuntimeDispatchLiveWriteBoundaryGuard', sourceRuntimeDispatchLiveWriteBoundaryGuard],
    ['guard', guard],
  ].filter(([, sourceAlias]) => sourceAlias !== undefined);
  if (sourceAliasEntries.length === 0) {
    throw new Error('GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardOptions requires a liveWriteBoundaryGuard source');
  }
  for (const [, sourceAlias] of sourceAliasEntries) {
    assertGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardCompatibility(
      sourceAlias,
    );
  }
  const firstSourceAlias = sourceAliasEntries[0][1];
  for (const [aliasName, sourceAlias] of sourceAliasEntries.slice(1)) {
    if (sourceAlias !== firstSourceAlias) {
      throw new Error(
        'GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardOptions '
          + `must not provide multiple distinct source aliases: ${aliasName}`,
      );
    }
  }

  const sourceSummary =
    summarizeGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardForLiveAdapterWriteBoundaryGuard(
      firstSourceAlias,
    );
  const disabledFlags = Object.fromEntries(
    GRAPH_DOCS_LIFECYCLE_OBSERVABILITY_RUNTIME_DISPATCH_LIVE_ADAPTER_WRITE_BOUNDARY_GUARD_FALSE_FLAG_KEYS
      .map((fieldName) => [fieldName, false]),
  );
  const adapterGuard = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: assertRequiredText(
      graphVersion ?? sourceSummary.graphVersion,
      'graphVersion',
      'GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard',
    ),
    queryName:
      'createGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard',
    artifactFamily:
      'site-capability-graph-docs-lifecycle-observability-runtime-dispatch-live-adapter-write-boundary-guard',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      guardName: assertRequiredText(
        guardName,
        'guardName',
        'GraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard',
      ),
      guardMode: 'descriptor-only',
      descriptorOnly: true,
      result: 'blocked',
      redactionRequired: true,
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph docs lifecycle observability runtime dispatch live adapter write boundary remains descriptor-only and blocks live adapter dispatch, runtime dispatch, writes, telemetry, adapters, downloader, SessionView, task runner, route execution, runtime payloads, and sensitive material',
      ),
      sourceLiveWriteBoundaryGuard: sourceSummary,
      requiredGuards: {
        runtimeDispatchLiveWriteBoundaryGuard:
          'assertGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardCompatibility',
        runtimeDispatchLiveAdapterWriteBoundaryGuard:
          'assertGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardCompatibility',
        redactionGuard: 'SecurityGuard/Redaction before runtime dispatch live adapter write boundary',
      },
      forbiddenRuntimeFields: [
        'liveAdapterDispatch',
        'liveAdapterDispatchPayload',
        'adapterDispatch',
        'adapterDispatchPayload',
        'siteAdapterDispatch',
        'siteAdapterDispatchPayload',
        'runtimeDispatch',
        'runtimePayload',
        'runtimeWriter',
        'runtimeLog',
        'logSink',
        'artifactWriter',
        'artifactWritePayload',
        'docsWriter',
        'docsPayload',
        'repoWriter',
        'repoPayload',
        'externalTelemetry',
        'externalTelemetryPayload',
        'externalDispatch',
        'externalDispatchPayload',
        'telemetrySink',
        'telemetryPayload',
        'siteAdapter',
        'siteAdapterPayload',
        'downloader',
        'SessionView',
        'sessionView',
        'taskRunner',
        'routeExecution',
        'graphExecution',
        'sensitiveMaterial',
      ],
      ...disabledFlags,
    }],
  };
  assertGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardCompatibility(
    adapterGuard,
  );
  return cloneDescriptor(adapterGuard);
}

const GRAPH_OBSERVABILITY_EXTERNAL_TELEMETRY_DISPATCH_BOUNDARY_FALSE_FLAG_KEYS = Object.freeze([
  'externalTelemetryEnabled',
  'externalTelemetryDispatchEnabled',
  'telemetryDispatchEnabled',
  'telemetryDispatchAllowed',
  'runtimeTelemetryWrite',
  'runtimeDispatchEnabled',
  'runtimeWriteEnabled',
  'runtimeArtifactWriteEnabled',
  'repoArtifactWriteEnabled',
  'routeExecutionEnabled',
  'liveRouteExecutionEnabled',
  'siteAdapterInvocationEnabled',
  'siteAdapterEnabled',
  'downloaderInvocationEnabled',
  'downloaderEnabled',
  'sessionMaterializationEnabled',
  'sessionViewEnabled',
  'sessionViewMaterialized',
  'graphExecutes',
  'dispatchTelemetryEnabled',
  'externalDispatchEnabled',
  'subscriberCallbackEnabled',
  'runtimePayloadEnabled',
  'artifactWriteEnabled',
  'logWriteEnabled',
  'docsWriteEnabled',
  'repoWriteEnabled',
  'profileMaterializationEnabled',
  'taskPayloadMaterialized',
  'taskRunnerEnabled',
  'runtimeConsumerEnabled',
  'statusPromotionAllowed',
  'verifiedPromotionAllowed',
]);

const GRAPH_OBSERVABILITY_EXTERNAL_TELEMETRY_DISPATCH_BOUNDARY_RUNTIME_PRODUCT_KEYS = Object.freeze([
  'Authorization',
  'authorization',
  'authorizationHeader',
  'browserProfile',
  'callback',
  'cookie',
  'credential',
  'credentials',
  'dispatchLifecycleEvent',
  'dispatchPayload',
  'downloadPolicy',
  'downloader',
  'externalDispatch',
  'externalTelemetry',
  'externalTelemetrySink',
  'handler',
  'outputPath',
  'runtimeArtifact',
  'runtimeLog',
  'runtimePayload',
  'sessionId',
  'sessionView',
  'siteAdapter',
  'standardTaskList',
  'subscriber',
  'subscribers',
  'subscriberResults',
  'taskList',
  'telemetryPayload',
  'telemetrySink',
  'token',
]);

const GRAPH_OBSERVABILITY_EXTERNAL_TELEMETRY_DISPATCH_BOUNDARY_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_OBSERVABILITY_EXTERNAL_TELEMETRY_DISPATCH_BOUNDARY_RUNTIME_PRODUCT_KEYS
    .map((key) => normalizeKey(key)),
);

/** @param {Record<string, any>} [source] */
// @ts-ignore
function summarizeGraphObservabilityExternalTelemetrySourceEvidence(source = {}, label) {
  if (source === undefined || source === null) {
    return undefined;
  }
  assertPlainObject(source, label);
  if (typeof source.subscriber === 'function' || typeof source.callback === 'function') {
    throw new Error(`${label} must not include executable callbacks`);
  }
  assertNoForbiddenGraphFields(source, label);
  assertNoForbiddenPatterns(source);
  assertNoGraphMetricFields(source, label);
  return cloneDescriptor({
    ...(source.schemaVersion === undefined ? {} : { schemaVersion: source.schemaVersion }),
    ...(source.graphVersion === undefined ? {} : { graphVersion: source.graphVersion }),
    ...(source.queryName === undefined ? {} : { queryName: source.queryName }),
    ...(source.artifactFamily === undefined ? {} : { artifactFamily: source.artifactFamily }),
    ...(source.redactionRequired === undefined ? {} : { redactionRequired: source.redactionRequired }),
    ...(source.result === undefined ? {} : { result: source.result }),
    ...(source.reasonCode === undefined ? {} : { reasonCode: source.reasonCode }),
    ...(source.registrationOwner === undefined ? {} : { registrationOwner: source.registrationOwner }),
    ...(source.registryType === undefined ? {} : { registryType: source.registryType }),
    ...(source.registeredSubscriberId === undefined ? {} : { registeredSubscriberId: source.registeredSubscriberId }),
    ...(source.eventTypes === undefined ? {} : { eventTypes: source.eventTypes }),
  });
}

function assertNoGraphObservabilityExternalTelemetryDispatchBoundaryRuntimeProducts(
  value,
  label = 'GraphObservabilityExternalTelemetryDispatchBoundaryOptions',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => (
      assertNoGraphObservabilityExternalTelemetryDispatchBoundaryRuntimeProducts(
        entry,
        label,
        `${path}[${index}]`,
      )
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (
      GRAPH_OBSERVABILITY_EXTERNAL_TELEMETRY_DISPATCH_BOUNDARY_RUNTIME_PRODUCT_KEY_SET
        .has(normalizedKey)
    ) {
      throw new Error(`${label} descriptor-only rejected runtime field: ${path}.${key}`);
    }
    assertNoGraphObservabilityExternalTelemetryDispatchBoundaryRuntimeProducts(
      entry,
      label,
      `${path}.${key}`,
    );
  }
  return true;
}

/** @param {Record<string, any>} options */
function assertGraphObservabilityExternalTelemetryDispatchBoundaryOptions(options = {}) {
  assertPlainObject(options, 'GraphObservabilityExternalTelemetryDispatchBoundaryOptions');
  const {
    sourceRegistrationEvidence,
    runtimeRegistrationConsumerGuard,
    sourceRuntimeRegistrationConsumerGuard,
    sourceLifecycleEvidence,
    graphVersion,
    boundaryName,
    ...guardedOptions
  } = options;
  void sourceRegistrationEvidence;
  void runtimeRegistrationConsumerGuard;
  void sourceRuntimeRegistrationConsumerGuard;
  void sourceLifecycleEvidence;
  void graphVersion;
  void boundaryName;
  assertNoGraphDocsGenerationLifecycleRuntimeProducts(
    guardedOptions,
    'GraphObservabilityExternalTelemetryDispatchBoundaryOptions',
  );
  assertNoGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardRuntimeProducts(
    guardedOptions,
    'GraphObservabilityExternalTelemetryDispatchBoundaryOptions',
  );
  assertNoGraphObservabilityExternalTelemetryDispatchBoundaryRuntimeProducts(
    guardedOptions,
    'GraphObservabilityExternalTelemetryDispatchBoundaryOptions',
  );
  assertNoForbiddenGraphFields(
    guardedOptions,
    'GraphObservabilityExternalTelemetryDispatchBoundaryOptions',
  );
  assertNoForbiddenPatterns(guardedOptions);
  assertNoGraphMetricFields(
    guardedOptions,
    'GraphObservabilityExternalTelemetryDispatchBoundaryOptions',
  );
  for (const fieldName of GRAPH_OBSERVABILITY_EXTERNAL_TELEMETRY_DISPATCH_BOUNDARY_FALSE_FLAG_KEYS) {
    assertDisabledFlag(
      options[fieldName],
      fieldName,
      'GraphObservabilityExternalTelemetryDispatchBoundary',
    );
  }
  return true;
}

export function assertGraphObservabilityExternalTelemetryDispatchBoundaryCompatibility(
  result = {},
) {
  assertPlainObject(result, 'GraphObservabilityExternalTelemetryDispatchBoundary');
  assertNoForbiddenGraphFields(result, 'GraphObservabilityExternalTelemetryDispatchBoundary');
  assertNoForbiddenPatterns(result);
  assertNoGraphMetricFields(result, 'GraphObservabilityExternalTelemetryDispatchBoundary');
  assertGraphQueryResultCompatible(result);
  if (result.queryName !== 'createGraphObservabilityExternalTelemetryDispatchBoundary') {
    throw new Error('GraphObservabilityExternalTelemetryDispatchBoundary queryName must be createGraphObservabilityExternalTelemetryDispatchBoundary');
  }
  if (
    result.artifactFamily
      !== 'site-capability-graph-observability-external-telemetry-dispatch-boundary'
  ) {
    throw new Error('GraphObservabilityExternalTelemetryDispatchBoundary artifactFamily must be site-capability-graph-observability-external-telemetry-dispatch-boundary');
  }
  if (result.redactionRequired !== true) {
    throw new Error('GraphObservabilityExternalTelemetryDispatchBoundary redactionRequired must be true');
  }
  if (!Array.isArray(result.items) || result.items.length !== 1) {
    throw new Error('GraphObservabilityExternalTelemetryDispatchBoundary requires exactly one item');
  }
  const item = result.items[0];
  assertPlainObject(item, 'GraphObservabilityExternalTelemetryDispatchBoundary.items[0]');
  if (item.schemaVersion !== 1) {
    throw new Error('GraphObservabilityExternalTelemetryDispatchBoundary item schemaVersion is not compatible');
  }
  if (item.boundaryMode !== 'descriptor-only') {
    throw new Error('GraphObservabilityExternalTelemetryDispatchBoundary boundaryMode must be descriptor-only');
  }
  if (item.result !== 'blocked') {
    throw new Error('GraphObservabilityExternalTelemetryDispatchBoundary result must be blocked');
  }
  if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
    throw new Error(`GraphObservabilityExternalTelemetryDispatchBoundary reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  if (item.redactionRequired !== true) {
    throw new Error('GraphObservabilityExternalTelemetryDispatchBoundary item redactionRequired must be true');
  }
  for (const fieldName of GRAPH_OBSERVABILITY_EXTERNAL_TELEMETRY_DISPATCH_BOUNDARY_FALSE_FLAG_KEYS) {
    if (item[fieldName] !== false) {
      throw new Error(`GraphObservabilityExternalTelemetryDispatchBoundary ${fieldName} must be false`);
    }
  }
  if (!Array.isArray(item.forbiddenRuntimeFields) || item.forbiddenRuntimeFields.length === 0) {
    throw new Error('GraphObservabilityExternalTelemetryDispatchBoundary forbiddenRuntimeFields are required');
  }
  assertPlainObject(item.requiredGuards, 'GraphObservabilityExternalTelemetryDispatchBoundary requiredGuards');
  if (
    item.requiredGuards.externalTelemetryDispatchBoundary
      !== 'assertGraphObservabilityExternalTelemetryDispatchBoundaryCompatibility'
  ) {
    throw new Error('GraphObservabilityExternalTelemetryDispatchBoundary externalTelemetryDispatchBoundary guard is required');
  }
  return true;
}

export function createGraphObservabilityExternalTelemetryDispatchBoundary(
  sourceRegistrationEvidenceOrOptions = {},
  maybeOptions,
) {
  const options = maybeOptions === undefined
    ? sourceRegistrationEvidenceOrOptions
    : {
      runtimeRegistrationConsumerGuard: sourceRegistrationEvidenceOrOptions,
      sourceRuntimeRegistrationConsumerGuard: sourceRegistrationEvidenceOrOptions,
      ...maybeOptions,
    };
  assertGraphObservabilityExternalTelemetryDispatchBoundaryOptions(options);
  const {
    graphVersion,
    boundaryName = 'site-capability-graph-observability-external-telemetry-dispatch-boundary',
    sourceRegistrationEvidence,
    runtimeRegistrationConsumerGuard,
    sourceRuntimeRegistrationConsumerGuard,
    sourceLifecycleEvidence,
  } = options;
  const registrationEvidence = sourceRegistrationEvidence
    ?? runtimeRegistrationConsumerGuard
    ?? sourceRuntimeRegistrationConsumerGuard;
  const sourceRegistrationSummary = summarizeGraphObservabilityExternalTelemetrySourceEvidence(
    registrationEvidence,
    'GraphObservabilityExternalTelemetryDispatchBoundary sourceRegistrationEvidence',
  );
  const sourceLifecycleSummary = summarizeGraphObservabilityExternalTelemetrySourceEvidence(
    sourceLifecycleEvidence,
    'GraphObservabilityExternalTelemetryDispatchBoundary sourceLifecycleEvidence',
  );
  const disabledFlags = Object.fromEntries(
    GRAPH_OBSERVABILITY_EXTERNAL_TELEMETRY_DISPATCH_BOUNDARY_FALSE_FLAG_KEYS
      .map((fieldName) => [fieldName, false]),
  );
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: assertRequiredText(
      graphVersion
        ?? sourceRegistrationSummary?.graphVersion
        ?? 'graph-observability-external-telemetry-dispatch-boundary-v1',
      'graphVersion',
      'GraphObservabilityExternalTelemetryDispatchBoundary',
    ),
    queryName: 'createGraphObservabilityExternalTelemetryDispatchBoundary',
    artifactFamily:
      'site-capability-graph-observability-external-telemetry-dispatch-boundary',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      boundaryName: assertRequiredText(
        boundaryName,
        'boundaryName',
        'GraphObservabilityExternalTelemetryDispatchBoundary',
      ),
      boundaryMode: 'descriptor-only',
      result: 'blocked',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph observability external telemetry dispatch boundary is descriptor-only and disabled',
      ),
      redactionRequired: true,
      requiredGuards: {
        externalTelemetryDispatchBoundary:
          'assertGraphObservabilityExternalTelemetryDispatchBoundaryCompatibility',
        redactionGuard: 'SecurityGuard/Redaction before any future telemetry dispatch',
        registrationOwnerGuard:
          'assertGraphDocsLifecycleObservabilityRegistrationOwnerIntegrationCompatibility',
      },
      sourceRegistrationEvidence: sourceRegistrationSummary,
      sourceRuntimeRegistrationConsumerGuard: sourceRegistrationSummary,
      sourceLifecycleEvidence: sourceLifecycleSummary,
      forbiddenRuntimeFields: [
        'runtimeTelemetryWrite',
        'externalTelemetry',
        'externalTelemetrySink',
        'externalTelemetryEnabled',
        'dispatchTelemetry',
        'externalDispatch',
        'subscriber',
        'subscriberCallback',
        'callback',
        'sessionView',
        'profile runtime material',
        'profile runtime path',
        'userDataDir',
        'downloader',
        'siteAdapter',
        'taskPayload',
        'runtimePayload',
        'routeExecution',
        'graphExecution',
        'rawSensitiveMaterial',
      ],
      ...disabledFlags,
    }],
  };
  assertGraphObservabilityExternalTelemetryDispatchBoundaryCompatibility(result);
  return cloneDescriptor(result);
}

/** @param {Record<string, any>} options */
export async function writeGraphDocsGenerationLifecycleEventArtifact({
  eventPath,
  auditPath,
  ...eventOptions
} = {}) {
  const event = createGraphDocsGenerationLifecycleEvent(eventOptions);
  assertGraphDocsGenerationObservabilityEvent(event);
  const result = await writeLifecycleEventArtifact(event, {
    eventPath,
    auditPath,
  });
  assertNoForbiddenPatterns(result);
  return result;
}

/** @param {Record<string, any>} [artifact] */
export function assertGraphDerivedArtifactWriteAllowed(artifact = {}) {
  assertPlainObject(artifact, 'GraphDerivedArtifact');
  if (artifact.redactionRequired !== true) {
    throw new Error('Graph-derived artifact writes require redactionRequired=true');
  }

  const artifactKind = detectGraphDerivedArtifactKind(artifact);
  if (!artifactKind) {
    throw new Error('Unsupported graph-derived artifact type');
  }

  if (artifactKind === 'GraphValidationReport') {
    assertGraphValidationReportCompatible(artifact);
  } else if (artifactKind === 'GraphQueryResult') {
    assertGraphQueryResultCompatible(artifact);
    if (artifact.artifactFamily === 'site-capability-graph-docs-markdown') {
      assertGraphDocsMarkdownArtifactConsumerCompatibility(artifact);
    }
  } else if (artifactKind === 'GraphDocsSummary') {
    assertGraphDocsSummaryCompatible(artifact);
  } else if (artifactKind === 'ArtifactNode' || artifactKind === 'ArtifactContractNode') {
    assertArtifactNodeCompatible(artifact);
    if (artifact.writeGuard !== 'SecurityGuard/Redaction') {
      throw new Error('Graph-derived artifact writes require SecurityGuard/Redaction writeGuard');
    }
  }

  assertNoForbiddenGraphFields(artifact, 'GraphDerivedArtifact');
  assertNoForbiddenPatterns(artifact);
  return true;
}

/** @param {Record<string, any>} [graph] */
export function validateSiteCapabilityGraph(graph = {}) {
  const findings = [];
  try {
    assertSiteCapabilityGraphCompatible(graph);
  } catch (error) {
    findings.push(publicFinding({
      reasonCode: 'graph-schema-invalid',
      message: error instanceof Error ? error.message : 'SiteCapabilityGraph schema validation failed',
    }));
    const report = {
      schemaVersion: GRAPH_VALIDATION_REPORT_SCHEMA_VERSION,
      graphVersion: normalizeText(graph?.graphVersion) ?? '<unknown>',
      result: 'failed',
      findings,
    };
    assertGraphValidationReportCompatible(report);
    return report;
  }

  const nodeIds = new Set();
  const nodeById = new Map();
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      findings.push(publicFinding({
        reasonCode: 'graph-node-id-duplicate',
        message: `Graph node id must be unique: ${node.id}`,
        nodeId: node.id,
      }));
      continue;
    }
    nodeIds.add(node.id);
    nodeById.set(node.id, node);
  }

  const edgeIds = new Set();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      findings.push(publicFinding({
        reasonCode: 'graph-edge-id-duplicate',
        message: `Graph edge id must be unique: ${edge.id}`,
        edgeId: edge.id,
      }));
    }
    edgeIds.add(edge.id);
    if (!nodeById.has(edge.from)) {
      findings.push(publicFinding({
        reasonCode: 'graph-edge-broken',
        message: `Graph edge from node is missing: ${edge.from}`,
        edgeId: edge.id,
        field: 'from',
      }));
    }
    if (!nodeById.has(edge.to)) {
      findings.push(publicFinding({
        reasonCode: 'graph-edge-broken',
        message: `Graph edge to node is missing: ${edge.to}`,
        edgeId: edge.id,
        field: 'to',
      }));
    }
  }

  for (const node of graph.nodes) {
    if (node.type === 'CapabilityNode') {
      if (!Array.isArray(node.routeRefs) || node.routeRefs.length === 0) {
        findings.push(publicFinding({
          reasonCode: 'graph-capability-missing-route',
          message: 'CapabilityNode must reference at least one RouteNode',
          nodeId: node.id,
          field: 'routeRefs',
        }));
      }
      for (const routeRef of node.routeRefs ?? []) {
        const route = nodeById.get(routeRef);
        if (!route || route.type !== 'RouteNode') {
          findings.push(publicFinding({
            reasonCode: 'graph-capability-missing-route',
            message: `CapabilityNode routeRef does not resolve to a RouteNode: ${routeRef}`,
            nodeId: node.id,
            field: 'routeRefs',
          }));
        }
      }
      for (const authRequirementRef of node.authRequirementRefs ?? []) {
        const authRequirement = findGraphNode(nodeById, authRequirementRef, 'AuthRequirementNode');
        if (!authRequirement) {
          findings.push(publicFinding({
            reasonCode: 'graph-capability-missing-auth-requirement',
            message: `CapabilityNode authRequirementRef does not resolve to an AuthRequirementNode: ${authRequirementRef}`,
            nodeId: node.id,
            field: 'authRequirementRefs',
          }));
        } else if (!hasGraphEdge(graph.edges, 'capability_requires_auth', node.id, authRequirementRef)) {
          findings.push(publicFinding({
            reasonCode: 'graph-capability-missing-auth-requirement',
            message: `CapabilityNode authRequirementRef is not declared by capability_requires_auth edge: ${authRequirementRef}`,
            nodeId: node.id,
            field: 'authRequirementRefs',
          }));
        } else if (!authRequirement.requiredFor.includes(node.id)) {
          findings.push(publicFinding({
            reasonCode: 'graph-capability-missing-auth-requirement',
            message: `CapabilityNode authRequirementRef is not listed in AuthRequirementNode requiredFor: ${authRequirementRef}`,
            nodeId: node.id,
            field: 'authRequirementRefs',
          }));
        }
      }
      for (const sessionRequirementRef of node.sessionRequirementRefs ?? []) {
        if (!findGraphNode(nodeById, sessionRequirementRef, 'SessionRequirementNode')) {
          findings.push(publicFinding({
            reasonCode: 'graph-capability-missing-session-requirement',
            message: `CapabilityNode sessionRequirementRef does not resolve to a SessionRequirementNode: ${sessionRequirementRef}`,
            nodeId: node.id,
            field: 'sessionRequirementRefs',
          }));
        } else if (!hasGraphEdge(graph.edges, 'capability_requires_session', node.id, sessionRequirementRef)) {
          findings.push(publicFinding({
            reasonCode: 'graph-capability-missing-session-requirement',
            message: `CapabilityNode sessionRequirementRef is not declared by capability_requires_session edge: ${sessionRequirementRef}`,
            nodeId: node.id,
            field: 'sessionRequirementRefs',
          }));
        }
      }
      const riskPolicy = nodeById.get(node.riskPolicyRef);
      if (!riskPolicy || riskPolicy.type !== 'RiskPolicyNode') {
        findings.push(publicFinding({
          reasonCode: 'graph-capability-missing-risk-policy',
          message: 'CapabilityNode riskPolicyRef does not resolve to a RiskPolicyNode',
          nodeId: node.id,
          field: 'riskPolicyRef',
        }));
      }
      if (node.mode !== 'readOnly' && node.requiresApproval !== true) {
        findings.push(publicFinding({
          reasonCode: 'graph-non-readonly-missing-approval',
          message: 'Non-readOnly CapabilityNode must set requiresApproval=true',
          nodeId: node.id,
          field: 'requiresApproval',
        }));
      }
      if (node.agentExposed === true && (!Array.isArray(node.testEvidenceRefs) || node.testEvidenceRefs.length === 0)) {
        findings.push(publicFinding({
          reasonCode: 'graph-agent-capability-missing-test-evidence',
          message: 'Agent-exposed CapabilityNode must include test evidence refs',
          nodeId: node.id,
          field: 'testEvidenceRefs',
        }));
      }
    }

    if (node.type === 'ArtifactContractNode' || node.type === 'ArtifactNode') {
      if (node.redactionRequired !== true) {
        findings.push(publicFinding({
          reasonCode: 'graph-artifact-redaction-required',
          message: 'Graph-derived artifact nodes must set redactionRequired=true',
          nodeId: node.id,
          field: 'redactionRequired',
        }));
      }
    }

    if (node.type === 'RouteNode') {
      for (const fallbackRouteRef of node.fallbackRouteRefs ?? []) {
        const fallbackRoute = findGraphNode(nodeById, fallbackRouteRef, 'RouteNode');
        if (!fallbackRoute) {
          findings.push(publicFinding({
            reasonCode: 'graph-edge-broken',
            message: `RouteNode fallbackRouteRef does not resolve to a RouteNode: ${fallbackRouteRef}`,
            nodeId: node.id,
            field: 'fallbackRouteRefs',
          }));
          continue;
        }
        if (fallbackRoute.id === node.id) {
          findings.push(publicFinding({
            reasonCode: 'graph-edge-broken',
            message: `RouteNode fallbackRouteRef must not reference itself: ${fallbackRouteRef}`,
            nodeId: node.id,
            field: 'fallbackRouteRefs',
          }));
          continue;
        }
        const sharesCapability = (node.capabilityRefs ?? [])
          .some((capabilityRef) => (fallbackRoute.capabilityRefs ?? []).includes(capabilityRef));
        if (!sharesCapability) {
          findings.push(publicFinding({
            reasonCode: 'graph-edge-broken',
            message: `RouteNode fallbackRouteRef must share at least one capabilityRef: ${fallbackRouteRef}`,
            nodeId: node.id,
            field: 'fallbackRouteRefs',
          }));
        }
      }
      const riskPolicy = findGraphNode(nodeById, node.riskPolicyRef, 'RiskPolicyNode');
      if (!riskPolicy) {
        findings.push(publicFinding({
          reasonCode: 'graph-capability-missing-risk-policy',
          message: 'RouteNode riskPolicyRef does not resolve to a RiskPolicyNode',
          nodeId: node.id,
          field: 'riskPolicyRef',
        }));
      }
    }

    if (node.type === 'EndpointNode') {
      for (const routeRef of node.routeRefs ?? []) {
        if (!findGraphNode(nodeById, routeRef, 'RouteNode')) {
          findings.push(publicFinding({
            reasonCode: 'graph-edge-broken',
            message: `EndpointNode routeRef does not resolve to a RouteNode: ${routeRef}`,
            nodeId: node.id,
            field: 'routeRefs',
          }));
        }
      }
      for (const capabilityRef of node.capabilityRefs ?? []) {
        if (!findGraphNode(nodeById, capabilityRef, 'CapabilityNode')) {
          findings.push(publicFinding({
            reasonCode: 'graph-edge-broken',
            message: `EndpointNode capabilityRef does not resolve to a CapabilityNode: ${capabilityRef}`,
            nodeId: node.id,
            field: 'capabilityRefs',
          }));
        }
      }
      const authRequirement = findGraphNode(nodeById, node.authRequirementRef, 'AuthRequirementNode');
      const sessionRequirement = findGraphNode(nodeById, node.sessionRequirementRef, 'SessionRequirementNode');
      const signer = findGraphNode(nodeById, node.signerRef, 'SignerNode');
      const requestSchema = findGraphNode(nodeById, node.requestSchemaRef, 'SchemaNode');
      const responseSchema = findGraphNode(nodeById, node.responseSchemaRef, 'SchemaNode');
      const riskPolicy = findGraphNode(nodeById, node.riskPolicyRef, 'RiskPolicyNode');
      const version = findGraphNode(nodeById, node.versionRef, 'VersionNode');

      if (!authRequirement) {
        findings.push(publicFinding({
          reasonCode: 'graph-endpoint-missing-auth-requirement',
          message: `EndpointNode authRequirementRef does not resolve to an AuthRequirementNode: ${node.authRequirementRef}`,
          nodeId: node.id,
          field: 'authRequirementRef',
        }));
      } else if (!hasGraphEdge(graph.edges, 'endpoint_requires_auth', node.id, node.authRequirementRef)) {
        findings.push(publicFinding({
          reasonCode: 'graph-endpoint-missing-auth-requirement',
          message: `EndpointNode authRequirementRef is not declared by endpoint_requires_auth edge: ${node.authRequirementRef}`,
          nodeId: node.id,
          field: 'authRequirementRef',
        }));
      } else if (!authRequirement.requiredFor.includes(node.id)) {
        findings.push(publicFinding({
          reasonCode: 'graph-endpoint-missing-auth-requirement',
          message: `EndpointNode authRequirementRef is not listed in AuthRequirementNode requiredFor: ${node.authRequirementRef}`,
          nodeId: node.id,
          field: 'authRequirementRef',
        }));
      }
      if (!sessionRequirement) {
        findings.push(publicFinding({
          reasonCode: 'graph-endpoint-missing-session-requirement',
          message: `EndpointNode sessionRequirementRef does not resolve to a SessionRequirementNode: ${node.sessionRequirementRef}`,
          nodeId: node.id,
          field: 'sessionRequirementRef',
        }));
      } else if (!hasGraphEdge(graph.edges, 'endpoint_requires_session', node.id, node.sessionRequirementRef)) {
        findings.push(publicFinding({
          reasonCode: 'graph-endpoint-missing-session-requirement',
          message: `EndpointNode sessionRequirementRef is not declared by endpoint_requires_session edge: ${node.sessionRequirementRef}`,
          nodeId: node.id,
          field: 'sessionRequirementRef',
        }));
      }
      if (!signer) {
        findings.push(publicFinding({
          reasonCode: 'graph-endpoint-missing-signer',
          message: `EndpointNode signerRef does not resolve to a SignerNode: ${node.signerRef}`,
          nodeId: node.id,
          field: 'signerRef',
        }));
      } else if (!hasGraphEdge(graph.edges, 'endpoint_requires_signer', node.id, node.signerRef)) {
        findings.push(publicFinding({
          reasonCode: 'graph-endpoint-missing-signer',
          message: `EndpointNode signerRef is not declared by endpoint_requires_signer edge: ${node.signerRef}`,
          nodeId: node.id,
          field: 'signerRef',
        }));
      } else if (!signer.supportedEndpointRefs.includes(node.id)) {
        findings.push(publicFinding({
          reasonCode: 'graph-endpoint-missing-signer',
          message: `EndpointNode signerRef is not listed in SignerNode supportedEndpointRefs: ${node.signerRef}`,
          nodeId: node.id,
          field: 'signerRef',
        }));
      }
      if (!requestSchema) {
        findings.push(publicFinding({
          reasonCode: 'graph-endpoint-missing-schema',
          message: `EndpointNode requestSchemaRef does not resolve to a SchemaNode: ${node.requestSchemaRef}`,
          nodeId: node.id,
          field: 'requestSchemaRef',
        }));
      } else if (!hasGraphEdge(graph.edges, 'node_validated_by_schema', node.id, node.requestSchemaRef)) {
        findings.push(publicFinding({
          reasonCode: 'graph-endpoint-missing-schema',
          message: `EndpointNode requestSchemaRef is not declared by node_validated_by_schema edge: ${node.requestSchemaRef}`,
          nodeId: node.id,
          field: 'requestSchemaRef',
        }));
      }
      if (!responseSchema) {
        findings.push(publicFinding({
          reasonCode: 'graph-endpoint-missing-schema',
          message: `EndpointNode responseSchemaRef does not resolve to a SchemaNode: ${node.responseSchemaRef}`,
          nodeId: node.id,
          field: 'responseSchemaRef',
        }));
      } else if (!hasGraphEdge(graph.edges, 'node_validated_by_schema', node.id, node.responseSchemaRef)) {
        findings.push(publicFinding({
          reasonCode: 'graph-endpoint-missing-schema',
          message: `EndpointNode responseSchemaRef is not declared by node_validated_by_schema edge: ${node.responseSchemaRef}`,
          nodeId: node.id,
          field: 'responseSchemaRef',
        }));
      }
      if (!riskPolicy) {
        findings.push(publicFinding({
          reasonCode: 'graph-capability-missing-risk-policy',
          message: 'EndpointNode riskPolicyRef does not resolve to a RiskPolicyNode',
          nodeId: node.id,
          field: 'riskPolicyRef',
        }));
      } else if (!hasGraphEdge(graph.edges, 'endpoint_guarded_by_risk_policy', node.id, node.riskPolicyRef)) {
        findings.push(publicFinding({
          reasonCode: 'graph-capability-missing-risk-policy',
          message: 'EndpointNode riskPolicyRef is not declared by endpoint_guarded_by_risk_policy edge',
          nodeId: node.id,
          field: 'riskPolicyRef',
        }));
      }
      if (!version) {
        findings.push(publicFinding({
          reasonCode: 'graph-version-incompatible',
          message: `EndpointNode versionRef does not resolve to a VersionNode: ${node.versionRef}`,
          nodeId: node.id,
          field: 'versionRef',
        }));
      } else if (!hasGraphEdge(graph.edges, 'node_has_version', node.id, node.versionRef)) {
        findings.push(publicFinding({
          reasonCode: 'graph-version-incompatible',
          message: `EndpointNode versionRef is not declared by node_has_version edge: ${node.versionRef}`,
          nodeId: node.id,
          field: 'versionRef',
        }));
      }
      if (node.requiresCookie === true) {
        if (!authRequirement || authRequirement.authKind === 'none') {
          findings.push(publicFinding({
            reasonCode: 'graph-endpoint-missing-auth-requirement',
            message: 'EndpointNode requiresCookie=true must reference a concrete AuthRequirementNode',
            nodeId: node.id,
            field: 'authRequirementRef',
          }));
        }
        if (!sessionRequirement || sessionRequirement.purpose === 'none') {
          findings.push(publicFinding({
            reasonCode: 'graph-endpoint-missing-session-requirement',
            message: 'EndpointNode requiresCookie=true must reference a concrete SessionRequirementNode',
            nodeId: node.id,
            field: 'sessionRequirementRef',
          }));
        }
      }
      if (node.requiresWbi === true && (!signer || signer.signerKind === 'none')) {
        findings.push(publicFinding({
          reasonCode: 'graph-endpoint-missing-signer',
          message: 'EndpointNode requiresWbi=true must reference a concrete SignerNode',
          nodeId: node.id,
          field: 'signerRef',
        }));
      }
      const lifecycleState = node.lifecycleState ?? node.status;
      if (lifecycleState === 'cataloged' && (!Array.isArray(node.testEvidenceRefs) || node.testEvidenceRefs.length === 0)) {
        findings.push(publicFinding({
          reasonCode: 'graph-agent-capability-missing-test-evidence',
          message: 'Cataloged EndpointNode must include test evidence refs',
          nodeId: node.id,
          field: 'testEvidenceRefs',
        }));
      }
      if ((lifecycleState === 'observed' || lifecycleState === 'candidate') && node.cataloged === true) {
        findings.push(publicFinding({
          reasonCode: 'graph-observed-candidate-promoted-without-verification',
          message: 'Observed or candidate EndpointNode must not be treated as cataloged',
          nodeId: node.id,
          field: 'cataloged',
        }));
      }
    }
  }

  const report = {
    schemaVersion: GRAPH_VALIDATION_REPORT_SCHEMA_VERSION,
    graphVersion: graph.graphVersion,
    result: findings.length > 0 ? 'failed' : 'passed',
    findings,
  };
  assertGraphValidationReportCompatible(report);
  return report;
}

/** @param {Record<string, any>} [graph] */
export function assertSiteCapabilityGraphValid(graph = {}) {
  const report = validateSiteCapabilityGraph(graph);
  if (report.result !== 'passed') {
    const first = report.findings[0];
    throw new Error(`${first.reasonCode}: ${first.message}`);
  }
  return true;
}

function graphNodesById(graph) {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

function matchesSite(node, siteId) {
  if (!normalizeText(siteId)) {
    return true;
  }
  return node.siteKey === siteId || node.id === siteId;
}

function graphQueryResult(graph, queryName, items) {
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: graph.graphVersion,
    queryName,
    items: cloneDescriptor(items),
  };
  assertGraphQueryResultCompatible(result);
  return result;
}

function assertQueryableGraph(graph) {
  assertSiteCapabilityGraphValid(graph);
  return graph;
}

/** @param {Record<string, any>} [graph] */
export function listGraphSites(graph = {}) {
  const validGraph = assertQueryableGraph(graph);
  return graphQueryResult(
    validGraph,
    'listSites',
    validGraph.nodes.filter((node) => node.type === 'SiteNode'),
  );
}

/** @param {Record<string, any>} [graph] */
// @ts-ignore
export function listGraphCapabilities(graph = {}, siteId) {
  const validGraph = assertQueryableGraph(graph);
  return graphQueryResult(
    validGraph,
    'listCapabilities',
    validGraph.nodes.filter((node) => node.type === 'CapabilityNode' && matchesSite(node, siteId)),
  );
}

/** @param {Record<string, any>} [graph] */
// @ts-ignore
export function getGraphCapability(graph = {}, capabilityId) {
  const validGraph = assertQueryableGraph(graph);
  return graphQueryResult(
    validGraph,
    'getCapability',
    validGraph.nodes.filter((node) => node.type === 'CapabilityNode' && node.id === capabilityId),
  );
}

/** @param {Record<string, any>} [graph] */
// @ts-ignore
export function getGraphRoutes(graph = {}, capabilityId) {
  const validGraph = assertQueryableGraph(graph);
  const nodesById = graphNodesById(validGraph);
  const capability = nodesById.get(capabilityId);
  const routes = capability?.type === 'CapabilityNode'
    ? (capability.routeRefs ?? []).map((routeRef) => nodesById.get(routeRef)).filter(Boolean)
    : [];
  return graphQueryResult(validGraph, 'getRoutes', routes);
}

/** @param {Record<string, any>} [graph] */
// @ts-ignore
export function getGraphRequirements(graph = {}, capabilityId) {
  const validGraph = assertQueryableGraph(graph);
  const nodesById = graphNodesById(validGraph);
  const capability = nodesById.get(capabilityId);
  if (!capability || capability.type !== 'CapabilityNode') {
    return graphQueryResult(validGraph, 'getRequirements', []);
  }

  const requirementRefs = [
    ...(capability.authRequirementRefs ?? []),
    ...(capability.sessionRequirementRefs ?? []),
    capability.riskPolicyRef,
  ].filter(Boolean);

  const requirements = requirementRefs
    .map((ref) => nodesById.get(ref))
    .filter(Boolean);

  return graphQueryResult(validGraph, 'getRequirements', requirements);
}

/** @param {Record<string, any>} [graph] */
// @ts-ignore
export function getGraphEndpointsByLifecycleState(graph = {}, siteId, lifecycleState) {
  const validGraph = assertQueryableGraph(graph);
  assertEnumValue(
    lifecycleState,
    GRAPH_ENDPOINT_LIFECYCLE_STATES,
    'lifecycleState',
    'GraphEndpointLifecycleQuery',
  );
  return graphQueryResult(
    validGraph,
    'getEndpointsByLifecycleState',
    validGraph.nodes.filter((node) => (
      node.type === 'EndpointNode'
        && matchesSite(node, siteId)
        && node.lifecycleState === lifecycleState
    )),
  );
}

/** @param {Record<string, any>} [graph] */
// @ts-ignore
export function getGraphFailureModesByReasonCode(graph = {}, reasonCode) {
  const validGraph = assertQueryableGraph(graph);
  const normalizedReasonCode = assertRequiredText(
    reasonCode,
    'reasonCode',
    'GraphFailureModeReasonCodeQuery',
  );
  return graphQueryResult(validGraph, 'getFailureModesByReasonCode', validGraph.nodes.filter(
    (node) => node.type === 'FailureModeNode' && node.reasonCode === normalizedReasonCode,
  ));
}

/** @param {Record<string, any>} [graph] */
// @ts-ignore
export function getGraphFailureModesByArtifactWriteAllowed(graph = {}, artifactWriteAllowed) {
  const validGraph = assertQueryableGraph(graph);
  assertBoolean(
    artifactWriteAllowed,
    'artifactWriteAllowed',
    'GraphFailureModeArtifactWriteAllowedQuery',
  );
  return graphQueryResult(validGraph, 'getFailureModesByArtifactWriteAllowed', validGraph.nodes.filter(
    (node) => node.type === 'FailureModeNode' && node.artifactWriteAllowed === artifactWriteAllowed,
  ));
}

/** @param {Record<string, any>} [graph] */
// @ts-ignore
export function getGraphFailureModesByManualRecoveryRequired(graph = {}, manualRecoveryRequired) {
  const validGraph = assertQueryableGraph(graph);
  assertBoolean(
    manualRecoveryRequired,
    'manualRecoveryRequired',
    'GraphFailureModeManualRecoveryRequiredQuery',
  );
  return graphQueryResult(validGraph, 'getFailureModesByManualRecoveryRequired', validGraph.nodes.filter(
    (node) => node.type === 'FailureModeNode' && node.manualRecoveryRequired === manualRecoveryRequired,
  ));
}

/** @param {Record<string, any>} [graph] */
// @ts-ignore
export function getGraphFailureModesByCooldownRequired(graph = {}, cooldownRequired) {
  const validGraph = assertQueryableGraph(graph);
  assertBoolean(
    cooldownRequired,
    'cooldownRequired',
    'GraphFailureModeCooldownRequiredQuery',
  );
  return graphQueryResult(validGraph, 'getFailureModesByCooldownRequired', validGraph.nodes.filter(
    (node) => node.type === 'FailureModeNode' && node.cooldownRequired === cooldownRequired,
  ));
}

/** @param {Record<string, any>} [graph] */
// @ts-ignore
export function getGraphFailureModesByDegradable(graph = {}, degradable) {
  const validGraph = assertQueryableGraph(graph);
  assertBoolean(
    degradable,
    'degradable',
    'GraphFailureModeDegradableQuery',
  );
  return graphQueryResult(validGraph, 'getFailureModesByDegradable', validGraph.nodes.filter(
    (node) => node.type === 'FailureModeNode' && node.degradable === degradable,
  ));
}

/** @param {Record<string, any>} [graph] */
// @ts-ignore
export function getGraphFailureModesByCatalogAction(graph = {}, catalogAction) {
  const validGraph = assertQueryableGraph(graph);
  const normalizedCatalogAction = assertRequiredText(
    catalogAction,
    'catalogAction',
    'GraphFailureModeCatalogActionQuery',
  );
  if (!FAILURE_MODE_CATALOG_ACTIONS.includes(normalizedCatalogAction)) {
    throw new Error('GraphFailureModeCatalogActionQuery catalogAction is unsupported');
  }
  return graphQueryResult(validGraph, 'getFailureModesByCatalogAction', validGraph.nodes.filter(
    (node) => node.type === 'FailureModeNode' && node.catalogAction === normalizedCatalogAction,
  ));
}

function endpointReferencesNode(endpoint, nodeId) {
  return endpoint.id === nodeId
    || (endpoint.routeRefs ?? []).includes(nodeId)
    || (endpoint.capabilityRefs ?? []).includes(nodeId)
    || endpoint.authRequirementRef === nodeId
    || endpoint.sessionRequirementRef === nodeId
    || endpoint.signerRef === nodeId
    || endpoint.requestSchemaRef === nodeId
    || endpoint.responseSchemaRef === nodeId
    || endpoint.riskPolicyRef === nodeId
    || endpoint.versionRef === nodeId;
}

function routeReferencesNode(route, nodeId) {
  return route.id === nodeId
    || (route.capabilityRefs ?? []).includes(nodeId)
    || (route.fallbackRouteRefs ?? []).includes(nodeId)
    || route.riskPolicyRef === nodeId;
}

function addCapabilityById(target, nodesById, capabilityId) {
  const capability = nodesById.get(capabilityId);
  if (capability?.type === 'CapabilityNode') {
    target.set(capability.id, capability);
  }
}

/** @param {Record<string, any>} [graph] */
// @ts-ignore
export function getAffectedGraphCapabilities(graph = {}, nodeId) {
  const validGraph = assertQueryableGraph(graph);
  const nodesById = graphNodesById(validGraph);
  const affected = new Map();

  for (const capability of validGraph.nodes.filter((node) => node.type === 'CapabilityNode')) {
    if (
      capability.id === nodeId
      || (capability.routeRefs ?? []).includes(nodeId)
      || (capability.authRequirementRefs ?? []).includes(nodeId)
      || (capability.sessionRequirementRefs ?? []).includes(nodeId)
      || capability.riskPolicyRef === nodeId
    ) {
      affected.set(capability.id, capability);
    }
  }

  for (const route of validGraph.nodes.filter((node) => node.type === 'RouteNode')) {
    if (routeReferencesNode(route, nodeId)) {
      for (const capabilityId of route.capabilityRefs ?? []) {
        addCapabilityById(affected, nodesById, capabilityId);
      }
    }
  }

  for (const endpoint of validGraph.nodes.filter((node) => node.type === 'EndpointNode')) {
    if (endpointReferencesNode(endpoint, nodeId)) {
      for (const capabilityId of endpoint.capabilityRefs ?? []) {
        addCapabilityById(affected, nodesById, capabilityId);
      }
    }
  }

  for (const edge of validGraph.edges) {
    if (edge.from === nodeId) {
      addCapabilityById(affected, nodesById, edge.to);
    }
    if (edge.to === nodeId) {
      addCapabilityById(affected, nodesById, edge.from);
    }
  }

  return graphQueryResult(validGraph, 'getAffectedCapabilities', [...affected.values()]);
}

/** @param {Record<string, any>} [graph] */
// @ts-ignore
export function getGraphCapabilitiesRequiringAuth(graph = {}, siteId) {
  const validGraph = assertQueryableGraph(graph);
  const nodesById = graphNodesById(validGraph);
  const affected = new Map();

  for (const capability of validGraph.nodes.filter((node) => node.type === 'CapabilityNode' && matchesSite(node, siteId))) {
    const authRefs = capability.authRequirementRefs ?? [];
    if (authRefs.some((ref) => nodesById.get(ref)?.authKind !== 'none')) {
      affected.set(capability.id, capability);
    }
  }

  for (const endpoint of validGraph.nodes.filter((node) => node.type === 'EndpointNode' && matchesSite(node, siteId))) {
    const authRequirement = nodesById.get(endpoint.authRequirementRef);
    if (endpoint.requiresCookie === true || authRequirement?.authKind !== 'none') {
      for (const capabilityId of endpoint.capabilityRefs ?? []) {
        addCapabilityById(affected, nodesById, capabilityId);
      }
    }
  }

  return graphQueryResult(validGraph, 'getCapabilitiesRequiringAuth', [...affected.values()]);
}

/** @param {Record<string, any>} [graph] */
// @ts-ignore
export function getGraphCapabilitiesUsingWbi(graph = {}, siteId) {
  const validGraph = assertQueryableGraph(graph);
  const nodesById = graphNodesById(validGraph);
  const affected = new Map();

  for (const endpoint of validGraph.nodes.filter((node) => node.type === 'EndpointNode' && matchesSite(node, siteId))) {
    const signer = nodesById.get(endpoint.signerRef);
    if (endpoint.requiresWbi === true || signer?.signerKind === 'wbi') {
      for (const capabilityId of endpoint.capabilityRefs ?? []) {
        addCapabilityById(affected, nodesById, capabilityId);
      }
    }
  }

  return graphQueryResult(validGraph, 'getCapabilitiesUsingWbi', [...affected.values()]);
}

/** @param {Record<string, any>} [graph] */
// @ts-ignore
export function getGraphCapabilitiesByRiskLevel(graph = {}, siteId, riskLevel) {
  const validGraph = assertQueryableGraph(graph);
  const nodesById = graphNodesById(validGraph);
  const affected = new Map();

  for (const capability of validGraph.nodes.filter((node) => node.type === 'CapabilityNode' && matchesSite(node, siteId))) {
    if (nodesById.get(capability.riskPolicyRef)?.state === riskLevel) {
      affected.set(capability.id, capability);
    }
  }

  for (const endpoint of validGraph.nodes.filter((node) => node.type === 'EndpointNode' && matchesSite(node, siteId))) {
    if (nodesById.get(endpoint.riskPolicyRef)?.state === riskLevel) {
      for (const capabilityId of endpoint.capabilityRefs ?? []) {
        addCapabilityById(affected, nodesById, capabilityId);
      }
    }
  }

  return graphQueryResult(validGraph, 'getCapabilitiesByRiskLevel', [...affected.values()]);
}

function graphPlanResult(graph, fields) {
  return cloneDescriptor({
    schemaVersion: 1,
    graphVersion: graph.graphVersion,
    ...fields,
  });
}

const GRAPH_LAYER_DESIGN_SOURCE_REFERENCES = Object.freeze([
  Object.freeze({
    path: 'AGENTS.md',
    role: 'current-layer-boundary-reference',
    status: 'present-reference',
    verified: false,
    note: 'Local execution and safety guardrail reference.',
  }),
  Object.freeze({
    path: 'README.md',
    role: 'current-project-overview-reference',
    status: 'present-reference',
    verified: false,
    note: 'Project overview, CLI surface, layout, and verification command reference.',
  }),
]);

/** @param {Record<string, any>} [graph] */
// @ts-ignore
export function planGraphCapabilityRoute(graph = {}, capabilityId, context = {}) {
  const validGraph = assertQueryableGraph(graph);
  const nodesById = graphNodesById(validGraph);
  const capability = nodesById.get(capabilityId);
  if (!capability || capability.type !== 'CapabilityNode') {
    return graphPlanResult(validGraph, {
      result: 'blocked',
      capabilityId,
      route: null,
      reasonCode: 'graph-planner-no-route',
    });
  }

  const routes = getGraphRoutes(validGraph, capabilityId).items;
  if (routes.length === 0) {
    return graphPlanResult(validGraph, {
      result: 'blocked',
      capabilityId,
      route: null,
      reasonCode: 'graph-planner-no-route',
    });
  }

  const allowedRouteIds = Array.isArray(context.availableRouteIds)
    ? new Set(context.availableRouteIds)
    : null;
  const contextRoutes = allowedRouteIds
    ? routes.filter((route) => allowedRouteIds.has(route.id))
    : routes;
  if (contextRoutes.length === 0) {
    return graphPlanResult(validGraph, {
      result: 'blocked',
      capabilityId,
      route: null,
      reasonCode: 'graph-planner-context-unsatisfied',
    });
  }

  const [route] = [...contextRoutes].sort((left, right) => {
    const leftPriority = Number.isFinite(Number(left.priority)) ? Number(left.priority) : 100;
    const rightPriority = Number.isFinite(Number(right.priority)) ? Number(right.priority) : 100;
    return leftPriority - rightPriority;
  });

  const riskPolicy = nodesById.get(route.riskPolicyRef);
  if (
    Array.isArray(context.blockedRiskStates)
    && context.blockedRiskStates.includes(riskPolicy?.state)
  ) {
    return graphPlanResult(validGraph, {
      result: 'blocked',
      capabilityId,
      route: null,
      reasonCode: 'graph-route-forbidden-by-risk',
      riskState: riskPolicy?.state,
    });
  }

  return graphPlanResult(validGraph, {
    result: 'planned',
    capabilityId,
    route,
    reasonCode: null,
  });
}

/** @param {Record<string, any>} [graph] */
export function generateGraphDocsSummary(graph = {}) {
  const validGraph = assertQueryableGraph(graph);
  const nodesById = graphNodesById(validGraph);
  const capabilities = validGraph.nodes.filter((node) => node.type === 'CapabilityNode');
  const routes = validGraph.nodes.filter((node) => node.type === 'RouteNode');
  const endpoints = validGraph.nodes.filter((node) => node.type === 'EndpointNode');
  const signers = validGraph.nodes.filter((node) => node.type === 'SignerNode');
  const failureModes = validGraph.nodes.filter((node) => node.type === 'FailureModeNode');
  const testableNodes = validGraph.nodes.filter((node) => Array.isArray(node.testEvidenceRefs));
  const dependencyMap = validGraph.edges.map((edge) => ({
    id: edge.id,
    type: edge.type,
    from: edge.from,
    to: edge.to,
  }));
  const dependencyMapByEdgeType = [...dependencyMap.reduce((groups, edge) => {
    const group = groups.get(edge.type) ?? {
      edgeType: edge.type,
      edgeCount: 0,
      edgeIds: [],
    };
    group.edgeCount += 1;
    group.edgeIds.push(edge.id);
    groups.set(edge.type, group);
    return groups;
  }, new Map()).values()];

  const summary = {
    schemaVersion: GRAPH_DOCS_SUMMARY_SCHEMA_VERSION,
    graphVersion: validGraph.graphVersion,
    artifactFamily: 'site-capability-graph-docs',
    redactionRequired: true,
    sections: {
      capabilityList: capabilities.map((capability) => ({
        id: capability.id,
        siteKey: capability.siteKey,
        capabilityKey: capability.capabilityKey,
        capabilityFamily: capability.capabilityFamily,
        mode: capability.mode,
        requiresApproval: capability.requiresApproval,
        routeRefs: capability.routeRefs ?? [],
        riskPolicyRef: capability.riskPolicyRef,
        testEvidenceRefs: capability.testEvidenceRefs ?? [],
      })),
      dependencyMap,
      dependencyMapByEdgeType,
      routeDependencySummary: routes.map((route) => ({
        routeId: route.id,
        siteKey: route.siteKey,
        routeKind: route.routeKind,
        pageType: route.pageType,
        capabilityRefs: route.capabilityRefs ?? [],
        fallbackRouteRefs: route.fallbackRouteRefs ?? [],
        adapterRef: route.adapterRef ? cloneDescriptor(route.adapterRef) : null,
        riskPolicyRef: route.riskPolicyRef,
        testEvidenceRefs: route.testEvidenceRefs ?? [],
      })),
      endpointImpactMap: endpoints.map((endpoint) => ({
        endpointId: endpoint.id,
        siteKey: endpoint.siteKey,
        endpointKind: endpoint.endpointKind,
        lifecycleState: endpoint.lifecycleState,
        methodFamily: endpoint.methodFamily,
        routeRefs: endpoint.routeRefs ?? [],
        capabilityRefs: endpoint.capabilityRefs ?? [],
        authRequirementRef: endpoint.authRequirementRef,
        sessionRequirementRef: endpoint.sessionRequirementRef,
        signerRef: endpoint.signerRef,
        requestSchemaRef: endpoint.requestSchemaRef,
        responseSchemaRef: endpoint.responseSchemaRef,
        riskPolicyRef: endpoint.riskPolicyRef,
        versionRef: endpoint.versionRef,
        requiresCookie: endpoint.requiresCookie === true,
        requiresWbi: endpoint.requiresWbi === true,
        testEvidenceRefs: endpoint.testEvidenceRefs ?? [],
      })),
      authRequirementSummary: capabilities.map((capability) => ({
        capabilityId: capability.id,
        authRequirementRefs: capability.authRequirementRefs ?? [],
        authRequiredForRefs: [...new Set((capability.authRequirementRefs ?? [])
          .flatMap((authRequirementRef) => {
            const authRequirement = nodesById.get(authRequirementRef);
            return authRequirement?.type === 'AuthRequirementNode'
              ? authRequirement.requiredFor ?? []
              : [];
          }))],
        sessionRequirementRefs: capability.sessionRequirementRefs ?? [],
      })).filter((entry) => entry.authRequirementRefs.length > 0 || entry.sessionRequirementRefs.length > 0),
      signerDependencySummary: signers.map((signer) => ({
        signerId: signer.id,
        siteKey: signer.siteKey,
        signerKind: signer.signerKind,
        supportedEndpointRefs: signer.supportedEndpointRefs ?? [],
        failureModeRefs: signer.failureModeRefs ?? [],
        endpointSignerRefs: endpoints
          .filter((endpoint) => endpoint.signerRef === signer.id)
          .map((endpoint) => endpoint.id),
      })),
      riskPolicySummary: [
        ...capabilities.map((capability) => ({
          ownerType: 'CapabilityNode',
          ownerId: capability.id,
          riskPolicyRef: capability.riskPolicyRef,
          riskState: nodesById.get(capability.riskPolicyRef)?.state ?? null,
          riskPolicyCapabilityRefs: capabilities
            .filter((candidateCapability) => candidateCapability.riskPolicyRef === capability.riskPolicyRef)
            .map((candidateCapability) => candidateCapability.id),
          riskPolicyEndpointRefs: endpoints
            .filter((endpoint) => endpoint.riskPolicyRef === capability.riskPolicyRef)
            .map((endpoint) => endpoint.id),
        })),
        ...routes.map((route) => ({
          ownerType: 'RouteNode',
          ownerId: route.id,
          riskPolicyRef: route.riskPolicyRef,
          riskState: nodesById.get(route.riskPolicyRef)?.state ?? null,
          riskPolicyCapabilityRefs: capabilities
            .filter((capability) => capability.riskPolicyRef === route.riskPolicyRef)
            .map((capability) => capability.id),
          riskPolicyEndpointRefs: endpoints
            .filter((endpoint) => endpoint.riskPolicyRef === route.riskPolicyRef)
            .map((endpoint) => endpoint.id),
        })),
        ...endpoints.map((endpoint) => ({
          ownerType: 'EndpointNode',
          ownerId: endpoint.id,
          riskPolicyRef: endpoint.riskPolicyRef,
          riskState: nodesById.get(endpoint.riskPolicyRef)?.state ?? null,
          riskPolicyCapabilityRefs: capabilities
            .filter((capability) => capability.riskPolicyRef === endpoint.riskPolicyRef)
            .map((capability) => capability.id),
          riskPolicyEndpointRefs: endpoints
            .filter((candidateEndpoint) => candidateEndpoint.riskPolicyRef === endpoint.riskPolicyRef)
            .map((candidateEndpoint) => candidateEndpoint.id),
        })),
      ],
      failureModeSummary: failureModes.map((failureMode) => ({
        failureModeId: failureMode.id,
        reasonCode: failureMode.reasonCode,
        retryable: failureMode.retryable === true,
        cooldownRequired: failureMode.cooldownRequired === true,
        isolationRequired: failureMode.isolationRequired === true,
        manualRecoveryRequired: failureMode.manualRecoveryRequired === true,
        degradable: failureMode.degradable === true,
        artifactWriteAllowed: failureMode.artifactWriteAllowed === true,
        ...(failureMode.catalogAction === undefined ? {} : { catalogAction: failureMode.catalogAction }),
      })),
      agentExposedCapabilityList: capabilities
        .filter((capability) => capability.agentExposed === true)
        .map((capability) => ({
          id: capability.id,
          siteKey: capability.siteKey,
          capabilityKey: capability.capabilityKey,
          testEvidenceRefs: capability.testEvidenceRefs ?? [],
        })),
      testCoverageSummary: testableNodes.map((node) => ({
        nodeId: node.id,
        nodeType: node.type,
        testEvidenceRefs: node.testEvidenceRefs ?? [],
      })),
      layerDesignSourceReferences: cloneDescriptor(GRAPH_LAYER_DESIGN_SOURCE_REFERENCES),
    },
  };

  assertGraphDocsSummaryCompatible(summary);
  return cloneDescriptor(summary);
}

function normalizeStringList(value, label) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((entry) => assertRequiredText(entry, label, 'GraphMigrationReport'));
}

/**
 * @param {Record<string, any>} [graph]
 * @param {Record<string, any>} options
 */
export function generateGraphMigrationReport(graph = {}, {
  statusSummary = {},
  knownGaps = [],
  nextTasks = [],
} = {}) {
  const validGraph = assertQueryableGraph(graph);
  const sites = validGraph.nodes.filter((node) => node.type === 'SiteNode');
  const capabilities = validGraph.nodes.filter((node) => node.type === 'CapabilityNode');
  const routes = validGraph.nodes.filter((node) => node.type === 'RouteNode');
  const endpoints = validGraph.nodes.filter((node) => node.type === 'EndpointNode');
  const tests = validGraph.nodes.filter((node) => node.type === 'TestEvidenceNode' || node.type === 'TestNode');
  const report = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: validGraph.graphVersion,
    queryName: 'generateGraphMigrationReport',
    artifactFamily: 'site-capability-graph-migration-report',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      graphVersion: validGraph.graphVersion,
      totals: {
        siteCount: sites.length,
        capabilityCount: capabilities.length,
        routeCount: routes.length,
        endpointCount: endpoints.length,
        authRequiredCapabilityCount: capabilities
          .filter((capability) => (capability.authRequirementRefs ?? []).length > 0)
          .length,
        testEvidenceNodeCount: tests.length,
      },
      statusSummary: cloneDescriptor(statusSummary),
      knownGaps: normalizeStringList(knownGaps, 'knownGaps'),
      nextTasks: normalizeStringList(nextTasks, 'nextTasks'),
    }],
  };
  assertGraphQueryResultCompatible(report);
  assertNoForbiddenPatterns(report);
  return cloneDescriptor(report);
}

const LAYER_SOURCE_RISK_POLICY_INVENTORY_QUERY_NAME = 'createLayerSourceRiskPolicyInventorySummary';
const LAYER_SOURCE_RISK_POLICY_INVENTORY_ARTIFACT_FAMILY = 'site-capability-graph-risk-policy-inventory-summary';
const LAYER_SOURCE_AUTH_SESSION_REQUIREMENT_INVENTORY_QUERY_NAME =
  'createLayerSourceAuthSessionRequirementInventorySummary';
const LAYER_SOURCE_AUTH_SESSION_REQUIREMENT_INVENTORY_ARTIFACT_FAMILY =
  'site-capability-graph-auth-session-requirement-inventory-summary';
const LAYER_SOURCE_SIGNER_DEPENDENCY_INVENTORY_QUERY_NAME =
  'createLayerSourceSignerDependencyInventorySummary';
const LAYER_SOURCE_SIGNER_DEPENDENCY_INVENTORY_ARTIFACT_FAMILY =
  'site-capability-graph-signer-dependency-inventory-summary';
const LAYER_SOURCE_SITE_CAPABILITIES_REF = 'config/site-capabilities.json';
const LAYER_SOURCE_SITE_REGISTRY_REF = 'config/site-registry.json';
const LAYER_SOURCE_BILIBILI_ADAPTER_REF = 'src/sites/adapters/bilibili.mjs';
const LAYER_SOURCE_RISK_POLICY_INVENTORY_RUNTIME_WRITE_FIELD_KEYS = Object.freeze([
  'repoWrite',
  'repoWriteEnabled',
  'filesystemWrite',
  'write',
  'writeEnabled',
  'writePath',
  'writer',
]);
const LAYER_SOURCE_RISK_POLICY_INVENTORY_RUNTIME_WRITE_FIELD_KEY_SET = new Set(
  LAYER_SOURCE_RISK_POLICY_INVENTORY_RUNTIME_WRITE_FIELD_KEYS.map((key) => normalizeKey(key)),
);
const LAYER_SOURCE_AUTH_SESSION_REQUIREMENT_INVENTORY_FORBIDDEN_FIELD_KEYS = Object.freeze([
  ...LAYER_SOURCE_RISK_POLICY_INVENTORY_RUNTIME_WRITE_FIELD_KEYS,
  'artifactPath',
  'artifactPayload',
  'authorization',
  'authorizationHeader',
  'browserContext',
  'browserProfile',
  'browserProfilePath',
  'cookie',
  'cookies',
  'csrf',
  'csrfToken',
  'deviceFingerprint',
  'headers',
  'ipAddress',
  'networkIdentifier',
  'page',
  'profilePath',
  'rawArtifact',
  'rawCookie',
  'rawSession',
  'rawSessionMaterial',
  'rawToken',
  'requestHeaders',
  'responseHeaders',
  'SESSDATA',
  'sessionId',
  'sessionMaterial',
  'sessionView',
  'token',
  'userDataDir',
]);
const LAYER_SOURCE_AUTH_SESSION_REQUIREMENT_INVENTORY_FORBIDDEN_FIELD_KEY_SET = new Set(
  LAYER_SOURCE_AUTH_SESSION_REQUIREMENT_INVENTORY_FORBIDDEN_FIELD_KEYS.map((key) => normalizeKey(key)),
);
const LAYER_SOURCE_SIGNER_DEPENDENCY_INVENTORY_FORBIDDEN_FIELD_KEYS = Object.freeze([
  ...LAYER_SOURCE_RISK_POLICY_INVENTORY_RUNTIME_WRITE_FIELD_KEYS,
  'authorization',
  'authorizationHeader',
  'browserProfile',
  'browserProfilePath',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'csrf',
  'csrfToken',
  'imgKey',
  'mixinKey',
  'profilePath',
  'rawBrowserProfile',
  'rawCookie',
  'rawCredential',
  'rawCredentials',
  'rawKey',
  'rawSession',
  'rawSessionMaterial',
  'rawSignerKey',
  'rawToken',
  'signedUrl',
  'signedURL',
  'signerExecution',
  'signerExecutor',
  'signerRuntime',
  'signingExecution',
  'signingExecutor',
  'sessionId',
  'sessionView',
  'SESSDATA',
  'subKey',
  'token',
]);
const LAYER_SOURCE_SIGNER_DEPENDENCY_INVENTORY_FORBIDDEN_FIELD_KEY_SET = new Set(
  LAYER_SOURCE_SIGNER_DEPENDENCY_INVENTORY_FORBIDDEN_FIELD_KEYS.map((key) => normalizeKey(key)),
);

function isLayerSourceRiskPolicyInventoryRuntimeWriteFieldKey(key) {
  const normalizedKey = normalizeKey(key);
  return normalizedKey.includes('runtime')
    || LAYER_SOURCE_RISK_POLICY_INVENTORY_RUNTIME_WRITE_FIELD_KEY_SET.has(normalizedKey)
    || normalizedKey.endsWith('write')
    || normalizedKey.endsWith('writeenabled');
}

function assertNoLayerSourceRiskPolicyInventoryRuntimeWriteFields(
  value,
  label = 'LayerSourceRiskPolicyInventorySummary',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoLayerSourceRiskPolicyInventoryRuntimeWriteFields(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (isLayerSourceRiskPolicyInventoryRuntimeWriteFieldKey(key)) {
      throw new Error(`${label} must remain descriptor-only and must not expose runtime/write field: ${path}.${key}`);
    }
    assertNoLayerSourceRiskPolicyInventoryRuntimeWriteFields(entry, label, `${path}.${key}`);
  }
  return true;
}

function isLayerSourceAuthSessionRequirementInventoryForbiddenFieldKey(key) {
  const normalizedKey = normalizeKey(key);
  return normalizedKey.includes('runtime')
    || LAYER_SOURCE_AUTH_SESSION_REQUIREMENT_INVENTORY_FORBIDDEN_FIELD_KEY_SET.has(normalizedKey)
    || normalizedKey.endsWith('write')
    || normalizedKey.endsWith('writeenabled')
    || normalizedKey.endsWith('token')
    || normalizedKey.endsWith('cookie')
    || normalizedKey.endsWith('headers');
}

function assertNoLayerSourceAuthSessionRequirementInventoryRuntimeMaterialFields(
  value,
  label = 'LayerSourceAuthSessionRequirementInventorySummary',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoLayerSourceAuthSessionRequirementInventoryRuntimeMaterialFields(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (isLayerSourceAuthSessionRequirementInventoryForbiddenFieldKey(key)) {
      throw new Error(`${label} must remain descriptor-only and must not expose runtime/write/session material field: ${path}.${key}`);
    }
    assertNoLayerSourceAuthSessionRequirementInventoryRuntimeMaterialFields(entry, label, `${path}.${key}`);
  }
  return true;
}

function isLayerSourceSignerDependencyInventoryForbiddenFieldKey(key) {
  const normalizedKey = normalizeKey(key);
  return normalizedKey.includes('runtime')
    || normalizedKey.includes('credential')
    || normalizedKey.includes('execution')
    || normalizedKey.includes('signedurl')
    || normalizedKey.includes('signerexecution')
    || normalizedKey.includes('signingexecution')
    || LAYER_SOURCE_SIGNER_DEPENDENCY_INVENTORY_FORBIDDEN_FIELD_KEY_SET.has(normalizedKey)
    || normalizedKey.endsWith('write')
    || normalizedKey.endsWith('writeenabled')
    || normalizedKey.endsWith('token')
    || normalizedKey.endsWith('cookie');
}

function assertNoLayerSourceSignerDependencyInventoryRuntimeMaterialFields(
  value,
  label = 'LayerSourceSignerDependencyInventorySummary',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoLayerSourceSignerDependencyInventoryRuntimeMaterialFields(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (isLayerSourceSignerDependencyInventoryForbiddenFieldKey(key)) {
      throw new Error(`${label} must remain descriptor-only and must not expose signer execution, signed URL, raw signer material, runtime, or write field: ${path}.${key}`);
    }
    assertNoLayerSourceSignerDependencyInventoryRuntimeMaterialFields(entry, label, `${path}.${key}`);
  }
  return true;
}

function normalizeLayerSourceSites(source, label) {
  if (source === undefined || source === null) {
    return {};
  }
  assertPlainObject(source, label);
  if (source.sites === undefined || source.sites === null) {
    return {};
  }
  assertPlainObject(source.sites, `${label}.sites`);
  return source.sites;
}

function normalizeLayerStringList(value, label) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((entry) => assertRequiredText(entry, label, 'LayerSourceRiskPolicyInventorySummary'));
}

function uniqueLayerStrings(values) {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function sourceRiskPolicyGraphVersion(siteCapabilities, siteRegistry) {
  const siteCapabilitiesVersion = normalizeText(siteCapabilities?.version) ?? 'unknown';
  const siteRegistryVersion = normalizeText(siteRegistry?.version) ?? 'unknown';
  return `layer-source-risk-policy-inventory:${siteCapabilitiesVersion}:${siteRegistryVersion}`;
}

function sourceAuthSessionRequirementGraphVersion(siteCapabilities, siteRegistry) {
  const siteCapabilitiesVersion = normalizeText(siteCapabilities?.version) ?? 'unknown';
  const siteRegistryVersion = normalizeText(siteRegistry?.version) ?? 'unknown';
  return `layer-source-auth-session-requirement-inventory:${siteCapabilitiesVersion}:${siteRegistryVersion}`;
}

function sourceSignerDependencyGraphVersion(siteCapabilities, siteRegistry) {
  const siteCapabilitiesVersion = normalizeText(siteCapabilities?.version) ?? 'unknown';
  const siteRegistryVersion = normalizeText(siteRegistry?.version) ?? 'unknown';
  return `layer-source-signer-dependency-inventory:${siteCapabilitiesVersion}:${siteRegistryVersion}`;
}

function normalizeLayerSiteIdentity(hostKey, capabilitySite, registrySite) {
  const host = assertRequiredText(
    capabilitySite?.host ?? registrySite?.host ?? hostKey,
    'host',
    'LayerSourceRiskPolicyInventorySummary',
  );
  const siteKey = assertRequiredText(
    capabilitySite?.siteKey ?? registrySite?.siteKey ?? host,
    'siteKey',
    'LayerSourceRiskPolicyInventorySummary',
  );
  return { host, siteKey };
}

function collectLayerReasonCodeRefs(capabilitySite, registrySite) {
  const reasonCodes = [
    ...normalizeLayerStringList(capabilitySite?.reasonCodes, 'siteCapabilities.reasonCodes'),
    ...normalizeLayerStringList(registrySite?.reasonCodes, 'siteRegistry.reasonCodes'),
  ];
  for (const source of [
    capabilitySite?.downloader,
    capabilitySite?.downloadSupport,
    registrySite?.downloader,
    registrySite?.downloadSupport,
  ]) {
    if (!isPlainObject(source)) {
      continue;
    }
    reasonCodes.push(
      source.unsupportedReasonCode,
      source.unsupportedLiveReasonCode,
      source.liveAccessStatus,
      source.status === 'not_supported' ? 'downloader_not_allowed' : undefined,
      source.supported === false ? 'downloader_not_allowed' : undefined,
    );
  }
  reasonCodes.push(
    capabilitySite?.siteAccessStatus,
    registrySite?.siteAccessStatus,
  );
  return uniqueLayerStrings(reasonCodes);
}

function collectLayerRiskSignalRefs(capabilitySite, registrySite) {
  const signalRefs = [
    capabilitySite?.siteAccessStatus,
    registrySite?.siteAccessStatus,
  ];
  for (const source of [
    capabilitySite?.downloader,
    capabilitySite?.downloadSupport,
    registrySite?.downloader,
    registrySite?.downloadSupport,
  ]) {
    if (!isPlainObject(source)) {
      continue;
    }
    signalRefs.push(
      source.liveAccessStatus,
    );
  }
  return uniqueLayerStrings(signalRefs);
}

function deriveLayerRiskState(riskSignalRefs) {
  const statusText = [
    ...riskSignalRefs,
  ].map((value) => normalizeText(value)?.toLowerCase()).filter(Boolean).join(' ');
  if (/\bmanual[_-]?recovery\b/u.test(statusText)) {
    return 'manual_recovery_required';
  }
  if (/\brate[_-]?limited|cooldown\b/u.test(statusText)) {
    return 'rate_limited';
  }
  if (/\bcaptcha|challenge|cloudflare|risk[_-]?control\b/u.test(statusText)) {
    return 'captcha_required';
  }
  if (/\bauth|login|session[_-]?expired\b/u.test(statusText)) {
    return 'auth_expired';
  }
  if (/\bpermission|vip|paywall|age[_-]?gate|access[_-]?gate\b/u.test(statusText)) {
    return 'permission_denied';
  }
  if (/\bblocked|not[_-]?allowed|unsupported\b/u.test(statusText)) {
    return 'blocked';
  }
  return 'normal';
}

function createLayerSourceRiskPolicyInventoryItem(hostKey, capabilitySite, registrySite) {
  const { host, siteKey } = normalizeLayerSiteIdentity(hostKey, capabilitySite, registrySite);
  const allowedActions = uniqueLayerStrings([
    ...normalizeLayerStringList(capabilitySite?.safeActionKinds, 'siteCapabilities.safeActionKinds'),
    ...normalizeLayerStringList(registrySite?.safeActionKinds, 'siteRegistry.safeActionKinds'),
  ]);
  const blockedActions = uniqueLayerStrings([
    ...normalizeLayerStringList(capabilitySite?.approvalActionKinds, 'siteCapabilities.approvalActionKinds'),
    ...normalizeLayerStringList(registrySite?.approvalActionKinds, 'siteRegistry.approvalActionKinds'),
  ]);
  const reasonCodeRefs = collectLayerReasonCodeRefs(capabilitySite, registrySite);
  const riskSignalRefs = collectLayerRiskSignalRefs(capabilitySite, registrySite);
  const state = deriveLayerRiskState(riskSignalRefs);
  const sourceRefs = [
    capabilitySite ? LAYER_SOURCE_SITE_CAPABILITIES_REF : undefined,
    registrySite ? LAYER_SOURCE_SITE_REGISTRY_REF : undefined,
  ].filter(Boolean);
  const statusText = [...reasonCodeRefs, ...riskSignalRefs].join(' ').toLowerCase();
  return {
    id: `risk-policy:${siteKey}`,
    schemaVersion: GRAPH_NODE_SCHEMA_VERSION,
    type: 'RiskPolicyNode',
    host,
    siteKey,
    state,
    allowedActions,
    blockedActions,
    requiresApproval: blockedActions.length > 0,
    // @ts-ignore
    cooldownRequired: state === 'cooldown' || state === 'rate_limited' || /\bcooldown\b/u.test(statusText),
    // @ts-ignore
    isolationRequired: state === 'isolated' || /\bisolat/u.test(statusText),
    manualRecoveryRequired: state === 'manual_recovery_required' || state === 'captcha_required',
    degradable: state !== 'blocked',
    artifactWriteAllowed: false,
    reasonCodeRefs,
    sourceRefs,
  };
}

function collectLayerRequirementTargets(capabilitySite, registrySite, siteKey) {
  return uniqueLayerStrings([
    ...normalizeLayerStringList(capabilitySite?.capabilityFamilies, 'siteCapabilities.capabilityFamilies')
      .map((capabilityFamily) => `capability:${siteKey}:${capabilityFamily}`),
    ...normalizeLayerStringList(registrySite?.capabilityFamilies, 'siteRegistry.capabilityFamilies')
      .map((capabilityFamily) => `capability:${siteKey}:${capabilityFamily}`),
    ...normalizeLayerStringList(capabilitySite?.supportedIntents, 'siteCapabilities.supportedIntents')
      .map((intent) => `intent:${siteKey}:${intent}`),
    ...normalizeLayerStringList(registrySite?.downloadTaskTypes, 'siteRegistry.downloadTaskTypes')
      .map((taskType) => `download:${siteKey}:${taskType}`),
  ]);
}

function collectLayerAuthReasonCodeRefs(capabilitySite, registrySite) {
  return uniqueLayerStrings([
    ...collectLayerReasonCodeRefs(capabilitySite, registrySite),
  ].filter((reasonCode) => /\bauth|login|permission|vip|paywall|age[_-]?gate|access[_-]?gate\b/iu.test(reasonCode)));
}

function hasLayerAuthSurface(capabilitySite, registrySite) {
  const pageTypes = [
    ...normalizeLayerStringList(capabilitySite?.pageTypes, 'siteCapabilities.pageTypes'),
    ...normalizeLayerStringList(registrySite?.pageTypes, 'siteRegistry.pageTypes'),
  ];
  const supportedIntents = [
    ...normalizeLayerStringList(capabilitySite?.supportedIntents, 'siteCapabilities.supportedIntents'),
  ];
  const authPathPrefixes = [
    ...normalizeLayerStringList(capabilitySite?.urlFamily?.authPathPrefixes, 'siteCapabilities.urlFamily.authPathPrefixes'),
    ...normalizeLayerStringList(registrySite?.urlFamily?.authPathPrefixes, 'siteRegistry.urlFamily.authPathPrefixes'),
  ];
  return pageTypes.includes('auth-page')
    || supportedIntents.some((intent) => /\bauth|login\b/iu.test(intent))
    || authPathPrefixes.length > 0;
}

function deriveLayerSessionRequirement(capabilitySite, registrySite) {
  const downloadSessionRequirement = normalizeText(registrySite?.downloadSessionRequirement);
  if (['required', 'optional', 'none'].includes(downloadSessionRequirement)) {
    return downloadSessionRequirement;
  }
  for (const source of [
    capabilitySite?.downloader,
    capabilitySite?.downloadSupport,
    registrySite?.downloader,
    registrySite?.downloadSupport,
  ]) {
    if (isPlainObject(source) && source.requiresLogin === true) {
      return 'required';
    }
  }
  return 'none';
}

function createLayerSourceAuthRequirementInventoryItem(hostKey, capabilitySite, registrySite) {
  const { host, siteKey } = normalizeLayerSiteIdentity(hostKey, capabilitySite, registrySite);
  const sessionRequirement = deriveLayerSessionRequirement(capabilitySite, registrySite);
  const authRequired = sessionRequirement === 'required' || hasLayerAuthSurface(capabilitySite, registrySite);
  const requiredFor = collectLayerRequirementTargets(capabilitySite, registrySite, siteKey);
  const sourceRefs = [
    capabilitySite ? LAYER_SOURCE_SITE_CAPABILITIES_REF : undefined,
    registrySite ? LAYER_SOURCE_SITE_REGISTRY_REF : undefined,
  ].filter(Boolean);
  return {
    id: `auth-requirement:${siteKey}`,
    schemaVersion: GRAPH_NODE_SCHEMA_VERSION,
    type: 'AuthRequirementNode',
    host,
    siteKey,
    downloadSessionRequirement: sessionRequirement,
    authKind: authRequired ? 'login' : 'none',
    requiredFor: requiredFor.length ? requiredFor : [`site:${siteKey}`],
    proofType: 'layer-source-descriptor',
    allowedMaterial: authRequired ? ['redacted-login-state-descriptor'] : [],
    forbiddenMaterial: [
      'credential-material',
      'browser-profile-material',
      'session-material',
      'authorization-header-material',
    ],
    reasonCodeRefs: collectLayerAuthReasonCodeRefs(capabilitySite, registrySite),
    sourceRefs,
  };
}

function createLayerSourceSessionRequirementInventoryItem(hostKey, capabilitySite, registrySite) {
  const { host, siteKey } = normalizeLayerSiteIdentity(hostKey, capabilitySite, registrySite);
  const sessionRequirement = deriveLayerSessionRequirement(capabilitySite, registrySite);
  const authRequired = sessionRequirement === 'required' || hasLayerAuthSurface(capabilitySite, registrySite);
  const sourceRefs = [
    capabilitySite ? LAYER_SOURCE_SITE_CAPABILITIES_REF : undefined,
    registrySite ? LAYER_SOURCE_SITE_REGISTRY_REF : undefined,
  ].filter(Boolean);
  return {
    id: `session-requirement:${siteKey}`,
    schemaVersion: GRAPH_NODE_SCHEMA_VERSION,
    type: 'SessionRequirementNode',
    host,
    siteKey,
    downloadSessionRequirement: sessionRequirement,
    purpose: sessionRequirement === 'none' ? 'none' : `${sessionRequirement}-site-access`,
    scope: 'site-descriptor',
    ttlClass: sessionRequirement === 'none' ? 'none' : 'operator-managed',
    permissionClass: authRequired ? 'read-only-authenticated' : 'public-read',
    profileIsolation: authRequired ? 'required-by-runtime-consumer-not-materialized' : 'not-required',
    networkContextClass: authRequired ? 'authenticated-site-context-descriptor' : 'public-site-context',
    auditRequired: authRequired,
    revocationRequired: sessionRequirement === 'required',
    reasonCodeRefs: collectLayerAuthReasonCodeRefs(capabilitySite, registrySite),
    sourceRefs,
  };
}

function collectLayerSignerRequirementSignalsFromValue(value, path = 'site') {
  const signals = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      signals.push(...collectLayerSignerRequirementSignalsFromValue(entry, `${path}[${index}]`));
    });
    return signals;
  }
  if (!isPlainObject(value)) {
    return signals;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    const text = typeof entry === 'string' ? normalizeText(entry) : undefined;
    const normalizedValue = normalizeText(entry)?.toLowerCase();
    if (
      normalizedKey.includes('wbi')
      || normalizedKey.includes('signer')
      || normalizedKey.includes('signing')
      || normalizedKey.includes('signature')
      || normalizedValue === 'wbi'
      || normalizedValue === 'requires-wbi'
      || normalizedValue === 'requires_wbi'
      || normalizedValue === 'signing-required'
      || normalizedValue === 'signing_required'
      || normalizedValue === 'signature-required'
      || normalizedValue === 'signature_required'
    ) {
      signals.push(`${path}.${key}`);
    }
    if (entry === true && (
      normalizedKey.includes('wbi')
      || normalizedKey.includes('signing')
      || normalizedKey.includes('signature')
    )) {
      signals.push(`${path}.${key}:true`);
    }
    if (text && /\bwbi\b|\bsign(?:er|ing|ature)?[_-]?required\b/iu.test(text)) {
      signals.push(`${path}.${key}:${text}`);
    }
    signals.push(...collectLayerSignerRequirementSignalsFromValue(entry, `${path}.${key}`));
  }
  return signals;
}

// @ts-ignore
function collectLayerSignerRequirementSignals(capabilitySite, registrySite, { host, siteKey } = {}) {
  const adapterSignals = [];
  if (host === 'www.bilibili.com' || siteKey === 'bilibili') {
    adapterSignals.push(
      `${LAYER_SOURCE_BILIBILI_ADAPTER_REF}:/x/space/wbi/arc/search:signatureEvidenceRequired=wbi`,
    );
  }
  return uniqueLayerStrings([
    ...adapterSignals,
    ...collectLayerSignerRequirementSignalsFromValue(capabilitySite, 'siteCapabilities'),
    ...collectLayerSignerRequirementSignalsFromValue(registrySite, 'siteRegistry'),
  ]);
}

function deriveLayerSignerKind(signerRequirementSignals) {
  const signalText = signerRequirementSignals.join(' ').toLowerCase();
  if (!signalText) {
    return 'none';
  }
  if (signalText.includes('wbi')) {
    return 'wbi';
  }
  return 'request-signing';
}

function createLayerSourceSignerDependencyInventoryItem(hostKey, capabilitySite, registrySite) {
  const { host, siteKey } = normalizeLayerSiteIdentity(hostKey, capabilitySite, registrySite);
  const signerRequirementSignals = collectLayerSignerRequirementSignals(capabilitySite, registrySite, { host, siteKey });
  const signerKind = deriveLayerSignerKind(signerRequirementSignals);
  const sourceRefs = [
    capabilitySite ? LAYER_SOURCE_SITE_CAPABILITIES_REF : undefined,
    registrySite ? LAYER_SOURCE_SITE_REGISTRY_REF : undefined,
  ].filter(Boolean);
  const adapterSourceRefs = signerKind === 'wbi' ? [LAYER_SOURCE_BILIBILI_ADAPTER_REF] : [];
  return {
    id: `signer:${siteKey}`,
    schemaVersion: GRAPH_NODE_SCHEMA_VERSION,
    type: 'SignerNode',
    host,
    siteKey,
    signerKind,
    adapterRef: {
      mode: 'descriptor-only',
      sourceRefs: [...sourceRefs, ...adapterSourceRefs],
    },
    versionRef: `version:layer-source-signer:${siteKey}`,
    supportedEndpointRefs: signerKind === 'none' ? [] : [`site:${siteKey}:signing-required`],
    signerRequirementSignals,
    wbiRequired: signerKind === 'wbi',
    signingRequired: signerKind !== 'none',
    materialPolicy: 'no-raw-signer-material',
    failureModeRefs: signerKind === 'none' ? [] : [`failure-mode:${siteKey}:signer-dependency-unavailable`],
    sourceRefs,
  };
}

/** @param {Record<string, any>} [summary] */
export function assertLayerSourceSignerDependencyInventorySummaryCompatibility(summary = {}) {
  assertPlainObject(summary, 'LayerSourceSignerDependencyInventorySummary');
  assertNoLayerSourceSignerDependencyInventoryRuntimeMaterialFields(summary);
  assertGraphQueryResultCompatible(summary);
  if (summary.queryName !== LAYER_SOURCE_SIGNER_DEPENDENCY_INVENTORY_QUERY_NAME) {
    throw new Error(`LayerSourceSignerDependencyInventorySummary queryName must be ${LAYER_SOURCE_SIGNER_DEPENDENCY_INVENTORY_QUERY_NAME}`);
  }
  if (summary.artifactFamily !== LAYER_SOURCE_SIGNER_DEPENDENCY_INVENTORY_ARTIFACT_FAMILY) {
    throw new Error(`LayerSourceSignerDependencyInventorySummary artifactFamily must be ${LAYER_SOURCE_SIGNER_DEPENDENCY_INVENTORY_ARTIFACT_FAMILY}`);
  }
  if (summary.redactionRequired !== true) {
    throw new Error('LayerSourceSignerDependencyInventorySummary redactionRequired must be true');
  }
  for (const [index, item] of summary.items.entries()) {
    assertSignerNodeCompatible(item);
    assertRequiredText(item.host, `items[${index}].host`, 'LayerSourceSignerDependencyInventorySummary');
    assertLayerSourceRiskPolicySourceRefs(item.sourceRefs, 'LayerSourceSignerDependencyInventorySummary');
    if (!['none', 'wbi', 'request-signing'].includes(item.signerKind)) {
      throw new Error('LayerSourceSignerDependencyInventorySummary signerKind must be none, wbi, or request-signing');
    }
    if (item.signerKind === 'none' && item.signingRequired !== false) {
      throw new Error('LayerSourceSignerDependencyInventorySummary signerKind none must set signingRequired=false');
    }
    if (item.signerKind === 'none' && item.wbiRequired !== false) {
      throw new Error('LayerSourceSignerDependencyInventorySummary signerKind none must set wbiRequired=false');
    }
    if (item.signerKind !== 'none' && item.signingRequired !== true) {
      throw new Error('LayerSourceSignerDependencyInventorySummary signing signerKind must set signingRequired=true');
    }
    assertStringArray(item.signerRequirementSignals, 'signerRequirementSignals', 'LayerSourceSignerDependencyInventorySummary');
  }
  assertNoForbiddenPatterns(summary);
  return true;
}

/** @param {Record<string, any>} options */
export function createLayerSourceSignerDependencyInventorySummary({
  siteCapabilities,
  siteRegistry,
  ...options
} = {}) {
  assertNoLayerSourceSignerDependencyInventoryRuntimeMaterialFields(options);
  const capabilitySites = normalizeLayerSourceSites(siteCapabilities, 'siteCapabilities');
  const registrySites = normalizeLayerSourceSites(siteRegistry, 'siteRegistry');
  const siteHosts = [...new Set([
    ...Object.keys(capabilitySites),
    ...Object.keys(registrySites),
  ])].sort();
  const summary = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceSignerDependencyGraphVersion(siteCapabilities, siteRegistry),
    queryName: LAYER_SOURCE_SIGNER_DEPENDENCY_INVENTORY_QUERY_NAME,
    artifactFamily: LAYER_SOURCE_SIGNER_DEPENDENCY_INVENTORY_ARTIFACT_FAMILY,
    redactionRequired: true,
    items: siteHosts.map((hostKey) => createLayerSourceSignerDependencyInventoryItem(
      hostKey,
      capabilitySites[hostKey],
      registrySites[hostKey],
    )),
  };
  assertLayerSourceSignerDependencyInventorySummaryCompatibility(summary);
  return cloneDescriptor(summary);
}

/** @param {Record<string, any>} [summary] */
export function assertLayerSourceAuthSessionRequirementInventorySummaryCompatibility(summary = {}) {
  assertPlainObject(summary, 'LayerSourceAuthSessionRequirementInventorySummary');
  assertNoLayerSourceAuthSessionRequirementInventoryRuntimeMaterialFields(summary);
  assertGraphQueryResultCompatible(summary);
  if (summary.queryName !== LAYER_SOURCE_AUTH_SESSION_REQUIREMENT_INVENTORY_QUERY_NAME) {
    throw new Error(`LayerSourceAuthSessionRequirementInventorySummary queryName must be ${LAYER_SOURCE_AUTH_SESSION_REQUIREMENT_INVENTORY_QUERY_NAME}`);
  }
  if (summary.artifactFamily !== LAYER_SOURCE_AUTH_SESSION_REQUIREMENT_INVENTORY_ARTIFACT_FAMILY) {
    throw new Error(`LayerSourceAuthSessionRequirementInventorySummary artifactFamily must be ${LAYER_SOURCE_AUTH_SESSION_REQUIREMENT_INVENTORY_ARTIFACT_FAMILY}`);
  }
  if (summary.redactionRequired !== true) {
    throw new Error('LayerSourceAuthSessionRequirementInventorySummary redactionRequired must be true');
  }
  for (const [index, item] of summary.items.entries()) {
    assertPlainObject(item, `LayerSourceAuthSessionRequirementInventorySummary.items[${index}]`);
    if (item.type === 'AuthRequirementNode') {
      assertAuthRequirementNodeCompatible(item);
    } else if (item.type === 'SessionRequirementNode') {
      assertSessionRequirementNodeCompatible(item);
    } else {
      throw new Error('LayerSourceAuthSessionRequirementInventorySummary items must be AuthRequirementNode or SessionRequirementNode');
    }
    assertRequiredText(item.host, `items[${index}].host`, 'LayerSourceAuthSessionRequirementInventorySummary');
    assertRequiredText(item.siteKey, `items[${index}].siteKey`, 'LayerSourceAuthSessionRequirementInventorySummary');
    assertLayerSourceRiskPolicySourceRefs(item.sourceRefs, 'LayerSourceAuthSessionRequirementInventorySummary');
  }
  assertNoForbiddenPatterns(summary);
  return true;
}

/** @param {Record<string, any>} options */
export function createLayerSourceAuthSessionRequirementInventorySummary({
  siteCapabilities,
  siteRegistry,
  ...options
} = {}) {
  assertNoLayerSourceAuthSessionRequirementInventoryRuntimeMaterialFields(options);
  const capabilitySites = normalizeLayerSourceSites(siteCapabilities, 'siteCapabilities');
  const registrySites = normalizeLayerSourceSites(siteRegistry, 'siteRegistry');
  const siteHosts = [...new Set([
    ...Object.keys(capabilitySites),
    ...Object.keys(registrySites),
  ])].sort();
  const items = siteHosts.flatMap((hostKey) => [
    createLayerSourceAuthRequirementInventoryItem(hostKey, capabilitySites[hostKey], registrySites[hostKey]),
    createLayerSourceSessionRequirementInventoryItem(hostKey, capabilitySites[hostKey], registrySites[hostKey]),
  ]);
  const summary = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceAuthSessionRequirementGraphVersion(siteCapabilities, siteRegistry),
    queryName: LAYER_SOURCE_AUTH_SESSION_REQUIREMENT_INVENTORY_QUERY_NAME,
    artifactFamily: LAYER_SOURCE_AUTH_SESSION_REQUIREMENT_INVENTORY_ARTIFACT_FAMILY,
    redactionRequired: true,
    items,
  };
  assertLayerSourceAuthSessionRequirementInventorySummaryCompatibility(summary);
  return cloneDescriptor(summary);
}

/** @param {Record<string, any>} [summary] */
export function assertLayerSourceRiskPolicyInventorySummaryCompatibility(summary = {}) {
  assertPlainObject(summary, 'LayerSourceRiskPolicyInventorySummary');
  assertNoLayerSourceRiskPolicyInventoryRuntimeWriteFields(summary);
  assertGraphQueryResultCompatible(summary);
  if (summary.queryName !== LAYER_SOURCE_RISK_POLICY_INVENTORY_QUERY_NAME) {
    throw new Error(`LayerSourceRiskPolicyInventorySummary queryName must be ${LAYER_SOURCE_RISK_POLICY_INVENTORY_QUERY_NAME}`);
  }
  if (summary.artifactFamily !== LAYER_SOURCE_RISK_POLICY_INVENTORY_ARTIFACT_FAMILY) {
    throw new Error(`LayerSourceRiskPolicyInventorySummary artifactFamily must be ${LAYER_SOURCE_RISK_POLICY_INVENTORY_ARTIFACT_FAMILY}`);
  }
  if (summary.redactionRequired !== true) {
    throw new Error('LayerSourceRiskPolicyInventorySummary redactionRequired must be true');
  }
  for (const [index, item] of summary.items.entries()) {
    assertRiskPolicyNodeCompatible(item);
    assertRequiredText(item.host, `items[${index}].host`, 'LayerSourceRiskPolicyInventorySummary');
    assertRequiredText(item.siteKey, `items[${index}].siteKey`, 'LayerSourceRiskPolicyInventorySummary');
    for (const sourceRef of item.sourceRefs) {
      if (![LAYER_SOURCE_SITE_CAPABILITIES_REF, LAYER_SOURCE_SITE_REGISTRY_REF].includes(sourceRef)) {
        throw new Error('LayerSourceRiskPolicyInventorySummary sourceRefs contains unsupported path');
      }
    }
    if (item.sourceRefs.length === 0) {
      throw new Error('LayerSourceRiskPolicyInventorySummary sourceRefs must include at least one Layer config source');
    }
  }
  assertNoForbiddenPatterns(summary);
  return true;
}

/** @param {Record<string, any>} options */
export function createLayerSourceRiskPolicyInventorySummary({
  siteCapabilities,
  siteRegistry,
} = {}) {
  const capabilitySites = normalizeLayerSourceSites(siteCapabilities, 'siteCapabilities');
  const registrySites = normalizeLayerSourceSites(siteRegistry, 'siteRegistry');
  const siteHosts = [...new Set([
    ...Object.keys(capabilitySites),
    ...Object.keys(registrySites),
  ])].sort();
  const summary = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceRiskPolicyGraphVersion(siteCapabilities, siteRegistry),
    queryName: LAYER_SOURCE_RISK_POLICY_INVENTORY_QUERY_NAME,
    artifactFamily: LAYER_SOURCE_RISK_POLICY_INVENTORY_ARTIFACT_FAMILY,
    redactionRequired: true,
    items: siteHosts.map((hostKey) => createLayerSourceRiskPolicyInventoryItem(
      hostKey,
      capabilitySites[hostKey],
      registrySites[hostKey],
    )),
  };
  assertLayerSourceRiskPolicyInventorySummaryCompatibility(summary);
  return cloneDescriptor(summary);
}

const GRAPH_MIGRATION_REPORT_RUNTIME_INTEGRATION_RUNTIME_PRODUCT_KEYS = Object.freeze([
  'artifactPath',
  'doctorPayload',
  'downloadPolicy',
  'mcpPayload',
  'outputPath',
  'publishTarget',
  'publisher',
  'repoOutputPath',
  'repoPath',
  'reportPath',
  'schedulerPayload',
  'sessionView',
  'skillPayload',
  'standardTaskList',
  'taskList',
  'writePath',
]);

const GRAPH_MIGRATION_REPORT_RUNTIME_INTEGRATION_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_MIGRATION_REPORT_RUNTIME_INTEGRATION_RUNTIME_PRODUCT_KEYS.map((key) => normalizeKey(key)),
);

function assertNoGraphMigrationReportRuntimeIntegrationProducts(
  value,
  label = 'GraphMigrationReportRuntimeIntegrationDesign',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoGraphMigrationReportRuntimeIntegrationProducts(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (GRAPH_MIGRATION_REPORT_RUNTIME_INTEGRATION_RUNTIME_PRODUCT_KEY_SET.has(normalizeKey(key))) {
      throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${path}.${key}`);
    }
    assertNoGraphMigrationReportRuntimeIntegrationProducts(entry, label, `${path}.${key}`);
  }
  return true;
}

/** @param {Record<string, any>} [design] */
export function assertGraphMigrationReportRuntimeIntegrationDesignCompatibility(design = {}) {
  assertPlainObject(design, 'GraphMigrationReportRuntimeIntegrationDesign');
  assertNoGraphMigrationReportRuntimeIntegrationProducts(design);
  assertNoForbiddenGraphFields(design, 'GraphMigrationReportRuntimeIntegrationDesign');
  assertNoForbiddenPatterns(design);
  assertGraphQueryResultCompatible(design);
  if (design.queryName !== 'createGraphMigrationReportRuntimeIntegrationDesign') {
    throw new Error('GraphMigrationReportRuntimeIntegrationDesign queryName must be createGraphMigrationReportRuntimeIntegrationDesign');
  }
  if (design.artifactFamily !== 'site-capability-graph-migration-report-runtime-integration-design') {
    throw new Error('GraphMigrationReportRuntimeIntegrationDesign artifactFamily must be site-capability-graph-migration-report-runtime-integration-design');
  }
  if (design.redactionRequired !== true) {
    throw new Error('GraphMigrationReportRuntimeIntegrationDesign redactionRequired must be true');
  }
  if (!Array.isArray(design.items) || design.items.length === 0) {
    throw new Error('GraphMigrationReportRuntimeIntegrationDesign items are required');
  }
  for (const [index, item] of design.items.entries()) {
    assertPlainObject(item, `GraphMigrationReportRuntimeIntegrationDesign.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphMigrationReportRuntimeIntegrationDesign item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.integrationMode !== 'design-only') {
      throw new Error('GraphMigrationReportRuntimeIntegrationDesign integrationMode must be design-only');
    }
    for (const fieldName of [
      'repoWriteEnabled',
      'runtimeArtifactWriteEnabled',
      'schedulerPublishEnabled',
      'doctorPublishEnabled',
      'skillPublishEnabled',
      'mcpPublishEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphMigrationReportRuntimeIntegrationDesign ${fieldName} must be false`);
      }
    }
    assertPlainObject(item.report, `GraphMigrationReportRuntimeIntegrationDesign.items[${index}].report`);
    assertGraphQueryResultCompatible(item.report);
    if (item.report.artifactFamily !== 'site-capability-graph-migration-report') {
      throw new Error('GraphMigrationReportRuntimeIntegrationDesign report artifactFamily must be site-capability-graph-migration-report');
    }
    if (item.report.redactionRequired !== true) {
      throw new Error('GraphMigrationReportRuntimeIntegrationDesign report redactionRequired must be true');
    }
  }
  return true;
}

/** @param {Record<string, any>} [graph] */
export function createGraphMigrationReportRuntimeIntegrationDesign(graph = {}, options = {}) {
  assertPlainObject(options, 'GraphMigrationReportRuntimeIntegrationDesignOptions');
  assertNoGraphMigrationReportRuntimeIntegrationProducts(
    options,
    'GraphMigrationReportRuntimeIntegrationDesignOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphMigrationReportRuntimeIntegrationDesignOptions');
  assertNoForbiddenPatterns(options);
  const {
    integrationName = 'site-capability-graph-migration-report-runtime-design',
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    schedulerPublishEnabled,
    doctorPublishEnabled,
    skillPublishEnabled,
    mcpPublishEnabled,
    statusSummary,
    knownGaps,
    nextTasks,
  } = options;
  const report = generateGraphMigrationReport(graph, {
    statusSummary,
    knownGaps,
    nextTasks,
  });
  const design = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: report.graphVersion,
    queryName: 'createGraphMigrationReportRuntimeIntegrationDesign',
    artifactFamily: 'site-capability-graph-migration-report-runtime-integration-design',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      integrationName: assertRequiredText(
        integrationName,
        'integrationName',
        'GraphMigrationReportRuntimeIntegrationDesign',
      ),
      integrationMode: 'design-only',
      repoWriteEnabled: assertDisabledFlag(
        repoWriteEnabled,
        'repoWriteEnabled',
        'GraphMigrationReportRuntimeIntegrationDesign',
      ),
      runtimeArtifactWriteEnabled: assertDisabledFlag(
        runtimeArtifactWriteEnabled,
        'runtimeArtifactWriteEnabled',
        'GraphMigrationReportRuntimeIntegrationDesign',
      ),
      schedulerPublishEnabled: assertDisabledFlag(
        schedulerPublishEnabled,
        'schedulerPublishEnabled',
        'GraphMigrationReportRuntimeIntegrationDesign',
      ),
      doctorPublishEnabled: assertDisabledFlag(
        doctorPublishEnabled,
        'doctorPublishEnabled',
        'GraphMigrationReportRuntimeIntegrationDesign',
      ),
      skillPublishEnabled: assertDisabledFlag(
        skillPublishEnabled,
        'skillPublishEnabled',
        'GraphMigrationReportRuntimeIntegrationDesign',
      ),
      mcpPublishEnabled: assertDisabledFlag(
        mcpPublishEnabled,
        'mcpPublishEnabled',
        'GraphMigrationReportRuntimeIntegrationDesign',
      ),
      requiredReportProducer: 'generateGraphMigrationReport',
      requiredArtifactGuard: 'SecurityGuard/Redaction before graph-derived artifact writes',
      forbiddenRuntimeProducts: [
        'RepoLevelMigrationReportWrite',
        'SchedulerPublish',
        'DoctorPublish',
        'SkillPublish',
        'McpPublish',
        'SessionView',
        'StandardTaskList',
        'DownloadPolicy',
      ],
      report,
    }],
  };
  assertGraphMigrationReportRuntimeIntegrationDesignCompatibility(design);
  return cloneDescriptor(design);
}

/** @param {Record<string, any>} [result] */
export function assertDisabledGraphMigrationReportRuntimeConsumerResultCompatibility(result = {}) {
  assertPlainObject(result, 'DisabledGraphMigrationReportRuntimeConsumerResult');
  assertNoGraphMigrationReportRuntimeIntegrationProducts(
    result,
    'DisabledGraphMigrationReportRuntimeConsumerResult',
  );
  assertNoForbiddenGraphFields(result, 'DisabledGraphMigrationReportRuntimeConsumerResult');
  assertNoForbiddenPatterns(result);
  assertGraphQueryResultCompatible(result);
  if (result.queryName !== 'createDisabledGraphMigrationReportRuntimeConsumerResult') {
    throw new Error('DisabledGraphMigrationReportRuntimeConsumerResult queryName must be createDisabledGraphMigrationReportRuntimeConsumerResult');
  }
  if (result.artifactFamily !== 'site-capability-graph-migration-report-runtime-consumer-result') {
    throw new Error('DisabledGraphMigrationReportRuntimeConsumerResult artifactFamily must be site-capability-graph-migration-report-runtime-consumer-result');
  }
  if (result.redactionRequired !== true) {
    throw new Error('DisabledGraphMigrationReportRuntimeConsumerResult redactionRequired must be true');
  }
  if (!Array.isArray(result.items) || result.items.length === 0) {
    throw new Error('DisabledGraphMigrationReportRuntimeConsumerResult items are required');
  }
  for (const [index, item] of result.items.entries()) {
    assertPlainObject(item, `DisabledGraphMigrationReportRuntimeConsumerResult.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`DisabledGraphMigrationReportRuntimeConsumerResult item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.consumerMode !== 'disabled-feature-flag') {
      throw new Error('DisabledGraphMigrationReportRuntimeConsumerResult consumerMode must be disabled-feature-flag');
    }
    if (item.featureEnabled !== false) {
      throw new Error('DisabledGraphMigrationReportRuntimeConsumerResult featureEnabled must be false');
    }
    if (item.result !== 'blocked') {
      throw new Error('DisabledGraphMigrationReportRuntimeConsumerResult result must be blocked');
    }
    for (const fieldName of [
      'repoWriteEnabled',
      'runtimeArtifactWriteEnabled',
      'schedulerPublishEnabled',
      'doctorPublishEnabled',
      'skillPublishEnabled',
      'mcpPublishEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`DisabledGraphMigrationReportRuntimeConsumerResult ${fieldName} must be false`);
      }
    }
    assertPlainObject(item.reason, `DisabledGraphMigrationReportRuntimeConsumerResult.items[${index}].reason`);
    if (item.reason.code !== item.reasonCode) {
      throw new Error('DisabledGraphMigrationReportRuntimeConsumerResult reason code must match reasonCode');
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`DisabledGraphMigrationReportRuntimeConsumerResult reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(item.sourceDesign, `DisabledGraphMigrationReportRuntimeConsumerResult.items[${index}].sourceDesign`);
    if (item.sourceDesign.queryName !== 'createGraphMigrationReportRuntimeIntegrationDesign') {
      throw new Error('DisabledGraphMigrationReportRuntimeConsumerResult sourceDesign queryName must be createGraphMigrationReportRuntimeIntegrationDesign');
    }
    if (item.sourceDesign.artifactFamily !== 'site-capability-graph-migration-report-runtime-integration-design') {
      throw new Error('DisabledGraphMigrationReportRuntimeConsumerResult sourceDesign artifactFamily must be site-capability-graph-migration-report-runtime-integration-design');
    }
    assertPlainObject(item.report, `DisabledGraphMigrationReportRuntimeConsumerResult.items[${index}].report`);
    assertGraphQueryResultCompatible(item.report);
    if (item.report.artifactFamily !== 'site-capability-graph-migration-report') {
      throw new Error('DisabledGraphMigrationReportRuntimeConsumerResult report artifactFamily must be site-capability-graph-migration-report');
    }
    if (item.report.redactionRequired !== true) {
      throw new Error('DisabledGraphMigrationReportRuntimeConsumerResult report redactionRequired must be true');
    }
  }
  return true;
}

/** @param {Record<string, any>} [design] */
export function createDisabledGraphMigrationReportRuntimeConsumerResult(design = {}, options = {}) {
  assertGraphMigrationReportRuntimeIntegrationDesignCompatibility(design);
  assertPlainObject(options, 'DisabledGraphMigrationReportRuntimeConsumerOptions');
  assertNoGraphMigrationReportRuntimeIntegrationProducts(
    options,
    'DisabledGraphMigrationReportRuntimeConsumerOptions',
  );
  assertNoForbiddenGraphFields(options, 'DisabledGraphMigrationReportRuntimeConsumerOptions');
  assertNoForbiddenPatterns(options);
  const {
    consumerName = 'site-capability-graph-migration-report-runtime-consumer',
    featureEnabled,
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    schedulerPublishEnabled,
    doctorPublishEnabled,
    skillPublishEnabled,
    mcpPublishEnabled,
  } = options;
  for (const [fieldName, value] of Object.entries({
    featureEnabled,
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    schedulerPublishEnabled,
    doctorPublishEnabled,
    skillPublishEnabled,
    mcpPublishEnabled,
  })) {
    assertDisabledFlag(
      value,
      fieldName,
      'DisabledGraphMigrationReportRuntimeConsumerResult',
    );
  }
  const sourceItem = design.items[0];
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: design.graphVersion,
    queryName: 'createDisabledGraphMigrationReportRuntimeConsumerResult',
    artifactFamily: 'site-capability-graph-migration-report-runtime-consumer-result',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      consumerName: assertRequiredText(
        consumerName,
        'consumerName',
        'DisabledGraphMigrationReportRuntimeConsumerResult',
      ),
      consumerMode: 'disabled-feature-flag',
      featureFlag: 'siteCapabilityGraphMigrationReportRuntimeEnabled',
      featureEnabled: false,
      result: 'blocked',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph migration report runtime consumer is disabled by feature flag',
      ),
      repoWriteEnabled: false,
      runtimeArtifactWriteEnabled: false,
      schedulerPublishEnabled: false,
      doctorPublishEnabled: false,
      skillPublishEnabled: false,
      mcpPublishEnabled: false,
      sourceDesign: {
        queryName: design.queryName,
        artifactFamily: design.artifactFamily,
        integrationMode: sourceItem.integrationMode,
      },
      report: sourceItem.report,
    }],
  };
  assertDisabledGraphMigrationReportRuntimeConsumerResultCompatibility(result);
  return cloneDescriptor(result);
}

function normalizeGraphMigrationReportRepoOutputTarget(value) {
  const text = assertRequiredText(
    value ?? 'runs/site-capability-graph/generated-migration-report.json',
    'targetRelativePath',
    'GraphMigrationReportRepoOutputDryRun',
  ).replace(/\\/gu, '/');
  if (/^(?:[a-z]:|\/)/iu.test(text)) {
    throw new Error('GraphMigrationReportRepoOutputDryRun targetRelativePath must be repo-relative');
  }
  if (text.split('/').some((segment) => segment === '..')) {
    throw new Error('GraphMigrationReportRepoOutputDryRun targetRelativePath must stay within the repository');
  }
  if (!/^runs\/site-capability-graph\/[a-z0-9][a-z0-9-]{0,79}\.(?:json|md)$/u.test(text)) {
    throw new Error('GraphMigrationReportRepoOutputDryRun targetRelativePath must be runs/site-capability-graph/<artifact>.json or .md');
  }
  assertNoForbiddenPatterns(text);
  return text;
}

/** @param {Record<string, any>} [result] */
export function assertGraphMigrationReportRepoOutputDryRunCompatibility(result = {}) {
  assertPlainObject(result, 'GraphMigrationReportRepoOutputDryRun');
  assertNoGraphMigrationReportRuntimeIntegrationProducts(result, 'GraphMigrationReportRepoOutputDryRun');
  assertNoForbiddenGraphFields(result, 'GraphMigrationReportRepoOutputDryRun');
  assertNoForbiddenPatterns(result);
  assertGraphQueryResultCompatible(result);
  if (result.queryName !== 'createGraphMigrationReportRepoOutputDryRun') {
    throw new Error('GraphMigrationReportRepoOutputDryRun queryName must be createGraphMigrationReportRepoOutputDryRun');
  }
  if (result.artifactFamily !== 'site-capability-graph-migration-report-repo-output-dry-run') {
    throw new Error('GraphMigrationReportRepoOutputDryRun artifactFamily must be site-capability-graph-migration-report-repo-output-dry-run');
  }
  if (result.redactionRequired !== true) {
    throw new Error('GraphMigrationReportRepoOutputDryRun redactionRequired must be true');
  }
  if (!Array.isArray(result.items) || result.items.length === 0) {
    throw new Error('GraphMigrationReportRepoOutputDryRun items are required');
  }
  for (const [index, item] of result.items.entries()) {
    assertPlainObject(item, `GraphMigrationReportRepoOutputDryRun.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphMigrationReportRepoOutputDryRun item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.outputMode !== 'dry-run-preview') {
      throw new Error('GraphMigrationReportRepoOutputDryRun outputMode must be dry-run-preview');
    }
    if (item.dryRunOnly !== true) {
      throw new Error('GraphMigrationReportRepoOutputDryRun dryRunOnly must be true');
    }
    for (const fieldName of [
      'repoWriteEnabled',
      'runtimeArtifactWriteEnabled',
      'schedulerPublishEnabled',
      'doctorPublishEnabled',
      'skillPublishEnabled',
      'mcpPublishEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphMigrationReportRepoOutputDryRun ${fieldName} must be false`);
      }
    }
    if (item.explicitValidationRequired !== true) {
      throw new Error('GraphMigrationReportRepoOutputDryRun explicitValidationRequired must be true');
    }
    normalizeGraphMigrationReportRepoOutputTarget(item.targetRelativePath);
    assertPlainObject(item.report, `GraphMigrationReportRepoOutputDryRun.items[${index}].report`);
    assertGraphQueryResultCompatible(item.report);
    if (item.report.artifactFamily !== 'site-capability-graph-migration-report') {
      throw new Error('GraphMigrationReportRepoOutputDryRun report artifactFamily must be site-capability-graph-migration-report');
    }
    if (item.report.redactionRequired !== true) {
      throw new Error('GraphMigrationReportRepoOutputDryRun report redactionRequired must be true');
    }
  }
  return true;
}

/** @param {Record<string, any>} [graph] */
export function createGraphMigrationReportRepoOutputDryRun(graph = {}, options = {}) {
  assertPlainObject(options, 'GraphMigrationReportRepoOutputDryRunOptions');
  assertNoGraphMigrationReportRuntimeIntegrationProducts(
    options,
    'GraphMigrationReportRepoOutputDryRunOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphMigrationReportRepoOutputDryRunOptions');
  assertNoForbiddenPatterns(options);
  const {
    targetRelativePath,
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    schedulerPublishEnabled,
    doctorPublishEnabled,
    skillPublishEnabled,
    mcpPublishEnabled,
    statusSummary,
    knownGaps,
    nextTasks,
  } = options;
  for (const [fieldName, value] of Object.entries({
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    schedulerPublishEnabled,
    doctorPublishEnabled,
    skillPublishEnabled,
    mcpPublishEnabled,
  })) {
    assertDisabledFlag(
      value,
      fieldName,
      'GraphMigrationReportRepoOutputDryRun',
    );
  }
  const report = generateGraphMigrationReport(graph, {
    statusSummary,
    knownGaps,
    nextTasks,
  });
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: report.graphVersion,
    queryName: 'createGraphMigrationReportRepoOutputDryRun',
    artifactFamily: 'site-capability-graph-migration-report-repo-output-dry-run',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      outputMode: 'dry-run-preview',
      dryRunOnly: true,
      targetRelativePath: normalizeGraphMigrationReportRepoOutputTarget(targetRelativePath),
      repoWriteEnabled: false,
      runtimeArtifactWriteEnabled: false,
      schedulerPublishEnabled: false,
      doctorPublishEnabled: false,
      skillPublishEnabled: false,
      mcpPublishEnabled: false,
      explicitValidationRequired: true,
      requiredReportProducer: 'generateGraphMigrationReport',
      requiredArtifactGuard: 'SecurityGuard/Redaction before graph-derived artifact writes',
      report,
    }],
  };
  assertGraphMigrationReportRepoOutputDryRunCompatibility(result);
  return cloneDescriptor(result);
}

/**
 * @param {Record<string, any>} [graph]
 * @param {Record<string, any>} options
 */
export function createGraphInventoryArtifact(graph = {}, {
  inventoryName = 'generated-site-capability-graph',
  source = 'synthetic-generated-fixture',
} = {}) {
  const validGraph = assertQueryableGraph(graph);
  const artifact = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: validGraph.graphVersion,
    queryName: 'createGraphInventoryArtifact',
    artifactFamily: 'site-capability-graph-inventory',
    redactionRequired: true,
    items: [{
      inventoryName: assertRequiredText(inventoryName, 'inventoryName', 'GraphInventoryArtifact'),
      source: assertRequiredText(source, 'source', 'GraphInventoryArtifact'),
      graph: cloneDescriptor(validGraph),
    }],
  };
  assertGraphQueryResultCompatible(artifact);
  assertNoForbiddenPatterns(artifact);
  return cloneDescriptor(artifact);
}

function assertDisabledFlag(value, fieldName, label) {
  if (value !== undefined && value !== false) {
    throw new Error(`${label} ${fieldName} must remain false`);
  }
  return false;
}

const GRAPH_INVENTORY_COMMAND_RUNTIME_PRODUCT_KEYS = Object.freeze([
  'command',
  'downloadPolicy',
  'exec',
  'handler',
  'outputPath',
  'process',
  'profilePath',
  'repoOutputPath',
  'sessionView',
  'shellCommand',
  'spawn',
  'taskList',
  'userDataDir',
  'writePath',
]);

const GRAPH_INVENTORY_COMMAND_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_INVENTORY_COMMAND_RUNTIME_PRODUCT_KEYS.map((key) => normalizeKey(key)),
);

function assertNoGraphInventoryCommandRuntimeProducts(value, path = 'GraphInventoryCommandDesignOptions') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoGraphInventoryCommandRuntimeProducts(entry, `${path}[${index}]`));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'graph' && path.includes('.inventoryArtifact.items[')) {
      continue;
    }
    if (GRAPH_INVENTORY_COMMAND_RUNTIME_PRODUCT_KEY_SET.has(normalizeKey(key))) {
      throw new Error(`GraphInventoryCommandDesign is descriptor-only and must not include runtime product: ${path}.${key}`);
    }
    assertNoGraphInventoryCommandRuntimeProducts(entry, `${path}.${key}`);
  }
  return true;
}

/** @param {Record<string, any>} [design] */
export function assertGraphInventoryCommandDesignCompatibility(design = {}) {
  assertPlainObject(design, 'GraphInventoryCommandDesign');
  assertNoGraphInventoryCommandRuntimeProducts(design, 'GraphInventoryCommandDesign');
  assertNoForbiddenGraphFields(design, 'GraphInventoryCommandDesign');
  assertNoForbiddenPatterns(design);
  assertGraphQueryResultCompatible(design);
  if (design.queryName !== 'createGraphInventoryCommandDesign') {
    throw new Error('GraphInventoryCommandDesign queryName must be createGraphInventoryCommandDesign');
  }
  if (design.artifactFamily !== 'site-capability-graph-inventory-command-design') {
    throw new Error('GraphInventoryCommandDesign artifactFamily must be site-capability-graph-inventory-command-design');
  }
  if (design.redactionRequired !== true) {
    throw new Error('GraphInventoryCommandDesign redactionRequired must be true');
  }
  if (!Array.isArray(design.items) || design.items.length === 0) {
    throw new Error('GraphInventoryCommandDesign items are required');
  }
  for (const [index, item] of design.items.entries()) {
    assertPlainObject(item, `GraphInventoryCommandDesign.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphInventoryCommandDesign item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.executionMode !== 'design-only') {
      throw new Error('GraphInventoryCommandDesign executionMode must be design-only');
    }
    if ('requiredPlacementPolicy' in item || 'requiredWriter' in item) {
      throw new Error('GraphInventoryCommandDesign must not reference retired graph artifact writers');
    }
    for (const fieldName of [
      'runtimeGenerationEnabled',
      'repoWriteEnabled',
      'liveArtifactWriteEnabled',
      'externalCommandEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphInventoryCommandDesign ${fieldName} must be false`);
      }
    }
    assertPlainObject(item.inventoryArtifact, `GraphInventoryCommandDesign.items[${index}].inventoryArtifact`);
    assertGraphQueryResultCompatible(item.inventoryArtifact);
    if (item.inventoryArtifact.artifactFamily !== 'site-capability-graph-inventory') {
      throw new Error('GraphInventoryCommandDesign inventoryArtifact artifactFamily must be site-capability-graph-inventory');
    }
    if (item.inventoryArtifact.redactionRequired !== true) {
      throw new Error('GraphInventoryCommandDesign inventoryArtifact redactionRequired must be true');
    }
  }
  return true;
}

/** @param {Record<string, any>} [graph] */
export function createGraphInventoryCommandDesign(graph = {}, options = {}) {
  assertPlainObject(options, 'GraphInventoryCommandDesignOptions');
  assertNoGraphInventoryCommandRuntimeProducts(options);
  assertNoForbiddenGraphFields(options, 'GraphInventoryCommandDesignOptions');
  assertNoForbiddenPatterns(options);
  const {
    commandName = 'site-capability-graph:inventory:generate',
    inventoryName = 'generated-site-capability-graph',
    source = 'synthetic-generated-fixture',
    runtimeGenerationEnabled,
    repoWriteEnabled,
    liveArtifactWriteEnabled,
    externalCommandEnabled,
  } = options;
  const inventoryArtifact = createGraphInventoryArtifact(graph, {
    inventoryName,
    source,
  });
  const design = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: inventoryArtifact.graphVersion,
    queryName: 'createGraphInventoryCommandDesign',
    artifactFamily: 'site-capability-graph-inventory-command-design',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      commandName: assertRequiredText(commandName, 'commandName', 'GraphInventoryCommandDesign'),
      executionMode: 'design-only',
      runtimeGenerationEnabled: assertDisabledFlag(
        runtimeGenerationEnabled,
        'runtimeGenerationEnabled',
        'GraphInventoryCommandDesign',
      ),
      repoWriteEnabled: assertDisabledFlag(
        repoWriteEnabled,
        'repoWriteEnabled',
        'GraphInventoryCommandDesign',
      ),
      liveArtifactWriteEnabled: assertDisabledFlag(
        liveArtifactWriteEnabled,
        'liveArtifactWriteEnabled',
        'GraphInventoryCommandDesign',
      ),
      externalCommandEnabled: assertDisabledFlag(
        externalCommandEnabled,
        'externalCommandEnabled',
        'GraphInventoryCommandDesign',
      ),
      requiredArtifactFamily: 'site-capability-graph-inventory',
      inventoryArtifact,
    }],
  };
  assertGraphInventoryCommandDesignCompatibility(design);
  return cloneDescriptor(design);
}

const GRAPH_INVENTORY_RUNTIME_INTEGRATION_RUNTIME_PRODUCT_KEYS = Object.freeze([
  'artifactPath',
  'browserProfile',
  'browserProfilePath',
  'command',
  'databasePath',
  'databaseUrl',
  'dbPath',
  'doctorPayload',
  'downloadPolicy',
  'exec',
  'handler',
  'inventoryOutputPath',
  'inventoryPath',
  'mcpPayload',
  'outputPath',
  'process',
  'profilePath',
  'publishTarget',
  'publisher',
  'repoOutputPath',
  'repoPath',
  'runtimeState',
  'runtimeStateStore',
  'schedulerPayload',
  'sessionView',
  'shellCommand',
  'skillPayload',
  'spawn',
  'statePersistence',
  'storageAdapter',
  'storageAdapterConfig',
  'storageConnection',
  'standardTaskList',
  'taskList',
  'userDataDir',
  'writePath',
]);

const GRAPH_INVENTORY_RUNTIME_INTEGRATION_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_INVENTORY_RUNTIME_INTEGRATION_RUNTIME_PRODUCT_KEYS.map((key) => normalizeKey(key)),
);

const GRAPH_INVENTORY_RUNTIME_INTEGRATION_STORAGE_INVARIANT = Object.freeze({
  storageMode: 'json-descriptor-only',
  databaseEnabled: false,
  runtimeStatePersistenceEnabled: false,
  dynamicRuntimeStateStored: false,
  storageAdapterEnabled: false,
  statePersistenceEnabled: false,
});

const GRAPH_INVENTORY_RUNTIME_INTEGRATION_STORAGE_INVARIANT_ENTRIES = Object.freeze(
  Object.entries(GRAPH_INVENTORY_RUNTIME_INTEGRATION_STORAGE_INVARIANT),
);

const GRAPH_INVENTORY_RUNTIME_INTEGRATION_STORAGE_INVARIANT_KEYS = Object.freeze(
  GRAPH_INVENTORY_RUNTIME_INTEGRATION_STORAGE_INVARIANT_ENTRIES.map(([key]) => key),
);

const GRAPH_INVENTORY_RUNTIME_INTEGRATION_STORAGE_INVARIANT_KEY_SET = new Set(
  GRAPH_INVENTORY_RUNTIME_INTEGRATION_STORAGE_INVARIANT_KEYS.map((key) => normalizeKey(key)),
);

const GRAPH_INVENTORY_RUNTIME_INTEGRATION_STORAGE_INVARIANT_BY_KEY = new Map(
  GRAPH_INVENTORY_RUNTIME_INTEGRATION_STORAGE_INVARIANT_ENTRIES.map(([key, value]) => [normalizeKey(key), value]),
);

function assertGraphInventoryRuntimeIntegrationStorageInvariant(item, label) {
  for (const [fieldName, expectedValue] of GRAPH_INVENTORY_RUNTIME_INTEGRATION_STORAGE_INVARIANT_ENTRIES) {
    if (item[fieldName] !== expectedValue) {
      throw new Error(`${label} ${fieldName} must be ${String(expectedValue)}`);
    }
  }
  return true;
}

function assertNoGraphInventoryRuntimeIntegrationProducts(
  value,
  label = 'GraphInventoryRuntimeIntegrationDesign',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoGraphInventoryRuntimeIntegrationProducts(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'graph' && path.includes('.inventoryArtifact.items[')) {
      continue;
    }
    const normalizedKey = normalizeKey(key);
    if (GRAPH_INVENTORY_RUNTIME_INTEGRATION_STORAGE_INVARIANT_KEY_SET.has(normalizedKey)) {
      const expectedValue = GRAPH_INVENTORY_RUNTIME_INTEGRATION_STORAGE_INVARIANT_BY_KEY.get(normalizedKey);
      if (entry !== expectedValue) {
        throw new Error(`${label} ${path}.${key} must be ${String(expectedValue)}`);
      }
    } else if (GRAPH_INVENTORY_RUNTIME_INTEGRATION_RUNTIME_PRODUCT_KEY_SET.has(normalizedKey)) {
      throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${path}.${key}`);
    }
    assertNoGraphInventoryRuntimeIntegrationProducts(entry, label, `${path}.${key}`);
  }
  return true;
}

function assertNoGraphInventoryRuntimeIntegrationStorageOptions(
  value,
  label = 'GraphInventoryRuntimeIntegrationOptions',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoGraphInventoryRuntimeIntegrationStorageOptions(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (
      GRAPH_INVENTORY_RUNTIME_INTEGRATION_STORAGE_INVARIANT_KEY_SET.has(normalizedKey)
      || GRAPH_INVENTORY_RUNTIME_INTEGRATION_RUNTIME_PRODUCT_KEY_SET.has(normalizedKey)
    ) {
      throw new Error(`${label} must remain descriptor-only and rejected unsafe storage/runtime option: ${path}.${key}`);
    }
    assertNoGraphInventoryRuntimeIntegrationStorageOptions(entry, label, `${path}.${key}`);
  }
  return true;
}

/** @param {Record<string, any>} [design] */
export function assertGraphInventoryRuntimeIntegrationDesignCompatibility(design = {}) {
  assertPlainObject(design, 'GraphInventoryRuntimeIntegrationDesign');
  assertNoGraphInventoryRuntimeIntegrationProducts(design);
  assertNoForbiddenGraphFields(design, 'GraphInventoryRuntimeIntegrationDesign');
  assertNoForbiddenPatterns(design);
  assertGraphQueryResultCompatible(design);
  if (design.queryName !== 'createGraphInventoryRuntimeIntegrationDesign') {
    throw new Error('GraphInventoryRuntimeIntegrationDesign queryName must be createGraphInventoryRuntimeIntegrationDesign');
  }
  if (design.artifactFamily !== 'site-capability-graph-inventory-runtime-integration-design') {
    throw new Error('GraphInventoryRuntimeIntegrationDesign artifactFamily must be site-capability-graph-inventory-runtime-integration-design');
  }
  if (design.redactionRequired !== true) {
    throw new Error('GraphInventoryRuntimeIntegrationDesign redactionRequired must be true');
  }
  if (!Array.isArray(design.items) || design.items.length === 0) {
    throw new Error('GraphInventoryRuntimeIntegrationDesign items are required');
  }
  for (const [index, item] of design.items.entries()) {
    assertPlainObject(item, `GraphInventoryRuntimeIntegrationDesign.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphInventoryRuntimeIntegrationDesign item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.integrationMode !== 'design-only') {
      throw new Error('GraphInventoryRuntimeIntegrationDesign integrationMode must be design-only');
    }
    for (const fieldName of [
      'runtimeGenerationEnabled',
      'repoWriteEnabled',
      'runtimeArtifactWriteEnabled',
      'externalCommandEnabled',
      'schedulerPublishEnabled',
      'doctorPublishEnabled',
      'skillPublishEnabled',
      'mcpPublishEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphInventoryRuntimeIntegrationDesign ${fieldName} must be false`);
      }
    }
    assertGraphInventoryRuntimeIntegrationStorageInvariant(
      item,
      'GraphInventoryRuntimeIntegrationDesign',
    );
    assertPlainObject(item.inventoryArtifact, `GraphInventoryRuntimeIntegrationDesign.items[${index}].inventoryArtifact`);
    assertGraphQueryResultCompatible(item.inventoryArtifact);
    if (item.inventoryArtifact.artifactFamily !== 'site-capability-graph-inventory') {
      throw new Error('GraphInventoryRuntimeIntegrationDesign inventoryArtifact artifactFamily must be site-capability-graph-inventory');
    }
    if (item.inventoryArtifact.redactionRequired !== true) {
      throw new Error('GraphInventoryRuntimeIntegrationDesign inventoryArtifact redactionRequired must be true');
    }
    assertPlainObject(item.commandDesign, `GraphInventoryRuntimeIntegrationDesign.items[${index}].commandDesign`);
    assertGraphInventoryCommandDesignCompatibility(item.commandDesign);
  }
  return true;
}

/** @param {Record<string, any>} [graph] */
export function createGraphInventoryRuntimeIntegrationDesign(graph = {}, options = {}) {
  assertPlainObject(options, 'GraphInventoryRuntimeIntegrationDesignOptions');
  assertNoGraphInventoryRuntimeIntegrationStorageOptions(
    options,
    'GraphInventoryRuntimeIntegrationDesignOptions',
  );
  assertNoGraphInventoryRuntimeIntegrationProducts(
    options,
    'GraphInventoryRuntimeIntegrationDesignOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphInventoryRuntimeIntegrationDesignOptions');
  assertNoForbiddenPatterns(options);
  const {
    integrationName = 'site-capability-graph-inventory-runtime-design',
    commandName = 'site-capability-graph:inventory:generate',
    inventoryName = 'generated-site-capability-graph',
    source = 'synthetic-generated-fixture',
    runtimeGenerationEnabled,
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
    schedulerPublishEnabled,
    doctorPublishEnabled,
    skillPublishEnabled,
    mcpPublishEnabled,
  } = options;
  const inventoryArtifact = createGraphInventoryArtifact(graph, {
    inventoryName,
    source,
  });
  const commandDesign = createGraphInventoryCommandDesign(graph, {
    commandName,
    inventoryName,
    source,
  });
  const design = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: inventoryArtifact.graphVersion,
    queryName: 'createGraphInventoryRuntimeIntegrationDesign',
    artifactFamily: 'site-capability-graph-inventory-runtime-integration-design',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      integrationName: assertRequiredText(
        integrationName,
        'integrationName',
        'GraphInventoryRuntimeIntegrationDesign',
      ),
      integrationMode: 'design-only',
      runtimeGenerationEnabled: assertDisabledFlag(
        runtimeGenerationEnabled,
        'runtimeGenerationEnabled',
        'GraphInventoryRuntimeIntegrationDesign',
      ),
      repoWriteEnabled: assertDisabledFlag(
        repoWriteEnabled,
        'repoWriteEnabled',
        'GraphInventoryRuntimeIntegrationDesign',
      ),
      runtimeArtifactWriteEnabled: assertDisabledFlag(
        runtimeArtifactWriteEnabled,
        'runtimeArtifactWriteEnabled',
        'GraphInventoryRuntimeIntegrationDesign',
      ),
      externalCommandEnabled: assertDisabledFlag(
        externalCommandEnabled,
        'externalCommandEnabled',
        'GraphInventoryRuntimeIntegrationDesign',
      ),
      schedulerPublishEnabled: assertDisabledFlag(
        schedulerPublishEnabled,
        'schedulerPublishEnabled',
        'GraphInventoryRuntimeIntegrationDesign',
      ),
      doctorPublishEnabled: assertDisabledFlag(
        doctorPublishEnabled,
        'doctorPublishEnabled',
        'GraphInventoryRuntimeIntegrationDesign',
      ),
      skillPublishEnabled: assertDisabledFlag(
        skillPublishEnabled,
        'skillPublishEnabled',
        'GraphInventoryRuntimeIntegrationDesign',
      ),
      mcpPublishEnabled: assertDisabledFlag(
        mcpPublishEnabled,
        'mcpPublishEnabled',
        'GraphInventoryRuntimeIntegrationDesign',
      ),
      ...GRAPH_INVENTORY_RUNTIME_INTEGRATION_STORAGE_INVARIANT,
      requiredInventoryProducer: 'createGraphInventoryArtifact',
      requiredCommandDesign: 'createGraphInventoryCommandDesign',
      requiredArtifactGuard: 'SecurityGuard/Redaction before graph-derived artifact writes',
      forbiddenRuntimeProducts: [
        'Database',
        'DatabaseUrl',
        'RepoLevelGraphInventoryWrite',
        'RuntimeGraphGeneration',
        'RuntimeStatePersistence',
        'StorageAdapter',
        'ExternalCommand',
        'SchedulerPublish',
        'DoctorPublish',
        'SkillPublish',
        'McpPublish',
        'SessionView',
        'StandardTaskList',
        'DownloadPolicy',
        'ProfileRuntimeMaterial',
      ],
      inventoryArtifact,
      commandDesign,
    }],
  };
  assertGraphInventoryRuntimeIntegrationDesignCompatibility(design);
  return cloneDescriptor(design);
}

/** @param {Record<string, any>} [result] */
export function assertDisabledGraphInventoryRuntimeConsumerResultCompatibility(result = {}) {
  assertPlainObject(result, 'DisabledGraphInventoryRuntimeConsumerResult');
  assertNoGraphInventoryRuntimeIntegrationProducts(
    result,
    'DisabledGraphInventoryRuntimeConsumerResult',
  );
  assertNoForbiddenGraphFields(result, 'DisabledGraphInventoryRuntimeConsumerResult');
  assertNoForbiddenPatterns(result);
  assertGraphQueryResultCompatible(result);
  if (result.queryName !== 'createDisabledGraphInventoryRuntimeConsumerResult') {
    throw new Error('DisabledGraphInventoryRuntimeConsumerResult queryName must be createDisabledGraphInventoryRuntimeConsumerResult');
  }
  if (result.artifactFamily !== 'site-capability-graph-inventory-runtime-consumer-result') {
    throw new Error('DisabledGraphInventoryRuntimeConsumerResult artifactFamily must be site-capability-graph-inventory-runtime-consumer-result');
  }
  if (result.redactionRequired !== true) {
    throw new Error('DisabledGraphInventoryRuntimeConsumerResult redactionRequired must be true');
  }
  if (!Array.isArray(result.items) || result.items.length === 0) {
    throw new Error('DisabledGraphInventoryRuntimeConsumerResult items are required');
  }
  for (const [index, item] of result.items.entries()) {
    assertPlainObject(item, `DisabledGraphInventoryRuntimeConsumerResult.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`DisabledGraphInventoryRuntimeConsumerResult item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.consumerMode !== 'disabled-feature-flag') {
      throw new Error('DisabledGraphInventoryRuntimeConsumerResult consumerMode must be disabled-feature-flag');
    }
    if (item.featureEnabled !== false) {
      throw new Error('DisabledGraphInventoryRuntimeConsumerResult featureEnabled must be false');
    }
    if (item.result !== 'blocked') {
      throw new Error('DisabledGraphInventoryRuntimeConsumerResult result must be blocked');
    }
    for (const fieldName of [
      'runtimeGenerationEnabled',
      'repoWriteEnabled',
      'runtimeArtifactWriteEnabled',
      'externalCommandEnabled',
      'schedulerPublishEnabled',
      'doctorPublishEnabled',
      'skillPublishEnabled',
      'mcpPublishEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`DisabledGraphInventoryRuntimeConsumerResult ${fieldName} must be false`);
      }
    }
    assertGraphInventoryRuntimeIntegrationStorageInvariant(
      item,
      'DisabledGraphInventoryRuntimeConsumerResult',
    );
    assertPlainObject(item.reason, `DisabledGraphInventoryRuntimeConsumerResult.items[${index}].reason`);
    if (item.reason.code !== item.reasonCode) {
      throw new Error('DisabledGraphInventoryRuntimeConsumerResult reason code must match reasonCode');
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`DisabledGraphInventoryRuntimeConsumerResult reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(item.sourceDesign, `DisabledGraphInventoryRuntimeConsumerResult.items[${index}].sourceDesign`);
    if (item.sourceDesign.queryName !== 'createGraphInventoryRuntimeIntegrationDesign') {
      throw new Error('DisabledGraphInventoryRuntimeConsumerResult sourceDesign queryName must be createGraphInventoryRuntimeIntegrationDesign');
    }
    if (item.sourceDesign.artifactFamily !== 'site-capability-graph-inventory-runtime-integration-design') {
      throw new Error('DisabledGraphInventoryRuntimeConsumerResult sourceDesign artifactFamily must be site-capability-graph-inventory-runtime-integration-design');
    }
    assertPlainObject(item.inventoryArtifact, `DisabledGraphInventoryRuntimeConsumerResult.items[${index}].inventoryArtifact`);
    assertGraphQueryResultCompatible(item.inventoryArtifact);
    if (item.inventoryArtifact.artifactFamily !== 'site-capability-graph-inventory') {
      throw new Error('DisabledGraphInventoryRuntimeConsumerResult inventoryArtifact artifactFamily must be site-capability-graph-inventory');
    }
    if (item.inventoryArtifact.redactionRequired !== true) {
      throw new Error('DisabledGraphInventoryRuntimeConsumerResult inventoryArtifact redactionRequired must be true');
    }
    assertPlainObject(item.commandDesign, `DisabledGraphInventoryRuntimeConsumerResult.items[${index}].commandDesign`);
    assertGraphInventoryCommandDesignCompatibility(item.commandDesign);
  }
  return true;
}

/** @param {Record<string, any>} [design] */
export function createDisabledGraphInventoryRuntimeConsumerResult(design = {}, options = {}) {
  assertGraphInventoryRuntimeIntegrationDesignCompatibility(design);
  assertPlainObject(options, 'DisabledGraphInventoryRuntimeConsumerOptions');
  assertNoGraphInventoryRuntimeIntegrationStorageOptions(
    options,
    'DisabledGraphInventoryRuntimeConsumerOptions',
  );
  assertNoGraphInventoryRuntimeIntegrationProducts(
    options,
    'DisabledGraphInventoryRuntimeConsumerOptions',
  );
  assertNoForbiddenGraphFields(options, 'DisabledGraphInventoryRuntimeConsumerOptions');
  assertNoForbiddenPatterns(options);
  const {
    consumerName = 'site-capability-graph-inventory-runtime-consumer',
    featureEnabled,
    runtimeGenerationEnabled,
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
    schedulerPublishEnabled,
    doctorPublishEnabled,
    skillPublishEnabled,
    mcpPublishEnabled,
  } = options;
  for (const [fieldName, value] of Object.entries({
    featureEnabled,
    runtimeGenerationEnabled,
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
    schedulerPublishEnabled,
    doctorPublishEnabled,
    skillPublishEnabled,
    mcpPublishEnabled,
  })) {
    assertDisabledFlag(
      value,
      fieldName,
      'DisabledGraphInventoryRuntimeConsumerResult',
    );
  }
  const sourceItem = design.items[0];
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: design.graphVersion,
    queryName: 'createDisabledGraphInventoryRuntimeConsumerResult',
    artifactFamily: 'site-capability-graph-inventory-runtime-consumer-result',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      consumerName: assertRequiredText(
        consumerName,
        'consumerName',
        'DisabledGraphInventoryRuntimeConsumerResult',
      ),
      consumerMode: 'disabled-feature-flag',
      featureFlag: 'siteCapabilityGraphInventoryRuntimeEnabled',
      featureEnabled: false,
      result: 'blocked',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph inventory runtime consumer is disabled by feature flag',
      ),
      runtimeGenerationEnabled: false,
      repoWriteEnabled: false,
      runtimeArtifactWriteEnabled: false,
      externalCommandEnabled: false,
      schedulerPublishEnabled: false,
      doctorPublishEnabled: false,
      skillPublishEnabled: false,
      mcpPublishEnabled: false,
      ...GRAPH_INVENTORY_RUNTIME_INTEGRATION_STORAGE_INVARIANT,
      sourceDesign: {
        queryName: design.queryName,
        artifactFamily: design.artifactFamily,
        integrationMode: sourceItem.integrationMode,
      },
      inventoryArtifact: sourceItem.inventoryArtifact,
      commandDesign: sourceItem.commandDesign,
    }],
  };
  assertDisabledGraphInventoryRuntimeConsumerResultCompatibility(result);
  return cloneDescriptor(result);
}

const GRAPH_INVENTORY_RUNTIME_CONSUMER_HANDOFF_DISABLED_FLAG_KEYS = Object.freeze([
  'featureEnabled',
  'handoffEnabled',
  'runtimeHandoffEnabled',
  'consumerEnabled',
  'layerConsumerEnabled',
  'layerConsumerAllowed',
  'runtimeConsumerEnabled',
  'runtimeConsumerAllowed',
  'runtimeEnabled',
  'runtimeAllowed',
  'runtimeGenerationEnabled',
  'runtimeGenerationAllowed',
  'repoWriteEnabled',
  'repoWriteAllowed',
  'runtimeArtifactWriteEnabled',
  'runtimeArtifactWriteAllowed',
  'artifactWriteEnabled',
  'artifactWriteAllowed',
  'externalCommandEnabled',
  'externalCommandAllowed',
  'schedulerPublishEnabled',
  'schedulerPublishAllowed',
  'doctorPublishEnabled',
  'doctorPublishAllowed',
  'skillPublishEnabled',
  'skillPublishAllowed',
  'mcpPublishEnabled',
  'mcpPublishAllowed',
  'publishEnabled',
  'publishAllowed',
  'sessionMaterializationEnabled',
  'sessionMaterializationAllowed',
  'sessionViewEnabled',
  'sessionViewMaterializationEnabled',
  'downloadPolicyEnabled',
  'downloadPolicyMaterializationEnabled',
  'standardTaskListEnabled',
  'standardTaskListMaterializationEnabled',
  'siteAdapterEnabled',
  'siteAdapterAllowed',
  'siteAdapterExecutionEnabled',
  'siteAdapterExecutionAllowed',
  'downloaderEnabled',
  'downloaderAllowed',
  'downloaderExecutionEnabled',
  'downloaderExecutionAllowed',
  'databaseEnabled',
  'runtimeStatePersistenceEnabled',
  'dynamicRuntimeStateStored',
  'storageAdapterEnabled',
  'statePersistenceEnabled',
  'writeEnabled',
  'writeAllowed',
  'runtimeWriteEnabled',
  'runtimeWriteAllowed',
  'filesystemWriteEnabled',
  'filesystemWriteAllowed',
]);

const GRAPH_INVENTORY_RUNTIME_CONSUMER_HANDOFF_RUNTIME_PRODUCT_KEYS = Object.freeze([
  ...GRAPH_INVENTORY_RUNTIME_INTEGRATION_RUNTIME_PRODUCT_KEYS,
  'authorization',
  'authorizationHeader',
  'browserContext',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'csrf',
  'csrfToken',
  'downloadPolicy',
  'downloader',
  'externalCommand',
  'graphExecution',
  'mcpPublisher',
  'rawPayload',
  'rawSession',
  'runtimeArtifact',
  'runtimePayload',
  'scheduler',
  'sessionId',
  'sessionMaterial',
  'siteAdapter',
  'siteAdapterPayload',
  'standardTaskList',
  'token',
  'unredactedPayload',
]);

const GRAPH_INVENTORY_RUNTIME_CONSUMER_HANDOFF_DISABLED_FLAG_KEY_SET = new Set(
  GRAPH_INVENTORY_RUNTIME_CONSUMER_HANDOFF_DISABLED_FLAG_KEYS.map((key) => normalizeKey(key)),
);

const GRAPH_INVENTORY_RUNTIME_CONSUMER_HANDOFF_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_INVENTORY_RUNTIME_CONSUMER_HANDOFF_RUNTIME_PRODUCT_KEYS.map((key) => normalizeKey(key)),
);

function assertNoGraphInventoryRuntimeConsumerHandoffRuntimeProducts(
  value,
  label = 'GraphInventoryRuntimeConsumerHandoffGuard',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoGraphInventoryRuntimeConsumerHandoffRuntimeProducts(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (GRAPH_INVENTORY_RUNTIME_CONSUMER_HANDOFF_DISABLED_FLAG_KEY_SET.has(normalizedKey)) {
      if (entry !== false && entry !== undefined) {
        throw new Error(`${label} ${key} must remain false`);
      }
    } else if (GRAPH_INVENTORY_RUNTIME_CONSUMER_HANDOFF_RUNTIME_PRODUCT_KEY_SET.has(normalizedKey)) {
      throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${path}.${key}`);
    }
    assertNoGraphInventoryRuntimeConsumerHandoffRuntimeProducts(entry, label, `${path}.${key}`);
  }
  return true;
}

function summarizeFutureGraphLayerConsumerPreflightForInventoryHandoff(preflight) {
  assertFutureGraphLayerConsumerPreflightCompatibility(preflight);
  const item = preflight.items[0];
  return {
    queryName: preflight.queryName,
    artifactFamily: preflight.artifactFamily,
    graphVersion: preflight.graphVersion,
    redactionRequired: preflight.redactionRequired,
    consumerName: item.consumerName,
    contractMode: item.contractMode,
    descriptorOnly: item.descriptorOnly,
    result: item.result,
    reasonCode: item.reasonCode,
    sectionRef: item.sectionRef,
    contractRef: item.contractRef,
  };
}

function summarizeDisabledGraphInventoryRuntimeConsumerResultForHandoff(result) {
  assertDisabledGraphInventoryRuntimeConsumerResultCompatibility(result);
  const item = result.items[0];
  return {
    queryName: result.queryName,
    artifactFamily: result.artifactFamily,
    graphVersion: result.graphVersion,
    redactionRequired: result.redactionRequired,
    consumerName: item.consumerName,
    consumerMode: item.consumerMode,
    featureFlag: item.featureFlag,
    featureEnabled: item.featureEnabled,
    result: item.result,
    reasonCode: item.reasonCode,
    runtimeGenerationEnabled: item.runtimeGenerationEnabled,
    repoWriteEnabled: item.repoWriteEnabled,
    runtimeArtifactWriteEnabled: item.runtimeArtifactWriteEnabled,
    externalCommandEnabled: item.externalCommandEnabled,
    schedulerPublishEnabled: item.schedulerPublishEnabled,
    doctorPublishEnabled: item.doctorPublishEnabled,
    skillPublishEnabled: item.skillPublishEnabled,
    mcpPublishEnabled: item.mcpPublishEnabled,
    sourceDesign: cloneDescriptor(item.sourceDesign),
  };
}

function assertGraphInventoryRuntimeConsumerHandoffSourcePreflight(sourcePreflight, label) {
  assertPlainObject(sourcePreflight, `${label}.sourcePreflight`);
  if (sourcePreflight.queryName !== 'createFutureGraphLayerConsumerPreflightContract') {
    throw new Error(`${label} sourcePreflight queryName must be createFutureGraphLayerConsumerPreflightContract`);
  }
  if (sourcePreflight.artifactFamily !== 'site-capability-graph-future-layer-consumer-preflight-contract') {
    throw new Error(`${label} sourcePreflight artifactFamily must be site-capability-graph-future-layer-consumer-preflight-contract`);
  }
  if (sourcePreflight.redactionRequired !== true) {
    throw new Error(`${label} sourcePreflight redactionRequired must be true`);
  }
  if (sourcePreflight.contractMode !== 'descriptor-only-preflight') {
    throw new Error(`${label} sourcePreflight contractMode must be descriptor-only-preflight`);
  }
  if (sourcePreflight.descriptorOnly !== true) {
    throw new Error(`${label} sourcePreflight descriptorOnly must be true`);
  }
  if (sourcePreflight.result !== 'blocked') {
    throw new Error(`${label} sourcePreflight result must be blocked`);
  }
  if (sourcePreflight.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
    throw new Error(`${label} sourcePreflight reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  return true;
}

function assertGraphInventoryRuntimeConsumerHandoffDisabledConsumer(
  disabledRuntimeConsumer,
  label,
) {
  assertPlainObject(disabledRuntimeConsumer, `${label}.disabledRuntimeConsumer`);
  if (disabledRuntimeConsumer.queryName !== 'createDisabledGraphInventoryRuntimeConsumerResult') {
    throw new Error(`${label} disabledRuntimeConsumer queryName must be createDisabledGraphInventoryRuntimeConsumerResult`);
  }
  if (disabledRuntimeConsumer.artifactFamily !== 'site-capability-graph-inventory-runtime-consumer-result') {
    throw new Error(`${label} disabledRuntimeConsumer artifactFamily must be site-capability-graph-inventory-runtime-consumer-result`);
  }
  if (disabledRuntimeConsumer.redactionRequired !== true) {
    throw new Error(`${label} disabledRuntimeConsumer redactionRequired must be true`);
  }
  if (disabledRuntimeConsumer.consumerMode !== 'disabled-feature-flag') {
    throw new Error(`${label} disabledRuntimeConsumer consumerMode must be disabled-feature-flag`);
  }
  if (disabledRuntimeConsumer.featureEnabled !== false) {
    throw new Error(`${label} disabledRuntimeConsumer featureEnabled must be false`);
  }
  if (disabledRuntimeConsumer.result !== 'blocked') {
    throw new Error(`${label} disabledRuntimeConsumer result must be blocked`);
  }
  if (disabledRuntimeConsumer.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
    throw new Error(`${label} disabledRuntimeConsumer reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  for (const fieldName of [
    'runtimeGenerationEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
    'schedulerPublishEnabled',
    'doctorPublishEnabled',
    'skillPublishEnabled',
    'mcpPublishEnabled',
  ]) {
    if (disabledRuntimeConsumer[fieldName] !== false) {
      throw new Error(`${label} disabledRuntimeConsumer ${fieldName} must be false`);
    }
  }
  return true;
}

/** @param {Record<string, any>} [guard] */
export function assertGraphInventoryRuntimeConsumerHandoffGuardCompatibility(guard = {}) {
  assertPlainObject(guard, 'GraphInventoryRuntimeConsumerHandoffGuard');
  assertNoForbiddenGraphFields(guard, 'GraphInventoryRuntimeConsumerHandoffGuard');
  assertNoForbiddenPatterns(guard);
  assertGraphQueryResultCompatible(guard);
  if (guard.queryName !== 'createGraphInventoryRuntimeConsumerHandoffGuard') {
    throw new Error('GraphInventoryRuntimeConsumerHandoffGuard queryName must be createGraphInventoryRuntimeConsumerHandoffGuard');
  }
  if (guard.artifactFamily !== 'site-capability-graph-inventory-runtime-consumer-handoff-guard') {
    throw new Error('GraphInventoryRuntimeConsumerHandoffGuard artifactFamily must be site-capability-graph-inventory-runtime-consumer-handoff-guard');
  }
  if (guard.redactionRequired !== true) {
    throw new Error('GraphInventoryRuntimeConsumerHandoffGuard redactionRequired must be true');
  }
  if (!Array.isArray(guard.items) || guard.items.length === 0) {
    throw new Error('GraphInventoryRuntimeConsumerHandoffGuard items are required');
  }
  for (const [index, item] of guard.items.entries()) {
    const itemLabel = `GraphInventoryRuntimeConsumerHandoffGuard.items[${index}]`;
    assertPlainObject(item, itemLabel);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphInventoryRuntimeConsumerHandoffGuard item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.handoffMode !== 'descriptor-only') {
      throw new Error('GraphInventoryRuntimeConsumerHandoffGuard handoffMode must be descriptor-only');
    }
    if (item.result !== 'blocked') {
      throw new Error('GraphInventoryRuntimeConsumerHandoffGuard result must be blocked');
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`GraphInventoryRuntimeConsumerHandoffGuard reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(item.reason, `${itemLabel}.reason`);
    if (item.reason.code !== item.reasonCode) {
      throw new Error('GraphInventoryRuntimeConsumerHandoffGuard reason code must match reasonCode');
    }
    for (const fieldName of GRAPH_INVENTORY_RUNTIME_CONSUMER_HANDOFF_DISABLED_FLAG_KEYS) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphInventoryRuntimeConsumerHandoffGuard ${fieldName} must be false`);
      }
    }
    if (item.storageMode !== GRAPH_INVENTORY_RUNTIME_INTEGRATION_STORAGE_INVARIANT.storageMode) {
      throw new Error('GraphInventoryRuntimeConsumerHandoffGuard storageMode must be json-descriptor-only');
    }
    if (item.requiredPreflightGuard !== 'assertFutureGraphLayerConsumerPreflightCompatibility') {
      throw new Error('GraphInventoryRuntimeConsumerHandoffGuard requiredPreflightGuard must be assertFutureGraphLayerConsumerPreflightCompatibility');
    }
    if (
      item.requiredRuntimeConsumerGuard
        !== 'assertDisabledGraphInventoryRuntimeConsumerResultCompatibility'
    ) {
      throw new Error('GraphInventoryRuntimeConsumerHandoffGuard requiredRuntimeConsumerGuard must be assertDisabledGraphInventoryRuntimeConsumerResultCompatibility');
    }
    if (
      item.requiredHandoffGuard
        !== 'assertGraphInventoryRuntimeConsumerHandoffGuardCompatibility'
    ) {
      throw new Error('GraphInventoryRuntimeConsumerHandoffGuard requiredHandoffGuard must be assertGraphInventoryRuntimeConsumerHandoffGuardCompatibility');
    }
    assertPlainObject(item.requiredGuards, `${itemLabel}.requiredGuards`);
    if (item.requiredGuards.preflightGuard !== 'assertFutureGraphLayerConsumerPreflightCompatibility') {
      throw new Error('GraphInventoryRuntimeConsumerHandoffGuard preflightGuard is required');
    }
    if (
      item.requiredGuards.runtimeConsumerGuard
        !== 'assertDisabledGraphInventoryRuntimeConsumerResultCompatibility'
    ) {
      throw new Error('GraphInventoryRuntimeConsumerHandoffGuard runtimeConsumerGuard is required');
    }
    if (
      item.requiredGuards.handoffGuard
        !== 'assertGraphInventoryRuntimeConsumerHandoffGuardCompatibility'
    ) {
      throw new Error('GraphInventoryRuntimeConsumerHandoffGuard handoffGuard is required');
    }
    assertGraphInventoryRuntimeConsumerHandoffSourcePreflight(item.sourcePreflight, itemLabel);
    assertGraphInventoryRuntimeConsumerHandoffDisabledConsumer(
      item.sourceRuntimeConsumer ?? item.disabledRuntimeConsumer,
      itemLabel,
    );
    if (!Array.isArray(item.forbiddenRuntimeFields) || item.forbiddenRuntimeFields.length === 0) {
      throw new Error('GraphInventoryRuntimeConsumerHandoffGuard forbiddenRuntimeFields are required');
    }
  }
  assertNoGraphInventoryRuntimeConsumerHandoffRuntimeProducts(
    guard,
    'GraphInventoryRuntimeConsumerHandoffGuard',
  );
  return true;
}

export function createGraphInventoryRuntimeConsumerHandoffGuard(
  sources = {},
  options = {},
) {
  assertPlainObject(sources, 'GraphInventoryRuntimeConsumerHandoffGuardSources');
  assertPlainObject(options, 'GraphInventoryRuntimeConsumerHandoffGuardOptions');
  assertNoGraphInventoryRuntimeConsumerHandoffRuntimeProducts(
    options,
    'GraphInventoryRuntimeConsumerHandoffGuardOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphInventoryRuntimeConsumerHandoffGuardOptions');
  assertNoForbiddenPatterns(options);
  const {
    sourcePreflight,
    preflight = sourcePreflight,
    disabledRuntimeConsumer,
    runtimeConsumerResult = disabledRuntimeConsumer,
    sourceRuntimeConsumer = runtimeConsumerResult,
  } = sources;
  assertFutureGraphLayerConsumerPreflightCompatibility(preflight);
  assertDisabledGraphInventoryRuntimeConsumerResultCompatibility(sourceRuntimeConsumer);
  const {
    handoffName = 'site-capability-graph-inventory-runtime-consumer-handoff-guard',
  } = options;
  for (const fieldName of GRAPH_INVENTORY_RUNTIME_CONSUMER_HANDOFF_DISABLED_FLAG_KEYS) {
    assertDisabledFlag(
      options[fieldName],
      fieldName,
      'GraphInventoryRuntimeConsumerHandoffGuard',
    );
  }
  const disabledFlags = Object.fromEntries(
    GRAPH_INVENTORY_RUNTIME_CONSUMER_HANDOFF_DISABLED_FLAG_KEYS
      .map((fieldName) => [fieldName, false]),
  );
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: preflight.graphVersion,
    queryName: 'createGraphInventoryRuntimeConsumerHandoffGuard',
    artifactFamily: 'site-capability-graph-inventory-runtime-consumer-handoff-guard',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      queryName: 'createGraphInventoryRuntimeConsumerHandoffGuard',
      artifactFamily: 'site-capability-graph-inventory-runtime-consumer-handoff-guard',
      redactionRequired: true,
      handoffName: assertRequiredText(
        handoffName,
        'handoffName',
        'GraphInventoryRuntimeConsumerHandoffGuard',
      ),
      handoffMode: 'descriptor-only',
      result: 'blocked',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph inventory runtime consumer handoff is descriptor-only, blocked, and cannot generate, execute, publish, materialize sessions, or write artifacts',
      ),
      consumerName: sourceRuntimeConsumer.items[0].consumerName,
      requiredPreflightGuard: 'assertFutureGraphLayerConsumerPreflightCompatibility',
      requiredRuntimeConsumerGuard:
        'assertDisabledGraphInventoryRuntimeConsumerResultCompatibility',
      requiredHandoffGuard:
        'assertGraphInventoryRuntimeConsumerHandoffGuardCompatibility',
      requiredArtifactGuard: 'SecurityGuard/Redaction before graph-derived inventory runtime handoff output',
      requiredGuards: {
        preflightGuard: 'assertFutureGraphLayerConsumerPreflightCompatibility',
        runtimeConsumerGuard:
          'assertDisabledGraphInventoryRuntimeConsumerResultCompatibility',
        handoffGuard: 'assertGraphInventoryRuntimeConsumerHandoffGuardCompatibility',
      },
      sourcePreflight: summarizeFutureGraphLayerConsumerPreflightForInventoryHandoff(preflight),
      sourceRuntimeConsumer:
        summarizeDisabledGraphInventoryRuntimeConsumerResultForHandoff(sourceRuntimeConsumer),
      forbiddenRuntimeFields: [
        'runtimeGeneration',
        'repoWrite',
        'runtimeArtifactWrite',
        'externalCommand',
        'schedulerPublish',
        'doctorPublish',
        'skillPublish',
        'mcpPublish',
        'database',
        'runtimeState',
        'runtimeStateStore',
        'statePersistence',
        'storageAdapter',
        'sessionView',
        'downloadPolicy',
        'standardTaskList',
        'siteAdapter',
        'downloader',
        'taskList',
        'artifactPath',
        'inventoryOutputPath',
        'repoOutputPath',
        'outputPath',
        'writePath',
        'handler',
        'publisher',
        'runtimeSessionMaterial',
        'profileRuntimeMaterial',
        'sensitiveRuntimeMaterial',
      ],
      ...disabledFlags,
      storageMode: GRAPH_INVENTORY_RUNTIME_INTEGRATION_STORAGE_INVARIANT.storageMode,
    }],
  };
  assertGraphInventoryRuntimeConsumerHandoffGuardCompatibility(result);
  return cloneDescriptor(result);
}

const GRAPH_CORE_POSITIONING_RUNTIME_BOUNDARY_ACCEPTANCE_GUARD_DISABLED_FLAG_KEYS = Object.freeze([
  ...GRAPH_INVENTORY_RUNTIME_CONSUMER_HANDOFF_DISABLED_FLAG_KEYS,
  'graphExecutionEnabled',
  'runtimeLayerConsumerWiringEnabled',
  'runtimeLayerConsumerEnabled',
  'layerConsumerWiringEnabled',
  'repoWriteEnabled',
  'docsWriteEnabled',
  'runtimeArtifactWriteEnabled',
  'artifactWriteEnabled',
  'externalCommandEnabled',
  'taskRunnerEnabled',
  'schedulerPublishEnabled',
  'doctorPublishEnabled',
  'skillPublishEnabled',
  'mcpPublishEnabled',
  'siteAdapterEnabled',
  'downloaderEnabled',
  'sessionViewEnabled',
  'downloadPolicyEnabled',
  'standardTaskListEnabled',
  'profileMaterializationEnabled',
  'dynamicStateEnabled',
  'statePersistenceEnabled',
  'networkEnabled',
  'externalNetworkEnabled',
  'statusPromotionAllowed',
  'statusPromotionEnabled',
  'verifiedPromotionAllowed',
  'verifiedPromotionEnabled',
]);

const GRAPH_CORE_POSITIONING_RUNTIME_BOUNDARY_ACCEPTANCE_GUARD_DISABLED_FLAG_KEY_SET = new Set(
  GRAPH_CORE_POSITIONING_RUNTIME_BOUNDARY_ACCEPTANCE_GUARD_DISABLED_FLAG_KEYS
    .map((key) => normalizeKey(key)),
);

const GRAPH_CORE_POSITIONING_RUNTIME_BOUNDARY_ACCEPTANCE_GUARD_RUNTIME_PRODUCT_KEYS = Object.freeze([
  ...GRAPH_INVENTORY_RUNTIME_CONSUMER_HANDOFF_RUNTIME_PRODUCT_KEYS,
  'accessToken',
  'authorization',
  'authorizationHeader',
  'browserProfile',
  'cacheState',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'database',
  'db',
  'docsWrite',
  'doctorPublish',
  'dynamicState',
  'execute',
  'executor',
  'externalCommand',
  'externalNetwork',
  'graphExecution',
  'handler',
  'mcpPublish',
  'network',
  'outputPath',
  'profilePath',
  'repoPath',
  'repoWrite',
  'runtimeArtifactPath',
  'runtimeState',
  'schedulerPublish',
  'sessionId',
  'skillPublish',
  'statePersistence',
  'statusPromotion',
  'taskRunner',
  'token',
  'userDataDir',
  'verifiedPromotion',
]);

const GRAPH_CORE_POSITIONING_RUNTIME_BOUNDARY_ACCEPTANCE_GUARD_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_CORE_POSITIONING_RUNTIME_BOUNDARY_ACCEPTANCE_GUARD_RUNTIME_PRODUCT_KEYS
    .map((key) => normalizeKey(key)),
);

const GRAPH_AGGREGATE_EXECUTION_BOUNDARY_GUARD_DISABLED_FLAG_KEYS = Object.freeze([
  ...GRAPH_CORE_POSITIONING_RUNTIME_BOUNDARY_ACCEPTANCE_GUARD_DISABLED_FLAG_KEYS,
  'executionEnabled',
  'runtimeExecutionEnabled',
  'routeExecutionEnabled',
  'liveRouteExecutionEnabled',
  'layerBypassEnabled',
  'layerExecutionReplacementAllowed',
  'runtimeLayerConsumerEnabled',
  'runtimeLayerConsumerWiringEnabled',
  'siteAdapterInvocationEnabled',
  'downloaderInvocationEnabled',
  'sessionMaterializationEnabled',
  'externalDispatchEnabled',
  'externalTelemetryEnabled',
  'dynamicRuntimeStateStored',
  'credentialMaterializationEnabled',
]);

const GRAPH_AGGREGATE_EXECUTION_BOUNDARY_GUARD_DISABLED_FLAG_KEY_SET = new Set(
  GRAPH_AGGREGATE_EXECUTION_BOUNDARY_GUARD_DISABLED_FLAG_KEYS
    .map((key) => normalizeKey(key)),
);

const GRAPH_AGGREGATE_EXECUTION_BOUNDARY_GUARD_RUNTIME_PRODUCT_KEYS = Object.freeze([
  ...GRAPH_CORE_POSITIONING_RUNTIME_BOUNDARY_ACCEPTANCE_GUARD_RUNTIME_PRODUCT_KEYS,
  'artifactPayload',
  'authorization',
  'authorizationHeader',
  'browserProfile',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'downloadPolicy',
  'downloader',
  'execute',
  'executor',
  'externalDispatch',
  'externalTelemetry',
  'graphExecution',
  'handler',
  'outputPath',
  'rawPayload',
  'repoPath',
  'runtimeArtifact',
  'runtimePayload',
  'sessionId',
  'sessionView',
  'siteAdapter',
  'standardTaskList',
  'taskList',
  'taskRunner',
  'token',
  'unredactedPayload',
]);

const GRAPH_AGGREGATE_EXECUTION_BOUNDARY_GUARD_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_AGGREGATE_EXECUTION_BOUNDARY_GUARD_RUNTIME_PRODUCT_KEYS
    .map((key) => normalizeKey(key)),
);

function assertNoGraphCorePositioningRuntimeBoundaryAcceptanceGuardRuntimeProducts(
  value,
  label = 'GraphCorePositioningRuntimeBoundaryAcceptanceGuard',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => (
      assertNoGraphCorePositioningRuntimeBoundaryAcceptanceGuardRuntimeProducts(
        entry,
        label,
        `${path}[${index}]`,
      )
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (
      GRAPH_CORE_POSITIONING_RUNTIME_BOUNDARY_ACCEPTANCE_GUARD_DISABLED_FLAG_KEY_SET
        .has(normalizedKey)
    ) {
      if (entry !== false && entry !== undefined) {
        throw new Error(`${label} ${key} must remain false`);
      }
    } else if (
      GRAPH_CORE_POSITIONING_RUNTIME_BOUNDARY_ACCEPTANCE_GUARD_RUNTIME_PRODUCT_KEY_SET
        .has(normalizedKey)
    ) {
      throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${path}.${key}`);
    }
    assertNoGraphCorePositioningRuntimeBoundaryAcceptanceGuardRuntimeProducts(
      entry,
      label,
      `${path}.${key}`,
    );
  }
  return true;
}

function summarizeGraphInventoryRuntimeConsumerHandoffForCoreAcceptance(handoffGuard) {
  assertGraphInventoryRuntimeConsumerHandoffGuardCompatibility(handoffGuard);
  const item = handoffGuard.items[0];
  return {
    queryName: handoffGuard.queryName,
    artifactFamily: handoffGuard.artifactFamily,
    graphVersion: handoffGuard.graphVersion,
    redactionRequired: handoffGuard.redactionRequired,
    handoffName: item.handoffName,
    handoffMode: item.handoffMode,
    result: item.result,
    reasonCode: item.reasonCode,
    consumerName: item.consumerName,
    storageMode: item.storageMode,
    requiredGuards: cloneDescriptor(item.requiredGuards),
    sourcePreflight: cloneDescriptor(item.sourcePreflight),
    sourceRuntimeConsumer: cloneDescriptor(item.sourceRuntimeConsumer),
  };
}

function assertGraphCorePositioningRuntimeBoundaryAcceptanceSourceHandoff(
  sourceHandoff,
  label,
) {
  assertPlainObject(sourceHandoff, `${label}.sourceInventoryRuntimeConsumerHandoff`);
  if (sourceHandoff.queryName !== 'createGraphInventoryRuntimeConsumerHandoffGuard') {
    throw new Error(`${label} sourceInventoryRuntimeConsumerHandoff queryName must be createGraphInventoryRuntimeConsumerHandoffGuard`);
  }
  if (sourceHandoff.artifactFamily !== 'site-capability-graph-inventory-runtime-consumer-handoff-guard') {
    throw new Error(`${label} sourceInventoryRuntimeConsumerHandoff artifactFamily must be site-capability-graph-inventory-runtime-consumer-handoff-guard`);
  }
  if (sourceHandoff.redactionRequired !== true) {
    throw new Error(`${label} sourceInventoryRuntimeConsumerHandoff redactionRequired must be true`);
  }
  if (sourceHandoff.handoffMode !== 'descriptor-only') {
    throw new Error(`${label} sourceInventoryRuntimeConsumerHandoff handoffMode must be descriptor-only`);
  }
  if (sourceHandoff.result !== 'blocked') {
    throw new Error(`${label} sourceInventoryRuntimeConsumerHandoff result must be blocked`);
  }
  if (sourceHandoff.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
    throw new Error(`${label} sourceInventoryRuntimeConsumerHandoff reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  assertPlainObject(sourceHandoff.requiredGuards, `${label}.sourceInventoryRuntimeConsumerHandoff.requiredGuards`);
  if (sourceHandoff.requiredGuards.preflightGuard !== 'assertFutureGraphLayerConsumerPreflightCompatibility') {
    throw new Error(`${label} sourceInventoryRuntimeConsumerHandoff preflightGuard is required`);
  }
  if (
    sourceHandoff.requiredGuards.runtimeConsumerGuard
      !== 'assertDisabledGraphInventoryRuntimeConsumerResultCompatibility'
  ) {
    throw new Error(`${label} sourceInventoryRuntimeConsumerHandoff runtimeConsumerGuard is required`);
  }
  if (
    sourceHandoff.requiredGuards.handoffGuard
      !== 'assertGraphInventoryRuntimeConsumerHandoffGuardCompatibility'
  ) {
    throw new Error(`${label} sourceInventoryRuntimeConsumerHandoff handoffGuard is required`);
  }
  return true;
}

export function assertGraphCorePositioningRuntimeBoundaryAcceptanceGuardCompatibility(
  guard = {},
) {
  assertPlainObject(guard, 'GraphCorePositioningRuntimeBoundaryAcceptanceGuard');
  assertNoGraphCorePositioningRuntimeBoundaryAcceptanceGuardRuntimeProducts(
    guard,
    'GraphCorePositioningRuntimeBoundaryAcceptanceGuard',
  );
  assertNoForbiddenGraphFields(guard, 'GraphCorePositioningRuntimeBoundaryAcceptanceGuard');
  assertNoForbiddenPatterns(guard);
  assertGraphQueryResultCompatible(guard);
  if (guard.queryName !== 'createGraphCorePositioningRuntimeBoundaryAcceptanceGuard') {
    throw new Error('GraphCorePositioningRuntimeBoundaryAcceptanceGuard queryName must be createGraphCorePositioningRuntimeBoundaryAcceptanceGuard');
  }
  if (guard.artifactFamily !== 'site-capability-graph-core-positioning-runtime-boundary-acceptance-guard') {
    throw new Error('GraphCorePositioningRuntimeBoundaryAcceptanceGuard artifactFamily must be site-capability-graph-core-positioning-runtime-boundary-acceptance-guard');
  }
  if (guard.redactionRequired !== true) {
    throw new Error('GraphCorePositioningRuntimeBoundaryAcceptanceGuard redactionRequired must be true');
  }
  if (!Array.isArray(guard.items) || guard.items.length === 0) {
    throw new Error('GraphCorePositioningRuntimeBoundaryAcceptanceGuard items are required');
  }
  for (const [index, item] of guard.items.entries()) {
    const itemLabel = `GraphCorePositioningRuntimeBoundaryAcceptanceGuard.items[${index}]`;
    assertPlainObject(item, itemLabel);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphCorePositioningRuntimeBoundaryAcceptanceGuard item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.guardMode !== 'descriptor-only') {
      throw new Error('GraphCorePositioningRuntimeBoundaryAcceptanceGuard guardMode must be descriptor-only');
    }
    if (item.result !== 'blocked') {
      throw new Error('GraphCorePositioningRuntimeBoundaryAcceptanceGuard result must be blocked');
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`GraphCorePositioningRuntimeBoundaryAcceptanceGuard reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(item.reason, `${itemLabel}.reason`);
    if (item.reason.code !== item.reasonCode) {
      throw new Error('GraphCorePositioningRuntimeBoundaryAcceptanceGuard reason code must match reasonCode');
    }
    for (const fieldName of GRAPH_CORE_POSITIONING_RUNTIME_BOUNDARY_ACCEPTANCE_GUARD_DISABLED_FLAG_KEYS) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphCorePositioningRuntimeBoundaryAcceptanceGuard ${fieldName} must be false`);
      }
    }
    assertPlainObject(item.requiredGuards, `${itemLabel}.requiredGuards`);
    if (item.requiredGuards.preflightGuard !== 'assertFutureGraphLayerConsumerPreflightCompatibility') {
      throw new Error('GraphCorePositioningRuntimeBoundaryAcceptanceGuard preflightGuard is required');
    }
    if (
      item.requiredGuards.runtimeConsumerGuard
        !== 'assertDisabledGraphInventoryRuntimeConsumerResultCompatibility'
    ) {
      throw new Error('GraphCorePositioningRuntimeBoundaryAcceptanceGuard runtimeConsumerGuard is required');
    }
    if (
      item.requiredGuards.handoffGuard
        !== 'assertGraphInventoryRuntimeConsumerHandoffGuardCompatibility'
    ) {
      throw new Error('GraphCorePositioningRuntimeBoundaryAcceptanceGuard handoffGuard is required');
    }
    if (
      item.requiredGuards.corePositioningAcceptanceGuard
        !== 'assertGraphCorePositioningRuntimeBoundaryAcceptanceGuardCompatibility'
    ) {
      throw new Error('GraphCorePositioningRuntimeBoundaryAcceptanceGuard corePositioningAcceptanceGuard is required');
    }
    assertGraphCorePositioningRuntimeBoundaryAcceptanceSourceHandoff(
      item.sourceInventoryRuntimeConsumerHandoff,
      itemLabel,
    );
    if (!Array.isArray(item.forbiddenRuntimeFields) || item.forbiddenRuntimeFields.length === 0) {
      throw new Error('GraphCorePositioningRuntimeBoundaryAcceptanceGuard forbiddenRuntimeFields are required');
    }
  }
  return true;
}

export function createGraphCorePositioningRuntimeBoundaryAcceptanceGuard(
  sourceOrOptions = {},
  maybeOptions,
) {
  const calledWithOptions = maybeOptions === undefined && !normalizeText(sourceOrOptions.queryName);
  const options = calledWithOptions
    ? sourceOrOptions
    : maybeOptions ?? {};
  assertPlainObject(options, 'GraphCorePositioningRuntimeBoundaryAcceptanceGuardOptions');
  assertNoGraphCorePositioningRuntimeBoundaryAcceptanceGuardRuntimeProducts(
    options,
    'GraphCorePositioningRuntimeBoundaryAcceptanceGuardOptions',
  );
  assertNoForbiddenGraphFields(
    options,
    'GraphCorePositioningRuntimeBoundaryAcceptanceGuardOptions',
  );
  assertNoForbiddenPatterns(options);
  const sourceHandoff = calledWithOptions
    ? options.inventoryRuntimeConsumerHandoff
      ?? options.sourceInventoryRuntimeConsumerHandoff
      ?? options.sourceHandoff
    : sourceOrOptions;
  assertGraphInventoryRuntimeConsumerHandoffGuardCompatibility(sourceHandoff);
  const {
    guardName = 'site-capability-graph-core-positioning-runtime-boundary-acceptance-guard',
  } = options;
  for (const fieldName of GRAPH_CORE_POSITIONING_RUNTIME_BOUNDARY_ACCEPTANCE_GUARD_DISABLED_FLAG_KEYS) {
    assertDisabledFlag(
      options[fieldName],
      fieldName,
      'GraphCorePositioningRuntimeBoundaryAcceptanceGuard',
    );
  }
  const sourceItem = sourceHandoff.items[0];
  const disabledFlags = Object.fromEntries(
    GRAPH_CORE_POSITIONING_RUNTIME_BOUNDARY_ACCEPTANCE_GUARD_DISABLED_FLAG_KEYS
      .map((fieldName) => [fieldName, false]),
  );
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceHandoff.graphVersion,
    queryName: 'createGraphCorePositioningRuntimeBoundaryAcceptanceGuard',
    artifactFamily: 'site-capability-graph-core-positioning-runtime-boundary-acceptance-guard',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      queryName: 'createGraphCorePositioningRuntimeBoundaryAcceptanceGuard',
      artifactFamily: 'site-capability-graph-core-positioning-runtime-boundary-acceptance-guard',
      redactionRequired: true,
      guardName: assertRequiredText(
        guardName,
        'guardName',
        'GraphCorePositioningRuntimeBoundaryAcceptanceGuard',
      ),
      guardMode: 'descriptor-only',
      result: 'blocked',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph core positioning runtime boundary acceptance guard is descriptor-only, blocked, and cannot execute, write, publish, store state, use network, materialize sessions, or call runtime consumers',
      ),
      consumerName: sourceItem.consumerName,
      requiredGuards: {
        ...cloneDescriptor(sourceItem.requiredGuards),
        preflightGuard: 'assertFutureGraphLayerConsumerPreflightCompatibility',
        runtimeConsumerGuard:
          'assertDisabledGraphInventoryRuntimeConsumerResultCompatibility',
        handoffGuard: 'assertGraphInventoryRuntimeConsumerHandoffGuardCompatibility',
        corePositioningAcceptanceGuard:
          'assertGraphCorePositioningRuntimeBoundaryAcceptanceGuardCompatibility',
      },
      sourceInventoryRuntimeConsumerHandoff:
        summarizeGraphInventoryRuntimeConsumerHandoffForCoreAcceptance(sourceHandoff),
      forbiddenRuntimeFields: [
        'execute',
        'executor',
        'handler',
        'taskRunner',
        'graphExecution',
        'runtimeState',
        'dynamicState',
        'statePersistence',
        'cacheState',
        'database',
        'db',
        'repoWrite',
        'docsWrite',
        'artifactPath',
        'runtimeArtifactPath',
        'outputPath',
        'repoPath',
        'externalCommand',
        'network',
        'externalNetwork',
        'schedulerPublish',
        'doctorPublish',
        'skillPublish',
        'mcpPublish',
        'siteAdapter',
        'downloader',
        'sessionView',
        'downloadPolicy',
        'standardTaskList',
        'taskList',
        'profilePath',
        'userDataDir',
        'browserProfile',
        'credential',
        'cookie',
        'token',
        'sessionId',
        'authorization',
        'statusPromotion',
        'verifiedPromotion',
      ],
      ...disabledFlags,
    }],
  };
  assertGraphCorePositioningRuntimeBoundaryAcceptanceGuardCompatibility(result);
  return cloneDescriptor(result);
}

function assertNoGraphAggregateExecutionBoundaryGuardRuntimeProducts(
  value,
  label = 'GraphAggregateExecutionBoundaryGuard',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => (
      assertNoGraphAggregateExecutionBoundaryGuardRuntimeProducts(
        entry,
        label,
        `${path}[${index}]`,
      )
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (
      GRAPH_AGGREGATE_EXECUTION_BOUNDARY_GUARD_DISABLED_FLAG_KEY_SET
        .has(normalizedKey)
    ) {
      if (entry !== false && entry !== undefined) {
        throw new Error(`${label} ${key} must remain false`);
      }
    } else if (
      GRAPH_AGGREGATE_EXECUTION_BOUNDARY_GUARD_RUNTIME_PRODUCT_KEY_SET
        .has(normalizedKey)
    ) {
      throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${path}.${key}`);
    }
    assertNoGraphAggregateExecutionBoundaryGuardRuntimeProducts(
      entry,
      label,
      `${path}.${key}`,
    );
  }
  return true;
}

function summarizeGraphCorePositioningRuntimeBoundaryAcceptanceForAggregateExecution(
  sourceGuard,
) {
  assertGraphCorePositioningRuntimeBoundaryAcceptanceGuardCompatibility(sourceGuard);
  const item = sourceGuard.items[0];
  return {
    queryName: sourceGuard.queryName,
    artifactFamily: sourceGuard.artifactFamily,
    graphVersion: sourceGuard.graphVersion,
    redactionRequired: sourceGuard.redactionRequired,
    guardName: item.guardName,
    guardMode: item.guardMode,
    result: item.result,
    reasonCode: item.reasonCode,
    consumerName: item.consumerName,
    requiredGuards: cloneDescriptor(item.requiredGuards),
    sourceInventoryRuntimeConsumerHandoff: {
      queryName: item.sourceInventoryRuntimeConsumerHandoff.queryName,
      artifactFamily: item.sourceInventoryRuntimeConsumerHandoff.artifactFamily,
      graphVersion: item.sourceInventoryRuntimeConsumerHandoff.graphVersion,
      redactionRequired: item.sourceInventoryRuntimeConsumerHandoff.redactionRequired,
      handoffMode: item.sourceInventoryRuntimeConsumerHandoff.handoffMode,
      result: item.sourceInventoryRuntimeConsumerHandoff.result,
      reasonCode: item.sourceInventoryRuntimeConsumerHandoff.reasonCode,
    },
  };
}

function assertGraphAggregateExecutionBoundarySourceCoreGuard(sourceGuard, label) {
  assertPlainObject(sourceGuard, `${label}.sourceCorePositioningRuntimeBoundaryAcceptanceGuard`);
  if (sourceGuard.queryName !== 'createGraphCorePositioningRuntimeBoundaryAcceptanceGuard') {
    throw new Error(`${label} sourceCorePositioningRuntimeBoundaryAcceptanceGuard queryName must be createGraphCorePositioningRuntimeBoundaryAcceptanceGuard`);
  }
  if (sourceGuard.artifactFamily !== 'site-capability-graph-core-positioning-runtime-boundary-acceptance-guard') {
    throw new Error(`${label} sourceCorePositioningRuntimeBoundaryAcceptanceGuard artifactFamily must be site-capability-graph-core-positioning-runtime-boundary-acceptance-guard`);
  }
  if (sourceGuard.redactionRequired !== true) {
    throw new Error(`${label} sourceCorePositioningRuntimeBoundaryAcceptanceGuard redactionRequired must be true`);
  }
  if (sourceGuard.guardMode !== 'descriptor-only') {
    throw new Error(`${label} sourceCorePositioningRuntimeBoundaryAcceptanceGuard guardMode must be descriptor-only`);
  }
  if (sourceGuard.result !== 'blocked') {
    throw new Error(`${label} sourceCorePositioningRuntimeBoundaryAcceptanceGuard result must be blocked`);
  }
  if (sourceGuard.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
    throw new Error(`${label} sourceCorePositioningRuntimeBoundaryAcceptanceGuard reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  assertPlainObject(sourceGuard.requiredGuards, `${label}.sourceCorePositioningRuntimeBoundaryAcceptanceGuard.requiredGuards`);
  if (
    sourceGuard.requiredGuards.corePositioningAcceptanceGuard
      !== 'assertGraphCorePositioningRuntimeBoundaryAcceptanceGuardCompatibility'
  ) {
    throw new Error(`${label} sourceCorePositioningRuntimeBoundaryAcceptanceGuard corePositioningAcceptanceGuard is required`);
  }
  return true;
}

/** @param {Record<string, any>} [guard] */
export function assertGraphAggregateExecutionBoundaryGuardCompatibility(guard = {}) {
  assertPlainObject(guard, 'GraphAggregateExecutionBoundaryGuard');
  assertNoGraphAggregateExecutionBoundaryGuardRuntimeProducts(
    guard,
    'GraphAggregateExecutionBoundaryGuard',
  );
  assertNoForbiddenGraphFields(guard, 'GraphAggregateExecutionBoundaryGuard');
  assertNoForbiddenPatterns(guard);
  assertGraphQueryResultCompatible(guard);
  if (guard.queryName !== 'createGraphAggregateExecutionBoundaryGuard') {
    throw new Error('GraphAggregateExecutionBoundaryGuard queryName must be createGraphAggregateExecutionBoundaryGuard');
  }
  if (guard.artifactFamily !== 'site-capability-graph-aggregate-execution-boundary-guard') {
    throw new Error('GraphAggregateExecutionBoundaryGuard artifactFamily must be site-capability-graph-aggregate-execution-boundary-guard');
  }
  if (guard.redactionRequired !== true) {
    throw new Error('GraphAggregateExecutionBoundaryGuard redactionRequired must be true');
  }
  if (!Array.isArray(guard.items) || guard.items.length === 0) {
    throw new Error('GraphAggregateExecutionBoundaryGuard items are required');
  }
  for (const [index, item] of guard.items.entries()) {
    const itemLabel = `GraphAggregateExecutionBoundaryGuard.items[${index}]`;
    assertPlainObject(item, itemLabel);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphAggregateExecutionBoundaryGuard item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.guardMode !== 'descriptor-only') {
      throw new Error('GraphAggregateExecutionBoundaryGuard guardMode must be descriptor-only');
    }
    if (item.result !== 'blocked') {
      throw new Error('GraphAggregateExecutionBoundaryGuard result must be blocked');
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`GraphAggregateExecutionBoundaryGuard reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(item.reason, `${itemLabel}.reason`);
    if (item.reason.code !== item.reasonCode) {
      throw new Error('GraphAggregateExecutionBoundaryGuard reason code must match reasonCode');
    }
    if (item.layerExecutionEntrypoint !== 'Layer') {
      throw new Error('GraphAggregateExecutionBoundaryGuard layerExecutionEntrypoint must be Layer');
    }
    if (item.layerBypassPrevented !== true) {
      throw new Error('GraphAggregateExecutionBoundaryGuard layerBypassPrevented must be true');
    }
    for (const fieldName of GRAPH_AGGREGATE_EXECUTION_BOUNDARY_GUARD_DISABLED_FLAG_KEYS) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphAggregateExecutionBoundaryGuard ${fieldName} must be false`);
      }
    }
    assertPlainObject(item.requiredGuards, `${itemLabel}.requiredGuards`);
    if (
      item.requiredGuards.corePositioningAcceptanceGuard
        !== 'assertGraphCorePositioningRuntimeBoundaryAcceptanceGuardCompatibility'
    ) {
      throw new Error('GraphAggregateExecutionBoundaryGuard corePositioningAcceptanceGuard is required');
    }
    if (
      item.requiredGuards.aggregateExecutionBoundaryGuard
        !== 'assertGraphAggregateExecutionBoundaryGuardCompatibility'
    ) {
      throw new Error('GraphAggregateExecutionBoundaryGuard aggregateExecutionBoundaryGuard is required');
    }
    assertGraphAggregateExecutionBoundarySourceCoreGuard(
      item.sourceCorePositioningRuntimeBoundaryAcceptanceGuard,
      itemLabel,
    );
    if (!Array.isArray(item.forbiddenRuntimeFields) || item.forbiddenRuntimeFields.length === 0) {
      throw new Error('GraphAggregateExecutionBoundaryGuard forbiddenRuntimeFields are required');
    }
  }
  return true;
}

export function createGraphAggregateExecutionBoundaryGuard(
  sourceOrOptions = {},
  maybeOptions,
) {
  const calledWithOptions = maybeOptions === undefined && !normalizeText(sourceOrOptions.queryName);
  const options = calledWithOptions
    ? sourceOrOptions
    : maybeOptions ?? {};
  assertPlainObject(options, 'GraphAggregateExecutionBoundaryGuardOptions');
  assertNoGraphAggregateExecutionBoundaryGuardRuntimeProducts(
    options,
    'GraphAggregateExecutionBoundaryGuardOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphAggregateExecutionBoundaryGuardOptions');
  assertNoForbiddenPatterns(options);
  const sourceCoreGuard = calledWithOptions
    ? options.corePositioningRuntimeBoundaryAcceptanceGuard
      ?? options.sourceCorePositioningRuntimeBoundaryAcceptanceGuard
      ?? options.sourceGuard
      ?? options.sourceGuards?.[0]
    : sourceOrOptions;
  assertGraphCorePositioningRuntimeBoundaryAcceptanceGuardCompatibility(sourceCoreGuard);
  const {
    guardName = 'site-capability-graph-aggregate-execution-boundary-guard',
  } = options;
  for (const fieldName of GRAPH_AGGREGATE_EXECUTION_BOUNDARY_GUARD_DISABLED_FLAG_KEYS) {
    assertDisabledFlag(
      options[fieldName],
      fieldName,
      'GraphAggregateExecutionBoundaryGuard',
    );
  }
  const sourceItem = sourceCoreGuard.items[0];
  const disabledFlags = Object.fromEntries(
    GRAPH_AGGREGATE_EXECUTION_BOUNDARY_GUARD_DISABLED_FLAG_KEYS
      .map((fieldName) => [fieldName, false]),
  );
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceCoreGuard.graphVersion,
    queryName: 'createGraphAggregateExecutionBoundaryGuard',
    artifactFamily: 'site-capability-graph-aggregate-execution-boundary-guard',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      queryName: 'createGraphAggregateExecutionBoundaryGuard',
      artifactFamily: 'site-capability-graph-aggregate-execution-boundary-guard',
      redactionRequired: true,
      guardName: assertRequiredText(
        guardName,
        'guardName',
        'GraphAggregateExecutionBoundaryGuard',
      ),
      guardMode: 'descriptor-only',
      executionMode: 'descriptor-only',
      result: 'blocked',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph aggregate execution boundary guard is descriptor-only, blocked, and keeps Layer as the only execution entrypoint',
      ),
      layerExecutionEntrypoint: 'Layer',
      graphExecutionRole: 'descriptor-producer-only',
      graphExecutionBoundary: 'Graph cannot execute routes or tasks, become a second executor, or bypass Layer',
      layerBypassPrevented: true,
      sourceGuardName: sourceItem.guardName,
      requiredGuards: {
        corePositioningAcceptanceGuard:
          'assertGraphCorePositioningRuntimeBoundaryAcceptanceGuardCompatibility',
        aggregateExecutionBoundaryGuard:
          'assertGraphAggregateExecutionBoundaryGuardCompatibility',
      },
      sourceCorePositioningRuntimeBoundaryAcceptanceGuard:
        summarizeGraphCorePositioningRuntimeBoundaryAcceptanceForAggregateExecution(
          sourceCoreGuard,
        ),
      forbiddenRuntimeFields: [
        'graph execution',
        'route execution',
        'task execution',
        'runtime handler',
        'task runner',
        'SiteAdapter invocation',
        'downloader invocation',
        'SessionView materialization',
        'DownloadPolicy materialization',
        'StandardTaskList materialization',
        'repo write path',
        'docs write path',
        'runtime artifact write',
        'external dispatch',
        'external telemetry',
        'dynamic runtime state',
        'state persistence',
        'profile runtime material',
        'raw sensitive material',
        'credential header material',
      ],
      ...disabledFlags,
    }],
  };
  assertGraphAggregateExecutionBoundaryGuardCompatibility(result);
  return cloneDescriptor(result);
}

const GRAPH_LAYER_AGGREGATE_EXECUTION_BOUNDARY_HANDOFF_REVIEW_GATE_DISABLED_FLAG_KEYS = Object.freeze([
  ...GRAPH_AGGREGATE_EXECUTION_BOUNDARY_GUARD_DISABLED_FLAG_KEYS,
  'reviewExecutionEnabled',
  'handoffExecutionEnabled',
  'entrypointExecutionEnabled',
  'graphEntrypointEnabled',
  'graphExecutionEntrypointEnabled',
  'taskExecutionEnabled',
  'layerBypassAllowed',
  'layerRuntimeConsumerEnabled',
  'LayerRuntimeConsumerEnabled',
  'layerRuntimeConsumerAllowed',
  'callbackEnabled',
  'handlerEnabled',
  'repoWriteEnabled',
  'repoWriteAllowed',
  'docsWriteEnabled',
  'docsWriteAllowed',
  'runtimeArtifactWriteEnabled',
  'runtimeArtifactWriteAllowed',
  'writeEnabled',
  'externalTelemetryDispatchEnabled',
  'externalTelemetryDispatchAllowed',
  'externalDispatchEnabled',
  'externalDispatchAllowed',
  'profileRuntimeMaterializationEnabled',
  'profileRuntimeMaterializationAllowed',
  'sessionViewMaterializationEnabled',
  'sessionViewMaterializationAllowed',
  'downloadPolicyMaterializationEnabled',
  'downloadPolicyMaterializationAllowed',
  'downloadPolicyMaterialized',
  'standardTaskListMaterializationEnabled',
  'standardTaskListMaterializationAllowed',
  'standardTaskListMaterialized',
]);

const GRAPH_LAYER_AGGREGATE_EXECUTION_BOUNDARY_HANDOFF_REVIEW_GATE_RUNTIME_PRODUCT_KEYS = Object.freeze([
  ...GRAPH_AGGREGATE_EXECUTION_BOUNDARY_GUARD_RUNTIME_PRODUCT_KEYS,
  'browserProfilePath',
  'callback',
  'consumerCallback',
  'csrf',
  'csrfToken',
  'dispatch',
  'docsPath',
  'docsOutputPath',
  'docsWrite',
  'downloaderInvocation',
  'entrypoint',
  'executableHandler',
  'externalTelemetryDispatch',
  'filesystemWrite',
  'layerRuntimeConsumer',
  'runtimeConsumer',
  'repoWrite',
  'repoWritePath',
  'route',
  'routeExecution',
  'runtimeWrite',
  'runtimeArtifactPath',
  'session',
  'siteAdapterInvocation',
  'task',
  'taskExecution',
  'telemetryDispatch',
  'userDataDir',
  'writePath',
  'writer',
]);

const GRAPH_LAYER_AGGREGATE_EXECUTION_BOUNDARY_HANDOFF_REVIEW_GATE_DISABLED_FLAG_KEY_SET = new Set(
  GRAPH_LAYER_AGGREGATE_EXECUTION_BOUNDARY_HANDOFF_REVIEW_GATE_DISABLED_FLAG_KEYS
    .map((key) => normalizeKey(key)),
);

const GRAPH_LAYER_AGGREGATE_EXECUTION_BOUNDARY_HANDOFF_REVIEW_GATE_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_LAYER_AGGREGATE_EXECUTION_BOUNDARY_HANDOFF_REVIEW_GATE_RUNTIME_PRODUCT_KEYS
    .map((key) => normalizeKey(key)),
);

function assertNoGraphLayerAggregateExecutionBoundaryHandoffReviewGateRuntimeProducts(
  value,
  label = 'GraphLayerAggregateExecutionBoundaryHandoffReviewGate',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => (
      assertNoGraphLayerAggregateExecutionBoundaryHandoffReviewGateRuntimeProducts(
        entry,
        label,
        `${path}[${index}]`,
      )
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (
      GRAPH_LAYER_AGGREGATE_EXECUTION_BOUNDARY_HANDOFF_REVIEW_GATE_DISABLED_FLAG_KEY_SET
        .has(normalizedKey)
    ) {
      if (entry !== false && entry !== undefined) {
        throw new Error(`${label} ${key} must remain false`);
      }
    } else if (
      GRAPH_LAYER_AGGREGATE_EXECUTION_BOUNDARY_HANDOFF_REVIEW_GATE_RUNTIME_PRODUCT_KEY_SET
        .has(normalizedKey)
    ) {
      throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${path}.${key}`);
    }
    assertNoGraphLayerAggregateExecutionBoundaryHandoffReviewGateRuntimeProducts(
      entry,
      label,
      `${path}.${key}`,
    );
  }
  return true;
}

function summarizeGraphAggregateExecutionBoundaryGuardForHandoffReviewGate(
  aggregateGuard,
) {
  assertGraphAggregateExecutionBoundaryGuardCompatibility(aggregateGuard);
  const item = aggregateGuard.items[0];
  return {
    queryName: aggregateGuard.queryName,
    artifactFamily: aggregateGuard.artifactFamily,
    graphVersion: aggregateGuard.graphVersion,
    redactionRequired: aggregateGuard.redactionRequired,
    guardName: item.guardName,
    guardMode: item.guardMode,
    executionMode: item.executionMode,
    result: item.result,
    reasonCode: item.reasonCode,
    layerExecutionEntrypoint: item.layerExecutionEntrypoint,
    graphExecutionRole: item.graphExecutionRole,
    graphExecutionBoundary: item.graphExecutionBoundary,
    layerBypassPrevented: item.layerBypassPrevented,
    requiredGuards: cloneDescriptor(item.requiredGuards),
  };
}

function assertGraphLayerAggregateExecutionBoundaryHandoffReviewGateSourceAggregateGuard(
  sourceGuard,
  label,
) {
  assertPlainObject(sourceGuard, `${label}.sourceAggregateExecutionBoundaryGuard`);
  if (sourceGuard.queryName !== 'createGraphAggregateExecutionBoundaryGuard') {
    throw new Error(`${label} sourceAggregateExecutionBoundaryGuard queryName must be createGraphAggregateExecutionBoundaryGuard`);
  }
  if (sourceGuard.artifactFamily !== 'site-capability-graph-aggregate-execution-boundary-guard') {
    throw new Error(`${label} sourceAggregateExecutionBoundaryGuard artifactFamily must be site-capability-graph-aggregate-execution-boundary-guard`);
  }
  if (sourceGuard.redactionRequired !== true) {
    throw new Error(`${label} sourceAggregateExecutionBoundaryGuard redactionRequired must be true`);
  }
  if (sourceGuard.guardMode !== 'descriptor-only') {
    throw new Error(`${label} sourceAggregateExecutionBoundaryGuard guardMode must be descriptor-only`);
  }
  if (sourceGuard.executionMode !== 'descriptor-only') {
    throw new Error(`${label} sourceAggregateExecutionBoundaryGuard executionMode must be descriptor-only`);
  }
  if (sourceGuard.result !== 'blocked') {
    throw new Error(`${label} sourceAggregateExecutionBoundaryGuard result must be blocked`);
  }
  if (sourceGuard.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
    throw new Error(`${label} sourceAggregateExecutionBoundaryGuard reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  if (sourceGuard.layerExecutionEntrypoint !== 'Layer') {
    throw new Error(`${label} sourceAggregateExecutionBoundaryGuard layerExecutionEntrypoint must be Layer`);
  }
  if (sourceGuard.layerBypassPrevented !== true) {
    throw new Error(`${label} sourceAggregateExecutionBoundaryGuard layerBypassPrevented must be true`);
  }
  assertPlainObject(sourceGuard.requiredGuards, `${label}.sourceAggregateExecutionBoundaryGuard.requiredGuards`);
  if (
    sourceGuard.requiredGuards.aggregateExecutionBoundaryGuard
      !== 'assertGraphAggregateExecutionBoundaryGuardCompatibility'
  ) {
    throw new Error(`${label} sourceAggregateExecutionBoundaryGuard aggregateExecutionBoundaryGuard is required`);
  }
  return true;
}

export function assertGraphLayerAggregateExecutionBoundaryHandoffReviewGateCompatibility(
  gate = {},
) {
  assertPlainObject(gate, 'GraphLayerAggregateExecutionBoundaryHandoffReviewGate');
  assertNoGraphLayerAggregateExecutionBoundaryHandoffReviewGateRuntimeProducts(
    gate,
    'GraphLayerAggregateExecutionBoundaryHandoffReviewGate',
  );
  assertNoForbiddenGraphFields(gate, 'GraphLayerAggregateExecutionBoundaryHandoffReviewGate');
  assertNoForbiddenPatterns(gate);
  assertGraphQueryResultCompatible(gate);
  if (gate.queryName !== 'createGraphLayerAggregateExecutionBoundaryHandoffReviewGate') {
    throw new Error('GraphLayerAggregateExecutionBoundaryHandoffReviewGate queryName must be createGraphLayerAggregateExecutionBoundaryHandoffReviewGate');
  }
  if (gate.artifactFamily !== 'site-capability-graph-layer-aggregate-execution-boundary-handoff-review-gate') {
    throw new Error('GraphLayerAggregateExecutionBoundaryHandoffReviewGate artifactFamily must be site-capability-graph-layer-aggregate-execution-boundary-handoff-review-gate');
  }
  if (gate.redactionRequired !== true) {
    throw new Error('GraphLayerAggregateExecutionBoundaryHandoffReviewGate redactionRequired must be true');
  }
  if (!Array.isArray(gate.items) || gate.items.length === 0) {
    throw new Error('GraphLayerAggregateExecutionBoundaryHandoffReviewGate items are required');
  }
  for (const [index, item] of gate.items.entries()) {
    const itemLabel = `GraphLayerAggregateExecutionBoundaryHandoffReviewGate.items[${index}]`;
    assertPlainObject(item, itemLabel);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphLayerAggregateExecutionBoundaryHandoffReviewGate item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.gateMode !== 'descriptor-only') {
      throw new Error('GraphLayerAggregateExecutionBoundaryHandoffReviewGate gateMode must be descriptor-only');
    }
    if (item.executionMode !== 'descriptor-only') {
      throw new Error('GraphLayerAggregateExecutionBoundaryHandoffReviewGate executionMode must be descriptor-only');
    }
    if (item.result !== 'blocked') {
      throw new Error('GraphLayerAggregateExecutionBoundaryHandoffReviewGate result must be blocked');
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`GraphLayerAggregateExecutionBoundaryHandoffReviewGate reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(item.reason, `${itemLabel}.reason`);
    if (item.reason.code !== item.reasonCode) {
      throw new Error('GraphLayerAggregateExecutionBoundaryHandoffReviewGate reason code must match reasonCode');
    }
    if (item.layerExecutionEntrypoint !== 'Layer') {
      throw new Error('GraphLayerAggregateExecutionBoundaryHandoffReviewGate layerExecutionEntrypoint must be Layer');
    }
    if (item.graphExecutionEntrypointAllowed !== false) {
      throw new Error('GraphLayerAggregateExecutionBoundaryHandoffReviewGate graphExecutionEntrypointAllowed must be false');
    }
    if (item.layerBypassPrevented !== true) {
      throw new Error('GraphLayerAggregateExecutionBoundaryHandoffReviewGate layerBypassPrevented must be true');
    }
    if (item.layerStillExecutionEntrypoint !== true) {
      throw new Error('GraphLayerAggregateExecutionBoundaryHandoffReviewGate layerStillExecutionEntrypoint must be true');
    }
    for (const fieldName of GRAPH_LAYER_AGGREGATE_EXECUTION_BOUNDARY_HANDOFF_REVIEW_GATE_DISABLED_FLAG_KEYS) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphLayerAggregateExecutionBoundaryHandoffReviewGate ${fieldName} must be false`);
      }
    }
    assertPlainObject(item.requiredGuards, `${itemLabel}.requiredGuards`);
    if (
      item.requiredGuards.aggregateExecutionBoundaryGuard
        !== 'assertGraphAggregateExecutionBoundaryGuardCompatibility'
    ) {
      throw new Error('GraphLayerAggregateExecutionBoundaryHandoffReviewGate aggregateExecutionBoundaryGuard is required');
    }
    if (
      item.requiredGuards.handoffReviewGate
        !== 'assertGraphLayerAggregateExecutionBoundaryHandoffReviewGateCompatibility'
    ) {
      throw new Error('GraphLayerAggregateExecutionBoundaryHandoffReviewGate handoffReviewGate is required');
    }
    if (
      item.plannerLayerEntrypointHandoffPrerequisiteName
        !== 'planner-layer-entrypoint-handoff-guard-safe-summary'
    ) {
      throw new Error('GraphLayerAggregateExecutionBoundaryHandoffReviewGate plannerLayerEntrypointHandoffPrerequisiteName is required');
    }
    if (item.plannerLayerEntrypointHandoffSourceStatus !== 'not-consumed-not-present-in-site-capability-graph') {
      throw new Error('GraphLayerAggregateExecutionBoundaryHandoffReviewGate plannerLayerEntrypointHandoffSourceStatus must record missing local safe summary');
    }
    assertGraphLayerAggregateExecutionBoundaryHandoffReviewGateSourceAggregateGuard(
      item.sourceAggregateExecutionBoundaryGuard,
      itemLabel,
    );
    if (!Array.isArray(item.forbiddenRuntimeFields) || item.forbiddenRuntimeFields.length === 0) {
      throw new Error('GraphLayerAggregateExecutionBoundaryHandoffReviewGate forbiddenRuntimeFields are required');
    }
    if (!Array.isArray(item.boundaryAssertions) || item.boundaryAssertions.length === 0) {
      throw new Error('GraphLayerAggregateExecutionBoundaryHandoffReviewGate boundaryAssertions are required');
    }
  }
  return true;
}

export function createGraphLayerAggregateExecutionBoundaryHandoffReviewGate(
  sourceOrOptions = {},
  maybeOptions,
) {
  const calledWithOptions = maybeOptions === undefined && !normalizeText(sourceOrOptions.queryName);
  const options = calledWithOptions
    ? sourceOrOptions
    : maybeOptions ?? {};
  assertPlainObject(options, 'GraphLayerAggregateExecutionBoundaryHandoffReviewGateOptions');
  assertNoGraphLayerAggregateExecutionBoundaryHandoffReviewGateRuntimeProducts(
    options,
    'GraphLayerAggregateExecutionBoundaryHandoffReviewGateOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphLayerAggregateExecutionBoundaryHandoffReviewGateOptions');
  assertNoForbiddenPatterns(options);
  const sourceAggregateGuard = calledWithOptions
    ? options.aggregateExecutionBoundaryGuard
      ?? options.sourceAggregateExecutionBoundaryGuard
      ?? options.sourceGuard
      ?? options.sourceGuards?.[0]
    : sourceOrOptions;
  assertGraphAggregateExecutionBoundaryGuardCompatibility(sourceAggregateGuard);
  const {
    gateName = 'site-capability-graph-layer-aggregate-execution-boundary-handoff-review-gate',
  } = options;
  for (const fieldName of GRAPH_LAYER_AGGREGATE_EXECUTION_BOUNDARY_HANDOFF_REVIEW_GATE_DISABLED_FLAG_KEYS) {
    assertDisabledFlag(
      options[fieldName],
      fieldName,
      'GraphLayerAggregateExecutionBoundaryHandoffReviewGate',
    );
  }
  const disabledFlags = Object.fromEntries(
    GRAPH_LAYER_AGGREGATE_EXECUTION_BOUNDARY_HANDOFF_REVIEW_GATE_DISABLED_FLAG_KEYS
      .map((fieldName) => [fieldName, false]),
  );
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceAggregateGuard.graphVersion,
    queryName: 'createGraphLayerAggregateExecutionBoundaryHandoffReviewGate',
    artifactFamily: 'site-capability-graph-layer-aggregate-execution-boundary-handoff-review-gate',
    redactionRequired: true,
    descriptorOnly: true,
    result: 'blocked',
    reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
    items: [{
      schemaVersion: 1,
      queryName: 'createGraphLayerAggregateExecutionBoundaryHandoffReviewGate',
      artifactFamily: 'site-capability-graph-layer-aggregate-execution-boundary-handoff-review-gate',
      redactionRequired: true,
      gateName: assertRequiredText(
        gateName,
        'gateName',
        'GraphLayerAggregateExecutionBoundaryHandoffReviewGate',
      ),
      gateMode: 'descriptor-only',
      executionMode: 'descriptor-only',
      result: 'blocked',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph Layer aggregate execution boundary handoff review gate is descriptor-only, blocked, and cannot become an execution entrypoint or bypass Layer',
      ),
      layerExecutionEntrypoint: 'Layer',
      layerStillExecutionEntrypoint: true,
      graphExecutionEntrypointAllowed: false,
      graphExecutionRole: 'descriptor-review-gate-only',
      layerBypassPrevented: true,
      plannerLayerEntrypointHandoffPrerequisiteName:
        'planner-layer-entrypoint-handoff-guard-safe-summary',
      plannerLayerEntrypointHandoffSourceStatus:
        'not-consumed-not-present-in-site-capability-graph',
      requiredGuards: {
        aggregateExecutionBoundaryGuard:
          'assertGraphAggregateExecutionBoundaryGuardCompatibility',
        handoffReviewGate:
          'assertGraphLayerAggregateExecutionBoundaryHandoffReviewGateCompatibility',
      },
      sourceAggregateExecutionBoundaryGuard:
        summarizeGraphAggregateExecutionBoundaryGuardForHandoffReviewGate(
          sourceAggregateGuard,
        ),
      boundaryAssertions: [
        'Graph cannot become an execution entrypoint',
        'Graph cannot bypass Layer',
        'Layer remains the execution entrypoint',
        'Graph does not execute routes or tasks',
        'Graph does not call SiteAdapter or downloader',
        'Graph does not materialize SessionView, DownloadPolicy, or StandardTaskList',
        'Graph does not write repo, docs, or runtime artifacts',
        'Graph does not external dispatch or telemetry',
        'Graph does not store dynamic state or sensitive data',
      ],
      forbiddenRuntimeFields: [
        'executable handler',
        'callback',
        'task execution',
        'route execution',
        'Layer runtime consumer',
        'SiteAdapter',
        'downloader',
        'SessionView',
        'DownloadPolicy',
        'StandardTaskList',
        'repo write',
        'docs write',
        'runtime artifact write',
        'external telemetry',
        'external dispatch',
        'profile runtime material',
        'sensitive credential material',
        'sensitive authentication material',
        'sensitive session material',
      ],
      ...disabledFlags,
    }],
  };
  assertGraphLayerAggregateExecutionBoundaryHandoffReviewGateCompatibility(result);
  return cloneDescriptor(result);
}

function normalizeGraphInventoryRepoOutputTarget(value) {
  const text = assertRequiredText(
    value ?? 'runs/site-capability-graph/generated-site-capability-graph.json',
    'targetRelativePath',
    'GraphInventoryRepoOutputDryRun',
  ).replace(/\\/gu, '/');
  if (/^(?:[a-z]:|\/)/iu.test(text)) {
    throw new Error('GraphInventoryRepoOutputDryRun targetRelativePath must be repo-relative');
  }
  if (text.split('/').some((segment) => segment === '..')) {
    throw new Error('GraphInventoryRepoOutputDryRun targetRelativePath must stay within the repository');
  }
  if (!/^runs\/site-capability-graph\/[a-z0-9][a-z0-9-]{0,79}\.json$/u.test(text)) {
    throw new Error('GraphInventoryRepoOutputDryRun targetRelativePath must be runs/site-capability-graph/<artifact>.json');
  }
  assertNoForbiddenPatterns(text);
  return text;
}

/** @param {Record<string, any>} [result] */
export function assertGraphInventoryRepoOutputDryRunCompatibility(result = {}) {
  assertPlainObject(result, 'GraphInventoryRepoOutputDryRun');
  assertNoGraphInventoryRuntimeIntegrationProducts(result, 'GraphInventoryRepoOutputDryRun');
  assertNoForbiddenGraphFields(result, 'GraphInventoryRepoOutputDryRun');
  assertNoForbiddenPatterns(result);
  assertGraphQueryResultCompatible(result);
  if (result.queryName !== 'createGraphInventoryRepoOutputDryRun') {
    throw new Error('GraphInventoryRepoOutputDryRun queryName must be createGraphInventoryRepoOutputDryRun');
  }
  if (result.artifactFamily !== 'site-capability-graph-inventory-repo-output-dry-run') {
    throw new Error('GraphInventoryRepoOutputDryRun artifactFamily must be site-capability-graph-inventory-repo-output-dry-run');
  }
  if (result.redactionRequired !== true) {
    throw new Error('GraphInventoryRepoOutputDryRun redactionRequired must be true');
  }
  if (!Array.isArray(result.items) || result.items.length === 0) {
    throw new Error('GraphInventoryRepoOutputDryRun items are required');
  }
  for (const [index, item] of result.items.entries()) {
    assertPlainObject(item, `GraphInventoryRepoOutputDryRun.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphInventoryRepoOutputDryRun item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.outputMode !== 'dry-run-preview') {
      throw new Error('GraphInventoryRepoOutputDryRun outputMode must be dry-run-preview');
    }
    if (item.dryRunOnly !== true) {
      throw new Error('GraphInventoryRepoOutputDryRun dryRunOnly must be true');
    }
    for (const fieldName of [
      'repoWriteEnabled',
      'runtimeGenerationEnabled',
      'runtimeArtifactWriteEnabled',
      'externalCommandEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphInventoryRepoOutputDryRun ${fieldName} must be false`);
      }
    }
    assertGraphInventoryRuntimeIntegrationStorageInvariant(
      item,
      'GraphInventoryRepoOutputDryRun',
    );
    if (item.explicitValidationRequired !== true) {
      throw new Error('GraphInventoryRepoOutputDryRun explicitValidationRequired must be true');
    }
    normalizeGraphInventoryRepoOutputTarget(item.targetRelativePath);
    assertPlainObject(item.inventoryArtifact, `GraphInventoryRepoOutputDryRun.items[${index}].inventoryArtifact`);
    assertGraphQueryResultCompatible(item.inventoryArtifact);
    if (item.inventoryArtifact.artifactFamily !== 'site-capability-graph-inventory') {
      throw new Error('GraphInventoryRepoOutputDryRun inventoryArtifact artifactFamily must be site-capability-graph-inventory');
    }
    if (item.inventoryArtifact.redactionRequired !== true) {
      throw new Error('GraphInventoryRepoOutputDryRun inventoryArtifact redactionRequired must be true');
    }
  }
  return true;
}

/** @param {Record<string, any>} [graph] */
export function createGraphInventoryRepoOutputDryRun(graph = {}, options = {}) {
  assertPlainObject(options, 'GraphInventoryRepoOutputDryRunOptions');
  assertNoGraphInventoryRuntimeIntegrationStorageOptions(
    options,
    'GraphInventoryRepoOutputDryRunOptions',
  );
  assertNoGraphInventoryRuntimeIntegrationProducts(
    options,
    'GraphInventoryRepoOutputDryRunOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphInventoryRepoOutputDryRunOptions');
  assertNoForbiddenPatterns(options);
  const {
    inventoryName = 'generated-site-capability-graph',
    source = 'synthetic-generated-fixture',
    targetRelativePath,
    repoWriteEnabled,
    runtimeGenerationEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
  } = options;
  for (const [fieldName, value] of Object.entries({
    repoWriteEnabled,
    runtimeGenerationEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
  })) {
    assertDisabledFlag(
      value,
      fieldName,
      'GraphInventoryRepoOutputDryRun',
    );
  }
  const inventoryArtifact = createGraphInventoryArtifact(graph, {
    inventoryName,
    source,
  });
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: inventoryArtifact.graphVersion,
    queryName: 'createGraphInventoryRepoOutputDryRun',
    artifactFamily: 'site-capability-graph-inventory-repo-output-dry-run',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      outputMode: 'dry-run-preview',
      dryRunOnly: true,
      targetRelativePath: normalizeGraphInventoryRepoOutputTarget(targetRelativePath),
      repoWriteEnabled: false,
      runtimeGenerationEnabled: false,
      runtimeArtifactWriteEnabled: false,
      externalCommandEnabled: false,
      ...GRAPH_INVENTORY_RUNTIME_INTEGRATION_STORAGE_INVARIANT,
      explicitValidationRequired: true,
      requiredArtifactGuard: 'SecurityGuard/Redaction before graph-derived artifact writes',
      inventoryArtifact,
    }],
  };
  assertGraphInventoryRepoOutputDryRunCompatibility(result);
  return cloneDescriptor(result);
}

const GRAPH_REPO_OUTPUT_APPROVAL_GATE_ALLOWED_SOURCE_FAMILIES = new Set([
  'site-capability-graph-docs-markdown-repo-output-dry-run',
  'site-capability-graph-inventory-repo-output-dry-run',
  'site-capability-graph-migration-report-repo-output-dry-run',
]);

const GRAPH_REPO_OUTPUT_APPROVAL_GATE_RUNTIME_PRODUCT_KEYS = Object.freeze([
  'artifactPath',
  'downloadPolicy',
  'externalCommand',
  'externalDispatch',
  'externalTelemetry',
  'filesystemWrite',
  'outputPath',
  'publishPayload',
  'repoPath',
  'repositoryPath',
  'runtimeArtifact',
  'runtimeWriter',
  'sessionView',
  'standardTaskList',
  'taskList',
  'unredactedPayload',
  'writePath',
  'writer',
]);

const GRAPH_REPO_OUTPUT_APPROVAL_GATE_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_REPO_OUTPUT_APPROVAL_GATE_RUNTIME_PRODUCT_KEYS.map((key) => normalizeKey(key)),
);

function assertNoGraphRepoOutputApprovalGateRuntimeProducts(
  value,
  label = 'GraphRepoOutputApprovalGateDesign',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoGraphRepoOutputApprovalGateRuntimeProducts(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (GRAPH_REPO_OUTPUT_APPROVAL_GATE_RUNTIME_PRODUCT_KEY_SET.has(normalizeKey(key))) {
      throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${path}.${key}`);
    }
    assertNoGraphRepoOutputApprovalGateRuntimeProducts(entry, label, `${path}.${key}`);
  }
  return true;
}

/** @param {Record<string, any>} [source] */
function assertGraphRepoOutputApprovalGateSourceCompatible(source = {}) {
  assertPlainObject(source, 'GraphRepoOutputApprovalGateDesign.sourceRepoOutput');
  assertGraphQueryResultCompatible(source);
  if (!GRAPH_REPO_OUTPUT_APPROVAL_GATE_ALLOWED_SOURCE_FAMILIES.has(source.artifactFamily)) {
    throw new Error('GraphRepoOutputApprovalGateDesign sourceRepoOutput must be a graph repo output dry-run descriptor');
  }
  if (source.artifactFamily === 'site-capability-graph-docs-markdown-repo-output-dry-run') {
    assertGraphDocsMarkdownRepoOutputDryRunCompatibility(source);
  } else if (source.artifactFamily === 'site-capability-graph-inventory-repo-output-dry-run') {
    assertGraphInventoryRepoOutputDryRunCompatibility(source);
  } else if (source.artifactFamily === 'site-capability-graph-migration-report-repo-output-dry-run') {
    assertGraphMigrationReportRepoOutputDryRunCompatibility(source);
  }
  for (const [index, item] of source.items.entries()) {
    if (item.dryRunOnly !== true) {
      throw new Error(`GraphRepoOutputApprovalGateDesign sourceRepoOutput.items[${index}] dryRunOnly must be true`);
    }
    if (item.explicitValidationRequired !== true) {
      throw new Error(`GraphRepoOutputApprovalGateDesign sourceRepoOutput.items[${index}] explicitValidationRequired must be true`);
    }
    if (item.repoWriteEnabled !== false) {
      throw new Error(`GraphRepoOutputApprovalGateDesign sourceRepoOutput.items[${index}] repoWriteEnabled must be false`);
    }
  }
  return true;
}

/** @param {Record<string, any>} [design] */
export function assertGraphRepoOutputApprovalGateDesignCompatibility(design = {}) {
  assertPlainObject(design, 'GraphRepoOutputApprovalGateDesign');
  assertNoGraphRepoOutputApprovalGateRuntimeProducts(design);
  assertNoForbiddenGraphFields(design, 'GraphRepoOutputApprovalGateDesign');
  assertNoForbiddenPatterns(design);
  assertGraphQueryResultCompatible(design);
  if (design.queryName !== 'createGraphRepoOutputApprovalGateDesign') {
    throw new Error('GraphRepoOutputApprovalGateDesign queryName must be createGraphRepoOutputApprovalGateDesign');
  }
  if (design.artifactFamily !== 'site-capability-graph-repo-output-approval-gate-design') {
    throw new Error('GraphRepoOutputApprovalGateDesign artifactFamily must be site-capability-graph-repo-output-approval-gate-design');
  }
  if (design.redactionRequired !== true) {
    throw new Error('GraphRepoOutputApprovalGateDesign redactionRequired must be true');
  }
  if (!Array.isArray(design.items) || design.items.length === 0) {
    throw new Error('GraphRepoOutputApprovalGateDesign items are required');
  }
  for (const [index, item] of design.items.entries()) {
    assertPlainObject(item, `GraphRepoOutputApprovalGateDesign.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphRepoOutputApprovalGateDesign item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.gateMode !== 'design-only') {
      throw new Error('GraphRepoOutputApprovalGateDesign gateMode must be design-only');
    }
    for (const fieldName of [
      'approvalGateEnabled',
      'repoWriteEnabled',
      'runtimeGenerationEnabled',
      'runtimeArtifactWriteEnabled',
      'externalCommandEnabled',
      'schedulerPublishEnabled',
      'doctorPublishEnabled',
      'skillPublishEnabled',
      'mcpPublishEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphRepoOutputApprovalGateDesign ${fieldName} must be false`);
      }
    }
    if (item.approvalRequiredBeforeRepoWrite !== true) {
      throw new Error('GraphRepoOutputApprovalGateDesign approvalRequiredBeforeRepoWrite must be true');
    }
    if (item.sourceOutputDryRunOnly !== true) {
      throw new Error('GraphRepoOutputApprovalGateDesign sourceOutputDryRunOnly must be true');
    }
    if (!Array.isArray(item.requiredApprovalEvidence) || item.requiredApprovalEvidence.length === 0) {
      throw new Error('GraphRepoOutputApprovalGateDesign requiredApprovalEvidence is required');
    }
    for (const requiredEvidence of [
      'explicit-user-request-in-current-task',
      'matrix-section-updated-with-verification',
      'focused-tests-passed',
      'redaction-guard-passed',
      'repo-target-contained',
      'B-review-accepted',
    ]) {
      if (!item.requiredApprovalEvidence.includes(requiredEvidence)) {
        throw new Error(`GraphRepoOutputApprovalGateDesign requiredApprovalEvidence must include ${requiredEvidence}`);
      }
    }
    assertGraphRepoOutputApprovalGateSourceCompatible(item.sourceRepoOutput);
  }
  return true;
}

/** @param {Record<string, any>} [sourceRepoOutput] */
export function createGraphRepoOutputApprovalGateDesign(sourceRepoOutput = {}, options = {}) {
  assertGraphRepoOutputApprovalGateSourceCompatible(sourceRepoOutput);
  assertPlainObject(options, 'GraphRepoOutputApprovalGateDesignOptions');
  assertNoGraphRepoOutputApprovalGateRuntimeProducts(
    options,
    'GraphRepoOutputApprovalGateDesignOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphRepoOutputApprovalGateDesignOptions');
  assertNoForbiddenPatterns(options);
  const {
    gateName = 'site-capability-graph-repo-output-approval-gate',
    approvalGateEnabled,
    repoWriteEnabled,
    runtimeGenerationEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
    schedulerPublishEnabled,
    doctorPublishEnabled,
    skillPublishEnabled,
    mcpPublishEnabled,
  } = options;
  for (const [fieldName, value] of Object.entries({
    approvalGateEnabled,
    repoWriteEnabled,
    runtimeGenerationEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
    schedulerPublishEnabled,
    doctorPublishEnabled,
    skillPublishEnabled,
    mcpPublishEnabled,
  })) {
    assertDisabledFlag(
      value,
      fieldName,
      'GraphRepoOutputApprovalGateDesign',
    );
  }
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceRepoOutput.graphVersion,
    queryName: 'createGraphRepoOutputApprovalGateDesign',
    artifactFamily: 'site-capability-graph-repo-output-approval-gate-design',
    redactionRequired: true,
    items: [ {
      schemaVersion: 1,
      gateName: assertRequiredText(gateName, 'gateName', 'GraphRepoOutputApprovalGateDesign'),
      gateMode: 'design-only',
      approvalGateEnabled: false,
      repoWriteEnabled: false,
      runtimeGenerationEnabled: false,
      runtimeArtifactWriteEnabled: false,
      externalCommandEnabled: false,
      schedulerPublishEnabled: false,
      doctorPublishEnabled: false,
      skillPublishEnabled: false,
      mcpPublishEnabled: false,
      approvalRequiredBeforeRepoWrite: true,
      sourceOutputDryRunOnly: true,
      requiredApprovalEvidence: [
        'explicit-user-request-in-current-task',
        'matrix-section-updated-with-verification',
        'focused-tests-passed',
        'redaction-guard-passed',
        'repo-target-contained',
        'B-review-accepted',
      ],
      forbiddenRuntimeProducts: [
        'RepoWrite',
        'RuntimeArtifactWrite',
        'RuntimeGraphGeneration',
        'ExternalCommand',
        'SchedulerPublish',
        'DoctorPublish',
        'SkillPublish',
        'McpPublish',
        'SessionView',
        'StandardTaskList',
        'DownloadPolicy',
      ],
      requiredArtifactGuard: 'SecurityGuard/Redaction before graph-derived artifact writes',
      sourceRepoOutput: cloneDescriptor(sourceRepoOutput),
    } ],
  };
  assertGraphRepoOutputApprovalGateDesignCompatibility(result);
  return cloneDescriptor(result);
}

const GRAPH_DOCS_MARKDOWN_GENERATED_OUTPUT_MANIFEST_RUNTIME_PRODUCT_KEYS = Object.freeze([
  'artifactPath',
  'downloadPolicy',
  'externalCommand',
  'externalDispatch',
  'externalTelemetry',
  'filesystemWrite',
  'generatedOutput',
  'generatedOutputManifest',
  'generatedOutputManifestPath',
  'generatedOutputPath',
  'generatedManifestPath',
  'manifestOutputPath',
  'manifestPath',
  'outputPath',
  'publishPayload',
  'repoPath',
  'repositoryPath',
  'runtimeArtifact',
  'runtimeWriter',
  'sessionView',
  'standardTaskList',
  'taskList',
  'unredactedPayload',
  'writePath',
  'writer',
]);

const GRAPH_DOCS_MARKDOWN_GENERATED_OUTPUT_MANIFEST_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_DOCS_MARKDOWN_GENERATED_OUTPUT_MANIFEST_RUNTIME_PRODUCT_KEYS.map((key) => normalizeKey(key)),
);

function assertNoGraphDocsMarkdownGeneratedOutputManifestRuntimeProducts(
  value,
  label = 'GraphDocsMarkdownGeneratedOutputManifestGuard',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoGraphDocsMarkdownGeneratedOutputManifestRuntimeProducts(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (GRAPH_DOCS_MARKDOWN_GENERATED_OUTPUT_MANIFEST_RUNTIME_PRODUCT_KEY_SET.has(normalizeKey(key))) {
      throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${path}.${key}`);
    }
    assertNoGraphDocsMarkdownGeneratedOutputManifestRuntimeProducts(entry, label, `${path}.${key}`);
  }
  return true;
}

function normalizeGraphDocsMarkdownGeneratedOutputManifestTarget(value) {
  const text = assertRequiredText(
    value ?? 'runs/site-capability-graph/generated-docs-summary.manifest.json',
    'manifestRelativePath',
    'GraphDocsMarkdownGeneratedOutputManifestGuard',
  ).replace(/\\/gu, '/');
  if (/^(?:[a-z]:|\/)/iu.test(text)) {
    throw new Error('GraphDocsMarkdownGeneratedOutputManifestGuard manifestRelativePath must be repo-relative');
  }
  if (text.split('/').some((segment) => segment === '..')) {
    throw new Error('GraphDocsMarkdownGeneratedOutputManifestGuard manifestRelativePath must stay within the repository');
  }
  if (!/^runs\/site-capability-graph\/[a-z0-9][a-z0-9-]{0,79}\.manifest\.json$/u.test(text)) {
    throw new Error('GraphDocsMarkdownGeneratedOutputManifestGuard manifestRelativePath must be runs/site-capability-graph/<artifact>.manifest.json');
  }
  assertNoForbiddenPatterns(text);
  return text;
}

function defaultGraphDocsMarkdownGeneratedOutputManifestTarget(sourceTargetRelativePath) {
  const sourceTarget = normalizeGraphDocsMarkdownRepoOutputTarget(sourceTargetRelativePath);
  return normalizeGraphDocsMarkdownGeneratedOutputManifestTarget(
    sourceTarget.replace(/\.md$/u, '.manifest.json'),
  );
}

/** @param {Record<string, any>} [sourceApprovalGate] */
function assertGraphDocsMarkdownGeneratedOutputManifestSourceCompatible(sourceApprovalGate = {}) {
  assertPlainObject(
    sourceApprovalGate,
    'GraphDocsMarkdownGeneratedOutputManifestGuard.sourceApprovalGate',
  );
  assertGraphRepoOutputApprovalGateDesignCompatibility(sourceApprovalGate);
  const [gateItem] = sourceApprovalGate.items;
  const sourceRepoOutput = gateItem.sourceRepoOutput;
  if (sourceRepoOutput.artifactFamily !== 'site-capability-graph-docs-markdown-repo-output-dry-run') {
    throw new Error('GraphDocsMarkdownGeneratedOutputManifestGuard sourceApprovalGate must wrap docs markdown repo output dry-run');
  }
  assertGraphDocsMarkdownRepoOutputDryRunCompatibility(sourceRepoOutput);
  return true;
}

/** @param {Record<string, any>} [result] */
export function assertGraphDocsMarkdownGeneratedOutputManifestGuardCompatibility(result = {}) {
  assertPlainObject(result, 'GraphDocsMarkdownGeneratedOutputManifestGuard');
  assertNoGraphDocsMarkdownGeneratedOutputManifestRuntimeProducts(result);
  assertNoForbiddenGraphFields(result, 'GraphDocsMarkdownGeneratedOutputManifestGuard');
  assertNoForbiddenPatterns(result);
  assertGraphQueryResultCompatible(result);
  if (result.queryName !== 'createGraphDocsMarkdownGeneratedOutputManifestGuard') {
    throw new Error('GraphDocsMarkdownGeneratedOutputManifestGuard queryName must be createGraphDocsMarkdownGeneratedOutputManifestGuard');
  }
  if (result.artifactFamily !== 'site-capability-graph-docs-markdown-generated-output-manifest-guard') {
    throw new Error('GraphDocsMarkdownGeneratedOutputManifestGuard artifactFamily must be site-capability-graph-docs-markdown-generated-output-manifest-guard');
  }
  if (result.redactionRequired !== true) {
    throw new Error('GraphDocsMarkdownGeneratedOutputManifestGuard redactionRequired must be true');
  }
  if (!Array.isArray(result.items) || result.items.length === 0) {
    throw new Error('GraphDocsMarkdownGeneratedOutputManifestGuard items are required');
  }
  for (const [index, item] of result.items.entries()) {
    assertPlainObject(item, `GraphDocsMarkdownGeneratedOutputManifestGuard.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphDocsMarkdownGeneratedOutputManifestGuard item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.guardMode !== 'descriptor-only') {
      throw new Error('GraphDocsMarkdownGeneratedOutputManifestGuard guardMode must be descriptor-only');
    }
    if (item.manifestKind !== 'generated-output-manifest') {
      throw new Error('GraphDocsMarkdownGeneratedOutputManifestGuard manifestKind must be generated-output-manifest');
    }
    for (const fieldName of [
      'manifestWriteEnabled',
      'repoWriteEnabled',
      'runtimeGenerationEnabled',
      'runtimeArtifactWriteEnabled',
      'externalCommandEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphDocsMarkdownGeneratedOutputManifestGuard ${fieldName} must be false`);
      }
    }
    if (item.explicitValidationRequired !== true) {
      throw new Error('GraphDocsMarkdownGeneratedOutputManifestGuard explicitValidationRequired must be true');
    }
    if (item.redactionRequiredBeforeManifestWrite !== true) {
      throw new Error('GraphDocsMarkdownGeneratedOutputManifestGuard redactionRequiredBeforeManifestWrite must be true');
    }
    normalizeGraphDocsMarkdownRepoOutputTarget(item.generatedOutputTargetRelativePath);
    normalizeGraphDocsMarkdownGeneratedOutputManifestTarget(item.manifestRelativePath);
    assertPlainObject(
      item.sourceApprovalGate,
      `GraphDocsMarkdownGeneratedOutputManifestGuard.items[${index}].sourceApprovalGate`,
    );
    assertGraphDocsMarkdownGeneratedOutputManifestSourceCompatible(item.sourceApprovalGate);
  }
  return true;
}

/** @param {Record<string, any>} [sourceApprovalGate] */
export function createGraphDocsMarkdownGeneratedOutputManifestGuard(sourceApprovalGate = {}, options = {}) {
  assertGraphDocsMarkdownGeneratedOutputManifestSourceCompatible(sourceApprovalGate);
  assertPlainObject(options, 'GraphDocsMarkdownGeneratedOutputManifestGuardOptions');
  assertNoGraphDocsMarkdownGeneratedOutputManifestRuntimeProducts(
    options,
    'GraphDocsMarkdownGeneratedOutputManifestGuardOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphDocsMarkdownGeneratedOutputManifestGuardOptions');
  assertNoForbiddenPatterns(options);
  const {
    guardName = 'site-capability-graph-docs-markdown-generated-output-manifest-guard',
    manifestRelativePath,
    manifestWriteEnabled,
    repoWriteEnabled,
    runtimeGenerationEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
  } = options;
  for (const [fieldName, value] of Object.entries({
    manifestWriteEnabled,
    repoWriteEnabled,
    runtimeGenerationEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
  })) {
    assertDisabledFlag(
      value,
      fieldName,
      'GraphDocsMarkdownGeneratedOutputManifestGuard',
    );
  }
  const sourceRepoOutput = sourceApprovalGate.items[0].sourceRepoOutput;
  const sourceItem = sourceRepoOutput.items[0];
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceApprovalGate.graphVersion,
    queryName: 'createGraphDocsMarkdownGeneratedOutputManifestGuard',
    artifactFamily: 'site-capability-graph-docs-markdown-generated-output-manifest-guard',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      guardName: assertRequiredText(
        guardName,
        'guardName',
        'GraphDocsMarkdownGeneratedOutputManifestGuard',
      ),
      guardMode: 'descriptor-only',
      manifestKind: 'generated-output-manifest',
      manifestRelativePath: normalizeGraphDocsMarkdownGeneratedOutputManifestTarget(
        manifestRelativePath
          ?? defaultGraphDocsMarkdownGeneratedOutputManifestTarget(sourceItem.targetRelativePath),
      ),
      generatedOutputTargetRelativePath: sourceItem.targetRelativePath,
      sourceOutputFamily: sourceRepoOutput.artifactFamily,
      sourceGateFamily: sourceApprovalGate.artifactFamily,
      manifestWriteEnabled: false,
      repoWriteEnabled: false,
      runtimeGenerationEnabled: false,
      runtimeArtifactWriteEnabled: false,
      externalCommandEnabled: false,
      explicitValidationRequired: true,
      redactionRequiredBeforeManifestWrite: true,
      requiredApprovalGate: 'createGraphRepoOutputApprovalGateDesign',
      requiredArtifactGuard: 'SecurityGuard/Redaction before graph-derived artifact writes',
      sourceApprovalGate: cloneDescriptor(sourceApprovalGate),
    }],
  };
  assertGraphDocsMarkdownGeneratedOutputManifestGuardCompatibility(result);
  return cloneDescriptor(result);
}

const GRAPH_DOCS_MARKDOWN_RETAINED_OUTPUT_INDEX_RUNTIME_PRODUCT_KEYS = Object.freeze([
  'artifactPath',
  'downloadPolicy',
  'externalCommand',
  'externalDispatch',
  'externalTelemetry',
  'filesystemWrite',
  'indexOutputPath',
  'indexPath',
  'outputPath',
  'publishPayload',
  'repoPath',
  'repositoryPath',
  'retainedOutput',
  'retainedOutputIndex',
  'retainedOutputIndexPath',
  'retainedOutputPath',
  'runtimeArtifact',
  'runtimeIndexer',
  'runtimeWriter',
  'sessionView',
  'standardTaskList',
  'taskList',
  'unredactedPayload',
  'writePath',
  'writer',
]);

const GRAPH_DOCS_MARKDOWN_RETAINED_OUTPUT_INDEX_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_DOCS_MARKDOWN_RETAINED_OUTPUT_INDEX_RUNTIME_PRODUCT_KEYS.map((key) => normalizeKey(key)),
);

function assertNoGraphDocsMarkdownRetainedOutputIndexRuntimeProducts(
  value,
  label = 'GraphDocsMarkdownRetainedOutputIndexGuard',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoGraphDocsMarkdownRetainedOutputIndexRuntimeProducts(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (GRAPH_DOCS_MARKDOWN_RETAINED_OUTPUT_INDEX_RUNTIME_PRODUCT_KEY_SET.has(normalizeKey(key))) {
      throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${path}.${key}`);
    }
    assertNoGraphDocsMarkdownRetainedOutputIndexRuntimeProducts(entry, label, `${path}.${key}`);
  }
  return true;
}

function normalizeGraphDocsMarkdownRetainedOutputIndexTarget(value) {
  const text = assertRequiredText(
    value ?? 'runs/site-capability-graph/generated-docs-summary.retained-index.json',
    'indexRelativePath',
    'GraphDocsMarkdownRetainedOutputIndexGuard',
  ).replace(/\\/gu, '/');
  if (/^(?:[a-z]:|\/)/iu.test(text)) {
    throw new Error('GraphDocsMarkdownRetainedOutputIndexGuard indexRelativePath must be repo-relative');
  }
  if (text.split('/').some((segment) => segment === '..')) {
    throw new Error('GraphDocsMarkdownRetainedOutputIndexGuard indexRelativePath must stay within the repository');
  }
  if (!/^runs\/site-capability-graph\/[a-z0-9][a-z0-9-]{0,79}\.retained-index\.json$/u.test(text)) {
    throw new Error('GraphDocsMarkdownRetainedOutputIndexGuard indexRelativePath must be runs/site-capability-graph/<artifact>.retained-index.json');
  }
  assertNoForbiddenPatterns(text);
  return text;
}

function defaultGraphDocsMarkdownRetainedOutputIndexTarget(sourceTargetRelativePath) {
  const sourceTarget = normalizeGraphDocsMarkdownRepoOutputTarget(sourceTargetRelativePath);
  return normalizeGraphDocsMarkdownRetainedOutputIndexTarget(
    sourceTarget.replace(/\.md$/u, '.retained-index.json'),
  );
}

/** @param {Record<string, any>} [sourceManifestGuard] */
function assertGraphDocsMarkdownRetainedOutputIndexSourceCompatible(sourceManifestGuard = {}) {
  assertPlainObject(
    sourceManifestGuard,
    'GraphDocsMarkdownRetainedOutputIndexGuard.sourceManifestGuard',
  );
  assertGraphDocsMarkdownGeneratedOutputManifestGuardCompatibility(sourceManifestGuard);
  if (sourceManifestGuard.artifactFamily !== 'site-capability-graph-docs-markdown-generated-output-manifest-guard') {
    throw new Error('GraphDocsMarkdownRetainedOutputIndexGuard sourceManifestGuard must be a generated-output manifest guard');
  }
  return true;
}

/** @param {Record<string, any>} [result] */
export function assertGraphDocsMarkdownRetainedOutputIndexGuardCompatibility(result = {}) {
  assertPlainObject(result, 'GraphDocsMarkdownRetainedOutputIndexGuard');
  assertNoGraphDocsMarkdownRetainedOutputIndexRuntimeProducts(result);
  assertNoForbiddenGraphFields(result, 'GraphDocsMarkdownRetainedOutputIndexGuard');
  assertNoForbiddenPatterns(result);
  assertGraphQueryResultCompatible(result);
  if (result.queryName !== 'createGraphDocsMarkdownRetainedOutputIndexGuard') {
    throw new Error('GraphDocsMarkdownRetainedOutputIndexGuard queryName must be createGraphDocsMarkdownRetainedOutputIndexGuard');
  }
  if (result.artifactFamily !== 'site-capability-graph-docs-markdown-retained-output-index-guard') {
    throw new Error('GraphDocsMarkdownRetainedOutputIndexGuard artifactFamily must be site-capability-graph-docs-markdown-retained-output-index-guard');
  }
  if (result.redactionRequired !== true) {
    throw new Error('GraphDocsMarkdownRetainedOutputIndexGuard redactionRequired must be true');
  }
  if (!Array.isArray(result.items) || result.items.length === 0) {
    throw new Error('GraphDocsMarkdownRetainedOutputIndexGuard items are required');
  }
  for (const [index, item] of result.items.entries()) {
    assertPlainObject(item, `GraphDocsMarkdownRetainedOutputIndexGuard.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphDocsMarkdownRetainedOutputIndexGuard item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.guardMode !== 'descriptor-only') {
      throw new Error('GraphDocsMarkdownRetainedOutputIndexGuard guardMode must be descriptor-only');
    }
    if (item.indexKind !== 'retained-output-index') {
      throw new Error('GraphDocsMarkdownRetainedOutputIndexGuard indexKind must be retained-output-index');
    }
    for (const fieldName of [
      'indexWriteEnabled',
      'repoWriteEnabled',
      'runtimeIndexingEnabled',
      'runtimeArtifactWriteEnabled',
      'externalCommandEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphDocsMarkdownRetainedOutputIndexGuard ${fieldName} must be false`);
      }
    }
    if (item.explicitValidationRequired !== true) {
      throw new Error('GraphDocsMarkdownRetainedOutputIndexGuard explicitValidationRequired must be true');
    }
    if (item.redactionRequiredBeforeIndexWrite !== true) {
      throw new Error('GraphDocsMarkdownRetainedOutputIndexGuard redactionRequiredBeforeIndexWrite must be true');
    }
    normalizeGraphDocsMarkdownRepoOutputTarget(item.generatedOutputTargetRelativePath);
    normalizeGraphDocsMarkdownGeneratedOutputManifestTarget(item.manifestRelativePath);
    normalizeGraphDocsMarkdownRetainedOutputIndexTarget(item.indexRelativePath);
    assertPlainObject(
      item.sourceManifestGuard,
      `GraphDocsMarkdownRetainedOutputIndexGuard.items[${index}].sourceManifestGuard`,
    );
    assertGraphDocsMarkdownRetainedOutputIndexSourceCompatible(item.sourceManifestGuard);
  }
  return true;
}

/** @param {Record<string, any>} [sourceManifestGuard] */
export function createGraphDocsMarkdownRetainedOutputIndexGuard(sourceManifestGuard = {}, options = {}) {
  assertGraphDocsMarkdownRetainedOutputIndexSourceCompatible(sourceManifestGuard);
  assertPlainObject(options, 'GraphDocsMarkdownRetainedOutputIndexGuardOptions');
  assertNoGraphDocsMarkdownRetainedOutputIndexRuntimeProducts(
    options,
    'GraphDocsMarkdownRetainedOutputIndexGuardOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphDocsMarkdownRetainedOutputIndexGuardOptions');
  assertNoForbiddenPatterns(options);
  const {
    guardName = 'site-capability-graph-docs-markdown-retained-output-index-guard',
    indexRelativePath,
    indexWriteEnabled,
    repoWriteEnabled,
    runtimeIndexingEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
  } = options;
  for (const [fieldName, value] of Object.entries({
    indexWriteEnabled,
    repoWriteEnabled,
    runtimeIndexingEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
  })) {
    assertDisabledFlag(
      value,
      fieldName,
      'GraphDocsMarkdownRetainedOutputIndexGuard',
    );
  }
  const sourceManifestItem = sourceManifestGuard.items[0];
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceManifestGuard.graphVersion,
    queryName: 'createGraphDocsMarkdownRetainedOutputIndexGuard',
    artifactFamily: 'site-capability-graph-docs-markdown-retained-output-index-guard',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      guardName: assertRequiredText(
        guardName,
        'guardName',
        'GraphDocsMarkdownRetainedOutputIndexGuard',
      ),
      guardMode: 'descriptor-only',
      indexKind: 'retained-output-index',
      indexRelativePath: normalizeGraphDocsMarkdownRetainedOutputIndexTarget(
        indexRelativePath
          ?? defaultGraphDocsMarkdownRetainedOutputIndexTarget(
            sourceManifestItem.generatedOutputTargetRelativePath,
          ),
      ),
      manifestRelativePath: sourceManifestItem.manifestRelativePath,
      generatedOutputTargetRelativePath: sourceManifestItem.generatedOutputTargetRelativePath,
      sourceManifestGuardFamily: sourceManifestGuard.artifactFamily,
      sourceOutputFamily: sourceManifestItem.sourceOutputFamily,
      sourceGateFamily: sourceManifestItem.sourceGateFamily,
      indexWriteEnabled: false,
      repoWriteEnabled: false,
      runtimeIndexingEnabled: false,
      runtimeArtifactWriteEnabled: false,
      externalCommandEnabled: false,
      explicitValidationRequired: true,
      redactionRequiredBeforeIndexWrite: true,
      requiredManifestGuard: 'createGraphDocsMarkdownGeneratedOutputManifestGuard',
      requiredArtifactGuard: 'SecurityGuard/Redaction before graph-derived artifact writes',
      sourceManifestGuard: cloneDescriptor(sourceManifestGuard),
    }],
  };
  assertGraphDocsMarkdownRetainedOutputIndexGuardCompatibility(result);
  return cloneDescriptor(result);
}

const GRAPH_DOCS_MARKDOWN_CLEANUP_POLICY_RUNTIME_PRODUCT_KEYS = Object.freeze([
  'artifactPath',
  'cleanupJob',
  'cleanupPath',
  'cleanupPolicy',
  'cleanupResult',
  'cleanupWrite',
  'deletePath',
  'deleteResult',
  'downloadPolicy',
  'externalCommand',
  'externalDispatch',
  'externalTelemetry',
  'filesystemWrite',
  'outputPath',
  'publishPayload',
  'repoPath',
  'repositoryPath',
  'retainedOutput',
  'retainedOutputIndex',
  'runtimeArtifact',
  'runtimeCleanup',
  'runtimeWriter',
  'sessionView',
  'standardTaskList',
  'taskList',
  'unredactedPayload',
  'writePath',
  'writer',
]);

const GRAPH_DOCS_MARKDOWN_CLEANUP_POLICY_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_DOCS_MARKDOWN_CLEANUP_POLICY_RUNTIME_PRODUCT_KEYS.map((key) => normalizeKey(key)),
);

function assertNoGraphDocsMarkdownCleanupPolicyRuntimeProducts(
  value,
  label = 'GraphDocsMarkdownCleanupPolicyGuard',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoGraphDocsMarkdownCleanupPolicyRuntimeProducts(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (GRAPH_DOCS_MARKDOWN_CLEANUP_POLICY_RUNTIME_PRODUCT_KEY_SET.has(normalizeKey(key))) {
      throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${path}.${key}`);
    }
    assertNoGraphDocsMarkdownCleanupPolicyRuntimeProducts(entry, label, `${path}.${key}`);
  }
  return true;
}

/** @param {Record<string, any>} [sourceIndexGuard] */
function assertGraphDocsMarkdownCleanupPolicySourceCompatible(sourceIndexGuard = {}) {
  assertPlainObject(
    sourceIndexGuard,
    'GraphDocsMarkdownCleanupPolicyGuard.sourceIndexGuard',
  );
  assertGraphDocsMarkdownRetainedOutputIndexGuardCompatibility(sourceIndexGuard);
  if (sourceIndexGuard.artifactFamily !== 'site-capability-graph-docs-markdown-retained-output-index-guard') {
    throw new Error('GraphDocsMarkdownCleanupPolicyGuard sourceIndexGuard must be a retained-output index guard');
  }
  return true;
}

/** @param {Record<string, any>} [result] */
export function assertGraphDocsMarkdownCleanupPolicyGuardCompatibility(result = {}) {
  assertPlainObject(result, 'GraphDocsMarkdownCleanupPolicyGuard');
  assertNoGraphDocsMarkdownCleanupPolicyRuntimeProducts(result);
  assertNoForbiddenGraphFields(result, 'GraphDocsMarkdownCleanupPolicyGuard');
  assertNoForbiddenPatterns(result);
  assertGraphQueryResultCompatible(result);
  if (result.queryName !== 'createGraphDocsMarkdownCleanupPolicyGuard') {
    throw new Error('GraphDocsMarkdownCleanupPolicyGuard queryName must be createGraphDocsMarkdownCleanupPolicyGuard');
  }
  if (result.artifactFamily !== 'site-capability-graph-docs-markdown-cleanup-policy-guard') {
    throw new Error('GraphDocsMarkdownCleanupPolicyGuard artifactFamily must be site-capability-graph-docs-markdown-cleanup-policy-guard');
  }
  if (result.redactionRequired !== true) {
    throw new Error('GraphDocsMarkdownCleanupPolicyGuard redactionRequired must be true');
  }
  if (!Array.isArray(result.items) || result.items.length === 0) {
    throw new Error('GraphDocsMarkdownCleanupPolicyGuard items are required');
  }
  for (const [index, item] of result.items.entries()) {
    assertPlainObject(item, `GraphDocsMarkdownCleanupPolicyGuard.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphDocsMarkdownCleanupPolicyGuard item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.guardMode !== 'descriptor-only') {
      throw new Error('GraphDocsMarkdownCleanupPolicyGuard guardMode must be descriptor-only');
    }
    if (item.policyKind !== 'artifact-descriptor-cleanup-policy') {
      throw new Error('GraphDocsMarkdownCleanupPolicyGuard policyKind must be artifact-descriptor-cleanup-policy');
    }
    for (const fieldName of [
      'cleanupWriteEnabled',
      'deleteEnabled',
      'indexWriteEnabled',
      'repoWriteEnabled',
      'runtimeCleanupEnabled',
      'runtimeArtifactWriteEnabled',
      'externalCommandEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphDocsMarkdownCleanupPolicyGuard ${fieldName} must be false`);
      }
    }
    if (item.explicitValidationRequired !== true) {
      throw new Error('GraphDocsMarkdownCleanupPolicyGuard explicitValidationRequired must be true');
    }
    if (item.redactionRequiredBeforeCleanup !== true) {
      throw new Error('GraphDocsMarkdownCleanupPolicyGuard redactionRequiredBeforeCleanup must be true');
    }
    if (item.cleanupRequiresApproval !== true) {
      throw new Error('GraphDocsMarkdownCleanupPolicyGuard cleanupRequiresApproval must be true');
    }
    normalizeGraphDocsMarkdownRepoOutputTarget(item.generatedOutputTargetRelativePath);
    normalizeGraphDocsMarkdownGeneratedOutputManifestTarget(item.manifestRelativePath);
    normalizeGraphDocsMarkdownRetainedOutputIndexTarget(item.indexRelativePath);
    assertPlainObject(
      item.sourceIndexGuard,
      `GraphDocsMarkdownCleanupPolicyGuard.items[${index}].sourceIndexGuard`,
    );
    assertGraphDocsMarkdownCleanupPolicySourceCompatible(item.sourceIndexGuard);
  }
  return true;
}

/** @param {Record<string, any>} [sourceIndexGuard] */
export function createGraphDocsMarkdownCleanupPolicyGuard(sourceIndexGuard = {}, options = {}) {
  assertGraphDocsMarkdownCleanupPolicySourceCompatible(sourceIndexGuard);
  assertPlainObject(options, 'GraphDocsMarkdownCleanupPolicyGuardOptions');
  assertNoGraphDocsMarkdownCleanupPolicyRuntimeProducts(
    options,
    'GraphDocsMarkdownCleanupPolicyGuardOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphDocsMarkdownCleanupPolicyGuardOptions');
  assertNoForbiddenPatterns(options);
  const {
    guardName = 'site-capability-graph-docs-markdown-cleanup-policy-guard',
    cleanupWriteEnabled,
    deleteEnabled,
    indexWriteEnabled,
    repoWriteEnabled,
    runtimeCleanupEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
  } = options;
  for (const [fieldName, value] of Object.entries({
    cleanupWriteEnabled,
    deleteEnabled,
    indexWriteEnabled,
    repoWriteEnabled,
    runtimeCleanupEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
  })) {
    assertDisabledFlag(
      value,
      fieldName,
      'GraphDocsMarkdownCleanupPolicyGuard',
    );
  }
  const sourceIndexItem = sourceIndexGuard.items[0];
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceIndexGuard.graphVersion,
    queryName: 'createGraphDocsMarkdownCleanupPolicyGuard',
    artifactFamily: 'site-capability-graph-docs-markdown-cleanup-policy-guard',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      guardName: assertRequiredText(
        guardName,
        'guardName',
        'GraphDocsMarkdownCleanupPolicyGuard',
      ),
      guardMode: 'descriptor-only',
      policyKind: 'artifact-descriptor-cleanup-policy',
      indexRelativePath: sourceIndexItem.indexRelativePath,
      manifestRelativePath: sourceIndexItem.manifestRelativePath,
      generatedOutputTargetRelativePath: sourceIndexItem.generatedOutputTargetRelativePath,
      sourceIndexGuardFamily: sourceIndexGuard.artifactFamily,
      sourceManifestGuardFamily: sourceIndexItem.sourceManifestGuardFamily,
      sourceOutputFamily: sourceIndexItem.sourceOutputFamily,
      sourceGateFamily: sourceIndexItem.sourceGateFamily,
      cleanupWriteEnabled: false,
      deleteEnabled: false,
      indexWriteEnabled: false,
      repoWriteEnabled: false,
      runtimeCleanupEnabled: false,
      runtimeArtifactWriteEnabled: false,
      externalCommandEnabled: false,
      explicitValidationRequired: true,
      redactionRequiredBeforeCleanup: true,
      cleanupRequiresApproval: true,
      requiredIndexGuard: 'createGraphDocsMarkdownRetainedOutputIndexGuard',
      requiredArtifactGuard: 'SecurityGuard/Redaction before graph-derived artifact cleanup',
      sourceIndexGuard: cloneDescriptor(sourceIndexGuard),
    }],
  };
  assertGraphDocsMarkdownCleanupPolicyGuardCompatibility(result);
  return cloneDescriptor(result);
}

const GRAPH_DOCS_MARKDOWN_RETENTION_CLEANUP_HANDOFF_RUNTIME_PRODUCT_KEYS = Object.freeze([
  'artifactPath',
  'cleanupExecution',
  'cleanupHandler',
  'cleanupJob',
  'cleanupPath',
  'cleanupPlan',
  'cleanupPolicy',
  'cleanupResult',
  'deletePath',
  'deletePlan',
  'deleteResult',
  'downloadPolicy',
  'externalCommand',
  'externalDispatch',
  'externalTelemetry',
  'filesystemWrite',
  'handoffPayload',
  'outputPath',
  'publishPayload',
  'repoPath',
  'repositoryPath',
  'retentionHandler',
  'retentionPolicy',
  'retentionResult',
  'runtimeArtifact',
  'runtimeCleanup',
  'runtimeConsumer',
  'runtimeHandoff',
  'runtimeWriter',
  'sessionView',
  'standardTaskList',
  'taskList',
  'unredactedPayload',
  'writePath',
  'writer',
]);

const GRAPH_DOCS_MARKDOWN_RETENTION_CLEANUP_HANDOFF_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_DOCS_MARKDOWN_RETENTION_CLEANUP_HANDOFF_RUNTIME_PRODUCT_KEYS.map((key) => normalizeKey(key)),
);

function assertNoGraphDocsMarkdownRetentionCleanupHandoffRuntimeProducts(
  value,
  label = 'GraphDocsMarkdownRetentionCleanupCompatibilityHandoff',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoGraphDocsMarkdownRetentionCleanupHandoffRuntimeProducts(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (GRAPH_DOCS_MARKDOWN_RETENTION_CLEANUP_HANDOFF_RUNTIME_PRODUCT_KEY_SET.has(normalizeKey(key))) {
      throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${path}.${key}`);
    }
    assertNoGraphDocsMarkdownRetentionCleanupHandoffRuntimeProducts(entry, label, `${path}.${key}`);
  }
  return true;
}

/** @param {Record<string, any>} [sourceCleanupPolicyGuard] */
function assertGraphDocsMarkdownRetentionCleanupHandoffSourceCompatible(sourceCleanupPolicyGuard = {}) {
  assertPlainObject(
    sourceCleanupPolicyGuard,
    'GraphDocsMarkdownRetentionCleanupCompatibilityHandoff.sourceCleanupPolicyGuard',
  );
  assertGraphDocsMarkdownCleanupPolicyGuardCompatibility(sourceCleanupPolicyGuard);
  if (sourceCleanupPolicyGuard.artifactFamily !== 'site-capability-graph-docs-markdown-cleanup-policy-guard') {
    throw new Error('GraphDocsMarkdownRetentionCleanupCompatibilityHandoff sourceCleanupPolicyGuard must be a cleanup-policy guard');
  }
  return true;
}

/** @param {Record<string, any>} [result] */
export function assertGraphDocsMarkdownRetentionCleanupCompatibilityHandoff(result = {}) {
  assertPlainObject(result, 'GraphDocsMarkdownRetentionCleanupCompatibilityHandoff');
  assertNoGraphDocsMarkdownRetentionCleanupHandoffRuntimeProducts(result);
  assertNoForbiddenGraphFields(result, 'GraphDocsMarkdownRetentionCleanupCompatibilityHandoff');
  assertNoForbiddenPatterns(result);
  assertGraphQueryResultCompatible(result);
  if (result.queryName !== 'createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff') {
    throw new Error('GraphDocsMarkdownRetentionCleanupCompatibilityHandoff queryName must be createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff');
  }
  if (result.artifactFamily !== 'site-capability-graph-docs-markdown-retention-cleanup-compatibility-handoff') {
    throw new Error('GraphDocsMarkdownRetentionCleanupCompatibilityHandoff artifactFamily must be site-capability-graph-docs-markdown-retention-cleanup-compatibility-handoff');
  }
  if (result.redactionRequired !== true) {
    throw new Error('GraphDocsMarkdownRetentionCleanupCompatibilityHandoff redactionRequired must be true');
  }
  if (!Array.isArray(result.items) || result.items.length === 0) {
    throw new Error('GraphDocsMarkdownRetentionCleanupCompatibilityHandoff items are required');
  }
  for (const [index, item] of result.items.entries()) {
    assertPlainObject(item, `GraphDocsMarkdownRetentionCleanupCompatibilityHandoff.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphDocsMarkdownRetentionCleanupCompatibilityHandoff item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.handoffMode !== 'descriptor-only') {
      throw new Error('GraphDocsMarkdownRetentionCleanupCompatibilityHandoff handoffMode must be descriptor-only');
    }
    if (item.compatibilityKind !== 'retention-cleanup-compatibility-handoff') {
      throw new Error('GraphDocsMarkdownRetentionCleanupCompatibilityHandoff compatibilityKind must be retention-cleanup-compatibility-handoff');
    }
    for (const fieldName of [
      'handoffEnabled',
      'runtimeHandoffEnabled',
      'cleanupExecutionEnabled',
      'deleteEnabled',
      'retentionDecisionWriteEnabled',
      'repoWriteEnabled',
      'runtimeArtifactWriteEnabled',
      'externalCommandEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphDocsMarkdownRetentionCleanupCompatibilityHandoff ${fieldName} must be false`);
      }
    }
    if (item.explicitValidationRequired !== true) {
      throw new Error('GraphDocsMarkdownRetentionCleanupCompatibilityHandoff explicitValidationRequired must be true');
    }
    if (item.redactionRequiredBeforeHandoff !== true) {
      throw new Error('GraphDocsMarkdownRetentionCleanupCompatibilityHandoff redactionRequiredBeforeHandoff must be true');
    }
    if (item.cleanupRequiresApproval !== true) {
      throw new Error('GraphDocsMarkdownRetentionCleanupCompatibilityHandoff cleanupRequiresApproval must be true');
    }
    if (item.retainedIndexRequired !== true) {
      throw new Error('GraphDocsMarkdownRetentionCleanupCompatibilityHandoff retainedIndexRequired must be true');
    }
    normalizeGraphDocsMarkdownRepoOutputTarget(item.generatedOutputTargetRelativePath);
    normalizeGraphDocsMarkdownGeneratedOutputManifestTarget(item.manifestRelativePath);
    normalizeGraphDocsMarkdownRetainedOutputIndexTarget(item.indexRelativePath);
    assertPlainObject(
      item.sourceCleanupPolicyGuard,
      `GraphDocsMarkdownRetentionCleanupCompatibilityHandoff.items[${index}].sourceCleanupPolicyGuard`,
    );
    assertGraphDocsMarkdownRetentionCleanupHandoffSourceCompatible(item.sourceCleanupPolicyGuard);
  }
  return true;
}

export function createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff(
  sourceCleanupPolicyGuard = {},
  options = {},
) {
  assertGraphDocsMarkdownRetentionCleanupHandoffSourceCompatible(sourceCleanupPolicyGuard);
  assertPlainObject(options, 'GraphDocsMarkdownRetentionCleanupCompatibilityHandoffOptions');
  assertNoGraphDocsMarkdownRetentionCleanupHandoffRuntimeProducts(
    options,
    'GraphDocsMarkdownRetentionCleanupCompatibilityHandoffOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphDocsMarkdownRetentionCleanupCompatibilityHandoffOptions');
  assertNoForbiddenPatterns(options);
  const {
    handoffName = 'site-capability-graph-docs-markdown-retention-cleanup-compatibility-handoff',
    handoffEnabled,
    runtimeHandoffEnabled,
    cleanupExecutionEnabled,
    deleteEnabled,
    retentionDecisionWriteEnabled,
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
  } = options;
  for (const [fieldName, value] of Object.entries({
    handoffEnabled,
    runtimeHandoffEnabled,
    cleanupExecutionEnabled,
    deleteEnabled,
    retentionDecisionWriteEnabled,
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
  })) {
    assertDisabledFlag(
      value,
      fieldName,
      'GraphDocsMarkdownRetentionCleanupCompatibilityHandoff',
    );
  }
  const sourceCleanupItem = sourceCleanupPolicyGuard.items[0];
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceCleanupPolicyGuard.graphVersion,
    queryName: 'createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff',
    artifactFamily: 'site-capability-graph-docs-markdown-retention-cleanup-compatibility-handoff',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      handoffName: assertRequiredText(
        handoffName,
        'handoffName',
        'GraphDocsMarkdownRetentionCleanupCompatibilityHandoff',
      ),
      handoffMode: 'descriptor-only',
      compatibilityKind: 'retention-cleanup-compatibility-handoff',
      indexRelativePath: sourceCleanupItem.indexRelativePath,
      manifestRelativePath: sourceCleanupItem.manifestRelativePath,
      generatedOutputTargetRelativePath: sourceCleanupItem.generatedOutputTargetRelativePath,
      sourceCleanupPolicyFamily: sourceCleanupPolicyGuard.artifactFamily,
      sourceIndexGuardFamily: sourceCleanupItem.sourceIndexGuardFamily,
      sourceManifestGuardFamily: sourceCleanupItem.sourceManifestGuardFamily,
      sourceOutputFamily: sourceCleanupItem.sourceOutputFamily,
      sourceGateFamily: sourceCleanupItem.sourceGateFamily,
      handoffEnabled: false,
      runtimeHandoffEnabled: false,
      cleanupExecutionEnabled: false,
      deleteEnabled: false,
      retentionDecisionWriteEnabled: false,
      repoWriteEnabled: false,
      runtimeArtifactWriteEnabled: false,
      externalCommandEnabled: false,
      explicitValidationRequired: true,
      redactionRequiredBeforeHandoff: true,
      cleanupRequiresApproval: true,
      retainedIndexRequired: true,
      requiredCleanupPolicyGuard: 'createGraphDocsMarkdownCleanupPolicyGuard',
      requiredLayerConsumer: 'disabled until explicit Layer retention/cleanup consumer exists',
      requiredArtifactGuard: 'SecurityGuard/Redaction before graph-derived retention cleanup handoff',
      sourceCleanupPolicyGuard: cloneDescriptor(sourceCleanupPolicyGuard),
    }],
  };
  assertGraphDocsMarkdownRetentionCleanupCompatibilityHandoff(result);
  return cloneDescriptor(result);
}

const GRAPH_DOCS_MARKDOWN_FINAL_OUTPUT_BOUNDARY_RUNTIME_PRODUCT_KEYS = Object.freeze([
  'artifactPath',
  'cleanupExecution',
  'deletePlan',
  'docsOutput',
  'docsOutputPath',
  'downloadPolicy',
  'externalCommand',
  'externalDispatch',
  'externalTelemetry',
  'filesystemWrite',
  'finalDocsOutput',
  'finalOutput',
  'finalMatrixHandoff',
  'handoffPayload',
  'handoffResult',
  'matrixHandoff',
  'matrixOutput',
  'matrixOutputPath',
  'matrixPatch',
  'matrixStatusUpdate',
  'matrixWrite',
  'outputPath',
  'publishPayload',
  'repoPath',
  'repositoryPath',
  'runtimeArtifact',
  'runtimeFinalizer',
  'runtimeOutput',
  'runtimeWriter',
  'sessionView',
  'standardTaskList',
  'statusPromotion',
  'taskList',
  'unredactedPayload',
  'verifiedPromotion',
  'writePath',
  'writer',
]);

const GRAPH_DOCS_MARKDOWN_FINAL_OUTPUT_BOUNDARY_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_DOCS_MARKDOWN_FINAL_OUTPUT_BOUNDARY_RUNTIME_PRODUCT_KEYS.map((key) => normalizeKey(key)),
);

function assertNoGraphDocsMarkdownFinalOutputBoundaryRuntimeProducts(
  value,
  label = 'GraphDocsMarkdownFinalOutputBoundarySummary',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoGraphDocsMarkdownFinalOutputBoundaryRuntimeProducts(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (GRAPH_DOCS_MARKDOWN_FINAL_OUTPUT_BOUNDARY_RUNTIME_PRODUCT_KEY_SET.has(normalizeKey(key))) {
      throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${path}.${key}`);
    }
    assertNoGraphDocsMarkdownFinalOutputBoundaryRuntimeProducts(entry, label, `${path}.${key}`);
  }
  return true;
}

/** @param {Record<string, any>} [sourceHandoff] */
function assertGraphDocsMarkdownFinalOutputBoundarySourceCompatible(sourceHandoff = {}) {
  assertPlainObject(
    sourceHandoff,
    'GraphDocsMarkdownFinalOutputBoundarySummary.sourceHandoff',
  );
  assertGraphDocsMarkdownRetentionCleanupCompatibilityHandoff(sourceHandoff);
  if (sourceHandoff.artifactFamily !== 'site-capability-graph-docs-markdown-retention-cleanup-compatibility-handoff') {
    throw new Error('GraphDocsMarkdownFinalOutputBoundarySummary sourceHandoff must be a retention-cleanup compatibility handoff');
  }
  return true;
}

/** @param {Record<string, any>} [result] */
export function assertGraphDocsMarkdownFinalOutputBoundarySummaryCompatibility(result = {}) {
  assertPlainObject(result, 'GraphDocsMarkdownFinalOutputBoundarySummary');
  assertNoGraphDocsMarkdownFinalOutputBoundaryRuntimeProducts(result);
  assertNoForbiddenGraphFields(result, 'GraphDocsMarkdownFinalOutputBoundarySummary');
  assertNoForbiddenPatterns(result);
  assertGraphQueryResultCompatible(result);
  if (result.queryName !== 'createGraphDocsMarkdownFinalOutputBoundarySummary') {
    throw new Error('GraphDocsMarkdownFinalOutputBoundarySummary queryName must be createGraphDocsMarkdownFinalOutputBoundarySummary');
  }
  if (result.artifactFamily !== 'site-capability-graph-docs-markdown-final-output-boundary-summary') {
    throw new Error('GraphDocsMarkdownFinalOutputBoundarySummary artifactFamily must be site-capability-graph-docs-markdown-final-output-boundary-summary');
  }
  if (result.redactionRequired !== true) {
    throw new Error('GraphDocsMarkdownFinalOutputBoundarySummary redactionRequired must be true');
  }
  if (!Array.isArray(result.items) || result.items.length === 0) {
    throw new Error('GraphDocsMarkdownFinalOutputBoundarySummary items are required');
  }
  for (const [index, item] of result.items.entries()) {
    assertPlainObject(item, `GraphDocsMarkdownFinalOutputBoundarySummary.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphDocsMarkdownFinalOutputBoundarySummary item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.summaryMode !== 'descriptor-only') {
      throw new Error('GraphDocsMarkdownFinalOutputBoundarySummary summaryMode must be descriptor-only');
    }
    if (item.summaryKind !== 'final-docs-output-boundary-summary') {
      throw new Error('GraphDocsMarkdownFinalOutputBoundarySummary summaryKind must be final-docs-output-boundary-summary');
    }
    for (const fieldName of [
      'finalizationEnabled',
      'runtimeOutputEnabled',
      'docsWriteEnabled',
      'repoWriteEnabled',
      'runtimeArtifactWriteEnabled',
      'externalCommandEnabled',
      'publishEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphDocsMarkdownFinalOutputBoundarySummary ${fieldName} must be false`);
      }
    }
    if (item.redactionRequiredBeforeFinalOutput !== true) {
      throw new Error('GraphDocsMarkdownFinalOutputBoundarySummary redactionRequiredBeforeFinalOutput must be true');
    }
    if (item.layerConsumerRequired !== true) {
      throw new Error('GraphDocsMarkdownFinalOutputBoundarySummary layerConsumerRequired must be true');
    }
    normalizeGraphDocsMarkdownRepoOutputTarget(item.generatedOutputTargetRelativePath);
    normalizeGraphDocsMarkdownGeneratedOutputManifestTarget(item.manifestRelativePath);
    normalizeGraphDocsMarkdownRetainedOutputIndexTarget(item.indexRelativePath);
    assertPlainObject(
      item.sourceHandoff,
      `GraphDocsMarkdownFinalOutputBoundarySummary.items[${index}].sourceHandoff`,
    );
    assertGraphDocsMarkdownFinalOutputBoundarySourceCompatible(item.sourceHandoff);
  }
  return true;
}

/** @param {Record<string, any>} [sourceHandoff] */
export function createGraphDocsMarkdownFinalOutputBoundarySummary(sourceHandoff = {}, options = {}) {
  assertGraphDocsMarkdownFinalOutputBoundarySourceCompatible(sourceHandoff);
  assertPlainObject(options, 'GraphDocsMarkdownFinalOutputBoundarySummaryOptions');
  assertNoGraphDocsMarkdownFinalOutputBoundaryRuntimeProducts(
    options,
    'GraphDocsMarkdownFinalOutputBoundarySummaryOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphDocsMarkdownFinalOutputBoundarySummaryOptions');
  assertNoForbiddenPatterns(options);
  const {
    summaryName = 'site-capability-graph-docs-markdown-final-output-boundary-summary',
    finalizationEnabled,
    runtimeOutputEnabled,
    docsWriteEnabled,
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
    publishEnabled,
  } = options;
  for (const [fieldName, value] of Object.entries({
    finalizationEnabled,
    runtimeOutputEnabled,
    docsWriteEnabled,
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
    publishEnabled,
  })) {
    assertDisabledFlag(
      value,
      fieldName,
      'GraphDocsMarkdownFinalOutputBoundarySummary',
    );
  }
  const sourceHandoffItem = sourceHandoff.items[0];
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceHandoff.graphVersion,
    queryName: 'createGraphDocsMarkdownFinalOutputBoundarySummary',
    artifactFamily: 'site-capability-graph-docs-markdown-final-output-boundary-summary',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      summaryName: assertRequiredText(
        summaryName,
        'summaryName',
        'GraphDocsMarkdownFinalOutputBoundarySummary',
      ),
      summaryMode: 'descriptor-only',
      summaryKind: 'final-docs-output-boundary-summary',
      indexRelativePath: sourceHandoffItem.indexRelativePath,
      manifestRelativePath: sourceHandoffItem.manifestRelativePath,
      generatedOutputTargetRelativePath: sourceHandoffItem.generatedOutputTargetRelativePath,
      sourceHandoffFamily: sourceHandoff.artifactFamily,
      sourceCleanupPolicyFamily: sourceHandoffItem.sourceCleanupPolicyFamily,
      sourceIndexGuardFamily: sourceHandoffItem.sourceIndexGuardFamily,
      sourceManifestGuardFamily: sourceHandoffItem.sourceManifestGuardFamily,
      sourceOutputFamily: sourceHandoffItem.sourceOutputFamily,
      sourceGateFamily: sourceHandoffItem.sourceGateFamily,
      finalizationEnabled: false,
      runtimeOutputEnabled: false,
      docsWriteEnabled: false,
      repoWriteEnabled: false,
      runtimeArtifactWriteEnabled: false,
      externalCommandEnabled: false,
      publishEnabled: false,
      redactionRequiredBeforeFinalOutput: true,
      layerConsumerRequired: true,
      requiredHandoff: 'createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff',
      requiredLayerConsumer: 'disabled until explicit Layer docs output consumer exists',
      requiredArtifactGuard: 'SecurityGuard/Redaction before graph-derived final docs output',
      sourceHandoff: cloneDescriptor(sourceHandoff),
    }],
  };
  assertGraphDocsMarkdownFinalOutputBoundarySummaryCompatibility(result);
  return cloneDescriptor(result);
}

const GRAPH_DOCS_OUTPUT_COMPLETION_CHECKLIST_RUNTIME_PRODUCT_KEYS = Object.freeze([
  'artifactPath',
  'checklistOutput',
  'completionResult',
  'docsOutput',
  'docsOutputPath',
  'downloadPolicy',
  'externalCommand',
  'externalDispatch',
  'externalTelemetry',
  'filesystemWrite',
  'finalAcceptance',
  'finalAcceptanceReport',
  'finalAcceptancePayload',
  'finalBReviewChecklist',
  'finalOutput',
  'finalMatrixHandoff',
  'acceptanceResult',
  'acceptancePayload',
  'handoffPayload',
  'handoffResult',
  'matrixHandoff',
  'matrixOutput',
  'matrixOutputPath',
  'matrixPatch',
  'matrixStatusUpdate',
  'matrixWrite',
  'outputPath',
  'publishPayload',
  'publishTarget',
  'reportOutput',
  'reportPayload',
  'reportResult',
  'reviewOutput',
  'reviewPayload',
  'reviewResult',
  'repoPath',
  'repositoryPath',
  'runtimeArtifact',
  'runtimeChecklist',
  'runtimeOutput',
  'runtimeReport',
  'runtimeWriter',
  'sessionView',
  'standardTaskList',
  'statusPromotion',
  'taskList',
  'unredactedPayload',
  'verifiedPromotion',
  'writePath',
  'writer',
]);

const GRAPH_DOCS_OUTPUT_COMPLETION_CHECKLIST_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_DOCS_OUTPUT_COMPLETION_CHECKLIST_RUNTIME_PRODUCT_KEYS.map((key) => normalizeKey(key)),
);

function assertNoGraphDocsOutputCompletionChecklistRuntimeProducts(
  value,
  label = 'GraphDocsOutputCompletionChecklist',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoGraphDocsOutputCompletionChecklistRuntimeProducts(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (GRAPH_DOCS_OUTPUT_COMPLETION_CHECKLIST_RUNTIME_PRODUCT_KEY_SET.has(normalizeKey(key))) {
      throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${path}.${key}`);
    }
    assertNoGraphDocsOutputCompletionChecklistRuntimeProducts(entry, label, `${path}.${key}`);
  }
  return true;
}

/** @param {Record<string, any>} [sourceBoundarySummary] */
function assertGraphDocsOutputCompletionChecklistSourceCompatible(sourceBoundarySummary = {}) {
  assertPlainObject(
    sourceBoundarySummary,
    'GraphDocsOutputCompletionChecklist.sourceBoundarySummary',
  );
  assertGraphDocsMarkdownFinalOutputBoundarySummaryCompatibility(sourceBoundarySummary);
  if (sourceBoundarySummary.artifactFamily !== 'site-capability-graph-docs-markdown-final-output-boundary-summary') {
    throw new Error('GraphDocsOutputCompletionChecklist sourceBoundarySummary must be a final docs-output boundary summary');
  }
  return true;
}

const GRAPH_DOCS_OUTPUT_COMPLETION_REQUIRED_EVIDENCE = Object.freeze([
  'docs-generator-passed',
  'docs-matrix-cross-check-passed',
  'matrix-updated-with-verification',
  'descriptor-only-boundary-preserved',
  'redaction-required-before-output',
  'B-review-accepted',
]);

function assertGraphDocsOutputCompletionChecklistRequiredEvidence(requiredEvidence = []) {
  if (!Array.isArray(requiredEvidence)) {
    throw new Error('GraphDocsOutputCompletionChecklist requiredEvidence must include completion gates');
  }
  for (const evidence of GRAPH_DOCS_OUTPUT_COMPLETION_REQUIRED_EVIDENCE) {
    if (!requiredEvidence.includes(evidence)) {
      throw new Error(`GraphDocsOutputCompletionChecklist requiredEvidence must include ${evidence}`);
    }
  }
  return true;
}

/** @param {Record<string, any>} [result] */
export function assertGraphDocsOutputCompletionChecklistCompatibility(result = {}) {
  assertPlainObject(result, 'GraphDocsOutputCompletionChecklist');
  assertNoGraphDocsOutputCompletionChecklistRuntimeProducts(result);
  assertNoForbiddenGraphFields(result, 'GraphDocsOutputCompletionChecklist');
  assertNoForbiddenPatterns(result);
  assertGraphQueryResultCompatible(result);
  if (result.queryName !== 'createGraphDocsOutputCompletionChecklist') {
    throw new Error('GraphDocsOutputCompletionChecklist queryName must be createGraphDocsOutputCompletionChecklist');
  }
  if (result.artifactFamily !== 'site-capability-graph-docs-output-completion-checklist') {
    throw new Error('GraphDocsOutputCompletionChecklist artifactFamily must be site-capability-graph-docs-output-completion-checklist');
  }
  if (result.redactionRequired !== true) {
    throw new Error('GraphDocsOutputCompletionChecklist redactionRequired must be true');
  }
  if (!Array.isArray(result.items) || result.items.length === 0) {
    throw new Error('GraphDocsOutputCompletionChecklist items are required');
  }
  for (const [index, item] of result.items.entries()) {
    assertPlainObject(item, `GraphDocsOutputCompletionChecklist.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphDocsOutputCompletionChecklist item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.checklistMode !== 'descriptor-only') {
      throw new Error('GraphDocsOutputCompletionChecklist checklistMode must be descriptor-only');
    }
    if (item.checklistKind !== 'docs-output-completion-checklist') {
      throw new Error('GraphDocsOutputCompletionChecklist checklistKind must be docs-output-completion-checklist');
    }
    for (const fieldName of [
      'completionEnabled',
      'runtimeChecklistEnabled',
      'docsWriteEnabled',
      'repoWriteEnabled',
      'runtimeArtifactWriteEnabled',
      'externalCommandEnabled',
      'publishEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphDocsOutputCompletionChecklist ${fieldName} must be false`);
      }
    }
    if (item.redactionRequiredBeforeCompletion !== true) {
      throw new Error('GraphDocsOutputCompletionChecklist redactionRequiredBeforeCompletion must be true');
    }
    if (item.layerConsumerRequired !== true) {
      throw new Error('GraphDocsOutputCompletionChecklist layerConsumerRequired must be true');
    }
    assertGraphDocsOutputCompletionChecklistRequiredEvidence(item.requiredEvidence);
    normalizeGraphDocsMarkdownRepoOutputTarget(item.generatedOutputTargetRelativePath);
    normalizeGraphDocsMarkdownGeneratedOutputManifestTarget(item.manifestRelativePath);
    normalizeGraphDocsMarkdownRetainedOutputIndexTarget(item.indexRelativePath);
    assertPlainObject(
      item.sourceBoundarySummary,
      `GraphDocsOutputCompletionChecklist.items[${index}].sourceBoundarySummary`,
    );
    assertGraphDocsOutputCompletionChecklistSourceCompatible(item.sourceBoundarySummary);
  }
  return true;
}

/** @param {Record<string, any>} [sourceBoundarySummary] */
export function createGraphDocsOutputCompletionChecklist(sourceBoundarySummary = {}, options = {}) {
  assertGraphDocsOutputCompletionChecklistSourceCompatible(sourceBoundarySummary);
  assertPlainObject(options, 'GraphDocsOutputCompletionChecklistOptions');
  assertNoGraphDocsOutputCompletionChecklistRuntimeProducts(
    options,
    'GraphDocsOutputCompletionChecklistOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphDocsOutputCompletionChecklistOptions');
  assertNoForbiddenPatterns(options);
  const {
    checklistName = 'site-capability-graph-docs-output-completion-checklist',
    completionEnabled,
    runtimeChecklistEnabled,
    docsWriteEnabled,
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
    publishEnabled,
  } = options;
  for (const [fieldName, value] of Object.entries({
    completionEnabled,
    runtimeChecklistEnabled,
    docsWriteEnabled,
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
    publishEnabled,
  })) {
    assertDisabledFlag(
      value,
      fieldName,
      'GraphDocsOutputCompletionChecklist',
    );
  }
  const sourceBoundaryItem = sourceBoundarySummary.items[0];
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceBoundarySummary.graphVersion,
    queryName: 'createGraphDocsOutputCompletionChecklist',
    artifactFamily: 'site-capability-graph-docs-output-completion-checklist',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      checklistName: assertRequiredText(
        checklistName,
        'checklistName',
        'GraphDocsOutputCompletionChecklist',
      ),
      checklistMode: 'descriptor-only',
      checklistKind: 'docs-output-completion-checklist',
      indexRelativePath: sourceBoundaryItem.indexRelativePath,
      manifestRelativePath: sourceBoundaryItem.manifestRelativePath,
      generatedOutputTargetRelativePath: sourceBoundaryItem.generatedOutputTargetRelativePath,
      sourceBoundarySummaryFamily: sourceBoundarySummary.artifactFamily,
      sourceHandoffFamily: sourceBoundaryItem.sourceHandoffFamily,
      sourceCleanupPolicyFamily: sourceBoundaryItem.sourceCleanupPolicyFamily,
      sourceIndexGuardFamily: sourceBoundaryItem.sourceIndexGuardFamily,
      sourceManifestGuardFamily: sourceBoundaryItem.sourceManifestGuardFamily,
      sourceOutputFamily: sourceBoundaryItem.sourceOutputFamily,
      sourceGateFamily: sourceBoundaryItem.sourceGateFamily,
      completionEnabled: false,
      runtimeChecklistEnabled: false,
      docsWriteEnabled: false,
      repoWriteEnabled: false,
      runtimeArtifactWriteEnabled: false,
      externalCommandEnabled: false,
      publishEnabled: false,
      redactionRequiredBeforeCompletion: true,
      layerConsumerRequired: true,
      requiredBoundarySummary: 'createGraphDocsMarkdownFinalOutputBoundarySummary',
      requiredLayerConsumer: 'disabled until explicit Layer docs output completion consumer exists',
      requiredArtifactGuard: 'SecurityGuard/Redaction before graph-derived docs completion output',
      requiredEvidence: [...GRAPH_DOCS_OUTPUT_COMPLETION_REQUIRED_EVIDENCE],
      sourceBoundarySummary: cloneDescriptor(sourceBoundarySummary),
    }],
  };
  assertGraphDocsOutputCompletionChecklistCompatibility(result);
  return cloneDescriptor(result);
}

/** @param {Record<string, any>} [sourceChecklist] */
function assertGraphDocsOutputFinalMatrixHandoffSourceCompatible(sourceChecklist = {}) {
  assertPlainObject(
    sourceChecklist,
    'GraphDocsOutputFinalMatrixHandoff.sourceChecklist',
  );
  assertGraphDocsOutputCompletionChecklistCompatibility(sourceChecklist);
  if (sourceChecklist.artifactFamily !== 'site-capability-graph-docs-output-completion-checklist') {
    throw new Error('GraphDocsOutputFinalMatrixHandoff sourceChecklist must be a docs-output completion checklist');
  }
  return true;
}

/** @param {Record<string, any>} [result] */
export function assertGraphDocsOutputFinalMatrixHandoffCompatibility(result = {}) {
  assertPlainObject(result, 'GraphDocsOutputFinalMatrixHandoff');
  assertNoGraphDocsOutputCompletionChecklistRuntimeProducts(
    result,
    'GraphDocsOutputFinalMatrixHandoff',
  );
  assertNoForbiddenGraphFields(result, 'GraphDocsOutputFinalMatrixHandoff');
  assertNoForbiddenPatterns(result);
  assertGraphQueryResultCompatible(result);
  if (result.queryName !== 'createGraphDocsOutputFinalMatrixHandoff') {
    throw new Error('GraphDocsOutputFinalMatrixHandoff queryName must be createGraphDocsOutputFinalMatrixHandoff');
  }
  if (result.artifactFamily !== 'site-capability-graph-docs-output-final-matrix-handoff') {
    throw new Error('GraphDocsOutputFinalMatrixHandoff artifactFamily must be site-capability-graph-docs-output-final-matrix-handoff');
  }
  if (result.redactionRequired !== true) {
    throw new Error('GraphDocsOutputFinalMatrixHandoff redactionRequired must be true');
  }
  if (!Array.isArray(result.items) || result.items.length === 0) {
    throw new Error('GraphDocsOutputFinalMatrixHandoff items are required');
  }
  for (const [index, item] of result.items.entries()) {
    assertPlainObject(item, `GraphDocsOutputFinalMatrixHandoff.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphDocsOutputFinalMatrixHandoff item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.handoffMode !== 'descriptor-only') {
      throw new Error('GraphDocsOutputFinalMatrixHandoff handoffMode must be descriptor-only');
    }
    if (item.handoffKind !== 'docs-output-completion-final-matrix-handoff') {
      throw new Error('GraphDocsOutputFinalMatrixHandoff handoffKind must be docs-output-completion-final-matrix-handoff');
    }
    for (const fieldName of [
      'handoffEnabled',
      'runtimeMatrixUpdateEnabled',
      'matrixWriteEnabled',
      'docsWriteEnabled',
      'repoWriteEnabled',
      'runtimeArtifactWriteEnabled',
      'externalCommandEnabled',
      'publishEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphDocsOutputFinalMatrixHandoff ${fieldName} must be false`);
      }
    }
    if (item.redactionRequiredBeforeMatrixUpdate !== true) {
      throw new Error('GraphDocsOutputFinalMatrixHandoff redactionRequiredBeforeMatrixUpdate must be true');
    }
    if (item.layerConsumerRequired !== true) {
      throw new Error('GraphDocsOutputFinalMatrixHandoff layerConsumerRequired must be true');
    }
    if (item.BReviewRequired !== true) {
      throw new Error('GraphDocsOutputFinalMatrixHandoff BReviewRequired must be true');
    }
    normalizeGraphDocsMarkdownRepoOutputTarget(item.generatedOutputTargetRelativePath);
    normalizeGraphDocsMarkdownGeneratedOutputManifestTarget(item.manifestRelativePath);
    normalizeGraphDocsMarkdownRetainedOutputIndexTarget(item.indexRelativePath);
    assertPlainObject(
      item.sourceChecklist,
      `GraphDocsOutputFinalMatrixHandoff.items[${index}].sourceChecklist`,
    );
    assertGraphDocsOutputFinalMatrixHandoffSourceCompatible(item.sourceChecklist);
  }
  return true;
}

/** @param {Record<string, any>} [sourceChecklist] */
export function createGraphDocsOutputFinalMatrixHandoff(sourceChecklist = {}, options = {}) {
  assertGraphDocsOutputFinalMatrixHandoffSourceCompatible(sourceChecklist);
  assertPlainObject(options, 'GraphDocsOutputFinalMatrixHandoffOptions');
  assertNoGraphDocsOutputCompletionChecklistRuntimeProducts(
    options,
    'GraphDocsOutputFinalMatrixHandoffOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphDocsOutputFinalMatrixHandoffOptions');
  assertNoForbiddenPatterns(options);
  const {
    handoffName = 'site-capability-graph-docs-output-final-matrix-handoff',
    handoffEnabled,
    runtimeMatrixUpdateEnabled,
    matrixWriteEnabled,
    docsWriteEnabled,
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
    publishEnabled,
  } = options;
  for (const [fieldName, value] of Object.entries({
    handoffEnabled,
    runtimeMatrixUpdateEnabled,
    matrixWriteEnabled,
    docsWriteEnabled,
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
    publishEnabled,
  })) {
    assertDisabledFlag(
      value,
      fieldName,
      'GraphDocsOutputFinalMatrixHandoff',
    );
  }
  const sourceChecklistItem = sourceChecklist.items[0];
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceChecklist.graphVersion,
    queryName: 'createGraphDocsOutputFinalMatrixHandoff',
    artifactFamily: 'site-capability-graph-docs-output-final-matrix-handoff',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      handoffName: assertRequiredText(
        handoffName,
        'handoffName',
        'GraphDocsOutputFinalMatrixHandoff',
      ),
      handoffMode: 'descriptor-only',
      handoffKind: 'docs-output-completion-final-matrix-handoff',
      indexRelativePath: sourceChecklistItem.indexRelativePath,
      manifestRelativePath: sourceChecklistItem.manifestRelativePath,
      generatedOutputTargetRelativePath: sourceChecklistItem.generatedOutputTargetRelativePath,
      sourceChecklistFamily: sourceChecklist.artifactFamily,
      sourceBoundarySummaryFamily: sourceChecklistItem.sourceBoundarySummaryFamily,
      sourceHandoffFamily: sourceChecklistItem.sourceHandoffFamily,
      sourceCleanupPolicyFamily: sourceChecklistItem.sourceCleanupPolicyFamily,
      sourceIndexGuardFamily: sourceChecklistItem.sourceIndexGuardFamily,
      sourceManifestGuardFamily: sourceChecklistItem.sourceManifestGuardFamily,
      sourceOutputFamily: sourceChecklistItem.sourceOutputFamily,
      sourceGateFamily: sourceChecklistItem.sourceGateFamily,
      handoffEnabled: false,
      runtimeMatrixUpdateEnabled: false,
      matrixWriteEnabled: false,
      docsWriteEnabled: false,
      repoWriteEnabled: false,
      runtimeArtifactWriteEnabled: false,
      externalCommandEnabled: false,
      publishEnabled: false,
      redactionRequiredBeforeMatrixUpdate: true,
      layerConsumerRequired: true,
      BReviewRequired: true,
      requiredChecklist: 'createGraphDocsOutputCompletionChecklist',
      requiredLayerConsumer: 'disabled until explicit Layer docs output matrix handoff consumer exists',
      requiredArtifactGuard: 'SecurityGuard/Redaction before graph-derived docs matrix handoff output',
      requiredMatrixLedger: 'IMPLEMENTATION_MATRIX.md updated by Agent A and reviewed by Agent B',
      sourceChecklist: cloneDescriptor(sourceChecklist),
    }],
  };
  assertGraphDocsOutputFinalMatrixHandoffCompatibility(result);
  return cloneDescriptor(result);
}

/** @param {Record<string, any>} [sourceMatrixHandoff] */
function assertGraphDocsOutputFinalAcceptanceDescriptorSourceCompatible(sourceMatrixHandoff = {}) {
  assertPlainObject(
    sourceMatrixHandoff,
    'GraphDocsOutputFinalAcceptanceDescriptor.sourceMatrixHandoff',
  );
  assertGraphDocsOutputFinalMatrixHandoffCompatibility(sourceMatrixHandoff);
  if (sourceMatrixHandoff.artifactFamily !== 'site-capability-graph-docs-output-final-matrix-handoff') {
    throw new Error('GraphDocsOutputFinalAcceptanceDescriptor sourceMatrixHandoff must be a docs-output final matrix handoff');
  }
  return true;
}

/** @param {Record<string, any>} [result] */
export function assertGraphDocsOutputFinalAcceptanceDescriptorCompatibility(result = {}) {
  assertPlainObject(result, 'GraphDocsOutputFinalAcceptanceDescriptor');
  assertNoGraphDocsOutputCompletionChecklistRuntimeProducts(
    result,
    'GraphDocsOutputFinalAcceptanceDescriptor',
  );
  assertNoForbiddenGraphFields(result, 'GraphDocsOutputFinalAcceptanceDescriptor');
  assertNoForbiddenPatterns(result);
  assertGraphQueryResultCompatible(result);
  if (result.queryName !== 'createGraphDocsOutputFinalAcceptanceDescriptor') {
    throw new Error('GraphDocsOutputFinalAcceptanceDescriptor queryName must be createGraphDocsOutputFinalAcceptanceDescriptor');
  }
  if (result.artifactFamily !== 'site-capability-graph-docs-output-final-acceptance-descriptor') {
    throw new Error('GraphDocsOutputFinalAcceptanceDescriptor artifactFamily must be site-capability-graph-docs-output-final-acceptance-descriptor');
  }
  if (result.redactionRequired !== true) {
    throw new Error('GraphDocsOutputFinalAcceptanceDescriptor redactionRequired must be true');
  }
  if (!Array.isArray(result.items) || result.items.length === 0) {
    throw new Error('GraphDocsOutputFinalAcceptanceDescriptor items are required');
  }
  for (const [index, item] of result.items.entries()) {
    assertPlainObject(item, `GraphDocsOutputFinalAcceptanceDescriptor.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphDocsOutputFinalAcceptanceDescriptor item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.acceptanceMode !== 'descriptor-only') {
      throw new Error('GraphDocsOutputFinalAcceptanceDescriptor acceptanceMode must be descriptor-only');
    }
    if (item.acceptanceKind !== 'docs-output-final-acceptance-descriptor') {
      throw new Error('GraphDocsOutputFinalAcceptanceDescriptor acceptanceKind must be docs-output-final-acceptance-descriptor');
    }
    for (const fieldName of [
      'acceptanceEnabled',
      'runtimeAcceptanceEnabled',
      'matrixWriteEnabled',
      'docsWriteEnabled',
      'repoWriteEnabled',
      'runtimeArtifactWriteEnabled',
      'externalCommandEnabled',
      'publishEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphDocsOutputFinalAcceptanceDescriptor ${fieldName} must be false`);
      }
    }
    if (item.redactionRequiredBeforeAcceptance !== true) {
      throw new Error('GraphDocsOutputFinalAcceptanceDescriptor redactionRequiredBeforeAcceptance must be true');
    }
    if (item.layerConsumerRequired !== true) {
      throw new Error('GraphDocsOutputFinalAcceptanceDescriptor layerConsumerRequired must be true');
    }
    if (item.finalBReviewRequired !== true) {
      throw new Error('GraphDocsOutputFinalAcceptanceDescriptor finalBReviewRequired must be true');
    }
    if (item.matrixVerifiedPromotionAllowed !== false) {
      throw new Error('GraphDocsOutputFinalAcceptanceDescriptor matrixVerifiedPromotionAllowed must be false');
    }
    normalizeGraphDocsMarkdownRepoOutputTarget(item.generatedOutputTargetRelativePath);
    normalizeGraphDocsMarkdownGeneratedOutputManifestTarget(item.manifestRelativePath);
    normalizeGraphDocsMarkdownRetainedOutputIndexTarget(item.indexRelativePath);
    assertPlainObject(
      item.sourceMatrixHandoff,
      `GraphDocsOutputFinalAcceptanceDescriptor.items[${index}].sourceMatrixHandoff`,
    );
    assertGraphDocsOutputFinalAcceptanceDescriptorSourceCompatible(item.sourceMatrixHandoff);
  }
  return true;
}

/** @param {Record<string, any>} [sourceMatrixHandoff] */
export function createGraphDocsOutputFinalAcceptanceDescriptor(sourceMatrixHandoff = {}, options = {}) {
  assertGraphDocsOutputFinalAcceptanceDescriptorSourceCompatible(sourceMatrixHandoff);
  assertPlainObject(options, 'GraphDocsOutputFinalAcceptanceDescriptorOptions');
  assertNoGraphDocsOutputCompletionChecklistRuntimeProducts(
    options,
    'GraphDocsOutputFinalAcceptanceDescriptorOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphDocsOutputFinalAcceptanceDescriptorOptions');
  assertNoForbiddenPatterns(options);
  const {
    acceptanceName = 'site-capability-graph-docs-output-final-acceptance-descriptor',
    acceptanceEnabled,
    runtimeAcceptanceEnabled,
    matrixWriteEnabled,
    docsWriteEnabled,
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
    publishEnabled,
  } = options;
  for (const [fieldName, value] of Object.entries({
    acceptanceEnabled,
    runtimeAcceptanceEnabled,
    matrixWriteEnabled,
    docsWriteEnabled,
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
    publishEnabled,
  })) {
    assertDisabledFlag(
      value,
      fieldName,
      'GraphDocsOutputFinalAcceptanceDescriptor',
    );
  }
  const sourceMatrixHandoffItem = sourceMatrixHandoff.items[0];
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceMatrixHandoff.graphVersion,
    queryName: 'createGraphDocsOutputFinalAcceptanceDescriptor',
    artifactFamily: 'site-capability-graph-docs-output-final-acceptance-descriptor',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      acceptanceName: assertRequiredText(
        acceptanceName,
        'acceptanceName',
        'GraphDocsOutputFinalAcceptanceDescriptor',
      ),
      acceptanceMode: 'descriptor-only',
      acceptanceKind: 'docs-output-final-acceptance-descriptor',
      indexRelativePath: sourceMatrixHandoffItem.indexRelativePath,
      manifestRelativePath: sourceMatrixHandoffItem.manifestRelativePath,
      generatedOutputTargetRelativePath: sourceMatrixHandoffItem.generatedOutputTargetRelativePath,
      sourceMatrixHandoffFamily: sourceMatrixHandoff.artifactFamily,
      sourceChecklistFamily: sourceMatrixHandoffItem.sourceChecklistFamily,
      sourceBoundarySummaryFamily: sourceMatrixHandoffItem.sourceBoundarySummaryFamily,
      sourceHandoffFamily: sourceMatrixHandoffItem.sourceHandoffFamily,
      sourceCleanupPolicyFamily: sourceMatrixHandoffItem.sourceCleanupPolicyFamily,
      sourceIndexGuardFamily: sourceMatrixHandoffItem.sourceIndexGuardFamily,
      sourceManifestGuardFamily: sourceMatrixHandoffItem.sourceManifestGuardFamily,
      sourceOutputFamily: sourceMatrixHandoffItem.sourceOutputFamily,
      sourceGateFamily: sourceMatrixHandoffItem.sourceGateFamily,
      acceptanceEnabled: false,
      runtimeAcceptanceEnabled: false,
      matrixWriteEnabled: false,
      docsWriteEnabled: false,
      repoWriteEnabled: false,
      runtimeArtifactWriteEnabled: false,
      externalCommandEnabled: false,
      publishEnabled: false,
      redactionRequiredBeforeAcceptance: true,
      layerConsumerRequired: true,
      finalBReviewRequired: true,
      matrixVerifiedPromotionAllowed: false,
      requiredMatrixHandoff: 'createGraphDocsOutputFinalMatrixHandoff',
      requiredLayerConsumer: 'disabled until explicit Layer docs output final acceptance consumer exists',
      requiredArtifactGuard: 'SecurityGuard/Redaction before graph-derived docs final acceptance output',
      requiredFinalReview: 'Agent B final acceptance remains external to Graph descriptor generation',
      sourceMatrixHandoff: cloneDescriptor(sourceMatrixHandoff),
    }],
  };
  assertGraphDocsOutputFinalAcceptanceDescriptorCompatibility(result);
  return cloneDescriptor(result);
}

function assertGraphDocsOutputFinalAcceptanceReportDescriptorSourceCompatible(
  sourceAcceptanceDescriptor = {},
) {
  assertPlainObject(
    sourceAcceptanceDescriptor,
    'GraphDocsOutputFinalAcceptanceReportDescriptor.sourceAcceptanceDescriptor',
  );
  assertGraphDocsOutputFinalAcceptanceDescriptorCompatibility(sourceAcceptanceDescriptor);
  if (sourceAcceptanceDescriptor.artifactFamily !== 'site-capability-graph-docs-output-final-acceptance-descriptor') {
    throw new Error('GraphDocsOutputFinalAcceptanceReportDescriptor sourceAcceptanceDescriptor must be a docs-output final acceptance descriptor');
  }
  return true;
}

/** @param {Record<string, any>} [result] */
export function assertGraphDocsOutputFinalAcceptanceReportDescriptorCompatibility(result = {}) {
  assertPlainObject(result, 'GraphDocsOutputFinalAcceptanceReportDescriptor');
  assertNoGraphDocsOutputCompletionChecklistRuntimeProducts(
    result,
    'GraphDocsOutputFinalAcceptanceReportDescriptor',
  );
  assertNoForbiddenGraphFields(result, 'GraphDocsOutputFinalAcceptanceReportDescriptor');
  assertNoForbiddenPatterns(result);
  assertGraphQueryResultCompatible(result);
  if (result.queryName !== 'createGraphDocsOutputFinalAcceptanceReportDescriptor') {
    throw new Error('GraphDocsOutputFinalAcceptanceReportDescriptor queryName must be createGraphDocsOutputFinalAcceptanceReportDescriptor');
  }
  if (result.artifactFamily !== 'site-capability-graph-docs-output-final-acceptance-report-descriptor') {
    throw new Error('GraphDocsOutputFinalAcceptanceReportDescriptor artifactFamily must be site-capability-graph-docs-output-final-acceptance-report-descriptor');
  }
  if (result.redactionRequired !== true) {
    throw new Error('GraphDocsOutputFinalAcceptanceReportDescriptor redactionRequired must be true');
  }
  if (!Array.isArray(result.items) || result.items.length === 0) {
    throw new Error('GraphDocsOutputFinalAcceptanceReportDescriptor items are required');
  }
  for (const [index, item] of result.items.entries()) {
    assertPlainObject(item, `GraphDocsOutputFinalAcceptanceReportDescriptor.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphDocsOutputFinalAcceptanceReportDescriptor item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.reportMode !== 'descriptor-only') {
      throw new Error('GraphDocsOutputFinalAcceptanceReportDescriptor reportMode must be descriptor-only');
    }
    if (item.reportKind !== 'docs-output-final-acceptance-report-descriptor') {
      throw new Error('GraphDocsOutputFinalAcceptanceReportDescriptor reportKind must be docs-output-final-acceptance-report-descriptor');
    }
    for (const fieldName of [
      'reportEnabled',
      'runtimeReportEnabled',
      'matrixWriteEnabled',
      'docsWriteEnabled',
      'repoWriteEnabled',
      'runtimeArtifactWriteEnabled',
      'externalCommandEnabled',
      'publishEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphDocsOutputFinalAcceptanceReportDescriptor ${fieldName} must be false`);
      }
    }
    if (item.redactionRequiredBeforeReport !== true) {
      throw new Error('GraphDocsOutputFinalAcceptanceReportDescriptor redactionRequiredBeforeReport must be true');
    }
    if (item.layerConsumerRequired !== true) {
      throw new Error('GraphDocsOutputFinalAcceptanceReportDescriptor layerConsumerRequired must be true');
    }
    if (item.finalBReviewRequired !== true) {
      throw new Error('GraphDocsOutputFinalAcceptanceReportDescriptor finalBReviewRequired must be true');
    }
    if (item.publishAllowed !== false) {
      throw new Error('GraphDocsOutputFinalAcceptanceReportDescriptor publishAllowed must be false');
    }
    if (item.matrixVerifiedPromotionAllowed !== false) {
      throw new Error('GraphDocsOutputFinalAcceptanceReportDescriptor matrixVerifiedPromotionAllowed must be false');
    }
    normalizeGraphDocsMarkdownRepoOutputTarget(item.generatedOutputTargetRelativePath);
    normalizeGraphDocsMarkdownGeneratedOutputManifestTarget(item.manifestRelativePath);
    normalizeGraphDocsMarkdownRetainedOutputIndexTarget(item.indexRelativePath);
    assertPlainObject(
      item.sourceAcceptanceDescriptor,
      `GraphDocsOutputFinalAcceptanceReportDescriptor.items[${index}].sourceAcceptanceDescriptor`,
    );
    assertGraphDocsOutputFinalAcceptanceReportDescriptorSourceCompatible(item.sourceAcceptanceDescriptor);
  }
  return true;
}

export function createGraphDocsOutputFinalAcceptanceReportDescriptor(
  sourceAcceptanceDescriptor = {},
  options = {},
) {
  assertGraphDocsOutputFinalAcceptanceReportDescriptorSourceCompatible(sourceAcceptanceDescriptor);
  assertPlainObject(options, 'GraphDocsOutputFinalAcceptanceReportDescriptorOptions');
  assertNoGraphDocsOutputCompletionChecklistRuntimeProducts(
    options,
    'GraphDocsOutputFinalAcceptanceReportDescriptorOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphDocsOutputFinalAcceptanceReportDescriptorOptions');
  assertNoForbiddenPatterns(options);
  const {
    reportName = 'site-capability-graph-docs-output-final-acceptance-report-descriptor',
    reportEnabled,
    runtimeReportEnabled,
    matrixWriteEnabled,
    docsWriteEnabled,
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
    publishEnabled,
  } = options;
  for (const [fieldName, value] of Object.entries({
    reportEnabled,
    runtimeReportEnabled,
    matrixWriteEnabled,
    docsWriteEnabled,
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
    publishEnabled,
  })) {
    assertDisabledFlag(
      value,
      fieldName,
      'GraphDocsOutputFinalAcceptanceReportDescriptor',
    );
  }
  const sourceAcceptanceItem = sourceAcceptanceDescriptor.items[0];
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceAcceptanceDescriptor.graphVersion,
    queryName: 'createGraphDocsOutputFinalAcceptanceReportDescriptor',
    artifactFamily: 'site-capability-graph-docs-output-final-acceptance-report-descriptor',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      reportName: assertRequiredText(
        reportName,
        'reportName',
        'GraphDocsOutputFinalAcceptanceReportDescriptor',
      ),
      reportMode: 'descriptor-only',
      reportKind: 'docs-output-final-acceptance-report-descriptor',
      indexRelativePath: sourceAcceptanceItem.indexRelativePath,
      manifestRelativePath: sourceAcceptanceItem.manifestRelativePath,
      generatedOutputTargetRelativePath: sourceAcceptanceItem.generatedOutputTargetRelativePath,
      sourceAcceptanceDescriptorFamily: sourceAcceptanceDescriptor.artifactFamily,
      sourceMatrixHandoffFamily: sourceAcceptanceItem.sourceMatrixHandoffFamily,
      sourceChecklistFamily: sourceAcceptanceItem.sourceChecklistFamily,
      sourceBoundarySummaryFamily: sourceAcceptanceItem.sourceBoundarySummaryFamily,
      sourceHandoffFamily: sourceAcceptanceItem.sourceHandoffFamily,
      sourceCleanupPolicyFamily: sourceAcceptanceItem.sourceCleanupPolicyFamily,
      sourceIndexGuardFamily: sourceAcceptanceItem.sourceIndexGuardFamily,
      sourceManifestGuardFamily: sourceAcceptanceItem.sourceManifestGuardFamily,
      sourceOutputFamily: sourceAcceptanceItem.sourceOutputFamily,
      sourceGateFamily: sourceAcceptanceItem.sourceGateFamily,
      reportEnabled: false,
      runtimeReportEnabled: false,
      matrixWriteEnabled: false,
      docsWriteEnabled: false,
      repoWriteEnabled: false,
      runtimeArtifactWriteEnabled: false,
      externalCommandEnabled: false,
      publishEnabled: false,
      redactionRequiredBeforeReport: true,
      layerConsumerRequired: true,
      finalBReviewRequired: true,
      publishAllowed: false,
      matrixVerifiedPromotionAllowed: false,
      requiredAcceptanceDescriptor: 'createGraphDocsOutputFinalAcceptanceDescriptor',
      requiredLayerConsumer: 'disabled until explicit Layer docs output final acceptance report consumer exists',
      requiredArtifactGuard: 'SecurityGuard/Redaction before graph-derived docs final acceptance report output',
      requiredFinalReview: 'Agent B final acceptance report remains external to Graph descriptor generation',
      sourceAcceptanceDescriptor: cloneDescriptor(sourceAcceptanceDescriptor),
    }],
  };
  assertGraphDocsOutputFinalAcceptanceReportDescriptorCompatibility(result);
  return cloneDescriptor(result);
}

function assertGraphDocsOutputFinalBReviewChecklistSourceCompatible(
  sourceAcceptanceReportDescriptor = {},
) {
  assertPlainObject(
    sourceAcceptanceReportDescriptor,
    'GraphDocsOutputFinalBReviewChecklist.sourceAcceptanceReportDescriptor',
  );
  assertGraphDocsOutputFinalAcceptanceReportDescriptorCompatibility(sourceAcceptanceReportDescriptor);
  if (sourceAcceptanceReportDescriptor.artifactFamily !== 'site-capability-graph-docs-output-final-acceptance-report-descriptor') {
    throw new Error('GraphDocsOutputFinalBReviewChecklist sourceAcceptanceReportDescriptor must be a docs-output final acceptance report descriptor');
  }
  return true;
}

function normalizeFinalBReviewChecklistSections(remainingNonVerifiedSections = []) {
  if (!Array.isArray(remainingNonVerifiedSections) || remainingNonVerifiedSections.length === 0) {
    throw new Error('GraphDocsOutputFinalBReviewChecklist remainingNonVerifiedSections must list non-verified sections');
  }
  const normalized = [];
  const seen = new Set();
  for (const section of remainingNonVerifiedSections) {
    const number = Number(section);
    if (!Number.isInteger(number) || number < 1 || number > 20) {
      throw new Error('GraphDocsOutputFinalBReviewChecklist remainingNonVerifiedSections must contain section numbers 1-20');
    }
    if (seen.has(number)) {
      throw new Error('GraphDocsOutputFinalBReviewChecklist remainingNonVerifiedSections must be unique');
    }
    seen.add(number);
    normalized.push(number);
  }
  return normalized;
}

/** @param {Record<string, any>} [result] */
export function assertGraphDocsOutputFinalBReviewChecklistCompatibility(result = {}) {
  assertPlainObject(result, 'GraphDocsOutputFinalBReviewChecklist');
  assertNoGraphDocsOutputCompletionChecklistRuntimeProducts(
    result,
    'GraphDocsOutputFinalBReviewChecklist',
  );
  assertNoForbiddenGraphFields(result, 'GraphDocsOutputFinalBReviewChecklist');
  assertNoForbiddenPatterns(result);
  assertGraphQueryResultCompatible(result);
  if (result.queryName !== 'createGraphDocsOutputFinalBReviewChecklist') {
    throw new Error('GraphDocsOutputFinalBReviewChecklist queryName must be createGraphDocsOutputFinalBReviewChecklist');
  }
  if (result.artifactFamily !== 'site-capability-graph-docs-output-final-b-review-checklist') {
    throw new Error('GraphDocsOutputFinalBReviewChecklist artifactFamily must be site-capability-graph-docs-output-final-b-review-checklist');
  }
  if (result.redactionRequired !== true) {
    throw new Error('GraphDocsOutputFinalBReviewChecklist redactionRequired must be true');
  }
  if (!Array.isArray(result.items) || result.items.length === 0) {
    throw new Error('GraphDocsOutputFinalBReviewChecklist items are required');
  }
  for (const [index, item] of result.items.entries()) {
    assertPlainObject(item, `GraphDocsOutputFinalBReviewChecklist.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphDocsOutputFinalBReviewChecklist item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.checklistMode !== 'descriptor-only') {
      throw new Error('GraphDocsOutputFinalBReviewChecklist checklistMode must be descriptor-only');
    }
    if (item.checklistKind !== 'docs-output-final-b-review-checklist') {
      throw new Error('GraphDocsOutputFinalBReviewChecklist checklistKind must be docs-output-final-b-review-checklist');
    }
    for (const fieldName of [
      'reviewEnabled',
      'runtimeReviewEnabled',
      'matrixWriteEnabled',
      'docsWriteEnabled',
      'repoWriteEnabled',
      'runtimeArtifactWriteEnabled',
      'externalCommandEnabled',
      'publishEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphDocsOutputFinalBReviewChecklist ${fieldName} must be false`);
      }
    }
    if (item.redactionRequiredBeforeReview !== true) {
      throw new Error('GraphDocsOutputFinalBReviewChecklist redactionRequiredBeforeReview must be true');
    }
    if (item.layerConsumerRequired !== true) {
      throw new Error('GraphDocsOutputFinalBReviewChecklist layerConsumerRequired must be true');
    }
    if (item.BReviewRequired !== true) {
      throw new Error('GraphDocsOutputFinalBReviewChecklist BReviewRequired must be true');
    }
    if (item.reviewResultMaterialized !== false) {
      throw new Error('GraphDocsOutputFinalBReviewChecklist reviewResultMaterialized must be false');
    }
    if (item.matrixVerifiedPromotionAllowed !== false) {
      throw new Error('GraphDocsOutputFinalBReviewChecklist matrixVerifiedPromotionAllowed must be false');
    }
    if (item.remainingNonVerifiedCount !== item.remainingNonVerifiedSections.length) {
      throw new Error('GraphDocsOutputFinalBReviewChecklist remainingNonVerifiedCount must match remainingNonVerifiedSections');
    }
    normalizeFinalBReviewChecklistSections(item.remainingNonVerifiedSections);
    normalizeGraphDocsMarkdownRepoOutputTarget(item.generatedOutputTargetRelativePath);
    normalizeGraphDocsMarkdownGeneratedOutputManifestTarget(item.manifestRelativePath);
    normalizeGraphDocsMarkdownRetainedOutputIndexTarget(item.indexRelativePath);
    assertPlainObject(
      item.sourceAcceptanceReportDescriptor,
      `GraphDocsOutputFinalBReviewChecklist.items[${index}].sourceAcceptanceReportDescriptor`,
    );
    assertGraphDocsOutputFinalBReviewChecklistSourceCompatible(item.sourceAcceptanceReportDescriptor);
  }
  return true;
}

export function createGraphDocsOutputFinalBReviewChecklist(
  sourceAcceptanceReportDescriptor = {},
  options = {},
) {
  assertGraphDocsOutputFinalBReviewChecklistSourceCompatible(sourceAcceptanceReportDescriptor);
  assertPlainObject(options, 'GraphDocsOutputFinalBReviewChecklistOptions');
  assertNoGraphDocsOutputCompletionChecklistRuntimeProducts(
    options,
    'GraphDocsOutputFinalBReviewChecklistOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphDocsOutputFinalBReviewChecklistOptions');
  assertNoForbiddenPatterns(options);
  const {
    checklistName = 'site-capability-graph-docs-output-final-b-review-checklist',
    remainingNonVerifiedSections = Array.from({ length: 20 }, (_, index) => index + 1),
    reviewEnabled,
    runtimeReviewEnabled,
    matrixWriteEnabled,
    docsWriteEnabled,
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
    publishEnabled,
  } = options;
  for (const [fieldName, value] of Object.entries({
    reviewEnabled,
    runtimeReviewEnabled,
    matrixWriteEnabled,
    docsWriteEnabled,
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
    externalCommandEnabled,
    publishEnabled,
  })) {
    assertDisabledFlag(
      value,
      fieldName,
      'GraphDocsOutputFinalBReviewChecklist',
    );
  }
  const normalizedSections = normalizeFinalBReviewChecklistSections(remainingNonVerifiedSections);
  const sourceAcceptanceReportItem = sourceAcceptanceReportDescriptor.items[0];
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourceAcceptanceReportDescriptor.graphVersion,
    queryName: 'createGraphDocsOutputFinalBReviewChecklist',
    artifactFamily: 'site-capability-graph-docs-output-final-b-review-checklist',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      checklistName: assertRequiredText(
        checklistName,
        'checklistName',
        'GraphDocsOutputFinalBReviewChecklist',
      ),
      checklistMode: 'descriptor-only',
      checklistKind: 'docs-output-final-b-review-checklist',
      indexRelativePath: sourceAcceptanceReportItem.indexRelativePath,
      manifestRelativePath: sourceAcceptanceReportItem.manifestRelativePath,
      generatedOutputTargetRelativePath: sourceAcceptanceReportItem.generatedOutputTargetRelativePath,
      sourceAcceptanceReportDescriptorFamily: sourceAcceptanceReportDescriptor.artifactFamily,
      sourceAcceptanceDescriptorFamily: sourceAcceptanceReportItem.sourceAcceptanceDescriptorFamily,
      sourceMatrixHandoffFamily: sourceAcceptanceReportItem.sourceMatrixHandoffFamily,
      sourceChecklistFamily: sourceAcceptanceReportItem.sourceChecklistFamily,
      sourceBoundarySummaryFamily: sourceAcceptanceReportItem.sourceBoundarySummaryFamily,
      sourceHandoffFamily: sourceAcceptanceReportItem.sourceHandoffFamily,
      sourceCleanupPolicyFamily: sourceAcceptanceReportItem.sourceCleanupPolicyFamily,
      sourceIndexGuardFamily: sourceAcceptanceReportItem.sourceIndexGuardFamily,
      sourceManifestGuardFamily: sourceAcceptanceReportItem.sourceManifestGuardFamily,
      sourceOutputFamily: sourceAcceptanceReportItem.sourceOutputFamily,
      sourceGateFamily: sourceAcceptanceReportItem.sourceGateFamily,
      reviewEnabled: false,
      runtimeReviewEnabled: false,
      matrixWriteEnabled: false,
      docsWriteEnabled: false,
      repoWriteEnabled: false,
      runtimeArtifactWriteEnabled: false,
      externalCommandEnabled: false,
      publishEnabled: false,
      redactionRequiredBeforeReview: true,
      layerConsumerRequired: true,
      BReviewRequired: true,
      reviewResultMaterialized: false,
      matrixVerifiedPromotionAllowed: false,
      remainingNonVerifiedSections: normalizedSections,
      remainingNonVerifiedCount: normalizedSections.length,
      requiredAcceptanceReportDescriptor: 'createGraphDocsOutputFinalAcceptanceReportDescriptor',
      requiredLayerConsumer: 'disabled until explicit Layer docs output final B-review consumer exists',
      requiredArtifactGuard: 'SecurityGuard/Redaction before graph-derived docs final B-review checklist output',
      requiredManualReview: 'Agent B review remains external to Graph descriptor generation',
      sourceAcceptanceReportDescriptor: cloneDescriptor(sourceAcceptanceReportDescriptor),
    }],
  };
  assertGraphDocsOutputFinalBReviewChecklistCompatibility(result);
  return cloneDescriptor(result);
}

function markdownValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map(markdownValue).join(', ') : 'none';
  }
  const text = String(value ?? 'none').replace(/\s+/gu, ' ').trim();
  return (text || 'none').replaceAll('|', '\\|');
}

function markdownDescriptor(value) {
  return value && typeof value === 'object'
    ? markdownValue(JSON.stringify(value))
    : markdownValue(value);
}

function renderMarkdownEntries(entries, renderEntry) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return ['- none'];
  }
  return entries.map(renderEntry);
}

const GRAPH_DOCS_MARKDOWN_CONSUMER_RUNTIME_PRODUCT_KEYS = Object.freeze([
  'artifactPath',
  'browserProfile',
  'browserProfilePath',
  'dispatch',
  'docsOutputPath',
  'docsPath',
  'docsWriteEnabled',
  'downloadPolicy',
  'externalDispatch',
  'externalTelemetry',
  'externalTelemetryDispatch',
  'externalTelemetryDispatchEnabled',
  'filesystemWrite',
  'handler',
  'outputPath',
  'rawPayload',
  'repoPath',
  'repositoryPath',
  'runtimeDocsWriteEnabled',
  'sessionView',
  'standardTaskList',
  'subscriberResults',
  'subscribers',
  'taskList',
  'unredactedPayload',
  'userDataDir',
  'writePath',
  'writer',
]);

const GRAPH_DOCS_MARKDOWN_CONSUMER_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_DOCS_MARKDOWN_CONSUMER_RUNTIME_PRODUCT_KEYS.map((key) => normalizeKey(key)),
);

function assertNoGraphDocsMarkdownConsumerRuntimeProducts(
  value,
  label = 'GraphDocsMarkdownArtifactConsumer',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoGraphDocsMarkdownConsumerRuntimeProducts(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (GRAPH_DOCS_MARKDOWN_CONSUMER_RUNTIME_PRODUCT_KEY_SET.has(normalizeKey(key))) {
      throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${path}.${key}`);
    }
    assertNoGraphDocsMarkdownConsumerRuntimeProducts(entry, label, `${path}.${key}`);
  }
  return true;
}

function assertGraphDocsMarkdownLayerSourceReferences(markdown = '') {
  for (const requiredText of [
    '## Layer Design Sources',
    'status: present-reference',
    'AGENTS.md',
    'README.md',
  ]) {
    if (!markdown.includes(requiredText)) {
      throw new Error(`GraphDocsMarkdownArtifactConsumer missing Layer source reference: ${requiredText}`);
    }
  }
  return true;
}

/** @param {Record<string, any>} [summary] */
export function renderGraphDocsSummaryMarkdown(summary = {}) {
  assertGraphDocsSummaryCompatible(summary);
  assertNoForbiddenPatterns(summary);

  const sections = summary.sections;
  const lines = [
    '# Site Capability Graph Docs Summary',
    '',
    `- schemaVersion: ${markdownValue(summary.schemaVersion)}`,
    `- graphVersion: ${markdownValue(summary.graphVersion)}`,
    `- artifactFamily: ${markdownValue(summary.artifactFamily)}`,
    `- redactionRequired: ${markdownValue(summary.redactionRequired)}`,
    '',
    '## Layer Design Sources',
    ...renderMarkdownEntries(sections.layerDesignSourceReferences, (source) => [
      `- ${markdownValue(source.path)}`,
      `  - role: ${markdownValue(source.role)}`,
      `  - status: ${markdownValue(source.status)}`,
      `  - verified: ${markdownValue(source.verified)}`,
      `  - note: ${markdownValue(source.note)}`,
    ]).flat(),
    '',
    '## Capabilities',
    ...renderMarkdownEntries(sections.capabilityList, (capability) => [
      `- ${markdownValue(capability.id)}`,
      `  - siteKey: ${markdownValue(capability.siteKey)}`,
      `  - capabilityKey: ${markdownValue(capability.capabilityKey)}`,
      `  - capabilityFamily: ${markdownValue(capability.capabilityFamily)}`,
      `  - mode: ${markdownValue(capability.mode)}`,
      `  - requiresApproval: ${markdownValue(capability.requiresApproval)}`,
      `  - routeRefs: ${markdownValue(capability.routeRefs)}`,
      `  - riskPolicyRef: ${markdownValue(capability.riskPolicyRef)}`,
      `  - testEvidenceRefs: ${markdownValue(capability.testEvidenceRefs)}`,
    ]).flat(),
    '',
    '## Dependency Map',
    ...renderMarkdownEntries(sections.dependencyMap, (edge) => (
      `- ${markdownValue(edge.id)} | type=${markdownValue(edge.type)} | from=${markdownValue(edge.from)} | to=${markdownValue(edge.to)}`
    )),
    '',
    '## Dependency Map By Edge Type',
    ...renderMarkdownEntries(sections.dependencyMapByEdgeType, (entry) => [
      `- ${markdownValue(entry.edgeType)} | count=${markdownValue(entry.edgeCount)}`,
      `  - edgeIds: ${markdownValue(entry.edgeIds)}`,
    ]).flat(),
    '',
    '## Route Dependencies',
    ...renderMarkdownEntries(sections.routeDependencySummary, (route) => [
      `- ${markdownValue(route.routeId)} | site=${markdownValue(route.siteKey)} | kind=${markdownValue(route.routeKind)} | pageType=${markdownValue(route.pageType)}`,
      `  - capabilityRefs: ${markdownValue(route.capabilityRefs)}`,
      `  - fallbackRouteRefs: ${markdownValue(route.fallbackRouteRefs)}`,
      `  - adapterRef: ${markdownDescriptor(route.adapterRef)}`,
      `  - riskPolicyRef: ${markdownValue(route.riskPolicyRef)}`,
      `  - testEvidenceRefs: ${markdownValue(route.testEvidenceRefs)}`,
    ]).flat(),
    '',
    '## Endpoint Impact Map',
    ...renderMarkdownEntries(sections.endpointImpactMap, (endpoint) => [
      `- ${markdownValue(endpoint.endpointId)}`,
      `  - siteKey: ${markdownValue(endpoint.siteKey)}`,
      `  - endpointKind: ${markdownValue(endpoint.endpointKind)}`,
      `  - lifecycleState: ${markdownValue(endpoint.lifecycleState)}`,
      `  - methodFamily: ${markdownValue(endpoint.methodFamily)}`,
      `  - routeRefs: ${markdownValue(endpoint.routeRefs)}`,
      `  - capabilityRefs: ${markdownValue(endpoint.capabilityRefs)}`,
      `  - authRequirementRef: ${markdownValue(endpoint.authRequirementRef)}`,
      `  - sessionRequirementRef: ${markdownValue(endpoint.sessionRequirementRef)}`,
      `  - signerRef: ${markdownValue(endpoint.signerRef)}`,
      `  - requestSchemaRef: ${markdownValue(endpoint.requestSchemaRef)}`,
      `  - responseSchemaRef: ${markdownValue(endpoint.responseSchemaRef)}`,
      `  - riskPolicyRef: ${markdownValue(endpoint.riskPolicyRef)}`,
      `  - versionRef: ${markdownValue(endpoint.versionRef)}`,
      `  - requiresCookie: ${markdownValue(endpoint.requiresCookie)}`,
      `  - requiresWbi: ${markdownValue(endpoint.requiresWbi)}`,
      `  - testEvidenceRefs: ${markdownValue(endpoint.testEvidenceRefs)}`,
    ]).flat(),
    '',
    '## Auth Requirements',
    ...renderMarkdownEntries(sections.authRequirementSummary, (entry) => (
      `- ${markdownValue(entry.capabilityId)} | authRefs: ${markdownValue(entry.authRequirementRefs)} | authRequiredFor: ${markdownValue(entry.authRequiredForRefs)} | sessionRefs: ${markdownValue(entry.sessionRequirementRefs)}`
    )),
    '',
    '## Signer Dependencies',
    ...renderMarkdownEntries(sections.signerDependencySummary, (entry) => (
      `- ${markdownValue(entry.signerId)} | site=${markdownValue(entry.siteKey)} | signer=${markdownValue(entry.signerKind)} | endpoints=${markdownValue(entry.supportedEndpointRefs)} | failureModeRefs=${markdownValue(entry.failureModeRefs)} | endpointSignerRefs=${markdownValue(entry.endpointSignerRefs)}`
    )),
    '',
    '## Risk Policies',
    ...renderMarkdownEntries(sections.riskPolicySummary, (entry) => (
      `- ${markdownValue(entry.ownerType)} ${markdownValue(entry.ownerId)} | policy=${markdownValue(entry.riskPolicyRef)} | state=${markdownValue(entry.riskState)} | capabilityRefs=${markdownValue(entry.riskPolicyCapabilityRefs)} | endpointRefs=${markdownValue(entry.riskPolicyEndpointRefs)}`
    )),
    '',
    '## Failure Modes',
    ...renderMarkdownEntries(sections.failureModeSummary, (entry) => [
      `- ${markdownValue(entry.failureModeId)} | reasonCode=${markdownValue(entry.reasonCode)}`,
      `  - retryable: ${markdownValue(entry.retryable)}`,
      `  - cooldownRequired: ${markdownValue(entry.cooldownRequired)}`,
      `  - isolationRequired: ${markdownValue(entry.isolationRequired)}`,
      `  - manualRecoveryRequired: ${markdownValue(entry.manualRecoveryRequired)}`,
      `  - degradable: ${markdownValue(entry.degradable)}`,
      `  - artifactWriteAllowed: ${markdownValue(entry.artifactWriteAllowed)}`,
      ...(entry.catalogAction === undefined ? [] : [`  - catalogAction: ${markdownValue(entry.catalogAction)}`]),
    ]).flat(),
    '',
    '## Agent Exposed Capabilities',
    ...renderMarkdownEntries(sections.agentExposedCapabilityList, (capability) => (
      `- ${markdownValue(capability.id)} | site=${markdownValue(capability.siteKey)} | key=${markdownValue(capability.capabilityKey)} | tests=${markdownValue(capability.testEvidenceRefs)}`
    )),
    '',
    '## Test Coverage',
    ...renderMarkdownEntries(sections.testCoverageSummary, (entry) => (
      `- ${markdownValue(entry.nodeId)} | type=${markdownValue(entry.nodeType)} | tests=${markdownValue(entry.testEvidenceRefs)}`
    )),
    '',
  ];

  const markdown = `${lines.join('\n').trimEnd()}\n`;
  assertNoGraphDocsLiveRuntimeWording(markdown, 'GraphDocsSummary markdown');
  assertNoForbiddenPatterns(markdown);
  return markdown;
}

/** @param {Record<string, any>} [artifact] */
export function assertGraphDocsMarkdownArtifactConsumerCompatibility(artifact = {}) {
  assertNoGraphDocsMarkdownConsumerRuntimeProducts(artifact);
  assertNoForbiddenGraphFields(artifact, 'GraphDocsMarkdownArtifactConsumer');
  assertNoForbiddenPatterns(artifact);
  assertGraphQueryResultCompatible(artifact);
  if (artifact.queryName !== 'renderGraphDocsSummaryMarkdown') {
    throw new Error('GraphDocsMarkdownArtifactConsumer queryName must be renderGraphDocsSummaryMarkdown');
  }
  if (artifact.artifactFamily !== 'site-capability-graph-docs-markdown') {
    throw new Error('GraphDocsMarkdownArtifactConsumer artifactFamily must be site-capability-graph-docs-markdown');
  }
  if (artifact.redactionRequired !== true) {
    throw new Error('GraphDocsMarkdownArtifactConsumer redactionRequired must be true');
  }
  for (const [index, item] of artifact.items.entries()) {
    assertPlainObject(item, `GraphDocsMarkdownArtifactConsumer.items[${index}]`);
    if (item.format !== 'markdown') {
      throw new Error(`GraphDocsMarkdownArtifactConsumer item format must be markdown: items[${index}]`);
    }
    assertRequiredText(item.markdown, `items[${index}].markdown`, 'GraphDocsMarkdownArtifactConsumer');
    assertNoForbiddenPatterns(item.markdown);
    assertGraphDocsMarkdownLayerSourceReferences(item.markdown);
  }
  return true;
}

/** @param {Record<string, any>} [summary] */
export function createGraphDocsMarkdownArtifact(summary = {}) {
  const markdown = renderGraphDocsSummaryMarkdown(summary);
  const artifact = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: summary.graphVersion,
    queryName: 'renderGraphDocsSummaryMarkdown',
    artifactFamily: 'site-capability-graph-docs-markdown',
    redactionRequired: true,
    items: [{
      format: 'markdown',
      markdown,
    }],
  };
  assertGraphQueryResultCompatible(artifact);
  assertNoForbiddenPatterns(artifact);
  assertGraphDocsMarkdownArtifactConsumerCompatibility(artifact);
  return cloneDescriptor(artifact);
}

function normalizeGraphDocsMarkdownRepoOutputTarget(value) {
  const text = assertRequiredText(
    value ?? 'runs/site-capability-graph/generated-docs-summary.md',
    'targetRelativePath',
    'GraphDocsMarkdownRepoOutputDryRun',
  ).replace(/\\/gu, '/');
  if (/^(?:[a-z]:|\/)/iu.test(text)) {
    throw new Error('GraphDocsMarkdownRepoOutputDryRun targetRelativePath must be repo-relative');
  }
  if (text.split('/').some((segment) => segment === '..')) {
    throw new Error('GraphDocsMarkdownRepoOutputDryRun targetRelativePath must stay within the repository');
  }
  if (!/^runs\/site-capability-graph\/[a-z0-9][a-z0-9-]{0,79}\.md$/u.test(text)) {
    throw new Error('GraphDocsMarkdownRepoOutputDryRun targetRelativePath must be runs/site-capability-graph/<artifact>.md');
  }
  assertNoForbiddenPatterns(text);
  return text;
}

/** @param {Record<string, any>} [result] */
export function assertGraphDocsMarkdownRepoOutputDryRunCompatibility(result = {}) {
  assertPlainObject(result, 'GraphDocsMarkdownRepoOutputDryRun');
  assertNoGraphDocsMarkdownConsumerRuntimeProducts(result, 'GraphDocsMarkdownRepoOutputDryRun');
  assertNoForbiddenGraphFields(result, 'GraphDocsMarkdownRepoOutputDryRun');
  assertNoForbiddenPatterns(result);
  assertGraphQueryResultCompatible(result);
  if (result.queryName !== 'createGraphDocsMarkdownRepoOutputDryRun') {
    throw new Error('GraphDocsMarkdownRepoOutputDryRun queryName must be createGraphDocsMarkdownRepoOutputDryRun');
  }
  if (result.artifactFamily !== 'site-capability-graph-docs-markdown-repo-output-dry-run') {
    throw new Error('GraphDocsMarkdownRepoOutputDryRun artifactFamily must be site-capability-graph-docs-markdown-repo-output-dry-run');
  }
  if (result.redactionRequired !== true) {
    throw new Error('GraphDocsMarkdownRepoOutputDryRun redactionRequired must be true');
  }
  if (!Array.isArray(result.items) || result.items.length === 0) {
    throw new Error('GraphDocsMarkdownRepoOutputDryRun items are required');
  }
  for (const [index, item] of result.items.entries()) {
    assertPlainObject(item, `GraphDocsMarkdownRepoOutputDryRun.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphDocsMarkdownRepoOutputDryRun item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.outputMode !== 'dry-run-preview') {
      throw new Error('GraphDocsMarkdownRepoOutputDryRun outputMode must be dry-run-preview');
    }
    if (item.dryRunOnly !== true) {
      throw new Error('GraphDocsMarkdownRepoOutputDryRun dryRunOnly must be true');
    }
    for (const fieldName of ['repoWriteEnabled', 'runtimeArtifactWriteEnabled']) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphDocsMarkdownRepoOutputDryRun ${fieldName} must be false`);
      }
    }
    if (item.explicitValidationRequired !== true) {
      throw new Error('GraphDocsMarkdownRepoOutputDryRun explicitValidationRequired must be true');
    }
    normalizeGraphDocsMarkdownRepoOutputTarget(item.targetRelativePath);
    assertPlainObject(item.docsArtifact, `GraphDocsMarkdownRepoOutputDryRun.items[${index}].docsArtifact`);
    assertGraphDocsMarkdownArtifactConsumerCompatibility(item.docsArtifact);
    assertPlainObject(item.sourceArtifact, `GraphDocsMarkdownRepoOutputDryRun.items[${index}].sourceArtifact`);
    if (item.sourceArtifact.queryName !== item.docsArtifact.queryName) {
      throw new Error('GraphDocsMarkdownRepoOutputDryRun sourceArtifact queryName must match docsArtifact');
    }
    if (item.sourceArtifact.artifactFamily !== item.docsArtifact.artifactFamily) {
      throw new Error('GraphDocsMarkdownRepoOutputDryRun sourceArtifact artifactFamily must match docsArtifact');
    }
  }
  return true;
}

/** @param {Record<string, any>} [artifact] */
export function createGraphDocsMarkdownRepoOutputDryRun(artifact = {}, options = {}) {
  assertGraphDocsMarkdownArtifactConsumerCompatibility(artifact);
  assertPlainObject(options, 'GraphDocsMarkdownRepoOutputDryRunOptions');
  assertNoGraphDocsMarkdownConsumerRuntimeProducts(
    options,
    'GraphDocsMarkdownRepoOutputDryRunOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphDocsMarkdownRepoOutputDryRunOptions');
  assertNoForbiddenPatterns(options);
  const {
    targetRelativePath,
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
  } = options;
  for (const [fieldName, value] of Object.entries({
    repoWriteEnabled,
    runtimeArtifactWriteEnabled,
  })) {
    assertDisabledFlag(
      value,
      fieldName,
      'GraphDocsMarkdownRepoOutputDryRun',
    );
  }
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: artifact.graphVersion,
    queryName: 'createGraphDocsMarkdownRepoOutputDryRun',
    artifactFamily: 'site-capability-graph-docs-markdown-repo-output-dry-run',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      outputMode: 'dry-run-preview',
      dryRunOnly: true,
      targetRelativePath: normalizeGraphDocsMarkdownRepoOutputTarget(targetRelativePath),
      repoWriteEnabled: false,
      runtimeArtifactWriteEnabled: false,
      explicitValidationRequired: true,
      requiredArtifactProducer: 'createGraphDocsMarkdownArtifact',
      requiredArtifactGuard: 'SecurityGuard/Redaction before graph-derived artifact writes',
      sourceArtifact: {
        queryName: artifact.queryName,
        artifactFamily: artifact.artifactFamily,
      },
      docsArtifact: artifact,
    }],
  };
  assertGraphDocsMarkdownRepoOutputDryRunCompatibility(result);
  return cloneDescriptor(result);
}

/** @param {Record<string, any>} [result] */
export function assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility(result = {}) {
  assertPlainObject(result, 'DisabledGraphDocsMarkdownRuntimeConsumerResult');
  assertNoGraphDocsMarkdownConsumerRuntimeProducts(
    result,
    'DisabledGraphDocsMarkdownRuntimeConsumerResult',
  );
  assertNoForbiddenGraphFields(result, 'DisabledGraphDocsMarkdownRuntimeConsumerResult');
  assertNoForbiddenPatterns(result);
  assertGraphQueryResultCompatible(result);
  if (result.queryName !== 'createDisabledGraphDocsMarkdownRuntimeConsumerResult') {
    throw new Error('DisabledGraphDocsMarkdownRuntimeConsumerResult queryName must be createDisabledGraphDocsMarkdownRuntimeConsumerResult');
  }
  if (result.artifactFamily !== 'site-capability-graph-docs-markdown-runtime-consumer-result') {
    throw new Error('DisabledGraphDocsMarkdownRuntimeConsumerResult artifactFamily must be site-capability-graph-docs-markdown-runtime-consumer-result');
  }
  if (result.redactionRequired !== true) {
    throw new Error('DisabledGraphDocsMarkdownRuntimeConsumerResult redactionRequired must be true');
  }
  if (!Array.isArray(result.items) || result.items.length === 0) {
    throw new Error('DisabledGraphDocsMarkdownRuntimeConsumerResult items are required');
  }
  for (const [index, item] of result.items.entries()) {
    assertPlainObject(item, `DisabledGraphDocsMarkdownRuntimeConsumerResult.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`DisabledGraphDocsMarkdownRuntimeConsumerResult item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.consumerMode !== 'disabled-feature-flag') {
      throw new Error('DisabledGraphDocsMarkdownRuntimeConsumerResult consumerMode must be disabled-feature-flag');
    }
    if (item.featureEnabled !== false) {
      throw new Error('DisabledGraphDocsMarkdownRuntimeConsumerResult featureEnabled must be false');
    }
    if (item.result !== 'blocked') {
      throw new Error('DisabledGraphDocsMarkdownRuntimeConsumerResult result must be blocked');
    }
    assertPlainObject(item.reason, `DisabledGraphDocsMarkdownRuntimeConsumerResult.items[${index}].reason`);
    if (item.reason.code !== item.reasonCode) {
      throw new Error('DisabledGraphDocsMarkdownRuntimeConsumerResult reason code must match reasonCode');
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`DisabledGraphDocsMarkdownRuntimeConsumerResult reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(item.docsArtifact, `DisabledGraphDocsMarkdownRuntimeConsumerResult.items[${index}].docsArtifact`);
    assertGraphDocsMarkdownArtifactConsumerCompatibility(item.docsArtifact);
    assertPlainObject(item.sourceArtifact, `DisabledGraphDocsMarkdownRuntimeConsumerResult.items[${index}].sourceArtifact`);
    if (item.sourceArtifact.queryName !== item.docsArtifact.queryName) {
      throw new Error('DisabledGraphDocsMarkdownRuntimeConsumerResult sourceArtifact queryName must match docsArtifact');
    }
    if (item.sourceArtifact.artifactFamily !== item.docsArtifact.artifactFamily) {
      throw new Error('DisabledGraphDocsMarkdownRuntimeConsumerResult sourceArtifact artifactFamily must match docsArtifact');
    }
  }
  return true;
}

/** @param {Record<string, any>} [artifact] */
export function createDisabledGraphDocsMarkdownRuntimeConsumerResult(artifact = {}, options = {}) {
  assertGraphDocsMarkdownArtifactConsumerCompatibility(artifact);
  assertPlainObject(options, 'DisabledGraphDocsMarkdownRuntimeConsumerOptions');
  assertNoGraphDocsMarkdownConsumerRuntimeProducts(
    options,
    'DisabledGraphDocsMarkdownRuntimeConsumerOptions',
  );
  assertNoForbiddenGraphFields(options, 'DisabledGraphDocsMarkdownRuntimeConsumerOptions');
  assertNoForbiddenPatterns(options);
  const {
    consumerName = 'site-capability-graph-docs-markdown-runtime-consumer',
    featureEnabled,
  } = options;
  assertDisabledFlag(
    featureEnabled,
    'featureEnabled',
    'DisabledGraphDocsMarkdownRuntimeConsumerResult',
  );
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: artifact.graphVersion,
    queryName: 'createDisabledGraphDocsMarkdownRuntimeConsumerResult',
    artifactFamily: 'site-capability-graph-docs-markdown-runtime-consumer-result',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      consumerName: assertRequiredText(
        consumerName,
        'consumerName',
        'DisabledGraphDocsMarkdownRuntimeConsumerResult',
      ),
      consumerMode: 'disabled-feature-flag',
      featureFlag: 'siteCapabilityGraphDocsMarkdownRuntimeEnabled',
      featureEnabled: false,
      result: 'blocked',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph docs Markdown runtime consumer is disabled by feature flag',
      ),
      sourceArtifact: {
        queryName: artifact.queryName,
        artifactFamily: artifact.artifactFamily,
      },
      docsArtifact: artifact,
    }],
  };
  assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility(result);
  return cloneDescriptor(result);
}

const GRAPH_DOCS_MARKDOWN_RUNTIME_CONSUMER_HANDOFF_DISABLED_FLAG_KEYS = Object.freeze([
  'featureEnabled',
  'handoffEnabled',
  'runtimeHandoffEnabled',
  'consumerEnabled',
  'layerConsumerEnabled',
  'layerConsumerAllowed',
  'runtimeConsumerEnabled',
  'runtimeConsumerAllowed',
  'runtimeEnabled',
  'runtimeAllowed',
  'liveEnabled',
  'liveRuntimeEnabled',
  'executionEnabled',
  'graphExecutionEnabled',
  'runtimeDocsWriteEnabled',
  'runtimeDocsWriteAllowed',
  'docsWriteEnabled',
  'docsWriteAllowed',
  'repoWriteEnabled',
  'repoWriteAllowed',
  'runtimeArtifactWriteEnabled',
  'runtimeArtifactWriteAllowed',
  'artifactWriteEnabled',
  'artifactWriteAllowed',
  'externalTelemetryEnabled',
  'externalTelemetryAllowed',
  'externalTelemetryDispatchEnabled',
  'externalTelemetryDispatchAllowed',
  'sessionMaterializationEnabled',
  'sessionMaterializationAllowed',
  'materializationEnabled',
  'materializationAllowed',
  'profileMaterializationEnabled',
  'profileMaterializationAllowed',
  'credentialMaterializationEnabled',
  'credentialMaterializationAllowed',
  'downloaderEnabled',
  'downloaderAllowed',
  'downloaderExecutionEnabled',
  'downloaderExecutionAllowed',
  'siteAdapterEnabled',
  'siteAdapterAllowed',
  'siteAdapterExecutionEnabled',
  'siteAdapterExecutionAllowed',
  'writeEnabled',
  'writeAllowed',
  'runtimeWriteEnabled',
  'runtimeWriteAllowed',
  'filesystemWriteEnabled',
  'filesystemWriteAllowed',
]);

const GRAPH_DOCS_MARKDOWN_RUNTIME_CONSUMER_HANDOFF_RUNTIME_PRODUCT_KEYS = Object.freeze([
  ...GRAPH_DOCS_MARKDOWN_CONSUMER_RUNTIME_PRODUCT_KEYS,
  'authorization',
  'authorizationHeader',
  'browserProfileRoot',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'csrf',
  'csrfToken',
  'downloadPolicy',
  'downloader',
  'externalTelemetry',
  'externalTelemetrySink',
  'filesystemWrite',
  'repoOutputPath',
  'runtimeArtifact',
  'runtimeArtifactPath',
  'runtimeConsumer',
  'runtimePayload',
  'sessionId',
  'siteAdapter',
  'siteAdapterPayload',
  'standardTaskList',
  'token',
]);

const GRAPH_DOCS_MARKDOWN_RUNTIME_CONSUMER_HANDOFF_DISABLED_FLAG_KEY_SET = new Set(
  GRAPH_DOCS_MARKDOWN_RUNTIME_CONSUMER_HANDOFF_DISABLED_FLAG_KEYS.map((key) => normalizeKey(key)),
);

const GRAPH_DOCS_MARKDOWN_RUNTIME_CONSUMER_HANDOFF_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_DOCS_MARKDOWN_RUNTIME_CONSUMER_HANDOFF_RUNTIME_PRODUCT_KEYS.map((key) => normalizeKey(key)),
);

function assertNoGraphDocsMarkdownRuntimeConsumerHandoffRuntimeProducts(
  value,
  label = 'GraphDocsMarkdownRuntimeConsumerHandoffGuard',
  path = label,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoGraphDocsMarkdownRuntimeConsumerHandoffRuntimeProducts(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (GRAPH_DOCS_MARKDOWN_RUNTIME_CONSUMER_HANDOFF_DISABLED_FLAG_KEY_SET.has(normalizedKey)) {
      if (entry !== false && entry !== undefined) {
        throw new Error(`${label} ${key} must remain false`);
      }
    } else if (GRAPH_DOCS_MARKDOWN_RUNTIME_CONSUMER_HANDOFF_RUNTIME_PRODUCT_KEY_SET.has(normalizedKey)) {
      throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${path}.${key}`);
    }
    assertNoGraphDocsMarkdownRuntimeConsumerHandoffRuntimeProducts(entry, label, `${path}.${key}`);
  }
  return true;
}

function summarizeFutureGraphLayerConsumerPreflightForDocsMarkdownHandoff(preflight) {
  assertFutureGraphLayerConsumerPreflightCompatibility(preflight);
  const item = preflight.items[0];
  return {
    queryName: preflight.queryName,
    artifactFamily: preflight.artifactFamily,
    graphVersion: preflight.graphVersion,
    redactionRequired: preflight.redactionRequired,
    consumerName: item.consumerName,
    contractMode: item.contractMode,
    descriptorOnly: item.descriptorOnly,
    result: item.result,
    reasonCode: item.reasonCode,
    sectionRef: item.sectionRef,
    contractRef: item.contractRef,
  };
}

function summarizeDisabledGraphDocsMarkdownRuntimeConsumerResultForHandoff(result) {
  assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility(result);
  const item = result.items[0];
  return {
    queryName: result.queryName,
    artifactFamily: result.artifactFamily,
    graphVersion: result.graphVersion,
    redactionRequired: result.redactionRequired,
    consumerName: item.consumerName,
    consumerMode: item.consumerMode,
    featureFlag: item.featureFlag,
    featureEnabled: item.featureEnabled,
    result: item.result,
    reasonCode: item.reasonCode,
    sourceArtifact: cloneDescriptor(item.sourceArtifact),
  };
}

function assertGraphDocsMarkdownRuntimeConsumerHandoffSourcePreflight(sourcePreflight, label) {
  assertPlainObject(sourcePreflight, `${label}.sourcePreflight`);
  if (sourcePreflight.queryName !== 'createFutureGraphLayerConsumerPreflightContract') {
    throw new Error(`${label} sourcePreflight queryName must be createFutureGraphLayerConsumerPreflightContract`);
  }
  if (sourcePreflight.artifactFamily !== 'site-capability-graph-future-layer-consumer-preflight-contract') {
    throw new Error(`${label} sourcePreflight artifactFamily must be site-capability-graph-future-layer-consumer-preflight-contract`);
  }
  if (sourcePreflight.redactionRequired !== true) {
    throw new Error(`${label} sourcePreflight redactionRequired must be true`);
  }
  if (sourcePreflight.contractMode !== 'descriptor-only-preflight') {
    throw new Error(`${label} sourcePreflight contractMode must be descriptor-only-preflight`);
  }
  if (sourcePreflight.descriptorOnly !== true) {
    throw new Error(`${label} sourcePreflight descriptorOnly must be true`);
  }
  if (sourcePreflight.result !== 'blocked') {
    throw new Error(`${label} sourcePreflight result must be blocked`);
  }
  if (sourcePreflight.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
    throw new Error(`${label} sourcePreflight reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  return true;
}

function assertGraphDocsMarkdownRuntimeConsumerHandoffDisabledConsumer(
  disabledRuntimeConsumer,
  label,
) {
  assertPlainObject(disabledRuntimeConsumer, `${label}.disabledRuntimeConsumer`);
  if (disabledRuntimeConsumer.queryName !== 'createDisabledGraphDocsMarkdownRuntimeConsumerResult') {
    throw new Error(`${label} disabledRuntimeConsumer queryName must be createDisabledGraphDocsMarkdownRuntimeConsumerResult`);
  }
  if (disabledRuntimeConsumer.artifactFamily !== 'site-capability-graph-docs-markdown-runtime-consumer-result') {
    throw new Error(`${label} disabledRuntimeConsumer artifactFamily must be site-capability-graph-docs-markdown-runtime-consumer-result`);
  }
  if (disabledRuntimeConsumer.redactionRequired !== true) {
    throw new Error(`${label} disabledRuntimeConsumer redactionRequired must be true`);
  }
  if (disabledRuntimeConsumer.consumerMode !== 'disabled-feature-flag') {
    throw new Error(`${label} disabledRuntimeConsumer consumerMode must be disabled-feature-flag`);
  }
  if (disabledRuntimeConsumer.featureEnabled !== false) {
    throw new Error(`${label} disabledRuntimeConsumer featureEnabled must be false`);
  }
  if (disabledRuntimeConsumer.result !== 'blocked') {
    throw new Error(`${label} disabledRuntimeConsumer result must be blocked`);
  }
  if (disabledRuntimeConsumer.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
    throw new Error(`${label} disabledRuntimeConsumer reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
  }
  return true;
}

/** @param {Record<string, any>} [guard] */
export function assertGraphDocsMarkdownRuntimeConsumerHandoffGuardCompatibility(guard = {}) {
  assertPlainObject(guard, 'GraphDocsMarkdownRuntimeConsumerHandoffGuard');
  assertNoForbiddenGraphFields(guard, 'GraphDocsMarkdownRuntimeConsumerHandoffGuard');
  assertNoForbiddenPatterns(guard);
  assertGraphQueryResultCompatible(guard);
  if (guard.queryName !== 'createGraphDocsMarkdownRuntimeConsumerHandoffGuard') {
    throw new Error('GraphDocsMarkdownRuntimeConsumerHandoffGuard queryName must be createGraphDocsMarkdownRuntimeConsumerHandoffGuard');
  }
  if (guard.artifactFamily !== 'site-capability-graph-docs-markdown-runtime-consumer-handoff-guard') {
    throw new Error('GraphDocsMarkdownRuntimeConsumerHandoffGuard artifactFamily must be site-capability-graph-docs-markdown-runtime-consumer-handoff-guard');
  }
  if (guard.redactionRequired !== true) {
    throw new Error('GraphDocsMarkdownRuntimeConsumerHandoffGuard redactionRequired must be true');
  }
  if (!Array.isArray(guard.items) || guard.items.length === 0) {
    throw new Error('GraphDocsMarkdownRuntimeConsumerHandoffGuard items are required');
  }
  for (const [index, item] of guard.items.entries()) {
    const itemLabel = `GraphDocsMarkdownRuntimeConsumerHandoffGuard.items[${index}]`;
    assertPlainObject(item, itemLabel);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphDocsMarkdownRuntimeConsumerHandoffGuard item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.handoffMode !== 'descriptor-only') {
      throw new Error('GraphDocsMarkdownRuntimeConsumerHandoffGuard handoffMode must be descriptor-only');
    }
    if (item.result !== 'blocked') {
      throw new Error('GraphDocsMarkdownRuntimeConsumerHandoffGuard result must be blocked');
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`GraphDocsMarkdownRuntimeConsumerHandoffGuard reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(item.reason, `${itemLabel}.reason`);
    if (item.reason.code !== item.reasonCode) {
      throw new Error('GraphDocsMarkdownRuntimeConsumerHandoffGuard reason code must match reasonCode');
    }
    for (const fieldName of GRAPH_DOCS_MARKDOWN_RUNTIME_CONSUMER_HANDOFF_DISABLED_FLAG_KEYS) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphDocsMarkdownRuntimeConsumerHandoffGuard ${fieldName} must be false`);
      }
    }
    if (item.requiredPreflightGuard !== 'assertFutureGraphLayerConsumerPreflightCompatibility') {
      throw new Error('GraphDocsMarkdownRuntimeConsumerHandoffGuard requiredPreflightGuard must be assertFutureGraphLayerConsumerPreflightCompatibility');
    }
    if (
      item.requiredDisabledRuntimeConsumerGuard
        !== 'assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility'
    ) {
      throw new Error('GraphDocsMarkdownRuntimeConsumerHandoffGuard requiredDisabledRuntimeConsumerGuard must be assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility');
    }
    if (
      item.requiredRuntimeConsumerGuard
        !== 'assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility'
    ) {
      throw new Error('GraphDocsMarkdownRuntimeConsumerHandoffGuard requiredRuntimeConsumerGuard must be assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility');
    }
    if (
      item.requiredHandoffGuard
        !== 'assertGraphDocsMarkdownRuntimeConsumerHandoffGuardCompatibility'
    ) {
      throw new Error('GraphDocsMarkdownRuntimeConsumerHandoffGuard requiredHandoffGuard must be assertGraphDocsMarkdownRuntimeConsumerHandoffGuardCompatibility');
    }
    assertPlainObject(item.requiredGuards, `${itemLabel}.requiredGuards`);
    if (item.requiredGuards.preflightGuard !== 'assertFutureGraphLayerConsumerPreflightCompatibility') {
      throw new Error('GraphDocsMarkdownRuntimeConsumerHandoffGuard preflightGuard is required');
    }
    if (
      item.requiredGuards.disabledRuntimeConsumerGuard
        !== 'assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility'
    ) {
      throw new Error('GraphDocsMarkdownRuntimeConsumerHandoffGuard disabledRuntimeConsumerGuard is required');
    }
    if (
      item.requiredGuards.handoffGuard
        !== 'assertGraphDocsMarkdownRuntimeConsumerHandoffGuardCompatibility'
    ) {
      throw new Error('GraphDocsMarkdownRuntimeConsumerHandoffGuard handoffGuard is required');
    }
    assertGraphDocsMarkdownRuntimeConsumerHandoffSourcePreflight(item.sourcePreflight, itemLabel);
    assertGraphDocsMarkdownRuntimeConsumerHandoffDisabledConsumer(
      item.disabledRuntimeConsumer,
      itemLabel,
    );
    assertGraphDocsMarkdownRuntimeConsumerHandoffDisabledConsumer(
      item.sourceRuntimeConsumer,
      itemLabel,
    );
    if (!Array.isArray(item.forbiddenRuntimeFields) || item.forbiddenRuntimeFields.length === 0) {
      throw new Error('GraphDocsMarkdownRuntimeConsumerHandoffGuard forbiddenRuntimeFields are required');
    }
  }
  assertNoGraphDocsMarkdownRuntimeConsumerHandoffRuntimeProducts(
    guard,
    'GraphDocsMarkdownRuntimeConsumerHandoffGuard',
  );
  return true;
}

export function createGraphDocsMarkdownRuntimeConsumerHandoffGuard(
  sources = {},
  options = {},
) {
  assertPlainObject(sources, 'GraphDocsMarkdownRuntimeConsumerHandoffGuardSources');
  assertPlainObject(options, 'GraphDocsMarkdownRuntimeConsumerHandoffGuardOptions');
  assertNoGraphDocsMarkdownRuntimeConsumerHandoffRuntimeProducts(
    options,
    'GraphDocsMarkdownRuntimeConsumerHandoffGuardOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphDocsMarkdownRuntimeConsumerHandoffGuardOptions');
  assertNoForbiddenPatterns(options);
  const {
    sourcePreflight,
    preflight = sourcePreflight,
    disabledRuntimeConsumer,
    runtimeConsumerResult = disabledRuntimeConsumer,
    sourceRuntimeConsumer = runtimeConsumerResult,
  } = sources;
  assertFutureGraphLayerConsumerPreflightCompatibility(preflight);
  assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility(sourceRuntimeConsumer);
  const {
    handoffName = 'site-capability-graph-docs-markdown-runtime-consumer-handoff-guard',
  } = options;
  for (const fieldName of GRAPH_DOCS_MARKDOWN_RUNTIME_CONSUMER_HANDOFF_DISABLED_FLAG_KEYS) {
    assertDisabledFlag(
      options[fieldName],
      fieldName,
      'GraphDocsMarkdownRuntimeConsumerHandoffGuard',
    );
  }
  const disabledFlags = Object.fromEntries(
    GRAPH_DOCS_MARKDOWN_RUNTIME_CONSUMER_HANDOFF_DISABLED_FLAG_KEYS
      .map((fieldName) => [fieldName, false]),
  );
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: preflight.graphVersion,
    queryName: 'createGraphDocsMarkdownRuntimeConsumerHandoffGuard',
    artifactFamily: 'site-capability-graph-docs-markdown-runtime-consumer-handoff-guard',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      queryName: 'createGraphDocsMarkdownRuntimeConsumerHandoffGuard',
      artifactFamily: 'site-capability-graph-docs-markdown-runtime-consumer-handoff-guard',
      redactionRequired: true,
      handoffName: assertRequiredText(
        handoffName,
        'handoffName',
        'GraphDocsMarkdownRuntimeConsumerHandoffGuard',
      ),
      handoffMode: 'descriptor-only',
      result: 'blocked',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph docs Markdown runtime consumer handoff is descriptor-only, blocked, and cannot write or materialize runtime products',
      ),
      consumerName: sourceRuntimeConsumer.items[0].consumerName,
      requiredPreflightGuard: 'assertFutureGraphLayerConsumerPreflightCompatibility',
      requiredRuntimeConsumerGuard:
        'assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility',
      requiredDisabledRuntimeConsumerGuard:
        'assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility',
      requiredHandoffGuard:
        'assertGraphDocsMarkdownRuntimeConsumerHandoffGuardCompatibility',
      requiredArtifactGuard: 'SecurityGuard/Redaction before graph-derived docs Markdown runtime handoff output',
      requiredGuards: {
        preflightGuard: 'assertFutureGraphLayerConsumerPreflightCompatibility',
        disabledRuntimeConsumerGuard:
          'assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility',
        handoffGuard: 'assertGraphDocsMarkdownRuntimeConsumerHandoffGuardCompatibility',
      },
      sourcePreflight: summarizeFutureGraphLayerConsumerPreflightForDocsMarkdownHandoff(preflight),
      disabledRuntimeConsumer:
        summarizeDisabledGraphDocsMarkdownRuntimeConsumerResultForHandoff(sourceRuntimeConsumer),
      sourceRuntimeConsumer:
        summarizeDisabledGraphDocsMarkdownRuntimeConsumerResultForHandoff(sourceRuntimeConsumer),
      forbiddenRuntimeFields: [
        'writer',
        'outputPath',
        'writePath',
        'docsOutputPath',
        'repoPath',
        'repoOutputPath',
        'repositoryPath',
        'artifactPath',
        'runtimeArtifactPath',
        'runtimeArtifact',
        'sessionView',
        'downloadPolicy',
        'standardTaskList',
        'taskList',
        'siteAdapter',
        'siteAdapterPayload',
        'downloader',
        'externalTelemetry',
        'externalTelemetrySink',
        'runtimePayload',
        'rawPayload',
        'unredactedPayload',
      ],
      ...disabledFlags,
    }],
  };
  assertGraphDocsMarkdownRuntimeConsumerHandoffGuardCompatibility(result);
  return cloneDescriptor(result);
}

const FUTURE_GRAPH_LAYER_CONSUMER_PREFLIGHT_DISABLED_FLAG_KEYS = Object.freeze([
  'accessControlBypass',
  'accessControlBypassEnabled',
  'artifactWriteEnabled',
  'bypass',
  'bypassEnabled',
  'consumerEnabled',
  'credentialMaterialization',
  'credentialMaterializationEnabled',
  'docsWrite',
  'docsWriteEnabled',
  'downloaderExecution',
  'downloaderExecutionEnabled',
  'executionEnabled',
  'feature',
  'featureEnabled',
  'graphExecution',
  'graphExecutionEnabled',
  'graphQueryExecution',
  'graphQueryExecutionEnabled',
  'liveConsumer',
  'liveConsumerEnabled',
  'liveEnabled',
  'liveModeEnabled',
  'liveRouteExecutionEnabled',
  'liveRuntimeEnabled',
  'materialization',
  'materializationEnabled',
  'profileMaterialization',
  'profileMaterializationEnabled',
  'repoWrite',
  'repoWriteEnabled',
  'runtimeConsumer',
  'runtimeConsumerEnabled',
  'runtimeEnabled',
  'runtimeExecution',
  'runtimeExecutionEnabled',
  'runtimeArtifactWriteEnabled',
  'runtimeWrite',
  'runtimeWriteEnabled',
  'sessionMaterialization',
  'sessionMaterializationEnabled',
  'siteAdapterExecution',
  'siteAdapterExecutionEnabled',
  'unredactedWrite',
  'unredactedWritesEnabled',
  'write',
  'writeEnabled',
]);

const FUTURE_GRAPH_LAYER_CONSUMER_PREFLIGHT_DISABLED_FLAG_KEY_SET = new Set(
  FUTURE_GRAPH_LAYER_CONSUMER_PREFLIGHT_DISABLED_FLAG_KEYS.map((key) => normalizeKey(key)),
);

const FUTURE_GRAPH_LAYER_CONSUMER_PREFLIGHT_FORBIDDEN_KEYS = Object.freeze([
  'accessControl',
  'accessControlBypass',
  'bypassAccessControl',
  'authorization',
  'authorizationHeader',
  'browserProfile',
  'browserProfilePath',
  'command',
  'cookie',
  'cookies',
  'credential',
  'credentialMaterial',
  'credentials',
  'csrf',
  'csrfToken',
  'dispatch',
  'downloadPolicy',
  'downloader',
  'downloaderExecution',
  'execute',
  'executeGraph',
  'executor',
  'externalCommand',
  'filesystemWrite',
  'graphExecution',
  'graphQueryExecution',
  'handler',
  'rawCredential',
  'rawCredentials',
  'rawPayload',
  'rawSession',
  'rawSessionMaterial',
  'refreshToken',
  'repoOutputPath',
  'repoPath',
  'repositoryPath',
  'runtimeWrite',
  'SESSDATA',
  'sessionView',
  'sessionId',
  'siteAdapter',
  'siteAdapterExecution',
  'taskRunner',
  'unredactedPayload',
  'userDataDir',
  'writePath',
  'writer',
]);

const FUTURE_GRAPH_LAYER_CONSUMER_PREFLIGHT_FORBIDDEN_KEY_SET = new Set(
  FUTURE_GRAPH_LAYER_CONSUMER_PREFLIGHT_FORBIDDEN_KEYS.map((key) => normalizeKey(key)),
);

function futureGraphLayerConsumerPreflightError(category) {
  throw new Error(`FutureGraphLayerConsumerPreflight rejected unsafe ${category}`);
}

function isDisabledGraphInventoryRuntimeConsumerDescriptor(value) {
  return isPlainObject(value)
    && value.schemaVersion === GRAPH_QUERY_RESULT_SCHEMA_VERSION
    && value.queryName === 'createDisabledGraphInventoryRuntimeConsumerResult'
    && value.artifactFamily === 'site-capability-graph-inventory-runtime-consumer-result'
    && Array.isArray(value.items);
}

function assertNoFutureGraphLayerConsumerPreflightRuntimeProducts(
  value,
  label = 'FutureGraphLayerConsumerPreflight',
) {
  if (Array.isArray(value)) {
    value.forEach((entry) => assertNoFutureGraphLayerConsumerPreflightRuntimeProducts(entry, label));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  if (isDisabledGraphInventoryRuntimeConsumerDescriptor(value)) {
    assertDisabledGraphInventoryRuntimeConsumerResultCompatibility(value);
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (FUTURE_GRAPH_LAYER_CONSUMER_PREFLIGHT_DISABLED_FLAG_KEY_SET.has(normalizedKey)) {
      if (entry !== false && entry !== undefined) {
        throw new Error(`${label} ${key} must remain false`);
      }
    } else if (FUTURE_GRAPH_LAYER_CONSUMER_PREFLIGHT_FORBIDDEN_KEY_SET.has(normalizedKey)) {
      futureGraphLayerConsumerPreflightError(`runtime product: ${key}`);
    }
    assertNoFutureGraphLayerConsumerPreflightRuntimeProducts(entry, label);
  }
  return true;
}

/** @param {Record<string, any>} [preflight] */
export function assertFutureGraphLayerConsumerPreflightCompatibility(preflight = {}) {
  assertPlainObject(preflight, 'FutureGraphLayerConsumerPreflight');
  assertNoFutureGraphLayerConsumerPreflightRuntimeProducts(preflight);
  assertNoForbiddenGraphFields(preflight, 'FutureGraphLayerConsumerPreflight');
  assertGraphQueryResultCompatible(preflight);
  if (preflight.queryName !== 'createFutureGraphLayerConsumerPreflightContract') {
    throw new Error('FutureGraphLayerConsumerPreflight queryName must be createFutureGraphLayerConsumerPreflightContract');
  }
  if (preflight.artifactFamily !== 'site-capability-graph-future-layer-consumer-preflight-contract') {
    throw new Error('FutureGraphLayerConsumerPreflight artifactFamily must be site-capability-graph-future-layer-consumer-preflight-contract');
  }
  if (preflight.redactionRequired !== true) {
    throw new Error('FutureGraphLayerConsumerPreflight redactionRequired must be true');
  }
  if (!Array.isArray(preflight.items) || preflight.items.length === 0) {
    throw new Error('FutureGraphLayerConsumerPreflight items are required');
  }
  for (const [index, item] of preflight.items.entries()) {
    assertPlainObject(item, `FutureGraphLayerConsumerPreflight.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`FutureGraphLayerConsumerPreflight item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.contractMode !== 'descriptor-only-preflight') {
      throw new Error('FutureGraphLayerConsumerPreflight contractMode must be descriptor-only-preflight');
    }
    if (item.descriptorOnly !== true) {
      throw new Error('FutureGraphLayerConsumerPreflight descriptorOnly must be true');
    }
    if (item.result !== 'blocked') {
      throw new Error('FutureGraphLayerConsumerPreflight result must be blocked');
    }
    for (const fieldName of FUTURE_GRAPH_LAYER_CONSUMER_PREFLIGHT_DISABLED_FLAG_KEYS) {
      if (item[fieldName] !== false) {
        throw new Error(`FutureGraphLayerConsumerPreflight ${fieldName} must be false`);
      }
    }
    assertPlainObject(item.reason, `FutureGraphLayerConsumerPreflight.items[${index}].reason`);
    if (item.reason.code !== item.reasonCode) {
      throw new Error('FutureGraphLayerConsumerPreflight reason code must match reasonCode');
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`FutureGraphLayerConsumerPreflight reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
  }
  return true;
}

/** @param {Record<string, any>} [sourceArtifactOrOptions] */
// @ts-ignore
export function createFutureGraphLayerConsumerPreflightContract(sourceArtifactOrOptions = {}, maybeOptions) {
  const sourceArtifact = maybeOptions === undefined ? undefined : sourceArtifactOrOptions;
  const options = maybeOptions === undefined ? sourceArtifactOrOptions : maybeOptions;
  if (sourceArtifact !== undefined) {
    assertPlainObject(sourceArtifact, 'FutureGraphLayerConsumerPreflightSourceArtifact');
    if (isDisabledGraphInventoryRuntimeConsumerDescriptor(sourceArtifact)) {
      assertDisabledGraphInventoryRuntimeConsumerResultCompatibility(sourceArtifact);
    } else {
      assertNoFutureGraphLayerConsumerPreflightRuntimeProducts(
        sourceArtifact,
        'FutureGraphLayerConsumerPreflightSourceArtifact',
      );
      assertNoForbiddenGraphFields(
        sourceArtifact,
        'FutureGraphLayerConsumerPreflightSourceArtifact',
      );
    }
    assertGraphQueryResultCompatible(sourceArtifact);
  }
  assertPlainObject(options, 'FutureGraphLayerConsumerPreflightOptions');
  assertNoFutureGraphLayerConsumerPreflightRuntimeProducts(
    options,
    'FutureGraphLayerConsumerPreflightOptions',
  );
  assertNoForbiddenGraphFields(options, 'FutureGraphLayerConsumerPreflightOptions');
  const {
    graphVersion = sourceArtifact?.graphVersion ?? 'future-layer-consumer-preflight-v1',
    consumerName = 'future-graph-layer-consumer',
  } = options;
  const disabledFlags = Object.fromEntries(
    FUTURE_GRAPH_LAYER_CONSUMER_PREFLIGHT_DISABLED_FLAG_KEYS.map((fieldName) => [fieldName, false]),
  );
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: assertRequiredText(
      graphVersion,
      'graphVersion',
      'FutureGraphLayerConsumerPreflight',
    ),
    queryName: 'createFutureGraphLayerConsumerPreflightContract',
    artifactFamily: 'site-capability-graph-future-layer-consumer-preflight-contract',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      consumerName: assertRequiredText(
        consumerName,
        'consumerName',
        'FutureGraphLayerConsumerPreflight',
      ),
      contractMode: 'descriptor-only-preflight',
      descriptorOnly: true,
      result: 'blocked',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Future Graph Layer consumer preflight remains disabled by contract',
      ),
      sourceArtifact: sourceArtifact === undefined ? null : {
        queryName: sourceArtifact.queryName,
        artifactFamily: sourceArtifact.artifactFamily,
      },
      sectionRef: 'Section 2 Non-goals',
      contractRef: 'future-live-layer-consumer-preflight',
      ...disabledFlags,
    }],
  };
  assertFutureGraphLayerConsumerPreflightCompatibility(result);
  return cloneDescriptor(result);
}

const GRAPH_CORE_POSITIONING_BOUNDARY_GUARD_DISABLED_FLAG_KEYS = Object.freeze([
  'accessControlBypassEnabled',
  'artifactWriteEnabled',
  'bypassEnabled',
  'consumerEnabled',
  'credentialAccessEnabled',
  'credentialMaterializationEnabled',
  'docsWriteEnabled',
  'downloaderInvocationEnabled',
  'downloaderExecutionEnabled',
  'dynamicStatePersistenceEnabled',
  'executionEnabled',
  'externalCommandEnabled',
  'featureEnabled',
  'filesystemWriteEnabled',
  'graphExecutionAllowed',
  'graphExecutionEnabled',
  'graphQueryExecutionEnabled',
  'layerExecutionReplacementAllowed',
  'liveConsumerEnabled',
  'liveEnabled',
  'liveModeEnabled',
  'liveRouteExecutionEnabled',
  'liveRuntimeEnabled',
  'materializationEnabled',
  'profileMaterializationEnabled',
  'rawSensitiveMaterialAllowed',
  'repoArtifactWriteEnabled',
  'repoWriteAllowed',
  'repoWriteEnabled',
  'runtimeArtifactWriteAllowed',
  'runtimeArtifactWriteEnabled',
  'runtimeEnabled',
  'runtimeExecutionEnabled',
  'runtimeLayerConsumerEnabled',
  'runtimeConsumerEnabled',
  'runtimeWriteEnabled',
  'sessionAccessEnabled',
  'sessionMaterializationEnabled',
  'siteAdapterInvocationEnabled',
  'siteAdapterExecutionEnabled',
  'statePersistenceEnabled',
  'taskRunnerEnabled',
  'unredactedWritesEnabled',
  'writeEnabled',
]);

const GRAPH_CORE_POSITIONING_BOUNDARY_GUARD_DISABLED_FLAG_KEY_SET = new Set(
  GRAPH_CORE_POSITIONING_BOUNDARY_GUARD_DISABLED_FLAG_KEYS.map((key) => normalizeKey(key)),
);

const GRAPH_CORE_POSITIONING_BOUNDARY_GUARD_FORBIDDEN_KEY_SET = new Set(
  [
    ...FUTURE_GRAPH_LAYER_CONSUMER_PREFLIGHT_FORBIDDEN_KEYS,
    'credentialAccess',
    'dynamicState',
    'externalNetwork',
    'network',
    'repoArtifactWrite',
    'runtimeArtifactWrite',
    'sessionAccess',
    'statePersistence',
  ].map((key) => normalizeKey(key)),
);

function graphCorePositioningBoundaryGuardError(category) {
  throw new Error(`GraphCorePositioningBoundaryGuard rejected unsafe ${category}`);
}

function assertNoGraphCorePositioningBoundaryGuardRuntimeProducts(
  value,
  label = 'GraphCorePositioningBoundaryGuard',
) {
  if (Array.isArray(value)) {
    value.forEach((entry) => assertNoGraphCorePositioningBoundaryGuardRuntimeProducts(entry, label));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (GRAPH_CORE_POSITIONING_BOUNDARY_GUARD_DISABLED_FLAG_KEY_SET.has(normalizedKey)) {
      if (entry !== false && entry !== undefined) {
        throw new Error(`${label} ${key} must remain false`);
      }
    } else if (GRAPH_CORE_POSITIONING_BOUNDARY_GUARD_FORBIDDEN_KEY_SET.has(normalizedKey)) {
      graphCorePositioningBoundaryGuardError(`runtime product: ${key}`);
    }
    assertNoGraphCorePositioningBoundaryGuardRuntimeProducts(entry, label);
  }
  return true;
}

/** @param {Record<string, any>} [guard] */
export function assertGraphCorePositioningBoundaryGuardCompatibility(guard = {}) {
  assertPlainObject(guard, 'GraphCorePositioningBoundaryGuard');
  assertNoGraphCorePositioningBoundaryGuardRuntimeProducts(guard);
  assertNoForbiddenGraphFields(guard, 'GraphCorePositioningBoundaryGuard');
  assertNoForbiddenPatterns(guard);
  assertGraphQueryResultCompatible(guard);
  if (guard.queryName !== 'createGraphCorePositioningBoundaryGuard') {
    throw new Error('GraphCorePositioningBoundaryGuard queryName must be createGraphCorePositioningBoundaryGuard');
  }
  if (guard.artifactFamily !== 'site-capability-graph-core-positioning-boundary-guard') {
    throw new Error('GraphCorePositioningBoundaryGuard artifactFamily must be site-capability-graph-core-positioning-boundary-guard');
  }
  if (guard.redactionRequired !== true) {
    throw new Error('GraphCorePositioningBoundaryGuard redactionRequired must be true');
  }
  if (!Array.isArray(guard.items) || guard.items.length === 0) {
    throw new Error('GraphCorePositioningBoundaryGuard items are required');
  }
  for (const [index, item] of guard.items.entries()) {
    assertPlainObject(item, `GraphCorePositioningBoundaryGuard.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphCorePositioningBoundaryGuard item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.guardMode !== 'descriptor-only-boundary') {
      throw new Error('GraphCorePositioningBoundaryGuard guardMode must be descriptor-only-boundary');
    }
    if (item.descriptorOnly !== true) {
      throw new Error('GraphCorePositioningBoundaryGuard descriptorOnly must be true');
    }
    if (item.result !== 'blocked') {
      throw new Error('GraphCorePositioningBoundaryGuard result must be blocked');
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`GraphCorePositioningBoundaryGuard reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(item.reason, `GraphCorePositioningBoundaryGuard.items[${index}].reason`);
    if (item.reason.code !== item.reasonCode) {
      throw new Error('GraphCorePositioningBoundaryGuard reason code must match reasonCode');
    }
    for (const fieldName of GRAPH_CORE_POSITIONING_BOUNDARY_GUARD_DISABLED_FLAG_KEYS) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphCorePositioningBoundaryGuard ${fieldName} must be false`);
      }
    }
    if (item.sourcePreflightFamily !== 'site-capability-graph-future-layer-consumer-preflight-contract') {
      throw new Error('GraphCorePositioningBoundaryGuard sourcePreflightFamily must be future Layer consumer preflight');
    }
    if (item.sourceRepoOutputFamily !== 'site-capability-graph-inventory-repo-output-dry-run') {
      throw new Error('GraphCorePositioningBoundaryGuard sourceRepoOutputFamily must be inventory repo output dry-run');
    }
    if (item.sourceRepoOutputDryRunOnly !== true) {
      throw new Error('GraphCorePositioningBoundaryGuard sourceRepoOutputDryRunOnly must be true');
    }
    if (item.requiredPreflightGuard !== 'assertFutureGraphLayerConsumerPreflightCompatibility') {
      throw new Error('GraphCorePositioningBoundaryGuard requiredPreflightGuard must be assertFutureGraphLayerConsumerPreflightCompatibility');
    }
    if (item.requiredRepoOutputGuard !== 'assertGraphInventoryRepoOutputDryRunCompatibility') {
      throw new Error('GraphCorePositioningBoundaryGuard requiredRepoOutputGuard must be assertGraphInventoryRepoOutputDryRunCompatibility');
    }
    assertPlainObject(item.sourcePreflightDescriptor, `GraphCorePositioningBoundaryGuard.items[${index}].sourcePreflightDescriptor`);
    if (item.sourcePreflightDescriptor.queryName !== 'createFutureGraphLayerConsumerPreflightContract') {
      throw new Error('GraphCorePositioningBoundaryGuard sourcePreflightDescriptor queryName must match future preflight');
    }
    if (item.sourcePreflightDescriptor.artifactFamily !== item.sourcePreflightFamily) {
      throw new Error('GraphCorePositioningBoundaryGuard sourcePreflightDescriptor artifactFamily must match sourcePreflightFamily');
    }
    assertPlainObject(item.sourceRepoOutputDryRunDescriptor, `GraphCorePositioningBoundaryGuard.items[${index}].sourceRepoOutputDryRunDescriptor`);
    if (item.sourceRepoOutputDryRunDescriptor.artifactFamily !== item.sourceRepoOutputFamily) {
      throw new Error('GraphCorePositioningBoundaryGuard sourceRepoOutputDryRunDescriptor artifactFamily must match sourceRepoOutputFamily');
    }
    if (item.sourceRepoOutputDryRunDescriptor.dryRunOnly !== true) {
      throw new Error('GraphCorePositioningBoundaryGuard sourceRepoOutputDryRunDescriptor dryRunOnly must be true');
    }
    if (item.sourceRepoOutputDryRunDescriptor.repoWriteEnabled !== false) {
      throw new Error('GraphCorePositioningBoundaryGuard sourceRepoOutputDryRunDescriptor repoWriteEnabled must be false');
    }
    if (item.sourceRepoOutputDryRunDescriptor.runtimeArtifactWriteEnabled !== false) {
      throw new Error('GraphCorePositioningBoundaryGuard sourceRepoOutputDryRunDescriptor runtimeArtifactWriteEnabled must be false');
    }
  }
  return true;
}

export function createGraphCorePositioningBoundaryGuard(
  sources = {},
  options = {},
) {
  assertPlainObject(options, 'GraphCorePositioningBoundaryGuardOptions');
  assertNoGraphCorePositioningBoundaryGuardRuntimeProducts(
    options,
    'GraphCorePositioningBoundaryGuardOptions',
  );
  assertNoForbiddenGraphFields(options, 'GraphCorePositioningBoundaryGuardOptions');
  assertNoForbiddenPatterns(options);
  assertPlainObject(sources, 'GraphCorePositioningBoundaryGuardSources');
  const { sourcePreflight, repoOutputDryRun } = sources;
  assertFutureGraphLayerConsumerPreflightCompatibility(sourcePreflight);
  if (repoOutputDryRun?.artifactFamily !== 'site-capability-graph-inventory-repo-output-dry-run') {
    throw new Error('GraphCorePositioningBoundaryGuard repoOutputDryRun must be an inventory repo output dry-run descriptor');
  }
  assertGraphInventoryRepoOutputDryRunCompatibility(repoOutputDryRun);
  const {
    boundaryName,
    guardName = boundaryName ?? 'site-capability-graph-core-positioning-boundary-guard',
  } = options;
  const disabledFlags = Object.fromEntries(
    GRAPH_CORE_POSITIONING_BOUNDARY_GUARD_DISABLED_FLAG_KEYS.map((fieldName) => [fieldName, false]),
  );
  const [sourceRepoOutputDryRunItem] = repoOutputDryRun.items;
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: sourcePreflight.graphVersion,
    queryName: 'createGraphCorePositioningBoundaryGuard',
    artifactFamily: 'site-capability-graph-core-positioning-boundary-guard',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      guardName: assertRequiredText(
        guardName,
        'guardName',
        'GraphCorePositioningBoundaryGuard',
      ),
      guardMode: 'descriptor-only-boundary',
      descriptorOnly: true,
      result: 'blocked',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: createGraphRuntimeConsumerDisabledReason(
        'Graph core positioning remains descriptor-only and cannot execute, persist state, or write repo/runtime artifacts',
      ),
      sourcePreflightFamily: sourcePreflight.artifactFamily,
      sourceRepoOutputFamily: repoOutputDryRun.artifactFamily,
      sourceRepoOutputDryRunOnly: true,
      requiredPreflightGuard: 'assertFutureGraphLayerConsumerPreflightCompatibility',
      requiredRepoOutputGuard: 'assertGraphInventoryRepoOutputDryRunCompatibility',
      requiredArtifactGuard: 'SecurityGuard/Redaction before graph-derived artifact writes',
      boundaryRef: 'Section 1 Core positioning',
      sourcePreflightDescriptor: {
        queryName: sourcePreflight.queryName,
        artifactFamily: sourcePreflight.artifactFamily,
        graphVersion: sourcePreflight.graphVersion,
      },
      sourceRepoOutputDryRunDescriptor: {
        queryName: repoOutputDryRun.queryName,
        artifactFamily: repoOutputDryRun.artifactFamily,
        graphVersion: repoOutputDryRun.graphVersion,
        outputMode: sourceRepoOutputDryRunItem.outputMode,
        dryRunOnly: sourceRepoOutputDryRunItem.dryRunOnly,
        repoWriteEnabled: sourceRepoOutputDryRunItem.repoWriteEnabled,
        runtimeArtifactWriteEnabled: sourceRepoOutputDryRunItem.runtimeArtifactWriteEnabled,
      },
      ...disabledFlags,
    }],
  };
  assertGraphCorePositioningBoundaryGuardCompatibility(result);
  return cloneDescriptor(result);
}
