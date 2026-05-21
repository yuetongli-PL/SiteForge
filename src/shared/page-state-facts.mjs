// @ts-check

export function createPageStateFactsRuntime(core) {
  const {
    cleanText,
    isContentDetailPageType,
    mergePageStateEvidence,
    normalizeHostname,
    normalizeSignal,
    normalizeUrlNoFragment,
    toArray,
    uniqueSortedStrings,
    uniqueValues,
  } = core;

  const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;

  function toDate(value) {
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
    }
    if (typeof value === 'number') {
      const numeric = value > 1e12 ? value : value * 1_000;
      const date = new Date(numeric);
      return Number.isFinite(date.getTime()) ? date : null;
    }
    if (typeof value === 'string' && value.trim()) {
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? date : null;
    }
    return null;
  }

  function getShanghaiParts(value) {
    const date = toDate(value);
    if (!date) {
      return null;
    }
    const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds(),
    };
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function formatShanghaiDayKey(value) {
    const parts = getShanghaiParts(value);
    if (!parts) {
      return null;
    }
    return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
  }

  function formatShanghaiDateTime(value) {
    const parts = getShanghaiParts(value);
    if (!parts) {
      return null;
    }
    return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
  }

  function deriveDouyinTimeConfidence(precision, timeSource) {
    if (!precision) {
      return null;
    }
    if (timeSource === 'detail-fallback' || timeSource === 'create-time' || timeSource === 'published-at') {
      return 'high';
    }
    if (precision === 'exact') {
      return 'medium';
    }
    return 'low';
  }

  function normalizeDouyinPublishFields(card = /** @type {any} */ ({})) {
    const timeText = cleanText(card.timeText ?? card.publishTimeText ?? card.publishText ?? '');
    const publishedAt = toDate(card.publishedAt ?? null) ?? toDate(card.createTime ?? card.create_time ?? card.publishTimestamp ?? null);
    const timeSource = publishedAt
      ? cleanText(card.timeSource) || (card.createTime != null || card.create_time != null ? 'create-time' : 'published-at')
      : null;
    const timePrecision = publishedAt ? 'exact' : null;
    return {
      publishedAt: publishedAt ? publishedAt.toISOString() : null,
      publishedDateLocal: publishedAt ? formatShanghaiDateTime(publishedAt) : null,
      publishedDayKey: publishedAt ? formatShanghaiDayKey(publishedAt) : null,
      timeText: timeText || null,
      timePrecision,
      timeSource,
      timeConfidence: deriveDouyinTimeConfidence(timePrecision, timeSource),
    };
  }

  function escapeRegExp(value) {
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  }

  function parseDouyinCreateTimeMapFromHtml(html, videoIds = /** @type {any[]} */ ([])) {
    const source = String(html ?? '');
    if (!source) {
      return new Map();
    }
    const results = new Map();
    const tryRecord = (videoId, rawTimestamp) => {
      const normalizedVideoId = cleanText(videoId);
      const numeric = Number(rawTimestamp);
      if (!normalizedVideoId || !Number.isFinite(numeric) || numeric <= 0 || results.has(normalizedVideoId)) {
        return;
      }
      results.set(normalizedVideoId, numeric > 1e12 ? Math.trunc(numeric / 1_000) : Math.trunc(numeric));
    };

    const broadPatterns = [
      /"awemeId"\s*:\s*"(\d{10,20})"[\s\S]{0,1200}?"createTime"\s*:\s*(\d{10,13})/gu,
      /"awemeId"\s*:\s*"(\d{10,20})"[\s\S]{0,1200}?"create_time"\s*:\s*(\d{10,13})/gu,
      /"group_id"\s*:\s*"(\d{10,20})"[\s\S]{0,1200}?"create_time"\s*:\s*(\d{10,13})/gu,
      /"video_id"\s*:\s*"(\d{10,20})"[\s\S]{0,1200}?"createTime"\s*:\s*(\d{10,13})/gu,
    ];
    for (const pattern of broadPatterns) {
      let matched = pattern.exec(source);
      while (matched) {
        tryRecord(matched[1], matched[2]);
        matched = pattern.exec(source);
      }
    }

    for (const rawVideoId of videoIds) {
      const videoId = cleanText(rawVideoId);
      if (!videoId || results.has(videoId)) {
        continue;
      }
      const targetedPatterns = [
        new RegExp(`"awemeId"\\s*:\\s*"${escapeRegExp(videoId)}"[\\s\\S]{0,1500}?"createTime"\\s*:\\s*(\\d{10,13})`, 'u'),
        new RegExp(`"awemeId"\\s*:\\s*"${escapeRegExp(videoId)}"[\\s\\S]{0,1500}?"create_time"\\s*:\\s*(\\d{10,13})`, 'u'),
        new RegExp(`"group_id"\\s*:\\s*"${escapeRegExp(videoId)}"[\\s\\S]{0,1500}?"create_time"\\s*:\\s*(\\d{10,13})`, 'u'),
      ];
      for (const pattern of targetedPatterns) {
        const matched = source.match(pattern);
        if (matched?.[1]) {
          tryRecord(videoId, matched[1]);
          break;
        }
      }
    }

    return results;
  }

  function normalizeDouyinAuthorSubpage(value, fallback = 'home') {
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

  function detectDouyinAntiCrawlSignals({ title = '', documentText = '' } = /** @type {any} */ ({})) {
    const source = cleanText([title, documentText].filter(Boolean).join(' ')).toLowerCase();
    if (!source) {
      return [];
    }
    const signals = /** @type {any[]} */ ([]);
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

  function deriveDouyinAntiCrawlReasonCode(signals = /** @type {any[]} */ ([])) {
    const normalized = uniqueSortedStrings(toArray(signals).map((value) => cleanText(value).toLowerCase()).filter(Boolean));
    if (normalized.some((value) => /verify|captcha|middle|middle-page-loading/u.test(value))) {
      return 'anti-crawl-verify';
    }
    if (normalized.some((value) => /rate|too[- ]?many|\u9891\u7e41|\u7a0d\u540e\u518d\u8bd5/u.test(value))) {
      return 'anti-crawl-rate-limit';
    }
    return normalized.length > 0 ? 'anti-crawl-challenge' : null;
  }

  function deriveBilibiliAntiCrawlReasonCode(signals = /** @type {any[]} */ ([])) {
    const normalized = uniqueSortedStrings(toArray(signals).map(normalizeSignal).filter(Boolean));
    if (normalized.some((signal) => /verify|challenge|captcha|\u767b\u5f55\u6821\u9a8c|\u5b89\u5168\u9a8c\u8bc1/u.test(signal))) {
      return 'anti-crawl-verify';
    }
    if (normalized.some((signal) => /rate|\u9891\u7e41|\u7a0d\u540e\u518d\u8bd5|too[- ]many|\u98ce\u63a7/u.test(signal))) {
      return 'anti-crawl-rate-limit';
    }
    return normalized.length > 0 ? 'anti-crawl' : null;
  }

  function resolveDouyinAuthorSubpageFromUrl(input, fallback = 'home') {
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

  function canonicalizeDouyinAuthorUrl(value, baseUrl = undefined) {
    const normalized = normalizeUrlNoFragment(value, baseUrl);
    if (!/\/user\/[^/?#]+/iu.test(normalized) || /\/user\/self(?:[/?#]|$)/iu.test(normalized)) {
      return null;
    }
    return normalized;
  }

  function canonicalizeDouyinVideoUrl(value, baseUrl = undefined) {
    const normalized = normalizeUrlNoFragment(value, baseUrl);
    return /\/video\/\d+/iu.test(normalized) ? normalized : null;
  }

  function bilibiliContentTypeFromUrl(value) {
    const normalizedValue = cleanText(value);
    if (!normalizedValue) {
      return null;
    }
    if (/\/bangumi\/play\//iu.test(normalizedValue)) {
      return 'bangumi';
    }
    if (/\/video\/BV[0-9A-Za-z]+/iu.test(normalizedValue)) {
      return 'video';
    }
    if (/space\.bilibili\.com\/\d+/iu.test(normalizedValue) || /\/upuser(?:\/|$)/iu.test(normalizedValue)) {
      return 'author';
    }
    return null;
  }

  function bilibiliBvidFromUrl(value) {
    return cleanText(value?.match(/\/video\/(BV[0-9A-Za-z]+)/u)?.[1] || '') || null;
  }

  function bilibiliMidFromUrl(value) {
    return cleanText(value?.match(/space\.bilibili\.com\/(\d+)/u)?.[1] || '') || null;
  }

  function normalizeBilibiliTitleText(value, kind = 'generic') {
    const normalizedValue = cleanText(value);
    if (!normalizedValue) {
      return null;
    }

    let cleaned = normalizedValue
      .replace(/\s*[-_]\s*(?:\u54d4\u54e9\u54d4\u54e9|bilibili).*$/iu, '')
      .replace(/\s*[|]\s*(?:\u54d4\u54e9\u54d4\u54e9|bilibili).*$/iu, '')
      .replace(/\s*-\s*[^-]*\u4e2a\u4eba\u4e3b\u9875.*$/iu, '')
      .trim();

    if (kind === 'author') {
      const authorMatch = cleaned.match(/^(.+?)(?:\u7684?\u4e2a\u4eba(?:\u7a7a\u95f4|\u4e3b\u9875).*)?$/u);
      if (authorMatch?.[1]) {
        cleaned = cleanText(authorMatch[1]);
      }
    }

    return cleanText(cleaned) || null;
  }

  function bilibiliCategoryNameFromPath(value) {
    const normalizedPath = String(value || '').toLowerCase();
    if (normalizedPath.startsWith('/v/popular/')) {
      return '\u70ed\u95e8';
    }
    if (normalizedPath.startsWith('/anime/')) {
      return '\u756a\u5267';
    }
    if (normalizedPath.startsWith('/movie/')) {
      return '\u7535\u5f71';
    }
    if (normalizedPath.startsWith('/guochuang/')) {
      return '\u56fd\u521b';
    }
    if (normalizedPath.startsWith('/tv/')) {
      return '\u7535\u89c6\u5267';
    }
    if (normalizedPath.startsWith('/variety/')) {
      return '\u7efc\u827a';
    }
    if (normalizedPath.startsWith('/documentary/')) {
      return '\u7eaa\u5f55\u7247';
    }
    if (normalizedPath.startsWith('/knowledge/')) {
      return '\u77e5\u8bc6';
    }
    if (normalizedPath.startsWith('/music/')) {
      return '\u97f3\u4e50';
    }
    if (normalizedPath.startsWith('/game/')) {
      return '\u6e38\u620f';
    }
    if (normalizedPath.startsWith('/food/')) {
      return '\u7f8e\u98df';
    }
    if (normalizedPath.startsWith('/sports/')) {
      return '\u8fd0\u52a8';
    }
    if (normalizedPath.startsWith('/c/')) {
      return '\u5206\u533a';
    }
    return null;
  }

  function normalizeXiaohongshuTitleText(value, kind = 'generic') {
    const normalizedValue = cleanText(value);
    if (!normalizedValue) {
      return null;
    }

    let cleaned = normalizedValue
      .replace(/\s*[-_|]\s*\u5c0f\u7ea2\u4e66.*$/iu, '')
      .replace(/\s*[-_|]\s*\u641c\u7d22\u7ed3\u679c.*$/iu, '')
      .trim();

    if (kind === 'search') {
      const searchMatch = cleaned.match(/(?:\u641c\u7d22|search)\s*[:\uff1a"']*\s*(.+?)(?:\s*[-_|]|$)/iu);
      if (searchMatch?.[1]) {
        cleaned = cleanText(searchMatch[1]);
      }
    }

    if (kind === 'author') {
      const authorMatch = cleaned.match(/^(.+?)(?:\u7684?(?:\u4e2a\u4eba\u4e3b\u9875|\u4e3b\u9875).*)?$/u);
      if (authorMatch?.[1]) {
        cleaned = cleanText(authorMatch[1]);
      }
    }

    return cleanText(cleaned) || null;
  }

  function normalizeXiaohongshuLooseText(value) {
    const normalizedValue = cleanText(value);
    if (!normalizedValue) {
      return null;
    }
    return /^(?:undefined|null|nan)$/iu.test(normalizedValue) ? null : normalizedValue;
  }

  function canonicalizeXiaohongshuNoteUrl(value, baseUrl = undefined) {
    const normalized = normalizeUrlNoFragment(value, baseUrl);
    if (!/\/explore\/[^/?#]+/iu.test(normalized)) {
      return null;
    }
    try {
      const parsed = new URL(normalized, baseUrl);
      if (normalizeHostname(parsed.hostname) !== 'www.xiaohongshu.com' || !/^\/explore\/[^/?#]+/iu.test(parsed.pathname)) {
        return null;
      }
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return normalized.split('?')[0] || null;
    }
  }

  function canonicalizeXiaohongshuAuthorUrl(value, baseUrl = undefined) {
    const normalized = normalizeUrlNoFragment(value, baseUrl);
    if (!/\/user\/profile\/[^/?#]+/iu.test(normalized)) {
      return null;
    }
    try {
      const parsed = new URL(normalized, baseUrl);
      if (normalizeHostname(parsed.hostname) !== 'www.xiaohongshu.com' || !/^\/user\/profile\/[^/?#]+/iu.test(parsed.pathname)) {
        return null;
      }
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return normalized.split('?')[0] || null;
    }
  }

  function xiaohongshuNoteIdFromUrl(value) {
    return cleanText(value?.match(/\/explore\/([^/?#]+)/u)?.[1] || '') || null;
  }

  function xiaohongshuUserIdFromUrl(value) {
    return cleanText(value?.match(/\/user\/profile\/([^/?#]+)/u)?.[1] || '') || null;
  }

  function extractBalancedObjectLiteral(source, markers = /** @type {any[]} */ ([])) {
    const input = String(source ?? '');
    if (!input) {
      return null;
    }
    for (const marker of toArray(markers).map((value) => String(value ?? '')).filter(Boolean)) {
      const markerIndex = input.indexOf(marker);
      if (markerIndex < 0) {
        continue;
      }
      const braceIndex = input.indexOf('{', markerIndex + marker.length);
      if (braceIndex < 0) {
        continue;
      }
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let index = braceIndex; index < input.length; index += 1) {
        const character = input[index];
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (character === '\\') {
            escaped = true;
          } else if (character === '"') {
            inString = false;
          }
          continue;
        }
        if (character === '"') {
          inString = true;
          continue;
        }
        if (character === '{') {
          depth += 1;
          continue;
        }
        if (character === '}') {
          depth -= 1;
          if (depth === 0) {
            return input.slice(braceIndex, index + 1);
          }
        }
      }
    }
    return null;
  }

  function replaceBareUndefinedWithNull(source) {
    const input = String(source ?? '');
    if (!input.includes('undefined')) {
      return input;
    }
    let result = '';
    let inString = false;
    let escaped = false;
    for (let index = 0; index < input.length; index += 1) {
      const character = input[index];
      if (inString) {
        result += character;
        if (escaped) {
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }
      if (character === '"') {
        inString = true;
        result += character;
        continue;
      }
      if (
        input.startsWith('undefined', index)
        && !/[0-9A-Za-z_$]/u.test(input[index - 1] ?? '')
        && !/[0-9A-Za-z_$]/u.test(input[index + 'undefined'.length] ?? '')
      ) {
        result += 'null';
        index += 'undefined'.length - 1;
        continue;
      }
      result += character;
    }
    return result;
  }

  function parseJsonLikeObjectLiteral(source) {
    const input = cleanText(source);
    if (!input) {
      return null;
    }
    try {
      return JSON.parse(replaceBareUndefinedWithNull(input));
    } catch {
      return null;
    }
  }

  function extractXiaohongshuInitialStateFromHtml(source) {
    const objectLiteral = extractBalancedObjectLiteral(source, ['window.__INITIAL_STATE__=', '__INITIAL_STATE__=']);
    return objectLiteral ? parseJsonLikeObjectLiteral(objectLiteral) : null;
  }

  function mergeSparseObjects(primary = /** @type {any} */ ({}), secondary = /** @type {any} */ ({})) {
    const result = { ...(primary ?? {}) };
    for (const [key, value] of Object.entries(secondary ?? {})) {
      if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
        continue;
      }
      const current = result[key];
      if (current == null || current === '' || (Array.isArray(current) && current.length === 0)) {
        result[key] = value;
      }
    }
    return result;
  }

  function buildStateReaders({
    finalUrl = '',
    rawHtml = '',
    documentText = '',
    queryInputValue = '',
    textFromSelectors = () => null,
    hrefFromSelectors = () => null,
    textsFromSelectors = () => [],
    hrefsFromSelectors = () => [],
    metaContent = () => null,
    extractStructuredBilibiliAuthorCards = null,
  } = /** @type {any} */ ({})) {
    const normalizedFinalUrl = normalizeUrlNoFragment(finalUrl) || cleanText(finalUrl);
    const rawHtmlSource = typeof rawHtml === 'function' ? String(rawHtml() ?? '') : String(rawHtml ?? '');
    const readDocumentText = (() => {
      let cached = null;
      return () => {
        if (cached !== null) {
          return cached;
        }
        cached = cleanText(typeof documentText === 'function' ? documentText() : documentText);
        return cached;
      };
    })();
    const normalizeUrl = (value) => normalizeUrlNoFragment(value, normalizedFinalUrl);
    const readText = (selectors = /** @type {any[]} */ ([])) => cleanText(textFromSelectors(selectors)) || null;
    const readHref = (selectors = /** @type {any[]} */ ([])) => {
      const value = hrefFromSelectors(selectors);
      return value ? normalizeUrl(value) : null;
    };
    const readTexts = (selectors = /** @type {any[]} */ ([]), limit = 20) => uniqueValues(textsFromSelectors(selectors)).slice(0, limit);
    const readHrefs = (selectors = /** @type {any[]} */ ([]), limit = 20) => uniqueValues(
      hrefsFromSelectors(selectors).map((value) => normalizeUrl(value)),
    ).slice(0, limit);
    const readPattern = (patterns = /** @type {any[]} */ ([])) => {
      const source = readDocumentText();
      for (const pattern of patterns) {
        const matched = source.match(pattern);
        const value = cleanText(matched?.[1] ?? '');
        if (value) {
          return value;
        }
      }
      return null;
    };
    return {
      normalizedFinalUrl,
      rawHtmlSource,
      readDocumentText,
      readText,
      readHref,
      readTexts,
      readHrefs,
      readPattern,
      readMetaContent: (name) => metaContent(name) ?? null,
      queryInputValue: cleanText(queryInputValue) || null,
      extractStructuredBilibiliAuthorCards,
      normalizeUrl,
    };
  }

  function derivePageFacts({
    pageType,
    siteProfile = null,
    finalUrl = '',
    title = '',
    rawHtml = '',
    queryInputValue = '',
    textFromSelectors = () => null,
    hrefFromSelectors = () => null,
    textsFromSelectors = () => [],
    hrefsFromSelectors = () => [],
    metaContent = () => null,
    documentText = '',
    extractStructuredBilibiliAuthorCards = null,
  } = /** @type {any} */ ({})) {
    const readers = buildStateReaders({
      finalUrl,
      rawHtml,
      documentText,
      queryInputValue,
      textFromSelectors,
      hrefFromSelectors,
      textsFromSelectors,
      hrefsFromSelectors,
      metaContent,
      extractStructuredBilibiliAuthorCards,
    });
    const normalizedFinalUrl = readers.normalizedFinalUrl;
    const parsedUrl = (() => {
      try {
        return new URL(normalizedFinalUrl || finalUrl);
      } catch {
        return null;
      }
    })();
    const pathname = parsedUrl?.pathname || '/';
    const currentHostname = normalizeHostname(parsedUrl?.hostname ?? '');
    const profileHost = normalizeHostname(siteProfile?.host ?? '');
    const isBilibiliProfile = ['www.bilibili.com', 'search.bilibili.com', 'space.bilibili.com'].includes(profileHost)
      || ['www.bilibili.com', 'search.bilibili.com', 'space.bilibili.com'].includes(currentHostname);
    const isDouyinProfile = profileHost === 'www.douyin.com' || currentHostname === 'www.douyin.com';
    const isXiaohongshuProfile = profileHost === 'www.xiaohongshu.com' || currentHostname === 'www.xiaohongshu.com';
    const finalizeFacts = (facts, options = /** @type {any} */ ({})) => mergePageStateEvidence(facts, null, options).pageFacts;
    const readXiaohongshuInitialState = (() => {
      let cached = null;
      let attempted = false;
      return () => {
        if (attempted) {
          return cached;
        }
        attempted = true;
        cached = isXiaohongshuProfile ? extractXiaohongshuInitialStateFromHtml(readers.rawHtmlSource) : null;
        return cached;
      };
    })();
    const buildXiaohongshuNoteUrl = (noteId) => {
      const normalizedNoteId = cleanText(noteId);
      return normalizedNoteId ? `https://www.xiaohongshu.com/explore/${normalizedNoteId}` : null;
    };
    const buildXiaohongshuAuthorUrl = (userId) => {
      const normalizedUserId = normalizeXiaohongshuLooseText(userId);
      return normalizedUserId ? `https://www.xiaohongshu.com/user/profile/${normalizedUserId}` : null;
    };
    const normalizeXiaohongshuAuthorFields = (user = /** @type {any} */ ({}), fallback = /** @type {any} */ ({})) => {
      const normalizedUser = user && typeof user === 'object' ? user : {};
      const authorUserId = normalizeXiaohongshuLooseText(
        normalizedUser.userId
        ?? normalizedUser.userid
        ?? fallback.authorUserId
        ?? fallback.userId
        ?? '',
      ) || null;
      const authorName = normalizeXiaohongshuLooseText(
        normalizedUser.nickname
        ?? normalizedUser.nickName
        ?? normalizedUser.name
        ?? normalizedUser.userName
        ?? fallback.authorName
        ?? '',
      ) || null;
      const authorRedId = normalizeXiaohongshuLooseText(normalizedUser.redId ?? fallback.authorRedId ?? '') || null;
      const authorNavigationUrl = normalizeUrlNoFragment(
        normalizedUser.url
        || normalizedUser.href
        || fallback.authorNavigationUrl
        || buildXiaohongshuAuthorUrl(authorUserId)
        || fallback.authorUrl
        || '',
        normalizedFinalUrl,
      ) || fallback.authorNavigationUrl || fallback.authorUrl || null;
      const authorUrl = canonicalizeXiaohongshuAuthorUrl(authorNavigationUrl || '', normalizedFinalUrl)
        || fallback.authorUrl
        || null;
      return {
        authorName,
        authorUrl,
        authorNavigationUrl,
        authorUserId: authorUserId || xiaohongshuUserIdFromUrl(authorUrl),
        authorRedId,
        userId: authorUserId || xiaohongshuUserIdFromUrl(authorUrl),
      };
    };
    const normalizeXiaohongshuTagNames = (value) => {
      const tags = /** @type {any[]} */ ([]);
      for (const entry of toArray(value)) {
        if (!entry) {
          continue;
        }
        if (typeof entry === 'string') {
          tags.push(cleanText(entry));
          continue;
        }
        if (typeof entry === 'object') {
          tags.push(
            cleanText(entry.name)
            || cleanText(entry.tagName)
            || cleanText(entry.tag_name)
            || cleanText(entry.title),
          );
        }
      }
      return uniqueValues(tags.filter(Boolean));
    };
    const normalizeXiaohongshuBodyText = (value) => {
      const normalizedValue = String(value ?? '')
        .replace(/\r\n?/gu, '\n')
        .replace(/\u2028|\u2029/gu, '\n')
        .trim();
      return normalizedValue || null;
    };
    const normalizeXiaohongshuMediaUrl = (value) => {
      const normalizedValue = cleanText(value ?? '');
      if (!normalizedValue) {
        return null;
      }
      const normalizedUrl = normalizeUrlNoFragment(
        normalizedValue.replace(/^http:\/\//iu, 'https://'),
        normalizedFinalUrl,
      );
      return normalizedUrl ? normalizedUrl.replace(/^http:\/\//iu, 'https://') : null;
    };
    const buildXiaohongshuContentImages = (value) => {
      const images = /** @type {any[]} */ ([]);
      for (const [index, entry] of toArray(value).entries()) {
        const image = entry && typeof entry === 'object' ? entry : {};
        const infoEntries = toArray(image.infoList)
          .map((candidate) => candidate && typeof candidate === 'object'
            ? {
              url: normalizeXiaohongshuMediaUrl(candidate.url ?? candidate.urlDefault ?? candidate.urlPre ?? ''),
              scene: cleanText(candidate.imageScene ?? candidate.scene ?? ''),
            }
            : null)
          .filter((candidate) => candidate?.url);
        const preferredInfo = infoEntries.find((candidate) => /WB_DFT|ORI|ORIGIN|DEFAULT/iu.test(candidate.scene))
          ?? infoEntries.find((candidate) => /WB_PRV|PREVIEW/iu.test(candidate.scene))
          ?? infoEntries[0]
          ?? null;
        const previewInfo = infoEntries.find((candidate) => /WB_PRV|PREVIEW/iu.test(candidate.scene))
          ?? preferredInfo;
        const primaryUrl = normalizeXiaohongshuMediaUrl(
          image.urlDefault
          ?? image.url
          ?? image.urlPre
          ?? preferredInfo?.url
          ?? '',
        ) || preferredInfo?.url || null;
        const previewUrl = normalizeXiaohongshuMediaUrl(image.urlPre ?? previewInfo?.url ?? '') || previewInfo?.url || null;
        const widthValue = Number(image.width ?? image.imageWidth ?? 0);
        const heightValue = Number(image.height ?? image.imageHeight ?? 0);
        const sourceUrls = uniqueValues([
          primaryUrl,
          previewUrl,
          ...infoEntries.map((candidate) => candidate.url),
        ].filter(Boolean));
        if (!primaryUrl && sourceUrls.length === 0) {
          continue;
        }
        images.push({
          assetId: cleanText(image.fileId ?? image.traceId ?? '') || `image-${String(index + 1).padStart(2, '0')}`,
          kind: 'image',
          url: primaryUrl || sourceUrls[0] || null,
          previewUrl,
          width: Number.isFinite(widthValue) && widthValue > 0 ? widthValue : null,
          height: Number.isFinite(heightValue) && heightValue > 0 ? heightValue : null,
          livePhoto: image.livePhoto === true,
          traceId: cleanText(image.traceId ?? '') || null,
          sourceUrls,
        });
      }
      return images;
    };
    const normalizeXiaohongshuContentCard = (inputCard = /** @type {any} */ ({}), fallbackAuthor = /** @type {any} */ ({})) => {
      const wrapper = inputCard && typeof inputCard === 'object' ? inputCard : {};
      const noteCard = wrapper.noteCard && typeof wrapper.noteCard === 'object' ? wrapper.noteCard : wrapper;
      const noteId = normalizeXiaohongshuLooseText(
        noteCard.noteId
        ?? noteCard.id
        ?? wrapper.noteId
        ?? wrapper.id
        ?? noteCard.note_id
        ?? '',
      ) || null;
      const xsecToken = normalizeXiaohongshuLooseText(noteCard.xsecToken ?? noteCard.xsec_token ?? wrapper.xsecToken ?? wrapper.xsec_token ?? '') || null;
      const cardNavigationUrl = normalizeUrlNoFragment(
        noteCard.url
        || noteCard.href
        || wrapper.url
        || wrapper.href
        || buildXiaohongshuNoteUrl(noteId)
        || '',
        normalizedFinalUrl,
      );
      const cardUrl = canonicalizeXiaohongshuNoteUrl(cardNavigationUrl || '', normalizedFinalUrl);
      const authorFields = normalizeXiaohongshuAuthorFields(
        noteCard.user ?? noteCard.author ?? wrapper.user ?? wrapper.author ?? {},
        fallbackAuthor,
      );
      const publishedAtValue = toDate(
        noteCard.time
        ?? noteCard.publishTime
        ?? noteCard.publishedAt
        ?? noteCard.publishTimestamp
        ?? noteCard.lastUpdateTime
        ?? noteCard.last_update_time
        ?? noteCard.publishTimeMs
        ?? wrapper.time
        ?? wrapper.publishTime
        ?? wrapper.publishedAt
        ?? null,
      );
      const titleValue = normalizeXiaohongshuTitleText(
        noteCard.displayTitle
        ?? noteCard.title
        ?? noteCard.noteTitle
        ?? wrapper.displayTitle
        ?? wrapper.title
        ?? noteCard.desc
        ?? '',
      );
      const excerptValue = cleanText(
        noteCard.desc
        ?? noteCard.summary
        ?? noteCard.content
        ?? noteCard.noteSummary
        ?? wrapper.desc
        ?? wrapper.summary
        ?? titleValue
        ?? '',
      ) || null;
      const normalizedCard = {
        title: titleValue || null,
        excerpt: excerptValue,
        url: cardUrl || buildXiaohongshuNoteUrl(noteId),
        navigationUrl: cardNavigationUrl || cardUrl || buildXiaohongshuNoteUrl(noteId),
        noteId: noteId || xiaohongshuNoteIdFromUrl(cardUrl),
        xsecToken,
        contentType: cleanText(noteCard.type ?? noteCard.noteType ?? noteCard.cardType ?? wrapper.type ?? '') || null,
        publishedAt: publishedAtValue ? publishedAtValue.toISOString() : null,
        publishedDateLocal: publishedAtValue ? formatShanghaiDateTime(publishedAtValue) : null,
        publishedDayKey: publishedAtValue ? formatShanghaiDayKey(publishedAtValue) : null,
        publishedTimeText: cleanText(
          noteCard.publishTimeText
          ?? noteCard.timeText
          ?? noteCard.publishText
          ?? wrapper.publishTimeText
          ?? wrapper.timeText
          ?? '',
        ) || null,
        ...authorFields,
      };
      return (
        normalizedCard.noteId
        || normalizedCard.url
        || normalizedCard.title
        || normalizedCard.authorUserId
      ) ? normalizedCard : null;
    };
    const mergeXiaohongshuContentCards = (...lists) => {
      const mergedCards = /** @type {any[]} */ ([]);
      const keyToIndex = new Map();
      const registerKeys = (card, index) => {
        const keys = uniqueValues([
          card.noteId ? `note:${card.noteId}` : null,
          card.url ? `url:${card.url}` : null,
          card.title && card.authorUserId ? `title-author:${card.title}::${card.authorUserId}` : null,
          card.title ? `title:${card.title}` : null,
        ].filter(Boolean));
        for (const key of keys) {
          keyToIndex.set(key, index);
        }
        return keys;
      };
      for (const rawCard of toArray(lists).flat()) {
        if (!rawCard) {
          continue;
        }
        const card = rawCard;
        const keys = uniqueValues([
          card.noteId ? `note:${card.noteId}` : null,
          card.url ? `url:${card.url}` : null,
          card.title && card.authorUserId ? `title-author:${card.title}::${card.authorUserId}` : null,
          card.title ? `title:${card.title}` : null,
        ].filter(Boolean));
        const matchedIndex = keys
          .map((key) => keyToIndex.get(key))
          .find((value) => Number.isInteger(value));
        if (!Number.isInteger(matchedIndex)) {
          mergedCards.push(card);
          registerKeys(card, mergedCards.length - 1);
          continue;
        }
        mergedCards[matchedIndex] = mergeSparseObjects(mergedCards[matchedIndex], card);
        registerKeys(mergedCards[matchedIndex], matchedIndex);
      }
      return mergedCards;
    };
    const buildXiaohongshuDomContentCards = ({
      urlSelectors = /** @type {any[]} */ ([]),
      titleSelectors = /** @type {any[]} */ ([]),
      authorNameSelectors = /** @type {any[]} */ ([]),
      authorUrlSelectors = /** @type {any[]} */ ([]),
      limit = 20,
      fallbackAuthor = /** @type {any} */ ({}),
    } = /** @type {any} */ ({})) => {
      const normalizedUrls = readers.readHrefs(urlSelectors, limit)
        .map((value) => canonicalizeXiaohongshuNoteUrl(value, normalizedFinalUrl))
        .filter(Boolean);
      const titles = readers.readTexts(titleSelectors, limit);
      const authorNames = readers.readTexts(authorNameSelectors, limit);
      const authorUrls = readers.readHrefs(authorUrlSelectors, limit)
        .map((value) => canonicalizeXiaohongshuAuthorUrl(value, normalizedFinalUrl))
        .filter(Boolean);
      const cardCount = Math.max(normalizedUrls.length, titles.length, authorNames.length, authorUrls.length);
      const cards = /** @type {any[]} */ ([]);
      for (let index = 0; index < cardCount; index += 1) {
        const authorUrl = authorUrls[index] ?? fallbackAuthor.authorUrl ?? null;
        const authorFields = normalizeXiaohongshuAuthorFields({}, {
          ...fallbackAuthor,
          authorName: authorNames[index] ?? fallbackAuthor.authorName ?? null,
          authorUrl,
          authorUserId: xiaohongshuUserIdFromUrl(authorUrl) || fallbackAuthor.authorUserId,
        });
        const card = {
          title: normalizeXiaohongshuTitleText(titles[index] ?? '') || null,
          url: normalizedUrls[index] ?? null,
          noteId: xiaohongshuNoteIdFromUrl(normalizedUrls[index] ?? ''),
          ...authorFields,
        };
        if (card.title || card.url || card.noteId || card.authorName || card.authorUserId) {
          cards.push(card);
        }
      }
      return cards;
    };
    const collectXiaohongshuStateContentCards = ({ fallbackAuthor = /** @type {any} */ ({}) } = /** @type {any} */ ({})) => {
      const state = readXiaohongshuInitialState();
      const cards = /** @type {any[]} */ ([]);
      if (Array.isArray(state?.search?.feeds)) {
        cards.push(
          ...state.search.feeds
            .map((entry) => normalizeXiaohongshuContentCard(entry, fallbackAuthor))
            .filter(Boolean),
        );
      }
      for (const noteGroup of toArray(state?.user?.notes)) {
        for (const entry of toArray(noteGroup)) {
          const normalizedCard = normalizeXiaohongshuContentCard(entry, fallbackAuthor);
          if (normalizedCard) {
            cards.push(normalizedCard);
          }
        }
      }
      return mergeXiaohongshuContentCards(cards);
    };
    const selectXiaohongshuDetailCard = (expectedNoteId = null) => {
      const state = readXiaohongshuInitialState();
      const candidates = /** @type {any[]} */ ([]);
      const noteDetailMap = state?.note?.noteDetailMap;
      if (noteDetailMap && typeof noteDetailMap === 'object') {
        for (const [entryKey, entryValue] of Object.entries(noteDetailMap)) {
          const normalizedCard = normalizeXiaohongshuContentCard(entryValue?.note ?? entryValue ?? {}, {});
          if (normalizedCard) {
            candidates.push({
              entryKey: cleanText(entryKey),
              card: normalizedCard,
              raw: entryValue?.note ?? entryValue ?? {},
            });
          }
        }
      }
      const fallbackCards = collectXiaohongshuStateContentCards();
      for (const card of fallbackCards) {
        candidates.push({
          entryKey: cleanText(card.noteId),
          card,
          raw: card,
        });
      }
      if (expectedNoteId) {
        const exactMatch = candidates.find((entry) => entry.card.noteId === expectedNoteId || entry.entryKey === expectedNoteId);
        if (exactMatch) {
          return exactMatch;
        }
      }
      return candidates.find((entry) => entry.card.title || entry.card.excerpt || entry.card.authorUserId) || null;
    };

    const extractDouyinEncodedAuthorInfo = () => {
      if (!readers.rawHtmlSource) {
        return null;
      }
      const secUidPatterns = [
        /"sec_uid"\s*:\s*"([^"]+)"/u,
        /%22sec_uid%22%3A%22([^"%]+)%22/u,
      ];
      const nicknamePatterns = [
        /"nickname"\s*:\s*"([^"]+)"/u,
        /%22nickname%22%3A%22([^"%]+)%22/u,
      ];
      const secUid = secUidPatterns
        .map((pattern) => cleanText(readers.rawHtmlSource.match(pattern)?.[1] || ''))
        .find(Boolean);
      const nickname = nicknamePatterns
        .map((pattern) => cleanText(readers.rawHtmlSource.match(pattern)?.[1] || ''))
        .find(Boolean);
      if (!secUid && !nickname) {
        return null;
      }
      const authorUrl = secUid ? canonicalizeDouyinAuthorUrl(`https://www.douyin.com/user/${secUid}`) : null;
      return {
        authorName: nickname || null,
        authorUserId: secUid || null,
        authorUrl: authorUrl || null,
      };
    };

    const buildDouyinContentCards = (urls = /** @type {any[]} */ ([]), titles = /** @type {any[]} */ ([]), currentAuthor = /** @type {any} */ ({})) => {
      const canonicalUrls = uniqueValues(urls.map((value) => canonicalizeDouyinVideoUrl(value)).filter(Boolean));
      const createTimeMap = parseDouyinCreateTimeMapFromHtml(
        readers.rawHtmlSource,
        canonicalUrls.map((value) => cleanText(value.match(/\/video\/([^/?#]+)/u)?.[1] || '')),
      );
      return canonicalUrls.map((url, index) => {
        const videoId = cleanText(url.match(/\/video\/([^/?#]+)/u)?.[1] || '') || null;
        const published = normalizeDouyinPublishFields({
          createTime: videoId ? createTimeMap.get(videoId) ?? null : null,
        });
        return {
          title: titles[index] ?? null,
          url,
          videoId,
          authorUrl: currentAuthor.authorUrl ?? null,
          authorUserId: currentAuthor.authorUserId ?? null,
          authorName: currentAuthor.authorName ?? null,
          ...published,
        };
      }).filter((card) => card.url || card.videoId || card.title);
    };

    const buildDouyinAuthorCards = (urls = /** @type {any[]} */ ([]), names = /** @type {any[]} */ ([])) => {
      const canonicalUrls = uniqueValues(urls.map((value) => canonicalizeDouyinAuthorUrl(value)).filter(Boolean));
      return canonicalUrls.map((url, index) => {
        const userId = cleanText(url.match(/\/user\/([^/?#]+)/u)?.[1] || '') || null;
        return {
          name: names[index] ?? null,
          url,
          userId,
        };
      }).filter((card) => card.url || card.userId || card.name);
    };

    const bilibiliAuthorSubpageFromPath = (value) => {
      const matched = String(value || '').match(/^\/\d+(?:\/([^?#]+))?/u);
      const normalized = cleanText(String(matched?.[1] || '').replace(/^\/+|\/+$/gu, ''));
      if (!normalized) {
        return 'home';
      }
      if (normalized === 'fans/follow') {
        return 'follow';
      }
      if (normalized === 'fans/fans') {
        return 'fans';
      }
      return normalized;
    };

    const normalizeBilibiliAuthorCard = (card = /** @type {any} */ ({}), authorSubpage = null) => {
      const name = cleanText(card.name);
      const url = card.url ? readers.normalizeUrl(card.url) : null;
      const mid = cleanText(card.mid) || bilibiliMidFromUrl(url);
      if (!name && !url && !mid) {
        return null;
      }
      return {
        name: name || null,
        url: url || null,
        mid: mid || null,
        authorSubpage: cleanText(card.authorSubpage) || authorSubpage || null,
        cardKind: cleanText(card.cardKind) || 'author',
      };
    };

    const normalizeBilibiliContentCard = (card = /** @type {any} */ ({}), fallbackAuthorMid = null) => {
      const url = card.url ? readers.normalizeUrl(card.url) : null;
      const titleValue = cleanText(card.title);
      const bvid = cleanText(card.bvid) || bilibiliBvidFromUrl(url);
      const authorMid = cleanText(card.authorMid) || fallbackAuthorMid || null;
      const contentType = cleanText(card.contentType) || bilibiliContentTypeFromUrl(url);
      const authorUrl = card.authorUrl ? readers.normalizeUrl(card.authorUrl) : null;
      const authorName = cleanText(card.authorName);
      if (!titleValue && !url && !bvid && !authorMid) {
        return null;
      }
      return {
        title: titleValue || null,
        url: url || null,
        bvid: bvid || null,
        authorMid: authorMid || null,
        contentType: contentType || null,
        authorUrl: authorUrl || null,
        authorName: authorName || null,
      };
    };

    const dedupeBilibiliAuthorCards = (cards = /** @type {any[]} */ ([]), authorSubpage = null) => {
      const seen = new Set();
      const result = /** @type {any[]} */ ([]);
      for (const rawCard of cards) {
        const card = normalizeBilibiliAuthorCard(rawCard, authorSubpage);
        if (!card) {
          continue;
        }
        const key = card.mid
          ? `mid::${card.mid}`
          : card.url
            ? `url::${card.url}`
            : `name::${card.name}`;
        if (!key || seen.has(key)) {
          continue;
        }
        seen.add(key);
        result.push(card);
      }
      return result.slice(0, 16);
    };

    const dedupeBilibiliContentCards = (cards = /** @type {any[]} */ ([]), fallbackAuthorMid = null) => {
      const seen = new Set();
      const result = /** @type {any[]} */ ([]);
      for (const rawCard of cards) {
        const card = normalizeBilibiliContentCard(rawCard, fallbackAuthorMid);
        if (!card) {
          continue;
        }
        const key = card.bvid
          ? `bvid::${card.bvid}`
          : card.url
            ? `url::${card.url}`
            : `title::${card.title}::${card.authorMid}`;
        if (!key || seen.has(key)) {
          continue;
        }
        seen.add(key);
        result.push(card);
      }
      return result.slice(0, 12);
    };

    const detectBilibiliAntiCrawlSignals = () => {
      const source = readers.readDocumentText();
      if (!source) {
        return [];
      }
      const signals = /** @type {any[]} */ ([]);
      const patterns = /** @type {[string, RegExp][]} */ ([
        ['rate-limit', /\u8bbf\u95ee\u9891\u7e41/u],
        ['verify', /\u5b89\u5168\u9a8c\u8bc1/u],
        ['slide-verify', /\u6ed1\u52a8\u9a8c\u8bc1/u],
        ['captcha', /captcha/iu],
        ['risk-control', /\u98ce\u63a7/u],
        ['retry-later', /\u8bf7\u7a0d\u540e\u518d\u8bd5/u],
      ]);
      for (const [label, pattern] of patterns) {
        if (pattern.test(source)) {
          signals.push(label);
        }
      }
      return signals;
    };

    const deriveXiaohongshuRestrictionFacts = () => {
      if (!isXiaohongshuProfile) {
        return null;
      }
      const restrictionTitle = cleanText(
        title
        || readers.readText([
          '.restricted-content .title',
          '.fe-verify-box .title',
          '.restricted-content',
          '.fe-verify-box',
        ])
        || '',
      ) || null;
      const restrictionCode = cleanText(
        parsedUrl?.searchParams.get('error_code')
        || readers.readText([
          '.restricted-content .desc-code',
          '.desc-code',
          '[class*="desc-code"]',
        ])
        || readers.readPattern([
          /error_code["=: ]+(\d{6,})/u,
          /desc-code[^0-9]*(\d{6,})/u,
          /\b(300012)\b/u,
        ])
        || '',
      ) || null;
      const restrictionMessage = cleanText(
        parsedUrl?.searchParams.get('error_msg')
        || readers.readText([
          '.restricted-content .desc',
          '.restricted-content',
          '.fe-verify-box .desc',
          '.fe-verify-box',
          '[class*="restricted-content"]',
          '[class*="verify"]',
          '[class*="risk"]',
        ])
        || readers.readDocumentText()
        || '',
      ) || null;
      const redirectPath = cleanText(parsedUrl?.searchParams.get('redirectPath') || '') || null;
      const restrictionSource = cleanText([
        restrictionTitle,
        restrictionMessage,
        readers.readDocumentText(),
      ].filter(Boolean).join(' '));
      const restrictionDetected = (
        pathname === '/website-login/error'
        || String(pageType ?? '') === 'auth-page' && /安全限制/u.test(restrictionSource)
        || restrictionCode === '300012'
        || /安全限制|IP存在风险|请切换可靠网络环境后重试/u.test(restrictionSource)
        || Boolean(readers.readText([
          '.restricted-content',
          '.fe-verify-box',
          '.desc-code',
          '[class*="restricted-content"]',
          '[class*="verify"]',
        ]))
      );
      if (!restrictionDetected) {
        return null;
      }
      const antiCrawlSignals = uniqueSortedStrings([
        'risk-control',
        'verify',
        ...(restrictionCode === '300012' || /IP存在风险/u.test(restrictionSource) ? ['ip-risk'] : []),
      ]);
      return {
        antiCrawlDetected: true,
        antiCrawlSignals,
        antiCrawlReasonCode: 'anti-crawl-verify',
        riskPageDetected: true,
        riskPageCode: restrictionCode,
        riskPageMessage: restrictionMessage,
        riskPageTitle: restrictionTitle,
        redirectPath,
      };
    };

    const xiaohongshuRestrictionFacts = deriveXiaohongshuRestrictionFacts();
    if (xiaohongshuRestrictionFacts) {
      return finalizeFacts(xiaohongshuRestrictionFacts, {
        antiCrawlReasonCode: xiaohongshuRestrictionFacts.antiCrawlReasonCode,
      });
    }

    if (pageType === 'search-results-page') {
      if (isDouyinProfile) {
        const queryFromPath = cleanText(parsedUrl?.pathname.match(/^\/search\/([^/?#]+)/u)?.[1] || '');
        return finalizeFacts({
          queryText: cleanText(readers.queryInputValue || decodeURIComponent(queryFromPath || '')) || null,
          searchSection: cleanText(parsedUrl?.searchParams.get('type') || '') || null,
        });
      }

      const profileResultTitleSelectors = Array.isArray(siteProfile?.search?.resultTitleSelectors)
        ? siteProfile.search.resultTitleSelectors
        : ['.layout-co18 .layout-tit', '.layout2 .layout-tit'];
      const profileResultBookSelectors = Array.isArray(siteProfile?.search?.resultBookSelectors)
        ? siteProfile.search.resultBookSelectors
        : ['.txt-list-row5 li .s2 a[href]', '.layout-co18 .txt-list a[href]'];
      const queryParamNames = Array.isArray(siteProfile?.search?.queryParamNames)
        ? siteProfile.search.queryParamNames
        : ['searchkey', 'keyword', 'q'];
      const resultTitles = readers.readTexts(profileResultBookSelectors, 20);
      const resultUrls = readers.readHrefs(profileResultBookSelectors, 20);
      const queryFromTitle = (() => {
        const headingText = readers.readText(profileResultTitleSelectors) || cleanText(title);
        const matched = headingText.match(/^(.*?)\s*[-_]\s*(?:\u54d4\u54e9\u54d4\u54e9|bilibili)/iu)
          || headingText.match(/(?:\u641c\u7d22|search)\s*[:\uff1a"']*\s*(.+?)(?:\s*[-_]|$)/iu);
        return cleanText(matched?.[1] || '');
      })();
      const derivedQuery = (() => {
        if (parsedUrl) {
          for (const name of queryParamNames) {
            const value = cleanText(parsedUrl.searchParams.get(name) || '');
            if (value) {
              return value;
            }
          }
          const fromPath = parsedUrl.pathname.match(/\/ss\/(.+?)(?:\.html)?$/iu)?.[1] || '';
          const fromPathText = decodeURIComponent(fromPath).replace(/\.html$/iu, '');
          if (cleanText(fromPathText)) {
            return cleanText(fromPathText);
          }
        }
        return queryFromTitle;
      })();
      if (isXiaohongshuProfile) {
        const initialState = readXiaohongshuInitialState();
        const stateCards = collectXiaohongshuStateContentCards();
        const domCards = buildXiaohongshuDomContentCards({
          urlSelectors: profileResultBookSelectors,
          titleSelectors: profileResultBookSelectors,
          authorNameSelectors: [
            'section.note-item .author-wrapper .name',
            '.note-item .author-wrapper .name',
            '.author-wrapper .name',
          ],
          authorUrlSelectors: [
            'section.note-item .author-wrapper a[href*="/user/profile/"]',
            '.note-item .author-wrapper a[href*="/user/profile/"]',
            'a[href*="/user/profile/"]',
          ],
          limit: 20,
        });
        const resultCards = mergeXiaohongshuContentCards(stateCards, domCards).slice(0, 20);
        return finalizeFacts({
          queryText: normalizeXiaohongshuLooseText(
            readers.queryInputValue
            || initialState?.search?.searchContext?.keyword
            || initialState?.search?.searchValue
            || derivedQuery,
          ) || null,
          searchSection: normalizeXiaohongshuLooseText(
            initialState?.search?.currentSearchType
            || initialState?.search?.searchContext?.noteType
            || parsedUrl?.searchParams.get('type')
            || '',
          ) || null,
          resultCount: resultCards.length > 0 ? resultCards.length : Math.max(resultUrls.length, resultTitles.length),
          resultNavigationUrls: resultCards.map((card) => card.navigationUrl ?? card.url).filter(Boolean),
          resultTitles: resultCards.map((card) => card.title).filter(Boolean),
          resultUrls: resultCards.map((card) => card.url).filter(Boolean),
          resultEntries: resultCards.map((card) => ({
            title: card.title ?? null,
            url: card.url ?? null,
            navigationUrl: card.navigationUrl ?? card.url ?? null,
            noteId: card.noteId ?? null,
            contentType: card.contentType ?? null,
            authorName: card.authorName ?? null,
            authorUrl: card.authorUrl ?? null,
            authorNavigationUrl: card.authorNavigationUrl ?? card.authorUrl ?? null,
            authorUserId: card.authorUserId ?? null,
            userId: card.userId ?? null,
            publishedAt: card.publishedAt ?? null,
          })),
          firstResultTitle: resultCards[0]?.title ?? null,
          firstResultUrl: resultCards[0]?.url ?? null,
          resultNoteIds: resultCards.map((card) => card.noteId).filter(Boolean),
          resultAuthorNames: resultCards.map((card) => card.authorName).filter(Boolean),
          resultAuthorUrls: resultCards.map((card) => card.authorUrl).filter(Boolean),
          resultAuthorUserIds: resultCards.map((card) => card.authorUserId).filter(Boolean),
          resultUserIds: resultCards.map((card) => card.userId).filter(Boolean),
        });
      }
      const facts = {
        queryText: cleanText(readers.queryInputValue || derivedQuery) || null,
        resultCount: Math.max(resultUrls.length, resultTitles.length),
        resultTitles,
      };
      if (isBilibiliProfile) {
        const resultAuthorUrls = readers.readHrefs([
          'a[href*="//space.bilibili.com/"]',
          'a[href*="space.bilibili.com/"]',
        ], 20);
        const searchSection = pathname.split('/').filter(Boolean)[0] || 'all';
        const resultEntries = resultUrls.slice(0, 12).map((value, index) => ({
          title: resultTitles[index] ?? null,
          url: value,
          contentType: bilibiliContentTypeFromUrl(value),
          bvid: bilibiliBvidFromUrl(value),
          authorUrl: resultAuthorUrls[index] ?? null,
          authorMid: bilibiliMidFromUrl(resultAuthorUrls[index] ?? ''),
        }));
        facts.resultUrls = resultUrls;
        facts.searchSection = searchSection;
        facts.firstResultTitle = resultTitles[0] ?? null;
        facts.firstResultUrl = resultUrls[0] ?? null;
        facts.firstResultContentType = bilibiliContentTypeFromUrl(resultUrls[0] ?? '');
        facts.resultEntries = resultEntries;
        facts.resultContentTypes = resultUrls
          .map((value) => bilibiliContentTypeFromUrl(value))
          .filter(Boolean)
          .slice(0, 20);
        facts.resultAuthorUrls = resultAuthorUrls;
        facts.resultAuthorMids = resultAuthorUrls
          .map((value) => bilibiliMidFromUrl(value))
          .filter(Boolean)
          .slice(0, 20);
        facts.resultBvids = resultUrls
          .map((value) => bilibiliBvidFromUrl(value))
          .filter(Boolean)
          .slice(0, 10);
      }
      if (isDouyinProfile) {
        facts.resultUrls = resultUrls.map((value) => canonicalizeDouyinVideoUrl(value)).filter(Boolean).slice(0, 20);
        facts.firstResultUrl = facts.resultUrls[0] ?? null;
      }
      return finalizeFacts(facts);
    }

    if (pageType === 'home' && isDouyinProfile) {
      const antiCrawlSignals = detectDouyinAntiCrawlSignals({
        title,
        documentText: readers.readDocumentText(),
      });
      const featuredContentUrls = readers.readHrefs(['a[href*="/video/"]'], 32)
        .map((value) => canonicalizeDouyinVideoUrl(value))
        .filter(Boolean);
      const facts = {
        featuredContentCount: featuredContentUrls.length,
        featuredContentUrls,
      };
      if (antiCrawlSignals.length > 0) {
        facts.antiCrawlDetected = true;
        facts.antiCrawlSignals = antiCrawlSignals;
        facts.antiCrawlReasonCode = deriveDouyinAntiCrawlReasonCode(antiCrawlSignals);
      }
      return finalizeFacts(facts, {
        antiCrawlReasonCode: facts.antiCrawlReasonCode ?? null,
      });
    }

    if (isContentDetailPageType(pageType)) {
      if (isDouyinProfile) {
        const embeddedAuthor = extractDouyinEncodedAuthorInfo();
        const authorUrl = canonicalizeDouyinAuthorUrl(
          readers.readHref(['a[href*="/user/"]:not([href*="/user/self"])'])
          || embeddedAuthor?.authorUrl
          || '',
        ) || null;
        const authorUserId = cleanText(authorUrl?.match(/\/user\/([^/?#]+)/u)?.[1] || '') || embeddedAuthor?.authorUserId || null;
        const authorName = readers.readText(['a[href*="/user/"]:not([href*="/user/self"])'])
          || embeddedAuthor?.authorName
          || null;
        return finalizeFacts({
          contentTitle: readers.readText(['h1']) || cleanText(title) || null,
          authorName,
          authorUrl,
          authorUserId,
        });
      }
      if (isXiaohongshuProfile) {
        const expectedNoteId = xiaohongshuNoteIdFromUrl(normalizedFinalUrl);
        const detailEntry = selectXiaohongshuDetailCard(expectedNoteId);
        const stateNote = detailEntry?.raw && typeof detailEntry.raw === 'object' ? detailEntry.raw : {};
        const stateCard = detailEntry?.card ?? null;
        const domAuthorNavigationUrl = normalizeUrlNoFragment(
          readers.readHref(
            Array.isArray(siteProfile?.contentDetail?.authorLinkSelectors)
              ? siteProfile.contentDetail.authorLinkSelectors
              : ['a[href*="/user/profile/"]'],
          )
          || '',
          normalizedFinalUrl,
        );
        const domAuthorUrl = canonicalizeXiaohongshuAuthorUrl(domAuthorNavigationUrl || '', normalizedFinalUrl);
        const domAuthorFields = normalizeXiaohongshuAuthorFields({}, {
          authorName: readers.readText(
            Array.isArray(siteProfile?.contentDetail?.authorNameSelectors)
              ? siteProfile.contentDetail.authorNameSelectors
              : [
                '.author-wrapper .name',
                '.author-wrapper .username',
                'a[href*="/user/profile/"] .name',
                'a[href*="/user/profile/"]',
              ],
          ),
          authorNavigationUrl: domAuthorNavigationUrl,
          authorUrl: domAuthorUrl,
          authorUserId: xiaohongshuUserIdFromUrl(domAuthorUrl) || null,
        });
        const authorFields = mergeSparseObjects(
          domAuthorFields,
          stateCard ? normalizeXiaohongshuAuthorFields(stateNote.user ?? stateNote.author ?? {}, stateCard) : {},
        );
        const contentTitle = normalizeXiaohongshuTitleText(
          stateNote.title
          ?? stateNote.noteTitle
          ?? stateCard?.title
          ?? readers.readText(
            Array.isArray(siteProfile?.contentDetail?.titleSelectors)
              ? siteProfile.contentDetail.titleSelectors
              : ['.note-content .title', '.note-content .desc', 'h1', 'title'],
          )
          ?? title,
        );
        const contentExcerpt = cleanText(
          stateNote.desc
          ?? stateNote.summary
          ?? stateNote.content
          ?? stateCard?.excerpt
          ?? readers.readText([
            '.note-content .desc',
            '.note-content .content',
            '.note-content',
            '[class*="desc"]',
            '[class*="content"]',
          ])
          ?? '',
        ) || null;
        const contentBodyText = normalizeXiaohongshuBodyText(
          stateNote.desc
          ?? stateNote.summary
          ?? stateNote.content
          ?? contentExcerpt
          ?? '',
        );
        const publishedAtValue = toDate(
          stateNote.time
          ?? stateNote.publishTime
          ?? stateNote.publishedAt
          ?? stateNote.publishTimestamp
          ?? stateNote.lastUpdateTime
          ?? stateCard?.publishedAt
          ?? null,
        );
        const publishedTimeText = cleanText(
          stateCard?.publishedTimeText
          ?? stateNote.publishTimeText
          ?? stateNote.timeText
          ?? readers.readText([
            '.note-content time',
            '.note-content .date',
            '.note-content .publish-time',
            'time',
            '[class*="date"]',
          ])
          ?? '',
        ) || null;
        const tagNames = normalizeXiaohongshuTagNames(
          stateNote.tagList
          ?? stateNote.tags
          ?? stateNote.topics
          ?? stateNote.topicTags
          ?? [],
        );
        const contentImages = buildXiaohongshuContentImages(
          stateNote.imageList
          ?? stateNote.images
          ?? stateNote.image_list
          ?? [],
        );
        return finalizeFacts({
          noteId: expectedNoteId || stateCard?.noteId || null,
          bookTitle: contentTitle || null,
          contentTitle: contentTitle || null,
          contentExcerpt,
          contentBodyText,
          bodyExcerpt: contentExcerpt,
          bodyText: contentBodyText,
          authorName: authorFields.authorName ?? null,
          authorUrl: authorFields.authorUrl ?? null,
          authorNavigationUrl: authorFields.authorNavigationUrl ?? authorFields.authorUrl ?? null,
          authorUserId: authorFields.authorUserId ?? null,
          authorRedId: authorFields.authorRedId ?? null,
          userId: authorFields.userId ?? null,
          publishedAt: publishedAtValue ? publishedAtValue.toISOString() : (stateCard?.publishedAt ?? null),
          publishedDateLocal: publishedAtValue ? formatShanghaiDateTime(publishedAtValue) : (stateCard?.publishedDateLocal ?? null),
          publishedDayKey: publishedAtValue ? formatShanghaiDayKey(publishedAtValue) : (stateCard?.publishedDayKey ?? null),
          publishedTimeText,
          contentType: stateCard?.contentType ?? (cleanText(stateNote.type ?? stateNote.noteType ?? '') || null),
          contentImages,
          contentImageUrls: contentImages.map((entry) => entry.url).filter(Boolean),
          contentImagePreviewUrls: contentImages.map((entry) => entry.previewUrl).filter(Boolean),
          contentImageCount: contentImages.length,
          primaryImageUrl: contentImages[0]?.url ?? null,
          tagNames,
        });
      }

      const chapterLinkSelectors = Array.isArray(siteProfile?.bookDetail?.chapterLinkSelectors)
        ? siteProfile.bookDetail.chapterLinkSelectors
        : ['#list a[href]', '.listmain a[href]', 'dd a[href]', '.book_last a[href]'];
      const chapterUrls = readers.readHrefs(chapterLinkSelectors, 200);
      const genericBookTitle = readers.readMetaContent('og:novel:book_name')
        || readers.readText(
          Array.isArray(siteProfile?.contentDetail?.titleSelectors)
            ? siteProfile.contentDetail.titleSelectors
            : ['h1', '.book h1', '#bookinfo h1', 'h2'],
        );
      const genericAuthorName = readers.readMetaContent('og:novel:author')
        || readers.readText(
          Array.isArray(siteProfile?.contentDetail?.authorNameSelectors)
            ? siteProfile.contentDetail.authorNameSelectors
            : ['a[href*="/author/"]', '.small span a'],
        );
      const genericAuthorUrl = (() => {
        const value = readers.readMetaContent('og:novel:author_link')
          || readers.readHref(
            Array.isArray(siteProfile?.contentDetail?.authorLinkSelectors)
              ? siteProfile.contentDetail.authorLinkSelectors
              : ['a[href*="/author/"]'],
          );
        return value ? readers.normalizeUrl(value) : null;
      })();
      const facts = {
        bookTitle: genericBookTitle,
        authorName: genericAuthorName,
        authorUrl: genericAuthorUrl,
        chapterCount: chapterUrls.length,
        latestChapterTitle: readers.readText(['.book_last a', '#list a']),
        latestChapterUrl: (() => {
          const value = readers.readMetaContent('og:novel:lastest_chapter_url') || chapterUrls[0] || '';
          return value ? readers.normalizeUrl(value) : null;
        })(),
      };
      if (isBilibiliProfile) {
        const bilibiliTitle = normalizeBilibiliTitleText(genericBookTitle, 'content')
          || readers.readText(['h1.video-title', 'h1', '.video-title', '.media-title'])
          || normalizeBilibiliTitleText(title, 'content');
        const authorUrl = genericAuthorUrl
          || readers.readHref(['a.up-name[href*="space.bilibili.com/"]', '.video-owner-card a[href*="space.bilibili.com/"]', 'a[href*="space.bilibili.com/"]']);
        const bvid = normalizedFinalUrl.match(/\/video\/(BV[0-9A-Za-z]+)/u)?.[1]
          || readers.readPattern([/"bvid"\s*:\s*"([^"]+)"/u, /"bvid":"([^"]+)"/u]);
        const aid = readers.readPattern([/"aid"\s*:\s*(\d+)/u, /"aid":"?(\d+)"?/u]);
        const authorMid = authorUrl?.match(/space\.bilibili\.com\/(\d+)/u)?.[1]
          || pathname.match(/^\/(?:bangumi\/play\/|video\/)?(\d+)$/u)?.[1]
          || readers.readPattern([/"mid"\s*:\s*(\d+)/u, /"mid":"?(\d+)"?/u]);
        const publishedAt = readers.readMetaContent('og:video:release_date')
          || readers.readMetaContent('article:published_time')
          || readers.readText(['time', '.pubdate-text', '.video-publish time', '[class*="pubdate"]']);
        const categoryName = readers.readText([
          '.video-info-detail a',
          '.video-detail-title a',
          '.first-channel',
          'a[href*="/v/"]',
        ]);
        const seasonId = readers.readPattern([/"season_id"\s*:\s*(\d+)/u, /"seasonId"\s*:\s*(\d+)/u]);
        const episodeId = pathname.match(/\/bangumi\/play\/ep(\d+)/u)?.[1]
          || readers.readPattern([/"ep_id"\s*:\s*(\d+)/u, /"episode_id"\s*:\s*(\d+)/u, /"epId"\s*:\s*(\d+)/u]);
        const seriesTitle = readers.readText([
          '.media-title',
          '.media-info-title',
          '.media-right .title',
          '.mediainfo_mediaTitle',
        ]);
        const episodeTitle = readers.readText([
          'h1.video-title',
          '.video-title',
          '.ep-info-title',
          'h1',
        ]);
        const tagNames = readers.readTexts([
          '.tag-link',
          '.video-tag-link',
          'a[href*="/v/topic/detail"]',
          'a[href*="/v/tag/"]',
        ], 12);
        facts.bookTitle = bilibiliTitle;
        facts.contentTitle = bilibiliTitle;
        facts.contentType = pathname.startsWith('/bangumi/play/') ? 'bangumi' : 'video';
        facts.bvid = bvid ?? null;
        facts.aid = aid ?? null;
        facts.authorName = normalizeBilibiliTitleText(genericAuthorName, 'author')
          || readers.readText(['a.up-name', '.up-name', '.up-detail-top .up-name', '.video-owner-card .name']);
        facts.authorUrl = authorUrl ?? null;
        facts.authorMid = authorMid ?? null;
        facts.publishedAt = publishedAt ?? null;
        facts.categoryName = normalizeBilibiliTitleText(categoryName, 'generic') ?? null;
        facts.seasonId = seasonId ?? null;
        facts.episodeId = episodeId ?? null;
        facts.seriesTitle = normalizeBilibiliTitleText(seriesTitle, 'content') ?? null;
        facts.episodeTitle = (facts.contentType === 'bangumi' ? (episodeTitle || bilibiliTitle) : null) ?? null;
        facts.tagNames = tagNames;
      }
      return finalizeFacts(facts);
    }

    if (pageType === 'author-page' || pageType === 'author-list-page') {
      if (isDouyinProfile) {
        const authorSubpage = normalizeDouyinAuthorSubpage(
          resolveDouyinAuthorSubpageFromUrl(normalizedFinalUrl, pageType === 'author-list-page' ? 'post' : 'home'),
          pageType === 'author-list-page' ? 'post' : 'home',
        );
        const antiCrawlSignals = detectDouyinAntiCrawlSignals({
          title,
          documentText: readers.readDocumentText(),
        });
        const facts = {
          authorSubpage,
        };
        if (pageType === 'author-page') {
          const authorUrl = canonicalizeDouyinAuthorUrl(normalizedFinalUrl) || normalizedFinalUrl || null;
          const authorUserId = cleanText(authorUrl?.match(/\/user\/([^/?#]+)/u)?.[1] || '') || null;
          facts.authorName = readers.readText(['h1']) || null;
          facts.authorUrl = authorUrl;
          facts.authorUserId = authorUserId;
          const featuredContentTitles = readers.readTexts(['a[href*="/video/"]'], 32);
          const featuredContentUrls = readers.readHrefs(['a[href*="/video/"]'], 32)
            .map((value) => canonicalizeDouyinVideoUrl(value))
            .filter(Boolean);
          const featuredContentCards = buildDouyinContentCards(featuredContentUrls, featuredContentTitles, facts);
          facts.featuredContentCards = featuredContentCards;
          facts.featuredContentUrls = featuredContentCards.map((card) => card.url).filter(Boolean);
          facts.featuredContentTitles = featuredContentCards.map((card) => card.title).filter(Boolean);
          facts.featuredContentVideoIds = featuredContentCards.map((card) => card.videoId).filter(Boolean);
          facts.featuredContentPublishedDayKeys = featuredContentCards.map((card) => card.publishedDayKey).filter(Boolean);
          facts.featuredContentCount = featuredContentCards.length;
          if (featuredContentCards.length > 0) {
            facts.featuredContentComplete = true;
          }
        } else {
          const featuredAuthorNames = readers.readTexts(['a[href*="/user/"]'], 32);
          const featuredAuthorUrls = readers.readHrefs(['a[href*="/user/"]'], 32)
            .map((value) => canonicalizeDouyinAuthorUrl(value))
            .filter((value) => value && !/\/user\/self(?:[/?#]|$)/u.test(value));
          const featuredAuthorCards = authorSubpage === 'follow-users'
            ? buildDouyinAuthorCards(featuredAuthorUrls, featuredAuthorNames)
            : [];
          if (featuredAuthorCards.length > 0) {
            facts.featuredAuthorCards = featuredAuthorCards;
            facts.featuredAuthorUrls = featuredAuthorCards.map((card) => card.url).filter(Boolean);
            facts.featuredAuthorNames = featuredAuthorCards.map((card) => card.name).filter(Boolean);
            facts.featuredAuthorUserIds = featuredAuthorCards.map((card) => card.userId).filter(Boolean);
            facts.featuredAuthorCount = featuredAuthorCards.length;
            facts.featuredAuthorComplete = true;
          }
        }
        if (antiCrawlSignals.length > 0) {
          facts.antiCrawlDetected = true;
          facts.antiCrawlSignals = antiCrawlSignals;
          facts.antiCrawlReasonCode = deriveDouyinAntiCrawlReasonCode(antiCrawlSignals);
        }
        return finalizeFacts(facts, {
          antiCrawlReasonCode: facts.antiCrawlReasonCode ?? null,
        });
      }
      if (isXiaohongshuProfile) {
        const initialState = readXiaohongshuInitialState();
        const currentAuthorNavigationUrl = normalizeUrlNoFragment(normalizedFinalUrl, normalizedFinalUrl)
          || normalizeUrlNoFragment(readers.readHref(['a[href*="/user/profile/"]']) || '', normalizedFinalUrl)
          || null;
        const currentAuthorUrl = canonicalizeXiaohongshuAuthorUrl(currentAuthorNavigationUrl || '', normalizedFinalUrl)
          || null;
        const stateBasicInfo = initialState?.user?.userPageData?.basicInfo ?? initialState?.user?.userInfo ?? {};
        const authorFields = normalizeXiaohongshuAuthorFields(stateBasicInfo, {
          authorName: normalizeXiaohongshuTitleText(
            readers.readText(
              Array.isArray(siteProfile?.author?.titleSelectors)
                ? siteProfile.author.titleSelectors
                : ['.user-name', '.username', 'h1', 'title'],
            )
            || title,
            'author',
          ),
          authorNavigationUrl: currentAuthorNavigationUrl,
          authorUrl: currentAuthorUrl,
          authorUserId: xiaohongshuUserIdFromUrl(currentAuthorUrl) || null,
          authorRedId: normalizeXiaohongshuLooseText(stateBasicInfo.redId ?? '') || null,
        });
        const featuredContentCards = mergeXiaohongshuContentCards(
          collectXiaohongshuStateContentCards({ fallbackAuthor: authorFields }),
          buildXiaohongshuDomContentCards({
            urlSelectors: Array.isArray(siteProfile?.author?.workLinkSelectors)
              ? siteProfile.author.workLinkSelectors
              : [
                'section.note-item a[href*="/explore/"]',
                'a.cover[href*="/explore/"]',
                'a.title[href*="/explore/"]',
                'a[href*="/explore/"]',
              ],
            titleSelectors: [
              'section.note-item .footer .title',
              'section.note-item .title',
              '.note-item .title',
              'a.title',
            ],
            authorNameSelectors: [
              '.author-wrapper .name',
              '.note-item .author-wrapper .name',
              'a[href*="/user/profile/"] .name',
            ],
            authorUrlSelectors: [
              '.author-wrapper a[href*="/user/profile/"]',
              '.note-item .author-wrapper a[href*="/user/profile/"]',
              'a[href*="/user/profile/"]',
            ],
            limit: 32,
            fallbackAuthor: authorFields,
          }),
        ).slice(0, 32);
        const authorBio = cleanText(
          stateBasicInfo.desc
          ?? readers.readText([
            '.user-desc',
            '.user-description',
            '.desc',
            '[class*="user-desc"]',
          ])
          ?? '',
        ) || null;
        const authorTags = uniqueValues(
          toArray(initialState?.user?.userPageData?.tags)
            .map((entry) => cleanText(entry?.name ?? entry?.title ?? entry))
            .filter(Boolean),
        );
        return finalizeFacts({
          authorName: authorFields.authorName ?? null,
          authorUrl: authorFields.authorUrl ?? null,
          authorNavigationUrl: authorFields.authorNavigationUrl ?? authorFields.authorUrl ?? null,
          authorUserId: authorFields.authorUserId ?? null,
          authorRedId: authorFields.authorRedId ?? null,
          userId: authorFields.userId ?? null,
          authorBio,
          authorDescription: authorBio,
          authorTags,
          featuredContentCards,
          featuredContentNavigationUrls: featuredContentCards.map((card) => card.navigationUrl ?? card.url).filter(Boolean),
          featuredContentUrls: featuredContentCards.map((card) => card.url).filter(Boolean),
          featuredContentTitles: featuredContentCards.map((card) => card.title).filter(Boolean),
          featuredContentNoteIds: featuredContentCards.map((card) => card.noteId).filter(Boolean),
          featuredContentAuthorNames: featuredContentCards.map((card) => card.authorName).filter(Boolean),
          featuredContentAuthorUrls: featuredContentCards.map((card) => card.authorUrl).filter(Boolean),
          featuredContentAuthorUserIds: featuredContentCards.map((card) => card.authorUserId).filter(Boolean),
          featuredContentCount: featuredContentCards.length,
          featuredContentComplete: featuredContentCards.length > 0 ? true : null,
        });
      }

      const genericAuthorName = readers.readMetaContent('og:novel:author')
        || readers.readText(
          Array.isArray(siteProfile?.author?.titleSelectors)
            ? siteProfile.author.titleSelectors
            : ['h1', '.author h1', '.title h1', 'h2'],
        );
      const facts = {
        authorName: genericAuthorName,
      };
      if (isBilibiliProfile) {
        const authorUrls = readers.readHrefs([
          'a[href*="space.bilibili.com/"]',
        ], 16).filter((value) => value !== normalizedFinalUrl);
        const authorNames = readers.readTexts([
          'a[href*="space.bilibili.com/"] .name',
          'a[href*="space.bilibili.com/"] .up-name',
          'a[href*="space.bilibili.com/"]',
        ], 16).filter((value) => value !== facts.authorName);
        const workSelectors = Array.isArray(siteProfile?.author?.workLinkSelectors)
          ? siteProfile.author.workLinkSelectors
          : ['a[href*="/video/BV"]'];
        const workUrls = readers.readHrefs(workSelectors, 12);
        const workTitles = readers.readTexts(workSelectors, 12);
        facts.authorName = normalizeBilibiliTitleText(genericAuthorName, 'author')
          || readers.readText(['h1', '.nickname', '.up-name', '.h-name'])
          || normalizeBilibiliTitleText(title, 'author');
        facts.authorMid = pathname.match(/^\/(\d+)(?:\/|$)/u)?.[1]
          || readers.readPattern([/"mid"\s*:\s*(\d+)/u, /"mid":"?(\d+)"?/u]);
        facts.authorUrl = normalizedFinalUrl || null;
        facts.authorSubpage = bilibiliAuthorSubpageFromPath(pathname);
        facts.authorSubpagePath = pathname;
        const extractedCards = typeof readers.extractStructuredBilibiliAuthorCards === 'function'
          ? readers.extractStructuredBilibiliAuthorCards({
            pageType,
            siteProfile,
            finalUrl: normalizedFinalUrl,
            pathname,
            authorMid: facts.authorMid,
            authorName: facts.authorName,
            authorSubpage: facts.authorSubpage,
          })
          : null;
        const featuredAuthorCards = dedupeBilibiliAuthorCards(
          extractedCards?.authorCards?.length > 0
            ? extractedCards.authorCards
            : authorUrls.map((url, index) => ({
              url,
              mid: bilibiliMidFromUrl(url),
              name: authorNames[index] ?? null,
            })),
          facts.authorSubpage,
        );
        const featuredContentCards = dedupeBilibiliContentCards(
          extractedCards?.contentCards?.length > 0
            ? extractedCards.contentCards
            : workUrls.map((url, index) => ({
              url,
              title: workTitles[index] ?? null,
              bvid: bilibiliBvidFromUrl(url),
              authorMid: facts.authorMid,
              contentType: bilibiliContentTypeFromUrl(url),
              authorUrl: facts.authorUrl,
              authorName: facts.authorName,
            })),
          facts.authorMid,
        );
        facts.featuredAuthorCards = featuredAuthorCards;
        facts.featuredAuthors = featuredAuthorCards.map((card) => ({
          name: card.name,
          url: card.url,
          mid: card.mid,
        }));
        facts.featuredAuthorUrls = featuredAuthorCards.map((card) => card.url).filter(Boolean);
        facts.featuredAuthorNames = featuredAuthorCards.map((card) => card.name).filter(Boolean);
        facts.featuredAuthorMids = featuredAuthorCards.map((card) => card.mid).filter(Boolean);
        facts.featuredAuthorCount = featuredAuthorCards.length;
        facts.featuredContentCards = featuredContentCards;
        facts.featuredContentUrls = featuredContentCards.map((card) => card.url).filter(Boolean);
        facts.featuredContentTitles = featuredContentCards.map((card) => card.title).filter(Boolean);
        facts.featuredContentCount = featuredContentCards.length;
        facts.featuredContentTypes = featuredContentCards.map((card) => card.contentType).filter(Boolean);
        facts.featuredContentBvids = featuredContentCards.map((card) => card.bvid).filter(Boolean);
        facts.featuredContentAuthorMids = featuredContentCards.map((card) => card.authorMid).filter(Boolean);
        const antiCrawlSignals = detectBilibiliAntiCrawlSignals();
        if (antiCrawlSignals.length > 0) {
          facts.antiCrawlDetected = true;
          facts.antiCrawlSignals = antiCrawlSignals;
          facts.antiCrawlReasonCode = deriveBilibiliAntiCrawlReasonCode(antiCrawlSignals);
        }
      }
      return finalizeFacts(facts, {
        antiCrawlReasonCode: facts.antiCrawlReasonCode ?? null,
      });
    }

    if (pageType === 'category-page') {
      const facts = {
        categoryName: normalizeBilibiliTitleText(readers.readText(['h1', '.channel-title', '.page-title']), 'generic')
          || bilibiliCategoryNameFromPath(pathname),
      };
      if (isDouyinProfile) {
        const featuredContentTitles = readers.readTexts(['a[href*="/video/"]'], 32);
        const featuredContentUrls = readers.readHrefs(['a[href*="/video/"]'], 32)
          .map((value) => canonicalizeDouyinVideoUrl(value))
          .filter(Boolean);
        const featuredContentCards = buildDouyinContentCards(featuredContentUrls, featuredContentTitles, {});
        facts.categoryPath = pathname;
        facts.featuredContentCards = featuredContentCards;
        facts.featuredContentUrls = featuredContentCards.map((card) => card.url).filter(Boolean);
        facts.featuredContentTitles = featuredContentCards.map((card) => card.title).filter(Boolean);
        facts.featuredContentVideoIds = featuredContentCards.map((card) => card.videoId).filter(Boolean);
        facts.featuredContentCount = featuredContentCards.length;
        if (featuredContentCards.length > 0) {
          facts.featuredContentComplete = true;
        }
        return finalizeFacts(facts);
      }
      if (isBilibiliProfile) {
        const featuredContentUrls = readers.readHrefs([
          'a[href*="//www.bilibili.com/video/"]',
          'a[href*="/video/"]',
          'a[href*="//www.bilibili.com/bangumi/play/"]',
          'a[href*="/bangumi/play/"]',
        ], 16);
        const featuredContentTitles = readers.readTexts([
          'a[href*="//www.bilibili.com/video/"]',
          'a[href*="/video/"]',
          'a[href*="//www.bilibili.com/bangumi/play/"]',
          'a[href*="/bangumi/play/"]',
        ], 16);
        facts.categoryName = facts.categoryName || bilibiliCategoryNameFromPath(pathname);
        facts.categoryPath = pathname;
        facts.featuredContentUrls = featuredContentUrls;
        facts.featuredContentTitles = featuredContentTitles;
        facts.featuredContentTypes = featuredContentUrls
          .map((value) => bilibiliContentTypeFromUrl(value))
          .filter(Boolean)
          .slice(0, 16);
        facts.featuredContentCount = featuredContentUrls.length;
        facts.featuredContentBvids = featuredContentUrls
          .map((value) => bilibiliBvidFromUrl(value))
          .filter(Boolean)
          .slice(0, 10);
        facts.rankingLabels = readers.readTexts([
          '.rank-item .num',
          '.popular-rank .num',
          '.rank-wrap .rank-num',
          '.hot-list .rank',
        ], 12);
      }
      return finalizeFacts(facts);
    }

    if (pageType === 'chapter-page') {
      const contentText = cleanText(readers.readDocumentText());
      return finalizeFacts({
        bookTitle: readers.readText(['#info_url', '.crumbs a[href*="/biqu"]', '.bread-crumbs a[href*="/biqu"]']),
        authorName: readers.readMetaContent('og:novel:author'),
        chapterTitle: readers.readText(['.reader-main .title', 'h1.title', '.content_read h1', 'h1']),
        chapterHref: normalizedFinalUrl,
        prevChapterUrl: readers.readHref(['#prev_url', 'a#prev_url']),
        nextChapterUrl: readers.readHref(['#next_url', 'a#next_url']),
        bodyTextLength: contentText.length,
        bodyExcerpt: contentText.slice(0, 160) || null,
      });
    }

    return null;
  }

  return {
    derivePageFacts,
    bilibiliContentTypeFromUrl,
    bilibiliBvidFromUrl,
    bilibiliMidFromUrl,
  };
}
