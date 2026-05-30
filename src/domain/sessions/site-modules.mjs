// @ts-check

import {
  maybeLoadValidatedProfileForHost,
  resolveProfilePathForHost,
} from '../../sites/registry/core/profiles.mjs';
import { normalizeText, sanitizeHost } from '../../shared/normalize.mjs';

export const SESSION_SITE_DEFINITIONS = Object.freeze([
  {
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    verificationUrl: 'https://www.bilibili.com/',
    keepaliveUrl: 'https://www.bilibili.com/',
    requiredAuthSurfaces: ['/watchlater', '/favlist'],
    riskStopConditions: ['login-wall', 'captcha', 'network-identity-drift'],
  },
  {
    siteKey: 'douyin',
    host: 'www.douyin.com',
    verificationUrl: 'https://www.douyin.com/user/self?showTab=like',
    keepaliveUrl: 'https://www.douyin.com/user/self?showTab=like',
    requiredAuthSurfaces: ['/user/self', '/follow'],
    riskStopConditions: ['captcha', 'challenge', 'session-invalid', 'network-identity-drift'],
  },
  {
    siteKey: 'xiaohongshu',
    host: 'www.xiaohongshu.com',
    verificationUrl: 'https://www.xiaohongshu.com/notification',
    keepaliveUrl: 'https://www.xiaohongshu.com/notification',
    requiredAuthSurfaces: ['/notification'],
    riskStopConditions: ['captcha', 'challenge', 'risk-control', 'network-identity-drift'],
  },
  {
    siteKey: 'x',
    host: 'x.com',
    verificationUrl: 'https://x.com/home',
    keepaliveUrl: 'https://x.com/home',
    requiredAuthSurfaces: ['/home', '/notifications', '/messages', '/i/bookmarks'],
    riskStopConditions: ['checkpoint', 'rate-limit', 'login-wall', 'api-drift'],
  },
  {
    siteKey: 'instagram',
    host: 'www.instagram.com',
    verificationUrl: 'https://www.instagram.com/',
    keepaliveUrl: 'https://www.instagram.com/',
    requiredAuthSurfaces: ['/direct', '/accounts/edit'],
    riskStopConditions: ['checkpoint', 'challenge', 'rate-limit', 'api-drift'],
  },
  {
    siteKey: 'reddit',
    host: 'www.reddit.com',
    verificationUrl: 'https://www.reddit.com/',
    keepaliveUrl: 'https://www.reddit.com/',
    requiredAuthSurfaces: ['/message/inbox', '/user/me/saved', '/subreddits/mine/subscriber'],
    riskStopConditions: ['login-wall', 'network-security-block', 'rate-limit', 'api-drift'],
  },
]);

const SITE_ALIASES = Object.freeze({
  bilibili: 'bilibili',
  'www.bilibili.com': 'bilibili',
  douyin: 'douyin',
  'www.douyin.com': 'douyin',
  xiaohongshu: 'xiaohongshu',
  xhs: 'xiaohongshu',
  'www.xiaohongshu.com': 'xiaohongshu',
  x: 'x',
  'x.com': 'x',
  'www.x.com': 'x',
  instagram: 'instagram',
  ig: 'instagram',
  'instagram.com': 'instagram',
  'www.instagram.com': 'instagram',
  reddit: 'reddit',
  'reddit.com': 'reddit',
  'www.reddit.com': 'reddit',
  'old.reddit.com': 'reddit',
  'oauth.reddit.com': 'reddit',
});

function normalizeList(value = []) {
  return [...new Set((Array.isArray(value) ? value : [value])
    .map((entry) => normalizeText(entry))
    .filter(Boolean))];
}

function definitionForKey(siteKey) {
  return SESSION_SITE_DEFINITIONS.find((definition) => definition.siteKey === siteKey) ?? null;
}

function siteKeyFromInput(siteOrHost) {
  const normalized = sanitizeHost(normalizeText(siteOrHost).toLowerCase());
  return SITE_ALIASES[normalized] ?? normalized;
}

function authSessionFromProfile(profile) {
  return profile?.json?.authSession ?? profile?.profile?.authSession ?? profile?.authSession ?? {};
}

function mergeProfileAuth(definition, profile) {
  const authSession = authSessionFromProfile(profile);
  return {
    verificationUrl: normalizeText(authSession.verificationUrl) || definition.verificationUrl,
    keepaliveUrl: normalizeText(authSession.keepaliveUrl) || definition.keepaliveUrl,
    requiredAuthSurfaces: normalizeList(authSession.authRequiredPathPrefixes).length > 0
      ? normalizeList(authSession.authRequiredPathPrefixes)
      : definition.requiredAuthSurfaces,
  };
}

export function listSessionSiteDefinitions() {
  return SESSION_SITE_DEFINITIONS.map((definition) => ({
    ...definition,
    requiredAuthSurfaces: [...definition.requiredAuthSurfaces],
    riskStopConditions: [...definition.riskStopConditions],
  }));
}

/** @param {Record<string, any>} [request] */
export async function resolveSessionSiteDefinition(request = {}, options = {}, deps = {}) {
  const requestedKey = siteKeyFromInput(request.siteKey ?? request.site ?? request.host);
  const definition = definitionForKey(requestedKey);
  if (!definition) {
    throw new Error(`Unsupported session site: ${request.siteKey ?? request.site ?? request.host ?? ''}`.trim());
  }
  const host = sanitizeHost(normalizeText(request.host ?? definition.host));
  const profilePath = request.profilePath ?? options.profilePath ?? resolveProfilePathForHost(host, options);
  const profile = request.profile
    ?? await (deps.maybeLoadValidatedProfileForHost ?? maybeLoadValidatedProfileForHost)(host, {
      ...options,
      profilePath,
    });
  const profileAuth = mergeProfileAuth(definition, profile);
  return {
    ...definition,
    host,
    profilePath,
    profile,
    verificationUrl: profileAuth.verificationUrl,
    keepaliveUrl: profileAuth.keepaliveUrl,
    requiredAuthSurfaces: [...profileAuth.requiredAuthSurfaces],
    riskStopConditions: [...definition.riskStopConditions],
  };
}
