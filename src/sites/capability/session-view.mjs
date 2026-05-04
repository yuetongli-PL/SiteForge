// @ts-check

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  normalizeReasonCode,
  requireReasonCodeDefinition,
} from './reason-codes.mjs';
import {
  REDACTION_PLACEHOLDER,
  assertNoForbiddenPatterns,
  redactValue,
} from './security-guard.mjs';

export const SESSION_VIEW_SCHEMA_VERSION = 1;
export const SESSION_VIEW_MATERIALIZATION_AUDIT_SCHEMA_VERSION = 1;
export const SESSION_REVOCATION_STORE_SCHEMA_VERSION = 1;

const DIAGNOSTIC_MAX_TTL_SECONDS = 300;
const DIAGNOSTIC_ALLOWED_PERMISSIONS = new Set(['read', 'observe', 'diagnose']);
const DIAGNOSTIC_UNSAFE_SCOPE_TOKENS = Object.freeze([
  'artifactwrite',
  'browserprofile',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'download',
  'header',
  'headers',
  'persist',
  'profilepath',
  'rawsession',
  'sessionmaterial',
  'upload',
  'write',
]);
const DIAGNOSTIC_IDENTITY_SCOPE_TOKENS = Object.freeze([
  'account',
  'accountid',
  'accountname',
  'browserprofile',
  'devicefingerprint',
  'fingerprint',
  'identity',
  'ipaddress',
  'networkidentity',
  'profile',
  'profileid',
  'session',
  'sessionid',
  'userid',
  'username',
  'userhandle',
]);
const DOWNLOAD_PURPOSE_TOKENS = new Set(['download', 'downloader']);
const DOWNLOAD_PERMISSION_TOKENS = Object.freeze([
  'download',
  'downloadmedia',
  'downloadresource',
  'fetchdownload',
  'writedownload',
]);
const BROAD_SCOPE_TOKENS = Object.freeze([
  'all',
  'allsites',
  'any',
  'global',
  'crosssite',
  'browser',
  'browserprofile',
  'profile',
  'session',
  'sessionmaterial',
]);
const RAW_REF_SCOPE_PATTERNS = Object.freeze([
  /[A-Za-z]:[\\/]/u,
  /(?:^|[\\/])browser-profile(?:s)?(?:[\\/]|$)/iu,
  /(?:^|[\\/])user-data-dir(?:[\\/]|$)/iu,
  /(?:^|[\\/])session(?:s)?(?:[\\/]|$)/iu,
  /\b(?:profile|session)[_-]?ref\b/iu,
]);
const REVOCATION_ALLOWED_STATUSES = new Set(['ready', 'revoked', 'expired']);
const REVOCATION_RECORD_ALLOWED_KEYS = new Set(['handle', 'reasonCode', 'status', 'ttlSeconds', 'expiresAt']);
const REVOCATION_HANDLE_UNSAFE_TOKENS = Object.freeze([
  'authorization',
  'bearer',
  'browserprofile',
  'cookie',
  'csrf',
  'profilepath',
  'sessdata',
  'sessionid',
  'token',
  'userdata',
  'xsrf',
]);

const FORBIDDEN_CREDENTIAL_KEYS = Object.freeze([
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
const FORBIDDEN_IDENTITY_KEYS = Object.freeze([
  'account',
  'accountId',
  'account_id',
  'accountName',
  'account_name',
  'browserProfile',
  'browser_profile',
  'deviceFingerprint',
  'device_fingerprint',
  'ipAddress',
  'ip_address',
  'networkIdentity',
  'network_identity',
  'profile',
  'profileId',
  'profile_id',
  'session',
  'sessionRef',
  'session_ref',
  'userHandle',
  'user_handle',
  'userId',
  'user_id',
  'username',
]);

function normalizeCredentialKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[-_]/gu, '');
}

function normalizeBoundaryToken(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function assertScopeDoesNotExposeRawRefs(scope, label) {
  const text = String(scope ?? '').trim();
  if (RAW_REF_SCOPE_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new Error(`SessionView ${label} scope ${scope} must not expose raw profile/session refs`);
  }
  return true;
}

const FORBIDDEN_CREDENTIAL_KEY_SET = new Set(
  FORBIDDEN_CREDENTIAL_KEYS.map((key) => normalizeCredentialKey(key)),
);
const FORBIDDEN_IDENTITY_KEY_SET = new Set(
  FORBIDDEN_IDENTITY_KEYS.map((key) => normalizeCredentialKey(key)),
);
const FORBIDDEN_BOUNDARY_KEY_SET = new Set([
  ...FORBIDDEN_CREDENTIAL_KEY_SET,
  ...FORBIDDEN_IDENTITY_KEY_SET,
]);

export function assertSessionViewCompatible(raw = {}) {
  const version = Number(raw?.schemaVersion);
  if (!Number.isInteger(version)) {
    throw new Error('SessionView schemaVersion is required for compatibility checks');
  }
  if (version !== SESSION_VIEW_SCHEMA_VERSION) {
    throw new Error(`SessionView schemaVersion ${version} is not compatible with ${SESSION_VIEW_SCHEMA_VERSION}`);
  }
  return true;
}

export function assertSessionViewMaterializationAuditCompatible(raw = {}) {
  const version = Number(raw?.schemaVersion);
  if (!Number.isInteger(version)) {
    throw new Error('SessionView materialization audit schemaVersion is required for compatibility checks');
  }
  if (version !== SESSION_VIEW_MATERIALIZATION_AUDIT_SCHEMA_VERSION) {
    throw new Error(
      `SessionView materialization audit schemaVersion ${version} is not compatible with ${SESSION_VIEW_MATERIALIZATION_AUDIT_SCHEMA_VERSION}`,
    );
  }
  const sessionViewVersion = Number(raw?.sessionViewSchemaVersion);
  if (!Number.isInteger(sessionViewVersion)) {
    throw new Error('SessionView materialization audit sessionViewSchemaVersion is required');
  }
  if (sessionViewVersion !== SESSION_VIEW_SCHEMA_VERSION) {
    throw new Error(
      `SessionView materialization audit sessionViewSchemaVersion ${sessionViewVersion} is not compatible with ${SESSION_VIEW_SCHEMA_VERSION}`,
    );
  }
  if (raw.eventType !== 'session.materialized') {
    throw new Error('SessionView materialization audit eventType must be session.materialized');
  }
  if (raw.boundary !== 'SessionView') {
    throw new Error('SessionView materialization audit boundary must be SessionView');
  }
  if (raw.rawCredentialAccess !== false) {
    throw new Error('SessionView materialization audit rawCredentialAccess must be false');
  }
  if (raw.artifactPersistenceAllowed !== false) {
    throw new Error('SessionView materialization audit artifactPersistenceAllowed must be false');
  }
  const revocation = raw.revocation;
  if (!revocation || typeof revocation !== 'object' || Array.isArray(revocation)) {
    throw new Error('SessionView materialization audit revocation summary is required');
  }
  if (revocation.boundary !== 'SessionProvider') {
    throw new Error('SessionView materialization audit revocation boundary must be SessionProvider');
  }
  if (typeof revocation.handlePresent !== 'boolean') {
    throw new Error('SessionView materialization audit revocation handlePresent must be boolean');
  }
  if (revocation.handlePresent) {
    normalizeRevocationHandleRef(revocation.handleRef);
  } else {
    const reasonCode = normalizeReasonCode(revocation.reasonCode);
    if (!reasonCode) {
      throw new Error('SessionView materialization audit revocation reasonCode is required when handle is absent');
    }
    requireReasonCodeDefinition(reasonCode, { family: 'session' });
  }
  if (!assertNoForbiddenPatterns(raw)) {
    throw new Error('SessionView materialization audit contains forbidden sensitive material');
  }
  return true;
}

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => normalizeText(entry)).filter(Boolean);
}

function normalizeProfileRef(value) {
  const text = normalizeText(value);
  if (!text || text === 'anonymous') {
    return text ?? 'anonymous';
  }
  return REDACTION_PLACEHOLDER;
}

function normalizeTtlSeconds(value) {
  const numeric = Number(value ?? 300);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error('SessionView ttlSeconds must be a positive number');
  }
  return Math.trunc(numeric);
}

function omitCredentialContainers(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => omitCredentialContainers(entry));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_BOUNDARY_KEY_SET.has(normalizeCredentialKey(key))) {
      continue;
    }
    output[key] = omitCredentialContainers(child);
  }
  return output;
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? redactValue(omitCredentialContainers(value)).value
    : {};
}

function normalizeRevocationHandleRef(value) {
  const text = normalizeText(value);
  if (!text) {
    return undefined;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(text)) {
    throw new Error('SessionView revocation handleRef must be a safe opaque reference');
  }
  const normalized = normalizeBoundaryToken(text);
  if (REVOCATION_HANDLE_UNSAFE_TOKENS.some((token) => normalized.includes(token))) {
    throw new Error('SessionView revocation handleRef must be a safe opaque reference');
  }
  assertNoForbiddenPatterns({ revocationHandleRef: text });
  return text;
}

function requireRevocationHandleRef(value) {
  const handle = normalizeRevocationHandleRef(value);
  if (!handle) {
    throw new Error('SessionView revocation handleRef is required');
  }
  return handle;
}

function normalizeRevocationStatus(value) {
  const status = normalizeText(value) ?? 'ready';
  if (!REVOCATION_ALLOWED_STATUSES.has(status)) {
    throw new Error(`SessionView revocation status ${status} is not supported`);
  }
  return status;
}

function normalizeRevocationReasonCode(value, { required = false } = {}) {
  const reasonCode = normalizeReasonCode(value);
  if (!reasonCode) {
    if (required) {
      throw new Error('SessionView revocation reasonCode is required');
    }
    return undefined;
  }
  requireReasonCodeDefinition(reasonCode, { family: 'session' });
  return reasonCode;
}

function normalizeRevocationTtlSeconds(value) {
  const ttlSeconds = normalizeTtlSeconds(value);
  if (ttlSeconds > 86400) {
    throw new Error('SessionView revocation ttlSeconds must not exceed 86400');
  }
  return ttlSeconds;
}

function normalizeRevocationExpiresAt(value, { ttlSeconds, now = new Date() } = {}) {
  const text = normalizeText(value);
  const expiresAt = text ?? new Date(Number(now) + ttlSeconds * 1000).toISOString();
  if (!Number.isFinite(Date.parse(expiresAt))) {
    throw new Error('SessionView revocation expiresAt must be an ISO-compatible timestamp');
  }
  return expiresAt;
}

function assertRevocationRecordKeys(raw = {}) {
  for (const key of Object.keys(raw)) {
    if (!REVOCATION_RECORD_ALLOWED_KEYS.has(key)) {
      throw new Error(`SessionView revocation record field ${key} is not compatible`);
    }
  }
}

function normalizeRevocationRecord(raw = {}, { now = new Date() } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('SessionView revocation record must be an object');
  }
  assertRevocationRecordKeys(raw);
  const status = normalizeRevocationStatus(raw.status);
  const reasonCode = normalizeRevocationReasonCode(raw.reasonCode, {
    required: status !== 'ready',
  });
  const ttlSeconds = normalizeRevocationTtlSeconds(raw.ttlSeconds);
  const record = {
    handle: requireRevocationHandleRef(raw.handle),
    status,
    ttlSeconds,
    expiresAt: normalizeRevocationExpiresAt(raw.expiresAt, { ttlSeconds, now }),
  };
  if (reasonCode) {
    record.reasonCode = reasonCode;
  }
  if (!assertNoForbiddenPatterns(record)) {
    throw new Error('SessionView revocation record contains forbidden sensitive material');
  }
  return Object.freeze(record);
}

function revocationStorePayloadFromEntries(records = []) {
  return {
    schemaVersion: SESSION_REVOCATION_STORE_SCHEMA_VERSION,
    records: records.map((record) => ({ ...record })),
  };
}

function normalizeRevocationStorePayload(raw = {}, { now = new Date() } = {}) {
  const version = Number(raw?.schemaVersion);
  if (!Number.isInteger(version)) {
    throw new Error('SessionView revocation store schemaVersion is required for compatibility checks');
  }
  if (version !== SESSION_REVOCATION_STORE_SCHEMA_VERSION) {
    throw new Error(
      `SessionView revocation store schemaVersion ${version} is not compatible with ${SESSION_REVOCATION_STORE_SCHEMA_VERSION}`,
    );
  }
  if (!Array.isArray(raw.records)) {
    throw new Error('SessionView revocation store records are required');
  }
  const seenHandles = new Set();
  const records = raw.records.map((record) => {
    const normalized = normalizeRevocationRecord(record, { now });
    if (seenHandles.has(normalized.handle)) {
      throw new Error('SessionView revocation store contains duplicate handles');
    }
    seenHandles.add(normalized.handle);
    return normalized;
  });
  const payload = revocationStorePayloadFromEntries(records);
  if (!assertNoForbiddenPatterns(payload)) {
    throw new Error('SessionView revocation store contains forbidden sensitive material');
  }
  return payload;
}

function readRevocationStorePayload(filePath, { now = new Date() } = {}) {
  if (!existsSync(filePath)) {
    return {
      schemaVersion: SESSION_REVOCATION_STORE_SCHEMA_VERSION,
      records: [],
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`SessionView revocation store could not be read safely: ${error.message}`);
  }
  return normalizeRevocationStorePayload(parsed, { now });
}

function recordMapFromPayload(payload = {}) {
  const records = new Map();
  for (const record of payload.records ?? []) {
    records.set(record.handle, Object.freeze({ ...record }));
  }
  return records;
}

function serializeSessionRevocationStore(store = {}) {
  return revocationStorePayloadFromEntries([...store.records.values()]);
}

function persistSessionRevocationStore(store = {}) {
  if (!store.filePath) {
    return serializeSessionRevocationStore(store);
  }
  const payload = normalizeRevocationStorePayload(serializeSessionRevocationStore(store));
  mkdirSync(dirname(store.filePath), { recursive: true });
  writeFileSync(store.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

function revocationRecordExpired(record = {}, now = new Date()) {
  return Date.parse(record.expiresAt) <= Number(now);
}

export function assertSessionRevocationStoreCompatible(raw = {}) {
  normalizeRevocationStorePayload(raw);
  return true;
}

export function createSessionRevocationStore({ filePath, records, now = new Date() } = {}) {
  const payload = filePath
    ? readRevocationStorePayload(filePath, { now })
    : normalizeRevocationStorePayload({
      schemaVersion: SESSION_REVOCATION_STORE_SCHEMA_VERSION,
      records: records ?? [],
    }, { now });
  return {
    schemaVersion: SESSION_REVOCATION_STORE_SCHEMA_VERSION,
    filePath: normalizeText(filePath),
    records: recordMapFromPayload(payload),
  };
}

export function registerSessionRevocationHandle(store, raw = {}, { now = new Date() } = {}) {
  const record = normalizeRevocationRecord({
    handle: raw.handle ?? raw.handleRef ?? raw.revocationHandleRef,
    status: 'ready',
    ttlSeconds: raw.ttlSeconds,
    expiresAt: raw.expiresAt,
  }, { now });
  store.records.set(record.handle, record);
  persistSessionRevocationStore(store);
  return { ...record };
}

export function revokeSessionRevocationHandle(store, handleRef, {
  reasonCode = 'session-invalid',
  ttlSeconds,
  expiresAt,
  now = new Date(),
} = {}) {
  const handle = requireRevocationHandleRef(handleRef);
  const existing = store.records.get(handle);
  if (!existing) {
    throw new Error('SessionView revocation handle is not registered');
  }
  const record = normalizeRevocationRecord({
    handle,
    status: 'revoked',
    reasonCode,
    ttlSeconds: ttlSeconds ?? existing.ttlSeconds,
    expiresAt: expiresAt ?? existing.expiresAt,
  }, { now });
  store.records.set(handle, record);
  persistSessionRevocationStore(store);
  return { ...record };
}

export function assertSessionRevocationAllowed(store, handleRef, { now = new Date() } = {}) {
  if (!store || typeof store !== 'object' || !(store.records instanceof Map)) {
    throw new Error('SessionView revocation store is required');
  }
  assertSessionRevocationStoreCompatible(serializeSessionRevocationStore(store));
  const handle = requireRevocationHandleRef(handleRef);
  const record = store.records.get(handle);
  if (!record) {
    throw new Error('SessionView revocation handle is not registered');
  }
  const normalized = normalizeRevocationRecord(record, { now });
  if (revocationRecordExpired(normalized, now)) {
    throw new Error('SessionView revocation handle is expired');
  }
  if (normalized.status !== 'ready') {
    throw new Error(`SessionView revocation handle is ${normalized.status}`);
  }
  return true;
}

function assertDiagnosticLeastPrivilege(view = {}) {
  if (normalizeBoundaryToken(view.purpose) !== 'diagnostic') {
    return true;
  }
  if (view.ttlSeconds > DIAGNOSTIC_MAX_TTL_SECONDS) {
    throw new Error(`SessionView diagnostic ttlSeconds must not exceed ${DIAGNOSTIC_MAX_TTL_SECONDS}`);
  }
  for (const permission of view.permission ?? []) {
    const normalized = normalizeBoundaryToken(permission);
    if (!DIAGNOSTIC_ALLOWED_PERMISSIONS.has(normalized)) {
      throw new Error(`SessionView diagnostic permission ${permission} is not least-privilege`);
    }
  }
  for (const scope of view.scope ?? []) {
    const normalized = normalizeBoundaryToken(scope);
    if (DIAGNOSTIC_UNSAFE_SCOPE_TOKENS.some((token) => normalized.includes(token))) {
      throw new Error(`SessionView diagnostic scope ${scope} crosses the trust boundary`);
    }
    if (DIAGNOSTIC_IDENTITY_SCOPE_TOKENS.some((token) => normalized.includes(token))) {
      throw new Error(`SessionView diagnostic scope ${scope} exposes identity-like trust-boundary material`);
    }
  }
  return true;
}

function assertPurposeIsolation(view = {}) {
  const purpose = normalizeBoundaryToken(view.purpose);
  const isDownloadPurpose = DOWNLOAD_PURPOSE_TOKENS.has(purpose);
  for (const scope of view.scope ?? []) {
    assertScopeDoesNotExposeRawRefs(scope, view.purpose);
    const normalized = normalizeBoundaryToken(scope);
    if (!isDownloadPurpose && BROAD_SCOPE_TOKENS.some((token) => normalized === token || normalized.includes(token))) {
      throw new Error(`SessionView ${view.purpose} scope ${scope} is broader than its purpose`);
    }
    if (!isDownloadPurpose && normalized.includes('download')) {
      throw new Error(`SessionView ${view.purpose} scope ${scope} cannot request download access`);
    }
  }
  if (isDownloadPurpose) {
    return true;
  }
  for (const permission of view.permission ?? []) {
    const normalized = normalizeBoundaryToken(permission);
    if (DOWNLOAD_PERMISSION_TOKENS.some((token) => normalized === token || normalized.includes(token))) {
      throw new Error(`SessionView ${view.purpose} permission ${permission} cannot request download access`);
    }
  }
  return true;
}

export function normalizeSessionView(raw = {}) {
  const siteKey = normalizeText(raw.siteKey);
  if (!siteKey) {
    throw new Error('SessionView siteKey is required');
  }
  const ttlSeconds = normalizeTtlSeconds(raw.ttlSeconds);
  const reasonCode = normalizeText(raw.reasonCode);
  const view = {
    schemaVersion: SESSION_VIEW_SCHEMA_VERSION,
    siteKey,
    profileRef: normalizeProfileRef(raw.profileRef),
    purpose: normalizeText(raw.purpose) ?? 'diagnostic',
    scope: normalizeStringList(raw.scope),
    permission: normalizeStringList(raw.permission),
    ttlSeconds,
    expiresAt: normalizeText(raw.expiresAt),
    networkContext: normalizeObject(raw.networkContext),
    status: normalizeText(raw.status) ?? 'ready',
    reasonCode: reasonCode ? normalizeReasonCode(reasonCode) : undefined,
    riskSignals: redactValue(normalizeStringList(raw.riskSignals)).value,
  };
  assertDiagnosticLeastPrivilege(view);
  assertPurposeIsolation(view);
  assertSessionViewSafe(view);
  return view;
}

export function createSessionViewMaterializationAudit(raw = {}, context = {}) {
  const view = normalizeSessionView(raw);
  const materializedAt = normalizeText(context.materializedAt ?? raw.materializedAt);
  const revocationHandleRef = normalizeRevocationHandleRef(
    context.revocationHandleRef ?? raw.revocationHandleRef ?? raw.revocation?.handleRef,
  );
  const revocation = revocationHandleRef
    ? {
      boundary: 'SessionProvider',
      handlePresent: true,
      handleRef: revocationHandleRef,
    }
    : {
      boundary: 'SessionProvider',
      handlePresent: false,
      reasonCode: normalizeReasonCode('session-revocation-handle-missing'),
    };
  const audit = {
    schemaVersion: SESSION_VIEW_MATERIALIZATION_AUDIT_SCHEMA_VERSION,
    sessionViewSchemaVersion: view.schemaVersion,
    eventType: 'session.materialized',
    boundary: 'SessionView',
    siteKey: view.siteKey,
    profileRef: view.profileRef,
    purpose: view.purpose,
    scope: view.scope,
    permission: view.permission,
    ttlSeconds: view.ttlSeconds,
    expiresAt: view.expiresAt,
    status: view.status,
    reasonCode: view.reasonCode,
    materializedAt,
    rawCredentialAccess: false,
    artifactPersistenceAllowed: false,
    purposeIsolation: {
      enforced: true,
      purpose: view.purpose,
      scope: view.scope,
    },
    revocation,
  };
  if (!assertNoForbiddenPatterns(audit)) {
    throw new Error('SessionView materialization audit contains forbidden sensitive material');
  }
  assertSessionViewMaterializationAuditCompatible(audit);
  return Object.fromEntries(Object.entries(audit).filter(([, value]) => value !== undefined));
}

export function assertSessionViewSafe(view = {}) {
  if (!assertNoForbiddenPatterns(view)) {
    throw new Error('SessionView contains forbidden sensitive material');
  }
  const serialized = JSON.stringify(view);
  const pending = [view];
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
      const normalizedKey = normalizeCredentialKey(key);
      if (FORBIDDEN_CREDENTIAL_KEY_SET.has(normalizedKey)) {
        throw new Error(`SessionView must not expose raw ${key}`);
      }
      if (FORBIDDEN_IDENTITY_KEY_SET.has(normalizedKey)) {
        throw new Error(`SessionView must not expose trust-boundary identity field ${key}`);
      }
      pending.push(child);
    }
  }
  if (/synthetic-(?:cookie|token|csrf|session)/u.test(serialized)) {
    throw new Error('SessionView contains synthetic secret material');
  }
  return true;
}
