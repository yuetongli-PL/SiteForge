import test from 'node:test';
import assert from 'node:assert/strict';

import { validateProfileObject } from '../../src/sites/registry/core/profile-validation.mjs';

function createRedditProfile() {
  return {
    host: 'www.reddit.com',
    version: 1,
    archetype: 'social-content',
    schemaVersion: 1,
    primaryArchetype: 'social-content',
    pageTypes: {
      homeExact: ['/'],
      homePrefixes: ['/'],
      searchResultsPrefixes: ['/search'],
      contentDetailPrefixes: ['/r/', '/comments/'],
      authorPrefixes: ['/user/'],
      authorListExact: [],
      authorListPrefixes: ['/users/'],
      authorDetailPrefixes: ['/user/'],
      chapterPrefixes: [],
      historyPrefixes: ['/user/'],
      authPrefixes: ['/login', '/account'],
      categoryPrefixes: ['/r/', '/best', '/hot', '/new', '/top'],
    },
    search: {
      formSelectors: ['form[action*="search"]', 'search input'],
      inputSelectors: ['input[name="q"]', 'input[type="search"]'],
      submitSelectors: ['button[type="submit"]'],
      resultTitleSelectors: ['a[href*="/comments/"]', '[data-testid="post-title"]'],
      resultBookSelectors: ['a[href*="/comments/"]', 'article'],
      queryParamNames: ['q'],
      knownQueries: [{
        query: 'siteforge',
        title: 'Reddit search results',
        url: 'https://www.reddit.com/search/?q=siteforge',
        authorName: 'reddit',
      }],
    },
    validationSamples: {
      videoSearchQuery: 'siteforge',
      videoDetailUrl: 'https://www.reddit.com/r/reddit.com/comments/',
      authorUrl: 'https://www.reddit.com/user/reddit/',
    },
    authSession: {
      loginUrl: 'https://www.reddit.com/login/',
      postLoginUrl: 'https://www.reddit.com/',
      verificationUrl: 'https://www.reddit.com/',
      keepaliveUrl: 'https://www.reddit.com/',
      keepaliveIntervalMinutes: 60,
      preferVisibleBrowserForAuthenticatedFlows: true,
      requireStableNetworkForAuthenticatedFlows: false,
      reuseLoginStateByDefault: true,
      autoLoginByDefault: false,
      loginIndicatorSelectors: ['a[href*="/login"]'],
      loggedOutIndicatorSelectors: ['a[href*="/login"]'],
      reusableSessionSignals: ['no-login-form-or-logged-out-indicator'],
      authRequiredPathPrefixes: ['/notifications', '/message', '/settings', '/user/'],
    },
    sampling: {
      searchResultContentLimit: 20,
      authorContentLimit: 20,
      categoryContentLimit: 20,
      fallbackContentLimitWithSearch: 10,
    },
    navigation: {
      allowedHosts: ['www.reddit.com', 'reddit.com', 'oauth.reddit.com'],
      contentPathPrefixes: ['/r/', '/comments/'],
      authorPathPrefixes: ['/user/'],
      authorListPathPrefixes: ['/users/'],
      authorDetailPathPrefixes: ['/user/'],
      categoryPathPrefixes: ['/r/', '/best', '/hot', '/new', '/top'],
      utilityPathPrefixes: ['/search', '/prefs', '/settings', '/notifications', '/message'],
      authPathPrefixes: ['/login', '/account'],
      categoryLabelKeywords: ['subreddit', 'community', 'popular', 'latest'],
    },
    contentDetail: {
      titleSelectors: ['h1', '[data-testid="post-title"]', 'a[href*="/comments/"]'],
      authorNameSelectors: ['a[href^="/user/"]', 'a[href*="/user/"]'],
      authorLinkSelectors: ['a[href^="/user/"]', 'a[href*="/user/"]'],
    },
    author: {
      titleSelectors: ['h1', '[data-testid="profile-title"]'],
      workLinkSelectors: ['a[href*="/comments/"]', 'article a'],
    },
  };
}

test('reddit social-content profile validates against registered schema', () => {
  const validation = validateProfileObject(createRedditProfile(), {
    expectedHost: 'www.reddit.com',
    source: 'reddit test profile',
  });

  assert.equal(validation.valid, true);
  assert.equal(validation.host, 'www.reddit.com');
  assert.equal(validation.archetype, 'social-content');
  assert.equal(validation.schemaId, 'profile/social-content/v1');
});
