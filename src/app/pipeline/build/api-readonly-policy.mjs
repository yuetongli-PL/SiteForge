// @ts-check

import { isSensitiveFieldName } from '../../../domain/sessions/security-guard.mjs';

export const READ_ONLY_API_METHODS = Object.freeze(['GET', 'HEAD']);

export const API_READ_ONLY_CHALLENGE_PATTERN = /(?:captcha|challenge|verify|verification|required login|login required|sign in|signin|log in|forbidden|access denied|permission denied|risk|anti[- ]?bot|blocked)/iu;

const READ_ONLY_METHOD_SET = new Set(READ_ONLY_API_METHODS);
const SENSITIVE_QUERY_PATTERN = /^(?:auth|authorization|sid|sessdata|csrf|xsrf|secret|password|pass|signature|sign|access[_-]?token|refresh[_-]?token|session(?:[_-]?id)?|api[_-]?key|xsec[_-]?token)$/iu;
const WRITE_PATH_PATTERN = /(?:^|[/_.-])(?:create|delete|destroy|remove|update|edit|mutate|mutation|post|publish|submit|send|upload|follow|unfollow|like|repost|checkout|pay|order|login|logout|signin|signout)(?:$|[/_.-])/iu;

export function normalizeApiMethod(value, fallback = 'GET') {
  const method = String(value ?? fallback).trim().toUpperCase();
  return method || String(fallback ?? 'GET').trim().toUpperCase();
}

export function isReadOnlyApiMethod(method) {
  return READ_ONLY_METHOD_SET.has(normalizeApiMethod(method));
}

export function hasSubstantiveApiRequestBody(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    return Boolean(text) && !['[REDACTED]', 'null', 'undefined'].includes(text);
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  return true;
}

export function hasSensitiveApiQueryMaterial(urlValue, {
  invalidAsSensitive = false,
} = /** @type {any} */ ({})) {
  try {
    const parsed = new URL(String(urlValue ?? ''));
    for (const key of parsed.searchParams.keys()) {
      if (SENSITIVE_QUERY_PATTERN.test(key) || isSensitiveFieldName(key)) {
        return true;
      }
    }
    return /(?:%5Bredacted%5D|\[redacted\]|redacted)/iu.test(parsed.search);
  } catch {
    return invalidAsSensitive;
  }
}

export function isKnownReadOnlyApiEndpoint(parsedOrUrl, method) {
  const normalizedMethod = normalizeApiMethod(method);
  let parsed = parsedOrUrl;
  if (!(parsedOrUrl instanceof URL)) {
    try {
      parsed = new URL(String(parsedOrUrl ?? ''));
    } catch {
      return false;
    }
  }
  return normalizedMethod === 'GET'
    && parsed?.hostname === 'www.douyin.com'
    && parsed?.pathname === '/aweme/v1/web/aweme/post/';
}

export function apiEndpointLooksWriteLike({
  url,
  method = 'GET',
  extraText = '',
} = /** @type {any} */ ({})) {
  const text = String(extraText ?? '');
  try {
    const parsed = new URL(String(url ?? ''));
    if (isKnownReadOnlyApiEndpoint(parsed, method)) {
      return false;
    }
    return WRITE_PATH_PATTERN.test(`${parsed.pathname} ${parsed.search} ${text}`);
  } catch {
    return WRITE_PATH_PATTERN.test(`${String(url ?? '')} ${text}`);
  }
}
