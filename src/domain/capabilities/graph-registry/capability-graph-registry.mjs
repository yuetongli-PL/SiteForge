// @ts-check

import { jsonClone } from '../../../shared/clone.mjs';

import {
  CAPABILITY_GRAPH_REGISTRY_ENTRY_SCHEMA_VERSION,
  assertCapabilityGraphRegistryOutputSafe,
  sanitizeCapabilityGraphForRegistry,
} from './capability-graph-schema.mjs';
import {
  canonicalizeCapabilityGraph,
} from './capability-graph-canonicalize.mjs';
import {
  createCapabilityGraphDigest,
} from './capability-graph-digest.mjs';
import {
  diffCapabilityGraphs,
} from './capability-graph-diff.mjs';

function defaultNow() {
  return new Date().toISOString();
}

export function createCapabilityGraphRegistry(options = {}) {
  const entries = new Map();
  const now = typeof options.now === 'function' ? options.now : defaultNow;

  return {
    put(graph = {}, putOptions = {}) {
      const sanitizedGraph = sanitizeCapabilityGraphForRegistry(graph);
      const canonicalGraph = canonicalizeCapabilityGraph(sanitizedGraph, { alreadySanitized: true });
      const digest = createCapabilityGraphDigest(canonicalGraph, { alreadySanitized: true });
      const sanitizedProvenance = sanitizeCapabilityGraphForRegistry({
        graphVersion: sanitizedGraph.graphVersion,
        provenance: putOptions.provenance ?? sanitizedGraph.provenance ?? {},
      }).provenance ?? {};
      const entry = {
        schemaVersion: CAPABILITY_GRAPH_REGISTRY_ENTRY_SCHEMA_VERSION,
        graphVersion: putOptions.graphVersion ?? sanitizedGraph.graphVersion,
        digest,
        createdAt: putOptions.createdAt ?? now(),
        provenance: sanitizedProvenance,
        graph: canonicalGraph,
      };
      assertCapabilityGraphRegistryOutputSafe(entry, 'CapabilityGraphRegistryEntry');
      entries.set(digest, jsonClone(entry));
      return jsonClone(entry);
    },
    get(digest) {
      const entry = entries.get(String(digest ?? ''));
      return entry ? jsonClone(entry) : null;
    },
    list() {
      return [...entries.values()].map((entry) => jsonClone(entry));
    },
    compare(previousDigest, nextDigest, diffOptions = {}) {
      const previous = entries.get(String(previousDigest ?? ''));
      const next = entries.get(String(nextDigest ?? ''));
      if (!previous || !next) {
        throw new Error('Both capability graph registry entries are required for comparison');
      }
      return diffCapabilityGraphs(previous.graph, next.graph, diffOptions);
    },
  };
}
