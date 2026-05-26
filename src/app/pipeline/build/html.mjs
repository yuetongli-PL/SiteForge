// @ts-check

import { normalizeWhitespace, slugifyAscii } from '../../../shared/normalize.mjs';
import {
  REDACTION_PLACEHOLDER,
  isSensitiveFieldName,
  redactPublicIdentifierText,
  redactUrl,
} from '../../../domain/sessions/security-guard.mjs';

export function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&quot;/giu, '"')
    .replace(/&#34;/giu, '"')
    .replace(/&#x22;/giu, '"')
    .replace(/&#39;/giu, '\'')
    .replace(/&#x27;/giu, '\'')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, ' ')
    .replace(/&nbsp;/giu, ' ');
}

export function parseAttributes(rawAttributes = '') {
  const attributes = /** @type {any} */ ({});
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
  let match;
  while ((match = pattern.exec(rawAttributes)) !== null) {
    const [, name, dq, sq, bare] = match;
    attributes[name.toLowerCase()] = decodeHtmlEntities(dq ?? sq ?? bare ?? '');
  }
  return attributes;
}

export function stripHtml(value) {
  return normalizeWhitespace(
    decodeHtmlEntities(
      String(value ?? '')
        .replace(/<script\b[\s\S]*?<\/script>/giu, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/giu, ' ')
        .replace(/<[^>]+>/gu, ' '),
    ),
  );
}

const SENSITIVE_TEXT_TOKEN_PATTERN = /\b[\w.-]*(?:access[_-]?token|refresh[_-]?token|csrf|xsrf|sess(?:ion)?(?:id)?|cookie|authorization|auth|api[_-]?key|secret|password|token)[\w.-]*\b/giu;
const SAFE_ATTRIBUTE_NAMES = new Set([
  'aria-label',
  'class',
  'data-testid',
  'data-test',
  'id',
  'method',
  'name',
  'placeholder',
  'rel',
  'role',
  'title',
  'type',
]);

function sanitizeArtifactText(value, maxLength = 360) {
  const text = stripHtml(value)
    .replace(SENSITIVE_TEXT_TOKEN_PATTERN, REDACTION_PLACEHOLDER);
  return redactPublicIdentifierText(/** @type {any} */ (text), { maxLength }).value
    .replace(SENSITIVE_TEXT_TOKEN_PATTERN, REDACTION_PLACEHOLDER);
}

function textSummary(value, maxLength = 360) {
  const text = sanitizeArtifactText(value, maxLength);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength).trimEnd()}...`;
}

function countMatches(value, pattern) {
  return String(value ?? '').match(pattern)?.length ?? 0;
}

function staticHtmlDiagnostics(html, {
  title,
  textSummary: summaryText,
  links,
  forms,
  controls,
} = /** @type {any} */ ({})) {
  const raw = String(html ?? '');
  const visibleText = stripHtml(raw);
  const scriptCount = countMatches(raw, /<script\b/giu);
  const externalScriptCount = countMatches(raw, /<script\b[^>]*\bsrc\s*=/giu);
  const noscriptText = [...raw.matchAll(/<noscript\b[^>]*>([\s\S]*?)<\/noscript>/giu)]
    .map((match) => stripHtml(match[1]))
    .filter(Boolean)
    .join(' ');
  const dynamicSignals = /** @type {any[]} */ ([]);
  if (scriptCount > 0) {
    dynamicSignals.push('scripts-present');
  }
  if (externalScriptCount > 0) {
    dynamicSignals.push('external-scripts-present');
  }
  if (/enable javascript|requires javascript|please turn on javascript|javascript is disabled/iu.test(`${visibleText} ${noscriptText}`)) {
    dynamicSignals.push('javascript-required-copy');
  }
  if (/\bid\s*=\s*["']?(?:app|root|__next|__nuxt|gatsby-focus-wrapper)\b/iu.test(raw)) {
    dynamicSignals.push('app-shell-root');
  }
  if (/probe\.js|challenge|captcha|verify you are human|checking your browser|security check|waf|anti[-\s]?bot/iu.test(`${raw} ${visibleText} ${noscriptText}`)) {
    dynamicSignals.push('probe-or-challenge-signal');
  }
  if (/login|sign in|signin|log in|account required|please authenticate/iu.test(`${visibleText} ${noscriptText}`)) {
    dynamicSignals.push('login-like-copy');
  }

  const staticSignalCount = Number(Boolean(title))
    + Number(Boolean(summaryText && summaryText.length >= 40))
    + (links?.length ?? 0)
    + (forms?.length ?? 0)
    + (controls?.length ?? 0);
  const staticEvidenceStatus = dynamicSignals.length && staticSignalCount <= 1
    ? 'dynamic_shell'
    : staticSignalCount === 0
      ? 'empty'
      : 'present';
  const publicEvidenceStatus = staticEvidenceStatus === 'present'
    ? 'public_static_structured'
    : dynamicSignals.includes('probe-or-challenge-signal')
      ? 'public_probe_or_challenge'
      : dynamicSignals.includes('login-like-copy')
        ? 'auth_required'
        : staticEvidenceStatus === 'dynamic_shell'
          ? 'public_dynamic_shell'
          : 'public_static_empty';
  const blockerCategory = publicEvidenceStatus === 'public_probe_or_challenge'
    ? 'challenge_or_probe'
    : publicEvidenceStatus === 'auth_required'
      ? 'auth_required'
      : publicEvidenceStatus === 'public_dynamic_shell'
        ? 'dynamic_render_required'
        : publicEvidenceStatus === 'public_static_empty'
          ? 'empty_static_response'
          : null;
  const warnings = /** @type {any[]} */ ([]);
  if (staticEvidenceStatus === 'dynamic_shell') {
    warnings.push('Static parser found only weak shell evidence and dynamic-site signals; browser-rendered crawl may be required.');
  }
  if (staticEvidenceStatus === 'empty') {
    warnings.push('Static parser found no usable title, text, links, forms, or controls.');
  }
  return {
    staticEvidenceStatus,
    publicEvidenceStatus,
    blockerCategory,
    primaryBlocker: blockerCategory,
    recommendedNextStep: blockerCategory === 'dynamic_render_required'
      ? 'rerun_with_render_js'
      : blockerCategory === 'challenge_or_probe'
        ? 'do_not_bypass_challenge'
        : blockerCategory === 'auth_required'
          ? 'provide_cookie_auth_if_user_allows'
          : null,
    staticSignalCount,
    visibleTextLength: visibleText.length,
    scriptCount,
    externalScriptCount,
    dynamicSignals: [...new Set(dynamicSignals)].sort((left, right) => left.localeCompare(right, 'en')),
    warnings,
  };
}

function resolveUrlMaybe(value, baseUrl) {
  if (!value) {
    return null;
  }
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function sourceUrlSameOrigin(value, baseUrl) {
  const resolved = resolveUrlMaybe(value, baseUrl);
  if (!resolved || !baseUrl) {
    return false;
  }
  try {
    return new URL(resolved).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

function sanitizeUrlMaybe(value, baseUrl) {
  const resolved = resolveUrlMaybe(value, baseUrl);
  if (!resolved) {
    return null;
  }
  try {
    const parsed = new URL(resolved);
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveFieldName(key) || /^auth$/iu.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    return redactUrl(parsed.toString()).url;
  } catch {
    return redactUrl(resolved).url;
  }
}

function sanitizeAttributes(attrs = /** @type {any} */ ({}), baseUrl = undefined, tagName = '') {
  const sanitized = /** @type {any} */ ({});
  const normalizedTag = String(tagName ?? '').toLowerCase();
  for (const [key, value] of Object.entries(attrs ?? {})) {
    const normalizedKey = String(key ?? '').toLowerCase();
    if (isSensitiveFieldName(normalizedKey)) {
      sanitized[normalizedKey] = REDACTION_PLACEHOLDER;
      continue;
    }
    if (['href', 'src', 'action'].includes(normalizedKey)) {
      const sanitizedUrl = sanitizeUrlMaybe(value, baseUrl);
      if (sanitizedUrl) {
        sanitized[normalizedKey] = sanitizedUrl;
      }
      continue;
    }
    if (normalizedKey === 'value') {
      sanitized[normalizedKey] = REDACTION_PLACEHOLDER;
      continue;
    }
    if (SAFE_ATTRIBUTE_NAMES.has(normalizedKey) || normalizedKey.startsWith('data-')) {
      sanitized[normalizedKey] = sanitizeArtifactText(value, 120);
      continue;
    }
    if (normalizedTag === 'input' || normalizedTag === 'textarea' || normalizedTag === 'select') {
      continue;
    }
    sanitized[normalizedKey] = sanitizeArtifactText(value, 120);
  }
  return sanitized;
}

function selectorFor(tagName, attrs, fallbackIndex) {
  if (attrs.id) {
    return `${tagName}#${attrs.id}`;
  }
  if (attrs.name) {
    return `${tagName}[name="${attrs.name}"]`;
  }
  if (attrs.href) {
    return `${tagName}[href]`;
  }
  if (attrs.type) {
    return `${tagName}[type="${attrs.type}"]`;
  }
  const label = slugifyAscii(attrs['aria-label'] ?? attrs.title ?? '', '');
  return label ? `${tagName}[aria-label*="${label}"]` : `${tagName}:nth-of-type(${fallbackIndex + 1})`;
}

export function extractTitle(html) {
  const title = String(html ?? '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1];
  if (title) {
    return sanitizeArtifactText(title, 160);
  }
  const h1 = String(html ?? '').match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu)?.[1];
  return h1 ? sanitizeArtifactText(h1, 160) : '';
}

export function extractCanonicalUrl(html, baseUrl) {
  const pattern = /<link\b([^>]*?)>/giu;
  let match;
  while ((match = pattern.exec(String(html ?? ''))) !== null) {
    const attrs = parseAttributes(match[1]);
    if (String(attrs.rel ?? '').toLowerCase().split(/\s+/u).includes('canonical')) {
      return sanitizeUrlMaybe(attrs.href, baseUrl);
    }
  }
  return null;
}

export function extractLinks(html, baseUrl) {
  const links = /** @type {any[]} */ ([]);
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/giu;
  let match;
  let index = 0;
  while ((match = pattern.exec(String(html ?? ''))) !== null) {
    const rawAttrs = parseAttributes(match[1]);
    const href = sanitizeUrlMaybe(rawAttrs.href, baseUrl);
    if (!href) {
      index += 1;
      continue;
    }
    const attrs = sanitizeAttributes(rawAttrs, baseUrl, 'a');
    const label = sanitizeArtifactText(match[2], 160) || sanitizeArtifactText(rawAttrs['aria-label'] ?? rawAttrs.title ?? '', 160);
    const link = {
      href,
      sourceSameOrigin: sourceUrlSameOrigin(rawAttrs.href, baseUrl),
      label,
      selector: selectorFor('a', attrs, index),
      attrs,
    };
    const semanticKind = semanticKindForLink(link);
    links.push({
      ...link,
      semanticKind,
      structureType: structureTypeForSemanticKind(semanticKind),
      routeTemplate: routeTemplateForUrlMaybe(href),
    });
    index += 1;
  }
  return links;
}

export function extractControls(html, baseUrl) {
  const controls = /** @type {any[]} */ ([]);
  const pattern = /<(button|input|select|textarea)\b([^>]*)>([\s\S]*?)(?:<\/\1>)?/giu;
  let match;
  let index = 0;
  while ((match = pattern.exec(String(html ?? ''))) !== null) {
    const tagName = String(match[1]).toLowerCase();
    const rawAttrs = parseAttributes(match[2]);
    const attrs = sanitizeAttributes(rawAttrs, baseUrl, tagName);
    controls.push({
      tagName,
      kind: tagName === 'button' ? 'button' : tagName === 'select' ? 'select' : 'input',
      type: String(attrs.type ?? '').toLowerCase() || null,
      name: attrs.name ?? null,
      label: sanitizeArtifactText(match[3], 160) || sanitizeArtifactText(rawAttrs['aria-label'] ?? rawAttrs.placeholder ?? rawAttrs.name ?? '', 160),
      selector: selectorFor(tagName, attrs, index),
      href: sanitizeUrlMaybe(rawAttrs.href, baseUrl),
      attrs,
    });
    index += 1;
  }
  return controls;
}

export function extractForms(html, baseUrl) {
  const forms = /** @type {any[]} */ ([]);
  const pattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/giu;
  let match;
  let index = 0;
  while ((match = pattern.exec(String(html ?? ''))) !== null) {
    const rawAttrs = parseAttributes(match[1]);
    const attrs = sanitizeAttributes(rawAttrs, baseUrl, 'form');
    const body = match[2];
    const method = String(attrs.method ?? 'GET').toUpperCase();
    const action = sanitizeUrlMaybe(rawAttrs.action || baseUrl, baseUrl);
    const controls = extractControls(body, baseUrl);
    forms.push({
      id: attrs.id ?? attrs.name ?? `form-${index + 1}`,
      method,
      action,
      selector: selectorFor('form', attrs, index),
      label: normalizeWhitespace(attrs['aria-label'] ?? attrs.name ?? attrs.id ?? '') || inferFormLabel({ attrs, body, action }),
      attrs,
      inputs: controls.filter((control) => ['input', 'select', 'textarea'].includes(control.tagName)),
      buttons: controls.filter((control) => control.tagName === 'button' || ['submit', 'button', 'image'].includes(String(control.type ?? '').toLowerCase())),
      textSummary: textSummary(body, 220),
    });
    index += 1;
  }
  return forms;
}

function inferFormLabel({ attrs, body, action }) {
  const haystack = `${attrs.role ?? ''} ${attrs.name ?? ''} ${attrs.id ?? ''} ${action ?? ''} ${sanitizeArtifactText(body, 240)}`.toLowerCase();
  if (/search|query|keyword|find/u.test(haystack)) {
    return 'Search';
  }
  if (/contact|support|message|email/u.test(haystack)) {
    return 'Contact';
  }
  if (/login|sign in/u.test(haystack)) {
    return 'Login';
  }
  return 'Form';
}

function routeTemplateForUrlMaybe(value) {
  try {
    return routePatternForUrl(value);
  } catch {
    return null;
  }
}

function semanticKindForLink(link = /** @type {any} */ ({})) {
  const text = [
    link.href,
    link.label,
    link.attrs?.class,
    link.attrs?.id,
    link.attrs?.role,
    link.attrs?.['aria-label'],
    link.attrs?.title,
    link.attrs?.['data-testid'],
    link.attrs?.['data-e2e'],
  ].join(' ').toLowerCase();
  if (/(?:^|[/?#:_\s-])(?:follow|following|followed|followers)(?=$|[/?#:_\s-])|\u5173\u6ce8|\u7c89\u4e1d/u.test(text)) return 'following_list';
  if (/搜索|搜书|检索/u.test(text)) return 'search';
  if (/分类|类别|频道|书库|书城/u.test(text)) return 'category';
  if (/标签|话题/u.test(text)) return 'tag';
  if (/排行|榜单|热门|最新|新书/u.test(text)) return 'ranking';
  if (/文章|资讯|新闻/u.test(text)) return 'article';
  if (/小说|书籍|作品|章节|阅读/u.test(text)) return 'work';
  if (/作者|用户|作家|主页/u.test(text)) return 'profile';
  if (/详情|目录|书页/u.test(text)) return 'detail';
  if (/search|query|keyword|find|搜索|搜书|检索/u.test(text)) return 'search';
  if (/categor|genre|channel|section|classify|\bcat\b|分类|类别|频道|书库|书城/u.test(text)) return 'category';
  if (/tag|topic|标签|话题/u.test(text)) return 'tag';
  if (/rank|ranking|top|hot|popular|trending|latest|new|recent|排行|榜单|热门|最新|新书/u.test(text)) return 'ranking';
  if (/repository|repositories|\brepos?\b|github|gitlab|source-code|source code|open-source|open source|code search/u.test(text)) return 'repository';
  if (/article|story|news|post|blog|文章|资讯|新闻/u.test(text)) return 'article';
  if (/\b(?:book|books|novel|fiction|chapter|reader|work|works)\b|小说|书籍|作品|章节|阅读/u.test(text)) return 'work';
  if (/video|watch|movie|media/u.test(text)) return 'media';
  if (/author|profile|user|org|organization|people|actor|model|star|作者|用户|作家/u.test(text)) return 'profile';
  if (/detail|item|product|content|详情|目录|书页/u.test(text)) return 'detail';
  return 'navigation';
}

function structureTypeForSemanticKind(kind) {
  if (kind === 'search') return 'search_route_group';
  if (kind === 'category') return 'category_link_group';
  if (kind === 'tag') return 'tag_link_group';
  if (kind === 'ranking') return 'ranking_link_group';
  if (kind === 'following_list' || kind === 'followed_channel') return 'following_list_link_group';
  if (kind === 'repository') return 'repository_link_group';
  if (kind === 'article') return 'article_link_group';
  if (kind === 'work') return 'work_link_group';
  if (kind === 'media') return 'media_link_group';
  if (kind === 'profile') return 'profile_link_group';
  if (kind === 'detail') return 'detail_link_group';
  return 'navigation_link_group';
}

function elementRoleForSemanticKind(kind) {
  if (kind === 'search') return 'search';
  if (kind === 'category') return 'category';
  if (kind === 'tag') return 'tag';
  if (kind === 'ranking') return 'ranking';
  if (kind === 'following_list' || kind === 'followed_channel') return 'following_list';
  if (kind === 'repository') return 'repository';
  if (kind === 'article') return 'article';
  if (kind === 'work') return 'work';
  if (kind === 'media') return 'media';
  if (kind === 'profile') return 'profile';
  if (kind === 'detail') return 'detail';
  return 'navigation';
}

export function extractElementInstances({
  links = /** @type {any[]} */ ([]),
  forms = /** @type {any[]} */ ([]),
  controls = /** @type {any[]} */ ([]),
} = /** @type {any} */ ({})) {
  const instances = /** @type {any[]} */ ([]);
  for (const [index, link] of links.entries()) {
    const semanticKind = link.semanticKind ?? semanticKindForLink(link);
    const label = sanitizeArtifactText(link.label, 100) || `link-${index + 1}`;
    instances.push({
      kind: 'link',
      role: elementRoleForSemanticKind(semanticKind),
      semanticKind,
      structureType: link.structureType ?? structureTypeForSemanticKind(semanticKind),
      label,
      selector: link.selector,
      href: link.href,
      sourceSameOrigin: link.sourceSameOrigin === true,
      routeTemplate: link.routeTemplate ?? routeTemplateForUrlMaybe(link.href),
      evidenceStatus: 'element_instance_summary_present',
      evidenceLevel: 'public_verified',
      rawDomPersisted: false,
      rawHtmlPersisted: false,
      bodyTextPersisted: false,
    });
  }
  for (const [index, form] of forms.entries()) {
    const label = sanitizeArtifactText(form.label, 100) || `form-${index + 1}`;
    instances.push({
      kind: 'form',
      role: /search|query|keyword|find/u.test(`${label} ${form.action ?? ''}`.toLowerCase()) ? 'search' : 'form',
      semanticKind: /search|query|keyword|find/u.test(`${label} ${form.action ?? ''}`.toLowerCase()) ? 'search' : 'navigation',
      structureType: /search|query|keyword|find/u.test(`${label} ${form.action ?? ''}`.toLowerCase()) ? 'search_control_group' : 'form_control_group',
      label,
      selector: form.selector,
      method: form.method,
      action: form.action,
      routeTemplate: routeTemplateForUrlMaybe(form.action),
      inputCount: Array.isArray(form.inputs) ? form.inputs.length : 0,
      evidenceStatus: 'element_instance_summary_present',
      evidenceLevel: 'public_verified',
      rawDomPersisted: false,
      rawHtmlPersisted: false,
      bodyTextPersisted: false,
    });
  }
  for (const [index, control] of controls.entries()) {
    const label = sanitizeArtifactText(control.label ?? control.name, 100) || `control-${index + 1}`;
    instances.push({
      kind: control.kind ?? 'control',
      role: /search|query|keyword|find/u.test(`${label} ${control.name ?? ''}`.toLowerCase()) ? 'search' : 'control',
      semanticKind: /search|query|keyword|find/u.test(`${label} ${control.name ?? ''}`.toLowerCase()) ? 'search' : 'navigation',
      structureType: /search|query|keyword|find/u.test(`${label} ${control.name ?? ''}`.toLowerCase()) ? 'search_control' : 'control',
      label,
      selector: control.selector,
      controlType: control.type,
      evidenceStatus: 'element_instance_summary_present',
      evidenceLevel: 'public_verified',
      rawDomPersisted: false,
      rawHtmlPersisted: false,
      bodyTextPersisted: false,
    });
  }
  return instances.slice(0, 160);
}

function repeatedRouteTemplateGroups(links = /** @type {any[]} */ ([])) {
  const groups = new Map();
  for (const link of links) {
    const template = routeTemplateForUrlMaybe(link.href);
    if (!template || template === '/') {
      continue;
    }
    const current = groups.get(template) ?? [];
    current.push(link);
    groups.set(template, current);
  }
  return [...groups.entries()]
    .filter(([, groupLinks]) => groupLinks.length >= 2)
    .sort(([leftTemplate, leftLinks], [rightTemplate, rightLinks]) => (
      rightLinks.length - leftLinks.length || leftTemplate.localeCompare(rightTemplate, 'en')
    ));
}

export function extractStructureSummary(html, baseUrl, {
  links = /** @type {any[]} */ ([]),
  forms = /** @type {any[]} */ ([]),
  controls = /** @type {any[]} */ ([]),
} = /** @type {any} */ ({})) {
  const raw = String(html ?? '').replace(/<script\b[\s\S]*?<\/script>/giu, ' ').replace(/<style\b[\s\S]*?<\/style>/giu, ' ');
  const visibleText = stripHtml(raw);
  const listItemCount = countMatches(raw, /<li\b/giu)
    + countMatches(raw, /<article\b/giu)
    + countMatches(raw, /<tr\b/giu)
    + countMatches(raw, /\brole\s*=\s*["']?listitem\b/giu)
    + countMatches(raw, /\bclass\s*=\s*["'][^"']*(?:card|item|entry|result|repo|repository|book|work|article|story|product|video|media)[^"']*["']/giu);
  const repeatedTemplates = repeatedRouteTemplateGroups(links);
  const routeTemplates = [...new Set([
    ...links.map((link) => routeTemplateForUrlMaybe(link.href)).filter(Boolean),
    ...forms.map((form) => routeTemplateForUrlMaybe(form.action)).filter(Boolean),
  ])].slice(0, 80).sort((left, right) => left.localeCompare(right, 'en'));
  const listPresent = listItemCount >= 3 || repeatedTemplates.length > 0 || /<ul\b|<ol\b|<table\b|\brole\s*=\s*["']?list\b/iu.test(raw);
  const emptyStatePresent = /no results|nothing found|empty state|no items|暂无|没有结果|无结果/u.test(visibleText);
  const visibleItemCount = Math.min(200, Math.max(
    listItemCount,
    repeatedTemplates.reduce((sum, [, groupLinks]) => sum + groupLinks.length, 0),
  ));
  const structureItems = /** @type {any[]} */ ([]);
  const addItem = ({
    structureType,
    nodeType = 'content',
    itemLinks = /** @type {any[]} */ ([]),
    count = itemLinks.length,
    confidence = 0.68,
  }) => {
    if (!structureType || count <= 0) {
      return;
    }
    const templates = [...new Set(itemLinks.map((link) => routeTemplateForUrlMaybe(link.href)).filter(Boolean))]
      .slice(0, 20)
      .sort((left, right) => left.localeCompare(right, 'en'));
    const labels = itemLinks.map((link) => sanitizeArtifactText(link.label, 48)).filter(Boolean).slice(0, 4);
    structureItems.push({
      nodeType,
      structureType,
      visibleItemCount: Math.min(200, count),
      listPresent: count >= 2 || /list|group|collection|navigation/u.test(structureType),
      emptyStatePresent: false,
      routeTemplates: templates,
      labelSummary: labels.length ? `${structureType}: ${labels.join(', ')}` : structureType,
      evidenceLevel: 'public_verified',
      evidenceStatus: 'structure_summary_present',
      riskLevel: 'read_public_low',
      confidence,
    });
  };

  if (links.length >= 5) {
    addItem({
      structureType: 'navigation_link_group',
      itemLinks: links.slice(0, 40),
      count: links.length,
      confidence: 0.7,
    });
  }

  for (const [template, itemLinks] of repeatedTemplates.slice(0, 12)) {
    addItem({
      structureType: template.includes(':id') ? 'detail_link_group' : 'collection_link_group',
      itemLinks,
      count: itemLinks.length,
      confidence: 0.74,
    });
  }

  const linksByKind = new Map();
  for (const link of links) {
    const kind = semanticKindForLink(link);
    const group = linksByKind.get(kind) ?? [];
    group.push(link);
    linksByKind.set(kind, group);
  }
  for (const [kind, itemLinks] of [...linksByKind.entries()].sort(([left], [right]) => left.localeCompare(right, 'en'))) {
    if (kind === 'navigation' || itemLinks.length < 2) {
      continue;
    }
    addItem({
      structureType: structureTypeForSemanticKind(kind),
      nodeType: kind === 'search' ? 'operation' : 'content',
      itemLinks,
      count: itemLinks.length,
      confidence: 0.72,
    });
  }

  const searchLikeControls = [
    ...forms.filter((form) => /search|query|keyword|find/u.test(`${form.label ?? ''} ${form.action ?? ''} ${form.textSummary ?? ''}`.toLowerCase())),
    ...controls.filter((control) => /search|query|keyword|find/u.test(`${control.label ?? ''} ${control.name ?? ''} ${control.type ?? ''}`.toLowerCase())),
  ];
  if (searchLikeControls.length) {
    structureItems.push({
      nodeType: 'operation',
      structureType: 'search_control_group',
      visibleItemCount: searchLikeControls.length,
      listPresent: false,
      emptyStatePresent: false,
      routeTemplates: [],
      labelSummary: 'search controls',
      evidenceLevel: 'public_verified',
      evidenceStatus: 'structure_summary_present',
      riskLevel: 'read_public_low',
      confidence: 0.76,
    });
  }

  if (listPresent && !structureItems.some((item) => item.structureType === 'static_list_summary')) {
    structureItems.push({
      nodeType: 'content',
      structureType: 'static_list_summary',
      visibleItemCount,
      listPresent: true,
      emptyStatePresent,
      routeTemplates: routeTemplates.slice(0, 20),
      labelSummary: `static list summary; items=${visibleItemCount}`,
      evidenceLevel: 'public_verified',
      evidenceStatus: 'structure_summary_present',
      riskLevel: 'read_public_low',
      confidence: 0.66,
    });
  }

  return {
    listPresent,
    visibleItemCount,
    emptyStatePresent,
    routeTemplates,
    structureItems: structureItems.slice(0, 40),
  };
}

export function parseHtmlDocument(html, baseUrl) {
  const title = extractTitle(html);
  const canonicalUrl = extractCanonicalUrl(html, baseUrl);
  const links = extractLinks(html, baseUrl);
  const forms = extractForms(html, baseUrl);
  const allControls = extractControls(html, baseUrl);
  const formControlSelectors = new Set(forms.flatMap((form) => [
    ...form.inputs.map((control) => control.selector),
    ...form.buttons.map((control) => control.selector),
  ]));
  const controls = allControls.filter((control) => !formControlSelectors.has(control.selector));
  const summary = textSummary(html);
  const structureSummary = extractStructureSummary(html, baseUrl, { links, forms, controls });
  const elementInstances = extractElementInstances({ links, forms, controls });
  return {
    title,
    canonicalUrl,
    textSummary: summary,
    links,
    forms,
    controls,
    listPresent: structureSummary.listPresent,
    visibleItemCount: structureSummary.visibleItemCount,
    emptyStatePresent: structureSummary.emptyStatePresent,
    routeTemplates: structureSummary.routeTemplates,
    structureItems: structureSummary.structureItems,
    elementInstances,
    diagnostics: staticHtmlDiagnostics(html, {
      title,
      textSummary: summary,
      links,
      forms,
      controls,
    }),
  };
}

export function parseRobotsSitemaps(robotsText, baseUrl) {
  const urls = /** @type {any[]} */ ([]);
  for (const line of String(robotsText ?? '').split(/\r?\n/u)) {
    const match = line.match(/^\s*Sitemap\s*:\s*(\S+)\s*$/iu);
    if (!match) {
      continue;
    }
    const resolved = resolveUrlMaybe(match[1], baseUrl);
    if (resolved) {
      urls.push(resolved);
    }
  }
  return [...new Set(urls)].sort((left, right) => left.localeCompare(right, 'en'));
}

function stripRobotsComment(line) {
  const hashIndex = String(line ?? '').indexOf('#');
  return (hashIndex === -1 ? String(line ?? '') : String(line ?? '').slice(0, hashIndex)).trim();
}

function parseRobotsDirective(line) {
  const match = stripRobotsComment(line).match(/^([a-zA-Z-]+)\s*:\s*(.*?)\s*$/u);
  if (!match) {
    return null;
  }
  return {
    name: match[1].toLowerCase(),
    value: match[2],
  };
}

export function parseRobotsPolicy(robotsText, baseUrl, userAgent = 'SiteForgeBuildStaticCrawler') {
  const groups = /** @type {any[]} */ ([]);
  const sitemaps = /** @type {any[]} */ ([]);
  let currentGroup = /** @type {null | { agents: string[], rules: any[], crawlDelaySeconds?: number }} */ (null);
  let currentGroupHasRules = false;

  for (const line of String(robotsText ?? '').split(/\r?\n/u)) {
    const directive = parseRobotsDirective(line);
    if (!directive) {
      continue;
    }
    if (directive.name === 'sitemap') {
      const resolved = resolveUrlMaybe(directive.value, baseUrl);
      if (resolved) {
        sitemaps.push(resolved);
      }
      continue;
    }
    if (directive.name === 'user-agent') {
      if (!currentGroup || currentGroupHasRules) {
        currentGroup = { agents: [], rules: [] };
        groups.push(currentGroup);
        currentGroupHasRules = false;
      }
      currentGroup.agents.push(directive.value.toLowerCase());
      continue;
    }
    if (directive.name === 'crawl-delay' && currentGroup) {
      const seconds = Number.parseFloat(directive.value);
      if (Number.isFinite(seconds) && seconds >= 0) {
        currentGroup.crawlDelaySeconds = seconds;
      }
      continue;
    }
    if ((directive.name === 'allow' || directive.name === 'disallow') && currentGroup) {
      currentGroup.rules.push({
        type: directive.name,
        path: directive.value,
      });
      currentGroupHasRules = true;
    }
  }

  return {
    userAgent,
    baseUrl,
    sitemaps: [...new Set(sitemaps)].sort((left, right) => left.localeCompare(right, 'en')),
    groups,
    disallowPaths: [...new Set(groups.flatMap((group) => (
      group.rules
        .filter((rule) => rule.type === 'disallow' && rule.path)
        .map((rule) => rule.path)
    )))].sort((left, right) => left.localeCompare(right, 'en')),
  };
}

export function selectRobotsGroups(policy, userAgent) {
  const agent = String(userAgent ?? policy?.userAgent ?? 'SiteForgeBuildStaticCrawler').toLowerCase();
  const groups = Array.isArray(policy?.groups) ? policy.groups : [];
  const exact = groups.filter((group) => (group.agents ?? []).some((candidate) => (
    candidate !== '*' && (agent === candidate || agent.includes(candidate) || candidate.includes(agent))
  )));
  if (exact.length) {
    return {
      userAgent: agent,
      groups: exact,
      matchType: 'exact',
      fallbackToWildcard: false,
    };
  }
  const wildcard = groups.filter((group) => (group.agents ?? []).includes('*'));
  return {
    userAgent: agent,
    groups: wildcard,
    matchType: wildcard.length ? 'wildcard' : 'none',
    fallbackToWildcard: wildcard.length > 0,
  };
}

function matchingRobotsRules(policy, userAgent) {
  return selectRobotsGroups(policy, userAgent).groups.flatMap((group) => group.rules ?? []);
}

function robotsPatternToRegex(pattern) {
  const escaped = String(pattern ?? '')
    .replace(/[.+?^${}()|[\]\\]/gu, '\\$&')
    .replace(/\*/gu, '.*');
  if (escaped.endsWith('$')) {
    return new RegExp(`^${escaped.slice(0, -1)}$`, 'u');
  }
  return new RegExp(`^${escaped}`, 'u');
}

export function robotsDecisionForUrl(urlValue, policy, userAgent = undefined) {
  if (!policy) {
    return {
      allowed: true,
      matchedRule: null,
      path: null,
      userAgent: String(userAgent ?? 'SiteForgeBuildStaticCrawler').toLowerCase(),
      matchType: 'none',
      fallbackToWildcard: false,
      rulePrecedence: 'longest_path_then_allow_tie',
    };
  }
  let parsed;
  try {
    parsed = new URL(urlValue, policy.baseUrl);
  } catch {
    return {
      allowed: false,
      matchedRule: null,
      path: null,
      userAgent: String(userAgent ?? policy?.userAgent ?? 'SiteForgeBuildStaticCrawler').toLowerCase(),
      matchType: 'invalid_url',
      fallbackToWildcard: false,
      rulePrecedence: 'longest_path_then_allow_tie',
    };
  }
  const pathAndSearch = `${parsed.pathname}${parsed.search}`;
  let bestRule = null;
  const selected = selectRobotsGroups(policy, userAgent);
  for (const rule of selected.groups.flatMap((group) => group.rules ?? [])) {
    const rulePath = String(rule.path ?? '');
    if (!rulePath) {
      continue;
    }
    if (!robotsPatternToRegex(rulePath).test(pathAndSearch)) {
      continue;
    }
    if (
      !bestRule
      || rulePath.length > String(bestRule.path ?? '').length
      || (rulePath.length === String(bestRule.path ?? '').length && rule.type === 'allow')
    ) {
      bestRule = rule;
    }
  }
  return {
    allowed: bestRule?.type !== 'disallow',
    matchedRule: bestRule
      ? {
        type: bestRule.type,
        path: bestRule.path,
        length: String(bestRule.path ?? '').length,
      }
      : null,
    path: pathAndSearch,
    userAgent: selected.userAgent,
    matchType: selected.matchType,
    fallbackToWildcard: selected.fallbackToWildcard,
    rulePrecedence: 'longest_path_then_allow_tie',
  };
}

export function isUrlAllowedByRobots(urlValue, policy, userAgent = undefined) {
  return robotsDecisionForUrl(urlValue, policy, userAgent).allowed;
}

export function parseSitemapUrls(sitemapText, baseUrl) {
  const urls = /** @type {any[]} */ ([]);
  const pattern = /<loc\b[^>]*>([\s\S]*?)<\/loc>/giu;
  let match;
  while ((match = pattern.exec(String(sitemapText ?? ''))) !== null) {
    const resolved = resolveUrlMaybe(stripHtml(match[1]), baseUrl);
    if (resolved) {
      urls.push(resolved);
    }
  }
  return [...new Set(urls)].sort((left, right) => left.localeCompare(right, 'en'));
}

export function routePatternForUrl(urlValue) {
  const parsed = new URL(urlValue);
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    return '/';
  }
  const mapped = segments.map((segment) => (
    /\d/u.test(segment) || /^[a-f0-9]{8,}$/iu.test(segment)
      ? ':id'
      : segment.replace(/\.[a-z0-9]+$/iu, '')
  ));
  return `/${mapped.join('/')}`;
}
