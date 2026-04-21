import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { readJsonFile } from '../../src/infra/io.mjs';
import { resolveCaptureSettings } from '../../src/entrypoints/pipeline/capture.mjs';
import { normalizePipelineOptions } from '../../src/pipeline/engine/options.mjs';
import { runPipeline } from '../../src/entrypoints/pipeline/run-pipeline.mjs';
import { siteDoctor } from '../../scripts/site-doctor.mjs';

test('resolveCaptureSettings defaults Douyin to a visible browser while preserving explicit overrides', () => {
  const douyinDefaults = resolveCaptureSettings('https://www.douyin.com/?recommend=1');
  assert.equal(douyinDefaults.settings.headless, false);

  const douyinExplicit = resolveCaptureSettings('https://www.douyin.com/?recommend=1', {
    headless: true,
  });
  assert.equal(douyinExplicit.settings.headless, true);

  const genericDefaults = resolveCaptureSettings('https://example.com/');
  assert.equal(genericDefaults.settings.headless, true);
});

test('normalizePipelineOptions defaults Douyin to a visible browser while preserving explicit overrides', () => {
  const douyinDefaults = normalizePipelineOptions('https://www.douyin.com/?recommend=1');
  assert.equal(douyinDefaults.headless, false);
  assert.equal(douyinDefaults.captureOutDir, path.resolve(process.cwd(), 'runs', 'pipeline', 'captures'));
  assert.equal(douyinDefaults.expandedOutDir, path.resolve(process.cwd(), 'runs', 'pipeline', 'expanded-states'));
  assert.equal(douyinDefaults.analysisOutDir, path.resolve(process.cwd(), 'runs', 'pipeline', 'state-analysis'));
  assert.equal(douyinDefaults.abstractionOutDir, path.resolve(process.cwd(), 'runs', 'pipeline', 'interaction-abstraction'));
  assert.equal(douyinDefaults.nlEntryOutDir, path.resolve(process.cwd(), 'runs', 'pipeline', 'nl-entry'));
  assert.equal(douyinDefaults.docsOutDir, path.resolve(process.cwd(), 'runs', 'pipeline', 'operation-docs'));
  assert.equal(douyinDefaults.governanceOutDir, path.resolve(process.cwd(), 'runs', 'pipeline', 'governance'));
  assert.equal(douyinDefaults.bookContentOutDir, path.resolve(process.cwd(), 'book-content'));
  assert.equal(douyinDefaults.kbDir, undefined);
  assert.equal(douyinDefaults.skillOutDir, undefined);

  const douyinExplicit = normalizePipelineOptions('https://www.douyin.com/?recommend=1', {
    headless: true,
  });
  assert.equal(douyinExplicit.headless, true);

  const genericDefaults = normalizePipelineOptions('https://example.com/');
  assert.equal(genericDefaults.headless, true);
});

function createSuccessfulPipelineStageImpls(workspace, calls = []) {
  const stageDir = (name) => path.join(workspace, name);
  const stage = (name, result) => async (url, options) => {
    calls.push({ stage: name, url, options });
    return result;
  };

  return {
    capture: stage('capture', {
      status: 'success',
      outDir: stageDir('capture'),
      files: { manifest: path.join(stageDir('capture'), 'manifest.json') },
      finalUrl: 'https://www.douyin.com/?recommend=1',
      title: 'Douyin Capture',
      capturedAt: '2026-04-18T00:00:00.000Z',
    }),
    expandStates: stage('expanded', {
      outDir: stageDir('expanded'),
      summary: {
        discoveredTriggers: 1,
        attemptedTriggers: 1,
        capturedStates: 1,
        duplicateStates: 0,
        noopTriggers: 0,
        failedTriggers: 0,
      },
    }),
    collectBookContent: stage('bookContent', {
      status: 'skipped',
      outDir: null,
      summary: {},
      negativeQueries: [],
      reason: 'Skipped by site profile pipeline.skipBookContent.',
    }),
    analyzeStates: stage('analysis', {
      outDir: stageDir('analysis'),
      summary: { states: 1 },
    }),
    abstractInteractions: stage('abstraction', {
      outDir: stageDir('abstraction'),
      summary: { intents: 1 },
    }),
    buildNlEntry: stage('nlEntry', {
      outDir: stageDir('nl-entry'),
      summary: { entryRules: 1 },
    }),
    generateDocs: stage('docs', {
      outDir: stageDir('docs'),
      summary: { documents: 1 },
    }),
    buildGovernance: stage('governance', {
      outDir: stageDir('governance'),
      summary: { risks: 1 },
    }),
    compileKnowledgeBase: stage('knowledgeBase', {
      kbDir: stageDir('kb'),
      pages: 1,
      lintSummary: { warnings: 0, errors: 0 },
      gapGroups: [],
    }),
    generateSkill: stage('skill', {
      skillDir: stageDir('skill'),
      skillName: 'douyin',
      references: [],
      warnings: [],
    }),
  };
}

test('runPipeline preserves Douyin visible-browser defaults without adding a dedicated-ip gate', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-douyin-pipeline-defaults-'));
  const calls = [];

  try {
    const stageImpls = createSuccessfulPipelineStageImpls(workspace, calls);
    const result = await runPipeline('https://www.douyin.com/?recommend=1', {}, stageImpls);

    const captureCall = calls.find((entry) => entry.stage === 'capture');
    assert.equal(captureCall.options.headless, false);
    assert.equal(result.stages.capture.status, 'success');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('siteDoctor passes visible-browser defaults to Douyin capture and expansion when headless is not explicitly set', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-douyin-default-headless-'));
  const profilePath = path.resolve('profiles/www.douyin.com.json');
  const profile = await readJsonFile(profilePath);
  const observed = [];

  try {
    const report = await siteDoctor('https://www.douyin.com/?recommend=1', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
    }, {
      resolveSite: async () => ({ adapter: { id: 'douyin' } }),
      resolveSiteAuthProfile: async () => ({
        profile,
        warnings: [],
        filePath: profilePath,
      }),
      resolveSiteBrowserSessionOptions: async () => ({
        reuseLoginState: false,
        userDataDir: null,
        cleanupUserDataDirOnShutdown: true,
        authConfig: {
          loginUrl: 'https://www.douyin.com/',
          postLoginUrl: 'https://www.douyin.com/',
        },
      }),
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async (_inputUrl, options) => {
        observed.push({ stage: 'capture', headless: options.headless });
        return {
          status: 'success',
          finalUrl: 'https://www.douyin.com/?recommend=1',
          files: {
            manifest: path.join(workspace, 'capture', 'manifest.json'),
          },
          error: null,
        };
      },
      expandStates: async (inputUrl, options) => {
        observed.push({ stage: 'expand', inputUrl, headless: options.headless });
        return {
          outDir: path.join(workspace, 'expand'),
          summary: { capturedStates: 1 },
          warnings: [],
          states: inputUrl === 'https://www.douyin.com/?recommend=1'
            ? [
                {
                  state_id: 's0001',
                  status: 'captured',
                  finalUrl: 'https://www.douyin.com/search/%E6%B5%8B%E8%AF%95?type=video',
                  pageType: 'search-results-page',
                  trigger: { kind: 'search-form' },
                  files: {},
                },
                {
                  state_id: 's0002',
                  status: 'captured',
                  finalUrl: profile.validationSamples.videoDetailUrl,
                  pageType: 'book-detail-page',
                  trigger: { kind: 'content-link' },
                  files: {},
                },
                {
                  state_id: 's0003',
                  status: 'captured',
                  finalUrl: profile.validationSamples.authorUrl,
                  pageType: 'author-page',
                  trigger: { kind: 'safe-nav-link' },
                  files: {},
                },
              ]
            : [
                {
                  state_id: 'p0001',
                  status: 'initial',
                  finalUrl: profile.validationSamples.authorVideosUrl,
                  pageType: 'author-page',
                  pageFacts: { authorSubpage: 'post' },
                  trigger: null,
                  files: {},
                },
              ],
        };
      },
    });

    assert.equal(report.capture.status, 'pass');
    assert.ok(observed.length >= 2);
    assert.ok(observed.every((entry) => entry.headless === false));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
