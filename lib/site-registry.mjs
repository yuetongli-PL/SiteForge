// @ts-check

import { createSiteIndexStore } from './site-index.mjs';

export const SITE_REGISTRY_FILE_NAME = 'site-registry.json';

const siteRegistryStore = createSiteIndexStore({
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
