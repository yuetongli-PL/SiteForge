// @ts-check

import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { ensureDir, pathExists, readJsonFile } from '../../../infra/io.mjs';
import { buildWorkspaceArtifactPath } from './workspace.mjs';

const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function comparePath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
  return comparePath(left) === comparePath(right);
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertInside(root, target, label) {
  const resolved = path.resolve(target);
  if (!isInside(root, resolved)) {
    throw new Error(`${label} must stay inside ${root}`);
  }
  return resolved;
}

function assertRelativePath(relativePath, label) {
  const text = String(relativePath ?? '').trim();
  if (!text) {
    throw new Error(`${label} is required`);
  }
  if (path.isAbsolute(text) || /^[A-Za-z]:/u.test(text)) {
    throw new Error(`${label} must be relative`);
  }
  const segments = text.split(/[\\/]+/u);
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`${label} must not contain traversal segments`);
  }
  return path.join(...segments);
}

function assertSafeSegment(value, label) {
  const segment = String(value ?? '').trim();
  if (!SAFE_SEGMENT_PATTERN.test(segment) || segment === '.' || segment === '..') {
    throw new Error(`${label} must be a safe path segment`);
  }
  return segment;
}

async function atomicWriteText(filePath, value) {
  const resolvedPath = path.resolve(filePath);
  await ensureDir(path.dirname(resolvedPath));
  const tempPath = path.join(
    path.dirname(resolvedPath),
    `.${path.basename(resolvedPath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(tempPath, `${String(value).trimEnd()}\n`, 'utf8');
    await rename(tempPath, resolvedPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function atomicWriteJson(filePath, payload) {
  await atomicWriteText(filePath, JSON.stringify(payload, null, 2));
}

function validateContext(context) {
  const cwd = path.resolve(context?.cwd ?? process.cwd());
  const siteId = assertSafeSegment(context?.site?.id ?? context?.siteId, 'siteId');
  const buildId = assertSafeSegment(context?.buildId, 'buildId');
  const expectedSiteDir = path.join(cwd, '.siteforge', 'sites', siteId);
  const expectedBuildDir = path.join(expectedSiteDir, 'builds', buildId);
  const siteDir = path.resolve(context?.workspace?.paths?.siteDir ?? '');
  const buildDir = path.resolve(context?.workspace?.paths?.buildDir ?? '');
  if (!siteDir || !buildDir) {
    throw new Error('SiteForge workspace paths are required');
  }
  if (!samePath(siteDir, expectedSiteDir)) {
    throw new Error('Site workspace must match .siteforge/sites/<site_id>');
  }
  if (!samePath(buildDir, expectedBuildDir)) {
    throw new Error('Build workspace must match .siteforge/sites/<site_id>/builds/<build_id>');
  }
  if (!context?.artifactDir || !samePath(context.artifactDir, buildDir)) {
    throw new Error('artifactDir must match the isolated SiteForge build workspace');
  }
  return {
    siteDir,
    buildDir,
    buildSkillDir: path.resolve(context.workspace.paths.buildSkillDir ?? path.join(buildDir, 'skill')),
    currentDir: path.resolve(context.workspace.paths.currentDir ?? path.join(siteDir, 'current')),
  };
}

function yamlScalar(value) {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  const text = String(value);
  return /^[A-Za-z0-9_./:@ -]+$/u.test(text) ? text : JSON.stringify(text);
}

function toYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return value.map((item) => (
      item && typeof item === 'object'
        ? `${pad}- ${toYaml(item, indent + 2).trimStart()}`
        : `${pad}- ${yamlScalar(item)}`
    )).join('\n');
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    return entries.map(([key, item]) => {
      if (item && typeof item === 'object') {
        return `${pad}${key}:\n${toYaml(item, indent + 2)}`;
      }
      return `${pad}${key}: ${yamlScalar(item)}`;
    }).join('\n');
  }
  return `${pad}${yamlScalar(value)}`;
}

function resolveArtifact(context, relativePath) {
  const { buildDir } = validateContext(context);
  return assertInside(buildDir, path.join(buildDir, assertRelativePath(relativePath, 'artifactPath')), 'artifactPath');
}

function resolveSkill(context, relativePath) {
  const { buildSkillDir, currentDir, siteDir } = validateContext(context);
  const skillDir = path.resolve(context.skillDir ?? buildSkillDir);
  if (!samePath(skillDir, buildSkillDir) && !samePath(skillDir, currentDir) && !isInside(siteDir, skillDir)) {
    throw new Error('skillDir must stay inside the SiteForge site workspace');
  }
  return assertInside(skillDir, path.join(skillDir, assertRelativePath(relativePath, 'skillArtifactPath')), 'skillArtifactPath');
}

export async function writeArtifactJson(context, fileName, payload) {
  const artifactPath = resolveArtifact(context, fileName);
  await atomicWriteJson(artifactPath, payload);
  const workspacePath = buildWorkspaceArtifactPath(context, fileName);
  if (workspacePath && !samePath(workspacePath, artifactPath)) {
    await atomicWriteJson(assertInside(validateContext(context).buildDir, workspacePath, 'workspaceArtifactPath'), payload);
  }
  return artifactPath;
}

export async function writeArtifactText(context, fileName, payload) {
  const artifactPath = resolveArtifact(context, fileName);
  await atomicWriteText(artifactPath, payload);
  const workspacePath = buildWorkspaceArtifactPath(context, fileName);
  if (workspacePath && !samePath(workspacePath, artifactPath)) {
    await atomicWriteText(assertInside(validateContext(context).buildDir, workspacePath, 'workspaceArtifactPath'), payload);
  }
  return artifactPath;
}

export async function writeArtifactYaml(context, fileName, payload) {
  const artifactPath = resolveArtifact(context, fileName);
  await atomicWriteText(artifactPath, toYaml(payload));
  return artifactPath;
}

export async function readArtifactJson(context, fileName, fallback = undefined) {
  const artifactPath = resolveArtifact(context, fileName);
  return await pathExists(artifactPath) ? await readJsonFile(artifactPath) : fallback;
}

export async function readArtifactYaml(context, fileName, fallback = undefined) {
  const artifactPath = resolveArtifact(context, fileName);
  if (!await pathExists(artifactPath)) {
    return fallback;
  }
  return await readFile(artifactPath, 'utf8');
}

export async function writeSkillJson(context, relativePath, payload) {
  const skillPath = resolveSkill(context, relativePath);
  await atomicWriteJson(skillPath, payload);
  return skillPath;
}

export async function writeSkillText(context, relativePath, payload) {
  const skillPath = resolveSkill(context, relativePath);
  await atomicWriteText(skillPath, payload);
  return skillPath;
}

export async function writeGeneratedJson(contextOrFilePath, filePathOrPayload, maybePayload) {
  if (typeof contextOrFilePath === 'string') {
    throw new Error('writeGeneratedJson requires a SiteForge build context');
  }
  const { siteDir } = validateContext(contextOrFilePath);
  const filePath = assertInside(siteDir, filePathOrPayload, 'generatedPath');
  await atomicWriteJson(filePath, maybePayload);
  return filePath;
}

export async function readJsonIfExists(filePath, fallback) {
  return await pathExists(filePath) ? await readJsonFile(filePath) : fallback;
}

export async function ensureBuildDirectories(context) {
  const { buildDir, buildSkillDir } = validateContext(context);
  await ensureDir(buildDir);
  await ensureDir(buildSkillDir);
}
