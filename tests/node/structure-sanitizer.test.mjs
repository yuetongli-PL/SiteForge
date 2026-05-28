import test from 'node:test';
import assert from 'node:assert/strict';

import {
  safeStructureHash,
  sanitizedStructureText,
} from '../../src/app/pipeline/build/structure-sanitizer.mjs';

test('structure sanitizer redacts sensitive structure labels and preserves safe labels', () => {
  assert.equal(sanitizedStructureText('  Category list  ', 80, 'fallback'), 'Category list');
  assert.equal(sanitizedStructureText('', 80, 'fallback'), 'fallback');
  assert.equal(sanitizedStructureText('token=synthetic-secret', 80, 'fallback'), '[REDACTED]');
  assert.equal(sanitizedStructureText('<script>alert(1)</script>', 80, 'fallback'), '[REDACTED]');
  assert.equal(sanitizedStructureText('abcdefghijklmnopqrstuvwxyz', 8, 'fallback'), 'abcdefgh');
});

test('safe structure hash preserves trusted hashes and derives fallback ids', () => {
  assert.equal(safeStructureHash('prefix', 'abcdefabcdef', 'fallback'), 'abcdefabcdef');
  assert.equal(safeStructureHash('prefix', 'sha:abcdefabcdefabcdef', 'fallback'), 'sha:abcdefabcdefabcdef');
  assert.match(safeStructureHash('prefix', 'not-a-hash', 'fallback'), /^prefix:[a-f0-9]{12}$/u);
});
