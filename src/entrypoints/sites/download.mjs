// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runDownloadTask } from '../../sites/downloads/runner.mjs';
import {
  readSessionRunManifest,
  sessionOptionsFromRunManifest,
} from '../../sites/sessions/manifest-bridge.mjs';

const HELP = `Usage:
  node src/entrypoints/sites/download.mjs --site <site> --input <url-or-target> [options]

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
  --session-manifest <path>         Consume a unified runs/session health manifest before resolving resources.
  --session-health-plan             Generate and consume a unified session health manifest first.
  --no-session-health-plan          Use the legacy session provider instead of the unified health plan.
  --resolve-network                 Allow resolvers to fetch source pages before falling back to legacy downloaders.
  --json                            Print the full runner result JSON.
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
      case '--session-manifest': {
        const read = readValue(argv, index, arg);
        options.sessionManifest = read.value;
        index = read.nextIndex;
        break;
      }
      case '--session-health-plan':
        options.useUnifiedSessionHealth = true;
        break;
      case '--no-session-health-plan':
        options.useUnifiedSessionHealth = false;
        break;
      case '--resolve-network':
        options.resolveNetwork = true;
        break;
      case '--json':
        options.json = true;
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

export async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const sessionManifestOptions = options.sessionManifest
    ? sessionOptionsFromRunManifest(await readSessionRunManifest(path.resolve(options.sessionManifest)), {
      siteKey: options.site,
      ...(options.host ? { host: options.host } : {}),
    })
    : {};
  const result = await runDownloadTask(options, {
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
    resolveNetwork: options.resolveNetwork,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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
