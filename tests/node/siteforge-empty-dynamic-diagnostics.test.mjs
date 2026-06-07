import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import {
  runSiteForgeBuild,
} from '../../src/app/pipeline/build/index.mjs';
import {
  prepareSiteForgeBuildSetup,
} from '../../src/app/pipeline/build/setup-assistant.mjs';
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

function fineGrainedNavigationCapabilityNames(capabilities = /** @type {any[]} */ ([])) {
  return capabilities
    .filter((capability) => (
      capability.status === 'active'
      && /^(?:open .* element |open public route )/u.test(String(capability.name ?? ''))
    ))
    .map((capability) => capability.name);
}

function qidianLikeKnownPolicy() {
  return {
    siteKey: 'qidian',
    adapterId: 'chapter-content',
    siteArchetype: 'chapter-content',
    primaryArchetype: 'chapter-content',
    pageTypes: ['home', 'category-page', 'book-detail-page', 'chapter-page', 'search-results-page'],
    capabilityFamilies: ['navigate-to-category', 'navigate-to-chapter', 'navigate-to-content', 'search-content'],
    supportedIntents: ['open-book', 'open-category', 'open-chapter', 'search-book'],
    publicRouteTemplates: [
      { id: 'category-all', path: '/all/', pageType: 'category-page', capabilityFamilies: ['navigate-to-category'], seedable: true },
      { id: 'rank', path: '/rank/', pageType: 'category-page', capabilityFamilies: ['navigate-to-category'], seedable: true },
      { id: 'search', path: '/soushu/', pageType: 'search-results-page', capabilityFamilies: ['search-content'], seedable: true },
      { id: 'book-detail-template', pathTemplate: '/book/{bookId}/', pageType: 'book-detail-page', capabilityFamilies: ['navigate-to-content'], seedable: false },
      { id: 'chapter-template', pathTemplate: '/chapter/{bookId}/{chapterId}/', pageType: 'chapter-page', capabilityFamilies: ['navigate-to-chapter'], seedable: false },
    ],
  };
}

function qidianLikeDownloadKnownPolicy() {
  return {
    ...qidianLikeKnownPolicy(),
    siteKey: 'books',
    capabilityFamilies: [
      'download-content',
      'navigate-to-category',
      'navigate-to-chapter',
      'navigate-to-content',
      'search-content',
    ],
    supportedIntents: [
      'download-book',
      'open-book',
      'open-category',
      'open-chapter',
      'search-book',
    ],
    downloadEntrypoint: 'src/sites/known-sites/chapter-content/download/python/book.py',
    downloadSessionRequirement: 'none',
    downloadTaskTypes: ['book'],
    scriptLanguage: 'python',
    interpreterRequired: 'pypy3',
    downloadSupport: {
      status: 'implemented',
      supported: true,
      taskTypes: ['book'],
      availableTaskTypes: ['book'],
      blockedTaskTypes: [],
    },
  };
}

function qidianLikeDynamicRoutes(rootUrl) {
  const shell = '<!doctype html><html><head><title></title><script src="/assets/app.js"></script></head><body><div id="app"></div><noscript>Please enable JavaScript.</noscript></body></html>';
  return {
    '/robots.txt': testRobotsTxt(rootUrl),
    '/sitemap.xml': {
      contentType: 'application/xml; charset=utf-8',
      body: '<urlset></urlset>',
    },
    '/': shell,
    '/all/': shell,
    '/rank/': shell,
    '/soushu/': shell,
    '/book/123/': shell,
    '/chapter/123/1/': shell,
    '/assets/app.js': 'window.__siteforge_dynamic_shell = true;',
  };
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
              renderJs: false,
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

test('dynamic shell pages can be completed by sanitized public rendered structure evidence', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-public-rendered-'));
  try {
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
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'public-rendered-provider',
        now: new Date('2026-05-16T04:03:00.000Z'),
        fetchDelayMs: 0,
        publicRenderedStructureProvider: async () => ({
          publicRenderedPages: [{
            url: rootUrl,
            pageType: 'home',
            title: 'Rendered public home',
            listPresent: true,
            visibleItemCount: 8,
            emptyStatePresent: false,
            links: [{ href: new URL('/books/1?token=synthetic-secret', rootUrl).toString(), label: 'sid=SECRET_RENDER_SESSION' }],
            forms: [{
              label: 'Authorization: Bearer synthetic-secret',
              method: 'GET',
              action: new URL('/search?uid=123', rootUrl).toString(),
              inputs: [{ name: 'uid=123', type: 'search', label: '<script>alert(1)</script>' }],
            }],
            controls: [{ kind: 'button', label: '<html>raw DOM</html>', selector: 'button:nth-of-type(1)' }],
          }],
        }),
      });

      assert.equal(result.status, 'success');
      const crawlStatic = await readJson(path.join(result.artifactDir, 'crawl_static.json'));
      assert.equal(crawlStatic.summary.staticBlockedReason, 'siteforge-static-evidence-unavailable');
      assert.equal(crawlStatic.summary.renderedEvidenceRequired, true);

      const crawlRendered = await readJson(path.join(result.artifactDir, 'crawl_rendered.json'));
      assert.equal(crawlRendered.status, 'success');
      assert.equal(crawlRendered.publicRenderedPages.length, 1);
      assert.equal(crawlRendered.publicRenderedPages[0].sourceLayer, 'public_rendered');
      assert.equal(crawlRendered.publicRenderedPages[0].authRequired, false);
      assert.equal(crawlRendered.publicRenderedPages[0].textSummary.includes('no page body persisted'), true);
      const renderedText = JSON.stringify(crawlRendered);
      assert.equal(renderedText.includes('SECRET_RENDER_SESSION'), false);
      assert.equal(renderedText.includes('synthetic-secret'), false);
      assert.equal(renderedText.includes('sid='), false);
      assert.equal(renderedText.includes('uid=123'), false);
      assert.equal(renderedText.includes('<script'), false);
      assert.equal(renderedText.includes('<html>'), false);

      const graph = await readJson(path.join(result.artifactDir, 'graph.json'));
      assert.equal(graph.summary.bySourceLayer.public_rendered > 0, true);
      assert.equal(graph.nodes.some((node) => node.sourceLayer === 'public_rendered' && node.authRequired === false), true);

      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      const homepage = capabilities.capabilities.find((capability) => capability.name === 'view homepage');
      assert.ok(homepage);
      assert.equal(homepage.status, 'active');
      assert.equal(homepage.sourceLayer, 'public_rendered');
      assert.equal(homepage.evidenceMatrix.observedEvidence.includes('public_rendered_structure_present'), true);
      assert.deepEqual(homepage.evidenceMatrix.missingEvidence, []);

      const report = await readJson(path.join(result.artifactDir, 'build_report.json'));
      assert.equal(report.summary.coverage.publicRendered.pages, 1);
      assert.equal(report.summary.coverage.publicRendered.nodes > 0, true);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('known public route policies can recover setup synthetic fallback with rendered evidence', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-public-rendered-setup-recovery-'));
  try {
    await withTestSite((rootUrl) => ({
      '/robots.txt': {
        contentType: 'text/plain; charset=utf-8',
        body: testRobotsTxt(rootUrl, { sitemap: false }),
      },
    }), async (rootUrl) => {
      await mkdir(path.join(workspace, 'config'), { recursive: true });
      const registry = {
        sites: {
          '127.0.0.1': {
            canonicalBaseUrl: rootUrl,
            host: '127.0.0.1',
            siteKey: 'rendered-recovery',
            adapterId: 'rendered-recovery',
            siteArchetype: 'catalog-detail',
            downloadTaskTypes: ['video', 'media-bundle'],
            blockedDownloadTaskTypes: ['video', 'media-bundle'],
            downloadSupport: {
              status: 'blocked',
              supported: false,
              taskTypes: ['video', 'media-bundle'],
              availableTaskTypes: [],
              blockedTaskTypes: ['video', 'media-bundle'],
              reasonCode: 'native-resolver-required',
            },
          },
        },
      };
      const capabilities = {
        sites: {
          '127.0.0.1': {
            baseUrl: rootUrl,
            host: '127.0.0.1',
            siteKey: 'rendered-recovery',
            adapterId: 'rendered-recovery',
            primaryArchetype: 'catalog-detail',
            capabilityFamilies: ['download-content', 'navigate-to-category', 'navigate-to-content', 'search-content'],
            supportedIntents: ['download-video', 'open-category', 'open-video', 'search-video'],
            safeActionKinds: ['navigate'],
            downloader: {
              status: 'blocked',
              supported: false,
              taskTypes: ['video', 'media-bundle'],
              availableTaskTypes: [],
              blockedTaskTypes: ['video', 'media-bundle'],
              reasonCode: 'native-resolver-required',
            },
            publicRouteTemplates: [
              { id: 'home', path: '/', pageType: 'home', capabilityFamilies: ['navigate-to-category'], seedable: true },
              { id: 'latest', path: '/latest/', pageType: 'category-page', capabilityFamilies: ['navigate-to-category'], seedable: true },
              { id: 'detail-template', pathTemplate: '/videos/{videoId}/', pageType: 'book-detail-page', capabilityFamilies: ['navigate-to-content'], seedable: false },
            ],
          },
        },
      };
      await writeFile(path.join(workspace, 'config', 'site-registry.json'), `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
      await writeFile(path.join(workspace, 'config', 'site-capabilities.json'), `${JSON.stringify(capabilities, null, 2)}\n`, 'utf8');

      const setup = await prepareSiteForgeBuildSetup(rootUrl, {
        cwd: workspace,
        buildId: 'public-rendered-setup-recovery',
        now: new Date('2026-05-16T04:04:00.000Z'),
        fetchDelayMs: 0,
        renderJs: true,
      });
      assert.equal(setup.setupPlan.buildReadiness.reasonCode, 'setup-public-rendered-recovery-pending');
      assert.equal(setup.setupPlan.evidenceQuality.publicRenderedRecoveryCandidate, true);

      const result = await runSiteForgeBuild(rootUrl, {
        ...setup.buildOptions,
        cwd: workspace,
        buildId: 'public-rendered-setup-recovery',
        now: new Date('2026-05-16T04:04:00.000Z'),
        fetchDelayMs: 0,
        renderJs: true,
        publicRenderedStructureProvider: async () => ({
          publicRenderedPages: [{
            url: rootUrl,
            pageType: 'home',
            title: 'Rendered recovery home',
            listPresent: true,
            visibleItemCount: 12,
            emptyStatePresent: false,
            links: [
              { href: new URL('/latest/', rootUrl).toString(), label: 'Latest', semanticKind: 'ranking', routeTemplate: '/latest' },
              { href: new URL('/videos/sample/', rootUrl).toString(), label: 'Sample public item', semanticKind: 'media', routeTemplate: '/videos/:id' },
            ],
            forms: [{
              label: 'Search',
              method: 'GET',
              action: new URL('/search', rootUrl).toString(),
              inputs: [{ name: 'q', type: 'search', label: 'keyword' }],
            }],
            structureItems: [
              { nodeType: 'content', structureType: 'ranking_link_group', visibleItemCount: 1, listPresent: true, routeTemplates: ['/latest'] },
              { nodeType: 'content', structureType: 'media_link_group', visibleItemCount: 1, listPresent: true, routeTemplates: ['/videos/:id'] },
              { nodeType: 'operation', structureType: 'search_route_group', visibleItemCount: 1, listPresent: true, routeTemplates: ['/search'] },
            ],
          }],
        }),
      });

      assert.equal(result.status, 'success');
      const buildReport = await readJson(path.join(result.artifactDir, 'build_report.json'));
      assert.equal(buildReport.setupProfile.buildReadiness.reasonCode, 'setup-public-rendered-recovery-pending');
      assert.equal(buildReport.setupProfile.evidenceQuality.publicRenderedRecoveryCandidate, true);

      const crawlStatic = await readJson(path.join(result.artifactDir, 'crawl_static.json'));
      assert.equal(crawlStatic.summary.staticBlockedReason, 'siteforge-static-crawl-empty');
      assert.equal(crawlStatic.summary.renderedEvidenceRequired, true);
      assert.equal(crawlStatic.status, 'skipped');

      const crawlRendered = await readJson(path.join(result.artifactDir, 'crawl_rendered.json'));
      assert.equal(crawlRendered.status, 'success');
      assert.equal(crawlRendered.publicRenderedPages.length, 1);

      const capabilitiesResult = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      assert.equal(capabilitiesResult.capabilities.some((capability) => capability.status === 'active'), true);
      assert.deepEqual(
        fineGrainedNavigationCapabilityNames(capabilitiesResult.capabilities),
        [],
        'known catalog policies with rendered structure should use aggregate capabilities instead of per-route capabilities',
      );
      assert.equal(
        capabilitiesResult.capabilities.some((capability) => capability.name === 'download catalog content' && capability.status === 'active'),
        false,
        'blocked known-site download policy must not activate catalog download capability',
      );
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('qidian-like dynamic public site maps rendered book structures to chapter-content capabilities', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-qidian-like-rendered-'));
  try {
    await withTestSite(qidianLikeDynamicRoutes, async (rootUrl) => {
      const url = (route) => new URL(route, rootUrl).toString();
      const sensitiveValue = 'synthetic-sensitive-qidian-value';
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'qidian-like-rendered',
        now: new Date('2026-05-16T04:05:00.000Z'),
        fetchDelayMs: 0,
        setupProfile: {
          knownSitePolicy: qidianLikeKnownPolicy(),
        },
        publicRenderedStructureProvider: async () => ({
          publicRenderedPages: [
            {
              url: rootUrl,
              pageType: 'home',
              title: `<script>sid=${sensitiveValue}</script>`,
              structureHash: `Authorization: Bearer ${sensitiveValue}`,
              listPresent: true,
              visibleItemCount: 6,
              routeTemplates: ['/all/', '/rank/', '/book/:id/'],
              links: [{
                href: `${url('/book/123/')}?token=${sensitiveValue}`,
                label: `sid=${sensitiveValue}`,
              }],
              controls: [{
                kind: 'button',
                label: `localStorage ${sensitiveValue}`,
                selector: 'button:nth-of-type(1)',
              }],
              structureItems: [
                { structureType: 'book_category_list', visibleItemCount: 3, listPresent: true, routeTemplates: ['/all/', '/rank/'] },
                { structureType: 'book_card', visibleItemCount: 6, listPresent: true, routeTemplates: ['/book/:id/'] },
              ],
            },
            {
              url: url('/all/'),
              pageType: 'category-page',
              routeTemplate: '/all/',
              listPresent: true,
              visibleItemCount: 12,
              routeTemplates: ['/book/:id/'],
              structureItems: [{ structureType: 'book_card', visibleItemCount: 12, listPresent: true, routeTemplates: ['/book/:id/'] }],
            },
            {
              url: url('/rank/'),
              pageType: 'category-page',
              routeTemplate: '/rank/',
              listPresent: true,
              visibleItemCount: 10,
              routeTemplates: ['/book/:id/'],
              structureItems: [{ structureType: 'ranking_entry', visibleItemCount: 10, listPresent: true, routeTemplates: ['/book/:id/'] }],
            },
            {
              url: url('/soushu/'),
              pageType: 'search-results-page',
              routeTemplate: '/soushu/',
              listPresent: true,
              visibleItemCount: 4,
              forms: [{
                label: `public-rendered-search-form uid=123 ${sensitiveValue}`,
                method: 'GET',
                action: url('/soushu/'),
                inputs: [{ name: `q token=${sensitiveValue}`, type: 'search', label: 'public-rendered-query' }],
              }],
              structureItems: [{ nodeType: 'operation', structureType: 'book_search_form', visibleItemCount: 0, listPresent: false, formCount: 1 }],
            },
            {
              url: url('/book/123/'),
              pageType: 'book-detail-page',
              routeTemplate: '/book/:id/',
              listPresent: true,
              visibleItemCount: 5,
              routeTemplates: ['/chapter/:id/:id/'],
              structureItems: [{ structureType: 'chapter_link', visibleItemCount: 5, listPresent: true, routeTemplates: ['/chapter/:id/:id/'] }],
            },
            {
              url: url('/chapter/123/1/'),
              pageType: 'chapter-page',
              routeTemplate: '/chapter/:id/:id/',
              listPresent: false,
              visibleItemCount: 1,
              structureItems: [{ structureType: 'chapter_link', visibleItemCount: 1, listPresent: false, routeTemplates: ['/chapter/:id/:id/'] }],
            },
          ],
        }),
      });

      assert.equal(result.status, 'success');
      const seeds = await readJson(path.join(result.artifactDir, 'seeds.json'));
      const seedUrls = new Set(seeds.publicSeeds.map((seed) => new URL(seed.normalizedUrl).pathname));
      assert.equal(seedUrls.has('/all/'), true);
      assert.equal(seedUrls.has('/rank/'), true);
      assert.equal(seedUrls.has('/soushu/'), true);

      const graph = await readJson(path.join(result.artifactDir, 'classified_graph.json'));
      const classifications = new Set(graph.nodes.map((node) => node.classification).filter(Boolean));
      for (const expected of ['book_category_list', 'book_ranking_list', 'book_search_results', 'book_detail', 'chapter_detail']) {
        assert.equal(classifications.has(expected), true, `${expected} should be classified from qidian-like rendered structure`);
      }

      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      const activeNames = new Set(capabilities.capabilities.filter((capability) => capability.status === 'active').map((capability) => capability.name));
      for (const expected of [
        'browse book categories',
        'browse book rankings',
        'browse book collections',
        'open book detail',
        'open chapter',
        'search books',
      ]) {
        assert.equal(activeNames.has(expected), true, `${expected} should be active for qidian-like public rendered structure`);
      }
      for (const unexpected of ['search posts', 'read timeline post summaries', 'read recommended timeline', 'list direct messages']) {
        assert.equal(activeNames.has(unexpected), false, `${unexpected} must not be active on chapter-content sites`);
      }
      assert.deepEqual(
        fineGrainedNavigationCapabilityNames(capabilities.capabilities),
        [],
        'chapter-content sites should use aggregate navigation capabilities instead of per-element or per-route capabilities',
      );
      const searchBooks = capabilities.capabilities.find((capability) => capability.name === 'search books');
      assert.equal(searchBooks?.evidenceMatrix?.observedEvidence.includes('public_rendered_structure_present'), true);
      assert.deepEqual(searchBooks?.evidenceMatrix?.missingEvidence, []);
      assert.equal(searchBooks?.userValue, '按关键词搜索公开图书或小说。');
      assert.equal(searchBooks?.intents?.some((intent) => intent.canonicalUtterance === '按关键词找小说'), true);
      const bookRankings = capabilities.capabilities.find((capability) => capability.name === 'browse book rankings');
      assert.equal(bookRankings?.userValue, '查看公开图书榜单和排行路由。');
      assert.equal(bookRankings?.intents?.some((intent) => intent.canonicalUtterance === '打开小说排行'), true);

      const artifactFiles = [
        'crawl_rendered.json',
        'graph.json',
        'classified_graph.json',
        'affordances.json',
        'capabilities.json',
        'intents.json',
        'build_report.json',
        'build_report.debug.json',
        'build_report.user.json',
        'build_report.user.md',
      ];
      const artifactText = (await Promise.all(artifactFiles.map(async (fileName) => {
        const filePath = path.join(result.artifactDir, fileName);
        return await pathExists(filePath) ? await readFile(filePath, 'utf8') : '';
      }))).join('\n');
      const htmlReportPath = path.join(result.artifactDir, 'reports', 'capability_intent_summary.html');
      const htmlReportText = await pathExists(htmlReportPath) ? await readFile(htmlReportPath, 'utf8') : '';
      for (const forbidden of [
        sensitiveValue,
        `sid=${sensitiveValue}`,
        `token=${sensitiveValue}`,
        'uid=123',
        'Authorization: Bearer',
        '<script>',
        '<html',
        'raw DOM',
      ]) {
        assert.equal(artifactText.includes(forbidden), false, `${forbidden} must not be persisted in qidian-like artifacts`);
      }
      for (const forbidden of [sensitiveValue, `sid=${sensitiveValue}`, `token=${sensitiveValue}`, 'Authorization: Bearer']) {
        assert.equal(htmlReportText.includes(forbidden), false, `${forbidden} must not be persisted in qidian-like HTML report`);
      }
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('chapter-content download policy generates parameterized book text downloader capability', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-chapter-download-rendered-'));
  try {
    await withTestSite(qidianLikeDynamicRoutes, async (rootUrl) => {
      const url = (route) => new URL(route, rootUrl).toString();
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'chapter-download-rendered',
        now: new Date('2026-05-16T04:06:00.000Z'),
        fetchDelayMs: 0,
        setupProfile: {
          knownSitePolicy: qidianLikeDownloadKnownPolicy(),
        },
        publicRenderedStructureProvider: async () => ({
          publicRenderedPages: [
            {
              url: rootUrl,
              pageType: 'home',
              title: 'Public novel home',
              listPresent: true,
              visibleItemCount: 6,
              routeTemplates: ['/soushu/', '/book/:id/'],
              structureItems: [
                { structureType: 'book_collection_list', visibleItemCount: 6, listPresent: true, routeTemplates: ['/book/:id/'] },
                { structureType: 'book_category_list', visibleItemCount: 2, listPresent: true, routeTemplates: ['/all/'] },
              ],
            },
            {
              url: url('/soushu/'),
              pageType: 'search-results-page',
              routeTemplate: '/soushu/',
              listPresent: true,
              visibleItemCount: 4,
              forms: [{
                label: 'public-rendered-search-form',
                method: 'GET',
                action: url('/soushu/'),
                inputs: [{ name: 'q', type: 'search', label: 'keyword' }],
              }],
              structureItems: [{ nodeType: 'operation', structureType: 'book_search_form', visibleItemCount: 0, listPresent: false, formCount: 1 }],
            },
            {
              url: url('/book/123/'),
              pageType: 'book-detail-page',
              routeTemplate: '/book/:id/',
              listPresent: true,
              visibleItemCount: 5,
              routeTemplates: ['/chapter/:id/:id/'],
              structureItems: [{ structureType: 'chapter_link', visibleItemCount: 5, listPresent: true, routeTemplates: ['/chapter/:id/:id/'] }],
            },
          ],
        }),
      });

      assert.equal(result.status, 'success');
      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      const names = new Set(capabilities.capabilities.map((capability) => capability.name));
      assert.equal(names.has('download catalog content'), false);
      const downloadBook = capabilities.capabilities.find((capability) => capability.name === 'download book');
      assert.ok(downloadBook);
      assert.equal(downloadBook.status, 'active');
      assert.equal(downloadBook.action, 'download');
      assert.equal(downloadBook.object, 'public book text');
      assert.equal(downloadBook.risk_level, 'download_high');
      assert.equal(downloadBook.mode, 'download');
      assert.equal(downloadBook.providerId, 'known_site_downloader');
      assert.equal(downloadBook.evidenceMatrix.providerId, 'known_site_downloader');
      assert.deepEqual(downloadBook.inputs.map((input) => input.name), ['book_title', 'book_url', 'output_dir']);
      assert.equal(downloadBook.executionPlan.mode, 'download');
      assert.equal(downloadBook.executionPlan.steps[0].kind, 'downloader_task_descriptor');
      assert.deepEqual(downloadBook.executionPlan.steps[0].slotNames, ['book_title', 'book_url', 'output_dir']);
      assert.equal(downloadBook.executionPlan.steps[0].artifactMaterial, 'public_chapter_text_txt');
      assert.equal(downloadBook.executionPlan.runtimeMode, undefined);

      const contracts = await readJson(path.join(result.artifactDir, 'execution_contracts.json'));
      const contract = contracts.executionContracts.find((candidate) => candidate.capabilityId === downloadBook.id);
      assert.ok(contract);
      assert.equal(contract.operationKind, 'download');
      assert.equal(contract.runtimeBinding.kind, 'downloader');
      assert.equal(contract.runtimeBinding.providerId, 'known_site_downloader');
      assert.equal(contract.runtimeBinding.downloaderTaskDescriptor.taskType, 'book');
      assert.equal(contract.runtimeBinding.downloaderTaskDescriptor.entrypoint, 'src/sites/known-sites/chapter-content/download/python/book.py');
      assert.equal(contract.runtimeBinding.downloaderTaskDescriptor.interpreter, 'pypy3');
      assert.deepEqual(contract.runtimeBinding.downloaderTaskDescriptor.inputSlots, ['book_title', 'book_url', 'output_dir']);
      assert.equal(contract.runtimeBinding.downloaderTaskDescriptor.bodyTextPersistence, 'download_artifact_only');
      assert.equal(contract.runtimeBinding.downloaderTaskDescriptor.savedMaterial, 'sanitized_summary_only');
      assert.equal(contract.runtimeBinding.downloaderTaskDescriptor.reportMaterial, 'sanitized_summary_only');
      assert.deepEqual(contract.payloadTemplate.slotBindings.map((slot) => slot.name), ['book_title', 'book_url', 'output_dir']);
      assert.deepEqual(contract.payloadTemplate.steps[0].slotNames, ['book_title', 'book_url', 'output_dir']);

      const governance = await readJson(path.join(result.artifactDir, 'execution_governance.json'));
      const decision = governance.decisions.find((candidate) => candidate.capabilityId === downloadBook.id);
      assert.equal(decision?.runtimeDispatchAllowed, true);
      assert.equal(decision?.downloaderInvocationAllowed, true);

      const intents = await readJson(path.join(result.artifactDir, 'intents.json'));
      const downloadIntents = intents.intents.filter((intent) => intent.capabilityId === downloadBook.id);
      assert.equal(downloadIntents.some((intent) => intent.canonicalUtterance === '\u4e0b\u8f7d\u641c\u7d22\u5230\u7684\u4f5c\u54c1'), true);
      assert.equal(downloadIntents.some((intent) => intent.canonicalUtterance === 'download video'), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('unconfigured dynamic public book site uses rendered structure signals for chapter-content capabilities', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-unconfigured-book-rendered-'));
  try {
    await withTestSite(qidianLikeDynamicRoutes, async (rootUrl) => {
      const url = (route) => new URL(route, rootUrl).toString();
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'unconfigured-book-rendered',
        now: new Date('2026-05-16T04:05:30.000Z'),
        fetchDelayMs: 0,
        publicRenderedStructureProvider: async () => ({
          publicRenderedPages: [{
            url: rootUrl,
            pageType: 'home',
            listPresent: true,
            visibleItemCount: 8,
            routeTemplates: ['/all/', '/rank/', '/book/:id/', '/chapter/:id/:id/'],
            forms: [{
              label: 'public-rendered-search-form',
              method: 'GET',
              action: url('/soushu/'),
              inputs: [{ name: 'q', type: 'search', label: 'public-rendered-query' }],
            }],
            structureItems: [
              { structureType: 'book_category_list', visibleItemCount: 3, listPresent: true, routeTemplates: ['/all/'] },
              { structureType: 'book_ranking_list', visibleItemCount: 3, listPresent: true, routeTemplates: ['/rank/'] },
              { structureType: 'book_card', visibleItemCount: 8, listPresent: true, routeTemplates: ['/book/:id/'] },
              { structureType: 'chapter_link', visibleItemCount: 8, listPresent: true, routeTemplates: ['/chapter/:id/:id/'] },
              { nodeType: 'operation', structureType: 'book_search_form', visibleItemCount: 0, listPresent: false, formCount: 1 },
            ],
          }],
        }),
      });

      assert.equal(result.status, 'success');
      const graph = await readJson(path.join(result.artifactDir, 'classified_graph.json'));
      const classifications = new Set(graph.nodes.map((node) => node.classification).filter(Boolean));
      for (const expected of ['book_category_list', 'book_ranking_list', 'book_collection_list', 'book_detail', 'chapter_detail', 'book_search_form']) {
        assert.equal(classifications.has(expected), true, `${expected} should be inferred from structure without a known-site policy`);
      }

      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      const activeNames = new Set(capabilities.capabilities.filter((capability) => capability.status === 'active').map((capability) => capability.name));
      for (const expected of ['browse book categories', 'browse book rankings', 'browse book collections', 'open book detail', 'open chapter', 'search books']) {
        assert.equal(activeNames.has(expected), true, `${expected} should be active from generic book structure signals`);
      }
      for (const unexpected of ['browse products', 'search products', 'search posts']) {
        assert.equal(activeNames.has(unexpected), false, `${unexpected} must not be active for inferred chapter-content structure`);
      }
      assert.deepEqual(
        fineGrainedNavigationCapabilityNames(capabilities.capabilities),
        [],
        'inferred chapter-content sites should not expose per-element or per-route capabilities',
      );
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('public rendered route seed only does not activate mismatched social capabilities', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-route-seed-only-'));
  try {
    let result;
    await withTestSite(qidianLikeDynamicRoutes, async (rootUrl) => {
      result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'qidian-like-route-seed-only',
        now: new Date('2026-05-16T04:06:00.000Z'),
        fetchDelayMs: 0,
        setupProfile: {
          knownSitePolicy: qidianLikeKnownPolicy(),
        },
        publicRenderedStructureProvider: async () => ({
          publicRenderedPages: [{
            url: rootUrl,
            pageType: 'home',
            listPresent: false,
            visibleItemCount: 0,
            emptyStatePresent: false,
          }],
        }),
      });
    });

    // @ts-ignore
    assert.equal(result.status, 'success');
    // @ts-ignore
    const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
    const activeCapabilities = capabilities.capabilities.filter((capability) => capability.status === 'active');
    const activeNames = new Set(activeCapabilities.map((capability) => capability.name));
    assert.equal(activeCapabilities.length > 0, true);
    assert.equal(activeCapabilities.every((capability) => capability.publicRouteOnly === true || capability.evidenceModel === 'public_route_navigation'), true);
    const socialNames = ['search posts', 'read timeline post summaries', 'read recommended timeline', 'list direct messages'];
    for (const name of socialNames) {
      assert.equal(activeNames.has(name), false);
    }
    const homepage = capabilities.capabilities.find((capability) => capability.name === 'view homepage');
    assert.equal(homepage?.status, 'candidate');
    assert.equal(homepage?.evidenceMatrix?.missingEvidence.includes('public_structure_present'), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('saved profile default renderJs false does not disable automatic public rendered recovery', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-public-rendered-profile-'));
  try {
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
      const setup = await prepareSiteForgeBuildSetup(rootUrl, {
        cwd: workspace,
        buildId: 'public-rendered-profile-setup',
        now: new Date('2026-05-16T04:04:00.000Z'),
        setupInteractive: true,
        setupOutput: { write() {} },
        setupPrompt: async () => '',
        fetchDelayMs: 0,
      });
      const profile = await readJson(setup.paths.buildProfilePath);
      assert.equal(profile.scope.renderJs, false);
      assert.equal(setup.buildOptions.renderJs, undefined);

      const result = await runSiteForgeBuild(rootUrl, {
        ...setup.buildOptions,
        buildId: 'public-rendered-profile-build',
        publicRenderedStructureProvider: async () => ({
          publicRenderedPages: [{
            url: rootUrl,
            pageType: 'home',
            title: 'Rendered profile public home',
            listPresent: true,
            visibleItemCount: 3,
            emptyStatePresent: false,
          }],
        }),
      });

      assert.equal(result.status, 'success');
      const crawlStatic = await readJson(path.join(result.artifactDir, 'crawl_static.json'));
      assert.equal(crawlStatic.summary.renderedEvidenceRequired, true);
      const crawlRendered = await readJson(path.join(result.artifactDir, 'crawl_rendered.json'));
      assert.equal(crawlRendered.status, 'success');
      assert.equal(crawlRendered.publicRenderedPages[0].sourceLayer, 'public_rendered');
    });
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
