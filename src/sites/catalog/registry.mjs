// @ts-check

import path from 'node:path';
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

const REGISTRY_STABLE_PATH_KEYS = Object.freeze([
  'downloadEntrypoint',
  'downloadPlanner',
  'downloadResolver',
  'downloadExecutor',
  'rankingQueryEntrypoint',
  'repoSkillDir',
  'crawlerScriptsDir',
]);

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

function isUrlLike(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//iu.test(String(value ?? '').trim());
}

function toRepoRelativePath(workspaceRoot, value) {
  const text = String(value ?? '').trim();
  if (!text || isUrlLike(text)) {
    return value;
  }
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedValue = path.isAbsolute(text) ? path.normalize(text) : path.resolve(resolvedRoot, text);
  const relative = path.relative(resolvedRoot, resolvedValue);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return value;
  }
  return relative.split(path.sep).join('/');
}

function resolveRepoRelativePath(workspaceRoot, value) {
  const text = String(value ?? '').trim();
  if (!text || isUrlLike(text) || path.isAbsolute(text)) {
    return value;
  }
  return path.resolve(workspaceRoot, text.split('/').join(path.sep));
}

function normalizeStableRegistryPatch(workspaceRoot, patch = {}) {
  const normalizedPatch = { ...patch };
  for (const key of REGISTRY_STABLE_PATH_KEYS) {
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, key)) {
      normalizedPatch[key] = toRepoRelativePath(workspaceRoot, normalizedPatch[key]);
    }
  }
  return normalizedPatch;
}

function resolveRegistryRecordPaths(workspaceRoot, record = {}) {
  const resolvedRecord = { ...record };
  for (const key of REGISTRY_STABLE_PATH_KEYS) {
    if (Object.prototype.hasOwnProperty.call(resolvedRecord, key)) {
      resolvedRecord[key] = resolveRepoRelativePath(workspaceRoot, resolvedRecord[key]);
    }
  }
  return resolvedRecord;
}

function mergeSiteDocuments(stableDocument, runtimeDocument, workspaceRoot = process.cwd()) {
  const mergedSites = {};
  const siteKeys = new Set([
    ...Object.keys(stableDocument?.sites ?? {}),
    ...Object.keys(runtimeDocument?.sites ?? {}),
  ]);
  for (const siteKey of siteKeys) {
    mergedSites[siteKey] = resolveRegistryRecordPaths(workspaceRoot, {
      ...(stableDocument?.sites?.[siteKey] ?? {}),
      ...(runtimeDocument?.sites?.[siteKey] ?? {}),
      host: siteKey,
    });
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
    'downloadPlanner',
    'downloadResolver',
    'downloadExecutor',
    'downloadSessionRequirement',
    'downloadTaskTypes',
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
  return mergeSiteDocuments(stableDocument, runtimeDocument, workspaceRoot);
}

export async function upsertSiteRegistryRecord(workspaceRoot, host, patch, pathOptions = {}) {
  const { stablePatch, runtimePatch } = splitRegistryPatch(patch);
  const normalizedStablePatch = normalizeStableRegistryPatch(workspaceRoot, stablePatch);
  const stableResult = Object.keys(normalizedStablePatch).length > 0
    ? await siteRegistryStore.upsert(workspaceRoot, host, normalizedStablePatch, normalizeRegistryPathOptions(pathOptions))
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
      ...resolveRegistryRecordPaths(workspaceRoot, stableResult.record ?? {}),
      ...(runtimeResult.record ?? {}),
      host: stableResult.record?.host ?? runtimeResult.record?.host ?? host,
    },
  };
}
