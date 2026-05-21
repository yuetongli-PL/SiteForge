// @ts-check

import { createSiteIndexStore } from './index.mjs';

export const SITE_CAPABILITIES_FILE_NAME = 'site-capabilities.json';
export const SITE_CONFIG_DIRECTORY_NAME = 'config';
export const SITE_RUNTIME_METADATA_DIRECTORY_NAME = 'runs/site-metadata';
export const SITE_RUNTIME_CAPABILITIES_FILE_NAME = 'site-capabilities.runtime.json';

const siteCapabilitiesStore = createSiteIndexStore({
  directoryName: SITE_CONFIG_DIRECTORY_NAME,
  fileName: SITE_CAPABILITIES_FILE_NAME,
  arrayFieldModes: {
    pageTypes: 'replace',
    capabilityFamilies: 'replace',
    supportedIntents: 'replace',
    safeActionKinds: 'replace',
    approvalActionKinds: 'replace',
  },
  resultPathKey: 'capabilitiesPath',
  trackTimestamps: false,
});

const siteRuntimeCapabilitiesStore = createSiteIndexStore({
  directoryName: SITE_RUNTIME_METADATA_DIRECTORY_NAME,
  fileName: SITE_RUNTIME_CAPABILITIES_FILE_NAME,
  arrayFieldModes: {},
  resultPathKey: 'runtimeCapabilitiesPath',
});

function normalizeCapabilitiesPathOptions(pathOptions = /** @type {any} */ ({})) {
  return {
    configDir: pathOptions?.configDir ?? pathOptions?.siteMetadataConfigDir ?? null,
    documentPath: pathOptions?.capabilitiesPath ?? pathOptions?.siteCapabilitiesPath ?? null,
  };
}

function normalizeRuntimeCapabilitiesPathOptions(pathOptions = /** @type {any} */ ({})) {
  return {
    configDir: pathOptions?.runtimeDir ?? pathOptions?.siteMetadataRuntimeDir ?? null,
    documentPath: pathOptions?.runtimeCapabilitiesPath ?? pathOptions?.siteRuntimeCapabilitiesPath ?? null,
  };
}

function mergeSiteDocuments(stableDocument, runtimeDocument) {
  const mergedSites = /** @type {any} */ ({});
  const siteKeys = new Set([
    ...Object.keys(stableDocument?.sites ?? {}),
    ...Object.keys(runtimeDocument?.sites ?? {}),
  ]);
  for (const siteKey of siteKeys) {
    mergedSites[siteKey] = {
      ...(stableDocument?.sites?.[siteKey] ?? {}),
      ...(runtimeDocument?.sites?.[siteKey] ?? {}),
      host: siteKey,
    };
  }
  return {
    ...(stableDocument ?? {}),
    generatedAt: runtimeDocument?.generatedAt ?? stableDocument?.generatedAt ?? null,
    sites: mergedSites,
  };
}

function splitCapabilitiesPatch(patch = /** @type {any} */ ({})) {
  const stableKeys = new Set([
    'baseUrl',
    'siteKey',
    'adapterId',
    'primaryArchetype',
    'pageTypes',
    'capabilityFamilies',
    'supportedIntents',
    'safeActionKinds',
    'approvalActionKinds',
    'rankingSupported',
    'rankingModes',
    'categoryTaxonomySupported',
  ]);
  const stablePatch = /** @type {any} */ ({});
  const runtimePatch = /** @type {any} */ ({});
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (stableKeys.has(key)) {
      stablePatch[key] = value;
    } else {
      runtimePatch[key] = value;
    }
  }
  return { stablePatch, runtimePatch };
}

export function buildSiteCapabilitiesPath(workspaceRoot = process.cwd(), pathOptions = /** @type {any} */ ({})) {
  return siteCapabilitiesStore.buildPath(workspaceRoot, normalizeCapabilitiesPathOptions(pathOptions));
}

export function buildSiteRuntimeCapabilitiesPath(workspaceRoot = process.cwd(), pathOptions = /** @type {any} */ ({})) {
  return siteRuntimeCapabilitiesStore.buildPath(workspaceRoot, normalizeRuntimeCapabilitiesPathOptions(pathOptions));
}

export async function readSiteCapabilities(workspaceRoot = process.cwd(), pathOptions = /** @type {any} */ ({})) {
  const [stableDocument, runtimeDocument] = await Promise.all([
    siteCapabilitiesStore.read(workspaceRoot, normalizeCapabilitiesPathOptions(pathOptions)),
    siteRuntimeCapabilitiesStore.read(workspaceRoot, normalizeRuntimeCapabilitiesPathOptions(pathOptions)),
  ]);
  return mergeSiteDocuments(stableDocument, runtimeDocument);
}

export async function upsertSiteCapabilities(workspaceRoot, host, patch, pathOptions = /** @type {any} */ ({})) {
  const { stablePatch, runtimePatch } = splitCapabilitiesPatch(patch);
  const stableResult = Object.keys(stablePatch).length > 0
    ? await siteCapabilitiesStore.upsert(
      workspaceRoot,
      host,
      stablePatch,
      normalizeCapabilitiesPathOptions(pathOptions),
    )
    : {
      capabilitiesPath: buildSiteCapabilitiesPath(workspaceRoot, pathOptions),
      record: null,
    };
  const runtimeResult = await siteRuntimeCapabilitiesStore.upsert(
    workspaceRoot,
    host,
    runtimePatch,
    normalizeRuntimeCapabilitiesPathOptions(pathOptions),
  );
  return {
    ...stableResult,
    ...runtimeResult,
    record: {
      ...(stableResult.record ?? {}),
      ...(runtimeResult.record ?? {}),
      host: stableResult.record?.host ?? runtimeResult.record?.host ?? host,
    },
  };
}
