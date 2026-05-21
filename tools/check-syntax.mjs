#!/usr/bin/env node
// @ts-check

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, '..');

const SYNTAX_CHECK_FILES = Object.freeze([
  'src/entrypoints/cli/index.mjs',
  'src/entrypoints/cli/capabilities.mjs',
  'src/entrypoints/pipeline/run-pipeline.mjs',
  'src/app/pipeline/build/pipeline.mjs',
  'src/app/pipeline/build/setup-assistant.mjs',
  'src/app/pipeline/build/user-report.mjs',
  'src/app/pipeline/build/risk-policy.mjs',
  'src/app/pipeline/build/confirmation-flow.mjs',
  'src/app/pipeline/build/capability-interaction.mjs',
]);

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
