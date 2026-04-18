// @ts-check

import {
  SITE_CAPABILITIES_FILE_NAME,
  buildSiteCapabilitiesPath as buildSiteCapabilitiesPathLegacy,
  readSiteCapabilities as readSiteCapabilitiesLegacy,
  upsertSiteCapabilities as upsertSiteCapabilitiesLegacy,
} from '../site-capabilities.mjs';
import {
  SITE_REGISTRY_FILE_NAME,
  buildSiteRegistryPath as buildSiteRegistryPathLegacy,
  readSiteRegistry as readSiteRegistryLegacy,
  upsertSiteRegistryRecord as upsertSiteRegistryRecordLegacy,
} from '../site-registry.mjs';
import { sanitizeHost } from '../normalize.mjs';

export { SITE_CAPABILITIES_FILE_NAME, SITE_REGISTRY_FILE_NAME };

export function buildSiteRegistryPath(workspaceRoot = process.cwd()) {
  return buildSiteRegistryPathLegacy(workspaceRoot);
}

export function buildSiteCapabilitiesPath(workspaceRoot = process.cwd()) {
  return buildSiteCapabilitiesPathLegacy(workspaceRoot);
}

export async function readSiteRegistry(workspaceRoot = process.cwd()) {
  return readSiteRegistryLegacy(workspaceRoot);
}

export async function readSiteCapabilities(workspaceRoot = process.cwd()) {
  return readSiteCapabilitiesLegacy(workspaceRoot);
}

export async function upsertSiteRegistryRecord(workspaceRoot, host, patch) {
  return upsertSiteRegistryRecordLegacy(workspaceRoot, host, patch);
}

export async function upsertSiteCapabilities(workspaceRoot, host, patch) {
  return upsertSiteCapabilitiesLegacy(workspaceRoot, host, patch);
}

export async function readSiteRepository(workspaceRoot = process.cwd(), host) {
  const hostKey = sanitizeHost(host);
  const [registry, capabilities] = await Promise.all([
    readSiteRegistryLegacy(workspaceRoot),
    readSiteCapabilitiesLegacy(workspaceRoot),
  ]);
  return {
    host: hostKey,
    registry,
    capabilities,
    registryRecord: registry?.sites?.[hostKey] ?? null,
    capabilitiesRecord: capabilities?.sites?.[hostKey] ?? null,
  };
}
