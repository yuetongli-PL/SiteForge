// @ts-check

import path from 'node:path';

import { pathExists, readJsonFile, writeJsonFile } from '../../infra/io.mjs';
import { sanitizeHost, uniqueSortedStrings } from '../../shared/normalize.mjs';

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

export function createSiteIndexStore({
  fileName,
  directoryName = null,
  arrayFieldModes = {},
  resultPathKey = 'documentPath',
  trackTimestamps = true,
}) {
  const relativePath = directoryName ? path.join(directoryName, fileName) : fileName;

  function buildPath(workspaceRoot = process.cwd(), pathOptions = {}) {
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

  async function read(workspaceRoot = process.cwd(), pathOptions = {}) {
    const documentPath = buildPath(workspaceRoot, pathOptions);
    if (!await pathExists(documentPath)) {
      return cloneDefaultDocument();
    }
    const document = await readJsonFile(documentPath);
    return normalizeDocument(document);
  }

  async function upsert(workspaceRoot, host, patch, pathOptions = {}) {
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
    await writeJsonFile(documentPath, document);
    return {
      [resultPathKey]: documentPath,
      record,
    };
  }

  return {
    buildPath,
    read,
    upsert,
  };
}
