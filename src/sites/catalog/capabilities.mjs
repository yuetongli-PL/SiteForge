// @ts-check

import { createSiteIndexStore } from './index.mjs';

export const SITE_CAPABILITIES_FILE_NAME = 'site-capabilities.json';
export const SITE_CONFIG_DIRECTORY_NAME = 'config';

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
});

export function buildSiteCapabilitiesPath(workspaceRoot = process.cwd()) {
  return siteCapabilitiesStore.buildPath(workspaceRoot);
}

export async function readSiteCapabilities(workspaceRoot = process.cwd()) {
  return siteCapabilitiesStore.read(workspaceRoot);
}

export async function upsertSiteCapabilities(workspaceRoot, host, patch) {
  return siteCapabilitiesStore.upsert(workspaceRoot, host, patch);
}
