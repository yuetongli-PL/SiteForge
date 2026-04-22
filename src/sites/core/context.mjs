// @ts-check

import {
  readSiteContext as readSiteContextCanonical,
  resolveCapabilityFamiliesFromSiteContext as resolveCapabilityFamiliesFromSiteContextCanonical,
  resolvePageTypesFromSiteContext as resolvePageTypesFromSiteContextCanonical,
  resolvePrimaryArchetypeFromSiteContext as resolvePrimaryArchetypeFromSiteContextCanonical,
  resolveSafeActionKindsFromSiteContext as resolveSafeActionKindsFromSiteContextCanonical,
  resolveSupportedIntentsFromSiteContext as resolveSupportedIntentsFromSiteContextCanonical,
} from '../catalog/context.mjs';
import { hostFromUrl } from '../../shared/normalize.mjs';

function resolveHostValue(input) {
  if (typeof input === 'string' && input.trim()) {
    return hostFromUrl(input) ?? input;
  }
  return null;
}

export async function readSiteContext(workspaceRoot = process.cwd(), hostOrUrl, pathOptions = {}) {
  const resolvedHost = resolveHostValue(hostOrUrl);
  return readSiteContextCanonical(workspaceRoot, resolvedHost ?? hostOrUrl, pathOptions);
}

export function resolvePrimaryArchetypeFromSiteContext(siteContext, fallbacks = []) {
  return resolvePrimaryArchetypeFromSiteContextCanonical(siteContext, fallbacks);
}

export function resolveCapabilityFamiliesFromSiteContext(siteContext, fallbacks = []) {
  return resolveCapabilityFamiliesFromSiteContextCanonical(siteContext, fallbacks);
}

export function resolveSupportedIntentsFromSiteContext(siteContext, fallbacks = []) {
  return resolveSupportedIntentsFromSiteContextCanonical(siteContext, fallbacks);
}

export function resolveSafeActionKindsFromSiteContext(siteContext, fallbacks = []) {
  return resolveSafeActionKindsFromSiteContextCanonical(siteContext, fallbacks);
}

export function resolvePageTypesFromSiteContext(siteContext, fallbacks = []) {
  return resolvePageTypesFromSiteContextCanonical(siteContext, fallbacks);
}
