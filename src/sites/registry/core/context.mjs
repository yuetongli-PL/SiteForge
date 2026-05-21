// @ts-check

import {
  readSiteContext as readSiteContextCanonical,
  resolveCapabilityFamiliesFromSiteContext as resolveCapabilityFamiliesFromSiteContextCanonical,
  resolvePageTypesFromSiteContext as resolvePageTypesFromSiteContextCanonical,
  resolvePrimaryArchetypeFromSiteContext as resolvePrimaryArchetypeFromSiteContextCanonical,
  resolveSafeActionKindsFromSiteContext as resolveSafeActionKindsFromSiteContextCanonical,
  resolveSupportedIntentsFromSiteContext as resolveSupportedIntentsFromSiteContextCanonical,
} from '../catalog/context.mjs';
import { hostFromUrl } from '../../../shared/normalize.mjs';

function resolveHostValue(input) {
  if (typeof input === 'string' && input.trim()) {
    return hostFromUrl(input) ?? input;
  }
  return null;
}

export async function readSiteContext(workspaceRoot = process.cwd(), hostOrUrl, pathOptions = /** @type {any} */ ({})) {
  const resolvedHost = resolveHostValue(hostOrUrl);
  return readSiteContextCanonical(workspaceRoot, resolvedHost ?? hostOrUrl, pathOptions);
}

export function resolvePrimaryArchetypeFromSiteContext(siteContext, fallbacks = /** @type {any[]} */ ([])) {
  return resolvePrimaryArchetypeFromSiteContextCanonical(siteContext, fallbacks);
}

export function resolveCapabilityFamiliesFromSiteContext(siteContext, fallbacks = /** @type {any[]} */ ([])) {
  return resolveCapabilityFamiliesFromSiteContextCanonical(siteContext, fallbacks);
}

export function resolveSupportedIntentsFromSiteContext(siteContext, fallbacks = /** @type {any[]} */ ([])) {
  return resolveSupportedIntentsFromSiteContextCanonical(siteContext, fallbacks);
}

export function resolveSafeActionKindsFromSiteContext(siteContext, fallbacks = /** @type {any[]} */ ([])) {
  return resolveSafeActionKindsFromSiteContextCanonical(siteContext, fallbacks);
}

export function resolvePageTypesFromSiteContext(siteContext, fallbacks = /** @type {any[]} */ ([])) {
  return resolvePageTypesFromSiteContextCanonical(siteContext, fallbacks);
}
