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
  classifyNode,
  classifyApi,
  detectRestrictionPage = null,
  describeApiCandidateSemantics,
  validateApiCandidate,
  getApiCatalogUpgradePolicy,
  probeHealth,
  normalizeHealthSignal,
  getRecoveryPolicy,
} = {}) {
  const normalizedHosts = normalizeHosts(hosts);
  const resolvedMatches = matches ?? (({ host, profile } = {}) => {
    const resolvedHost = String(host ?? profile?.host ?? '').toLowerCase();
    return normalizedHosts.has(resolvedHost);
  });
  const {
    validateApiCandidate: _genericValidateApiCandidate,
    getApiCatalogUpgradePolicy: _genericGetApiCatalogUpgradePolicy,
    ...genericAdapterDefaults
  } = genericNavigationAdapter;

  const adapter = {
    ...genericAdapterDefaults,
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
  };

  if (typeof validateApiCandidate === 'function') {
    adapter.validateApiCandidate = validateApiCandidate;
  }
  if (typeof classifyNode === 'function') {
    adapter.classifyNode = classifyNode;
  }
  if (typeof classifyApi === 'function') {
    adapter.classifyApi = classifyApi;
  }
  if (typeof detectRestrictionPage === 'function') {
    adapter.detectRestrictionPage = detectRestrictionPage;
  }
  if (typeof describeApiCandidateSemantics === 'function') {
    adapter.describeApiCandidateSemantics = describeApiCandidateSemantics;
  }
  if (typeof getApiCatalogUpgradePolicy === 'function') {
    adapter.getApiCatalogUpgradePolicy = getApiCatalogUpgradePolicy;
  }
  if (typeof probeHealth === 'function') {
    adapter.probeHealth = probeHealth;
  }
  if (typeof normalizeHealthSignal === 'function') {
    adapter.normalizeHealthSignal = normalizeHealthSignal;
  }
  if (typeof getRecoveryPolicy === 'function') {
    adapter.getRecoveryPolicy = getRecoveryPolicy;
  }

  return Object.freeze(adapter);
}
