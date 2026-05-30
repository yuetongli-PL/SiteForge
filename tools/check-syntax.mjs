#!/usr/bin/env node
// @ts-check

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, '..');

const SYNTAX_CHECK_ROOTS = Object.freeze([
  'src',
  'tools',
  'scripts',
  'schema',
  'tests/node',
]);

const SYNTAX_CHECK_JS_DIRS = new Set([
  'src/app/pipeline/build/browser-bridge-extension',
]);

const PYTHON_SYNTAX_CHECK_ROOTS = Object.freeze([
  'src',
  'tests/python',
]);

function candidatePythonCommands() {
  return [
    process.env.PYTHON,
    'python3',
    'python',
  ].filter(Boolean);
}

function resolvePythonCommand() {
  for (const command of candidatePythonCommands()) {
    const result = spawnSync(command, ['--version'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    if (result.status === 0) {
      return command;
    }
  }
  throw new Error('No Python interpreter found. Set PYTHON or install python3.');
}

function shouldCheckSyntaxFile(relativeDir, fileName) {
  if (/\.mjs$/u.test(fileName)) {
    return true;
  }
  return /\.js$/u.test(fileName) && SYNTAX_CHECK_JS_DIRS.has(relativeDir);
}

function collectSyntaxCheckFiles() {
  const files = [];
  function walk(relativeDir) {
    const absoluteDir = path.join(REPO_ROOT, relativeDir);
    if (!existsSync(absoluteDir)) {
      return;
    }
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      const relativePath = path.join(relativeDir, entry.name).replace(/\\/gu, '/');
      if (entry.isDirectory()) {
        walk(relativePath);
        continue;
      }
      if (shouldCheckSyntaxFile(relativeDir, entry.name)) {
        files.push(relativePath);
      }
    }
  }
  for (const root of SYNTAX_CHECK_ROOTS) {
    walk(root);
  }
  return files.sort((left, right) => left.localeCompare(right, 'en'));
}

function collectPythonSyntaxCheckFiles() {
  const files = [];
  function walk(relativeDir) {
    const absoluteDir = path.join(REPO_ROOT, relativeDir);
    if (!existsSync(absoluteDir)) {
      return;
    }
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      const relativePath = path.join(relativeDir, entry.name).replace(/\\/gu, '/');
      if (entry.isDirectory()) {
        walk(relativePath);
        continue;
      }
      if (/\.py$/u.test(entry.name)) {
        files.push(relativePath);
      }
    }
  }
  for (const root of PYTHON_SYNTAX_CHECK_ROOTS) {
    walk(root);
  }
  return files.sort((left, right) => left.localeCompare(right, 'en'));
}

const SYNTAX_CHECK_FILES = collectSyntaxCheckFiles();
const PYTHON_SYNTAX_CHECK_FILES = collectPythonSyntaxCheckFiles();
const PYTHON_SYNTAX_CHECK_SCRIPT = [
  'from pathlib import Path',
  'import sys',
  'path = Path(sys.argv[1])',
  "source = path.read_text(encoding='utf-8-sig')",
  "compile(source, sys.argv[1], 'exec')",
].join('\n');

let failed = false;

for (const relativePath of SYNTAX_CHECK_FILES) {
  const result = spawnSync(process.execPath, ['--check', relativePath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    console.log(`ok ${relativePath}`);
    continue;
  }

  failed = true;
  console.error(`failed ${relativePath}`);
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
}

let python = null;
if (PYTHON_SYNTAX_CHECK_FILES.length > 0) {
  try {
    python = resolvePythonCommand();
  } catch (error) {
    failed = true;
    console.error(error?.message ?? error);
  }
}

if (python) {
  for (const relativePath of PYTHON_SYNTAX_CHECK_FILES) {
    const result = spawnSync(python, ['-c', PYTHON_SYNTAX_CHECK_SCRIPT, relativePath], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1',
      },
    });
    if (result.status === 0) {
      console.log(`ok ${relativePath}`);
      continue;
    }

    failed = true;
    console.error(`failed ${relativePath}`);
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`Syntax check passed for ${SYNTAX_CHECK_FILES.length + PYTHON_SYNTAX_CHECK_FILES.length} files.`);
}
