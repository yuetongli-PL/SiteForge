import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseIntegerOption,
  readCliValue,
} from '../../src/infra/cli/parse-values.mjs';

test('readCliValue rejects missing values and flag-looking next tokens by default', () => {
  assert.throws(
    () => readCliValue(['--timeout'], '--timeout', 0),
    /Missing value for --timeout/u,
  );
  assert.throws(
    () => readCliValue(['--timeout', '--json'], '--timeout', 0),
    /Missing value for --timeout/u,
  );
});

test('readCliValue supports inline values and explicit dash-prefixed values when allowed', () => {
  assert.deepEqual(
    readCliValue(['--name=value'], '--name=value', 0),
    { value: 'value', nextIndex: 0 },
  );
  assert.deepEqual(
    readCliValue(['--pattern', '--literal'], '--pattern', 0, { allowDashValue: true }),
    { value: '--literal', nextIndex: 1 },
  );
});

test('parseIntegerOption requires finite integer values in range', () => {
  assert.equal(parseIntegerOption('2', '--count', { min: 1 }), 2);
  assert.throws(() => parseIntegerOption('NaN', '--count'), /--count must be a finite integer/u);
  assert.throws(() => parseIntegerOption('Infinity', '--count'), /--count must be a finite integer/u);
  assert.throws(() => parseIntegerOption('1.5', '--count'), /--count must be a finite integer/u);
  assert.throws(() => parseIntegerOption('0', '--count', { min: 1 }), /--count must be at least 1/u);
});
