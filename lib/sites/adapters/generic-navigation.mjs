// @ts-check

import { cleanText, hostFromUrl } from '../../normalize.mjs';

export const GENERIC_TERMINOLOGY = Object.freeze({
  entityLabel: '书籍',
  entityPlural: '书籍',
  personLabel: '作者',
  personPlural: '作者',
  searchLabel: '搜索书籍',
  openEntityLabel: '打开书籍',
  openPersonLabel: '打开作者页',
  downloadLabel: '下载书籍',
  verifiedTaskLabel: '书籍/作者',
});

function resolveHost(input = {}) {
  return String(
    input.host
      ?? input.siteContext?.host
      ?? hostFromUrl(input.candidateUrl)
      ?? hostFromUrl(input.inputUrl)
      ?? ''
  ).toLowerCase();
}

function toList(value) {
  return Array.isArray(value) ? value : [];
}

export const genericNavigationAdapter = Object.freeze({
  id: 'generic-navigation',
  matches() {
    return true;
  },
  terminology() {
    return { ...GENERIC_TERMINOLOGY };
  },
  displayIntentName({ intentType }) {
    return String(intentType ?? '');
  },
  normalizeDisplayLabel({ value }) {
    return cleanText(value);
  },
  classifyPath() {
    return { kind: null, detail: null };
  },
  runtimePolicy({ host, profile } = {}) {
    return {
      host: resolveHost({ host, profile }),
      allowedHosts: toList(profile?.navigation?.allowedHosts),
      sampling: profile?.sampling ?? null,
      pageTypes: profile?.pageTypes ?? null,
    };
  },
});
