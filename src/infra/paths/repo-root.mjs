// @ts-check

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REQUIRED_REPO_ROOT_MARKERS = Object.freeze([
  'package.json',
  'config/site-registry.json',
  'config/site-capabilities.json',
  'src/sites/known-sites',
]);

export function assertRepoRoot(candidatePath) {
  const repoRoot = path.resolve(String(candidatePath ?? ''));
  const missingMarkers = REQUIRED_REPO_ROOT_MARKERS
    .filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
  if (missingMarkers.length > 0) {
    throw new Error(`Invalid repository root: ${repoRoot} is missing ${missingMarkers.join(', ')}`);
  }
  return repoRoot;
}

export function repoRootFromImportMeta(importMetaUrl) {
  let cursor = path.dirname(fileURLToPath(importMetaUrl));
  while (true) {
    try {
      return assertRepoRoot(cursor);
    } catch {
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        throw new Error(`Unable to locate repository root from ${importMetaUrl}`);
      }
      cursor = parent;
    }
  }
}

export const REPO_ROOT = assertRepoRoot(path.resolve(MODULE_DIR, '..', '..', '..'));

export function resolveRepoPath(...segments) {
  return path.join(REPO_ROOT, ...segments);
}
