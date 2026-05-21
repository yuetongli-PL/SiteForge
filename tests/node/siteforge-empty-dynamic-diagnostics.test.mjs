import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';

import {
  runSiteForgeBuild,
} from '../../src/app/pipeline/build/index.mjs';
import {
  simpleShopRoutes,
  testRobotsTxt,
  withTestSite,
} from './helpers/test-site-server.mjs';

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

test('empty static crawl blocks before graph, verification, registry, or draft skill', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-empty-crawl-'));
  try {
    let failure;
    await withTestSite((rootUrl) => ({
      '/robots.txt': testRobotsTxt(rootUrl),
      '/': '<!doctype html><html><head><title></title></head><body></body></html>',
    }), async (rootUrl) => {
      await assert.rejects(
        async () => {
          try {
            await runSiteForgeBuild(rootUrl, {
              cwd: workspace,
              buildId: 'empty-crawl',
              now: new Date('2026-05-16T04:00:00.000Z'),
              fetchDelayMs: 0,
            });
          } catch (error) {
            failure = error;
            throw error;
          }
        },
        /Static crawl found only empty or dynamic-shell pages/u,
      );
    });

    // @ts-ignore
    assert.equal(failure.code, 'siteforge-static-evidence-unavailable');
    // @ts-ignore
    const buildReport = await readJson(path.join(failure.artifactDir, 'build_report.json'));
    assert.equal(buildReport.status, 'blocked');
    assert.equal(buildReport.failedStage, 'crawlStatic');
    assert.equal(buildReport.reasonCode, 'dynamic-unsupported');
    assert.equal(buildReport.stages.crawlStatic.status, 'blocked');
    assert.equal(buildReport.stages.crawlStatic.reasonCodes.includes('siteforge-static-evidence-unavailable'), true);
    assert.equal(buildReport.stages.buildSiteGraph.status, 'skipped');
    assert.equal(buildReport.stages.generateSkill.status, 'skipped');
    assert.equal(buildReport.summary.registryStatus, null);

    // @ts-ignore
    const crawlStatic = await readJson(path.join(failure.artifactDir, 'crawl_static.json'));
    assert.equal(crawlStatic.status, 'blocked');
    assert.equal(crawlStatic.summary.pages, 1);
    assert.equal(crawlStatic.summary.blockedReason, 'siteforge-static-evidence-unavailable');
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
  try {
    let failure;
    await withTestSite((rootUrl) => ({
      '/robots.txt': testRobotsTxt(rootUrl),
      '/': `<!doctype html>
        <html>
          <head><title></title><script src="/assets/app.js"></script></head>
          <body>
            <div id="app"></div>
            <noscript>Please enable JavaScript to use this site.</noscript>
          </body>
        </html>`,
      '/assets/app.js': 'document.querySelector("#app").textContent = "loaded";',
    }), async (rootUrl) => {
      await assert.rejects(
        async () => {
          try {
            await runSiteForgeBuild(rootUrl, {
              cwd: workspace,
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
    });

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

test('local HTTP site success remains successful with static evidence present', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-static-site-'));
  try {
    await withTestSite(simpleShopRoutes, async (rootUrl) => {
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'static-site-success',
        now: new Date('2026-05-16T04:02:00.000Z'),
        fetchDelayMs: 0,
      });
      const crawlStatic = await readJson(path.join(result.artifactDir, 'crawl_static.json'));
      assert.equal(result.status, 'success');
      assert.equal(crawlStatic.status, 'success');
      assert.equal(crawlStatic.diagnostics.staticEvidence.present > 0, true);
      assert.equal(crawlStatic.summary.blockedReason, null);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
