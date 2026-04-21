import { KNOWN_SITE_RENDERERS } from './site-renderers/registry.mjs';

export function renderKnownSiteDocument(siteKey, kind, input) {
  return KNOWN_SITE_RENDERERS[siteKey]?.[kind]?.(input) ?? null;
}
