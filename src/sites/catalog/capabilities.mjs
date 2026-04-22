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

function normalizeCapabilitiesPathOptions(pathOptions = {}) {
  return {
    configDir: pathOptions?.configDir ?? pathOptions?.siteMetadataConfigDir ?? null,
    documentPath: pathOptions?.capabilitiesPath ?? pathOptions?.siteCapabilitiesPath ?? null,
  };
}

function normalizeRuntimeCapabilitiesPathOptions(pathOptions = {}) {
  return {
    configDir: pathOptions?.runtimeDir ?? pathOptions?.siteMetadataRuntimeDir ?? null,
    documentPath: pathOptions?.runtimeCapabilitiesPath ?? pathOptions?.siteRuntimeCapabilitiesPath ?? null,
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

export function buildSiteCapabilitiesPath(workspaceRoot = process.cwd(), pathOptions = {}) {
  return siteCapabilitiesStore.buildPath(workspaceRoot, normalizeCapabilitiesPathOptions(pathOptions));
}

export function buildSiteRuntimeCapabilitiesPath(workspaceRoot = process.cwd(), pathOptions = {}) {
  return siteRuntimeCapabilitiesStore.buildPath(workspaceRoot, normalizeRuntimeCapabilitiesPathOptions(pathOptions));
}

export async function readSiteCapabilities(workspaceRoot = process.cwd(), pathOptions = {}) {
  const [stableDocument, runtimeDocument] = await Promise.all([
    siteCapabilitiesStore.read(workspaceRoot, normalizeCapabilitiesPathOptions(pathOptions)),
    siteRuntimeCapabilitiesStore.read(workspaceRoot, normalizeRuntimeCapabilitiesPathOptions(pathOptions)),
  ]);
  return mergeSiteDocuments(stableDocument, runtimeDocument);
}

export async function upsertSiteCapabilities(workspaceRoot, host, patch, pathOptions = {}) {
  const stableResult = await siteCapabilitiesStore.upsert(
    workspaceRoot,
    host,
    patch,
    normalizeCapabilitiesPathOptions(pathOptions),
  );
  const runtimeResult = await siteRuntimeCapabilitiesStore.upsert(
    workspaceRoot,
    host,
    {},
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
