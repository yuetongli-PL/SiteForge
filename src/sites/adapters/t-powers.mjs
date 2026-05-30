// @ts-check

import { cleanText } from '../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../domain/capabilities/api-candidates.mjs';
import { createCatalogAdapter } from './factory.mjs';
import { endpointParts } from './url-parts.mjs';

export const T_POWERS_HOSTS = Object.freeze([
  'www.t-powers.co.jp',
  't-powers.co.jp',
]);

export const T_POWERS_TERMINOLOGY = Object.freeze({
  entityLabel: 'release',
  entityPlural: 'releases',
  personLabel: 'talent',
  personPlural: 'talents',
  searchLabel: 'search talents',
  openEntityLabel: 'open release page',
  openPersonLabel: 'open talent profile',
  downloadLabel: 'download disabled',
  verifiedTaskLabel: 'release / talent / topic / event',
});

export const T_POWERS_INTENT_LABELS = Object.freeze({
  'search-talent': 'search talents',
  'search-author': 'search talents',
  'open-talent': 'open talent profile',
  'open-author': 'open talent profile',
  'open-release': 'open release page',
  'open-book': 'open release page',
  'open-topic': 'open topic page',
  'open-category': 'open archive page',
  'open-event': 'open event page',
  'open-utility-page': 'open utility page',
  'open-auth-page': 'open age gate or blocked page',
  'browse-release-archive': 'browse release archive',
  'browse-topics': 'browse topics',
  'browse-events': 'browse events',
});

const READ_ONLY_METHODS = new Set(['GET', 'HEAD']);
const T_POWERS_REST_CATALOG_SEGMENTS = Object.freeze([
  'categories',
  'pages',
  'posts',
  'search',
  'tags',
]);
const T_POWERS_BLOCKED_REST_SEGMENTS = Object.freeze([
  'comments',
  'media',
  'settings',
  'users',
]);

function normalizePathname(pathname) {
  const raw = String(pathname ?? '').trim() || '/';
  const prefixed = raw.startsWith('/') ? raw : `/${raw}`;
  const normalized = prefixed.replace(/\/{2,}/gu, '/').replace(/\/+$/u, '') || '/';
  return normalized.toLowerCase();
}

function endpointMethod(candidate = /** @type {any} */ ({})) {
  return String(candidate?.endpoint?.method ?? 'GET').trim().toUpperCase();
}

function isReadOnlyMethod(candidate = /** @type {any} */ ({})) {
  return READ_ONLY_METHODS.has(endpointMethod(candidate));
}

function isTPowersHost(host) {
  return T_POWERS_HOSTS.includes(String(host ?? '').trim().toLowerCase());
}

function isTPowersRestPath(pathname) {
  const normalized = normalizePathname(pathname);
  const restPath = normalized.startsWith('/wp2021/wp-json/')
    ? normalized.slice('/wp2021/wp-json'.length)
    : normalized.startsWith('/wp-json/')
      ? normalized.slice('/wp-json'.length)
      : '';
  if (!restPath) {
    return false;
  }
  const segments = restPath.split('/').filter(Boolean);
  if (segments.some((segment) => T_POWERS_BLOCKED_REST_SEGMENTS.includes(segment))) {
    return false;
  }
  return segments.some((segment) => T_POWERS_REST_CATALOG_SEGMENTS.includes(segment));
}

function isHtmlListPath(pathname) {
  const normalized = normalizePathname(pathname);
  return normalized === '/'
    || normalized === '/release'
    || /^\/release\/\d{4}\/\d{2}$/u.test(normalized)
    || normalized === '/talent'
    || normalized.startsWith('/talent/')
    || normalized === '/topics'
    || normalized.startsWith('/topics/')
    || normalized === '/event'
    || normalized.startsWith('/event/')
    || normalized === '/blog'
    || normalized === '/company'
    || normalized === '/contact'
    || normalized === '/link'
    || normalized === '/recruit';
}

export function inferTPowersPageType({ pathname = '' } = /** @type {any} */ ({})) {
  const normalized = normalizePathname(pathname);
  if (normalized === '/') {
    return 'home';
  }
  if (normalized === '/talent' || /^\/talent\/page\/\d+$/u.test(normalized)) {
    return 'author-list-page';
  }
  if (normalized.startsWith('/talent/')) {
    return 'author-page';
  }
  if (normalized === '/release' || /^\/release\/\d{4}\/\d{2}$/u.test(normalized)) {
    return 'category-page';
  }
  if (normalized === '/topics' || /^\/topics(?:\/(?:column|media|event|release|talent|page\/\d+|\d{4}\/\d{2}))?$/u.test(normalized)) {
    return 'category-page';
  }
  if (/^\/topics\/\d+(?:\/|$)/u.test(normalized)) {
    return 'content-detail-page';
  }
  if (normalized === '/event' || /^\/event\/\d{4}\/\d{2}$/u.test(normalized)) {
    return 'category-page';
  }
  if (/^\/event\/\d+(?:\/|$)/u.test(normalized)) {
    return 'content-detail-page';
  }
  if (normalized === '/blog') {
    return 'category-page';
  }
  if (['/company', '/contact', '/link', '/recruit', '/recruit/contact'].includes(normalized)) {
    return 'utility-page';
  }
  return null;
}

export function isTPowersApiCandidate(candidate = /** @type {any} */ ({})) {
  const siteKey = String(candidate?.siteKey ?? '').trim();
  const { host, pathname } = endpointParts(candidate);
  return siteKey === 't-powers'
    && isTPowersHost(host)
    && isReadOnlyMethod(candidate)
    && isTPowersRestPath(pathname)
    && !isHtmlListPath(pathname);
}

export const tPowersAdapter = createCatalogAdapter({
  id: 't-powers',
  hosts: T_POWERS_HOSTS,
  terminology: T_POWERS_TERMINOLOGY,
  intentLabels: T_POWERS_INTENT_LABELS,
  inferPageType: inferTPowersPageType,
  normalizeDisplayLabel: ({ value }) => cleanText(value),
  validateApiCandidate({
    candidate,
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    validatedAt,
  } = /** @type {any} */ ({})) {
    const { host, pathname } = endpointParts(candidate);
    const accepted = isTPowersApiCandidate(candidate);
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 't-powers',
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 't-powers-readonly-rest-api',
        endpointHost: host,
        endpointPath: pathname,
        endpointMethod: endpointMethod(candidate),
        ...scope,
      },
      evidence,
    }, { candidate });
  },
  getApiCatalogUpgradePolicy({
    candidate,
    siteAdapterDecision,
    evidence = /** @type {any} */ ({}),
    scope = /** @type {any} */ ({}),
    decidedAt,
  } = /** @type {any} */ ({})) {
    const { host, pathname } = endpointParts(candidate);
    const accepted = siteAdapterDecision?.decision === 'accepted' && isTPowersApiCandidate(candidate);
    return normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 't-powers',
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 't-powers-readonly-rest-api',
        endpointHost: host,
        endpointPath: pathname,
        endpointMethod: endpointMethod(candidate),
        ...scope,
      },
      evidence,
    }, {
      candidate,
      siteAdapterDecision,
    });
  },
});
