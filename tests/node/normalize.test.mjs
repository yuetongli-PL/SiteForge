import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
} from '../../src/shared/normalize.mjs';

test('normalizeText folds whitespace and NFKC', () => {
  assert.equal(normalizeText('  ＡＢＣ　123  '), 'ABC 123');
});

test('normalizeUrlNoFragment strips URL hash safely', () => {
  assert.equal(normalizeUrlNoFragment('https://example.com/foo#section'), 'https://example.com/foo');
});

test('sanitizeHost keeps stable host-safe slugs', () => {
  assert.equal(sanitizeHost('example.com'), 'example.com');
  assert.equal(sanitizeHost('bad host!!'), 'bad-host');
});

test('slugifyAscii keeps ASCII slugs with fallback', () => {
  assert.equal(slugifyAscii('Moodyz Works', 'item'), 'moodyz-works');
  assert.equal(slugifyAscii('玄鉴仙族', 'item'), 'item');
});

test('cleanText trims punctuation and compactSlug clamps length', () => {
  assert.equal(cleanText('  《玄鉴仙族》  '), '玄鉴仙族');
  assert.equal(cleanText('  “保留正常中文文本”  '), '保留正常中文文本');
  assert.equal(cleanText('...Hello world!...'), 'Hello world');
  assert.equal(cleanText('，正常中文，'), '正常中文');
  assert.equal(compactSlug('A'.repeat(140), 'item', 16), 'aaaaaaaaaaaaaaaa');
});

test('cleanText does not depend on corrupted mojibake punctuation', () => {
  const mojibakeText = '\u95ff\u6d9a\u88ab正文';
  assert.equal(cleanText(mojibakeText), mojibakeText);
});

test('normalize punctuation table does not include legacy mojibake data', async () => {
  const source = await readFile(new URL('../../src/shared/normalize.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('\u95ff\u6d9a\u88ab'), false);
});

test('firstNonEmpty and uniqueSortedStrings stay deterministic', () => {
  assert.equal(firstNonEmpty([null, '  ', ' value ']), 'value');
  assert.deepEqual(uniqueSortedStrings(['b', 'a', 'b']), ['a', 'b']);
});

test('hostFromUrl resolves valid URLs and rejects invalid ones', () => {
  assert.equal(hostFromUrl('https://moodyz.com/works/date'), 'moodyz.com');
  assert.equal(hostFromUrl('not-a-url'), null);
});
