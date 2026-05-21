// @ts-check

export function sanitizePublicUrl(value, {
  fallback = '<url>',
  keepPath = true,
} = {}) {
  const input = value === undefined || value === null ? fallback : value;
  try {
    const parsed = new URL(String(input));
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    if (!keepPath || !parsed.pathname) {
      parsed.pathname = '/';
    }
    return parsed.toString();
  } catch {
    return fallback;
  }
}
