// @ts-check

import {
  REDACTION_PLACEHOLDER,
  isSensitiveFieldName,
} from './security-guard.mjs';

const FRESH_EVIDENCE_FORBIDDEN_HEADER_NAMES = Object.freeze(new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'session-id',
  'sessdata',
  'x-access-token',
  'x-auth-token',
  'x-csrf-token',
  'x-refresh-token',
  'x-session-id',
  'x-xsrf-token',
]));

function normalizeText(value) {
  return String(value ?? '').trim();
}

function canonicalizeHeaderName(value) {
  const normalizedValue = normalizeText(value).toLowerCase();
  if (!normalizedValue) {
    return '';
  }
  const known = {
    cookie: 'Cookie',
    referer: 'Referer',
    origin: 'Origin',
    'user-agent': 'User-Agent',
    'accept-language': 'Accept-Language',
    'cache-control': 'Cache-Control',
  };
  if (known[normalizedValue]) {
    return known[normalizedValue];
  }
  return normalizedValue
    .split('-')
    .map((entry) => entry ? `${entry[0].toUpperCase()}${entry.slice(1)}` : '')
    .join('-');
}

/** @param {Record<string, any>} [headers] */
function normalizeHeaderEntries(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers ?? {})
      .map(([key, value]) => [canonicalizeHeaderName(key), normalizeText(value)])
      .filter(([key, value]) => key && value),
  );
}

export function isForbiddenFreshEvidenceHeaderName(name) {
  const normalizedName = normalizeText(name).toLowerCase();
  return FRESH_EVIDENCE_FORBIDDEN_HEADER_NAMES.has(normalizedName)
    || isSensitiveFieldName(normalizedName)
    || normalizedName.includes('authorization')
    || normalizedName.includes('cookie')
    || normalizedName.includes('csrf')
    || normalizedName.includes('xsrf')
    || normalizedName.includes('session')
    || normalizedName.includes('token')
    || normalizedName.includes('xsec_token')
    || normalizedName.includes('xsec-token')
    || normalizedName.includes('sessdata');
}

export function redactFreshEvidenceUrlTokens(value) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return '';
  }
  try {
    const parsed = new URL(normalizedValue);
    for (const key of [...parsed.searchParams.keys()]) {
      if (
        isSensitiveFieldName(key)
        || /^auth$/iu.test(key)
        || /(?:csrf|xsrf|session|token|xsec[_-]?token)/iu.test(key)
      ) {
        parsed.searchParams.set(key, REDACTION_PLACEHOLDER);
      }
    }
    return parsed.toString();
  } catch {
    return normalizedValue.replace(
      /((?:access_token|refresh_token|xsec_token|csrf(?:_token)?|xsrf(?:_token)?|session(?:_id)?|token|auth)=)(?!\[REDACTED\]|%5BREDACTED%5D)[^&\s;]+/giu,
      `$1${REDACTION_PLACEHOLDER}`,
    );
  }
}

/** @param {Record<string, any>} [headers] */
export function sanitizeFreshEvidenceHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(normalizeHeaderEntries(headers))
      .filter(([name]) => !isForbiddenFreshEvidenceHeaderName(name))
      .map(([name, value]) => [name, redactFreshEvidenceUrlTokens(value)]),
  );
}

export function freshEvidenceSafeHeaderNamesFromMaps(...maps) {
  return [...new Set(maps
    .flatMap((map) => Object.keys(sanitizeFreshEvidenceHeaders(map)))
    .filter(Boolean))]
    .sort();
}
