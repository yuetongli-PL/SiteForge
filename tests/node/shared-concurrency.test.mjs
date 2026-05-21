import test from 'node:test';
import assert from 'node:assert/strict';

import { mapWithConcurrency } from '../../src/shared/concurrency.mjs';

test('mapWithConcurrency returns an empty result for empty input', async () => {
  assert.deepEqual(await mapWithConcurrency([], 3, async () => 'unused'), []);
});

test('mapWithConcurrency preserves order and does not start extra workers', async () => {
  let active = 0;
  let maxActive = 0;
  const result = await mapWithConcurrency([1, 2, 3], 10, async (value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return value * 2;
  });

  assert.deepEqual(result, [2, 4, 6]);
  assert.equal(maxActive <= 3, true);
});

test('mapWithConcurrency rejects invalid concurrency and propagates mapper errors', async () => {
  await assert.rejects(
    () => mapWithConcurrency([1], 0, async (value) => value),
    /concurrency must be at least 1/u,
  );
  await assert.rejects(
    () => mapWithConcurrency([1, 2], 1, async (value) => {
      if (value === 2) {
        throw new Error('mapper failed');
      }
      return value;
    }),
    /mapper failed/u,
  );
});
