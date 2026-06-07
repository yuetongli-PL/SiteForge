// @ts-check

import { createHash } from 'node:crypto';

import {
  stringifyCanonicalCapabilityGraph,
} from './capability-graph-canonicalize.mjs';

export function createCapabilityGraphDigest(graph = {}, options = {}) {
  const canonical = stringifyCanonicalCapabilityGraph(graph, options);
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

