// @ts-check

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');
const DEFAULT_RUNS_ROOT = path.join(REPO_ROOT, 'runs');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'runs', 'social-live-report');

const HELP = `Usage:
  node scripts/social-live-report.mjs [--runs-root <dir>] [--out-dir <dir>] [options]

Aggregates the latest X/Instagram live manifests into JSON and Markdown.

Options:
  --runs-root <dir>                 Root to scan. Default: runs.
  --out-dir <dir>                   Report output dir. Default: runs/social-live-report.
  --site <x|instagram|all>          Site filter. Default: all.
  --limit <n>                       Max manifests per site. Default: 10.
  --no-write                        Print report JSON without writing files.
  -h, --help                        Show this help.
`;

function readValue(argv, index, flag) {
  if (index + 1 >= argv.length) throw new Error(`Missing value for ${flag}`);
  return { value: argv[index + 1], nextIndex: index + 1 };
}

export function parseArgs(argv) {
  const options = {
    runsRoot: DEFAULT_RUNS_ROOT,
    outDir: DEFAULT_OUT_DIR,
    site: 'all',
    limit: '10',
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
      case '--runs-root':
      case '--out-dir':
      case '--site':
      case '--limit': {
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
  if (!['x', 'instagram', 'all'].includes(String(options.site))) throw new Error(`Invalid --site: ${options.site}`);
  const limit = Number(options.limit);
  if (!Number.isFinite(limit) || limit < 1) throw new Error(`Invalid --limit: ${options.limit}`);
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
        const info = await stat(full);
        files.push({ path: full, mtimeMs: info.mtimeMs });
      }
    }
  }
  await walk(resolved);
  files.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return files;
}

async function readJson(filePath) {
  return JSON.parse((await readFile(filePath, 'utf8')).replace(/^\uFEFF/u, ''));
}

function normalizeSite(value) {
  const text = String(value ?? '').toLowerCase();
  if (text === 'twitter') return 'x';
  if (text === 'ig') return 'instagram';
  return text;
}

function resultRowsFromManifest(manifest, manifestPath, mtimeMs) {
  const rows = [];
  if (Array.isArray(manifest?.results)) {
    for (const result of manifest.results) {
      rows.push({
        site: normalizeSite(result.site ?? manifest?.options?.site),
        id: result.id ?? manifest.runId ?? path.basename(path.dirname(manifestPath)),
        category: result.category ?? null,
        status: result.artifactSummary?.verdict ?? result.status ?? manifest.status ?? 'unknown',
        reason: result.artifactSummary?.reason ?? result.reason ?? null,
        commandStatus: result.status ?? null,
        manifestPath,
        artifactManifestPath: result.artifactSummary?.manifestPath ?? null,
        runId: manifest.runId ?? null,
        finishedAt: result.finishedAt ?? manifest.finishedAt ?? manifest.startedAt ?? new Date(mtimeMs).toISOString(),
      });
    }
  } else {
    rows.push({
      site: normalizeSite(manifest?.site ?? manifest?.options?.site),
      id: manifest?.id ?? manifest?.runId ?? path.basename(path.dirname(manifestPath)),
      category: manifest?.category ?? null,
      status: manifest?.outcome?.status ?? manifest?.status ?? 'unknown',
      reason: manifest?.outcome?.reason ?? manifest?.reason ?? manifest?.archive?.reason ?? null,
      commandStatus: null,
      manifestPath,
      artifactManifestPath: manifestPath,
      runId: manifest?.runId ?? null,
      finishedAt: manifest?.finishedAt ?? manifest?.startedAt ?? new Date(mtimeMs).toISOString(),
    });
  }
  return rows;
}

function summarize(rows) {
  const bySite = {};
  for (const row of rows) {
    const site = row.site || 'unknown';
    bySite[site] ??= { total: 0, statuses: {}, latestFinishedAt: null };
    bySite[site].total += 1;
    bySite[site].statuses[row.status] = (bySite[site].statuses[row.status] ?? 0) + 1;
    if (!bySite[site].latestFinishedAt || String(row.finishedAt) > bySite[site].latestFinishedAt) {
      bySite[site].latestFinishedAt = row.finishedAt;
    }
  }
  return bySite;
}

export async function buildReport(options) {
  const files = await findManifestFiles(options.runsRoot);
  const rows = [];
  for (const file of files) {
    try {
      rows.push(...resultRowsFromManifest(await readJson(file.path), file.path, file.mtimeMs));
    } catch {
      // Skip malformed or unrelated manifests.
    }
  }
  const siteFiltered = rows
    .filter((row) => row.site === 'x' || row.site === 'instagram')
    .filter((row) => options.site === 'all' || row.site === options.site);
  const limited = [];
  for (const site of ['x', 'instagram']) {
    if (options.site !== 'all' && options.site !== site) continue;
    limited.push(...siteFiltered.filter((row) => row.site === site).slice(0, Number(options.limit)));
  }
  return {
    generatedAt: new Date().toISOString(),
    runsRoot: path.resolve(options.runsRoot),
    totalRows: limited.length,
    summary: summarize(limited),
    rows: limited,
  };
}

function markdownReport(report) {
  const lines = ['# Social Live Matrix Report', '', `Generated: ${report.generatedAt}`, '', '## Summary', ''];
  for (const [site, summary] of Object.entries(report.summary)) {
    lines.push(`- ${site}: ${summary.total} row(s), latest ${summary.latestFinishedAt}, statuses ${JSON.stringify(summary.statuses)}`);
  }
  lines.push('', '## Rows', '', '| Site | Case | Status | Reason | Finished | Manifest |', '| --- | --- | --- | --- | --- | --- |');
  for (const row of report.rows) {
    lines.push(`| ${row.site} | ${row.id} | ${row.status} | ${row.reason ?? ''} | ${row.finishedAt ?? ''} | ${row.manifestPath} |`);
  }
  lines.push('');
  return lines.join('\n');
}

export async function writeReport(options, report) {
  if (!options.write) return null;
  await mkdir(path.resolve(options.outDir), { recursive: true });
  const jsonPath = path.join(path.resolve(options.outDir), 'social-live-report.json');
  const markdownPath = path.join(path.resolve(options.outDir), 'social-live-report.md');
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, markdownReport(report), 'utf8');
  return { jsonPath, markdownPath };
}

export async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const report = await buildReport(options);
  const outputs = await writeReport(options, report);
  if (outputs) {
    process.stdout.write(`JSON: ${outputs.jsonPath}\nMarkdown: ${outputs.markdownPath}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
