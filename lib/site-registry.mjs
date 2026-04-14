// @ts-check

import path from 'node:path';
import { pathExists, readJsonFile, writeJsonFile } from './io.mjs';
import { sanitizeHost, uniqueSortedStrings } from './normalize.mjs';

export const SITE_REGISTRY_FILE_NAME = 'site-registry.json';

export function buildSiteRegistryPath(workspaceRoot = process.cwd()) {
  return path.resolve(workspaceRoot, SITE_REGISTRY_FILE_NAME);
}

export async function readSiteRegistry(workspaceRoot = process.cwd()) {
  const registryPath = buildSiteRegistryPath(workspaceRoot);
  if (!await pathExists(registryPath)) {
    return {
      version: 1,
      generatedAt: null,
      sites: {},
    };
  }
  const registry = await readJsonFile(registryPath);
  registry.version ??= 1;
  registry.generatedAt ??= null;
  registry.sites ??= {};
  return registry;
}

export async function upsertSiteRegistryRecord(workspaceRoot, host, patch) {
  const registryPath = buildSiteRegistryPath(workspaceRoot);
  const registry = await readSiteRegistry(workspaceRoot);
  const hostKey = sanitizeHost(host);
  const previous = registry.sites?.[hostKey] ?? {};
  const next = {
    ...previous,
    ...patch,
    host: hostKey,
    capabilityFamilies: uniqueSortedStrings([
      ...(previous.capabilityFamilies ?? []),
      ...(patch?.capabilityFamilies ?? []),
    ]),
    updatedAt: new Date().toISOString(),
  };
  registry.generatedAt = next.updatedAt;
  registry.sites = {
    ...(registry.sites ?? {}),
    [hostKey]: next,
  };
  await writeJsonFile(registryPath, registry);
  return {
    registryPath,
    record: next,
  };
}
