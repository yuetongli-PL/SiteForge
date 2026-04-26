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

function resolveSemanticProfile(context) {
  return context?.siteProfileDocument
    ?? context?.liveSiteProfileDocument
    ?? context?.siteProfile
    ?? context?.profile
    ?? context?.siteContext?.profile
    ?? null;
}

function isSocialContext(context) {
  const siteKey = resolveSemanticSiteKey(context);
  return siteKey === 'x' || siteKey === 'instagram';
}

const SOCIAL_INTENT_ALIASES = Object.freeze({
  'continue-full-archive': 'resume-full-archive',
  'full-archive-resume': 'resume-full-archive',
  'resume-archive': 'resume-full-archive',
  'resume-full-archive': 'resume-full-archive',
  'resume-after-cooldown': 'resume-after-cooldown',
  'continue-after-cooldown': 'resume-after-cooldown',
  'cooldown-resume': 'resume-after-cooldown',
  'media-download-fast': 'media-fast-download',
  'fast-media-download': 'media-fast-download',
  'high-speed-media-download': 'media-fast-download',
  'media-fast-download': 'media-fast-download',
  'auth-health-check': 'health-check',
  'health-check': 'health-check',
  'session-health-check': 'health-check',
  'live-report': 'live-acceptance-report',
  'live-acceptance': 'live-acceptance-report',
  'live-acceptance-report': 'live-acceptance-report',
  'verification-report': 'live-acceptance-report',
  'kb-refresh': 'kb-refresh',
  'knowledge-base-refresh': 'kb-refresh',
  'refresh-kb': 'kb-refresh',
});

export function resolveSocialIntentAlias(intentType, context) {
  if (!isSocialContext(context)) {
    return intentType;
  }
  const normalized = String(intentType ?? '').trim();
  return SOCIAL_INTENT_ALIASES[normalized] ?? normalized;
}

export function resolveSocialNaturalLanguageSemantics(context = {}) {
  if (!isSocialContext(context)) {
    return null;
  }
  const profile = resolveSemanticProfile(context);
  return profile?.social?.naturalLanguage ?? null;
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
    case 'xiaohongshu':
      switch (intentType) {
        case 'search-video':
        case 'search-work':
          return 'search-book';
        case 'open-video':
        case 'open-work':
          return 'open-book';
        case 'open-up':
        case 'open-model':
        case 'open-actress':
          return 'open-author';
        case 'download-video':
        case 'download-work':
          return 'download-book';
        default:
          return intentType;
      }
    case 'x':
      switch (intentType) {
        case 'continue-full-archive':
        case 'full-archive-resume':
        case 'resume-archive':
        case 'resume-full-archive':
          return 'resume-full-archive';
        case 'resume-after-cooldown':
        case 'continue-after-cooldown':
        case 'cooldown-resume':
          return 'resume-after-cooldown';
        case 'media-download-fast':
        case 'fast-media-download':
        case 'high-speed-media-download':
        case 'media-fast-download':
          return 'media-fast-download';
        case 'auth-health-check':
        case 'health-check':
        case 'session-health-check':
          return 'health-check';
        case 'live-report':
        case 'live-acceptance':
        case 'live-acceptance-report':
        case 'verification-report':
          return 'live-acceptance-report';
        case 'kb-refresh':
        case 'knowledge-base-refresh':
        case 'refresh-kb':
          return 'kb-refresh';
        case 'search-book':
        case 'search-video':
        case 'search-work':
          return 'search-posts';
        case 'open-book':
        case 'open-video':
        case 'open-work':
          return 'open-post';
        case 'download-video':
        case 'download-work':
          return 'download-book';
        default:
          return intentType;
      }
    case 'instagram':
      switch (intentType) {
        case 'continue-full-archive':
        case 'full-archive-resume':
        case 'resume-archive':
        case 'resume-full-archive':
          return 'resume-full-archive';
        case 'resume-after-cooldown':
        case 'continue-after-cooldown':
        case 'cooldown-resume':
          return 'resume-after-cooldown';
        case 'media-download-fast':
        case 'fast-media-download':
        case 'high-speed-media-download':
        case 'media-fast-download':
          return 'media-fast-download';
        case 'auth-health-check':
        case 'health-check':
        case 'session-health-check':
          return 'health-check';
        case 'live-report':
        case 'live-acceptance':
        case 'live-acceptance-report':
        case 'verification-report':
          return 'live-acceptance-report';
        case 'kb-refresh':
        case 'knowledge-base-refresh':
        case 'refresh-kb':
          return 'kb-refresh';
        case 'search-book':
        case 'search-video':
        case 'search-work':
          return 'search-content';
        case 'open-book':
        case 'open-video':
        case 'open-work':
          return 'open-post';
        case 'download-video':
        case 'download-work':
          return 'download-book';
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
