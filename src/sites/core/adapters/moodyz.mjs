// @ts-check

import { cleanText } from '../../../shared/normalize.mjs';
import { createCatalogAdapter } from './factory.mjs';

export const MOODYZ_TERMINOLOGY = Object.freeze({
  entityLabel: '浣滃搧',
  entityPlural: '浣滃搧',
  personLabel: '濂充紭',
  personPlural: '濂充紭',
  searchLabel: '鎼滅储浣滃搧',
  openEntityLabel: '鎵撳紑浣滃搧',
  openPersonLabel: '鎵撳紑濂充紭椤?',
  downloadLabel: '涓嬭浇浣滃搧',
  verifiedTaskLabel: '浣滃搧/濂充紭',
});

const INTENT_LABELS = Object.freeze({
  'search-work': '鎼滅储浣滃搧',
  'search-book': '鎼滅储浣滃搧',
  'open-work': '鎵撳紑浣滃搧',
  'open-book': '鎵撳紑浣滃搧',
  'open-actress': '鎵撳紑濂充紭椤?',
  'open-author': '鎵撳紑濂充紭椤?',
  'open-category': '鎵撳紑鍒嗙被椤?',
  'open-utility-page': '鎵撳紑鍔熻兘椤?',
});

export const moodyzAdapter = createCatalogAdapter({
  id: 'moodyz',
  hosts: ['moodyz.com'],
  terminology: MOODYZ_TERMINOLOGY,
  intentLabels: INTENT_LABELS,
  normalizeDisplayLabel: ({ value }) => cleanText(value),
});
