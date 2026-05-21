#!/usr/bin/env node
// @ts-check

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, '..');
const SCOPE_PATH = path.join(REPO_ROOT, 'tools', 'typecheck-scope.json');
const TSCONFIG_PATH = path.join(REPO_ROOT, 'tsconfig.typecheck.json');

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function assertSortedUnique(values, label) {
  const sorted = [...values].sort();
  if (JSON.stringify(values) !== JSON.stringify(sorted)) {
    throw new Error(`${label} must be sorted for stable review.`);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
}

async function main() {
  const [scope, tsconfig] = await Promise.all([
    readJson(SCOPE_PATH),
    readJson(TSCONFIG_PATH),
  ]);
  if (scope.schemaVersion !== 1) {
    throw new Error('tools/typecheck-scope.json schemaVersion must be 1.');
  }
  if (scope.mode !== 'full-js-checkjs') {
    throw new Error('typecheck scope mode must be full-js-checkjs.');
  }
  const includedGlobs = scope.includedGlobs ?? [];
  if (!Array.isArray(includedGlobs) || includedGlobs.length === 0) {
    throw new Error('typecheck scope must list includedGlobs.');
  }
  assertSortedUnique(includedGlobs, 'includedGlobs');
  assertSortedUnique(tsconfig.include ?? [], 'tsconfig.typecheck.json include');
  if (JSON.stringify(includedGlobs) !== JSON.stringify(tsconfig.include ?? [])) {
    throw new Error('tsconfig.typecheck.json include must match tools/typecheck-scope.json includedGlobs.');
  }
  if ('files' in tsconfig) {
    throw new Error('tsconfig.typecheck.json must not use a staged files list.');
  }
  const options = tsconfig.compilerOptions ?? {};
  for (const [key, expected] of Object.entries({
    allowJs: true,
    checkJs: true,
    noEmit: true,
  })) {
    if (options[key] !== expected) {
      throw new Error(`tsconfig.typecheck.json compilerOptions.${key} must be ${expected}.`);
    }
  }
  if (!Array.isArray(options.types) || !options.types.includes('node')) {
    throw new Error('tsconfig.typecheck.json must include Node types.');
  }
  const deferredScopes = scope.deferredScopes ?? [];
  if (Array.isArray(deferredScopes) && deferredScopes.length > 0) {
    throw new Error('full typecheck scope must not defer repository source globs.');
  }
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});
