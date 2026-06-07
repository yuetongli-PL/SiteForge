// @ts-check

import path from 'node:path';

function safeSegment(value, fallback = 'run') {
  return String(value ?? fallback)
    .replace(/[^a-z0-9._:-]+/giu, '-')
    .replace(/^-+|-+$/gu, '') || fallback;
}

export function createRuntimeRunId(options = {}) {
  const seed = safeSegment(options.seed ?? `${Date.now()}`);
  return `run:${seed}`;
}

export function resolveRunStorePath(rootDir, relativePath) {
  const root = path.resolve(String(rootDir ?? ''));
  const rel = String(relativePath ?? '').replace(/\\/gu, '/');
  if (!root || !rel || path.isAbsolute(rel) || rel.split('/').includes('..')) {
    const error = new Error('Run store path is outside root');
    // @ts-ignore
    error.code = 'run_store.path_rejected';
    throw error;
  }
  const resolved = path.resolve(root, rel);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    const error = new Error('Run store path is outside root');
    // @ts-ignore
    error.code = 'run_store.path_rejected';
    throw error;
  }
  return resolved;
}
