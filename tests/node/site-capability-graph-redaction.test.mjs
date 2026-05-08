import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  assertGraphQueryResultCompatible,
  assertGraphValidationReportCompatible,
  listGraphSites,
  validateSiteCapabilityGraph,
} from '../../src/sites/capability/site-capability-graph.mjs';

const MINIMAL_GRAPH_URL = new URL('./fixtures/site-capability-graph/minimal-v1.json', import.meta.url);

async function readMinimalGraphFixture() {
  return JSON.parse(await readFile(MINIMAL_GRAPH_URL, 'utf8'));
}

function captureThrownMessage(fn) {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected function to throw');
}

test('GraphValidationReport compatibility rejects forbidden fields without echoing values', () => {
  const message = captureThrownMessage(() => assertGraphValidationReportCompatible({
    schemaVersion: 1,
    graphVersion: 'synthetic-graph-v1',
    result: 'failed',
    findings: [
      {
        reasonCode: 'graph-schema-invalid',
        message: 'synthetic validation failure',
        accessToken: 'synthetic-secret-value',
      },
    ],
  }));

  assert.match(message, /forbidden field/u);
  assert.doesNotMatch(message, /synthetic-secret-value/u);
});

test('GraphQueryResult compatibility rejects forbidden fields without echoing values', () => {
  const message = captureThrownMessage(() => assertGraphQueryResultCompatible({
    schemaVersion: 1,
    graphVersion: 'synthetic-graph-v1',
    queryName: 'listSites',
    items: [
      {
        id: 'site:synthetic.example',
        type: 'SiteNode',
        authorizationHeader: 'synthetic-secret-value',
      },
    ],
  }));

  assert.match(message, /forbidden field/u);
  assert.doesNotMatch(message, /synthetic-secret-value/u);
});

test('validation and query descriptors do not retain forbidden source values', async () => {
  const graph = await readMinimalGraphFixture();
  graph.nodes[0].cookie = 'synthetic-secret-value';

  const report = validateSiteCapabilityGraph(graph);

  assert.equal(report.result, 'failed');
  assert.deepEqual(report.findings.map((finding) => finding.reasonCode), ['graph-schema-invalid']);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-secret-value/u);

  delete graph.nodes[0].cookie;
  const result = listGraphSites(graph);
  result.items[0].siteKey = 'mutated';

  assert.equal(graph.nodes.find((node) => node.type === 'SiteNode').siteKey, 'synthetic.example');
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret-value/u);
});
