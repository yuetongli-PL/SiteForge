import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { compileKnowledgeBase, lintKnowledgeBase } from '../../src/entrypoints/pipeline/compile-wiki.mjs';

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

test('lintKnowledgeBase smoke test lints a copied knowledge base and writes reports', async () => {
  const repoRoot = process.cwd();
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-compile-wiki-'));

  try {
    const sourceKbDir = path.join(repoRoot, 'knowledge-base', 'jable.tv');
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
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('compileKnowledgeBase builds a new knowledge base from explicit raw stage directories', async () => {
  const repoRoot = process.cwd();
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-compile-wiki-publish-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(workspace);
    const rawDirs = await prepareExplicitStageDirs(repoRoot, workspace, 'jable.tv');
    const kbDir = path.join(workspace, 'knowledge-base', 'jable.tv');

    const result = await compileKnowledgeBase('https://jable.tv/', {
      kbDir,
      captureDir: rawDirs['step-1-capture'],
      expandedStatesDir: rawDirs['step-2-expanded'],
      analysisDir: rawDirs['step-3-analysis'],
      abstractionDir: rawDirs['step-4-abstraction'],
      nlEntryDir: rawDirs['step-5-nl-entry'],
      docsDir: rawDirs['step-6-docs'],
      governanceDir: rawDirs['step-7-governance'],
      strict: false,
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
    assert.ok(sourcesIndex.activeSources.length >= 7);
    assert.match(readme, /^<!--\s*KBMETA/u);
    assert.equal(lintReport.summary.errorCount, result.lintSummary.errorCount);
  } finally {
    process.chdir(previousCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});
