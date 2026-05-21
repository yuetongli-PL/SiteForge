// @ts-check

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { initializeCliUtf8, writeJsonStdout } from '../../infra/cli.mjs';
import { readCliValue as readValue } from '../../infra/cli/internal-options.mjs';
import { prepareRedactedArtifactJsonWithAudit } from '../../domain/sessions/security-guard.mjs';
import { runSiteCapabilityCompile } from './site-capability-compile.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'runs', 'preview', 'site-recompile-summary');

const HELP = `Usage:
  node src/entrypoints/sites/site-recompile-preview-summary.mjs [--out-dir <dir>] [--json]

Build a descriptor-only recompile preview summary for repo-local skills. This
does not open websites, run captures, generate skills, overwrite repo skills,
invoke downloader, or materialize browser/session state.
`;

export function parseArgs(argv = []) {
  const options = {
    outDir: DEFAULT_OUT_DIR,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--out-dir': {
        const read = readValue(argv, index, arg);
        options.outDir = read.value;
        index = read.nextIndex;
        break;
      }
      case '--json':
        options.json = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeRepoPath(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/^\.?\//u, '');
}

function sanitizeSegment(value) {
  return String(value ?? 'unknown')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readRepoLocalSkillSites(cwd) {
  const registry = await readJson(path.join(cwd, 'config', 'site-registry.json'));
  const sites = [];
  for (const [host, record] of Object.entries(registry.sites ?? {})) {
    const repoSkillDir = normalizeRepoPath(record?.repoSkillDir);
    if (!repoSkillDir || !repoSkillDir.startsWith('skills/')) {
      continue;
    }
    const skillPath = path.join(cwd, repoSkillDir, 'SKILL.md');
    if (!await pathExists(skillPath)) {
      sites.push({
        host,
        siteKey: record?.siteKey ?? host,
        repoSkillDir,
        missingSkill: true,
      });
      continue;
    }
    sites.push({
      host,
      siteKey: record?.siteKey ?? host,
      repoSkillDir,
      missingSkill: false,
    });
  }
  return sites.sort((left, right) => String(left.siteKey).localeCompare(String(right.siteKey), 'en'));
}

function statusFromCompileResult(result) {
  if (result?.planStatus === 'blocked' || result?.plannerHandoffReady === false) {
    return 'blocked';
  }
  if (result?.graphValidationResult === 'passed' && result?.planStatus === 'ready') {
    return 'ready';
  }
  return 'partial';
}

function summarizeCompileResult(site, result) {
  const status = statusFromCompileResult(result);
  const fallbackReasonCode = status === 'blocked'
    ? 'site-recompile-plan-blocked'
    : status === 'partial'
      ? 'site-recompile-partial'
      : 'site-recompile-ready';
  return {
    siteKey: result.siteKey ?? site.siteKey,
    host: site.host,
    repoSkillDir: site.repoSkillDir,
    status,
    reasonCode: result.reasonCode ?? fallbackReasonCode,
    graphValidationResult: result.graphValidationResult ?? null,
    planStatus: result.planStatus ?? null,
    plannerHandoffReady: result.plannerHandoffReady === true,
    layerRuntimeConsumerReady: result.layerRuntimeConsumerReady === true,
    capabilityCount: result.capabilityCount ?? 0,
    routeCount: result.routeCount ?? 0,
    executionPathCount: result.executionPathCount ?? 0,
    artifacts: result.artifactWrite
      ? {
        outDir: result.artifactWrite.outDir ?? null,
        artifactRefs: result.artifactWrite.artifactRefs ?? [],
        auditRefs: result.artifactWrite.auditRefs ?? [],
      }
      : null,
    boundaries: {
      descriptorOnly: result.descriptorOnly === true,
      liveCaptureAttempted: result.liveCaptureAttempted === true,
      runtimeTaskExecuted: result.executionAttempted === true,
      directDownloader: result.downloaderInvocationAllowed === true,
      directSiteAdapter: result.siteAdapterInvocationAllowed === true,
      authStateCreated: result.sessionMaterializationAllowed === true,
    },
  };
}

function summarizeCompileFailure(site, error) {
  return {
    siteKey: site.siteKey,
    host: site.host,
    repoSkillDir: site.repoSkillDir,
    status: site.missingSkill ? 'blocked' : 'failed',
    reasonCode: site.missingSkill ? 'repo-local-skill-missing' : error?.code ?? 'site-recompile-compile-failed',
    graphValidationResult: null,
    planStatus: null,
    plannerHandoffReady: false,
    layerRuntimeConsumerReady: false,
    capabilityCount: 0,
    routeCount: 0,
    executionPathCount: 0,
    artifacts: null,
    boundaries: {
      descriptorOnly: true,
      liveCaptureAttempted: false,
      runtimeTaskExecuted: false,
      directDownloader: false,
      directSiteAdapter: false,
      authStateCreated: false,
    },
  };
}

function buildSummary({ generatedAt, outDir, entries }) {
  const counts = entries.reduce((accumulator, entry) => {
    accumulator[entry.status] = (accumulator[entry.status] ?? 0) + 1;
    return accumulator;
  }, {});
  return {
    schemaVersion: 1,
    artifactFamily: 'site-recompile-preview-summary',
    generatedAt,
    outDir,
    summary: {
      totalSites: entries.length,
      ready: counts.ready ?? 0,
      blocked: counts.blocked ?? 0,
      partial: counts.partial ?? 0,
      failed: counts.failed ?? 0,
    },
    sites: entries,
    safety: {
      descriptorOnly: true,
      liveCaptureAttempted: false,
      browserStateAccessed: false,
      authStateCreated: false,
      downloaderInvoked: false,
      siteAdapterRuntimeInvoked: false,
      repoSkillsOverwritten: false,
      repoConfigUpdated: false,
      redactionRequired: true,
    },
    nextStep: 'Run per-site KB/skill previews in separate batches for ready sites; keep blocked sites blocked without login, CAPTCHA, risk-control, or permission bypass.',
    redactionRequired: true,
  };
}

async function writeSummaryArtifact(summary, outDir) {
  await mkdir(outDir, { recursive: true });
  const prepared = prepareRedactedArtifactJsonWithAudit(summary);
  const artifactPath = path.join(outDir, 'site-recompile-preview-summary.json');
  const auditPath = path.join(outDir, 'site-recompile-preview-summary.audit.json');
  await writeFile(artifactPath, prepared.json, 'utf8');
  await writeFile(auditPath, prepared.auditJson, 'utf8');
  return {
    artifactPath,
    auditPath,
  };
}

export async function runSiteRecompilePreviewSummary(options = {}, deps = {}) {
  const cwd = path.resolve(deps.cwd ?? process.cwd());
  const outDir = path.resolve(cwd, options.outDir ?? DEFAULT_OUT_DIR);
  const compileSite = deps.runSiteCapabilityCompile ?? runSiteCapabilityCompile;
  const generatedAt = new Date().toISOString();
  const sites = await readRepoLocalSkillSites(cwd);
  const entries = [];

  for (const site of sites) {
    if (site.missingSkill) {
      entries.push(summarizeCompileFailure(site, null));
      continue;
    }
    try {
      const compileOutDir = path.join(outDir, 'compile', sanitizeSegment(site.siteKey));
      const result = await compileSite({
        site: site.siteKey,
        writeArtifacts: true,
        outDir: compileOutDir,
      });
      entries.push(summarizeCompileResult(site, result));
    } catch (error) {
      entries.push(summarizeCompileFailure(site, error));
    }
  }

  const summary = buildSummary({ generatedAt, outDir, entries });
  const artifactWrite = await writeSummaryArtifact(summary, outDir);
  return {
    ...summary,
    artifactWrite,
  };
}

async function main() {
  initializeCliUtf8();
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  const result = await runSiteRecompilePreviewSummary(options);
  if (options.json) {
    writeJsonStdout(result);
    return;
  }
  process.stdout.write(`Site recompile preview summary: ready=${result.summary.ready} blocked=${result.summary.blocked} partial=${result.summary.partial} failed=${result.summary.failed}\n`);
  process.stdout.write(`Artifact: ${result.artifactWrite.artifactPath}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
