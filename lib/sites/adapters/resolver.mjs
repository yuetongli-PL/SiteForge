// @ts-check

import { hostFromUrl } from '../../normalize.mjs';
import { readSiteContext } from '../context.mjs';
import { maybeLoadValidatedProfileForHost, maybeLoadValidatedProfileForUrl } from '../profiles.mjs';
import { chapterContentAdapter } from './chapter-content.mjs';
import { bilibiliAdapter } from './bilibili.mjs';
import { genericNavigationAdapter } from './generic-navigation.mjs';
import { jableAdapter } from './jable.mjs';
import { moodyzAdapter } from './moodyz.mjs';

const ADAPTERS = Object.freeze([
  jableAdapter,
  moodyzAdapter,
  bilibiliAdapter,
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

export function resolveSiteAdapter({ host, inputUrl, siteContext = null, profile = null } = {}) {
  const resolvedHost = resolveHost({ host, inputUrl, siteContext, profile });
  return ADAPTERS.find((adapter) => adapter.matches({
    host: resolvedHost,
    inputUrl,
    siteContext,
    profile,
  })) ?? genericNavigationAdapter;
}

export async function resolveSite({
  workspaceRoot = process.cwd(),
  host = null,
  inputUrl = null,
  profile = null,
  profilePath = null,
  siteContext = null,
} = {}) {
  const resolvedHost = resolveHost({ host, inputUrl, siteContext, profile });
  const loadedProfile = profile
    ? { json: profile, filePath: profilePath ?? null }
    : inputUrl
      ? await maybeLoadValidatedProfileForUrl(inputUrl, { profilePath })
      : await maybeLoadValidatedProfileForHost(resolvedHost, { profilePath });
  const resolvedContext = siteContext ?? await readSiteContext(workspaceRoot, resolvedHost || inputUrl);
  const adapter = resolveSiteAdapter({
    host: resolvedHost,
    inputUrl,
    siteContext: resolvedContext,
    profile: loadedProfile?.json ?? null,
  });
  return {
    host: resolvedHost || resolvedContext?.host || '',
    profilePath: loadedProfile?.filePath ?? profilePath ?? null,
    profile: loadedProfile?.json ?? profile ?? null,
    siteContext: resolvedContext,
    adapter,
  };
}
