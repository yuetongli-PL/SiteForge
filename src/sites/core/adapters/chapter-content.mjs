// @ts-check

import { genericNavigationAdapter } from './generic-navigation.mjs';
import { resolveProfileArchetype } from '../archetypes.mjs';

export const chapterContentAdapter = Object.freeze({
  ...genericNavigationAdapter,
  id: 'chapter-content',
  siteKey({ host, profile } = {}) {
    const resolvedHost = String(host ?? profile?.host ?? '').toLowerCase();
    return resolvedHost === 'www.22biqu.com' ? '22biqu' : 'chapter-content';
  },
  matches({ host, profile } = {}) {
    return resolveProfileArchetype(profile, { host }) === 'chapter-content'
      || String(host ?? profile?.host ?? '').toLowerCase() === 'www.22biqu.com'
      || Boolean(profile?.bookDetail && profile?.chapter);
  },
});
