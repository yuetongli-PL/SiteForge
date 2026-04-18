import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import { ensureCrawlerScript } from '../../generate-crawler-script.mjs';
import {
  ProfileValidationError,
  validateProfileFile,
  validateProfileObject,
} from '../../lib/profile-validation.mjs';

function createNavigationProfile(overrides = {}) {
  return {
    host: 'example.com',
    archetype: 'navigation-catalog',
    schemaVersion: 1,
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
      resultTitleSelectors: ['title'],
      resultBookSelectors: ['a[href*="/works/detail/"]'],
      knownQueries: [],
    },
    sampling: {
      searchResultContentLimit: 4,
      authorContentLimit: 10,
      categoryContentLimit: 10,
      fallbackContentLimitWithSearch: 8,
    },
    navigation: {
      allowedHosts: ['example.com'],
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
    ...overrides,
  };
}

test('validateProfileFile accepts the checked-in profiles', async () => {
  const twentyTwoBiqu = await validateProfileFile(path.resolve('profiles/www.22biqu.com.json'));
  const moodyz = await validateProfileFile(path.resolve('profiles/moodyz.com.json'));
  const jable = await validateProfileFile(path.resolve('profiles/jable.tv.json'));
  const bilibili = await validateProfileFile(path.resolve('profiles/www.bilibili.com.json'));

  assert.equal(twentyTwoBiqu.valid, true);
  assert.equal(twentyTwoBiqu.host, 'www.22biqu.com');
  assert.equal(twentyTwoBiqu.archetype, 'chapter-content');
  assert.equal(moodyz.valid, true);
  assert.equal(moodyz.host, 'moodyz.com');
  assert.equal(moodyz.archetype, 'navigation-catalog');
  assert.equal(jable.valid, true);
  assert.equal(jable.host, 'jable.tv');
  assert.equal(jable.archetype, 'navigation-catalog');
  assert.equal(bilibili.valid, true);
  assert.equal(bilibili.host, 'www.bilibili.com');
  assert.equal(bilibili.archetype, 'navigation-catalog');
  assert.equal(bilibili.profile.pipeline.skipBookContent, true);
  assert.equal(bilibili.profile.validationSamples.videoSearchQuery, 'BV1WjDDBGE3p');
  assert.equal(bilibili.profile.validationSamples.authorDynamicUrl, 'https://space.bilibili.com/1202350411/dynamic');
  assert.equal(bilibili.profile.validationSamples.bangumiDetailUrl, 'https://www.bilibili.com/bangumi/play/ep508404');
  assert.equal(bilibili.profile.authValidationSamples.dynamicUrl, 'https://space.bilibili.com/1202350411/dynamic');
  assert.equal(bilibili.profile.authValidationSamples.followListUrl, 'https://space.bilibili.com/1202350411/fans/follow');
  assert.equal(bilibili.profile.authValidationSamples.fansListUrl, 'https://space.bilibili.com/1202350411/fans/fans');
  assert.equal(typeof bilibili.profile.validationSamples.collectionUrl, 'string');
  assert.equal(typeof bilibili.profile.validationSamples.channelUrl, 'string');
  assert.equal(typeof bilibili.profile.authValidationSamples.favoriteListUrl, 'string');
  assert.equal(typeof bilibili.profile.authValidationSamples.watchLaterUrl, 'string');
  assert.equal(bilibili.profile.authSession.loginUrl, 'https://passport.bilibili.com/login');
  assert.equal(bilibili.profile.authSession.reuseLoginStateByDefault, true);
  assert.equal(bilibili.profile.authSession.usernameEnv, 'BILIBILI_USERNAME');
  assert.ok(Array.isArray(bilibili.profile.downloader.favoriteListPathPrefixes));
  assert.ok(Array.isArray(bilibili.profile.downloader.watchLaterPathPrefixes));
  assert.ok(Array.isArray(bilibili.profile.downloader.collectionPathPrefixes));
  assert.ok(Array.isArray(bilibili.profile.downloader.channelPathPrefixes));
  assert.ok(bilibili.profile.downloader.favoriteListPathPrefixes.length > 0);
  assert.ok(bilibili.profile.downloader.watchLaterPathPrefixes.length > 0);
  assert.ok(bilibili.profile.downloader.collectionPathPrefixes.length > 0);
  assert.ok(bilibili.profile.downloader.channelPathPrefixes.length > 0);
});

test('validateProfileObject rejects missing required fields with path details', () => {
  assert.throws(() => validateProfileObject({
    host: 'moodyz.com',
    version: 2,
    pageTypes: {
      homeExact: ['/'],
      homePrefixes: [],
      searchResultsPrefixes: ['/search/list'],
      contentDetailPrefixes: ['/works/detail/'],
      authorPrefixes: ['/actress/detail/'],
      authorListExact: [],
      authorListPrefixes: [],
      authorDetailPrefixes: ['/actress/detail/'],
      chapterPrefixes: [],
      historyPrefixes: [],
      authPrefixes: [],
      categoryPrefixes: ['/works/date'],
    },
    search: {
      formSelectors: ['form[action*="/search/list"]'],
      inputSelectors: [],
      submitSelectors: ['button[type="submit"]'],
      resultTitleSelectors: ['title'],
      resultBookSelectors: ['a[href*="/works/detail/"]'],
      knownQueries: [],
    },
    sampling: {
      searchResultContentLimit: 4,
      authorContentLimit: 10,
      categoryContentLimit: 10,
      fallbackContentLimitWithSearch: 8,
    },
    navigation: {
      allowedHosts: ['moodyz.com'],
      contentPathPrefixes: ['/works/detail/'],
      authorPathPrefixes: ['/actress/detail/'],
      authorListPathPrefixes: [],
      authorDetailPathPrefixes: ['/actress/detail/'],
      categoryPathPrefixes: ['/works/date'],
      utilityPathPrefixes: ['/top'],
      authPathPrefixes: [],
      categoryLabelKeywords: ['WORKS'],
    },
    contentDetail: {
      titleSelectors: ['h2'],
      authorNameSelectors: ['a[href*="/actress/detail/"]'],
      authorLinkSelectors: ['a[href*="/actress/detail/"]'],
    },
    author: {
      titleSelectors: ['h2'],
    },
  }), (error) => {
    assert.ok(error instanceof ProfileValidationError);
    assert.match(error.message, /profile\.search\.inputSelectors: must contain at least 1 item\(s\)/);
    assert.match(error.message, /profile\.author\.workLinkSelectors: is required/);
    return true;
  });
});

test('validateProfileObject accepts a new navigation-catalog host without host-specific schema registration', () => {
  const result = validateProfileObject(createNavigationProfile(), {
    expectedHost: 'example.com',
    source: 'example.com.json',
  });

  assert.equal(result.valid, true);
  assert.equal(result.host, 'example.com');
  assert.equal(result.archetype, 'navigation-catalog');
  assert.equal(result.schemaId, 'profile/navigation-catalog/v1');
  assert.equal(result.profile.schemaVersion, 1);
});

test('validateProfileObject accepts expanded downloader source samples and path prefixes', () => {
  const result = validateProfileObject(createNavigationProfile({
    validationSamples: {
      videoSearchQuery: 'BV1WjDDBGE3p',
      videoDetailUrl: 'https://example.com/video/BV1WjDDBGE3p/',
      authorUrl: 'https://example.com/author/1001/',
      authorVideosUrl: 'https://example.com/author/1001/video/',
      collectionUrl: 'https://example.com/collection/55/',
      channelUrl: 'https://example.com/channel/77/',
    },
    authValidationSamples: {
      dynamicUrl: 'https://example.com/author/1001/dynamic/',
      followListUrl: 'https://example.com/author/1001/follow/',
      fansListUrl: 'https://example.com/author/1001/fans/',
      favoriteListUrl: 'https://example.com/favorites/1001/',
      watchLaterUrl: 'https://example.com/watchlater/',
    },
    downloader: {
      defaultOutputRoot: 'video-downloads',
      requiresLoginForHighestQuality: true,
      authorVideoListPathPrefixes: ['/video'],
      favoriteListPathPrefixes: ['/favorites'],
      watchLaterPathPrefixes: ['/watchlater'],
      collectionPathPrefixes: ['/collection'],
      channelPathPrefixes: ['/channel'],
      maxBatchItems: 20,
    },
  }), {
    expectedHost: 'example.com',
    source: 'example.com.json',
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.profile.downloader.favoriteListPathPrefixes, ['/favorites']);
  assert.deepEqual(result.profile.downloader.watchLaterPathPrefixes, ['/watchlater']);
  assert.deepEqual(result.profile.downloader.collectionPathPrefixes, ['/collection']);
  assert.deepEqual(result.profile.downloader.channelPathPrefixes, ['/channel']);
  assert.equal(result.profile.validationSamples.collectionUrl, 'https://example.com/collection/55/');
  assert.equal(result.profile.validationSamples.channelUrl, 'https://example.com/channel/77/');
  assert.equal(result.profile.authValidationSamples.favoriteListUrl, 'https://example.com/favorites/1001/');
  assert.equal(result.profile.authValidationSamples.watchLaterUrl, 'https://example.com/watchlater/');
});

test('validateProfileObject rejects empty expanded downloader source path arrays with stable field paths', () => {
  assert.throws(() => validateProfileObject(createNavigationProfile({
    validationSamples: {
      videoSearchQuery: 'BV1WjDDBGE3p',
      videoDetailUrl: 'https://example.com/video/BV1WjDDBGE3p/',
      collectionUrl: 'https://example.com/collection/55/',
      channelUrl: 'https://example.com/channel/77/',
    },
    authValidationSamples: {
      favoriteListUrl: 'https://example.com/favorites/1001/',
      watchLaterUrl: 'https://example.com/watchlater/',
    },
    downloader: {
      defaultOutputRoot: 'video-downloads',
      requiresLoginForHighestQuality: true,
      authorVideoListPathPrefixes: ['/video'],
      favoriteListPathPrefixes: [],
      watchLaterPathPrefixes: ['/watchlater'],
      collectionPathPrefixes: ['/collection'],
      channelPathPrefixes: ['/channel'],
      maxBatchItems: 20,
    },
  }), {
    expectedHost: 'example.com',
    source: 'example.com.json',
  }), (error) => {
    assert.ok(error instanceof ProfileValidationError);
    assert.match(error.message, /profile\.downloader\.favoriteListPathPrefixes: must contain at least 1 item\(s\)/u);
    return true;
  });
});

test('validateProfileObject keeps legacy host profiles compatible when archetype fields are missing', () => {
  const legacy = createNavigationProfile({
    host: 'moodyz.com',
    archetype: undefined,
    schemaVersion: undefined,
  });
  delete legacy.archetype;
  delete legacy.schemaVersion;

  const result = validateProfileObject(legacy, {
    expectedHost: 'moodyz.com',
    source: 'legacy-moodyz.json',
  });

  assert.equal(result.valid, true);
  assert.equal(result.archetype, 'navigation-catalog');
  assert.equal(result.profile.archetype, 'navigation-catalog');
  assert.equal(result.profile.schemaVersion, 1);
  assert.match(result.warnings.join('\n'), /profile\.archetype defaulted/u);
  assert.match(result.warnings.join('\n'), /profile\.schemaVersion defaulted to 1/u);
});

test('validateProfileObject rejects unknown archetypes with stable field paths', () => {
  assert.throws(() => validateProfileObject(createNavigationProfile({
    archetype: 'video-marketplace',
  }), {
    expectedHost: 'example.com',
    source: 'example.com.json',
  }), (error) => {
    assert.ok(error instanceof ProfileValidationError);
    assert.match(error.message, /profile\.archetype: has no registered schema/u);
    return true;
  });
});

test('ensureCrawlerScript fails fast when profile validation fails', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-profile-validation-'));
  const invalidProfilePath = path.join(workspace, 'moodyz.com.json');

  try {
    await writeFile(invalidProfilePath, `${JSON.stringify({
      host: 'moodyz.com',
      archetype: 'navigation-catalog',
      schemaVersion: 1,
      version: 2,
      search: {
        formSelectors: ['form[action*="/search/list"]'],
        inputSelectors: ['input[name="keyword"]'],
        submitSelectors: ['button[type="submit"]'],
        resultTitleSelectors: ['title'],
        resultBookSelectors: ['a[href*="/works/detail/"]'],
        knownQueries: [],
      },
    }, null, 2)}\n`, 'utf8');

    await assert.rejects(
      ensureCrawlerScript('https://moodyz.com/works/date', {
        profilePath: invalidProfilePath,
        crawlerScriptsDir: path.join(workspace, 'crawler-scripts'),
        knowledgeBaseDir: path.join(workspace, 'knowledge-base'),
      }),
      /profile\.pageTypes: is required/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('ensureCrawlerScript derives navigation capabilities and page types from the profile archetype', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-crawler-navigation-meta-'));
  const profilePath = path.join(workspace, 'example.com.json');

  try {
    await writeFile(profilePath, `${JSON.stringify(createNavigationProfile(), null, 2)}\n`, 'utf8');

    const result = await ensureCrawlerScript('https://example.com/', {
      profilePath,
      crawlerScriptsDir: path.join(workspace, 'crawler-scripts'),
      knowledgeBaseDir: path.join(workspace, 'knowledge-base'),
    });

    assert.deepEqual(result.meta.capabilities, [
      'search-content',
      'navigate-to-content',
      'navigate-to-author',
      'navigate-to-category',
      'navigate-to-utility-page',
      'switch-in-page-state',
    ]);
    assert.doesNotMatch(JSON.stringify(result.meta.capabilities), /download-content|navigate-to-chapter/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
