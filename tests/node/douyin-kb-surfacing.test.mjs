import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { analyzeStates } from '../../src/entrypoints/pipeline/analyze-states.mjs';
import { compileKnowledgeBase } from '../../src/entrypoints/pipeline/compile-wiki.mjs';

const DOUYIN_BASE_URL = 'https://www.douyin.com/';
const CAPTURED_AT = '2026-04-18T00:00:00.000Z';

function createMinimalSnapshot() {
  return {
    strings: ['#document', 'HTML', 'BODY', ''],
    documents: [
      {
        nodes: {
          nodeName: [0, 1, 2],
          nodeValue: [3, 3, 3],
          parentIndex: [-1, 0, 1],
          attributes: [[], [], []],
        },
      },
    ],
  };
}

function createDouyinPageFacts() {
  return {
    authorSubpage: 'like',
    featuredContentCount: 12,
    featuredContentComplete: true,
    featuredContentCards: [
      { title: 'Video 1', url: 'https://www.douyin.com/video/1', contentType: 'video' },
      { title: 'Video 2', url: 'https://www.douyin.com/video/2', contentType: 'video' },
      { title: 'Video 3', url: 'https://www.douyin.com/video/3', contentType: 'video' },
      { title: 'Video 4', url: 'https://www.douyin.com/video/4', contentType: 'video' },
      { title: 'Video 5', url: 'https://www.douyin.com/video/5', contentType: 'video' },
      { title: 'Video 6', url: 'https://www.douyin.com/video/6', contentType: 'video' },
    ],
    featuredAuthorCount: 4,
    featuredAuthorComplete: false,
    featuredAuthorCards: [
      { name: 'Author A', url: 'https://www.douyin.com/user/a', authorSubpage: 'follow-users' },
      { name: 'Author B', url: 'https://www.douyin.com/user/b', authorSubpage: 'follow-users' },
    ],
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function createExpandedStatesFixture(rootDir, pageFacts = createDouyinPageFacts()) {
  const expandedDir = path.join(rootDir, 'expanded-states');
  const stateDir = path.join(expandedDir, 'state_self_like');
  await mkdir(stateDir, { recursive: true });

  const htmlPath = path.join(stateDir, 'page.html');
  const snapshotPath = path.join(stateDir, 'dom-snapshot.json');
  const screenshotPath = path.join(stateDir, 'screenshot.png');
  const manifestPath = path.join(stateDir, 'manifest.json');

  await writeFile(htmlPath, '<!doctype html><html><body><main>douyin</main></body></html>', 'utf8');
  await writeJson(snapshotPath, createMinimalSnapshot());
  await writeFile(screenshotPath, '');
  await writeJson(manifestPath, {
    state_id: 'state_self_like',
    final_url: 'https://www.douyin.com/user/self?showTab=like',
    title: 'My Likes - Douyin',
    captured_at: CAPTURED_AT,
    status: 'captured',
    page_facts: pageFacts,
    files: {
      html: 'page.html',
      snapshot: 'dom-snapshot.json',
      screenshot: 'screenshot.png',
      manifest: 'manifest.json',
    },
  });

  await writeJson(path.join(expandedDir, 'states-manifest.json'), {
    inputUrl: `${DOUYIN_BASE_URL}?recommend=1`,
    baseUrl: DOUYIN_BASE_URL,
    generatedAt: CAPTURED_AT,
    states: [
      {
        state_id: 'state_self_like',
        final_url: 'https://www.douyin.com/user/self?showTab=like',
        title: 'My Likes - Douyin',
        captured_at: CAPTURED_AT,
        status: 'captured',
        page_facts: pageFacts,
        files: {
          html: 'state_self_like/page.html',
          snapshot: 'state_self_like/dom-snapshot.json',
          screenshot: 'state_self_like/screenshot.png',
          manifest: 'state_self_like/manifest.json',
        },
      },
    ],
  });

  return expandedDir;
}

async function createCaptureFixture(rootDir) {
  const captureDir = path.join(rootDir, 'capture');
  await mkdir(captureDir, { recursive: true });
  await writeFile(path.join(captureDir, 'page.html'), '<!doctype html><html><body>home</body></html>', 'utf8');
  await writeJson(path.join(captureDir, 'dom-snapshot.json'), createMinimalSnapshot());
  await writeFile(path.join(captureDir, 'screenshot.png'), '');
  await writeJson(path.join(captureDir, 'manifest.json'), {
    inputUrl: `${DOUYIN_BASE_URL}?recommend=1`,
    finalUrl: `${DOUYIN_BASE_URL}?recommend=1`,
    capturedAt: CAPTURED_AT,
    files: {
      html: 'page.html',
      snapshot: 'dom-snapshot.json',
      screenshot: 'screenshot.png',
    },
  });
  return captureDir;
}

async function createAnalysisFixture(rootDir, analysisOutputDir) {
  return analysisOutputDir;
}

async function createAbstractionFixture(rootDir) {
  const abstractionDir = path.join(rootDir, 'abstraction');
  await mkdir(abstractionDir, { recursive: true });
  await writeJson(path.join(abstractionDir, 'intents.json'), {
    inputUrl: DOUYIN_BASE_URL,
    baseUrl: DOUYIN_BASE_URL,
    generatedAt: CAPTURED_AT,
    intents: [],
  });
  await writeJson(path.join(abstractionDir, 'actions.json'), {
    inputUrl: DOUYIN_BASE_URL,
    baseUrl: DOUYIN_BASE_URL,
    generatedAt: CAPTURED_AT,
    actions: [],
  });
  await writeJson(path.join(abstractionDir, 'decision-table.json'), {
    inputUrl: DOUYIN_BASE_URL,
    baseUrl: DOUYIN_BASE_URL,
    generatedAt: CAPTURED_AT,
    rules: [],
  });
  await writeJson(path.join(abstractionDir, 'abstraction-manifest.json'), {
    inputUrl: DOUYIN_BASE_URL,
    baseUrl: DOUYIN_BASE_URL,
    generatedAt: CAPTURED_AT,
    files: {
      intents: 'intents.json',
      actions: 'actions.json',
      decisionTable: 'decision-table.json',
      manifest: 'abstraction-manifest.json',
    },
  });
  return abstractionDir;
}

async function createNlEntryFixture(rootDir) {
  const nlDir = path.join(rootDir, 'nl-entry');
  await mkdir(nlDir, { recursive: true });
  await writeJson(path.join(nlDir, 'alias-lexicon.json'), { entries: [] });
  await writeJson(path.join(nlDir, 'slot-schema.json'), { intents: [] });
  await writeJson(path.join(nlDir, 'utterance-patterns.json'), { patterns: [] });
  await writeJson(path.join(nlDir, 'entry-rules.json'), { rules: [] });
  await writeJson(path.join(nlDir, 'clarification-rules.json'), { rules: [] });
  await writeJson(path.join(nlDir, 'nl-entry-manifest.json'), {
    inputUrl: DOUYIN_BASE_URL,
    baseUrl: DOUYIN_BASE_URL,
    generatedAt: CAPTURED_AT,
    files: {
      aliasLexicon: 'alias-lexicon.json',
      slotSchema: 'slot-schema.json',
      utterancePatterns: 'utterance-patterns.json',
      entryRules: 'entry-rules.json',
      clarificationRules: 'clarification-rules.json',
      manifest: 'nl-entry-manifest.json',
    },
  });
  return nlDir;
}

async function createDocsFixture(rootDir) {
  const docsDir = path.join(rootDir, 'docs');
  await mkdir(docsDir, { recursive: true });
  const documents = [
    { key: 'readme', file: 'README.md', title: 'README' },
    { key: 'glossary', file: 'glossary.md', title: 'Glossary' },
    { key: 'stateMap', file: 'state-map.md', title: 'State Map' },
    { key: 'actions', file: 'actions.md', title: 'Actions' },
    { key: 'recovery', file: 'recovery.md', title: 'Recovery' },
  ];
  for (const document of documents) {
    await writeFile(path.join(docsDir, document.file), `# ${document.title}\n`, 'utf8');
  }
  await writeJson(path.join(docsDir, 'docs-manifest.json'), {
    inputUrl: DOUYIN_BASE_URL,
    baseUrl: DOUYIN_BASE_URL,
    generatedAt: CAPTURED_AT,
    files: {
      readme: 'README.md',
      glossary: 'glossary.md',
      stateMap: 'state-map.md',
      actions: 'actions.md',
      recovery: 'recovery.md',
      manifest: 'docs-manifest.json',
    },
    documents: documents.map((document) => ({
      title: document.title,
      path: document.file,
    })),
  });
  return docsDir;
}

async function createGovernanceFixture(rootDir) {
  const governanceDir = path.join(rootDir, 'governance');
  await mkdir(governanceDir, { recursive: true });
  await writeJson(path.join(governanceDir, 'risk-taxonomy.json'), { generatedAt: CAPTURED_AT, categories: [] });
  await writeJson(path.join(governanceDir, 'approval-rules.json'), { generatedAt: CAPTURED_AT, rules: [] });
  await writeJson(path.join(governanceDir, 'recovery-rules.json'), { generatedAt: CAPTURED_AT, rules: [] });
  await writeFile(path.join(governanceDir, 'recovery.md'), '# Recovery\n', 'utf8');
  await writeFile(path.join(governanceDir, 'approval-checkpoints.md'), '# Approval\n', 'utf8');
  return governanceDir;
}

test('analyzeStates surfaces Douyin featured completeness and counts without expanding summaries', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-douyin-analysis-'));

  try {
    const expandedStatesDir = await createExpandedStatesFixture(workspace);
    const analysis = await analyzeStates(`${DOUYIN_BASE_URL}?recommend=1`, {
      expandedStatesDir,
      outDir: path.join(workspace, 'analysis'),
    });
    const statesDocument = JSON.parse(await readFile(analysis.files.states, 'utf8'));
    const state = statesDocument.states.find((entry) => entry.stateId === 'state_self_like');

    assert.ok(state);
    assert.equal(state.pageFactHighlights.featuredContentCardCount, 12);
    assert.equal(state.pageFactHighlights.featuredContentComplete, true);
    assert.equal(state.pageFactHighlights.featuredAuthorCount, 4);
    assert.equal(state.pageFactHighlights.featuredAuthorComplete, false);
    assert.equal(state.pageFactHighlights.featuredContentCards.length, 3);
    assert.equal(state.pageFactHighlights.featuredAuthorCards.length, 2);
    assert.equal(state.pageFactHighlights.featuredContentCards.at(-1).title, 'Video 3');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('compileKnowledgeBase renders Douyin featured completeness and counts in overview and state wiki pages', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-douyin-compile-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(workspace);
    const expandedStatesDir = await createExpandedStatesFixture(workspace);
    const analysis = await analyzeStates(`${DOUYIN_BASE_URL}?recommend=1`, {
      expandedStatesDir,
      outDir: path.join(workspace, 'analysis'),
    });
    const captureDir = await createCaptureFixture(workspace);
    const analysisDir = await createAnalysisFixture(workspace, analysis.outDir);
    const abstractionDir = await createAbstractionFixture(workspace);
    const nlEntryDir = await createNlEntryFixture(workspace);
    const docsDir = await createDocsFixture(workspace);
    const governanceDir = await createGovernanceFixture(workspace);
    const kbDir = path.join(workspace, 'knowledge-base', 'www.douyin.com');

    await compileKnowledgeBase(`${DOUYIN_BASE_URL}?recommend=1`, {
      kbDir,
      captureDir,
      expandedStatesDir,
      analysisDir,
      abstractionDir,
      nlEntryDir,
      docsDir,
      governanceDir,
      strict: false,
    });

    const pagesIndex = JSON.parse(await readFile(path.join(kbDir, 'index', 'pages.json'), 'utf8'));
    const statePage = pagesIndex.pages.find((page) => page.kind === 'state' && page.attributes?.stateId === 'state_self_like');
    assert.ok(statePage);

    const overviewMd = await readFile(path.join(kbDir, 'wiki', 'overview', 'site-overview.md'), 'utf8');
    const stateMd = await readFile(path.join(kbDir, statePage.path), 'utf8');

    assert.match(overviewMd, /Featured Cards/u);
    assert.match(overviewMd, /Featured Authors/u);
    assert.match(overviewMd, /Complete/u);
    assert.match(overviewMd, /\| 12 \| yes \|/u);
    assert.match(overviewMd, /\| 4 \| no \|/u);
    assert.match(overviewMd, /\| \[state_self_like My Likes - Douyin\]\([^)]+\) \| Video 1 \(video\); Video 2 \(video\); Video 3 \(video\) \| 12 \| yes \|/u);

    assert.match(stateMd, /Featured Content Count/u);
    assert.match(stateMd, /Featured Content Complete/u);
    assert.match(stateMd, /Featured Author Count/u);
    assert.match(stateMd, /Featured Author Complete/u);
    assert.match(stateMd, /\| Featured Content Count \| 12 \|/u);
    assert.match(stateMd, /\| Featured Content Complete \| yes \|/u);
    assert.match(stateMd, /\| Featured Author Count \| 4 \|/u);
    assert.match(stateMd, /\| Featured Author Complete \| no \|/u);
    assert.match(stateMd, /Video 1/u);
    assert.match(stateMd, /\| Video 1 \| video \| - \| - \|[\s\S]*\| Video 2 \| video \| - \| - \|[\s\S]*\| Video 3 \| video \| - \| - \|/u);
  } finally {
    process.chdir(previousCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});
