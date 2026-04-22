import path from 'node:path';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const TEST_HELPER_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_HELPER_DIR, '..', '..', '..');
const REPO_METADATA_FILES = [
  path.join(REPO_ROOT, 'config', 'site-registry.json'),
  path.join(REPO_ROOT, 'config', 'site-capabilities.json'),
];

export function createSiteMetadataSandbox(workspaceRoot) {
  const configDir = path.join(workspaceRoot, 'site-metadata-sandbox');
  const runtimeDir = path.join(workspaceRoot, 'site-metadata-runtime-sandbox');
  return {
    configDir,
    runtimeDir,
    siteMetadataOptions: {
      configDir,
      runtimeDir,
    },
  };
}

export async function captureRepoMetadataSnapshot() {
  return await Promise.all(
    REPO_METADATA_FILES.map(async (filePath) => ({
      filePath,
      content: await readFile(filePath, 'utf8'),
    })),
  );
}

export async function assertRepoMetadataUnchanged(snapshot) {
  const current = await captureRepoMetadataSnapshot();
  assert.deepEqual(
    current,
    snapshot,
    'repo config metadata should remain unchanged during test execution',
  );
}
