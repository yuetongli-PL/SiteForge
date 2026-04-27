// @ts-check

import path from 'node:path';
import { access, readFile } from 'node:fs/promises';

import {
  normalizeDownloadResource,
  normalizeResolvedDownloadTask,
} from '../contracts.mjs';
import {
  isHttpUrl,
  normalizeText,
  pushFlag,
} from './common.mjs';

export const siteKey = '22biqu';

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  if (!filePath || !await pathExists(filePath)) {
    return null;
  }
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function firstText(...values) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function absoluteUrl(value, baseUrl) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }
  try {
    return new URL(normalized, baseUrl).toString();
  } catch {
    return '';
  }
}

function normalizeUrlNoFragment(value, baseUrl = undefined) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }
  try {
    const parsed = new URL(normalized, baseUrl);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return normalized.split('#')[0];
  }
}

function fileNameForChapter(chapter, index) {
  const title = normalizeText(
    chapter.title
      ?? chapter.chapterTitle
      ?? chapter.name
      ?? chapter.label
      ?? `chapter-${String(index + 1).padStart(3, '0')}`,
  );
  const prefix = String(index + 1).padStart(4, '0');
  return `${prefix}-${title}.txt`;
}

function requestDryRun(request, plan) {
  return Boolean(request.dryRun ?? plan.policy?.dryRun);
}

function chapterEntriesFromRequest(request = {}) {
  return [
    ...toArray(request.chapters),
    ...toArray(request.chapterUrls).map((url) => ({ url })),
    ...toArray(request.book?.chapters),
    ...(request.chapterUrl ? [{ url: request.chapterUrl }] : []),
  ];
}

function fixtureDirCandidates(request = {}, context = {}) {
  const nested = request.bookContent && typeof request.bookContent === 'object' ? request.bookContent : {};
  return [
    request.bookContentDir,
    request.bookContentRoot,
    request.fixtureBookContentDir,
    request.mockBookContentDir,
    request.fixtureDir,
    request.mockDir,
    nested.dir,
    nested.root,
    context.bookContentDir,
    context.bookContentRoot,
    context.fixtureBookContentDir,
    context.mockBookContentDir,
    context.fixtureDir,
    context.mockDir,
  ].map((value) => normalizeText(value)).filter(Boolean);
}

function resolveFixturePath(value, baseDir) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }
  return path.isAbsolute(normalized) ? normalized : path.resolve(baseDir, normalized);
}

async function bookContentRootsFromCandidate(candidate) {
  const root = path.resolve(candidate);
  const sources = await readJsonIfExists(path.join(root, 'index', 'sources.json'));
  const sourceRoots = [];
  for (const source of toArray(sources?.activeSources)) {
    if (source?.step === 'step-book-content' && source.rawDir) {
      sourceRoots.push(path.resolve(root, source.rawDir));
    }
  }
  return [...sourceRoots, root];
}

async function loadBookContentFixture(root) {
  const manifest = await readJsonIfExists(path.join(root, 'book-content-manifest.json'));
  const booksPath = resolveFixturePath(manifest?.files?.books ?? 'books.json', root);
  const books = await readJsonIfExists(booksPath);
  if (Array.isArray(books)) {
    return { root, books };
  }

  const book = await readJsonIfExists(path.join(root, 'book.json'));
  if (isObject(book)) {
    return { root, books: [book] };
  }

  const chapters = await readJsonIfExists(path.join(root, 'chapters.json'));
  if (Array.isArray(chapters)) {
    return {
      root,
      books: [{
        title: manifest?.title,
        finalUrl: manifest?.finalUrl ?? manifest?.baseUrl ?? manifest?.inputUrl,
        chapters,
      }],
    };
  }

  return null;
}

async function loadBookContentFixtures(request = {}, context = {}) {
  const fixtures = [];
  const seen = new Set();
  for (const candidate of fixtureDirCandidates(request, context)) {
    for (const root of await bookContentRootsFromCandidate(candidate)) {
      const key = path.resolve(root).toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const fixture = await loadBookContentFixture(root);
      if (fixture) {
        fixtures.push(fixture);
      }
    }
  }
  return fixtures;
}

function requestedBookUrl(request = {}, plan = {}) {
  return normalizeUrlNoFragment(firstText(
    request.bookUrl,
    request.url,
    request.inputUrl,
    isHttpUrl(request.input) ? request.input : '',
    plan.source?.canonicalUrl,
    isHttpUrl(plan.source?.input) ? plan.source?.input : '',
  ));
}

function requestedBookTitle(request = {}, plan = {}) {
  return firstText(
    request.bookTitle,
    request.title,
    !isHttpUrl(request.input) ? request.input : '',
    plan.source?.title,
    !isHttpUrl(plan.source?.input) ? plan.source?.input : '',
  );
}

function bookUrl(book = {}) {
  return normalizeUrlNoFragment(firstText(
    book.finalUrl,
    book.bookUrl,
    book.url,
    book.canonicalUrl,
    book.sourceUrl,
  ));
}

function bookTitle(book = {}) {
  return firstText(book.title, book.bookTitle, book.name);
}

function titlesMatch(left, right) {
  const leftText = normalizeText(left).toLowerCase();
  const rightText = normalizeText(right).toLowerCase();
  return Boolean(leftText && rightText && (
    leftText === rightText
    || leftText.includes(rightText)
    || rightText.includes(leftText)
  ));
}

function bookMatchesRequest(book, request, plan) {
  const targetUrl = requestedBookUrl(request, plan);
  const targetTitle = requestedBookTitle(request, plan);
  const candidateUrl = bookUrl(book);
  const candidateTitle = bookTitle(book);
  if (targetUrl && candidateUrl && targetUrl === candidateUrl) {
    return true;
  }
  return titlesMatch(candidateTitle, targetTitle);
}

async function loadChaptersForBook(book, root) {
  const inlineChapters = chapterEntriesFromRequest({ chapters: book.chapters, chapterUrls: book.chapterUrls });
  if (inlineChapters.length > 0) {
    return inlineChapters;
  }

  const chaptersFile = firstText(book.chaptersFile, book.chapterFile, book.chaptersPath);
  if (!chaptersFile) {
    return [];
  }
  const chaptersPath = resolveFixturePath(chaptersFile, root);
  const chapters = await readJsonIfExists(chaptersPath);
  return Array.isArray(chapters) ? chapters : [];
}

function chapterOrderValue(chapter = {}) {
  const value = chapter.chapterIndex ?? chapter.index ?? chapter.order ?? chapter.sequence;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function stableChapterEntries(chapters = []) {
  return chapters
    .map((chapter, originalIndex) => ({ chapter, originalIndex }))
    .sort((left, right) => {
      const leftOrder = chapterOrderValue(isObject(left.chapter) ? left.chapter : {});
      const rightOrder = chapterOrderValue(isObject(right.chapter) ? right.chapter : {});
      if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      if (leftOrder !== null && rightOrder === null) {
        return -1;
      }
      if (leftOrder === null && rightOrder !== null) {
        return 1;
      }
      return left.originalIndex - right.originalIndex;
    })
    .map((entry) => entry.chapter);
}

async function chapterEntriesFromFixtures(request, plan, context) {
  if (!requestDryRun(request, plan)) {
    return null;
  }

  for (const fixture of await loadBookContentFixtures(request, context)) {
    const book = fixture.books.find((entry) => bookMatchesRequest(entry, request, plan));
    if (!book) {
      continue;
    }
    const chapters = stableChapterEntries(await loadChaptersForBook(book, fixture.root));
    if (chapters.length === 0) {
      continue;
    }
    return {
      chapters,
      book: {
        title: bookTitle(book),
        url: bookUrl(book),
        id: firstText(book.bookId, book.id),
        source: firstText(book.source, 'book-content-fixture'),
      },
    };
  }
  return null;
}

function resolveChapterResources(plan, sessionLease, context, chapterEntries, details = {}) {
  const request = context.request ?? {};
  if (chapterEntries.length === 0) {
    return null;
  }

  const baseUrl = normalizeText(
    details.book?.url
      ?? request.bookUrl
      ?? request.siteUrl
      ?? request.baseUrl
      ?? request.input
      ?? request.url
      ?? request.inputUrl
      ?? plan.source?.canonicalUrl
      ?? plan.source?.input
      ?? 'https://www.22biqu.com/',
  );
  const bookUrl = normalizeText(details.book?.url ?? request.bookUrl ?? plan.source?.canonicalUrl ?? plan.source?.input);
  const sourceTitle = normalizeText(details.book?.title ?? request.title ?? request.bookTitle ?? plan.source?.title);
  const resources = chapterEntries
    .map((entry, index) => {
      const chapter = typeof entry === 'string' ? { url: entry } : entry;
      if (!chapter || typeof chapter !== 'object') {
        return null;
      }
      const url = absoluteUrl(chapter.url ?? chapter.chapterUrl ?? chapter.href ?? chapter.canonicalUrl, baseUrl);
      if (!url) {
        return null;
      }
      return normalizeDownloadResource({
        id: normalizeText(chapter.id) || undefined,
        url,
        headers: sessionLease?.headers ?? {},
        fileName: chapter.fileName ?? fileNameForChapter(chapter, index),
        mediaType: 'text',
        sourceUrl: chapter.sourceUrl ?? bookUrl,
        referer: chapter.referer ?? bookUrl,
        priority: chapter.priority ?? index,
        groupId: request.bookId ?? request.title ?? plan.source?.title ?? plan.id,
        metadata: {
          siteResolver: siteKey,
          chapterIndex: chapter.chapterIndex ?? chapter.index ?? index + 1,
          title: normalizeText(chapter.title ?? chapter.chapterTitle ?? chapter.name) || undefined,
          bookTitle: sourceTitle || undefined,
        },
      }, index);
    })
    .filter(Boolean);

  if (resources.length === 0) {
    return null;
  }

  return normalizeResolvedDownloadTask({
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources,
    metadata: {
      resolver: {
        ...(plan.resolver ?? {}),
        method: 'native-22biqu-chapters',
      },
      legacy: plan.legacy,
      bookContent: details.book ? {
        source: details.book.source,
        bookId: details.book.id || undefined,
      } : undefined,
    },
    completeness: {
      expectedCount: chapterEntries.length,
      resolvedCount: resources.length,
      complete: resources.length === chapterEntries.length,
      reason: resources.length === chapterEntries.length
        ? '22biqu-chapters-provided'
        : '22biqu-chapter-data-incomplete',
    },
  }, plan);
}

export async function resolveResources(plan, sessionLease = null, context = {}) {
  const request = context.request ?? {};
  const chapterEntries = chapterEntriesFromRequest(request);
  if (chapterEntries.length > 0) {
    return resolveChapterResources(plan, sessionLease, context, chapterEntries);
  }

  const fixtureChapters = await chapterEntriesFromFixtures(request, plan, context);
  if (fixtureChapters) {
    const resolved = resolveChapterResources(plan, sessionLease, context, fixtureChapters.chapters, fixtureChapters);
    if (resolved) {
      return {
        ...resolved,
        metadata: {
          ...resolved.metadata,
          resolver: {
            ...(resolved.metadata?.resolver ?? {}),
            method: 'native-22biqu-book-content',
          },
        },
        completeness: {
          ...resolved.completeness,
          reason: '22biqu-book-content-provided',
        },
      };
    }
  }

  return null;
}

export function buildLegacyCommand(entrypointPath, plan, request = {}, sessionLease = {}, options = {}, layout) {
  const input = normalizeText(request.input ?? request.url ?? request.inputUrl ?? plan.source?.input);
  const command = request.pythonPath ?? options.pythonPath ?? plan.legacy?.pythonPath ?? 'python';
  const baseUrl = normalizeText(request.siteUrl ?? request.baseUrl ?? plan.source?.canonicalUrl) || 'https://www.22biqu.com/';
  const args = [entrypointPath, baseUrl, '--out-dir', layout.runDir];
  if (isHttpUrl(input)) {
    args.push('--book-url', input);
  } else if (input) {
    args.push('--book-title', input);
  }
  if (request.metadataOnly) {
    args.push('--metadata-only');
  }
  if (request.forceRecrawl) {
    args.push('--force-recrawl');
  }
  pushFlag(args, '--profile-path', request.profilePath);
  pushFlag(args, '--crawler-scripts-dir', request.crawlerScriptsDir);
  pushFlag(args, '--knowledge-base-dir', request.knowledgeBaseDir);
  pushFlag(args, '--node-executable', request.nodeExecutable ?? options.nodeExecutable);
  return { command, args, executorKind: 'python' };
}

export default Object.freeze({
  siteKey,
  resolveResources,
  buildLegacyCommand,
});
