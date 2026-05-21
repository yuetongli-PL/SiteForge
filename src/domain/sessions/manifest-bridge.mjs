// @ts-check

import path from 'node:path';

import { readJsonFile } from '../../infra/io.mjs';
import { normalizeText, sanitizeHost } from '../../shared/normalize.mjs';
import {
  assertSessionRevocationAllowed,
  createSessionViewMaterializationAudit,
  normalizeSessionView,
} from './session-view.mjs';
import {
  normalizeSessionHealth,
  normalizeSessionRunManifest,
} from './contracts.mjs';

function normalizeStringList(value = []) {
  return [...new Set((Array.isArray(value) ? value : [value])
    .map((entry) => normalizeText(entry))
    .filter(Boolean))];
}

const FORBIDDEN_SESSION_CROSSING_KEYS = new Set([
  'authorization',
  'cookie',
  'cookies',
  'headers',
  'csrf',
  'xsrf',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'sessionid',
  'session_id',
  'sessdata',
  'profilepath',
  'browserprofileroot',
  'userdatadir',
]);

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[-_]/gu, '');
}

/** @param {Record<string, any>} [value] */
export function assertSessionBoundaryCrossingSafe(value = {}, label = 'Session manifest bridge crossing') {
  const pending = [{ value, path: label }];
  const seen = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (!current.value || typeof current.value !== 'object') {
      continue;
    }
    if (seen.has(current.value)) {
      continue;
    }
    seen.add(current.value);
    if (Array.isArray(current.value)) {
      current.value.forEach((entry, index) => {
        pending.push({ value: entry, path: `${current.path}.${index}` });
      });
      continue;
    }
    for (const [key, child] of Object.entries(current.value)) {
      if (FORBIDDEN_SESSION_CROSSING_KEYS.has(normalizeKey(key))) {
        throw new Error(`${label} must not expose raw session/profile key: ${key}`);
      }
      pending.push({ value: child, path: `${current.path}.${key}` });
    }
  }
  return true;
}

export async function readSessionRunManifest(filePath) {
  const resolvedPath = path.resolve(filePath);
  const manifest = normalizeSessionRunManifest(await readJsonFile(resolvedPath), {
    artifacts: {
      manifest: resolvedPath,
      runDir: path.dirname(resolvedPath),
    },
  });
  return {
    ...manifest,
    artifacts: {
      ...manifest.artifacts,
      manifest: resolvedPath,
      // @ts-ignore
      runDir: manifest.artifacts.runDir ?? path.dirname(resolvedPath),
    },
  };
}

/** @param {Record<string, any>} [manifest] */
export function summarizeSessionRunManifest(manifest = {}) {
  const normalized = normalizeSessionRunManifest(manifest);
  const health = normalizeSessionHealth(normalized.health, {
    siteKey: normalized.siteKey,
    host: normalized.host,
  });
  const summary = {
    schemaVersion: normalized.schemaVersion,
    runId: normalized.runId,
    siteKey: normalized.siteKey,
    host: normalized.host,
    purpose: normalized.purpose,
    status: normalized.status,
    reason: normalized.reason ?? health.reason ?? health.riskCauseCode,
    healthStatus: health.status,
    authStatus: health.authStatus,
    identityConfirmed: health.identityConfirmed === true,
    riskCauseCode: health.riskCauseCode,
    riskAction: health.riskAction,
    riskSignals: normalizeStringList(health.riskSignals),
    healthRecovery: normalized.healthRecovery,
    expiresAt: health.expiresAt,
    repairPlan: normalized.repairPlan,
    artifacts: {
      // @ts-ignore
      manifest: normalized.artifacts.manifest,
      // @ts-ignore
      runDir: normalized.artifacts.runDir,
    },
  };
  assertSessionBoundaryCrossingSafe(summary, 'Session manifest summary');
  return summary;
}

/** @param {Record<string, any>} [manifest] */
export function assertSessionManifestMatches(manifest = {}, expected = {}) {
  const summary = summarizeSessionRunManifest(manifest);
  const expectedSite = normalizeText(expected.siteKey ?? expected.site);
  const expectedHostText = normalizeText(expected.host);
  const expectedHost = expectedHostText ? sanitizeHost(expectedHostText) : '';
  if (expectedSite && summary.siteKey && expectedSite !== summary.siteKey) {
    throw new Error(`Session manifest site mismatch: expected ${expectedSite}, got ${summary.siteKey}`);
  }
  if (expectedHost && summary.host && expectedHost !== summary.host) {
    throw new Error(`Session manifest host mismatch: expected ${expectedHost}, got ${summary.host}`);
  }
  return summary;
}

/** @param {Record<string, any>} [summary] */
function sessionViewPermissions(summary = {}) {
  if (summary.healthStatus !== 'ready') {
    return [];
  }
  return ['read'];
}

/** @param {Record<string, any>} [summary] */
function sessionViewFromSummary(summary = {}) {
  return normalizeSessionView({
    siteKey: summary.siteKey,
    profileRef: 'anonymous',
    purpose: summary.purpose ?? 'download',
    scope: [summary.siteKey, summary.host, summary.purpose],
    permission: sessionViewPermissions(summary),
    ttlSeconds: 300,
    expiresAt: summary.expiresAt,
    networkContext: {
      host: summary.host,
    },
    status: summary.healthStatus,
    reasonCode: summary.reason ?? summary.riskCauseCode,
    riskSignals: summary.riskSignals,
  });
}

/** @param {Record<string, any>} [context] */
function revocationContextForMaterialization(context = {}) {
  const revocationHandleRef = normalizeText(
    context.revocationHandleRef ?? context.revocationHandle ?? context.handleRef,
  );
  if (!revocationHandleRef && context.revocationStore === undefined) {
    return {};
  }
  assertSessionRevocationAllowed(context.revocationStore, revocationHandleRef, {
    now: context.now,
  });
  return { revocationHandleRef };
}

/** @param {Record<string, any>} [manifest] */
export function sessionViewFromRunManifest(manifest = {}, expected = {}) {
  return sessionViewFromSummary(assertSessionManifestMatches(manifest, expected));
}

/** @param {Record<string, any>} [manifest] */
export function sessionViewMaterializationAuditFromRunManifest(manifest = {}, expected = {}, context = {}) {
  const summary = assertSessionManifestMatches(manifest, expected);
  return createSessionViewMaterializationAudit(
    sessionViewFromSummary(summary),
    revocationContextForMaterialization(context),
  );
}

/** @param {Record<string, any>} [manifest] */
export function sessionOptionsFromRunManifest(manifest = {}, expected = {}, context = {}) {
  const summary = assertSessionManifestMatches(manifest, expected);
  const sessionView = sessionViewFromSummary(summary);
  const sessionViewMaterializationAudit = createSessionViewMaterializationAudit(
    sessionView,
    revocationContextForMaterialization(context),
  );
  const options = {
    sessionStatus: summary.healthStatus,
    sessionReason: summary.reason ?? summary.riskCauseCode ?? summary.healthStatus,
    riskSignals: summary.riskSignals,
    expiresAt: summary.expiresAt,
    sessionView,
    sessionViewMaterializationAudit,
    sessionHealthManifest: summary,
    sessionManifestPath: summary.artifacts.manifest,
  };
  assertSessionBoundaryCrossingSafe(options, 'Session options from manifest');
  return options;
}

/** @param {Record<string, any>} options */
export async function actionSessionMetadataFromOptions(options = {}, expected = {}) {
  if (options.sessionManifest) {
    const summary = assertSessionManifestMatches(
      await readSessionRunManifest(path.resolve(String(options.sessionManifest))),
      expected,
    );
    const sessionView = sessionViewFromSummary(summary);
    const metadata = {
      sessionProvider: 'unified-session-runner',
      sessionHealth: summary,
      sessionView,
      sessionViewMaterializationAudit: createSessionViewMaterializationAudit(sessionView),
    };
    assertSessionBoundaryCrossingSafe(metadata, 'Action session metadata');
    return metadata;
  }

  const metadata = {
    sessionProvider: normalizeText(options.sessionProvider)
      || (options.useUnifiedSessionHealth === true ? 'unified-session-runner' : 'legacy-session-provider'),
  };
  assertSessionBoundaryCrossingSafe(metadata, 'Action session metadata');
  return metadata;
}
