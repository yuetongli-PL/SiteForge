// @ts-check

import { readdir, stat, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { readCliValue as readValue } from '../src/infra/cli/internal-options.mjs';
import { runSingleStageCliWithProgress } from '../src/infra/cli/progress-cli.mjs';
import { actionCliCommand } from '../src/infra/cli/command-map.mjs';
import { readJsonFile, writeJsonFile } from '../src/infra/io.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');
const DEFAULT_RUN_ROOT = path.join(REPO_ROOT, 'runs', 'social-live-resume');

const HELP = `Internal script usage:
  node scripts/social-live-resume.mjs --state <file-or-dir> [options]

Public command:
  siteforge build <url>

Plans X full archive resume attempts from prior state/manifest artifacts. Defaults to dry-run.

Options:
  --state <file|dir>                State/manifest file or directory to scan. Required unless --run-root is scanned.
  --site <x|instagram|all>          Site filter. Default: x.
  --cooldown-minutes <n>            Minimum minutes since last attempt before resume. Default: 30.
  --max-attempts <n>                Maximum attempts per case/archive. Default: 3.
  --execute                         Write an execute-mode resume manifest; does not run live archive commands.
  --auto-execute                    Wait cooldowns and run ready resume commands until stopped.
  --max-cycles <n>                  Maximum automatic execution planning cycles. Default: 10.
  --run-root <dir>                  Output root. Default: runs/social-live-resume.
  --format <text|json>              Output format. Default: text.
  --json                            Force JSON output and suppress human progress.
  --quiet                           Suppress human progress.
  --progress <auto|interactive|plain>
  --force-tty                       Force interactive progress rendering.
  --no-tty                          Force plain progress rendering.
  -h, --help                        Show this help.
`;

export function parseArgs(argv) {
  const options = {
    state: null,
    site: 'x',
    cooldownMinutes: '30',
    maxAttempts: '3',
    execute: false,
    autoExecute: false,
    maxCycles: '10',
    runRoot: DEFAULT_RUN_ROOT,
    format: 'text',
    json: false,
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
      case '--execute':
        options.execute = true;
        break;
      case '--auto-execute':
        options.execute = true;
        options.autoExecute = true;
        break;
      case '--dry-run':
        options.execute = false;
        options.autoExecute = false;
        break;
      case '--json':
        options.format = 'json';
        options.json = true;
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
      case '--state':
      case '--site':
      case '--cooldown-minutes':
      case '--max-attempts':
      case '--max-cycles':
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
  for (const [flag, value] of [['cooldown-minutes', options.cooldownMinutes], ['max-attempts', options.maxAttempts], ['max-cycles', options.maxCycles]]) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid --${flag}: ${value}`);
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
  if (record.command) return ensureActionSessionTraceability(rewriteKnownCommandLine(record.command));
  const account = record.account ?? '<account>';
  const command = actionCliCommand(record.site === 'instagram' ? 'instagram' : 'x', [
    'full-archive',
    account,
    '--run-dir',
    record.artifactRoot,
  ]);
  return ensureActionSessionTraceability(command);
}

function rewriteKnownCommandLine(command) {
  return String(command ?? '')
    .replace(/^node\s+src[\\/]entrypoints[\\/]cli\.mjs\s+x\s+action\s+/u, 'node src/entrypoints/sites/x-action.mjs ')
    .replace(/^node\s+src[\\/]entrypoints[\\/]cli\.mjs\s+instagram\s+action\s+/u, 'node src/entrypoints/sites/instagram-action.mjs ');
}

function ensureActionSessionTraceability(command) {
  const text = String(command ?? '');
  if (!/(?:x|instagram)-action\.mjs(?:\s|$)/u.test(text)) return text;
  if (/(?:^|\s)--session-(?:health-plan|manifest)(?:\s|$)/u.test(text)) return text;
  return `${text} --session-health-plan`;
}

function shouldResume(record) {
  if (record.archive?.complete === true) return false;
  const status = String(record.status ?? '').toLowerCase();
  const reason = String(record.reason ?? record.archive?.reason ?? '').toLowerCase();
  return status !== 'passed'
    || ['max-items', 'timeout', 'rate-limited', 'session-invalid'].some((token) => reason.includes(token))
    || record.archive?.complete === false;
}

function candidateKey(record) {
  return `${record.site ?? ''}:${record.account ?? ''}:${record.id ?? ''}`;
}

function isCompletedRecord(record) {
  if (record.archive?.complete === true) return true;
  const status = String(record.status ?? '').toLowerCase();
  return status === 'passed' && !shouldResume(record);
}

export function getNextCooldownMs(candidates) {
  const waits = candidates
    .map((candidate) => Number(candidate.cooldownRemainingMs))
    .filter((value) => Number.isFinite(value) && value > 0);
  return waits.length ? Math.min(...waits) : 0;
}

export async function buildResumePlan(options, now = new Date()) {
  if (!options.state) throw new Error('Missing --state');
  const files = await findJsonFiles(options.state);
  const records = [];
  for (const file of files) {
    try {
      records.push(...extractAttemptRecords(await readJsonFile(file), file));
    } catch {
      // Ignore unrelated JSON while scanning a directory.
    }
  }
  const siteFiltered = records.filter((record) => options.site === 'all' || record.site === options.site || (options.site === 'x' && /x-full-archive/u.test(String(record.id))));
  const cooldownMs = Number(options.cooldownMinutes) * 60_000;
  const maxAttempts = Number(options.maxAttempts);
  const attemptsByKey = new Map();
  for (const record of siteFiltered) {
    const key = candidateKey(record);
    attemptsByKey.set(key, (attemptsByKey.get(key) ?? 0) + 1);
  }
  const candidates = siteFiltered
    .filter((record) => /full-archive/iu.test(String(record.id)) || record.archive)
    .filter(shouldResume)
    .map((record) => {
      const lastTime = Date.parse(record.finishedAt ?? record.startedAt ?? '');
      const cooldownRemainingMs = Number.isFinite(lastTime) ? Math.max(0, cooldownMs - (now.getTime() - lastTime)) : 0;
      const key = candidateKey(record);
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
  const completed = siteFiltered.filter(isCompletedRecord);
  return {
    mode: options.execute ? 'execute' : 'dry-run',
    generatedAt: now.toISOString(),
    source: path.resolve(options.state),
    cooldownMinutes: Number(options.cooldownMinutes),
    maxAttempts,
    candidates,
    ready: candidates.filter((candidate) => candidate.ready),
    completed,
  };
}

async function writePlan(options, plan) {
  if (!options.execute) return null;
  const runDir = path.join(path.resolve(options.runRoot), plan.generatedAt.replace(/[-:]/g, '').replace(/\.(\d{3})Z$/u, '$1Z'));
  await mkdir(runDir, { recursive: true });
  const manifestPath = path.join(runDir, 'manifest.json');
  await writeJsonFile(manifestPath, plan);
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

function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function runShellCommand(command, context = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: context.cwd ?? REPO_ROOT,
      shell: true,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (exitCode, signal) => {
      if (exitCode === 0) {
        resolve({ exitCode, signal });
        return;
      }
      const suffix = signal ? `signal ${signal}` : `exit code ${exitCode}`;
      reject(new Error(`Resume command failed with ${suffix}: ${command}`));
    });
  });
}

function applySessionAttemptBlocks(ready, sessionAttemptsByKey) {
  return ready.filter((candidate) => {
    const sessionAttempts = sessionAttemptsByKey.get(candidateKey(candidate)) ?? 0;
    return candidate.attempts + sessionAttempts < candidate.maxAttempts;
  });
}

function hasOnlyMaxAttemptBlocks(candidates, sessionAttemptsByKey) {
  return candidates.length > 0 && candidates.every((candidate) => {
    const sessionAttempts = sessionAttemptsByKey.get(candidateKey(candidate)) ?? 0;
    return candidate.blockedReason === 'max-attempts' || candidate.attempts + sessionAttempts >= candidate.maxAttempts;
  });
}

export async function runResumeLoop(options, deps = {}) {
  if (!options.state) throw new Error('Missing --state');
  const commandRunner = deps.commandRunner ?? runShellCommand;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => new Date());
  const maxCycles = Number(options.maxCycles ?? 10);
  let state = path.resolve(options.state);
  let stopReason = 'max-cycles';
  let attempts = 0;
  const history = [];
  const sessionAttemptsByKey = new Map();

  for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
    const cycleOptions = { ...options, state, execute: true };
    const plan = await buildResumePlan(cycleOptions, now());
    const manifestPath = await writePlan(cycleOptions, plan);
    const ready = applySessionAttemptBlocks(plan.ready, sessionAttemptsByKey);
    const historyEntry = {
      cycle,
      generatedAt: plan.generatedAt,
      manifestPath,
      candidateCount: plan.candidates.length,
      readyCount: ready.length,
      commands: [],
    };
    history.push(historyEntry);

    if (plan.candidates.length === 0) {
      stopReason = plan.completed.length > 0 ? 'complete' : 'no-candidates';
      break;
    }

    if (ready.length === 0) {
      const cooldownMs = getNextCooldownMs(plan.candidates);
      if (cooldownMs > 0 && !hasOnlyMaxAttemptBlocks(plan.candidates, sessionAttemptsByKey)) {
        historyEntry.cooldownMs = cooldownMs;
        await sleep(cooldownMs);
        continue;
      }
      stopReason = hasOnlyMaxAttemptBlocks(plan.candidates, sessionAttemptsByKey) ? 'max-attempts' : 'no-candidates';
      break;
    }

    for (const candidate of ready) {
      const key = candidateKey(candidate);
      const result = await commandRunner(candidate.resumeCommand, {
        candidate,
        cycle,
        plan,
        options: cycleOptions,
      });
      sessionAttemptsByKey.set(key, (sessionAttemptsByKey.get(key) ?? 0) + 1);
      attempts += 1;
      historyEntry.commands.push({
        id: candidate.id,
        site: candidate.site,
        command: candidate.resumeCommand,
        result,
      });
      const nextState = firstString(result?.statePath, result?.manifestPath);
      if (nextState) state = path.resolve(nextState);
    }
  }

  return {
    mode: 'execute-loop',
    stopReason,
    cycles: history.length,
    attempts,
    finalState: state,
    history,
  };
}

function printLoopText(result) {
  process.stdout.write('social-live-resume execute loop\n');
  process.stdout.write(`Stop reason: ${result.stopReason}\n`);
  process.stdout.write(`Cycles: ${result.cycles}\n`);
  process.stdout.write(`Attempts: ${result.attempts}\n`);
  process.stdout.write(`Final state: ${result.finalState}\n`);
  for (const cycle of result.history) {
    process.stdout.write(`- cycle ${cycle.cycle}: ready ${cycle.readyCount}/${cycle.candidateCount}\n`);
    if (cycle.cooldownMs) process.stdout.write(`  waited: ${cycle.cooldownMs}ms\n`);
    for (const command of cycle.commands) {
      process.stdout.write(`  ran: ${command.id} [${command.site ?? 'unknown'}]\n`);
      process.stdout.write(`  command: ${command.command}\n`);
    }
  }
}

export async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (options.autoExecute) {
    const result = await runSingleStageCliWithProgress({
      inputUrl: `${options.site} social resume`,
      options,
      taskId: 'socialLiveResume',
      title: 'Social live resume',
      stageId: 'socialLiveResume',
      stageTitle: '恢复社交 live 任务',
      run: (stageOptions) => runResumeLoop(stageOptions),
      successMessage: (stageResult) => `stop=${stageResult?.stopReason ?? 'unknown'} cycles=${stageResult?.cycles ?? 0} attempts=${stageResult?.attempts ?? 0}`,
      artifacts: (stageResult) => stageResult?.finalState ? [{ label: 'Final state', path: stageResult.finalState }] : [],
      isFailureResult: undefined,
      failureReason: undefined,
      warningResult: (stageResult) => !['complete', 'no-candidates'].includes(String(stageResult?.stopReason ?? '')),
      failureTitle: 'Social live resume safely stopped',
      nextStep: 'Inspect the generated resume manifests and rerun only ready candidates after cooldown.',
    });
    if (options.format === 'json') {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      printLoopText(result);
    }
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
