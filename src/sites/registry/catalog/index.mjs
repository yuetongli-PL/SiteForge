// @ts-check

import path from 'node:path';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';

import {
  pathExists,
  readJsonFile,
} from '../../../infra/io.mjs';
import { sanitizeHost, uniqueSortedStrings } from '../../../shared/normalize.mjs';
import { prepareRedactedArtifactJsonWithAudit } from '../../../domain/sessions/security-guard.mjs';

const DEFAULT_DOCUMENT = Object.freeze({
  version: 1,
  generatedAt: null,
  sites: {},
});

function cloneDefaultDocument() {
  return {
    version: DEFAULT_DOCUMENT.version,
    generatedAt: DEFAULT_DOCUMENT.generatedAt,
    sites: {},
  };
}

function normalizeDocument(document) {
  return {
    ...cloneDefaultDocument(),
    ...(document ?? {}),
    sites: document?.sites && typeof document.sites === 'object' ? document.sites : {},
  };
}

function normalizeArrayField(previous, patch, key, mode) {
  if (mode === 'merge') {
    return uniqueSortedStrings([
      ...(previous?.[key] ?? []),
      ...(patch?.[key] ?? []),
    ]);
  }
  if (mode === 'replace') {
    if (Object.prototype.hasOwnProperty.call(patch ?? {}, key)) {
      return uniqueSortedStrings([...(patch?.[key] ?? [])]);
    }
    return uniqueSortedStrings([...(previous?.[key] ?? [])]);
  }
  throw new Error(`Unsupported site index array field mode "${mode}" for "${key}".`);
}

function normalizeRecord(previous, patch, hostKey, arrayFieldModes) {
  const next = {
    ...(previous ?? {}),
    ...(patch ?? {}),
    host: hostKey,
  };
  for (const [key, mode] of Object.entries(arrayFieldModes ?? {})) {
    next[key] = normalizeArrayField(previous, patch, key, mode);
  }
  return next;
}

function normalizeAuditPath(pathOptions = /** @type {any} */ ({})) {
  const text = String(pathOptions.redactionAuditPath ?? '').trim();
  return text ? path.resolve(text) : null;
}

function artifactTargetKey(filePath) {
  return path.resolve(filePath).toLowerCase();
}

function assertDistinctArtifactTargets(filePaths = /** @type {any[]} */ ([]), label = 'Site index writer') {
  const seen = new Map();
  for (const filePath of filePaths) {
    const key = artifactTargetKey(filePath);
    if (seen.has(key)) {
      throw new Error(`${label} output paths must be distinct: ${seen.get(key)} and ${filePath}`);
    }
    seen.set(key, filePath);
  }
}

async function assertTargetIsNotDirectory(filePath, label = 'Site index writer') {
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      throw new Error(`${label} output path must not be a directory: ${filePath}`);
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

function createTempPath(filePath, index) {
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${index}.tmp`,
  );
}

async function restoreBackups(committedEntries, backedUpEntries) {
  await Promise.allSettled(committedEntries.map((entry) => unlink(entry.filePath)));
  for (const entry of [...backedUpEntries].reverse()) {
    await rename(entry.backupPath, entry.filePath);
  }
}

async function writeSiteIndexFileSet(entries = /** @type {any[]} */ ([]), label = 'Site index writer') {
  assertDistinctArtifactTargets(entries.map((entry) => entry.filePath), label);
  for (const entry of entries) {
    await assertTargetIsNotDirectory(entry.filePath, label);
    await mkdir(path.dirname(entry.filePath), { recursive: true });
  }

  const stamp = `${process.pid}.${Date.now()}`;
  const preparedEntries = entries.map((entry, index) => ({
    ...entry,
    tempPath: createTempPath(entry.filePath, index),
    backupPath: path.join(path.dirname(entry.filePath), `.${path.basename(entry.filePath)}.${stamp}.${index}.bak`),
  }));
  const backedUpEntries = /** @type {any[]} */ ([]);
  const committedEntries = /** @type {any[]} */ ([]);

  try {
    for (const entry of preparedEntries) {
      await writeFile(entry.tempPath, `${String(entry.text).trimEnd()}\n`, 'utf8');
    }
    for (const entry of preparedEntries) {
      if (await pathExists(entry.filePath)) {
        await rename(entry.filePath, entry.backupPath);
        backedUpEntries.push(entry);
      }
    }
    for (const entry of preparedEntries) {
      await rename(entry.tempPath, entry.filePath);
      committedEntries.push(entry);
    }
    await Promise.allSettled(backedUpEntries.map((entry) => unlink(entry.backupPath)));
  } catch (error) {
    await Promise.allSettled(preparedEntries.map((entry) => unlink(entry.tempPath)));
    await restoreBackups(committedEntries, backedUpEntries);
    throw error;
  }
}

export function createSiteIndexStore({
  fileName,
  directoryName = null,
  arrayFieldModes = /** @type {any} */ ({}),
  resultPathKey = 'documentPath',
  trackTimestamps = true,
  requireRedactionAudit = false,
}) {
  const relativePath = directoryName ? path.join(directoryName, fileName) : fileName;

  function buildPath(workspaceRoot = process.cwd(), pathOptions = /** @type {any} */ ({})) {
    const explicitPath = typeof pathOptions?.documentPath === 'string' && pathOptions.documentPath.trim()
      ? pathOptions.documentPath
      : null;
    if (explicitPath) {
      return path.resolve(explicitPath);
    }
    const explicitConfigDir = typeof pathOptions?.configDir === 'string' && pathOptions.configDir.trim()
      ? pathOptions.configDir
      : null;
    if (explicitConfigDir) {
      return path.resolve(explicitConfigDir, path.basename(relativePath));
    }
    return path.resolve(workspaceRoot, relativePath);
  }

  async function read(workspaceRoot = process.cwd(), pathOptions = /** @type {any} */ ({})) {
    const documentPath = buildPath(workspaceRoot, pathOptions);
    if (!await pathExists(documentPath)) {
      return cloneDefaultDocument();
    }
    const document = await readJsonFile(documentPath);
    return normalizeDocument(document);
  }

  async function upsert(workspaceRoot, host, patch, pathOptions = /** @type {any} */ ({})) {
    const documentPath = buildPath(workspaceRoot, pathOptions);
    const document = await read(workspaceRoot, pathOptions);
    const hostKey = sanitizeHost(host);
    const previous = document.sites?.[hostKey] ?? {};
    const updatedAt = trackTimestamps ? new Date().toISOString() : null;
    const record = {
      ...normalizeRecord(previous, patch, hostKey, arrayFieldModes),
    };
    if (trackTimestamps) {
      record.updatedAt = updatedAt;
    }

    if (trackTimestamps) {
      document.generatedAt = updatedAt;
    }
    document.sites = {
      ...(document.sites ?? {}),
      [hostKey]: record,
    };
    const prepared = prepareRedactedArtifactJsonWithAudit(document);
    const redactionAuditPath = normalizeAuditPath(pathOptions);
    if (requireRedactionAudit && !redactionAuditPath) {
      throw new Error('Site index writer redactionAuditPath is required.');
    }
    await writeSiteIndexFileSet([
      { filePath: documentPath, text: prepared.json },
      ...(redactionAuditPath ? [
        { filePath: redactionAuditPath, text: prepared.auditJson },
      ] : []),
    ]);
    return {
      [resultPathKey]: documentPath,
      ...(redactionAuditPath ? { redactionAuditPath } : {}),
      record: prepared.value.sites?.[hostKey] ?? record,
    };
  }

  return {
    buildPath,
    read,
    upsert,
  };
}
