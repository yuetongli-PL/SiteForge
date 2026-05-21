// @ts-check

import { parseBoolean as parseSharedBoolean } from '../../shared/boolean.mjs';

export function parseBoolean(value, options = {}) {
  return parseSharedBoolean(value, options);
}

export function parseNumber(value, {
  min,
  max,
  integer = false,
  defaultValue,
  onInvalid,
} = {}) {
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

export function parseNonNegativeNumberOption(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid number for ${flagName}: ${value}`);
  }
  return parsed;
}
