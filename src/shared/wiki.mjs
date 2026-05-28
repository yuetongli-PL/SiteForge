// @ts-check

import path from 'node:path';
import { access, readdir } from 'node:fs/promises';

import { compareNullableStrings, toPosixPath } from './normalize.mjs';

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

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

export function buildWarning(code, message, details = /** @type {any} */ ({})) {
  const normalizedDetails = typeof details === 'string' ? { path: details } : details;
  return { severity: 'warning', code, message, ...normalizedDetails };
}

export function buildError(code, message, details = /** @type {any} */ ({})) {
  const normalizedDetails = typeof details === 'string' ? { path: details } : details;
  return { severity: 'error', code, message, ...normalizedDetails };
}
