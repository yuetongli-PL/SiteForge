// @ts-check

import path from 'node:path';
import { readJsonFile } from '../../io.mjs';
import { firstExistingPath } from '../../wiki-paths.mjs';

export async function resolveStageFile({ manifest, manifestDir, dir, manifestField, defaultFileName }) {
  return await firstExistingPath([
    { value: manifest?.files?.[manifestField], baseDir: manifestDir ?? dir },
    { value: dir ? path.join(dir, defaultFileName) : null, baseDir: dir },
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
  return await firstExistingPath(
    (candidateNames ?? []).map((name) => ({
      value: dir ? path.join(dir, name) : null,
      baseDir: dir,
    })),
  );
}
