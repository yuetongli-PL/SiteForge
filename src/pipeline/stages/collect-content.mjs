import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initializeCliUtf8 } from '../../infra/cli.mjs';
import { ensureDir, firstExistingPath, pathExists, readJsonFile, writeJsonFile, writeTextFile } from '../../infra/io.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_OPTIONS = {
  expandedStatesDir: undefined,
  outDir: path.resolve(process.cwd(), 'book-content'),
  searchQueries: [],
  maxFallbackBooks: 3,
  chapterPageLimit: 20,
  requestTimeoutMs: 30_000,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  targetBookTitle: undefined,
  targetBookUrl: undefined,
  skipFallback: false,
};

const EXPANDED_MANIFEST_NAMES = ['states-manifest.json', 'state-manifest.json', 'expanded-states-manifest.json'];

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function normalizeText(value) {
  return normalizeWhitespace(String(value ?? '').normalize('NFKC'));
}

function normalizeUrlNoFragment(input) {
  if (!input) {
    return null;
  }
  try {
    const parsed = new URL(String(input));
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(input).split('#')[0];
  }
}

function slugifyAscii(value, fallback = 'item') {
  const slug = normalizeText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return slug || fallback;
}

function sanitizeHost(host) {
  return (host || 'unknown-host').replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unknown-host';
}

function hostBookContentRoot(rootDir, host) {
  const resolved = path.resolve(rootDir);
  const hostSlug = sanitizeHost(host);
  return path.basename(resolved) === hostSlug ? resolved : path.join(resolved, hostSlug);
}

function formatTimestampForDir(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1Z');
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueSortedStrings(values) {
  return [...new Set(toArray(values).map((value) => String(value)).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
}

function compareNullableStrings(left, right) {
  return String(left ?? '').localeCompare(String(right ?? ''), 'zh-Hans-CN');
}

function createSha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'')
    .replace(/&apos;/gi, '\'')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function stripHtml(value) {
  return normalizeText(
    decodeHtmlEntities(
      String(value ?? '')
        .replace(/<script[\s\S]*?<\/script>/giu, ' ')
        .replace(/<style[\s\S]*?<\/style>/giu, ' ')
        .replace(/<br\s*\/?>/giu, '\n')
        .replace(/<\/p>/giu, '\n')
        .replace(/<\/div>/giu, '\n')
        .replace(/<[^>]+>/gu, ' ')
    )
  );
}

function resolveUrl(value, baseUrl) {
  if (!value) {
    return null;
  }
  try {
    return new URL(String(value), baseUrl).toString();
  } catch {
    return null;
  }
}

function chapterBaseUrl(input) {
  const normalized = normalizeUrlNoFragment(input);
  return normalized ? normalized.replace(/_(\d+)(\.html)$/i, '$2') : null;
}

function isSameChapterChain(left, right) {
  const leftBase = chapterBaseUrl(left);
  const rightBase = chapterBaseUrl(right);
  return Boolean(leftBase && rightBase && leftBase === rightBase);
}

async function loadSiteProfile(inputUrl) {
  try {
    const parsed = new URL(inputUrl);
    const profilePath = path.join(MODULE_DIR, 'profiles', `${parsed.hostname}.json`);
    if (!await pathExists(profilePath)) {
      return null;
    }
    return await readJsonFile(profilePath);
  } catch {
    return null;
  }
}

function mergeOptions(inputUrl, options = {}) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  merged.outDir = path.resolve(merged.outDir);
  if (merged.expandedStatesDir) {
    merged.expandedStatesDir = path.resolve(merged.expandedStatesDir);
  }
  merged.searchQueries = uniqueSortedStrings(toArray(merged.searchQueries).map((value) => normalizeText(value)));
  merged.maxFallbackBooks = Number(merged.maxFallbackBooks);
  merged.chapterPageLimit = Number(merged.chapterPageLimit);
  merged.requestTimeoutMs = Number(merged.requestTimeoutMs);
  merged.targetBookTitle = normalizeText(merged.targetBookTitle);
  merged.targetBookUrl = normalizeUrlNoFragment(merged.targetBookUrl);
  merged.skipFallback = Boolean(merged.skipFallback);
  merged.baseUrl = normalizeUrlNoFragment(inputUrl);
  return merged;
}

async function fetchHtml(url, settings, { method = 'GET', body = undefined } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.requestTimeoutMs);
  try {
    const response = await fetch(url, {
      method,
      body,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': settings.userAgent,
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
    });
    const text = await response.text();
    return {
      status: response.status,
      finalUrl: response.url,
      html: text,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractMetaContent(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'iu'),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'iu'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`, 'iu'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["'][^>]*>`, 'iu'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return normalizeText(decodeHtmlEntities(match[1]));
    }
  }
  return null;
}

function extractTitle(html) {
  const match = html.match(/<title>([\s\S]*?)<\/title>/iu);
  return match?.[1] ? normalizeText(decodeHtmlEntities(match[1])) : null;
}

function extractFirstTextByRegex(html, regexes) {
  for (const regex of regexes) {
    const match = html.match(regex);
    if (match?.[1]) {
      const text = stripHtml(match[1]);
      if (text) {
        return text;
      }
    }
  }
  return null;
}

function extractAnchors(html, baseUrl) {
  const anchors = [];
  const pattern = /<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/giu;
  let match = pattern.exec(html);
  while (match) {
    const href = resolveUrl(match[2], baseUrl);
    if (href) {
      anchors.push({
        href,
        text: stripHtml(match[4]),
        attrs: `${match[1]} ${match[3]}`,
      });
    }
    match = pattern.exec(html);
  }
  return anchors;
}

function extractSearchResults(html, baseUrl) {
  const titleText = extractFirstTextByRegex(html, [
    /<h2[^>]*class=["'][^"']*layout-tit[^"']*["'][^>]*>([\s\S]*?)<\/h2>/iu,
  ]) || '';
  const queryMatch = titleText.match(/搜索["“]?(.+?)["”]?\s+共有/i);
  const countMatch = titleText.match(/共有\s*["“]?(\d+)["”]?\s*个结果/i);
  const results = [];
  const itemPattern = /<li>\s*<span class="s1">([\s\S]*?)<\/span>\s*<span class="s2">\s*<a href="([^"]+)">([\s\S]*?)<\/a>\s*<\/span>\s*<span class="s3">[\s\S]*?<\/span>\s*<span class="s4">([\s\S]*?)<\/span>\s*<span class="s5">([\s\S]*?)<\/span>\s*<\/li>/giu;
  let itemMatch = itemPattern.exec(html);
  while (itemMatch) {
    results.push({
      category: stripHtml(itemMatch[1]),
      title: stripHtml(itemMatch[3]),
      url: resolveUrl(itemMatch[2], baseUrl),
      authorName: stripHtml(itemMatch[4]),
      updatedAt: stripHtml(itemMatch[5]),
    });
    itemMatch = itemPattern.exec(html);
  }
  return {
    queryText: normalizeText(queryMatch?.[1] || ''),
    resultCount: countMatch?.[1] ? Number(countMatch[1]) : results.length,
    results: results.filter((item) => item.url && item.title),
  };
}

function extractBalancedElementInnerHtml(html, tokenPattern) {
  const tokenRegex = new RegExp(tokenPattern, 'iu');
  const startMatch = tokenRegex.exec(html);
  if (!startMatch) {
    return null;
  }
  const startIndex = startMatch.index;
  const openStart = html.lastIndexOf('<div', startIndex);
  if (openStart < 0) {
    return null;
  }
  const openEnd = html.indexOf('>', openStart);
  if (openEnd < 0) {
    return null;
  }
  let depth = 1;
  let cursor = openEnd + 1;
  const tagRegex = /<\/?div\b[^>]*>/giu;
  tagRegex.lastIndex = cursor;
  let match = tagRegex.exec(html);
  while (match) {
    const tag = match[0].toLowerCase();
    if (tag.startsWith('</div')) {
      depth -= 1;
      if (depth === 0) {
        return html.slice(openEnd + 1, match.index);
      }
    } else {
      depth += 1;
    }
    match = tagRegex.exec(html);
  }
  return null;
}

function extractBookDetail(html, finalUrl) {
  const title = extractTitle(html);
  const bookTitle = extractMetaContent(html, 'og:novel:book_name')
    || extractFirstTextByRegex(html, [
      /<h1[^>]*>([\s\S]*?)<\/h1>/iu,
    ])
    || title?.replace(/\(.+$/, '')
    || null;
  const authorName = extractMetaContent(html, 'og:novel:author')
    || extractFirstTextByRegex(html, [
      /浣滆€匸:锛歖\s*<\/span>\s*<a[^>]*>([\s\S]*?)<\/a>/iu,
      /<a[^>]+href=["'][^"']*\/author\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/iu,
    ]);
  const authorUrl = resolveUrl(
    extractMetaContent(html, 'og:novel:author_link')
      || (html.match(/<a[^>]+href=["']([^"']*\/author\/[^"']*)["'][^>]*>[\s\S]*?<\/a>/iu)?.[1] ?? ''),
    finalUrl,
  );
  const latestChapterUrl = resolveUrl(extractMetaContent(html, 'og:novel:lastest_chapter_url'), finalUrl);
  const chapterAnchors = extractAnchors(html, finalUrl)
    .filter((anchor) => /\/biqu\d+\/\d+\.html$/i.test(anchor.href))
    .filter((anchor) => anchor.text && !/^涓婁竴绔爘涓嬩竴绔爘杩斿洖鐩綍$/u.test(anchor.text));
  const seen = new Set();
  const chapters = [];
  for (const anchor of chapterAnchors) {
    if (seen.has(anchor.href)) {
      continue;
    }
    seen.add(anchor.href);
    chapters.push({
      href: anchor.href,
      title: anchor.text,
      chapterIndex: chapters.length + 1,
    });
  }
  return {
    finalUrl,
    title,
    bookTitle,
    authorName,
    authorUrl,
    latestChapterUrl,
    chapterCount: chapters.length,
    chapters,
  };
}

function extractChapterContent(html) {
  return extractBalancedElementInnerHtml(html, 'id=["\']content["\']')
    || extractBalancedElementInnerHtml(html, 'class=["\'][^"\']*content[^"\']*["\']');
}

function extractChapterPayload(html, finalUrl) {
  const chapterTitle = extractFirstTextByRegex(html, [
    /<h1[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/iu,
    /<div[^>]*class=["'][^"']*content_read[^"']*["'][^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/iu,
    /<h1[^>]*>([\s\S]*?)<\/h1>/iu,
  ]) || extractTitle(html);
  const contentHtml = extractChapterContent(html) || '';
  const contentText = stripHtml(
    contentHtml
      .replace(/<\/?(?:p|div|br|hr)\b[^>]*>/giu, '\n')
      .replace(/(?:涓婁竴绔爘涓嬩竴绔爘鍔犲叆涔︾|杩斿洖鐩綍|鎶曟帹鑽愮エ|绔犺妭鎶ラ敊)/gu, ' ')
  );
  const prevChapterUrl = resolveUrl(html.match(/id=["']prev_url["'][^>]+href=["']([^"']+)["']/iu)?.[1] ?? '', finalUrl);
  const nextChapterUrl = resolveUrl(html.match(/id=["']next_url["'][^>]+href=["']([^"']+)["']/iu)?.[1] ?? '', finalUrl);
  const bookTitle = extractFirstTextByRegex(html, [
    /<a[^>]+href=["'][^"']*\/biqu\d+\/["'][^>]*>([\s\S]*?)<\/a>/iu,
  ]);
  const authorName = extractMetaContent(html, 'og:novel:author');
  return {
    finalUrl,
    chapterTitle,
    bookTitle,
    authorName,
    prevChapterUrl,
    nextChapterUrl,
    contentText,
    contentLength: contentText.length,
  };
}

function buildBookId(url) {
  return `book_${createSha256(url).slice(0, 12)}`;
}

function buildAuthorId(url, name) {
  return `author_${createSha256(url || name || 'unknown-author').slice(0, 12)}`;
}

async function loadExpandedBookSeeds(expandedStatesDir) {
  if (!expandedStatesDir || !await pathExists(expandedStatesDir)) {
    return [];
  }
  const manifestPath = await firstExistingPath(EXPANDED_MANIFEST_NAMES.map((name) => path.join(expandedStatesDir, name)));
  if (!manifestPath) {
    return [];
  }
  const manifest = await readJsonFile(manifestPath);
  const seeds = [];
  for (const state of toArray(manifest.states)) {
    const finalUrl = normalizeUrlNoFragment(state.finalUrl);
    if (!/\/biqu\d+\/?$/i.test(finalUrl || '')) {
      continue;
    }
    const title = normalizeText(state.pageFacts?.bookTitle || state.title || state.trigger?.label || '');
    seeds.push({
      queryText: null,
      title: title || finalUrl,
      url: finalUrl,
      authorName: normalizeText(state.pageFacts?.authorName || ''),
      source: 'expanded',
    });
  }
  const seen = new Set();
  return seeds.filter((seed) => {
    const key = seed.url;
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function bookTitlesMatch(left, right) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return normalizedLeft === normalizedRight || normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function buildSyntheticTargetSeed(settings) {
  if (!settings.targetBookUrl) {
    return null;
  }
  return {
    queryText: settings.targetBookTitle || null,
    title: settings.targetBookTitle || settings.targetBookUrl,
    url: settings.targetBookUrl,
    authorName: '',
    source: 'target-book-url',
  };
}

function selectSeedsForCollection(matchedSeeds, fallbackSeeds, settings) {
  const targetTitle = settings.targetBookTitle;
  const targetUrl = settings.targetBookUrl;
  const combinedSeeds = [...matchedSeeds, ...(settings.skipFallback ? [] : fallbackSeeds)];

  if (targetUrl) {
    const exactUrlSeed = combinedSeeds.find((seed) => normalizeUrlNoFragment(seed.url) === targetUrl);
    return exactUrlSeed ? [exactUrlSeed] : [buildSyntheticTargetSeed(settings)].filter(Boolean);
  }

  if (targetTitle) {
    const matchedByTitle = matchedSeeds.filter((seed) => bookTitlesMatch(seed.title, targetTitle));
    if (matchedByTitle.length > 0) {
      return matchedByTitle;
    }
    if (!settings.skipFallback) {
      const fallbackByTitle = fallbackSeeds.filter((seed) => bookTitlesMatch(seed.title, targetTitle));
      if (fallbackByTitle.length > 0) {
        return fallbackByTitle;
      }
    }
    return [];
  }

  return combinedSeeds;
}

async function searchBooks(queryText, baseUrl, settings, siteProfile) {
  const normalizedQuery = normalizeText(queryText);
  const knownQueries = toArray(siteProfile?.search?.knownQueries);
  const exactKnown = knownQueries.find((entry) => normalizeText(entry?.query) === normalizedQuery);
  if (exactKnown?.url) {
    return {
      queryText: normalizedQuery,
      resultCount: 1,
      results: [
        {
          title: normalizeText(exactKnown.title || exactKnown.query),
          url: normalizeUrlNoFragment(exactKnown.url),
          authorName: normalizeText(exactKnown.authorName || ''),
          category: normalizeText(exactKnown.category || ''),
          updatedAt: normalizeText(exactKnown.updatedAt || ''),
          source: 'known-query',
        },
      ],
      source: 'known-query',
      searchUrl: normalizeUrlNoFragment(exactKnown.url),
    };
  }

  const postBody = new URLSearchParams({ searchkey: normalizedQuery }).toString();
  const response = await fetchHtml(resolveUrl('/ss/', baseUrl), settings, {
    method: 'POST',
    body: postBody,
  });
  const parsed = extractSearchResults(response.html, response.finalUrl);
  return {
    ...parsed,
    queryText: parsed.queryText || normalizedQuery,
    source: 'post-search',
    searchUrl: response.finalUrl,
  };
}

async function fetchAuthorPage(authorUrl, settings) {
  if (!authorUrl) {
    return null;
  }
  const response = await fetchHtml(authorUrl, settings);
  return {
    finalUrl: response.finalUrl,
    title: extractTitle(response.html),
    authorName: extractMetaContent(response.html, 'og:novel:author')
      || extractFirstTextByRegex(response.html, [
        /<h1[^>]*>([\s\S]*?)<\/h1>/iu,
      ]),
    html: response.html,
  };
}

async function fetchChapterChain(chapterUrl, settings) {
  const pages = [];
  const chunks = [];
  let currentUrl = normalizeUrlNoFragment(chapterUrl);
  const seen = new Set();
  for (let index = 0; currentUrl && index < settings.chapterPageLimit; index += 1) {
    if (seen.has(currentUrl)) {
      break;
    }
    seen.add(currentUrl);
    const response = await fetchHtml(currentUrl, settings);
    const payload = extractChapterPayload(response.html, response.finalUrl);
    pages.push({
      url: payload.finalUrl,
      title: payload.chapterTitle,
      contentLength: payload.contentLength,
    });
    if (payload.contentText) {
      chunks.push(payload.contentText);
    }
    if (!payload.nextChapterUrl || !isSameChapterChain(payload.finalUrl, payload.nextChapterUrl)) {
      return {
        pages,
        fullText: chunks.join('\n\n').trim(),
        chapterTitle: payload.chapterTitle,
        bookTitle: payload.bookTitle,
        authorName: payload.authorName,
        finalUrl: payload.finalUrl,
      };
    }
    currentUrl = normalizeUrlNoFragment(payload.nextChapterUrl);
  }
  const finalPage = pages.at(-1) ?? null;
  return {
    pages,
    fullText: chunks.join('\n\n').trim(),
    chapterTitle: finalPage?.title ?? null,
    bookTitle: null,
    authorName: null,
    finalUrl: finalPage?.url ?? normalizeUrlNoFragment(chapterUrl),
  };
}

async function collectBookPayload(seed, settings, outputs) {
  const detailResponse = await fetchHtml(seed.url, settings);
  const detail = extractBookDetail(detailResponse.html, detailResponse.finalUrl);
  const bookId = buildBookId(detail.finalUrl);
  const bookDir = path.join(outputs.booksDir, slugifyAscii(detail.bookTitle || bookId, bookId));
  const author = await fetchAuthorPage(detail.authorUrl, settings);
  const authorId = buildAuthorId(detail.authorUrl, detail.authorName);

  const chapters = [];
  const downloadChunks = [];
  for (const chapter of detail.chapters) {
    const chain = await fetchChapterChain(chapter.href, settings);
    chapters.push({
      chapterIndex: chapter.chapterIndex,
      href: chapter.href,
      title: chain.chapterTitle || chapter.title,
      pageCount: chain.pages.length,
      finalUrl: chain.finalUrl,
      bodyTextLength: chain.fullText.length,
    });
    if (chain.fullText) {
      downloadChunks.push(`# ${chain.chapterTitle || chapter.title}\n\n${chain.fullText}`);
    }
  }

  const bookRecord = {
    bookId,
    queryText: seed.queryText,
    source: seed.source,
    finalUrl: detail.finalUrl,
    title: detail.bookTitle,
    authorName: detail.authorName,
    authorUrl: detail.authorUrl,
    authorId: detail.authorUrl || detail.authorName ? authorId : null,
    latestChapterUrl: detail.latestChapterUrl,
    chapterCount: detail.chapterCount,
    chaptersFile: path.join(bookDir, 'chapters.json'),
    downloadFile: path.join(outputs.downloadsDir, `${slugifyAscii(detail.bookTitle || bookId, bookId)}.txt`),
    bookFile: path.join(bookDir, 'book.json'),
    authorFile: author ? path.join(bookDir, 'author.json') : null,
  };

  await writeJsonFile(bookRecord.bookFile, {
    ...bookRecord,
    detailPageTitle: detail.title,
  });
  await writeJsonFile(bookRecord.chaptersFile, chapters);
  if (author) {
    await writeJsonFile(bookRecord.authorFile, {
      authorId,
      authorName: author.authorName || detail.authorName,
      finalUrl: author.finalUrl,
      title: author.title,
    });
  }
  const downloadHeaderLines = [
    `# ${detail.bookTitle || 'Untitled Book'}`,
    '',
    detail.authorName ? `作者：${detail.authorName}` : null,
    detail.authorUrl ? `作者页：${detail.authorUrl}` : null,
    '',
  ].filter(Boolean);
  await writeTextFile(bookRecord.downloadFile, [...downloadHeaderLines, ...downloadChunks].join('\n'));

  return {
    ...bookRecord,
    chapters,
    author,
  };
}

function summarizeStdout(manifest) {
  return {
    books: manifest.summary.books,
    authors: manifest.summary.authors,
    chapters: manifest.summary.chapters,
    matchedQueries: manifest.summary.matchedQueries,
    noResultQueries: manifest.summary.noResultQueries,
    outDir: manifest.outDir,
  };
}

async function createOutputLayout(baseUrl, rootOutDir) {
  const generatedAt = new Date().toISOString();
  const host = (() => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return 'unknown-host';
    }
  })();
  const hostRoot = hostBookContentRoot(rootOutDir, host);
  const outDir = path.join(hostRoot, `${formatTimestampForDir(new Date(generatedAt))}_${sanitizeHost(host)}_book-content`);
  const booksDir = path.join(outDir, 'books');
  const downloadsDir = path.join(outDir, 'downloads');
  await ensureDir(booksDir);
  await ensureDir(downloadsDir);
  return {
    generatedAt,
    outDir,
    booksDir,
    downloadsDir,
    manifestPath: path.join(outDir, 'book-content-manifest.json'),
    booksPath: path.join(outDir, 'books.json'),
    authorsPath: path.join(outDir, 'authors.json'),
    searchResultsPath: path.join(outDir, 'search-results.json'),
  };
}

export async function collectBookContent(inputUrl, options = {}) {
  const settings = mergeOptions(inputUrl, options);
  const baseUrl = settings.baseUrl;
  const siteProfile = await loadSiteProfile(baseUrl);
  const outputs = await createOutputLayout(baseUrl, settings.outDir);

  const searchResults = [];
  for (const queryText of settings.searchQueries) {
    searchResults.push(await searchBooks(queryText, baseUrl, settings, siteProfile));
  }

  const matchedSeeds = searchResults.flatMap((result) => result.results.map((item) => ({
    queryText: result.queryText,
    title: item.title,
    url: item.url,
    authorName: item.authorName,
    source: result.source,
  })));
  const noResultQueries = searchResults.filter((result) => (result.resultCount ?? 0) === 0).map((result) => result.queryText);

  const fallbackSeeds = settings.skipFallback
    ? []
    : (await loadExpandedBookSeeds(settings.expandedStatesDir)).slice(0, settings.maxFallbackBooks);
  const selectedSeeds = selectSeedsForCollection(matchedSeeds, fallbackSeeds, settings);
  const seedMap = new Map();
  for (const seed of selectedSeeds) {
    const key = normalizeUrlNoFragment(seed.url);
    if (!key || seedMap.has(key)) {
      continue;
    }
    seedMap.set(key, { ...seed, url: key });
  }

  const books = [];
  const authors = [];
  for (const seed of seedMap.values()) {
    const book = await collectBookPayload(seed, settings, outputs);
    books.push(book);
    if (book.author) {
      authors.push({
        authorId: book.authorId,
        authorName: book.author.authorName || book.authorName,
        finalUrl: book.author.finalUrl,
        title: book.author.title,
        books: [book.title],
      });
    }
  }

  const authorMap = new Map();
  for (const author of authors) {
    const key = author.finalUrl || author.authorName;
    const current = authorMap.get(key);
    if (!current) {
      authorMap.set(key, author);
      continue;
    }
    current.books = uniqueSortedStrings([...(current.books ?? []), ...(author.books ?? [])]);
  }

  const booksDocument = books.map((book) => ({
    bookId: book.bookId,
    queryText: book.queryText,
    source: book.source,
    finalUrl: book.finalUrl,
    title: book.title,
    authorName: book.authorName,
    authorUrl: book.authorUrl,
    authorId: book.authorId,
    latestChapterUrl: book.latestChapterUrl,
    chapterCount: book.chapterCount,
    chaptersFile: book.chaptersFile,
    downloadFile: book.downloadFile,
    bookFile: book.bookFile,
    authorFile: book.authorFile,
  }));
  const authorsDocument = [...authorMap.values()].sort((left, right) => compareNullableStrings(left.authorName, right.authorName));

  await writeJsonFile(outputs.booksPath, booksDocument);
  await writeJsonFile(outputs.authorsPath, authorsDocument);
  await writeJsonFile(outputs.searchResultsPath, searchResults);

  const manifest = {
    inputUrl,
    baseUrl,
    generatedAt: outputs.generatedAt,
    outDir: outputs.outDir,
    summary: {
      queries: settings.searchQueries.length,
      matchedQueries: searchResults.filter((result) => (result.resultCount ?? 0) > 0).length,
      noResultQueries: noResultQueries.length,
      books: booksDocument.length,
      authors: authorsDocument.length,
      chapters: books.reduce((sum, book) => sum + book.chapters.length, 0),
      downloadedBooks: booksDocument.length,
    },
    files: {
      books: outputs.booksPath,
      authors: outputs.authorsPath,
      searchResults: outputs.searchResultsPath,
      downloadsDir: outputs.downloadsDir,
      manifest: outputs.manifestPath,
    },
    negativeQueries: noResultQueries,
    target: {
      requestedBookTitle: settings.targetBookTitle || null,
      requestedBookUrl: settings.targetBookUrl || null,
      skipFallback: settings.skipFallback,
    },
  };

  await writeJsonFile(outputs.manifestPath, manifest);
  return manifest;
}

export function parseCliArgs(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    return { command: 'help' };
  }
  const [inputUrl, ...rest] = argv;
  const options = {};
  const readValue = (index) => {
    if (index + 1 >= rest.length) {
      throw new Error(`Missing value for ${rest[index]}`);
    }
    return { value: rest[index + 1], nextIndex: index + 1 };
  };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    switch (token) {
      case '--expanded-dir': {
        const { value, nextIndex } = readValue(index);
        options.expandedStatesDir = value;
        index = nextIndex;
        break;
      }
      case '--out-dir': {
        const { value, nextIndex } = readValue(index);
        options.outDir = value;
        index = nextIndex;
        break;
      }
      case '--search-query': {
        const { value, nextIndex } = readValue(index);
        options.searchQueries = [...toArray(options.searchQueries), value];
        index = nextIndex;
        break;
      }
      case '--max-fallback-books': {
        const { value, nextIndex } = readValue(index);
        options.maxFallbackBooks = Number(value);
        index = nextIndex;
        break;
      }
      case '--book-title': {
        const { value, nextIndex } = readValue(index);
        options.targetBookTitle = value;
        index = nextIndex;
        break;
      }
      case '--book-url': {
        const { value, nextIndex } = readValue(index);
        options.targetBookUrl = value;
        index = nextIndex;
        break;
      }
      case '--skip-fallback': {
        options.skipFallback = true;
        break;
      }
      default:
        break;
    }
  }
  return {
    command: 'collect',
    inputUrl,
    options,
  };
}

export function printHelp() {
  console.log([
    'Usage:',
    '  node src/entrypoints/pipeline/collect-book-content.mjs <url> [--expanded-dir <dir>] [--search-query <text>] [--book-title <title>] [--book-url <url>] [--skip-fallback] [--out-dir <dir>]',
  ].join('\n'));
}

export async function runCli() {
  initializeCliUtf8();
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.command === 'help') {
    printHelp();
    return;
  }
  if (!parsed.inputUrl) {
    throw new Error('Missing <url>.');
  }
  const result = await collectBookContent(parsed.inputUrl, parsed.options);
  console.log(JSON.stringify(summarizeStdout(result), null, 2));
}

