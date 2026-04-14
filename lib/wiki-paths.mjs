// @ts-check

import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { compareNullableStrings, toPosixPath } from './normalize.mjs';
import { pathExists } from './io.mjs';

export function relativeToKb(kbDir, absolutePath) {
  return toPosixPath(path.relative(kbDir, absolutePath));
}

export function kbAbsolute(kbDir, relativeKbPath) {
  return path.resolve(kbDir, relativeKbPath);
}

export function resolveMaybeRelative(inputPath, baseDir) {
  if (!inputPath) {
    return null;
  }
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(baseDir, inputPath);
}

export async function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (!candidate?.value) {
      continue;
    }
    const resolved = resolveMaybeRelative(candidate.value, candidate.baseDir);
    if (await pathExists(resolved)) {
      return resolved;
    }
  }
  return null;
}

export async function listDirectories(parentDir) {
  if (!(await pathExists(parentDir))) {
    return [];
  }
  const entries = await readdir(parentDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(parentDir, entry.name))
    .sort(compareNullableStrings);
}
