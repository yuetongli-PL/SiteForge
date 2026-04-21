// @ts-check

import { cleanText } from '../../../shared/normalize.mjs';
import { genericNavigationAdapter } from './generic-navigation.mjs';

export function createNavigationRuntimePolicy(profile) {
  return {
    allowedHosts: Array.isArray(profile?.navigation?.allowedHosts) ? profile.navigation.allowedHosts : [],
    sampling: profile?.sampling ?? null,
    pageTypes: profile?.pageTypes ?? null,
  };
}

function normalizeHosts(hosts) {
  return new Set(
    (Array.isArray(hosts) ? hosts : [...(hosts ?? [])])
      .map((host) => String(host ?? '').toLowerCase())
      .filter(Boolean),
  );
}

export function createCatalogAdapter({
  id,
  siteKey = id,
  hosts = [],
  terminology,
  intentLabels = {},
  matches = null,
  inferPageType = () => null,
  normalizeDisplayLabel = ({ value }) => cleanText(value),
  classifyPath = () => ({ kind: null, detail: null }),
} = {}) {
  const normalizedHosts = normalizeHosts(hosts);
  const resolvedMatches = matches ?? (({ host, profile } = {}) => {
    const resolvedHost = String(host ?? profile?.host ?? '').toLowerCase();
    return normalizedHosts.has(resolvedHost);
  });

  return Object.freeze({
    ...genericNavigationAdapter,
    id,
    siteKey,
    matches: resolvedMatches,
    terminology() {
      return { ...(terminology ?? {}) };
    },
    inferPageType,
    displayIntentName({ intentType }) {
      return intentLabels[intentType] ?? String(intentType ?? '');
    },
    normalizeDisplayLabel,
    classifyPath,
    runtimePolicy({ profile } = {}) {
      return createNavigationRuntimePolicy(profile);
    },
  });
}
