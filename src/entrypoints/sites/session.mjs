// @ts-check

import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createCliProgressRenderer,
  parseProgressCliOption,
  stripProgressCliOptions,
} from '../../infra/cli/progress-cli.mjs';
import { sessionRepairPlanCommand } from '../../infra/cli/command-map.mjs';
import { runSessionTask } from '../../sites/sessions/runner.mjs';

const HELP = `Usage:
  node src/entrypoints/cli.mjs session health --site <site> [options]
  node src/entrypoints/cli.mjs session repair-plan --site <site> [options]

Health+Plan only. This command writes a sanitized session manifest and never
executes login, keepalive, profile rebuild, live smoke, or downloads.

Options:
  --site <siteKey>                  Site key: bilibili, douyin, xiaohongshu, x, instagram.
  --host <host>                     Optional host override.
  --purpose <purpose>               download, archive, followed, keepalive, doctor, health-check.
  --profile-path <path>             Profile JSON source override.
  --browser-profile-root <path>     Forwarded to health inspection; manifest stores presence only.
  --user-data-dir <path>            Forwarded to health inspection; manifest stores presence only.
  --session-required                Mark session as required for this plan.
  --session-optional                Mark session as optional for this plan.
  --session-none                    Mark session as not required for this plan.
  --out-dir <path>                  Output root. Defaults to runs/session.
  --run-dir <path>                  Exact run directory override.
  --status <status>                 Inject health status for offline planning/tests.
  --reason <reason>                 Inject health reason/risk cause.
  --risk-signal <signal>            Add a risk signal. Can be repeated.
  --json                            Print JSON only.
  --quiet                           Suppress human progress on stderr.
  --progress <mode>                 auto | interactive | plain.
  --force-tty                       Force interactive progress.
  --no-tty                          Force plain progress.
  -h, --help                        Show this help.
`;

function readValue(argv, index, flag) {
  if (index + 1 >= argv.length) {
    throw new Error(`Missing value for ${flag}`);
  }
  return { value: argv[index + 1], nextIndex: index + 1 };
}

export function parseArgs(argv = []) {
  const options = {
    action: null,
    riskSignals: [],
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('-') && !options.action) {
      options.action = arg;
      continue;
    }
    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--quiet':
      case '--progress':
      case '--force-tty':
      case '--no-tty': {
        const progressOption = parseProgressCliOption(argv, arg, index, options);
        index = progressOption.nextIndex;
        break;
      }
      case '--session-required':
        options.sessionRequired = true;
        break;
      case '--session-optional':
        options.sessionOptional = true;
        break;
      case '--session-none':
        options.sessionNone = true;
        break;
      case '--site':
      case '--host':
      case '--purpose':
      case '--profile-path':
      case '--browser-profile-root':
      case '--user-data-dir':
      case '--out-dir':
      case '--run-dir':
      case '--status':
      case '--reason':
      case '--risk-signal': {
        const read = readValue(argv, index, arg);
        if (arg === '--risk-signal') {
          options.riskSignals.push(read.value);
        } else {
          const key = arg.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
          options[key] = read.value;
        }
        index = read.nextIndex;
        break;
      }
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  options.action ??= 'health';
  return options;
}

function render(result) {
  if (result.help) {
    return result.help;
  }
  const manifest = result.manifest ?? {};
  const plan = manifest.plan ?? {};
  const repairPlan = manifest.repairPlan ?? {};
  return [
    'Session Health',
    `- Site: ${manifest.siteKey}`,
    `- Purpose: ${manifest.purpose}`,
    `- Status: ${manifest.status}`,
    `- Reason: ${manifest.reason ?? 'none'}`,
    `- Requirement: ${plan.sessionRequirement ?? 'optional'}`,
    `- Dry-run: ${manifest.dryRun === true}`,
    `- Repair action: ${repairPlan.action ?? 'none'}`,
    `- Repair command: ${repairPlan.command ?? 'none'}`,
    `- Repair requires approval: ${repairPlan.requiresApproval === true}`,
    `- Manifest: ${manifest.artifacts?.manifest ?? 'none'}`,
  ].join('\n') + '\n';
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    const output = options.json ? `${JSON.stringify({ help: HELP }, null, 2)}\n` : HELP;
    deps.stdout?.write ? deps.stdout.write(output) : process.stdout.write(output);
    return { help: HELP };
  }
  if (!options.site) {
    throw new Error('Missing required --site');
  }
  const progress = createCliProgressRenderer(options);
  const task = progress.task({
    id: 'session',
    title: 'Session health',
    totalStages: 1,
    item: options.site,
  });
  const stage = task.stage({
    id: options.action ?? 'health',
    title: options.action === 'plan-repair' ? 'Plan session repair' : 'Check session health',
    index: 1,
    total: 1,
    item: options.site,
  });
  let result;
  try {
    result = await (deps.runSessionTask ?? runSessionTask)(stripProgressCliOptions(options), {}, deps);
    const manifest = result.manifest ?? {};
    const message = `${manifest.status ?? 'unknown'} ${manifest.reason ?? ''}`.trim();
    if (['ready', 'healthy', 'ok'].includes(String(manifest.status ?? '').toLowerCase())) {
      stage.succeed({ message });
      task.succeed({ message, artifacts: manifest.artifacts?.manifest ? [{ label: 'manifest', path: manifest.artifacts.manifest }] : [] });
    } else {
      stage.warn({ message });
      task.warn({ message, artifacts: manifest.artifacts?.manifest ? [{ label: 'manifest', path: manifest.artifacts.manifest }] : [] });
    }
  } catch (error) {
    const reason = error?.message ?? String(error);
    stage.fail({ message: reason });
    task.fail({ message: reason });
    progress.failure({
      taskId: 'session',
      title: 'Session health failed',
      stage: stage.title,
      reason,
      nextStep: options.site ? sessionRepairPlanCommand(['--site', options.site]) : undefined,
    });
    throw error;
  }
  const output = options.json ? `${JSON.stringify(result.manifest, null, 2)}\n` : render(result);
  deps.stdout?.write ? deps.stdout.write(output) : process.stdout.write(output);
  return result;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
