import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  assessCapabilityAuthDiff,
  assessCapabilityContractCompatibility,
  assessCapabilityProviderCompatibility,
  assessCapabilityRiskDiff,
  canonicalizeCapabilityGraph,
  createCapabilityGraphDigest,
  createCapabilityGraphRegistry,
  createStableCapabilityId,
  diffCapabilityGraphs,
  extractCapabilityGraphDescriptors,
  listCapabilityGraphRegistrySchemaDefinitions,
  migrateCapabilityGraph,
  sanitizeCapabilityGraphForRegistry,
} from '../../src/domain/capabilities/graph-registry/index.mjs';

const BASE_URL = new URL('./fixtures/capability-graph-versioning-registry-v1/public-read-v1.json', import.meta.url);
const REORDERED_URL = new URL('./fixtures/capability-graph-versioning-registry-v1/public-read-reordered.json', import.meta.url);
const GRAPH_CANARIES = /sf_graph_cookie_secret_123|sf_graph_private_form_secret_456|sf_graph_session_secret_789/u;

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

async function readBaseGraph() {
  return readJson(BASE_URL);
}

function withCapability(graph, patch) {
  const copy = structuredClone(graph);
  copy.capabilities[0] = {
    ...copy.capabilities[0],
    ...patch,
  };
  copy.graphVersion = patch.graphVersion ?? `${graph.graphVersion}-changed`;
  return copy;
}

function reasonCodes(diff) {
  return diff.changes.map((change) => change.reasonCode);
}

function assertDetects(previous, next, reasonCode, severity = undefined) {
  const diff = diffCapabilityGraphs(previous, next);
  const change = diff.changes.find((item) => item.reasonCode === reasonCode);
  assert.ok(change, `${reasonCode} should be detected`);
  if (severity) assert.equal(change.severity, severity);
  return change;
}

test('Phase 11 graph registry schemas are versioned', () => {
  const definitions = listCapabilityGraphRegistrySchemaDefinitions();
  assert.deepEqual(definitions.map((entry) => entry.version), [1, 1, 1, 1]);
  assert.ok(definitions.every((entry) => entry.sourcePath.includes('graph-registry')));
});

test('stable capability IDs remain unchanged for unchanged graph inputs', async () => {
  const graph = await readBaseGraph();
  const descriptors = extractCapabilityGraphDescriptors(graph);

  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0].id, 'capability:synthetic.example:open-public-page');
  assert.equal(createStableCapabilityId(graph.capabilities[0]), descriptors[0].id);
});

test('graph digest changes when meaningful contract changes', async () => {
  const graph = await readBaseGraph();
  const writeGraph = withCapability(graph, { operationKind: 'write', sideEffecting: true });

  assert.notEqual(createCapabilityGraphDigest(graph), createCapabilityGraphDigest(writeGraph));
  assertDetects(graph, writeGraph, 'capability.read_to_write', 'high');
  assertDetects(graph, writeGraph, 'capability.side_effect_introduced', 'high');
});

test('pure metadata reorder canonicalizes without high-risk diff', async () => {
  const graph = await readBaseGraph();
  const reordered = await readJson(REORDERED_URL);

  assert.deepEqual(canonicalizeCapabilityGraph(graph), canonicalizeCapabilityGraph(reordered));
  assert.equal(createCapabilityGraphDigest(graph), createCapabilityGraphDigest(reordered));
  assert.equal(diffCapabilityGraphs(graph, reordered).summary.highRiskChangeCount, 0);
});

test('public to auth required is high risk and captured by auth diff', async () => {
  const graph = await readBaseGraph();
  const authGraph = withCapability(graph, { authRequired: true, authScopes: ['read:self'] });

  assertDetects(graph, authGraph, 'capability.auth_requirement_added', 'high');
  assertDetects(graph, authGraph, 'capability.auth_scope_widened', 'high');
  assert.equal(assessCapabilityAuthDiff(graph, authGraph).authChanges.length, 2);
});

test('read to write is high risk', async () => {
  const graph = await readBaseGraph();
  const writeGraph = withCapability(graph, { operationKind: 'write', sideEffecting: true });

  assertDetects(graph, writeGraph, 'capability.read_to_write', 'high');
});

test('write to destructive is critical risk', async () => {
  const graph = withCapability(await readBaseGraph(), { operationKind: 'write', sideEffecting: true });
  const destructiveGraph = withCapability(graph, { operationKind: 'destructive', destructiveAction: true });

  assertDetects(graph, destructiveGraph, 'capability.write_to_destructive', 'critical');
  assertDetects(graph, destructiveGraph, 'capability.destructive_introduced', 'critical');
});

test('non-payment to payment is critical risk', async () => {
  const graph = await readBaseGraph();
  const paymentGraph = withCapability(graph, { operationKind: 'payment', paymentOrFundsAction: true, sideEffecting: true });

  assertDetects(graph, paymentGraph, 'capability.payment_introduced', 'critical');
});

test('auth scope widening is high risk', async () => {
  const graph = withCapability(await readBaseGraph(), { authRequired: true, authScopes: ['read:self'] });
  const widenedGraph = withCapability(graph, { authRequired: true, authScopes: ['read:self', 'write:self'] });

  const change = assertDetects(graph, widenedGraph, 'capability.auth_scope_widened', 'high');
  assert.deepEqual(change.after, ['read:self', 'write:self']);
});

test('allowedOrigins widening is high risk', async () => {
  const graph = await readBaseGraph();
  const widenedGraph = withCapability(graph, { allowedOrigins: ['https://synthetic.example', 'https://api.synthetic.example'] });

  assertDetects(graph, widenedGraph, 'capability.allowed_origins_widened', 'high');
});

test('material type widening is high risk', async () => {
  const graph = await readBaseGraph();
  const widenedGraph = withCapability(graph, { materialTypes: ['descriptor', 'redacted-login-state-descriptor'] });

  assertDetects(graph, widenedGraph, 'capability.material_type_widened', 'high');
});

test('injectionTarget changes are high risk', async () => {
  const graph = await readBaseGraph();
  const changedGraph = withCapability(graph, { injectionTargets: ['browser_context'] });

  assertDetects(graph, changedGraph, 'capability.injection_target_changed', 'high');
});

test('selector confidence drop below threshold is high risk', async () => {
  const graph = await readBaseGraph();
  const lowerConfidenceGraph = withCapability(graph, { selectorConfidence: 0.41 });

  assertDetects(graph, lowerConfidenceGraph, 'capability.selector_confidence_decreased', 'high');
});

test('contract concrete to not concrete is high risk', async () => {
  const graph = await readBaseGraph();
  const notConcreteGraph = withCapability(graph, { executionContractConcrete: false });

  assertDetects(graph, notConcreteGraph, 'capability.contract_concreteness_decreased', 'high');
});

test('provider compatibility changes are detected', async () => {
  const graph = await readBaseGraph();
  const changedGraph = withCapability(graph, { providerCompatibility: ['api-read', 'controlled-browser-action'] });

  assertDetects(graph, changedGraph, 'capability.provider_compatibility_changed', 'high');
  assert.equal(assessCapabilityProviderCompatibility(graph, changedGraph).compatible, false);
});

test('completion signal removal is high risk', async () => {
  const graph = await readBaseGraph();
  const changedGraph = withCapability(graph, { completionSignals: [] });

  assertDetects(graph, changedGraph, 'capability.completion_signal_removed', 'high');
});

test('graph registry stores sanitized graph only and does not retain canaries', async () => {
  const graph = await readBaseGraph();
  const registry = createCapabilityGraphRegistry({ now: () => '2026-06-07T00:00:00.000Z' });
  const entry = registry.put(graph, {
    provenance: {
      source: 'phase-11-test',
      sessionHandle: 'sf_graph_session_secret_789',
    },
  });
  const stored = registry.get(entry.digest);
  const serialized = JSON.stringify(stored);

  assert.ok(stored);
  assert.equal(stored.schemaVersion, 1);
  assert.doesNotMatch(serialized, GRAPH_CANARIES);
  assert.doesNotMatch(serialized, /cookie|sessionHandle|privateFormValue|rawCookie/iu);
  assert.equal(stored.graph.capabilities[0].capabilityId, 'capability:synthetic.example:open-public-page');
});

test('compatibility and risk assessment expose sanitized blocking changes', async () => {
  const graph = await readBaseGraph();
  const changedGraph = withCapability(graph, {
    operationKind: 'payment',
    paymentOrFundsAction: true,
    sideEffecting: true,
  });
  const compatibility = assessCapabilityContractCompatibility(graph, changedGraph);
  const risk = assessCapabilityRiskDiff(graph, changedGraph);

  assert.equal(compatibility.compatible, false);
  assert.ok(compatibility.blockingChangeCount >= 1);
  assert.ok(risk.riskChanges.some((change) => change.reasonCode === 'capability.payment_introduced'));
  assert.doesNotMatch(JSON.stringify(compatibility), GRAPH_CANARIES);
});

test('migration and sanitizer produce descriptor-only output', async () => {
  const graph = await readBaseGraph();
  const sanitized = sanitizeCapabilityGraphForRegistry(graph);
  const migration = migrateCapabilityGraph({ ...graph, schemaVersion: 0 });

  assert.equal(sanitized.schemaVersion, 1);
  assert.equal(migration.migrated, true);
  assert.equal(migration.toSchemaVersion, 1);
  assert.doesNotMatch(JSON.stringify({ sanitized, migration }), GRAPH_CANARIES);
});

test('graph diff and registry do not execute provider, vault, browser, or network hooks', async () => {
  const graph = await readBaseGraph();
  const beforeFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = () => {
    fetchCalled = true;
    throw new Error('fetch should not be called by graph diff');
  };
  try {
    const diff = diffCapabilityGraphs(graph, withCapability(graph, { operationKind: 'write' }));
    assert.ok(reasonCodes(diff).includes('capability.read_to_write'));
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = beforeFetch;
  }
});
