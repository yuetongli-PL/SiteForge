// @ts-check

import { createSiteIndexStore } from './index.mjs';

export const SITE_REGISTRY_FILE_NAME = 'site-registry.json';
export const SITE_CONFIG_DIRECTORY_NAME = 'config';
export const SITE_RUNTIME_METADATA_DIRECTORY_NAME = 'runs/site-metadata';
export const SITE_RUNTIME_REGISTRY_FILE_NAME = 'site-registry.runtime.json';

const siteRegistryStore = createSiteIndexStore({
  directoryName: SITE_CONFIG_DIRECTORY_NAME,
  fileName: SITE_REGISTRY_FILE_NAME,
  arrayFieldModes: {
    capabilityFamilies: 'merge',
  },
  resultPathKey: 'registryPath',
  trackTimestamps: false,
});

const siteRuntimeRegistryStore = createSiteIndexStore({
  directoryName: SITE_RUNTIME_METADATA_DIRECTORY_NAME,
  fileName: SITE_RUNTIME_REGISTRY_FILE_NAME,
  arrayFieldModes: {},
  resultPathKey: 'runtimeRegistryPath',
});

function normalizeRegistryPathOptions(pathOptions = {}) {
  return {
    configDir: pathOptions?.configDir ?? pathOptions?.siteMetadataConfigDir ?? null,
    documentPath: pathOptions?.registryPath ?? pathOptions?.siteRegistryPath ?? null,
  };
}

function normalizeRuntimeRegistryPathOptions(pathOptions = {}) {
  return {
    configDir: pathOptions?.runtimeDir ?? pathOptions?.siteMetadataRuntimeDir ?? null,
    documentPath: pathOptions?.runtimeRegistryPath ?? pathOptions?.siteRuntimeRegistryPath ?? null,
  };
}

function mergeSiteDocuments(stableDocument, runtimeDocument) {
  const mergedSites = {};
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

function splitRegistryPatch(patch = {}) {
  const stableKeys = new Set([
    'canonicalBaseUrl',
    'siteKey',
    'adapterId',
    'siteArchetype',
    'downloadEntrypoint',
    'interpreterRequired',
    'scriptLanguage',
    'templateVersion',
    'rankingQueryEntrypoint',
    'repoSkillDir',
    'crawlerScriptsDir',
    'capabilityFamilies',
  ]);
  const stablePatch = {};
  const runtimePatch = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (stableKeys.has(key)) {
      stablePatch[key] = value;
    } else {
      runtimePatch[key] = value;
    }
  }
  return { stablePatch, runtimePatch };
}

export function buildSiteRegistryPath(workspaceRoot = process.cwd(), pathOptions = {}) {
  return siteRegistryStore.buildPath(workspaceRoot, normalizeRegistryPathOptions(pathOptions));
}

export function buildSiteRuntimeRegistryPath(workspaceRoot = process.cwd(), pathOptions = {}) {
  return siteRuntimeRegistryStore.buildPath(workspaceRoot, normalizeRuntimeRegistryPathOptions(pathOptions));
}

export async function readSiteRegistry(workspaceRoot = process.cwd(), pathOptions = {}) {
  const [stableDocument, runtimeDocument] = await Promise.all([
    siteRegistryStore.read(workspaceRoot, normalizeRegistryPathOptions(pathOptions)),
    siteRuntimeRegistryStore.read(workspaceRoot, normalizeRuntimeRegistryPathOptions(pathOptions)),
  ]);
  return mergeSiteDocuments(stableDocument, runtimeDocument);
}

export async function upsertSiteRegistryRecord(workspaceRoot, host, patch, pathOptions = {}) {
  const { stablePatch, runtimePatch } = splitRegistryPatch(patch);
  const stableResult = Object.keys(stablePatch).length > 0
    ? await siteRegistryStore.upsert(workspaceRoot, host, stablePatch, normalizeRegistryPathOptions(pathOptions))
    : {
      registryPath: buildSiteRegistryPath(workspaceRoot, pathOptions),
      record: null,
    };
  const runtimeResult = await siteRuntimeRegistryStore.upsert(
    workspaceRoot,
    host,
    runtimePatch,
    normalizeRuntimeRegistryPathOptions(pathOptions),
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
