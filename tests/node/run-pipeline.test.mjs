import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { runPipeline } from '../../run-pipeline.mjs';
import { PIPELINE_STAGE_SPECS } from '../../lib/pipeline/stage-spec.mjs';

function buildStageDir(workspace, name) {
  return path.join(workspace, name);
}

function createSuccessfulStageImpls(workspace, overrides = {}) {
  const stageDir = (name) => buildStageDir(workspace, name);
  return {
    async capture(url, options) {
      return {
        status: 'success',
        outDir: stageDir('capture'),
        files: { manifest: path.join(stageDir('capture'), 'manifest.json') },
        finalUrl: url,
        title: 'Smoke Capture',
        capturedAt: '2026-04-15T00:00:00.000Z',
      };
    },
    async expandStates() {
      return {
        outDir: stageDir('expanded'),
        summary: {
          discoveredTriggers: 1,
          attemptedTriggers: 1,
          capturedStates: 2,
          duplicateStates: 0,
          noopTriggers: 0,
          failedTriggers: 0,
        },
      };
    },
    async collectBookContent() {
      return {
        outDir: stageDir('book-content'),
        summary: { books: 0 },
        negativeQueries: [],
      };
    },
    async analyzeStates() {
      return {
        outDir: stageDir('analysis'),
        summary: { states: 2 },
      };
    },
    async abstractInteractions() {
      return {
        outDir: stageDir('abstraction'),
        summary: { intents: 3 },
      };
    },
    async buildNlEntry() {
      return {
        outDir: stageDir('nl-entry'),
        summary: { entryRules: 2 },
      };
    },
    async generateDocs() {
      return {
        outDir: stageDir('docs'),
        summary: { documents: 5 },
      };
    },
    async buildGovernance() {
      return {
        outDir: stageDir('governance'),
        summary: { risks: 1 },
      };
    },
    async compileKnowledgeBase() {
      return {
        kbDir: stageDir('kb'),
        pages: 12,
        lintSummary: { warnings: 0, errors: 0 },
        gapGroups: [],
      };
    },
    async generateSkill() {
      return {
        skillDir: stageDir('skill'),
        skillName: 'jable-videos',
        references: ['README.md'],
        warnings: [],
      };
    },
    ...overrides,
  };
}

test('runPipeline smoke test wires stages in order and passes derived paths', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-run-pipeline-'));
  const calls = [];
  const inputUrl = 'https://jable.tv/videos/ipx-001/';

  const stageDir = (name) => buildStageDir(workspace, name);

  const stageImpls = createSuccessfulStageImpls(workspace, {
    async capture(url, options) {
      calls.push({ stage: 'capture', url, options });
      return {
        status: 'success',
        outDir: stageDir('capture'),
        files: { manifest: path.join(stageDir('capture'), 'manifest.json') },
        finalUrl: url,
        title: 'Smoke Capture',
        capturedAt: '2026-04-15T00:00:00.000Z',
      };
    },
    async expandStates(url, options) {
      calls.push({ stage: 'expanded', url, options });
      return {
        outDir: stageDir('expanded'),
        summary: {
          discoveredTriggers: 1,
          attemptedTriggers: 1,
          capturedStates: 2,
          duplicateStates: 0,
          noopTriggers: 0,
          failedTriggers: 0,
        },
      };
    },
    async collectBookContent(url, options) {
      calls.push({ stage: 'bookContent', url, options });
      return {
        outDir: stageDir('book-content'),
        summary: { books: 0 },
        negativeQueries: [],
      };
    },
    async analyzeStates(url, options) {
      calls.push({ stage: 'analysis', url, options });
      return {
        outDir: stageDir('analysis'),
        summary: { states: 2 },
      };
    },
    async abstractInteractions(url, options) {
      calls.push({ stage: 'abstraction', url, options });
      return {
        outDir: stageDir('abstraction'),
        summary: { intents: 3 },
      };
    },
    async buildNlEntry(url, options) {
      calls.push({ stage: 'nlEntry', url, options });
      return {
        outDir: stageDir('nl-entry'),
        summary: { entryRules: 2 },
      };
    },
    async generateDocs(url, options) {
      calls.push({ stage: 'docs', url, options });
      return {
        outDir: stageDir('docs'),
        summary: { documents: 5 },
      };
    },
    async buildGovernance(url, options) {
      calls.push({ stage: 'governance', url, options });
      return {
        outDir: stageDir('governance'),
        summary: { risks: 1 },
      };
    },
    async compileKnowledgeBase(url, options) {
      calls.push({ stage: 'knowledgeBase', url, options });
      return {
        kbDir: stageDir('kb'),
        pages: 12,
        lintSummary: { warnings: 0, errors: 0 },
        gapGroups: [],
      };
    },
    async generateSkill(url, options) {
      calls.push({ stage: 'skill', url, options });
      return {
        skillDir: stageDir('skill'),
        skillName: 'jable-videos',
        references: ['README.md'],
        warnings: [],
      };
    },
  });

  try {
    const result = await runPipeline(
      inputUrl,
      {
        captureOutDir: stageDir('capture-root'),
        expandedOutDir: stageDir('expanded-root'),
        bookContentOutDir: stageDir('book-content-root'),
        analysisOutDir: stageDir('analysis-root'),
        abstractionOutDir: stageDir('abstraction-root'),
        nlEntryOutDir: stageDir('nl-entry-root'),
        docsOutDir: stageDir('docs-root'),
        governanceOutDir: stageDir('governance-root'),
        kbDir: stageDir('kb-root'),
        skillOutDir: stageDir('skill-root'),
        examplesPath: path.join(workspace, 'examples.json'),
        browserProfileRoot: path.join(workspace, 'browser-profiles'),
        userDataDir: path.join(workspace, 'browser-profiles', 'shared'),
        searchQueries: ['  IPX-001  ', 'Jable '],
        reuseLoginState: true,
        autoLogin: true,
        maxCapturedStates: 7,
        strict: false,
      },
      stageImpls,
    );

    const expectedStageNames = PIPELINE_STAGE_SPECS.map(({ name }) => name);
    assert.deepEqual(calls.map((entry) => entry.stage), expectedStageNames);
    assert.deepEqual(Object.keys(result.stages), expectedStageNames);

    assert.equal(calls[1].options.initialManifestPath, path.join(stageDir('capture'), 'manifest.json'));
    assert.equal(calls[1].options.maxCapturedStates, 7);
    assert.equal(calls[0].options.browserProfileRoot, path.join(workspace, 'browser-profiles'));
    assert.equal(calls[0].options.userDataDir, path.join(workspace, 'browser-profiles', 'shared'));
    assert.equal(calls[0].options.reuseLoginState, true);
    assert.equal(calls[0].options.autoLogin, true);
    assert.equal(calls[1].options.browserProfileRoot, path.join(workspace, 'browser-profiles'));
    assert.equal(calls[1].options.userDataDir, path.join(workspace, 'browser-profiles', 'shared'));
    assert.equal(calls[1].options.reuseLoginState, true);
    assert.equal(calls[1].options.autoLogin, true);
    assert.equal(calls[2].options.expandedStatesDir, stageDir('expanded'));
    assert.equal(calls[3].options.bookContentDir, stageDir('book-content'));
    assert.equal(calls[4].options.analysisDir, stageDir('analysis'));
    assert.equal(calls[5].options.abstractionDir, stageDir('abstraction'));
    assert.equal(calls[5].options.examplesPath, path.join(workspace, 'examples.json'));
    assert.equal(calls[6].options.nlEntryDir, stageDir('nl-entry'));
    assert.equal(calls[7].options.docsDir, stageDir('docs'));
    assert.equal(calls[8].options.governanceDir, stageDir('governance'));
    assert.equal(calls[8].options.strict, false);
    assert.equal(calls[9].options.kbDir, stageDir('kb'));
    assert.equal(calls[9].options.outDir, stageDir('skill-root'));
    assert.equal(calls[9].options.skillName, 'jable-videos');

    assert.deepEqual(calls[0].options.searchQueries, undefined);
    assert.deepEqual(calls[1].options.searchQueries, ['IPX-001', 'Jable']);
    assert.deepEqual(calls[2].options.searchQueries, ['IPX-001', 'Jable']);

    assert.equal(result.kbDir, stageDir('kb'));
    assert.equal(result.skillDir, stageDir('skill'));
    assert.equal(result.skillName, 'jable-videos');
    assert.equal(result.stages.capture.status, 'success');
    assert.deepEqual(result.stages.expanded, {
      status: 'success',
      outDir: stageDir('expanded'),
      discoveredTriggers: 1,
      attemptedTriggers: 1,
      capturedStates: 2,
      duplicateStates: 0,
      noopTriggers: 0,
      failedTriggers: 0,
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runPipeline skips bookContent when the site profile disables it', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-run-pipeline-skip-book-content-'));
  const calls = [];
  const inputUrl = 'https://www.bilibili.com/';
  const stageDir = (name) => buildStageDir(workspace, name);

  const stageImpls = createSuccessfulStageImpls(workspace, {
    async capture(url, options) {
      calls.push({ stage: 'capture', url, options });
      return {
        status: 'success',
        outDir: stageDir('capture'),
        files: { manifest: path.join(stageDir('capture'), 'manifest.json') },
        finalUrl: url,
        title: 'Smoke Capture',
        capturedAt: '2026-04-15T00:00:00.000Z',
      };
    },
    async expandStates(url, options) {
      calls.push({ stage: 'expanded', url, options });
      return {
        outDir: stageDir('expanded'),
        summary: {
          discoveredTriggers: 1,
          attemptedTriggers: 1,
          capturedStates: 2,
          duplicateStates: 0,
          noopTriggers: 0,
          failedTriggers: 0,
        },
      };
    },
    async collectBookContent() {
      throw new Error('collectBookContent should have been skipped');
    },
    async analyzeStates(url, options) {
      calls.push({ stage: 'analysis', url, options });
      return {
        outDir: stageDir('analysis'),
        summary: { states: 2 },
      };
    },
    async abstractInteractions(url, options) {
      calls.push({ stage: 'abstraction', url, options });
      return {
        outDir: stageDir('abstraction'),
        summary: { intents: 3 },
      };
    },
    async buildNlEntry(url, options) {
      calls.push({ stage: 'nlEntry', url, options });
      return {
        outDir: stageDir('nl-entry'),
        summary: { entryRules: 2 },
      };
    },
    async generateDocs(url, options) {
      calls.push({ stage: 'docs', url, options });
      return {
        outDir: stageDir('docs'),
        summary: { documents: 5 },
      };
    },
    async buildGovernance(url, options) {
      calls.push({ stage: 'governance', url, options });
      return {
        outDir: stageDir('governance'),
        summary: { risks: 1 },
      };
    },
    async compileKnowledgeBase(url, options) {
      calls.push({ stage: 'knowledgeBase', url, options });
      return {
        kbDir: stageDir('kb'),
        pages: 12,
        lintSummary: { warnings: 0, errors: 0 },
        gapGroups: [],
      };
    },
    async generateSkill(url, options) {
      calls.push({ stage: 'skill', url, options });
      return {
        skillDir: stageDir('skill'),
        skillName: 'bilibili',
        references: ['README.md'],
        warnings: [],
      };
    },
  });

  try {
    const result = await runPipeline(
      inputUrl,
      {
        captureOutDir: stageDir('capture-root'),
        expandedOutDir: stageDir('expanded-root'),
        bookContentOutDir: stageDir('book-content-root'),
        analysisOutDir: stageDir('analysis-root'),
        abstractionOutDir: stageDir('abstraction-root'),
        nlEntryOutDir: stageDir('nl-entry-root'),
        docsOutDir: stageDir('docs-root'),
        governanceOutDir: stageDir('governance-root'),
        kbDir: stageDir('kb-root'),
        skillOutDir: stageDir('skill-root'),
      },
      stageImpls,
    );

    assert.deepEqual(
      calls.map((entry) => entry.stage),
      ['capture', 'expanded', 'analysis', 'abstraction', 'nlEntry', 'docs', 'governance', 'knowledgeBase', 'skill'],
    );
    assert.equal(result.stages.bookContent.status, 'skipped');
    assert.equal(result.stages.bookContent.reason, 'Skipped by site profile pipeline.skipBookContent.');
    assert.equal(calls[2].options.bookContentDir, undefined);
    assert.equal(calls[7].options.skipBookContent, true);
    assert.equal(calls[7].options.bookContentDir, undefined);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runPipeline fails fast when a stage implementation is missing', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-run-pipeline-missing-'));

  try {
    const stageImpls = createSuccessfulStageImpls(workspace);
    delete stageImpls.capture;

    await assert.rejects(
      () => runPipeline('https://jable.tv/', {}, stageImpls),
      /\[capture\] Missing stage implementation: capture/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runPipeline wraps capture validator failures with the stage name', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-run-pipeline-capture-fail-'));

  try {
    const stageImpls = createSuccessfulStageImpls(workspace, {
      async capture() {
        return {
          status: 'failed',
          error: {
            code: 'E_CAPTURE',
            message: 'simulated capture failure',
          },
        };
      },
    });

    await assert.rejects(
      () => runPipeline('https://jable.tv/', {}, stageImpls),
      /\[capture\] E_CAPTURE: simulated capture failure/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runPipeline retries transient lock errors on retry-enabled stages', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-run-pipeline-retry-'));
  let attempts = 0;

  try {
    const stageImpls = createSuccessfulStageImpls(workspace, {
      async capture(url) {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('EBUSY: resource busy or locked');
        }
        return {
          status: 'success',
          outDir: buildStageDir(workspace, 'capture'),
          files: { manifest: path.join(buildStageDir(workspace, 'capture'), 'manifest.json') },
          finalUrl: url,
          title: 'Retried Capture',
          capturedAt: '2026-04-15T00:00:00.000Z',
        };
      },
    });

    const result = await runPipeline('https://jable.tv/', {}, stageImpls);
    assert.equal(attempts, 2);
    assert.equal(result.stages.capture.title, 'Retried Capture');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runPipeline does not retry non-transient stage failures', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-run-pipeline-no-retry-'));
  let attempts = 0;

  try {
    const stageImpls = createSuccessfulStageImpls(workspace, {
      async capture() {
        attempts += 1;
        throw new Error('hard failure');
      },
    });

    await assert.rejects(
      () => runPipeline('https://jable.tv/', {}, stageImpls),
      /\[capture\] hard failure/u,
    );
    assert.equal(attempts, 1);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
