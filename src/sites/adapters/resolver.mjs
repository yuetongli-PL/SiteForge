// @ts-check

import { hostFromUrl, sanitizeHost } from '../../shared/normalize.mjs';
import { readSiteContext } from '../registry/core/context.mjs';
import { maybeLoadValidatedProfileForHost, maybeLoadValidatedProfileForUrl } from '../registry/core/profiles.mjs';
import { attackersAdapter } from './attackers.mjs';
import { chapterContentAdapter } from './chapter-content.mjs';
import { dahliaAdapter } from './dahlia.mjs';
import { bilibiliAdapter } from './bilibili.mjs';
import { dogmaAdapter } from './dogma.mjs';
import { douyinAdapter } from './douyin.mjs';
import { eightmanAdapter } from './eightman.mjs';
import { genericNavigationAdapter } from './generic-navigation.mjs';
import { instagramAdapter } from './instagram.mjs';
import { jableAdapter } from './jable.mjs';
import { kmProduceAdapter } from './km-produce.mjs';
import { madonnaAdapter } from './madonna.mjs';
import { maxingAdapter } from './maxing.mjs';
import { moodyzAdapter } from './moodyz.mjs';
import { qidianAdapter } from './qidian.mjs';
import { redditAdapter } from './reddit.mjs';
import { rookieAdapter } from './rookie.mjs';
import { s1Adapter } from './s1.mjs';
import { sodAdapter } from './sod.mjs';
import { tPowersAdapter } from './t-powers.mjs';
import { xAdapter } from './x.mjs';
import { xiaohongshuAdapter } from './xiaohongshu.mjs';

const ADAPTERS = Object.freeze([
  attackersAdapter,
  dahliaAdapter,
  dogmaAdapter,
  eightmanAdapter,
  jableAdapter,
  kmProduceAdapter,
  madonnaAdapter,
  maxingAdapter,
  moodyzAdapter,
  rookieAdapter,
  s1Adapter,
  sodAdapter,
  tPowersAdapter,
  bilibiliAdapter,
  douyinAdapter,
  xiaohongshuAdapter,
  xAdapter,
  instagramAdapter,
  redditAdapter,
  qidianAdapter,
  chapterContentAdapter,
  genericNavigationAdapter,
]);

export function listSiteAdapters() {
  return [...ADAPTERS];
}

function resolveHost({ host, inputUrl, siteContext, profile } = /** @type {any} */ ({})) {
  return String(
    host
      ?? siteContext?.host
      ?? profile?.host
      ?? hostFromUrl(inputUrl)
      ?? ''
  ).toLowerCase();
}

function firstNonEmptyString(values = /** @type {any[]} */ ([])) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function resolveSiteAdapter({ host, inputUrl, siteContext = null, profile = null } = /** @type {any} */ ({})) {
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
} = /** @type {any} */ ({})) {
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

export function resolveSiteKeyFromHost(host) {
  const resolvedHost = sanitizeHost(resolveHost({ host }));
  const identity = resolveSiteIdentity({ host: resolvedHost });
  if (identity.adapter?.id === genericNavigationAdapter.id) {
    return resolvedHost;
  }
  return firstNonEmptyString([identity.siteKey, resolvedHost]) ?? resolvedHost;
}

export async function resolveSite({
  workspaceRoot = process.cwd(),
  host = null,
  inputUrl = null,
  profile = null,
  profilePath = null,
  siteContext = null,
  siteMetadataOptions = null,
} = /** @type {any} */ ({})) {
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
