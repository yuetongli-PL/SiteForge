// @ts-check

import { cleanText, hostFromUrl, normalizeWhitespace } from './normalize.mjs';
import { classifyJableModelsPath } from './site-path-classifiers.mjs';

function resolveHost(siteContext, inputUrl, candidateUrl) {
  return String(
    siteContext?.host
      ?? hostFromUrl(candidateUrl)
      ?? hostFromUrl(inputUrl)
      ?? ''
  ).toLowerCase();
}

function isJableHost(host) {
  return /(?:^|\.)jable\.tv$/iu.test(String(host ?? ''));
}

function isMoodyzHost(host) {
  return /(?:^|\.)moodyz\.com$/iu.test(String(host ?? ''));
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
    .replace(/\s*\|\s*免費高清AV在線看.*$/u, '')
    .replace(/\s*-\s*Jable(?:\.TV|\.)?$/iu, '')
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

function normalizeJableDisplayLabel(rawValue, { url, pageType, queryText, kind } = {}) {
  const parsed = parseUrl(url);
  const pathname = parsed?.pathname ?? '';
  const segments = pathname.split('/').filter(Boolean);
  const raw = stripJableSuffix(rawValue);

  if (/^(?:👩\s*)?按女優$/u.test(raw)) {
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
    const titleActorName = cleanText(raw.split(/出演的AV在線看/u)[0]);
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
    const titleCategory = cleanText(raw.split(/\s+AV在線看/u)[0]);
    if (titleCategory && !/^(?:Jable\.TV|主題)$/u.test(titleCategory)) {
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

export function resolveSiteTerminology(siteContext, inputUrl) {
  const host = resolveHost(siteContext, inputUrl);
  if (isJableHost(host)) {
    return {
      entityLabel: '影片',
      entityPlural: '影片',
      personLabel: '演员',
      personPlural: '演员',
      searchLabel: '搜索影片',
      openEntityLabel: '打开影片',
      openPersonLabel: '打开演员页',
      downloadLabel: '下载影片',
      verifiedTaskLabel: '影片/演员',
    };
  }
  if (isMoodyzHost(host)) {
    return {
      entityLabel: '作品',
      entityPlural: '作品',
      personLabel: '女优',
      personPlural: '女优',
      searchLabel: '搜索作品',
      openEntityLabel: '打开作品',
      openPersonLabel: '打开女优页',
      downloadLabel: '下载作品',
      verifiedTaskLabel: '作品/女优',
    };
  }
  return {
    entityLabel: '书籍',
    entityPlural: '书籍',
    personLabel: '作者',
    personPlural: '作者',
    searchLabel: '搜索书籍',
    openEntityLabel: '打开书籍',
    openPersonLabel: '打开作者页',
    downloadLabel: '下载书籍',
    verifiedTaskLabel: '书籍/作者',
  };
}

export function displayIntentName(intentType, siteContext, inputUrl) {
  const host = resolveHost(siteContext, inputUrl);
  if (isJableHost(host)) {
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
  }
  if (isMoodyzHost(host)) {
    switch (intentType) {
      case 'search-work':
      case 'search-book':
        return '搜索作品';
      case 'open-work':
      case 'open-book':
        return '打开作品';
      case 'open-actress':
      case 'open-author':
        return '打开女优页';
      case 'open-category':
        return '打开分类页';
      case 'open-utility-page':
        return '打开功能页';
      default:
        return String(intentType ?? '');
    }
  }
  return String(intentType ?? '');
}

export function normalizeDisplayLabel(value, options = {}) {
  const host = resolveHost(options.siteContext, options.inputUrl, options.url);
  if (isJableHost(host)) {
    return normalizeJableDisplayLabel(value, options) ?? cleanText(value);
  }
  return cleanText(value);
}
