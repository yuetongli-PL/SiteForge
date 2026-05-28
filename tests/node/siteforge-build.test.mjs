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
  isSameSiteUrl,
  parseHtmlDocument,
  parseRobotsPolicy,
  parseRobotsSitemaps,
  parseSitemapUrls,
  renderCapabilityIntentSummaryHtml,
  renderSiteForgeBuildSummary,
  runBrowserAuthStateCheck,
  runCookieAuthStateCheck,
  runSiteForgeBuild,
  normalizeAuthStateReport,
  authSummaryForReport,
  siteForgeBuildCliJson,
  canRunAuthenticatedLayer,
  createCrawlContract,
  normalizeEvidenceBundle,
  providerRuntimeMode,
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
  runBrowserBridgeApiReplay,
  runBrowserAuthBridge,
} from '../../src/app/pipeline/build/browser-auth-bridge.mjs';
import { browserStructureCollectorScript } from '../../src/app/pipeline/build/browser-structure-collector.mjs';
import { assertBuildProfileSafe } from '../../src/app/pipeline/build/build-profile-safety.mjs';
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

async function collectTextFiles(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTextFiles(fullPath));
    } else if (/\.(?:json|md|html|yaml|yml|txt)$/iu.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

async function readExistingTextFiles(filePaths) {
  const text = [];
  for (const filePath of filePaths) {
    if (await fileExists(filePath)) {
      text.push(await readFile(filePath, 'utf8'));
    }
  }
  return text.join('\n');
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

test('SiteForge API replay treats subdomains as same-site without changing exact internal matching', () => {
  assert.equal(isSameSiteUrl('https://creator.douyin.com/web/api/media/user/info/', ['douyin.com', 'www.douyin.com']), true);
  assert.equal(isSameSiteUrl('https://example.invalid/web/api/media/user/info/', ['douyin.com', 'www.douyin.com']), false);
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
    <a href="/search/" aria-label="站内搜索"><span></span></a>
    <a href="/tags/topic/">话题标签</a>
    <a href="/rank/new" aria-label="最新榜单"><span></span></a>
    <a href="/news/">新闻资讯</a>
    <a href="/books/book-1/">小说作品</a>
    <a href="/authors/one/">作者主页</a>
    <a href="/details/book-1/">详情目录</a>
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
  assert.equal(parsed.links.some((link) => link.label === '站内搜索' && link.semanticKind === 'search'), true);
  assert.equal(parsed.links.some((link) => link.label === '话题标签' && link.semanticKind === 'tag'), true);
  assert.equal(parsed.links.some((link) => link.label === '最新榜单' && link.semanticKind === 'ranking'), true);
  assert.equal(parsed.links.some((link) => link.label === '新闻资讯' && link.semanticKind === 'article'), true);
  assert.equal(parsed.links.some((link) => link.label === '小说作品' && link.semanticKind === 'work'), true);
  assert.equal(parsed.links.some((link) => link.label === '作者主页' && link.semanticKind === 'profile'), true);
  assert.equal(parsed.links.some((link) => link.label === '详情目录' && link.semanticKind === 'detail'), true);
  assert.equal(parsed.elementInstances.some((element) => element.label === '玄幻分类' && element.role === 'category'), true);
  assert.equal(parsed.elementInstances.some((element) => element.label === '最新榜单' && element.role === 'ranking'), true);
  assert.equal(parsed.elementInstances.every((element) => element.rawDomPersisted === false && element.rawHtmlPersisted === false && element.bodyTextPersisted === false), true);
  assert.equal(parsed.forms[0].method, 'GET');
  assert.equal(parsed.forms[0].inputs.some((input) => input.tagName === 'select'), true);
  assert.equal(parsed.forms[0].inputs.some((input) => input.tagName === 'textarea'), true);
  assert.equal(parsed.controls.some((control) => control.tagName === 'button'), true);
});

test('SiteForge static parser maps opaque Chinese semantic link labels', () => {
  const expected = new Map([
    ['分类', 'category'],
    ['频道', 'category'],
    ['书库', 'category'],
    ['书城', 'category'],
    ['榜单', 'ranking'],
    ['排行', 'ranking'],
    ['热门', 'ranking'],
    ['最新', 'ranking'],
    ['新书', 'ranking'],
    ['搜索', 'search'],
    ['搜书', 'search'],
    ['检索', 'search'],
    ['作品', 'work'],
    ['小说', 'work'],
    ['书籍', 'work'],
    ['作者', 'profile'],
    ['作家', 'profile'],
    ['用户主页', 'profile'],
    ['详情', 'detail'],
    ['目录', 'detail'],
    ['书页', 'detail'],
    ['关注频道', 'following_list'],
  ]);
  const links = [...expected.keys()]
    .map((label, index) => `<a href="/opaque/${index + 1}">${label}</a>`)
    .join('\n');
  const parsed = parseHtmlDocument(testHtmlPage('Chinese semantic labels', links), 'https://fixture.local/');
  for (const [label, semanticKind] of expected) {
    assert.equal(
      parsed.links.find((link) => link.label === label)?.semanticKind,
      semanticKind,
      `${label} should map to ${semanticKind}`,
    );
    assert.equal(
      parsed.elementInstances.find((element) => element.label === label)?.role,
      semanticKind === 'followed_channel' ? 'following_list' : semanticKind,
      `${label} element instance should map to ${semanticKind}`,
    );
  }
});

test('runSiteForgeBuild generates graph capabilities and intents for opaque Chinese semantic links', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-chinese-semantic-links-'));
  const expected = new Map([
    ['分类', 'category'],
    ['频道', 'category'],
    ['书库', 'category'],
    ['榜单', 'ranking'],
    ['排行', 'ranking'],
    ['热门', 'ranking'],
    ['搜索', 'search'],
    ['搜书', 'search'],
    ['检索', 'search'],
    ['作品', 'work'],
    ['作者', 'profile'],
    ['详情', 'detail'],
    ['关注频道', 'following_list'],
  ]);
  try {
    await withTestSite((rootUrl) => {
      const routes = {
        '/robots.txt': { contentType: 'text/plain; charset=utf-8', body: testRobotsTxt(rootUrl, { sitemap: false }) },
      };
      const links = [...expected.keys()].map((label, index) => {
        const route = `/opaque/${index + 1}`;
        routes[route] = testHtmlPage(label, `<main><ul><li>${label} summary</li></ul></main>`);
        return `<a href="${route}">${label}</a>`;
      }).join('\n');
      routes['/'] = testHtmlPage('Opaque Chinese semantic links', `<main>${links}</main>`);
      return routes;
    }, async (rootUrl) => {
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'chinese-semantic-links-build',
        now: new Date('2026-05-24T04:25:00.000Z'),
        maxDepth: 1,
        maxPages: 30,
        maxSeeds: 30,
        fetchDelayMs: 0,
      });
      assert.equal(result.status, 'success');

      const graph = await readJson(path.join(result.artifactDir, 'graph.json'));
      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      const intents = await readJson(path.join(result.artifactDir, 'intents.json'));
      for (const [label, semanticKind] of expected) {
        assert.equal(graph.nodes.some((node) => (
          node.categoryInstance?.kind === semanticKind
          && node.categoryInstance?.label === label
          && node.sourceLayer === 'public'
        )), true, `${label} should generate a graph categoryInstance`);
        const capability = capabilities.capabilities.find((candidate) => (
          candidate.object === label
          && candidate.elementRole === semanticKind
          && candidate.status === 'active'
        ));
        assert.ok(capability, `${label} should generate an active ${semanticKind} capability`);
        assert.equal(intents.intents.some((intent) => (
          intent.capabilityId === capability.id
          && intent.callable !== false
          && /\p{Script=Han}/u.test(intent.canonicalUtterance)
        )), true, `${label} should generate a callable Chinese intent`);
      }
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
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

test('robots-disallowed verification remains report-only even with browser bridge evidence', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-robots-report-only-'));
  try {
    await withTestSite((rootUrl) => ({
      '/robots.txt': { contentType: 'text/plain; charset=utf-8', body: testRobotsTxt(rootUrl, { disallow: '/blocked', sitemap: false }) },
      '/': testHtmlPage('Robots report-only fixture', `
        <main>
          <h1>Public entry</h1>
          <a href="/catalog">Catalog</a>
          <a href="/blocked">Robots blocked page</a>
        </main>
      `),
      '/catalog': testHtmlPage('Catalog', '<main><a href="/item-1">Item 1</a></main>'),
      '/blocked': testHtmlPage('Blocked', '<main>Blocked by robots policy.</main>'),
      '/notifications': testHtmlPage('Notifications', '<main><ul><li>Notification summary</li></ul></main>'),
    }), async (rootUrl) => {
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'robots-report-only-bridge-build',
        now: new Date('2026-05-23T03:30:00.000Z'),
        renderJs: true,
        authMode: 'browser',
        strictBrowserAuth: true,
        fetchDelayMs: 0,
        localBuildConfig: {
          authRoutes: ['/notifications'],
          publicRevisitRoutes: ['/'],
        },
        publicRenderedStructureProvider: async () => ({
          publicRenderedPages: [{
            url: new URL('/blocked', rootUrl).toString(),
            routeTemplate: '/blocked',
            pageType: 'blocked_page',
            visibleItemCount: 1,
            listPresent: true,
            links: [{ href: '/catalog', label: 'Catalog' }],
          }],
        }),
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

      assert.equal(result.result_status, 'partial_success');
      assert.equal(result.summary.verificationStatus, 'report_only_blocked');
      assert.equal(result.summary.verificationReasonCode, 'robots-disallowed');
      assert.equal(result.summary.registryStatus, 'promotion-blocked');
      assert.equal(result.summary.currentUpdated, false);
      assert.notEqual(result.summary.promotionClass, 'browser_bridge_runtime');
      assert.notEqual(result.summary.runtimeMode, 'browser_bridge_required');

      const verificationReport = await readJson(path.join(result.artifactDir, 'verification_report.json'));
      assert.equal(verificationReport.status, 'report_only_blocked');
      assert.equal(verificationReport.reasonCode, 'robots-disallowed');
      assert.equal(verificationReport.promotionAllowed, false);
      assert.notEqual(verificationReport.promotionClass, 'browser_bridge_runtime');
      assert.notEqual(verificationReport.runtimeMode, 'browser_bridge_required');
      assert.match(JSON.stringify(verificationReport.errors), /robots-disallowed/u);

      const registryReport = await readJson(path.join(result.artifactDir, 'registry_report.json'));
      assert.equal(registryReport.status, 'promotion-blocked');
      assert.equal(registryReport.lookup.status, 'skipped');
      assert.equal(registryReport.promotionAllowed, false);
      assert.notEqual(registryReport.promotionClass, 'browser_bridge_runtime');
      assert.notEqual(registryReport.runtimeMode, 'browser_bridge_required');

      const registry = await readJson(result.workspace.registryPath);
      assert.equal(registry.skills.some((skill) => skill.skillId === result.skillId), false);
      assert.doesNotMatch(JSON.stringify(registry), /bridge_runtime_passed|browser_bridge_runtime|browser_bridge_required/u);
      assert.equal(await fileExists(path.join(result.buildContext.siteDir, 'current', 'skill.yaml')), false);
      assert.equal(await fileExists(path.join(result.buildContext.siteDir, 'current', 'verification_report.json')), false);

      const buildReport = await readJson(path.join(result.artifactDir, 'build_report.json'));
      assert.equal(buildReport.summary.verificationStatus, 'report_only_blocked');
      assert.equal(buildReport.summary.verificationReasonCode, 'robots-disallowed');
      assert.equal(buildReport.summary.registryStatus, 'promotion-blocked');
      assert.equal(buildReport.summary.currentUpdated, false);

      const userReport = await readJson(path.join(result.artifactDir, 'build_report.user.json'));
      assert.equal(userReport.build_completion.registry_status, 'promotion-blocked');
      assert.equal(userReport.build_completion.current_updated, false);
      assert.equal(userReport.next_step_workflows.every((workflow) => workflow.promotionAllowed === false), true);
      assert.equal(userReport.next_step_workflows.some((workflow) => workflow.id === 'browser-bridge-runtime'), false);
    });
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

test('runSiteForgeBuild disables Chinese write and account mutation controls', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-chinese-risk-controls-'));
  const labels = [
    '\u53d1\u5e03',
    '\u8bc4\u8bba',
    '\u53d1\u9001\u79c1\u4fe1',
    '\u5220\u9664',
    '\u4e0a\u4f20',
    '\u652f\u4ed8',
    '\u5173\u6ce8',
    '\u70b9\u8d5e',
    '\u8f6c\u53d1',
  ];
  try {
    await withTestSite((rootUrl) => ({
      '/robots.txt': { contentType: 'text/plain; charset=utf-8', body: testRobotsTxt(rootUrl, { sitemap: false }) },
      '/': testHtmlPage('Chinese risk controls', `
        <main>
          <h1>Public controls</h1>
          ${labels.map((label) => `<button aria-label="${label}">${label}</button>`).join('\n')}
          <form method="post" action="/settings/password" aria-label="\u4fee\u6539\u5bc6\u7801">
            <button type="submit">\u4fee\u6539\u5bc6\u7801</button>
          </form>
        </main>
      `),
    }), async (rootUrl) => {
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'chinese-risk-controls-build',
        now: new Date('2026-05-24T04:00:00.000Z'),
        fetchDelayMs: 0,
      });
      assert.equal(result.status, 'success');

      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      const disabledActions = new Set(capabilities.capabilities
        .filter((capability) => capability.status === 'disabled')
        .map((capability) => capability.blockedAction)
        .filter(Boolean));
      for (const action of ['publish', 'publish_reply', 'send_dm', 'delete', 'upload', 'pay', 'follow', 'like', 'repost', 'change_password']) {
        assert.equal(disabledActions.has(action), true, `Expected disabled action ${action}`);
      }

      const activeCapabilitiesText = JSON.stringify(capabilities.capabilities
        .filter((capability) => (
          capability.status === 'active'
          || ['enabled', 'limited_enabled'].includes(String(capability.enabled_status ?? ''))
        ))
        .map((capability) => ({
          name: capability.name,
          action: capability.action,
          object: capability.object,
          userValue: capability.userValue,
          executionPlan: capability.executionPlan,
        })));
      for (const label of [...labels, '\u4fee\u6539\u5bc6\u7801']) {
        assert.equal(activeCapabilitiesText.includes(label), false, `${label} should not be active`);
      }

      const disabledCapabilityIds = new Set(capabilities.capabilities
        .filter((capability) => capability.status === 'disabled')
        .map((capability) => capability.id));
      const intents = await readJson(path.join(result.artifactDir, 'intents.json'));
      assert.equal(intents.intents
        .filter((intent) => disabledCapabilityIds.has(intent.capabilityId))
        .every((intent) => intent.callable === false), true);

      const registry = await readJson(result.workspace.registryPath);
      const record = registry.skills.find((skill) => skill.skillId === result.skillId);
      const registryText = JSON.stringify(record ?? {});
      for (const label of [...labels, '\u4fee\u6539\u5bc6\u7801']) {
        assert.equal(registryText.includes(label), false, `${label} should not be registered`);
      }
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runSiteForgeBuild separates follow read links from follow mutation controls', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-follow-read-write-'));
  const readLabel = '\u5173\u6ce8\u9891\u9053';
  const followLabel = '\u5173\u6ce8';
  const unfollowLabel = '\u53d6\u5173';
  try {
    await withTestServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      if (pathname === '/robots.txt') {
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(testRobotsTxt('http://localhost/', { sitemap: false }));
        return;
      }
      if (pathname === '/follow') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(testHtmlPage(readLabel, '<main><ul><li>Followed item summary</li></ul></main>'));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(testHtmlPage('Follow read/write split', `
        <main>
          <a href="/follow" aria-label="${readLabel}">${readLabel}</a>
          <button aria-label="${followLabel}">${followLabel}</button>
          <button aria-label="${unfollowLabel}">${unfollowLabel}</button>
        </main>
      `));
    }, async (rootUrl) => {
      const siteUrl = rootUrl.replace('127.0.0.1', 'localhost');
      const result = await runSiteForgeBuild(siteUrl, {
        cwd: workspace,
        buildId: 'follow-read-write-build',
        now: new Date('2026-05-24T04:10:00.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
      });
      assert.equal(result.status, 'success');

      const graph = await readJson(path.join(result.artifactDir, 'graph.json'));
      assert.equal(graph.nodes.some((node) => (
        node.categoryInstance?.kind === 'following_list'
        && node.categoryInstance?.label === readLabel
        && node.sourceLayer !== 'authenticated'
      )), true);

      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      const readCapability = capabilities.capabilities.find((capability) => (
        capability.object === readLabel
        && capability.elementRole === 'following_list'
      ));
      assert.ok(readCapability);
      assert.equal(readCapability.status, 'active');
      assert.equal(['enabled', 'limited_enabled'].includes(String(readCapability.enabled_status ?? '')), true);

      const followWriteCapability = capabilities.capabilities.find((capability) => capability.blockedAction === 'follow');
      const unfollowWriteCapability = capabilities.capabilities.find((capability) => capability.blockedAction === 'unfollow');
      assert.equal(followWriteCapability?.status, 'disabled');
      assert.equal(unfollowWriteCapability?.status, 'disabled');
      assert.equal(followWriteCapability?.executionPlan, undefined);
      assert.equal(unfollowWriteCapability?.executionPlan, undefined);

      const activeMutationControls = capabilities.capabilities.filter((capability) => (
        (
          capability.status === 'active'
          || ['enabled', 'limited_enabled'].includes(String(capability.enabled_status ?? ''))
        )
        && ['button', 'form', 'control'].includes(String(capability.elementKind ?? capability.kind ?? '').toLowerCase())
        && [followLabel, unfollowLabel].includes(String(capability.object ?? capability.userValue ?? capability.name ?? '').trim())
      ));
      assert.deepEqual(activeMutationControls, []);

      const intents = await readJson(path.join(result.artifactDir, 'intents.json'));
      const disabledIds = new Set([followWriteCapability?.id, unfollowWriteCapability?.id].filter(Boolean));
      assert.equal(intents.intents
        .filter((intent) => disabledIds.has(intent.capabilityId))
        .every((intent) => intent.callable === false), true);

      const registry = await readJson(result.workspace.registryPath);
      const registryText = JSON.stringify(registry.skills.find((skill) => skill.skillId === result.skillId) ?? {});
      assert.match(registryText, /\u5173\u6ce8\u9891\u9053/u);
      assert.doesNotMatch(registryText, /"\u5173\u6ce8"(?!\u9891\u9053)|\u53d6\u5173/u);

      const readLookup = await lookupSkillIntent({
        registryPath: result.workspace.registryPath,
        domain: new URL(siteUrl).hostname,
        utterance: `\u67e5\u770b${readLabel}`,
      });
      assert.equal(readLookup.status, 'found');
      assert.equal(readLookup.capabilityId, readCapability.id);
      for (const utterance of ['\u5173\u6ce8\u8d26\u53f7', '\u53d6\u5173']) {
        const writeLookup = await lookupSkillIntent({
          registryPath: result.workspace.registryPath,
          domain: new URL(siteUrl).hostname,
          utterance,
        });
        assert.equal(writeLookup.status, 'not_found');
      }
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runSiteForgeBuild keeps loopback internal links after URL redaction', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-loopback-internal-links-'));
  const readLabel = '\u5173\u6ce8\u9891\u9053';
  try {
    await withTestSite((rootUrl) => ({
      '/robots.txt': { contentType: 'text/plain; charset=utf-8', body: testRobotsTxt(rootUrl, { sitemap: false }) },
      '/': testHtmlPage('Loopback internal links', `
        <main>
          <a href="/follow" aria-label="${readLabel}">${readLabel}</a>
          <a href="/secret?token=SECRET_SESSION_VALUE&safe=1">Sensitive query link</a>
        </main>
      `),
      '/follow': testHtmlPage(readLabel, '<main><ul><li>Followed item summary</li></ul></main>'),
      '/secret': testHtmlPage('Secret route', '<main>Should not require token replay</main>'),
    }), async (rootUrl) => {
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'loopback-internal-links-build',
        now: new Date('2026-05-24T04:15:00.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
      });
      assert.equal(result.status, 'success');

      const crawlStatic = await readJson(path.join(result.artifactDir, 'crawl_static.json'));
      const forbiddenRuntimeUrlFieldPattern = /"(?:rawHref|originalHref|resolvedHref|runtimeHref|rawUrl|originalUrl|resolvedUrl|rawAction|sourceSameOrigin)"\s*:/iu;
      assert.equal(crawlStatic.pages.some((page) => new URL(page.normalizedUrl).pathname === '/follow'), true);
      assert.doesNotMatch(JSON.stringify(crawlStatic), forbiddenRuntimeUrlFieldPattern);
      const homepage = crawlStatic.pages.find((page) => new URL(page.normalizedUrl).pathname === '/');
      assert.ok(homepage);
      assert.equal(homepage.links.some((link) => (
        new URL(link.normalizedHref).pathname === '/follow'
        && link.href.includes('redacted-ip.invalid')
      )), true);
      assert.doesNotMatch(JSON.stringify(crawlStatic), /SECRET_SESSION_VALUE|token=SECRET_SESSION_VALUE/iu);

      const graph = await readJson(path.join(result.artifactDir, 'graph.json'));
      assert.doesNotMatch(JSON.stringify(graph), forbiddenRuntimeUrlFieldPattern);
      assert.doesNotMatch(JSON.stringify(graph), /SECRET_SESSION_VALUE|token=SECRET_SESSION_VALUE/iu);
      assert.equal(graph.nodes.some((node) => (
        node.categoryInstance?.kind === 'following_list'
        && node.categoryInstance?.label === readLabel
        && node.sourceLayer === 'public'
      )), true);

      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      assert.doesNotMatch(JSON.stringify(capabilities), forbiddenRuntimeUrlFieldPattern);
      assert.doesNotMatch(JSON.stringify(capabilities), /SECRET_SESSION_VALUE|token=SECRET_SESSION_VALUE/iu);
      assert.equal(capabilities.capabilities.some((capability) => (
        capability.elementRole === 'following_list'
        && capability.object === readLabel
        && capability.status === 'active'
      )), true);
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
    const crawlStatic = await readJson(path.join(result.artifactDir, 'crawl_static.json'));
    const graph = await readJson(path.join(result.artifactDir, 'graph.json'));
    assert.equal(crawlStatic.evidenceBundles.some((bundle) => bundle.providerId === 'public_http'), true);
    assert.equal(crawlStatic.evidenceBundles.some((bundle) => bundle.providerId === 'authorized_summary'), true);
    assert.equal(crawlStatic.evidenceCoverage.providers.public_http.pages > 0, true);
    assert.equal(buildReport.summary.coverage.providers.public_http.pages > 0, true);
    assert.equal(buildReport.user_report.coverage.providers.public_http.runtimeMode, 'generic_http_read');
    assert.match(htmlReport, /Evidence Providers/u);
    assert.match(htmlReport, /public_http/u);
    assert.equal(graph.nodes.some((node) => node.providerId === 'public_http'), true);
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

test('SiteForge setup continues API discovery when strict browser auth blocks default network capture', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-browser-api-setup-fallback-'));
  try {
    await withTestSite(simpleShopRoutes, async (rootUrl) => {
      const setup = await prepareSiteForgeBuildSetup(rootUrl, {
        cwd: workspace,
        buildId: 'browser-api-setup-fallback',
        now: new Date('2026-05-27T08:00:00.000Z'),
        authMode: 'browser',
        strictBrowserAuth: true,
        renderJs: true,
        network: true,
        captureNetwork: true,
        internalRawNetwork: true,
        browserBridgeMaxRetryPasses: 0,
        fetchDelayMs: 0,
        setupOutput: { write() {} },
        localBuildConfig: {
          authRoutes: ['/notifications'],
          publicRevisitRoutes: ['/'],
        },
        browserAuthBridgeProvider: async ({ routes }) => ({
          routeResults: routes.map((route) => ({
            routeId: route.id,
            sourceLayer: route.sourceLayer,
            targetRoute: route.routeTemplate,
            status: 'challenge_detected',
            reasonCode: 'browser-bridge-route-challenge-detected',
          })),
        }),
      });

      assert.equal(setup.status, 'api_discovery_setup_blocked');
      assert.equal(setup.setupPlan.buildReadiness.buildable, false);
      assert.equal(setup.setupPlan.buildReadiness.reasonCode, 'browser_blocked');
      assert.equal(setup.buildOptions.strictBrowserAuth, false);
      assert.equal(setup.buildOptions.allowSetupBlockedApiDiscovery, true);
      assert.equal(setup.buildOptions.internalRawNetwork, true);
      assert.equal(setup.profile.profileUsability.buildable, false);
      assert.equal(setup.profile.apiDiscoverySetupFallback, undefined);

      const persistedPlan = await readJson(setup.paths.setupPlanPath);
      assert.equal(persistedPlan.apiDiscoverySetupFallback.status, 'enabled');
      assert.equal(persistedPlan.apiDiscoverySetupFallback.reasonCode, 'browser_blocked');
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

    const verifiedOptions = {
      authMode: 'cookie',
      cookieHeader: 'sid=SECRET_SESSION_VALUE; uid=123',
      authCheckUrl: '/account',
      fetchTimeoutMs: 1000,
    };
    const verified = await runCookieAuthStateCheck({
      inputUrl: rootUrl,
      site,
      options: verifiedOptions,
    });
    assert.equal(verified.authMethod, 'cookie');
    assert.equal(verified.authVerificationStatus, 'cookie_verified');
    assert.equal(verified.verified, true);
    assert.equal(verified.crawlMode, 'authenticated_cookie');
    assert.equal(verified.cookieInput.pairCount, 2);
    assert.equal(verified.cookieInput.persisted, false);
    assert.equal(canRunAuthenticatedLayer(verified), true);
    assert.equal(verifiedOptions.authRuntime, undefined);
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

test('cookie auth state check blocks robots-disallowed URLs before sending Cookie', async () => {
  const accountRequests = [];
  const redirectRequests = [];
  await withTestServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1/').pathname;
    if (pathname === '/account') {
      accountRequests.push(request.headers.cookie ?? '');
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(testHtmlPage('Account', '<main><ul><li>private</li></ul></main>'));
      return;
    }
    if (pathname === '/redirect-account') {
      redirectRequests.push(request.headers.cookie ?? '');
      response.writeHead(302, { location: '/account' });
      response.end('');
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  }, async (rootUrl) => {
    const site = {
      id: 'cookie-auth-robots-test',
      rootUrl,
      allowedDomains: [new URL(rootUrl).hostname],
    };
    const robotsPolicy = parseRobotsPolicy(testRobotsTxt(rootUrl, { disallow: '/account', sitemap: false }), rootUrl);
    const options = {
      authMode: 'cookie',
      cookieHeader: 'sid=SECRET_SESSION_VALUE; uid=123',
      authCheckUrl: '/account',
      fetchTimeoutMs: 1000,
    };

    const blocked = await runCookieAuthStateCheck({
      inputUrl: rootUrl,
      site,
      options,
      robotsPolicy,
    });

    assert.equal(blocked.authMethod, 'cookie');
    assert.equal(blocked.authVerificationStatus, 'cookie_blocked');
    assert.equal(blocked.verified, false);
    assert.equal(canRunAuthenticatedLayer(blocked), false);
    assert.equal(blocked.blockingSignals.includes('robots-disallowed'), true);
    assert.equal(blocked.blockingSignals.includes('auth-check-url-robots-disallowed'), true);
    assert.equal(accountRequests.length, 0);
    assert.equal(options.authRuntime, undefined);
    assert.doesNotMatch(JSON.stringify(blocked), /SECRET_SESSION_VALUE|sid=|uid=123/u);

    const redirectOptions = {
      authMode: 'cookie',
      cookieHeader: 'sid=SECRET_SESSION_VALUE; uid=123',
      authCheckUrl: '/redirect-account',
      fetchTimeoutMs: 1000,
    };
    const redirected = await runCookieAuthStateCheck({
      inputUrl: rootUrl,
      site,
      options: redirectOptions,
      robotsPolicy,
    });

    assert.equal(redirected.authVerificationStatus, 'cookie_blocked');
    assert.equal(redirected.verified, false);
    assert.equal(redirected.blockingSignals.includes('robots-disallowed'), true);
    assert.equal(redirected.blockingSignals.includes('auth-check-redirect-robots-disallowed'), true);
    assert.equal(redirectRequests.length, 1);
    assert.equal(accountRequests.length, 0);
    assert.equal(redirectOptions.authRuntime, undefined);
    assert.doesNotMatch(JSON.stringify(redirected), /SECRET_SESSION_VALUE|sid=|uid=123/u);
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

    const verifiedBrowserOptions = {
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
    };
    const verified = await runBrowserAuthStateCheck({
      inputUrl: rootUrl,
      site,
      options: verifiedBrowserOptions,
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
    assert.equal(verifiedBrowserOptions.authRuntime, undefined);
    assert.equal(verifiedBrowserOptions.authenticatedStructureSummary, undefined);
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

test('browser auth bridge filters robots-disallowed configured routes before provider execution', async () => {
  await withTestSite((rootUrl) => ({
    '/robots.txt': { contentType: 'text/plain; charset=utf-8', body: testRobotsTxt(rootUrl, { disallow: '/blocked-auth', sitemap: false }) },
    '/': testHtmlPage('Home', '<main>Home</main>'),
    '/notifications': testHtmlPage('Notifications', '<main><ul><li>Notification summary</li></ul></main>'),
    '/blocked-auth': testHtmlPage('Blocked auth', '<main>Blocked.</main>'),
  }), async (rootUrl) => {
    const site = {
      id: 'browser-auth-robots-test',
      rootUrl,
      allowedDomains: [new URL(rootUrl).hostname],
    };
    const robotsPolicy = parseRobotsPolicy(testRobotsTxt(rootUrl, { disallow: '/blocked-auth', sitemap: false }), rootUrl);
    let providerRoutes = [];
    const filtered = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      robotsPolicy,
      options: {
        authMode: 'browser',
        localBuildConfig: {
          authRoutes: ['/notifications', '/blocked-auth'],
        },
        browserBridgeMaxRetryPasses: 0,
        browserAuthBridgeProvider: async ({ routes }) => {
          providerRoutes = routes;
          return {
            authenticatedPages: [{
              routeId: routes[0].id,
              url: routes[0].targetUrl,
              routeTemplate: '/notifications',
              pageType: 'notifications',
              visibleItemCount: 1,
              listPresent: true,
            }, {
              routeId: 'robots-blocked-route-1',
              url: new URL('/blocked-auth', rootUrl).toString(),
              routeTemplate: '/blocked-auth',
              pageType: 'blocked_auth',
              visibleItemCount: 1,
              listPresent: true,
            }],
          };
        },
      },
    });
    assert.deepEqual(providerRoutes.map((route) => route.routeTemplate), ['/notifications']);
    assert.equal(filtered.status, 'browser_verified_partial');
    assert.equal(filtered.verified, true);
    assert.equal(filtered.bridgeSummary.routeCount, 2);
    assert.equal(filtered.bridgeSummary.capturedRouteCount, 1);
    assert.equal(filtered.bridgeSummary.missingRouteCount, 1);
    assert.equal(filtered.bridgeSummary.routeResults.some((result) => (
      result.targetRoute === '/blocked-auth'
      && result.status === 'blocked'
      && result.reasonCode === 'robots-disallowed'
    )), true);

    let providerCalled = false;
    let browserOpened = false;
    const allBlocked = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      robotsPolicy,
      openBrowser: async () => {
        browserOpened = true;
      },
      options: {
        authMode: 'browser',
        localBuildConfig: {
          authRoutes: ['/blocked-auth'],
        },
        browserAuthBridgeProvider: async () => {
          providerCalled = true;
          return {
            authenticatedPages: [{
              url: new URL('/blocked-auth', rootUrl).toString(),
              routeTemplate: '/blocked-auth',
              pageType: 'blocked_auth',
              visibleItemCount: 1,
              listPresent: true,
            }],
          };
        },
      },
    });
    assert.equal(providerCalled, false);
    assert.equal(browserOpened, false);
    assert.equal(allBlocked.status, 'browser_blocked');
    assert.equal(allBlocked.verified, false);
    assert.equal(allBlocked.blockingSignals.includes('robots-disallowed'), true);
    assert.equal(allBlocked.blockingSignals.includes('browser-bridge-all-routes-robots-disallowed'), true);
    assert.equal(allBlocked.bridgeSummary.routeResults.some((result) => (
      result.targetRoute === '/blocked-auth'
      && result.status === 'blocked'
      && result.reasonCode === 'robots-disallowed'
    )), true);
  });
});

test('browser auth route result persistence redacts sensitive diagnostic fields', () => {
  const report = normalizeAuthStateReport({
    authMethod: 'browser',
    authVerificationStatus: 'browser_verified_partial',
    verified: true,
    browserBridge: {
      used: true,
      routeCount: 3,
      capturedRouteCount: 1,
      missingRouteCount: 2,
      routeResults: [
        {
          routeId: 'route-1',
          sourceLayer: 'authenticated',
          targetRoute: 'https://example.test/account?access_token=SECRET_ROUTE_TOKEN#frag',
          status: 'captured',
          reasonCode: 'captured',
          finalReasonCode: 'captured',
          retryOutcome: 'not_attempted',
        },
        {
          routeId: 'access_token=SECRET_ROUTE_TOKEN',
          sourceLayer: 'authenticated',
          targetRoute: '/secure?token=SECRET_ROUTE_TOKEN',
          status: 'blocked',
          reasonCode: 'Cookie: sessionid=SECRET_SESSION_VALUE',
          initialReasonCode: 'Authorization: Bearer synthetic-secret',
          finalReasonCode: 'raw html <html>SECRET</html>',
          retryOutcome: 'Bearer synthetic-secret',
        },
        {
          routeId: 'route-3',
          sourceLayer: 'authenticated_overlay',
          routeTemplate: '/safe-overlay',
          status: 'timeout',
          reasonCode: 'browser-bridge-route-limit-exceeded',
          finalReasonCode: 'browser-bridge-route-limit-exceeded',
          retryOutcome: 'not_attempted',
          headers: { cookie: 'sid=SECRET_SESSION_VALUE' },
          rawBody: '<html>SECRET</html>',
        },
      ],
    },
  }, {
    site: {
      rootUrl: 'https://example.test/',
      allowedDomains: ['example.test'],
    },
    crawlMode: 'authenticated_browser',
    authMethod: 'browser',
  });

  assert.equal(report.browserBridge.routeResults.length, 3);
  assert.equal(report.browserBridge.routeResults[0].targetRoute, 'https://example.test/account');
  assert.equal(report.browserBridge.routeResults[1].targetRoute, '/secure');
  assert.equal(report.browserBridge.routeResults[1].routeId, null);
  assert.equal(report.browserBridge.routeResults[1].reasonCode, null);
  assert.equal(report.browserBridge.routeResults[1].initialReasonCode, null);
  assert.equal(report.browserBridge.routeResults[1].finalReasonCode, null);
  assert.equal(report.browserBridge.routeResults[1].retryOutcome, null);
  assert.equal(report.browserBridge.routeResults[2].targetRoute, '/safe-overlay');
  const text = JSON.stringify(report);
  assert.doesNotMatch(text, /SECRET_ROUTE_TOKEN|SECRET_SESSION_VALUE|sid=|Cookie:|Authorization:|Bearer synthetic-secret|raw html|<html>|headers|rawBody/iu);
});

test('browser auth extension stage persistence keeps complete sanitized diagnostics', () => {
  const extensionStages = [
    'bridge-content-version:route-queue-chinese-semantic-v7',
    'bridge-version:route-queue-chinese-semantic-v7',
    'collector-injecting:route-1',
    'collector-reinjecting:route-1',
    'collector-reinjecting:route-1',
    ...Array.from({ length: 26 }, (_, index) => `route-opened:route-${index + 1}`),
    'Cookie: sid=SECRET_SESSION_VALUE',
    'execute-script-failed:route-1:attempt-1',
  ];
  const extensionStageTimeline = [
    ...Array.from({ length: 390 }, (_, index) => ({
      index,
      eventIndex: index,
      passIndex: index < 200 ? 0 : 1,
      stage: index === 0
        ? 'collector-injecting:route-1'
        : index <= 2
        ? 'collector-reinjecting:route-1'
        : `route-opened:route-${(index % 26) + 1}`,
    })),
    {
      index: 391,
      eventIndex: 391,
      passIndex: 1,
      stage: 'Cookie: sid=SECRET_SESSION_VALUE',
    },
  ];
  const report = normalizeAuthStateReport({
    authMethod: 'browser',
    authVerificationStatus: 'browser_verified_partial',
    verified: true,
    browserBridge: {
      used: true,
      routeCount: 26,
      capturedRouteCount: 1,
      missingRouteCount: 25,
      routeResults: [{
        routeId: 'route-1',
        targetRoute: '/route-1',
        status: 'captured',
      }],
      extensionStages,
      extensionStageTimeline,
    },
  }, {
    site: {
      rootUrl: 'https://example.test/',
      allowedDomains: ['example.test'],
    },
    crawlMode: 'authenticated_browser',
    authMethod: 'browser',
  });

  assert.equal(report.browserBridge.extensionStages.length > 20, true);
  assert.equal(report.browserBridge.extensionStages.includes('route-opened:route-26'), true);
  assert.equal(report.browserBridge.extensionStages.includes('bridge-content-version:route-queue-chinese-semantic-v7'), true);
  assert.equal(report.browserBridge.extensionStages.includes('collector-injecting:route-1'), true);
  assert.equal(report.browserBridge.extensionStages.includes('collector-reinjecting:route-1'), true);
  assert.equal(report.browserBridge.extensionStageCount, report.browserBridge.extensionStages.length);
  assert.equal(report.browserBridge.extensionStageOmittedCount, 0);
  assert.equal(report.browserBridge.extensionStageTimelineCount, 390);
  assert.equal(report.browserBridge.extensionStageTimelineLimit, 384);
  assert.equal(report.browserBridge.extensionStageTimeline.length, 384);
  assert.equal(report.browserBridge.extensionStageTimelineOmittedCount, 6);
  assert.equal(report.browserBridge.extensionStageTimeline[0].eventIndex, 0);
  assert.equal(report.browserBridge.extensionStageTimeline[0].stage, 'collector-injecting:route-1');
  assert.equal(report.browserBridge.extensionStageTimeline[1].stage, 'collector-reinjecting:route-1');
  assert.equal(report.browserBridge.extensionStageTimeline[2].stage, 'collector-reinjecting:route-1');
  assert.equal(report.browserBridge.extensionStageTimeline[383].eventIndex, 383);
  assert.equal(report.browserBridge.extensionStageTimeline.every((entry) => entry.index === entry.eventIndex), true);
  assert.equal(report.browserBridge.extensionStageTimeline.every((entry) => /^(?:route-opened|collector-injecting|collector-reinjecting):route-/u.test(entry.stage)), true);
  assert.equal(report.browserBridge.extensionStages.some((stage) => /Cookie|SECRET|sid=/iu.test(stage)), false);
  const userSummary = authSummaryForReport(null, report);
  assert.equal(userSummary.browserBridge.extensionStageCount, report.browserBridge.extensionStageCount);
  assert.equal(userSummary.browserBridge.extensionStages.length, 0);
  assert.equal(userSummary.browserBridge.extensionStageOmittedCount, report.browserBridge.extensionStageCount);
  assert.equal(userSummary.browserBridge.extensionStageTimelineCount, report.browserBridge.extensionStageTimelineCount);
  assert.equal(userSummary.browserBridge.extensionStageTimeline.length, 0);
  assert.equal(userSummary.browserBridge.extensionStageTimelineOmittedCount, report.browserBridge.extensionStageTimelineCount);
  const userSummaryText = JSON.stringify(userSummary);
  assert.equal(userSummaryText.includes('route-opened:route-26'), false);
  assert.equal(userSummaryText.includes('collector-injecting:route-1'), false);
  assert.equal(userSummaryText.includes('bridge-content-version:route-queue-chinese-semantic-v7'), false);
  assert.equal(userSummaryText.includes('extensionStages":["'), false);
  assert.equal(userSummaryText.includes('extensionStageTimeline":[{'), false);
  assert.doesNotMatch(JSON.stringify(report), /SECRET_SESSION_VALUE|sid=/iu);
});

test('browser auth extension diagnostic counts ignore hostile input counts', () => {
  const report = normalizeAuthStateReport({
    authMethod: 'browser',
    authVerificationStatus: 'browser_verified_partial',
    verified: true,
    browserBridge: {
      used: true,
      routeCount: 2,
      capturedRouteCount: 1,
      missingRouteCount: 1,
      extensionStageCount: 999999,
      extensionStageOmittedCount: 999999,
      extensionStageTimelineCount: 999999,
      extensionStageTimelineOmittedCount: 999999,
      routeResults: [{
        routeId: 'route-1',
        targetRoute: '/route-1',
        status: 'captured',
      }],
      extensionStages: [
        'route-opened:route-1',
        'route-opened:route-2',
        'route-opened:route-1',
        'Cookie: sid=SECRET_SESSION_VALUE',
        'raw html <html>SECRET</html>',
      ],
      extensionStageTimeline: Array.from({ length: 390 }, (_, index) => ({
        eventIndex: index,
        passIndex: index < 200 ? 0 : 1,
        stage: `route-opened:route-${(index % 26) + 1}`,
      })),
    },
  }, {
    site: {
      rootUrl: 'https://example.test/',
      allowedDomains: ['example.test'],
    },
    crawlMode: 'authenticated_browser',
    authMethod: 'browser',
  });

  assert.equal(report.browserBridge.extensionStageCount, 2);
  assert.equal(report.browserBridge.extensionStageOmittedCount, 0);
  assert.equal(report.browserBridge.extensionStages.length, 2);
  assert.equal(report.browserBridge.extensionStageTimelineCount, 390);
  assert.equal(report.browserBridge.extensionStageTimeline.length, 384);
  assert.equal(report.browserBridge.extensionStageTimelineOmittedCount, 6);
  assert.doesNotMatch(JSON.stringify(report), /999999|SECRET_SESSION_VALUE|sid=|raw html|<html>/iu);

  const userSummary = authSummaryForReport(null, report);
  assert.equal(userSummary.browserBridge.extensionStageCount, 2);
  assert.equal(userSummary.browserBridge.extensionStages.length, 0);
  assert.equal(userSummary.browserBridge.extensionStageOmittedCount, 2);
  assert.equal(userSummary.browserBridge.extensionStageTimelineCount, 390);
  assert.equal(userSummary.browserBridge.extensionStageTimeline.length, 0);
  assert.equal(userSummary.browserBridge.extensionStageTimelineOmittedCount, 390);
  assert.doesNotMatch(JSON.stringify(userSummary), /999999|route-opened:route-26|SECRET_SESSION_VALUE|sid=/iu);

  const emptyDiagnostics = normalizeAuthStateReport({
    authMethod: 'browser',
    authVerificationStatus: 'browser_verified_partial',
    verified: true,
    browserBridge: {
      used: true,
      extensionStageCount: 999999,
      extensionStageOmittedCount: 999999,
      extensionStageTimelineCount: 999999,
      extensionStageTimelineOmittedCount: 999999,
      extensionStages: [],
      extensionStageTimeline: [],
    },
  }, {
    site: {
      rootUrl: 'https://example.test/',
      allowedDomains: ['example.test'],
    },
    crawlMode: 'authenticated_browser',
    authMethod: 'browser',
  });
  assert.equal(emptyDiagnostics.browserBridge.extensionStageCount, 0);
  assert.equal(emptyDiagnostics.browserBridge.extensionStageOmittedCount, 0);
  assert.equal(emptyDiagnostics.browserBridge.extensionStageTimelineCount, 0);
  assert.equal(emptyDiagnostics.browserBridge.extensionStageTimelineOmittedCount, 0);
  assert.doesNotMatch(JSON.stringify(emptyDiagnostics), /999999/u);

  const forgedSelfConsistentTimeline = normalizeAuthStateReport({
    authMethod: 'browser',
    authVerificationStatus: 'browser_verified_partial',
    verified: true,
    browserBridge: {
      used: true,
      extensionStageTimelineCount: 1000383,
      extensionStageTimelineOmittedCount: 999999,
      extensionStageTimeline: Array.from({ length: 384 }, (_, index) => ({
        eventIndex: index,
        stage: `route-opened:route-${(index % 26) + 1}`,
      })),
    },
  }, {
    site: {
      rootUrl: 'https://example.test/',
      allowedDomains: ['example.test'],
    },
    crawlMode: 'authenticated_browser',
    authMethod: 'browser',
  });
  assert.equal(forgedSelfConsistentTimeline.browserBridge.extensionStageTimelineCount, 384);
  assert.equal(forgedSelfConsistentTimeline.browserBridge.extensionStageTimelineOmittedCount, 0);
  assert.equal(forgedSelfConsistentTimeline.browserBridge.extensionStageTimeline.length, 384);
  assert.doesNotMatch(JSON.stringify(forgedSelfConsistentTimeline), /999999|1000383/u);
});

test('browser auth route coverage counts derive from route results instead of hostile input counts', () => {
  const site = {
    rootUrl: 'https://example.test/',
    allowedDomains: ['example.test'],
  };

  const hostileEmptyRoutes = normalizeAuthStateReport({
    authMethod: 'browser',
    authVerificationStatus: 'browser_verified_partial',
    verified: true,
    browserBridge: {
      used: true,
      routeCount: 999999,
      capturedRouteCount: 999999,
      missingRouteCount: 0,
      finalCapturedRouteCount: 999999,
      finalMissingRouteCount: 0,
      routeCoverageStatus: 'complete',
      routeResults: [],
    },
  }, { site, crawlMode: 'authenticated_browser', authMethod: 'browser' });

  assert.equal(hostileEmptyRoutes.browserBridge.routeCount, 0);
  assert.equal(hostileEmptyRoutes.browserBridge.capturedRouteCount, 0);
  assert.equal(hostileEmptyRoutes.browserBridge.missingRouteCount, 0);
  assert.equal(hostileEmptyRoutes.browserBridge.finalCapturedRouteCount, 0);
  assert.equal(hostileEmptyRoutes.browserBridge.finalMissingRouteCount, 0);
  assert.equal(hostileEmptyRoutes.browserBridge.routeCoverageStatus, 'none');
  assert.equal(hostileEmptyRoutes.browserBridge.routeResultCount, 0);
  assert.equal(canRunAuthenticatedLayer(hostileEmptyRoutes), false);
  assert.doesNotMatch(JSON.stringify(hostileEmptyRoutes), /999999/u);

  const hostileBlockedRoute = normalizeAuthStateReport({
    authMethod: 'browser',
    authVerificationStatus: 'browser_verified_partial',
    verified: true,
    browserBridge: {
      used: true,
      routeCount: 1,
      capturedRouteCount: 1,
      missingRouteCount: 0,
      finalCapturedRouteCount: 1,
      finalMissingRouteCount: 0,
      routeCoverageStatus: 'complete',
      routeResults: [{
        routeId: 'route-1',
        targetRoute: '/account',
        status: 'timeout',
      }],
    },
  }, { site, crawlMode: 'authenticated_browser', authMethod: 'browser' });

  assert.equal(hostileBlockedRoute.browserBridge.routeCount, 1);
  assert.equal(hostileBlockedRoute.browserBridge.capturedRouteCount, 0);
  assert.equal(hostileBlockedRoute.browserBridge.missingRouteCount, 1);
  assert.equal(hostileBlockedRoute.browserBridge.finalCapturedRouteCount, 0);
  assert.equal(hostileBlockedRoute.browserBridge.finalMissingRouteCount, 1);
  assert.equal(hostileBlockedRoute.browserBridge.routeCoverageStatus, 'none');
  assert.equal(canRunAuthenticatedLayer(hostileBlockedRoute), false);

  const capturedRoutes = normalizeAuthStateReport({
    authMethod: 'browser',
    authVerificationStatus: 'browser_verified_partial',
    verified: true,
    browserBridge: {
      used: true,
      routeCount: 0,
      capturedRouteCount: 0,
      missingRouteCount: 999999,
      finalCapturedRouteCount: 0,
      finalMissingRouteCount: 999999,
      routeResults: [{
        routeId: 'route-1',
        targetRoute: '/account',
        status: 'captured',
      }],
    },
  }, { site, crawlMode: 'authenticated_browser', authMethod: 'browser' });

  assert.equal(capturedRoutes.browserBridge.routeCount, 1);
  assert.equal(capturedRoutes.browserBridge.capturedRouteCount, 1);
  assert.equal(capturedRoutes.browserBridge.missingRouteCount, 0);
  assert.equal(capturedRoutes.browserBridge.finalCapturedRouteCount, 1);
  assert.equal(capturedRoutes.browserBridge.finalMissingRouteCount, 0);
  assert.equal(capturedRoutes.browserBridge.routeCoverageStatus, 'complete');
  assert.equal(canRunAuthenticatedLayer(capturedRoutes), true);
  assert.doesNotMatch(JSON.stringify(capturedRoutes), /999999/u);
});

test('evidence provider bundles normalize pages and strip sensitive material', () => {
  const bundle = normalizeEvidenceBundle({
    providerId: 'browser_bridge',
    authMethod: 'browser',
    authVerificationStatus: 'browser_verified_partial',
    pages: [{
      url: 'https://example.test/account',
      normalizedUrl: 'https://example.test/account',
      sourceLayer: 'authenticated',
      title: '<script>alert(1)</script>',
      textSummary: 'Cookie: sid=SECRET_SESSION_VALUE raw HTML <html>SECRET</html>',
      rawHtml: '<html>SECRET</html>',
      headers: { authorization: 'Bearer synthetic-secret' },
      collection: { status: 'success' },
    }],
    routeResults: [{
      routeId: 'route-1',
      targetRoute: '/account',
      status: 'captured',
      cookie: 'sid=SECRET_SESSION_VALUE',
    }, {
      routeId: 'route-2',
      targetRoute: '/blocked',
      status: 'timeout',
      rawBody: '<html>SECRET</html>',
    }],
    warnings: ['Cookie: sid=SECRET_SESSION_VALUE'],
  });

  assert.equal(bundle.providerId, 'browser_bridge');
  assert.equal(bundle.pages.length, 1);
  assert.equal(bundle.pages[0].providerId, 'browser_bridge');
  assert.equal(bundle.pages[0].authMethod, 'browser');
  assert.equal(bundle.pages[0].runtimeMode, 'browser_bridge_required');
  assert.equal(bundle.pages[0].collection.providerId, 'browser_bridge');
  assert.equal(bundle.coverage.routeResults, 2);
  assert.equal(bundle.coverage.capturedRouteCount, 1);
  assert.equal(bundle.coverage.missingRouteCount, 1);
  assert.equal(providerRuntimeMode('public_http'), 'generic_http_read');
  assert.equal(providerRuntimeMode('authorized_summary'), null);
  assert.doesNotMatch(JSON.stringify(bundle), /SECRET_SESSION_VALUE|sid=|Bearer synthetic-secret|<html>|"rawHtml"\s*:|"authorization"\s*:/iu);
});

test('saved authenticated build profile requires fresh auth before reuse', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-saved-auth-reverify-'));
  try {
    await withTestSite(simpleShopRoutes, async (rootUrl) => {
      const first = await prepareSiteForgeBuildSetup(rootUrl, {
        cwd: workspace,
        buildId: 'saved-auth-first',
        now: new Date('2026-05-21T08:30:00.000Z'),
        authMode: 'browser',
        authCheckUrl: '/account',
        fetchDelayMs: 0,
        setupOutput: { write() {} },
        browserAuthBridgeProvider: async ({ routes, targetUrl }) => ({
          authenticatedPages: [{
            routeId: routes[0].id,
            url: targetUrl,
            routeTemplate: '/account',
            pageType: 'account_home',
            visibleItemCount: 2,
            listPresent: true,
          }],
        }),
      });
      assert.equal(first.profile.authStateReport.authVerificationStatus, 'browser_verified');
      assert.equal(first.profile.crawlContract.crawlMode, 'authenticated_browser');

      const reused = await prepareSiteForgeBuildSetup(rootUrl, {
        cwd: workspace,
        buildId: 'saved-auth-reused',
        now: new Date('2026-05-21T08:31:00.000Z'),
        fetchDelayMs: 0,
        setupOutput: { write() {} },
      });
      assert.equal(reused.status, 'reused');
      assert.equal(reused.profile.authStateReport.authVerificationStatus, 'not_requested');
      assert.equal(reused.profile.authStateReport.verified, false);
      assert.equal(reused.profile.authStateReport.blockingSignals.includes('saved-auth-reverify-required'), true);
      assert.equal(reused.profile.crawlContract.crawlMode, 'public_only');
      assert.equal(reused.buildOptions.authStateReport.authVerificationStatus, 'not_requested');
      assert.equal(reused.buildOptions.crawlContract.crawlMode, 'public_only');
      const reusedAuthReport = await readJson(reused.paths.authStateReportPath);
      assert.equal(reusedAuthReport.authVerificationStatus, 'not_requested');
      assert.equal(reusedAuthReport.blockingSignals.includes('saved-auth-reverify-required'), true);

      const directBuild = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'saved-auth-direct-build',
        now: new Date('2026-05-21T08:32:00.000Z'),
        fetchDelayMs: 0,
      });
      const directAuthReport = await readJson(path.join(directBuild.artifactDir, 'auth_state_report.json'));
      assert.equal(directAuthReport.authVerificationStatus, 'not_requested');
      assert.equal(directAuthReport.verified, false);
      assert.equal(directAuthReport.blockingSignals.includes('saved-auth-reverify-required'), true);
      assert.equal(directBuild.summary.auth.verified, false);
      const directCrawlAuthenticated = await readJson(path.join(directBuild.artifactDir, 'crawl_authenticated.json'));
      assert.equal(directCrawlAuthenticated.status, 'skipped');
      assert.equal((directCrawlAuthenticated.authenticatedPages ?? []).length, 0);
      assert.equal((directCrawlAuthenticated.authenticatedOverlayPages ?? []).length, 0);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
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
      assert.equal(authReport.authVerificationStatus, 'browser_verified_partial');
      assert.equal(authReport.verified, true);
      assert.equal(authReport.browserBridge.routeCount, 3);
      assert.equal(authReport.browserBridge.capturedRouteCount, 1);
      assert.equal(authReport.browserBridge.missingRouteCount, 2);
      assert.equal(authReport.browserBridge.routeCoverageStatus, 'partial');
      assert.equal(setupPlan.buildReadiness.buildable, true);
      assert.equal(setupPlan.crawlContract.authVerificationStatus, 'browser_verified_partial');
      assert.equal(setupPlan.crawlContract.sourceMode, 'browser_bridge_partial');
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
    assert.equal(manifest.version, '0.1.6');
    assert.match(manifest.name, /v0\.1\.6/u);
    assert.deepEqual(manifest.permissions.sort(), ['scripting', 'tabs']);
    const extensionContent = await readFile(path.join(extensionDir, 'bridge-content.js'), 'utf8');
    assert.equal(extensionContent.includes('siteforge-bridge-session'), true);
    assert.equal(extensionContent.includes('bridge-content-version:'), true);
    assert.equal(extensionContent.includes('route-queue-chinese-semantic-v7'), true);
    const extensionBackground = await readFile(path.join(extensionDir, 'background.js'), 'utf8');
    assert.equal(extensionBackground.includes('chrome.scripting.executeScript'), true);
    assert.equal(extensionBackground.includes('route-queue-chinese-semantic-v7'), true);
    assert.equal(extensionBackground.includes('collector-version:'), true);
    assert.equal(extensionBackground.includes('collector-version:${route.id}:'), true);
    assert.equal(extensionBackground.includes('SITEFORGE_COLLECT_MESSAGE_TYPE'), true);
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
    assert.equal(extensionCollector.includes('SITEFORGE_COLLECTOR_CONTENT_VERSION'), true);
    assert.equal(extensionCollector.includes('__SITEFORGE_BROWSER_BRIDGE_COLLECTOR_VERSION__'), true);
    assert.equal(extensionCollector.includes('SITEFORGE_COLLECT_MESSAGE_TYPE'), true);
    assert.equal(extensionCollector.includes('route-queue-chinese-semantic-v7'), true);
    assert.equal(extensionCollector.includes('collectorVersion'), true);
    assert.equal(extensionCollector.includes('captured_with_warning'), true);
    assert.equal(extensionCollector.includes('definite_challenge'), true);
    assert.equal(extensionCollector.includes('thin_capture'), true);
    assert.equal(extensionCollector.includes('media_surface'), true);
    assert.equal(extensionCollector.includes("attr(node, 'aria-label')"), true);
    assert.equal(extensionCollector.includes("attr(node, 'data-testid')"), true);
    const followSemanticIndex = extensionCollector.indexOf('(?:follow|following|followed|followers)');
    const categorySemanticIndex = extensionCollector.indexOf('categor|category');
    assert.equal(followSemanticIndex >= 0, true);
    assert.equal(categorySemanticIndex > followSemanticIndex, true);
    assert.doesNotMatch(extensionCollector, /follow\(\?:ing\|ed\)\?/u);

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

    const unmatchedRouteSummary = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        browserBridgeMaxRetryPasses: 0,
        localBuildConfig: {
          authRoutes: ['/account'],
        },
        browserAuthBridgeProvider: async ({ routes }) => {
          assert.equal(routes[0].routeTemplate, '/account');
          return {
            routeResults: [{
              routeId: 'wrong-route',
              targetUrl: new URL('/unrequested', rootUrl).toString(),
              sourceLayer: 'authenticated',
              status: 'captured',
            }],
            authenticatedPages: [{
              routeId: 'wrong-route',
              url: new URL('/unrequested', rootUrl).toString(),
              routeTemplate: '/unrequested',
              sourceLayer: 'authenticated',
              pageType: 'account_home',
              visibleItemCount: 1,
              listPresent: true,
            }],
          };
        },
      },
    });
    assert.equal(unmatchedRouteSummary.status, 'browser_bridge_missing');
    assert.equal(unmatchedRouteSummary.verified, false);
    assert.equal(unmatchedRouteSummary.structureSummary, null);
    assert.equal(unmatchedRouteSummary.bridgeSummary.capturedRouteCount, 0);
    assert.equal(unmatchedRouteSummary.bridgeSummary.routeCoverageStatus, 'none');
    assert.equal(unmatchedRouteSummary.bridgeSummary.routeResults.some((route) => route.routeId === 'wrong-route'), false);
    assert.equal(unmatchedRouteSummary.bridgeSummary.routeResults[0].targetRoute, '/account');
    assert.equal(unmatchedRouteSummary.blockingSignals.includes('browser-bridge-no-captured-route'), true);

    const mismatchedUrlForRouteId = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        browserBridgeMaxRetryPasses: 0,
        localBuildConfig: {
          authRoutes: ['/account'],
        },
        browserAuthBridgeProvider: async ({ routes }) => ({
          routeResults: [{
            routeId: routes[0].id,
            targetUrl: new URL('/unrequested', rootUrl).toString(),
            sourceLayer: routes[0].sourceLayer,
            status: 'captured',
          }],
          authenticatedPages: [{
            routeId: routes[0].id,
            url: new URL('/unrequested', rootUrl).toString(),
            routeTemplate: '/unrequested',
            sourceLayer: routes[0].sourceLayer,
            pageType: 'account_home',
            visibleItemCount: 1,
            listPresent: true,
          }],
        }),
      },
    });
    assert.equal(mismatchedUrlForRouteId.status, 'browser_bridge_missing');
    assert.equal(mismatchedUrlForRouteId.verified, false);
    assert.equal(mismatchedUrlForRouteId.structureSummary, null);
    assert.equal(mismatchedUrlForRouteId.bridgeSummary.capturedRouteCount, 0);
    assert.equal(mismatchedUrlForRouteId.bridgeSummary.routeResults[0].targetRoute, '/account');
    assert.equal(JSON.stringify(mismatchedUrlForRouteId.bridgeSummary).includes('/unrequested'), false);

    const extensionCanonicalizedUrlForRouteId = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        browserBridgeMaxRetryPasses: 0,
        localBuildConfig: {
          authRoutes: ['/account'],
        },
        browserAuthBridgeProvider: async ({ routes }) => ({
          routeResults: [{
            routeId: routes[0].id,
            targetUrl: new URL('/unrequested', rootUrl).toString(),
            sourceLayer: routes[0].sourceLayer,
            status: 'captured',
            collectorVersion: 'route-queue-chinese-semantic-v7',
          }],
          authenticatedPages: [{
            routeId: routes[0].id,
            url: new URL('/unrequested', rootUrl).toString(),
            routeTemplate: '/unrequested',
            sourceLayer: routes[0].sourceLayer,
            pageType: 'account_home',
            visibleItemCount: 1,
            listPresent: true,
          }],
        }),
      },
    });
    assert.equal(extensionCanonicalizedUrlForRouteId.status, 'browser_verified');
    assert.equal(extensionCanonicalizedUrlForRouteId.verified, true);
    assert.equal(extensionCanonicalizedUrlForRouteId.bridgeSummary.capturedRouteCount, 1);
    assert.equal(extensionCanonicalizedUrlForRouteId.bridgeSummary.routeResults[0].targetRoute, '/account');
    assert.equal(JSON.stringify(extensionCanonicalizedUrlForRouteId.bridgeSummary).includes('/unrequested'), false);
    assert.equal(JSON.stringify(extensionCanonicalizedUrlForRouteId.structureSummary).includes('collectorVersion'), false);

    const mismatchedUrlChallengeForRouteId = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        browserBridgeMaxRetryPasses: 0,
        localBuildConfig: {
          authRoutes: ['/account'],
        },
        browserAuthBridgeProvider: async ({ routes }) => ({
          routeResults: [{
            routeId: routes[0].id,
            targetUrl: new URL('/unrequested', rootUrl).toString(),
            sourceLayer: routes[0].sourceLayer,
            status: 'challenge_detected',
            reasonCode: 'wrong-url-challenge',
          }],
        }),
      },
    });
    assert.equal(mismatchedUrlChallengeForRouteId.status, 'browser_bridge_missing');
    assert.equal(mismatchedUrlChallengeForRouteId.verified, false);
    assert.equal(mismatchedUrlChallengeForRouteId.structureSummary, null);
    assert.equal(mismatchedUrlChallengeForRouteId.bridgeSummary.capturedRouteCount, 0);
    assert.equal(mismatchedUrlChallengeForRouteId.bridgeSummary.routeResults[0].status, 'timeout');
    assert.equal(mismatchedUrlChallengeForRouteId.bridgeSummary.routeResults[0].targetRoute, '/account');
    assert.equal(JSON.stringify(mismatchedUrlChallengeForRouteId.bridgeSummary).includes('/unrequested'), false);
    assert.equal(JSON.stringify(mismatchedUrlChallengeForRouteId.bridgeSummary).includes('wrong-url-challenge'), false);

    const mismatchedTargetRouteForRouteId = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        browserBridgeMaxRetryPasses: 0,
        localBuildConfig: { authRoutes: ['/account'] },
        browserAuthBridgeProvider: async ({ routes }) => ({
          routeResults: [{
            routeId: routes[0].id,
            targetRoute: '/unrequested',
            sourceLayer: routes[0].sourceLayer,
            status: 'challenge_detected',
            reasonCode: 'wrong-target-route-challenge',
          }],
        }),
      },
    });
    assert.equal(mismatchedTargetRouteForRouteId.status, 'browser_bridge_missing');
    assert.equal(mismatchedTargetRouteForRouteId.verified, false);
    assert.equal(mismatchedTargetRouteForRouteId.structureSummary, null);
    assert.equal(mismatchedTargetRouteForRouteId.bridgeSummary.capturedRouteCount, 0);
    assert.equal(mismatchedTargetRouteForRouteId.bridgeSummary.routeResults[0].status, 'timeout');
    assert.equal(mismatchedTargetRouteForRouteId.bridgeSummary.routeResults[0].targetRoute, '/account');
    assert.equal(JSON.stringify(mismatchedTargetRouteForRouteId.bridgeSummary).includes('/unrequested'), false);
    assert.equal(JSON.stringify(mismatchedTargetRouteForRouteId.bridgeSummary).includes('wrong-target-route-challenge'), false);

    const trailingSlashRoute = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        localBuildConfig: {
          authRoutes: ['/search/'],
        },
        browserAuthBridgeProvider: async ({ routes }) => {
          assert.equal(routes[0].targetUrl, new URL('/search/', rootUrl).toString());
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
              routeTemplate: '/search/',
              sourceLayer: 'authenticated',
              pageType: 'search',
              visibleItemCount: 1,
              listPresent: true,
            }],
          };
        },
      },
    });
    assert.equal(trailingSlashRoute.status, 'browser_verified');
    assert.equal(trailingSlashRoute.bridgeSummary.routeResults[0].targetRoute, '/search/');

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
    assert.equal(retrySkipsDefiniteChallenge.status, 'browser_verified_partial');
    assert.equal(retrySkipsDefiniteChallenge.bridgeSummary.routeResults.find((route) => route.targetRoute === '/blocked-challenge')?.retryAttemptCount, 0);
    assert.equal(retrySkipsDefiniteChallenge.bridgeSummary.routeResults.find((route) => route.targetRoute === '/late-route')?.retryOutcome, 'captured_after_retry');

    const saturatedRetryResults = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        localBuildConfig: {
          authRoutes: Array.from({ length: 35 }, (_, index) => `/route-${index + 1}`),
        },
        browserAuthBridgeProvider: async ({ routes, passIndex }) => {
          if (passIndex === 0) {
            assert.equal(routes.length, 32);
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
    assert.equal(saturatedRetryResults.bridgeSummary.routeCount, 35);
    assert.equal(saturatedRetryResults.bridgeSummary.scheduledRouteCount, 32);
    assert.equal(saturatedRetryResults.bridgeSummary.overflowRouteCount, 3);
    assert.equal(saturatedRetryResults.bridgeSummary.unattemptedRouteCount, 3);
    assert.equal(saturatedRetryResults.bridgeSummary.routeQueueTruncated, true);
    assert.equal(saturatedRetryResults.bridgeSummary.routeCoverageStatus, 'partial');
    assert.equal(saturatedRetryResults.bridgeSummary.retryPasses, 2);
    assert.equal(saturatedRetryResults.bridgeSummary.routeResults.find((route) => route.targetRoute === '/route-32')?.finalReasonCode, 'browser-bridge-definite-challenge');
    assert.equal(saturatedRetryResults.bridgeSummary.routeResults.find((route) => route.targetRoute === '/route-33')?.finalReasonCode, 'browser-bridge-route-limit-exceeded');
    assert.equal(saturatedRetryResults.bridgeSummary.routeResults.find((route) => route.targetRoute === '/route-35')?.finalReasonCode, 'browser-bridge-route-limit-exceeded');

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
    assert.equal(thinCapture.structureSummary, null);

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

    const missingCollectorVersionExtension = await runBrowserAuthBridge({
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
        await signalStage('bridge-content-version:route-queue-chinese-semantic-v7');
        await signalStage('bridge-version:route-queue-chinese-semantic-v7');
        await signalStage(`collector-submit-ok:${session.routes[0].id}`);
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
    assert.equal(missingCollectorVersionExtension.status, 'browser_bridge_missing');
    assert.equal(missingCollectorVersionExtension.verified, false);
    assert.equal(missingCollectorVersionExtension.blockingSignals.includes('browser-bridge-extension-stale-or-incompatible'), true);
    assert.equal(missingCollectorVersionExtension.bridgeSummary.capturedRouteCount, 1);

    const currentExtension = await runBrowserAuthBridge({
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
        const route = session.routes[0];
        const signalStage = async (stage) => {
          const statusUrl = new URL(session.extensionStatusUrl);
          statusUrl.searchParams.set('stage', stage);
          await fetch(statusUrl, { method: 'POST' });
        };
        await signalStage('bridge-content-version:route-queue-chinese-semantic-v7');
        await signalStage('bridge-version:route-queue-chinese-semantic-v7');
        await signalStage(`collector-version:${route.id}:route-queue-chinese-semantic-v7`);
        await signalStage(`collector-submit-ok:${route.id}`);
        await fetch(session.submitUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            routeResults: [{
              routeId: route.id,
              targetUrl: route.targetUrl,
              sourceLayer: 'authenticated',
              status: 'captured',
              collectorVersion: 'route-queue-chinese-semantic-v7',
            }],
            authenticatedPages: [{
              routeId: route.id,
              url: route.targetUrl,
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
    assert.equal(currentExtension.status, 'browser_verified');
    assert.equal(currentExtension.verified, true);
    assert.equal(currentExtension.blockingSignals.includes('browser-bridge-extension-stale-or-incompatible'), false);
    assert.equal(currentExtension.bridgeSummary.capturedRouteCount, 1);

    const compatiblePreviousExtension = await runBrowserAuthBridge({
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
        const route = session.routes[0];
        const signalStage = async (stage) => {
          const statusUrl = new URL(session.extensionStatusUrl);
          statusUrl.searchParams.set('stage', stage);
          await fetch(statusUrl, { method: 'POST' });
        };
        await signalStage('bridge-content-version:route-queue-chinese-semantic-v6');
        await signalStage('bridge-version:route-queue-chinese-semantic-v6');
        await signalStage(`collector-version:${route.id}:route-queue-chinese-semantic-v6`);
        await signalStage(`collector-submit-ok:${route.id}`);
        await fetch(session.submitUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            routeResults: [{
              routeId: route.id,
              targetUrl: route.targetUrl,
              sourceLayer: 'authenticated',
              status: 'captured',
              collectorVersion: 'route-queue-chinese-semantic-v6',
            }],
            authenticatedPages: [{
              routeId: route.id,
              url: route.targetUrl,
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
    assert.equal(compatiblePreviousExtension.status, 'browser_verified');
    assert.equal(compatiblePreviousExtension.verified, true);
    assert.equal(compatiblePreviousExtension.blockingSignals.includes('browser-bridge-extension-stale-or-incompatible'), false);
    assert.equal(compatiblePreviousExtension.bridgeSummary.capturedRouteCount, 1);

    const staleCollectorVersionExtension = await runBrowserAuthBridge({
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
        const route = session.routes[0];
        const signalStage = async (stage) => {
          const statusUrl = new URL(session.extensionStatusUrl);
          statusUrl.searchParams.set('stage', stage);
          await fetch(statusUrl, { method: 'POST' });
        };
        await signalStage('bridge-content-version:route-queue-chinese-semantic-v7');
        await signalStage('bridge-version:route-queue-chinese-semantic-v7');
        await signalStage(`collector-version:${route.id}:route-queue-loading-dom-fallback-v5`);
        await signalStage(`collector-submit-ok:${route.id}`);
        await fetch(session.submitUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            routeResults: [{
              routeId: route.id,
              targetUrl: route.targetUrl,
              sourceLayer: 'authenticated',
              status: 'captured',
              collectorVersion: 'route-queue-loading-dom-fallback-v5',
            }],
            authenticatedPages: [{
              routeId: route.id,
              url: route.targetUrl,
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
    assert.equal(staleCollectorVersionExtension.status, 'browser_bridge_missing');
    assert.equal(staleCollectorVersionExtension.verified, false);
    assert.equal(staleCollectorVersionExtension.blockingSignals.includes('browser-bridge-extension-stale-or-incompatible'), true);
    assert.equal(staleCollectorVersionExtension.bridgeSummary.capturedRouteCount, 1);

    const mixedCollectorRouteExtension = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        localBuildConfig: {
          authRoutes: ['/account', '/messages'],
        },
        browserBridgeTimeoutMs: 1000,
      },
      openBrowser: async (urlValue) => {
        const bridgeUrl = new URL(urlValue);
        const sessionUrl = new URL('/session.json', bridgeUrl.origin);
        sessionUrl.searchParams.set('nonce', bridgeUrl.searchParams.get('nonce'));
        const session = await (await fetch(sessionUrl)).json();
        const [firstRoute, secondRoute] = session.routes;
        const signalStage = async (stage) => {
          const statusUrl = new URL(session.extensionStatusUrl);
          statusUrl.searchParams.set('stage', stage);
          await fetch(statusUrl, { method: 'POST' });
        };
        await signalStage('bridge-content-version:route-queue-chinese-semantic-v7');
        await signalStage('bridge-version:route-queue-chinese-semantic-v7');
        await signalStage(`collector-version:${firstRoute.id}:route-queue-chinese-semantic-v7`);
        await signalStage(`collector-submit-ok:${firstRoute.id}`);
        await signalStage(`collector-submit-ok:${secondRoute.id}`);
        await fetch(session.submitUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            routeResults: [firstRoute, secondRoute].map((route, index) => ({
              routeId: route.id,
              targetUrl: route.targetUrl,
              sourceLayer: 'authenticated',
              status: 'captured',
              ...(index === 0 ? { collectorVersion: 'route-queue-chinese-semantic-v7' } : {}),
            })),
            authenticatedPages: [firstRoute, secondRoute].map((route, index) => ({
              routeId: route.id,
              url: route.targetUrl,
              routeTemplate: route.routeTemplate,
              sourceLayer: 'authenticated',
              pageType: 'authenticated_browser_summary',
              visibleItemCount: index + 1,
              listPresent: true,
            })),
          }),
        });
      },
    });
    assert.equal(mixedCollectorRouteExtension.status, 'browser_bridge_missing');
    assert.equal(mixedCollectorRouteExtension.verified, false);
    assert.equal(mixedCollectorRouteExtension.blockingSignals.includes('browser-bridge-extension-stale-or-incompatible'), true);
    assert.equal(mixedCollectorRouteExtension.bridgeSummary.capturedRouteCount, 2);

    const manyExtensionStages = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        localBuildConfig: {
          authRoutes: Array.from({ length: 26 }, (_, index) => `/stage-${index + 1}`),
        },
        browserBridgeTimeoutMs: 1000,
        browserBridgeMaxRetryPasses: 0,
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
        await signalStage('bridge-content-version:route-queue-chinese-semantic-v7');
        await signalStage('bridge-version:route-queue-chinese-semantic-v7');
        await signalStage('collector-injecting:route-1');
        await signalStage('collector-reinjecting:route-1');
        await signalStage('collector-reinjecting:route-1');
        for (const route of session.routes) {
          await signalStage(`route-opened:${route.id}`);
        }
        await signalStage('route-opened:route-1');
        const route = session.routes[0];
        await signalStage(`collector-version:${route.id}:route-queue-chinese-semantic-v7`);
        await signalStage(`collector-submit-ok:${route.id}`);
        await fetch(session.submitUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            routeResults: [{
              routeId: route.id,
              targetUrl: route.targetUrl,
              sourceLayer: 'authenticated',
              status: 'captured',
              collectorVersion: 'route-queue-chinese-semantic-v7',
            }],
            authenticatedPages: [{
              routeId: route.id,
              url: route.targetUrl,
              routeTemplate: route.routeTemplate,
              sourceLayer: 'authenticated',
              pageType: 'authenticated_browser_summary',
              visibleItemCount: 1,
              listPresent: true,
            }],
          }),
        });
      },
    });
    assert.equal(manyExtensionStages.status, 'browser_verified_partial');
    assert.equal(manyExtensionStages.bridgeSummary.extensionStages.length > 20, true);
    assert.equal(manyExtensionStages.bridgeSummary.extensionStageCount, manyExtensionStages.bridgeSummary.extensionStages.length);
    assert.equal(manyExtensionStages.bridgeSummary.extensionStageOmittedCount, 0);
    assert.equal(manyExtensionStages.bridgeSummary.extensionStages.includes('route-opened:route-26'), true);
    assert.equal(manyExtensionStages.bridgeSummary.extensionStages.filter((stage) => stage === 'route-opened:route-1').length, 1);
    assert.equal(manyExtensionStages.bridgeSummary.extensionStages.includes('collector-injecting:route-1'), true);
    assert.equal(manyExtensionStages.bridgeSummary.extensionStages.includes('collector-reinjecting:route-1'), true);
    assert.equal(manyExtensionStages.bridgeSummary.extensionStages.filter((stage) => stage === 'collector-reinjecting:route-1').length, 1);
    assert.equal(manyExtensionStages.bridgeSummary.extensionStageTimeline.length > 20, true);
    assert.equal(manyExtensionStages.bridgeSummary.extensionStageTimelineCount, manyExtensionStages.bridgeSummary.extensionStageTimeline.length);
    assert.equal(manyExtensionStages.bridgeSummary.extensionStageTimelineOmittedCount, 0);
    assert.equal(manyExtensionStages.bridgeSummary.extensionStageTimeline[0].stage, 'bridge-content-version:route-queue-chinese-semantic-v7');
    assert.equal(manyExtensionStages.bridgeSummary.extensionStageTimeline[0].index, 0);
    assert.equal(manyExtensionStages.bridgeSummary.extensionStageTimeline[0].eventIndex, 0);
    assert.equal(manyExtensionStages.bridgeSummary.extensionStageTimeline.every((entry, index) => entry.index === index), true);
    assert.equal(manyExtensionStages.bridgeSummary.extensionStageTimeline.every((entry, index) => entry.eventIndex === index), true);
    assert.equal(manyExtensionStages.bridgeSummary.extensionStageTimeline.some((entry) => entry.stage === 'route-opened:route-26'), true);
    assert.equal(manyExtensionStages.bridgeSummary.extensionStageTimeline.filter((entry) => entry.stage === 'route-opened:route-1').length, 2);
    assert.equal(manyExtensionStages.bridgeSummary.extensionStageTimeline.some((entry) => entry.stage === 'collector-injecting:route-1'), true);
    assert.equal(manyExtensionStages.bridgeSummary.extensionStageTimeline.filter((entry) => entry.stage === 'collector-reinjecting:route-1').length, 2);
    assert.equal(manyExtensionStages.bridgeSummary.extensionStages.some((stage) => /cookie|token|authorization|bearer|raw/i.test(stage)), false);

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

test('browser bridge API replay uses one-time extension session when provider is absent', async () => {
  await withTestSite((rootUrl) => ({
    '/': testHtmlPage('Replay Host', '<main>Replay host</main>'),
    '/api/feed': {
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ ok: true }),
    },
    '/robots.txt': {
      contentType: 'text/plain; charset=utf-8',
      body: testRobotsTxt(rootUrl),
    },
  }), async (rootUrl) => {
    const host = new URL(rootUrl).hostname;
    let sessionSeen = /** @type {any} */ (null);
    const runtimeParameterSource = {
      kind: 'douyin_self_user_render_data',
      pageUrl: new URL('/', rootUrl).toString(),
      rawMaterialPersisted: false,
    };
    const replay = await runBrowserBridgeApiReplay({
      inputUrl: rootUrl,
      site: {
        id: 'replay-fixture',
        rootUrl,
        allowedDomains: [host],
      },
      endpoint: new URL('/api/feed', rootUrl).toString(),
      method: 'GET',
      runtimeEndpoint: new URL('/api/feed?user_id={self.uid}', rootUrl).toString(),
      runtimeParameterSource,
      responseEvidence: {
        statusCode: 0,
        arrayField: 'items',
      },
      options: {
        browserBridgeApiReplayTimeoutMs: 1000,
      },
      openBrowser: async (bridgeUrl) => {
        const bridgeHtml = await (await fetch(bridgeUrl)).text();
        assert.equal(bridgeHtml.includes('siteforge-browser-bridge'), true);
        const opened = new URL(bridgeUrl);
        const sessionUrl = new URL('/session.json', opened.origin);
        sessionUrl.searchParams.set('nonce', opened.searchParams.get('nonce'));
        const session = await (await fetch(sessionUrl)).json();
        sessionSeen = session;
        await fetch(session.submitUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            nonce: session.nonce,
            apiReplay: {
              status: 'verified',
              httpStatus: 200,
              contentType: 'application/json; charset=utf-8',
              responseKind: 'json',
              responseEvidenceStatus: 'matched',
              observedStatusCode: 0,
              observedArrayFieldPresent: true,
              bodyText: 'synthetic-api-replay-secret',
            },
          }),
        });
      },
    });

    assert.equal(replay.status, 'verified');
    assert.equal(replay.httpStatus, 200);
    assert.equal(replay.contentType, 'application/json; charset=utf-8');
    assert.equal(replay.responseKind, 'json');
    assert.equal(replay.responseEvidenceStatus, 'matched');
    assert.equal(replay.observedStatusCode, 0);
    assert.equal(replay.observedArrayFieldPresent, true);
    assert.equal(JSON.stringify(replay).includes('synthetic-api-replay-secret'), false);
    assert.equal(sessionSeen?.apiReplay?.endpoint, new URL('/api/feed', rootUrl).toString());
    assert.equal(sessionSeen?.apiReplay?.endpointTemplate, new URL('/api/feed?user_id={self.uid}', rootUrl).toString());
    assert.deepEqual(sessionSeen?.apiReplay?.runtimeParameterSource, runtimeParameterSource);
    assert.equal(sessionSeen?.apiReplay?.responseEvidence?.arrayField, 'items');
    assert.equal(sessionSeen?.apiReplay?.method, 'GET');
    assert.equal(sessionSeen?.apiReplay?.allowedHost, host);
  });
});

test('browser bridge API replay wrapper preserves HEAD and rejects non-read methods', async () => {
  await withTestSite((rootUrl) => ({
    '/': testHtmlPage('Replay Host', '<main>Replay host</main>'),
    '/robots.txt': {
      contentType: 'text/plain; charset=utf-8',
      body: testRobotsTxt(rootUrl),
    },
  }), async (rootUrl) => {
    const host = new URL(rootUrl).hostname;
    let providerRequest = /** @type {any} */ (null);
    const head = await runBrowserBridgeApiReplay({
      inputUrl: rootUrl,
      site: {
        id: 'replay-fixture',
        rootUrl,
        allowedDomains: [host],
      },
      endpoint: new URL('/api/feed', rootUrl).toString(),
      method: 'HEAD',
      options: {
        browserBridgeApiReplayProvider: async (request) => {
          providerRequest = request;
          return {
            status: 'verified',
            httpStatus: 204,
            contentType: null,
            responseKind: null,
          };
        },
      },
      openBrowser: async () => {
        throw new Error('openBrowser should not be called when a provider is supplied');
      },
    });

    assert.equal(head.status, 'verified');
    assert.equal(providerRequest.method, 'HEAD');
    assert.equal(providerRequest.fetchOptions.method, 'HEAD');
    assert.equal(providerRequest.fetchOptions.body, null);
    assert.equal(providerRequest.fetchOptions.persistResponseBody, false);

    let providerCalled = false;
    const post = await runBrowserBridgeApiReplay({
      inputUrl: rootUrl,
      site: {
        id: 'replay-fixture',
        rootUrl,
        allowedDomains: [host],
      },
      endpoint: new URL('/api/feed', rootUrl).toString(),
      method: 'POST',
      options: {
        browserBridgeApiReplayProvider: async () => {
          providerCalled = true;
          return { status: 'verified' };
        },
      },
      openBrowser: async () => {
        throw new Error('openBrowser should not be called for rejected replay methods');
      },
    });

    assert.equal(post.status, 'skipped');
    assert.equal(post.reasonCode, 'method_not_read_only');
    assert.equal(providerCalled, false);
  });
});

test('browser auth bridge preserves submitted route statuses when summaries time out', async () => {
  await withTestSite((rootUrl) => ({
    '/': testHtmlPage('Challenge', '<main>Challenge</main>'),
    '/late': testHtmlPage('Late', '<main>Late</main>'),
    '/robots.txt': {
      contentType: 'text/plain; charset=utf-8',
      body: testRobotsTxt(rootUrl),
    },
  }), async (rootUrl) => {
    const site = {
      id: 'bridge-timeout-fixture',
      rootUrl,
      allowedDomains: [new URL(rootUrl).hostname],
    };
    const result = await runBrowserAuthBridge({
      inputUrl: rootUrl,
      site,
      options: {
        authMode: 'browser',
        browserBridgeTimeoutMs: 100,
        browserBridgeMaxRetryPasses: 0,
        localBuildConfig: {
          authRoutes: ['/', '/late'],
        },
      },
      openBrowser: async (bridgeUrl) => {
        const opened = new URL(bridgeUrl);
        const sessionUrl = new URL('/session.json', opened.origin);
        sessionUrl.searchParams.set('nonce', opened.searchParams.get('nonce'));
        const session = await (await fetch(sessionUrl)).json();
        await fetch(session.submitUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            nonce: session.nonce,
            routeResults: [{
              routeId: session.routes[0].id,
              targetUrl: session.routes[0].targetUrl,
              sourceLayer: session.routes[0].sourceLayer,
              status: 'challenge_detected',
              reasonCode: 'browser-bridge-definite-challenge',
              collectorVersion: 'route-queue-chinese-semantic-v7',
            }],
          }),
        });
      },
    });

    assert.equal(result.status, 'browser_blocked');
    assert.equal(result.verified, false);
    assert.equal(result.bridgeSummary.routeResults[0].status, 'challenge_detected');
    assert.equal(result.bridgeSummary.routeResults[0].reasonCode, 'browser-bridge-definite-challenge');
    assert.equal(result.bridgeSummary.routeResults[1].status, 'timeout');
    assert.equal(result.blockingSignals.includes('browser-bridge-route-challenge-detected'), true);
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

test('cookie runtime source keeps public crawl cookie-free and only authenticates auth seeds', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-cookie-public-source-'));
  const robotsCookies = [];
  const sitemapCookies = [];
  const homeCookies = [];
  const catalogCookies = [];
  const accountCookies = [];
  try {
    await withTestServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1/').pathname;
      const cookie = String(request.headers.cookie ?? '');
      if (pathname === '/robots.txt') {
        robotsCookies.push(cookie);
        const rootUrl = `http://${request.headers.host}/`;
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(testRobotsTxt(rootUrl));
        return;
      }
      if (pathname === '/sitemap.xml') {
        sitemapCookies.push(cookie);
        const rootUrl = `http://${request.headers.host}/`;
        response.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
        response.end(testSitemapXml(rootUrl, ['/', '/catalog']));
        return;
      }
      if (pathname === '/account') {
        accountCookies.push(cookie);
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(testHtmlPage('Account', '<main><ul><li>notice</li></ul></main>'));
        return;
      }
      if (pathname === '/catalog') {
        catalogCookies.push(cookie);
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(testHtmlPage('Catalog', '<main><ul><li>public item</li></ul></main>'));
        return;
      }
      homeCookies.push(cookie);
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(testHtmlPage('Public', `
        <main>
          <nav><a href="/catalog">Catalog</a></nav>
          <form method="GET" action="/search"><input name="q"><button>Search</button></form>
        </main>
      `));
    }, async (rootUrl) => {
      const site = {
        id: 'cookie-public-source-test',
        rootUrl,
        allowedDomains: [new URL(rootUrl).hostname],
      };
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
        site,
        authStateReport,
        coverageTargets: {
          publicRoutes: ['/'],
          authRoutes: ['/account'],
          publicRevisitRoutes: [],
        },
      });

      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'cookie-public-source',
        now: new Date('2026-05-21T08:18:00.000Z'),
        fetchDelayMs: 0,
        authMode: 'cookie',
        authRuntime: {
          method: 'cookie',
          cookieHeader: 'sid=ok; uid=123',
          allowedDomains: [new URL(rootUrl).hostname],
        },
        authStateReport,
        crawlContract,
      });

      assert.equal(result.status, 'success');
      assert.equal(robotsCookies.length > 0, true);
      assert.equal(sitemapCookies.length > 0, true);
      assert.equal(homeCookies.length > 0, true);
      assert.equal(catalogCookies.length > 0, true);
      assert.equal([...robotsCookies, ...sitemapCookies, ...homeCookies, ...catalogCookies].every((cookie) => !cookie.includes('sid=ok')), true);
      assert.equal(accountCookies.some((cookie) => cookie.includes('sid=ok')), true);

      const crawlAuthenticated = await readJson(path.join(result.artifactDir, 'crawl_authenticated.json'));
      assert.equal(crawlAuthenticated.authenticatedPages.some((page) => /\/account$/u.test(page.normalizedUrl)), true);
      const siteRoot = siteWorkspaceDir(workspace, rootUrl);
      const reportText = await readExistingTextFiles([
        ...await collectTextFiles(result.artifactDir),
        ...await collectTextFiles(path.join(siteRoot, 'current')).catch(() => []),
        path.join(siteRoot, 'registry.json'),
      ]);
      assert.doesNotMatch(reportText, /authRuntime|cookieHeader|cookieEnv|cookieFile|cookieStdin|sid=ok|uid=123/iu);
      const profilePaths = [
        path.join(siteWorkspaceDir(workspace, rootUrl), 'setup', 'build_profile.json'),
        path.join(result.artifactDir, 'inputs', 'build_profile.json'),
      ];
      for (const inputProfilePath of profilePaths) {
        if (!(await fileExists(inputProfilePath))) {
          continue;
        }
        const inputProfileText = await readFile(inputProfilePath, 'utf8');
        assert.doesNotMatch(inputProfileText, /authRuntime|cookieHeader|cookieEnv|cookieFile|cookieStdin|sid=ok|uid=123/iu);
        const inputProfile = JSON.parse(inputProfileText);
        assert.equal(Object.hasOwn(inputProfile, 'authRuntime'), false);
      }
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('cookie auth runtime material is not persisted when a later stage fails after authenticated crawl', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-cookie-post-auth-failure-'));
  const authCheckCookies = [];
  const accountCookies = [];
  const secretCookie = 'sid=ok; uid=123';
  try {
    await withTestServer((request, response) => {
      const rootUrl = `http://${request.headers.host}/`;
      const pathname = new URL(request.url ?? '/', rootUrl).pathname;
      const cookie = String(request.headers.cookie ?? '');
      if (pathname === '/robots.txt') {
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(testRobotsTxt(rootUrl));
        return;
      }
      if (pathname === '/sitemap.xml') {
        response.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
        response.end(testSitemapXml(rootUrl, ['/', '/account', '/auth-check']));
        return;
      }
      if (pathname === '/auth-check') {
        authCheckCookies.push(cookie);
        if (!cookie.includes('sid=ok')) {
          response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('Forbidden');
          return;
        }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(testHtmlPage('Auth check', '<main><ul><li>verified</li></ul></main>'));
        return;
      }
      if (pathname === '/account') {
        accountCookies.push(cookie);
        if (!cookie.includes('sid=ok')) {
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
      const site = {
        id: 'cookie-post-auth-failure-test',
        rootUrl,
        allowedDomains: [new URL(rootUrl).hostname],
      };
      const initialAuthStateReport = {
        schemaVersion: 1,
        artifactFamily: 'siteforge-auth-state-report',
        crawlMode: 'authenticated_cookie',
        authMethod: 'cookie',
        authVerificationStatus: 'cookie_verified',
        verified: true,
        source: 'cookie_header_verification',
        blockingSignals: [],
        positiveSignals: ['cookie_header_present', 'auth_check_http_success', 'auth_check_not_login_route'],
        verifiedRoutes: ['/auth-check'],
        capabilityProofs: [],
        rawMaterialPersisted: false,
        sessionMaterialPersisted: false,
        cookieMaterialPersisted: false,
        browserProfilePersisted: false,
      };
      const crawlContract = createCrawlContract({
        site,
        authStateReport: initialAuthStateReport,
        coverageTargets: {
          publicRoutes: ['/'],
          authRoutes: ['/account'],
          publicRevisitRoutes: [],
        },
      });

      let capturedError = /** @type {any} */ (null);
      await assert.rejects(
        () => runSiteForgeBuild(rootUrl, {
          cwd: workspace,
          buildId: 'cookie-post-auth-failure',
          now: new Date('2026-05-26T08:00:00.000Z'),
          fetchDelayMs: 0,
          authMode: 'cookie',
          strictCookieAuth: true,
          cookieHeader: secretCookie,
          authCheckUrl: '/auth-check',
          authStateReport: initialAuthStateReport,
          crawlContract,
          renderJs: true,
          publicRenderedStructureProvider: async ({ context }) => {
            assert.equal(context.options.cookieHeader, undefined);
            assert.equal(context.options.cookieEnv, undefined);
            assert.equal(context.options.cookieFile, undefined);
            assert.equal(context.options.cookieStdin, undefined);
            assert.equal(context.options.authRuntime, undefined);
            assert.equal(context.options.authenticatedStructureSummary, undefined);
            const error = new Error('synthetic post-auth render failure cookieHeader=sid=ok; uid=123 authRuntime');
            error.code = 'synthetic-post-auth-render-failure';
            error.reasonCode = 'synthetic-post-auth-render-failure';
            throw error;
          },
        }),
        (error) => {
          capturedError = error;
          return true;
        },
      );

      assert.equal(capturedError?.stage, 'crawlRendered');
      assert.equal(authCheckCookies.some((cookie) => cookie.includes('sid=ok')), true);
      assert.equal(accountCookies.some((cookie) => cookie.includes('sid=ok')), true);
      const artifactDir = path.join(siteBuildsDir(workspace, rootUrl), 'cookie-post-auth-failure');
      const authStateReport = await readJson(path.join(artifactDir, 'auth_state_report.json'));
      assert.equal(authStateReport.authMethod, 'cookie');
      assert.equal(authStateReport.authVerificationStatus, 'cookie_verified');
      assert.equal(authStateReport.verified, true);
      const crawlAuthenticated = await readJson(path.join(artifactDir, 'crawl_authenticated.json'));
      assert.equal(crawlAuthenticated.authenticatedPages.some((page) => /\/account$/u.test(page.normalizedUrl)), true);
      const buildReport = await readJson(path.join(artifactDir, 'build_report.json'));
      assert.equal(buildReport.failedStage, 'crawlRendered');
      assert.notEqual(buildReport.summary.registryStatus, 'registered');
      assert.equal(buildReport.summary.currentUpdated, false);

      const siteRoot = siteWorkspaceDir(workspace, rootUrl);
      const persistedText = await readExistingTextFiles([
        ...await collectTextFiles(artifactDir),
        ...await collectTextFiles(path.join(siteRoot, 'current')).catch(() => []),
        path.join(siteRoot, 'registry.json'),
        path.join(siteRoot, 'setup', 'build_profile.json'),
        path.join(artifactDir, 'inputs', 'build_profile.json'),
      ]);
      assert.doesNotMatch(
        persistedText,
        /authRuntime|cookieHeader|cookieEnv|cookieFile|cookieStdin|sid=ok|uid=123/iu,
      );
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('authenticated cookie crawl does not follow robots-disallowed redirects with Cookie', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-auth-cookie-redirect-robots-'));
  const authCheckCookies = [];
  const privateStartCookies = [];
  const privateFinalCookies = [];
  try {
    await withTestServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1/').pathname;
      if (pathname === '/robots.txt') {
        const rootUrl = `http://${request.headers.host}/`;
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(testRobotsTxt(rootUrl, { disallow: '/private-final', sitemap: false }));
        return;
      }
      if (pathname === '/sitemap.xml') {
        const rootUrl = `http://${request.headers.host}/`;
        response.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
        response.end(testSitemapXml(rootUrl, ['/']));
        return;
      }
      if (pathname === '/auth-check') {
        authCheckCookies.push(String(request.headers.cookie ?? ''));
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(testHtmlPage('Auth check', '<main><ul><li>verified</li></ul></main>'));
        return;
      }
      if (pathname === '/private-start') {
        privateStartCookies.push(String(request.headers.cookie ?? ''));
        response.writeHead(302, { location: '/private-final' });
        response.end('');
        return;
      }
      if (pathname === '/private-final') {
        privateFinalCookies.push(String(request.headers.cookie ?? ''));
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(testHtmlPage('Private final', '<main><ul><li>private final</li></ul></main>'));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(testHtmlPage('Public', `
        <main>
          <nav><a href="/catalog">Catalog</a></nav>
          <form method="GET" action="/search"><input name="q"><button>Search</button></form>
        </main>
      `));
    }, async (rootUrl) => {
      const site = {
        id: 'auth-cookie-redirect-robots-test',
        rootUrl,
        allowedDomains: [new URL(rootUrl).hostname],
      };
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
        verifiedRoutes: ['/auth-check'],
        capabilityProofs: [],
        rawMaterialPersisted: false,
        sessionMaterialPersisted: false,
        cookieMaterialPersisted: false,
        browserProfilePersisted: false,
      };
      const crawlContract = createCrawlContract({
        site,
        authStateReport,
        coverageTargets: {
          publicRoutes: ['/'],
          authRoutes: ['/private-start'],
          publicRevisitRoutes: [],
        },
      });

      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'auth-cookie-redirect-robots',
        now: new Date('2026-05-21T08:17:00.000Z'),
        fetchDelayMs: 0,
        authMode: 'cookie',
        cookieHeader: 'sid=ok; uid=123',
        authCheckUrl: '/auth-check',
        authStateReport,
        crawlContract,
      });

      assert.equal(result.status, 'success');
      assert.equal(authCheckCookies.some((cookie) => cookie.includes('sid=ok')), true);
      assert.equal(privateStartCookies.some((cookie) => cookie.includes('sid=ok')), true);
      assert.equal(privateFinalCookies.length, 0);

      const crawlAuthenticated = await readJson(path.join(result.artifactDir, 'crawl_authenticated.json'));
      assert.equal(JSON.stringify(crawlAuthenticated.authenticatedPages).includes('/private-final'), false);
      assert.equal(crawlAuthenticated.warnings.some((warning) => /static-fetch-auth-redirect-robots-disallowed/u.test(warning)), true);

      const reportText = [
        await readFile(path.join(result.artifactDir, 'auth_state_report.json'), 'utf8'),
        await readFile(path.join(result.artifactDir, 'crawl_authenticated.json'), 'utf8'),
        await readFile(path.join(result.artifactDir, 'build_report.json'), 'utf8'),
        await readFile(path.join(result.artifactDir, 'build_report.debug.json'), 'utf8'),
        await readFile(path.join(result.artifactDir, 'build_report.user.json'), 'utf8'),
        await readFile(path.join(result.artifactDir, 'reports', 'capability_intent_summary.html'), 'utf8'),
      ].join('\n');
      assert.doesNotMatch(reportText, /sid=ok|uid=123/u);
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
      const completeRouteCapturePlan = await readJson(path.join(result.artifactDir, 'route_capture_plan.json'));
      assert.equal(completeRouteCapturePlan.status, 'complete');
      assert.equal(completeRouteCapturePlan.routeCoverageStatus, 'complete');
      assert.equal(completeRouteCapturePlan.routeCount, 3);
      assert.equal(completeRouteCapturePlan.capturedRouteCount, 3);
      assert.equal(completeRouteCapturePlan.missingRouteCount, 0);
      assert.deepEqual(completeRouteCapturePlan.missingRoutes, []);

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
      assert.match(userReport.reports.route_capture_plan, /route_capture_plan\.json/u);
      assert.equal(userReport.next_step_workflows.some((workflow) => workflow.id === 'browser-bridge-route-retry'), false);
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
            links: [{
              href: '/account',
              label: 'Account dashboard',
              semanticKind: 'profile',
              routeTemplate: '/account',
            }],
          }, {
            routeId: routes[1].id,
            url: routes[1].targetUrl,
            routeTemplate: '/account',
            tabState: 'account',
            pageType: 'account_navigation',
            visibleItemCount: 3,
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
      assert.equal(authReport.authVerificationStatus, 'browser_verified_partial');
      assert.equal(authReport.verified, true);
      assert.equal(authReport.browserBridge.routeCount, 3);
      assert.equal(authReport.browserBridge.capturedRouteCount, 2);
      assert.equal(authReport.browserBridge.missingRouteCount, 1);
      assert.equal(authReport.browserBridge.routeCoverageStatus, 'partial');
      assert.equal(authReport.browserBridge.retryStatus, 'not_attempted');

      const crawlAuthenticated = await readJson(path.join(result.artifactDir, 'crawl_authenticated.json'));
      assert.equal(crawlAuthenticated.authenticatedPages.length, 1);
      assert.equal(crawlAuthenticated.authenticatedOverlayPages.length, 1);

      const graph = await readJson(path.join(result.artifactDir, 'graph.json'));
      assert.equal(graph.nodes.some((node) => (
        ['authenticated', 'authenticated_overlay'].includes(node.sourceLayer)
        && node.routeTemplate === '/account'
      )), false);

      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      assert.equal(capabilities.capabilities.some((capability) => (
        capability.sourceLayer === 'authenticated_overlay'
        && capability.elementRole === 'ranking'
        && capability.object === '\u70ed\u95e8\u699c\u5355'
      )), true);
      assert.equal(JSON.stringify(capabilities).includes('/account'), false);

      const executionPlans = await readJson(path.join(result.artifactDir, 'execution_plans.json'));
      assert.equal(JSON.stringify(executionPlans).includes('/account'), false);

      const intents = await readJson(path.join(result.artifactDir, 'intents.json'));
      assert.equal(JSON.stringify(intents).includes('/account'), false);

      const userReport = await readJson(path.join(result.artifactDir, 'build_report.user.json'));
      assert.equal(userReport.result_status, 'partial_success');
      assert.equal(userReport.authVerificationStatus, 'browser_verified_partial');
      assert.equal(userReport.build_completion.registry_status, 'registered');
      assert.equal(userReport.build_completion.current_updated, true);
      assert.equal(userReport.build_completion.runtime_mode, 'browser_bridge_required');
      assert.equal(userReport.coverage.browserBridge.routeCount, 3);
      assert.equal(userReport.coverage.browserBridge.capturedRouteCount, 2);
      assert.equal(userReport.coverage.browserBridge.missingRouteCount, 1);
      assert.equal(userReport.coverage.browserBridge.routeCoverageStatus, 'partial');
      assert.equal(userReport.coverage.runtime.browserBridgeRuntimeCapabilities > 0, true);
      assert.equal(userReport.build_completion.runtime_counts.browserBridgeRuntimeCapabilities > 0, true);
      const buildReport = await readJson(path.join(result.artifactDir, 'build_report.json'));
      assert.equal(buildReport.summary.auth.authVerificationStatus, 'browser_verified_partial');
      assert.equal(buildReport.crawlContract.sourceMode, 'browser_bridge_partial');
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
      assert.equal(JSON.stringify(registryReport).includes('/account'), false);
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

test('missing browser auth routes are not revived as public capabilities', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-browser-missing-public-'));
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
        response.end(testSitemapXml(rootUrl, ['/', '/notifications', '/catalog']));
        return;
      }
      if (pathname === '/notifications') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(testHtmlPage('Notifications', '<main><h1>Notifications</h1><ul><li>public shell</li></ul></main>'));
        return;
      }
      if (pathname === '/catalog') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(testHtmlPage('Catalog', '<main><a href="/item">Item</a></main>'));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(testHtmlPage('Public', `
        <main>
          <a href="/notifications">Notifications</a>
          <a href="/catalog">Catalog</a>
        </main>
      `));
    }, async (rootUrl) => {
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'browser-missing-public',
        now: new Date('2026-05-26T09:00:00.000Z'),
        maxDepth: 2,
        maxPages: 20,
        maxSeeds: 20,
        renderJs: true,
        fetchDelayMs: 0,
        authMode: 'browser',
        strictBrowserAuth: true,
        browserBridgeMaxRetryPasses: 0,
        localBuildConfig: {
          auth: { mode: 'browser' },
          authRoutes: ['/notifications'],
          publicRevisitRoutes: ['/'],
        },
        publicRenderedStructureProvider: async () => ({
          publicRenderedPages: [{
            url: rootUrl,
            routeTemplate: '/',
            pageType: 'home_public_rendered',
            visibleItemCount: 1,
            listPresent: true,
            links: [
              { href: '/notifications', label: 'Notifications', semanticKind: 'notification_list' },
              { href: '/catalog', label: 'Catalog', semanticKind: 'category' },
            ],
          }],
        }),
        browserAuthBridgeProvider: async ({ routes }) => {
          const authRoute = routes.find((route) => route.routeTemplate === '/notifications');
          const overlayRoute = routes.find((route) => route.sourceLayer === 'authenticated_overlay');
          return {
            authenticatedOverlayPages: [{
              routeId: overlayRoute?.id,
              url: overlayRoute?.targetUrl,
              routeTemplate: '/',
              pageType: 'home_overlay',
              visibleItemCount: 1,
              listPresent: true,
            }],
            routeResults: [{
              routeId: authRoute?.id,
              sourceLayer: 'authenticated',
              targetRoute: '/notifications',
              status: 'challenge_detected',
              reasonCode: 'browser-bridge-route-challenge-detected',
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      assert.equal(result.result_status, 'partial_success');
      const authReport = await readJson(path.join(result.artifactDir, 'auth_state_report.json'));
      assert.equal(authReport.browserBridge.missingRouteCount, 1);
      assert.equal(authReport.browserBridge.routeResults.some((route) => (
        route.targetRoute === '/notifications'
        && route.captured === false
      )), true);

      const crawlStatic = await readJson(path.join(result.artifactDir, 'crawl_static.json'));
      assert.equal(crawlStatic.pages.some((page) => /\/notifications$/u.test(page.normalizedUrl)), false);
      assert.equal(JSON.stringify(crawlStatic.pages).includes('/notifications'), false);

      const crawlRendered = await readJson(path.join(result.artifactDir, 'crawl_rendered.json'));
      assert.equal(JSON.stringify(crawlRendered.publicRenderedPages ?? []).includes('/notifications'), false);

      const graph = await readJson(path.join(result.artifactDir, 'graph.json'));
      assert.equal(JSON.stringify(graph.nodes).includes('/notifications'), false);

      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      assert.equal(JSON.stringify(capabilities.capabilities).includes('/notifications'), false);

      const executionPlans = await readJson(path.join(result.artifactDir, 'execution_plans.json'));
      assert.equal(JSON.stringify(executionPlans).includes('/notifications'), false);

      const intents = await readJson(path.join(result.artifactDir, 'intents.json'));
      assert.equal(JSON.stringify(intents).includes('/notifications'), false);

      const userReport = await readJson(path.join(result.artifactDir, 'build_report.user.json'));
      assert.equal(userReport.blocked_by_auth.some((entry) => entry.routeTemplate === '/notifications'), true);

      const routeCapturePlan = await readJson(path.join(result.artifactDir, 'route_capture_plan.json'));
      assert.equal(routeCapturePlan.missingRoutes.some((route) => (
        route.targetRoute === '/notifications'
        && route.capabilityGenerated === false
      )), true);

      const registryReport = await readJson(path.join(result.artifactDir, 'registry_report.json'));
      assert.equal(JSON.stringify(registryReport).includes('/notifications'), false);

      const siteRoot = siteWorkspaceDir(workspace, rootUrl);
      for (const currentFile of ['graph.json', 'capabilities.json', 'execution_plans.json', 'intents.json']) {
        const currentPath = path.join(siteRoot, 'current', currentFile);
        if (await fileExists(currentPath)) {
          assert.equal((await readFile(currentPath, 'utf8')).includes('/notifications'), false);
        }
      }
      const registry = await readJson(path.join(siteRoot, 'registry.json'));
      assert.equal(JSON.stringify(registry).includes('/notifications'), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('browser bridge route queue overflow is reported as uncovered routes', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-browser-route-overflow-'));
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
        response.end(testSitemapXml(rootUrl, ['/']));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(testHtmlPage('Public', '<main><a href="/catalog">Catalog</a></main>'));
    }, async (rootUrl) => {
      const authRoutes = Array.from({ length: 100 }, (_, index) => `/route-${index + 1}`);
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'browser-route-overflow',
        now: new Date('2026-05-26T09:10:00.000Z'),
        maxDepth: 1,
        maxPages: 10,
        maxSeeds: 10,
        fetchDelayMs: 0,
        authMode: 'browser',
        strictBrowserAuth: true,
        browserBridgeMaxRetryPasses: 0,
        renderedStructureProvider: async () => ({
          url: rootUrl,
          routeTemplate: '/',
          pageType: 'public_rendered_home',
          sourceLayer: 'public_rendered',
          links: [{
            href: new URL('/route-41', rootUrl).toString(),
            routeTemplate: '/route-41',
            label: 'FAKE_AUTH_OVERFLOW_ABILITY',
            semanticKind: 'category',
          }, {
            href: new URL('/route-100', rootUrl).toString(),
            routeTemplate: '/route-100',
            label: 'FAKE_AUTH_OVERFLOW_ABILITY',
            semanticKind: 'ranking',
          }],
          itemLinks: [],
          controls: [],
          forms: [],
        }),
        localBuildConfig: {
          auth: { mode: 'browser' },
          authRoutes,
        },
        browserAuthBridgeProvider: async ({ routes }) => {
          assert.equal(routes.length, 32);
          return {
            authenticatedPages: [{
              routeId: routes[0].id,
              url: routes[0].targetUrl,
              routeTemplate: routes[0].routeTemplate,
              pageType: 'authenticated_route_summary',
              visibleItemCount: 1,
              listPresent: true,
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      assert.equal(result.result_status, 'partial_success');
      const authReport = await readJson(path.join(result.artifactDir, 'auth_state_report.json'));
      assert.equal(authReport.authVerificationStatus, 'browser_verified_partial');
      assert.equal(authReport.browserBridge.routeCount, 100);
      assert.equal(authReport.browserBridge.scheduledRouteCount, 32);
      assert.equal(authReport.browserBridge.overflowRouteCount, 68);
      assert.equal(authReport.browserBridge.unattemptedRouteCount, 68);
      assert.equal(authReport.browserBridge.routeQueueTruncated, true);
      assert.equal(authReport.browserBridge.routeResultCount, 100);
      assert.equal(authReport.browserBridge.routeResultOmittedCount, 0);
      assert.equal(authReport.browserBridge.routeResults.length, 100);
      assert.equal(authReport.browserBridge.routeResults.some((route) => route.targetRoute === '/route-35'), true);
      assert.equal(authReport.browserBridge.routeResults.some((route) => route.targetRoute === '/route-100'), true);

      const routeCapturePlan = await readJson(path.join(result.artifactDir, 'route_capture_plan.json'));
      assert.equal(routeCapturePlan.routeCount, 100);
      assert.equal(routeCapturePlan.missingRouteCount, 99);
      assert.equal(routeCapturePlan.unattemptedRouteCount, 68);
      assert.equal(routeCapturePlan.unattemptedRoutes.length, 68);
      assert.equal(routeCapturePlan.missingRoutes.some((route) => (
        route.targetRoute === '/route-33'
        && route.finalReasonCode === 'browser-bridge-route-limit-exceeded'
        && route.recommendedRetryMode === 'split_browser_bridge_route_batch'
        && route.capabilityGenerated === false
      )), true);
      assert.equal(routeCapturePlan.missingRoutes.some((route) => route.targetRoute === '/route-35'), true);
      assert.equal(routeCapturePlan.missingRoutes.some((route) => route.targetRoute === '/route-100'), true);

      const graph = await readJson(path.join(result.artifactDir, 'graph.json'));
      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      const executionPlans = await readJson(path.join(result.artifactDir, 'execution_plans.json'));
      const intents = await readJson(path.join(result.artifactDir, 'intents.json'));
      const registryReport = await readJson(path.join(result.artifactDir, 'registry_report.json'));
      for (const artifact of [graph.nodes, capabilities.capabilities, executionPlans, intents.intents, registryReport]) {
        assert.equal(JSON.stringify(artifact).includes('/route-33'), false);
        assert.equal(JSON.stringify(artifact).includes('/route-100'), false);
        assert.equal(JSON.stringify(artifact).includes('FAKE_AUTH_OVERFLOW_ABILITY'), false);
      }

      const siteRoot = siteWorkspaceDir(workspace, rootUrl);
      for (const currentFile of ['graph.json', 'capabilities.json', 'execution_plans.json', 'intents.json', 'skill.yaml']) {
        const currentPath = path.join(siteRoot, 'current', currentFile);
        if (await fileExists(currentPath)) {
          const currentText = await readFile(currentPath, 'utf8');
          assert.equal(currentText.includes('/route-33'), false);
          assert.equal(currentText.includes('/route-100'), false);
          assert.equal(currentText.includes('FAKE_AUTH_OVERFLOW_ABILITY'), false);
        }
      }
      const registry = await readJson(path.join(siteRoot, 'registry.json'));
      assert.equal(JSON.stringify(registry).includes('/route-33'), false);
      assert.equal(JSON.stringify(registry).includes('/route-100'), false);
      assert.equal(JSON.stringify(registry).includes('FAKE_AUTH_OVERFLOW_ABILITY'), false);

      const htmlReport = await readFile(path.join(result.artifactDir, 'reports', 'capability_intent_summary.html'), 'utf8');
      assert.match(htmlReport, /Browser Bridge Route Coverage/u);
      assert.match(htmlReport, /Only the first 40 missing routes are shown here/u);
      assert.match(htmlReport, /59 more are listed in <code>route_capture_plan\.json<\/code>/u);
      assert.match(htmlReport, /route_capture_plan\.json/u);
      assert.match(htmlReport, /\/route-41/u);
      assert.doesNotMatch(htmlReport, /\/route-42/u);
      assert.match(htmlReport, /unattempted 68/u);
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

test('registry write failure after promotion rolls back active current state', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-registry-atomic-'));
  try {
    await withTestSite(simpleShopRoutes, async (rootUrl) => {
      const success = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'atomic-success-build',
        now: new Date('2026-05-16T05:00:00.000Z'),
        fetchDelayMs: 0,
      });
      const siteRoot = siteWorkspaceDir(workspace, rootUrl);
      const currentSkillPath = path.join(siteRoot, 'current', 'skill.yaml');
      const currentVerificationPath = path.join(siteRoot, 'current', 'verification_report.json');
      const registryPath = path.join(siteRoot, 'registry.json');
      const lastSuccessfulPath = path.join(siteRoot, 'last_successful_build.json');
      const currentSkillBefore = await readFile(currentSkillPath, 'utf8');
      const currentVerificationBefore = await readFile(currentVerificationPath, 'utf8');
      const registryBefore = await readFile(registryPath, 'utf8');
      const lastSuccessfulBefore = await readFile(lastSuccessfulPath, 'utf8');

      const registryBlocker = path.join(siteRoot, 'registry-blocker');
      await writeFile(registryBlocker, 'not a directory', 'utf8');
      await assert.rejects(
        () => runSiteForgeBuild(rootUrl, {
          cwd: workspace,
          buildId: 'atomic-registry-fail-build',
          now: new Date('2026-05-16T06:00:00.000Z'),
          fetchDelayMs: 0,
          registryPath: path.join(registryBlocker, 'registry.json'),
        }),
      );

      assert.equal(await readFile(currentSkillPath, 'utf8'), currentSkillBefore);
      assert.equal(await readFile(currentVerificationPath, 'utf8'), currentVerificationBefore);
      assert.equal(await readFile(registryPath, 'utf8'), registryBefore);
      assert.equal(await readFile(lastSuccessfulPath, 'utf8'), lastSuccessfulBefore);
      assert.equal((await readJson(lastSuccessfulPath)).buildId, success.buildId);
      const siteEntries = await readdir(siteRoot);
      assert.equal(siteEntries.some((entry) => entry.includes('atomic-registry-fail-build') && /\.backup|\.tmp/u.test(entry)), false);
      const failedBuildDir = path.join(siteRoot, 'builds', 'atomic-registry-fail-build');
      const failedReport = await readJson(path.join(failedBuildDir, 'build_report.json'));
      assert.equal(failedReport.failedStage, 'registerSkill');
      assert.notEqual(failedReport.summary.registryStatus, 'registered');
      assert.equal(failedReport.summary.currentUpdated, false);
      assert.equal(await fileExists(path.join(failedBuildDir, 'registry_report.json')), false);
      assert.equal(await fileExists(path.join(failedBuildDir, 'reports', 'registry_report.json')), false);
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
                renderJs: false,
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
      assert.equal(setupPlan.localBuildConfig.build.renderJs, false);
      assert.equal(setupPlan.localBuildConfig.authorizedSources.length, 1);
      assert.equal(setupPlan.localBuildConfig.authorizedSources[0].genericCrawlAllowed, false);
      assert.equal(setupPlan.localBuildConfig.authorizedSources[0].promotionAllowed, false);

      const buildReport = await readJson(path.join(artifactDir, 'build_report.json'));
      assert.equal(buildReport.summary.authorizedSources.configured, 1);
      assert.equal(buildReport.summary.authorizedSources.sources[0].kind, 'rss');
      assert.equal(buildReport.summary.authorizedSources.sources[0].genericCrawlAllowed, false);
      assert.equal(buildReport.summary.authorizedSources.sources[0].promotionAllowed, false);
      assert.equal(await fileExists(path.join(artifactDir, 'discovery', 'network_traces.raw.json')), false);
      const networkSummary = await readJson(path.join(artifactDir, 'network_traces.json'));
      assert.equal(networkSummary.sanitizedSummary.apiExtractionDisabledReason, 'render-js-disabled-by-local-config');
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
        await readFile(path.join(artifactDir, 'inputs', 'build_profile.json'), 'utf8'),
        await readFile(path.join(artifactDir, 'auth_state_report.json'), 'utf8'),
        await readFile(path.join(artifactDir, 'build_report.json'), 'utf8'),
        await readFile(path.join(artifactDir, 'build_report.debug.json'), 'utf8'),
        await readFile(path.join(artifactDir, 'build_report.user.json'), 'utf8'),
        await readFile(path.join(artifactDir, 'reports', 'capability_intent_summary.html'), 'utf8'),
      ].join('\n');
      assert.doesNotMatch(reportText, /authRuntime|cookieHeader|cookieEnv|cookieFile|cookieStdin|SITEFORGE_TEST_COOKIE|SECRET_SESSION_VALUE|sid=|uid=123/iu);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('public SiteForge CLI strips sensitive configured route material before persistence', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-cli-route-redaction-'));
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
      const { protocol, host } = new URL(rootUrl);
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
                authRoutes: [
                  `${protocol}//route-user:ROUTE_PASS@${host}/account?route_marker=LOCAL_ROUTE_VALUE&opaque=LOCAL_ROUTE_OPAQUE#frag`,
                ],
                publicRevisitRoutes: [
                  `${protocol}//revisit-user:REVISIT_PASS@${host}/?session_id=LOCAL_REVISIT_SESSION&api_key=LOCAL_REVISIT_KEY#tab`,
                ],
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
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /SECRET_SESSION_VALUE|sid=|uid=123|LOCAL_ROUTE_VALUE|LOCAL_REVISIT_SESSION/u);
      const buildDirs = await listBuildDirs(siteBuildsDir(workspace, rootUrl));
      assert.equal(buildDirs.length, 1);
      const artifactDir = buildDirs[0];
      const siteRoot = siteWorkspaceDir(workspace, rootUrl);
      const setupPlan = await readJson(path.join(siteRoot, 'setup', 'setup_plan.json'));
      const setupProfile = await readJson(path.join(siteRoot, 'setup', 'build_profile.json'));
      const artifactBuildProfile = await readJson(path.join(artifactDir, 'inputs', 'build_profile.json'));
      const seeds = await readJson(path.join(artifactDir, 'seeds.json'));
      const buildReport = await readJson(path.join(artifactDir, 'build_report.json'));
      const configuredAuthRoute = setupPlan.localBuildConfig.authRoutes.find((urlValue) => /\/account$/u.test(urlValue));
      const configuredRevisitRoute = setupPlan.localBuildConfig.publicRevisitRoutes.find((urlValue) => new URL(urlValue).pathname === '/');
      assert.ok(configuredAuthRoute);
      assert.ok(configuredRevisitRoute);
      assert.equal(new URL(configuredAuthRoute).username, '');
      assert.equal(new URL(configuredAuthRoute).password, '');
      assert.equal(new URL(configuredAuthRoute).search, '');
      assert.equal(new URL(configuredAuthRoute).hash, '');
      assert.equal(new URL(configuredRevisitRoute).username, '');
      assert.equal(new URL(configuredRevisitRoute).password, '');
      assert.equal(new URL(configuredRevisitRoute).search, '');
      assert.equal(new URL(configuredRevisitRoute).hash, '');
      assert.equal(buildReport.crawlContract.coverageTargets.authRoutes.some((urlValue) => /\/account$/u.test(urlValue)), true);
      assert.equal(buildReport.crawlContract.coverageTargets.publicRevisitRoutes.some((urlValue) => new URL(urlValue).pathname === '/'), true);
      assert.equal(seeds.authSeeds.some((seed) => /\/account$/u.test(seed.normalizedUrl)), true);
      assert.equal(seeds.revisitSeeds.some((seed) => new URL(seed.normalizedUrl).pathname === '/'), true);
      const artifactFiles = [
        path.join(siteRoot, 'setup', 'setup_plan.json'),
        path.join(siteRoot, 'setup', 'build_profile.json'),
        path.join(artifactDir, 'inputs', 'build_profile.json'),
        path.join(artifactDir, 'auth_state_report.json'),
        path.join(artifactDir, 'crawl_authenticated.json'),
        path.join(artifactDir, 'seeds.json'),
        path.join(artifactDir, 'graph.json'),
        path.join(artifactDir, 'classified_graph.json'),
        path.join(artifactDir, 'capabilities.json'),
        path.join(artifactDir, 'execution_plans.json'),
        path.join(artifactDir, 'build_report.json'),
        path.join(artifactDir, 'build_report.debug.json'),
        path.join(artifactDir, 'build_report.user.json'),
        path.join(artifactDir, 'reports', 'capability_intent_summary.html'),
      ];
      if (await fileExists(path.join(artifactDir, 'route_capture_plan.json'))) {
        artifactFiles.push(path.join(artifactDir, 'route_capture_plan.json'));
      }
      const reportText = (await Promise.all(artifactFiles.map((filePath) => readFile(filePath, 'utf8')))).join('\n');
      assert.doesNotMatch(reportText, /SECRET_SESSION_VALUE|route-user|ROUTE_PASS|revisit-user|REVISIT_PASS|LOCAL_ROUTE_VALUE|LOCAL_ROUTE_OPAQUE|LOCAL_REVISIT_SESSION|LOCAL_REVISIT_KEY|route_marker=|session_id=|api_key=|sid=|uid=123|#frag|#tab/iu);
      assert.doesNotMatch(JSON.stringify(setupProfile), /route-user|ROUTE_PASS|revisit-user|REVISIT_PASS|LOCAL_ROUTE_VALUE|LOCAL_REVISIT_SESSION|route_marker=|session_id=/iu);
      const forbiddenProfilePattern = /authRuntime|cookieHeader|cookieEnv|cookieFile|cookieStdin|SITEFORGE_TEST_COOKIE|SECRET_SESSION_VALUE|sid=|uid=123/iu;
      assert.doesNotMatch(JSON.stringify(setupProfile), forbiddenProfilePattern);
      assert.doesNotMatch(JSON.stringify(artifactBuildProfile), forbiddenProfilePattern);
      assert.equal(Object.hasOwn(setupProfile, 'authRuntime'), false);
      assert.equal(Object.hasOwn(artifactBuildProfile, 'authRuntime'), false);
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

test('build profile safety rejects runtime cookie material without echoing secret values', () => {
  assert.doesNotThrow(() => assertBuildProfileSafe({
    artifactFamily: 'siteforge-build-profile',
    source: { type: 'live_website' },
    authStateReport: {
      authMethod: 'cookie',
      authVerificationStatus: 'cookie_verified',
      cookieInput: {
        provided: true,
        source: 'env',
        pairCount: 2,
        persisted: false,
        redacted: true,
      },
      cookieMaterialPersisted: false,
    },
    sourceDiagnostics: [
      {
        label: 'homepage',
        requestHeaders: {
          accept: 'text/html',
          'user-agent': 'SiteForge',
        },
      },
    ],
  }));

  assert.throws(
    () => assertBuildProfileSafe({
      artifactFamily: 'siteforge-build-profile',
      source: { type: 'live_website' },
      authRuntime: {
        method: 'cookie',
        cookieHeader: 'sid=SECRET_SESSION_VALUE; uid=123',
      },
    }),
    (error) => {
      const thrown = /** @type {Error} */ (error);
      assert.match(thrown.message, /build_profile\.json contains sensitive fields/u);
      assert.match(thrown.message, /authRuntime/u);
      assert.doesNotMatch(thrown.message, /SECRET_SESSION_VALUE|sid=|uid=123/u);
      return true;
    },
  );

  assert.throws(
    () => assertBuildProfileSafe({
      artifactFamily: 'siteforge-build-profile',
      source: { type: 'live_website' },
      authStateReport: {
        blockingSignals: ['cookie sid=SECRET_SESSION_VALUE'],
      },
    }),
    (error) => {
      const thrown = /** @type {Error} */ (error);
      assert.match(thrown.message, /build_profile\.json contains sensitive values at/u);
      assert.match(thrown.message, /authStateReport\.blockingSignals\.0/u);
      assert.doesNotMatch(thrown.message, /SECRET_SESSION_VALUE|sid=/u);
      return true;
    },
  );
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

test('public SiteForge CLI rejects stale saved profile containing runtime cookie material', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-cli-stale-sensitive-profile-'));
  try {
    await withTestSite(simpleShopRoutes, async (rootUrl) => {
      await prepareSiteForgeBuildSetup(rootUrl, {
        cwd: workspace,
        buildId: 'setup-profile',
        now: new Date('2026-05-16T04:30:00.000Z'),
        setupInteractive: true,
        setupOutput: { write() {} },
        setupPrompt: async () => 'focus search',
        fetchDelayMs: 0,
      });
      const setupPaths = buildSetupAssistantPaths(rootUrl, {
        cwd: workspace,
        buildId: 'setup-profile',
        now: new Date('2026-05-16T04:30:00.000Z'),
      });
      const staleProfile = await readJson(setupPaths.savedBuildProfilePath);
      staleProfile.authRuntime = {
        method: 'cookie',
        cookieHeader: 'sid=SECRET_SESSION_VALUE; uid=123',
      };
      await writeFile(setupPaths.savedBuildProfilePath, JSON.stringify(staleProfile, null, 2), 'utf8');

      const result = await spawnNode([CLI_PATH, 'build', rootUrl], {
        cwd: workspace,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /SECRET_SESSION_VALUE|sid=|uid=123/u);

      const buildDirs = await listBuildDirs(siteBuildsDir(workspace, rootUrl));
      const artifactDirs = buildDirs.filter((candidate) => path.basename(candidate) !== 'setup-profile');
      assert.equal(artifactDirs.length, 1);
      const artifactDir = artifactDirs[0];
      const finalSetupProfileText = await readFile(setupPaths.savedBuildProfilePath, 'utf8');
      const inputProfileText = await readFile(path.join(artifactDir, 'inputs', 'build_profile.json'), 'utf8');
      assert.doesNotMatch(finalSetupProfileText, /authRuntime|cookieHeader|SECRET_SESSION_VALUE|sid=|uid=123/iu);
      assert.doesNotMatch(inputProfileText, /authRuntime|cookieHeader|SECRET_SESSION_VALUE|sid=|uid=123/iu);
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
