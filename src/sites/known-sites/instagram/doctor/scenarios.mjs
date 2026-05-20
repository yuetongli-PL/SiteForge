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
    return new URL(String(input ?? ''), 'https://www.instagram.com').pathname.replace(/\/+$/u, '').toLowerCase() || '/';
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

function diagnoseInstagramSurfaceState(state = null, {
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
  if (authRequired && (authAvailable === false || pageType === 'auth-page' || pathname.startsWith('/accounts/login') || pathname.startsWith('/challenge'))) {
    return {
      reasonCode: 'not-logged-in',
      antiCrawlSignals,
      featuredContentCount,
      featuredAuthorCount,
    };
  }
  if (pageFacts.privateAccount === true || pageFacts.unavailableContent === true) {
    return {
      reasonCode: 'platform-boundary',
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

export function createInstagramSiteDoctorScenarioSuite({
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
    siteKey: 'instagram',
    siteLabel: 'instagram',
    primaryScenarioId: 'home-search-post-detail-profile',
    buildPrimaryScenario(primaryContext, startUrl) {
      const primaryScenarioError = primaryContext?.error
        ? primaryContext.error
        : !primaryContext?.searchState
          ? new Error('Primary Instagram scenario did not capture any search-results state.')
          : !primaryContext?.detailState
            ? new Error('Primary Instagram scenario reached search but did not capture a post/reel detail state.')
            : !primaryContext?.authorState
              ? new Error('Primary Instagram scenario reached detail but did not capture a profile page.')
              : null;
      const primaryObserved = primaryContext?.authorState ?? primaryContext?.detailState ?? primaryContext?.searchState ?? null;
      return buildScenarioResult('home-search-post-detail-profile', startUrl, primaryScenarioError ? 'fail' : 'pass', {
        stateId: primaryObserved?.state_id ?? primaryObserved?.stateId ?? null,
        finalUrl: primaryObserved?.finalUrl ?? null,
        pageType: primaryObserved?.pageType ?? null,
        semanticPageType: primaryObserved?.semanticPageType ?? (primaryObserved?.pageType ? toSemanticPageType(primaryObserved.pageType) : null),
        expectedSemanticPageType: 'author-page',
        authRequired: false,
        antiCrawlSignals: extractAntiCrawlSignals(primaryObserved),
        note: 'Expected chain: home -> search-results -> post/reel detail -> profile page.',
        error: primaryScenarioError,
      });
    },
    diagnoseState: diagnoseInstagramSurfaceState,
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
        id: 'public-profile-posts',
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
        id: 'profile-reels',
        sampleField: 'authorReelsUrl',
        sampleContainer: 'authValidationSamples',
        searchQueries: [],
        authRequired: false,
        expectedSemanticPageType: 'author-page',
        resolveResult(states, startUrl) {
          return findStateForPath(states, startUrl, findStateByUrl, findFirstState)
            ?? findFirstState(states, (state) => /^\/[^/]+\/reels$/u.test(normalizePathname(state?.finalUrl)));
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
        id: 'search',
        sampleField: 'searchUrl',
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
        id: 'direct-inbox',
        sampleField: 'directInboxUrl',
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
      {
        id: 'author-followers',
        sampleField: 'authorFollowersUrl',
        sampleContainer: 'authValidationSamples',
        searchQueries: [],
        authRequired: true,
        expectedSemanticPageType: 'author-list-page',
        resolveResult(states, startUrl) {
          return findStateForPath(states, startUrl, findStateByUrl, findFirstState)
            ?? findFirstState(states, (state) => /^\/[^/]+\/followers$/u.test(normalizePathname(state?.finalUrl)));
        },
      },
    ],
  };
}
