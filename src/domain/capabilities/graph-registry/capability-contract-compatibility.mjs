// @ts-check

import {
  CAPABILITY_GRAPH_COMPATIBILITY_SCHEMA_VERSION,
  assertCapabilityGraphRegistryOutputSafe,
} from './capability-graph-schema.mjs';
import {
  diffCapabilityGraphs,
} from './capability-graph-diff.mjs';

export function assessCapabilityContractCompatibility(previousGraph = {}, nextGraph = {}, options = {}) {
  const diff = diffCapabilityGraphs(previousGraph, nextGraph, options);
  const blockingChanges = diff.changes.filter((change) => ['high', 'critical'].includes(change.severity));
  const result = {
    schemaVersion: CAPABILITY_GRAPH_COMPATIBILITY_SCHEMA_VERSION,
    compatible: blockingChanges.length === 0,
    requiresReview: diff.changes.length > 0,
    blockingChangeCount: blockingChanges.length,
    blockingChanges,
    diff,
  };
  assertCapabilityGraphRegistryOutputSafe(result, 'CapabilityContractCompatibility');
  return result;
}

