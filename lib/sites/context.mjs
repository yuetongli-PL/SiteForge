// @ts-check

import {
  readSiteContext as readSiteContextLegacy,
  resolveCapabilityFamiliesFromSiteContext as resolveCapabilityFamiliesFromSiteContextLegacy,
  resolvePageTypesFromSiteContext as resolvePageTypesFromSiteContextLegacy,
  resolvePrimaryArchetypeFromSiteContext as resolvePrimaryArchetypeFromSiteContextLegacy,
  resolveSafeActionKindsFromSiteContext as resolveSafeActionKindsFromSiteContextLegacy,
  resolveSupportedIntentsFromSiteContext as resolveSupportedIntentsFromSiteContextLegacy,
} from '../site-context.mjs';
import { hostFromUrl } from '../normalize.mjs';

function resolveHostValue(input) {
  if (typeof input === 'string' && input.trim()) {
    return hostFromUrl(input) ?? input;
  }
  return null;
}

export async function readSiteContext(workspaceRoot = process.cwd(), hostOrUrl) {
  const resolvedHost = resolveHostValue(hostOrUrl);
  return readSiteContextLegacy(workspaceRoot, resolvedHost ?? hostOrUrl);
}

export function resolvePrimaryArchetypeFromSiteContext(siteContext, fallbacks = []) {
  return resolvePrimaryArchetypeFromSiteContextLegacy(siteContext, fallbacks);
}

export function resolveCapabilityFamiliesFromSiteContext(siteContext, fallbacks = []) {
  return resolveCapabilityFamiliesFromSiteContextLegacy(siteContext, fallbacks);
}

export function resolveSupportedIntentsFromSiteContext(siteContext, fallbacks = []) {
  return resolveSupportedIntentsFromSiteContextLegacy(siteContext, fallbacks);
}

export function resolveSafeActionKindsFromSiteContext(siteContext, fallbacks = []) {
  return resolveSafeActionKindsFromSiteContextLegacy(siteContext, fallbacks);
}

export function resolvePageTypesFromSiteContext(siteContext, fallbacks = []) {
  return resolvePageTypesFromSiteContextLegacy(siteContext, fallbacks);
}
