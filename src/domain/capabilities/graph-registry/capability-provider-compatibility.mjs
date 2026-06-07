// @ts-check

import {
  diffCapabilityGraphs,
} from './capability-graph-diff.mjs';

export function assessCapabilityProviderCompatibility(previousGraph = {}, nextGraph = {}, options = {}) {
  const diff = diffCapabilityGraphs(previousGraph, nextGraph, options);
  const providerChanges = diff.changes.filter((change) => change.reasonCode === 'capability.provider_compatibility_changed');
  return {
    schemaVersion: diff.schemaVersion,
    compatible: providerChanges.length === 0,
    providerChanges,
  };
}

