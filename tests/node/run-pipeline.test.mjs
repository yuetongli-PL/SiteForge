import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { parseCliArgs, pipelineCliJson, runPipeline } from '../../src/entrypoints/pipeline/run-pipeline.mjs';
import { PIPELINE_STAGE_SPECS } from '../../src/pipeline/engine/stage-spec.mjs';
import { reasonCodeSummary } from '../../src/sites/capability/reason-codes.mjs';

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

test('pipeline CLI JSON stdout redacts sensitive diagnostics', () => {
  const output = pipelineCliJson({
    inputUrl: 'https://example.com/?access_token=synthetic-pipeline-stdout-access',
    status: 'blocked',
    authKeepalive: {
      sessionHealthSummary: {
        warning: 'Authorization: Bearer synthetic-pipeline-stdout-auth',
      },
    },
    riskRecovery: {
      keepaliveReport: {
        error: 'csrf=synthetic-pipeline-stdout-csrf',
      },
    },
  });

  assert.doesNotMatch(
    output,
    /synthetic-pipeline-stdout-|access_token=|Authorization: Bearer|csrf=/iu,
  );
  const parsed = JSON.parse(output);
  assert.equal(parsed.inputUrl, 'https://example.com/?[REDACTED]');
  assert.equal(parsed.authKeepalive.sessionHealthSummary.warning, 'Authorization: [REDACTED]');
  assert.equal(parsed.riskRecovery.keepaliveReport.error, '[REDACTED]');
});

test('pipeline CLI JSON stdout fails closed without raw cause exposure', () => {
  const recovery = reasonCodeSummary('redaction-failed');
  const payload = {
    toJSON() {
      throw new Error(
        'Cookie: synthetic-pipeline-stdout-cookie refresh_token=synthetic-pipeline-stdout-refresh',
      );
    },
  };

  assert.throws(
    () => pipelineCliJson(payload),
    (error) => {
      assert.equal(error.name, 'PipelineCliSummaryRedactionFailure');
      assert.equal(error.reasonCode, 'redaction-failed');
      assert.equal(error.retryable, recovery.retryable);
      assert.equal(error.cooldownNeeded, recovery.cooldownNeeded);
      assert.equal(error.isolationNeeded, recovery.isolationNeeded);
      assert.equal(error.manualRecoveryNeeded, recovery.manualRecoveryNeeded);
      assert.equal(error.degradable, recovery.degradable);
      assert.equal(error.artifactWriteAllowed, recovery.artifactWriteAllowed);
      assert.equal(error.catalogAction, recovery.catalogAction);
      assert.equal(error.diagnosticWriteAllowed, false);
      assert.equal(Object.hasOwn(error, 'cause'), false);
      assert.deepEqual(error.causeSummary, {
        name: 'Error',
        code: null,
      });
      assert.doesNotMatch(
        `${error.message}\n${JSON.stringify(error)}`,
        /synthetic-pipeline-stdout-|Cookie:|refresh_token=/iu,
      );
      return true;
    },
  );
});

test('runPipeline CLI accepts metadata sandbox directories', () => {
  const parsed = parseCliArgs([
    'https://www.22biqu.com/',
    '--metadata-config-dir',
    'runs/preview/site-metadata/config',
    '--metadata-runtime-dir',
    'runs/preview/site-metadata/runtime',
    '--book-title',
    '玄鉴仙族',
    '--book-url',
    'https://www.22biqu.com/biqu5735/',
    '--skip-fallback',
    '--chapter-fetch-concurrency',
    '24',
  ]);

  assert.equal(parsed.url, 'https://www.22biqu.com/');
  assert.deepEqual(parsed.options.siteMetadataOptions, {
    configDir: 'runs/preview/site-metadata/config',
    runtimeDir: 'runs/preview/site-metadata/runtime',
  });
  assert.equal(parsed.options.targetBookTitle, '玄鉴仙族');
  assert.equal(parsed.options.targetBookUrl, 'https://www.22biqu.com/biqu5735/');
  assert.equal(parsed.options.skipFallback, true);
  assert.equal(parsed.options.chapterFetchConcurrency, 24);
});

test('runPipeline smoke test wires stages in order and passes derived paths', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-run-pipeline-'));
  const calls = [];
  const inputUrl = 'https://jable.tv/videos/ipx-001/';

  const stageDir = (name) => buildStageDir(workspace, name);
  const siteMetadataOptions = {
    configDir: path.join(workspace, 'site-metadata-config'),
    runtimeDir: path.join(workspace, 'site-metadata-runtime'),
  };

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
        targetBookTitle: '  Fixture Book ',
        targetBookUrl: ' https://www.22biqu.com/biqu123/ ',
        skipFallback: true,
        chapterFetchConcurrency: 7,
        reuseLoginState: true,
        autoLogin: true,
        maxCapturedStates: 7,
        strict: false,
        siteMetadataOptions,
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
    assert.equal(calls[2].options.stageTimeoutMs, 30_000);
    assert.equal(calls[2].options.targetBookTitle, 'Fixture Book');
    assert.equal(calls[2].options.targetBookUrl, 'https://www.22biqu.com/biqu123/');
    assert.equal(calls[2].options.skipFallback, true);
    assert.equal(calls[2].options.chapterFetchConcurrency, 7);
    assert.equal(calls[3].options.bookContentDir, stageDir('book-content'));
    assert.equal(calls[4].options.analysisDir, stageDir('analysis'));
    assert.equal(calls[5].options.abstractionDir, stageDir('abstraction'));
    assert.equal(calls[5].options.examplesPath, path.join(workspace, 'examples.json'));
    assert.equal(calls[6].options.nlEntryDir, stageDir('nl-entry'));
    assert.equal(calls[7].options.docsDir, stageDir('docs'));
    assert.equal(calls[8].options.governanceDir, stageDir('governance'));
    assert.equal(calls[8].options.strict, false);
    assert.deepEqual(calls[8].options.siteMetadataOptions, siteMetadataOptions);
    assert.equal(calls[9].options.kbDir, stageDir('kb'));
    assert.equal(calls[9].options.outDir, stageDir('skill-root'));
    assert.equal(calls[9].options.skillName, 'jable-videos');
    assert.deepEqual(calls[9].options.siteMetadataOptions, siteMetadataOptions);

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

test('runPipeline preserves partial bookContent status and continues downstream stages', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-run-pipeline-partial-book-content-'));
  const calls = [];
  const stageDir = (name) => buildStageDir(workspace, name);

  try {
    const stageImpls = createSuccessfulStageImpls(workspace, {
      async collectBookContent(_url, options) {
        calls.push({ stage: 'bookContent', options });
        return {
          status: 'partial',
          outDir: stageDir('book-content'),
          reasonCode: 'book-content-collection-timeout',
          retryable: true,
          summary: { books: 1, failedCollections: 1 },
          negativeQueries: [],
          failures: [
            {
              scope: 'book',
              reasonCode: 'book-content-collection-timeout',
              retryable: true,
            },
          ],
          gaps: [
            {
              stage: 'bookContent',
              status: 'partial',
              reasonCode: 'book-content-collection-timeout',
            },
          ],
        };
      },
      async analyzeStates(_url, options) {
        calls.push({ stage: 'analysis', options });
        return {
          outDir: stageDir('analysis'),
          summary: { states: 2 },
        };
      },
    });

    const result = await runPipeline('https://www.22biqu.com/', {
      timeoutMs: 12_345,
    }, stageImpls);

    assert.equal(calls[0].stage, 'bookContent');
    assert.equal(calls[0].options.stageTimeoutMs, 12_345);
    assert.equal(calls[1].stage, 'analysis');
    assert.equal(calls[1].options.bookContentDir, stageDir('book-content'));
    assert.equal(result.stages.bookContent.status, 'partial');
    assert.equal(result.stages.bookContent.reasonCode, 'book-content-collection-timeout');
    assert.equal(result.stages.bookContent.retryable, true);
    assert.deepEqual(result.stages.bookContent.gaps, [
      {
        stage: 'bookContent',
        status: 'partial',
        reasonCode: 'book-content-collection-timeout',
      },
    ]);
    assert.equal(result.stages.analysis.status, 'success');
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

test('runPipeline retries transient browser navigation errors on expanded stage without rerunning capture', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-run-pipeline-expand-retry-'));
  let captureAttempts = 0;
  let expandAttempts = 0;

  try {
    const stageImpls = createSuccessfulStageImpls(workspace, {
      async capture(url) {
        captureAttempts += 1;
        return {
          status: 'success',
          outDir: buildStageDir(workspace, 'capture'),
          files: { manifest: path.join(buildStageDir(workspace, 'capture'), 'manifest.json') },
          finalUrl: url,
          title: 'Captured Once',
          capturedAt: '2026-04-15T00:00:00.000Z',
        };
      },
      async expandStates() {
        expandAttempts += 1;
        if (expandAttempts === 1) {
          throw new Error('page.goto: net::ERR_CONNECTION_CLOSED at https://www.22biqu.com/');
        }
        return {
          outDir: buildStageDir(workspace, 'expanded'),
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
    });

    const result = await runPipeline('https://www.22biqu.com/', {
      expandedOutDir: buildStageDir(workspace, 'expanded-root'),
      reuseLoginState: false,
      autoLogin: false,
    }, stageImpls);

    assert.equal(captureAttempts, 1);
    assert.equal(expandAttempts, 2);
    assert.equal(result.pipelinePartial, undefined);
    assert.equal(result.stages.capture.title, 'Captured Once');
    assert.equal(result.stages.expanded.status, 'success');
    assert.equal(result.stages.knowledgeBase.status, 'success');
    assert.equal(result.stages.skill.status, 'success');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runPipeline writes a redacted partial preview result after final expanded-stage transient failure', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-run-pipeline-expand-partial-'));
  let captureAttempts = 0;
  let expandAttempts = 0;
  let analysisCalls = 0;
  const expandedOutDir = buildStageDir(workspace, 'expanded-root');

  try {
    const stageImpls = createSuccessfulStageImpls(workspace, {
      async capture(url) {
        captureAttempts += 1;
        return {
          status: 'success',
          outDir: buildStageDir(workspace, 'capture'),
          files: { manifest: path.join(buildStageDir(workspace, 'capture'), 'manifest.json') },
          finalUrl: url,
          title: 'Captured Before Expand Failure',
          capturedAt: '2026-04-15T00:00:00.000Z',
        };
      },
      async expandStates() {
        expandAttempts += 1;
        throw new Error(
          'page.goto: net::ERR_CONNECTION_CLOSED Authorization: Bearer synthetic-expand-partial-secret',
        );
      },
      async analyzeStates() {
        analysisCalls += 1;
        throw new Error('analysis should not run after partial expanded-stage failure');
      },
    });

    const result = await runPipeline('https://www.22biqu.com/', {
      expandedOutDir,
      reuseLoginState: false,
      autoLogin: false,
    }, stageImpls);

    assert.equal(captureAttempts, 1);
    assert.equal(expandAttempts, 2);
    assert.equal(analysisCalls, 0);
    assert.equal(result.pipelinePartial, true);
    assert.equal(result.kbDir, path.join(expandedOutDir, 'partial-knowledge-base'));
    assert.equal(result.skillDir, path.join(expandedOutDir, 'partial-skill', '22biqu'));
    assert.equal(result.stages.capture.status, 'success');
    assert.equal(result.stages.expanded.stage, 'expanded');
    assert.equal(result.stages.expanded.status, 'partial');
    assert.equal(result.stages.expanded.reasonCode, 'expand-navigation-failed');
    assert.equal(result.stages.expanded.retryable, true);
    assert.equal(result.stages.expanded.attempts, 2);
    assert.equal(result.stages.expanded.failed, true);
    assert.equal(result.stages.analysis.status, 'skipped');
    assert.equal(result.stages.knowledgeBase.status, 'partial');
    assert.equal(result.stages.knowledgeBase.kbDir, result.kbDir);
    assert.equal(result.stages.knowledgeBase.redactionRequired, true);
    assert.equal(result.partialKnowledgeBase.repoLocalKnowledgeBaseWriteSkipped, false);
    assert.equal(result.stages.skill.status, 'partial');
    assert.equal(result.stages.skill.skillDir, result.skillDir);
    assert.equal(result.stages.skill.repoLocalSkillUpdated, false);
    assert.equal(result.partialPreview.result.sourceCaptureRefs.manifestPath, path.join(buildStageDir(workspace, 'capture'), 'manifest.json'));
    assert.equal(result.partialPreview.result.redactionRequired, true);
    assert.equal(result.partialPreview.result.noBypassAttempted, true);
    assert.equal(result.partialPreview.result.gaps.some((gap) => gap.status === 'skipped'), true);
    assert.doesNotMatch(
      JSON.stringify(result.partialPreview.result),
      /synthetic-expand-partial-secret|Authorization: Bearer/iu,
    );

    const artifactJson = await readFile(result.partialPreview.artifactPath, 'utf8');
    const auditJson = await readFile(result.partialPreview.redactionAuditPath, 'utf8');
    assert.equal(result.partialPreview.artifactPath, path.join(expandedOutDir, 'partial-preview-result.json'));
    assert.equal(result.partialPreview.redactionAuditPath, path.join(expandedOutDir, 'partial-preview-result.redaction-audit.json'));
    assert.doesNotMatch(artifactJson, /synthetic-expand-partial-secret|Authorization: Bearer/iu);
    assert.match(artifactJson, /"status": "partial"/u);
    assert.match(auditJson, /forbidden-pattern/u);

    const partialKbJson = await readFile(result.partialKnowledgeBase.resultPath, 'utf8');
    const partialSkillJson = await readFile(result.partialSkill.resultPath, 'utf8');
    const partialSkillMd = await readFile(result.partialSkill.skillMdPath, 'utf8');
    const partialSkillAudit = await readFile(result.partialSkill.skillMdRedactionAuditPath, 'utf8');
    assert.match(partialKbJson, /"artifactFamily": "pipeline-partial-knowledge-base"/u);
    assert.match(partialKbJson, /"sourceCaptureRefs"/u);
    assert.match(partialKbJson, /"failedStage": "expanded"/u);
    assert.match(partialSkillJson, /"artifactFamily": "pipeline-partial-skill-preview"/u);
    assert.match(partialSkillJson, /"repoLocalSkillUpdated": false/u);
    assert.match(partialSkillMd, /Partial Skill Preview/u);
    assert.match(partialSkillMd, /Status: `partial`/u);
    assert.doesNotMatch(
      `${partialKbJson}\n${partialSkillJson}\n${partialSkillMd}`,
      /synthetic-expand-partial-secret|Authorization: Bearer/iu,
    );
    assert.match(partialSkillAudit, /schemaVersion/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runPipeline redirects partial skill previews away from repo-local skill directories', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-run-pipeline-partial-skill-safe-'));
  const originalCwd = process.cwd();
  const repoSkillDir = path.join(workspace, 'skills', '22biqu');
  const repoSkillFile = path.join(repoSkillDir, 'SKILL.md');
  const expandedOutDir = path.join(workspace, 'runs', 'preview', '22biqu', 'expanded');

  try {
    await mkdir(repoSkillDir, { recursive: true });
    await writeFile(repoSkillFile, 'existing repo-local skill\n', 'utf8');
    process.chdir(workspace);

    const stageImpls = createSuccessfulStageImpls(workspace, {
      async capture(url) {
        return {
          status: 'success',
          outDir: buildStageDir(workspace, 'capture'),
          files: { manifest: path.join(buildStageDir(workspace, 'capture'), 'manifest.json') },
          finalUrl: url,
          title: 'Captured Before Safe Redirect',
          capturedAt: '2026-04-15T00:00:00.000Z',
        };
      },
      async expandStates() {
        throw new Error('page.goto: net::ERR_CONNECTION_CLOSED');
      },
    });

    const result = await runPipeline('https://www.22biqu.com/', {
      expandedOutDir,
      skillOutDir: repoSkillDir,
      reuseLoginState: false,
      autoLogin: false,
    }, stageImpls);

    assert.equal(result.pipelinePartial, true);
    assert.equal(result.partialSkill.repoLocalSkillUpdated, false);
    assert.equal(result.partialSkill.repoLocalSkillWriteSkipped, true);
    assert.equal(result.partialSkill.repoLocalSkillWriteSkippedReason, 'requested-skills-path');
    assert.equal(result.partialSkill.requestedSkillOutDir, repoSkillDir);
    assert.equal(result.skillDir, path.join(expandedOutDir, 'partial-skill', '22biqu'));
    assert.equal(await readFile(repoSkillFile, 'utf8'), 'existing repo-local skill\n');
    assert.match(await readFile(path.join(result.skillDir, 'SKILL.md'), 'utf8'), /Partial Skill Preview/u);
  } finally {
    process.chdir(originalCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runPipeline redirects partial skill previews away from repo-local config directories', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-run-pipeline-partial-config-safe-'));
  const originalCwd = process.cwd();
  const configPreviewDir = path.join(workspace, 'config', 'site-metadata-preview');
  const configFile = path.join(configPreviewDir, 'site-registry.json');
  const expandedOutDir = path.join(workspace, 'runs', 'preview', '22biqu', 'expanded');

  try {
    await mkdir(configPreviewDir, { recursive: true });
    await writeFile(configFile, '{"existing":true}\n', 'utf8');
    process.chdir(workspace);

    const stageImpls = createSuccessfulStageImpls(workspace, {
      async capture(url) {
        return {
          status: 'success',
          outDir: buildStageDir(workspace, 'capture'),
          files: { manifest: path.join(buildStageDir(workspace, 'capture'), 'manifest.json') },
          finalUrl: url,
          title: 'Captured Before Config Safe Redirect',
          capturedAt: '2026-04-15T00:00:00.000Z',
        };
      },
      async expandStates() {
        throw new Error('page.goto: net::ERR_CONNECTION_CLOSED');
      },
    });

    const result = await runPipeline('https://www.22biqu.com/', {
      expandedOutDir,
      skillOutDir: configPreviewDir,
      reuseLoginState: false,
      autoLogin: false,
    }, stageImpls);

    assert.equal(result.pipelinePartial, true);
    assert.equal(result.partialSkill.repoLocalSkillUpdated, false);
    assert.equal(result.partialSkill.repoLocalSkillWriteSkipped, true);
    assert.equal(result.partialSkill.repoLocalSkillWriteSkippedReason, 'requested-config-path');
    assert.equal(result.partialSkill.requestedSkillOutDir, configPreviewDir);
    assert.equal(result.skillDir, path.join(expandedOutDir, 'partial-skill', '22biqu'));
    assert.equal(await readFile(configFile, 'utf8'), '{"existing":true}\n');
    assert.match(await readFile(path.join(result.skillDir, 'SKILL.md'), 'utf8'), /Partial Skill Preview/u);
  } finally {
    process.chdir(originalCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runPipeline redirects partial skill previews away from non-runtime repo paths', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-run-pipeline-partial-skill-repo-safe-'));
  const originalCwd = process.cwd();
  const repoDocsDir = path.join(workspace, 'docs', 'generated-skill-preview');
  const repoDocsFile = path.join(repoDocsDir, 'existing.md');
  const expandedOutDir = path.join(workspace, 'runs', 'preview', '22biqu', 'expanded');

  try {
    await mkdir(repoDocsDir, { recursive: true });
    await writeFile(repoDocsFile, 'existing repo docs\n', 'utf8');
    process.chdir(workspace);

    const stageImpls = createSuccessfulStageImpls(workspace, {
      async capture(url) {
        return {
          status: 'success',
          outDir: buildStageDir(workspace, 'capture'),
          files: { manifest: path.join(buildStageDir(workspace, 'capture'), 'manifest.json') },
          finalUrl: url,
          title: 'Captured Before Repo Path Safe Redirect',
          capturedAt: '2026-04-15T00:00:00.000Z',
        };
      },
      async expandStates() {
        throw new Error('page.goto: net::ERR_CONNECTION_CLOSED');
      },
    });

    const result = await runPipeline('https://www.22biqu.com/', {
      expandedOutDir,
      skillOutDir: repoDocsDir,
      reuseLoginState: false,
      autoLogin: false,
    }, stageImpls);

    assert.equal(result.pipelinePartial, true);
    assert.equal(result.partialSkill.repoLocalSkillUpdated, false);
    assert.equal(result.partialSkill.repoLocalSkillWriteSkipped, true);
    assert.equal(result.partialSkill.repoLocalSkillWriteSkippedReason, 'requested-repo-path');
    assert.equal(result.skillDir, path.join(expandedOutDir, 'partial-skill', '22biqu'));
    assert.equal(await readFile(repoDocsFile, 'utf8'), 'existing repo docs\n');
  } finally {
    process.chdir(originalCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runPipeline redirects partial knowledge base previews away from repo-local config directories', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-run-pipeline-partial-kb-config-safe-'));
  const originalCwd = process.cwd();
  const configPreviewDir = path.join(workspace, 'config', 'partial-kb-preview');
  const configFile = path.join(configPreviewDir, 'site-capabilities.json');
  const expandedOutDir = path.join(workspace, 'runs', 'preview', '22biqu', 'expanded');

  try {
    await mkdir(configPreviewDir, { recursive: true });
    await writeFile(configFile, '{"existing":true}\n', 'utf8');
    process.chdir(workspace);

    const stageImpls = createSuccessfulStageImpls(workspace, {
      async capture(url) {
        return {
          status: 'success',
          outDir: buildStageDir(workspace, 'capture'),
          files: { manifest: path.join(buildStageDir(workspace, 'capture'), 'manifest.json') },
          finalUrl: url,
          title: 'Captured Before Partial KB Config Safe Redirect',
          capturedAt: '2026-04-15T00:00:00.000Z',
        };
      },
      async expandStates() {
        throw new Error('page.goto: net::ERR_CONNECTION_CLOSED');
      },
    });

    const result = await runPipeline('https://www.22biqu.com/', {
      expandedOutDir,
      kbDir: configPreviewDir,
      skillOutDir: path.join(expandedOutDir, 'partial-skill', '22biqu'),
      reuseLoginState: false,
      autoLogin: false,
    }, stageImpls);

    assert.equal(result.pipelinePartial, true);
    assert.equal(result.partialKnowledgeBase.repoLocalKnowledgeBaseWriteSkipped, true);
    assert.equal(result.partialKnowledgeBase.repoLocalKnowledgeBaseWriteSkippedReason, 'requested-config-path');
    assert.equal(result.partialKnowledgeBase.requestedKbDir, configPreviewDir);
    assert.equal(result.stages.knowledgeBase.repoLocalKnowledgeBaseWriteSkipped, true);
    assert.equal(result.kbDir, path.join(expandedOutDir, 'partial-knowledge-base'));
    assert.equal(await readFile(configFile, 'utf8'), '{"existing":true}\n');
    assert.match(await readFile(result.partialKnowledgeBase.resultPath, 'utf8'), /pipeline-partial-knowledge-base/u);
  } finally {
    process.chdir(originalCwd);
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

test('runPipeline defaults stage output roots to runs-aware directories', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-run-pipeline-default-runs-'));
  const calls = [];

  const stageImpls = createSuccessfulStageImpls(workspace, {
    async capture(url, options) {
      calls.push({ stage: 'capture', options });
      return {
        status: 'success',
        outDir: buildStageDir(workspace, 'capture'),
        files: { manifest: path.join(buildStageDir(workspace, 'capture'), 'manifest.json') },
        finalUrl: url,
        title: 'Smoke Capture',
        capturedAt: '2026-04-15T00:00:00.000Z',
      };
    },
    async expandStates(_url, options) {
      calls.push({ stage: 'expanded', options });
      return {
        outDir: buildStageDir(workspace, 'expanded'),
        summary: {
          discoveredTriggers: 0,
          attemptedTriggers: 0,
          capturedStates: 1,
          duplicateStates: 0,
          noopTriggers: 0,
          failedTriggers: 0,
        },
      };
    },
    async collectBookContent(_url, options) {
      calls.push({ stage: 'bookContent', options });
      return {
        outDir: buildStageDir(workspace, 'book-content'),
        summary: { books: 0 },
        negativeQueries: [],
      };
    },
    async analyzeStates(_url, options) {
      calls.push({ stage: 'analysis', options });
      return {
        outDir: buildStageDir(workspace, 'analysis'),
        summary: { states: 1 },
      };
    },
    async abstractInteractions(_url, options) {
      calls.push({ stage: 'abstraction', options });
      return {
        outDir: buildStageDir(workspace, 'abstraction'),
        summary: { intents: 1 },
      };
    },
    async buildNlEntry(_url, options) {
      calls.push({ stage: 'nlEntry', options });
      return {
        outDir: buildStageDir(workspace, 'nl-entry'),
        summary: { entryRules: 1 },
      };
    },
    async generateDocs(_url, options) {
      calls.push({ stage: 'docs', options });
      return {
        outDir: buildStageDir(workspace, 'docs'),
        summary: { documents: 1 },
      };
    },
    async buildGovernance(_url, options) {
      calls.push({ stage: 'governance', options });
      return {
        outDir: buildStageDir(workspace, 'governance'),
        summary: { risks: 1 },
      };
    },
    async compileKnowledgeBase(_url, options) {
      calls.push({ stage: 'knowledgeBase', options });
      return {
        kbDir: buildStageDir(workspace, 'kb'),
        pages: 1,
        lintSummary: { warnings: 0, errors: 0 },
        gapGroups: [],
      };
    },
    async generateSkill(_url, options) {
      calls.push({ stage: 'skill', options });
      return {
        skillDir: buildStageDir(workspace, 'skill'),
        skillName: 'jable-videos',
        references: [],
        warnings: [],
      };
    },
  });

  try {
    await runPipeline('https://www.douyin.com/?recommend=1', {}, stageImpls);

    const findCall = (name) => calls.find((entry) => entry.stage === name);
    assert.equal(findCall('capture').options.outDir, path.resolve(process.cwd(), 'runs', 'pipeline', 'captures'));
    assert.equal(findCall('expanded').options.outDir, path.resolve(process.cwd(), 'runs', 'pipeline', 'expanded-states'));
    assert.equal(findCall('bookContent'), undefined);
    assert.equal(findCall('analysis').options.outDir, path.resolve(process.cwd(), 'runs', 'pipeline', 'state-analysis'));
    assert.equal(findCall('abstraction').options.outDir, path.resolve(process.cwd(), 'runs', 'pipeline', 'interaction-abstraction'));
    assert.equal(findCall('nlEntry').options.outDir, path.resolve(process.cwd(), 'runs', 'pipeline', 'nl-entry'));
    assert.equal(findCall('docs').options.outDir, path.resolve(process.cwd(), 'runs', 'pipeline', 'operation-docs'));
    assert.equal(findCall('governance').options.outDir, path.resolve(process.cwd(), 'runs', 'pipeline', 'governance'));
    assert.equal(findCall('knowledgeBase').options.outDir, undefined);
    assert.equal(findCall('skill').options.outDir, undefined);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runPipeline runs authenticated keepalive preflight before executing stages when a runtime helper is provided', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-run-pipeline-preflight-'));
  const calls = [];

  try {
    const runtime = {
      stageSpecs: PIPELINE_STAGE_SPECS,
      stageImpls: createSuccessfulStageImpls(workspace, {
        async capture(url, options) {
          calls.push({ stage: 'capture', url, options });
          return {
            status: 'success',
            outDir: buildStageDir(workspace, 'capture'),
            files: { manifest: path.join(buildStageDir(workspace, 'capture'), 'manifest.json') },
            finalUrl: url,
            title: 'Preflight Capture',
            capturedAt: '2026-04-15T00:00:00.000Z',
          };
        },
      }),
      async preflightKeepalive(url, options) {
        calls.push({ stage: 'preflightKeepalive', url, options });
        return {
          attempted: true,
          ran: true,
          trigger: 'keepalive-window',
          reason: 'within-preflight-threshold',
          thresholdMinutes: 15,
          sessionHealthSummaryAfter: {
            keepaliveDue: false,
            successfulKeepalives: 5,
          },
          keepaliveReport: {
            keepalive: {
              status: 'kept-alive',
            },
            reports: {
              json: path.join(workspace, 'keepalive', 'report.json'),
              markdown: path.join(workspace, 'keepalive', 'report.md'),
            },
          },
        };
      },
    };

    const result = await runPipeline('https://www.douyin.com/?recommend=1', {
      reuseLoginState: true,
      autoLogin: true,
    }, runtime);

    assert.equal(calls[0].stage, 'preflightKeepalive');
    assert.equal(calls[1].stage, 'capture');
    assert.equal(result.authKeepalive.ran, true);
    assert.equal(result.authKeepalive.trigger, 'keepalive-window');
    assert.equal(result.authKeepalive.status, 'kept-alive');
    assert.equal(result.authKeepalive.sessionHealthSummary?.successfulKeepalives, 5);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runPipeline performs one visible-browser Xiaohongshu keepalive retry and resumes the pipeline after recovery', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-run-pipeline-xiaohongshu-recover-'));
  let captureCalls = 0;
  const captureHeadlessModes = [];
  const keepaliveCalls = [];

  try {
    const runtime = {
      stageSpecs: PIPELINE_STAGE_SPECS,
      stageImpls: createSuccessfulStageImpls(workspace, {
        async capture(url, options) {
          captureCalls += 1;
          captureHeadlessModes.push(options.headless);
          if (captureCalls === 1) {
            return {
              status: 'success',
              outDir: buildStageDir(workspace, 'capture-risk'),
              files: { manifest: path.join(buildStageDir(workspace, 'capture-risk'), 'manifest.json') },
              finalUrl: 'https://www.xiaohongshu.com/website-login/error?error_code=300012&redirectPath=%2Fexplore',
              title: '安全限制',
              pageType: 'auth-page',
              pageFacts: {
                antiCrawlDetected: true,
                antiCrawlSignals: ['ip-risk', 'risk-control', 'verify'],
                antiCrawlReasonCode: 'anti-crawl-verify',
                riskPageDetected: true,
                riskPageCode: '300012',
                redirectPath: '/explore',
              },
              runtimeEvidence: {
                antiCrawlDetected: true,
                antiCrawlSignals: ['ip-risk', 'risk-control', 'verify'],
                antiCrawlReasonCode: 'anti-crawl-verify',
                networkRiskDetected: true,
                noDedicatedIpRiskDetected: true,
              },
              capturedAt: '2026-04-23T00:00:00.000Z',
            };
          }
          return {
            status: 'success',
            outDir: buildStageDir(workspace, 'capture-ok'),
            files: { manifest: path.join(buildStageDir(workspace, 'capture-ok'), 'manifest.json') },
            finalUrl: url,
            title: 'Recovered Capture',
            capturedAt: '2026-04-23T00:01:00.000Z',
          };
        },
      }),
      async siteKeepalive(_url, options) {
        keepaliveCalls.push(options);
        return {
          keepalive: {
            status: 'kept-alive',
            warmupSummary: {
              attempted: true,
              completed: true,
              urls: ['https://www.xiaohongshu.com/notification'],
            },
          },
          reports: {
            json: path.join(workspace, 'keepalive', 'report.json'),
            markdown: path.join(workspace, 'keepalive', 'report.md'),
          },
        };
      },
    };

    const result = await runPipeline('https://www.xiaohongshu.com/explore', {
      reuseLoginState: true,
      autoLogin: false,
    }, runtime);

    assert.equal(captureCalls, 2);
    assert.deepEqual(captureHeadlessModes, [false, false]);
    assert.equal(keepaliveCalls.length, 1);
    assert.equal(keepaliveCalls[0].headless, false);
    assert.equal(keepaliveCalls[0].reuseLoginState, true);
    assert.equal(result.pipelineBlockedByRisk, false);
    assert.equal(result.riskRecovery?.attempted, true);
    assert.equal(result.riskRecovery?.status, 'recovered');
    assert.equal(result.kbDir, buildStageDir(workspace, 'kb'));
    assert.equal(result.skillDir, buildStageDir(workspace, 'skill'));
    assert.equal(result.stages.capture.status, 'success');
    assert.equal(result.stages.expanded.status, 'success');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runPipeline blocks after one Xiaohongshu keepalive retry when capture stays on the restriction page', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-run-pipeline-xiaohongshu-blocked-'));
  let captureCalls = 0;
  const captureHeadlessModes = [];
  const keepaliveCalls = [];

  try {
    const runtime = {
      stageSpecs: PIPELINE_STAGE_SPECS,
      stageImpls: createSuccessfulStageImpls(workspace, {
        async capture() {
          captureCalls += 1;
          captureHeadlessModes.push(arguments[1]?.headless);
          return {
            status: 'success',
            outDir: buildStageDir(workspace, `capture-${captureCalls}`),
            files: { manifest: path.join(buildStageDir(workspace, `capture-${captureCalls}`), 'manifest.json') },
            finalUrl: 'https://www.xiaohongshu.com/website-login/error?error_code=300012&redirectPath=%2Fexplore',
            title: '安全限制',
            pageType: 'auth-page',
            pageFacts: {
              antiCrawlDetected: true,
              antiCrawlSignals: ['ip-risk', 'risk-control', 'verify'],
              antiCrawlReasonCode: 'anti-crawl-verify',
              riskPageDetected: true,
              riskPageCode: '300012',
              redirectPath: '/explore',
            },
            runtimeEvidence: {
              antiCrawlDetected: true,
              antiCrawlSignals: ['ip-risk', 'risk-control', 'verify'],
              antiCrawlReasonCode: 'anti-crawl-verify',
              networkRiskDetected: true,
              noDedicatedIpRiskDetected: true,
            },
            capturedAt: '2026-04-23T00:00:00.000Z',
          };
        },
        async expandStates() {
          throw new Error('expandStates should not run when Xiaohongshu stays blocked by the restriction page');
        },
      }),
      async siteKeepalive(_url, options) {
        keepaliveCalls.push(options);
        return {
          keepalive: {
            status: 'kept-alive',
          },
          reports: {
            json: path.join(workspace, 'keepalive', 'report.json'),
            markdown: path.join(workspace, 'keepalive', 'report.md'),
          },
        };
      },
    };

    const result = await runPipeline('https://www.xiaohongshu.com/explore', {
      reuseLoginState: true,
      autoLogin: false,
    }, runtime);

    assert.equal(captureCalls, 2);
    assert.deepEqual(captureHeadlessModes, [false, false]);
    assert.equal(keepaliveCalls.length, 1);
    assert.equal(result.pipelineBlockedByRisk, true);
    assert.equal(result.kbDir, null);
    assert.equal(result.skillDir, null);
    assert.equal(result.riskRecovery?.status, 'still-blocked');
    assert.equal(result.riskRecovery?.reasonCode, 'anti-crawl-verify');
    assert.deepEqual(result.riskRecovery?.recovery, reasonCodeSummary('anti-crawl-verify'));
    assert.equal(result.antiCrawlReasonCode, 'anti-crawl-verify');
    assert.deepEqual(result.antiCrawlSignals, ['ip-risk', 'risk-control', 'verify']);
    assert.equal(result.riskCauseCode, 'browser-fingerprint-risk');
    assert.equal(result.riskAction, 'use-visible-browser-warmup');
    assert.equal(result.riskState.state, 'captcha_required');
    assert.equal(result.riskState.reasonCode, 'anti-crawl-verify');
    assert.equal(result.riskState.siteKey, 'xiaohongshu');
    assert.equal(result.riskState.scope, 'pipeline-restriction');
    assert.equal(result.riskState.transition.from, 'normal');
    assert.equal(result.riskState.transition.to, 'captcha_required');
    assert.equal(result.riskState.transition.observedAt, result.generatedAt);
    assert.equal(result.riskState.recovery.cooldownNeeded, true);
    assert.equal(result.riskState.recovery.isolationNeeded, true);
    assert.equal(result.riskState.recovery.manualRecoveryNeeded, true);
    assert.equal(result.riskState.recovery.artifactWriteAllowed, true);
    assert.equal(result.stages.capture.status, 'success');
    assert.equal(result.stages.expanded.status, 'skipped');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
