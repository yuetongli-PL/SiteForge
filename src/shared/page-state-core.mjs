// @ts-check

export function createPageStateCore() {
  const CONTENT_DETAIL_PAGE_TYPES = Object.freeze(['book-detail-page', 'content-detail-page']);

  function cleanText(value) {
    return String(value ?? '').replace(/\s+/gu, ' ').trim();
  }

  function toArray(value) {
    if (Array.isArray(value)) {
      return value;
    }
    return value === undefined || value === null ? [] : [value];
  }

  function uniqueSortedStrings(values = /** @type {any[]} */ ([])) {
    return [...new Set(
      toArray(values)
        .flatMap((value) => Array.isArray(value) ? value : [value])
        .map((value) => cleanText(value))
        .filter(Boolean),
    )].sort((left, right) => left.localeCompare(right, 'en'));
  }

  function uniqueValues(values = /** @type {any[]} */ ([])) {
    return [...new Set(
      toArray(values)
        .flatMap((value) => Array.isArray(value) ? value : [value])
        .map((value) => cleanText(value))
        .filter(Boolean),
    )];
  }

  function normalizeSignal(signal) {
    return cleanText(signal).toLowerCase();
  }

  function dedupeSignalsInOrder(signals = /** @type {any[]} */ ([])) {
    const seen = new Set();
    const result = /** @type {any[]} */ ([]);
    for (const signal of toArray(signals).map(normalizeSignal).filter(Boolean)) {
      if (seen.has(signal)) {
        continue;
      }
      seen.add(signal);
      result.push(signal);
    }
    return result;
  }

  function deriveRuntimeEvidence(pageFacts = null, {
    antiCrawlReasonCode = null,
  } = /** @type {any} */ ({})) {
    const antiCrawlSignals = dedupeSignalsInOrder(pageFacts?.antiCrawlSignals);
    const resolvedAntiCrawlReasonCode = cleanText(pageFacts?.antiCrawlReasonCode ?? antiCrawlReasonCode) || null;
    const antiCrawlDetected = (
      pageFacts?.antiCrawlDetected === true
      || antiCrawlSignals.length > 0
      || Boolean(resolvedAntiCrawlReasonCode)
    );
    if (!antiCrawlDetected) {
      return null;
    }

    return {
      antiCrawlDetected: true,
      antiCrawlSignals,
      antiCrawlReasonCode: resolvedAntiCrawlReasonCode || 'anti-crawl',
      antiCrawlEvidence: {
        governanceCategory: 'anti-crawl',
        reasonCode: resolvedAntiCrawlReasonCode || 'anti-crawl',
        signals: antiCrawlSignals,
      },
      networkRiskDetected: true,
      noDedicatedIpRiskDetected: true,
      noDedicatedIpRiskEvidence: {
        governanceCategory: 'no-dedicated-ip',
        reasonCode: resolvedAntiCrawlReasonCode || 'anti-crawl',
      },
    };
  }

  function mergePageStateEvidence(pageFacts = null, runtimeEvidence = null, options = /** @type {any} */ ({})) {
    const derived = deriveRuntimeEvidence(pageFacts, options);
    const mergedRuntimeEvidence = (derived || runtimeEvidence)
      ? {
        ...(derived ?? {}),
        ...(runtimeEvidence ?? {}),
      }
      : null;
    const mergedPageFacts = mergedRuntimeEvidence && pageFacts
      ? {
        ...pageFacts,
        ...mergedRuntimeEvidence,
      }
      : pageFacts;

    return {
      pageFacts: mergedPageFacts,
      runtimeEvidence: mergedRuntimeEvidence,
    };
  }

  function normalizeUrlNoFragment(input, baseUrl = undefined) {
    if (!input) {
      return input ? String(input).split('#')[0] : '';
    }
    try {
      const parsed = baseUrl ? new URL(input, baseUrl) : new URL(input);
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

  function matchesExactPath(pathname, values = /** @type {any[]} */ ([])) {
    const normalizedPath = String(pathname || '/').toLowerCase();
    return toArray(values).some((value) => String(value || '').toLowerCase() === normalizedPath);
  }

  function matchesPathPrefix(pathname, values = /** @type {any[]} */ ([])) {
    const normalizedPath = String(pathname || '/').toLowerCase();
    return toArray(values).some((value) => {
      const normalizedValue = String(value || '').toLowerCase();
      return normalizedValue && (normalizedPath === normalizedValue || normalizedPath.startsWith(normalizedValue));
    });
  }

  function hasConfiguredPaths(value) {
    return Array.isArray(value) && value.some((entry) => String(entry || '').trim());
  }

  function isContentDetailPageType(pageType) {
    return CONTENT_DETAIL_PAGE_TYPES.includes(String(pageType ?? ''));
  }

  function toSemanticPageType(pageType) {
    return isContentDetailPageType(pageType) ? 'content-detail-page' : String(pageType ?? '');
  }

  function resolveConfiguredPageTypes(siteProfile = null) {
    const pageTypes = siteProfile?.pageTypes ?? null;
    if (!pageTypes || typeof pageTypes !== 'object') {
      return [];
    }

    const configured = /** @type {any[]} */ ([]);
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
    if (hasConfiguredPaths(pageTypes.authorPrefixes) || hasConfiguredPaths(pageTypes.authorDetailPrefixes)) {
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

  function inferProfilePageTypeFromPathname(pathname, siteProfile = null) {
    const pageTypes = siteProfile?.pageTypes ?? null;
    if (!pageTypes) {
      return null;
    }

    if (matchesExactPath(pathname, pageTypes.homeExact) || matchesPathPrefix(pathname, pageTypes.homePrefixes)) {
      return 'home';
    }
    if (matchesPathPrefix(pathname, pageTypes.searchResultsPrefixes)) {
      return 'search-results-page';
    }
    if (matchesPathPrefix(pathname, pageTypes.contentDetailPrefixes)) {
      return 'book-detail-page';
    }
    if (matchesPathPrefix(pathname, pageTypes.authorPrefixes)) {
      return 'author-page';
    }
    if (matchesExactPath(pathname, pageTypes.authorListExact) || matchesPathPrefix(pathname, pageTypes.authorListPrefixes)) {
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

  function normalizeHostname(value) {
    return String(value ?? '').trim().toLowerCase();
  }

  function classifyJableModelsPath(pathname) {
    const normalized = String(pathname || '/').trim().toLowerCase() || '/';
    if (normalized === '/models' || normalized === '/models/') {
      return 'list';
    }
    if (!normalized.startsWith('/models/')) {
      return null;
    }
    const remainder = normalized.slice('/models/'.length).replace(/^\/+|\/+$/gu, '');
    if (!remainder) {
      return 'list';
    }
    const [firstSegment] = remainder.split('/');
    if (!firstSegment) {
      return 'list';
    }
    if (/^\d+$/u.test(firstSegment)) {
      return 'list';
    }
    return 'detail';
  }

  function inferBuiltinSiteSpecificPageType({
    inputUrl = '',
    parsedUrl = null,
    pathname = '/',
    hostname = '',
  } = /** @type {any} */ ({})) {
    const normalizedHostname = normalizeHostname(hostname || parsedUrl?.hostname || '');
    if (normalizedHostname === 'jable.tv') {
      const modelsPathKind = classifyJableModelsPath(pathname);
      if (modelsPathKind === 'list') {
        return 'author-list-page';
      }
      if (modelsPathKind === 'detail') {
        return 'author-page';
      }
    }

    if (normalizedHostname === 'search.bilibili.com' && /^\/(?:all|video|bangumi|upuser)(?:\/|$)/iu.test(pathname)) {
      return 'search-results-page';
    }
    if (
      ['www.bilibili.com', 'search.bilibili.com', 'space.bilibili.com'].includes(normalizedHostname)
      && (/^\/video\/[^/]+(?:\/|$)/iu.test(pathname) || /^\/bangumi\/play\/[^/]+(?:\/|$)/iu.test(pathname))
    ) {
      return 'book-detail-page';
    }
    if (normalizedHostname === 'space.bilibili.com' && /^\/\d+\/(?:(?:upload\/)?video|dynamic|fans\/follow|fans\/fans)(?:\/|$)?/iu.test(pathname)) {
      return 'author-list-page';
    }
    if (normalizedHostname === 'space.bilibili.com' && /^\/\d+(?:\/|$)?/iu.test(pathname)) {
      return 'author-page';
    }

    if (normalizedHostname === 'www.douyin.com') {
      const normalizedPath = String(pathname || '/').trim().toLowerCase() || '/';
      if (normalizedPath === '/' || normalizedPath === '') {
        return 'home';
      }
      if (normalizedPath.startsWith('/search')) {
        return 'search-results-page';
      }
      if (normalizedPath.startsWith('/video/')) {
        return 'book-detail-page';
      }
      if (normalizedPath === '/shipin' || normalizedPath === '/shipin/') {
        return 'category-page';
      }
      if (normalizedPath.startsWith('/shipin/')) {
        return 'book-detail-page';
      }
      if (normalizedPath === '/follow' || normalizedPath === '/follow/') {
        return 'author-list-page';
      }
      if (normalizedPath.startsWith('/user/self')) {
        return 'author-list-page';
      }
      if (normalizedPath.startsWith('/user/')) {
        return 'author-page';
      }
    }

    try {
      const parsed = parsedUrl ?? new URL(String(inputUrl ?? ''));
      if (/history/i.test(parsed.pathname || '/')) {
        return 'history-page';
      }
    } catch {
      // Ignore invalid URL values.
    }

    return null;
  }

  function inferPageTypeFromUrl(input, siteProfile = null, { inferSiteSpecificPageType = inferBuiltinSiteSpecificPageType } = /** @type {any} */ ({})) {
    const normalized = normalizeUrlNoFragment(input);
    if (!normalized) {
      return 'unknown-page';
    }

    try {
      const parsed = new URL(normalized);
      const siteSpecificType = inferSiteSpecificPageType?.({
        inputUrl: parsed.toString(),
        parsedUrl: parsed,
        pathname: parsed.pathname || '/',
        hostname: parsed.hostname,
        siteProfile,
      });
      if (siteSpecificType) {
        return siteSpecificType === 'content-detail-page' ? 'book-detail-page' : siteSpecificType;
      }

      const pathname = normalizePathname(parsed.toString());
      const profileType = inferProfilePageTypeFromPathname(pathname, siteProfile);
      if (profileType) {
        return profileType;
      }
      if (pathname === '/' || pathname === '') {
        return 'home';
      }
      if (/\/ss(?:\/|$)/iu.test(pathname) || /\/search(?:\/|$)/iu.test(pathname)) {
        return 'search-results-page';
      }
      if (/\/fenlei\//iu.test(pathname)) {
        return 'category-page';
      }
      if (/\/biqu\d+\/?$/iu.test(pathname)) {
        return 'book-detail-page';
      }
      if (/\/author\//iu.test(pathname)) {
        return 'author-page';
      }
      if (/\/biqu\d+\/\d+(?:_\d+)?\.html$/iu.test(pathname)) {
        return 'chapter-page';
      }
      if (/history/iu.test(pathname)) {
        return 'history-page';
      }
      if (/login|register|sign-?in|sign-?up/iu.test(pathname)) {
        return 'auth-page';
      }
      return 'unknown-page';
    } catch {
      return 'unknown-page';
    }
  }

  return {
    CONTENT_DETAIL_PAGE_TYPES,
    cleanText,
    toArray,
    uniqueSortedStrings,
    uniqueValues,
    normalizeSignal,
    dedupeSignalsInOrder,
    deriveRuntimeEvidence,
    mergePageStateEvidence,
    normalizeUrlNoFragment,
    normalizePathname,
    isContentDetailPageType,
    toSemanticPageType,
    resolveConfiguredPageTypes,
    inferProfilePageTypeFromPathname,
    normalizeHostname,
    inferBuiltinSiteSpecificPageType,
    inferPageTypeFromUrl,
  };
}
