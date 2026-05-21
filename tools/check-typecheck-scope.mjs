#!/usr/bin/env node
// @ts-check

import { access, readFile } from 'node:fs/promises';
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
  if (scope.mode !== 'staged-js-checkjs') {
    throw new Error('typecheck scope mode must be staged-js-checkjs.');
  }
  const checkedFiles = scope.checkedFiles ?? [];
  if (!Array.isArray(checkedFiles) || checkedFiles.length === 0) {
    throw new Error('typecheck scope must list checkedFiles.');
  }
  assertSortedUnique(checkedFiles, 'checkedFiles');
  assertSortedUnique(tsconfig.files ?? [], 'tsconfig.typecheck.json files');
  if (JSON.stringify(checkedFiles) !== JSON.stringify(tsconfig.files ?? [])) {
    throw new Error('tsconfig.typecheck.json files must match tools/typecheck-scope.json checkedFiles.');
  }
  const options = tsconfig.compilerOptions ?? {};
  for (const [key, expected] of Object.entries({
    allowJs: true,
    checkJs: true,
    noEmit: true,
    noResolve: true,
  })) {
    if (options[key] !== expected) {
      throw new Error(`tsconfig.typecheck.json compilerOptions.${key} must be ${expected}.`);
    }
  }
  for (const relativePath of checkedFiles) {
    await access(path.join(REPO_ROOT, relativePath));
  }
  const deferredScopes = scope.deferredScopes ?? [];
  if (!Array.isArray(deferredScopes) || deferredScopes.length === 0) {
    throw new Error('typecheck scope must record deferredScopes with reasons.');
  }
  for (const [index, entry] of deferredScopes.entries()) {
    if (!String(entry?.pattern ?? '').trim()) {
      throw new Error(`deferredScopes[${index}] is missing pattern.`);
    }
    if (String(entry?.reason ?? '').trim().length < 30) {
      throw new Error(`deferredScopes[${index}] must include a concrete migration reason.`);
    }
  }
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});
