// @ts-check

import {
  SITE_CAPABILITIES_FILE_NAME,
  buildSiteCapabilitiesPath as buildSiteCapabilitiesPathCanonical,
  readSiteCapabilities as readSiteCapabilitiesCanonical,
  upsertSiteCapabilities as upsertSiteCapabilitiesCanonical,
} from './capabilities.mjs';
import {
  SITE_REGISTRY_FILE_NAME,
  buildSiteRegistryPath as buildSiteRegistryPathCanonical,
  readSiteRegistry as readSiteRegistryCanonical,
  upsertSiteRegistryRecord as upsertSiteRegistryRecordCanonical,
} from './registry.mjs';
import { sanitizeHost } from '../../shared/normalize.mjs';

export { SITE_CAPABILITIES_FILE_NAME, SITE_REGISTRY_FILE_NAME };

export function buildSiteRegistryPath(workspaceRoot = process.cwd()) {
  return buildSiteRegistryPathCanonical(workspaceRoot);
}

export function buildSiteCapabilitiesPath(workspaceRoot = process.cwd()) {
  return buildSiteCapabilitiesPathCanonical(workspaceRoot);
}

export async function readSiteRegistry(workspaceRoot = process.cwd()) {
  return readSiteRegistryCanonical(workspaceRoot);
}

export async function readSiteCapabilities(workspaceRoot = process.cwd()) {
  return readSiteCapabilitiesCanonical(workspaceRoot);
}

export async function upsertSiteRegistryRecord(workspaceRoot, host, patch) {
  return upsertSiteRegistryRecordCanonical(workspaceRoot, host, patch);
}

export async function upsertSiteCapabilities(workspaceRoot, host, patch) {
  return upsertSiteCapabilitiesCanonical(workspaceRoot, host, patch);
}

export async function readSiteRepository(workspaceRoot = process.cwd(), host) {
  const hostKey = sanitizeHost(host);
  const [registry, capabilities] = await Promise.all([
    readSiteRegistryCanonical(workspaceRoot),
    readSiteCapabilitiesCanonical(workspaceRoot),
  ]);
  return {
    host: hostKey,
    registry,
    capabilities,
    registryRecord: registry?.sites?.[hostKey] ?? null,
    capabilitiesRecord: capabilities?.sites?.[hostKey] ?? null,
  };
}
