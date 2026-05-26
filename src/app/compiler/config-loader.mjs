// @ts-check

import path from 'node:path';

import {
  readJsonFile,
} from '../../infra/io.mjs';
import { REPO_ROOT, assertRepoRoot } from '../../infra/paths/repo-root.mjs';
import {
  SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
} from './schema.mjs';
import {
  createStaticSiteCompileManifest,
} from './static-compiler.mjs';
import {
  assertNoCompilerSensitiveMaterial,
  assertSiteCompileRequestCompatible,
} from './validator.mjs';
import {
  createCompilerSourceDigest,
} from './digest.mjs';
import {
  canExposeDownloadCapability,
  isDownloadIntent,
  normalizeDownloadAvailability,
} from '../../sites/availability.mjs';
import {
  resolveCapabilityFamilyForIntent,
} from '../../sites/registry/core/capability-intent-mapping.mjs';

const SAFE_REGISTRY_FIELDS = Object.freeze([
  'adapterId',
  'canonicalBaseUrl',
  'capabilityFamilies',
  'downloadSessionRequirement',
  'downloadSupport',
  'downloadTaskTypes',
  'host',
  'interpreterRequired',
  'repoSkillDir',
  'scriptLanguage',
  'siteAccessStatus',
  'siteArchetype',
  'siteKey',
  'templateVersion',
]);

const SAFE_CAPABILITY_FIELDS = Object.freeze([
  'adapterId',
  'approvalActionKinds',
  'baseUrl',
  'capabilityFamilies',
  'downloader',
  'host',
  'pageTypes',
  'primaryArchetype',
  'reasonCodes',
  'routingNotes',
  'safeActionKinds',
  'siteKey',
  'supportedIntents',
]);

/** @param {Record<string, any>} [value] */
function pick(value = {}, keys = []) {
  return Object.fromEntries(
    keys
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]]),
  );
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function siteIdFromKey(siteKey) {
  return `site:${siteKey}`;
}

function normalizeSiteKey(value) {
  return String(value ?? '').trim();
}

function createCompilerSourceError(message) {
  /** @type {Error & Record<string, any>} */
  const error = new Error(message);
  error.code = 'compiler.source_unavailable';
  return error;
}

function resolveRepoLocalConfigPath(repoRoot, inputPath, name) {
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    throw createCompilerSourceError(`${name} must be a repo-local relative path`);
  }
  if (path.isAbsolute(inputPath)) {
    throw createCompilerSourceError(`${name} must not be an absolute path`);
  }
  const root = assertRepoRoot(repoRoot);
  const resolved = path.resolve(root, inputPath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw createCompilerSourceError(`${name} must stay inside the repository root`);
  }
  return {
    absolutePath: resolved,
    sourceRef: relative.replace(/\\/gu, '/'),
  };
}

/**
 * @param {Record<string, any>} [sites]
 * @param {Record<string, any>} options
 */
function findSiteEntry(sites = {}, {
  siteKey,
  host,
  url,
} = {}) {
  const desired = normalizeSiteKey(siteKey);
  const desiredHost = normalizeSiteKey(host ?? hostFromUrl(url));
  for (const [entryHost, entry] of Object.entries(sites)) {
    if (
      desired
      && (entry?.siteKey === desired || entryHost === desired || entry?.host === desired)
    ) {
      return { host: entryHost, site: entry };
    }
    if (
      desiredHost
      && (entryHost === desiredHost || entry?.host === desiredHost || entry?.siteKey === desiredHost)
    ) {
      return { host: entryHost, site: entry };
    }
  }
  return null;
}

function modeForIntent(intent) {
  if (/download/iu.test(intent)) {
    return 'download';
  }
  if (/login|auth/iu.test(intent)) {
    return 'auth';
  }
  if (/diagnostic|doctor|health/iu.test(intent)) {
    return 'diagnostic';
  }
  return 'readOnly';
}

/** @param {Record<string, any>} [capabilitySite] */
function deriveCapabilities(capabilitySite = {}, registrySite = {}) {
  const supportedIntents = Array.isArray(capabilitySite.supportedIntents)
    ? capabilitySite.supportedIntents
    : [];
  const families = Array.isArray(capabilitySite.capabilityFamilies)
    ? capabilitySite.capabilityFamilies
    : registrySite.capabilityFamilies ?? [];
  const requiresLogin = capabilitySite.downloader?.requiresLogin === true
    || registrySite.downloadSessionRequirement === 'required';
  const downloadAvailability = normalizeDownloadAvailability(registrySite, capabilitySite);
  return supportedIntents.map((intent) => {
    const mode = modeForIntent(intent);
    const downloadIntent = isDownloadIntent(intent);
    const downloadExecutable = downloadIntent
      ? canExposeDownloadCapability(downloadAvailability)
      : true;
    const requiresApproval = mode !== 'readOnly'
      || (/search/iu.test(intent) && Array.isArray(capabilitySite.approvalActionKinds)
        && capabilitySite.approvalActionKinds.length > 0);
    return {
      capabilityKey: intent,
      normalizedIntent: intent,
      capabilityFamily: resolveCapabilityFamilyForIntent(intent, families),
      supportedTaskTypes: [intent],
      routeKey: intent,
      routeKind: 'page',
      urlPattern: `${capabilitySite.baseUrl ?? registrySite.canonicalBaseUrl ?? 'https://example.invalid/'}${intent}/:id`,
      pageType: capabilitySite.primaryArchetype ?? registrySite.siteArchetype ?? 'public-detail',
      mode,
      agentExposed: downloadIntent ? downloadExecutable : true,
      executable: downloadIntent ? downloadExecutable : true,
      availability: downloadIntent ? downloadAvailability : undefined,
      enablementStatus: downloadIntent && !downloadExecutable ? 'disabled' : 'enabled',
      requiresApproval,
      requiresAuth: requiresLogin,
      requiresSession: requiresLogin,
      requiresSigner: false,
      riskReasonCode: downloadIntent
        ? downloadAvailability.reasonCode
        : capabilitySite.downloader?.liveAccessReasonCode
          ?? registrySite.downloadSupport?.unsupportedLiveReasonCode,
      riskState: (downloadIntent && !downloadExecutable)
        || /blocked/iu.test(String(capabilitySite.downloader?.liveAccessStatus ?? registrySite.siteAccessStatus ?? ''))
        ? 'blocked'
        : 'normal',
      priority: mode === 'readOnly' ? 10 : 20,
    };
  });
}

/** @param {Record<string, any>} options */
export async function loadCompilerConfigSources({
  repoRoot = REPO_ROOT,
  siteKey,
  host,
  url,
  registryPath = 'config/site-registry.json',
  capabilitiesPath = 'config/site-capabilities.json',
} = {}) {
  const registrySource = resolveRepoLocalConfigPath(repoRoot, registryPath, 'registryPath');
  const capabilitiesSource = resolveRepoLocalConfigPath(repoRoot, capabilitiesPath, 'capabilitiesPath');
  const registry = await readJsonFile(registrySource.absolutePath);
  const capabilities = await readJsonFile(capabilitiesSource.absolutePath);
  const registryMatch = findSiteEntry(registry.sites, { siteKey, host, url });
  const capabilityMatch = findSiteEntry(capabilities.sites, {
    siteKey: siteKey ?? registryMatch?.site?.siteKey,
    host: host ?? registryMatch?.host,
    url,
  });
  if (!registryMatch && !capabilityMatch) {
    /** @type {Error & Record<string, any>} */
    const error = new Error('Site compile config source not found');
    error.code = 'compiler.source_unavailable';
    throw error;
  }

  // @ts-ignore
  const registrySite = pick(registryMatch?.site ?? {}, SAFE_REGISTRY_FIELDS);
  // @ts-ignore
  const capabilityConfig = pick(capabilityMatch?.site ?? {}, SAFE_CAPABILITY_FIELDS);
  const resolvedSiteKey = registrySite.siteKey
    ?? capabilityConfig.siteKey
    ?? siteKey
    ?? registryMatch?.host
    ?? capabilityMatch?.host;
  registrySite.siteKey ??= resolvedSiteKey;
  capabilityConfig.siteKey ??= resolvedSiteKey;
  capabilityConfig.capabilities = deriveCapabilities(capabilityConfig, registrySite);
  const adapterMetadata = {
    adapterId: registrySite.adapterId ?? capabilityConfig.adapterId ?? `${resolvedSiteKey}-adapter`,
    siteArchetype: registrySite.siteArchetype ?? capabilityConfig.primaryArchetype,
    sourceRefs: [registrySource.sourceRef, capabilitiesSource.sourceRef],
    redactionRequired: true,
  };
  const sourceRefs = [
    {
      type: 'site-registry',
      ref: registrySource.sourceRef,
      redactionRequired: true,
    },
    {
      type: 'site-capabilities',
      ref: capabilitiesSource.sourceRef,
      redactionRequired: true,
    },
  ];
  const sourceDigest = createCompilerSourceDigest({
    sourceRefs,
    registrySite,
    capabilityConfig,
    adapterMetadata,
  });
  const result = {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    siteId: siteIdFromKey(resolvedSiteKey),
    siteKey: resolvedSiteKey,
    registrySite,
    capabilityConfig,
    adapterMetadata,
    sourceRefs,
    sourceDigest,
    redactionRequired: true,
  };
  assertNoCompilerSensitiveMaterial(result);
  return result;
}

/** @param {Record<string, any>} options */
export async function createStaticSiteCompileManifestFromConfig({
  request,
  repoRoot = REPO_ROOT,
  previousSourceDigest,
} = {}) {
  assertSiteCompileRequestCompatible(request);
  const sources = await loadCompilerConfigSources({
    repoRoot,
    siteKey: request.siteKey,
    host: request.host,
    url: request.url,
  });
  return createStaticSiteCompileManifest({
    request: {
      ...request,
      siteId: request.siteId ?? sources.siteId,
      siteKey: request.siteKey ?? sources.siteKey,
    },
    registrySite: sources.registrySite,
    capabilityConfig: sources.capabilityConfig,
    adapterMetadata: sources.adapterMetadata,
    sourceRefs: sources.sourceRefs,
    previousSourceDigest,
  });
}
