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
  runSiteForgeBuild,
  siteForgeBuildCliJson,
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
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
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
      assert.deepEqual(fetchCalls, ['/robots.txt']);

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

test('SiteForge build static parser extracts links, forms, buttons, inputs, selects, and text', () => {
  const parsed = parseHtmlDocument(`
    <title>Parser Fixture</title>
    <a href="/products.html">Products</a>
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
  assert.equal(parsed.forms[0].method, 'GET');
  assert.equal(parsed.forms[0].inputs.some((input) => input.tagName === 'select'), true);
  assert.equal(parsed.forms[0].inputs.some((input) => input.tagName === 'textarea'), true);
  assert.equal(parsed.controls.some((control) => control.tagName === 'button'), true);
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

    const intents = await readJson(path.join(result.artifactDir, 'intents.json'));
    assert.equal(capabilities.capabilities.length >= 10, true);
    assert.equal(intents.intents.length >= 24, true);
    assert.equal(intents.intents.some((intent) => /\p{Script=Han}/u.test(intent.canonicalUtterance)), true);

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
      authChoice: 'declined',
      authLevel: 'L0',
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
      authLevel: 'public_verified',
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
  assert.doesNotMatch(html, /synthetic-secret|Authorization|Bearer|\bcookie\b|\btoken\b|\/Users\/example\/profile|raw html|&lt;html&gt;/iu);
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
    assert.equal(intents.intents.every((intent) => capabilityIds.has(intent.capabilityId)), true);

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
    assert.doesNotMatch(htmlReport, /\bcookie\b|\btoken\b|\bauthorization\b|\bbearer\b|localStorage|sessionStorage|userDataDir|browser profile|<script\b/iu);

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
    ]);
    const lastSuccessful = await readJson(path.join(siteRoot, 'last_successful_build.json'));
    assert.equal(lastSuccessful.buildId, 'simple-shop-build');
    assert.equal(result.skillDir, path.join(siteRoot, 'current'));

    const buildReport = await readJson(path.join(result.artifactDir, 'build_report.json'));
    assert.equal(buildReport.reports.user.html_capability_intent_summary, htmlReportPath);
    assert.equal(buildReport.reports.capability_intent_summary_html, htmlReportPath);
    assert.equal(buildReport.report_index.capability_intent_summary_html, 'reports/capability_intent_summary.html');
    assert.equal(buildReport.user_report.reports.capability_intent_summary_html.endsWith('reports/capability_intent_summary.html'), true);
    assert.match(renderSiteForgeBuildSummary(result, { cwd: workspace }), /capability_intent_summary\.html/u);
    const cliJson = JSON.parse(siteForgeBuildCliJson(result, { report: 'user' }));
    assert.equal(cliJson.reports.capability_intent_summary_html.endsWith('reports/capability_intent_summary.html'), true);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('SiteForge setup first asks for login enhancement and records public_only when declined', async () => {
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
    assert.equal(setup.profile.crawlContract.authChoice, 'declined');
    assert.equal(setup.profile.authStateReport.verified, false);
    assert.equal(setup.buildOptions.crawlContract.crawlMode, 'public_only');
    assert.equal(await fileExists(setup.paths.authStateReportPath), true);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('SiteForge setup opens only the system default browser path and falls back when auth check fails', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-auth-failed-setup-'));
  try {
    await withTestSite(simpleShopRoutes, async (rootUrl) => {
    const opened = [];
    const answers = ['2', 'n', 'public catalog'];
    const setup = await prepareSiteForgeBuildSetup(rootUrl, {
      cwd: workspace,
      buildId: 'auth-failed-setup',
      now: new Date('2026-05-21T08:10:00.000Z'),
      setupInteractive: true,
      interactive: true,
      fetchDelayMs: 0,
      setupPrompt: async () => answers.shift() ?? '',
      setupOutput: { write() {} },
      defaultBrowserLauncher: async (url) => {
        opened.push(url);
        return { command: 'test-default-browser', args: [url] };
      },
    });
    assert.deepEqual(opened, [rootUrl]);
    assert.equal(setup.profile.crawlContract.crawlMode, 'public_only');
    assert.equal(setup.profile.crawlContract.authChoice, 'failed');
    assert.equal(setup.profile.authStateReport.verified, false);
    assert.equal(setup.profile.authStateReport.browserProfilePersisted, false);
    assert.equal(setup.profile.authStateReport.sessionMaterialPersisted, false);
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
      crawlMode: 'enhanced_with_login',
      authChoice: 'selected',
      authLevel: 'L3',
      verified: true,
      source: 'default_browser_user_confirmed',
      blockingSignals: [],
      positiveSignals: ['user_confirmed_terminal_y', 'same_site_final_url', 'not_login_route', 'authenticated_route_candidate'],
      verifiedRoutes: ['/notifications'],
      capabilityProofs: [],
      rawMaterialPersisted: false,
      sessionMaterialPersisted: false,
      browserProfilePersisted: false,
    };
    const crawlContract = createCrawlContract({
      authChoice: 'selected',
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
    assert.equal(userReport.crawlMode, 'enhanced_with_login');
    assert.equal(userReport.coverage.public.pages > 0, true);
    assert.equal(userReport.coverage.authenticated.pages, 1);
    assert.equal(userReport.coverage.overlay.pagesRevisited, 1);
    assert.equal(userReport.auth_summary.savedMaterial.rawMaterialPersisted, false);

    const htmlReport = await readFile(path.join(result.artifactDir, 'reports', 'capability_intent_summary.html'), 'utf8');
    assert.match(htmlReport, /enhanced_with_login/u);
    assert.match(htmlReport, /authenticated pages<\/td><td>1/u);
    assert.match(htmlReport, /overlay pages revisited<\/td><td>1/u);
    assert.match(htmlReport, /notification/u);
    assert.match(htmlReport, /requiredEvidence/u);
    assert.match(htmlReport, /observedEvidence/u);
    assert.match(htmlReport, /missingEvidence/u);
    assert.doesNotMatch(htmlReport, /\bcookie\b|\btoken\b|\bauthorization\b|\bbearer\b|localStorage|sessionStorage|userDataDir|browser profile|<script\b/iu);
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
    assert.equal(intents.intents.every((intent) => capabilityIds.has(intent.capabilityId)), true);

    const safetyPolicy = await readJson(path.join(result.artifactDir, 'safety_policy.json'));
    assert.equal(safetyPolicy.policy.submitForms, false);
    assert.equal(safetyPolicy.policy.allowPayment, false);
    assert.equal(safetyPolicy.policy.allowAccountMutation, false);

    const verificationReport = await readJson(path.join(result.artifactDir, 'verification_report.json'));
    const buildReport = await readJson(path.join(result.artifactDir, 'build_report.json'));
    assert.equal(verificationReport.status, 'passed');
    assert.equal(buildReport.status, 'success');
    assert.equal(Array.isArray(buildReport.warnings), true);
    assert.equal(buildReport.summary.highRiskAutoExecuted, false);
    assert.equal(Boolean(buildReport.artifacts['build_report.json']), true);
    assert.equal(buildReport.summary.unsuccessfulCollections >= 3, true);
    assert.equal(buildReport.collectionOutcomes.total >= 3, true);
    assert.ok(buildReport.collectionOutcomes.unsuccessful.find((item) => (
      item.kind === 'capability'
      && item.target === 'capture network APIs'
      && item.status === 'candidate'
      && item.reasonCode === 'capability-evidence-matrix-incomplete'
    )));
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
    assert.match(summaryText, /构建完成|构建状态/u);
    assert.match(summaryText, /自动探索/u);
    assert.match(summaryText, /能力统计|能力摘要/u);
    assert.match(summaryText, /建议/u);
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
      assert.match(failedSummaryText, /构建完成|构建结果|鏋勫缓瀹屾垚|鏋勫缓缁撴灉/u);
      assert.match(failedSummaryText, /输出结果|结果|杈撳嚭缁撴灉|缁撴灉/u);
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
      assert.match(result.stdout, /构建完成|构建结果|鏋勫缓瀹屾垚|鏋勫缓缁撴灉/u);
      assert.match(result.stdout, /输出结果|杈撳嚭缁撴灉/u);
      assert.match(result.stdout, /自动探索|鑷姩鎺㈢储/u);
      assert.match(result.stdout, /能力统计|能力摘要|鑳藉姏缁熻|鑳藉姏鎽樿/u);

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
      assert.match(result.stdout, /构建完成|构建结果|鏋勫缓瀹屾垚|鏋勫缓缁撴灉/u);
      assert.match(result.stdout, /输出结果|杈撳嚭缁撴灉/u);
      assert.match(result.stdout, /自动探索|鑷姩鎺㈢储/u);
      assert.match(result.stdout, /能力统计|能力摘要|鑳藉姏缁熻|鑳藉姏鎽樿/u);
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
      assert.match(result.stdout, /构建完成|构建结果|鏋勫缓瀹屾垚|鏋勫缓缁撴灉/u);
      assert.match(result.stdout, /自动探索|鑷姩鎺㈢储/u);
      assert.match(result.stdout, /能力统计|能力摘要|鑳藉姏缁熻|鑳藉姏鎽樿/u);
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
      let capturedError = null;
      await assert.rejects(
        () => runSiteForgeBuild(rootUrl, {
          cwd: workspace,
          buildId: 'robots-blocked-build',
          now: new Date('2026-05-16T07:00:00.000Z'),
          fetchDelayMs: 0,
        }),
        (error) => {
          capturedError = error;
          return /robots\.txt disallows all planned seed URLs|Static crawl produced no pages/u.test(error?.message ?? '');
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
      let capturedError = null;
      await assert.rejects(
        () => runSiteForgeBuild(rootUrl, {
          cwd: workspace,
          buildId: 'robots-unavailable-build',
          now: new Date('2026-05-16T07:10:00.000Z'),
          fetchDelayMs: 0,
        }),
        (error) => {
          capturedError = error;
          return /robots\.txt unavailable for live SiteForge build/u.test(error?.message ?? '');
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
      let capturedError = null;
      await assert.rejects(
        () => runSiteForgeBuild(rootUrl, {
          cwd: workspace,
          buildId: 'dynamic-shell-build',
          now: new Date('2026-05-16T07:20:00.000Z'),
          fetchDelayMs: 0,
        }),
        (error) => {
          capturedError = error;
          return /dynamic-shell pages/u.test(error?.message ?? '');
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
