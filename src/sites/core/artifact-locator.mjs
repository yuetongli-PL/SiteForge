// @ts-check

import path from 'node:path';
import process from 'node:process';
import { findLatestRunDir, pathExists } from '../../infra/io.mjs';
import { firstNonEmpty, hostFromUrl, sanitizeHost } from '../../shared/normalize.mjs';
import { readSiteContext } from './context.mjs';
import { resolveCanonicalSiteIdentity } from './site-identity.mjs';

function pushUniqueHostKey(values, candidate) {
  const hostKey = normalizeHostKey(candidate);
  if (!hostKey || values.includes(hostKey)) {
    return;
  }
  values.push(hostKey);
}

export function normalizeHostKey(candidate) {
  const rawValue = typeof candidate === 'string' ? candidate.trim() : '';
  if (!rawValue) {
    return null;
  }
  return sanitizeHost(hostFromUrl(rawValue) ?? rawValue);
}

export async function resolveArtifactLocatorContext({
  workspaceRoot = process.cwd(),
  inputUrl = null,
  baseUrl = null,
  url = null,
  host = null,
  siteContext = null,
  profile = null,
  canonicalBaseUrl = null,
} = {}) {
  const resolvedInputUrl = firstNonEmpty([inputUrl, url, baseUrl]) ?? '';
  const requestedHostKey = normalizeHostKey(host ?? resolvedInputUrl);
  const resolvedSiteContext = siteContext
    ?? (requestedHostKey || resolvedInputUrl
      ? await readSiteContext(workspaceRoot, requestedHostKey ?? resolvedInputUrl)
      : null);
  const resolvedCanonicalBaseUrl = firstNonEmpty([
    canonicalBaseUrl,
    resolvedSiteContext?.registryRecord?.canonicalBaseUrl,
    resolvedSiteContext?.capabilitiesRecord?.baseUrl,
    baseUrl,
    resolvedInputUrl,
  ]) ?? null;
  const siteIdentity = resolveCanonicalSiteIdentity({
    host: requestedHostKey ?? undefined,
    inputUrl: resolvedInputUrl,
    baseUrl,
    siteContext: resolvedSiteContext,
    profile,
  });

  const candidateHostKeys = [];
  for (const candidate of [
    requestedHostKey,
    resolvedSiteContext?.host,
    resolvedCanonicalBaseUrl,
    resolvedSiteContext?.registryRecord?.canonicalBaseUrl,
    resolvedSiteContext?.capabilitiesRecord?.baseUrl,
    profile?.host,
    siteIdentity?.host,
    baseUrl,
    resolvedInputUrl,
  ]) {
    pushUniqueHostKey(candidateHostKeys, candidate);
  }

  return {
    workspaceRoot,
    inputUrl: resolvedInputUrl || null,
    baseUrl: baseUrl ?? null,
    requestedHostKey,
    hostKey: resolvedSiteContext?.host ?? requestedHostKey ?? normalizeHostKey(baseUrl) ?? null,
    canonicalBaseUrl: resolvedCanonicalBaseUrl,
    siteContext: resolvedSiteContext,
    siteIdentity,
    candidateHostKeys,
  };
}

export function buildHostKeyedDirCandidates(locator, rootDir, { includeRoot = false } = {}) {
  const workspaceRoot = path.resolve(locator?.workspaceRoot ?? process.cwd());
  const entries = [];
  const seen = new Set();

  for (const hostKey of locator?.candidateHostKeys ?? []) {
    const dirPath = path.join(workspaceRoot, rootDir, hostKey);
    if (seen.has(dirPath)) {
      continue;
    }
    seen.add(dirPath);
    entries.push({
      kind: 'host-key',
      hostKey,
      dirPath,
    });
  }

  if (includeRoot) {
    const dirPath = path.join(workspaceRoot, rootDir);
    if (!seen.has(dirPath)) {
      entries.push({
        kind: 'root',
        hostKey: null,
        dirPath,
      });
    }
  }

  return entries;
}

export async function resolveHostKeyedDir(locator, rootDir, {
  explicitDir = null,
  includeRoot = false,
  requireExisting = false,
} = {}) {
  if (explicitDir) {
    return {
      kind: 'explicit',
      hostKey: null,
      dirPath: path.resolve(explicitDir),
    };
  }

  const candidates = buildHostKeyedDirCandidates(locator, rootDir, { includeRoot });
  for (const candidate of candidates) {
    if (!requireExisting || await pathExists(candidate.dirPath)) {
      return candidate;
    }
  }

  const fallbackHostKey = locator?.hostKey ?? locator?.requestedHostKey ?? 'unknown-host';
  return {
    kind: includeRoot ? 'root' : 'host-key',
    hostKey: includeRoot ? null : fallbackHostKey,
    dirPath: includeRoot
      ? path.join(path.resolve(locator?.workspaceRoot ?? process.cwd()), rootDir)
      : path.join(path.resolve(locator?.workspaceRoot ?? process.cwd()), rootDir, fallbackHostKey),
  };
}

export async function findLatestHostKeyedRunDir(locator, rootDir, { includeRoot = false } = {}) {
  const candidates = buildHostKeyedDirCandidates(locator, rootDir, { includeRoot });
  for (const candidate of candidates) {
    const latestDir = await findLatestRunDir(candidate.dirPath);
    if (latestDir) {
      return latestDir;
    }
  }
  return null;
}

export function artifactUrlMatchesLocator(locator, candidateUrl) {
  const candidateHostKey = normalizeHostKey(candidateUrl);
  if (!candidateHostKey) {
    return false;
  }
  if ((locator?.candidateHostKeys?.length ?? 0) === 0) {
    return candidateHostKey === normalizeHostKey(locator?.baseUrl ?? locator?.inputUrl ?? '');
  }
  return locator.candidateHostKeys.includes(candidateHostKey);
}
