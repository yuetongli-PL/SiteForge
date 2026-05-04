// @ts-check

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { assertApiCatalogUpgradeDecisionAllowsCatalog } from './api-candidates.mjs';
import { assertGovernedSchemaCompatible } from './schema-governance.mjs';
import { normalizeDownloadPolicy } from './download-policy.mjs';
import { normalizeStandardTaskList } from './standard-task-list.mjs';
import { applySiteHealthExecutionGateToTaskList } from './site-health-execution-gate.mjs';
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

const FORBIDDEN_HANDOFF_KEY_SET = new Set(
  FORBIDDEN_HANDOFF_KEYS.map((key) => normalizeKey(key)),
);

const FORBIDDEN_HANDOFF_REF_KEY_SET = new Set(
  FORBIDDEN_HANDOFF_REF_KEYS.map((key) => normalizeKey(key)),
);

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
