// @ts-check

import {
  SITE_CAPABILITIES_FILE_NAME,
  SITE_RUNTIME_CAPABILITIES_FILE_NAME,
  buildSiteCapabilitiesPath as buildSiteCapabilitiesPathCanonical,
  buildSiteRuntimeCapabilitiesPath as buildSiteRuntimeCapabilitiesPathCanonical,
  readSiteCapabilities as readSiteCapabilitiesCanonical,
  upsertSiteCapabilities as upsertSiteCapabilitiesCanonical,
} from './capabilities.mjs';
import {
  SITE_REGISTRY_FILE_NAME,
  SITE_RUNTIME_REGISTRY_FILE_NAME,
  buildSiteRegistryPath as buildSiteRegistryPathCanonical,
  buildSiteRuntimeRegistryPath as buildSiteRuntimeRegistryPathCanonical,
  readSiteRegistry as readSiteRegistryCanonical,
  upsertSiteRegistryRecord as upsertSiteRegistryRecordCanonical,
} from './registry.mjs';
import { sanitizeHost } from '../../shared/normalize.mjs';

export {
  SITE_CAPABILITIES_FILE_NAME,
  SITE_REGISTRY_FILE_NAME,
  SITE_RUNTIME_CAPABILITIES_FILE_NAME,
  SITE_RUNTIME_REGISTRY_FILE_NAME,
};

export function buildSiteRegistryPath(workspaceRoot = process.cwd(), pathOptions = {}) {
  return buildSiteRegistryPathCanonical(workspaceRoot, pathOptions);
}

export function buildSiteCapabilitiesPath(workspaceRoot = process.cwd(), pathOptions = {}) {
  return buildSiteCapabilitiesPathCanonical(workspaceRoot, pathOptions);
}

export function buildSiteRuntimeRegistryPath(workspaceRoot = process.cwd(), pathOptions = {}) {
  return buildSiteRuntimeRegistryPathCanonical(workspaceRoot, pathOptions);
}

export function buildSiteRuntimeCapabilitiesPath(workspaceRoot = process.cwd(), pathOptions = {}) {
  return buildSiteRuntimeCapabilitiesPathCanonical(workspaceRoot, pathOptions);
}

export async function readSiteRegistry(workspaceRoot = process.cwd(), pathOptions = {}) {
  return readSiteRegistryCanonical(workspaceRoot, pathOptions);
}

export async function readSiteCapabilities(workspaceRoot = process.cwd(), pathOptions = {}) {
  return readSiteCapabilitiesCanonical(workspaceRoot, pathOptions);
}

export async function upsertSiteRegistryRecord(workspaceRoot, host, patch, pathOptions = {}) {
  return upsertSiteRegistryRecordCanonical(workspaceRoot, host, patch, pathOptions);
}

export async function upsertSiteCapabilities(workspaceRoot, host, patch, pathOptions = {}) {
  return upsertSiteCapabilitiesCanonical(workspaceRoot, host, patch, pathOptions);
}

export async function readSiteRepository(workspaceRoot = process.cwd(), host, pathOptions = {}) {
  const hostKey = sanitizeHost(host);
  const [registry, capabilities] = await Promise.all([
    readSiteRegistryCanonical(workspaceRoot, pathOptions),
    readSiteCapabilitiesCanonical(workspaceRoot, pathOptions),
  ]);
  return {
    host: hostKey,
    registry,
    capabilities,
    registryRecord: registry?.sites?.[hostKey] ?? null,
    capabilitiesRecord: capabilities?.sites?.[hostKey] ?? null,
  };
}
