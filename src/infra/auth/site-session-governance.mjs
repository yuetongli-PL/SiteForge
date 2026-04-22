import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createHash, randomUUID } from 'node:crypto';

import {
  appendJsonLine,
  ensureDir,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from '../io.mjs';
import { cleanText, toArray, uniqueSortedStrings } from '../../shared/normalize.mjs';

const DEFAULT_KEEPALIVE_INTERVAL_MINUTES = 120;
const DEFAULT_RISK_COOLDOWN_MINUTES = 60;
const NETWORK_LOOKUP_TIMEOUT_MS = 3_500;
const NETWORK_CACHE_TTL_MS = 60_000;
const SESSION_LEASE_POLL_INTERVAL_MS = 250;
const STATE_DIRNAME = '.bws';
const HEALTHY_NETWORK_STATE_FILE = 'healthy-network.json';
const SESSION_LEASE_FILE = 'session-lease.json';
const QUARANTINE_STATE_FILE = 'profile-quarantine.json';
const RISK_LEDGER_FILE = 'risk-ledger.jsonl';
const AUTH_SESSION_STATE_FILE = 'auth-session-state.json';

const NETWORK_LOOKUP_CANDIDATES = Object.freeze([
  {
    name: 'ipify',
    url: 'https://api.ipify.org?format=json',
    parse(payload) {
      return {
        publicIp: cleanText(payload?.ip) || null,
      };
    },
  },
  {
    name: 'ipwhois',
    url: 'https://ipwho.is/',
    parse(payload) {
      return {
        publicIp: cleanText(payload?.ip) || null,
        asn: cleanText(payload?.connection?.asn) || null,
        org: cleanText(payload?.connection?.org) || null,
      };
    },
  },
  {
    name: 'ipapi',
    url: 'https://ipapi.co/json/',
    parse(payload) {
      return {
        publicIp: cleanText(payload?.ip) || null,
        asn: cleanText(payload?.asn) || null,
        org: cleanText(payload?.org) || null,
      };
    },
  },
]);

const ACTIVE_LEASES = new Map();
let cachedNetworkFingerprint = null;

function normalizePositiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function resolveStateFile(userDataDir, filename) {
  return path.join(path.resolve(userDataDir), STATE_DIRNAME, filename);
}

async function readJsonFileOrNull(filePath) {
  if (!filePath || !await pathExists(filePath)) {
    return null;
  }
  try {
    return await readJsonFile(filePath);
  } catch {
    return null;
  }
}

function processInfo() {
  return {
    pid: process.pid,
    hostname: os.hostname(),
    argv: process.argv.slice(0, 3),
  };
}

function normalizeInterfaceSummary(interfaces = os.networkInterfaces()) {
  const summary = [];
  for (const [name, addresses] of Object.entries(interfaces ?? {})) {
    const relevant = toArray(addresses)
      .filter((entry) => entry && entry.internal !== true)
      .map((entry) => ({
        family: cleanText(entry.family),
        cidr: cleanText(entry.cidr),
        mac: cleanText(entry.mac),
      }))
      .filter((entry) => entry.family || entry.cidr || entry.mac);
    if (!relevant.length) {
      continue;
    }
    summary.push({
      name,
      addresses: relevant,
    });
  }
  return summary.sort((left, right) => left.name.localeCompare(right.name, 'en'));
}

async function fetchJsonWithTimeout(url, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
      },
    });
    if (!response?.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function lookupPublicNetworkInfo(fetchImpl, timeoutMs) {
  if (typeof fetchImpl !== 'function') {
    return {
      source: null,
      publicIp: null,
      asn: null,
      org: null,
    };
  }

  let merged = {
    source: null,
    publicIp: null,
    asn: null,
    org: null,
  };

  for (const candidate of NETWORK_LOOKUP_CANDIDATES) {
    const payload = await fetchJsonWithTimeout(candidate.url, fetchImpl, timeoutMs);
    if (!payload) {
      continue;
    }
    const parsed = candidate.parse(payload);
    if (!merged.source && (parsed.publicIp || parsed.asn || parsed.org)) {
      merged.source = candidate.name;
    }
    merged = {
      source: merged.source,
      publicIp: merged.publicIp || parsed.publicIp || null,
      asn: merged.asn || parsed.asn || null,
      org: merged.org || parsed.org || null,
    };
    if (merged.publicIp && merged.asn) {
      break;
    }
  }

  return merged;
}

export function resolveAuthSessionPolicy(authConfig = {}) {
  const verificationUrl = cleanText(authConfig?.verificationUrl);
  const keepaliveUrl = cleanText(authConfig?.keepaliveUrl) || verificationUrl || cleanText(authConfig?.postLoginUrl) || cleanText(authConfig?.loginUrl) || null;
  return {
    keepaliveUrl,
    keepaliveIntervalMinutes: normalizePositiveNumber(
      authConfig?.keepaliveIntervalMinutes,
      DEFAULT_KEEPALIVE_INTERVAL_MINUTES,
    ),
    cooldownMinutesAfterRisk: normalizePositiveNumber(
      authConfig?.cooldownMinutesAfterRisk,
      DEFAULT_RISK_COOLDOWN_MINUTES,
    ),
    preferVisibleBrowserForAuthenticatedFlows: authConfig?.preferVisibleBrowserForAuthenticatedFlows === true,
    requireStableNetworkForAuthenticatedFlows: authConfig?.requireStableNetworkForAuthenticatedFlows === true,
  };
}

export async function collectNetworkIdentityFingerprint(options = {}, deps = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const timeoutMs = normalizePositiveNumber(options.timeoutMs, NETWORK_LOOKUP_TIMEOUT_MS);
  const cacheable = options.forceRefresh !== true && !deps.fetchImpl && cachedNetworkFingerprint
    && (Date.now() - cachedNetworkFingerprint.cachedAtMs) < NETWORK_CACHE_TTL_MS;

  if (cacheable) {
    return {
      ...cachedNetworkFingerprint.value,
      capturedAt: now.toISOString(),
    };
  }

  const interfaceSummary = normalizeInterfaceSummary(deps.networkInterfaces?.() ?? os.networkInterfaces());
  const publicInfo = options.disableExternalLookup === true
    ? { source: null, publicIp: null, asn: null, org: null }
    : await lookupPublicNetworkInfo(fetchImpl, timeoutMs);
  const basis = {
    publicIp: publicInfo.publicIp || null,
    asn: publicInfo.asn || null,
    org: publicInfo.org || null,
    interfaceSummary,
  };
  const fingerprint = {
    ...basis,
    source: publicInfo.source || null,
    fingerprint: hashValue(basis),
    capturedAt: now.toISOString(),
  };

  if (!deps.fetchImpl) {
    cachedNetworkFingerprint = {
      cachedAtMs: Date.now(),
      value: fingerprint,
    };
  }

  return fingerprint;
}

export function compareNetworkIdentityFingerprints(previous = null, current = null) {
  if (!previous || !current) {
    return {
      driftDetected: false,
      reasons: [],
    };
  }

  const reasons = [];
  if (cleanText(previous.publicIp) && cleanText(current.publicIp) && previous.publicIp !== current.publicIp) {
    reasons.push('public-ip-changed');
  }
  if (cleanText(previous.asn) && cleanText(current.asn) && previous.asn !== current.asn) {
    reasons.push('asn-changed');
  }
  if (hashValue(previous.interfaceSummary ?? []) !== hashValue(current.interfaceSummary ?? [])) {
    reasons.push('interface-changed');
  }
  if (!reasons.length && cleanText(previous.fingerprint) && cleanText(current.fingerprint) && previous.fingerprint !== current.fingerprint) {
    reasons.push('network-fingerprint-changed');
  }

  return {
    driftDetected: reasons.length > 0,
    reasons,
  };
}

export async function readHealthyNetworkFingerprint(userDataDir) {
  if (!userDataDir) {
    return null;
  }
  return await readJsonFileOrNull(resolveStateFile(userDataDir, HEALTHY_NETWORK_STATE_FILE));
}

export async function writeHealthyNetworkFingerprint(userDataDir, fingerprint) {
  if (!userDataDir || !fingerprint) {
    return null;
  }
  const filePath = resolveStateFile(userDataDir, HEALTHY_NETWORK_STATE_FILE);
  await ensureDir(path.dirname(filePath));
  await writeJsonFile(filePath, fingerprint);
  return filePath;
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function acquireSessionLease(userDataDir, options = {}) {
  if (!userDataDir) {
    return {
      acquired: false,
      skipped: true,
      reason: 'no-user-data-dir',
      lease: null,
    };
  }

  const resolvedDir = path.resolve(userDataDir);
  const existingRef = ACTIVE_LEASES.get(resolvedDir);
  if (existingRef) {
    existingRef.refCount += 1;
    return {
      acquired: true,
      skipped: false,
      reason: 'reentrant',
      lease: existingRef.lease,
    };
  }

  const filePath = resolveStateFile(resolvedDir, SESSION_LEASE_FILE);
  await ensureDir(path.dirname(filePath));
  const waitForAvailabilityMs = normalizePositiveNumber(options.waitForAvailabilityMs, 0);
  const pollIntervalMs = normalizePositiveNumber(options.pollIntervalMs, SESSION_LEASE_POLL_INTERVAL_MS);
  const waitStartedAt = Date.now();
  const deadlineAt = Date.now() + waitForAvailabilityMs;

  while (true) {
    const waitedMs = Date.now() - waitStartedAt;
    const existingLease = await readJsonFileOrNull(filePath);
    if (!(existingLease?.leaseId && existingLease.pid && isProcessAlive(Number(existingLease.pid)))) {
      const lease = {
        leaseId: randomUUID(),
        userDataDir: resolvedDir,
        createdAt: new Date().toISOString(),
        command: cleanText(options.command) || path.basename(process.argv[1] || 'unknown'),
        waitForAvailabilityMs,
        waitedMs,
        ...processInfo(),
      };
      await writeJsonFile(filePath, lease);
      ACTIVE_LEASES.set(resolvedDir, {
        lease,
        refCount: 1,
      });
      return {
        acquired: true,
        skipped: false,
        reason: waitedMs > 0 ? 'acquired-after-wait' : 'acquired',
        lease,
        waitedMs,
      };
    }

    if (waitForAvailabilityMs <= 0 || Date.now() >= deadlineAt) {
      return {
        acquired: false,
        skipped: false,
        reason: 'profile-in-use',
        lease: existingLease,
        concurrentProfileUse: true,
        waitedMs,
      };
    }

    const sleepMs = Math.min(pollIntervalMs, Math.max(1, deadlineAt - Date.now()));
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
}

export async function releaseSessionLease(lease) {
  const resolvedDir = cleanText(lease?.userDataDir);
  if (!resolvedDir) {
    return;
  }

  const existingRef = ACTIVE_LEASES.get(resolvedDir);
  if (existingRef) {
    existingRef.refCount -= 1;
    if (existingRef.refCount > 0) {
      return;
    }
    ACTIVE_LEASES.delete(resolvedDir);
  }

  const filePath = resolveStateFile(resolvedDir, SESSION_LEASE_FILE);
  const persistedLease = await readJsonFileOrNull(filePath);
  if (persistedLease?.leaseId && persistedLease.leaseId === lease?.leaseId) {
    try {
      await writeJsonFile(filePath, {
        ...persistedLease,
        releasedAt: new Date().toISOString(),
        released: true,
      });
    } catch {
      // Ignore release flush failures.
    }
    try {
      const fs = await import('node:fs/promises');
      await fs.unlink(filePath);
    } catch {
      // Ignore delete failures.
    }
  }
}

export async function readProfileQuarantine(userDataDir, options = {}) {
  if (!userDataDir) {
    return null;
  }
  const now = options.now instanceof Date ? options.now : new Date();
  const quarantine = await readJsonFileOrNull(resolveStateFile(userDataDir, QUARANTINE_STATE_FILE));
  if (!quarantine?.until) {
    return null;
  }
  const until = new Date(quarantine.until);
  if (Number.isNaN(until.getTime()) || until.getTime() <= now.getTime()) {
    return null;
  }
  return quarantine;
}

export async function writeProfileQuarantine(userDataDir, payload = {}, options = {}) {
  if (!userDataDir) {
    return null;
  }
  const now = options.now instanceof Date ? options.now : new Date();
  const cooldownMinutes = normalizePositiveNumber(payload.cooldownMinutes, DEFAULT_RISK_COOLDOWN_MINUTES);
  const until = payload.until
    ? new Date(payload.until)
    : new Date(now.getTime() + (cooldownMinutes * 60_000));
  const quarantine = {
    createdAt: now.toISOString(),
    until: until.toISOString(),
    riskCauseCode: cleanText(payload.riskCauseCode) || null,
    riskAction: cleanText(payload.riskAction) || null,
    antiCrawlSignals: uniqueSortedStrings(toArray(payload.antiCrawlSignals).filter(Boolean)),
    note: cleanText(payload.note) || null,
  };
  const filePath = resolveStateFile(userDataDir, QUARANTINE_STATE_FILE);
  await ensureDir(path.dirname(filePath));
  await writeJsonFile(filePath, quarantine);
  return quarantine;
}

export async function clearProfileQuarantine(userDataDir) {
  if (!userDataDir) {
    return;
  }
  const filePath = resolveStateFile(userDataDir, QUARANTINE_STATE_FILE);
  if (!await pathExists(filePath)) {
    return;
  }
  const fs = await import('node:fs/promises');
  try {
    await fs.unlink(filePath);
  } catch {
    // Ignore cleanup failures.
  }
}

export async function appendRiskLedgerEvent(userDataDir, event = {}) {
  if (!userDataDir) {
    return null;
  }
  const filePath = resolveStateFile(userDataDir, RISK_LEDGER_FILE);
  await ensureDir(path.dirname(filePath));
  const payload = {
    recordedAt: new Date().toISOString(),
    ...event,
  };
  await appendJsonLine(filePath, payload);
  return filePath;
}

export async function readAuthSessionState(userDataDir) {
  if (!userDataDir) {
    return null;
  }
  return await readJsonFileOrNull(resolveStateFile(userDataDir, AUTH_SESSION_STATE_FILE));
}

export async function writeAuthSessionState(userDataDir, state = null) {
  if (!userDataDir || !state || typeof state !== 'object') {
    return null;
  }
  const filePath = resolveStateFile(userDataDir, AUTH_SESSION_STATE_FILE);
  await ensureDir(path.dirname(filePath));
  await writeJsonFile(filePath, state);
  return filePath;
}

function minutesBetween(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date)) {
    return null;
  }
  const deltaMs = end.getTime() - start.getTime();
  if (!Number.isFinite(deltaMs)) {
    return null;
  }
  return Math.max(0, Math.round(deltaMs / 60_000));
}

export function summarizeAuthSessionState(state = null, authConfig = null, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const policy = resolveAuthSessionPolicy(authConfig);
  const lastHealthyAt = cleanText(state?.lastHealthyAt) || null;
  const lastKeepaliveAt = cleanText(state?.lastKeepaliveAt) || null;
  const lastLoginAt = cleanText(state?.lastLoginAt) || null;
  const lastSessionReuseVerifiedAt = cleanText(state?.lastSessionReuseVerifiedAt) || null;
  const nextSuggestedKeepaliveAt = cleanText(state?.nextSuggestedKeepaliveAt) || null;

  const lastHealthyDate = lastHealthyAt ? new Date(lastHealthyAt) : null;
  const nextSuggestedKeepaliveDate = nextSuggestedKeepaliveAt ? new Date(nextSuggestedKeepaliveAt) : null;
  const keepaliveDue = nextSuggestedKeepaliveDate instanceof Date
    && !Number.isNaN(nextSuggestedKeepaliveDate.getTime())
    ? nextSuggestedKeepaliveDate.getTime() <= now.getTime()
    : false;

  return {
    lastHealthyAt,
    lastKeepaliveAt,
    lastLoginAt,
    lastSessionReuseVerifiedAt,
    nextSuggestedKeepaliveAt,
    keepaliveDue,
    minutesSinceLastHealthy: lastHealthyDate instanceof Date && !Number.isNaN(lastHealthyDate.getTime())
      ? minutesBetween(lastHealthyDate, now)
      : null,
    minutesUntilSuggestedKeepalive: nextSuggestedKeepaliveDate instanceof Date && !Number.isNaN(nextSuggestedKeepaliveDate.getTime())
      ? Math.max(0, Math.round((nextSuggestedKeepaliveDate.getTime() - now.getTime()) / 60_000))
      : null,
    keepaliveIntervalMinutes: policy.keepaliveIntervalMinutes,
    successfulKeepalives: Number(state?.counts?.successfulKeepalives ?? 0),
    successfulLogins: Number(state?.counts?.successfulLogins ?? 0),
    sessionReuseVerifications: Number(state?.counts?.sessionReuseVerifications ?? 0),
    failedKeepalives: Number(state?.counts?.failedKeepalives ?? 0),
    lastRiskAt: cleanText(state?.lastRiskAt) || null,
    lastRiskCauseCode: cleanText(state?.lastRiskCauseCode) || null,
    lastRiskAction: cleanText(state?.lastRiskAction) || null,
    lastWarmupAt: cleanText(state?.lastWarmupAt) || null,
    lastWarmupCompleted: state?.lastWarmupCompleted === true,
    lastWarmupUrls: uniqueSortedStrings(toArray(state?.lastWarmupUrls).filter(Boolean)),
  };
}

export function classifyRiskFromContext(context = {}) {
  const antiCrawlSignals = uniqueSortedStrings(toArray(context.antiCrawlSignals).map((value) => cleanText(value).toLowerCase()).filter(Boolean));
  const antiCrawlSource = antiCrawlSignals.join(' ');
  if (context.concurrentProfileUse === true) {
    return {
      riskCauseCode: 'concurrent-profile-use',
      riskAction: 'wait-for-active-session',
    };
  }
  if (context.profileHealth?.healthy === false) {
    return {
      riskCauseCode: 'profile-health-risk',
      riskAction: 'rebuild-profile',
    };
  }
  if (context.networkDrift?.driftDetected === true) {
    return {
      riskCauseCode: 'network-identity-drift',
      riskAction: 'run-keepalive-before-auth',
    };
  }
  if (/rate-limit|too-many|\u9891\u7e41|\u7a0d\u540e\u518d\u8bd5/u.test(antiCrawlSource)) {
    return {
      riskCauseCode: 'request-burst',
      riskAction: 'cooldown-and-retry-later',
    };
  }
  if (antiCrawlSignals.some((value) => /verify|captcha|middle-page-loading|middle/u.test(value))) {
    const sessionInvalid = context.authRequired === true
      && context.identityConfirmed !== true
      && context.loginStateDetected !== true;
    return {
      riskCauseCode: sessionInvalid ? 'session-invalid' : 'browser-fingerprint-risk',
      riskAction: sessionInvalid ? 'run-keepalive-or-auto-login' : 'use-visible-browser-warmup',
    };
  }
  if (context.authRequired === true && context.authAvailable === false) {
    return {
      riskCauseCode: 'session-invalid',
      riskAction: 'run-keepalive-or-auto-login',
    };
  }
  if (antiCrawlSignals.length > 0) {
    return {
      riskCauseCode: 'unknown-risk',
      riskAction: 'manual-investigation',
    };
  }
  return {
    riskCauseCode: null,
    riskAction: null,
  };
}

export function shouldQuarantineRisk(context = {}) {
  const antiCrawlSignals = uniqueSortedStrings(toArray(context.antiCrawlSignals).map((value) => cleanText(value).toLowerCase()).filter(Boolean));
  return antiCrawlSignals.some((value) => /verify|captcha|challenge|middle/u.test(value));
}

export function evaluateSessionPolicy(options = {}) {
  const operation = cleanText(options.operation) || 'unknown';
  const policy = resolveAuthSessionPolicy(options.authConfig);
  const quarantine = options.quarantine ?? null;
  const networkDrift = options.networkDrift ?? { driftDetected: false, reasons: [] };

  if (options.concurrentProfileUse === true) {
    return {
      allowed: false,
      riskCauseCode: 'concurrent-profile-use',
      riskAction: 'wait-for-active-session',
      profileQuarantined: Boolean(quarantine),
      networkIdentityFingerprint: options.networkFingerprint ?? null,
    };
  }

  if (quarantine && !['site-login', 'site-keepalive', 'site-doctor'].includes(operation)) {
    return {
      allowed: false,
      riskCauseCode: cleanText(quarantine.riskCauseCode) || 'browser-fingerprint-risk',
      riskAction: cleanText(quarantine.riskAction) || 'cooldown-and-retry-later',
      profileQuarantined: true,
      networkIdentityFingerprint: options.networkFingerprint ?? null,
    };
  }

  if (policy.requireStableNetworkForAuthenticatedFlows && networkDrift.driftDetected === true) {
    const allowed = ['site-login', 'site-keepalive', 'site-doctor'].includes(operation);
    return {
      allowed,
      riskCauseCode: 'network-identity-drift',
      riskAction: allowed ? 'keepalive-only' : 'run-keepalive-before-auth',
      profileQuarantined: Boolean(quarantine),
      networkIdentityFingerprint: options.networkFingerprint ?? null,
      driftReasons: networkDrift.reasons ?? [],
    };
  }

  return {
    allowed: true,
    riskCauseCode: null,
    riskAction: null,
    profileQuarantined: Boolean(quarantine),
    networkIdentityFingerprint: options.networkFingerprint ?? null,
    driftReasons: networkDrift.reasons ?? [],
  };
}

export async function prepareSiteSessionGovernance(inputUrl, authContext = {}, settings = {}, options = {}, deps = {}) {
  const authConfig = authContext?.authConfig ?? null;
  const userDataDir = authContext?.userDataDir ?? settings.userDataDir ?? null;
  const operation = cleanText(options.operation) || 'unknown';
  const leaseResult = settings.reuseLoginState === false
    ? {
      acquired: false,
      skipped: true,
      reason: 'reuse-login-state-disabled',
      lease: null,
      concurrentProfileUse: false,
    }
    : await acquireSessionLease(userDataDir, {
      command: operation,
      waitForAvailabilityMs: settings.sessionLeaseWaitMs ?? options.waitForAvailabilityMs ?? 0,
      pollIntervalMs: settings.sessionLeasePollIntervalMs ?? options.pollIntervalMs ?? SESSION_LEASE_POLL_INTERVAL_MS,
    });
  const networkFingerprint = userDataDir
    ? await collectNetworkIdentityFingerprint(options.networkOptions ?? {}, deps)
    : null;
  const healthyNetworkFingerprint = userDataDir
    ? await readHealthyNetworkFingerprint(userDataDir)
    : null;
  const authSessionState = userDataDir
    ? await readAuthSessionState(userDataDir)
    : null;
  const networkDrift = compareNetworkIdentityFingerprints(healthyNetworkFingerprint, networkFingerprint);
  const quarantine = await readProfileQuarantine(userDataDir, { now: options.now });
  const policyDecision = evaluateSessionPolicy({
    operation,
    authConfig,
    networkFingerprint,
    networkDrift,
    quarantine,
    concurrentProfileUse: leaseResult.concurrentProfileUse === true,
  });

  return {
    operation,
    userDataDir,
    authConfig,
    leaseResult,
    lease: leaseResult.lease ?? null,
    networkFingerprint,
    healthyNetworkFingerprint,
    authSessionState,
    authSessionSummary: summarizeAuthSessionState(authSessionState, authConfig, { now: options.now }),
    networkDrift,
    quarantine,
    policyDecision,
  };
}

export async function finalizeSiteSessionGovernance(governance = {}, result = {}, options = {}) {
  const authPolicy = resolveAuthSessionPolicy(governance.authConfig);
  const now = options.now instanceof Date ? options.now : new Date();
  const nowIso = now.toISOString();
  const antiCrawlSignals = uniqueSortedStrings(toArray(result.antiCrawlSignals).filter(Boolean));
  const classifiedRisk = classifyRiskFromContext({
    antiCrawlSignals,
    authRequired: result.authRequired === true,
    authAvailable: result.authAvailable,
    identityConfirmed: result.identityConfirmed === true,
    loginStateDetected: result.loginStateDetected === true,
    profileHealth: result.profileHealth ?? null,
    networkDrift: governance.networkDrift,
    concurrentProfileUse: governance.leaseResult?.concurrentProfileUse === true,
  });
  const riskCauseCode = result.riskCauseCode ?? governance.policyDecision?.riskCauseCode ?? classifiedRisk.riskCauseCode ?? null;
  const riskAction = result.riskAction ?? governance.policyDecision?.riskAction ?? classifiedRisk.riskAction ?? null;
  const persistedHealthySession = result.persistedHealthySession === true;

  if (governance.userDataDir && persistedHealthySession && governance.networkFingerprint) {
    await writeHealthyNetworkFingerprint(governance.userDataDir, governance.networkFingerprint);
    if (!antiCrawlSignals.length) {
      await clearProfileQuarantine(governance.userDataDir);
    }
  }

  let profileQuarantined = governance.policyDecision?.profileQuarantined === true;
  if (governance.userDataDir && shouldQuarantineRisk({ antiCrawlSignals })) {
    await writeProfileQuarantine(governance.userDataDir, {
      riskCauseCode,
      riskAction: riskAction || 'cooldown-and-retry-later',
      antiCrawlSignals,
      cooldownMinutes: authPolicy.cooldownMinutesAfterRisk,
      note: cleanText(result.note) || null,
    }, { now: options.now });
    profileQuarantined = true;
  }

  if (governance.userDataDir && (antiCrawlSignals.length || riskCauseCode)) {
    await appendRiskLedgerEvent(governance.userDataDir, {
      operation: governance.operation,
      riskCauseCode,
      riskAction,
      antiCrawlSignals,
      networkIdentityFingerprint: governance.networkFingerprint?.fingerprint ?? null,
      profileQuarantined,
      note: cleanText(result.note) || null,
    });
  }

  let authSessionStateSummary = summarizeAuthSessionState(governance.authSessionState, governance.authConfig, { now });
  if (governance.userDataDir) {
    const previousState = governance.authSessionState ?? {};
    const previousCounts = previousState?.counts ?? {};
    const warmupUrls = uniqueSortedStrings(toArray(result.warmupSummary?.urls).filter(Boolean));
    const persistedState = {
      updatedAt: nowIso,
      keepaliveIntervalMinutes: authPolicy.keepaliveIntervalMinutes,
      lastHealthyAt: persistedHealthySession ? nowIso : cleanText(previousState.lastHealthyAt) || null,
      lastAuthenticatedAt: result.authAvailable === true ? nowIso : cleanText(previousState.lastAuthenticatedAt) || null,
      lastKeepaliveAt: governance.operation === 'site-keepalive' && persistedHealthySession
        ? nowIso
        : cleanText(previousState.lastKeepaliveAt) || null,
      lastLoginAt: governance.operation === 'site-login' && persistedHealthySession
        ? nowIso
        : cleanText(previousState.lastLoginAt) || null,
      lastSessionReuseVerifiedAt: result.sessionReuseVerified === true
        ? nowIso
        : cleanText(previousState.lastSessionReuseVerifiedAt) || null,
      nextSuggestedKeepaliveAt: persistedHealthySession
        ? new Date(now.getTime() + (authPolicy.keepaliveIntervalMinutes * 60_000)).toISOString()
        : cleanText(previousState.nextSuggestedKeepaliveAt) || null,
      lastRiskAt: riskCauseCode ? nowIso : cleanText(previousState.lastRiskAt) || null,
      lastRiskCauseCode: riskCauseCode ?? (cleanText(previousState.lastRiskCauseCode) || null),
      lastRiskAction: riskAction ?? (cleanText(previousState.lastRiskAction) || null),
      lastAntiCrawlSignals: antiCrawlSignals.length
        ? antiCrawlSignals
        : uniqueSortedStrings(toArray(previousState.lastAntiCrawlSignals).filter(Boolean)),
      lastWarmupAt: result.warmupSummary?.attempted === true ? nowIso : cleanText(previousState.lastWarmupAt) || null,
      lastWarmupCompleted: result.warmupSummary?.attempted === true
        ? result.warmupSummary?.completed === true
        : previousState.lastWarmupCompleted === true,
      lastWarmupUrls: warmupUrls.length
        ? warmupUrls
        : uniqueSortedStrings(toArray(previousState.lastWarmupUrls).filter(Boolean)),
      networkIdentityFingerprint: governance.networkFingerprint?.fingerprint ?? (cleanText(previousState.networkIdentityFingerprint) || null),
      profileQuarantined,
      counts: {
        successfulKeepalives: Number(previousCounts.successfulKeepalives ?? 0) + (
          governance.operation === 'site-keepalive' && persistedHealthySession ? 1 : 0
        ),
        successfulLogins: Number(previousCounts.successfulLogins ?? 0) + (
          governance.operation === 'site-login' && persistedHealthySession ? 1 : 0
        ),
        sessionReuseVerifications: Number(previousCounts.sessionReuseVerifications ?? 0) + (
          result.sessionReuseVerified === true ? 1 : 0
        ),
        failedKeepalives: Number(previousCounts.failedKeepalives ?? 0) + (
          governance.operation === 'site-keepalive' && persistedHealthySession !== true ? 1 : 0
        ),
      },
    };
    await writeAuthSessionState(governance.userDataDir, persistedState);
    authSessionStateSummary = summarizeAuthSessionState(persistedState, governance.authConfig, { now });
  }

  if (governance.lease) {
    await releaseSessionLease(governance.lease);
  }

  return {
    riskCauseCode,
    riskAction,
    sessionLeaseId: governance.lease?.leaseId ?? null,
    networkIdentityFingerprint: governance.networkFingerprint ?? null,
    profileQuarantined,
    networkDrift: governance.networkDrift,
    authSessionStateSummary,
  };
}
