import { cleanText, toArray, uniqueSortedStrings } from '../../../shared/normalize.mjs';

function normalizeSignal(signal) {
  return cleanText(signal ?? '').toLowerCase();
}

export function deriveBilibiliAntiCrawlReasonCode(signals = []) {
  const normalized = uniqueSortedStrings(toArray(signals).map(normalizeSignal).filter(Boolean));
  if (normalized.some((signal) => /verify|challenge|captcha|登录校验|安全验证/u.test(signal))) {
    return 'anti-crawl-verify';
  }
  if (normalized.some((signal) => /rate|频繁|稍后再试|too[- ]many|风控/u.test(signal))) {
    return 'anti-crawl-rate-limit';
  }
  return normalized.length > 0 ? 'anti-crawl' : null;
}

function normalizeCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function deriveCount(primaryValue, ...fallbackCollections) {
  const normalizedPrimary = normalizeCount(primaryValue);
  if (normalizedPrimary > 0) {
    return normalizedPrimary;
  }
  for (const collection of fallbackCollections) {
    const derived = toArray(collection).filter(Boolean).length;
    if (derived > 0) {
      return derived;
    }
  }
  return normalizedPrimary;
}

function normalizeSubpage(value) {
  return cleanText(value ?? '').toLowerCase();
}

export function diagnoseBilibiliSurfaceState(state = null, options = {}) {
  const pageFacts = state?.pageFacts ?? options.pageFacts ?? {};
  const pageType = String(state?.pageType ?? options.pageType ?? '');
  const antiCrawlSignals = uniqueSortedStrings(toArray(pageFacts?.antiCrawlSignals).filter(Boolean));
  const antiCrawlReasonCode = deriveBilibiliAntiCrawlReasonCode(antiCrawlSignals);
  const featuredAuthorCount = deriveCount(
    pageFacts?.featuredAuthorCount,
    pageFacts?.featuredAuthorCards,
    pageFacts?.featuredAuthors,
    pageFacts?.featuredAuthorUrls,
    pageFacts?.featuredAuthorNames,
    pageFacts?.featuredAuthorMids,
  );
  const featuredContentCount = deriveCount(
    pageFacts?.featuredContentCount,
    pageFacts?.featuredContentCards,
    pageFacts?.featuredContentUrls,
    pageFacts?.featuredContentTitles,
    pageFacts?.featuredContentBvids,
  );
  const authorSubpage = normalizeSubpage(pageFacts?.authorSubpage);
  const authRequired = options.authRequired === true;
  const authAvailable = options.authAvailable;
  const identityConfirmed = pageFacts?.identityConfirmed === true || pageFacts?.authenticatedSessionConfirmed === true;
  const loginStateDetected = pageFacts?.loginStateDetected === true || pageFacts?.loggedIn === true;
  const isAuthenticatedAuthorSurface = (
    pageType === 'author-list-page'
    && ['dynamic', 'follow', 'fans'].includes(authorSubpage)
  );
  const emptyShell = isAuthenticatedAuthorSurface && featuredAuthorCount === 0 && featuredContentCount === 0;

  let reasonCode = 'ok';
  if (authRequired && authAvailable === false) {
    reasonCode = 'not-logged-in';
  } else if (antiCrawlReasonCode) {
    reasonCode = antiCrawlReasonCode;
  } else if (authRequired && isAuthenticatedAuthorSurface && !identityConfirmed) {
    reasonCode = loginStateDetected ? 'content-quality-unknown' : 'not-logged-in';
  } else if (emptyShell) {
    reasonCode = 'empty-shell';
  }

  return {
    reasonCode,
    antiCrawlSignals,
    antiCrawlReasonCode,
    emptyShell,
    featuredAuthorCount,
    featuredContentCount,
    authorSubpage: authorSubpage || null,
    identityConfirmed,
    loginStateDetected,
    authenticatedSessionConfirmed: pageFacts?.authenticatedSessionConfirmed === true,
  };
}
