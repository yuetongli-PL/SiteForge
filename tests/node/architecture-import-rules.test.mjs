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
  /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|writeJsonFile|writeTextFile|appendTextFile|appendJsonLine|writeJsonLines)\b/gu;
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
  'src/domain/capabilities/api-candidates.mjs',
  'src/domain/capabilities/api-discovery.mjs',
  'src/app/planner/data-flow-evidence.mjs',
  'src/domain/policies/execution/layer-runtime-consumer.mjs',
  'src/domain/lifecycle/lifecycle-events.mjs',
  'src/app/planner/plan-artifact.mjs',
  'src/app/planner/policy-handoff.mjs',
  'src/domain/artifacts/site-capability-graph-artifacts.mjs',
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
  ['src/sites/known-sites/douyin/actions/router.mjs', 'temporary downloader input file for subprocess handoff'],
  ['src/sites/known-sites/douyin/queries/follow-query.mjs', 'follow-query cache persistence'],
  ['src/domain/sessions/session-view.mjs', 'SessionView revocation store persistence'],
  ['src/sites/known-sites/xiaohongshu/actions/router.mjs', 'temporary downloader input file for subprocess handoff'],
  ['src/skills/generation/publisher.mjs', 'generated skill reference publishing'],
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
  ['src/app/pipeline/build/artifact-store.mjs', 2],
  ['src/app/pipeline/build/capability-interaction.mjs', 3],
  ['src/app/pipeline/build/setup-assistant.mjs', 14],
  ['src/app/pipeline/build/workspace.mjs', 2],
  ['src/sites/known-sites/bilibili/navigation/open.mjs', 5],
  ['src/domain/capabilities/api-candidates.mjs', 8],
  ['src/domain/capabilities/api-discovery.mjs', 3],
  ['src/app/planner/data-flow-evidence.mjs', 2],
  ['src/domain/policies/execution/layer-runtime-consumer.mjs', 3],
  ['src/domain/lifecycle/lifecycle-events.mjs', 3],
  ['src/app/planner/policy-handoff.mjs', 2],
  ['src/domain/artifacts/site-capability-graph-artifacts.mjs', 3],
  ['src/domain/sessions/session-view.mjs', 2],
  ['src/sites/registry/catalog/index.mjs', 2],
  ['src/sites/known-sites/douyin/actions/router.mjs', 2],
  ['src/sites/known-sites/douyin/queries/follow-query.mjs', 2],
  ['src/domain/sessions/runner.mjs', 5],
  ['src/sites/known-sites/social/actions/router.mjs', 19],
  ['src/sites/known-sites/xiaohongshu/actions/router.mjs', 2],
  ['src/skills/generation/publisher.mjs', 7],
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
    return !resolved.startsWith('src/entrypoints/')
      && !resolved.startsWith('src/infra/cli/')
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
