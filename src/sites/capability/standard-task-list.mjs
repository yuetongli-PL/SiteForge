// @ts-check

import { normalizeReasonCode } from './reason-codes.mjs';
import {
  REDACTION_PLACEHOLDER,
  assertNoForbiddenPatterns,
  redactValue,
  redactUrl,
} from './security-guard.mjs';

export const STANDARD_TASK_LIST_SCHEMA_VERSION = 1;

export const STANDARD_TASK_ITEM_KINDS = Object.freeze([
  'request',
  'download',
  'page',
]);

const FORBIDDEN_TASK_KEYS = Object.freeze([
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
]);

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[-_]/gu, '');
}

const FORBIDDEN_TASK_KEY_SET = new Set(FORBIDDEN_TASK_KEYS.map((key) => normalizeKey(key)));

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function normalizeNonNegativeInteger(value, fallback, fieldName) {
  const numeric = Number(value ?? fallback);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`StandardTaskList ${fieldName} must be a non-negative number`);
  }
  return Math.trunc(numeric);
}

function assertNoCredentialContainers(value = {}) {
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (!current || typeof current !== 'object') {
      continue;
    }
    for (const [key, child] of Object.entries(current)) {
      if (FORBIDDEN_TASK_KEY_SET.has(normalizeKey(key))) {
        throw new Error(`StandardTaskList must not expose raw ${key}`);
      }
      pending.push(child);
    }
  }
}

function normalizeKind(value) {
  const normalized = normalizeText(value) ?? 'request';
  if (!STANDARD_TASK_ITEM_KINDS.includes(normalized)) {
    throw new Error(`Unsupported StandardTaskList item kind: ${normalized}`);
  }
  return normalized;
}

function normalizeMethod(value) {
  return (normalizeText(value) ?? 'GET').toUpperCase();
}

function normalizeMode(value) {
  const mode = normalizeText(value);
  if (!mode) {
    return undefined;
  }
  if (!['read', 'write'].includes(mode)) {
    throw new Error(`Unsupported StandardTaskList item mode: ${mode}`);
  }
  return mode;
}

function normalizeEndpoint(value) {
  const endpoint = normalizeText(value);
  if (!endpoint) {
    return undefined;
  }
  return redactUrl(endpoint).url;
}

function normalizePagination(value = undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return {
    type: normalizeText(value.type) ?? 'none',
    cursorField: normalizeText(value.cursorField),
    pageSize: value.pageSize === undefined
      ? undefined
      : normalizeNonNegativeInteger(value.pageSize, 0, 'pagination.pageSize'),
  };
}

function normalizeRetry(value = undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      retries: 0,
      retryBackoffMs: 0,
    };
  }
  return {
    retries: normalizeNonNegativeInteger(value.retries, 0, 'retry.retries'),
    retryBackoffMs: normalizeNonNegativeInteger(value.retryBackoffMs, 0, 'retry.retryBackoffMs'),
  };
}

function normalizeHealthGate(value = undefined) {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('StandardTaskList item healthGate must be an object');
  }
  const redacted = redactValue(value).value;
  assertNoForbiddenPatterns(redacted);
  return stripUndefined({
    schemaVersion: redacted.schemaVersion,
    allowed: Boolean(redacted.allowed),
    mode: normalizeText(redacted.mode),
    capability: normalizeText(redacted.capability),
    status: normalizeText(redacted.status),
    reason: normalizeText(redacted.reason),
    artifactWriteAllowed: Boolean(redacted.artifactWriteAllowed),
    blockedCapabilities: Array.isArray(redacted.blockedCapabilities)
      ? redacted.blockedCapabilities.map(normalizeText).filter(Boolean)
      : undefined,
    recommendedActions: Array.isArray(redacted.recommendedActions)
      ? redacted.recommendedActions.map(normalizeText).filter(Boolean)
      : undefined,
    capabilityState: normalizeText(redacted.capabilityState),
    siteStatus: normalizeText(redacted.siteStatus),
  });
}

function stripUndefined(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function normalizeTaskItem(raw = {}, index = 0) {
  assertNoCredentialContainers(raw);
  const reasonCode = normalizeText(raw.reasonCode);
  const item = stripUndefined({
    id: normalizeText(raw.id) ?? `task-${index + 1}`,
    kind: normalizeKind(raw.kind),
    endpoint: normalizeEndpoint(raw.endpoint ?? raw.url),
    method: normalizeMethod(raw.method),
    capability: normalizeText(raw.capability ?? raw.capabilityKey),
    mode: normalizeMode(raw.mode ?? raw.accessMode ?? raw.operationMode),
    pagination: normalizePagination(raw.pagination),
    retry: normalizeRetry(raw.retry),
    cacheKey: normalizeText(raw.cacheKey),
    dedupKey: normalizeText(raw.dedupKey),
    reasonCode: reasonCode ? normalizeReasonCode(reasonCode) : undefined,
    healthGate: normalizeHealthGate(raw.healthGate),
  });
  if (!item.endpoint) {
    throw new Error('StandardTaskList item endpoint is required');
  }
  return item;
}

export function assertStandardTaskListCompatible(raw = {}) {
  const version = Number(raw?.schemaVersion);
  if (!Number.isInteger(version)) {
    throw new Error('StandardTaskList schemaVersion is required for compatibility checks');
  }
  if (version !== STANDARD_TASK_LIST_SCHEMA_VERSION) {
    throw new Error(`StandardTaskList schemaVersion ${version} is not compatible with ${STANDARD_TASK_LIST_SCHEMA_VERSION}`);
  }
  return true;
}

export function normalizeStandardTaskList(raw = {}, defaults = {}) {
  if (raw.schemaVersion !== undefined) {
    assertStandardTaskListCompatible(raw);
  }
  const siteKey = normalizeText(raw.siteKey ?? defaults.siteKey);
  if (!siteKey) {
    throw new Error('StandardTaskList siteKey is required');
  }
  if (!Array.isArray(raw.items)) {
    throw new Error('StandardTaskList items must be an array');
  }
  const taskList = {
    schemaVersion: STANDARD_TASK_LIST_SCHEMA_VERSION,
    siteKey,
    taskType: normalizeText(raw.taskType ?? defaults.taskType) ?? 'generic-resource',
    policyRef: normalizeText(raw.policyRef ?? defaults.policyRef),
    items: raw.items.map((item, index) => normalizeTaskItem(item, index)),
  };
  assertNoForbiddenPatterns(taskList);
  return taskList;
}

export { REDACTION_PLACEHOLDER };
