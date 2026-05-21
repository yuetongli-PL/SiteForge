import test from 'node:test';
import assert from 'node:assert/strict';

import { readCliValue } from '../../src/infra/cli/internal-options.mjs';
import {
  parseNonNegativeNumberOption,
  parseStrictBooleanOption,
} from '../../src/infra/cli/parse-values.mjs';

test('strict internal CLI option parsers preserve existing boolean and number errors', () => {
  assert.equal(parseStrictBooleanOption(true, 'headless'), true);
  assert.equal(parseStrictBooleanOption('false', 'headless'), false);
  assert.throws(() => parseStrictBooleanOption(undefined, 'headless'), /Invalid boolean for headless: undefined/u);
  assert.throws(() => parseStrictBooleanOption('1', 'headless'), /Invalid boolean for headless: 1/u);

  assert.equal(parseNonNegativeNumberOption('0', 'timeoutMs'), 0);
  assert.equal(parseNonNegativeNumberOption('', 'timeoutMs'), 0);
  assert.equal(parseNonNegativeNumberOption('1200', 'timeoutMs'), 1200);
  assert.throws(() => parseNonNegativeNumberOption(undefined, 'timeoutMs'), /Invalid number for timeoutMs: undefined/u);
  assert.throws(() => parseNonNegativeNumberOption('-1', 'timeoutMs'), /Invalid number for timeoutMs: -1/u);
});

test('readCliValue returns the next argv token and preserves missing value errors', () => {
  assert.deepEqual(readCliValue(['--out-dir', 'runs/out'], 0, '--out-dir'), {
    value: 'runs/out',
    nextIndex: 1,
  });
  assert.throws(() => readCliValue(['--out-dir'], 0, '--out-dir'), /Missing value for --out-dir/u);
});
