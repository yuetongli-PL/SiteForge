// @ts-check

import path from 'node:path';

export function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

export function normalizeText(value) {
  return normalizeWhitespace(String(value ?? '').normalize('NFKC'));
}

export function cleanText(value) {
  return normalizeText(value)
    .replace(/^[\s"'~!@#$%^&*()\-_=+\[\]{}\\|;:,.<>/?，。！？、；：“”‘’【】（）《》]+/gu, '')
    .replace(/[\s"'~!@#$%^&*()\-_=+\[\]{}\\|;:,.<>/?，。！？、；：“”‘’【】（）《》]+$/gu, '')
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
