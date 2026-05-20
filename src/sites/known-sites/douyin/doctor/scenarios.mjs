// @ts-check

import {
  diagnoseDouyinSurfaceState,
  normalizeDouyinAuthorSubpage,
} from '../model/diagnosis.mjs';

function deriveScenarioCollectionCount(primaryValue, ...collections) {
  const normalizedPrimary = Number(primaryValue ?? 0);
  if (Number.isFinite(normalizedPrimary) && normalizedPrimary > 0) {
    return normalizedPrimary;
  }
  for (const collection of collections) {
    const derived = Array.isArray(collection) ? collection.filter(Boolean).length : 0;
    if (derived > 0) {
      return derived;
    }
  }
  return 0;
}

function scoreDouyinAuthorSubpageState(state = null, extractAntiCrawlSignals = () => []) {
  const pageFacts = state?.pageFacts ?? {};
  const identityConfirmed = pageFacts.identityConfirmed === true || pageFacts.authenticatedSessionConfirmed === true;
  const loginStateDetected = pageFacts.loginStateDetected === true || pageFacts.loggedIn === true;
  const antiCrawlSignals = extractAntiCrawlSignals(state);
  const featuredContentCount = deriveScenarioCollectionCount(
    pageFacts.featuredContentCount,
    pageFacts.featuredContentCards,
    pageFacts.featuredContentUrls,
    pageFacts.featuredContentTitles,
    pageFacts.featuredContentVideoIds,
  );
  const featuredAuthorCount = deriveScenarioCollectionCount(
    pageFacts.featuredAuthorCount,
    pageFacts.featuredAuthorCards,
    pageFacts.featuredAuthorUrls,
    pageFacts.featuredAuthorNames,
    pageFacts.featuredAuthorUserIds,
  );
  let score = 0;
  if (identityConfirmed) {
    score += 1_000;
  }
  if (loginStateDetected) {
    score += 500;
  }
  if (antiCrawlSignals.length > 0) {
    score += 250 + antiCrawlSignals.length;
  }
  if (featuredContentCount > 0 || featuredAuthorCount > 0) {
    score += Math.min(featuredContentCount + featuredAuthorCount, 100);
  }
  if (pageFacts.featuredContentComplete === true || pageFacts.featuredAuthorComplete === true) {
    score += 50;
  }
  switch (String(state?.status ?? '')) {
    case 'captured':
      score += 25;
      break;
    case 'duplicate':
      score += 15;
      break;
    case 'noop':
      score += 5;
      break;
    default:
      break;
  }
  return score;
}

function findFirstStateByAuthorSubpage(states, subpage, extractAntiCrawlSignals = () => []) {
  const normalized = normalizeDouyinAuthorSubpage(subpage, '');
  const candidates = states.filter((state) => (
    ['initial', 'captured', 'duplicate', 'noop'].includes(String(state.status ?? ''))
    && String(state.pageType ?? '') === 'author-list-page'
    && normalizeDouyinAuthorSubpage(state.pageFacts?.authorSubpage, '') === normalized
  ));
  if (candidates.length === 0) {
    return null;
  }
  return candidates.reduce((bestState, candidate) => (
    scoreDouyinAuthorSubpageState(candidate, extractAntiCrawlSignals) > scoreDouyinAuthorSubpageState(bestState, extractAntiCrawlSignals)
      ? candidate
      : bestState
  ));
}

export function createDouyinSiteDoctorScenarioSuite({
  helpers,
} = {}) {
  const {
    buildScenarioResult,
    extractAntiCrawlSignals,
    findFirstState,
    findStateByUrl,
    toSemanticPageType,
  } = helpers;

  return {
    siteKey: 'douyin',
    siteLabel: 'douyin',
    primaryScenarioId: 'home-search-video-detail-author',
    buildPrimaryScenario(primaryContext, startUrl) {
      const primaryScenarioError = primaryContext?.error
        ? primaryContext.error
        : !primaryContext?.searchState
          ? new Error('Primary douyin scenario did not capture any search-results state.')
          : !primaryContext?.detailState
            ? new Error('Primary douyin scenario reached search but did not capture a content detail state.')
            : !primaryContext?.authorState
              ? new Error('Primary douyin scenario reached content detail but did not capture an author page.')
              : null;
      const primaryObserved = primaryContext?.authorState ?? primaryContext?.detailState ?? primaryContext?.searchState ?? null;
      return buildScenarioResult('home-search-video-detail-author', startUrl, primaryScenarioError ? 'fail' : 'pass', {
        stateId: primaryObserved?.state_id ?? primaryObserved?.stateId ?? null,
        finalUrl: primaryObserved?.finalUrl ?? null,
        pageType: primaryObserved?.pageType ?? null,
        semanticPageType: primaryObserved?.semanticPageType ?? (primaryObserved?.pageType ? toSemanticPageType(primaryObserved.pageType) : null),
        expectedSemanticPageType: 'author-page',
        authRequired: false,
        antiCrawlSignals: extractAntiCrawlSignals(primaryObserved),
        note: 'Expected chain: home -> search-results -> content-detail -> author-page.',
        error: primaryScenarioError,
      });
    },
    diagnoseState: diagnoseDouyinSurfaceState,
    scenarioDefinitions: [
      {
        id: 'public-author-posts',
        sampleField: 'authorVideosUrl',
        sampleContainer: 'validationSamples',
        searchQueries: [],
        authRequired: false,
        expectedSemanticPageType: 'author-page',
        resolveResult(states, startUrl) {
          return findStateByUrl(states, startUrl)
            ?? findFirstState(states, (state) => String(state.pageType ?? '') === 'author-page');
        },
      },
      {
        id: 'self-posts',
        sampleField: 'selfPostsUrl',
        sampleContainer: 'authValidationSamples',
        searchQueries: [],
        authRequired: true,
        expectedSemanticPageType: 'author-list-page',
        resolveResult(states) {
          return findFirstStateByAuthorSubpage(states, 'post', extractAntiCrawlSignals);
        },
      },
      {
        id: 'self-likes',
        sampleField: 'likesUrl',
        sampleContainer: 'authValidationSamples',
        searchQueries: [],
        authRequired: true,
        expectedSemanticPageType: 'author-list-page',
        resolveResult(states) {
          return findFirstStateByAuthorSubpage(states, 'like', extractAntiCrawlSignals);
        },
      },
      {
        id: 'self-collections',
        sampleField: 'collectionsUrl',
        sampleContainer: 'authValidationSamples',
        searchQueries: [],
        authRequired: true,
        expectedSemanticPageType: 'author-list-page',
        resolveResult(states) {
          return findFirstStateByAuthorSubpage(states, 'collect', extractAntiCrawlSignals);
        },
      },
      {
        id: 'self-history',
        sampleField: 'historyUrl',
        sampleContainer: 'authValidationSamples',
        searchQueries: [],
        authRequired: true,
        expectedSemanticPageType: 'author-list-page',
        resolveResult(states) {
          return findFirstStateByAuthorSubpage(states, 'history', extractAntiCrawlSignals);
        },
      },
      {
        id: 'follow-feed',
        sampleField: 'followFeedUrl',
        sampleContainer: 'authValidationSamples',
        searchQueries: [],
        authRequired: true,
        expectedSemanticPageType: 'author-list-page',
        resolveResult(states) {
          return findFirstStateByAuthorSubpage(states, 'follow-feed', extractAntiCrawlSignals);
        },
      },
      {
        id: 'follow-users',
        sampleField: 'followUsersUrl',
        sampleContainer: 'authValidationSamples',
        searchQueries: [],
        authRequired: true,
        expectedSemanticPageType: 'author-list-page',
        resolveResult(states) {
          return findFirstStateByAuthorSubpage(states, 'follow-users', extractAntiCrawlSignals);
        },
      },
    ],
  };
}
