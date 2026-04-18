import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { analyzeStates } from '../../analyze-states.mjs';
import { compileKnowledgeBase } from '../../compile-wiki.mjs';
import { enrichBilibiliPageFactsForState, summarizeBilibiliKnowledgeFacts } from '../../lib/bilibili-surfacing.mjs';

function rewritePaths(value, fromDir, toDir) {
  if (Array.isArray(value)) {
    return value.map((item) => rewritePaths(item, fromDir, toDir));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewritePaths(item, fromDir, toDir)]),
    );
  }
  if (typeof value === 'string' && path.isAbsolute(value) && value.startsWith(fromDir)) {
    return path.join(toDir, path.relative(fromDir, value));
  }
  return value;
}

async function prepareExplicitStageDirs(repoRoot, workspace, host) {
  const sourcesDocument = JSON.parse(
    await readFile(path.join(repoRoot, 'knowledge-base', host, 'index', 'sources.json'), 'utf8'),
  );
  const stageDirs = {};

  for (const source of sourcesDocument.activeSources) {
    const repoRawDir = path.join(repoRoot, 'knowledge-base', host, source.rawDir);
    const tempRawDir = path.join(workspace, 'stage-fixtures', source.step, source.runId);
    await cp(repoRawDir, tempRawDir, { recursive: true });

    if (source.manifestPath && source.originalDir) {
      const manifestPath = path.join(tempRawDir, path.basename(source.manifestPath));
      const manifestDocument = JSON.parse(await readFile(manifestPath, 'utf8'));
      const rewritten = rewritePaths(
        manifestDocument,
        path.resolve(source.originalDir),
        path.resolve(tempRawDir),
      );
      await writeFile(manifestPath, `${JSON.stringify(rewritten, null, 2)}\n`, 'utf8');
    }

    stageDirs[source.step] = tempRawDir;
  }

  return stageDirs;
}

test('analyzeStates preserves and enriches bilibili pageFacts in analysis output', async () => {
  const repoRoot = process.cwd();
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-bilibili-analysis-'));

  try {
    const rawDirs = await prepareExplicitStageDirs(repoRoot, workspace, 'www.bilibili.com');
    const analysis = await analyzeStates('https://www.bilibili.com/', {
      expandedStatesDir: rawDirs['step-2-expanded'],
      bookContentDir: rawDirs['step-book-content'],
      outDir: path.join(workspace, 'analysis'),
    });

    const statesDocument = JSON.parse(await readFile(analysis.files.states, 'utf8'));
    const states = statesDocument.states;
    const detailState = states.find((state) => state.semanticPageType === 'content-detail-page' && state.pageFacts?.bv);
    const searchState = states.find((state) => state.pageFacts?.searchFamily === 'all');
    const authorState = states.find((state) => state.semanticPageType === 'author-page' && state.pageFacts?.authorMid);
    const featuredState = states.find((state) => Number(state.pageFacts?.featuredContentCount ?? 0) >= 1);
    assert.ok(detailState);
    assert.match(String(detailState.pageFacts.bv ?? ''), /^BV/u);
    assert.ok(String(detailState.pageFacts.authorMid ?? '').length > 0);
    assert.ok(String(detailState.pageFacts.contentTitle ?? '').length > 0);

    assert.ok(searchState);
    assert.equal(searchState.pageFacts.queryText, 'BV1WjDDBGE3p');

    assert.ok(authorState);

    assert.ok(featuredState);
    assert.ok(Array.isArray(featuredState.pageFacts.featuredContentCards));
    assert.ok(featuredState.pageFacts.featuredContentCards.some((card) => card?.bvid));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('compileKnowledgeBase surfaces bilibili facts into wiki pages and page indexes', async () => {
  const repoRoot = process.cwd();
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-bilibili-compile-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(workspace);
    const rawDirs = await prepareExplicitStageDirs(repoRoot, workspace, 'www.bilibili.com');
    const analysis = await analyzeStates('https://www.bilibili.com/', {
      expandedStatesDir: rawDirs['step-2-expanded'],
      bookContentDir: rawDirs['step-book-content'],
      outDir: path.join(workspace, 'analysis'),
    });
    const kbDir = path.join(workspace, 'knowledge-base', 'www.bilibili.com');

    await compileKnowledgeBase('https://www.bilibili.com/', {
      kbDir,
      captureDir: rawDirs['step-1-capture'],
      expandedStatesDir: rawDirs['step-2-expanded'],
      bookContentDir: rawDirs['step-book-content'],
      analysisDir: analysis.outDir,
      abstractionDir: rawDirs['step-4-abstraction'],
      nlEntryDir: rawDirs['step-5-nl-entry'],
      docsDir: rawDirs['step-6-docs'],
      governanceDir: rawDirs['step-7-governance'],
      strict: false,
    });

    const pagesIndex = JSON.parse(await readFile(path.join(kbDir, 'index', 'pages.json'), 'utf8'));
    const overviewPage = pagesIndex.pages.find((page) => page.pageId === 'page_overview_site');
    const videoStatePage = pagesIndex.pages.find((page) => page.attributes?.bilibiliFacts?.bv);
    const authorStatePage = pagesIndex.pages.find((page) => page.attributes?.bilibiliFacts?.authorMid);
    const searchStatePage = pagesIndex.pages.find((page) => page.attributes?.bilibiliFacts?.searchFamily === 'all');
    const homeStatePage = pagesIndex.pages.find((page) => Number(page.attributes?.bilibiliFacts?.featuredContentCount ?? 0) >= 1);

    assert.ok(overviewPage.attributes.bilibiliFacts.videoCodes.includes('BV1WjDDBGE3p'));
    assert.ok(overviewPage.attributes.bilibiliFacts.authorMids.length >= 1);
    assert.ok(overviewPage.attributes.bilibiliFacts.searchFamilies.includes('all'));
    assert.equal(typeof overviewPage.attributes.bilibiliFacts.authenticatedSessionObserved, 'boolean');

    assert.match(String(videoStatePage.attributes.bilibiliFacts.bv ?? ''), /^BV/u);
    assert.ok(String(authorStatePage.attributes.bilibiliFacts.authorMid ?? '').length > 0);
    assert.equal(searchStatePage.attributes.bilibiliFacts.searchFamily, 'all');
    assert.equal(searchStatePage.attributes.bilibiliFacts.queryText, 'BV1WjDDBGE3p');
    assert.ok(Number(homeStatePage.attributes.bilibiliFacts.featuredContentCount ?? 0) >= 1);
    assert.ok(Array.isArray(homeStatePage.attributes.bilibiliFacts.featuredAuthorCards));
    const overviewMd = await readFile(path.join(kbDir, 'wiki', 'overview', 'site-overview.md'), 'utf8');
    const videoStateMd = await readFile(path.join(kbDir, videoStatePage.path), 'utf8');
    const authorStateMd = await readFile(path.join(kbDir, authorStatePage.path), 'utf8');
    const searchStateMd = await readFile(path.join(kbDir, searchStatePage.path), 'utf8');
    const homeStateMd = await readFile(path.join(kbDir, homeStatePage.path), 'utf8');

    assert.match(overviewMd, /Observed Page Facts/u);
    assert.match(overviewMd, /BV1WjDDBGE3p/u);
    assert.match(overviewMd, /all/u);
    assert.match(overviewMd, /Authenticated session active during compilation: (yes|no)/u);
    assert.match(overviewMd, /Authenticated surface summaries/u);

    assert.match(videoStateMd, /Observed Page Facts/u);
    assert.match(videoStateMd, /BV/u);
    assert.match(authorStateMd, /UP Mid/u);

    assert.match(searchStateMd, /Search Family/u);
    assert.match(searchStateMd, /BV1WjDDBGE3p/u);

    assert.match(homeStateMd, /Featured Content Cards/u);
    assert.match(homeStateMd, /Featured Author Cards/u);
    assert.match(homeStateMd, /BV/u);
  } finally {
    process.chdir(previousCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('bilibili surfacing enriches authenticated author-list facts for KB consumers', () => {
  const enriched = enrichBilibiliPageFactsForState({
    finalUrl: 'https://space.bilibili.com/1202350411/fans/follow',
    pageFacts: {
      authorSubpage: 'follow',
      loginStateDetected: true,
      featuredAuthorUrls: [
        'https://space.bilibili.com/2',
        'https://space.bilibili.com/364185321',
      ],
      featuredAuthorNames: [
        'UP 2',
        'UP 364185321',
      ],
      featuredAuthorMids: [
        '2',
        '364185321',
      ],
      featuredAuthorCards: [
        {
          name: 'UP 2',
          url: 'https://space.bilibili.com/2',
          mid: '2',
          authorSubpage: 'follow',
          cardKind: 'author',
        },
        {
          name: 'UP 364185321',
          url: 'https://space.bilibili.com/364185321',
          mid: '364185321',
          authorSubpage: 'follow',
          cardKind: 'author',
        },
      ],
      featuredContentCards: [
        {
          title: 'Video One',
          url: 'https://www.bilibili.com/video/BV1WjDDBGE3p',
          bvid: 'BV1WjDDBGE3p',
          authorMid: '2',
          contentType: 'video',
        },
      ],
    },
  });

  assert.equal(enriched.authenticatedReadOnlySurface, true);
  assert.equal(enriched.featuredAuthorCount, 2);
  assert.equal(enriched.featuredAuthors[0].mid, '2');

  const summary = summarizeBilibiliKnowledgeFacts([
    { pageFacts: enriched },
  ]);
  assert.deepEqual(summary.authenticatedSurfaceKinds, ['follow']);
  assert.equal(summary.authenticatedSessionObserved, true);
  assert.equal(summary.authenticatedSurfaceSummaries[0].authorSubpage, 'follow');
  assert.equal(summary.authenticatedSurfaceSummaries[0].featuredAuthorCount, 2);
  assert.equal(summary.authenticatedSurfaceSummaries[0].featuredContentCount, 1);
  assert.deepEqual(summary.authorMids, ['1202350411', '2', '364185321']);
  assert.equal(summary.featuredAuthors.length, 2);
  assert.equal(summary.featuredContentCards.length, 1);
});
