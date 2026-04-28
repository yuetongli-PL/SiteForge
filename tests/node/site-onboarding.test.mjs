import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { pathExists, readJsonFile } from '../../src/infra/io.mjs';
import { scaffoldSite } from '../../scripts/site-scaffold.mjs';
import { siteDoctor } from '../../scripts/site-doctor.mjs';

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

test('site-scaffold writes a navigation profile and inferred report fields', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-scaffold-'));

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
    assert.equal(profile.schemaVersion, 1);
    assert.deepEqual(profile.navigation.allowedHosts, ['example.com', 'www.example.com']);
    assert.deepEqual(profile.pageTypes.contentDetailPrefixes, ['/works/detail/']);
    assert.deepEqual(profile.pageTypes.searchResultsPrefixes, ['/search']);
    assert.match((await readFile(result.reports.markdown, 'utf8')), /Profile valid: yes/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-scaffold still writes a valid chapter profile when no search form is inferred', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-scaffold-missing-search-'));

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
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-navigation-'));

  try {
    const profilePath = path.join(workspace, 'example.com.json');
    await writeFile(profilePath, `${JSON.stringify(createNavigationProfile(), null, 2)}\n`, 'utf8');

    const report = await siteDoctor('https://example.com/', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
    }, {
      resolveSite: async () => ({ adapter: { id: 'generic-navigation' } }),
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async () => ({
        status: 'success',
        finalUrl: 'https://example.com/',
        files: {
          manifest: path.join(workspace, 'capture', 'manifest.json'),
        },
        error: null,
      }),
      expandStates: async () => ({
        outDir: path.join(workspace, 'expand'),
        summary: {
          capturedStates: 3,
        },
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
    assert.equal(report.crawler.valid, true);
    assert.equal(report.capture.valid, true);
    assert.equal(report.expand.valid, true);
    assert.deepEqual(report.expand.details.budget, {
      maxTriggers: 6,
      maxCapturedStates: 3,
      hit: false,
      stopReason: null,
    });
    assert.equal(report.search.valid, true);
    assert.equal(report.detail.valid, true);
    assert.equal(report.author?.valid, true);
    assert.equal(report.adapterRecommendation, 'reuse-generic');
    assert.equal(await pathExists(report.reports.json), true);
    assert.equal(await pathExists(report.reports.markdown), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor reports chapter validation failures at the doctor boundary', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-chapter-'));

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

test('site-doctor uses bilibili validationSamples and reports scenario matrix', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-bilibili-'));
  const profilePath = path.resolve('profiles/www.bilibili.com.json');
  const observedRuns = [];

  try {
    const report = await siteDoctor('https://www.bilibili.com/', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
    }, {
      resolveSite: async () => ({ adapter: { id: 'bilibili' } }),
      resolveSiteAuthProfile: async () => ({
        profile: await readJsonFile(profilePath),
        warnings: [],
        filePath: profilePath,
      }),
      resolveSiteBrowserSessionOptions: async () => ({
        reuseLoginState: true,
        userDataDir: path.join(workspace, 'profiles', 'bilibili.com'),
        cleanupUserDataDirOnShutdown: false,
        authConfig: {
          loginUrl: 'https://passport.bilibili.com/login',
          postLoginUrl: 'https://www.bilibili.com/',
        },
      }),
      openBrowserSession: async () => ({
        async navigateAndWait() {},
        async close() {},
      }),
      inspectLoginState: async () => ({
        loggedIn: true,
        loginStateDetected: true,
        identityConfirmed: true,
        identitySource: 'selector:.bili-avatar img',
      }),
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async () => ({
        status: 'success',
        finalUrl: 'https://www.bilibili.com/',
        files: {
          manifest: path.join(workspace, 'capture', 'manifest.json'),
        },
        error: null,
      }),
      expandStates: async (inputUrl, options) => {
        observedRuns.push({
          inputUrl,
          searchQueries: options.searchQueries,
        });
        let states;
        if (inputUrl === 'https://www.bilibili.com/') {
          states = [
            {
              state_id: 's0001',
              status: 'captured',
              finalUrl: 'https://search.bilibili.com/video?keyword=BV1WjDDBGE3p',
              pageType: 'search-results-page',
              trigger: { kind: 'search-form' },
              files: {},
            },
            {
              state_id: 's0002',
              status: 'captured',
              finalUrl: 'https://www.bilibili.com/video/BV1WjDDBGE3p',
              pageType: 'book-detail-page',
              trigger: { kind: 'content-link' },
              files: {},
            },
            {
              state_id: 's0003',
              status: 'captured',
              finalUrl: 'https://space.bilibili.com/1202350411',
              pageType: 'author-page',
              trigger: { kind: 'safe-nav-link' },
              files: {},
            },
          ];
        } else if (inputUrl === 'https://www.bilibili.com/v/popular/all/') {
          states = [
            {
              state_id: 'c0001',
              status: 'initial',
              finalUrl: 'https://www.bilibili.com/v/popular/all/',
              pageType: 'category-page',
              trigger: null,
              files: {},
            },
            {
              state_id: 'c0002',
              status: 'captured',
              finalUrl: 'https://www.bilibili.com/video/BV1WjDDBGE3p',
              pageType: 'book-detail-page',
              trigger: { kind: 'content-link' },
              files: {},
            },
          ];
        } else if (inputUrl === 'https://www.bilibili.com/bangumi/play/ep508404') {
          states = [
            {
              state_id: 'b0001',
              status: 'initial',
              finalUrl: 'https://www.bilibili.com/bangumi/play/ep508404',
              pageType: 'book-detail-page',
              pageFacts: { contentType: 'bangumi' },
              trigger: null,
              files: {},
            },
          ];
        } else if (inputUrl === 'https://space.bilibili.com/1202350411/video') {
          states = [
            {
              state_id: 'a0001',
              status: 'initial',
              finalUrl: 'https://space.bilibili.com/1202350411/video',
              pageType: 'author-list-page',
              trigger: null,
              files: {},
            },
            {
              state_id: 'a0002',
              status: 'captured',
              finalUrl: 'https://www.bilibili.com/video/BV1uT41147VW',
              pageType: 'book-detail-page',
              trigger: { kind: 'content-link' },
              files: {},
            },
          ];
        } else if (inputUrl === 'https://space.bilibili.com/1202350411/dynamic') {
          states = [
            {
              state_id: 'd0001',
              status: 'initial',
              finalUrl: 'https://space.bilibili.com/1202350411/dynamic',
              pageType: 'author-list-page',
              pageFacts: {
                authorSubpage: 'dynamic',
                loginStateDetected: true,
                identityConfirmed: true,
                featuredContentUrls: ['https://www.bilibili.com/video/BV1WjDDBGE3p'],
                featuredContentTitles: ['Dynamic Video One'],
              },
              trigger: null,
              files: {},
            },
          ];
        } else if (inputUrl === 'https://space.bilibili.com/1202350411/fans/follow') {
          states = [
            {
              state_id: 'f0001',
              status: 'initial',
              finalUrl: 'https://space.bilibili.com/1202350411/fans/follow',
              pageType: 'author-list-page',
              pageFacts: {
                authorSubpage: 'follow',
                loginStateDetected: true,
                identityConfirmed: true,
                featuredAuthorUrls: ['https://space.bilibili.com/2'],
                featuredAuthorNames: ['UP 2'],
                featuredAuthorMids: ['2'],
              },
              trigger: null,
              files: {},
            },
          ];
        } else if (inputUrl === 'https://space.bilibili.com/1202350411/fans/fans') {
          states = [
            {
              state_id: 'f1001',
              status: 'initial',
              finalUrl: 'https://space.bilibili.com/1202350411/fans/fans',
              pageType: 'author-list-page',
              pageFacts: {
                authorSubpage: 'fans',
                loginStateDetected: true,
                identityConfirmed: true,
                featuredAuthorUrls: ['https://space.bilibili.com/364185321'],
                featuredAuthorNames: ['UP 364185321'],
                featuredAuthorMids: ['364185321'],
                antiCrawlDetected: true,
                antiCrawlSignals: ['rate-limit'],
              },
              trigger: null,
              files: {},
            },
          ];
        } else {
          throw new Error(`Unexpected scenario input: ${inputUrl}`);
        }
        return {
          outDir: path.join(workspace, 'expand'),
          summary: {
            capturedStates: states.length,
          },
          warnings: [],
          states,
        };
      },
    });

    assert.deepEqual(observedRuns[0].searchQueries, ['BV1WjDDBGE3p']);
    assert.deepEqual(observedRuns.map((entry) => entry.inputUrl), [
      'https://www.bilibili.com/',
      'https://www.bilibili.com/v/popular/all/',
      'https://www.bilibili.com/bangumi/play/ep508404',
      'https://space.bilibili.com/1202350411/video',
      'https://space.bilibili.com/1202350411/dynamic',
      'https://space.bilibili.com/1202350411/fans/follow',
      'https://space.bilibili.com/1202350411/fans/fans',
    ]);
    assert.equal(report.search.valid, true);
    assert.equal(report.detail.valid, true);
    assert.equal(report.author?.valid, true);
    assert.equal(report.scenarios.length, 7);
    assert.equal(report.sessionReuseWorked, true);
    assert.equal(report.authSession?.loginStateDetected, true);
    assert.equal(report.authSession?.identityConfirmed, true);
    assert.equal(report.authSession?.identitySource, 'selector:.bili-avatar img');
    assert.equal(report.authSession?.currentUrl, null);
    assert.equal(report.authSession?.title, null);
    assert.equal(report.authSession?.riskCauseCode, null);
    assert.equal(report.authSession?.riskAction, null);
    assert.equal(report.authSession?.profileQuarantined, false);
    assert.match(String(report.authSession?.networkIdentityFingerprint ?? ''), /^[0-9a-f]{16}$/u);
    assert.equal(report.sample?.source, 'profile.validationSamples.videoSearchQuery');
    assert.deepEqual(report.scenarios.map((entry) => entry.id), [
      'home-search-video-detail-author',
      'category-popular-to-detail',
      'bangumi-detail',
      'author-videos-to-detail',
      'author-dynamic-feed',
      'author-follow-list',
      'author-fans-list',
    ]);
    const dynamicScenario = report.scenarios.find((entry) => entry.id === 'author-dynamic-feed');
    const followScenario = report.scenarios.find((entry) => entry.id === 'author-follow-list');
    const fansScenario = report.scenarios.find((entry) => entry.id === 'author-fans-list');
    assert.ok(report.scenarios.filter((entry) => entry.id !== 'author-fans-list').every((entry) => entry.status === 'pass'));
    assert.equal(fansScenario?.status, 'fail');
    assert.equal(fansScenario?.reasonCode, 'anti-crawl-rate-limit');
    assert.equal(report.scenarios[0].semanticPageType, 'author-page');
    assert.equal(report.scenarios[0].expectedSemanticPageType, 'author-page');
    assert.match(report.scenarios[0].note ?? '', /home -> search-results -> content-detail -> author-page/u);
    assert.equal(report.scenarios[1].semanticPageType, 'content-detail-page');
    assert.equal(report.scenarios[1].expectedSemanticPageType, 'content-detail-page');
    assert.equal(report.scenarios[2].semanticPageType, 'content-detail-page');
    assert.equal(report.scenarios[3].semanticPageType, 'content-detail-page');
    assert.equal(report.scenarios[4].semanticPageType, 'author-list-page');
    assert.equal(dynamicScenario?.reasonCode, 'ok');
    assert.equal(followScenario?.authRequired, true);
    assert.equal(followScenario?.reasonCode, 'ok');
    assert.equal(fansScenario?.authRequired, true);
    assert.deepEqual(report.scenarios[6].antiCrawlSignals, ['rate-limit']);
    assert.equal(fansScenario?.riskCauseCode, 'request-burst');
    assert.equal(fansScenario?.riskAction, 'cooldown-and-retry-later');
    assert.equal(fansScenario?.profileQuarantined, false);
    assert.match(String(fansScenario?.networkIdentityFingerprint ?? ''), /^[0-9a-f]{16}$/u);
    assert.equal(report.riskCauseCode, 'request-burst');
    assert.equal(report.riskAction, 'cooldown-and-retry-later');
    assert.equal(report.profileQuarantined, false);
    assert.match(String(report.networkIdentityFingerprint ?? ''), /^[0-9a-f]{16}$/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor uses douyin auth verification samples and reports the douyin scenario matrix', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-douyin-'));
  const profilePath = path.resolve('profiles/www.douyin.com.json');
  const profile = await readJsonFile(profilePath);
  const observedRuns = [];
  const observedProbeUrls = [];

  try {
    const report = await siteDoctor('https://www.douyin.com/?recommend=1', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
    }, {
      resolveSite: async () => ({ adapter: { id: 'douyin' } }),
      resolveSiteAuthProfile: async () => ({
        profile,
        warnings: [],
        filePath: profilePath,
      }),
      resolveSiteBrowserSessionOptions: async () => ({
        reuseLoginState: true,
        userDataDir: path.join(workspace, 'profiles', 'douyin.com'),
        cleanupUserDataDirOnShutdown: false,
        authConfig: {
          loginUrl: 'https://www.douyin.com/',
          postLoginUrl: 'https://www.douyin.com/',
        },
      }),
      openBrowserSession: async (options) => {
        observedProbeUrls.push({ startupUrl: options.startupUrl });
        return {
          async navigateAndWait(url) {
            observedProbeUrls[observedProbeUrls.length - 1].navigateUrl = url;
          },
          async close() {},
        };
      },
      inspectLoginState: async () => ({
        loggedIn: true,
        loginStateDetected: true,
        identityConfirmed: true,
        identitySource: 'selector:[data-e2e="nav-user-avatar"]',
        currentUrl: profile.authValidationSamples.likesUrl,
        title: '喜欢',
      }),
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async () => ({
        status: 'success',
        finalUrl: 'https://www.douyin.com/?recommend=1',
        files: {
          manifest: path.join(workspace, 'capture', 'manifest.json'),
        },
        error: null,
      }),
      expandStates: async (inputUrl, options) => {
        observedRuns.push({
          inputUrl,
          searchQueries: options.searchQueries,
          maxTriggers: options.maxTriggers,
          maxCapturedStates: options.maxCapturedStates,
        });
        let states;
        if (inputUrl === 'https://www.douyin.com/?recommend=1') {
          states = [
            {
              state_id: 's0001',
              status: 'captured',
              finalUrl: 'https://www.douyin.com/search/%E6%B5%8B%E8%AF%95?type=video',
              pageType: 'search-results-page',
              trigger: { kind: 'search-form' },
              files: {},
            },
            {
              state_id: 's0002',
              status: 'captured',
              finalUrl: profile.validationSamples.videoDetailUrl,
              pageType: 'book-detail-page',
              trigger: { kind: 'content-link' },
              files: {},
            },
            {
              state_id: 's0003',
              status: 'captured',
              finalUrl: profile.validationSamples.authorUrl,
              pageType: 'author-page',
              trigger: { kind: 'safe-nav-link' },
              files: {},
            },
          ];
        } else if (inputUrl === profile.validationSamples.authorVideosUrl) {
          states = [
            {
              state_id: 'p0001',
              status: 'initial',
              finalUrl: profile.validationSamples.authorVideosUrl,
              pageType: 'author-page',
              pageFacts: { authorSubpage: 'post' },
              trigger: null,
              files: {},
            },
          ];
        } else if (inputUrl === profile.authValidationSamples.selfPostsUrl) {
          states = [
            {
              state_id: 'a0001',
              status: 'initial',
              finalUrl: inputUrl,
              pageType: 'author-list-page',
              trigger: null,
              files: {},
            },
            {
              state_id: 'a0001b',
              status: 'captured',
              finalUrl: inputUrl,
              pageType: 'author-list-page',
              pageFacts: {
                authorSubpage: 'post',
                loginStateDetected: true,
                identityConfirmed: true,
                featuredContentUrls: [profile.validationSamples.videoDetailUrl],
              },
              trigger: { kind: 'tab', label: '作品' },
              files: {},
            },
          ];
        } else if (inputUrl === profile.authValidationSamples.likesUrl) {
          states = [
            {
              state_id: 'a0002',
              status: 'initial',
              finalUrl: inputUrl,
              pageType: 'author-list-page',
              pageFacts: {
                authorSubpage: 'like',
                loginStateDetected: true,
                identityConfirmed: true,
                antiCrawlSignals: ['verify', 'rate-limit'],
              },
              trigger: null,
              files: {},
            },
          ];
        } else if (inputUrl === profile.authValidationSamples.collectionsUrl) {
          states = [
            {
              state_id: 'a0003',
              status: 'initial',
              finalUrl: inputUrl,
              pageType: 'author-list-page',
              pageFacts: {
                authorSubpage: 'collect',
                loginStateDetected: true,
                identityConfirmed: true,
                antiCrawlSignals: ['rate-limit'],
              },
              trigger: null,
              files: {},
            },
          ];
        } else if (inputUrl === profile.authValidationSamples.historyUrl) {
          states = [
            {
              state_id: 'a0004',
              status: 'initial',
              finalUrl: inputUrl,
              pageType: 'author-list-page',
              pageFacts: {
                authorSubpage: 'history',
                loginStateDetected: true,
                identityConfirmed: true,
                antiCrawlSignals: ['challenge'],
              },
              trigger: null,
              files: {},
            },
          ];
        } else if (inputUrl === profile.authValidationSamples.followFeedUrl) {
          states = [
            {
              state_id: 'a0005',
              status: 'initial',
              finalUrl: inputUrl,
              pageType: 'author-list-page',
              pageFacts: {
                authorSubpage: 'follow-feed',
                loginStateDetected: true,
                identityConfirmed: true,
                featuredContentUrls: [profile.validationSamples.videoDetailUrl],
              },
              trigger: null,
              files: {},
            },
          ];
        } else if (inputUrl === profile.authValidationSamples.followUsersUrl) {
          states = [
            {
              state_id: 'a0006',
              status: 'initial',
              finalUrl: inputUrl,
              pageType: 'author-list-page',
              pageFacts: {
                authorSubpage: 'follow-users',
                loginStateDetected: true,
                identityConfirmed: true,
                featuredAuthorCount: 0,
                featuredContentCount: 0,
              },
              trigger: null,
              files: {},
            },
          ];
        } else {
          throw new Error(`Unexpected scenario input: ${inputUrl}`);
        }

        return {
          outDir: path.join(workspace, 'expand'),
          summary: {
            capturedStates: states.length,
          },
          warnings: [],
          states,
        };
      },
    });

    assert.equal(observedProbeUrls[0]?.startupUrl, profile.authValidationSamples.likesUrl);
    assert.equal(observedProbeUrls[0]?.navigateUrl, profile.authValidationSamples.likesUrl);
    assert.deepEqual(observedRuns.map((entry) => entry.inputUrl), [
      'https://www.douyin.com/?recommend=1',
      profile.validationSamples.authorVideosUrl,
      profile.authValidationSamples.selfPostsUrl,
      profile.authValidationSamples.likesUrl,
      profile.authValidationSamples.collectionsUrl,
      profile.authValidationSamples.historyUrl,
      profile.authValidationSamples.followFeedUrl,
      profile.authValidationSamples.followUsersUrl,
    ]);
    assert.deepEqual(observedRuns[0].searchQueries, [profile.validationSamples.videoSearchQuery]);
    assert.deepEqual(
      observedRuns.map((entry) => ({ inputUrl: entry.inputUrl, maxTriggers: entry.maxTriggers, maxCapturedStates: entry.maxCapturedStates })),
      [
        { inputUrl: 'https://www.douyin.com/?recommend=1', maxTriggers: 6, maxCapturedStates: 3 },
        { inputUrl: profile.validationSamples.authorVideosUrl, maxTriggers: 1, maxCapturedStates: 1 },
        { inputUrl: profile.authValidationSamples.selfPostsUrl, maxTriggers: 1, maxCapturedStates: 1 },
        { inputUrl: profile.authValidationSamples.likesUrl, maxTriggers: 1, maxCapturedStates: 1 },
        { inputUrl: profile.authValidationSamples.collectionsUrl, maxTriggers: 1, maxCapturedStates: 1 },
        { inputUrl: profile.authValidationSamples.historyUrl, maxTriggers: 1, maxCapturedStates: 1 },
        { inputUrl: profile.authValidationSamples.followFeedUrl, maxTriggers: 1, maxCapturedStates: 1 },
        { inputUrl: profile.authValidationSamples.followUsersUrl, maxTriggers: 1, maxCapturedStates: 1 },
      ],
    );
    assert.equal(report.sessionReuseWorked, true);
    assert.equal(report.authSession?.loginStateDetected, true);
    assert.equal(report.authSession?.identityConfirmed, true);
    assert.equal(report.authSession?.identitySource, 'selector:[data-e2e="nav-user-avatar"]');
    assert.equal(report.authSession?.currentUrl, profile.authValidationSamples.likesUrl);
    assert.equal(report.authSession?.title, '喜欢');
    assert.equal(report.authSession?.riskCauseCode, null);
    assert.equal(report.authSession?.riskAction, null);
    assert.equal(report.authSession?.profileQuarantined, false);
    assert.match(String(report.authSession?.networkIdentityFingerprint ?? ''), /^[0-9a-f]{16}$/u);
    assert.equal(report.scenarios.length, 8);
    assert.deepEqual(report.scenarios.map((entry) => entry.id), [
      'home-search-video-detail-author',
      'public-author-posts',
      'self-posts',
      'self-likes',
      'self-collections',
      'self-history',
      'follow-feed',
      'follow-users',
    ]);
    assert.equal(report.scenarios[0].status, 'pass');
    assert.equal(report.scenarios[1].status, 'pass');
    assert.equal(report.scenarios[2].status, 'pass');
    assert.equal(report.scenarios[2].stateId, 'a0001b');
    assert.equal(report.scenarios[2].featuredContentCount, 1);
    assert.equal(report.scenarios[3].reasonCode, 'anti-crawl-verify');
    assert.equal(report.scenarios[4].reasonCode, 'anti-crawl-rate-limit');
    assert.equal(report.scenarios[5].reasonCode, 'anti-crawl-challenge');
    assert.equal(report.scenarios[6].status, 'pass');
    assert.equal(report.scenarios[7].reasonCode, 'empty-shell');
    assert.equal(report.scenarios[7].emptyShell, true);
    assert.equal(report.scenarios[7].authRequired, true);
    assert.equal(report.scenarios[3].riskCauseCode, 'browser-fingerprint-risk');
    assert.equal(report.scenarios[3].riskAction, 'use-visible-browser-warmup');
    assert.equal(report.scenarios[4].riskCauseCode, 'request-burst');
    assert.equal(report.scenarios[5].riskCauseCode, 'unknown-risk');
    assert.equal(report.scenarios[7].riskCauseCode, null);
    assert.equal(report.riskCauseCode, 'request-burst');
    assert.equal(report.riskAction, 'cooldown-and-retry-later');
    assert.equal(report.profileQuarantined, true);
    assert.match(String(report.networkIdentityFingerprint ?? ''), /^[0-9a-f]{16}$/u);
    assert.match(report.warnings.join('\n'), /douyin scenario self-likes diagnosed as anti-crawl-verify/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor retries recoverable douyin scenario capture failures before reporting upstream errors', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-douyin-retry-'));
  const profilePath = path.resolve('profiles/www.douyin.com.json');
  const profile = await readJsonFile(profilePath);
  const captureAttempts = new Map();

  try {
    const report = await siteDoctor('https://www.douyin.com/?recommend=1', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
    }, {
      resolveSite: async () => ({ adapter: { id: 'douyin' } }),
      resolveSiteAuthProfile: async () => ({
        profile,
        warnings: [],
        filePath: profilePath,
      }),
      resolveSiteBrowserSessionOptions: async () => ({
        reuseLoginState: true,
        userDataDir: path.join(workspace, 'profiles', 'douyin.com'),
        cleanupUserDataDirOnShutdown: false,
        authConfig: {
          loginUrl: 'https://www.douyin.com/',
          postLoginUrl: 'https://www.douyin.com/',
        },
      }),
      openBrowserSession: async () => ({
        async navigateAndWait() {},
        async close() {},
      }),
      inspectLoginState: async () => ({
        loggedIn: true,
        loginStateDetected: true,
        identityConfirmed: true,
        identitySource: 'selector:[data-e2e="nav-user-avatar"]',
        currentUrl: profile.authValidationSamples.likesUrl,
        title: '喜欢',
      }),
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async (inputUrl) => {
        const currentAttempts = (captureAttempts.get(inputUrl) ?? 0) + 1;
        captureAttempts.set(inputUrl, currentAttempts);
        if (inputUrl === profile.authValidationSamples.selfPostsUrl && currentAttempts === 1) {
          return {
            status: 'failed',
            finalUrl: inputUrl,
            files: {
              manifest: path.join(workspace, 'capture-retry', 'manifest.json'),
            },
            runtimeGovernance: {
              riskCauseCode: 'concurrent-profile-use',
              riskAction: 'wait-for-active-session',
            },
            error: {
              code: 'concurrent-profile-use',
              message: 'Capture blocked because the persistent browser profile is already in use.',
            },
          };
        }
        return {
          status: 'success',
          finalUrl: inputUrl,
          files: {
            manifest: path.join(workspace, `${Buffer.from(inputUrl).toString('hex').slice(0, 8)}.json`),
          },
          error: null,
        };
      },
      expandStates: async (inputUrl) => {
        const baseState = {
          status: 'initial',
          trigger: null,
          files: {},
        };
        if (inputUrl === 'https://www.douyin.com/?recommend=1') {
          return {
            outDir: path.join(workspace, 'expand-home'),
            summary: { capturedStates: 3 },
            warnings: [],
            states: [
              {
                ...baseState,
                state_id: 's0001',
                finalUrl: 'https://www.douyin.com/search/%E6%B5%8B%E8%AF%95?type=general',
                pageType: 'search-results-page',
                trigger: { kind: 'search-form' },
              },
              {
                ...baseState,
                state_id: 's0002',
                status: 'captured',
                finalUrl: profile.validationSamples.videoDetailUrl,
                pageType: 'book-detail-page',
                trigger: { kind: 'content-link' },
              },
              {
                ...baseState,
                state_id: 's0003',
                status: 'captured',
                finalUrl: profile.validationSamples.authorUrl,
                pageType: 'author-page',
                trigger: { kind: 'safe-nav-link' },
              },
            ],
          };
        }
        const pageFactsByUrl = new Map([
          [profile.validationSamples.authorVideosUrl, { authorSubpage: 'post', featuredContentCount: 1 }],
          [profile.authValidationSamples.selfPostsUrl, { authorSubpage: 'post', loginStateDetected: true, identityConfirmed: true, featuredContentCount: 1 }],
          [profile.authValidationSamples.likesUrl, { authorSubpage: 'like', loginStateDetected: true, identityConfirmed: true, featuredContentCount: 1 }],
          [profile.authValidationSamples.collectionsUrl, { authorSubpage: 'collect', loginStateDetected: true, identityConfirmed: true, featuredContentCount: 1 }],
          [profile.authValidationSamples.historyUrl, { authorSubpage: 'history', loginStateDetected: true, identityConfirmed: true, featuredContentCount: 1 }],
          [profile.authValidationSamples.followFeedUrl, { authorSubpage: 'follow-feed', loginStateDetected: true, identityConfirmed: true, featuredContentCount: 1 }],
          [profile.authValidationSamples.followUsersUrl, { authorSubpage: 'follow-users', loginStateDetected: true, identityConfirmed: true, featuredAuthorCount: 1 }],
        ]);
        const pageFacts = pageFactsByUrl.get(inputUrl);
        return {
          outDir: path.join(workspace, 'expand-scenarios'),
          summary: { capturedStates: 1 },
          warnings: [],
          states: [{
            ...baseState,
            state_id: `state-${Buffer.from(inputUrl).toString('hex').slice(0, 6)}`,
            finalUrl: inputUrl,
            pageType: inputUrl === profile.validationSamples.authorVideosUrl ? 'author-page' : 'author-list-page',
            pageFacts,
          }],
        };
      },
    });

    assert.equal(captureAttempts.get(profile.authValidationSamples.selfPostsUrl), 2);
    assert.equal(report.scenarios.find((entry) => entry.id === 'self-posts')?.status, 'pass');
    assert.equal(report.scenarios.find((entry) => entry.id === 'self-posts')?.reasonCode, 'ok');
    assert.ok(report.scenarios.filter((entry) => entry.id !== 'home-search-video-detail-author').every((entry) => entry.status === 'pass'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor falls back to keepalive when the douyin auth probe hits a transient browser failure', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-douyin-auth-fallback-'));
  const profilePath = path.resolve('profiles/www.douyin.com.json');
  const profile = await readJsonFile(profilePath);
  let keepaliveCalls = 0;

  try {
    const report = await siteDoctor('https://www.douyin.com/?recommend=1', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
    }, {
      resolveSite: async () => ({ adapter: { id: 'douyin' } }),
      resolveSiteAuthProfile: async () => ({
        profile,
        warnings: [],
        filePath: profilePath,
      }),
      resolveSiteBrowserSessionOptions: async () => ({
        reuseLoginState: true,
        userDataDir: path.join(workspace, 'profiles', 'douyin.com'),
        cleanupUserDataDirOnShutdown: false,
        authConfig: {
          loginUrl: 'https://www.douyin.com/',
          postLoginUrl: 'https://www.douyin.com/',
          verificationUrl: profile.authValidationSamples.likesUrl,
        },
      }),
      openBrowserSession: async () => {
        throw new Error('CDP socket closed: 1006');
      },
      siteKeepalive: async (inputUrl, options) => {
        keepaliveCalls += 1;
        assert.equal(inputUrl, 'https://www.douyin.com/?recommend=1');
        assert.match(String(options.outDir ?? ''), /auth-probe-keepalive/u);
        return {
          keepalive: {
            status: 'kept-alive',
            authStatus: 'session-reused',
            persistenceVerified: true,
            runtimeUrl: profile.authValidationSamples.likesUrl,
            networkIdentityFingerprint: 'feedfacecafebeef',
            profileQuarantined: false,
          },
          loginReport: {
            auth: {
              status: 'session-reused',
              loginStateDetected: true,
              identityConfirmed: true,
              identitySource: 'keepalive-fallback',
              currentUrl: profile.authValidationSamples.likesUrl,
            },
          },
        };
      },
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async (inputUrl) => ({
        status: 'success',
        finalUrl: inputUrl,
        files: {
          manifest: path.join(workspace, `${Buffer.from(inputUrl).toString('hex').slice(0, 8)}.json`),
        },
        error: null,
      }),
      expandStates: async (inputUrl) => {
        const baseState = {
          status: 'initial',
          trigger: null,
          files: {},
        };
        if (inputUrl === 'https://www.douyin.com/?recommend=1') {
          return {
            outDir: path.join(workspace, 'expand-home'),
            summary: { capturedStates: 3 },
            warnings: [],
            states: [
              {
                ...baseState,
                state_id: 's0001',
                finalUrl: 'https://www.douyin.com/search/%E6%B5%8B%E8%AF%95?type=general',
                pageType: 'search-results-page',
                trigger: { kind: 'search-form' },
              },
              {
                ...baseState,
                state_id: 's0002',
                status: 'captured',
                finalUrl: profile.validationSamples.videoDetailUrl,
                pageType: 'book-detail-page',
                trigger: { kind: 'content-link' },
              },
              {
                ...baseState,
                state_id: 's0003',
                status: 'captured',
                finalUrl: profile.validationSamples.authorUrl,
                pageType: 'author-page',
                trigger: { kind: 'safe-nav-link' },
              },
            ],
          };
        }
        const pageFactsByUrl = new Map([
          [profile.validationSamples.authorVideosUrl, { authorSubpage: 'post', featuredContentCount: 1 }],
          [profile.authValidationSamples.selfPostsUrl, { authorSubpage: 'post', loginStateDetected: true, identityConfirmed: true, featuredContentCount: 1 }],
          [profile.authValidationSamples.likesUrl, { authorSubpage: 'like', loginStateDetected: true, identityConfirmed: true, featuredContentCount: 1 }],
          [profile.authValidationSamples.collectionsUrl, { authorSubpage: 'collect', loginStateDetected: true, identityConfirmed: true, featuredContentCount: 1 }],
          [profile.authValidationSamples.historyUrl, { authorSubpage: 'history', loginStateDetected: true, identityConfirmed: true, featuredContentCount: 1 }],
          [profile.authValidationSamples.followFeedUrl, { authorSubpage: 'follow-feed', loginStateDetected: true, identityConfirmed: true, featuredContentCount: 1 }],
          [profile.authValidationSamples.followUsersUrl, { authorSubpage: 'follow-users', loginStateDetected: true, identityConfirmed: true, featuredAuthorCount: 1 }],
        ]);
        const pageFacts = pageFactsByUrl.get(inputUrl);
        return {
          outDir: path.join(workspace, 'expand-scenarios'),
          summary: { capturedStates: 1 },
          warnings: [],
          states: [{
            ...baseState,
            state_id: `state-${Buffer.from(inputUrl).toString('hex').slice(0, 6)}`,
            finalUrl: inputUrl,
            pageType: inputUrl === profile.validationSamples.authorVideosUrl ? 'author-page' : 'author-list-page',
            pageFacts,
          }],
        };
      },
    });

    assert.equal(keepaliveCalls, 1);
    assert.equal(report.sessionReuseWorked, true);
    assert.equal(report.authSession?.probeFailed, undefined);
    assert.equal(report.authSession?.identityConfirmed, true);
    assert.equal(report.authSession?.identitySource, 'keepalive-fallback');
    assert.equal(report.authSession?.currentUrl, profile.authValidationSamples.likesUrl);
    assert.equal(report.authSession?.networkIdentityFingerprint, 'feedfacecafebeef');
    assert.ok(report.scenarios.filter((entry) => entry.authRequired).every((entry) => entry.status === 'pass'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor skips authenticated douyin scenarios when reusable login is unavailable', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-douyin-auth-missing-'));
  const profilePath = path.resolve('profiles/www.douyin.com.json');
  const profile = await readJsonFile(profilePath);

  try {
    const report = await siteDoctor('https://www.douyin.com/?recommend=1', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
    }, {
      resolveSite: async () => ({ adapter: { id: 'douyin' } }),
      resolveSiteAuthProfile: async () => ({
        profile,
        warnings: [],
        filePath: profilePath,
      }),
      resolveSiteBrowserSessionOptions: async () => ({
        reuseLoginState: true,
        userDataDir: path.join(workspace, 'profiles', 'douyin.com'),
        cleanupUserDataDirOnShutdown: false,
        authConfig: {
          loginUrl: 'https://www.douyin.com/',
          postLoginUrl: 'https://www.douyin.com/',
        },
      }),
      openBrowserSession: async () => ({
        async navigateAndWait() {},
        async close() {},
      }),
      inspectLoginState: async () => ({
        loggedIn: false,
        loginStateDetected: false,
        identityConfirmed: false,
        identitySource: null,
      }),
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async () => ({
        status: 'success',
        finalUrl: 'https://www.douyin.com/?recommend=1',
        files: {
          manifest: path.join(workspace, 'capture', 'manifest.json'),
        },
        error: null,
      }),
      expandStates: async (inputUrl) => ({
        outDir: path.join(workspace, 'expand'),
        summary: { capturedStates: 1 },
        warnings: [],
        states: inputUrl === 'https://www.douyin.com/?recommend=1' ? [
          {
            state_id: 's0001',
            status: 'captured',
            finalUrl: 'https://www.douyin.com/search/%E6%B5%8B%E8%AF%95?type=video',
            pageType: 'search-results-page',
            trigger: { kind: 'search-form' },
            files: {},
          },
          {
            state_id: 's0002',
            status: 'captured',
            finalUrl: profile.validationSamples.videoDetailUrl,
            pageType: 'book-detail-page',
            trigger: { kind: 'content-link' },
            files: {},
          },
          {
            state_id: 's0003',
            status: 'captured',
            finalUrl: profile.validationSamples.authorUrl,
            pageType: 'author-page',
            trigger: { kind: 'safe-nav-link' },
            files: {},
          },
        ] : [
          {
            state_id: 'p0001',
            status: 'initial',
            finalUrl: profile.validationSamples.authorVideosUrl,
            pageType: 'author-page',
            trigger: null,
            files: {},
          },
        ],
      }),
    });

    const skippedAuthScenarios = report.scenarios.filter((entry) => entry.authRequired);
    assert.equal(report.sessionReuseWorked, false);
    assert.equal(report.scenarios.find((entry) => entry.id === 'public-author-posts')?.status, 'pass');
    assert.equal(skippedAuthScenarios.length, 6);
    assert.ok(skippedAuthScenarios.every((entry) => entry.status === 'skipped'));
    assert.ok(skippedAuthScenarios.every((entry) => entry.reasonCode === 'not-logged-in'));
    assert.ok(skippedAuthScenarios.every((entry) => entry.riskCauseCode === null));
    assert.ok(skippedAuthScenarios.every((entry) => entry.riskAction === null));
    assert.ok(skippedAuthScenarios.every((entry) => entry.profileQuarantined === false));
    assert.equal(report.riskCauseCode, null);
    assert.equal(report.riskAction, null);
    assert.equal(report.profileQuarantined, false);
    assert.match(String(report.networkIdentityFingerprint ?? ''), /^[0-9a-f]{16}$/u);
    assert.match(report.warnings.join('\n'), /No reusable logged-in douyin session was detected/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor uses xiaohongshu notification samples and reports the xiaohongshu scenario matrix', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-xiaohongshu-'));
  const profilePath = path.resolve('profiles/www.xiaohongshu.com.json');
  const profile = await readJsonFile(profilePath);
  const observedRuns = [];
  const observedProbeUrls = [];

  try {
    const report = await siteDoctor('https://www.xiaohongshu.com/explore', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
    }, {
      resolveSite: async () => ({ adapter: { id: 'xiaohongshu' } }),
      resolveSiteAuthProfile: async () => ({
        profile,
        warnings: [],
        filePath: profilePath,
      }),
      resolveSiteBrowserSessionOptions: async () => ({
        reuseLoginState: true,
        userDataDir: path.join(workspace, 'profiles', 'xiaohongshu.com'),
        cleanupUserDataDirOnShutdown: false,
        authConfig: {
          loginUrl: profile.authSession.loginUrl,
          postLoginUrl: profile.authSession.postLoginUrl,
          verificationUrl: profile.authSession.verificationUrl,
          keepaliveUrl: profile.authSession.keepaliveUrl,
        },
      }),
      runAuthenticatedKeepalivePreflight: async () => ({
        attempted: false,
        ran: false,
        reason: 'not-due',
      }),
      openBrowserSession: async (options) => {
        observedProbeUrls.push({ startupUrl: options.startupUrl });
        return {
          async navigateAndWait(url) {
            observedProbeUrls[observedProbeUrls.length - 1].navigateUrl = url;
          },
          async close() {},
        };
      },
      inspectLoginState: async () => ({
        loggedIn: true,
        loginStateDetected: true,
        identityConfirmed: true,
        identitySource: 'selector:.notification-page',
        currentUrl: profile.authValidationSamples.notificationUrl,
        title: '通知',
      }),
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async () => ({
        status: 'success',
        finalUrl: 'https://www.xiaohongshu.com/explore',
        files: {
          manifest: path.join(workspace, 'capture', 'manifest.json'),
        },
        error: null,
      }),
      expandStates: async (inputUrl, options) => {
        observedRuns.push({
          inputUrl,
          searchQueries: options.searchQueries,
          maxTriggers: options.maxTriggers,
          maxCapturedStates: options.maxCapturedStates,
        });
        let states;
        if (inputUrl === 'https://www.xiaohongshu.com/explore') {
          states = [
            {
              state_id: 'xhs-home-search',
              status: 'captured',
              finalUrl: 'https://www.xiaohongshu.com/search_result?keyword=%E7%A9%BF%E6%90%AD',
              pageType: 'search-results-page',
              trigger: { kind: 'search-form' },
              files: {},
            },
            {
              state_id: 'xhs-home-detail',
              status: 'captured',
              finalUrl: profile.validationSamples.videoDetailUrl,
              pageType: 'book-detail-page',
              trigger: { kind: 'content-link' },
              files: {},
            },
            {
              state_id: 'xhs-home-author',
              status: 'captured',
              finalUrl: profile.validationSamples.authorUrl,
              pageType: 'author-page',
              trigger: { kind: 'safe-nav-link' },
              files: {},
            },
          ];
        } else if (inputUrl === profile.validationSamples.authorVideosUrl) {
          states = [
            {
              state_id: 'xhs-author-home',
              status: 'initial',
              finalUrl: inputUrl,
              pageType: 'author-page',
              trigger: null,
              files: {},
            },
            {
              state_id: 'xhs-author-detail',
              status: 'captured',
              finalUrl: profile.validationSamples.videoDetailUrl,
              pageType: 'book-detail-page',
              trigger: { kind: 'content-link' },
              files: {},
            },
          ];
        } else if (inputUrl === profile.authValidationSamples.notificationUrl) {
          states = [
            {
              state_id: 'xhs-notification',
              status: 'initial',
              finalUrl: inputUrl,
              pageType: 'utility-page',
              pageFacts: {
                loginStateDetected: true,
                identityConfirmed: true,
                featuredContentCount: 0,
                featuredAuthorCount: 0,
              },
              trigger: null,
              files: {},
            },
          ];
        } else {
          throw new Error(`Unexpected scenario input: ${inputUrl}`);
        }

        return {
          outDir: path.join(workspace, 'expand'),
          summary: {
            capturedStates: states.length,
          },
          warnings: [],
          states,
        };
      },
    });

    assert.equal(observedProbeUrls[0]?.startupUrl, profile.authValidationSamples.notificationUrl);
    assert.equal(observedProbeUrls[0]?.navigateUrl, profile.authValidationSamples.notificationUrl);
    assert.deepEqual(observedRuns.map((entry) => entry.inputUrl), [
      'https://www.xiaohongshu.com/explore',
      profile.validationSamples.authorVideosUrl,
      profile.authValidationSamples.notificationUrl,
    ]);
    assert.deepEqual(observedRuns[0].searchQueries, [profile.validationSamples.videoSearchQuery]);
    assert.deepEqual(
      observedRuns.map((entry) => ({ inputUrl: entry.inputUrl, maxTriggers: entry.maxTriggers, maxCapturedStates: entry.maxCapturedStates })),
      [
        { inputUrl: 'https://www.xiaohongshu.com/explore', maxTriggers: 6, maxCapturedStates: 3 },
        { inputUrl: profile.validationSamples.authorVideosUrl, maxTriggers: 6, maxCapturedStates: 3 },
        { inputUrl: profile.authValidationSamples.notificationUrl, maxTriggers: 6, maxCapturedStates: 3 },
      ],
    );
    assert.equal(report.sessionReuseWorked, true);
    assert.equal(report.authSession?.loginStateDetected, true);
    assert.equal(report.authSession?.identityConfirmed, true);
    assert.equal(report.authSession?.identitySource, 'selector:.notification-page');
    assert.equal(report.authSession?.currentUrl, profile.authValidationSamples.notificationUrl);
    assert.equal(report.authSession?.riskCauseCode, null);
    assert.equal(report.authSession?.riskAction, null);
    assert.equal(report.authSession?.profileQuarantined, false);
    assert.match(String(report.authSession?.networkIdentityFingerprint ?? ''), /^[0-9a-f]{16}$/u);
    assert.equal(report.search.valid, true);
    assert.deepEqual(report.search.details, {
      stateId: 'xhs-home-search',
      finalUrl: 'https://www.xiaohongshu.com/search_result?keyword=%E7%A9%BF%E6%90%AD',
      pageType: 'search-results-page',
    });
    assert.equal(report.detail.valid, true);
    assert.deepEqual(report.detail.details, {
      stateId: 'xhs-home-detail',
      finalUrl: profile.validationSamples.videoDetailUrl,
      pageType: 'book-detail-page',
    });
    assert.equal(report.author?.valid, true);
    assert.deepEqual(report.author?.details, {
      stateId: 'xhs-home-author',
      finalUrl: profile.validationSamples.authorUrl,
      pageType: 'author-page',
    });
    assert.equal(report.scenarios.length, 3);
    assert.deepEqual(report.scenarios.map((entry) => entry.id), [
      'home-search-note-detail-author',
      'author-notes-to-detail',
      'notification-inbox',
    ]);
    assert.ok(report.scenarios.every((entry) => entry.status === 'pass'));
    assert.equal(report.scenarios[0].finalUrl, profile.validationSamples.authorUrl);
    assert.equal(report.scenarios[0].semanticPageType, 'author-page');
    assert.match(report.scenarios[0].note ?? '', /discover -> search-results -> content-detail -> author-page/u);
    assert.equal(report.scenarios[2].reasonCode, 'ok');
    assert.equal(report.scenarios[2].authRequired, true);
    assert.equal(report.scenarios[2].expectedSemanticPageType, 'utility-page');
    assert.equal(report.scenarios[2].featuredContentCount, 0);
    assert.equal(report.riskCauseCode, null);
    assert.equal(report.riskAction, null);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor falls back Xiaohongshu tourist_search captures to canonical direct-search results and reports the recovered chain', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-xiaohongshu-direct-search-'));
  const profilePath = path.resolve('profiles/www.xiaohongshu.com.json');
  const profile = await readJsonFile(profilePath);
  const fallbackSearchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(profile.validationSamples.videoSearchQuery)}&type=51`;
  const captureCalls = [];
  const expandCalls = [];

  try {
    const report = await siteDoctor('https://www.xiaohongshu.com/explore', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
    }, {
      resolveSite: async () => ({ adapter: { id: 'xiaohongshu' } }),
      resolveSiteAuthProfile: async () => ({
        profile,
        warnings: [],
        filePath: profilePath,
      }),
      resolveSiteBrowserSessionOptions: async () => ({
        reuseLoginState: true,
        userDataDir: path.join(workspace, 'profiles', 'xiaohongshu.com'),
        cleanupUserDataDirOnShutdown: false,
        authConfig: {
          loginUrl: profile.authSession.loginUrl,
          postLoginUrl: profile.authSession.postLoginUrl,
          verificationUrl: profile.authSession.verificationUrl,
          keepaliveUrl: profile.authSession.keepaliveUrl,
        },
      }),
      runAuthenticatedKeepalivePreflight: async () => ({
        attempted: false,
        ran: false,
        reason: 'not-due',
      }),
      openBrowserSession: async () => ({
        async navigateAndWait() {},
        async close() {},
      }),
      inspectLoginState: async () => ({
        loggedIn: true,
        loginStateDetected: true,
        identityConfirmed: true,
        identitySource: 'selector:.notification-page',
        currentUrl: profile.authValidationSamples.notificationUrl,
        title: '通知',
      }),
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async (inputUrl, options) => {
        captureCalls.push({
          inputUrl,
          outDir: options.outDir,
        });
        return {
          status: 'success',
          finalUrl: inputUrl,
          files: {
            manifest: path.join(options.outDir, 'manifest.json'),
          },
          error: null,
        };
      },
      expandStates: async (inputUrl, options) => {
        expandCalls.push({
          inputUrl,
          outDir: options.outDir,
          searchQueries: options.searchQueries,
        });
        if (inputUrl === 'https://www.xiaohongshu.com/explore') {
          return {
            outDir: path.join(workspace, 'expand-home'),
            summary: { capturedStates: 1 },
            warnings: [],
            states: [
              {
                state_id: 'xhs-tourist-search',
                status: 'captured',
                finalUrl: 'https://www.xiaohongshu.com/explore?source=tourist_search',
                pageType: 'search-results-page',
                trigger: { kind: 'search-form' },
                files: {},
              },
            ],
          };
        }
        if (inputUrl === fallbackSearchUrl) {
          return {
            outDir: path.join(workspace, 'expand-direct-search'),
            summary: { capturedStates: 3 },
            warnings: [],
            states: [
              {
                state_id: 'xhs-direct-search-result',
                status: 'captured',
                finalUrl: fallbackSearchUrl,
                pageType: 'search-results-page',
                trigger: { kind: 'search-form' },
                files: {},
              },
              {
                state_id: 'xhs-direct-detail',
                status: 'captured',
                finalUrl: profile.validationSamples.videoDetailUrl,
                pageType: 'book-detail-page',
                trigger: { kind: 'content-link' },
                files: {},
              },
              {
                state_id: 'xhs-direct-author',
                status: 'captured',
                finalUrl: profile.validationSamples.authorUrl,
                pageType: 'author-page',
                trigger: { kind: 'safe-nav-link' },
                files: {},
              },
            ],
          };
        }
        if (inputUrl === profile.validationSamples.authorVideosUrl) {
          return {
            outDir: path.join(workspace, 'expand-author'),
            summary: { capturedStates: 2 },
            warnings: [],
            states: [
              {
                state_id: 'xhs-author-home',
                status: 'initial',
                finalUrl: inputUrl,
                pageType: 'author-page',
                trigger: null,
                files: {},
              },
              {
                state_id: 'xhs-author-detail',
                status: 'captured',
                finalUrl: profile.validationSamples.videoDetailUrl,
                pageType: 'book-detail-page',
                trigger: { kind: 'content-link' },
                files: {},
              },
            ],
          };
        }
        if (inputUrl === profile.authValidationSamples.notificationUrl) {
          return {
            outDir: path.join(workspace, 'expand-notification'),
            summary: { capturedStates: 1 },
            warnings: [],
            states: [
              {
                state_id: 'xhs-notification',
                status: 'initial',
                finalUrl: inputUrl,
                pageType: 'utility-page',
                pageFacts: {
                  loginStateDetected: true,
                  identityConfirmed: true,
                  featuredContentCount: 0,
                  featuredAuthorCount: 0,
                },
                trigger: null,
                files: {},
              },
            ],
          };
        }
        throw new Error(`Unexpected scenario input: ${inputUrl}`);
      },
    });

    const markdown = await readFile(report.reports.markdown, 'utf8');

    assert.deepEqual(expandCalls.map((entry) => entry.inputUrl), [
      'https://www.xiaohongshu.com/explore',
      fallbackSearchUrl,
      profile.validationSamples.authorVideosUrl,
      profile.authValidationSamples.notificationUrl,
    ]);
    assert.deepEqual(expandCalls[0].searchQueries, [profile.validationSamples.videoSearchQuery]);
    assert.deepEqual(expandCalls[1].searchQueries, []);
    assert.match(expandCalls[1].outDir, /expand-direct-search/u);
    assert.equal(
      captureCalls.some((entry) => entry.inputUrl === fallbackSearchUrl && /capture-direct-search/u.test(entry.outDir)),
      true,
    );
    assert.equal(report.search.valid, true);
    assert.deepEqual(report.search.details, {
      stateId: 'xiaohongshu-direct-search',
      finalUrl: fallbackSearchUrl,
      pageType: 'search-results-page',
    });
    assert.equal(report.detail.valid, true);
    assert.deepEqual(report.detail.details, {
      stateId: 'xhs-direct-detail',
      finalUrl: profile.validationSamples.videoDetailUrl,
      pageType: 'book-detail-page',
    });
    assert.equal(report.author?.valid, true);
    assert.deepEqual(report.author?.details, {
      stateId: 'xhs-direct-author',
      finalUrl: profile.validationSamples.authorUrl,
      pageType: 'author-page',
    });
    assert.equal(report.scenarios.find((entry) => entry.id === 'home-search-note-detail-author')?.status, 'pass');
    assert.equal(report.scenarios.find((entry) => entry.id === 'home-search-note-detail-author')?.finalUrl, profile.validationSamples.authorUrl);
    assert.match(report.warnings.join('\n'), /fell back from tourist_search to a canonical \/search_result capture/u);
    assert.match(markdown, /## Warnings/u);
    assert.match(markdown, /fell back from tourist_search to a canonical \/search_result capture/u);
    assert.match(markdown, /home-search-note-detail-author: pass/u);
    assert.match(markdown, /notification-inbox: pass/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor routes Xiaohongshu download preflight through the Xiaohongshu action entrypoint', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-xiaohongshu-download-'));
  const profilePath = path.resolve('profiles/www.xiaohongshu.com.json');
  const profile = await readJsonFile(profilePath);
  const runProcessCalls = [];
  const passthroughSidecarPath = path.join(workspace, 'profiles', 'xiaohongshu.com', '.bws', 'xiaohongshu-download-auth.json');
  const passthroughCookieFile = path.join(workspace, 'profiles', 'xiaohongshu.com', '.bws', 'xiaohongshu-download-cookies.txt');

  try {
    const report = await siteDoctor('https://www.xiaohongshu.com/explore', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
      checkDownload: true,
    }, {
      resolveSite: async () => ({ adapter: { id: 'xiaohongshu' } }),
      resolveSiteAuthProfile: async () => ({
        profile,
        warnings: [],
        filePath: profilePath,
      }),
      resolveSiteBrowserSessionOptions: async () => ({
        reuseLoginState: true,
        userDataDir: path.join(workspace, 'profiles', 'xiaohongshu.com'),
        cleanupUserDataDirOnShutdown: false,
        authConfig: {
          loginUrl: profile.authSession.loginUrl,
          postLoginUrl: profile.authSession.postLoginUrl,
          verificationUrl: profile.authSession.verificationUrl,
          keepaliveUrl: profile.authSession.keepaliveUrl,
        },
      }),
      runAuthenticatedKeepalivePreflight: async () => ({
        attempted: false,
        ran: false,
        reason: 'not-due',
      }),
      openBrowserSession: async () => ({
        async navigateAndWait() {},
        async close() {},
      }),
      inspectLoginState: async () => ({
        loggedIn: true,
        loginStateDetected: true,
        identityConfirmed: true,
        identitySource: 'selector:.notification-page',
        currentUrl: profile.authValidationSamples.notificationUrl,
        title: '通知',
      }),
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async () => ({
        status: 'success',
        finalUrl: 'https://www.xiaohongshu.com/explore',
        files: {
          manifest: path.join(workspace, 'capture', 'manifest.json'),
        },
        error: null,
      }),
      expandStates: async (inputUrl, options) => {
        let states;
        if (inputUrl === 'https://www.xiaohongshu.com/explore') {
          states = [
            {
              state_id: 'xhs-home-search',
              status: 'captured',
              finalUrl: 'https://www.xiaohongshu.com/search_result?keyword=%E7%A9%BF%E6%90%AD',
              pageType: 'search-results-page',
              trigger: { kind: 'search-form' },
              files: {},
            },
            {
              state_id: 'xhs-home-detail',
              status: 'captured',
              finalUrl: profile.validationSamples.videoDetailUrl,
              pageType: 'book-detail-page',
              trigger: { kind: 'content-link' },
              files: {},
            },
            {
              state_id: 'xhs-home-author',
              status: 'captured',
              finalUrl: profile.validationSamples.authorUrl,
              pageType: 'author-page',
              trigger: { kind: 'safe-nav-link' },
              files: {},
            },
          ];
        } else if (inputUrl === profile.validationSamples.authorVideosUrl) {
          states = [
            {
              state_id: 'xhs-author-home',
              status: 'initial',
              finalUrl: inputUrl,
              pageType: 'author-page',
              trigger: null,
              files: {},
            },
            {
              state_id: 'xhs-author-detail',
              status: 'captured',
              finalUrl: profile.validationSamples.videoDetailUrl,
              pageType: 'book-detail-page',
              trigger: { kind: 'content-link' },
              files: {},
            },
          ];
        } else if (inputUrl === profile.authValidationSamples.notificationUrl) {
          states = [
            {
              state_id: 'xhs-notification',
              status: 'initial',
              finalUrl: inputUrl,
              pageType: 'utility-page',
              pageFacts: {
                loginStateDetected: true,
                identityConfirmed: true,
              },
              trigger: null,
              files: {},
            },
          ];
        } else {
          throw new Error(`Unexpected scenario input: ${inputUrl}`);
        }
        return {
          outDir: path.join(workspace, 'expand'),
          summary: {
            capturedStates: states.length,
          },
          warnings: [],
          states,
        };
      },
      exportSiteDownloadPassthrough: async () => ({
        available: true,
        reasonCode: null,
        passthroughMode: 'cookie-header',
        sessionProfileAvailable: true,
        cookieHeaderAvailable: true,
        cookieCount: 2,
        cookieNames: ['a1', 'web_session'],
        cookieDomains: ['.xiaohongshu.com', 'www.xiaohongshu.com'],
        headerNames: ['Accept-Language', 'Cookie', 'Origin', 'Referer', 'User-Agent'],
        sidecarPath: passthroughSidecarPath,
        cookieFile: passthroughCookieFile,
        userDataDir: path.join(workspace, 'profiles', 'xiaohongshu.com'),
        verificationUrl: profile.authValidationSamples.notificationUrl,
        currentUrl: profile.authValidationSamples.notificationUrl,
        title: '通知',
        loginStateDetected: true,
        identityConfirmed: true,
        identitySource: 'selector:.notification-page',
        env: {
          BWS_XIAOHONGSHU_DOWNLOAD_AUTH_SIDECAR: passthroughSidecarPath,
          BWS_XIAOHONGSHU_DOWNLOAD_COOKIE_FILE: passthroughCookieFile,
          BWS_XIAOHONGSHU_DOWNLOAD_USER_DATA_DIR: path.join(workspace, 'profiles', 'xiaohongshu.com'),
          BWS_XIAOHONGSHU_DOWNLOAD_PASSTHROUGH_MODE: 'cookie-header',
        },
      }),
      runProcess: async (command, args, options) => {
        runProcessCalls.push({ command, args, options });
        return {
          code: 0,
          stdout: JSON.stringify({
            ok: true,
            action: 'download',
            reasonCode: 'download-started',
            resolvedInputs: [profile.validationSamples.videoDetailUrl],
            resolution: {
              inputKinds: {
                'note-detail': 1,
                'author-note-list': 1,
                'search-query': 1,
              },
              attemptedPages: 2,
              attemptedNotes: 3,
              resolvedNotes: 2,
              skippedVideoNotes: 1,
              skippedNoImageNotes: 0,
              failedNotes: 0,
            },
            download: {
              runDir: path.join(workspace, 'note-downloads', 'www.xiaohongshu.com', '20260423T130000000Z'),
              summary: {
                total: 2,
                successful: 0,
                partial: 0,
                failed: 0,
                planned: 2,
              },
              warnings: [],
            },
            downloadSession: {
              status: 'sidecar-reused',
              cookieCount: 2,
              userDataDir: path.join(workspace, 'profiles', 'xiaohongshu.com'),
              finalUrl: profile.authValidationSamples.notificationUrl,
              sidecarPath: passthroughSidecarPath,
            },
            actionSummary: {
              total: 2,
              successful: 0,
              partial: 0,
              failed: 0,
              planned: 2,
              runDir: path.join(workspace, 'note-downloads', 'www.xiaohongshu.com', '20260423T130000000Z'),
            },
          }),
          stderr: '',
        };
      },
    });

    assert.equal(report.download?.valid, true);
    assert.deepEqual(report.download?.details?.inputSources, ['author-note-list', 'note-detail', 'search-query']);
    assert.equal(report.download?.details?.resolution?.resolvedNotes, 2);
    assert.equal(report.download?.details?.summary?.planned, 2);
    assert.deepEqual(report.download?.details?.resolvedInputs, [profile.validationSamples.videoDetailUrl]);
    assert.equal(report.download?.details?.downloadSession?.status, 'sidecar-reused');
    assert.equal(report.download?.details?.downloadSession?.cookieCount, 2);
    assert.equal(report.download?.details?.authPassthrough?.available, true);
    assert.equal(report.download?.details?.authPassthrough?.passthroughMode, 'cookie-header');
    assert.equal(report.download?.details?.authPassthrough?.cookieCount, 2);
    assert.equal(report.download?.details?.authPassthrough?.sidecarPath, passthroughSidecarPath);
    assert.equal(report.download?.details?.authPassthrough?.cookieFile, passthroughCookieFile);
    assert.equal(runProcessCalls.length, 1);
    assert.equal(runProcessCalls[0].command, process.execPath);
    assert.match(String(runProcessCalls[0].args[0]).replace(/\\/gu, '/'), /\/src\/entrypoints\/sites\/xiaohongshu-action\.mjs$/u);
    assert.ok(runProcessCalls[0].args.includes('--dry-run'));
    assert.ok(runProcessCalls[0].args.includes('--query'));
    assert.equal(runProcessCalls[0].args[runProcessCalls[0].args.indexOf('--query') + 1], profile.validationSamples.videoSearchQuery);
    assert.equal(runProcessCalls[0].args[runProcessCalls[0].args.indexOf('--profile-path') + 1], profilePath);
    assert.equal(runProcessCalls[0].options.env.BWS_XIAOHONGSHU_DOWNLOAD_AUTH_SIDECAR, passthroughSidecarPath);
    assert.equal(runProcessCalls[0].options.env.BWS_XIAOHONGSHU_DOWNLOAD_COOKIE_FILE, passthroughCookieFile);
    assert.equal(runProcessCalls[0].options.env.BWS_XIAOHONGSHU_DOWNLOAD_PASSTHROUGH_MODE, 'cookie-header');
    assert.equal(runProcessCalls[0].options.env.BWS_XIAOHONGSHU_DOWNLOAD_USER_DATA_DIR, path.join(workspace, 'profiles', 'xiaohongshu.com'));
    const markdown = await readFile(report.reports.markdown, 'utf8');
    assert.match(markdown, /## Download Auth Passthrough/u);
    assert.match(markdown, /Mode: cookie-header/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor skips xiaohongshu notification scenario when auth bootstrap still cannot reuse login state', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-xiaohongshu-auth-missing-'));
  const profilePath = path.resolve('profiles/www.xiaohongshu.com.json');
  const profile = await readJsonFile(profilePath);
  const observedRuns = [];
  const observedProbeUrls = [];
  const loginBootstrapCalls = [];

  try {
    const report = await siteDoctor('https://www.xiaohongshu.com/explore', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
    }, {
      resolveSite: async () => ({ adapter: { id: 'xiaohongshu' } }),
      resolveSiteAuthProfile: async () => ({
        profile,
        warnings: [],
        filePath: profilePath,
      }),
      resolveSiteBrowserSessionOptions: async () => ({
        reuseLoginState: true,
        userDataDir: path.join(workspace, 'profiles', 'xiaohongshu.com'),
        cleanupUserDataDirOnShutdown: false,
        authConfig: {
          loginUrl: profile.authSession.loginUrl,
          postLoginUrl: profile.authSession.postLoginUrl,
          verificationUrl: profile.authSession.verificationUrl,
          keepaliveUrl: profile.authSession.keepaliveUrl,
        },
      }),
      runAuthenticatedKeepalivePreflight: async () => ({
        attempted: false,
        ran: false,
        reason: 'not-due',
      }),
      openBrowserSession: async (options) => {
        observedProbeUrls.push({ startupUrl: options.startupUrl });
        return {
          async navigateAndWait(url) {
            observedProbeUrls[observedProbeUrls.length - 1].navigateUrl = url;
          },
          async close() {},
        };
      },
      inspectLoginState: async () => ({
        loggedIn: false,
        loginStateDetected: false,
        identityConfirmed: false,
        identitySource: null,
        currentUrl: profile.authSession.loginUrl,
        title: 'xiaohongshu login',
      }),
      siteLogin: async (_inputUrl, options) => {
        loginBootstrapCalls.push(options);
        return {
          site: {
            runtimePurpose: 'login',
          },
          auth: {
            status: 'credentials-unavailable',
            autoLogin: true,
            waitedForManualLogin: false,
            credentialsSource: null,
            loginStateDetected: false,
            identityConfirmed: false,
            identitySource: null,
            persistenceVerified: false,
            currentUrl: profile.authSession.loginUrl,
            runtimeUrl: profile.authValidationSamples.notificationUrl,
            title: 'xiaohongshu login',
            riskCauseCode: 'session-invalid',
            riskAction: 'run-keepalive-or-auto-login',
            networkIdentityFingerprint: {
              fingerprint: 'feedfacefeedface',
            },
            profileQuarantined: false,
          },
          reports: {
            json: path.join(workspace, 'site-login.json'),
            markdown: path.join(workspace, 'site-login.md'),
          },
        };
      },
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async () => ({
        status: 'success',
        finalUrl: 'https://www.xiaohongshu.com/explore',
        files: {
          manifest: path.join(workspace, 'capture', 'manifest.json'),
        },
        error: null,
      }),
      expandStates: async (inputUrl, options) => {
        observedRuns.push({
          inputUrl,
          searchQueries: options.searchQueries,
        });
        return {
          outDir: path.join(workspace, 'expand'),
          summary: { capturedStates: 2 },
          warnings: [],
          states: inputUrl === 'https://www.xiaohongshu.com/explore' ? [
            {
              state_id: 'xhs-home-search',
              status: 'captured',
              finalUrl: 'https://www.xiaohongshu.com/search_result?keyword=%E7%A9%BF%E6%90%AD',
              pageType: 'search-results-page',
              trigger: { kind: 'search-form' },
              files: {},
            },
            {
              state_id: 'xhs-home-detail',
              status: 'captured',
              finalUrl: profile.validationSamples.videoDetailUrl,
              pageType: 'book-detail-page',
              trigger: { kind: 'content-link' },
              files: {},
            },
            {
              state_id: 'xhs-home-author',
              status: 'captured',
              finalUrl: profile.validationSamples.authorUrl,
              pageType: 'author-page',
              trigger: { kind: 'safe-nav-link' },
              files: {},
            },
          ] : [
            {
              state_id: 'xhs-author-detail',
              status: 'captured',
              finalUrl: profile.validationSamples.videoDetailUrl,
              pageType: 'book-detail-page',
              trigger: { kind: 'content-link' },
              files: {},
            },
          ],
        };
      },
    });

    const notificationScenario = report.scenarios.find((entry) => entry.id === 'notification-inbox');
    assert.equal(observedProbeUrls[0]?.startupUrl, profile.authValidationSamples.notificationUrl);
    assert.equal(observedProbeUrls[0]?.navigateUrl, profile.authValidationSamples.notificationUrl);
    assert.deepEqual(observedRuns.map((entry) => entry.inputUrl), [
      'https://www.xiaohongshu.com/explore',
      profile.validationSamples.authorVideosUrl,
    ]);
    assert.equal(loginBootstrapCalls.length, 1);
    assert.equal(loginBootstrapCalls[0].waitForManualLogin, false);
    assert.equal(loginBootstrapCalls[0].headless, false);
    assert.deepEqual(observedRuns[0].searchQueries, [profile.validationSamples.videoSearchQuery]);
    assert.equal(report.sessionReuseWorked, false);
    assert.equal(report.authSession?.bootstrapAttempted, true);
    assert.equal(report.authSession?.bootstrapStatus, 'credentials-unavailable');
    assert.equal(report.authSession?.bootstrapManualLoginRequired, true);
    assert.equal(report.authSession?.bootstrapPersistenceVerified, false);
    assert.equal(report.authSession?.currentUrl, profile.authSession.loginUrl);
    assert.equal(report.scenarios.find((entry) => entry.id === 'author-notes-to-detail')?.status, 'pass');
    assert.equal(notificationScenario?.status, 'skipped');
    assert.equal(notificationScenario?.reasonCode, 'not-logged-in');
    assert.equal(notificationScenario?.authRequired, true);
    assert.equal(notificationScenario?.riskCauseCode, null);
    assert.equal(report.riskCauseCode, 'session-invalid');
    assert.equal(report.riskAction, 'run-keepalive-or-auto-login');
    assert.equal(report.profileQuarantined, false);
    assert.match(String(report.networkIdentityFingerprint ?? ''), /^[0-9a-f]{16}$/u);
    assert.match(report.warnings.join('\n'), /No reusable logged-in xiaohongshu session was detected/u);
    assert.match(report.warnings.join('\n'), /Attempted xiaohongshu auth bootstrap via site-login; status=credentials-unavailable/u);
    assert.match(report.nextActions.join('\n'), /Run Xiaohongshu site-login in a visible browser and complete one manual login/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor uses Xiaohongshu auth bootstrap to recover notification validation when site-login reuses the session', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-xiaohongshu-auth-bootstrap-'));
  const profilePath = path.resolve('profiles/www.xiaohongshu.com.json');
  const profile = await readJsonFile(profilePath);
  const observedRuns = [];
  const observedProbeUrls = [];
  const loginBootstrapCalls = [];

  try {
    const report = await siteDoctor('https://www.xiaohongshu.com/explore', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
    }, {
      resolveSite: async () => ({ adapter: { id: 'xiaohongshu' } }),
      resolveSiteAuthProfile: async () => ({
        profile,
        warnings: [],
        filePath: profilePath,
      }),
      resolveSiteBrowserSessionOptions: async () => ({
        reuseLoginState: true,
        userDataDir: path.join(workspace, 'profiles', 'xiaohongshu.com'),
        cleanupUserDataDirOnShutdown: false,
        authConfig: {
          loginUrl: profile.authSession.loginUrl,
          postLoginUrl: profile.authSession.postLoginUrl,
          verificationUrl: profile.authSession.verificationUrl,
          keepaliveUrl: profile.authSession.keepaliveUrl,
          preferVisibleBrowserForAuthenticatedFlows: true,
        },
      }),
      runAuthenticatedKeepalivePreflight: async () => ({
        attempted: false,
        ran: false,
        reason: 'not-due',
      }),
      openBrowserSession: async (options) => {
        observedProbeUrls.push({ startupUrl: options.startupUrl });
        return {
          async navigateAndWait(url) {
            observedProbeUrls[observedProbeUrls.length - 1].navigateUrl = url;
          },
          async close() {},
        };
      },
      inspectLoginState: async () => ({
        loggedIn: false,
        loginStateDetected: false,
        identityConfirmed: false,
        identitySource: null,
        currentUrl: profile.authSession.loginUrl,
        title: 'xiaohongshu login',
      }),
      siteLogin: async (_inputUrl, options) => {
        loginBootstrapCalls.push(options);
        return {
          site: {
            runtimePurpose: 'login',
          },
          auth: {
            status: 'session-reused',
            autoLogin: true,
            waitedForManualLogin: false,
            credentialsSource: 'wincred:BrowserWikiSkill:xiaohongshu.com',
            loginStateDetected: true,
            identityConfirmed: true,
            identitySource: 'selector:.notification-page .user-avatar img',
            persistenceVerified: true,
            currentUrl: profile.authValidationSamples.notificationUrl,
            runtimeUrl: profile.authValidationSamples.notificationUrl,
            title: '通知',
            riskCauseCode: null,
            riskAction: null,
            networkIdentityFingerprint: {
              fingerprint: 'feedfacefeedface',
            },
            profileQuarantined: false,
          },
          reports: {
            json: path.join(workspace, 'site-login.json'),
            markdown: path.join(workspace, 'site-login.md'),
          },
        };
      },
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async () => ({
        status: 'success',
        finalUrl: 'https://www.xiaohongshu.com/explore',
        files: {
          manifest: path.join(workspace, 'capture', 'manifest.json'),
        },
        error: null,
      }),
      expandStates: async (inputUrl, options) => {
        observedRuns.push({
          inputUrl,
          searchQueries: options.searchQueries,
        });
        let states;
        if (inputUrl === 'https://www.xiaohongshu.com/explore') {
          states = [
            {
              state_id: 'xhs-home-search',
              status: 'captured',
              finalUrl: 'https://www.xiaohongshu.com/search_result?keyword=%E7%A9%BF%E6%90%AD',
              pageType: 'search-results-page',
              trigger: { kind: 'search-form' },
              files: {},
            },
            {
              state_id: 'xhs-home-detail',
              status: 'captured',
              finalUrl: profile.validationSamples.videoDetailUrl,
              pageType: 'book-detail-page',
              trigger: { kind: 'content-link' },
              files: {},
            },
            {
              state_id: 'xhs-home-author',
              status: 'captured',
              finalUrl: profile.validationSamples.authorUrl,
              pageType: 'author-page',
              trigger: { kind: 'safe-nav-link' },
              files: {},
            },
          ];
        } else if (inputUrl === profile.validationSamples.authorVideosUrl) {
          states = [
            {
              state_id: 'xhs-author-home',
              status: 'initial',
              finalUrl: inputUrl,
              pageType: 'author-page',
              trigger: null,
              files: {},
            },
            {
              state_id: 'xhs-author-detail',
              status: 'captured',
              finalUrl: profile.validationSamples.videoDetailUrl,
              pageType: 'book-detail-page',
              trigger: { kind: 'content-link' },
              files: {},
            },
          ];
        } else if (inputUrl === profile.authValidationSamples.notificationUrl) {
          states = [
            {
              state_id: 'xhs-notification',
              status: 'initial',
              finalUrl: inputUrl,
              pageType: 'utility-page',
              pageFacts: {
                loginStateDetected: true,
                identityConfirmed: true,
                featuredContentCount: 0,
                featuredAuthorCount: 0,
              },
              trigger: null,
              files: {},
            },
          ];
        } else {
          throw new Error(`Unexpected scenario input: ${inputUrl}`);
        }

        return {
          outDir: path.join(workspace, 'expand'),
          summary: {
            capturedStates: states.length,
          },
          warnings: [],
          states,
        };
      },
    });

    assert.equal(loginBootstrapCalls.length, 1);
    assert.equal(loginBootstrapCalls[0].waitForManualLogin, false);
    assert.equal(loginBootstrapCalls[0].headless, false);
    assert.deepEqual(observedProbeUrls[0], {
      startupUrl: profile.authValidationSamples.notificationUrl,
      navigateUrl: profile.authValidationSamples.notificationUrl,
    });
    assert.deepEqual(observedRuns.map((entry) => entry.inputUrl), [
      'https://www.xiaohongshu.com/explore',
      profile.validationSamples.authorVideosUrl,
      profile.authValidationSamples.notificationUrl,
    ]);
    assert.equal(report.sessionReuseWorked, true);
    assert.equal(report.authSession?.bootstrapAttempted, true);
    assert.equal(report.authSession?.bootstrapStatus, 'session-reused');
    assert.equal(report.authSession?.bootstrapCredentialsSource, 'wincred:BrowserWikiSkill:xiaohongshu.com');
    assert.equal(report.authSession?.bootstrapPersistenceVerified, true);
    assert.equal(report.authSession?.bootstrapManualLoginRequired, false);
    assert.equal(report.authSession?.identityConfirmed, true);
    assert.equal(report.authSession?.currentUrl, profile.authValidationSamples.notificationUrl);
    assert.equal(report.scenarios.find((entry) => entry.id === 'notification-inbox')?.status, 'pass');
    assert.match(report.warnings.join('\n'), /Attempted xiaohongshu auth bootstrap via site-login; status=session-reused/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor prioritizes Xiaohongshu restriction-page risk and runs one visible-browser recovery attempt', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-xiaohongshu-risk-'));
  const profilePath = path.resolve('profiles/www.xiaohongshu.com.json');
  const profile = await readJsonFile(profilePath);
  const captureHeadlessModes = [];
  const keepaliveCalls = [];
  let captureCalls = 0;

  try {
    const report = await siteDoctor('https://www.xiaohongshu.com/explore', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
    }, {
      resolveSite: async () => ({ adapter: { id: 'xiaohongshu' } }),
      resolveSiteAuthProfile: async () => ({
        profile,
        warnings: [],
        filePath: profilePath,
      }),
      resolveSiteBrowserSessionOptions: async () => ({
        reuseLoginState: true,
        userDataDir: path.join(workspace, 'profiles', 'xiaohongshu.com'),
        cleanupUserDataDirOnShutdown: false,
        authConfig: {
          loginUrl: profile.authSession.loginUrl,
          postLoginUrl: profile.authSession.postLoginUrl,
          verificationUrl: profile.authSession.verificationUrl,
          keepaliveUrl: profile.authSession.keepaliveUrl,
          preferVisibleBrowserForAuthenticatedFlows: true,
        },
      }),
      runAuthenticatedKeepalivePreflight: async () => ({
        attempted: false,
        ran: false,
        reason: 'not-due',
      }),
      openBrowserSession: async () => ({
        async navigateAndWait() {},
        async close() {},
      }),
      ensureAuthenticatedSession: async () => null,
      inspectLoginState: async () => ({
        loggedIn: false,
        loginStateDetected: false,
        identityConfirmed: false,
        identitySource: null,
      }),
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async (_inputUrl, options) => {
        captureCalls += 1;
        captureHeadlessModes.push(options.headless);
        return {
          status: 'success',
          finalUrl: 'https://www.xiaohongshu.com/website-login/error?error_code=300012&redirectPath=%2Fexplore',
          title: '\u5b89\u5168\u9650\u5236',
          pageType: 'auth-page',
          pageFacts: {
            antiCrawlDetected: true,
            antiCrawlSignals: ['ip-risk', 'risk-control', 'verify'],
            antiCrawlReasonCode: 'anti-crawl-verify',
            riskPageDetected: true,
            riskPageCode: '300012',
            riskPageMessage: '\u8bf7\u5207\u6362\u53ef\u9760\u7f51\u7edc\u73af\u5883\u540e\u91cd\u8bd5',
            riskPageTitle: '\u5b89\u5168\u9650\u5236',
            redirectPath: '/explore',
          },
          runtimeEvidence: {
            antiCrawlDetected: true,
            antiCrawlSignals: ['ip-risk', 'risk-control', 'verify'],
            antiCrawlReasonCode: 'anti-crawl-verify',
            networkRiskDetected: true,
            noDedicatedIpRiskDetected: true,
          },
          files: {
            manifest: path.join(options.outDir, `manifest-${captureCalls}.json`),
          },
          error: null,
        };
      },
      expandStates: async () => {
        throw new Error('expandStates should not run while Xiaohongshu is still on the restriction page');
      },
      siteLogin: async () => ({
        auth: {
          status: 'credentials-unavailable',
          loginStateDetected: false,
          identityConfirmed: false,
          identitySource: null,
          currentUrl: profile.authSession.loginUrl,
          title: 'Sign in - Xiaohongshu',
          persistenceVerified: false,
          waitedForManualLogin: false,
          credentialsSource: null,
          networkIdentityFingerprint: null,
          profileQuarantined: false,
        },
        reports: {
          json: path.join(workspace, 'site-login', 'report.json'),
          markdown: path.join(workspace, 'site-login', 'report.md'),
        },
      }),
      siteKeepalive: async (_inputUrl, options) => {
        keepaliveCalls.push(options);
        return {
          keepalive: {
            status: 'kept-alive',
            networkIdentityFingerprint: 'deadbeefdeadbeef',
            warmupSummary: {
              attempted: true,
              completed: true,
              urls: [profile.authSession.keepaliveUrl],
            },
            sessionHealthSummary: {
              keepaliveDue: false,
              successfulKeepalives: 2,
            },
          },
          loginReport: {
            auth: {
              warmupSummary: {
                attempted: true,
                completed: true,
                urls: [profile.authSession.keepaliveUrl],
              },
            },
          },
          reports: {
            json: path.join(workspace, 'keepalive', 'report.json'),
            markdown: path.join(workspace, 'keepalive', 'report.md'),
          },
        };
      },
    });

    assert.equal(captureCalls, 2);
    assert.deepEqual(captureHeadlessModes, [false, false]);
    assert.equal(keepaliveCalls.length, 1);
    assert.equal(keepaliveCalls[0].headless, false);
    assert.equal(keepaliveCalls[0].reuseLoginState, true);
    assert.equal(report.capture.status, 'pass');
    assert.equal(report.capture.details?.initialRestrictionDetected, true);
    assert.equal(report.capture.details?.restrictionDetected, true);
    assert.equal(report.capture.details?.initialRiskPageCode, '300012');
    assert.equal(report.capture.details?.recoveryAttempted, true);
    assert.equal(report.capture.details?.recoveryStatus, 'still-blocked');
    assert.deepEqual(report.antiCrawlSignals, ['ip-risk', 'risk-control', 'verify']);
    assert.equal(report.antiCrawlReasonCode, 'anti-crawl-verify');
    assert.equal(report.recoveryAttempted, true);
    assert.equal(report.recoveryStatus, 'still-blocked');
    assert.equal(report.riskCauseCode, 'browser-fingerprint-risk');
    assert.equal(report.riskAction, 'use-visible-browser-warmup');
    assert.equal(report.expand.status, 'skipped');
    assert.equal(report.search.status, 'fail');
    assert.equal(report.detail.status, 'fail');
    assert.equal(report.author?.status, 'fail');
    assert.equal(report.scenarios.find((entry) => entry.id === 'home-search-note-detail-author')?.riskCauseCode, 'browser-fingerprint-risk');
    assert.equal(report.scenarios.find((entry) => entry.id === 'author-notes-to-detail')?.riskAction, 'use-visible-browser-warmup');
    assert.equal(report.scenarios.find((entry) => entry.id === 'notification-inbox')?.reasonCode, 'not-logged-in');
    assert.match(report.warnings.join('\n'), /capture succeeded on restriction page/i);
    assert.match(report.nextActions.join('\n'), /visible browser/i);
    assert.match(report.nextActions.join('\n'), /reliable network identity/i);
    assert.doesNotMatch(report.nextActions.join('\n'), /Update search selectors/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor skips only the missing bilibili scenario sample', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-bilibili-missing-sample-'));
  const profile = await readJsonFile(path.resolve('profiles/www.bilibili.com.json'));
  delete profile.validationSamples.bangumiDetailUrl;
  const profilePath = path.join(workspace, 'www.bilibili.com.json');

  await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');

  try {
    const report = await siteDoctor('https://www.bilibili.com/', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
    }, {
      resolveSite: async () => ({ adapter: { id: 'bilibili' } }),
      resolveSiteAuthProfile: async () => ({
        profile: await readJsonFile(profilePath),
        warnings: [],
        filePath: profilePath,
      }),
      resolveSiteBrowserSessionOptions: async () => ({
        reuseLoginState: true,
        userDataDir: path.join(workspace, 'profiles', 'bilibili.com'),
        cleanupUserDataDirOnShutdown: false,
        authConfig: {
          loginUrl: 'https://passport.bilibili.com/login',
          postLoginUrl: 'https://www.bilibili.com/',
        },
      }),
      openBrowserSession: async () => ({
        async navigateAndWait() {},
        async close() {},
      }),
      inspectLoginState: async () => ({
        loggedIn: false,
        loginStateDetected: false,
        identityConfirmed: false,
        identitySource: null,
      }),
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async () => ({
        status: 'success',
        finalUrl: 'https://www.bilibili.com/',
        files: {
          manifest: path.join(workspace, 'capture', 'manifest.json'),
        },
        error: null,
      }),
      expandStates: async (inputUrl, _options) => {
        const stateMap = {
          'https://www.bilibili.com/': [
            {
              state_id: 's0001',
              status: 'captured',
              finalUrl: 'https://search.bilibili.com/video?keyword=BV1WjDDBGE3p',
              pageType: 'search-results-page',
              trigger: { kind: 'search-form' },
              files: {},
            },
            {
              state_id: 's0002',
              status: 'captured',
              finalUrl: 'https://www.bilibili.com/video/BV1WjDDBGE3p',
              pageType: 'book-detail-page',
              trigger: { kind: 'content-link' },
              files: {},
            },
            {
              state_id: 's0003',
              status: 'captured',
              finalUrl: 'https://space.bilibili.com/1202350411',
              pageType: 'author-page',
              trigger: { kind: 'safe-nav-link' },
              files: {},
            },
          ],
          'https://www.bilibili.com/v/popular/all/': [
            {
              state_id: 'c0001',
              status: 'captured',
              finalUrl: 'https://www.bilibili.com/video/BV1WjDDBGE3p',
              pageType: 'book-detail-page',
              trigger: { kind: 'content-link' },
              files: {},
            },
          ],
          'https://space.bilibili.com/1202350411/video': [
            {
              state_id: 'a0001',
              status: 'captured',
              finalUrl: 'https://www.bilibili.com/video/BV1uT41147VW',
              pageType: 'book-detail-page',
              trigger: { kind: 'content-link' },
              files: {},
            },
          ],
          'https://space.bilibili.com/1202350411/dynamic': [
            {
              state_id: 'd0001',
              status: 'captured',
              finalUrl: 'https://space.bilibili.com/1202350411/dynamic',
              pageType: 'author-list-page',
              pageFacts: { authorSubpage: 'dynamic' },
              trigger: null,
              files: {},
            },
          ],
        };
        return {
          outDir: path.join(workspace, 'expand'),
          summary: {
            capturedStates: stateMap[inputUrl]?.length ?? 0,
          },
          warnings: [],
          states: stateMap[inputUrl] ?? [],
        };
      },
    });

    const bangumiScenario = report.scenarios.find((entry) => entry.id === 'bangumi-detail');
    const followScenario = report.scenarios.find((entry) => entry.id === 'author-follow-list');
    const fansScenario = report.scenarios.find((entry) => entry.id === 'author-fans-list');
    assert.equal(bangumiScenario?.status, 'skipped');
    assert.equal(bangumiScenario?.expectedSemanticPageType, 'content-detail-page');
    assert.match(bangumiScenario?.note ?? '', /Expected to validate content-detail-page/u);
    assert.match(bangumiScenario?.error?.message ?? '', /Missing profile\.validationSamples\.bangumiDetailUrl/u);
    assert.equal(followScenario?.status, 'skipped');
    assert.equal(followScenario?.reasonCode, 'not-logged-in');
    assert.equal(followScenario?.authRequired, true);
    assert.match(followScenario?.error?.message ?? '', /Reusable bilibili login state is unavailable/u);
    assert.equal(fansScenario?.status, 'skipped');
    assert.equal(fansScenario?.reasonCode, 'not-logged-in');
    assert.equal(report.sessionReuseWorked, false);
    assert.match(report.warnings.join('\n'), /Skipped bilibili scenario bangumi-detail/u);
    assert.match(report.warnings.join('\n'), /No reusable logged-in bilibili session was detected/u);
    assert.ok(report.scenarios.filter((entry) => !['bangumi-detail', 'author-dynamic-feed', 'author-follow-list', 'author-fans-list'].includes(entry.id)).every((entry) => entry.status === 'pass'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor markdown reports reusable bilibili auth session details', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-auth-session-'));
  const profilePath = path.resolve('profiles/www.bilibili.com.json');

  try {
    const report = await siteDoctor('https://www.bilibili.com/', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
    }, {
      resolveSite: async () => ({ adapter: { id: 'bilibili' } }),
      resolveSiteAuthProfile: async () => ({
        profile: await readJsonFile(profilePath),
        warnings: [],
        filePath: profilePath,
      }),
      resolveSiteBrowserSessionOptions: async () => ({
        reuseLoginState: true,
        userDataDir: path.join(workspace, 'profiles', 'bilibili.com'),
        cleanupUserDataDirOnShutdown: false,
        authConfig: {
          loginUrl: 'https://passport.bilibili.com/login',
          postLoginUrl: 'https://www.bilibili.com/',
        },
      }),
      openBrowserSession: async () => ({
        async navigateAndWait() {},
        async close() {},
      }),
      inspectLoginState: async () => ({
        loggedIn: true,
        loginStateDetected: true,
        identityConfirmed: true,
        identitySource: 'selector:.header-entry-mini img',
        currentUrl: 'https://space.bilibili.com/1202350411/dynamic',
        title: '君在西安个人动态-哔哩哔哩视频',
      }),
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async () => ({
        status: 'success',
        finalUrl: 'https://www.bilibili.com/',
        files: {
          manifest: path.join(workspace, 'capture', 'manifest.json'),
        },
        error: null,
      }),
      expandStates: async () => ({
        outDir: path.join(workspace, 'expand'),
        summary: { capturedStates: 0 },
        warnings: [],
        states: [],
      }),
    });

    const markdown = await readFile(report.reports.markdown, 'utf8');
    assert.equal(report.sessionReuseWorked, true);
    assert.equal(report.authSession?.identitySource, 'selector:.header-entry-mini img');
    assert.match(markdown, /## Auth Session/u);
    assert.match(markdown, /Session reuse worked: yes/u);
    assert.match(markdown, /Login state detected: yes/u);
    assert.match(markdown, /Identity confirmed: yes/u);
    assert.match(markdown, /Current URL: https:\/\/space\.bilibili\.com\/1202350411\/dynamic/u);
    assert.match(markdown, /Network identity fingerprint: [0-9a-f]{16}/u);
    assert.match(markdown, /Risk cause code: none/u);
    assert.match(markdown, /Risk action: none/u);
    assert.match(markdown, /Profile quarantined: no/u);
    assert.match(markdown, /## Risk Governance/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor probes reusable auth for X and skips authenticated X scenarios when unavailable', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-x-auth-'));
  const profilePath = path.resolve('profiles/x.com.json');
  const profile = await readJsonFile(profilePath);

  try {
    const report = await siteDoctor('https://x.com/home', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
    }, {
      resolveSite: async () => ({ adapter: { id: 'x' }, host: 'x.com' }),
      resolveSiteAuthProfile: async () => ({
        profile,
        warnings: [],
        filePath: profilePath,
      }),
      resolveSiteBrowserSessionOptions: async () => ({
        reuseLoginState: true,
        userDataDir: path.join(workspace, 'profiles', 'x.com'),
        cleanupUserDataDirOnShutdown: false,
        authConfig: {
          loginUrl: 'https://x.com/i/flow/login',
          postLoginUrl: 'https://x.com/home',
          verificationUrl: 'https://x.com/home',
        },
      }),
      runAuthenticatedKeepalivePreflight: async () => ({
        attempted: true,
        ran: false,
        reason: 'not-due',
        thresholdMinutes: null,
        sessionHealthSummary: null,
        sessionHealthSummaryAfter: null,
        keepaliveReport: null,
      }),
      openBrowserSession: async () => ({
        async navigateAndWait() {},
        async close() {},
      }),
      inspectLoginState: async () => ({
        loggedIn: false,
        loginStateDetected: false,
        identityConfirmed: false,
        identitySource: null,
        currentUrl: 'https://x.com/i/flow/login',
        title: 'X',
      }),
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async () => ({
        status: 'success',
        finalUrl: 'https://x.com/home',
        files: {
          manifest: path.join(workspace, 'capture', 'manifest.json'),
        },
        error: null,
      }),
      expandStates: async () => ({
        outDir: path.join(workspace, 'expand'),
        summary: { capturedStates: 0 },
        warnings: [],
        states: [],
      }),
    });

    assert.equal(report.authSession?.loginStateDetected, false);
    assert.equal(report.authSession?.identityConfirmed, false);
    assert.equal(report.sessionReuseWorked, false);
    assert.equal(report.scenarios.find((entry) => entry.id === 'search-latest')?.status, 'skipped');
    assert.equal(report.scenarios.find((entry) => entry.id === 'search-latest')?.reasonCode, 'not-logged-in');
    assert.match(report.warnings.join('\n'), /No reusable logged-in x session was detected/u);
    assert.match(report.nextActions.join('\n'), /site-login/u);
    assert.match(report.nextActions.join('\n'), /BWS_X_USER_DATA_DIR/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor reports the X scenario matrix from profile samples', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-x-scenarios-'));
  const profilePath = path.resolve('profiles/x.com.json');
  const profile = await readJsonFile(profilePath);
  const expandedInputs = [];
  const stateForXUrl = (url, index = 0) => {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase().replace(/\/+$/u, '') || '/';
    let pageType = 'author-page';
    if (pathname === '/search') {
      pageType = 'search-results-page';
    } else if (pathname === '/home') {
      pageType = 'home';
    } else if (pathname === '/explore') {
      pageType = 'category-page';
    } else if (pathname.includes('/status/')) {
      pageType = 'book-detail-page';
    } else if (pathname === '/notifications' || pathname === '/i/bookmarks' || pathname.endsWith('/following') || pathname.endsWith('/followers')) {
      pageType = 'author-list-page';
    }
    return {
      state_id: `x-state-${index}`,
      status: 'captured',
      finalUrl: url,
      pageType,
      files: {},
      pageFacts: {
        featuredContentCount: pageType === 'book-detail-page' || pageType === 'search-results-page' || pageType === 'author-page' ? 1 : 0,
        featuredAuthorCount: pageType === 'author-list-page' || pageType === 'author-page' ? 1 : 0,
        antiCrawlSignals: [],
      },
    };
  };

  try {
    const report = await siteDoctor('https://x.com/home', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
    }, {
      resolveSite: async () => ({ adapter: { id: 'x' }, host: 'x.com' }),
      resolveSiteAuthProfile: async () => ({
        profile,
        warnings: [],
        filePath: profilePath,
      }),
      resolveSiteBrowserSessionOptions: async () => ({
        reuseLoginState: true,
        userDataDir: path.join(workspace, 'profiles', 'x.com'),
        cleanupUserDataDirOnShutdown: false,
        authConfig: {
          loginUrl: profile.authSession.loginUrl,
          postLoginUrl: profile.authSession.postLoginUrl,
          verificationUrl: profile.authSession.verificationUrl,
        },
      }),
      runAuthenticatedKeepalivePreflight: async () => ({
        attempted: true,
        ran: false,
        reason: 'not-due',
        thresholdMinutes: null,
        sessionHealthSummary: null,
        sessionHealthSummaryAfter: null,
        keepaliveReport: null,
      }),
      openBrowserSession: async () => ({
        async navigateAndWait() {},
        async close() {},
      }),
      inspectLoginState: async () => ({
        loggedIn: true,
        loginStateDetected: true,
        identityConfirmed: true,
        identitySource: 'selector',
        currentUrl: 'https://x.com/home',
        title: 'X',
      }),
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async () => ({
        status: 'success',
        finalUrl: 'https://x.com/home',
        files: {
          manifest: path.join(workspace, 'capture', 'manifest.json'),
        },
        error: null,
      }),
      expandStates: async (inputUrl) => {
        expandedInputs.push(inputUrl);
        const states = inputUrl === 'https://x.com/home'
          ? [
              stateForXUrl('https://x.com/home', 0),
              stateForXUrl(profile.authValidationSamples.searchLatestUrl, 1),
              stateForXUrl(profile.validationSamples.videoDetailUrl, 2),
              stateForXUrl(profile.validationSamples.authorUrl, 3),
            ]
          : [stateForXUrl(inputUrl, expandedInputs.length + 10)];
        return {
          outDir: path.join(workspace, 'expand'),
          summary: { capturedStates: states.length },
          warnings: [],
          states,
        };
      },
    });

    assert.equal(report.scenarios.find((entry) => entry.id === 'home-search-post-detail-author')?.status, 'pass');
    assert.equal(report.scenarios.find((entry) => entry.id === 'public-post-detail')?.status, 'pass');
    assert.equal(report.scenarios.find((entry) => entry.id === 'public-author-posts')?.status, 'pass');
    assert.equal(report.scenarios.find((entry) => entry.id === 'category-explore')?.status, 'pass');
    assert.equal(report.scenarios.find((entry) => entry.id === 'home-auth')?.status, 'pass');
    assert.equal(report.scenarios.find((entry) => entry.id === 'search-latest')?.status, 'pass');
    assert.equal(report.scenarios.find((entry) => entry.id === 'notifications')?.authRequired, true);
    assert.equal(report.scenarios.find((entry) => entry.id === 'bookmarks')?.status, 'pass');
    assert.equal(expandedInputs.includes(profile.authValidationSamples.authorFollowingUrl), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor reports the Instagram scenario matrix from profile samples', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-instagram-scenarios-'));
  const profilePath = path.resolve('profiles/www.instagram.com.json');
  const profile = await readJsonFile(profilePath);
  const expandedInputs = [];
  const stateForInstagramUrl = (url, index = 0) => {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase().replace(/\/+$/u, '') || '/';
    let pageType = 'author-page';
    if (pathname.startsWith('/explore/search')) {
      pageType = 'search-results-page';
    } else if (pathname === '/explore') {
      pageType = 'category-page';
    } else if (pathname.startsWith('/p/') || pathname.startsWith('/reel/') || pathname.startsWith('/tv/')) {
      pageType = 'book-detail-page';
    } else if (pathname.startsWith('/direct') || pathname.endsWith('/following') || pathname.endsWith('/followers')) {
      pageType = 'author-list-page';
    }
    return {
      state_id: `ig-state-${index}`,
      status: 'captured',
      finalUrl: url,
      pageType,
      files: {},
      pageFacts: {
        featuredContentCount: pageType === 'book-detail-page' || pageType === 'search-results-page' || pageType === 'author-page' ? 1 : 0,
        featuredAuthorCount: pageType === 'author-list-page' || pageType === 'author-page' ? 1 : 0,
        antiCrawlSignals: [],
      },
    };
  };

  try {
    const report = await siteDoctor('https://www.instagram.com/', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
    }, {
      resolveSite: async () => ({ adapter: { id: 'instagram' }, host: 'www.instagram.com' }),
      resolveSiteAuthProfile: async () => ({
        profile,
        warnings: [],
        filePath: profilePath,
      }),
      resolveSiteBrowserSessionOptions: async () => ({
        reuseLoginState: true,
        userDataDir: path.join(workspace, 'profiles', 'www.instagram.com'),
        cleanupUserDataDirOnShutdown: false,
        authConfig: {
          loginUrl: profile.authSession.loginUrl,
          postLoginUrl: profile.authSession.postLoginUrl,
          verificationUrl: profile.authSession.verificationUrl,
        },
      }),
      runAuthenticatedKeepalivePreflight: async () => ({
        attempted: true,
        ran: false,
        reason: 'not-due',
        thresholdMinutes: null,
        sessionHealthSummary: null,
        sessionHealthSummaryAfter: null,
        keepaliveReport: null,
      }),
      openBrowserSession: async () => ({
        async navigateAndWait() {},
        async close() {},
      }),
      inspectLoginState: async () => ({
        loggedIn: true,
        loginStateDetected: true,
        identityConfirmed: true,
        identitySource: 'selector',
        currentUrl: 'https://www.instagram.com/',
        title: 'Instagram',
      }),
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async () => ({
        status: 'success',
        finalUrl: 'https://www.instagram.com/',
        files: {
          manifest: path.join(workspace, 'capture', 'manifest.json'),
        },
        error: null,
      }),
      expandStates: async (inputUrl) => {
        expandedInputs.push(inputUrl);
        const states = inputUrl === 'https://www.instagram.com/'
          ? [
              stateForInstagramUrl(profile.authValidationSamples.searchUrl, 1),
              stateForInstagramUrl(profile.validationSamples.videoDetailUrl, 2),
              stateForInstagramUrl(profile.validationSamples.authorUrl, 3),
            ]
          : [stateForInstagramUrl(inputUrl, expandedInputs.length + 10)];
        return {
          outDir: path.join(workspace, 'expand'),
          summary: { capturedStates: states.length },
          warnings: [],
          states,
        };
      },
    });

    assert.equal(report.scenarios.find((entry) => entry.id === 'home-search-post-detail-profile')?.status, 'pass');
    assert.equal(report.scenarios.find((entry) => entry.id === 'public-post-detail')?.status, 'pass');
    assert.equal(report.scenarios.find((entry) => entry.id === 'public-profile-posts')?.status, 'pass');
    assert.equal(report.scenarios.find((entry) => entry.id === 'profile-reels')?.status, 'pass');
    assert.equal(report.scenarios.find((entry) => entry.id === 'category-explore')?.status, 'pass');
    assert.equal(report.scenarios.find((entry) => entry.id === 'search')?.authRequired, true);
    assert.equal(report.scenarios.find((entry) => entry.id === 'direct-inbox')?.status, 'pass');
    assert.equal(expandedInputs.includes(profile.authValidationSamples.authorFollowersUrl), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor includes keepalive preflight and session health details in auth session reporting', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-keepalive-preflight-'));
  const profilePath = path.resolve('profiles/www.bilibili.com.json');

  try {
    const report = await siteDoctor('https://www.bilibili.com/', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
    }, {
      resolveSite: async () => ({ adapter: { id: 'bilibili' } }),
      resolveSiteAuthProfile: async () => ({
        profile: await readJsonFile(profilePath),
        warnings: [],
        filePath: profilePath,
      }),
      resolveSiteBrowserSessionOptions: async () => ({
        reuseLoginState: true,
        userDataDir: path.join(workspace, 'profiles', 'bilibili.com'),
        cleanupUserDataDirOnShutdown: false,
        authConfig: {
          loginUrl: 'https://passport.bilibili.com/login',
          postLoginUrl: 'https://www.bilibili.com/',
        },
      }),
      runAuthenticatedKeepalivePreflight: async () => ({
        attempted: true,
        ran: true,
        trigger: 'keepalive-window',
        reason: 'within-preflight-threshold',
        thresholdMinutes: 15,
        sessionHealthSummaryAfter: {
          lastHealthyAt: '2026-04-18T14:37:39.248Z',
          nextSuggestedKeepaliveAt: '2026-04-18T16:37:39.248Z',
          keepaliveDue: false,
          successfulKeepalives: 2,
        },
        keepaliveReport: {
          keepalive: {
            status: 'kept-alive',
          },
        },
      }),
      openBrowserSession: async () => ({
        async navigateAndWait() {},
        async close() {},
      }),
      inspectLoginState: async () => ({
        loggedIn: true,
        loginStateDetected: true,
        identityConfirmed: true,
        identitySource: 'selector:.header-entry-mini img',
        currentUrl: 'https://space.bilibili.com/1202350411/dynamic',
        title: 'dynamic',
      }),
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async () => ({
        status: 'success',
        finalUrl: 'https://www.bilibili.com/',
        files: {
          manifest: path.join(workspace, 'capture', 'manifest.json'),
        },
        error: null,
      }),
      expandStates: async () => ({
        outDir: path.join(workspace, 'expand'),
        summary: { capturedStates: 0 },
        warnings: [],
        states: [],
      }),
    });

    const markdown = await readFile(report.reports.markdown, 'utf8');
    assert.equal(report.authSession?.keepalivePreflight?.ran, true);
    assert.equal(report.authSession?.keepalivePreflight?.status, 'kept-alive');
    assert.equal(report.authSession?.sessionHealthSummary?.successfulKeepalives, 2);
    assert.match(report.warnings.join('\n'), /Ran bilibili keepalive preflight/u);
    assert.match(markdown, /Keepalive preflight: ran/u);
    assert.match(markdown, /Keepalive preflight trigger: keepalive-window/u);
    assert.match(markdown, /Keepalive preflight status: kept-alive/u);
    assert.match(markdown, /Last healthy at: 2026-04-18T14:37:39.248Z/u);
    assert.match(markdown, /Next suggested keepalive at: 2026-04-18T16:37:39.248Z/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor skips authenticated bilibili scenarios when the auth probe itself fails', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-auth-probe-fail-'));
  const profilePath = path.resolve('profiles/www.bilibili.com.json');

  try {
    const report = await siteDoctor('https://www.bilibili.com/', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
    }, {
      resolveSite: async () => ({ adapter: { id: 'bilibili' } }),
      resolveSiteAuthProfile: async () => ({
        profile: await readJsonFile(profilePath),
        warnings: [],
        filePath: profilePath,
      }),
      resolveSiteBrowserSessionOptions: async () => ({
        reuseLoginState: true,
        userDataDir: path.join(workspace, 'profiles', 'bilibili.com'),
        cleanupUserDataDirOnShutdown: false,
        authConfig: {
          loginUrl: 'https://passport.bilibili.com/login',
          postLoginUrl: 'https://www.bilibili.com/',
        },
      }),
      openBrowserSession: async () => {
        throw new Error('attach timeout');
      },
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async () => ({
        status: 'success',
        finalUrl: 'https://www.bilibili.com/',
        files: {
          manifest: path.join(workspace, 'capture', 'manifest.json'),
        },
        error: null,
      }),
      expandStates: async (inputUrl) => ({
        outDir: path.join(workspace, 'expand'),
        summary: { capturedStates: inputUrl === 'https://www.bilibili.com/' ? 3 : 0 },
        warnings: [],
        states: inputUrl === 'https://www.bilibili.com/' ? [
          {
            state_id: 's0001',
            status: 'captured',
            finalUrl: 'https://search.bilibili.com/video?keyword=BV1WjDDBGE3p',
            pageType: 'search-results-page',
            trigger: { kind: 'search-form' },
            files: {},
          },
          {
            state_id: 's0002',
            status: 'captured',
            finalUrl: 'https://www.bilibili.com/video/BV1WjDDBGE3p',
            pageType: 'book-detail-page',
            trigger: { kind: 'content-link' },
            files: {},
          },
          {
            state_id: 's0003',
            status: 'captured',
            finalUrl: 'https://space.bilibili.com/1202350411',
            pageType: 'author-page',
            trigger: { kind: 'safe-nav-link' },
            files: {},
          },
        ] : [],
      }),
    });

    const followScenario = report.scenarios.find((entry) => entry.id === 'author-follow-list');
    const fansScenario = report.scenarios.find((entry) => entry.id === 'author-fans-list');
    assert.equal(report.sessionReuseWorked, false);
    assert.equal(report.authSession?.probeFailed, true);
    assert.match(String(report.authSession?.probeError ?? ''), /attach timeout/u);
    assert.equal(followScenario?.status, 'skipped');
    assert.equal(followScenario?.reasonCode, 'not-logged-in');
    assert.equal(fansScenario?.status, 'skipped');
    assert.equal(fansScenario?.reasonCode, 'not-logged-in');
    assert.match(report.warnings.join('\n'), /Could not probe reusable bilibili login state: attach timeout/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor diagnoses empty bilibili authenticated surfaces as empty-shell', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-bilibili-empty-shell-'));
  const profilePath = path.resolve('profiles/www.bilibili.com.json');

  try {
    const report = await siteDoctor('https://www.bilibili.com/', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
    }, {
      resolveSite: async () => ({ adapter: { id: 'bilibili' } }),
      resolveSiteAuthProfile: async () => ({
        profile: await readJsonFile(profilePath),
        warnings: [],
        filePath: profilePath,
      }),
      resolveSiteBrowserSessionOptions: async () => ({
        reuseLoginState: true,
        userDataDir: path.join(workspace, 'profiles', 'bilibili.com'),
        cleanupUserDataDirOnShutdown: false,
        authConfig: {
          loginUrl: 'https://passport.bilibili.com/login',
          postLoginUrl: 'https://www.bilibili.com/',
        },
      }),
      openBrowserSession: async () => ({
        async navigateAndWait() {},
        async close() {},
      }),
      inspectLoginState: async () => ({
        loggedIn: true,
        loginStateDetected: true,
        identityConfirmed: true,
        identitySource: 'selector:.bili-avatar img',
      }),
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async () => ({
        status: 'success',
        finalUrl: 'https://www.bilibili.com/',
        files: {
          manifest: path.join(workspace, 'capture', 'manifest.json'),
        },
        error: null,
      }),
      expandStates: async (inputUrl) => {
        const baseState = {
          status: 'initial',
          trigger: null,
          files: {},
        };
        if (inputUrl === 'https://space.bilibili.com/1202350411/fans/follow') {
          return {
            outDir: path.join(workspace, 'expand-follow'),
            summary: { capturedStates: 1 },
            warnings: [],
            states: [{
              ...baseState,
              state_id: 'follow-empty',
              finalUrl: inputUrl,
              pageType: 'author-list-page',
              pageFacts: {
                authorSubpage: 'follow',
                loginStateDetected: true,
                identityConfirmed: true,
                featuredAuthorCount: 0,
                featuredContentCount: 0,
              },
            }],
          };
        }
        return {
          outDir: path.join(workspace, 'expand-generic'),
          summary: { capturedStates: 1 },
          warnings: [],
          states: [{
            ...baseState,
            state_id: `state-${Buffer.from(inputUrl).toString('hex').slice(0, 6)}`,
            finalUrl: inputUrl,
            pageType: inputUrl.includes('/bangumi/play/')
              ? 'book-detail-page'
              : inputUrl.includes('/video') && inputUrl.includes('space.bilibili.com')
                ? 'author-list-page'
                : inputUrl.includes('/video/')
                  ? 'book-detail-page'
                  : inputUrl.includes('/v/popular')
                    ? 'category-page'
                    : inputUrl.includes('/dynamic')
                      ? 'author-list-page'
                      : 'author-page',
            pageFacts: inputUrl.includes('/dynamic')
              ? { authorSubpage: 'dynamic', loginStateDetected: true, identityConfirmed: true, featuredContentCount: 1 }
              : inputUrl.includes('space.bilibili.com') && inputUrl.includes('/video')
                ? { authorSubpage: 'video', featuredContentCount: 1 }
                : {},
          }],
        };
      },
      pathExists: async () => true,
      readJsonFile: async () => ({}),
    });

    const followScenario = report.scenarios.find((entry) => entry.id === 'author-follow-list');
    assert.equal(followScenario?.status, 'fail');
    assert.equal(followScenario?.reasonCode, 'empty-shell');
    assert.equal(followScenario?.emptyShell, true);
    assert.equal(followScenario?.featuredAuthorCount, 0);
    assert.equal(followScenario?.featuredContentCount, 0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('X and Instagram social docs include operational natural language command mappings', async () => {
  const [
    socialLiveVerification,
    xSkill,
    xNlIntents,
    xFlows,
    instagramSkill,
    instagramNlIntents,
    instagramFlows,
  ] = await Promise.all([
    readFile(path.resolve('docs/SOCIAL_LIVE_VERIFICATION.md'), 'utf8'),
    readFile(path.resolve('skills/x/SKILL.md'), 'utf8'),
    readFile(path.resolve('skills/x/references/nl-intents.md'), 'utf8'),
    readFile(path.resolve('skills/x/references/flows.md'), 'utf8'),
    readFile(path.resolve('skills/instagram/SKILL.md'), 'utf8'),
    readFile(path.resolve('skills/instagram/references/nl-intents.md'), 'utf8'),
    readFile(path.resolve('skills/instagram/references/flows.md'), 'utf8'),
  ]);

  for (const document of [
    socialLiveVerification,
    xSkill,
    xNlIntents,
    xFlows,
    instagramSkill,
    instagramNlIntents,
    instagramFlows,
  ]) {
    assert.match(document, /resume-full-archive/u);
    assert.match(document, /resume-after-cooldown/u);
    assert.match(document, /media-fast-download/u);
    assert.match(document, /health-check/u);
    assert.match(document, /live-acceptance-report/u);
    assert.match(document, /kb-refresh/u);
  }

  assert.match(xSkill, /node scripts\/social-live-verify\.mjs --live --execute --site x --x-account <handle>/u);
  assert.match(xSkill, /node scripts\/social-kb-refresh\.mjs --execute --site x --x-account <handle>/u);
  assert.match(instagramSkill, /node scripts\/social-live-verify\.mjs --live --execute --site instagram --ig-account <handle>/u);
  assert.match(instagramSkill, /node scripts\/social-kb-refresh\.mjs --execute --site instagram --ig-account <handle>/u);
  assert.match(socialLiveVerification, /Natural Language Trigger Guide/u);
  assert.match(socialLiveVerification, /KB 刷新/u);
});
