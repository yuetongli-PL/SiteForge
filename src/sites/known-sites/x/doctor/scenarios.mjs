// @ts-check

function uniqueSortedStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value ?? '').trim())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right, 'en'));
}

function normalizePathname(input = '') {
  try {
    return new URL(String(input ?? ''), 'https://x.com').pathname.replace(/\/+$/u, '').toLowerCase() || '/';
  } catch {
    return String(input ?? '').split(/[?#]/u, 1)[0].replace(/\/+$/u, '').toLowerCase() || '/';
  }
}

function collectionCount(primaryValue, ...collections) {
  const normalized = Number(primaryValue ?? 0);
  if (Number.isFinite(normalized) && normalized > 0) {
    return normalized;
  }
  for (const collection of collections) {
    const count = Array.isArray(collection) ? collection.filter(Boolean).length : 0;
    if (count > 0) {
      return count;
    }
  }
  return 0;
}

function diagnoseXSurfaceState(state = null, {
  authRequired = false,
  authAvailable = null,
} = {}) {
  const pageFacts = state?.pageFacts ?? {};
  const antiCrawlSignals = uniqueSortedStrings(pageFacts.antiCrawlSignals);
  const pathname = normalizePathname(state?.finalUrl);
  const pageType = String(state?.pageType ?? '');
  const featuredContentCount = collectionCount(
    pageFacts.featuredContentCount,
    pageFacts.featuredContentCards,
    pageFacts.featuredContentUrls,
    pageFacts.featuredContentTitles,
  );
  const featuredAuthorCount = collectionCount(
    pageFacts.featuredAuthorCount,
    pageFacts.featuredAuthorCards,
    pageFacts.featuredAuthorUrls,
    pageFacts.featuredAuthorNames,
  );

  if (antiCrawlSignals.length > 0 || pageFacts.challengeRequired === true || pageFacts.rateLimited === true) {
    return {
      reasonCode: pageFacts.rateLimited === true ? 'anti-crawl-rate-limit' : 'anti-crawl-challenge',
      antiCrawlSignals,
      featuredContentCount,
      featuredAuthorCount,
      riskCauseCode: 'browser-fingerprint-risk',
      riskAction: 'use-visible-browser-warmup',
    };
  }
  if (authRequired && (authAvailable === false || pageType === 'auth-page' || pathname.startsWith('/i/flow/login') || pathname === '/login')) {
    return {
      reasonCode: 'not-logged-in',
      antiCrawlSignals,
      featuredContentCount,
      featuredAuthorCount,
    };
  }
  if (pageFacts.emptyShell === true) {
    return {
      reasonCode: 'empty-shell',
      antiCrawlSignals,
      emptyShell: true,
      featuredContentCount,
      featuredAuthorCount,
    };
  }
  return {
    reasonCode: 'ok',
    antiCrawlSignals,
    featuredContentCount,
    featuredAuthorCount,
  };
}

function findStateForPath(states, expectedUrl, findStateByUrl, findFirstState) {
  return findStateByUrl(states, expectedUrl)
    ?? findFirstState(states, (state) => normalizePathname(state?.finalUrl) === normalizePathname(expectedUrl));
}

export function createXSiteDoctorScenarioSuite({
  helpers,
} = {}) {
  const {
    buildScenarioResult,
    extractAntiCrawlSignals,
    findFirstDetailState,
    findFirstState,
    findStateByUrl,
    toSemanticPageType,
  } = helpers;

  return {
    siteKey: 'x',
    siteLabel: 'x',
    primaryScenarioId: 'home-search-post-detail-author',
    buildPrimaryScenario(primaryContext, startUrl) {
      const primaryScenarioError = primaryContext?.error
        ? primaryContext.error
        : !primaryContext?.searchState
          ? new Error('Primary X scenario did not capture any search-results state.')
          : !primaryContext?.detailState
            ? new Error('Primary X scenario reached search but did not capture a post detail state.')
            : !primaryContext?.authorState
              ? new Error('Primary X scenario reached post detail but did not capture an account profile.')
              : null;
      const primaryObserved = primaryContext?.authorState ?? primaryContext?.detailState ?? primaryContext?.searchState ?? null;
      return buildScenarioResult('home-search-post-detail-author', startUrl, primaryScenarioError ? 'fail' : 'pass', {
        stateId: primaryObserved?.state_id ?? primaryObserved?.stateId ?? null,
        finalUrl: primaryObserved?.finalUrl ?? null,
        pageType: primaryObserved?.pageType ?? null,
        semanticPageType: primaryObserved?.semanticPageType ?? (primaryObserved?.pageType ? toSemanticPageType(primaryObserved.pageType) : null),
        expectedSemanticPageType: 'author-page',
        authRequired: false,
        antiCrawlSignals: extractAntiCrawlSignals(primaryObserved),
        note: 'Expected chain: home -> search-results -> post detail -> account profile.',
        error: primaryScenarioError,
      });
    },
    diagnoseState: diagnoseXSurfaceState,
    scenarioDefinitions: [
      {
        id: 'public-post-detail',
        sampleField: 'videoDetailUrl',
        sampleContainer: 'validationSamples',
        searchQueries: [],
        authRequired: false,
        expectedSemanticPageType: 'content-detail-page',
        resolveResult(states, startUrl) {
          return findStateForPath(states, startUrl, findStateByUrl, findFirstState)
            ?? findFirstDetailState(states);
        },
      },
      {
        id: 'public-author-posts',
        sampleField: 'authorVideosUrl',
        sampleContainer: 'validationSamples',
        fallbackSamples: [{ container: 'validationSamples', field: 'authorUrl' }],
        searchQueries: [],
        authRequired: false,
        expectedSemanticPageType: 'author-page',
        resolveResult(states, startUrl) {
          return findStateForPath(states, startUrl, findStateByUrl, findFirstState)
            ?? findFirstState(states, (state) => String(state.pageType ?? '') === 'author-page');
        },
      },
      {
        id: 'category-explore',
        sampleField: 'categoryPopularUrl',
        sampleContainer: 'validationSamples',
        searchQueries: [],
        authRequired: false,
        expectedSemanticPageType: 'category-page',
        resolveResult(states, startUrl) {
          return findStateForPath(states, startUrl, findStateByUrl, findFirstState)
            ?? findFirstState(states, (state) => String(state.pageType ?? '') === 'category-page');
        },
      },
      {
        id: 'home-auth',
        sampleField: 'homeUrl',
        sampleContainer: 'authValidationSamples',
        searchQueries: [],
        authRequired: true,
        expectedSemanticPageType: 'home',
        resolveResult(states, startUrl) {
          return findStateForPath(states, startUrl, findStateByUrl, findFirstState)
            ?? findFirstState(states, (state) => String(state.pageType ?? '') === 'home');
        },
      },
      {
        id: 'search-latest',
        sampleField: 'searchLatestUrl',
        sampleContainer: 'authValidationSamples',
        searchQueries: [],
        authRequired: true,
        expectedSemanticPageType: 'search-results-page',
        resolveResult(states, startUrl) {
          return findStateForPath(states, startUrl, findStateByUrl, findFirstState)
            ?? findFirstState(states, (state) => String(state.pageType ?? '') === 'search-results-page');
        },
      },
      {
        id: 'notifications',
        sampleField: 'notificationsUrl',
        sampleContainer: 'authValidationSamples',
        searchQueries: [],
        authRequired: true,
        expectedSemanticPageType: 'author-list-page',
        resolveResult(states, startUrl) {
          return findStateForPath(states, startUrl, findStateByUrl, findFirstState);
        },
      },
      {
        id: 'bookmarks',
        sampleField: 'bookmarksUrl',
        sampleContainer: 'authValidationSamples',
        searchQueries: [],
        authRequired: true,
        expectedSemanticPageType: 'author-list-page',
        resolveResult(states, startUrl) {
          return findStateForPath(states, startUrl, findStateByUrl, findFirstState);
        },
      },
      {
        id: 'author-following',
        sampleField: 'authorFollowingUrl',
        sampleContainer: 'authValidationSamples',
        searchQueries: [],
        authRequired: true,
        expectedSemanticPageType: 'author-list-page',
        resolveResult(states, startUrl) {
          return findStateForPath(states, startUrl, findStateByUrl, findFirstState)
            ?? findFirstState(states, (state) => /^\/[^/]+\/following$/u.test(normalizePathname(state?.finalUrl)));
        },
      },
    ],
  };
}
