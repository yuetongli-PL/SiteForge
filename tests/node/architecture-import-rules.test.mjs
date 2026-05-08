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
  const matches = [];
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
  const matches = [];
  for (const match of sourceText.matchAll(pattern)) {
    const lineNumber = sourceText.slice(0, match.index).split('\n').length;
    matches.push(`${fileRelativePath}:${lineNumber}: ${match[0]}`);
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
  'src/entrypoints/sites/session-repair-plan.mjs',
  'src/entrypoints/sites/site-doctor.mjs',
  'src/entrypoints/sites/site-login.mjs',
  'src/entrypoints/sites/site-scaffold.mjs',
  'src/entrypoints/sites/social-auth-import.mjs',
  'src/infra/auth/site-session-governance.mjs',
  'src/pipeline/stages/capture.mjs',
  'src/pipeline/stages/expand.mjs',
  'src/pipeline/stages/kb/lint-report.mjs',
  'src/sites/bilibili/navigation/open.mjs',
  'src/sites/capability/api-candidates.mjs',
  'src/sites/capability/api-discovery.mjs',
  'src/sites/capability/data-flow-evidence.mjs',
  'src/sites/capability/lifecycle-events.mjs',
  'src/sites/capability/planner/plan-artifact.mjs',
  'src/sites/capability/planner-policy-handoff.mjs',
  'src/sites/capability/site-capability-graph-artifacts.mjs',
  'src/sites/catalog/index.mjs',
  'src/sites/downloads/artifacts.mjs',
  'src/sites/downloads/executor.mjs',
  'src/sites/downloads/legacy-executor.mjs',
  'src/sites/downloads/media-executor.mjs',
  'src/sites/downloads/runner.mjs',
  'src/sites/sessions/runner.mjs',
  'src/sites/social/actions/router.mjs',
]);

const HIGH_RISK_RUNTIME_ARTIFACT_WRITERS = new Set([
  'src/sites/downloads/executor.mjs',
  'src/sites/downloads/legacy-executor.mjs',
  'src/sites/downloads/runner.mjs',
]);

const CLASSIFIED_RUNTIME_JSON_ARTIFACT_WRITE_CALLS = new Map([
  ['src/sites/downloads/executor.mjs', new Set([
    'writeJsonFile:layout.standardTaskListPath',
  ])],
  ['src/sites/downloads/legacy-executor.mjs', new Set([
    'writeJsonFile:layout.queuePath',
    'writeJsonFile:layout.resolvedTaskPath',
    'writeJsonFile:layout.standardTaskListPath',
    'writeJsonLines:layout.downloadsJsonlPath',
  ])],
  ['src/sites/downloads/runner.mjs', new Set([
    'writeJsonFile:layout.queuePath',
    'writeJsonFile:layout.resolvedTaskPath',
    'writeJsonFile:layout.standardTaskListPath',
    'writeJsonLines:layout.downloadsJsonlPath',
  ])],
]);

const CONTROLLED_NON_ARTIFACT_OR_GENERATED_WRITERS = new Map([
  ['src/entrypoints/pipeline/generate-crawler-script.mjs', 'crawler script and registry generation'],
  ['src/entrypoints/sites/douyin-export-cookies.mjs', 'explicit credential export command'],
  ['src/infra/auth/site-auth.mjs', 'explicit session export sidecar and cookie-file writer'],
  ['src/infra/io.mjs', 'central IO primitive definitions'],
  ['src/pipeline/stages/abstract.mjs', 'generated KB abstraction artifacts'],
  ['src/pipeline/stages/analyze.mjs', 'generated KB analysis artifacts'],
  ['src/pipeline/stages/collect-content.mjs', 'collected content and generated KB fixtures'],
  ['src/pipeline/stages/docs.mjs', 'generated KB documentation artifacts'],
  ['src/pipeline/stages/governance.mjs', 'generated KB governance artifacts'],
  ['src/pipeline/stages/kb/index.mjs', 'KB store generation and activity ledger'],
  ['src/pipeline/stages/kb/schema-files.mjs', 'generated KB schema and template files'],
  ['src/pipeline/stages/nl.mjs', 'generated KB natural-language artifacts'],
  ['src/pipeline/stages/skill.mjs', 'generated skill output files'],
  ['src/sites/douyin/actions/router.mjs', 'temporary downloader input file for subprocess handoff'],
  ['src/sites/douyin/queries/follow-query.mjs', 'follow-query cache persistence'],
  ['src/sites/capability/session-view.mjs', 'SessionView revocation store persistence'],
  ['src/sites/xiaohongshu/actions/router.mjs', 'temporary downloader input file for subprocess handoff'],
  ['src/skills/generation/publisher.mjs', 'generated skill reference publishing'],
]);

const ARTIFACT_WRITE_SINK_BASELINE = new Map([
  ['src/entrypoints/pipeline/generate-crawler-script.mjs', 6],
  ['src/entrypoints/sites/douyin-export-cookies.mjs', 5],
  ['src/entrypoints/sites/session-repair-plan.mjs', 3],
  ['src/entrypoints/sites/site-doctor.mjs', 12],
  ['src/entrypoints/sites/site-login.mjs', 5],
  ['src/entrypoints/sites/site-scaffold.mjs', 7],
  ['src/entrypoints/sites/social-auth-import.mjs', 3],
  ['src/infra/auth/site-auth.mjs', 3],
  ['src/infra/auth/site-session-governance.mjs', 8],
  ['src/infra/io.mjs', 12],
  ['src/pipeline/stages/abstract.mjs', 6],
  ['src/pipeline/stages/analyze.mjs', 8],
  ['src/pipeline/stages/capture.mjs', 6],
  ['src/pipeline/stages/collect-content.mjs', 10],
  ['src/pipeline/stages/docs.mjs', 9],
  ['src/pipeline/stages/expand.mjs', 15],
  ['src/pipeline/stages/governance.mjs', 7],
  ['src/pipeline/stages/kb/index.mjs', 18],
  ['src/pipeline/stages/kb/lint-report.mjs', 9],
  ['src/pipeline/stages/kb/schema-files.mjs', 11],
  ['src/pipeline/stages/nl.mjs', 7],
  ['src/pipeline/stages/skill.mjs', 2],
  ['src/sites/bilibili/navigation/open.mjs', 5],
  ['src/sites/capability/api-candidates.mjs', 8],
  ['src/sites/capability/api-discovery.mjs', 3],
  ['src/sites/capability/data-flow-evidence.mjs', 2],
  ['src/sites/capability/lifecycle-events.mjs', 3],
  ['src/sites/capability/planner-policy-handoff.mjs', 2],
  ['src/sites/capability/site-capability-graph-artifacts.mjs', 3],
  ['src/sites/capability/session-view.mjs', 2],
  ['src/sites/catalog/index.mjs', 2],
  ['src/sites/douyin/actions/router.mjs', 2],
  ['src/sites/douyin/queries/follow-query.mjs', 2],
  ['src/sites/downloads/artifacts.mjs', 3],
  ['src/sites/downloads/executor.mjs', 14],
  ['src/sites/downloads/legacy-executor.mjs', 16],
  ['src/sites/downloads/media-executor.mjs', 5],
  ['src/sites/downloads/runner.mjs', 9],
  ['src/sites/sessions/runner.mjs', 5],
  ['src/sites/social/actions/router.mjs', 19],
  ['src/sites/xiaohongshu/actions/router.mjs', 2],
  ['src/skills/generation/publisher.mjs', 7],
]);

function collectArtifactWriteSinkMatches(sourceText, fileRelativePath) {
  const matches = [];
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
  const calls = [];
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
  if (!HIGH_RISK_RUNTIME_ARTIFACT_WRITERS.has(fileRelativePath)) {
    return [];
  }
  const failures = [];
  if (!hasPairedRedactionArtifactWriteCallsite(sourceText)) {
    failures.push(`${fileRelativePath} lacks paired redaction/audit write call-site evidence`);
  }
  const classifiedCalls = CLASSIFIED_RUNTIME_JSON_ARTIFACT_WRITE_CALLS.get(fileRelativePath) ?? new Set();
  for (const call of collectCallExpressions(sourceText, 'writeJsonFile|writeJsonLines|writeFile')) {
    const firstArgument = extractFirstCallArgument(call.source);
    if (call.callee === 'writeFile') {
      if (/\bJSON\.stringify\s*\(/u.test(call.source)) {
        failures.push(`${fileRelativePath}:${call.lineNumber}: unclassified JSON.stringify writeFile artifact call: ${normalizeCallSource(call.source)}`);
      }
      continue;
    }
    const callKey = `${call.callee}:${firstArgument}`;
    if (!classifiedCalls.has(callKey)) {
      failures.push(`${fileRelativePath}:${call.lineNumber}: unclassified ${call.callee} JSON artifact call: ${normalizeCallSource(call.source)}`);
    }
  }
  return failures;
}

function hasRedactionGuardedArtifactEvidence(sourceText) {
  ARTIFACT_WRITE_SINK_PATTERN.lastIndex = 0;
  return /prepareRedactedArtifactJsonWithAudit\(/u.test(sourceText)
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

const NON_GOAL_ORDINARY_RUNTIME_FILES = [
  'src/entrypoints/pipeline/run-pipeline.mjs',
  'src/pipeline/runtime/create-default-runtime.mjs',
  'src/sites/downloads/artifacts.mjs',
  'src/sites/downloads/executor.mjs',
  'src/sites/downloads/index.mjs',
  'src/sites/downloads/legacy-executor.mjs',
  'src/sites/downloads/media-executor.mjs',
  'src/sites/downloads/modules.mjs',
  'src/sites/downloads/recovery.mjs',
  'src/sites/downloads/registry.mjs',
  'src/sites/downloads/resource-seeds.mjs',
  'src/sites/downloads/runner.mjs',
  'src/sites/downloads/session-report.mjs',
];

const DOWNLOAD_LOW_PERMISSION_CONSUMER_FILES = [
  'src/sites/downloads/executor.mjs',
  'src/sites/downloads/media-executor.mjs',
];

const DOWNLOAD_SITE_RESOLVER_SEMANTIC_PATHS = [
  'src/sites/downloads/modules.mjs',
  'src/sites/downloads/registry.mjs',
];

const DOWNLOAD_SITE_RESOLVER_SEMANTIC_PREFIXES = [
  'src/sites/catalog/',
  'src/sites/downloads/site-modules/',
];

const DOWNLOAD_SITE_RESOLVER_DEP_PATTERN = /\b(?:resolveBilibiliApiEvidence|resolveDouyinMediaBatch|enumerateDouyinAuthorVideos|queryDouyinFollow|queryXiaohongshuFollow|resolveXiaohongshuFreshEvidence)\b/gu;

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
  const matches = [];
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
      'src/sites/capability/api-discovery.mjs',
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
      'src/sites/downloads/executor.mjs',
      `
        import { writeJsonFile, writeTextFile } from '../../infra/io.mjs';
        import { prepareRedactedArtifactJsonWithAudit } from '../capability/security-guard.mjs';
        export async function writeRuntimeArtifacts(layout, manifest, taskList) {
          const prepared = prepareRedactedArtifactJsonWithAudit(manifest);
          await writeJsonFile(layout.standardTaskListPath, taskList);
          await writeTextFile(layout.manifestPath, prepared.json);
          await writeTextFile(layout.redactionAuditPath, prepared.auditJson);
        }
      `,
    ),
    [],
  );
  const runtimeFailures = collectHighRiskRuntimeArtifactWriteGuardFailures(
    'src/sites/downloads/executor.mjs',
    `
      export async function writeRuntimeArtifacts(fs, layout, manifest, queue) {
        const prepared = prepareRedactedArtifactJsonWithAudit(manifest);
        await writeTextFile(layout.manifestPath, prepared.json);
        await writeTextFile(layout.redactionAuditPath, prepared.auditJson);
        await writeJsonFile(layout.manifestPath, manifest);
        await fs.writeFile(layout.queuePath, JSON.stringify(queue));
      }
    `,
  );
  assert.equal(runtimeFailures.length, 2);
  assert.match(runtimeFailures[0], /unclassified writeJsonFile JSON artifact call/u);
  assert.match(runtimeFailures[1], /unclassified JSON\.stringify writeFile artifact call/u);
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
  const failures = [];
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

test('ordinary download runtime and pipeline paths do not cross non-goal session boundaries', async () => {
  const matches = [];
  for (const fileRelativePath of NON_GOAL_ORDINARY_RUNTIME_FILES) {
    const sourceText = await readFile(path.join(REPO_ROOT, fileRelativePath), 'utf8');
    matches.push(...collectNonGoalBoundaryMatches(fileRelativePath, sourceText));
  }
  assert.deepEqual(
    matches,
    [],
    'ordinary download/runtime/pipeline paths should use normalized SessionView/header helpers and SecurityGuard, not raw credential/profile/session fields',
  );
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

test('download site modules do not depend on downloader execution or session orchestration layers', async () => {
  const imports = await collectResolvedImports('src/sites/downloads/site-modules');
  assertNoResolvedPaths(imports, [
    'src/sites/downloads/artifacts.mjs',
    'src/sites/downloads/executor.mjs',
    'src/sites/downloads/legacy-executor.mjs',
    'src/sites/downloads/media-executor.mjs',
    'src/sites/downloads/registry.mjs',
    'src/sites/downloads/runner.mjs',
    'src/sites/downloads/session-manager.mjs',
  ], 'download site modules should stay resolver-only and not import downloader execution/session orchestration layers');
});

test('download site modules do not depend on high-privilege runtime or orchestration layers', async () => {
  const imports = await collectResolvedImports('src/sites/downloads/site-modules');
  for (const forbiddenPrefix of [
    'src/entrypoints/',
    'src/infra/',
    'src/pipeline/',
    'src/sites/core/',
    'src/sites/sessions/',
  ]) {
    assertNoResolvedPrefix(
      imports,
      forbiddenPrefix,
      'download site modules should not import high-privilege runtime or orchestration layers',
    );
  }
});

test('download site modules do not import API discovery, catalog, risk, or session services directly', async () => {
  const imports = await collectResolvedImports('src/sites/downloads/site-modules');
  assertNoResolvedPaths(imports, [
    'src/sites/capability/api-candidates.mjs',
    'src/sites/capability/api-discovery.mjs',
    'src/sites/capability/network-capture.mjs',
    'src/sites/capability/planner-policy-handoff.mjs',
    'src/sites/capability/risk-state.mjs',
    'src/sites/capability/session-view.mjs',
  ], 'download site modules should not discover APIs, maintain catalogs, manage risk, or materialize SessionView directly');
  assertNoResolvedPrefix(
    imports,
    'src/sites/catalog/',
    'download site modules should not import legacy API catalog knowledge directly',
  );
});

test('download site modules keep a narrow low-permission dependency allowlist', async () => {
  const imports = await collectResolvedImports('src/sites/downloads/site-modules');
  assertDependencyAllowlist(imports, {
    allowedBuiltins: ['node:fs/promises', 'node:path'],
    allowedPaths: [
      'src/shared/normalize.mjs',
      'src/sites/downloads/contracts.mjs',
      'src/sites/downloads/resource-seeds.mjs',
    ],
    allowedPrefixes: [
      'src/sites/downloads/site-modules/',
    ],
  }, 'download site modules should only depend on current low-permission resolver helpers');
});

test('download resource seed helper keeps a narrow low-permission dependency allowlist', async () => {
  const imports = await collectResolvedImportsFromFile('src/sites/downloads/resource-seeds.mjs');
  assertDependencyAllowlist(imports, {
    allowedBuiltins: ['node:path'],
    allowedPaths: [
      'src/shared/normalize.mjs',
      'src/sites/downloads/contracts.mjs',
    ],
  }, 'download resource seed helper should not depend on site modules, runtime orchestration, sessions, or artifact writers');
});

test('download resolver coordinators do not depend on execution or session orchestration layers', async () => {
  const imports = [
    ...await collectResolvedImportsFromFile('src/sites/downloads/modules.mjs'),
    ...await collectResolvedImportsFromFile('src/sites/downloads/registry.mjs'),
    ...await collectResolvedImportsFromFile('src/sites/downloads/resource-seeds.mjs'),
  ];
  assertNoResolvedPaths(imports, [
    'src/sites/downloads/artifacts.mjs',
    'src/sites/downloads/executor.mjs',
    'src/sites/downloads/legacy-executor.mjs',
    'src/sites/downloads/media-executor.mjs',
    'src/sites/downloads/runner.mjs',
    'src/sites/downloads/session-manager.mjs',
    'src/sites/sessions/manifest-bridge.mjs',
    'src/sites/sessions/runner.mjs',
  ], 'download resolver coordinators should not import executor, runner, or session orchestration modules');
});

test('download resource seed helper does not perform network or login-state decisions', async () => {
  const forbiddenBoundaryPattern = /\b(?:fetch|globalThis\.fetch)\b|sessionLease\??\.(?:headers|cookies|status|mode|authStatus|profilePath|browserProfileRoot|userDataDir)\b/giu;
  const matches = await collectFileSourcePatternMatches(
    'src/sites/downloads/resource-seeds.mjs',
    forbiddenBoundaryPattern,
  );
  assert.deepEqual(
    matches,
    [],
    'download resource seed helper should only consume normalized low-permission inputs, not fetch or inspect raw session/login state',
  );
});

test('download resolver modules do not inspect raw credential, login, or profile lease fields directly', async () => {
  const forbiddenSessionLeasePattern = /sessionLease\??\.(?:headers|cookies|status|mode|authStatus|profilePath|browserProfileRoot|userDataDir|authorization|cookie|csrf|accessToken|refreshToken|SESSDATA)\b/giu;
  const matches = [
    ...await collectSourcePatternMatches(
      'src/sites/downloads/site-modules',
      forbiddenSessionLeasePattern,
    ),
    ...await collectFileSourcePatternMatches(
      'src/sites/downloads/resource-seeds.mjs',
      forbiddenSessionLeasePattern,
    ),
  ];
  assert.deepEqual(
    matches,
    [],
    'download resolver modules should use normalized low-permission session views/header helpers instead of raw lease fields',
  );
});

test('douyin native resolver does not inspect raw credential, session login, or profile state directly', async () => {
  const matches = await collectFileSourcePatternMatches(
    'src/sites/downloads/site-modules/douyin.mjs',
    /sessionLease\??\.(?:headers|cookies|status|mode|authStatus|profilePath|browserProfileRoot|userDataDir|authorization|cookie|csrf|accessToken|refreshToken|SESSDATA)\b/giu,
  );
  assert.deepEqual(
    matches,
    [],
    'douyin native resolver should rely on normalized low-permission inputs, not raw credential/login/profile state inspection',
  );
});

test('xiaohongshu native resolver does not inspect raw credential, session login, or profile state directly', async () => {
  const matches = await collectFileSourcePatternMatches(
    'src/sites/downloads/site-modules/xiaohongshu.mjs',
    /sessionLease\??\.(?:headers|cookies|status|mode|authStatus|profilePath|browserProfileRoot|userDataDir|authorization|cookie|csrf|accessToken|refreshToken|SESSDATA)\b/giu,
  );
  assert.deepEqual(
    matches,
    [],
    'xiaohongshu native resolver should rely on normalized low-permission inputs, not raw credential/login/profile state inspection',
  );
});

test('common legacy profile flags keep profile material behind explicit no-SessionView boundary', async () => {
  const commonPath = path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'site-modules', 'common.mjs');
  const sourceText = await readFile(commonPath, 'utf8');
  const helperStart = sourceText.indexOf('export function resolveLegacyProfileFlagMaterial');
  const builderStart = sourceText.indexOf('export function addCommonProfileFlags');
  assert.notEqual(helperStart, -1);
  assert.notEqual(builderStart, -1);
  const helperSource = sourceText.slice(helperStart, builderStart);
  const builderSource = sourceText.slice(builderStart);

  assert.match(helperSource, /sessionViewBoundaryPresent/u);
  assert.match(helperSource, /session-view-boundary-present/u);
  assert.match(helperSource, /legacy-no-session-view-only/u);
  assert.match(builderSource, /resolveLegacyProfileFlagMaterial/u);
  assert.doesNotMatch(
    builderSource,
    /sessionLease\??\.(?:profilePath|browserProfileRoot|userDataDir)\b/u,
    'common flag builder should not read profile material outside the explicit no-SessionView helper',
  );
});

test('download resolver modules do not write artifacts directly', async () => {
  const artifactWritePattern = /\b(?:writeJsonFile|writeTextFile|appendTextFile|appendJsonLine|writeJsonLines|prepareRedactedArtifactJson(?:WithAudit)?|writeFile|appendFile)\b/gu;
  const matches = [
    ...await collectSourcePatternMatches('src/sites/downloads/site-modules', artifactWritePattern),
    ...await collectFileSourcePatternMatches('src/sites/downloads/resource-seeds.mjs', artifactWritePattern),
  ];
  assert.deepEqual(
    matches,
    [],
    'download resolver modules should not write artifacts or bypass downstream ArtifactService/Redaction boundaries',
  );
});

test('download site module router delegates without raw lease inspection or artifact writes', async () => {
  const forbiddenRouterPattern = /\b(?:fetch|globalThis\.fetch|writeJsonFile|writeTextFile|appendTextFile|appendJsonLine|writeJsonLines|prepareRedactedArtifactJson(?:WithAudit)?|writeFile|appendFile)\b|sessionLease\??\.(?:headers|cookies|status|mode|authStatus|profilePath|browserProfileRoot|userDataDir|authorization|cookie|csrf|accessToken|refreshToken|SESSDATA)\b/giu;
  const matches = await collectFileSourcePatternMatches(
    'src/sites/downloads/modules.mjs',
    forbiddenRouterPattern,
  );
  assert.deepEqual(
    matches,
    [],
    'download site module router should delegate to registered resolvers without inspecting raw leases, doing network work, or writing artifacts',
  );
});

test('download low-permission consumers keep site resolver semantics behind the router', async () => {
  const imports = [];
  const resolverDepMatches = [];
  for (const fileRelativePath of DOWNLOAD_LOW_PERMISSION_CONSUMER_FILES) {
    imports.push(...await collectResolvedImportsFromFile(fileRelativePath));
    resolverDepMatches.push(...await collectFileSourcePatternMatches(
      fileRelativePath,
      DOWNLOAD_SITE_RESOLVER_DEP_PATTERN,
    ));
  }

  assertNoResolvedPaths(
    imports,
    DOWNLOAD_SITE_RESOLVER_SEMANTIC_PATHS,
    'download low-permission consumers should not import site-module routers or resolver registries directly',
  );
  for (const forbiddenPrefix of DOWNLOAD_SITE_RESOLVER_SEMANTIC_PREFIXES) {
    assertNoResolvedPrefix(
      imports,
      forbiddenPrefix,
      'download low-permission consumers should not import site-specific resolver dependencies directly',
    );
  }
  assert.deepEqual(
    resolverDepMatches,
    [],
    'download low-permission consumers should not know site-specific resolver dependency keys',
  );
});

test('download site-module router remains the allowed site-specific resolver import layer', async () => {
  const imports = await collectResolvedImportsFromFile('src/sites/downloads/modules.mjs');
  const resolvedPaths = imports
    .map((entry) => entry.resolvedRelativePath)
    .filter(Boolean);

  assert.ok(
    resolvedPaths.some((entry) => entry.startsWith('src/sites/downloads/site-modules/')),
    'download site-module router should continue owning direct site-module resolver imports',
  );
  assert.ok(
    resolvedPaths.includes('src/sites/downloads/registry.mjs'),
    'download site-module router should continue owning registry fallback wiring',
  );
});

test('social native resolver sanitizes API headers before resource seeds reach downloader', async () => {
  const socialModulePath = path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'site-modules', 'social.mjs');
  const sourceText = await readFile(socialModulePath, 'utf8');
  const sanitizerStart = sourceText.indexOf('function sanitizedSocialResourceHeaders');
  const seedStart = sourceText.indexOf('function seedFromSocialMediaEntry');
  const nextFunctionStart = sourceText.indexOf('async function requestWithSocialNativeSeeds');

  assert.notEqual(sanitizerStart, -1);
  assert.notEqual(seedStart, -1);
  assert.notEqual(nextFunctionStart, -1);

  const sanitizerSource = sourceText.slice(sanitizerStart, seedStart);
  const seedSource = sourceText.slice(seedStart, nextFunctionStart);
  for (const forbiddenHeader of [
    'authorization',
    'cookie',
    'x-csrf-token',
    'x-ig-app-id',
    'x-twitter-auth-type',
  ]) {
    assert.match(sanitizerSource, new RegExp(`['"]${forbiddenHeader}['"]`, 'u'));
  }
  assert.match(seedSource, /headers:\s*sanitizedSocialResourceHeaders\(entry\.headers\)/u);
  assert.doesNotMatch(seedSource, /headers:\s*entry\.headers/u);
});

test('download execution consumers do not import site semantics or session orchestration', async () => {
  const imports = [
    ...await collectResolvedImportsFromFile('src/sites/downloads/executor.mjs'),
    ...await collectResolvedImportsFromFile('src/sites/downloads/media-executor.mjs'),
  ];
  const forbiddenPaths = [
    'src/sites/downloads/modules.mjs',
    'src/sites/downloads/registry.mjs',
    'src/sites/downloads/session-manager.mjs',
  ];
  assertNoResolvedPaths(
    imports,
    forbiddenPaths,
    'download execution consumers should not import legacy command routing, resolver registry, or session acquisition',
  );
  for (const forbiddenPrefix of [
    'src/entrypoints/',
    'src/infra/auth/',
    'src/infra/browser/',
    'src/pipeline/',
    'src/sites/core/',
    'src/sites/downloads/site-modules/',
    'src/sites/sessions/',
  ]) {
    assertNoResolvedPrefix(
      imports,
      forbiddenPrefix,
      'download execution consumers should stay below site semantics and session orchestration layers',
    );
  }
});

test('download execution consumers do not import API discovery or catalog services', async () => {
  const imports = [
    ...await collectResolvedImportsFromFile('src/sites/downloads/executor.mjs'),
    ...await collectResolvedImportsFromFile('src/sites/downloads/media-executor.mjs'),
    ...await collectResolvedImportsFromFile('src/sites/downloads/legacy-executor.mjs'),
  ];
  assertNoResolvedPaths(imports, [
    'src/sites/capability/api-candidates.mjs',
    'src/sites/capability/api-discovery.mjs',
    'src/sites/capability/network-capture.mjs',
    'src/sites/capability/planner-policy-handoff.mjs',
    'src/sites/capability/risk-state.mjs',
    'src/sites/capability/session-view.mjs',
  ], 'download execution consumers should not discover APIs, select catalog entries, maintain API knowledge, manage risk state, or materialize SessionView directly');
  assertNoResolvedPrefix(
    imports,
    'src/sites/catalog/',
    'download execution consumers should not import legacy API catalog knowledge',
  );
});

test('download execution consumers do not inspect raw session lease state directly', async () => {
  const forbiddenSessionLeasePattern = /sessionLease\??\.(?:headers|cookies|status|mode|authStatus|profilePath|browserProfileRoot|userDataDir|authorization|cookie|csrf|accessToken|refreshToken|SESSDATA)\b/giu;
  const matches = [
    ...await collectFileSourcePatternMatches(
      'src/sites/downloads/executor.mjs',
      forbiddenSessionLeasePattern,
    ),
    ...await collectFileSourcePatternMatches(
      'src/sites/downloads/media-executor.mjs',
      forbiddenSessionLeasePattern,
    ),
    ...await collectFileSourcePatternMatches(
      'src/sites/downloads/legacy-executor.mjs',
      forbiddenSessionLeasePattern,
    ),
  ];
  assert.deepEqual(
    matches,
    [],
    'download execution consumers should consume normalized SessionView/task inputs, not inspect raw session lease state directly',
  );
});

test('download contracts delegate host to siteKey classification to the core SiteAdapter resolver', async () => {
  const contractsPath = path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'contracts.mjs');
  const resolverPath = path.join(REPO_ROOT, 'src', 'sites', 'core', 'adapters', 'resolver.mjs');
  const contractsSource = await readFile(contractsPath, 'utf8');
  const resolverSource = await readFile(resolverPath, 'utf8');
  const imports = collectImportSpecifiers(contractsSource)
    .map((specifier) => resolveImportPath(contractsPath, specifier))
    .filter(Boolean);

  assert.equal(
    imports.includes('src/sites/core/adapters/resolver.mjs'),
    true,
    'download contracts should delegate site identity classification to the core SiteAdapter resolver',
  );
  assert.match(
    resolverSource,
    /export function resolveSiteKeyFromHost/u,
    'core SiteAdapter resolver should own the host to siteKey helper',
  );
  assert.deepEqual(
    await collectFileSourcePatternMatches(
      'src/sites/downloads/contracts.mjs',
      /\b(?:www\.22biqu\.com|www\.bilibili\.com|www\.douyin\.com|www\.xiaohongshu\.com|www\.instagram\.com|instagram\.com|x\.com)\b/gu,
    ),
    [],
    'download contracts should not maintain a concrete site host classification table',
  );
});

test('pipeline entrypoint reaches site risk detectors through SiteAdapter contracts', async () => {
  const entrypointPath = path.join(REPO_ROOT, 'src', 'entrypoints', 'pipeline', 'run-pipeline.mjs');
  const sourceText = await readFile(entrypointPath, 'utf8');
  const imports = collectImportSpecifiers(sourceText);
  const resolved = imports
    .map((specifier) => resolveImportPath(entrypointPath, specifier))
    .filter(Boolean);

  assert.deepEqual(
    resolved.filter((entry) => entry === 'src/shared/xiaohongshu-risk.mjs'),
    [],
    'pipeline entrypoint should not import concrete site risk detectors directly',
  );
  assert.match(
    sourceText,
    /resolveSiteAdapter/u,
    'pipeline entrypoint should reach site-specific risk behavior through SiteAdapter resolution',
  );
  assert.match(
    sourceText,
    /detectRestrictionPage/u,
    'pipeline entrypoint should consume the generic SiteAdapter restriction detector contract',
  );
});

test('pipeline entrypoints do not import raw credential tools or concrete site risk helpers', async () => {
  const imports = await collectResolvedImports('src/entrypoints/pipeline');
  assertNoResolvedPaths(imports, [
    'src/shared/xiaohongshu-risk.mjs',
    'src/entrypoints/sites/social-auth-import.mjs',
    'src/entrypoints/sites/douyin-export-cookies.mjs',
    'src/infra/auth/windows-credential-manager.mjs',
    'src/infra/browser/profile-store.mjs',
  ], 'pipeline entrypoints should not import raw credential/profile tooling or concrete site risk helpers directly');
});

test('pipeline stages do not depend on downloader or raw credential orchestration layers', async () => {
  const imports = await collectResolvedImports('src/pipeline/stages');
  for (const forbiddenPrefix of [
    'src/sites/downloads/',
    'src/sites/sessions/',
  ]) {
    assertNoResolvedPrefix(
      imports,
      forbiddenPrefix,
      'pipeline stages should not import downloader or session orchestration layers directly',
    );
  }
  assertNoResolvedPaths(imports, [
    'src/shared/xiaohongshu-risk.mjs',
    'src/entrypoints/sites/social-auth-import.mjs',
    'src/entrypoints/sites/douyin-export-cookies.mjs',
    'src/infra/auth/windows-credential-manager.mjs',
    'src/infra/browser/profile-store.mjs',
  ], 'pipeline stages should not import raw credential/profile tooling or concrete site risk helpers directly');
});

test('kernel and pipeline boundary imports stay behind registries or capability services', async () => {
  const imports = [
    ...await collectResolvedImports('src/entrypoints/pipeline'),
    ...await collectResolvedImports('src/pipeline/engine'),
    ...await collectResolvedImports('src/pipeline/runtime'),
    ...await collectResolvedImports('src/pipeline/stages'),
  ];
  const allowedAdapterRegistryPaths = new Set([
    'src/sites/core/adapters/factory.mjs',
    'src/sites/core/adapters/resolver.mjs',
  ]);
  const concreteAdapterHits = imports.filter((entry) => {
    const resolved = entry.resolvedRelativePath;
    return resolved?.startsWith('src/sites/core/adapters/')
      && !allowedAdapterRegistryPaths.has(resolved);
  });
  assert.deepEqual(
    concreteAdapterHits.map((entry) => `${entry.fileRelativePath} -> ${entry.specifier}`),
    [],
    'kernel/pipeline entrypoints and stages should reach SiteAdapter implementations only through the adapter factory/resolver',
  );

  for (const forbiddenPrefix of [
    'src/sites/downloads/site-modules/',
  ]) {
    assertNoResolvedPrefix(
      imports,
      forbiddenPrefix,
      'kernel/pipeline entrypoints and stages should not import downloader site-specific resolver semantics directly',
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
  ], 'kernel/pipeline entrypoints and stages should delegate downloader behavior through runtime/capability boundaries');
});

test('capability services do not depend on concrete sites or runtime orchestration layers', async () => {
  const imports = await collectResolvedImports('src/sites/capability');
  for (const forbiddenPrefix of [
    'src/entrypoints/',
    'src/sites/bilibili/',
    'src/sites/chapter-content/',
    'src/sites/core/adapters/',
    'src/sites/douyin/',
    'src/sites/instagram/',
    'src/sites/jable/',
    'src/sites/moodyz/',
    'src/sites/social/',
    'src/sites/x/',
    'src/sites/xiaohongshu/',
    'src/sites/downloads/site-modules/',
  ]) {
    assertNoResolvedPrefix(
      imports,
      forbiddenPrefix,
      'capability services should not import concrete site or entrypoint implementations directly',
    );
  }
  assertNoResolvedPrefixExcept(
    imports,
    'src/sites/downloads/',
    ['src/sites/downloads/contracts.mjs'],
    'capability services may consume downloader contracts but not downloader execution/session module implementations',
  );
  assertNoResolvedPrefixExcept(
    imports,
    'src/sites/sessions/',
    ['src/sites/sessions/contracts.mjs'],
    'capability services may consume session contracts but not session orchestration module implementations',
  );
  assertNoResolvedPaths(imports, [
    'src/shared/xiaohongshu-risk.mjs',
    'src/sites/downloads/artifacts.mjs',
    'src/sites/downloads/executor.mjs',
    'src/sites/downloads/legacy-executor.mjs',
    'src/sites/downloads/media-executor.mjs',
    'src/sites/downloads/registry.mjs',
    'src/sites/downloads/runner.mjs',
    'src/sites/downloads/session-manager.mjs',
    'src/sites/sessions/manifest-bridge.mjs',
    'src/sites/sessions/runner.mjs',
    'src/entrypoints/sites/social-auth-import.mjs',
    'src/entrypoints/sites/douyin-export-cookies.mjs',
    'src/infra/auth/windows-credential-manager.mjs',
    'src/infra/browser/profile-store.mjs',
  ], 'capability services should not import downloader execution, session orchestration, or raw credential/profile tooling directly');
});

test('capability services keep health and recovery semantics site-neutral', async () => {
  const concreteSiteHealthRecoveryPattern =
    /\b(?:(?:22biqu|bilibili|douyin|instagram|jable|moodyz|qidian|twitter|xiaohongshu|x)(?:[-_.]?(?:doctor|health|recover(?:y)?|repair|service))|(?:doctor|health|recover(?:y)?|repair|service)[-_.]?(?:22biqu|bilibili|douyin|instagram|jable|moodyz|qidian|twitter|xiaohongshu|x))\b/giu;
  const matches = await collectSourcePatternMatches(
    'src/sites/capability',
    concreteSiteHealthRecoveryPattern,
  );
  assert.deepEqual(
    matches,
    [],
    'capability services should keep health/recovery service semantics site-neutral and leave concrete site recovery behavior to SiteAdapters',
  );
});

test('planner policy handoff stays independent from downloader execution and session runtime', async () => {
  const imports = await collectResolvedImportsFromFile('src/sites/capability/planner-policy-handoff.mjs');
  assertDependencyAllowlist(imports, {
    allowedBuiltins: ['node:fs/promises', 'node:path'],
    allowedPaths: [
      'src/sites/capability/api-candidates.mjs',
      'src/sites/capability/compatibility-registry.mjs',
      'src/sites/capability/download-policy.mjs',
      'src/sites/capability/reason-codes.mjs',
      'src/sites/capability/schema-governance.mjs',
      'src/sites/capability/security-guard.mjs',
      'src/sites/capability/site-capability-graph.mjs',
      'src/sites/capability/site-health-execution-gate.mjs',
      'src/sites/capability/standard-task-list.mjs',
      'src/sites/capability/trust-boundary.mjs',
    ],
  }, 'planner policy handoff should only depend on standard product schemas, trust boundaries, and redaction');

  const forbiddenRuntimePattern = /\b(?:fetch|globalThis\.fetch|openBrowserSession|ensureAuthenticatedSession|resolveSiteBrowserSessionOptions|runDownloadTask|executeMediaDownloads|acquireDownloadSession|resolveDownloader|sessionLease)\b/gu;
  const matches = await collectFileSourcePatternMatches(
    'src/sites/capability/planner-policy-handoff.mjs',
    forbiddenRuntimePattern,
  );
  assert.deepEqual(
    matches,
    [],
    'planner policy handoff should not trigger downloader, network, browser, or session runtime behavior',
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

test('expand stage reaches Xiaohongshu site identity through SiteAdapter resolution', async () => {
  const expandPath = path.join(REPO_ROOT, 'src', 'pipeline', 'stages', 'expand.mjs');
  const sourceText = await readFile(expandPath, 'utf8');
  const imports = collectImportSpecifiers(sourceText);
  const resolved = imports
    .map((specifier) => resolveImportPath(expandPath, specifier))
    .filter(Boolean);

  assert.deepEqual(
    resolved.filter((entry) => entry === 'src/shared/xiaohongshu-risk.mjs'),
    [],
    'expand stage should not import concrete Xiaohongshu URL/risk helpers directly',
  );
  assert.match(
    sourceText,
    /resolveSiteAdapter/u,
    'expand stage should resolve Xiaohongshu identity through the SiteAdapter registry',
  );
});

test('capture stage reaches Xiaohongshu site identity through SiteAdapter resolution', async () => {
  const capturePath = path.join(REPO_ROOT, 'src', 'pipeline', 'stages', 'capture.mjs');
  const sourceText = await readFile(capturePath, 'utf8');
  const imports = collectImportSpecifiers(sourceText);
  const resolved = imports
    .map((specifier) => resolveImportPath(capturePath, specifier))
    .filter(Boolean);

  assert.deepEqual(
    resolved.filter((entry) => entry === 'src/shared/xiaohongshu-risk.mjs'),
    [],
    'capture stage should not import concrete Xiaohongshu URL/risk helpers directly',
  );
  assert.match(
    sourceText,
    /resolveSiteAdapter/u,
    'capture stage should resolve Xiaohongshu identity through the SiteAdapter registry',
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
    return !resolved.startsWith('src/entrypoints/')
      && !resolved.startsWith('src/infra/cli/')
      && !resolved.startsWith('tools/');
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
    || entry.startsWith('src/sites/xiaohongshu/')
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
