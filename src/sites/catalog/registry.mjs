// @ts-check

import { createSiteIndexStore } from './index.mjs';

export const SITE_REGISTRY_FILE_NAME = 'site-registry.json';
export const SITE_CONFIG_DIRECTORY_NAME = 'config';

const siteRegistryStore = createSiteIndexStore({
  directoryName: SITE_CONFIG_DIRECTORY_NAME,
  fileName: SITE_REGISTRY_FILE_NAME,
  arrayFieldModes: {
    capabilityFamilies: 'merge',
  },
  resultPathKey: 'registryPath',
});

export function buildSiteRegistryPath(workspaceRoot = process.cwd()) {
  return siteRegistryStore.buildPath(workspaceRoot);
}

export async function readSiteRegistry(workspaceRoot = process.cwd()) {
  return siteRegistryStore.read(workspaceRoot);
}

export async function upsertSiteRegistryRecord(workspaceRoot, host, patch) {
  return siteRegistryStore.upsert(workspaceRoot, host, patch);
}
