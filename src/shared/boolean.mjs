// @ts-check

function normalizeBooleanText(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function parseBoolean(value, { mode = 'friendly', defaultValue, onInvalid } = {}) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = normalizeBooleanText(value);
  if (mode === 'strict') {
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
    if (typeof onInvalid === 'function') {
      return onInvalid(value);
    }
    return defaultValue;
  }
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  if (typeof onInvalid === 'function') {
    return onInvalid(value);
  }
  return defaultValue;
}
