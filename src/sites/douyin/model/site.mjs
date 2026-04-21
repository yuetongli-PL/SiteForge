import { cleanText } from '../../../shared/normalize.mjs';
import {
  DOUYIN_AUTHENTICATED_SUBPAGES,
  detectDouyinAntiCrawlSignals,
  deriveDouyinAntiCrawlReasonCode,
  diagnoseDouyinSurfaceState,
  isDouyinAuthenticatedSubpage,
  normalizeDouyinAuthorSubpage,
  resolveDouyinReadySelectors,
} from './diagnosis.mjs';

export {
  DOUYIN_AUTHENTICATED_SUBPAGES,
  detectDouyinAntiCrawlSignals,
  deriveDouyinAntiCrawlReasonCode,
  diagnoseDouyinSurfaceState,
  isDouyinAuthenticatedSubpage,
  normalizeDouyinAuthorSubpage,
  resolveDouyinReadySelectors,
} from './diagnosis.mjs';

export const DOUYIN_HOSTS = Object.freeze(['www.douyin.com']);

export const DOUYIN_AUTH_VALIDATION_SAMPLE_PRIORITY = Object.freeze([
  'likesUrl',
  'selfPostsUrl',
  'followFeedUrl',
  'followUsersUrl',
  'collectionsUrl',
  'historyUrl',
]);

export const DOUYIN_PREFERS_VISIBLE_BROWSER = true;

export function isDouyinHost(value) {
  return DOUYIN_HOSTS.includes(String(value ?? '').trim().toLowerCase());
}

export function isDouyinSiteProfile(profile = null, inputUrl = '') {
  if (isDouyinHost(profile?.host)) {
    return true;
  }
  try {
    return isDouyinHost(new URL(String(inputUrl ?? '')).hostname);
  } catch {
    return false;
  }
}

export function resolveDouyinAuthorSubpageFromUrl(input, fallback = 'home') {
  try {
    const parsed = new URL(String(input ?? ''));
    const pathname = cleanText(parsed.pathname).replace(/^\/+|\/+$/gu, '');
    if (pathname === 'follow') {
      return normalizeDouyinAuthorSubpage(parsed.searchParams.get('tab') || 'feed', 'follow-feed');
    }
    if (pathname === 'user/self') {
      return normalizeDouyinAuthorSubpage(parsed.searchParams.get('showTab') || 'post', 'post');
    }
    if (pathname.startsWith('user/')) {
      return normalizeDouyinAuthorSubpage(parsed.searchParams.get('showTab') || fallback, fallback);
    }
  } catch {
    // Ignore malformed URLs.
  }
  return fallback;
}

export function resolveDouyinHeadlessDefault(inputUrl = '', fallback = true, profile = null) {
  return isDouyinSiteProfile(profile, inputUrl) ? false : fallback;
}

export function inferDouyinPageTypeFromUrl(input) {
  try {
    const parsed = new URL(String(input ?? ''));
    if (!isDouyinHost(parsed.hostname)) {
      return null;
    }
    const pathname = String(parsed.pathname || '/').trim() || '/';
    const normalizedPath = pathname.toLowerCase();
    if (normalizedPath === '/' || normalizedPath === '') {
      return 'home';
    }
    if (normalizedPath.startsWith('/search')) {
      return 'search-results-page';
    }
    if (normalizedPath.startsWith('/video/')) {
      return 'content-detail-page';
    }
    if (normalizedPath === '/shipin' || normalizedPath === '/shipin/') {
      return 'category-page';
    }
    if (normalizedPath.startsWith('/shipin/')) {
      return 'content-detail-page';
    }
    if (normalizedPath === '/follow' || normalizedPath === '/follow/') {
      return 'author-list-page';
    }
    if (normalizedPath === '/user/self' || normalizedPath === '/user/self/') {
      return 'author-list-page';
    }
    if (normalizedPath.startsWith('/user/self')) {
      return 'author-list-page';
    }
    if (normalizedPath.startsWith('/user/')) {
      return 'author-page';
    }
    return null;
  } catch {
    return null;
  }
}

