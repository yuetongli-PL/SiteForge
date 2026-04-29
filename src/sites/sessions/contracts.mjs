// @ts-check

import path from 'node:path';

import {
  SESSION_LEASE_STATUSES,
  SESSION_REQUIREMENTS,
  inferSiteKeyFromHost,
  stableId,
  timestampForRun,
} from '../downloads/contracts.mjs';
import { compactSlug, normalizeText, sanitizeHost } from '../../shared/normalize.mjs';

export const SESSION_RUN_MANIFEST_SCHEMA_VERSION = 1;

export const SESSION_PURPOSES = Object.freeze([
  'download',
  'archive',
  'followed',
  'keepalive',
  'doctor',
  'health-check',
]);

export const SESSION_RUN_STATUSES = Object.freeze([
  'passed',
  'blocked',
  'manual-required',
  'quarantine',
  'expired',
]);

function enumValue(value, allowed, fallback) {
  const normalized = normalizeText(value);
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeStringList(value = []) {
  return [...new Set((Array.isArray(value) ? value : [value])
    .map((entry) => normalizeText(entry))
    .filter(Boolean))];
}

function stripEmptyObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => {
    if (entry === undefined || entry === null || entry === '') {
      return false;
    }
    if (Array.isArray(entry)) {
      return entry.length > 0;
    }
    if (typeof entry === 'object') {
      return Object.keys(entry).length > 0;
    }
    return true;
  }));
}

function hasSecretLikeFields(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && (Object.hasOwn(value, 'cookies') || Object.hasOwn(value, 'headers'));
}

function normalizeSessionRepairPlan(value = undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return stripEmptyObject({
    action: normalizeText(value.action ?? value.suggestedAction),
    command: normalizeText(value.command),
    reason: normalizeText(value.reason),
    riskSignals: normalizeStringList(value.riskSignals),
    requiresApproval: value.requiresApproval === undefined ? true : value.requiresApproval === true,
    notBefore: normalizeText(value.notBefore),
  });
}

export function createSessionPlanId({ siteKey, purpose, seed } = {}) {
  return `session-plan-${compactSlug(siteKey || 'site')}-${compactSlug(purpose || 'health-check')}-${stableId([
    siteKey,
    purpose,
    seed,
  ])}`;
}

export function createSessionRunId({ siteKey, purpose, seed } = {}) {
  return `session-run-${compactSlug(siteKey || 'site')}-${compactSlug(purpose || 'health-check')}-${stableId([
    siteKey,
    purpose,
    seed,
  ])}`;
}

export function normalizeSessionPlan(raw = {}, defaults = {}) {
  const host = sanitizeHost(normalizeText(raw.host ?? defaults.host));
  const siteKey = normalizeText(raw.siteKey ?? raw.site ?? defaults.siteKey ?? inferSiteKeyFromHost(host));
  const purpose = enumValue(raw.purpose ?? defaults.purpose, SESSION_PURPOSES, 'health-check');
  const createdAt = normalizeText(raw.createdAt ?? defaults.createdAt) || new Date().toISOString();
  return {
    id: normalizeText(raw.id ?? defaults.id) || createSessionPlanId({ siteKey, purpose, seed: createdAt }),
    siteKey,
    host,
    purpose,
    sessionRequirement: enumValue(
      raw.sessionRequirement ?? defaults.sessionRequirement,
      SESSION_REQUIREMENTS,
      'optional',
    ),
    dryRun: raw.dryRun === undefined ? true : raw.dryRun !== false,
    profilePath: normalizeText(raw.profilePath ?? defaults.profilePath) || undefined,
    browserProfileRoot: normalizeText(raw.browserProfileRoot ?? defaults.browserProfileRoot) || undefined,
    userDataDir: normalizeText(raw.userDataDir ?? defaults.userDataDir) || undefined,
    verificationUrl: normalizeText(raw.verificationUrl ?? defaults.verificationUrl) || undefined,
    keepaliveUrl: normalizeText(raw.keepaliveUrl ?? defaults.keepaliveUrl) || undefined,
    createdAt,
  };
}

export function sanitizeSessionPlanForManifest(plan = {}) {
  const normalized = normalizeSessionPlan(plan);
  return stripEmptyObject({
    id: normalized.id,
    siteKey: normalized.siteKey,
    host: normalized.host,
    purpose: normalized.purpose,
    sessionRequirement: normalized.sessionRequirement,
    dryRun: normalized.dryRun,
    profilePathPresent: Boolean(normalized.profilePath),
    browserProfileRootPresent: Boolean(normalized.browserProfileRoot),
    userDataDirPresent: Boolean(normalized.userDataDir),
    verificationUrl: normalized.verificationUrl,
    keepaliveUrl: normalized.keepaliveUrl,
    createdAt: normalized.createdAt,
  });
}

export function normalizeSessionHealth(raw = {}, defaults = {}) {
  const host = sanitizeHost(normalizeText(raw.host ?? defaults.host));
  const siteKey = normalizeText(raw.siteKey ?? raw.site ?? defaults.siteKey ?? inferSiteKeyFromHost(host));
  const status = enumValue(raw.status ?? defaults.status, SESSION_LEASE_STATUSES, 'blocked');
  const reason = normalizeText(raw.reason ?? raw.riskCauseCode ?? defaults.reason ?? defaults.riskCauseCode);
  const repairPlan = normalizeSessionRepairPlan(raw.repairPlan ?? defaults.repairPlan);
  const authStatus = normalizeText(raw.authStatus ?? defaults.authStatus)
    || (status === 'ready' ? 'authenticated-or-anonymous-ok' : 'unknown');
  return stripEmptyObject({
    siteKey,
    host,
    status,
    mode: normalizeText(raw.mode ?? defaults.mode),
    authStatus,
    identityConfirmed: raw.identityConfirmed === undefined
      ? defaults.identityConfirmed
      : raw.identityConfirmed === true,
    riskCauseCode: normalizeText(raw.riskCauseCode ?? reason),
    riskAction: normalizeText(raw.riskAction ?? defaults.riskAction),
    riskSignals: normalizeStringList(raw.riskSignals ?? defaults.riskSignals),
    reason,
    expiresAt: normalizeText(raw.expiresAt ?? defaults.expiresAt),
    repairPlan,
  });
}

export function sessionRunStatusFromHealth(health = {}) {
  const status = enumValue(health.status, SESSION_LEASE_STATUSES, 'blocked');
  if (status === 'ready') {
    return 'passed';
  }
  return status;
}

export function defaultSessionRunDir({ siteKey, purpose, outDir, createdAt } = {}) {
  const root = path.resolve(outDir ?? path.join('runs', 'session'));
  return path.join(root, compactSlug(siteKey || 'site'), `${timestampForRun(new Date(createdAt ?? Date.now()))}_${compactSlug(purpose || 'health-check')}`);
}

export function normalizeSessionRunManifest(raw = {}, defaults = {}) {
  const plan = sanitizeSessionPlanForManifest(raw.plan ?? defaults.plan ?? raw);
  const health = normalizeSessionHealth(raw.health ?? defaults.health, {
    siteKey: plan.siteKey,
    host: plan.host,
  });
  const repairPlan = normalizeSessionRepairPlan(raw.repairPlan ?? defaults.repairPlan ?? health.repairPlan);
  const createdAt = normalizeText(raw.createdAt ?? defaults.createdAt) || new Date().toISOString();
  const finishedAt = normalizeText(raw.finishedAt ?? defaults.finishedAt) || createdAt;
  const runId = normalizeText(raw.runId ?? defaults.runId)
    || createSessionRunId({ siteKey: plan.siteKey, purpose: plan.purpose, seed: createdAt });
  const artifacts = stripEmptyObject({
    manifest: normalizeText(raw.artifacts?.manifest ?? defaults.artifacts?.manifest),
    runDir: normalizeText(raw.artifacts?.runDir ?? defaults.artifacts?.runDir),
  });
  const status = enumValue(raw.status ?? defaults.status, SESSION_RUN_STATUSES, sessionRunStatusFromHealth(health));
  const reason = normalizeText(raw.reason ?? defaults.reason ?? health.reason ?? health.riskCauseCode);

  return {
    schemaVersion: SESSION_RUN_MANIFEST_SCHEMA_VERSION,
    runId,
    planId: plan.id,
    siteKey: plan.siteKey,
    host: plan.host,
    purpose: plan.purpose,
    status,
    reason: status === 'passed' ? undefined : reason,
    dryRun: plan.dryRun,
    plan,
    health,
    repairPlan,
    artifacts,
    createdAt,
    finishedAt,
  };
}

export function assertManifestIsSanitized(manifest = {}) {
  const serialized = JSON.stringify(manifest);
  if (hasSecretLikeFields(manifest) || /cookie|authorization|bearer|userDataDir["']?\s*:/iu.test(serialized)) {
    throw new Error('Session manifest contains sensitive auth material');
  }
  return manifest;
}
