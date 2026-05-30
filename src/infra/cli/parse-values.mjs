// @ts-check

import { parseBoolean as parseSharedBoolean } from '../../shared/boolean.mjs';

/**
 * @typedef {{
 *   min?: number;
 *   max?: number;
 *   integer?: boolean;
 *   defaultValue?: number;
 *   onInvalid?: (value: unknown) => number | undefined;
 * }} ParseNumberOptions
 *
 * @typedef {{
 *   allowDashValue?: boolean;
 * }} ReadCliValueOptions
 *
 * @typedef {{
 *   min?: number;
 *   max?: number;
 * }} NumericRangeOptions
 */

export function parseBoolean(value, options = /** @type {any} */ ({})) {
  return parseSharedBoolean(value, options);
}

/**
 * @param {unknown} value
 * @param {ParseNumberOptions} [options]
 */
export function parseNumber(value, {
  min,
  max,
  integer = false,
  defaultValue,
  onInvalid,
} = /** @type {any} */ ({})) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const parsed = Number(value);
  const invalid = !Number.isFinite(parsed)
    || (integer && !Number.isInteger(parsed))
    || (min !== undefined && parsed < min)
    || (max !== undefined && parsed > max);
  if (invalid) {
    if (typeof onInvalid === 'function') {
      return onInvalid(value);
    }
    return defaultValue;
  }
  return parsed;
}

/**
 * @param {unknown} value
 * @param {string} flagName
 */
export function parseStrictBooleanOption(value, flagName) {
  if (value === undefined || value === null) {
    throw new Error(`Invalid boolean for ${flagName}: ${value}`);
  }
  return parseBoolean(value, {
    mode: 'strict',
    onInvalid: () => {
      throw new Error(`Invalid boolean for ${flagName}: ${value}`);
    },
  });
}

/**
 * @param {unknown} value
 * @param {string} flagName
 */
export function parseNonNegativeNumberOption(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid number for ${flagName}: ${value}`);
  }
  return parsed;
}

/**
 * @param {string[]} args
 * @param {string} current
 * @param {number} index
 * @param {ReadCliValueOptions} [options]
 */
export function readCliValue(args, current, index, {
  allowDashValue = false,
} = /** @type {any} */ ({})) {
  const token = String(current ?? '');
  const flagName = token.split('=')[0];
  const eqIndex = token.indexOf('=');
  if (eqIndex !== -1) {
    const value = token.slice(eqIndex + 1);
    if (value === '') {
      throw new Error(`Missing value for ${flagName}`);
    }
    return { value, nextIndex: index };
  }
  if (index + 1 >= args.length) {
    throw new Error(`Missing value for ${flagName}`);
  }
  const value = String(args[index + 1]);
  if (value === '' || (!allowDashValue && value.startsWith('--'))) {
    throw new Error(`Missing value for ${flagName}`);
  }
  return { value, nextIndex: index + 1 };
}

/**
 * @param {unknown} value
 * @param {string} flagName
 * @param {NumericRangeOptions} [options]
 */
export function parseIntegerOption(value, flagName, {
  min,
  max,
} = /** @type {any} */ ({})) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(`${flagName} must be a finite integer`);
  }
  if (min !== undefined && parsed < min) {
    throw new Error(`${flagName} must be at least ${min}`);
  }
  if (max !== undefined && parsed > max) {
    throw new Error(`${flagName} must be at most ${max}`);
  }
  return parsed;
}
