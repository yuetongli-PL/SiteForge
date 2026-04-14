import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanText,
  compactSlug,
  firstNonEmpty,
  hostFromUrl,
  normalizeText,
  normalizeUrlNoFragment,
  sanitizeHost,
  slugifyAscii,
  uniqueSortedStrings,
} from '../../lib/normalize.mjs';

test('normalizeText folds whitespace and NFKC', () => {
  assert.equal(normalizeText('  ＡＢＣ　123  '), 'ABC 123');
});

test('normalizeUrlNoFragment strips URL hash safely', () => {
  assert.equal(normalizeUrlNoFragment('https://example.com/foo#section'), 'https://example.com/foo');
});

test('sanitizeHost keeps stable host-safe slugs', () => {
  assert.equal(sanitizeHost('www.22biqu.com'), 'www.22biqu.com');
  assert.equal(sanitizeHost('bad host!!'), 'bad-host');
});

test('slugifyAscii keeps ASCII slugs with fallback', () => {
  assert.equal(slugifyAscii('Moodyz Works', 'item'), 'moodyz-works');
  assert.equal(slugifyAscii('玄鉴仙族', 'item'), 'item');
});

test('cleanText trims punctuation and compactSlug clamps length', () => {
  assert.equal(cleanText('  《玄鉴仙族》  '), '玄鉴仙族');
  assert.equal(compactSlug('A'.repeat(140), 'item', 16), 'aaaaaaaaaaaaaaaa');
});

test('firstNonEmpty and uniqueSortedStrings stay deterministic', () => {
  assert.equal(firstNonEmpty([null, '  ', ' value ']), 'value');
  assert.deepEqual(uniqueSortedStrings(['b', 'a', 'b']), ['a', 'b']);
});

test('hostFromUrl resolves valid URLs and rejects invalid ones', () => {
  assert.equal(hostFromUrl('https://moodyz.com/works/date'), 'moodyz.com');
  assert.equal(hostFromUrl('not-a-url'), null);
});
