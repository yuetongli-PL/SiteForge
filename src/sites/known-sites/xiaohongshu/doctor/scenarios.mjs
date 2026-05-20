// @ts-check

function uniqueSortedStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value ?? '').trim())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right, 'en'));
}

function normalizePathname(input = '') {
  const value = String(input ?? '').trim();
  if (!value) {
    return '';
  }
  try {
    const parsed = new URL(value, 'https://www.xiaohongshu.com');
    return parsed.pathname.replace(/\/+$/u, '') || '/';
  } catch {
    return value.split(/[?#]/u, 1)[0].replace(/\/+$/u, '') || '/';
  }
}

function deriveCollectionCount(primaryValue, ...collections) {
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

function inferAntiCrawlReasonCode(antiCrawlSignals = []) {
  const joined = uniqueSortedStrings(antiCrawlSignals).join(' ');
  if (!joined) {
    return 'ok';
  }
  if (/verify|captcha|risk/u.test(joined)) {
    return 'anti-crawl-verify';
  }
  if (/rate-limit|throttle|too-many/u.test(joined)) {
    return 'anti-crawl-rate-limit';
  }
  if (/challenge|slider|middle/u.test(joined)) {
    return 'anti-crawl-challenge';
  }
  return 'anti-crawl';
}

function diagnoseXiaohongshuSurfaceState(state = null, {
  authRequired = false,
  authAvailable = null,
} = {}) {
  const pageFacts = state?.pageFacts ?? {};
  const antiCrawlSignals = uniqueSortedStrings(pageFacts.antiCrawlSignals);
  const featuredContentCount = deriveCollectionCount(
    pageFacts.featuredContentCount,
    pageFacts.featuredContentCards,
    pageFacts.featuredContentUrls,
    pageFacts.featuredContentTitles,
    pageFacts.featuredContentNoteIds,
  );
  const featuredAuthorCount = deriveCollectionCount(
    pageFacts.featuredAuthorCount,
    pageFacts.featuredAuthorCards,
    pageFacts.featuredAuthorUrls,
    pageFacts.featuredAuthorNames,
    pageFacts.featuredAuthorUserIds,
  );
  const riskPageDetected = pageFacts.riskPageDetected === true
    || normalizePathname(state?.finalUrl) === '/website-login/error';
  const reasonCode = inferAntiCrawlReasonCode(antiCrawlSignals);
  if (riskPageDetected || reasonCode !== 'ok') {
    return {
      reasonCode: reasonCode === 'ok' ? 'anti-crawl-verify' : reasonCode,
      antiCrawlSignals,
      featuredContentCount,
      featuredAuthorCount,
      riskCauseCode: 'browser-fingerprint-risk',
      riskAction: 'use-visible-browser-warmup',
    };
  }

  const pathname = normalizePathname(state?.finalUrl);
  const onNotificationPage = pathname === '/notification' || pathname.startsWith('/notification/');
  const onAuthPage = pathname === '/login'
    || pathname === '/register'
    || String(state?.pageType ?? '') === 'auth-page';

  if (authRequired) {
    if (onAuthPage || authAvailable === false) {
      return {
        reasonCode: 'not-logged-in',
        antiCrawlSignals,
        featuredContentCount,
        featuredAuthorCount,
      };
    }
    if (onNotificationPage) {
      return {
        reasonCode: 'ok',
        antiCrawlSignals,
        featuredContentCount,
        featuredAuthorCount,
      };
    }
    return {
      reasonCode: 'content-quality-unknown',
      antiCrawlSignals,
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

export function createXiaohongshuSiteDoctorScenarioSuite({
  profile = null,
  helpers,
} = {}) {
  const {
    buildScenarioResult,
    findFirstDetailState,
    findFirstState,
    findStateByUrl,
    toSemanticPageType,
  } = helpers;

  return {
    siteKey: 'xiaohongshu',
    siteLabel: 'xiaohongshu',
    primaryScenarioId: 'home-search-note-detail-author',
    buildPrimaryScenario(primaryContext, startUrl) {
      const restriction = primaryContext?.restriction ?? null;
      if (restriction?.restrictionDetected) {
        return buildScenarioResult('home-search-note-detail-author', startUrl, 'fail', {
          finalUrl: restriction.finalUrl ?? primaryContext?.captureManifest?.finalUrl ?? null,
          pageType: restriction.pageType ?? primaryContext?.captureManifest?.pageType ?? 'auth-page',
          semanticPageType: 'auth-page',
          expectedSemanticPageType: 'author-page',
          authRequired: false,
          reasonCode: restriction.antiCrawlReasonCode ?? 'anti-crawl-verify',
          antiCrawlSignals: restriction.antiCrawlSignals ?? [],
          riskCauseCode: restriction.riskCauseCode ?? 'browser-fingerprint-risk',
          riskAction: restriction.riskAction ?? 'use-visible-browser-warmup',
          note: 'Expected chain: discover -> search-results -> content-detail -> author-page. Capture succeeded on restriction page.',
          error: new Error(`Primary xiaohongshu scenario was blocked by restriction page${restriction.riskPageCode ? ` ${restriction.riskPageCode}` : ''}.`),
        });
      }
      const primaryScenarioError = primaryContext?.error
        ? primaryContext.error
        : !primaryContext?.searchState
          ? new Error('Primary xiaohongshu scenario did not capture any search-results state.')
          : !primaryContext?.detailState
            ? new Error('Primary xiaohongshu scenario reached search but did not capture a content detail state.')
            : !primaryContext?.authorState
              ? new Error('Primary xiaohongshu scenario reached content detail but did not capture an author page.')
              : null;
      const primaryObserved = primaryContext?.authorState ?? primaryContext?.detailState ?? primaryContext?.searchState ?? null;
      return buildScenarioResult('home-search-note-detail-author', startUrl, primaryScenarioError ? 'fail' : 'pass', {
        stateId: primaryObserved?.state_id ?? primaryObserved?.stateId ?? null,
        finalUrl: primaryObserved?.finalUrl ?? null,
        pageType: primaryObserved?.pageType ?? null,
        semanticPageType: primaryObserved?.semanticPageType ?? (primaryObserved?.pageType ? toSemanticPageType(primaryObserved.pageType) : null),
        expectedSemanticPageType: 'author-page',
        authRequired: false,
        note: 'Expected chain: discover -> search-results -> content-detail -> author-page.',
        error: primaryScenarioError,
      });
    },
    diagnoseState: diagnoseXiaohongshuSurfaceState,
    scenarioDefinitions: [
      {
        id: 'author-notes-to-detail',
        sampleField: 'authorVideosUrl',
        sampleContainer: 'validationSamples',
        resolveStartUrl({ primaryContext, samples }) {
          const capturedAuthorUrl = String(primaryContext?.authorState?.finalUrl ?? '').trim();
          if (capturedAuthorUrl) {
            return {
              startUrl: capturedAuthorUrl,
              missingFieldPaths: [],
              missingFieldMessage: null,
            };
          }
          const sampleUrl = String(samples?.authorVideosUrl ?? samples?.authorUrl ?? '').trim();
          if (sampleUrl) {
            return {
              startUrl: sampleUrl,
              missingFieldPaths: [],
              missingFieldMessage: null,
            };
          }
          return null;
        },
        searchQueries: [],
        authRequired: false,
        expectedSemanticPageType: 'content-detail-page',
        resolveResult(states) {
          return findFirstDetailState(states);
        },
      },
      {
        id: 'notification-inbox',
        sampleField: 'notificationUrl',
        sampleContainer: 'authValidationSamples',
        searchQueries: [],
        authRequired: true,
        expectedSemanticPageType: 'utility-page',
        resolveResult(states, startUrl) {
          return findStateByUrl(states, startUrl)
            ?? findFirstState(states, (state) => {
              const pathname = normalizePathname(state?.finalUrl);
              return pathname === '/notification'
                || pathname.startsWith('/notification/')
                || pathname === '/login'
                || pathname === '/register'
                || pageLooksLikeNotificationShell(state);
            });
        },
      },
    ],
  };
}

function pageLooksLikeNotificationShell(state = null) {
  const pageType = String(state?.pageType ?? '');
  if (pageType === 'utility-page') {
    return true;
  }
  const pageFacts = state?.pageFacts ?? {};
  return pageFacts.notificationPageDetected === true
    || pageFacts.loginStateDetected === true
    || pageFacts.identityConfirmed === true;
}
