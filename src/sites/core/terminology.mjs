// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import { resolveCanonicalSiteIdentity } from './site-identity.mjs';

function resolveAdapter(siteContext, inputUrl, candidateUrl = null) {
  return resolveCanonicalSiteIdentity({
    siteContext,
    inputUrl,
    url: candidateUrl ?? inputUrl,
  }).adapter;
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
