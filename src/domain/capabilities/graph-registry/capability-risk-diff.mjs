// @ts-check

import {
  diffCapabilityGraphs,
} from './capability-graph-diff.mjs';

export function assessCapabilityRiskDiff(previousGraph = {}, nextGraph = {}, options = {}) {
  const diff = diffCapabilityGraphs(previousGraph, nextGraph, options);
  return {
    schemaVersion: diff.schemaVersion,
    summary: diff.summary,
    riskChanges: diff.changes.filter((change) => ['high', 'critical'].includes(change.severity)),
  };
}

