// @ts-check

import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJsonFile, writeJsonFile } from '../../infra/io.mjs';
import {
  buildSessionRepairPlan,
  inspectSessionHealth,
} from '../../sites/downloads/session-manager.mjs';

const HELP = `Usage:
  node src/entrypoints/sites/session-repair-plan.mjs --site <site> [options]

Dry-run by default. This command prints session repair guidance only; it does
not execute login, keepalive, profile rebuild, or live smoke work.

Options:
  --site <siteKey>                  Site key, for example bilibili, douyin, x, instagram.
  --host <host>                     Optional host override.
  --status <status>                 Inject health status for dry-run planning.
  --reason <reason>                 Inject health reason/risk cause.
  --session-gate-reason <reason>    Map an offline release audit gate reason into repair guidance.
  --audit-manifest <path>           Read download-release-audit JSON and map the first blocked row for --site.
  --risk-signal <signal>            Add a risk signal. Can be repeated.
  --profile-path <path>             Forwarded to health inspection when no status is injected.
  --approve-action <action>         Approval token for command construction in --execute mode.
  --out-file <path>                 Write the dry-run/approval audit manifest to a JSON file.
  --json                            Print JSON only.
  --execute                         Build an approved repair command; never spawns child commands.
  -h, --help                        Show this help.
`;

function readValue(argv, index, flag) {
  if (index + 1 >= argv.length) {
    throw new Error(`Missing value for ${flag}`);
  }
  return { value: argv[index + 1], nextIndex: index + 1 };
}

export function parseArgs(argv) {
  const options = {
    riskSignals: [],
    json: false,
    execute: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--execute':
        options.execute = true;
        break;
      case '--site':
      case '--host':
      case '--status':
      case '--reason':
      case '--session-gate-reason':
      case '--audit-manifest':
      case '--profile-path':
      case '--approve-action':
      case '--out-file':
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
  return options;
}

function siteUrl(options = {}, health = {}) {
  const host = health.host ?? options.host;
  if (host) {
    return `https://${host}/`;
  }
  return options.site ? `https://${options.site}/` : '';
}

function repairCommandForPlan(repairPlan = {}, options = {}, health = {}) {
  const command = repairPlan.command;
  const url = siteUrl(options, health);
  if (!command || !url) {
    return null;
  }
  const base = ['node'];
  if (command === 'site-keepalive') {
    return {
      command,
      argv: [...base, 'src/entrypoints/sites/site-keepalive.mjs', url],
    };
  }
  if (command === 'site-login') {
    return {
      command,
      argv: [...base, 'src/entrypoints/sites/site-login.mjs', url],
    };
  }
  if (command === 'site-doctor') {
    return {
      command,
      argv: [...base, 'src/entrypoints/sites/site-doctor.mjs', url],
    };
  }
  return null;
}

const EXECUTABLE_REPAIR_ACTIONS = Object.freeze([
  'site-login',
  'site-keepalive',
  'inspect-session-health',
]);

const DANGEROUS_REPAIR_ACTIONS = Object.freeze([
  'rebuild-profile',
  'cooldown-and-retry-later',
]);

function executionAudit(options = {}, repairPlan = {}, health = {}) {
  if (!options.execute) {
    return {
      status: 'not-run',
      reason: 'dry-run',
      requiresApproval: true,
    };
  }
  const approvedAction = String(options.approveAction ?? '').trim();
  const action = repairPlan.action ?? '';
  const command = repairCommandForPlan(repairPlan, options, health);
  if (DANGEROUS_REPAIR_ACTIONS.includes(action) || !EXECUTABLE_REPAIR_ACTIONS.includes(action)) {
    return {
      status: 'blocked',
      reason: 'dangerous-action-requires-human-runbook',
      requiresApproval: true,
      requestedAction: action || undefined,
      approvedAction: approvedAction || undefined,
      command: null,
    };
  }
  if (!approvedAction || approvedAction !== action) {
    return {
      status: 'blocked',
      reason: 'approval-required',
      requiresApproval: true,
      requestedAction: action || undefined,
      approvedAction: approvedAction || undefined,
      command,
    };
  }
  return {
    status: 'approved-not-run',
    reason: 'command-construction-only',
    requiresApproval: true,
    requestedAction: action,
    approvedAction,
    command,
  };
}

function injectedHealth(options = {}) {
  const gateReason = options.sessionGateReason;
  const riskSignals = Array.isArray(options.riskSignals) ? options.riskSignals : [];
  if (!options.status && !options.reason && !gateReason && riskSignals.length === 0) {
    return null;
  }
  const reason = options.reason ?? gateReason ?? options.status ?? 'blocked';
  return {
    siteKey: options.site,
    host: options.host,
    status: options.status ?? (gateReason === 'session-invalid' ? 'manual-required' : 'blocked'),
    reason,
    riskSignals: [...new Set([
      ...riskSignals,
      ...(gateReason ? ['session-gate-blocked', gateReason] : []),
    ])],
  };
}

async function auditHealth(options = {}) {
  if (!options.auditManifest) {
    return null;
  }
  const audit = await readJsonFile(path.resolve(options.auditManifest));
  const rows = Array.isArray(audit.rows) ? audit.rows : [];
  const siteRows = rows.filter((row) => !options.site || row.site === options.site);
  const row = siteRows.find((entry) => entry.status === 'blocked')
    ?? siteRows[0]
    ?? rows.find((entry) => entry.status === 'blocked')
    ?? rows[0];
  if (!row) {
    return null;
  }
  const reason = row.reason ?? row.status ?? 'unknown';
  return {
    siteKey: row.site ?? options.site,
    host: options.host,
    status: row.status === 'passed' ? 'ready' : 'blocked',
    reason,
    riskSignals: [...new Set(['session-gate-audit', reason].filter(Boolean))],
    audit: {
      manifest: path.resolve(options.auditManifest),
      rowId: row.id,
      kind: row.kind,
      provider: row.provider ?? null,
      healthManifest: row.healthManifest ?? null,
    },
  };
}

export async function buildSessionRepairPlanResult(options = {}, deps = {}) {
  if (options.help) {
    return { help: HELP };
  }
  if (!options.site) {
    throw new Error('Missing required --site');
  }
  const health = injectedHealth(options)
    ?? await auditHealth(options)
    ?? await (deps.inspectSessionHealth ?? inspectSessionHealth)(options.site, {
      host: options.host,
      profilePath: options.profilePath,
      sessionRequirement: 'optional',
    }, deps);
  const repairPlan = health.repairPlan ?? buildSessionRepairPlan(health);
  const execution = executionAudit(options, repairPlan, health);
  const result = {
    dryRun: !options.execute,
    siteKey: health.siteKey ?? options.site,
    host: health.host ?? options.host,
    status: health.status,
    reason: health.reason,
    riskSignals: health.riskSignals ?? [],
    audit: health.audit ?? undefined,
    repairPlan,
    execution,
    createdAt: new Date().toISOString(),
  };
  if (options.outFile) {
    await writeJsonFile(path.resolve(options.outFile), result);
  }
  return result;
}

function render(result) {
  if (result.help) {
    return result.help;
  }
  const plan = result.repairPlan ?? {};
  return [
    'Session Repair Plan',
    `- Site: ${result.siteKey}`,
    `- Status: ${result.status ?? 'unknown'}`,
    `- Reason: ${result.reason ?? 'none'}`,
    `- Dry-run: ${result.dryRun}`,
    `- Suggested action: ${plan.action ?? 'none'}`,
    `- Suggested command: ${plan.command ?? 'none'}`,
    `- Requires approval: ${plan.requiresApproval === true}`,
    `- Execution status: ${result.execution?.status ?? 'not-run'}`,
  ].join('\n') + '\n';
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv);
  const result = await buildSessionRepairPlanResult(options, deps);
  const output = options.json ? `${JSON.stringify(result, null, 2)}\n` : render(result);
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
