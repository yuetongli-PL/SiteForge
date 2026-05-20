// @ts-check

import { bilibiliKnowledgeBaseAugmentation } from '../../known-sites/bilibili/kb/augmentation.mjs';
import { xiaohongshuKnowledgeBaseAugmentation } from '../../known-sites/xiaohongshu/kb/augmentation.mjs';
import { resolveCanonicalSiteKey } from './site-identity.mjs';

export const emptyKnowledgeBaseAugmentation = Object.freeze({
  buildOverviewAttributes() {
    return {};
  },
  buildStateAttributes() {
    return {};
  },
  renderOverviewSections() {
    return [];
  },
  renderStateSections() {
    return [];
  },
});

export function resolveKnowledgeBaseAugmentation({
  siteContext = null,
  baseUrl = null,
  host = null,
  profile = null,
} = {}) {
  const siteKey = resolveCanonicalSiteKey({
    host,
    baseUrl,
    inputUrl: baseUrl,
    siteContext,
    profile,
  });
  switch (siteKey) {
    case 'bilibili':
      return bilibiliKnowledgeBaseAugmentation;
    case 'xiaohongshu':
      return xiaohongshuKnowledgeBaseAugmentation;
    default:
      return emptyKnowledgeBaseAugmentation;
  }
}
