import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import {
  runSiteForgeBuild,
} from '../../src/app/pipeline/build/index.mjs';

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeFixtureFile(filePath, text) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, 'utf8');
}

test('empty static crawl blocks before graph, verification, registry, or draft skill', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-empty-crawl-'));
  const fixtureDir = path.join(workspace, 'empty-fixture');
  try {
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(path.join(fixtureDir, 'robots.txt'), 'User-agent: *\nAllow: /\n', 'utf8');

    let failure;
    await assert.rejects(
      async () => {
        try {
          await runSiteForgeBuild('https://empty.local/', {
            cwd: workspace,
            fixturePath: fixtureDir,
            buildId: 'empty-crawl',
            now: new Date('2026-05-16T04:00:00.000Z'),
            fetchDelayMs: 0,
          });
        } catch (error) {
          failure = error;
          throw error;
        }
      },
      /Static crawl produced no pages with evidence/u,
    );

    // @ts-ignore
    assert.equal(failure.code, 'siteforge-static-crawl-empty');
    // @ts-ignore
    const buildReport = await readJson(path.join(failure.artifactDir, 'build_report.json'));
    assert.equal(buildReport.status, 'blocked');
    assert.equal(buildReport.failedStage, 'crawlStatic');
    assert.equal(buildReport.reasonCode, 'empty-crawl');
    assert.equal(buildReport.stages.crawlStatic.status, 'blocked');
    assert.equal(buildReport.stages.crawlStatic.reasonCodes.includes('siteforge-static-crawl-empty'), true);
    assert.equal(buildReport.stages.buildSiteGraph.status, 'skipped');
    assert.equal(buildReport.stages.generateSkill.status, 'skipped');
    assert.equal(buildReport.summary.registryStatus, null);

    // @ts-ignore
    const crawlStatic = await readJson(path.join(failure.artifactDir, 'crawl_static.json'));
    assert.equal(crawlStatic.status, 'blocked');
    assert.equal(crawlStatic.summary.pages, 0);
    assert.equal(crawlStatic.summary.blockedReason, 'siteforge-static-crawl-empty');
    // @ts-ignore
    assert.equal(await pathExists(path.join(failure.artifactDir, 'graph.json')), false);
    // @ts-ignore
    assert.equal(await pathExists(path.join(failure.artifactDir, 'verification_report.json')), false);
    assert.equal(await pathExists(path.join(buildReport.workspace.buildDir, 'skill', 'skill.yaml')), false);

    const registry = await readJson(buildReport.workspace.registryPath);
    assert.deepEqual(registry.skills, []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('dynamic shell pages block with static limitation diagnostics before draft skill generation', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-dynamic-shell-'));
  const fixtureDir = path.join(workspace, 'dynamic-shell');
  try {
    await writeFixtureFile(path.join(fixtureDir, 'robots.txt'), 'User-agent: *\nAllow: /\n');
    await writeFixtureFile(path.join(fixtureDir, 'index.html'), `<!doctype html>
      <html>
        <head><title></title><script src="/assets/app.js"></script></head>
        <body>
          <div id="app"></div>
          <noscript>Please enable JavaScript to use this site.</noscript>
        </body>
      </html>`);

    let failure;
    await assert.rejects(
      async () => {
        try {
          await runSiteForgeBuild('https://dynamic.local/', {
            cwd: workspace,
            fixturePath: fixtureDir,
            buildId: 'dynamic-shell',
            now: new Date('2026-05-16T04:01:00.000Z'),
            fetchDelayMs: 0,
          });
        } catch (error) {
          failure = error;
          throw error;
        }
      },
      /Static crawl found only empty or dynamic-shell pages/u,
    );

    // @ts-ignore
    assert.equal(failure.code, 'siteforge-static-evidence-unavailable');
    // @ts-ignore
    const crawlStatic = await readJson(path.join(failure.artifactDir, 'crawl_static.json'));
    assert.equal(crawlStatic.status, 'blocked');
    assert.equal(crawlStatic.diagnostics.staticEvidence.dynamicShell, 1);
    assert.equal(crawlStatic.summary.blockedReason, 'siteforge-static-evidence-unavailable');
    assert.equal(crawlStatic.warnings.some((warning) => /browser-rendered crawl may be required/u.test(warning)), true);
    assert.equal(crawlStatic.warnings.some((warning) => /javascript-required-copy/u.test(warning)), true);

    // @ts-ignore
    const buildReport = await readJson(path.join(failure.artifactDir, 'build_report.json'));
    assert.equal(buildReport.status, 'blocked');
    assert.equal(buildReport.failedStage, 'crawlStatic');
    assert.equal(buildReport.stages.generateSkill.status, 'skipped');
    assert.equal(await pathExists(path.join(buildReport.workspace.buildDir, 'skill', 'skill.yaml')), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('fixture success remains successful with static evidence present', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-static-fixture-'));
  try {
    const result = await runSiteForgeBuild('https://fixture.local/', {
      cwd: workspace,
      buildId: 'static-fixture-success',
      now: new Date('2026-05-16T04:02:00.000Z'),
      fetchDelayMs: 0,
    });
    const crawlStatic = await readJson(path.join(result.artifactDir, 'crawl_static.json'));
    assert.equal(result.status, 'success');
    assert.equal(crawlStatic.status, 'success');
    assert.equal(crawlStatic.diagnostics.staticEvidence.present > 0, true);
    assert.equal(crawlStatic.summary.blockedReason, null);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
