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
      if (/\.mjs$/u.test(entry.name)) {
        files.push(relativePath);
      }
    }
  }
  for (const root of SYNTAX_CHECK_ROOTS) {
    walk(root);
  }
  return files.sort((left, right) => left.localeCompare(right, 'en'));
}

const SYNTAX_CHECK_FILES = collectSyntaxCheckFiles();

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

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`Syntax check passed for ${SYNTAX_CHECK_FILES.length} files.`);
}
