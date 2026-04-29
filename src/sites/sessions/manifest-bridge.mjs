// @ts-check

import path from 'node:path';

import { readJsonFile } from '../../infra/io.mjs';
import { normalizeText, sanitizeHost } from '../../shared/normalize.mjs';
import {
  normalizeSessionHealth,
  normalizeSessionRunManifest,
} from './contracts.mjs';

function normalizeStringList(value = []) {
  return [...new Set((Array.isArray(value) ? value : [value])
    .map((entry) => normalizeText(entry))
    .filter(Boolean))];
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
      runDir: manifest.artifacts.runDir ?? path.dirname(resolvedPath),
    },
  };
}

export function summarizeSessionRunManifest(manifest = {}) {
  const normalized = normalizeSessionRunManifest(manifest);
  const health = normalizeSessionHealth(normalized.health, {
    siteKey: normalized.siteKey,
    host: normalized.host,
  });
  return {
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
    expiresAt: health.expiresAt,
    repairPlan: normalized.repairPlan,
    artifacts: {
      manifest: normalized.artifacts.manifest,
      runDir: normalized.artifacts.runDir,
    },
  };
}

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

export function sessionOptionsFromRunManifest(manifest = {}, expected = {}) {
  const summary = assertSessionManifestMatches(manifest, expected);
  return {
    sessionStatus: summary.healthStatus,
    sessionReason: summary.reason ?? summary.riskCauseCode ?? summary.healthStatus,
    riskSignals: summary.riskSignals,
    expiresAt: summary.expiresAt,
    sessionHealthManifest: summary,
    sessionManifestPath: summary.artifacts.manifest,
  };
}

export async function actionSessionMetadataFromOptions(options = {}, expected = {}) {
  if (options.sessionManifest) {
    const summary = assertSessionManifestMatches(
      await readSessionRunManifest(path.resolve(String(options.sessionManifest))),
      expected,
    );
    return {
      sessionProvider: 'unified-session-runner',
      sessionHealth: summary,
    };
  }

  return {
    sessionProvider: normalizeText(options.sessionProvider)
      || (options.useUnifiedSessionHealth === true ? 'unified-session-runner' : 'legacy-session-provider'),
  };
}
