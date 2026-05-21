import test from 'node:test';
import assert from 'node:assert/strict';

import { parseBoolean, parseNumber } from '../../src/infra/cli/parse-values.mjs';
import { toBoolean } from '../../src/app/pipeline/engine/options.mjs';

test('parseBoolean preserves strict and friendly modes', () => {
  assert.equal(parseBoolean('true', { mode: 'strict' }), true);
  assert.equal(parseBoolean('false', { mode: 'strict' }), false);
  assert.equal(parseBoolean('yes', { mode: 'strict', defaultValue: false }), false);
  assert.equal(parseBoolean('yes', { defaultValue: false }), true);
  assert.equal(parseBoolean('off', { defaultValue: true }), false);
});

test('pipeline boolean parser remains strict', () => {
  assert.equal(toBoolean('true', 'strict'), true);
  assert.equal(toBoolean('false', 'strict'), false);
  assert.throws(() => toBoolean('yes', 'strict'), /Invalid boolean for strict: yes/u);
  assert.throws(() => toBoolean('1', 'strict'), /Invalid boolean for strict: 1/u);
});

test('parseNumber supports defaults and strict invalid callbacks', () => {
  assert.equal(parseNumber('5', { min: 1, integer: true }), 5);
  assert.equal(parseNumber('0', { min: 1, defaultValue: 3 }), 3);
  assert.equal(parseNumber('2.5', { integer: true, defaultValue: 4 }), 4);
  assert.throws(
    () => parseNumber('bad', {
      onInvalid: () => {
        throw new Error('bad number');
      },
    }),
    /bad number/u,
  );
});
