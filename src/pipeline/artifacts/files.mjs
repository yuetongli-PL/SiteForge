// @ts-check

import path from 'node:path';

import { readJsonFile, pathExists } from '../../infra/io.mjs';
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

export async function resolveStageFile({ manifest, manifestDir, dir, manifestField, defaultFileName }) {
  return await firstExistingPath([
    ...buildRunsAwareCandidates(manifest?.files?.[manifestField], manifestDir ?? dir),
    ...buildRunsAwareCandidates(dir ? path.join(dir, defaultFileName) : null, dir),
  ]);
}

export async function resolveStageFiles({ manifest, manifestDir, dir, files }) {
  const entries = await Promise.all(
    Object.entries(files).map(async ([key, config]) => ([
      key,
      await resolveStageFile({
        manifest,
        manifestDir,
        dir,
        manifestField: config.manifestField,
        defaultFileName: config.defaultFileName,
      }),
    ])),
  );
  return Object.fromEntries(entries);
}

export async function readJsonArtifacts(paths, fallbackFactory = null) {
  const entries = await Promise.all(
    Object.entries(paths).map(async ([key, filePath]) => {
      if (filePath) {
        return [key, await readJsonFile(filePath)];
      }
      if (typeof fallbackFactory === 'function') {
        return [key, fallbackFactory(key)];
      }
      return [key, null];
    }),
  );
  return Object.fromEntries(entries);
}

export async function resolveNamedManifest(dir, candidateNames) {
  const candidates = [];
  for (const name of candidateNames ?? []) {
    candidates.push(...buildRunsAwareCandidates(dir ? path.join(dir, name) : null, dir));
  }
  return await firstExistingPath(candidates);
}

export default {
  readJsonArtifacts,
  resolveNamedManifest,
  resolveStageFile,
  resolveStageFiles,
};
