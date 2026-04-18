import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import { siteDoctor } from '../../scripts/site-doctor.mjs';

function createDownloadableNavigationProfile(host = 'videos.example.com') {
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
      contentDetailPrefixes: ['/video/'],
      authorPrefixes: ['/author/'],
      authorListExact: [],
      authorListPrefixes: ['/author/list'],
      authorDetailPrefixes: ['/author/'],
      chapterPrefixes: [],
      historyPrefixes: [],
      authPrefixes: ['/login'],
      categoryPrefixes: ['/category/'],
    },
    search: {
      formSelectors: ['form[action*="/search"]'],
      inputSelectors: ['input[name="q"]'],
      submitSelectors: ['button[type="submit"]'],
      resultTitleSelectors: ['title'],
      resultBookSelectors: ['a[href*="/video/"]'],
      knownQueries: [
        {
          query: 'BV1WjDDBGE3p',
          title: 'BV1WjDDBGE3p',
          url: `https://${host}/video/BV1WjDDBGE3p/`,
          authorName: 'example author',
        },
      ],
    },
    validationSamples: {
      videoSearchQuery: 'BV1WjDDBGE3p',
      videoDetailUrl: `https://${host}/video/BV1WjDDBGE3p/`,
      authorUrl: `https://${host}/author/1001/`,
      authorVideosUrl: `https://${host}/author/1001/video/`,
    },
    sampling: {
      searchResultContentLimit: 4,
      authorContentLimit: 10,
      categoryContentLimit: 10,
      fallbackContentLimitWithSearch: 8,
    },
    navigation: {
      allowedHosts: [host],
      contentPathPrefixes: ['/video/'],
      authorPathPrefixes: ['/author/'],
      authorListPathPrefixes: ['/author/list'],
      authorDetailPathPrefixes: ['/author/'],
      categoryPathPrefixes: ['/category/'],
      utilityPathPrefixes: ['/help'],
      authPathPrefixes: ['/login'],
      categoryLabelKeywords: ['VIDEO'],
    },
    contentDetail: {
      titleSelectors: ['h1'],
      authorNameSelectors: ['a[href*="/author/"]'],
      authorLinkSelectors: ['a[href*="/author/"]'],
    },
    author: {
      titleSelectors: ['h1'],
      workLinkSelectors: ['a[href*="/video/"]'],
    },
    downloader: {
      defaultOutputRoot: 'video-downloads',
      requiresLoginForHighestQuality: true,
      authorVideoListPathPrefixes: ['/video'],
      maxBatchItems: 5,
    },
  };
}

function createExpandedDownloadableNavigationProfile(host = 'videos.example.com') {
  const profile = createDownloadableNavigationProfile(host);
  return {
    ...profile,
    validationSamples: {
      ...profile.validationSamples,
      videoDetailUrl: undefined,
      collectionUrl: `https://${host}/collection/alpha/`,
      channelUrl: `https://${host}/channel/popular/`,
    },
    authValidationSamples: {
      dynamicUrl: `https://${host}/author/1001/dynamic/`,
      followListUrl: `https://${host}/author/1001/follow/`,
      fansListUrl: `https://${host}/author/1001/fans/`,
      favoriteListUrl: `https://${host}/favorites/1001/`,
      watchLaterUrl: `https://${host}/watchlater/`,
    },
    downloader: {
      ...profile.downloader,
      favoriteListPathPrefixes: ['/favorites'],
      watchLaterPathPrefixes: ['/watchlater'],
      collectionPathPrefixes: ['/collection'],
      channelPathPrefixes: ['/channel'],
    },
  };
}

test('site-doctor enables download preflight for navigation profiles with downloader config', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-download-'));

  try {
    const profilePath = path.join(workspace, 'videos.example.com.json');
    await writeFile(profilePath, `${JSON.stringify(createDownloadableNavigationProfile(), null, 2)}\n`, 'utf8');

    let observedDownloadCheck = null;
    const report = await siteDoctor('https://videos.example.com/', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
      checkDownload: true,
    }, {
      resolveSite: async () => ({ adapter: { id: 'generic-navigation' } }),
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async () => ({
        status: 'success',
        finalUrl: 'https://videos.example.com/',
        files: {
          manifest: path.join(workspace, 'capture', 'manifest.json'),
        },
      }),
      expandStates: async () => ({
        outDir: path.join(workspace, 'expand'),
        summary: { capturedStates: 2 },
        warnings: [],
        states: [
          {
            state_id: 's1',
            status: 'captured',
            finalUrl: 'https://videos.example.com/search?q=BV1WjDDBGE3p',
            pageType: 'search-results-page',
            trigger: { kind: 'search-form' },
            files: {},
          },
          {
            state_id: 's2',
            status: 'captured',
            finalUrl: 'https://videos.example.com/video/BV1WjDDBGE3p/',
            pageType: 'book-detail-page',
            trigger: { kind: 'content-link' },
            files: {},
          },
          {
            state_id: 's3',
            status: 'captured',
            finalUrl: 'https://videos.example.com/author/1001/',
            pageType: 'author-page',
            trigger: { kind: 'author-link' },
            files: {},
          },
        ],
      }),
      runDownloadCheck: async (_inputUrl, sample, _settings, siteProfile) => {
        observedDownloadCheck = {
          sample,
          siteProfile,
        };
        return { ok: true };
      },
      pathExists: async () => true,
      readJsonFile: async () => ({}),
    });

    assert.equal(report.download?.status, 'pass');
    assert.equal(observedDownloadCheck?.sample?.url, 'https://videos.example.com/video/BV1WjDDBGE3p/');
    assert.equal(observedDownloadCheck?.siteProfile?.downloader?.maxBatchItems, 5);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor still runs download preflight when bilibili-style downloader-only samples are available without videoDetailUrl', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-download-sources-'));

  try {
    const profilePath = path.join(workspace, 'videos.example.com.json');
    await writeFile(profilePath, `${JSON.stringify(createExpandedDownloadableNavigationProfile(), null, 2)}\n`, 'utf8');

    let observedDownloadCheck = null;
    const report = await siteDoctor('https://videos.example.com/', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
      checkDownload: true,
    }, {
      resolveSite: async () => ({ adapter: { id: 'generic-navigation' } }),
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async () => ({
        status: 'success',
        finalUrl: 'https://videos.example.com/',
        files: {
          manifest: path.join(workspace, 'capture', 'manifest.json'),
        },
      }),
      expandStates: async () => ({
        outDir: path.join(workspace, 'expand'),
        summary: { capturedStates: 1 },
        warnings: [],
        states: [
          {
            state_id: 's1',
            status: 'captured',
            finalUrl: 'https://videos.example.com/search?q=BV1WjDDBGE3p',
            pageType: 'search-results-page',
            trigger: { kind: 'search-form' },
            files: {},
          },
        ],
      }),
      runDownloadCheck: async (_inputUrl, sample, _settings, siteProfile) => {
        observedDownloadCheck = { sample, siteProfile };
        return {
          ok: true,
          details: {
            inputSources: ['favorite-list', 'watch-later', 'collection', 'channel'],
            filters: {
              includeKeywords: ['concert'],
              maxItems: 10,
            },
          },
        };
      },
      pathExists: async () => true,
      readJsonFile: async () => ({}),
    });

    assert.equal(report.download?.status, 'pass');
    assert.equal(observedDownloadCheck?.sample?.url ?? null, null);
    assert.deepEqual(report.download?.details?.inputSources, ['favorite-list', 'watch-later', 'collection', 'channel']);
    assert.deepEqual(report.download?.details?.filters, {
      includeKeywords: ['concert'],
      maxItems: 10,
    });
    assert.ok(!report.missingFields.includes('profile.validationSamples.videoDetailUrl'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor surfaces bilibili downloader login-state quality warnings without failing preflight', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-download-quality-'));

  try {
    const profilePath = path.join(workspace, 'videos.example.com.json');
    await writeFile(profilePath, `${JSON.stringify(createExpandedDownloadableNavigationProfile(), null, 2)}\n`, 'utf8');

    const report = await siteDoctor('https://videos.example.com/', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
      checkDownload: true,
    }, {
      resolveSite: async () => ({ adapter: { id: 'generic-navigation' } }),
      ensureCrawlerScript: async () => ({
        status: 'generated',
        scriptPath: path.join(workspace, 'crawler.py'),
        metaPath: path.join(workspace, 'crawler.meta.json'),
      }),
      capture: async () => ({
        status: 'success',
        finalUrl: 'https://videos.example.com/',
        files: {
          manifest: path.join(workspace, 'capture', 'manifest.json'),
        },
      }),
      expandStates: async () => ({
        outDir: path.join(workspace, 'expand'),
        summary: { capturedStates: 1 },
        warnings: [],
        states: [
          {
            state_id: 's1',
            status: 'captured',
            finalUrl: 'https://videos.example.com/search?q=BV1WjDDBGE3p',
            pageType: 'search-results-page',
            trigger: { kind: 'search-form' },
            files: {},
          },
        ],
      }),
      runDownloadCheck: async () => ({
        ok: true,
        warnings: ['Reusable login state is unavailable; highest available quality may be downgraded.'],
        details: {
          inputSources: ['author-video-list'],
          usedLoginState: false,
          reasonCodes: ['not-logged-in'],
          diagnostics: [{ inputKind: 'watch-later-list', reasonCode: 'not-logged-in', status: 'empty', antiCrawlSignals: [] }],
          qualityWarning: 'highest-quality-degraded',
        },
      }),
      pathExists: async () => true,
      readJsonFile: async () => ({}),
    });

    assert.equal(report.download?.status, 'pass');
    assert.deepEqual(report.download?.details, {
      inputSources: ['author-video-list'],
      usedLoginState: false,
      reasonCodes: ['not-logged-in'],
      diagnostics: [{ inputKind: 'watch-later-list', reasonCode: 'not-logged-in', status: 'empty', antiCrawlSignals: [] }],
      qualityWarning: 'highest-quality-degraded',
    });
    assert.match(report.warnings.join('\n'), /highest available quality may be downgraded/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
