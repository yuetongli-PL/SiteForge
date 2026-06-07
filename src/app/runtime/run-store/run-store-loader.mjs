// @ts-check

import { readFile, stat } from 'node:fs/promises';
import { createRunStoreIntegrityDigest } from './run-store-integrity.mjs';
import { resolveRunStorePath } from './run-store-paths.mjs';
import { createRunStoreQueryIndex } from './run-store-query-index.mjs';
import { sanitizeRunStoreManifest } from './run-store-sanitizer.mjs';

async function readJsonBounded(rootDir, relativePath, { maxBytes = 512000 } = {}) {
  const filePath = resolveRunStorePath(rootDir, relativePath);
  const info = await stat(filePath);
  if (info.size > maxBytes) {
    const error = new Error('Run store file is too large');
    // @ts-ignore
    error.code = 'run_store.file_too_large';
    throw error;
  }
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function loadRuntimeRunStore(rootDir, runManifestPath, options = {}) {
  const warnings = [];
  const manifest = sanitizeRunStoreManifest(await readJsonBounded(rootDir, runManifestPath, options));
  const expectedDigest = createRunStoreIntegrityDigest(manifest);
  if (manifest.integrityDigest && manifest.integrityDigest !== expectedDigest) {
    warnings.push('run_store.integrity_digest_mismatch');
  }
  const files = new Map(manifest.files.map((file) => [file.kind, file]));
  let auditView = null;
  let queryIndex = null;
  try {
    if (files.has('audit_view')) {
      auditView = await readJsonBounded(rootDir, files.get('audit_view').path, options);
    } else {
      warnings.push('run_store.audit_view_missing');
    }
  } catch {
    warnings.push('run_store.audit_view_unavailable');
  }
  try {
    if (files.has('query_index')) {
      queryIndex = await readJsonBounded(rootDir, files.get('query_index').path, options);
    } else {
      queryIndex = createRunStoreQueryIndex([manifest]);
      warnings.push('run_store.query_index_missing');
    }
  } catch {
    queryIndex = createRunStoreQueryIndex([manifest]);
    warnings.push('run_store.query_index_unavailable');
  }
  return {
    manifest,
    auditView,
    queryIndex,
    warnings: [...new Set([...warnings, ...(manifest.warnings ?? [])])].sort(),
    providerInvoked: false,
    browserInvoked: false,
    vaultAccessed: false,
    networkInvoked: false,
    rawArtifactContentRead: false,
    redactionRequired: true,
  };
}
