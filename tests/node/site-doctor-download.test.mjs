import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  siteDoctor,
  writeSiteDoctorReportArtifacts,
} from '../../src/entrypoints/sites/site-doctor.mjs';
import { REDACTION_PLACEHOLDER } from '../../src/domain/sessions/security-guard.mjs';
import { assertRepoMetadataUnchanged, captureRepoMetadataSnapshot, createSiteMetadataSandbox } from './helpers/site-metadata-sandbox.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');

test('site-doctor download preflight points at canonical internal python entrypoints', async () => {
  const source = await readFile(path.join(REPO_ROOT, 'src', 'entrypoints', 'sites', 'site-doctor.mjs'), 'utf8');
  assert.match(source, /src', 'sites', 'known-sites', 'bilibili', 'download', 'python', 'bilibili\.py'/u);
  assert.match(source, /src', 'sites', 'known-sites', 'chapter-content', 'download', 'python', 'book\.py'/u);
  assert.doesNotMatch(source, /download_bilibili\.py|download_book\.py/u);
});

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
  const repoMetadataSnapshot = await captureRepoMetadataSnapshot();
  const metadataSandbox = createSiteMetadataSandbox(workspace);

  try {
    const profilePath = path.join(workspace, 'videos.example.com.json');
    await writeFile(profilePath, `${JSON.stringify(createDownloadableNavigationProfile(), null, 2)}\n`, 'utf8');

    let observedDownloadCheck = null;
    const report = await siteDoctor('https://videos.example.com/', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
      checkDownload: true,
      siteMetadataOptions: metadataSandbox.siteMetadataOptions,
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
    assert.equal(report.reports.jsonRedactionAudit.endsWith('doctor-report.redaction-audit.json'), true);
    assert.equal(report.reports.markdownRedactionAudit.endsWith('doctor-report.md.redaction-audit.json'), true);
    const persistedReport = JSON.parse(await readFile(report.reports.json, 'utf8'));
    const persistedMarkdown = await readFile(report.reports.markdown, 'utf8');
    const persistedAudit = JSON.parse(await readFile(report.reports.jsonRedactionAudit, 'utf8'));
    assert.equal(report.site.profilePath, profilePath);
    assert.equal(persistedReport.site.profilePath, REDACTION_PLACEHOLDER);
    assert.equal(persistedReport.download.status, 'pass');
    assert.equal(persistedMarkdown.includes(profilePath), false);
    assert.equal(persistedAudit.redactedPaths.includes('site.profilePath'), true);
    await assertRepoMetadataUnchanged(repoMetadataSnapshot);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor reports missing download runtime dependencies with stable reasonCode', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-download-runtime-'));
  const repoMetadataSnapshot = await captureRepoMetadataSnapshot();
  const metadataSandbox = createSiteMetadataSandbox(workspace);

  try {
    const profilePath = path.join(workspace, 'videos.example.com.json');
    await writeFile(profilePath, `${JSON.stringify(createDownloadableNavigationProfile(), null, 2)}\n`, 'utf8');

    const report = await siteDoctor('https://videos.example.com/', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
      checkDownload: true,
      siteMetadataOptions: metadataSandbox.siteMetadataOptions,
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
            finalUrl: 'https://videos.example.com/video/BV1WjDDBGE3p/',
            pageType: 'book-detail-page',
            trigger: { kind: 'content-link' },
            files: {},
          },
        ],
      }),
      runProcess: async (command) => ({
        code: 1,
        error: `spawn ${command} ENOENT`,
        stdout: '',
        stderr: '',
      }),
      pathExists: async () => true,
      readJsonFile: async () => ({}),
    });

    assert.equal(report.download?.status, 'fail');
    assert.equal(report.download?.details?.reasonCode, 'runtime-dependency-missing');
    assert.match(report.download?.error?.message ?? '', /spawn pypy3 ENOENT/u);
    await assertRepoMetadataUnchanged(repoMetadataSnapshot);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor report writer fails closed before persistent report writes when redaction cannot complete', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-redaction-fail-'));
  const reportDir = path.join(workspace, 'report');
  const circularReport = {
    site: {
      url: 'https://videos.example.com/?access_token=synthetic-site-doctor-token',
      host: 'videos.example.com',
      profilePath: 'C:/Users/example/profiles/videos.example.com.json',
      archetype: 'navigation-catalog',
    },
    sample: null,
    profile: { status: 'pass' },
    crawler: { status: 'pass' },
    capture: { status: 'pass' },
    expand: { status: 'pass' },
    search: { status: 'pass' },
    detail: { status: 'pass' },
    download: {
      status: 'pass',
      details: {
        authPassthrough: {
          cookieFile: 'C:/Users/example/cookies.txt',
          sidecarPath: 'C:/Users/example/cookies.sidecar.json',
          userDataDir: 'C:/Users/example/profiles/videos',
          currentUrl: 'https://videos.example.com/?csrf_token=synthetic-site-doctor-csrf',
        },
      },
    },
    authSession: {
      networkIdentityFingerprint: 'synthetic-site-doctor-fingerprint',
      bootstrapCredentialsSource: 'Bearer synthetic-site-doctor-auth',
    },
    scenarios: [],
    warnings: [],
    missingFields: [],
    nextActions: [],
    reports: {},
  };
  circularReport.self = circularReport;

  try {
    await assert.rejects(
      () => writeSiteDoctorReportArtifacts(circularReport, {
        reportDir,
        jsonPath: path.join(reportDir, 'doctor-report.json'),
        jsonAuditPath: path.join(reportDir, 'doctor-report.redaction-audit.json'),
        markdownPath: path.join(reportDir, 'doctor-report.md'),
        markdownAuditPath: path.join(reportDir, 'doctor-report.md.redaction-audit.json'),
      }),
      (error) => {
        assert.equal(error.name, 'SiteDoctorReportRedactionFailure');
        assert.equal(error.reasonCode, 'redaction-failed');
        assert.equal(error.artifactWriteAllowed, false);
        assert.equal(JSON.stringify(error).includes('synthetic-site-doctor'), false);
        return true;
      },
    );
    await assert.rejects(
      () => readdir(reportDir),
      /ENOENT/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor report writer preserves existing artifacts when redaction fails closed', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-redaction-preserve-'));
  const reportDir = path.join(workspace, 'report');
  const paths = {
    jsonPath: path.join(reportDir, 'doctor-report.json'),
    jsonAuditPath: path.join(reportDir, 'doctor-report.redaction-audit.json'),
    markdownPath: path.join(reportDir, 'doctor-report.md'),
    markdownAuditPath: path.join(reportDir, 'doctor-report.md.redaction-audit.json'),
  };
  const sentinelFiles = [
    [paths.jsonPath, '{"status":"before"}\n'],
    [paths.jsonAuditPath, '{"audit":"before"}\n'],
    [paths.markdownPath, '# before\n'],
    [paths.markdownAuditPath, '{"markdownAudit":"before"}\n'],
  ];
  const circularReport = {
    site: {
      url: 'https://videos.example.com/?access_token=synthetic-site-doctor-token',
      profilePath: 'C:/Users/example/profiles/videos.example.com.json',
    },
    profile: { status: 'pass' },
    crawler: { status: 'pass' },
    capture: { status: 'pass' },
    expand: { status: 'pass' },
    scenarios: [],
    warnings: [],
    missingFields: [],
    nextActions: [],
    reports: {},
  };
  circularReport.self = circularReport;

  try {
    await mkdir(reportDir, { recursive: true });
    await Promise.all(sentinelFiles.map(([filePath, content]) => writeFile(filePath, content)));

    await assert.rejects(
      () => writeSiteDoctorReportArtifacts(circularReport, {
        reportDir,
        ...paths,
      }),
      (error) => {
        assert.equal(error.name, 'SiteDoctorReportRedactionFailure');
        assert.equal(error.reasonCode, 'redaction-failed');
        assert.equal(error.artifactWriteAllowed, false);
        assert.equal(JSON.stringify(error).includes('synthetic-site-doctor'), false);
        return true;
      },
    );

    for (const [filePath, content] of sentinelFiles) {
      assert.equal(await readFile(filePath, 'utf8'), content);
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor still runs download preflight when bilibili-style downloader-only samples are available without videoDetailUrl', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-download-sources-'));
  const repoMetadataSnapshot = await captureRepoMetadataSnapshot();
  const metadataSandbox = createSiteMetadataSandbox(workspace);

  try {
    const profilePath = path.join(workspace, 'videos.example.com.json');
    await writeFile(profilePath, `${JSON.stringify(createExpandedDownloadableNavigationProfile(), null, 2)}\n`, 'utf8');

    let observedDownloadCheck = null;
    const report = await siteDoctor('https://videos.example.com/', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
      checkDownload: true,
      siteMetadataOptions: metadataSandbox.siteMetadataOptions,
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
    await assertRepoMetadataUnchanged(repoMetadataSnapshot);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('site-doctor surfaces bilibili downloader login-state quality warnings without failing preflight', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-download-quality-'));
  const repoMetadataSnapshot = await captureRepoMetadataSnapshot();
  const metadataSandbox = createSiteMetadataSandbox(workspace);

  try {
    const profilePath = path.join(workspace, 'videos.example.com.json');
    await writeFile(profilePath, `${JSON.stringify(createExpandedDownloadableNavigationProfile(), null, 2)}\n`, 'utf8');

    const report = await siteDoctor('https://videos.example.com/', {
      profilePath,
      outDir: path.join(workspace, 'doctor'),
      checkDownload: true,
      siteMetadataOptions: metadataSandbox.siteMetadataOptions,
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
    await assertRepoMetadataUnchanged(repoMetadataSnapshot);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
