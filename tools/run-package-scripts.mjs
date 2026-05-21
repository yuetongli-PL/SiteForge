#!/usr/bin/env node
// @ts-check

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, '..');

const packageJson = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const scripts = packageJson.scripts ?? {};
const scriptNames = process.argv.slice(2);

if (!scriptNames.length) {
  console.error('Usage: node tools/run-package-scripts.mjs <script> [script...]');
  process.exit(1);
}

for (const scriptName of scriptNames) {
  if (scriptName === 'test:node:focused') {
    console.error('Refusing to recursively run test:node:focused.');
    process.exit(1);
  }
  const command = scripts[scriptName];
  if (!command) {
    console.error(`Unknown package script: ${scriptName}`);
    process.exit(1);
  }

  console.log(`\n> ${scriptName}`);
  console.log(`> ${command}\n`);
  const result = spawnSync(command, {
    cwd: REPO_ROOT,
    env: process.env,
    shell: true,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
