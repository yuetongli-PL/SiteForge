// @ts-check

import { createSiteIndexStore } from './site-index.mjs';

export const SITE_CAPABILITIES_FILE_NAME = 'site-capabilities.json';

const siteCapabilitiesStore = createSiteIndexStore({
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
