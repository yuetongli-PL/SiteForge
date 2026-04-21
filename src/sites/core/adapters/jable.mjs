// @ts-check

import { cleanText, hostFromUrl, normalizeWhitespace } from '../../../shared/normalize.mjs';
import { createCatalogAdapter } from './factory.mjs';

export const JABLE_TERMINOLOGY = Object.freeze({
  entityLabel: '\u5f71\u7247',
  entityPlural: '\u5f71\u7247',
  personLabel: '\u6f14\u5458',
  personPlural: '\u6f14\u5458',
  searchLabel: '\u641c\u7d22\u5f71\u7247',
  openEntityLabel: '\u6253\u5f00\u5f71\u7247',
  openPersonLabel: '\u6253\u5f00\u6f14\u5458\u9875',
  downloadLabel: '\u4e0b\u8f7d\u5f71\u7247',
  verifiedTaskLabel: '\u5f71\u7247 / \u6f14\u5458',
});

function resolveHost(input = {}) {
  return String(
    input.host
      ?? input.siteContext?.host
      ?? hostFromUrl(input.candidateUrl)
      ?? hostFromUrl(input.inputUrl)
      ?? ''
  ).toLowerCase();
}

function decodeSegment(segment) {
  try {
    return decodeURIComponent(String(segment ?? ''));
  } catch {
    return String(segment ?? '');
  }
}

function titleCaseWords(value) {
  return String(value ?? '')
    .split(/\s+/u)
    .filter(Boolean)
    .map((word) => (/^[a-z0-9-]+$/iu.test(word)
      ? word.charAt(0).toUpperCase() + word.slice(1)
      : word))
    .join(' ');
}

function normalizeSlugLabel(segment) {
  const decoded = decodeSegment(segment).replace(/[-_]+/gu, ' ').trim();
  if (!decoded) {
    return null;
  }
  if (/^[a-z]{2,10}\s+\d{2,6}$/iu.test(decoded)) {
    return decoded.replace(/\s+/gu, '-').toUpperCase();
  }
  if (/^[a-z]{2,10}-\d{2,6}$/iu.test(decoded)) {
    return decoded.toUpperCase();
  }
  return titleCaseWords(decoded);
}

function stripJableSuffix(value) {
  return normalizeWhitespace(value)
    .replace(/\s*\|\s*\u514d\u8d39\u9ad8\u6e05AV(?:\u7dda\u4e0a\u770b|\u5728\u7dda\u770b)?(?:\s*\|\s*Jable\.TV.*)?$/u, '')
    .replace(/\s*-\s*Jable(?:\.TV|\.)?(?:\s*\|.*)?$/iu, '')
    .replace(/\s*-\s*Ja$/iu, '')
    .replace(/\s+Gir$/u, '')
    .trim();
}

function parseUrl(input) {
  try {
    return input ? new URL(input) : null;
  } catch {
    return null;
  }
}

function normalizePathnameValue(pathname) {
  const input = String(pathname ?? '').trim() || '/';
  let normalized = input.startsWith('/') ? input : `/${input}`;
  normalized = normalized.replace(/\/{2,}/g, '/');
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.replace(/\/+$/g, '');
  }
  return normalized.toLowerCase();
}

export function classifyJableModelsPath(pathname) {
  const normalized = normalizePathnameValue(pathname);
  if (normalized === '/models') {
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

export function isJableModelsListPath(pathname) {
  return classifyJableModelsPath(pathname) === 'list';
}

export function isJableModelsDetailPath(pathname) {
  return classifyJableModelsPath(pathname) === 'detail';
}

export function normalizeJableDisplayLabel(rawValue, { url, pageType, queryText, kind } = {}) {
  const parsed = parseUrl(url);
  const pathname = parsed?.pathname ?? '';
  const segments = pathname.split('/').filter(Boolean);
  const raw = stripJableSuffix(rawValue);

  if (/^(?:\ud83d\udc69\s*)?\u6309\u5973\u512a/u.test(raw)) {
    return '\u6f14\u5458\u5217\u8868';
  }
  if (/^Author Links\b/iu.test(raw)) {
    return '\u6f14\u5458\u94fe\u63a5';
  }
  if (/^Content Links\b/iu.test(raw)) {
    return '\u5f71\u7247\u94fe\u63a5';
  }
  if (/^Search Form$/iu.test(raw)) {
    return '\u641c\u7d22\u8868\u5355';
  }

  const prefixedLabelMatch = raw.match(/^(\u6807\u7b7e|\u5206\u7c7b|\u6f14\u5458)\s*[:\uff1a]\s*(.+)$/u);
  if (prefixedLabelMatch) {
    return `${prefixedLabelMatch[1]}\uff1a${cleanText(prefixedLabelMatch[2])}`;
  }

  if (pageType === 'home' || pathname === '/') {
    return 'Jable.TV';
  }

  if (pageType === 'search-results-page' || segments[0] === 'search') {
    const query = queryText ?? normalizeSlugLabel(segments[1]) ?? cleanText(raw);
    return query ? `\u641c\u7d22\uff1a${query}` : '\u641c\u7d22\u7ed3\u679c';
  }

  if (pageType === 'book-detail-page' || segments[0] === 'videos') {
    const code = normalizeSlugLabel(segments[1]);
    if (raw) {
      if (code && raw.toUpperCase().includes(code)) {
        return raw;
      }
      return code ? `${code} ${raw}` : raw;
    }
    return code ?? '\u5f71\u7247\u8be6\u60c5';
  }

  const modelsPathKind = classifyJableModelsPath(pathname);
  if (pageType === 'author-list-page' || modelsPathKind === 'list') {
    return '\u6f14\u5458\u5217\u8868';
  }

  if (pageType === 'author-page' || modelsPathKind === 'detail' || segments[0] === 'models') {
    const titleActorName = cleanText(raw.split(/\s+\u51fa\u6f14(?:\u7684AV(?:\u7dda\u4e0a\u770b|\u5728\u7dda\u770b)?|)/u)[0]);
    if (titleActorName && !/^(?:Jable\.TV|\u5973\u512a)$/u.test(titleActorName)) {
      return titleActorName;
    }
    if (segments.length <= 1 || modelsPathKind === 'list') {
      return '\u6f14\u5458\u5217\u8868';
    }
    const model = normalizeSlugLabel(segments[1]);
    return model ? `\u6f14\u5458\uff1a${model}` : '\u6f14\u5458\u9875';
  }

  if (pageType === 'category-page') {
    if (pathname === '/categories/' || segments[0] === 'categories') {
      const category = normalizeSlugLabel(segments[1]);
      return category ? `\u5206\u7c7b\uff1a${category}` : '\u5206\u7c7b\u9875';
    }
    if (pathname === '/tags/' || segments[0] === 'tags') {
      const tag = normalizeSlugLabel(segments[1]);
      return tag ? `\u6807\u7b7e\uff1a${tag}` : '\u6807\u7b7e\u9875';
    }
    if (segments[0] === 'hot') {
      return '\u70ed\u95e8\u5f71\u7247';
    }
    if (segments[0] === 'latest-updates') {
      return '\u6700\u65b0\u66f4\u65b0';
    }
    if (segments[0] === 'models') {
      return '\u6f14\u5458\u5217\u8868';
    }
    const titleCategory = cleanText(raw.split(/\s+AV(?:\u7dda\u4e0a\u770b|\u5728\u7dda\u770b)?/u)[0]);
    if (titleCategory && !/^(?:Jable\.TV|\u4e3b\u984c)$/u.test(titleCategory)) {
      return titleCategory;
    }
  }

  if (kind === 'author-link-group' && /^Author Links\b/iu.test(raw)) {
    return '\u6f14\u5458\u94fe\u63a5';
  }
  if (kind === 'content-link-group' && /^Content Links\b/iu.test(raw)) {
    return '\u5f71\u7247\u94fe\u63a5';
  }
  if (kind === 'search-form-group' && raw === 'Search Form') {
    return '\u641c\u7d22\u8868\u5355';
  }

  return cleanText(raw) || normalizeSlugLabel(segments.at(-1)) || null;
}

const INTENT_LABELS = Object.freeze({
  'search-video': '\u641c\u7d22\u5f71\u7247',
  'search-book': '\u641c\u7d22\u5f71\u7247',
  'open-video': '\u6253\u5f00\u5f71\u7247',
  'open-book': '\u6253\u5f00\u5f71\u7247',
  'open-model': '\u6253\u5f00\u6f14\u5458\u9875',
  'open-author': '\u6253\u5f00\u6f14\u5458\u9875',
  'open-category': '\u6253\u5f00\u5206\u7c7b\u9875',
  'list-category-videos': '\u5206\u7c7b\u699c\u5355\u67e5\u8be2',
  'open-utility-page': '\u6253\u5f00\u529f\u80fd\u9875',
  'open-auth-page': '\u6253\u5f00\u8ba4\u8bc1\u9875',
});

export const jableAdapter = createCatalogAdapter({
  id: 'jable',
  terminology: JABLE_TERMINOLOGY,
  intentLabels: INTENT_LABELS,
  matches({ host, profile } = {}) {
    return resolveHost({ host, profile }) === 'jable.tv';
  },
  normalizeDisplayLabel({ value, ...options }) {
    return normalizeJableDisplayLabel(value, options) ?? cleanText(value);
  },
  inferPageType({ pathname }) {
    const modelsPathKind = classifyJableModelsPath(pathname);
    if (modelsPathKind === 'list') {
      return 'author-list-page';
    }
    if (modelsPathKind === 'detail') {
      return 'author-page';
    }
    return null;
  },
  classifyPath({ pathname }) {
    const modelsPathKind = classifyJableModelsPath(pathname);
    if (!modelsPathKind) {
      return { kind: null, detail: null };
    }
    return {
      kind: 'author-path',
      detail: modelsPathKind,
    };
  },
});
