import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
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
  renderSiteForgeBuildSummary,
  resolveFixtureForUrl,
  runSiteForgeBuild,
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

async function withTestServer(handler, callback) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
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
} = {}) {
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

test('SiteForge build resolves controlled host fixtures without public CLI flags', () => {
  const newsFixture = resolveFixtureForUrl('https://news.qq.com/');
  assert.equal(newsFixture?.name, 'news-qq-com');
  assert.equal(newsFixture?.rootUrl, 'https://news.qq.com/');
  assert.equal(path.basename(newsFixture?.fixtureDir ?? ''), 'news-qq-com');
  assert.equal(resolveFixtureForUrl('https://news.qq.com/', { fixture: false }), null);
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
    const fetchCalls = [];
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
              fixture: false,
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

      assert.equal(failure.code, 'robots-unavailable');
      assert.equal(failure.stage, 'discoverSeeds');
      assert.deepEqual(fetchCalls, ['/robots.txt']);

      const seeds = await readJson(path.join(failure.artifactDir, 'seeds.json'));
      assert.equal(seeds.status, 'blocked');
      assert.equal(seeds.robots.status, 'unavailable');
      assert.match(seeds.robots.reason, /HTTP 503/u);
      assert.deepEqual(seeds.seeds, []);

      const buildReport = await readJson(failure.buildReportPath);
      assert.equal(buildReport.status, 'blocked');
      assert.equal(buildReport.failedStage, 'discoverSeeds');
      assert.equal(buildReport.failureClass, 'robots');
      assert.equal(buildReport.reasonCode, 'robots-unavailable');
      assert.equal(buildReport.warningCodes.includes('robots-unavailable'), true);
      assert.equal(buildReport.stages.discoverSeeds.status, 'blocked');
      assert.equal(buildReport.stages.crawlStatic.status, 'skipped');
      assert.equal(buildReport.stages.generateSkill.status, 'skipped');
      assert.equal(await fileExists(path.join(failure.artifactDir, 'crawl_static.json')), false);
      assert.equal(await fileExists(path.join(failure.artifactDir, 'skill.yaml')), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('live SiteForge build stops early when robots.txt disallows all planned seeds', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-robots-disallowed-'));
  try {
    const fetchCalls = [];
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
              fixture: false,
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

      assert.equal(failure.code, 'robots-disallowed');
      assert.equal(failure.stage, 'discoverSeeds');
      assert.deepEqual(fetchCalls, ['/robots.txt']);

      const seeds = await readJson(path.join(failure.artifactDir, 'seeds.json'));
      assert.equal(seeds.status, 'blocked');
      assert.equal(seeds.robots.status, 'parsed');
      assert.deepEqual(seeds.robots.disallowPaths, ['/']);
      assert.deepEqual(seeds.robots.excludedUrls, [rootUrl]);
      assert.deepEqual(seeds.seeds, []);

      const buildReport = await readJson(failure.buildReportPath);
      assert.equal(buildReport.status, 'blocked');
      assert.equal(buildReport.failedStage, 'discoverSeeds');
      assert.equal(buildReport.failureClass, 'robots');
      assert.equal(buildReport.reasonCode, 'robots-disallowed');
      assert.equal(buildReport.warningCodes.includes('robots-disallowed'), true);
      assert.equal(buildReport.stages.crawlStatic.status, 'skipped');
      assert.equal(buildReport.stages.generateSkill.status, 'skipped');
      assert.equal(await fileExists(path.join(failure.artifactDir, 'crawl_static.json')), false);
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
  const fixtureDir = path.join(workspace, 'coverage-fixture');
  try {
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(path.join(fixtureDir, 'robots.txt'), 'User-agent: *\nAllow: /\n', 'utf8');
    await writeFile(path.join(fixtureDir, 'index.html'), `
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
    `, 'utf8');

    const result = await runSiteForgeBuild('https://coverage.local/', {
      cwd: workspace,
      fixturePath: fixtureDir,
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
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runSiteForgeBuild concurrent static crawl keeps all fixture pages, nodes, affordances, and capabilities', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-parallel-crawl-'));
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'siteforge-parallel-fixture-'));
  try {
    const { rootUrl, expectedUrls } = await writeParallelCrawlFixture(fixtureDir);
    const result = await runSiteForgeBuild(rootUrl, {
      cwd: workspace,
      fixturePath: fixtureDir,
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
    assert.equal(affordances.summary.byKind.link >= expectedUrls.length, true);
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

    const result = await runSiteForgeBuild('https://catalog-fixture.local/', {
      cwd: workspace,
      fixturePath: fixtureDir,
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

    const result = await runSiteForgeBuild(rootUrl, {
      cwd: workspace,
      fixturePath: fixtureDir,
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

test('runSiteForgeBuild compiles the deterministic simple-shop fixture end-to-end', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-fixture-'));
  try {
    const result = await runSiteForgeBuild('https://fixture.local/', {
      cwd: workspace,
      buildId: 'fixture-build',
      now: new Date('2026-05-16T00:00:00.000Z'),
    });

    assert.equal(result.status, 'success');
    assert.equal(result.siteId, stableSiteIdFromUrl('https://fixture.local/'));
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

    const lookup = await lookupSkillIntent({
      registryPath: result.workspace.registryPath,
      domain: 'fixture.local',
      utterance: 'search for wireless headphones',
    });
    assert.equal(lookup.status, 'found');
    assert.equal(lookup.skillId, 'simple-shop');
    assert.equal(lookup.intentName, 'search products');
    assert.equal(lookup.capabilityName, 'search products');

    const registry = await readJson(result.workspace.registryPath);
    const registeredCapabilityNames = registry.skills.flatMap((skill) => (
      skill.intents ?? []
    ).map((intent) => intent.capabilityName));
    assert.equal(registeredCapabilityNames.some((name) => /follow|timeline|profile content|search posts/iu.test(name)), false);

    const siteRoot = siteWorkspaceDir(workspace, 'https://fixture.local/');
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
      path.join('builds', 'fixture-build', 'inputs', 'site.json'),
      path.join('builds', 'fixture-build', 'discovery', 'seeds.json'),
      path.join('builds', 'fixture-build', 'graph', 'graph.json'),
      path.join('builds', 'fixture-build', 'capabilities', 'capabilities.json'),
      path.join('builds', 'fixture-build', 'intents', 'intents.json'),
      path.join('builds', 'fixture-build', 'skill', 'skill.yaml'),
      path.join('builds', 'fixture-build', 'verification', 'verification_report.json'),
      path.join('builds', 'fixture-build', 'reports', 'build_report.json'),
    ]);
    const lastSuccessful = await readJson(path.join(siteRoot, 'last_successful_build.json'));
    assert.equal(lastSuccessful.buildId, 'fixture-build');
    assert.equal(result.skillDir, path.join(siteRoot, 'current'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runSiteForgeBuild compiles a deterministic Tencent News fixture with robots filtering', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-news-qq-fixture-'));
  try {
    const result = await runSiteForgeBuild('https://news.qq.com/', {
      cwd: workspace,
      fixture: 'news-qq-com',
      buildId: 'news-qq-fixture-build',
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
    assert.equal(site.normalizedUrl, 'https://news.qq.com/');
    assert.equal(site.rootUrl, 'https://news.qq.com/');
    assert.equal(site.allowedDomains.includes('news.qq.com'), true);

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
    assert.equal(affordances.affordances.some((affordance) => affordance.kind === 'link' && /World News/u.test(affordance.label)), true);

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
      && item.reasonCode === 'capability-candidate'
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
    assert.match(summaryText, /构建完成|构建结果/u);
    assert.match(summaryText, /自动探索/u);
    assert.match(summaryText, /能力统计|能力摘要/u);
    assert.match(summaryText, /建议/u);
    assert.doesNotMatch(summaryText, /未成功采集|\| 类型 \| 对象 \| 状态 \| 原因 \|/u);

    const homepageLookup = await lookupSkillIntent({
      registryPath: result.workspace.registryPath,
      domain: 'news.qq.com',
      utterance: '帮我看新闻首页',
    });
    assert.equal(homepageLookup.status, 'found');
    assert.equal(homepageLookup.skillId, 'tencent-news');
    assert.equal(homepageLookup.capabilityName, 'view news homepage');

    const channelLookup = await lookupSkillIntent({
      registryPath: result.workspace.registryPath,
      domain: 'news.qq.com',
      utterance: '帮我浏览新闻频道',
    });
    assert.equal(channelLookup.status, 'found');
    assert.equal(channelLookup.capabilityName, 'browse news channels');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('failed SiteForge builds keep current skill, registry, and last success stable', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-isolation-'));
  const emptyFixture = await mkdtemp(path.join(os.tmpdir(), 'siteforge-empty-fixture-'));
  try {
    const success = await runSiteForgeBuild('https://fixture.local/', {
      cwd: workspace,
      buildId: 'success-build',
      now: new Date('2026-05-16T05:00:00.000Z'),
    });
    const siteRoot = siteWorkspaceDir(workspace, 'https://fixture.local/');
    const currentSkillPath = path.join(siteRoot, 'current', 'skill.yaml');
    const registryPath = path.join(siteRoot, 'registry.json');
    const lastSuccessfulPath = path.join(siteRoot, 'last_successful_build.json');
    const currentSkillBefore = await readFile(currentSkillPath, 'utf8');
    const registryBefore = await readFile(registryPath, 'utf8');
    const lastSuccessfulBefore = await readFile(lastSuccessfulPath, 'utf8');

    await assert.rejects(
      () => runSiteForgeBuild('https://fixture.local/', {
        cwd: workspace,
        fixturePath: emptyFixture,
        buildId: 'failed-build',
        now: new Date('2026-05-16T06:00:00.000Z'),
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
    assert.equal(failedReport.reasonCode, 'empty-crawl');
    assert.equal(failedReport.summary.registryStatus, null);
    assert.equal(failedReport.summary.unsuccessfulCollections, failedReport.collectionOutcomes.total);
    assert.ok(failedReport.collectionOutcomes.unsuccessful.find((item) => (
      item.kind === 'stage'
      && item.target === 'crawlStatic'
      && item.status === 'blocked'
      && item.reasonCode === 'empty-crawl'
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
    assert.match(failedSummaryText, /构建完成|构建结果/u);
    assert.match(failedSummaryText, /输出结果|结果/u);
    assert.doesNotMatch(failedSummaryText, /未成功采集|\| 类型 \| 对象 \| 状态 \| 原因 \|/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(emptyFixture, { recursive: true, force: true });
  }
});

test('public SiteForge CLI first run without a profile auto-builds when fixture evidence is available', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-cli-'));
  try {
    const result = spawnSync(process.execPath, [CLI_PATH, 'build', 'https://fixture.local/'], {
      cwd: workspace,
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /构建完成|构建结果/u);
    assert.match(result.stdout, /输出结果/u);
    assert.match(result.stdout, /自动探索/u);
    assert.match(result.stdout, /能力统计|能力摘要/u);
    assert.doesNotMatch(result.stdout, /请粘贴最终 URL|输入可见条数|逐项补采/u);

    const buildDirs = await listBuildDirs(siteBuildsDir(workspace, 'https://fixture.local/'));
    assert.equal(buildDirs.length, 1);
    const artifactDir = buildDirs[0];
    assert.equal(await fileExists(path.join(artifactDir, 'build_report.json')), true);

    const setupPaths = buildSetupAssistantPaths('https://fixture.local/', {
      cwd: workspace,
      buildId: path.basename(artifactDir),
    });
    await assertArtifactsExist(setupPaths.setupDir, ['setup_plan.json']);
    assert.equal(await fileExists(setupPaths.userChoicesPath), true);
    assert.equal(await fileExists(setupPaths.capabilityHintsPath), true);
    assert.equal(await fileExists(setupPaths.savedBuildProfilePath), true);
    const setupPlan = await readJson(setupPaths.setupPlanPath);
    assert.equal(setupPlan.artifactFamily, 'siteforge-setup-plan');
    assert.equal(setupPlan.site.rootUrl, 'https://fixture.local/');
    assert.equal(setupPlan.pageGroups.some((group) => group.id === 'products'), true);
    assert.equal(setupPlan.unsafeActionDefaults.payment, false);
    assert.equal(setupPlan.skillContract.willNot.some((entry) => /自动提交/u.test(entry)), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('interactive first-run setup persists profile artifacts with unsafe actions disabled', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-setup-interactive-'));
  try {
    const setup = await prepareSiteForgeBuildSetup('https://fixture.local/', {
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
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('public SiteForge CLI reuses saved setup profile and then builds the simple-shop fixture', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-cli-profile-'));
  try {
    await prepareSiteForgeBuildSetup('https://fixture.local/', {
      cwd: workspace,
      buildId: 'setup-profile',
      now: new Date('2026-05-16T04:00:00.000Z'),
      setupInteractive: true,
      setupOutput: { write() {} },
      setupPrompt: async () => 'focus search',
    });
    const setupPaths = buildSetupAssistantPaths('https://fixture.local/', {
      cwd: workspace,
      buildId: 'setup-profile',
      now: new Date('2026-05-16T04:00:00.000Z'),
    });
    assert.equal(await fileExists(setupPaths.savedBuildProfilePath), true);

    const result = spawnSync(process.execPath, [CLI_PATH, 'build', 'https://fixture.local/'], {
      cwd: workspace,
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /构建完成|构建结果/u);
    assert.match(result.stdout, /输出结果/u);
    assert.match(result.stdout, /自动探索/u);
    assert.match(result.stdout, /能力统计|能力摘要/u);
    assert.match(result.stdout, /Skill ID:\s*simple-shop/u);
    assert.doesNotMatch(result.stdout, /Setup collection review/u);
    assert.doesNotMatch(result.stdout, /采集复核|未成功采集|请粘贴最终 URL|输入可见条数|逐项补采/u);

    const buildDirs = await listBuildDirs(siteBuildsDir(workspace, 'https://fixture.local/'));
    assert.equal(buildDirs.length, 2);
    const artifactDir = buildDirs.find((candidate) => path.basename(candidate) !== 'setup-profile');
    assert.ok(artifactDir);
    const buildReport = await readJson(path.join(artifactDir, 'build_report.json'));
    const verificationReport = await readJson(path.join(artifactDir, 'verification_report.json'));
    const buildProfile = await readJson(path.join(artifactDir, 'inputs', 'build_profile.json'));
    assert.equal(buildReport.status, 'success');
    assert.equal(verificationReport.status, 'passed');
    assert.equal(buildReport.summary.highRiskAutoExecuted, false);
    assert.equal(buildProfile.safety.allowAccountMutation, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('public SiteForge CLI builds the controlled Tencent News fixture without extra params', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-news-qq-cli-profile-'));
  try {
    await prepareSiteForgeBuildSetup('https://news.qq.com/', {
      cwd: workspace,
      buildId: 'news-qq-setup-profile',
      now: new Date('2026-05-16T04:30:00.000Z'),
      setupInteractive: true,
      setupOutput: { write() {} },
      setupPrompt: async () => 'shallow news content',
    });
    const setupPaths = buildSetupAssistantPaths('https://news.qq.com/', {
      cwd: workspace,
      buildId: 'news-qq-setup-profile',
      now: new Date('2026-05-16T04:30:00.000Z'),
    });
    assert.equal(await fileExists(setupPaths.savedBuildProfilePath), true);

    const result = spawnSync(process.execPath, [CLI_PATH, 'build', 'https://news.qq.com/'], {
      cwd: workspace,
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /构建完成|构建结果/u);
    assert.match(result.stdout, /自动探索/u);
    assert.match(result.stdout, /能力统计|能力摘要/u);
    assert.match(result.stdout, /Skill ID:\s*tencent-news/u);
    assert.doesNotMatch(result.stdout, /采集复核|未成功采集|请粘贴最终 URL|输入可见条数|逐项补采/u);

    const buildDirs = await listBuildDirs(siteBuildsDir(workspace, 'https://news.qq.com/'));
    assert.equal(buildDirs.length, 2);
    const artifactDir = buildDirs.find((candidate) => path.basename(candidate) !== 'news-qq-setup-profile');
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
    assert.equal(crawlStatic.pages.every((page) => page.evidence.some((evidence) => evidence.type === 'fixture')), true);
    assert.equal(capabilities.capabilities
      .filter((capability) => capability.status === 'active')
      .every((capability) => capability.safetyLevel === 'read_only' && capability.evidence.length > 0), true);
    assert.equal(safetyPolicy.policy.submitForms, false);
    assert.equal(safetyPolicy.policy.allowPayment, false);
    assert.equal(safetyPolicy.policy.allowAccountMutation, false);
    assert.equal(buildReport.summary.highRiskAutoExecuted, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('SiteForge build_report classifies robots-disallowed static blocks', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-robots-disallowed-'));
  const fixtureDir = path.join(workspace, 'robots-disallowed-fixture');
  try {
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(path.join(fixtureDir, 'robots.txt'), 'User-agent: *\nDisallow: /\n', 'utf8');
    await writeFile(path.join(fixtureDir, 'index.html'), '<title>Blocked</title><main>Blocked by robots policy.</main>', 'utf8');

    let capturedError = null;
    await assert.rejects(
      () => runSiteForgeBuild('https://robots-blocked.local/', {
        cwd: workspace,
        fixturePath: fixtureDir,
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
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('SiteForge reports robots unavailable and dynamic unsupported as stable warning codes', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-robots-unavailable-'));
  const fixtureDir = path.join(workspace, 'robots-unavailable-fixture');
  try {
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(path.join(fixtureDir, 'index.html'), `
      <title>Robots Unavailable Fixture</title>
      <main>
        <h1>Robots unavailable fixture</h1>
        <p>This page has enough static text for a deterministic public homepage capability.</p>
        <a href="/">Home</a>
      </main>
    `, 'utf8');

    const result = await runSiteForgeBuild('https://robots-unavailable.local/', {
      cwd: workspace,
      fixturePath: fixtureDir,
      buildId: 'robots-unavailable-build',
      now: new Date('2026-05-16T07:10:00.000Z'),
      fetchDelayMs: 0,
    });

    const buildReport = await readJson(path.join(result.artifactDir, 'build_report.json'));
    const verificationReport = await readJson(path.join(result.artifactDir, 'verification_report.json'));
    assert.equal(buildReport.status, 'success');
    assert.equal(buildReport.reasonCode, null);
    assert.equal(buildReport.warningCodes.includes('robots-unavailable'), true);
    assert.equal(buildReport.warningCodes.includes('dynamic-unsupported'), true);
    assert.equal(verificationReport.status, 'passed');
    assert.equal(verificationReport.reasonCode, null);
    assert.equal(verificationReport.warningCodes.includes('robots-unavailable'), true);
    assert.equal(verificationReport.warningCodes.includes('dynamic-unsupported'), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('SiteForge build_report classifies dynamic-shell static evidence blocks', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-dynamic-shell-'));
  const fixtureDir = path.join(workspace, 'dynamic-shell-fixture');
  try {
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(path.join(fixtureDir, 'robots.txt'), 'User-agent: *\nAllow: /\n', 'utf8');
    await writeFile(path.join(fixtureDir, 'index.html'), `
      <div id="app"></div>
      <script src="/app.js"></script>
      <noscript>Please enable JavaScript to use this site.</noscript>
    `, 'utf8');

    let capturedError = null;
    await assert.rejects(
      () => runSiteForgeBuild('https://dynamic-shell.local/', {
        cwd: workspace,
        fixturePath: fixtureDir,
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
          fixture: false,
          buildId: 'network-failure-build',
          now: new Date('2026-05-16T07:25:00.000Z'),
          fetchDelayMs: 0,
          fetchTimeoutMs: 1000,
        }),
        (error) => {
          capturedError = error;
          return /Static crawl produced no pages/u.test(error?.message ?? '');
        },
      );

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
      source: 'test-fixture',
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
    assert.match(result.stdout, /无法取得 robots\.txt，实时构建已安全停止/u);
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
        fixture: false,
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
