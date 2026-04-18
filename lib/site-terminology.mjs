// @ts-check

import { cleanText, hostFromUrl } from './normalize.mjs';
import { resolveSiteAdapter } from './sites/adapters/resolver.mjs';

function resolveHost(siteContext, inputUrl, candidateUrl) {
  return String(
    siteContext?.host
      ?? hostFromUrl(candidateUrl)
      ?? hostFromUrl(inputUrl)
      ?? ''
  ).toLowerCase();
}

function resolveAdapter(siteContext, inputUrl, candidateUrl = null) {
  return resolveSiteAdapter({
    host: resolveHost(siteContext, inputUrl, candidateUrl),
    inputUrl,
    siteContext,
  });
}

export function resolveSiteTerminology(siteContext, inputUrl) {
  return resolveAdapter(siteContext, inputUrl).terminology({
    siteContext,
    inputUrl,
  });
}

export function displayIntentName(intentType, siteContext, inputUrl) {
  return resolveAdapter(siteContext, inputUrl).displayIntentName({
    intentType,
    siteContext,
    inputUrl,
  });
}

export function normalizeDisplayLabel(value, options = {}) {
  const adapter = resolveAdapter(options.siteContext, options.inputUrl, options.url);
  return adapter.normalizeDisplayLabel({
    value,
    ...options,
  }) ?? cleanText(value);
}
