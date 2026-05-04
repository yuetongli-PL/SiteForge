// @ts-check

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  prepareRedactedArtifactJsonWithAudit,
  redactBody,
  redactHeaders,
  redactUrl,
  redactValue,
} from './security-guard.mjs';
import { reasonCodeSummary, requireReasonCodeDefinition } from './reason-codes.mjs';
import {
  assertLifecycleEventCompatible,
  normalizeLifecycleEvent,
} from './lifecycle-events.mjs';
import {
  matchCapabilityHooksForLifecycleEvent,
  normalizeCapabilityHook,
} from './capability-hook.mjs';

export const API_CANDIDATE_SCHEMA_VERSION = 1;
export const API_CATALOG_ENTRY_SCHEMA_VERSION = 1;
export const API_CATALOG_SCHEMA_VERSION = 1;
export const API_CATALOG_INDEX_SCHEMA_VERSION = 1;
export const API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION = 1;
export const API_CATALOG_UPGRADE_DECISION_VERSION = 1;
export const SITE_ADAPTER_CANDIDATE_DECISION_VERSION = 1;
export const SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION = SITE_ADAPTER_CANDIDATE_DECISION_VERSION;
export const SITE_ADAPTER_CATALOG_UPGRADE_POLICY_VERSION = 1;
export const SITE_ADAPTER_CATALOG_UPGRADE_POLICY_SCHEMA_VERSION = SITE_ADAPTER_CATALOG_UPGRADE_POLICY_VERSION;

export const API_CANDIDATE_STATUSES = Object.freeze([
  'observed',
  'candidate',
  'verified',
  'cataloged',
  'deprecated',
  'blocked',
]);

const API_CANDIDATE_STATUS_SET = new Set(API_CANDIDATE_STATUSES);
const API_CATALOG_ENTRY_STATUS_SET = new Set([
  'cataloged',
  'deprecated',
  'blocked',
]);
const API_CANDIDATE_LIFECYCLE_STATUS_SET = new Set([
  'observed',
  'candidate',
  'verified',
]);

function summarizeRedactionAudit(audit = {}) {
  return {
    redactedPathCount: Array.isArray(audit.redactedPaths) ? audit.redactedPaths.length : 0,
    findingCount: Array.isArray(audit.findings) ? audit.findings.length : 0,
  };
}

function capabilityHookMatchSummaryForLifecycleEvent(lifecycleEvent, {
  capabilityHookRegistry,
  capabilityHooks,
  capabilityHookPhases,
} = {}) {
  const hooks = capabilityHookRegistry ?? capabilityHooks;
  if (!hooks) {
    return undefined;
  }
  return matchCapabilityHooksForLifecycleEvent(
    hooks,
    lifecycleEvent,
    capabilityHookPhases ? { phases: capabilityHookPhases } : {},
  );
}

function lifecycleEventWithCapabilityHookMatches(lifecycleEvent, {
  capabilityHookRegistry,
  capabilityHooks,
  capabilityHookPhases,
} = {}) {
  const capabilityHookMatches = capabilityHookMatchSummaryForLifecycleEvent(lifecycleEvent, {
    capabilityHookRegistry,
    capabilityHooks,
    capabilityHookPhases,
  });
  if (!capabilityHookMatches) {
    return lifecycleEvent;
  }
  return normalizeLifecycleEvent({
    ...lifecycleEvent,
    details: {
      ...lifecycleEvent.details,
      capabilityHookMatches,
    },
  });
}
const API_CATALOG_INVALIDATION_STATUS_SET = new Set([
  'active',
  'stale',
  'deprecated',
  'blocked',
]);
const SITE_ADAPTER_CANDIDATE_DECISION_SET = new Set([
  'accepted',
  'rejected',
  'blocked',
]);

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function normalizeStatus(value) {
  const status = normalizeText(value) ?? 'observed';
  if (!API_CANDIDATE_STATUS_SET.has(status)) {
    throw new Error(`Unsupported ApiCandidate status: ${status}`);
  }
  return status;
}

function normalizeEndpoint(raw = {}) {
  const url = normalizeText(raw.url);
  if (!url) {
    throw new Error('ApiCandidate endpoint.url is required');
  }
  return {
    method: normalizeText(raw.method)?.toUpperCase() ?? 'GET',
    url: redactUrl(url).url,
  };
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? redactValue(value).value
    : {};
}

function normalizeSensitiveFreeObject(value, label) {
  if (value === undefined || value === null) {
    return {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const redacted = redactValue(value);
  if (redacted.audit.redactedPaths.length || redacted.audit.findings.length) {
    throw new Error(`${label} must not contain sensitive material`);
  }
  return redacted.value;
}

function normalizeFirstText(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const text = normalizeText(item);
        if (text) {
          return text;
        }
      }
      continue;
    }
    const text = normalizeText(value);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashStableObject(value) {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function artifactTargetKey(filePath) {
  return path.resolve(filePath).toLowerCase();
}

function assertDistinctArtifactTargets(filePaths = [], label = 'Artifact writer') {
  const seen = new Map();
  for (const filePath of filePaths) {
    const key = artifactTargetKey(filePath);
    if (seen.has(key)) {
      throw new Error(`${label} output paths must be distinct: ${seen.get(key)} and ${filePath}`);
    }
    seen.set(key, filePath);
  }
}

async function assertTargetIsNotDirectory(filePath, label = 'Artifact writer') {
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      throw new Error(`${label} output path must not be a directory: ${filePath}`);
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

async function writeArtifactFileSetAtomically(entries = [], label = 'Artifact writer') {
  assertDistinctArtifactTargets(entries.map((entry) => entry.filePath), label);
  for (const entry of entries) {
    await assertTargetIsNotDirectory(entry.filePath, label);
    await mkdir(path.dirname(entry.filePath), { recursive: true });
  }

  const tempEntries = entries.map((entry, index) => ({
    ...entry,
    tempPath: path.join(
      path.dirname(entry.filePath),
      `.${path.basename(entry.filePath)}.${process.pid}.${Date.now()}.${index}.tmp`,
    ),
    backupPath: path.join(
      path.dirname(entry.filePath),
      `.${path.basename(entry.filePath)}.${process.pid}.${Date.now()}.${index}.backup`,
    ),
    backupExists: false,
  }));
  const committedEntries = [];
  try {
    for (const entry of tempEntries) {
      try {
        await copyFile(entry.filePath, entry.backupPath);
        entry.backupExists = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      }
    }
    for (const entry of tempEntries) {
      await writeFile(entry.tempPath, `${entry.text}\n`, 'utf8');
    }
    for (const entry of tempEntries) {
      await rename(entry.tempPath, entry.filePath);
      committedEntries.push(entry);
    }
  } catch (error) {
    await Promise.allSettled(tempEntries.map((entry) => unlink(entry.tempPath)));
    await Promise.allSettled([...committedEntries].reverse().map(async (entry) => {
      if (entry.backupExists) {
        await copyFile(entry.backupPath, entry.filePath);
        return;
      }
      await unlink(entry.filePath).catch((unlinkError) => {
        if (unlinkError?.code !== 'ENOENT') {
          throw unlinkError;
        }
      });
    }));
    await Promise.allSettled(tempEntries.map((entry) => unlink(entry.backupPath)));
    throw error;
  } finally {
    await Promise.allSettled(tempEntries.map((entry) => unlink(entry.backupPath)));
  }
}

function summarizeResponseValueShape(value, depth = 0) {
  if (value === null) {
    return { type: 'null' };
  }
  if (Array.isArray(value)) {
    return {
      type: 'array',
      ...(value.length ? { itemShape: summarizeResponseValueShape(value[0], depth + 1) } : {}),
    };
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const fields = Object.fromEntries(
      keys.map((key) => [
        key,
        depth >= 2 ? { type: Array.isArray(value[key]) ? 'array' : typeof value[key] } : summarizeResponseValueShape(value[key], depth + 1),
      ]),
    );
    return {
      type: 'object',
      fields,
    };
  }
  return { type: typeof value };
}

export function assertApiResponseCaptureSummaryCompatible(payload = {}) {
  return assertSchemaVersionCompatible(payload, API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION, 'ApiResponseCaptureSummary');
}

export function createApiCandidateResponseCaptureSummary({
  candidate,
  response = {},
  capturedAt,
  source = 'network-capture',
  metadata = {},
} = {}) {
  assertApiCandidateCompatible(candidate);
  const normalizedCandidate = normalizeApiCandidate(candidate);
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('ApiResponseCaptureSummary response must be an object');
  }
  const statusCode = Number(response.statusCode ?? response.status);
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    throw new Error('ApiResponseCaptureSummary statusCode must be an HTTP status code');
  }
  const headersInput = response.headers && typeof response.headers === 'object' && !Array.isArray(response.headers)
    ? response.headers
    : {};
  const redactedHeaders = redactHeaders(headersInput);
  if (redactedHeaders.audit.redactedPaths.length || redactedHeaders.audit.findings.length) {
    throw new Error('ApiResponseCaptureSummary headers must not contain sensitive material');
  }
  const normalizedHeaders = Object.fromEntries(
    Object.entries(redactedHeaders.headers).map(([key, value]) => [String(key).toLowerCase(), value]),
  );
  const headerNames = Object.keys(normalizedHeaders).sort();
  const contentType = normalizeText(normalizedHeaders['content-type']);
  let bodyShape;
  if (Object.hasOwn(response, 'body')) {
    const redactedBody = redactBody(response.body);
    if (redactedBody.audit.redactedPaths.length || redactedBody.audit.findings.length) {
      throw new Error('ApiResponseCaptureSummary body must not contain sensitive material');
    }
    bodyShape = summarizeResponseValueShape(redactedBody.body);
  }
  const responseSchemaHash = bodyShape
    ? hashStableObject({ statusCode, bodyShape })
    : undefined;
  const safeMetadata = normalizeSensitiveFreeObject(metadata, 'ApiResponseCaptureSummary metadata');
  return {
    schemaVersion: API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION,
    candidateId: normalizedCandidate.id,
    siteKey: normalizedCandidate.siteKey,
    capturedAt: normalizeText(capturedAt),
    source: normalizeText(source) ?? 'network-capture',
    statusCode,
    ...(contentType ? { contentType } : {}),
    headerNames,
    ...(bodyShape ? { bodyShape } : {}),
    ...(responseSchemaHash ? { responseSchemaHash } : {}),
    metadata: {
      ...safeMetadata,
      ...(responseSchemaHash ? { responseSchemaHash } : {}),
      ...(bodyShape ? { responseFieldSummary: bodyShape } : {}),
    },
  };
}

export function createApiCandidateResponseSchemaVerificationResultFromFixture({
  candidate,
  responseFixture = {},
  verifierId,
  verifiedAt,
  metadata = {},
} = {}) {
  const safeFixture = normalizeSensitiveFreeObject(
    responseFixture,
    'ApiCandidate response schema fixture',
  );
  const statusCode = Number(safeFixture.statusCode ?? safeFixture.status);
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    throw new Error('ApiCandidate response schema fixture statusCode must be an HTTP status code');
  }
  if (!Object.hasOwn(safeFixture, 'body')) {
    throw new Error('ApiCandidate response schema fixture body is required');
  }
  const bodyShape = summarizeResponseValueShape(safeFixture.body);
  const responseSchemaHash = hashStableObject({
    statusCode,
    bodyShape,
  });
  return createApiCandidateResponseVerificationResult({
    candidate,
    verifierId,
    verifiedAt,
    responseEvidence: {
      responseSchemaHash,
      statusCode,
      bodyShape,
    },
    metadata: {
      ...metadata,
      responseSchemaHash,
      responseFieldSummary: bodyShape,
    },
  });
}

export function createApiCandidateResponseSchemaVerificationResultFromCaptureSummary({
  candidate,
  responseSummary,
  verifierId,
  verifiedAt,
  metadata = {},
} = {}) {
  assertApiCandidateCompatible(candidate);
  assertApiResponseCaptureSummaryCompatible(responseSummary);
  const normalizedCandidate = normalizeApiCandidate(candidate);
  if (responseSummary.candidateId !== normalizedCandidate.id || responseSummary.siteKey !== normalizedCandidate.siteKey) {
    throw new Error('ApiResponseCaptureSummary candidate boundary mismatch');
  }
  if (!normalizeText(responseSummary.responseSchemaHash) || !responseSummary.bodyShape) {
    throw new Error('ApiResponseCaptureSummary bodyShape and responseSchemaHash are required for response schema verification');
  }
  return createApiCandidateResponseVerificationResult({
    candidate,
    verifierId,
    verifiedAt,
    responseEvidence: {
      responseSchemaHash: responseSummary.responseSchemaHash,
      statusCode: responseSummary.statusCode,
      contentType: responseSummary.contentType,
      headerNames: Array.isArray(responseSummary.headerNames) ? responseSummary.headerNames : [],
      bodyShape: responseSummary.bodyShape,
    },
    metadata: {
      ...metadata,
      responseCaptureSummaryVersion: responseSummary.schemaVersion,
      responseSchemaHash: responseSummary.responseSchemaHash,
      responseFieldSummary: responseSummary.bodyShape,
    },
  });
}

function assertSchemaVersionCompatible(payload, expectedVersion, label) {
  if (payload?.schemaVersion === undefined || payload?.schemaVersion === null) {
    throw new Error(`${label} schemaVersion is required`);
  }
  if (payload.schemaVersion !== expectedVersion) {
    throw new Error(`${label} schemaVersion ${payload.schemaVersion} is not compatible with ${expectedVersion}`);
  }
  return true;
}

function assertContractVersionCompatible(payload, expectedVersion, label) {
  const contractVersion = payload?.contractVersion;
  const schemaVersion = payload?.schemaVersion;
  if (
    contractVersion !== undefined
    && contractVersion !== null
    && schemaVersion !== undefined
    && schemaVersion !== null
    && contractVersion !== schemaVersion
  ) {
    throw new Error(`${label} contractVersion ${contractVersion} conflicts with schemaVersion ${schemaVersion}`);
  }
  const version = contractVersion ?? schemaVersion;
  if (version === undefined || version === null) {
    throw new Error(`${label} schemaVersion is required`);
  }
  if (version !== expectedVersion) {
    throw new Error(`${label} schemaVersion ${version} is not compatible with ${expectedVersion}`);
  }
  return true;
}

export function assertApiCandidateCompatible(payload = {}) {
  return assertSchemaVersionCompatible(payload, API_CANDIDATE_SCHEMA_VERSION, 'ApiCandidate');
}

export function assertApiCatalogEntryCompatible(payload = {}) {
  return assertSchemaVersionCompatible(payload, API_CATALOG_ENTRY_SCHEMA_VERSION, 'ApiCatalogEntry');
}

export function assertApiCatalogCompatible(payload = {}) {
  return assertSchemaVersionCompatible(payload, API_CATALOG_SCHEMA_VERSION, 'ApiCatalog');
}

export function assertApiCatalogIndexCompatible(payload = {}) {
  return assertSchemaVersionCompatible(payload, API_CATALOG_INDEX_SCHEMA_VERSION, 'ApiCatalogIndex');
}

export function assertSiteAdapterCandidateDecisionCompatible(payload = {}) {
  return assertContractVersionCompatible(
    payload,
    SITE_ADAPTER_CANDIDATE_DECISION_SCHEMA_VERSION,
    'SiteAdapterCandidateDecision',
  );
}

export function assertSiteAdapterCatalogUpgradePolicyCompatible(payload = {}) {
  return assertContractVersionCompatible(
    payload,
    SITE_ADAPTER_CATALOG_UPGRADE_POLICY_SCHEMA_VERSION,
    'SiteAdapterCatalogUpgradePolicy',
  );
}

export function normalizeApiCandidate(raw = {}) {
  const siteKey = normalizeText(raw.siteKey);
  if (!siteKey) {
    throw new Error('ApiCandidate siteKey is required');
  }
  const endpoint = normalizeEndpoint(raw.endpoint ?? raw);
  const status = normalizeStatus(raw.status);
  return {
    schemaVersion: API_CANDIDATE_SCHEMA_VERSION,
    id: normalizeText(raw.id) ?? `${siteKey}:${endpoint.method}:${endpoint.url}`,
    siteKey,
    status,
    endpoint,
    source: normalizeText(raw.source) ?? 'observed',
    observedAt: normalizeText(raw.observedAt),
    auth: normalizeObject(raw.auth),
    pagination: normalizeObject(raw.pagination),
    fieldMapping: normalizeObject(raw.fieldMapping),
    risk: normalizeObject(raw.risk),
    evidence: normalizeObject(raw.evidence),
    request: {
      headers: redactHeaders(raw.request?.headers ?? raw.headers ?? {}).headers,
      body: normalizeObject(raw.request?.body),
    },
  };
}

function normalizeAdapterDecision(value) {
  const decision = normalizeText(value);
  if (!decision || !SITE_ADAPTER_CANDIDATE_DECISION_SET.has(decision)) {
    throw new Error(`Unsupported SiteAdapter candidate decision: ${decision || '<empty>'}`);
  }
  return decision;
}

function normalizeApiReasonCode(value, { required = false } = {}) {
  const reasonCode = normalizeText(value);
  if (!reasonCode) {
    if (required) {
      throw new Error('SiteAdapter candidate decision reasonCode is required');
    }
    return undefined;
  }
  return requireReasonCodeDefinition(reasonCode, { family: 'api' }).code;
}

export function normalizeSiteAdapterCandidateDecision(raw = {}, { candidate } = {}) {
  const normalizedCandidate = candidate ? normalizeApiCandidate(candidate) : null;
  const candidateId = normalizeText(raw.candidateId ?? normalizedCandidate?.id);
  if (!candidateId) {
    throw new Error('SiteAdapter candidate decision candidateId is required');
  }
  const siteKey = normalizeText(raw.siteKey ?? normalizedCandidate?.siteKey);
  if (!siteKey) {
    throw new Error('SiteAdapter candidate decision siteKey is required');
  }
  const adapterId = normalizeText(raw.adapterId);
  if (!adapterId) {
    throw new Error('SiteAdapter candidate decision adapterId is required');
  }
  const decision = normalizeAdapterDecision(raw.decision);
  const reasonCode = normalizeApiReasonCode(raw.reasonCode, {
    required: decision !== 'accepted',
  });
  const adapterVersion = normalizeText(raw.adapterVersion ?? raw.version);
  return {
    contractVersion: SITE_ADAPTER_CANDIDATE_DECISION_VERSION,
    candidateId,
    siteKey,
    adapterId,
    ...(adapterVersion ? { adapterVersion } : {}),
    decision,
    ...(reasonCode ? { reasonCode } : {}),
    validatedAt: normalizeText(raw.validatedAt ?? raw.checkedAt),
    scope: normalizeObject(raw.scope),
    evidence: normalizeObject(raw.evidence),
  };
}

export function assertApiCandidateCanEnterCatalog(raw = {}) {
  const candidate = normalizeApiCandidate(raw);
  if (candidate.status !== 'verified') {
    throw new Error(`ApiCandidate must be verified before catalog entry: ${candidate.status}`);
  }
  return candidate;
}

function normalizeApiCandidateVerificationResult(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('ApiCandidate verification result must be an object');
  }
  const status = normalizeText(raw.status ?? raw.result);
  const passed = raw.passed === true || status === 'passed' || status === 'verified';
  if (!passed) {
    const reasonCode = normalizeText(raw.reasonCode) ?? 'api-verification-failed';
    requireApiReasonCode(reasonCode);
    throw new Error(`ApiCandidate verification result must be passed: ${reasonCode}`);
  }
  const verifiedAt = normalizeText(raw.verifiedAt ?? raw.validatedAt ?? raw.checkedAt);
  if (!verifiedAt) {
    throw new Error('ApiCandidate verification result verifiedAt is required');
  }
  const verifierId = normalizeText(raw.verifierId ?? raw.verifier ?? raw.source);
  if (!verifierId) {
    throw new Error('ApiCandidate verification result verifierId is required');
  }
  const reasonCode = normalizeText(raw.reasonCode);
  if (reasonCode) {
    requireApiReasonCode(reasonCode);
  }
  return {
    status: 'passed',
    verifierId,
    verifiedAt,
    ...(reasonCode ? { reasonCode } : {}),
    metadata: normalizeSensitiveFreeObject(raw.metadata, 'ApiCandidate verification metadata'),
  };
}

export function createApiCandidateResponseVerificationResult({
  candidate,
  responseEvidence = {},
  verifierId,
  verifiedAt,
  status,
  passed,
  reasonCode,
  metadata = {},
} = {}) {
  const normalizedCandidate = candidate ? normalizeApiCandidate(candidate) : null;
  const verifier = normalizeText(verifierId);
  if (!verifier) {
    throw new Error('ApiCandidate response verification verifierId is required');
  }
  const checkedAt = normalizeText(verifiedAt);
  if (!checkedAt) {
    throw new Error('ApiCandidate response verification verifiedAt is required');
  }
  const safeEvidence = normalizeSensitiveFreeObject(
    responseEvidence,
    'ApiCandidate response verification evidence',
  );
  const safeMetadata = normalizeSensitiveFreeObject(
    metadata,
    'ApiCandidate response verification metadata',
  );
  const outcome = passed === false || normalizeText(status) === 'failed'
    ? 'failed'
    : 'passed';
  const schemaHash = normalizeFirstText(
    safeEvidence.responseSchemaHash,
    safeEvidence.schemaHash,
    safeEvidence.responseSchema?.hash,
    safeEvidence.responseSchema?.version,
    safeMetadata.responseSchemaHash,
  );
  const normalizedReasonCode = normalizeText(reasonCode);
  if (normalizedReasonCode) {
    requireApiReasonCode(normalizedReasonCode);
  }
  if (outcome === 'passed' && !schemaHash) {
    throw new Error('ApiCandidate response verification responseSchemaHash is required');
  }
  if (outcome === 'failed') {
    requireApiReasonCode(normalizedReasonCode ?? 'api-verification-failed');
  }
  return {
    status: outcome,
    verifierId: verifier,
    verifiedAt: checkedAt,
    ...(outcome === 'failed' ? { reasonCode: normalizedReasonCode ?? 'api-verification-failed' } : {}),
    metadata: {
      ...safeMetadata,
      ...(normalizedCandidate ? {
        candidateId: normalizedCandidate.id,
        siteKey: normalizedCandidate.siteKey,
      } : {}),
      ...(schemaHash ? { responseSchemaHash: schemaHash } : {}),
      evidenceType: 'response-schema',
    },
  };
}

export async function writeApiCandidateResponseVerificationResultArtifact(verificationResult = {}, {
  verificationPath,
  resultPath,
  redactionAuditPath,
} = {}) {
  const outputPath = normalizeText(verificationPath ?? resultPath);
  if (!outputPath) {
    throw new Error('ApiCandidate response verification resultPath is required');
  }
  const auditPath = normalizeText(redactionAuditPath);
  if (!auditPath) {
    throw new Error('ApiCandidate response verification redactionAuditPath is required');
  }

  const normalized = normalizeApiCandidateVerificationResult(verificationResult);
  if (normalized.metadata?.evidenceType !== 'response-schema') {
    throw new Error('ApiCandidate response verification artifact requires response-schema evidence');
  }
  if (!normalizeText(normalized.metadata?.responseSchemaHash)) {
    throw new Error('ApiCandidate response verification artifact requires responseSchemaHash');
  }

  const prepared = prepareRedactedArtifactJsonWithAudit(normalized);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(path.dirname(auditPath), { recursive: true });
  await writeFile(outputPath, `${prepared.json}\n`, 'utf8');
  await writeFile(auditPath, `${prepared.auditJson}\n`, 'utf8');
  return {
    verificationResult: prepared.value,
    artifactPath: outputPath,
    redactionAuditPath: auditPath,
    redactionAudit: prepared.auditValue,
  };
}

export function createApiCandidateAuthVerificationResult({
  candidate,
  authEvidence = {},
  verifierId,
  verifiedAt,
  status,
  passed,
  reasonCode,
  metadata = {},
} = {}) {
  const normalizedCandidate = candidate ? normalizeApiCandidate(candidate) : null;
  const verifier = normalizeText(verifierId);
  if (!verifier) {
    throw new Error('ApiCandidate auth verification verifierId is required');
  }
  const checkedAt = normalizeText(verifiedAt);
  if (!checkedAt) {
    throw new Error('ApiCandidate auth verification verifiedAt is required');
  }
  const safeEvidence = normalizeSensitiveFreeObject(
    authEvidence,
    'ApiCandidate auth verification evidence',
  );
  const safeMetadata = normalizeSensitiveFreeObject(
    metadata,
    'ApiCandidate auth verification metadata',
  );
  const outcome = passed === false || normalizeText(status) === 'failed'
    ? 'failed'
    : 'passed';
  const authRequirement = normalizeFirstText(
    safeEvidence.authRequirement,
    safeEvidence.authScheme,
    safeEvidence.authStatus,
    safeMetadata.authRequirement,
  );
  const requestProtectionRequirement = normalizeFirstText(
    safeEvidence.requestProtectionRequirement,
    safeEvidence.requestProtectionStatus,
    safeMetadata.requestProtectionRequirement,
    safeMetadata.requestProtectionStatus,
  );
  const normalizedReasonCode = normalizeText(reasonCode);
  if (normalizedReasonCode) {
    requireApiReasonCode(normalizedReasonCode);
  }
  if (outcome === 'passed' && !authRequirement) {
    throw new Error('ApiCandidate auth verification authRequirement is required');
  }
  if (outcome === 'failed') {
    requireApiReasonCode(normalizedReasonCode ?? 'api-auth-verification-failed');
  }
  return {
    status: outcome,
    verifierId: verifier,
    verifiedAt: checkedAt,
    ...(outcome === 'failed' ? { reasonCode: normalizedReasonCode ?? 'api-auth-verification-failed' } : {}),
    metadata: {
      ...safeMetadata,
      ...(normalizedCandidate ? {
        candidateId: normalizedCandidate.id,
        siteKey: normalizedCandidate.siteKey,
      } : {}),
      authRequirement,
      ...(requestProtectionRequirement ? { requestProtectionRequirement } : {}),
      evidenceType: 'auth-csrf',
    },
  };
}

export function createApiCandidateAuthVerificationResultFromFixture({
  candidate,
  authFixture = {},
  verifierId,
  verifiedAt,
  metadata = {},
} = {}) {
  const safeFixture = normalizeSensitiveFreeObject(
    authFixture,
    'ApiCandidate auth verification fixture',
  );
  const authRequirement = normalizeFirstText(
    safeFixture.authRequirement,
    safeFixture.authScheme,
    safeFixture.auth?.requirement,
    safeFixture.requiresSessionView === true ? 'session-view' : undefined,
    safeFixture.requiresAuth === false ? 'none' : undefined,
  );
  if (!authRequirement) {
    throw new Error('ApiCandidate auth verification fixture authRequirement is required');
  }
  const requestProtectionRequirement = normalizeFirstText(
    safeFixture.requestProtectionRequirement,
    safeFixture.requestProtectionStatus,
    safeFixture.csrfProtection,
    safeFixture.csrf?.requirement,
    safeFixture.requiresCsrf === true ? 'csrf-required' : undefined,
  );
  return createApiCandidateAuthVerificationResult({
    candidate,
    verifierId,
    verifiedAt,
    authEvidence: {
      authRequirement,
      ...(requestProtectionRequirement ? { requestProtectionRequirement } : {}),
    },
    metadata: {
      ...metadata,
      authRequirement,
      ...(requestProtectionRequirement ? { requestProtectionRequirement } : {}),
    },
  });
}

export function createApiCandidatePaginationVerificationResult({
  candidate,
  paginationEvidence = {},
  verifierId,
  verifiedAt,
  status,
  passed,
  reasonCode,
  metadata = {},
} = {}) {
  const normalizedCandidate = candidate ? normalizeApiCandidate(candidate) : null;
  const verifier = normalizeText(verifierId);
  if (!verifier) {
    throw new Error('ApiCandidate pagination verification verifierId is required');
  }
  const checkedAt = normalizeText(verifiedAt);
  if (!checkedAt) {
    throw new Error('ApiCandidate pagination verification verifiedAt is required');
  }
  const safeEvidence = normalizeSensitiveFreeObject(
    paginationEvidence,
    'ApiCandidate pagination verification evidence',
  );
  const safeMetadata = normalizeSensitiveFreeObject(
    metadata,
    'ApiCandidate pagination verification metadata',
  );
  const outcome = passed === false || normalizeText(status) === 'failed'
    ? 'failed'
    : 'passed';
  const paginationModel = normalizeFirstText(
    safeEvidence.paginationModel,
    safeEvidence.paginationStrategy,
    safeEvidence.pageStrategy,
    safeEvidence.cursorStrategy,
    safeMetadata.paginationModel,
    safeMetadata.paginationStrategy,
  );
  const normalizedReasonCode = normalizeText(reasonCode);
  if (normalizedReasonCode) {
    requireApiReasonCode(normalizedReasonCode);
  }
  if (outcome === 'passed' && !paginationModel) {
    throw new Error('ApiCandidate pagination verification paginationModel is required');
  }
  if (outcome === 'failed') {
    requireApiReasonCode(normalizedReasonCode ?? 'api-pagination-verification-failed');
  }
  return {
    status: outcome,
    verifierId: verifier,
    verifiedAt: checkedAt,
    ...(outcome === 'failed' ? { reasonCode: normalizedReasonCode ?? 'api-pagination-verification-failed' } : {}),
    metadata: {
      ...safeMetadata,
      ...(normalizedCandidate ? {
        candidateId: normalizedCandidate.id,
        siteKey: normalizedCandidate.siteKey,
      } : {}),
      paginationModel,
      evidenceType: 'pagination',
    },
  };
}

export function createApiCandidatePaginationVerificationResultFromFixture({
  candidate,
  paginationFixture = {},
  verifierId,
  verifiedAt,
  metadata = {},
} = {}) {
  const safeFixture = normalizeSensitiveFreeObject(
    paginationFixture,
    'ApiCandidate pagination verification fixture',
  );
  const paginationModel = normalizeFirstText(
    safeFixture.paginationModel,
    safeFixture.paginationStrategy,
    safeFixture.pageStrategy,
    safeFixture.cursorStrategy,
  );
  if (!paginationModel) {
    throw new Error('ApiCandidate pagination verification fixture paginationModel is required');
  }
  return createApiCandidatePaginationVerificationResult({
    candidate,
    verifierId,
    verifiedAt,
    paginationEvidence: {
      paginationModel,
    },
    metadata: {
      ...metadata,
      paginationModel,
      ...(Number.isFinite(Number(safeFixture.pageSize)) ? { pageSize: Number(safeFixture.pageSize) } : {}),
      ...(normalizeText(safeFixture.stopCondition) ? { stopCondition: normalizeText(safeFixture.stopCondition) } : {}),
    },
  });
}

export function createApiCandidateRiskVerificationResult({
  candidate,
  riskEvidence = {},
  verifierId,
  verifiedAt,
  status,
  passed,
  reasonCode,
  metadata = {},
} = {}) {
  const normalizedCandidate = candidate ? normalizeApiCandidate(candidate) : null;
  const verifier = normalizeText(verifierId);
  if (!verifier) {
    throw new Error('ApiCandidate risk verification verifierId is required');
  }
  const checkedAt = normalizeText(verifiedAt);
  if (!checkedAt) {
    throw new Error('ApiCandidate risk verification verifiedAt is required');
  }
  const safeEvidence = normalizeSensitiveFreeObject(
    riskEvidence,
    'ApiCandidate risk verification evidence',
  );
  const safeMetadata = normalizeSensitiveFreeObject(
    metadata,
    'ApiCandidate risk verification metadata',
  );
  const outcome = passed === false || normalizeText(status) === 'failed'
    ? 'failed'
    : 'passed';
  const riskState = normalizeFirstText(
    safeEvidence.riskState,
    safeEvidence.state,
    safeEvidence.status,
    safeMetadata.riskState,
  );
  const riskLevel = normalizeFirstText(
    safeEvidence.riskLevel,
    safeEvidence.level,
    safeMetadata.riskLevel,
  );
  const normalizedReasonCode = normalizeText(reasonCode);
  if (normalizedReasonCode) {
    requireApiReasonCode(normalizedReasonCode);
  }
  if (outcome === 'passed' && !riskState) {
    throw new Error('ApiCandidate risk verification riskState is required');
  }
  if (outcome === 'failed') {
    requireApiReasonCode(normalizedReasonCode ?? 'api-risk-verification-failed');
  }
  return {
    status: outcome,
    verifierId: verifier,
    verifiedAt: checkedAt,
    ...(outcome === 'failed' ? { reasonCode: normalizedReasonCode ?? 'api-risk-verification-failed' } : {}),
    metadata: {
      ...safeMetadata,
      ...(normalizedCandidate ? {
        candidateId: normalizedCandidate.id,
        siteKey: normalizedCandidate.siteKey,
      } : {}),
      riskState,
      ...(riskLevel ? { riskLevel } : {}),
      evidenceType: 'risk',
    },
  };
}

export function createApiCandidateRiskVerificationResultFromFixture({
  candidate,
  riskFixture = {},
  verifierId,
  verifiedAt,
  metadata = {},
} = {}) {
  const safeFixture = normalizeSensitiveFreeObject(
    riskFixture,
    'ApiCandidate risk verification fixture',
  );
  const riskState = normalizeFirstText(
    safeFixture.riskState,
    safeFixture.state,
    safeFixture.risk?.state,
  );
  if (!riskState) {
    throw new Error('ApiCandidate risk verification fixture riskState is required');
  }
  const riskLevel = normalizeFirstText(
    safeFixture.riskLevel,
    safeFixture.level,
    safeFixture.risk?.level,
  );
  const riskSignal = normalizeFirstText(
    safeFixture.riskSignal,
    safeFixture.signal,
    safeFixture.signalType,
    safeFixture.risk?.signal,
  );
  const recommendedAction = normalizeFirstText(
    safeFixture.recommendedAction,
    safeFixture.action,
    safeFixture.riskAction,
    safeFixture.risk?.action,
  );
  return createApiCandidateRiskVerificationResult({
    candidate,
    verifierId,
    verifiedAt,
    riskEvidence: {
      riskState,
      ...(riskLevel ? { riskLevel } : {}),
    },
    metadata: {
      ...metadata,
      riskState,
      ...(riskLevel ? { riskLevel } : {}),
      ...(riskSignal ? { riskSignal } : {}),
      ...(recommendedAction ? { recommendedAction } : {}),
    },
  });
}

function normalizeRequiredAspectResult(
  raw,
  expectedType,
  label,
  normalizedCandidate,
  requiredMetadataFields = [],
) {
  const result = normalizeApiCandidateVerificationResult(raw);
  const metadata = result.metadata ?? {};
  if (metadata.evidenceType !== expectedType) {
    throw new Error(`ApiCandidate multi-aspect verification ${label} evidenceType must be ${expectedType}`);
  }
  for (const field of requiredMetadataFields) {
    if (!normalizeText(metadata[field])) {
      throw new Error(`ApiCandidate multi-aspect verification ${label} ${field} is required`);
    }
  }
  if (normalizedCandidate) {
    if (metadata.candidateId && metadata.candidateId !== normalizedCandidate.id) {
      throw new Error(`ApiCandidate multi-aspect verification ${label} candidateId must match candidate`);
    }
    if (metadata.siteKey && metadata.siteKey !== normalizedCandidate.siteKey) {
      throw new Error(`ApiCandidate multi-aspect verification ${label} siteKey must match candidate`);
    }
  }
  return result;
}

export function createApiCandidateMultiAspectVerificationResult({
  candidate,
  verificationResults = {},
  verifierId,
  verifiedAt,
  metadata = {},
} = {}) {
  const normalizedCandidate = candidate ? normalizeApiCandidate(candidate) : null;
  const verifier = normalizeText(verifierId);
  if (!verifier) {
    throw new Error('ApiCandidate multi-aspect verification verifierId is required');
  }
  const checkedAt = normalizeText(verifiedAt);
  if (!checkedAt) {
    throw new Error('ApiCandidate multi-aspect verification verifiedAt is required');
  }
  if (!verificationResults || typeof verificationResults !== 'object' || Array.isArray(verificationResults)) {
    throw new Error('ApiCandidate multi-aspect verification results must be an object');
  }
  const safeMetadata = normalizeSensitiveFreeObject(
    metadata,
    'ApiCandidate multi-aspect verification metadata',
  );
  const response = normalizeRequiredAspectResult(
    verificationResults.responseSchema,
    'response-schema',
    'responseSchema',
    normalizedCandidate,
    ['responseSchemaHash'],
  );
  const auth = normalizeRequiredAspectResult(
    verificationResults.auth,
    'auth-csrf',
    'auth',
    normalizedCandidate,
    ['authRequirement'],
  );
  const pagination = normalizeRequiredAspectResult(
    verificationResults.pagination,
    'pagination',
    'pagination',
    normalizedCandidate,
    ['paginationModel'],
  );
  const risk = normalizeRequiredAspectResult(
    verificationResults.risk,
    'risk',
    'risk',
    normalizedCandidate,
    ['riskState'],
  );
  return {
    status: 'passed',
    verifierId: verifier,
    verifiedAt: checkedAt,
    metadata: {
      ...safeMetadata,
      ...(normalizedCandidate ? {
        candidateId: normalizedCandidate.id,
        siteKey: normalizedCandidate.siteKey,
      } : {}),
      evidenceType: 'multi-aspect',
      aspects: {
        responseSchemaHash: response.metadata.responseSchemaHash,
        authRequirement: auth.metadata.authRequirement,
        ...(auth.metadata.requestProtectionRequirement
          ? { requestProtectionRequirement: auth.metadata.requestProtectionRequirement }
          : {}),
        paginationModel: pagination.metadata.paginationModel,
        riskState: risk.metadata.riskState,
        ...(risk.metadata.riskLevel ? { riskLevel: risk.metadata.riskLevel } : {}),
      },
      aspectVerifierIds: {
        responseSchema: response.verifierId,
        auth: auth.verifierId,
        pagination: pagination.verifierId,
        risk: risk.verifierId,
      },
    },
  };
}

export function createApiCandidateMultiAspectVerificationResultFromFixtures({
  candidate,
  verifierId,
  verifiedAt,
  responseFixture = {},
  authFixture = {},
  paginationFixture = {},
  riskFixture = {},
  metadata = {},
} = {}) {
  const verifier = normalizeText(verifierId);
  return createApiCandidateMultiAspectVerificationResult({
    candidate,
    verifierId,
    verifiedAt,
    metadata,
    verificationResults: {
      responseSchema: createApiCandidateResponseSchemaVerificationResultFromFixture({
        candidate,
        verifierId: verifier ? `${verifier}-response` : undefined,
        verifiedAt,
        responseFixture,
      }),
      auth: createApiCandidateAuthVerificationResultFromFixture({
        candidate,
        verifierId: verifier ? `${verifier}-auth` : undefined,
        verifiedAt,
        authFixture,
      }),
      pagination: createApiCandidatePaginationVerificationResultFromFixture({
        candidate,
        verifierId: verifier ? `${verifier}-pagination` : undefined,
        verifiedAt,
        paginationFixture,
      }),
      risk: createApiCandidateRiskVerificationResultFromFixture({
        candidate,
        verifierId: verifier ? `${verifier}-risk` : undefined,
        verifiedAt,
        riskFixture,
      }),
    },
  });
}

export function verifyApiCandidateForCatalog({
  candidate,
  siteAdapterDecision,
  verificationResult,
} = {}) {
  assertApiCandidateCompatible(candidate);
  assertSiteAdapterCandidateDecisionCompatible(siteAdapterDecision);
  const normalizedCandidate = normalizeApiCandidate(candidate);
  if (!['observed', 'candidate'].includes(normalizedCandidate.status)) {
    throw new Error(`ApiCandidate verification producer requires observed or candidate input: ${normalizedCandidate.status}`);
  }
  const normalizedDecision = normalizeSiteAdapterCandidateDecision(siteAdapterDecision, {
    candidate: normalizedCandidate,
  });
  if (normalizedDecision.candidateId !== normalizedCandidate.id) {
    throw new Error('ApiCandidate verification decision candidateId must match candidate');
  }
  if (normalizedDecision.siteKey !== normalizedCandidate.siteKey) {
    throw new Error('ApiCandidate verification decision siteKey must match candidate');
  }
  if (normalizedDecision.decision !== 'accepted') {
    const reasonCode = normalizedDecision.reasonCode ?? 'api-verification-failed';
    requireApiReasonCode(reasonCode);
    throw new Error(`ApiCandidate verification requires accepted SiteAdapter decision: ${reasonCode}`);
  }
  const verification = normalizeApiCandidateVerificationResult(verificationResult);
  const verifiedCandidate = normalizeApiCandidate({
    ...normalizedCandidate,
    status: 'verified',
    source: 'verified-evidence',
    evidence: {
      ...normalizedCandidate.evidence,
      verification: {
        status: verification.status,
        verifierId: verification.verifierId,
        verifiedAt: verification.verifiedAt,
        ...(verification.reasonCode ? { reasonCode: verification.reasonCode } : {}),
        metadata: verification.metadata,
        siteAdapterDecision: {
          adapterId: normalizedDecision.adapterId,
          ...(normalizedDecision.adapterVersion ? { adapterVersion: normalizedDecision.adapterVersion } : {}),
          validatedAt: normalizedDecision.validatedAt,
        },
      },
    },
  });
  assertApiCandidateCompatible(verifiedCandidate);
  return {
    candidate: verifiedCandidate,
    siteAdapterDecision: normalizedDecision,
    verification,
  };
}

function normalizeApiCandidateVerificationEvidence(evidence = {}) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('ApiCandidate verification evidence must be an object');
  }
  const candidate = assertApiCandidateCanEnterCatalog(evidence.candidate);
  const siteAdapterDecision = normalizeSiteAdapterCandidateDecision(evidence.siteAdapterDecision, { candidate });
  if (siteAdapterDecision.decision !== 'accepted') {
    const reasonCode = siteAdapterDecision.reasonCode ?? 'api-verification-failed';
    requireApiReasonCode(reasonCode);
    throw new Error(`ApiCandidate verification evidence requires accepted SiteAdapter decision: ${reasonCode}`);
  }
  const verification = normalizeApiCandidateVerificationResult(evidence.verification);
  return {
    candidate,
    siteAdapterDecision,
    verification,
  };
}

export function createApiCandidateVerificationLifecycleEvent(evidence = {}, {
  createdAt,
  traceId,
  correlationId,
  taskType,
  adapterVersion,
  capabilityHookRegistry,
  capabilityHooks,
} = {}) {
  const normalizedEvidence = normalizeApiCandidateVerificationEvidence(evidence);
  const lifecycleEvent = normalizeLifecycleEvent({
    eventType: 'api.candidate.verified',
    ...(normalizeText(traceId) ? { traceId: normalizeText(traceId) } : {}),
    ...(normalizeText(correlationId) ? { correlationId: normalizeText(correlationId) } : {}),
    taskId: normalizedEvidence.candidate.id,
    siteKey: normalizedEvidence.candidate.siteKey,
    taskType,
    adapterVersion: normalizeText(adapterVersion ?? normalizedEvidence.siteAdapterDecision.adapterVersion),
    createdAt: normalizeText(createdAt ?? normalizedEvidence.verification.verifiedAt),
    details: {
      candidateId: normalizedEvidence.candidate.id,
      candidateStatus: normalizedEvidence.candidate.status,
      adapterId: normalizedEvidence.siteAdapterDecision.adapterId,
      verifierId: normalizedEvidence.verification.verifierId,
      verifiedAt: normalizedEvidence.verification.verifiedAt,
    },
  });
  assertLifecycleEventCompatible(lifecycleEvent);
  return lifecycleEventWithCapabilityHookMatches(lifecycleEvent, {
    capabilityHookRegistry,
    capabilityHooks,
    capabilityHookPhases: ['after_candidate_write'],
  });
}

export async function writeApiCandidateVerificationEvidenceArtifact({
  candidate,
  siteAdapterDecision,
  verificationResult,
} = {}, {
  evidencePath,
  redactionAuditPath,
  lifecycleEventPath,
  lifecycleEventRedactionAuditPath,
  lifecycleEventCreatedAt,
  lifecycleEventTraceId,
  lifecycleEventCorrelationId,
  lifecycleEventTaskType,
  lifecycleEventAdapterVersion,
  capabilityHookRegistry,
  capabilityHooks,
} = {}) {
  const outputPath = normalizeText(evidencePath);
  if (!outputPath) {
    throw new Error('ApiCandidate verification evidencePath is required');
  }
  const auditPath = normalizeText(redactionAuditPath);
  if (!auditPath) {
    throw new Error('ApiCandidate verification redactionAuditPath is required');
  }
  const eventPath = normalizeText(lifecycleEventPath);
  const eventAuditPath = normalizeText(lifecycleEventRedactionAuditPath);
  const shouldWriteLifecycleEvent = Boolean(eventPath || eventAuditPath);
  if (shouldWriteLifecycleEvent && (!eventPath || !eventAuditPath)) {
    throw new Error('ApiCandidate verification lifecycle event and redaction audit paths must be provided together');
  }

  const evidence = verifyApiCandidateForCatalog({
    candidate,
    siteAdapterDecision,
    verificationResult,
  });
  const prepared = prepareRedactedArtifactJsonWithAudit(evidence);
  const lifecyclePrepared = shouldWriteLifecycleEvent
    ? prepareRedactedArtifactJsonWithAudit(createApiCandidateVerificationLifecycleEvent(evidence, {
      createdAt: lifecycleEventCreatedAt,
      traceId: lifecycleEventTraceId,
      correlationId: lifecycleEventCorrelationId,
      taskType: lifecycleEventTaskType,
      adapterVersion: lifecycleEventAdapterVersion,
      capabilityHookRegistry,
      capabilityHooks,
    }))
    : null;

  await writeArtifactFileSetAtomically([
    { filePath: outputPath, text: prepared.json },
    { filePath: auditPath, text: prepared.auditJson },
    ...(lifecyclePrepared ? [
      { filePath: eventPath, text: lifecyclePrepared.json },
      { filePath: eventAuditPath, text: lifecyclePrepared.auditJson },
    ] : []),
  ], 'ApiCandidate verification evidence writer');

  return {
    evidence: prepared.value,
    redactionSummary: summarizeRedactionAudit(prepared.auditValue),
    artifactPath: outputPath,
    redactionAuditPath: auditPath,
    redactionAudit: prepared.auditValue,
    ...(lifecyclePrepared ? {
      lifecycleEvent: lifecyclePrepared.value,
      lifecycleEventPath: eventPath,
      lifecycleEventRedactionAuditPath: eventAuditPath,
      lifecycleEventRedactionAudit: lifecyclePrepared.auditValue,
    } : {}),
  };
}

export function normalizeSiteAdapterCatalogUpgradePolicy(raw = {}, {
  candidate,
  siteAdapterDecision,
} = {}) {
  if (raw?.contractVersion !== undefined || raw?.schemaVersion !== undefined) {
    assertSiteAdapterCatalogUpgradePolicyCompatible(raw);
  }
  const normalizedCandidate = candidate ? normalizeApiCandidate(candidate) : null;
  const normalizedDecision = siteAdapterDecision
    ? normalizeSiteAdapterCandidateDecision(siteAdapterDecision, { candidate: normalizedCandidate })
    : null;
  const candidateId = normalizeText(raw.candidateId ?? normalizedCandidate?.id);
  if (!candidateId) {
    throw new Error('SiteAdapter catalog upgrade policy candidateId is required');
  }
  const siteKey = normalizeText(raw.siteKey ?? normalizedCandidate?.siteKey);
  if (!siteKey) {
    throw new Error('SiteAdapter catalog upgrade policy siteKey is required');
  }
  const adapterId = normalizeText(raw.adapterId ?? normalizedDecision?.adapterId);
  if (!adapterId) {
    throw new Error('SiteAdapter catalog upgrade policy adapterId is required');
  }
  if (normalizedCandidate && candidateId !== normalizedCandidate.id) {
    throw new Error('SiteAdapter catalog upgrade policy candidateId must match candidate');
  }
  if (normalizedCandidate && siteKey !== normalizedCandidate.siteKey) {
    throw new Error('SiteAdapter catalog upgrade policy siteKey must match candidate');
  }
  if (normalizedDecision && candidateId !== normalizedDecision.candidateId) {
    throw new Error('SiteAdapter catalog upgrade policy candidateId must match SiteAdapter decision');
  }
  if (normalizedDecision && siteKey !== normalizedDecision.siteKey) {
    throw new Error('SiteAdapter catalog upgrade policy siteKey must match SiteAdapter decision');
  }
  if (normalizedDecision && adapterId !== normalizedDecision.adapterId) {
    throw new Error('SiteAdapter catalog upgrade policy adapterId must match SiteAdapter decision');
  }
  const allowCatalogUpgrade = raw.allowCatalogUpgrade !== false;
  const reasonCode = normalizeText(raw.reasonCode);
  if (reasonCode) {
    requireApiReasonCode(reasonCode);
  }
  return {
    contractVersion: SITE_ADAPTER_CATALOG_UPGRADE_POLICY_VERSION,
    candidateId,
    siteKey,
    adapterId,
    allowCatalogUpgrade,
    ...(reasonCode ? { reasonCode } : {}),
    decidedAt: normalizeText(raw.decidedAt ?? raw.checkedAt),
    scope: normalizeObject(raw.scope),
    evidence: normalizeObject(raw.evidence),
  };
}

function normalizeCatalogUpgradePolicy(policy = {}, {
  candidate,
  siteAdapterDecision,
} = {}) {
  const normalizedPolicy = (policy?.contractVersion !== undefined || policy?.schemaVersion !== undefined)
    ? normalizeSiteAdapterCatalogUpgradePolicy(policy, { candidate, siteAdapterDecision })
    : policy;
  const allowCatalogUpgrade = normalizedPolicy?.allowCatalogUpgrade !== false;
  const reasonCode = normalizeText(normalizedPolicy?.reasonCode);
  if (reasonCode) {
    requireReasonCodeDefinition(reasonCode, { family: 'api' });
  }
  return {
    allowCatalogUpgrade,
    reasonCode,
  };
}

function requireApiReasonCode(code) {
  return requireReasonCodeDefinition(code, { family: 'api' });
}

function apiCatalogMaintenanceFailureReasonCode(maintenanceEvidence = {}) {
  const requestedReasonCode = normalizeText(maintenanceEvidence?.reasonCode);
  if (requestedReasonCode) {
    try {
      requireApiReasonCode(requestedReasonCode);
      return requestedReasonCode;
    } catch {
      // Fall back to the safe catalog-blocked failure when evidence is malformed.
    }
  }
  return 'api-catalog-entry-blocked';
}

function createApiCatalogMaintenanceFailure(cause, { maintenanceEvidence } = {}) {
  const reason = requireApiReasonCode(apiCatalogMaintenanceFailureReasonCode(maintenanceEvidence));
  const failure = new Error('ApiCatalog maintenance failed before artifact write');
  failure.name = 'ApiCatalogMaintenanceFailure';
  failure.reasonCode = reason.code;
  failure.retryable = reason.retryable;
  failure.cooldownNeeded = reason.cooldownNeeded;
  failure.isolationNeeded = reason.isolationNeeded;
  failure.manualRecoveryNeeded = reason.manualRecoveryNeeded;
  failure.degradable = reason.degradable;
  failure.artifactWriteAllowed = reason.artifactWriteAllowed;
  failure.catalogAction = reason.catalogAction;
  failure.failureMode = 'api-catalog-maintenance-failed';
  failure.causeSummary = {
    name: normalizeText(cause?.name) ?? 'Error',
  };
  return failure;
}

export function createApiCatalogUpgradeDecision({
  candidate,
  siteAdapterDecision,
  policy = {},
  decidedAt,
} = {}) {
  assertApiCandidateCompatible(candidate);
  assertSiteAdapterCandidateDecisionCompatible(siteAdapterDecision);
  const normalizedCandidate = normalizeApiCandidate(candidate);
  const normalizedDecision = normalizeSiteAdapterCandidateDecision(siteAdapterDecision, {
    candidate: normalizedCandidate,
  });
  if (normalizedDecision.candidateId !== normalizedCandidate.id) {
    throw new Error('ApiCatalog upgrade decision candidateId must match SiteAdapter decision');
  }
  if (normalizedDecision.siteKey !== normalizedCandidate.siteKey) {
    throw new Error('ApiCatalog upgrade decision siteKey must match SiteAdapter decision');
  }
  const normalizedPolicy = normalizeCatalogUpgradePolicy(policy, {
    candidate: normalizedCandidate,
    siteAdapterDecision: normalizedDecision,
  });

  let canEnterCatalog = true;
  let reasonCode;
  if (normalizedCandidate.status !== 'verified') {
    canEnterCatalog = false;
    reasonCode = 'api-catalog-entry-blocked';
  } else if (normalizedDecision.decision !== 'accepted') {
    canEnterCatalog = false;
    reasonCode = normalizedDecision.reasonCode ?? 'api-verification-failed';
  } else if (!normalizedPolicy.allowCatalogUpgrade) {
    canEnterCatalog = false;
    reasonCode = normalizedPolicy.reasonCode ?? 'api-catalog-entry-blocked';
  }

  const reason = reasonCode ? requireApiReasonCode(reasonCode) : null;
  return {
    contractVersion: API_CATALOG_UPGRADE_DECISION_VERSION,
    candidateId: normalizedCandidate.id,
    siteKey: normalizedCandidate.siteKey,
    adapterId: normalizedDecision.adapterId,
    decision: canEnterCatalog ? 'allowed' : 'blocked',
    canEnterCatalog,
    ...(reasonCode ? { reasonCode } : {}),
    catalogAction: canEnterCatalog ? 'catalog' : (reason?.catalogAction ?? 'block'),
    decidedAt: normalizeText(decidedAt),
    requirements: {
      candidateStatus: normalizedCandidate.status,
      candidateVerified: normalizedCandidate.status === 'verified',
      siteAdapterDecision: normalizedDecision.decision,
      siteAdapterAccepted: normalizedDecision.decision === 'accepted',
      policyAllowsCatalogUpgrade: normalizedPolicy.allowCatalogUpgrade,
    },
  };
}

export async function writeApiCatalogUpgradeDecisionArtifact({
  candidate,
  siteAdapterDecision,
  policy = {},
  decidedAt,
} = {}, {
  decisionPath,
  redactionAuditPath,
  lifecycleEventPath,
  lifecycleEventRedactionAuditPath,
  lifecycleEventCreatedAt,
  lifecycleEventTraceId,
  lifecycleEventCorrelationId,
  lifecycleEventTaskType,
  lifecycleEventAdapterVersion,
  capabilityHookRegistry,
  capabilityHooks,
} = {}) {
  const outputPath = normalizeText(decisionPath);
  if (!outputPath) {
    throw new Error('ApiCatalog upgrade decisionPath is required');
  }
  const auditPath = normalizeText(redactionAuditPath);
  const eventPath = normalizeText(lifecycleEventPath);
  const eventAuditPath = normalizeText(lifecycleEventRedactionAuditPath);
  const shouldWriteLifecycleEvent = Boolean(eventPath || eventAuditPath);
  if (shouldWriteLifecycleEvent && (!eventPath || !eventAuditPath)) {
    throw new Error('ApiCatalog upgrade decision lifecycle event and redaction audit paths must be provided together');
  }
  const decision = createApiCatalogUpgradeDecision({
    candidate,
    siteAdapterDecision,
    policy,
    decidedAt,
  });
  if (!auditPath) {
    throw new Error('ApiCatalog upgrade decision redactionAuditPath is required');
  }
  const prepared = prepareRedactedArtifactJsonWithAudit(decision);
  const lifecyclePrepared = shouldWriteLifecycleEvent
    ? prepareRedactedArtifactJsonWithAudit(createApiCatalogUpgradeDecisionLifecycleEvent(decision, {
      createdAt: lifecycleEventCreatedAt ?? decidedAt,
      traceId: lifecycleEventTraceId,
      correlationId: lifecycleEventCorrelationId,
      taskType: lifecycleEventTaskType,
      adapterVersion: lifecycleEventAdapterVersion,
      capabilityHookRegistry,
      capabilityHooks,
    }))
    : null;

  await writeArtifactFileSetAtomically([
    { filePath: outputPath, text: prepared.json },
    { filePath: auditPath, text: prepared.auditJson },
    ...(lifecyclePrepared ? [
      { filePath: eventPath, text: lifecyclePrepared.json },
      { filePath: eventAuditPath, text: lifecyclePrepared.auditJson },
    ] : []),
  ], 'ApiCatalog collection writer');

  return {
    decision: prepared.value,
    artifactPath: outputPath,
    redactionAuditPath: auditPath,
    redactionAudit: prepared.auditValue,
    lifecycleEvent: lifecyclePrepared?.value,
    lifecycleEventPath: eventPath,
    lifecycleEventRedactionAuditPath: eventAuditPath,
    lifecycleEventRedactionAudit: lifecyclePrepared?.auditValue,
  };
}

export function assertApiCatalogUpgradeDecisionCompatible(decision = {}) {
  const contractVersion = decision?.contractVersion;
  if (contractVersion === undefined || contractVersion === null) {
    throw new Error('ApiCatalog upgrade decision contractVersion is required');
  }
  if (contractVersion !== API_CATALOG_UPGRADE_DECISION_VERSION) {
    throw new Error(`ApiCatalog upgrade decision contractVersion ${contractVersion} is not compatible with ${API_CATALOG_UPGRADE_DECISION_VERSION}`);
  }
  return true;
}

export function assertApiCatalogUpgradeDecisionAllowsCatalog(decision = {}) {
  assertApiCatalogUpgradeDecisionCompatible(decision);
  if (decision.decision !== 'allowed' || decision.canEnterCatalog !== true) {
    const reasonCode = normalizeText(decision.reasonCode) ?? 'api-catalog-entry-blocked';
    requireApiReasonCode(reasonCode);
    throw new Error(`ApiCatalog upgrade decision does not allow catalog entry: ${reasonCode}`);
  }
  return decision;
}

export function createApiCatalogUpgradeDecisionLifecycleEvent(decision = {}, {
  createdAt,
  traceId,
  correlationId,
  taskType,
  adapterVersion,
  capabilityHookRegistry,
  capabilityHooks,
} = {}) {
  assertApiCatalogUpgradeDecisionCompatible(decision);
  const lifecycleEvent = normalizeLifecycleEvent({
    eventType: 'api.catalog.upgrade_decision.written',
    ...(normalizeText(traceId) ? { traceId: normalizeText(traceId) } : {}),
    ...(normalizeText(correlationId) ? { correlationId: normalizeText(correlationId) } : {}),
    taskId: decision.candidateId,
    siteKey: decision.siteKey,
    taskType,
    adapterVersion,
    reasonCode: normalizeText(decision.reasonCode),
    createdAt: normalizeText(createdAt ?? decision.decidedAt),
    details: {
      candidateId: decision.candidateId,
      adapterId: decision.adapterId,
      decision: decision.decision,
      canEnterCatalog: decision.canEnterCatalog,
      catalogAction: decision.catalogAction,
      requirements: normalizeObject(decision.requirements),
    },
  });
  assertLifecycleEventCompatible(lifecycleEvent);
  return lifecycleEventWithCapabilityHookMatches(lifecycleEvent, {
    capabilityHookRegistry,
    capabilityHooks,
    capabilityHookPhases: ['before_catalog_verify', 'after_artifact_write'],
  });
}

export async function writeApiCandidateArtifact(rawCandidate = {}, {
  candidatePath,
  redactionAuditPath,
} = {}) {
  const outputPath = normalizeText(candidatePath);
  if (!outputPath) {
    throw new Error('ApiCandidate candidatePath is required');
  }
  const auditPath = normalizeText(redactionAuditPath);
  assertApiCandidateCompatible(rawCandidate);
  const candidate = normalizeApiCandidate(rawCandidate);
  assertApiCandidateCompatible(candidate);
  if (!auditPath) {
    throw new Error('ApiCandidate redactionAuditPath is required');
  }
  const prepared = prepareRedactedArtifactJsonWithAudit(candidate);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${prepared.json}\n`, 'utf8');

  await mkdir(path.dirname(auditPath), { recursive: true });
  await writeFile(auditPath, `${prepared.auditJson}\n`, 'utf8');

  return {
    candidate: prepared.value,
    redactionSummary: summarizeRedactionAudit(prepared.auditValue),
    artifactPath: outputPath,
    redactionAuditPath: auditPath,
    redactionAudit: prepared.auditValue,
  };
}

function normalizeCatalogStatus(value) {
  const status = normalizeText(value) ?? 'cataloged';
  if (!API_CATALOG_ENTRY_STATUS_SET.has(status)) {
    throw new Error(`Unsupported ApiCatalogEntry status: ${status}`);
  }
  return status;
}

function normalizeInvalidationStatus(value, { catalogStatus = 'cataloged' } = {}) {
  const fallback = catalogStatus === 'deprecated' || catalogStatus === 'blocked'
    ? catalogStatus
    : 'active';
  const status = normalizeText(value) ?? fallback;
  if (!API_CATALOG_INVALIDATION_STATUS_SET.has(status)) {
    throw new Error(`Unsupported ApiCatalogEntry invalidationStatus: ${status}`);
  }
  if ((catalogStatus === 'deprecated' || catalogStatus === 'blocked') && status === 'active') {
    throw new Error(`ApiCatalogEntry ${catalogStatus} status must not use active invalidationStatus`);
  }
  return status;
}

function assertNotApiCandidateLifecycleStatusForCatalog(value, context) {
  const status = normalizeText(value);
  if (status && API_CANDIDATE_LIFECYCLE_STATUS_SET.has(status)) {
    throw new Error(`ApiCatalog ${context} must not use ApiCandidate lifecycle status: ${status}`);
  }
  return true;
}

function assertStoredApiCatalogEntryCompatible(entry = {}) {
  assertApiCatalogEntryCompatible(entry);
  if (!normalizeText(entry.candidateId)) {
    throw new Error('ApiCatalogEntry candidateId is required for catalog storage');
  }
  if (!normalizeText(entry.siteKey)) {
    throw new Error('ApiCatalogEntry siteKey is required for catalog storage');
  }
  if (!entry.endpoint || typeof entry.endpoint !== 'object' || Array.isArray(entry.endpoint)) {
    throw new Error('ApiCatalogEntry endpoint is required for catalog storage');
  }
  const catalogStatus = normalizeCatalogStatus(entry.status);
  normalizeInvalidationStatus(entry.invalidationStatus, { catalogStatus });
  return true;
}

export function createApiCatalogEntryFromCandidate(rawCandidate = {}, metadata = {}) {
  const candidate = assertApiCandidateCanEnterCatalog(rawCandidate);
  const status = normalizeCatalogStatus(metadata.status);
  return {
    schemaVersion: API_CATALOG_ENTRY_SCHEMA_VERSION,
    candidateId: candidate.id,
    siteKey: candidate.siteKey,
    endpoint: { ...candidate.endpoint },
    version: normalizeText(metadata.version) ?? '1',
    auth: normalizeObject(metadata.auth ?? candidate.auth),
    pagination: normalizeObject(metadata.pagination ?? candidate.pagination),
    risk: normalizeObject(metadata.risk ?? candidate.risk),
    fieldMapping: normalizeObject(metadata.fieldMapping ?? candidate.fieldMapping),
    verifiedAt: normalizeText(metadata.verifiedAt ?? candidate.observedAt),
    lastValidatedAt: normalizeText(metadata.lastValidatedAt ?? metadata.verifiedAt ?? candidate.observedAt),
    status,
    invalidationStatus: normalizeInvalidationStatus(metadata.invalidationStatus, { catalogStatus: status }),
  };
}

function createApiCatalogVerificationLifecycleEventFromEntry(entry = {}, {
  createdAt,
  traceId,
  correlationId,
  taskType,
  adapterVersion,
  capabilityHookRegistry,
  capabilityHooks,
} = {}) {
  assertApiCatalogEntryCompatible(entry);
  const lifecycleEvent = normalizeLifecycleEvent({
    eventType: 'api.catalog.verification.written',
    ...(normalizeText(traceId) ? { traceId: normalizeText(traceId) } : {}),
    ...(normalizeText(correlationId) ? { correlationId: normalizeText(correlationId) } : {}),
    taskId: entry.candidateId,
    siteKey: entry.siteKey,
    taskType,
    adapterVersion,
    createdAt: normalizeText(createdAt ?? entry.lastValidatedAt ?? entry.verifiedAt),
    details: {
      candidateId: entry.candidateId,
      catalogVersion: entry.version,
      catalogStatus: entry.status,
      invalidationStatus: entry.invalidationStatus,
      verifiedAt: entry.verifiedAt,
      lastValidatedAt: entry.lastValidatedAt,
      catalogEntry: entry,
    },
  });
  assertLifecycleEventCompatible(lifecycleEvent);
  return lifecycleEventWithCapabilityHookMatches(lifecycleEvent, {
    capabilityHookRegistry,
    capabilityHooks,
  });
}

export function createApiCatalogVerificationLifecycleEvent(rawCandidate = {}, {
  metadata = {},
  createdAt,
  traceId,
  correlationId,
  capabilityHookRegistry,
  capabilityHooks,
} = {}) {
  assertApiCandidateCompatible(rawCandidate);
  const entry = createApiCatalogEntryFromCandidate(rawCandidate, metadata);
  return createApiCatalogVerificationLifecycleEventFromEntry(entry, {
    createdAt,
    traceId,
    correlationId,
    taskType: normalizeFirstText(metadata.taskType, metadata.supportedTaskTypes),
    adapterVersion: normalizeFirstText(metadata.adapterVersion, metadata.siteAdapterVersion),
    capabilityHookRegistry,
    capabilityHooks,
  });
}

export function createApiCatalogVerificationHookDescriptor(overrides = {}) {
  return normalizeCapabilityHook({
    id: 'api-catalog-verification:lifecycle-artifact-writer',
    phase: 'after_catalog_verify',
    hookType: 'artifact_writer',
    subscriber: {
      name: 'api-catalog-verification-event-writer',
      modulePath: 'src/sites/capability/api-candidates.mjs',
      entrypoint: 'writeApiCatalogVerificationEventArtifact',
      capability: 'api-catalog',
    },
    safety: {
      failClosed: true,
      redactionRequired: true,
      artifactWriteAllowed: true,
    },
    ...overrides,
  });
}

export function createApiCatalogSchemaIncompatibilityLifecycleEvent({
  schemaName = 'ApiCandidate',
  expectedVersion = API_CANDIDATE_SCHEMA_VERSION,
  receivedVersion,
  operation = 'api-catalog-write',
  siteKey,
  candidateId,
  traceId,
  correlationId,
  taskType,
  adapterVersion,
  createdAt,
  capabilityHookRegistry,
  capabilityHooks,
} = {}) {
  const reason = requireReasonCodeDefinition('schema-version-incompatible', { family: 'schema' });
  const lifecycleEvent = normalizeLifecycleEvent({
    eventType: 'api.catalog.schema_incompatible',
    traceId,
    correlationId,
    taskId: candidateId,
    siteKey,
    taskType,
    adapterVersion,
    reasonCode: reason.code,
    createdAt,
    details: {
      operation: normalizeText(operation) ?? 'api-catalog-write',
      schemaName: normalizeText(schemaName) ?? 'ApiCandidate',
      expectedVersion,
      receivedVersion,
      failClosed: true,
      artifactWriteAllowed: reason.artifactWriteAllowed,
      retryable: reason.retryable,
      manualRecoveryNeeded: reason.manualRecoveryNeeded,
      reasonRecovery: reasonCodeSummary(reason.code),
    },
  });
  assertLifecycleEventCompatible(lifecycleEvent);
  return lifecycleEventWithCapabilityHookMatches(lifecycleEvent, {
    capabilityHookRegistry,
    capabilityHooks,
    capabilityHookPhases: ['after_catalog_verify', 'on_failure'],
  });
}

export function createApiCatalogCollection(rawCandidates = [], {
  generatedAt,
  catalogId,
  catalogVersion,
  metadataByCandidateId = {},
} = {}) {
  if (!Array.isArray(rawCandidates)) {
    throw new Error('ApiCatalog candidates must be an array');
  }
  const entries = rawCandidates.map((rawCandidate) => {
    assertApiCandidateCompatible(rawCandidate);
    const candidateId = normalizeText(rawCandidate.id);
    return createApiCatalogEntryFromCandidate(rawCandidate, candidateId
      ? metadataByCandidateId[candidateId]
      : undefined);
  });
  return {
    schemaVersion: API_CATALOG_SCHEMA_VERSION,
    catalogId: normalizeText(catalogId),
    catalogVersion: normalizeText(catalogVersion),
    generatedAt: normalizeText(generatedAt),
    entries,
  };
}

export function transitionApiCatalogCollectionEntryStatus(rawCatalog = {}, {
  candidateId,
  status,
  invalidationStatus,
  transitionedAt,
  reasonCode,
} = {}) {
  const catalog = normalizeStoredApiCatalog(rawCatalog);
  const targetCandidateId = normalizeText(candidateId);
  if (!targetCandidateId) {
    throw new Error('ApiCatalog status transition candidateId is required');
  }
  const rawTransitionStatus = normalizeText(invalidationStatus ?? status);
  assertNotApiCandidateLifecycleStatusForCatalog(rawTransitionStatus, 'status transition');
  const transitionStatus = normalizeInvalidationStatus(rawTransitionStatus);
  const catalogStatus = transitionStatus === 'deprecated' || transitionStatus === 'blocked'
    ? transitionStatus
    : 'cataloged';
  const normalizedReasonCode = normalizeText(reasonCode);
  const reason = normalizedReasonCode
    ? requireApiReasonCode(normalizedReasonCode)
    : null;
  let matched = false;
  const entries = catalog.entries.map((entry) => {
    assertApiCatalogEntryCompatible(entry);
    if (normalizeText(entry.candidateId) !== targetCandidateId) {
      return { ...entry };
    }
    matched = true;
    return {
      ...entry,
      status: normalizeCatalogStatus(catalogStatus),
      invalidationStatus: normalizeInvalidationStatus(transitionStatus, { catalogStatus }),
      lastValidatedAt: normalizeText(transitionedAt) ?? entry.lastValidatedAt,
      risk: {
        ...normalizeObject(entry.risk),
        ...(normalizedReasonCode ? { reasonCode: normalizedReasonCode } : {}),
        ...(normalizeText(reason?.catalogAction)
          ? { catalogAction: normalizeText(reason.catalogAction) }
          : {}),
      },
    };
  });
  if (!matched) {
    throw new Error(`ApiCatalog status transition candidate not found: ${targetCandidateId}`);
  }
  return normalizeStoredApiCatalog({
    ...catalog,
    generatedAt: normalizeText(transitionedAt) ?? catalog.generatedAt,
    entries,
  });
}

function normalizeApiCatalogMaintenanceEvidence(evidence = {}) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('ApiCatalog maintenance evidence must be an object');
  }
  const candidateId = normalizeText(evidence.candidateId);
  if (!candidateId) {
    throw new Error('ApiCatalog maintenance evidence candidateId is required');
  }
  const rawMaintenanceStatus = normalizeText(evidence.invalidationStatus ?? evidence.status);
  assertNotApiCandidateLifecycleStatusForCatalog(rawMaintenanceStatus, 'maintenance evidence');
  const invalidationStatus = normalizeInvalidationStatus(rawMaintenanceStatus);
  if (invalidationStatus === 'active') {
    throw new Error('ApiCatalog maintenance evidence must not promote active catalog entries');
  }
  const reasonCode = normalizeText(evidence.reasonCode);
  if (!reasonCode) {
    throw new Error('ApiCatalog maintenance evidence reasonCode is required');
  }
  requireApiReasonCode(reasonCode);
  const verifiedAt = normalizeText(evidence.verifiedAt ?? evidence.transitionedAt);
  if (!verifiedAt) {
    throw new Error('ApiCatalog maintenance evidence verifiedAt is required');
  }
  const verifierId = normalizeText(evidence.verifierId);
  if (!verifierId) {
    throw new Error('ApiCatalog maintenance evidence verifierId is required');
  }
  return {
    candidateId,
    invalidationStatus,
    reasonCode,
    verifiedAt,
    verifierId,
    ...(evidence.details ? {
      details: normalizeSensitiveFreeObject(evidence.details, 'ApiCatalog maintenance evidence details'),
    } : {}),
    ...(evidence.metadata ? {
      metadata: normalizeSensitiveFreeObject(evidence.metadata, 'ApiCatalog maintenance evidence metadata'),
    } : {}),
  };
}

function summarizeCatalogForIndex(rawCatalog = {}, index = 0) {
  assertApiCatalogCompatible(rawCatalog);
  const entries = Array.isArray(rawCatalog.entries) ? rawCatalog.entries : [];
  for (const entry of entries) {
    assertStoredApiCatalogEntryCompatible(entry);
  }
  const siteKeys = [...new Set(entries.map((entry) => normalizeText(entry.siteKey)).filter(Boolean))].sort();
  const statuses = {};
  const invalidationStatuses = {};
  const reasonCodes = {};
  const validatedTimes = [];
  for (const entry of entries) {
    const status = normalizeCatalogStatus(entry.status);
    statuses[status] = (statuses[status] ?? 0) + 1;
    const invalidationStatus = normalizeInvalidationStatus(entry.invalidationStatus, { catalogStatus: status });
    invalidationStatuses[invalidationStatus] = (invalidationStatuses[invalidationStatus] ?? 0) + 1;
    const reasonCode = normalizeText(entry.risk?.reasonCode);
    if (reasonCode) {
      reasonCodes[reasonCode] = (reasonCodes[reasonCode] ?? 0) + 1;
    }
    const lastValidatedAt = normalizeText(entry.lastValidatedAt);
    if (lastValidatedAt) {
      validatedTimes.push(lastValidatedAt);
    }
  }
  return {
    catalogId: normalizeText(rawCatalog.catalogId) ?? `catalog-${index + 1}`,
    catalogVersion: normalizeText(rawCatalog.catalogVersion) ?? '1',
    generatedAt: normalizeText(rawCatalog.generatedAt),
    latestValidatedAt: validatedTimes.sort().at(-1),
    entryCount: entries.length,
    siteKeys,
    statuses,
    invalidationStatuses,
    reasonCodes,
  };
}

function summarizeIndexReasonCodes(catalogs = []) {
  const reasonCodes = {};
  for (const catalog of catalogs) {
    for (const [reasonCode, count] of Object.entries(normalizeObject(catalog.reasonCodes))) {
      reasonCodes[reasonCode] = (reasonCodes[reasonCode] ?? 0) + Number(count ?? 0);
    }
  }
  return reasonCodes;
}

function summarizeReasonRecoveries(reasonCodes = {}) {
  return Object.fromEntries(Object.keys(normalizeObject(reasonCodes)).sort()
    .map((reasonCode) => [reasonCode, reasonCodeSummary(reasonCode)]));
}

export function createApiCatalogIndex(rawCatalogs = [], {
  generatedAt,
  indexVersion = '1',
} = {}) {
  if (!Array.isArray(rawCatalogs)) {
    throw new Error('ApiCatalogIndex catalogs must be an array');
  }
  const catalogs = rawCatalogs.map((catalog, index) => summarizeCatalogForIndex(catalog, index));
  return {
    schemaVersion: API_CATALOG_INDEX_SCHEMA_VERSION,
    indexVersion: normalizeText(indexVersion) ?? '1',
    generatedAt: normalizeText(generatedAt),
    reasonCodes: summarizeIndexReasonCodes(catalogs),
    catalogs,
  };
}

export function createApiCatalogIndexLifecycleEvent(index = {}, {
  createdAt,
  traceId,
  correlationId,
  siteKey,
  taskType,
  adapterVersion,
  capabilityHookRegistry,
  capabilityHooks,
} = {}) {
  assertApiCatalogIndexCompatible(index);
  const catalogs = Array.isArray(index.catalogs) ? index.catalogs : [];
  const reasonCodes = normalizeObject(index.reasonCodes ?? summarizeIndexReasonCodes(catalogs));
  const lifecycleEvent = normalizeLifecycleEvent({
    eventType: 'api.catalog.index.written',
    ...(normalizeText(traceId) ? { traceId: normalizeText(traceId) } : {}),
    ...(normalizeText(correlationId) ? { correlationId: normalizeText(correlationId) } : {}),
    taskId: normalizeText(index.indexVersion),
    siteKey,
    taskType,
    adapterVersion,
    createdAt: normalizeText(createdAt ?? index.generatedAt),
    details: {
      indexVersion: normalizeText(index.indexVersion),
      indexGeneratedAt: normalizeText(index.generatedAt),
      catalogCount: catalogs.length,
      totalEntryCount: catalogs.reduce((count, catalog) => count + Number(catalog.entryCount ?? 0), 0),
      reasonCodes,
      reasonRecoveries: summarizeReasonRecoveries(reasonCodes),
      catalogs: catalogs.map((catalog) => ({
        catalogId: normalizeText(catalog.catalogId),
        catalogVersion: normalizeText(catalog.catalogVersion),
        generatedAt: normalizeText(catalog.generatedAt),
        latestValidatedAt: normalizeText(catalog.latestValidatedAt),
        entryCount: Number(catalog.entryCount ?? 0),
        siteKeys: Array.isArray(catalog.siteKeys) ? [...catalog.siteKeys] : [],
        statuses: normalizeObject(catalog.statuses),
        invalidationStatuses: normalizeObject(catalog.invalidationStatuses),
        reasonCodes: normalizeObject(catalog.reasonCodes),
        reasonRecoveries: summarizeReasonRecoveries(catalog.reasonCodes),
      })),
    },
  });
  assertLifecycleEventCompatible(lifecycleEvent);
  return lifecycleEventWithCapabilityHookMatches(lifecycleEvent, {
    capabilityHookRegistry,
    capabilityHooks,
    capabilityHookPhases: ['after_catalog_verify', 'after_artifact_write'],
  });
}

export function createApiCatalogCollectionLifecycleEvent(catalog = {}, {
  createdAt,
  traceId,
  correlationId,
  reasonCode,
  taskType,
  adapterVersion,
  capabilityHookRegistry,
  capabilityHooks,
} = {}) {
  assertApiCatalogCompatible(catalog);
  const summary = summarizeCatalogForIndex(catalog);
  const reasonCodes = {};
  for (const entry of Array.isArray(catalog.entries) ? catalog.entries : []) {
    assertStoredApiCatalogEntryCompatible(entry);
    const reasonCode = normalizeText(entry.risk?.reasonCode);
    if (reasonCode) {
      reasonCodes[reasonCode] = (reasonCodes[reasonCode] ?? 0) + 1;
    }
  }
  const lifecycleEvent = normalizeLifecycleEvent({
    eventType: 'api.catalog.collection.written',
    ...(normalizeText(traceId) ? { traceId: normalizeText(traceId) } : {}),
    ...(normalizeText(correlationId) ? { correlationId: normalizeText(correlationId) } : {}),
    taskId: summary.catalogId,
    siteKey: summary.siteKeys.length === 1 ? summary.siteKeys[0] : undefined,
    reasonCode: normalizeApiReasonCode(reasonCode),
    taskType,
    adapterVersion,
    createdAt: normalizeText(createdAt ?? catalog.generatedAt),
    details: {
      catalogId: summary.catalogId,
      catalogVersion: summary.catalogVersion,
      generatedAt: summary.generatedAt,
      latestValidatedAt: summary.latestValidatedAt,
      entryCount: summary.entryCount,
      siteKeys: summary.siteKeys,
      statuses: summary.statuses,
      invalidationStatuses: summary.invalidationStatuses,
      reasonCodes,
      reasonRecoveries: summarizeReasonRecoveries(reasonCodes),
    },
  });
  assertLifecycleEventCompatible(lifecycleEvent);
  return lifecycleEventWithCapabilityHookMatches(lifecycleEvent, {
    capabilityHookRegistry,
    capabilityHooks,
    capabilityHookPhases: ['after_catalog_verify', 'after_artifact_write'],
  });
}

export async function writeApiCatalogEntryArtifact(rawCandidate = {}, {
  metadata = {},
  catalogPath,
  redactionAuditPath,
  verificationEventPath,
  verificationEventRedactionAuditPath,
  verificationEventCreatedAt,
  verificationEventTraceId,
  verificationEventCorrelationId,
  capabilityHookRegistry,
  capabilityHooks,
} = {}) {
  const outputPath = normalizeText(catalogPath);
  if (!outputPath) {
    throw new Error('ApiCatalogEntry catalogPath is required');
  }
  const auditPath = normalizeText(redactionAuditPath);
  const hasVerificationEventPath = normalizeText(verificationEventPath);
  const hasVerificationEventAuditPath = normalizeText(verificationEventRedactionAuditPath);
  const shouldWriteVerificationEvent = Boolean(hasVerificationEventPath || hasVerificationEventAuditPath);
  if (shouldWriteVerificationEvent && (!hasVerificationEventPath || !hasVerificationEventAuditPath)) {
    throw new Error('ApiCatalog verification event and redaction audit paths must be provided together');
  }
  assertApiCandidateCompatible(rawCandidate);
  const entry = createApiCatalogEntryFromCandidate(rawCandidate, metadata);
  assertApiCatalogEntryCompatible(entry);
  if (!auditPath) {
    throw new Error('ApiCatalogEntry redactionAuditPath is required');
  }
  const prepared = prepareRedactedArtifactJsonWithAudit(entry);
  const verificationPrepared = shouldWriteVerificationEvent
    ? prepareRedactedArtifactJsonWithAudit(createApiCatalogVerificationLifecycleEventFromEntry(entry, {
      createdAt: verificationEventCreatedAt ?? metadata.lastValidatedAt ?? metadata.verifiedAt,
      traceId: verificationEventTraceId,
      correlationId: verificationEventCorrelationId,
      taskType: normalizeFirstText(metadata.taskType, metadata.supportedTaskTypes),
      adapterVersion: normalizeFirstText(metadata.adapterVersion, metadata.siteAdapterVersion),
      capabilityHookRegistry,
      capabilityHooks,
    }))
    : null;

  await writeArtifactFileSetAtomically([
    { filePath: outputPath, text: prepared.json },
    { filePath: auditPath, text: prepared.auditJson },
    ...(verificationPrepared ? [
      { filePath: hasVerificationEventPath, text: verificationPrepared.json },
      { filePath: hasVerificationEventAuditPath, text: verificationPrepared.auditJson },
    ] : []),
  ], 'ApiCatalogEntry artifact writer');

  return {
    entry: prepared.value,
    redactionSummary: summarizeRedactionAudit(prepared.auditValue),
    artifactPath: outputPath,
    redactionAuditPath: auditPath,
    redactionAudit: prepared.auditValue,
    ...(verificationPrepared ? {
      verificationEvent: verificationPrepared.value,
      verificationEventPath: hasVerificationEventPath,
      verificationEventRedactionAuditPath: hasVerificationEventAuditPath,
      verificationEventRedactionAudit: verificationPrepared.auditValue,
    } : {}),
  };
}

export async function writeVerifiedApiCatalogUpgradeFixtureArtifacts({
  candidate,
  siteAdapterDecision,
  policy = {},
  decidedAt,
  metadata = {},
} = {}, {
  decisionPath,
  decisionRedactionAuditPath,
  catalogPath,
  catalogRedactionAuditPath,
  verificationEventPath,
  verificationEventRedactionAuditPath,
  verificationEventCreatedAt,
  verificationEventTraceId,
  verificationEventCorrelationId,
  capabilityHookRegistry,
  capabilityHooks,
  collectionPath,
  collectionRedactionAuditPath,
  collectionLifecycleEventPath,
  collectionLifecycleEventRedactionAuditPath,
  collectionLifecycleEventCreatedAt,
  collectionLifecycleEventTraceId,
  collectionLifecycleEventCorrelationId,
  collectionGeneratedAt,
  collectionCatalogId,
  collectionCatalogVersion,
  indexPath,
  indexRedactionAuditPath,
  indexLifecycleEventPath,
  indexLifecycleEventRedactionAuditPath,
  indexLifecycleEventCreatedAt,
  indexLifecycleEventTraceId,
  indexLifecycleEventCorrelationId,
  indexLifecycleEventSiteKey,
  indexLifecycleEventTaskType,
  indexLifecycleEventAdapterVersion,
  indexGeneratedAt,
  indexVersion,
} = {}) {
  const safeDecisionPath = normalizeText(decisionPath);
  if (!safeDecisionPath) {
    throw new Error('ApiCatalog upgrade fixture decisionPath is required');
  }
  const safeDecisionAuditPath = normalizeText(decisionRedactionAuditPath);
  if (!safeDecisionAuditPath) {
    throw new Error('ApiCatalog upgrade fixture decisionRedactionAuditPath is required');
  }
  const safeCatalogPath = normalizeText(catalogPath);
  if (!safeCatalogPath) {
    throw new Error('ApiCatalog upgrade fixture catalogPath is required');
  }
  const safeCatalogAuditPath = normalizeText(catalogRedactionAuditPath);
  if (!safeCatalogAuditPath) {
    throw new Error('ApiCatalog upgrade fixture catalogRedactionAuditPath is required');
  }
  const safeVerificationEventPath = normalizeText(verificationEventPath);
  const safeVerificationEventAuditPath = normalizeText(verificationEventRedactionAuditPath);
  if (Boolean(safeVerificationEventPath || safeVerificationEventAuditPath)
    && (!safeVerificationEventPath || !safeVerificationEventAuditPath)) {
    throw new Error('ApiCatalog upgrade fixture verification event and redaction audit paths must be provided together');
  }
  const safeCollectionPath = normalizeText(collectionPath);
  const safeCollectionAuditPath = normalizeText(collectionRedactionAuditPath);
  const safeCollectionEventPath = normalizeText(collectionLifecycleEventPath);
  const safeCollectionEventAuditPath = normalizeText(collectionLifecycleEventRedactionAuditPath);
  const wantsCollectionWrite = Boolean(
    safeCollectionPath
    || safeCollectionAuditPath
    || safeCollectionEventPath
    || safeCollectionEventAuditPath,
  );
  if (wantsCollectionWrite && !safeCollectionPath) {
    throw new Error('ApiCatalog upgrade fixture collectionPath is required for collection writes');
  }
  if (wantsCollectionWrite && !safeCollectionAuditPath) {
    throw new Error('ApiCatalog upgrade fixture collectionRedactionAuditPath is required for collection writes');
  }
  if (Boolean(safeCollectionEventPath || safeCollectionEventAuditPath)
    && (!safeCollectionEventPath || !safeCollectionEventAuditPath)) {
    throw new Error('ApiCatalog upgrade fixture collection lifecycle event and redaction audit paths must be provided together');
  }
  const safeIndexPath = normalizeText(indexPath);
  const safeIndexAuditPath = normalizeText(indexRedactionAuditPath);
  const safeIndexEventPath = normalizeText(indexLifecycleEventPath);
  const safeIndexEventAuditPath = normalizeText(indexLifecycleEventRedactionAuditPath);
  const wantsIndexWrite = Boolean(
    safeIndexPath
    || safeIndexAuditPath
    || safeIndexEventPath
    || safeIndexEventAuditPath,
  );
  if (wantsIndexWrite && !wantsCollectionWrite) {
    throw new Error('ApiCatalog upgrade fixture index writes require collection writes');
  }
  if (wantsIndexWrite && !safeIndexPath) {
    throw new Error('ApiCatalog upgrade fixture indexPath is required for index writes');
  }
  if (wantsIndexWrite && !safeIndexAuditPath) {
    throw new Error('ApiCatalog upgrade fixture indexRedactionAuditPath is required for index writes');
  }
  if (Boolean(safeIndexEventPath || safeIndexEventAuditPath)
    && (!safeIndexEventPath || !safeIndexEventAuditPath)) {
    throw new Error('ApiCatalog upgrade fixture index lifecycle event and redaction audit paths must be provided together');
  }

  const decision = createApiCatalogUpgradeDecision({
    candidate,
    siteAdapterDecision,
    policy,
    decidedAt,
  });
  assertApiCatalogUpgradeDecisionAllowsCatalog(decision);
  const normalizedCollectionCandidate = wantsCollectionWrite ? normalizeApiCandidate(candidate) : null;
  const collectionCatalog = wantsCollectionWrite
    ? mergeApiCatalogCollections(
      await readApiCatalogCollectionIfExists(safeCollectionPath),
      createApiCatalogCollection([normalizedCollectionCandidate], {
        generatedAt: normalizeText(collectionGeneratedAt ?? metadata.lastValidatedAt ?? metadata.verifiedAt ?? decidedAt),
        catalogId: collectionCatalogId,
        catalogVersion: collectionCatalogVersion ?? metadata.version,
        metadataByCandidateId: {
          [normalizedCollectionCandidate.id]: metadata,
        },
      }),
      {
        generatedAt: collectionGeneratedAt ?? metadata.lastValidatedAt ?? metadata.verifiedAt ?? decidedAt,
        catalogId: collectionCatalogId,
        catalogVersion: collectionCatalogVersion ?? metadata.version,
      },
    )
    : null;

  const upgradeDecision = await writeApiCatalogUpgradeDecisionArtifact({
    candidate,
    siteAdapterDecision,
    policy,
    decidedAt,
  }, {
    decisionPath: safeDecisionPath,
    redactionAuditPath: safeDecisionAuditPath,
  });
  const catalogEntry = await writeApiCatalogEntryArtifact(candidate, {
    metadata,
    catalogPath: safeCatalogPath,
    redactionAuditPath: safeCatalogAuditPath,
    verificationEventPath: safeVerificationEventPath,
    verificationEventRedactionAuditPath: safeVerificationEventAuditPath,
    verificationEventCreatedAt,
    verificationEventTraceId,
    verificationEventCorrelationId,
    capabilityHookRegistry,
    capabilityHooks,
  });
  const catalogCollection = collectionCatalog
    ? await writeApiCatalogCollectionObjectArtifact(collectionCatalog, {
      catalogPath: safeCollectionPath,
      redactionAuditPath: safeCollectionAuditPath,
      lifecycleEventPath: safeCollectionEventPath,
      lifecycleEventRedactionAuditPath: safeCollectionEventAuditPath,
      lifecycleEventCreatedAt: collectionLifecycleEventCreatedAt,
      lifecycleEventTraceId: collectionLifecycleEventTraceId,
      lifecycleEventCorrelationId: collectionLifecycleEventCorrelationId,
      capabilityHookRegistry,
      capabilityHooks,
    })
    : null;
  const catalogIndex = catalogCollection && wantsIndexWrite
    ? await writeApiCatalogIndexArtifact([catalogCollection.catalog], {
      indexPath: safeIndexPath,
      redactionAuditPath: safeIndexAuditPath,
      lifecycleEventPath: safeIndexEventPath,
      lifecycleEventRedactionAuditPath: safeIndexEventAuditPath,
      lifecycleEventCreatedAt: indexLifecycleEventCreatedAt,
      lifecycleEventTraceId: indexLifecycleEventTraceId,
      lifecycleEventCorrelationId: indexLifecycleEventCorrelationId,
      lifecycleEventSiteKey: indexLifecycleEventSiteKey,
      lifecycleEventTaskType: indexLifecycleEventTaskType,
      lifecycleEventAdapterVersion: indexLifecycleEventAdapterVersion,
      capabilityHookRegistry,
      capabilityHooks,
      generatedAt: indexGeneratedAt ?? collectionGeneratedAt ?? metadata.lastValidatedAt ?? metadata.verifiedAt ?? decidedAt,
      indexVersion,
    })
    : null;

  return {
    upgradeDecision,
    catalogEntry,
    ...(catalogCollection ? { catalogCollection } : {}),
    ...(catalogIndex ? { catalogIndex } : {}),
  };
}

export async function writeRuntimeVerifiedApiCatalogStoreArtifacts({
  candidate,
  siteAdapterDecision,
  policy = {},
  decidedAt,
  metadata = {},
} = {}, {
  decisionPath,
  decisionRedactionAuditPath,
  catalogPath,
  catalogRedactionAuditPath,
  verificationEventPath,
  verificationEventRedactionAuditPath,
  verificationEventCreatedAt,
  verificationEventTraceId,
  verificationEventCorrelationId,
  capabilityHookRegistry,
  capabilityHooks,
  collectionPath,
  collectionRedactionAuditPath,
  collectionLifecycleEventPath,
  collectionLifecycleEventRedactionAuditPath,
  collectionLifecycleEventCreatedAt,
  collectionLifecycleEventTraceId,
  collectionLifecycleEventCorrelationId,
  collectionGeneratedAt,
  collectionCatalogId,
  collectionCatalogVersion,
  indexPath,
  indexRedactionAuditPath,
  indexLifecycleEventPath,
  indexLifecycleEventRedactionAuditPath,
  indexLifecycleEventCreatedAt,
  indexLifecycleEventTraceId,
  indexLifecycleEventCorrelationId,
  indexLifecycleEventSiteKey,
  indexLifecycleEventTaskType,
  indexLifecycleEventAdapterVersion,
  indexGeneratedAt,
  indexVersion,
} = {}) {
  if (!normalizeText(collectionPath)) {
    throw new Error('ApiCatalog runtime store collectionPath is required');
  }
  if (!normalizeText(collectionRedactionAuditPath)) {
    throw new Error('ApiCatalog runtime store collectionRedactionAuditPath is required');
  }
  return await writeVerifiedApiCatalogUpgradeFixtureArtifacts({
    candidate,
    siteAdapterDecision,
    policy,
    decidedAt,
    metadata,
  }, {
    decisionPath,
    decisionRedactionAuditPath,
    catalogPath,
    catalogRedactionAuditPath,
    verificationEventPath,
    verificationEventRedactionAuditPath,
    verificationEventCreatedAt,
    verificationEventTraceId,
    verificationEventCorrelationId,
    capabilityHookRegistry,
    capabilityHooks,
    collectionPath,
    collectionRedactionAuditPath,
    collectionLifecycleEventPath,
    collectionLifecycleEventRedactionAuditPath,
    collectionLifecycleEventCreatedAt,
    collectionLifecycleEventTraceId,
    collectionLifecycleEventCorrelationId,
    collectionGeneratedAt,
    collectionCatalogId,
    collectionCatalogVersion,
    indexPath,
    indexRedactionAuditPath,
    indexLifecycleEventPath,
    indexLifecycleEventRedactionAuditPath,
    indexLifecycleEventCreatedAt,
    indexLifecycleEventTraceId,
    indexLifecycleEventCorrelationId,
    indexLifecycleEventSiteKey,
    indexLifecycleEventTaskType,
    indexLifecycleEventAdapterVersion,
    indexGeneratedAt,
    indexVersion,
  });
}

export async function writeApiCatalogVerificationEventArtifact(rawCandidate = {}, {
  metadata = {},
  eventPath,
  redactionAuditPath,
  createdAt,
  traceId,
  correlationId,
} = {}) {
  const outputPath = normalizeText(eventPath);
  if (!outputPath) {
    throw new Error('ApiCatalog verification eventPath is required');
  }
  const auditPath = normalizeText(redactionAuditPath);
  if (!auditPath) {
    throw new Error('ApiCatalog verification redactionAuditPath is required');
  }
  const event = createApiCatalogVerificationLifecycleEvent(rawCandidate, {
    metadata,
    createdAt,
    traceId,
    correlationId,
  });
  const prepared = prepareRedactedArtifactJsonWithAudit(event);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${prepared.json}\n`, 'utf8');
  await mkdir(path.dirname(auditPath), { recursive: true });
  await writeFile(auditPath, `${prepared.auditJson}\n`, 'utf8');

  return {
    event: prepared.value,
    artifactPath: outputPath,
    redactionAuditPath: auditPath,
    redactionAudit: prepared.auditValue,
  };
}

function normalizeStoredApiCatalog(catalog = {}) {
  assertApiCatalogCompatible(catalog);
  const entries = Array.isArray(catalog.entries) ? catalog.entries : [];
  for (const entry of entries) {
    assertStoredApiCatalogEntryCompatible(entry);
  }
  return {
    ...catalog,
    entries: entries.map((entry) => ({ ...entry })),
  };
}

async function readApiCatalogCollectionIfExists(catalogPath) {
  try {
    return normalizeStoredApiCatalog(JSON.parse(await readFile(catalogPath, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function mergeApiCatalogCollections(existingCatalog, incomingCatalog, {
  generatedAt,
  catalogId,
  catalogVersion,
} = {}) {
  const existing = existingCatalog ? normalizeStoredApiCatalog(existingCatalog) : null;
  const incoming = normalizeStoredApiCatalog(incomingCatalog);
  const entriesByCandidateId = new Map();
  for (const entry of [...(existing?.entries ?? []), ...incoming.entries]) {
    entriesByCandidateId.set(normalizeText(entry.candidateId), { ...entry });
  }
  return normalizeStoredApiCatalog({
    schemaVersion: API_CATALOG_SCHEMA_VERSION,
    catalogId: normalizeText(catalogId) ?? incoming.catalogId ?? existing?.catalogId,
    catalogVersion: normalizeText(catalogVersion) ?? incoming.catalogVersion ?? existing?.catalogVersion,
    generatedAt: normalizeText(generatedAt) ?? incoming.generatedAt ?? existing?.generatedAt,
    entries: [...entriesByCandidateId.values()]
      .sort((left, right) => String(left.candidateId).localeCompare(String(right.candidateId))),
  });
}

async function writeApiCatalogCollectionObjectArtifact(catalog = {}, {
  catalogPath,
  redactionAuditPath,
  lifecycleEventPath,
  lifecycleEventRedactionAuditPath,
  lifecycleEventCreatedAt,
  lifecycleEventTraceId,
  lifecycleEventCorrelationId,
  lifecycleEventReasonCode,
  lifecycleEventTaskType,
  lifecycleEventAdapterVersion,
  capabilityHookRegistry,
  capabilityHooks,
} = {}) {
  const outputPath = normalizeText(catalogPath);
  if (!outputPath) {
    throw new Error('ApiCatalog catalogPath is required');
  }
  const auditPath = normalizeText(redactionAuditPath);
  const eventPath = normalizeText(lifecycleEventPath);
  const eventAuditPath = normalizeText(lifecycleEventRedactionAuditPath);
  const shouldWriteLifecycleEvent = Boolean(eventPath || eventAuditPath);
  if (shouldWriteLifecycleEvent && (!eventPath || !eventAuditPath)) {
    throw new Error('ApiCatalog collection lifecycle event and redaction audit paths must be provided together');
  }
  const normalizedCatalog = normalizeStoredApiCatalog(catalog);
  if (!auditPath) {
    throw new Error('ApiCatalog redactionAuditPath is required');
  }
  const prepared = prepareRedactedArtifactJsonWithAudit(normalizedCatalog);
  const lifecyclePrepared = shouldWriteLifecycleEvent
    ? prepareRedactedArtifactJsonWithAudit(createApiCatalogCollectionLifecycleEvent(normalizedCatalog, {
      createdAt: lifecycleEventCreatedAt ?? normalizedCatalog.generatedAt,
      traceId: lifecycleEventTraceId,
      correlationId: lifecycleEventCorrelationId,
      reasonCode: lifecycleEventReasonCode,
      taskType: lifecycleEventTaskType,
      adapterVersion: lifecycleEventAdapterVersion,
      capabilityHookRegistry,
      capabilityHooks,
    }))
    : null;

  await writeArtifactFileSetAtomically([
    { filePath: outputPath, text: prepared.json },
    { filePath: auditPath, text: prepared.auditJson },
    ...(lifecyclePrepared ? [
      { filePath: eventPath, text: lifecyclePrepared.json },
      { filePath: eventAuditPath, text: lifecyclePrepared.auditJson },
    ] : []),
  ], 'ApiCatalog collection writer');

  return {
    catalog: prepared.value,
    redactionSummary: summarizeRedactionAudit(prepared.auditValue),
    artifactPath: outputPath,
    redactionAuditPath: auditPath,
    redactionAudit: prepared.auditValue,
    ...(lifecyclePrepared ? {
      lifecycleEvent: lifecyclePrepared.value,
      lifecycleEventPath: eventPath,
      lifecycleEventRedactionAuditPath: eventAuditPath,
      lifecycleEventRedactionAudit: lifecyclePrepared.auditValue,
    } : {}),
  };
}

export async function writeApiCatalogCollectionStatusTransitionArtifact({
  catalogPath,
  redactionAuditPath,
  lifecycleEventPath,
  lifecycleEventRedactionAuditPath,
  lifecycleEventCreatedAt,
  lifecycleEventTraceId,
  lifecycleEventCorrelationId,
  lifecycleEventTaskType,
  lifecycleEventAdapterVersion,
  capabilityHookRegistry,
  capabilityHooks,
  candidateId,
  status,
  invalidationStatus,
  transitionedAt,
  reasonCode,
} = {}) {
  const outputPath = normalizeText(catalogPath);
  if (!outputPath) {
    throw new Error('ApiCatalog catalogPath is required');
  }
  const existingCatalog = await readApiCatalogCollectionIfExists(outputPath);
  if (!existingCatalog) {
    throw new Error('ApiCatalog status transition requires an existing catalog');
  }
  const catalog = transitionApiCatalogCollectionEntryStatus(existingCatalog, {
    candidateId,
    status,
    invalidationStatus,
    transitionedAt,
    reasonCode,
  });
  return await writeApiCatalogCollectionObjectArtifact(catalog, {
    catalogPath: outputPath,
    redactionAuditPath,
    lifecycleEventPath,
    lifecycleEventRedactionAuditPath,
    lifecycleEventCreatedAt,
    lifecycleEventTraceId,
    lifecycleEventCorrelationId,
    lifecycleEventReasonCode: reasonCode,
    lifecycleEventTaskType,
    lifecycleEventAdapterVersion,
    capabilityHookRegistry,
    capabilityHooks,
  });
}

export async function writeRuntimeApiCatalogMaintenanceArtifacts({
  maintenanceEvidence,
} = {}, {
  catalogPath,
  redactionAuditPath,
  lifecycleEventPath,
  lifecycleEventRedactionAuditPath,
  lifecycleEventCreatedAt,
  lifecycleEventTraceId,
  lifecycleEventCorrelationId,
  lifecycleEventTaskType,
  lifecycleEventAdapterVersion,
  capabilityHookRegistry,
  capabilityHooks,
} = {}) {
  let evidence;
  try {
    evidence = normalizeApiCatalogMaintenanceEvidence(maintenanceEvidence);
  } catch (error) {
    throw createApiCatalogMaintenanceFailure(error, { maintenanceEvidence });
  }
  const catalogCollection = await writeApiCatalogCollectionStatusTransitionArtifact({
    catalogPath,
    redactionAuditPath,
    lifecycleEventPath,
    lifecycleEventRedactionAuditPath,
    lifecycleEventCreatedAt,
    lifecycleEventTraceId,
    lifecycleEventCorrelationId,
    lifecycleEventTaskType,
    lifecycleEventAdapterVersion,
    capabilityHookRegistry,
    capabilityHooks,
    candidateId: evidence.candidateId,
    invalidationStatus: evidence.invalidationStatus,
    transitionedAt: evidence.verifiedAt,
    reasonCode: evidence.reasonCode,
  });
  return {
    maintenanceEvidence: evidence,
    catalogCollection,
  };
}

export async function writeApiCatalogCollectionArtifact(rawCandidates = [], {
  catalogPath,
  redactionAuditPath,
  lifecycleEventPath,
  lifecycleEventRedactionAuditPath,
  lifecycleEventCreatedAt,
  lifecycleEventTraceId,
  lifecycleEventCorrelationId,
  lifecycleEventTaskType,
  lifecycleEventAdapterVersion,
  capabilityHookRegistry,
  capabilityHooks,
  generatedAt,
  catalogId,
  catalogVersion,
  metadataByCandidateId = {},
} = {}) {
  const catalog = createApiCatalogCollection(rawCandidates, {
    generatedAt,
    catalogId,
    catalogVersion,
    metadataByCandidateId,
  });
  return await writeApiCatalogCollectionObjectArtifact(catalog, {
    catalogPath,
    redactionAuditPath,
    lifecycleEventPath,
    lifecycleEventRedactionAuditPath,
    lifecycleEventCreatedAt,
    lifecycleEventTraceId,
    lifecycleEventCorrelationId,
    lifecycleEventTaskType,
    lifecycleEventAdapterVersion,
    capabilityHookRegistry,
    capabilityHooks,
  });
}

export async function upsertApiCatalogCollectionArtifact(rawCandidates = [], {
  catalogPath,
  redactionAuditPath,
  lifecycleEventPath,
  lifecycleEventRedactionAuditPath,
  lifecycleEventCreatedAt,
  lifecycleEventTraceId,
  lifecycleEventCorrelationId,
  lifecycleEventTaskType,
  lifecycleEventAdapterVersion,
  capabilityHookRegistry,
  capabilityHooks,
  generatedAt,
  catalogId,
  catalogVersion,
  metadataByCandidateId = {},
} = {}) {
  const outputPath = normalizeText(catalogPath);
  if (!outputPath) {
    throw new Error('ApiCatalog catalogPath is required');
  }
  const existingCatalog = await readApiCatalogCollectionIfExists(outputPath);
  const incomingCatalog = createApiCatalogCollection(rawCandidates, {
    generatedAt,
    catalogId,
    catalogVersion,
    metadataByCandidateId,
  });
  const catalog = mergeApiCatalogCollections(existingCatalog, incomingCatalog, {
    generatedAt,
    catalogId,
    catalogVersion,
  });
  return await writeApiCatalogCollectionObjectArtifact(catalog, {
    catalogPath: outputPath,
    redactionAuditPath,
    lifecycleEventPath,
    lifecycleEventRedactionAuditPath,
    lifecycleEventCreatedAt,
    lifecycleEventTraceId,
    lifecycleEventCorrelationId,
    lifecycleEventTaskType,
    lifecycleEventAdapterVersion,
    capabilityHookRegistry,
    capabilityHooks,
  });
}

export async function writeApiCatalogIndexArtifact(rawCatalogs = [], {
  indexPath,
  redactionAuditPath,
  lifecycleEventPath,
  lifecycleEventRedactionAuditPath,
  lifecycleEventCreatedAt,
  lifecycleEventTraceId,
  lifecycleEventCorrelationId,
  lifecycleEventSiteKey,
  lifecycleEventTaskType,
  lifecycleEventAdapterVersion,
  capabilityHookRegistry,
  capabilityHooks,
  generatedAt,
  indexVersion,
} = {}) {
  const outputPath = normalizeText(indexPath);
  if (!outputPath) {
    throw new Error('ApiCatalogIndex indexPath is required');
  }
  const auditPath = normalizeText(redactionAuditPath);
  const eventPath = normalizeText(lifecycleEventPath);
  const eventAuditPath = normalizeText(lifecycleEventRedactionAuditPath);
  const shouldWriteLifecycleEvent = Boolean(eventPath || eventAuditPath);
  if (shouldWriteLifecycleEvent && (!eventPath || !eventAuditPath)) {
    throw new Error('ApiCatalogIndex lifecycle event and redaction audit paths must be provided together');
  }
  const index = createApiCatalogIndex(rawCatalogs, {
    generatedAt,
    indexVersion,
  });
  assertApiCatalogIndexCompatible(index);
  if (!auditPath) {
    throw new Error('ApiCatalogIndex redactionAuditPath is required');
  }
  const prepared = prepareRedactedArtifactJsonWithAudit(index);
  const lifecyclePrepared = shouldWriteLifecycleEvent
    ? prepareRedactedArtifactJsonWithAudit(createApiCatalogIndexLifecycleEvent(index, {
      createdAt: lifecycleEventCreatedAt ?? generatedAt,
      traceId: lifecycleEventTraceId,
      correlationId: lifecycleEventCorrelationId,
      siteKey: lifecycleEventSiteKey,
      taskType: lifecycleEventTaskType,
      adapterVersion: lifecycleEventAdapterVersion,
      capabilityHookRegistry,
      capabilityHooks,
    }))
    : null;

  await writeArtifactFileSetAtomically([
    { filePath: outputPath, text: prepared.json },
    { filePath: auditPath, text: prepared.auditJson },
    ...(lifecyclePrepared ? [
      { filePath: eventPath, text: lifecyclePrepared.json },
      { filePath: eventAuditPath, text: lifecyclePrepared.auditJson },
    ] : []),
  ], 'ApiCatalogIndex artifact writer');

  return {
    index: prepared.value,
    redactionSummary: summarizeRedactionAudit(prepared.auditValue),
    artifactPath: outputPath,
    redactionAuditPath: auditPath,
    redactionAudit: prepared.auditValue,
    ...(lifecyclePrepared ? {
      lifecycleEvent: lifecyclePrepared.value,
      lifecycleEventPath: eventPath,
      lifecycleEventRedactionAuditPath: eventAuditPath,
      lifecycleEventRedactionAudit: lifecyclePrepared.auditValue,
    } : {}),
  };
}
