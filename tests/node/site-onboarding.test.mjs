import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { pathExists, readJsonFile } from '../../src/infra/io.mjs';
import { scaffoldSite } from '../../src/entrypoints/sites/site-scaffold.mjs';
import { siteDoctor } from '../../src/entrypoints/sites/site-doctor.mjs';
import { REDACTION_PLACEHOLDER } from '../../src/domain/sessions/security-guard.mjs';

function createNavigationProfile(host = 'example.com') {
  return {
    host,
    archetype: 'navigation-catalog',
    schemaVersion: 1,
    primaryArchetype: 'catalog-detail',
    version: 1,
    pageTypes: {
      homeExact: ['/'],
      homePrefixes: [],
      searchResultsPrefixes: ['/search'],
      contentDetailPrefixes: ['/works/detail/'],
      authorPrefixes: ['/actress/detail/'],
      authorListExact: [],
      authorListPrefixes: ['/actress'],
      authorDetailPrefixes: ['/actress/detail/'],
      chapterPrefixes: [],
      historyPrefixes: [],
      authPrefixes: ['/login'],
      categoryPrefixes: ['/works/date'],
    },
    search: {
      formSelectors: ['form[action*="/search"]'],
      inputSelectors: ['input[name="q"]'],
      submitSelectors: ['button[type="submit"]'],
      queryParamNames: ['q'],
      resultTitleSelectors: ['title'],
      resultBookSelectors: ['a[href*="/works/detail/"]'],
      knownQueries: [
        {
          query: 'Aoi',
          title: 'Aoi Title',
          url: 'https://example.com/works/detail/aoi-001',
          authorName: 'Aoi',
        },
      ],
    },
    sampling: {
      searchResultContentLimit: 4,
      authorContentLimit: 10,
      categoryContentLimit: 10,
      fallbackContentLimitWithSearch: 8,
    },
    navigation: {
      allowedHosts: [host],
      contentPathPrefixes: ['/works/detail/'],
      authorPathPrefixes: ['/actress/detail/'],
      authorListPathPrefixes: ['/actress'],
      authorDetailPathPrefixes: ['/actress/detail/'],
      categoryPathPrefixes: ['/works/date'],
      utilityPathPrefixes: ['/help'],
      authPathPrefixes: ['/login'],
      categoryLabelKeywords: ['WORKS'],
    },
    contentDetail: {
      titleSelectors: ['h2'],
      authorNameSelectors: ['a[href*="/actress/detail/"]'],
      authorLinkSelectors: ['a[href*="/actress/detail/"]'],
    },
    author: {
      titleSelectors: ['h2'],
      workLinkSelectors: ['a[href*="/works/detail/"]'],
    },
  };
}

function createChapterProfile(host = 'books.example.com') {
  return {
    host,
    archetype: 'chapter-content',
    schemaVersion: 1,
    primaryArchetype: 'chapter-content',
    version: 1,
    search: {
      formSelectors: ['form[action*="/search"]'],
      inputSelectors: ['input[name="searchkey"]'],
      submitSelectors: ['button[type="submit"]'],
      resultTitleSelectors: ['title'],
      resultBookSelectors: ['a[href*="/book/"]'],
      knownQueries: [
        {
          query: 'Immortal',
          title: 'Immortal Book',
          url: 'https://books.example.com/book/immortal',
          authorName: 'Author X',
        },
      ],
    },
    bookDetail: {
      authorMetaNames: ['og:novel:author'],
      authorLinkMetaNames: ['og:novel:author_link'],
      latestChapterNameMetaNames: ['og:novel:latest_chapter_name'],
      latestChapterMetaNames: ['og:novel:latest_chapter_url'],
      updateTimeMetaNames: ['og:novel:update_time'],
      chapterLinkSelectors: ['#list a[href]'],
      directoryLinkSelectors: ['.page-list a[href]'],
      directoryPageUrlTemplate: '{detail_url}{page}/',
      directoryPageStart: 1,
      directoryPageMax: 8,
      directoryMinimumExpected: 50,
    },
    chapter: {
      contentSelectors: ['#content'],
      titleSelectors: ['h1'],
      prevSelector: '#prev_url',
      nextSelector: '#next_url',
      cleanupPatterns: ['previous', 'next'],
    },
  };
}

function createFetchResponse(url, html) {
  return {
    ok: true,
    status: 200,
    url,
    async text() {
      return html;
    },
  };
}

test('site-scaffold writes a navigation profile from built-in templates and inferred fields', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-site-scaffold-'));

  try {
    const profilePath = path.join(workspace, 'profiles', 'example.com.json');
    const result = await scaffoldSite('https://example.com/', {
      archetype: 'navigation-catalog',
      profilePath,
      outDir: path.join(workspace, 'reports'),
    }, {
      fetchImpl: async () => createFetchResponse('https://example.com/', `
        <html>
          <body>
            <form action="/search" role="search">
              <input type="search" name="q" id="query" />
              <button type="submit" id="go">Search</button>
            </form>
            <a href="/works/detail/abc-001">detail</a>
            <a href="/actress/detail/aoi">author</a>
            <a href="/actress">author-list</a>
            <a href="/works/date">category</a>
            <a href="/help">help</a>
            <a href="/login">login</a>
          </body>
        </html>
      `),
    });

    assert.equal(result.profile.valid, true);
    assert.equal(await pathExists(profilePath), true);
    assert.equal(await pathExists(result.reports.json), true);
    assert.equal(await pathExists(result.reports.markdown), true);

    const profile = await readJsonFile(profilePath);
    assert.equal(profile.host, 'example.com');
    assert.equal(profile.archetype, 'navigation-catalog');
    assert.deepEqual(profile.navigation.allowedHosts, ['example.com', 'www.example.com']);
    assert.deepEqual(profile.pageTypes.contentDetailPrefixes, ['/works/detail/']);
    assert.deepEqual(profile.pageTypes.searchResultsPrefixes, ['/search']);

    const persistedReport = await readJsonFile(result.reports.json);
    const persistedMarkdown = await readFile(result.reports.markdown, 'utf8');
    const persistedAudit = await readJsonFile(result.reports.jsonRedactionAudit);
    assert.equal(result.profilePath, profilePath);
    assert.equal(persistedReport.profilePath, REDACTION_PLACEHOLDER);
    assert.match(persistedMarkdown, /Profile valid: yes/u);
    assert.equal(persistedMarkdown.includes(profilePath), false);
    assert.equal(persistedAudit.redactedPaths.includes('profilePath'), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-scaffold writes a valid chapter profile when no search form is inferred', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-site-scaffold-chapter-'));

  try {
    const profilePath = path.join(workspace, 'profiles', 'books.example.com.json');
    const result = await scaffoldSite('https://books.example.com/', {
      archetype: 'chapter-content',
      profilePath,
      outDir: path.join(workspace, 'reports'),
    }, {
      fetchImpl: async () => createFetchResponse('https://books.example.com/', `
        <html>
          <body>
            <a href="/book/immortal">book</a>
            <a href="/chapter/1">chapter</a>
          </body>
        </html>
      `),
    });

    assert.equal(result.profile.valid, true);
    assert.equal(await pathExists(profilePath), true);
    assert.match(result.warnings.join('\n'), /No search form was inferred/u);
    assert.match(result.nextActions.join('\n'), /Confirm the search form selectors/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor validates a generic navigation host with stubbed runtime steps', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-site-doctor-navigation-'));

  try {
    const profilePath = path.join(workspace, 'example.com.json');
    await writeFile(profilePath, `${JSON.stringify(createNavigationProfile(), null, 2)}\n`, 'utf8');
    const compileCalls = /** @type {any[]} */ ([]);

    const report = await siteDoctor('https://example.com/', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
      capabilityDryRun: true,
    }, {
      resolveSite: async () => ({ adapter: { id: 'generic-navigation' } }),
      runSiteCapabilityCompile: async (options) => {
        compileCalls.push(options);
        return {
          command: 'site-capability-compile',
          descriptorOnly: true,
          siteId: 'site:example.com',
          siteKey: 'example',
          compileId: 'compile:example.com',
          graphValidationResult: 'passed',
          planStatus: 'ready',
          plannerHandoffReady: true,
          executionPolicyStatus: 'ready',
          coverageCompleteness: 'partial',
          unknownNodeCount: 0,
          capabilityCount: 2,
          routeCount: 2,
          executionPathCount: 2,
          executionAttempted: false,
          liveCaptureAttempted: false,
          downloaderInvocationAllowed: false,
          siteAdapterInvocationAllowed: false,
          sessionMaterializationAllowed: false,
          redactionRequired: true,
        };
      },
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async () => ({
        status: 'success',
        finalUrl: 'https://example.com/',
        networkRequests: [
          {
            method: 'GET',
            url: 'https://example.com/api/search?q=Aoi&csrf_token=synthetic-csrf',
            resourceType: 'xhr',
          },
        ],
        files: {
          manifest: path.join(workspace, 'capture', 'manifest.json'),
        },
        pageFacts: {
          loginStateDetected: true,
        },
        error: null,
      }),
      expandStates: async () => ({
        outDir: path.join(workspace, 'expand'),
        summary: {
          capturedStates: 3,
        },
        budgetSkippedTriggers: [
          {
            kind: 'pagination-link',
            label: 'Next page',
            href: 'https://example.com/search?page=2&token=synthetic-doctor-trigger-token',
            locator: {
              role: 'link',
              href: 'https://example.com/search?page=2&token=synthetic-doctor-trigger-token',
              textSnippet: 'Next page',
            },
          },
        ],
        unattemptedTriggers: [
          {
            kind: 'menu-button',
            label: 'Filters',
            locator: {
              primary: 'a11y',
              role: 'button',
              ariaControls: 'filters-panel',
              textSnippet: 'Filters',
            },
          },
        ],
        warnings: [],
        states: [
          {
            state_id: 's0001',
            status: 'captured',
            finalUrl: 'https://example.com/search?q=Aoi',
            pageType: 'search-results-page',
            trigger: { kind: 'search-form' },
            files: {},
          },
          {
            state_id: 's0002',
            status: 'captured',
            finalUrl: 'https://example.com/works/detail/aoi-001',
            pageType: 'book-detail-page',
            trigger: { kind: 'content-link' },
            files: {},
          },
          {
            state_id: 's0003',
            status: 'captured',
            finalUrl: 'https://example.com/actress/detail/aoi',
            pageType: 'author-page',
            trigger: { kind: 'safe-nav-link' },
            files: {},
          },
        ],
      }),
    });

    assert.equal(report.profile.valid, true);
    assert.equal(report.capture.valid, true);
    assert.equal(report.expand.valid, true);
    assert.equal(report.search.valid, true);
    assert.equal(report.detail.valid, true);
    assert.equal(report.author?.valid, true);
    assert.equal(compileCalls.length, 1);
    assert.equal(compileCalls[0].site, 'generic-navigation');
    assert.equal(compileCalls[0].writeArtifacts, false);
    assert.equal(report.capabilityDryRun?.valid, true);
    assert.equal(report.capabilityDryRun?.details?.descriptorOnly, true);
    assert.equal(report.capabilityDryRun?.details?.downloaderInvocationAllowed, false);
    assert.equal(report.adapterRecommendation, 'reuse-generic');
    assert.equal(await pathExists(report.reports.siteOnboardingDiscovery.NODE_INVENTORY_JSON), true);
    assert.equal(await pathExists(report.reports.siteOnboardingDiscovery.SITE_CAPABILITY_REPORT_JSON), true);
    const nodeInventory = await readJsonFile(report.reports.siteOnboardingDiscovery.NODE_INVENTORY_JSON);
    assert.equal(JSON.stringify(nodeInventory).includes('synthetic-doctor-trigger-token'), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor reports chapter validation failures at the doctor boundary', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-site-doctor-chapter-'));

  try {
    const profilePath = path.join(workspace, 'books.example.com.json');
    await writeFile(profilePath, `${JSON.stringify(createChapterProfile(), null, 2)}\n`, 'utf8');

    const report = await siteDoctor('https://books.example.com/', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
    }, {
      resolveSite: async () => ({ adapter: { id: 'chapter-content' } }),
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async () => ({
        status: 'success',
        finalUrl: 'https://books.example.com/',
        files: {
          manifest: path.join(workspace, 'capture', 'manifest.json'),
        },
        error: null,
      }),
      expandStates: async () => ({
        outDir: path.join(workspace, 'expand'),
        summary: {
          capturedStates: 2,
        },
        warnings: [],
        states: [
          {
            state_id: 's0001',
            status: 'captured',
            finalUrl: 'https://books.example.com/search?q=Immortal',
            pageType: 'search-results-page',
            trigger: { kind: 'search-form' },
            files: {},
          },
          {
            state_id: 's0002',
            status: 'captured',
            finalUrl: 'https://books.example.com/book/immortal',
            pageType: 'book-detail-page',
            trigger: { kind: 'content-link' },
            files: {},
          },
        ],
      }),
    });

    assert.equal(report.profile.valid, true);
    assert.equal(report.detail.valid, true);
    assert.equal(report.chapter?.valid, false);
    assert.equal(report.chapter?.status, 'fail');
    assert.match(report.chapter?.error?.message ?? '', /No chapter page was captured/u);
    assert.equal(report.sample?.source, 'profile.search.knownQueries[0]');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
