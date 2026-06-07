// @ts-check

import {
  sanitizeCapabilityGraphForRegistry,
} from './capability-graph-schema.mjs';

const SET_LIKE_KEYS = Object.freeze(new Set([
  'allowedActions',
  'allowedMaterial',
  'allowedOrigins',
  'authRequirementRefs',
  'authScopes',
  'blockedActions',
  'capabilityRefs',
  'compatibleProviders',
  'completionSignalRefs',
  'completionSignals',
  'executionGates',
  'forbiddenMaterial',
  'injectionTargets',
  'materialTypes',
  'providerCompatibility',
  'providerIds',
  'reasonCodeRefs',
  'requiredScopes',
  'routeRefs',
  'scopeRefs',
  'sessionRequirementRefs',
  'sourceInventories',
  'sourceRefs',
  'supportedTaskTypes',
  'testEvidenceRefs',
]));

function stableString(value) {
  return JSON.stringify(canonicalizeValue(value));
}

function sortObjectArray(items) {
  return [...items].sort((left, right) => {
    const leftKey = String(left?.id ?? left?.capabilityId ?? left?.type ?? stableString(left));
    const rightKey = String(right?.id ?? right?.capabilityId ?? right?.type ?? stableString(right));
    return leftKey.localeCompare(rightKey);
  });
}

function canonicalizeArray(key, value) {
  const items = value.map((item) => canonicalizeValue(item));
  if (items.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
    return SET_LIKE_KEYS.has(key) ? [...items].sort() : items;
  }
  if (['capabilities', 'nodes', 'edges'].includes(key)) {
    return sortObjectArray(items);
  }
  return items;
}

function canonicalizeValue(value, key = '') {
  if (Array.isArray(value)) return canonicalizeArray(key, value);
  if (value && typeof value === 'object') {
    const output = {};
    for (const entryKey of Object.keys(value).sort()) {
      output[entryKey] = canonicalizeValue(value[entryKey], entryKey);
    }
    return output;
  }
  return value;
}

export function canonicalizeCapabilityGraph(graph = {}, options = {}) {
  const sanitized = options.alreadySanitized === true
    ? graph
    : sanitizeCapabilityGraphForRegistry(graph);
  return canonicalizeValue(sanitized);
}

export function stringifyCanonicalCapabilityGraph(graph = {}, options = {}) {
  return JSON.stringify(canonicalizeCapabilityGraph(graph, options));
}

