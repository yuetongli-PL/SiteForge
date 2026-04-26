// @ts-check

import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');
const DEFAULT_RUN_ROOT = path.join(REPO_ROOT, 'runs', 'social-live-resume');

const HELP = `Usage:
  node scripts/social-live-resume.mjs --state <state-or-manifest.json> [options]

Plans X full archive resume attempts from prior state/manifest artifacts. Defaults to dry-run.

Options:
  --state <file|dir>                State/manifest file or directory to scan. Required unless --run-root is scanned.
  --site <x|instagram|all>          Site filter. Default: x.
  --cooldown-minutes <n>            Minimum minutes since last attempt before resume. Default: 30.
  --max-attempts <n>                Maximum attempts per case/archive. Default: 3.
  --execute                         Write an execute-mode resume manifest; does not run live archive commands.
  --run-root <dir>                  Output root. Default: runs/social-live-resume.
  --format <text|json>              Output format. Default: text.
  -h, --help                        Show this help.
`;

function readValue(argv, index, flag) {
  if (index + 1 >= argv.length) throw new Error(`Missing value for ${flag}`);
  return { value: argv[index + 1], nextIndex: index + 1 };
}

export function parseArgs(argv) {
  const options = {
    state: null,
    site: 'x',
    cooldownMinutes: '30',
    maxAttempts: '3',
    execute: false,
    runRoot: DEFAULT_RUN_ROOT,
    format: 'text',
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
      case '--state':
      case '--site':
      case '--cooldown-minutes':
      case '--max-attempts':
      case '--run-root':
      case '--format': {
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
  if (!['text', 'json'].includes(String(options.format))) throw new Error(`Invalid --format: ${options.format}`);
  for (const [flag, value] of [['cooldown-minutes', options.cooldownMinutes], ['max-attempts', options.maxAttempts]]) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid --${flag}: ${value}`);
  }
  return options;
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@=\\-]+$/u.test(text)) return text;
  return `"${text.replace(/"/gu, '\\"')}"`;
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse((await readFile(filePath, 'utf8')).replace(/^\uFEFF/u, ''));
}

async function findJsonFiles(target) {
  const resolved = path.resolve(target);
  const info = await stat(resolved);
  if (info.isFile()) return [resolved];
  const found = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && /(?:manifest|state).*\.json$/iu.test(entry.name)) {
        found.push(full);
      }
    }
  }
  await walk(resolved);
  return found;
}

function normalizeSite(value) {
  const text = String(value ?? '').toLowerCase();
  if (text === 'twitter') return 'x';
  if (text === 'ig') return 'instagram';
  return text;
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim()) ?? null;
}

function extractAttemptRecords(json, sourcePath) {
  const records = [];
  const push = (candidate, fallback = {}) => {
    const site = normalizeSite(candidate?.site ?? fallback.site ?? json?.site ?? json?.options?.site);
    const id = firstString(candidate?.id, fallback.id, json?.id, json?.runId, path.basename(path.dirname(sourcePath)));
    const command = firstString(candidate?.command, fallback.command);
    const artifactRoot = firstString(candidate?.artifactRoot, fallback.artifactRoot, candidate?.runDir, json?.runDir, path.dirname(sourcePath));
    const manifestPath = firstString(candidate?.manifestPath, fallback.manifestPath, sourcePath);
    const account = firstString(candidate?.account, json?.account, json?.options?.xAccount, json?.options?.igAccount);
    const startedAt = firstString(candidate?.startedAt, json?.startedAt);
    const finishedAt = firstString(candidate?.finishedAt, json?.finishedAt, candidate?.updatedAt, json?.updatedAt);
    const status = firstString(candidate?.status, candidate?.artifactSummary?.verdict, json?.status, json?.outcome?.status);
    const reason = firstString(candidate?.reason, candidate?.artifactSummary?.reason, json?.reason, json?.outcome?.reason, json?.archive?.reason, json?.runtimeRisk?.stopReason);
    const archive = candidate?.archive ?? candidate?.artifactSummary?.archive ?? json?.archive ?? null;
    if (!site && !command && !archive && !/x-full-archive|instagram-full-archive/iu.test(String(id))) return;
    records.push({ id, site, account, command, artifactRoot, manifestPath, startedAt, finishedAt, status, reason, archive, sourcePath });
  };

  if (Array.isArray(json?.results)) {
    for (const result of json.results) push(result);
  } else {
    push(json);
  }
  if (Array.isArray(json?.commands)) {
    for (const command of json.commands) {
      if (!records.some((record) => record.id === command.id && record.command)) {
        push(command);
      }
    }
  }
  return records;
}

function commandForRecord(record) {
  if (record.command) return record.command;
  const account = record.account ?? '<account>';
  if (record.site === 'instagram') {
    return ['node', path.join('src', 'entrypoints', 'sites', 'instagram-action.mjs'), 'full-archive', account, '--run-dir', record.artifactRoot].map(shellQuote).join(' ');
  }
  return ['node', path.join('src', 'entrypoints', 'sites', 'x-action.mjs'), 'full-archive', account, '--run-dir', record.artifactRoot].map(shellQuote).join(' ');
}

function shouldResume(record) {
  if (record.archive?.complete === true) return false;
  const status = String(record.status ?? '').toLowerCase();
  const reason = String(record.reason ?? record.archive?.reason ?? '').toLowerCase();
  return status !== 'passed'
    || ['max-items', 'timeout', 'rate-limited', 'session-invalid'].some((token) => reason.includes(token))
    || record.archive?.complete === false;
}

export async function buildResumePlan(options, now = new Date()) {
  if (!options.state) throw new Error('Missing --state');
  const files = await findJsonFiles(options.state);
  const records = [];
  for (const file of files) {
    try {
      records.push(...extractAttemptRecords(await readJson(file), file));
    } catch {
      // Ignore unrelated JSON while scanning a directory.
    }
  }
  const siteFiltered = records.filter((record) => options.site === 'all' || record.site === options.site || (options.site === 'x' && /x-full-archive/u.test(String(record.id))));
  const cooldownMs = Number(options.cooldownMinutes) * 60_000;
  const maxAttempts = Number(options.maxAttempts);
  const attemptsByKey = new Map();
  for (const record of siteFiltered) {
    const key = `${record.site}:${record.account ?? ''}:${record.id}`;
    attemptsByKey.set(key, (attemptsByKey.get(key) ?? 0) + 1);
  }
  const candidates = siteFiltered
    .filter((record) => /full-archive/iu.test(String(record.id)) || record.archive)
    .filter(shouldResume)
    .map((record) => {
      const lastTime = Date.parse(record.finishedAt ?? record.startedAt ?? '');
      const cooldownRemainingMs = Number.isFinite(lastTime) ? Math.max(0, cooldownMs - (now.getTime() - lastTime)) : 0;
      const key = `${record.site}:${record.account ?? ''}:${record.id}`;
      const attempts = attemptsByKey.get(key) ?? 1;
      const blockedByAttempts = attempts >= maxAttempts;
      return {
        ...record,
        attempts,
        maxAttempts,
        cooldownRemainingMs,
        ready: cooldownRemainingMs === 0 && !blockedByAttempts,
        blockedReason: blockedByAttempts ? 'max-attempts' : (cooldownRemainingMs > 0 ? 'cooldown' : null),
        resumeCommand: commandForRecord(record),
      };
    });
  return {
    mode: options.execute ? 'execute' : 'dry-run',
    generatedAt: now.toISOString(),
    source: path.resolve(options.state),
    cooldownMinutes: Number(options.cooldownMinutes),
    maxAttempts,
    candidates,
    ready: candidates.filter((candidate) => candidate.ready),
  };
}

async function writePlan(options, plan) {
  if (!options.execute) return null;
  const runDir = path.join(path.resolve(options.runRoot), plan.generatedAt.replace(/[-:]/g, '').replace(/\.(\d{3})Z$/u, '$1Z'));
  await mkdir(runDir, { recursive: true });
  const manifestPath = path.join(runDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  return manifestPath;
}

function printText(plan, manifestPath) {
  process.stdout.write(`social-live-resume ${plan.mode} plan\n`);
  if (manifestPath) process.stdout.write(`Manifest: ${manifestPath}\n`);
  process.stdout.write(`Ready: ${plan.ready.length}/${plan.candidates.length}\n\n`);
  for (const candidate of plan.candidates) {
    process.stdout.write(`- ${candidate.id} [${candidate.site ?? 'unknown'}]: ${candidate.ready ? 'ready' : candidate.blockedReason}\n`);
    process.stdout.write(`  source: ${candidate.sourcePath}\n`);
    process.stdout.write(`  command: ${candidate.resumeCommand}\n`);
  }
}

export async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const plan = await buildResumePlan(options);
  const manifestPath = await writePlan(options, plan);
  if (options.format === 'json') {
    process.stdout.write(`${JSON.stringify({ ...plan, manifestPath }, null, 2)}\n`);
  } else {
    printText(plan, manifestPath);
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
