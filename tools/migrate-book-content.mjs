// @ts-check

import { cp, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initializeCliUtf8, writeJsonStdout } from '../src/infra/cli.mjs';
import { pathExists, readJsonFile, writeJsonFile } from '../src/infra/io.mjs';
import { normalizeWhitespace, sanitizeHost } from '../src/shared/normalize.mjs';

const DEFAULT_OPTIONS = {
  rootDir: path.resolve(process.cwd(), 'book-content'),
  knowledgeBaseDir: path.resolve(process.cwd(), 'knowledge-base'),
  deleteSource: true,
};

function hostBookContentRoot(rootDir, host) {
  const resolved = path.resolve(rootDir);
  const hostSlug = sanitizeHost(host);
  return path.basename(resolved) === hostSlug ? resolved : path.join(resolved, hostSlug);
}

function replacePathPrefixInValue(value, oldPrefix, newPrefix) {
  if (typeof value === 'string') {
    const normalized = path.resolve(oldPrefix);
    const resolvedNew = path.resolve(newPrefix);
    if (path.resolve(value).startsWith(normalized)) {
      return path.join(resolvedNew, path.relative(normalized, path.resolve(value)));
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replacePathPrefixInValue(item, oldPrefix, newPrefix));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, replacePathPrefixInValue(nested, oldPrefix, newPrefix)])
    );
  }
  return value;
}

async function listDirectories(dirPath) {
  if (!await pathExists(dirPath)) {
    return [];
  }
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(dirPath, entry.name));
}

async function rewriteRunPaths(runDir, oldDir, newDir) {
  const manifestPath = path.join(runDir, 'book-content-manifest.json');
  const booksPath = path.join(runDir, 'books.json');
  if (await pathExists(manifestPath)) {
    const manifest = replacePathPrefixInValue(await readJsonFile(manifestPath), oldDir, newDir);
    await writeJsonFile(manifestPath, manifest);
  }
  if (await pathExists(booksPath)) {
    const books = replacePathPrefixInValue(await readJsonFile(booksPath), oldDir, newDir);
    await writeJsonFile(booksPath, books);
  }

  const booksDir = path.join(runDir, 'books');
  for (const bookDir of await listDirectories(booksDir)) {
    const bookFile = path.join(bookDir, 'book.json');
    const authorFile = path.join(bookDir, 'author.json');
    if (await pathExists(bookFile)) {
      const payload = replacePathPrefixInValue(await readJsonFile(bookFile), oldDir, newDir);
      await writeJsonFile(bookFile, payload);
    }
    if (await pathExists(authorFile)) {
      const payload = replacePathPrefixInValue(await readJsonFile(authorFile), oldDir, newDir);
      await writeJsonFile(authorFile, payload);
    }
  }
}

async function validateRun(runDir) {
  const manifestPath = path.join(runDir, 'book-content-manifest.json');
  const booksPath = path.join(runDir, 'books.json');
  if (!await pathExists(manifestPath) || !await pathExists(booksPath)) {
    throw new Error(`Migrated run is missing required files: ${runDir}`);
  }
  const manifest = await readJsonFile(manifestPath);
  const books = await readJsonFile(booksPath);
  for (const filePath of Object.values(manifest.files ?? {})) {
    if (typeof filePath !== 'string' || !await pathExists(filePath)) {
      throw new Error(`Manifest file reference missing after migration: ${filePath}`);
    }
  }
  for (const book of Array.isArray(books) ? books : []) {
    for (const key of ['downloadFile', 'bookFile', 'chaptersFile', 'authorFile']) {
      if (book[key] && !await pathExists(book[key])) {
        throw new Error(`Book file reference missing after migration: ${book[key]}`);
      }
    }
  }
}

async function updateKnowledgeBaseSources(knowledgeBaseDir, oldDir, newDir) {
  const kbDirs = await listDirectories(knowledgeBaseDir);
  for (const kbDir of kbDirs) {
    const sourcesPath = path.join(kbDir, 'index', 'sources.json');
    if (!await pathExists(sourcesPath)) {
      continue;
    }
    const sources = replacePathPrefixInValue(await readJsonFile(sourcesPath), oldDir, newDir);
    await writeJsonFile(sourcesPath, sources);
  }
}

async function moveOrCopyDir(sourceDir, destinationDir) {
  await mkdir(path.dirname(destinationDir), { recursive: true });
  try {
    await rename(sourceDir, destinationDir);
  } catch {
    await cp(sourceDir, destinationDir, { recursive: true, force: false });
  }
}

async function migrateRun(sourceDir, options) {
  const manifestPath = path.join(sourceDir, 'book-content-manifest.json');
  if (!await pathExists(manifestPath)) {
    return null;
  }
  const manifest = await readJsonFile(manifestPath);
  const host = sanitizeHost(manifest.host || (() => {
    try {
      return new URL(String(manifest.baseUrl || '')).host;
    } catch {
      return 'unknown-host';
    }
  })());
  const destinationDir = path.join(hostBookContentRoot(options.rootDir, host), path.basename(sourceDir));
  if (path.resolve(destinationDir) === path.resolve(sourceDir)) {
    return { sourceDir, destinationDir, host, status: 'already-hosted' };
  }
  if (await pathExists(destinationDir)) {
    return { sourceDir, destinationDir, host, status: 'skipped-existing' };
  }

  await moveOrCopyDir(sourceDir, destinationDir);
  await rewriteRunPaths(destinationDir, sourceDir, destinationDir);
  await validateRun(destinationDir);
  await updateKnowledgeBaseSources(options.knowledgeBaseDir, sourceDir, destinationDir);

  if (options.deleteSource && await pathExists(sourceDir)) {
    await rm(sourceDir, { recursive: true, force: true });
  }
  return { sourceDir, destinationDir, host, status: 'migrated' };
}

export async function migrateBookContent(options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  settings.rootDir = path.resolve(settings.rootDir);
  settings.knowledgeBaseDir = path.resolve(settings.knowledgeBaseDir);
  const results = [];

  for (const dirPath of await listDirectories(settings.rootDir)) {
    const name = path.basename(dirPath);
    if (!name.includes('_book-content')) {
      continue;
    }
    results.push(await migrateRun(dirPath, settings));
  }

  return {
    rootDir: settings.rootDir,
    migrated: results.filter((item) => item?.status === 'migrated').length,
    skipped: results.filter((item) => item?.status && item.status !== 'migrated').length,
    results: results.filter(Boolean),
  };
}

function printHelp() {
  console.log([
    'Usage:',
    '  node tools/migrate-book-content.mjs [--root-dir <dir>] [--knowledge-base-dir <dir>] [--keep-source]',
  ].join('\n'));
}

async function main(argv = process.argv.slice(2)) {
  initializeCliUtf8();
  /** @type {{rootDir?: string, knowledgeBaseDir?: string, deleteSource?: boolean}} */
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      return;
    }
    if (arg === '--root-dir') {
      options.rootDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--knowledge-base-dir') {
      options.knowledgeBaseDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--keep-source') {
      options.deleteSource = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  const result = await migrateBookContent(options);
  writeJsonStdout(result);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
