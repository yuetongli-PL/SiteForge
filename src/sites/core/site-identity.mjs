// @ts-check

import { hostFromUrl } from '../../shared/normalize.mjs';
import {
  resolveAdapterIdFromSiteContext,
  resolveSiteKeyFromSiteContext,
} from '../catalog/context.mjs';
import { resolveSiteAdapterById, resolveSiteIdentity } from './adapters/resolver.mjs';

function resolveIdentityProfile(context = {}) {
  return context?.siteProfileDocument
    ?? context?.liveSiteProfileDocument
    ?? context?.siteProfile
    ?? context?.profile
    ?? null;
}

function resolveIdentityUrl(context = {}) {
  return context?.url
    ?? context?.baseUrl
    ?? context?.inputUrl
    ?? '';
}

export function resolveCanonicalSiteIdentity(context = {}) {
  const siteContext = context?.siteContext ?? null;
  const inputUrl = resolveIdentityUrl(context);
  const profile = resolveIdentityProfile(context);
  const identity = resolveSiteIdentity({
    host: context?.host ?? siteContext?.host ?? profile?.host ?? hostFromUrl(inputUrl) ?? '',
    inputUrl,
    siteContext,
    profile,
    adapter: context?.adapter ?? null,
  });
  const adapterId = resolveAdapterIdFromSiteContext(siteContext, [identity.adapterId]);
  const adapter = resolveSiteAdapterById(adapterId) ?? identity.adapter;

  return {
    ...identity,
    adapter,
    siteKey: resolveSiteKeyFromSiteContext(siteContext, [identity.siteKey]),
    adapterId,
  };
}

export function resolveCanonicalSiteKey(context = {}) {
  return resolveCanonicalSiteIdentity(context).siteKey ?? null;
}

export function resolveCanonicalAdapterId(context = {}) {
  return resolveCanonicalSiteIdentity(context).adapterId ?? null;
}
