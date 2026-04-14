// @ts-check

import { readSiteCapabilities } from './site-capabilities.mjs';
import { readSiteRegistry } from './site-registry.mjs';
import { sanitizeHost, uniqueSortedStrings } from './normalize.mjs';

export async function readSiteContext(workspaceRoot = process.cwd(), host) {
  const hostKey = sanitizeHost(host);
  const [registry, capabilities] = await Promise.all([
    readSiteRegistry(workspaceRoot),
    readSiteCapabilities(workspaceRoot),
  ]);
  const registryRecord = registry?.sites?.[hostKey] ?? null;
  const capabilitiesRecord = capabilities?.sites?.[hostKey] ?? null;
  return {
    host: hostKey,
    registry,
    capabilities,
    registryRecord,
    capabilitiesRecord,
  };
}

export function resolvePrimaryArchetypeFromSiteContext(siteContext, fallbacks = []) {
  const candidates = [
    siteContext?.capabilitiesRecord?.primaryArchetype,
    siteContext?.registryRecord?.siteArchetype,
    ...fallbacks,
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim()) ?? null;
}

export function resolveCapabilityFamiliesFromSiteContext(siteContext, fallbacks = []) {
  return uniqueSortedStrings([
    ...(siteContext?.capabilitiesRecord?.capabilityFamilies ?? []),
    ...(siteContext?.registryRecord?.capabilityFamilies ?? []),
    ...fallbacks.flatMap((value) => Array.isArray(value) ? value : []),
  ]);
}

export function resolveSupportedIntentsFromSiteContext(siteContext, fallbacks = []) {
  return uniqueSortedStrings([
    ...(siteContext?.capabilitiesRecord?.supportedIntents ?? []),
    ...fallbacks.flatMap((value) => Array.isArray(value) ? value : []),
  ]);
}

export function resolveSafeActionKindsFromSiteContext(siteContext, fallbacks = []) {
  return uniqueSortedStrings([
    ...(siteContext?.capabilitiesRecord?.safeActionKinds ?? []),
    ...fallbacks.flatMap((value) => Array.isArray(value) ? value : []),
  ]);
}

export function resolvePageTypesFromSiteContext(siteContext, fallbacks = []) {
  return uniqueSortedStrings([
    ...(siteContext?.capabilitiesRecord?.pageTypes ?? []),
    ...fallbacks.flatMap((value) => Array.isArray(value) ? value : []),
  ]);
}
