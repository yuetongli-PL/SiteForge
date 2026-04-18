// @ts-check

import { cleanText } from '../../normalize.mjs';
import { genericNavigationAdapter } from './generic-navigation.mjs';

const BILIBILI_HOSTS = new Set([
  'www.bilibili.com',
  'search.bilibili.com',
  'space.bilibili.com',
]);

export const BILIBILI_TERMINOLOGY = Object.freeze({
  entityLabel: '视频',
  entityPlural: '视频',
  personLabel: 'UP主',
  personPlural: 'UP主',
  searchLabel: '搜索视频',
  openEntityLabel: '打开视频',
  openPersonLabel: '打开UP主主页',
  downloadLabel: '下载视频',
  verifiedTaskLabel: '视频 / UP主 / 分区',
});

function runtimePolicy(profile) {
  return {
    allowedHosts: Array.isArray(profile?.navigation?.allowedHosts) ? profile.navigation.allowedHosts : [],
    sampling: profile?.sampling ?? null,
    pageTypes: profile?.pageTypes ?? null,
  };
}

export const bilibiliAdapter = Object.freeze({
  ...genericNavigationAdapter,
  id: 'bilibili',
  matches({ host, profile } = {}) {
    const resolvedHost = String(host ?? profile?.host ?? '').toLowerCase();
    return BILIBILI_HOSTS.has(resolvedHost);
  },
  terminology() {
    return { ...BILIBILI_TERMINOLOGY };
  },
  displayIntentName({ intentType }) {
    switch (intentType) {
      case 'search-video':
      case 'search-work':
      case 'search-book':
        return '搜索视频';
      case 'open-video':
      case 'open-work':
      case 'open-book':
        return '打开视频';
      case 'open-up':
      case 'open-author':
      case 'open-actress':
        return '打开UP主主页';
      case 'open-category':
        return '打开分区页';
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
