// @ts-check

import { readSiteCapabilities } from './capabilities.mjs';
import { readSiteRegistry } from './registry.mjs';
import { sanitizeHost, uniqueSortedStrings } from '../../../shared/normalize.mjs';

export async function readSiteContext(workspaceRoot = process.cwd(), host, pathOptions = /** @type {any} */ ({})) {
  const hostKey = sanitizeHost(host);
  const [registry, capabilities] = await Promise.all([
    readSiteRegistry(workspaceRoot, pathOptions),
    readSiteCapabilities(workspaceRoot, pathOptions),
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

export function resolvePrimaryArchetypeFromSiteContext(siteContext, fallbacks = /** @type {any[]} */ ([])) {
  const candidates = [
    siteContext?.capabilitiesRecord?.primaryArchetype,
    siteContext?.registryRecord?.siteArchetype,
    ...fallbacks,
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim()) ?? null;
}

function resolveFallbackStringList(fallbacks = /** @type {any[]} */ ([])) {
  return uniqueSortedStrings(
    fallbacks.flatMap((value) => {
      if (Array.isArray(value)) {
        return value;
      }
      return value == null ? [] : [value];
    }),
  );
}

export function resolveCapabilityFamiliesFromSiteContext(siteContext, fallbacks = /** @type {any[]} */ ([])) {
  const fallbackValues = resolveFallbackStringList(fallbacks);
  if (fallbackValues.length) {
    return fallbackValues;
  }
  return uniqueSortedStrings([
    ...(siteContext?.capabilitiesRecord?.capabilityFamilies ?? []),
    ...(siteContext?.registryRecord?.capabilityFamilies ?? []),
  ]);
}

export function resolveSupportedIntentsFromSiteContext(siteContext, fallbacks = /** @type {any[]} */ ([])) {
  const fallbackValues = resolveFallbackStringList(fallbacks);
  if (fallbackValues.length) {
    return fallbackValues;
  }
  return uniqueSortedStrings([
    ...(siteContext?.capabilitiesRecord?.supportedIntents ?? []),
  ]);
}

export function resolveSafeActionKindsFromSiteContext(siteContext, fallbacks = /** @type {any[]} */ ([])) {
  const fallbackValues = resolveFallbackStringList(fallbacks);
  if (fallbackValues.length) {
    return fallbackValues;
  }
  return uniqueSortedStrings([
    ...(siteContext?.capabilitiesRecord?.safeActionKinds ?? []),
  ]);
}

export function resolvePageTypesFromSiteContext(siteContext, fallbacks = /** @type {any[]} */ ([])) {
  const fallbackValues = resolveFallbackStringList(fallbacks);
  if (fallbackValues.length) {
    return fallbackValues;
  }
  return uniqueSortedStrings([
    ...(siteContext?.capabilitiesRecord?.pageTypes ?? []),
  ]);
}

function resolveFirstStringFromSiteContext(siteContext, keys = /** @type {any[]} */ ([]), fallbacks = /** @type {any[]} */ ([])) {
  const candidates = [
    ...keys.flatMap((key) => [
      siteContext?.capabilitiesRecord?.[key],
      siteContext?.registryRecord?.[key],
    ]),
    ...fallbacks,
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim()) ?? null;
}

export function resolveSiteKeyFromSiteContext(siteContext, fallbacks = /** @type {any[]} */ ([])) {
  return resolveFirstStringFromSiteContext(siteContext, ['siteKey'], fallbacks);
}

export function resolveAdapterIdFromSiteContext(siteContext, fallbacks = /** @type {any[]} */ ([])) {
  return resolveFirstStringFromSiteContext(siteContext, ['adapterId'], fallbacks);
}
