// @ts-check

import { cleanText } from '../../normalize.mjs';
import { genericNavigationAdapter } from './generic-navigation.mjs';

export const MOODYZ_TERMINOLOGY = Object.freeze({
  entityLabel: '作品',
  entityPlural: '作品',
  personLabel: '女优',
  personPlural: '女优',
  searchLabel: '搜索作品',
  openEntityLabel: '打开作品',
  openPersonLabel: '打开女优页',
  downloadLabel: '下载作品',
  verifiedTaskLabel: '作品/女优',
});

function runtimePolicy(profile) {
  return {
    allowedHosts: Array.isArray(profile?.navigation?.allowedHosts) ? profile.navigation.allowedHosts : [],
    sampling: profile?.sampling ?? null,
    pageTypes: profile?.pageTypes ?? null,
  };
}

export const moodyzAdapter = Object.freeze({
  ...genericNavigationAdapter,
  id: 'moodyz',
  matches({ host, profile } = {}) {
    return String(host ?? profile?.host ?? '').toLowerCase() === 'moodyz.com';
  },
  terminology() {
    return { ...MOODYZ_TERMINOLOGY };
  },
  displayIntentName({ intentType }) {
    switch (intentType) {
      case 'search-work':
      case 'search-book':
        return '搜索作品';
      case 'open-work':
      case 'open-book':
        return '打开作品';
      case 'open-actress':
      case 'open-author':
        return '打开女优页';
      case 'open-category':
        return '打开分类页';
      case 'open-utility-page':
        return '打开功能页';
      default:
        return String(intentType ?? '');
    }
  },
  normalizeDisplayLabel({ value }) {
    return cleanText(value);
  },
  classifyPath() {
    return { kind: null, detail: null };
  },
  runtimePolicy({ profile } = {}) {
    return runtimePolicy(profile);
  },
});
