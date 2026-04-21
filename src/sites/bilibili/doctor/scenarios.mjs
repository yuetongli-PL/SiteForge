// @ts-check

import { diagnoseBilibiliSurfaceState } from '../model/diagnosis.mjs';

export function createBilibiliSiteDoctorScenarioSuite({
  profile = null,
  helpers,
} = {}) {
  const {
    buildScenarioResult,
    extractAntiCrawlSignals,
    findFirstDetailState,
    findFirstState,
    isAuthRequiredAuthorSubpage,
    toSemanticPageType,
  } = helpers;

  return {
    siteKey: 'bilibili',
    siteLabel: 'bilibili',
    primaryScenarioId: 'home-search-video-detail-author',
    buildPrimaryScenario(primaryContext, startUrl) {
      const primaryScenarioError = primaryContext?.error
        ? primaryContext.error
        : !primaryContext?.searchState
          ? new Error('Primary bilibili scenario did not capture any search-results state.')
          : !primaryContext?.detailState
            ? new Error('Primary bilibili scenario reached search but did not capture a content detail state.')
            : !primaryContext?.authorState
              ? new Error('Primary bilibili scenario reached content detail but did not capture an author page.')
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
    diagnoseState: diagnoseBilibiliSurfaceState,
    scenarioDefinitions: [
      {
        id: 'category-popular-to-detail',
        sampleField: 'categoryPopularUrl',
        sampleContainer: 'validationSamples',
        searchQueries: [],
        authRequired: false,
        expectedSemanticPageType: 'content-detail-page',
        resolveResult(states) {
          return findFirstDetailState(states);
        },
      },
      {
        id: 'bangumi-detail',
        sampleField: 'bangumiDetailUrl',
        sampleContainer: 'validationSamples',
        searchQueries: [],
        authRequired: false,
        expectedSemanticPageType: 'content-detail-page',
        resolveResult(states) {
          return findFirstState(states, (state) => {
            const url = String(state.finalUrl ?? '');
            return url.includes('/bangumi/play/') || String(state.pageFacts?.contentType ?? '') === 'bangumi';
          });
        },
      },
      {
        id: 'author-videos-to-detail',
        sampleField: 'authorVideosUrl',
        sampleContainer: 'validationSamples',
        searchQueries: [],
        authRequired: false,
        expectedSemanticPageType: 'content-detail-page',
        resolveResult(states) {
          return findFirstDetailState(states);
        },
      },
      {
        id: 'author-dynamic-feed',
        sampleField: 'dynamicUrl',
        sampleContainer: 'authValidationSamples',
        fallbackSamples: [{ container: 'validationSamples', field: 'authorDynamicUrl' }],
        searchQueries: [],
        authRequired: isAuthRequiredAuthorSubpage(profile, 'dynamic'),
        expectedSemanticPageType: 'author-list-page',
        resolveResult(states) {
          return findFirstState(states, (state) => (
            String(state.pageType ?? '') === 'author-list-page'
            && String(state.pageFacts?.authorSubpage ?? '') === 'dynamic'
          ));
        },
      },
      {
        id: 'author-follow-list',
        sampleField: 'followListUrl',
        sampleContainer: 'authValidationSamples',
        searchQueries: [],
        authRequired: isAuthRequiredAuthorSubpage(profile, 'fans/follow'),
        expectedSemanticPageType: 'author-list-page',
        resolveResult(states) {
          return findFirstState(states, (state) => (
            String(state.pageType ?? '') === 'author-list-page'
            && String(state.pageFacts?.authorSubpage ?? '') === 'follow'
          ));
        },
      },
      {
        id: 'author-fans-list',
        sampleField: 'fansListUrl',
        sampleContainer: 'authValidationSamples',
        searchQueries: [],
        authRequired: isAuthRequiredAuthorSubpage(profile, 'fans/fans'),
        expectedSemanticPageType: 'author-list-page',
        resolveResult(states) {
          return findFirstState(states, (state) => (
            String(state.pageType ?? '') === 'author-list-page'
            && String(state.pageFacts?.authorSubpage ?? '') === 'fans'
          ));
        },
      },
    ],
  };
}
