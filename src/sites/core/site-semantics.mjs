// @ts-check

import { displayIntentName, resolveSiteTerminology } from './terminology.mjs';
import {
  resolveCanonicalAdapterId,
  resolveCanonicalSiteKey,
} from './site-identity.mjs';

function resolveSemanticUrl(context) {
  return context?.url ?? context?.baseUrl ?? '';
}

export function resolveSemanticSiteKey(context) {
  return resolveCanonicalSiteKey({
    ...context,
    inputUrl: resolveSemanticUrl(context),
  });
}

export function resolveSemanticAdapterId(context) {
  return resolveCanonicalAdapterId({
    ...context,
    inputUrl: resolveSemanticUrl(context),
  });
}

export function isDouyinContext(context) {
  const siteKey = resolveSemanticSiteKey(context);
  const adapterId = resolveSemanticAdapterId(context);
  return siteKey === 'douyin' || adapterId === 'douyin';
}

export function isBilibiliContext(context) {
  return resolveSemanticSiteKey(context) === 'bilibili';
}

export function isJableContext(context) {
  return resolveSemanticSiteKey(context) === 'jable';
}

export function isMoodyzContext(context) {
  return resolveSemanticSiteKey(context) === 'moodyz';
}

export function siteTerminology(context) {
  return resolveSiteTerminology(context?.siteContext ?? context, resolveSemanticUrl(context));
}

export function siteIntentTitlePrefix(context, intentType) {
  return displayIntentName(intentType, context?.siteContext ?? context, resolveSemanticUrl(context));
}

export function remapSupportedIntent(intentType, context) {
  switch (resolveSemanticSiteKey(context)) {
    case 'douyin':
    case 'bilibili':
      if (intentType === 'search-book' || intentType === 'search-work') {
        return 'search-video';
      }
      if (intentType === 'open-book' || intentType === 'open-work') {
        return 'open-video';
      }
      if (intentType === 'open-actress' || intentType === 'open-model' || intentType === 'open-up') {
        return 'open-author';
      }
      return intentType;
    case 'jable':
      switch (intentType) {
        case 'search-book':
          return 'search-video';
        case 'open-book':
          return 'open-video';
        case 'open-author':
          return 'open-model';
        case 'download-book':
          return 'download-video';
        default:
          return intentType;
      }
    case 'moodyz':
      switch (intentType) {
        case 'search-book':
          return 'search-work';
        case 'open-book':
          return 'open-work';
        case 'open-author':
          return 'open-actress';
        case 'download-book':
          return 'download-work';
        default:
          return intentType;
      }
    default:
      return intentType;
  }
}

export function siteIntentTypeName(context, intentType) {
  return String(remapSupportedIntent(intentType, context) ?? '');
}
