// @ts-check

import path from 'node:path';

const EDGE_PUNCTUATION_CLASS = String.raw`\s"'~!@#$%^&*()\-_=+\[\]{}\\|;:,.<>/?\u300a\u300b\u3008\u3009\u300c\u300d\u300e\u300f\u3010\u3011\u3014\u3015\uff08\uff09\u201c\u201d\u2018\u2019閿涘被鈧偊绱掗敍鐔粹偓渚婄幢閿涙埃鈧壕鈧績鈧ǚ鈧瑣鈧劑鈧埊绱欓敍澶堚偓濞库偓濯嘸;`;
const EDGE_PUNCTUATION_REGEX = new RegExp(`^[${EDGE_PUNCTUATION_CLASS}]+|[${EDGE_PUNCTUATION_CLASS}]+$`, 'gu');

export function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

export function normalizeText(value) {
  return normalizeWhitespace(String(value ?? '').normalize('NFKC'));
}

export function cleanText(value) {
  return normalizeText(value)
    .replace(EDGE_PUNCTUATION_REGEX, '')
    .trim();
}

export function normalizeUrlNoFragment(input) {
  if (!input) {
    return null;
  }
  try {
    const parsed = new URL(input);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(input).split('#')[0];
  }
}

export function sanitizeHost(host) {
  return (host || 'unknown-host').replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unknown-host';
}

export function slugifyAscii(value, fallback = 'item') {
  const normalized = normalizeText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return normalized || fallback;
}

export function compactSlug(value, fallback = 'item', maxLength = 96) {
  const slug = slugifyAscii(value, fallback);
  return slug.length <= maxLength ? slug : slug.slice(0, maxLength).replace(/-+$/g, '') || fallback;
}

export function compareNullableStrings(left, right) {
  return String(left ?? '').localeCompare(String(right ?? ''), 'en');
}

export function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export function firstNonEmpty(values) {
  for (const value of values ?? []) {
    if (value === undefined || value === null) {
      continue;
    }
    const normalized = normalizeWhitespace(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

export function uniqueSortedStrings(values, locale = 'en') {
  return [...new Set(toArray(values).filter(Boolean).map((value) => String(value)))].sort((left, right) => left.localeCompare(right, locale));
}

export function uniqueSortedPaths(values) {
  return [...new Set(toArray(values).filter(Boolean).map((value) => path.resolve(String(value))))].sort(compareNullableStrings);
}

export function toPosixPath(value) {
  return String(value ?? '').split(path.sep).join('/');
}

export function relativePath(fromPath, targetPath) {
  return toPosixPath(path.relative(path.dirname(fromPath), targetPath) || path.basename(targetPath));
}

export function hostFromUrl(inputUrl) {
  try {
    return new URL(inputUrl).host;
  } catch {
    return null;
  }
}
