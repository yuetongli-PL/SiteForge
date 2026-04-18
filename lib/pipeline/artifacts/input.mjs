// @ts-check

import path from 'node:path';
import { pathExists, readJsonFile } from '../../io.mjs';
import { firstExistingPath } from '../../wiki-paths.mjs';
import { getManifestArtifactDir, getManifestArtifactPath } from '../run-manifest.mjs';

export async function resolveStageInput(options, config) {
  const {
    manifestOption,
    dirOption,
    manifestName,
    missingArgsMessage,
    missingManifestMessagePrefix,
    missingDirMessagePrefix,
  } = config;

  if (options[manifestOption]) {
    const manifestPath = path.resolve(options[manifestOption]);
    if (!(await pathExists(manifestPath))) {
      throw new Error(`${missingManifestMessagePrefix}${manifestPath}`);
    }
    return {
      manifestPath,
      dir: path.dirname(manifestPath),
    };
  }

  if (!options[dirOption]) {
    throw new Error(missingArgsMessage);
  }

  const dir = path.resolve(options[dirOption]);
  if (!(await pathExists(dir))) {
    throw new Error(`${missingDirMessagePrefix}${dir}`);
  }

  const candidateManifest = path.join(dir, manifestName);
  return {
    manifestPath: (await pathExists(candidateManifest)) ? candidateManifest : null,
    dir,
  };
}

export async function loadOptionalManifest(manifestPath) {
  return manifestPath ? readJsonFile(manifestPath) : null;
}

export async function resolveLinkedArtifactManifest({
  manifest,
  artifactName,
  baseDir,
  artifactDir,
  manifestName,
}) {
  return await firstExistingPath([
    { value: getManifestArtifactPath(manifest, artifactName, 'manifest', baseDir), baseDir },
    { value: artifactDir ? path.join(artifactDir, manifestName) : null, baseDir: artifactDir },
  ]);
}

export function resolveLinkedArtifactDir({
  explicitDir,
  manifest,
  artifactName,
  baseDir,
  fallbackDir = null,
}) {
  return path.resolve(explicitDir ?? getManifestArtifactDir(manifest, artifactName, baseDir) ?? fallbackDir);
}
