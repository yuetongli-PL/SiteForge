// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  createDownloadPlan,
} from '../../sites/downloads/modules.mjs';
import {
  resolveDouyinMediaBatch,
} from '../../sites/douyin/queries/media-resolver.mjs';
import {
  resolveXiaohongshuFreshEvidence,
} from '../../sites/xiaohongshu/actions/router.mjs';
import { resolveDownloadSiteDefinition } from '../../sites/downloads/registry.mjs';
import { runDownloadTask } from '../../sites/downloads/runner.mjs';
import {
  readSessionRunManifest,
  sessionOptionsFromRunManifest,
} from '../../sites/sessions/manifest-bridge.mjs';
import {
  REDACTION_PLACEHOLDER,
  prepareRedactedArtifactJsonWithAudit,
} from '../../sites/capability/security-guard.mjs';
import { readJsonFile } from '../../infra/io.mjs';
import { reasonCodeSummary } from '../../sites/capability/reason-codes.mjs';
import { createProgressRenderer } from '../../infra/cli/progress.mjs';
import { downloadCliCommand } from '../../infra/cli/command-map.mjs';

const HELP = `Usage:
  node src/entrypoints/cli.mjs download plan <url-or-target> --site <site> [options]
  node src/entrypoints/cli.mjs download execute <url-or-target> --site <site> [options]

Defaults to dry-run. Use --execute only when the generated plan is safe to run.

Options:
  --site <siteKey|host>             Site key or host, for example bilibili, douyin, x, instagram.
  --host <host>                     Explicit host when --site is not enough.
  --input <value>                   Original user target: page URL, account, title, or book URL.
  --task-type <type>                book, video, image-note, media-bundle, social-archive, generic-resource.
  --resource <url>                  Already-resolved downloadable resource URL. Can be repeated.
  --file-name <name>                File name for a single --resource.
  --media-type <type>               text, image, video, audio, json, or binary. Default: binary.
  --execute                         Execute resolved resource downloads. Without this, writes a dry-run manifest.
  --out-dir <dir>                   Run root. Default: runs/downloads/<site>.
  --run-dir <dir>                   Exact run directory.
  --concurrency <n>                 Download concurrency. Default: 4.
  --retries <n>                     Retry count per resource. Default: 2.
  --retry-backoff-ms <ms>           Backoff between retries. Default: 1000.
  --max-items <n>                   Bound resolver/download item count for live validation.
  --resume                          Reuse valid completed artifacts and attempt incomplete resources in --run-dir.
  --retry-failed                    Require old queue state; reuse successes and retry only old failed resources.
  --no-resume                       Ignore existing run artifacts and start fresh.
  --no-skip-existing                Redownload files even if the target file already exists.
  --no-verify                       Skip expected size/hash verification.
  --enable-derived-mux              Allow opt-in derived audio/video mux artifacts.
  --mux-derived-media               Alias for --enable-derived-mux.
  --dash-mux                        Alias for --enable-derived-mux.
  --live-validation <scenario>      Record planned live validation metadata; does not run live smoke by itself.
  --live-approval-id <id>           Approval reference for a separately approved live validation run.
  --session-required                Require an authenticated/reusable session lease.
  --session-optional                Prefer a reusable session lease.
  --session-none                    Use an anonymous session lease.
  --session-status <status>         Force lease status for testing: ready, blocked, manual-required, expired.
  --session-reason <reasonCode>     Force a sanitized session reason for testing blocked live gates.
  --session-manifest <path>         Consume a unified runs/session health manifest before resolving resources.
  --session-health-plan             Generate and consume a unified session health manifest first.
  --no-session-health-plan          Use the legacy session provider instead of the unified health plan.
  --resolve-network                 Allow resolvers to fetch source pages before falling back to legacy downloaders.
  --planner-handoff <path>          Consume a redacted PlannerPolicyRuntimeHandoff for native API endpoint evidence.
  --profile-path <path>             Reusable browser profile path for approved native resolvers.
  --browser-profile-root <path>     Browser profile root for approved native resolvers.
  --user-data-dir <path>            Browser user data directory for approved native resolvers.
  --browser-path <path>             Browser executable path for approved native resolvers.
  --headless                        Run approved browser-backed native resolvers headless.
  --no-headless                     Run approved browser-backed native resolvers visibly.
  --timeout <ms>                    Browser-backed native resolver timeout.
  --plan-json                       Emit a no-write resolved plan JSON to stdout and exit.
  --no-write                        Alias for --plan-json.
  --json                            Print the full runner result JSON.
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
  return {
    value: argv[index + 1],
    nextIndex: index + 1,
  };
}

export function parseArgs(argv) {
  const options = {
    dryRun: true,
    resources: [],
    skipExisting: true,
    verify: true,
    json: false,
    planJson: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--site': {
        const read = readValue(argv, index, arg);
        options.site = read.value;
        index = read.nextIndex;
        break;
      }
      case '--host': {
        const read = readValue(argv, index, arg);
        options.host = read.value;
        index = read.nextIndex;
        break;
      }
      case '--input': {
        const read = readValue(argv, index, arg);
        options.input = read.value;
        index = read.nextIndex;
        break;
      }
      case '--task-type': {
        const read = readValue(argv, index, arg);
        options.taskType = read.value;
        index = read.nextIndex;
        break;
      }
      case '--resource': {
        const read = readValue(argv, index, arg);
        options.resources.push({ url: read.value });
        index = read.nextIndex;
        break;
      }
      case '--file-name': {
        const read = readValue(argv, index, arg);
        options.fileName = read.value;
        index = read.nextIndex;
        break;
      }
      case '--media-type': {
        const read = readValue(argv, index, arg);
        options.mediaType = read.value;
        index = read.nextIndex;
        break;
      }
      case '--execute':
        if (options.planJson) {
          throw new Error('--execute cannot be combined with --plan-json or --no-write');
        }
        options.dryRun = false;
        break;
      case '--out-dir': {
        const read = readValue(argv, index, arg);
        options.outDir = read.value;
        index = read.nextIndex;
        break;
      }
      case '--run-dir': {
        const read = readValue(argv, index, arg);
        options.runDir = read.value;
        index = read.nextIndex;
        break;
      }
      case '--concurrency': {
        const read = readValue(argv, index, arg);
        options.concurrency = Number(read.value);
        index = read.nextIndex;
        break;
      }
      case '--retries': {
        const read = readValue(argv, index, arg);
        options.retries = Number(read.value);
        index = read.nextIndex;
        break;
      }
      case '--retry-backoff-ms': {
        const read = readValue(argv, index, arg);
        options.retryBackoffMs = Number(read.value);
        index = read.nextIndex;
        break;
      }
      case '--max-items': {
        const read = readValue(argv, index, arg);
        options.maxItems = Number(read.value);
        index = read.nextIndex;
        break;
      }
      case '--resume':
        options.resume = true;
        break;
      case '--retry-failed':
        options.resume = true;
        options.retryFailedOnly = true;
        break;
      case '--no-resume':
        options.resume = false;
        options.retryFailedOnly = false;
        break;
      case '--no-skip-existing':
        options.skipExisting = false;
        break;
      case '--no-verify':
        options.verify = false;
        break;
      case '--enable-derived-mux':
      case '--mux-derived-media':
      case '--dash-mux':
        options.enableDerivedMux = true;
        break;
      case '--live-validation': {
        const read = readValue(argv, index, arg);
        options.liveValidation = {
          ...(options.liveValidation ?? {}),
          status: 'planned',
          scenario: read.value,
          requiresApproval: true,
        };
        index = read.nextIndex;
        break;
      }
      case '--live-approval-id': {
        const read = readValue(argv, index, arg);
        options.liveValidation = {
          ...(options.liveValidation ?? {}),
          approvalId: read.value,
        };
        index = read.nextIndex;
        break;
      }
      case '--session-required':
        options.sessionRequirement = 'required';
        break;
      case '--session-optional':
        options.sessionRequirement = 'optional';
        break;
      case '--session-none':
        options.sessionRequirement = 'none';
        break;
      case '--session-status': {
        const read = readValue(argv, index, arg);
        options.sessionStatus = read.value;
        index = read.nextIndex;
        break;
      }
      case '--session-reason': {
        const read = readValue(argv, index, arg);
        options.sessionReason = read.value;
        index = read.nextIndex;
        break;
      }
      case '--session-manifest': {
        const read = readValue(argv, index, arg);
        options.sessionManifest = read.value;
        index = read.nextIndex;
        break;
      }
      case '--profile-path':
      case '--browser-profile-root':
      case '--user-data-dir':
      case '--browser-path':
      case '--timeout': {
        const read = readValue(argv, index, arg);
        const key = arg.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
        options[key === 'timeout' ? 'timeoutMs' : key] = key === 'timeout' ? Number(read.value) : read.value;
        index = read.nextIndex;
        break;
      }
      case '--headless':
        options.headless = true;
        break;
      case '--no-headless':
        options.headless = false;
        break;
      case '--session-health-plan':
        options.useUnifiedSessionHealth = true;
        break;
      case '--no-session-health-plan':
        options.useUnifiedSessionHealth = false;
        break;
      case '--resolve-network':
        options.resolveNetwork = true;
        break;
      case '--planner-handoff': {
        const read = readValue(argv, index, arg);
        options.plannerHandoffPath = read.value;
        index = read.nextIndex;
        break;
      }
      case '--plan-json':
      case '--no-write':
        if (options.dryRun === false) {
          throw new Error('--execute cannot be combined with --plan-json or --no-write');
        }
        options.planJson = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--quiet':
        options.quiet = true;
        break;
      case '--progress': {
        const read = readValue(argv, index, arg);
        options.progressMode = read.value;
        index = read.nextIndex;
        break;
      }
      case '--force-tty':
        options.forceTty = true;
        break;
      case '--no-tty':
        options.noTty = true;
        break;
      default:
        if (!options.input) {
          options.input = arg;
          break;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.fileName && options.resources.length === 1) {
    options.resources[0].fileName = options.fileName;
  }
  if (
    options.sessionRequirement === 'required'
    && options.useUnifiedSessionHealth !== false
    && !options.sessionManifest
    && !options.sessionStatus
  ) {
    options.useUnifiedSessionHealth = true;
  }
  return options;
}

function defaultResolverDeps(options = {}) {
  if (options.resolveNetwork !== true) {
    return {};
  }
  return {
    resolveDouyinMediaBatch,
    resolveXiaohongshuFreshEvidence,
  };
}

export function downloadPlanOnlyJson(plan, definition, options = {}) {
  const payload = {
    status: 'planned',
    mode: 'plan-only',
    noWrite: true,
    generatedAt: new Date().toISOString(),
    siteKey: plan.siteKey,
    host: plan.host,
    taskType: plan.taskType,
    resolveNetwork: Boolean(options.resolveNetwork),
    liveValidation: options.liveValidation ?? null,
    definition: {
      siteKey: definition.siteKey,
      host: definition.host,
      adapterId: definition.adapterId,
      resolverMethod: definition.resolverMethod,
      taskType: definition.taskType,
      taskTypes: definition.taskTypes,
      sessionRequirement: definition.sessionRequirement,
    },
    plan,
  };
  return `${prepareRedactedArtifactJsonWithAudit(payload).json}\n`;
}

function toDownloadCliSummaryRedactionFailure(error) {
  const recovery = reasonCodeSummary('redaction-failed');
  const failure = new Error('Download CLI summary redaction failed');
  failure.name = 'DownloadCliSummaryRedactionFailure';
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

function redactDownloadCliSummary(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return result;
  }
  const summary = { ...result };
  if (summary.sessionLease && typeof summary.sessionLease === 'object') {
    const sessionLease = { ...summary.sessionLease };
    for (const key of [
      'headers',
      'cookies',
      'authorization',
      'cookie',
      'csrf',
      'token',
      'accessToken',
      'refreshToken',
      'SESSDATA',
    ]) {
      if (Object.hasOwn(sessionLease, key)) {
        sessionLease[key] = REDACTION_PLACEHOLDER;
      }
    }
    summary.sessionLease = sessionLease;
  }
  return summary;
}

export function downloadCliJson(result) {
  try {
    return `${prepareRedactedArtifactJsonWithAudit(redactDownloadCliSummary(result)).json}\n`;
  } catch (error) {
    throw toDownloadCliSummaryRedactionFailure(error);
  }
}

export async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const progress = createProgressRenderer({
    stdout: process.stdout,
    stderr: process.stderr,
    mode: options.progressMode ?? 'auto',
    forceTty: options.forceTty,
    noTty: options.noTty,
    json: options.json || options.planJson,
    quiet: options.quiet,
  });
  if (options.planJson) {
    const definition = await resolveDownloadSiteDefinition(options, {
      workspaceRoot: process.cwd(),
    });
    const plan = await createDownloadPlan(options, {
      workspaceRoot: process.cwd(),
      definition,
    });
    process.stdout.write(downloadPlanOnlyJson(plan, definition, options));
    return;
  }
  const sessionManifestOptions = options.sessionManifest
    ? sessionOptionsFromRunManifest(await readSessionRunManifest(path.resolve(options.sessionManifest)), {
      siteKey: options.site,
      ...(options.host ? { host: options.host } : {}),
    })
    : {};
  const plannerHandoff = options.plannerHandoffPath
    ? await readJsonFile(path.resolve(options.plannerHandoffPath))
    : undefined;
  const request = plannerHandoff
    ? {
      ...options,
      plannerHandoff,
    }
    : options;
  const task = progress.task({
    id: 'download',
    title: options.dryRun ? '规划下载任务' : '执行下载任务',
    item: options.input,
  });
  const result = await runDownloadTask(request, {
    dryRun: options.dryRun,
    runRoot: options.outDir,
    runDir: options.runDir,
    concurrency: options.concurrency,
    retries: options.retries,
    retryBackoffMs: options.retryBackoffMs,
    resume: options.resume,
    retryFailedOnly: options.retryFailedOnly,
    skipExisting: options.skipExisting,
    verify: options.verify,
    enableDerivedMux: options.enableDerivedMux,
    liveValidation: options.liveValidation
      ? {
        ...options.liveValidation,
        siteKey: options.site,
      }
      : undefined,
    ...sessionManifestOptions,
    useUnifiedSessionHealth: options.useUnifiedSessionHealth,
    ...(options.sessionStatus ? { sessionStatus: options.sessionStatus } : {}),
    ...(options.sessionReason ? { sessionReason: options.sessionReason } : {}),
    resolveNetwork: options.resolveNetwork,
    progress: task,
  }, defaultResolverDeps(options));
  const artifacts = [
    result.manifest?.artifacts?.manifest ? { label: 'manifest', path: result.manifest.artifacts.manifest } : null,
    result.manifest?.artifacts?.reportMarkdown ? { label: 'report', path: result.manifest.artifacts.reportMarkdown } : null,
  ].filter(Boolean);
  if (result.manifest.status === 'passed') {
    task.succeed({
      message: `${result.manifest.counts.downloaded}/${result.manifest.counts.expected} completed`,
      completedItems: result.manifest.counts.downloaded,
      failedItems: result.manifest.counts.failed,
      skippedExisting: result.manifest.counts.skipped,
      artifacts,
    });
  } else if (result.manifest.status === 'skipped') {
    task.skip({
      message: result.manifest.reason ?? 'Download skipped',
      completedItems: result.manifest.counts.downloaded,
      failedItems: result.manifest.counts.failed,
      skippedExisting: result.manifest.counts.skipped,
      artifacts,
    });
  } else if (['blocked', 'failed'].includes(result.manifest.status)) {
    task.fail({
      message: result.manifest.reason ?? 'Download failed',
      completedItems: result.manifest.counts.downloaded,
      failedItems: result.manifest.counts.failed,
      skippedExisting: result.manifest.counts.skipped,
      artifacts,
    });
    progress.failure({
      taskId: 'download',
      title: 'Download stopped safely',
      stage: 'download',
      reason: result.manifest.reason ?? 'download failed',
      nextStep: result.manifest.resumeCommand ?? downloadCliCommand({
        mode: 'plan',
        site: options.site ?? result.plan.siteKey,
        input: options.input ?? '',
      }),
      report: result.manifest.artifacts?.reportMarkdown,
    });
  } else {
    task.warn({
      message: result.manifest.reason ?? result.manifest.status,
      completedItems: result.manifest.counts.downloaded,
      failedItems: result.manifest.counts.failed,
      skippedExisting: result.manifest.counts.skipped,
      artifacts,
    });
  }
  if (options.json) {
    process.stdout.write(downloadCliJson(result));
    return;
  }
  process.stdout.write(`Status: ${result.manifest.status}\n`);
  if (result.manifest.reason) {
    process.stdout.write(`Reason: ${result.manifest.reason}\n`);
  }
  process.stdout.write(`Manifest: ${result.manifest.artifacts.manifest}\n`);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
