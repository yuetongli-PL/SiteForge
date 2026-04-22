// @ts-check

import { hostFromUrl } from '../../../shared/normalize.mjs';
import { readSiteContext } from '../context.mjs';
import { maybeLoadValidatedProfileForHost, maybeLoadValidatedProfileForUrl } from '../profiles.mjs';
import { chapterContentAdapter } from './chapter-content.mjs';
import { bilibiliAdapter } from './bilibili.mjs';
import { douyinAdapter } from './douyin.mjs';
import { genericNavigationAdapter } from './generic-navigation.mjs';
import { jableAdapter } from './jable.mjs';
import { moodyzAdapter } from './moodyz.mjs';

const ADAPTERS = Object.freeze([
  jableAdapter,
  moodyzAdapter,
  bilibiliAdapter,
  douyinAdapter,
  chapterContentAdapter,
  genericNavigationAdapter,
]);

function resolveHost({ host, inputUrl, siteContext, profile } = {}) {
  return String(
    host
      ?? siteContext?.host
      ?? profile?.host
      ?? hostFromUrl(inputUrl)
      ?? ''
  ).toLowerCase();
}

function firstNonEmptyString(values = []) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function resolveSiteAdapter({ host, inputUrl, siteContext = null, profile = null } = {}) {
  const resolvedHost = resolveHost({ host, inputUrl, siteContext, profile });
  return ADAPTERS.find((adapter) => adapter.matches({
    host: resolvedHost,
    inputUrl,
    siteContext,
    profile,
  })) ?? genericNavigationAdapter;
}

export function resolveSiteAdapterById(adapterId) {
  const normalized = String(adapterId ?? '').trim();
  if (!normalized) {
    return null;
  }
  return ADAPTERS.find((adapter) => adapter.id === normalized) ?? null;
}

export function resolveSiteIdentity({
  host,
  inputUrl,
  siteContext = null,
  profile = null,
  adapter = null,
} = {}) {
  const resolvedHost = resolveHost({ host, inputUrl, siteContext, profile });
  const resolvedAdapter = adapter ?? resolveSiteAdapter({
    host: resolvedHost,
    inputUrl,
    siteContext,
    profile,
  });
  const storedAdapterId = firstNonEmptyString([
    siteContext?.capabilitiesRecord?.adapterId,
    siteContext?.registryRecord?.adapterId,
  ]);
  const storedSiteKey = firstNonEmptyString([
    siteContext?.capabilitiesRecord?.siteKey,
    siteContext?.registryRecord?.siteKey,
  ]);
  const derivedSiteKey = typeof resolvedAdapter?.siteKey === 'function'
    ? resolvedAdapter.siteKey({
      host: resolvedHost,
      inputUrl,
      siteContext,
      profile,
    })
    : resolvedAdapter?.siteKey;

  return {
    host: resolvedHost,
    adapter: resolvedAdapter,
    adapterId: storedAdapterId ?? resolvedAdapter?.id ?? genericNavigationAdapter.id,
    siteKey: storedSiteKey ?? firstNonEmptyString([derivedSiteKey, resolvedAdapter?.id, genericNavigationAdapter.id]),
  };
}

export async function resolveSite({
  workspaceRoot = process.cwd(),
  host = null,
  inputUrl = null,
  profile = null,
  profilePath = null,
  siteContext = null,
  siteMetadataOptions = null,
} = {}) {
  const resolvedHost = resolveHost({ host, inputUrl, siteContext, profile });
  const loadedProfile = profile
    ? { json: profile, filePath: profilePath ?? null }
    : inputUrl
      ? await maybeLoadValidatedProfileForUrl(inputUrl, { profilePath })
      : await maybeLoadValidatedProfileForHost(resolvedHost, { profilePath });
  const resolvedContext = siteContext ?? await readSiteContext(workspaceRoot, resolvedHost || inputUrl, siteMetadataOptions ?? {});
  const adapter = resolveSiteAdapter({
    host: resolvedHost,
    inputUrl,
    siteContext: resolvedContext,
    profile: loadedProfile?.json ?? null,
  });
  const identity = resolveSiteIdentity({
    host: resolvedHost,
    inputUrl,
    siteContext: resolvedContext,
    profile: loadedProfile?.json ?? null,
    adapter,
  });
  return {
    host: resolvedHost || resolvedContext?.host || '',
    profilePath: loadedProfile?.filePath ?? profilePath ?? null,
    profile: loadedProfile?.json ?? profile ?? null,
    siteContext: resolvedContext,
    adapter,
    adapterId: identity.adapterId,
    siteKey: identity.siteKey,
  };
}
