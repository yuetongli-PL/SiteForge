import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initializeCliUtf8 } from './lib/cli.mjs';
import { openBrowserSession } from './lib/browser-runtime/session.mjs';
import { ensureAuthenticatedSession, inspectLoginState, resolveSiteBrowserSessionOptions } from './lib/site-auth.mjs';
import { classifyJableModelsPath } from './lib/site-path-classifiers.mjs';
import { isContentDetailPageType as isSharedContentDetailPageType } from './lib/sites/page-types.mjs';

const DEFAULT_OPTIONS = {
  initialManifestPath: undefined,
  initialEvidenceDir: undefined,
  outDir: path.resolve(process.cwd(), 'expanded-states'),
  browserPath: undefined,
  headless: true,
  timeoutMs: 30_000,
  waitUntil: 'load',
  idleMs: 1_000,
  fullPage: true,
  viewport: {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
  },
  userAgent: undefined,
  maxTriggers: 12,
  maxCapturedStates: Number.POSITIVE_INFINITY,
  searchQueries: [],
  captureChapterArtifacts: false,
  profilePath: undefined,
  siteProfile: null,
  reuseLoginState: undefined,
  browserProfileRoot: undefined,
  userDataDir: undefined,
  autoLogin: undefined,
};

const DOM_QUIET_MS = 500;
const MAX_FALLBACK_BOOKS = 1;
const CHAPTER_CHAIN_LIMIT = 100;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXPAND_HELPER_NAMESPACE = '__BWS_EXPAND__';
const SAME_DOCUMENT_TRIGGER_KINDS = new Set(['details-toggle', 'expanded-toggle', 'tab', 'menu-button', 'dialog-open']);
const DIRECT_NAVIGATION_TRIGGER_KINDS = new Set(['safe-nav-link', 'content-link', 'pagination-link', 'auth-link', 'chapter-link']);

function isContentDetailPageType(pageType) {
  return isSharedContentDetailPageType(pageType);
}

function createError(code, message) {
  return { code, message };
}

function normalizeWaitUntil(value) {
  if (value !== 'load' && value !== 'networkidle') {
    throw new Error(`Unsupported waitUntil value: ${value}`);
  }
  return value;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(
    value
      .map((item) => String(item ?? '').trim())
      .filter(Boolean),
  )];
}

function mergeStringArrays(...values) {
  return normalizeStringArray(values.flatMap((value) => normalizeStringArray(value)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBoolean(value, flagName) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true') {
      return true;
    }
    if (lower === 'false') {
      return false;
    }
  }
  throw new Error(`Invalid boolean for ${flagName}: ${value}`);
}

function normalizeNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid number for ${flagName}: ${value}`);
  }
  return parsed;
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

function inferProfilePageTypeFromPathname(pathname, siteProfile = null, currentHostname = '') {
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

function inferPageTypeFromUrl(input, siteProfile = null) {
  const normalized = normalizeUrlNoFragment(input);
  if (!normalized) {
    return 'unknown-page';
  }

  try {
    const parsed = new URL(normalized);
    const pathname = parsed.pathname || '/';
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
    if (/\/ss(?:\/|$)/i.test(pathname)) {
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

export function derivePageFacts({
  pageType,
  siteProfile = null,
  finalUrl = '',
  title = '',
  queryInputValue = '',
  textFromSelectors = () => null,
  hrefFromSelectors = () => null,
  textsFromSelectors = () => [],
  hrefsFromSelectors = () => [],
  metaContent = () => null,
  normalizeUrl = (value) => normalizeUrlNoFragment(value),
  documentText = '',
  extractStructuredBilibiliAuthorCards = null,
} = {}) {
  const normalizeText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const normalizeHost = (value) => String(value ?? '').trim().toLowerCase();
  const uniqueValues = (values) => [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
  const normalizedFinalUrl = normalizeUrl(finalUrl) || normalizeText(finalUrl);
  const profileHost = normalizeHost(siteProfile?.host ?? '');
  const currentHostname = (() => {
    try {
      return normalizeHost(new URL(normalizedFinalUrl).hostname);
    } catch {
      return profileHost;
    }
  })();
  const isBilibiliProfile = ['www.bilibili.com', 'search.bilibili.com', 'space.bilibili.com'].includes(profileHost)
    || ['www.bilibili.com', 'search.bilibili.com', 'space.bilibili.com'].includes(currentHostname);
  const readDocumentText = (() => {
    let cached = null;
    return () => {
      if (cached !== null) {
        return cached;
      }
      cached = normalizeText(typeof documentText === 'function' ? documentText() : documentText);
      return cached;
    };
  })();
  const readText = (selectors = []) => normalizeText(textFromSelectors(selectors)) || null;
  const readHref = (selectors = []) => {
    const value = hrefFromSelectors(selectors);
    return value ? normalizeUrl(value) : null;
  };
  const readTexts = (selectors = [], limit = 20) => uniqueValues(textsFromSelectors(selectors)).slice(0, limit);
  const readHrefs = (selectors = [], limit = 20) => uniqueValues(hrefsFromSelectors(selectors).map((value) => normalizeUrl(value))).slice(0, limit);
  const readPattern = (patterns = []) => {
    const source = readDocumentText();
    for (const pattern of patterns) {
      const matched = source.match(pattern);
      const value = normalizeText(matched?.[1] ?? '');
      if (value) {
        return value;
      }
    }
    return null;
  };
  const parsedUrl = (() => {
    try {
      return new URL(normalizedFinalUrl || finalUrl);
    } catch {
      return null;
    }
  })();
  const pathname = parsedUrl?.pathname || '/';
  const bilibiliContentTypeFromUrl = (value) => {
    const normalizedValue = normalizeText(value);
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
  };
  const bilibiliBvidFromUrl = (value) => normalizeText(value?.match(/\/video\/(BV[0-9A-Za-z]+)/u)?.[1] || '') || null;
  const bilibiliMidFromUrl = (value) => normalizeText(value?.match(/space\.bilibili\.com\/(\d+)/u)?.[1] || '') || null;
  const bilibiliAuthorSubpageFromPath = (value) => {
    const matched = String(value || '').match(/^\/\d+(?:\/([^?#]+))?/u);
    const normalized = normalizeText(String(matched?.[1] || '').replace(/^\/+|\/+$/gu, ''));
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
  const normalizeBilibiliAuthorCard = (card = {}, authorSubpage = null) => {
    const name = normalizeText(card.name);
    const url = card.url ? normalizeUrl(card.url) : null;
    const mid = normalizeText(card.mid) || bilibiliMidFromUrl(url);
    if (!name && !url && !mid) {
      return null;
    }
    return {
      name: name || null,
      url: url || null,
      mid: mid || null,
      authorSubpage: normalizeText(card.authorSubpage) || authorSubpage || null,
      cardKind: normalizeText(card.cardKind) || 'author',
    };
  };
  const normalizeBilibiliContentCard = (card = {}, fallbackAuthorMid = null) => {
    const url = card.url ? normalizeUrl(card.url) : null;
    const titleValue = normalizeText(card.title);
    const bvid = normalizeText(card.bvid) || bilibiliBvidFromUrl(url);
    const authorMid = normalizeText(card.authorMid) || fallbackAuthorMid || null;
    const contentType = normalizeText(card.contentType) || bilibiliContentTypeFromUrl(url);
    const authorUrl = card.authorUrl ? normalizeUrl(card.authorUrl) : null;
    const authorName = normalizeText(card.authorName);
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
  const dedupeBilibiliAuthorCards = (cards = [], authorSubpage = null) => {
    const seen = new Set();
    const result = [];
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
  const dedupeBilibiliContentCards = (cards = [], fallbackAuthorMid = null) => {
    const seen = new Set();
    const result = [];
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
    const source = readDocumentText();
    if (!source) {
      return [];
    }
    const signals = [];
    const patterns = [
      ['rate-limit', /\u8bbf\u95ee\u9891\u7e41/u],
      ['verify', /\u5b89\u5168\u9a8c\u8bc1/u],
      ['slide-verify', /\u6ed1\u52a8\u9a8c\u8bc1/u],
      ['captcha', /captcha/iu],
      ['risk-control', /\u98ce\u63a7/u],
      ['retry-later', /\u8bf7\u7a0d\u540e\u518d\u8bd5/u],
    ];
    for (const [label, pattern] of patterns) {
      if (pattern.test(source)) {
        signals.push(label);
      }
    }
    return signals;
  };
  const normalizeBilibiliTitleText = (value, kind = 'generic') => {
    const normalizedValue = normalizeText(value);
    if (!normalizedValue) {
      return null;
    }

    let cleaned = normalizedValue
      .replace(/\s*[-_]\s*(?:哔哩哔哩|bilibili).*$/iu, '')
      .replace(/\s*[|｜]\s*(?:哔哩哔哩|bilibili).*$/iu, '')
      .replace(/\s*-\s*[^-]*个人主页.*$/iu, '')
      .trim();

    if (kind === 'author') {
      const authorMatch = cleaned.match(/^(.+?)的个人空间(?:[-_].*)?$/u);
      if (authorMatch?.[1]) {
        cleaned = normalizeText(authorMatch[1]);
      }
    }

    return normalizeText(cleaned) || null;
  };
  const bilibiliCategoryNameFromPath = (value) => {
    const normalizedPath = String(value || '').toLowerCase();
    if (normalizedPath.startsWith('/v/popular/')) {
      return '热门';
    }
    if (normalizedPath.startsWith('/anime/')) {
      return '番剧';
    }
    if (normalizedPath.startsWith('/movie/')) {
      return '电影';
    }
    if (normalizedPath.startsWith('/guochuang/')) {
      return '国创';
    }
    if (normalizedPath.startsWith('/tv/')) {
      return '电视剧';
    }
    if (normalizedPath.startsWith('/variety/')) {
      return '综艺';
    }
    if (normalizedPath.startsWith('/documentary/')) {
      return '纪录片';
    }
    if (normalizedPath.startsWith('/knowledge/')) {
      return '知识';
    }
    if (normalizedPath.startsWith('/music/')) {
      return '音乐';
    }
    if (normalizedPath.startsWith('/game/')) {
      return '游戏';
    }
    if (normalizedPath.startsWith('/food/')) {
      return '美食';
    }
    if (normalizedPath.startsWith('/sports/')) {
      return '运动';
    }
    if (normalizedPath.startsWith('/c/')) {
      return '分区';
    }
    return null;
  };

  if (pageType === 'search-results-page') {
    const profileResultTitleSelectors = Array.isArray(siteProfile?.search?.resultTitleSelectors)
      ? siteProfile.search.resultTitleSelectors
      : ['.layout-co18 .layout-tit', '.layout2 .layout-tit'];
    const profileResultBookSelectors = Array.isArray(siteProfile?.search?.resultBookSelectors)
      ? siteProfile.search.resultBookSelectors
      : ['.txt-list-row5 li .s2 a[href]', '.layout-co18 .txt-list a[href]'];
    const queryParamNames = Array.isArray(siteProfile?.search?.queryParamNames)
      ? siteProfile.search.queryParamNames
      : ['searchkey', 'keyword', 'q'];
    const resultTitles = readTexts(profileResultBookSelectors, 20);
    const resultUrls = readHrefs(profileResultBookSelectors, 20);
    const queryFromTitle = (() => {
      const headingText = readText(profileResultTitleSelectors) || normalizeText(title);
      const matched = headingText.match(/^(.*?)\s*[-_]\s*(?:哔哩哔哩|bilibili)/iu)
        || headingText.match(/(?:搜索|search)\s*[:："“”]*\s*(.+?)(?:\s*[-_]|$)/iu);
      return normalizeText(matched?.[1] || '');
    })();
    const derivedQuery = (() => {
      if (parsedUrl) {
        for (const name of queryParamNames) {
          const value = normalizeText(parsedUrl.searchParams.get(name) || '');
          if (value) {
            return value;
          }
        }
        const fromPath = parsedUrl.pathname.match(/\/ss\/(.+?)(?:\.html)?$/i)?.[1] || '';
        const fromPathText = decodeURIComponent(fromPath).replace(/\.html$/i, '');
        if (normalizeText(fromPathText)) {
          return normalizeText(fromPathText);
        }
      }
      return queryFromTitle;
    })();
    const facts = {
      queryText: normalizeText(queryInputValue || derivedQuery) || null,
      resultCount: Math.max(resultUrls.length, resultTitles.length),
      resultTitles,
    };
    if (isBilibiliProfile) {
      const resultAuthorUrls = readHrefs([
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
    return facts;
  }

  if (isContentDetailPageType(pageType)) {
    const chapterLinkSelectors = Array.isArray(siteProfile?.bookDetail?.chapterLinkSelectors)
      ? siteProfile.bookDetail.chapterLinkSelectors
      : ['#list a[href]', '.listmain a[href]', 'dd a[href]', '.book_last a[href]'];
    const chapterUrls = readHrefs(chapterLinkSelectors, 200);
    const genericBookTitle = metaContent('og:novel:book_name')
      || readText(
        Array.isArray(siteProfile?.contentDetail?.titleSelectors)
          ? siteProfile.contentDetail.titleSelectors
          : ['h1', '.book h1', '#bookinfo h1', 'h2'],
      );
    const genericAuthorName = metaContent('og:novel:author')
      || readText(
        Array.isArray(siteProfile?.contentDetail?.authorNameSelectors)
          ? siteProfile.contentDetail.authorNameSelectors
          : ['a[href*="/author/"]', '.small span a'],
      );
    const genericAuthorUrl = (() => {
      const value = metaContent('og:novel:author_link')
        || readHref(
          Array.isArray(siteProfile?.contentDetail?.authorLinkSelectors)
            ? siteProfile.contentDetail.authorLinkSelectors
            : ['a[href*="/author/"]'],
        );
      return value ? normalizeUrl(value) : null;
    })();
    const facts = {
      bookTitle: genericBookTitle,
      authorName: genericAuthorName,
      authorUrl: genericAuthorUrl,
      chapterCount: chapterUrls.length,
      latestChapterTitle: readText(['.book_last a', '#list a']),
      latestChapterUrl: (() => {
        const value = metaContent('og:novel:lastest_chapter_url') || chapterUrls[0] || '';
        return value ? normalizeUrl(value) : null;
      })(),
    };
    if (isBilibiliProfile) {
      const bilibiliTitle = normalizeBilibiliTitleText(genericBookTitle, 'content')
        || readText(['h1.video-title', 'h1', '.video-title', '.media-title'])
        || normalizeBilibiliTitleText(title, 'content');
      const authorUrl = genericAuthorUrl
        || readHref(['a.up-name[href*="space.bilibili.com/"]', '.video-owner-card a[href*="space.bilibili.com/"]', 'a[href*="space.bilibili.com/"]']);
      const bvid = normalizedFinalUrl.match(/\/video\/(BV[0-9A-Za-z]+)/u)?.[1]
        || readPattern([/"bvid"\s*:\s*"([^"]+)"/u, /"bvid":"([^"]+)"/u]);
      const aid = readPattern([/"aid"\s*:\s*(\d+)/u, /"aid":"?(\d+)"?/u]);
      const authorMid = authorUrl?.match(/space\.bilibili\.com\/(\d+)/u)?.[1]
        || pathname.match(/^\/(?:bangumi\/play\/|video\/)?(\d+)$/u)?.[1]
        || readPattern([/"mid"\s*:\s*(\d+)/u, /"mid":"?(\d+)"?/u]);
      const publishedAt = metaContent('og:video:release_date')
        || metaContent('article:published_time')
        || readText(['time', '.pubdate-text', '.video-publish time', '[class*="pubdate"]']);
      const categoryName = readText([
        '.video-info-detail a',
        '.video-detail-title a',
        '.first-channel',
        'a[href*="/v/"]',
      ]);
      const seasonId = readPattern([/"season_id"\s*:\s*(\d+)/u, /"seasonId"\s*:\s*(\d+)/u]);
      const episodeId = pathname.match(/\/bangumi\/play\/ep(\d+)/u)?.[1]
        || readPattern([/"ep_id"\s*:\s*(\d+)/u, /"episode_id"\s*:\s*(\d+)/u, /"epId"\s*:\s*(\d+)/u]);
      const seriesTitle = readText([
        '.media-title',
        '.media-info-title',
        '.media-right .title',
        '.mediainfo_mediaTitle',
      ]);
      const episodeTitle = readText([
        'h1.video-title',
        '.video-title',
        '.ep-info-title',
        'h1',
      ]);
      const tagNames = readTexts([
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
        || readText(['a.up-name', '.up-name', '.up-detail-top .up-name', '.video-owner-card .name']);
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
    return facts;
  }

  if (pageType === 'author-page' || pageType === 'author-list-page') {
    const genericAuthorName = metaContent('og:novel:author')
      || readText(
        Array.isArray(siteProfile?.author?.titleSelectors)
          ? siteProfile.author.titleSelectors
          : ['h1', '.author h1', '.title h1', 'h2'],
      );
    const facts = {
      authorName: genericAuthorName,
    };
    if (isBilibiliProfile) {
      const authorUrls = readHrefs([
        'a[href*="space.bilibili.com/"]',
      ], 16).filter((value) => value !== normalizedFinalUrl);
      const authorNames = readTexts([
        'a[href*="space.bilibili.com/"] .name',
        'a[href*="space.bilibili.com/"] .up-name',
        'a[href*="space.bilibili.com/"]',
      ], 16).filter((value) => value !== facts.authorName);
      const workUrls = readHrefs(
        Array.isArray(siteProfile?.author?.workLinkSelectors)
          ? siteProfile.author.workLinkSelectors
          : ['a[href*="/video/BV"]'],
        12,
      );
      const workTitles = readTexts(
        Array.isArray(siteProfile?.author?.workLinkSelectors)
          ? siteProfile.author.workLinkSelectors
          : ['a[href*="/video/BV"]'],
        12,
      );
      facts.authorName = normalizeBilibiliTitleText(genericAuthorName, 'author')
        || readText(['h1', '.nickname', '.up-name', '.h-name'])
        || normalizeBilibiliTitleText(title, 'author');
      facts.authorMid = pathname.match(/^\/(\d+)(?:\/|$)/u)?.[1]
        || readPattern([/"mid"\s*:\s*(\d+)/u, /"mid":"?(\d+)"?/u]);
      facts.authorUrl = normalizedFinalUrl || null;
      facts.authorSubpage = bilibiliAuthorSubpageFromPath(pathname);
      facts.authorSubpagePath = pathname;
      const extractedCards = typeof extractStructuredBilibiliAuthorCards === 'function'
        ? extractStructuredBilibiliAuthorCards({
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
      }
    }
    return facts;
  }

  if (pageType === 'category-page') {
    const facts = {
      categoryName: normalizeBilibiliTitleText(readText(['h1', '.channel-title', '.page-title']), 'generic')
        || bilibiliCategoryNameFromPath(pathname),
    };
    if (isBilibiliProfile) {
      const featuredContentUrls = readHrefs([
        'a[href*="//www.bilibili.com/video/"]',
        'a[href*="/video/"]',
        'a[href*="//www.bilibili.com/bangumi/play/"]',
        'a[href*="/bangumi/play/"]',
      ], 16);
      const featuredContentTitles = readTexts([
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
      facts.rankingLabels = readTexts([
        '.rank-item .num',
        '.popular-rank .num',
        '.rank-wrap .rank-num',
        '.hot-list .rank',
      ], 12);
    }
    return facts;
  }

  if (pageType === 'chapter-page') {
    const contentText = normalizeText(readDocumentText());
    return {
      bookTitle: readText(['#info_url', '.crumbs a[href*="/biqu"]', '.bread-crumbs a[href*="/biqu"]']),
      authorName: metaContent('og:novel:author'),
      chapterTitle: readText(['.reader-main .title', 'h1.title', '.content_read h1', 'h1']),
      chapterHref: normalizedFinalUrl,
      prevChapterUrl: readHref(['#prev_url', 'a#prev_url']),
      nextChapterUrl: readHref(['#next_url', 'a#next_url']),
      bodyTextLength: contentText.length,
      bodyExcerpt: contentText.slice(0, 160) || null,
    };
  }

  return null;
}

function isJableSiteProfile(siteProfile = null, baseUrl = '') {
  const profileHost = String(siteProfile?.host ?? '').toLowerCase();
  const urlHost = (() => {
    try {
      return new URL(String(baseUrl || '')).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  return profileHost === 'jable.tv' || profileHost === 'www.jable.tv' || urlHost === 'jable.tv' || urlHost === 'www.jable.tv';
}

function isMoodyzSiteProfile(siteProfile = null, baseUrl = '') {
  const profileHost = String(siteProfile?.host ?? '').toLowerCase();
  const urlHost = (() => {
    try {
      return new URL(String(baseUrl || '')).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  return profileHost === 'moodyz.com' || profileHost === 'www.moodyz.com' || urlHost === 'moodyz.com' || urlHost === 'www.moodyz.com';
}

function isBilibiliSiteProfile(siteProfile = null, baseUrl = '') {
  const allowedHosts = new Set(['www.bilibili.com', 'search.bilibili.com', 'space.bilibili.com']);
  const profileHost = String(siteProfile?.host ?? '').toLowerCase();
  const urlHost = (() => {
    try {
      return new URL(String(baseUrl || '')).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  return allowedHosts.has(profileHost) || allowedHosts.has(urlHost);
}

function buildBilibiliWaitPolicy(settings, pageType, { directNavigation = false, trigger = null } = {}) {
  if (!['search-results-page', 'author-page', 'author-list-page', 'category-page'].includes(pageType) && !isContentDetailPageType(pageType)) {
    return null;
  }

  const triggerKind = String(trigger?.kind ?? '');
  const isSearch = pageType === 'search-results-page';
  const isDetail = isContentDetailPageType(pageType);
  const isAuthor = pageType === 'author-page' || pageType === 'author-list-page';
  const isAuthorList = pageType === 'author-list-page';

  return {
    useLoadEvent: false,
    useNetworkIdle: false,
    documentReadyTimeoutMs: Math.min(settings.timeoutMs, directNavigation ? (isAuthorList ? 7_200 : 6_000) : (isAuthorList ? 9_000 : 8_000)),
    domQuietTimeoutMs: Math.min(
      settings.timeoutMs,
      directNavigation
        ? (isSearch ? 1_600 : isDetail ? 1_900 : isAuthorList ? 2_800 : isAuthor ? 1_800 : 2_000)
        : (isSearch ? 2_000 : isDetail ? 2_400 : isAuthorList ? 3_400 : isAuthor ? 2_100 : 2_300),
    ),
    domQuietMs:
      triggerKind === 'content-link'
        ? 120
        : triggerKind === 'safe-nav-link' && isAuthor
          ? 140
          : triggerKind === 'search-form'
            ? 160
            : isSearch
              ? 170
              : isDetail
                ? 180
                : isAuthorList
                  ? 210
                  : 170,
    idleMs: Math.min(settings.idleMs, directNavigation ? (isAuthorList ? 220 : 120) : (isAuthorList ? 260 : 150)),
  };
}

async function waitForSelectorMatches(session, selectors, {
  minCount = 1,
  timeoutMs = 2_000,
  pollMs = 100,
  settleMs = 150,
} = {}) {
  const normalizedSelectors = normalizeStringArray(selectors);
  if (normalizedSelectors.length === 0) {
    return false;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const matchCount = await session.callPageFunction((innerSelectors) => innerSelectors.reduce((count, selector) => {
        try {
          return count + document.querySelectorAll(selector).length;
        } catch {
          return count;
        }
      }, 0), normalizedSelectors);
      if (Number(matchCount) >= minCount) {
        if (settleMs > 0) {
          await sleep(settleMs);
        }
        return true;
      }
    } catch {
      // Ignore transient evaluation failures while the page is still hydrating.
    }
    await sleep(pollMs);
  }

  return false;
}

function resolveBilibiliReadySelectors(siteProfile, pageType) {
  const defaultContentSelectors = [
    'a[href*="www.bilibili.com/video/"]',
    'a[href*="/video/BV"]',
    'a[href*="www.bilibili.com/bangumi/play/"]',
    'a[href*="/bangumi/play/"]',
  ];
  if (pageType === 'search-results-page') {
    return siteProfile?.search?.resultBookSelectors ?? defaultContentSelectors;
  }
  if (pageType === 'author-page' || pageType === 'author-list-page' || pageType === 'category-page') {
    return siteProfile?.author?.workLinkSelectors ?? defaultContentSelectors;
  }
  if (isContentDetailPageType(pageType)) {
    return siteProfile?.contentDetail?.authorLinkSelectors ?? ['a[href*="space.bilibili.com/"]'];
  }
  return [];
}

function resolveBilibiliReadyWaitOptions(pageType) {
  if (pageType === 'author-list-page') {
    return { timeoutMs: 6_500, pollMs: 140, settleMs: 220 };
  }
  if (pageType === 'author-page' || pageType === 'category-page' || pageType === 'search-results-page') {
    return { timeoutMs: 2_800, pollMs: 100, settleMs: 160 };
  }
  if (isContentDetailPageType(pageType)) {
    return { timeoutMs: 2_200, pollMs: 100, settleMs: 140 };
  }
  return null;
}

async function ensureSiteSpecificReadyMarkers(session, siteProfile = null, url = '') {
  if (!isBilibiliSiteProfile(siteProfile, url)) {
    return;
  }

  const pageType = inferPageTypeFromUrl(url, siteProfile);
  const selectors = resolveBilibiliReadySelectors(siteProfile, pageType);
  const waitOptions = resolveBilibiliReadyWaitOptions(pageType);
  if (!waitOptions || selectors.length === 0) {
    return;
  }

  await waitForSelectorMatches(session, selectors, waitOptions);
}

function resolveNavigationWaitPolicy(settings, siteProfile = null, baseUrl = '') {
  if (isJableSiteProfile(siteProfile, baseUrl)) {
    return {
      useLoadEvent: false,
      useNetworkIdle: false,
      documentReadyTimeoutMs: Math.min(settings.timeoutMs, 8_000),
      domQuietTimeoutMs: Math.min(settings.timeoutMs, 3_000),
      domQuietMs: 150,
      idleMs: Math.min(settings.idleMs, 250),
    };
  }

  if (isMoodyzSiteProfile(siteProfile, baseUrl)) {
    const pageType = inferPageTypeFromUrl(baseUrl, siteProfile);
    if (['category-page', 'search-results-page', 'author-page', 'author-list-page'].includes(pageType) || isContentDetailPageType(pageType)) {
      return {
        useLoadEvent: false,
        useNetworkIdle: false,
        documentReadyTimeoutMs: Math.min(settings.timeoutMs, 8_000),
        domQuietTimeoutMs: Math.min(settings.timeoutMs, 2_500),
        domQuietMs: 200,
        idleMs: Math.min(settings.idleMs, 150),
      };
    }
  }

  if (isBilibiliSiteProfile(siteProfile, baseUrl)) {
    const pageType = inferPageTypeFromUrl(baseUrl, siteProfile);
    const policy = buildBilibiliWaitPolicy(settings, pageType);
    if (policy) {
      return policy;
    }
  }

  return {
    useLoadEvent: true,
    useNetworkIdle: settings.waitUntil === 'networkidle',
    documentReadyTimeoutMs: settings.timeoutMs,
    domQuietTimeoutMs: settings.timeoutMs,
    domQuietMs: DOM_QUIET_MS,
    idleMs: settings.idleMs,
  };
}

function chapterChainBaseUrl(input) {
  const normalized = normalizeUrlNoFragment(input);
  if (!normalized) {
    return null;
  }
  return normalized.replace(/_(\d+)(\.html)$/i, '$2');
}

function isChapterPaginationUrl(currentUrl, nextUrl) {
  const currentBase = chapterChainBaseUrl(currentUrl);
  const nextBase = chapterChainBaseUrl(nextUrl);
  if (!currentBase || !nextBase) {
    return false;
  }
  if (currentBase !== nextBase) {
    return false;
  }
  return normalizeUrlNoFragment(currentUrl) !== normalizeUrlNoFragment(nextUrl);
}

async function loadSiteProfile(baseUrl, explicitProfilePath = null, explicitSiteProfile = null) {
  if (explicitSiteProfile && typeof explicitSiteProfile === 'object') {
    return explicitSiteProfile;
  }
  if (explicitProfilePath && await fileExists(explicitProfilePath)) {
    return JSON.parse(await readFile(explicitProfilePath, 'utf8'));
  }
  try {
    const parsed = new URL(baseUrl);
    const hostnames = [parsed.hostname];
    if (parsed.hostname.startsWith('www.')) {
      hostnames.push(parsed.hostname.slice(4));
    } else {
      hostnames.push(`www.${parsed.hostname}`);
    }
    for (const hostname of hostnames) {
      const profilePath = path.join(MODULE_DIR, 'profiles', `${hostname}.json`);
      if (await fileExists(profilePath)) {
        return JSON.parse(await readFile(profilePath, 'utf8'));
      }
    }
    return null;
  } catch {
    return null;
  }
}

function formatTimestampForDir(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1Z');
}

function sanitizeHost(host) {
  return (host || 'unknown-host').replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unknown-host';
}

function slugify(value, fallback = 'state') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || fallback;
}

function emptyFiles() {
  return {
    html: null,
    snapshot: null,
    screenshot: null,
    manifest: null,
    chapterPages: null,
    chapterText: null,
  };
}

function nextStateId(index) {
  return `s${String(index).padStart(4, '0')}`;
}

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

function hashFingerprint(fingerprint) {
  return createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');
}

function bilibiliBvidFromUrl(input) {
  const value = normalizeUrlNoFragment(input);
  if (!value) {
    return null;
  }
  return String(value).match(/\/video\/(BV[0-9A-Za-z]+)/u)?.[1] ?? null;
}

function buildPageFactsSyntheticTriggers(pageType, pageFacts = null) {
  if (!pageFacts || typeof pageFacts !== 'object') {
    return [];
  }

  const buildLinkTrigger = (kind, href, {
    label = null,
    semanticRole = 'content',
    primary = 'page-facts',
    ordinal = 9_000,
  } = {}) => {
    const normalizedHref = normalizeUrlNoFragment(href);
    if (!normalizedHref) {
      return null;
    }
    return {
      kind,
      label: label || bilibiliBvidFromUrl(normalizedHref) || normalizedHref,
      locator: {
        primary,
        id: null,
        ariaControls: null,
        role: kind.endsWith('link') ? 'link' : null,
        label: label || bilibiliBvidFromUrl(normalizedHref) || normalizedHref,
        tagName: 'a',
        href: normalizedHref,
        textSnippet: label || bilibiliBvidFromUrl(normalizedHref) || normalizedHref,
        domPath: null,
        inputName: null,
        formAction: null,
        submitSelector: null,
      },
      controlledTarget: null,
      href: normalizedHref,
      queryText: null,
      semanticRole,
      ordinal,
    };
  };

  const urlEntries = [];
  if (pageType === 'search-results-page') {
    for (const href of pageFacts.resultUrls ?? []) {
      urlEntries.push(buildLinkTrigger('content-link', href, { semanticRole: 'content', ordinal: 9_100 }));
    }
  }
  if (['author-page', 'author-list-page', 'category-page'].includes(pageType)) {
    for (const href of pageFacts.featuredContentUrls ?? []) {
      urlEntries.push(buildLinkTrigger('content-link', href, { semanticRole: 'content', ordinal: 9_200 }));
    }
  }
  if (pageType === 'author-list-page') {
    for (const href of pageFacts.featuredAuthorUrls ?? []) {
      urlEntries.push(buildLinkTrigger('safe-nav-link', href, { semanticRole: 'author', ordinal: 9_250 }));
    }
  }
  if (isContentDetailPageType(pageType) && pageFacts.authorUrl) {
    urlEntries.push(buildLinkTrigger('safe-nav-link', pageFacts.authorUrl, {
      semanticRole: 'author',
      label: pageFacts.authorName || 'Author Page',
      ordinal: 9_300,
    }));
  }

  return urlEntries.filter(Boolean);
}

function mergeDiscoveredTriggers(discoveredTriggers, syntheticTriggers) {
  const merged = [...(Array.isArray(discoveredTriggers) ? discoveredTriggers : [])];
  const seen = new Set(merged.map((trigger) => JSON.stringify([
    trigger?.kind ?? null,
    normalizeUrlNoFragment(trigger?.href ?? trigger?.locator?.href ?? null),
    trigger?.queryText ?? null,
    trigger?.semanticRole ?? null,
  ])));

  for (const trigger of syntheticTriggers) {
    const dedupeKey = JSON.stringify([
      trigger?.kind ?? null,
      normalizeUrlNoFragment(trigger?.href ?? trigger?.locator?.href ?? null),
      trigger?.queryText ?? null,
      trigger?.semanticRole ?? null,
    ]);
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    merged.push(trigger);
  }

  return merged;
}

function resolveManifestLinkedPath(manifestPath, linkedPath) {
  if (!linkedPath) {
    return linkedPath;
  }
  if (path.isAbsolute(linkedPath)) {
    return linkedPath;
  }
  return path.resolve(path.dirname(manifestPath), linkedPath);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function pageWaitForDomQuiet(innerQuietMs, innerTimeoutMs) {
  return new Promise((resolve) => {
    const root = document.documentElement || document.body || document;
    const start = performance.now();
    let lastMutationAt = start;
    let settled = false;

    const finish = (reason) => {
      if (settled) {
        return;
      }
      settled = true;
      observer.disconnect();
      clearInterval(interval);
      clearTimeout(timeoutHandle);
      resolve({
        reason,
        elapsedMs: Math.round(performance.now() - start),
      });
    };

    const observer = new MutationObserver(() => {
      lastMutationAt = performance.now();
    });

    observer.observe(root, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });

    const interval = setInterval(() => {
      if (performance.now() - lastMutationAt >= innerQuietMs) {
        finish('quiet');
      }
    }, 50);

    const timeoutHandle = setTimeout(() => {
      finish('timeout');
    }, innerTimeoutMs);
  });
}

function buildStateFiles(stateDir) {
  return {
    html: path.join(stateDir, 'page.html'),
    snapshot: path.join(stateDir, 'dom-snapshot.json'),
    screenshot: path.join(stateDir, 'screenshot.png'),
    manifest: path.join(stateDir, 'manifest.json'),
    chapterPages: path.join(stateDir, 'chapter-pages.json'),
    chapterText: path.join(stateDir, 'chapter-text.txt'),
  };
}

function pageExtractChapterPayload(siteProfile = null) {
  const profileConfig = {
    contentSelectors: siteProfile?.chapter?.contentSelectors ?? ['#content', '.content', '.reader-main .content'],
    titleSelectors: siteProfile?.chapter?.titleSelectors ?? ['.reader-main .title', 'h1.title', '.content_read h1', 'h1'],
    prevSelectors: [siteProfile?.chapter?.prevSelector, '#prev_url', 'a#prev_url'].filter(Boolean),
    nextSelectors: [siteProfile?.chapter?.nextSelector, '#next_url', 'a#next_url'].filter(Boolean),
  };

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalizeUrlNoFragmentLocal(value) {
    try {
      const parsed = new URL(value, document.baseURI);
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return String(value ?? '').split('#')[0];
    }
  }

  function firstText(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const text = normalizeText(element?.textContent || element?.innerText || '');
      if (text) {
        return text;
      }
    }
    return null;
  }

  function hrefOf(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const href = element?.getAttribute('href');
      if (href) {
        return normalizeUrlNoFragmentLocal(href);
      }
    }
    return null;
  }

  const paragraphSelectors = profileConfig.contentSelectors.map((selector) => `${selector} p`).join(', ');
  const paragraphs = Array.from(document.querySelectorAll(paragraphSelectors))
    .map((node) => normalizeText(node.textContent || node.innerText || ''))
    .filter(Boolean);
  const rawContent = paragraphs.length > 0
    ? paragraphs.join('\n\n')
    : normalizeText(
      profileConfig.contentSelectors
        .map((selector) => document.querySelector(selector))
        .find(Boolean)?.textContent || '',
    );

  const chapterTitle = firstText(profileConfig.titleSelectors);
  const bookTitle = firstText([
    '.crumbs a[href*="/biqu"]',
    '.bread-crumbs a[href*="/biqu"]',
    '.reader-nav a[href*="/biqu"]',
    '#info_url',
  ]);
  const authorName = normalizeText(
    document.querySelector('meta[property="og:novel:author"]')?.getAttribute('content')
    || document.querySelector('meta[name="og:novel:author"]')?.getAttribute('content')
    || '',
  ) || null;
  const previousUrl = hrefOf(profileConfig.prevSelectors);
  const nextUrl = hrefOf(profileConfig.nextSelectors);

  return {
    url: normalizeUrlNoFragmentLocal(location.href),
    pageTitle: document.title || '',
    bookTitle,
    authorName,
    chapterTitle,
    contentText: rawContent,
    contentLength: rawContent.length,
    previousUrl,
    nextUrl,
  };
}

async function captureChapterArtifacts({ session, stateDir, currentUrl, settings, siteProfile }) {
  const files = buildStateFiles(stateDir);
  const pages = [];
  const chunks = [];
  const visited = new Set();
  let cursor = normalizeUrlNoFragment(currentUrl);
  let lastPayload = null;

  for (let index = 0; index < CHAPTER_CHAIN_LIMIT && cursor; index += 1) {
    const normalizedCursor = normalizeUrlNoFragment(cursor);
    if (!normalizedCursor || visited.has(normalizedCursor)) {
      break;
    }
    visited.add(normalizedCursor);

    if (index > 0) {
      await navigateAndWaitReady(session, normalizedCursor, settings, siteProfile);
    }

    const payload = await extractChapterPayload(session, siteProfile);
    lastPayload = payload;
    pages.push({
      index: index + 1,
      url: payload.url,
      pageTitle: payload.pageTitle,
      chapterTitle: payload.chapterTitle,
      contentLength: payload.contentLength,
    });
    if (payload.contentText) {
      chunks.push(payload.contentText);
    }

    const nextUrl = normalizeUrlNoFragment(payload.nextUrl);
    if (!nextUrl || !isChapterPaginationUrl(normalizedCursor, nextUrl)) {
      break;
    }
    cursor = nextUrl;
  }

  if (pages.length > 0) {
    await writeFile(files.chapterPages, JSON.stringify(pages, null, 2), 'utf8');
  }
  if (chunks.length > 0) {
    await writeFile(files.chapterText, `${chunks.join('\n\n')}\n`, 'utf8');
  }

  return {
    chapterPagesPath: pages.length > 0 ? files.chapterPages : null,
    chapterTextPath: chunks.length > 0 ? files.chapterText : null,
    chapterPayload: lastPayload,
  };
}

async function createExpandOutputLayout(baseUrl, fallbackUrl, outDir) {
  let parsedUrl = null;
  try {
    parsedUrl = new URL(baseUrl || fallbackUrl);
  } catch {
    // Keep a stable output layout for invalid URLs too.
  }

  const generatedAt = new Date().toISOString();
  const dirTimestamp = formatTimestampForDir(new Date(generatedAt));
  const host = sanitizeHost(parsedUrl?.hostname ?? 'invalid-url');
  const rootDir = path.resolve(outDir, `${dirTimestamp}_${host}_expanded`);
  const statesDir = path.join(rootDir, 'states');
  await mkdir(statesDir, { recursive: true });

  return {
    rootDir,
    statesDir,
    generatedAt,
    manifestPath: path.join(rootDir, 'states-manifest.json'),
  };
}

function buildTopLevelManifest(inputUrl, baseUrl, layout) {
  return {
    inputUrl,
    baseUrl,
    generatedAt: layout.generatedAt,
    initialStateId: 's0000',
    outDir: layout.rootDir,
    summary: {
      discoveredTriggers: 0,
      attemptedTriggers: 0,
      capturedStates: 0,
      duplicateStates: 0,
      noopTriggers: 0,
      failedTriggers: 0,
    },
    budget: null,
    warnings: [],
    states: [],
  };
}

async function writeTopLevelManifest(manifestPath, manifest) {
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

async function resolveInitialManifest(options) {
  const initialManifestPath = options.initialManifestPath ? path.resolve(options.initialManifestPath) : null;
  const initialEvidenceDir = options.initialEvidenceDir ? path.resolve(options.initialEvidenceDir) : null;

  if (initialManifestPath && initialEvidenceDir) {
    throw new Error('Specify only one of initialManifestPath or initialEvidenceDir');
  }
  if (!initialManifestPath && !initialEvidenceDir) {
    throw new Error('One of initialManifestPath or initialEvidenceDir is required');
  }

  const manifestPath = initialManifestPath ?? path.join(initialEvidenceDir, 'manifest.json');
  if (!(await fileExists(manifestPath))) {
    throw new Error(`Initial manifest not found: ${manifestPath}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    throw new Error(`Failed to parse initial manifest: ${manifestPath}`);
  }

  const requiredStringFields = ['finalUrl', 'capturedAt'];
  for (const field of requiredStringFields) {
    if (typeof manifest[field] !== 'string' || manifest[field].length === 0) {
      throw new Error(`Initial manifest is missing required field: ${field}`);
    }
  }
  if (typeof manifest.title !== 'string') {
    throw new Error('Initial manifest is missing required field: title');
  }
  if (!manifest.files || typeof manifest.files !== 'object') {
    throw new Error('Initial manifest is missing files metadata');
  }

  const normalizedFiles = {
    html: resolveManifestLinkedPath(manifestPath, manifest.files.html),
    snapshot: resolveManifestLinkedPath(manifestPath, manifest.files.snapshot),
    screenshot: resolveManifestLinkedPath(manifestPath, manifest.files.screenshot),
    manifest: manifestPath,
  };

  for (const [name, filePath] of Object.entries(normalizedFiles)) {
    if (!filePath || !(await fileExists(filePath))) {
      throw new Error(`Initial manifest file is missing: ${name}`);
    }
  }

  return {
    sourceManifestPath: manifestPath,
    manifest: {
      ...manifest,
      files: normalizedFiles,
    },
  };
}

async function captureCurrentState({
  session,
  inputUrl,
  stateId,
  fromState,
  stateName,
  dedupKey,
  trigger,
  stateDir,
  pageMetadata,
  settings,
  siteProfile,
}) {
  const files = buildStateFiles(stateDir);
  const capturedAt = new Date().toISOString();
  let hardFailure = null;
  let warning = null;
  let pageFacts = pageMetadata.pageFacts ?? null;

  await mkdir(stateDir, { recursive: true });

  try {
    const html = await session.captureHtml();
    await writeFile(files.html, html ?? '', 'utf8');
  } catch (error) {
    hardFailure = createError('HTML_CAPTURE_FAILED', error.message);
  }

  if (!hardFailure) {
    try {
      const snapshot = await session.captureSnapshot();
      await writeFile(files.snapshot, JSON.stringify(snapshot, null, 2), 'utf8');
    } catch (error) {
      hardFailure = createError('SNAPSHOT_CAPTURE_FAILED', error.message);
    }
  }

  if (!hardFailure) {
    try {
      const screenshot = await session.captureScreenshot({
        fullPage: settings.fullPage,
        allowViewportFallback: true,
      });
      await writeFile(files.screenshot, Buffer.from(screenshot.data, 'base64'));
      if (screenshot.usedViewportFallback) {
        warning = createError(
          'SCREENSHOT_FALLBACK',
          `Full-page screenshot failed and viewport screenshot was used instead: ${screenshot.primaryError?.message ?? 'unknown error'}`,
        );
      }
    } catch (error) {
      hardFailure = createError('SCREENSHOT_CAPTURE_FAILED', error.message);
    }
  }

  if (!hardFailure && settings.captureChapterArtifacts && pageMetadata.pageType === 'chapter-page') {
    try {
      const chapterArtifacts = await captureChapterArtifacts({
        session,
        stateDir,
        currentUrl: pageMetadata.finalUrl,
        settings,
        siteProfile,
      });
      files.chapterPages = chapterArtifacts.chapterPagesPath;
      files.chapterText = chapterArtifacts.chapterTextPath;
      if (chapterArtifacts.chapterPayload) {
        pageFacts = {
          ...(pageFacts ?? {}),
          bookTitle: chapterArtifacts.chapterPayload.bookTitle ?? pageFacts?.bookTitle ?? null,
          authorName: chapterArtifacts.chapterPayload.authorName ?? pageFacts?.authorName ?? null,
          chapterTitle: chapterArtifacts.chapterPayload.chapterTitle ?? pageFacts?.chapterTitle ?? null,
          chapterHref: chapterArtifacts.chapterPayload.url ?? pageMetadata.finalUrl,
          bodyTextLength: chapterArtifacts.chapterPayload.contentLength ?? pageFacts?.bodyTextLength ?? null,
          bodyExcerpt: chapterArtifacts.chapterPayload.contentText
            ? chapterArtifacts.chapterPayload.contentText.slice(0, 160)
            : pageFacts?.bodyExcerpt ?? null,
          prevChapterUrl: chapterArtifacts.chapterPayload.previousUrl ?? pageFacts?.prevChapterUrl ?? null,
          nextChapterUrl: chapterArtifacts.chapterPayload.nextUrl ?? pageFacts?.nextChapterUrl ?? null,
        };
      }
    } catch (error) {
      warning = warning ?? createError('CHAPTER_ARTIFACTS_FAILED', error.message);
    }
  }

  const manifest = {
    state_id: stateId,
    from_state: fromState,
    state_name: stateName,
    dedup_key: dedupKey,
    trigger,
    inputUrl,
    finalUrl: pageMetadata.finalUrl,
    title: pageMetadata.title,
    capturedAt,
    status: hardFailure ? 'failed' : 'captured',
    outDir: stateDir,
    files,
    page: {
      viewportWidth: pageMetadata.viewportWidth,
      viewportHeight: pageMetadata.viewportHeight,
    },
    pageFacts,
    error: hardFailure ?? warning,
  };

  await writeFile(files.manifest, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

async function copyInitialState(initialManifest, layout, dedupKey) {
  const stateId = 's0000';
  const stateDir = path.join(layout.statesDir, `${stateId}_initial`);
  const files = buildStateFiles(stateDir);

  await mkdir(stateDir, { recursive: true });
  await copyFile(initialManifest.files.html, files.html);
  await copyFile(initialManifest.files.snapshot, files.snapshot);
  await copyFile(initialManifest.files.screenshot, files.screenshot);

  const manifest = {
    state_id: stateId,
    from_state: null,
    state_name: 'Initial State',
    dedup_key: dedupKey,
    trigger: null,
    inputUrl: initialManifest.inputUrl,
    finalUrl: initialManifest.finalUrl,
    title: initialManifest.title,
    capturedAt: initialManifest.capturedAt,
    status: 'initial',
    outDir: stateDir,
    files,
    page: {
      viewportWidth: initialManifest.page?.viewportWidth ?? null,
      viewportHeight: initialManifest.page?.viewportHeight ?? null,
    },
    pageFacts: initialManifest.pageFacts ?? null,
    error: null,
    source_manifest_path: initialManifest.files.manifest,
  };

  await writeFile(files.manifest, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

function topLevelStateEntryFromManifest(manifest) {
  return {
    state_id: manifest.state_id,
    from_state: manifest.from_state,
    state_name: manifest.state_name,
    dedup_key: manifest.dedup_key,
    trigger: manifest.trigger,
    finalUrl: manifest.finalUrl,
    title: manifest.title,
    capturedAt: manifest.capturedAt,
    status: manifest.status,
    duplicate_of: null,
    files: manifest.files,
    pageFacts: manifest.pageFacts ?? null,
    error: manifest.error,
  };
}

function createStateIndexEntry({
  stateId,
  fromState,
  stateName,
  dedupKey,
  trigger,
  finalUrl,
  title,
  capturedAt,
  status,
  duplicateOf = null,
  files = emptyFiles(),
  pageFacts = null,
  error = null,
}) {
  return {
    state_id: stateId,
    from_state: fromState,
    state_name: stateName,
    dedup_key: dedupKey,
    trigger,
    finalUrl,
    title,
    capturedAt,
    status,
    duplicate_of: duplicateOf,
    files,
    pageFacts,
    error,
  };
}

function buildStateName(trigger) {
  const label = trigger?.label || 'Unknown';
  switch (trigger?.kind) {
    case 'details-toggle':
      return `Details Toggle: ${label}`;
    case 'expanded-toggle':
      return `Expanded Toggle: ${label}`;
    case 'tab':
      return `Tab: ${label}`;
    case 'menu-button':
      return `Menu Button: ${label}`;
    case 'dialog-open':
      return `Dialog Open: ${label}`;
    case 'safe-nav-link':
      switch (trigger?.semanticRole) {
        case 'home':
          return `Home Link: ${label}`;
        case 'category':
          return `Category Link: ${label}`;
        case 'author':
          return `Author Link: ${label}`;
        default:
          return `Safe Nav Link: ${label}`;
      }
    case 'content-link':
      return `Content Link: ${label}`;
    case 'auth-link':
      return `Auth Link: ${label}`;
    case 'pagination-link':
      return `Pagination Link: ${label}`;
    case 'form-submit':
      return `Form Submit: ${label}`;
    case 'search-form':
      return `Search: ${label}`;
    case 'chapter-link':
      return `Chapter: ${label}`;
    default:
      return `State: ${label}`;
  }
}

function summarizeForStdout(manifest) {
  return {
    initialStateId: manifest.initialStateId,
    discoveredTriggers: manifest.summary.discoveredTriggers,
    capturedStates: manifest.summary.capturedStates,
    duplicateStates: manifest.summary.duplicateStates,
    noopTriggers: manifest.summary.noopTriggers,
    failedTriggers: manifest.summary.failedTriggers,
    outDir: manifest.outDir,
  };
}

function mergeOptions(options = {}) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...options,
    viewport: {
      ...DEFAULT_OPTIONS.viewport,
      ...(options.viewport ?? {}),
    },
  };

  merged.outDir = path.resolve(merged.outDir);
  if (merged.initialManifestPath) {
    merged.initialManifestPath = path.resolve(merged.initialManifestPath);
  }
  if (merged.initialEvidenceDir) {
    merged.initialEvidenceDir = path.resolve(merged.initialEvidenceDir);
  }
  if (merged.profilePath) {
    merged.profilePath = path.resolve(merged.profilePath);
  }
  if (merged.browserProfileRoot) {
    merged.browserProfileRoot = path.resolve(merged.browserProfileRoot);
  }
  if (merged.userDataDir) {
    merged.userDataDir = path.resolve(merged.userDataDir);
  }
  merged.timeoutMs = normalizeNumber(merged.timeoutMs, 'timeoutMs');
  merged.idleMs = normalizeNumber(merged.idleMs, 'idleMs');
  merged.headless = normalizeBoolean(merged.headless, 'headless');
  merged.fullPage = normalizeBoolean(merged.fullPage, 'fullPage');
  if (merged.reuseLoginState !== undefined) {
    merged.reuseLoginState = normalizeBoolean(merged.reuseLoginState, 'reuseLoginState');
  }
  if (merged.autoLogin !== undefined) {
    merged.autoLogin = normalizeBoolean(merged.autoLogin, 'autoLogin');
  }
  merged.waitUntil = normalizeWaitUntil(merged.waitUntil);
  merged.maxTriggers = Math.max(0, Math.floor(normalizeNumber(merged.maxTriggers, 'maxTriggers')));
  merged.maxCapturedStates = Number.isFinite(Number(merged.maxCapturedStates))
    ? Math.max(0, Math.floor(normalizeNumber(merged.maxCapturedStates, 'maxCapturedStates')))
    : Number.POSITIVE_INFINITY;
  merged.searchQueries = normalizeStringArray(merged.searchQueries);
  merged.viewport = {
    width: normalizeNumber(merged.viewport.width, 'viewport.width'),
    height: normalizeNumber(merged.viewport.height, 'viewport.height'),
    deviceScaleFactor: normalizeNumber(merged.viewport.deviceScaleFactor, 'viewport.deviceScaleFactor'),
  };

  return merged;
}

function pageDiscoverTriggers(maxTriggers, searchQueries = [], siteProfile = null) {
  function isContentDetailPageType(pageType) {
    return pageType === 'book-detail-page' || pageType === 'content-detail-page';
  }

  const profileConfig = {
    pageTypes: siteProfile?.pageTypes ?? {},
    searchFormSelectors: siteProfile?.search?.formSelectors ?? ['form[name="t_frmsearch"]', 'form[action*="/ss/"]', 'form[role="search"]'],
    searchInputSelectors: siteProfile?.search?.inputSelectors ?? ['#searchkey', 'input[name="searchkey"]', 'input[type="search"]'],
    searchSubmitSelectors: siteProfile?.search?.submitSelectors ?? ['#search_btn', 'button[type="submit"]', 'input[type="submit"]'],
    searchQueryParamNames: Array.isArray(siteProfile?.search?.queryParamNames) ? siteProfile.search.queryParamNames : ['searchkey', 'keyword', 'q'],
    knownQueries: Array.isArray(siteProfile?.search?.knownQueries) ? siteProfile.search.knownQueries : [],
    chapterLinkSelectors: siteProfile?.bookDetail?.chapterLinkSelectors ?? ['#list a[href]', '.listmain a[href]', 'dd a[href]', '.book_last a[href]'],
    authorMetaNames: siteProfile?.bookDetail?.authorMetaNames ?? ['og:novel:author'],
    authorLinkMetaNames: siteProfile?.bookDetail?.authorLinkMetaNames ?? ['og:novel:author_link'],
    latestChapterMetaNames: siteProfile?.bookDetail?.latestChapterMetaNames ?? ['og:novel:lastest_chapter_url'],
    detailTitleSelectors: Array.isArray(siteProfile?.contentDetail?.titleSelectors) ? siteProfile.contentDetail.titleSelectors : ['h1', '.book h1', '#bookinfo h1'],
    detailAuthorNameSelectors: Array.isArray(siteProfile?.contentDetail?.authorNameSelectors) ? siteProfile.contentDetail.authorNameSelectors : ['a[href*="/author/"]', '.small span a'],
    detailAuthorLinkSelectors: Array.isArray(siteProfile?.contentDetail?.authorLinkSelectors) ? siteProfile.contentDetail.authorLinkSelectors : ['a[href*="/author/"]'],
    searchResultBookSelectors: Array.isArray(siteProfile?.search?.resultBookSelectors) ? siteProfile.search.resultBookSelectors : [],
    authorWorkLinkSelectors: Array.isArray(siteProfile?.author?.workLinkSelectors) ? siteProfile.author.workLinkSelectors : [],
    contentPathPrefixes: Array.isArray(siteProfile?.navigation?.contentPathPrefixes) ? siteProfile.navigation.contentPathPrefixes : [],
    authorPathPrefixes: Array.isArray(siteProfile?.navigation?.authorPathPrefixes) ? siteProfile.navigation.authorPathPrefixes : [],
    categoryPathPrefixes: Array.isArray(siteProfile?.navigation?.categoryPathPrefixes) ? siteProfile.navigation.categoryPathPrefixes : [],
    utilityPathPrefixes: Array.isArray(siteProfile?.navigation?.utilityPathPrefixes) ? siteProfile.navigation.utilityPathPrefixes : [],
    authPathPrefixes: Array.isArray(siteProfile?.navigation?.authPathPrefixes) ? siteProfile.navigation.authPathPrefixes : [],
    categoryLabelKeywords: Array.isArray(siteProfile?.navigation?.categoryLabelKeywords) ? siteProfile.navigation.categoryLabelKeywords : [],
    allowedHosts: Array.isArray(siteProfile?.navigation?.allowedHosts) ? siteProfile.navigation.allowedHosts : [],
    defaultQueries: Array.isArray(siteProfile?.search?.defaultQueries) ? siteProfile.search.defaultQueries : [],
    searchResultContentLimit: Number.isFinite(Number(siteProfile?.sampling?.searchResultContentLimit))
      ? Math.max(1, Math.floor(Number(siteProfile.sampling.searchResultContentLimit)))
      : 1,
    authorContentLimit: Number.isFinite(Number(siteProfile?.sampling?.authorContentLimit))
      ? Math.max(1, Math.floor(Number(siteProfile.sampling.authorContentLimit)))
      : 4,
    categoryContentLimit: Number.isFinite(Number(siteProfile?.sampling?.categoryContentLimit))
      ? Math.max(1, Math.floor(Number(siteProfile.sampling.categoryContentLimit)))
      : 4,
    fallbackContentLimitWithSearch: Number.isFinite(Number(siteProfile?.sampling?.fallbackContentLimitWithSearch))
      ? Math.max(1, Math.floor(Number(siteProfile.sampling.fallbackContentLimitWithSearch)))
      : MAX_FALLBACK_BOOKS,
  };
  const PRIORITY = {
    'search-form': 0,
    'details-toggle': 0,
    'expanded-toggle': 1,
    tab: 2,
    'menu-button': 3,
    'dialog-open': 3,
    'safe-nav-link': 4,
    'content-link': 5,
    'chapter-link': 5,
    'auth-link': 6,
    'pagination-link': 7,
    'form-submit': 8,
  };
  const SEMANTIC_PRIORITY = {
    home: 0,
    history: 1,
    category: 2,
    utility: 3,
    author: 4,
    unknown: 9,
  };
  const KIND_QUOTA = {
    'search-form': Math.max(searchQueries.length, 1),
    'details-toggle': maxTriggers,
    'expanded-toggle': maxTriggers,
    tab: maxTriggers,
    'menu-button': maxTriggers,
    'dialog-open': maxTriggers,
    'safe-nav-link': 6,
    'content-link': 4,
    'chapter-link': maxTriggers,
    'auth-link': 2,
    'pagination-link': 2,
    'form-submit': 2,
  };
  const RISK_WORDS = ['delete', 'remove', 'logout', 'sign out', 'purchase', 'pay', 'submit'];
  const AUTH_WORDS = ['login', 'log in', 'sign in', 'register', 'sign up', '授权', '登录', '注册'];
  const CATEGORY_WORDS = ['分类', '小说', '栏目', '玄幻', '武侠', '都市', '历史', '科幻', '游戏', '女生', '完本'];
  const HISTORY_WORDS = ['history', '阅读记录', '最近阅读'];

  function classifyJableModelsPathLocal(pathname) {
    const normalized = String(pathname || '/').trim().toLowerCase() || '/';
    if (normalized === '/models' || normalized === '/models/') {
      return 'list';
    }
    if (!normalized.startsWith('/models/')) {
      return null;
    }
    const remainder = normalized.slice('/models/'.length).replace(/^\/+|\/+$/g, '');
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

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalizeUrlLike(value) {
    if (!value) {
      return null;
    }
    try {
      return new URL(value, document.baseURI).toString();
    } catch {
      return String(value);
    }
  }

  function textFromSelectors(selectors) {
    for (const selector of selectors || []) {
      try {
        const node = document.querySelector(selector);
        const text = normalizeText(node?.textContent || node?.innerText || '');
        if (text) {
          return text;
        }
      } catch {
        // Ignore invalid selectors from site profile.
      }
    }
    return null;
  }

  function hrefFromSelectors(selectors) {
    for (const selector of selectors || []) {
      try {
        const node = document.querySelector(selector);
        const href = node?.getAttribute?.('href');
        if (href) {
          return normalizeUrlLike(href);
        }
      } catch {
        // Ignore invalid selectors from site profile.
      }
    }
    return null;
  }

  function pathnameMatchesExact(pathname, values) {
    const normalizedPath = String(pathname || '/').toLowerCase();
    return (values || []).some((value) => String(value || '').toLowerCase() === normalizedPath);
  }

  function pathnameMatchesPrefix(pathname, values) {
    const normalizedPath = String(pathname || '/').toLowerCase();
    return (values || []).some((value) => {
      const normalizedValue = String(value || '').toLowerCase();
      return normalizedValue && (normalizedPath === normalizedValue || normalizedPath.startsWith(normalizedValue));
    });
  }

  function currentPathname() {
    try {
      const parsed = new URL(location.href, document.baseURI);
      return parsed.pathname || '/';
    } catch {
      return location.pathname || '/';
    }
  }

  function inferProfilePageType(pathname) {
    const normalizedLocationHost = String(location.hostname || '').trim().toLowerCase();
    const isBilibiliProfile = ['www.bilibili.com', 'search.bilibili.com', 'space.bilibili.com'].includes(String(siteProfile?.host ?? '').toLowerCase());
    if (String(siteProfile?.host ?? '').toLowerCase() === 'jable.tv') {
      const modelsPathKind = classifyJableModelsPathLocal(pathname);
      if (modelsPathKind === 'list') {
        return 'author-list-page';
      }
      if (modelsPathKind === 'detail') {
        return 'author-page';
      }
    }
    if (pathnameMatchesExact(pathname, profileConfig.pageTypes.homeExact) || pathnameMatchesPrefix(pathname, profileConfig.pageTypes.homePrefixes)) {
      return 'home';
    }
    if (
      (!isBilibiliProfile || normalizedLocationHost === 'search.bilibili.com')
      && pathnameMatchesPrefix(pathname, profileConfig.pageTypes.searchResultsPrefixes)
    ) {
      return 'search-results-page';
    }
    if (pathnameMatchesPrefix(pathname, profileConfig.pageTypes.contentDetailPrefixes)) {
      return 'book-detail-page';
    }
    if (
      isBilibiliProfile
      && normalizedLocationHost === 'space.bilibili.com'
      && /^\/\d+\/(?:(?:upload\/)?video|dynamic|fans\/follow|fans\/fans)(?:\/|$)?/i.test(pathname)
    ) {
      return 'author-list-page';
    }
    if (pathnameMatchesPrefix(pathname, profileConfig.pageTypes.authorPrefixes)) {
      return 'author-page';
    }
    if (pathnameMatchesPrefix(pathname, profileConfig.pageTypes.chapterPrefixes)) {
      return 'chapter-page';
    }
    if (pathnameMatchesPrefix(pathname, profileConfig.pageTypes.historyPrefixes)) {
      return 'history-page';
    }
    if (pathnameMatchesPrefix(pathname, profileConfig.pageTypes.authPrefixes)) {
      return 'auth-page';
    }
    if (pathnameMatchesPrefix(pathname, profileConfig.pageTypes.categoryPrefixes)) {
      return 'category-page';
    }
    return null;
  }

  function currentPageType() {
    const pathname = currentPathname();
    const hostname = String(location.hostname || '').trim().toLowerCase();
    const profilePageType = inferProfilePageType(pathname);
    if (profilePageType) {
      return profilePageType;
    }
    if (hostname === 'search.bilibili.com' && /^\/(?:all|video|bangumi|upuser)(?:\/|$)/i.test(pathname)) {
      return 'search-results-page';
    }
  if (hostname === 'space.bilibili.com' && /^\/\d+\/(?:(?:upload\/)?video|dynamic|fans\/follow|fans\/fans)(?:\/|$)?/i.test(pathname)) {
    return 'author-list-page';
  }
    if (hostname === 'space.bilibili.com' && /^\/\d+(?:\/|$)?/i.test(pathname)) {
      return 'author-page';
    }
    if (pathname === '/' || pathname === '') {
      return 'home';
    }
    if (/\/ss(?:\/|$)/i.test(pathname)) {
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
  }

  function getLabel(element) {
    const ariaLabel = normalizeText(element.getAttribute('aria-label'));
    if (ariaLabel) {
      return ariaLabel;
    }

    const labelledBy = normalizeText(element.getAttribute('aria-labelledby'));
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => normalizeText(node.textContent || node.innerText || ''))
        .filter(Boolean);
      if (parts.length > 0) {
        return normalizeText(parts.join(' '));
      }
    }

    const title = normalizeText(element.getAttribute('title'));
    if (title) {
      return title;
    }

    const alt = normalizeText(element.getAttribute('alt'));
    if (alt) {
      return alt;
    }

    const text = normalizeText(element.innerText || element.textContent || '');
    if (text) {
      return text.slice(0, 80);
    }

    return normalizeText(element.id || element.getAttribute('name') || element.tagName.toLowerCase());
  }

  function getRole(element) {
    const explicit = normalizeText(element.getAttribute('role'));
    if (explicit) {
      return explicit.toLowerCase();
    }
    const tag = element.tagName.toLowerCase();
    if (tag === 'button') {
      return 'button';
    }
    if (tag === 'summary') {
      return 'button';
    }
    if (tag === 'a' && element.hasAttribute('href')) {
      return 'link';
    }
    return '';
  }

  function isHidden(element) {
    if (!element || !element.isConnected) {
      return true;
    }
    if (element.hidden || element.closest('[hidden], [inert]')) {
      return true;
    }
    if (element.getAttribute('aria-hidden') === 'true') {
      return true;
    }
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      return true;
    }
    const rect = element.getBoundingClientRect();
    return rect.width <= 0 || rect.height <= 0;
  }

  function isInteractable(element) {
    if (isHidden(element)) {
      return false;
    }
    if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.pointerEvents === 'none') {
      return false;
    }
    return true;
  }

  function isNavigationalAnchor(element) {
    if (element.tagName.toLowerCase() !== 'a') {
      return false;
    }
    const href = normalizeText(element.getAttribute('href'));
    if (!href) {
      return false;
    }
    if (href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) {
      return false;
    }
    if (getRole(element) === 'tab') {
      return false;
    }
    return true;
  }

  function hrefPathInfo(element) {
    const href = normalizeText(element.getAttribute('href'));
    if (!href) {
      return {
        href: null,
        normalizedHref: null,
        pathname: '',
      };
    }

    try {
      const parsed = new URL(href, document.baseURI);
      return {
        href,
        normalizedHref: parsed.toString(),
        pathname: parsed.pathname || '/',
        hostname: parsed.hostname || '',
      };
    } catch {
      return {
        href,
        normalizedHref: href,
        pathname: href,
        hostname: '',
      };
    }
  }

  function isAllowedHost(hostname) {
    const normalizedHost = String(hostname || '').toLowerCase();
    if (!normalizedHost) {
      return false;
    }
    const currentHost = String(location.hostname || '').toLowerCase();
    if (normalizedHost === currentHost) {
      return true;
    }
    if (normalizedHost === currentHost.replace(/^www\./, '') || `www.${normalizedHost}` === currentHost) {
      return true;
    }
    return profileConfig.allowedHosts.some((value) => String(value || '').toLowerCase() === normalizedHost);
  }

  function isFormSubmit(element) {
    const tag = element.tagName.toLowerCase();
    if (tag === 'button') {
      const type = normalizeText(element.getAttribute('type')).toLowerCase();
      return type === 'submit';
    }
    if (tag === 'input') {
      const type = normalizeText(element.getAttribute('type')).toLowerCase();
      return type === 'submit' || type === 'image';
    }
    return false;
  }

  function isFileUpload(element) {
    if (element.tagName.toLowerCase() === 'input') {
      return normalizeText(element.getAttribute('type')).toLowerCase() === 'file';
    }
    return false;
  }

  function isDownloadLike(element) {
    return element.tagName.toLowerCase() === 'a' && element.hasAttribute('download');
  }

  function isMediaControl(element) {
    return Boolean(element.closest('audio, video'));
  }

  function hasRiskText(label) {
    const lower = label.toLowerCase();
    return RISK_WORDS.some((word) => lower.includes(word));
  }

  function isAuthCandidate(label, hrefInfo) {
    const lowerLabel = label.toLowerCase();
    const lowerHref = String(hrefInfo.pathname || hrefInfo.normalizedHref || '').toLowerCase();
    if (pathnameMatchesPrefix(lowerHref, profileConfig.authPathPrefixes)) {
      return true;
    }
    return AUTH_WORDS.some((word) => lowerLabel.includes(word) || lowerHref.includes(word));
  }

  function isPaginationCandidate(label, hrefInfo, element) {
    const lowerLabel = label.toLowerCase();
    const lowerHref = String(hrefInfo.pathname || hrefInfo.normalizedHref || '').toLowerCase();
    if (element.getAttribute('rel') === 'next' || element.getAttribute('rel') === 'prev') {
      return true;
    }
    if (/^(?:\d+|next|prev|previous|上一页|下一页|上一章|下一章)$/i.test(lowerLabel)) {
      return true;
    }
    return /page|p=|_2\.html|_3\.html|下一页|上一页/i.test(lowerHref);
  }

  function semanticRoleForSafeNav(label, hrefInfo) {
    const lowerLabel = label.toLowerCase();
    const lowerHref = String(hrefInfo.pathname || hrefInfo.normalizedHref || '').toLowerCase();
    const lowerHostname = String(hrefInfo.hostname || '').toLowerCase();

    if (isJableSite) {
      const modelsPathKind = classifyJableModelsPathLocal(lowerHref);
      if (modelsPathKind === 'list') {
        return 'category';
      }
      if (modelsPathKind === 'detail') {
        return 'author';
      }
    }

    if (
      lowerHostname === 'space.bilibili.com'
      && (
        String(siteProfile?.host ?? '').toLowerCase() === 'www.bilibili.com'
        || String(siteProfile?.host ?? '').toLowerCase() === 'space.bilibili.com'
        || String(siteProfile?.host ?? '').toLowerCase() === 'search.bilibili.com'
      )
    ) {
      return 'author';
    }

    if (
      lowerHref === '/'
      || lowerHref === ''
      || lowerLabel === '首页'
      || pathnameMatchesExact(lowerHref, profileConfig.pageTypes.homeExact)
      || pathnameMatchesPrefix(lowerHref, profileConfig.pageTypes.homePrefixes)
    ) {
      return 'home';
    }
    if (HISTORY_WORDS.some((word) => lowerLabel.includes(word) || lowerHref.includes(word))) {
      return 'history';
    }
    if (pathnameMatchesPrefix(lowerHref, profileConfig.authorPathPrefixes) || lowerHref.includes('/author/')) {
      return 'author';
    }
    if (
      pathnameMatchesPrefix(lowerHref, profileConfig.categoryPathPrefixes)
      || lowerHref.includes('/fenlei/')
      || CATEGORY_WORDS.some((word) => lowerLabel.includes(word))
      || profileConfig.categoryLabelKeywords.some((word) => lowerLabel.includes(String(word).toLowerCase()))
    ) {
      return 'category';
    }
    if (pathnameMatchesPrefix(lowerHref, profileConfig.utilityPathPrefixes)) {
      return 'utility';
    }
    return 'utility';
  }

  function isContentCandidate(label, hrefInfo) {
    const lowerHref = String(hrefInfo.pathname || hrefInfo.normalizedHref || '').toLowerCase();
    if (pathnameMatchesPrefix(lowerHref, profileConfig.contentPathPrefixes)) {
      return true;
    }
    if (/\/biqu\d+\/?$/i.test(lowerHref)) {
      return true;
    }
    return /book|novel|article|detail/i.test(lowerHref) && label.length >= 2;
  }

  function isChapterCandidate(hrefInfo) {
    const lowerHref = String(hrefInfo.pathname || hrefInfo.normalizedHref || '').toLowerCase();
    return /\/biqu\d+\/\d+\.html$/i.test(lowerHref);
  }

  function metaContentByNames(names) {
    for (const name of names) {
      const selector = `meta[property="${name}"], meta[name="${name}"]`;
      const meta = document.querySelector(selector);
      const content = normalizeText(meta?.getAttribute('content') || '');
      if (content) {
        return content;
      }
    }
    return null;
  }

  function buildDomPath(element) {
    const segments = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body && segments.length < 8) {
      const tagName = current.tagName.toLowerCase();
      let index = 1;
      let sibling = current;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName.toLowerCase() === tagName) {
          index += 1;
        }
      }
      segments.unshift(`${tagName}:nth-of-type(${index})`);
      current = current.parentElement;
    }
    return segments.join(' > ');
  }

  function buildLocator(element, label, role) {
    const ariaControls = normalizeText(element.getAttribute('aria-controls'));
    const hrefInfo = hrefPathInfo(element);
    return {
      primary: element.id ? 'id' : ariaControls ? 'aria-controls' : role && label ? 'role-label' : 'dom-path',
      id: element.id || null,
      ariaControls: ariaControls || null,
      role: role || null,
      label,
      tagName: element.tagName.toLowerCase(),
      href: hrefInfo.normalizedHref || null,
      textSnippet: normalizeText(element.innerText || element.textContent || '').slice(0, 80) || null,
      domPath: buildDomPath(element),
    };
  }

  function labelQuality(label, locator) {
    const normalizedLabel = normalizeText(label).toLowerCase();
    const textSnippet = normalizeText(locator?.textSnippet || '');
    let score = 0;
    if (normalizedLabel && !['a', 'link', 'button'].includes(normalizedLabel)) {
      score += Math.min(normalizedLabel.length, 24);
    }
    if (textSnippet && textSnippet !== normalizedLabel) {
      score += Math.min(textSnippet.length, 16);
    }
    if (locator?.href) {
      score += 4;
    }
    if (normalizedLabel === 'a') {
      score -= 12;
    }
    return score;
  }

  function getControlledIds(value) {
    return normalizeText(value).split(/\s+/).filter(Boolean);
  }

  function targetIsHidden(controlledTarget) {
    const ids = getControlledIds(controlledTarget);
    if (ids.length === 0) {
      return false;
    }
    return ids.some((id) => {
      const target = document.getElementById(id);
      return !target || isHidden(target);
    });
  }

  function findSearchForm() {
    const form = profileConfig.searchFormSelectors
      .map((selector) => {
        try {
          return document.querySelector(selector);
        } catch {
          return null;
        }
      })
      .find(Boolean);
    const input = profileConfig.searchInputSelectors
      .map((selector) => {
        try {
          return document.querySelector(selector);
        } catch {
          return null;
        }
      })
      .find(Boolean);
    const resolvedForm = form instanceof HTMLFormElement ? form : input?.form ?? null;
    const submit = profileConfig.searchSubmitSelectors
      .map((selector) => {
        try {
          return (resolvedForm || document).querySelector(selector);
        } catch {
          return null;
        }
      })
      .find(Boolean);
    if (!resolvedForm && !input) {
      return null;
    }
    return {
      form: resolvedForm,
      input: input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input : null,
      submit: submit instanceof Element ? submit : null,
    };
  }

  const candidates = [];
  const seen = new Map();

  function buildRecord(kind, label, locator, controlledTarget, extra = {}) {
    const isKnownQueryContent = kind === 'content-link' && locator?.primary === 'known-query';
    return {
      kind,
      label,
      locator,
      controlledTarget: controlledTarget || locator.ariaControls || null,
      href: locator.href ?? null,
      queryText: extra.queryText ?? null,
      semanticRole: extra.semanticRole || 'unknown',
      ordinal: candidates.length + 1,
      _priority: isKnownQueryContent ? -1 : (PRIORITY[kind] ?? 99),
      _semanticPriority: isKnownQueryContent ? -1 : (SEMANTIC_PRIORITY[extra.semanticRole || 'unknown'] ?? 99),
      _labelQuality: labelQuality(label, locator),
    };
  }

  function upsertCandidate(record) {
    const dedupe = JSON.stringify([
      record.kind,
      record.locator?.id || null,
      record.locator?.ariaControls || null,
      record.href || null,
      record.queryText || null,
      !record.kind.endsWith('link') ? record.label : null,
      !record.kind.endsWith('link') ? record.locator?.domPath : null,
    ]);
    const existingIndex = seen.get(dedupe);
    if (existingIndex !== undefined) {
      const existing = candidates[existingIndex];
      if ((existing?._labelQuality ?? 0) >= record._labelQuality) {
        return;
      }
      candidates[existingIndex] = record;
      return;
    }
    seen.set(dedupe, candidates.length);
    candidates.push(record);
  }

  function addCandidate(element, kind, controlledTarget, extra = {}) {
    if (!(element instanceof Element)) {
      return;
    }
    if (!isInteractable(element)) {
      return;
    }

    const label = getLabel(element);
    if (!label || hasRiskText(label)) {
      return;
    }
    const navigationalAnchor = isNavigationalAnchor(element);
    const formSubmit = isFormSubmit(element);
    if ((!extra.allowNavigation && navigationalAnchor) || (!extra.allowSubmit && formSubmit) || isFileUpload(element) || isDownloadLike(element) || isMediaControl(element)) {
      return;
    }

    const role = getRole(element);
    upsertCandidate(buildRecord(kind, label, buildLocator(element, label, role), controlledTarget, extra));
  }

  function addSyntheticCandidate(kind, label, href, extra = {}) {
    if (!label && !href) {
      return;
    }
    const locator = {
      primary: extra.primary || 'href-direct',
      id: extra.id ?? null,
      ariaControls: extra.ariaControls ?? null,
      role: extra.role ?? null,
      label: label || extra.label || null,
      tagName: extra.tagName ?? 'a',
      href: href ? normalizeUrlLike(href) : null,
      textSnippet: extra.textSnippet ?? null,
      domPath: extra.domPath ?? null,
      inputName: extra.inputName ?? null,
      formAction: extra.formAction ? normalizeUrlLike(extra.formAction) : null,
      submitSelector: extra.submitSelector ?? null,
    };
    upsertCandidate(buildRecord(kind, label || href || kind, locator, extra.controlledTarget ?? null, extra));
  }

  const pageType = currentPageType();
  const isJableSite = String(siteProfile?.host ?? '').toLowerCase() === 'jable.tv';
  const isBilibiliSite = ['www.bilibili.com', 'search.bilibili.com', 'space.bilibili.com'].includes(String(siteProfile?.host ?? '').toLowerCase());

  function shouldKeepCandidateForCurrentPage(candidate) {
    if (!isJableSite) {
      return true;
    }

    if (candidate.kind === 'search-form') {
      return true;
    }

    if (isContentDetailPageType(pageType)) {
      if (candidate.kind === 'safe-nav-link' && candidate.semanticRole === 'author') {
        return true;
      }
      if (candidate.kind === 'content-link' && candidate.semanticRole === 'content') {
        return false;
      }
      if (candidate.kind === 'safe-nav-link' && candidate.semanticRole === 'category') {
        return false;
      }
    }

    if (pageType === 'author-page') {
      return candidate.kind === 'content-link' || candidate.kind === 'pagination-link';
    }

    if (pageType === 'author-list-page') {
      if (candidate.kind === 'safe-nav-link') {
        return candidate.semanticRole === 'author' || candidate.semanticRole === 'category';
      }
      return candidate.kind === 'pagination-link';
    }

    if (pageType === 'search-results-page' || pageType === 'category-page' || pageType === 'home') {
      if (candidate.kind === 'content-link' || candidate.kind === 'pagination-link') {
        return true;
      }
      if (candidate.kind === 'safe-nav-link') {
        return candidate.semanticRole === 'category' || candidate.semanticRole === 'utility' || candidate.semanticRole === 'home';
      }
      return false;
    }

    return true;
  }

  function quotaForCandidate(candidate) {
    if (!isJableSite) {
      return KIND_QUOTA[candidate.kind] ?? maxTriggers;
    }

    if (isContentDetailPageType(pageType)) {
      if (candidate.kind === 'safe-nav-link' && candidate.semanticRole === 'author') {
        return 2;
      }
      if (candidate.kind === 'chapter-link') {
        return 0;
      }
      return 0;
    }

    if (pageType === 'author-page') {
      if (candidate.kind === 'content-link') {
        return 4;
      }
      if (candidate.kind === 'pagination-link') {
        return 1;
      }
      return 0;
    }

    if (pageType === 'author-list-page') {
      if (candidate.kind === 'safe-nav-link' && candidate.semanticRole === 'author') {
        return 4;
      }
      if (candidate.kind === 'safe-nav-link' && candidate.semanticRole === 'category') {
        return 1;
      }
      if (candidate.kind === 'pagination-link') {
        return 1;
      }
      return 0;
    }

    if (pageType === 'search-results-page' || pageType === 'category-page' || pageType === 'home') {
      if (candidate.kind === 'content-link') {
        return 4;
      }
      if (candidate.kind === 'pagination-link') {
        return 1;
      }
      if (candidate.kind === 'safe-nav-link') {
        return 2;
      }
      return KIND_QUOTA[candidate.kind] ?? maxTriggers;
    }

    return KIND_QUOTA[candidate.kind] ?? maxTriggers;
  }

  if (searchQueries.length > 0) {
    const searchForm = findSearchForm();
    if (searchForm?.input || searchForm?.form) {
      const baseLabel = getLabel(searchForm.submit || searchForm.input || searchForm.form) || 'Search';
      for (const queryText of searchQueries) {
        addSyntheticCandidate('search-form', `${baseLabel}: ${queryText}`, searchForm.form?.action || location.href, {
          semanticRole: 'search',
          queryText,
          primary: 'search-form',
          id: searchForm.input?.id || searchForm.form?.id || null,
          inputName: searchForm.input?.getAttribute('name') || 'searchkey',
          formAction: searchForm.form?.action || location.href,
          submitSelector: searchForm.submit?.id ? `#${searchForm.submit.id}` : null,
          domPath: buildDomPath(searchForm.input || searchForm.form),
          tagName: 'form',
        });
      }
    }

    for (const queryText of searchQueries) {
      const normalizedQuery = normalizeText(queryText).toLowerCase();
      const knownMatches = profileConfig.knownQueries.filter((entry) => normalizeText(entry?.query).toLowerCase() === normalizedQuery);
      for (const entry of knownMatches) {
        if (!entry?.url) {
          continue;
        }
        addSyntheticCandidate('content-link', entry.title || entry.query || queryText, entry.url, {
          semanticRole: 'content',
          queryText,
          primary: 'known-query',
          textSnippet: entry.title || entry.query || queryText,
        });
      }
    }
  }

  for (const summary of document.querySelectorAll('details:not([open]) > summary')) {
    addCandidate(summary, 'details-toggle', summary.parentElement?.id || null);
  }

  for (const element of document.querySelectorAll('[aria-expanded="false"]')) {
    const tag = element.tagName.toLowerCase();
    const role = getRole(element);
    if (element.hasAttribute('aria-haspopup')) {
      continue;
    }
    if (tag === 'button' || tag === 'a' || role === 'button') {
      addCandidate(element, 'expanded-toggle', element.getAttribute('aria-controls'));
    }
  }

  for (const tab of document.querySelectorAll('[role="tab"][aria-selected="false"]')) {
    addCandidate(tab, 'tab', tab.getAttribute('aria-controls'));
  }

  for (const element of document.querySelectorAll('[aria-haspopup]')) {
    const popup = normalizeText(element.getAttribute('aria-haspopup')).toLowerCase();
    if (popup === 'dialog') {
      addCandidate(element, 'dialog-open', element.getAttribute('aria-controls'));
    } else if (popup === 'menu' || popup === 'listbox') {
      addCandidate(element, 'menu-button', element.getAttribute('aria-controls'));
    }
  }

  for (const element of document.querySelectorAll('[aria-controls]')) {
    if (element.getAttribute('aria-expanded') === 'false') {
      continue;
    }
    if (element.hasAttribute('aria-haspopup')) {
      continue;
    }
    if (getRole(element) === 'tab') {
      continue;
    }
    const controlledTarget = normalizeText(element.getAttribute('aria-controls'));
    if (!controlledTarget) {
      continue;
    }
    if (targetIsHidden(controlledTarget)) {
      addCandidate(element, 'expanded-toggle', controlledTarget);
    }
  }

  for (const element of document.querySelectorAll('a[href]')) {
    if (!isInteractable(element)) {
      continue;
    }
    const label = getLabel(element);
    if (!label || hasRiskText(label)) {
      continue;
    }
    const hrefInfo = hrefPathInfo(element);
    if (!hrefInfo.normalizedHref) {
      continue;
    }
    if (!isAllowedHost(hrefInfo.hostname)) {
      continue;
    }
    if (isAuthCandidate(label, hrefInfo)) {
      addCandidate(element, 'auth-link', null, { allowNavigation: true, semanticRole: 'auth' });
      continue;
    }
    if (isPaginationCandidate(label, hrefInfo, element)) {
      addCandidate(element, 'pagination-link', null, { allowNavigation: true, semanticRole: 'pagination' });
      continue;
    }
    if (isContentDetailPageType(pageType) && isChapterCandidate(hrefInfo)) {
      addCandidate(element, 'chapter-link', null, { allowNavigation: true, semanticRole: 'chapter' });
      continue;
    }
    if (isContentCandidate(label, hrefInfo)) {
      addCandidate(element, 'content-link', null, { allowNavigation: true, semanticRole: 'content' });
      continue;
    }
    addCandidate(element, 'safe-nav-link', null, {
      allowNavigation: true,
      semanticRole: semanticRoleForSafeNav(label, hrefInfo),
    });
  }

  const isBilibiliProfile = ['www.bilibili.com', 'search.bilibili.com', 'space.bilibili.com'].includes(String(siteProfile?.host ?? '').toLowerCase());
  if (isBilibiliProfile && ['search-results-page', 'author-page', 'author-list-page', 'category-page'].includes(pageType)) {
    const selectorGroups = [];
    if (pageType === 'search-results-page') {
      selectorGroups.push(...profileConfig.searchResultBookSelectors);
    }
    if (pageType === 'author-page' || pageType === 'author-list-page' || pageType === 'category-page') {
      selectorGroups.push(...profileConfig.authorWorkLinkSelectors);
    }

    const seenAnchors = new Set();
    for (const selector of selectorGroups) {
      try {
        for (const anchor of document.querySelectorAll(selector)) {
          if (!(anchor instanceof HTMLAnchorElement)) {
            continue;
          }
          const hrefInfo = hrefPathInfo(anchor);
          if (!hrefInfo.normalizedHref || !isAllowedHost(hrefInfo.hostname) || !isContentCandidate(getLabel(anchor), hrefInfo)) {
            continue;
          }
          const dedupeKey = `${hrefInfo.normalizedHref}::${buildDomPath(anchor)}`;
          if (seenAnchors.has(dedupeKey)) {
            continue;
          }
          seenAnchors.add(dedupeKey);
          const label = getLabel(anchor) || hrefInfo.normalizedHref;
          addSyntheticCandidate('content-link', label, hrefInfo.normalizedHref, {
            semanticRole: 'content',
            primary: 'href-direct',
            id: anchor.id || null,
            domPath: buildDomPath(anchor),
            textSnippet: label,
          });
        }
      } catch {
        // Ignore selector issues from site profile and fall back to generic link discovery.
      }
    }
  }

  for (const element of document.querySelectorAll('button[type="submit"], input[type="submit"], input[type="image"]')) {
    addCandidate(element, 'form-submit', null, { allowSubmit: true, semanticRole: 'submit' });
  }

  if (isContentDetailPageType(pageType)) {
    const authorName = metaContentByNames(profileConfig.authorMetaNames)
      || textFromSelectors(profileConfig.detailAuthorNameSelectors);
    const authorHref = metaContentByNames(profileConfig.authorLinkMetaNames)
      || hrefFromSelectors(profileConfig.detailAuthorLinkSelectors);
    if (authorHref) {
      addSyntheticCandidate('safe-nav-link', authorName || 'Author Page', authorHref, {
        semanticRole: 'author',
        primary: 'href-direct',
        textSnippet: authorName || 'Author Page',
      });
    }

    const chapterAnchors = [];
    for (const selector of profileConfig.chapterLinkSelectors) {
      try {
        chapterAnchors.push(...document.querySelectorAll(selector));
      } catch {
        // Ignore invalid selectors in profile.
      }
    }
    for (const anchor of chapterAnchors) {
      if (!(anchor instanceof HTMLAnchorElement) || !isInteractable(anchor)) {
        continue;
      }
      const hrefInfo = hrefPathInfo(anchor);
      if (!isChapterCandidate(hrefInfo)) {
        continue;
      }
      const label = getLabel(anchor);
      addSyntheticCandidate('chapter-link', label || hrefInfo.normalizedHref, hrefInfo.normalizedHref, {
        semanticRole: 'chapter',
        primary: 'href-direct',
        id: anchor.id || null,
        domPath: buildDomPath(anchor),
        textSnippet: label,
      });
    }

    const latestChapterHref = metaContentByNames(profileConfig.latestChapterMetaNames);
    if (latestChapterHref && /\/biqu\d+\/\d+\.html$/i.test(String(latestChapterHref))) {
      addSyntheticCandidate('chapter-link', 'Latest Chapter', latestChapterHref, {
        semanticRole: 'chapter',
        primary: 'href-direct',
        textSnippet: 'Latest Chapter',
      });
    }
  }

  const filteredCandidates = candidates.filter((candidate) => shouldKeepCandidateForCurrentPage(candidate));

  filteredCandidates.sort((left, right) => {
    if (left._priority !== right._priority) {
      return left._priority - right._priority;
    }
    if (left._semanticPriority !== right._semanticPriority) {
      return left._semanticPriority - right._semanticPriority;
    }
    if (left._labelQuality !== right._labelQuality) {
      return right._labelQuality - left._labelQuality;
    }
    return left.ordinal - right.ordinal;
  });

  const selected = [];
  const selectedCounts = new Map();
  for (const candidate of filteredCandidates) {
    if (selected.length >= maxTriggers) {
      break;
    }
    const quota = quotaForCandidate(candidate);
    if (quota <= 0) {
      continue;
    }
    const count = selectedCounts.get(candidate.kind) ?? 0;
    if (count >= quota) {
      continue;
    }
    selected.push(candidate);
    selectedCounts.set(candidate.kind, count + 1);
  }

  if (selected.length < maxTriggers) {
    const selectedKeys = new Set(selected.map((candidate) => JSON.stringify([candidate.kind, candidate.label, candidate.locator.domPath, candidate.href, candidate.queryText])));
    for (const candidate of filteredCandidates) {
      if (selected.length >= maxTriggers) {
        break;
      }
      const quota = quotaForCandidate(candidate);
      if (quota <= 0) {
        continue;
      }
      const key = JSON.stringify([candidate.kind, candidate.label, candidate.locator.domPath, candidate.href, candidate.queryText]);
      if (selectedKeys.has(key)) {
        continue;
      }
      selected.push(candidate);
      selectedKeys.add(key);
    }
  }

  return selected.slice(0, maxTriggers).map(({ _priority, _semanticPriority, _labelQuality, ...candidate }) => candidate);
}

function pageExecuteTrigger(trigger, siteProfile = null) {
  const locator = trigger?.locator ?? {};
  const profileConfig = {
    searchFormSelectors: siteProfile?.search?.formSelectors ?? ['form[name="t_frmsearch"]', 'form[action*="/ss/"]', 'form[role="search"]'],
    searchInputSelectors: siteProfile?.search?.inputSelectors ?? ['#searchkey', 'input[name="searchkey"]', 'input[type="search"]'],
    searchSubmitSelectors: siteProfile?.search?.submitSelectors ?? ['#search_btn', 'button[type="submit"]', 'input[type="submit"]'],
    searchQueryParamNames: Array.isArray(siteProfile?.search?.queryParamNames) ? siteProfile.search.queryParamNames : ['searchkey', 'keyword', 'q'],
    profileHost: String(siteProfile?.host ?? '').toLowerCase(),
  };

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalizeUrlLike(value) {
    if (!value) {
      return null;
    }
    try {
      return new URL(value, document.baseURI).toString();
    } catch {
      return String(value);
    }
  }

  function getLabel(element) {
    const ariaLabel = normalizeText(element.getAttribute('aria-label'));
    if (ariaLabel) {
      return ariaLabel;
    }
    const text = normalizeText(element.innerText || element.textContent || '');
    if (text) {
      return text.slice(0, 80);
    }
    return normalizeText(element.id || element.getAttribute('name') || element.tagName.toLowerCase());
  }

  function getRole(element) {
    const explicit = normalizeText(element.getAttribute('role'));
    if (explicit) {
      return explicit.toLowerCase();
    }
    const tag = element.tagName.toLowerCase();
    if (tag === 'button' || tag === 'summary') {
      return 'button';
    }
    if (tag === 'a' && element.hasAttribute('href')) {
      return 'link';
    }
    return '';
  }

  function buildDomPath(element) {
    const segments = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body && segments.length < 8) {
      const tagName = current.tagName.toLowerCase();
      let index = 1;
      let sibling = current;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName.toLowerCase() === tagName) {
          index += 1;
        }
      }
      segments.unshift(`${tagName}:nth-of-type(${index})`);
      current = current.parentElement;
    }
    return segments.join(' > ');
  }

  function isClickable(element) {
    if (!element || !element.isConnected) {
      return false;
    }
    if (element.hidden || element.closest('[hidden], [inert]')) {
      return false;
    }
    if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.pointerEvents === 'none') {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findByDomPath(domPath) {
    if (!domPath) {
      return null;
    }
    try {
      return document.querySelector(domPath);
    } catch {
      return null;
    }
  }

  function scoreCandidate(element, inputLocator) {
    let score = 0;
    if (inputLocator.id && element.id === inputLocator.id) {
      score += 1_000;
    }
    if (inputLocator.ariaControls && normalizeText(element.getAttribute('aria-controls')) === inputLocator.ariaControls) {
      score += 400;
    }
    if (inputLocator.href && normalizeUrlLike(element.getAttribute('href')) === inputLocator.href) {
      score += 500;
    }
    if (inputLocator.role && getRole(element) === inputLocator.role) {
      score += 120;
    }
    if (inputLocator.tagName && element.tagName.toLowerCase() === inputLocator.tagName) {
      score += 60;
    }
    if (inputLocator.label && getLabel(element) === inputLocator.label) {
      score += 220;
    }
    if (inputLocator.textSnippet) {
      const text = normalizeText(element.innerText || element.textContent || '');
      if (text.includes(inputLocator.textSnippet)) {
        score += 80;
      }
    }
    if (inputLocator.domPath && buildDomPath(element) === inputLocator.domPath) {
      score += 40;
    }
    return score;
  }

  function findBestElement(inputLocator) {
    if (inputLocator.id) {
      const exact = document.getElementById(inputLocator.id);
      if (isClickable(exact)) {
        return exact;
      }
    }

    if (inputLocator.href) {
      const byHref = Array.from(document.querySelectorAll('a[href]')).find((candidate) => isClickable(candidate) && normalizeUrlLike(candidate.getAttribute('href')) === inputLocator.href);
      if (isClickable(byHref)) {
        return byHref;
      }
    }

    const domPathMatch = findByDomPath(inputLocator.domPath);
    if (isClickable(domPathMatch)) {
      return domPathMatch;
    }

    const selector = [
      'summary',
      'button',
      'a',
      '[role="button"]',
      '[role="tab"]',
      'form button[type="submit"]',
      'form input[type="submit"]',
      'input[type="image"]',
      '[aria-haspopup]',
      '[aria-controls]',
      '[aria-expanded]',
    ].join(', ');

    let best = null;
    let bestScore = -1;
    for (const candidate of document.querySelectorAll(selector)) {
      if (!isClickable(candidate)) {
        continue;
      }
      const score = scoreCandidate(candidate, inputLocator);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return bestScore > 0 ? best : null;
  }

  function findSearchFormElements() {
    const form = profileConfig.searchFormSelectors
      .map((selector) => {
        try {
          return document.querySelector(selector);
        } catch {
          return null;
        }
      })
      .find(Boolean);
    const input = profileConfig.searchInputSelectors
      .map((selector) => {
        try {
          return document.querySelector(selector);
        } catch {
          return null;
        }
      })
      .find(Boolean);
    const resolvedForm = form instanceof HTMLFormElement ? form : input?.form ?? null;
    const submit = profileConfig.searchSubmitSelectors
      .map((selector) => {
        try {
          return (resolvedForm || document).querySelector(selector);
        } catch {
          return null;
        }
      })
      .find(Boolean);
    return {
      form: resolvedForm,
      input: input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input : null,
      submit: submit instanceof Element ? submit : null,
    };
  }

  function buildSearchNavigationUrl(queryText, search) {
    const form = search.form instanceof HTMLFormElement ? search.form : search.input?.form ?? null;
    const method = normalizeText(form?.getAttribute('method') || 'get').toLowerCase();
    if (method && method !== 'get') {
      return null;
    }

    const inputName = normalizeText(
      search.input?.getAttribute('name')
      || locator.inputName
      || profileConfig.searchQueryParamNames[0]
      || 'searchkey',
    );
    if (!inputName) {
      return null;
    }

    let action = form?.getAttribute('action') || locator.formAction || trigger?.href || location.href;
    if (!normalizeText(action) && (profileConfig.profileHost === 'www.bilibili.com' || location.hostname === 'www.bilibili.com')) {
      action = 'https://search.bilibili.com/all';
    }
    if (normalizeUrlLike(action) === normalizeUrlLike(location.href) && (profileConfig.profileHost === 'www.bilibili.com' || location.hostname === 'www.bilibili.com')) {
      action = 'https://search.bilibili.com/all';
    }
    const targetUrl = normalizeUrlLike(action);
    if (!targetUrl) {
      return null;
    }

    try {
      const url = new URL(targetUrl, document.baseURI);
      if (form instanceof HTMLFormElement) {
        for (const element of Array.from(form.elements)) {
          if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) {
            continue;
          }
          const name = normalizeText(element.getAttribute('name') || '');
          if (!name || name === inputName) {
            continue;
          }
          if (element instanceof HTMLInputElement && ['submit', 'button', 'image', 'file'].includes(element.type)) {
            continue;
          }
          if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.value) {
            url.searchParams.set(name, element.value);
          } else if (element instanceof HTMLSelectElement && element.value) {
            url.searchParams.set(name, element.value);
          }
        }
      }
      url.searchParams.set(inputName, queryText);
      return url.toString();
    } catch {
      return null;
    }
  }

  if (trigger?.kind === 'search-form') {
    const queryText = normalizeText(trigger.queryText || locator.textSnippet || '');
    const search = findSearchFormElements();
    if (!queryText) {
      return {
        clicked: false,
        reason: 'missing-query',
      };
    }
    if (!search.form && !search.input) {
      return {
        clicked: false,
        reason: 'search-form-not-found',
      };
    }

    try {
      const directUrl = buildSearchNavigationUrl(queryText, search);
      if (directUrl) {
        location.assign(directUrl);
        return {
          clicked: true,
          label: queryText,
          tagName: 'form',
          role: 'search',
          submitted: true,
          directNavigation: true,
          navigationUrl: directUrl,
        };
      }

      if (search.input) {
        search.input.focus();
        search.input.value = queryText;
        search.input.dispatchEvent(new Event('input', { bubbles: true }));
        search.input.dispatchEvent(new Event('change', { bubbles: true }));
      }

      if (search.form instanceof HTMLFormElement) {
        search.form.setAttribute('target', '_self');
      } else if (search.input?.form instanceof HTMLFormElement) {
        search.input.form.setAttribute('target', '_self');
      }

      if (search.submit instanceof HTMLElement) {
        search.submit.click();
      } else if (search.form instanceof HTMLFormElement) {
        if (typeof search.form.requestSubmit === 'function') {
          search.form.requestSubmit();
        } else {
          search.form.submit();
        }
      } else if (search.input?.form instanceof HTMLFormElement) {
        if (typeof search.input.form.requestSubmit === 'function') {
          search.input.form.requestSubmit();
        } else {
          search.input.form.submit();
        }
      }

      return {
        clicked: true,
        label: queryText,
        tagName: 'form',
        role: 'search',
        submitted: true,
      };
    } catch (error) {
      return {
        clicked: false,
        reason: error.message,
      };
    }
  }

  const element = findBestElement(locator);
  if (!element) {
    if (trigger?.href) {
      try {
        location.assign(trigger.href);
        return {
          clicked: true,
          label: trigger.label || trigger.href,
          tagName: locator.tagName || 'a',
          role: locator.role || 'link',
          directNavigation: true,
        };
      } catch (error) {
        return {
          clicked: false,
          reason: error.message,
        };
      }
    }
    return {
      clicked: false,
      reason: 'not-found',
    };
  }

  try {
    element.scrollIntoView({
      block: 'center',
      inline: 'center',
      behavior: 'instant',
    });
  } catch {
    // Ignore scroll errors and still try the click.
  }

  try {
    element.click();
    return {
      clicked: true,
      label: getLabel(element),
      tagName: element.tagName.toLowerCase(),
      role: getRole(element),
    };
  } catch (error) {
    return {
      clicked: false,
      reason: error.message,
    };
  }
}

function pageComputeStateSignature(siteProfile = null) {
  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function isContentDetailPageTypeLocal(pageType) {
    return pageType === 'book-detail-page' || pageType === 'content-detail-page';
  }

  function normalizeHostnameLocal(value) {
    return String(value ?? '').trim().toLowerCase();
  }

  function classifyJableModelsPathLocal(pathname) {
    const normalized = String(pathname || '/').trim().toLowerCase() || '/';
    if (normalized === '/models' || normalized === '/models/') {
      return 'list';
    }
    if (!normalized.startsWith('/models/')) {
      return null;
    }
    const remainder = normalized.slice('/models/'.length).replace(/^\/+|\/+$/g, '');
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

  function normalizeUrlNoFragmentLocal(value) {
    try {
      const parsed = new URL(value, document.baseURI);
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return String(value ?? '').split('#')[0];
    }
  }

  function getLabel(element) {
    const ariaLabel = normalizeText(element.getAttribute('aria-label'));
    if (ariaLabel) {
      return ariaLabel;
    }
    const labelledBy = normalizeText(element.getAttribute('aria-labelledby'));
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => normalizeText(node.textContent || node.innerText || ''))
        .filter(Boolean);
      if (parts.length > 0) {
        return normalizeText(parts.join(' '));
      }
    }
    const text = normalizeText(element.innerText || element.textContent || '');
    if (text) {
      return text.slice(0, 80);
    }
    return normalizeText(element.id || element.getAttribute('name') || element.tagName.toLowerCase());
  }

  function getRole(element) {
    const explicit = normalizeText(element.getAttribute('role'));
    if (explicit) {
      return explicit.toLowerCase();
    }
    const tag = element.tagName.toLowerCase();
    if (tag === 'button' || tag === 'summary') {
      return 'button';
    }
    if (tag === 'a' && element.hasAttribute('href')) {
      return 'link';
    }
    return '';
  }

  function isVisible(element) {
    if (!element || !element.isConnected) {
      return false;
    }
    if (element.hidden || element.closest('[hidden], [inert]')) {
      return false;
    }
    if (element.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function descriptor(element) {
    return [
      element.tagName.toLowerCase(),
      element.id ? `#${element.id}` : '',
      getRole(element) ? `[${getRole(element)}]` : '',
      getLabel(element),
    ]
      .filter(Boolean)
      .join('');
  }

  function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort();
  }

  function controlledIdsFromElement(element) {
    return normalizeText(element.getAttribute('aria-controls')).split(/\s+/).filter(Boolean);
  }

  function textFromSelectors(selectors) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const text = normalizeText(node?.textContent || node?.innerText || '');
      if (text) {
        return text;
      }
    }
    return null;
  }

  function hrefFromSelectors(selectors) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const href = node?.getAttribute?.('href');
      if (href) {
        return normalizeUrlNoFragmentLocal(href);
      }
    }
    return null;
  }

  function textsFromSelectors(selectors) {
    const values = [];
    for (const selector of selectors) {
      try {
        values.push(
          ...Array.from(document.querySelectorAll(selector)).map((node) => normalizeText(node?.textContent || node?.innerText || '')),
        );
      } catch {
        // Ignore invalid selectors from site profile.
      }
    }
    return uniqueSorted(values.filter(Boolean));
  }

  function hrefsFromSelectors(selectors) {
    const values = [];
    for (const selector of selectors) {
      try {
        values.push(
          ...Array.from(document.querySelectorAll(selector))
            .map((node) => normalizeText(node?.getAttribute?.('href') || ''))
            .filter(Boolean)
            .map((value) => normalizeUrlNoFragmentLocal(value)),
        );
      } catch {
        // Ignore invalid selectors from site profile.
      }
    }
    return uniqueSorted(values.filter(Boolean));
  }

  function metaContent(name) {
    return normalizeText(
      document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content') || '',
    ) || null;
  }

  function uniqueTexts(elements) {
    return uniqueSorted(elements.map((node) => normalizeText(node?.textContent || node?.innerText || '')).filter(Boolean));
  }

  const detailsOpen = uniqueSorted(
    Array.from(document.querySelectorAll('details[open]')).map((element) => descriptor(element)),
  );

  const expandedTriggers = Array.from(document.querySelectorAll('[aria-expanded="true"]')).filter(isVisible);
  const expandedTrue = uniqueSorted(expandedTriggers.map((element) => descriptor(element)));

  const activeTabs = Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]')).filter(isVisible);
  const activeTabDescriptors = uniqueSorted(activeTabs.map((element) => descriptor(element)));

  const controlledIds = new Set();
  for (const element of [...expandedTriggers, ...activeTabs]) {
    for (const id of controlledIdsFromElement(element)) {
      controlledIds.add(id);
    }
  }

  const controlledVisible = uniqueSorted(
    [...controlledIds]
      .map((id) => document.getElementById(id))
      .filter((element) => isVisible(element))
      .map((element) => descriptor(element)),
  );

  const openDialogs = uniqueSorted(
    Array.from(document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]'))
      .filter(isVisible)
      .map((element) => descriptor(element)),
  );

  const openMenus = uniqueSorted(
    [...controlledIds]
      .map((id) => document.getElementById(id))
      .filter((element) => isVisible(element) && (getRole(element) === 'menu' || getRole(element) === 'menubar'))
      .map((element) => descriptor(element)),
  );

  const openListboxes = uniqueSorted(
    [...controlledIds]
      .map((id) => document.getElementById(id))
      .filter((element) => isVisible(element) && getRole(element) === 'listbox')
      .map((element) => descriptor(element)),
  );

  const openPopovers = uniqueSorted(
    Array.from(document.querySelectorAll('[popover]'))
      .filter((element) => {
        try {
          return element.matches(':popover-open') && isVisible(element);
        } catch {
          return false;
        }
      })
      .map((element) => descriptor(element)),
  );

  const finalUrl = normalizeUrlNoFragmentLocal(location.href);
  const title = document.title || '';
  const parsedFinalUrl = (() => {
    try {
      return new URL(finalUrl, document.baseURI);
    } catch {
      return null;
    }
  })();
  const pathname = parsedFinalUrl?.pathname || '/';
  const bilibiliContentTypeFromUrlLocal = (value) => {
    const normalizedValue = normalizeText(value);
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
  };
  const bilibiliBvidFromUrlLocal = (value) => normalizeText(value?.match(/\/video\/(BV[0-9A-Za-z]+)/u)?.[1] || '') || null;
  const bilibiliMidFromUrlLocal = (value) => normalizeText(value?.match(/space\.bilibili\.com\/(\d+)/u)?.[1] || '') || null;
  const bilibiliAuthorSubpageFromPathLocal = (value) => {
    const matched = String(value || '').match(/^\/\d+(?:\/([^?#]+))?/u);
    const normalized = normalizeText(String(matched?.[1] || '').replace(/^\/+|\/+$/gu, ''));
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
  const normalizeBilibiliAuthorCardLocal = (card = {}, authorSubpage = null) => {
    const name = normalizeText(card.name);
    const url = card.url ? normalizeUrlNoFragmentLocal(card.url) : null;
    const mid = normalizeText(card.mid) || bilibiliMidFromUrlLocal(url);
    if (!name && !url && !mid) {
      return null;
    }
    return {
      name: name || null,
      url: url || null,
      mid: mid || null,
      authorSubpage: normalizeText(card.authorSubpage) || authorSubpage || null,
      cardKind: normalizeText(card.cardKind) || 'author',
    };
  };
  const normalizeBilibiliContentCardLocal = (card = {}, fallbackAuthorMid = null) => {
    const url = card.url ? normalizeUrlNoFragmentLocal(card.url) : null;
    const titleValue = normalizeText(card.title);
    const bvid = normalizeText(card.bvid) || bilibiliBvidFromUrlLocal(url);
    const authorMid = normalizeText(card.authorMid) || fallbackAuthorMid || null;
    const contentType = normalizeText(card.contentType) || bilibiliContentTypeFromUrlLocal(url);
    const authorUrl = card.authorUrl ? normalizeUrlNoFragmentLocal(card.authorUrl) : null;
    const authorName = normalizeText(card.authorName);
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
  const dedupeBilibiliAuthorCardsLocal = (cards = [], authorSubpage = null) => {
    const seen = new Set();
    const result = [];
    for (const rawCard of cards) {
      const card = normalizeBilibiliAuthorCardLocal(rawCard, authorSubpage);
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
  const dedupeBilibiliContentCardsLocal = (cards = [], fallbackAuthorMid = null) => {
    const seen = new Set();
    const result = [];
    for (const rawCard of cards) {
      const card = normalizeBilibiliContentCardLocal(rawCard, fallbackAuthorMid);
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
  const extractBilibiliAuthorSurfaceCardsLocal = ({ currentAuthorMid = null, currentAuthorName = null, authorSubpage = null } = {}) => {
    const containerSelectors = [
      '.bili-dyn-list__item',
      '.bili-dyn-item',
      '.bili-space-video',
      '.video-page-card',
      '.video-page-card-small',
      '.small-item',
      '.bili-video-card',
      '.list-item',
      '.card',
      'article',
      'li',
    ];
    const contentSelector = 'a[href*="/video/"], a[href*="/bangumi/play/"]';
    const authorSelector = 'a[href*="space.bilibili.com/"]';
    const titleSelectors = [
      '[title]',
      '.title',
      '.bili-video-card__info--tit',
      '.bili-video-card__info--title',
      '.video-name',
      '.name',
    ];
    const nameSelectors = ['.name', '.up-name', '.nickname', '[data-user-name]'];
    const isHeaderLike = (node) => Boolean(node?.closest?.('header, nav, [class*="header"], [class*="nav"]'));
    const findContainer = (node) => {
      for (const selector of containerSelectors) {
        const match = node?.closest?.(selector);
        if (match instanceof Element && !isHeaderLike(match) && isVisible(match)) {
          return match;
        }
      }
      const parent = node?.parentElement;
      return parent instanceof Element && !isHeaderLike(parent) ? parent : null;
    };
    const readAuthorNameFromContainer = (container, authorLink) => {
      for (const selector of nameSelectors) {
        const node = container.querySelector(selector);
        const value = normalizeText(node?.textContent || node?.getAttribute?.('title') || '');
        if (value) {
          return value;
        }
      }
      return normalizeText(authorLink?.textContent || authorLink?.getAttribute?.('title') || '');
    };
    const readContentTitleFromContainer = (container, contentLink) => {
      for (const selector of titleSelectors) {
        const node = container.querySelector(selector);
        const value = normalizeText(node?.getAttribute?.('title') || node?.textContent || '');
        if (value) {
          return value;
        }
      }
      return normalizeText(contentLink?.getAttribute?.('title') || contentLink?.textContent || '');
    };
    const registerContainer = (collection, node) => {
      const container = findContainer(node);
      if (container instanceof Element && !collection.includes(container)) {
        collection.push(container);
      }
    };

    const containers = [];
    for (const node of Array.from(document.querySelectorAll(contentSelector))) {
      registerContainer(containers, node);
    }
    for (const node of Array.from(document.querySelectorAll(authorSelector))) {
      registerContainer(containers, node);
    }

    const authorCards = [];
    const contentCards = [];
    for (const container of containers) {
      const contentLink = Array.from(container.querySelectorAll(contentSelector))
        .find((node) => isVisible(node) && normalizeUrlNoFragmentLocal(node.getAttribute?.('href') || ''));
      const contentUrl = normalizeUrlNoFragmentLocal(contentLink?.getAttribute?.('href') || '');
      const authorLink = Array.from(container.querySelectorAll(authorSelector))
        .find((node) => {
          if (!isVisible(node)) {
            return false;
          }
          const href = normalizeUrlNoFragmentLocal(node.getAttribute?.('href') || '');
          const mid = bilibiliMidFromUrlLocal(href);
          if (!href || mid === currentAuthorMid) {
            return false;
          }
          return true;
        });
      const authorUrl = normalizeUrlNoFragmentLocal(authorLink?.getAttribute?.('href') || '');
      const authorMid = bilibiliMidFromUrlLocal(authorUrl);
      const authorName = readAuthorNameFromContainer(container, authorLink) || currentAuthorName || null;
      if (authorUrl || authorName || authorMid) {
        authorCards.push({
          name: authorName,
          url: authorUrl || null,
          mid: authorMid || null,
          authorSubpage,
        });
      }
      if (contentUrl) {
        contentCards.push({
          title: readContentTitleFromContainer(container, contentLink),
          url: contentUrl,
          bvid: bilibiliBvidFromUrlLocal(contentUrl),
          authorMid: authorMid || currentAuthorMid || null,
          authorUrl: authorUrl || null,
          authorName,
          contentType: bilibiliContentTypeFromUrlLocal(contentUrl),
        });
      }
    }
    return {
      authorCards: dedupeBilibiliAuthorCardsLocal(authorCards, authorSubpage),
      contentCards: dedupeBilibiliContentCardsLocal(contentCards, currentAuthorMid),
    };
  };
  const detectBilibiliAntiCrawlSignalsLocal = () => {
    const source = normalizeText(document.body?.innerText || document.documentElement?.innerText || '');
    if (!source) {
      return [];
    }
    const signals = [];
    const patterns = [
      ['rate-limit', /\u8bbf\u95ee\u9891\u7e41/u],
      ['verify', /\u5b89\u5168\u9a8c\u8bc1/u],
      ['slide-verify', /\u6ed1\u52a8\u9a8c\u8bc1/u],
      ['captcha', /captcha/iu],
      ['risk-control', /\u98ce\u63a7/u],
      ['retry-later', /\u8bf7\u7a0d\u540e\u518d\u8bd5/u],
    ];
    for (const [label, pattern] of patterns) {
      if (pattern.test(source)) {
        signals.push(label);
      }
    }
    return signals;
  };
  const bilibiliCategoryNameFromPathLocal = (value) => {
    const normalizedPath = String(value || '').toLowerCase();
    if (normalizedPath.startsWith('/v/popular/')) {
      return '热门';
    }
    if (normalizedPath.startsWith('/anime/')) {
      return '番剧';
    }
    if (normalizedPath.startsWith('/movie/')) {
      return '电影';
    }
    if (normalizedPath.startsWith('/guochuang/')) {
      return '国创';
    }
    if (normalizedPath.startsWith('/tv/')) {
      return '电视剧';
    }
    if (normalizedPath.startsWith('/variety/')) {
      return '综艺';
    }
    if (normalizedPath.startsWith('/documentary/')) {
      return '纪录片';
    }
    if (normalizedPath.startsWith('/knowledge/')) {
      return '知识';
    }
    if (normalizedPath.startsWith('/music/')) {
      return '音乐';
    }
    if (normalizedPath.startsWith('/game/')) {
      return '游戏';
    }
    if (normalizedPath.startsWith('/food/')) {
      return '美食';
    }
    if (normalizedPath.startsWith('/sports/')) {
      return '运动';
    }
    if (normalizedPath.startsWith('/c/')) {
      return '分区';
    }
    return null;
  };
  const pageType = (() => {
    try {
      const profilePageTypes = siteProfile?.pageTypes ?? {};
      const normalizedLocationHost = normalizeHostnameLocal(location.hostname);
      const isBilibiliProfile = ['www.bilibili.com', 'search.bilibili.com', 'space.bilibili.com'].includes(normalizeHostnameLocal(siteProfile?.host ?? ''));
      const matchesProfilePrefix = (values) => Array.isArray(values) && values.some((value) => {
        const normalizedValue = String(value || '').toLowerCase();
        const normalizedPath = String(pathname || '/').toLowerCase();
        return normalizedValue && (normalizedPath === normalizedValue || normalizedPath.startsWith(normalizedValue));
      });
      const matchesProfileExact = (values) => Array.isArray(values)
        && values.some((value) => String(value || '').toLowerCase() === String(pathname || '/').toLowerCase());
      if (matchesProfileExact(profilePageTypes.homeExact) || matchesProfilePrefix(profilePageTypes.homePrefixes)) {
        return 'home';
      }
      if (String(siteProfile?.host ?? '').toLowerCase() === 'jable.tv') {
        const modelsPathKind = classifyJableModelsPathLocal(pathname);
        if (modelsPathKind === 'list') {
          return 'author-list-page';
        }
        if (modelsPathKind === 'detail') {
          return 'author-page';
        }
      }
      if (
        (!isBilibiliProfile || normalizedLocationHost === 'search.bilibili.com')
        && matchesProfilePrefix(profilePageTypes.searchResultsPrefixes)
      ) {
        return 'search-results-page';
      }
      if (matchesProfilePrefix(profilePageTypes.contentDetailPrefixes)) {
        return 'book-detail-page';
      }
      if (
        isBilibiliProfile
        && normalizedLocationHost === 'space.bilibili.com'
        && /^\/\d+\/(?:(?:upload\/)?video|dynamic|fans\/follow|fans\/fans)(?:\/|$)?/i.test(pathname)
      ) {
        return 'author-list-page';
      }
      if (matchesProfilePrefix(profilePageTypes.authorPrefixes)) {
        return 'author-page';
      }
      if (matchesProfilePrefix(profilePageTypes.chapterPrefixes)) {
        return 'chapter-page';
      }
      if (matchesProfilePrefix(profilePageTypes.historyPrefixes)) {
        return 'history-page';
      }
      if (matchesProfilePrefix(profilePageTypes.authPrefixes)) {
        return 'auth-page';
      }
      if (matchesProfilePrefix(profilePageTypes.categoryPrefixes)) {
        return 'category-page';
      }
      if (pathname === '/' || pathname === '') {
        return 'home';
      }
      if (normalizedLocationHost === 'search.bilibili.com' && /^\/(?:all|video|bangumi|upuser)(?:\/|$)/i.test(pathname)) {
        return 'search-results-page';
      }
  if (normalizedLocationHost === 'space.bilibili.com' && /^\/\d+\/(?:(?:upload\/)?video|dynamic|fans\/follow|fans\/fans)(?:\/|$)?/i.test(pathname)) {
    return 'author-list-page';
  }
      if (normalizedLocationHost === 'space.bilibili.com' && /^\/\d+(?:\/|$)?/i.test(pathname)) {
        return 'author-page';
      }
      if (/\/ss(?:\/|$)/i.test(pathname)) {
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
  })();

  const pageFacts = (() => {
    if (pageType === 'search-results-page') {
      const profileResultTitleSelectors = Array.isArray(siteProfile?.search?.resultTitleSelectors)
        ? siteProfile.search.resultTitleSelectors
        : ['.layout-co18 .layout-tit', '.layout2 .layout-tit'];
      const profileResultBookSelectors = Array.isArray(siteProfile?.search?.resultBookSelectors)
        ? siteProfile.search.resultBookSelectors
        : ['.txt-list-row5 li .s2 a[href]', '.layout-co18 .txt-list a[href]'];
      const queryParamNames = Array.isArray(siteProfile?.search?.queryParamNames)
        ? siteProfile.search.queryParamNames
        : ['searchkey', 'keyword', 'q'];
      const resultAnchors = [];
      for (const selector of profileResultBookSelectors) {
        try {
          resultAnchors.push(...document.querySelectorAll(selector));
        } catch {
          // Ignore invalid selectors from site profile.
        }
      }
      const queryFromTitle = (() => {
        const headingText = textFromSelectors(profileResultTitleSelectors) || '';
        const matched = headingText.match(/搜索\s*["“]?(.+?)["”]?\s*共有/i);
        return normalizeText(matched?.[1] || '');
      })();
      const derivedQuery = (() => {
        try {
          const parsed = new URL(finalUrl, document.baseURI);
          for (const name of queryParamNames) {
            const value = normalizeText(parsed.searchParams.get(name) || '');
            if (value) {
              return value;
            }
          }
          const fromPath = parsed.pathname.match(/\/ss\/(.+?)(?:\.html)?$/i)?.[1] || '';
          const fromPathText = decodeURIComponent(fromPath).replace(/\.html$/i, '');
          if (normalizeText(fromPathText)) {
            return fromPathText;
          }
        } catch {
          // Ignore URL parse failures.
        }
        return queryFromTitle;
      })();
      const queryText = normalizeText(
        document.querySelector('#searchkey, input[name="searchkey"], input[name="keyword"], #s')?.value || derivedQuery,
      );
      const resultTitles = uniqueTexts(resultAnchors).slice(0, 20);
      const resultUrls = uniqueSorted(
        resultAnchors
          .map((anchor) => normalizeText(anchor?.getAttribute?.('href') || ''))
          .filter(Boolean)
          .map((href) => normalizeUrlNoFragmentLocal(href)),
      ).slice(0, 20);
      const facts = {
        queryText,
        resultCount: Math.max(
          resultUrls.length,
          [...new Set(resultAnchors.map((anchor) => normalizeText(anchor.textContent || '')).filter(Boolean))].length,
        ),
        resultTitles,
      };
      if (['www.bilibili.com', 'search.bilibili.com', 'space.bilibili.com'].includes(normalizeHostnameLocal(siteProfile?.host ?? ''))) {
        const resultAuthorUrls = uniqueSorted(
          Array.from(document.querySelectorAll('a[href*="space.bilibili.com/"]'))
            .map((anchor) => normalizeText(anchor?.getAttribute?.('href') || ''))
            .filter(Boolean)
            .map((href) => normalizeUrlNoFragmentLocal(href)),
        ).slice(0, 20);
        const resultEntries = resultUrls.slice(0, 12).map((value, index) => ({
          title: resultTitles[index] ?? null,
          url: value,
          contentType: bilibiliContentTypeFromUrlLocal(value),
          bvid: bilibiliBvidFromUrlLocal(value),
          authorUrl: resultAuthorUrls[index] ?? null,
          authorMid: bilibiliMidFromUrlLocal(resultAuthorUrls[index] ?? ''),
        }));
        facts.resultUrls = resultUrls;
        facts.searchSection = pathname.split('/').filter(Boolean)[0] || 'all';
        facts.firstResultTitle = resultTitles[0] ?? null;
        facts.firstResultUrl = resultUrls[0] ?? null;
        facts.firstResultContentType = bilibiliContentTypeFromUrlLocal(resultUrls[0] ?? '');
        facts.resultEntries = resultEntries;
        facts.resultContentTypes = resultUrls
          .map((value) => bilibiliContentTypeFromUrlLocal(value))
          .filter(Boolean)
          .slice(0, 20);
        facts.resultAuthorUrls = resultAuthorUrls;
        facts.resultAuthorMids = resultAuthorUrls
          .map((value) => bilibiliMidFromUrlLocal(value))
          .filter(Boolean)
          .slice(0, 20);
        facts.resultBvids = resultUrls
          .map((value) => bilibiliBvidFromUrlLocal(value))
          .filter(Boolean)
          .slice(0, 10);
      }
      return facts;
    }
    if (isContentDetailPageTypeLocal(pageType)) {
      const chapterLinkSelectors = Array.isArray(siteProfile?.bookDetail?.chapterLinkSelectors)
        ? siteProfile.bookDetail.chapterLinkSelectors
        : ['#list a[href]', '.listmain a[href]', 'dd a[href]', '.book_last a[href]'];
      const chapterAnchors = [];
      for (const selector of chapterLinkSelectors) {
        try {
          chapterAnchors.push(...document.querySelectorAll(selector));
        } catch {
          // Ignore invalid selectors from site profile.
        }
      }
      const latestChapterLink = chapterAnchors[0] ?? null;
      const facts = {
        bookTitle: metaContent('og:novel:book_name')
          || textFromSelectors(
            Array.isArray(siteProfile?.contentDetail?.titleSelectors)
              ? siteProfile.contentDetail.titleSelectors
              : ['h1', '.book h1', '#bookinfo h1', 'h2'],
          ),
        authorName: metaContent('og:novel:author')
          || textFromSelectors(
            Array.isArray(siteProfile?.contentDetail?.authorNameSelectors)
              ? siteProfile.contentDetail.authorNameSelectors
              : ['a[href*="/author/"]', '.small span a'],
          ),
        authorUrl: (() => {
          const value = metaContent('og:novel:author_link')
            || hrefFromSelectors(
              Array.isArray(siteProfile?.contentDetail?.authorLinkSelectors)
                ? siteProfile.contentDetail.authorLinkSelectors
                : ['a[href*="/author/"]'],
            );
          return value ? normalizeUrlNoFragmentLocal(value) : null;
        })(),
        chapterCount: chapterAnchors.length,
        latestChapterTitle: normalizeText(latestChapterLink?.textContent || '') || textFromSelectors(['.book_last a', '#list a']),
        latestChapterUrl: (() => {
          const value = metaContent('og:novel:lastest_chapter_url') || latestChapterLink?.getAttribute('href') || '';
          return value ? normalizeUrlNoFragmentLocal(value) : null;
        })(),
      };
      if (['www.bilibili.com', 'search.bilibili.com', 'space.bilibili.com'].includes(normalizeHostnameLocal(siteProfile?.host ?? ''))) {
        const bilibiliAuthorUrl = facts.authorUrl
          || hrefFromSelectors([
            'a.up-name[href*="space.bilibili.com/"]',
            '.video-owner-card a[href*="space.bilibili.com/"]',
            'a[href*="space.bilibili.com/"]',
          ]);
        const tagTexts = textsFromSelectors([
          '.tag-link',
          '.video-tag-link',
          'a[href*="/v/topic/detail"]',
          'a[href*="/v/tag/"]',
        ]).slice(0, 12);
        const scriptText = [
          document.documentElement?.innerText || '',
          ...Array.from(document.scripts || []).map((node) => node.textContent || ''),
        ].join('\n');
        const scriptMatch = (pattern) => normalizeText(scriptText.match(pattern)?.[1] || '') || null;
        const bilibiliTitle = facts.bookTitle
          || textFromSelectors(['h1.video-title', 'h1', '.video-title', '.media-title'])
          || normalizeText(String(title || '').replace(/\s*[-_].*$/, ''));
        const seasonId = scriptMatch(/"season_id"\s*:\s*(\d+)/u) || scriptMatch(/"seasonId"\s*:\s*(\d+)/u);
        const episodeId = pathname.match(/\/bangumi\/play\/ep(\d+)/u)?.[1]
          || scriptMatch(/"ep_id"\s*:\s*(\d+)/u)
          || scriptMatch(/"episode_id"\s*:\s*(\d+)/u)
          || scriptMatch(/"epId"\s*:\s*(\d+)/u);
        const seriesTitle = textFromSelectors([
          '.media-title',
          '.media-info-title',
          '.media-right .title',
          '.mediainfo_mediaTitle',
        ]);
        const episodeTitle = textFromSelectors([
          'h1.video-title',
          '.video-title',
          '.ep-info-title',
          'h1',
        ]);
        facts.bookTitle = bilibiliTitle;
        facts.contentTitle = bilibiliTitle;
        facts.contentType = pathname.startsWith('/bangumi/play/') ? 'bangumi' : 'video';
        facts.bvid = finalUrl.match(/\/video\/(BV[0-9A-Za-z]+)/u)?.[1] || scriptMatch(/"bvid"\s*:\s*"([^"]+)"/u);
        facts.aid = scriptMatch(/"aid"\s*:\s*(\d+)/u) || scriptMatch(/"aid":"?(\d+)"?/u);
        facts.authorName = facts.authorName
          || textFromSelectors(['a.up-name', '.up-name', '.up-detail-top .up-name', '.video-owner-card .name']);
        facts.authorUrl = bilibiliAuthorUrl ?? null;
        facts.authorMid = bilibiliAuthorUrl?.match(/space\.bilibili\.com\/(\d+)/u)?.[1]
          || scriptMatch(/"mid"\s*:\s*(\d+)/u)
          || scriptMatch(/"mid":"?(\d+)"?/u);
        facts.publishedAt = metaContent('og:video:release_date')
          || metaContent('article:published_time')
          || textFromSelectors(['time', '.pubdate-text', '.video-publish time', '[class*="pubdate"]'])
          || null;
        facts.categoryName = textFromSelectors([
          '.video-info-detail a',
          '.video-detail-title a',
          '.first-channel',
          'a[href*="/v/"]',
        ]);
        facts.seasonId = seasonId ?? null;
        facts.episodeId = episodeId ?? null;
        facts.seriesTitle = seriesTitle ?? null;
        facts.episodeTitle = (facts.contentType === 'bangumi' ? (episodeTitle || bilibiliTitle) : null) ?? null;
        facts.tagNames = tagTexts;
      }
      return facts;
    }
    if (pageType === 'author-page' || pageType === 'author-list-page') {
      const facts = {
        authorName: metaContent('og:novel:author')
          || textFromSelectors(
            Array.isArray(siteProfile?.author?.titleSelectors)
              ? siteProfile.author.titleSelectors
              : ['h1', '.author h1', '.title h1', 'h2'],
          ),
      };
      if (['www.bilibili.com', 'search.bilibili.com', 'space.bilibili.com'].includes(normalizeHostnameLocal(siteProfile?.host ?? ''))) {
        const featuredAuthorUrls = hrefsFromSelectors(['a[href*="space.bilibili.com/"]'])
          .filter((value) => value !== finalUrl)
          .slice(0, 16);
        const featuredAuthorNames = textsFromSelectors([
          'a[href*="space.bilibili.com/"] .name',
          'a[href*="space.bilibili.com/"] .up-name',
          'a[href*="space.bilibili.com/"]',
        ])
          .filter((value) => value !== facts.authorName)
          .slice(0, 16);
        const featuredContentUrls = hrefsFromSelectors(
          Array.isArray(siteProfile?.author?.workLinkSelectors)
            ? siteProfile.author.workLinkSelectors
            : ['a[href*="/video/BV"]'],
        ).slice(0, 12);
        const featuredContentTitles = textsFromSelectors(
          Array.isArray(siteProfile?.author?.workLinkSelectors)
            ? siteProfile.author.workLinkSelectors
            : ['a[href*="/video/BV"]'],
        ).slice(0, 12);
        facts.authorName = facts.authorName
          || textFromSelectors(['h1', '.nickname', '.up-name', '.h-name'])
          || normalizeText(String(title || '').replace(/\s*[-_].*$/, ''));
        facts.authorMid = pathname.match(/^\/(\d+)(?:\/|$)/u)?.[1] || null;
        facts.authorUrl = finalUrl;
        facts.authorSubpage = bilibiliAuthorSubpageFromPathLocal(pathname);
        facts.authorSubpagePath = pathname;
        const extractedCards = extractBilibiliAuthorSurfaceCardsLocal({
          currentAuthorMid: facts.authorMid,
          currentAuthorName: facts.authorName,
          authorSubpage: facts.authorSubpage,
        });
        const authorCards = dedupeBilibiliAuthorCardsLocal(
          extractedCards.authorCards.length > 0
            ? extractedCards.authorCards
            : featuredAuthorUrls.map((value, index) => ({
              url: value,
              mid: bilibiliMidFromUrlLocal(value),
              name: featuredAuthorNames[index] || null,
              authorSubpage: facts.authorSubpage,
            })),
          facts.authorSubpage,
        );
        const contentCards = dedupeBilibiliContentCardsLocal(
          extractedCards.contentCards.length > 0
            ? extractedCards.contentCards
            : featuredContentUrls.map((value, index) => ({
              url: value,
              title: featuredContentTitles[index] || null,
              bvid: bilibiliBvidFromUrlLocal(value),
              authorMid: facts.authorMid,
              authorUrl: facts.authorUrl,
              authorName: facts.authorName,
              contentType: bilibiliContentTypeFromUrlLocal(value),
            })),
          facts.authorMid,
        );
        facts.featuredAuthorCards = authorCards;
        facts.featuredAuthors = authorCards.map((card) => ({
          name: card.name,
          url: card.url,
          mid: card.mid,
        }));
        facts.featuredAuthorUrls = authorCards.map((card) => card.url).filter(Boolean);
        facts.featuredAuthorNames = authorCards.map((card) => card.name).filter(Boolean);
        facts.featuredAuthorMids = authorCards.map((card) => card.mid).filter(Boolean);
        facts.featuredAuthorCount = authorCards.length;
        facts.featuredContentCards = contentCards;
        facts.featuredContentUrls = contentCards.map((card) => card.url).filter(Boolean);
        facts.featuredContentTitles = contentCards.map((card) => card.title).filter(Boolean);
        facts.featuredContentCount = contentCards.length;
        facts.featuredContentTypes = contentCards.map((card) => card.contentType).filter(Boolean);
        facts.featuredContentBvids = contentCards.map((card) => card.bvid).filter(Boolean);
        facts.featuredContentAuthorMids = contentCards.map((card) => card.authorMid).filter(Boolean);
        const antiCrawlSignals = detectBilibiliAntiCrawlSignalsLocal();
        if (antiCrawlSignals.length > 0) {
          facts.antiCrawlDetected = true;
          facts.antiCrawlSignals = antiCrawlSignals;
        }
      }
      return facts;
    }
    if (pageType === 'category-page') {
      const facts = {
        categoryName: textFromSelectors(['h1', '.channel-title', '.page-title']) || bilibiliCategoryNameFromPathLocal(pathname),
      };
      if (['www.bilibili.com', 'search.bilibili.com', 'space.bilibili.com'].includes(normalizeHostnameLocal(siteProfile?.host ?? ''))) {
        const featuredContentUrls = uniqueSorted(
          Array.from(document.querySelectorAll('a[href*="/video/"], a[href*="/bangumi/play/"]'))
            .map((anchor) => normalizeText(anchor?.getAttribute?.('href') || ''))
            .filter(Boolean)
            .map((href) => normalizeUrlNoFragmentLocal(href)),
        ).slice(0, 16);
        const featuredContentTitles = textsFromSelectors([
          'a[href*="/video/"]',
          'a[href*="/bangumi/play/"]',
        ]).slice(0, 16);
        facts.categoryName = facts.categoryName || bilibiliCategoryNameFromPathLocal(pathname);
        facts.categoryPath = pathname;
        facts.featuredContentUrls = featuredContentUrls;
        facts.featuredContentTitles = featuredContentTitles;
        facts.featuredContentTypes = featuredContentUrls
          .map((value) => bilibiliContentTypeFromUrlLocal(value))
          .filter(Boolean)
          .slice(0, 16);
        facts.featuredContentCount = featuredContentUrls.length;
        facts.featuredContentBvids = featuredContentUrls
          .map((value) => bilibiliBvidFromUrlLocal(value))
          .filter(Boolean)
          .slice(0, 10);
        facts.rankingLabels = textsFromSelectors([
          '.rank-item .num',
          '.popular-rank .num',
          '.rank-wrap .rank-num',
          '.hot-list .rank',
        ]).slice(0, 12);
      }
      return facts;
    }
    if (pageType === 'chapter-page') {
      const contentText = normalizeText(
        document.querySelector('#content, .content, .reader-main .content')?.textContent || '',
      );
      return {
        bookTitle: textFromSelectors(['#info_url', '.crumbs a[href*="/biqu"]', '.bread-crumbs a[href*="/biqu"]']),
        authorName: metaContent('og:novel:author'),
        chapterTitle: textFromSelectors(['.reader-main .title', 'h1.title', '.content_read h1', 'h1']),
        chapterHref: finalUrl,
        prevChapterUrl: hrefFromSelectors(['#prev_url', 'a#prev_url']),
        nextChapterUrl: hrefFromSelectors(['#next_url', 'a#next_url']),
        bodyTextLength: contentText.length,
        bodyExcerpt: contentText.slice(0, 160) || null,
      };
    }
    return null;
  })();

  return {
    finalUrl,
    title,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    pageType,
    pageFacts,
    fingerprint: {
      finalUrl,
      title,
      pageType,
      pageFacts,
      detailsOpen,
      expandedTrue,
      activeTabs: activeTabDescriptors,
      controlledVisible,
      openDialogs,
      openMenus,
      openListboxes,
      openPopovers,
    },
  };
}

function createExpandHelperBundleSource(namespace = EXPAND_HELPER_NAMESPACE) {
  return `(() => {
    const root = globalThis;
    const MAX_FALLBACK_BOOKS = ${JSON.stringify(MAX_FALLBACK_BOOKS)};
    const existing = root[${JSON.stringify(namespace)}];
    if (existing && existing.__version === 1) {
      return existing;
    }
    const api = {
      __version: 1,
      pageWaitForDomQuiet: ${pageWaitForDomQuiet.toString()},
      pageDiscoverTriggers: ${pageDiscoverTriggers.toString()},
      pageExecuteTrigger: ${pageExecuteTrigger.toString()},
      pageComputeStateSignature: ${pageComputeStateSignature.toString()},
      pageExtractChapterPayload: ${pageExtractChapterPayload.toString()},
    };
    root[${JSON.stringify(namespace)}] = api;
    return api;
  })()`;
}

const EXPAND_HELPER_BUNDLE_SOURCE = createExpandHelperBundleSource();

function prefersDirectNavigation(trigger) {
  return Boolean(trigger?.href) && DIRECT_NAVIGATION_TRIGGER_KINDS.has(trigger?.kind);
}

function requiresSourceDom(trigger) {
  return !prefersDirectNavigation(trigger);
}

function isSameDocumentTrigger(trigger) {
  return SAME_DOCUMENT_TRIGGER_KINDS.has(trigger?.kind);
}

function buildSameDocumentWaitPolicy(settings, siteProfile = null, currentUrl = '') {
  const basePolicy = resolveNavigationWaitPolicy(settings, siteProfile, currentUrl);
  return {
    ...basePolicy,
    useLoadEvent: false,
    useNetworkIdle: false,
    documentReadyTimeoutMs: Math.min(settings.timeoutMs, basePolicy.documentReadyTimeoutMs ?? settings.timeoutMs),
    domQuietTimeoutMs: Math.min(settings.timeoutMs, basePolicy.domQuietTimeoutMs ?? settings.timeoutMs),
    domQuietMs: Math.min(basePolicy.domQuietMs ?? DOM_QUIET_MS, 150),
    idleMs: Math.min(basePolicy.idleMs ?? settings.idleMs, 150),
  };
}

async function callExpandHelper(session, methodName, fallbackFn, ...args) {
  return await session.invokeHelperMethod(methodName, args, {
    namespace: EXPAND_HELPER_NAMESPACE,
    bundleSource: EXPAND_HELPER_BUNDLE_SOURCE,
    fallbackFn,
  });
}

function resolveBilibiliAuthorWarmupUrl(url, siteProfile = null) {
  if (!isBilibiliSiteProfile(siteProfile, url)) {
    return null;
  }
  const pageType = inferPageTypeFromUrl(url, siteProfile);
  if (pageType !== 'author-list-page') {
    return null;
  }
  try {
    const parsed = new URL(String(url || ''));
    if (parsed.hostname !== 'space.bilibili.com') {
      return null;
    }
    const matchedMid = parsed.pathname.match(/^\/(\d+)\//u)?.[1] ?? parsed.pathname.match(/^\/(\d+)(?:\/|$)/u)?.[1] ?? null;
    if (!matchedMid) {
      return null;
    }
    return `https://space.bilibili.com/${matchedMid}`;
  } catch {
    return null;
  }
}

function shouldRetryBilibiliAuthorList(signature, targetUrl) {
  const pageType = String(signature?.pageType ?? '');
  if (pageType !== 'author-list-page') {
    return false;
  }
  const pageFacts = signature?.pageFacts ?? {};
  if (pageFacts.antiCrawlDetected === true) {
    return true;
  }
  const authorSubpage = String(pageFacts.authorSubpage ?? '').toLowerCase();
  if (!['video', 'dynamic', 'follow', 'fans'].includes(authorSubpage)) {
    return false;
  }
  const featuredAuthorCount = Number(pageFacts.featuredAuthorCount ?? toArray(pageFacts.featuredAuthorUrls).length ?? 0) || 0;
  const featuredContentCount = Number(pageFacts.featuredContentCount ?? toArray(pageFacts.featuredContentUrls).length ?? 0) || 0;
  if (featuredAuthorCount > 0 || featuredContentCount > 0) {
    return false;
  }
  const title = String(signature?.title ?? '');
  if (!title.trim()) {
    return true;
  }
  return /(登录|验证码|安全验证|稍后再试|频繁)/iu.test(title);
}

async function tryWarmBilibiliAuthorListNavigation(session, url, settings, siteProfile = null, trigger = null) {
  const warmupUrl = resolveBilibiliAuthorWarmupUrl(url, siteProfile);
  if (!warmupUrl) {
    return false;
  }

  const currentMetadata = await session.getPageMetadata();
  const currentUrl = normalizeUrlNoFragment(currentMetadata?.finalUrl ?? '');
  if (currentUrl !== normalizeUrlNoFragment(warmupUrl)) {
    await session.navigateAndWait(warmupUrl, resolveNavigationWaitPolicy(settings, siteProfile, warmupUrl));
    await ensureSiteSpecificReadyMarkers(session, siteProfile, warmupUrl);
  }

  await session.navigateAndWait(
    url,
    resolveDirectNavigationWaitPolicy(settings, siteProfile, url, trigger),
    { referrer: warmupUrl },
  );
  await ensureSiteSpecificReadyMarkers(session, siteProfile, url);

  const firstSignature = await collectStateSignature(session, siteProfile);
  if (shouldRetryBilibiliAuthorList(firstSignature, url)) {
    await session.navigateAndWait(warmupUrl, resolveNavigationWaitPolicy(settings, siteProfile, warmupUrl));
    await ensureSiteSpecificReadyMarkers(session, siteProfile, warmupUrl);
    await session.navigateAndWait(
      url,
      resolveDirectNavigationWaitPolicy(settings, siteProfile, url, trigger),
      { referrer: warmupUrl },
    );
    await ensureSiteSpecificReadyMarkers(session, siteProfile, url);
  }
  return true;
}

async function navigateAndWaitReady(session, url, settings, siteProfile = null) {
  if (await tryWarmBilibiliAuthorListNavigation(session, url, settings, siteProfile)) {
    return;
  }
  await session.navigateAndWait(url, resolveNavigationWaitPolicy(settings, siteProfile, url));
  await ensureSiteSpecificReadyMarkers(session, siteProfile, url);
}

async function collectStateSignature(session, siteProfile = null) {
  const signature = await callExpandHelper(session, 'pageComputeStateSignature', pageComputeStateSignature, siteProfile);
  if (!signature?.pageFacts || !isBilibiliSiteProfile(siteProfile, signature.finalUrl)) {
    return signature;
  }
  if (
    signature.pageType !== 'author-list-page'
    || !['dynamic', 'follow', 'fans'].includes(String(signature.pageFacts.authorSubpage ?? ''))
  ) {
    return signature;
  }
  const authSession = siteProfile?.authSession ?? null;
  const authConfig = authSession ? {
    loginUrl: String(authSession.loginUrl ?? '').trim() || null,
    loginIndicatorSelectors: Array.isArray(authSession.loginIndicatorSelectors) ? authSession.loginIndicatorSelectors : [],
    loggedOutIndicatorSelectors: Array.isArray(authSession.loggedOutIndicatorSelectors) ? authSession.loggedOutIndicatorSelectors : [],
    usernameSelectors: Array.isArray(authSession.usernameSelectors) ? authSession.usernameSelectors : [],
    passwordSelectors: Array.isArray(authSession.passwordSelectors) ? authSession.passwordSelectors : [],
    challengeSelectors: Array.isArray(authSession.challengeSelectors) ? authSession.challengeSelectors : [],
  } : null;
  if (!authConfig) {
    return signature;
  }
  try {
    const loginState = await inspectLoginState(session, authConfig);
    signature.pageFacts = {
      ...signature.pageFacts,
      loginStateDetected: loginState?.loginStateDetected === true || loginState?.loggedIn === true,
      identityConfirmed: loginState?.identityConfirmed === true,
      identitySource: loginState?.identitySource ?? null,
      authenticatedSessionConfirmed: loginState?.identityConfirmed === true,
    };
  } catch {
    // Keep the captured page facts even if login-state inspection is unavailable.
  }
  return signature;
}

async function discoverPageTriggers(session, discoveryLimit, searchQueries = [], siteProfile = null) {
  return await callExpandHelper(
    session,
    'pageDiscoverTriggers',
    pageDiscoverTriggers,
    discoveryLimit,
    searchQueries,
    siteProfile,
  );
}

async function extractChapterPayload(session, siteProfile = null) {
  return await callExpandHelper(session, 'pageExtractChapterPayload', pageExtractChapterPayload, siteProfile);
}

function resolveDirectNavigationWaitPolicy(settings, siteProfile, url, trigger = null) {
  const pageType = inferPageTypeFromUrl(url, siteProfile);
  if (isMoodyzSiteProfile(siteProfile, url) && (['category-page', 'search-results-page', 'author-page', 'author-list-page'].includes(pageType) || isContentDetailPageType(pageType))) {
    return {
      useLoadEvent: false,
      useNetworkIdle: false,
      documentReadyTimeoutMs: Math.min(settings.timeoutMs, 6_000),
      domQuietTimeoutMs: Math.min(settings.timeoutMs, 1_500),
      domQuietMs: trigger?.kind === 'content-link' ? 120 : 180,
      idleMs: Math.min(settings.idleMs, 120),
    };
  }
  if (isBilibiliSiteProfile(siteProfile, url)) {
    const policy = buildBilibiliWaitPolicy(settings, pageType, { directNavigation: true, trigger });
    if (policy) {
      return policy;
    }
  }
  return resolveNavigationWaitPolicy(settings, siteProfile, url);
}

async function executeTrigger(session, trigger, siteProfile, settings) {
  if (prefersDirectNavigation(trigger)) {
    if (!(await tryWarmBilibiliAuthorListNavigation(session, trigger.href, settings, siteProfile, trigger))) {
      await session.navigateAndWait(trigger.href, resolveDirectNavigationWaitPolicy(settings, siteProfile, trigger.href, trigger));
    }
    return {
      clicked: true,
      label: trigger.label || trigger.href,
      tagName: trigger?.locator?.tagName || 'a',
      role: trigger?.locator?.role || 'link',
      directNavigation: true,
      alreadySettled: true,
      navigationUrl: trigger.href,
    };
  }

  return await callExpandHelper(session, 'pageExecuteTrigger', pageExecuteTrigger, trigger, siteProfile);
}

function resolvePostTriggerWaitPolicy(trigger, executeResult, settings, siteProfile = null, currentUrl = '') {
  if (executeResult?.alreadySettled) {
    return null;
  }
  if (isSameDocumentTrigger(trigger) && !executeResult?.directNavigation && !executeResult?.submitted) {
    return buildSameDocumentWaitPolicy(settings, siteProfile, currentUrl);
  }
  if (trigger?.kind === 'search-form' && isBilibiliSiteProfile(siteProfile, executeResult?.navigationUrl || currentUrl)) {
    return buildBilibiliWaitPolicy(settings, 'search-results-page', {
      directNavigation: Boolean(executeResult?.directNavigation),
      trigger,
    });
  }
  return resolveNavigationWaitPolicy(settings, siteProfile, executeResult?.navigationUrl || currentUrl);
}

async function waitForPostTriggerSettled(session, settings, trigger, executeResult, siteProfile = null, currentUrl = '') {
  const waitPolicy = resolvePostTriggerWaitPolicy(trigger, executeResult, settings, siteProfile, currentUrl);
  if (!waitPolicy) {
    return;
  }
  await session.waitForSettled(waitPolicy);
}

function createBudgetState(settings) {
  return {
    maxTriggers: settings.maxTriggers,
    maxCapturedStates: Number.isFinite(settings.maxCapturedStates) ? settings.maxCapturedStates : null,
    hit: false,
    stopReason: null,
  };
}

function markBudgetStop(topManifest, reason) {
  if (!topManifest.budget) {
    return;
  }
  if (!topManifest.budget.hit) {
    topManifest.budget.hit = true;
    topManifest.budget.stopReason = reason;
  }
  if (!topManifest.warnings.includes(reason)) {
    topManifest.warnings.push(reason);
  }
}

function shouldExpandPageType(pageType) {
  return ['home', 'category-page', 'author-list-page', 'history-page', 'search-results-page', 'author-page'].includes(pageType)
    || isContentDetailPageType(pageType);
}

function selectTriggersForPage(pageType, triggers, settings, siteProfile = null, { includeSearchQueries = false } = {}) {
  const selected = [];
  let bookCount = 0;
  let searchResultBookCount = 0;
  let safeNavCount = 0;
  let searchFormCount = 0;
  const sampling = {
    searchResultContentLimit: Number.isFinite(Number(siteProfile?.sampling?.searchResultContentLimit))
      ? Math.max(1, Math.floor(Number(siteProfile.sampling.searchResultContentLimit)))
      : 1,
    authorContentLimit: Number.isFinite(Number(siteProfile?.sampling?.authorContentLimit))
      ? Math.max(1, Math.floor(Number(siteProfile.sampling.authorContentLimit)))
      : 4,
    categoryContentLimit: Number.isFinite(Number(siteProfile?.sampling?.categoryContentLimit))
      ? Math.max(1, Math.floor(Number(siteProfile.sampling.categoryContentLimit)))
      : 4,
    fallbackContentLimitWithSearch: Number.isFinite(Number(siteProfile?.sampling?.fallbackContentLimitWithSearch))
      ? Math.max(1, Math.floor(Number(siteProfile.sampling.fallbackContentLimitWithSearch)))
      : MAX_FALLBACK_BOOKS,
  };
  const isJableSite = String(siteProfile?.host ?? '').toLowerCase() === 'jable.tv';
  const isBilibiliSite = isBilibiliSiteProfile(siteProfile);
  const pageSelectionLimit = (() => {
    if (!isJableSite) {
      return Number.POSITIVE_INFINITY;
    }
    if (isContentDetailPageType(pageType)) {
      return 1;
    }
    if (pageType === 'author-page') {
      return 2;
    }
    if (pageType === 'author-list-page') {
      return 4;
    }
    if (pageType === 'search-results-page') {
      return 4;
    }
    if (['home', 'category-page', 'history-page', 'unknown-page'].includes(pageType)) {
      return 7;
    }
    return 4;
  })();

  const orderedTriggers = (() => {
    if (!isJableSite) {
      return triggers;
    }
    const priorityFor = (trigger) => {
      if (pageType === 'author-list-page') {
        if (trigger.kind === 'safe-nav-link' && trigger.semanticRole === 'author') {
          return 0;
        }
        if (trigger.kind === 'pagination-link') {
          return 1;
        }
        if (trigger.kind === 'safe-nav-link' && trigger.semanticRole === 'category') {
          return 2;
        }
        return 9;
      }
      if (pageType === 'author-page') {
        if (trigger.kind === 'content-link') {
          return 0;
        }
        if (trigger.kind === 'pagination-link') {
          return 1;
        }
        return 9;
      }
      if (pageType === 'search-results-page') {
        if (trigger.kind === 'search-form') {
          return 0;
        }
        if (trigger.kind === 'content-link') {
          return 1;
        }
        if (trigger.kind === 'pagination-link') {
          return 2;
        }
        if (trigger.kind === 'safe-nav-link' && ['category', 'utility', 'home'].includes(trigger.semanticRole)) {
          return 3;
        }
        return 9;
      }
      if (['home', 'category-page', 'history-page', 'unknown-page'].includes(pageType)) {
        if (trigger.kind === 'search-form') {
          return 0;
        }
        if (trigger.kind === 'content-link' && trigger.locator?.primary === 'known-query') {
          return 1;
        }
        if (trigger.kind === 'safe-nav-link' && ['category', 'utility', 'home'].includes(trigger.semanticRole)) {
          return 2;
        }
        if (trigger.kind === 'content-link') {
          return 3;
        }
        if (trigger.kind === 'pagination-link') {
          return 4;
        }
        return 9;
      }
      return 0;
    };
    return [...triggers].sort((left, right) => {
      const priorityDiff = priorityFor(left) - priorityFor(right);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return (left.ordinal ?? 0) - (right.ordinal ?? 0);
    });
  })();

  for (const trigger of orderedTriggers) {
    if (selected.length >= pageSelectionLimit) {
      break;
    }

    if (SAME_DOCUMENT_TRIGGER_KINDS.has(trigger.kind)) {
      selected.push(trigger);
      continue;
    }

    if (isContentDetailPageType(pageType)) {
      if (trigger.kind === 'safe-nav-link' && trigger.semanticRole === 'author') {
        selected.push(trigger);
      }
      continue;
    }

    if (pageType === 'search-results-page') {
      if (trigger.kind === 'content-link') {
        const searchLimit = isBilibiliSite ? 1 : sampling.searchResultContentLimit;
        if (searchResultBookCount >= searchLimit) {
          continue;
        }
        searchResultBookCount += 1;
        selected.push(trigger);
      }
      if (isJableSite && trigger.kind === 'pagination-link') {
        selected.push(trigger);
      }
      continue;
    }

    if (pageType === 'author-page') {
      if (trigger.kind === 'content-link') {
        const authorLimit = isBilibiliSite
          ? 1
          : isJableSite
          ? Math.min(sampling.authorContentLimit, 2)
          : sampling.authorContentLimit;
        if (bookCount >= authorLimit) {
          continue;
        }
        bookCount += 1;
        selected.push(trigger);
      }
      if (isJableSite && trigger.kind === 'pagination-link') {
        selected.push(trigger);
      }
      continue;
    }

    if (pageType === 'author-list-page') {
      if (trigger.kind === 'safe-nav-link' && trigger.semanticRole === 'author') {
        if (safeNavCount >= 4) {
          continue;
        }
        safeNavCount += 1;
        selected.push(trigger);
        continue;
      }
      if (trigger.kind === 'content-link') {
        const authorLimit = isBilibiliSite
          ? 1
          : isJableSite
          ? Math.min(sampling.authorContentLimit, 2)
          : sampling.authorContentLimit;
        if (bookCount >= authorLimit) {
          continue;
        }
        bookCount += 1;
        selected.push(trigger);
        continue;
      }
      if (isJableSite && trigger.kind === 'pagination-link') {
        selected.push(trigger);
      }
      continue;
    }

    if (['home', 'category-page', 'history-page', 'unknown-page'].includes(pageType)) {
      if (trigger.kind === 'search-form') {
        if (includeSearchQueries) {
          if (isJableSite && searchFormCount >= 3) {
            continue;
          }
          searchFormCount += 1;
          selected.push(trigger);
        }
        continue;
      }
        if (trigger.kind === 'content-link') {
          if (
            pageType === 'home'
            && isBilibiliSiteProfile(siteProfile)
            && trigger.locator?.primary === 'known-query'
          ) {
            continue;
          }
          const bookLimit = settings.searchQueries.length > 0
            ? (isJableSite ? Math.min(sampling.fallbackContentLimitWithSearch, 2) : sampling.fallbackContentLimitWithSearch)
            : (isJableSite ? Math.min(sampling.categoryContentLimit, 2) : sampling.categoryContentLimit);
          if (bookCount >= bookLimit) {
            continue;
          }
          bookCount += 1;
          selected.push(trigger);
          continue;
        }
        if (trigger.kind === 'safe-nav-link') {
          if (pageType === 'home' && isBilibiliSiteProfile(siteProfile) && settings.searchQueries.length > 0) {
            continue;
          }
          if (
            settings.searchQueries.length > 0
            && bookCount > 0
            && ['category', 'home'].includes(trigger.semanticRole)
          ) {
            continue;
          }
          if (isJableSite) {
            if (!['category', 'home', 'utility'].includes(trigger.semanticRole)) {
              continue;
            }
            if (safeNavCount >= 2) {
              continue;
            }
            safeNavCount += 1;
          }
          selected.push(trigger);
          continue;
        }
        if (trigger.kind === 'auth-link') {
          selected.push(trigger);
        }
      }
  }

  return selected;
}

async function createExpandSession(settings, inputUrl) {
  if (typeof settings.runtimeFactory === 'function') {
    return await settings.runtimeFactory(settings, {
      inputUrl,
      purpose: 'expand-states',
    });
  }

  const authContext = await resolveSiteBrowserSessionOptions(inputUrl, settings, {
    profilePath: settings.profilePath,
    siteProfile: settings.siteProfile,
  });
  const session = await openBrowserSession({
    ...settings,
    userDataDir: authContext.userDataDir,
    cleanupUserDataDirOnShutdown: authContext.cleanupUserDataDirOnShutdown,
    startupUrl: inputUrl,
  }, {
    userDataDirPrefix: 'expand-states-browser-',
  });
  const shouldEnsureAuth = Boolean(authContext.authConfig)
    && (authContext.reuseLoginState || settings.autoLogin === true || authContext.authConfig.autoLoginByDefault);
  if (shouldEnsureAuth) {
    session.siteAuth = await ensureAuthenticatedSession(session, inputUrl, settings, {
      authContext,
    });
  }
  return session;
}

async function loadSourceContext({
  session,
  context,
  settings,
  siteProfile,
  effectiveSearchQueries,
  topManifest,
}) {
  await navigateAndWaitReady(session, context.sourceUrl, settings, siteProfile);
  const sourceSignature = await collectStateSignature(session, siteProfile);
  const sourceFingerprintJson = JSON.stringify(sourceSignature.fingerprint);
  const discoveryLimit = isContentDetailPageType(sourceSignature.pageType)
    ? 1_000
    : Math.max(settings.maxTriggers, settings.maxTriggers + effectiveSearchQueries.length);
  const discoveredTriggers = await discoverPageTriggers(
    session,
    discoveryLimit,
    context.includeSearchQueries ? effectiveSearchQueries : [],
    siteProfile,
  );
  const mergedTriggers = mergeDiscoveredTriggers(
    discoveredTriggers,
    buildPageFactsSyntheticTriggers(sourceSignature.pageType, sourceSignature.pageFacts),
  );
  topManifest.summary.discoveredTriggers += mergedTriggers.length;

  return {
    ...context,
    pageType: sourceSignature.pageType,
    sourceSignature,
    sourceFingerprintJson,
    discoveredTriggers: mergedTriggers,
    triggers: selectTriggersForPage(
      sourceSignature.pageType,
      mergedTriggers,
      settings,
      siteProfile,
      { includeSearchQueries: context.includeSearchQueries },
    ),
  };
}

export async function expandStates(inputUrl, options = {}) {
  const settings = mergeOptions(options);
  const { manifest: initialManifest } = await resolveInitialManifest(settings);
  const baseUrl = initialManifest.finalUrl || inputUrl;
  const layout = await createExpandOutputLayout(baseUrl, inputUrl, settings.outDir);
  const topManifest = buildTopLevelManifest(inputUrl, baseUrl, layout);
  topManifest.budget = createBudgetState(settings);

  let session = null;
  let stateCounter = 1;

  try {
    session = await createExpandSession(settings, inputUrl);
    const siteProfile = await loadSiteProfile(baseUrl, settings.profilePath, settings.siteProfile);
    const effectiveSearchQueries = settings.searchQueries.length > 0
      ? mergeStringArrays(settings.searchQueries)
      : mergeStringArrays(siteProfile?.search?.defaultQueries);
    await navigateAndWaitReady(session, baseUrl, settings, siteProfile);

    const liveInitialSignature = await collectStateSignature(session, siteProfile);
    const initialDedupKey = hashFingerprint(liveInitialSignature.fingerprint);

    if (normalizeUrlNoFragment(initialManifest.finalUrl) !== normalizeUrlNoFragment(liveInitialSignature.finalUrl)) {
      topManifest.warnings.push(
        `Initial evidence finalUrl differs from live DOM: evidence=${initialManifest.finalUrl} live=${liveInitialSignature.finalUrl}`,
      );
    }
    if (initialManifest.title !== liveInitialSignature.title) {
      topManifest.warnings.push(
        `Initial evidence title differs from live DOM: evidence=${initialManifest.title} live=${liveInitialSignature.title}`,
      );
    }

    const initialStateManifest = await copyInitialState(initialManifest, layout, initialDedupKey);
    topManifest.states.push(topLevelStateEntryFromManifest(initialStateManifest));

    const capturedDedupKeys = new Map([[initialDedupKey, 's0000']]);
    const expansionQueue = [
      {
        stateId: 's0000',
        sourceUrl: baseUrl,
        includeSearchQueries: true,
      },
    ];
    const expandedStates = new Set();

    while (expansionQueue.length > 0) {
      if (topManifest.summary.capturedStates >= settings.maxCapturedStates) {
        markBudgetStop(
          topManifest,
          `Expansion stopped after reaching maxCapturedStates=${settings.maxCapturedStates}`,
        );
        break;
      }

      const context = expansionQueue.shift();
      if (!context || expandedStates.has(context.stateId)) {
        continue;
      }
      expandedStates.add(context.stateId);

      const sourceContext = await loadSourceContext({
        session,
        context,
        settings,
        siteProfile,
        effectiveSearchQueries,
        topManifest,
      });

      let restoreSourceBeforeNextTrigger = false;
      for (let triggerIndex = 0; triggerIndex < sourceContext.triggers.length; triggerIndex += 1) {
        if (topManifest.summary.capturedStates >= settings.maxCapturedStates) {
          markBudgetStop(
            topManifest,
            `Expansion stopped after reaching maxCapturedStates=${settings.maxCapturedStates}`,
          );
          break;
        }

        const trigger = sourceContext.triggers[triggerIndex];
        const nextTrigger = sourceContext.triggers[triggerIndex + 1] ?? null;
        topManifest.summary.attemptedTriggers += 1;
        const stateId = nextStateId(stateCounter);
        stateCounter += 1;
        const stateName = buildStateName(trigger);
        const attemptedAt = new Date().toISOString();

        try {
          if (restoreSourceBeforeNextTrigger) {
            await navigateAndWaitReady(session, context.sourceUrl, settings, siteProfile);
            restoreSourceBeforeNextTrigger = false;
          }

          const executeResult = await executeTrigger(session, trigger, siteProfile, settings);
          if (!executeResult?.clicked) {
            topManifest.summary.failedTriggers += 1;
            topManifest.states.push(
              createStateIndexEntry({
                stateId,
                fromState: context.stateId,
                stateName,
                dedupKey: null,
                trigger,
                finalUrl: context.sourceUrl,
                title: null,
                capturedAt: attemptedAt,
                status: 'failed',
                error: createError('TRIGGER_NOT_FOUND', executeResult?.reason || 'Trigger could not be resolved'),
              }),
            );
            continue;
          }

          await waitForPostTriggerSettled(session, settings, trigger, executeResult, siteProfile, context.sourceUrl);
          await ensureSiteSpecificReadyMarkers(session, siteProfile, executeResult?.navigationUrl || context.sourceUrl);

          const postSignature = await collectStateSignature(session, siteProfile);
          const dedupKey = hashFingerprint(postSignature.fingerprint);
          const postFingerprintJson = JSON.stringify(postSignature.fingerprint);
          const changedFromSource = postFingerprintJson !== sourceContext.sourceFingerprintJson;
          restoreSourceBeforeNextTrigger = changedFromSource && Boolean(nextTrigger && requiresSourceDom(nextTrigger));

          if (!changedFromSource) {
            topManifest.summary.noopTriggers += 1;
            topManifest.states.push(
              createStateIndexEntry({
                stateId,
                fromState: context.stateId,
                stateName,
                dedupKey,
                trigger,
                finalUrl: postSignature.finalUrl,
                title: postSignature.title,
                capturedAt: attemptedAt,
                status: 'noop',
                pageFacts: postSignature.pageFacts ?? null,
                error: null,
              }),
            );
            continue;
          }

          if (capturedDedupKeys.has(dedupKey)) {
            topManifest.summary.duplicateStates += 1;
            topManifest.states.push(
              createStateIndexEntry({
                stateId,
                fromState: context.stateId,
                stateName,
                dedupKey,
                trigger,
                finalUrl: postSignature.finalUrl,
                title: postSignature.title,
                capturedAt: attemptedAt,
                status: 'duplicate',
                duplicateOf: capturedDedupKeys.get(dedupKey),
                pageFacts: postSignature.pageFacts ?? null,
                error: null,
              }),
            );
            continue;
          }

          const stateDir = path.join(layout.statesDir, `${stateId}_${slugify(stateName, stateId)}`);
          const stateManifest = await captureCurrentState({
            session,
            inputUrl,
            stateId,
            fromState: context.stateId,
            stateName,
            dedupKey,
            trigger,
            stateDir,
            pageMetadata: postSignature,
            settings,
            siteProfile,
          });

          if (stateManifest.status === 'captured') {
            topManifest.summary.capturedStates += 1;
            capturedDedupKeys.set(dedupKey, stateId);
            if (topManifest.summary.capturedStates >= settings.maxCapturedStates) {
              markBudgetStop(
                topManifest,
                `Expansion stopped after reaching maxCapturedStates=${settings.maxCapturedStates}`,
              );
              topManifest.states.push(topLevelStateEntryFromManifest(stateManifest));
              break;
            } else if (shouldExpandPageType(postSignature.pageType)) {
              expansionQueue.push({
                stateId,
                sourceUrl: postSignature.finalUrl,
                includeSearchQueries: false,
              });
            }
          } else {
            topManifest.summary.failedTriggers += 1;
          }

          topManifest.states.push(topLevelStateEntryFromManifest(stateManifest));
        } catch (error) {
          restoreSourceBeforeNextTrigger = Boolean(nextTrigger && requiresSourceDom(nextTrigger));
          topManifest.summary.failedTriggers += 1;
          topManifest.states.push(
            createStateIndexEntry({
              stateId,
              fromState: context.stateId,
              stateName,
              dedupKey: null,
              trigger,
              finalUrl: context.sourceUrl,
              title: null,
              capturedAt: attemptedAt,
              status: 'failed',
              error: createError('TRIGGER_EXECUTION_FAILED', error.message),
            }),
          );
        }
      }
    }

    await writeTopLevelManifest(layout.manifestPath, topManifest);
    return topManifest;
  } catch (error) {
    topManifest.warnings.push(`Expansion failed: ${error.message}`);
    await writeTopLevelManifest(layout.manifestPath, topManifest);
    throw error;
  } finally {
    await session?.close?.();
  }
}

function parseCliArgs(argv) {
  const args = [...argv];
  const options = {};
  let url = null;

  const readValue = (current, index) => {
    const eqIndex = current.indexOf('=');
    if (eqIndex !== -1) {
      return { value: current.slice(eqIndex + 1), nextIndex: index };
    }
    if (index + 1 >= args.length) {
      throw new Error(`Missing value for ${current}`);
    }
    return { value: args[index + 1], nextIndex: index + 1 };
  };

  const readOptionalBooleanValue = (current, index) => {
    const eqIndex = current.indexOf('=');
    if (eqIndex !== -1) {
      return { value: current.slice(eqIndex + 1), nextIndex: index };
    }
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      return { value: next, nextIndex: index + 1 };
    }
    return { value: true, nextIndex: index };
  };

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith('--')) {
      if (url) {
        throw new Error(`Unexpected positional argument: ${current}`);
      }
      url = current;
      continue;
    }

    if (current === '--help' || current === '-h') {
      options.help = true;
      continue;
    }

    if (current.startsWith('--initial-manifest')) {
      const { value, nextIndex } = readValue(current, index);
      options.initialManifestPath = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--initial-dir')) {
      const { value, nextIndex } = readValue(current, index);
      options.initialEvidenceDir = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--out-dir')) {
      const { value, nextIndex } = readValue(current, index);
      options.outDir = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--browser-path')) {
      const { value, nextIndex } = readValue(current, index);
      options.browserPath = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--profile-path')) {
      const { value, nextIndex } = readValue(current, index);
      options.profilePath = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--browser-profile-root')) {
      const { value, nextIndex } = readValue(current, index);
      options.browserProfileRoot = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--user-data-dir')) {
      const { value, nextIndex } = readValue(current, index);
      options.userDataDir = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--timeout')) {
      const { value, nextIndex } = readValue(current, index);
      options.timeoutMs = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--wait-until')) {
      const { value, nextIndex } = readValue(current, index);
      options.waitUntil = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--idle-ms')) {
      const { value, nextIndex } = readValue(current, index);
      options.idleMs = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--max-triggers')) {
      const { value, nextIndex } = readValue(current, index);
      options.maxTriggers = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--max-captured-states')) {
      const { value, nextIndex } = readValue(current, index);
      options.maxCapturedStates = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--search-query')) {
      const { value, nextIndex } = readValue(current, index);
      options.searchQueries = [...normalizeStringArray(options.searchQueries), value];
      index = nextIndex;
      continue;
    }

    if (current === '--full-page' || current.startsWith('--full-page=')) {
      const { value, nextIndex } = readOptionalBooleanValue(current, index);
      options.fullPage = value;
      index = nextIndex;
      continue;
    }

    if (current === '--no-full-page') {
      options.fullPage = false;
      continue;
    }

    if (current === '--headless' || current.startsWith('--headless=')) {
      const { value, nextIndex } = readOptionalBooleanValue(current, index);
      options.headless = value;
      index = nextIndex;
      continue;
    }

    if (current === '--no-headless') {
      options.headless = false;
      continue;
    }

    if (current === '--reuse-login-state' || current.startsWith('--reuse-login-state=')) {
      const { value, nextIndex } = readOptionalBooleanValue(current, index);
      options.reuseLoginState = value;
      index = nextIndex;
      continue;
    }

    if (current === '--no-reuse-login-state') {
      options.reuseLoginState = false;
      continue;
    }

    if (current === '--auto-login' || current.startsWith('--auto-login=')) {
      const { value, nextIndex } = readOptionalBooleanValue(current, index);
      options.autoLogin = value;
      index = nextIndex;
      continue;
    }

    if (current === '--no-auto-login') {
      options.autoLogin = false;
      continue;
    }

    throw new Error(`Unknown option: ${current}`);
  }

  return { url, options };
}

function printHelp() {
  const helpText = `Usage:
  node expand-states.mjs <url> --initial-manifest <path> [options]
  node expand-states.mjs <url> --initial-dir <dir> [options]

Options:
  --initial-manifest <path> Initial capture manifest.json path
  --initial-dir <path>      Initial capture directory containing manifest.json
  --out-dir <path>          Output root directory
  --browser-path <path>     Explicit Chromium/Chrome executable path
  --profile-path <path>     Explicit site profile for auth/session defaults
  --browser-profile-root <path> Root directory for persistent browser profiles
  --user-data-dir <path>    Explicit Chromium user-data-dir to reuse
  --timeout <ms>            Overall timeout for CDP operations
  --wait-until <mode>       load | networkidle
  --idle-ms <ms>            Extra delay after readiness before capture
  --max-triggers <n>        Maximum discovered triggers to expand
  --max-captured-states <n> Maximum additional captured states beyond the initial state
  --search-query <text>     Repeatable search query seed injected into site search
  --full-page               Force full-page screenshot
  --no-full-page            Disable full-page screenshot
  --reuse-login-state       Reuse a persistent per-site browser profile
  --no-reuse-login-state    Disable persistent login-state reuse
  --auto-login              Best-effort credential login when credentials exist
  --no-auto-login           Disable credential auto-login
  --headless                Run browser headless (default)
  --no-headless             Run browser with a visible window
  --help                    Show this help
`;

  process.stdout.write(helpText);
}

async function runCli() {
  initializeCliUtf8();
  try {
    const { url, options } = parseCliArgs(process.argv.slice(2));
    if (options.help || !url) {
      printHelp();
      process.exitCode = options.help ? 0 : 1;
      return;
    }

    const manifest = await expandStates(url, options);
    process.stdout.write(`${JSON.stringify(summarizeForStdout(manifest), null, 2)}\n`);
    if (manifest.summary.failedTriggers > 0 && manifest.summary.capturedStates === 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

const isCliEntrypoint = (() => {
  if (!process.argv[1]) {
    return false;
  }
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
})();

if (isCliEntrypoint) {
  await runCli();
}
