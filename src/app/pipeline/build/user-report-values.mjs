// @ts-check

import path from 'node:path';

const REPORT_ABSOLUTE_PATH_PATTERN = /(?:[A-Za-z]:\\Users\\|\/Users\/|\/home\/)[^\s"',;)]*/giu;
const REPORT_EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const REPORT_PHONE_PATTERN = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b|\b1[3-9]\d{9}\b/gu;
const REPORT_HANDLE_PATTERN = /(^|[^\w/])@[A-Za-z0-9_]{2,15}\b/gu;
const REPORT_BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gu;
const REPORT_SECRET_ASSIGNMENT_PATTERN = /\b(?:access_token|refresh_token|token|auth|api[_-]?key|secret|password|session(?:[_-]?id)?|sid)\s*[:=]\s*(?!\[REDACTED\]|%5BREDACTED%5D)[^&\s;'",]+/giu;
const REPORT_COOKIE_PATTERN = /\bcookie\s*[:=]\s*(?!\[REDACTED\]|%5BREDACTED%5D)[^;\s&'",]+/giu;
const REPORT_AUTH_HEADER_PATTERN = /\bauthorization\s*[:=]\s*(?!\[REDACTED\]|%5BREDACTED%5D)[^\r\n]+/giu;
const REPORT_RAW_MARKUP_PATTERN = /<html[\s>]|<\/html>|<!doctype\s+html|raw[-_\s]*(?:dom|html|body)/iu;

export function sanitizeReportString(value) {
  let text = String(value ?? '');
  if (REPORT_RAW_MARKUP_PATTERN.test(text)) {
    text = text.replace(REPORT_RAW_MARKUP_PATTERN, '[REDACTED_HTML]');
  }
  return text
    .replace(REPORT_ABSOLUTE_PATH_PATTERN, '[REDACTED_PATH]')
    .replace(REPORT_EMAIL_PATTERN, '[REDACTED_EMAIL]')
    .replace(REPORT_PHONE_PATTERN, '[REDACTED_PHONE]')
    .replace(REPORT_BEARER_PATTERN, '[REDACTED_AUTH]')
    .replace(REPORT_SECRET_ASSIGNMENT_PATTERN, '[REDACTED_SECRET]')
    .replace(REPORT_COOKIE_PATTERN, 'cookie=[REDACTED]')
    .replace(REPORT_AUTH_HEADER_PATTERN, 'authorization=[REDACTED]')
    .replace(REPORT_HANDLE_PATTERN, '$1[REDACTED_HANDLE]');
}

export function sanitizeReportPublicValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeReportPublicValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeReportPublicValue(item)]));
  }
  return typeof value === 'string' ? sanitizeReportString(value) : value;
}

export function relativeReportPath(cwd, value) {
  if (!value) {
    return null;
  }
  const relative = path.relative(cwd, value);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative.replace(/\\/gu, '/')
    : String(value).replace(/\\/gu, '/');
}
