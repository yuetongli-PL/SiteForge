// @ts-check

import {
  CAPABILITY_GRAPH_SCHEMA_VERSION,
  sanitizeCapabilityGraphForRegistry,
} from './capability-graph-schema.mjs';

export function migrateCapabilityGraph(graph = {}, options = {}) {
  const sanitized = sanitizeCapabilityGraphForRegistry({
    ...graph,
    schemaVersion: graph.schemaVersion ?? CAPABILITY_GRAPH_SCHEMA_VERSION,
  });
  return {
    schemaVersion: CAPABILITY_GRAPH_SCHEMA_VERSION,
    migrated: graph.schemaVersion !== CAPABILITY_GRAPH_SCHEMA_VERSION,
    fromSchemaVersion: graph.schemaVersion ?? null,
    toSchemaVersion: CAPABILITY_GRAPH_SCHEMA_VERSION,
    graph: sanitized,
    notes: options.note ? [String(options.note)] : [],
  };
}

