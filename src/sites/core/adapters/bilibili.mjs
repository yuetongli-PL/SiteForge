// @ts-check

import { cleanText } from '../../../shared/normalize.mjs';
import { inferBilibiliPageTypeFromUrl } from '../../bilibili/model/page-type.mjs';
import { createCatalogAdapter } from './factory.mjs';

const BILIBILI_HOSTS = Object.freeze([
  'www.bilibili.com',
  'search.bilibili.com',
  'space.bilibili.com',
]);

export const BILIBILI_TERMINOLOGY = Object.freeze({
  entityLabel: '\u89c6\u9891',
  entityPlural: '\u89c6\u9891',
  personLabel: 'UP\u4e3b',
  personPlural: 'UP\u4e3b',
  searchLabel: '\u641c\u7d22\u89c6\u9891',
  openEntityLabel: '\u6253\u5f00\u89c6\u9891',
  openPersonLabel: '\u6253\u5f00UP\u4e3b\u4e3b\u9875',
  downloadLabel: '\u4e0b\u8f7d\u89c6\u9891',
  verifiedTaskLabel: '\u89c6\u9891 / UP\u4e3b / \u5206\u533a',
});

const INTENT_LABELS = Object.freeze({
  'search-video': '\u641c\u7d22\u89c6\u9891',
  'search-work': '\u641c\u7d22\u89c6\u9891',
  'search-book': '\u641c\u7d22\u89c6\u9891',
  'open-video': '\u6253\u5f00\u89c6\u9891',
  'open-work': '\u6253\u5f00\u89c6\u9891',
  'open-book': '\u6253\u5f00\u89c6\u9891',
  'open-up': '\u6253\u5f00UP\u4e3b\u4e3b\u9875',
  'open-author': '\u6253\u5f00UP\u4e3b\u4e3b\u9875',
  'open-actress': '\u6253\u5f00UP\u4e3b\u4e3b\u9875',
  'open-category': '\u6253\u5f00\u5206\u533a\u9875',
  'open-utility-page': '\u6253\u5f00\u529f\u80fd\u9875',
});

export const bilibiliAdapter = createCatalogAdapter({
  id: 'bilibili',
  hosts: BILIBILI_HOSTS,
  terminology: BILIBILI_TERMINOLOGY,
  intentLabels: INTENT_LABELS,
  inferPageType({ inputUrl }) {
    return inferBilibiliPageTypeFromUrl(inputUrl);
  },
  normalizeDisplayLabel: ({ value }) => cleanText(value),
});
