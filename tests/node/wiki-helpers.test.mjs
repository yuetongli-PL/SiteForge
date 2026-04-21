import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { buildError, buildWarning } from '../../src/shared/wiki.mjs';
import { firstExistingPath, kbAbsolute, relativeToKb, resolveMaybeRelative } from '../../src/shared/wiki.mjs';
import { buildDataModel, buildPageDescriptors, finalizeDataModel } from '../../src/pipeline/stages/kb/data-model.mjs';

test('wiki-report builders normalize string details', () => {
  assert.deepEqual(buildWarning('missing-summary', 'Summary missing', '/tmp/page.md'), {
    severity: 'warning',
    code: 'missing-summary',
    message: 'Summary missing',
    path: '/tmp/page.md',
  });
  assert.deepEqual(buildError('broken-link', 'Broken link', { path: '/tmp/page.md', ref: 'raw/foo' }), {
    severity: 'error',
    code: 'broken-link',
    message: 'Broken link',
    path: '/tmp/page.md',
    ref: 'raw/foo',
  });
});

test('wiki-path helpers resolve kb-relative paths', async () => {
  const root = path.join(os.tmpdir(), `browser-wiki-skill-wiki-paths-${Date.now()}`);
  const kbDir = path.join(root, 'knowledge-base', 'example.com');
  const rawDir = path.join(kbDir, 'raw', 'step-1-capture', 'run-1');
  await mkdir(rawDir, { recursive: true });
  const manifestPath = path.join(rawDir, 'manifest.json');
  await writeFile(manifestPath, '{}', 'utf8');

  assert.equal(relativeToKb(kbDir, manifestPath), 'raw/step-1-capture/run-1/manifest.json');
  assert.equal(kbAbsolute(kbDir, 'raw/step-1-capture/run-1/manifest.json'), manifestPath);
  assert.equal(resolveMaybeRelative('manifest.json', rawDir), manifestPath);
  assert.equal(
    await firstExistingPath([
      { value: 'missing.json', baseDir: rawDir },
      { value: 'manifest.json', baseDir: rawDir },
    ]),
    manifestPath,
  );
});

test('kb data-model builders keep intent docs, page indexes, and raw source refs stable', () => {
  const rawRoot = path.join(os.tmpdir(), `browser-wiki-skill-kb-builders-${Date.now()}`);
  const rawPath = (...segments) => path.join(rawRoot, ...segments);
  const rawResolver = (absolutePath) => {
    if (!absolutePath) {
      return null;
    }
    const resolved = path.resolve(absolutePath);
    if (!resolved.startsWith(rawRoot)) {
      return null;
    }
    return `raw/${path.relative(rawRoot, resolved).split(path.sep).join('/')}`;
  };
  const artifacts = {
    baseUrl: 'https://jable.tv/',
    capture: {
      manifestPath: rawPath('step-1-capture', 'run-1', 'manifest.json'),
      manifest: { title: 'Home' },
    },
    analysis: {
      manifestPath: rawPath('step-3-analysis', 'run-1', 'analysis-manifest.json'),
      elementsPath: rawPath('step-3-analysis', 'run-1', 'elements.json'),
      statesPath: rawPath('step-3-analysis', 'run-1', 'states.json'),
      transitionsPath: rawPath('step-3-analysis', 'run-1', 'transitions.json'),
      elementsDocument: {
        elements: [{
          elementId: 'el-1',
          elementName: 'Search box',
          kind: 'input',
          members: [{ memberId: 'member-1', label: 'Keyword' }],
          evidence: { stateIds: ['state-1'] },
        }],
      },
      statesDocument: {
        states: [{
          stateId: 'state-1',
          stateName: 'Home',
          title: 'Home',
          finalUrl: 'https://jable.tv/',
          sourceStatus: 'initial',
          dedupKey: 'home',
          files: {
            html: rawPath('step-2-expanded', 'run-1', 'state-1.html'),
            snapshot: rawPath('step-2-expanded', 'run-1', 'state-1.snapshot.json'),
            screenshot: rawPath('step-2-expanded', 'run-1', 'state-1.png'),
            manifest: rawPath('step-2-expanded', 'run-1', 'state-1.manifest.json'),
          },
          elementStates: [{ elementId: 'el-1', kind: 'input', value: { visible: true } }],
        }],
      },
      transitionsDocument: {
        nodes: [{ stateId: 'state-1' }],
        edges: [{
          edgeId: 'edge-1',
          observedStateId: 'state-1',
          fromState: 'state-1',
          toState: 'state-1',
        }],
      },
      siteProfileDocument: null,
    },
    abstraction: {
      intentsPath: rawPath('step-4-abstraction', 'run-1', 'intents.json'),
      decisionTablePath: rawPath('step-4-abstraction', 'run-1', 'decision-table.json'),
      intentsDocument: {
        intents: [{
          intentId: 'search',
          intentName: 'Search',
          intentType: 'search',
          actionId: 'action-search',
          elementId: 'el-1',
          sourceElementName: 'Search box',
          stateField: 'query',
          evidence: {
            stateIds: ['state-1'],
            edgeIds: ['edge-1'],
          },
        }],
      },
      actionsDocument: {
        actions: [{
          actionId: 'action-search',
          actionName: 'Search',
        }],
      },
      decisionTableDocument: {
        rules: [{
          ruleId: 'rule-1',
          intentId: 'search',
        }],
      },
      capabilityMatrixDocument: null,
    },
    nlEntry: {
      manifestPath: rawPath('step-5-nl-entry', 'run-1', 'nl-entry-manifest.json'),
      entryRulesPath: rawPath('step-5-nl-entry', 'run-1', 'entry-rules.json'),
      aliasLexiconDocument: {
        entries: [{
          type: 'page',
          aliases: [{ text: 'Home' }],
        }],
      },
      slotSchemaDocument: {
        intents: [{
          intentId: 'search',
          slots: [],
        }],
      },
      utterancePatternsDocument: {
        patterns: [{
          patternId: 'pattern-1',
          intentId: 'search',
          priority: 1,
        }],
      },
      entryRulesDocument: {
        rules: [{
          entryRuleId: 'entry-rule-1',
          intentId: 'search',
          priority: 1,
        }],
      },
      clarificationRulesDocument: {
        rules: [],
      },
    },
    docs: {
      manifestPath: rawPath('step-6-docs', 'run-1', 'docs-manifest.json'),
      manifest: {
        documents: [{
          intentId: 'search',
          path: rawPath('step-6-docs', 'run-1', 'docs', 'search.md'),
        }],
      },
    },
    governance: {
      riskTaxonomyPath: rawPath('step-7-governance', 'run-1', 'risk-taxonomy.json'),
      approvalRulesPath: rawPath('step-7-governance', 'run-1', 'approval-rules.json'),
      recoveryRulesPath: rawPath('step-7-governance', 'run-1', 'recovery-rules.json'),
      riskTaxonomyDocument: {
        categories: [{
          riskCode: 'manual-review',
          title: 'Manual Review',
          severity: 'medium',
          defaultRecovery: 'handoff',
          approvalRequired: true,
        }],
      },
      approvalRulesDocument: {
        rules: [{
          approvalRuleId: 'approval-1',
          riskCode: 'manual-review',
          evidence: {
            stateIds: ['state-1'],
            edgeIds: ['edge-1'],
          },
        }],
      },
      recoveryRulesDocument: {
        rules: [{
          recoveryRuleId: 'recovery-1',
          exceptionType: 'TimeoutError',
        }],
      },
    },
  };

  const model = {
    ...finalizeDataModel(buildDataModel(artifacts)),
    inputUrl: artifacts.baseUrl,
    baseUrl: artifacts.baseUrl,
  };
  const pages = buildPageDescriptors({
    generatedAt: '2026-04-21T00:00:00.000Z',
    artifacts,
    model,
    rawResolver,
    siteContext: { host: 'jable.tv' },
  });

  assert.deepEqual(model.pageTitleTokens, ['Home']);
  assert.equal(model.docsByIntentId.get('search')?.path, rawPath('step-6-docs', 'run-1', 'docs', 'search.md'));
  assert.equal(model.edgeIdsByIntentId.get('search')?.has('edge-1'), true);
  assert.equal(pages.length, 11);

  const statePage = pages.find((page) => page.pageId === 'page_state_state-1');
  const intentPage = pages.find((page) => page.pageId === 'page_intent_search');
  const riskPage = pages.find((page) => page.pageId === 'page_risk_manual-review');

  assert.ok(statePage);
  assert.ok(intentPage);
  assert.ok(riskPage);
  assert.match(statePage.path, /^wiki\/states\//u);
  assert.deepEqual(statePage.relatedIds, ['page_element_el-1']);
  assert.equal(intentPage.sourceRefs.at(-1)?.path, 'raw/step-6-docs/run-1/docs/search.md');
  assert.equal(riskPage.attributes.observedStateCount, 1);
  assert.equal(riskPage.attributes.observedEdgeCount, 1);
});
