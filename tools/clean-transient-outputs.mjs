// @ts-check

import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..');

export const TRANSIENT_CLEANUP_TARGETS = Object.freeze([
  'archive',
  'captures',
  'expanded-states',
  'state-analysis',
  'interaction-abstraction',
  'nl-entry',
  'operation-docs',
  'governance',
  path.join('runs', 'sites'),
  path.join('runs', 'scratch', 'tmp'),
  path.join('runs', 'scratch'),
]);

async function collectPycacheDirectories(rootPath, relativePath = '') {
  const targetPath = path.join(rootPath, relativePath);
  const entries = await readdir(targetPath, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name === '.git') {
      continue;
    }
    const childRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
    if (entry.name === '__pycache__') {
      matches.push(childRelativePath);
      continue;
    }
    matches.push(...await collectPycacheDirectories(rootPath, childRelativePath));
  }
  return matches;
}

function normalizeBooleanFlag(value, flagName) {
  if (typeof value === 'boolean') {
    return value;
  }
  throw new Error(`Invalid boolean for ${flagName}: ${value}`);
}

export function parseCliArgs(argv) {
  const args = [...argv];
  const options = {
    dryRun: false,
    keepEmptyDirs: false,
    repoRoot: REPO_ROOT,
  };

  for (const token of args) {
    switch (token) {
      case '--help':
      case '-h':
        return { help: true, options };
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--keep-empty-dirs':
        options.keepEmptyDirs = true;
        break;
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  options.dryRun = normalizeBooleanFlag(options.dryRun, 'dryRun');
  options.keepEmptyDirs = normalizeBooleanFlag(options.keepEmptyDirs, 'keepEmptyDirs');
  return { help: false, options };
}

export async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isWithinWorkspace(repoRoot, candidatePath) {
  const normalizedRoot = path.resolve(repoRoot);
  const normalizedCandidate = path.resolve(candidatePath);
  return normalizedCandidate === normalizedRoot
    || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

async function isDirectoryEmpty(targetPath) {
  const entries = await readdir(targetPath, { withFileTypes: true });
  return entries.length === 0;
}

export async function cleanTransientOutputs(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? REPO_ROOT);
  const dryRun = options.dryRun === true;
  const keepEmptyDirs = options.keepEmptyDirs === true;
  const removed = [];
  const recreated = [];
  const missing = [];
  const recreateTargets = [];
  const dynamicTargets = await collectPycacheDirectories(repoRoot);
  const targets = [...new Set([...TRANSIENT_CLEANUP_TARGETS, ...dynamicTargets])];

  for (const relativePath of targets) {
    const targetPath = path.join(repoRoot, relativePath);
    if (!isWithinWorkspace(repoRoot, targetPath)) {
      throw new Error(`Refusing to clean path outside repo root: ${targetPath}`);
    }
    if (!await pathExists(targetPath)) {
      missing.push(relativePath);
      continue;
    }

    const entries = await readdir(targetPath, { withFileTypes: true });
    if (entries.length === 0) {
      if (keepEmptyDirs) {
        recreateTargets.push(relativePath);
      } else if (!dryRun) {
        await rm(targetPath, { recursive: true, force: true });
      }
      removed.push(relativePath);
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(targetPath, entry.name);
      if (!isWithinWorkspace(repoRoot, entryPath)) {
        throw new Error(`Refusing to remove path outside repo root: ${entryPath}`);
      }
      if (!dryRun) {
        await rm(entryPath, { recursive: true, force: true });
      }
    }

    removed.push(relativePath);

    if (keepEmptyDirs) {
      recreateTargets.push(relativePath);
    } else if (!dryRun && await isDirectoryEmpty(targetPath)) {
      await rm(targetPath, { recursive: true, force: true });
    }
  }

  if (keepEmptyDirs && !dryRun) {
    const orderedTargets = [...new Set(recreateTargets)]
      .sort((left, right) => left.split(path.sep).length - right.split(path.sep).length);
    for (const relativePath of orderedTargets) {
      const targetPath = path.join(repoRoot, relativePath);
      await mkdir(targetPath, { recursive: true });
      recreated.push(relativePath);
    }
  }

  return {
    repoRoot,
    dryRun,
    keepEmptyDirs,
    removed,
    recreated,
    missing,
  };
}

export function buildSummary(result) {
  return {
    repoRoot: result.repoRoot,
    dryRun: result.dryRun === true,
    keepEmptyDirs: result.keepEmptyDirs === true,
    removedCount: result.removed.length,
    recreatedCount: result.recreated.length,
    missingCount: result.missing.length,
    removed: result.removed,
    recreated: result.recreated,
    missing: result.missing,
  };
}

function printHelp() {
  process.stdout.write(`Usage:
  node tools/cleanup/clean-transient-outputs.mjs [--dry-run] [--keep-empty-dirs]

Options:
  --dry-run          Show what would be removed without mutating the repo
  --keep-empty-dirs  Recreate empty transient directories after cleanup
  --help             Show this help

Notes:
  - This command only targets transient runtime outputs and scratch directories.
  - It never touches truth/config directories, src/, tests/, or compatibility shims.
`);
}

export async function runCli(argv = process.argv.slice(2)) {
  const parsed = parseCliArgs(argv);
  if (parsed.help) {
    printHelp();
    return null;
  }
  const result = await cleanTransientOutputs(parsed.options);
  process.stdout.write(`${JSON.stringify(buildSummary(result), null, 2)}\n`);
  return result;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  await runCli();
}
