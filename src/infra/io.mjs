// @ts-check

import { access, appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(targetPath) {
  await mkdir(targetPath, { recursive: true });
}

export async function ensureParentDir(filePath) {
  await ensureDir(path.dirname(filePath));
}

export async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function writeJsonFile(filePath, payload) {
  await ensureParentDir(filePath);
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function readTextFile(filePath) {
  return await readFile(filePath, 'utf8');
}

export async function writeTextFile(filePath, value) {
  await ensureParentDir(filePath);
  await writeFile(filePath, `${String(value).trimEnd()}\n`, 'utf8');
}

export async function appendTextFile(filePath, value) {
  await ensureParentDir(filePath);
  await appendFile(filePath, String(value), 'utf8');
}

export async function writeJsonLines(filePath, rows) {
  const payload = (rows ?? []).map((row) => JSON.stringify(row)).join('\n');
  await writeTextFile(filePath, payload);
}

export async function appendJsonLine(filePath, row) {
  await appendTextFile(filePath, `${JSON.stringify(row)}\n`);
}

export async function findLatestRunDir(rootDir) {
  if (!rootDir || !await pathExists(rootDir)) {
    return null;
  }
  const entries = await readdir(rootDir, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootDir, entry.name))
    .sort((left, right) => path.basename(right).localeCompare(path.basename(left), 'en'));
  return dirs[0] ?? null;
}

export async function firstExistingPath(candidates) {
  for (const candidate of candidates ?? []) {
    if (!candidate) {
      continue;
    }
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}
