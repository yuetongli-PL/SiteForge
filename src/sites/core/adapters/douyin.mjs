// @ts-check

import { cleanText } from '../../../shared/normalize.mjs';
import { inferDouyinPageTypeFromUrl } from '../../douyin/model/site.mjs';
import { createCatalogAdapter } from './factory.mjs';

const DOUYIN_HOSTS = Object.freeze([
  'www.douyin.com',
]);

export const DOUYIN_TERMINOLOGY = Object.freeze({
  entityLabel: '\u89c6\u9891',
  entityPlural: '\u89c6\u9891',
  personLabel: '\u7528\u6237',
  personPlural: '\u7528\u6237',
  searchLabel: '\u641c\u7d22\u89c6\u9891',
  openEntityLabel: '\u6253\u5f00\u89c6\u9891',
  openPersonLabel: '\u6253\u5f00\u7528\u6237\u4e3b\u9875',
  downloadLabel: '\u4e0b\u8f7d\u89c6\u9891',
  verifiedTaskLabel: '\u89c6\u9891/\u7528\u6237/\u5206\u7c7b',
});

const INTENT_LABELS = Object.freeze({
  'search-video': '\u641c\u7d22\u89c6\u9891',
  'search-work': '\u641c\u7d22\u89c6\u9891',
  'search-book': '\u641c\u7d22\u89c6\u9891',
  'open-video': '\u6253\u5f00\u89c6\u9891',
  'open-work': '\u6253\u5f00\u89c6\u9891',
  'open-book': '\u6253\u5f00\u89c6\u9891',
  'open-up': '\u6253\u5f00\u7528\u6237\u4e3b\u9875',
  'open-author': '\u6253\u5f00\u7528\u6237\u4e3b\u9875',
  'open-actress': '\u6253\u5f00\u7528\u6237\u4e3b\u9875',
  'open-model': '\u6253\u5f00\u7528\u6237\u4e3b\u9875',
  'open-category': '\u6253\u5f00\u5206\u7c7b\u9875',
  'open-utility-page': '\u6253\u5f00\u529f\u80fd\u9875',
  'list-followed-users': '\u63d0\u53d6\u5173\u6ce8\u7528\u6237\u5217\u8868',
  'list-followed-updates': '\u63d0\u53d6\u5173\u6ce8\u66f4\u65b0\u89c6\u9891',
});

export const douyinAdapter = createCatalogAdapter({
  id: 'douyin',
  hosts: DOUYIN_HOSTS,
  terminology: DOUYIN_TERMINOLOGY,
  intentLabels: INTENT_LABELS,
  inferPageType({ inputUrl }) {
    return inferDouyinPageTypeFromUrl(inputUrl);
  },
  normalizeDisplayLabel: ({ value }) => cleanText(value),
});
