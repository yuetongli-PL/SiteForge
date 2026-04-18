// @ts-check

import { cleanText, hostFromUrl, normalizeWhitespace } from '../../normalize.mjs';
import { genericNavigationAdapter } from './generic-navigation.mjs';

export const JABLE_TERMINOLOGY = Object.freeze({
  entityLabel: '影片',
  entityPlural: '影片',
  personLabel: '演员',
  personPlural: '演员',
  searchLabel: '搜索影片',
  openEntityLabel: '打开影片',
  openPersonLabel: '打开演员页',
  downloadLabel: '下载影片',
  verifiedTaskLabel: '影片/演员',
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
    .map((word) => /^[a-z0-9-]+$/iu.test(word)
      ? word.charAt(0).toUpperCase() + word.slice(1)
      : word)
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
    .replace(/\s*\|\s*免費高清AV線上看.*$/u, '')
    .replace(/\s*\|\s*免費高清AV(?:線上看|在線看)\s*\|\s*J片\s*AV(?:看到飽|看到饱).*$/u, '')
    .replace(/\s*-\s*Jable(?:\.TV|\.)?$/iu, '')
    .replace(/\s*-\s*Jable(?:\.TV|\.)?\s*\|\s*免費高清AV(?:線上看|在線看)\s*\|\s*J片\s*AV(?:看到飽|看到饱).*$/iu, '')
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

  if (/^(?:👩\s*)?按女優/u.test(raw)) {
    return '演员列表';
  }
  if (/^Author Links\b/iu.test(raw)) {
    return '演员链接';
  }
  if (/^Content Links\b/iu.test(raw)) {
    return '影片链接';
  }
  if (/^Search Form$/iu.test(raw)) {
    return '搜索表单';
  }
  const prefixedLabelMatch = raw.match(/^(标签|分类|演员)\s*[:：]\s*(.+)$/u);
  if (prefixedLabelMatch) {
    return `${prefixedLabelMatch[1]}：${cleanText(prefixedLabelMatch[2])}`;
  }

  if (pageType === 'home' || pathname === '/') {
    return 'Jable.TV';
  }

  if (pageType === 'search-results-page' || segments[0] === 'search') {
    const query = queryText ?? normalizeSlugLabel(segments[1]) ?? cleanText(raw);
    return query ? `搜索：${query}` : '搜索结果';
  }

  if (pageType === 'book-detail-page' || segments[0] === 'videos') {
    const code = normalizeSlugLabel(segments[1]);
    if (raw) {
      if (code && raw.toUpperCase().includes(code)) {
        return raw;
      }
      return code ? `${code} ${raw}` : raw;
    }
    return code ?? '影片详情';
  }

  const modelsPathKind = classifyJableModelsPath(pathname);
  if (pageType === 'author-list-page' || modelsPathKind === 'list') {
    return '演员列表';
  }

  if (pageType === 'author-page' || modelsPathKind === 'detail' || segments[0] === 'models') {
    const titleActorName = cleanText(raw.split(/\s+出演(?:的AV(?:線上看|在线看)|)/u)[0]);
    if (titleActorName && !/^(?:Jable\.TV|女優)$/u.test(titleActorName)) {
      return titleActorName;
    }
    if (segments.length <= 1 || modelsPathKind === 'list') {
      return '演员列表';
    }
    const model = normalizeSlugLabel(segments[1]);
    return model ? `演员：${model}` : '演员页';
  }

  if (pageType === 'category-page') {
    if (pathname === '/categories/' || segments[0] === 'categories') {
      const category = normalizeSlugLabel(segments[1]);
      return category ? `分类：${category}` : '分类页';
    }
    if (pathname === '/tags/' || segments[0] === 'tags') {
      const tag = normalizeSlugLabel(segments[1]);
      return tag ? `标签：${tag}` : '标签页';
    }
    if (segments[0] === 'hot') {
      return '热门影片';
    }
    if (segments[0] === 'latest-updates') {
      return '最新更新';
    }
    if (segments[0] === 'models') {
      return '演员列表';
    }
    const titleCategory = cleanText(raw.split(/\s+AV線上看/u)[0]);
    if (titleCategory && !/^(?:Jable\.TV|主頁)$/u.test(titleCategory)) {
      return titleCategory;
    }
  }

  if (kind === 'author-link-group' && /^Author Links\b/iu.test(raw)) {
    return '演员链接';
  }
  if (kind === 'content-link-group' && /^Content Links\b/iu.test(raw)) {
    return '影片链接';
  }
  if (kind === 'search-form-group' && raw === 'Search Form') {
    return '搜索表单';
  }

  return cleanText(raw) || normalizeSlugLabel(segments.at(-1)) || null;
}

export const jableAdapter = Object.freeze({
  ...genericNavigationAdapter,
  id: 'jable',
  matches({ host, profile } = {}) {
    return resolveHost({ host, profile }) === 'jable.tv';
  },
  terminology() {
    return { ...JABLE_TERMINOLOGY };
  },
  displayIntentName({ intentType }) {
    switch (intentType) {
      case 'search-video':
      case 'search-book':
        return '搜索影片';
      case 'open-video':
      case 'open-book':
        return '打开影片';
      case 'open-model':
      case 'open-author':
        return '打开演员页';
      case 'open-category':
        return '打开分类页';
      case 'list-category-videos':
        return '分类榜单查询';
      case 'open-utility-page':
        return '打开功能页';
      case 'open-auth-page':
        return '打开认证页';
      default:
        return String(intentType ?? '');
    }
  },
  normalizeDisplayLabel({ value, ...options }) {
    return normalizeJableDisplayLabel(value, options) ?? cleanText(value);
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
  runtimePolicy({ profile } = {}) {
    return {
      allowedHosts: Array.isArray(profile?.navigation?.allowedHosts) ? profile.navigation.allowedHosts : [],
      sampling: profile?.sampling ?? null,
      pageTypes: profile?.pageTypes ?? null,
    };
  },
});
