// @ts-check

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

function toArray(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
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

function chapterEntriesFromRequest(request = {}) {
  return [
    ...toArray(request.chapters),
    ...toArray(request.chapterUrls).map((url) => ({ url })),
    ...toArray(request.book?.chapters),
    ...(request.chapterUrl ? [{ url: request.chapterUrl }] : []),
  ];
}

export function resolveResources(plan, sessionLease = null, context = {}) {
  const request = context.request ?? {};
  const chapterEntries = chapterEntriesFromRequest(request);
  if (chapterEntries.length === 0) {
    return null;
  }

  const baseUrl = normalizeText(
    request.bookUrl
      ?? request.siteUrl
      ?? request.baseUrl
      ?? request.input
      ?? request.url
      ?? request.inputUrl
      ?? plan.source?.canonicalUrl
      ?? plan.source?.input
      ?? 'https://www.22biqu.com/',
  );
  const bookUrl = normalizeText(request.bookUrl ?? plan.source?.canonicalUrl ?? plan.source?.input);
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
          chapterIndex: chapter.index ?? index + 1,
          title: normalizeText(chapter.title ?? chapter.chapterTitle ?? chapter.name) || undefined,
          bookTitle: normalizeText(request.title ?? request.bookTitle ?? plan.source?.title) || undefined,
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
