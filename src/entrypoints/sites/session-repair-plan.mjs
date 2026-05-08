// @ts-check

import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createCliProgressRenderer,
  parseProgressCliOption,
  stripProgressCliOptions,
} from '../../infra/cli/progress-cli.mjs';
import { readJsonFile, writeTextFile } from '../../infra/io.mjs';
import {
  REDACTION_PLACEHOLDER,
  SECURITY_GUARD_SCHEMA_VERSION,
  prepareRedactedArtifactJson,
  prepareRedactedArtifactJsonWithAudit,
} from '../../sites/capability/security-guard.mjs';
import { reasonCodeSummary } from '../../sites/capability/reason-codes.mjs';
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
  --quiet                           Suppress human progress on stderr.
  --progress <mode>                 auto | interactive | plain.
  --force-tty                       Force interactive progress.
  --no-tty                          Force plain progress.
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
      case '--quiet':
      case '--progress':
      case '--force-tty':
      case '--no-tty': {
        const progressOption = parseProgressCliOption(argv, arg, index, options);
        index = progressOption.nextIndex;
        break;
      }
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

const SESSION_REPAIR_PLAN_PROFILE_KEYS = Object.freeze(new Set([
  'profilePath',
  'browserProfileRoot',
  'profileRoot',
  'profileDir',
  'userDataDir',
]));

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

export function sessionRepairPlanRedactionAuditPath(outFile) {
  const resolved = path.resolve(outFile);
  const ext = path.extname(resolved);
  const base = ext ? resolved.slice(0, -ext.length) : resolved;
  return `${base}.redaction-audit.json`;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function auditPath(pathParts) {
  return pathParts.join('.');
}

function redactSessionRepairPlanProfileRefs(value, pathParts = [], audit = {
  schemaVersion: SECURITY_GUARD_SCHEMA_VERSION,
  redactedPaths: [],
  findings: [],
}) {
  if (Array.isArray(value)) {
    return {
      value: value.map((item, index) => (
        redactSessionRepairPlanProfileRefs(item, [...pathParts, String(index)], audit).value
      )),
      audit,
    };
  }
  if (!isPlainObject(value)) {
    return { value, audit };
  }
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathParts, key];
    if (SESSION_REPAIR_PLAN_PROFILE_KEYS.has(key)) {
      output[key] = REDACTION_PLACEHOLDER;
      audit.redactedPaths.push(auditPath(childPath));
      continue;
    }
    output[key] = redactSessionRepairPlanProfileRefs(child, childPath, audit).value;
  }
  return { value: output, audit };
}

function mergeRedactionAudits(...audits) {
  const redactedPaths = [];
  const findings = [];
  for (const audit of audits) {
    if (!audit || typeof audit !== 'object') {
      continue;
    }
    redactedPaths.push(...(Array.isArray(audit.redactedPaths) ? audit.redactedPaths : []));
    findings.push(...(Array.isArray(audit.findings) ? audit.findings : []));
  }
  return {
    schemaVersion: SECURITY_GUARD_SCHEMA_VERSION,
    redactedPaths: [...new Set(redactedPaths)],
    findings,
  };
}

function prepareSessionRepairPlanArtifactPayload(result) {
  const profileRedacted = redactSessionRepairPlanProfileRefs(result);
  const prepared = prepareRedactedArtifactJsonWithAudit(profileRedacted.value);
  const audit = mergeRedactionAudits(profileRedacted.audit, prepared.auditValue);
  return {
    ...prepared,
    auditJson: prepareRedactedArtifactJson(audit).json,
    auditValue: audit,
  };
}

function toSessionRepairPlanRedactionFailure(error) {
  const recovery = reasonCodeSummary('redaction-failed');
  const failure = new Error('Session repair plan artifact redaction failed');
  failure.name = 'SessionRepairPlanRedactionFailure';
  failure.code = 'redaction-failed';
  failure.reasonCode = 'redaction-failed';
  failure.retryable = recovery.retryable;
  failure.cooldownNeeded = recovery.cooldownNeeded;
  failure.isolationNeeded = recovery.isolationNeeded;
  failure.manualRecoveryNeeded = recovery.manualRecoveryNeeded;
  failure.degradable = recovery.degradable;
  failure.artifactWriteAllowed = recovery.artifactWriteAllowed;
  failure.catalogAction = recovery.catalogAction;
  failure.causeSummary = {
    name: error?.name ?? 'Error',
    code: error?.code ?? null,
  };
  return failure;
}

function toSessionRepairPlanCliSummaryRedactionFailure(error) {
  const recovery = reasonCodeSummary('redaction-failed');
  const failure = new Error('Session repair plan CLI summary redaction failed');
  failure.name = 'SessionRepairPlanCliSummaryRedactionFailure';
  failure.code = 'redaction-failed';
  failure.reasonCode = 'redaction-failed';
  failure.retryable = recovery.retryable;
  failure.cooldownNeeded = recovery.cooldownNeeded;
  failure.isolationNeeded = recovery.isolationNeeded;
  failure.manualRecoveryNeeded = recovery.manualRecoveryNeeded;
  failure.degradable = recovery.degradable;
  failure.artifactWriteAllowed = recovery.artifactWriteAllowed;
  failure.catalogAction = recovery.catalogAction;
  failure.diagnosticWriteAllowed = false;
  failure.causeSummary = {
    name: error?.name ?? 'Error',
    code: error?.code ?? null,
  };
  return failure;
}

export function prepareSessionRepairPlanArtifact(result) {
  try {
    return prepareSessionRepairPlanArtifactPayload(result);
  } catch (error) {
    throw toSessionRepairPlanRedactionFailure(error);
  }
}

export function sessionRepairPlanCliJson(result) {
  try {
    return `${prepareSessionRepairPlanArtifactPayload(result).json}\n`;
  } catch (error) {
    throw toSessionRepairPlanCliSummaryRedactionFailure(error);
  }
}

export async function writeSessionRepairPlanResult(outFile, result) {
  const resolvedOutFile = path.resolve(outFile);
  const redactionAudit = sessionRepairPlanRedactionAuditPath(resolvedOutFile);
  const prepared = prepareSessionRepairPlanArtifact({
    ...result,
    artifacts: {
      ...(result.artifacts ?? {}),
      redactionAudit,
    },
  });
  await writeTextFile(redactionAudit, prepared.auditJson);
  await writeTextFile(resolvedOutFile, prepared.json);
  return {
    outFile: resolvedOutFile,
    redactionAudit,
    value: prepared.value,
    audit: prepared.auditValue,
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
    await writeSessionRepairPlanResult(options.outFile, result);
  }
  return result;
}

function render(result) {
  if (result.help) {
    return result.help;
  }
  const plan = result.repairPlan ?? {};
  const lines = [
    'Session Repair Plan',
    `- Site: ${result.siteKey}`,
    `- Status: ${result.status ?? 'unknown'}`,
    `- Reason: ${result.reason ?? 'none'}`,
    `- Dry-run: ${result.dryRun}`,
    `- Suggested action: ${plan.action ?? 'none'}`,
    `- Suggested command: ${plan.command ?? 'none'}`,
    `- Requires approval: ${plan.requiresApproval === true}`,
    `- Execution status: ${result.execution?.status ?? 'not-run'}`,
  ];
  if (result.audit) {
    lines.push(
      `- Audit manifest: ${result.audit.manifest ?? 'unknown'}`,
      `- Audit row: ${result.audit.rowId ?? 'unknown'}`,
      `- Audit kind: ${result.audit.kind ?? 'unknown'}`,
      `- Audit provider: ${result.audit.provider ?? 'unknown'}`,
    );
  }
  return lines.join('\n') + '\n';
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv);
  const progress = createCliProgressRenderer(options);
  const task = progress.task({
    id: 'sessionRepair',
    title: 'Session repair plan',
    totalStages: 1,
    item: options.site,
  });
  const stage = task.stage({
    id: 'sessionRepair',
    title: 'Plan session repair',
    index: 1,
    total: 1,
    item: options.site,
  });
  let result;
  try {
    result = await buildSessionRepairPlanResult(stripProgressCliOptions(options), deps);
    const plan = result.repairPlan ?? result.plan ?? {};
    const message = `${result.status ?? 'unknown'} ${plan.action ?? ''}`.trim();
    stage.succeed({ message });
    task.succeed({
      message,
      artifacts: result.audit?.manifest ? [{ label: 'audit', path: result.audit.manifest }] : [],
    });
  } catch (error) {
    const reason = error?.message ?? String(error);
    stage.fail({ message: reason });
    task.fail({ message: reason });
    progress.failure({
      taskId: 'sessionRepair',
      title: 'Session repair planning failed',
      stage: 'Plan session repair',
      reason,
      nextStep: options.site ? `node src/entrypoints/sites/site-login.mjs https://${options.host ?? options.site}/ --no-headless --reuse-login-state` : undefined,
    });
    throw error;
  }
  const output = options.json ? sessionRepairPlanCliJson(result) : render(result);
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
