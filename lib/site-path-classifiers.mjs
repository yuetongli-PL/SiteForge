// @ts-check

function normalizePathnameValue(pathname) {
  const input = String(pathname ?? '').trim() || '/';
  let normalized = input.startsWith('/') ? input : `/${input}`;
  normalized = normalized.replace(/\/{2,}/g, '/');
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.replace(/\/+$/g, '');
  }
  return normalized.toLowerCase();
}

export function classifyJableModelsPath(pathname) {
  const normalized = normalizePathnameValue(pathname);
  if (normalized === '/models') {
    return 'list';
  }
  if (!normalized.startsWith('/models/')) {
    return null;
  }
  const remainder = normalized.slice('/models/'.length).replace(/^\/+|\/+$/g, '');
  if (!remainder) {
    return 'list';
  }
  const [firstSegment] = remainder.split('/');
  if (!firstSegment) {
    return 'list';
  }
  if (/^\d+$/u.test(firstSegment)) {
    return 'list';
  }
  return 'detail';
}

export function isJableModelsListPath(pathname) {
  return classifyJableModelsPath(pathname) === 'list';
}

export function isJableModelsDetailPath(pathname) {
  return classifyJableModelsPath(pathname) === 'detail';
}
