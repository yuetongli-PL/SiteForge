// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { initializeCliUtf8, writeJsonStdout } from '../../infra/cli.mjs';
import {
  actionSessionMetadataFromOptions,
  readSessionRunManifest,
  sessionOptionsFromRunManifest,
} from '../../sites/sessions/manifest-bridge.mjs';
import { runDouyinAction } from '../../sites/douyin/actions/router.mjs';

export const DOUYIN_ACTION_HELP = `Usage:
  node src/entrypoints/sites/douyin-action.mjs download <video-url|author-url|video-id> [options]
  node src/entrypoints/sites/douyin-action.mjs login [options]

Defaults to planning/dry-run behavior unless the underlying action requires an
explicitly approved execution path.

Options:
  --profile-path <path>             Profile JSON source override.
  --browser-profile-root <path>     Browser profile root for reusable sessions.
  --user-data-dir <path>            Browser user data directory override.
  --out-dir <dir>                   Output directory for action artifacts.
  --timeout <ms>                    Browser/action timeout.
  --dry-run                         Plan downloads without executing media fetches.
  --max-items <n>                   Limit resolved download inputs.
  --window <value>                  Followed-update window.
  --user <value>                    Restrict followed/author inputs. Can be comma-separated.
  --keyword <value>                 Restrict titles. Can be comma-separated.
  --session-manifest <path>         Consume a unified runs/session health manifest.
  --session-health-plan             Generate and consume a unified session health manifest first.
  --no-session-health-plan          Use the legacy session provider path.
  --format <json|markdown>          Output format. Default: json.
  --output <full|summary|download>  Output payload shape. Default: full.
  -h, --help                        Show this help.
`;

function normalizeStringList(value) {
  return (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
    .flatMap((item) => String(item ?? '').split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseDouyinActionArgs(argv = process.argv.slice(2)) {
  const args = [...argv];
  const positionals = [];
  const flags = {};
  const appendFlag = (key, value) => {
    if (!(key in flags)) {
      flags[key] = value;
      return;
    }
    if (Array.isArray(flags[key])) {
      flags[key].push(value);
      return;
    }
    flags[key] = [flags[key], value];
  };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '-h') {
      appendFlag('help', true);
      continue;
    }
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const [key, inlineValue] = token.split('=', 2);
    const normalizedKey = key.replace(/^--/, '');
    if (inlineValue !== undefined) {
      appendFlag(normalizedKey, inlineValue);
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      appendFlag(normalizedKey, next);
      index += 1;
    } else {
      appendFlag(normalizedKey, true);
    }
  }

  const action = positionals[0] ?? 'download';
  const items = positionals.slice(1);
  return {
    help: flags.help === true,
    action,
    items,
    profilePath: flags['profile-path'] ? String(flags['profile-path']) : null,
    browserPath: flags['browser-path'] ? String(flags['browser-path']) : undefined,
    browserProfileRoot: flags['browser-profile-root'] ? String(flags['browser-profile-root']) : undefined,
    userDataDir: flags['user-data-dir'] ? String(flags['user-data-dir']) : undefined,
    pythonPath: flags['python-path'] ? String(flags['python-path']) : undefined,
    outDir: flags['out-dir'] ? String(flags['out-dir']) : undefined,
    timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
    headless: flags.headless === true ? true : flags['no-headless'] === true ? false : undefined,
    reuseLoginState: flags['no-reuse-login-state'] === true ? false : true,
    allowAutoLoginBootstrap: flags['no-auto-login-bootstrap'] === true ? false : true,
    sessionManifest: flags['session-manifest'] ? String(flags['session-manifest']) : undefined,
    sessionProvider: flags['session-provider'] ? String(flags['session-provider']) : undefined,
    useUnifiedSessionHealth: flags['no-session-health-plan'] === true
      ? false
      : flags['session-health-plan'] === true
        ? true
        : undefined,
    followUpdatesWindow: flags.window ? String(flags.window) : null,
    userFilter: normalizeStringList(flags.user ?? flags.author ?? flags['user-filter'] ?? []),
    titleKeyword: normalizeStringList(flags.keyword ?? flags['title-keyword'] ?? []),
    updatedOnly: flags['updated-only'] === true || flags['only-updated-users'] === true,
    output: flags.output ? String(flags.output) : 'full',
    outputFormat: flags.format ? String(flags.format) : 'json',
    download: {
      dryRun: flags['dry-run'] === true,
      concurrency: flags.concurrency ? Number(flags.concurrency) : undefined,
      concurrentFragments: flags['concurrent-fragments'] ? Number(flags['concurrent-fragments']) : undefined,
      maxItems: flags['max-items'] ? Number(flags['max-items']) : undefined,
      maxHeight: flags['max-height'] ? Number(flags['max-height']) : undefined,
      container: flags.container ? String(flags.container) : undefined,
    },
  };
}

function selectCliPayload(result, output) {
  const mode = String(output || 'full').trim().toLowerCase();
  if (mode === 'summary') {
    return result?.actionSummary || result?.download?.summaryView || result?.download?.summary || result;
  }
  if (mode === 'download') {
    return result?.download
      ? {
        ...result.download,
        sessionProvider: result.sessionProvider,
        sessionHealth: result.sessionHealth ?? null,
      }
      : result;
  }
  return result;
}

export async function buildDouyinActionRequest(parsed) {
  const sessionManifestOptions = parsed.sessionManifest
    ? sessionOptionsFromRunManifest(
      await readSessionRunManifest(path.resolve(parsed.sessionManifest)),
      {
        siteKey: 'douyin',
        host: 'www.douyin.com',
      },
    )
    : {};
  return {
    ...parsed,
    ...sessionManifestOptions,
  };
}

export async function runDouyinActionCli(argv = process.argv.slice(2)) {
  initializeCliUtf8();
  const parsed = parseDouyinActionArgs(argv);
  if (parsed.help) {
    process.stdout.write(DOUYIN_ACTION_HELP);
    return { help: DOUYIN_ACTION_HELP };
  }
  const request = await buildDouyinActionRequest(parsed);
  const sessionMetadata = await actionSessionMetadataFromOptions(parsed, {
    siteKey: 'douyin',
    host: 'www.douyin.com',
  });
  const result = {
    ...await runDouyinAction(request),
    ...sessionMetadata,
  };
  const outputFormat = String(parsed.outputFormat || 'json').trim().toLowerCase();
  if (outputFormat === 'markdown') {
    const markdown = parsed.output === 'summary'
      ? result?.markdown || result?.download?.reportMarkdown || ''
      : result?.download?.reportMarkdown || result?.markdown || '';
    process.stdout.write(markdown || `${JSON.stringify(selectCliPayload(result, parsed.output), null, 2)}\n`);
  } else {
    writeJsonStdout(selectCliPayload(result, parsed.output));
  }
  if (result?.ok !== true) {
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  runDouyinActionCli().catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
