import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { access, readdir, readFile } from 'node:fs/promises';
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
  /\bexport\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/gu,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/gu,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/gu,
];

async function pathExists(rootRelativePath) {
  try {
    await access(path.join(REPO_ROOT, rootRelativePath));
    return true;
  } catch {
    return false;
  }
}

async function listSourceFiles(rootRelativePath) {
  const rootPath = path.join(REPO_ROOT, rootRelativePath);
  const results = /** @type {any[]} */ ([]);
  if (!await pathExists(rootRelativePath)) {
    return results;
  }
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
  const specifiers = /** @type {any[]} */ ([]);
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
  const imports = /** @type {any[]} */ ([]);
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

async function collectResolvedImportsFromFile(fileRelativePath) {
  const filePath = path.join(REPO_ROOT, fileRelativePath);
  const sourceText = await readFile(filePath, 'utf8');
  return collectImportSpecifiers(sourceText).map((specifier) => ({
    filePath,
    fileRelativePath,
    specifier,
    resolvedRelativePath: resolveImportPath(filePath, specifier),
  }));
}

async function collectSourcePatternMatches(rootRelativePath, pattern) {
  const files = await listSourceFiles(rootRelativePath);
  const matches = /** @type {any[]} */ ([]);
  for (const filePath of files) {
    const sourceText = await readFile(filePath, 'utf8');
    for (const match of sourceText.matchAll(pattern)) {
      const lineNumber = sourceText.slice(0, match.index).split('\n').length;
      matches.push(`${toRepoRelativePath(filePath)}:${lineNumber}: ${match[0]}`);
    }
  }
  return matches;
}

async function collectFileSourcePatternMatches(fileRelativePath, pattern) {
  const filePath = path.join(REPO_ROOT, fileRelativePath);
  const sourceText = await readFile(filePath, 'utf8');
  const matches = /** @type {any[]} */ ([]);
  for (const match of sourceText.matchAll(pattern)) {
    const lineNumber = sourceText.slice(0, match.index).split('\n').length;
    matches.push(`${fileRelativePath}:${lineNumber}: ${match[0]}`);
  }
  return matches;
}

async function listTextFiles(rootRelativePath) {
  const rootPath = path.join(REPO_ROOT, rootRelativePath);
  const results = /** @type {any[]} */ ([]);
  async function walk(currentPath) {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (/\.(?:mjs|js|json|md)$/iu.test(entry.name)) {
        results.push(absolutePath);
      }
    }
  }
  await walk(rootPath);
  return results.sort();
}

async function collectRepositoryTextPatternMatches(pattern, skip = new Set()) {
  const files = [
    ...await listTextFiles('src'),
    ...await listTextFiles('tests'),
    ...await listTextFiles('tools'),
    path.join(REPO_ROOT, 'package.json'),
    path.join(REPO_ROOT, 'README.md'),
  ];
  const matches = /** @type {any[]} */ ([]);
  for (const filePath of files) {
    const fileRelativePath = toRepoRelativePath(filePath);
    if (skip.has(fileRelativePath)) {
      continue;
    }
    const sourceText = await readFile(filePath, 'utf8');
    pattern.lastIndex = 0;
    for (const match of sourceText.matchAll(pattern)) {
      const lineNumber = sourceText.slice(0, match.index).split('\n').length;
      matches.push(`${fileRelativePath}:${lineNumber}: ${match[0]}`);
    }
  }
  return matches;
}

function assertNoResolvedPrefix(imports, forbiddenPrefix, messagePrefix) {
  const hits = imports.filter((entry) => entry.resolvedRelativePath?.startsWith(forbiddenPrefix));
  assert.deepEqual(
    hits.map((entry) => `${entry.fileRelativePath} -> ${entry.specifier}`),
    [],
    `${messagePrefix}: ${forbiddenPrefix}`,
  );
}

function assertNoResolvedPrefixExcept(imports, forbiddenPrefix, allowedPaths, messagePrefix) {
  const allowed = new Set(allowedPaths);
  const hits = imports.filter((entry) => (
    entry.resolvedRelativePath?.startsWith(forbiddenPrefix)
    && !allowed.has(entry.resolvedRelativePath)
  ));
  assert.deepEqual(
    hits.map((entry) => `${entry.fileRelativePath} -> ${entry.specifier}`),
    [],
    `${messagePrefix}: ${forbiddenPrefix}`,
  );
}

function assertNoResolvedPaths(imports, forbiddenPaths, messagePrefix) {
  const forbidden = new Set(forbiddenPaths);
  const hits = imports.filter((entry) => forbidden.has(entry.resolvedRelativePath));
  assert.deepEqual(
    hits.map((entry) => `${entry.fileRelativePath} -> ${entry.specifier}`),
    [],
    messagePrefix,
  );
}

function assertDependencyAllowlist(imports, options, messagePrefix) {
  const allowedBuiltins = new Set(options.allowedBuiltins ?? []);
  const allowedPaths = new Set(options.allowedPaths ?? []);
  const allowedPrefixes = options.allowedPrefixes ?? [];
  const hits = imports.filter((entry) => {
    if (!entry.resolvedRelativePath) {
      return !allowedBuiltins.has(entry.specifier);
    }
    return !allowedPaths.has(entry.resolvedRelativePath)
      && !allowedPrefixes.some((prefix) => entry.resolvedRelativePath.startsWith(prefix));
  });
  assert.deepEqual(
    hits.map((entry) => `${entry.fileRelativePath} -> ${entry.specifier}`),
    [],
    messagePrefix,
  );
}

const ARTIFACT_WRITE_SINK_PATTERN =
  /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|writeJsonFile|writeTextFile|writeArtifactJson|writeArtifactText|writeArtifactYaml|appendTextFile|appendJsonLine|writeJsonLines)\b/gu;
const DYNAMIC_FS_IMPORT_PATTERN = /\bimport\(\s*['"](?:node:fs|node:fs\/promises|fs|fs\/promises)['"]\s*\)/gu;

const REDACTION_GUARDED_ARTIFACT_WRITERS = new Set([
  'src/entrypoints/build/run-build.mjs',
  'src/entrypoints/sites/site-recompile-preview-summary.mjs',
  'src/entrypoints/sites/session-repair-plan.mjs',
  'src/entrypoints/sites/site-capability-compile.mjs',
  'src/entrypoints/sites/site-doctor.mjs',
  'src/entrypoints/sites/site-login.mjs',
  'src/entrypoints/sites/site-scaffold.mjs',
  'src/entrypoints/sites/social-auth-import.mjs',
  'src/infra/auth/site-session-governance.mjs',
  'src/sites/known-sites/bilibili/navigation/open.mjs',
  'src/sites/known-sites/reddit/api-catalog.mjs',
  'src/domain/capabilities/api-candidates.mjs',
  'src/domain/capabilities/api-discovery.mjs',
  'src/domain/policies/execution/layer-runtime-consumer.mjs',
  'src/domain/lifecycle/lifecycle-events.mjs',
  'src/app/planner/plan-artifact.mjs',
  'src/app/planner/policy-handoff.mjs',
  'src/app/pipeline/build/pipeline.mjs',
  'src/sites/registry/catalog/index.mjs',
  'src/domain/sessions/runner.mjs',
  'src/sites/known-sites/social/actions/router.mjs',
]);

const CONTROLLED_NON_ARTIFACT_OR_GENERATED_WRITERS = new Map([
  ['src/entrypoints/operator/capabilities.mjs', 'site-local capability confirmation decision metadata without raw material'],
  ['src/entrypoints/pipeline/generate-crawler-script.mjs', 'crawler script and registry generation'],
  ['src/entrypoints/sites/douyin-export-cookies.mjs', 'explicit credential export command'],
  ['src/infra/auth/site-auth.mjs', 'explicit session export sidecar and cookie-file writer'],
  ['src/infra/io.mjs', 'central IO primitive definitions'],
  ['src/app/pipeline/build/artifact-store.mjs', 'URL-to-Skill DAG generated artifacts, generated skill files, and generated skill registry'],
  ['src/app/pipeline/build/capability-interaction.mjs', 'site-local capability confirmation decision metadata without raw material'],
  ['src/app/pipeline/build/setup-assistant.mjs', 'first-run setup plan, choices, capability hints, and build profile artifacts'],
  ['src/app/pipeline/build/workspace.mjs', 'SiteForge workspace directories, setup defaults, current skill promotion, and last-success pointers'],
  ['src/app/runtime/providers/download-provider.mjs', 'controlled runtime download output after output policy gate and path confinement'],
  ['src/sites/known-sites/douyin/actions/router.mjs', 'temporary downloader input file for subprocess handoff'],
  ['src/sites/known-sites/douyin/queries/follow-query.mjs', 'follow-query cache persistence'],
  ['src/sites/known-sites/social/actions/download-boundary.mjs', 'explicit user-requested media binary download persistence'],
  ['src/domain/sessions/session-view.mjs', 'SessionView revocation store persistence'],
  ['src/sites/known-sites/xiaohongshu/actions/router.mjs', 'temporary downloader input file for subprocess handoff'],
]);

const ARTIFACT_WRITE_SINK_BASELINE = new Map([
  ['src/entrypoints/operator/capabilities.mjs', 2],
  ['src/entrypoints/build/run-build.mjs', 10],
  ['src/entrypoints/sites/site-recompile-preview-summary.mjs', 3],
  ['src/entrypoints/pipeline/generate-crawler-script.mjs', 6],
  ['src/entrypoints/sites/douyin-export-cookies.mjs', 5],
  ['src/entrypoints/sites/session-repair-plan.mjs', 3],
  ['src/entrypoints/sites/site-doctor.mjs', 27],
  ['src/entrypoints/sites/site-login.mjs', 5],
  ['src/entrypoints/sites/site-scaffold.mjs', 7],
  ['src/entrypoints/sites/social-auth-import.mjs', 3],
  ['src/infra/auth/site-auth.mjs', 3],
  ['src/infra/auth/site-session-governance.mjs', 8],
  ['src/infra/io.mjs', 12],
  ['src/app/pipeline/build/artifact-store.mjs', 5],
  ['src/app/pipeline/build/pipeline.mjs', 49],
  ['src/app/pipeline/build/capability-interaction.mjs', 3],
  ['src/app/pipeline/build/setup-assistant.mjs', 14],
  ['src/app/pipeline/build/workspace.mjs', 2],
  ['src/app/runtime/providers/download-provider.mjs', 2],
  ['src/sites/known-sites/bilibili/navigation/open.mjs', 5],
  ['src/sites/known-sites/reddit/api-catalog.mjs', 34],
  ['src/domain/capabilities/api-candidates.mjs', 8],
  ['src/domain/capabilities/api-discovery.mjs', 3],
  ['src/domain/policies/execution/layer-runtime-consumer.mjs', 3],
  ['src/domain/lifecycle/lifecycle-events.mjs', 3],
  ['src/app/planner/policy-handoff.mjs', 2],
  ['src/domain/sessions/session-view.mjs', 2],
  ['src/sites/registry/catalog/index.mjs', 2],
  ['src/sites/known-sites/douyin/actions/router.mjs', 2],
  ['src/sites/known-sites/douyin/queries/follow-query.mjs', 2],
  ['src/domain/sessions/runner.mjs', 5],
  ['src/sites/known-sites/social/actions/router.mjs', 20],
  ['src/sites/known-sites/social/actions/download-boundary.mjs', 1],
  ['src/sites/known-sites/xiaohongshu/actions/router.mjs', 2],
]);

function collectArtifactWriteSinkMatches(sourceText, fileRelativePath) {
  const matches = /** @type {any[]} */ ([]);
  ARTIFACT_WRITE_SINK_PATTERN.lastIndex = 0;
  for (const match of sourceText.matchAll(ARTIFACT_WRITE_SINK_PATTERN)) {
    const lineNumber = sourceText.slice(0, match.index).split('\n').length;
    matches.push(`${fileRelativePath}:${lineNumber}: ${match[0]}`);
  }
  if (matches.length > 0) {
    DYNAMIC_FS_IMPORT_PATTERN.lastIndex = 0;
    for (const match of sourceText.matchAll(DYNAMIC_FS_IMPORT_PATTERN)) {
      const lineNumber = sourceText.slice(0, match.index).split('\n').length;
      matches.push(`${fileRelativePath}:${lineNumber}: ${match[0]}`);
    }
  }
  return matches;
}

function collectCallExpressions(sourceText, calleePattern) {
  const calls = /** @type {any[]} */ ([]);
  const pattern = new RegExp(`\\b(${calleePattern})\\s*\\(`, 'gu');
  for (const match of sourceText.matchAll(pattern)) {
    const openParenIndex = match.index + match[0].lastIndexOf('(');
    let depth = 0;
    let quote = null;
    let escaped = false;
    for (let index = openParenIndex; index < sourceText.length; index += 1) {
      const character = sourceText[index];
      if (quote) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (character === '\\') {
          escaped = true;
          continue;
        }
        if (character === quote) {
          quote = null;
        }
        continue;
      }
      if (character === '"' || character === '\'' || character === '`') {
        quote = character;
        continue;
      }
      if (character === '(') {
        depth += 1;
        continue;
      }
      if (character === ')') {
        depth -= 1;
        if (depth === 0) {
          calls.push({
            callee: match[1],
            lineNumber: sourceText.slice(0, match.index).split('\n').length,
            source: sourceText.slice(match.index, index + 1),
          });
          break;
        }
      }
    }
  }
  return calls;
}

function extractFirstCallArgument(callSource) {
  const openParenIndex = callSource.indexOf('(');
  if (openParenIndex === -1) {
    return '';
  }
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openParenIndex + 1; index < callSource.length; index += 1) {
    const character = callSource[index];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === '\'' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(' || character === '[' || character === '{') {
      depth += 1;
      continue;
    }
    if (character === ')' || character === ']' || character === '}') {
      if (depth === 0) {
        return callSource.slice(openParenIndex + 1, index).trim();
      }
      depth -= 1;
      continue;
    }
    if (character === ',' && depth === 0) {
      return callSource.slice(openParenIndex + 1, index).trim();
    }
  }
  return callSource.slice(openParenIndex + 1, -1).trim();
}

function normalizeCallSource(callSource) {
  return callSource.replace(/\s+/gu, ' ').trim();
}

function hasPairedRedactionArtifactWriteCallsite(sourceText) {
  return /prepareRedactedArtifactJsonWithAudit\(/u.test(sourceText)
    && /\bwriteTextFile\s*\([\s\S]*?,\s*(?:[a-zA-Z_$][\w$]*\.)?json\b/u.test(sourceText)
    && /\bwriteTextFile\s*\([\s\S]*?(?:audit|Audit)[\w$.]*\s*,\s*(?:[a-zA-Z_$][\w$]*\.)?auditJson\b/u.test(sourceText);
}

function collectHighRiskRuntimeArtifactWriteGuardFailures(fileRelativePath, sourceText) {
  void fileRelativePath;
  void sourceText;
  return [];
}

function hasRedactionGuardedArtifactEvidence(sourceText) {
  ARTIFACT_WRITE_SINK_PATTERN.lastIndex = 0;
  return /(?:prepareRedactedArtifactJsonWithAudit|prepareCompilerDerivedArtifact|prepareExecutionArtifactJsonWithAudit)\(/u.test(sourceText)
    && /\b(?:redactionAudit|RedactionAudit|auditPath|auditJson)\b/u.test(sourceText)
    && ARTIFACT_WRITE_SINK_PATTERN.test(sourceText);
}

function classifyArtifactWriteSource(fileRelativePath, sourceText) {
  const matches = collectArtifactWriteSinkMatches(sourceText, fileRelativePath);
  if (matches.length === 0) {
    return null;
  }
  const baselineCount = ARTIFACT_WRITE_SINK_BASELINE.get(fileRelativePath);
  if (baselineCount !== undefined && matches.length !== baselineCount) {
    return `${fileRelativePath} artifact write sink count changed: expected ${baselineCount}, got ${matches.length}`;
  }
  if (REDACTION_GUARDED_ARTIFACT_WRITERS.has(fileRelativePath)) {
    const callsiteFailures = collectHighRiskRuntimeArtifactWriteGuardFailures(fileRelativePath, sourceText);
    if (callsiteFailures.length > 0) {
      return `${fileRelativePath} has artifact write guard failures: ${callsiteFailures.join('; ')}`;
    }
    return hasRedactionGuardedArtifactEvidence(sourceText)
      ? null
      : `${fileRelativePath} is classified as redaction-guarded but lacks paired redaction/audit write evidence`;
  }
  if (CONTROLLED_NON_ARTIFACT_OR_GENERATED_WRITERS.has(fileRelativePath)) {
    return null;
  }
  return `${fileRelativePath} has unclassified artifact write sinks: ${matches.join('; ')}`;
}

const NON_GOAL_RAW_BOUNDARY_OBJECTS_PATTERN_SOURCE =
  String.raw`(?:sessionLease|lease|rawSessionLease|sessionMaterial)`;
const NON_GOAL_RAW_BOUNDARY_FIELDS_PATTERN_SOURCE = [
  'accessToken',
  'authorization',
  'Authorization',
  'browserProfileRoot',
  'cookie',
  'Cookie',
  'cookies',
  'csrf',
  'csrfToken',
  'headers',
  'profilePath',
  'refreshToken',
  'SESSDATA',
  'sessionId',
  'token',
  'userDataDir',
].join('|');
const NON_GOAL_RAW_BOUNDARY_DIRECT_FIELD_PATTERN = new RegExp(
  String.raw`\b${NON_GOAL_RAW_BOUNDARY_OBJECTS_PATTERN_SOURCE}\??\.(?:${NON_GOAL_RAW_BOUNDARY_FIELDS_PATTERN_SOURCE})\b`,
  'giu',
);
const NON_GOAL_RAW_BOUNDARY_DESTRUCTURE_PATTERN = new RegExp(
  String.raw`\b(?:const|let|var)\s*\{[^}]*\b(?:${NON_GOAL_RAW_BOUNDARY_FIELDS_PATTERN_SOURCE})\b[^}]*\}\s*=\s*${NON_GOAL_RAW_BOUNDARY_OBJECTS_PATTERN_SOURCE}\b`,
  'giu',
);
const NON_GOAL_SESSION_ARTIFACT_BYPASS_PATTERN = new RegExp(
  String.raw`\b(?:writeJsonFile|writeTextFile|writeFile|appendJsonLine|writeJsonLines|appendTextFile)\s*\([\s\S]{0,240}\bsession\s*:\s*${NON_GOAL_RAW_BOUNDARY_OBJECTS_PATTERN_SOURCE}\b`,
  'giu',
);

function collectNonGoalBoundaryMatches(fileRelativePath, sourceText) {
  const checks = [
    {
      kind: 'raw-boundary-field-read',
      pattern: NON_GOAL_RAW_BOUNDARY_DIRECT_FIELD_PATTERN,
    },
    {
      kind: 'raw-boundary-destructure',
      pattern: NON_GOAL_RAW_BOUNDARY_DESTRUCTURE_PATTERN,
    },
  ];
  const matches = /** @type {any[]} */ ([]);
  for (const { kind, pattern } of checks) {
    pattern.lastIndex = 0;
    for (const match of sourceText.matchAll(pattern)) {
      const lineNumber = sourceText.slice(0, match.index).split('\n').length;
      matches.push(`${fileRelativePath}:${lineNumber}: ${kind}: ${match[0]}`);
    }
  }

  NON_GOAL_SESSION_ARTIFACT_BYPASS_PATTERN.lastIndex = 0;
  for (const match of sourceText.matchAll(NON_GOAL_SESSION_ARTIFACT_BYPASS_PATTERN)) {
    if (/prepareRedactedArtifactJson(?:WithAudit)?\(/u.test(sourceText)) {
      continue;
    }
    const lineNumber = sourceText.slice(0, match.index).split('\n').length;
    matches.push(`${fileRelativePath}:${lineNumber}: session-artifact-securityguard-bypass: ${match[0]}`);
  }
  return matches;
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

test('import specifier collector catches named re-export dependencies', () => {
  assert.deepEqual(
    collectImportSpecifiers(`
      export { retiredHelper as helper } from '../lib/retired-helper.mjs';
      export { safeHelper } from './safe-helper.mjs';
    `),
    [
      '../lib/retired-helper.mjs',
      './safe-helper.mjs',
    ],
  );
});

test('artifact write source classifier catches unguarded synthetic writers', () => {
  assert.equal(
    classifyArtifactWriteSource(
      'src/sites/example/bad-writer.mjs',
      `
        import { writeJsonFile } from '../../infra/io.mjs';
        export async function writeDebugArtifact(path, payload) {
          await writeJsonFile(path, payload);
        }
      `,
    ),
    'src/sites/example/bad-writer.mjs has unclassified artifact write sinks: src/sites/example/bad-writer.mjs:2: writeJsonFile; src/sites/example/bad-writer.mjs:4: writeJsonFile',
  );
  assert.equal(
    classifyArtifactWriteSource(
      'src/sites/example/dynamic-fs.mjs',
      `
        export async function writeDebugArtifact(path, payload) {
          const fs = await import('node:fs/promises');
          await fs.writeFile(path, JSON.stringify(payload));
        }
      `,
    ),
    'src/sites/example/dynamic-fs.mjs has unclassified artifact write sinks: src/sites/example/dynamic-fs.mjs:4: writeFile; src/sites/example/dynamic-fs.mjs:3: import(\'node:fs/promises\')',
  );
  assert.equal(
    classifyArtifactWriteSource(
      'src/sites/example/bad-artifact-store-writer.mjs',
      `
        import { writeArtifactJson } from '../../app/pipeline/build/artifact-store.mjs';
        export async function writeRawArtifact(context, payload) {
          await writeArtifactJson(context, 'unsafe.json', payload);
        }
      `,
    ),
    'src/sites/example/bad-artifact-store-writer.mjs has unclassified artifact write sinks: src/sites/example/bad-artifact-store-writer.mjs:2: writeArtifactJson; src/sites/example/bad-artifact-store-writer.mjs:4: writeArtifactJson',
  );
  assert.equal(
    classifyArtifactWriteSource(
      'src/sites/example/bad-artifact-yaml-writer.mjs',
      `
        import { writeArtifactYaml } from '../../app/pipeline/build/artifact-store.mjs';
        export async function writeRawArtifact(context, payload) {
          await writeArtifactYaml(context, 'unsafe.yaml', payload);
        }
      `,
    ),
    'src/sites/example/bad-artifact-yaml-writer.mjs has unclassified artifact write sinks: src/sites/example/bad-artifact-yaml-writer.mjs:2: writeArtifactYaml; src/sites/example/bad-artifact-yaml-writer.mjs:4: writeArtifactYaml',
  );
  assert.equal(
    classifyArtifactWriteSource(
      'src/domain/capabilities/api-discovery.mjs',
      `
        import { writeTextFile } from '../../infra/io.mjs';
        import { prepareRedactedArtifactJsonWithAudit } from './security-guard.mjs';
        export async function writeCandidateArtifact(path, auditPath, value) {
          const prepared = prepareRedactedArtifactJsonWithAudit(value);
          await writeTextFile(path, prepared.json);
          await writeTextFile(auditPath, prepared.auditJson);
        }
      `,
    ),
    null,
  );
  assert.deepEqual(
    collectHighRiskRuntimeArtifactWriteGuardFailures(
      'src/sites/example/retired-runtime.mjs',
      `
        export async function writeRuntimeArtifacts(fs, layout, manifest, queue) {
          await writeJsonFile(layout.manifestPath, manifest);
          await fs.writeFile(layout.queuePath, JSON.stringify(queue));
        }
      `,
    ),
    [],
  );
});

test('non-goal boundary classifier catches raw session reads and SecurityGuard bypasses', () => {
  assert.deepEqual(
    collectNonGoalBoundaryMatches(
      'src/sites/downloads/example-bad-runtime.mjs',
      `
        export async function run(sessionLease, path) {
          const headers = sessionLease.headers;
          const { cookies } = sessionLease;
          await writeJsonFile(path, { session: sessionLease });
        }
      `,
    ),
    [
      'src/sites/downloads/example-bad-runtime.mjs:3: raw-boundary-field-read: sessionLease.headers',
      'src/sites/downloads/example-bad-runtime.mjs:4: raw-boundary-destructure: const { cookies } = sessionLease',
      'src/sites/downloads/example-bad-runtime.mjs:5: session-artifact-securityguard-bypass: writeJsonFile(path, { session: sessionLease',
    ],
  );
  assert.deepEqual(
    collectNonGoalBoundaryMatches(
      'src/sites/downloads/example-good-runtime.mjs',
      `
        import { normalizeSessionLeaseConsumerHeaders } from './contracts.mjs';
        import { prepareRedactedArtifactJsonWithAudit } from '../capability/security-guard.mjs';
        export async function run(sessionLease, path) {
          const headers = normalizeSessionLeaseConsumerHeaders(sessionLease);
          const { json } = prepareRedactedArtifactJsonWithAudit({ session: sessionLease });
          await writeTextFile(path, json);
          return headers;
        }
      `,
    ),
    [],
  );
});

test('runtime artifact writes are explicitly classified and redaction guarded', async () => {
  const failures = /** @type {any[]} */ ([]);
  for (const filePath of await listSourceFiles('src')) {
    const sourceText = await readFile(filePath, 'utf8');
    const fileRelativePath = toRepoRelativePath(filePath);
    const failure = classifyArtifactWriteSource(fileRelativePath, sourceText);
    if (failure) {
      failures.push(failure);
    }
  }
  assert.deepEqual(failures, []);
});

test('retired public download facade remains physically removed', async () => {
  assert.equal(await pathExists('src/sites/downloads'), false);
  assert.equal(await pathExists('src/entrypoints/sites/download.mjs'), false);
});

test('stable config does not point at retired web or public download facade layers', async () => {
  const configFiles = [
    'config/site-registry.json',
    'config/site-capabilities.json',
  ];
  const retiredRuntimePattern = /src\/(?:sites\/downloads|entrypoints\/sites\/download\.mjs|sites\/capability\/build\/web-interaction-)/u;
  const hits = /** @type {any[]} */ ([]);
  for (const fileRelativePath of configFiles) {
    const sourceText = await readFile(path.join(REPO_ROOT, fileRelativePath), 'utf8');
    if (retiredRuntimePattern.test(sourceText.replace(/\\/gu, '/'))) {
      hits.push(fileRelativePath);
    }
  }
  assert.deepEqual(hits, []);
});

test('infra auth services do not depend on CLI entrypoints', async () => {
  const imports = await collectResolvedImports('src/infra/auth');
  assertNoResolvedPrefix(
    imports,
    'src/entrypoints/',
    'infra auth services should expose injectable runtime contracts instead of importing CLI entrypoints',
  );
});

test('public SiteForge build CLI contract stays owned by CLI entrypoint layer', async () => {
  const ownerPath = 'src/entrypoints/cli/public-build-contract.mjs';
  const compatibilityShimPath = 'src/infra/cli/public-build-contract.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const shimSource = await readFile(path.join(REPO_ROOT, compatibilityShimPath), 'utf8');

  assert.match(ownerSource, /\bexport const PUBLIC_BUILD_COMMAND\b/u);
  assert.match(ownerSource, /\bexport const PUBLIC_BOOLEAN_BUILD_FLAGS\b/u);
  assert.match(ownerSource, /\bexport const ACCEPTED_BOOLEAN_BUILD_FLAGS\b/u);
  assert.equal(
    shimSource.trim(),
    [
      '// @ts-check',
      '',
      '// Compatibility re-export. The public build CLI contract is owned by the',
      '// entrypoint layer; keep this shim for older internal imports.',
      "export * from '../../entrypoints/cli/public-build-contract.mjs';",
    ].join('\n'),
  );

  const imports = [
    ...await collectResolvedImports('src'),
    ...await collectResolvedImports('tools'),
  ];
  const hits = imports.filter((entry) => entry.resolvedRelativePath === compatibilityShimPath);
  assert.deepEqual(
    hits.map((entry) => `${entry.fileRelativePath} -> ${entry.specifier}`),
    [],
    'production code should import the entrypoint-owned public build contract instead of the infra compatibility shim',
  );
});

test('SiteForge build status labels stay owned by the app build layer', async () => {
  const ownerPath = 'src/app/pipeline/build/status-labels.mjs';
  const compatibilityShimPath = 'src/infra/cli/status-labels.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const shimSource = await readFile(path.join(REPO_ROOT, compatibilityShimPath), 'utf8');

  assert.match(ownerSource, /\bexport function resultStatusLabel\b/u);
  assert.match(ownerSource, /\bexport function buildStatusLabel\b/u);
  assert.match(ownerSource, /\bexport function collectionStatusLabel\b/u);
  assert.equal(
    shimSource.trim(),
    [
      '// @ts-check',
      '',
      '// Compatibility re-export. SiteForge build status labels are owned by the',
      '// app build layer; keep this shim for older internal imports.',
      "export * from '../../app/pipeline/build/status-labels.mjs';",
    ].join('\n'),
  );

  const imports = [
    ...await collectResolvedImports('src'),
    ...await collectResolvedImports('tools'),
  ];
  const hits = imports.filter((entry) => entry.resolvedRelativePath === compatibilityShimPath);
  assert.deepEqual(
    hits.map((entry) => `${entry.fileRelativePath} -> ${entry.specifier}`),
    [],
    'production code should import the app build status labels instead of the infra compatibility shim',
  );
});

test('SiteForge build progress copy stays owned by the app build layer', async () => {
  const ownerPath = 'src/app/pipeline/build/progress-copy.mjs';
  const genericCopyPath = 'src/infra/cli/progress-copy.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const genericCopySource = await readFile(path.join(REPO_ROOT, genericCopyPath), 'utf8');

  assert.match(ownerSource, /\bexport const SITEFORGE_BUILD_STAGE_COPY\b/u);
  assert.match(ownerSource, /\bexport function siteForgeBuildStageTitle\b/u);
  assert.doesNotMatch(genericCopySource, /\bSITEFORGE_BUILD_STAGE_COPY\b/u);
  assert.doesNotMatch(genericCopySource, /\bsiteForgeBuildStageTitle\b/u);

  const infraCliImports = await collectResolvedImports('src/infra/cli');
  const hits = infraCliImports.filter((entry) => entry.resolvedRelativePath === ownerPath);
  assert.deepEqual(
    hits.map((entry) => `${entry.fileRelativePath} -> ${entry.specifier}`),
    [],
    'infra CLI progress helpers should not import SiteForge build progress copy',
  );
});

test('site-doctor progress copy stays owned by the site doctor entrypoint', async () => {
  const ownerPath = 'src/entrypoints/sites/site-doctor-progress-copy.mjs';
  const siteDoctorPath = 'src/entrypoints/sites/site-doctor.mjs';
  const genericCopyPath = 'src/infra/cli/progress-copy.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const siteDoctorSource = await readFile(path.join(REPO_ROOT, siteDoctorPath), 'utf8');
  const genericCopySource = await readFile(path.join(REPO_ROOT, genericCopyPath), 'utf8');

  assert.match(ownerSource, /\bexport const DOCTOR_STAGE_COPY\b/u);
  assert.match(ownerSource, /\bexport function doctorStageTitle\b/u);
  assert.match(siteDoctorSource, /from\s+['"]\.\/site-doctor-progress-copy\.mjs['"]/u);
  assert.doesNotMatch(genericCopySource, /\b(?:DOCTOR_STAGE_COPY|doctorStageTitle)\b/u);
});

test('shared modules stay below application, infra, domain, and site layers', async () => {
  const imports = await collectResolvedImports('src/shared');
  for (const forbiddenPrefix of [
    'src/app/',
    'src/domain/',
    'src/entrypoints/',
    'src/infra/',
    'src/sites/',
  ]) {
    assertNoResolvedPrefix(
      imports,
      forbiddenPrefix,
      'shared modules should depend only on node builtins or other shared helpers',
    );
  }
});

test('site modules do not depend on scripts or root shims', async () => {
  const imports = await collectResolvedImports('src/sites');
  assertNoResolvedPrefix(imports, 'scripts/', 'site module should not import scripts');

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

test('known-site modules consume registry metadata through core facades', async () => {
  const imports = await collectResolvedImports('src/sites/known-sites');
  assertNoResolvedPrefix(
    imports,
    'src/sites/registry/catalog/',
    'known-site modules should use registry core facades instead of catalog internals',
  );
});

test('SiteForge setup assistant reads known-site metadata through registry readers', async () => {
  const setupAssistantPath = 'src/app/pipeline/build/setup-assistant.mjs';
  const sourceText = await readFile(path.join(REPO_ROOT, setupAssistantPath), 'utf8');

  assert.match(sourceText, /\breadSiteRegistry\b/u);
  assert.match(sourceText, /\breadSiteCapabilities\b/u);
  assert.doesNotMatch(
    sourceText,
    /readJsonOrNull\s*\(\s*path\.join\([^)]*['"]config['"][^)]*['"]site-(?:registry|capabilities)\.json['"]/u,
    'setup assistant should use registry readers instead of hand-reading config site metadata JSON',
  );
});

test('SiteForge known-site policy helpers stay in their app build module', async () => {
  const ownerPath = 'src/app/pipeline/build/known-site-policy.mjs';
  const setupAssistantPath = 'src/app/pipeline/build/setup-assistant.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const setupAssistantSource = await readFile(path.join(REPO_ROOT, setupAssistantPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');

  assert.match(ownerSource, /\bexport function knownPolicySummary\b/u);
  assert.match(ownerSource, /\bexport function knownPolicyCapabilityPressure\b/u);
  assert.match(ownerSource, /\bexport function knownPolicyAllowsUserAuthorizedSetup\b/u);
  assert.match(ownerSource, /\bexport function knownPolicyPublicSeedRoutes\b/u);
  assert.match(ownerSource, /\bexport function knownPolicyPublicRouteTemplatePattern\b/u);
  assert.match(ownerSource, /\bexport function knownPolicyPublicRouteTemplatePatterns\b/u);
  assert.match(setupAssistantSource, /from\s+['"]\.\/known-site-policy\.mjs['"]/u);
  assert.match(pipelineSource, /from\s+['"]\.\/known-site-policy\.mjs['"]/u);
  assert.doesNotMatch(
    setupAssistantSource,
    /function\s+(?:knownPolicySummary|knownPolicyCapabilityPressure|knownPolicyAllowsUserAuthorizedSetup)\b/u,
    'setup assistant should delegate known-site policy summaries to known-site-policy.mjs',
  );
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:knownPolicyPublicSeedRoutes|knownPolicyPublicRouteTemplatePattern|knownPolicyPublicRouteTemplatePatterns?)\b/u,
    'pipeline should delegate known-site public route projection to known-site-policy.mjs',
  );
});

test('SiteForge runtime provider metadata helpers stay outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/runtime-provider.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');

  assert.match(ownerSource, /\bexport function bridgeRuntimeMetadata\b/u);
  assert.match(ownerSource, /\bexport function genericHttpRuntimeMetadata\b/u);
  assert.match(ownerSource, /\bexport function registryIntentRuntimeMetadata\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/runtime-provider\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:bridgeRuntimeMetadata|genericHttpRuntimeMetadata|registryIntentRuntimeMetadata)\b/u,
    'pipeline should delegate runtime provider metadata shaping to runtime-provider.mjs',
  );
});

test('SiteForge setup capability id normalization stays in a build helper', async () => {
  const ownerPath = 'src/app/pipeline/build/capability-id.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const consumerPaths = [
    'src/app/pipeline/build/pipeline.mjs',
    'src/app/pipeline/build/known-site-policy.mjs',
    'src/app/pipeline/build/setup-assistant.mjs',
    'src/app/pipeline/build/setup-collection-review.mjs',
  ];

  assert.match(ownerSource, /\bexport function normalizeCapabilityId\b/u);
  assert.match(ownerSource, /\bexport function normalizeSetupCapabilityId\b/u);
  assert.match(ownerSource, /\bexport function canonicalCapabilitySemanticToken\b/u);
  for (const consumerPath of consumerPaths) {
    const consumerSource = await readFile(path.join(REPO_ROOT, consumerPath), 'utf8');
    assert.match(consumerSource, /from\s+['"]\.\/capability-id\.mjs['"]/u);
    assert.doesNotMatch(
      consumerSource,
      /function\s+(?:normalizeCapabilityId|normalizeSetupCapabilityId|canonicalCapabilitySemanticToken)\b|const\s+CAPABILITY_SEMANTIC_ALIASES\b/u,
      `${consumerPath} should delegate setup capability id normalization to capability-id.mjs`,
    );
  }
});

test('SiteForge setup-blocked API discovery fallback stays in a pure app build module', async () => {
  const ownerPath = 'src/app/pipeline/build/api-discovery-setup-fallback.mjs';
  const setupAssistantPath = 'src/app/pipeline/build/setup-assistant.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const setupAssistantSource = await readFile(path.join(REPO_ROOT, setupAssistantPath), 'utf8');
  const ownerImports = await collectResolvedImportsFromFile(ownerPath);

  assert.match(ownerSource, /\bexport function canContinueSetupBlockedForApiDiscovery\b/u);
  assert.match(ownerSource, /\bexport function setupBlockedApiDiscoveryOptions\b/u);
  assert.match(ownerSource, /\bexport function setupBlockedApiDiscoveryPlan\b/u);
  assert.deepEqual(
    ownerImports.map((entry) => `${entry.fileRelativePath} -> ${entry.specifier}`),
    [`${ownerPath} -> ../../../shared/normalize.mjs`],
    'setup-blocked API discovery fallback should stay pure and depend only on shared normalization',
  );
  assert.match(setupAssistantSource, /from\s+['"]\.\/api-discovery-setup-fallback\.mjs['"]/u);
  assert.doesNotMatch(
    setupAssistantSource,
    /function\s+(?:canContinueSetupBlockedForApiDiscovery|setupBlockedApiDiscoveryOptions|setupBlockedApiDiscoveryPlan)\b/u,
    'setup assistant should delegate setup-blocked API discovery fallback policy to api-discovery-setup-fallback.mjs',
  );
});

test('SiteForge API read-only policy stays in its build policy module', async () => {
  const ownerPath = 'src/app/pipeline/build/api-readonly-policy.mjs';
  const consumerPaths = [
    'src/app/pipeline/build/api-request-runtime.mjs',
    'src/app/pipeline/build/browser-auth-bridge.mjs',
    'src/app/pipeline/build/pipeline.mjs',
  ];
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');

  assert.match(ownerSource, /\bexport const READ_ONLY_API_METHODS\b/u);
  assert.match(ownerSource, /\bexport function normalizeApiMethod\b/u);
  assert.match(ownerSource, /\bexport function isReadOnlyApiMethod\b/u);
  assert.match(ownerSource, /\bexport function hasSubstantiveApiRequestBody\b/u);
  assert.match(ownerSource, /\bexport function apiEndpointLooksWriteLike\b/u);
  for (const consumerPath of consumerPaths) {
    const consumerSource = await readFile(path.join(REPO_ROOT, consumerPath), 'utf8');
    assert.match(consumerSource, /from\s+['"]\.\/api-readonly-policy\.mjs['"]/u);
    assert.doesNotMatch(
      consumerSource,
      /const\s+API_(?:ADAPTER_SAFE_METHODS|RUNTIME_SAFE_METHODS|REPLAY_SAFE_METHODS|REPLAY_SENSITIVE_QUERY_PATTERN|REPLAY_WRITE_PATH_PATTERN|RUNTIME_WRITE_PATH_PATTERN)\b|function\s+(?:hasSensitiveQueryMaterial|hasSubstantiveApiRequestBody)\b/u,
      `${consumerPath} should delegate shared API read-only policy to api-readonly-policy.mjs`,
    );
  }
});

test('SiteForge browser bridge version policy stays outside bridge IO', async () => {
  const ownerPath = 'src/app/pipeline/build/browser-bridge-version-policy.mjs';
  const bridgePath = 'src/app/pipeline/build/browser-auth-bridge.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const bridgeSource = await readFile(path.join(REPO_ROOT, bridgePath), 'utf8');
  const ownerImports = await collectResolvedImportsFromFile(ownerPath);

  assert.match(ownerSource, /\bexport const EXPECTED_BROWSER_BRIDGE_EXTENSION_VERSION\b/u);
  assert.match(ownerSource, /\bexport const COMPATIBLE_BROWSER_BRIDGE_EXTENSION_VERSIONS\b/u);
  assert.match(ownerSource, /\bexport function bridgeVersionCompatible\b/u);
  assert.match(ownerSource, /\bexport function bridgeExtensionVersionBlockingSignals\b/u);
  assert.deepEqual(ownerImports, [], 'browser bridge version policy should stay pure and dependency-free');
  assert.match(bridgeSource, /from\s+['"]\.\/browser-bridge-version-policy\.mjs['"]/u);
  assert.doesNotMatch(
    bridgeSource,
    /const\s+(?:EXPECTED_BROWSER_BRIDGE_EXTENSION_VERSION|COMPATIBLE_BROWSER_BRIDGE_EXTENSION_VERSIONS)\b|function\s+(?:bridgeExtensionVersionSignals|collectorVersionMatchesExpectedVersion|bridgeVersionCompatible|bridgeExtensionVersionBlockingSignals)\b/u,
    'browser-auth-bridge should delegate version compatibility policy to browser-bridge-version-policy.mjs',
  );
});

test('SiteForge browser bridge route coverage policy stays outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/browser-bridge-route-coverage.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');
  const ownerImports = await collectResolvedImportsFromFile(ownerPath);

  assert.match(ownerSource, /\bexport function browserBridgeRouteCaptured\b/u);
  assert.match(ownerSource, /\bexport function configuredAuthRouteTemplateSet\b/u);
  assert.match(ownerSource, /\bexport function browserBridgePageWasCaptured\b/u);
  assert.match(ownerSource, /\bexport function routeCapturePlanFromAuthState\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/browser-bridge-route-coverage\.mjs['"]/u);
  assert.equal(
    ownerImports.some((entry) => entry.resolvedRelativePath === pipelinePath),
    false,
    'browser bridge route coverage policy must not import pipeline orchestration',
  );
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:browserBridgeRouteCaptured|browserBridgeRouteRetryable|routeTemplateComparisonValues|configuredAuthRouteTemplateSet|matchesConfiguredAuthRoute|browserBridgeMissingRouteTemplateSet|browserBridgeCapturedRouteTemplateSet|matchesBrowserBridgeMissingRoute|matchesBrowserBridgeMissingNonRootRoute|browserBridgePageWasCaptured|routeCapturePlanFromAuthState)\b/u,
    'pipeline should delegate browser bridge route coverage policy to browser-bridge-route-coverage.mjs',
  );
});

test('SiteForge setup collection review model stays outside setup assistant orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/setup-collection-review.mjs';
  const setupAssistantPath = 'src/app/pipeline/build/setup-assistant.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const setupAssistantSource = await readFile(path.join(REPO_ROOT, setupAssistantPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');
  const ownerImports = await collectResolvedImportsFromFile(ownerPath);

  assert.match(ownerSource, /\bexport function buildCollectionReviewModel\b/u);
  assert.match(ownerSource, /\bexport function collectionReviewLabel\b/u);
  assert.match(ownerSource, /\bexport function normalizeUserAuthorizedCapabilityProofs\b/u);
  assert.match(ownerSource, /\bexport function reconcileSetupCollectionReviewWithBuildOutputs\b/u);
  assert.match(ownerSource, /\bexport function setupCollectionReviewReport\b/u);
  assert.match(ownerSource, /\bexport function renderSetupCollectionReviewLines\b/u);
  assert.match(setupAssistantSource, /from\s+['"]\.\/setup-collection-review\.mjs['"]/u);
  assert.match(pipelineSource, /from\s+['"]\.\/setup-collection-review\.mjs['"]/u);
  assert.doesNotMatch(setupAssistantSource, /\bCOLLECTION_REVIEW_KINDS\b/u);
  assert.doesNotMatch(
    setupAssistantSource,
    /function\s+(?:collectionReviewBucket|collectionReviewProofCovers|collectionReviewPolicyCapabilities|buildCollectionReviewModel|normalizeUserAuthorizedCapabilityProofs)\b/u,
    'setup assistant should delegate collection review modeling to setup-collection-review.mjs',
  );
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:collectionReviewCount|collectionReviewBucketSummary|collectionReviewMissingRecords|finalReviewTokens|finalReviewDistinctiveTokens|finalReviewAliases|finalReviewSignalRecords|finalReviewSignalCovers|reconcileSetupCollectionReviewWithBuildOutputs|setupCollectionReviewReport|renderSetupCollectionReviewLines)\b|const\s+FINAL_REVIEW_GENERIC_TOKENS\b/u,
    'pipeline should delegate setup collection review reporting to setup-collection-review.mjs',
  );
  assert.deepEqual(
    ownerImports
      .filter((entry) => entry.resolvedRelativePath === setupAssistantPath)
      .map((entry) => `${entry.fileRelativePath} -> ${entry.specifier}`),
    [],
    'setup collection review must not import setup assistant orchestration',
  );
});

test('build entrypoints do not import raw credential tools or concrete site risk helpers', async () => {
  const imports = await collectResolvedImports('src/entrypoints/build');
  assertNoResolvedPaths(imports, [
    'src/shared/xiaohongshu-risk.mjs',
    'src/entrypoints/sites/social-auth-import.mjs',
    'src/entrypoints/sites/douyin-export-cookies.mjs',
    'src/infra/auth/windows-credential-manager.mjs',
    'src/infra/browser/profile-store.mjs',
  ], 'build entrypoints should not import raw credential/profile tooling or concrete site risk helpers directly');
});

test('build entrypoint delegates to SiteForge build setup and runner', async () => {
  const buildEntrypointSource = await readFile(path.join(REPO_ROOT, 'src', 'entrypoints', 'build', 'run-build.mjs'), 'utf8');
  assert.match(buildEntrypointSource, /prepareSiteForgeBuildSetup/u);
  assert.match(buildEntrypointSource, /runSiteForgeBuild/u);
  assert.match(buildEntrypointSource, /parseCliArgs/u);
});

test('pipeline application layer only exposes the SiteForge build implementation', async () => {
  const entries = await readdir(path.join(REPO_ROOT, 'src', 'app', 'pipeline'), { withFileTypes: true });
  assert.deepEqual(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(),
    ['build'],
  );
});

test('SiteForge build stage plan stays a private pipeline orchestration contract', async () => {
  const stagePlanPath = 'src/app/pipeline/build/stage-plan.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const buildIndexPath = 'src/app/pipeline/build/index.mjs';

  const stagePlanImports = await collectResolvedImportsFromFile(stagePlanPath);
  assert.deepEqual(
    stagePlanImports.map((entry) => `${entry.fileRelativePath} -> ${entry.specifier}`),
    [],
    'stage plan should stay a pure structure module without runtime, site, infra, or domain imports',
  );

  const stagePlanReferences = await collectSourcePatternMatches(
    'src',
    /from\s+['"][^'"]*stage-plan\.mjs['"]/gu,
  );
  const unexpectedReferences = stagePlanReferences.filter((match) => !match.startsWith(`${pipelinePath}:`));
  assert.deepEqual(
    unexpectedReferences,
    [],
    'production code should consume the stage plan through the build pipeline owner only',
  );

  const buildIndexSource = await readFile(path.join(REPO_ROOT, buildIndexPath), 'utf8');
  assert.doesNotMatch(
    buildIndexSource,
    /from\s+['"]\.\/stage-plan\.mjs['"]/u,
    'build barrel should not expose the stage plan module directly',
  );
});

test('SiteForge build stage report model stays outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/build-stage-report.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');

  assert.match(ownerSource, /\bexport function safeBuildWarningForReport\b/u);
  assert.match(ownerSource, /\bexport function buildReportWarningSummary\b/u);
  assert.match(ownerSource, /\bexport function buildStageRecord\b/u);
  assert.match(ownerSource, /\bexport function classifyBuildFailure\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/build-stage-report\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:safeBuildWarningForReport|safeBuildMessagesForReport|buildReportWarningSummary|buildStageRecord|classifyBuildFailure)\b|const\s+SAFE_BUILD_WARNING_PATTERNS\b/u,
    'pipeline should delegate build stage report modeling to build-stage-report.mjs',
  );
});

test('SiteForge debug and index report models stay outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/build-debug-report.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');

  assert.match(ownerSource, /\bexport function summarizeStageRecords\b/u);
  assert.match(ownerSource, /\bexport function sanitizedNetworkSummary\b/u);
  assert.match(ownerSource, /\bexport function buildRouteStateGraph\b/u);
  assert.match(ownerSource, /\bexport function buildDebugReport\b/u);
  assert.match(ownerSource, /\bexport function buildReportIndex\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/build-debug-report\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:summarizeStageRecords|sanitizedNetworkSummary|buildRouteStateGraph|buildDebugReport|buildReportIndex)\b|const\s+(?:RAW_PAGE_MATERIAL_MANIFEST|AUTHORIZED_SOURCE_MANIFEST|CAPABILITY_INTENT_SUMMARY_HTML_RELATIVE_PATH)\b/u,
    'pipeline should delegate debug and index report modeling to build-debug-report.mjs',
  );
});

test('SiteForge capability intent HTML value helpers stay outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/capability-intent-html-values.mjs';
  const renderPath = 'src/app/pipeline/build/capability-intent-html-render.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const renderSource = await readFile(path.join(REPO_ROOT, renderPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');

  assert.match(ownerSource, /\bexport function sanitizeCapabilityIntentHtmlPayload\b/u);
  assert.match(ownerSource, /\bexport function escapeHtml\b/u);
  assert.match(ownerSource, /\bexport function htmlCell\b/u);
  assert.match(ownerSource, /\bexport function htmlStatusBadge\b/u);
  assert.match(renderSource, /from\s+['"]\.\/capability-intent-html-values\.mjs['"]/u);
  assert.doesNotMatch(pipelineSource, /from\s+['"]\.\/capability-intent-html-values\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:sanitizeHtmlReportUrl|sanitizeHtmlReportString|sanitizeHtmlReportValue|sanitizeCapabilityIntentHtmlPayload|escapeHtml|htmlCell|htmlList|htmlBadge|htmlStatusBadge|htmlRiskBadge|htmlAuthBadge)\b|const\s+HTML_REPORT_(?:MAX_EXAMPLES|FORBIDDEN_PATTERNS)\b/u,
    'pipeline should delegate capability intent HTML value helpers to capability-intent-html-values.mjs',
  );
});

test('SiteForge capability intent HTML payload model stays outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/capability-intent-html-payload.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');

  assert.match(ownerSource, /\bexport function buildCapabilityIntentHtmlPayload\b/u);
  assert.match(ownerSource, /\bexport function buildElementCoverageAuditRows\b/u);
  assert.match(ownerSource, /\bexport function htmlCategoryInstanceLabel\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/capability-intent-html-payload\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:capabilityHtmlGroup|capabilityHtmlReason|capabilityHtmlStrategy|intentCallableLabel|summarizeHtmlCoverage|capabilitySourceNodesForHtml|routeTemplatesForHtml|categoryInstancesForHtml|htmlCategoryInstanceLabel|buildElementCoverageAuditRows|elementCoverageAuditSummary|buildCapabilityIntentHtmlPayload)\b/u,
    'pipeline should delegate capability intent HTML payload modeling to capability-intent-html-payload.mjs',
  );
});

test('SiteForge capability intent HTML rendering stays outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/capability-intent-html-render.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');

  assert.match(ownerSource, /\bexport function renderCapabilityIntentSummaryHtml\b/u);
  assert.match(ownerSource, /\bexport function assertCapabilityIntentHtmlSafe\b/u);
  assert.match(ownerSource, /from\s+['"]\.\/capability-intent-html-values\.mjs['"]/u);
  assert.match(ownerSource, /from\s+['"]\.\/capability-intent-html-payload\.mjs['"]/u);
  assert.match(pipelineSource, /from\s+['"]\.\/capability-intent-html-render\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:renderCapabilityRows|renderIntentRows|renderMappingRows|renderBrowserBridgeRouteCoverage|renderCoverageTable|renderProviderCoverageTable|renderElementCoverageAudit|renderBlockedList|renderCapabilityIntentSummaryHtml|assertCapabilityIntentHtmlSafe)\b/u,
    'pipeline should delegate capability intent HTML rendering to capability-intent-html-render.mjs',
  );
});

test('SiteForge page reconciliation report model stays outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/page-reconciliation-report.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');

  assert.match(ownerSource, /\bexport function buildPageReconciliationReport\b/u);
  assert.match(ownerSource, /\bexport function classifyPageReconciliationOutcome\b/u);
  assert.match(ownerSource, /\bexport function reconciliationRouteKey\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/page-reconciliation-report\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:reconciliationRouteKey|reconciliationLinkUrl|reconciliationLinkLabel|isReconciliationCategoryLink|isChallengeLikePage|classifyPageReconciliationOutcome|reconciliationGraphUrlSet|hasChineseText|buildPageReconciliationReport)\b|const\s+PAGE_RECONCILIATION_CATEGORY_TEXT_PATTERN\b/u,
    'pipeline should delegate page reconciliation report modeling to page-reconciliation-report.mjs',
  );
});

test('SiteForge access remediation plan model stays outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/access-remediation-plan.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');

  assert.match(ownerSource, /\bexport function shouldWriteAccessRemediationPlan\b/u);
  assert.match(ownerSource, /\bexport function buildAccessRemediationPlan\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/access-remediation-plan\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:shouldWriteAccessRemediationPlan|buildAccessRemediationPlan)\b/u,
    'pipeline should delegate access remediation plan modeling to access-remediation-plan.mjs',
  );
});

test('SiteForge structure sanitizer stays outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/structure-sanitizer.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const reconciliationPath = 'src/app/pipeline/build/page-reconciliation-report.mjs';
  const remediationPath = 'src/app/pipeline/build/access-remediation-plan.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');
  const reconciliationSource = await readFile(path.join(REPO_ROOT, reconciliationPath), 'utf8');
  const remediationSource = await readFile(path.join(REPO_ROOT, remediationPath), 'utf8');

  assert.match(ownerSource, /\bexport function sanitizedStructureText\b/u);
  assert.match(ownerSource, /\bexport function safeStructureHash\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/structure-sanitizer\.mjs['"]/u);
  assert.match(reconciliationSource, /from\s+['"]\.\/structure-sanitizer\.mjs['"]/u);
  assert.match(remediationSource, /from\s+['"]\.\/structure-sanitizer\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:sanitizedStructureText|safeStructureHash)\b/u,
    'pipeline should delegate shared structure sanitizing to structure-sanitizer.mjs',
  );
  assert.doesNotMatch(
    `${reconciliationSource}\n${remediationSource}`,
    /function\s+sanitizedStructureText\b/u,
    'report model modules should reuse the shared structure sanitizer',
  );
});

test('SiteForge authorized sources report model stays outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/authorized-sources-report.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');

  assert.match(ownerSource, /\bexport function authorizedSourcesSummaryForReport\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/authorized-sources-report\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+authorizedSourcesSummaryForReport\b/u,
    'pipeline should delegate authorized source report modeling to authorized-sources-report.mjs',
  );
});

test('SiteForge setup profile report model stays outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/setup-profile-report.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');
  const ownerImports = await collectResolvedImportsFromFile(ownerPath);

  assert.match(ownerSource, /\bexport function setupProfileSummary\b/u);
  assert.match(ownerSource, /\bexport function setupProfileBlockCode\b/u);
  assert.match(ownerSource, /\bexport function setupProfileBuildBlock\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/setup-profile-report\.mjs['"]/u);
  assert.deepEqual(
    ownerImports.map((entry) => `${entry.fileRelativePath} -> ${entry.specifier}`),
    [
      `${ownerPath} -> ../../../shared/clone.mjs`,
      `${ownerPath} -> ../../../shared/normalize.mjs`,
      `${ownerPath} -> ./user-report-values.mjs`,
    ],
    'setup profile report model should stay pure and depend only on shared helpers plus public report value sanitizing',
  );
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:setupProfileSummary|setupProfileBlockCode|setupProfileBuildBlock)\b/u,
    'pipeline should delegate setup profile report modeling to setup-profile-report.mjs',
  );
});

test('SiteForge collection outcome aggregation stays in the collection outcome module', async () => {
  const ownerPath = 'src/app/pipeline/build/collection-outcomes.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const userReportPath = 'src/app/pipeline/build/user-report.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');
  const userReportSource = await readFile(path.join(REPO_ROOT, userReportPath), 'utf8');

  assert.match(ownerSource, /\bexport function collectUnsuccessfulCollections\b/u);
  assert.match(ownerSource, /\bexport function isDebugOnlyCapability\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/collection-outcomes\.mjs['"]/u);
  assert.match(userReportSource, /from\s+['"]\.\/collection-outcomes\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:collectUnsuccessfulCollections|isDebugOnlyCapability)\b/u,
    'pipeline should delegate collection outcome aggregation to collection-outcomes.mjs',
  );
  assert.doesNotMatch(
    userReportSource,
    /\b(?:DEBUG_ONLY_STATUS_VALUES|function\s+isDebugOnlyCapability)\b/u,
    'user report should share debug-only capability semantics with collection-outcomes.mjs',
  );
});

test('SiteForge build report display stays outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/build-report-display.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');

  assert.match(ownerSource, /\bexport function displayBuildWarning\b/u);
  assert.match(ownerSource, /\bexport function renderCollectionOutcomeTable\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/build-report-display\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:displayBuildWarning|displayCollectionKind|displayCollectionTarget|displayCollectionReason|markdownTableCell|renderCollectionOutcomeTable)\b/u,
    'pipeline should delegate build report display formatting to build-report-display.mjs',
  );
});

test('SiteForge capability state report model stays outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/capability-state-report.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');
  const ownerImports = await collectResolvedImportsFromFile(ownerPath);

  assert.match(ownerSource, /\bexport function buildCapabilityCard\b/u);
  assert.match(ownerSource, /\bexport function buildCapabilityStateModel\b/u);
  assert.match(ownerSource, /\bexport function capabilityCounts\b/u);
  assert.match(ownerSource, /\bexport function sortCapabilitiesForUser\b/u);
  assert.match(ownerSource, /\bexport function isHighRiskOrAccountDisabled\b/u);
  assert.equal(
    ownerImports.some((entry) => entry.resolvedRelativePath === 'src/app/pipeline/build/auto-capabilities.mjs'),
    false,
    'capability state reporting should not depend on auto capability generation for status counts',
  );
  assert.match(pipelineSource, /from\s+['"]\.\/capability-state-report\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:userReportGroupForCapability|userCapabilityReason|userCapabilityStrategy|safeExecutionPlanRoute|executionPlanCard|buildCapabilityCard|buildCapabilityStateModel|capabilityCounts|capabilitySortText|capabilityUserSortRank|sortCapabilitiesForUser|isHighRiskOrAccountDisabled)\b/u,
    'pipeline should delegate capability state report modeling to capability-state-report.mjs',
  );
});

test('SiteForge capability evidence matrix policy stays outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/capability-evidence-matrix.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');
  const ownerImports = await collectResolvedImportsFromFile(ownerPath);

  assert.match(ownerSource, /\bexport function capabilityRequiresLogin\b/u);
  assert.match(ownerSource, /\bexport function buildCapabilityEvidenceMatrix\b/u);
  assert.match(ownerSource, /\bexport function applyCapabilityEvidenceMatrix\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/capability-evidence-matrix\.mjs['"]/u);
  assert.equal(
    ownerImports.some((entry) => entry.resolvedRelativePath === pipelinePath),
    false,
    'capability evidence matrix policy must not import pipeline orchestration',
  );
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:capabilityRequiresLogin|sourceLayerForCapability|providerIdForCapability|observedCapabilityEvidenceLevel|nodeHasPublicStructureEvidence|buildCapabilityEvidenceMatrix|applyCapabilityEvidenceMatrix)\b/u,
    'pipeline should delegate capability evidence matrix policy to capability-evidence-matrix.mjs',
  );
});

test('SiteForge partial success reason model stays outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/partial-success-report.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');

  assert.match(ownerSource, /\bexport function buildPartialSuccessReasons\b/u);
  assert.match(ownerSource, /\bexport function partialSuccessReasonFromWarning\b/u);
  assert.match(ownerSource, /\bexport function buildPartialSuccessOutcome\b/u);
  assert.match(ownerSource, /\bexport function resultStatusFromBuild\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/partial-success-report\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:partialSuccessReasonFromWarning|safePublicReasonCode|buildPartialSuccessReasons|buildPartialSuccessOutcome|resultStatusFromBuild)\b/u,
    'pipeline should delegate partial success reason modeling to partial-success-report.mjs',
  );
});

test('SiteForge build summary report path resolution stays outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/build-summary-paths.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');

  assert.match(ownerSource, /\bexport function capabilityIntentHtmlResultPath\b/u);
  assert.match(ownerSource, /\bexport function pageReconciliationResultPath\b/u);
  assert.match(ownerSource, /\bexport function robotsRemediationResultPath\b/u);
  assert.match(ownerSource, /\bexport function accessRemediationResultPath\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/build-summary-paths\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:capabilityIntentHtmlResultPath|pageReconciliationResultPath|robotsRemediationResultPath|accessRemediationResultPath)\b/u,
    'pipeline should delegate build summary report path resolution to build-summary-paths.mjs',
  );
});

test('SiteForge build report mode payload selection stays outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/build-report-mode.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');

  assert.match(ownerSource, /\bexport function normalizeReportMode\b/u);
  assert.match(ownerSource, /\bexport function buildReportPayloadForMode\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/build-report-mode\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:normalizeReportMode|buildReportPayloadForMode)\b/u,
    'pipeline should delegate build report mode payload selection to build-report-mode.mjs',
  );
});

test('SiteForge plain build summary rendering stays outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/build-plain-summary.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');

  assert.match(ownerSource, /\bexport function renderSiteForgePlainBuildSummary\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/build-plain-summary\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:numberOrZero|renderSiteForgePlainBuildSummary)\b/u,
    'pipeline should delegate plain build summary rendering to build-plain-summary.mjs',
  );
});

test('SiteForge user report public value helpers stay outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/user-report-values.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');

  assert.match(ownerSource, /\bexport function sanitizeReportString\b/u);
  assert.match(ownerSource, /\bexport function sanitizeReportPublicValue\b/u);
  assert.match(ownerSource, /\bexport function relativeReportPath\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/user-report-values\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:sanitizeReportString|sanitizeReportPublicValue|relativeReportPath)\b|const\s+REPORT_(?:ABSOLUTE_PATH|EMAIL|PHONE|HANDLE|BEARER|SECRET_ASSIGNMENT|COOKIE|AUTH_HEADER|RAW_MARKUP)_PATTERN\b/u,
    'pipeline should delegate user report public value helpers to user-report-values.mjs',
  );
});

test('SiteForge user report coverage model stays outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/user-report-coverage.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');

  assert.match(ownerSource, /\bexport function browserBridgeCoverageGaps\b/u);
  assert.match(ownerSource, /\bexport function summarizeNodes\b/u);
  assert.match(ownerSource, /\bexport function buildCoverageReport\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/user-report-coverage\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+(?:browserBridgeCoverageGaps|summarizeNodes|buildCoverageReport)\b/u,
    'pipeline should delegate user report coverage modeling to user-report-coverage.mjs',
  );
});

test('SiteForge user report warning model stays outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/user-report-warnings.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');

  assert.match(ownerSource, /\bexport function buildUserFacingWarnings\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/user-report-warnings\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+buildUserFacingWarnings\b/u,
    'pipeline should delegate user report warning modeling to user-report-warnings.mjs',
  );
});

test('SiteForge user report next-step model stays outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/user-report-next-steps.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');

  assert.match(ownerSource, /\bexport function buildNextSteps\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/user-report-next-steps\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+buildNextSteps\b/u,
    'pipeline should delegate user report next-step modeling to user-report-next-steps.mjs',
  );
});

test('SiteForge user report workflow model stays outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/user-report-workflows.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');

  assert.match(ownerSource, /\bexport function buildNextStepWorkflows\b/u);
  assert.match(ownerSource, /\bexport const ROUTE_CAPTURE_PLAN_FILE\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/user-report-workflows\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+buildNextStepWorkflows\b/u,
    'pipeline should delegate user report workflow modeling to user-report-workflows.mjs',
  );
});

test('SiteForge user report privacy summary stays outside pipeline orchestration', async () => {
  const ownerPath = 'src/app/pipeline/build/user-report-privacy.mjs';
  const pipelinePath = 'src/app/pipeline/build/pipeline.mjs';
  const ownerSource = await readFile(path.join(REPO_ROOT, ownerPath), 'utf8');
  const pipelineSource = await readFile(path.join(REPO_ROOT, pipelinePath), 'utf8');

  assert.match(ownerSource, /\bexport function summarizePrivacy\b/u);
  assert.match(pipelineSource, /from\s+['"]\.\/user-report-privacy\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /function\s+summarizePrivacy\b/u,
    'pipeline should delegate user report privacy summary modeling to user-report-privacy.mjs',
  );
});

test('build entrypoint imports stay behind registries or capability services', async () => {
  const imports = [
    ...await collectResolvedImports('src/entrypoints/build'),
  ];
  const allowedAdapterRegistryPaths = new Set([
    'src/sites/adapters/factory.mjs',
    'src/sites/adapters/resolver.mjs',
  ]);
  const concreteAdapterHits = imports.filter((entry) => {
    const resolved = entry.resolvedRelativePath;
    return resolved?.startsWith('src/sites/adapters/')
      && !allowedAdapterRegistryPaths.has(resolved);
  });
  assert.deepEqual(
    concreteAdapterHits.map((entry) => `${entry.fileRelativePath} -> ${entry.specifier}`),
    [],
    'build entrypoints should reach SiteAdapter implementations only through the adapter factory/resolver',
  );

  for (const forbiddenPrefix of [
    'src/sites/downloads/site-modules/',
  ]) {
    assertNoResolvedPrefix(
      imports,
      forbiddenPrefix,
      'build entrypoints should not import downloader site-specific resolver semantics directly',
    );
  }
  assertNoResolvedPaths(imports, [
    'src/sites/downloads/artifacts.mjs',
    'src/sites/downloads/executor.mjs',
    'src/sites/downloads/legacy-executor.mjs',
    'src/sites/downloads/media-executor.mjs',
    'src/sites/downloads/modules.mjs',
    'src/sites/downloads/registry.mjs',
    'src/sites/downloads/resource-seeds.mjs',
    'src/sites/downloads/runner.mjs',
    'src/sites/downloads/session-manager.mjs',
    'src/sites/downloads/session-report.mjs',
  ], 'build entrypoints should delegate downloader behavior through runtime/capability boundaries');
});

test('domain services do not depend on concrete sites or runtime orchestration layers', async () => {
  const imports = await collectResolvedImports('src/domain');
  for (const forbiddenPrefix of [
    'src/entrypoints/',
    'src/app/',
    'src/sites/known-sites/bilibili/',
    'src/sites/known-sites/chapter-content/',
    'src/sites/adapters/',
    'src/sites/known-sites/douyin/',
    'src/sites/known-sites/instagram/',
    'src/sites/known-sites/jable/',
    'src/sites/known-sites/moodyz/',
    'src/sites/known-sites/social/',
    'src/sites/known-sites/x/',
    'src/sites/known-sites/xiaohongshu/',
    'src/sites/downloads/site-modules/',
  ]) {
    assertNoResolvedPrefix(
      imports,
      forbiddenPrefix,
      'domain services should not import concrete site, application, or entrypoint implementations directly',
    );
  }
  assertNoResolvedPrefix(
    imports,
    'src/sites/downloads/',
    'domain services should not import the retired public download facade',
  );
  const allowedDomainSessionImports = new Set([
    'src/domain/sessions/contracts.mjs',
    'src/domain/sessions/security-guard.mjs',
    'src/domain/sessions/session-view.mjs',
    'src/domain/sessions/session-manager.mjs',
    'src/domain/sessions/release-gate.mjs',
  ]);
  const crossDomainSessionRuntimeHits = imports.filter((entry) => (
    entry.resolvedRelativePath?.startsWith('src/domain/sessions/')
    && !entry.fileRelativePath.startsWith('src/domain/sessions/')
    && !allowedDomainSessionImports.has(entry.resolvedRelativePath)
  ));
  assert.deepEqual(
    crossDomainSessionRuntimeHits.map((entry) => `${entry.fileRelativePath} -> ${entry.specifier}`),
    [],
    'domain services may consume session contracts and guards but not session orchestration module implementations',
  );
  const forbiddenRuntimePaths = new Set([
    'src/shared/xiaohongshu-risk.mjs',
    'src/domain/sessions/manifest-bridge.mjs',
    'src/domain/sessions/runner.mjs',
    'src/entrypoints/sites/social-auth-import.mjs',
    'src/entrypoints/sites/douyin-export-cookies.mjs',
    'src/infra/auth/windows-credential-manager.mjs',
    'src/infra/browser/profile-store.mjs',
  ]);
  const forbiddenRuntimeHits = imports.filter((entry) => (
    forbiddenRuntimePaths.has(entry.resolvedRelativePath)
    && !entry.fileRelativePath.startsWith('src/domain/sessions/')
  ));
  assert.deepEqual(
    forbiddenRuntimeHits.map((entry) => `${entry.fileRelativePath} -> ${entry.specifier}`),
    [],
    'domain services should not import downloader execution, session orchestration, or raw credential/profile tooling directly',
  );
});

test('domain services keep health and recovery semantics site-neutral', async () => {
  const concreteSiteHealthRecoveryPattern =
    /\b(?:(?:22biqu|bilibili|douyin|instagram|jable|moodyz|qidian|twitter|xiaohongshu|x)(?:[-_.]?(?:doctor|health|recover(?:y)?|repair|service))|(?:doctor|health|recover(?:y)?|repair|service)[-_.]?(?:22biqu|bilibili|douyin|instagram|jable|moodyz|qidian|twitter|xiaohongshu|x))\b/giu;
  const matches = await collectSourcePatternMatches(
    'src/domain',
    concreteSiteHealthRecoveryPattern,
  );
  assert.deepEqual(
    matches,
    [],
    'domain services should keep health/recovery service semantics site-neutral and leave concrete site recovery behavior to SiteAdapters',
  );
});

test('planner policy handoff stays independent from downloader execution and session runtime', async () => {
  const imports = await collectResolvedImportsFromFile('src/app/planner/policy-handoff.mjs');
  assertDependencyAllowlist(imports, {
    allowedBuiltins: ['node:fs/promises', 'node:path'],
    allowedPaths: [
      'src/domain/capabilities/api-candidates.mjs',
      'src/domain/schemas/compatibility-registry.mjs',
      'src/domain/policies/download-policy.mjs',
      'src/domain/risks/reason-codes.mjs',
      'src/domain/schemas/schema-governance.mjs',
      'src/domain/sessions/security-guard.mjs',
      'src/domain/capabilities/site-capability-graph.mjs',
      'src/domain/risks/site-health-execution-gate.mjs',
      'src/domain/policies/standard-task-list.mjs',
      'src/domain/risks/trust-boundary.mjs',
    ],
  }, 'planner policy handoff should only depend on standard product schemas, trust boundaries, and redaction');

  const forbiddenRuntimePattern = /\b(?:fetch|globalThis\.fetch|openBrowserSession|ensureAuthenticatedSession|resolveSiteBrowserSessionOptions|runDownloadTask|executeMediaDownloads|acquireDownloadSession|resolveDownloader|sessionLease)\b/gu;
  const matches = await collectFileSourcePatternMatches(
    'src/app/planner/policy-handoff.mjs',
    forbiddenRuntimePattern,
  );
  assert.deepEqual(
    matches,
    [],
    'planner policy handoff should not trigger downloader, network, browser, or session runtime behavior',
  );
});

test('planner runtime invocation request stays descriptor-only and site-neutral', async () => {
  const imports = await collectResolvedImportsFromFile('src/app/planner/runtime-invocation-request.mjs');
  assertDependencyAllowlist(imports, {
    allowedPaths: [
      'src/app/planner/schema.mjs',
      'src/domain/policies/execution/index.mjs',
      'src/domain/policies/execution/schema.mjs',
      'src/domain/policies/execution/validator.mjs',
      'src/domain/policies/execution/layer-handoff.mjs',
      'src/domain/policies/execution/artifact-guard.mjs',
      'src/domain/policies/execution/policy-gate.mjs',
      'src/domain/policies/execution/coverage-delta-queue.mjs',
      'src/domain/policies/execution/layer-runtime-consumer.mjs',
      'src/domain/sessions/security-guard.mjs',
    ],
  }, 'planner runtime invocation request should only depend on schema and execution policy contracts');

  const forbiddenRuntimePattern = /\b(?:fetch|globalThis\.fetch|openBrowserSession|ensureAuthenticatedSession|resolveSiteBrowserSessionOptions|runDownloadTask|executeMediaDownloads|acquireDownloadSession|resolveDownloader|sessionLease|SiteAdapter)\b/gu;
  const matches = await collectFileSourcePatternMatches(
    'src/app/planner/runtime-invocation-request.mjs',
    forbiddenRuntimePattern,
  );
  assert.deepEqual(
    matches,
    [],
    'planner runtime invocation request should not trigger downloader, network, browser, site adapter, or session runtime behavior',
  );
});

test('core page-types only dispatches through adapter resolution for site-specific logic', async () => {
  const pageTypesPath = path.join(REPO_ROOT, 'src', 'sites', 'registry', 'core', 'page-types.mjs');
  const sourceText = await readFile(pageTypesPath, 'utf8');
  const imports = collectImportSpecifiers(sourceText);
  const resolved = imports
    .map((specifier) => resolveImportPath(pageTypesPath, specifier))
    .filter(Boolean);

  const invalid = resolved.filter((entry) => (
    entry.startsWith('src/sites/known-sites/douyin/')
    || entry.startsWith('src/sites/known-sites/bilibili/')
    || entry.startsWith('src/sites/known-sites/jable/')
  ));

  assert.deepEqual(
    invalid,
    [],
    'src/sites/registry/core/page-types.mjs should stay generic and reach site-specific logic only via adapters',
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

test('script shims only target entrypoints, CLI/shared helpers, or tools', async () => {
  const imports = await collectResolvedImports('scripts');
  const invalid = imports.filter((entry) => {
    const resolved = entry.resolvedRelativePath;
    if (!resolved) {
      return false;
    }
    if (
      entry.fileRelativePath === 'scripts/x-research-task-runner.mjs'
      && resolved === 'src/sites/known-sites/social/actions/download-boundary.mjs'
    ) {
      return false;
    }
    return !resolved.startsWith('src/entrypoints/')
      && !resolved.startsWith('src/infra/cli/')
      && resolved !== 'src/infra/io.mjs'
      && !resolved.startsWith('src/shared/')
      && !resolved.startsWith('tools/');
  });
  assert.deepEqual(
    invalid.map((entry) => `${entry.fileRelativePath} -> ${entry.specifier}`),
    [],
    'scripts should remain thin shims over src entrypoints, CLI/shared helpers, or tools',
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
    entry.startsWith('src/sites/known-sites/bilibili/')
    || entry.startsWith('src/sites/known-sites/douyin/')
    || entry.startsWith('src/sites/known-sites/xiaohongshu/')
  ));

  assert.deepEqual(
    invalid,
    [],
    'src/entrypoints/sites/site-doctor.mjs should consume site-specific doctor suites only through src/sites/registry/core/site-doctor-scenarios.mjs',
  );
  assert.match(
    sourceText,
    /site-doctor-scenarios\.mjs/u,
    'src/entrypoints/sites/site-doctor.mjs should import the core doctor scenario registry',
  );
});
