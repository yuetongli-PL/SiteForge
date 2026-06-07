// @ts-check

import {
  diffCapabilityGraphs,
} from './capability-graph-diff.mjs';

export function assessCapabilityAuthDiff(previousGraph = {}, nextGraph = {}, options = {}) {
  const diff = diffCapabilityGraphs(previousGraph, nextGraph, options);
  return {
    schemaVersion: diff.schemaVersion,
    summary: diff.summary,
    authChanges: diff.changes.filter((change) => change.reasonCode.startsWith('capability.auth_')),
  };
}

