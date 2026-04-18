// @ts-check

import { classifyJableModelsPath } from '../site-path-classifiers.mjs';

function normalizeUrlNoFragment(input) {
  if (!input) {
    return input;
  }
  try {
    const parsed = new URL(input);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(input).split('#')[0];
  }
}

function normalizePathname(input) {
  const normalized = normalizeUrlNoFragment(input);
  if (!normalized) {
    return '/';
  }

  try {
    const parsed = new URL(normalized);
    return parsed.pathname || '/';
  } catch {
    return String(normalized || '/');
  }
}

function matchesExactPath(pathname, values = []) {
  const normalizedPath = String(pathname || '/').toLowerCase();
  return values.some((value) => String(value || '').toLowerCase() === normalizedPath);
}

function matchesPathPrefix(pathname, values = []) {
  const normalizedPath = String(pathname || '/').toLowerCase();
  return values.some((value) => {
    const normalizedValue = String(value || '').toLowerCase();
    return normalizedValue && (normalizedPath === normalizedValue || normalizedPath.startsWith(normalizedValue));
  });
}

function normalizeHostname(value) {
  return String(value || '').trim().toLowerCase();
}

function isBilibiliSearchHost(hostname) {
  return normalizeHostname(hostname) === 'search.bilibili.com';
}

function isBilibiliSpaceHost(hostname) {
  return normalizeHostname(hostname) === 'space.bilibili.com';
}

function hasConfiguredPaths(value) {
  return Array.isArray(value) && value.some((entry) => String(entry || '').trim());
}

export const CONTENT_DETAIL_PAGE_TYPES = Object.freeze(['book-detail-page', 'content-detail-page']);

export function isContentDetailPageType(pageType) {
  return CONTENT_DETAIL_PAGE_TYPES.includes(String(pageType ?? ''));
}

export function toSemanticPageType(pageType) {
  return isContentDetailPageType(pageType) ? 'content-detail-page' : String(pageType ?? '');
}

export function resolveConfiguredPageTypes(siteProfile = null) {
  const pageTypes = siteProfile?.pageTypes ?? null;
  if (!pageTypes || typeof pageTypes !== 'object') {
    return [];
  }

  const configured = [];
  if (hasConfiguredPaths(pageTypes.homeExact) || hasConfiguredPaths(pageTypes.homePrefixes)) {
    configured.push('home');
  }
  if (hasConfiguredPaths(pageTypes.searchResultsPrefixes)) {
    configured.push('search-results-page');
  }
  if (hasConfiguredPaths(pageTypes.contentDetailPrefixes)) {
    configured.push('book-detail-page');
    configured.push('content-detail-page');
  }
  if (
    hasConfiguredPaths(pageTypes.authorPrefixes)
    || hasConfiguredPaths(pageTypes.authorDetailPrefixes)
  ) {
    configured.push('author-page');
  }
  if (hasConfiguredPaths(pageTypes.authorListExact) || hasConfiguredPaths(pageTypes.authorListPrefixes)) {
    configured.push('author-list-page');
  }
  if (hasConfiguredPaths(pageTypes.chapterPrefixes)) {
    configured.push('chapter-page');
  }
  if (hasConfiguredPaths(pageTypes.historyPrefixes)) {
    configured.push('history-page');
  }
  if (hasConfiguredPaths(pageTypes.authPrefixes)) {
    configured.push('auth-page');
  }
  if (hasConfiguredPaths(pageTypes.categoryPrefixes)) {
    configured.push('category-page');
  }

  return [...new Set(configured)].sort((left, right) => left.localeCompare(right, 'en'));
}

export function inferProfilePageTypeFromPathname(pathname, siteProfile = null, currentHostname = '') {
  const pageTypes = siteProfile?.pageTypes ?? null;
  if (!pageTypes) {
    return null;
  }
  const normalizedCurrentHost = normalizeHostname(currentHostname || siteProfile?.host || '');
  const isBilibiliProfile = normalizeHostname(siteProfile?.host) === 'www.bilibili.com';

  if (String(siteProfile?.host ?? '').toLowerCase() === 'jable.tv') {
    const modelsPathKind = classifyJableModelsPath(pathname);
    if (modelsPathKind === 'list') {
      return 'author-list-page';
    }
    if (modelsPathKind === 'detail') {
      return 'author-page';
    }
  }

  if (matchesExactPath(pathname, pageTypes.homeExact) || matchesPathPrefix(pathname, pageTypes.homePrefixes)) {
    return 'home';
  }
  if (
    (!isBilibiliProfile || isBilibiliSearchHost(normalizedCurrentHost))
    && matchesPathPrefix(pathname, pageTypes.searchResultsPrefixes)
  ) {
    return 'search-results-page';
  }
  if (matchesPathPrefix(pathname, pageTypes.contentDetailPrefixes)) {
    return 'book-detail-page';
  }
  if (matchesPathPrefix(pathname, pageTypes.authorPrefixes)) {
    return 'author-page';
  }
  if (
    (matchesExactPath(pathname, pageTypes.authorListExact) || matchesPathPrefix(pathname, pageTypes.authorListPrefixes))
    && (!isBilibiliProfile || isBilibiliSpaceHost(normalizedCurrentHost))
  ) {
    return 'author-list-page';
  }
  if (matchesPathPrefix(pathname, pageTypes.authorDetailPrefixes)) {
    return 'author-page';
  }
  if (matchesPathPrefix(pathname, pageTypes.chapterPrefixes)) {
    return 'chapter-page';
  }
  if (matchesPathPrefix(pathname, pageTypes.historyPrefixes)) {
    return 'history-page';
  }
  if (matchesPathPrefix(pathname, pageTypes.authPrefixes)) {
    return 'auth-page';
  }
  if (matchesPathPrefix(pathname, pageTypes.categoryPrefixes)) {
    return 'category-page';
  }
  return null;
}

export function inferPageTypeFromUrl(input, siteProfile = null) {
  const normalized = normalizeUrlNoFragment(input);
  if (!normalized) {
    return 'unknown-page';
  }

  try {
    const parsed = new URL(normalized);
    const pathname = normalizePathname(parsed.toString());
    const profileType = inferProfilePageTypeFromPathname(pathname, siteProfile, parsed.hostname);
    if (profileType) {
      return profileType;
    }
    if (isBilibiliSearchHost(parsed.hostname) && /^\/(?:all|video|bangumi|upuser)(?:\/|$)/i.test(pathname)) {
      return 'search-results-page';
    }
    if (isBilibiliSpaceHost(parsed.hostname) && /^\/\d+\/(?:(?:upload\/)?video|dynamic|fans\/follow|fans\/fans)(?:\/|$)?/i.test(pathname)) {
      return 'author-list-page';
    }
    if (isBilibiliSpaceHost(parsed.hostname) && /^\/\d+(?:\/|$)?/i.test(pathname)) {
      return 'author-page';
    }
    if (pathname === '/' || pathname === '') {
      return 'home';
    }
    if (/\/ss(?:\/|$)/i.test(pathname) || /\/search(?:\/|$)/i.test(pathname)) {
      return 'search-results-page';
    }
    if (/\/fenlei\//i.test(pathname)) {
      return 'category-page';
    }
    if (/\/biqu\d+\/?$/i.test(pathname)) {
      return 'book-detail-page';
    }
    if (/\/author\//i.test(pathname)) {
      return 'author-page';
    }
    if (/\/biqu\d+\/\d+(?:_\d+)?\.html$/i.test(pathname)) {
      return 'chapter-page';
    }
    if (/history/i.test(pathname)) {
      return 'history-page';
    }
    if (/login|register|sign-?in|sign-?up/i.test(pathname)) {
      return 'auth-page';
    }
    return 'unknown-page';
  } catch {
    return 'unknown-page';
  }
}
