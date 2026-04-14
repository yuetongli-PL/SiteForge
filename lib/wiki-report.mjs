// @ts-check

export function buildWarning(code, message, details = {}) {
  const normalizedDetails = typeof details === 'string' ? { path: details } : details;
  return { severity: 'warning', code, message, ...normalizedDetails };
}

export function buildError(code, message, details = {}) {
  const normalizedDetails = typeof details === 'string' ? { path: details } : details;
  return { severity: 'error', code, message, ...normalizedDetails };
}
