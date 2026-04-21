import { cleanText, toArray, uniqueSortedStrings } from '../../../shared/normalize.mjs';

export const DOUYIN_AUTHENTICATED_SUBPAGES = Object.freeze([
  'post',
  'like',
  'collect',
  'history',
  'follow-feed',
  'follow-users',
]);

export function normalizeDouyinAuthorSubpage(value, fallback = 'home') {
  const normalized = cleanText(value ?? '')
    .toLowerCase()
    .replace(/^\/+|\/+$/gu, '');
  if (!normalized) {
    return fallback;
  }
  if (normalized === 'favorite') {
    return 'collect';
  }
  if (normalized === 'watch_history' || normalized === 'record') {
    return 'history';
  }
  if (normalized === 'feed') {
    return 'follow-feed';
  }
  if (normalized === 'user' || normalized === 'users') {
    return 'follow-users';
  }
  return normalized;
}

export function isDouyinAuthenticatedSubpage(value) {
  return DOUYIN_AUTHENTICATED_SUBPAGES.includes(normalizeDouyinAuthorSubpage(value, ''));
}

export function detectDouyinAntiCrawlSignals({ title = '', documentText = '' } = {}) {
  const source = cleanText([title, documentText].filter(Boolean).join(' ')).toLowerCase();
  if (!source) {
    return [];
  }
  const signals = [];
  if (
    /captcha|verify|challenge/u.test(source)
    || /\u9a8c\u8bc1\u7801/u.test(source)
    || /\u4e2d\u95f4\u9875/u.test(source)
    || /middle_page_loading/u.test(source)
  ) {
    signals.push('verify');
  }
  if (/captcha/u.test(source)) {
    signals.push('captcha');
  }
  if (/challenge/u.test(source) || /\u4e2d\u95f4\u9875/u.test(source)) {
    signals.push('challenge');
  }
  if (/rate[- ]?limit|too[- ]?many/u.test(source) || /\u9891\u7e41/u.test(source) || /\u7a0d\u540e\u518d\u8bd5/u.test(source)) {
    signals.push('rate-limit');
  }
  if (/middle_page_loading/u.test(source)) {
    signals.push('middle-page-loading');
  }
  return uniqueSortedStrings(signals);
}

export function deriveDouyinAntiCrawlReasonCode(signals = []) {
  const normalized = uniqueSortedStrings(toArray(signals).map((value) => cleanText(value).toLowerCase()).filter(Boolean));
  if (normalized.some((value) => /verify|captcha|middle|middle-page-loading/u.test(value))) {
    return 'anti-crawl-verify';
  }
  if (normalized.some((value) => /rate|too[- ]?many|\u9891\u7e41|\u7a0d\u540e\u518d\u8bd5/u.test(value))) {
    return 'anti-crawl-rate-limit';
  }
  return normalized.length > 0 ? 'anti-crawl-challenge' : null;
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

export function diagnoseDouyinSurfaceState(state = null, options = {}) {
  const pageFacts = state?.pageFacts ?? options.pageFacts ?? {};
  const pageType = String(state?.pageType ?? options.pageType ?? '');
  const antiCrawlSignals = uniqueSortedStrings(toArray(pageFacts?.antiCrawlSignals).filter(Boolean));
  const antiCrawlReasonCode = deriveDouyinAntiCrawlReasonCode(antiCrawlSignals);
  const featuredAuthorCount = deriveCount(
    pageFacts?.featuredAuthorCount,
    pageFacts?.featuredAuthorCards,
    pageFacts?.featuredAuthors,
    pageFacts?.featuredAuthorUrls,
    pageFacts?.featuredAuthorNames,
    pageFacts?.featuredAuthorUserIds,
  );
  const featuredContentCount = deriveCount(
    pageFacts?.featuredContentCount,
    pageFacts?.featuredContentCards,
    pageFacts?.featuredContentUrls,
    pageFacts?.featuredContentTitles,
    pageFacts?.featuredContentVideoIds,
  );
  const authorSubpage = normalizeDouyinAuthorSubpage(pageFacts?.authorSubpage, '');
  const authRequired = options.authRequired === true;
  const authAvailable = options.authAvailable;
  const identityConfirmed = pageFacts?.identityConfirmed === true || pageFacts?.authenticatedSessionConfirmed === true;
  const loginStateDetected = pageFacts?.loginStateDetected === true || pageFacts?.loggedIn === true;
  const isAuthenticatedSurface = pageType === 'author-list-page' && isDouyinAuthenticatedSubpage(authorSubpage);
  const allowEmptyAuthenticatedSurface = authorSubpage === 'follow-feed' && identityConfirmed;
  const emptyShell = isAuthenticatedSurface && !allowEmptyAuthenticatedSurface && featuredAuthorCount === 0 && featuredContentCount === 0;

  let reasonCode = 'ok';
  if (authRequired && authAvailable === false) {
    reasonCode = 'not-logged-in';
  } else if (antiCrawlReasonCode) {
    reasonCode = antiCrawlReasonCode;
  } else if (authRequired && isAuthenticatedSurface && !identityConfirmed) {
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

export function resolveDouyinReadySelectors(pageType) {
  switch (String(pageType ?? '')) {
    case 'home':
      return [
        'input[placeholder*="\\u641c\\u7d22"]',
        'input[type="search"]',
        'form[role="search"]',
        'a[href*="/video/"]',
        'a[href*="/user/"]',
      ];
    case 'search-results-page':
      return [
        'a[href*="/video/"]',
        'a[href*="/shipin/"]',
        '[class*="search-result"]',
        '[data-e2e*="search-result"]',
        '[class*="result-item"]',
      ];
    case 'content-detail-page':
      return ['h1', 'a[href*="/user/"]', 'video'];
    case 'author-page':
      return ['h1', 'a[href*="/video/"]', '[data-e2e*="user"]'];
    case 'author-list-page':
      return ['h1', 'a[href*="/video/"]', 'a[href*="/user/"]'];
    case 'category-page':
      return ['a[href*="/video/"]', 'a[href*="/user/"]', 'input[placeholder*="\\u641c\\u7d22"]'];
    default:
      return [];
  }
}
