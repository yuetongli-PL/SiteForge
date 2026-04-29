// @ts-check

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateAuthenticatedSessionReleaseGate } from '../src/sites/sessions/release-gate.mjs';
import { buildSessionRepairPlanCommand } from '../src/sites/sessions/repair-command.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');
const DEFAULT_RUNS_ROOT = path.join(REPO_ROOT, 'runs');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'runs', 'download-release-audit');

export const HELP = `Usage:
  node scripts/download-release-audit.mjs [--manifest <path> ...] [--runs-root <dir>] [--out-dir <dir>] [--no-write]

Audits existing download/social manifests for session traceability. This is read-only
and never logs in, downloads, or runs live smoke.

Options:
  --manifest <path>                 Manifest to audit. Can be repeated.
  --runs-root <dir>                 Recursively scan for manifest.json. Default: runs.
  --out-dir <dir>                   Report output dir. Default: runs/download-release-audit.
  --no-write                        Print JSON without writing report files.
  -h, --help                        Show this help.
`;

function readValue(argv, index, flag) {
  if (index + 1 >= argv.length) throw new Error(`Missing value for ${flag}`);
  return { value: argv[index + 1], nextIndex: index + 1 };
}

export function parseArgs(argv = []) {
  const options = {
    manifests: [],
    runsRoot: DEFAULT_RUNS_ROOT,
    outDir: DEFAULT_OUT_DIR,
    write: true,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--no-write':
        options.write = false;
        break;
      case '--manifest': {
        const { value, nextIndex } = readValue(argv, index, token);
        options.manifests.push(value);
        index = nextIndex;
        break;
      }
      case '--runs-root':
      case '--out-dir': {
        const { value, nextIndex } = readValue(argv, index, token);
        const key = token.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
        options[key] = value;
        index = nextIndex;
        break;
      }
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }
  return options;
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findManifestFiles(root) {
  const resolved = path.resolve(root);
  if (!await pathExists(resolved)) return [];
  const files = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name === 'manifest.json') {
        files.push(full);
      }
    }
  }
  await walk(resolved);
  return files.sort();
}

async function readJson(filePath) {
  return JSON.parse((await readFile(filePath, 'utf8')).replace(/^\uFEFF/u, ''));
}

function normalizeSite(value, fallback = 'unknown') {
  const site = String(value ?? fallback).trim().toLowerCase();
  return site === 'twitter' ? 'x' : site || fallback;
}

function requiresAuth(manifest = {}) {
  return manifest.authHealth?.required === true
    || manifest.liveValidation?.authenticated === true
    || manifest.plan?.sessionRequirement === 'required'
    || manifest.session?.mode === 'authenticated';
}

function gateFromArtifactSummary(summary = {}) {
  if (summary.sessionGate && typeof summary.sessionGate === 'object' && !Array.isArray(summary.sessionGate)) {
    return {
      ok: summary.sessionGate.ok === true,
      status: summary.sessionGate.status ?? 'unknown',
      reason: summary.sessionGate.reason ?? null,
      requiresAuth: true,
      provider: summary.sessionGate.provider ?? summary.sessionProvider ?? null,
      healthManifest: summary.sessionGate.healthManifest ?? summary.sessionHealth?.manifestPath ?? null,
    };
  }
  return evaluateAuthenticatedSessionReleaseGate({
    authHealth: summary.authHealth,
    sessionProvider: summary.sessionProvider,
    sessionHealth: summary.sessionHealth,
  }, {
    requiresAuth: summary.authHealth?.required === true || Boolean(summary.sessionProvider || summary.sessionHealth),
  });
}

function auditRowsFromManifest(manifest = {}, manifestPath) {
  if (Array.isArray(manifest.results)) {
    return manifest.results.map((result) => {
      const gate = gateFromArtifactSummary(result.artifactSummary ?? {});
      return {
        manifestPath,
        kind: 'social-live-matrix',
        id: result.id ?? manifest.runId ?? path.basename(path.dirname(manifestPath)),
        site: normalizeSite(result.site ?? manifest.options?.site),
        status: gate.status,
        ok: gate.ok === true,
        reason: gate.reason ?? null,
        provider: gate.provider ?? null,
        healthManifest: gate.healthManifest ?? null,
      };
    });
  }
  const gate = evaluateAuthenticatedSessionReleaseGate(manifest, {
    requiresAuth: requiresAuth(manifest),
  });
  return [{
    manifestPath,
    kind: manifest.session || manifest.liveValidation ? 'download' : 'social-action',
    id: manifest.runId ?? manifest.id ?? path.basename(path.dirname(manifestPath)),
    site: normalizeSite(manifest.siteKey ?? manifest.site ?? manifest.options?.site),
    status: gate.status,
    ok: gate.ok === true,
    reason: gate.reason ?? null,
    provider: gate.provider ?? null,
    healthManifest: gate.healthManifest ?? null,
  }];
}

function summarize(rows = []) {
  const summary = { total: rows.length, statuses: {}, blocked: 0, passed: 0 };
  for (const row of rows) {
    summary.statuses[row.status] = (summary.statuses[row.status] ?? 0) + 1;
    if (row.ok) summary.passed += 1;
    if (row.status === 'blocked') summary.blocked += 1;
  }
  return summary;
}

function auditJsonPath(options = {}) {
  return path.join(path.resolve(options.outDir ?? DEFAULT_OUT_DIR), 'download-release-audit.json');
}

function repairPlanForRow(row = {}, options = {}) {
  if (row.status !== 'blocked' || !row.site || row.site === 'unknown') {
    return null;
  }
  if (options.write === false) {
    return buildSessionRepairPlanCommand({
      site: row.site,
      reason: row.reason ?? 'blocked',
    });
  }
  const manifestPath = auditJsonPath(options);
  return buildSessionRepairPlanCommand({ site: row.site, auditManifest: manifestPath });
}

function addRepairGuidance(rows = [], options = {}) {
  return rows.map((row) => {
    const repairPlan = repairPlanForRow(row, options);
    return repairPlan ? { ...row, repairPlan } : row;
  });
}

export async function buildAudit(options = {}) {
  const explicit = options.manifests?.length
    ? options.manifests.map((entry) => path.resolve(entry))
    : await findManifestFiles(options.runsRoot ?? DEFAULT_RUNS_ROOT);
  const rows = [];
  const skipped = [];
  for (const manifestPath of explicit) {
    try {
      rows.push(...auditRowsFromManifest(await readJson(manifestPath), manifestPath));
    } catch (error) {
      skipped.push({ manifestPath, reason: error?.message ?? String(error) });
    }
  }
  const guidedRows = addRepairGuidance(rows, options);
  return {
    generatedAt: new Date().toISOString(),
    manifests: explicit.length,
    summary: summarize(guidedRows),
    rows: guidedRows,
    skipped,
  };
}

function renderMarkdown(audit = {}) {
  const lines = [
    '# Download Release Audit',
    '',
    `Generated: ${audit.generatedAt}`,
    `Rows: ${audit.summary?.total ?? 0}`,
    `Statuses: ${JSON.stringify(audit.summary?.statuses ?? {})}`,
    '',
    '| Site | ID | Kind | Gate | Reason | Provider | Manifest | Repair Plan |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of audit.rows ?? []) {
    lines.push(`| ${row.site} | ${row.id} | ${row.kind} | ${row.status} | ${row.reason ?? ''} | ${row.provider ?? ''} | ${row.manifestPath} | ${row.repairPlan?.commandText ?? ''} |`);
  }
  if (audit.skipped?.length) {
    lines.push('', '## Skipped');
    for (const skipped of audit.skipped) {
      lines.push(`- ${skipped.manifestPath}: ${skipped.reason}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export async function writeAudit(options = {}, audit = {}) {
  if (!options.write) return null;
  const outDir = path.resolve(options.outDir ?? DEFAULT_OUT_DIR);
  await mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'download-release-audit.json');
  const markdownPath = path.join(outDir, 'download-release-audit.md');
  await writeFile(jsonPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, renderMarkdown(audit), 'utf8');
  return { jsonPath, markdownPath };
}
