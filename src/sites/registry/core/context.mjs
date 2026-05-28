// @ts-check

import {
  readSiteContext as readSiteContextCanonical,
  resolveCapabilityFamiliesFromSiteContext as resolveCapabilityFamiliesFromSiteContextCanonical,
  resolveSiteContextHostKey,
  resolvePageTypesFromSiteContext as resolvePageTypesFromSiteContextCanonical,
  resolvePrimaryArchetypeFromSiteContext as resolvePrimaryArchetypeFromSiteContextCanonical,
  resolveSafeActionKindsFromSiteContext as resolveSafeActionKindsFromSiteContextCanonical,
  resolveSupportedIntentsFromSiteContext as resolveSupportedIntentsFromSiteContextCanonical,
} from '../catalog/context.mjs';

export async function readSiteContext(workspaceRoot = process.cwd(), hostOrUrl, pathOptions = /** @type {any} */ ({})) {
  return readSiteContextCanonical(workspaceRoot, resolveSiteContextHostKey(hostOrUrl), pathOptions);
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
