// @ts-check

import { hostFromUrl } from '../../../shared/normalize.mjs';
import {
  resolveAdapterIdFromSiteContext,
  resolveSiteKeyFromSiteContext,
} from '../catalog/context.mjs';
import { resolveSiteAdapterById, resolveSiteIdentity } from '../../adapters/resolver.mjs';

function resolveIdentityProfile(context = /** @type {any} */ ({})) {
  return context?.siteProfileDocument
    ?? context?.liveSiteProfileDocument
    ?? context?.siteProfile
    ?? context?.profile
    ?? null;
}

function resolveIdentityUrl(context = /** @type {any} */ ({})) {
  return context?.url
    ?? context?.baseUrl
    ?? context?.inputUrl
    ?? '';
}

export function resolveCanonicalSiteIdentity(context = /** @type {any} */ ({})) {
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

export function resolveCanonicalSiteKey(context = /** @type {any} */ ({})) {
  return resolveCanonicalSiteIdentity(context).siteKey ?? null;
}

export function resolveCanonicalAdapterId(context = /** @type {any} */ ({})) {
  return resolveCanonicalSiteIdentity(context).adapterId ?? null;
}
