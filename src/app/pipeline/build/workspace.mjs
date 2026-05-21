// @ts-check

import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { cp, rename, rm, writeFile } from 'node:fs/promises';
import { ensureDir, pathExists, readJsonFile } from '../../../infra/io.mjs';

export const SITEFORGE_WORKSPACE_SCHEMA_VERSION = 1;

export const BUILD_WORKSPACE_DIRS = Object.freeze([
  'inputs',
  'discovery',
  'graph',
  'capabilities',
  'intents',
  'skill',
  'verification',
  'reports',
  'logs',
]);

const SETUP_FILE_DEFAULTS = Object.freeze({
  'setup_plan.json': (siteId, nowIso) => ({
    schemaVersion: SITEFORGE_WORKSPACE_SCHEMA_VERSION,
    siteId,
    updatedAt: nowIso,
    status: 'not_started',
    steps: [],
  }),
  'user_choices.json': (siteId, nowIso) => ({
    schemaVersion: SITEFORGE_WORKSPACE_SCHEMA_VERSION,
    siteId,
    updatedAt: nowIso,
    choices: {},
  }),
  'capability_hints.json': (siteId, nowIso) => ({
    schemaVersion: SITEFORGE_WORKSPACE_SCHEMA_VERSION,
    siteId,
    updatedAt: nowIso,
    hints: [],
  }),
  'build_profile.json': (siteId, nowIso) => ({
    schemaVersion: SITEFORGE_WORKSPACE_SCHEMA_VERSION,
    siteId,
    updatedAt: nowIso,
    profile: {},
  }),
});

const BUILD_ARTIFACT_DIR_BY_NAME = Object.freeze({
  'site.json': 'inputs',
  'generated_adapter.json': 'inputs',
  'adapter_contract_tests.json': 'inputs',
  'safety_policy.json': 'capabilities',
  'seeds.json': 'discovery',
  'crawl_static.json': 'discovery',
  'crawl_checkpoint.json': 'discovery',
  'crawl_rendered.json': 'discovery',
  'interactions.json': 'discovery',
  'network_traces.json': 'discovery',
  'graph.json': 'graph',
  'classified_graph.json': 'graph',
  'affordances.json': 'capabilities',
  'capabilities.json': 'capabilities',
  'execution_plans.json': 'capabilities',
  'intents.json': 'intents',
  'skill.yaml': 'skill',
  'verification_report.json': 'verification',
  'registry_report.json': 'reports',
  'build_report.user.json': 'reports',
  'build_report.user.md': 'reports',
  'build_report.debug.json': 'reports',
  'build_report.json': 'reports',
});

const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function comparePath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
  return comparePath(left) === comparePath(right);
}

function isPathInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertInside(root, target, label) {
  if (!isPathInside(root, target)) {
    throw new Error(`${label} must stay inside ${root}`);
  }
  return path.resolve(target);
}

function assertSafeSegment(value, label) {
  const segment = String(value ?? '').trim();
  if (!SAFE_SEGMENT_PATTERN.test(segment) || segment === '.' || segment === '..') {
    throw new Error(`${label} must be a safe path segment`);
  }
  return segment;
}

async function atomicWriteJson(filePath, payload) {
  const resolvedPath = path.resolve(filePath);
  await ensureDir(path.dirname(resolvedPath));
  const tempPath = path.join(
    path.dirname(resolvedPath),
    `.${path.basename(resolvedPath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await rename(tempPath, resolvedPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

export const CURRENT_PROMOTION_FILES = Object.freeze([
  'generated_adapter.json',
  'adapter_contract_tests.json',
  'skill.yaml',
  'capabilities.json',
  'intents.json',
  'execution_plans.json',
  'safety_policy.json',
  'verification_report.json',
]);

function relativeToCwd(cwd, value) {
  return path.relative(cwd, value).replace(/\\/gu, '/') || '.';
}

async function writeJsonIfMissing(filePath, payload) {
  if (await pathExists(filePath)) {
    return false;
  }
  await atomicWriteJson(filePath, payload);
  return true;
}

export function siteForgeWorkspaceRoot({ cwd = process.cwd(), workspaceRoot } = /** @type {any} */ ({})) {
  const expectedRoot = path.resolve(cwd, '.siteforge');
  const resolvedRoot = workspaceRoot === undefined || workspaceRoot === null
    ? expectedRoot
    : path.resolve(cwd, workspaceRoot);
  if (!samePath(resolvedRoot, expectedRoot)) {
    throw new Error('workspaceRoot must resolve to .siteforge');
  }
  return expectedRoot;
}

export function siteForgeSiteDir({ cwd = process.cwd(), workspaceRoot, siteId } = /** @type {any} */ ({})) {
  const safeSiteId = assertSafeSegment(siteId, 'siteId');
  return path.join(siteForgeWorkspaceRoot({ cwd, workspaceRoot }), 'sites', safeSiteId);
}

export function siteForgeBuildDir({ cwd = process.cwd(), workspaceRoot, siteId, buildId } = /** @type {any} */ ({})) {
  const safeBuildId = assertSafeSegment(buildId, 'buildId');
  return path.join(siteForgeSiteDir({ cwd, workspaceRoot, siteId }), 'builds', safeBuildId);
}

export function createSiteWorkspacePaths({
  cwd = process.cwd(),
  workspaceRoot,
  siteId,
  buildId,
} = /** @type {any} */ ({})) {
  const rootDir = siteForgeWorkspaceRoot({ cwd, workspaceRoot });
  const siteDir = siteForgeSiteDir({ cwd, workspaceRoot, siteId });
  const setupDir = path.join(siteDir, 'setup');
  const adapterDir = path.join(siteDir, 'adapter');
  const buildsDir = path.join(siteDir, 'builds');
  const buildDir = siteForgeBuildDir({ cwd, workspaceRoot, siteId, buildId });
  const currentDir = path.join(siteDir, 'current');
  const buildDirs = Object.fromEntries(
    BUILD_WORKSPACE_DIRS.map((name) => [name, path.join(buildDir, name)]),
  );
  return {
    rootDir,
    siteDir,
    setupDir,
    adapterDir,
    buildsDir,
    buildDir,
    currentDir,
    registryPath: path.join(siteDir, 'registry.json'),
    lastSuccessfulBuildPath: path.join(siteDir, 'last_successful_build.json'),
    siteRecordPath: path.join(siteDir, 'site.json'),
    setupFiles: Object.fromEntries(
      Object.keys(SETUP_FILE_DEFAULTS).map((name) => [name, path.join(setupDir, name)]),
    ),
    buildDirs,
    buildSkillDir: buildDirs.skill,
  };
}

export function createSiteWorkspace({ cwd, workspaceRoot, site, buildId, startedAt } = /** @type {any} */ ({})) {
  const paths = createSiteWorkspacePaths({
    cwd,
    workspaceRoot,
    siteId: site?.id,
    buildId,
  });
  return {
    schemaVersion: SITEFORGE_WORKSPACE_SCHEMA_VERSION,
    siteId: site?.id,
    buildId,
    startedAt,
    paths,
  };
}

export async function ensureSiteWorkspace(workspace, site, { nowIso = new Date().toISOString() } = /** @type {any} */ ({})) {
  const { paths, siteId } = workspace;
  await ensureDir(paths.siteDir);
  await ensureDir(paths.setupDir);
  await ensureDir(paths.adapterDir);
  await ensureDir(paths.buildsDir);
  await ensureDir(paths.currentDir);
  await ensureDir(paths.buildDir);
  for (const dirPath of Object.values(paths.buildDirs)) {
    await ensureDir(dirPath);
  }

  await atomicWriteJson(paths.siteRecordPath, {
    ...site,
    workspace: {
      schemaVersion: SITEFORGE_WORKSPACE_SCHEMA_VERSION,
      siteDir: relativeToCwd(path.dirname(paths.siteDir), paths.siteDir),
      setupDir: 'setup',
      adapterDir: 'adapter',
      buildsDir: 'builds',
      currentDir: 'current',
      registry: 'registry.json',
      lastSuccessfulBuild: 'last_successful_build.json',
    },
  });

  for (const [name, buildDefault] of Object.entries(SETUP_FILE_DEFAULTS)) {
    await writeJsonIfMissing(paths.setupFiles[name], buildDefault(siteId, nowIso));
  }
  await writeJsonIfMissing(paths.registryPath, {
    schemaVersion: 1,
    generatedAt: nowIso,
    skills: [],
  });
  await writeJsonIfMissing(paths.lastSuccessfulBuildPath, {
    schemaVersion: SITEFORGE_WORKSPACE_SCHEMA_VERSION,
    siteId,
    status: 'none',
    buildId: null,
    promotedAt: null,
  });
}

export function buildWorkspaceArtifactPath(context, fileName) {
  const dirName = BUILD_ARTIFACT_DIR_BY_NAME[fileName];
  if (!dirName || !context?.workspace?.paths?.buildDirs?.[dirName]) {
    return null;
  }
  return path.join(context.workspace.paths.buildDirs[dirName], fileName);
}

export function activeSkillRegistryPath(context) {
  return path.join(context.workspace.paths.siteDir, 'registry.json');
}

export async function readLastSuccessfulBuild(workspace) {
  if (!await pathExists(workspace.paths.lastSuccessfulBuildPath)) {
    return null;
  }
  return await readJsonFile(workspace.paths.lastSuccessfulBuildPath);
}

export async function promoteVerifiedBuild(context, stageResults) {
  const { paths } = context.workspace;
  const siteDir = siteForgeSiteDir({
    cwd: context.cwd,
    workspaceRoot: context.workspace.paths.rootDir,
    siteId: context.site.id,
  });
  const buildDir = siteForgeBuildDir({
    cwd: context.cwd,
    workspaceRoot: context.workspace.paths.rootDir,
    siteId: context.site.id,
    buildId: context.buildId,
  });
  if (!samePath(paths.siteDir, siteDir) || !samePath(paths.buildDir, buildDir)) {
    throw new Error('SiteForge workspace paths do not match the active build context');
  }
  const tempCurrentDir = path.join(paths.siteDir, `.current-${context.buildId}.tmp`);
  assertInside(paths.siteDir, tempCurrentDir, 'tempCurrentDir');
  assertInside(paths.siteDir, paths.currentDir, 'currentDir');
  await rm(tempCurrentDir, { recursive: true, force: true });
  await ensureDir(tempCurrentDir);

  const generatedSkill = stageResults.generateSkill;
  if (generatedSkill?.skillDir) {
    assertInside(paths.buildSkillDir, generatedSkill.skillDir, 'generatedSkill.skillDir');
    await cp(generatedSkill.skillDir, tempCurrentDir, { recursive: true });
  }
  for (const fileName of CURRENT_PROMOTION_FILES) {
    const sourcePath = path.join(context.artifactDir, fileName);
    assertInside(paths.buildDir, sourcePath, `promotion source ${fileName}`);
    if (await pathExists(sourcePath)) {
      const targetPath = assertInside(tempCurrentDir, path.join(tempCurrentDir, fileName), `promotion target ${fileName}`);
      await cp(sourcePath, targetPath);
    }
  }

  const backupCurrentDir = path.join(paths.siteDir, `.current-${context.buildId}.backup`);
  assertInside(paths.siteDir, backupCurrentDir, 'backupCurrentDir');
  await rm(backupCurrentDir, { recursive: true, force: true });

  let backupCreated = false;
  try {
    if (await pathExists(paths.currentDir)) {
      await rename(paths.currentDir, backupCurrentDir);
      backupCreated = true;
    }
    await rename(tempCurrentDir, paths.currentDir);
    await rm(backupCurrentDir, { recursive: true, force: true }).catch(() => {});
  } catch (error) {
    await rm(paths.currentDir, { recursive: true, force: true }).catch(() => {});
    if (backupCreated && await pathExists(backupCurrentDir)) {
      try {
        await rename(backupCurrentDir, paths.currentDir);
      } catch (restoreError) {
        error.restoreError = restoreError?.message ?? String(restoreError);
      }
    }
    throw error;
  } finally {
    await rm(tempCurrentDir, { recursive: true, force: true }).catch(() => {});
  }

  const promotedAt = new Date().toISOString();
  const lastSuccessfulBuild = {
    schemaVersion: SITEFORGE_WORKSPACE_SCHEMA_VERSION,
    siteId: context.site.id,
    skillId: context.skillId,
    status: 'success',
    buildId: context.buildId,
    promotedAt,
    buildDir: relativeToCwd(context.cwd, paths.buildDir),
    currentDir: relativeToCwd(context.cwd, paths.currentDir),
    activeSkillDir: relativeToCwd(context.cwd, paths.currentDir),
    registryPath: relativeToCwd(context.cwd, context.registryPath ?? paths.registryPath),
    verificationReport: relativeToCwd(context.cwd, path.join(paths.currentDir, 'verification_report.json')),
  };
  return {
    currentDir: paths.currentDir,
    activeSkillDir: paths.currentDir,
    lastSuccessfulBuild,
    promotedFiles: CURRENT_PROMOTION_FILES,
  };
}

export async function writeLastSuccessfulBuild(workspace, lastSuccessfulBuild) {
  assertInside(workspace.paths.siteDir, workspace.paths.lastSuccessfulBuildPath, 'lastSuccessfulBuildPath');
  await atomicWriteJson(workspace.paths.lastSuccessfulBuildPath, lastSuccessfulBuild);
  return workspace.paths.lastSuccessfulBuildPath;
}
