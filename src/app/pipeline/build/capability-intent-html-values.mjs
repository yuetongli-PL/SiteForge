// @ts-check

import {
  sanitizeReportPublicValue,
  sanitizeReportString,
} from './user-report-values.mjs';

export const HTML_REPORT_MAX_EXAMPLES = 3;
export const HTML_REPORT_FORBIDDEN_PATTERNS = Object.freeze([
  { code: 'authorization', pattern: /\bauthorization\b/iu },
  { code: 'bearer', pattern: /\bbearer\b/iu },
  { code: 'local-storage', pattern: /\blocalStorage\b/u },
  { code: 'session-storage', pattern: /\bsessionStorage\b/u },
  { code: 'user-data-dir', pattern: /\buserDataDir\b/u },
  { code: 'browser-profile', pattern: /\bbrowser profile\b/iu },
  { code: 'secret-fixture', pattern: /synthetic-secret/iu },
  { code: 'session-id', pattern: /sessionid\s*=/iu },
  { code: 'cookie-value', pattern: /\b(?:cookie|sid|uid|session|token)\s*=/iu },
  { code: 'script-tag', pattern: /<script\b/iu },
]);

function normalizeStatusToken(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function sanitizeHtmlReportUrl(value) {
  const text = String(value ?? '');
  try {
    const parsed = new URL(text);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return text;
  }
}

export function sanitizeHtmlReportString(value) {
  let text = sanitizeReportString(value);
  text = text.replace(/https?:\/\/[^\s<>"')]+/giu, (match) => sanitizeHtmlReportUrl(match));
  text = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu, '[REDACTED_AUTH]')
    .replace(/\bauthorization\s*[:=]\s*[^\r\n]+/giu, '[REDACTED_AUTH_HEADER]')
    .replace(/\bauthorization\b/giu, '[REDACTED_AUTH_HEADER]')
    .replace(/\bcookies?\s*[:=]\s*[^;\s&'",]+/giu, '[REDACTED_BROWSER_SESSION]')
    .replace(/\b(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|secret|password|session[_-]?id|sid)\s*[:=]\s*[^&\s;'",]+/giu, '[REDACTED_SECRET]')
    .replace(/\bBearer\b/giu, '[REDACTED_AUTH]')
    .replace(/\blocalStorage\b/gu, '[REDACTED_BROWSER_STORAGE]')
    .replace(/\bsessionStorage\b/gu, '[REDACTED_BROWSER_STORAGE]')
    .replace(/\buserDataDir\b/gu, '[REDACTED_BROWSER_STATE]')
    .replace(/\bbrowser\s+profile\b/giu, '[REDACTED_BROWSER_STATE]')
    .replace(/raw[-_\s]*(?:dom|html|body)/giu, '[REDACTED_PAGE_SOURCE]')
    .replace(/<\/?html(?:\s[^>]*)?>/giu, '[REDACTED_PAGE_SOURCE]');
  return text;
}

export function sanitizeHtmlReportValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeHtmlReportValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/^(?:cookies?|headers?|authorization|token|tokens|profile|userDataDir|localStorage|sessionStorage)$/iu.test(key))
      .map(([key, item]) => [sanitizeHtmlReportString(key), sanitizeHtmlReportValue(item)]));
  }
  return typeof value === 'string' ? sanitizeHtmlReportString(value) : value;
}

export function sanitizeCapabilityIntentHtmlPayload(payload) {
  return sanitizeHtmlReportValue(sanitizeReportPublicValue(payload));
}

export function escapeHtml(value) {
  const text = value === null || value === undefined || value === '' ? '-' : sanitizeHtmlReportString(value);
  return String(text)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

export function htmlCell(value, { code = false } = /** @type {any} */ ({})) {
  const escaped = escapeHtml(value);
  return code ? `<code>${escaped}</code>` : escaped;
}

export function htmlList(values = /** @type {any[]} */ ([]), { code = true, limit = 8 } = /** @type {any} */ ({})) {
  const items = Array.isArray(values) ? values.filter((item) => item !== null && item !== undefined && item !== '') : [];
  if (!items.length) {
    return '<span class="muted">-</span>';
  }
  const rendered = items.slice(0, limit).map((item) => (
    code ? `<code>${escapeHtml(item)}</code>` : `<span>${escapeHtml(item)}</span>`
  ));
  if (items.length > limit) {
    rendered.push(`<span class="muted">+${items.length - limit}</span>`);
  }
  return rendered.join(' ');
}

export function htmlBadge(value, kind = 'muted') {
  const safeKind = /^[a-z0-9_-]+$/u.test(String(kind ?? '')) ? kind : 'muted';
  return `<span class="badge badge-${safeKind}">${escapeHtml(value ?? '-')}</span>`;
}

export function htmlStatusBadge(value) {
  const status = normalizeStatusToken(value);
  if (['active', 'enabled', 'success', 'passed'].includes(status)) return htmlBadge(value, 'success');
  if (['limited_enabled'].includes(status)) return htmlBadge(value, 'limited');
  if (['confirmation_required', 'draft_only', 'candidate', 'candidate_debug_only', 'partial_success'].includes(status)) return htmlBadge(value, 'warning');
  if (['disabled', 'failed', 'blocked'].includes(status)) return htmlBadge(value, 'danger');
  return htmlBadge(value ?? '-', 'muted');
}

export function htmlRiskBadge(value) {
  const risk = normalizeStatusToken(value);
  if (['write_high', 'account_security_critical', 'read_private_high'].includes(risk)) return htmlBadge(value, 'risk');
  if (['write_low', 'read_personal_medium'].includes(risk)) return htmlBadge(value, 'warning');
  if (['read_public_low'].includes(risk)) return htmlBadge(value, 'success');
  return htmlBadge(value ?? '-', 'muted');
}

export function htmlAuthBadge(value) {
  return htmlBadge(value ?? '-', 'auth');
}
