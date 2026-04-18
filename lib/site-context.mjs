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

function resolveFallbackStringList(fallbacks = []) {
  return uniqueSortedStrings(
    fallbacks.flatMap((value) => {
      if (Array.isArray(value)) {
        return value;
      }
      return value == null ? [] : [value];
    }),
  );
}

export function resolveCapabilityFamiliesFromSiteContext(siteContext, fallbacks = []) {
  const fallbackValues = resolveFallbackStringList(fallbacks);
  if (fallbackValues.length) {
    return fallbackValues;
  }
  return uniqueSortedStrings([
    ...(siteContext?.capabilitiesRecord?.capabilityFamilies ?? []),
    ...(siteContext?.registryRecord?.capabilityFamilies ?? []),
  ]);
}

export function resolveSupportedIntentsFromSiteContext(siteContext, fallbacks = []) {
  const fallbackValues = resolveFallbackStringList(fallbacks);
  if (fallbackValues.length) {
    return fallbackValues;
  }
  return uniqueSortedStrings([
    ...(siteContext?.capabilitiesRecord?.supportedIntents ?? []),
  ]);
}

export function resolveSafeActionKindsFromSiteContext(siteContext, fallbacks = []) {
  const fallbackValues = resolveFallbackStringList(fallbacks);
  if (fallbackValues.length) {
    return fallbackValues;
  }
  return uniqueSortedStrings([
    ...(siteContext?.capabilitiesRecord?.safeActionKinds ?? []),
  ]);
}

export function resolvePageTypesFromSiteContext(siteContext, fallbacks = []) {
  const fallbackValues = resolveFallbackStringList(fallbacks);
  if (fallbackValues.length) {
    return fallbackValues;
  }
  return uniqueSortedStrings([
    ...(siteContext?.capabilitiesRecord?.pageTypes ?? []),
  ]);
}
