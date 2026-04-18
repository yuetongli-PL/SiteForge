import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { pathExists, readJsonFile } from '../../lib/io.mjs';
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
    assert.deepEqual(report.authSession, {
      loginStateDetected: true,
      identityConfirmed: true,
      identitySource: 'selector:.bili-avatar img',
      currentUrl: null,
      title: null,
    });
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
