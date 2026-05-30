// @ts-check

import { readCliValue as readSharedCliValue } from './parse-values.mjs';

export function readCliValue(argv, index, flag = argv[index], options = /** @type {any} */ ({})) {
  return readSharedCliValue(argv, flag, index, options);
}
