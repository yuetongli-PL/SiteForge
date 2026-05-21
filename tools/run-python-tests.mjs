#!/usr/bin/env node
// @ts-check

import { realpathSync } from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, '..');

function candidateCommands() {
  return [
    process.env.PYTHON,
    'python3',
    'python',
  ].filter(Boolean);
}

function resolvePythonCommand() {
  for (const command of candidateCommands()) {
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

function normalizedTempDir() {
  const tmpdir = os.tmpdir();
  try {
    return realpathSync.native(tmpdir);
  } catch {
    return tmpdir;
  }
}

const python = resolvePythonCommand();
const env = {
  ...process.env,
  TMPDIR: `${normalizedTempDir()}${path.sep}`,
};
const result = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'tests/python', '-p', 'test_*.py'], {
  cwd: REPO_ROOT,
  env,
  stdio: 'inherit',
});

process.exitCode = result.status ?? 1;
