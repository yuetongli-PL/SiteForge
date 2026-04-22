import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';

import { compileKnowledgeBase, lintKnowledgeBase } from '../../src/entrypoints/pipeline/compile-wiki.mjs';
import { buildExampleStageSpec, compileFixtureKnowledgeBase, createStageFixtures } from './kb-test-fixtures.mjs';
import { assertRepoMetadataUnchanged, captureRepoMetadataSnapshot } from './helpers/site-metadata-sandbox.mjs';

test('lintKnowledgeBase smoke test lints a copied knowledge base and writes reports', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-compile-wiki-'));
  const repoMetadataSnapshot = await captureRepoMetadataSnapshot();

  try {
    const fixture = await compileFixtureKnowledgeBase(workspace, buildExampleStageSpec());
    const sourceKbDir = fixture.kbDir;
    const kbDir = path.join(workspace, 'knowledge-base', 'jable.tv');
    const reportDir = path.join(workspace, 'reports');

    await cp(sourceKbDir, kbDir, { recursive: true });

    const result = await lintKnowledgeBase(kbDir, {
      reportDir,
      failOnWarnings: false,
    });

    assert.equal(typeof result.lintReport.summary.passed, 'boolean');
    assert.equal(result.lintReport.summary.errorCount, 0);
    assert.ok(result.lintReport.summary.warningCount >= 0);
    assert.ok(Array.isArray(result.gapReport.groups.missingSummaries));

    const lintReportJson = JSON.parse(await readFile(path.join(reportDir, 'lint-report.json'), 'utf8'));
    const gapReportJson = JSON.parse(await readFile(path.join(reportDir, 'gap-report.json'), 'utf8'));
    const lintReportMd = await readFile(path.join(reportDir, 'lint-report.md'), 'utf8');
    const gapReportMd = await readFile(path.join(reportDir, 'gap-report.md'), 'utf8');

    assert.equal(lintReportJson.summary.errorCount, result.lintReport.summary.errorCount);
    assert.deepEqual(Object.keys(gapReportJson.groups ?? {}), Object.keys(result.gapReport.groups ?? {}));
    assert.match(lintReportMd, /^# Lint Report/mu);
    assert.match(gapReportMd, /^# Gap Report/mu);
    await assertRepoMetadataUnchanged(repoMetadataSnapshot);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('compileKnowledgeBase builds a new knowledge base from explicit raw stage directories', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-compile-wiki-publish-'));
  const previousCwd = process.cwd();
  const repoMetadataSnapshot = await captureRepoMetadataSnapshot();

  try {
    const spec = buildExampleStageSpec();
    const rawDirs = await createStageFixtures(workspace, spec);
    process.chdir(workspace);
    const kbDir = path.join(workspace, 'knowledge-base', 'example.com');

    const result = await compileKnowledgeBase(spec.inputUrl, {
      kbDir,
      captureDir: rawDirs.captureDir,
      expandedStatesDir: rawDirs.expandedStatesDir,
      analysisDir: rawDirs.analysisDir,
      abstractionDir: rawDirs.abstractionDir,
      nlEntryDir: rawDirs.nlEntryDir,
      docsDir: rawDirs.docsDir,
      governanceDir: rawDirs.governanceDir,
      strict: false,
      siteMetadataOptions: rawDirs.metadataSandbox.siteMetadataOptions,
    });

    assert.equal(path.resolve(result.kbDir), path.resolve(kbDir));
    assert.ok(result.pages > 0);
    assert.equal(typeof result.lintSummary.errorCount, 'number');
    assert.equal(typeof result.lintSummary.warningCount, 'number');
    assert.equal(typeof result.gapGroups, 'object');

    const pagesIndex = JSON.parse(await readFile(path.join(kbDir, 'index', 'pages.json'), 'utf8'));
    const sourcesIndex = JSON.parse(await readFile(path.join(kbDir, 'index', 'sources.json'), 'utf8'));
    const readme = await readFile(path.join(kbDir, 'wiki', 'README.md'), 'utf8');
    const lintReport = JSON.parse(await readFile(path.join(kbDir, 'reports', 'lint-report.json'), 'utf8'));

    assert.ok(Array.isArray(pagesIndex.pages));
    assert.ok(pagesIndex.pages.length > 0);
    assert.ok(pagesIndex.pages.some((page) => page.pageId === 'page_readme'));
    assert.ok(pagesIndex.pages.some((page) => page.pageId.startsWith('page_state_')));
    assert.ok(pagesIndex.pages.some((page) => page.pageId.startsWith('page_intent_')));
    assert.ok(Array.isArray(sourcesIndex.activeSources));
    assert.equal(sourcesIndex.activeSources.length, 7);
    assert.match(readme, /^<!--\s*KBMETA/u);
    assert.equal(lintReport.summary.errorCount, result.lintSummary.errorCount);
    await assertRepoMetadataUnchanged(repoMetadataSnapshot);
  } finally {
    process.chdir(previousCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});
