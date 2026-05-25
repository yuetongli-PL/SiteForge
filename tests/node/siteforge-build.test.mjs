import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  isUrlAllowedByRobots,
  lookupSkillIntent,
  normalizeUrl,
  parseHtmlDocument,
  parseRobotsPolicy,
  parseRobotsSitemaps,
  parseSitemapUrls,
  renderCapabilityIntentSummaryHtml,
  renderSiteForgeBuildSummary,
  runBrowserAuthStateCheck,
  runCookieAuthStateCheck,
  runSiteForgeBuild,
  siteForgeBuildCliJson,
  canRunAuthenticatedLayer,
  createCrawlContract,
  stableSiteIdFromUrl,
  validateCapabilitySafetyForVerification,
} from '../../src/app/pipeline/build/index.mjs';
import {
  readArtifactJson,
  readArtifactYaml,
  writeArtifactJson,
  writeArtifactYaml,
} from '../../src/app/pipeline/build/artifact-store.mjs';
import {
  createSiteWorkspace,
} from '../../src/app/pipeline/build/workspace.mjs';
import {
  buildSetupAssistantPaths,
  prepareSiteForgeBuildSetup,
} from '../../src/app/pipeline/build/setup-assistant.mjs';
import {
  browserBridgeExtensionDirectory,
  runBrowserAuthBridge,
} from '../../src/app/pipeline/build/browser-auth-bridge.mjs';
import { browserStructureCollectorScript } from '../../src/app/pipeline/build/browser-structure-collector.mjs';
import {
  simpleShopRoutes,
  tencentNewsRoutes,
  testHtmlPage,
  testRobotsTxt,
  testSitemapXml,
  withDirectorySite,
  withTestSite,
} from './helpers/test-site-server.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');
const CLI_PATH = path.join(REPO_ROOT, 'src', 'entrypoints', 'cli', 'index.mjs');
const LIVE_NEWS_QQ_ENABLED = process.env.SITEFORGE_LIVE_TESTS === '1' || process.env.SITEFORGE_LIVE_NEWS_QQ === '1';
const REQUIRED_BUILD_ARTIFACTS = [
  'site.json',
  'generated_adapter.json',
  'adapter_contract_tests.json',
  'seeds.json',
  'crawl_checkpoint.json',
  'auth_state_report.json',
  'crawl_authenticated.json',
  'graph.json',
  'classified_graph.json',
  'affordances.json',
  'capabilities.json',
  'intents.json',
  'skill.yaml',
  'execution_plans.json',
  'safety_policy.json',
  'verification_report.json',
  'build_report.json',
  'page_reconciliation_report.json',
];

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function fileExists(filePath) {
  try {
    await readFile(filePath, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function spawnNode(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    assert.ok(child.stdout);
    assert.ok(child.stderr);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

async function withTestServer(handler, callback) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  // @ts-ignore
  const { port } = server.address();
  try {
    return await callback(`http://127.0.0.1:${port}/`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function listBuildDirs(siteRoot) {
  const entries = await readdir(siteRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(siteRoot, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right), 'en'));
}

function siteBuildsDir(workspace, inputUrl) {
  return buildSetupAssistantPaths(inputUrl, {
    cwd: workspace,
    buildId: 'path-probe',
    now: new Date('2026-05-16T00:00:00.000Z'),
  }).siteBuildsDir;
}

function siteWorkspaceDir(workspace, inputUrl) {
  return path.dirname(siteBuildsDir(workspace, inputUrl));
}

async function assertArtifactsExist(artifactDir, artifactNames) {
  for (const artifactName of artifactNames) {
    assert.equal(
      await readFile(path.join(artifactDir, artifactName), 'utf8').then(() => true),
      true,
      `${artifactName} should exist`,
    );
  }
}

async function writeParallelCrawlFixture(fixtureDir, {
  rootUrl = 'https://parallel.local/',
  productCount = 8,
} = /** @type {any} */ ({})) {
  await mkdir(fixtureDir, { recursive: true });
  const productPaths = Array.from({ length: productCount }, (_, index) => `/product-${index + 1}.html`);
  const pagePaths = ['/', '/products.html', ...productPaths, '/contact.html'];
  await writeFile(
    path.join(fixtureDir, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${new URL('/sitemap.xml', rootUrl)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(fixtureDir, 'sitemap.xml'),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...pagePaths.map((pagePath) => `  <url><loc>${new URL(pagePath, rootUrl)}</loc></url>`),
      '</urlset>',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(fixtureDir, 'index.html'),
    `<!doctype html>
<html>
  <head><title>Parallel Shop Home</title></head>
  <body>
    <h1>Parallel Shop Home</h1>
    <p>Parallel fixture with enough public catalog pages to exceed one crawl batch.</p>
    <nav>
      <a href="/products.html">Products</a>
      ${productPaths.map((pagePath, index) => `<a href="${pagePath}">Product ${index + 1}</a>`).join('\n      ')}
      <a href="/contact.html">Contact support</a>
    </nav>
    <form method="GET" action="/search.html" aria-label="Search catalog">
      <input name="q" type="search" placeholder="Search products">
      <select name="category"><option value="all">All products</option></select>
      <button type="submit">Search</button>
    </form>
  </body>
</html>
`,
    'utf8',
  );
  await writeFile(
    path.join(fixtureDir, 'products.html'),
    `<!doctype html>
<html>
  <head><title>Parallel products catalog</title></head>
  <body>
    <h1>Products catalog</h1>
    <p>Catalog collection for browse products capability discovery.</p>
    ${productPaths.map((pagePath, index) => `<a href="${pagePath}">Catalog product ${index + 1}</a>`).join('\n    ')}
  </body>
</html>
`,
    'utf8',
  );
  await writeFile(
    path.join(fixtureDir, 'contact.html'),
    `<!doctype html>
<html>
  <head><title>Contact support</title></head>
  <body>
    <h1>Contact support</h1>
    <p>Support contact form for dry-run confirmation coverage.</p>
    <form method="POST" action="/support/message" aria-label="Contact support">
      <input name="email" type="email" placeholder="Email">
      <textarea name="message">Need help</textarea>
      <button type="submit">Send message</button>
    </form>
  </body>
</html>
`,
    'utf8',
  );
  for (const [index, pagePath] of productPaths.entries()) {
    await writeFile(
      path.join(fixtureDir, pagePath.slice(1)),
      `<!doctype html>
<html>
  <head><title>Product ${index + 1} detail</title></head>
  <body>
    <h1>Product ${index + 1} detail</h1>
    <p>Detailed item page ${index + 1} with public product specifications.</p>
    <a href="/products.html">Back to catalog</a>
  </body>
</html>
`,
      'utf8',
    );
  }
  return {
    rootUrl,
    expectedUrls: pagePaths.map((pagePath) => normalizeUrl(new URL(pagePath, rootUrl).toString())),
  };
}

test('SiteForge build URL normalization removes tracking and sensitive query parameters', () => {
  assert.equal(
    normalizeUrl('HTTPS://Fixture.Local:443/products.html?utm_source=x&b=2&a=1&access_token=secret#section'),
    'https://fixture.local/products.html?a=1&b=2',
  );
});

test('SiteForge build seed parsers handle robots and sitemap records', () => {
  assert.deepEqual(
    parseRobotsSitemaps('User-agent: *\nSitemap: /sitemap.xml\n', 'https://fixture.local/'),
    ['https://fixture.local/sitemap.xml'],
  );
  const policy = parseRobotsPolicy(`
    User-agent: *
    Disallow: /qqfile/
    Disallow: /sv1/
    Disallow: /answer/
    Allow: /
    Sitemap: /sitemap.xml
  `, 'https://news.qq.com/');
  assert.equal(isUrlAllowedByRobots('https://news.qq.com/ch/world.html', policy), true);
  assert.equal(isUrlAllowedByRobots('https://news.qq.com/qqfile/private.html', policy), false);
  assert.equal(isUrlAllowedByRobots('https://news.qq.com/sv1/internal.html', policy), false);
  assert.equal(isUrlAllowedByRobots('https://news.qq.com/answer/comment.html', policy), false);
  assert.deepEqual(
    parseSitemapUrls('<urlset><url><loc>/</loc></url><url><loc>/products.html</loc></url></urlset>', 'https://fixture.local/'),
    ['https://fixture.local/', 'https://fixture.local/products.html'],
  );
});

test('SiteForge robots parser treats root disallow as a cross-site crawl stop', () => {
  const policy = parseRobotsPolicy(`
    User-agent: *
    Disallow: /
  `, 'https://social-fixture.invalid/');

  assert.equal(isUrlAllowedByRobots('https://social-fixture.invalid/', policy), false);
  assert.equal(isUrlAllowedByRobots('https://social-fixture.invalid/home', policy), false);
  assert.equal(isUrlAllowedByRobots('https://social-fixture.invalid/search?q=public', policy), false);
  assert.equal(isUrlAllowedByRobots('https://social-fixture.invalid/assets/app.js', policy), false);
});

test('live SiteForge build fails closed when robots.txt is unavailable', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-robots-unavailable-'));
  try {
    const fetchCalls = /** @type {any[]} */ ([]);
    await withTestServer((request, response) => {
      fetchCalls.push(request.url);
      response.writeHead(503, { 'content-type': 'text/plain' });
      response.end('service unavailable');
    }, async (rootUrl) => {
      let failure;
      await assert.rejects(
        async () => {
          try {
            await runSiteForgeBuild(rootUrl, {
              cwd: workspace,
              buildId: 'robots-unavailable',
              now: new Date('2026-05-16T07:00:00.000Z'),
              fetchDelayMs: 0,
            });
          } catch (error) {
            failure = error;
            throw error;
          }
        },
        /robots\.txt unavailable for live SiteForge build/u,
      );

      // @ts-ignore
      assert.equal(failure.code, 'robots-unavailable');
      // @ts-ignore
      assert.equal(failure.stage, 'discoverSeeds');
      assert.deepEqual(fetchCalls, ['/robots.txt']);

      // @ts-ignore
      const seeds = await readJson(path.join(failure.artifactDir, 'seeds.json'));
      assert.equal(seeds.status, 'blocked');
      assert.equal(seeds.robots.status, 'unavailable');
      assert.match(seeds.robots.reason, /HTTP 503/u);
      assert.deepEqual(seeds.seeds, []);

      // @ts-ignore
      const buildReport = await readJson(failure.buildReportPath);
      assert.equal(buildReport.status, 'blocked');
      assert.equal(buildReport.failedStage, 'discoverSeeds');
      assert.equal(buildReport.failureClass, 'robots');
      assert.equal(buildReport.reasonCode, 'robots-unavailable');
      assert.equal(buildReport.warningCodes.includes('robots-unavailable'), true);
      assert.equal(buildReport.stages.discoverSeeds.status, 'blocked');
      assert.equal(buildReport.stages.crawlStatic.status, 'skipped');
      assert.equal(buildReport.stages.generateSkill.status, 'skipped');
      // @ts-ignore
      assert.equal(await fileExists(path.join(failure.artifactDir, 'crawl_static.json')), false);
      // @ts-ignore
      assert.equal(await fileExists(path.join(failure.artifactDir, 'skill.yaml')), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('live SiteForge build stops early when robots.txt disallows all planned seeds', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-robots-disallowed-'));
  try {
    const fetchCalls = /** @type {any[]} */ ([]);
    await withTestServer((request, response) => {
      fetchCalls.push(request.url);
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('User-agent: *\nDisallow: /\n');
    }, async (rootUrl) => {
      let failure;
      await assert.rejects(
        async () => {
          try {
            await runSiteForgeBuild(rootUrl, {
              cwd: workspace,
              buildId: 'robots-disallowed',
              now: new Date('2026-05-16T07:01:00.000Z'),
              fetchDelayMs: 0,
            });
          } catch (error) {
            failure = error;
            throw error;
          }
        },
        /robots\.txt disallows all planned seed URLs/u,
      );

      // @ts-ignore
      assert.equal(failure.code, 'robots-disallowed');
      // @ts-ignore
      assert.equal(failure.stage, 'discoverSeeds');
      assert.deepEqual(fetchCalls, ['/robots.txt', '/sitemap.xml']);

      // @ts-ignore
      const seeds = await readJson(path.join(failure.artifactDir, 'seeds.json'));
      assert.equal(seeds.status, 'blocked');
      assert.equal(seeds.robots.status, 'parsed');
      assert.deepEqual(seeds.robots.disallowPaths, ['/']);
      assert.deepEqual(seeds.robots.excludedUrls, [rootUrl]);
      assert.deepEqual(seeds.seeds, []);

      // @ts-ignore
      const buildReport = await readJson(failure.buildReportPath);
      assert.equal(buildReport.status, 'blocked');
      assert.equal(buildReport.failedStage, 'discoverSeeds');
      assert.equal(buildReport.failureClass, 'robots');
      assert.equal(buildReport.reasonCode, 'robots-disallowed');
      assert.equal(buildReport.warningCodes.includes('robots-disallowed'), true);
      assert.equal(buildReport.stages.crawlStatic.status, 'skipped');
      assert.equal(buildReport.stages.generateSkill.status, 'skipped');
      // @ts-ignore
      assert.equal(await fileExists(path.join(failure.artifactDir, 'crawl_static.json')), false);
      // @ts-ignore
      assert.equal(await fileExists(path.join(failure.artifactDir, 'skill.yaml')), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('live SiteForge build recovers from blocked root when sitemap exposes robots-allowed URLs', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-robots-allowed-sitemap-'));
  try {
    await withTestSite((rootUrl) => ({
      '/robots.txt': {
        contentType: 'text/plain; charset=utf-8',
        body: [
          'User-agent: *',
          'Disallow: /',
          'Allow: /public/',
          `Sitemap: ${new URL('/sitemap.xml', rootUrl)}`,
          '',
        ].join('\n'),
      },
      '/sitemap.xml': {
        contentType: 'application/xml; charset=utf-8',
        body: testSitemapXml(rootUrl, ['/public/catalog', '/private/blocked']),
      },
      '/public/catalog': testHtmlPage('Public Catalog', `
        <main>
          <h1>Public Catalog</h1>
          <ul>
            <li><a href="/public/category/a">Category A</a></li>
            <li><a href="/public/category/b">Category B</a></li>
          </ul>
        </main>
      `),
      '/public/category/a': testHtmlPage('Category A', '<main><h1>Category A</h1><p>Allowed category.</p></main>'),
      '/public/category/b': testHtmlPage('Category B', '<main><h1>Category B</h1><p>Allowed category.</p></main>'),
      '/private/blocked': testHtmlPage('Private', '<main>Blocked</main>'),
    }), async (rootUrl) => {
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'robots-allowed-sitemap',
        now: new Date('2026-05-16T07:02:00.000Z'),
        fetchDelayMs: 0,
        maxPages: 5,
      });

      const seeds = await readJson(path.join(result.artifactDir, 'seeds.json'));
      assert.equal(seeds.status, 'success');
      assert.equal(seeds.seeds.some((seed) => /\/public\/catalog$/u.test(seed.normalizedUrl)), true);
      assert.equal(seeds.seeds.some((seed) => /\/private\/blocked$/u.test(seed.normalizedUrl)), false);
      assert.equal(seeds.robots.policyClassification, 'partial_allowed');
      assert.equal(seeds.robots.decisions.allowed >= 1, true);
      assert.equal(seeds.robots.decisions.denied >= 1, true);
      assert.equal(seeds.robots.sitemapSummary.processed, 1);

      const crawlStatic = await readJson(path.join(result.artifactDir, 'crawl_static.json'));
      assert.equal(crawlStatic.pages.some((page) => /\/public\/catalog$/u.test(page.normalizedUrl)), true);
      assert.equal(crawlStatic.pages.some((page) => /\/private\/blocked$/u.test(page.normalizedUrl)), false);

      const buildReport = await readJson(path.join(result.artifactDir, 'build_report.json'));
      assert.equal(buildReport.status, 'success');
      assert.equal(buildReport.summary.robots.policyClassification, 'partial_allowed');
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('SiteForge build static parser extracts links, forms, buttons, inputs, selects, and text', () => {
  const parsed = parseHtmlDocument(`
    <title>Parser Fixture</title>
    <a href="/products.html">Products</a>
    <a href="/categories/action/">Action category</a>
    <a href="/categories/xuanhuan/">玄幻分类</a>
    <a href="/hot/">Hot ranking</a>
    <button type="button" aria-expanded="false">Menu</button>
    <form id="search" role="search" method="GET" action="/search.html">
      <input name="q" type="search" placeholder="headphones">
      <select name="category"><option>Audio</option></select>
      <textarea name="notes"></textarea>
      <button type="submit">Search</button>
    </form>
  `, 'https://fixture.local/');

  assert.equal(parsed.title, 'Parser Fixture');
  assert.equal(parsed.links[0].href, 'https://fixture.local/products.html');
  assert.equal(parsed.links.some((link) => link.label === 'Action category' && link.semanticKind === 'category'), true);
  assert.equal(parsed.links.some((link) => link.label === '玄幻分类' && link.semanticKind === 'category'), true);
  assert.equal(parsed.links.some((link) => link.label === 'Hot ranking' && link.semanticKind === 'ranking'), true);
  assert.equal(parsed.elementInstances.some((element) => element.label === '玄幻分类' && element.role === 'category'), true);
  assert.equal(parsed.elementInstances.every((element) => element.rawDomPersisted === false && element.rawHtmlPersisted === false && element.bodyTextPersisted === false), true);
  assert.equal(parsed.forms[0].method, 'GET');
  assert.equal(parsed.forms[0].inputs.some((input) => input.tagName === 'select'), true);
  assert.equal(parsed.forms[0].inputs.some((input) => input.tagName === 'textarea'), true);
  assert.equal(parsed.controls.some((control) => control.tagName === 'button'), true);
});

test('runSiteForgeBuild promotes uncrawled semantic links into route-only public capabilities', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-link-route-only-'));
  try {
    await withTestSite((rootUrl) => ({
      '/robots.txt': { contentType: 'text/plain; charset=utf-8', body: testRobotsTxt(rootUrl, { sitemap: false }) },
      '/': testHtmlPage('Semantic route links', `
        <main>
          <h1>Semantic public catalog</h1>
          <p>Public index with semantic links that are intentionally not crawled in this build.</p>
          <script>window.bootstrap = { token: 'SECRET_PAGE_TOKEN' }; localStorage.setItem('sf', 'SECRET_PAGE_TOKEN');</script>
          <input type="hidden" name="csrf_token" value="SECRET_PAGE_TOKEN">
          <nav>
            <a href="/categories/action/">Action category</a>
            <a href="/hot/">Hot ranking</a>
            <a href="/videos/abc-001/">Video ABC-001</a>
            <a href="/models/aya/">Model Aya profile</a>
            <a href="/pay/">Pay center</a>
          </nav>
        </main>
      `),
      '/categories/action/': testHtmlPage('Action category', '<main><h1>Action category</h1></main>'),
      '/hot/': testHtmlPage('Hot ranking', '<main><h1>Hot ranking</h1></main>'),
      '/videos/abc-001/': testHtmlPage('Video ABC-001', '<main><h1>Video ABC-001</h1></main>'),
      '/models/aya/': testHtmlPage('Model Aya profile', '<main><h1>Model Aya profile</h1></main>'),
      '/pay/': testHtmlPage('Pay center', '<main><h1>Pay center</h1></main>'),
    }), async (rootUrl) => {
      const inputUrl = rootUrl.replace('127.0.0.1', 'localhost');
      const result = await runSiteForgeBuild(inputUrl, {
        cwd: workspace,
        buildId: 'semantic-route-only-build',
        now: new Date('2026-05-23T02:20:00.000Z'),
        maxDepth: 1,
        maxPages: 1,
        maxSeeds: 10,
        fetchDelayMs: 0,
      });

      assert.equal(result.status, 'success');
      const crawlStatic = await readJson(path.join(result.artifactDir, 'crawl_static.json'));
      assert.equal(crawlStatic.summary.pages, 1);
      assert.equal(crawlStatic.summary.rawPageMaterial.pages, 1);
      assert.equal(crawlStatic.pages[0].rawPageMaterial.redacted, true);
      const rawMaterialManifest = await readJson(path.join(result.artifactDir, 'reports', 'raw_page_material_manifest.json'));
      assert.equal(rawMaterialManifest.summary.pages, 1);
      assert.equal(rawMaterialManifest.policy.publicPageHtmlPersisted, true);
      assert.equal(rawMaterialManifest.policy.cookieMaterialPersisted, false);
      assert.equal(rawMaterialManifest.policy.tokenMaterialPersisted, false);
      const rawHtml = await readFile(path.join(result.artifactDir, rawMaterialManifest.pages[0].htmlPath), 'utf8');
      const rawBodyText = await readFile(path.join(result.artifactDir, rawMaterialManifest.pages[0].bodyTextPath), 'utf8');
      assert.match(rawHtml, /Semantic public catalog/u);
      assert.match(rawBodyText, /Semantic public catalog/u);
      assert.doesNotMatch(rawHtml, /SECRET_PAGE_TOKEN|localStorage|token\s*[:=]|csrf_token\s*=\s*"SECRET_PAGE_TOKEN"/u);
      assert.doesNotMatch(rawBodyText, /SECRET_PAGE_TOKEN|localStorage|token\s*[:=]/u);

      const graph = await readJson(path.join(result.artifactDir, 'classified_graph.json'));
      assert.equal(graph.nodes.filter((node) => node.type === 'page').length, 1);
      const semanticRouteNodes = graph.nodes.filter((node) => node.type === 'route_template' && node.evidenceStatus === 'link_semantic_route_template');
      assert.equal(semanticRouteNodes.some((node) => node.linkSemanticKind === 'category' && node.classification === 'category_list'), true);
      assert.equal(semanticRouteNodes.some((node) => node.linkSemanticKind === 'ranking' && node.classification === 'ranking_list'), true);
      assert.equal(semanticRouteNodes.some((node) => node.linkSemanticKind === 'media' && node.classification === 'entity_detail'), true);
      assert.equal(semanticRouteNodes.some((node) => node.linkSemanticKind === 'profile' && node.classification === 'profile_detail'), true);
      const elementNodes = graph.nodes.filter((node) => node.evidenceStatus === 'element_instance_summary_present');
      const actionCategoryNode = elementNodes.find((node) => node.elementLabel === 'Action category');
      assert.equal(actionCategoryNode?.classification, 'category_list');
      assert.equal(actionCategoryNode?.categoryInstance?.kind, 'category');
      assert.equal(actionCategoryNode?.categoryInstance?.label, 'Action category');
      assert.equal(actionCategoryNode?.categoryInstance?.routeTemplate, '/categories/action');
      assert.equal(elementNodes.some((node) => node.elementLabel === 'Hot ranking' && node.classification === 'ranking_list'), true);
      assert.equal(semanticRouteNodes.some((node) => node.categoryInstance?.label === 'Action category' && node.categoryInstance?.kind === 'category'), true);

      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      const capabilityByName = new Map(capabilities.capabilities.map((capability) => [capability.name, capability]));
      for (const capabilityName of [
        'browse public categories',
        'browse public rankings',
        'open public detail pages',
        'open public profiles',
      ]) {
        const capability = capabilityByName.get(capabilityName);
        assert.equal(capability?.status, 'active', `${capabilityName} should be active`);
        assert.equal(capability?.publicRouteOnly, true, `${capabilityName} should be route-only`);
        assert.equal(capability?.evidenceModel, 'public_route_navigation', `${capabilityName} should use route navigation evidence`);
        assert.deepEqual(capability?.outputs, [{ name: 'routes', type: 'route_summary' }]);
        assert.equal(capability?.executionPlan?.steps?.every((step) => step.kind === 'route_template'), true);
      }
      const actionCategoryCapability = capabilityByName.get('open category element action-category');
      assert.equal(actionCategoryCapability?.status, 'active');
      assert.equal(actionCategoryCapability?.evidenceModel, 'public_element_summary');
      assert.equal(actionCategoryCapability?.userValue, '浏览Action category');
      assert.equal(actionCategoryCapability?.intents?.some((intent) => (
        intent.utteranceExamples?.includes('打开Action category分类')
      )), true);
      assert.equal(actionCategoryCapability?.intents?.some((intent) => (
        intent.utteranceExamples?.includes('查看Action category分类')
      )), true);
      assert.equal(actionCategoryCapability?.raw_dom_saved, false);
      assert.equal(actionCategoryCapability?.raw_html_saved, false);
      assert.equal(actionCategoryCapability?.raw_content_saved, false);
      assert.equal(actionCategoryCapability?.activationEvidence?.observedEvidence?.includes('public_element_instance_present'), true);
      const intents = await readJson(path.join(result.artifactDir, 'intents.json'));
      const graphElementIntent = intents.intents.find((intent) => (
        intent.intentSource === 'graph_element'
        && intent.sourceNodeId === actionCategoryNode?.id
        && /Action category/u.test(intent.canonicalUtterance)
      ));
      assert.equal(Boolean(graphElementIntent), true);
      assert.equal(graphElementIntent?.capabilityId, actionCategoryCapability?.id);
      assert.equal(graphElementIntent?.categoryInstance?.label, 'Action category');
      assert.equal(graphElementIntent?.canonicalUtterance, '浏览Action category');
      assert.equal(graphElementIntent?.utteranceExamples?.includes('打开Action category分类'), true);

      const htmlReport = await readFile(path.join(result.artifactDir, 'reports', 'capability_intent_summary.html'), 'utf8');
      assert.match(htmlReport, /Element \/ category/u);
      assert.match(htmlReport, /页面元素覆盖审计/u);
      assert.match(htmlReport, /covered/u);
      assert.match(htmlReport, /public_element_summary/u);
      assert.match(htmlReport, /category: Action category/u);
      assert.match(htmlReport, /\/categories\/action/u);
      assert.match(htmlReport, /intentSource/u);
      assert.match(htmlReport, /graph_element/u);
      assert.match(htmlReport, /sourceNode/u);

      const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
      for (const capabilityName of ['browse public categories', 'browse public rankings', 'open public detail pages', 'open public profiles']) {
        const capability = capabilityByName.get(capabilityName);
        const evidenceRoutes = [...(capability?.entryNodeIds ?? []), ...(capability?.requiredNodeIds ?? [])]
          .map((id) => nodeById.get(id))
          .map((node) => `${node?.normalizedUrl ?? ''} ${node?.routePattern ?? ''} ${node?.routeTemplate ?? ''}`);
        assert.equal(evidenceRoutes.some((route) => /\/pay(?:\/|$)/u.test(route)), false, `${capabilityName} should not use payment routes as public evidence`);
      }
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runSiteForgeBuild writes access remediation plan for challenge-blocked partial builds', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-challenge-access-plan-'));
  try {
    let result = /** @type {any} */ (null);
    await withTestSite((rootUrl) => ({
      '/robots.txt': { contentType: 'text/plain; charset=utf-8', body: testRobotsTxt(rootUrl, { sitemap: false }) },
      '/': testHtmlPage('Public challenge fixture', `
        <main>
          <h1>Public entry</h1>
          <a href="/categories/action/">Action category</a>
          <a href="/hot/">Hot ranking</a>
        </main>
      `),
    }), async (rootUrl) => {
      result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'challenge-access-plan-build',
        now: new Date('2026-05-23T03:00:00.000Z'),
        renderJs: true,
        fetchDelayMs: 0,
        publicRenderedStructureProvider: async () => ({
          publicRenderedPages: [{
            url: rootUrl,
            routeTemplate: '/',
            pageType: 'security_check',
            title: 'Verify challenge',
            links: [{ href: '/categories/action/', label: 'Action category' }],
          }],
        }),
      });
    });

    assert.ok(result?.artifactDir);
    assert.equal(result.result_status, 'partial_success');
    assert.equal(result.summary.verificationStatus, 'report_only_blocked');
    assert.equal(result.summary.registryStatus, 'promotion-blocked');
    assert.equal(result.summary.currentUpdated, false);
    const plan = await readJson(path.join(result.artifactDir, 'access_remediation_plan.json'));
    assert.equal(plan.artifactFamily, 'siteforge-access-remediation-plan');
    assert.equal(plan.reasonCode, 'anti-crawl-verify');
    assert.equal(plan.retryDisposition, 'blocked_no_bypass');
    assert.equal(plan.workflows.some((workflow) => workflow.kind === 'manual_summary'), true);
    assert.equal(plan.workflows.every((workflow) => workflow.genericCrawlAllowed === false), true);
    assert.equal(plan.workflows.every((workflow) => workflow.updatesCurrent === false), true);
    assert.equal(plan.workflows.every((workflow) => workflow.updatesRegistry === false), true);
    assert.equal(plan.safety.bypassChallenge, false);
    assert.equal(plan.safety.saveRawHtml, false);
    assert.equal(plan.safety.savePrivateBody, false);
    const buildReport = await readJson(path.join(result.artifactDir, 'build_report.json'));
    assert.equal(buildReport.result_status, 'partial_success');
    assert.equal(buildReport.summary.verificationStatus, 'report_only_blocked');
    assert.equal(buildReport.summary.registryStatus, 'promotion-blocked');
    assert.equal(buildReport.summary.currentUpdated, false);
    assert.equal(buildReport.report_index.available_reports.includes('access_remediation_plan'), true);
    assert.match(buildReport.reports.access_remediation_plan, /access_remediation_plan\.json$/u);
    const registryReport = await readJson(path.join(result.artifactDir, 'registry_report.json'));
    assert.equal(registryReport.status, 'promotion-blocked');
    assert.equal(registryReport.lookup.status, 'skipped');
    assert.equal(registryReport.promotionAllowed, false);
    const userReport = await readJson(path.join(result.artifactDir, 'build_report.user.json'));
    assert.equal(userReport.result_status, 'partial_success');
    assert.equal(userReport.build_completion.current_updated, false);
    assert.equal(userReport.build_completion.registry_status, 'promotion-blocked');
    assert.match(userReport.reports.access_remediation_plan, /access_remediation_plan\.json$/u);
    assert.equal(userReport.next_step_workflows.some((workflow) => workflow.id === 'access-remediation-plan'), true);
    assert.equal(userReport.next_step_workflows.every((workflow) => workflow.promotionAllowed === false), true);
    assert.doesNotMatch(JSON.stringify(plan), /SECRET|sid=|uid=|Bearer\s+[A-Za-z0-9]|<html|<body/iu);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runSiteForgeBuild registers browser bridge runtime for challenge-blocked read-only builds', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-bridge-runtime-promotion-'));
  try {
    let result = /** @type {any} */ (null);
    await withTestSite((rootUrl) => ({
      '/robots.txt': { contentType: 'text/plain; charset=utf-8', body: testRobotsTxt(rootUrl, { sitemap: false }) },
      '/': testHtmlPage('Browser bridge runtime fixture', `
        <main>
          <h1>Public entry</h1>
          <a href="/categories/action/">Action category</a>
          <a href="/hot/">Hot ranking</a>
        </main>
      `),
      '/notifications': testHtmlPage('Notifications', '<main><ul><li>Notification summary</li></ul></main>'),
    }), async (rootUrl) => {
      result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'bridge-runtime-promotion-build',
        now: new Date('2026-05-24T23:00:00.000Z'),
        renderJs: true,
        fetchDelayMs: 0,
        authMode: 'browser',
        authCheckUrl: '/notifications',
        strictBrowserAuth: true,
        browserBridgeMaxRetryPasses: 0,
        localBuildConfig: {
          authRoutes: ['/notifications'],
          publicRevisitRoutes: ['/'],
        },
        publicRenderedStructureProvider: async () => ({
          publicRenderedPages: [{
            url: rootUrl,
            routeTemplate: '/',
            pageType: 'security_check',
            title: 'Verify challenge',
            links: [{ href: '/categories/action/', label: 'Action category' }],
          }],
        }),
        browserAuthBridgeProvider: async ({ routes }) => ({
          authenticatedPages: [{
            routeId: routes[0].id,
            url: routes[0].targetUrl,
            routeTemplate: '/notifications',
            tabState: 'notifications',
            pageType: 'notifications',
            visibleItemCount: 2,
            listPresent: true,
            links: [{
              href: '/hot/',
              label: '\u70ed\u95e8\u699c\u5355',
              semanticKind: 'ranking',
              routeTemplate: '/hot',
            }],
          }],
          authenticatedOverlayPages: [{
            routeId: routes[1].id,
            url: routes[1].targetUrl,
            routeTemplate: '/',
            tabState: 'home',
            pageType: 'home_overlay',
            visibleItemCount: 1,
            listPresent: true,
            overlayFor: rootUrl,
          }],
        }),
      });
    });

    assert.ok(result?.artifactDir);
    assert.equal(result.status, 'success');
    assert.equal(result.result_status, 'partial_success');
    assert.equal(result.summary.verificationStatus, 'bridge_runtime_passed');
    assert.equal(result.summary.registryStatus, 'registered');
    assert.equal(result.summary.currentUpdated, true);
    assert.equal(result.summary.promotionClass, 'browser_bridge_runtime');
    assert.equal(result.summary.runtimeMode, 'browser_bridge_required');
    assert.equal(result.summary.genericHttpRuntimeAllowed, false);

    const verificationReport = await readJson(path.join(result.artifactDir, 'verification_report.json'));
    assert.equal(verificationReport.status, 'bridge_runtime_passed');
    assert.equal(verificationReport.reasonCode, 'anti-crawl-verify');
    assert.equal(verificationReport.runtimeMode, 'browser_bridge_required');
    assert.equal(verificationReport.requiresFreshBridgeEvidence, true);

    const registryReport = await readJson(path.join(result.artifactDir, 'registry_report.json'));
    assert.equal(registryReport.status, 'registered');
    assert.equal(registryReport.runtimeMode, 'browser_bridge_required');
    assert.equal(registryReport.lookup.status, 'found');
    assert.equal(registryReport.lookup.runtimeMode, 'browser_bridge_required');
    assert.equal(registryReport.lookup.requiresFreshBridgeEvidence, true);

    const registry = await readJson(result.workspace.registryPath);
    const record = registry.skills.find((skill) => skill.skillId === result.skillId);
    assert.equal(record.runtimeMode, 'browser_bridge_required');
    assert.equal(record.verificationStatus, 'bridge_runtime_passed');
    assert.equal(record.intents.length > 0, true);
    assert.equal(record.intents.some((intent) => intent.runtimeMode === 'browser_bridge_required'), true);
    assert.equal(record.intents.every((intent) => ['browser_bridge_required', 'generic_http_read'].includes(intent.runtimeMode)), true);
    assert.equal(record.runtimeModes.includes('browser_bridge_required'), true);

    const userReport = await readJson(path.join(result.artifactDir, 'build_report.user.json'));
    assert.equal(userReport.build_completion.registry_status, 'registered');
    assert.equal(userReport.build_completion.current_updated, true);
    assert.equal(userReport.build_completion.runtime_mode, 'browser_bridge_required');
    assert.equal(userReport.next_step_workflows.some((workflow) => (
      workflow.id === 'browser-bridge-runtime'
      && workflow.promotionAllowed === true
      && workflow.genericHttpRuntimeAllowed === false
    )), true);
    assert.equal(userReport.partial_success_reasons.some((reason) => /runtime-routed Skill/u.test(reason)), true);

    const currentVerification = await readJson(path.join(result.buildContext.siteDir, 'current', 'verification_report.json'));
    assert.equal(currentVerification.status, 'bridge_runtime_passed');
    assert.doesNotMatch(JSON.stringify({
      verificationReport,
      registryReport,
      userReport,
      currentVerification,
    }), /SECRET_SESSION_VALUE|sid=SECRET|uid=123|Bearer\s+synthetic/iu);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('SiteForge static crawl records failed fetches and standalone controls within maxPages', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-crawl-coverage-'));
  try {
    await withTestSite((rootUrl) => ({
      '/robots.txt': { contentType: 'text/plain; charset=utf-8', body: testRobotsTxt(rootUrl) },
      '/sitemap.xml': {
        contentType: 'application/xml; charset=utf-8',
        body: testSitemapXml(rootUrl, ['/', '/missing-1.html', '/missing-2.html']),
      },
      '/': `
      <title>Coverage Fixture</title>
      <main>
        <h1>Coverage fixture</h1>
        <p>This static page has enough public content for SiteForge to keep the build usable.</p>
        <a href="/missing-1.html">Missing One</a>
        <a href="/missing-2.html">Missing Two</a>
        <a href="/missing-3.html">Missing Three</a>
        <button id="menu-toggle" type="button" aria-label="Open menu">Menu</button>
        <select name="sort"><option>Newest</option></select>
      </main>
    `,
    }), async (rootUrl) => {

      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'coverage-build',
        now: new Date('2026-05-16T07:40:00.000Z'),
        maxDepth: 1,
        maxPages: 2,
        maxSeeds: 10,
        fetchDelayMs: 0,
      });

      const crawlStatic = await readJson(path.join(result.artifactDir, 'crawl_static.json'));
      assert.equal(crawlStatic.summary.fetchedUrls, 2);
      assert.equal(crawlStatic.summary.pages, 1);
      assert.equal(crawlStatic.summary.failedUrls, 1);
      assert.equal(crawlStatic.failures.length, 1);
      assert.match(crawlStatic.failures[0].normalizedUrl, /\/missing-1\.html$/u);
      assert.equal(crawlStatic.warnings.some((warning) => /crawl truncated at maxPages=2/u.test(warning)), true);

      const graph = await readJson(path.join(result.artifactDir, 'graph.json'));
      assert.equal(graph.nodes.some((node) => node.type === 'component' && node.title === 'Open menu'), true);
      assert.equal(graph.edges.some((edge) => edge.type === 'contains_control'), true);

      const affordances = await readJson(path.join(result.artifactDir, 'affordances.json'));
      assert.equal(affordances.affordances.some((affordance) => affordance.kind === 'button' && affordance.label === 'Open menu'), true);
      assert.equal(affordances.affordances.some((affordance) => affordance.kind === 'select' && affordance.selector === 'select[name="sort"]'), true);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runSiteForgeBuild concurrent static crawl keeps all fixture pages, nodes, affordances, and capabilities', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-parallel-crawl-'));
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'siteforge-parallel-fixture-'));
  try {
    const { expectedUrls: placeholderUrls } = await writeParallelCrawlFixture(fixtureDir);
    await withDirectorySite(fixtureDir, async (rootUrl) => {
      const expectedUrls = placeholderUrls.map((urlValue) => normalizeUrl(new URL(new URL(urlValue).pathname, rootUrl).toString()));
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'parallel-crawl-build',
        now: new Date('2026-05-16T00:30:00.000Z'),
        maxDepth: 1,
        maxPages: 20,
        maxSeeds: 20,
        fetchDelayMs: 0,
      });

      assert.equal(result.status, 'success');
      assert.equal(result.summary.registryStatus, 'registered');

      const crawlStatic = await readJson(path.join(result.artifactDir, 'crawl_static.json'));
      const crawledUrls = new Set(crawlStatic.pages.map((page) => page.normalizedUrl));
      assert.deepEqual(expectedUrls.filter((urlValue) => !crawledUrls.has(urlValue)), []);
      assert.equal(crawlStatic.summary.collectionConcurrency, 6);
      assert.equal(crawlStatic.pages.every((page) => page.collection?.concurrent === true), true);

      const graph = await readJson(path.join(result.artifactDir, 'graph.json'));
      const pageNodeUrls = new Set(graph.nodes.filter((node) => node.type === 'page').map((node) => node.normalizedUrl));
      assert.deepEqual(expectedUrls.filter((urlValue) => !pageNodeUrls.has(urlValue)), []);

      const affordances = await readJson(path.join(result.artifactDir, 'affordances.json'));
      const affordanceLabels = affordances.affordances.map((affordance) => `${affordance.kind}:${affordance.label}:${affordance.selector}`);
      assert.equal(affordances.affordances.length > 0, true);
      assert.equal(affordanceLabels.some((label) => label.includes('form:Search')), true);
      assert.equal(affordanceLabels.some((label) => label.includes('input[name="q"]')), true);
      assert.equal(affordanceLabels.some((label) => label.includes('select:category')), true);
      assert.equal(affordanceLabels.some((label) => label.includes('form:Contact support')), true);

      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      const activeNames = new Set(capabilities.capabilities
        .filter((capability) => capability.status === 'active')
        .map((capability) => capability.name));
      for (const expectedName of ['view homepage', 'browse products', 'search products', 'view product detail', 'contact support']) {
        assert.equal(activeNames.has(expectedName), true, `${expectedName} should remain active after concurrent crawl`);
      }
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test('runSiteForgeBuild applies robots crawl-delay by serializing static crawl', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-robots-crawl-delay-'));
  try {
    await withTestServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1/');
      if (requestUrl.pathname === '/robots.txt') {
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        response.end([
          'User-agent: *',
          'Allow: /',
          'Crawl-delay: 0.1',
          `Sitemap: http://${request.headers.host}/sitemap.xml`,
          '',
        ].join('\n'));
        return;
      }
      if (requestUrl.pathname === '/sitemap.xml') {
        response.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
        response.end([
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          `  <url><loc>http://${request.headers.host}/</loc></url>`,
          `  <url><loc>http://${request.headers.host}/catalog.html</loc></url>`,
          '</urlset>',
        ].join('\n'));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><title>${requestUrl.pathname}</title><main><a href="/catalog.html">Catalog</a><ul><li>Item</li></ul></main>`);
    }, async (rootUrl) => {
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'robots-crawl-delay-build',
        now: new Date('2026-05-16T01:30:00.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
      });
      assert.equal(result.status, 'success');
      const crawlStatic = await readJson(path.join(result.artifactDir, 'crawl_static.json'));
      assert.equal(crawlStatic.summary.collectionConcurrency, 1);
      assert.equal(crawlStatic.summary.robotsCrawlDelaySeconds, 0.1);
      assert.equal(crawlStatic.summary.effectiveCrawlFetchDelayMs, 100);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runSiteForgeBuild keeps distinct Chinese category element capabilities', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-chinese-category-capabilities-'));
  const fantasy = '\u7384\u5e7b';
  const city = '\u90fd\u5e02';
  const ranking = '\u6392\u884c\u699c';
  const workOne = '\u4f5c\u54c1\u4e00';
  const workTwo = '\u4f5c\u54c1\u4e8c';
  try {
    await withTestServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost/');
      if (requestUrl.pathname === '/robots.txt') {
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('User-agent: *\nAllow: /\n');
        return;
      }
      const pages = new Map([
        ['/', testHtmlPage('\u4e2d\u6587\u5206\u7c7b\u9996\u9875', `
          <main>
            <nav>
              <a href="/category/xuanhuan">${fantasy}</a>
              <a href="/category/dushi">${city}</a>
              <a href="/rank/hot">${ranking}</a>
            </nav>
            <section><a href="/book/one">${workOne}</a></section>
          </main>
        `)],
        ['/category/xuanhuan', testHtmlPage(`${fantasy}\u5206\u7c7b`, `<main><a href="/book/one">${workOne}</a></main>`)],
        ['/category/dushi', testHtmlPage(`${city}\u5206\u7c7b`, `<main><a href="/book/two">${workTwo}</a></main>`)],
        ['/rank/hot', testHtmlPage(ranking, `<main><a href="/book/one">${workOne}</a></main>`)],
        ['/book/one', testHtmlPage(workOne, '<main>\u4f5c\u54c1\u8be6\u60c5</main>')],
        ['/book/two', testHtmlPage(workTwo, '<main>\u4f5c\u54c1\u8be6\u60c5</main>')],
      ]);
      const body = pages.get(requestUrl.pathname);
      if (!body) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('not found');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(body);
    }, async (rootUrl) => {
      const siteUrl = rootUrl.replace('127.0.0.1', 'localhost');
      const result = await runSiteForgeBuild(siteUrl, {
        cwd: workspace,
        buildId: 'chinese-category-capabilities-build',
        now: new Date('2026-05-16T02:30:00.000Z'),
        maxDepth: 1,
        maxPages: 8,
        maxSeeds: 8,
        fetchDelayMs: 0,
      });
      assert.equal(result.status, 'success');
      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      const activeCapabilities = capabilities.capabilities.filter((capability) => capability.status === 'active');
      const userValues = new Set(activeCapabilities.map((capability) => capability.userValue));
      assert.equal(userValues.has(`\u6d4f\u89c8${fantasy}`), true);
      assert.equal(userValues.has(`\u6d4f\u89c8${city}`), true);
      const categoryCapabilities = activeCapabilities.filter((capability) => capability.elementRole === 'category');
      assert.equal(categoryCapabilities.some((capability) => capability.object === fantasy), true);
      assert.equal(categoryCapabilities.some((capability) => capability.object === city), true);
      assert.equal(new Set(categoryCapabilities.map((capability) => capability.id)).size, categoryCapabilities.length);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('SiteForge full-coverage catalog build generates capabilities from categories, tags, profiles, detail, and ranking routes', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-full-catalog-'));
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'siteforge-full-catalog-fixture-'));
  try {
    await mkdir(path.join(fixtureDir, 'categories', 'action'), { recursive: true });
    await mkdir(path.join(fixtureDir, 'tags', 'popular'), { recursive: true });
    await mkdir(path.join(fixtureDir, 'models', 'aya'), { recursive: true });
    await mkdir(path.join(fixtureDir, 'videos', 'abc-001'), { recursive: true });
    await mkdir(path.join(fixtureDir, 'videos', 'abc-002'), { recursive: true });
    await mkdir(path.join(fixtureDir, 'hot'), { recursive: true });
    await mkdir(path.join(fixtureDir, 'latest-updates'), { recursive: true });
    await mkdir(path.join(fixtureDir, 'pay'), { recursive: true });
    await mkdir(path.join(fixtureDir, 'page', '2'), { recursive: true });
    await writeFile(path.join(fixtureDir, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n', 'utf8');
    await writeFile(path.join(fixtureDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset>
  <url><loc>https://catalog-fixture.local/</loc></url>
  <url><loc>https://catalog-fixture.local/categories/</loc></url>
  <url><loc>https://catalog-fixture.local/categories/action/</loc></url>
  <url><loc>https://catalog-fixture.local/tags/popular/</loc></url>
  <url><loc>https://catalog-fixture.local/models/</loc></url>
  <url><loc>https://catalog-fixture.local/models/aya/</loc></url>
  <url><loc>https://catalog-fixture.local/hot/</loc></url>
  <url><loc>https://catalog-fixture.local/latest-updates/</loc></url>
  <url><loc>https://catalog-fixture.local/pay/</loc></url>
  <url><loc>https://catalog-fixture.local/videos/abc-001/</loc></url>
  <url><loc>https://catalog-fixture.local/videos/abc-002/</loc></url>
  <url><loc>https://catalog-fixture.local/page/2/</loc></url>
</urlset>
`, 'utf8');
    const page = (title, links = '') => `<!doctype html>
<html>
  <head><title>${title}</title></head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>Public catalog fixture page used for full route coverage without saving raw body text.</p>
      ${links}
    </main>
  </body>
</html>
`;
    const homeLinks = [
      '<a href="/categories/">Categories</a>',
      '<a href="/categories/action/">Action category</a>',
      '<a href="/tags/popular/">Popular tag</a>',
      '<a href="/models/">Models</a>',
      '<a href="/models/aya/">Model Aya</a>',
      '<a href="/hot/">Hot ranking</a>',
      '<a href="/latest-updates/">Latest updates</a>',
      '<a href="/pay/">Pay center</a>',
      '<a href="/videos/abc-001/">Video ABC-001</a>',
      '<a href="/videos/abc-002/">Video ABC-002</a>',
      '<a href="/page/2/">Page 2</a>',
      '<form method="GET" action="/search/"><input name="q" type="search"><button type="submit">Search</button></form>',
    ].join('\n      ');
    await writeFile(path.join(fixtureDir, 'index.html'), page('Catalog fixture home', homeLinks), 'utf8');
    await writeFile(path.join(fixtureDir, 'categories', 'index.html'), page('Categories index', '<a href="/categories/action/">Action category</a>'), 'utf8');
    await writeFile(path.join(fixtureDir, 'categories', 'action', 'index.html'), page('Action category listing', '<a href="/videos/abc-001/">Video ABC-001</a>'), 'utf8');
    await writeFile(path.join(fixtureDir, 'tags', 'popular', 'index.html'), page('Popular tag listing', '<a href="/videos/abc-002/">Video ABC-002</a>'), 'utf8');
    await writeFile(path.join(fixtureDir, 'models', 'index.html'), page('Models index', '<a href="/models/aya/">Model Aya</a>'), 'utf8');
    await writeFile(path.join(fixtureDir, 'models', 'aya', 'index.html'), page('Model Aya profile', '<a href="/videos/abc-001/">Video ABC-001</a>'), 'utf8');
    await writeFile(path.join(fixtureDir, 'hot', 'index.html'), page('Hot ranking', '<a href="/videos/abc-001/">Video ABC-001</a>'), 'utf8');
    await writeFile(path.join(fixtureDir, 'latest-updates', 'index.html'), page('Latest updates', '<a href="/videos/abc-002/">Video ABC-002</a>'), 'utf8');
    await writeFile(path.join(fixtureDir, 'pay', 'index.html'), page('Pay center', '<button>Pay now</button>'), 'utf8');
    await writeFile(path.join(fixtureDir, 'videos', 'abc-001', 'index.html'), page('Video ABC-001 detail'), 'utf8');
    await writeFile(path.join(fixtureDir, 'videos', 'abc-002', 'index.html'), page('Video ABC-002 detail'), 'utf8');
    await writeFile(path.join(fixtureDir, 'page', '2', 'index.html'), page('Catalog page 2', '<a href="/videos/abc-002/">Video ABC-002</a>'), 'utf8');

    await withDirectorySite(fixtureDir, async (rootUrl) => {
    const result = await runSiteForgeBuild(rootUrl, {
      cwd: workspace,
      buildId: 'full-catalog-build',
      now: new Date('2026-05-17T11:00:00.000Z'),
      fetchDelayMs: 0,
      setupProfile: {
        knownSitePolicy: {
          siteKey: 'catalog-fixture',
          adapterId: 'generic-navigation',
          primaryArchetype: 'catalog-detail',
          pageTypes: ['category-page', 'tag-page', 'author-page', 'content-detail-page', 'search-results-page'],
          capabilityFamilies: ['navigate-to-category', 'navigate-to-author', 'navigate-to-content', 'search-content', 'download-content'],
          downloader: { reasonCode: 'fixture-native-resolver-required' },
        },
      },
    });

    assert.equal(result.status, 'success');
    const graph = await readJson(path.join(result.artifactDir, 'classified_graph.json'));
    const classifications = new Set(graph.nodes.map((node) => node.classification).filter(Boolean));
    for (const expected of ['catalog_category', 'catalog_tag', 'catalog_author', 'catalog_collection', 'catalog_detail', 'catalog_pagination']) {
      assert.equal(classifications.has(expected), true, `${expected} should be classified for full catalog coverage`);
    }

    const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
    const names = new Set(capabilities.capabilities.map((capability) => capability.name));
    for (const expected of [
      'browse catalog collections',
      'browse catalog categories',
      'browse catalog tags',
      'browse catalog rankings',
      'open catalog detail',
      'open catalog author profile',
      'browse catalog pagination',
      'read public catalog metadata',
      'search catalog content',
      'download catalog content',
    ]) {
      assert.equal(names.has(expected), true, `${expected} should be generated for full catalog coverage`);
    }
    assert.equal(capabilities.capabilities.filter((capability) => capability.status === 'active').length >= 9, true);
    const downloadCapability = capabilities.capabilities.find((capability) => capability.name === 'download catalog content');
    assert.equal(downloadCapability?.status, 'disabled');
    assert.equal(downloadCapability?.activationBlockedReason, 'fixture-native-resolver-required');
    assert.equal(downloadCapability?.risk_level, 'download_high');
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const capabilityName of ['browse public collections', 'browse public rankings', 'read public metadata']) {
      const capability = capabilities.capabilities.find((candidate) => candidate.name === capabilityName);
      const evidenceRoutes = [...(capability?.entryNodeIds ?? []), ...(capability?.requiredNodeIds ?? [])]
        .map((id) => nodeById.get(id))
        .map((node) => `${node?.normalizedUrl ?? ''} ${node?.routePattern ?? ''} ${node?.routeTemplate ?? ''}`);
      assert.equal(evidenceRoutes.some((route) => /\/pay(?:\/|$)/u.test(route)), false, `${capabilityName} should not use payment routes as catalog evidence`);
    }

    const intents = await readJson(path.join(result.artifactDir, 'intents.json'));
    assert.equal(capabilities.capabilities.length >= 10, true);
    assert.equal(intents.intents.length >= 24, true);
    assert.equal(intents.intents.some((intent) => /\p{Script=Han}/u.test(intent.canonicalUtterance)), true);
    const publicNavigationCapability = capabilities.capabilities.find((capability) => capability.name === 'browse public navigation');
    assert.equal(intents.intents.some((intent) => (
      intent.capabilityId === publicNavigationCapability?.id
      && /\p{Script=Han}/u.test(intent.canonicalUtterance)
    )), true);

    const pageReconciliation = await readJson(path.join(result.artifactDir, 'page_reconciliation_report.json'));
    assert.equal(pageReconciliation.status, 'passed');
    assert.equal(pageReconciliation.summary.expectedCategoryLinks >= 2, true);
    assert.equal(pageReconciliation.summary.missingCategoryLinks, 0);
    assert.equal(pageReconciliation.summary.categoryCapabilities >= 1, true);
    assert.equal(pageReconciliation.summary.categoryIntents >= 1, true);
    assert.equal(pageReconciliation.categoryCapabilities.some((capability) => capability.hasChineseName), true);
    assert.equal(pageReconciliation.categoryIntents.some((intent) => intent.hasChineseUtterance), true);
    assert.equal(pageReconciliation.safety.cookiePersisted, false);
    const indexedBuildReport = await readJson(path.join(result.artifactDir, 'build_report.json'));
    const userReport = await readJson(path.join(result.artifactDir, 'build_report.user.json'));
    assert.equal(indexedBuildReport.report_index.available_reports.includes('page_reconciliation_report'), true);
    assert.match(indexedBuildReport.reports.page_reconciliation_report, /page_reconciliation_report\.json$/u);
    assert.match(userReport.reports.page_reconciliation_report, /page_reconciliation_report\.json$/u);

    const generatedAdapter = await readJson(path.join(result.artifactDir, 'generated_adapter.json'));
    assert.equal(generatedAdapter.adapterKind, 'site_dedicated_generated_profile');
    assert.notEqual(generatedAdapter.adapterId, 'generic-navigation');
    assert.equal(generatedAdapter.adapterId, `${result.buildContext.siteId}-site-adapter`);
    assert.equal(generatedAdapter.sourceAdapterId, 'generic-navigation');
    assert.equal(generatedAdapter.sourceSiteKey, 'catalog-fixture');
    assert.equal(generatedAdapter.siteId, result.buildContext.siteId);
    assert.equal(generatedAdapter.contractVersion, 1);
    assert.equal(generatedAdapter.contract.kind, 'site_adapter_contract');
    assert.equal(generatedAdapter.contract.safetyRules.highRiskAutoExecuteAllowed, false);
    assert.equal(generatedAdapter.routeSeedPlan.totalSeeds >= 10, true);
    assert.equal(generatedAdapter.capabilityTemplate.effective.includes('search-content'), true);

    const siteAdapterPath = path.join(result.buildContext.siteDir, 'adapter', 'generated_adapter.json');
    assert.equal(await fileExists(siteAdapterPath), true);
    const siteAdapterTestsPath = path.join(result.buildContext.siteDir, 'adapter', 'tests', 'contract_tests.json');
    assert.equal(await fileExists(siteAdapterTestsPath), true);
    const currentAdapterPath = path.join(result.buildContext.siteDir, 'current', 'generated_adapter.json');
    assert.equal(await fileExists(currentAdapterPath), true);
    const currentAdapterTestsPath = path.join(result.buildContext.siteDir, 'current', 'adapter_contract_tests.json');
    assert.equal(await fileExists(currentAdapterTestsPath), true);
    const adapterTests = await readJson(path.join(result.artifactDir, 'adapter_contract_tests.json'));
    assert.equal(adapterTests.summary.failed, 0);
    assert.equal(adapterTests.summary.passed, adapterTests.summary.total);
    const crawlCheckpoint = await readJson(path.join(result.artifactDir, 'crawl_checkpoint.json'));
    assert.equal(crawlCheckpoint.adapterId, `${result.buildContext.siteId}-site-adapter`);
    assert.equal(crawlCheckpoint.resume.supported, true);
    assert.equal(crawlCheckpoint.privacy.rawDomSaved, false);

    const buildReport = await readJson(path.join(result.artifactDir, 'build_report.json'));
    assert.equal(buildReport.pageReconciliation.summary.status, 'passed');
    assert.match(buildReport.artifacts['page_reconciliation_report.json'], /page_reconciliation_report\.json$/u);
    assert.equal(buildReport.siteAdapter.adapter_id, `${result.buildContext.siteId}-site-adapter`);
    assert.equal(buildReport.siteAdapter.source_adapter_id, 'generic-navigation');
    assert.equal(buildReport.user_report.site_adapter.adapter_id, `${result.buildContext.siteId}-site-adapter`);
    assert.equal(buildReport.user_report.site_adapter.source_adapter_id, undefined);
    assert.equal(buildReport.debug_report_summary.capability_count >= 10, true);
    const debugReport = await readJson(path.join(result.artifactDir, 'build_report.debug.json'));
    assert.equal(debugReport.site_adapter_profile.adapterKind, 'site_dedicated_generated_profile');
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test('SiteForge full-coverage crawl uses route-family representatives for very large seed inventories', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-large-catalog-'));
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'siteforge-large-catalog-fixture-'));
  try {
    const rootUrl = 'https://large-catalog.local/';
    const page = (title, links = '') => `<!doctype html>
<html>
  <head><title>${title}</title></head>
  <body>
    <h1>${title}</h1>
    <p>Public catalog coverage fixture with route-family representatives.</p>
    ${links}
  </body>
</html>
`;
    const routes = [
      '/',
      '/hot/',
      '/latest-updates/',
      ...Array.from({ length: 24 }, (_, index) => `/categories/category-${index + 1}/`),
      ...Array.from({ length: 24 }, (_, index) => `/tags/tag-${index + 1}/`),
      ...Array.from({ length: 640 }, (_, index) => `/models/model-${String(index + 1).padStart(4, '0')}/`),
      ...Array.from({ length: 160 }, (_, index) => `/videos/video-${String(index + 1).padStart(4, '0')}/`),
    ];
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(path.join(fixtureDir, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n', 'utf8');
    await writeFile(path.join(fixtureDir, 'sitemap.xml'), [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset>',
      ...routes.map((routePath) => `  <url><loc>${new URL(routePath, rootUrl)}</loc></url>`),
      '</urlset>',
    ].join('\n'), 'utf8');
    for (const routePath of routes) {
      const segments = routePath.split('/').filter(Boolean);
      const dir = segments.length ? path.join(fixtureDir, ...segments) : fixtureDir;
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'index.html'),
        page(
          routePath === '/' ? 'Large catalog home' : `Large catalog ${routePath}`,
          [
            '<a href="/hot/">Hot ranking</a>',
            '<a href="/latest-updates/">Latest updates</a>',
            '<a href="/categories/category-1/">Category 1</a>',
            '<a href="/tags/tag-1/">Tag 1</a>',
            '<a href="/models/model-0001/">Model 1</a>',
            '<a href="/videos/video-0001/">Video 1</a>',
          ].join('\n    '),
        ),
        'utf8',
      );
    }

    await withDirectorySite(fixtureDir, async (liveRootUrl) => {
    const result = await runSiteForgeBuild(liveRootUrl, {
      cwd: workspace,
      buildId: 'large-catalog-representative-build',
      now: new Date('2026-05-17T12:30:00.000Z'),
      maxDepth: 8,
      maxPages: 80,
      maxSeeds: 900,
      fetchDelayMs: 0,
      setupProfile: {
        knownSitePolicy: {
          siteKey: 'large-catalog',
          adapterId: 'generic-navigation',
          primaryArchetype: 'catalog-detail',
          pageTypes: ['category-page', 'tag-page', 'author-page', 'content-detail-page'],
          capabilityFamilies: ['navigate-to-category', 'navigate-to-author', 'navigate-to-content', 'search-content'],
        },
      },
    });

    assert.equal(result.status, 'success');
    const seeds = await readJson(path.join(result.artifactDir, 'seeds.json'));
    assert.equal(seeds.seeds.length > 500, true);
    const crawlStatic = await readJson(path.join(result.artifactDir, 'crawl_static.json'));
    assert.equal(crawlStatic.summary.representativeCoverageMode, 'route_family');
    assert.equal(crawlStatic.summary.seedInventoryUrls, seeds.seeds.length);
    assert.equal(crawlStatic.summary.representativeSeedUrls < seeds.seeds.length, true);
    assert.equal(crawlStatic.summary.fetchedUrls <= crawlStatic.summary.representativeSeedUrls, true);
    assert.equal(crawlStatic.warnings.some((warning) => warning.includes('route-family representatives')), true);

    const graph = await readJson(path.join(result.artifactDir, 'classified_graph.json'));
    const classifications = new Set(graph.nodes.map((node) => node.classification).filter(Boolean));
    for (const expected of ['catalog_category', 'catalog_tag', 'catalog_author', 'catalog_detail']) {
      assert.equal(classifications.has(expected), true, `${expected} should be represented after route-family crawl planning`);
    }
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test('SiteForge build safety validation rejects mislabeled high-risk auto-execution', () => {
  const errors = validateCapabilitySafetyForVerification({
    id: 'capability:news-qq:submit-comment',
    status: 'active',
    name: 'submit comment',
    action: 'submit',
    object: 'comment',
    safetyLevel: 'read_only',
    executionPlan: {
      id: 'plan:news-qq:submit-comment',
      mode: 'read_only',
      autoExecute: true,
      dryRunOnly: false,
      requiresConfirmation: false,
    },
  });
  assert.equal(errors.some((error) => /lacks dry-run or confirmation/u.test(error)), true);
  assert.equal(errors.some((error) => /unsafe auto-execution/u.test(error)), true);
});

test('capability intent HTML report escapes markup and redacts sensitive report values', () => {
  const html = renderCapabilityIntentSummaryHtml({
    meta: {
      title: 'SiteForge Build Summary',
      siteUrl: 'https://fixture.local/?token=synthetic-secret',
      siteId: 'fixture.local-25369277',
      buildId: 'escape-build',
      skillId: 'simple-shop',
      crawlMode: 'public_only',
      authMethod: 'none',
      authVerificationStatus: 'not_requested',
      resultStatus: 'success',
      legacyStatus: 'success',
      verificationStatus: 'passed',
      generatedAt: '2026-05-21T10:00:00.000Z',
      completedAt: '2026-05-21T10:00:01.000Z',
      paths: {
        htmlReport: '.siteforge/sites/fixture.local-25369277/builds/escape-build/reports/capability_intent_summary.html',
      },
    },
    coverage: {
      public: { pages: 1, nodes: 1, capabilities: 1 },
      authenticated: { pages: 0, nodes: 0, capabilities: 0 },
      overlay: { pagesRevisited: 0, newNodes: 0, newAffordances: 0 },
      requiresLoginButMissing: [],
      blockedByRisk: [],
      blockedByAuth: [],
    },
    counts: { capabilities: 1, intents: 1, nodes: 1, riskBlocked: 0 },
    capabilities: [{
      id: 'capability:test:escape',
      name: '<script>alert(1)</script>',
      userValue: 'A & B "quote" \'apostrophe\'',
      action: 'view',
      object: 'report',
      status: 'active',
      enabledStatus: 'enabled',
      evidenceStatus: 'verified',
      riskLevel: 'read_public_low',
      safetyLevel: 'read_only',
      authRequired: false,
      sourceLayer: 'public',
      activationDecision: 'active',
      reason: 'Authorization: Bearer synthetic-secret cookie=sessionid=synthetic-secret token=synthetic-secret /Users/example/profile raw html <html>',
      strategy: 'enabled',
      mappedIntentCount: 1,
      group: 'enabled',
      evidenceMatrix: {
        requiredEvidence: ['A & B', '"quote"', '\'apostrophe\''],
        observedEvidence: ['<script>alert(1)</script>'],
        missingEvidence: ['token=synthetic-secret'],
        activationDecision: 'active',
      },
    }],
    intents: [{
      id: 'intent:test:escape',
      capabilityId: 'capability:test:escape',
      capabilityName: '<script>alert(1)</script>',
      canonicalUtterance: 'A & B "quote" \'apostrophe\' <script>alert(1)</script>',
      callable: 'callable',
      safetyLevel: 'read_only',
      enabledStatus: 'enabled',
      utteranceExamples: ['A & B', '"quote"', '\'apostrophe\''],
      negativeExamples: ['Authorization: Bearer synthetic-secret'],
      reason: 'safe',
    }],
    mappings: [{
      capabilityName: '<script>alert(1)</script>',
      capabilityId: 'capability:test:escape',
      capabilityStatus: 'active',
      enabledStatus: 'enabled',
      intentCount: 1,
      canonicalUtterances: ['A & B "quote" \'apostrophe\' <script>alert(1)</script>'],
      callable: 1,
      nonCallable: 0,
      riskLevel: 'read_public_low',
      authVerificationStatus: 'not_requested',
    }],
    blocked: {
      disabledHighRisk: [],
      blockedByAuth: [],
      requiresLogin: [],
      missingEvidence: [],
      candidateOnly: [],
    },
  });

  assert.match(html, /<html lang="zh-CN">/u);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/u);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.match(html, /A &amp; B/u);
  assert.match(html, /&quot;quote&quot;/u);
  assert.match(html, /&#39;apostrophe&#39;/u);
  assert.doesNotMatch(html, /synthetic-secret|Authorization|Bearer|cookie\s*=|token\s*=|sid=|uid=|\/Users\/example\/profile|raw html|&lt;html&gt;/iu);
});

test('ArtifactStore confines structured artifact writes to the active site build workspace', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-artifact-store-'));
  try {
    const site = { id: 'site-a' };
    const buildId = 'build-a';
    const siteWorkspace = createSiteWorkspace({
      cwd: workspace,
      site,
      buildId,
      startedAt: '2026-05-16T00:00:00.000Z',
    });
    const context = {
      cwd: workspace,
      site,
      buildId,
      workspace: siteWorkspace,
      artifactDir: siteWorkspace.paths.buildDir,
      skillDir: siteWorkspace.paths.buildSkillDir,
    };

    const jsonPath = await writeArtifactJson(context, 'custom/result.json', { status: 'ok' });
    const yamlPath = await writeArtifactYaml(context, 'custom/result.yaml', {
      status: 'ok',
      nested: { count: 1 },
    });

    assert.equal(jsonPath, path.join(workspace, '.siteforge', 'sites', 'site-a', 'builds', 'build-a', 'custom', 'result.json'));
    assert.deepEqual(await readArtifactJson(context, 'custom/result.json'), { status: 'ok' });
    assert.match(await readArtifactYaml(context, 'custom/result.yaml'), /status: ok/u);
    assert.equal(yamlPath.endsWith(path.join('custom', 'result.yaml')), true);

    await assert.rejects(
      () => writeArtifactJson(context, '../site-b/builds/build-a/escape.json', { status: 'bad' }),
      /traversal|must not contain/u,
    );
    await assert.rejects(
      () => writeArtifactJson(context, path.resolve(workspace, 'escape.json'), { status: 'bad' }),
      /must be relative/u,
    );
    await assert.rejects(
      () => writeArtifactJson({
        ...context,
        artifactDir: path.join(workspace, '.siteforge', 'sites', 'site-b', 'builds', 'build-a'),
      }, 'escape.json', { status: 'bad' }),
      /artifactDir must match/u,
    );
    const siteBWorkspace = createSiteWorkspace({
      cwd: workspace,
      site: { id: 'site-b' },
      buildId,
      startedAt: '2026-05-16T00:00:00.000Z',
    });
    await assert.rejects(
      () => writeArtifactJson({
        ...context,
        workspace: siteBWorkspace,
        artifactDir: siteBWorkspace.paths.buildDir,
        skillDir: siteBWorkspace.paths.buildSkillDir,
      }, 'cross-site.json', { status: 'bad' }),
      /Site workspace must match/u,
    );
    assert.equal(await fileExists(path.join(workspace, '.siteforge', 'sites', 'site-b', 'builds', 'build-a', 'escape.json')), false);
    assert.equal(await fileExists(path.join(workspace, '.siteforge', 'sites', 'site-b', 'builds', 'build-a', 'cross-site.json')), false);
    assert.equal(await fileExists(path.join(workspace, 'escape.json')), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runSiteForgeBuild compiles a local HTTP simple-shop site end-to-end', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-live-http-'));
  try {
    await withTestSite(simpleShopRoutes, async (rootUrl) => {
    const result = await runSiteForgeBuild(rootUrl, {
      cwd: workspace,
      buildId: 'simple-shop-build',
      now: new Date('2026-05-16T00:00:00.000Z'),
      fetchDelayMs: 0,
    });

    assert.equal(result.status, 'success');
    assert.equal(result.siteId, stableSiteIdFromUrl(rootUrl));
    assert.equal(result.skillId, 'simple-shop');
    assert.equal(result.summary.activeCapabilities >= 1, true);
    assert.equal(result.summary.intents >= 1, true);
    assert.equal(result.summary.verificationStatus, 'passed');
    assert.equal(result.summary.registryStatus, 'registered');

    await assertArtifactsExist(result.artifactDir, ['crawl_static.json', ...REQUIRED_BUILD_ARTIFACTS]);

    const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
    const activeCapabilities = capabilities.capabilities.filter((capability) => capability.status === 'active');
    assert.equal(activeCapabilities.every((capability) => capability.evidence.length > 0), true);
    assert.deepEqual(
      capabilities.capabilities
        .map((capability) => capability.name)
        .filter((name) => /follow|timeline|profile content|search posts/iu.test(name)),
      [],
    );
    const contact = activeCapabilities.find((capability) => capability.name === 'contact support');
    assert.equal(contact.safetyLevel, 'requires_confirmation');
    assert.equal(contact.executionPlan.dryRunOnly, true);
    assert.equal(contact.executionPlan.autoExecute, false);

    const intents = await readJson(path.join(result.artifactDir, 'intents.json'));
    const capabilityIds = new Set(capabilities.capabilities.map((capability) => capability.id));
    assert.equal(intents.intents.every((intent) => (
      capabilityIds.has(intent.capabilityId)
      || (
        intent.intentSource === 'graph_element'
        && intent.callable === false
        && intent.sourceNodeId
      )
    )), true);

    const htmlReportPath = path.join(result.artifactDir, 'reports', 'capability_intent_summary.html');
    const htmlReport = await readFile(htmlReportPath, 'utf8');
    assert.equal(result.artifacts['capability_intent_summary.html'], htmlReportPath);
    assert.match(htmlReport, /<html lang="zh-CN">/u);
    assert.match(htmlReport, /<style>/u);
    assert.match(htmlReport, /summary-card/u);
    assert.match(htmlReport, /badge/u);
    assert.match(htmlReport, /table-wrapper/u);
    assert.match(htmlReport, /\u80fd\u529b\u6c47\u603b/u);
    assert.match(htmlReport, /\u610f\u56fe\u6c47\u603b/u);
    assert.match(htmlReport, /Capability -&gt; Intents|Capability -> Intents/u);
    assert.match(htmlReport, /search products/u);
    assert.match(htmlReport, /search for wireless headphones/u);
    assert.match(htmlReport, /simple-shop-build/u);
    assert.match(htmlReport, /simple-shop/u);
    assert.match(htmlReport, /public_only/u);
    assert.match(htmlReport, /authenticated pages<\/td><td>0/u);
    assert.doesNotMatch(htmlReport, /cookie\s*=|token\s*=|sid=|uid=|\bauthorization\b|\bbearer\b|localStorage|sessionStorage|userDataDir|browser profile|<script\b/iu);

    const lookup = await lookupSkillIntent({
      registryPath: result.workspace.registryPath,
      domain: new URL(rootUrl).hostname,
      utterance: 'search for wireless headphones',
    });
    assert.equal(lookup.status, 'found');
    assert.equal(lookup.skillId, 'simple-shop');
    // @ts-ignore
    assert.equal(lookup.intentName, 'search products');
    // @ts-ignore
    assert.equal(lookup.capabilityName, 'search products');

    const registry = await readJson(result.workspace.registryPath);
    const registeredCapabilityNames = registry.skills.flatMap((skill) => (
      skill.intents ?? []
    ).map((intent) => intent.capabilityName));
    assert.equal(registeredCapabilityNames.some((name) => /follow|timeline|profile content|search posts/iu.test(name)), false);

    const siteRoot = siteWorkspaceDir(workspace, rootUrl);
    assert.equal(result.workspace.siteDir, siteRoot);
    await assertArtifactsExist(siteRoot, [
      'site.json',
      'registry.json',
      'last_successful_build.json',
      path.join('setup', 'setup_plan.json'),
      path.join('setup', 'user_choices.json'),
      path.join('setup', 'capability_hints.json'),
      path.join('setup', 'build_profile.json'),
      path.join('current', 'skill.yaml'),
      path.join('current', 'capabilities.json'),
      path.join('current', 'intents.json'),
      path.join('current', 'execution_plans.json'),
      path.join('current', 'safety_policy.json'),
      path.join('current', 'verification_report.json'),
      path.join('builds', 'simple-shop-build', 'inputs', 'site.json'),
      path.join('builds', 'simple-shop-build', 'discovery', 'seeds.json'),
      path.join('builds', 'simple-shop-build', 'graph', 'graph.json'),
      path.join('builds', 'simple-shop-build', 'capabilities', 'capabilities.json'),
      path.join('builds', 'simple-shop-build', 'intents', 'intents.json'),
      path.join('builds', 'simple-shop-build', 'skill', 'skill.yaml'),
      path.join('builds', 'simple-shop-build', 'verification', 'verification_report.json'),
      path.join('builds', 'simple-shop-build', 'reports', 'build_report.json'),
      path.join('builds', 'simple-shop-build', 'reports', 'capability_intent_summary.html'),
      path.join('builds', 'simple-shop-build', 'reports', 'raw_page_material_manifest.json'),
    ]);
    const lastSuccessful = await readJson(path.join(siteRoot, 'last_successful_build.json'));
    assert.equal(lastSuccessful.buildId, 'simple-shop-build');
    assert.equal(result.skillDir, path.join(siteRoot, 'current'));

    const buildReport = await readJson(path.join(result.artifactDir, 'build_report.json'));
    assert.equal(buildReport.reports.user.html_capability_intent_summary, htmlReportPath);
    assert.equal(buildReport.reports.capability_intent_summary_html, htmlReportPath);
    assert.match(buildReport.reports.raw_page_material_manifest, /raw_page_material_manifest\.json$/u);
    assert.equal(buildReport.report_index.capability_intent_summary_html, 'reports/capability_intent_summary.html');
    assert.equal(buildReport.report_index.raw_page_material_manifest, 'reports/raw_page_material_manifest.json');
    assert.equal(buildReport.user_report.reports.capability_intent_summary_html.endsWith('reports/capability_intent_summary.html'), true);
    assert.equal(buildReport.user_report.reports.raw_page_material_manifest.endsWith('reports/raw_page_material_manifest.json'), true);
    assert.equal(buildReport.user_report.page_source_saved, true);
    assert.equal(buildReport.user_report.private_content_saved, false);
    assert.match(renderSiteForgeBuildSummary(result, { cwd: workspace }), /capability_intent_summary\.html/u);
    const cliJson = JSON.parse(siteForgeBuildCliJson(result, { report: 'user' }));
    assert.equal(cliJson.reports.capability_intent_summary_html.endsWith('reports/capability_intent_summary.html'), true);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runSiteForgeBuild maps generic public repository sites without product, news, or book drift', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-repository-site-'));
  try {
    await withTestSite((rootUrl) => ({
      '/robots.txt': {
        contentType: 'text/plain; charset=utf-8',
        body: testRobotsTxt(rootUrl),
      },
      '/sitemap.xml': {
        contentType: 'application/xml; charset=utf-8',
        body: testSitemapXml(rootUrl, ['/', '/repositories', '/search', '/open-source/toolkit']),
      },
      '/': testHtmlPage('Code Host', `
        <main>
          <h1>Code Host</h1>
          <nav>
            <a href="/repositories">Repositories</a>
            <a href="/topics/automation">Automation topic</a>
            <a href="/open-source/toolkit">Toolkit repository</a>
          </nav>
          <form method="GET" action="/search" role="search" aria-label="Search repositories">
            <input name="q" type="search" placeholder="Search repositories">
            <button type="submit">Search</button>
          </form>
        </main>
      `),
      '/repositories': testHtmlPage('Repositories', `
        <main>
          <h1>Repositories</h1>
          <ul class="repository-list">
            <li><a href="/open-source/toolkit">Toolkit repository</a></li>
            <li><a href="/open-source/runner">Runner repository</a></li>
            <li><a href="/open-source/actions">Actions repository</a></li>
          </ul>
        </main>
      `),
      '/search': testHtmlPage('Search repositories', `
        <main>
          <h1>Search repositories</h1>
          <form method="GET" action="/search" role="search" aria-label="Search repositories">
            <input name="q" type="search" placeholder="Repository keyword">
            <button type="submit">Search</button>
          </form>
        </main>
      `),
      '/open-source/toolkit': testHtmlPage('Toolkit repository', `
        <main>
          <h1>Toolkit repository</h1>
          <article class="repository-card">
            <p>Public source repository metadata and README summary.</p>
          </article>
        </main>
      `),
      '/open-source/runner': testHtmlPage('Runner repository', '<main><h1>Runner repository</h1></main>'),
      '/open-source/actions': testHtmlPage('Actions repository', '<main><h1>Actions repository</h1></main>'),
      '/topics/automation': testHtmlPage('Automation topic', '<main><h1>Automation topic</h1></main>'),
    }), async (rootUrl) => {
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'repository-site-build',
        now: new Date('2026-05-16T04:08:00.000Z'),
        fetchDelayMs: 0,
        maxPages: 20,
        maxSeeds: 20,
      });
      assert.equal(result.status, 'success');
      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      const activeNames = new Set(capabilities.capabilities
        .filter((capability) => capability.status === 'active')
        .map((capability) => capability.name));
      for (const expected of [
        'browse public repositories',
        'open public repository details',
        'search public content',
        'browse public navigation',
      ]) {
        assert.equal(activeNames.has(expected), true, `${expected} should be active for a generic repository site`);
      }
      for (const unexpected of ['search products', 'search books', 'view news homepage', 'browse news channels']) {
        assert.equal(activeNames.has(unexpected), false, `${unexpected} should not be inferred for a repository site`);
      }
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('SiteForge build preserves non-root input URL as a first-class public seed', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-input-path-seed-'));
  try {
    await withTestSite((rootUrl) => ({
      '/robots.txt': {
        contentType: 'text/plain; charset=utf-8',
        body: testRobotsTxt(rootUrl),
      },
      '/sitemap.xml': {
        contentType: 'application/xml; charset=utf-8',
        body: testSitemapXml(rootUrl, ['/']),
      },
      '/': testHtmlPage('Root Home', `
        <main>
          <h1>Root Home</h1>
          <p>The root page intentionally does not link to the top ranking page.</p>
        </main>
      `),
      '/top': testHtmlPage('Top Ranking', `
        <main>
          <h1>Top Ranking</h1>
          <ol class="ranking-list">
            <li><a href="/works/item-1">Ranked public work 1</a></li>
            <li><a href="/works/item-2">Ranked public work 2</a></li>
          </ol>
        </main>
      `),
      '/works/item-1': testHtmlPage('Ranked Work 1', '<main><h1>Ranked Work 1</h1></main>'),
      '/works/item-2': testHtmlPage('Ranked Work 2', '<main><h1>Ranked Work 2</h1></main>'),
    }), async (rootUrl) => {
      const inputUrl = new URL('/top', rootUrl).toString();
      const result = await runSiteForgeBuild(inputUrl, {
        cwd: workspace,
        buildId: 'input-path-seed-build',
        now: new Date('2026-05-23T07:10:00.000Z'),
        fetchDelayMs: 0,
        maxDepth: 2,
        maxPages: 10,
        maxSeeds: 10,
      });
      assert.equal(result.status, 'success');
      const seeds = await readJson(path.join(result.artifactDir, 'seeds.json'));
      const crawlStatic = await readJson(path.join(result.artifactDir, 'crawl_static.json'));
      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      const topUrl = normalizeUrl(inputUrl);
      assert.equal(seeds.seeds.some((seed) => seed.normalizedUrl === topUrl && seed.source === 'input_path'), true);
      assert.equal(crawlStatic.pages.some((page) => page.normalizedUrl === topUrl), true);
      assert.equal(capabilities.capabilities.some((capability) => (
        capability.status === 'active'
        && ['browse public rankings', 'browse public collections'].includes(capability.name)
      )), true);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('SiteForge setup uses non-root input page evidence when homepage is unavailable', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-input-page-setup-'));
  try {
    await withTestSite((rootUrl) => ({
      '/robots.txt': {
        contentType: 'text/plain; charset=utf-8',
        body: testRobotsTxt(rootUrl, { sitemap: false }),
      },
      '/': {
        status: 503,
        body: 'homepage temporarily unavailable',
      },
      '/top': testHtmlPage('Top Ranking', `
        <main>
          <h1>Top Ranking</h1>
          <ol class="ranking-list">
            <li><a href="/works/item-1">Ranked public work 1</a></li>
          </ol>
        </main>
      `),
      '/works/item-1': testHtmlPage('Ranked Work 1', '<main><h1>Ranked Work 1</h1></main>'),
    }), async (rootUrl) => {
      const inputUrl = new URL('/top', rootUrl).toString();
      const setup = await prepareSiteForgeBuildSetup(inputUrl, {
        cwd: workspace,
        buildId: 'input-page-setup',
        now: new Date('2026-05-23T08:20:00.000Z'),
        fetchDelayMs: 0,
        fetchTimeoutMs: 1000,
      });
      assert.equal(setup.setupPlan.buildReadiness.buildable, true);
      assert.equal(setup.setupPlan.evidenceQuality.actualPageEvidenceUrls.includes(normalizeUrl(inputUrl)), true);
      assert.equal(setup.setupPlan.sourceDiagnostics.some((entry) => entry.label === 'input page'), true);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('SiteForge setup first asks for authentication mode and records public_only when declined', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-public-only-setup-'));
  try {
    await withTestSite(simpleShopRoutes, async (rootUrl) => {
    const answers = ['1', 'public catalog'];
    const setup = await prepareSiteForgeBuildSetup(rootUrl, {
      cwd: workspace,
      buildId: 'public-only-setup',
      now: new Date('2026-05-21T08:00:00.000Z'),
      setupInteractive: true,
      interactive: true,
      fetchDelayMs: 0,
      setupPrompt: async () => answers.shift() ?? '',
      setupOutput: { write() {} },
    });
    assert.equal(setup.profile.crawlContract.crawlMode, 'public_only');
    assert.equal(setup.profile.crawlContract.authMethod, 'none');
    assert.equal(setup.profile.crawlContract.authVerificationStatus, 'not_requested');
    assert.equal(setup.profile.authStateReport.verified, false);
    assert.equal(setup.buildOptions.crawlContract.crawlMode, 'public_only');
    assert.equal(await fileExists(setup.paths.authStateReportPath), true);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('SiteForge setup uses explicit cookie auth only and falls back when cookie is missing', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-auth-failed-setup-'));
  try {
    await withTestSite(simpleShopRoutes, async (rootUrl) => {
    const opened = [];
    const setup = await prepareSiteForgeBuildSetup(rootUrl, {
      cwd: workspace,
      buildId: 'auth-failed-setup',
      now: new Date('2026-05-21T08:10:00.000Z'),
      authMode: 'cookie',
      fetchDelayMs: 0,
      setupOutput: { write() {} },
      defaultBrowserLauncher: async (url) => {
        opened.push(url);
        return { command: 'test-default-browser', args: [url] };
      },
    });
    assert.deepEqual(opened, []);
    assert.equal(setup.profile.crawlContract.crawlMode, 'public_only');
    assert.equal(setup.profile.crawlContract.authMethod, 'cookie');
    assert.equal(setup.profile.crawlContract.authVerificationStatus, 'cookie_missing');
    assert.equal(setup.profile.authStateReport.authMethod, 'cookie');
    assert.equal(setup.profile.authStateReport.authVerificationStatus, 'cookie_missing');
    assert.equal(setup.profile.authStateReport.verified, false);
    assert.equal(setup.profile.authStateReport.cookieMaterialPersisted, false);
    assert.equal(setup.profile.authStateReport.browserProfilePersisted, false);
    assert.equal(setup.profile.authStateReport.sessionMaterialPersisted, false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('SiteForge setup fails closed when configured cookie authentication fails', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-auth-strict-setup-'));
  try {
    await withTestSite((rootUrl) => ({
      ...simpleShopRoutes(rootUrl),
      '/account': {
        status: 403,
        body: 'Forbidden',
      },
    }), async (rootUrl) => {
      await assert.rejects(
        () => prepareSiteForgeBuildSetup(rootUrl, {
          cwd: workspace,
          buildId: 'auth-strict-setup',
          now: new Date('2026-05-21T08:12:00.000Z'),
          authMode: 'cookie',
          cookieHeader: 'sid=SECRET_SESSION_VALUE; uid=123',
          authCheckUrl: '/account',
          strictCookieAuth: true,
          fetchDelayMs: 0,
          setupOutput: { write() {} },
        }),
        (error) => {
          const setupError = /** @type {any} */ (error);
          assert.equal(setupError.code, 'setup-evidence-not-buildable');
          assert.equal(setupError.reasonCode, 'cookie_invalid');
          assert.doesNotMatch(String(setupError.message), /SECRET_SESSION_VALUE|sid=|uid=123/u);
          return true;
        },
      );
      const paths = buildSetupAssistantPaths(rootUrl, {
        cwd: workspace,
        buildId: 'auth-strict-setup',
        now: new Date('2026-05-21T08:12:00.000Z'),
      });
      const authReport = await readJson(paths.authStateReportPath);
      const setupPlan = await readJson(paths.setupPlanPath);
      assert.equal(authReport.authVerificationStatus, 'cookie_invalid');
      assert.equal(authReport.cookieInput.pairCount, 2);
      assert.equal(setupPlan.buildReadiness.buildable, false);
      assert.equal(setupPlan.buildReadiness.reasonCode, 'cookie_invalid');
      assert.doesNotMatch(JSON.stringify({ authReport, setupPlan }), /SECRET_SESSION_VALUE|sid=|uid=123/u);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('cookie auth state check gates authenticated layer without persisting cookie material', async () => {
  await withTestSite((rootUrl) => ({
    '/account': testHtmlPage('Account', '<main><ul><li>item</li></ul></main>'),
    '/security-check': testHtmlPage('Security check', '<main>Cloudflare challenge <input name="csrf-token" value="SECRET_SESSION_VALUE"></main>'),
    '/login': testHtmlPage('Login', '<form><input type="password"></form>'),
    '/redirect-login': {
      status: 302,
      headers: { location: '/login' },
      body: '',
    },
    '/forbidden': {
      status: 403,
      body: 'Forbidden',
    },
  }), async (rootUrl) => {
    const site = {
      id: 'cookie-auth-test',
      rootUrl,
      allowedDomains: [new URL(rootUrl).hostname],
    };

    const missing = await runCookieAuthStateCheck({
      inputUrl: rootUrl,
      site,
      options: { authMode: 'cookie', authCheckUrl: '/account' },
    });
    assert.equal(missing.authMethod, 'cookie');
    assert.equal(missing.authVerificationStatus, 'cookie_missing');
    assert.equal(missing.verified, false);
    assert.equal(canRunAuthenticatedLayer(missing), false);

    const verified = await runCookieAuthStateCheck({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'cookie',
        cookieHeader: 'sid=SECRET_SESSION_VALUE; uid=123',
        authCheckUrl: '/account',
        fetchTimeoutMs: 1000,
      },
    });
    assert.equal(verified.authMethod, 'cookie');
    assert.equal(verified.authVerificationStatus, 'cookie_verified');
    assert.equal(verified.verified, true);
    assert.equal(verified.crawlMode, 'authenticated_cookie');
    assert.equal(verified.cookieInput.pairCount, 2);
    assert.equal(verified.cookieInput.persisted, false);
    assert.equal(canRunAuthenticatedLayer(verified), true);
    assert.doesNotMatch(JSON.stringify(verified), /SECRET_SESSION_VALUE|sid=|uid=123/u);

    const redirected = await runCookieAuthStateCheck({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'cookie',
        cookieHeader: 'sid=SECRET_SESSION_VALUE; uid=123',
        authCheckUrl: '/redirect-login',
        fetchTimeoutMs: 1000,
      },
    });
    assert.equal(redirected.authVerificationStatus, 'cookie_invalid');
    assert.deepEqual(redirected.blockingSignals, ['redirected-to-login']);

    const forbidden = await runCookieAuthStateCheck({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'cookie',
        cookieHeader: 'sid=SECRET_SESSION_VALUE; uid=123',
        authCheckUrl: '/forbidden',
        fetchTimeoutMs: 1000,
      },
    });
    assert.equal(forbidden.authVerificationStatus, 'cookie_invalid');
    assert.deepEqual(forbidden.blockingSignals, ['http_403']);

    const crossSite = await runCookieAuthStateCheck({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'cookie',
        cookieHeader: 'sid=SECRET_SESSION_VALUE; uid=123',
        authCheckUrl: 'https://example.com/account',
        fetchTimeoutMs: 1000,
      },
    });
    assert.equal(crossSite.authVerificationStatus, 'cookie_blocked');
    assert.deepEqual(crossSite.blockingSignals, ['auth-check-url-cross-site']);

    const challenge = await runCookieAuthStateCheck({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'cookie',
        cookieHeader: 'sid=SECRET_SESSION_VALUE; uid=123',
        authCheckUrl: '/security-check',
        fetchTimeoutMs: 1000,
      },
    });
    assert.equal(challenge.authVerificationStatus, 'cookie_blocked');
    assert.deepEqual(challenge.blockingSignals, ['js-challenge-or-step-up-detected']);
    assert.equal(challenge.positiveSignals.includes('csrf-token-signal-redacted'), true);
    assert.doesNotMatch(JSON.stringify(challenge), /SECRET_SESSION_VALUE|sid=|uid=123/u);
  });
});

test('browser auth state check verifies bridge summaries without reading session material', async () => {
  await withTestServer({
    '/robots.txt': testRobotsTxt('http://example.test/'),
    '/': testHtmlPage('Home', '<main>Home</main>'),
  }, async (rootUrl) => {
    const site = {
      id: 'browser-auth-test',
      rootUrl,
      allowedDomains: [new URL(rootUrl).hostname],
    };

    const missing = await runBrowserAuthStateCheck({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        browserAuthBridgeProvider: async () => ({ authenticatedPages: [] }),
      },
    });
    assert.equal(missing.authMethod, 'browser');
    assert.equal(missing.authVerificationStatus, 'browser_bridge_missing');
    assert.equal(missing.verified, false);
    assert.equal(canRunAuthenticatedLayer(missing), false);

    const verified = await runBrowserAuthStateCheck({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        authCheckUrl: '/account',
        browserAuthBridgeProvider: async ({ targetUrl, routes }) => {
          assert.equal(routes.length, 1);
          return ({
          authenticatedPages: [{
            url: targetUrl,
            routeId: routes[0].id,
            routeTemplate: '/account',
            pageType: 'account_home',
            visibleItemCount: 5,
            listPresent: true,
            controls: [{ kind: 'button', label: 'Open notifications', selector: '[data-action="notifications"]' }],
          }],
          authenticatedOverlayPages: [{
            url: rootUrl,
            routeTemplate: '/',
            pageType: 'home_overlay',
            visibleItemCount: 2,
            listPresent: true,
          }],
          });
        },
      },
    });
    assert.equal(verified.authMethod, 'browser');
    assert.equal(verified.authVerificationStatus, 'browser_verified');
    assert.equal(verified.verified, true);
    assert.equal(verified.crawlMode, 'authenticated_browser');
    assert.equal(verified.browserBridge.used, true);
    assert.equal(verified.browserBridge.persisted, false);
    assert.equal(verified.browserBridge.routeCount, 1);
    assert.equal(verified.browserBridge.capturedRouteCount, 1);
    assert.equal(verified.browserBridge.missingRouteCount, 0);
    assert.equal(canRunAuthenticatedLayer(verified), true);
    assert.doesNotMatch(JSON.stringify(verified), /sid=SECRET_SESSION_VALUE|uid=123|Bearer synthetic-secret/iu);

    const blocked = await runBrowserAuthStateCheck({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        authCheckUrl: 'https://example.com/account',
        browserAuthBridgeProvider: async () => ({ authenticatedPages: [] }),
      },
    });
    assert.equal(blocked.authVerificationStatus, 'browser_blocked');
    assert.deepEqual(blocked.blockingSignals, ['browser-auth-url-cross-site']);
  });
});

test('SiteForge setup records partial browser route coverage without blocking captured routes', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-browser-strict-setup-'));
  try {
    await withTestSite(simpleShopRoutes, async (rootUrl) => {
      await prepareSiteForgeBuildSetup(rootUrl, {
        cwd: workspace,
        buildId: 'browser-strict-setup',
        now: new Date('2026-05-21T08:18:00.000Z'),
        authMode: 'browser',
        strictBrowserAuth: true,
        browserBridgeMaxRetryPasses: 0,
        fetchDelayMs: 0,
        setupOutput: { write() {} },
        localBuildConfig: {
          authRoutes: ['/notifications', '/account'],
          publicRevisitRoutes: ['/'],
        },
      browserAuthBridgeProvider: async ({ routes }) => ({
          authenticatedPages: [{
            routeId: routes[0].id,
            url: routes[0].targetUrl,
            routeTemplate: '/notifications',
            pageType: 'notifications',
            visibleItemCount: 1,
            listPresent: true,
          }],
        }),
      });
      const paths = buildSetupAssistantPaths(rootUrl, {
        cwd: workspace,
        buildId: 'browser-strict-setup',
        now: new Date('2026-05-21T08:18:00.000Z'),
      });
      const authReport = await readJson(paths.authStateReportPath);
      const setupPlan = await readJson(paths.setupPlanPath);
      assert.equal(authReport.authVerificationStatus, 'browser_verified');
      assert.equal(authReport.browserBridge.routeCount, 3);
      assert.equal(authReport.browserBridge.capturedRouteCount, 1);
      assert.equal(authReport.browserBridge.missingRouteCount, 2);
      assert.equal(setupPlan.buildReadiness.buildable, true);
      assert.equal(setupPlan.partialCoverage.reasonCode, 'browser-auth-route-coverage-partial');
      assert.equal(setupPlan.partialCoverage.capturedRouteCount, 1);
      assert.equal(setupPlan.partialCoverage.missingRouteCount, 2);
      assert.equal(setupPlan.partialCoverage.missingRoutes.length, 2);
      assert.equal(setupPlan.warnings.includes('browser-auth-route-coverage-partial'), true);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('browser auth bridge serves collector script and rejects sensitive summaries', async () => {
  await withTestServer({
    '/robots.txt': testRobotsTxt('http://example.test/'),
    '/': testHtmlPage('Home', '<main><a href="/rank/hot">热门榜单</a></main>'),
  }, async (rootUrl) => {
    const site = {
      id: 'browser-bridge-server-test',
      rootUrl,
      allowedDomains: [new URL(rootUrl).hostname],
    };
    const opened = [];
    const verified = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        browserBridgeTimeoutMs: 3000,
        localBuildConfig: {
          authRoutes: ['/account'],
          publicRevisitRoutes: ['/'],
        },
      },
      openBrowser: async (urlValue) => {
        opened.push(urlValue);
        if (!String(urlValue).includes('nonce=')) {
          return;
        }
        const bridgeHtml = await (await fetch(urlValue)).text();
        assert.match(bridgeHtml, /siteforge-browser-bridge/u);
        assert.match(bridgeHtml, /session:/u);
        const collectorUrl = bridgeHtml.match(/collector: (http:\/\/127\.0\.0\.1:\d+\/collector\.js\?[^<\s]+)/u)?.[1]?.replace(/&amp;/gu, '&');
        assert.ok(collectorUrl);
        const sessionUrl = bridgeHtml.match(/session: (http:\/\/127\.0\.0\.1:\d+\/session\.json\?[^<\s]+)/u)?.[1]?.replace(/&amp;/gu, '&');
        assert.ok(sessionUrl);
        const session = await (await fetch(sessionUrl)).json();
        assert.equal(session.artifactFamily, 'siteforge-browser-bridge-session');
        assert.equal(session.nonce, new URL(sessionUrl).searchParams.get('nonce'));
        assert.equal(session.targetUrl, new URL('/account', rootUrl).toString());
        assert.equal(session.allowedHost, new URL(rootUrl).hostname);
        assert.equal(session.routes.length, 2);
        assert.deepEqual(session.routes.map((route) => route.sourceLayer), ['authenticated', 'authenticated_overlay']);
        assert.equal(session.privacy.cookieRead, false);
        assert.equal(session.privacy.browserProfilePersisted, false);
        assert.match(session.extensionStatusUrl, /\/extension-status\?nonce=/u);
        const extensionStatus = await fetch(`${session.extensionStatusUrl}&stage=test-extension-active`, { method: 'POST' });
        assert.equal(extensionStatus.ok, true);
        const collectorScript = await (await fetch(collectorUrl)).text();
        assert.match(collectorScript, /SITEFORGE_SUBMIT_URL/u);
        assert.doesNotMatch(collectorScript, /document\.cookie|localStorage|sessionStorage|Authorization/u);
        const submitUrl = session.submitUrl;
        assert.ok(submitUrl);
        await fetch(submitUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            routeResults: [{
              routeId: session.routes[0].id,
              targetUrl: session.routes[0].targetUrl,
              sourceLayer: 'authenticated',
              status: 'captured',
            }],
            authenticatedPages: [{
              routeId: session.routes[0].id,
              url: session.routes[0].targetUrl,
              routeTemplate: '/account',
              sourceLayer: 'authenticated',
              pageType: 'authenticated_home',
              visibleItemCount: 1,
              listPresent: true,
              links: [{
                href: '/rank/hot',
                label: '热门榜单',
                semanticKind: 'ranking',
                routeTemplate: '/rank/hot',
              }],
            }],
          }),
        });
        await fetch(submitUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            routeResults: [{
              routeId: session.routes[1].id,
              targetUrl: session.routes[1].targetUrl,
              sourceLayer: 'authenticated_overlay',
              status: 'captured',
            }],
            authenticatedOverlayPages: [{
              routeId: session.routes[1].id,
              url: session.routes[1].targetUrl,
              routeTemplate: '/',
              sourceLayer: 'authenticated_overlay',
              pageType: 'home_overlay',
              visibleItemCount: 1,
              listPresent: true,
            }],
          }),
        });
      },
    });
    assert.equal(opened.length, 1);
    assert.equal(verified.status, 'browser_verified');
    assert.equal(verified.bridgeSummary.routeCount, 2);
    assert.equal(verified.bridgeSummary.capturedRouteCount, 2);
    assert.equal(verified.bridgeSummary.missingRouteCount, 0);
    assert.equal(verified.structureSummary.authenticatedPages[0].links[0].semanticKind, 'ranking');
    const extensionDir = browserBridgeExtensionDirectory();
    const manifest = JSON.parse(await readFile(path.join(extensionDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, '0.1.5');
    assert.match(manifest.name, /v0\.1\.5/u);
    assert.deepEqual(manifest.permissions.sort(), ['scripting', 'tabs']);
    const extensionContent = await readFile(path.join(extensionDir, 'bridge-content.js'), 'utf8');
    assert.equal(extensionContent.includes('siteforge-bridge-session'), true);
    assert.equal(extensionContent.includes('bridge-content-version:'), true);
    assert.equal(extensionContent.includes('route-queue-loading-dom-fallback-v5'), true);
    const extensionBackground = await readFile(path.join(extensionDir, 'background.js'), 'utf8');
    assert.equal(extensionBackground.includes('chrome.scripting.executeScript'), true);
    assert.equal(extensionBackground.includes('route-queue-loading-dom-fallback-v5'), true);
    assert.equal(extensionBackground.includes('route-tab-usable-while-loading'), true);
    assert.equal(extensionBackground.includes('route-load-fallback'), true);
    assert.equal(extensionBackground.includes('route-tab-stable'), true);
    assert.equal(extensionBackground.includes('collector-reinjecting'), true);
    assert.equal(extensionBackground.includes('route-url-canonicalized'), true);
    assert.equal(extensionBackground.includes('login-wall'), true);
    assert.equal(extensionBackground.includes('browser-bridge-collector-injection-failed'), true);
    assert.equal(extensionBackground.includes('execute-script-failed'), true);
    assert.equal(extensionBackground.includes('collector-message-failed'), true);
    const extensionCollector = await readFile(path.join(extensionDir, 'collector-content.js'), 'utf8');
    assert.equal(extensionCollector.includes('siteforge-collect-structure'), true);
    assert.equal(extensionCollector.includes('captured_with_warning'), true);
    assert.equal(extensionCollector.includes('definite_challenge'), true);
    assert.equal(extensionCollector.includes('thin_capture'), true);
    assert.equal(extensionCollector.includes('media_surface'), true);

    const script = browserStructureCollectorScript({
      nonce: 'nonce-test',
      submitUrl: 'http://127.0.0.1:1/submit?nonce=nonce-test',
    });
    assert.match(script, /semanticKindFor/u);
    assert.doesNotMatch(script, /document\.cookie|localStorage|sessionStorage/u);

    const blocked = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        browserAuthBridgeProvider: async () => ({
          authenticatedPages: [{
            url: rootUrl,
            routeTemplate: '/',
            pageType: 'authenticated_home',
            links: [{ href: '/account', label: 'cookie=sessionid=SECRET', semanticKind: 'category' }],
          }],
        }),
      },
    });
    assert.equal(blocked.status, 'browser_blocked');
    assert.deepEqual(blocked.blockingSignals, ['browser-bridge-sensitive-payload']);

    const challenge = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        browserAuthBridgeProvider: async ({ routes }) => ({
          routeResults: [{
            routeId: routes[0].id,
            targetUrl: routes[0].targetUrl,
            sourceLayer: routes[0].sourceLayer,
            status: 'challenge_detected',
            reasonCode: 'browser-bridge-challenge-detected',
          }],
        }),
      },
    });
    assert.equal(challenge.status, 'browser_blocked');
    assert.equal(challenge.verified, false);
    assert.equal(challenge.bridgeSummary.routeResults[0].status, 'challenge_detected');
    assert.equal(challenge.blockingSignals.includes('browser-bridge-route-challenge-detected'), true);

    const retryRecovered = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        localBuildConfig: {
          authRoutes: ['/account', '/messages'],
        },
        browserAuthBridgeProvider: async ({ routes, passIndex }) => {
          if (passIndex === 0) {
            return {
              authenticatedPages: [{
                routeId: routes[0].id,
                url: routes[0].targetUrl,
                routeTemplate: '/account',
                sourceLayer: 'authenticated',
                pageType: 'account_home',
                visibleItemCount: 1,
                listPresent: true,
              }],
              routeResults: [{
                routeId: routes[1].id,
                targetUrl: routes[1].targetUrl,
                sourceLayer: routes[1].sourceLayer,
                status: 'challenge_detected',
                reasonCode: 'browser-bridge-route-challenge-detected',
              }],
            };
          }
          assert.equal(routes.length, 1);
          assert.equal(routes[0].routeTemplate, '/messages');
          return {
            authenticatedPages: [{
              routeId: routes[0].id,
              url: routes[0].targetUrl,
              routeTemplate: '/messages',
              sourceLayer: 'authenticated',
              pageType: 'direct_message_list_summary',
              visibleItemCount: 1,
              listPresent: true,
            }],
          };
        },
      },
    });
    assert.equal(retryRecovered.status, 'browser_verified');
    assert.equal(retryRecovered.bridgeSummary.routeCount, 2);
    assert.equal(retryRecovered.bridgeSummary.capturedRouteCount, 2);
    assert.equal(retryRecovered.bridgeSummary.missingRouteCount, 0);
    assert.equal(retryRecovered.bridgeSummary.retryStatus, 'captured_after_retry');
    assert.equal(retryRecovered.bridgeSummary.retryAttemptedRouteCount, 1);
    assert.equal(retryRecovered.bridgeSummary.retryCapturedRouteCount, 1);
    assert.equal(retryRecovered.bridgeSummary.routeResults.find((route) => route.targetRoute === '/messages')?.retryOutcome, 'captured_after_retry');

    const retrySkipsDefiniteChallenge = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        localBuildConfig: {
          authRoutes: ['/blocked-challenge', '/late-route'],
        },
        browserAuthBridgeProvider: async ({ routes, passIndex }) => {
          if (passIndex === 0) {
            return {
              routeResults: [{
                routeId: routes[0].id,
                targetUrl: routes[0].targetUrl,
                sourceLayer: routes[0].sourceLayer,
                status: 'challenge_detected',
                reasonCode: 'browser-bridge-definite-challenge',
              }, {
                routeId: routes[1].id,
                targetUrl: routes[1].targetUrl,
                sourceLayer: routes[1].sourceLayer,
                status: 'timeout',
                reasonCode: 'browser-bridge-route-timeout',
              }],
            };
          }
          assert.equal(routes.length, 1);
          assert.equal(routes[0].routeTemplate, '/late-route');
          return {
            authenticatedPages: [{
              routeId: routes[0].id,
              url: routes[0].targetUrl,
              routeTemplate: '/late-route',
              sourceLayer: 'authenticated',
              pageType: 'authenticated_browser_summary',
              visibleItemCount: 1,
              listPresent: true,
            }],
          };
        },
      },
    });
    assert.equal(retrySkipsDefiniteChallenge.status, 'browser_verified');
    assert.equal(retrySkipsDefiniteChallenge.bridgeSummary.routeResults.find((route) => route.targetRoute === '/blocked-challenge')?.retryAttemptCount, 0);
    assert.equal(retrySkipsDefiniteChallenge.bridgeSummary.routeResults.find((route) => route.targetRoute === '/late-route')?.retryOutcome, 'captured_after_retry');

    const saturatedRetryResults = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        localBuildConfig: {
          authRoutes: Array.from({ length: 32 }, (_, index) => `/route-${index + 1}`),
        },
        browserAuthBridgeProvider: async ({ routes, passIndex }) => {
          if (passIndex === 0) {
            return {
              authenticatedPages: [{
                routeId: routes[0].id,
                url: routes[0].targetUrl,
                routeTemplate: routes[0].routeTemplate,
                sourceLayer: routes[0].sourceLayer,
                pageType: 'authenticated_home',
                visibleItemCount: 1,
                listPresent: true,
              }],
              routeResults: routes.slice(1).map((route) => ({
                routeId: route.id,
                targetUrl: route.targetUrl,
                sourceLayer: route.sourceLayer,
                status: 'blocked',
                reasonCode: 'navigation-in-progress',
              })),
            };
          }
          return {
            routeResults: routes.map((route) => ({
              routeId: route.id,
              targetUrl: route.targetUrl,
              sourceLayer: route.sourceLayer,
              status: passIndex === 1 ? 'blocked' : 'challenge_detected',
              reasonCode: passIndex === 1
                ? 'collector-message-failed'
                : 'browser-bridge-definite-challenge',
            })),
          };
        },
      },
    });
    assert.equal(saturatedRetryResults.bridgeSummary.routeCount, 32);
    assert.equal(saturatedRetryResults.bridgeSummary.retryPasses, 2);
    assert.equal(saturatedRetryResults.bridgeSummary.routeResults.find((route) => route.targetRoute === '/route-32')?.finalReasonCode, 'browser-bridge-definite-challenge');

    const capturedWithoutSummary = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        browserBridgeMaxRetryPasses: 0,
        browserAuthBridgeProvider: async ({ routes }) => ({
          routeResults: [{
            routeId: routes[0].id,
            targetUrl: routes[0].targetUrl,
            sourceLayer: routes[0].sourceLayer,
            status: 'captured',
          }],
        }),
      },
    });
    assert.equal(capturedWithoutSummary.status, 'browser_bridge_missing');
    assert.equal(capturedWithoutSummary.bridgeSummary.capturedRouteCount, 0);
    assert.equal(capturedWithoutSummary.bridgeSummary.routeResults[0].reasonCode, 'browser-bridge-captured-without-summary');

    const thinCapture = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        browserBridgeMaxRetryPasses: 0,
        browserAuthBridgeProvider: async ({ targetUrl, routes }) => ({
          authenticatedPages: [{
            routeId: routes[0].id,
            url: targetUrl,
            routeTemplate: '/',
            sourceLayer: 'authenticated',
            pageType: 'authenticated_home',
            visibleItemCount: 0,
            listPresent: false,
          }],
        }),
      },
    });
    assert.equal(thinCapture.status, 'browser_bridge_missing');
    assert.equal(thinCapture.bridgeSummary.capturedRouteCount, 0);
    assert.equal(thinCapture.bridgeSummary.routeResults[0].status, 'thin_capture');
    assert.equal(thinCapture.structureSummary.authenticatedPages.length, 0);

    const staleExtension = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        browserBridgeTimeoutMs: 1000,
      },
      openBrowser: async (urlValue) => {
        const bridgeHtml = await (await fetch(urlValue)).text();
        const statusUrl = bridgeHtml.match(/extension: .*?\n/u)
          ? bridgeHtml.match(/submit: (http:\/\/127\.0\.0\.1:\d+\/submit\?nonce=[^<\s]+)/u)?.[1]?.replace('/submit?', '/extension-status?').replace(/&amp;/gu, '&')
          : null;
        assert.ok(statusUrl);
        const url = new URL(statusUrl);
        url.searchParams.set('stage', 'target-tab-created');
        await fetch(url.toString(), { method: 'POST' });
      },
    });
    assert.equal(staleExtension.status, 'browser_bridge_missing');
    assert.equal(staleExtension.blockingSignals.includes('browser-bridge-extension-stale-or-incompatible'), true);

    const mixedVersionExtension = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        browserBridgeTimeoutMs: 1000,
      },
      openBrowser: async (urlValue) => {
        const bridgeUrl = new URL(urlValue);
        const sessionUrl = new URL('/session.json', bridgeUrl.origin);
        sessionUrl.searchParams.set('nonce', bridgeUrl.searchParams.get('nonce'));
        const session = await (await fetch(sessionUrl)).json();
        const signalStage = async (stage) => {
          const statusUrl = new URL(session.extensionStatusUrl);
          statusUrl.searchParams.set('stage', stage);
          await fetch(statusUrl, { method: 'POST' });
        };
        await signalStage('bridge-content-version:route-queue-loading-dom-fallback-v5');
        await signalStage('bridge-version:route-queue-retry-stability-v3');
        await fetch(session.submitUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            routeResults: [{
              routeId: session.routes[0].id,
              targetUrl: session.routes[0].targetUrl,
              sourceLayer: 'authenticated',
              status: 'captured',
            }],
            authenticatedPages: [{
              routeId: session.routes[0].id,
              url: session.routes[0].targetUrl,
              routeTemplate: '/',
              sourceLayer: 'authenticated',
              pageType: 'authenticated_home',
              visibleItemCount: 1,
              listPresent: true,
            }],
          }),
        });
      },
    });
    assert.equal(mixedVersionExtension.status, 'browser_bridge_missing');
    assert.equal(mixedVersionExtension.verified, false);
    assert.equal(mixedVersionExtension.blockingSignals.includes('browser-bridge-extension-stale-or-incompatible'), true);
    assert.equal(mixedVersionExtension.bridgeSummary.capturedRouteCount, 1);

    const retryOnly = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        localBuildConfig: {
          authRoutes: ['/account', '/messages'],
          publicRevisitRoutes: ['/'],
        },
        browserBridgeRouteTemplates: ['/messages'],
        browserAuthBridgeProvider: async ({ routes }) => {
          assert.equal(routes.length, 1);
          assert.equal(routes[0].routeTemplate, '/messages');
          return {
            routeResults: [{
              routeId: routes[0].id,
              targetUrl: routes[0].targetUrl,
              sourceLayer: routes[0].sourceLayer,
              status: 'captured',
            }],
            authenticatedPages: [{
              routeId: routes[0].id,
              url: routes[0].targetUrl,
              routeTemplate: '/messages',
              sourceLayer: 'authenticated',
              pageType: 'direct_message_list_summary',
              visibleItemCount: 0,
              listPresent: true,
            }],
          };
        },
      },
    });
    assert.equal(retryOnly.status, 'browser_verified');
    assert.equal(retryOnly.bridgeSummary.routeCount, 1);
    assert.equal(retryOnly.bridgeSummary.capturedRouteCount, 1);
    assert.equal(retryOnly.structureSummary.authenticatedPages[0].normalizedUrl, new URL('/messages', rootUrl).toString());
  });
});

test('authenticated crawl reuses verified cookie only at runtime', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-auth-runtime-cookie-'));
  const accountCookies = [];
  try {
    await withTestServer((request, response) => {
      const rootUrl = `http://${request.headers.host}/`;
      const pathname = new URL(request.url ?? '/', rootUrl).pathname;
      if (pathname === '/robots.txt') {
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(testRobotsTxt(rootUrl));
        return;
      }
      if (pathname === '/sitemap.xml') {
        response.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
        response.end(testSitemapXml(rootUrl, ['/', '/account']));
        return;
      }
      if (pathname === '/account') {
        accountCookies.push(String(request.headers.cookie ?? ''));
        if (!String(request.headers.cookie ?? '').includes('sid=ok')) {
          response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('Forbidden');
          return;
        }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(testHtmlPage('Account', '<main><ul><li>notice</li></ul></main>'));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(testHtmlPage('Public', '<main><a href="/account">Account</a><a href="/catalog">Catalog</a></main>'));
    }, async (rootUrl) => {
      const authStateReport = {
        schemaVersion: 1,
        artifactFamily: 'siteforge-auth-state-report',
        crawlMode: 'authenticated_cookie',
        authMethod: 'cookie',
        authVerificationStatus: 'cookie_verified',
        verified: true,
        source: 'cookie_header_verification',
        blockingSignals: [],
        positiveSignals: ['cookie_header_present', 'auth_check_http_success', 'auth_check_not_login_route'],
        verifiedRoutes: ['/account'],
        capabilityProofs: [],
        rawMaterialPersisted: false,
        sessionMaterialPersisted: false,
        cookieMaterialPersisted: false,
        browserProfilePersisted: false,
      };
      const crawlContract = createCrawlContract({
        authStateReport,
        coverageTargets: {
          publicRoutes: ['/'],
          authRoutes: ['/account'],
          publicRevisitRoutes: ['/'],
        },
      });
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'auth-runtime-cookie',
        now: new Date('2026-05-21T08:16:00.000Z'),
        fetchDelayMs: 0,
        authMode: 'cookie',
        cookieHeader: 'sid=ok; uid=123',
        authCheckUrl: '/account',
        authStateReport,
        crawlContract,
      });
      assert.equal(result.status, 'success');
      assert.ok(accountCookies.length >= 2);
      assert.ok(accountCookies.filter((cookie) => cookie.includes('sid=ok')).length >= 2);
      const authReportText = await readFile(path.join(result.artifactDir, 'auth_state_report.json'), 'utf8');
      const buildReportText = await readFile(path.join(result.artifactDir, 'build_report.json'), 'utf8');
      assert.doesNotMatch(`${authReportText}\n${buildReportText}`, /sid=ok|uid=123/u);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runSiteForgeBuild merges public, authenticated, and overlay layers with evidence matrices', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-enhanced-login-'));
  try {
    await withTestSite(simpleShopRoutes, async (rootUrl) => {
    const authStateReport = {
      schemaVersion: 1,
      artifactFamily: 'siteforge-auth-state-report',
      crawlMode: 'authenticated_cookie',
      authMethod: 'cookie',
      authVerificationStatus: 'cookie_verified',
      verified: true,
      source: 'cookie_header_verification',
      blockingSignals: [],
      positiveSignals: ['cookie_header_present', 'auth_check_http_success', 'auth_check_not_login_route'],
      verifiedRoutes: ['/notifications'],
      capabilityProofs: [],
      rawMaterialPersisted: false,
      sessionMaterialPersisted: false,
      browserProfilePersisted: false,
    };
    const crawlContract = createCrawlContract({
      authStateReport,
      coverageTargets: {
        publicRoutes: ['/'],
        authRoutes: ['/notifications'],
        publicRevisitRoutes: ['/'],
        candidateCapabilities: ['list-notifications'],
        requiresLoginCapabilities: ['list-notifications'],
      },
    });
    const result = await runSiteForgeBuild(rootUrl, {
      cwd: workspace,
      buildId: 'enhanced-login-build',
      now: new Date('2026-05-21T08:20:00.000Z'),
      fetchDelayMs: 0,
      authStateReport,
      crawlContract,
      authenticatedStructureProvider: async () => ({
        authenticatedPages: [{
          url: new URL('/notifications', rootUrl).toString(),
          routeTemplate: '/notifications',
          tabState: 'notifications',
          pageType: 'notifications',
          visibleItemCount: 3,
          listPresent: true,
          unreadMarkerPresent: true,
          controls: [{ kind: 'button', label: 'Mark read', selector: '[data-action="mark-read"]' }],
        }],
        authenticatedOverlayPages: [{
          url: rootUrl,
          routeTemplate: '/',
          tabState: 'home',
          pageType: 'home',
          visibleItemCount: 2,
          listPresent: true,
          overlayFor: rootUrl,
        }],
      }),
    });

    assert.equal(result.status, 'success');
    const authReport = await readJson(path.join(result.artifactDir, 'auth_state_report.json'));
    assert.equal(authReport.verified, true);
    assert.equal(authReport.rawMaterialPersisted, false);
    assert.equal(authReport.sessionMaterialPersisted, false);
    assert.equal(authReport.browserProfilePersisted, false);

    const crawlAuthenticated = await readJson(path.join(result.artifactDir, 'crawl_authenticated.json'));
    assert.equal(crawlAuthenticated.authenticatedPages.length, 1);
    assert.equal(crawlAuthenticated.authenticatedOverlayPages.length, 1);
    assert.equal(crawlAuthenticated.privacy.rawDomSaved, false);
    assert.equal(crawlAuthenticated.privacy.rawHtmlSaved, false);
    assert.equal(crawlAuthenticated.privacy.privateContentSaved, false);

    const graph = await readJson(path.join(result.artifactDir, 'graph.json'));
    const layers = new Set(graph.nodes.map((node) => node.sourceLayer));
    assert.equal(layers.has('public'), true);
    assert.equal(layers.has('authenticated'), true);
    assert.equal(layers.has('authenticated_overlay'), true);
    assert.equal(graph.edges.some((edge) => edge.type === 'auth_overlay_for'), true);

    const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
    const loginCapabilities = capabilities.capabilities.filter((capability) => capability.authRequired === true);
    assert.equal(loginCapabilities.length > 0, true);
    assert.equal(loginCapabilities.every((capability) => capability.evidenceMatrix), true);
    assert.equal(loginCapabilities.some((capability) => capability.status === 'active'), true);
    assert.equal(capabilities.capabilities
      .filter((capability) => ['write_high', 'account_security_critical'].includes(capability.risk_level))
      .every((capability) => capability.status !== 'active' && !capability.executionPlan), true);

    const userReport = await readJson(path.join(result.artifactDir, 'build_report.user.json'));
    assert.equal(userReport.crawlMode, 'authenticated_cookie');
    assert.equal(userReport.coverage.public.pages > 0, true);
    assert.equal(userReport.coverage.authenticated.pages, 1);
    assert.equal(userReport.coverage.overlay.pagesRevisited, 1);
    assert.equal(userReport.auth_summary.savedMaterial.rawMaterialPersisted, false);

    const htmlReport = await readFile(path.join(result.artifactDir, 'reports', 'capability_intent_summary.html'), 'utf8');
    assert.match(htmlReport, /authenticated_cookie/u);
    assert.match(htmlReport, /authenticated pages<\/td><td>1/u);
    assert.match(htmlReport, /overlay pages revisited<\/td><td>1/u);
    assert.match(htmlReport, /notification/u);
    assert.match(htmlReport, /requiredEvidence/u);
    assert.match(htmlReport, /observedEvidence/u);
    assert.match(htmlReport, /missingEvidence/u);
    assert.doesNotMatch(htmlReport, /cookie\s*=|token\s*=|sid=|uid=|\bauthorization\b|\bbearer\b|localStorage|sessionStorage|userDataDir|browser profile|<script\b/iu);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runSiteForgeBuild accepts default-browser bridge authenticated summaries', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-browser-auth-'));
  try {
    await withTestSite(simpleShopRoutes, async (rootUrl) => {
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'browser-auth-build',
        now: new Date('2026-05-21T08:24:00.000Z'),
        fetchDelayMs: 0,
        authMode: 'browser',
        authCheckUrl: '/notifications',
        strictBrowserAuth: true,
        browserBridgeMaxRetryPasses: 0,
        localBuildConfig: {
          authRoutes: ['/notifications', '/follow'],
          publicRevisitRoutes: ['/'],
        },
        browserAuthBridgeProvider: async ({ routes }) => ({
          authenticatedPages: [{
            routeId: routes[0].id,
            url: routes[0].targetUrl,
            routeTemplate: '/notifications',
            tabState: 'notifications',
            pageType: 'notifications',
            visibleItemCount: 4,
            listPresent: true,
            unreadMarkerPresent: true,
          }, {
            routeId: routes[1].id,
            url: routes[1].targetUrl,
            routeTemplate: '/follow',
            tabState: 'follow',
            pageType: 'following_list',
            visibleItemCount: 4,
            listPresent: true,
            links: [{
              href: '/follow',
              label: '\u5173\u6ce8\u9891\u9053',
              semanticKind: 'following_list',
              routeTemplate: '/follow',
            }],
          }],
          authenticatedOverlayPages: [{
            routeId: routes[2].id,
            url: routes[2].targetUrl,
            routeTemplate: '/',
            tabState: 'home',
            pageType: 'home_overlay',
            visibleItemCount: 2,
            listPresent: true,
            overlayFor: rootUrl,
            links: [
              {
                href: '/genres/xuanhuan',
                label: '玄幻分类',
                semanticKind: 'category',
                routeTemplate: '/genres/xuanhuan',
              },
              {
                href: '/rank/hot',
                label: '热门榜单',
                semanticKind: 'ranking',
                routeTemplate: '/rank/hot',
              },
              {
                href: '/follow',
                label: '关注频道',
                semanticKind: 'following_list',
                routeTemplate: '/follow',
              },
            ],
          }],
        }),
      });

      assert.equal(result.status, 'success');
      const authReport = await readJson(path.join(result.artifactDir, 'auth_state_report.json'));
      assert.equal(authReport.authMethod, 'browser');
      assert.equal(authReport.authVerificationStatus, 'browser_verified');
      assert.equal(authReport.browserBridge.used, true);
      assert.equal(authReport.browserBridge.routeCount, 3);
      assert.equal(authReport.browserBridge.capturedRouteCount, 3);
      assert.equal(authReport.browserBridge.missingRouteCount, 0);
      assert.equal(authReport.cookieMaterialPersisted, false);
      assert.equal(authReport.browserProfilePersisted, false);

      const crawlAuthenticated = await readJson(path.join(result.artifactDir, 'crawl_authenticated.json'));
      assert.equal(crawlAuthenticated.authenticatedPages.length, 2);
      assert.equal(crawlAuthenticated.authenticatedOverlayPages.length, 1);

      const graph = await readJson(path.join(result.artifactDir, 'graph.json'));
      assert.equal(graph.nodes.some((node) => node.sourceLayer === 'authenticated'), true);
      assert.equal(graph.nodes.some((node) => node.sourceLayer === 'authenticated_overlay'), true);
      assert.equal(graph.nodes.some((node) => (
        node.sourceLayer === 'authenticated_overlay'
        && node.categoryInstance?.kind === 'category'
        && node.categoryInstance?.label === '玄幻分类'
      )), true);
      assert.equal(graph.nodes.some((node) => (
        node.sourceLayer === 'authenticated_overlay'
        && node.categoryInstance?.kind === 'ranking'
        && node.categoryInstance?.label === '热门榜单'
      )), true);
      assert.equal(graph.nodes.some((node) => (
        node.sourceLayer === 'authenticated_overlay'
        && node.categoryInstance?.kind === 'following_list'
        && node.categoryInstance?.label === '关注频道'
      )), true);

      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      assert.equal(capabilities.capabilities.some((capability) => (
        capability.sourceLayer === 'authenticated_overlay'
        && capability.elementRole === 'category'
        && capability.object === '玄幻分类'
        && capability.userValue === '浏览玄幻分类'
        && capability.enabled_status === 'limited_enabled'
      )), true);
      assert.equal(capabilities.capabilities.some((capability) => (
        capability.sourceLayer === 'authenticated_overlay'
        && capability.elementRole === 'ranking'
        && capability.object === '热门榜单'
        && capability.userValue === '查看热门榜单'
        && capability.enabled_status === 'limited_enabled'
      )), true);
      const followReadCapability = capabilities.capabilities.find((capability) => (
        capability.sourceLayer === 'authenticated_overlay'
        && capability.elementRole === 'following_list'
        && capability.object === '关注频道'
      ));
      assert.ok(followReadCapability);
      assert.equal(followReadCapability.enabled_status, 'limited_enabled');
      assert.notEqual(followReadCapability.status, 'disabled');
      assert.equal(capabilities.capabilities.some((capability) => (
        capability.status === 'disabled'
        && capability.blockedAction === 'follow'
        && capability.entryNodeIds?.includes(followReadCapability.entryNodeIds[0])
      )), false);

      const intents = await readJson(path.join(result.artifactDir, 'intents.json'));
      const intentText = JSON.stringify(intents);
      assert.match(intentText, /\u7384\u5e7b\u5206\u7c7b/u);
      assert.match(intentText, /\u70ed\u95e8\u699c\u5355/u);
      assert.match(intentText, /\u5173\u6ce8\u9891\u9053/u);

      const userReport = await readJson(path.join(result.artifactDir, 'build_report.user.json'));
      assert.equal(userReport.crawlMode, 'authenticated_browser');
      assert.equal(userReport.authMethod, 'browser');
      assert.equal(userReport.authVerificationStatus, 'browser_verified');
      assert.doesNotMatch(JSON.stringify(userReport), /sid=SECRET_SESSION_VALUE|uid=123|Bearer synthetic-secret/iu);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runSiteForgeBuild produces partial success for captured browser routes when another route is challenged', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-browser-auth-partial-'));
  try {
    await withTestSite(simpleShopRoutes, async (rootUrl) => {
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'browser-auth-partial-build',
        now: new Date('2026-05-21T08:26:00.000Z'),
        renderJs: true,
        fetchDelayMs: 0,
        authMode: 'browser',
        authCheckUrl: '/notifications',
        strictBrowserAuth: true,
        browserBridgeMaxRetryPasses: 0,
        localBuildConfig: {
          authRoutes: ['/notifications', '/account'],
          publicRevisitRoutes: ['/'],
        },
        publicRenderedStructureProvider: async () => ({
          publicRenderedPages: [{
            url: rootUrl,
            routeTemplate: '/',
            pageType: 'security_check',
            title: 'Verify challenge',
            links: [{ href: '/rank/hot', label: '\u70ed\u95e8\u699c\u5355', semanticKind: 'ranking' }],
          }],
        }),
        browserAuthBridgeProvider: async ({ routes }) => ({
          authenticatedPages: [{
            routeId: routes[0].id,
            url: routes[0].targetUrl,
            routeTemplate: '/notifications',
            tabState: 'notifications',
            pageType: 'notifications',
            visibleItemCount: 2,
            listPresent: true,
          }],
          authenticatedOverlayPages: [{
            routeId: routes[2].id,
            url: routes[2].targetUrl,
            routeTemplate: '/',
            tabState: 'home',
            pageType: 'home_overlay',
            visibleItemCount: 2,
            listPresent: true,
            overlayFor: rootUrl,
            links: [{
              href: '/rank/hot',
              label: '\u70ed\u95e8\u699c\u5355',
              semanticKind: 'ranking',
              routeTemplate: '/rank/hot',
            }],
          }],
          routeResults: [{
            routeId: routes[1].id,
            sourceLayer: routes[1].sourceLayer,
            targetRoute: routes[1].routeTemplate,
            status: 'challenge_detected',
            reasonCode: 'browser-bridge-route-challenge-detected',
          }],
        }),
      });

      assert.equal(result.status, 'success');
      assert.equal(result.result_status, 'partial_success');
      assert.equal(result.summary.verificationStatus, 'bridge_runtime_passed');
      assert.equal(result.summary.registryStatus, 'registered');
      assert.equal(result.summary.currentUpdated, true);
      assert.equal(result.summary.runtimeMode, 'browser_bridge_required');
      assert.equal(result.partial_success_reasons.some((reason) => /Default-browser bridge captured only reachable configured routes/u.test(reason)), true);
      assert.equal(result.partial_success_reasons.some((reason) => /runtime-routed Skill/u.test(reason)), true);

      const authReport = await readJson(path.join(result.artifactDir, 'auth_state_report.json'));
      assert.equal(authReport.authVerificationStatus, 'browser_verified');
      assert.equal(authReport.browserBridge.routeCount, 3);
      assert.equal(authReport.browserBridge.capturedRouteCount, 2);
      assert.equal(authReport.browserBridge.missingRouteCount, 1);
      assert.equal(authReport.browserBridge.routeCoverageStatus, 'partial');
      assert.equal(authReport.browserBridge.retryStatus, 'not_attempted');

      const crawlAuthenticated = await readJson(path.join(result.artifactDir, 'crawl_authenticated.json'));
      assert.equal(crawlAuthenticated.authenticatedPages.length, 1);
      assert.equal(crawlAuthenticated.authenticatedOverlayPages.length, 1);

      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      assert.equal(capabilities.capabilities.some((capability) => (
        capability.sourceLayer === 'authenticated_overlay'
        && capability.elementRole === 'ranking'
        && capability.object === '\u70ed\u95e8\u699c\u5355'
      )), true);
      assert.equal(JSON.stringify(capabilities).includes('/account'), false);

      const userReport = await readJson(path.join(result.artifactDir, 'build_report.user.json'));
      assert.equal(userReport.result_status, 'partial_success');
      assert.equal(userReport.build_completion.registry_status, 'registered');
      assert.equal(userReport.build_completion.current_updated, true);
      assert.equal(userReport.build_completion.runtime_mode, 'browser_bridge_required');
      assert.equal(userReport.coverage.browserBridge.routeCount, 3);
      assert.equal(userReport.coverage.browserBridge.capturedRouteCount, 2);
      assert.equal(userReport.coverage.browserBridge.missingRouteCount, 1);
      assert.equal(userReport.coverage.browserBridge.routeCoverageStatus, 'partial');
      assert.equal(userReport.coverage.runtime.browserBridgeRuntimeCapabilities > 0, true);
      assert.equal(userReport.build_completion.runtime_counts.browserBridgeRuntimeCapabilities > 0, true);
      assert.equal(userReport.blocked_by_auth.some((entry) => (
        entry.routeTemplate === '/account'
        && entry.reason === 'browser-bridge-route-challenge-detected'
      )), true);
      assert.match(userReport.reports.route_capture_plan, /route_capture_plan\.json/u);
      assert.equal(userReport.next_step_workflows.some((workflow) => (
        workflow.id === 'browser-bridge-route-retry'
        && workflow.report === 'route_capture_plan.json'
      )), true);
      const routeCapturePlan = await readJson(path.join(result.artifactDir, 'route_capture_plan.json'));
      assert.equal(routeCapturePlan.status, 'partial');
      assert.equal(routeCapturePlan.missingRouteCount, 1);
      assert.equal(routeCapturePlan.missingRoutes[0].targetRoute, '/account');
      assert.equal(routeCapturePlan.missingRoutes[0].recommendedRetryMode, 'browser_bridge_missing_route_retry');
      assert.equal(routeCapturePlan.missingRoutes[0].capabilityGenerated, false);
      assert.equal(routeCapturePlan.missingRoutes[0].finalStatus, 'challenge_detected');

      const htmlReport = await readFile(path.join(result.artifactDir, 'reports', 'capability_intent_summary.html'), 'utf8');
      assert.match(htmlReport, /browser bridge missing routes/u);
      assert.match(htmlReport, /Browser Bridge Route Coverage/u);
      assert.match(htmlReport, /blocked by auth/u);
      assert.match(htmlReport, /browser_bridge_runtime/u);
      assert.doesNotMatch(htmlReport, /cookie\s*=|token\s*=|sid=|uid=|\bauthorization\b|\bbearer\b/iu);

      const registryReport = await readJson(path.join(result.artifactDir, 'registry_report.json'));
      assert.equal(registryReport.status, 'registered');
      assert.equal(registryReport.runtimeMode, 'browser_bridge_required');
      assert.equal(registryReport.lookup.status, 'found');

      const registry = await readJson(result.workspace.registryPath);
      const record = registry.skills.find((skill) => skill.skillId === result.skillId);
      assert.equal(record.runtimeMode, 'browser_bridge_required');
      assert.equal(record.runtimeModes.includes('browser_bridge_required'), true);
      assert.equal(JSON.stringify(record).includes('/account'), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runSiteForgeBuild compiles a local HTTP Tencent News site with robots filtering', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-news-http-'));
  try {
    await withTestSite(tencentNewsRoutes, async (rootUrl) => {
    const result = await runSiteForgeBuild(rootUrl, {
      cwd: workspace,
      buildId: 'news-http-build',
      now: new Date('2026-05-16T01:00:00.000Z'),
      maxDepth: 2,
      maxPages: 20,
      maxSeeds: 20,
      fetchDelayMs: 0,
    });

    assert.equal(result.status, 'success');
    assert.equal(result.skillId, 'tencent-news');
    assert.equal(result.summary.activeCapabilities >= 1, true);
    assert.equal(result.summary.verificationStatus, 'passed');
    assert.equal(result.summary.registryStatus, 'registered');

    await assertArtifactsExist(result.artifactDir, [
      'crawl_static.json',
      'crawl_rendered.json',
      'network_traces.json',
      'interactions.json',
      ...REQUIRED_BUILD_ARTIFACTS,
    ]);

    const site = await readJson(path.join(result.artifactDir, 'site.json'));
    assert.equal(site.normalizedUrl, rootUrl);
    assert.equal(site.rootUrl, rootUrl);
    assert.equal(site.allowedDomains.includes(new URL(rootUrl).hostname), true);

    const isDisallowed = (urlValue) => /\/(?:qqfile|sv1|answer)\//u.test(new URL(urlValue).pathname);
    const seeds = await readJson(path.join(result.artifactDir, 'seeds.json'));
    assert.equal(seeds.seeds.length >= 3, true);
    assert.equal(seeds.seeds.every((seed) => seed.source && seed.confidence && seed.evidence?.length), true);
    assert.equal(seeds.seeds.some((seed) => isDisallowed(seed.normalizedUrl)), false);
    assert.equal(seeds.robots.status, 'parsed');
    assert.deepEqual(seeds.robots.disallowPaths, ['/answer/', '/qqfile/', '/sv1/']);
    assert.equal(seeds.robots.excludedUrls.some((urlValue) => /\/qqfile\//u.test(urlValue)), true);
    assert.equal(seeds.robots.excludedUrls.some((urlValue) => /\/sv1\//u.test(urlValue)), true);
    assert.equal(seeds.robots.excludedUrls.some((urlValue) => /\/answer\//u.test(urlValue)), true);

    const crawlStatic = await readJson(path.join(result.artifactDir, 'crawl_static.json'));
    assert.equal(crawlStatic.pages.some((page) => isDisallowed(page.normalizedUrl)), false);
    assert.equal(crawlStatic.summary.maxDepth, 2);
    assert.equal(crawlStatic.summary.maxPages, 20);

    const graph = await readJson(path.join(result.artifactDir, 'graph.json'));
    const classifiedGraph = await readJson(path.join(result.artifactDir, 'classified_graph.json'));
    assert.equal(graph.nodes.some((node) => node.classification === 'homepage' || node.routePattern === '/'), true);
    assert.equal(classifiedGraph.nodes.some((node) => node.classification === 'news_channel'), true);
    assert.equal(classifiedGraph.nodes.some((node) => node.classification === 'article_detail'), true);
    assert.equal(classifiedGraph.nodes.every((node) => node.discoveredBy && node.evidence?.length), true);

    const affordances = await readJson(path.join(result.artifactDir, 'affordances.json'));
    assert.equal(Array.isArray(affordances.affordances), true);

    const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
    const activeCapabilities = capabilities.capabilities.filter((capability) => capability.status === 'active');
    const activeNames = new Set(activeCapabilities.map((capability) => capability.name));
    assert.equal(activeNames.has('view news homepage'), true);
    assert.equal(activeNames.has('browse news channels'), true);
    assert.equal(activeNames.has('view news article details'), true);
    assert.equal(activeCapabilities.every((capability) => capability.safetyLevel === 'read_only'), true);
    assert.equal(activeCapabilities.every((capability) => capability.evidence?.length > 0), true);
    assert.equal(activeCapabilities.some((capability) => /search|comment|login|upload|payment|account/iu.test(capability.name)), false);

    const intents = await readJson(path.join(result.artifactDir, 'intents.json'));
    const capabilityIds = new Set(capabilities.capabilities.map((capability) => capability.id));
    assert.equal(intents.intents.length >= 1, true);
    const newsChannelIntent = intents.intents.find((intent) => intent.canonicalUtterance === 'browse news channels');
    assert.equal(newsChannelIntent?.utteranceExamples?.includes('浏览新闻频道'), true);
    const articleIntent = intents.intents.find((intent) => intent.canonicalUtterance === 'view news article details');
    assert.equal(articleIntent?.utteranceExamples?.includes('打开新闻文章'), true);
    assert.equal(intents.intents.every((intent) => (
      capabilityIds.has(intent.capabilityId)
      || (
        intent.intentSource === 'graph_element'
        && intent.callable === false
        && intent.sourceNodeId
      )
    )), true);

    const safetyPolicy = await readJson(path.join(result.artifactDir, 'safety_policy.json'));
    assert.equal(safetyPolicy.policy.submitForms, false);
    assert.equal(safetyPolicy.policy.allowPayment, false);
    assert.equal(safetyPolicy.policy.allowAccountMutation, false);

    const verificationReport = await readJson(path.join(result.artifactDir, 'verification_report.json'));
    const buildReport = await readJson(path.join(result.artifactDir, 'build_report.json'));
    assert.equal(verificationReport.status, 'passed');
    assert.equal(buildReport.status, 'success');
    assert.equal(Array.isArray(buildReport.warnings), true);
    assert.equal((buildReport.partial_success_reasons ?? []).some((reason) => /Verification did not pass/u.test(reason)), false);
    assert.equal(buildReport.summary.highRiskAutoExecuted, false);
    assert.equal(Boolean(buildReport.artifacts['build_report.json']), true);
    assert.equal(buildReport.summary.unsuccessfulCollections >= 3, true);
    assert.equal(buildReport.collectionOutcomes.total >= 3, true);
    assert.equal(buildReport.collectionOutcomes.unsuccessful.some((item) => (
      item.kind === 'capability'
      && item.target === 'capture network APIs'
      && item.status === 'candidate'
      && item.reasonCode === 'capability-evidence-matrix-incomplete'
    )), false);
    assert.ok(buildReport.collectionOutcomes.unsuccessful.find((item) => (
      item.kind === 'stage'
      && item.target === 'crawlRendered'
      && item.status === 'skipped'
      && item.reasonCode === 'dynamic-unsupported'
    )));
    assert.ok(buildReport.collectionOutcomes.unsuccessful.find((item) => (
      item.kind === 'stage'
      && item.target === 'captureNetworkTraces'
      && item.status === 'skipped'
      && item.reasonCode === 'dynamic-unsupported'
    )));
    const summaryText = renderSiteForgeBuildSummary(result, { cwd: workspace });
    assert.match(summaryText, /SiteForge build:/u);
    assert.match(summaryText, /Capabilities:/u);
    assert.match(summaryText, /Report:/u);
    assert.doesNotMatch(summaryText, /操作：|搜索：|Space|Enter|自动探索|能力统计|能力摘要|建议/u);
    assert.doesNotMatch(summaryText, /鏈垚鍔熼噰闆唡\| 绫诲瀷 \| 瀵硅薄 \| 鐘舵€?\| 鍘熷洜 \|/u);

    const homepageLookup = await lookupSkillIntent({
      registryPath: result.workspace.registryPath,
      domain: new URL(rootUrl).hostname,
      utterance: 'view news homepage',
    });
    assert.equal(homepageLookup.status, 'found');
    assert.equal(homepageLookup.skillId, 'tencent-news');
    // @ts-ignore
    assert.equal(homepageLookup.capabilityName, 'view news homepage');

    const channelLookup = await lookupSkillIntent({
      registryPath: result.workspace.registryPath,
      domain: new URL(rootUrl).hostname,
      utterance: 'browse news channels',
    });
    assert.equal(channelLookup.status, 'found');
    // @ts-ignore
    assert.equal(channelLookup.capabilityName, 'browse news channels');
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('failed SiteForge builds keep current skill, registry, and last success stable', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-isolation-'));
  try {
    let mode = 'success';
    let routes = {};
    await withTestServer((request, response) => {
      const requestPath = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      if (mode === 'failed') {
        if (requestPath === '/robots.txt') {
          response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('User-agent: *\nAllow: /\n');
          return;
        }
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }
      const route = routes[requestPath] ?? routes[requestPath.replace(/\/$/u, '')] ?? null;
      if (!route) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }
      response.writeHead(200, { 'content-type': route.contentType ?? 'text/html; charset=utf-8' });
      response.end(route.body ?? route);
    }, async (rootUrl) => {
      routes = simpleShopRoutes(rootUrl);
      const success = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'success-build',
        now: new Date('2026-05-16T05:00:00.000Z'),
        fetchDelayMs: 0,
      });
      const siteRoot = siteWorkspaceDir(workspace, rootUrl);
      const currentSkillPath = path.join(siteRoot, 'current', 'skill.yaml');
      const registryPath = path.join(siteRoot, 'registry.json');
      const lastSuccessfulPath = path.join(siteRoot, 'last_successful_build.json');
      const currentSkillBefore = await readFile(currentSkillPath, 'utf8');
      const registryBefore = await readFile(registryPath, 'utf8');
      const lastSuccessfulBefore = await readFile(lastSuccessfulPath, 'utf8');

      mode = 'failed';
      await assert.rejects(
        () => runSiteForgeBuild(rootUrl, {
          cwd: workspace,
          buildId: 'failed-build',
          now: new Date('2026-05-16T06:00:00.000Z'),
          fetchDelayMs: 0,
        }),
        /Static crawl produced no pages with evidence/u,
      );

      assert.equal(await readFile(currentSkillPath, 'utf8'), currentSkillBefore);
      assert.equal(await readFile(registryPath, 'utf8'), registryBefore);
      assert.equal(await readFile(lastSuccessfulPath, 'utf8'), lastSuccessfulBefore);
      assert.equal((await readJson(lastSuccessfulPath)).buildId, success.buildId);

      const failedReport = await readJson(path.join(siteRoot, 'builds', 'failed-build', 'build_report.json'));
      assert.doesNotMatch(JSON.stringify(failedReport), /Static crawl produced no pages with evidence/u);
      assert.equal(failedReport.status, 'blocked');
      assert.equal(failedReport.failedStage, 'crawlStatic');
      assert.equal(['empty-crawl', 'network-fetch-failed'].includes(failedReport.reasonCode), true);
      assert.equal(failedReport.summary.registryStatus, null);
      assert.equal(failedReport.summary.unsuccessfulCollections, failedReport.collectionOutcomes.total);
      assert.ok(failedReport.collectionOutcomes.unsuccessful.find((item) => (
        item.kind === 'stage'
        && item.target === 'crawlStatic'
        && item.status === 'blocked'
        && ['empty-crawl', 'network-fetch-failed'].includes(item.reasonCode)
      )));
      assert.ok(failedReport.collectionOutcomes.unsuccessful.find((item) => (
        item.kind === 'node'
        && item.target === 'classifyNodes'
        && item.status === 'skipped'
        && item.reasonCode === 'stage-skipped'
      )));
      assert.ok(failedReport.collectionOutcomes.unsuccessful.find((item) => (
        item.kind === 'affordance'
        && item.target === 'extractAffordances'
        && item.status === 'skipped'
        && item.reasonCode === 'stage-skipped'
      )));
      assert.ok(failedReport.collectionOutcomes.unsuccessful.find((item) => (
        item.kind === 'capability'
        && item.target === 'discoverCapabilities'
        && item.status === 'skipped'
        && item.reasonCode === 'stage-skipped'
      )));
      const failedSummaryText = renderSiteForgeBuildSummary(failedReport, { cwd: workspace });
      assert.match(failedSummaryText, /SiteForge build:/u);
      assert.match(failedSummaryText, /Report:/u);
      assert.doesNotMatch(failedSummaryText, /操作：|搜索：|Space|Enter|输出结果|建议/u);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
test('public SiteForge CLI first run without a profile auto-builds from a local HTTP site', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-cli-'));
  try {
    await withTestSite(simpleShopRoutes, async (rootUrl) => {
      const result = await spawnNode([CLI_PATH, 'build', rootUrl], {
        cwd: workspace,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /SiteForge build:/u);
      assert.match(result.stdout, /Capabilities:/u);
      assert.match(result.stdout, /Report:/u);
      assert.doesNotMatch(result.stdout, /操作：|搜索：|Space|Enter|输出结果|自动探索|能力统计|能力摘要|建议/u);

      const buildDirs = await listBuildDirs(siteBuildsDir(workspace, rootUrl));
      assert.equal(buildDirs.length, 1);
      const artifactDir = buildDirs[0];
      assert.equal(await fileExists(path.join(artifactDir, 'build_report.json')), true);

      const setupPaths = buildSetupAssistantPaths(rootUrl, {
        cwd: workspace,
        buildId: path.basename(artifactDir),
      });
      await assertArtifactsExist(setupPaths.setupDir, ['setup_plan.json']);
      assert.equal(await fileExists(setupPaths.userChoicesPath), true);
      assert.equal(await fileExists(setupPaths.capabilityHintsPath), true);
      assert.equal(await fileExists(setupPaths.savedBuildProfilePath), true);
      const setupPlan = await readJson(setupPaths.setupPlanPath);
      assert.equal(setupPlan.artifactFamily, 'siteforge-setup-plan');
      assert.equal(setupPlan.site.rootUrl, rootUrl);
      assert.equal(setupPlan.pageGroups.some((group) => group.id === 'products'), true);
      assert.equal(setupPlan.unsafeActionDefaults.payment, false);
      assert.equal(setupPlan.skillContract.willNot.some((entry) => /自动提交|鑷姩鎻愪氦/u.test(entry)), true);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('public SiteForge CLI records local authorized source contracts without treating them as crawl bypasses', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-cli-authorized-sources-'));
  try {
    await withTestSite(simpleShopRoutes, async (rootUrl) => {
      await writeFile(
        path.join(workspace, 'siteforge.local.json'),
        JSON.stringify({
          sites: [
            {
              url: rootUrl,
              build: {
                maxSitemaps: 3,
              },
              authorizedSources: [
                {
                  id: 'official-feed',
                  kind: 'rss',
                  url: '/feed.xml',
                  accessBasis: 'site_docs',
                  permissionScope: 'public metadata only',
                  allowedEvidence: ['response_shape', 'schema_hash'],
                },
              ],
            },
          ],
        }),
        'utf8',
      );
      const result = await spawnNode([CLI_PATH, 'build', rootUrl], {
        cwd: workspace,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

      const buildDirs = await listBuildDirs(siteBuildsDir(workspace, rootUrl));
      assert.equal(buildDirs.length, 1);
      const artifactDir = buildDirs[0];
      const setupPaths = buildSetupAssistantPaths(rootUrl, {
        cwd: workspace,
        buildId: path.basename(artifactDir),
      });
      const setupPlan = await readJson(setupPaths.setupPlanPath);
      assert.equal(setupPlan.localBuildConfig.build.maxSitemaps, 3);
      assert.equal(setupPlan.localBuildConfig.authorizedSources.length, 1);
      assert.equal(setupPlan.localBuildConfig.authorizedSources[0].genericCrawlAllowed, false);
      assert.equal(setupPlan.localBuildConfig.authorizedSources[0].promotionAllowed, false);

      const buildReport = await readJson(path.join(artifactDir, 'build_report.json'));
      assert.equal(buildReport.summary.authorizedSources.configured, 1);
      assert.equal(buildReport.summary.authorizedSources.sources[0].kind, 'rss');
      assert.equal(buildReport.summary.authorizedSources.sources[0].genericCrawlAllowed, false);
      assert.equal(buildReport.summary.authorizedSources.sources[0].promotionAllowed, false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('authorized source structure summary can build when robots blocks generic crawl', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-cli-authorized-source-only-'));
  const requestedPaths = [];
  try {
    await withTestServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1/');
      requestedPaths.push(requestUrl.pathname);
      if (requestUrl.pathname === '/robots.txt') {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('User-agent: *\nDisallow: /\n');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>Blocked public page</title><main>robots blocked</main>');
    }, async (rootUrl) => {
      await writeFile(
        path.join(workspace, 'siteforge.local.json'),
        JSON.stringify({
          sites: [
            {
              url: rootUrl,
              authorizedSources: [
                {
                  id: 'manual-catalog-summary',
                  kind: 'structure-summary',
                  url: '/manual/categories',
                  accessBasis: 'user_redacted_summary',
                  permissionScope: 'sanitized_summary_only',
                  allowedEvidence: ['route_template', 'visible_item_count', 'structure_hash'],
                  structurePages: [
                    {
                      url: '/manual/categories',
                      title: '分类入口摘要',
                      pageType: 'category_list',
                      routeTemplate: '/manual/categories',
                      visibleItemCount: 2,
                      listPresent: true,
                      routeTemplates: ['/manual/category/:slug'],
                      links: [
                        {
                          href: '/manual/channel/recommend',
                          label: '\u63a8\u8350\u9891\u9053',
                          semanticKind: 'category',
                          routeTemplate: '/manual/channel/recommend',
                        },
                        {
                          href: '/manual/ranking/hot',
                          label: '\u70ed\u95e8\u699c\u5355',
                          semanticKind: 'ranking',
                          routeTemplate: '/manual/ranking/hot',
                        },
                      ],
                      structureItems: [
                        {
                          nodeType: 'component',
                          structureType: 'category_link_group',
                          labelSummary: '分类入口',
                          visibleItemCount: 2,
                          listPresent: true,
                          routeTemplates: ['/manual/category/:slug'],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
        'utf8',
      );
      const result = await spawnNode([CLI_PATH, 'build', rootUrl], {
        cwd: workspace,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.equal(requestedPaths.includes('/manual/categories'), false);

      const buildDirs = await listBuildDirs(siteBuildsDir(workspace, rootUrl));
      assert.equal(buildDirs.length, 1);
      const artifactDir = buildDirs[0];
      const setupPaths = buildSetupAssistantPaths(rootUrl, {
        cwd: workspace,
        buildId: path.basename(artifactDir),
      });
      const setupPlan = await readJson(setupPaths.setupPlanPath);
      assert.equal(setupPlan.buildReadiness.reasonCode, 'setup-authorized-source-evidence');
      assert.equal(setupPlan.evidenceQuality.authorizedSourceStructureEvidenceCount, 1);

      const seeds = await readJson(path.join(artifactDir, 'seeds.json'));
      assert.equal(seeds.status, 'authorized_source_only');
      const crawlStatic = await readJson(path.join(artifactDir, 'crawl_static.json'));
      assert.equal(crawlStatic.summary.publicPages, 0);
      assert.equal(crawlStatic.summary.authorizedSourcePages, 1);
      assert.equal(await fileExists(path.join(artifactDir, 'reports', 'authorized_source_manifest.json')), true);

      const graph = await readJson(path.join(artifactDir, 'graph.json'));
      assert.equal(graph.nodes.some((node) => node.sourceLayer === 'authorized_source'), true);
      assert.equal(graph.nodes.some((node) => (
        node.sourceLayer === 'authorized_source'
        && node.categoryInstance?.kind === 'category'
        && node.categoryInstance?.label === '\u63a8\u8350\u9891\u9053'
      )), true);
      assert.equal(graph.nodes.some((node) => (
        node.sourceLayer === 'authorized_source'
        && node.categoryInstance?.kind === 'ranking'
        && node.categoryInstance?.label === '\u70ed\u95e8\u699c\u5355'
      )), true);
      const capabilities = await readJson(path.join(artifactDir, 'capabilities.json'));
      assert.equal(capabilities.capabilities.some((capability) => capability.status === 'active' && capability.sourceLayer === 'authorized_source'), true);
      assert.equal(capabilities.capabilities.some((capability) => (
        capability.status === 'active'
        && capability.sourceLayer === 'authorized_source'
        && capability.elementRole === 'category'
        && capability.object === '\u63a8\u8350\u9891\u9053'
        && capability.userValue === '\u6d4f\u89c8\u63a8\u8350\u9891\u9053'
      )), true);
      assert.equal(capabilities.capabilities.some((capability) => (
        capability.status === 'active'
        && capability.sourceLayer === 'authorized_source'
        && capability.elementRole === 'ranking'
        && capability.object === '\u70ed\u95e8\u699c\u5355'
        && capability.userValue === '\u67e5\u770b\u70ed\u95e8\u699c\u5355'
      )), true);
      const intents = await readJson(path.join(artifactDir, 'intents.json'));
      assert.equal(intents.intents.some((intent) => intent.canonicalUtterance === '\u6d4f\u89c8\u63a8\u8350\u9891\u9053'), true);
      assert.equal(intents.intents.some((intent) => intent.canonicalUtterance === '\u67e5\u770b\u70ed\u95e8\u699c\u5355'), true);
      const buildReport = await readJson(path.join(artifactDir, 'build_report.json'));
      assert.ok(buildReport.artifacts['authorized_source_manifest.json']);
      assert.equal(buildReport.summary.coverage.authorizedSource.pages, 1);
      assert.equal(buildReport.summary.coverage.public.pages, 0);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('public SiteForge CLI reads local cookie config and fails closed when auth check rejects it', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-cli-cookie-config-'));
  try {
    await withTestSite((rootUrl) => ({
      ...simpleShopRoutes(rootUrl),
      '/account': {
        status: 403,
        body: 'Forbidden',
      },
    }), async (rootUrl) => {
      await writeFile(
        path.join(workspace, 'siteforge.local.json'),
        JSON.stringify({
          sites: [
            {
              url: rootUrl,
              cookie: 'sid=SECRET_SESSION_VALUE; uid=123',
            },
          ],
        }),
        'utf8',
      );
      const result = await spawnNode([CLI_PATH, 'build', rootUrl], {
        cwd: workspace,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /SECRET_SESSION_VALUE|sid=|uid=123/u);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('public SiteForge CLI reads local cookie config auth routes and runs authenticated crawl', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-cli-cookie-config-auth-routes-'));
  const secretCookie = 'sid=SECRET_SESSION_VALUE; uid=123';
  try {
    await withTestSite((rootUrl) => ({
      ...simpleShopRoutes(rootUrl),
      '/account': testHtmlPage('Account dashboard', `
        <main>
          <h1>Account dashboard</h1>
          <ul><li>Authenticated summary item</li></ul>
          <a href="/products.html">Products revisit</a>
        </main>
      `),
    }), async (rootUrl) => {
      await writeFile(
        path.join(workspace, 'siteforge.local.json'),
        JSON.stringify({
          sites: [
            {
              url: rootUrl,
              auth: {
                mode: 'cookie',
                cookieEnv: 'SITEFORGE_TEST_COOKIE',
                authCheckUrl: '/account',
                authRoutes: ['/account'],
                publicRevisitRoutes: ['/'],
              },
            },
          ],
        }),
        'utf8',
      );
      const result = await spawnNode([CLI_PATH, 'build', rootUrl], {
        cwd: workspace,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          SITEFORGE_TEST_COOKIE: secretCookie,
        },
      });

      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /SECRET_SESSION_VALUE|sid=|uid=123/u);
      const buildDirs = await listBuildDirs(siteBuildsDir(workspace, rootUrl));
      assert.equal(buildDirs.length, 1);
      const artifactDir = buildDirs[0];
      const authState = await readJson(path.join(artifactDir, 'auth_state_report.json'));
      assert.equal(authState.authMethod, 'cookie');
      assert.equal(authState.authVerificationStatus, 'cookie_verified');
      assert.equal(authState.verified, true);
      assert.equal(authState.cookieInput.persisted, false);
      assert.equal(authState.cookieInput.redacted, true);
      const seeds = await readJson(path.join(artifactDir, 'seeds.json'));
      assert.equal(seeds.authSeeds.some((seed) => /\/account$/u.test(seed.normalizedUrl)), true);
      const authenticated = await readJson(path.join(artifactDir, 'crawl_authenticated.json'));
      assert.equal(authenticated.authCoverageSummary.authenticatedPages >= 1, true);
      assert.equal(authenticated.authenticatedPages.some((page) => /\/account$/u.test(page.normalizedUrl)), true);
      const buildReport = await readJson(path.join(artifactDir, 'build_report.json'));
      assert.equal(buildReport.summary.auth.authMethod, 'cookie');
      assert.equal(buildReport.summary.auth.authVerificationStatus, 'cookie_verified');
      assert.equal(buildReport.summary.coverage.authenticated.pages >= 1, true);
      assert.equal(buildReport.summary.coverage.authenticated.capabilities >= 1, true);
      const capabilities = await readJson(path.join(artifactDir, 'capabilities.json'));
      const authenticatedSummaryCapability = capabilities.capabilities.find((capability) => capability.name === 'read authenticated route summaries');
      assert.equal(authenticatedSummaryCapability?.status, 'active');
      assert.equal(authenticatedSummaryCapability?.enabled_status, 'limited_enabled');
      assert.equal(authenticatedSummaryCapability?.authRequired, true);
      assert.equal(authenticatedSummaryCapability?.evidenceMatrix?.missingEvidence?.length, 0);
      assert.equal(authenticatedSummaryCapability?.executionPlan?.mode, 'limited_read');
      assert.equal(authenticatedSummaryCapability?.executionPlan?.steps?.every((step) => step.kind === 'read_sanitized_summary'), true);
      const userReport = await readJson(path.join(artifactDir, 'build_report.user.json'));
      assert.equal(userReport.limited_enabled_capabilities.some((capability) => capability.name === 'read authenticated route summaries'), true);
      const reportText = [
        await readFile(path.join(artifactDir, 'auth_state_report.json'), 'utf8'),
        await readFile(path.join(artifactDir, 'build_report.json'), 'utf8'),
        await readFile(path.join(artifactDir, 'build_report.debug.json'), 'utf8'),
        await readFile(path.join(artifactDir, 'build_report.user.json'), 'utf8'),
        await readFile(path.join(artifactDir, 'reports', 'capability_intent_summary.html'), 'utf8'),
      ].join('\n');
      assert.doesNotMatch(reportText, /SECRET_SESSION_VALUE|sid=|uid=123/u);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('public SiteForge CLI enables route-only authenticated capability for configured routes', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-cli-cookie-route-only-'));
  const secretCookie = 'sid=SECRET_SESSION_VALUE; uid=123';
  try {
    await withTestSite((rootUrl) => ({
      ...simpleShopRoutes(rootUrl),
      '/account': testHtmlPage('Account dashboard', `
        <main>
          <h1>Account dashboard</h1>
          <p>Authenticated route is reachable.</p>
        </main>
      `),
    }), async (rootUrl) => {
      await writeFile(
        path.join(workspace, 'siteforge.local.json'),
        JSON.stringify({
          sites: [
            {
              url: rootUrl,
              auth: {
                mode: 'cookie',
                cookieEnv: 'SITEFORGE_TEST_COOKIE',
                authCheckUrl: '/account',
                authRoutes: ['/account'],
              },
            },
          ],
        }),
        'utf8',
      );
      const result = await spawnNode([CLI_PATH, 'build', rootUrl], {
        cwd: workspace,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          SITEFORGE_TEST_COOKIE: secretCookie,
        },
      });

      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /SECRET_SESSION_VALUE|sid=|uid=123/u);
      const buildDirs = await listBuildDirs(siteBuildsDir(workspace, rootUrl));
      assert.equal(buildDirs.length, 1);
      const artifactDir = buildDirs[0];
      const capabilities = await readJson(path.join(artifactDir, 'capabilities.json'));
      const routeOnlyCapability = capabilities.capabilities.find((capability) => capability.name === 'open authenticated configured routes');
      assert.equal(routeOnlyCapability?.status, 'active');
      assert.equal(routeOnlyCapability?.enabled_status, 'limited_enabled');
      assert.equal(routeOnlyCapability?.authRequired, true);
      assert.equal(routeOnlyCapability?.evidenceModel, 'authenticated_route_only');
      assert.equal(routeOnlyCapability?.evidenceMatrix?.missingEvidence?.length, 0);
      assert.equal(routeOnlyCapability?.evidenceMatrix?.requiredEvidence.includes('list_container_present'), false);
      assert.equal(routeOnlyCapability?.evidenceMatrix?.requiredEvidence.includes('visible_item_count_or_empty_state'), false);
      assert.equal(routeOnlyCapability?.executionPlan?.mode, 'limited_read');
      assert.equal(routeOnlyCapability?.executionPlan?.steps?.every((step) => step.kind === 'open_configured_authenticated_route'), true);
      const reportText = [
        await readFile(path.join(artifactDir, 'auth_state_report.json'), 'utf8'),
        await readFile(path.join(artifactDir, 'build_report.json'), 'utf8'),
        await readFile(path.join(artifactDir, 'build_report.user.json'), 'utf8'),
      ].join('\n');
      assert.doesNotMatch(reportText, /SECRET_SESSION_VALUE|sid=|uid=123/u);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('public SiteForge CLI writes setup-blocked reports before crawl', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-cli-setup-blocked-'));
  try {
    await withTestSite((rootUrl) => ({
      '/robots.txt': {
        contentType: 'text/plain; charset=utf-8',
        body: testRobotsTxt(rootUrl, { disallow: '/', sitemap: false }),
      },
      '/': testHtmlPage('Robots blocked', '<main>Robots blocked.</main>'),
    }), async (rootUrl) => {
      const result = await spawnNode([CLI_PATH, 'build', rootUrl], {
        cwd: workspace,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stdout, /Page reconciliation: blocked/u);
      assert.match(result.stdout, /page_reconciliation_report\.json/u);
      assert.match(result.stdout, /robots_remediation_plan\.json/u);
      assert.match(result.stdout, /capability_intent_summary\.html/u);
      const buildDirs = await listBuildDirs(siteBuildsDir(workspace, rootUrl));
      assert.equal(buildDirs.length, 1);
      const buildReport = await readJson(path.join(buildDirs[0], 'build_report.json'));
      const userReport = await readJson(path.join(buildDirs[0], 'build_report.user.json'));
      const pageReconciliation = await readJson(path.join(buildDirs[0], 'page_reconciliation_report.json'));
      const reportsPageReconciliation = await readJson(path.join(buildDirs[0], 'reports', 'page_reconciliation_report.json'));
      const robotsRemediationPlan = await readJson(path.join(buildDirs[0], 'reports', 'robots_remediation_plan.json'));
      const htmlReport = await readFile(path.join(buildDirs[0], 'reports', 'capability_intent_summary.html'), 'utf8');
      assert.equal(buildReport.result_status, 'failed');
      assert.equal(buildReport.failedStage, 'setup');
      assert.equal(buildReport.reasonCode, 'setup-robots-disallowed');
      assert.equal(buildReport.failureClass, 'robots');
      assert.equal(buildReport.summary.pageReconciliation.setupBlocked, true);
      assert.deepEqual(buildReport.summary.coverage.blockedByAuth, []);
      assert.equal(buildReport.summary.auth.authMethod, 'none');
      assert.equal(buildReport.summary.auth.authVerificationStatus, 'not_requested');
      assert.match(buildReport.artifacts['capability_intent_summary.html'], /capability_intent_summary\.html$/u);
      assert.match(buildReport.artifacts['robots_remediation_plan.json'], /robots_remediation_plan\.json$/u);
      assert.equal(buildReport.report_index.available_reports.includes('page_reconciliation_report'), true);
      assert.equal(buildReport.report_index.available_reports.includes('robots_remediation_plan'), true);
      assert.equal(userReport.reason_code, 'setup-robots-disallowed');
      assert.match(userReport.reports.capability_intent_summary_html, /capability_intent_summary\.html$/u);
      assert.match(userReport.reports.page_reconciliation_report, /page_reconciliation_report\.json$/u);
      assert.match(userReport.reports.robots_remediation_plan, /robots_remediation_plan\.json$/u);
      assert.equal(userReport.next_step_workflows.some((workflow) => workflow.id === 'robots-remediation-plan'), true);
      assert.equal(userReport.next_step_workflows.every((workflow) => workflow.promotionAllowed === false), true);
      assert.equal(pageReconciliation.summary.setupBlocked, true);
      assert.equal(pageReconciliation.status, 'blocked');
      assert.equal(pageReconciliation.summary.reasonCodes.includes('setup_blocked_before_crawl'), true);
      assert.equal(reportsPageReconciliation.summary.setupBlocked, true);
      assert.equal(robotsRemediationPlan.status, 'blocked');
      assert.equal(robotsRemediationPlan.reasonCode, 'setup-robots-disallowed');
      assert.equal(Array.isArray(robotsRemediationPlan.recommendedPaths), true);
      assert.equal(robotsRemediationPlan.recommendedPaths.length >= 1, true);
      assert.equal(Array.isArray(robotsRemediationPlan.workflows), true);
      assert.equal(robotsRemediationPlan.workflows.length >= 3, true);
      assert.equal(robotsRemediationPlan.workflows.every((workflow) => workflow.genericCrawlAllowed === false), true);
      assert.equal(robotsRemediationPlan.workflows.every((workflow) => workflow.updatesCurrent === false), true);
      assert.equal(robotsRemediationPlan.workflows.every((workflow) => workflow.updatesRegistry === false), true);
      assert.equal(robotsRemediationPlan.workflows.some((workflow) => workflow.kind === 'manual_summary'), true);
      assert.equal(robotsRemediationPlan.workflows.some((workflow) => workflow.kind === 'official_api_or_feed'), true);
      assert.equal(robotsRemediationPlan.workflows.some((workflow) => workflow.kind === 'local_http_validation'), true);
      assert.doesNotMatch(JSON.stringify(robotsRemediationPlan), /SECRET|sid=|uid=|Authorization|Bearer|userDataDir/iu);
      assert.equal(pageReconciliation.safety.cookiePersisted, false);
      assert.match(htmlReport, /<html lang="zh-CN">/u);
      assert.doesNotMatch(htmlReport, /sid=|uid=|token=|\bauthorization\b|\bbearer\b/iu);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('public SiteForge CLI prints machine-readable robots plan JSON', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-robots-plan-json-'));
  try {
    await withTestSite((rootUrl) => ({
      '/robots.txt': {
        contentType: 'text/plain; charset=utf-8',
        body: testRobotsTxt(rootUrl, { disallow: '/', sitemap: false }),
      },
      '/': testHtmlPage('Robots blocked', '<main>Robots blocked.</main>'),
    }), async (rootUrl) => {
      const result = await spawnNode([CLI_PATH, 'build', rootUrl, '--robots-plan'], {
        cwd: workspace,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      assert.notEqual(result.status, 0);
      const plan = JSON.parse(result.stdout);
      assert.equal(plan.artifactFamily, 'siteforge-access-remediation-plan');
      assert.equal(plan.retryDisposition, 'blocked_no_bypass');
      assert.equal(plan.workflows.some((workflow) => workflow.kind === 'manual_summary'), true);
      assert.equal(plan.workflows.every((workflow) => workflow.genericCrawlAllowed === false), true);
      assert.doesNotMatch(result.stdout, /SECRET|sid=|uid=|Authorization|Bearer|userDataDir/iu);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('interactive first-run setup persists profile artifacts with unsafe actions disabled', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-setup-interactive-'));
  try {
    await withTestSite(simpleShopRoutes, async (rootUrl) => {
    const setup = await prepareSiteForgeBuildSetup(rootUrl, {
      cwd: workspace,
      buildId: 'setup-interactive',
      now: new Date('2026-05-16T03:00:00.000Z'),
      setupInteractive: true,
      setupOutput: { write() {} },
      setupPrompt: async () => '',
    });

    assert.equal(setup.status, 'created');
    await assertArtifactsExist(setup.paths.setupDir, [
      'setup_plan.json',
      'user_choices.json',
      'capability_hints.json',
      'build_profile.json',
    ]);
    assert.equal(await fileExists(setup.paths.buildProfilePath), true);
    assert.equal(await fileExists(setup.paths.savedBuildProfilePath), true);

    const userChoices = await readJson(setup.paths.userChoicesPath);
    const capabilityHints = await readJson(setup.paths.capabilityHintsPath);
    const buildProfile = await readJson(setup.paths.buildProfilePath);
    assert.equal(userChoices.acceptedDefaultRecommendation, true);
    assert.equal(capabilityHints.disabledUnsafeActions.login, false);
    assert.equal(buildProfile.safety.allowPayment, false);
    assert.equal(buildProfile.safety.allowContactSubmit, false);
    assert.equal(setup.buildOptions.maxDepth, 8);
    assert.equal(setup.buildOptions.maxPages >= 1000, true);
    assert.equal(setup.buildOptions.maxSeeds >= 5000, true);
    assert.equal(setup.buildOptions.submitForms, false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('public SiteForge CLI reuses saved setup profile and then builds the local HTTP simple-shop site', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-cli-profile-'));
  try {
    await withTestSite(simpleShopRoutes, async (rootUrl) => {
      await prepareSiteForgeBuildSetup(rootUrl, {
        cwd: workspace,
        buildId: 'setup-profile',
        now: new Date('2026-05-16T04:00:00.000Z'),
        setupInteractive: true,
        setupOutput: { write() {} },
        setupPrompt: async () => 'focus search',
        fetchDelayMs: 0,
      });
      const setupPaths = buildSetupAssistantPaths(rootUrl, {
        cwd: workspace,
        buildId: 'setup-profile',
        now: new Date('2026-05-16T04:00:00.000Z'),
      });
      assert.equal(await fileExists(setupPaths.savedBuildProfilePath), true);

      const result = await spawnNode([CLI_PATH, 'build', rootUrl], {
        cwd: workspace,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /SiteForge build:/u);
      assert.match(result.stdout, /Capabilities:/u);
      assert.match(result.stdout, /Report:/u);
      assert.doesNotMatch(result.stdout, /操作：|搜索：|Space|Enter|输出结果|自动探索|能力统计|能力摘要|建议/u);
      assert.match(result.stdout, /simple-shop/u);

      const buildDirs = await listBuildDirs(siteBuildsDir(workspace, rootUrl));
      assert.equal(buildDirs.length, 2);
      const artifactDir = buildDirs.find((candidate) => path.basename(candidate) !== 'setup-profile');
      assert.ok(artifactDir);
      const buildReport = await readJson(path.join(artifactDir, 'build_report.json'));
      const verificationReport = await readJson(path.join(artifactDir, 'verification_report.json'));
      const buildProfile = await readJson(path.join(artifactDir, 'inputs', 'build_profile.json'));
      assert.equal(buildReport.status, 'success');
      assert.equal(verificationReport.status, 'passed');
      assert.equal(buildReport.summary.highRiskAutoExecuted, false);
      assert.equal(buildProfile.source.type, 'live_website');
      assert.equal(buildProfile.safety.allowAccountMutation, false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
test('public SiteForge CLI builds the local HTTP Tencent News site without extra params', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-news-http-cli-profile-'));
  try {
    await withTestSite(tencentNewsRoutes, async (rootUrl) => {
      await prepareSiteForgeBuildSetup(rootUrl, {
        cwd: workspace,
        buildId: 'news-http-setup-profile',
        now: new Date('2026-05-16T04:30:00.000Z'),
        setupInteractive: true,
        setupOutput: { write() {} },
        setupPrompt: async () => 'shallow news content',
        fetchDelayMs: 0,
      });
      const setupPaths = buildSetupAssistantPaths(rootUrl, {
        cwd: workspace,
        buildId: 'news-http-setup-profile',
        now: new Date('2026-05-16T04:30:00.000Z'),
      });
      assert.equal(await fileExists(setupPaths.savedBuildProfilePath), true);

      const result = await spawnNode([CLI_PATH, 'build', rootUrl], {
        cwd: workspace,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /SiteForge build:/u);
      assert.match(result.stdout, /Capabilities:/u);
      assert.doesNotMatch(result.stdout, /操作：|搜索：|Space|Enter|自动探索|能力统计|能力摘要|建议/u);
      assert.match(result.stdout, /tencent-news/u);

      const buildDirs = await listBuildDirs(siteBuildsDir(workspace, rootUrl));
      assert.equal(buildDirs.length, 2);
      const artifactDir = buildDirs.find((candidate) => path.basename(candidate) !== 'news-http-setup-profile');
      assert.ok(artifactDir);

      const seeds = await readJson(path.join(artifactDir, 'seeds.json'));
      const crawlStatic = await readJson(path.join(artifactDir, 'crawl_static.json'));
      const capabilities = await readJson(path.join(artifactDir, 'capabilities.json'));
      const safetyPolicy = await readJson(path.join(artifactDir, 'safety_policy.json'));
      const buildReport = await readJson(path.join(artifactDir, 'build_report.json'));

      const isDisallowed = (urlValue) => /\/(?:qqfile|sv1|answer)\//u.test(new URL(urlValue).pathname);
      assert.equal(seeds.robots.status, 'parsed');
      assert.equal(seeds.seeds.some((seed) => isDisallowed(seed.normalizedUrl)), false);
      assert.equal(crawlStatic.pages.some((page) => isDisallowed(page.normalizedUrl)), false);
      assert.equal(crawlStatic.pages.every((page) => page.evidence.some((evidence) => evidence.type === 'url')), true);
      assert.equal(capabilities.capabilities
        .filter((capability) => capability.status === 'active')
        .every((capability) => capability.safetyLevel === 'read_only' && capability.evidence.length > 0), true);
      assert.equal(safetyPolicy.policy.submitForms, false);
      assert.equal(safetyPolicy.policy.allowPayment, false);
      assert.equal(safetyPolicy.policy.allowAccountMutation, false);
      assert.equal(buildReport.summary.highRiskAutoExecuted, false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
test('SiteForge build_report classifies robots-disallowed static blocks', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-robots-disallowed-'));
  try {
    await withTestSite((rootUrl) => ({
      '/robots.txt': { contentType: 'text/plain; charset=utf-8', body: testRobotsTxt(rootUrl, { disallow: '/', sitemap: false }) },
      '/': testHtmlPage('Blocked', '<main>Blocked by robots policy.</main>'),
    }), async (rootUrl) => {
      let capturedError = /** @type {any} */ (null);
      await assert.rejects(
        () => runSiteForgeBuild(rootUrl, {
          cwd: workspace,
          buildId: 'robots-blocked-build',
          now: new Date('2026-05-16T07:00:00.000Z'),
          fetchDelayMs: 0,
        }),
        (error) => {
          capturedError = /** @type {any} */ (error);
          return /robots\.txt disallows all planned seed URLs|Static crawl produced no pages/u.test(String(capturedError?.message ?? ''));
        },
      );

      const buildReport = await readJson(path.join(capturedError.artifactDir, 'build_report.json'));
      assert.equal(buildReport.status, 'blocked');
      assert.equal(['discoverSeeds', 'crawlStatic'].includes(buildReport.failedStage), true);
      assert.equal(buildReport.failureClass, 'robots');
      assert.equal(buildReport.reasonCode, 'robots-disallowed');
      assert.equal(buildReport.warningCodes.includes('robots-disallowed'), true);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
test('SiteForge reports robots unavailable as a live-source blocked build', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-robots-unavailable-'));
  try {
    await withTestSite({
      '/': testHtmlPage('Robots unavailable site', '<main><p>Public homepage content.</p></main>'),
    }, async (rootUrl) => {
      let capturedError = /** @type {any} */ (null);
      await assert.rejects(
        () => runSiteForgeBuild(rootUrl, {
          cwd: workspace,
          buildId: 'robots-unavailable-build',
          now: new Date('2026-05-16T07:10:00.000Z'),
          fetchDelayMs: 0,
        }),
        (error) => {
          capturedError = /** @type {any} */ (error);
          return /robots\.txt unavailable for live SiteForge build/u.test(String(capturedError?.message ?? ''));
        },
      );
      const buildReport = await readJson(path.join(capturedError.artifactDir, 'build_report.json'));
      assert.equal(buildReport.status, 'blocked');
      assert.equal(buildReport.reasonCode, 'robots-unavailable');
      assert.equal(buildReport.warningCodes.includes('robots-unavailable'), true);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
test('SiteForge build_report classifies dynamic-shell static evidence blocks', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-dynamic-shell-'));
  try {
    await withTestSite((rootUrl) => ({
      '/robots.txt': { contentType: 'text/plain; charset=utf-8', body: testRobotsTxt(rootUrl, { sitemap: false }) },
      '/': `
        <div id="app"></div>
        <script src="/app.js"></script>
        <noscript>Please enable JavaScript to use this site.</noscript>
      `,
      '/app.js': 'document.querySelector("#app").textContent = "loaded";',
    }), async (rootUrl) => {
      let capturedError = /** @type {any} */ (null);
      await assert.rejects(
        () => runSiteForgeBuild(rootUrl, {
          cwd: workspace,
          buildId: 'dynamic-shell-build',
          now: new Date('2026-05-16T07:20:00.000Z'),
          fetchDelayMs: 0,
          renderJs: false,
        }),
        (error) => {
          capturedError = /** @type {any} */ (error);
          return /dynamic-shell pages/u.test(String(capturedError?.message ?? ''));
        },
      );

      const buildReport = await readJson(path.join(capturedError.artifactDir, 'build_report.json'));
      assert.equal(buildReport.status, 'blocked');
      assert.equal(buildReport.failureClass, 'unsupported');
      assert.equal(buildReport.reasonCode, 'dynamic-unsupported');
      assert.equal(buildReport.stages.crawlStatic.reasonCode, 'dynamic-unsupported');
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
test('SiteForge build_report classifies crawl network failures', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-network-failure-'));
  try {
    await withTestServer((request, response) => {
      if (request.url === '/robots.txt') {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('User-agent: *\nAllow: /\n');
        return;
      }
      response.writeHead(503, { 'content-type': 'text/plain' });
      response.end('temporary upstream failure');
    }, async (rootUrl) => {
      let capturedError = null;
      await assert.rejects(
        () => runSiteForgeBuild(rootUrl, {
          cwd: workspace,
          buildId: 'network-failure-build',
          now: new Date('2026-05-16T07:25:00.000Z'),
          fetchDelayMs: 0,
          fetchTimeoutMs: 1000,
        }),
        (error) => {
          capturedError = error;
          // @ts-ignore
          return /Static crawl produced no pages/u.test(error?.message ?? '');
        },
      );

      // @ts-ignore
      const buildReport = await readJson(path.join(capturedError.artifactDir, 'build_report.json'));
      assert.equal(buildReport.status, 'blocked');
      assert.equal(buildReport.failureClass, 'network');
      assert.equal(buildReport.reasonCode, 'network-fetch-failed');
      assert.equal(buildReport.warningCodes.includes('network-fetch-failed'), true);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('public SiteForge CLI and build_report expose a stable robots-unavailable reason', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-cli-robots-unavailable-'));
  const inputUrl = 'http://127.0.0.1:1/';
  try {
    const setupPaths = buildSetupAssistantPaths(inputUrl, {
      cwd: workspace,
      buildId: 'robots-unavailable-setup-profile',
      now: new Date('2026-05-16T07:30:00.000Z'),
    });
    await mkdir(setupPaths.setupDir, { recursive: true });
    await writeFile(setupPaths.savedBuildProfilePath, `${JSON.stringify({
      artifactFamily: 'siteforge-build-profile',
      site: {
        rootUrl: inputUrl,
        normalizedUrl: inputUrl,
      },
      source: {
        type: 'live_website',
        requestedUrl: inputUrl,
        finalUrl: inputUrl,
        fetchedAt: '2026-05-16T07:30:00.000Z',
      },
      scope: {
        maxDepth: 1,
        maxPages: 1,
        maxSeeds: 1,
        maxSitemaps: 1,
      },
      profileUsability: {
        schemaVersion: 1,
        status: 'usable',
        buildable: true,
        reasonCode: null,
        reason: null,
      },
      evidenceQuality: {
        schemaVersion: 1,
        sourceAvailability: {
          robots: true,
          homepage: true,
          sitemap: false,
        },
        sourceStatus: {
          robots: 'parsed',
          homepage: 'parsed',
          sitemap: 'unavailable',
        },
        actualPageEvidenceCount: 1,
        syntheticPageEvidenceCount: 0,
        actualPageEvidenceUrls: [inputUrl],
        syntheticFallbackUrls: [],
        robotsExcludedPageEvidenceCount: 0,
        robotsExcludedPageEvidenceUrls: [],
        sitemapUrlsDiscovered: 0,
        sitemapUrlsSampled: 0,
        allPrimarySourcesUnavailable: false,
        syntheticFallbackOnly: false,
        robotsExcludedAllCandidateEvidence: false,
      },
      buildReadiness: {
        schemaVersion: 1,
        status: 'ready',
        buildable: true,
        reasonCode: null,
        reason: 'Test profile contains current setup evidence gates.',
        requiredEvidence: 'At least one non-synthetic public page source from homepage or sitemap.',
      },
      safety: {
        submitForms: false,
        allowDestructiveActions: false,
        allowPayment: false,
        allowAccountMutation: false,
        allowContactSubmit: false,
      },
    }, null, 2)}\n`, 'utf8');

    const result = spawnSync(process.execPath, [CLI_PATH, 'build', inputUrl], {
      cwd: workspace,
      encoding: 'utf8',
      env: {
        ...process.env,
        ALL_PROXY: '',
        all_proxy: '',
        HTTP_PROXY: '',
        http_proxy: '',
        HTTPS_PROXY: '',
        https_proxy: '',
        NO_PROXY: '127.0.0.1,localhost',
        no_proxy: '127.0.0.1,localhost',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /failed|失败/u);
    assert.doesNotMatch(result.stdout, /robots-unavailable/u);
    const buildDirs = await listBuildDirs(siteBuildsDir(workspace, inputUrl));
    assert.equal(buildDirs.length, 1);
    const buildReportPath = path.join(buildDirs[0], 'build_report.json');
    assert.equal(await fileExists(buildReportPath), true);

    const buildReport = await readJson(buildReportPath);
    assert.equal(buildReport.status, 'blocked');
    assert.equal(buildReport.failureClass, 'robots');
    assert.equal(buildReport.reasonCode, 'robots-unavailable');
    assert.equal(buildReport.warningCodes.includes('robots-unavailable'), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('optional live SiteForge build smoke for https://news.qq.com/', {
  skip: LIVE_NEWS_QQ_ENABLED ? false : 'Set SITEFORGE_LIVE_TESTS=1 or SITEFORGE_LIVE_NEWS_QQ=1 to run live Tencent News smoke.',
}, async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-news-qq-live-'));
  try {
    let result;
    try {
      result = await runSiteForgeBuild('https://news.qq.com/', {
        cwd: workspace,
        buildId: 'news-qq-live-smoke',
        now: new Date('2026-05-16T02:00:00.000Z'),
        maxDepth: 1,
        maxPages: 20,
        maxSeeds: 50,
        maxSitemaps: 10,
        fetchDelayMs: 250,
        fetchTimeoutMs: 8000,
      });
    } catch (error) {
      t.diagnostic(`Live Tencent News smoke skipped after preserved artifacts: ${error?.artifactDir ?? 'no artifact dir'}; ${error?.message ?? String(error)}`);
      t.skip('Live Tencent News was unavailable, blocked, rate-limited, or returned unexpected content.');
      return;
    }

    assert.equal(result.status, 'success');
    await assertArtifactsExist(result.artifactDir, REQUIRED_BUILD_ARTIFACTS);
    const seeds = await readJson(path.join(result.artifactDir, 'seeds.json'));
    const crawlStatic = await readJson(path.join(result.artifactDir, 'crawl_static.json'));
    const isDisallowed = (urlValue) => /\/(?:qqfile|sv1|answer)\//u.test(new URL(urlValue).pathname);
    assert.equal(seeds.seeds.some((seed) => isDisallowed(seed.normalizedUrl)), false);
    assert.equal(crawlStatic.pages.some((page) => isDisallowed(page.normalizedUrl)), false);
    assert.equal(result.summary.highRiskAutoExecuted, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
