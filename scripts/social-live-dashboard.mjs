// @ts-check

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  buildReport,
  parseArgs as parseReportArgs,
} from '../tools/social-live-report-core.mjs';
import { readCliValue as readValue } from '../src/infra/cli/internal-options.mjs';
import { runSingleStageCliWithProgress } from '../src/infra/cli/progress-cli.mjs';
import { escapeHtmlText as htmlEscape } from '../src/shared/html-escape.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');
const DEFAULT_RUNS_ROOT = path.join(REPO_ROOT, 'runs');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'runs', 'social-live-dashboard');

const HELP = `Internal script usage:
  node scripts/social-live-dashboard.mjs [options]

Public command:
  siteforge build <url>

Builds a local HTML dashboard from the social-live-report JSON aggregation.

Options:
  --runs-root <dir>                 Root to scan. Default: runs.
  --out-dir <dir>                   Dashboard output dir. Default: runs/social-live-dashboard.
  --site <x|instagram|all>          Site filter. Default: all.
  --limit <n>                       Max manifests per site. Default: 10.
  --no-write                        Print dashboard HTML without writing files.
  --quiet                           Suppress human progress.
  --progress <auto|interactive|plain>
  --force-tty                       Force interactive progress rendering.
  --no-tty                          Force plain progress rendering.
  -h, --help                        Show this help.
`;

export function parseArgs(argv) {
  const options = {
    runsRoot: DEFAULT_RUNS_ROOT,
    outDir: DEFAULT_OUT_DIR,
    site: 'all',
    limit: '10',
    write: true,
    quiet: false,
    progressMode: undefined,
    forceTty: false,
    noTty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith('--progress=')) {
      options.progressMode = token.slice('--progress='.length);
      continue;
    }
    switch (token) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--no-write':
        options.write = false;
        break;
      case '--quiet':
        options.quiet = true;
        break;
      case '--force-tty':
        options.forceTty = true;
        break;
      case '--no-tty':
        options.noTty = true;
        break;
      case '--progress': {
        const { value, nextIndex } = readValue(argv, index, token);
        options.progressMode = value;
        index = nextIndex;
        break;
      }
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

function slug(value) {
  return String(value ?? 'unknown').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'unknown';
}

function isRateLimit(row) {
  const text = `${row.reason ?? ''} ${row.status ?? ''}`.toLowerCase();
  return text.includes('rate-limit') || text.includes('rate limited') || text.includes('429');
}

function isAuthHealth(row) {
  const text = `${row.id ?? ''} ${row.category ?? ''} ${row.reason ?? ''}`.toLowerCase();
  return text.includes('auth') || text.includes('doctor') || text.includes('login') || text.includes('session');
}

function isDownloadQuality(row) {
  const text = `${row.id ?? ''} ${row.category ?? ''} ${row.reason ?? ''}`.toLowerCase();
  return text.includes('media') || text.includes('download');
}

function driftClass(row) {
  const text = `${row.id ?? ''} ${row.category ?? ''} ${row.status ?? ''} ${row.reason ?? ''}`.toLowerCase();
  if (isRateLimit(row)) return 'rate-limit';
  if (text.includes('login') || text.includes('auth') || text.includes('session') || text.includes('challenge')) return 'account-health';
  if (text.includes('media') || text.includes('download')) return row.status === 'passed' ? 'download-ok' : 'download-drift';
  if (text.includes('kb') || text.includes('scenario') || text.includes('dom') || text.includes('selector') || text.includes('parse')) return 'surface-drift';
  if (['blocked', 'failed', 'unknown'].includes(String(row.status))) return 'runtime-drift';
  return 'stable';
}

function countBy(rows, classifier) {
  const counts = {};
  for (const row of rows) {
    const key = classifier(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function statusTone(status) {
  if (status === 'passed') return 'good';
  if (status === 'blocked' || status === 'skipped' || status === 'running') return 'warn';
  if (status === 'failed' || status === 'stale') return 'bad';
  return 'muted';
}

function latestBySite(rows) {
  const latest = {};
  for (const row of rows) {
    const site = row.site || 'unknown';
    if (!latest[site] || String(row.finishedAt ?? '') > String(latest[site].finishedAt ?? '')) {
      latest[site] = row;
    }
  }
  return latest;
}

function metricRows(report) {
  const rows = report.rows ?? [];
  return [
    { label: 'Total rows', value: rows.length },
    { label: 'Account health', value: rows.filter(isAuthHealth).length },
    { label: 'Rate-limit', value: rows.filter(isRateLimit).length },
    { label: 'Download quality', value: rows.filter(isDownloadQuality).length },
    { label: 'Drift signals', value: rows.filter((row) => driftClass(row) !== 'stable' && driftClass(row) !== 'download-ok').length },
  ];
}

function renderMetricCards(report) {
  return metricRows(report).map((metric) => `
        <section class="metric">
          <span>${htmlEscape(metric.label)}</span>
          <strong>${htmlEscape(metric.value)}</strong>
        </section>`).join('');
}

function renderSiteSummary(report) {
  const latest = latestBySite(report.rows ?? []);
  const sites = Object.keys(report.summary ?? {}).sort();
  if (sites.length === 0) return '<p class="empty">No X or Instagram live manifests found.</p>';
  return sites.map((site) => {
    const summary = report.summary[site];
    const latestRow = latest[site];
    const statuses = Object.entries(summary.statuses ?? {})
      .map(([status, count]) => `<span class="pill ${statusTone(status)}">${htmlEscape(status)} ${htmlEscape(count)}</span>`)
      .join('');
    return `
        <article class="site-summary">
          <h2>${htmlEscape(site)}</h2>
          <p>${htmlEscape(summary.total)} recent row(s), latest ${htmlEscape(summary.latestFinishedAt ?? 'unknown')}</p>
          <p class="latest">Latest: ${htmlEscape(latestRow?.id ?? 'none')} ${latestRow ? `(${htmlEscape(latestRow.status)})` : ''}</p>
          <div class="pills">${statuses}</div>
        </article>`;
  }).join('');
}

function renderCounts(title, counts) {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return '';
  return `
        <section class="panel">
          <h2>${htmlEscape(title)}</h2>
          <div class="count-list">
            ${entries.map(([label, count]) => `<span><b>${htmlEscape(count)}</b> ${htmlEscape(label)}</span>`).join('')}
          </div>
        </section>`;
}

function renderRows(rows) {
  if (rows.length === 0) {
    return '<tr><td colspan="8" class="empty">No rows.</td></tr>';
  }
  return rows.map((row) => {
    const drift = driftClass(row);
    return `
          <tr>
            <td>${htmlEscape(row.site)}</td>
            <td>${htmlEscape(row.id)}</td>
            <td>${htmlEscape(row.category ?? '')}</td>
            <td><span class="pill ${statusTone(row.status)}">${htmlEscape(row.status)}</span></td>
            <td>${htmlEscape(row.reason ?? '')}</td>
            <td>${htmlEscape(row.finishedAt ?? '')}</td>
            <td><span class="pill drift-${slug(drift)}">${htmlEscape(drift)}</span></td>
            <td><code>${htmlEscape(row.manifestPath)}</code></td>
          </tr>`;
  }).join('');
}

export async function buildDashboard(options) {
  const report = await buildReport(parseReportArgs([
    '--runs-root',
    String(options.runsRoot),
    '--out-dir',
    String(options.outDir),
    '--site',
    String(options.site),
    '--limit',
    String(options.limit),
    '--no-write',
  ]));
  return {
    report,
    html: renderDashboard(report),
  };
}

export function renderDashboard(report) {
  const rows = report.rows ?? [];
  const driftCounts = countBy(rows, driftClass);
  const statusCounts = countBy(rows, (row) => String(row.status ?? 'unknown'));
  const accountCounts = countBy(rows.filter(isAuthHealth), (row) => driftClass(row));
  const downloadCounts = countBy(rows.filter(isDownloadQuality), (row) => row.status ?? 'unknown');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Social Live Dashboard</title>
  <style>
    :root { color-scheme: light; --ink: #17202a; --muted: #59636f; --line: #d9e1e8; --bg: #f7f9fb; --panel: #ffffff; --good: #1f7a4f; --warn: #9a6200; --bad: #b3261e; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: var(--ink); background: var(--bg); }
    header { padding: 28px 32px 18px; background: #ffffff; border-bottom: 1px solid var(--line); }
    h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 18px; letter-spacing: 0; }
    p { margin: 0; color: var(--muted); }
    main { padding: 22px 32px 36px; display: grid; gap: 18px; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
    .metric, .site-summary, .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 14px; }
    .metric span { display: block; color: var(--muted); font-size: 13px; }
    .metric strong { display: block; margin-top: 6px; font-size: 28px; }
    .sites { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
    .latest { margin-top: 8px; }
    .pills, .count-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .pill { display: inline-flex; min-height: 24px; align-items: center; border-radius: 999px; padding: 2px 9px; font-size: 12px; background: #edf2f7; color: #263442; white-space: nowrap; }
    .good { background: #e5f3eb; color: var(--good); }
    .warn { background: #fff3d6; color: var(--warn); }
    .bad { background: #fde8e7; color: var(--bad); }
    .muted { background: #eef1f4; color: var(--muted); }
    .drift-rate-limit, .drift-account-health, .drift-download-drift, .drift-surface-drift, .drift-runtime-drift { background: #fff3d6; color: var(--warn); }
    .drift-stable, .drift-download-ok { background: #e5f3eb; color: var(--good); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .count-list span { border: 1px solid var(--line); border-radius: 5px; padding: 7px 9px; background: #fbfcfe; }
    .table-wrap { overflow-x: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; min-width: 980px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: 13px; }
    th { background: #eef4f8; color: #263442; font-weight: 700; }
    code { font-family: Consolas, Monaco, monospace; font-size: 12px; color: #40505f; }
    .empty { color: var(--muted); padding: 12px; }
  </style>
</head>
<body>
  <header>
    <h1>Social Live Dashboard</h1>
    <p>Generated ${htmlEscape(report.generatedAt)} from ${htmlEscape(report.runsRoot)}.</p>
  </header>
  <main>
    <section class="metrics">${renderMetricCards(report)}
    </section>
    <section class="sites">${renderSiteSummary(report)}
    </section>
    <section class="grid">
      ${renderCounts('Status summary', statusCounts)}
      ${renderCounts('Account health', accountCounts)}
      ${renderCounts('Rate-limit and drift', driftCounts)}
      ${renderCounts('Download quality', downloadCounts)}
    </section>
    <section class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Site</th>
            <th>Case</th>
            <th>Category</th>
            <th>Status</th>
            <th>Reason</th>
            <th>Finished</th>
            <th>Drift</th>
            <th>Manifest</th>
          </tr>
        </thead>
        <tbody>${renderRows(rows)}
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>
`;
}

export async function writeDashboard(options, html) {
  if (!options.write) return null;
  await mkdir(path.resolve(options.outDir), { recursive: true });
  const htmlPath = path.join(path.resolve(options.outDir), 'social-live-dashboard.html');
  await writeFile(htmlPath, html, 'utf8');
  return { htmlPath };
}

export async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const result = await runSingleStageCliWithProgress({
    inputUrl: `${options.site} social live dashboard`,
    options: {
      ...options,
      json: options.write === false,
    },
    taskId: 'socialLiveDashboard',
    title: 'Social live dashboard',
    stageId: 'socialLiveDashboard',
    stageTitle: '生成社交 live 仪表盘',
    run: async (stageOptions) => {
      const dashboard = await buildDashboard(stageOptions);
      const outputs = await writeDashboard(stageOptions, dashboard.html);
      return { dashboard, outputs };
    },
    successMessage: (stageResult) => `rows=${stageResult?.dashboard?.report?.totalRows ?? 0}`,
    artifacts: (stageResult) => stageResult?.outputs?.htmlPath ? [{ label: 'HTML', path: stageResult.outputs.htmlPath }] : [],
    isFailureResult: undefined,
    failureReason: undefined,
    warningResult: undefined,
    failureTitle: 'Social live dashboard safely stopped',
    nextStep: 'Check the runs root and rerun after social live manifests exist.',
  });
  const dashboard = result.dashboard;
  const outputs = result.outputs;
  if (outputs) {
    process.stdout.write(`HTML: ${outputs.htmlPath}\n`);
  } else {
    process.stdout.write(dashboard.html);
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
