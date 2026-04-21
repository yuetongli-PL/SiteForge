// @ts-check

import path from 'node:path';

import { pathExists, readJsonFile } from '../../infra/io.mjs';
import { getManifestArtifactDir, getManifestArtifactPath } from '../engine/run-manifest.mjs';
import { buildRunsAwareCandidates } from './runs.mjs';

async function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (!candidate?.value) {
      continue;
    }
    const resolved = path.isAbsolute(candidate.value)
      ? candidate.value
      : path.resolve(candidate.baseDir ?? '.', candidate.value);
    if (await pathExists(resolved)) {
      return resolved;
    }
  }
  return null;
}

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
    const manifestPath = await firstExistingPath(buildRunsAwareCandidates(options[manifestOption], process.cwd()));
    if (!manifestPath) {
      throw new Error(`${missingManifestMessagePrefix}${path.resolve(options[manifestOption])}`);
    }
    return {
      manifestPath,
      dir: path.dirname(manifestPath),
    };
  }

  if (!options[dirOption]) {
    throw new Error(missingArgsMessage);
  }

  const dir = await firstExistingPath(buildRunsAwareCandidates(options[dirOption], process.cwd()));
  if (!dir) {
    throw new Error(`${missingDirMessagePrefix}${path.resolve(options[dirOption])}`);
  }

  const manifestPath = await firstExistingPath(
    buildRunsAwareCandidates(path.join(dir, manifestName), dir),
  );
  return {
    manifestPath,
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
    ...buildRunsAwareCandidates(getManifestArtifactPath(manifest, artifactName, 'manifest', baseDir), baseDir),
    ...buildRunsAwareCandidates(artifactDir ? path.join(artifactDir, manifestName) : null, artifactDir),
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

export default {
  loadOptionalManifest,
  resolveLinkedArtifactDir,
  resolveLinkedArtifactManifest,
  resolveStageInput,
};
