// @ts-check

/**
 * @template T, U
 * @param {T[]} values
 * @param {number} limit
 * @param {(value: T, index: number) => U | Promise<U>} mapper
 * @returns {Promise<U[]>}
 */
export async function mapWithConcurrency(values, limit, mapper) {
  const items = Array.isArray(values) ? values : [];
  if (items.length === 0) {
    return [];
  }
  const parsedLimit = Number(limit);
  if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
    throw new Error(`concurrency must be at least 1: ${limit}`);
  }
  const workerCount = Math.min(Math.floor(parsedLimit), items.length);
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
