import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');
const BUILTIN_SPECIFIERS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

const IMPORT_PATTERNS = [
  /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gu,
  /\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/gu,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/gu,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/gu,
];

async function listSourceFiles(rootRelativePath) {
  const rootPath = path.join(REPO_ROOT, rootRelativePath);
  const results = [];
  async function walk(currentPath) {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (/\.(?:mjs|js)$/iu.test(entry.name)) {
        results.push(absolutePath);
      }
    }
  }
  await walk(rootPath);
  return results.sort();
}

function collectImportSpecifiers(sourceText) {
  const specifiers = [];
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of sourceText.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function toRepoRelativePath(absolutePath) {
  return path.relative(REPO_ROOT, absolutePath).replace(/\\/gu, '/');
}

function resolveImportPath(fromFile, specifier) {
  if (!specifier || BUILTIN_SPECIFIERS.has(specifier) || !specifier.startsWith('.')) {
    return null;
  }
  const candidate = path.resolve(path.dirname(fromFile), specifier);
  const withExtension = /\.[a-z0-9]+$/iu.test(candidate) ? candidate : `${candidate}.mjs`;
  return toRepoRelativePath(withExtension);
}

async function collectResolvedImports(rootRelativePath) {
  const files = await listSourceFiles(rootRelativePath);
  const imports = [];
  for (const filePath of files) {
    const sourceText = await readFile(filePath, 'utf8');
    for (const specifier of collectImportSpecifiers(sourceText)) {
      imports.push({
        filePath,
        fileRelativePath: toRepoRelativePath(filePath),
        specifier,
        resolvedRelativePath: resolveImportPath(filePath, specifier),
      });
    }
  }
  return imports;
}

function assertNoResolvedPrefix(imports, forbiddenPrefix, messagePrefix) {
  const hits = imports.filter((entry) => entry.resolvedRelativePath?.startsWith(forbiddenPrefix));
  assert.deepEqual(
    hits.map((entry) => `${entry.fileRelativePath} -> ${entry.specifier}`),
    [],
    `${messagePrefix}: ${forbiddenPrefix}`,
  );
}

test('src, tests, tools, and schema do not import retired lib modules', async () => {
  const imports = [
    ...await collectResolvedImports('src'),
    ...await collectResolvedImports('tests'),
    ...await collectResolvedImports('tools'),
    ...await collectResolvedImports('schema'),
  ];
  assertNoResolvedPrefix(imports, 'lib/', 'retired internal import detected');
});

test('site modules do not depend on scripts, root shims, or pipeline stage implementations', async () => {
  const imports = await collectResolvedImports('src/sites');
  assertNoResolvedPrefix(imports, 'scripts/', 'site module should not import scripts');
  assertNoResolvedPrefix(imports, 'src/pipeline/stages/', 'site module should not import pipeline stages');

  const rootShimHits = imports.filter((entry) => {
    const resolved = entry.resolvedRelativePath;
    return resolved
      && !resolved.startsWith('src/')
      && !resolved.startsWith('tools/')
      && !resolved.startsWith('schema/')
      && /\.mjs$/iu.test(resolved);
  });
  assert.deepEqual(
    rootShimHits.map((entry) => `${entry.fileRelativePath} -> ${entry.specifier}`),
    [],
    'site modules should not import root compatibility shims',
  );
});

test('core page-types only dispatches through adapter resolution for site-specific logic', async () => {
  const pageTypesPath = path.join(REPO_ROOT, 'src', 'sites', 'core', 'page-types.mjs');
  const sourceText = await readFile(pageTypesPath, 'utf8');
  const imports = collectImportSpecifiers(sourceText);
  const resolved = imports
    .map((specifier) => resolveImportPath(pageTypesPath, specifier))
    .filter(Boolean);

  const invalid = resolved.filter((entry) => (
    entry.startsWith('src/sites/douyin/')
    || entry.startsWith('src/sites/bilibili/')
    || entry.startsWith('src/sites/jable/')
  ));

  assert.deepEqual(
    invalid,
    [],
    'src/sites/core/page-types.mjs should stay generic and reach site-specific logic only via adapters',
  );
});

test('expand stage consumes shared page-type inference instead of maintaining a local site-specific copy', async () => {
  const expandPath = path.join(REPO_ROOT, 'src', 'pipeline', 'stages', 'expand.mjs');
  const sourceText = await readFile(expandPath, 'utf8');

  assert.match(
    sourceText,
    /import\s*\{\s*inferPageTypeFromUrl/u,
    'src/pipeline/stages/expand.mjs should import shared inferPageTypeFromUrl from src/sites/core/page-types.mjs',
  );
  assert.equal(
    /^function inferPageTypeFromUrl/mu.test(sourceText),
    false,
    'src/pipeline/stages/expand.mjs should not redefine inferPageTypeFromUrl locally',
  );
  assert.equal(
    /^function inferProfilePageTypeFromPathname/mu.test(sourceText),
    false,
    'src/pipeline/stages/expand.mjs should not keep a local profile pathname inference copy',
  );
});

test('kb index consumes site augmentation through the core registry instead of importing bilibili directly', async () => {
  const kbIndexPath = path.join(REPO_ROOT, 'src', 'pipeline', 'stages', 'kb', 'index.mjs');
  const sourceText = await readFile(kbIndexPath, 'utf8');
  const imports = collectImportSpecifiers(sourceText);
  const resolved = imports
    .map((specifier) => resolveImportPath(kbIndexPath, specifier))
    .filter(Boolean);

  const invalid = resolved.filter((entry) => entry.startsWith('src/sites/bilibili/'));

  assert.deepEqual(
    invalid,
    [],
    'src/pipeline/stages/kb/index.mjs should consume site-specific KB logic only through src/sites/core/kb-augmentation.mjs',
  );
});

test('kb index renders site-specific state sections only through the augmentation hook', async () => {
  const kbIndexPath = path.join(REPO_ROOT, 'src', 'pipeline', 'stages', 'kb', 'index.mjs');
  const sourceText = await readFile(kbIndexPath, 'utf8');
  const renderStatePageMatch = sourceText.match(/function renderStatePageEnhanced\(page, context, pagesById\) \{[\s\S]*?\n\}/u);
  const renderStatePageSource = renderStatePageMatch?.[0] ?? '';

  assert.match(
    sourceText,
    /kbAugmentation\?\.\s*renderStateSections\?\./u,
    'src/pipeline/stages/kb/index.mjs should consume site-specific state rendering only through renderStateSections()',
  );
  assert.equal(
    /featuredAuthorCards|featuredContentCards/u.test(renderStatePageSource),
    false,
    'src/pipeline/stages/kb/index.mjs should not inline bilibili featured-card rendering',
  );
});

test('skills generation modules do not depend on browser/auth runtime internals', async () => {
  const imports = await collectResolvedImports('src/skills');
  const hits = imports.filter((entry) => (
    entry.resolvedRelativePath?.startsWith('src/infra/auth/')
    || entry.resolvedRelativePath?.startsWith('src/infra/browser/')
  ));
  assert.deepEqual(
    hits.map((entry) => `${entry.fileRelativePath} -> ${entry.specifier}`),
    [],
    'skills generation must stay independent from browser/auth runtime internals',
  );
});

test('script shims only target src entrypoints or tools', async () => {
  const imports = await collectResolvedImports('scripts');
  const invalid = imports.filter((entry) => {
    const resolved = entry.resolvedRelativePath;
    if (!resolved) {
      return false;
    }
    return !resolved.startsWith('src/entrypoints/') && !resolved.startsWith('tools/');
  });
  assert.deepEqual(
    invalid.map((entry) => `${entry.fileRelativePath} -> ${entry.specifier}`),
    [],
    'scripts should remain thin shims over src entrypoints or tools',
  );
});

test('site-doctor entrypoint reaches site-specific scenario suites only through the core registry', async () => {
  const doctorPath = path.join(REPO_ROOT, 'src', 'entrypoints', 'sites', 'site-doctor.mjs');
  const sourceText = await readFile(doctorPath, 'utf8');
  const imports = collectImportSpecifiers(sourceText);
  const resolved = imports
    .map((specifier) => resolveImportPath(doctorPath, specifier))
    .filter(Boolean);

  const invalid = resolved.filter((entry) => (
    entry.startsWith('src/sites/bilibili/')
    || entry.startsWith('src/sites/douyin/')
  ));

  assert.deepEqual(
    invalid,
    [],
    'src/entrypoints/sites/site-doctor.mjs should consume site-specific doctor suites only through src/sites/core/site-doctor-scenarios.mjs',
  );
  assert.match(
    sourceText,
    /site-doctor-scenarios\.mjs/u,
    'src/entrypoints/sites/site-doctor.mjs should import the core doctor scenario registry',
  );
});

test('nl stage reaches site-specific NL semantics only through the core registry', async () => {
  const nlPath = path.join(REPO_ROOT, 'src', 'pipeline', 'stages', 'nl.mjs');
  const sourceText = await readFile(nlPath, 'utf8');
  const imports = collectImportSpecifiers(sourceText);
  const resolved = imports
    .map((specifier) => resolveImportPath(nlPath, specifier))
    .filter(Boolean);

  const invalid = resolved.filter((entry) => (
    entry.startsWith('src/sites/jable/')
    || entry.startsWith('src/sites/moodyz/')
  ));

  assert.deepEqual(
    invalid,
    [],
    'src/pipeline/stages/nl.mjs should consume site-specific NL semantics only through src/sites/core/nl-site-semantics.mjs',
  );
  assert.match(
    sourceText,
    /nl-site-semantics\.mjs/u,
    'src/pipeline/stages/nl.mjs should import the core NL semantics registry',
  );
});

test('site-renderers facade stays thin and delegates through the renderer registry', async () => {
  const renderersPath = path.join(REPO_ROOT, 'src', 'skills', 'generation', 'render', 'site-renderers.mjs');
  const sourceText = await readFile(renderersPath, 'utf8');

  assert.match(
    sourceText,
    /site-renderers\/registry\.mjs/u,
    'src/skills/generation/render/site-renderers.mjs should import the renderer registry',
  );
  assert.equal(
    /^function render(?:Moodyz|Jable|22Biqu|Bilibili|Douyin)/mu.test(sourceText),
    false,
    'src/skills/generation/render/site-renderers.mjs should not keep site-specific renderer implementations',
  );
});
