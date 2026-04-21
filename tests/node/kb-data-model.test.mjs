import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDataModel, isBilibiliKnowledgeBase } from '../../src/pipeline/stages/kb/data-model.mjs';

function createEmptyArtifacts(baseUrl, pageFacts = null) {
  return {
    baseUrl,
    analysis: {
      elementsDocument: { elements: [] },
      statesDocument: {
        states: [{
          stateId: 's0001',
          pageFacts,
          elementStates: [],
        }],
      },
      transitionsDocument: { nodes: [], edges: [] },
      siteProfileDocument: { host: 'www.bilibili.com' },
    },
    abstraction: {
      intentsDocument: { intents: [] },
      actionsDocument: { actions: [] },
      decisionTableDocument: { rules: [] },
      capabilityMatrixDocument: null,
    },
    nlEntry: {
      aliasLexiconDocument: { entries: [] },
      slotSchemaDocument: { intents: [] },
      utterancePatternsDocument: { patterns: [] },
      entryRulesDocument: { rules: [] },
      clarificationRulesDocument: { rules: [] },
    },
    docs: {
      manifest: { documents: [] },
    },
    governance: {
      riskTaxonomyDocument: { categories: [] },
      approvalRulesDocument: { rules: [] },
      recoveryRulesDocument: { rules: [] },
    },
  };
}

test('isBilibiliKnowledgeBase prefers canonical siteKey from siteContext over raw baseUrl host', () => {
  const siteContext = {
    host: 'example.invalid',
    capabilitiesRecord: {
      siteKey: 'bilibili',
      adapterId: 'bilibili',
    },
  };

  assert.equal(
    isBilibiliKnowledgeBase('https://example.invalid/not-bilibili', { siteContext }),
    true,
  );
});

test('buildDataModel enriches bilibili state highlights when canonical siteKey comes from siteContext', () => {
  const artifacts = createEmptyArtifacts('https://example.invalid/not-bilibili', {
    bv: 'BV1WjDDBGE3p',
    authorMid: '1202350411',
  });
  const siteContext = {
    host: 'example.invalid',
    capabilitiesRecord: {
      siteKey: 'bilibili',
      adapterId: 'bilibili',
    },
  };

  const model = buildDataModel(artifacts, { siteContext });

  assert.equal(model.states[0].pageFactHighlights?.bv, 'BV1WjDDBGE3p');
  assert.equal(model.states[0].pageFactHighlights?.authorMid, '1202350411');
});
