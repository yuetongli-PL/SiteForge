// @ts-check

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { assertApiCatalogUpgradeDecisionAllowsCatalog } from './api-candidates.mjs';
import { assertGovernedSchemaCompatible } from './schema-governance.mjs';
import { normalizeDownloadPolicy } from './download-policy.mjs';
import { normalizeStandardTaskList } from './standard-task-list.mjs';
import { applySiteHealthExecutionGateToTaskList } from './site-health-execution-gate.mjs';
import {
  assertFutureGraphLayerConsumerPreflightCompatibility,
  GRAPH_QUERY_RESULT_SCHEMA_VERSION,
  GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
  SITE_CAPABILITY_GRAPH_SCHEMA_VERSION,
  createFutureGraphLayerConsumerPreflightContract,
  planGraphCapabilityRoute,
} from './site-capability-graph.mjs';
import {
  assertNoForbiddenPatterns,
  prepareRedactedArtifactJsonWithAudit,
} from './security-guard.mjs';
import { requireReasonCodeDefinition } from './reason-codes.mjs';
import { assertTrustBoundaryCrossing } from './trust-boundary.mjs';

const FORBIDDEN_HANDOFF_KEYS = Object.freeze([
  'authorization',
  'cookie',
  'cookies',
  'headers',
  'set-cookie',
  'csrf',
  'xsrf',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'sessionId',
  'session_id',
  'SESSDATA',
  'profilePath',
  'browserProfile',
  'userDataDir',
]);

const FORBIDDEN_HANDOFF_REF_KEYS = Object.freeze([
  'authStoreRef',
  'browserCredentialRef',
  'browserCredentialsRef',
  'browserProfileRef',
  'browserProfileRefs',
  'browserProfileId',
  'credentialRef',
  'credentialRefs',
  'credentialReference',
  'credentialsRef',
  'cookieJar',
  'cookieJarRef',
  'profileRef',
  'profileRefs',
  'profileReference',
  'rawSessionRef',
  'sessionHandle',
  'sessionRef',
  'sessionRefs',
  'sessionReference',
  'sessionState',
  'sessionStatePath',
  'sessionStateRef',
  'storageState',
  'storageStatePath',
  'storageStateRef',
]);

const FORBIDDEN_HANDOFF_REF_VALUE_PATTERNS = Object.freeze([
  {
    name: 'browser-profile-ref',
    pattern: /(?:^|[^\w])(?:browser[-_]?profile|browserprofile|profile[-_]?path|profilepath|user[-_]?data[-_]?dir|userdatadir):/iu,
  },
  {
    name: 'session-ref',
    pattern: /(?:^|[^\w])(?:raw[-_]?session|rawsession|session[-_]?ref|sessionref|session[-_]?store|sessionstore|session[-_]?state|sessionstate):/iu,
  },
  {
    name: 'credential-ref',
    pattern: /(?:^|[^\w])(?:auth[-_]?store|authstore|credential[-_]?ref|credentialref|credential[-_]?store|credentialstore|cookie[-_]?jar|cookiejar|storage[-_]?state|storagestate):/iu,
  },
  {
    name: 'profile-path',
    pattern: /(?:^|[\\/])(?:browser-profiles?|browserProfiles|storage-state|storageState|user-data-dir|userDataDir)(?:[\\/]|$)/u,
  },
]);

const PLANNER_POLICY_RUNTIME_HANDOFF_TRUST_BOUNDARY = Object.freeze({
  from: 'api-catalog',
  to: 'downloader',
  purpose: 'planner policy runtime handoff',
  controls: Object.freeze(['redacted', 'minimized', 'permission-checked']),
});

const GRAPH_PLANNER_ROUTE_HANDOFF_KIND = 'site-capability-graph-route-plan';

const GRAPH_PLANNER_ROUTE_HANDOFF_RUNTIME_PRODUCT_KEYS = Object.freeze([
  'artifactPath',
  'downloadPolicy',
  'downloaderTask',
  'redactionAuditPath',
  'request',
  'resolvedResource',
  'resolvedResources',
  'resolvedTask',
  'response',
  'sessionView',
  'siteAdapterDecision',
  'standardTaskList',
  'taskList',
]);

const GRAPH_PLANNER_RUNTIME_INTEGRATION_RUNTIME_PRODUCT_KEYS = Object.freeze([
  ...GRAPH_PLANNER_ROUTE_HANDOFF_RUNTIME_PRODUCT_KEYS,
  'downloader',
  'executeRoute',
  'externalDispatch',
  'handler',
  'liveRoute',
  'outputPath',
  'repoOutputPath',
  'routeExecutor',
  'siteAdapter',
  'standardTaskList',
  'writePath',
]);

const GRAPH_PLANNER_RISK_BLOCKING_PREFLIGHT_RUNTIME_FIELD_KEYS = Object.freeze([
  'Authorization',
  'RiskStateMachine',
  'artifactPath',
  'artifactPayload',
  'browserProfile',
  'cookie',
  'downloadPolicy',
  'downloader',
  'executeRoute',
  'payload',
  'repoWrite',
  'routeExecution',
  'runtimeArtifact',
  'runtimeRiskTransition',
  'runtimeWrite',
  'sessionId',
  'sessionView',
  'siteAdapter',
  'standardTaskList',
]);

export const SUPPORTED_GRAPH_PLANNER_DATA_VERSIONS = Object.freeze([
  'synthetic-graph-v1',
  'synthetic-generated-from-layer-v1',
]);

const FORBIDDEN_HANDOFF_KEY_SET = new Set(
  FORBIDDEN_HANDOFF_KEYS.map((key) => normalizeKey(key)),
);

const FORBIDDEN_HANDOFF_REF_KEY_SET = new Set(
  FORBIDDEN_HANDOFF_REF_KEYS.map((key) => normalizeKey(key)),
);

const GRAPH_PLANNER_ROUTE_HANDOFF_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_PLANNER_ROUTE_HANDOFF_RUNTIME_PRODUCT_KEYS.map((key) => normalizeKey(key)),
);

const GRAPH_PLANNER_RUNTIME_INTEGRATION_RUNTIME_PRODUCT_KEY_SET = new Set(
  GRAPH_PLANNER_RUNTIME_INTEGRATION_RUNTIME_PRODUCT_KEYS.map((key) => normalizeKey(key)),
);

const GRAPH_PLANNER_ROUTE_HANDOFF_LAYER_ENTRYPOINT_RUNTIME_FIELD_KEY_SET = new Set(
  [
    ...GRAPH_PLANNER_RUNTIME_INTEGRATION_RUNTIME_PRODUCT_KEYS,
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'runtimeWriteEnabled',
  ].map((key) => normalizeKey(key)),
);

const GRAPH_PLANNER_RISK_BLOCKING_PREFLIGHT_RUNTIME_FIELD_KEY_SET = new Set(
  GRAPH_PLANNER_RISK_BLOCKING_PREFLIGHT_RUNTIME_FIELD_KEYS.map((key) => normalizeKey(key)),
);

const GRAPH_PLANNER_RISK_BLOCKING_PREFLIGHT_GATE_DESCRIPTOR_KEYS = new Set(
  [
    'downloader',
    'externalDispatch',
    'routeExecution',
    'sessionView',
    'siteAdapter',
  ].map((key) => normalizeKey(key)),
);

const GRAPH_PLANNER_RISK_BLOCKING_PREFLIGHT_DISABLED_FLAG_KEYS = Object.freeze([
  'featureEnabled',
  'executionAllowed',
  'liveRouteExecutionEnabled',
  'routeHandoffEnabled',
  'riskTransitionEnabled',
  'siteAdapterInvocationEnabled',
  'downloaderInvocationEnabled',
  'sessionMaterializationEnabled',
  'artifactWriteEnabled',
  'repoWriteEnabled',
  'runtimeWriteEnabled',
  'externalDispatchEnabled',
]);

const GRAPH_PLANNER_LAYER_ENTRYPOINT_HANDOFF_DISABLED_FLAG_KEYS = Object.freeze([
  'featureEnabled',
  'handoffEnabled',
  'plannerRuntimeConsumerEnabled',
  'executionAllowed',
  'liveRouteExecutionEnabled',
  'graphExecutionEnabled',
  'runtimeExecutionEnabled',
  'layerEntrypointReplacementAllowed',
  'siteAdapterInvocationEnabled',
  'downloaderInvocationEnabled',
  'sessionMaterializationEnabled',
  'runtimeArtifactWriteEnabled',
  'repoWriteEnabled',
  'runtimeWriteEnabled',
  'artifactWriteEnabled',
  'externalDispatchEnabled',
]);

const GRAPH_PLANNER_LAYER_ENTRYPOINT_HANDOFF_RUNTIME_FIELD_KEYS = Object.freeze([
  ...GRAPH_PLANNER_RUNTIME_INTEGRATION_RUNTIME_PRODUCT_KEYS,
  'downloadPolicy',
  'downloader',
  'handler',
  'outputPath',
  'repoOutputPath',
  'runtimeArtifactPath',
  'runtimePayload',
  'sessionView',
  'siteAdapter',
  'standardTaskList',
  'taskList',
  'writePath',
]);

const GRAPH_PLANNER_LAYER_ENTRYPOINT_HANDOFF_SAFE_SUMMARY_RUNTIME_FIELD_KEYS = Object.freeze([
  ...GRAPH_PLANNER_LAYER_ENTRYPOINT_HANDOFF_RUNTIME_FIELD_KEYS,
  'artifactPath',
  'callback',
  'credential',
  'credentials',
  'handoff',
  'profile',
  'repoPath',
  'route',
  'session',
]);

const GRAPH_PLANNER_LAYER_ENTRYPOINT_HANDOFF_DISABLED_FLAG_KEY_SET = new Set(
  GRAPH_PLANNER_LAYER_ENTRYPOINT_HANDOFF_DISABLED_FLAG_KEYS.map((key) => normalizeKey(key)),
);

const GRAPH_PLANNER_LAYER_ENTRYPOINT_HANDOFF_RUNTIME_FIELD_KEY_SET = new Set(
  GRAPH_PLANNER_LAYER_ENTRYPOINT_HANDOFF_RUNTIME_FIELD_KEYS.map((key) => normalizeKey(key)),
);

const GRAPH_PLANNER_LAYER_ENTRYPOINT_HANDOFF_SAFE_SUMMARY_RUNTIME_FIELD_KEY_SET = new Set(
  GRAPH_PLANNER_LAYER_ENTRYPOINT_HANDOFF_SAFE_SUMMARY_RUNTIME_FIELD_KEYS.map((key) => normalizeKey(key)),
);

const GRAPH_PLANNER_LAYER_ENTRYPOINT_HANDOFF_SOURCE_FIELD_KEY_SET = new Set(
  [
    ...GRAPH_PLANNER_LAYER_ENTRYPOINT_HANDOFF_RUNTIME_FIELD_KEYS,
    'Authorization',
    'browserProfile',
    'callback',
    'cookie',
    'credentials',
    'repoPath',
    'sessionId',
    'token',
  ].map((key) => normalizeKey(key)),
);

const GRAPH_PLANNER_REQUIRED_PREFLIGHT_GUARD = 'assertFutureGraphLayerConsumerPreflightCompatibility';
const GRAPH_PLANNER_SOURCE_PREFLIGHT_QUERY_NAME = 'createFutureGraphLayerConsumerPreflightContract';
const GRAPH_PLANNER_SOURCE_PREFLIGHT_ARTIFACT_FAMILY = 'site-capability-graph-future-layer-consumer-preflight-contract';
const GRAPH_PLANNER_LAYER_ENTRYPOINT_LIVE_EXECUTION_DENIAL_GUARD_ARTIFACT_FAMILY =
  'site-capability-graph-planner-layer-entrypoint-live-execution-denial-guard';

const GRAPH_PLANNER_LAYER_ENTRYPOINT_LIVE_EXECUTION_DENIAL_GUARD_DISABLED_FLAG_KEYS = Object.freeze([
  'executionAllowed',
  'liveExecutionEnabled',
  'runtimeExecutionEnabled',
  'graphExecutionAllowed',
  'graphExecutionEnabled',
  'routeExecutionAllowed',
  'routeExecutionEnabled',
  'taskExecutionAllowed',
  'taskExecutionEnabled',
  'liveLayerPlannerRuntimeExecutionEnabled',
  'liveRouteExecutionEnabled',
  'siteAdapterInvocationEnabled',
  'downloaderInvocationEnabled',
  'sessionViewMaterializationEnabled',
  'downloadPolicyMaterializationEnabled',
  'standardTaskListMaterializationEnabled',
  'runtimeArtifactWriteEnabled',
  'runtimeWriteEnabled',
  'repoWriteEnabled',
  'externalDispatchEnabled',
  'externalTelemetryEnabled',
  'statusPromotionEnabled',
  'statusPromotionAllowed',
]);

const GRAPH_PLANNER_LAYER_ENTRYPOINT_LIVE_EXECUTION_DENIAL_GUARD_RUNTIME_FIELD_KEYS = Object.freeze([
  ...GRAPH_PLANNER_LAYER_ENTRYPOINT_HANDOFF_SAFE_SUMMARY_RUNTIME_FIELD_KEYS,
  'DownloadPolicy',
  'GraphExecution',
  'SessionView',
  'SiteAdapter',
  'StandardTaskList',
  'authorizationHeader',
  'credential',
  'credentials',
  'csrf',
  'downloadPolicy',
  'downloader',
  'externalDispatch',
  'externalTelemetry',
  'graphExecution',
  'liveLayerPlannerRuntimeExecution',
  'livePlannerRuntimeExecution',
  'repoWrite',
  'routeExecution',
  'runtimeArtifact',
  'runtimeArtifactWrite',
  'runtimeWrite',
  'runtimePayload',
  'secret',
  'sessionView',
  'siteAdapter',
  'standardTaskList',
  'statusPromotion',
  'syntheticSecret',
  'taskExecution',
]);

const GRAPH_PLANNER_LAYER_ENTRYPOINT_LIVE_EXECUTION_DENIAL_GUARD_DISABLED_FLAG_KEY_SET = new Set(
  GRAPH_PLANNER_LAYER_ENTRYPOINT_LIVE_EXECUTION_DENIAL_GUARD_DISABLED_FLAG_KEYS
    .map((key) => normalizeKey(key)),
);

const GRAPH_PLANNER_LAYER_ENTRYPOINT_LIVE_EXECUTION_DENIAL_GUARD_RUNTIME_FIELD_KEY_SET = new Set(
  GRAPH_PLANNER_LAYER_ENTRYPOINT_LIVE_EXECUTION_DENIAL_GUARD_RUNTIME_FIELD_KEYS
    .map((key) => normalizeKey(key)),
);

const GRAPH_PLANNER_LAYER_ENTRYPOINT_LIVE_EXECUTION_DENIAL_GUARD_BOUNDARIES = Object.freeze([
  'graph-execution',
  'route-execution',
  'task-execution',
  'site-adapter',
  'downloader',
  'session-view',
  'download-policy',
  'standard-task-list',
  'runtime-artifact-write',
  'runtime-write',
  'repo-write',
  'external-dispatch',
  'external-telemetry',
  'status-promotion',
  'sensitive-fields',
]);

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[-_]/gu, '');
}

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function findForbiddenHandoffRefValue(value) {
  const text = String(value ?? '');
  return FORBIDDEN_HANDOFF_REF_VALUE_PATTERNS.find(({ pattern }) => pattern.test(text));
}

function assertNoPlannerSecrets(value = {}, label = 'PlannerPolicyHandoff') {
  const pending = [{ value, path: label }];
  while (pending.length) {
    const current = pending.pop();
    if (Array.isArray(current.value)) {
      current.value.forEach((item, index) => {
        pending.push({ value: item, path: `${current.path}.${index}` });
      });
      continue;
    }
    if (!current.value || typeof current.value !== 'object') {
      if (typeof current.value === 'string') {
        const finding = findForbiddenHandoffRefValue(current.value);
        if (finding) {
          throw new Error(`${label} must not expose raw ${finding.name} at ${current.path}`);
        }
      }
      continue;
    }
    for (const [key, child] of Object.entries(current.value)) {
      const normalizedKey = normalizeKey(key);
      if (
        FORBIDDEN_HANDOFF_KEY_SET.has(normalizedKey)
        || FORBIDDEN_HANDOFF_REF_KEY_SET.has(normalizedKey)
      ) {
        throw new Error(`${label} must not expose raw ${key}`);
      }
      pending.push({ value: child, path: `${current.path}.${key}` });
    }
  }
}

function assertNoGraphPlannerRouteHandoffRuntimeProducts(value = {}, label = 'GraphPlannerRouteHandoffConsumer') {
  const pending = [{ value, path: label }];
  while (pending.length) {
    const current = pending.pop();
    if (Array.isArray(current.value)) {
      current.value.forEach((item, index) => {
        pending.push({ value: item, path: `${current.path}.${index}` });
      });
      continue;
    }
    if (!current.value || typeof current.value !== 'object') {
      continue;
    }
    for (const [key, child] of Object.entries(current.value)) {
      if (GRAPH_PLANNER_ROUTE_HANDOFF_RUNTIME_PRODUCT_KEY_SET.has(normalizeKey(key))) {
        throw new Error(`${label} must remain descriptor-only and must not expose ${key}`);
      }
      pending.push({ value: child, path: `${current.path}.${key}` });
    }
  }
}

function assertNoGraphPlannerRuntimeIntegrationProducts(
  value = {},
  label = 'GraphPlannerRuntimeIntegrationDesign',
) {
  const pending = [{ value, path: label }];
  while (pending.length) {
    const current = pending.pop();
    if (Array.isArray(current.value)) {
      current.value.forEach((item, index) => {
        pending.push({ value: item, path: `${current.path}.${index}` });
      });
      continue;
    }
    if (!current.value || typeof current.value !== 'object') {
      continue;
    }
    for (const [key, child] of Object.entries(current.value)) {
      if (GRAPH_PLANNER_RUNTIME_INTEGRATION_RUNTIME_PRODUCT_KEY_SET.has(normalizeKey(key))) {
        throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${current.path}.${key}`);
      }
      pending.push({ value: child, path: `${current.path}.${key}` });
    }
  }
}

function assertNoGraphPlannerRouteHandoffLayerEntrypointRuntimeFields(
  value = {},
  label = 'GraphPlannerRouteHandoffLayerEntrypointBoundary',
) {
  const pending = [{ value, path: label }];
  while (pending.length) {
    const current = pending.pop();
    if (Array.isArray(current.value)) {
      current.value.forEach((item, index) => {
        pending.push({ value: item, path: `${current.path}.${index}` });
      });
      continue;
    }
    if (!current.value || typeof current.value !== 'object') {
      continue;
    }
    for (const [key, child] of Object.entries(current.value)) {
      if (GRAPH_PLANNER_ROUTE_HANDOFF_LAYER_ENTRYPOINT_RUNTIME_FIELD_KEY_SET.has(normalizeKey(key))) {
        throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${current.path}.${key}`);
      }
      pending.push({ value: child, path: `${current.path}.${key}` });
    }
  }
}

function assertNoGraphPlannerRiskBlockingRuntimeExecutionFields(
  value = {},
  label = 'GraphPlannerRiskBlockingRuntimePreflightContract',
) {
  const pending = [{ value, path: label }];
  while (pending.length) {
    const current = pending.pop();
    if (Array.isArray(current.value)) {
      current.value.forEach((item, index) => {
        pending.push({ value: item, path: `${current.path}.${index}` });
      });
      continue;
    }
    if (!current.value || typeof current.value !== 'object') {
      continue;
    }
    for (const [key, child] of Object.entries(current.value)) {
      const normalizedKey = normalizeKey(key);
      const isGateDescriptor = current.path.endsWith('.gates')
        && GRAPH_PLANNER_RISK_BLOCKING_PREFLIGHT_GATE_DESCRIPTOR_KEYS.has(normalizedKey);
      if (
        !isGateDescriptor
        && GRAPH_PLANNER_RISK_BLOCKING_PREFLIGHT_RUNTIME_FIELD_KEY_SET.has(normalizedKey)
      ) {
        throw new Error(`${label} must remain contract-only and must not expose runtime field: ${current.path}.${key}`);
      }
      pending.push({ value: child, path: `${current.path}.${key}` });
    }
  }
}

function assertNoGraphPlannerLayerEntrypointHandoffRuntimeFields(
  value = {},
  label = 'GraphPlannerLayerEntrypointHandoffGuard',
) {
  const pending = [{ value, path: label }];
  while (pending.length) {
    const current = pending.pop();
    if (Array.isArray(current.value)) {
      current.value.forEach((item, index) => {
        pending.push({ value: item, path: `${current.path}.${index}` });
      });
      continue;
    }
    if (!current.value || typeof current.value !== 'object') {
      continue;
    }
    for (const [key, child] of Object.entries(current.value)) {
      const normalizedKey = normalizeKey(key);
      if (GRAPH_PLANNER_LAYER_ENTRYPOINT_HANDOFF_DISABLED_FLAG_KEY_SET.has(normalizedKey)) {
        if (child !== false && child !== undefined) {
          throw new Error(`${label} ${key} must remain false`);
        }
      } else if (GRAPH_PLANNER_LAYER_ENTRYPOINT_HANDOFF_RUNTIME_FIELD_KEY_SET.has(normalizedKey)) {
        throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${current.path}.${key}`);
      }
      pending.push({ value: child, path: `${current.path}.${key}` });
    }
  }
  return true;
}

function assertNoGraphPlannerLayerEntrypointHandoffSourceRuntimeFields(
  value = {},
  label = 'GraphPlannerLayerEntrypointHandoffGuardSources',
) {
  const pending = [{ value, path: label }];
  while (pending.length) {
    const current = pending.pop();
    if (Array.isArray(current.value)) {
      current.value.forEach((item, index) => {
        pending.push({ value: item, path: `${current.path}.${index}` });
      });
      continue;
    }
    if (!current.value || typeof current.value !== 'object') {
      continue;
    }
    for (const [key, child] of Object.entries(current.value)) {
      if (GRAPH_PLANNER_LAYER_ENTRYPOINT_HANDOFF_SOURCE_FIELD_KEY_SET.has(normalizeKey(key))) {
        throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${current.path}.${key}`);
      }
      pending.push({ value: child, path: `${current.path}.${key}` });
    }
  }
  return true;
}

function assertNoGraphPlannerLayerEntrypointHandoffSafeSummaryRuntimeFields(
  value = {},
  label = 'GraphPlannerLayerEntrypointHandoffSafeSummary',
  { allowSourceRuntimeConsumerHandoffSummary = false } = {},
) {
  const pending = [{ value, path: label }];
  while (pending.length) {
    const current = pending.pop();
    if (Array.isArray(current.value)) {
      current.value.forEach((item, index) => {
        pending.push({ value: item, path: `${current.path}.${index}` });
      });
      continue;
    }
    if (!current.value || typeof current.value !== 'object') {
      continue;
    }
    for (const [key, child] of Object.entries(current.value)) {
      const normalizedKey = normalizeKey(key);
      const isAllowedSourceRuntimeConsumerHandoffSummary =
        allowSourceRuntimeConsumerHandoffSummary
        && normalizedKey === 'handoff'
        && (
          current.path.endsWith('.sourceRuntimeConsumer')
          || current.path.endsWith('.sourceDisabledRuntimeConsumer')
        );
      if (isAllowedSourceRuntimeConsumerHandoffSummary) {
        continue;
      }
      if (GRAPH_PLANNER_LAYER_ENTRYPOINT_HANDOFF_DISABLED_FLAG_KEY_SET.has(normalizedKey)) {
        if (child !== false && child !== undefined) {
          throw new Error(`${label} ${key} must remain false`);
        }
      } else if (
        GRAPH_PLANNER_LAYER_ENTRYPOINT_HANDOFF_SAFE_SUMMARY_RUNTIME_FIELD_KEY_SET.has(normalizedKey)
      ) {
        throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${current.path}.${key}`);
      }
      pending.push({ value: child, path: `${current.path}.${key}` });
    }
  }
  return true;
}

function assertNoGraphPlannerLayerEntrypointLiveExecutionDenialGuardRuntimeFields(
  value = {},
  label = 'GraphPlannerLayerEntrypointLiveExecutionDenialGuard',
) {
  const pending = [{ value, path: label }];
  while (pending.length) {
    const current = pending.pop();
    if (Array.isArray(current.value)) {
      current.value.forEach((item, index) => {
        pending.push({ value: item, path: `${current.path}.${index}` });
      });
      continue;
    }
    if (!current.value || typeof current.value !== 'object') {
      continue;
    }
    for (const [key, child] of Object.entries(current.value)) {
      const normalizedKey = normalizeKey(key);
      if (GRAPH_PLANNER_LAYER_ENTRYPOINT_LIVE_EXECUTION_DENIAL_GUARD_DISABLED_FLAG_KEY_SET.has(normalizedKey)) {
        if (child !== false && child !== undefined) {
          throw new Error(`${label} ${key} must remain false`);
        }
      } else if (
        GRAPH_PLANNER_LAYER_ENTRYPOINT_LIVE_EXECUTION_DENIAL_GUARD_RUNTIME_FIELD_KEY_SET
          .has(normalizedKey)
      ) {
        throw new Error(`${label} must remain descriptor-only and must not expose runtime field: ${current.path}.${key}`);
      }
      pending.push({ value: child, path: `${current.path}.${key}` });
    }
  }
  return true;
}

function assertGraphPlannerRiskBlockingGateDescriptor(gate = {}, label = 'GraphPlannerRiskBlockingRuntimePreflightContract gate', expected = {}) {
  assertPlainObject(gate, label);
  for (const [fieldName, expectedValue] of Object.entries(expected)) {
    if (gate[fieldName] !== expectedValue) {
      throw new Error(`${label} ${fieldName} must be ${expectedValue}`);
    }
  }
}

function assertDisabledFlag(value, fieldName, label) {
  if (value !== undefined && value !== false) {
    throw new Error(`${label} ${fieldName} must remain false`);
  }
  return false;
}

function assertGraphPlannerRiskBlockingPreflightDisabledOptions(options = {}) {
  for (const fieldName of GRAPH_PLANNER_RISK_BLOCKING_PREFLIGHT_DISABLED_FLAG_KEYS) {
    assertDisabledFlag(
      options[fieldName],
      fieldName,
      'GraphPlannerRiskBlockingRuntimePreflightContract',
    );
  }
}

function assertGraphPlannerLayerEntrypointHandoffDisabledOptions(options = {}) {
  for (const fieldName of GRAPH_PLANNER_LAYER_ENTRYPOINT_HANDOFF_DISABLED_FLAG_KEYS) {
    assertDisabledFlag(
      options[fieldName],
      fieldName,
      'GraphPlannerLayerEntrypointHandoffGuard',
    );
  }
}

function assertGraphPlannerLayerEntrypointLiveExecutionDenialGuardDisabledOptions(options = {}) {
  for (const fieldName of GRAPH_PLANNER_LAYER_ENTRYPOINT_LIVE_EXECUTION_DENIAL_GUARD_DISABLED_FLAG_KEYS) {
    assertDisabledFlag(
      options[fieldName],
      fieldName,
      'GraphPlannerLayerEntrypointLiveExecutionDenialGuard',
    );
  }
}

function selectGraphPlannerLayerEntrypointHandoffSourceAlias({
  sources,
  aliases,
  label,
  required = true,
  assertCompatibility,
}) {
  const entries = aliases
    .filter((alias) => Object.hasOwn(sources, alias))
    .map((alias) => ({ alias, value: sources[alias] }));
  if (entries.length === 0) {
    if (required) {
      throw new Error(`${label} source alias is required`);
    }
    return undefined;
  }
  for (const { value } of entries) {
    assertCompatibility(value);
  }
  const selected = entries[0].value;
  for (const { alias, value } of entries.slice(1)) {
    if (value !== selected) {
      throw new Error(`${label} source aliases must reference the same descriptor object: ${entries[0].alias} and ${alias}`);
    }
  }
  return selected;
}

function summarizeFutureGraphLayerConsumerPreflight(preflight = {}) {
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
    requiredGuard: GRAPH_PLANNER_REQUIRED_PREFLIGHT_GUARD,
    sourceArtifact: item.sourceArtifact === null ? null : {
      queryName: item.sourceArtifact.queryName,
      artifactFamily: item.sourceArtifact.artifactFamily,
    },
  };
}

function summarizeDisabledGraphPlannerRuntimeConsumerResult(result = {}) {
  assertDisabledGraphPlannerRuntimeConsumerResultCompatibility(result);
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
    executionAllowed: item.executionAllowed,
    liveRouteExecutionEnabled: item.liveRouteExecutionEnabled,
    siteAdapterInvocationEnabled: item.siteAdapterInvocationEnabled,
    downloaderInvocationEnabled: item.downloaderInvocationEnabled,
    sessionMaterializationEnabled: item.sessionMaterializationEnabled,
    runtimeArtifactWriteEnabled: item.runtimeArtifactWriteEnabled,
    externalDispatchEnabled: item.externalDispatchEnabled,
    sourceDesign: item.sourceDesign,
    sourcePreflight: item.sourcePreflight,
    handoff: item.handoff,
  };
}

function summarizeGraphPlannerRuntimeIntegrationDesignForEntrypointGuard(design = {}) {
  assertGraphPlannerRuntimeIntegrationDesignCompatibility(design);
  const item = design.items[0];
  return {
    queryName: design.queryName,
    artifactFamily: design.artifactFamily,
    graphVersion: design.graphVersion,
    redactionRequired: design.redactionRequired,
    integrationName: item.integrationName,
    integrationMode: item.integrationMode,
    layerEntryPoint: item.layerEntryPoint,
    executionAllowed: item.executionAllowed,
    liveRouteExecutionEnabled: item.liveRouteExecutionEnabled,
    siteAdapterInvocationEnabled: item.siteAdapterInvocationEnabled,
    downloaderInvocationEnabled: item.downloaderInvocationEnabled,
    sessionMaterializationEnabled: item.sessionMaterializationEnabled,
    runtimeArtifactWriteEnabled: item.runtimeArtifactWriteEnabled,
    externalDispatchEnabled: item.externalDispatchEnabled,
    requiredPreflightGuard: item.requiredPreflightGuard,
    sourcePreflight: item.sourcePreflight,
    sourceHandoff: {
      handoffKind: item.handoff.handoffKind,
      graphVersion: item.handoff.graphVersion,
      result: item.handoff.result,
      reasonCode: item.handoff.reasonCode,
      executionAllowed: item.handoff.executionAllowed,
    },
  };
}

function createGraphPlannerRuntimeSourcePreflightSummary({
  graphVersion,
  consumerName = 'site-capability-layer-graph-planner-runtime-preflight',
  preflightContract,
} = {}) {
  if (preflightContract !== undefined) {
    return summarizeFutureGraphLayerConsumerPreflight(preflightContract);
  }
  return summarizeFutureGraphLayerConsumerPreflight(
    createFutureGraphLayerConsumerPreflightContract({
      graphVersion,
      consumerName,
    }),
  );
}

function assertGraphPlannerRuntimeSourcePreflightSummaryCompatibility(
  sourcePreflight = {},
  label = 'GraphPlannerRuntimeIntegrationDesign sourcePreflight',
) {
  assertPlainObject(sourcePreflight, label);
  assertNoGraphPlannerRuntimeIntegrationProducts(sourcePreflight, label);
  assertNoPlannerSecrets(sourcePreflight, label);
  if (sourcePreflight.queryName !== GRAPH_PLANNER_SOURCE_PREFLIGHT_QUERY_NAME) {
    throw new Error(`${label} queryName is not compatible`);
  }
  if (sourcePreflight.artifactFamily !== GRAPH_PLANNER_SOURCE_PREFLIGHT_ARTIFACT_FAMILY) {
    throw new Error(`${label} artifactFamily is not compatible`);
  }
  if (!normalizeText(sourcePreflight.graphVersion)) {
    throw new Error(`${label} graphVersion is required`);
  }
  if (sourcePreflight.redactionRequired !== true) {
    throw new Error(`${label} redactionRequired must be true`);
  }
  if (sourcePreflight.requiredGuard !== GRAPH_PLANNER_REQUIRED_PREFLIGHT_GUARD) {
    throw new Error(`${label} requiredGuard is not compatible`);
  }
  if (sourcePreflight.contractMode !== 'descriptor-only-preflight') {
    throw new Error(`${label} contractMode must be descriptor-only-preflight`);
  }
  if (sourcePreflight.descriptorOnly !== true) {
    throw new Error(`${label} descriptorOnly must be true`);
  }
  if (sourcePreflight.result !== 'blocked') {
    throw new Error(`${label} result must be blocked`);
  }
  if (sourcePreflight.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
    throw new Error(`${label} reasonCode is not compatible`);
  }
  if (!normalizeText(sourcePreflight.consumerName)) {
    throw new Error(`${label} consumerName is required`);
  }
  if (sourcePreflight.sourceArtifact !== null) {
    assertPlainObject(sourcePreflight.sourceArtifact, `${label}.sourceArtifact`);
    if (!normalizeText(sourcePreflight.sourceArtifact.queryName)) {
      throw new Error(`${label}.sourceArtifact queryName is required`);
    }
    if (!normalizeText(sourcePreflight.sourceArtifact.artifactFamily)) {
      throw new Error(`${label}.sourceArtifact artifactFamily is required`);
    }
  }
  assertNoForbiddenPatterns(sourcePreflight);
  return true;
}

function selectEndpoint(catalogEntry, taskIntent) {
  return normalizeText(
    taskIntent.endpoint
    ?? taskIntent.url
    ?? catalogEntry.endpoint?.url
    ?? catalogEntry.endpoint?.href
    ?? catalogEntry.endpoint?.pattern
    ?? catalogEntry.urlPattern,
  );
}

function selectMethod(catalogEntry, taskIntent) {
  return normalizeText(taskIntent.method ?? catalogEntry.endpoint?.method)?.toUpperCase() ?? 'GET';
}

function deriveSessionRequirement(catalogEntry, policy) {
  const explicit = normalizeText(policy.sessionRequirement);
  if (explicit) {
    return explicit;
  }
  return catalogEntry.auth?.required === true ? 'required' : 'none';
}

function summarizeRedactionAudit(audit = {}) {
  return {
    redactedPathCount: Array.isArray(audit.redactedPaths) ? audit.redactedPaths.length : 0,
    findingCount: Array.isArray(audit.findings) ? audit.findings.length : 0,
  };
}

function applyPlannerHealthGate({ healthRecovery, tasks = [] } = {}) {
  if (!healthRecovery) {
    return tasks;
  }
  return applySiteHealthExecutionGateToTaskList({
    healthRecovery,
    tasks,
  });
}

function assertPlannerPolicyCatalogGate(catalogEntry = {}, catalogUpgradeDecision = {}) {
  assertPlainObject(catalogUpgradeDecision, 'PlannerPolicyHandoff catalogUpgradeDecision');
  assertNoPlannerSecrets(catalogUpgradeDecision, 'PlannerPolicyHandoff catalogUpgradeDecision');
  const decision = assertApiCatalogUpgradeDecisionAllowsCatalog(catalogUpgradeDecision);
  const candidateId = normalizeText(catalogEntry.candidateId);
  if (!candidateId) {
    throw new Error('PlannerPolicyHandoff catalogEntry.candidateId is required');
  }
  if (normalizeText(decision.candidateId) !== candidateId) {
    throw new Error(`PlannerPolicyHandoff catalog gate candidate mismatch: ${normalizeText(decision.candidateId)} !== ${candidateId}`);
  }
  const siteKey = normalizeText(catalogEntry.siteKey);
  if (normalizeText(decision.siteKey) !== siteKey) {
    throw new Error(`PlannerPolicyHandoff catalog gate site mismatch: ${normalizeText(decision.siteKey)} !== ${siteKey}`);
  }
  const requirements = decision.requirements && typeof decision.requirements === 'object' && !Array.isArray(decision.requirements)
    ? decision.requirements
    : {};
  if (requirements.candidateStatus !== 'verified' || requirements.candidateVerified !== true) {
    throw new Error('PlannerPolicyHandoff requires verified ApiCandidate catalog gate');
  }
  if (requirements.siteAdapterDecision !== 'accepted' || requirements.siteAdapterAccepted !== true) {
    throw new Error('PlannerPolicyHandoff requires accepted SiteAdapter catalog gate');
  }
  if (requirements.policyAllowsCatalogUpgrade !== true) {
    throw new Error('PlannerPolicyHandoff requires allow catalog upgrade policy gate');
  }
  return decision;
}

function summarizeCatalogGate(decision = {}) {
  return {
    candidateId: decision.candidateId,
    siteKey: decision.siteKey,
    adapterId: decision.adapterId,
    decision: decision.decision,
    catalogAction: decision.catalogAction,
    requirements: {
      candidateStatus: decision.requirements?.candidateStatus,
      candidateVerified: decision.requirements?.candidateVerified,
      siteAdapterDecision: decision.requirements?.siteAdapterDecision,
      siteAdapterAccepted: decision.requirements?.siteAdapterAccepted,
      policyAllowsCatalogUpgrade: decision.requirements?.policyAllowsCatalogUpgrade,
    },
  };
}

function isSchemaCompatibilityError(error) {
  return /schemaVersion|not compatible/iu.test(String(error?.message ?? ''));
}

function isDownloadPolicyGenerationError(error) {
  return /(?:^|Unsupported )DownloadPolicy/iu.test(String(error?.message ?? ''));
}

function createSchemaCompatibilityFailure() {
  const reason = requireReasonCodeDefinition('schema-version-incompatible', { family: 'schema' });
  const failure = new Error('PlannerPolicyHandoff schema compatibility failed before artifact write');
  failure.reasonCode = reason.code;
  failure.retryable = reason.retryable;
  failure.cooldownNeeded = reason.cooldownNeeded;
  failure.isolationNeeded = reason.isolationNeeded;
  failure.manualRecoveryNeeded = reason.manualRecoveryNeeded;
  failure.degradable = reason.degradable;
  failure.artifactWriteAllowed = reason.artifactWriteAllowed;
  failure.catalogAction = reason.catalogAction;
  failure.failureMode = 'schema-compatibility';
  failure.causeSummary = {
    reasonCode: reason.code,
    message: 'schema compatibility failure',
  };
  return failure;
}

function createDownloadPolicyGenerationFailure() {
  const reason = requireReasonCodeDefinition('download-policy-generation-failed', { family: 'download' });
  const failure = new Error('PlannerPolicyHandoff download policy generation failed before artifact write');
  failure.reasonCode = reason.code;
  failure.retryable = reason.retryable;
  failure.cooldownNeeded = reason.cooldownNeeded;
  failure.isolationNeeded = reason.isolationNeeded;
  failure.manualRecoveryNeeded = reason.manualRecoveryNeeded;
  failure.degradable = reason.degradable;
  failure.artifactWriteAllowed = reason.artifactWriteAllowed;
  failure.catalogAction = reason.catalogAction;
  failure.failureMode = 'download-policy-generation';
  failure.causeSummary = {
    reasonCode: reason.code,
    message: 'download policy generation failure',
  };
  return failure;
}

function summarizeGraphPlannerReason(reasonCode) {
  if (!reasonCode) {
    return null;
  }
  const reason = requireReasonCodeDefinition(reasonCode, { family: 'graph' });
  return {
    code: reason.code,
    retryable: reason.retryable,
    cooldownNeeded: reason.cooldownNeeded,
    isolationNeeded: reason.isolationNeeded,
    manualRecoveryNeeded: reason.manualRecoveryNeeded,
    degradable: reason.degradable,
    artifactWriteAllowed: reason.artifactWriteAllowed,
  };
}

function createGraphVersionIncompatibleFailure({
  graphSchemaVersion,
  graphDataVersion,
  supportedGraphDataVersions,
} = {}) {
  const reason = requireReasonCodeDefinition('graph-version-incompatible', { family: 'graph' });
  const failure = new Error('Graph planner handoff version compatibility failed before planner use');
  failure.reasonCode = reason.code;
  failure.retryable = reason.retryable;
  failure.cooldownNeeded = reason.cooldownNeeded;
  failure.isolationNeeded = reason.isolationNeeded;
  failure.manualRecoveryNeeded = reason.manualRecoveryNeeded;
  failure.degradable = reason.degradable;
  failure.artifactWriteAllowed = reason.artifactWriteAllowed;
  failure.failureMode = 'graph-version-compatibility';
  failure.causeSummary = {
    reasonCode: reason.code,
    graphSchemaVersion,
    graphDataVersion,
    supportedGraphSchemaVersion: SITE_CAPABILITY_GRAPH_SCHEMA_VERSION,
    supportedGraphDataVersions,
  };
  return failure;
}

function assertGraphPlannerVersionCompatibility(graph = {}, {
  supportedGraphDataVersions = SUPPORTED_GRAPH_PLANNER_DATA_VERSIONS,
} = {}) {
  const graphSchemaVersion = graph?.manifest?.graphSchemaVersion;
  const graphDataVersion = normalizeText(graph?.manifest?.graphDataVersion);
  const supported = Array.isArray(supportedGraphDataVersions)
    ? supportedGraphDataVersions
    : SUPPORTED_GRAPH_PLANNER_DATA_VERSIONS;
  if (
    graphSchemaVersion !== SITE_CAPABILITY_GRAPH_SCHEMA_VERSION
    || !graphDataVersion
    || !supported.includes(graphDataVersion)
  ) {
    throw createGraphVersionIncompatibleFailure({
      graphSchemaVersion,
      graphDataVersion,
      supportedGraphDataVersions: supported,
    });
  }
  return {
    graphSchemaVersion,
    graphDataVersion,
    supportedGraphDataVersions: [...supported],
  };
}

async function writeTextArtifact(filePath, text) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${text}\n`, 'utf8');
}

export function assertPlannerPolicyHandoffWriterCompatibility({
  catalogEntry,
  downloadPolicy,
  taskList,
} = {}) {
  assertGovernedSchemaCompatible('ApiCatalogEntry', catalogEntry);
  assertGovernedSchemaCompatible('DownloadPolicy', downloadPolicy);
  assertGovernedSchemaCompatible('StandardTaskList', taskList);
  assertNoPlannerSecrets(catalogEntry, 'PlannerPolicyHandoff catalogEntry');
  assertNoPlannerSecrets(downloadPolicy, 'PlannerPolicyHandoff downloadPolicy');
  assertNoPlannerSecrets(taskList, 'PlannerPolicyHandoff taskList');
  return true;
}

export function assertPlannerPolicyRuntimeHandoffCompatibility(handoff = {}) {
  assertPlainObject(handoff, 'PlannerPolicyRuntimeHandoff');
  assertGovernedSchemaCompatible('DownloadPolicy', handoff.downloadPolicy);
  assertGovernedSchemaCompatible('StandardTaskList', handoff.taskList);
  assertNoPlannerSecrets(handoff, 'PlannerPolicyRuntimeHandoff');
  for (const item of Array.isArray(handoff.taskList?.items) ? handoff.taskList.items : []) {
    if (item?.healthGate?.allowed === false) {
      throw new Error(`PlannerPolicyRuntimeHandoff blocked by SiteHealthExecutionGate: ${item.healthGate.reason ?? 'health-risk-blocked'}`);
    }
  }
  assertTrustBoundaryCrossing({
    ...PLANNER_POLICY_RUNTIME_HANDOFF_TRUST_BOUNDARY,
    payload: handoff,
  });
  return true;
}

export function assertGraphPlannerRouteHandoffConsumerCompatibility(handoff = {}) {
  assertPlainObject(handoff, 'GraphPlannerRouteHandoffConsumer');
  assertNoGraphPlannerRouteHandoffRuntimeProducts(handoff);
  assertNoPlannerSecrets(handoff, 'GraphPlannerRouteHandoffConsumer');
  if (handoff.schemaVersion !== 1) {
    throw new Error(`GraphPlannerRouteHandoffConsumer schemaVersion ${handoff.schemaVersion ?? '<missing>'} is not compatible`);
  }
  if (handoff.handoffKind !== GRAPH_PLANNER_ROUTE_HANDOFF_KIND) {
    throw new Error(`GraphPlannerRouteHandoffConsumer handoffKind must be ${GRAPH_PLANNER_ROUTE_HANDOFF_KIND}`);
  }
  if (handoff.executionAllowed !== false) {
    throw new Error('GraphPlannerRouteHandoffConsumer executionAllowed must be false');
  }
  if (!['planned', 'blocked'].includes(handoff.result)) {
    throw new Error(`GraphPlannerRouteHandoffConsumer result is unsupported: ${handoff.result ?? '<missing>'}`);
  }
  const compatibility = handoff.compatibility;
  assertPlainObject(compatibility, 'GraphPlannerRouteHandoffConsumer compatibility');
  if (
    compatibility.graphSchemaVersion !== SITE_CAPABILITY_GRAPH_SCHEMA_VERSION
    || !SUPPORTED_GRAPH_PLANNER_DATA_VERSIONS.includes(compatibility.graphDataVersion)
  ) {
    throw createGraphVersionIncompatibleFailure({
      graphSchemaVersion: compatibility.graphSchemaVersion,
      graphDataVersion: compatibility.graphDataVersion,
      supportedGraphDataVersions: SUPPORTED_GRAPH_PLANNER_DATA_VERSIONS,
    });
  }
  if (handoff.result === 'planned') {
    assertPlainObject(handoff.route, 'GraphPlannerRouteHandoffConsumer route');
    if (handoff.route.type !== 'RouteNode') {
      throw new Error('GraphPlannerRouteHandoffConsumer planned result requires a RouteNode descriptor');
    }
    if (!normalizeText(handoff.route.id)) {
      throw new Error('GraphPlannerRouteHandoffConsumer planned route id is required');
    }
    if (handoff.reasonCode !== null && handoff.reasonCode !== undefined) {
      throw new Error('GraphPlannerRouteHandoffConsumer planned result must not include a reasonCode');
    }
  } else {
    if (handoff.route !== null) {
      throw new Error('GraphPlannerRouteHandoffConsumer blocked result must not include a route');
    }
    if (!normalizeText(handoff.reasonCode)) {
      throw new Error('GraphPlannerRouteHandoffConsumer blocked result requires a reasonCode');
    }
  }
  if (handoff.reasonCode) {
    const reason = requireReasonCodeDefinition(handoff.reasonCode, { family: 'graph' });
    if (handoff.reason?.code && handoff.reason.code !== reason.code) {
      throw new Error(`GraphPlannerRouteHandoffConsumer reason code mismatch: ${handoff.reason.code} !== ${reason.code}`);
    }
  }
  assertNoForbiddenPatterns(handoff);
  return true;
}

export function assertGraphPlannerRouteHandoffLayerEntrypointBoundaryCompatibility(handoff = {}) {
  assertGraphPlannerRouteHandoffConsumerCompatibility(handoff);
  assertNoGraphPlannerRuntimeIntegrationProducts(
    handoff,
    'GraphPlannerRouteHandoffLayerEntrypointBoundary',
  );
  assertNoGraphPlannerRouteHandoffLayerEntrypointRuntimeFields(handoff);
  assertNoForbiddenPatterns(handoff);
  return true;
}

export function createGraphPlannerRouteHandoff({
  graph,
  capabilityId,
  context = {},
  supportedGraphDataVersions = SUPPORTED_GRAPH_PLANNER_DATA_VERSIONS,
} = {}) {
  const compatibility = assertGraphPlannerVersionCompatibility(graph, {
    supportedGraphDataVersions,
  });
  const graphPlan = planGraphCapabilityRoute(graph, capabilityId, context);
  const handoff = {
    schemaVersion: 1,
    handoffKind: 'site-capability-graph-route-plan',
    graphVersion: graphPlan.graphVersion,
    compatibility,
    capabilityId: graphPlan.capabilityId,
    result: graphPlan.result,
    reasonCode: graphPlan.reasonCode,
    reason: summarizeGraphPlannerReason(graphPlan.reasonCode),
    riskState: graphPlan.riskState ?? null,
    route: graphPlan.route,
    executionAllowed: false,
  };
  assertNoPlannerSecrets(handoff, 'GraphPlannerRouteHandoff');
  assertNoForbiddenPatterns(handoff);
  assertGraphPlannerRouteHandoffConsumerCompatibility(handoff);
  return handoff;
}

export function createGraphPlannerRouteHandoffArtifact(options = {}) {
  const handoff = createGraphPlannerRouteHandoff(options);
  const artifact = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: handoff.graphVersion,
    queryName: 'createGraphPlannerRouteHandoff',
    artifactFamily: 'site-capability-graph-planner-handoff',
    redactionRequired: true,
    items: [handoff],
  };
  assertNoPlannerSecrets(artifact, 'GraphPlannerRouteHandoffArtifact');
  assertNoForbiddenPatterns(artifact);
  return artifact;
}

function summarizeGraphPlannerRouteHandoffForLayerRelationship(handoff = {}) {
  assertGraphPlannerRouteHandoffLayerEntrypointBoundaryCompatibility(handoff);
  return {
    handoffKind: handoff.handoffKind,
    graphVersion: handoff.graphVersion,
    graphSchemaVersion: handoff.compatibility?.graphSchemaVersion,
    graphDataVersion: handoff.compatibility?.graphDataVersion,
    capabilityId: handoff.capabilityId,
    result: handoff.result,
    reasonCode: handoff.reasonCode,
    riskState: handoff.riskState ?? null,
    routeId: handoff.route?.id ?? null,
    routeKind: handoff.route?.routeKind ?? null,
    routeSiteKey: handoff.route?.siteKey ?? null,
    executionAllowed: handoff.executionAllowed,
  };
}

function summarizePlannerPolicyRuntimeHandoffForLayerRelationship(handoff = {}) {
  assertPlannerPolicyRuntimeHandoffCompatibility(handoff);
  return {
    siteKey: handoff.siteKey,
    taskType: handoff.taskType,
    catalogGateDecision: handoff.catalogGate?.decision,
    catalogGateAction: handoff.catalogGate?.catalogAction,
    policySchemaVersion: handoff.downloadPolicy?.schemaVersion,
    policyDryRun: handoff.downloadPolicy?.dryRun,
    policyNetworkResolveAllowed: handoff.downloadPolicy?.allowNetworkResolve,
    policySessionRequirement: handoff.downloadPolicy?.sessionRequirement,
    standardTaskListSchemaVersion: handoff.taskList?.schemaVersion,
    standardTaskCount: Array.isArray(handoff.taskList?.items) ? handoff.taskList.items.length : 0,
    healthGateApplied: handoff.healthGateApplied === true,
  };
}

function assertGraphLayerPolicyPlannerRelationshipFlags(item = {}) {
  for (const fieldName of [
    'graphExecutionAllowed',
    'routeExecutionAllowed',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'sessionMaterializationEnabled',
    'runtimeArtifactWriteEnabled',
    'repoWriteEnabled',
    'externalDispatchEnabled',
    'statusPromotionEnabled',
  ]) {
    if (item[fieldName] !== false) {
      throw new Error(`GraphLayerPolicyPlannerRelationshipEvidence ${fieldName} must be false`);
    }
  }
}

export function assertGraphLayerPolicyPlannerRelationshipEvidenceCompatibility(evidence = {}) {
  assertPlainObject(evidence, 'GraphLayerPolicyPlannerRelationshipEvidence');
  assertNoPlannerSecrets(evidence, 'GraphLayerPolicyPlannerRelationshipEvidence');
  if (evidence.schemaVersion !== GRAPH_QUERY_RESULT_SCHEMA_VERSION) {
    throw new Error(`GraphLayerPolicyPlannerRelationshipEvidence schemaVersion ${evidence.schemaVersion ?? '<missing>'} is not compatible`);
  }
  if (evidence.queryName !== 'createGraphLayerPolicyPlannerRelationshipEvidence') {
    throw new Error('GraphLayerPolicyPlannerRelationshipEvidence queryName is not compatible');
  }
  if (evidence.artifactFamily !== 'site-capability-graph-layer-policy-planner-relationship-evidence') {
    throw new Error('GraphLayerPolicyPlannerRelationshipEvidence artifactFamily is not compatible');
  }
  if (evidence.redactionRequired !== true) {
    throw new Error('GraphLayerPolicyPlannerRelationshipEvidence redactionRequired must be true');
  }
  if (evidence.relationshipKind !== 'graph-layer-policy-planner-runtime-path') {
    throw new Error('GraphLayerPolicyPlannerRelationshipEvidence relationshipKind is not compatible');
  }
  if (evidence.layerEntryPoint !== 'SiteCapabilityLayerPlanner') {
    throw new Error('GraphLayerPolicyPlannerRelationshipEvidence layerEntryPoint must remain SiteCapabilityLayerPlanner');
  }
  if (!Array.isArray(evidence.items) || evidence.items.length !== 1) {
    throw new Error('GraphLayerPolicyPlannerRelationshipEvidence must contain one evidence item');
  }

  const item = evidence.items[0];
  assertPlainObject(item, 'GraphLayerPolicyPlannerRelationshipEvidence.items[0]');
  assertGraphLayerPolicyPlannerRelationshipFlags(item);
  if (item.relationshipMode !== 'policy-handoff-runtime-path-with-readonly-graph-plan') {
    throw new Error('GraphLayerPolicyPlannerRelationshipEvidence relationshipMode is not compatible');
  }
  if (item.result !== 'reviewable') {
    throw new Error('GraphLayerPolicyPlannerRelationshipEvidence result must be reviewable');
  }
  if (item.graphConsumedAs !== 'read-only-route-planning-evidence') {
    throw new Error('GraphLayerPolicyPlannerRelationshipEvidence graphConsumedAs is not compatible');
  }
  if (item.layerPolicyPlannerEntrypoint !== 'createPlannerPolicyHandoff') {
    throw new Error('GraphLayerPolicyPlannerRelationshipEvidence layerPolicyPlannerEntrypoint is not compatible');
  }
  if (item.policyRuntimeCompatibilityGuard !== 'assertPlannerPolicyRuntimeHandoffCompatibility') {
    throw new Error('GraphLayerPolicyPlannerRelationshipEvidence policyRuntimeCompatibilityGuard is not compatible');
  }
  if (item.graphRouteCompatibilityGuard !== 'assertGraphPlannerRouteHandoffLayerEntrypointBoundaryCompatibility') {
    throw new Error('GraphLayerPolicyPlannerRelationshipEvidence graphRouteCompatibilityGuard is not compatible');
  }

  assertPlainObject(item.graphRoutePlan, 'GraphLayerPolicyPlannerRelationshipEvidence graphRoutePlan');
  if (item.graphRoutePlan.result !== 'planned') {
    throw new Error('GraphLayerPolicyPlannerRelationshipEvidence graphRoutePlan result must be planned');
  }
  if (item.graphRoutePlan.executionAllowed !== false) {
    throw new Error('GraphLayerPolicyPlannerRelationshipEvidence graphRoutePlan executionAllowed must be false');
  }
  if (!normalizeText(item.graphRoutePlan.routeId)) {
    throw new Error('GraphLayerPolicyPlannerRelationshipEvidence graphRoutePlan routeId is required');
  }

  assertPlainObject(item.policyRuntimePath, 'GraphLayerPolicyPlannerRelationshipEvidence policyRuntimePath');
  if (item.policyRuntimePath.policyDryRun !== true) {
    throw new Error('GraphLayerPolicyPlannerRelationshipEvidence policyRuntimePath policyDryRun must be true');
  }
  if (item.policyRuntimePath.policyNetworkResolveAllowed !== false) {
    throw new Error('GraphLayerPolicyPlannerRelationshipEvidence policyRuntimePath policyNetworkResolveAllowed must be false');
  }
  if (!Number.isInteger(item.policyRuntimePath.standardTaskCount) || item.policyRuntimePath.standardTaskCount < 1) {
    throw new Error('GraphLayerPolicyPlannerRelationshipEvidence policyRuntimePath must record at least one standard task');
  }
  if (!normalizeText(item.policyRuntimePath.siteKey) || !normalizeText(item.policyRuntimePath.taskType)) {
    throw new Error('GraphLayerPolicyPlannerRelationshipEvidence policyRuntimePath siteKey and taskType are required');
  }

  for (const runtimeField of [
    'taskList',
    'downloadPolicy',
    'sessionView',
    'siteAdapter',
    'downloader',
    'handler',
    'routeExecutor',
    'runtimePayload',
    'artifactPath',
    'writePath',
  ]) {
    if (Object.hasOwn(item, runtimeField)) {
      throw new Error(`GraphLayerPolicyPlannerRelationshipEvidence must not expose runtime field ${runtimeField}`);
    }
  }
  assertNoForbiddenPatterns(evidence);
  return true;
}

export function createGraphLayerPolicyPlannerRelationshipEvidence({
  graph,
  capabilityId,
  context = {},
  supportedGraphDataVersions = SUPPORTED_GRAPH_PLANNER_DATA_VERSIONS,
  catalogEntry,
  catalogUpgradeDecision,
  taskIntent,
  policy = {},
} = {}) {
  const graphRouteHandoff = createGraphPlannerRouteHandoff({
    graph,
    capabilityId,
    context,
    supportedGraphDataVersions,
  });
  if (graphRouteHandoff.result !== 'planned') {
    throw new Error(`GraphLayerPolicyPlannerRelationshipEvidence requires a planned graph route: ${graphRouteHandoff.reasonCode ?? 'graph-route-not-planned'}`);
  }
  const policyRuntimeHandoff = createPlannerPolicyHandoff({
    catalogEntry,
    catalogUpgradeDecision,
    taskIntent,
    policy,
  });
  const evidence = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: graphRouteHandoff.graphVersion,
    queryName: 'createGraphLayerPolicyPlannerRelationshipEvidence',
    artifactFamily: 'site-capability-graph-layer-policy-planner-relationship-evidence',
    relationshipKind: 'graph-layer-policy-planner-runtime-path',
    layerEntryPoint: 'SiteCapabilityLayerPlanner',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      relationshipMode: 'policy-handoff-runtime-path-with-readonly-graph-plan',
      result: 'reviewable',
      graphConsumedAs: 'read-only-route-planning-evidence',
      layerPolicyPlannerEntrypoint: 'createPlannerPolicyHandoff',
      policyRuntimeCompatibilityGuard: 'assertPlannerPolicyRuntimeHandoffCompatibility',
      graphRouteCompatibilityGuard: 'assertGraphPlannerRouteHandoffLayerEntrypointBoundaryCompatibility',
      graphExecutionAllowed: false,
      routeExecutionAllowed: false,
      siteAdapterInvocationEnabled: false,
      downloaderInvocationEnabled: false,
      sessionMaterializationEnabled: false,
      runtimeArtifactWriteEnabled: false,
      repoWriteEnabled: false,
      externalDispatchEnabled: false,
      statusPromotionEnabled: false,
      graphRoutePlan: summarizeGraphPlannerRouteHandoffForLayerRelationship(graphRouteHandoff),
      policyRuntimePath: summarizePlannerPolicyRuntimeHandoffForLayerRelationship(policyRuntimeHandoff),
    }],
  };
  assertGraphLayerPolicyPlannerRelationshipEvidenceCompatibility(evidence);
  return evidence;
}

export function assertGraphPlannerRuntimeIntegrationDesignCompatibility(design = {}) {
  assertPlainObject(design, 'GraphPlannerRuntimeIntegrationDesign');
  assertNoGraphPlannerRuntimeIntegrationProducts(design);
  assertNoPlannerSecrets(design, 'GraphPlannerRuntimeIntegrationDesign');
  if (design.schemaVersion !== GRAPH_QUERY_RESULT_SCHEMA_VERSION) {
    throw new Error(`GraphPlannerRuntimeIntegrationDesign schemaVersion ${design.schemaVersion ?? '<missing>'} is not compatible`);
  }
  if (design.queryName !== 'createGraphPlannerRuntimeIntegrationDesign') {
    throw new Error('GraphPlannerRuntimeIntegrationDesign queryName must be createGraphPlannerRuntimeIntegrationDesign');
  }
  if (design.artifactFamily !== 'site-capability-graph-planner-runtime-integration-design') {
    throw new Error('GraphPlannerRuntimeIntegrationDesign artifactFamily must be site-capability-graph-planner-runtime-integration-design');
  }
  if (design.redactionRequired !== true) {
    throw new Error('GraphPlannerRuntimeIntegrationDesign redactionRequired must be true');
  }
  if (!Array.isArray(design.items) || design.items.length === 0) {
    throw new Error('GraphPlannerRuntimeIntegrationDesign items are required');
  }
  for (const [index, item] of design.items.entries()) {
    assertPlainObject(item, `GraphPlannerRuntimeIntegrationDesign.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`GraphPlannerRuntimeIntegrationDesign item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.integrationMode !== 'design-only') {
      throw new Error('GraphPlannerRuntimeIntegrationDesign integrationMode must be design-only');
    }
    if (item.executionAllowed !== false) {
      throw new Error('GraphPlannerRuntimeIntegrationDesign executionAllowed must be false');
    }
    for (const fieldName of [
      'liveRouteExecutionEnabled',
      'siteAdapterInvocationEnabled',
      'downloaderInvocationEnabled',
      'sessionMaterializationEnabled',
      'runtimeArtifactWriteEnabled',
      'externalDispatchEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`GraphPlannerRuntimeIntegrationDesign ${fieldName} must be false`);
      }
    }
    if (item.requiredPreflightGuard !== GRAPH_PLANNER_REQUIRED_PREFLIGHT_GUARD) {
      throw new Error('GraphPlannerRuntimeIntegrationDesign requiredPreflightGuard is not compatible');
    }
    assertGraphPlannerRuntimeSourcePreflightSummaryCompatibility(
      item.sourcePreflight,
      `GraphPlannerRuntimeIntegrationDesign.items[${index}].sourcePreflight`,
    );
    assertPlainObject(item.handoff, `GraphPlannerRuntimeIntegrationDesign.items[${index}].handoff`);
    assertGraphPlannerRouteHandoffConsumerCompatibility(item.handoff);
  }
  assertNoForbiddenPatterns(design);
  return true;
}

export function createGraphPlannerRuntimeIntegrationDesign(options = {}) {
  assertPlainObject(options, 'GraphPlannerRuntimeIntegrationDesignOptions');
  assertNoGraphPlannerRuntimeIntegrationProducts(options, 'GraphPlannerRuntimeIntegrationDesignOptions');
  assertNoPlannerSecrets(options, 'GraphPlannerRuntimeIntegrationDesignOptions');
  assertNoForbiddenPatterns(options);
  const {
    integrationName = 'site-capability-layer-graph-planner-runtime-design',
    liveRouteExecutionEnabled,
    siteAdapterInvocationEnabled,
    downloaderInvocationEnabled,
    sessionMaterializationEnabled,
    runtimeArtifactWriteEnabled,
    externalDispatchEnabled,
    preflightContract,
    sourcePreflight,
    ...handoffOptions
  } = options;
  const handoff = createGraphPlannerRouteHandoff(handoffOptions);
  const sourcePreflightSummary = sourcePreflight === undefined
    ? createGraphPlannerRuntimeSourcePreflightSummary({
      graphVersion: handoff.graphVersion,
      preflightContract,
    })
    : sourcePreflight;
  assertGraphPlannerRuntimeSourcePreflightSummaryCompatibility(
    sourcePreflightSummary,
    'GraphPlannerRuntimeIntegrationDesign sourcePreflight',
  );
  const design = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: handoff.graphVersion,
    queryName: 'createGraphPlannerRuntimeIntegrationDesign',
    artifactFamily: 'site-capability-graph-planner-runtime-integration-design',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      integrationName: normalizeText(integrationName)
        ?? 'site-capability-layer-graph-planner-runtime-design',
      integrationMode: 'design-only',
      layerEntryPoint: 'SiteCapabilityLayerPlanner',
      executionAllowed: false,
      liveRouteExecutionEnabled: assertDisabledFlag(
        liveRouteExecutionEnabled,
        'liveRouteExecutionEnabled',
        'GraphPlannerRuntimeIntegrationDesign',
      ),
      siteAdapterInvocationEnabled: assertDisabledFlag(
        siteAdapterInvocationEnabled,
        'siteAdapterInvocationEnabled',
        'GraphPlannerRuntimeIntegrationDesign',
      ),
      downloaderInvocationEnabled: assertDisabledFlag(
        downloaderInvocationEnabled,
        'downloaderInvocationEnabled',
        'GraphPlannerRuntimeIntegrationDesign',
      ),
      sessionMaterializationEnabled: assertDisabledFlag(
        sessionMaterializationEnabled,
        'sessionMaterializationEnabled',
        'GraphPlannerRuntimeIntegrationDesign',
      ),
      runtimeArtifactWriteEnabled: assertDisabledFlag(
        runtimeArtifactWriteEnabled,
        'runtimeArtifactWriteEnabled',
        'GraphPlannerRuntimeIntegrationDesign',
      ),
      externalDispatchEnabled: assertDisabledFlag(
        externalDispatchEnabled,
        'externalDispatchEnabled',
        'GraphPlannerRuntimeIntegrationDesign',
      ),
      requiredGuards: [
        'assertGraphPlannerVersionCompatibility',
        'assertGraphPlannerRouteHandoffConsumerCompatibility',
        GRAPH_PLANNER_REQUIRED_PREFLIGHT_GUARD,
        'SecurityGuard/Redaction before artifact writes',
        'Site Capability Layer planner before execution',
      ],
      requiredPreflightGuard: GRAPH_PLANNER_REQUIRED_PREFLIGHT_GUARD,
      sourcePreflight: sourcePreflightSummary,
      forbiddenRuntimeProducts: [
        'StandardTaskList',
        'DownloadPolicy',
        'SessionView',
        'SiteAdapterInvocation',
        'DownloaderInvocation',
        'LiveRouteExecution',
      ],
      handoff,
    }],
  };
  assertGraphPlannerRuntimeIntegrationDesignCompatibility(design);
  return design;
}

export function assertDisabledGraphPlannerRuntimeConsumerResultCompatibility(result = {}) {
  assertPlainObject(result, 'DisabledGraphPlannerRuntimeConsumerResult');
  assertNoGraphPlannerRuntimeIntegrationProducts(result, 'DisabledGraphPlannerRuntimeConsumerResult');
  assertNoPlannerSecrets(result, 'DisabledGraphPlannerRuntimeConsumerResult');
  if (result.schemaVersion !== GRAPH_QUERY_RESULT_SCHEMA_VERSION) {
    throw new Error(`DisabledGraphPlannerRuntimeConsumerResult schemaVersion ${result.schemaVersion ?? '<missing>'} is not compatible`);
  }
  if (result.queryName !== 'createDisabledGraphPlannerRuntimeConsumerResult') {
    throw new Error('DisabledGraphPlannerRuntimeConsumerResult queryName must be createDisabledGraphPlannerRuntimeConsumerResult');
  }
  if (result.artifactFamily !== 'site-capability-graph-planner-runtime-consumer-result') {
    throw new Error('DisabledGraphPlannerRuntimeConsumerResult artifactFamily must be site-capability-graph-planner-runtime-consumer-result');
  }
  if (result.redactionRequired !== true) {
    throw new Error('DisabledGraphPlannerRuntimeConsumerResult redactionRequired must be true');
  }
  if (!Array.isArray(result.items) || result.items.length === 0) {
    throw new Error('DisabledGraphPlannerRuntimeConsumerResult items are required');
  }
  for (const [index, item] of result.items.entries()) {
    assertPlainObject(item, `DisabledGraphPlannerRuntimeConsumerResult.items[${index}]`);
    if (item.schemaVersion !== 1) {
      throw new Error(`DisabledGraphPlannerRuntimeConsumerResult item schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.consumerMode !== 'disabled-feature-flag') {
      throw new Error('DisabledGraphPlannerRuntimeConsumerResult consumerMode must be disabled-feature-flag');
    }
    if (item.featureEnabled !== false) {
      throw new Error('DisabledGraphPlannerRuntimeConsumerResult featureEnabled must be false');
    }
    if (item.result !== 'blocked') {
      throw new Error('DisabledGraphPlannerRuntimeConsumerResult result must be blocked');
    }
    if (item.executionAllowed !== false) {
      throw new Error('DisabledGraphPlannerRuntimeConsumerResult executionAllowed must be false');
    }
    for (const fieldName of [
      'liveRouteExecutionEnabled',
      'siteAdapterInvocationEnabled',
      'downloaderInvocationEnabled',
      'sessionMaterializationEnabled',
      'runtimeArtifactWriteEnabled',
      'externalDispatchEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`DisabledGraphPlannerRuntimeConsumerResult ${fieldName} must be false`);
      }
    }
    const reasonCode = normalizeText(item.reasonCode);
    requireReasonCodeDefinition(reasonCode);
    if (reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`DisabledGraphPlannerRuntimeConsumerResult reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(item.reason, `DisabledGraphPlannerRuntimeConsumerResult.items[${index}].reason`);
    if (item.reason.code !== reasonCode) {
      throw new Error('DisabledGraphPlannerRuntimeConsumerResult reason code must match reasonCode');
    }
    assertPlainObject(item.sourceDesign, `DisabledGraphPlannerRuntimeConsumerResult.items[${index}].sourceDesign`);
    if (item.sourceDesign.queryName !== 'createGraphPlannerRuntimeIntegrationDesign') {
      throw new Error('DisabledGraphPlannerRuntimeConsumerResult sourceDesign queryName must be createGraphPlannerRuntimeIntegrationDesign');
    }
    if (item.sourceDesign.artifactFamily !== 'site-capability-graph-planner-runtime-integration-design') {
      throw new Error('DisabledGraphPlannerRuntimeConsumerResult sourceDesign artifactFamily must be site-capability-graph-planner-runtime-integration-design');
    }
    if (item.sourceDesign.requiredPreflightGuard !== GRAPH_PLANNER_REQUIRED_PREFLIGHT_GUARD) {
      throw new Error('DisabledGraphPlannerRuntimeConsumerResult sourceDesign requiredPreflightGuard is not compatible');
    }
    assertGraphPlannerRuntimeSourcePreflightSummaryCompatibility(
      item.sourcePreflight,
      `DisabledGraphPlannerRuntimeConsumerResult.items[${index}].sourcePreflight`,
    );
    assertPlainObject(item.handoff, `DisabledGraphPlannerRuntimeConsumerResult.items[${index}].handoff`);
    if (item.handoff.executionAllowed !== false) {
      throw new Error('DisabledGraphPlannerRuntimeConsumerResult handoff executionAllowed must be false');
    }
    if (item.handoff.result === 'blocked' && !normalizeText(item.handoff.reasonCode)) {
      throw new Error('DisabledGraphPlannerRuntimeConsumerResult blocked handoff reasonCode is required');
    }
    if (item.handoff.reasonCode === 'graph-route-forbidden-by-risk' && !normalizeText(item.handoff.riskState)) {
      throw new Error('DisabledGraphPlannerRuntimeConsumerResult blocked risk handoff riskState is required');
    }
    if (
      item.handoff.riskState !== undefined
      && item.handoff.riskState !== null
      && !normalizeText(item.handoff.riskState)
    ) {
      throw new Error('DisabledGraphPlannerRuntimeConsumerResult handoff riskState must be a non-empty string when present');
    }
    if (item.sourceHandoffReasonCode !== (item.handoff.reasonCode ?? 'graph-planner-context-unsatisfied')) {
      throw new Error('DisabledGraphPlannerRuntimeConsumerResult sourceHandoffReasonCode must preserve handoff reasonCode');
    }
  }
  assertNoForbiddenPatterns(result);
  return true;
}

export function createDisabledGraphPlannerRuntimeConsumerResult(design = {}, options = {}) {
  assertGraphPlannerRuntimeIntegrationDesignCompatibility(design);
  assertPlainObject(options, 'DisabledGraphPlannerRuntimeConsumerOptions');
  assertNoGraphPlannerRuntimeIntegrationProducts(options, 'DisabledGraphPlannerRuntimeConsumerOptions');
  assertNoPlannerSecrets(options, 'DisabledGraphPlannerRuntimeConsumerOptions');
  assertNoForbiddenPatterns(options);
  const {
    consumerName = 'site-capability-layer-graph-planner-runtime-consumer',
    featureEnabled,
    liveRouteExecutionEnabled,
    siteAdapterInvocationEnabled,
    downloaderInvocationEnabled,
    sessionMaterializationEnabled,
    runtimeArtifactWriteEnabled,
    externalDispatchEnabled,
  } = options;
  assertDisabledFlag(
    liveRouteExecutionEnabled,
    'liveRouteExecutionEnabled',
    'DisabledGraphPlannerRuntimeConsumerResult',
  );
  assertDisabledFlag(
    siteAdapterInvocationEnabled,
    'siteAdapterInvocationEnabled',
    'DisabledGraphPlannerRuntimeConsumerResult',
  );
  assertDisabledFlag(
    downloaderInvocationEnabled,
    'downloaderInvocationEnabled',
    'DisabledGraphPlannerRuntimeConsumerResult',
  );
  assertDisabledFlag(
    sessionMaterializationEnabled,
    'sessionMaterializationEnabled',
    'DisabledGraphPlannerRuntimeConsumerResult',
  );
  assertDisabledFlag(
    runtimeArtifactWriteEnabled,
    'runtimeArtifactWriteEnabled',
    'DisabledGraphPlannerRuntimeConsumerResult',
  );
  assertDisabledFlag(
    externalDispatchEnabled,
    'externalDispatchEnabled',
    'DisabledGraphPlannerRuntimeConsumerResult',
  );
  const sourceItem = design.items[0];
  const handoff = sourceItem.handoff;
  const sourceHandoffReasonCode = normalizeText(handoff.reasonCode) ?? 'graph-planner-context-unsatisfied';
  const reasonDefinition = requireReasonCodeDefinition(GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE, {
    family: 'graph',
  });
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: design.graphVersion,
    queryName: 'createDisabledGraphPlannerRuntimeConsumerResult',
    artifactFamily: 'site-capability-graph-planner-runtime-consumer-result',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      consumerName: normalizeText(consumerName)
        ?? 'site-capability-layer-graph-planner-runtime-consumer',
      consumerMode: 'disabled-feature-flag',
      featureFlag: 'siteCapabilityGraphPlannerRuntimeEnabled',
      featureEnabled: assertDisabledFlag(
        featureEnabled,
        'featureEnabled',
        'DisabledGraphPlannerRuntimeConsumerResult',
      ),
      result: 'blocked',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: {
        code: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
        message: 'Graph planner runtime consumer is disabled by feature flag',
        retryable: reasonDefinition.retryable,
        cooldownNeeded: reasonDefinition.cooldownNeeded,
        isolationNeeded: reasonDefinition.isolationNeeded,
        manualRecoveryNeeded: reasonDefinition.manualRecoveryNeeded,
        artifactWriteAllowed: reasonDefinition.artifactWriteAllowed,
      },
      sourceHandoffReasonCode,
      executionAllowed: false,
      liveRouteExecutionEnabled: false,
      siteAdapterInvocationEnabled: false,
      downloaderInvocationEnabled: false,
      sessionMaterializationEnabled: false,
      runtimeArtifactWriteEnabled: false,
      externalDispatchEnabled: false,
      sourceDesign: {
        queryName: design.queryName,
        artifactFamily: design.artifactFamily,
        integrationMode: sourceItem.integrationMode,
        requiredPreflightGuard: sourceItem.requiredPreflightGuard,
      },
      sourcePreflight: sourceItem.sourcePreflight,
      handoff: {
        handoffKind: handoff.handoffKind,
        graphVersion: handoff.graphVersion,
        result: handoff.result,
        reasonCode: handoff.reasonCode,
        riskState: handoff.riskState ?? null,
        routeId: handoff.route?.id ?? null,
        executionAllowed: handoff.executionAllowed,
      },
    }],
  };
  assertDisabledGraphPlannerRuntimeConsumerResultCompatibility(result);
  return result;
}

export function assertGraphPlannerLayerEntrypointHandoffGuardCompatibility(guard = {}) {
  assertPlainObject(guard, 'GraphPlannerLayerEntrypointHandoffGuard');
  assertNoGraphPlannerLayerEntrypointHandoffRuntimeFields(guard);
  assertNoGraphPlannerRuntimeIntegrationProducts(guard, 'GraphPlannerLayerEntrypointHandoffGuard');
  assertNoPlannerSecrets(guard, 'GraphPlannerLayerEntrypointHandoffGuard');
  assertNoForbiddenPatterns(guard);
  if (guard.schemaVersion !== GRAPH_QUERY_RESULT_SCHEMA_VERSION) {
    throw new Error(`GraphPlannerLayerEntrypointHandoffGuard schemaVersion ${guard.schemaVersion ?? '<missing>'} is not compatible`);
  }
  if (guard.queryName !== 'createGraphPlannerLayerEntrypointHandoffGuard') {
    throw new Error('GraphPlannerLayerEntrypointHandoffGuard queryName must be createGraphPlannerLayerEntrypointHandoffGuard');
  }
  if (guard.artifactFamily !== 'site-capability-graph-planner-layer-entrypoint-handoff-guard') {
    throw new Error('GraphPlannerLayerEntrypointHandoffGuard artifactFamily must be site-capability-graph-planner-layer-entrypoint-handoff-guard');
  }
  if (guard.redactionRequired !== true) {
    throw new Error('GraphPlannerLayerEntrypointHandoffGuard redactionRequired must be true');
  }
  if (!Array.isArray(guard.items) || guard.items.length === 0) {
    throw new Error('GraphPlannerLayerEntrypointHandoffGuard items are required');
  }
  for (const [index, item] of guard.items.entries()) {
    const itemLabel = `GraphPlannerLayerEntrypointHandoffGuard.items[${index}]`;
    assertPlainObject(item, itemLabel);
    if (item.schemaVersion !== 1) {
      throw new Error(`${itemLabel} schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.guardMode !== 'descriptor-only') {
      throw new Error(`${itemLabel} guardMode must be descriptor-only`);
    }
    if (item.result !== 'blocked') {
      throw new Error(`${itemLabel} result must be blocked`);
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`${itemLabel} reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(item.reason, `${itemLabel}.reason`);
    if (item.reason.code !== item.reasonCode) {
      throw new Error(`${itemLabel} reason code must match reasonCode`);
    }
    if (item.layerEntrypoint !== 'SiteCapabilityLayerPlanner') {
      throw new Error(`${itemLabel} layerEntrypoint must remain SiteCapabilityLayerPlanner`);
    }
    if (item.blockedEntrypoint !== 'GraphPlannerRuntimeConsumer') {
      throw new Error(`${itemLabel} blockedEntrypoint must be GraphPlannerRuntimeConsumer`);
    }
    if (item.requiredPreflightGuard !== GRAPH_PLANNER_REQUIRED_PREFLIGHT_GUARD) {
      throw new Error(`${itemLabel} requiredPreflightGuard is not compatible`);
    }
    if (
      item.requiredDisabledRuntimeConsumerGuard
        !== 'assertDisabledGraphPlannerRuntimeConsumerResultCompatibility'
    ) {
      throw new Error(`${itemLabel} requiredDisabledRuntimeConsumerGuard is not compatible`);
    }
    if (
      item.requiredDesignGuard !== undefined
      && item.requiredDesignGuard !== 'assertGraphPlannerRuntimeIntegrationDesignCompatibility'
    ) {
      throw new Error(`${itemLabel} requiredDesignGuard is not compatible`);
    }
    assertPlainObject(item.requiredGuards, `${itemLabel}.requiredGuards`);
    if (item.requiredGuards.preflightGuard !== GRAPH_PLANNER_REQUIRED_PREFLIGHT_GUARD) {
      throw new Error(`${itemLabel} requiredGuards.preflightGuard is not compatible`);
    }
    if (
      item.requiredGuards.runtimeConsumerGuard
        !== 'assertDisabledGraphPlannerRuntimeConsumerResultCompatibility'
      && item.requiredGuards.disabledRuntimeConsumerGuard
        !== 'assertDisabledGraphPlannerRuntimeConsumerResultCompatibility'
    ) {
      throw new Error(`${itemLabel} requiredGuards.runtimeConsumerGuard is not compatible`);
    }
    if (
      item.requiredGuards.handoffGuard
        !== 'assertGraphPlannerLayerEntrypointHandoffGuardCompatibility'
    ) {
      throw new Error(`${itemLabel} requiredGuards.handoffGuard is not compatible`);
    }
    for (const fieldName of GRAPH_PLANNER_LAYER_ENTRYPOINT_HANDOFF_DISABLED_FLAG_KEYS) {
      if (item[fieldName] !== false) {
        throw new Error(`${itemLabel} ${fieldName} must be false`);
      }
    }
    assertGraphPlannerRuntimeSourcePreflightSummaryCompatibility(
      item.sourcePreflight,
      `${itemLabel}.sourcePreflight`,
    );
    assertPlainObject(
      item.sourceRuntimeConsumer ?? item.sourceDisabledRuntimeConsumer,
      `${itemLabel}.sourceRuntimeConsumer`,
    );
    if (
      (item.sourceRuntimeConsumer ?? item.sourceDisabledRuntimeConsumer).queryName
        !== 'createDisabledGraphPlannerRuntimeConsumerResult'
    ) {
      throw new Error(`${itemLabel}.sourceRuntimeConsumer queryName is not compatible`);
    }
    if (
      (item.sourceRuntimeConsumer ?? item.sourceDisabledRuntimeConsumer).artifactFamily
        !== 'site-capability-graph-planner-runtime-consumer-result'
    ) {
      throw new Error(`${itemLabel}.sourceRuntimeConsumer artifactFamily is not compatible`);
    }
    if ((item.sourceRuntimeConsumer ?? item.sourceDisabledRuntimeConsumer).result !== 'blocked') {
      throw new Error(`${itemLabel}.sourceRuntimeConsumer result must be blocked`);
    }
    if (
      (item.sourceRuntimeConsumer ?? item.sourceDisabledRuntimeConsumer).reasonCode
        !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE
    ) {
      throw new Error(`${itemLabel}.sourceRuntimeConsumer reasonCode is not compatible`);
    }
    if (item.sourceDesign !== undefined) {
      assertPlainObject(item.sourceDesign, `${itemLabel}.sourceDesign`);
      if (item.sourceDesign.queryName !== 'createGraphPlannerRuntimeIntegrationDesign') {
        throw new Error(`${itemLabel}.sourceDesign queryName is not compatible`);
      }
      if (
        item.sourceDesign.artifactFamily
          !== 'site-capability-graph-planner-runtime-integration-design'
      ) {
        throw new Error(`${itemLabel}.sourceDesign artifactFamily is not compatible`);
      }
      if (item.sourceDesign.integrationMode !== 'design-only') {
        throw new Error(`${itemLabel}.sourceDesign integrationMode must be design-only`);
      }
    }
    if (!Array.isArray(item.forbiddenRuntimeFields) || item.forbiddenRuntimeFields.length === 0) {
      throw new Error(`${itemLabel} forbiddenRuntimeFields are required`);
    }
  }
  return true;
}

export function createGraphPlannerLayerEntrypointHandoffGuard(sources = {}, options = {}) {
  assertPlainObject(sources, 'GraphPlannerLayerEntrypointHandoffGuardSources');
  assertPlainObject(options, 'GraphPlannerLayerEntrypointHandoffGuardOptions');
  assertNoGraphPlannerLayerEntrypointHandoffSourceRuntimeFields(
    sources,
    'GraphPlannerLayerEntrypointHandoffGuardSources',
  );
  assertNoPlannerSecrets(sources, 'GraphPlannerLayerEntrypointHandoffGuardSources');
  assertNoForbiddenPatterns(sources);
  assertNoGraphPlannerLayerEntrypointHandoffRuntimeFields(
    options,
    'GraphPlannerLayerEntrypointHandoffGuardOptions',
  );
  assertNoGraphPlannerRuntimeIntegrationProducts(
    options,
    'GraphPlannerLayerEntrypointHandoffGuardOptions',
  );
  assertNoPlannerSecrets(options, 'GraphPlannerLayerEntrypointHandoffGuardOptions');
  assertNoForbiddenPatterns(options);
  assertGraphPlannerLayerEntrypointHandoffDisabledOptions(options);
  const preflight = selectGraphPlannerLayerEntrypointHandoffSourceAlias({
    sources,
    aliases: ['sourcePreflight', 'preflight'],
    label: 'GraphPlannerLayerEntrypointHandoffGuard preflight',
    assertCompatibility: assertFutureGraphLayerConsumerPreflightCompatibility,
  });
  const sourceRuntimeConsumer = selectGraphPlannerLayerEntrypointHandoffSourceAlias({
    sources,
    aliases: ['disabledRuntimeConsumer', 'runtimeConsumerResult', 'sourceRuntimeConsumer'],
    label: 'GraphPlannerLayerEntrypointHandoffGuard runtimeConsumer',
    assertCompatibility: assertDisabledGraphPlannerRuntimeConsumerResultCompatibility,
  });
  const sourceDesign = selectGraphPlannerLayerEntrypointHandoffSourceAlias({
    sources,
    aliases: ['plannerRuntimeDesign', 'runtimeDesign', 'sourceDesign'],
    label: 'GraphPlannerLayerEntrypointHandoffGuard runtimeDesign',
    required: false,
    assertCompatibility: assertGraphPlannerRuntimeIntegrationDesignCompatibility,
  });
  const {
    handoffName,
    guardName = handoffName ?? 'site-capability-graph-planner-layer-entrypoint-handoff-guard',
  } = options;
  const sourceConsumerItem = sourceRuntimeConsumer.items[0];
  const disabledFlags = Object.fromEntries(
    GRAPH_PLANNER_LAYER_ENTRYPOINT_HANDOFF_DISABLED_FLAG_KEYS
      .map((fieldName) => [fieldName, false]),
  );
  const reasonDefinition = requireReasonCodeDefinition(GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE, {
    family: 'graph',
  });
  const result = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: preflight.graphVersion,
    queryName: 'createGraphPlannerLayerEntrypointHandoffGuard',
    artifactFamily: 'site-capability-graph-planner-layer-entrypoint-handoff-guard',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      guardName: normalizeText(guardName)
        ?? 'site-capability-graph-planner-layer-entrypoint-handoff-guard',
      guardMode: 'descriptor-only',
      result: 'blocked',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: {
        code: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
        message: 'Graph planner handoff remains a descriptor-only boundary and cannot replace the Layer execution entrypoint',
        retryable: reasonDefinition.retryable,
        cooldownNeeded: reasonDefinition.cooldownNeeded,
        isolationNeeded: reasonDefinition.isolationNeeded,
        manualRecoveryNeeded: reasonDefinition.manualRecoveryNeeded,
        artifactWriteAllowed: reasonDefinition.artifactWriteAllowed,
      },
      layerEntrypoint: 'SiteCapabilityLayerPlanner',
      blockedEntrypoint: 'GraphPlannerRuntimeConsumer',
      consumerName: sourceConsumerItem.consumerName,
      requiredPreflightGuard: GRAPH_PLANNER_REQUIRED_PREFLIGHT_GUARD,
      requiredDisabledRuntimeConsumerGuard:
        'assertDisabledGraphPlannerRuntimeConsumerResultCompatibility',
      requiredRuntimeConsumerGuard:
        'assertDisabledGraphPlannerRuntimeConsumerResultCompatibility',
      requiredDesignGuard: sourceDesign === undefined
        ? undefined
        : 'assertGraphPlannerRuntimeIntegrationDesignCompatibility',
      requiredHandoffGuard:
        'assertGraphPlannerLayerEntrypointHandoffGuardCompatibility',
      requiredGuards: {
        preflightGuard: GRAPH_PLANNER_REQUIRED_PREFLIGHT_GUARD,
        runtimeConsumerGuard: 'assertDisabledGraphPlannerRuntimeConsumerResultCompatibility',
        disabledRuntimeConsumerGuard:
          'assertDisabledGraphPlannerRuntimeConsumerResultCompatibility',
        handoffGuard: 'assertGraphPlannerLayerEntrypointHandoffGuardCompatibility',
      },
      sourcePreflight: summarizeFutureGraphLayerConsumerPreflight(preflight),
      sourceRuntimeConsumer:
        summarizeDisabledGraphPlannerRuntimeConsumerResult(sourceRuntimeConsumer),
      sourceDesign: sourceDesign === undefined
        ? undefined
        : summarizeGraphPlannerRuntimeIntegrationDesignForEntrypointGuard(sourceDesign),
      forbiddenRuntimeFields: [
        'executionRoute',
        'graphExecution',
        'runtimeExecution',
        'layerEntrypointReplacement',
        'siteAdapterInvocation',
        'downloaderInvocation',
        'sessionMaterialization',
        'runtimeArtifactWrite',
        'repoWrite',
        'externalDispatch',
        'runtimeProductMaterialization',
      ],
      ...disabledFlags,
    }],
  };
  assertGraphPlannerLayerEntrypointHandoffGuardCompatibility(result);
  return result;
}

export function assertGraphPlannerLayerEntrypointHandoffSafeSummaryCompatibility(summary = {}) {
  assertPlainObject(summary, 'GraphPlannerLayerEntrypointHandoffSafeSummary');
  assertNoGraphPlannerLayerEntrypointHandoffSafeSummaryRuntimeFields(summary);
  assertNoGraphPlannerRuntimeIntegrationProducts(
    summary,
    'GraphPlannerLayerEntrypointHandoffSafeSummary',
  );
  assertNoPlannerSecrets(summary, 'GraphPlannerLayerEntrypointHandoffSafeSummary');
  assertNoForbiddenPatterns(summary);
  if (summary.schemaVersion !== GRAPH_QUERY_RESULT_SCHEMA_VERSION) {
    throw new Error(`GraphPlannerLayerEntrypointHandoffSafeSummary schemaVersion ${summary.schemaVersion ?? '<missing>'} is not compatible`);
  }
  if (summary.queryName !== 'createGraphPlannerLayerEntrypointHandoffSafeSummary') {
    throw new Error('GraphPlannerLayerEntrypointHandoffSafeSummary queryName must be createGraphPlannerLayerEntrypointHandoffSafeSummary');
  }
  if (
    summary.artifactFamily
      !== 'site-capability-graph-planner-layer-entrypoint-handoff-safe-summary'
  ) {
    throw new Error('GraphPlannerLayerEntrypointHandoffSafeSummary artifactFamily must be site-capability-graph-planner-layer-entrypoint-handoff-safe-summary');
  }
  if (summary.redactionRequired !== true) {
    throw new Error('GraphPlannerLayerEntrypointHandoffSafeSummary redactionRequired must be true');
  }
  if (!Array.isArray(summary.items) || summary.items.length === 0) {
    throw new Error('GraphPlannerLayerEntrypointHandoffSafeSummary items are required');
  }
  for (const [index, item] of summary.items.entries()) {
    const itemLabel = `GraphPlannerLayerEntrypointHandoffSafeSummary.items[${index}]`;
    assertPlainObject(item, itemLabel);
    if (item.schemaVersion !== 1) {
      throw new Error(`${itemLabel} schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.summaryMode !== 'descriptor-only') {
      throw new Error(`${itemLabel} summaryMode must be descriptor-only`);
    }
    if (item.result !== 'blocked') {
      throw new Error(`${itemLabel} result must be blocked`);
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`${itemLabel} reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    if (item.layerEntrypoint !== 'SiteCapabilityLayerPlanner') {
      throw new Error(`${itemLabel} layerEntrypoint must remain SiteCapabilityLayerPlanner`);
    }
    if (item.blockedEntrypoint !== 'GraphPlannerRuntimeConsumer') {
      throw new Error(`${itemLabel} blockedEntrypoint must be GraphPlannerRuntimeConsumer`);
    }
    if (item.graphVersion !== summary.graphVersion) {
      throw new Error(`${itemLabel} graphVersion must match summary graphVersion`);
    }
    assertPlainObject(item.sourceGuard, `${itemLabel}.sourceGuard`);
    if (item.sourceGuard.queryName !== 'createGraphPlannerLayerEntrypointHandoffGuard') {
      throw new Error(`${itemLabel}.sourceGuard queryName is not compatible`);
    }
    if (
      item.sourceGuard.artifactFamily
        !== 'site-capability-graph-planner-layer-entrypoint-handoff-guard'
    ) {
      throw new Error(`${itemLabel}.sourceGuard artifactFamily is not compatible`);
    }
    if (item.sourceGuard.redactionRequired !== true) {
      throw new Error(`${itemLabel}.sourceGuard redactionRequired must be true`);
    }
    if (item.sourceGuard.guardMode !== 'descriptor-only') {
      throw new Error(`${itemLabel}.sourceGuard guardMode must be descriptor-only`);
    }
    if (item.sourceGuard.result !== 'blocked') {
      throw new Error(`${itemLabel}.sourceGuard result must be blocked`);
    }
    if (item.sourceGuard.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`${itemLabel}.sourceGuard reasonCode is not compatible`);
    }
    if (item.sourceGuard.graphVersion !== summary.graphVersion) {
      throw new Error(`${itemLabel}.sourceGuard graphVersion must match summary graphVersion`);
    }
    if (item.sourceGuard.requiredHandoffGuard !== 'assertGraphPlannerLayerEntrypointHandoffGuardCompatibility') {
      throw new Error(`${itemLabel}.sourceGuard requiredHandoffGuard is not compatible`);
    }
    assertPlainObject(item.sourceGuard.sourcePreflight, `${itemLabel}.sourceGuard.sourcePreflight`);
    if (item.sourceGuard.sourcePreflight.queryName !== GRAPH_PLANNER_SOURCE_PREFLIGHT_QUERY_NAME) {
      throw new Error(`${itemLabel}.sourceGuard.sourcePreflight queryName is not compatible`);
    }
    if (
      item.sourceGuard.sourcePreflight.artifactFamily
        !== GRAPH_PLANNER_SOURCE_PREFLIGHT_ARTIFACT_FAMILY
    ) {
      throw new Error(`${itemLabel}.sourceGuard.sourcePreflight artifactFamily is not compatible`);
    }
    assertPlainObject(
      item.sourceGuard.sourceRuntimeConsumer,
      `${itemLabel}.sourceGuard.sourceRuntimeConsumer`,
    );
    if (
      item.sourceGuard.sourceRuntimeConsumer.queryName
        !== 'createDisabledGraphPlannerRuntimeConsumerResult'
    ) {
      throw new Error(`${itemLabel}.sourceGuard.sourceRuntimeConsumer queryName is not compatible`);
    }
    if (
      item.sourceGuard.sourceRuntimeConsumer.artifactFamily
        !== 'site-capability-graph-planner-runtime-consumer-result'
    ) {
      throw new Error(`${itemLabel}.sourceGuard.sourceRuntimeConsumer artifactFamily is not compatible`);
    }
    if (item.sourceGuard.sourceRuntimeConsumer.result !== 'blocked') {
      throw new Error(`${itemLabel}.sourceGuard.sourceRuntimeConsumer result must be blocked`);
    }
    if (
      item.sourceGuard.sourceRuntimeConsumer.reasonCode
        !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE
    ) {
      throw new Error(`${itemLabel}.sourceGuard.sourceRuntimeConsumer reasonCode is not compatible`);
    }
  }
  return true;
}

export function createGraphPlannerLayerEntrypointHandoffSafeSummary(guard = {}) {
  assertNoGraphPlannerLayerEntrypointHandoffSafeSummaryRuntimeFields(
    guard,
    'GraphPlannerLayerEntrypointHandoffSafeSummary sourceGuard',
    { allowSourceRuntimeConsumerHandoffSummary: true },
  );
  assertGraphPlannerLayerEntrypointHandoffGuardCompatibility(guard);
  const sourceItem = guard.items[0];
  const sourceRuntimeConsumer = sourceItem.sourceRuntimeConsumer
    ?? sourceItem.sourceDisabledRuntimeConsumer;
  const summary = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: guard.graphVersion,
    queryName: 'createGraphPlannerLayerEntrypointHandoffSafeSummary',
    artifactFamily: 'site-capability-graph-planner-layer-entrypoint-handoff-safe-summary',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      summaryMode: 'descriptor-only',
      result: 'blocked',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      layerEntrypoint: sourceItem.layerEntrypoint,
      blockedEntrypoint: sourceItem.blockedEntrypoint,
      graphVersion: guard.graphVersion,
      sourceGuard: {
        queryName: guard.queryName,
        artifactFamily: guard.artifactFamily,
        graphVersion: guard.graphVersion,
        redactionRequired: guard.redactionRequired,
        guardName: sourceItem.guardName,
        guardMode: sourceItem.guardMode,
        result: sourceItem.result,
        reasonCode: sourceItem.reasonCode,
        requiredHandoffGuard: sourceItem.requiredHandoffGuard,
        sourcePreflight: {
          queryName: sourceItem.sourcePreflight.queryName,
          artifactFamily: sourceItem.sourcePreflight.artifactFamily,
          graphVersion: sourceItem.sourcePreflight.graphVersion,
          result: sourceItem.sourcePreflight.result,
          reasonCode: sourceItem.sourcePreflight.reasonCode,
        },
        sourceRuntimeConsumer: {
          queryName: sourceRuntimeConsumer.queryName,
          artifactFamily: sourceRuntimeConsumer.artifactFamily,
          graphVersion: sourceRuntimeConsumer.graphVersion,
          result: sourceRuntimeConsumer.result,
          reasonCode: sourceRuntimeConsumer.reasonCode,
        },
      },
    }],
  };
  assertGraphPlannerLayerEntrypointHandoffSafeSummaryCompatibility(summary);
  return summary;
}

export function assertGraphPlannerLayerEntrypointLiveExecutionDenialGuardCompatibility(guard = {}) {
  assertPlainObject(guard, 'GraphPlannerLayerEntrypointLiveExecutionDenialGuard');
  assertNoGraphPlannerLayerEntrypointLiveExecutionDenialGuardRuntimeFields(guard);
  assertNoPlannerSecrets(guard, 'GraphPlannerLayerEntrypointLiveExecutionDenialGuard');
  assertNoForbiddenPatterns(guard);
  if (guard.schemaVersion !== GRAPH_QUERY_RESULT_SCHEMA_VERSION) {
    throw new Error(`GraphPlannerLayerEntrypointLiveExecutionDenialGuard schemaVersion ${guard.schemaVersion ?? '<missing>'} is not compatible`);
  }
  if (guard.queryName !== 'createGraphPlannerLayerEntrypointLiveExecutionDenialGuard') {
    throw new Error('GraphPlannerLayerEntrypointLiveExecutionDenialGuard queryName must be createGraphPlannerLayerEntrypointLiveExecutionDenialGuard');
  }
  if (guard.artifactFamily !== GRAPH_PLANNER_LAYER_ENTRYPOINT_LIVE_EXECUTION_DENIAL_GUARD_ARTIFACT_FAMILY) {
    throw new Error(`GraphPlannerLayerEntrypointLiveExecutionDenialGuard artifactFamily must be ${GRAPH_PLANNER_LAYER_ENTRYPOINT_LIVE_EXECUTION_DENIAL_GUARD_ARTIFACT_FAMILY}`);
  }
  if (guard.redactionRequired !== true) {
    throw new Error('GraphPlannerLayerEntrypointLiveExecutionDenialGuard redactionRequired must be true');
  }
  if (!Array.isArray(guard.items) || guard.items.length === 0) {
    throw new Error('GraphPlannerLayerEntrypointLiveExecutionDenialGuard items are required');
  }
  for (const [index, item] of guard.items.entries()) {
    const itemLabel = `GraphPlannerLayerEntrypointLiveExecutionDenialGuard.items[${index}]`;
    assertPlainObject(item, itemLabel);
    if (item.schemaVersion !== 1) {
      throw new Error(`${itemLabel} schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.guardMode !== 'descriptor-only') {
      throw new Error(`${itemLabel} guardMode must be descriptor-only`);
    }
    if (item.result !== 'blocked') {
      throw new Error(`${itemLabel} result must be blocked`);
    }
    if (item.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`${itemLabel} reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    assertPlainObject(item.reason, `${itemLabel}.reason`);
    if (item.reason.code !== item.reasonCode) {
      throw new Error(`${itemLabel} reason code must match reasonCode`);
    }
    if (item.layerEntrypoint !== 'SiteCapabilityLayerPlanner') {
      throw new Error(`${itemLabel} layerEntrypoint must remain SiteCapabilityLayerPlanner`);
    }
    if (item.blockedExecution !== 'LiveGraphPlannerRuntimeExecution') {
      throw new Error(`${itemLabel} blockedExecution must be LiveGraphPlannerRuntimeExecution`);
    }
    if (item.graphVersion !== guard.graphVersion) {
      throw new Error(`${itemLabel} graphVersion must match guard graphVersion`);
    }
    if (
      item.requiredSourceSummaryGuard
        !== 'assertGraphPlannerLayerEntrypointHandoffSafeSummaryCompatibility'
    ) {
      throw new Error(`${itemLabel} requiredSourceSummaryGuard is not compatible`);
    }
    if (
      item.requiredLiveExecutionDenialGuard
        !== 'assertGraphPlannerLayerEntrypointLiveExecutionDenialGuardCompatibility'
    ) {
      throw new Error(`${itemLabel} requiredLiveExecutionDenialGuard is not compatible`);
    }
    for (const fieldName of GRAPH_PLANNER_LAYER_ENTRYPOINT_LIVE_EXECUTION_DENIAL_GUARD_DISABLED_FLAG_KEYS) {
      if (item[fieldName] !== false) {
        throw new Error(`${itemLabel} ${fieldName} must be false`);
      }
    }
    if (!Array.isArray(item.deniedBoundaries)) {
      throw new Error(`${itemLabel} deniedBoundaries are required`);
    }
    for (const boundary of GRAPH_PLANNER_LAYER_ENTRYPOINT_LIVE_EXECUTION_DENIAL_GUARD_BOUNDARIES) {
      if (!item.deniedBoundaries.includes(boundary)) {
        throw new Error(`${itemLabel} deniedBoundaries must include ${boundary}`);
      }
    }
    assertPlainObject(item.sourceSafeSummary, `${itemLabel}.sourceSafeSummary`);
    if (item.sourceSafeSummary.queryName !== 'createGraphPlannerLayerEntrypointHandoffSafeSummary') {
      throw new Error(`${itemLabel}.sourceSafeSummary queryName is not compatible`);
    }
    if (
      item.sourceSafeSummary.artifactFamily
        !== 'site-capability-graph-planner-layer-entrypoint-handoff-safe-summary'
    ) {
      throw new Error(`${itemLabel}.sourceSafeSummary artifactFamily is not compatible`);
    }
    if (item.sourceSafeSummary.redactionRequired !== true) {
      throw new Error(`${itemLabel}.sourceSafeSummary redactionRequired must be true`);
    }
    if (item.sourceSafeSummary.summaryMode !== 'descriptor-only') {
      throw new Error(`${itemLabel}.sourceSafeSummary summaryMode must be descriptor-only`);
    }
    if (item.sourceSafeSummary.result !== 'blocked') {
      throw new Error(`${itemLabel}.sourceSafeSummary result must be blocked`);
    }
    if (item.sourceSafeSummary.reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`${itemLabel}.sourceSafeSummary reasonCode is not compatible`);
    }
    if (item.sourceSafeSummary.graphVersion !== guard.graphVersion) {
      throw new Error(`${itemLabel}.sourceSafeSummary graphVersion must match guard graphVersion`);
    }
  }
  return true;
}

export function createGraphPlannerLayerEntrypointLiveExecutionDenialGuard(sources = {}, options = {}) {
  const normalizedSources = sources?.queryName === 'createGraphPlannerLayerEntrypointHandoffSafeSummary'
    ? { safeSummary: sources }
    : sources;
  assertPlainObject(sources, 'GraphPlannerLayerEntrypointLiveExecutionDenialGuardSources');
  assertPlainObject(options, 'GraphPlannerLayerEntrypointLiveExecutionDenialGuardOptions');
  assertNoGraphPlannerLayerEntrypointLiveExecutionDenialGuardRuntimeFields(
    normalizedSources,
    'GraphPlannerLayerEntrypointLiveExecutionDenialGuardSources',
  );
  assertNoPlannerSecrets(normalizedSources, 'GraphPlannerLayerEntrypointLiveExecutionDenialGuardSources');
  assertNoForbiddenPatterns(normalizedSources);
  assertNoGraphPlannerLayerEntrypointLiveExecutionDenialGuardRuntimeFields(
    options,
    'GraphPlannerLayerEntrypointLiveExecutionDenialGuardOptions',
  );
  assertNoPlannerSecrets(options, 'GraphPlannerLayerEntrypointLiveExecutionDenialGuardOptions');
  assertNoForbiddenPatterns(options);
  assertGraphPlannerLayerEntrypointLiveExecutionDenialGuardDisabledOptions(options);
  const safeSummary = selectGraphPlannerLayerEntrypointHandoffSourceAlias({
    sources: normalizedSources,
    aliases: [
      'safeSummary',
      'sourceSafeSummary',
      'handoffSafeSummary',
      'sourceHandoffSafeSummary',
      'plannerLayerEntrypointHandoffSafeSummary',
      'sourcePlannerLayerEntrypointHandoffSafeSummary',
    ],
    label: 'GraphPlannerLayerEntrypointLiveExecutionDenialGuard safeSummary',
    assertCompatibility: assertGraphPlannerLayerEntrypointHandoffSafeSummaryCompatibility,
  });
  const {
    guardName = 'site-capability-graph-planner-layer-entrypoint-live-execution-denial-guard',
  } = options;
  const sourceItem = safeSummary.items[0];
  const reasonDefinition = requireReasonCodeDefinition(GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE, {
    family: 'graph',
  });
  const disabledFlags = Object.fromEntries(
    GRAPH_PLANNER_LAYER_ENTRYPOINT_LIVE_EXECUTION_DENIAL_GUARD_DISABLED_FLAG_KEYS
      .map((fieldName) => [fieldName, false]),
  );
  const guard = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: safeSummary.graphVersion,
    queryName: 'createGraphPlannerLayerEntrypointLiveExecutionDenialGuard',
    artifactFamily: GRAPH_PLANNER_LAYER_ENTRYPOINT_LIVE_EXECUTION_DENIAL_GUARD_ARTIFACT_FAMILY,
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      guardName: normalizeText(guardName)
        ?? 'site-capability-graph-planner-layer-entrypoint-live-execution-denial-guard',
      guardMode: 'descriptor-only',
      denialMode: 'descriptor-only',
      result: 'blocked',
      redactionRequired: true,
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: {
        code: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
        message: 'Graph planner layer entrypoint live execution remains disabled; this guard is descriptor-only and does not execute routes',
        retryable: reasonDefinition.retryable,
        cooldownNeeded: reasonDefinition.cooldownNeeded,
        isolationNeeded: reasonDefinition.isolationNeeded,
        manualRecoveryNeeded: reasonDefinition.manualRecoveryNeeded,
        artifactWriteAllowed: reasonDefinition.artifactWriteAllowed,
      },
      layerEntrypoint: 'SiteCapabilityLayerPlanner',
      blockedEntrypoint: 'GraphPlannerRuntimeConsumer',
      blockedExecution: 'LiveGraphPlannerRuntimeExecution',
      graphVersion: safeSummary.graphVersion,
      requiredSourceSummaryGuard:
        'assertGraphPlannerLayerEntrypointHandoffSafeSummaryCompatibility',
      requiredLiveExecutionDenialGuard:
        'assertGraphPlannerLayerEntrypointLiveExecutionDenialGuardCompatibility',
      sourceSafeSummary: {
        queryName: safeSummary.queryName,
        artifactFamily: safeSummary.artifactFamily,
        graphVersion: safeSummary.graphVersion,
        redactionRequired: safeSummary.redactionRequired,
        summaryMode: sourceItem.summaryMode,
        result: sourceItem.result,
        reasonCode: sourceItem.reasonCode,
        layerEntrypoint: sourceItem.layerEntrypoint,
        blockedEntrypoint: sourceItem.blockedEntrypoint,
      },
      sourceSummary: {
        queryName: safeSummary.queryName,
        artifactFamily: safeSummary.artifactFamily,
        graphVersion: safeSummary.graphVersion,
        redactionRequired: safeSummary.redactionRequired,
        summaryMode: sourceItem.summaryMode,
        result: sourceItem.result,
        reasonCode: sourceItem.reasonCode,
        layerEntrypoint: sourceItem.layerEntrypoint,
        blockedEntrypoint: sourceItem.blockedEntrypoint,
      },
      deniedBoundaries: [...GRAPH_PLANNER_LAYER_ENTRYPOINT_LIVE_EXECUTION_DENIAL_GUARD_BOUNDARIES],
      ...disabledFlags,
    }],
  };
  assertGraphPlannerLayerEntrypointLiveExecutionDenialGuardCompatibility(guard);
  return guard;
}

export function assertGraphPlannerRiskBlockingRuntimePreflightCompatibility(contract = {}) {
  assertPlainObject(contract, 'GraphPlannerRiskBlockingRuntimePreflightContract');
  assertNoGraphPlannerRiskBlockingRuntimeExecutionFields(contract);
  assertNoPlannerSecrets(contract, 'GraphPlannerRiskBlockingRuntimePreflightContract');
  if (contract.schemaVersion !== GRAPH_QUERY_RESULT_SCHEMA_VERSION) {
    throw new Error(`GraphPlannerRiskBlockingRuntimePreflightContract schemaVersion ${contract.schemaVersion ?? '<missing>'} is not compatible`);
  }
  if (contract.queryName !== 'createGraphPlannerRiskBlockingRuntimePreflightContract') {
    throw new Error('GraphPlannerRiskBlockingRuntimePreflightContract queryName must be createGraphPlannerRiskBlockingRuntimePreflightContract');
  }
  if (contract.artifactFamily !== 'site-capability-graph-planner-risk-blocking-runtime-preflight-contract') {
    throw new Error('GraphPlannerRiskBlockingRuntimePreflightContract artifactFamily must be site-capability-graph-planner-risk-blocking-runtime-preflight-contract');
  }
  if (contract.redactionRequired !== true) {
    throw new Error('GraphPlannerRiskBlockingRuntimePreflightContract redactionRequired must be true');
  }
  if (!Array.isArray(contract.items) || contract.items.length === 0) {
    throw new Error('GraphPlannerRiskBlockingRuntimePreflightContract items are required');
  }
  for (const [index, item] of contract.items.entries()) {
    const itemLabel = `GraphPlannerRiskBlockingRuntimePreflightContract.items[${index}]`;
    assertPlainObject(item, itemLabel);
    if (item.schemaVersion !== 1) {
      throw new Error(`${itemLabel} schemaVersion ${item.schemaVersion ?? '<missing>'} is not compatible`);
    }
    if (item.status !== 'disabled') {
      throw new Error(`${itemLabel} status must be disabled`);
    }
    if (item.contractMode !== 'contract-only') {
      throw new Error(`${itemLabel} contractMode must be contract-only`);
    }
    if (item.featureEnabled !== false) {
      throw new Error(`${itemLabel} featureEnabled must be false`);
    }
    if (item.result !== 'blocked') {
      throw new Error(`${itemLabel} result must be blocked`);
    }
    if (item.registrationStatus !== 'not-registered') {
      throw new Error(`${itemLabel} registrationStatus must be not-registered`);
    }
    if (item.executionAllowed !== false) {
      throw new Error(`${itemLabel} executionAllowed must be false`);
    }
    for (const fieldName of [
      'plannerRuntimeConsumerOwner',
      'riskPolicyGuardOwner',
    ]) {
      if (item[fieldName] !== 'disabled') {
        throw new Error(`${itemLabel} ${fieldName} must be disabled`);
      }
    }
    for (const fieldName of [
      'routeHandoffGate',
      'riskTransitionGate',
      'siteAdapterGate',
      'downloaderGate',
      'sessionMaterializationGate',
      'artifactWriteGate',
    ]) {
      if (item[fieldName] !== 'blocked') {
        throw new Error(`${itemLabel} ${fieldName} must be blocked`);
      }
    }
    for (const fieldName of [
      'routeHandoffEnabled',
      'riskTransitionEnabled',
      'siteAdapterInvocationEnabled',
      'downloaderInvocationEnabled',
      'sessionMaterializationEnabled',
      'artifactWriteEnabled',
      'repoWriteEnabled',
      'runtimeWriteEnabled',
      'externalDispatchEnabled',
    ]) {
      if (item[fieldName] !== false) {
        throw new Error(`${itemLabel} ${fieldName} must be false`);
      }
    }
    assertPlainObject(item.gates, `${itemLabel}.gates`);
    assertGraphPlannerRiskBlockingGateDescriptor(
      item.gates.plannerRuntimeConsumer,
      `${itemLabel}.gates.plannerRuntimeConsumer`,
      { enabled: false, status: 'disabled', result: 'blocked' },
    );
    assertGraphPlannerRiskBlockingGateDescriptor(
      item.gates.riskTransition,
      `${itemLabel}.gates.riskTransition`,
      { enabled: false, status: 'disabled', result: 'blocked' },
    );
    assertGraphPlannerRiskBlockingGateDescriptor(
      item.gates.routeExecution,
      `${itemLabel}.gates.routeExecution`,
      { enabled: false, status: 'disabled', result: 'blocked' },
    );
    assertGraphPlannerRiskBlockingGateDescriptor(
      item.gates.externalDispatch,
      `${itemLabel}.gates.externalDispatch`,
      { enabled: false, status: 'disabled', result: 'blocked' },
    );
    assertGraphPlannerRiskBlockingGateDescriptor(
      item.gates.siteAdapter,
      `${itemLabel}.gates.siteAdapter`,
      { enabled: false, registered: false, status: 'not-registered', result: 'blocked' },
    );
    assertGraphPlannerRiskBlockingGateDescriptor(
      item.gates.downloader,
      `${itemLabel}.gates.downloader`,
      { enabled: false, registered: false, status: 'not-registered', result: 'blocked' },
    );
    assertGraphPlannerRiskBlockingGateDescriptor(
      item.gates.sessionView,
      `${itemLabel}.gates.sessionView`,
      { enabled: false, materialized: false, status: 'disabled', result: 'blocked' },
    );
    assertGraphPlannerRiskBlockingGateDescriptor(
      item.gates.artifactWrites,
      `${itemLabel}.gates.artifactWrites`,
      { enabled: false, allowed: false, status: 'disabled', result: 'blocked' },
    );
    assertGraphPlannerRiskBlockingGateDescriptor(
      item.gates.repoWrites,
      `${itemLabel}.gates.repoWrites`,
      { enabled: false, allowed: false, status: 'disabled', result: 'blocked' },
    );
    assertGraphPlannerRiskBlockingGateDescriptor(
      item.gates.runtimeWrites,
      `${itemLabel}.gates.runtimeWrites`,
      { enabled: false, allowed: false, status: 'disabled', result: 'blocked' },
    );
    const reasonCode = normalizeText(item.reasonCode);
    if (reasonCode !== GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE) {
      throw new Error(`${itemLabel} reasonCode must be ${GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE}`);
    }
    const sourceHandoffReasonCode = normalizeText(item.sourceHandoffReasonCode);
    if (sourceHandoffReasonCode !== 'graph-route-forbidden-by-risk') {
      throw new Error(`${itemLabel} sourceHandoffReasonCode must preserve graph-route-forbidden-by-risk`);
    }
    if (!normalizeText(item.riskState)) {
      throw new Error(`${itemLabel} riskState is required for graph-route-forbidden-by-risk`);
    }
    assertPlainObject(item.sourceDesign, `${itemLabel}.sourceDesign`);
    if (item.sourceDesign.queryName !== 'createGraphPlannerRuntimeIntegrationDesign') {
      throw new Error(`${itemLabel}.sourceDesign queryName must be createGraphPlannerRuntimeIntegrationDesign`);
    }
    if (item.sourceDesign.artifactFamily !== 'site-capability-graph-planner-runtime-integration-design') {
      throw new Error(`${itemLabel}.sourceDesign artifactFamily must be site-capability-graph-planner-runtime-integration-design`);
    }
    assertGraphPlannerRuntimeSourcePreflightSummaryCompatibility(
      item.sourcePreflight,
      `${itemLabel}.sourcePreflight`,
    );
    assertPlainObject(item.handoff, `${itemLabel}.handoff`);
    if (item.handoff.result !== 'blocked') {
      throw new Error(`${itemLabel}.handoff result must be blocked`);
    }
    if (item.handoff.reasonCode !== sourceHandoffReasonCode) {
      throw new Error(`${itemLabel}.handoff reasonCode must match sourceHandoffReasonCode`);
    }
    if (item.handoff.riskState !== item.riskState) {
      throw new Error(`${itemLabel}.handoff riskState must match riskState`);
    }
    if (item.handoff.executionAllowed !== false) {
      throw new Error(`${itemLabel}.handoff executionAllowed must be false`);
    }
  }
  assertNoForbiddenPatterns(contract);
  return true;
}

export function createGraphPlannerRiskBlockingRuntimePreflightContract(design = {}, options = {}) {
  assertNoGraphPlannerRiskBlockingRuntimeExecutionFields(
    design,
    'GraphPlannerRiskBlockingRuntimePreflightContract sourceDesign',
  );
  assertGraphPlannerRuntimeIntegrationDesignCompatibility(design);
  assertPlainObject(options, 'GraphPlannerRiskBlockingRuntimePreflightOptions');
  assertNoGraphPlannerRiskBlockingRuntimeExecutionFields(
    options,
    'GraphPlannerRiskBlockingRuntimePreflightOptions',
  );
  assertNoPlannerSecrets(options, 'GraphPlannerRiskBlockingRuntimePreflightOptions');
  assertNoForbiddenPatterns(options);
  assertGraphPlannerRiskBlockingPreflightDisabledOptions(options);
  const {
    consumerName = 'site-capability-layer-graph-planner-risk-blocking-runtime-preflight',
  } = options;
  const sourceItem = design.items[0];
  const handoff = sourceItem.handoff;
  const sourceHandoffReasonCode = normalizeText(handoff.reasonCode);
  if (sourceHandoffReasonCode !== 'graph-route-forbidden-by-risk') {
    throw new Error('GraphPlannerRiskBlockingRuntimePreflightContract requires source handoff reasonCode graph-route-forbidden-by-risk');
  }
  const riskState = normalizeText(handoff.riskState);
  if (!riskState) {
    throw new Error('GraphPlannerRiskBlockingRuntimePreflightContract requires source handoff riskState');
  }
  const reasonDefinition = requireReasonCodeDefinition(GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE, {
    family: 'graph',
  });
  const contract = {
    schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION,
    graphVersion: design.graphVersion,
    queryName: 'createGraphPlannerRiskBlockingRuntimePreflightContract',
    artifactFamily: 'site-capability-graph-planner-risk-blocking-runtime-preflight-contract',
    redactionRequired: true,
    items: [{
      schemaVersion: 1,
      consumerName: normalizeText(consumerName)
        ?? 'site-capability-layer-graph-planner-risk-blocking-runtime-preflight',
      status: 'disabled',
      contractMode: 'contract-only',
      featureEnabled: false,
      result: 'blocked',
      registrationStatus: 'not-registered',
      reasonCode: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
      reason: {
        code: GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE,
        message: 'Graph planner risk-blocking runtime preflight is contract-only and not registered',
        retryable: reasonDefinition.retryable,
        cooldownNeeded: reasonDefinition.cooldownNeeded,
        isolationNeeded: reasonDefinition.isolationNeeded,
        manualRecoveryNeeded: reasonDefinition.manualRecoveryNeeded,
        artifactWriteAllowed: reasonDefinition.artifactWriteAllowed,
      },
      sourceHandoffReasonCode,
      riskState,
      executionAllowed: false,
      plannerRuntimeConsumerOwner: 'disabled',
      riskPolicyGuardOwner: 'disabled',
      routeHandoffGate: 'blocked',
      riskTransitionGate: 'blocked',
      siteAdapterGate: 'blocked',
      downloaderGate: 'blocked',
      sessionMaterializationGate: 'blocked',
      artifactWriteGate: 'blocked',
      routeHandoffEnabled: false,
      riskTransitionEnabled: false,
      siteAdapterInvocationEnabled: false,
      downloaderInvocationEnabled: false,
      sessionMaterializationEnabled: false,
      artifactWriteEnabled: false,
      repoWriteEnabled: false,
      runtimeWriteEnabled: false,
      externalDispatchEnabled: false,
      gates: {
        plannerRuntimeConsumer: {
          enabled: false,
          status: 'disabled',
          result: 'blocked',
        },
        riskTransition: {
          enabled: false,
          status: 'disabled',
          result: 'blocked',
        },
        routeExecution: {
          enabled: false,
          status: 'disabled',
          result: 'blocked',
        },
        externalDispatch: {
          enabled: false,
          status: 'disabled',
          result: 'blocked',
        },
        siteAdapter: {
          enabled: false,
          registered: false,
          status: 'not-registered',
          result: 'blocked',
        },
        downloader: {
          enabled: false,
          registered: false,
          status: 'not-registered',
          result: 'blocked',
        },
        sessionView: {
          enabled: false,
          materialized: false,
          status: 'disabled',
          result: 'blocked',
        },
        artifactWrites: {
          enabled: false,
          allowed: false,
          status: 'disabled',
          result: 'blocked',
        },
        repoWrites: {
          enabled: false,
          allowed: false,
          status: 'disabled',
          result: 'blocked',
        },
        runtimeWrites: {
          enabled: false,
          allowed: false,
          status: 'disabled',
          result: 'blocked',
        },
      },
      sourceDesign: {
        queryName: design.queryName,
        artifactFamily: design.artifactFamily,
        integrationMode: sourceItem.integrationMode,
        requiredPreflightGuard: sourceItem.requiredPreflightGuard,
      },
      sourcePreflight: sourceItem.sourcePreflight,
      handoff: {
        handoffKind: handoff.handoffKind,
        graphVersion: handoff.graphVersion,
        result: handoff.result,
        reasonCode: handoff.reasonCode,
        riskState,
        routeId: handoff.route?.id ?? null,
        executionAllowed: handoff.executionAllowed,
      },
    }],
  };
  assertGraphPlannerRiskBlockingRuntimePreflightCompatibility(contract);
  return contract;
}

export function createPlannerPolicyHandoff({
  catalogEntry,
  catalogUpgradeDecision,
  taskIntent = {},
  policy = {},
  healthRecovery,
} = {}) {
  assertPlainObject(catalogEntry, 'PlannerPolicyHandoff catalogEntry');
  assertPlainObject(taskIntent, 'PlannerPolicyHandoff taskIntent');
  assertPlainObject(policy, 'PlannerPolicyHandoff policy');
  assertGovernedSchemaCompatible('ApiCatalogEntry', catalogEntry);
  assertNoPlannerSecrets(catalogEntry, 'PlannerPolicyHandoff catalogEntry');
  assertNoPlannerSecrets(taskIntent, 'PlannerPolicyHandoff taskIntent');
  assertNoPlannerSecrets(policy, 'PlannerPolicyHandoff policy');

  if (catalogEntry.status !== 'cataloged') {
    throw new Error(`PlannerPolicyHandoff requires a cataloged ApiCatalogEntry: ${catalogEntry.status}`);
  }
  if ((catalogEntry.invalidationStatus ?? 'active') !== 'active') {
    throw new Error(`PlannerPolicyHandoff requires an active ApiCatalogEntry: ${catalogEntry.invalidationStatus}`);
  }
  const allowedCatalogGate = assertPlannerPolicyCatalogGate(catalogEntry, catalogUpgradeDecision);

  const siteKey = normalizeText(catalogEntry.siteKey);
  if (!siteKey) {
    throw new Error('PlannerPolicyHandoff catalogEntry.siteKey is required');
  }
  const taskSiteKey = normalizeText(taskIntent.siteKey);
  if (taskSiteKey && taskSiteKey !== siteKey) {
    throw new Error(`PlannerPolicyHandoff site mismatch: ${taskSiteKey} !== ${siteKey}`);
  }

  const taskType = normalizeText(taskIntent.taskType) ?? 'generic-resource';
  const endpoint = selectEndpoint(catalogEntry, taskIntent);
  if (!endpoint) {
    throw new Error('PlannerPolicyHandoff endpoint is required');
  }
  const policyRef = normalizeText(taskIntent.policyRef) ?? `download-policy:${siteKey}:${taskType}`;
  const downloadPolicy = normalizeDownloadPolicy({
    ...policy,
    siteKey,
    taskType,
    sessionRequirement: deriveSessionRequirement(catalogEntry, policy),
  });
  const taskList = normalizeStandardTaskList({
    siteKey,
    taskType,
    policyRef,
    items: applyPlannerHealthGate({
      healthRecovery,
      tasks: [{
      id: normalizeText(taskIntent.id) ?? catalogEntry.candidateId,
      kind: normalizeText(taskIntent.kind) ?? 'request',
      endpoint,
      method: selectMethod(catalogEntry, taskIntent),
      capability: normalizeText(taskIntent.capability ?? taskIntent.capabilityKey) ?? normalizeText(catalogEntry.capability) ?? taskType,
      mode: normalizeText(taskIntent.mode ?? taskIntent.accessMode ?? taskIntent.operationMode) ?? 'read',
      pagination: taskIntent.pagination ?? catalogEntry.pagination,
      retry: {
        retries: downloadPolicy.retries,
        retryBackoffMs: downloadPolicy.retryBackoffMs,
      },
      cacheKey: taskIntent.cacheKey,
      dedupKey: taskIntent.dedupKey,
      reasonCode: taskIntent.reasonCode ?? downloadPolicy.reasonCode,
    }],
    }),
  });
  assertPlannerPolicyHandoffWriterCompatibility({
    catalogEntry,
    downloadPolicy,
    taskList,
  });

  const handoff = {
    catalogEntryId: catalogEntry.candidateId,
    siteKey,
    taskType,
    catalogGate: summarizeCatalogGate(allowedCatalogGate),
    taskList,
    downloadPolicy,
  };
  assertPlannerPolicyRuntimeHandoffCompatibility(handoff);
  assertNoForbiddenPatterns(handoff);
  return handoff;
}

export async function writePlannerPolicyHandoffArtifact({
  catalogEntry,
  catalogUpgradeDecision,
  taskIntent = {},
  policy = {},
  healthRecovery,
} = {}, {
  handoffPath,
  redactionAuditPath,
} = {}) {
  const outputPath = normalizeText(handoffPath);
  if (!outputPath) {
    throw new Error('PlannerPolicyHandoff handoffPath is required');
  }
  const auditPath = normalizeText(redactionAuditPath);
  if (!auditPath) {
    throw new Error('PlannerPolicyHandoff redactionAuditPath is required');
  }

  let handoff;
  try {
    handoff = createPlannerPolicyHandoff({
      catalogEntry,
      catalogUpgradeDecision,
      taskIntent,
      policy,
      healthRecovery,
    });
  } catch (error) {
    if (isSchemaCompatibilityError(error)) {
      throw createSchemaCompatibilityFailure();
    }
    if (isDownloadPolicyGenerationError(error)) {
      throw createDownloadPolicyGenerationFailure();
    }
    throw error;
  }
  const prepared = prepareRedactedArtifactJsonWithAudit(handoff);
  await writeTextArtifact(outputPath, prepared.json);
  await writeTextArtifact(auditPath, prepared.auditJson);

  return {
    handoff: prepared.value,
    artifactPath: outputPath,
    redactionAuditPath: auditPath,
    redactionAudit: prepared.auditValue,
    redactionSummary: summarizeRedactionAudit(prepared.auditValue),
  };
}

export async function writeCatalogStorePlannerPolicyHandoffArtifact(storeResult = {}, {
  taskIntent = {},
  policy = {},
  healthRecovery,
} = {}, paths = {}) {
  const catalogEntry = storeResult?.catalogEntry?.entry ?? storeResult?.entry ?? storeResult?.catalogEntry;
  const catalogUpgradeDecision = storeResult?.upgradeDecision?.decision
    ?? storeResult?.catalogUpgradeDecision
    ?? storeResult?.decision;
  assertPlainObject(catalogEntry, 'PlannerPolicyHandoff catalog store entry');
  return await writePlannerPolicyHandoffArtifact({
    catalogEntry,
    catalogUpgradeDecision,
    taskIntent,
    policy,
    healthRecovery,
  }, paths);
}
