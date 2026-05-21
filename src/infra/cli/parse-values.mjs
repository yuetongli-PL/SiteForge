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

export function readCliValue(args, current, index, {
  allowDashValue = false,
} = {}) {
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
  if (!allowDashValue && value.startsWith('--')) {
    throw new Error(`Missing value for ${flagName}`);
  }
  return { value, nextIndex: index + 1 };
}

export function parseIntegerOption(value, flagName, {
  min,
  max,
} = {}) {
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

export function parseFiniteNumberOption(value, flagName, {
  min,
  max,
} = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flagName} must be a finite number`);
  }
  if (min !== undefined && parsed < min) {
    throw new Error(`${flagName} must be at least ${min}`);
  }
  if (max !== undefined && parsed > max) {
    throw new Error(`${flagName} must be at most ${max}`);
  }
  return parsed;
}
