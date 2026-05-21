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
  const warnings = /** @type {any[]} */ ([]);
  if (staticEvidenceStatus === 'dynamic_shell') {
    warnings.push('Static parser found only weak shell evidence and dynamic-site signals; browser-rendered crawl may be required.');
  }
  if (staticEvidenceStatus === 'empty') {
    warnings.push('Static parser found no usable title, text, links, forms, or controls.');
  }
  return {
    staticEvidenceStatus,
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
    links.push({
      href,
      rawHref: attrs.href,
      label: sanitizeArtifactText(match[2], 160) || sanitizeArtifactText(rawAttrs['aria-label'] ?? rawAttrs.title ?? '', 160),
      selector: selectorFor('a', attrs, index),
      attrs,
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
  return {
    title,
    canonicalUrl,
    textSummary: summary,
    links,
    forms,
    controls,
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
  let currentGroup = null;
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

function matchingRobotsRules(policy, userAgent) {
  const agent = String(userAgent ?? policy?.userAgent ?? 'SiteForgeBuildStaticCrawler').toLowerCase();
  const groups = Array.isArray(policy?.groups) ? policy.groups : [];
  const exact = groups.filter((group) => (group.agents ?? []).some((candidate) => (
    candidate !== '*' && (agent === candidate || agent.includes(candidate) || candidate.includes(agent))
  )));
  const selected = exact.length ? exact : groups.filter((group) => (group.agents ?? []).includes('*'));
  return selected.flatMap((group) => group.rules ?? []);
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

export function isUrlAllowedByRobots(urlValue, policy, userAgent = undefined) {
  if (!policy) {
    return true;
  }
  let parsed;
  try {
    parsed = new URL(urlValue, policy.baseUrl);
  } catch {
    return false;
  }
  const pathAndSearch = `${parsed.pathname}${parsed.search}`;
  let bestRule = null;
  for (const rule of matchingRobotsRules(policy, userAgent)) {
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
  return bestRule?.type !== 'disallow';
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
