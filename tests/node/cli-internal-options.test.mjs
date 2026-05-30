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

test('internal readCliValue delegates shared CLI value parsing', () => {
  assert.deepEqual(readCliValue(['--out-dir', 'runs/out'], 0, '--out-dir'), {
    value: 'runs/out',
    nextIndex: 1,
  });
  assert.deepEqual(readCliValue(['--out-dir=runs/out'], 0, '--out-dir=runs/out'), {
    value: 'runs/out',
    nextIndex: 0,
  });
  assert.throws(() => readCliValue(['--out-dir'], 0, '--out-dir'), /Missing value for --out-dir/u);
  assert.throws(() => readCliValue(['--out-dir', '--json'], 0, '--out-dir'), /Missing value for --out-dir/u);
  assert.deepEqual(readCliValue(['--pattern', '--literal'], 0, '--pattern', { allowDashValue: true }), {
    value: '--literal',
    nextIndex: 1,
  });
});
