// @ts-check

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');
const DEFAULT_RUN_ROOT = path.join(REPO_ROOT, 'runs', 'social-health-watch');

const SITES = Object.freeze({
  x: {
    site: 'x',
    url: 'https://x.com/home',
    profilePath: path.join(REPO_ROOT, 'profiles', 'x.com.json'),
    knowledgeBaseDir: path.join(REPO_ROOT, 'knowledge-base', 'x.com'),
  },
  instagram: {
    site: 'instagram',
    url: 'https://www.instagram.com/',
    profilePath: path.join(REPO_ROOT, 'profiles', 'www.instagram.com.json'),
    knowledgeBaseDir: path.join(REPO_ROOT, 'knowledge-base', 'www.instagram.com'),
  },
});

const HELP = `Usage:
  node scripts/social-health-watch.mjs [--execute] [--site x|instagram|all] [options]

Dry-run by default. In execute mode, runs keepalive and auth doctor sequentially.

Options:
  --execute                         Run session health, keepalive, and auth doctor commands.
  --site <x|instagram|all>          Site filter. Default: all.
  --interval-minutes <n>            Suggested keepalive interval. Default: 60.
  --timeout <ms>                    Forwarded browser timeout. Default: 30000.
  --run-root <dir>                  Manifest/output root. Default: runs/social-health-watch.
  --browser-path <path>             Forwarded to child commands.
  --browser-profile-root <dir>      Forwarded to child commands.
  --user-data-dir <dir>             Forwarded to child commands.
  --headless|--no-headless          Forwarded to child commands. Default: --no-headless.
  -h, --help                        Show this help.
`;

function readValue(argv, index, flag) {
  if (index + 1 >= argv.length) throw new Error(`Missing value for ${flag}`);
  return { value: argv[index + 1], nextIndex: index + 1 };
}

export function parseArgs(argv) {
  const options = {
    execute: false,
    site: 'all',
    intervalMinutes: '60',
    timeout: '30000',
    runRoot: DEFAULT_RUN_ROOT,
    browserPath: null,
    browserProfileRoot: null,
    userDataDir: null,
    headless: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--execute':
        options.execute = true;
        break;
      case '--dry-run':
        options.execute = false;
        break;
      case '--headless':
        options.headless = true;
        break;
      case '--no-headless':
        options.headless = false;
        break;
      case '--site':
      case '--interval-minutes':
      case '--timeout':
      case '--run-root':
      case '--browser-path':
      case '--browser-profile-root':
      case '--user-data-dir': {
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
  for (const [flag, value] of [['interval-minutes', options.intervalMinutes], ['timeout', options.timeout]]) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid --${flag}: ${value}`);
  }
  return options;
}

function addOptional(args, flag, value) {
  if (value !== null && value !== undefined && String(value).trim() !== '') args.push(flag, String(value));
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@=\\-]+$/u.test(text)) return text;
  return `"${text.replace(/"/gu, '\\"')}"`;
}

function formatCommand(command, args) {
  return [command, ...args].map(shellQuote).join(' ');
}

function timestampForDir(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/u, '$1Z');
}

function selectedSites(options) {
  return options.site === 'all' ? [SITES.x, SITES.instagram] : [SITES[options.site]];
}

export function buildHealthPlan(options, now = new Date()) {
  const runId = timestampForDir(now);
  const runDir = path.join(path.resolve(options.runRoot), runId);
  const nextSuggestedKeepalive = new Date(now.getTime() + Number(options.intervalMinutes) * 60_000).toISOString();
  const sites = selectedSites(options).map((site) => {
    const siteRunDir = path.join(runDir, site.site);
    const sessionManifestPath = path.join(siteRunDir, 'session-health', 'manifest.json');
    const common = [
      '--profile-path', site.profilePath,
      '--out-dir', siteRunDir,
      '--timeout', String(options.timeout),
      '--reuse-login-state',
      options.headless ? '--headless' : '--no-headless',
    ];
    addOptional(common, '--browser-path', options.browserPath);
    addOptional(common, '--browser-profile-root', options.browserProfileRoot);
    addOptional(common, '--user-data-dir', options.userDataDir);
    const sessionArgs = [
      path.join('src', 'entrypoints', 'sites', 'session.mjs'),
      'health',
      '--site', site.site,
      '--purpose', 'keepalive',
      '--session-required',
      '--profile-path', site.profilePath,
      '--run-dir', path.dirname(sessionManifestPath),
    ];
    addOptional(sessionArgs, '--browser-profile-root', options.browserProfileRoot);
    addOptional(sessionArgs, '--user-data-dir', options.userDataDir);
    const keepaliveArgs = [path.join('src', 'entrypoints', 'sites', 'site-keepalive.mjs'), site.url, ...common, '--no-auto-login'];
    const doctorArgs = [
      path.join('src', 'entrypoints', 'sites', 'site-doctor.mjs'),
      site.url,
      ...common,
      '--session-manifest',
      sessionManifestPath,
      '--crawler-scripts-dir',
      path.join(REPO_ROOT, 'crawler-scripts'),
      '--knowledge-base-dir',
      site.knowledgeBaseDir,
    ];
    return {
      site: site.site,
      nextSuggestedKeepalive,
      commands: [
        { id: `${site.site}-session-health`, type: 'session-health', command: process.execPath, args: sessionArgs, commandLine: formatCommand(process.execPath, sessionArgs), artifact: sessionManifestPath },
        { id: `${site.site}-keepalive`, type: 'keepalive', command: process.execPath, args: keepaliveArgs, commandLine: formatCommand(process.execPath, keepaliveArgs) },
        { id: `${site.site}-auth-doctor`, type: 'auth-doctor', command: process.execPath, args: doctorArgs, commandLine: formatCommand(process.execPath, doctorArgs), sessionManifest: sessionManifestPath },
      ],
    };
  });
  return {
    runId,
    mode: options.execute ? 'execute' : 'dry-run',
    status: options.execute ? 'running' : 'planned',
    generatedAt: now.toISOString(),
    runDir,
    intervalMinutes: Number(options.intervalMinutes),
    nextSuggestedKeepalive,
    sites,
    results: [],
  };
}

function runCommand(entry, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(entry.command, entry.args, { cwd: REPO_ROOT, shell: false });
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs + 10_000) : null;
    timer?.unref?.();
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (exitCode, signal) => {
      if (timer) clearTimeout(timer);
      resolve({
        id: entry.id,
        type: entry.type,
        command: entry.commandLine,
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode,
        signal: timedOut ? 'timeout' : signal,
        status: exitCode === 0 ? 'passed' : (timedOut ? 'blocked' : 'failed'),
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-4000),
      });
    });
  });
}

async function writeManifest(plan) {
  await mkdir(plan.runDir, { recursive: true });
  const manifestPath = path.join(plan.runDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  return manifestPath;
}

export async function executePlan(plan, options) {
  const manifestPath = await writeManifest(plan);
  for (const site of plan.sites) {
    for (const command of site.commands) {
      const result = await runCommand(command, Number(options.timeout));
      plan.results.push({ site: site.site, nextSuggestedKeepalive: site.nextSuggestedKeepalive, ...result });
      await writeManifest(plan);
    }
  }
  plan.status = plan.results.every((result) => result.status === 'passed') ? 'passed' : 'blocked';
  plan.finishedAt = new Date().toISOString();
  await writeManifest(plan);
  if (plan.status !== 'passed') process.exitCode = 1;
  return manifestPath;
}

function printPlan(plan, manifestPath) {
  process.stdout.write(`social-health-watch ${plan.mode} plan\n`);
  process.stdout.write(`Manifest: ${manifestPath}\n`);
  process.stdout.write(`nextSuggestedKeepalive: ${plan.nextSuggestedKeepalive}\n\n`);
  for (const site of plan.sites) {
    process.stdout.write(`${site.site}\n`);
    for (const command of site.commands) {
      process.stdout.write(`  ${command.type}: ${command.commandLine}\n`);
    }
  }
}

export async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const plan = buildHealthPlan(options);
  const manifestPath = await writeManifest(plan);
  printPlan(plan, manifestPath);
  if (!options.execute) {
    process.stdout.write('Dry-run only. Re-run with --execute to run keepalive/auth doctor.\n');
    return;
  }
  await executePlan(plan, options);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
